import { getItem, type ItemDef } from './items';

export interface BasketItem {
  uid: string;
  defId: string;
  quality: import('./items').Quality;
  inspected: boolean;
  freshness: number;
  x: number;
  y: number;
  rot: 0 | 1;
  pinned: boolean;
  dampened: boolean;
  broken?: boolean;
}

export interface BasketPocket {
  x: number;
  y: number;
}

export interface BasketExtras {
  extraDryCells?: number;
  extraWetCells?: number;
  extraDryRows?: number;
  extraWetRows?: number;
}

export interface BasketState {
  cols: number;
  rows: number;
  wetCols: number;
  wetRows: number;
  dryRows: number;
  insulatedBottom: boolean;
  /** 顶上一行广告解锁，只当次有效，干湿都能放。 */
  flexUnlocked: boolean;
  /** 吃菜当次旁挂的干格，不改家具。 */
  pocketDry?: BasketPocket;
  /** 吃菜当次旁挂的湿格，不改家具。 */
  pocketWet?: BasketPocket;
  items: BasketItem[];
}

export type BasketCellKind = 'wet' | 'dry' | 'flex' | 'none';

/** 最上预留的广告通用行。锁着时不占可用格，坐标仍从这一行下面起算，解锁不用挪货。 */
export const BASKET_FLEX_ROWS = 1;

/** 塑料袋/菜篮：出门干区列数。每升一级至少加一列或一行。 */
export const BAG_DRY_COLS = [4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
/** 塑料袋/菜篮：出门干区行数。只影响干区，从上往下长。 */
export const BAG_ROWS = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8];
/** 泡沫箱/水桶：出门湿区列数。每升一级至少加一列或一行。 */
export const FOAM_WET_COLS = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
/** 泡沫箱/水桶：出门湿区行数。只影响湿区，从上往下长。 */
export const FOAM_WET_ROWS = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8];

function clampBagLevel(level: number): number {
  return Math.max(0, Math.min(9, Math.floor(level)));
}

export function bagDryCols(basketLevel: number): number {
  return BAG_DRY_COLS[clampBagLevel(basketLevel)] ?? 4;
}

export function bagRows(basketLevel: number): number {
  return BAG_ROWS[clampBagLevel(basketLevel)] ?? 3;
}

export function foamWetCols(foamLevel: number): number {
  return FOAM_WET_COLS[clampBagLevel(foamLevel)] ?? 2;
}

export function foamWetRows(foamLevel: number): number {
  return FOAM_WET_ROWS[clampBagLevel(foamLevel)] ?? 3;
}

export function outingDryCells(basketLevel: number): number {
  return bagDryCols(basketLevel) * bagRows(basketLevel);
}

export function outingWetCells(foamLevel: number): number {
  return foamWetCols(foamLevel) * foamWetRows(foamLevel);
}

export function createBasket(basketLevel: number, foamLevel = 0, extras: BasketExtras = {}): BasketState {
  const dryCols = bagDryCols(basketLevel);
  const dryRows = bagRows(basketLevel) + Math.max(0, extras.extraDryRows ?? 0);
  const wetCols = foamWetCols(foamLevel);
  const wetRows = foamWetRows(foamLevel) + Math.max(0, extras.extraWetRows ?? 0);
  const hangDry = (extras.extraDryCells ?? 0) > 0;
  const hangWet = (extras.extraWetCells ?? 0) > 0;
  const hang = hangDry || hangWet;
  const cols = wetCols + dryCols + (hang ? 1 : 0);
  const pocketX = wetCols + dryCols;
  const pocketDry = hangDry ? { x: pocketX, y: BASKET_FLEX_ROWS } : undefined;
  const pocketWet = hangWet
    ? { x: pocketX, y: BASKET_FLEX_ROWS + (hangDry ? 1 : 0) }
    : undefined;
  const pocketBottom = pocketWet ? pocketWet.y + 1 : pocketDry ? pocketDry.y + 1 : 0;
  return {
    cols,
    rows: Math.max(BASKET_FLEX_ROWS + Math.max(wetRows, dryRows), pocketBottom),
    wetCols,
    wetRows,
    dryRows,
    insulatedBottom: clampBagLevel(basketLevel) >= 3,
    flexUnlocked: false,
    pocketDry,
    pocketWet,
    items: [],
  };
}

export function unlockBasketFlex(state: BasketState): BasketState {
  if (state.flexUnlocked) return state;
  return { ...state, flexUnlocked: true };
}

