import * as PIXI from 'pixi.js';
import { Game } from './Game';
import { TweenManager } from './TweenManager';
import { OverlayManager } from './OverlayManager';
import { Platform } from './PlatformService';
import { trimTexturesToBudget } from '@/utils/assets';
import { pruneMapSlotCache } from '@/gameobjects/market/MapView';

export interface Scene {
  readonly name: string;
  readonly container: PIXI.Container;
  onEnter?(): void;
  onExit?(): void;
  relayout?(): void;
  update?(dt: number): void;
}

class SceneManagerClass {
  private _scenes: Map<string, Scene> = new Map();
  private _currentScene: Scene | null = null;

  constructor() {
    Game.onViewportChange(() => {
      this._currentScene?.relayout?.();
    });
  }

  register(scene: Scene): void {
    this._scenes.set(scene.name, scene);
  }

  switchTo(name: string): void {
    const nextScene = this._scenes.get(name);
    if (!nextScene) {
      console.error(`[SceneManager] 场景 "${name}" 未注册`);
      return;
    }
    if (!Game.stage) {
      console.error('[SceneManager] Game.stage 未初始化');
      return;
    }

    const prevName = this._currentScene?.name ?? '';
    if (this._currentScene) {
      TweenManager.cancelTarget(this._currentScene.container);
      this._currentScene.onExit?.();
      Game.stage.removeChild(this._currentScene.container);
    }

    Game.stage.pivot.set(0, 0);
    OverlayManager.closeAllPanels();
    OverlayManager.resetTransform();
    TweenManager.cancelTarget(nextScene.container);

    this._currentScene = nextScene;
    Game.stage.addChild(nextScene.container);
    nextScene.onEnter?.();
    OverlayManager.bringToFront();
    console.log(`[SceneManager] 切换到场景: ${name}`);

    // 每次场景切换后安全卸载上一场景残留大图与已关闭弹窗贴图，并将显存按 LRU 控制在安全水位内
    if (prevName && prevName !== name) {
      globalThis.setTimeout(() => {
        const curName = this._currentScene?.name;
        if (!curName) return;
        pruneMapSlotCache(curName !== 'market');
        const evicted = trimTexturesToBudget(45, true);
        if (evicted > 0) {
          console.log(`[SceneManager] 场景切换(${prevName} -> ${curName})释放闲置纹理 ${evicted} 张`);
          Platform.triggerGC();
        }
      }, 60);
    }
  }

  get current(): Scene | null {
    return this._currentScene;
  }
}

export const SceneManager = new SceneManagerClass();
