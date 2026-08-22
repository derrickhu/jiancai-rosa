/**
 * 全局游戏单例。从 huahua Game.ts 精简：保留 750 宽适配、安全区、三级 renderer 降级，
 * 去掉 BuildingManager / 响应式 FeatureFlags。
 */
import * as PIXI from 'pixi.js';
import { ShaderSystem } from '@pixi/core';
import { TweenManager } from './TweenManager';

function ensureUnsafeEvalPatch(): void {
  if ((ShaderSystem.prototype as any).__patched) return;
  Object.assign(ShaderSystem.prototype, {
    __patched: true,
    systemCheck() { /* 禁用 eval 检测 */ },
  });
}

ensureUnsafeEvalPatch();

class GameClass {
  app!: PIXI.Application;
  stage: PIXI.Container;
  ticker: PIXI.Ticker;

  designWidth = 750;
  designHeight = 1334;

  screenWidth = 375;
  screenHeight = 667;
  scale = 1;
  contentScale = 1;
  contentOffsetX = 0;
  contentOffsetY = 0;
  dpr = 1;
  safeTop = 0;
  safeBottom = 0;

  private _initialized = false;
  private _canvas: any = null;
  private _viewportListeners = new Set<() => void>();
  readonly _uid = Math.random().toString(36).slice(2, 8);

  constructor() {
    this.stage = new PIXI.Container();
    this.ticker = new PIXI.Ticker();
  }

  init(canvas: any): void {
    if (this._initialized) return;
    ensureUnsafeEvalPatch();

    this._readViewport();
    this._canvas = canvas;

    const realWidth = this.screenWidth * this.dpr;
    const realHeight = this.screenHeight * this.dpr;
    canvas.width = realWidth;
    canvas.height = realHeight;

    const baseOpts = {
      view: canvas,
      width: realWidth,
      height: realHeight,
      backgroundColor: 0x2C261F,
      resolution: 1,
      antialias: true,
      preserveDrawingBuffer: true,
      preferWebGLVersion: 1,
    };

    let renderer: PIXI.IRenderer | null = null;
    let app: PIXI.Application | null = null;
    try {
      app = new PIXI.Application(baseOpts as any);
    } catch (e) {
      console.error('[Game] new PIXI.Application 失败:', e);
      try {
        app = new PIXI.Application({ ...baseOpts, forceCanvas: true, antialias: false } as any);
        console.warn('[Game] 已降级到 Canvas 渲染');
      } catch (eCanvas) {
        console.error('[Game] Canvas Application 也失败:', eCanvas);
      }
    }

    if (app && app.stage && app.ticker && app.renderer) {
      this.app = app;
      this.stage = app.stage;
      this.ticker = app.ticker;
      renderer = app.renderer;
    } else {
      if (app?.renderer) renderer = app.renderer;
      if (!renderer) {
        try {
          renderer = new PIXI.Renderer({
            view: canvas,
            width: realWidth,
            height: realHeight,
            backgroundColor: 0x2C261F,
            resolution: 1,
            antialias: true,
            preserveDrawingBuffer: true,
            preferWebGLVersion: 1,
          } as any);
        } catch (e2) {
          console.error('[Game] new PIXI.Renderer 失败:', e2);
        }
      }
      if (!renderer) {
        try {
          renderer = PIXI.autoDetectRenderer({
            view: canvas,
            width: realWidth,
            height: realHeight,
            backgroundColor: 0x2C261F,
            resolution: 1,
            preferWebGLVersion: 1,
            forceCanvas: true,
          } as any);
        } catch (e3) {
          console.error('[Game] autoDetectRenderer 失败:', e3);
        }
      }
      this.stage = new PIXI.Container();
      this.ticker = new PIXI.Ticker();
      this.ticker.start();
      if (renderer) {
        this.ticker.add(() => {
          renderer!.render(this.stage);
        });
      }
      this.app = { stage: this.stage, ticker: this.ticker, renderer, view: canvas } as any;
    }

    try { (GameGlobal as any).__gameRendered = true; } catch (_) {}

    this.stage.sortableChildren = true;
    this.stage.scale.set(this.scale, this.scale);
    this.stage.position.set(this.contentOffsetX * this.dpr, this.contentOffsetY * this.dpr);

    this.ticker.add(() => {
      TweenManager.update(this.ticker.deltaMS / 1000);
    });

    try {
      const evtSys = (this.app?.renderer as any)?.events;
      if (evtSys && evtSys.domElement) {
        const dom = evtSys.domElement;
        evtSys.mapPositionToPoint = (point: any, x: number, y: number) => {
          let rect: any;
          try { rect = dom.getBoundingClientRect(); } catch (_) { rect = null; }
          if (!rect || !rect.width || !rect.height) {
            rect = { left: 0, top: 0, width: this.screenWidth, height: this.screenHeight };
          }
          const resMul = 1.0 / (evtSys.resolution || 1);
          point.x = ((x - (rect.left || 0)) * (dom.width / rect.width)) * resMul;
          point.y = ((y - (rect.top || 0)) * (dom.height / rect.height)) * resMul;
        };
      }
    } catch (e) {
      console.warn('[Game] EventSystem patch 失败:', e);
    }

    this._initialized = true;
    this._bindResize();
    console.log(`[Game] 初始化完成 viewport=${this.screenWidth}x${this.screenHeight} scale=${this.scale.toFixed(2)} safeTop=${this.safeTop}`);
  }