/** 分区从上往下长。矮的那一侧下方不画、也不能放。顶行解锁前是空的。 */
export function basketCellKind(state: BasketState, x: number, y: number): BasketCellKind {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return 'none';
  if (state.pocketDry && x === state.pocketDry.x && y === state.pocketDry.y) return 'dry';
  if (state.pocketWet && x === state.pocketWet.x && y === state.pocketWet.y) return 'wet';
  if (y < BASKET_FLEX_ROWS) return state.flexUnlocked ? 'flex' : 'none';
  const localY = y - BASKET_FLEX_ROWS;
  if (x < state.wetCols && localY < state.wetRows) return 'wet';
  const hang = !!(state.pocketDry || state.pocketWet);
  const dryCols = state.cols - state.wetCols - (hang ? 1 : 0);
  if (x >= state.wetCols && x < state.wetCols + dryCols && localY < state.dryRows) return 'dry';
  return 'none';
}

function isFoamWetCell(state: BasketState, x: number, y: number): boolean {
  if (state.pocketWet && x === state.pocketWet.x && y === state.pocketWet.y) return true;
  if (x < 0 || x >= state.wetCols) return false;
  const localY = y - BASKET_FLEX_ROWS;
  return localY >= 0 && localY < state.wetRows;
}

function acceptsWet(state: BasketState, x: number, y: number): boolean {
  const kind = basketCellKind(state, x, y);
  return kind === 'wet' || kind === 'flex';
}

export function footprint(def: ItemDef, rot: 0 | 1): { w: number; h: number } {
  return rot === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

export function occupiedCells(item: Pick<BasketItem, 'defId' | 'x' | 'y' | 'rot'>): Array<{ x: number; y: number }> {
  const def = getItem(item.defId);
  const { w, h } = footprint(def, item.rot);
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push({ x: item.x + dx, y: item.y + dy });
    }
  }
  return cells;
}

function occupancyMap(state: BasketState, ignoreUid?: string): Map<string, BasketItem> {
  const map = new Map<string, BasketItem>();
  for (const item of state.items) {
    if (item.uid === ignoreUid) continue;
    for (const c of occupiedCells(item)) {
      map.set(`${c.x},${c.y}`, item);
    }
  }
  return map;
}

function neighborsOf(cells: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const self = new Set(cells.map((c) => `${c.x},${c.y}`));
  const out: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const c of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx;
      const y = c.y + dy;
      const key = `${x},${y}`;
      if (self.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
    }
  }
  return out;
}

export function canPlace(
  state: BasketState,
  draft: Pick<BasketItem, 'uid' | 'defId' | 'x' | 'y' | 'rot'>,
): { ok: true } | { ok: false; reason: string } {
  const def = getItem(draft.defId);
  const { w, h } = footprint(def, draft.rot);
  if (draft.x < 0 || draft.y < 0 || draft.x + w > state.cols || draft.y + h > state.rows) {
    return { ok: false, reason: '超出菜篮' };
  }
  const cells = occupiedCells(draft);
  const occ = occupancyMap(state, draft.uid);
  for (const c of cells) {
    if (basketCellKind(state, c.x, c.y) === 'none') return { ok: false, reason: '超出菜篮' };
    if (occ.has(`${c.x},${c.y}`)) return { ok: false, reason: '这里已经有东西' };
  }

  if (def.zone === 'wet') {
    if (!cells.every((c) => acceptsWet(state, c.x, c.y))) {
      return { ok: false, reason: '湿货必须放湿区' };
    }
  }

  if (def.live) {
    const wetBottom = BASKET_FLEX_ROWS + state.wetRows - 1;
    const onBottom = cells.some((c) => isFoamWetCell(state, c.x, c.y) && c.y === wetBottom);
    if (!onBottom) return { ok: false, reason: '活物要贴湿区底边' };
  }

  const neighborItems = new Set<BasketItem>();
  for (const n of neighborsOf(cells)) {
    const other = occ.get(`${n.x},${n.y}`);
    if (other) neighborItems.add(other);
  }

  if (def.fragile) {
    for (const other of neighborItems) {
      const od = getItem(other.defId);
      if (od.bulky || od.live || od.hard) return { ok: false, reason: '鸡蛋挨着硬货会碎' };
    }
  }
  if (def.squeezable) {
    for (const other of neighborItems) {
      if (getItem(other.defId).live) return { ok: false, reason: '豆腐挨着活物会挤烂' };
    }
  }
  for (const other of neighborItems) {
    const od = getItem(other.defId);
    if (od.fragile && (def.bulky || def.live || def.hard)) {
      return { ok: false, reason: '会挤碎旁边的蛋' };
    }
    if (od.squeezable && def.live) {
      return { ok: false, reason: '会挤烂旁边的豆腐' };
    }
  }

  return { ok: true };
}

export function willDampen(state: BasketState, def: ItemDef, x: number, y: number, rot: 0 | 1): boolean {
  if (def.zone !== 'dry') return false;
  const cells = occupiedCells({ defId: def.id, x, y, rot });
  return cells.some((c) => isFoamWetCell(state, c.x, c.y));
}

