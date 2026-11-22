import { MARKETS } from './destinations';
import { GOD_PICK, ITEMS, PICKLE_ITEM_IDS, getItem, marketFoodIds } from './items';
import {
  HIDDEN_RECIPE_IDS,
  PICKLE_RECIPE_IDS,
  RECIPES,
  isRecipeUnlocked,
  recipeById,
  recipeSellPrice,
  type RecipeId,
  type RecipeUnlockView,
} from './recipes';
import { DAILY_MENU_RECIPES } from './dailyMenu';
import type { Rarity } from './rarity';
import { mulberry32, type Rng } from './rng';

export const RECIPE_GACHA_COST = 2;
export const RECIPE_TICKET_PER_BOARD = 1;
export const RECIPE_GACHA_SKIP = new Set<RecipeId>([
  'wild_fish_soup',
  'spinach_egg_soup' as RecipeId,
  'ham_melon_soup' as RecipeId,
  ...PICKLE_RECIPE_IDS,
]);

/** 单抽新谱基础率 28% + 连续 3 箱未出谱则第 4 箱必出新谱（综合约 3.1 抽 1 本新谱）。 */
export const RECIPE_GACHA_RECIPE_RATE = 0.28;
export const RECIPE_GACHA_PITY = 4;
export const GACHA_FOOD_QTY_MIN = 3;
export const GACHA_FOOD_QTY_MAX = 5;

const HIDDEN_POOL: RecipeId[] = [...HIDDEN_RECIPE_IDS].filter((id) => !RECIPE_GACHA_SKIP.has(id));

export const RECIPE_GACHA_POOL: RecipeId[] = [...new Set<RecipeId>([...DAILY_MENU_RECIPES, ...HIDDEN_POOL])];

const FOOD_WEIGHT: Record<Rarity, number> = {
  common: 0,
  rare: 8,
  epic: 3,
  legendary: 1,
};

export const RECIPE_GACHA_FOODS: string[] = ITEMS
  .filter((it) => it.id !== GOD_PICK.id && !PICKLE_ITEM_IDS.has(it.id) && FOOD_WEIGHT[it.rarity] > 0)
  .map((it) => it.id);

const MASTER_DELICACY_FOODS: string[] = ITEMS
  .filter((it) => it.id !== GOD_PICK.id && !PICKLE_ITEM_IDS.has(it.id) && (it.rarity === 'epic' || it.rarity === 'legendary'))
  .map((it) => it.id);

const MASTER_PICKLE_FOODS: string[] = [...PICKLE_ITEM_IDS];

const WEIGHT_NEW_ACTIVITY = 9;
const WEIGHT_NEW_HIDDEN = 4;
const WEIGHT_OWNED = 1;

export type GachaPrize =
  | { kind: 'recipe'; recipeId: RecipeId }
  | { kind: 'food'; defId: string; qty: number; masterChest?: boolean }
  | { kind: 'mastery_note'; recipeId?: RecipeId; pots: number }
  | { kind: 'outing_charm'; buffKind: 'fee_free' | 'steps_2'; gold: number };

export interface GachaRollView extends RecipeUnlockView {
  dexSeen?: readonly string[];
  dexInspected?: readonly string[];
  gachaPity?: number;
  recipeCookCounts?: Partial<Record<RecipeId, number>>;
}

export function recipeGachaDupGold(id: RecipeId): number {
  return Math.max(10, Math.round(recipeSellPrice(id) * 0.5));
}

export function isGachaActivity(id: RecipeId): boolean {
  return DAILY_MENU_RECIPES.includes(id);
}

/** 计算给定厨艺等级在已开菜场（及下一档菜场）能获取到的食材集合，用于按进度加权抽谱。 */
function unlockedMarketFoodSets(level: number): { nowSet: Set<string>; nearSet: Set<string> } {
  const lv = Math.max(1, Math.floor(level || 1));
  const nowSet = new Set<string>();
  const nearSet = new Set<string>();
  for (const m of MARKETS) {
    if (m.unlockLevel <= lv) {
      for (const id of marketFoodIds(m.id)) {
        nowSet.add(id);
        nearSet.add(id);
      }
    } else if (m.unlockLevel <= lv + 2) {
      for (const id of marketFoodIds(m.id)) {
        nearSet.add(id);
      }
    }
  }
  return { nowSet, nearSet };
}

export function recipeGachaWeight(view: RecipeUnlockView, id: RecipeId): number {
  if (isRecipeUnlocked(view, id)) return WEIGHT_OWNED;
  const base = isGachaActivity(id) ? WEIGHT_NEW_ACTIVITY : WEIGHT_NEW_HIDDEN;
  const rec = recipeById(id);
  if (!rec) return base;
  const { nowSet, nearSet } = unlockedMarketFoodSets(view.level);
  const allNow = rec.needs.every((fid) => nowSet.has(fid));
  if (allNow) return base * 6;
  const allNear = rec.needs.every((fid) => nearSet.has(fid));
  if (allNear) return base * 1.2;
  return 0.08;
}

