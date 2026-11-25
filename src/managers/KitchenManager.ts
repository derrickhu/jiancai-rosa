import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Platform } from '@/core/PlatformService';
import { showPrompt } from '@/gameobjects/ui/PromptPanel';
import type { RewardCollectGain } from '@/utils/coinCollect';
import { EV } from '@/config/events';
import { warmupRewardedAds } from '@/services/RewardedAdService';
import { CloudSyncManager } from './CloudSyncManager';
import { SaveManager } from './SaveManager';
import {
  recipeById,
  recipesGainedByCook,
  recipesGainedByTable,
  SHARE_IMAGE_URLS,
  SHARE_STAMINA_TITLES,
  STAMINA_AD_GAIN,
  STAMINA_SHARE_GAIN,
  GAME_CLUB_DAILY_COINS,
  addStamina,
  canClaimGameClubReward,
  claimGameClubReward,
  hasClaimedGameClubToday as saveClaimedGameClubToday,
  staminaMax,
  buyFurnUpgrade,
  buyHouseUpgrade,
  cookRecipe,
  eatDish,
  sellFridgeQty,
  COOK_LEVEL_MAX,
  clampCookLevel,
  defaultSave,
  fridgeAcceptsOuting,
  fridgeCanFit,
  fridgeItemName,
  fridgeKind,
  fridgeOwnCap,
  fridgeRoom,
  fridgeSlotsNeeded,
  fridgeUnpackNeed,
  isRecipeId,
  settleFridgeUnpack,
  vipSettleFridgeUnpack,
  type FridgeDraft,
  furnLevel,
  grantCookXp,
  houseLevel,
  ingestExtract,
  noteMarketFood,
  discoverFood,
  regenStamina,
  sellItems,
  selectVehicle,
  spendStamina,
  buyVehicle as purchaseVehicle,
  todayKey,
  sameDayKey,
  msUntilLocalMidnight,
  ensureDailyMenu as rollDailyMenu,
  submitDailyMenu as applySubmitDailyMenu,
  submitNeighborOrder as applySubmitNeighborOrder,
  refreshNeighborOrderByAd,
  unlockExtraDailyMenuByAd,
  activateChefFireByAd,
  claimDexEntryReward,
  claimDexStampSet,
  claimAllDexRewards,
  drawRecipeGacha,
  type GachaDrawMode,
  canVisitSpecial as saveCanVisitSpecial,
  markSpecialVisit as saveMarkSpecialVisit,
  specialVisitCount as saveSpecialVisitCount,
  recipeUnlockView,
  type KitchenSave,
  type RecipeId,
} from '@/sim/kitchen';
import { type DexEntryKind, type DexStampSetId } from '@/sim/dex';
import { consumeOutingBuffs, recipeEatStaminaGain } from '@/sim/dishEffects';
import type { Rarity } from '@/sim/rarity';
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
import {
  adoptStrayCat,
  boostPickleByAd,
  buyCatBedTierUpgrade,
  buyPickleTierUpgrade,
  buySecondPickleJar,
  claimCatGift,
  feedCatFromFridge,
  harvestPickle,
  pickleFormulaById,
  startPickle,
  useCatCanByAd,
  type PickleFormulaId,
} from '@/sim/p2Systems';

export interface CookLevelUp {
  from: number;
  to: number;
  recipes: RecipeId[];
}

export interface CookReadyFx {
  recipeId: RecipeId;
  cooked: number;
  xp: number;
  levels: number;
  rarity: Rarity;
}

class KitchenManagerClass {
  private _cookFx: CookReadyFx | null = null;
  private _unlockQueue: RecipeId[] = [];
  private _levelUps: CookLevelUp[] = [];
  private _dayKey = todayKey();
  private _dayTimer: ReturnType<typeof setTimeout> | null = null;
  private _visitOfferDone = false;
  private _nudgeOffer = false;
  pendingHaul: ExtractedItem[] | null = null;
  pendingOffer: NeighborOfferDraft | null = null;

  constructor() {
    this._armDayRollover();
    this._bindShare();
    EventBus.on(EV.tutorialCompleted, () => this.ensureDailyMenu());
    warmupRewardedAds();
  }

