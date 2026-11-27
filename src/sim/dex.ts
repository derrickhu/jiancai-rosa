import { GOD_PICK, ITEMS, PICKLE_ITEM_IDS, getItem, type ItemDef } from './items';
import {
  COOK_UNLOCK_AT,
  HIDDEN_RECIPE_IDS,
  MARKET_RECIPE_POOL,
  PICKLE_RECIPE_IDS,
  RECIPES,
  START_RECIPES,
  TABLE_UNLOCKS,
  isRecipeId,
  recipeById,
  recipeMinStoveLv,
  type RecipeDef,
  type RecipeId,
} from './recipes';
import { MARKETS } from './destinations';

export type DexTab = 'food' | 'dish' | 'stamp';
export type DexEntryKind = 'food' | 'dish';
export type DexFoodCat = 'veg' | 'pantry' | 'meat' | 'seafood' | 'fruit';

export interface DexTheme {
  ink: number;
  bar: number;
}

export interface DexFoodCatDef {
  id: DexFoodCat;
  label: string;
  icon: string;
  ink: number;
  bar: number;
}

export const DEX_FOOD_CATS: DexFoodCatDef[] = [
  { id: 'veg', label: '蔬菜', icon: 'dex_cat_veg', ink: 0x2A4A20, bar: 0x3F7A32 },
  { id: 'pantry', label: '蛋豆', icon: 'dex_cat_pantry', ink: 0x6A4A10, bar: 0xC4A020 },
  { id: 'meat', label: '肉类', icon: 'dex_cat_meat', ink: 0x6A2418, bar: 0xA33A2A },
  { id: 'seafood', label: '海鲜', icon: 'dex_cat_seafood', ink: 0x1A3A4A, bar: 0x3A6A7A },
  { id: 'fruit', label: '水果', icon: 'dex_cat_fruit', ink: 0x6A2428, bar: 0xC45A5A },
];

const DISH_GROUP_THEME: Record<string, DexTheme> = {
  家常: { ink: 0x5A3A18, bar: 0x8B5A2B },
  凉菜: { ink: 0x2A5A32, bar: 0x4A8A4A },
  汤: { ink: 0x7A3A10, bar: 0xC46A3A },
  水产: { ink: 0x1A4A4A, bar: 0x3A7A7A },
  荤: { ink: 0x6A2418, bar: 0xA33A2A },
};

export function dishGroupTheme(group: string): DexTheme {
  return DISH_GROUP_THEME[group] ?? { ink: 0x4A3020, bar: 0x8B5A2B };
}

const DISH_GROUP_ICON: Record<string, string> = {
  家常: 'dex_cat_home',
  凉菜: 'dex_cat_cold',
  汤: 'dex_cat_soup',
  水产: 'dex_cat_fish',
  荤: 'dex_cat_savory',
};

const PANTRY = new Set([
  'garlic', 'ginger', 'egg', 'century_egg', 'tofu', 'dried_tofu',
  'vermicelli', 'lotus_seed', 'tremella', 'goji', 'peppercorn',
  'star_anise', 'dried_chili', 'dried_scallop',
  'pickled_garlic', 'pickled_chili',
]);

/** 干鲜果统一归入「水果」分页（含板栗 + 果园/埠头全部 11 种鲜果）。 */
const FRUIT = new Set([
  'chestnut',
  'pineapple',
  'orange',
  'apple',
  'pear',
  'mango',
  'lychee',
  'coconut',
  'papaya',
  'lemon',
  'dragonfruit',
  'hawthorn',
]);

/** 已合入旧档别名、不再独立获得的 2 道旧菜，不在图鉴展示。其余 83 道均可正常收集点亮。 */
const RETIRED_DEX_RECIPES = new Set<RecipeId>(['spinach_egg_soup', 'ham_melon_soup']);

const DISH_GROUP_ORDER = ['家常', '凉菜', '汤', '水产', '荤'];

export function foodDexCat(id: string): DexFoodCat {
  if (FRUIT.has(id)) return 'fruit';
  const it = getItem(id);
  if (it.stalls.includes('meat')) return 'meat';
  if (it.zone === 'wet' || it.stalls.includes('fish')) return 'seafood';
  if (PANTRY.has(id)) return 'pantry';
  return 'veg';
}

export function foodsInCat(cat: DexFoodCat): ItemDef[] {
  return [GOD_PICK, ...ITEMS].filter((it) => foodDexCat(it.id) === cat);
}

