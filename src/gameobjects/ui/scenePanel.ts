/**
 * 场景化弹窗公共件：整页是一张插画场景（墙/板/书），信息用实物承载（木招牌、纸签、瓷碟、墨字……），
 * 不再一层层套圆角框。老坛腌制坊是第一个样板，其余页面共用这里的工具。
 */
import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { fillRect, makeCloseButton, makeText } from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady } from '@/utils/assets';

/** 所有场景页共用的小道具贴图。 */
export const SCENE_ART = {
  plaque: 'subpkg_images/scene_pk_plaque.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  plate: 'subpkg_images/scene_pk_plate.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  hourglass: 'subpkg_images/scene_pk_hourglass.png',
  divider: 'subpkg_images/scene_pk_ink_divider.png',
  sheet: 'subpkg_images/scene_pk_recipe_sheet.png',
} as const;

export const SCENE_INK = {
  ink: 0x2A2018,
  soft: 0x5A4430,
  muted: 0x8A6E52,
  red: 0xB8361F,
  green: 0x3F7034,
  gold: 0x9A5A06,
  cream: 0xFFF6E2,
} as const;

export function sceneSprite(path: string, w: number, h?: number): PIXI.Sprite | null {
  const tex = gameTexture(path);
  if (!isTextureReady(tex)) return null;
  const sp = new PIXI.Sprite(tex);
  if (h === undefined) {
    sp.width = w;
    sp.scale.y = sp.scale.x;
  } else {
    fitSpriteInBox(sp, w, h);
  }
  sp.eventMode = 'none';
  return sp;
}

/**
 * 场景根：全屏暗幕 + 按 designW 设计、整体等比缩放居中的场景容器。
 * 返回 scene（在其中按设计坐标摆放）以及 toStage（设计坐标 → 舞台坐标，给飞奖励动画用）。
 */
export function makeSceneRoot(opts: {
  parent: PIXI.Container;
  designW: number;
  panelH: number;
  /** 顶部给招牌/关闭钮留的外溢高度 */
  topBleed?: number;
  dimAlpha?: number;
  onDimTap: () => void;
}): { scene: PIXI.Container; scale: number; toStage: (x: number, y: number) => { x: number; y: number } } {
  const sw = Game.designWidth;
  const sh = Game.logicHeight;
  const dim = new PIXI.Graphics();
  fillRect(dim, 0, 0, sw, sh, 0x160E08);
  dim.alpha = opts.dimAlpha ?? 0.66;
  dim.eventMode = 'static';
  dim.on('pointertap', opts.onDimTap);
  opts.parent.addChild(dim);

  const bleed = opts.topBleed ?? 40;
  const scene = new PIXI.Container();
  scene.eventMode = 'static';
  scene.hitArea = new PIXI.Rectangle(0, -bleed - 10, opts.designW, opts.panelH + bleed + 20);
  scene.on('pointertap', (e) => e.stopPropagation());

  const availW = sw - 16;
  const availH = sh - Game.safeTop - bleed - Math.max(16, Game.safeBottom);
  const scale = Math.min(1, availW / opts.designW, availH / opts.panelH);
  scene.scale.set(scale);
  const sx = Math.round((sw - opts.designW * scale) / 2);
  const sy = Math.round(Game.safeTop + bleed + Math.max(0, (availH - opts.panelH * scale) / 2));
  scene.position.set(sx, sy);
  opts.parent.addChild(scene);
  return { scene, scale, toStage: (x, y) => ({ x: sx + x * scale, y: sy + y * scale }) };
}

/** 背景墙：上段原样、中段竖向拉伸、下段原样（插画的装饰都在上下两端）。 */
export function drawSceneWall(
  scene: PIXI.Container,
  path: string,
  w: number,
  h: number,
  sliceTop: number,
  sliceBottom: number,
  fallback = 0x6B3F22,
): void {
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x0E0804, 0.45);
  shadow.drawRoundedRect(8, 14, w - 16, h - 4, 34);
  shadow.endFill();
  scene.addChild(shadow);
  const tex = gameTexture(path);
  if (isTextureReady(tex)) {
    const srcW = tex.width;
    const k = w / srcW;
    const plane = new PIXI.NineSlicePlane(tex, 0, sliceTop / k, 0, sliceBottom / k);
    plane.width = srcW;
    plane.height = h / k;
    plane.scale.set(k);
    scene.addChild(plane);
  } else {
    const g = new PIXI.Graphics();
    g.lineStyle(4, 0x2A2018, 1);
    g.beginFill(fallback, 1);
    g.drawRoundedRect(0, 0, w, h, 30);
    g.endFill();
    scene.addChild(g);
  }
}

/** 竖向三段拉伸的纸/板（上下端原样）。 */
export function drawStretchSheet(
  scene: PIXI.Container,
  path: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sliceTop: number,
  sliceBottom: number,
  fallback = 0xF8ECD2,
): void {
  const tex = gameTexture(path);
  if (isTextureReady(tex)) {
    const k = w / tex.width;
    const plane = new PIXI.NineSlicePlane(tex, 0, sliceTop / k, 0, sliceBottom / k);
    plane.width = tex.width;
    plane.height = h / k;
    plane.scale.set(k);
    plane.position.set(x, y);
    scene.addChild(plane);
  } else {
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0xB59A74, 1);
    g.beginFill(fallback, 1);
    g.drawRoundedRect(x, y, w, h, 10);
    g.endFill();
    scene.addChild(g);
  }
}

