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
import { AudioManager } from '@/core/AudioManager';
import { CdnAssetService } from '@/core/CdnAssetService';
import { preloadTextures } from '@/utils/assets';
import { kitchenBootPaths } from '@/utils/bootAssets';

const BOOT_HOLD_MS = 480;
const BOOT_MAX_MS = 12000;

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
    SceneManager.switchTo('kitchen');
  };

  await CdnAssetService.fetchManifest();
  const paths = kitchenBootPaths(SaveManager.data);
  const loaded = preloadTextures(paths, (done, total) => {
    loading.setProgress(done / Math.max(1, total) * 0.85);
  });
  const audioReady = AudioManager.preloadSfx().then(() => {
    loading.setProgress(1);
  });
  const timeout = new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, BOOT_MAX_MS);
  });
  void Promise.race([Promise.all([loaded, audioReady]), timeout]).then(() => {
    const wait = Math.max(0, BOOT_HOLD_MS - (Date.now() - started));
    globalThis.setTimeout(enterKitchen, wait);
  });

  Platform.onHide(() => {
    SaveManager.flush();
    void CloudSyncManager.flushNow('hide');
  });

  console.log(`[jiancai] 启动完成 v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}`);
}

void main();
