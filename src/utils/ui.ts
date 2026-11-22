import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { RARITY_STYLE, type Rarity } from '@/sim/rarity';
import { buffIconPath, type HudBuff } from '@/sim/dishEffects';
import { fitSpriteInBox, gameTexture, isTextureReady, itemTexture, resolveItemAssetPath, whenTextureReady } from './assets';

export const FONT = 'PingFang SC, Hiragino Sans GB, sans-serif';
export const SERIF_FONT = 'Songti SC, STSong, PingFang SC, serif';

/** 全游戏统一手作木艺 × 暖米宣纸配色板。 */
export const UI_PALETTE = {
  ink: 0x2A2018,
  inkSoft: 0x4A3625,
  muted: 0x7A5C3D,
  walnutDark: 0x523016,
  walnut: 0x86532B,
  walnutLight: 0xB37B4C,
  brass: 0xD9A84E,
  brassBright: 0xF0C96B,
  parchment: 0xFAF2E4,
  ivory: 0xFFFCF6,
  warmCard: 0xFDF5E6,
  recessed: 0xEFE3CF,
  recessedRim: 0xD3BD9D,
  cardBorder: 0xBC9B74,
  cardLip: 0xDFCCB0,
  olive: 0x4A7C44,
  terracotta: 0xC46A3A,
  gold: 0xD89829,
  danger: 0xC6432E,
} as const;

export const UI_KIT = {
  headerRibbon: 'subpkg_kitchen/ui_header_ribbon.png',
  closeRound: 'subpkg_kitchen/ui_close_round.png',
  btnOlive: 'subpkg_kitchen/ui_btn_olive.png',
  btnGold: 'subpkg_kitchen/ui_btn_gold.png',
} as const;

/**
 * 格子的稀有度描边：收敛原本粗艳荧光框，改为精致深棕外框 + 品质柔和内边与左上角品质小圆点。
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
  const r = opts.radius ?? 11;
  const accent = rarity === 'legendary'
    ? 0x8256A8
    : rarity === 'epic'
      ? 0x4E82AC
      : rarity === 'rare'
        ? 0x5B9452
        : 0xC8B08E;
  g.lineStyle(opts.thick ? 2.4 : 1.6, accent, rarity === 'common' ? 0.55 : 0.92);
  g.drawRoundedRect(x, y, w, h, r);
  if (rarity !== 'common') {
    g.lineStyle(0);
    g.beginFill(accent, 0.95);
    g.drawCircle(x + 8, y + 8, 3.2);
    g.endFill();
  }
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
    fontFamily: FONT,
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
    fontFamily: FONT,
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

function shadeColor(hex: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

/** 按压反馈只动内部 face 层，保持外层 root 的坐标与包围盒不变，避免影响新手引导聚光框。 */
function attachFacePress(root: PIXI.Container, face: PIXI.Container): void {
  const reset = (): void => {
    face.y = 0;
    face.alpha = 1;
  };
  root.on('pointerdown', () => {
    face.y = 2;
    face.alpha = 0.94;
  });
  root.on('pointerup', reset);
  root.on('pointerupoutside', reset);
  root.on('pointercancel', reset);
}

function paintBeveledRectButton(bg: PIXI.Graphics, width: number, height: number, fill: number, radius = 14): void {
  bg.clear();
  const r = Math.min(radius, height / 2);
  // Soft drop shadow
  bg.beginFill(0x1E120A, 0.20);
  bg.drawRoundedRect(0, 3, width, height, r);
  bg.endFill();
  // Outer crisp ink + 3D bottom lip
  bg.lineStyle(2.5, UI_PALETTE.ink, 1);
  bg.beginFill(shadeColor(fill, 0.74), 1);
  bg.drawRoundedRect(0, 0, width, height, r);
  bg.endFill();
  // Main top face
  const faceH = Math.max(10, height - 4);
  bg.lineStyle(0);
  bg.beginFill(fill, 1);
  bg.drawRoundedRect(2, 2, width - 4, faceH - 1, Math.max(4, r - 2));
  bg.endFill();
  // Subtle top highlight
  bg.beginFill(0xFFFFFF, 0.22);
  bg.drawRoundedRect(6, 4, Math.max(8, width - 12), Math.max(4, Math.round(faceH * 0.28)), Math.max(2, r - 4));
  bg.endFill();
}

export function makeButton(
  label: string,
  width: number,
  height: number,
  fill = 0xC46A3A,
  textColor = 0xFFF8F0,
): PIXI.Container {
  const root = new PIXI.Container();
  const anchorPad = new PIXI.Graphics();
  anchorPad.beginFill(0x000000, 0.001);
  anchorPad.drawRect(0, 0, width, height);
  anchorPad.endFill();
  anchorPad.eventMode = 'none';
  root.addChild(anchorPad);

  const face = new PIXI.Container();
  face.eventMode = 'none';
  root.addChild(face);

  const bg = new PIXI.Graphics();
  paintBeveledRectButton(bg, width, height, fill, Math.min(16, Math.round(height * 0.34)));
  face.addChild(bg);

  const isLightText = textColor >= 0xD00000;
  const text = makeLabel(label, Math.min(26, Math.round(height * 0.42)), textColor, {
    fontWeight: '700',
    ...(isLightText
      ? { stroke: UI_PALETTE.ink, strokeThickness: 3, lineJoin: 'round' }
      : {}),
  });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2 - 1);
  face.addChild(text);

  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, width, height);
  attachFacePress(root, face);
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
  paintBeveledRectButton(bg, w, h, fill, Math.min(16, Math.round(h * 0.34)));
}

/** 顶栏货币/体力条：厚描边木艺奶油胶囊 + 双层高光进度条 + 立体加号章。 */
export function makeStatPill(opts: {
  icon?: string;
  text: string;
  width: number;
  height?: number;
  fill?: number;
  fillColor?: number;
  plus?: boolean;
  pulsePlus?: boolean;
  onTap?: () => void;
  onIconReady?: () => void;
}): PIXI.Container {
  const height = opts.height ?? 44;
  const root = new PIXI.Container();
  const iconPad = opts.icon ? 22 : 0;
  const barX = iconPad;
  const barW = opts.width - iconPad;
  const r = height / 2;

  const shell = new PIXI.Graphics();
  // Drop shadow
  shell.beginFill(0x1A1008, 0.24);
  shell.drawRoundedRect(barX, 3, barW, height, r);
  shell.endFill();
  // Crisp outer ink + warm walnut bevel rim
  shell.lineStyle(2.5, UI_PALETTE.ink, 1);
  shell.beginFill(0xDFCAA9, 1);
  shell.drawRoundedRect(barX, 0, barW, height, r);
  shell.endFill();
  // Warm cream inner track
  const inset = 3.5;
  shell.lineStyle(1, 0xCFAF85, 0.8);
  shell.beginFill(0xFFFDF8, 1);
  shell.drawRoundedRect(barX + inset, inset - 0.5, barW - inset * 2, height - inset * 2 - 1, r - inset);
  shell.endFill();
  root.addChild(shell);

  if (opts.fill != null) {
    const ratio = Math.max(0, Math.min(1, opts.fill));
    if (ratio > 0) {
      const fx = barX + inset + 1;
      const fy = inset + 0.5;
      const fh = height - inset * 2 - 3;
      const fw = Math.max(10, (barW - (inset + 1) * 2) * ratio);
      const baseCol = opts.fillColor ?? 0x67A35D;
      const fill = new PIXI.Graphics();
      fill.beginFill(baseCol, 0.95);
      fill.drawRoundedRect(fx, fy, fw, fh, fh / 2);
      fill.endFill();
      fill.beginFill(0xFFFFFF, 0.25);
      fill.drawRoundedRect(fx + 3, fy + 2, Math.max(4, fw - 6), Math.max(3, fh * 0.36), fh / 4);
      fill.endFill();
      root.addChild(fill);
    }
  }

  const label = makeLabel(opts.text, 21, UI_PALETTE.ink, {
    fontWeight: '700',
    stroke: 0xFFFDF8,
    strokeThickness: 3.5,
    lineJoin: 'round',
  });
  label.anchor.set(0.5);
  const textShift = opts.plus ? (opts.icon ? -5 : -12) : (opts.icon ? 8 : 0);
  label.position.set(barX + barW / 2 + textShift, height / 2 - 0.5);
  root.addChild(label);

  if (opts.plus) {
    const plusWrap = new PIXI.Container();
    plusWrap.position.set(opts.width - 18, height / 2);
    plusWrap.eventMode = 'none';
    const g = new PIXI.Graphics();
    const base = opts.pulsePlus ? 0xE24B3A : 0xCC6D3B;
    g.beginFill(0x1A1008, 0.24);
    g.drawCircle(0, 2.5, 15.5);
    g.endFill();
    g.lineStyle(2.5, UI_PALETTE.ink, 1);
    g.beginFill(base, 1);
    g.drawCircle(0, 0, 15);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(0xFFFFFF, 0.28);
    g.drawEllipse(0, -5, 9, 4);
    g.endFill();
    g.beginFill(0xFFF8F0, 1);
    g.drawRoundedRect(-7, -2, 14, 4, 2);
    g.drawRoundedRect(-2, -7, 4, 14, 2);
    g.endFill();
    plusWrap.addChild(g);
    root.addChild(plusWrap);
    if (opts.pulsePlus) {
      const pulse = (): void => {
        if (!tagAlive(plusWrap)) return;
        TweenManager.to({
          target: plusWrap.scale,
          props: { x: 1.18, y: 1.18 },
          duration: 0.42,
          ease: Ease.easeOutQuad,
          onComplete: () => {
            if (!tagAlive(plusWrap)) return;
            TweenManager.to({
              target: plusWrap.scale,
              props: { x: 1, y: 1 },
              duration: 0.42,
              ease: Ease.easeInOutQuad,
              onComplete: pulse,
            });
          },
        });
      };
      pulse();
    }
  }

  if (opts.icon) {
    const tex = gameTexture(opts.icon);
    whenTextureReady(opts.icon, () => opts.onIconReady?.());
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 52, 52);
      sp.anchor.set(0.5);
      sp.position.set(24, height / 2);
      sp.eventMode = 'none';
      root.addChild(sp);
    }
  }

  if (opts.onTap) {
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, -4, opts.width + 6, height + 8);
    root.on('pointerdown', (e) => e.stopPropagation());
    root.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      opts.onTap?.();
    });
  } else {
    root.eventMode = 'none';
  }
  return root;
}

