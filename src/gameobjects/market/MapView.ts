import * as PIXI from 'pixi.js';
import { LANES, cardHint, cardName, isMysteryCard, type CardKind, type MarketId, type StallId } from '@/sim';
import type { RouteOption } from '@/managers/RunManager';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { HUD_ICON, fitTextWidth, makeText } from '@/utils/ui';

export const CARD_FRAME = 'subpkg_images/ui_card_frame.png';
export const CARD_ATLAS = 'subpkg_images/market_cards.jpg';

/** 卡框原图 264×392，中间已抠成透明窗口。缩略图垫在框底下正好露满窗口。 */
const FRAME_RATIO = 392 / 264;
const WIN = { x: 0.0727, y: 0.2333, w: 0.8545, h: 0.7034 };

const ATLAS_COLS = 4;
const ATLAS_ROWS = 3;

const INK = 0x2A2018;
const RED_INK = 0xB8361F;
const GREEN_INK = 0x2F6E2A;

/** 图集格位：叶菜/根茎/蛋豆/水产/岔路/死胡同/白捡/收费摊/空摊/人情/深处/背面。 */
const STALL_SLOT: Record<StallId, number> = { leaf: 0, root: 1, egg: 2, fish: 3, meat: 2 };
const KIND_SLOT: Record<CardKind, number> = {
  stall: 0,
  paystall: 7,
  freebie: 6,
  fork: 4,
  deadend: 5,
  empty: 8,
  favor: 9,
  deep: 10,
  recipe: 10,
  talk: 9,
  gather: 6,
  branch: 4,
  gate: 10,
};
const BACK_SLOT = 11;

const _slots = new Map<string, PIXI.Texture>();
const _mapWatched = new Set<string>();
let _latestMapReady: (() => void) | undefined;

function watchMapTex(path: string, onReady?: () => void): void {
  if (!onReady || !path) return;
  _latestMapReady = onReady;
  const tex = gameTexture(path);
  if (isTextureReady(tex)) return;
  if (_mapWatched.has(path)) return;
  _mapWatched.add(path);
  whenTextureReady(path, () => {
    _mapWatched.delete(path);
    _latestMapReady?.();
  });
}

function slotTexture(atlas: string, slot: number): PIXI.Texture | null {
  const tex = gameTexture(atlas);
  if (!isTextureReady(tex)) return null;
  const key = `${atlas}#${slot}`;
  const hit = _slots.get(key);
  if (hit) {
    if (hit.valid && hit.baseTexture && !hit.baseTexture.destroyed && hit.baseTexture === tex.baseTexture) {
      return hit;
    }
    _slots.delete(key);
    try { hit.destroy(false); } catch { /* ignore */ }
  }
  const cw = tex.width / ATLAS_COLS;
  const ch = tex.height / ATLAS_ROWS;
  const col = slot % ATLAS_COLS;
  const row = Math.floor(slot / ATLAS_COLS);
  const frame = new PIXI.Rectangle(col * cw + 1, row * ch + 1, cw - 2, ch - 2);
  const sub = new PIXI.Texture(tex.baseTexture, frame);
  _slots.set(key, sub);
  return sub;
}

/** 清理已卸载图集对应的子纹理切片句柄，避免残留失效 Texture 包装对象。 */
export function pruneMapSlotCache(clearAll = false): void {
  for (const [key, sub] of [..._slots.entries()]) {
    if (clearAll || !sub.baseTexture || sub.baseTexture.destroyed || !sub.valid) {
      _slots.delete(key);
      try { sub.destroy(false); } catch { /* ignore */ }
    }
  }
}

/** 收费摊也画自己摊型的图：贵不贵看卡面图上方那组数字+金币。 */
export function slotForNode(node: { kind: CardKind; stall?: StallId }, revealed: boolean): number {
  if (!revealed && isMysteryCard(node.kind)) return BACK_SLOT;
  if (node.stall) return STALL_SLOT[node.stall];
  return KIND_SLOT[node.kind];
}

function isRummageOption(opt: RouteOption): boolean {
  const node = opt.node;
  return node.kind === 'stall' || node.kind === 'paystall' || node.encounter?.type === 'rummage';
}

function feeBroke(opt: RouteOption): boolean {
  return opt.fee > 0 && !!opt.blocked && opt.blocked.includes('金币');
}

function canChallengeSteelyard(opt: RouteOption): boolean {
  return isRummageOption(opt) && opt.fee > 0 && !opt.steelyardDone;
}

