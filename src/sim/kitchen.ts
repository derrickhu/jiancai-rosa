import { displayName, getItem, GOD_PICK, sellPrice, type Quality } from './items';
import { VEHICLES, migrateVehicles, ownsVehicle, vehicleById, vehicleIndex, vehicleOffer, type VehicleId } from './vehicles';
import { nextUid, type ExtractedItem } from './run';
import {
  RECIPES,
  isRecipeId,
  isRecipeUnlocked,
  migrateRecipeId,
  pickRecipeFoods,
  recipeById,
  recipeUnlockView,
  type RecipeId,
} from './recipes';

export {
  RECIPES,
  recipeNeeds,
  recipeCanCook,
  recipeCookCount,
  recipeXp,
  pickRecipeFoods,
  isRecipeUnlocked,
  unlockedRecipes,
  unlockedIngredients,
  recipeRarity,
  tallyNeeds,
  recipeUnlockView,
  recipesGainedByTable,
  recipesGainedByCook,
  remainingMarketRecipes,
  isRecipeId,
  recipeById,
  START_RECIPES,
  TABLE_UNLOCKS,
  COOK_UNLOCK_AT,
  MARKET_RECIPE_POOL,
} from './recipes';
export type { RecipeId, RecipeDef, RecipeNeed } from './recipes';
import {
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_MAX_LEVEL,
  clampFurnLevel,
  clampHouseLevel,
  furnLabel,
  houseFurnCap,
  houseLabel,
  minHouseForFurn,
  type FurnId,
} from './kitchenLayout';

export const STAMINA_MAX = 5;
export const STAMINA_REGEN_MS = 30 * 60 * 1000;
export const FRIDGE_BASE = 12;
/** 冰箱内部 0–9 级的格数。回家后干湿饭菜都进这些格，不分仓。每升一级 +6。 */
export const FRIDGE_CAP = [12, 18, 24, 30, 36, 42, 48, 54, 60, 66];
/** 同一格里同种食材/饭菜最多叠多少份。多了另开一格。 */
export const FRIDGE_STACK = 10;
export const UPGRADE_BASKET_I = 80;
export const UPGRADE_BASKET_II = 200;
export const UPGRADE_FRIDGE = 60;

export function emptyFurnLevels(): Record<FurnId, number> {
  return { fridge: 0, cook: 0, table: 0, basket: 0, foam: 0, recipe: 0 };
}

export function furnLevel(save: KitchenSave, id: FurnId): number {
  return clampFurnLevel(save.furnLevels?.[id] ?? 0);
}

export function houseLevel(save: KitchenSave): number {
  return clampHouseLevel(save.houseLevel ?? 0);
}

export type FridgeKind = 'food' | 'dish';

export interface FridgeItem {
  uid: string;
  kind?: FridgeKind;
  defId: string;
  quality: Quality;
  inspected: boolean;
  freshness: number;
  /** 这一格叠了几份。旧存档没有就当 1。 */
  qty?: number;
  /** 熟菜出锅时记下的售价。 */
  value?: number;
}

export type FridgeDraft = Pick<FridgeItem, 'defId' | 'quality' | 'inspected' | 'freshness'> & {
  uid?: string;
  kind?: FridgeKind;
  qty?: number;
  value?: number;
};

export function fridgeKind(it: FridgeItem): FridgeKind {
  return it.kind === 'dish' ? 'dish' : 'food';
}

export function fridgeItemName(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') {
    return RECIPES.find((r) => r.id === it.defId)?.name ?? '熟菜';
  }
  return displayName(it.defId, it.inspected, it.quality);
}

export function fridgeItemQty(it: { qty?: number }): number {
  return Math.max(1, Math.floor(it.qty ?? 1));
}

export function fridgeQtySum(items: readonly { qty?: number }[]): number {
  return items.reduce((sum, it) => sum + fridgeItemQty(it), 0);
}

/** 能叠进同一格：同类、同 id、同品质、同鉴定状态。 */
export function fridgeStackKey(it: FridgeDraft): string {
  const kind = it.kind === 'dish' ? 'dish' : 'food';
  return `${kind}|${it.defId}|${it.quality}|${it.inspected ? 1 : 0}`;
}