export function dishGroups(): string[] {
  const have = new Set(RECIPES.filter((r) => !RETIRED_DEX_RECIPES.has(r.id)).map((r) => r.group));
  return [
    ...DISH_GROUP_ORDER.filter((g) => have.has(g)),
    ...[...have].filter((g) => !DISH_GROUP_ORDER.includes(g)),
  ];
}

export function dishesInGroup(group: string, _found: readonly RecipeId[] = []): RecipeDef[] {
  return RECIPES.filter((r) => r.group === group && !RETIRED_DEX_RECIPES.has(r.id));
}

export function dishGroupCatIcon(group: string): string {
  return DISH_GROUP_ICON[group] ?? 'dex_cat_home';
}

/** 未解锁条目的获取途径提示，帮玩家明确收集方向。 */
export function dexObtainHint(kind: DexEntryKind, id: string): string {
  if (kind === 'food') {
    if (id === GOD_PICK.id) return '获取途径：菜场偶遇「小鱼」带回家或检视识破真身。';
    if (PICKLE_ITEM_IDS.has(id)) return '获取途径：自家厨房「老坛腌制坊」封坛发酵产出。';
    if (id === 'chicken_wing') return '获取途径：街坊点菜谢礼、游戏圈补给、菜谱盲盒或阿橘叼回。';
    const def = getItem(id);
    if (FRUIT.has(id) && id !== 'chestnut') {
      return '获取途径：前往「果园 / 埠头」菜场拾取，或阿橘外出寻宝带回。';
    }
    if (def.zone === 'wet' || def.stalls.includes('fish')) {
      return '获取途径：前往河沿、江边、渡口、埠头等水产摊拾取。';
    }
    if (def.stalls.includes('meat')) {
      return '获取途径：前往南市、老城、田头等肉案摊位拾取。';
    }
    return '获取途径：逛各处菜场摊位拾取，或收下街坊与阿橘谢礼。';
  }
  if (!isRecipeId(id)) return '获取途径：继续探索菜场与厨房解锁。';
  const needStove = recipeMinStoveLv(id);
  const stoveSuffix = needStove > 1 ? `\n火候要求：烹饪台升至 Lv.${needStove} 可开火。` : '';
  if (id === 'wild_fish_soup') return `获取途径：识破或带回「野生大黄鱼」即可领悟此秘方。${stoveSuffix}`;
  if (PICKLE_RECIPE_IDS.includes(id)) return `获取途径：在「老坛腌制坊」首次揭盖收获对应腌菜时领悟。${stoveSuffix}`;
  if (START_RECIPES.includes(id)) return '获取途径：开局自带家常手艺。';
  for (const [lvStr, grant] of Object.entries(COOK_UNLOCK_AT)) {
    const list = typeof grant === 'string' ? [grant] : grant;
    if (list.includes(id)) return `获取途径：厨艺升至 Lv.${lvStr} 自动领悟。${stoveSuffix}`;
  }
  for (let i = 0; i < TABLE_UNLOCKS.length; i++) {
    if (TABLE_UNLOCKS[i].includes(id)) return `获取途径：将烹饪台升至 Lv.${i + 2} 随台附赠。`;
  }
  for (const [mId, list] of Object.entries(MARKET_RECIPE_POOL)) {
    if (list.includes(id)) {
      const mName = MARKETS.find((m) => m.id === mId)?.name ?? '菜场';
      return `获取途径：逛「${mName}」偶遇油纸包菜谱拾取。${stoveSuffix}`;
    }
  }
  if (HIDDEN_RECIPE_IDS.has(id)) {
    return `获取途径：厨房「菜谱盲盒机」抽取私房菜谱解锁。${stoveSuffix}`;
  }
  return `获取途径：逛菜场拾取油纸菜谱或升级厨艺解锁。${stoveSuffix}`;
}

export function isFoodUnlocked(save: { dexSeen: readonly string[]; dexInspected: readonly string[] }, id: string): boolean {
  return save.dexSeen.includes(id) || save.dexInspected.includes(id);
}

export function isDishUnlocked(
  save: { recipesCooked: readonly RecipeId[]; recipesFound?: readonly RecipeId[] },
  id: RecipeId,
): boolean {
  return save.recipesCooked.includes(id) || !!save.recipesFound?.includes(id);
}

export const DEX_ENTRY_GOLD = 2;
export const DEX_MILESTONE_STEP = 6;
export const DEX_MILESTONE_GOLD = 12;
export const DEX_MILESTONE_TICKETS = 1;