/** 人物等级条：双层铜扣木艺头像章 + 镶边等级铭牌 + 经验条。 */
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

  // Experience bar tucked cleanly behind the right edge of the avatar medallion
  const barX = avatar + gap - 8;
  const barY = Math.round((avatar - barH) / 2) - 4;
  const barActualW = barW + 8;
  const rr = barH / 2;
  const barG = new PIXI.Graphics();
  barG.beginFill(0x1A1008, 0.24);
  barG.drawRoundedRect(barX, barY + 3, barActualW, barH, rr);
  barG.endFill();
  barG.lineStyle(2.5, UI_PALETTE.ink, 1);
  barG.beginFill(0xDFCAA9, 1);
  barG.drawRoundedRect(barX, barY, barActualW, barH, rr);
  barG.endFill();
  const inset = 3;
  barG.lineStyle(0);
  barG.beginFill(0xFFFDF8, 1);
  barG.drawRoundedRect(barX + inset, barY + inset, barActualW - inset * 2, barH - inset * 2, rr - inset);
  barG.endFill();
  const ratio = Math.max(0, Math.min(1, opts.fill));
  if (ratio > 0) {
    const fw = Math.max(10, (barActualW - inset * 2) * ratio);
    barG.beginFill(0xCC6D3B, 0.95);
    barG.drawRoundedRect(barX + inset, barY + inset, fw, barH - inset * 2, rr - inset);
    barG.endFill();
    barG.beginFill(0xFFFFFF, 0.26);
    barG.drawRoundedRect(barX + inset + 3, barY + inset + 1.5, Math.max(4, fw - 6), 6, 3);
    barG.endFill();
  }
  root.addChild(barG);

  const xp = makeLabel(opts.text, 16, UI_PALETTE.ink, {
    fontWeight: '700',
    stroke: 0xFFFDF8,
    strokeThickness: 3,
    lineJoin: 'round',
  });
  xp.anchor.set(0.5);
  xp.position.set(barX + barActualW / 2 + 3, barY + barH / 2);
  root.addChild(xp);

  // Double-rimmed brass & walnut avatar frame
  const ring = new PIXI.Graphics();
  ring.beginFill(0x1A1008, 0.28);
  ring.drawCircle(cx, cy + 3.5, r + 1);
  ring.endFill();
  ring.lineStyle(3, UI_PALETTE.ink, 1);
  ring.beginFill(UI_PALETTE.brass, 1);
  ring.drawCircle(cx, cy, r);
  ring.endFill();
  ring.lineStyle(1.5, 0x6E441E, 0.9);
  ring.beginFill(0xF6EBDA, 1);
  ring.drawCircle(cx, cy, r - 4.5);
  ring.endFill();
  root.addChild(ring);

  whenTextureReady(opts.avatar, () => opts.onReady?.());
  const tex = gameTexture(opts.avatar);
  if (isTextureReady(tex)) {
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawCircle(cx, cy, r - 5.5);
    mask.endFill();
    const spr = new PIXI.Sprite(tex);
    const side = (r - 5.5) * 2;
    fitSpriteInBox(spr, side * 1.18, side * 1.18);
    spr.anchor.set(0.5);
    spr.position.set(cx, cy);
    spr.mask = mask;
    spr.eventMode = 'none';
    root.addChild(mask, spr);
  }

  // Framed walnut-and-brass LV capsule tucked at bottom of avatar
  const lvW = 66;
  const lvH = 23;
  const lvX = Math.round(cx - lvW / 2);
  const lvY = Math.round(cy + r - 12);
  const lvPlate = new PIXI.Graphics();
  lvPlate.beginFill(0x1A1008, 0.25);
  lvPlate.drawRoundedRect(lvX, lvY + 2, lvW, lvH, lvH / 2);
  lvPlate.endFill();
  lvPlate.lineStyle(2, UI_PALETTE.ink, 1);
  lvPlate.beginFill(UI_PALETTE.walnutDark, 1);
  lvPlate.drawRoundedRect(lvX, lvY, lvW, lvH, lvH / 2);
  lvPlate.endFill();
  lvPlate.lineStyle(1, UI_PALETTE.brassBright, 0.85);
  lvPlate.drawRoundedRect(lvX + 2, lvY + 2, lvW - 4, lvH - 4, (lvH - 4) / 2);
  root.addChild(lvPlate);

  const lvText = makeLabel(`LV.${opts.level}`, 15, 0xFFF8E8, {
    fontWeight: '700',
  });
  lvText.anchor.set(0.5);
  lvText.position.set(cx, lvY + lvH / 2);
  root.addChild(lvText);

  root.eventMode = opts.onTap ? 'static' : 'none';
  if (opts.onTap) {
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, barX + barActualW, PLAYER_LEVEL_HUD.height);
    bindUiClick(root);
    root.on('pointertap', opts.onTap);
  }
  return root;
}

/** 顶栏厨艺：左侧铜金圆章等级，右侧经验条。 */
export function makeCookSkillPill(opts: {
  level: number;
  text: string;
  width: number;
  fill: number;
  height?: number;
}): PIXI.Container {
  const height = opts.height ?? 44;
  const root = new PIXI.Container();
  const badge = 42;
  const barX = 18;
  const barW = opts.width - barX;
  const r = height / 2;

  const outer = new PIXI.Graphics();
  outer.beginFill(0x1A1008, 0.22);
  outer.drawRoundedRect(barX, 3, barW, height, r);
  outer.endFill();
  outer.lineStyle(2.5, UI_PALETTE.ink, 1);
  outer.beginFill(0xDFCAA9, 1);
  outer.drawRoundedRect(barX, 0, barW, height, r);
  outer.endFill();

  const inset = 3.5;
  outer.lineStyle(0);
  outer.beginFill(0xFFFDF8, 1);
  outer.drawRoundedRect(barX + inset, inset, barW - inset * 2, height - inset * 2, r - inset);
  outer.endFill();
  root.addChild(outer);

  const ratio = Math.max(0, Math.min(1, opts.fill));
  if (ratio > 0) {
    const fw = Math.max(8, (barW - inset * 2) * ratio);
    const fill = new PIXI.Graphics();
    fill.beginFill(0xCC6D3B, 0.92);
    fill.drawRoundedRect(barX + inset, inset, fw, height - inset * 2, r - inset);
    fill.endFill();
    fill.beginFill(0xFFFFFF, 0.22);
    fill.drawRoundedRect(barX + inset + 3, inset + 2, Math.max(4, fw - 6), 6, 3);
    fill.endFill();
    root.addChild(fill);
  }

  const label = makeLabel(opts.text, 18, UI_PALETTE.ink, {
    fontWeight: '700',
    stroke: 0xFFFDF8,
    strokeThickness: 3,
  });
  label.anchor.set(0.5);
  label.position.set(barX + barW / 2 + 6, height / 2);
  root.addChild(label);

  const disc = new PIXI.Graphics();
  disc.lineStyle(2.8, UI_PALETTE.ink, 1);
  disc.beginFill(0xF2C14D, 1);
  disc.drawCircle(badge / 2, height / 2, badge / 2 - 1);
  disc.endFill();
  disc.lineStyle(1.2, 0xFFF5C8, 0.85);
  disc.drawCircle(badge / 2, height / 2, badge / 2 - 4.5);
  root.addChild(disc);

  const lv = makeLabel(`${opts.level}`, opts.level >= 10 ? 16 : 20, UI_PALETTE.ink, { fontWeight: '700' });
  lv.anchor.set(0.5);
  lv.position.set(badge / 2, height / 2);
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
  gameClub: 'subpkg_images/hud_gameclub.png',
  dailyMenu: 'subpkg_images/hud_table.png',
  gacha: 'subpkg_images/hud_gacha.png',
  ticket: 'subpkg_images/hud_ticket.png',
  destBanner: 'subpkg_images/ui_dest_banner.png',
  home: 'subpkg_images/hud_home.png',
  leave: 'subpkg_images/hud_leave.png',
  back: 'subpkg_images/hud_back.png',
  peek: 'subpkg_images/hud_peek.png',
  player: 'subpkg_kitchen/hud_player.png',
  exp: 'subpkg_images/hud_exp.png',
} as const;

