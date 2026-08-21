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

export function createBasket(level: number): BasketState {
  const lv = Math.max(0, Math.min(9, Math.floor(level)));
  const table: Array<{ cols: number; rows: number; wetCols: number; insulatedBottom: boolean }> = [
    { cols: 6, rows: 5, wetCols: 2, insulatedBottom: false },
    { cols: 6, rows: 5, wetCols: 2, insulatedBottom: false },
    { cols: 6, rows: 6, wetCols: 2, insulatedBottom: false },
    { cols: 6, rows: 6, wetCols: 2, insulatedBottom: true },
    { cols: 7, rows: 6, wetCols: 2, insulatedBottom: true },
    { cols: 7, rows: 6, wetCols: 3, insulatedBottom: true },
    { cols: 7, rows: 7, wetCols: 3, insulatedBottom: true },
    { cols: 8, rows: 7, wetCols: 3, insulatedBottom: true },
    { cols: 8, rows: 7, wetCols: 3, insulatedBottom: true },
    { cols: 8, rows: 8, wetCols: 3, insulatedBottom: true },
  ];
  return { ...table[lv], items: [] };
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
