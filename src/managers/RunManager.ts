import { analytics } from '@/analytics';
import { EventBus } from '@/core/EventBus';
import { PersistService } from '@/core/PersistService';
import { EV } from '@/config/events';
import {
  DUSK_EXTEND_STEPS,
  applyEncounter,
  cardBlock,
  createBasket,
  createRun,
  diagnoseCannotPlace,
  seedTutorialOuting,
  displayName,
  decideExtract,
  freebieToBasketDraft,
  hasGodPick,
  ingestExtract,
  isMysteryCard,
  isRummageNode,
  mulberry32,
  newSeed,
  nextUid,
  nodeEncounter,
  nodeFee,
  repackBasketWithStaging,
  rngInt,
  rngPick,
  rollGatherSpot,
  pileToBasketDraft,
  place,
  removeItem,
  resumeScenes,
  sellPrice,
  tryAutoPackBasket,
  tryDrop,
  tryRotateItem,
  rollFreebie,
  settleExtract,
  stallDisplayName,
  eventVoice,
  MARKET_RECIPE_POOL,
  remainingMarketRecipes,
  recipeUnlockView,
  unlockedIngredients,
  cookLevel,
  GOD_PICK,
  ITEMS,
  PICKLE_ITEM_IDS,
  dailyMarketWeather,
  getItem,
  marketFoodIds,
  MARKETS,
  rarityRank,
  rngWeighted,
  rollMarketItem,
  stallsForMarket,
  stallPacked,
  talkScript,
  pickTalkFood,
  tryAutoPlace,
  unlockBasketFlex,
  visibleDefId,
  furnLevel,
  type BasketItem,
  type BasketState,
  type ExtractedItem,
  type ExtractResult,
  type GatherSpot,
  type MapNode,
  type MysterySackPrize,
  type PileItem,
  type Quality,
  type Rng,
  type RunEventLog,
  type DropResult,
  type RunState,
  type SpecialMarketId,
  liveNeighborOrders,
  orderIngredientIds,
  outingRunMods,
} from '@/sim';
import { CloudSyncManager } from './CloudSyncManager';
import { SaveManager } from './SaveManager';
import { KitchenManager } from './KitchenManager';
import { TutorialManager, TutorialStep } from './TutorialManager';
import { getMarket, type MarketId } from '@/sim';
import { Platform } from '@/core/PlatformService';

/** 路线页一张卡要显示的全部信息。 */
export interface RouteOption {
  node: MapNode;
  /** 明牌了没。没明牌只画背面。 */
  revealed: boolean;
  /** 进不去的理由，null 表示能点 */
  blocked: string | null;
  fee: number;
  /** 不算人情时的标价。用来画「收费变免费」。 */
  listedFee: number;
  /** 街坊情分或天时签把这摊的进场费免了 */
  waived: boolean;
  left: number;
  /** 本摊位是否已经试过老杆秤稳准星 */
  steelyardDone?: boolean;
}

export type OutingLoot = Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened' | 'broken'>;

export interface MarketOutingCheckpoint {
  v: 1;
  kind: 'market';
  savedAt: number;
  outingStartedAt: number;
  rngSeed: number;
  rngCalls: number;
  tutorialAllowedCardId?: string;
  run: RunState;
  basket: BasketState;
  pendingLoot: OutingLoot[];
}

export interface PendingUnpackCheckpoint {
  v: 1;
  kind: 'pending_unpack';
  savedAt: number;
  extract: ExtractResult;
}

export interface SpecialOutingCheckpoint {
  v: 1;
  kind: 'special';
  savedAt: number;
  marketId: SpecialMarketId;
  round: number;
  haul: ExtractedItem[];
}

export type OutingCheckpointData =
  | MarketOutingCheckpoint
  | PendingUnpackCheckpoint
  | SpecialOutingCheckpoint;

export type BootRecoveryAction =
  | { type: 'none' }
  | { type: 'resume_market'; marketId: MarketId; lootCount: number }
  | { type: 'kitchen_toast'; count: number; message: string };

const CHECKPOINT_MAX_AGE_MS = 72 * 3600 * 1000;
const CHECKPOINT_DEBOUNCE_MS = 400;

