import * as PIXI from 'pixi.js';
import { RARITY_STYLE, type Rarity } from '@/sim/rarity';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from './assets';

export const FONT = 'PingFang SC, sans-serif';

/**
 * 格子的稀有度描边：绿=普通 / 蓝=高级 / 紫=稀有。
 * 外面先描一圈浅色再压深色，木纹底和暗色图标上也分得清蓝和紫。
 */
export function drawRarityFrame(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  rarity: Rarity,
  opts: { radius?: number; thick?: boolean } = {},
): void {
  const style = RARITY_STYLE[rarity];
  const r = opts.radius ?? 10;
  const width = opts.thick ? 4 : 3;
  g.lineStyle(width + 2, style.glow, 0.5);
  g.drawRoundedRect(x, y, w, h, r);
  g.lineStyle(width, style.frame, 1);
  g.drawRoundedRect(x, y, w, h, r);
}

export function makeLabel(
  text: string,
  size: number,
  color = 0xF4EFE6,
  opts: Partial<PIXI.ITextStyle> = {},
): PIXI.Text {
  const label = new PIXI.Text(text, {
    fontFamily: FONT,
    fontSize: size,
    fill: color,
    fontWeight: '500',
    ...opts,
  });
  label.eventMode = 'none';
  return label;
}

/** 图鉴格子名：粗圆体深棕字 + 奶油描边，参考食材图鉴那种压在卡片上的名字。 */
export function makeDexName(
  text: string,
  size = 18,
  unlocked = true,
  wrapWidth = 0,
): PIXI.Text {
  return makeLabel(text, size, unlocked ? 0x3A2416 : 0x8A7358, {
    fontFamily: 'PingFang SC, Hiragino Sans GB, sans-serif',
    fontWeight: '700',
    stroke: unlocked ? 0xFFF6E8 : 0xE8D8C4,
    strokeThickness: Math.max(3, Math.round(size * 0.22)),
    lineJoin: 'round',
    dropShadow: true,
    dropShadowColor: '#2A2018',
    dropShadowAlpha: unlocked ? 0.2 : 0.1,
    dropShadowDistance: 1.4,
    dropShadowAngle: Math.PI / 2,
    dropShadowBlur: 0,
    align: 'center',
    wordWrap: wrapWidth > 0,
    wordWrapWidth: wrapWidth,
    breakWords: true,
  });
}

/** 描边白字，图鉴分类那种有厚度的标题。 */
export function makeStrokeLabel(
  text: string,
  size: number,
  fill = 0xFFF8F0,
  stroke = 0x2A2018,
  thickness = 5,
  opts: Partial<PIXI.ITextStyle> = {},
): PIXI.Text {
  return makeLabel(text, size, fill, {
    fontWeight: '700',
    stroke,
    strokeThickness: thickness,
    lineJoin: 'round',
    ...opts,
  });
}

export function makeButton(
  label: string,
  width: number,
  height: number,
  fill = 0xC46A3A,
  textColor = 0xFFF8F0,
): PIXI.Container {
  const root = new PIXI.Container();
  const bg = new PIXI.Graphics();
  bg.beginFill(fill);
  bg.drawRoundedRect(0, 0, width, height, 12);
  bg.endFill();
  root.addChild(bg);

  const text = makeLabel(label, Math.min(28, height * 0.42), textColor);
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2);
  root.addChild(text);

  root.eventMode = 'static';
  root.cursor = 'pointer';
  (root as any)._bg = bg;
  (root as any)._label = text;
  (root as any)._w = width;
  (root as any)._h = height;
  (root as any)._fill = fill;
  return root;
}

export function setButtonLabel(btn: PIXI.Container, label: string): void {
  const text = (btn as any)._label as PIXI.Text | undefined;
  if (text) text.text = label;
}

export function setButtonFill(btn: PIXI.Container, fill: number): void {
  const bg = (btn as any)._bg as PIXI.Graphics | undefined;
  const w = (btn as any)._w as number;
  const h = (btn as any)._h as number;
  if (!bg) return;
  (btn as any)._fill = fill;
  bg.clear();
  bg.beginFill(fill);
  bg.drawRoundedRect(0, 0, w, h, 12);
  bg.endFill();
}