// ═══════════════════════════════════════════════════════════════════════════
// 地域烟火集章册（8 套主题长线收集 + 永久微加成）
// ═══════════════════════════════════════════════════════════════════════════

export type DexStampSetId =
  | 'alley_smoke'
  | 'riverside_fresh'
  | 'mountain_fungi'
  | 'pickle_master'
  | 'butcher_craft'
  | 'estuary_feast'
  | 'orchard_aroma'
  | 'chef_banquet';

export interface DexStampMember {
  kind: DexEntryKind;
  id: string;
}

export interface DexStampBonuses {
  /** 菜场收费摊报名费乘算折扣（例 0.92 = -8%）。 */
  feeMul: number;
  /** 出门捡菜良品率加算。 */
  luckRare: number;
  /** 出门捡菜上品率加算。 */
  luckEpic: number;
  /** 每次进菜场触发天色 +1 的概率（0..1）。 */
  extraStepChance: number;
  /** 老坛发酵耗时乘算（例 0.9 = -10%）。 */
  pickleDurationMul: number;
  /** 熟菜售卖与街坊交菜金币乘算（例 1.06 = +6%）。 */
  dishSellMul: number;
  /** 小橘猫外出寻宝耗时乘算（例 0.9 = -10%）。 */
  catDurationMul: number;
  /** 体力上限永久加成。 */
  staminaBonus: number;
}

export interface DexStampSetDef {
  id: DexStampSetId;
  title: string;
  subtitle: string;
  accent: number;
  rewardGold: number;
  rewardTickets: number;
  buffLabel: string;
  members: readonly DexStampMember[];
  bonus: Partial<DexStampBonuses>;
}

