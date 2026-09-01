import { getItem } from './items';
import {
  recipeById,
  recipeCanCook,
  recipeNeeds,
  recipeSellPrice,
  unlockedRecipes,
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

export interface NeighborOrder {
  id: string;
  recipeId: RecipeId;
  npcId: string;
  expiresAt: number;
  offeredAt: number;
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
}

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

export function neighborOrderBonus(recipeId: RecipeId): number {
  return Math.max(8, Math.round(recipeSellPrice(recipeId) * 0.5));
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

export function rollNeighborOffer(
  view: RecipeUnlockView,
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
  return { recipeId: recipe.id, npc, text: line };
}

export function neighborOfferLog(draft: NeighborOfferDraft): RunEventLog {
  return {
    nodeId: 'kitchen_order',
    kind: 'talk',
    marketId: 'xiangko',
    text: draft.text,
    gain: null,
    speaker: draft.npc.name,
    portrait: draft.npc.portrait,
    choices: [{ label: '接了' }, { label: '这回不行' }],
  };
}

export function makeNeighborOrder(draft: NeighborOfferDraft, now = Date.now()): NeighborOrder {
  return {
    id: `n${now.toString(36)}${Math.floor(Math.random() * 36).toString(36)}`,
    recipeId: draft.recipeId,
    npcId: draft.npc.id,
    expiresAt: now + NEIGHBOR_ORDER_MS,
    offeredAt: now,
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
    });
    if (out.length >= NEIGHBOR_ORDER_MAX) break;
  }
  return out;
}
