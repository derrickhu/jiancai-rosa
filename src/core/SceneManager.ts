import * as PIXI from 'pixi.js';
import { Game } from './Game';
import { TweenManager } from './TweenManager';
import { OverlayManager } from './OverlayManager';

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
  }

  get current(): Scene | null {
    return this._currentScene;
  }
}

export const SceneManager = new SceneManagerClass();
