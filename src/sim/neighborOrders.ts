import { MARKETS, type MarketId } from './destinations';
import { GOD_PICK, ITEMS, getItem, itemRarity, marketFoodIds } from './items';
import { rarityRank, type Rarity } from './rarity';
import {
  recipeById,
  recipeCanCook,
  recipeNeeds,
  recipeSellPrice,
  unlockedRecipes,
  type RecipeDef,
  type RecipeId,
  type RecipeUnlockView,
} from './recipes';
import type { RunEventLog } from './run';
import { mulberry32, rngPick, type Rng } from './rng';

export const NEIGHBOR_ORDER_MAX = 2;
export const NEIGHBOR_ORDER_MS = 4 * 60 * 60 * 1000;
export const NEIGHBOR_COOLDOWN = {
  refuse: 45 * 60 * 1000,
  accept: 12 * 60 * 1000,
  miss: 8 * 60 * 1000,
} as const;
export const NEIGHBOR_OFFER_CHANCE = 0.45;

export interface NeighborFoodReward {
  defId: string;
  qty: number;
  /** 点菜时玩家图鉴里还没有，街坊拿来换的新鲜货。 */
  tease?: boolean;
}

export interface NeighborReward {
  gold: number;
  food?: NeighborFoodReward;
}

export interface NeighborOrder {
  id: string;
  recipeId: RecipeId;
  npcId: string;
  expiresAt: number;
  offeredAt: number;
  reward: NeighborReward;
}

export interface NeighborNpc {
  id: string;
  name: string;
  portrait: string;
}

export interface NeighborOfferDraft {
  recipeId: RecipeId;
  npc: NeighborNpc;
  text: string;
  reward: NeighborReward;
  dealLine: string;
}

export type NeighborRollView = RecipeUnlockView & {
  dexSeen: readonly string[];
  dexInspected?: readonly string[];
};

export const NEIGHBOR_NPCS: NeighborNpc[] = [
  { id: 'wang', name: '王婶', portrait: 'subpkg_images/npc_neighbor.png' },
  { id: 'liu', name: '刘伯', portrait: 'subpkg_images/npc_heyan_uncle.png' },
  { id: 'zhu', name: '阿珠', portrait: 'subpkg_images/npc_jiangbian_aunt.png' },
  { id: 'granny', name: '山坞婆婆', portrait: 'subpkg_images/npc_shanwu_granny.png' },
  { id: 'boss', name: '菜行老板', portrait: 'subpkg_images/npc_laocheng_boss.png' },
];

const SKIP_RECIPES = new Set<RecipeId>(['wild_fish_soup']);

const LINES = [
  '{name}想吃一盘{dish}，今晚前能做吗？',
  '{name}路过门口，说想带一盘{dish}回去。',
  '{name}托人带话：家里等着吃{dish}。',
];

const GOLD_LINES = [
  '做成了我多给你一笔，菜你自己留着。',
  '这盘好了我多塞点钱，别跟我客气。',
];

const SWAP_LINES = [
  '家里还余着{food}，跟你换这盘{dish}。',
  '我这儿剩了点{food}，你帮我炒，咱们换。',
  '{food}放着也要蔫，跟你换一盘{dish}。',
];

const TEASE_LINES = [
  '上次出摊带回来的{food}，你大概还没见过，跟你换一盘。',
  '摊上刚露头的{food}，我留了一份，换你做这盘{dish}。',
  '这味你们巷口还少见，{food}跟你换一盘{dish}。',
];

/** 街坊家里常余的那几样，换菜不显得突兀。 */
const LEFTOVER_FOODS = ['garlic', 'ginger', 'egg', 'tofu', 'scallion', 'tomato', 'potato', 'bokchoy'];

const GOLD_MUL: Record<Rarity, number> = {
  common: 0.5,
  rare: 0.65,
  epic: 0.85,
  legendary: 1,
};

export function neighborNpc(id: string): NeighborNpc {
  return NEIGHBOR_NPCS.find((n) => n.id === id) ?? NEIGHBOR_NPCS[0];
}