export function freshGachaRecipes(view: RecipeUnlockView): RecipeId[] {
  return RECIPE_GACHA_POOL.filter((id) => !isRecipeUnlocked(view, id));
}

export function gachaPityLeft(view: Pick<GachaRollView, 'gachaPity'>): number {
  const pity = Math.max(0, Math.floor(view.gachaPity ?? 0));
  return Math.max(1, RECIPE_GACHA_PITY - pity);
}

export function rollRecipeGacha(view: RecipeUnlockView, rng: Rng): RecipeId {
  const fresh = freshGachaRecipes(view);
  const pool = fresh.length ? fresh : RECIPE_GACHA_POOL;
  return pickWeighted(pool, (id) => recipeGachaWeight(view, id), rng) ?? pool[0];
}

export function rollGachaFood(view: GachaRollView, rng: Rng): string {
  const seen = new Set([...(view.dexSeen ?? []), ...(view.dexInspected ?? [])]);
  const { nearSet } = unlockedMarketFoodSets(view.level);
  return pickWeighted(RECIPE_GACHA_FOODS, (id) => {
    const rare = getItem(id).rarity;
    const base = FOOD_WEIGHT[rare];
    const stageMul = nearSet.has(id) ? 2.2 : 0.7;
    const newMul = seen.has(id) ? 1 : 1.5;
    return base * stageMul * newMul;
  }, rng) ?? RECIPE_GACHA_FOODS[0];
}

/** 39 本隐藏菜谱抽齐后升级为「名厨秘匣」常青奖池：火候心得(35%) + 臻品/老坛陈酿(45%) + 出行鸿运签(20%)。 */
function rollMasterChestPrize(view: GachaRollView, rng: Rng): GachaPrize {
  const roll = rng();
  if (roll < 0.35) {
    const counts = view.recipeCookCounts ?? {};
    const cookedSet = new Set(view.recipesCooked ?? []);
    const candidates = RECIPES.filter((r) => {
      if (!isRecipeUnlocked(view, r.id)) return false;
      const c = Math.max(counts[r.id] ?? 0, cookedSet.has(r.id) ? 1 : 0);
      return c < 8;
    });
    if (candidates.length > 0) {
      const target = candidates[Math.floor(rng() * candidates.length)];
      return { kind: 'mastery_note', recipeId: target.id, pots: 3 };
    }
    return { kind: 'mastery_note', pots: 3 };
  }
  if (roll < 0.80) {
    if (MASTER_PICKLE_FOODS.length && rng() < 0.36) {
      const pid = MASTER_PICKLE_FOODS[Math.floor(rng() * MASTER_PICKLE_FOODS.length)];
      return { kind: 'food', defId: pid, qty: 2 + Math.floor(rng() * 2), masterChest: true };
    }
    const seen = new Set([...(view.dexSeen ?? []), ...(view.dexInspected ?? [])]);
    const pool = MASTER_DELICACY_FOODS.length ? MASTER_DELICACY_FOODS : RECIPE_GACHA_FOODS;
    const fid = pickWeighted(pool, (id) => {
      const rare = getItem(id).rarity;
      const base = rare === 'legendary' ? 2 : 5;
      return seen.has(id) ? base : base * 1.6;
    }, rng) ?? pool[0];
    return { kind: 'food', defId: fid, qty: 2 + Math.floor(rng() * 3), masterChest: true };
  }
  const buffKind = rng() < 0.5 ? 'fee_free' : 'steps_2';
  return { kind: 'outing_charm', buffKind, gold: 18 };
}

export function rollGachaPrize(view: GachaRollView, rng: Rng): GachaPrize {
  const fresh = freshGachaRecipes(view);
  if (!fresh.length) {
    return rollMasterChestPrize(view, rng);
  }
  const forceByPity = gachaPityLeft(view) <= 1;
  if (forceByPity || rng() < RECIPE_GACHA_RECIPE_RATE) {
    return { kind: 'recipe', recipeId: rollRecipeGacha(view, rng) };
  }
  const span = GACHA_FOOD_QTY_MAX - GACHA_FOOD_QTY_MIN + 1;
  return {
    kind: 'food',
    defId: rollGachaFood(view, rng),
    qty: GACHA_FOOD_QTY_MIN + Math.floor(rng() * span),
  };
}

export function gachaRng(now = Date.now()): Rng {
  return mulberry32((now ^ 0xC0C0A1) >>> 0);
}

export function recipeGachaName(id: RecipeId): string {
  return recipeById(id)?.name ?? '菜谱';
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T | undefined {
  if (!items.length) return undefined;
  const weights = items.map((item) => Math.max(0, weight(item)));
  const total = weights.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return items[0];
  let tick = rng() * total;
  for (let i = 0; i < items.length; i++) {
    tick -= weights[i];
    if (tick <= 0) return items[i];
  }
  return items[items.length - 1];
}
