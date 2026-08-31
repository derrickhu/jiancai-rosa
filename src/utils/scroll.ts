import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { Platform } from '@/core/PlatformService';

export type ScrollRect = { x: number; y: number; w: number; h: number };

type AttachOpts = {
  content: PIXI.Container;
  maxScroll: number;
  baseY?: number;
  hit: ScrollRect;
};

/**
 * 竖向列表拖动。子按钮会抢走 pointermove，微信小游戏也经常不派发这段事件，
 * 所以挂在宿主上听 globalpointermove，并补一层 wx/tt 的触摸。
 */
export class VerticalScroller {
  moved = false;
  y = 0;

  private readonly _host: PIXI.Container;
  private readonly _visible: () => boolean;
  private readonly _slop: number;
  private _content: PIXI.Container | null = null;
  private _max = 0;
  private _baseY = 0;
  private _hit: ScrollRect = { x: 0, y: 0, w: 0, h: 0 };
  private _dragging = false;
  private _dragY = 0;
  private _startY = 0;
  private _wxBound = false;
  private _hostBound = false;

  constructor(host: PIXI.Container, opts?: { slop?: number; visible?: () => boolean }) {
    this._host = host;
    this._slop = opts?.slop ?? 8;
    this._visible = opts?.visible ?? (() => host.visible);
    host.eventMode = 'static';
    this._bindHost(true);
  }

  attach(opts: AttachOpts): void {
    this._content = opts.content;
    this._max = Math.max(0, opts.maxScroll);
    this._baseY = opts.baseY ?? 0;
    this._hit = opts.hit;
    this.apply(this.y);
  }

  clear(): void {
    this._content = null;
    this._max = 0;
    this._hit = { x: 0, y: 0, w: 0, h: 0 };
    this._dragging = false;
  }

  enable(): void {
    this._bindWx(true);
  }

  disable(): void {
    this._dragging = false;
    this._bindWx(false);
  }

  reset(): void {
    this.y = 0;
    this.moved = false;
    this._dragging = false;
    this.apply(0);
  }

  /** 子控件开始拖物品时叫，避免和滚动抢手势。 */
  cancel(): void {
    this._dragging = false;
    this.moved = false;
  }

  apply(y: number): void {
    this.y = this._max <= 0 ? 0 : Math.max(-this._max, Math.min(0, y));
    if (this._content) this._content.y = this._baseY + this.y;
  }

  destroy(): void {
    this._bindHost(false);
    this._bindWx(false);
    this._content = null;
  }

  private _bindHost(on: boolean): void {
    if (on === this._hostBound) return;
    const host = this._host;
    if (on) {
      host.on('pointerdown', this._onDown);
      host.on('globalpointermove', this._onMove);
      host.on('pointerup', this._onUp);
      host.on('pointerupoutside', this._onUp);
      host.on('pointercancel', this._onUp);
      host.on('wheel', this._onWheel);
      this._hostBound = true;
      return;
    }
    host.off('pointerdown', this._onDown);
    host.off('globalpointermove', this._onMove);
    host.off('pointerup', this._onUp);
    host.off('pointerupoutside', this._onUp);
    host.off('pointercancel', this._onUp);
    host.off('wheel', this._onWheel);
    this._hostBound = false;
  }

  private _inHit(p: { x: number; y: number }): boolean {
    const r = this._hit;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  private _wxPoint(res: {
    touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
    changedTouches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
  }): { x: number; y: number } | null {
    const t = res.touches?.[0] ?? res.changedTouches?.[0];
    if (!t) return null;
    const scale = Game.contentScale || 1;
    return {
      x: (t.clientX ?? t.x ?? 0) / scale,
      y: (t.clientY ?? t.y ?? 0) / scale,
    };
  }

  private _moveTo(y: number): void {
    if (!this._dragging) return;
    const dy = y - this._dragY;
    if (Math.abs(dy) > this._slop) this.moved = true;
    this.apply(this._startY + dy);
  }

  private _onDown = (e: PIXI.FederatedPointerEvent): void => {
    if (!this._visible() || this._max <= 0) {
      this.moved = false;
      return;
    }
    const p = this._host.toLocal(e.global);
    if (!this._inHit(p)) {
      this.moved = false;
      return;
    }
    this._dragging = true;
    this.moved = false;
    this._dragY = p.y;
    this._startY = this.y;
  };

  private _onMove = (e: PIXI.FederatedPointerEvent): void => {
    if (!this._visible()) return;
    this._moveTo(this._host.toLocal(e.global).y);
  };

  private _onUp = (): void => {
    this._dragging = false;
  };

  private _onWheel = (e: PIXI.FederatedWheelEvent): void => {
    if (!this._visible() || this._max <= 0) return;
    const p = this._host.toLocal(e.global);
    if (!this._inHit(p)) return;
    this.apply(this.y - e.deltaY);
  };

  private _onWxStart = (res: {
    touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
  }): void => {
    if (!this._visible() || this._max <= 0) {
      this.moved = false;
      return;
    }
    const p = this._wxPoint(res);
    if (!p || !this._inHit(p)) {
      this.moved = false;
      return;
    }
    this._dragging = true;
    this.moved = false;
    this._dragY = p.y;
    this._startY = this.y;
  };

  private _onWxMove = (res: {
    touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
  }): void => {
    if (!this._visible()) return;
    const p = this._wxPoint(res);
    if (!p) return;
    this._moveTo(p.y);
  };

  private _onWxEnd = (): void => {
    this._dragging = false;
  };

  private _bindWx(on: boolean): void {
    const api = Platform.api;
    if (!api?.onTouchMove) return;
    if (on && !this._wxBound) {
      try { api.onTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.onTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.onTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.onTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = true;
    } else if (!on && this._wxBound) {
      try { api.offTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.offTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.offTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.offTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = false;
    }
  }
}