export function liveNeighborOrders(orders: readonly NeighborOrder[], now = Date.now()): NeighborOrder[] {
  return orders.filter((o) => o.expiresAt > now && recipeById(o.recipeId));
}

export function expiredNeighborOrders(orders: readonly NeighborOrder[], now = Date.now()): NeighborOrder[] {
  return orders.filter((o) => o.expiresAt <= now);
}

export function neighborOfferReady(offerAt: number, now = Date.now()): boolean {
  return now >= (offerAt || 0);
}

export function isNeighborRewardFood(id: string): boolean {
  return id !== GOD_PICK.id && ITEMS.some((it) => it.id === id);
}

export function neighborOrderBonus(recipeId: RecipeId): number {
  const recipe = recipeById(recipeId);
  const mul = recipe ? GOLD_MUL[recipe.rarity] : 0.5;
  return Math.max(8, Math.round(recipeSellPrice(recipeId) * mul));
}

export function neighborOrderReward(order: NeighborOrder): NeighborReward {
  if (order.reward && order.reward.gold >= 0) return order.reward;
  return { gold: neighborOrderBonus(order.recipeId) };
}

export function neighborRewardChips(reward: NeighborReward): Array<{ icon?: string; itemId?: string; label: string }> {
  const chips: Array<{ icon?: string; itemId?: string; label: string }> = [];
  if (reward.gold > 0) chips.push({ icon: 'subpkg_images/hud_coin.png', label: `+${reward.gold}` });
  const food = reward.food;
  if (food && isNeighborRewardFood(food.defId)) {
    const name = getItem(food.defId).name;
    chips.push({ itemId: food.defId, label: food.qty > 1 ? `${name}×${food.qty}` : name });
  }
  return chips;
}

