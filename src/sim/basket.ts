import { FURN_MAX_LEVEL } from './kitchenLayout';
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

/** 塑料袋/菜篮：出门干区列数。前 10 级每级至少加一列或一行，后五级放缓。 */
export const BAG_DRY_COLS = [4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10];
/** 塑料袋/菜篮：出门干区行数。只影响干区，从上往下长。 */
export const BAG_ROWS = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9];
/** 泡沫箱/水桶：出门湿区列数。前 10 级每级至少加一列或一行，后五级放缓。 */
export const FOAM_WET_COLS = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7];
/** 泡沫箱/水桶：出门湿区行数。只影响湿区，从上往下长。 */
export const FOAM_WET_ROWS = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10];

function clampBagLevel(level: number): number {
  return Math.max(0, Math.min(FURN_MAX_LEVEL, Math.floor(level)));
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
      return { ok: false, reason: '湿货需放入左侧湿货区' };
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

export interface BasketZoneStats {
  wetUsed: number;
  wetTotal: number;
  dryUsed: number;
  dryTotal: number;
  flexUsed: number;
  flexTotal: number;
}

export function basketZoneStats(state: BasketState): BasketZoneStats {
  const occ = occupancyMap(state);
  let wetUsed = 0;
  let wetTotal = 0;
  let dryUsed = 0;
  let dryTotal = 0;
  let flexUsed = 0;
  let flexTotal = 0;
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const kind = basketCellKind(state, x, y);
      if (kind === 'none') continue;
      const used = occ.has(`${x},${y}`) ? 1 : 0;
      if (kind === 'wet') {
        wetTotal += 1;
        wetUsed += used;
      } else if (kind === 'dry') {
        dryTotal += 1;
        dryUsed += used;
      } else if (kind === 'flex') {
        flexTotal += 1;
        flexUsed += used;
      }
    }
  }
  return { wetUsed, wetTotal, dryUsed, dryTotal, flexUsed, flexTotal };
}

function candidateBias(state: BasketState, def: ItemDef, x: number, y: number, rot: 0 | 1): number {
  const { w, h } = footprint(def, rot);
  let bias = 0;
  if (def.zone === 'wet') {
    const wetTop = BASKET_FLEX_ROWS;
    const wetBottom = BASKET_FLEX_ROWS + state.wetRows - 1;
    // 窄列水桶里避免 2×1 横条卡在中间行把水桶拦腰截断
    if (w >= state.wetCols && h === 1 && y > wetTop && y < wetBottom) {
      bias += 6;
    }
    bias += y * 0.35 + x * 0.12;
  } else {
    bias += y * 0.3 + Math.max(0, x - state.wetCols) * 0.12;
  }
  return bias;
}

