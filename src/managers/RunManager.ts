import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import {
  applyEncounter,
  cardBlock,
  createBasket,
  createRun,
  displayName,
  decideExtract,
  freebieToBasketDraft,
  hasGodPick,
  isMysteryCard,
  isRummageNode,
  mulberry32,
  newSeed,
  nextUid,
  nodeEncounter,
  nodeFee,
  rngInt,
  rngPick,
  rollGatherSpot,
  pileToBasketDraft,
  place,
  removeItem,
  resumeScenes,
  tryDrop,
  tryRotateItem,
  rollFreebie,
  settleExtract,
  eventVoice,
  MARKET_RECIPE_POOL,
  remainingMarketRecipes,
  recipeUnlockView,
  unlockedIngredients,
  cookLevel,
  GOD_PICK,
  stallPacked,
  talkScript,
  pickTalkFood,
  tryAutoPlace,
  visibleDefId,
  furnLevel,
  type BasketItem,
  type BasketState,
  type ExtractResult,
  type GatherSpot,
  type MapNode,
  type PileItem,
  type Quality,
  type Rng,
  type RunEventLog,
  type DropResult,
  type RunState,
} from '@/sim';
import { KitchenManager } from './KitchenManager';
import type { MarketId } from '@/sim';
import { Platform } from '@/core/PlatformService';

/** 路线页一张卡要显示的全部信息。 */
export interface RouteOption {
  node: MapNode;
  /** 明牌了没。没明牌只画背面。 */
  revealed: boolean;
  /** 进不去的理由，null 表示能点 */
  blocked: string | null;
  fee: number;
  left: number;
}

export type OutingLoot = Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened' | 'broken'>;

class RunManagerClass {
  run: RunState | null = null;
  basket: BasketState = createBasket(0);
  pendingLoot: OutingLoot[] = [];
  interacting = false;
  private _rng: Rng = mulberry32(1);

  /** 摊上抽货时给「手里菜谱用得上的食材」加权，货才跟得上进度。 */
  private _wanted(): Set<string> {
    return unlockedIngredients(recipeUnlockView(KitchenManager.save));
  }

  start(marketId: MarketId = 'xiangko'): boolean {
    if (!KitchenManager.startRun()) return false;
    const seed = newSeed();
    this._rng = mulberry32((seed ^ 0x5BF03635) >>> 0);
    this.run = createRun({
      allowGodPick: KitchenManager.allowGodPickToday(),
      marketId,
      seed,
      cookLevel: cookLevel(KitchenManager.save),
      allowRecipe: remainingMarketRecipes(marketId, KitchenManager.save.recipesFound).length > 0,
      forceRecipe: remainingMarketRecipes(marketId, KitchenManager.save.recipesFound).length
        === MARKET_RECIPE_POOL[marketId].length,
      wanted: this._wanted(),
    });
    if (hasGodPick(this.run)) KitchenManager.markGodPickToday();
    this.basket = createBasket(
      furnLevel(KitchenManager.save, 'basket'),
      furnLevel(KitchenManager.save, 'foam'),
    );
    this.pendingLoot = [];
    this.emit();
    return true;
  }

  abortUnused(): void {
    this.run = null;
    KitchenManager.refundStamina();
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
    return {
      node,
      revealed:
        !isMysteryCard(node.kind)
        || run.peeked.includes(id)
        || KitchenManager.cardSeen(run.marketId, node.kind),
      blocked: cardBlock(run, node, KitchenManager.save.money, KitchenManager.save.level, ahead),
      fee: nodeFee(run, node),
      left: isRummageNode(node) ? (run.piles[id] ?? []).filter((it) => !it.washed).length : 0,
    };
  }

  stepsLabel(): string {
    if (!this.run) return '天色';
    return `${this.run.stepsLeft}/${this.run.stepsMax}`;
  }

  enterNode(id: string): void {
    const run = this.run;
    if (!run || run.ended || run.mode !== 'map') return;
    if (!run.options.includes(id)) return;
    const node = run.map.nodes[id];
    const block = cardBlock(run, node, KitchenManager.save.money, KitchenManager.save.level);
    if (block) {
      Platform.showToast(block);
      return;
    }

    const fee = nodeFee(run, node);
    if (fee > 0 && !KitchenManager.trySpend(fee)) return;
    KitchenManager.markCardSeen(run.marketId, node.kind);

    const rummage = isRummageNode(node);
    const favored = rummage && run.freePass;
    let next: RunState = {
      ...run,
      stepsLeft: Math.max(0, run.stepsLeft - node.steps),
      atNodeId: id,
      options: node.next.slice(),
      visited: [...run.visited, id],
      freePass: favored ? false : run.freePass,
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
        note: next.note || '摊上还剩一堆，慢慢翻。',
      };
      if (fee > 0) Platform.showToast(`买下这摊剩货 ${fee} 金币`);
      else if (favored) Platform.showToast('街坊打过招呼，这摊白翻，老板也不急');
      else Platform.showToast('街坊情分，这摊剩的给你翻');
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

    if (nodeEncounter(node).type === 'freebie') {
      next = this._takeFreebie(next, node);
    }

    this.run = resumeScenes(next);
    this.emit();
    this.checkDayEnd();
  }