/** 全量本地包内置 5 色立体胶囊按钮，零加载闪烁。 */
export const UI_BTN = {
  terracotta: 'subpkg_kitchen/ui_fridge_btn_terracotta.png',
  cream: 'subpkg_kitchen/ui_fridge_btn_cream.png',
  wood: 'subpkg_kitchen/ui_fridge_btn_wood.png',
  olive: UI_KIT.btnOlive,
  gold: UI_KIT.btnGold,
} as const;

const _btnSlices = new Map<string, { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture }>();

function threeSlices(path: string, capFrac = 0.34, halfCap = true): { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture } | null {
  const key = `${path}|${capFrac}`;
  const hit = _btnSlices.get(key);
  if (hit) return hit;
  const tex = gameTexture(path);
  if (!isTextureReady(tex)) return null;
  const cap = halfCap
    ? Math.min(Math.floor(tex.height * 0.5), Math.floor(tex.width * capFrac))
    : Math.floor(tex.width * capFrac);
  const midW = Math.max(1, tex.width - cap * 2);
  const slices = {
    left: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(0, 0, cap, tex.height)),
    mid: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(cap, 0, midW, tex.height)),
    right: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tex.width - cap, 0, cap, tex.height)),
  };
  _btnSlices.set(key, slices);
  return slices;
}

/** 手绘五色木纹/陶土/青榄/琥珀金/奶油三切片按钮（含按压微弹反馈）。 */
export function makeSlicedButton(opts: {
  label: string;
  width: number;
  height?: number;
  skin?: keyof typeof UI_BTN;
  /** 自定义按钮皮，优先于 skin。 */
  path?: string;
  textColor?: number;
  fontSize?: number;
  /** 文案相对正中的水平偏移，左边叠图标时把字往右让。 */
  labelOffsetX?: number;
  onReady?: () => void;
  /** 卖出等已有专属音的按钮不要再叠通用点击。 */
  silent?: boolean;
}): PIXI.Container {
  const height = opts.height ?? 48;
  const skin = opts.skin ?? 'terracotta';
  const path = opts.path ?? UI_BTN[skin];
  const root = new PIXI.Container();

  // Invisible bounds keeper so root bounds never shift during press animation
  const anchorPad = new PIXI.Graphics();
  anchorPad.beginFill(0x000000, 0.001);
  anchorPad.drawRect(0, 0, opts.width, height);
  anchorPad.endFill();
  anchorPad.eventMode = 'none';
  root.addChild(anchorPad);

  const face = new PIXI.Container();
  face.eventMode = 'none';
  root.addChild(face);

  whenTextureReady(path, () => opts.onReady?.());
  const slices = threeSlices(path);
  if (slices) {
    const cap = Math.min(opts.width * 0.46, slices.left.width * (height / slices.left.height));
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
    face.addChild(left, mid, right);
  } else {
    const fills: Record<keyof typeof UI_BTN, number> = {
      terracotta: 0xC46A3A,
      cream: 0xEFE6D6,
      wood: 0x8B5A2B,
      olive: 0x558B4A,
      gold: 0xE2A63B,
    };
    const bg = new PIXI.Graphics();
    paintBeveledRectButton(bg, opts.width, height, fills[skin], height / 2);
    face.addChild(bg);
  }

  const defaultTextCol = skin === 'cream'
    ? 0x4A3420
    : skin === 'gold'
      ? 0x3A220E
      : 0xFFF8F0;
  const finalCol = opts.textColor ?? defaultTextCol;
  const lightText = finalCol >= 0xD00000;
  const fSize = opts.fontSize ?? Math.min(24, Math.max(17, Math.round(height * 0.43)));
  const text = makeLabel(opts.label, fSize, finalCol, {
    fontWeight: '700',
    ...(lightText
      ? {
        stroke: skin === 'olive' ? 0x1F3D1B : skin === 'gold' ? 0x5A350C : UI_PALETTE.ink,
        strokeThickness: 3,
        lineJoin: 'round',
      }
      : skin === 'gold'
        ? { stroke: 0xFFF3CE, strokeThickness: 2.5, lineJoin: 'round' }
        : {}),
  });
  const offsetX = opts.labelOffsetX ?? 0;
  const maxTextW = Math.max(36, opts.width - Math.abs(offsetX) * 2 - 26);
  if (text.width > maxTextW) {
    text.scale.set(maxTextW / text.width);
  }
  text.anchor.set(0.5);
  text.position.set(opts.width / 2 + offsetX, height / 2 - 1);
  face.addChild(text);

  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, opts.width, height);
  attachFacePress(root, face);
  if (!opts.silent) attachUiClick(root);
  (root as any)._label = text;
  (root as any)._face = face;
  return root;
}

/** 顶栏动作钮：立体圆胶囊 + 描边，和厨房奶油条同一套线。 */
export function makeHudButton(
  label: string,
  width: number,
  height = 44,
  fill = 0xC46A3A,
  textColor = 0xFFF8F0,
): PIXI.Container {
  const root = new PIXI.Container();
  const anchorPad = new PIXI.Graphics();
  anchorPad.beginFill(0x000000, 0.001);
  anchorPad.drawRect(0, 0, width, height);
  anchorPad.endFill();
  anchorPad.eventMode = 'none';
  root.addChild(anchorPad);

  const face = new PIXI.Container();
  face.eventMode = 'none';
  root.addChild(face);

  const bg = new PIXI.Graphics();
  paintBeveledRectButton(bg, width, height, fill, height / 2);
  face.addChild(bg);

  const lightText = textColor >= 0xD00000;
  const text = makeLabel(label, Math.min(23, Math.round(height * 0.42)), textColor, {
    fontWeight: '700',
    ...(lightText ? { stroke: UI_PALETTE.ink, strokeThickness: 3, lineJoin: 'round' } : {}),
  });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2 - 1);
  face.addChild(text);

  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, width, height);
  attachFacePress(root, face);
  attachUiClick(root);
  (root as any)._bg = bg;
  (root as any)._label = text;
  (root as any)._w = width;
  (root as any)._h = height;
  (root as any)._fill = fill;
  return root;
}

/** 统一陶土铜圈圆关闭钮。 */
export function makeCloseButton(opts: {
  size?: number;
  onTap: () => void;
  onReady?: () => void;
  silent?: boolean;
}): PIXI.Container {
  const size = opts.size ?? 48;
  const root = new PIXI.Container();

  const anchorPad = new PIXI.Graphics();
  anchorPad.beginFill(0x000000, 0.001);
  anchorPad.drawRect(0, 0, size, size);
  anchorPad.endFill();
  anchorPad.eventMode = 'none';
  root.addChild(anchorPad);

  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x160E08, 0.28);
  shadow.drawCircle(size / 2, size / 2 + 3, size * 0.46);
  shadow.endFill();
  shadow.eventMode = 'none';
  root.addChild(shadow);

  const face = new PIXI.Container();
  face.eventMode = 'none';
  root.addChild(face);

  whenTextureReady(UI_KIT.closeRound, () => opts.onReady?.());
  const tex = gameTexture(UI_KIT.closeRound);
  if (isTextureReady(tex)) {
    const sp = new PIXI.Sprite(tex);
    fitSpriteInBox(sp, size, size);
    sp.anchor.set(0.5);
    sp.position.set(size / 2, size / 2);
    face.addChild(sp);
  } else {
    const g = new PIXI.Graphics();
    g.lineStyle(2.8, UI_PALETTE.ink, 1);
    g.beginFill(UI_PALETTE.brass, 1);
    g.drawCircle(size / 2, size / 2, size * 0.46);
    g.endFill();
    g.lineStyle(1.5, UI_PALETTE.ink, 0.85);
    g.beginFill(0xC95A35, 1);
    g.drawCircle(size / 2, size / 2, size * 0.37);
    g.endFill();
    const xTxt = makeLabel('×', Math.round(size * 0.56), 0xFFF8F0, {
      fontWeight: '700',
      stroke: UI_PALETTE.ink,
      strokeThickness: 3,
    });
    xTxt.anchor.set(0.5);
    xTxt.position.set(size / 2, size / 2 - 1);
    face.addChild(g, xTxt);
  }

  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(-8, -8, size + 16, size + 16);
  attachFacePress(root, face);
  root.on('pointertap', (e) => {
    e.stopPropagation();
    if (!opts.silent) AudioManager.play('ui_click');
    opts.onTap();
  });
  return root;
}