/** 干货先扫干区，湿货先扫湿区；广告通用行往后排。near 用来旋转后就近挪一格。 */
function sortedOrigins(
  state: BasketState,
  def: ItemDef,
  rot: 0 | 1,
  near?: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const { w, h } = footprint(def, rot);
  const out: Array<{ x: number; y: number; score: number; dist: number; bias: number }> = [];
  for (let y = 0; y <= state.rows - h; y++) {
    for (let x = 0; x <= state.cols - w; x++) {
      const cells = occupiedCells({ defId: def.id, x, y, rot });
      if (cells.some((c) => basketCellKind(state, c.x, c.y) === 'none')) continue;
      const wet = cells.filter((c) => isWetCell(state, c.x, c.y)).length;
      const flex = cells.filter((c) => basketCellKind(state, c.x, c.y) === 'flex').length;
      let score = wet * 20 + flex * 3;
      if (def.zone === 'wet') {
        if (!cells.every((c) => acceptsWet(state, c.x, c.y))) continue;
        score = flex * 3;
      }
      const dist = near ? Math.abs(x - near.x) + Math.abs(y - near.y) : 0;
      const bias = near ? 0 : candidateBias(state, def, x, y, rot);
      out.push({ x, y, score, dist, bias });
    }
  }
  out.sort((a, b) => a.score - b.score || a.dist - b.dist || a.bias - b.bias || a.y - b.y || a.x - b.x);
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
  const merged: Array<{ x: number; y: number; rot: 0 | 1; score: number; bias: number }> = [];
  for (const rot of rots) {
    const { w, h } = footprint(def, rot);
    // 窄列湿区长条货轻微偏好竖放（1×2），减少横条割裂列空间
    const rotBias = def.zone === 'wet' && state.wetCols <= 2 && w > h ? 0.8 : 0;
    for (let y = 0; y <= state.rows - h; y++) {
      for (let x = 0; x <= state.cols - w; x++) {
        const cells = occupiedCells({ defId: def.id, x, y, rot });
        if (cells.some((c) => basketCellKind(state, c.x, c.y) === 'none')) continue;
        const wet = cells.filter((c) => isWetCell(state, c.x, c.y)).length;
        const flex = cells.filter((c) => basketCellKind(state, c.x, c.y) === 'flex').length;
        let score = wet * 20 + flex * 3;
        if (def.zone === 'wet') {
          if (!cells.every((c) => acceptsWet(state, c.x, c.y))) continue;
          score = flex * 3;
        }
        const bias = candidateBias(state, def, x, y, rot) + rotBias;
        merged.push({ x, y, rot, score, bias });
      }
    }
  }
  merged.sort((a, b) => a.score - b.score || a.bias - b.bias || a.y - b.y || a.x - b.x || a.rot - b.rot);
  for (const cand of merged) {
    if (canPlace(state, { uid: item.uid, defId: item.defId, x: cand.x, y: cand.y, rot: cand.rot }).ok) {
      return sealItem(state, { ...item, x: cand.x, y: cand.y, rot: cand.rot });
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

export function isBasketFull(state: BasketState): boolean {
  return emptyCellsHint(state).length === 0;
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

/** 拖放预览红框时，给出该落点被拒的准确原因。 */
export function diagnoseCellBlock(
  state: BasketState,
  draft: Pick<BasketItem, 'uid' | 'defId' | 'x' | 'y' | 'rot'>,
): string | null {
  const others = overlappingOthers(state, draft);
  const ignore = new Set([draft.uid, ...others.map((it) => it.uid)]);
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => !ignore.has(it.uid)),
  };
  const res = canPlace(cleared, draft);
  return res.ok ? null : res.reason;
}

type DraftItem = Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'>;

interface PackCandidate {
  x: number;
  y: number;
  rot: 0 | 1;
  cells: number[];
  score: number;
}

interface PackEntry {
  base: DraftItem;
  def: ItemDef;
  allowDampen: boolean;
  groupKey: string;
  candidates: PackCandidate[];
  origPos?: { x: number; y: number; rot: 0 | 1 };
}

function buildPackCandidates(
  state: BasketState,
  def: ItemDef,
  allowDampen: boolean,
  fixedGrid: Int16Array,
  origPos?: { x: number; y: number; rot: 0 | 1 },
): PackCandidate[] {
  const cols = state.cols;
  const rows = state.rows;
  const rots: Array<0 | 1> = def.w === def.h ? [0] : [0, 1];
  const out: PackCandidate[] = [];

  for (const rot of rots) {
    const { w, h } = footprint(def, rot);
    const rotBias = def.zone === 'wet' && state.wetCols <= 2 && w > h ? 0.6 : 0;
    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const rawCells = occupiedCells({ defId: def.id, x, y, rot });
        let invalid = false;
        let wetCount = 0;
        let flexCount = 0;
        for (const c of rawCells) {
          const kind = basketCellKind(state, c.x, c.y);
          if (kind === 'none') {
            invalid = true;
            break;
          }
          if (fixedGrid[c.y * cols + c.x] !== -1) {
            invalid = true;
            break;
          }
          if (def.zone === 'wet' && !acceptsWet(state, c.x, c.y)) {
            invalid = true;
            break;
          }
          if (def.zone === 'dry' && !allowDampen && isFoamWetCell(state, c.x, c.y)) {
            invalid = true;
            break;
          }
          if (kind === 'wet') wetCount += 1;
          else if (kind === 'flex') flexCount += 1;
        }
        if (invalid) continue;

        const baseScore = def.zone === 'wet'
          ? flexCount * 4
          : wetCount * 24 + flexCount * 4;
        const stayBonus = origPos && origPos.x === x && origPos.y === y && origPos.rot === rot ? -0.15 : 0;
        const score = baseScore + candidateBias(state, def, x, y, rot) + rotBias + stayBonus;
        out.push({
          x,
          y,
          rot,
          cells: rawCells.map((c) => c.y * cols + c.x),
          score,
        });
      }
    }
  }

  out.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x || a.rot - b.rot);
  return out;
}