export function orderIngredientIds(orders: readonly NeighborOrder[]): string[] {
  const out: string[] = [];
  for (const o of orders) {
    const recipe = recipeById(o.recipeId);
    if (!recipe) continue;
    for (const id of recipe.needs) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function formatOrderRemain(ms: number): string {
  const left = Math.max(0, ms);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  if (h > 0) return m > 0 ? `还剩 ${h}小时${m}分` : `还剩 ${h}小时`;
  if (m > 0) return `还剩 ${m}分`;
  return `还剩 ${s}秒`;
}

export function missingNeedHint(view: RecipeUnlockView, recipeId: RecipeId): string {
  if (recipeCanCook(view, recipeId)) return '冰箱里已经齐了，做了就给。';
  const lack = recipeNeeds(view, recipeId)
    .filter((row) => row.have < row.need)
    .map((row) => row.label || getItem(row.iconId).name);
  if (!lack.length) return '还差点材料，出门再翻翻。';
  return `还缺${lack.slice(0, 2).join('、')}${lack.length > 2 ? '…' : ''}`;
}

export function neighborDealLine(opts: {
  dish: string;
  reward: NeighborReward;
  rng: Rng;
}): string {
  const food = opts.reward.food && isNeighborRewardFood(opts.reward.food.defId)
    ? getItem(opts.reward.food.defId).name
    : '';
  const pool = food
    ? (opts.reward.food?.tease ? TEASE_LINES : SWAP_LINES)
    : GOLD_LINES;
  return rngPick(opts.rng, pool)
    .replace('{dish}', opts.dish)
    .replace('{food}', food);
}

export function rollNeighborOffer(
  view: NeighborRollView,
  hanging: readonly NeighborOrder[],
  rng: Rng,
): NeighborOfferDraft | null {
  if (hanging.length >= NEIGHBOR_ORDER_MAX) return null;
  const taken = new Set(hanging.map((o) => o.recipeId));
  const usedNpc = new Set(hanging.map((o) => o.npcId));
  const known = unlockedRecipes(view).filter((r) => !taken.has(r.id) && !SKIP_RECIPES.has(r.id));
  if (!known.length) return null;
  const hard = known.filter((r) => !recipeCanCook(view, r.id));
  const pool = hard.length ? hard : known;
  const recipe = rngPick(rng, pool);
  const npcs = NEIGHBOR_NPCS.filter((n) => !usedNpc.has(n.id));
  const npc = rngPick(rng, npcs.length ? npcs : NEIGHBOR_NPCS);
  const line = rngPick(rng, LINES)
    .replace('{name}', npc.name)
    .replace('{dish}', recipe.name);
  const reward = rollNeighborReward(view, recipe, rng);
  return {
    recipeId: recipe.id,
    npc,
    text: line,
    reward,
    dealLine: neighborDealLine({ dish: recipe.name, reward, rng }),
  };
}

export function neighborOfferLog(draft: NeighborOfferDraft): RunEventLog {
  return {
    nodeId: 'kitchen_order',
    kind: 'talk',
    marketId: 'xiangko',
    text: `${draft.text}\n${draft.dealLine}`,
    gain: null,
    speaker: draft.npc.name,
    portrait: draft.npc.portrait,
    choices: [{ label: '接了' }, { label: '这回不行' }],
    rewards: {
      gold: draft.reward.gold,
      foods: draft.reward.food ? [{ defId: draft.reward.food.defId, qty: draft.reward.food.qty }] : undefined,
    },
  };
}

export function makeNeighborOrder(draft: NeighborOfferDraft, now = Date.now()): NeighborOrder {
  return {
    id: `n${now.toString(36)}${Math.floor(Math.random() * 36).toString(36)}`,
    recipeId: draft.recipeId,
    npcId: draft.npc.id,
    expiresAt: now + NEIGHBOR_ORDER_MS,
    offeredAt: now,
    reward: draft.reward,
  };
}

export function neighborOfferRng(now = Date.now()): Rng {
  return mulberry32((now ^ 0xA5A5A5A5) >>> 0);
}

export function migrateNeighborOrders(raw: unknown): NeighborOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: NeighborOrder[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const it = row as Partial<NeighborOrder>;
    if (typeof it.id !== 'string' || !it.id) continue;
    if (typeof it.recipeId !== 'string' || !recipeById(it.recipeId as RecipeId)) continue;
    if (typeof it.npcId !== 'string' || !it.npcId) continue;
    if (typeof it.expiresAt !== 'number' || !Number.isFinite(it.expiresAt)) continue;
    if (typeof it.offeredAt !== 'number' || !Number.isFinite(it.offeredAt)) continue;
    out.push({
      id: it.id,
      recipeId: it.recipeId as RecipeId,
      npcId: it.npcId,
      expiresAt: it.expiresAt,
      offeredAt: it.offeredAt,
      reward: parseReward(it.reward, it.recipeId as RecipeId),
    });
    if (out.length >= NEIGHBOR_ORDER_MAX) break;
  }
  return out;
}

function parseReward(raw: unknown, recipeId: RecipeId): NeighborReward {
  const goldFallback = neighborOrderBonus(recipeId);
  if (!raw || typeof raw !== 'object') return { gold: goldFallback };
  const it = raw as { gold?: unknown; food?: unknown };
  const gold = typeof it.gold === 'number' && Number.isFinite(it.gold)
    ? Math.max(0, Math.floor(it.gold))
    : goldFallback;
  const food = parseFoodReward(it.food);
  return food ? { gold, food } : { gold };
}

function parseFoodReward(raw: unknown): NeighborFoodReward | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const it = raw as { defId?: unknown; qty?: unknown; tease?: unknown };
  if (typeof it.defId !== 'string' || !isNeighborRewardFood(it.defId)) return undefined;
  const qty = typeof it.qty === 'number' && Number.isFinite(it.qty) ? Math.max(1, Math.floor(it.qty)) : 1;
  return { defId: it.defId, qty, tease: it.tease === true };
}

function rollNeighborReward(view: NeighborRollView, recipe: RecipeDef, rng: Rng): NeighborReward {
  const gold = neighborOrderBonus(recipe.id);
  const food = pickFoodReward(view, recipe, rng);
  return food ? { gold, food } : { gold };
}

