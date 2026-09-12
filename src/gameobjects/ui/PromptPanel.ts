import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';

/**
 * 通用确认 / 提示框。
 * 木框奶油纸，和街坊点菜、冰箱同一套。系统 showModal 不要再进游戏流程。
 *
 * 标题宋体居中，正文灰棕换行，主按钮陶土、次按钮木纹并排。
 * 点暗幕等于取消。
 */
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x8A6A40;
const CREAM = 0xF6EDE0;
const WALNUT = 0x8B5A2B;
const LINE = 0xC4A574;
const TAP_LOCK_MS = 280;
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

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.42;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._pick(false));
    this._root.addChild(dim);

    const cardW = Math.min(520, w - 64);
    const pad = 40;
    const wrap = cardW - pad * 2;
    const iconPath = opts.icon ?? '';
    if (iconPath) {
      whenTextureReady(iconPath, () => {
        if (this._isOpen) this.relayout();
      });
    }

    const title = new PIXI.Text(opts.title, {
      fontFamily: TITLE_FONT,
      fontSize: 32,
      fill: INK,
      fontWeight: '700',
      letterSpacing: 1,
      stroke: '#FFF6E8',
      strokeThickness: 5,
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: wrap,
    });
    title.anchor.set(0.5, 0);
    title.eventMode = 'none';

    const body = makeLabel(opts.content, 22, MUTED, {
      fontWeight: '500',
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: wrap,
      lineHeight: 34,
    });
    body.anchor.set(0.5, 0);

    const iconH = iconPath ? 72 : 0;
    const gap = 16;
    const btnH = 56;
    const top = 32;
    const mid = (iconH ? iconH + 18 : 0) + title.height + gap + body.height;
    const cardH = top + mid + 28 + btnH + 32;

    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
    card.on('pointertap', (e) => e.stopPropagation());
    card.position.set(Math.round((w - cardW) / 2), Math.round(Math.max(Game.safeTop + 24, (h - cardH) / 2)));
    this._root.addChild(card);
    this._card = card;

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x2A2018, 0.16);
    shadow.drawRoundedRect(6, 10, cardW, cardH, 28);
    shadow.endFill();
    card.addChild(shadow);

    const panel = new PIXI.Graphics();
    panel.lineStyle(5, WALNUT, 1);
    panel.beginFill(CREAM);
    panel.drawRoundedRect(0, 0, cardW, cardH, 28);
    panel.endFill();
    card.addChild(panel);

    const inner = new PIXI.Graphics();
    inner.lineStyle(2, LINE, 0.7);
    inner.beginFill(0xF3E6D0);
    inner.drawRoundedRect(14, 14, cardW - 28, cardH - 28, 20);
    inner.endFill();
    card.addChild(inner);

    let y = top;
    if (iconPath) {
      const icon = new PIXI.Sprite(gameTexture(iconPath));
      if (isTextureReady(icon.texture)) fitSpriteInBox(icon, 64, 64);
      else {
        icon.width = 64;
        icon.height = 64;
      }
      icon.anchor.set(0.5);
      icon.position.set(cardW / 2, y + 32);
      icon.eventMode = 'none';
      card.addChild(icon);
      y += iconH + 18;
    }

    title.position.set(cardW / 2, y);
    card.addChild(title);
    y += title.height + gap;
    body.position.set(cardW / 2, y);
    card.addChild(body);

    const btnY = cardH - btnH - 32;
    const showCancel = opts.showCancel !== false;
    if (showCancel) {
      const gapBtn = 16;
      const btnW = Math.floor((cardW - pad * 2 - gapBtn) / 2);
      const cancel = makeSlicedButton({
        label: opts.cancelText ?? '取消',
        width: btnW,
        height: btnH,
        skin: 'wood',
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
      card.addChild(cancel);

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
      card.addChild(ok);
      return;
    }

    const okW = 220;
    const ok = makeSlicedButton({
      label: opts.confirmText ?? '知道了',
      width: okW,
      height: btnH,
      skin: 'terracotta',
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
    card.addChild(ok);
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
