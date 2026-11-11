/**
 * 抖音插屏。只在从菜场回家时试一次。
 * 失败、频控、新手指引里都不挡进厨房。开发者工具经常没填充，直接跳过。
 */
import { DOUYIN_INTERSTITIAL_AD_UNIT } from '@/config/AdsConfig';
import { analytics } from '@/analytics';
import { Platform } from '@/core/PlatformService';
import { TutorialManager } from '@/managers/TutorialManager';

const COLD_START_MS = 30_000;
const MIN_INTERVAL_MS = 60_000;

let bootAt = 0;
let lastShowAt = 0;

function skipReason(): string | null {
  if (!Platform.isDouyin) return '非抖音';
  if (Platform.isDevtools) return '开发者工具';
  if (TutorialManager.isActive) return '新手指引';
  if (!DOUYIN_INTERSTITIAL_AD_UNIT) return '未配置插屏';
  if (!bootAt) bootAt = Date.now();
  const now = Date.now();
  if (now - bootAt < COLD_START_MS) return '冷启动未满 30 秒';
  if (lastShowAt > 0 && now - lastShowAt < MIN_INTERVAL_MS) return '距上次不足 60 秒';
  return null;
}

/** 尝试播一支插屏。不抛错，不挡后续跳转。 */
export async function tryShowInterstitial(scene: string): Promise<boolean> {
  const skip = skipReason();
  if (skip) {
    console.log(`[Interstitial] 跳过 ${scene}: ${skip}`);
    return false;
  }
  const unitId = DOUYIN_INTERSTITIAL_AD_UNIT;
  analytics.trackAdShow(scene, { ad_type: 'interstitial', ad_unit_id: unitId });
  const ok = await Platform.showInterstitialAd(unitId);
  analytics.trackAdClose(scene, ok, { ad_type: 'interstitial', ad_unit_id: unitId });
  if (ok) lastShowAt = Date.now();
  console.log(`[Interstitial] ${scene} show=${ok}`);
  return ok;
}