/** 雕花胡桃木铜钉横匾（三切片保真花边，适配任意宽度）。 */
export function makeHeaderRibbon(opts: {
  title: string;
  width: number;
  height?: number;
  fontSize?: number;
  onReady?: () => void;
}): PIXI.Container {
  const height = opts.height ?? 68;
  const root = new PIXI.Container();
  root.eventMode = 'none';

  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x180E07, 0.28);
  shadow.drawRoundedRect(8, 5, opts.width - 16, height - 4, 16);
  shadow.endFill();
  root.addChild(shadow);

  whenTextureReady(UI_KIT.headerRibbon, () => opts.onReady?.());
  const slices = threeSlices(UI_KIT.headerRibbon, 0.19, false);
  if (slices) {
    const cap = Math.min(opts.width * 0.34, slices.left.width * (height / slices.left.height));
    const left = new PIXI.Sprite(slices.left);
    left.height = height;
    left.width = cap;
    const right = new PIXI.Sprite(slices.right);
    right.height = height;
    right.width = cap;
    right.x = opts.width - cap;
    const mid = new PIXI.Sprite(slices.mid);
    mid.height = height;
    mid.x = cap;
    mid.width = Math.max(1, opts.width - cap * 2);
    root.addChild(left, mid, right);
  } else {
    const fb = new PIXI.Graphics();
    fb.lineStyle(3, UI_PALETTE.ink, 1);
    fb.beginFill(UI_PALETTE.walnutDark, 1);
    fb.drawRoundedRect(0, 0, opts.width, height, 18);
    fb.endFill();
    fb.lineStyle(0);
    fb.beginFill(UI_PALETTE.walnut, 1);
    fb.drawRoundedRect(3, 3, opts.width - 6, height - 9, 15);
    fb.endFill();
    fb.lineStyle(1.8, UI_PALETTE.brassBright, 0.9);
    fb.drawRoundedRect(9, 8, opts.width - 18, height - 18, 11);
    root.addChild(fb);
  }

  const titleTxt = makeLabel(opts.title, opts.fontSize ?? Math.min(31, Math.round(height * 0.46)), 0xFFF8EC, {
    fontFamily: SERIF_FONT,
    fontWeight: '700',
    stroke: 0x261509,
    strokeThickness: 5,
    lineJoin: 'round',
    dropShadow: true,
    dropShadowColor: '#160B04',
    dropShadowAlpha: 0.45,
    dropShadowDistance: 1.5,
    dropShadowAngle: Math.PI / 2,
    dropShadowBlur: 0,
  });
  titleTxt.anchor.set(0.5);
  titleTxt.position.set(opts.width / 2, height / 2 - 2);
  root.addChild(titleTxt);
  return root;
}

function drawOliveSprig(g: PIXI.Graphics, x: number, y: number, dir: 1 | -1, color: number): void {
  g.lineStyle(1.6, color, 0.9);
  g.moveTo(x, y);
  g.lineTo(x + dir * 18, y);
  g.lineStyle(0);
  g.beginFill(color, 0.88);
  g.moveTo(x + dir * 21, y);
  g.lineTo(x + dir * 15, y - 2.6);
  g.lineTo(x + dir * 13, y);
  g.lineTo(x + dir * 15, y + 2.6);
  g.closePath();
  for (const ox of [5, 11]) {
    const lx = x + dir * ox;
    g.moveTo(lx + dir * 4.5, y - 5);
    g.lineTo(lx + dir * 0.5, y - 3.6);
    g.lineTo(lx, y - 0.6);
    g.lineTo(lx + dir * 3.8, y - 1.8);
    g.closePath();

    g.moveTo(lx + dir * 4.5, y + 5);
    g.lineTo(lx + dir * 0.5, y + 3.6);
    g.lineTo(lx, y + 0.6);
    g.lineTo(lx + dir * 3.8, y + 1.8);
    g.closePath();
  }
  g.endFill();
}

/** 橄榄枝手作分割标题条（🌿 ── 标题 ── 🌿，对齐精品模拟经营菜单排版）。 */
export function makeOrnamentalDivider(
  width: number,
  label: string,
  opts: { fontSize?: number; color?: number } = {},
): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const inkColor = opts.color ?? UI_PALETTE.inkSoft;
  const sprigColor = 0x8B6D4E;
  const txt = makeLabel(label, opts.fontSize ?? 18, inkColor, { fontWeight: '700' });
  txt.anchor.set(0.5);
  txt.position.set(width / 2, 0);
  const halfText = Math.ceil(txt.width / 2) + 12;
  const sprigSpan = 24;
  const g = new PIXI.Graphics();

  if (width / 2 - halfText > sprigSpan + 8) {
    const leftSprigX = width / 2 - halfText - 4;
    const rightSprigX = width / 2 + halfText + 4;
    drawOliveSprig(g, leftSprigX, 0, -1, sprigColor);
    drawOliveSprig(g, rightSprigX, 0, 1, sprigColor);

    const lineOuterPad = 10;
    const leftLineEnd = leftSprigX - sprigSpan - 4;
    const rightLineStart = rightSprigX + sprigSpan + 4;
    if (leftLineEnd > lineOuterPad + 12) {
      g.lineStyle(1.5, 0xC6AD8B, 0.85);
      g.moveTo(lineOuterPad, 0);
      g.lineTo(leftLineEnd, 0);
      g.moveTo(rightLineStart, 0);
      g.lineTo(width - lineOuterPad, 0);
    }
  }
  root.addChild(g, txt);
  return root;
}

/** 统一手作木托盘 × 深褐内衬槽 × 暖米主画布弹窗壳（对标精品经营游戏双层画板质感）。 */
export function makeArtisanShell(opts: {
  width: number;
  height: number;
  title?: string;
  ribbonWidth?: number;
  subtitle?: string;
  onClose?: () => void;
  onReady?: () => void;
  closeSilent?: boolean;
}): { shell: PIXI.Container; bodyTop: number; innerX: number; innerW: number } {
  const { width, height } = opts;
  const shell = new PIXI.Container();
  shell.eventMode = 'static';
  shell.hitArea = new PIXI.Rectangle(0, -24, width + 18, height + 32);
  shell.on('pointertap', (e) => e.stopPropagation());

  const frame = new PIXI.Graphics();
  const r = 24;
  // Soft multi-layer drop shadow
  frame.beginFill(0x120A05, 0.18);
  frame.drawRoundedRect(-4, 8, width + 8, height + 8, r + 3);
  frame.endFill();
  frame.beginFill(0x120A05, 0.32);
  frame.drawRoundedRect(0, 6, width, height + 3, r);
  frame.endFill();

  // Outer warm rosewood-terracotta frame with 3D bottom lip
  frame.lineStyle(3.2, UI_PALETTE.ink, 1);
  frame.beginFill(0x5E3422, 1);
  frame.drawRoundedRect(0, 0, width, height, r);
  frame.endFill();

  frame.lineStyle(0);
  frame.beginFill(0x9E5E42, 1);
  frame.drawRoundedRect(3, 3, width - 6, height - 9, r - 2);
  frame.endFill();

  // Top frame highlight bevel
  frame.beginFill(0xC68668, 0.55);
  frame.drawRoundedRect(10, 4, width - 20, 7, 4);
  frame.endFill();

  // Dark espresso recessed mat channel (gives crisp mounted-board contrast around the cream canvas!)
  const matX = 9;
  const matY = 10;
  const matW = width - matX * 2;
  const matH = height - matY - 13;
  frame.lineStyle(2, 0x3E2216, 0.95);
  frame.beginFill(0x693C2B, 1);
  frame.drawRoundedRect(matX, matY, matW, matH, 19);
  frame.endFill();

  // Crisp warm cream parchment board mounted inside the mat
  const ix = 15;
  const iy = 16;
  const iw = width - ix * 2;
  const ih = height - iy - 19;
  const ir = 15;

  frame.lineStyle(2, 0x4A2E1E, 0.92);
  frame.beginFill(0xDFCBB0, 1);
  frame.drawRoundedRect(ix, iy, iw, ih, ir);
  frame.endFill();

  frame.lineStyle(1, 0xFFFDF9, 0.95);
  frame.beginFill(UI_PALETTE.parchment, 1);
  frame.drawRoundedRect(ix + 1.5, iy + 2, iw - 3, ih - 5, ir - 1);
  frame.endFill();

  shell.addChild(frame);

  let bodyTop = iy + 14;
  if (opts.title) {
    const rw = opts.ribbonWidth ?? Math.min(width - 92, Math.max(264, opts.title.length * 40 + 100));
    const ribbon = makeHeaderRibbon({
      title: opts.title,
      width: rw,
      height: 64,
      onReady: opts.onReady,
    });
    ribbon.position.set(Math.round((width - rw) / 2), -18);
    shell.addChild(ribbon);
    bodyTop = 56;
  }

  if (opts.subtitle) {
    const subDiv = makeOrnamentalDivider(iw - 24, opts.subtitle, { fontSize: 16, color: UI_PALETTE.muted });
    subDiv.position.set(ix + 12, bodyTop + 10);
    shell.addChild(subDiv);
    bodyTop += 30;
  }

  if (opts.onClose) {
    const closeBtn = makeCloseButton({
      size: 48,
      onTap: opts.onClose,
      onReady: opts.onReady,
      silent: opts.closeSilent,
    });
    closeBtn.position.set(width - 36, -12);
    shell.addChild(closeBtn);
  }

  return { shell, bodyTop, innerX: ix, innerW: iw };
}

