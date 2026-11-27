import {
  CHEF_FIRE_DOUBLE_CHANCE,
  CHEF_FIRE_MS,
  CHEF_FIRE_XP_MUL,
  applyEatEffects,
  consumeCookDoubleBuff,
  consumeCookXpBuff,
  grantDirectKitchenBuff,
  grantDirectOutingBuff,
  kitchenCookXpMul,
  kitchenHasCookDouble,
  kitchenSellMul,
  migrateKitchenBuffs,
  migrateOutingBuffs,
  recipeEatStaminaGain,
  type KitchenBuff,
  type OutingBuff,
} from './dishEffects';
import {
  dailyMenuComplete,
  ensureDailyMenuState,
  migrateDailyMenu,
  rollExtraDailyMenu,
  type DailyMenuRollView,
  type DailyMenuState,
} from './dailyMenu';
import {
  DEX_ENTRY_GOLD,
  DEX_MILESTONE_GOLD,
  DEX_MILESTONE_TICKETS,
  DEX_STAMP_SETS,
  dexActiveBonuses,
  dexEntryKey,
  dexMilestoneStatus,
  dexStampSetStatus,
  isDishUnlocked,
  isFoodUnlocked,
  unclaimedDexKeys,
  unclaimedDexStampSets,
  type DexEntryKind,
  type DexStampSetId,
} from './dex';
import { mulberry32, rngWeighted } from './rng';
import { MARKETS } from './destinations';
import { rarityRank, type Rarity } from './rarity';
import { PICKLE_ITEM_IDS, marketFoodIds } from './items';
import {
  RECIPE_GACHA_COST,
  gachaRng,
  recipeGachaDupGold,
  recipeGachaName,
  rollGachaPrize,
} from './recipeGacha';
import { displayName, getItem, GOD_PICK, initialFreshness, sellPrice, type Quality } from './items';
import { migrateSeenMarketFoods, marketFoodKey } from './marketExploration';
import type { MarketId } from './destinations';
import { VEHICLES, migrateVehicles, ownsVehicle, vehicleById, vehicleIndex, vehicleOffer, type VehicleId } from './vehicles';
import { nextUid, type ExtractedItem } from './run';
import {
  isNeighborRewardFood,
  liveNeighborOrders,
  makeNeighborOrder,
  migrateNeighborOrders,
  NEIGHBOR_COOLDOWN,
  neighborOfferRng,
  neighborOrderBonus,
  rollNeighborOffer,
  type NeighborOrder,
  type NeighborReward,
} from './neighborOrders';
import {
  RECIPES,
  TABLE_UNLOCKS,
  isRecipeId,
  isRecipeStoveReady,
  isRecipeUnlocked,
  migrateRecipeId,
  pickRecipeFoods,
  recipeById,
  recipeCookCount,
  recipeMinStoveLv,
  recipeUnlockView,
  type RecipeId,
} from './recipes';

export {
  RECIPES,
  recipeNeeds,
  recipeCanCook,
  recipeCookCount,
  recipeXp,
  pickRecipeFoods,
  isRecipeUnlocked,
  isRecipeStoveReady,
  recipeMinTableLevel,
  recipeMinStoveLv,
  unlockedRecipes,
  cookableUnlockedRecipes,
  newlyCookableByTableUpgrade,
  unlockedIngredients,
  recipeRarity,
  tallyNeeds,
  recipeUnlockView,
  recipesGainedByTable,
  recipesGainedByCook,
  remainingMarketRecipes,
  isRecipeId,
  recipeById,
  recipeSellPrice,
  listedRecipes,
  HIDDEN_RECIPE_IDS,
  START_RECIPES,
  TABLE_UNLOCKS,
  COOK_UNLOCK_AT,
  MARKET_RECIPE_POOL,
} from './recipes';
export type { RecipeId, RecipeDef, RecipeNeed } from './recipes';
import {
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_MAX_LEVEL,
  clampFurnLevel,
  clampHouseLevel,
  furnLabel,
  houseFurnCap,
  houseLabel,
  minHouseForFurn,
  type FurnId,
} from './kitchenLayout';
import {
  defaultPickleJars,
  defaultStrayCat,
  migratePickleJars,
  migrateStrayCat,
  type PickleJarSlot,
  type StrayCatState,
} from './p2Systems';

/** 1 级满体力。每升一级上限再加 STAMINA_PER_LEVEL。 */
export const STAMINA_MAX = 10;
export const STAMINA_PER_LEVEL = 1;
/** 看激励视频恢复的体力。 */
export const STAMINA_AD_GAIN = 5;
export const STAMINA_SHARE_GAIN = 3;
export const SHARE_STAMINA_TITLES = [
  '快来，来菜场捡菜，捡捡捡！',
  '菜场漏了一地，不捡可惜了',
  '今晚吃啥？先去菜场捡一篮',
];
export const SHARE_IMAGE_URLS = [
  'boot/share_market_g.jpg',
  'boot/share_market_k.jpg',
];
export const STAMINA_REGEN_MS = 30 * 60 * 1000;
/** 游戏圈每日发帖赠菜谱券数（另赠今日 2 份精选鲜货食材）。 */
export const GAME_CLUB_DAILY_TICKETS = 1;
/** @deprecated 兼容旧引用 */
export const GAME_CLUB_DAILY_COINS = 50;

/** 体力只跟到厨艺 15。16–25 不再加体力（图鉴集章加成额外叠上）。 */
export const STAMINA_LEVEL_CAP = 15;
/** 当前厨艺对应的体力上限。1 级 10 点，到 15 级为止每级 +1，再叠集章加成。 */
export function staminaMax(save: Pick<KitchenSave, 'level' | 'dexStampsClaimed'> | number): number {
  const level = typeof save === 'number' ? clampCookLevel(save) : clampCookLevel(save.level);
  const staminaLevel = Math.min(level, STAMINA_LEVEL_CAP);
  const bonus = typeof save === 'number' ? 0 : dexActiveBonuses(save).staminaBonus;
  return STAMINA_MAX + STAMINA_PER_LEVEL * (staminaLevel - 1) + bonus;
}
export const FRIDGE_BASE = 18;
/** 冰箱内部 0–14 级的格数。0–9 每级 +6，10–14 每级 +4。 */
export const FRIDGE_CAP = [18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 76, 80, 84, 88, 92];
/** 同一格里同种食材/饭菜最多叠多少份。多了另开一格。 */
export const FRIDGE_STACK = 10;
export const UPGRADE_BASKET_I = 80;
export const UPGRADE_BASKET_II = 200;
export const UPGRADE_FRIDGE = 60;

export function emptyFurnLevels(): Record<FurnId, number> {
  return { fridge: 0, table: 0, basket: 0, foam: 0 };
}

export function furnLevel(save: KitchenSave, id: FurnId): number {
  return clampFurnLevel(save.furnLevels?.[id] ?? 0);
}

export function houseLevel(save: KitchenSave): number {
  return clampHouseLevel(save.houseLevel ?? 0);
}

export type FridgeKind = 'food' | 'dish';

export interface FridgeItem {
  uid: string;
  kind?: FridgeKind;
  defId: string;
  quality: Quality;
  inspected: boolean;
  freshness: number;
  /** 这一格叠了几份。旧存档没有就当 1。 */
  qty?: number;
  /** 熟菜出锅时记下的售价。 */
  value?: number;
}

export type FridgeDraft = Pick<FridgeItem, 'defId' | 'quality' | 'inspected' | 'freshness'> & {
  uid?: string;
  kind?: FridgeKind;
  qty?: number;
  value?: number;
};

export function fridgeKind(it: FridgeItem): FridgeKind {
  return it.kind === 'dish' ? 'dish' : 'food';
}

export function fridgeItemName(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') {
    return RECIPES.find((r) => r.id === it.defId)?.name ?? '熟菜';
  }
  return displayName(it.defId, it.inspected, it.quality);
}

export function fridgeItemQty(it: { qty?: number }): number {
  const raw = it.qty ?? 1;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function fridgeQtySum(items: readonly { qty?: number }[]): number {
  return items.reduce((sum, it) => sum + fridgeItemQty(it), 0);
}

/** 能叠进同一格：同类同 id。售价已不跟普通/新鲜走，再按品质拆格只会占位置。 */
export function fridgeStackKey(it: FridgeDraft): string {
  const kind = it.kind === 'dish' ? 'dish' : 'food';
  return `${kind}|${it.defId}`;
}

export function fridgeItemUnitPrice(
  it: FridgeItem,
  save?: Pick<KitchenSave, 'kitchenBuffs' | 'dexStampsClaimed'>,
  now = Date.now(),
): number {
  const isDish = fridgeKind(it) === 'dish';
  const base = isDish
    ? Math.max(0, it.value ?? 0)
    : sellPrice(it.defId, it.quality, it.inspected, it.freshness);
  if (!save || base <= 0) return base;
  const stampMul = isDish ? dexActiveBonuses(save).dishSellMul : 1;
  return Math.round(base * kitchenSellMul(save, now) * stampMul);
}

export function fridgeItemPrice(
  it: FridgeItem,
  save?: Pick<KitchenSave, 'kitchenBuffs' | 'dexStampsClaimed'>,
  now = Date.now(),
): number {
  return fridgeItemUnitPrice(it, save, now) * fridgeItemQty(it);
}

export function fridgeItemBlurb(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') {
    return RECIPES.find((r) => r.id === it.defId)?.blurb ?? '刚出锅，还冒着热气。';
  }
  if (it.quality === 'rotten') {
    return getItem(it.defId).blurbRotten ?? '放久了，连自己都认不出自己。';
  }
  if (it.defId === GOD_PICK.id && !it.inspected) return getItem('smallfish').blurb;
  return getItem(it.defId).blurb;
}

