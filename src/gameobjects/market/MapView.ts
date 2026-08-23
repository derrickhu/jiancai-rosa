import * as PIXI from 'pixi.js';
import { LANES, cardHint, cardName, isMysteryCard, type CardKind, type StallId } from '@/sim';
import type { RouteOption } from '@/managers/RunManager';
import { gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { makeLabel } from '@/utils/ui';

export const CARD_FRAME = 'subpkg_images/ui_card_frame.png';
export const CARD_ATLAS = 'subpkg_images/market_cards.jpg';

/** 卡框原图 264×392，中间已抠成透明窗口。缩略图垫在框底下正好露满窗口。 */
const FRAME_RATIO = 392 / 264;
const WIN = { x: 0.0727, y: 0.2333, w: 0.8545, h: 0.7034 };

const ATLAS_COLS = 4;
const ATLAS_ROWS = 3;

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
};
const BACK_SLOT = 11;

const _slots = new Map<string, PIXI.Texture>();

function slotTexture(atlas: string, slot: number): PIXI.Texture | null {
  const key = `${atlas}#${slot}`;
  const hit = _slots.get(key);
  if (hit) return hit;
  const tex = gameTexture(atlas);
  if (!isTextureReady(tex)) return null;
  const cw = tex.width / ATLAS_COLS;
  const ch = tex.height / ATLAS_ROWS;
  const col = slot % ATLAS_COLS;
  const row = Math.floor(slot / ATLAS_COLS);
  // 内缩 1px，躲开 JPEG 在格子边界上的溢色
  const frame = new PIXI.Rectangle(col * cw + 1, row * ch + 1, cw - 2, ch - 2);
  const sub = new PIXI.Texture(tex.baseTexture, frame);
  _slots.set(key, sub);
  return sub;
}

/** 收费摊也画自己摊型的图：玩家要先知道是哪种摊，贵不贵看下沿那行。 */
export function slotForNode(node: { kind: CardKind; stall?: StallId }, revealed: boolean): number {
  if (!revealed && isMysteryCard(node.kind)) return BACK_SLOT;
  if (node.stall) return STALL_SLOT[node.stall];
  return KIND_SLOT[node.kind];
}

/** 卡面下沿那一行：写清代价和收益，别让玩家猜。 */
function infoLine(opt: RouteOption): string {
  const { node, revealed, fee, left } = opt;
  if (!revealed) return cardHint(node, false);
  const rummage = node.kind === 'stall' || node.kind === 'paystall' || node.encounter?.type === 'rummage';
  if (rummage) {
    const price = fee > 0 ? `${fee} 金币` : '免费';
    return `${price} · 剩 ${left} 件`;
  }
  return cardHint(node, true);
}

/** full 是脚下这排，peek/far 是前方，只看不点，越远越省字。 */
export type CardMode = 'full' | 'peek' | 'far';