export const DEX_STAMP_SETS: readonly DexStampSetDef[] = [
  {
    id: 'alley_smoke',
    title: '巷口烟火集',
    subtitle: '清晨第一缕灶烟，从菜苔、番茄和嫩豆腐开始。',
    accent: 0x5C8A3A,
    rewardGold: 35,
    rewardTickets: 0,
    buffLabel: '永久加成：菜场收费摊报名费 -8%',
    members: [
      { kind: 'food', id: 'caitai' },
      { kind: 'food', id: 'tomato' },
      { kind: 'food', id: 'egg' },
      { kind: 'food', id: 'tofu' },
      { kind: 'dish', id: 'stirfry' },
      { kind: 'dish', id: 'tomato_egg' },
    ],
    bonus: { feeMul: 0.92 },
  },
  {
    id: 'riverside_fresh',
    title: '河沿寻鲜录',
    subtitle: '河埠头水盆冒泡泡，小鱼花蛤趁鲜拎回家。',
    accent: 0x3A6A7A,
    rewardGold: 50,
    rewardTickets: 1,
    buffLabel: '永久加成：菜场偶遇良品食材率 +3%',
    members: [
      { kind: 'food', id: 'smallfish' },
      { kind: 'food', id: 'kelp' },
      { kind: 'food', id: 'clam' },
      { kind: 'food', id: 'river_shrimp' },
      { kind: 'dish', id: 'melon_kelp' },
      { kind: 'dish', id: 'clam_soup' },
    ],
    bonus: { luckRare: 0.03 },
  },
  {
    id: 'mountain_fungi',
    title: '山坞百菌集',
    subtitle: '雨后竹林泥香未散，菌子与山栗压沉了竹篓。',
    accent: 0x8B5A2B,
    rewardGold: 80,
    rewardTickets: 1,
    buffLabel: '永久加成：每次进菜场 35% 概率天色 +1',
    members: [
      { kind: 'food', id: 'mushroom' },
      { kind: 'food', id: 'wood_ear' },
      { kind: 'food', id: 'bamboo_shoot' },
      { kind: 'food', id: 'chestnut' },
      { kind: 'food', id: 'matsutake' },
      { kind: 'dish', id: 'yam_chestnut' },
    ],
    bonus: { extraStepChance: 0.35 },
  },
  {
    id: 'pickle_master',
    title: '老坛四绝谱',
    subtitle: '岁月封在粗陶与青瓷里，一揭盖满屋生津。',
    accent: 0xB8642A,
    rewardGold: 90,
    rewardTickets: 1,
    buffLabel: '永久加成：老坛腌制发酵耗时 -10%',
    members: [
      { kind: 'food', id: 'pickled_cucumber' },
      { kind: 'food', id: 'pickled_garlic' },
      { kind: 'food', id: 'pickled_greens' },
      { kind: 'food', id: 'pickled_chili' },
      { kind: 'dish', id: 'sauerkraut_fish' },
      { kind: 'dish', id: 'chopped_chili_fish' },
    ],
    bonus: { pickleDurationMul: 0.90 },
  },
  {
    id: 'butcher_craft',
    title: '老城肉案志',
    subtitle: '案板厚实刀声脆，五花排骨牛腩样样见真章。',
    accent: 0xA33A2A,
    rewardGold: 95,
    rewardTickets: 1,
    buffLabel: '永久加成：熟菜售卖与街坊交菜赏金 +6%',
    members: [
      { kind: 'food', id: 'pork_belly' },
      { kind: 'food', id: 'ribs' },
      { kind: 'food', id: 'beef_brisket' },
      { kind: 'food', id: 'ham' },
      { kind: 'dish', id: 'braised_beef' },
      { kind: 'dish', id: 'radish_ribs' },
    ],
    bonus: { dishSellMul: 1.06 },
  },
  {
    id: 'estuary_feast',
    title: '江海鱼鲜谱',
    subtitle: '潮来渡口百船归，银鳞金甲尽入私房席。',
    accent: 0x2B5B78,
    rewardGold: 120,
    rewardTickets: 1,
    buffLabel: '永久加成：菜场偶遇上品食材率 +3%',
    members: [
      { kind: 'food', id: 'hairtail' },
      { kind: 'food', id: 'yellowfish' },
      { kind: 'food', id: 'river_eel' },
      { kind: 'food', id: 'crab' },
      { kind: 'food', id: 'seabass' },
      { kind: 'dish', id: 'steam_yellowfish' },
    ],
    bonus: { luckEpic: 0.03 },
  },
  {
    id: 'orchard_aroma',
    title: '果园百果香',
    subtitle: '枝头晨露裹着果甜，入菜煲汤别有一番清欢。',
    accent: 0xC45A5A,
    rewardGold: 110,
    rewardTickets: 1,
    buffLabel: '永久加成：阿橘外出巡街寻宝耗时 -10%',
    members: [
      { kind: 'food', id: 'pineapple' },
      { kind: 'food', id: 'orange' },
      { kind: 'food', id: 'apple' },
      { kind: 'food', id: 'pear' },
      { kind: 'food', id: 'mango' },
      { kind: 'food', id: 'lychee' },
      { kind: 'food', id: 'dragonfruit' },
    ],
    bonus: { catDurationMul: 0.90 },
  },
  {
    id: 'chef_banquet',
    title: '镇店私房宴',
    subtitle: '山珍海味尽归庖厨，八方街坊闻香踏槛来。',
    accent: 0x8F4E9A,
    rewardGold: 180,
    rewardTickets: 2,
    buffLabel: '永久加成：体力上限永久 +2',
    members: [
      { kind: 'dish', id: 'matsutake_chicken' },
      { kind: 'dish', id: 'ginger_crab' },
      { kind: 'dish', id: 'maoxuewang' },
      { kind: 'dish', id: 'pineapple_pork' },
      { kind: 'dish', id: 'coconut_chicken' },
      { kind: 'dish', id: 'dragon_beef' },
    ],
    bonus: { staminaBonus: 2 },
  },
];

export interface DexRewardView {
  dexSeen: readonly string[];
  dexInspected: readonly string[];
  recipesCooked: readonly RecipeId[];
  recipesFound?: readonly RecipeId[];
  dexClaimed?: readonly string[];
  dexMilestones?: number;
  dexStampsClaimed?: readonly string[];
}

export function isStampMemberUnlocked(save: DexRewardView, m: DexStampMember): boolean {
  if (m.kind === 'food') return isFoodUnlocked(save, m.id);
  return isRecipeId(m.id) && isDishUnlocked(save, m.id);
}

export function stampMemberName(m: DexStampMember): string {
  if (m.kind === 'food') return getItem(m.id).name;
  return isRecipeId(m.id) ? (recipeById(m.id)?.name ?? '菜谱') : '菜谱';
}

export interface DexStampSetStatus {
  def: DexStampSetDef;
  have: number;
  total: number;
  complete: boolean;
  claimed: boolean;
  readyToClaim: boolean;
}

export function dexStampSetStatus(save: DexRewardView, def: DexStampSetDef): DexStampSetStatus {
  const total = def.members.length;
  const have = def.members.filter((m) => isStampMemberUnlocked(save, m)).length;
  const complete = have >= total;
  const claimed = (save.dexStampsClaimed ?? []).includes(def.id);
  return {
    def,
    have,
    total,
    complete,
    claimed,
    readyToClaim: complete && !claimed,
  };
}