/** 卡面下沿宣纸签：只留件数或进不去的简明理由。 */
function infoLine(opt: RouteOption): string {
  if (!opt.revealed) return cardHint(opt.node, false);
  if (isRummageOption(opt)) {
    const stock = `剩 ${opt.left} 件`;
    if (opt.waived) return `免单 · ${stock}`;
    if (opt.fee > 0 && !opt.steelyardDone) return `可称重 · ${stock}`;
    return opt.fee > 0 ? stock : `免费 · ${stock}`;
  }
  return cardHint(opt.node, true);
}

/** 卡面牛皮宣纸价签（铜钉固定，钱不够改朱红墨字）。原点在左中。 */
function makeFeeMark(fee: number, broke: boolean, size: number, onReady?: () => void): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const fSize = Math.max(20, size);
  const num = makeText('number', String(fee), broke ? RED_INK : INK, {
    size: fSize,
    stroke: 0xFFFBF0,
    strokeWidth: 3,
  });
  num.anchor.set(0, 0.5);
  const iconSize = Math.round(fSize * 1.02);
  watchMapTex(HUD_ICON.coin, onReady);
  const coin = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
  const hasCoin = isTextureReady(coin.texture);
  if (hasCoin) fitSpriteInBox(coin, iconSize, iconSize);
  coin.anchor.set(0, 0.5);
  coin.eventMode = 'none';
  const gap = 4;
  const padX = 12;
  const padY = 5;
  const inner = (hasCoin ? iconSize + gap : 0) + num.width;
  const bw = inner + padX * 2;
  const bh = Math.max(iconSize, num.height) + padY * 2;

  const bg = new PIXI.Graphics();
  bg.beginFill(0x160E08, 0.22);
  bg.drawRoundedRect(0, -bh / 2 + 2.5, bw, bh, 8);
  bg.endFill();
  bg.lineStyle(2.2, broke ? RED_INK : INK, 1);
  bg.beginFill(broke ? 0xFCE8E2 : 0xFAF0DA, 0.96);
  bg.drawRoundedRect(0, -bh / 2, bw, bh, 8);
  bg.endFill();

  let x = padX;
  if (hasCoin) {
    coin.position.set(x, 0);
    x += iconSize + gap;
  }
  num.position.set(x, 0);
  root.addChild(bg);
  if (hasCoin) root.addChild(coin);
  root.addChild(num);
  return root;
}

/** 人情免单宣纸签：划掉原价，挂松绿「免单」。 */
function makeWaivedMark(fee: number, size: number, onReady?: () => void): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const fSize = Math.max(20, size);
  const old = makeText('number', String(fee), 0x8A6A40, { size: fSize });
  old.anchor.set(0, 0.5);
  const strike = new PIXI.Graphics();
  strike.lineStyle(2.4, RED_INK, 0.95);
  strike.moveTo(-2, 0);
  strike.lineTo(old.width + 2, 0);
  strike.eventMode = 'none';
  const oldWrap = new PIXI.Container();
  oldWrap.addChild(old, strike);

  const free = makeText('caption', '免单', GREEN_INK, {
    size: fSize,
    fontWeight: '700',
  });
  free.anchor.set(0, 0.5);

  const iconSize = Math.round(fSize * 0.9);
  watchMapTex(HUD_ICON.coin, onReady);
  const coin = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
  const hasCoin = isTextureReady(coin.texture);
  if (hasCoin) fitSpriteInBox(coin, iconSize, iconSize);
  coin.anchor.set(0, 0.5);
  coin.eventMode = 'none';
  coin.alpha = 0.55;

  const gap = 5;
  const padX = 10;
  const padY = 5;
  const inner = (hasCoin ? iconSize + gap : 0) + old.width + gap + free.width;
  const bw = inner + padX * 2;
  const bh = Math.max(iconSize, free.height) + padY * 2;

  const bg = new PIXI.Graphics();
  bg.lineStyle(2.2, GREEN_INK, 1);
  bg.beginFill(0xF1F8EC, 0.96);
  bg.drawRoundedRect(0, -bh / 2, bw, bh, 8);
  bg.endFill();

  let x = padX;
  if (hasCoin) {
    coin.position.set(x, 0);
    x += iconSize + gap;
  }
  oldWrap.position.set(x, 0);
  x += old.width + gap;
  free.position.set(x, 0);
  root.addChild(bg);
  if (hasCoin) root.addChild(coin);
  root.addChild(oldWrap, free);
  return root;
}