export function fridgeItemUnitPrice(it: FridgeItem): number {
  if (fridgeKind(it) === 'dish') return Math.max(0, it.value ?? 0);
  return sellPrice(it.defId, it.quality, it.inspected, it.freshness);
}

export function fridgeItemPrice(it: FridgeItem): number {
  return fridgeItemUnitPrice(it) * fridgeItemQty(it);
}

export function fridgeItemBlurb(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') {
    return RECIPES.find((r) => r.id === it.defId)?.blurb ?? '刚出锅，还冒着热气。';
  }
  if (it.quality === 'rotten') {
    return getItem(it.defId).blurbRotten ?? '放久了，连自己都认不出自己。';
  }
  if (it.defId === GOD_PICK.id && !it.inspected) return getItem('smallfish').blurb;
  return getItem(it.defId).blurb;
}

export interface KitchenSave {
  version: 1;
  money: number;
  stamina: number;
  staminaAt: number;
  fridge: FridgeItem[];
  /** @deprecated 由 furnLevels.basket 迁移 */
  basketLevel: number;
  /** @deprecated 由 furnLevels.fridge / foam 迁移 */
  fridgeExtra: boolean;
  furnLevels: Record<FurnId, number>;
  /** 房屋 0 陋屋 / 1 精装屋 / 2 雅致屋。大件家具升级受这一档限制。 */
  houseLevel: number;
  dexSeen: string[];
  dexInspected: string[];
  recipesCooked: RecipeId[];
  /** 三场捡到的菜谱。只能捡，台子和厨艺不送。 */
  recipesFound: RecipeId[];
  dailyGodPickDate: string;
  lastSeenAt: number;
  /** 厨艺等级 1–15。做菜加经验，出门选点和家具门槛都看它。 */
  level: number;
  /** 本级经验。满级后条停在满。 */
  xp: number;
  /** 明牌记忆：走过的卡型，存 `菜场:卡型`。地图每局重生，所以不记节点 id。 */
  seenCards: string[];
  /** 出门选点页当前骑的那辆。走路开局就有。 */
  vehicle: VehicleId;
  /** 已买下的交通工具。走路不写也算有。 */
  vehicles: VehicleId[];
}

export function todayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function defaultSave(now = Date.now()): KitchenSave {
  return {
    version: 1,
    money: 0,
    stamina: STAMINA_MAX,
    staminaAt: now,
    fridge: [],
    basketLevel: 0,
    fridgeExtra: false,
    furnLevels: emptyFurnLevels(),
    houseLevel: 0,
    dexSeen: [],
    dexInspected: [],
    recipesCooked: [],
    recipesFound: [],
    dailyGodPickDate: '',
    lastSeenAt: now,
    level: 1,
    xp: 0,
    seenCards: [],
    vehicle: 'walk',
    vehicles: ['walk'],
  };
}

export function normalizeSave(raw: Partial<KitchenSave> | null, now = Date.now()): KitchenSave {
  const base = defaultSave(now);
  if (!raw) return base;
  const next: KitchenSave = {
    ...base,
    ...raw,
    version: 1,
    level: clampCookLevel(typeof raw.level === 'number' && raw.level > 0 ? raw.level : 1),
    xp: typeof raw.xp === 'number' && raw.xp > 0 ? Math.floor(raw.xp) : 0,
    fridge: migrateFridgeItems(raw.fridge),
    furnLevels: migrateFurnLevels(raw),
    houseLevel: 0,
    dexSeen: Array.isArray(raw.dexSeen) ? raw.dexSeen : [],
    dexInspected: Array.isArray(raw.dexInspected) ? raw.dexInspected : [],
    recipesCooked: migrateRecipeIds(raw.recipesCooked),
    recipesFound: migrateRecipeIds((raw as KitchenSave).recipesFound),
    seenCards: Array.isArray(raw.seenCards) ? raw.seenCards : [],
    ...migrateVehicles(raw),
  };
  next.basketLevel = next.furnLevels.basket;
  next.fridgeExtra = next.furnLevels.fridge > 0 || next.furnLevels.foam > 0;
  next.houseLevel = migrateHouseLevel(raw);
  return next;
}