  private _bindShare(): void {
    Platform.bindShareMenu(() => this._shareTitle(), () => this._shareImage());
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
        this.ensureDailyMenu();
        this.emit();
      }
      this._armDayRollover();
    }, msUntilLocalMidnight());
  }

  get save(): KitchenSave {
    return SaveManager.data;
  }

  consumeCookFx(): CookReadyFx | null {
    const fx = this._cookFx;
    this._cookFx = null;
    return fx;
  }

  emit(): void {
    EventBus.emit(EV.kitchenChanged, this.save);
  }

  canGoMarket(cost = 1): boolean {
    return regenNow().stamina >= cost;
  }

  startRun(cost = 1): boolean {
    const { save, error } = spendStamina(this.save, cost);
    if (error) {
      Platform.showToast(error);
      return false;
    }
    SaveManager.replace(save);
    this.emit();
    return true;
  }

  refundStamina(cost = 1): void {
    SaveManager.replace(addStamina(this.save, cost));
    this.emit();
  }

  /** 补体力：优先看激励视频；仅当广告拉取失败时提供每日 1 次分享兜底。 */
  async offerShareStamina(): Promise<void> {
    const now = regenNow();
    if (now.stamina >= staminaMax(now)) {
      Platform.showToast('体力已经满了');
      return;
    }
    const staminaDish = now.fridge.find(
      (it) => fridgeKind(it) === 'dish' && isRecipeId(it.defId) && recipeEatStaminaGain(it.defId) > 0,
    );
    const dishHint = staminaDish
      ? `\n（冰箱里的${fridgeItemName(staminaDish)}点开吃一口也能垫体力）`
      : '';
    const ok = await showPrompt({
      title: now.stamina <= 0 ? '体力用完了' : '补充体力',
      content: `看一段广告，回来加 ${STAMINA_AD_GAIN} 点体力${dishHint}`,
      confirmText: '看广告',
      cancelText: '再等等',
      icon: 'subpkg_images/hud_stamina.png',
    });
    if (!ok) return;
    Platform.showRewardedVideo('stamina', () => {
      const before = regenNow().stamina;
      if (before >= staminaMax(this.save)) {
        Platform.showToast('体力已经满了');
        return;
      }
      const save = addStamina(this.save, STAMINA_AD_GAIN);
      SaveManager.replace(save);
      this.emit();
      const gained = Math.max(0, save.stamina - before);
      Platform.showToast(gained > 0 ? `体力 +${gained}` : '体力已经满了');
    }, (result) => {
      if (result === 'unavailable' || result === 'error') {
        void this._offerShareStaminaFallback();
      }
    });
  }

  private async _offerShareStaminaFallback(): Promise<void> {
    const today = todayKey();
    if (sameDayKey(this.save.shareStaminaDate, today)) return;
    const shareOk = await showPrompt({
      title: '广告暂时没加载出来',
      content: `分享给好友也能恢复 ${STAMINA_SHARE_GAIN} 点体力（今日限 1 次）`,
      confirmText: '去分享',
      cancelText: '算了',
      icon: 'subpkg_images/hud_stamina.png',
    });
    if (!shareOk) return;
    const shared = Platform.shareAppMessage({
      title: this._shareTitle(),
      imageUrl: this._shareImage(),
    });
    if (!shared && Platform.isMinigame) {
      Platform.showToast('当前环境暂不支持分享');
      return;
    }
    const before = regenNow().stamina;
    const next = addStamina({ ...this.save, shareStaminaDate: today }, STAMINA_SHARE_GAIN);
    SaveManager.replace(next);
    this.emit();
    const gained = Math.max(0, next.stamina - before);
    if (gained > 0) Platform.showToast(`体力 +${gained}`, 'success');
  }

  receiveExtract(items: ExtractedItem[]): { needsPick: boolean } {
    if (fridgeCanFit(this.save, items)) {
      const hadWild = this.save.recipesFound.includes('wild_fish_soup');
      this.pendingHaul = null;
      const next = ingestExtract(this.save, items);
      SaveManager.replace(next);
      this.emit();
      if (!hadWild && next.recipesFound.includes('wild_fish_soup')) {
        this.enqueueRecipeUnlocks(['wild_fish_soup'], 350);
      }
      return { needsPick: false };
    }
    this.pendingHaul = items;
    return { needsPick: true };
  }

  /** 正式出门已经套过加成后收摊，才清出门 buff。厨房加成不动。 */
  spendOutingBuffs(): void {
    const next = consumeOutingBuffs(this.save);
    if (next === this.save) return;
    SaveManager.replace(next);
    this.emit();
  }

  unpackNeed(): number {
    return fridgeUnpackNeed(this.save, this.pendingHaul ?? []);
  }

  commitUnpack(sellUids: string[]): { error?: string; gained: number; kept: number } {
    const haul = this.pendingHaul ?? [];
    const hadWild = this.save.recipesFound.includes('wild_fish_soup');
    const result = settleFridgeUnpack(this.save, haul, sellUids);
    if (result.error) return { error: result.error, gained: 0, kept: 0 };
    this.pendingHaul = null;
    SaveManager.replace(result.save);
    this.emit();
    if (!hadWild && result.save.recipesFound.includes('wild_fish_soup')) {
      this.enqueueRecipeUnlocks(['wild_fish_soup'], 350);
    }
    return { gained: result.gained, kept: result.kept };
  }

  vipUnpackOverflow(): { error?: string; gained: number; soldCount: number; kept: number } {
    const haul = this.pendingHaul ?? [];
    const hadWild = this.save.recipesFound.includes('wild_fish_soup');
    const result = vipSettleFridgeUnpack(this.save, haul);
    if (result.error) {
      AudioManager.play('ui_deny');
      Platform.showToast(result.error);
      return { error: result.error, gained: 0, soldCount: 0, kept: 0 };
    }
    this.pendingHaul = null;
    SaveManager.replace(result.save);
    this.emit();
    if (!hadWild && result.save.recipesFound.includes('wild_fish_soup')) {
      this.enqueueRecipeUnlocks(['wild_fish_soup'], 350);
    }
    return { gained: result.gained, soldCount: result.soldCount, kept: result.kept };
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
    const moneyBefore = this.save.money;
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
    analytics.trackKitchenUpgrade({
      targetType: 'vehicle',
      targetId: id,
      newLevel: 1,
      costGold: Math.max(0, moneyBefore - save.money),
      cookLevel: save.level,
    });
    return true;
  }

  setVehicle(id: VehicleId): void {
    const next = selectVehicle(this.save, id);
    if (next === this.save) return;
    SaveManager.replace(next);
    this.emit();
  }

  hasClaimedGameClubToday(): boolean {
    return saveClaimedGameClubToday(this.save);
  }

  canClaimGameClub(postCount: number): boolean {
    return canClaimGameClubReward(this.save, postCount);
  }

  claimGameClubDaily(postCount: number): {
    ok: boolean;
    foods: Array<{ defId: string; name: string; qty: number; folded: boolean }>;
    tickets: number;
    foldGold: number;
  } {
    const res = claimGameClubReward(this.save, postCount);
    if (res.error) {
      AudioManager.play('ui_deny');
      Platform.showToast(res.error);
      return { ok: false, foods: [], tickets: 0, foldGold: 0 };
    }
    SaveManager.replace(res.save);
    this.emit();
    AudioManager.play('recipe_paper');
    const parts = res.foods.map((f) => (f.folded ? `${f.name}折${res.foldGold}金` : `${f.name}×${f.qty}`));
    if (res.tickets > 0) parts.push(`菜谱券×${res.tickets}`);
    Platform.showToast(`领取成功：${parts.join(' · ')}`, 'success');
    return { ok: true, foods: res.foods, tickets: res.tickets, foldGold: res.foldGold };
  }

  trySpend(amount: number, opts?: { silent?: boolean }): boolean {
    if (amount <= 0) return true;
    if (this.save.money < amount) {
      AudioManager.play('ui_deny');
      Platform.showToast(`差 ${amount - this.save.money} 金币，先回家卖点菜`);
      return false;
    }
    SaveManager.replace({ ...this.save, money: this.save.money - amount });
    this.emit();
    if (!opts?.silent) AudioManager.play('coin_spend');
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
    const { save, error, xp, levels, cooked, doubled, foldGold, masteryTickets } = cookRecipe(this.save, recipeId, times);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    AudioManager.play('cook_sizzle');
    this._cookFx = {
      recipeId,
      cooked: cooked ?? 1,
      xp: xp ?? 0,
      levels: levels ?? 0,
      rarity: recipeById(recipeId)?.rarity ?? 'common',
    };
    SaveManager.replace(save);
    this.emit();
    if ((masteryTickets ?? 0) > 0) {
      AudioManager.play('recipe_paper');
      Platform.showToast(`练成金勺招牌菜！获赠菜谱券 ×${masteryTickets}`, 'success');
    } else if (doubled) {
      Platform.showToast(
        foldGold ? `旺火出了两份，冰箱满了第二份折成 ${foldGold} 金` : '出了两份！',
        'success',
      );
    }
    if ((levels ?? 0) > 0) {
      this.enqueueCookLevelUp(fromLevel, save.level, true);
    }
  }

  activateChefFire(): boolean {
    const { save, error } = activateChefFireByAd(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('cook_sizzle');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast('大厨旺火已点燃（15 分钟）！', 'success');
    return true;
  }

  claimDexEntry(kind: DexEntryKind, id: string): number {
    const { save, gold, claimed } = claimDexEntryReward(this.save, kind, id);
    if (!claimed) return 0;
    AudioManager.play('coin_gain');
    SaveManager.replace(save);
    this.emit();
    return gold;
  }

  claimStampSet(setId: DexStampSetId): { gold: number; tickets: number; claimed: boolean; buffLabel: string } {
    const res = claimDexStampSet(this.save, setId);
    if (!res.claimed) return res;
    AudioManager.play(res.tickets > 0 ? 'recipe_paper' : 'coin_gain');
    SaveManager.replace(res.save);
    this.emit();
    return { gold: res.gold, tickets: res.tickets, claimed: true, buffLabel: res.buffLabel };
  }

  claimAllDex(): {
    gold: number;
    tickets: number;
    entriesCount: number;
    milestonesCount: number;
    stampSetsCount: number;
  } {
    const res = claimAllDexRewards(this.save);
    if (res.gold <= 0 && res.tickets <= 0) return res;
    AudioManager.play(res.tickets > 0 ? 'recipe_paper' : 'coin_gain');
    SaveManager.replace(res.save);
    this.emit();
    return {
      gold: res.gold,
      tickets: res.tickets,
      entriesCount: res.entriesCount,
      milestonesCount: res.milestonesCount,
      stampSetsCount: res.stampSetsCount,
    };
  }

  unlockExtraDailyMenu(): boolean {
    const { save, error } = unlockExtraDailyMenuByAd(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('recipe_paper');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast('晚市新开一桌！交齐再领菜谱券', 'success');
    return true;
  }

  beginKitchenVisit(): void {
    this._visitOfferDone = false;
    this.pendingOffer = null;
    this.sweepNeighborOrders();
    this.ensureDailyMenu();
  }

  ensureDailyMenu(): void {
    const next = rollDailyMenu(this.save);
    if (next === this.save) return;
    SaveManager.replace(next);
    this.emit();
  }

  submitDailyMenu(recipeId: RecipeId): RewardCollectGain | null {
    this.ensureDailyMenu();
    const { save, error, gold, foldGold, foodDefId, foodFolded, tickets } = applySubmitDailyMenu(this.save, recipeId);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return null;
    }
    SaveManager.replace(save);
    this.emit();
    return { gold, foldGold, foodDefId, foodFolded, tickets };
  }

  submitNeighborOrder(orderId: string, opts?: { doubled?: boolean }): RewardCollectGain | null {
    this.sweepNeighborOrders(false);
    const { save, error, gold, foldGold, foodDefId, foodFolded } = applySubmitNeighborOrder(this.save, orderId, Date.now(), opts);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return null;
    }
    SaveManager.replace(save);
    this.emit();
    return { gold, foldGold, foodDefId, foodFolded };
  }

  refreshNeighborOrder(orderId: string): boolean {
    this.sweepNeighborOrders(false);
    const { save, error, nextOrder } = refreshNeighborOrderByAd(this.save, orderId);
    if (error || !nextOrder) {
      AudioManager.play('ui_deny');
      Platform.showToast(error ?? '换单失败');
      return false;
    }
    AudioManager.play('event_pop');
    SaveManager.replace(save);
    this.emit();
    const npc = neighborNpc(nextOrder.npcId);
    const rName = recipeById(nextOrder.recipeId)?.name ?? '家常菜';
    Platform.showToast(`${npc.name}来换单：想吃${rName}`, 'success');
    return true;
  }

  drawRecipe(opts?: { reveal?: boolean; mode?: GachaDrawMode }): {
    ok: boolean;
    recipeId?: RecipeId;
    foodDefId?: string;
    foodQty?: number;
    foodFolded: boolean;
    foldGold: number;
    duplicate: boolean;
    gold: number;
    toast: string;
    specialKind?: 'mastery_note' | 'outing_charm';
    masteryRecipeId?: RecipeId;
    bonusTickets?: number;
  } {
    const empty = { ok: false, duplicate: false, gold: 0, toast: '', foodFolded: false, foldGold: 0 };
    const {
      save, error, toast, recipeUnlock, recipeId, duplicate, gold, foodDefId, foodQty, foodFolded, foldGold,
      specialKind, masteryRecipeId, bonusTickets,
    } = drawRecipeGacha(this.save, Date.now(), opts?.mode ?? 'ticket');
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return empty;
    }
    SaveManager.replace(save);
    this.emit();
    const reveal = opts?.reveal !== false;
    if (specialKind) {
      if (reveal) {
        AudioManager.play('recipe_paper');
        if (toast) Platform.showToast(toast, 'success');
      }
      return {
        ok: true,
        specialKind,
        masteryRecipeId,
        bonusTickets,
        duplicate: false,
        gold,
        toast,
        foodFolded: false,
        foldGold: 0,
      };
    }
    if (foodDefId) {
      if (reveal && toast) Platform.showToast(toast, 'success');
      return {
        ok: true,
        foodDefId,
        foodQty,
        foodFolded,
        foldGold,
        duplicate: false,
        gold,
        toast,
      };
    }
    if (duplicate) {
      if (reveal) {
        AudioManager.play('coin_gain');
        if (toast) Platform.showToast(toast, 'success');
      }
      return { ok: true, recipeId, duplicate: true, gold, toast, foodFolded: false, foldGold: 0 };
    }
    if (reveal) {
      AudioManager.play('recipe_paper');
      if (recipeUnlock) this.enqueueRecipeUnlocks([recipeUnlock], 200);
    }
    return {
      ok: true,
      recipeId: recipeUnlock ?? recipeId,
      duplicate: false,
      gold: 0,
      toast,
      foodFolded: false,
      foldGold: 0,
    };
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

  enqueueCookLevelUp(from: number, to: number, silent = false): void {
    if (to <= from) return;
    this._levelUps.push({
      from,
      to,
      recipes: recipesGainedByCook(from, to),
    });
    if (!silent) EventBus.emit(EV.cookLeveled);
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

  setTutorialStep(step: number): void {
    if (this.save.tutorialStep === step) return;
    SaveManager.replace({ ...this.save, tutorialStep: step });
  }

  /** 新手指引兜底：确保冰箱里至少有 minQty 棵可用菜苔，避免炒菜苔卡死或断线回退。 */
  ensureTutorialCaitai(minQty = 1): void {
    const have = this.save.fridge
      .filter((it) => fridgeKind(it) !== 'dish' && it.defId === 'caitai' && it.quality !== 'rotten')
      .reduce((sum, it) => sum + (it.qty ?? 1), 0);
    if (have >= minQty) return;
    const need = minQty - have;
    const items: ExtractedItem[] = Array.from({ length: need }, (_, i) => ({
      uid: `tut_caitai_${Date.now()}_${i}`,
      defId: 'caitai',
      quality: 'fresh',
      inspected: true,
      freshness: 2,
      name: '新鲜菜苔',
      sell: 8,
    }));
    SaveManager.replace(ingestExtract(this.save, items));
    this.emit();
  }

  grantCoins(n: number, toast?: string): void {
    const money = this.save.money + Math.max(0, Math.floor(n));
    SaveManager.replace({ ...this.save, money });
    this.emit();
    if (n > 0) AudioManager.play('coin_gain');
    if (toast) Platform.showToast(toast, 'success');
  }

  noteTutorialGiftClaimed(): void {
    if (this.save.tutorialGiftClaimed) return;
    SaveManager.replace({ ...this.save, tutorialGiftClaimed: true });
  }

  claimTutorialGift(n: number, tickets = 2): void {
    const coins = Math.max(0, Math.floor(n));
    const bonusTickets = Math.max(0, Math.floor(tickets));
    SaveManager.replace({
      ...this.save,
      money: this.save.money + coins,
      recipeTickets: this.save.recipeTickets + bonusTickets,
      tutorialGiftClaimed: true,
    });
    this.emit();
  }

  hasSeenGuide(guideId: string): boolean {
    return (this.save.seenGuides ?? []).includes(guideId);
  }

  markGuideSeen(guideId: string): void {
    const list = this.save.seenGuides ?? [];
    if (list.includes(guideId)) return;
    SaveManager.replace({
      ...this.save,
      seenGuides: [...list, guideId],
    });
    this.emit();
  }

  gmAddMoney(n = 100): void {
    const money = this.save.money + n;
    SaveManager.replace({ ...this.save, money });
    this.emit();
    Platform.showToast(`金币 +${n} · 现有 ${money}`);
  }

  gmAddTickets(n = 2): void {
    const recipeTickets = this.save.recipeTickets + Math.max(0, Math.floor(n));
    SaveManager.replace({ ...this.save, recipeTickets });
    this.emit();
    Platform.showToast(`菜谱券 +${n} · 现有 ${recipeTickets}`);
  }

  /** 清掉进度，回到开局。云存档和账号新手标记会随后被这局空档盖掉。 */
  gmResetProgress(): void {
    this._cookFx = null;
    this._unlockQueue = [];
    this._levelUps = [];
    this.pendingHaul = null;
    this.pendingOffer = null;
    this._visitOfferDone = false;
    CloudSyncManager.noteTutorialReset();
    SaveManager.replace(defaultSave());
    this.emit();
    void CloudSyncManager.flushNow('gm-reset');
    Platform.showToast('已清档，从头玩', 'success');
  }

  upgrade(id: FurnId): void {
    const moneyBefore = this.save.money;
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
    analytics.trackKitchenUpgrade({
      targetType: 'furn',
      targetId: id,
      newLevel: lv + 1,
      costGold: Math.max(0, moneyBefore - save.money),
      cookLevel: save.level,
    });
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
    const moneyBefore = this.save.money;
    const { save, error } = buyHouseUpgrade(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    SaveManager.replace(save);
    this.emit();
    AudioManager.play('upgrade');
    const hLv = houseLevel(save);
    analytics.trackKitchenUpgrade({
      targetType: 'house',
      targetId: 'house',
      newLevel: hLv + 1,
      costGold: Math.max(0, moneyBefore - save.money),
      cookLevel: save.level,
    });
    Platform.showToast(`装修成${houseLabel(hLv)}`, 'success');
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
    return !sameDayKey(this.save.dailyGodPickDate, todayKey());
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

  // ── P2 老坛腌制坊 & 流浪小橘猫阿橘 ────────────────────────────

  buySecondJar(): boolean {
    const { save, error } = buySecondPickleJar(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('upgrade');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast('二号老坛搬进屋啦！', 'success');
    return true;
  }

  upgradePickleJar(): boolean {
    const { save, nextName, error } = buyPickleTierUpgrade(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('upgrade');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(`老坛焕新为「${nextName ?? '新瓷坛'}」！`, 'success');
    return true;
  }

  upgradeCatBed(): boolean {
    const { save, nextName, error } = buyCatBedTierUpgrade(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('upgrade');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(`阿橘搬进了「${nextName ?? '新猫窝'}」！`, 'success');
    return true;
  }

  startPickleJar(formulaId: PickleFormulaId, preferredSlot?: 0 | 1): boolean {
    const { save, error } = startPickle(this.save, formulaId, preferredSlot);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('event_pop');
    SaveManager.replace(save);
    this.emit();
    const name = pickleFormulaById(formulaId)?.name ?? '腌菜';
    Platform.showToast(`「${name}」已封水入坛！`, 'success');
    return true;
  }

  boostPickleJar(slotIndex: 0 | 1): boolean {
    const { save, error } = boostPickleByAd(this.save, slotIndex);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('cook_sizzle');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast('老卤秘方催熟成功，分量还多出一份！', 'success');
    return true;
  }

  harvestPickleJar(slotIndex: 0 | 1): {
    ok: boolean;
    outputDefId?: string;
    outputName?: string;
    qty: number;
    foodFolded: boolean;
    foldGold: number;
    unlockedRecipeId?: RecipeId;
  } {
    const res = harvestPickle(this.save, slotIndex);
    if (res.error) {
      AudioManager.play('ui_deny');
      Platform.showToast(res.error);
      return { ok: false, qty: 0, foodFolded: false, foldGold: 0 };
    }
    AudioManager.play(res.unlockedRecipeId ? 'recipe_paper' : 'event_pop');
    SaveManager.replace(res.save);
    this.emit();
    if (res.unlockedRecipeId) {
      this.enqueueRecipeUnlocks([res.unlockedRecipeId], 240);
    }
    const baseMsg = res.foodFolded
      ? `${res.outputName}×${res.qty} 冰箱满了，折成 ${res.foldGold} 金`
      : `开坛收获 ${res.outputName}×${res.qty}！`;
    Platform.showToast(baseMsg, 'success');
    return {
      ok: true,
      outputDefId: res.outputDefId,
      outputName: res.outputName,
      qty: res.qty,
      foodFolded: res.foodFolded,
      foldGold: res.foldGold,
      unlockedRecipeId: res.unlockedRecipeId,
    };
  }

  adoptCat(): boolean {
    const { save, error } = adoptStrayCat(this.save);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('event_pop');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast('阿橘把草垫踩软了，以后这就是它的窝！', 'success');
    return true;
  }

  feedCat(defId: string): boolean {
    const { save, error, bondGain, outingMinutes } = feedCatFromFridge(this.save, defId);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return false;
    }
    AudioManager.play('eat');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(`阿橘吃美了（亲密 +${bondGain ?? 1}），约 ${outingMinutes ?? 45} 分钟后叼礼回屋！`, 'success');
    return true;
  }

  useCatCan(): 'deluxe_instant' | 'instant_recall' | null {
    const { save, mode, error } = useCatCanByAd(this.save);
    if (error || !mode) {
      AudioManager.play('ui_deny');
      Platform.showToast(error ?? '投喂失败');
      return null;
    }
    AudioManager.play('event_pop');
    SaveManager.replace(save);
    this.emit();
    Platform.showToast(
      mode === 'instant_recall'
        ? '阿橘听见拉环声，叼着加料包袱飞奔回屋！'
        : '阿橘舔光鲜鱼罐头，当场叼回豪华礼袋！',
      'success',
    );
    return mode;
  }

  claimCatGiftBundle(): {
    ok: boolean;
    foods: Array<{ defId: string; name: string; qty: number; folded: boolean }>;
    foldGold: number;
    gold: number;
    totalGold: number;
    tickets: number;
    deluxe: boolean;
  } {
    const res = claimCatGift(this.save);
    if (res.error) {
      AudioManager.play('ui_deny');
      Platform.showToast(res.error);
      return { ok: false, foods: [], foldGold: 0, gold: 0, totalGold: 0, tickets: 0, deluxe: false };
    }
    AudioManager.play(res.tickets > 0 ? 'recipe_paper' : 'coin_gain');
    SaveManager.replace(res.save);
    this.emit();
    const parts: string[] = [];
    for (const f of res.foods) {
      if (!f.folded) parts.push(`${f.name}×${f.qty}`);
    }
    if (res.totalGold > 0) parts.push(`+${res.totalGold}金`);
    if (res.tickets > 0) parts.push(`菜谱券×${res.tickets}`);
    Platform.showToast(`阿橘谢礼：${parts.join(' · ')}`, 'success');
    return { ok: true, ...res };
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