/** 浮雕手作内容卡（清晰深暖棕描边 + 立体底沿 + 可选卡其顶栏条）。 */
export function drawCraftCard(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    radius?: number;
    tone?: 'ivory' | 'warm' | 'gold' | 'olive' | 'muted';
    headerH?: number;
  } = {},
): void {
  const r = opts.radius ?? 14;
  const tone = opts.tone ?? 'ivory';
  const styles = {
    ivory: { face: 0xFFFDF7, lip: 0xD9C4A3, border: 0x7D5D41, head: 0xEFE1C8, headLine: 0xD2BC9B },
    warm: { face: 0xFCF4E4, lip: 0xD6BE99, border: 0x7D5D41, head: 0xECDCBE, headLine: 0xCEB692 },
    gold: { face: 0xFFF8E4, lip: 0xDBAF5E, border: 0x9C6B21, head: 0xF7E4B4, headLine: 0xDFC078 },
    olive: { face: 0xF5FAF0, lip: 0xB4CCA4, border: 0x567B4A, head: 0xE2F0D9, headLine: 0xBFD6B2 },
    muted: { face: 0xF1EAE0, lip: 0xD3C6B3, border: 0x9B8871, head: 0xE6DDD0, headLine: 0xCFC2AE },
  }[tone];

  g.lineStyle(0);
  g.beginFill(0x26160A, 0.08);
  g.drawRoundedRect(x, y + 3, w, h, r);
  g.endFill();

  g.lineStyle(1.8, styles.border, 1);
  g.beginFill(styles.lip, 1);
  g.drawRoundedRect(x, y, w, h, r);
  g.endFill();

  const faceH = Math.max(8, h - 3.5);
  g.lineStyle(0);
  g.beginFill(styles.face, 1);
  g.drawRoundedRect(x + 1.5, y + 1.5, w - 3, faceH - 1, Math.max(4, r - 1.5));
  g.endFill();

  if (opts.headerH && opts.headerH > 8 && opts.headerH < faceH) {
    const hh = opts.headerH;
    const hr = Math.max(4, r - 1.5);
    g.beginFill(styles.head, 1);
    g.drawRoundedRect(x + 1.5, y + 1.5, w - 3, hh, hr);
    g.drawRect(x + 1.5, y + 1.5 + Math.max(0, hh - hr), w - 3, hr);
    g.endFill();
    g.lineStyle(1.2, styles.headLine, 0.95);
    g.moveTo(x + 2, y + 1.5 + hh);
    g.lineTo(x + w - 2, y + 1.5 + hh);
  }

  g.lineStyle(1, 0xFFFFFF, 0.8);
  g.moveTo(x + r, y + 2.5);
  g.lineTo(x + w - r, y + 2.5);
  g.lineStyle(0);
}

/** 凹槽分区托盘（对齐参考图「主菜 / 饮料 / 已选菜品」的嵌入式物品托盘容器）。 */
export function drawSectionTray(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { radius?: number; tone?: 'sand' | 'taupe' | 'sage' } = {},
): void {
  const r = opts.radius ?? 13;
  const palette = {
    sand: { fill: 0xE5D8C0, shadow: 0xCCB99A, border: 0x7A5B40 },
    taupe: { fill: 0xDDD2BE, shadow: 0xC4B69E, border: 0x78624B },
    sage: { fill: 0xDEE8D5, shadow: 0xC1D1B5, border: 0x5E7E53 },
  }[opts.tone ?? 'sand'];

  g.lineStyle(0);
  g.beginFill(0xFFFDF8, 0.85);
  g.drawRoundedRect(x, y + 1.5, w, h, r);
  g.endFill();

  g.lineStyle(1.7, palette.border, 0.92);
  g.beginFill(palette.fill, 1);
  g.drawRoundedRect(x, y, w, h, r);
  g.endFill();

  g.lineStyle(0);
  g.beginFill(palette.shadow, 0.55);
  g.drawRoundedRect(x + 2, y + 1.5, w - 4, Math.min(6, h * 0.18), Math.max(2, r - 2));
  g.endFill();
}

/**
 * 统一高质感立体物品槽（对标参考图：深棕细描边 + 奶油浮雕底垫 + 内衬圆盘光晕 + 空槽静谧凹格）。
 */
export function drawItemSlotBox(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    radius?: number;
    rarity?: Rarity;
    empty?: boolean;
    selected?: boolean;
    dimmed?: boolean;
    medallion?: boolean;
    footerH?: number;
    zoneTone?: 'dry' | 'wet' | 'flex';
  } = {},
): void {
  const r = opts.radius ?? 10;
  if (opts.empty) {
    const emptyFill = opts.zoneTone === 'wet'
      ? 0xBFCFCE
      : opts.zoneTone === 'flex'
        ? 0xDFCFA8
        : 0xCFC3AE;
    const emptyShadow = opts.zoneTone === 'wet'
      ? 0xA3B7B6
      : opts.zoneTone === 'flex'
        ? 0xC9B588
        : 0xBBAE97;
    g.lineStyle(1, 0x9C8A74, 0.38);
    g.beginFill(emptyFill, 0.78);
    g.drawRoundedRect(x, y, w, h, r);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(emptyShadow, 0.45);
    g.drawRoundedRect(x + 1.5, y + 1.5, w - 3, Math.min(5, h * 0.16), Math.max(2, r - 1.5));
    g.endFill();
    return;
  }

  const rarity = opts.rarity ?? 'common';
  const tones = opts.dimmed
    ? { face: 0xEFE7DA, lip: 0xD2C4B0, border: 0x8C7760, plate: 0xE3D7C4, pip: 0 }
    : rarity === 'legendary'
      ? { face: 0xF9F4FC, lip: 0xC9B0DC, border: 0x734E91, plate: 0xEDE2F6, pip: 0x8455AC }
      : rarity === 'epic'
        ? { face: 0xF3F9FD, lip: 0xAACAE0, border: 0x4B7694, plate: 0xDFEFF9, pip: 0x4A89B5 }
        : rarity === 'rare'
          ? { face: 0xF4FAF0, lip: 0xB3CFA6, border: 0x557B48, plate: 0xE2F1DA, pip: 0x5B9450 }
          : { face: 0xFCF5E4, lip: 0xDBC6A2, border: 0x684A32, plate: 0xEFE1C6, pip: 0 };

  const borderCol = opts.selected ? 0xD48A1E : tones.border;
  const borderW = opts.selected ? 2.6 : 1.8;

  g.lineStyle(0);
  g.beginFill(0x241509, 0.10);
  g.drawRoundedRect(x, y + 2, w, h, r);
  g.endFill();

  g.lineStyle(borderW, borderCol, 1);
  g.beginFill(tones.lip, 1);
  g.drawRoundedRect(x, y, w, h, r);
  g.endFill();

  const faceH = Math.max(8, h - 3.5);
  g.lineStyle(0);
  g.beginFill(tones.face, 1);
  g.drawRoundedRect(x + 1.5, y + 1.5, w - 3, faceH - 0.5, Math.max(3, r - 1.5));
  g.endFill();

  g.lineStyle(1, 0xFFFDF9, 0.88);
  g.moveTo(x + r, y + 2.3);
  g.lineTo(x + w - r, y + 2.3);
  g.lineStyle(0);

  const iconAreaH = opts.footerH ? Math.max(18, h - opts.footerH) : h;

  if (opts.medallion !== false && Math.min(w, iconAreaH) >= 38) {
    const rad = Math.min(w, iconAreaH) * 0.36;
    const mcx = x + w / 2;
    const mcy = y + iconAreaH / 2 - 1;
    g.lineStyle(1, tones.lip, 0.55);
    g.beginFill(tones.plate, 0.72);
    g.drawCircle(mcx, mcy, rad);
    g.endFill();
  }

  if (opts.footerH && opts.footerH > 12 && opts.footerH < faceH - 12) {
    const fy = y + h - opts.footerH - 2;
    g.lineStyle(1, tones.lip, 0.85);
    g.moveTo(x + 2, fy);
    g.lineTo(x + w - 2, fy);
    g.lineStyle(0);
    g.beginFill(0xF3E7D1, opts.dimmed ? 0.6 : 0.78);
    g.drawRoundedRect(x + 2, fy + 1, w - 4, opts.footerH - 1, Math.max(3, r - 2));
    g.endFill();
  }

  if (tones.pip) {
    g.lineStyle(0);
    g.beginFill(tones.pip, 0.95);
    g.drawCircle(x + 7.5, y + 7.5, 3);
    g.endFill();
  }
}