export interface KitchenSave {
  version: 1;
  money: number;
  stamina: number;
  staminaAt: number;
  fridge: FridgeItem[];
  /** @deprecated 由 furnLevels.basket 迁移 */
  basketLevel: number;
  /** @deprecated 由 furnLevels.fridge / foam 迁移 */
  fridgeExtra: boolean;
  furnLevels: Record<FurnId, number>;
  /** 房屋 0 陋屋 / 1 精装屋 / 2 雅致屋 / 3 宽宅 / 4 宅院。大件家具升级受这一档限制。 */
  houseLevel: number;
  dexSeen: string[];
  dexInspected: string[];
  recipesCooked: RecipeId[];
  /** 三场捡到的菜谱。只能捡，台子和厨艺不送。 */
  recipesFound: RecipeId[];
  dailyGodPickDate: string;
  lastSeenAt: number;
  /** 厨艺等级 1–15。做菜加经验，出门选点和家具门槛都看它。 */
  level: number;
  /** 本级经验。满级后条停在满。 */
  xp: number;
  /** 明牌记忆：走过的卡型，存 `菜场:卡型`。地图每局重生，所以不记节点 id。 */
  seenCards: string[];
  /** 这个菜场见过的食材，存 `菜场:食材`。探索度只认这里，不和图鉴共用。 */
  seenMarketFoods: string[];
  /** 出门选点页当前骑的那辆。走路开局就有。 */
  vehicle: VehicleId;
  /** 已买下的交通工具。走路不写也算有。 */
  vehicles: VehicleId[];
  /** 特殊市场每日次数。日切跟神捡同一套 todayKey，本地 0 点换日。 */
  specialVisits: Record<string, { date: string; count: number }>;
  /** 街坊点菜，最多两张。 */
  neighborOrders: NeighborOrder[];
  /** 下次最早能再弹点菜的时间。 */
  neighborOfferAt: number;
  /** 下一趟菜场，收工清。不同族可并存。 */
  outingBuffs: OutingBuff[];
  /** 厨房加成。不同族可并存，下锅只摘用掉的那条。 */
  kitchenBuffs: KitchenBuff[];
  /** 本地 0 点换的今日菜单。 */
  dailyMenu?: DailyMenuState;
  /** 每日菜单已经发过的活动菜谱。抽谱改走 recipesFound，不再写入。 */
  dailyMenuRewards: RecipeId[];
  /** 菜谱券。交齐今日菜单 +1，抽一次 -2。 */
  recipeTickets: number;
  /** 今日菜单大奖已领的日期，防止同一天又重掷。 */
  dailyMenuClaimedOn: string;
  /** 游戏圈每日发帖奖励已领的日期，跟 todayKey 对齐。 */
  gameClubRewardDate: string;
  /** 广告异常兜底分享回体力的已领日期，每日最多 1 次。 */
  shareStaminaDate?: string;
  /** P0 各激励视频每日已用次数。 */
  dailyAdCounts?: Record<string, { date: string; count: number }>;
  /** 大厨旺火时刻截止时间戳（毫秒）。 */
  chefFireUntil?: number;
  /** 已盖章领赏的图鉴条目（`food:id` / `dish:id`）。 */
  dexClaimed?: string[];
  /** 已领取的图鉴集章里程碑档数（每 6 条 1 档）。 */
  dexMilestones?: number;
  /** 已盖章激活的「地域烟火集章册」主题套组 ID。 */
  dexStampsClaimed?: string[];
  /** 各道菜累计下锅次数（用于铜/银/金三勺熟练度）。 */
  recipeCookCounts?: Partial<Record<RecipeId, number>>;
  /** 已发过 3 勺招牌菜谱券奖励的菜谱。 */
  recipeMasteryClaimed?: RecipeId[];
  /** P2 老坛腌制坊两口坛位状态。 */
  pickleJars?: Array<PickleJarSlot | null>;
  /** P2 是否已花费金币添置二号老坛。 */
  secondJarUnlocked?: boolean;
  /** 老坛器物升级档位：0 粗陶老坛 / 1 青釉双耳坛 / 2 青花御瓷坛。 */
  pickleTier?: 0 | 1 | 2;
  /** P2 菜场流浪小橘猫「阿橘」状态。 */
  strayCat?: StrayCatState;
  /** 小橘猫小窝升级档位：0 蒲草软垫 / 1 柿红碎花棉窝 / 2 花梨雕花猫榻。 */
  catBedTier?: 0 | 1 | 2;
  /** 抽谱箱连续未出新菜谱次数（满 3 次后下一抽必出新菜谱）。 */
  gachaPity?: number;
  /** 已展示过的渐进式首次轻引导标记（每项只提示 1 次）。 */
  seenGuides?: string[];
  /** 新手指引步骤。新号 0；老档缺字段时 normalize 写成 99，不重播。 */
  tutorialStep: number;
  /** 新手礼金是否已点领取。 */
  tutorialGiftClaimed: boolean;
}

export type DailyAdLimitKey =
  | 'gacha_free'
  | 'gacha_topup'
  | 'chef_buff'
  | 'order_double'
  | 'order_refresh'
  | 'daily_extra'
  | 'pickle_boost'
  | 'cat_treat'
  | 'unpack_vip';

export const DAILY_AD_LIMITS: Record<DailyAdLimitKey, number> = {
  gacha_free: 1,
  gacha_topup: 2,
  chef_buff: 3,
  order_double: 2,
  order_refresh: 3,
  daily_extra: 1,
  pickle_boost: 3,
  cat_treat: 2,
  unpack_vip: 3,
};

/** 按菜谱品阶差异化的铜勺 / 银勺 / 金勺累计下锅门槛：品质越高所需锅数越精炼，低阶家常菜需长期掌勺积累。 */
export const RECIPE_MASTERY_BY_RARITY: Record<Rarity, readonly [number, number, number]> = {
  common: [12, 36, 90],
  rare: [8, 25, 60],
  epic: [5, 16, 38],
  legendary: [3, 9, 20],
};

export const RECIPE_MASTERY_NEEDS = RECIPE_MASTERY_BY_RARITY.common;

export function recipeMasteryNeeds(idOrRarity: RecipeId | Rarity = 'common'): readonly [number, number, number] {
  if (idOrRarity === 'common' || idOrRarity === 'rare' || idOrRarity === 'epic' || idOrRarity === 'legendary') {
    return RECIPE_MASTERY_BY_RARITY[idOrRarity];
  }
  const rec = recipeById(idOrRarity);
  return RECIPE_MASTERY_BY_RARITY[rec?.rarity ?? 'common'];
}

/** 烹饪台每升 1 级带来的成菜基础售价火候加成（+2%/级，内部 14 级即界面 15 级满级 +28%）。 */
export const STOVE_PRICE_STEP = 0.02;

export function stovePriceMul(tableLevel: number): number {
  return 1 + clampFurnLevel(tableLevel) * STOVE_PRICE_STEP;
}

export function dailyAdUsed(save: KitchenSave, key: DailyAdLimitKey, now = Date.now()): number {
  const rec = save.dailyAdCounts?.[key];
  if (!rec || !sameDayKey(rec.date, todayKey(now))) return 0;
  return Math.max(0, Math.floor(rec.count));
}

export function dailyAdLeft(save: KitchenSave, key: DailyAdLimitKey, now = Date.now()): number {
  return Math.max(0, DAILY_AD_LIMITS[key] - dailyAdUsed(save, key, now));
}

export function canUseDailyAd(save: KitchenSave, key: DailyAdLimitKey, now = Date.now()): boolean {
  return dailyAdLeft(save, key, now) > 0;
}

export function markDailyAdUsed(save: KitchenSave, key: DailyAdLimitKey, now = Date.now()): KitchenSave {
  const date = todayKey(now);
  const count = dailyAdUsed(save, key, now) + 1;
  return {
    ...save,
    dailyAdCounts: { ...(save.dailyAdCounts ?? {}), [key]: { date, count } },
  };
}

export function isChefFireActive(save: Pick<KitchenSave, 'chefFireUntil'>, now = Date.now()): boolean {
  return typeof save.chefFireUntil === 'number' && save.chefFireUntil > now;
}

export function chefFireRemainMs(save: Pick<KitchenSave, 'chefFireUntil'>, now = Date.now()): number {
  if (!isChefFireActive(save, now)) return 0;
  return Math.max(0, (save.chefFireUntil ?? 0) - now);
}

export function activateChefFireByAd(
  save: KitchenSave,
  now = Date.now(),
): { save: KitchenSave; error?: string } {
  if (!canUseDailyAd(save, 'chef_buff', now)) {
    return { save, error: '今天的旺火次数用完啦，明天再来' };
  }
  const base = Math.max(now, save.chefFireUntil ?? 0);
  const next = markDailyAdUsed({ ...save, chefFireUntil: base + CHEF_FIRE_MS }, 'chef_buff', now);
  return { save: next };
}

export function recipeTotalCooked(
  save: Pick<KitchenSave, 'recipeCookCounts' | 'recipesCooked'>,
  recipeId: RecipeId,
): number {
  const raw = save.recipeCookCounts?.[recipeId];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return save.recipesCooked.includes(recipeId) ? 1 : 0;
}

export function recipeMasteryStars(
  cooked: number,
  idOrRarity: RecipeId | Rarity = 'common',
): 0 | 1 | 2 | 3 {
  const needs = recipeMasteryNeeds(idOrRarity);
  if (cooked >= needs[2]) return 3;
  if (cooked >= needs[1]) return 2;
  if (cooked >= needs[0]) return 1;
  return 0;
}

export function recipeMasteryMul(
  cooked: number,
  idOrRarity: RecipeId | Rarity = 'common',
): number {
  const stars = recipeMasteryStars(cooked, idOrRarity);
  if (stars >= 3) return 1.2;
  if (stars >= 2) return 1.1;
  if (stars >= 1) return 1.05;
  return 1;
}

export function recipeMasteryView(
  save: Pick<KitchenSave, 'recipeCookCounts' | 'recipesCooked'>,
  recipeId: RecipeId,
): {
  cooked: number;
  stars: 0 | 1 | 2 | 3;
  nextNeed: number | null;
  title: string;
  bonusText: string;
} {
  const cooked = recipeTotalCooked(save, recipeId);
  const needs = recipeMasteryNeeds(recipeId);
  const stars = recipeMasteryStars(cooked, recipeId);
  if (stars >= 3) {
    return { cooked, stars: 3, nextNeed: null, title: '金勺招牌', bonusText: '售价 +20%' };
  }
  if (stars === 2) {
    return {
      cooked,
      stars: 2,
      nextNeed: needs[2],
      title: '银勺拿手',
      bonusText: `售价 +10%（再做 ${needs[2] - cooked} 锅升金勺送菜谱券）`,
    };
  }
  if (stars === 1) {
    return {
      cooked,
      stars: 1,
      nextNeed: needs[1],
      title: '铜勺初通',
      bonusText: `售价 +5%（再做 ${needs[1] - cooked} 锅升银勺 +10%）`,
    };
  }
  return {
    cooked,
    stars: 0,
    nextNeed: needs[0],
    title: cooked > 0 ? '初试火候' : '未开锅',
    bonusText: `再做 ${needs[0] - cooked} 锅点亮铜勺（售价 +5%）`,
  };
}

function migrateSpecialVisits(raw: unknown): Record<string, { date: string; count: number }> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { date: string; count: number }> = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const rec = val as { date?: unknown; count?: unknown };
    if (typeof rec.date !== 'string' || !rec.date) continue;
    const count = typeof rec.count === 'number' && Number.isFinite(rec.count)
      ? Math.max(0, Math.floor(rec.count))
      : 0;
    out[id] = { date: rec.date, count };
  }
  return out;
}

export function specialVisitCount(save: KitchenSave, id: string, now = Date.now()): number {
  const rec = save.specialVisits[id];
  if (!rec || !sameDayKey(rec.date, todayKey(now))) return 0;
  return rec.count;
}

export function canVisitSpecial(save: KitchenSave, id: string, limit: number, now = Date.now()): boolean {
  return specialVisitCount(save, id, now) < limit;
}

export function markSpecialVisit(save: KitchenSave, id: string, now = Date.now()): KitchenSave {
  const date = todayKey(now);
  const rec = save.specialVisits[id];
  const count = rec && sameDayKey(rec.date, date) ? rec.count + 1 : 1;
  return {
    ...save,
    specialVisits: { ...save.specialVisits, [id]: { date, count } },
  };
}