function pickFoodReward(
  view: NeighborRollView,
  recipe: RecipeDef,
  rng: Rng,
): NeighborFoodReward | undefined {
  if (rng() >= foodChance(recipe)) return undefined;
  const skip = new Set(recipe.needs);
  const cap = teaseRarityCap(recipe);
  const nextIds = nextLockedMarketIds(view.level);
  const currentIds = latestUnlockedMarketIds(view.level);
  const nextUnseen = unseenMarketFoods(view, nextIds, skip, cap);
  const currentUnseen = unseenMarketFoods(view, currentIds, skip, cap);
  if (wantTease(recipe)) {
    if (nextUnseen.length) return { defId: rngPick(rng, nextUnseen), qty: 1, tease: true };
    if (currentUnseen.length) return { defId: rngPick(rng, currentUnseen), qty: 1, tease: true };
  } else if ((nextUnseen.length || currentUnseen.length) && rng() < 0.22) {
    const pool = nextUnseen.length ? nextUnseen : currentUnseen;
    return { defId: rngPick(rng, pool), qty: 1, tease: true };
  }
  const leftover = leftoverFoods(view, skip);
  if (!leftover.length) return undefined;
  return { defId: rngPick(rng, leftover), qty: 1 };
}

function foodChance(recipe: RecipeDef): number {
  const kinds = new Set(recipe.needs).size;
  if (recipe.rarity === 'legendary') return 0.85;
  if (recipe.rarity === 'epic') return 0.7;
  if (recipe.rarity === 'rare') return kinds >= 3 ? 0.5 : 0.38;
  if (kinds >= 3 || recipe.needs.length >= 4) return 0.28;
  return 0.14;
}

function wantTease(recipe: RecipeDef): boolean {
  return recipe.rarity === 'epic'
    || recipe.rarity === 'legendary'
    || (recipe.rarity === 'rare' && new Set(recipe.needs).size >= 3);
}

function teaseRarityCap(recipe: RecipeDef): Rarity {
  if (recipe.rarity === 'legendary') return 'legendary';
  if (recipe.rarity === 'epic') return 'epic';
  if (recipe.rarity === 'rare') return 'rare';
  return 'common';
}

function latestUnlockedMarketIds(level: number): MarketId[] {
  const unlocked = MARKETS.filter((m) => m.unlockLevel <= level)
    .sort((a, b) => b.unlockLevel - a.unlockLevel);
  return unlocked[0] ? [unlocked[0].id] : [];
}

function nextLockedMarketIds(level: number): MarketId[] {
  const locked = MARKETS.filter((m) => m.unlockLevel > level)
    .sort((a, b) => a.unlockLevel - b.unlockLevel);
  return locked[0] ? [locked[0].id] : [];
}

function unseenMarketFoods(
  view: NeighborRollView,
  marketIds: MarketId[],
  skip: Set<string>,
  cap: Rarity,
): string[] {
  const seen = new Set([...view.dexSeen, ...(view.dexInspected ?? [])]);
  const out: string[] = [];
  for (const mid of marketIds) {
    for (const id of marketFoodIds(mid)) {
      if (skip.has(id) || seen.has(id) || !isNeighborRewardFood(id)) continue;
      if (rarityRank(itemRarity(id)) > rarityRank(cap)) continue;
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

function leftoverFoods(view: NeighborRollView, skip: Set<string>): string[] {
  const unlocked = new Set(
    MARKETS.filter((m) => m.unlockLevel <= view.level).flatMap((m) => marketFoodIds(m.id)),
  );
  const counts = new Map<string, number>();
  for (const it of view.fridge) {
    if (it.kind === 'dish' || skip.has(it.defId)) continue;
    counts.set(it.defId, (counts.get(it.defId) ?? 0) + Math.max(1, Math.floor(it.qty ?? 1)));
  }
  const pool = LEFTOVER_FOODS.filter((id) => (
    isNeighborRewardFood(id) && !skip.has(id) && unlocked.has(id)
  ));
  const roomy = pool.filter((id) => (counts.get(id) ?? 0) < 6);
  return roomy.length ? roomy : pool;
}
