import * as PIXI from 'pixi.js';
import { Game } from './Game';
import { Ease, TweenManager } from './TweenManager';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { destroyDisplayChildren, destroyDisplayNode } from '@/utils/destroy';

const Z = 30000;
const FONT = 'PingFang SC, Hiragino Sans GB, sans-serif';
const HOLD = 1.25;
const IN = 0.18;
const OUT = 0.24;
const GAP = 68;
const MAX = 2;

const SEAL_TEX = 'subpkg_images/scene_pk_seal.png';

export type ToastKind = 'success' | 'none' | 'error';

interface ToastTone {
  paper: number;
  paperRim: number;
  woodCap: number;
  ink: number;
  sealText: string;
  sealBg: number;
}

function toneOf(kind: ToastKind): ToastTone {
  if (kind === 'success') {
    return {
      paper: 0xFFF7E0,
      paperRim: 0xC9963B,
      woodCap: 0x7A4B22,
      ink: 0x3A220E,
      sealText: '吉',
      sealBg: 0xC43826,
    };
  }
  if (kind === 'error') {
    return {
      paper: 0xFDF0E8,
      paperRim: 0xB85A44,
      woodCap: 0x6E2E20,
      ink: 0x7A2014,
      sealText: '意',
      sealBg: 0xB8361F,
    };
  }
  return {
    paper: 0xFAF0DA,
    paperRim: 0xA88760,
    woodCap: 0x6B4224,
    ink: 0x2A2018,
    sealText: '签',
    sealBg: 0xB8361F,
  };
}

class ToastManagerClass {
  private _layer: PIXI.Container | null = null;
  private _items: PIXI.Container[] = [];
  private _bound = false;

  ensureTop(): void {
    if (!this._layer || this._layer.destroyed || !Game.stage) return;
    this._layer.zIndex = Z;
    Game.stage.sortableChildren = true;
    Game.stage.addChild(this._layer);
  }

  show(title: string, kind: ToastKind = 'none'): void {
    const text = String(title ?? '').trim();
    if (!text) return;
    if (!Game.stage) {
      console.log('[Toast]', text);
      return;
    }
    this._ensure();

    // 同文案连续触发时不叠压遮挡画面，直接刷新最下方已有签条并轻弹提示
    const last = this._items[this._items.length - 1];
    if (last && !last.destroyed && (last as any).__toastText === text) {
      TweenManager.cancelTarget(last);
      TweenManager.cancelTarget(last.scale);
      last.alpha = 1;
      last.y = this._baseY();
      last.scale.set(0.95);
      TweenManager.to({
        target: last.scale,
        props: { x: 1, y: 1 },
        duration: 0.16,
        ease: Ease.easeOutBack,
        onComplete: () => this._hold(last, HOLD),
      });
      return;
    }

    this._bump();
    const item = this._make(text, kind);
    (item as any).__toastText = text;
    this._items.push(item);
    this._layer!.addChild(item);
    this._place(item);
    const targetY = item.y;
    item.alpha = 0;
    item.y = targetY + 18;
    item.scale.set(0.88);
    TweenManager.to({
      target: item,
      props: { alpha: 1, y: targetY },
      duration: IN,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: item.scale,
      props: { x: 1, y: 1 },
      duration: IN + 0.04,
      ease: Ease.easeOutBack,
      onComplete: () => this._hold(item, HOLD),
    });
    while (this._items.length > MAX) {
      const old = this._items.shift();
      if (old) this._drop(old, true);
    }
  }

  private _hold(item: PIXI.Container, duration: number): void {
    if (item.destroyed || !this._items.includes(item)) return;
    TweenManager.to({
      target: item,
      props: { alpha: item.alpha },
      duration,
      onComplete: () => this._drop(item, false),
    });
  }

  private _drop(item: PIXI.Container, instant: boolean): void {
    const idx = this._items.indexOf(item);
    if (idx !== -1) this._items.splice(idx, 1);
    TweenManager.cancelTarget(item);
    if (item.destroyed) return;
    if (instant) {
      destroyDisplayNode(item);
      return;
    }
    TweenManager.to({
      target: item,
      props: { alpha: 0, y: item.y - 22 },
      duration: OUT,
      ease: Ease.easeInQuad,
      onComplete: () => {
        if (!item.destroyed) destroyDisplayNode(item);
      },
    });
  }

  private _bump(): void {
    for (const item of this._items) {
      if (item.destroyed) continue;
      TweenManager.cancelTarget(item);
      TweenManager.to({
        target: item,
        props: { y: item.y - GAP, alpha: Math.min(item.alpha, 0.72) },
        duration: 0.16,
        ease: Ease.easeOutQuad,
        onComplete: () => this._hold(item, 0.75),
      });
    }
  }

  /**
   * 温润手绘宣纸木轴提示签：两端胡桃木压条 + 铜钉 + 宣纸内芯 + 朱红小印章 + 25pt 浓墨大字。
   */
  private _make(text: string, kind: ToastKind): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const tone = toneOf(kind);