/** 挂在墙上的木招牌标题（所有场景页统一）。返回招牌底边 y。 */
export function drawPlaqueTitle(scene: PIXI.Container, title: string, cx: number, top = -44, width = 336): number {
  const plaque = sceneSprite(SCENE_ART.plaque, width);
  let faceCy = top + 114;
  let bottom = top + 172;
  if (plaque) {
    plaque.position.set(cx - width / 2, top);
    scene.addChild(plaque);
    faceCy = top + plaque.height * 0.64;
    bottom = top + plaque.height;
  }
  const size = title.length > 6 ? 34 : 40;
  const t = makeText('display', title, 0x4A2A12, { size, stroke: 0xF6DDB0, strokeWidth: 3 });
  t.anchor.set(0.5);
  t.position.set(cx, faceCy);
  if (t.width > width - 64) t.scale.set((width - 64) / t.width);
  scene.addChild(t);
  return bottom;
}

export function drawSceneClose(scene: PIXI.Container, x: number, y: number, onTap: () => void, onReady?: () => void): void {
  const btn = makeCloseButton({ size: 60, silent: true, onReady, onTap });
  btn.position.set(x, y);
  scene.addChild(btn);
}

export function drawInkDivider(parent: PIXI.Container, x: number, y: number, w: number, alpha = 0.32, h = 10): void {
  const div = sceneSprite(SCENE_ART.divider, w);
  if (div) {
    div.height = h;
    div.alpha = alpha;
    div.position.set(x, y);
    parent.addChild(div);
  } else {
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x5A4430, alpha);
    g.moveTo(x, y + h / 2);
    g.lineTo(x + w, y + h / 2);
    parent.addChild(g);
  }
}

/** 青花瓷碟上的物品（物品底部落在碟心）。 */
export function makePlateItem(opts: {
  iconPath: string;
  plateW?: number;
  iconSize?: number;
  qty?: number;
  dim?: boolean;
  plate?: string;
}): PIXI.Container {
  const plateW = opts.plateW ?? 112;
  const iconSize = opts.iconSize ?? Math.round(plateW * 0.6);
  const root = new PIXI.Container();
  const plate = sceneSprite(opts.plate ?? SCENE_ART.plate, plateW);
  if (plate) {
    plate.anchor.set(0.5);
    root.addChild(plate);
  }
  const icon = sceneSprite(opts.iconPath, iconSize, iconSize);
  if (icon) {
    icon.anchor.set(0.5, 1);
    icon.position.set(0, plateW * 0.12);
    root.addChild(icon);
  }
  if (opts.qty && opts.qty > 1) {
    const q = makeText('number', `×${opts.qty}`, SCENE_INK.red, { size: 24, stroke: 0xFFF8EA, strokeWidth: 5 });
    q.anchor.set(1, 1);
    q.position.set(plateW / 2 + 4, plateW * 0.34);
    root.addChild(q);
  }
  if (opts.dim) root.alpha = 0.45;
  return root;
}

/**
 * 立体成菜直呈组件（成菜贴图本身已自带 40°–45° 立体碗盘/砂锅，绝不再垫 SCENE_ART.plate）：
 * 底部柔和半透明椭圆形落影 + 饱满大尺寸成菜贴图 + 可选右下角描边数量角标 ×N。
 */
export function makeDishDisplay(opts: {
  dishPath: string;
  size?: number;
  qty?: number;
  dim?: boolean;
  shadowAlpha?: number;
  shadowColor?: number;
}): PIXI.Container {
  const size = opts.size ?? 104;
  const shadowAlpha = opts.shadowAlpha ?? 0.22;
  const shadowColor = opts.shadowColor ?? 0x2A1A0E;
  const root = new PIXI.Container();

  if (shadowAlpha > 0) {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(shadowColor, shadowAlpha);
    shadow.drawEllipse(0, Math.round(size * 0.28), Math.round(size * 0.42), Math.round(size * 0.13));
    shadow.endFill();
    shadow.eventMode = 'none';
    root.addChild(shadow);
  }

  const dish = sceneSprite(opts.dishPath, size, size);
  if (dish) {
    dish.anchor.set(0.5);
    dish.position.set(0, -Math.round(size * 0.04));
    root.addChild(dish);
  }

  if (opts.qty && opts.qty > 1) {
    const q = makeText('number', `×${opts.qty}`, SCENE_INK.red, { size: 24, stroke: 0xFFF8EA, strokeWidth: 5 });
    q.anchor.set(1, 1);
    q.position.set(Math.round(size * 0.48) + 4, Math.round(size * 0.42));
    root.addChild(q);
  }

  if (opts.dim) root.alpha = 0.45;
  return root;
}