function migrateRecipeIds(raw: unknown): RecipeId[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeId[] = [];
  for (const id of raw) {
    if (typeof id !== 'string') continue;
    const next = migrateRecipeId(id);
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}

function migrateFridgeItems(raw: unknown): FridgeItem[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map((it) => {
    const row = it as FridgeItem;
    const dish = row.kind === 'dish';
    const defId = dish && typeof row.defId === 'string'
      ? (migrateRecipeId(row.defId) ?? row.defId)
      : row.defId;
    let quality = row.quality;
    if (!dish && quality !== 'rotten' && quality !== 'god') quality = 'common';
    return {
      ...row,
      defId,
      kind: dish ? 'dish' as const : 'food' as const,
      quality,
      inspected: dish || row.defId === 'wild_yellowfish' ? true : (row.inspected ?? true),
      qty: fridgeItemQty(row),
    };
  });
  return compactFridge(mapped.filter((it) => it.kind === 'dish' || it.quality !== 'rotten'));
}

function migrateHouseLevel(raw: Partial<KitchenSave>): number {
  if (typeof raw.houseLevel === 'number') return clampHouseLevel(raw.houseLevel);
  const furn = migrateFurnLevels(raw);
  let need = 0;
  for (const id of FURN_IDS) {
    need = Math.max(need, minHouseForFurn(id, furn[id]));
  }
  return need;
}

function migrateFurnLevels(raw: Partial<KitchenSave>): Record<FurnId, number> {
  const next = emptyFurnLevels();
  const src = raw.furnLevels;
  if (src && typeof src === 'object') {
    for (const id of FURN_IDS) {
      if (typeof src[id] === 'number') next[id] = clampFurnLevel(src[id]);
    }
  }
  if (typeof raw.basketLevel === 'number' && next.basket === 0) {
    next.basket = clampFurnLevel(raw.basketLevel);
  }
  if (raw.fridgeExtra) {
    if (next.fridge === 0) next.fridge = 1;
    if (next.foam === 0) next.foam = 1;
  }
  return next;
}

export function fridgeOwnCap(level: number): number {
  return FRIDGE_CAP[clampFurnLevel(level)] ?? FRIDGE_BASE;
}

export function fridgeCap(save: KitchenSave): number {
  return fridgeOwnCap(furnLevel(save, 'fridge'));
}

export function fridgeRoom(save: KitchenSave): number {
  return Math.max(0, fridgeCap(save) - save.fridge.length);
}

/** 还有空格，或已有格子没叠满，出门还能往回塞。 */
export function fridgeAcceptsOuting(save: KitchenSave): boolean {
  if (fridgeRoom(save) > 0) return true;
  return save.fridge.some((it) => fridgeItemQty(it) < FRIDGE_STACK);
}

function asFridgeItem(it: FridgeDraft): FridgeItem {
  return {
    uid: it.uid ?? nextUid(it.kind === 'dish' ? 'd' : 'f'),
    kind: it.kind === 'dish' ? 'dish' : 'food',
    defId: it.defId,
    quality: it.quality,
    inspected: it.inspected,
    freshness: it.freshness,
    qty: fridgeItemQty(it),
    value: it.value,
  };
}

export function putIntoFridge(fridge: FridgeItem[], item: FridgeItem): FridgeItem[] {
  let left = fridgeItemQty(item);
  const key = fridgeStackKey(item);
  const next = fridge.map((it) => ({ ...it }));
  for (const it of next) {
    if (left <= 0) break;
    if (fridgeStackKey(it) !== key) continue;
    const space = FRIDGE_STACK - fridgeItemQty(it);
    if (space <= 0) continue;
    const add = Math.min(space, left);
    it.qty = fridgeItemQty(it) + add;
    it.freshness = Math.max(it.freshness, item.freshness);
    if (item.value != null) it.value = Math.max(it.value ?? 0, item.value);
    left -= add;
  }
  let first = true;
  while (left > 0) {
    const add = Math.min(FRIDGE_STACK, left);
    next.push({
      ...item,
      uid: first && item.uid ? item.uid : nextUid(item.kind === 'dish' ? 'd' : 'f'),
      qty: add,
    });
    first = false;
    left -= add;
  }
  return next;
}

function compactFridge(items: FridgeItem[]): FridgeItem[] {
  return items.reduce((fridge, it) => putIntoFridge(fridge, { ...it, qty: fridgeItemQty(it) }), [] as FridgeItem[]);
}

export function simulateIngest(fridge: FridgeItem[], items: FridgeDraft[]): FridgeItem[] {
  return items.reduce((next, it) => putIntoFridge(next, asFridgeItem(it)), fridge.map((row) => ({ ...row })));
}

export function fridgeCanFit(save: KitchenSave, items: FridgeDraft[]): boolean {
  return simulateIngest(save.fridge, items).length <= fridgeCap(save);
}

/** 这批货还要新开几格。能叠进现有格子的不算。 */
export function fridgeSlotsNeeded(save: KitchenSave, items: FridgeDraft[]): number {
  return Math.max(0, simulateIngest(save.fridge, items).length - save.fridge.length);
}

/** 至少卖掉几件（篓里或冰箱里）剩下的才能装下。 */
export function fridgeUnpackNeed(save: KitchenSave, haul: FridgeDraft[]): number {
  if (fridgeCanFit(save, haul)) return 0;
  const ranked = [...haul].sort((a, b) => {
    const space = (it: FridgeDraft) => {
      const key = fridgeStackKey(it);
      return save.fridge.reduce((n, row) => (
        fridgeStackKey(row) === key ? n + Math.max(0, FRIDGE_STACK - fridgeItemQty(row)) : n
      ), 0);
    };
    const da = space(b) - space(a);
    if (da) return da;
    return fridgeStackKey(a).localeCompare(fridgeStackKey(b));
  });
  const keep: FridgeDraft[] = [];
  for (const it of ranked) {
    if (fridgeCanFit(save, [...keep, it])) keep.push(it);
  }
  return haul.length - keep.length;
}

function consumeFridgeQty(fridge: FridgeItem[], used: Map<string, number>): FridgeItem[] {
  const next: FridgeItem[] = [];
  for (const it of fridge) {
    const take = used.get(it.uid) ?? 0;
    const qty = fridgeItemQty(it) - take;
    if (qty <= 0) continue;
    next.push(qty === fridgeItemQty(it) ? it : { ...it, qty });
  }
  return next;
}

export function regenStamina(save: KitchenSave, now = Date.now()): KitchenSave {
  if (save.stamina >= STAMINA_MAX) return { ...save, staminaAt: now };
  const elapsed = Math.max(0, now - save.staminaAt);
  const gained = Math.floor(elapsed / STAMINA_REGEN_MS);
  if (gained <= 0) return save;
  const stamina = Math.min(STAMINA_MAX, save.stamina + gained);
  const leftover = elapsed % STAMINA_REGEN_MS;
  return { ...save, stamina, staminaAt: now - leftover };
}

export function decayFridge(save: KitchenSave, now = Date.now()): KitchenSave {
  return { ...save, lastSeenAt: now };
}

export function noteDex(save: KitchenSave, items: ExtractedItem[]): KitchenSave {
  const dexSeen = new Set(save.dexSeen);
  const dexInspected = new Set(save.dexInspected);
  for (const it of items) {
    dexSeen.add(it.inspected ? it.defId : (it.defId === 'wild_yellowfish' ? 'smallfish' : it.defId));
    if (it.inspected) dexInspected.add(it.defId);
  }
  return { ...save, dexSeen: [...dexSeen], dexInspected: [...dexInspected] };
}

export function ingestExtract(save: KitchenSave, items: ExtractedItem[], now = Date.now()): KitchenSave {
  const keep = items.filter((it) => it.quality !== 'rotten');
  const incoming: FridgeItem[] = keep.map((it) => ({
    uid: it.uid,
    kind: 'food',
    defId: it.defId,
    quality: it.quality,
    inspected: it.inspected,
    freshness: it.freshness,
    qty: 1,
  }));
  const next = noteDex(save, keep);
  return {
    ...next,
    fridge: incoming.reduce((fridge, it) => putIntoFridge(fridge, it), next.fridge),
    dailyGodPickDate: keep.some((it) => it.defId === 'wild_yellowfish') ? todayKey(now) : save.dailyGodPickDate,
  };
}

export function sellItems(save: KitchenSave, uids: string[]): { save: KitchenSave; gained: number } {
  let gained = 0;
  const remain: FridgeItem[] = [];
  for (const it of save.fridge) {
    if (!uids.includes(it.uid)) {
      remain.push(it);
      continue;
    }
    gained += fridgeItemPrice(it);
  }
  return { save: { ...save, fridge: remain, money: save.money + gained }, gained };
}

export function cookRecipe(
  save: KitchenSave,
  recipeId: RecipeId,
  uids?: string[],
): { save: KitchenSave; error?: string; xp?: number; levels?: number } {
  const recipe = recipeById(recipeId);
  if (!recipe) return { save, error: '未知菜谱' };
  const view = recipeUnlockView(save);
  if (!isRecipeUnlocked(view, recipeId)) return { save, error: '还不会这道菜' };
  const items = uids?.length
    ? pickRecipeFoods({ ...view, fridge: save.fridge.filter((it) => uids.includes(it.uid)) }, recipeId)
    : pickRecipeFoods(view, recipeId);
  if (!items.length) return { save, error: `材料不够：${recipe.desc}` };
  if (items.some((it) => it.quality === 'rotten')) return { save, error: '坏了，不能下锅' };
  if (!recipe.match(items)) return { save, error: `材料不对：${recipe.desc}` };
  const value = recipe.cook(items);
  const used = new Map<string, number>();
  for (const it of items) {
    if (!it.uid) continue;
    used.set(it.uid, (used.get(it.uid) ?? 0) + 1);
  }
  const dish: FridgeItem = {
    uid: nextUid('d'),
    kind: 'dish',
    defId: recipeId,
    quality: 'fresh',
    inspected: true,
    freshness: 4,
    qty: 1,
    value,
  };
  const fridge = putIntoFridge(consumeFridgeQty(save.fridge, used), dish);
  if (fridge.length > fridgeCap(save)) return { save, error: '冰箱满了，腾一格再做菜' };
  const first = !save.recipesCooked.includes(recipeId);
  const recipesCooked = first ? [...save.recipesCooked, recipeId] : save.recipesCooked;
  const gained = recipe.xp + (first ? recipe.firstXp : 0);
  const next = grantCookXp({ ...save, fridge, recipesCooked }, gained);
  return { save: next.save, xp: next.gained, levels: next.levels };
}

export function upgradeCost(id: FurnId, fromLevel: number): number {
  const lv = clampFurnLevel(fromLevel);
  // 食材表改成按占格公式化定价后整体涨了一档，这里同步抬价，
  // 否则一趟菜场就能换一次升级，攒钱又变得没有挑战。
  const base: Record<FurnId, number> = {
    fridge: 90,
    cook: 80,
    table: 65,
    basket: 72,
    foam: 55,
    recipe: 45,
  };
  return Math.round(base[id] * Math.pow(1.38, lv));
}

export const HOUSE_UPGRADE_COST = [380, 980];
/** 陋屋→精装屋要厨艺 4，精装屋→雅致屋要厨艺 8。 */
export const HOUSE_COOK_NEED = [4, 8];
export const COOK_LEVEL_MAX = 15;
/**
 * COOK_XP_TO_NEXT[当前厨艺] = 升到下一级所需。
 * 大约是旧表的 3 倍：做菜给的经验没变，升一级要炒更久，才跟得上家具金币节奏。
 */
export const COOK_XP_TO_NEXT = [0, 60, 110, 180, 250, 340, 450, 580, 720, 900, 1120, 1350, 1620, 1930, 2250];
const COOK_XP_MAXED = COOK_XP_TO_NEXT[COOK_LEVEL_MAX - 1];

/** 烹饪台从当前内部等级再升一级时新解锁几本。 */
export const TABLE_UNLOCK_NEXT = [3, 3, 3, 3, 3, 3, 3, 3, 3];

export function tableUnlockNext(fromLevel: number): number {
  return TABLE_UNLOCK_NEXT[clampFurnLevel(fromLevel)] ?? 3;
}

/** 升到下一级家具所需厨艺。下标是当前内部等级 0–8。 */
const FURN_COOK_NEED: Record<FurnId, number[]> = {
  table: [1, 1, 3, 4, 6, 7, 8, 10, 12],
  fridge: [1, 1, 3, 4, 5, 6, 7, 9, 11],
  basket: [1, 2, 3, 4, 5, 6, 7, 9, 11],
  foam: [1, 1, 3, 4, 5, 6, 7, 9, 11],
  cook: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  recipe: [1, 1, 1, 1, 1, 1, 1, 1, 1],
};

export function clampCookLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(COOK_LEVEL_MAX, Math.floor(level)));
}

