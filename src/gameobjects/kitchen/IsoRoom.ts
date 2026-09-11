/**
 * 等距厨房原型。地板和墙用程序画，家具是独立 sprite 按格子摆。
 *
 * 地板/墙就是大片平涂加一条勾缝，出图反而更糊更重，所以这里不走贴图。
 * AI 只负责家具和角色——旧方案里每件家具都要对死那一个正面机位，等距下同一张图
 * 能摆进任何房间任何格子，这是换视角最实际的收益。
 */
import * as PIXI from 'pixi.js';
import {
  footprintAnchor,
  footprintWidth,
  isoDepth,
  isoToScreen,
  roomOrigin,
  roomTiles,
  screenToIso,
  tileQuad,
  WALL_H,
  type Footprint,
  type Pt,
} from '@/sim/iso';
import { gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

const FLOOR = 0xF2E3C9;
const GROUT = 0xE2CEB0;
const WALL_LEFT = 0xFFF4E4;
const WALL_RIGHT = 0xF6E6CF;
const TRIM = 0xC98B54;
const TRIM_DARK = 0xA87142;
const PICK = 0xFF8A3D;

const WALL_TRIM_H = 16;
const FLOOR_EDGE_H = 22;

export interface IsoProp {
  key: string;
  path: string;
  foot: Footprint;
  /** sprite 宽 ÷ 占地菱形宽。带棚的摊位这类比占地宽的物件调大。 */
  fill?: number;
}

/** 样张包的摆法，只为和旧正面视图同机对比，不是最终布局。 */
export const PILOT_PROPS: IsoProp[] = [
  { key: 'fridge', path: 'subpkg_kitchen/iso_fridge.png', foot: { gx: 0, gy: 0, w: 1, h: 1 }, fill: 1.15 },
  { key: 'stove', path: 'subpkg_kitchen/iso_stove.png', foot: { gx: 2, gy: 0, w: 2, h: 1 } },
  { key: 'stall', path: 'subpkg_kitchen/iso_stall.png', foot: { gx: 0, gy: 2, w: 1, h: 2 } },
  { key: 'crate', path: 'subpkg_kitchen/iso_crate.png', foot: { gx: 2, gy: 3, w: 1, h: 1 }, fill: 1.05 },
];

export interface IsoRoomOpts {
  house: number;
  viewW: number;
  viewH: number;
  props?: IsoProp[];
  pick?: { gx: number; gy: number } | null;
  /** 点了哪格。原型里用来验证反投影命中，全量落地后是放置 UI 的入口。 */
  onPickCell?: (gx: number, gy: number) => void;
  /** 家具贴图到位后重画。 */
  onNeedRedraw?: () => void;
}

function poly(g: PIXI.Graphics, pts: Pt[], color: number): void {
  g.beginFill(color);
  g.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
  g.endFill();
}

function drawWall(g: PIXI.Graphics, a: Pt, b: Pt, color: number): void {
  poly(g, [{ x: a.x, y: a.y - WALL_H }, { x: b.x, y: b.y - WALL_H }, b, a], color);
  poly(g, [
    { x: a.x, y: a.y - WALL_H },
    { x: b.x, y: b.y - WALL_H },
    { x: b.x, y: b.y - WALL_H + WALL_TRIM_H },
    { x: a.x, y: a.y - WALL_H + WALL_TRIM_H },
  ], TRIM);
}

export function buildIsoRoom(opts: IsoRoomOpts): PIXI.Container {
  const { house, viewW, viewH } = opts;
  const n = roomTiles(house);
  const origin = roomOrigin(house, viewW, viewH);
  const at = (gx: number, gy: number): Pt => isoToScreen(gx, gy, origin);

  const root = new PIXI.Container();
  root.sortableChildren = true;

  const shell = new PIXI.Graphics();
  shell.zIndex = -1000;
  shell.eventMode = 'none';
  drawWall(shell, at(0, 0), at(0, n), WALL_LEFT);
  drawWall(shell, at(0, 0), at(n, 0), WALL_RIGHT);

  for (let gx = 0; gx < n; gx += 1) {
    for (let gy = 0; gy < n; gy += 1) {
      const q = tileQuad(gx, gy, origin);
      poly(shell, q, FLOOR);
      shell.lineStyle(1, GROUT, 1);
      shell.drawPolygon(q.flatMap((p) => [p.x, p.y]));
      shell.lineStyle(0);
    }
  }

  // 地板前两条边加木沿，做出 diorama 的厚度，也让房间有明确边界
  for (const [a, b] of [[at(n, 0), at(n, n)], [at(n, n), at(0, n)]] as Array<[Pt, Pt]>) {
    poly(shell, [a, b, { x: b.x, y: b.y + FLOOR_EDGE_H }, { x: a.x, y: a.y + FLOOR_EDGE_H }], TRIM_DARK);
  }
  root.addChild(shell);

  if (opts.pick) {
    const hl = new PIXI.Graphics();
    hl.zIndex = -999;
    poly(hl, tileQuad(opts.pick.gx, opts.pick.gy, origin), PICK);
    hl.alpha = 0.35;
    hl.eventMode = 'none';
    root.addChild(hl);
  }

  for (const prop of opts.props ?? PILOT_PROPS) {
    const tex = gameTexture(prop.path);
    if (!isTextureReady(tex)) {
      whenTextureReady(prop.path, () => opts.onNeedRedraw?.());
      continue;
    }
    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5, 1);
    sp.scale.set((footprintWidth(prop.foot) * (prop.fill ?? 1)) / tex.width);
    const a = footprintAnchor(prop.foot, origin);
    sp.position.set(a.x, a.y);
    sp.zIndex = isoDepth(prop.foot.gx + prop.foot.w, prop.foot.gy + prop.foot.h);
    sp.eventMode = 'none';
    root.addChild(sp);
  }

  if (opts.onPickCell) {
    // 透明捕获层要 alpha 0.001 加显式 hitArea，alpha 0 在微信里收不到点击
    const corners = [at(0, 0), at(n, 0), at(n, n), at(0, n)];
    const floor = new PIXI.Graphics();
    floor.zIndex = 9999;
    poly(floor, corners, FLOOR);
    floor.alpha = 0.001;
    floor.hitArea = new PIXI.Polygon(corners.flatMap((p) => [p.x, p.y]));
    floor.eventMode = 'static';
    floor.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      const p = e.getLocalPosition(root);
      const c = screenToIso(p.x, p.y, origin);
      const gx = Math.floor(c.gx);
      const gy = Math.floor(c.gy);
      if (gx < 0 || gy < 0 || gx >= n || gy >= n) return;
      opts.onPickCell?.(gx, gy);
    });
    root.addChild(floor);
  }

  return root;
}
