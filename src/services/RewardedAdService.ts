import { REWARDED_AD_UNITS, type RewardedAdScene } from '@/config/AdsConfig';
import { Platform } from '@/core/PlatformService';

export type RewardedAdResult = 'completed' | 'skipped' | 'unavailable' | 'error';

type RewardedVideoAd = {
  load: () => Promise<void>;
  show: () => Promise<void>;
  onClose: (handler: (res?: { isEnded?: boolean }) => void) => void;
  onError: (handler: (err: { errMsg?: string; errCode?: number }) => void) => void;
};

const ads = new Map<string, RewardedVideoAd>();
const bound = new Set<string>();
let pending: { unitId: string; resolve: (result: RewardedAdResult) => void } | null = null;

function finish(unitId: string, result: RewardedAdResult): void {
  if (pending?.unitId !== unitId) return;
  const { resolve } = pending;
  pending = null;
  resolve(result);
  ads.get(unitId)?.load().catch((error) => {
    console.warn('[RewardedAd] reload failed', unitId, error);
  });
}

function bind(ad: RewardedVideoAd, unitId: string): void {
  if (bound.has(unitId)) return;
  bound.add(unitId);
  ad.onClose((res) => {
    finish(unitId, res?.isEnded === false ? 'skipped' : 'completed');
  });
  ad.onError((err) => {
    console.warn('[RewardedAd] error', unitId, err);
    if (pending?.unitId === unitId) finish(unitId, 'error');
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
  if (!Platform.api?.createRewardedVideoAd) return 'unavailable';
  if (pending) return 'error';
  const ad = getAd(unitId);
  if (!ad) return 'unavailable';
  return new Promise((resolve) => {
    pending = { unitId, resolve };
    ad.show()
      .catch(() => ad.load().then(() => ad.show()))
      .catch((error) => {
        console.warn('[RewardedAd] show failed', unitId, error);
        finish(unitId, 'error');
      });
  });
}
