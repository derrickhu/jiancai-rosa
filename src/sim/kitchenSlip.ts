import { MARKETS, type MarketId } from './destinations';
import { getItem, marketFoodIds } from './items';
import { liveNeighborOrders } from './neighborOrders';
import { rarityRank, type Rarity } from './rarity';
import {
  recipeById,
  recipeCanCook,
  recipeNeeds,
  recipeUnlockView,
  unlockedRecipes,
  type RecipeId,
} from './recipes';
import {
  fridgeItemName,
  fridgeItemQty,
  fridgeItemUnitPrice,
  fridgeKind,
  fridgeRoom,
  todayKey,
  type KitchenSave,
} from './kitchen';

export interface KitchenSlipCan {
  recipeId: RecipeId;
  name: string;
  reason: 'order' | 'new' | 'best';
}

export interface KitchenSlipMiss {
  recipeId: RecipeId;
  name: string;
  itemId: string;
  itemName: string;
  marketId?: MarketId;
  marketName?: string;
}

export interface KitchenSlip {
  date: string;
  can?: KitchenSlipCan;
  miss?: KitchenSlipMiss;
}

function hashPick<T>(list: T[], key: string): T {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return list[Math.abs(h) % list.length];
}

function rarityScore(rarity: Rarity): number {
  return rarityRank(rarity);
}

function marketForFood(itemId: string, level: number): { id: MarketId; name: string } | undefined {
  const unlocked = MARKETS.filter((m) => m.unlockLevel <= level);
  const hit = unlocked.find((m) => marketFoodIds(m.id).includes(itemId));
  if (hit) return { id: hit.id, name: hit.name };
  const next = MARKETS.find((m) => m.unlockLevel > level);
  if (next && marketFoodIds(next.id).includes(itemId)) return { id: next.id, name: next.name };
  return undefined;
}

function pickCan(save: KitchenSave): KitchenSlipCan | undefined {
  const view = recipeUnlockView(save);
  const wanted = liveNeighborOrders(save.neighborOrders).map((o) => o.recipeId);
  const order = wanted.find((id) => recipeCanCook(view, id));
  if (order) {
    const recipe = recipeById(order);
    if (recipe) return { recipeId: order, name: recipe.name, reason: 'order' };
  }

  const ready = unlockedRecipes(view).filter((r) => recipeCanCook(view, r.id));
  if (!ready.length) return undefined;

  const fresh = ready.filter((r) => !save.recipesCooked.includes(r.id));
  const pool = fresh.length ? fresh : ready;
  pool.sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity) || a.id.localeCompare(b.id));
  const pick = pool[0];
  return {
    recipeId: pick.id,
    name: pick.name,
    reason: fresh.length ? 'new' : 'best',
  };
}

function pickMiss(save: KitchenSave, date: string): KitchenSlipMiss | undefined {
  const view = recipeUnlockView(save);
  const hanging = liveNeighborOrders(save.neighborOrders)
    .map((o) => o.recipeId)
    .filter((id) => !recipeCanCook(view, id));
  if (!hanging.length) return undefined;

  const recipeId = hashPick(hanging, `${date}:miss:${hanging.join(',')}`);
  const recipe = recipeById(recipeId);
  if (!recipe) return undefined;
  const needs = recipeNeeds(view, recipeId).filter((row) => row.have < row.need);
  if (!needs.length) return undefined;
  const unique = needs.filter((row) => row.have === 0);
  const row = hashPick(unique.length ? unique : needs, `${date}:need:${recipeId}`);
  const market = marketForFood(row.iconId, save.level);
  return {
    recipeId,
    name: recipe.name,
    itemId: row.iconId,
    itemName: getItem(row.iconId).name,
    marketId: market?.id,
    marketName: market?.name,
  };
}

export function computeKitchenSlip(save: KitchenSave, now = Date.now()): KitchenSlip {
  const date = todayKey(now);
  return {
    date,
    can: pickCan(save),
    miss: pickMiss(save, date),
  };
}