/** full 是脚下这排，peek/far 是前方，只看不点，越远越清爽。 */
export type CardMode = 'full' | 'peek' | 'far';

export function makeRouteCard(opts: {
  option: RouteOption;
  width: number;
  mode?: CardMode;
  atlas?: string;
  meatCard?: string;
  marketId?: MarketId;
  onReady?: () => void;
  onTap?: () => void;
}): PIXI.Container {
  const { option, width } = opts;
  const atlas = opts.atlas ?? CARD_ATLAS;
  const mode = opts.mode ?? 'full';
  const height = Math.round(width * FRAME_RATIO);
  const brokeSteelyard = mode === 'full' && feeBroke(option) && canChallengeSteelyard(option);
  const locked = !!option.blocked && !brokeSteelyard;
  const root = new PIXI.Container();
  const artPath = option.revealed && option.node.cardArt
    ? option.node.cardArt
    : option.node.stall === 'meat' && option.revealed
      ? opts.meatCard
      : undefined;

  watchMapTex(CARD_FRAME, opts.onReady);
  watchMapTex(atlas, opts.onReady);
  if (artPath) watchMapTex(artPath, opts.onReady);

  const winX = Math.round(width * WIN.x);
  const winY = Math.round(height * WIN.y);
  const winW = Math.round(width * WIN.w);
  const winH = Math.round(height * WIN.h);

  const isCutoutProp = !!artPath && artPath.startsWith('subpkg_kitchen/');
  const artTex = artPath ? gameTexture(artPath) : null;
  const thumb = artTex && isTextureReady(artTex)
    ? artTex
    : slotTexture(atlas, slotForNode(option.node, option.revealed));
  if (thumb && isCutoutProp && artTex && isTextureReady(artTex)) {
    const hole = new PIXI.Graphics();
    hole.beginFill(0xF6EAD3, 1);
    hole.drawRect(winX, winY, winW, winH);
    hole.endFill();
    hole.beginFill(0xFCE4AA, 0.72);
    hole.drawCircle(winX + winW / 2, winY + winH * 0.48, Math.min(winW, winH) * 0.36);
    hole.endFill();
    hole.eventMode = 'none';
    root.addChild(hole);

    const sp = new PIXI.Sprite(artTex);
    fitSpriteInBox(sp, winW * 0.84, winH * 0.76);
    sp.anchor.set(0.5);
    sp.position.set(winX + winW / 2, winY + winH * 0.47);
    sp.eventMode = 'none';
    if (locked) sp.tint = 0x8A8073;
    root.addChild(sp);
  } else if (thumb) {
    const sp = new PIXI.Sprite(thumb);
    sp.position.set(winX, winY);
    sp.width = winW;
    sp.height = winH;
    sp.eventMode = 'none';
    if (locked) sp.tint = 0x8A8073;
    root.addChild(sp);
  } else {
    const hole = new PIXI.Graphics();
    hole.beginFill(0xE7DCC8);
    hole.drawRect(winX, winY, winW, winH);
    hole.endFill();
    root.addChild(hole);
  }

  const frameTex = gameTexture(CARD_FRAME);
  if (isTextureReady(frameTex)) {
    const frame = new PIXI.Sprite(frameTex);
    frame.width = width;
    frame.height = height;
    frame.eventMode = 'none';
    root.addChild(frame);
  } else {
    const edge = new PIXI.Graphics();
    edge.lineStyle(4, 0x5A3B1E, 1);
    edge.beginFill(0x8B5A2B);
    edge.drawRoundedRect(0, 0, width, height, 18);
    edge.endFill();
    edge.beginFill(0xF6EDE0);
    edge.drawRoundedRect(winX, winY, winW, winH, 8);
    edge.endFill();
    root.addChild(edge);
  }

  // ── 顶部胡桃木匾摊位名（大字清晰描边，超宽自动等比收拢，不糊不溢） ───────
  const titleSize = Math.max(22, Math.round(width * 0.135));
  const title = makeText('heading', cardName(option.node, option.revealed, opts.marketId), 0xFFF7E6, {
    size: titleSize,
    stroke: 0x241408,
    strokeWidth: 4,
  });
  title.anchor.set(0.5);
  fitTextWidth(title, width * 0.82);
  title.position.set(width / 2, height * 0.118);
  root.addChild(title);

  // ── 收费/免单宣纸价签 ───────────────────────────────────────────────────
  const showFee = option.revealed && (option.fee > 0 || option.waived);
  if (showFee) {
    const mark = option.waived
      ? makeWaivedMark(option.listedFee, Math.max(20, Math.round(width * 0.105)), opts.onReady)
      : makeFeeMark(option.fee, feeBroke(option), Math.max(20, Math.round(width * 0.11)), opts.onReady);
    if (mark.width > winW - 10) mark.scale.set((winW - 10) / mark.width);
    const mw = mark.width;
    mark.position.set(Math.round((width - mw) / 2), winY + Math.round(winH * 0.11));
    root.addChild(mark);
  }

  // ── 底部宣纸状态条（彻底去掉旧版半透明黑底胶囊！仅近排与关键中排显示宣纸条） ──
  if (mode === 'full') {
    const stripH = Math.max(36, Math.round(height * 0.12));
    const stripY = height - stripH - Math.round(height * 0.052);
    const sx = winX + 6;
    const sw = winW - 12;

    const strip = new PIXI.Graphics();
    strip.beginFill(0x160E08, 0.24);
    strip.drawRoundedRect(sx, stripY + 2.5, sw, stripH, 7);
    strip.endFill();
    strip.lineStyle(2, locked ? RED_INK : 0x5A3D24, 0.95);
    strip.beginFill(locked ? 0xFCE8E2 : 0xFAF0DA, 0.96);
    strip.drawRoundedRect(sx, stripY, sw, stripH, 7);
    strip.endFill();
    // Brass pin accents on left/right of paper slip
    for (const px of [sx + 8, sx + sw - 8]) {
      strip.lineStyle(0);
      strip.beginFill(locked ? RED_INK : 0xC69548, 0.85);
      strip.drawCircle(px, stripY + stripH / 2, 2.5);
      strip.endFill();
    }
    strip.eventMode = 'none';
    root.addChild(strip);

    const copy = option.blocked && !feeBroke(option) ? option.blocked : infoLine(option);
    const info = makeText('caption', copy, locked ? RED_INK : INK, {
      size: 21,
      fontWeight: '700',
    });
    info.anchor.set(0.5);
    fitTextWidth(info, sw - 26);
    info.position.set(width / 2, stripY + stripH / 2 - 0.5);
    root.addChild(info);
  } else if (mode === 'peek' && option.revealed) {
    const copy = option.blocked && !feeBroke(option) ? option.blocked : infoLine(option);
    const info = makeText('caption', copy, locked ? 0xFFD8CE : 0xFFF8EC, {
      size: 20,
      fontWeight: '700',
      stroke: 0x241408,
      strokeWidth: 4,
    });
    info.anchor.set(0.5, 1);
    fitTextWidth(info, winW - 12);
    info.position.set(width / 2, winY + winH - 6);
    root.addChild(info);
  }

  if (mode === 'full') {
    if (locked) root.alpha = 0.88;
    root.eventMode = 'static';
    root.cursor = locked ? 'default' : 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    if (!locked && opts.onTap) root.on('pointertap', opts.onTap);
  } else {
    root.alpha = mode === 'peek' ? 0.92 : 0.76;
    root.eventMode = 'none';
  }
  return root;
}

