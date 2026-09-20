import { getItem, ITEMS } from './items';
import { nextLockedMarketIds, unseenMarketFoods, type NeighborRollView } from './neighborOrders';
import type { Rarity } from './rarity';
import { mulberry32, rngPick, type Rng } from './rng';
import {
  recipeById,
  recipeSellPrice,
  START_RECIPES,
  unlockedRecipes,
  type RecipeDef,
  type RecipeFood,
  type RecipeId,
  type RecipeUnlockView,
} from './recipes';

export const DAILY_MENU_LINES = 3;
export const DAILY_MENU_TEASE_CHANCE = 0.1;
export const DAILY_MENU_BOARD_GOLD = 12;

export const IDLE_FOODS = [
  'cilantro',
  'water_spinach',
  'rapeseed',
  'corn',
  'greenbean',
  'vermicelli',
] as const;

export const DAILY_MENU_RECIPES: RecipeId[] = [
  'smashed_cucumber',
  'stir_beans',
  'ants_tree',
  'garlic_water_spinach',
  'rape_tofu',
  'corn_egg',
];

export interface DailyMenuFoodReward {
  defId: string;
  qty: number;
  tease?: boolean;
}

export interface DailyMenuLine {
  recipeId: RecipeId;
  need: number;
  done: number;
  gold: number;
  food?: DailyMenuFoodReward;
}

export interface DailyMenuBoard {
  tickets?: number;
  recipeId?: RecipeId;
  gold?: number;
  food?: DailyMenuFoodReward;
}

export interface DailyMenuState {
  date: string;
  lines: DailyMenuLine[];
  boardClaimed: boolean;
  board?: DailyMenuBoard;
}

export interface DailyMenuRollView {
  tutorialStep: number;
  level: number;
  recipesFound: readonly RecipeId[];
  recipesCooked: readonly RecipeId[];
  fridge: RecipeFood[];
  tableLevel: number;
  dexSeen: readonly string[];
  dexInspected?: readonly string[];
  hangingRecipeIds: readonly RecipeId[];
  dailyMenu?: DailyMenuState;
  dailyMenuRewards?: readonly RecipeId[];
  dailyMenuClaimedOn?: string;
}

const SKIP_RECIPES = new Set<RecipeId>(['wild_fish_soup']);

export function isIdleFood(id: string): boolean {
  return (IDLE_FOODS as readonly string[]).includes(id);
}

export function isDailyMenuRecipe(id: RecipeId): boolean {
  return DAILY_MENU_RECIPES.includes(id);
}

export function nextDailyMenuRecipe(rewards: readonly RecipeId[] = []): RecipeId | undefined {
  return DAILY_MENU_RECIPES.find((id) => !rewards.includes(id));
}

export function dailyMenuRemain(menu?: DailyMenuState | null): number {
  if (!menu) return 0;
  return menu.lines.reduce((sum, line) => sum + Math.max(0, line.need - line.done), 0);
}

export function dailyMenuComplete(menu?: DailyMenuState | null): boolean {
  return !!menu && menu.lines.length > 0 && menu.lines.every((line) => line.done >= line.need);
}

export function dailyMenuProgress(menu?: DailyMenuState | null): { done: number; need: number; ratio: number } {
  if (!menu || !menu.lines.length) return { done: 0, need: 0, ratio: 0 };
  const need = menu.lines.reduce((sum, line) => sum + Math.max(0, line.need), 0);
  const done = menu.lines.reduce((sum, line) => sum + Math.min(line.done, line.need), 0);
  return { done, need, ratio: need > 0 ? Math.min(1, done / need) : 0 };
}

