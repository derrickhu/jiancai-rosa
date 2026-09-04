import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { RARITY_STYLE, type Rarity } from '@/sim/rarity';
import { fitSpriteInBox, gameTexture, imgPath, isTextureReady, itemTexture, whenTextureReady } from './assets';

export const FONT = 'PingFang SC, sans-serif';

/**
 * 格子的稀有度描边：白=普通 / 绿=良品 / 蓝=上品。
 * 外面先描一圈浅色再压本色，奶油底上也分得清白绿蓝。
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

const RARITY_FLARE = 'subpkg_kitchen/ui_pickup_flare.png';

/** 捡到菜时垫在后面的发散光：用收摊那张光晕，按品质染色，叠光。 */
export function makeRarityFlare(rarity: Rarity, size: number): PIXI.Sprite {
  const style = RARITY_STYLE[rarity];
  const flare = new PIXI.Sprite(gameTexture(RARITY_FLARE));
  flare.anchor.set(0.5);
  flare.blendMode = PIXI.BLEND_MODES.ADD;
  flare.tint = style.float;
  flare.alpha = rarity === 'common' ? 0.52 : 0.68;
  flare.width = size;
  flare.height = size;
  flare.rotation = Math.random() * Math.PI * 2;
  flare.eventMode = 'none';
  whenTextureReady(RARITY_FLARE, () => {
    if (flare.destroyed) return;
    flare.texture = gameTexture(RARITY_FLARE);
    flare.width = size;
    flare.height = size;
  });
  return flare;
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

/** 压在图标角上的数量：奶油描边，不那么单薄。 */
export function makeCornerMark(text: string, size = 18, color = 0x3A2416): PIXI.Text {
  return makeLabel(text, size, color, {
    fontFamily: 'PingFang SC, Hiragino Sans GB, sans-serif',
    fontWeight: '700',
    stroke: 0xFFF6E8,
    strokeThickness: Math.max(5, Math.round(size * 0.32)),
    lineJoin: 'round',
    dropShadow: true,
    dropShadowColor: '#2A2018',
    dropShadowAlpha: 0.22,
    dropShadowDistance: 1.2,
    dropShadowAngle: Math.PI / 2,
    dropShadowBlur: 0,
  });
}

/** 格子叠份：奶油描边数量，压在图标右下角。 */
export function makeQtyMark(qty: number, size = 18): PIXI.Text {
  return makeCornerMark(`×${qty}`, size);
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
  attachUiClick(root);
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

/** 人物等级条占位：头像 + 等级 + 经验。后面要挂资料页就点头像。 */
export const PLAYER_LEVEL_HUD = {
  avatar: 88,
  gap: 10,
  barW: 148,
  barH: 26,
  height: 112,
} as const;

export function makePlayerLevelHud(opts: {
  avatar: string;
  level: number;
  text: string;
  fill: number;
  onReady?: () => void;
  onTap?: () => void;
}): PIXI.Container {
  const { avatar, gap, barW, barH } = PLAYER_LEVEL_HUD;
  const root = new PIXI.Container();
  const lift = 12;
  const cx = avatar / 2;
  const cy = cx - lift;
  const r = avatar / 2 - 1;

  const ring = new PIXI.Graphics();
  ring.lineStyle(3, 0x2A2018, 1);
  ring.beginFill(0xE8DFD0);
  ring.drawCircle(cx, cy, r);
  ring.endFill();
  root.addChild(ring);

  whenTextureReady(opts.avatar, () => opts.onReady?.());
  const tex = gameTexture(opts.avatar);
  if (isTextureReady(tex)) {
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawCircle(cx, cy, r - 3);
    mask.endFill();
    const spr = new PIXI.Sprite(tex);
    const side = (r - 3) * 2;
    fitSpriteInBox(spr, side * 1.18, side * 1.18);
    spr.anchor.set(0.5);
    spr.position.set(cx, cy);
    spr.mask = mask;
    spr.eventMode = 'none';
    root.addChild(mask, spr);
  }

  const lvText = makeLabel(`LV.${opts.level}`, 20, 0x2A2018, {
    fontWeight: '700',
    stroke: '#F4EFE6',
    strokeThickness: 4,
    lineJoin: 'round',
  });
  lvText.anchor.set(0.5, 0);
  lvText.position.set(cx, avatar + 1 - lift);
  root.addChild(lvText);

  const barX = avatar + gap;
  const barY = Math.round((avatar - barH) / 2) - 2;
  const rr = barH / 2;
  const outer = new PIXI.Graphics();
  outer.lineStyle(2, 0x8B5A2B, 1);
  outer.beginFill(0xF4EFE6);
  outer.drawRoundedRect(barX, barY, barW, barH, rr);
  outer.endFill();
  root.addChild(outer);
  const inset = 3;
  const inner = new PIXI.Graphics();
  inner.beginFill(0xFFF8F0);
  inner.drawRoundedRect(barX + inset, barY + inset, barW - inset * 2, barH - inset * 2, rr - inset);
  inner.endFill();
  root.addChild(inner);
  const ratio = Math.max(0, Math.min(1, opts.fill));
  const fw = Math.max(8, (barW - inset * 2) * ratio);
  const fill = new PIXI.Graphics();
  fill.beginFill(0xC46A3A, 0.9);
  fill.drawRoundedRect(barX + inset, barY + inset, fw, barH - inset * 2, rr - inset);
  fill.endFill();
  root.addChild(fill);
  const xp = makeLabel(opts.text, 17, 0x2A2018, {
    fontWeight: '700',
    stroke: '#FFF8F0',
    strokeThickness: 3,
    lineJoin: 'round',
  });
  xp.anchor.set(0.5);
  xp.position.set(barX + barW / 2, barY + barH / 2 + 1);
  root.addChild(xp);

  root.eventMode = opts.onTap ? 'static' : 'none';
  if (opts.onTap) {
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, barX + barW, PLAYER_LEVEL_HUD.height);
    bindUiClick(root);
    root.on('pointertap', opts.onTap);
  }
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
  leave: 'subpkg_images/hud_leave.png',
  back: 'subpkg_images/hud_back.png',
  peek: 'subpkg_images/hud_peek.png',
  player: 'subpkg_images/hud_player.png',
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
  /** 自定义按钮皮，优先于 skin。 */
  path?: string;
  textColor?: number;
  /** 文案相对正中的水平偏移，左边叠图标时把字往右让。 */
  labelOffsetX?: number;
  onReady?: () => void;
  /** 卖出等已有专属音的按钮不要再叠通用点击。 */
  silent?: boolean;
}): PIXI.Container {
  const height = opts.height ?? 48;
  const path = opts.path ?? UI_BTN[opts.skin ?? 'terracotta'];
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
  if (!opts.silent) attachUiClick(root);
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
  attachUiClick(root);
  (root as any)._bg = bg;
  (root as any)._label = text;
  (root as any)._w = width;
  (root as any)._h = height;
  (root as any)._fill = fill;
  return root;
}

