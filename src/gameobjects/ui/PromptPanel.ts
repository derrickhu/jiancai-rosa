import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures, whenTextureReady } from '@/utils/assets';
import {
  UI_KIT,
  UI_PALETTE,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeLabel,
  makeSlicedButton,
} from '@/utils/ui';

/**
 * 通用确认 / 提示框：统一手作胡桃木横匾 + 暖宣纸内芯 + 立体切片按钮。
 */
const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const TAP_LOCK_MS = 260;
const Z = 90;

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

  relayout(): void {
    this._root.removeChildren();
    this._card = null;
    const opts = this._opts;
    if (!this._isOpen || !opts) return;

    watchTextures([UI_KIT.headerRibbon, UI_KIT.closeRound, UI_KIT.btnOlive], () => {
      if (this._isOpen) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.54;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._pick(false));
    this._root.addChild(dim);

    const cardW = Math.min(540, w - 56);
    const pad = 34;
    const wrap = cardW - pad * 2 - 24;
    const iconPath = opts.icon ?? '';
    if (iconPath) {
      whenTextureReady(iconPath, () => {
        if (this._isOpen) this.relayout();
      });
    }

    const body = makeLabel(opts.content, 21, INK, {
      fontWeight: '600',
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: wrap,
      lineHeight: 33,
    });
    body.anchor.set(0.5, 0);

    const iconH = iconPath ? 74 : 0;
    const btnH = 54;
    const contentTop = 64;
    const wellPadY = 18;
    const wellH = (iconH ? iconH + 12 : 0) + body.height + wellPadY * 2;
    const cardH = contentTop + wellH + 22 + btnH + 30;

    const { shell } = makeArtisanShell({
      width: cardW,
      height: cardH,
      title: opts.title,
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this._pick(false),
    });

    const cx = Math.round(w / 2);
    const cy = Math.round(Math.max(Game.safeTop + 36 + cardH / 2, h / 2));
    shell.pivot.set(cardW / 2, cardH / 2);
    shell.position.set(cx, cy);
    this._root.addChild(shell);
    this._card = shell;

    const well = new PIXI.Graphics();
    drawRecessedWell(well, pad, contentTop, cardW - pad * 2, wellH, { radius: 16 });
    shell.addChild(well);

    let y = contentTop + wellPadY;
    if (iconPath) {
      const halo = new PIXI.Graphics();
      halo.beginFill(0xFFFBF2, 0.8);
      halo.drawCircle(cardW / 2, y + 32, 34);
      halo.endFill();
      shell.addChild(halo);

      const icon = new PIXI.Sprite(gameTexture(iconPath));
      if (isTextureReady(icon.texture)) fitSpriteInBox(icon, 60, 60);
      else {
        icon.width = 60;
        icon.height = 60;
      }
      icon.anchor.set(0.5);
      icon.position.set(cardW / 2, y + 32);
      icon.eventMode = 'none';
      shell.addChild(icon);
      y += iconH + 12;
    }

    body.position.set(cardW / 2, y);
    shell.addChild(body);

    const btnY = cardH - btnH - 28;
    const showCancel = opts.showCancel !== false;
    if (showCancel) {
      const gapBtn = 16;
      const btnW = Math.floor((cardW - pad * 2 - gapBtn) / 2);
      const cancel = makeSlicedButton({
        label: opts.cancelText ?? '取消',
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: MUTED,
        silent: true,
        onReady: () => {
          if (this._isOpen) this.relayout();
        },
      });
      cancel.position.set(pad, btnY);
      cancel.on('pointertap', (e) => {
        e.stopPropagation();
        this._pick(false);
      });
      shell.addChild(cancel);

      const ok = makeSlicedButton({
        label: opts.confirmText ?? '确定',
        width: btnW,
        height: btnH,
        skin: 'terracotta',
        silent: true,
        onReady: () => {
          if (this._isOpen) this.relayout();
        },
      });
      ok.position.set(pad + btnW + gapBtn, btnY);
      ok.on('pointertap', (e) => {
        e.stopPropagation();
        this._pick(true);
      });
      shell.addChild(ok);
      return;
    }

    const okW = 228;
    const ok = makeSlicedButton({
      label: opts.confirmText ?? '知道了',
      width: okW,
      height: btnH,
      skin: 'olive',
      silent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    ok.position.set((cardW - okW) / 2, btnY);
    ok.on('pointertap', (e) => {
      e.stopPropagation();
      this._pick(true);
    });
    shell.addChild(ok);
  }

  private _popIn(): void {
    const card = this._card;
    if (!card) return;
    TweenManager.cancelTarget(card);
    TweenManager.cancelTarget(card.scale);
    card.alpha = 0;
    card.scale.set(0.92);
    TweenManager.to({
      target: card,
      props: { alpha: 1 },
      duration: 0.16,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: card.scale,
      props: { x: 1, y: 1 },
      duration: 0.16,
      ease: Ease.easeOutQuad,
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
    this._root.removeChildren();
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