function parseUidCounter(uid: string | undefined): number {
  if (!uid || uid.length < 2) return 0;
  const n = Number.parseInt(uid.slice(1), 36);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

class RunManagerClass {
  run: RunState | null = null;
  basket: BasketState = createBasket(0);
  pendingLoot: OutingLoot[] = [];
  interacting = false;
  private _rng: Rng = mulberry32(1);
  private _rngSeed = 1;
  private _rngCalls = 0;
  private _outingStartedAt = 0;
  private _emitting = false;
  private _checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private _checkpointDirty = false;

  constructor() {
    // 外部面板若直接更新了 basket 并广播 basketChanged，通过防抖计划刷新赶集断点（避免每次点击/拖拽同步序列化阻塞）
    EventBus.on(EV.basketChanged, () => {
      if (!this._emitting && this.run && !this.run.ended) {
        this.scheduleCheckpoint();
      }
    });
    // 任何紧急刷盘时机（onHide / visibilitychange / pagehide / restartMiniProgram / flushAllSync）先补齐待定赶集断点
    PersistService.onBeforeFlush(() => {
      if (this._checkpointDirty) {
        this._writeMarketCheckpoint();
      }
    });
  }

  private _initRng(seed: number, skipCalls = 0): void {
    this._rngSeed = seed >>> 0;
    this._rngCalls = 0;
    const base = mulberry32(this._rngSeed);
    const skip = Math.max(0, Math.min(20000, Math.floor(skipCalls)));
    for (let i = 0; i < skip; i++) {
      base();
      this._rngCalls += 1;
    }
    this._rng = () => {
      this._rngCalls += 1;
      return base();
    };
  }

  /** 摊上抽货时给「手里菜谱用得上的食材」加权，货才跟得上进度。 */
  private _wanted(): Set<string> {
    return unlockedIngredients(recipeUnlockView(KitchenManager.save));
  }

  /** 挂着的点菜单用料，再叠一层，减轻有单没料。 */
  private _boosted(): Set<string> {
    return new Set(orderIngredientIds(liveNeighborOrders(KitchenManager.save.neighborOrders)));
  }

  start(marketId: MarketId = 'xiangko'): boolean {
    if (!KitchenManager.startRun(getMarket(marketId).staminaCost)) return false;
    const seed = newSeed();
    this._initRng((seed ^ 0x5BF03635) >>> 0, 0);
    const inTut = TutorialManager.isActive || TutorialManager.needsOutingSeed();
    const outing = outingRunMods(KitchenManager.save, this._rng());
    const weather = inTut ? null : dailyMarketWeather(marketId);
    const validStallBias = outing.stallBias
      ?? (weather?.stallBias && stallsForMarket(marketId).includes(weather.stallBias)
        ? weather.stallBias
        : undefined);
    this.run = createRun({
      allowGodPick: KitchenManager.allowGodPickToday(),
      marketId,
      seed,
      cookLevel: cookLevel(KitchenManager.save),
      allowRecipe: remainingMarketRecipes(marketId, KitchenManager.save.recipesFound).length > 0,
      forceRecipe: remainingMarketRecipes(marketId, KitchenManager.save.recipesFound).length
        === MARKET_RECIPE_POOL[marketId].length,
      wanted: this._wanted(),
      boosted: this._boosted(),
      extraSteps: outing.extraSteps + (weather?.extraSteps ?? 0),
      luck: {
        rare: outing.luckRare + (weather?.luckRare ?? 0),
        epic: outing.luckEpic + (weather?.luckEpic ?? 0),
      },
      feeMul: outing.feeMul,
      stallBias: validStallBias,
      weatherId: weather?.id,
      freeFirstPaidStall: !!weather?.freeFirstPaidStall,
      paystallExtraItems: weather?.paystallExtraItems ?? 0,
      mysterySackCount: inTut ? 0 : 1 + (weather?.extraMysterySacks ?? 0),
    });
    if (TutorialManager.needsOutingSeed() && this.run) {
      TutorialManager.setAllowedCardId(seedTutorialOuting(this.run));
    }
    if (hasGodPick(this.run)) KitchenManager.markGodPickToday();
    this.basket = createBasket(
      furnLevel(KitchenManager.save, 'basket'),
      furnLevel(KitchenManager.save, 'foam'),
      outing,
    );
    this.pendingLoot = [];
    this._outingStartedAt = Date.now();
    const marketCost = getMarket(marketId).staminaCost;
    analytics.trackQuestStart(`outing_${marketId}`, 'event', {
      market_id: marketId,
      seed,
      ...analytics.formatOutingMetrics({
        weatherId: weather?.id,
        vehicleId: KitchenManager.save.vehicle,
        cookLevel: cookLevel(KitchenManager.save),
        staminaCost: marketCost,
      }),
    });
    this.emit();
    return true;
  }

  abortUnused(): void {
    const marketId = this.run?.marketId;
    if (marketId) {
      analytics.trackQuestAbandon(`outing_${marketId}`, 'event', 'unused', {
        market_id: marketId,
        duration_ms: Math.max(0, Date.now() - this._outingStartedAt),
      });
    }
    this._outingStartedAt = 0;
    this.run = null;
    this._cancelScheduledCheckpoint();
    PersistService.clearOutingCheckpoint();
    KitchenManager.refundStamina(marketId ? getMarket(marketId).staminaCost : 1);
    this.emit();
  }

  get active(): boolean {
    return !!this.run && !this.run.ended;
  }

  tick(_dt: number): void {}

  /** 这一层能点的卡。 */
  options(): RouteOption[] {
    const run = this.run;
    if (!run || run.ended) return [];
    return run.options.map((id) => this.describe(run, id, false));
  }

  /**
   * 当前一排 + 前方几排。前方的按 next 顺推，所以只看得见自己走得到的卡。
   * 排与排之间的连线交给视图画，「选了左边右边就过不去」得让人在点之前就看见。
   */
  routeRows(depth = 3): RouteOption[][] {
    const run = this.run;
    if (!run || run.ended || run.mode !== 'map') return [];
    const rows: RouteOption[][] = [];
    let ids = run.options.slice();
    for (let i = 0; i < depth && ids.length; i++) {
      rows.push(ids.map((id) => this.describe(run, id, i > 0)));
      const nextIds: string[] = [];
      ids.forEach((id) => {
        run.map.nodes[id].next.forEach((nid) => {
          if (!nextIds.includes(nid)) nextIds.push(nid);
        });
      });
      ids = nextIds;
    }
    return rows;
  }

  /** ahead 为真时不算天色门槛：前方的卡等你走到跟前，步数早变了。 */
  private describe(run: RunState, id: string, ahead: boolean): RouteOption {
    const node = run.map.nodes[id];
    const fee = nodeFee(run, node);
    const listedFee = nodeFee(run, node, { ignoreFreePass: true });
    const isSack = nodeEncounter(node).type === 'mystery_sack';
    return {
      node,
      revealed:
        isSack
        || !isMysteryCard(node.kind)
        || run.peeked.includes(id)
        || KitchenManager.cardSeen(run.marketId, node.kind),
      blocked: cardBlock(run, node, KitchenManager.save.money, KitchenManager.save.level, ahead),
      fee,
      listedFee,
      waived: (!!run.freePass || !!run.weatherFreePaidLeft) && listedFee > 0 && fee === 0,
      left: isRummageNode(node) ? (run.piles[id] ?? []).filter((it) => !it.washed).length : 0,
      steelyardDone: (run.steelyardDone ?? []).includes(id) || TutorialManager.isActive,
    };
  }

  stepsLabel(): string {
    if (!this.run) return '天色';
    return `${this.run.stepsLeft}/${this.run.stepsMax}`;
  }

  markSteelyardDone(nodeId: string): void {
    const run = this.run;
    if (!run) return;
    const done = run.steelyardDone ?? [];
    if (done.includes(nodeId)) return;
    this.run = { ...run, steelyardDone: [...done, nodeId] };
    this.emit();
  }

  enterNode(
    id: string,
    opts?: { feeOverride?: number; bonusItems?: number; usedStallFavor?: boolean },
  ): void {
    const run = this.run;
    if (!run || run.ended || run.mode !== 'map' || run.duskPromptPending || run.pendingMysterySack) return;
    if (!run.options.includes(id)) return;
    const node = run.map.nodes[id];
    const effectiveMoney = opts?.feeOverride !== undefined ? 999999 : KitchenManager.save.money;
    const block = cardBlock(run, node, effectiveMoney, KitchenManager.save.level);
    if (block) {
      Platform.showToast(block);
      return;
    }

    const listedFee = nodeFee(run, node, { ignoreFreePass: true });
    const baseFee = nodeFee(run, node);
    const fee = opts?.feeOverride !== undefined ? Math.max(0, Math.floor(opts.feeOverride)) : baseFee;
    if (fee > 0 && !KitchenManager.trySpend(fee)) return;
    KitchenManager.markCardSeen(run.marketId, node.kind);

    const rummage = isRummageNode(node);
    const favored = rummage && run.freePass && opts?.feeOverride === undefined;
    const usedWeatherFree = rummage
      && !favored
      && !!run.weatherFreePaidLeft
      && listedFee > 0
      && baseFee === 0
      && opts?.feeOverride === undefined;

    let nextPiles = run.piles;
    const bonusCount = Math.max(0, Math.floor(opts?.bonusItems ?? 0));
    if (rummage && bonusCount > 0) {
      const extraList: PileItem[] = [];
      for (let i = 0; i < bonusCount; i++) {
        const def = rollMarketItem(
          run.marketId,
          node.stall ?? 'egg',
          cookLevel(KitchenManager.save),
          this._rng,
          this._wanted(),
          this._boosted(),
          { rare: run.luckRare + 0.35, epic: run.luckEpic + 0.25 },
        );
        extraList.push({
          uid: nextUid('p'),
          defId: def.id,
          quality: 'fresh',
          revealed: false,
          inspected: false,
          washed: false,
          drawn: false,
        });
      }
      nextPiles = {
        ...run.piles,
        [id]: [...extraList, ...(run.piles[id] ?? [])],
      };
    }

    let next: RunState = {
      ...run,
      piles: nextPiles,
      stepsLeft: Math.max(0, run.stepsLeft - node.steps),
      atNodeId: id,
      options: node.next.slice(),
      visited: [...run.visited, id],
      freePass: favored ? false : run.freePass,
      weatherFreePaidLeft: usedWeatherFree ? false : run.weatherFreePaidLeft,
      stallFavorUsed: opts?.usedStallFavor ? true : run.stallFavorUsed,
      steelyardDone: (run.steelyardDone ?? []).includes(id)
        ? run.steelyardDone
        : [...(run.steelyardDone ?? []), id],
    };

    const result = applyEncounter({
      rng: this._rng,
      state: next,
      node,
      cookLevel: cookLevel(KitchenManager.save),
      recipesFound: KitchenManager.save.recipesFound,
      findRecipe: (rid) => KitchenManager.findRecipe(rid),
      voice: (kind) => {
        const lines = eventVoice(next.marketId, kind)?.lines;
        return lines?.length ? rngPick(this._rng, lines) : '';
      },
    });
    next = result.state;

    if (result.enter === 'rummage') {
      this.run = {
        ...next,
        mode: 'rummage',
        currentNodeId: id,
        paid: next.paid.includes(id) ? next.paid : [...next.paid, id],
        slowNodes: favored ? [...next.slowNodes, id] : next.slowNodes,
        note: next.note || '摊上还剩一堆，翻开就能捡。',
      };
      if (opts?.usedStallFavor) {
        Platform.showToast('帮摊主收好筐！免单进摊还多塞了 2 件好货', 'success');
      } else if (bonusCount >= 2 && fee === 0) {
        Platform.showToast('老杆秤一秤定音！免单进摊 + 摊主多塞 2 件好货', 'success');
      } else if (bonusCount === 1) {
        Platform.showToast(`秤杆稳平！半价 ${fee} 金进摊 + 多塞 1 件鲜货`, 'success');
      } else if (usedWeatherFree) {
        Platform.showToast('早集刚散，首座收费摊免单白翻！', 'success');
      } else if (fee > 0) {
        Platform.showToast(`买下这摊剩货 ${fee} 金币`);
      } else if (favored) {
        Platform.showToast('街坊打过招呼，这摊白翻');
      } else {
        Platform.showToast('街坊情分，这摊剩的给你翻');
      }
      this.emit();
      return;
    }

    if (result.enter === 'play') {
      const enc = result.resolved ?? nodeEncounter(node);
      if (enc.type === 'gather') {
        this.run = {
          ...next,
          mode: 'play',
          currentNodeId: id,
          play: {
            type: 'gather',
            nodeId: id,
            picksLeft: enc.picks,
            spots: this._rollGatherSpots(enc.pool, enc.picks),
            bg: enc.bg,
          },
        };
        this.emit();
        return;
      }
      this.run = { ...next, mode: 'map' };
      this.emit();
      this.checkDayEnd();
      return;
    }

    const encType = nodeEncounter(node).type;
    if (encType === 'mystery_sack') {
      const sacks = this._rollMysterySacks(next);
      this.run = resumeScenes({
        ...next,
        pendingMysterySack: {
          nodeId: id,
          sacks,
          pickedIdx: null,
          sweptByAd: false,
        },
      });
      this.emit();
      return;
    }

    if (encType === 'freebie') {
      next = this._takeFreebie(next, node);
    }

    this.run = resumeScenes(next);
    this.emit();
    this.checkDayEnd();
  }

  private _rollMysterySacks(state: RunState): [MysterySackPrize, MysterySackPrize, MysterySackPrize] {
    const lv = cookLevel(KitchenManager.save);
    const seen = new Set([...KitchenManager.save.dexSeen, ...KitchenManager.save.dexInspected]);
    const sorted = [...MARKETS].sort((a, b) => a.unlockLevel - b.unlockLevel);
    const allowed = sorted.filter((m) => m.unlockLevel <= lv + 3);
    const poolIds = new Set<string>();
    for (const m of (allowed.length ? allowed : sorted.slice(0, 2))) {
      for (const id of marketFoodIds(m.id)) {
        if (id !== GOD_PICK.id) poolIds.add(id);
      }
    }
    poolIds.add('chicken_wing');
    for (const pid of PICKLE_ITEM_IDS) {
      if (lv >= 2) poolIds.add(pid);
    }
    const weighted: Array<[string, number]> = [];
    for (const id of poolIds) {
      if (!ITEMS.some((it) => it.id === id)) continue;
      const r = rarityRank(getItem(id).rarity);
      if (r === 0) continue; // 尾货篓只出良品/上品/珍品稀罕货！
      let w = r === 1 ? 5 : r === 2 ? 7 : 3.5;
      if (!seen.has(id)) w *= 1.6;
      weighted.push([id, w]);
    }
    const fallback: Array<[string, number]> = [
      ['shrimp', 6],
      ['mushroom', 6],
      ['ribs', 5],
      ['chicken_wing', 5],
    ];
    const pool = weighted.length >= 3 ? weighted : fallback;
    const chosen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const sub = pool.filter(([id]) => !chosen.includes(id));
      const pick = rngWeighted(this._rng, sub.length ? sub : pool);
      chosen.push(pick);
    }
    const sacks: MysterySackPrize[] = chosen.map((defId) => ({
      kind: 'food' as const,
      defId,
      quality: 'fresh' as const,
    }));
    // 约 42% 概率让其中一只麻袋藏着 1 张菜谱券，揭开更有惊喜感！
    if (this._rng() < 0.42) {
      const slotIdx = Math.floor(this._rng() * 3);
      sacks[slotIdx] = { kind: 'ticket', qty: 1 };
    }
    void state;
    return [sacks[0], sacks[1], sacks[2]];
  }

  private _grantSackPrize(prize: MysterySackPrize, marketId: MarketId): { placed: boolean; label: string } {
    if (prize.kind === 'ticket') {
      const nextTickets = KitchenManager.save.recipeTickets + prize.qty;
      SaveManager.replace({ ...KitchenManager.save, recipeTickets: nextTickets });
      KitchenManager.emit();
      return { placed: true, label: `菜谱券 ×${prize.qty}` };
    }
    KitchenManager.discoverFood(prize.defId, prize.quality, marketId);
    const draft = freebieToBasketDraft(prize.defId, prize.quality);
    const packed = tryAutoPackBasket(this.basket, draft);
    if (packed) {
      this.basket = packed.state;
      return { placed: true, label: getItem(prize.defId).name };
    }
    this.pendingLoot = [...this.pendingLoot, draft];
    return { placed: false, label: `${getItem(prize.defId).name}（暂存手边）` };
  }

  pickMysterySack(idx: 0 | 1 | 2): { ok: boolean; label: string; isTicket: boolean } {
    const run = this.run;
    const ms = run?.pendingMysterySack;
    if (!run || !ms || ms.pickedIdx !== null) return { ok: false, label: '', isTicket: false };
    const prize = ms.sacks[idx];
    const granted = this._grantSackPrize(prize, run.marketId);
    this.run = {
      ...run,
      pendingMysterySack: { ...ms, pickedIdx: idx },
      note: `从尾货篓里摸出了${granted.label}！`,
    };
    this.emit();
    return { ok: true, label: granted.label, isTicket: prize.kind === 'ticket' };
  }

  sweepMysterySacksByAd(): { ok: boolean; labels: string[]; tickets: number } {
    const run = this.run;
    const ms = run?.pendingMysterySack;
    if (!run || !ms || ms.pickedIdx === null || ms.sweptByAd || run.sackSweepUsed) {
      return { ok: false, labels: [], tickets: 0 };
    }
    const labels: string[] = [];
    let tickets = 0;
    ms.sacks.forEach((prize, i) => {
      if (i === ms.pickedIdx) return;
      const g = this._grantSackPrize(prize, run.marketId);
      labels.push(g.label);
      if (prize.kind === 'ticket') tickets += prize.qty;
    });
    this.run = {
      ...run,
      sackSweepUsed: true,
      pendingMysterySack: { ...ms, sweptByAd: true },
      note: `搭把手帮收摊，剩下两袋好货全归你啦！`,
    };
    this.emit();
    return { ok: true, labels, tickets };
  }

  finishMysterySack(): void {
    const run = this.run;
    if (!run || !run.pendingMysterySack) return;
    this.run = { ...run, pendingMysterySack: null };
    this.emit();
    this.checkDayEnd();
  }

  /** 整层的卡全进不去（若还能搏老杆秤减免则不算卡死）。 */
  allBlocked(): boolean {
    const run = this.run;
    if (!run || run.ended || run.mode !== 'map' || !run.options.length) return false;
    return this.options().every((opt) => {
      if (!opt.blocked) return false;
      if (!opt.steelyardDone && isRummageNode(opt.node) && opt.fee > 0 && opt.blocked.includes('金币')) {
        return false;
      }
      return true;
    });
  }

  bypass(): void {
    const run = this.run;
    if (!run || !this.allBlocked()) return;
    const merged: string[] = [];
    run.options.forEach((id) => {
      run.map.nodes[id].next.forEach((nid) => {
        if (!merged.includes(nid)) merged.push(nid);
      });
    });
    this.run = {
      ...run,
      stepsLeft: Math.max(0, run.stepsLeft - 1),
      options: merged,
      note: '这几处都进不去，绕过去了一段。',
    };
    Platform.showToast('绕开这一层，耗一步天色');
    this.emit();
    this.checkDayEnd();
  }

  /** 从摊面退回路线。天色可能已经在进摊那一步用完了。 */
  leaveStall(): void {
    if (!this.run || this.run.ended) return;
    this.run = resumeScenes({ ...this.run, mode: 'map', currentNodeId: null, note: '出了摊，接着挑路。' });
    this.emit();
    this.checkDayEnd();
  }

  /** 采集 / 小游戏退回路线。洞内走完靠 returnStack 回主路。 */
  leavePlay(): void {
    if (!this.run || this.run.ended) return;
    this.run = resumeScenes({
      ...this.run,
      mode: 'map',
      currentNodeId: null,
      play: undefined,
      note: this.run.sceneId === 'main' ? '接着挑路。' : '出了这儿，接着走。',
    });
    this.emit();
    this.checkDayEnd();
  }

  pickGather(uid: string): 'placed' | 'need_space' | 'gone' | 'done' {
    const run = this.run;
    if (!run || run.mode !== 'play' || run.play?.type !== 'gather') return 'gone';
    const play = run.play;
    const spot = play.spots.find((s) => s.uid === uid);
    if (!spot || spot.taken) return 'gone';
    if (play.picksLeft <= 0) return 'done';

    const quality = 'common' as const;
    const draft = freebieToBasketDraft(spot.defId, quality);
    const packed = tryAutoPackBasket(this.basket, draft);
    const taken = !!packed;
    if (packed) this.basket = packed.state;
    else this.pendingLoot = [...this.pendingLoot, draft];
    const blockReason = taken ? '' : diagnoseCannotPlace(this.basket, spot.defId);

    const spots = play.spots.map((s) => (s.uid === uid ? { ...s, taken: true } : s));
    const picksLeft = play.picksLeft - 1;
    this.run = {
      ...run,
      play: { ...play, spots, picksLeft },
      lastEvent: {
        nodeId: play.nodeId,
        kind: 'gather',
        marketId: run.marketId,
        text: taken ? `拿到${displayName(spot.defId, false, quality)}。` : blockReason,
        gain: { defId: spot.defId, quality, taken, firstSeen: spot.firstSeen },
      },
      note: picksLeft > 0 ? `还能再拿 ${picksLeft} 份。` : '手上拿够了，可以回去。',
    };
    this.emit();
    return taken ? 'placed' : 'need_space';
  }

  chooseTalk(index: number): boolean {
    const run = this.run;
    const ev = run?.lastEvent;
    if (!run || !ev?.scriptId || !ev.choices) return false;
    const script = talkScript(ev.scriptId);
    const choice = script?.choices[index];
    if (!choice) return false;
    const cost = choice.steps ?? 0;
    if (cost > run.stepsLeft) {
      Platform.showToast('天色不够了');
      return false;
    }

    let next: RunState = {
      ...run,
      stepsLeft: Math.max(0, run.stepsLeft - cost),
      flags: choice.setFlag && !run.flags.includes(choice.setFlag)
        ? [...run.flags, choice.setFlag]
        : run.flags,
    };
    if (choice.grantItem) {
      const bag = next.bag.map((it) => ({ ...it }));
      const hit = bag.find((it) => it.id === choice.grantItem);
      if (hit) hit.qty += 1;
      else bag.push({ id: choice.grantItem, qty: 1 });
      next = { ...next, bag };
    }
    const food = pickTalkFood(choice.grantFood, this._rng);
    if (food) {
      next = this._placeFood(next, ev.nodeId, 'talk', food, 'common', `${choice.label}。`);
    } else {
      next = {
        ...next,
        note: choice.label,
        lastEvent: {
          nodeId: ev.nodeId,
          kind: 'talk',
          marketId: run.marketId,
          text: choice.label,
          gain: null,
          speaker: script?.speaker,
          portrait: script?.portrait,
        },
      };
    }
    this.run = resumeScenes(next);
    this.emit();
    this.checkDayEnd();
    return true;
  }

  private _rollGatherSpots(pool: string[], picks: number): GatherSpot[] {
    const n = rngInt(this._rng, Math.max(6, picks), 8);
    const layout = [
      { x: 0.22, y: 0.34 },
      { x: 0.48, y: 0.30 },
      { x: 0.74, y: 0.36 },
      { x: 0.18, y: 0.52 },
      { x: 0.40, y: 0.48 },
      { x: 0.62, y: 0.50 },
      { x: 0.82, y: 0.46 },
      { x: 0.34, y: 0.64 },
    ];
    const spots: GatherSpot[] = Array.from({ length: n }, (_, i) => ({
      uid: nextUid('g'),
      defId: rollGatherSpot(pool, this._rng),
      taken: false,
      x: layout[i]?.x ?? 0.5,
      y: layout[i]?.y ?? 0.45,
    }));
    const seen = new Set<string>();
    return spots.map((spot) => {
      if (seen.has(spot.defId)) return spot;
      seen.add(spot.defId);
      return { ...spot, firstSeen: KitchenManager.discoverFood(spot.defId, undefined, this.run?.marketId) };
    });
  }

  private _takeFreebie(state: RunState, node: MapNode): RunState {
    const { defId, quality } = rollFreebie(
      this._rng,
      state.marketId,
      cookLevel(KitchenManager.save),
      this._wanted(),
      this._boosted(),
      { rare: state.luckRare, epic: state.luckEpic },
    );
    return this._placeFood(state, node.id, node.kind, defId, quality, '摊主收筐时漏下的，还新鲜着，捡回去。');
  }

  private _placeFood(
    state: RunState,
    nodeId: string,
    kind: RunEventLog['kind'],
    defId: string,
    quality: Quality,
    text: string,
  ): RunState {
    const name = displayName(defId, false, quality);
    const draft = freebieToBasketDraft(defId, quality);
    const packed = tryAutoPackBasket(this.basket, draft);
    if (!packed) {
      const reason = diagnoseCannotPlace(this.basket, defId);
      this.pendingLoot = [...this.pendingLoot, draft];
      return {
        ...state,
        note: reason,
        lastEvent: {
          nodeId,
          kind,
          marketId: state.marketId,
          text: reason,
          gain: { defId, quality, taken: false, firstSeen: KitchenManager.discoverFood(defId, quality, state.marketId) },
        },
      };
    }
    this.basket = packed.state;
    return {
      ...state,
      note: `拿到一份${name}。`,
      lastEvent: {
        nodeId,
        kind,
        marketId: state.marketId,
        text,
        gain: { defId, quality, taken: true, firstSeen: KitchenManager.discoverFood(defId, quality, state.marketId) },
      },
    };
  }

  /** 天黑被赶出来是 messy，逛到街尾从容回家算 safe。 */
  private checkDayEnd(): void {
    const run = this.run;
    if (!run || run.ended || run.mode === 'rummage' || run.mode === 'play') return;
    if (run.options.length === 0) {
      Platform.showToast('逛到街尾了，回家');
      this.extract(true);
      return;
    }
    if (run.stepsLeft <= 0) {
      if (!TutorialManager.isActive && !run.duskExtended) {
        if (!run.duskPromptPending) {
          this.run = { ...run, duskPromptPending: true };
          this.emit();
          EventBus.emit(EV.runDuskPrompt);
        }
        return;
      }
      Platform.showToast('天黑了，收摊');
      this.extract(false);
    }
  }

  /** 看激励视频借手电筒：再走 DUSK_EXTEND_STEPS 步（每局限 1 次）。 */
  extendDuskSteps(extra = DUSK_EXTEND_STEPS): boolean {
    const run = this.run;
    if (!run || run.ended || run.duskExtended) return false;
    const add = Math.max(1, Math.floor(extra));
    const stepsLeft = Math.max(0, run.stepsLeft) + add;
    this.run = {
      ...run,
      stepsLeft,
      stepsMax: Math.max(run.stepsMax, stepsLeft),
      duskExtended: true,
      duskPromptPending: false,
      note: `借到摊主手电筒，还能摸黑再逛 ${add} 步！`,
    };
    Platform.showToast(`借到手电筒！再逛 ${add} 步`, 'success');
    this.emit();
    return true;
  }

  /** 放弃借手电筒，正常按天黑收摊回家。 */
  declineDuskExtend(): void {
    const run = this.run;
    if (!run || run.ended) return;
    this.run = { ...run, duskPromptPending: false };
    Platform.showToast('天黑了，收摊');
    this.extract(false);
  }

  /** 扫描前方三层可达路线里的亮点卡，用于天黑借手电筒弹窗提示。 */
  duskAheadHighlights(): string[] {
    const run = this.run;
    if (!run || run.ended) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    let frontier = run.options.slice();
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const node = run.map.nodes[id];
        if (!node) continue;
        const enc = nodeEncounter(node);
        let tag = '';
        if (enc.type === 'recipe' || node.kind === 'recipe') tag = '油纸菜谱';
        else if (enc.type === 'mystery_sack') tag = '压箱尾货篓';
        else if (enc.type === 'rummage' && enc.specialty) tag = node.title || '特色好货摊';
        else if (enc.type === 'gather') tag = node.title || '野生采集点';
        else if (enc.type === 'branch') tag = node.title || '隐秘支线';
        else if (node.kind === 'paystall') tag = '压箱好货摊';
        else if (enc.type === 'rummage' && node.stall) tag = `${stallDisplayName(run.marketId, node.stall)}`;
        if (tag && !seen.has(tag)) {
          seen.add(tag);
          out.push(tag);
        }
        for (const nid of node.next) {
          if (!next.includes(nid)) next.push(nid);
        }
      }
      frontier = next;
    }
    return out.slice(0, 3);
  }

  currentPile(): PileItem[] {
    if (!this.run?.currentNodeId) return [];
    return (this.run.piles[this.run.currentNodeId] ?? []).filter((it) => !it.washed && it.drawn);
  }

  crateLeft(): PileItem[] {
    if (!this.run?.currentNodeId) return [];
    return (this.run.piles[this.run.currentNodeId] ?? []).filter((it) => !it.washed && !it.drawn);
  }

  currentPacked(): boolean {
    if (!this.run?.currentNodeId) return false;
    return stallPacked(this.run.packing, this.run.currentNodeId);
  }

  drawFromCrate(uid?: string): PileItem | null {
    if (!this.run?.currentNodeId) return null;
    const crate = this.crateLeft();
    if (!crate.length) {
      Platform.showToast('筐里空了');
      return null;
    }
    const item = uid
      ? crate.find((it) => it.uid === uid) ?? crate[Math.floor(Math.random() * crate.length)]
      : crate[Math.floor(Math.random() * crate.length)];
    this.patchPile(item.uid, {
      drawn: true,
      revealed: true,
      inspected: item.defId !== GOD_PICK.id,
      firstSeen: KitchenManager.discoverFood(visibleDefId(item), item.quality, this.run.marketId),
    });
    this.emit();
    return this.findPile(item.uid) ?? item;
  }

  uncover(uid: string): void {
    if (!this.run) return;
    const item = this.findPile(uid);
    if (!item || item.revealed) return;
    this.patchPile(uid, { revealed: true });
    this.emit();
  }

  inspect(uid: string): void {
    if (!this.run) return;
    const item = this.findPile(uid);
    if (!item || !item.revealed || item.inspected) return;
    this.patchPile(uid, { inspected: true });
    this.emit();
  }

  take(uid: string, opts?: { quiet?: boolean }): 'placed' | 'need_space' | 'gone' | 'rotten' {
    if (!this.run) return 'gone';
    const item = this.findPile(uid);
    if (!item || !item.revealed || item.washed) return 'gone';
    if (item.quality === 'rotten') return 'rotten';
    this._revealGodPick(uid, opts?.quiet);
    const draft = pileToBasketDraft(this.findPile(uid) ?? { ...item, inspected: true });
    const directFit = !!tryAutoPlace(this.basket, draft);
    const packed = tryAutoPackBasket(this.basket, draft);
    if (!packed) return 'need_space';
    this.basket = packed.state;
    this.removeFromPile(uid);
    this.emit();
    if (!directFit && !opts?.quiet) {
      Platform.showToast(`已自动腾挪装下${getItem(draft.defId).name}！`, 'success');
    }
    return 'placed';
  }

  /** 点击桌面上的烂菜随手拨到一边，清理桌面不占篮。 */
  discardRotten(uid: string): boolean {
    if (!this.run) return false;
    const item = this.findPile(uid);
    if (!item || item.quality !== 'rotten' || item.washed) return false;
    this.patchPile(uid, { washed: true });
    this.emit();
    return true;
  }

  tryManualPlace(item: BasketItem): string | null {
    const result = place(this.basket, item);
    if (!result.ok) return result.reason;
    this.basket = result.state;
    this.emit();
    return null;
  }

  /** 看广告解锁顶上一行，只当次有效，干湿都能放。 */
  unlockBasketFlex(): boolean {
    if (this.basket.flexUnlocked) return false;
    this.basket = unlockBasketFlex(this.basket);
    this.emit();
    return true;
  }

  moveBasketItem(uid: string, x: number, y: number, rot: 0 | 1): string | null {
    const item = this.basket.items.find((it) => it.uid === uid);
    if (!item) return '篮里没有';
    return this._finishDrop(tryDrop(this.basket, { ...item, x, y, rot }));
  }

  rotateBasketItem(uid: string): string | null {
    return this._finishDrop(tryRotateItem(this.basket, uid));
  }

  stagingItems(): OutingLoot[] {
    const seen = new Set<string>();
    const out: OutingLoot[] = [];
    for (const it of this.pendingLoot) {
      if (seen.has(it.uid)) continue;
      seen.add(it.uid);
      out.push(it);
    }
    for (const it of this.currentPile()) {
      if (it.quality === 'rotten' || seen.has(it.uid)) continue;
      seen.add(it.uid);
      out.push(pileToBasketDraft(it));
    }
    return out;
  }

  dropStagingToCell(uid: string, x: number, y: number, rot: 0 | 1 = 0): string | null {
    const pile = this.findPile(uid);
    if (pile?.quality === 'rotten') return '坏了，捡不了';
    this._revealGodPick(uid);
    const loot = this.stagingItems().find((it) => it.uid === uid);
    if (!loot) return '已经不在手里';
    const err = this._applyDrop(tryDrop(this.basket, {
      ...loot,
      x,
      y,
      rot,
      pinned: false,
      dampened: false,
    }));
    if (err) return err;
    this.pendingLoot = this.pendingLoot.filter((it) => it.uid !== uid);
    if (this.findPile(uid)) this.removeFromPile(uid);
    this.emit();
    return null;
  }

  returnToStaging(uid: string): string | null {
    const item = this.basket.items.find((it) => it.uid === uid);
    if (!item) return '篮里没有';
    this.basket = removeItem(this.basket, uid);
    if (this.run?.mode === 'rummage' && this.run.currentNodeId) {
      const nid = this.run.currentNodeId;
      const piles = { ...this.run.piles };
      piles[nid] = [
        ...(piles[nid] ?? []),
        {
          uid: item.uid,
          defId: item.defId,
          quality: item.quality,
          revealed: true,
          inspected: item.inspected,
          washed: false,
          drawn: true,
        },
      ];
      this.run = { ...this.run, piles };
    } else {
      this.pendingLoot = [
        ...this.pendingLoot,
        {
          uid: item.uid,
          defId: item.defId,
          quality: item.quality,
          inspected: item.inspected,
          freshness: item.freshness,
        },
      ];
    }
    this.emit();
    return null;
  }

  discardStaging(uid: string): void {
    this.pendingLoot = this.pendingLoot.filter((it) => it.uid !== uid);
    if (this.findPile(uid)) this.removeFromPile(uid);
    this.emit();
  }

  dropFromPileToCell(uid: string, x: number, y: number, rot: 0 | 1 = 0): string | null {
    if (!this.run) return '不在局内';
    const pile = this.findPile(uid);
    if (!pile) return '已经不在堆里';
    if (pile.quality === 'rotten') return '坏了，捡不了';
    this._revealGodPick(uid);
    const base = pileToBasketDraft(this.findPile(uid) ?? { ...pile, inspected: true });
    const incoming = { ...base, x, y, rot, pinned: false, dampened: false };
    let result = tryDrop(this.basket, incoming);
    if (!result.ok) result = tryDrop(this.basket, { ...incoming, rot: rot === 0 ? 1 : 0 });
    const err = this._applyDrop(result);
    if (err) return err;
    this.removeFromPile(uid);
    this.emit();
    return null;
  }

  discard(uid: string): void {
    this.basket = removeItem(this.basket, uid);
    this.emit();
  }

  togglePin(uid: string): void {
    this.basket = {
      ...this.basket,
      items: this.basket.items.map((it) => (it.uid === uid ? { ...it, pinned: !it.pinned } : it)),
    };
    this.emit();
  }

  /** 菜篮面板一键码齐：紧凑重排篮内物品并尽量将暂存区鲜货自动装篮。 */
  autoTidyBasket(priorityUid?: string | null): { movedCount: number; placedCount: number; leftCount: number } {
    const staging = this.stagingItems();
    const res = repackBasketWithStaging(this.basket, staging, priorityUid);
    this.basket = res.state;
    if (res.placedStaging.length > 0) {
      const placedUids = new Set(res.placedStaging.map((it) => it.uid));
      this.pendingLoot = this.pendingLoot.filter((it) => !placedUids.has(it.uid));
      for (const uid of placedUids) {
        if (this.findPile(uid)) this.removeFromPile(uid);
      }
    }
    this.emit();
    return {
      movedCount: res.movedCount,
      placedCount: res.placedStaging.length,
      leftCount: res.remainingStaging.length,
    };
  }

  extract(voluntary: boolean): ExtractResult | null {
    if (!this.run || this.run.extract) return this.run?.extract ?? null;
    const kind = decideExtract(this.run, voluntary);
    const result = settleExtract(kind, this.basket);
    const unpack = KitchenManager.receiveExtract(result.items);
    KitchenManager.spendOutingBuffs();
    const extract = { ...result, needsPick: unpack.needsPick };
    this.run = { ...this.run, ended: true, extract };
    this._cancelScheduledCheckpoint();
    if (unpack.needsPick) {
      PersistService.writeOutingCheckpoint({
        v: 1,
        kind: 'pending_unpack',
        savedAt: Date.now(),
        extract,
      } satisfies PendingUnpackCheckpoint);
    } else {
      PersistService.clearOutingCheckpoint();
    }
    const usedCells = this.basket.items.reduce((sum, it) => {
      const def = getItem(it.defId);
      return sum + def.w * def.h;
    }, 0);
    const basketCap = this.basket.cols * (this.basket.flexUnlocked ? this.basket.rows : Math.max(1, this.basket.rows - 1));
    const haulValue = result.items.reduce((s, it) => s + Math.max(0, it.sell), 0);
    const rarePlusCount = result.items.filter((it) => rarityRank(getItem(it.defId).rarity ?? 'common') > 0).length;
    analytics.trackQuestComplete(`outing_${this.run.marketId}`, 'event', {
      durationMs: Math.max(0, Date.now() - this._outingStartedAt),
      market_id: this.run.marketId,
      extract_kind: kind,
      item_count: result.items.length,
      lost: result.lost,
      voluntary,
      ...analytics.formatOutingMetrics({
        weatherId: this.run.weatherId,
        vehicleId: KitchenManager.save.vehicle,
        cookLevel: cookLevel(KitchenManager.save),
        basketCapacity: basketCap,
        basketUsedCells: usedCells,
        flexUnlocked: this.basket.flexUnlocked,
        duskExtended: this.run.duskExtended,
        haulValue,
        rarePlusCount,
        needsPick: unpack.needsPick,
      }),
    });
    this._outingStartedAt = 0;
    EventBus.emit(EV.runExtracted, extract);
    this.emit();
    return extract;
  }

  clear(): void {
    this._cancelScheduledCheckpoint();
    this.run = null;
    this.basket = createBasket(
      furnLevel(KitchenManager.save, 'basket'),
      furnLevel(KitchenManager.save, 'foam'),
    );
    this.pendingLoot = [];
    PersistService.clearOutingCheckpoint();
    this.emit();
  }

  /** 轻量防抖调度赶集断点（400ms）：严禁在高频点击/拖拽 emit() 主线程同步序列化整张地图。 */
  scheduleCheckpoint(): void {
    if (!this.run || this.run.ended) return;
    this._checkpointDirty = true;
    if (this._checkpointTimer !== null) {
      clearTimeout(this._checkpointTimer);
    }
    this._checkpointTimer = globalThis.setTimeout(() => {
      this._checkpointTimer = null;
      this._writeMarketCheckpoint();
    }, CHECKPOINT_DEBOUNCE_MS);
  }

  private _cancelScheduledCheckpoint(): void {
    this._checkpointDirty = false;
    if (this._checkpointTimer !== null) {
      clearTimeout(this._checkpointTimer);
      this._checkpointTimer = null;
    }
  }

  private _writeMarketCheckpoint(): void {
    this._cancelScheduledCheckpoint();
    if (!this.run || this.run.ended) return;
    try {
      PersistService.writeOutingCheckpoint({
        v: 1,
        kind: 'market',
        savedAt: Date.now(),
        outingStartedAt: this._outingStartedAt || Date.now(),
        rngSeed: this._rngSeed,
        rngCalls: this._rngCalls,
        tutorialAllowedCardId: TutorialManager.allowedCardId || undefined,
        run: this.run,
        basket: this.basket,
        pendingLoot: this.pendingLoot,
      } satisfies MarketOutingCheckpoint);
    } catch (e) {
      console.warn('[RunManager] 赶集断点写入失败:', e);
    }
  }

  /** 立即将当前赶集状态写入本地断点并同步刷盘（供 onHide、onMemoryWarning、pagehide 紧急落盘调用）。 */
  flushCheckpoint(): void {
    this._writeMarketCheckpoint();
    PersistService.flushAllSync();
  }

  /** 特色货车集市每次抓中鲜货或推进轮次时实时暂存断点。 */
  saveSpecialCheckpoint(marketId: SpecialMarketId, round: number, haul: ExtractedItem[]): void {
    try {
      PersistService.writeOutingCheckpoint({
        v: 1,
        kind: 'special',
        savedAt: Date.now(),
        marketId,
        round,
        haul: haul.slice(),
      } satisfies SpecialOutingCheckpoint);
    } catch (e) {
      console.warn('[RunManager] 特色集市断点写入失败:', e);
    }
  }

  settleSpecialCheckpoint(extract: ExtractResult): void {
    if (extract.needsPick) {
      PersistService.writeOutingCheckpoint({
        v: 1,
        kind: 'pending_unpack',
        savedAt: Date.now(),
        extract,
      } satisfies PendingUnpackCheckpoint);
    } else {
      PersistService.clearOutingCheckpoint();
    }
  }

  /** 冷启动时检查未结算赶集断点：支持常规菜场无损续接现场、特色集市/溢出暂存自动补发入冰箱。 */
  prepareBootRecovery(): BootRecoveryAction {
    const cp = PersistService.readOutingCheckpoint<OutingCheckpointData>();
    if (!cp || cp.v !== 1) return { type: 'none' };

    const expired = typeof cp.savedAt === 'number' && Date.now() - cp.savedAt > CHECKPOINT_MAX_AGE_MS;

    const deliverToFridge = (items: ExtractedItem[]): BootRecoveryAction => {
      const clean = items.filter((it) => it && it.quality !== 'rotten' && !!it.defId);
      PersistService.clearOutingCheckpoint();
      if (clean.length === 0) return { type: 'none' };
      const next = ingestExtract(SaveManager.data, clean);
      SaveManager.replace(next);
      return {
        type: 'kitchen_toast',
        count: clean.length,
        message: `上次赶集手边的 ${clean.length} 件鲜货已帮你护送回家！`,
      };
    };

    try {
      if (cp.kind === 'special') {
        return deliverToFridge(Array.isArray(cp.haul) ? cp.haul : []);
      }

      if (cp.kind === 'pending_unpack') {
        KitchenManager.spendOutingBuffs();
        return deliverToFridge(Array.isArray(cp.extract?.items) ? cp.extract.items : []);
      }

      if (cp.kind === 'market') {
        if (!cp.run || !cp.run.map || !cp.basket || !Array.isArray(cp.basket.items)) {
          PersistService.clearOutingCheckpoint();
          return { type: 'none' };
        }
        this._advanceUidSeqPastCheckpoint(cp);

        const collectCheckpointLoot = (): ExtractedItem[] => {
          const all: Array<Pick<BasketItem, 'uid' | 'defId' | 'quality' | 'inspected' | 'freshness'>> = [
            ...cp.basket.items,
            ...(Array.isArray(cp.pendingLoot) ? cp.pendingLoot : []),
          ];
          const seen = new Set<string>();
          const out: ExtractedItem[] = [];
          for (const it of all) {
            if (!it || !it.defId || it.quality === 'rotten' || seen.has(it.uid)) continue;
            seen.add(it.uid);
            out.push({
              uid: it.uid,
              defId: it.defId,
              quality: it.quality,
              inspected: !!it.inspected,
              freshness: Number.isFinite(it.freshness) ? it.freshness : 1,
              name: displayName(it.defId, !!it.inspected, it.quality),
              sell: sellPrice(it.defId, it.quality, !!it.inspected, Number.isFinite(it.freshness) ? it.freshness : 1),
            });
          }
          return out;
        };

        if (expired || cp.run.ended) {
          return deliverToFridge(collectCheckpointLoot());
        }

        // 兼容新手引导前几步的 _reconcile 机制：若仍在主线出门引导阶段，不强行跳离厨房引导流，改为补发已捡食材并按需退还体力
        const tutStep = SaveManager.data.tutorialStep;
        const inEarlyTutorial = !CloudSyncManager.accountTutorialCompleted
          && typeof tutStep === 'number'
          && tutStep > 0
          && tutStep < TutorialStep.HINT_DOOR;
        if (inEarlyTutorial) {
          const loot = collectCheckpointLoot();
          PersistService.clearOutingCheckpoint();
          if (tutStep <= TutorialStep.TAKE_LOOT) {
            KitchenManager.refundStamina(getMarket(cp.run.marketId).staminaCost);
          }
          if (loot.length > 0) {
            SaveManager.replace(ingestExtract(SaveManager.data, loot));
            return {
              type: 'kitchen_toast',
              count: loot.length,
              message: `上次赶集手边的 ${loot.length} 件鲜货已帮你护送回家！`,
            };
          }
          return { type: 'none' };
        }

        const fallbackSeed = ((cp.run.seed ?? 1) ^ 0x5BF03635) >>> 0;
        this._initRng(cp.rngSeed || fallbackSeed, cp.rngCalls || 0);
        this.run = cp.run;
        this.basket = cp.basket;
        this.pendingLoot = Array.isArray(cp.pendingLoot) ? cp.pendingLoot : [];
        this._outingStartedAt = cp.outingStartedAt || Date.now();
        if (cp.tutorialAllowedCardId) {
          TutorialManager.setAllowedCardId(cp.tutorialAllowedCardId);
        }
        const lootCount = this.basket.items.filter((it) => it.quality !== 'rotten').length + this.pendingLoot.length;
        return {
          type: 'resume_market',
          marketId: cp.run.marketId,
          lootCount,
        };
      }
    } catch (e) {
      console.warn('[RunManager] 恢复赶集断点异常，已安全清理:', e);
      PersistService.clearOutingCheckpoint();
    }
    return { type: 'none' };
  }

  /** 恢复赶集现场进入 MarketScene 后复查天色/街尾结算状态。 */
  recheckAfterRestore(): void {
    if (!this.run || this.run.ended) return;
    this.checkDayEnd();
  }

  private _advanceUidSeqPastCheckpoint(cp: MarketOutingCheckpoint): void {
    let maxSeq = 0;
    for (const it of cp.basket.items) maxSeq = Math.max(maxSeq, parseUidCounter(it?.uid));
    for (const it of cp.pendingLoot ?? []) maxSeq = Math.max(maxSeq, parseUidCounter(it?.uid));
    for (const list of Object.values(cp.run.piles ?? {})) {
      for (const it of list ?? []) maxSeq = Math.max(maxSeq, parseUidCounter(it?.uid));
    }
    for (const spot of cp.run.play?.spots ?? []) {
      maxSeq = Math.max(maxSeq, parseUidCounter(spot?.uid));
    }
    for (const it of SaveManager.data.fridge ?? []) {
      maxSeq = Math.max(maxSeq, parseUidCounter(it?.uid));
    }
    if (maxSeq <= 0) return;
    const cap = Math.min(maxSeq, 50000);
    while (parseUidCounter(nextUid('r')) < cap) {
      // 推进自增序列，避免续玩新抽出的食材与篮内已有 uid 碰撞
    }
  }

  labelFor(item: PileItem): string {
    const defId = item.inspected ? item.defId : visibleDefId(item);
    if (!item.revealed) return '？';
    return displayName(defId, item.inspected, item.quality);
  }

  private _revealGodPick(uid: string, quiet = false): void {
    const item = this.findPile(uid);
    if (!item || item.defId !== GOD_PICK.id || item.inspected) return;
    this.patchPile(uid, { inspected: true });
    KitchenManager.discoverFood(GOD_PICK.id, undefined, this.run?.marketId);
    if (!quiet) Platform.showToast('原来是野生大黄鱼', 'success');
  }

  private findPile(uid: string): PileItem | undefined {
    if (!this.run) return undefined;
    for (const list of Object.values(this.run.piles)) {
      const found = list.find((it) => it.uid === uid && !it.washed);
      if (found) return found;
    }
    return undefined;
  }

  private patchPile(uid: string, patch: Partial<PileItem>): void {
    if (!this.run) return;
    const piles = { ...this.run.piles };
    Object.keys(piles).forEach((nid) => {
      piles[nid] = piles[nid].map((it) => (it.uid === uid ? { ...it, ...patch } : it));
    });
    this.run = { ...this.run, piles };
  }

  private removeFromPile(uid: string): void {
    if (!this.run) return;
    const piles = { ...this.run.piles };
    Object.keys(piles).forEach((nid) => {
      piles[nid] = piles[nid].filter((it) => it.uid !== uid);
    });
    this.run = { ...this.run, piles };
  }

  private _pushTray(item: BasketItem): void {
    const loot: OutingLoot = {
      uid: item.uid,
      defId: item.defId,
      quality: item.quality,
      inspected: item.inspected,
      freshness: item.freshness,
    };
    this.pendingLoot = [...this.pendingLoot.filter((it) => it.uid !== loot.uid), loot];
  }

  private _applyDrop(result: DropResult): string | null {
    if (!result.ok) return result.reason;
    this.basket = result.state;
    for (const item of result.evicted) this._pushTray(item);
    return null;
  }

  private _finishDrop(result: DropResult): string | null {
    const err = this._applyDrop(result);
    if (err) return err;
    this.emit();
    return null;
  }

  private emit(): void {
    this._emitting = true;
    try {
      if (this.run && !this.run.ended) {
        this.scheduleCheckpoint();
      }
      EventBus.emit(EV.runChanged, this.run, this.basket);
      EventBus.emit(EV.basketChanged, this.basket);
    } finally {
      this._emitting = false;
    }
  }
}

export const RunManager = new RunManagerClass();