/** 格子右下角嵌入式胶囊数字角标（对标参考图 `26` / `42` / `0/2` 干净角标，不再悬空散乱）。 */
export function makeSlotBadge(
  text: string,
  tone: 'olive' | 'lack' | 'gold' | 'ink' = 'ink',
  fontSize = 14,
): { node: PIXI.Container; w: number; h: number } {
  const effSize = Math.max(13, fontSize);
  const palette = {
    olive: { fill: 0x689A4B, border: 0x3F6629, text: 0xFFFDF8 },
    lack: { fill: 0xC85A42, border: 0x7D2E1D, text: 0xFFFDF8 },
    gold: { fill: 0xDF9E28, border: 0x7A4F0B, text: 0xFFFDF8 },
    ink: { fill: 0x6B4E37, border: 0x3B2617, text: 0xFFFDF8 },
  }[tone];

  const node = new PIXI.Container();
  node.eventMode = 'none';
  const lbl = makeLabel(text, effSize, palette.text, { fontWeight: '700' });
  const w = Math.max(24, Math.ceil(lbl.width) + 11);
  const h = Math.max(20, effSize + 6);
  const g = new PIXI.Graphics();
  g.lineStyle(1.5, palette.border, 1);
  g.beginFill(palette.fill, 1);
  g.drawRoundedRect(0, 0, w, h, h / 2);
  g.endFill();
  lbl.anchor.set(0.5);
  lbl.position.set(w / 2, h / 2 - 0.3);
  node.addChild(g, lbl);
  return { node, w, h };
}

/** 柔和内凹亚麻槽（用于空状态、台词气泡、说明文字框）。 */
export function drawRecessedWell(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { radius?: number; pointerTopX?: number } = {},
): void {
  const r = opts.radius ?? 12;
  g.lineStyle(0);
  g.beginFill(0xFFFDF8, 0.9);
  g.drawRoundedRect(x, y + 1.5, w, h, r);
  g.endFill();
  g.lineStyle(1.5, 0xB89A74, 0.95);
  g.beginFill(0xEFE4D0, 1);
  g.drawRoundedRect(x, y, w, h, r);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0xD5C0A0, 0.48);
  g.drawRoundedRect(x + 2, y + 1.5, w - 4, Math.min(5, h * 0.2), Math.max(2, r - 2));
  g.endFill();

  if (opts.pointerTopX != null) {
    const px = opts.pointerTopX;
    g.lineStyle(1.5, 0xB89A74, 0.95);
    g.beginFill(0xEFE4D0, 1);
    g.moveTo(px - 8, y + 1);
    g.lineTo(px, y - 8);
    g.lineTo(px + 8, y + 1);
    g.closePath();
    g.endFill();
    // Cover seam line
    g.lineStyle(0);
    g.beginFill(UI_PALETTE.recessed, 1);
    g.drawRect(px - 7, y, 14, 3);
    g.endFill();
  }
}

/** 双层高光手作进度条（发酵倒计时 / 猫咪亲密 / 小饭桌进度 / 探索度通用）。 */
export function makeCraftProgressBar(opts: {
  width: number;
  height?: number;
  ratio: number;
  scheme?: 'amber' | 'olive' | 'terracotta' | 'rose';
  text?: string;
  fontSize?: number;
}): PIXI.Container {
  const w = opts.width;
  const h = opts.height ?? 20;
  const r = h / 2;
  const ratio = Math.max(0, Math.min(1, opts.ratio));
  const root = new PIXI.Container();
  root.eventMode = 'none';

  const colors = {
    amber: { base: 0xDF9628, sheen: 0xF7C665 },
    olive: { base: 0x57924B, sheen: 0x84BA77 },
    terracotta: { base: 0xC86837, sheen: 0xE59366 },
    rose: { base: 0xD46854, sheen: 0xEE9886 },
  }[opts.scheme ?? 'amber'];

  const g = new PIXI.Graphics();
  // Recessed warm track
  g.lineStyle(1.8, 0x8F6D47, 1);
  g.beginFill(0xE6D6BE, 1);
  g.drawRoundedRect(0, 0, w, h, r);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0xD2BE9F, 0.55);
  g.drawRoundedRect(2, 2, w - 4, Math.max(3, h * 0.34), Math.max(2, r - 2));
  g.endFill();

  if (ratio > 0) {
    const pad = 2.5;
    const fh = h - pad * 2;
    const fw = Math.max(fh, (w - pad * 2) * ratio);
    g.beginFill(colors.base, 1);
    g.drawRoundedRect(pad, pad, fw, fh, fh / 2);
    g.endFill();
    g.beginFill(colors.sheen, 0.55);
    g.drawRoundedRect(pad + 3, pad + 1.5, Math.max(4, fw - 6), Math.max(3, fh * 0.38), fh / 4);
    g.endFill();
  }
  root.addChild(g);

  if (opts.text) {
    const txt = makeLabel(opts.text, opts.fontSize ?? Math.min(16, Math.max(14, h - 3)), UI_PALETTE.ink, {
      fontWeight: '700',
      stroke: 0xFFFDF8,
      strokeThickness: 3,
      lineJoin: 'round',
    });
    txt.anchor.set(0.5);
    txt.position.set(w / 2, h / 2);
    root.addChild(txt);
  }
  return root;
}

/** 厨房左侧功能栏统一手作圆角徽章入口（带木牌底铭与角标）。 */
export function makeSidebarIconBtn(opts: {
  icon?: string;
  customIcon?: PIXI.DisplayObject;
  fallbackText?: string;
  label: string;
  badgeText?: string;
  badgeTone?: 'red' | 'gold';
  highlight?: boolean;
  size?: number;
  onReady?: () => void;
  onTap: () => void;
}): PIXI.Container {
  const size = opts.size ?? 68;
  const totalH = size + 12;
  const root = new PIXI.Container();

  const anchorPad = new PIXI.Graphics();
  anchorPad.beginFill(0x000000, 0.001);
  anchorPad.drawRect(0, 0, size, totalH);
  anchorPad.endFill();
  anchorPad.eventMode = 'none';
  root.addChild(anchorPad);

  const face = new PIXI.Container();
  face.eventMode = 'none';
  root.addChild(face);

  const r = 18;
  const tile = new PIXI.Graphics();
  // Drop shadow
  tile.beginFill(0x180F07, 0.26);
  tile.drawRoundedRect(0, 3.5, size, size, r);
  tile.endFill();
  // Outer ink + 3D bottom rim (golden brass rim if highlighted, e.g. free gacha!)
  tile.lineStyle(2.5, UI_PALETTE.ink, 1);
  tile.beginFill(opts.highlight ? 0xE5B24C : 0xDBC4A2, 1);
  tile.drawRoundedRect(0, 0, size, size, r);
  tile.endFill();
  // Warm cream face
  tile.lineStyle(1, opts.highlight ? 0xFFF3C4 : 0xFFFDF9, 0.9);
  tile.beginFill(opts.highlight ? 0xFFF7DF : 0xFFF9EE, 1);
  tile.drawRoundedRect(2.5, 2.5, size - 5, size - 7, r - 2);
  tile.endFill();
  // Soft warm inner medallion halo behind icon
  tile.lineStyle(0);
  tile.beginFill(opts.highlight ? 0xF7DF9C : 0xF3E4CC, 0.65);
  tile.drawCircle(size / 2, size / 2 - 4, size * 0.34);
  tile.endFill();
  face.addChild(tile);

  if (opts.customIcon) {
    face.addChild(opts.customIcon);
  } else if (opts.icon) {
    whenTextureReady(opts.icon, () => opts.onReady?.());
    const tex = gameTexture(opts.icon);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, size - 14, size - 16);
      sp.anchor.set(0.5);
      sp.position.set(size / 2, size / 2 - 4);
      sp.eventMode = 'none';
      face.addChild(sp);
    } else if (opts.fallbackText) {
      const fb = makeLabel(opts.fallbackText, 24, UI_PALETTE.walnut, { fontWeight: '700' });
      fb.anchor.set(0.5);
      fb.position.set(size / 2, size / 2 - 4);
      face.addChild(fb);
    }
  } else if (opts.fallbackText) {
    const fb = makeLabel(opts.fallbackText, 24, UI_PALETTE.walnut, { fontWeight: '700' });
    fb.anchor.set(0.5);
    fb.position.set(size / 2, size / 2 - 4);
    face.addChild(fb);
  }

  // Integrated roasted-walnut bottom nameplate ribbon
  const plateW = size + 6;
  const plateH = 24;
  const plateX = -3;
  const plateY = size - 10;
  const plate = new PIXI.Graphics();
  plate.lineStyle(2, UI_PALETTE.ink, 1);
  plate.beginFill(UI_PALETTE.walnutDark, 1);
  plate.drawRoundedRect(plateX, plateY, plateW, plateH, plateH / 2);
  plate.endFill();
  plate.lineStyle(1, 0xC69555, 0.72);
  plate.drawRoundedRect(plateX + 2, plateY + 2, plateW - 4, plateH - 4, (plateH - 4) / 2);
  face.addChild(plate);

  const nameTxt = makeLabel(opts.label, 15, 0xFFF8EC, { fontWeight: '700' });
  nameTxt.anchor.set(0.5);
  nameTxt.position.set(size / 2, plateY + plateH / 2);
  face.addChild(nameTxt);

  // Top-right crisp notification badge
  if (opts.badgeText) {
    const isGold = opts.badgeTone === 'gold';
    const bTxt = makeLabel(opts.badgeText, 13, isGold ? UI_PALETTE.ink : 0xFFF8F0, { fontWeight: '700' });
    const bw = Math.max(24, Math.ceil(bTxt.width) + 12);
    const bh = 22;
    const badge = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, UI_PALETTE.ink, 1);
    bg.beginFill(isGold ? 0xF7C948 : 0xE03E2D, 1);
    bg.drawRoundedRect(0, 0, bw, bh, bh / 2);
    bg.endFill();
    bTxt.anchor.set(0.5);
    bTxt.position.set(bw / 2, bh / 2);
    badge.addChild(bg, bTxt);
    badge.position.set(size - bw + 6, -6);
    face.addChild(badge);
  }

  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(-4, -6, size + 8, totalH + 10);
  attachFacePress(root, face);
  root.on('pointertap', (e) => {
    e.stopPropagation();
    AudioManager.play('ui_click');
    opts.onTap();
  });
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