export function todayKey(now = Date.now()): string {
  const d = new Date(now);
  return normalizeDayKey(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
}

export function normalizeDayKey(raw: string): string {
  const parts = String(raw || '').split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return raw;
  const [y, m, d] = parts;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function sameDayKey(a?: string, b?: string): boolean {
  return !!a && !!b && normalizeDayKey(a) === normalizeDayKey(b);
}

function hashDaySeed(day: string, salt = 0): number {
  let h = (0x811C9DC5 ^ salt) >>> 0;
  for (let i = 0; i < day.length; i++) {
    h = Math.imul(h ^ day.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface GameClubDailyPack {
  foods: Array<{ defId: string; name: string; qty: number }>;
  tickets: number;
}

/** 游戏圈每日鲜货补给包：按今日与厨艺等级确定性挑选 2 份良品/上品稀罕好菜 + 1 张菜谱券。 */
export function dailyGameClubPack(save: Pick<KitchenSave, 'level' | 'dexSeen' | 'dexInspected'>, now = Date.now()): GameClubDailyPack {
  const day = todayKey(now);
  const lv = clampCookLevel(save.level);
  const sortedMarkets = [...MARKETS].sort((a, b) => a.unlockLevel - b.unlockLevel);
  const allowed = sortedMarkets.filter((m) => m.unlockLevel <= lv + 2);
  const poolSet = new Set<string>();
  for (const m of (allowed.length ? allowed : sortedMarkets.slice(0, 2))) {
    for (const id of marketFoodIds(m.id)) {
      if (id !== GOD_PICK.id && !PICKLE_ITEM_IDS.has(id)) poolSet.add(id);
    }
  }
  poolSet.add('chicken_wing');
  const seen = new Set([...(save.dexSeen ?? []), ...(save.dexInspected ?? [])]);
  const weighted: Array<[string, number]> = [];
  for (const id of poolSet) {
    const r = rarityRank(getItem(id).rarity);
    if (r === 0) continue; // 只挑良品/上品/珍品好食材，绝不发白菜土豆充数
    let w = r === 1 ? 5 : r === 2 ? 7 : 3;
    if (!seen.has(id)) w *= 1.5;
    weighted.push([id, w]);
  }
  const fallback: Array<[string, number]> = [
    ['shrimp', 6],
    ['chicken_wing', 6],
    ['mushroom', 5],
    ['ribs', 5],
  ];
  const activePool = weighted.length >= 2 ? weighted : fallback;
  const rng = mulberry32(hashDaySeed(day, 0x6C0B));
  const first = rngWeighted(rng, activePool);
  const secondPool = activePool.filter(([id]) => id !== first);
  const second = rngWeighted(rng, secondPool.length ? secondPool : activePool);
  const foods = first === second
    ? [{ defId: first, name: getItem(first).name, qty: 2 }]
    : [
      { defId: first, name: getItem(first).name, qty: 1 },
      { defId: second, name: getItem(second).name, qty: 1 },
    ];
  return {
    foods,
    tickets: GAME_CLUB_DAILY_TICKETS,
  };
}

export function hasClaimedGameClubToday(save: KitchenSave, now = Date.now()): boolean {
  return sameDayKey(save.gameClubRewardDate, todayKey(now));
}

export function canClaimGameClubReward(save: KitchenSave, postCount: number, now = Date.now()): boolean {
  return postCount >= 1 && !hasClaimedGameClubToday(save, now);
}

export function claimGameClubReward(
  save: KitchenSave,
  postCount: number,
  now = Date.now(),
): {
  save: KitchenSave;
  foods: Array<{ defId: string; name: string; qty: number; folded: boolean }>;
  tickets: number;
  foldGold: number;
  coins: number;
  error?: string;
} {
  const empty = { foods: [], tickets: 0, foldGold: 0, coins: 0 };
  if (postCount < 1) return { save, ...empty, error: '请先在游戏圈发帖' };
  if (hasClaimedGameClubToday(save, now)) return { save, ...empty, error: '今日奖励已领取' };
  const pack = dailyGameClubPack(save, now);
  let nextSave: KitchenSave = {
    ...save,
    recipeTickets: save.recipeTickets + pack.tickets,
    gameClubRewardDate: todayKey(now),
  };
  let foldGold = 0;
  const foodsOut: Array<{ defId: string; name: string; qty: number; folded: boolean }> = [];
  for (const f of pack.foods) {
    const granted = applyNeighborReward(nextSave, { gold: 0, food: { defId: f.defId, qty: f.qty } });
    nextSave = granted.save;
    foldGold += granted.foldGold;
    foodsOut.push({ ...f, folded: granted.foodFolded });
  }
  return {
    save: nextSave,
    foods: foodsOut,
    tickets: pack.tickets,
    foldGold,
    coins: foldGold,
  };
}

/** 距下一本地 0 点的毫秒。页面开着跨日也能把特殊市场次数清掉。 */
export function msUntilLocalMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.max(50, next.getTime() - now);
}

export function defaultSave(now = Date.now()): KitchenSave {
  return {
    version: 1,
    money: 10,
    stamina: STAMINA_MAX,
    staminaAt: now,
    fridge: [],
    basketLevel: 0,
    fridgeExtra: false,
    furnLevels: emptyFurnLevels(),
    houseLevel: 0,
    dexSeen: [],
    dexInspected: [],
    recipesCooked: [],
    recipesFound: [],
    dailyGodPickDate: '',
    lastSeenAt: now,
    level: 1,
    xp: 0,
    seenCards: [],
    seenMarketFoods: [],
    vehicle: 'walk',
    vehicles: ['walk'],
    specialVisits: {},
    neighborOrders: [],
    neighborOfferAt: 0,
    outingBuffs: [],
    kitchenBuffs: [],
    dailyMenu: undefined,
    dailyMenuRewards: [],
    recipeTickets: 0,
    dailyMenuClaimedOn: '',
    gameClubRewardDate: '',
    shareStaminaDate: '',
    dailyAdCounts: {},
    chefFireUntil: 0,
    dexClaimed: [],
    dexMilestones: 0,
    dexStampsClaimed: [],
    recipeCookCounts: {},
    recipeMasteryClaimed: [],
    pickleJars: defaultPickleJars(),
    secondJarUnlocked: false,
    pickleTier: 0,
    strayCat: defaultStrayCat(),
    catBedTier: 0,
    gachaPity: 0,
    seenGuides: [],
    tutorialStep: 0,
    tutorialGiftClaimed: false,
  };
}

function migrateCookCounts(
  raw: unknown,
  cookedList: readonly RecipeId[],
): Partial<Record<RecipeId, number>> {
  const out: Partial<Record<RecipeId, number>> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const rid = migrateRecipeId(k);
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
      if (rid && n > 0) out[rid] = Math.max(out[rid] ?? 0, n);
    }
  }
  for (const rid of cookedList) {
    if (!out[rid] || out[rid]! < 1) out[rid] = 1;
  }
  return out;
}

export function normalizeSave(raw: Partial<KitchenSave> | null, now = Date.now()): KitchenSave {
  const base = defaultSave(now);
  if (!raw) return base;
  const next: KitchenSave = {
    ...base,
    ...raw,
    version: 1,
    level: clampCookLevel(typeof raw.level === 'number' && raw.level > 0 ? raw.level : 1),
    xp: typeof raw.xp === 'number' && raw.xp > 0 ? Math.floor(raw.xp) : 0,
    fridge: migrateFridgeItems(raw.fridge),
    furnLevels: migrateFurnLevels(raw),
    houseLevel: 0,
    dexSeen: Array.isArray(raw.dexSeen) ? raw.dexSeen : [],
    dexInspected: Array.isArray(raw.dexInspected) ? raw.dexInspected : [],
    recipesCooked: migrateRecipeIds(raw.recipesCooked),
    recipesFound: migrateRecipeIds((raw as KitchenSave).recipesFound),
    seenCards: Array.isArray(raw.seenCards) ? raw.seenCards : [],
    seenMarketFoods: migrateSeenMarketFoods(raw, {
      dexSeen: Array.isArray(raw.dexSeen) ? raw.dexSeen : [],
      dexInspected: Array.isArray(raw.dexInspected) ? raw.dexInspected : [],
      seenCards: Array.isArray(raw.seenCards) ? raw.seenCards : [],
    }),
    ...migrateVehicles(raw),
    specialVisits: migrateSpecialVisits((raw as KitchenSave).specialVisits),
    neighborOrders: migrateNeighborOrders((raw as KitchenSave).neighborOrders),
    neighborOfferAt: typeof (raw as KitchenSave).neighborOfferAt === 'number'
      && Number.isFinite((raw as KitchenSave).neighborOfferAt)
      ? Math.max(0, Math.floor((raw as KitchenSave).neighborOfferAt))
      : 0,
    outingBuffs: migrateOutingBuffs(
      (raw as KitchenSave).outingBuffs,
      (raw as { outingBuff?: unknown }).outingBuff,
    ),
    kitchenBuffs: migrateKitchenBuffs(
      (raw as KitchenSave).kitchenBuffs,
      (raw as { kitchenBuff?: unknown }).kitchenBuff,
    ),
    dailyMenu: migrateDailyMenu((raw as KitchenSave).dailyMenu),
    dailyMenuRewards: migrateRecipeIds((raw as KitchenSave).dailyMenuRewards),
    recipeTickets: typeof (raw as KitchenSave).recipeTickets === 'number'
      && Number.isFinite((raw as KitchenSave).recipeTickets)
      ? Math.max(0, Math.floor((raw as KitchenSave).recipeTickets))
      : 0,
    dailyMenuClaimedOn: (() => {
      const rawClaim = (raw as KitchenSave).dailyMenuClaimedOn;
      if (typeof rawClaim === 'string' && rawClaim) return normalizeDayKey(rawClaim);
      const menu = migrateDailyMenu((raw as KitchenSave).dailyMenu);
      return menu?.boardClaimed ? normalizeDayKey(menu.date) : '';
    })(),
    gameClubRewardDate: typeof (raw as KitchenSave).gameClubRewardDate === 'string'
      ? (raw as KitchenSave).gameClubRewardDate
      : '',
    shareStaminaDate: typeof (raw as KitchenSave).shareStaminaDate === 'string'
      ? (raw as KitchenSave).shareStaminaDate
      : '',
    dailyAdCounts: migrateSpecialVisits((raw as KitchenSave).dailyAdCounts),
    chefFireUntil: typeof (raw as KitchenSave).chefFireUntil === 'number'
      && Number.isFinite((raw as KitchenSave).chefFireUntil)
      ? Math.max(0, Math.floor((raw as KitchenSave).chefFireUntil!))
      : 0,
    dexClaimed: Array.isArray((raw as KitchenSave).dexClaimed)
      ? (raw as KitchenSave).dexClaimed!.filter((s): s is string => typeof s === 'string')
      : [],
    dexMilestones: typeof (raw as KitchenSave).dexMilestones === 'number'
      && Number.isFinite((raw as KitchenSave).dexMilestones)
      ? Math.max(0, Math.floor((raw as KitchenSave).dexMilestones!))
      : 0,
    dexStampsClaimed: Array.isArray((raw as KitchenSave).dexStampsClaimed)
      ? (raw as KitchenSave).dexStampsClaimed!.filter(
        (s): s is string => typeof s === 'string' && DEX_STAMP_SETS.some((d) => d.id === s),
      )
      : [],
    recipeCookCounts: migrateCookCounts(
      (raw as KitchenSave).recipeCookCounts,
      migrateRecipeIds(raw.recipesCooked),
    ),
    recipeMasteryClaimed: migrateRecipeIds((raw as KitchenSave).recipeMasteryClaimed),
    pickleJars: migratePickleJars((raw as KitchenSave).pickleJars),
    secondJarUnlocked: !!(raw as KitchenSave).secondJarUnlocked,
    pickleTier: ((raw as KitchenSave).pickleTier === 2 ? 2 : (raw as KitchenSave).pickleTier === 1 ? 1 : 0),
    strayCat: migrateStrayCat((raw as KitchenSave).strayCat),
    catBedTier: ((raw as KitchenSave).catBedTier === 2 ? 2 : (raw as KitchenSave).catBedTier === 1 ? 1 : 0),
    gachaPity: typeof (raw as KitchenSave).gachaPity === 'number'
      && Number.isFinite((raw as KitchenSave).gachaPity)
      ? Math.max(0, Math.floor((raw as KitchenSave).gachaPity!))
      : 0,
    seenGuides: Array.isArray((raw as KitchenSave).seenGuides)
      ? [...new Set((raw as KitchenSave).seenGuides!.filter((s): s is string => typeof s === 'string'))]
      : [],
    tutorialStep: typeof (raw as KitchenSave).tutorialStep === 'number'
      && Number.isFinite((raw as KitchenSave).tutorialStep)
      ? Math.floor((raw as KitchenSave).tutorialStep)
      : 99,
    tutorialGiftClaimed: !!(raw as KitchenSave).tutorialGiftClaimed,
  };
  next.basketLevel = next.furnLevels.basket;
  next.fridgeExtra = next.furnLevels.fridge > 0 || next.furnLevels.foam > 0;
  next.houseLevel = migrateHouseLevel(raw);
  // 追溯同步冰箱里已有食材进图鉴，避免旧档腌菜/阿橘谢礼漏亮图鉴
  const seenSet = new Set(next.dexSeen);
  for (const it of next.fridge) {
    if (fridgeKind(it) === 'food' && it.quality !== 'rotten' && it.defId) {
      seenSet.add(it.defId === GOD_PICK.id && !it.inspected ? 'smallfish' : it.defId);
    }
  }
  next.dexSeen = [...seenSet];
  if (
    (next.dexInspected.includes(GOD_PICK.id) || next.dexSeen.includes(GOD_PICK.id))
    && !next.recipesFound.includes('wild_fish_soup')
  ) {
    next.recipesFound = [...next.recipesFound, 'wild_fish_soup'];
  }
  return next;
}

function migrateRecipeIds(raw: unknown): RecipeId[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeId[] = [];
  for (const id of raw) {
    if (typeof id !== 'string') continue;
    const next = migrateRecipeId(id);
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}

function migrateFridgeItems(raw: unknown): FridgeItem[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map((it) => {
    const row = it as FridgeItem;
    const dish = row.kind === 'dish';
    const defId = dish && typeof row.defId === 'string'
      ? (migrateRecipeId(row.defId) ?? row.defId)
      : row.defId;
    if (dish && !isRecipeId(String(defId))) return null;
    let quality = row.quality;
    if (!dish && quality !== 'rotten' && quality !== 'god') quality = 'common';
    return {
      ...row,
      defId,
      kind: dish ? 'dish' as const : 'food' as const,
      quality,
      inspected: dish || row.defId === 'wild_yellowfish' ? true : (row.inspected ?? true),
      qty: fridgeItemQty(row),
    };
  });
  return dedupeFridgeUids(
    compactFridge(
      mapped.filter((it) => !!it && fridgeItemQty(it) > 0 && (it.kind === 'dish' || it.quality !== 'rotten')) as FridgeItem[],
    ),
  );
}

/** 清理历史存档或合并预览中的重复 uid，防止「冰箱腾格子」点选一格联动误卖另一格。 */
function dedupeFridgeUids(items: FridgeItem[]): FridgeItem[] {
  const seen = new Set<string>();
  return items.map((it) => {
    if (it.uid && !seen.has(it.uid)) {
      seen.add(it.uid);
      return it;
    }
    let fresh = nextUid(it.kind === 'dish' ? 'd' : 'f');
    while (seen.has(fresh)) fresh = nextUid(it.kind === 'dish' ? 'd' : 'f');
    seen.add(fresh);
    return { ...it, uid: fresh };
  });
}

function migrateHouseLevel(raw: Partial<KitchenSave>): number {
  if (typeof raw.houseLevel === 'number') return clampHouseLevel(raw.houseLevel);
  const furn = migrateFurnLevels(raw);
  let need = 0;
  for (const id of FURN_IDS) {
    need = Math.max(need, minHouseForFurn(id, furn[id]));
  }
  return need;
}

function migrateFurnLevels(raw: Partial<KitchenSave>): Record<FurnId, number> {
  const next = emptyFurnLevels();
  const src = raw.furnLevels;
  if (src && typeof src === 'object') {
    for (const id of FURN_IDS) {
      if (typeof src[id] === 'number') next[id] = clampFurnLevel(src[id]);
    }
  }
  if (typeof raw.basketLevel === 'number' && next.basket === 0) {
    next.basket = clampFurnLevel(raw.basketLevel);
  }
  if (raw.fridgeExtra) {
    if (next.fridge === 0) next.fridge = 1;
    if (next.foam === 0) next.foam = 1;
  }
  return next;
}

export function fridgeOwnCap(level: number): number {
  return FRIDGE_CAP[clampFurnLevel(level)] ?? FRIDGE_BASE;
}

export function fridgeCap(save: KitchenSave): number {
  return fridgeOwnCap(furnLevel(save, 'fridge'));
}

export function fridgeRoom(save: KitchenSave): number {
  return Math.max(0, fridgeCap(save) - save.fridge.length);
}

/** 还有空格，或已有格子没叠满，出门还能往回塞。 */
export function fridgeAcceptsOuting(save: KitchenSave): boolean {
  if (fridgeRoom(save) > 0) return true;
  return save.fridge.some((it) => fridgeItemQty(it) < FRIDGE_STACK);
}

function asFridgeItem(it: FridgeDraft): FridgeItem {
  return {
    uid: it.uid ?? nextUid(it.kind === 'dish' ? 'd' : 'f'),
    kind: it.kind === 'dish' ? 'dish' : 'food',
    defId: it.defId,
    quality: it.quality,
    inspected: it.inspected,
    freshness: it.freshness,
    qty: fridgeItemQty(it),
    value: it.value,
  };
}

export function putIntoFridge(fridge: FridgeItem[], item: FridgeItem): FridgeItem[] {
  let left = fridgeItemQty(item);
  const key = fridgeStackKey(item);
  const next = fridge.map((it) => ({ ...it }));
  for (const it of next) {
    if (left <= 0) break;
    if (fridgeStackKey(it) !== key) continue;
    const space = FRIDGE_STACK - fridgeItemQty(it);
    if (space <= 0) continue;
    const add = Math.min(space, left);
    it.qty = fridgeItemQty(it) + add;
    it.freshness = Math.max(it.freshness, item.freshness);
    if (item.value != null) it.value = Math.max(it.value ?? 0, item.value);
    left -= add;
  }
  let first = true;
  while (left > 0) {
    const add = Math.min(FRIDGE_STACK, left);
    next.push({
      ...item,
      uid: first && item.uid ? item.uid : nextUid(item.kind === 'dish' ? 'd' : 'f'),
      qty: add,
    });
    first = false;
    left -= add;
  }
  return next;
}

function compactFridge(items: FridgeItem[]): FridgeItem[] {
  return items.reduce((fridge, it) => putIntoFridge(fridge, { ...it, qty: fridgeItemQty(it) }), [] as FridgeItem[]);
}

export function simulateIngest(fridge: FridgeItem[], items: FridgeDraft[]): FridgeItem[] {
  const next = items.reduce((acc, it) => putIntoFridge(acc, asFridgeItem(it)), fridge.map((row) => ({ ...row })));
  return dedupeFridgeUids(next);
}

/** 和真正进冰箱同一套规则：坏了的丢掉，黄鱼以外都按普通品质叠。 */
export function haulToFridgeDrafts(items: FridgeDraft[]): FridgeDraft[] {
  return items
    .filter((it) => it.quality !== 'rotten')
    .map((it) => ({
      uid: it.uid,
      kind: it.kind === 'dish' ? 'dish' : 'food',
      defId: it.defId,
      quality: it.quality === 'god' ? 'god' : 'common',
      inspected: it.inspected,
      freshness: it.freshness,
      qty: fridgeItemQty(it),
      value: it.value,
    }));
}

/** 这批货叠进现有冰箱后，预计会占哪些格。 */
export function previewFridgeAfterHaul(save: KitchenSave, haul: FridgeDraft[]): FridgeItem[] {
  return simulateIngest(save.fridge, haulToFridgeDrafts(haul));
}

export function fridgeCanFit(save: KitchenSave, items: FridgeDraft[]): boolean {
  return previewFridgeAfterHaul(save, items).length <= fridgeCap(save);
}

/** 这批货还要新开几格。能叠进现有格子的不算。 */
export function fridgeSlotsNeeded(save: KitchenSave, items: FridgeDraft[]): number {
  return Math.max(0, previewFridgeAfterHaul(save, items).length - save.fridge.length);
}

/** 叠好后还多几格，至少要卖掉这么多格。 */
export function fridgeUnpackNeed(save: KitchenSave, haul: FridgeDraft[]): number {
  return Math.max(0, previewFridgeAfterHaul(save, haul).length - fridgeCap(save));
}

/** 按预览格卖掉选中的，剩下的直接成为冰箱。 */
export function settleFridgeUnpack(
  save: KitchenSave,
  haul: ExtractedItem[],
  sellUids: readonly string[],
  now = Date.now(),
): { save: KitchenSave; error?: string; gained: number; kept: number } {
  const cap = fridgeCap(save);
  const preview = previewFridgeAfterHaul(save, haul);
  const sell = new Set(sellUids);
  const sold = preview.filter((it) => sell.has(it.uid));
  const keep = preview.filter((it) => !sell.has(it.uid));
  if (keep.length > cap) {
    return { save, error: `再卖掉 ${keep.length - cap} 格才能装下`, gained: 0, kept: 0 };
  }
  const gold = sold.reduce((sum, it) => sum + fridgeItemPrice(it, save, now), 0);
  const next = noteDex(save, haul);
  return {
    save: {
      ...next,
      fridge: compactFridge(keep),
      money: next.money + gold,
      dailyGodPickDate: keep.some((it) => it.defId === 'wild_yellowfish') ? todayKey(now) : save.dailyGodPickDate,
    },
    gained: gold,
    kept: keep.length,
  };
}

/** 回家爆仓一键解围（激励视频）：街坊按 1.5 倍高价顺路包圆最低价的溢出格，好货全部入柜。 */
export function vipSettleFridgeUnpack(
  save: KitchenSave,
  haul: ExtractedItem[],
  now = Date.now(),
): {
  save: KitchenSave;
  error?: string;
  gained: number;
  soldCount: number;
  kept: number;
} {
  if (!canUseDailyAd(save, 'unpack_vip', now)) {
    return { save, error: '今日街坊顺路包圆次数已用完', gained: 0, soldCount: 0, kept: 0 };
  }
  const cap = fridgeCap(save);
  const preview = previewFridgeAfterHaul(save, haul);
  const need = Math.max(0, preview.length - cap);
  if (need <= 0) {
    const next = markDailyAdUsed(ingestExtract(save, haul, now), 'unpack_vip', now);
    return { save: next, gained: 0, soldCount: 0, kept: next.fridge.length };
  }
  // 优先挑非野生黄鱼、非熟菜、单格总价最低的格子卖给街坊，保住珍贵食材与熟菜
  const ranked = [...preview].sort((a, b) => {
    const aGod = a.defId === GOD_PICK.id ? 1 : 0;
    const bGod = b.defId === GOD_PICK.id ? 1 : 0;
    if (aGod !== bGod) return aGod - bGod;
    const aDish = fridgeKind(a) === 'dish' ? 1 : 0;
    const bDish = fridgeKind(b) === 'dish' ? 1 : 0;
    if (aDish !== bDish) return aDish - bDish;
    const aPrice = fridgeItemPrice(a, save, now);
    const bPrice = fridgeItemPrice(b, save, now);
    return aPrice - bPrice;
  });
  const sellSet = new Set(ranked.slice(0, need).map((it) => it.uid));
  const sold = preview.filter((it) => sellSet.has(it.uid));
  const keep = preview.filter((it) => !sellSet.has(it.uid));
  const baseGold = sold.reduce((sum, it) => sum + fridgeItemPrice(it, save, now), 0);
  const gained = Math.max(need * 3, Math.ceil(baseGold * 1.5));
  const noted = noteDex(save, haul);
  const marked = markDailyAdUsed({
    ...noted,
    fridge: compactFridge(keep),
    money: noted.money + gained,
    dailyGodPickDate: keep.some((it) => it.defId === 'wild_yellowfish') ? todayKey(now) : save.dailyGodPickDate,
  }, 'unpack_vip', now);
  return {
    save: marked,
    gained,
    soldCount: sold.length,
    kept: keep.length,
  };
}

function consumeFridgeQty(fridge: FridgeItem[], used: Map<string, number>): FridgeItem[] {
  const next: FridgeItem[] = [];
  const left = new Map<string, number>();
  for (const [uid, take] of used) left.set(uid, take);
  for (const it of fridge) {
    const take = Math.min(left.get(it.uid) ?? 0, fridgeItemQty(it));
    if (take > 0) left.set(it.uid, (left.get(it.uid) ?? 0) - take);
    const qty = fridgeItemQty(it) - take;
    if (qty <= 0) continue;
    next.push(qty === fridgeItemQty(it) ? it : { ...it, qty });
  }
  return compactFridge(next);
}

/** 按格扣刚挑中的料，不按 uid 一把扣光。几格共用 uid 时，Map 扣法会多扣或扣空。 */
function consumePickedFoods(fridge: FridgeItem[], picked: { defId: string }[]): FridgeItem[] {
  const left = fridge.map((it) => fridgeItemQty(it));
  for (const want of picked) {
    let best = -1;
    for (let i = 0; i < fridge.length; i++) {
      if (left[i] <= 0) continue;
      const it = fridge[i];
      if (fridgeKind(it) === 'dish' || it.quality === 'rotten') continue;
      if (it.defId !== want.defId) continue;
      if (best < 0 || it.freshness > fridge[best].freshness) best = i;
    }
    if (best >= 0) left[best] -= 1;
  }
  const next: FridgeItem[] = [];
  for (let i = 0; i < fridge.length; i++) {
    if (left[i] <= 0) continue;
    next.push(left[i] === fridgeItemQty(fridge[i]) ? fridge[i] : { ...fridge[i], qty: left[i] });
  }
  return compactFridge(next);
}

export function countFridgeFood(fridge: readonly FridgeItem[], defId: string): number {
  let sum = 0;
  for (const it of fridge) {
    if (fridgeKind(it) === 'dish' || it.quality === 'rotten') continue;
    if (it.defId === defId) sum += fridgeItemQty(it);
  }
  return sum;
}

export function deductFridgeFoods(
  fridge: FridgeItem[],
  reqs: ReadonlyArray<{ defId: string; qty: number }>,
): { fridge: FridgeItem[]; ok: boolean } {
  const flat: Array<{ defId: string }> = [];
  for (const r of reqs) {
    const need = Math.max(0, Math.floor(r.qty));
    if (countFridgeFood(fridge, r.defId) < need) return { fridge, ok: false };
    for (let i = 0; i < need; i++) flat.push({ defId: r.defId });
  }
  return { fridge: consumePickedFoods(fridge, flat), ok: true };
}

export function regenStamina(save: KitchenSave, now = Date.now()): KitchenSave {
  const cap = staminaMax(save);
  if (save.stamina >= cap) return { ...save, staminaAt: now };
  const elapsed = Math.max(0, now - save.staminaAt);
  const gained = Math.floor(elapsed / STAMINA_REGEN_MS);
  if (gained <= 0) return save;
  const stamina = Math.min(cap, save.stamina + gained);
  const leftover = elapsed % STAMINA_REGEN_MS;
  return { ...save, stamina, staminaAt: now - leftover };
}

export function decayFridge(save: KitchenSave, now = Date.now()): KitchenSave {
  return { ...save, lastSeenAt: now };
}

/** 街坊交菜：金币入账；说好的食材塞冰箱，满了就按普通价折金。 */
export function applyNeighborReward(save: KitchenSave, reward: NeighborReward): {
  save: KitchenSave;
  gold: number;
  foodName?: string;
  foodDefId?: string;
  foodFolded: boolean;
  foldGold: number;
} {
  let next: KitchenSave = { ...save, money: save.money + reward.gold };
  let foodName: string | undefined;
  let foodDefId: string | undefined;
  let foodFolded = false;
  let foldGold = 0;
  const food = reward.food;
  if (food && isNeighborRewardFood(food.defId)) {
    const qty = Math.max(1, Math.floor(food.qty || 1));
    foodDefId = food.defId;
    foodName = getItem(food.defId).name;
    const draft: FridgeDraft = {
      defId: food.defId,
      quality: 'common',
      inspected: true,
      freshness: initialFreshness('common'),
      qty,
    };
    if (fridgeCanFit(next, [draft])) {
      const fridge = putIntoFridge(next.fridge, {
        uid: nextUid('f'),
        kind: 'food',
        ...draft,
      });
      next = discoverFood({ ...next, fridge }, food.defId).save;
    } else {
      foldGold = sellPrice(food.defId, 'common', true) * qty;
      next = discoverFood({ ...next, money: next.money + foldGold }, food.defId).save;
      foodFolded = true;
    }
  }
  return { save: next, gold: reward.gold, foodName, foodDefId, foodFolded, foldGold };
}

/** 第一次见到这味可用食材：写进图鉴并返回 true。坏了的不算见过。 */
export function discoverFood(
  save: KitchenSave,
  defId: string,
  quality?: Quality,
): { save: KitchenSave; first: boolean } {
  if (quality === 'rotten') return { save, first: false };
  if (!defId || save.dexSeen.includes(defId) || save.dexInspected.includes(defId)) {
    return { save, first: false };
  }
  return { save: { ...save, dexSeen: [...save.dexSeen, defId] }, first: true };
}

/** 这个菜场见过这味，图鉴里已有也要记，探索度才按场算。 */
export function noteMarketFood(save: KitchenSave, marketId: MarketId, defId: string, quality?: Quality): KitchenSave {
  if (quality === 'rotten' || !defId) return save;
  const key = marketFoodKey(marketId, defId);
  if (save.seenMarketFoods.includes(key)) return save;
  return { ...save, seenMarketFoods: [...save.seenMarketFoods, key] };
}

export function noteDex(save: KitchenSave, items: ExtractedItem[]): KitchenSave {
  const dexSeen = new Set(save.dexSeen);
  const dexInspected = new Set(save.dexInspected);
  for (const it of items) {
    if (it.quality === 'rotten') continue;
    dexSeen.add(it.inspected ? it.defId : (it.defId === 'wild_yellowfish' ? 'smallfish' : it.defId));
    if (it.inspected) dexInspected.add(it.defId);
  }
  const unlockedWildFish = (dexInspected.has(GOD_PICK.id) || dexSeen.has(GOD_PICK.id))
    && !save.recipesFound.includes('wild_fish_soup');
  const recipesFound: RecipeId[] = unlockedWildFish
    ? [...save.recipesFound, 'wild_fish_soup']
    : save.recipesFound;
  return { ...save, dexSeen: [...dexSeen], dexInspected: [...dexInspected], recipesFound };
}

export function ingestExtract(save: KitchenSave, items: ExtractedItem[], now = Date.now()): KitchenSave {
  const keep = items.filter((it) => it.quality !== 'rotten');
  const incoming: FridgeItem[] = keep.map((it) => ({
    uid: it.uid,
    kind: 'food',
    defId: it.defId,
    quality: it.quality === 'god' ? 'god' : it.quality === 'rotten' ? 'rotten' : 'common',
    inspected: it.inspected,
    freshness: it.freshness,
    qty: 1,
  }));
  const next = noteDex(save, keep);
  return {
    ...next,
    fridge: compactFridge(incoming.reduce((fridge, it) => putIntoFridge(fridge, it), next.fridge)),
    dailyGodPickDate: keep.some((it) => it.defId === 'wild_yellowfish') ? todayKey(now) : save.dailyGodPickDate,
  };
}

export function eatDish(
  save: KitchenSave,
  uid: string,
  qty = 1,
  now = Date.now(),
): { save: KitchenSave; error?: string; stamina?: number; name?: string; toast?: string; nudgeOffer?: boolean } {
  const item = save.fridge.find((it) => it.uid === uid);
  if (!item) return { save, error: '冰箱里没有这道菜' };
  if (fridgeKind(item) !== 'dish') return { save, error: '生食不能这么吃' };
  if (!isRecipeId(item.defId)) return { save, error: '未知菜谱' };
  const recipe = recipeById(item.defId);
  if (!recipe) return { save, error: '未知菜谱' };
  const next = regenStamina(save, now);
  const cap = staminaMax(next);
  const staminaEach = recipeEatStaminaGain(recipe.id);
  const have = fridgeItemQty(item);
  const want = Math.min(have, Math.max(1, Math.floor(qty)));
  const room = cap - next.stamina;
  const portions = staminaEach > 0
    ? Math.min(want, Math.max(0, Math.floor(room / staminaEach)))
    : 1;
  if (staminaEach > 0 && portions <= 0) {
    return { save: next, error: '体力满了，换盘有出门用的' };
  }
  const applied = applyEatEffects(next, recipe.id, portions, cap, now);
  if (applied.error) return { save: applied.save, error: applied.error, name: recipe.name };
  return {
    save: {
      ...applied.save,
      fridge: consumeFridgeQty(applied.save.fridge, new Map([[uid, portions]])),
    },
    stamina: applied.stamina,
    name: recipe.name,
    toast: applied.toast,
    nudgeOffer: applied.nudgeOffer,
  };
}

export function sellFridgeQty(
  save: KitchenSave,
  uid: string,
  qty: number,
): { save: KitchenSave; gained: number; error?: string } {
  const item = save.fridge.find((it) => it.uid === uid);
  if (!item) return { save, gained: 0, error: '冰箱里没有这件' };
  const unit = fridgeItemUnitPrice(item, save);
  if (unit <= 0) return { save, gained: 0, error: '这些卖不掉' };
  const n = Math.min(fridgeItemQty(item), Math.max(1, Math.floor(qty)));
  const gained = unit * n;
  return {
    save: {
      ...save,
      fridge: consumeFridgeQty(save.fridge, new Map([[uid, n]])),
      money: save.money + gained,
    },
    gained,
  };
}

export function sellItems(save: KitchenSave, uids: string[]): { save: KitchenSave; gained: number } {
  let gained = 0;
  const remain: FridgeItem[] = [];
  for (const it of save.fridge) {
    if (!uids.includes(it.uid)) {
      remain.push(it);
      continue;
    }
    gained += fridgeItemPrice(it, save);
  }
  return { save: { ...save, fridge: remain, money: save.money + gained }, gained };
}

/** 这道熟菜还能往冰箱里叠几份。 */
export function fridgeDishRoom(save: KitchenSave, recipeId: RecipeId): number {
  const draft: FridgeDraft = {
    kind: 'dish',
    defId: recipeId,
    quality: 'fresh',
    inspected: true,
    freshness: 4,
  };
  const key = fridgeStackKey(draft);
  let stack = 0;
  for (const it of save.fridge) {
    if (fridgeStackKey(it) === key) stack += Math.max(0, FRIDGE_STACK - fridgeItemQty(it));
  }
  return stack + fridgeRoom(save) * FRIDGE_STACK;
}

/** 材料和冰箱都够的话，一次最多能连做几份。 */
export function recipeCookMax(save: KitchenSave, recipeId: RecipeId): number {
  return Math.min(recipeCookCount(recipeUnlockView(save), recipeId), fridgeDishRoom(save, recipeId));
}

export function cookRecipe(
  save: KitchenSave,
  recipeId: RecipeId,
  times = 1,
  uids?: string[],
): {
  save: KitchenSave;
  error?: string;
  xp?: number;
  levels?: number;
  cooked?: number;
  doubled?: boolean;
  foldGold?: number;
  masteryTickets?: number;
} {
  const want = Math.max(1, Math.floor(times));
  let next = save;
  let xp = 0;
  let levels = 0;
  let cooked = 0;
  let doubled = false;
  let foldGold = 0;
  let masteryTickets = 0;
  for (let i = 0; i < want; i++) {
    const once = cookRecipeOnce(next, recipeId, uids);
    if (once.error) {
      if (cooked === 0) return once;
      break;
    }
    next = once.save;
    xp += once.xp ?? 0;
    levels += once.levels ?? 0;
    cooked += 1;
    if (once.doubled) doubled = true;
    foldGold += once.foldGold ?? 0;
    masteryTickets += once.masteryTicket ?? 0;
  }
  return { save: next, xp, levels, cooked, doubled, foldGold, masteryTickets };
}

function cookRecipeOnce(
  save: KitchenSave,
  recipeId: RecipeId,
  uids?: string[],
): {
  save: KitchenSave;
  error?: string;
  xp?: number;
  levels?: number;
  doubled?: boolean;
  foldGold?: number;
  masteryTicket?: number;
} {
  const recipe = recipeById(recipeId);
  if (!recipe) return { save, error: '未知菜谱' };
  const view = recipeUnlockView(save);
  if (!isRecipeUnlocked(view, recipeId)) return { save, error: '还不会这道菜' };
  if (!isRecipeStoveReady(view, recipeId)) {
    return { save, error: `需升至 ${recipeMinStoveLv(recipeId)} 级烹饪台才能做这道菜` };
  }
  const items = uids?.length
    ? pickRecipeFoods({ ...view, fridge: save.fridge.filter((it) => uids.includes(it.uid)) }, recipeId)
    : pickRecipeFoods(view, recipeId);
  if (!items.length) return { save, error: `材料不够：${recipe.desc}` };
  if (items.some((it) => it.quality === 'rotten')) return { save, error: '坏了，不能下锅' };
  if (!recipe.match(items)) return { save, error: `材料不对：${recipe.desc}` };
  const prevCooked = recipeTotalCooked(save, recipeId);
  const value = Math.round(
    recipe.cook(items)
    * recipeMasteryMul(prevCooked, recipe.rarity)
    * stovePriceMul(furnLevel(save, 'table')),
  );
  const dish: FridgeItem = {
    uid: nextUid('d'),
    kind: 'dish',
    defId: recipeId,
    quality: 'fresh',
    inspected: true,
    freshness: 4,
    qty: 1,
    value,
  };
  let fridge = putIntoFridge(consumePickedFoods(save.fridge, items), dish);
  if (fridge.length > fridgeCap(save)) return { save, error: '冰箱满了，腾一格再做菜' };
  const singleDouble = kitchenHasCookDouble(save);
  const fireActive = isChefFireActive(save);
  const doubled = singleDouble || (fireActive && Math.random() < CHEF_FIRE_DOUBLE_CHANCE);
  let foldGold = 0;
  if (doubled) {
    const extra: FridgeItem = { ...dish, uid: nextUid('d') };
    const after: KitchenSave = { ...save, fridge };
    if (fridgeCanFit(after, [extra])) {
      fridge = putIntoFridge(fridge, extra);
    } else {
      foldGold = value;
    }
  }
  const first = !save.recipesCooked.includes(recipeId);
  const recipesCooked = first ? [...save.recipesCooked, recipeId] : save.recipesCooked;
  const newCooked = prevCooked + 1;
  const recipeCookCounts: Partial<Record<RecipeId, number>> = {
    ...(save.recipeCookCounts ?? {}),
    [recipeId]: newCooked,
  };
  let recipeMasteryClaimed = save.recipeMasteryClaimed ?? [];
  let masteryTicket = 0;
  const goldNeed = recipeMasteryNeeds(recipe.rarity)[2];
  if (newCooked >= goldNeed && !recipeMasteryClaimed.includes(recipeId)) {
    recipeMasteryClaimed = [...recipeMasteryClaimed, recipeId];
    masteryTicket = 1;
  }
  const xpMul = Math.max(kitchenCookXpMul(save), fireActive ? CHEF_FIRE_XP_MUL : 1);
  const gained = Math.round((recipe.xp + (first ? recipe.firstXp : 0)) * xpMul);
  let granted = grantCookXp({
    ...save,
    fridge,
    recipesCooked,
    recipeCookCounts,
    recipeMasteryClaimed,
    recipeTickets: save.recipeTickets + masteryTicket,
    money: save.money + foldGold,
  }, gained);
  granted = { ...granted, save: consumeCookXpBuff(granted.save) };
  if (singleDouble) granted = { ...granted, save: consumeCookDoubleBuff(granted.save) };
  return {
    save: granted.save,
    xp: granted.gained,
    levels: granted.levels,
    doubled,
    foldGold,
    masteryTicket,
  };
}

export function upgradeCost(id: FurnId, fromLevel: number): number {
  const lv = clampFurnLevel(fromLevel);
  // 食材表改成按占格公式化定价后整体涨了一档，这里同步抬价，
  // 否则一趟菜场就能换一次升级，攒钱又变得没有挑战。
  // 前两级单独打折，开局先把烹饪台和篮子抬起来。1→2 再让一截，一趟巷口就够抬一件。
  // 内部 0–4（升到界面 5 级）维持 1.38。从内部 5 起锚在 4 级现价，之后每级 ×1.72。
  const base: Record<FurnId, number> = {
    fridge: 90,
    table: 65,
    basket: 72,
    foam: 55,
  };
  const early = lv === 0 ? 0.45 : lv === 1 ? 0.72 : 1;
  if (lv <= 4) return Math.round(base[id] * Math.pow(1.38, lv) * early);
  const anchor = Math.round(base[id] * Math.pow(1.38, 4));
  return Math.round(anchor * Math.pow(1.72, lv - 4));
}

export const HOUSE_UPGRADE_COST = [380, 2800, 9000, 22000];
/** 陋屋→精装屋厨艺 4，精装→雅致 8，雅致→宽宅 16，宽宅→宅院 20。 */
export const HOUSE_COOK_NEED = [4, 8, 16, 20];
export const COOK_LEVEL_MAX = 25;
/**
 * COOK_XP_TO_NEXT[当前厨艺] = 升到下一级所需。
 * 前 8 级维持原曲线；9→15 削平；16→25 沿后段每级 +120。
 */
export const COOK_XP_TO_NEXT = [
  0, 60, 110, 180, 250, 340, 450, 580, 720, 820, 940, 1060, 1180, 1300, 1420,
  1540, 1660, 1780, 1900, 2020, 2140, 2260, 2380, 2500, 2620,
];
const COOK_XP_MAXED = COOK_XP_TO_NEXT[COOK_LEVEL_MAX - 1];

/** 烹饪台从当前内部等级再升一级时新解锁几本。10 级以后不送菜谱。 */
export function tableUnlockNext(fromLevel: number): number {
  return TABLE_UNLOCKS[clampFurnLevel(fromLevel)]?.length ?? 0;
}

/** 升到下一级家具所需厨艺。下标是当前内部等级 0–13。 */
const FURN_COOK_NEED: Record<FurnId, number[]> = {
  table: [1, 3, 3, 5, 7, 9, 11, 12, 13, 16, 18, 20, 22, 24],
  fridge: [1, 1, 3, 4, 5, 6, 7, 9, 11, 15, 17, 18, 20, 22],
  basket: [1, 2, 3, 4, 5, 6, 7, 9, 11, 15, 17, 18, 20, 22],
  foam: [1, 1, 3, 4, 5, 6, 7, 9, 11, 15, 17, 18, 20, 22],
};

export function clampCookLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(COOK_LEVEL_MAX, Math.floor(level)));
}

export function cookLevel(save: KitchenSave): number {
  return clampCookLevel(save.level);
}

export function cookXp(save: KitchenSave): number {
  return Math.max(0, Math.floor(save.xp ?? 0));
}

export function xpToNext(level: number): number {
  const lv = clampCookLevel(level);
  if (lv >= COOK_LEVEL_MAX) return 0;
  return COOK_XP_TO_NEXT[lv] ?? 0;
}

export function cookXpView(save: KitchenSave): {
  level: number;
  xp: number;
  need: number;
  fill: number;
  maxed: boolean;
  text: string;
} {
  const level = cookLevel(save);
  const maxed = level >= COOK_LEVEL_MAX;
  const need = maxed ? COOK_XP_MAXED : xpToNext(level);
  const xp = maxed ? need : Math.min(cookXp(save), need);
  return {
    level,
    xp,
    need,
    fill: need > 0 ? xp / need : 1,
    maxed,
    text: maxed ? '已满级' : `${xp}/${need}`,
  };
}

export function grantCookXp(save: KitchenSave, amount: number): { save: KitchenSave; gained: number; levels: number } {
  const gained = Math.max(0, Math.floor(amount));
  if (gained <= 0) return { save, gained: 0, levels: 0 };
  let level = cookLevel(save);
  let xp = cookXp(save);
  let levels = 0;
  if (level >= COOK_LEVEL_MAX) {
    return { save: { ...save, level: COOK_LEVEL_MAX, xp: COOK_XP_MAXED }, gained, levels: 0 };
  }
  xp += gained;
  while (level < COOK_LEVEL_MAX) {
    const need = xpToNext(level);
    if (need <= 0 || xp < need) break;
    xp -= need;
    level += 1;
    levels += 1;
  }
  if (level >= COOK_LEVEL_MAX) xp = COOK_XP_MAXED;
  return { save: { ...save, level, xp }, gained, levels };
}

export function furnCookNeed(id: FurnId, fromLevel: number): number {
  const lv = clampFurnLevel(fromLevel);
  return FURN_COOK_NEED[id]?.[lv] ?? 1;
}

export function houseCookNeed(fromLevel: number): number {
  const h = clampHouseLevel(fromLevel);
  if (h >= HOUSE_MAX_LEVEL) return 1;
  return HOUSE_COOK_NEED[h] ?? 1;
}

export function houseUpgradeCost(fromLevel: number): number {
  const h = clampHouseLevel(fromLevel);
  if (h >= HOUSE_MAX_LEVEL) return 0;
  return HOUSE_UPGRADE_COST[h];
}

export type HouseUpgradeState =
  | { status: 'max' }
  | { status: 'ready'; cost: number }
  | { status: 'blocked'; cost: number; error: string };

export function houseUpgradeState(save: KitchenSave): HouseUpgradeState {
  const level = houseLevel(save);
  if (level >= HOUSE_MAX_LEVEL) return { status: 'max' };
  const cost = houseUpgradeCost(level);
  const need = houseCookNeed(level);
  if (cookLevel(save) < need) {
    return { status: 'blocked', cost, error: `厨艺 ${need} 级才能升` };
  }
  if (save.money < cost) return { status: 'blocked', cost, error: `差 ${cost - save.money} 金币` };
  return { status: 'ready', cost };
}

export function buyHouseUpgrade(save: KitchenSave): { save: KitchenSave; error?: string } {
  const state = houseUpgradeState(save);
  if (state.status === 'max') return { save, error: '屋子已经最大了' };
  if (state.status === 'blocked') return { save, error: state.error };
  const level = houseLevel(save);
  return { save: { ...save, money: save.money - state.cost, houseLevel: level + 1 } };
}

export type FurnUpgradeState =
  | { status: 'max' }
  | { status: 'ready'; cost: number }
  | { status: 'blocked'; cost: number; error: string };

export function furnUpgradeState(save: KitchenSave, id: FurnId): FurnUpgradeState {
  const level = furnLevel(save, id);
  if (level >= FURN_MAX_LEVEL) return { status: 'max' };
  const cost = upgradeCost(id, level);
  const cap = houseFurnCap(houseLevel(save), id);
  if (level >= cap) {
    const need = minHouseForFurn(id, level + 1);
    return {
      status: 'blocked',
      cost,
      error: `先把屋子装修到${houseLabel(need)}，才能升级${furnLabel(id, level)}`,
    };
  }
  const cookNeed = furnCookNeed(id, level);
  if (cookLevel(save) < cookNeed) {
    return { status: 'blocked', cost, error: `厨艺 ${cookNeed} 级才能升` };
  }
  if (save.money < cost) return { status: 'blocked', cost, error: `差 ${cost - save.money} 金币` };
  return { status: 'ready', cost };
}

export function buyFurnUpgrade(save: KitchenSave, id: FurnId): { save: KitchenSave; error?: string } {
  const state = furnUpgradeState(save, id);
  if (state.status === 'max') return { save, error: '已经最高级了' };
  if (state.status === 'blocked') return { save, error: state.error };
  const level = furnLevel(save, id);
  const cost = state.cost;
  const furnLevels = { ...save.furnLevels, [id]: level + 1 };
  return {
    save: {
      ...save,
      money: save.money - cost,
      furnLevels,
      basketLevel: furnLevels.basket,
      fridgeExtra: furnLevels.fridge > 0 || furnLevels.foam > 0,
    },
  };
}

export function buyUpgrade(save: KitchenSave, kind: 'basket1' | 'basket2' | 'fridge'): { save: KitchenSave; error?: string } {
  if (kind === 'fridge') return buyFurnUpgrade(save, 'fridge');
  return buyFurnUpgrade(save, 'basket');
}

export function buyVehicle(save: KitchenSave, id: VehicleId): { save: KitchenSave; error?: string } {
  const def = vehicleById(id);
  if (def.cost <= 0) return { save, error: '走路不用买' };
  if (ownsVehicle(save, id)) return { save, error: '已经有了' };
  if (vehicleOffer(save, id) === 'locked') {
    const prev = VEHICLES[vehicleIndex(id) - 1];
    return { save, error: `先买${prev?.name ?? '上一辆'}` };
  }
  if (save.money < def.cost) return { save, error: `差 ${def.cost - save.money} 金币，先回家卖点菜` };
  const vehicles = save.vehicles.includes(id) ? save.vehicles : [...save.vehicles, id];
  return { save: { ...save, money: save.money - def.cost, vehicles, vehicle: id } };
}

export function selectVehicle(save: KitchenSave, id: VehicleId): KitchenSave {
  if (!ownsVehicle(save, id) || save.vehicle === id) return save;
  return { ...save, vehicle: id };
}

export function spendStamina(
  save: KitchenSave,
  amount = 1,
  now = Date.now(),
): { save: KitchenSave; error?: string } {
  const next = regenStamina(save, now);
  const cost = Math.max(1, Math.floor(amount));
  if (next.stamina < cost) return { save: next, error: '没有体力了' };
  const stamina = next.stamina - cost;
  const cap = staminaMax(next);
  return { save: { ...next, stamina, staminaAt: stamina >= cap ? now : next.staminaAt } };
}

export function addStamina(save: KitchenSave, n = 1, now = Date.now()): KitchenSave {
  const next = regenStamina(save, now);
  const cap = staminaMax(next);
  return { ...next, stamina: Math.min(cap, next.stamina + n) };
}

export function dailyMenuView(save: KitchenSave, now = Date.now()): DailyMenuRollView {
  return {
    tutorialStep: save.tutorialStep,
    level: save.level,
    recipesFound: save.recipesFound,
    recipesCooked: save.recipesCooked,
    fridge: save.fridge,
    tableLevel: furnLevel(save, 'table'),
    dexSeen: save.dexSeen,
    dexInspected: save.dexInspected,
    hangingRecipeIds: liveNeighborOrders(save.neighborOrders, now).map((order) => order.recipeId),
    dailyMenu: save.dailyMenu,
    dailyMenuRewards: save.dailyMenuRewards,
    dailyMenuClaimedOn: save.dailyMenuClaimedOn,
  };
}

export function claimDailyMenuBoardIfReady(save: KitchenSave): { save: KitchenSave; tickets: number } {
  const menu = save.dailyMenu;
  if (!menu || !dailyMenuComplete(menu) || menu.boardClaimed) return { save, tickets: 0 };
  const tickets = Math.max(1, menu.board?.tickets ?? 1);
  return {
    save: {
      ...save,
      recipeTickets: save.recipeTickets + tickets,
      dailyMenuClaimedOn: menu.date,
      dailyMenu: { ...menu, board: { tickets }, boardClaimed: true },
    },
    tickets,
  };
}

export function ensureDailyMenu(save: KitchenSave, now = Date.now()): KitchenSave {
  const date = todayKey(now);
  const menu = ensureDailyMenuState(dailyMenuView(save, now), date);
  let next: KitchenSave = menu === save.dailyMenu ? save : { ...save, dailyMenu: menu };
  if (menu?.boardClaimed && sameDayKey(menu.date, date) && !sameDayKey(next.dailyMenuClaimedOn, date)) {
    next = { ...next, dailyMenuClaimedOn: date };
  }
  return claimDailyMenuBoardIfReady(next).save;
}

export function consumeFridgeDish(
  save: KitchenSave,
  recipeId: RecipeId,
  qty = 1,
): { save: KitchenSave; error?: string; consumed: number } {
  const want = Math.max(1, Math.floor(qty));
  const used = new Map<string, number>();
  let left = want;
  for (const it of save.fridge) {
    if (left <= 0) break;
    if (fridgeKind(it) !== 'dish' || it.defId !== recipeId) continue;
    const take = Math.min(fridgeItemQty(it), left);
    if (take <= 0) continue;
    used.set(it.uid, take);
    left -= take;
  }
  if (left > 0) return { save, error: '冰箱里没有这道菜', consumed: 0 };
  return { save: { ...save, fridge: consumeFridgeQty(save.fridge, used) }, consumed: want };
}

export function submitDailyMenu(
  save: KitchenSave,
  recipeId: RecipeId,
  now = Date.now(),
): {
  save: KitchenSave;
  error?: string;
  foodName?: string;
  foodDefId?: string;
  foodFolded: boolean;
  foldGold: number;
  gold: number;
  tickets: number;
} {
  const empty = { foodFolded: false as const, foldGold: 0, gold: 0, tickets: 0 };
  const nextSave = ensureDailyMenu(save, now);
  const menu = nextSave.dailyMenu;
  const line = menu?.lines.find((row) => row.recipeId === recipeId);
  if (!menu || !line) return { save: nextSave, error: '今天没有这道菜单', ...empty };
  if (line.done >= line.need) {
    return { save: nextSave, error: '这道已经交过了', ...empty };
  }
  const taken = consumeFridgeDish(nextSave, recipeId, 1);
  if (taken.error) return { save: nextSave, error: taken.error, ...empty };

  const lines = menu.lines.map((row) => (
    row.recipeId === recipeId ? { ...row, done: row.done + 1 } : row
  ));
  const updated = lines.find((row) => row.recipeId === recipeId)!;
  let next: KitchenSave = { ...taken.save, dailyMenu: { ...menu, lines } };
  let gold = 0;
  let foodName: string | undefined;
  let foodDefId: string | undefined;
  let foodFolded = false;
  let foldGold = 0;

  if (updated.done >= updated.need) {
    const granted = applyNeighborReward(next, { gold: line.gold, food: line.food });
    next = granted.save;
    gold += granted.gold;
    foodName = granted.foodName;
    foodDefId = granted.foodDefId;
    foodFolded = granted.foodFolded;
    foldGold += granted.foldGold;
  }

  const claimed = claimDailyMenuBoardIfReady(next);
  if (claimed.tickets > 0) next = claimed.save;

  return {
    save: next,
    foodName,
    foodDefId,
    foodFolded,
    foldGold,
    gold,
    tickets: claimed.tickets,
  };
}

export function submitNeighborOrder(
  save: KitchenSave,
  orderId: string,
  now = Date.now(),
  opts?: { doubled?: boolean },
): {
  save: KitchenSave;
  error?: string;
  foodName?: string;
  foodDefId?: string;
  foodFolded: boolean;
  foldGold: number;
  gold: number;
} {
  const empty = { foodFolded: false as const, foldGold: 0, gold: 0 };
  const match = liveNeighborOrders(save.neighborOrders, now).find((order) => order.id === orderId);
  if (!match) return { save, error: '这单没了', ...empty };
  if (opts?.doubled && !canUseDailyAd(save, 'order_double', now)) {
    return { save, error: '今日双倍打赏次数已用完', ...empty };
  }
  const taken = consumeFridgeDish(save, match.recipeId, 1);
  if (taken.error) return { save, error: taken.error, ...empty };
  const baseReward = match.reward ?? { gold: neighborOrderBonus(match.recipeId) };
  const mul = opts?.doubled ? 2 : 1;
  const stampSellMul = dexActiveBonuses(save).dishSellMul;
  const reward: NeighborReward = {
    gold: Math.round(baseReward.gold * stampSellMul) * mul,
    food: baseReward.food
      ? { ...baseReward.food, qty: Math.max(1, Math.floor(baseReward.food.qty || 1)) * mul }
      : undefined,
  };
  let afterTaken = taken.save;
  if (opts?.doubled) {
    afterTaken = markDailyAdUsed(afterTaken, 'order_double', now);
  }
  const granted = applyNeighborReward(afterTaken, reward);
  return {
    save: {
      ...granted.save,
      neighborOrders: liveNeighborOrders(granted.save.neighborOrders, now).filter((order) => order.id !== match.id),
      neighborOfferAt: Math.max(granted.save.neighborOfferAt, now + NEIGHBOR_COOLDOWN.accept),
    },
    foodName: granted.foodName,
    foodDefId: granted.foodDefId,
    foodFolded: granted.foodFolded,
    foldGold: granted.foldGold,
    gold: granted.gold,
  };
}

export function refreshNeighborOrderByAd(
  save: KitchenSave,
  orderId: string,
  now = Date.now(),
): { save: KitchenSave; error?: string; nextOrder?: NeighborOrder } {
  if (!canUseDailyAd(save, 'order_refresh', now)) {
    return { save, error: '今日换单次数已用完' };
  }
  const live = liveNeighborOrders(save.neighborOrders, now);
  const target = live.find((o) => o.id === orderId);
  if (!target) return { save, error: '这单已经不在了' };
  const others = live.filter((o) => o.id !== orderId);
  const draft = rollNeighborOffer(
    {
      ...recipeUnlockView(save),
      dexSeen: save.dexSeen,
      dexInspected: save.dexInspected,
    },
    others,
    neighborOfferRng(now),
    target.recipeId,
  );
  if (!draft) return { save, error: '暂时没有别的街坊点菜' };
  const nextOrder = makeNeighborOrder(draft, now);
  const marked = markDailyAdUsed(save, 'order_refresh', now);
  return {
    save: {
      ...marked,
      neighborOrders: [...others, nextOrder],
    },
    nextOrder,
  };
}

export function unlockExtraDailyMenuByAd(
  save: KitchenSave,
  now = Date.now(),
): { save: KitchenSave; error?: string } {
  if (!canUseDailyAd(save, 'daily_extra', now)) {
    return { save, error: '今天已经加开过晚市啦' };
  }
  const cur = ensureDailyMenu(save, now);
  if (!cur.dailyMenu?.boardClaimed) {
    return { save: cur, error: '先把眼前这一桌交齐再加桌吧' };
  }
  const date = todayKey(now);
  const salt = dailyAdUsed(cur, 'daily_extra', now) + 1;
  const extra = rollExtraDailyMenu(dailyMenuView(cur, now), date, salt);
  if (!extra) return { save: cur, error: '今天没有可加开的菜单' };
  const marked = markDailyAdUsed(cur, 'daily_extra', now);
  return {
    save: {
      ...marked,
      dailyMenuClaimedOn: '',
      dailyMenu: extra,
    },
  };
}

export type GachaDrawMode = 'ticket' | 'ad_free' | 'ad_topup';

export function drawRecipeGacha(
  save: KitchenSave,
  now = Date.now(),
  mode: GachaDrawMode = 'ticket',
): {
  save: KitchenSave;
  error?: string;
  recipeId?: RecipeId;
  foodDefId?: string;
  foodQty?: number;
  foodFolded: boolean;
  foldGold: number;
  duplicate: boolean;
  gold: number;
  toast: string;
  recipeUnlock?: RecipeId;
  specialKind?: 'mastery_note' | 'outing_charm';
  masteryRecipeId?: RecipeId;
  bonusTickets?: number;
} {
  const empty = { foodFolded: false as const, foldGold: 0, duplicate: false, gold: 0, toast: '' };
  let ticketCost = RECIPE_GACHA_COST;
  let preSave = save;
  if (mode === 'ad_free') {
    if (!canUseDailyAd(save, 'gacha_free', now)) {
      return { save, error: '今日免费开箱已用完，明天再来', ...empty };
    }
    ticketCost = 0;
    preSave = markDailyAdUsed(save, 'gacha_free', now);
  } else if (mode === 'ad_topup') {
    if (save.recipeTickets < 1) {
      return { save, error: '至少要有 1 张菜谱券才能补齐开箱', ...empty };
    }
    if (!canUseDailyAd(save, 'gacha_topup', now)) {
      return { save, error: '今日补券开箱次数已用完', ...empty };
    }
    ticketCost = 1;
    preSave = markDailyAdUsed(save, 'gacha_topup', now);
  } else if (save.recipeTickets < RECIPE_GACHA_COST) {
    return {
      save,
      error: '完成小饭桌任务可以获得菜谱券',
      ...empty,
    };
  }
  const view = {
    ...recipeUnlockView(preSave),
    dexSeen: preSave.dexSeen,
    dexInspected: preSave.dexInspected,
    gachaPity: preSave.gachaPity ?? 0,
    recipeCookCounts: preSave.recipeCookCounts,
  };
  const prize = rollGachaPrize(view, gachaRng(now));
  let next: KitchenSave = { ...preSave, recipeTickets: Math.max(0, preSave.recipeTickets - ticketCost) };

  if (prize.kind === 'mastery_note') {
    if (prize.recipeId) {
      const prevCooked = recipeTotalCooked(next, prize.recipeId);
      const afterCooked = prevCooked + prize.pots;
      const counts = { ...(next.recipeCookCounts ?? {}), [prize.recipeId]: afterCooked };
      const cookedList = next.recipesCooked.includes(prize.recipeId)
        ? next.recipesCooked
        : [...next.recipesCooked, prize.recipeId];
      const claimed = next.recipeMasteryClaimed ?? [];
      const goldNeed = recipeMasteryNeeds(prize.recipeId)[2];
      const hitGold = prevCooked < goldNeed
        && afterCooked >= goldNeed
        && !claimed.includes(prize.recipeId);
      next = {
        ...next,
        gachaPity: 0,
        recipeCookCounts: counts,
        recipesCooked: cookedList,
        recipeTickets: next.recipeTickets + (hitGold ? 1 : 0),
        recipeMasteryClaimed: hitGold ? [...claimed, prize.recipeId] : claimed,
      };
      const rName = recipeGachaName(prize.recipeId);
      const extraMsg = hitGold ? '（晋升金勺招牌，回赠菜谱券×1！）' : `（共 ${afterCooked} 锅）`;
      return {
        save: next,
        specialKind: 'mastery_note',
        masteryRecipeId: prize.recipeId,
        bonusTickets: hitGold ? 1 : 0,
        duplicate: false,
        gold: 0,
        toast: `《主厨火候心得》：「${rName}」熟练度 +${prize.pots} 锅${extraMsg}`,
        foodFolded: false,
        foldGold: 0,
      };
    }
    const gold = 38;
    next = grantDirectKitchenBuff(
      { ...next, gachaPity: 0, money: next.money + gold },
      'cook_double',
      'smashed_cucumber',
      now,
    );
    return {
      save: next,
      specialKind: 'mastery_note',
      duplicate: false,
      gold,
      toast: `《宗师双锅秘卷》：下一锅出双份 + 赏金 ${gold} 金！`,
      foodFolded: false,
      foldGold: 0,
    };
  }

  if (prize.kind === 'outing_charm') {
    next = grantDirectOutingBuff(
      { ...next, gachaPity: 0, money: next.money + prize.gold },
      prize.buffKind,
      'stirfry',
    );
    const label = prize.buffKind === 'fee_free' ? '下趟菜场全摊免单' : '下趟菜场天色 +2';
    return {
      save: next,
      specialKind: 'outing_charm',
      duplicate: false,
      gold: prize.gold,
      toast: `《出行鸿运签》：${label} + 盘缠 ${prize.gold} 金！`,
      foodFolded: false,
      foldGold: 0,
    };
  }

  if (prize.kind === 'food') {
    const nextWithPity: KitchenSave = {
      ...next,
      gachaPity: prize.masterChest ? 0 : (preSave.gachaPity ?? 0) + 1,
    };
    const granted = applyNeighborReward(nextWithPity, { gold: 0, food: { defId: prize.defId, qty: prize.qty } });
    const name = granted.foodName ?? getItem(prize.defId).name;
    const prefix = prize.masterChest ? '名厨秘匣开出' : '开出了';
    return {
      save: granted.save,
      foodDefId: granted.foodDefId ?? prize.defId,
      foodQty: prize.qty,
      foodFolded: granted.foodFolded,
      foldGold: granted.foldGold,
      duplicate: false,
      gold: granted.gold,
      toast: granted.foodFolded
        ? `${name}×${prize.qty}冰箱满了，折成 ${granted.foldGold} 金`
        : `${prefix}${name}×${prize.qty}！`,
    };
  }
  const recipeId = prize.recipeId;
  const name = recipeGachaName(recipeId);
  if (isRecipeUnlocked(view, recipeId)) {
    const gold = recipeGachaDupGold(recipeId);
    next = { ...next, gachaPity: 0, money: next.money + gold };
    return {
      save: next,
      recipeId,
      duplicate: true,
      gold,
      toast: `抽到重复的${name}，折成 ${gold} 金`,
      foodFolded: false,
      foldGold: 0,
    };
  }
  next = {
    ...next,
    gachaPity: 0,
    recipesFound: next.recipesFound.includes(recipeId)
      ? next.recipesFound
      : [...next.recipesFound, recipeId],
  };
  const stoveHint = !isRecipeStoveReady(view, recipeId)
    ? `（升至 ${recipeMinStoveLv(recipeId)} 级灶台可下锅）`
    : '';
  return {
    save: next,
    recipeId,
    duplicate: false,
    gold: 0,
    toast: `开了一本${name}${stoveHint}`,
    recipeUnlock: recipeId,
    foodFolded: false,
    foldGold: 0,
  };
}

export function claimDexEntryReward(
  save: KitchenSave,
  kind: DexEntryKind,
  id: string,
): { save: KitchenSave; gold: number; claimed: boolean } {
  const unlocked = kind === 'food'
    ? isFoodUnlocked(save, id)
    : isRecipeId(id) && isDishUnlocked(save, id);
  if (!unlocked) return { save, gold: 0, claimed: false };
  const key = dexEntryKey(kind, id);
  const claimedSet = new Set(save.dexClaimed ?? []);
  if (claimedSet.has(key)) return { save, gold: 0, claimed: false };
  claimedSet.add(key);
  return {
    save: {
      ...save,
      money: save.money + DEX_ENTRY_GOLD,
      dexClaimed: [...claimedSet],
    },
    gold: DEX_ENTRY_GOLD,
    claimed: true,
  };
}

export function claimDexStampSet(
  save: KitchenSave,
  setId: DexStampSetId,
): { save: KitchenSave; gold: number; tickets: number; claimed: boolean; buffLabel: string } {
  const def = DEX_STAMP_SETS.find((d) => d.id === setId);
  if (!def) return { save, gold: 0, tickets: 0, claimed: false, buffLabel: '' };
  const st = dexStampSetStatus(save, def);
  if (!st.readyToClaim) return { save, gold: 0, tickets: 0, claimed: false, buffLabel: def.buffLabel };
  const claimedStamps = [...new Set([...(save.dexStampsClaimed ?? []), def.id])];
  let nextSave: KitchenSave = {
    ...save,
    money: save.money + def.rewardGold,
    recipeTickets: save.recipeTickets + def.rewardTickets,
    dexStampsClaimed: claimedStamps,
  };
  if (def.bonus.staminaBonus && def.bonus.staminaBonus > 0) {
    nextSave = addStamina(nextSave, def.bonus.staminaBonus);
  }
  return {
    save: nextSave,
    gold: def.rewardGold,
    tickets: def.rewardTickets,
    claimed: true,
    buffLabel: def.buffLabel,
  };
}

export function claimAllDexRewards(
  save: KitchenSave,
): {
  save: KitchenSave;
  gold: number;
  tickets: number;
  entriesCount: number;
  milestonesCount: number;
  stampSetsCount: number;
} {
  const keys = unclaimedDexKeys(save);
  const ms = dexMilestoneStatus(save);
  const readyStamps = unclaimedDexStampSets(save);
  if (!keys.length && ms.readySteps <= 0 && !readyStamps.length) {
    return { save, gold: 0, tickets: 0, entriesCount: 0, milestonesCount: 0, stampSetsCount: 0 };
  }
  const claimedSet = new Set([...(save.dexClaimed ?? []), ...keys]);
  const stampSet = new Set([...(save.dexStampsClaimed ?? []), ...readyStamps.map((d) => d.id)]);
  const entryGold = keys.length * DEX_ENTRY_GOLD;
  const msGold = ms.readySteps * DEX_MILESTONE_GOLD;
  const stampGold = readyStamps.reduce((sum, d) => sum + d.rewardGold, 0);
  const stampTickets = readyStamps.reduce((sum, d) => sum + d.rewardTickets, 0);
  const staminaGain = readyStamps.reduce((sum, d) => sum + (d.bonus.staminaBonus ?? 0), 0);
  const totalGold = entryGold + msGold + stampGold;
  const totalTickets = ms.readySteps * DEX_MILESTONE_TICKETS + stampTickets;
  let nextSave: KitchenSave = {
    ...save,
    money: save.money + totalGold,
    recipeTickets: save.recipeTickets + totalTickets,
    dexClaimed: [...claimedSet],
    dexMilestones: ms.claimedSteps + ms.readySteps,
    dexStampsClaimed: [...stampSet],
  };
  if (staminaGain > 0) {
    nextSave = addStamina(nextSave, staminaGain);
  }
  return {
    save: nextSave,
    gold: totalGold,
    tickets: totalTickets,
    entriesCount: keys.length,
    milestonesCount: ms.readySteps,
    stampSetsCount: readyStamps.length,
  };
}
