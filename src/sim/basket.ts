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
  insulatedBottom: boolean;
  items: BasketItem[];
}

/** 塑料袋/菜篮：出门干区列数。 */
export const BAG_DRY_COLS = [4, 4, 4, 4, 5, 5, 5, 5, 6, 6];
/** 塑料袋/菜篮：出门共用行数。 */
export const BAG_ROWS = [5, 5, 6, 6, 6, 6, 7, 7, 7, 8];
/** 泡沫箱/水桶：出门湿区列数。 */
export const FOAM_WET_COLS = [2, 2, 2, 3, 3, 3, 4, 4, 4, 5];

function clampBagLevel(level: number): number {
  return Math.max(0, Math.min(9, Math.floor(level)));
}

export function bagDryCols(basketLevel: number): number {
  return BAG_DRY_COLS[clampBagLevel(basketLevel)] ?? 4;
}

export function bagRows(basketLevel: number): number {
  return BAG_ROWS[clampBagLevel(basketLevel)] ?? 5;
}

export function foamWetCols(foamLevel: number): number {
  return FOAM_WET_COLS[clampBagLevel(foamLevel)] ?? 2;
}

export function outingDryCells(basketLevel: number): number {
  return bagDryCols(basketLevel) * bagRows(basketLevel);
}

export function outingWetCells(foamLevel: number, basketLevel: number): number {
  return foamWetCols(foamLevel) * bagRows(basketLevel);
}

export function createBasket(basketLevel: number, foamLevel = 0): BasketState {
  const dryCols = bagDryCols(basketLevel);
  const wetCols = foamWetCols(foamLevel);
  const rows = bagRows(basketLevel);
  return {
    cols: wetCols + dryCols,
    rows,
    wetCols,
    insulatedBottom: clampBagLevel(basketLevel) >= 3,
    items: [],
  };
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
    if (occ.has(`${c.x},${c.y}`)) return { ok: false, reason: '这里已经有东西' };
  }

  const inWet = (x: number, y: number): boolean => {
    if (x < state.wetCols) return true;
    if (state.insulatedBottom && y === state.rows - 1) return true;
    return false;
  };

  if (def.zone === 'wet') {
    if (!cells.every((c) => inWet(c.x, c.y))) {
      return { ok: false, reason: '湿货必须放湿区' };
    }
  }

  if (def.live) {
    const onBottom = cells.some((c) => c.x < state.wetCols && c.y === state.rows - 1);
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
  return cells.some((c) => c.x < state.wetCols && !(state.insulatedBottom && c.y === state.rows - 1));
}

export function tryAutoPlace(
  state: BasketState,
  item: Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'>,
): BasketItem | null {
  const def = getItem(item.defId);
  const rots: Array<0 | 1> = def.w === def.h ? [0] : [0, 1];
  for (const rot of rots) {
    const { w, h } = footprint(def, rot);
    for (let y = 0; y <= state.rows - h; y++) {
      for (let x = 0; x <= state.cols - w; x++) {
        const draft = { uid: item.uid, defId: item.defId, x, y, rot };
        if (canPlace(state, draft).ok) {
          return {
            ...item,
            x,
            y,
            rot,
            pinned: false,
            dampened: willDampen(state, def, x, y, rot),
          };
        }
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

/** 空位就放下；压到刚好一件且对方能回到原位，就互换。 */
export function tryRelocate(
  state: BasketState,
  uid: string,
  x: number,
  y: number,
  rot: 0 | 1,
): { ok: true; state: BasketState } | { ok: false; reason: string } {
  const item = state.items.find((it) => it.uid === uid);
  if (!item) return { ok: false, reason: '篮里没有' };
  const draft = { ...item, x, y, rot };
  const others = overlappingOthers(state, draft);
  if (others.length === 0) return place(state, draft);
  if (others.length > 1) return { ok: false, reason: '这里已经有东西' };
  const other = others[0];
  const cleared: BasketState = {
    ...state,
    items: state.items.filter((it) => it.uid !== uid && it.uid !== other.uid),
  };
  const a = place(cleared, draft);
  if (!a.ok) return a;
  const back = place(a.state, { ...other, x: item.x, y: item.y });
  if (!back.ok) return { ok: false, reason: '换不过来，先把挡路的拖出去' };
  return back;
}

export function removeItem(state: BasketState, uid: string): BasketState {
  return { ...state, items: state.items.filter((it) => it.uid !== uid) };
}

export function emptyCellsHint(state: BasketState): Array<{ x: number; y: number }> {
  const occ = occupancyMap(state);
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
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