export function kitchenSlipPins(slip: KitchenSlip): RecipeId[] {
  const out: RecipeId[] = [];
  if (slip.can) out.push(slip.can.recipeId);
  if (slip.miss && !out.includes(slip.miss.recipeId)) out.push(slip.miss.recipeId);
  return out;
}

export function kitchenSlipMissToast(miss: KitchenSlipMiss): string {
  if (miss.marketName) return `${miss.itemName}在${miss.marketName}`;
  return `还差${miss.itemName}`;
}

export interface FridgeSlipLine {
  text: string;
  tone: 'full' | 'sell';
  tab: 'food' | 'dish';
}

/** 满格或有熟菜可卖时夹在冰箱门上，免得忘了开冰箱。 */
export function computeFridgeSlip(save: KitchenSave, now = Date.now()): FridgeSlipLine[] {
  const lines: FridgeSlipLine[] = [];
  const dishes = save.fridge.filter((it) => (
    fridgeKind(it) === 'dish' && fridgeItemUnitPrice(it, save, now) > 0
  ));
  if (fridgeRoom(save) <= 0) {
    const dishSlots = save.fridge.filter((it) => fridgeKind(it) === 'dish').length;
    lines.push({
      text: '满了 · 腾一格',
      tone: 'full',
      tab: dishSlots * 2 >= save.fridge.length ? 'dish' : 'food',
    });
  }
  const portions = dishes.reduce((sum, it) => sum + fridgeItemQty(it), 0);
  if (portions > 0) {
    const names = [...new Set(dishes.map((it) => fridgeItemName(it)))];
    const text = names.length === 1 ? `有菜 · ${names[0]}` : `有菜 · ${portions}份`;
    lines.push({ text, tone: 'sell', tab: 'dish' });
  }
  return lines;
}

/**
 * 市集摊面提示用：当前「小饭桌（未交齐）」与「街坊点菜（挂单中）」还缺的原材料 id。
 * 已做成现成菜放在冰箱的扣除，本趟出门篮里刚捡到的可用食材也实时扣除。
 */
export function urgentTaskFoodIds(
  save: KitchenSave,
  basketItems: ReadonlyArray<{ defId: string; quality?: string }> = [],
  now = Date.now(),
): Set<string> {
  const dishDemand = new Map<RecipeId, number>();
  if (save.dailyMenu && !save.dailyMenu.boardClaimed) {
    for (const line of save.dailyMenu.lines) {
      const left = Math.max(0, line.need - line.done);
      if (left > 0) {
        dishDemand.set(line.recipeId, (dishDemand.get(line.recipeId) ?? 0) + left);
      }
    }
  }
  for (const order of liveNeighborOrders(save.neighborOrders, now)) {
    dishDemand.set(order.recipeId, (dishDemand.get(order.recipeId) ?? 0) + 1);
  }
  if (!dishDemand.size) return new Set();

  const ingDemand = new Map<string, number>();
  for (const [recipeId, neededPortions] of dishDemand) {
    const haveDish = save.fridge
      .filter((it) => fridgeKind(it) === 'dish' && it.defId === recipeId)
      .reduce((sum, it) => sum + fridgeItemQty(it), 0);
    const missingPortions = Math.max(0, neededPortions - haveDish);
    if (missingPortions <= 0) continue;
    const recipe = recipeById(recipeId);
    if (!recipe) continue;
    for (const ingId of recipe.needs) {
      ingDemand.set(ingId, (ingDemand.get(ingId) ?? 0) + missingPortions);
    }
  }
  if (!ingDemand.size) return new Set();

  const out = new Set<string>();
  for (const [ingId, totalNeed] of ingDemand) {
    const haveFridge = save.fridge
      .filter((it) => fridgeKind(it) !== 'dish' && it.quality !== 'rotten' && it.defId === ingId)
      .reduce((sum, it) => sum + fridgeItemQty(it), 0);
    const haveBasket = basketItems.filter((it) => it.quality !== 'rotten' && it.defId === ingId).length;
    if (haveFridge + haveBasket < totalNeed) {
      out.add(ingId);
    }
  }
  return out;
}