function solvePack(
  state: BasketState,
  fixed: BasketItem[],
  specs: Array<{ base: DraftItem; allowDampen: boolean; origPos?: { x: number; y: number; rot: 0 | 1 } }>,
  budget = 3600,
): BasketItem[] | null {
  if (specs.length === 0) return fixed.slice();
  const cols = state.cols;
  const rows = state.rows;
  const totalGrid = cols * rows;
  const fixedGrid = new Int16Array(totalGrid).fill(-1);

  let freeValidCells = 0;
  let freeWetAcceptCells = 0;
  for (let i = 0; i < fixed.length; i++) {
    for (const c of occupiedCells(fixed[i])) {
      fixedGrid[c.y * cols + c.x] = i;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const kind = basketCellKind(state, x, y);
      if (kind === 'none' || fixedGrid[y * cols + x] !== -1) continue;
      freeValidCells += 1;
      if (acceptsWet(state, x, y)) freeWetAcceptCells += 1;
    }
  }

  let needTotalCells = 0;
  let needWetCells = 0;
  for (const sp of specs) {
    const def = getItem(sp.base.defId);
    const area = def.w * def.h;
    needTotalCells += area;
    if (def.zone === 'wet') needWetCells += area;
  }
  if (needTotalCells > freeValidCells || needWetCells > freeWetAcceptCells) return null;

  const entries: PackEntry[] = [];
  for (const sp of specs) {
    const def = getItem(sp.base.defId);
    // 同一分组键用于全等物品对称剪枝（忽略 origPos 微调以保证候选序完全一致）
    const groupKey = `${def.id}|${sp.allowDampen ? 1 : 0}`;
    const candidates = buildPackCandidates(state, def, sp.allowDampen, fixedGrid);
    if (candidates.length === 0) return null;
    entries.push({
      base: sp.base,
      def,
      allowDampen: sp.allowDampen,
      groupKey,
      candidates,
      origPos: sp.origPos,
    });
  }

  // 最受限优先（MRV + 大件优先 + 同组相邻以便组合剪枝）
  entries.sort((a, b) => {
    const areaDiff = b.def.w * b.def.h - a.def.w * a.def.h;
    if (areaDiff !== 0) return areaDiff;
    const candDiff = a.candidates.length - b.candidates.length;
    if (candDiff !== 0) return candDiff;
    if (a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
    return 0;
  });

  const dynGrid = new Int16Array(totalGrid).fill(-1);
  const chosenIdx = new Int32Array(entries.length).fill(-1);
  let steps = 0;

  const dfs = (depth: number): boolean => {
    if (depth >= entries.length) return true;
    if (steps >= budget) return false;
    const entry = entries[depth];
    const cands = entry.candidates;
    const samePrev = depth > 0 && entries[depth - 1].groupKey === entry.groupKey;
    const startK = samePrev ? chosenIdx[depth - 1] + 1 : 0;

    for (let k = startK; k < cands.length; k++) {
      steps += 1;
      if (steps > budget) return false;
      const cand = cands[k];

      let blocked = false;
      for (let ci = 0; ci < cand.cells.length; ci++) {
        if (dynGrid[cand.cells[ci]] !== -1) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (let ci = 0; ci < cand.cells.length; ci++) {
        dynGrid[cand.cells[ci]] = depth;
      }
      chosenIdx[depth] = k;

      if (dfs(depth + 1)) return true;

      for (let ci = 0; ci < cand.cells.length; ci++) {
        dynGrid[cand.cells[ci]] = -1;
      }
      chosenIdx[depth] = -1;
    }
    return false;
  };

  if (!dfs(0)) return null;

  const result: BasketItem[] = fixed.slice();
  let verifyState: BasketState = { ...state, items: fixed.slice() };
  for (let i = 0; i < entries.length; i++) {
    const cand = entries[i].candidates[chosenIdx[i]];
    const sealed = sealItem(state, {
      ...entries[i].base,
      x: cand.x,
      y: cand.y,
      rot: cand.rot,
    });
    if (!canPlace(verifyState, sealed).ok) return null;
    verifyState = { ...verifyState, items: [...verifyState.items, sealed] };
    result.push(sealed);
  }
  return result;
}

function stripPos(it: BasketItem): DraftItem {
  return {
    uid: it.uid,
    defId: it.defId,
    quality: it.quality,
    inspected: it.inspected,
    freshness: it.freshness,
  };
}

/**
 * 自动旋转与紧凑腾挪入篮：
 * 当常规 tryAutoPlace 因空隙碎片失败、但总格数足够时，
 * 对篮内未锁定的物品按干湿分区与长宽尺寸做无损旋转与重排。
 */
export function tryAutoPackBasket(
  state: BasketState,
  draft: DraftItem,
): { state: BasketState; placed: BasketItem } | null {
  const direct = tryAutoPlace(state, draft);
  if (direct) {
    return {
      state: { ...state, items: [...state.items, direct] },
      placed: direct,
    };
  }

  const draftDef = getItem(draft.defId);
  // 若空篮都放不下（如 1×4 带鱼进 2×3 初始水桶），直接跳过搜索
  if (validPlacements({ ...state, items: [] }, draft.uid, draft.defId).length === 0) {
    return null;
  }

  const pinned = state.items.filter((it) => it.pinned);
  const unpinned = state.items.filter((it) => !it.pinned);

  // 阶段 A：若新物品是湿货，先仅重排湿区/通用格物品，极速响应
  if (draftDef.zone === 'wet') {
    const pureDryFixed: BasketItem[] = [];
    const wetMovable: BasketItem[] = [];
    for (const it of unpinned) {
      const d = getItem(it.defId);
      const onlyDry = d.zone === 'dry'
        && !it.dampened
        && occupiedCells(it).every((c) => basketCellKind(state, c.x, c.y) === 'dry');
      if (onlyDry) pureDryFixed.push(it);
      else wetMovable.push(it);
    }
    const packedWet = solvePack(
      state,
      [...pinned, ...pureDryFixed],
      [
        ...wetMovable.map((it) => ({
          base: stripPos(it),
          allowDampen: it.dampened,
          origPos: { x: it.x, y: it.y, rot: it.rot },
        })),
        { base: draft, allowDampen: false },
      ],
      1800,
    );
    if (packedWet) {
      const placed = packedWet.find((it) => it.uid === draft.uid);
      if (placed) return { state: { ...state, items: packedWet }, placed };
    }
  }

  // 阶段 B：全篮按干湿分区与尺寸协同重排（顺带把借占湿区/通用格的干货挪回干区）
  const baseSpecs = unpinned.map((it) => ({
    base: stripPos(it),
    allowDampen: it.dampened,
    origPos: { x: it.x, y: it.y, rot: it.rot },
  }));
  const packedAll = solvePack(
    state,
    pinned,
    [...baseSpecs, { base: draft, allowDampen: false }],
    4000,
  );
  if (packedAll) {
    const placed = packedAll.find((it) => it.uid === draft.uid);
    if (placed) return { state: { ...state, items: packedAll }, placed };
  }

  // 阶段 C：干货在干区全满时，允许借用空余湿格拼摆
  if (draftDef.zone === 'dry') {
    const packedSpill = solvePack(
      state,
      pinned,
      [...baseSpecs, { base: draft, allowDampen: true }],
      2200,
    );
    if (packedSpill) {
      const placed = packedSpill.find((it) => it.uid === draft.uid);
      if (placed) return { state: { ...state, items: packedSpill }, placed };
    }
  }

  return null;
}

/**
 * 菜篮面板「一键码齐」：先将篮内物品按最优紧凑度重排（顺带把借放湿区的干货归回干区），
 * 再尽可能把暂存木案上的待装食材逐件码入菜篮。
 */
export function repackBasketWithStaging<T extends DraftItem>(
  state: BasketState,
  staging: readonly T[] = [],
  priorityUid?: string | null,
): {
  state: BasketState;
  placedStaging: BasketItem[];
  remainingStaging: T[];
  movedCount: number;
} {
  const prevByUid = new Map(state.items.map((it) => [it.uid, it]));
  let working = state;

  // 1. 先紧凑归置篮内现有物品（优先全归干区；若干区容量不足再保留借放湿格）
  const pinned = working.items.filter((it) => it.pinned);
  const unpinned = working.items.filter((it) => !it.pinned);
  if (unpinned.length > 0) {
    const dryClean = solvePack(
      working,
      pinned,
      unpinned.map((it) => ({
        base: stripPos(it),
        allowDampen: false,
        origPos: { x: it.x, y: it.y, rot: it.rot },
      })),
      3200,
    );
    if (dryClean) {
      working = { ...working, items: dryClean };
    } else {
      const keepDamp = solvePack(
        working,
        pinned,
        unpinned.map((it) => ({
          base: stripPos(it),
          allowDampen: it.dampened,
          origPos: { x: it.x, y: it.y, rot: it.rot },
        })),
        3200,
      );
      if (keepDamp) working = { ...working, items: keepDamp };
    }
  }

  // 2. 将暂存食材按「当前选中优先 → 湿货优先 → 大件优先」依次尝试腾挪入篮
  const orderedStaging = staging.slice().sort((a, b) => {
    if (priorityUid) {
      if (a.uid === priorityUid && b.uid !== priorityUid) return -1;
      if (b.uid === priorityUid && a.uid !== priorityUid) return 1;
    }
    const da = getItem(a.defId);
    const db = getItem(b.defId);
    if (da.zone !== db.zone) return da.zone === 'wet' ? -1 : 1;
    return db.w * db.h - da.w * da.h;
  });

  const placedMap = new Map<string, BasketItem>();
  for (const item of orderedStaging) {
    const res = tryAutoPackBasket(working, item);
    if (res) {
      working = res.state;
      const latest = working.items.find((it) => it.uid === item.uid) ?? res.placed;
      placedMap.set(item.uid, latest);
    }
  }

  // 更新所有从暂存装入物品在最终棋盘上的坐标
  const placedStaging: BasketItem[] = [];
  const remainingStaging: T[] = [];
  for (const orig of staging) {
    if (placedMap.has(orig.uid)) {
      const finalItem = working.items.find((it) => it.uid === orig.uid) ?? placedMap.get(orig.uid)!;
      placedStaging.push(finalItem);
    } else {
      remainingStaging.push(orig);
    }
  }

  let movedCount = placedStaging.length;
  for (const it of working.items) {
    const old = prevByUid.get(it.uid);
    if (old && (old.x !== it.x || old.y !== it.y || old.rot !== it.rot)) {
      movedCount += 1;
    }
  }

  return { state: working, placedStaging, remainingStaging, movedCount };
}

/**
 * 精准诊断某食材为何放不进当前菜篮，返回直观的干湿分区与尺寸提示文案。
 */
export function diagnoseCannotPlace(state: BasketState, defId: string): string {
  const def = getItem(defId);
  const needCells = def.w * def.h;
  const shape = `${def.w}×${def.h}`;
  const stats = basketZoneStats(state);
  const freeWet = (stats.wetTotal - stats.wetUsed) + (stats.flexTotal - stats.flexUsed);
  const freeDry = (stats.dryTotal - stats.dryUsed) + (stats.flexTotal - stats.flexUsed);
  const freeAll = (stats.wetTotal - stats.wetUsed) + (stats.dryTotal - stats.dryUsed) + (stats.flexTotal - stats.flexUsed);

  // 1. 连空篮都放不下的大尺寸货（如初始 2×3 水桶遇到 1×4 带鱼/河鳗）
  if (validPlacements({ ...state, items: [] }, '__diag__', defId).length === 0) {
    const withFlex = unlockBasketFlex(state);
    if (!state.flexUnlocked && validPlacements({ ...withFlex, items: [] }, '__diag__', defId).length > 0) {
      return `${def.name}占 ${shape} 格，当前水桶高度不够（点菜篮顶排添一层竹屉即可装下）`;
    }
    return def.zone === 'wet'
      ? `${def.name}占 ${shape} 格，当前水桶尺寸放不下（回厨房升级泡沫箱可扩容）`
      : `${def.name}占 ${shape} 格，当前菜篮尺寸放不下（回厨房升级菜篮可扩容）`;
  }

  // 2. 湿货专项诊断（湿货需放入左侧湿货区或顶排通用格）
  if (def.zone === 'wet') {
    let dryInWetCells = 0;
    for (const it of state.items) {
      if (getItem(it.defId).zone === 'dry') {
        for (const c of occupiedCells(it)) {
          if (acceptsWet(state, c.x, c.y)) dryInWetCells += 1;
        }
      }
    }
    if (dryInWetCells > 0 && freeWet + dryInWetCells >= needCells) {
      return `有干货占了 ${dryInWetCells} 格湿区，打开菜篮把干货挪回右侧干区即可装下${def.name}`;
    }

    if (freeWet === 0) {
      if (freeDry > 0) {
        return !state.flexUnlocked
          ? '左侧湿货区已满（湿货需放左侧湿货区，可在顶排添一层通用竹屉）'
          : '左侧湿货区已满（湿货不能放干货区，可在菜篮丢弃或挪出小件腾位）';
      }
      return !state.flexUnlocked
        ? '菜篮已装满，可在顶排添一层通用竹屉或丢掉小件腾位'
        : '菜篮已彻底装满，先丢掉小件腾出空位吧';
    }

    if (freeWet < needCells) {
      return !state.flexUnlocked
        ? `湿货区仅剩 ${freeWet} 格，放不下 ${shape} 的${def.name}（可开顶排通用竹屉或腾位）`
        : `湿货区仅剩 ${freeWet} 格，放不下 ${shape} 的${def.name}`;
    }

    // 剩余湿格数够，但形状受限（如 2×4 水桶里 1×4 带鱼占满一列，剩 1×4 放不下 2×2 鱼蟹）
    return !state.flexUnlocked
      ? `湿货区剩 ${freeWet} 格但列宽被占，摆不下 ${shape} 的${def.name}（可开顶排通用格或换位）`
      : `湿货区剩 ${freeWet} 格但空隙形状摆不下 ${shape} 的${def.name}，可在菜篮调整腾位`;
  }

  // 3. 干货专项诊断
  if (freeAll === 0) {
    return !state.flexUnlocked
      ? '菜篮已装满，可在菜篮顶排看视频添一层通用竹屉'
      : '菜篮已装满，先丢掉一件小菜腾位吧';
  }

  if (freeAll < needCells) {
    return !state.flexUnlocked
      ? `菜篮仅剩 ${freeAll} 格，放不下 ${shape} 的${def.name}（可开顶排通用竹屉扩容）`
      : `菜篮仅剩 ${freeAll} 格，放不下 ${shape} 的${def.name}`;
  }

  return !state.flexUnlocked
    ? `剩余空隙摆不下 ${shape} 的${def.name}（可在菜篮调整位置，或开顶排通用竹屉）`
    : `剩余空隙摆不下 ${shape} 的${def.name}，可在菜篮调整或丢掉小件腾位`;
}