/** 车道中心占屏宽的比例。左中右固定，跨层对齐，方向感全靠它。 */
const LANE_X = [0.2, 0.5, 0.8];
const CARD_FRACTION = 0.285;
/** 越靠前的排越大，纵深跟着底图的透视走。前两排压得住，当前排才抬得起来。 */
const ROW_SCALES = [1, 0.64, 0.44];
const ROW_GAP = 24;
const ROW_MODES: CardMode[] = ['full', 'peek', 'far'];

const LANE_X_WIDE = [0.145, 0.382, 0.618, 0.855];

function laneCenter(viewWidth: number, lane: number, slots = LANES): number {
  if (slots >= 4) {
    return Math.round(viewWidth * (LANE_X_WIDE[Math.max(0, Math.min(LANE_X_WIDE.length - 1, lane))] ?? 0.5));
  }
  return Math.round(viewWidth * (LANE_X[Math.max(0, Math.min(LANES - 1, lane))] ?? 0.5));
}

export interface RouteCell {
  option: RouteOption;
  card: PIXI.Container;
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  width: number;
}

export interface RouteMapView {
  root: PIXI.Container;
  links: PIXI.Graphics;
  rows: RouteCell[][];
}

export function layoutRouteMap(opts: {
  rows: RouteOption[][];
  viewWidth: number;
  top: number;
  bottom: number;
  onPick: (nodeId: string) => void;
  showRoot?: boolean;
  atlas?: string;
  meatCard?: string;
  marketId?: MarketId;
  onReady?: () => void;
}): RouteMapView {
  const root = new PIXI.Container();
  const links = new PIXI.Graphics();
  const view: RouteMapView = { root, links, rows: [] };
  if (!opts.rows.length || !opts.rows[0].length) return view;

  const room = opts.bottom - opts.top;
  const stack = (rows: number, w: number) =>
    ROW_SCALES.slice(0, rows).reduce((sum, s) => sum + w * s * FRAME_RATIO, 0) + ROW_GAP * (rows - 1);
  const fitBase = (rows: number) => Math.floor(
    (room - ROW_GAP * (rows - 1))
    / (ROW_SCALES.slice(0, rows).reduce((a, b) => a + b, 0) * FRAME_RATIO),
  );
  const minBase = Math.round(opts.viewWidth * 0.245);

  let shown = Math.min(opts.rows.length, ROW_SCALES.length);
  const wide = opts.rows.slice(0, shown).some((row) => row.length >= 4);
  let base = Math.round(opts.viewWidth * (wide ? 0.21 : CARD_FRACTION));
  while (shown > 1 && stack(shown, base) > room) {
    const shrunk = fitBase(shown);
    if (shrunk >= minBase) {
      base = shrunk;
      break;
    }
    shown -= 1;
  }
  if (stack(shown, base) > room) base = fitBase(shown);

  const placed: RouteCell[][] = [];
  let lineY = opts.bottom;
  for (let i = 0; i < shown; i++) {
    const width = Math.round(base * ROW_SCALES[i]);
    const height = Math.round(width * FRAME_RATIO);
    const rowTop = lineY - height;
    placed.push(opts.rows[i].map((option) => ({
      option,
      card: new PIXI.Container(),
      cx: laneCenter(opts.viewWidth, option.node.lane, opts.rows[i].length),
      cy: rowTop + Math.round(height / 2),
      top: rowTop,
      bottom: lineY,
      width,
    })));
    lineY = rowTop - ROW_GAP;
  }

  const lines = links;
  const linkPasses = [
    { grow: 4, color: 0x2A2018, near: 0.48, far: 0.28 },
    { grow: 0, color: 0xFAF0DA, near: 0.72, far: 0.42 },
  ];
  for (const pass of linkPasses) {
    for (let i = 0; i < placed.length - 1; i++) {
      const near = i === 0;
      lines.lineStyle((near ? 5 : 4) + pass.grow, pass.color, near ? pass.near : pass.far);
      placed[i].forEach((from) => {
        from.option.node.next.forEach((nid) => {
          const to = placed[i + 1].find((c) => c.option.node.id === nid);
          if (!to) return;
          lines.moveTo(from.cx, from.top + 6);
          lines.lineTo(to.cx, to.bottom - 6);
        });
      });
    }
  }
  if (opts.showRoot !== false) {
    const rootY = placed[0][0].bottom + 34;
    const cx = Math.round(opts.viewWidth / 2);
    lines.lineStyle(5, 0xE07A3A, 0.58);
    placed[0].forEach((c) => {
      lines.moveTo(cx, rootY);
      lines.lineTo(c.cx, c.bottom - 4);
    });
    lines.lineStyle(3, 0x2A2018, 0.9);
    lines.beginFill(0xE07A3A);
    lines.drawCircle(cx, rootY, 11);
    lines.endFill();
  }
  root.addChild(lines);

  placed.forEach((row, i) => {
    row.forEach((cell) => {
      const face = makeRouteCard({
        option: cell.option,
        width: cell.width,
        mode: ROW_MODES[i],
        atlas: opts.atlas,
        meatCard: opts.meatCard,
        marketId: opts.marketId,
        onReady: opts.onReady,
        onTap: () => opts.onPick(cell.option.node.id),
      });
      face.position.set(-Math.round(cell.width / 2), -(cell.cy - cell.top));
      cell.card.addChild(face);
      cell.card.position.set(cell.cx, cell.cy);
      root.addChild(cell.card);
    });
  });
  view.rows = placed;
  return view;
}