/** 小饭桌 / 街坊点菜正缺这味食材：深松绿底奶油字。 */
export function makeUrgentFoodTag(size = 20): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const label = makeLabel('急需', size, 0xFFF8F0, {
    fontFamily: FONT,
    fontWeight: '700',
    dropShadow: true,
    dropShadowColor: '#163A28',
    dropShadowAlpha: 0.45,
    dropShadowBlur: 0,
    dropShadowDistance: 1,
    dropShadowAngle: Math.PI / 2,
  });
  label.anchor.set(0.5);
  const padX = Math.round(size * 0.62);
  const padY = Math.round(size * 0.28);
  const w = Math.ceil(label.width + padX * 2);
  const h = Math.max(Math.round(size * 1.56), Math.ceil(label.height + padY * 2));
  const chip = new PIXI.Graphics();
  chip.lineStyle(Math.max(2, Math.round(size * 0.1)), 0x163A28, 1);
  chip.beginFill(0x2E6B4E);
  chip.drawRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  chip.endFill();
  root.addChild(chip, label);
  return root;
}

/** 摊上菜名：粗体字，普通白，良品绿，上品蓝。 */
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

/** 场景标题用的立体奶油木纹纸片。 */
export function makePaperChip(
  text: string,
  opts: { size?: number; color?: number } = {},
): PIXI.Container {
  const root = new PIXI.Container();
  const label = makeLabel(text, opts.size ?? 21, opts.color ?? UI_PALETTE.ink, { fontWeight: '700' });
  const padX = 20;
  const padY = 8;
  const w = Math.ceil(label.width + padX * 2);
  const h = Math.max(38, Math.ceil(label.height + padY * 2));
  const g = new PIXI.Graphics();
  g.beginFill(0x1A1008, 0.22);
  g.drawRoundedRect(0, 3, w, h, h / 2);
  g.endFill();
  g.lineStyle(2.4, UI_PALETTE.ink, 1);
  g.beginFill(0xDFC9A8, 1);
  g.drawRoundedRect(0, 0, w, h, h / 2);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0xFFFBF3, 1);
  g.drawRoundedRect(2.5, 2.5, w - 5, h - 6, (h - 6) / 2);
  g.endFill();
  root.addChild(g);
  label.anchor.set(0.5);
  label.position.set(w / 2, h / 2 - 0.5);
  root.addChild(label);
  root.eventMode = 'none';
  return root;
}

/** 任务式奖励条：立体小方片胶囊（对齐参考图已选菜品/赏金标签条）。 */
export function makeRewardStrip(
  chips: Array<{ icon?: string; itemId?: string; label: string }>,
  onReady?: () => void,
  lead = '',
  tone: 'night' | 'paper' = 'night',
): PIXI.Container {
  const root = new PIXI.Container();
  let x = 0;
  const h = 40;
  const ink = tone === 'paper'
    ? { lead: 0x6B4E37, gold: 0x8F5808, item: UI_PALETTE.ink }
    : { lead: 0xC9B8A4, gold: 0xF2C14D, item: 0xF4EFE6 };
  if (lead) {
    if (tone === 'paper') {
      const leadPill = new PIXI.Graphics();
      const tag = makeLabel(lead, 15, 0xFFFDF8, { fontWeight: '700' });
      const lw = Math.ceil(tag.width) + 16;
      leadPill.beginFill(0x7A5B40, 1);
      leadPill.drawRoundedRect(0, 6, lw, 28, 8);
      leadPill.endFill();
      tag.anchor.set(0.5);
      tag.position.set(lw / 2, 20);
      root.addChild(leadPill, tag);
      x = lw + 8;
    } else {
      const tag = makeLabel(lead, 18, ink.lead, { fontWeight: '700' });
      tag.anchor.set(0, 0.5);
      tag.position.set(0, h / 2);
      root.addChild(tag);
      x = Math.ceil(tag.width) + 10;
    }
  }
  for (const chip of chips) {
    const gold = Boolean(chip.icon);
    const label = makeLabel(chip.label, tone === 'paper' ? 18 : 20, gold ? ink.gold : ink.item, { fontWeight: '700' });
    const iconSize = tone === 'paper' ? 28 : (gold ? 34 : 36);
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
        sp.position.set(tone === 'paper' ? 8 : 0, h / 2 - 0.5);
        cell.addChild(sp);
        cx = (tone === 'paper' ? 8 : 0) + iconSize + 5;
      }
    } else if (chip.itemId) {
      const path = resolveItemAssetPath(chip.itemId);
      whenTextureReady(path, () => onReady?.());
      const sp = new PIXI.Sprite(itemTexture(chip.itemId));
      fitSpriteInBox(sp, iconSize, iconSize);
      sp.anchor.set(0, 0.5);
      sp.position.set(tone === 'paper' ? 8 : 0, h / 2 - 0.5);
      cell.addChild(sp);
      cx = (tone === 'paper' ? 8 : 0) + iconSize + 5;
    }
    label.anchor.set(0, 0.5);
    label.position.set(hasIcon ? cx : (tone === 'paper' ? 10 : 0), h / 2 - 0.5);
    const contentW = Math.ceil((hasIcon ? cx : (tone === 'paper' ? 10 : 0)) + label.width + (tone === 'paper' ? 10 : 0));
    if (tone === 'paper') {
      const pill = new PIXI.Graphics();
      pill.lineStyle(1.6, gold ? 0xA87624 : 0x7A5B40, 0.95);
      pill.beginFill(gold ? 0xE2BD6F : 0xDBC6A4, 1);
      pill.drawRoundedRect(0, 2, contentW, h - 4, 8);
      pill.endFill();
      pill.lineStyle(0);
      pill.beginFill(gold ? 0xFFF8E0 : 0xFCF5E6, 1);
      pill.drawRoundedRect(1.5, 3.5, contentW - 3, h - 8.5, 6.5);
      pill.endFill();
      cell.addChildAt(pill, 0);
    }
    cell.addChild(label);
    cell.position.x = x;
    root.addChild(cell);
    x += contentW + 8;
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