/** 顶栏货币/体力条：左侧专有图标压在胶囊上，右侧数字。 */
export function makeStatPill(opts: {
  icon?: string;
  text: string;
  width: number;
  height?: number;
  fill?: number;
  fillColor?: number;
  onIconReady?: () => void;
}): PIXI.Container {
  const height = opts.height ?? 44;
  const root = new PIXI.Container();
  const iconPad = opts.icon ? 22 : 0;
  const barX = iconPad;
  const barW = opts.width - iconPad;
  const r = height / 2;

  const outer = new PIXI.Graphics();
  outer.lineStyle(2, 0x8B5A2B, 1);
  outer.beginFill(0xF4EFE6);
  outer.drawRoundedRect(barX, 0, barW, height, r);
  outer.endFill();
  root.addChild(outer);

  const inset = 3;
  const inner = new PIXI.Graphics();
  inner.beginFill(0xFFF8F0);
  inner.drawRoundedRect(barX + inset, inset, barW - inset * 2, height - inset * 2, r - inset);
  inner.endFill();
  root.addChild(inner);

  if (opts.fill != null) {
    const ratio = Math.max(0, Math.min(1, opts.fill));
    const fx = barX + inset;
    const fy = inset;
    const fw = Math.max(8, (barW - inset * 2) * ratio);
    const fill = new PIXI.Graphics();
    fill.beginFill(opts.fillColor ?? 0x6BA368, 0.88);
    fill.drawRoundedRect(fx, fy, fw, height - inset * 2, r - inset);
    fill.endFill();
    root.addChild(fill);
  }

  const label = new PIXI.Text(opts.text, {
    fontFamily: FONT,
    fontSize: 22,
    fill: 0x3A3228,
    fontWeight: 'bold',
  });
  label.anchor.set(0.5);
  label.position.set(barX + barW / 2 + (opts.icon ? 8 : 0), height / 2);
  label.eventMode = 'none';
  root.addChild(label);

  if (opts.icon) {
    const tex = gameTexture(opts.icon);
    whenTextureReady(opts.icon, () => opts.onIconReady?.());
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 52, 52);
      sp.anchor.set(0.5);
      sp.position.set(24, height / 2);
      root.addChild(sp);
    }
  }

  root.eventMode = 'none';
  return root;
}

/** 顶栏厨艺：左侧圆章等级，右侧经验条。 */
export function makeCookSkillPill(opts: {
  level: number;
  text: string;
  width: number;
  fill: number;
  height?: number;
}): PIXI.Container {
  const height = opts.height ?? 44;
  const root = new PIXI.Container();
  const badge = 40;
  const barX = 18;
  const barW = opts.width - barX;
  const r = height / 2;

  const outer = new PIXI.Graphics();
  outer.lineStyle(2, 0x8B5A2B, 1);
  outer.beginFill(0xF4EFE6);
  outer.drawRoundedRect(barX, 0, barW, height, r);
  outer.endFill();
  root.addChild(outer);

  const inset = 3;
  const inner = new PIXI.Graphics();
  inner.beginFill(0xFFF8F0);
  inner.drawRoundedRect(barX + inset, inset, barW - inset * 2, height - inset * 2, r - inset);
  inner.endFill();
  root.addChild(inner);

  const ratio = Math.max(0, Math.min(1, opts.fill));
  const fw = Math.max(8, (barW - inset * 2) * ratio);
  const fill = new PIXI.Graphics();
  fill.beginFill(0xC46A3A, 0.88);
  fill.drawRoundedRect(barX + inset, inset, fw, height - inset * 2, r - inset);
  fill.endFill();
  root.addChild(fill);

  const label = new PIXI.Text(opts.text, {
    fontFamily: FONT,
    fontSize: 18,
    fill: 0x3A3228,
    fontWeight: 'bold',
  });
  label.anchor.set(0.5);
  label.position.set(barX + barW / 2 + 6, height / 2);
  label.eventMode = 'none';
  root.addChild(label);

  const disc = new PIXI.Graphics();
  disc.lineStyle(3, 0x2A2018, 1);
  disc.beginFill(0xF2C14D);
  disc.drawCircle(badge / 2, height / 2, badge / 2 - 1);
  disc.endFill();
  root.addChild(disc);

  const lv = new PIXI.Text(`${opts.level}`, {
    fontFamily: FONT,
    fontSize: opts.level >= 10 ? 16 : 20,
    fill: 0x2A2018,
    fontWeight: 'bold',
  });
  lv.anchor.set(0.5);
  lv.position.set(badge / 2, height / 2);
  lv.eventMode = 'none';
  root.addChild(lv);

  root.eventMode = 'none';
  return root;
}

export function fillRect(g: PIXI.Graphics, x: number, y: number, w: number, h: number, color: number, r = 0): void {
  g.beginFill(color);
  if (r > 0) g.drawRoundedRect(x, y, w, h, r);
  else g.drawRect(x, y, w, h);
  g.endFill();
}

export const HUD_ICON = {
  clock: 'subpkg_images/hud_clock.png',
  coin: 'subpkg_images/hud_coin.png',
  stamina: 'subpkg_images/hud_stamina.png',
  fridge: 'subpkg_images/hud_fridge.png',
  basket: 'subpkg_images/hud_basket.png',
  dex: 'subpkg_images/hud_dex.png',
  destBanner: 'subpkg_images/ui_dest_banner.png',
  home: 'subpkg_images/hud_home.png',
} as const;

