import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import {
  cardBlock,
  createBasket,
  createRun,
  displayName,
  decideExtract,
  freebieToBasketDraft,
  hasGodPick,
  isMysteryCard,
  mulberry32,
  newSeed,
  nodeFee,
  rngPick,
  shapeLabel,
  pileToBasketDraft,
  place,
  removeItem,
  tryRelocate,
  rollFreebie,
  settleExtract,
  eventVoice,
  remainingMarketRecipes,
  recipeById,
  recipeUnlockView,
  unlockedIngredients,
  cookLevel,
  GOD_PICK,
  stallPacked,
  tryAutoPlace,
  visibleDefId,
  furnLevel,
  type BasketItem,
  type BasketState,
  type ExtractResult,
  type MapNode,
  type PileItem,
  type Rng,
  type RunEventLog,
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
      left: node.stall ? (run.piles[id] ?? []).filter((it) => !it.washed).length : 0,
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

    const favored = !!node.stall && run.freePass;
    let next: RunState = {
      ...run,
      stepsLeft: Math.max(0, run.stepsLeft - node.steps),
      atNodeId: id,
      options: node.next.slice(),
      visited: [...run.visited, id],
      freePass: favored ? false : run.freePass,
    };

    if (node.stall) {
      this.run = {
        ...next,
        mode: 'rummage',
        currentNodeId: id,
        paid: next.paid.includes(id) ? next.paid : [...next.paid, id],
        slowNodes: favored ? [...next.slowNodes, id] : next.slowNodes,
        note: '摊上还剩一堆，慢慢翻。',
      };
      if (fee > 0) Platform.showToast(`买下这摊剩货 ${fee} 金币`);
      else if (favored) Platform.showToast('街坊打过招呼，这摊白翻，老板也不急');
      else Platform.showToast('街坊情分，这摊剩的给你翻');
      this.emit();
      return;
    }

    next = this.resolveEvent(next, node);
    this.run = next;
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
    this.run = { ...this.run, mode: 'map', currentNodeId: null, note: '出了摊，接着挑路。' };
    this.emit();
    this.checkDayEnd();
  }

  /** 事件结算只写进 state，话由弹窗去说，别再叠 toast。 */
  private resolveEvent(state: RunState, node: MapNode): RunState {
    const log = (text: string, gain: RunEventLog['gain'] = null): RunEventLog => ({
      nodeId: node.id,
      kind: node.kind,
      marketId: state.marketId,
      text,
      gain,
    });
    const voice = (): string => {
      const lines = eventVoice(state.marketId, node.kind)?.lines;
      return lines?.length ? rngPick(this._rng, lines) : '';
    };

    switch (node.kind) {
      case 'freebie': {
        const { defId, quality } = rollFreebie(
          this._rng,
          state.marketId,
          cookLevel(KitchenManager.save),
          this._wanted(),
        );
        const name = displayName(defId, false, quality);
        const placed = tryAutoPlace(this.basket, freebieToBasketDraft(defId, quality));
        if (!placed) {
          const draft = freebieToBasketDraft(defId, quality);
          this.pendingLoot = [...this.pendingLoot, draft];
          return {
            ...state,
            note: '地上有货，可篮子塞不下。',
            lastEvent: log('篮子满了，先腾个位子再捡。', { defId, quality, taken: false }),
          };
        }
        this.basket = { ...this.basket, items: [...this.basket.items, placed] };
        return {
          ...state,
          note: `地上捡到一份${name}。`,
          lastEvent: log('摊主收筐时漏下的，还新鲜着，捡回去。', { defId, quality, taken: true }),
        };
      }
      case 'deadend':
        return { ...state, note: '死胡同，天色白耗了一步。', lastEvent: log(voice()) };
      case 'empty':
        return {
          ...state,
          peeked: [...state.peeked, ...node.next],
          note: '摊上收干净了，倒是看清了前面的路。',
          lastEvent: log(voice()),
        };
      case 'favor':
        return {
          ...state,
          freePass: true,
          note: '街坊打了招呼，下一摊白翻，老板还慢慢收。',
          lastEvent: log(voice()),
        };
      case 'fork':
        return { ...state, note: '路分成两条，这一步没耗天色。' };
      case 'recipe': {
        const left = remainingMarketRecipes(state.marketId, KitchenManager.save.recipesFound);
        const id = left.length ? rngPick(this._rng, left) : null;
        if (!id) {
          return { ...state, note: '纸上的字看不清了。', lastEvent: log('油纸湿透了，字认不出来。') };
        }
        KitchenManager.findRecipe(id);
        const name = recipeById(id)?.name ?? '一道菜';
        return {
          ...state,
          note: `记下了「${name}」。`,
          lastEvent: log(`${voice()}\n记下了：${name}`),
        };
      }
      default:
        return state;
    }
  }

  /** 天黑被赶出来是 messy，逛到街尾从容回家算 safe。 */
  private checkDayEnd(): void {
    const run = this.run;
    if (!run || run.ended || run.mode === 'rummage') return;
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
    if (item.quality === 'rotten') {
      this.removeFromPile(uid);
      this.emit();
      return 'rotten';
    }
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
    const result = tryRelocate(this.basket, uid, x, y, rot);
    if (!result.ok) return result.reason;
    this.basket = result.state;
    this.emit();
    return null;
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
      if (seen.has(it.uid)) continue;
      seen.add(it.uid);
      out.push(pileToBasketDraft(it));
    }
    return out;
  }

  dropStagingToCell(uid: string, x: number, y: number, rot: 0 | 1 = 0): string | null {
    const pile = this.findPile(uid);
    if (pile?.quality === 'rotten') {
      this.removeFromPile(uid);
      this.emit();
      return '坏了，丢掉';
    }
    this._revealGodPick(uid);
    const loot = this.stagingItems().find((it) => it.uid === uid);
    if (!loot) return '已经不在手里';
    const err = this.tryManualPlace({
      ...loot,
      x,
      y,
      rot,
      pinned: false,
      dampened: false,
    });
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
    if (pile.quality === 'rotten') {
      this.removeFromPile(uid);
      this.emit();
      return '坏了，丢掉';
    }
    this._revealGodPick(uid);
    const base = pileToBasketDraft(this.findPile(uid) ?? { ...pile, inspected: true });
    const tryRot = (r: 0 | 1): string | null => {
      return this.tryManualPlace({
        ...base,
        x,
        y,
        rot: r,
        pinned: false,
        dampened: false,
      });
    };
    let err = tryRot(rot);
    if (err) err = tryRot(rot === 0 ? 1 : 0);
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
    const shape = shapeLabel(defId);
    if (!item.revealed) return `？  ${shape}`;
    return `${displayName(defId, item.inspected, item.quality)}  ${shape}`;
  }

  private _revealGodPick(uid: string, quiet = false): void {
    const item = this.findPile(uid);
    if (!item || item.defId !== GOD_PICK.id || item.inspected) return;
    this.patchPile(uid, { inspected: true });
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

  private emit(): void {
    EventBus.emit(EV.runChanged, this.run, this.basket);
    EventBus.emit(EV.basketChanged, this.basket);
  }
}

export const RunManager = new RunManagerClass();
