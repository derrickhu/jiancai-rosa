import { HIDDEN_RECIPE_IDS, isRecipeUnlocked, recipeById, recipeSellPrice, type RecipeId, type RecipeUnlockView } from './recipes';
import { DAILY_MENU_RECIPES } from './dailyMenu';
import { mulberry32, type Rng } from './rng';

export const RECIPE_GACHA_COST = 2;
export const RECIPE_TICKET_PER_BOARD = 1;
export const RECIPE_GACHA_SKIP = new Set<RecipeId>(['wild_fish_soup']);

const HIDDEN_POOL: RecipeId[] = [...HIDDEN_RECIPE_IDS].filter((id) => !RECIPE_GACHA_SKIP.has(id));

export const RECIPE_GACHA_POOL: RecipeId[] = [...new Set<RecipeId>([...DAILY_MENU_RECIPES, ...HIDDEN_POOL])];

const WEIGHT_NEW_ACTIVITY = 8;
const WEIGHT_NEW_HIDDEN = 3;
const WEIGHT_OWNED = 1;

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

export function rollRecipeGacha(view: RecipeUnlockView, rng: Rng): RecipeId {
  const weights = RECIPE_GACHA_POOL.map((id) => Math.max(0, recipeGachaWeight(view, id)));
  const total = weights.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return RECIPE_GACHA_POOL[0];
  let tick = rng() * total;
  for (let i = 0; i < RECIPE_GACHA_POOL.length; i++) {
    tick -= weights[i];
    if (tick <= 0) return RECIPE_GACHA_POOL[i];
  }
  return RECIPE_GACHA_POOL[RECIPE_GACHA_POOL.length - 1];
}

export function gachaRng(now = Date.now()): Rng {
  return mulberry32((now ^ 0xC0C0A1) >>> 0);
}

export function recipeGachaName(id: RecipeId): string {
  return recipeById(id)?.name ?? '菜谱';
}
