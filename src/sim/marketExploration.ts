import { MARKETS, type MarketId } from './destinations';
import { isFoodUnlocked } from './dex';
import { marketFoodIds, marketProduceChances, type MarketProduceRow, type StallId } from './items';
import { CARD_WEIGHTS, MARKET_PLAN, STALL_WEIGHTS, type CardKind } from './marketEvents';
import { MARKET_RECIPE_POOL, type RecipeId } from './recipes';
import { SPECIALTIES } from './specialties';

export interface ExploreSave {
  dexSeen: readonly string[];
  dexInspected: readonly string[];
  recipesFound: readonly RecipeId[];
  seenCards: readonly string[];
  seenMarketFoods?: readonly string[];
}

export interface ExplorePart {
  have: number;
  total: number;
}

export interface MarketExploration {
  foods: ExplorePart;
  recipes: ExplorePart;
  cards: ExplorePart;
  have: number;
  total: number;
  ratio: number;
  complete: boolean;
}

/** 节拍里才会露脸的卡型。公共权重池已经有的不再写。 */
const MARKET_BEAT_KINDS: Partial<Record<MarketId, CardKind[]>> = {
  xiangko: ['talk'],
  heyan: ['talk', 'gather', 'branch'],
  shanwu: ['talk', 'gather', 'branch'],
  jiangbian: ['talk', 'gather', 'branch'],
  nanshi: ['talk'],
  laocheng: ['talk', 'gate', 'branch'],
  dukou: ['talk', 'gather', 'branch'],
  shanzhen: ['talk'],
};

/** 节拍专属摊的货。大部分已在摊池里，这里只补摊池没有的。 */
const MARKET_SPECIALTIES: Partial<Record<MarketId, string[]>> = {
  heyan: ['lotus'],
  shanwu: ['fungus'],
  jiangbian: ['nightcatch'],
  laocheng: ['cured'],
  dukou: ['nightcatch'],
  shanzhen: ['treasure', 'cured'],
};

export function marketExploreFoods(marketId: MarketId): string[] {
  return marketFoodIds(marketId);
}

export function marketExploreRecipes(marketId: MarketId): RecipeId[] {
  return [...MARKET_RECIPE_POOL[marketId]];
}

export function marketExploreCards(marketId: MarketId): CardKind[] {
  const kinds = new Set<CardKind>();
  const allowDeep = MARKET_PLAN[marketId].allowDeep;
  for (const [kind] of CARD_WEIGHTS[marketId]) {
    if (kind === 'deep' && !allowDeep) continue;
    kinds.add(kind);
  }
  for (const kind of MARKET_BEAT_KINDS[marketId] ?? []) kinds.add(kind);
  return [...kinds];
}

export function marketFoodKey(marketId: MarketId, foodId: string): string {
  return `${marketId}:${foodId}`;
}

function foodSeenHere(save: ExploreSave, marketId: MarketId, foodId: string): boolean {
  return !!save.seenMarketFoods?.includes(marketFoodKey(marketId, foodId));
}

function cardSeen(save: ExploreSave, marketId: MarketId, kind: CardKind): boolean {
  return save.seenCards.includes(`${marketId}:${kind}`);
}

/** 旧档没有分场记录时：走过的菜场按图鉴补一笔，没去过的场保持 0。 */
export function migrateSeenMarketFoods(
  raw: { seenMarketFoods?: unknown },
  save: Pick<ExploreSave, 'dexSeen' | 'dexInspected' | 'seenCards'>,
): string[] {
  if (Array.isArray(raw.seenMarketFoods)) {
    return raw.seenMarketFoods.filter((key): key is string => typeof key === 'string' && !!key);
  }
  const visited = new Set<MarketId>();
  for (const key of save.seenCards) {
    const id = key.split(':')[0] as MarketId;
    if (MARKETS.some((m) => m.id === id)) visited.add(id);
  }
  const out: string[] = [];
  for (const id of visited) {
    for (const food of marketFoodIds(id)) {
      if (isFoodUnlocked(save, food)) out.push(marketFoodKey(id, food));
    }
  }
  return out;
}

function recipeSeen(save: ExploreSave, id: RecipeId): boolean {
  return save.recipesFound.includes(id);
}

function countPart<T>(ids: readonly T[], hit: (id: T) => boolean): ExplorePart {
  const total = ids.length;
  let have = 0;
  for (const id of ids) {
    if (hit(id)) have += 1;
  }
  return { have, total };
}

export function marketExploration(save: ExploreSave, marketId: MarketId): MarketExploration {
  const foods = countPart(marketExploreFoods(marketId), (id) => foodSeenHere(save, marketId, id));
  const recipes = countPart(marketExploreRecipes(marketId), (id) => recipeSeen(save, id));
  const cards = countPart(marketExploreCards(marketId), (kind) => cardSeen(save, marketId, kind));
  const have = foods.have + recipes.have + cards.have;
  const total = foods.total + recipes.total + cards.total;
  const ratio = total > 0 ? have / total : 1;
  return {
    foods,
    recipes,
    cards,
    have,
    total,
    ratio,
    complete: total > 0 && have >= total,
  };
}

/** 卡片上只报一个大概进度，凑整到 5%，满了才是 100。 */
export function explorePercent(view: MarketExploration): number {
  if (view.complete) return 100;
  if (view.have <= 0) return 0;
  const raw = Math.round(view.ratio * 20) * 5;
  return Math.max(5, Math.min(95, raw));
}

function specialtyFoodIds(specId: string): string[] {
  const spec = SPECIALTIES[specId];
  if (!spec) return [];
  return [...spec.common, ...spec.rare, ...spec.epic, ...(spec.legendary ?? [])];
}

export function marketExtraFoodIds(marketId: MarketId): string[] {
  const pool = new Set(marketFoodIds(marketId));
  const extra: string[] = [];
  const seen = new Set<string>();
  for (const specId of MARKET_SPECIALTIES[marketId] ?? []) {
    for (const id of specialtyFoodIds(specId)) {
      if (pool.has(id) || seen.has(id)) continue;
      seen.add(id);
      extra.push(id);
    }
  }
  return extra;
}

export interface MarketLootRow {
  id: string;
  chance: number;
  stall?: StallId;
  extra: boolean;
}

/** 探索满后给玩家看的出货表：摊池带权重，节拍专属没有摊权的另列。 */
export function marketLootRows(marketId: MarketId, cookLevel: number): MarketLootRow[] {
  const rows: MarketLootRow[] = marketProduceChances(marketId, cookLevel, STALL_WEIGHTS[marketId]).map((row: MarketProduceRow) => ({
    id: row.id,
    chance: row.chance,
    stall: row.stall,
    extra: false,
  }));
  const listed = new Set(rows.map((row) => row.id));
  for (const id of marketExtraFoodIds(marketId)) {
    if (listed.has(id)) continue;
    rows.push({ id, chance: 0, extra: true });
  }
  return rows;
}

export function formatLootChance(chance: number, extra: boolean): string {
  if (extra) return '专属';
  const pct = chance * 100;
  if (pct <= 0) return '—';
  if (pct < 0.1) return '<0.1%';
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}