export function unclaimedDexStampSets(save: DexRewardView): DexStampSetDef[] {
  return DEX_STAMP_SETS.filter((def) => dexStampSetStatus(save, def).readyToClaim);
}

export function dexActiveBonuses(save?: Pick<DexRewardView, 'dexStampsClaimed'>): DexStampBonuses {
  const base: DexStampBonuses = {
    feeMul: 1,
    luckRare: 0,
    luckEpic: 0,
    extraStepChance: 0,
    pickleDurationMul: 1,
    dishSellMul: 1,
    catDurationMul: 1,
    staminaBonus: 0,
  };
  const claimed = save?.dexStampsClaimed;
  if (!claimed?.length) return base;
  const set = new Set(claimed);
  for (const def of DEX_STAMP_SETS) {
    if (!set.has(def.id)) continue;
    const b = def.bonus;
    if (b.feeMul != null) base.feeMul *= b.feeMul;
    if (b.luckRare != null) base.luckRare += b.luckRare;
    if (b.luckEpic != null) base.luckEpic += b.luckEpic;
    if (b.extraStepChance != null) base.extraStepChance = Math.min(1, base.extraStepChance + b.extraStepChance);
    if (b.pickleDurationMul != null) base.pickleDurationMul *= b.pickleDurationMul;
    if (b.dishSellMul != null) base.dishSellMul *= b.dishSellMul;
    if (b.catDurationMul != null) base.catDurationMul *= b.catDurationMul;
    if (b.staminaBonus != null) base.staminaBonus += b.staminaBonus;
  }
  return base;
}

export function dexEntryKey(kind: DexEntryKind, id: string): string {
  return `${kind}:${id}`;
}

export function isDexEntryClaimed(save: Pick<DexRewardView, 'dexClaimed'>, kind: DexEntryKind, id: string): boolean {
  return (save.dexClaimed ?? []).includes(dexEntryKey(kind, id));
}

export function allUnlockedDexKeys(save: DexRewardView): string[] {
  const keys: string[] = [];
  for (const cat of DEX_FOOD_CATS) {
    for (const it of foodsInCat(cat.id)) {
      if (isFoodUnlocked(save, it.id)) keys.push(dexEntryKey('food', it.id));
    }
  }
  const found = save.recipesFound ?? [];
  for (const group of dishGroups()) {
    for (const r of dishesInGroup(group, found)) {
      if (isDishUnlocked(save, r.id)) keys.push(dexEntryKey('dish', r.id));
    }
  }
  return keys;
}

export function unclaimedDexKeys(save: DexRewardView): string[] {
  const claimed = new Set(save.dexClaimed ?? []);
  return allUnlockedDexKeys(save).filter((k) => !claimed.has(k));
}

export function unclaimedDexInFoodCat(save: DexRewardView, cat: DexFoodCat): number {
  const claimed = new Set(save.dexClaimed ?? []);
  return foodsInCat(cat).filter((it) => isFoodUnlocked(save, it.id) && !claimed.has(dexEntryKey('food', it.id))).length;
}

export function unclaimedDexInDishGroup(save: DexRewardView, group: string): number {
  const claimed = new Set(save.dexClaimed ?? []);
  return dishesInGroup(group, save.recipesFound ?? []).filter(
    (r) => isDishUnlocked(save, r.id) && !claimed.has(dexEntryKey('dish', r.id)),
  ).length;
}

export function dexMilestoneStatus(save: DexRewardView): {
  totalUnlocked: number;
  claimedSteps: number;
  readySteps: number;
  stepProgress: number;
  stepNeed: number;
} {
  const totalUnlocked = allUnlockedDexKeys(save).length;
  const claimedSteps = Math.max(0, Math.floor(save.dexMilestones ?? 0));
  const earnedSteps = Math.floor(totalUnlocked / DEX_MILESTONE_STEP);
  const readySteps = Math.max(0, earnedSteps - claimedSteps);
  const base = claimedSteps * DEX_MILESTONE_STEP;
  const stepProgress = Math.min(DEX_MILESTONE_STEP, Math.max(0, totalUnlocked - base));
  return {
    totalUnlocked,
    claimedSteps,
    readySteps,
    stepProgress,
    stepNeed: DEX_MILESTONE_STEP,
  };
}

export function dexRedDotCount(save: DexRewardView): number {
  return unclaimedDexKeys(save).length + dexMilestoneStatus(save).readySteps + unclaimedDexStampSets(save).length;
}