  onViewportChange(listener: () => void): () => void {
    this._viewportListeners.add(listener);
    return () => this._viewportListeners.delete(listener);
  }

  get logicWidth(): number {
    return this.designWidth;
  }

  get logicHeight(): number {
    const h = this.screenHeight / this.contentScale;
    return Number.isFinite(h) && h > 0 ? h : this.designHeight;
  }

  private _readViewport(): void {
    const api: any = (globalThis as any).wx ?? (globalThis as any).tt ?? null;
    let sysInfo: any = null;
    let capsule: any = null;
    try { sysInfo = api?.getSystemInfoSync?.() ?? null; } catch (_) {}
    try { capsule = api?.getMenuButtonBoundingClientRect?.() ?? null; } catch (_) {}

    this.screenWidth = finite(sysInfo?.screenWidth, this.screenWidth);
    this.screenHeight = finite(sysInfo?.screenHeight, this.screenHeight);
    this.dpr = finite(sysInfo?.pixelRatio, this.dpr);
    this.contentScale = this.screenWidth / this.designWidth;
    if (!Number.isFinite(this.contentScale) || this.contentScale <= 0) {
      this.contentScale = 1;
    }
    this.scale = this.contentScale * this.dpr;
    this.contentOffsetX = 0;
    this.contentOffsetY = 0;

    const status = finite(sysInfo?.statusBarHeight, 20);
    const capTop = capsule && typeof capsule.top === 'number' ? capsule.top : NaN;
    const capH = capsule && typeof capsule.height === 'number' ? capsule.height : NaN;
    const capBottomPx = Number.isFinite(capTop) && Number.isFinite(capH)
      ? capTop + capH + 8
      : status + 36;
    const safeTop = Math.round(capBottomPx / this.contentScale);
    this.safeTop = Number.isFinite(safeTop) ? Math.min(Math.max(safeTop, 48), 200) : 96;
    const safeBottomPx = sysInfo?.safeArea && typeof sysInfo.safeArea.bottom === 'number'
      ? Math.max(0, this.screenHeight - sysInfo.safeArea.bottom)
      : 0;
    const safeBottom = Math.round(safeBottomPx / this.contentScale);
    this.safeBottom = Number.isFinite(safeBottom) ? Math.max(0, safeBottom) : 0;
  }

  private _bindResize(): void {
    const api: any = (globalThis as any).wx ?? (globalThis as any).tt ?? null;
    const onResize = (): void => {
      this._readViewport();
      const realWidth = Math.round(this.screenWidth * this.dpr);
      const realHeight = Math.round(this.screenHeight * this.dpr);
      try {
        (this.app?.renderer as any)?.resize?.(realWidth, realHeight);
      } catch (_) {
        if (this._canvas) {
          this._canvas.width = realWidth;
          this._canvas.height = realHeight;
        }
      }
      this.stage.scale.set(this.scale, this.scale);
      for (const listener of [...this._viewportListeners]) {
        try { listener(); } catch (e) { console.warn('[Game] viewport listener', e); }
      }
    };
    if (typeof api?.onWindowResize === 'function') {
      api.onWindowResize(() => onResize());
    }
  }
}

const _global: any = typeof GameGlobal !== 'undefined' ? GameGlobal
  : typeof window !== 'undefined' ? window
  : globalThis;

if (!_global.__gameInstance) {
  _global.__gameInstance = new GameClass();
}
export const Game: GameClass = _global.__gameInstance;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