export function makeRouteCard(opts: {
  option: RouteOption;
  width: number;
  mode?: CardMode;
  /** 这个菜场自己的卡面图集。不传就用巷口那张。 */
  atlas?: string;
  /** 有肉摊的菜场用独立卡面，不再借用蛋豆格。 */
  meatCard?: string;
  onReady?: () => void;
  onTap?: () => void;
}): PIXI.Container {
  const { option, width } = opts;
  const atlas = opts.atlas ?? CARD_ATLAS;
  const mode = opts.mode ?? 'full';
  const height = Math.round(width * FRAME_RATIO);
  const locked = !!option.blocked;
  const root = new PIXI.Container();
  const artPath = option.revealed && option.node.cardArt
    ? option.node.cardArt
    : option.node.stall === 'meat' && option.revealed
      ? opts.meatCard
      : undefined;

  whenTextureReady(CARD_FRAME, () => opts.onReady?.());
  whenTextureReady(atlas, () => opts.onReady?.());
  if (artPath) whenTextureReady(artPath, () => opts.onReady?.());

  const winX = Math.round(width * WIN.x);
  const winY = Math.round(height * WIN.y);
  const winW = Math.round(width * WIN.w);
  const winH = Math.round(height * WIN.h);

  const artTex = artPath ? gameTexture(artPath) : null;
  const thumb = artTex && isTextureReady(artTex)
    ? artTex
    : slotTexture(atlas, slotForNode(option.node, option.revealed));
  if (thumb) {
    const sp = new PIXI.Sprite(thumb);
    sp.position.set(winX, winY);
    sp.width = winW;
    sp.height = winH;
    sp.eventMode = 'none';
    // 进不去的卡压灰，但照旧看得见是什么
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

  const titleSize = Math.round(width * (mode === 'far' ? 0.16 : 0.125));
  const title = makeLabel(cardName(option.node, option.revealed), titleSize, 0xF6EDE0, {
    fontWeight: '700',
    dropShadow: true,
    dropShadowColor: 0x2A2018,
    dropShadowDistance: 2,
    dropShadowBlur: 2,
    dropShadowAlpha: 0.6,
  });
  title.anchor.set(0.5);
  title.position.set(width / 2, height * 0.115);
  root.addChild(title);

  if (mode !== 'far') {
    const stripH = Math.round(height * 0.115);
    const stripY = height - stripH - Math.round(height * 0.055);
    const strip = new PIXI.Graphics();
    strip.beginFill(locked ? 0x7A2E24 : 0x2A2018, 0.78);
    strip.drawRoundedRect(winX + 4, stripY, winW - 8, stripH, stripH / 2);
    strip.endFill();
    strip.eventMode = 'none';
    root.addChild(strip);

    const info = makeLabel(
      option.blocked ?? infoLine(option),
      Math.round(width * 0.085),
      locked ? 0xFFD8CE : 0xF4EFE6,
      { fontWeight: '600' },
    );
    info.anchor.set(0.5);
    info.position.set(width / 2, stripY + stripH / 2);
    root.addChild(info);
  }

  const badge = option.node.steps === 0
    ? { text: '0步', color: 0x6BA368 }
    : option.node.kind === 'paystall'
      ? { text: '¥', color: 0xE0A100 }
      : null;
  if (badge && option.revealed) {
    const r = Math.round(width * 0.105);
    const disc = new PIXI.Graphics();
    disc.lineStyle(3, 0x2A2018, 1);
    disc.beginFill(badge.color);
    disc.drawCircle(0, 0, r);
    disc.endFill();
    disc.position.set(width * 0.86, height * 0.28);
    root.addChild(disc);
    const mark = makeLabel(badge.text, Math.round(width * 0.085), 0xFFF8F0, { fontWeight: '700' });
    mark.anchor.set(0.5);
    mark.position.set(width * 0.86, height * 0.28);
    root.addChild(mark);
  }

  if (mode === 'full') {
    if (locked) root.alpha = 0.88;
    root.eventMode = 'static';
    root.cursor = locked ? 'default' : 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    if (!locked && opts.onTap) root.on('pointertap', opts.onTap);
  } else {
    // 前方的卡是情报不是按钮，压暗并且不吃点击
    root.alpha = mode === 'peek' ? 0.9 : 0.74;
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

function laneCenter(viewWidth: number, lane: number): number {
  return Math.round(viewWidth * (LANE_X[Math.max(0, Math.min(LANES - 1, lane))] ?? 0.5));
}

export interface RouteCell {
  option: RouteOption;
  /** 卡片外壳，原点在卡中心，动画直接改它的 position / scale */
  card: PIXI.Container;
  /** 车道中心的屏幕 x */
  cx: number;
  /** 卡中心的屏幕 y，走路过渡要拿它当落点 */
  cy: number;
  top: number;
  bottom: number;
  width: number;
}

/** 交给场景做走路过渡：要按排拿到卡片本体和它该去的位置。 */
export interface RouteMapView {
  root: PIXI.Container;
  links: PIXI.Graphics;
  rows: RouteCell[][];
}

/**
 * 脚下一排在最下，前方两排往上缩小。排间连线画出可达关系，
 * 玩家在点之前就能看出「走左边这张，最右边那张就够不着了」。
 */
export function layoutRouteMap(opts: {
  rows: RouteOption[][];
  viewWidth: number;
  top: number;
  /** 脚下那排卡的底线 */
  bottom: number;
  onPick: (nodeId: string) => void;
  /** 全层进不去时让位给「绕过去」按钮，不画站位点 */
  showRoot?: boolean;
  atlas?: string;
  meatCard?: string;
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
  // 卡再窄就认不出缩略图了，到这条线才开始砍排
  const minBase = Math.round(opts.viewWidth * 0.245);

  let shown = Math.min(opts.rows.length, ROW_SCALES.length);
  let base = Math.round(opts.viewWidth * CARD_FRACTION);
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
      cx: laneCenter(opts.viewWidth, option.node.lane),
      cy: rowTop + Math.round(height / 2),
      top: rowTop,
      bottom: lineY,
      width,
    })));
    lineY = rowTop - ROW_GAP;
  }

  const lines = links;
  // 底图明暗不定，米色线先垫一道深色描边才到处都看得见
  const linkPasses = [
    { grow: 4, color: 0x2A2018, near: 0.45, far: 0.26 },
    { grow: 0, color: 0xF4EFE6, near: 0.62, far: 0.38 },
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
    lines.lineStyle(5, 0xE07A3A, 0.55);
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
        onReady: opts.onReady,
        onTap: () => opts.onPick(cell.option.node.id),
      });
      // 卡外面套一层、原点在卡中心：走路过渡要绕中心缩放
      face.position.set(-Math.round(cell.width / 2), -(cell.cy - cell.top));
      cell.card.addChild(face);
      cell.card.position.set(cell.cx, cell.cy);
      root.addChild(cell.card);
    });
  });
  view.rows = placed;
  return view;
}