export function cookLevel(save: KitchenSave): number {
  return clampCookLevel(save.level);
}

export function cookXp(save: KitchenSave): number {
  return Math.max(0, Math.floor(save.xp ?? 0));
}

export function xpToNext(level: number): number {
  const lv = clampCookLevel(level);
  if (lv >= COOK_LEVEL_MAX) return 0;
  return COOK_XP_TO_NEXT[lv] ?? 0;
}

export function cookXpView(save: KitchenSave): {
  level: number;
  xp: number;
  need: number;
  fill: number;
  maxed: boolean;
  text: string;
} {
  const level = cookLevel(save);
  const maxed = level >= COOK_LEVEL_MAX;
  const need = maxed ? COOK_XP_MAXED : xpToNext(level);
  const xp = maxed ? need : Math.min(cookXp(save), need);
  return {
    level,
    xp,
    need,
    fill: need > 0 ? xp / need : 1,
    maxed,
    text: maxed ? '已满级' : `${xp}/${need}`,
  };
}

export function grantCookXp(save: KitchenSave, amount: number): { save: KitchenSave; gained: number; levels: number } {
  const gained = Math.max(0, Math.floor(amount));
  if (gained <= 0) return { save, gained: 0, levels: 0 };
  let level = cookLevel(save);
  let xp = cookXp(save);
  let levels = 0;
  if (level >= COOK_LEVEL_MAX) {
    return { save: { ...save, level: COOK_LEVEL_MAX, xp: COOK_XP_MAXED }, gained, levels: 0 };
  }
  xp += gained;
  while (level < COOK_LEVEL_MAX) {
    const need = xpToNext(level);
    if (need <= 0 || xp < need) break;
    xp -= need;
    level += 1;
    levels += 1;
  }
  if (level >= COOK_LEVEL_MAX) xp = COOK_XP_MAXED;
  return { save: { ...save, level, xp }, gained, levels };
}

