import { GOD_PICK, ITEMS, getItem, type ItemDef } from './items';
import { HIDDEN_RECIPE_IDS, RECIPES, type RecipeDef, type RecipeId } from './recipes';

export type DexTab = 'food' | 'dish';
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

const PANTRY = new Set(['garlic', 'ginger', 'egg', 'century_egg', 'tofu', 'dried_tofu', 'vermicelli', 'lotus_seed', 'tremella', 'goji', 'peppercorn', 'star_anise', 'dried_chili', 'dried_scallop']);
/** 干果归「水果」这一页，别让板栗混进叶菜堆里。 */
const FRUIT = new Set(['chestnut']);
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
  const have = new Set(RECIPES.map((r) => r.group));
  return [
    ...DISH_GROUP_ORDER.filter((g) => have.has(g)),
    ...[...have].filter((g) => !DISH_GROUP_ORDER.includes(g)),
  ];
}

export function dishesInGroup(group: string, found: readonly RecipeId[] = []): RecipeDef[] {
  return RECIPES.filter((r) => (
    r.group === group
    && (!HIDDEN_RECIPE_IDS.has(r.id) || found.includes(r.id))
  ));
}

export function dishGroupCatIcon(group: string): string {
  return DISH_GROUP_ICON[group] ?? 'dex_cat_home';
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

export interface DexRewardView {
  dexSeen: readonly string[];
  dexInspected: readonly string[];
  recipesCooked: readonly RecipeId[];
  recipesFound?: readonly RecipeId[];
  dexClaimed?: readonly string[];
  dexMilestones?: number;
}

export function dexEntryKey(kind: DexTab, id: string): string {
  return `${kind}:${id}`;
}

export function isDexEntryClaimed(save: Pick<DexRewardView, 'dexClaimed'>, kind: DexTab, id: string): boolean {
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
  return unclaimedDexKeys(save).length + dexMilestoneStatus(save).readySteps;
}