export const UI_BTN = {
  terracotta: 'subpkg_images/ui_btn_terracotta.png',
  cream: 'subpkg_images/ui_btn_cream.png',
  wood: 'subpkg_images/ui_btn_wood.png',
} as const;

const _btnSlices = new Map<string, { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture }>();

function buttonSlices(path: string): { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture } | null {
  const hit = _btnSlices.get(path);
  if (hit) return hit;
  const tex = gameTexture(path);
  if (!isTextureReady(tex)) return null;
  const cap = Math.min(Math.floor(tex.height * 0.5), Math.floor(tex.width * 0.34));
  const midW = Math.max(1, tex.width - cap * 2);
  const slices = {
    left: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(0, 0, cap, tex.height)),
    mid: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(cap, 0, midW, tex.height)),
    right: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tex.width - cap, 0, cap, tex.height)),
  };
  _btnSlices.set(path, slices);
  return slices;
}

/** 冰箱同款木纹/陶土九切片按钮。 */
export function makeSlicedButton(opts: {
  label: string;
  width: number;
  height?: number;
  skin?: keyof typeof UI_BTN;
  textColor?: number;
  /** 文案相对正中的水平偏移，左边叠图标时把字往右让。 */
  labelOffsetX?: number;
  onReady?: () => void;
}): PIXI.Container {
  const height = opts.height ?? 48;
  const path = UI_BTN[opts.skin ?? 'terracotta'];
  const root = new PIXI.Container();
  whenTextureReady(path, () => opts.onReady?.());
  const slices = buttonSlices(path);
  if (slices) {
    const cap = slices.left.width * (height / slices.left.height);
    const left = new PIXI.Sprite(slices.left);
    left.height = height;
    left.width = cap;
    left.eventMode = 'none';
    const right = new PIXI.Sprite(slices.right);
    right.height = height;
    right.width = cap;
    right.x = opts.width - cap;
    right.eventMode = 'none';
    const mid = new PIXI.Sprite(slices.mid);
    mid.height = height;
    mid.x = cap;
    mid.width = Math.max(1, opts.width - cap * 2);
    mid.eventMode = 'none';
    root.addChild(left, mid, right);
  } else {
    const fills = { terracotta: 0xC46A3A, cream: 0xEFE6D6, wood: 0x8B5A2B };
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, 0x2A2018, 1);
    bg.beginFill(fills[opts.skin ?? 'terracotta']);
    bg.drawRoundedRect(0, 0, opts.width, height, height / 2);
    bg.endFill();
    root.addChild(bg);
  }
  const text = makeLabel(opts.label, Math.min(24, height * 0.42), opts.textColor ?? 0xFFF8F0, { fontWeight: '700' });
  text.anchor.set(0.5);
  text.position.set(opts.width / 2 + (opts.labelOffsetX ?? 0), height / 2 + 1);
  root.addChild(text);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, opts.width, height);
  return root;
}

/** 顶栏动作钮：圆胶囊 + 描边，和厨房奶油条同一套线。 */
export function makeHudButton(
  label: string,
  width: number,
  height = 44,
  fill = 0xC46A3A,
  textColor = 0xFFF8F0,
): PIXI.Container {
  const root = new PIXI.Container();
  const r = height / 2;
  const bg = new PIXI.Graphics();
  bg.lineStyle(2, 0x8B5A2B, 1);
  bg.beginFill(fill);
  bg.drawRoundedRect(0, 0, width, height, r);
  bg.endFill();
  root.addChild(bg);

  const text = makeLabel(label, Math.min(24, height * 0.42), textColor, { fontWeight: '700' });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2);
  root.addChild(text);

  root.eventMode = 'static';
  root.cursor = 'pointer';
  (root as any)._bg = bg;
  (root as any)._label = text;
  (root as any)._w = width;
  (root as any)._h = height;
  (root as any)._fill = fill;
  return root;
}

/** 场景标题用的奶油纸片。 */
export function makePaperChip(
  text: string,
  opts: { size?: number; color?: number } = {},
): PIXI.Container {
  const root = new PIXI.Container();
  const label = makeLabel(text, opts.size ?? 22, opts.color ?? 0x3A3228, { fontWeight: '600' });
  const padX = 18;
  const padY = 8;
  const w = Math.ceil(label.width + padX * 2);
  const h = Math.max(36, Math.ceil(label.height + padY * 2));
  const g = new PIXI.Graphics();
  g.lineStyle(2, 0x8B5A2B, 1);
  g.beginFill(0xF4EFE6);
  g.drawRoundedRect(0, 0, w, h, h / 2);
  g.endFill();
  root.addChild(g);
  label.anchor.set(0.5);
  label.position.set(w / 2, h / 2);
  root.addChild(label);
  root.eventMode = 'none';
  return root;
}