export function furnCookNeed(id: FurnId, fromLevel: number): number {
  const lv = clampFurnLevel(fromLevel);
  return FURN_COOK_NEED[id]?.[lv] ?? 1;
}

export function houseCookNeed(fromLevel: number): number {
  const h = clampHouseLevel(fromLevel);
  if (h >= HOUSE_MAX_LEVEL) return 1;
  return HOUSE_COOK_NEED[h] ?? 1;
}

export function houseUpgradeCost(fromLevel: number): number {
  const h = clampHouseLevel(fromLevel);
  if (h >= HOUSE_MAX_LEVEL) return 0;
  return HOUSE_UPGRADE_COST[h];
}

export type HouseUpgradeState =
  | { status: 'max' }
  | { status: 'ready'; cost: number }
  | { status: 'blocked'; cost: number; error: string };

export function houseUpgradeState(save: KitchenSave): HouseUpgradeState {
  const level = houseLevel(save);
  if (level >= HOUSE_MAX_LEVEL) return { status: 'max' };
  const cost = houseUpgradeCost(level);
  const need = houseCookNeed(level);
  if (cookLevel(save) < need) {
    return { status: 'blocked', cost, error: `厨艺 ${need} 级才能升` };
  }
  if (save.money < cost) return { status: 'blocked', cost, error: `差 ${cost - save.money} 金币` };
  return { status: 'ready', cost };
}