/** 朱红印章 + 白字（2 字最佳）。 */
export function makeSealStamp(text: string, size = 50, rotation = -0.1): PIXI.Container {
  const root = new PIXI.Container();
  const sp = sceneSprite(SCENE_ART.seal, size, size);
  if (sp) {
    sp.anchor.set(0.5);
    root.addChild(sp);
  } else {
    const g = new PIXI.Graphics();
    g.beginFill(0xC43426, 1);
    g.drawRoundedRect(-size / 2, -size / 2, size, size, 8);
    g.endFill();
    root.addChild(g);
  }
  const t = makeText('caption', text, 0xFFF4E6, { size: Math.max(18, Math.round(size * 0.38)), fontWeight: '700' });
  t.anchor.set(0.5);
  if (t.width > size - 8) t.scale.set((size - 8) / t.width);
  root.addChild(t);
  root.rotation = rotation;
  return root;
}

/** 横挂牛皮纸签：左侧麻绳，右 70% 写字面。返回签容器和写字面中心/宽度。 */
export function makeHangTag(width = 236): { node: PIXI.Container; faceCx: number; faceW: number; faceX: number; h: number } {
  const node = new PIXI.Container();
  const sp = sceneSprite(SCENE_ART.tag, width);
  const h = sp ? sp.height : Math.round(width * 0.48);
  if (sp) node.addChild(sp);
  const faceX = width * 0.31;
  const faceW = width - faceX - 10;
  return { node, faceCx: faceX + faceW / 2, faceW, faceX, h };
}

/** 沙漏 + 时长小字。 */
export function makeHourglassText(text: string, color: number = SCENE_INK.muted): PIXI.Container {
  const root = new PIXI.Container();
  const hg = sceneSprite(SCENE_ART.hourglass, 18, 26);
  let x = 0;
  if (hg) {
    hg.anchor.set(0, 0.5);
    root.addChild(hg);
    x = 24;
  }
  const t = makeText('caption', text, color, { size: 22, fontWeight: '600' });
  t.anchor.set(0, 0.5);
  t.position.set(x, 0);
  root.addChild(t);
  return root;
}

export function sceneArtPaths(): string[] {
  return Object.values(SCENE_ART);
}

/**
 * 奖励直接写成「图标 + 文字」串（不加框）。chips 同 dailyMenuRewardChips / neighborRewardChips 的格式。
 * 返回容器，原点在左侧垂直居中。
 */
export function makeInlineRewards(
  chips: Array<{ icon?: string; itemId?: string; label: string }>,
  opts: {
    color?: number;
    goldColor?: number;
    size?: number;
    iconSize?: number;
    stroke?: number;
    gap?: number;
    resolveItemIcon: (id: string) => string;
  },
): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const size = opts.size ?? 22;
  const iconSize = opts.iconSize ?? Math.round(size * 1.45);
  const gap = opts.gap ?? 16;
  let x = 0;
  for (const chip of chips) {
    const path = chip.icon ?? (chip.itemId ? opts.resolveItemIcon(chip.itemId) : '');
    if (path) {
      const sp = sceneSprite(path, iconSize, iconSize);
      if (sp) {
        sp.anchor.set(0, 0.5);
        sp.position.set(x, 0);
        root.addChild(sp);
      }
      x += iconSize + 4;
    }
    const isGold = !!chip.icon;
    const t = makeText('number', chip.label, isGold ? (opts.goldColor ?? 0x9A5A06) : (opts.color ?? 0x2A2018), {
      size,
      ...(opts.stroke !== undefined ? { stroke: opts.stroke, strokeWidth: Math.max(3, Math.round(size * 0.16)) } : {}),
    });
    t.anchor.set(0, 0.5);
    t.position.set(x, 0);
    root.addChild(t);
    x += t.width + gap;
  }
  return root;
}

/** 食材需求：图标 + 「有/要」数字（够了绿、不够红），不加框。返回容器与总宽。 */
export function makeNeedIcons(
  needs: Array<{ iconPath: string; have: number; need: number }>,
  opts: { iconSize?: number; size?: number; okColor?: number; lackColor?: number; stroke?: number; maxW?: number } = {},
): { node: PIXI.Container; width: number } {
  const node = new PIXI.Container();
  const iconSize = opts.iconSize ?? 42;
  const size = opts.size ?? 24;
  let x = 0;
  for (const n of needs) {
    const ok = n.have >= n.need;
    const t = makeText('number', `${n.have}/${n.need}`, ok ? (opts.okColor ?? SCENE_INK.green) : (opts.lackColor ?? SCENE_INK.red), {
      size,
      ...(opts.stroke !== undefined ? { stroke: opts.stroke, strokeWidth: Math.max(3, Math.round(size * 0.16)) } : {}),
    });
    const w = iconSize + 4 + t.width;
    if (opts.maxW && x + w > opts.maxW) break;
    const sp = sceneSprite(n.iconPath, iconSize, iconSize);
    if (sp) {
      sp.anchor.set(0, 0.5);
      sp.position.set(x, 0);
      node.addChild(sp);
    }
    t.anchor.set(0, 0.5);
    t.position.set(x + iconSize + 4, 1);
    node.addChild(t);
    x += w + 14;
  }
  return { node, width: Math.max(0, x - 14) };
}
