import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Platform } from '@/core/PlatformService';
import { EV } from '@/config/events';
import { SaveManager } from './SaveManager';
import {
  RECIPES,
  recipeById,
  recipesGainedByCook,
  recipesGainedByTable,
  SHARE_IMAGE_URLS,
  SHARE_STAMINA_TITLES,
  STAMINA_SHARE_GAIN,
  addStamina,
  staminaMax,
  buyFurnUpgrade,
  buyHouseUpgrade,
  applyNeighborReward,
  cookRecipe,
  eatDish,
  sellFridgeQty,
  COOK_LEVEL_MAX,
  clampCookLevel,
  defaultSave,
  fridgeAcceptsOuting,
  fridgeCanFit,
  fridgeOwnCap,
  fridgeRoom,
  fridgeSlotsNeeded,
  fridgeUnpackNeed,
  type FridgeDraft,
  furnLevel,
  grantCookXp,
  houseLevel,
  ingestExtract,
  noteDex,
  noteMarketFood,
  discoverFood,
  regenStamina,
  sellItems,
  selectVehicle,
  spendStamina,
  buyVehicle as purchaseVehicle,
  todayKey,
  msUntilLocalMidnight,
  canVisitSpecial as saveCanVisitSpecial,
  markSpecialVisit as saveMarkSpecialVisit,
  specialVisitCount as saveSpecialVisitCount,
  recipeUnlockView,
  type KitchenSave,
  type RecipeId,
} from '@/sim/kitchen';
import {
  NEIGHBOR_COOLDOWN,
  NEIGHBOR_OFFER_CHANCE,
  NEIGHBOR_ORDER_MAX,
  expiredNeighborOrders,
  liveNeighborOrders,
  makeNeighborOrder,
  neighborNpc,
  neighborOfferReady,
  neighborOfferRng,
  neighborOrderBonus,
  rollNeighborOffer,
  type NeighborOfferDraft,
  type NeighborOrder,
} from '@/sim/neighborOrders';
import { getSpecialMarket, type SpecialMarketId } from '@/sim/specialMarkets';
import { bagDryCols, bagRows, foamWetCols, foamWetRows } from '@/sim/basket';
import { furnLabel, houseLabel, type FurnId } from '@/sim/kitchenLayout';
import type { CardKind } from '@/sim/marketEvents';
import type { MarketId } from '@/sim/destinations';
import { vehicleById, type VehicleId } from '@/sim/vehicles';
import type { ExtractedItem } from '@/sim/run';
import type { Quality } from '@/sim/items';

export interface CookLevelUp {
  from: number;
  to: number;
  recipes: RecipeId[];
}

class KitchenManagerClass {
  private _cookFx: { xp: number; levels: number } | null = null;
  private _unlockQueue: RecipeId[] = [];
  private _levelUps: CookLevelUp[] = [];
  private _dayKey = todayKey();
  private _dayTimer: ReturnType<typeof setTimeout> | null = null;
  private _visitOfferDone = false;
  private _nudgeOffer = false;
  private _sharePending = false;
  private _shareAt = 0;
  pendingHaul: ExtractedItem[] | null = null;
  pendingOffer: NeighborOfferDraft | null = null;

  constructor() {
    this._armDayRollover();
    this._bindShare();
  }

  private _bindShare(): void {
    Platform.bindShareMenu(() => this._shareTitle(), () => this._shareImage());
    Platform.onShow(() => this.claimShareStamina());
  }

  private _shareTitle(): string {
    const titles = SHARE_STAMINA_TITLES;
    return titles[Math.floor(Math.random() * titles.length)] ?? '快来，来菜场捡菜，捡捡捡！';
  }

  private _shareImage(): string {
    const images = SHARE_IMAGE_URLS;
    return images[Math.floor(Math.random() * images.length)] ?? 'boot/share_market_g.jpg';
  }