export function fridgeDishQty(
  fridge: ReadonlyArray<{ kind?: string; defId: string; qty?: number }>,
  recipeId: RecipeId,
): number {
  return fridge.reduce((sum, it) => {
    if (it.kind !== 'dish' || it.defId !== recipeId) return sum;
    const n = Math.floor(Number(it.qty ?? 1));
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function dailyMenuLineGold(recipeId: RecipeId): number {
  return Math.max(6, Math.round(recipeSellPrice(recipeId) * 0.35));
}

function normalizeMenuDate(raw: string): string {
  const parts = String(raw || '').split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return raw;
  const [y, m, d] = parts;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function migrateDailyMenu(raw: unknown): DailyMenuState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Partial<DailyMenuState>;
  if (typeof rec.date !== 'string' || !rec.date) return undefined;
  if (!Array.isArray(rec.lines)) return undefined;
  const lines: DailyMenuLine[] = [];
  for (const row of rec.lines) {
    const line = parseLine(row);
    if (line) lines.push(line);
  }
  if (lines.length < 1 || lines.length > DAILY_MENU_LINES) return undefined;
  return {
    date: normalizeMenuDate(rec.date),
    lines,
    boardClaimed: rec.boardClaimed === true,
    board: parseBoard(rec.board),
  };
}

function parseLine(raw: unknown): DailyMenuLine | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const it = raw as Partial<DailyMenuLine>;
  if (typeof it.recipeId !== 'string' || !recipeById(it.recipeId as RecipeId)) return undefined;
  const need = typeof it.need === 'number' && Number.isFinite(it.need)
    ? Math.max(1, Math.min(2, Math.floor(it.need)))
    : 1;
  const done = typeof it.done === 'number' && Number.isFinite(it.done)
    ? Math.max(0, Math.min(need, Math.floor(it.done)))
    : 0;
  const gold = typeof it.gold === 'number' && Number.isFinite(it.gold)
    ? Math.max(0, Math.floor(it.gold))
    : dailyMenuLineGold(it.recipeId as RecipeId);
  return {
    recipeId: it.recipeId as RecipeId,
    need,
    done,
    gold,
    food: parseFood(it.food),
  };
}

function parseBoard(raw: unknown): DailyMenuBoard | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const it = raw as DailyMenuBoard;
  const recipeId = typeof it.recipeId === 'string' && recipeById(it.recipeId as RecipeId)
    ? it.recipeId as RecipeId
    : undefined;
  const gold = typeof it.gold === 'number' && Number.isFinite(it.gold)
    ? Math.max(0, Math.floor(it.gold))
    : undefined;
  const tickets = typeof it.tickets === 'number' && Number.isFinite(it.tickets)
    ? Math.max(0, Math.floor(it.tickets))
    : undefined;
  const food = parseFood(it.food);
  if (!recipeId && !food && !gold && !tickets) return undefined;
  return { recipeId, gold, food, tickets };
}

function parseFood(raw: unknown): DailyMenuFoodReward | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const it = raw as { defId?: unknown; qty?: unknown; tease?: unknown };
  if (typeof it.defId !== 'string' || !ITEMS.some((item) => item.id === it.defId)) return undefined;
  const qty = typeof it.qty === 'number' && Number.isFinite(it.qty) ? Math.max(1, Math.floor(it.qty)) : 1;
  return { defId: it.defId, qty, tease: it.tease === true };
}

export function dailyMenuBoardPrize(_view?: DailyMenuRollView, _date?: string): DailyMenuBoard {
  return { tickets: 1 };
}

export function attachDailyMenuBoard(
  _view: DailyMenuRollView,
  menu: DailyMenuState,
  _date: string,
): DailyMenuState {
  if ((menu.board?.tickets ?? 0) > 0) return menu;
  if (menu.boardClaimed && menu.board?.recipeId) return menu;
  if (menu.board?.recipeId && !menu.boardClaimed) {
    return { ...menu, board: { tickets: 1 } };
  }
  if (hasBoardPrize(menu.board)) return menu;
  return { ...menu, board: dailyMenuBoardPrize() };
}

