import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { watchTextures } from '@/utils/assets';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  UI_KIT,
  fillRect,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makePlateItem,
  sceneArtPaths,
} from './scenePanel';

/**
 * 通用确认 / 提示弹窗：木匾标题 + 宣纸短笺 + 大字墨书 + 主次分明按钮。
 */
const WALL = 'subpkg_images/scene_order_wall.png';
const INK = SCENE_INK.ink;
const TAP_LOCK_MS = 260;
const Z = 90;
const W = 620;

export interface PromptOpts {
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  icon?: string;
}

class PromptPanelClass extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _opts: PromptOpts | null = null;
  private _resolve: ((ok: boolean) => void) | null = null;
  private _lockAt = 0;
  private _card: PIXI.Container | null = null;
  private _baseScale = 1;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = Z;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  show(opts: PromptOpts): Promise<boolean> {
    if (this._isOpen) this._finish(false, true);
    this._opts = {
      confirmText: '确定',
      cancelText: '取消',
      showCancel: true,
      ...opts,
    };
    this._isOpen = true;
    this.visible = true;
    this._lockAt = Date.now();
    AudioManager.play('ui_open');
    this.relayout();
    OverlayManager.bringToFront();
    this._popIn();
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  close(silent = false): void {
    this._finish(false, silent);
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen) this.relayout();
    });
  };

  relayout(): void {
    destroyDisplayChildren(this._root);
    this._card = null;
    const opts = this._opts;
    if (!this._isOpen || !opts) return;

    const watchList: string[] = [
      WALL,
      ...sceneArtPaths(),
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
    ];
    if (opts.icon) watchList.push(opts.icon);
    watchTextures(watchList, this._scheduleRelayout);

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.62;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._pick(false));
    this._root.addChild(dim);

    const sheetMargin = 24;
    const contentL = 88;
    const contentR = W - 88;
    const contentW = contentR - contentL;

    const body = makeText('body', opts.content, INK, {
      size: 26,
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: contentW,
      lineHeight: 40,
    });
    body.anchor.set(0.5, 0);

    const hasIcon = Boolean(opts.icon);
    const iconBlockH = hasIcon ? 126 : 0;
    // 木匾 top=-46, width=348 时底边在 y≈134；宣纸从 y=144 起铺，彻底避开木匾下沿
    const sheetTop = 144;
    const topPad = 56;
    const btnH = 60;
    const btnRowW = W - 128;
    const sheetH = topPad + iconBlockH + Math.ceil(body.height) + 28 + 26 + btnH + 38;
    const cardH = sheetTop + sheetH + 28;

    const availW = sw - 32;
    const availH = sh - Game.safeTop - 64 - Math.max(24, Game.safeBottom);
    const scale = Math.min(1, availW / W, availH / cardH);
    this._baseScale = scale;

    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, -52, W, cardH + 62);
    card.on('pointertap', (e) => e.stopPropagation());
    card.pivot.set(W / 2, cardH / 2);
    card.scale.set(scale);
    card.position.set(
      Math.round(sw / 2),
      Math.round(Math.max(Game.safeTop + 56 + (cardH * scale) / 2, sh / 2)),
    );
    this._root.addChild(card);
    this._card = card;

    drawSceneWall(card, WALL, W, cardH, 160, 110);
    drawPlaqueTitle(card, opts.title, W / 2, -46, 348);
    drawSceneClose(card, W - 44, -20, () => this._pick(false), this._scheduleRelayout);

    drawStretchSheet(card, SCENE_ART.sheet, sheetMargin, sheetTop, W - sheetMargin * 2, sheetH, 110, 96);

    let y = sheetTop + topPad;
    if (opts.icon) {
      const plate = makePlateItem({
        iconPath: opts.icon,
        plateW: 132,
        iconSize: 78,
      });
      plate.position.set(W / 2, y + 48);
      card.addChild(plate);
      y += iconBlockH;
    }

    body.position.set(W / 2, y);
    card.addChild(body);
    y += Math.ceil(body.height) + 26;

    const btnLeft = Math.round((W - btnRowW) / 2);
    drawInkDivider(card, btnLeft, y, btnRowW, 0.48, 10);
    y += 28;

    const showCancel = opts.showCancel !== false;
    if (showCancel) {
      const gapBtn = 18;
      const btnW = Math.floor((btnRowW - gapBtn) / 2);
      const cancel = makeSlicedButton({
        label: opts.cancelText ?? '取消',
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: SCENE_INK.soft,
        fontSize: 26,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      cancel.position.set(btnLeft, y);
      cancel.on('pointertap', (e) => {
        e.stopPropagation();
        this._pick(false);
      });
      card.addChild(cancel);

      const ok = makeSlicedButton({
        label: opts.confirmText ?? '确定',
        width: btnW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 26,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      ok.position.set(btnLeft + btnW + gapBtn, y);
      ok.on('pointertap', (e) => {
        e.stopPropagation();
        this._pick(true);
      });
      card.addChild(ok);
      return;
    }

    const okW = 268;
    const ok = makeSlicedButton({
      label: opts.confirmText ?? '知道了',
      width: okW,
      height: btnH,
      skin: 'olive',
      fontSize: 27,
      silent: true,
      onReady: this._scheduleRelayout,
    });
    ok.position.set((W - okW) / 2, y);
    ok.on('pointertap', (e) => {
      e.stopPropagation();
      this._pick(true);
    });
    card.addChild(ok);
  }

  private _popIn(): void {
    const card = this._card;
    if (!card) return;
    const s = this._baseScale;
    TweenManager.cancelTarget(card);
    TweenManager.cancelTarget(card.scale);
    card.alpha = 0;
    card.scale.set(s * 0.92);
    TweenManager.to({
      target: card,
      props: { alpha: 1 },
      duration: 0.16,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: card.scale,
      props: { x: s, y: s },
      duration: 0.18,
      ease: Ease.easeOutBack,
    });
  }

  private _pick(ok: boolean): void {
    if (!this._isOpen) return;
    if (Date.now() - this._lockAt < TAP_LOCK_MS) return;
    this._finish(ok, false);
  }

  private _finish(ok: boolean, silent: boolean): void {
    if (!this._isOpen && !this._resolve) return;
    if (this._isOpen && !silent) AudioManager.play(ok ? 'ui_click' : 'ui_close');
    const resolve = this._resolve;
    this._resolve = null;
    this._isOpen = false;
    this.visible = false;
    this._opts = null;
    this._card = null;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
    resolve?.(ok);
  }
}

let _panel: PromptPanelClass | null = null;

function panel(): PromptPanelClass {
  if (!_panel || _panel.destroyed) _panel = new PromptPanelClass();
  return _panel;
}

export function showPrompt(opts: PromptOpts): Promise<boolean> {
  if (!Game.stage) return Promise.resolve(false);
  return panel().show(opts);
}

const holder = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
(holder as { __jiancaiShowPrompt?: typeof showPrompt }).__jiancaiShowPrompt = showPrompt;