  /** 本地 0 点换日：特殊市场看广告次数当场清零。 */
  private _armDayRollover(): void {
    if (this._dayTimer) clearTimeout(this._dayTimer);
    this._dayTimer = setTimeout(() => {
      const key = todayKey();
      if (key !== this._dayKey) {
        this._dayKey = key;
        this.emit();
      }
      this._armDayRollover();
    }, msUntilLocalMidnight());
  }

  get save(): KitchenSave {
    return SaveManager.data;
  }

  consumeCookFx(): { xp: number; levels: number } | null {
    const fx = this._cookFx;
    this._cookFx = null;
    return fx;
  }

  emit(): void {
    EventBus.emit(EV.kitchenChanged, this.save);
  }

  canGoMarket(): boolean {
    return regenNow().stamina > 0;
  }

  startRun(): boolean {
    const { save, error } = spendStamina(this.save);
    if (error) {
      Platform.showToast(error);
      return false;
    }
    SaveManager.replace(save);
    this.emit();
    return true;
  }

  refundStamina(): void {
    SaveManager.replace(addStamina(this.save, 1));
    this.emit();
  }

  /** 没体力时弹转发；朋友圈/会话回来再加体力。微信没有可靠的转发成功回调。 */
  async offerShareStamina(): Promise<void> {
    const now = regenNow();
    if (now.stamina >= staminaMax(now)) {
      Platform.showToast('体力已经满了');
      return;
    }
    const ok = await Platform.showModal({
      title: '体力不够了',
      content: `转发给朋友，回来加 ${STAMINA_SHARE_GAIN} 点体力`,
      confirmText: '去转发',
      cancelText: '再等等',
    });
    if (!ok) return;
    this._sharePending = true;
    this._shareAt = Date.now();
    const shared = Platform.shareAppMessage({
      title: this._shareTitle(),
      imageUrl: this._shareImage(),
    });
    if (shared) return;
    if (Platform.isWechat) {
      this._sharePending = false;
      Platform.showToast('转发暂时用不了');
      return;
    }
    this.claimShareStamina(true);
  }

  claimShareStamina(force = false): void {
    if (!this._sharePending) return;
    if (!force && Date.now() - this._shareAt < 400) return;
    this._sharePending = false;
    const before = regenNow().stamina;
    if (before >= staminaMax(this.save)) {
      Platform.showToast('体力已经满了');
      return;
    }
    const save = addStamina(this.save, STAMINA_SHARE_GAIN);
    SaveManager.replace(save);
    this.emit();
    const gained = Math.max(0, save.stamina - before);
    Platform.showToast(gained > 0 ? `转发成功，体力 +${gained}` : '体力已经满了');
  }

  receiveExtract(items: ExtractedItem[]): { needsPick: boolean } {
    if (fridgeCanFit(this.save, items)) {
      this.pendingHaul = null;
      SaveManager.replace(ingestExtract(this.save, items));
      this.emit();
      return { needsPick: false };
    }
    this.pendingHaul = items;
    return { needsPick: true };
  }

  unpackNeed(): number {
    return fridgeUnpackNeed(this.save, this.pendingHaul ?? []);
  }

  commitUnpack(sellHaulUids: string[], sellFridgeUids: string[]): { error?: string; gained: number; kept: number } {
    const haul = this.pendingHaul ?? [];
    const need = this.unpackNeed();
    const picked = sellHaulUids.length + sellFridgeUids.length;
    if (picked < need) return { error: `再卖掉 ${need - picked} 件才能装下`, gained: 0, kept: 0 };
    const haulSet = new Set(sellHaulUids);
    const keep = haul.filter((it) => !haulSet.has(it.uid));
    const soldHaul = haul.filter((it) => haulSet.has(it.uid));
    const fridgeSold = sellItems(this.save, sellFridgeUids);
    if (!fridgeCanFit(fridgeSold.save, keep)) {
      return { error: '还是装不下，再卖掉几件', gained: 0, kept: 0 };
    }
    const gold = soldHaul.reduce((sum, it) => sum + it.sell, 0);
    let save = noteDex(fridgeSold.save, haul);
    save = ingestExtract({ ...save, money: save.money + gold }, keep);
    this.pendingHaul = null;
    SaveManager.replace(save);
    this.emit();
    return { gained: fridgeSold.gained + gold, kept: keep.length };
  }