    const maxWrapW = Math.max(300, Math.min(540, Game.logicWidth - 150));
    const label = new PIXI.Text(text, {
      fontFamily: FONT,
      fontSize: 25,
      fontWeight: '700',
      fill: tone.ink,
      lineJoin: 'round',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: maxWrapW,
      breakWords: true,
      lineHeight: 33,
      padding: 4,
    });
    label.anchor.set(0, 0.5);
    label.eventMode = 'none';

    const sealSize = 36;
    const gap = 12;
    const padX = 28;
    const padY = 14;
    const contentW = sealSize + gap + Math.ceil(label.width);
    const bodyW = Math.max(260, contentW + padX * 2);
    const bodyH = Math.max(58, Math.ceil(label.height) + padY * 2);
    const rodW = 10;

    const g = new PIXI.Graphics();
    // Soft warm drop shadow
    g.beginFill(0x160E08, 0.3);
    g.drawRoundedRect(-bodyW / 2 - 2, -bodyH / 2 + 5, bodyW + 4, bodyH + 2, 10);
    g.endFill();

    // Main xuan-parchment slip body
    g.lineStyle(2.5, 0x3A2414, 1);
    g.beginFill(tone.paper, 0.98);
    g.drawRoundedRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 8);
    g.endFill();

    // Inner delicate ink rule line (traditional paper slip feel)
    g.lineStyle(1.2, tone.paperRim, 0.65);
    g.drawRoundedRect(-bodyW / 2 + rodW + 5, -bodyH / 2 + 5, bodyW - (rodW + 5) * 2, bodyH - 10, 4);

    // Left & right carved wooden scroll rods + brass tacks
    for (const side of [-1, 1] as const) {
      const rx = side < 0 ? -bodyW / 2 : bodyW / 2 - rodW;
      g.lineStyle(2.2, 0x2A180C, 1);
      g.beginFill(tone.woodCap, 1);
      g.drawRoundedRect(rx, -bodyH / 2 - 3, rodW, bodyH + 6, 4);
      g.endFill();
      // Brass pin in rod center
      g.lineStyle(1.2, 0x3A220E, 0.9);
      g.beginFill(0xE8BE66, 1);
      g.drawCircle(rx + rodW / 2, 0, 3.2);
      g.endFill();
    }
    root.addChild(g);

    // Vermilion mini seal stamp on the left
    const startX = -contentW / 2;
    const sealHost = new PIXI.Container();
    sealHost.position.set(startX + sealSize / 2, 0);
    sealHost.rotation = -0.08;
    const paintSeal = (): void => {
      if (sealHost.destroyed) return;
      destroyDisplayChildren(sealHost);
      const tex = gameTexture(SEAL_TEX);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, sealSize, sealSize);
        sp.anchor.set(0.5);
        sealHost.addChild(sp);
      } else {
        const sg = new PIXI.Graphics();
        sg.lineStyle(1.5, 0x7A1C12, 1);
        sg.beginFill(tone.sealBg, 1);
        sg.drawRoundedRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize, 6);
        sg.endFill();
        sealHost.addChild(sg);
      }
      const st = new PIXI.Text(tone.sealText, {
        fontFamily: FONT,
        fontSize: 19,
        fontWeight: '700',
        fill: 0xFFF6EA,
      });
      st.anchor.set(0.5);
      sealHost.addChild(st);
    };
    paintSeal();
    whenTextureReady(SEAL_TEX, paintSeal);
    root.addChild(sealHost);

    label.position.set(startX + sealSize + gap, -0.5);
    root.addChild(label);

    return root;
  }

  private _place(item: PIXI.Container): void {
    item.position.set(Game.logicWidth * 0.5, this._baseY());
  }

  private _baseY(): number {
    const safeBottom = Number.isFinite((Game as any).safeBottom) ? (Game as any).safeBottom : 24;
    return Math.round(
      Math.min(
        Game.logicHeight - Math.max(safeBottom, 24) - 132,
        Game.logicHeight * 0.82,
      ),
    );
  }

  private _ensure(): void {
    if (!this._layer || this._layer.destroyed) {
      this._layer = new PIXI.Container();
      this._layer.eventMode = 'none';
      this._layer.sortableChildren = false;
      this._items = this._items.filter((item) => !item.destroyed);
    }
    this._layer.zIndex = Z;
    Game.stage.sortableChildren = true;
    Game.stage.addChild(this._layer);
    if (!this._bound) {
      this._bound = true;
      Game.onViewportChange(() => this._relayout());
    }
  }

  private _relayout(): void {
    if (!this._layer || this._layer.destroyed) return;
    this._layer.position.set(0, 0);
    const n = this._items.length;
    this._items.forEach((item, i) => {
      if (item.destroyed) return;
      item.x = Game.logicWidth * 0.5;
      item.y = this._baseY() - (n - 1 - i) * GAP;
    });
  }
}

export const ToastManager = new ToastManagerClass();
