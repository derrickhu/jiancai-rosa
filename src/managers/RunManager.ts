import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import {
  createBasket,
  createRun,
  displayName,
  decideExtract,
  shapeLabel,
  pileToBasketDraft,
  place,
  removeItem,
  settleExtract,
  stallPacked,
  STALL_FEE,
  PACK_FULL,
  tickRun,
  tryAutoPlace,
  visibleDefId,
  furnLevel,
  type BasketItem,
  type BasketState,
  type ExtractResult,
  type PileItem,
  type RunState,
  type StallId,
} from '@/sim';
import { KitchenManager } from './KitchenManager';
import type { MarketId } from '@/sim';
import { Platform } from '@/core/PlatformService';

class RunManagerClass {
  run: RunState | null = null;
  basket: BasketState = createBasket(0);
  interacting = false;

  start(marketId: MarketId = 'xiangko'): boolean {
    if (!KitchenManager.startRun()) return false;
    this.run = createRun({
      allowGodPick: KitchenManager.allowGodPickToday(),
      marketId,
    });
    if (this.run.piles.fish.some((it) => it.defId === 'wild_yellowfish')) {
      KitchenManager.markGodPickToday();
    }
    this.basket = createBasket(furnLevel(KitchenManager.save, 'basket'));
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

  tick(dt: number): void {
    if (!this.run || this.run.ended) return;
    const prevSec = Math.ceil(this.run.timeLeft);
    const prevPack = this.run.currentStall ? Math.floor(this.run.packing[this.run.currentStall]) : 0;
    const prevLeft = countGround(this.run);
    this.run = tickRun(this.run, dt, this.interacting);
    const nextPack = this.run.currentStall ? Math.floor(this.run.packing[this.run.currentStall]) : 0;
    if (this.run.currentStall && prevPack < PACK_FULL && nextPack >= PACK_FULL) {
      Platform.showToast('这摊剩的装上车了');
    }
    const dirty =
      this.run.ended
      || Math.ceil(this.run.timeLeft) !== prevSec
      || nextPack !== prevPack
      || countGround(this.run) !== prevLeft;
    if (this.run.ended) {
      this.emit();
      this.extract(false);
      return;
    }
    if (dirty) this.emit();
  }

  openStall(id: StallId): void {
    if (!this.run || this.run.ended) return;
    if (stallPacked(this.run.packing, id)) {
      Platform.showToast('这摊已经装走了');
      return;
    }
    if (!this.run.paid.includes(id)) {
      const fee = this.run.paid.length === 0 ? 0 : STALL_FEE[id];
      if (!KitchenManager.trySpend(fee)) return;
      this.run = { ...this.run, paid: [...this.run.paid, id] };
      if (fee > 0) Platform.showToast(`买下这摊剩货 ${fee} 金币`);
      else Platform.showToast('街坊情分，这摊剩的给你翻');
    }
    this.run = { ...this.run, mode: 'rummage', currentStall: id };
    this.emit();
  }

  backToOverview(): void {
    if (!this.run || this.run.ended) return;
    this.run = { ...this.run, mode: 'overview', currentStall: null };
    this.emit();
  }

  currentPile(): PileItem[] {
    if (!this.run?.currentStall) return [];
    return this.run.piles[this.run.currentStall].filter((it) => !it.washed && it.drawn);
  }

  crateLeft(): PileItem[] {
    if (!this.run?.currentStall) return [];
    return this.run.piles[this.run.currentStall].filter((it) => !it.washed && !it.drawn);
  }

  drawFromCrate(uid?: string): PileItem | null {
    if (!this.run?.currentStall) return null;
    const crate = this.crateLeft();
    if (!crate.length) {
      Platform.showToast('筐里空了');
      return null;
    }
    const item = uid ? crate.find((it) => it.uid === uid) ?? crate[Math.floor(Math.random() * crate.length)] : crate[Math.floor(Math.random() * crate.length)];
    this.patchPile(item.uid, { drawn: true, revealed: true });
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

  take(uid: string): 'placed' | 'need_space' | 'gone' | 'rotten' {
    if (!this.run) return 'gone';
    const item = this.findPile(uid);
    if (!item || !item.revealed || item.washed) return 'gone';
    if (item.quality === 'rotten') {
      this.removeFromPile(uid);
      this.emit();
      return 'rotten';
    }
    const draft = pileToBasketDraft(item);
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

  dropFromPileToCell(uid: string, x: number, y: number, rot: 0 | 1 = 0): string | null {
    if (!this.run) return '不在局内';
    const pile = this.findPile(uid);
    if (!pile) return '已经不在堆里';
    const base = pileToBasketDraft(pile);
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
    this.basket = createBasket(furnLevel(KitchenManager.save, 'basket'));
    this.emit();
  }

  labelFor(item: PileItem): string {
    const defId = item.inspected ? item.defId : visibleDefId(item);
    const shape = shapeLabel(defId);
    if (!item.revealed) return `？  ${shape}`;
    if (!item.inspected) return `${displayName(defId, false, item.quality)}  ${shape}  ？`;
    return `${displayName(item.defId, true, item.quality)}  ${shape}`;
  }

  private findPile(uid: string): PileItem | undefined {
    if (!this.run) return undefined;
    for (const stall of Object.values(this.run.piles)) {
      const found = stall.find((it) => it.uid === uid && !it.washed);
      if (found) return found;
    }
    return undefined;
  }

  private patchPile(uid: string, patch: Partial<PileItem>): void {
    if (!this.run) return;
    const piles = { ...this.run.piles };
    (Object.keys(piles) as StallId[]).forEach((sid) => {
      piles[sid] = piles[sid].map((it) => (it.uid === uid ? { ...it, ...patch } : it));
    });
    this.run = { ...this.run, piles };
  }

  private removeFromPile(uid: string): void {
    if (!this.run) return;
    const piles = { ...this.run.piles };
    (Object.keys(piles) as StallId[]).forEach((sid) => {
      piles[sid] = piles[sid].filter((it) => it.uid !== uid);
    });
    this.run = { ...this.run, piles };
  }

  private emit(): void {
    EventBus.emit(EV.runChanged, this.run, this.basket);
    EventBus.emit(EV.basketChanged, this.basket);
  }
}

export const RunManager = new RunManagerClass();

function countGround(run: RunState): number {
  return (Object.values(run.piles) as PileItem[][]).reduce(
    (n, list) => n + list.filter((it) => !it.washed).length,
    0,
  );
}
