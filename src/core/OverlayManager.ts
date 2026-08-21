import * as PIXI from 'pixi.js';
import { Game } from './Game';
import { TweenManager } from './TweenManager';

class OverlayManagerClass {
  private _container: PIXI.Container | null = null;

  constructor() {
    Game.onViewportChange(() => this.relayoutVisiblePanels());
  }

  get container(): PIXI.Container {
    if (!this._container) {
      this._container = new PIXI.Container();
      this._container.sortableChildren = true;
      this._container.zIndex = 10000;
      Game.stage.addChild(this._container);
    }
    return this._container;
  }

  bringToFront(): void {
    if (this._container && this._container.parent) {
      const parent = this._container.parent;
      parent.removeChild(this._container);
      parent.addChild(this._container);
    }
  }

  resetTransform(): void {
    if (!this._container) return;
    this._container.position.set(0, 0);
    this._container.scale.set(1, 1);
    this._container.pivot.set(0, 0);
    this._container.alpha = 1;
    this._container.rotation = 0;
  }

  closeAllPanels(): void {
    if (!this._container) return;
    for (const child of this._container.children) {
      if (child.visible && typeof (child as any).close === 'function') {
        TweenManager.cancelTarget(child);
        child.visible = false;
        child.alpha = 1;
        if (typeof (child as any)._isOpen !== 'undefined') {
          (child as any)._isOpen = false;
        }
      }
    }
  }

  relayoutVisiblePanels(): void {
    if (!this._container) return;
    for (const child of this._container.children) {
      if (!child.visible || typeof (child as any).relayout !== 'function') continue;
      try { (child as any).relayout(); } catch (e) {
        console.warn('[OverlayManager] relayout 失败', e);
      }
    }
  }
}

export const OverlayManager = new OverlayManagerClass();