function drawSparkle(g: PIXI.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  g.beginFill(color, alpha);
  g.moveTo(x, y - r);
  g.lineTo(x + r * 0.28, y - r * 0.28);
  g.lineTo(x + r, y);
  g.lineTo(x + r * 0.28, y + r * 0.28);
  g.lineTo(x, y + r);
  g.lineTo(x - r * 0.28, y + r * 0.28);
  g.lineTo(x - r, y);
  g.lineTo(x - r * 0.28, y - r * 0.28);
  g.closePath();
  g.endFill();
}

function tagAlive(node: PIXI.Container): boolean {
  return !node.destroyed && !!node.parent;
}

/** 第一次见到这味食材：朱红底金字，带一点星光呼吸。 */
export function makeNewFoodTag(size = 24): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const label = makeLabel('新食材', size, 0xFFF3A0, {
    fontFamily: FONT,
    fontWeight: '700',
    dropShadow: true,
    dropShadowColor: '#6A1208',
    dropShadowAlpha: 0.5,
    dropShadowBlur: 0,
    dropShadowDistance: 1.2,
    dropShadowAngle: Math.PI / 2,
  });
  label.anchor.set(0.5);
  const padX = Math.round(size * 0.72);
  const padY = Math.round(size * 0.34);
  const w = Math.ceil(label.width + padX * 2);
  const h = Math.max(Math.round(size * 1.72), Math.ceil(label.height + padY * 2));
  const glow = new PIXI.Graphics();
  glow.beginFill(0xFF6A3A, 0.4);
  glow.drawEllipse(0, 2, w * 0.62, h * 0.78);
  glow.endFill();
  const chip = new PIXI.Graphics();
  chip.lineStyle(Math.max(2, Math.round(size * 0.1)), 0x8B1408, 1);
  chip.beginFill(0xE8332A);
  chip.drawRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  chip.endFill();
  const sparks = new PIXI.Graphics();
  drawSparkle(sparks, -w / 2 + 4, -h * 0.38, size * 0.34, 0xFFF36A, 1);
  drawSparkle(sparks, w / 2 - 3, h * 0.3, size * 0.24, 0xFFE08A, 1);
  sparks.eventMode = 'none';
  root.addChild(glow, chip, sparks, label);
  root.scale.set(1);
  const pulse = (): void => {
    if (!tagAlive(root)) return;
    TweenManager.to({
      target: root.scale,
      props: { x: 1.12, y: 1.12 },
      duration: 0.48,
      ease: Ease.easeOutQuad,
      onComplete: () => {
        if (!tagAlive(root)) return;
        TweenManager.to({
          target: root.scale,
          props: { x: 1, y: 1 },
          duration: 0.48,
          ease: Ease.easeInOutQuad,
          onComplete: pulse,
        });
      },
    });
  };
  const twinkle = (): void => {
    if (!tagAlive(sparks)) return;
    TweenManager.to({
      target: sparks,
      props: { alpha: 0.35 },
      duration: 0.42,
      ease: Ease.easeInOutQuad,
      onComplete: () => {
        if (!tagAlive(sparks)) return;
        TweenManager.to({
          target: sparks,
          props: { alpha: 1 },
          duration: 0.42,
          ease: Ease.easeInOutQuad,
          onComplete: twinkle,
        });
      },
    });
  };
  pulse();
  twinkle();
  return root;
}

