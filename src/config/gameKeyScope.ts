/**
 * GameKey 平台命名空间 —— 多平台数据隔离标准
 *
 * - 微信 / H5：jiancai_{suffix}
 * - 抖音：      jiancai_tt_{suffix}
 *
 * 隔离范围：本地存储 key、云端集合、经分 gameKey。
 * 不隔离：CloudBase HTTP 路由前缀（/jiancai-api），两端共用同一套云函数，由 JWT 里的 plt 分流。
 */
import {
  detectMinigamePlatform,
  type BackendPlatformCode,
  type PlatformName,
} from '@/core/platformDetect';
import { GAME_KEY } from './CloudConfig';

/** 游戏根标识（云函数名 / HTTP 前缀，不含平台段） */
export const BASE_GAME_KEY = GAME_KEY;

/** 非微信宿主在 GAME_KEY 与 suffix 之间插入的平台段（当前仅抖音 tt） */
export type PlatformScopeSegment = 'tt';

const PLATFORM_SCOPE: Partial<Record<PlatformName, PlatformScopeSegment>> = {
  douyin: 'tt',
};

const BACKEND_SCOPE: Partial<Record<BackendPlatformCode, PlatformScopeSegment>> = {
  dy: 'tt',
};

export function getPlatformScope(
  platform: PlatformName = detectMinigamePlatform(),
): PlatformScopeSegment | null {
  return PLATFORM_SCOPE[platform] ?? null;
}

export function getPlatformScopeFromBackend(platform: string): PlatformScopeSegment | null {
  const code = String(platform || '').toLowerCase() as BackendPlatformCode;
  return BACKEND_SCOPE[code] ?? null;
}

/** 存档 / 集合 / 经分 gameKey 使用的命名空间：jiancai 或 jiancai_tt */
export function getScopedGameKey(platform: PlatformName = detectMinigamePlatform()): string {
  const scope = getPlatformScope(platform);
  return scope ? `${BASE_GAME_KEY}_${scope}` : BASE_GAME_KEY;
}

export function getScopedGameKeyFromBackend(platform: string): string {
  const scope = getPlatformScopeFromBackend(platform);
  return scope ? `${BASE_GAME_KEY}_${scope}` : BASE_GAME_KEY;
}

/** jiancai_save / jiancai_tt_save */
export function scopedStorageKey(
  suffix: string,
  platform: PlatformName = detectMinigamePlatform(),
): string {
  return `${getScopedGameKey(platform)}_${suffix}`;
}

/**
 * 把业务里写死的 `jiancai_xxx` 存储 key 映射到当前平台命名空间。
 *
 * 由 PlatformService 的存储方法统一调用，业务代码无需感知：微信原样返回，抖音统一插入 `_tt` 段。
 * 幂等——已带命名空间的 key 不会被二次加前缀。
 */
export function scopeStorageKey(
  key: string,
  platform: PlatformName = detectMinigamePlatform(),
): string {
  const scope = getPlatformScope(platform);
  if (!scope || !key) return key;

  const scopedPrefix = `${BASE_GAME_KEY}_${scope}`;
  if (key === scopedPrefix || key.startsWith(`${scopedPrefix}_`)) return key;
  if (key === BASE_GAME_KEY) return scopedPrefix;
  if (key.startsWith(`${BASE_GAME_KEY}_`)) {
    return `${scopedPrefix}_${key.slice(BASE_GAME_KEY.length + 1)}`;
  }
  return `${scopedPrefix}_${key}`;
}
