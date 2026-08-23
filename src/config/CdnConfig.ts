/**
 * CDN 资源配置（微信云存储版，对齐花花）
 *
 * 同一 CloudBase 环境多游戏用 filePrefix 隔离。
 * 游戏代码继续写 minigame 根下的逻辑路径，如 `subpkg_images/market_route_1.jpg`。
 * 大图走 CDN；首屏厨房 / HUD / 小 UI 留在包内。
 */

export interface CdnConfig {
  enabled: boolean;
  appId: string;
  cloudEnv: string;
  cloudBucket: string;
  baseUrl: string;
  filePrefix: string;
  cacheRootName: string;
  downloadRetry: number;
  downloadTimeoutMs: number;
  cdnDirs: readonly string[];
  /** 仅这些前缀算 CDN；同目录里未命中的仍打进微信包。 */
  cdnPrefixes: readonly string[];
  bundledDirs: readonly string[];
  ignoreFiles: readonly string[];
}

export const CDN_CONFIG: CdnConfig = {
  enabled: true,
  appId: 'wx41ac821080ff87f9',
  cloudEnv: 'rosa-env-d7grf78r5dbd37323',
  cloudBucket: '726f-rosa-env-d7grf78r5dbd37323-1414200063',
  baseUrl: 'https://726f-rosa-env-d7grf78r5dbd37323-1414200063.tcb.qcloud.la',
  filePrefix: 'jiancai/assets_cdn',
  cacheRootName: 'jiancai_cdn_cache_v1',
  downloadRetry: 2,
  downloadTimeoutMs: 30000,
  cdnDirs: [
    'subpkg_images',
  ],
  cdnPrefixes: [
    'subpkg_images/market_route_',
    'subpkg_images/market_card',
    'subpkg_images/market_overview',
    'subpkg_images/stall_rummage_',
    'subpkg_images/stall_pile_',
    'subpkg_images/outing_curtain',
    'subpkg_images/dest_',
    'subpkg_images/dish_',
    'subpkg_images/npc_',
  ],
  bundledDirs: [
    'boot',
    'subpkg_kitchen',
  ],
  ignoreFiles: ['game.js', '.DS_Store', 'Thumbs.db', '.gitkeep'],
};