/** 摊上菜名：粗体字，不描边。普通白，良品绿，上品蓝。 */
export function makeStallNameTag(
  text: string,
  ink: number,
  opts: { maxWidth?: number } = {},
): PIXI.Text {
  const maxW = opts.maxWidth ?? 0;
  let size = 22;
  const style = (): Partial<PIXI.ITextStyle> => ({
    fontFamily: FONT,
    fontWeight: '700',
  });
  let label = makeLabel(text, size, ink, style());
  if (maxW > 40) {
    while (size > 16 && label.width > maxW) {
      size -= 1;
      label.destroy();
      label = makeLabel(text, size, ink, style());
    }
  }
  return label;
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

/** 任务式奖励条：金币 / 食材直接出图，不套白底。接单和点菜列表共用。 */
export function makeRewardStrip(
  chips: Array<{ icon?: string; itemId?: string; label: string }>,
  onReady?: () => void,
  lead = '',
): PIXI.Container {
  const root = new PIXI.Container();
  let x = 0;
  const h = 44;
  if (lead) {
    const tag = makeLabel(lead, 20, 0xC9B8A4);
    tag.anchor.set(0, 0.5);
    tag.position.set(0, h / 2);
    root.addChild(tag);
    x = Math.ceil(tag.width) + 12;
  }
  for (const chip of chips) {
    const gold = Boolean(chip.icon);
    const label = makeLabel(chip.label, 22, gold ? 0xF2C14D : 0xF4EFE6, { fontWeight: '700' });
    const iconSize = gold ? 36 : 40;
    const hasIcon = Boolean(chip.icon || chip.itemId);
    const cell = new PIXI.Container();
    let cx = 0;
    if (chip.icon) {
      whenTextureReady(chip.icon, () => onReady?.());
      const tex = gameTexture(chip.icon);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, iconSize, iconSize);
        sp.anchor.set(0, 0.5);
        sp.position.set(0, h / 2);
        cell.addChild(sp);
        cx = iconSize + 6;
      }
    } else if (chip.itemId) {
      const path = imgPath(`${chip.itemId}.png`);
      whenTextureReady(path, () => onReady?.());
      const sp = new PIXI.Sprite(itemTexture(chip.itemId));
      fitSpriteInBox(sp, iconSize, iconSize);
      sp.anchor.set(0, 0.5);
      sp.position.set(0, h / 2);
      cell.addChild(sp);
      cx = iconSize + 6;
    }
    label.anchor.set(0, 0.5);
    label.position.set(hasIcon ? cx : 0, h / 2);
    cell.addChild(label);
    cell.position.x = x;
    root.addChild(cell);
    x += Math.ceil((hasIcon ? cx : 0) + label.width) + 16;
  }
  root.eventMode = 'none';
  return root;
}

/** 没有单独音效的按钮，默认播通用点击。 */
export function bindUiClick(root: PIXI.Container): void {
  root.on('pointertap', () => AudioManager.play('ui_click'));
}

function attachUiClick(root: PIXI.Container): void {
  bindUiClick(root);
}

/** 顶栏小喇叭：一点切静音。 */
export function makeMuteButton(size = 44): PIXI.Container {
  const root = new PIXI.Container();
  const paint = (): void => {
    root.removeChildren();
    const muted = AudioManager.isMuted();
    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x8B5A2B, 1);
    g.beginFill(0xFFF8F0);
    g.drawRoundedRect(0, 0, size, size, 12);
    g.endFill();
    const cx = size * 0.38;
    const cy = size * 0.5;
    g.beginFill(0x2A2018);
    g.drawRoundedRect(cx - 10, cy - 5, 8, 10, 2);
    g.moveTo(cx - 2, cy - 5);
    g.lineTo(cx + 7, cy - 11);
    g.lineTo(cx + 7, cy + 11);
    g.lineTo(cx - 2, cy + 5);
    g.closePath();
    g.endFill();
    if (muted) {
      g.lineStyle(3, 0xC46A3A, 1);
      g.moveTo(size * 0.22, size * 0.22);
      g.lineTo(size * 0.78, size * 0.78);
    } else {
      g.lineStyle(2.5, 0x2A2018, 1);
      g.arc(cx + 6, cy, 8, -0.7, 0.7);
      g.arc(cx + 6, cy, 13, -0.7, 0.7);
    }
    root.addChild(g);
  };
  paint();
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, size, size);
  root.on('pointertap', (e) => {
    e.stopPropagation();
    AudioManager.play('ui_click');
    AudioManager.toggleMuted();
    paint();
  });
  return root;
}
