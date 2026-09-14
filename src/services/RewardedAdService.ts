import { analytics } from '@/analytics';
import { REWARDED_AD_UNITS, type RewardedAdScene } from '@/config/AdsConfig';
import { Platform } from '@/core/PlatformService';

export type RewardedAdResult = 'completed' | 'skipped' | 'unavailable' | 'error';

type RewardedVideoAd = {
  load: () => Promise<void>;
  show: () => Promise<void>;
  onClose: (handler: (res?: { isEnded?: boolean }) => void) => void;
  onError: (handler: (err: { errMsg?: string; errCode?: number }) => void) => void;
};

const SDK_ERR_UNAVAILABLE = -100;
const SDK_ERR_BUSY = -101;

const ads = new Map<string, RewardedVideoAd>();
const bound = new Set<string>();
let pending: { unitId: string; scene: RewardedAdScene; resolve: (result: RewardedAdResult) => void } | null = null;
let errorReportedThisCycle = false;

function adExtras(unitId: string): { ad_unit_id: string } {
  return { ad_unit_id: unitId };
}

function reportAdErrorOnce(scene: RewardedAdScene, unitId: string, errCode: number, errMsg: string): void {
  if (errorReportedThisCycle) return;
  errorReportedThisCycle = true;
  analytics.trackAdError(scene, errCode, errMsg, adExtras(unitId));
}

function finish(unitId: string, result: RewardedAdResult, isEnded?: boolean): void {
  if (pending?.unitId !== unitId) return;
  const { resolve, scene } = pending;
  pending = null;
  if (result === 'completed' || result === 'skipped') {
    analytics.trackAdClose(scene, isEnded === true, adExtras(unitId));
  }
  resolve(result);
  ads.get(unitId)?.load().catch((error) => {
    console.warn('[RewardedAd] reload failed', unitId, error);
  });
}

function bind(ad: RewardedVideoAd, unitId: string): void {
  if (bound.has(unitId)) return;
  bound.add(unitId);
  ad.onClose((res) => {
    const skipped = res?.isEnded === false;
    finish(unitId, skipped ? 'skipped' : 'completed', !skipped);
  });
  ad.onError((err) => {
    console.warn('[RewardedAd] error', unitId, err);
    if (pending?.unitId !== unitId) return;
    reportAdErrorOnce(
      pending.scene,
      unitId,
      Number(err?.errCode ?? -1),
      String(err?.errMsg || 'ad_on_error'),
    );
    finish(unitId, 'error');
  });
}

function getAd(unitId: string): RewardedVideoAd | null {
  const api = Platform.api;
  if (!api?.createRewardedVideoAd) return null;
  const existing = ads.get(unitId);
  if (existing) {
    bind(existing, unitId);
    return existing;
  }
  try {
    const ad = api.createRewardedVideoAd(
      Platform.name === 'wechat' ? { adUnitId: unitId, multiton: true } : { adUnitId: unitId },
    ) as RewardedVideoAd;
    ads.set(unitId, ad);
    bind(ad, unitId);
    return ad;
  } catch (error) {
    console.warn('[RewardedAd] create failed', unitId, error);
    return null;
  }
}

export function warmupRewardedAds(): void {
  for (const unitId of Object.values(REWARDED_AD_UNITS)) {
    const ad = getAd(unitId);
    ad?.load().catch((error) => {
      console.warn('[RewardedAd] warmup failed', unitId, error);
    });
  }
}

export async function playRewardedAd(scene: RewardedAdScene): Promise<RewardedAdResult> {
  const unitId = REWARDED_AD_UNITS[scene];
  if (!Platform.api?.createRewardedVideoAd) {
    analytics.trackAdError(scene, SDK_ERR_UNAVAILABLE, 'no_ad_api', adExtras(unitId));
    return 'unavailable';
  }
  if (pending) {
    analytics.trackAdError(scene, SDK_ERR_BUSY, 'busy', adExtras(unitId));
    return 'error';
  }
  const ad = getAd(unitId);
  if (!ad) {
    analytics.trackAdError(scene, SDK_ERR_UNAVAILABLE, 'no_ad_instance', adExtras(unitId));
    return 'unavailable';
  }

  analytics.trackAdRequest(scene, adExtras(unitId));
  errorReportedThisCycle = false;

  return new Promise((resolve) => {
    pending = { unitId, scene, resolve };
    ad.show()
      .then(() => {
        analytics.trackAdShow(scene, adExtras(unitId));
      })
      .catch(() => ad.load().then(() => ad.show().then(() => {
        analytics.trackAdShow(scene, adExtras(unitId));
      })))
      .catch((error) => {
        console.warn('[RewardedAd] show failed', unitId, error);
        const err = error as { errCode?: number; errMsg?: string; message?: string };
        reportAdErrorOnce(
          scene,
          unitId,
          Number(err?.errCode ?? -1),
          String(err?.errMsg || err?.message || 'show_failed'),
        );
        finish(unitId, 'error');
      });
  });
}