export function resolveDailyMenuBoard(menu?: DailyMenuState | null): DailyMenuBoard | undefined {
  if ((menu?.board?.tickets ?? 0) > 0) return menu?.board;
  if (menu) return { tickets: 1 };
  return undefined;
}

function hasBoardPrize(board?: DailyMenuBoard): boolean {
  return !!board && ((board.tickets ?? 0) > 0 || !!board.recipeId || !!board.food || (board.gold ?? 0) > 0);
}

function sameMenuDay(a?: string, b?: string): boolean {
  return !!a && !!b && normalizeMenuDate(a) === normalizeMenuDate(b);
}

export function ensureDailyMenuState(view: DailyMenuRollView, date: string): DailyMenuState | undefined {
  if ((view.tutorialStep ?? 99) < 99) return view.dailyMenu;
  const menu = view.dailyMenu;
  const claimedToday = sameMenuDay(view.dailyMenuClaimedOn, date)
    || (menu?.boardClaimed === true && sameMenuDay(menu.date, date));
  if (claimedToday) {
    if (menu && sameMenuDay(menu.date, date) && menu.lines.length >= 1) {
      return {
        ...attachDailyMenuBoard(view, menu, date),
        boardClaimed: true,
        lines: menu.lines.map((line) => ({ ...line, done: Math.max(line.done, line.need) })),
      };
    }
    return undefined;
  }
  if (menu && sameMenuDay(menu.date, date) && menu.lines.length >= 1) {
    return attachDailyMenuBoard(view, menu, date);
  }
  return rollDailyMenu(view, date);
}

export function rollDailyMenu(view: DailyMenuRollView, date: string): DailyMenuState | undefined {
  const recipes = pickDailyRecipes(view, dateRng(date));
  if (!recipes.length) return undefined;
  const rng = dateRng(`${date}:reward`);
  return {
    date,
    boardClaimed: false,
    board: dailyMenuBoardPrize(view, date),
    lines: recipes.map((recipe) => ({
      recipeId: recipe.id,
      need: rollNeed(recipe, view.level, rng),
      done: 0,
      gold: dailyMenuLineGold(recipe.id),
      food: rollLineFood(view, recipe, rng),
    })),
  };
}

function dateSeed(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function dateRng(date: string): Rng {
  return mulberry32(dateSeed(date));
}

function unlockView(view: DailyMenuRollView): RecipeUnlockView {
  return {
    level: view.level,
    tableLevel: view.tableLevel,
    recipesFound: view.recipesFound,
    recipesCooked: view.recipesCooked,
    fridge: view.fridge,
  };
}

function neighborView(view: DailyMenuRollView): NeighborRollView {
  return {
    ...unlockView(view),
    dexSeen: view.dexSeen,
    dexInspected: view.dexInspected,
  };
}

function pickDailyRecipes(view: DailyMenuRollView, rng: Rng): RecipeDef[] {
  const hanging = new Set(view.hangingRecipeIds);
  const pool = unlockedRecipes(unlockView(view))
    .filter((recipe) => !hanging.has(recipe.id) && !SKIP_RECIPES.has(recipe.id));
  const picked: RecipeDef[] = [];
  let left = pool.slice();
  while (picked.length < DAILY_MENU_LINES && left.length) {
    const recipe = weightedPick(rng, left, (row) => dailyWeight(row, view.level));
    picked.push(recipe);
    left = left.filter((row) => row.id !== recipe.id);
  }
  return picked;
}

function dailyWeight(recipe: RecipeDef, level: number): number {
  const start = START_RECIPES.includes(recipe.id) ? 2 : 0;
  if (level <= 4) {
    if (recipe.rarity === 'common') return 4 + start;
    if (recipe.rarity === 'rare') return 1;
    return 0.15;
  }
  if (level <= 8) {
    if (recipe.rarity === 'common') return 2 + start;
    if (recipe.rarity === 'rare') return 3;
    if (recipe.rarity === 'epic') return 0.8;
    return 0.2;
  }
  if (recipe.rarity === 'legendary') return 0.6;
  if (recipe.rarity === 'epic') return 2;
  if (recipe.rarity === 'rare') return 2.5;
  return 1.2 + start;
}

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map((item) => Math.max(0, weight(item)));
  const total = weights.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return rngPick(rng, items);
  let tick = rng() * total;
  for (let i = 0; i < items.length; i++) {
    tick -= weights[i];
    if (tick <= 0) return items[i];
  }
  return items[items.length - 1];
}