  fridgeRoom(): number {
    return fridgeRoom(this.save);
  }

  fridgeAcceptsOuting(): boolean {
    return fridgeAcceptsOuting(this.save);
  }

  fridgeSlotsNeeded(items: FridgeDraft[]): number {
    return fridgeSlotsNeeded(this.save, items);
  }

  buyVehicle(id: VehicleId): boolean {
    const { save, error } = purchaseVehicle(this.save, id);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('recipe_paper');
    Platform.showToast(`${vehicleById(id).name} 买下了`, 'success');
    return true;
  }

  setVehicle(id: VehicleId): void {
    const next = selectVehicle(this.save, id);
    if (next === this.save) return;
    SaveManager.replace(next);
    this.emit();
  }

  trySpend(amount: number): boolean {
    if (amount <= 0) return true;
    if (this.save.money < amount) {
      AudioManager.play('ui_deny');
      Platform.showToast(`差 ${amount - this.save.money} 金币，先回家卖点菜`);
      return false;
    }
    SaveManager.replace({ ...this.save, money: this.save.money - amount });
    this.emit();
    AudioManager.play('coin_spend');
    return true;
  }

  eat(uid: string, qty = 1): boolean {
    const { save, error, toast, nudgeOffer } = eatDish(this.save, uid, qty);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    if (nudgeOffer) {
      this._visitOfferDone = false;
      this.pendingOffer = null;
      this._nudgeOffer = true;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('eat');
    Platform.showToast(toast ?? `吃了这道菜`, 'success');
    return true;
  }

  consumeNudgeOffer(): boolean {
    if (!this._nudgeOffer) return false;
    this._nudgeOffer = false;
    return true;
  }

  sellQty(uid: string, qty: number): boolean {
    const { save, gained, error } = sellFridgeQty(this.save, uid, qty);
    if (error || gained <= 0) {
      AudioManager.play('ui_deny');
      Platform.showToast(error ?? '这些卖不掉');
      return false;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('coin_gain');
    Platform.showToast(`卖出 ${gained} 金币`);
    return true;
  }

  sell(uids: string[]): void {
    if (!uids.length) {
      AudioManager.play('ui_deny');
      Platform.showToast('先点选冰箱里的食材');
      return;
    }
    const { save, gained } = sellItems(this.save, uids);
    SaveManager.replace(save);
    this.emit();
    if (gained > 0) {
      AudioManager.play('coin_gain');
      Platform.showToast(`卖出 ${gained} 金币`);
    } else {
      AudioManager.play('ui_deny');
      Platform.showToast('这些卖不掉');
    }
  }

  cook(recipeId: RecipeId, times = 1): void {
    this.sweepNeighborOrders();
    const fromLevel = this.save.level;
    const { save, error, xp, levels, cooked } = cookRecipe(this.save, recipeId, times);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    AudioManager.play('cook_sizzle');
    if ((xp ?? 0) > 0) this._cookFx = { xp: xp ?? 0, levels: levels ?? 0 };
    const paid = this._fulfillNeighborOrder(save, recipeId);
    SaveManager.replace(paid.save);
    this.emit();
    const name = RECIPES.find((r) => r.id === recipeId)?.name ?? '菜';
    const batch = (cooked ?? 1) > 1 ? ` ×${cooked}` : '';
    if (paid.bonus > 0) {
      AudioManager.play('coin_gain');
      let msg = `${paid.npc}要的${paid.dish}好了，多给了 ${paid.bonus} 金`;
      if (paid.foodFolded && paid.foodName) {
        msg += `。冰箱满了，${paid.foodName}折成 ${paid.foldGold} 金`;
      } else if (paid.foodName) {
        msg += `，还塞来一份${paid.foodName}`;
      }
      Platform.showToast(msg, 'success');
    } else if ((levels ?? 0) > 0) {
      this.enqueueCookLevelUp(fromLevel, paid.save.level);
    } else if ((xp ?? 0) > 0) {
      Platform.showToast(`${name}${batch} 出锅，+${xp} 经验`, 'success');
    } else {
      Platform.showToast(`${name}${batch} 出锅，放进冰箱了`, 'success');
    }
    if (paid.bonus > 0 && (levels ?? 0) > 0) {
      this.enqueueCookLevelUp(fromLevel, paid.save.level);
    }
  }

  beginKitchenVisit(): void {
    this._visitOfferDone = false;
    this.pendingOffer = null;
    this.sweepNeighborOrders();
  }

  liveNeighborOrders(now = Date.now()): NeighborOrder[] {
    return liveNeighborOrders(this.save.neighborOrders, now);
  }

  wantedNeighborRecipeIds(): Set<RecipeId> {
    return new Set(this.liveNeighborOrders().map((o) => o.recipeId));
  }

  sweepNeighborOrders(toast = true): NeighborOrder[] {
    const now = Date.now();
    const expired = expiredNeighborOrders(this.save.neighborOrders, now);
    if (!expired.length) return [];
    SaveManager.replace({
      ...this.save,
      neighborOrders: liveNeighborOrders(this.save.neighborOrders, now),
    });
    this.emit();
    if (toast) {
      for (const order of expired) {
        Platform.showToast(`${neighborNpc(order.npcId).name}不等了`);
      }
    }
    return expired;
  }

  considerNeighborOffer(): NeighborOfferDraft | null {
    this.sweepNeighborOrders();
    if (this.pendingOffer) return this.pendingOffer;
    if (this._visitOfferDone) return null;
    const now = Date.now();
    const hanging = liveNeighborOrders(this.save.neighborOrders, now);
    if (hanging.length >= NEIGHBOR_ORDER_MAX) return null;
    if (!neighborOfferReady(this.save.neighborOfferAt, now)) return null;
    this._visitOfferDone = true;
    const rng = neighborOfferRng(now);
    if (rng() >= NEIGHBOR_OFFER_CHANCE) {
      this._setOfferAt(now + NEIGHBOR_COOLDOWN.miss);
      return null;
    }
    const draft = rollNeighborOffer({
      ...recipeUnlockView(this.save),
      dexSeen: this.save.dexSeen,
      dexInspected: this.save.dexInspected,
    }, hanging, rng);
    if (!draft) {
      this._setOfferAt(now + NEIGHBOR_COOLDOWN.miss);
      return null;
    }
    this.pendingOffer = draft;
    return draft;
  }

  acceptNeighborOffer(): boolean {
    const draft = this.pendingOffer;
    this.pendingOffer = null;
    if (!draft) return false;
    const now = Date.now();
    const hanging = liveNeighborOrders(this.save.neighborOrders, now);
    if (hanging.length >= NEIGHBOR_ORDER_MAX) return false;
    if (hanging.some((o) => o.recipeId === draft.recipeId)) return false;
    const order = makeNeighborOrder(draft, now);
    SaveManager.replace({
      ...this.save,
      neighborOrders: [...hanging, order],
      neighborOfferAt: now + NEIGHBOR_COOLDOWN.accept,
    });
    this.emit();
    return true;
  }

  refuseNeighborOffer(): void {
    this.pendingOffer = null;
    this._setOfferAt(Date.now() + NEIGHBOR_COOLDOWN.refuse);
  }

  abandonNeighborOrder(id: string): void {
    const now = Date.now();
    SaveManager.replace({
      ...this.save,
      neighborOrders: liveNeighborOrders(this.save.neighborOrders, now).filter((o) => o.id !== id),
      neighborOfferAt: now + NEIGHBOR_COOLDOWN.refuse,
    });
    this.emit();
    Platform.showToast('这回不做了');
  }

  private _setOfferAt(at: number): void {
    if (this.save.neighborOfferAt === at) return;
    SaveManager.replace({ ...this.save, neighborOfferAt: at });
    this.emit();
  }

  private _fulfillNeighborOrder(
    save: KitchenSave,
    recipeId: RecipeId,
    now = Date.now(),
  ): {
    save: KitchenSave;
    bonus: number;
    npc: string;
    dish: string;
    foodName?: string;
    foodFolded: boolean;
    foldGold: number;
  } {
    const match = liveNeighborOrders(save.neighborOrders, now)
      .filter((o) => o.recipeId === recipeId)
      .sort((a, b) => a.expiresAt - b.expiresAt)[0];
    if (!match) return { save, bonus: 0, npc: '', dish: '', foodFolded: false, foldGold: 0 };
    const reward = match.reward ?? { gold: neighborOrderBonus(recipeId) };
    const granted = applyNeighborReward(save, reward);
    return {
      save: {
        ...granted.save,
        neighborOrders: liveNeighborOrders(granted.save.neighborOrders, now).filter((o) => o.id !== match.id),
        neighborOfferAt: Math.max(granted.save.neighborOfferAt, now + NEIGHBOR_COOLDOWN.accept),
      },
      bonus: granted.gold,
      npc: neighborNpc(match.npcId).name,
      dish: recipeById(recipeId)?.name ?? '菜',
      foodName: granted.foodName,
      foodFolded: granted.foodFolded,
      foldGold: granted.foldGold,
    };
  }

  discoverFood(defId: string, quality?: Quality, marketId?: MarketId): boolean {
    const found = discoverFood(this.save, defId, quality);
    const save = marketId ? noteMarketFood(found.save, marketId, defId, quality) : found.save;
    if (save === this.save) return found.first;
    SaveManager.replace(save);
    this.emit();
    return found.first;
  }

  findRecipe(id: RecipeId): void {
    if (this.save.recipesFound.includes(id)) return;
    SaveManager.replace({ ...this.save, recipesFound: [...this.save.recipesFound, id] });
    this.enqueueRecipeUnlocks([id], 0, false);
    this.emit();
  }

  enqueueRecipeUnlocks(ids: RecipeId[], delayMs = 0, notify = true): void {
    const add = ids.filter((id) => recipeById(id) && !this._unlockQueue.includes(id));
    if (!add.length) return;
    this._unlockQueue.push(...add);
    if (!notify) return;
    if (delayMs > 0) {
      setTimeout(() => EventBus.emit(EV.recipeUnlocked), delayMs);
      return;
    }
    EventBus.emit(EV.recipeUnlocked);
  }

  peekRecipeUnlock(): RecipeId | null {
    return this._unlockQueue[0] ?? null;
  }

  recipeUnlockLeft(): number {
    return this._unlockQueue.length;
  }

  shiftRecipeUnlock(): RecipeId | null {
    return this._unlockQueue.shift() ?? null;
  }

  enqueueCookLevelUp(from: number, to: number): void {
    if (to <= from) return;
    this._levelUps.push({
      from,
      to,
      recipes: recipesGainedByCook(from, to),
    });
    EventBus.emit(EV.cookLeveled);
  }

  peekCookLevelUp(): CookLevelUp | null {
    return this._levelUps[0] ?? null;
  }

  cookLevelUpLeft(): number {
    return this._levelUps.length;
  }

  shiftCookLevelUp(): CookLevelUp | null {
    return this._levelUps.shift() ?? null;
  }

  gmAddCookXp(amount: number): void {
    const from = this.save.level;
    const { save, levels } = grantCookXp(this.save, amount);
    SaveManager.replace(save);
    this.emit();
    if (levels > 0) this.enqueueCookLevelUp(from, save.level);
    else Platform.showToast(`经验 +${amount}`);
  }

  gmNudgeCookLevel(delta: number): void {
    const from = this.save.level;
    const level = clampCookLevel(this.save.level + delta);
    SaveManager.replace({ ...this.save, level, xp: 0 });
    this.emit();
    if (level > from) this.enqueueCookLevelUp(from, level);
    else Platform.showToast(`厨艺 ${level}/${COOK_LEVEL_MAX}`);
  }

  gmAddStamina(n = 5): void {
    const save = addStamina(this.save, n);
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(`体力 ${save.stamina}`);
  }

  gmAddMoney(n = 100): void {
    const money = this.save.money + n;
    SaveManager.replace({ ...this.save, money });
    this.emit();
    Platform.showToast(`金币 +${n} · 现有 ${money}`);
  }

  /** 清掉进度，回到开局。云存档会随后被这局空档盖掉。 */
  gmResetProgress(): void {
    this._cookFx = null;
    this._unlockQueue = [];
    this._levelUps = [];
    this.pendingHaul = null;
    this.pendingOffer = null;
    this._visitOfferDone = false;
    SaveManager.replace(defaultSave());
    this.emit();
    Platform.showToast('已清档，从头玩', 'success');
  }

  upgrade(id: FurnId): void {
    const fromTable = furnLevel(this.save, 'table');
    const { save, error } = buyFurnUpgrade(this.save, id);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('upgrade');
    const lv = furnLevel(save, id);
    if (id === 'fridge') Platform.showToast(`冰箱 ${lv + 1} 级 · 容量 ${fridgeOwnCap(lv)}`, 'success');
    else if (id === 'foam') {
      Platform.showToast(`${furnLabel(id, lv)} · 出门湿区 ${foamWetCols(lv)}×${foamWetRows(lv)}`, 'success');
    }
    else if (id === 'basket') {
      Platform.showToast(`${furnLabel(id, lv)} · 出门干区 ${bagDryCols(lv)}×${bagRows(lv)}`, 'success');
    }
    else if (id === 'table') {
      const learned = recipesGainedByTable(fromTable, lv);
      this.enqueueRecipeUnlocks(learned, 1000);
      Platform.showToast(`烹饪台 ${lv + 1} 级`, 'success');
    }
    else Platform.showToast(`升到 ${lv + 1} 级`, 'success');
  }

  upgradeHouse(): void {
    const { save, error } = buyHouseUpgrade(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('upgrade');
    Platform.showToast(`装修成${houseLabel(houseLevel(save))}`, 'success');
  }

  /** 明牌：这个菜场走过这种卡，下次直接写名字。 */
  cardSeen(marketId: MarketId, kind: CardKind): boolean {
    return this.save.seenCards.includes(`${marketId}:${kind}`);
  }

  markCardSeen(marketId: MarketId, kind: CardKind): void {
    const key = `${marketId}:${kind}`;
    if (this.save.seenCards.includes(key)) return;
    SaveManager.replace({ ...this.save, seenCards: [...this.save.seenCards, key] });
  }

  allowGodPickToday(): boolean {
    return this.save.dailyGodPickDate !== todayKey();
  }

  markGodPickToday(): void {
    SaveManager.replace({ ...this.save, dailyGodPickDate: todayKey() });
  }

  specialVisitCount(id: SpecialMarketId): number {
    return saveSpecialVisitCount(this.save, id);
  }

  canVisitSpecial(id: SpecialMarketId): boolean {
    return saveCanVisitSpecial(this.save, id, getSpecialMarket(id).dailyLimit);
  }

  markSpecialVisit(id: SpecialMarketId): void {
    SaveManager.replace(saveMarkSpecialVisit(this.save, id));
    this.emit();
  }

  staminaLabel(): string {
    const s = regenNow();
    return `体力 ${s.stamina}/${staminaMax(s)}`;
  }
}

function regenNow(): KitchenSave {
  const next = regenStamina(SaveManager.data);
  if (next.stamina !== SaveManager.data.stamina || next.staminaAt !== SaveManager.data.staminaAt) {
    SaveManager.replace(next);
  }
  return SaveManager.data;
}

export const KitchenManager = new KitchenManagerClass();