export function buyHouseUpgrade(save: KitchenSave): { save: KitchenSave; error?: string } {
  const state = houseUpgradeState(save);
  if (state.status === 'max') return { save, error: '屋子已经最大了' };
  if (state.status === 'blocked') return { save, error: state.error };
  const level = houseLevel(save);
  return { save: { ...save, money: save.money - state.cost, houseLevel: level + 1 } };
}

export type FurnUpgradeState =
  | { status: 'max' }
  | { status: 'ready'; cost: number }
  | { status: 'blocked'; cost: number; error: string };

export function furnUpgradeState(save: KitchenSave, id: FurnId): FurnUpgradeState {
  const level = furnLevel(save, id);
  if (level >= FURN_MAX_LEVEL) return { status: 'max' };
  const cost = upgradeCost(id, level);
  const cap = houseFurnCap(houseLevel(save), id);
  if (level >= cap) {
    const need = minHouseForFurn(id, level + 1);
    return {
      status: 'blocked',
      cost,
      error: `先把屋子装修到${houseLabel(need)}，才能升级${furnLabel(id, level)}`,
    };
  }
  const cookNeed = furnCookNeed(id, level);
  if (cookLevel(save) < cookNeed) {
    return { status: 'blocked', cost, error: `厨艺 ${cookNeed} 级才能升` };
  }
  if (save.money < cost) return { status: 'blocked', cost, error: `差 ${cost - save.money} 金币` };
  return { status: 'ready', cost };
}

