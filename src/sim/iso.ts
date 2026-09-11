/**
 * 2:1 等距（dimetric）投影。规格与出图要求见 docs/等距场景规格.md。
 *
 * 格子坐标 (0,0) 是菱形最上角，gx 往右下、gy 往左下。屏幕坐标是逻辑像素。
 */

export const TILE_W = 120;
export const TILE_H = 60;
/** 后两面墙从地板往上拉的高度。按 4 个竖直单位取，冰箱这类高家具靠墙不会顶出去。 */
export const WALL_H = 240;

/** 三档房屋的边长（格）。升级 = 房间真的变大。 */
export const ROOM_TILES = [4, 5, 6];

export interface Pt { x: number; y: number }
export interface Cell { gx: number; gy: number }

/** 占地：左上角格子 + 占几格。 */
export interface Footprint { gx: number; gy: number; w: number; h: number }

export function roomTiles(house: number): number {
  return ROOM_TILES[Math.max(0, Math.min(ROOM_TILES.length - 1, house))];
}

export function isoToScreen(gx: number, gy: number, origin: Pt): Pt {
  return {
    x: origin.x + (gx - gy) * (TILE_W / 2),
    y: origin.y + (gx + gy) * (TILE_H / 2),
  };
}

/** 屏幕点反推格子，用于点击命中。返回的是浮点格号，取 floor 得到所在格。 */
export function screenToIso(sx: number, sy: number, origin: Pt): Cell {
  const dx = (sx - origin.x) / (TILE_W / 2);
  const dy = (sy - origin.y) / (TILE_H / 2);
  return { gx: (dx + dy) / 2, gy: (dy - dx) / 2 };
}

/** 深度排序键：越靠近观众越大。家具和角色同层用它做 zIndex。 */
export function isoDepth(gx: number, gy: number): number {
  return gx + gy;
}

export function inRoom(house: number, gx: number, gy: number): boolean {
  const n = roomTiles(house);
  return gx >= 0 && gy >= 0 && gx < n && gy < n;
}

/**
 * 把「地板菱形 + 上方墙体」这一整块摆进 viewW × viewH，水平居中、垂直居中。
 * 返回的是格子原点，也就是菱形最上角。
 */
export function roomOrigin(house: number, viewW: number, viewH: number): Pt {
  const n = roomTiles(house);
  return { x: viewW / 2, y: (viewH - (n * TILE_H + WALL_H)) / 2 + WALL_H };
}

/** 占地菱形的屏幕宽度。家具 sprite 按它定缩放。 */
export function footprintWidth(f: Footprint): number {
  return ((f.w + f.h) * TILE_W) / 2;
}

/** 占地菱形的最下角，家具 sprite 的锚点（anchor 0.5, 1）落在这里。 */
export function footprintAnchor(f: Footprint, origin: Pt): Pt {
  return isoToScreen(f.gx + f.w, f.gy + f.h, origin);
}

/** 一格地砖的四个角，按顺时针。 */
export function tileQuad(gx: number, gy: number, origin: Pt): Pt[] {
  return [
    isoToScreen(gx, gy, origin),
    isoToScreen(gx + 1, gy, origin),
    isoToScreen(gx + 1, gy + 1, origin),
    isoToScreen(gx, gy + 1, origin),
  ];
}