function isWetCell(state: BasketState, x: number, y: number): boolean {
  return basketCellKind(state, x, y) === 'wet';
}

/** 干货先扫干区，湿货先扫湿区；广告通用行往后排。near 用来旋转后就近挪一格。 */
function sortedOrigins(
  state: BasketState,
  def: ItemDef,
  rot: 0 | 1,
  near?: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const { w, h } = footprint(def, rot);
  const out: Array<{ x: number; y: number; score: number; dist: number }> = [];
  for (let y = 0; y <= state.rows - h; y++) {
    for (let x = 0; x <= state.cols - w; x++) {
      const cells = occupiedCells({ defId: def.id, x, y, rot });
      if (cells.some((c) => basketCellKind(state, c.x, c.y) === 'none')) continue;
      const wet = cells.filter((c) => isWetCell(state, c.x, c.y)).length;
      const flex = cells.filter((c) => basketCellKind(state, c.x, c.y) === 'flex').length;
      let score = wet * 10 + flex;
      if (def.zone === 'wet') {
        score = cells.every((c) => acceptsWet(state, c.x, c.y)) ? flex : 99;
      }
      const dist = near ? Math.abs(x - near.x) + Math.abs(y - near.y) : 0;
      out.push({ x, y, score, dist });
    }
  }
  out.sort((a, b) => a.score - b.score || a.dist - b.dist || a.y - b.y || a.x - b.x);
  return out;
}

function sealItem(
  state: BasketState,
  item: Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'> & Pick<BasketItem, 'x' | 'y' | 'rot'>,
): BasketItem {
  const def = getItem(item.defId);
  return {
    ...item,
    pinned: false,
    dampened: willDampen(state, def, item.x, item.y, item.rot),
  };
}

export function tryAutoPlace(
  state: BasketState,
  item: Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'>,
): BasketItem | null {
  const def = getItem(item.defId);
  const rots: Array<0 | 1> = def.w === def.h ? [0] : [0, 1];
  for (const rot of rots) {
    for (const { x, y } of sortedOrigins(state, def, rot)) {
      if (canPlace(state, { uid: item.uid, defId: item.defId, x, y, rot }).ok) {
        return sealItem(state, { ...item, x, y, rot });
      }
    }
  }
  return null;
}

export function place(state: BasketState, item: BasketItem): { ok: true; state: BasketState } | { ok: false; reason: string } {
  const check = canPlace(state, item);
  if (!check.ok) return check;
  const next = state.items.filter((it) => it.uid !== item.uid);
  const def = getItem(item.defId);
  next.push({
    ...item,
    dampened: willDampen(state, def, item.x, item.y, item.rot),
  });
  return { ok: true, state: { ...state, items: next } };
}

function overlappingOthers(
  state: BasketState,
  draft: Pick<BasketItem, 'uid' | 'defId' | 'x' | 'y' | 'rot'>,
): BasketItem[] {
  const cells = new Set(occupiedCells(draft).map((c) => `${c.x},${c.y}`));
  const hit = new Map<string, BasketItem>();
  for (const item of state.items) {
    if (item.uid === draft.uid) continue;
    for (const c of occupiedCells(item)) {
      if (cells.has(`${c.x},${c.y}`)) hit.set(item.uid, item);
    }
  }
  return [...hit.values()];
}

export type DropPreview = 'empty' | 'swap' | 'blocked';

/** 影子用：空位绿、压到已有货黄、湿干不对或越界红。 */
export function previewDrop(
  state: BasketState,
  draft: Pick<BasketItem, 'uid' | 'defId' | 'x' | 'y' | 'rot'>,
): DropPreview {
  const others = overlappingOthers(state, draft);
  const ignore = new Set([draft.uid, ...others.map((it) => it.uid)]);
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => !ignore.has(it.uid)),
  };
  if (!canPlace(cleared, draft).ok) return 'blocked';
  return others.length > 0 ? 'swap' : 'empty';
}

export type DropResult =
  | { ok: true; state: BasketState; evicted: BasketItem[] }
  | { ok: false; reason: string };

/**
 * 空位放下；压到一件：篮内能对换就对换，否则上暂存。
 * 压到多件：范围内的都上暂存，再放下。
 */