export function buyFurnUpgrade(save: KitchenSave, id: FurnId): { save: KitchenSave; error?: string } {
  const state = furnUpgradeState(save, id);
  if (state.status === 'max') return { save, error: '已经最高级了' };
  if (state.status === 'blocked') return { save, error: state.error };
  const level = furnLevel(save, id);
  const cost = state.cost;
  const furnLevels = { ...save.furnLevels, [id]: level + 1 };
  return {
    save: {
      ...save,
      money: save.money - cost,
      furnLevels,
      basketLevel: furnLevels.basket,
      fridgeExtra: furnLevels.fridge > 0 || furnLevels.foam > 0,
    },
  };
}

export function buyUpgrade(save: KitchenSave, kind: 'basket1' | 'basket2' | 'fridge'): { save: KitchenSave; error?: string } {
  if (kind === 'fridge') return buyFurnUpgrade(save, 'fridge');
  return buyFurnUpgrade(save, 'basket');
}

export function buyVehicle(save: KitchenSave, id: VehicleId): { save: KitchenSave; error?: string } {
  const def = vehicleById(id);
  if (def.cost <= 0) return { save, error: '走路不用买' };
  if (ownsVehicle(save, id)) return { save, error: '已经有了' };
  if (vehicleOffer(save, id) === 'locked') {
    const prev = VEHICLES[vehicleIndex(id) - 1];
    return { save, error: `先买${prev?.name ?? '上一辆'}` };
  }
  if (save.money < def.cost) return { save, error: `差 ${def.cost - save.money} 金币，先回家卖点菜` };
  const vehicles = save.vehicles.includes(id) ? save.vehicles : [...save.vehicles, id];
  return { save: { ...save, money: save.money - def.cost, vehicles, vehicle: id } };
}

export function selectVehicle(save: KitchenSave, id: VehicleId): KitchenSave {
  if (!ownsVehicle(save, id) || save.vehicle === id) return save;
  return { ...save, vehicle: id };
}

export function spendStamina(save: KitchenSave, now = Date.now()): { save: KitchenSave; error?: string } {
  const next = regenStamina(save, now);
  if (next.stamina <= 0) return { save: next, error: '没有体力了' };
  const stamina = next.stamina - 1;
  return { save: { ...next, stamina, staminaAt: stamina >= STAMINA_MAX ? now : next.staminaAt } };
}

export function addStamina(save: KitchenSave, n = 1, now = Date.now()): KitchenSave {
  const next = regenStamina(save, now);
  return { ...next, stamina: Math.min(STAMINA_MAX + 3, next.stamina + n) };
}
