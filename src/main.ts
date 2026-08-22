import '@/core/pixiUnsafeEvalPatch';
import { Game } from '@/core/Game';
import { SceneManager } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { SaveManager } from '@/managers/SaveManager';
import { LoadingScene } from '@/scenes/LoadingScene';
import { KitchenScene } from '@/scenes/KitchenScene';
import { DestinationScene } from '@/scenes/DestinationScene';
import { MarketScene } from '@/scenes/MarketScene';

const BOOT_HOLD_MS = 1100;

function main(): void {
  const canvas = (typeof GameGlobal !== 'undefined' && GameGlobal.canvas)
    ? GameGlobal.canvas
    : (globalThis as any).canvas;
  if (!canvas) {
    console.error('[jiancai] 找不到主 canvas');
    return;
  }

  Game.init(canvas);
  SaveManager.load();
  SceneManager.register(new LoadingScene());
  SceneManager.switchTo('loading');

  const started = Date.now();
  const enterKitchen = (): void => {
    SceneManager.register(new KitchenScene());
    SceneManager.register(new DestinationScene());
    SceneManager.register(new MarketScene());
    const wait = Math.max(0, BOOT_HOLD_MS - (Date.now() - started));
    globalThis.setTimeout(() => SceneManager.switchTo('kitchen'), wait);
  };
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  if (raf) raf(() => raf(enterKitchen));
  else enterKitchen();

  Platform.onHide(() => {
    SaveManager.flush();
  });

  console.log(`[jiancai] 启动完成 v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}`);
}

main();
