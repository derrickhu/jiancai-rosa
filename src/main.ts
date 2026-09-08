import '@/core/pixiUnsafeEvalPatch';
import { SAVE_KEY } from '@/config/CloudConfig';
import { EV } from '@/config/events';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { type CloudImportInfo, PersistService } from '@/core/PersistService';
import { Platform } from '@/core/PlatformService';
import { SceneManager } from '@/core/SceneManager';
import { CloudSyncManager } from '@/managers/CloudSyncManager';
import { SaveManager } from '@/managers/SaveManager';
import { DestinationScene } from '@/scenes/DestinationScene';
import { KitchenScene } from '@/scenes/KitchenScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { MarketScene } from '@/scenes/MarketScene';
import { SpecialMarketScene } from '@/scenes/SpecialMarketScene';
import { AudioManager } from '@/core/AudioManager';
import { CdnAssetService } from '@/core/CdnAssetService';
import { gameTexture, isTextureFailed, isTextureReady, preloadTextures } from '@/utils/assets';
import { kitchenBootPaths, kitchenCriticalPaths } from '@/utils/bootAssets';

const BOOT_HOLD_MS = 480;
const BOOT_HANG_MS = 40000;

function handleCloudSaveReload(info: CloudImportInfo): void {
  console.warn(
    `[jiancai] 云端核心存档已覆盖本地，准备刷新 reason=${info.reason}, updatedAt=${info.updatedAt}`,
  );
  Platform.showToast('已恢复云端存档，正在刷新', 'none');
  if (Platform.restartMiniProgram()) return;
  SaveManager.load();
  EventBus.emit(EV.kitchenChanged);
}

async function main(): Promise<void> {
  const canvas = (typeof GameGlobal !== 'undefined' && GameGlobal.canvas)
    ? GameGlobal.canvas
    : (globalThis as any).canvas;
  if (!canvas) {
    console.error('[jiancai] 找不到主 canvas');
    return;
  }

  Game.init(canvas);
  AudioManager.init();

  const loading = new LoadingScene();
  SceneManager.register(loading);
  SceneManager.switchTo('loading');

  let initialSaveLoaded = false;
  PersistService.subscribeCloudImport((info) => {
    if (!info.changedKeys.includes(SAVE_KEY)) return;
    if (!initialSaveLoaded) return;
    handleCloudSaveReload(info);
  });

  CloudSyncManager.prewarm();
  const startupSync = await CloudSyncManager.awaitStartupSync();
  console.log(`[jiancai] 云同步启动结果: ${startupSync.status}, reason=${startupSync.reason}`);

  SaveManager.load();
  initialSaveLoaded = true;

  const started = Date.now();
  const enterKitchen = (): void => {
    if (SceneManager.current !== loading) return;
    loading.setProgress(1);
    SceneManager.register(new KitchenScene());
    SceneManager.register(new DestinationScene());
    SceneManager.register(new MarketScene());
    SceneManager.register(new SpecialMarketScene());
    SceneManager.switchTo('kitchen');
  };

  await CdnAssetService.fetchManifest();
  const save = SaveManager.data;
  const paths = kitchenBootPaths(save);
  const critical = kitchenCriticalPaths(save);
  const loaded = preloadTextures(paths, (done, total) => {
    loading.setProgress(0.08 + done / Math.max(1, total) * 0.82);
  });
  const audioReady = AudioManager.preloadSfx();
  const hang = new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, BOOT_HANG_MS);
  });
  await Promise.race([Promise.all([loaded, audioReady]), hang]);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const ready = critical.every((path) => {
      const tex = gameTexture(path);
      return isTextureReady(tex) || isTextureFailed(path);
    });
    if (ready) break;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200));
  }
  loading.setProgress(1);
  const wait = Math.max(0, BOOT_HOLD_MS - (Date.now() - started));
  globalThis.setTimeout(enterKitchen, wait);

  Platform.onHide(() => {
    SaveManager.flush();
    void CloudSyncManager.flushNow('hide');
  });

  console.log(`[jiancai] 启动完成 v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}`);
}

void main();
