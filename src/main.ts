import '@/core/pixiUnsafeEvalPatch';
import { Game } from '@/core/Game';
import { SceneManager } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { SaveManager } from '@/managers/SaveManager';
import { KitchenScene } from '@/scenes/KitchenScene';
import { DestinationScene } from '@/scenes/DestinationScene';
import { MarketScene } from '@/scenes/MarketScene';

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
  SceneManager.register(new KitchenScene());
  SceneManager.register(new DestinationScene());
  SceneManager.register(new MarketScene());
  SceneManager.switchTo('kitchen');

  Platform.onHide(() => {
    SaveManager.flush();
  });

  console.log(`[jiancai] 启动完成 v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}`);
}

main();