  /** 整层的卡全进不去（常见是钱不够又碰上整层摊位）。得留条路，不然卡死。 */
  allBlocked(): boolean {
    const run = this.run;
    if (!run || run.ended || run.mode !== 'map' || !run.options.length) return false;
    return this.options().every((opt) => !!opt.blocked);
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
    const placed = tryAutoPlace(this.basket, freebieToBasketDraft(spot.defId, quality));
    const taken = !!placed;
    if (placed) this.basket = { ...this.basket, items: [...this.basket.items, placed] };
    else this.pendingLoot = [...this.pendingLoot, freebieToBasketDraft(spot.defId, quality)];

    const spots = play.spots.map((s) => (s.uid === uid ? { ...s, taken: true } : s));
    const picksLeft = play.picksLeft - 1;
    this.run = {
      ...run,
      play: { ...play, spots, picksLeft },
      lastEvent: {
        nodeId: play.nodeId,
        kind: 'gather',
        marketId: run.marketId,
        text: taken ? `拿到${displayName(spot.defId, false, quality)}。` : '篮子满了，先腾个位子。',
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
      return { ...spot, firstSeen: KitchenManager.discoverFood(spot.defId) };
    });
  }

  private _takeFreebie(state: RunState, node: MapNode): RunState {
    const { defId, quality } = rollFreebie(
      this._rng,
      state.marketId,
      cookLevel(KitchenManager.save),
      this._wanted(),
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
    const placed = tryAutoPlace(this.basket, freebieToBasketDraft(defId, quality));
    if (!placed) {
      this.pendingLoot = [...this.pendingLoot, freebieToBasketDraft(defId, quality)];
      return {
        ...state,
        note: '地上有货，可篮子塞不下。',
        lastEvent: {
          nodeId,
          kind,
          marketId: state.marketId,
          text: '篮子满了，先腾个位子再捡。',
          gain: { defId, quality, taken: false, firstSeen: KitchenManager.discoverFood(defId, quality) },
        },
      };
    }
    this.basket = { ...this.basket, items: [...this.basket.items, placed] };
    return {
      ...state,
      note: `拿到一份${name}。`,
      lastEvent: {
        nodeId,
        kind,
        marketId: state.marketId,
        text,
        gain: { defId, quality, taken: true, firstSeen: KitchenManager.discoverFood(defId, quality) },
      },
    };
  }

  /** 天黑被赶出来是 messy，逛到街尾从容回家算 safe。 */
  private checkDayEnd(): void {
    const run = this.run;
    if (!run || run.ended || run.mode === 'rummage' || run.mode === 'play') return;
    if (run.stepsLeft <= 0) {
      Platform.showToast('天黑了，收摊');
      this.extract(false);
      return;
    }
    if (run.options.length === 0) {
      Platform.showToast('逛到街尾了，回家');
      this.extract(true);
    }
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
      firstSeen: KitchenManager.discoverFood(visibleDefId(item), item.quality),
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
    const placed = tryAutoPlace(this.basket, draft);
    if (!placed) return 'need_space';
    this.basket = { ...this.basket, items: [...this.basket.items, placed] };
    this.removeFromPile(uid);
    this.emit();
    return 'placed';
  }

  tryManualPlace(item: BasketItem): string | null {
    const result = place(this.basket, item);
    if (!result.ok) return result.reason;
    this.basket = result.state;
    this.emit();
    return null;
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

  extract(voluntary: boolean): ExtractResult | null {
    if (!this.run || this.run.extract) return this.run?.extract ?? null;
    const kind = decideExtract(this.run, voluntary);
    const result = settleExtract(kind, this.basket);
    const unpack = KitchenManager.receiveExtract(result.items);
    const extract = { ...result, needsPick: unpack.needsPick };
    this.run = { ...this.run, ended: true, extract };
    EventBus.emit(EV.runExtracted, extract);
    this.emit();
    return extract;
  }

  clear(): void {
    this.run = null;
    this.basket = createBasket(
      furnLevel(KitchenManager.save, 'basket'),
      furnLevel(KitchenManager.save, 'foam'),
    );
    this.pendingLoot = [];
    this.emit();
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
    KitchenManager.discoverFood(GOD_PICK.id);
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
    if (result.evicted) this._pushTray(result.evicted);
    return null;
  }

  private _finishDrop(result: DropResult): string | null {
    const err = this._applyDrop(result);
    if (err) return err;
    this.emit();
    return null;
  }

  private emit(): void {
    EventBus.emit(EV.runChanged, this.run, this.basket);
    EventBus.emit(EV.basketChanged, this.basket);
  }
}

export const RunManager = new RunManagerClass();