function rollNeed(recipe: RecipeDef, level: number, rng: Rng): number {
  if (recipe.rarity === 'epic' || recipe.rarity === 'legendary') return 1;
  if (level <= 3) return 1;
  return rng() < 0.4 ? 2 : 1;
}

function teaseCap(recipe: RecipeDef): Rarity {
  if (recipe.rarity === 'legendary') return 'legendary';
  if (recipe.rarity === 'epic') return 'epic';
  if (recipe.rarity === 'rare') return 'rare';
  return 'common';
}

export function rollLineFood(
  view: DailyMenuRollView,
  recipe: RecipeDef,
  rng: Rng,
): DailyMenuFoodReward {
  const skip = new Set(recipe.needs);
  if (rng() < DAILY_MENU_TEASE_CHANCE) {
    const tease = unseenMarketFoods(
      neighborView(view),
      nextLockedMarketIds(view.level),
      skip,
      teaseCap(recipe),
    );
    if (tease.length) return { defId: rngPick(rng, tease), qty: 1, tease: true };
  }
  return { defId: pickIdleFood(view, skip, rng), qty: 1 };
}

export function rollBoardFood(view: DailyMenuRollView, rng: Rng): DailyMenuFoodReward {
  return { defId: pickIdleFood(view, new Set(), rng), qty: 1 };
}

function pickIdleFood(view: DailyMenuRollView, skip: Set<string>, rng: Rng): string {
  const seen = new Set([...view.dexSeen, ...(view.dexInspected ?? [])]);
  const fresh = IDLE_FOODS.filter((id) => !skip.has(id) && !seen.has(id));
  if (fresh.length) return rngPick(rng, fresh);
  const rest = IDLE_FOODS.filter((id) => !skip.has(id));
  return rngPick(rng, rest.length ? rest : IDLE_FOODS);
}

export function dailyMenuRewardChips(line: DailyMenuLine): Array<{ icon?: string; itemId?: string; label: string }> {
  const chips: Array<{ icon?: string; itemId?: string; label: string }> = [];
  if (line.gold > 0) chips.push({ icon: 'subpkg_images/hud_coin.png', label: `+${line.gold}` });
  const food = line.food;
  if (food && ITEMS.some((it) => it.id === food.defId)) {
    const name = getItem(food.defId).name;
    chips.push({
      itemId: food.defId,
      label: food.qty > 1 ? `${name}×${food.qty}` : name,
    });
  }
  return chips;
}

export function dailyMenuBoardChips(board?: DailyMenuBoard): Array<{ icon?: string; itemId?: string; label: string }> {
  if (!board || board.recipeId) return [];
  const chips: Array<{ icon?: string; itemId?: string; label: string }> = [];
  if ((board.gold ?? 0) > 0) chips.push({ icon: 'subpkg_images/hud_coin.png', label: `+${board.gold}` });
  const food = board.food;
  if (food && ITEMS.some((it) => it.id === food.defId)) {
    const name = getItem(food.defId).name;
    chips.push({
      itemId: food.defId,
      label: food.qty > 1 ? `${name}×${food.qty}` : name,
    });
  }
  return chips;
}

export function dailyMenuBoardReward(view: DailyMenuRollView, now: number): {
  gold: number;
  food: DailyMenuFoodReward;
} {
  return {
    gold: DAILY_MENU_BOARD_GOLD,
    food: rollBoardFood(view, mulberry32((now ^ 0x51CE00) >>> 0)),
  };
}
