import { GOD_PICK, ITEMS, getItem } from './items';
import { HIDDEN_RECIPE_IDS, isRecipeUnlocked, recipeById, recipeSellPrice, type RecipeId, type RecipeUnlockView } from './recipes';
import { DAILY_MENU_RECIPES } from './dailyMenu';
import type { Rarity } from './rarity';
import { mulberry32, type Rng } from './rng';

export const RECIPE_GACHA_COST = 2;
export const RECIPE_TICKET_PER_BOARD = 1;
export const RECIPE_GACHA_SKIP = new Set<RecipeId>(['wild_fish_soup']);
/** 还有没开过的菜谱时，抽到菜谱的比例。其余出高级食材。 */
export const RECIPE_GACHA_RECIPE_RATE = 0.4;
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
  .filter((it) => it.id !== GOD_PICK.id && FOOD_WEIGHT[it.rarity] > 0)
  .map((it) => it.id);

const WEIGHT_NEW_ACTIVITY = 8;
const WEIGHT_NEW_HIDDEN = 3;
const WEIGHT_OWNED = 1;

export type GachaPrize =
  | { kind: 'recipe'; recipeId: RecipeId }
  | { kind: 'food'; defId: string; qty: number };

export interface GachaRollView extends RecipeUnlockView {
  dexSeen?: readonly string[];
  dexInspected?: readonly string[];
}

export function recipeGachaDupGold(id: RecipeId): number {
  return Math.max(10, Math.round(recipeSellPrice(id) * 0.5));
}

export function isGachaActivity(id: RecipeId): boolean {
  return DAILY_MENU_RECIPES.includes(id);
}

export function recipeGachaWeight(view: RecipeUnlockView, id: RecipeId): number {
  if (isRecipeUnlocked(view, id)) return WEIGHT_OWNED;
  return isGachaActivity(id) ? WEIGHT_NEW_ACTIVITY : WEIGHT_NEW_HIDDEN;
}

export function freshGachaRecipes(view: RecipeUnlockView): RecipeId[] {
  return RECIPE_GACHA_POOL.filter((id) => !isRecipeUnlocked(view, id));
}

export function rollRecipeGacha(view: RecipeUnlockView, rng: Rng): RecipeId {
  const fresh = freshGachaRecipes(view);
  const pool = fresh.length ? fresh : RECIPE_GACHA_POOL;
  return pickWeighted(pool, (id) => recipeGachaWeight(view, id), rng) ?? pool[0];
}

export function rollGachaFood(view: GachaRollView, rng: Rng): string {
  const seen = new Set([...(view.dexSeen ?? []), ...(view.dexInspected ?? [])]);
  return pickWeighted(RECIPE_GACHA_FOODS, (id) => {
    const rare = getItem(id).rarity;
    const base = FOOD_WEIGHT[rare];
    return seen.has(id) ? base : base * 1.5;
  }, rng) ?? RECIPE_GACHA_FOODS[0];
}

export function rollGachaPrize(view: GachaRollView, rng: Rng): GachaPrize {
  const fresh = freshGachaRecipes(view);
  if (fresh.length && rng() < RECIPE_GACHA_RECIPE_RATE) {
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