export function tryDrop(state: BasketState, incoming: BasketItem): DropResult {
  const others = overlappingOthers(state, incoming);
  const old = state.items.find((it) => it.uid === incoming.uid) ?? null;
  const ignore = new Set([incoming.uid, ...others.map((it) => it.uid)]);
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => !ignore.has(it.uid)),
  };
  const landed = place(cleared, incoming);
  if (!landed.ok) return landed;
  if (others.length === 0) return { ok: true, state: landed.state, evicted: [] };

  if (others.length === 1 && old) {
    const evict = others[0];
    const swapped = place(landed.state, { ...evict, x: old.x, y: old.y });
    if (swapped.ok) return { ok: true, state: swapped.state, evicted: [] };
    const nudged = tryAutoPlace(landed.state, evict);
    if (nudged) {
      const put = place(landed.state, nudged);
      if (put.ok) return { ok: true, state: put.state, evicted: [] };
    }
    return { ok: true, state: landed.state, evicted: [evict] };
  }
  return { ok: true, state: landed.state, evicted: others };
}

export function tryRelocate(
  state: BasketState,
  uid: string,
  x: number,
  y: number,
  rot: 0 | 1,
): DropResult {
  const item = state.items.find((it) => it.uid === uid);
  if (!item) return { ok: false, reason: '篮里没有' };
  return tryDrop(state, { ...item, x, y, rot });
}

/** 先原地转，转不开就近挪，再不行上托盘，不报空间不够。 */
export function tryRotateItem(state: BasketState, uid: string): DropResult {
  const item = state.items.find((it) => it.uid === uid);
  if (!item) return { ok: false, reason: '篮里没有' };
  const def = getItem(item.defId);
  if (def.w === def.h) return { ok: true, state, evicted: [] };
  const rot: 0 | 1 = item.rot === 0 ? 1 : 0;
  const without = removeItem(state, uid);
  const same = { ...item, rot };
  if (canPlace(without, same).ok) {
    const put = place(without, same);
    return put.ok ? { ok: true, state: put.state, evicted: [] } : put;
  }
  for (const { x, y } of sortedOrigins(without, def, rot, { x: item.x, y: item.y })) {
    const draft = { ...item, x, y, rot };
    if (canPlace(without, draft).ok) {
      const put = place(without, draft);
      return put.ok ? { ok: true, state: put.state, evicted: [] } : put;
    }
  }
  return { ok: true, state: without, evicted: [{ ...item, rot }] };
}

export function removeItem(state: BasketState, uid: string): BasketState {
  return { ...state, items: state.items.filter((it) => it.uid !== uid) };
}

export function emptyCellsHint(state: BasketState): Array<{ x: number; y: number }> {
  const occ = occupancyMap(state);
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      if (basketCellKind(state, x, y) === 'none') continue;
      if (!occ.has(`${x},${y}`)) cells.push({ x, y });
    }
  }
  return cells;
}

export interface StagingSlot {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rot: 0 | 1;
}

/** 暂存区按真实占格从左到右、从上到下排。至少三行，装不下就往下长。 */
export function packStagingLayout(
  items: Array<{ uid: string; defId: string }>,
  cols: number,
): { slots: StagingSlot[]; rows: number } {
  const safeCols = Math.max(1, cols);
  const occ = new Set<string>();
  const slots: StagingSlot[] = [];
  let usedRows = 0;

  const blocked = (x: number, y: number, w: number, h: number): boolean => {
    if (x < 0 || y < 0 || x + w > safeCols) return true;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (occ.has(`${x + dx},${y + dy}`)) return true;
      }
    }
    return false;
  };

  const mark = (x: number, y: number, w: number, h: number): void => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) occ.add(`${x + dx},${y + dy}`);
    }
    usedRows = Math.max(usedRows, y + h);
  };

  for (const it of items) {
    const def = getItem(it.defId);
    const rots: Array<0 | 1> = def.w === def.h ? [0] : [0, 1];
    let placed = false;
    for (const rot of rots) {
      const { w, h } = footprint(def, rot);
      if (w > safeCols) continue;
      for (let y = 0; y < 24 && !placed; y++) {
        for (let x = 0; x <= safeCols - w; x++) {
          if (blocked(x, y, w, h)) continue;
          mark(x, y, w, h);
          slots.push({ uid: it.uid, defId: it.defId, x, y, rot });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }

  return { slots, rows: Math.max(3, usedRows) };
}

export function validPlacements(
  state: BasketState,
  uid: string,
  defId: string,
  rot?: 0 | 1,
): Array<{ x: number; y: number; rot: 0 | 1 }> {
  const def = getItem(defId);
  const rots: Array<0 | 1> = rot === undefined
    ? (def.w === def.h ? [0] : [0, 1])
    : [rot];
  const found: Array<{ x: number; y: number; rot: 0 | 1 }> = [];
  for (const r of rots) {
    const { w, h } = footprint(def, r);
    for (let y = 0; y <= state.rows - h; y++) {
      for (let x = 0; x <= state.cols - w; x++) {
        if (canPlace(state, { uid, defId, x, y, rot: r }).ok) {
          found.push({ x, y, rot: r });
        }
      }
    }
  }
  return found;
}