/** 顶栏小喇叭：立体木艺奶油方章，一点切静音。 */
export function makeMuteButton(size = 46): PIXI.Container {
  const root = new PIXI.Container();
  const paint = (): void => {
    root.removeChildren();
    const muted = AudioManager.isMuted();
    const g = new PIXI.Graphics();
    g.beginFill(0x180F07, 0.24);
    g.drawRoundedRect(0, 3, size, size, 14);
    g.endFill();
    g.lineStyle(2.5, UI_PALETTE.ink, 1);
    g.beginFill(0xDBC4A2, 1);
    g.drawRoundedRect(0, 0, size, size, 14);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(0xFFF9EE, 1);
    g.drawRoundedRect(2.5, 2.5, size - 5, size - 6.5, 11);
    g.endFill();

    const cx = size * 0.39;
    const cy = size * 0.48;
    g.beginFill(UI_PALETTE.ink);
    g.drawRoundedRect(cx - 9, cy - 5, 7.5, 10, 2);
    g.moveTo(cx - 2, cy - 5);
    g.lineTo(cx + 7, cy - 10.5);
    g.lineTo(cx + 7, cy + 10.5);
    g.lineTo(cx - 2, cy + 5);
    g.closePath();
    g.endFill();
    if (muted) {
      g.lineStyle(3, 0xD24735, 1);
      g.moveTo(size * 0.22, size * 0.22);
      g.lineTo(size * 0.78, size * 0.76);
    } else {
      g.lineStyle(2.4, UI_PALETTE.walnut, 1);
      g.arc(cx + 6, cy, 7.5, -0.7, 0.7);
      g.arc(cx + 6, cy, 12.5, -0.7, 0.7);
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

export const HUD_BUFF = { size: 38, gap: 8, pad: 6 } as const;

export function hudPillsY(profileY: number, pillH = 44): number {
  return profileY + Math.round((PLAYER_LEVEL_HUD.avatar - pillH) / 2);
}

export function hudBuffRowY(pillY: number, pillH = 44): number {
  return pillY + pillH + HUD_BUFF.pad;
}

export function makeHudBuffRow(opts: {
  buffs: readonly HudBuff[];
  onReady?: () => void;
  onTap?: (buff: HudBuff) => void;
}): PIXI.Container {
  const root = new PIXI.Container();
  const size = HUD_BUFF.size;
  opts.buffs.forEach((buff, i) => {
    const path = buffIconPath(buff.icon);
    whenTextureReady(path, () => opts.onReady?.());
    const cell = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x180F07, 0.2);
    bg.drawCircle(size / 2, size / 2 + 2, size / 2);
    bg.endFill();
    bg.lineStyle(2, UI_PALETTE.ink, 0.9);
    bg.beginFill(0xFFF8EB, 0.95);
    bg.drawCircle(size / 2, size / 2, size / 2 - 1);
    bg.endFill();
    cell.addChild(bg);

    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size - 8, size - 8);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2);
      spr.eventMode = 'none';
      cell.addChild(spr);
    }
    cell.position.set(i * (size + HUD_BUFF.gap), 0);
    cell.eventMode = 'static';
    cell.cursor = 'pointer';
    cell.hitArea = new PIXI.Rectangle(0, 0, size, size);
    cell.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      opts.onTap?.(buff);
    });
    root.addChild(cell);
  });
  return root;
}

export const P0_ART = {
  adClapper: 'subpkg_kitchen/ui_ad_clapper.png',
  duskFlashlight: 'subpkg_kitchen/ui_dusk_flashlight.png',
  chefFire: 'subpkg_kitchen/ui_chef_fire.png',
  dexStamp: 'subpkg_kitchen/ui_dex_stamp.png',
  gachaStage: 'subpkg_kitchen/ui_gacha_stage.png',
  spoons: [
    'subpkg_kitchen/ui_spoon_1.png',
    'subpkg_kitchen/ui_spoon_2.png',
    'subpkg_kitchen/ui_spoon_3.png',
  ] as const,
} as const;

export const P2_ART = {
  pickleIdle: 'subpkg_kitchen/kitchen_pickle_idle.png',
  pickleReady: 'subpkg_kitchen/kitchen_pickle_ready.png',
  pickleTiers: [
    { idle: 'subpkg_kitchen/kitchen_pickle_idle.png', ready: 'subpkg_kitchen/kitchen_pickle_ready.png' },
    { idle: 'subpkg_kitchen/kitchen_pickle_1_idle.png', ready: 'subpkg_kitchen/kitchen_pickle_1_ready.png' },
    { idle: 'subpkg_kitchen/kitchen_pickle_2_idle.png', ready: 'subpkg_kitchen/kitchen_pickle_2_ready.png' },
  ] as const,
  catIdle: 'subpkg_kitchen/kitchen_cat_idle.png',
  catAway: 'subpkg_kitchen/kitchen_cat_away.png',
  catGift: 'subpkg_kitchen/kitchen_cat_gift.png',
  catTiers: [
    {
      idle: 'subpkg_kitchen/kitchen_cat_idle.png',
      away: 'subpkg_kitchen/kitchen_cat_away.png',
      gift: 'subpkg_kitchen/kitchen_cat_gift.png',
    },
    {
      idle: 'subpkg_kitchen/kitchen_cat_1_idle.png',
      away: 'subpkg_kitchen/kitchen_cat_1_away.png',
      gift: 'subpkg_kitchen/kitchen_cat_1_gift.png',
    },
    {
      idle: 'subpkg_kitchen/kitchen_cat_2_idle.png',
      away: 'subpkg_kitchen/kitchen_cat_2_away.png',
      gift: 'subpkg_kitchen/kitchen_cat_2_gift.png',
    },
  ] as const,
  catCan: 'subpkg_kitchen/ui_cat_can.png',
} as const;

export const MARKET_PROP_ART = {
  mysterySack: 'subpkg_kitchen/market_mystery_sack.png',
  steelyardIcon: 'subpkg_kitchen/ui_steelyard_icon.png',
} as const;

/** 统一激励视频动作钮：三切片底板 + 手绘场记板播放徽章 + 右上角次数角标。 */
export function makeAdButton(opts: {
  label: string;
  width: number;
  height?: number;
  skin?: keyof typeof UI_BTN;
  textColor?: number;
  badge?: string;
  disabled?: boolean;
  onReady?: () => void;
}): PIXI.Container {
  const height = opts.height ?? 50;
  const iconSize = Math.min(34, Math.round(height * 0.68));
  const btn = makeSlicedButton({
    label: opts.label,
    width: opts.width,
    height,
    skin: opts.disabled ? 'cream' : (opts.skin ?? 'terracotta'),
    textColor: opts.disabled ? 0x8A7358 : opts.textColor,
    labelOffsetX: Math.round(iconSize * 0.44),
    onReady: opts.onReady,
    silent: opts.disabled,
  });
  const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
  const labelNode = (btn as any)._label as PIXI.Text | undefined;
  whenTextureReady(P0_ART.adClapper, () => opts.onReady?.());
  const tex = gameTexture(P0_ART.adClapper);
  if (isTextureReady(tex)) {
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, iconSize, iconSize);
    spr.anchor.set(0.5);
    const actualTextW = labelNode ? labelNode.width : opts.label.length * Math.min(21, height * 0.38);
    const leftX = labelNode
      ? Math.max(12 + iconSize / 2, labelNode.x - actualTextW / 2 - iconSize / 2 - 5)
      : Math.max(12 + iconSize / 2, (opts.width - (iconSize + 6 + actualTextW)) / 2 + iconSize / 2);
    spr.position.set(leftX, height / 2 - 1);
    spr.eventMode = 'none';
    if (opts.disabled) spr.alpha = 0.5;
    face.addChild(spr);
  }
  if (opts.badge) {
    const tag = new PIXI.Container();
    const txt = makeLabel(opts.badge, 14, UI_PALETTE.ink, { fontWeight: '700' });
    const tw = Math.max(42, Math.ceil(txt.width) + 14);
    const th = 24;
    const pill = new PIXI.Graphics();
    pill.lineStyle(2, UI_PALETTE.ink, 1);
    pill.beginFill(opts.disabled ? 0xD8CABA : 0xF7C948, 1);
    pill.drawRoundedRect(0, 0, tw, th, th / 2);
    pill.endFill();
    txt.anchor.set(0.5);
    txt.position.set(tw / 2, th / 2);
    tag.addChild(pill, txt);
    tag.position.set(opts.width - tw + 4, -9);
    tag.eventMode = 'none';
    face.addChild(tag);
  }
  if (opts.disabled) {
    btn.alpha = 0.72;
    btn.cursor = 'default';
  }
  return btn;
}

/** 菜谱三勺熟练度条：铜木勺(1) / 银铁勺(2) / 金炒勺(3)，未达成显示暖棕暗影。 */
export function makeMasterySpoonRow(opts: {
  stars: 0 | 1 | 2 | 3;
  size?: number;
  gap?: number;
  onReady?: () => void;
}): PIXI.Container {
  const size = opts.size ?? 30;
  const gap = opts.gap ?? 4;
  const root = new PIXI.Container();
  root.eventMode = 'none';
  P0_ART.spoons.forEach((path, idx) => {
    whenTextureReady(path, () => opts.onReady?.());
    const earned = opts.stars >= idx + 1;
    const slot = new PIXI.Container();
    slot.position.set(idx * (size + gap), 0);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size, size);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2);
      if (!earned) {
        spr.tint = 0x8A7358;
        spr.alpha = 0.34;
      }
      slot.addChild(spr);
    } else {
      const g = new PIXI.Graphics();
      g.beginFill(earned ? 0xE6B442 : 0xC9B8A4, earned ? 1 : 0.45);
      g.drawCircle(size / 2, size / 2, size * 0.34);
      g.endFill();
      slot.addChild(g);
    }
    root.addChild(slot);
  });
  return root;
}
