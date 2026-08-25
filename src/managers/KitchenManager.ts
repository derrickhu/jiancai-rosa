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
  STAMINA_MAX,
  addStamina,
  buyFurnUpgrade,
  buyHouseUpgrade,
  cookRecipe,
  COOK_LEVEL_MAX,
  clampCookLevel,
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
  regenStamina,
  sellItems,
  selectVehicle,
  spendStamina,
  buyVehicle as purchaseVehicle,
  todayKey,
  canVisitSpecial as saveCanVisitSpecial,
  markSpecialVisit as saveMarkSpecialVisit,
  specialVisitCount as saveSpecialVisitCount,
  type KitchenSave,
  type RecipeId,
} from '@/sim/kitchen';
import { getSpecialMarket, type SpecialMarketId } from '@/sim/specialMarkets';
import { foamWetCols, outingDryCells } from '@/sim/basket';
import { furnLabel, houseLabel, type FurnId } from '@/sim/kitchenLayout';
import type { CardKind } from '@/sim/marketEvents';
import type { MarketId } from '@/sim/destinations';
import { vehicleById, type VehicleId } from '@/sim/vehicles';
import type { ExtractedItem } from '@/sim/run';

class KitchenManagerClass {
  private _cookFx: { xp: number; levels: number } | null = null;
  private _unlockQueue: RecipeId[] = [];
  pendingHaul: ExtractedItem[] | null = null;

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

  watchAdStamina(): void {
    Platform.showRewardedVideo(() => {
      SaveManager.replace(addStamina(this.save, 1));
      this.emit();
      Platform.showToast('体力 +1');
    });
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

  cook(recipeId: RecipeId): void {
    const fromLevel = this.save.level;
    const { save, error, xp, levels } = cookRecipe(this.save, recipeId);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    AudioManager.play('cook_sizzle');
    if ((xp ?? 0) > 0) this._cookFx = { xp: xp ?? 0, levels: levels ?? 0 };
    SaveManager.replace(save);
    this.emit();
    if ((levels ?? 0) > 0) {
      setTimeout(() => AudioManager.play('level_up'), 1000);
    }
    const name = RECIPES.find((r) => r.id === recipeId)?.name ?? '菜';
    const learned = recipesGainedByCook(fromLevel, save.level);
    this.enqueueRecipeUnlocks(learned);
    if ((levels ?? 0) > 0) Platform.showToast(`${name} 出锅，厨艺升到 ${save.level} 级`, 'success');
    else if ((xp ?? 0) > 0) Platform.showToast(`${name} 出锅，+${xp} 经验`, 'success');
    else Platform.showToast(`${name} 出锅，放进冰箱了`, 'success');
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

  gmAddCookXp(amount: number): void {
    const { save, levels } = grantCookXp(this.save, amount);
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(levels > 0 ? `厨艺升到 ${save.level} 级` : `经验 +${amount}`);
  }

  gmNudgeCookLevel(delta: number): void {
    const level = clampCookLevel(this.save.level + delta);
    SaveManager.replace({ ...this.save, level, xp: 0 });
    this.emit();
    Platform.showToast(`厨艺 ${level}/${COOK_LEVEL_MAX}`);
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
      Platform.showToast(`${furnLabel(id, lv)} · 出门湿区 ${foamWetCols(lv)} 列`, 'success');
    }
    else if (id === 'basket') {
      Platform.showToast(`${furnLabel(id, lv)} · 出门干区 ${outingDryCells(lv)} 格`, 'success');
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
    return `体力 ${s.stamina}/${STAMINA_MAX}`;
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
