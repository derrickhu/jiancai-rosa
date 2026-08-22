/**
 * 宿主识别（单一真源）
 *
 * 独立成模块，是为了让 config/gameKeyScope 与 core/PlatformService 都能引用而不形成循环依赖。
 * 抖音宿主同时注入了 wx 兼容层，因此必须先判 tt，否则抖音会被误判成微信。
 */

declare const wx: any;
declare const tt: any;

export type PlatformName = 'wechat' | 'douyin' | 'unknown';

/** 后端 /login 的 platform 字段 */
export type BackendPlatformCode = 'wx' | 'dy' | 'anon';

export function detectMinigamePlatform(): PlatformName {
  if (typeof tt !== 'undefined') return 'douyin';
  if (typeof wx !== 'undefined') return 'wechat';
  return 'unknown';
}

/** 指定宿主的原生 API：抖音只取 tt，微信只取 wx，避免误用兼容层 */
export function getNativePlatformApi(platform: PlatformName = detectMinigamePlatform()): any {
  if (platform === 'douyin') return typeof tt !== 'undefined' ? tt : null;
  if (platform === 'wechat') return typeof wx !== 'undefined' ? wx : null;
  return null;
}

export function toBackendPlatformCode(
  platform: PlatformName = detectMinigamePlatform(),
): BackendPlatformCode {
  if (platform === 'wechat') return 'wx';
  if (platform === 'douyin') return 'dy';
  return 'anon';
}
