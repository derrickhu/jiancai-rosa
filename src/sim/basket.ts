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

export interface BasketState {
  cols: number;
  rows: number;
  wetCols: number;
  wetRows: number;
  dryRows: number;
  insulatedBottom: boolean;
  /** 顶上一行广告解锁，只当次有效，干湿都能放。 */
  flexUnlocked: boolean;
  items: BasketItem[];
}

export type BasketCellKind = 'wet' | 'dry' | 'flex' | 'none';

/** 最上预留的广告通用行。锁着时不占可用格，坐标仍从这一行下面起算，解锁不用挪货。 */
export const BASKET_FLEX_ROWS = 1;

/** 塑料袋/菜篮：出门干区列数。后面升级优先加列。 */
export const BAG_DRY_COLS = [4, 4, 5, 5, 5, 6, 6, 7, 7, 8];
/** 塑料袋/菜篮：出门干区行数。只影响干区，从上往下长。 */
export const BAG_ROWS = [3, 4, 4, 4, 5, 5, 5, 5, 6, 6];
/** 泡沫箱/水桶：出门湿区列数。后面升级优先加列。 */
export const FOAM_WET_COLS = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
/** 泡沫箱/水桶：出门湿区行数。只影响湿区，从上往下长。 */
export const FOAM_WET_ROWS = [3, 4, 4, 4, 4, 5, 5, 5, 5, 6];

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

export function createBasket(basketLevel: number, foamLevel = 0): BasketState {
  const dryCols = bagDryCols(basketLevel);
  const dryRows = bagRows(basketLevel);
  const wetCols = foamWetCols(foamLevel);
  const wetRows = foamWetRows(foamLevel);
  return {
    cols: wetCols + dryCols,
    rows: BASKET_FLEX_ROWS + Math.max(wetRows, dryRows),
    wetCols,
    wetRows,
    dryRows,
    insulatedBottom: clampBagLevel(basketLevel) >= 3,
    flexUnlocked: false,
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
  if (y < BASKET_FLEX_ROWS) return state.flexUnlocked ? 'flex' : 'none';
  const localY = y - BASKET_FLEX_ROWS;
  if (x < state.wetCols && localY < state.wetRows) return 'wet';
  if (x >= state.wetCols && localY < state.dryRows) {
    return state.insulatedBottom && localY === state.dryRows - 1 ? 'wet' : 'dry';
  }
  return 'none';
}

function isFoamWetCell(state: BasketState, x: number, y: number): boolean {
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

/** 影子用：空位绿、一件黄、多件或违规红。 */
export function previewDrop(
  state: BasketState,
  draft: Pick<BasketItem, 'uid' | 'defId' | 'x' | 'y' | 'rot'>,
): DropPreview {
  const others = overlappingOthers(state, draft);
  if (others.length > 1) return 'blocked';
  const ignore = new Set([draft.uid, ...others.map((it) => it.uid)]);
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => !ignore.has(it.uid)),
  };
  if (!canPlace(cleared, draft).ok) return 'blocked';
  return others.length === 1 ? 'swap' : 'empty';
}

export type DropResult =
  | { ok: true; state: BasketState; evicted: BasketItem | null }
  | { ok: false; reason: string };

/**
 * 空位放下；压到刚好一件则交换。
 * 篮内互拖：对方能坐进旧格就对换，否则自动找空位，再不行上托盘。
 * 托盘拖进来：被压到的那件上托盘。
 */
export function tryDrop(state: BasketState, incoming: BasketItem): DropResult {
  const others = overlappingOthers(state, incoming);
  if (others.length > 1) return { ok: false, reason: '压到太多件，换不开' };
  const old = state.items.find((it) => it.uid === incoming.uid) ?? null;
  const evict = others[0] ?? null;
  const ignore = new Set([incoming.uid, evict?.uid].filter((id): id is string => !!id));
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => !ignore.has(it.uid)),
  };
  const landed = place(cleared, incoming);
  if (!landed.ok) return landed;
  if (!evict) return { ok: true, state: landed.state, evicted: null };

  if (old) {
    const swapped = place(landed.state, { ...evict, x: old.x, y: old.y });
    if (swapped.ok) return { ok: true, state: swapped.state, evicted: null };
    const nudged = tryAutoPlace(landed.state, evict);
    if (nudged) {
      const put = place(landed.state, nudged);
      if (put.ok) return { ok: true, state: put.state, evicted: null };
    }
  }
  return { ok: true, state: landed.state, evicted: evict };
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
  if (def.w === def.h) return { ok: true, state, evicted: null };
  const rot: 0 | 1 = item.rot === 0 ? 1 : 0;
  const without = removeItem(state, uid);
  const same = { ...item, rot };
  if (canPlace(without, same).ok) {
    const put = place(without, same);
    return put.ok ? { ok: true, state: put.state, evicted: null } : put;
  }
  for (const { x, y } of sortedOrigins(without, def, rot, { x: item.x, y: item.y })) {
    const draft = { ...item, x, y, rot };
    if (canPlace(without, draft).ok) {
      const put = place(without, draft);
      return put.ok ? { ok: true, state: put.state, evicted: null } : put;
    }
  }
  return { ok: true, state: without, evicted: { ...item, rot } };
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
