/**
 * 插屏广告服务（从菜场 / 选集市页返回厨房时尝试播放）。
 * - 按宿主读取 INTERSTITIAL_AD_UNITS_BY_PLATFORM（抖音已配好，微信留空时自动跳过，填号即开启）。
 * - 完整接入经分四阶段埋点：ad_request -> ad_show -> ad_close / ad_error（ad_type: 'interstitial'）。
 * - 失败、频控、新手指引、开发者工具均静默跳过，绝不阻塞回厨房跳转。
 */
import { analytics, type AdTrackOptions } from '@/analytics';
import { INTERSTITIAL_AD_UNITS_BY_PLATFORM } from '@/config/AdsConfig';
import { Platform } from '@/core/PlatformService';
import { TutorialManager } from '@/managers/TutorialManager';

const COLD_START_MS = 30_000;
const MIN_INTERVAL_MS = 60_000;
const LOAD_TIMEOUT_MS = 5_000;

const SDK_ERR_UNAVAILABLE = -100;
const SDK_ERR_BUSY = -101;
const SDK_ERR_TIMEOUT = -102;

type NativeInterstitialAd = {
  load?: () => Promise<void> | void;
  show?: () => Promise<void> | void;
  destroy?: () => void;
  onLoad?: (fn: () => void) => void;
  onClose?: (fn: () => void) => void;
  onError?: (fn: (err?: { errCode?: number; errMsg?: string }) => void) => void;
};

let bootAt = 0;
let lastShowAt = 0;
let showing = false;

function currentInterstitialUnitId(): string {
  if (Platform.isDouyin) return INTERSTITIAL_AD_UNITS_BY_PLATFORM.douyin;
  if (Platform.isWechat) return INTERSTITIAL_AD_UNITS_BY_PLATFORM.wechat;
  return '';
}

function interstitialOpts(unitId: string): AdTrackOptions {
  return { ad_type: 'interstitial', ad_unit_id: unitId };
}

function skipReason(unitId: string): string | null {
  if (!Platform.isDouyin && !Platform.isWechat) return '非微信/抖音宿主';
  if (!unitId) return '未配置插屏广告位';
  if (Platform.isDevtools) return '开发者工具';
  if (TutorialManager.isActive) return '新手指引中';
  if (!bootAt) bootAt = Date.now();
  const now = Date.now();
  if (now - bootAt < COLD_START_MS) return '冷启动未满 30 秒';
  if (lastShowAt > 0 && now - lastShowAt < MIN_INTERVAL_MS) return '距上次不足 60 秒';
  return null;
}

/** 尝试播一支插屏。不抛错，不挡后续跳转。 */
export async function tryShowInterstitial(scene: string): Promise<boolean> {
  if (!bootAt) bootAt = Date.now();
  const unitId = currentInterstitialUnitId();
  const skip = skipReason(unitId);
  if (skip) {
    console.log(`[Interstitial] 跳过 ${scene}: ${skip}`);
    return false;
  }

  const opts = interstitialOpts(unitId);
  if (showing) {
    analytics.trackAdError(scene, SDK_ERR_BUSY, 'interstitial_busy', opts);
    return false;
  }

  const api = Platform.api;
  const create = api?.createInterstitialAd;
  if (typeof create !== 'function') {
    analytics.trackAdError(scene, SDK_ERR_UNAVAILABLE, 'no_interstitial_api', opts);
    return false;
  }

  showing = true;
  analytics.trackAdRequest(scene, opts);

  const ok = await new Promise<boolean>((resolve) => {
    let ad: NativeInterstitialAd | null = null;
    let settled = false;
    let shown = false;
    let errorReported = false;

    const reportErr = (code: number, msg: string): void => {
      if (errorReported) return;
      errorReported = true;
      analytics.trackAdError(scene, code, msg, opts);
    };

    const finish = (closedAfterShow: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        ad?.destroy?.();
      } catch {
        /* ignore destroy error */
      }
      if (closedAfterShow) {
        analytics.trackAdClose(scene, true, opts);
      }
      resolve(closedAfterShow);
    };

    try {
      ad = create.call(api, { adUnitId: unitId }) as NativeInterstitialAd;
    } catch (e) {
      const err = e as { errCode?: number; errMsg?: string; message?: string };
      reportErr(Number(err?.errCode ?? -1), String(err?.errMsg || err?.message || 'create_failed'));
      showing = false;
      resolve(false);
      return;
    }

    if (!ad?.show) {
      reportErr(SDK_ERR_UNAVAILABLE, 'no_show_method');
      finish(false);
      return;
    }

    const markShown = (): void => {
      if (shown) return;
      shown = true;
      analytics.trackAdShow(scene, opts);
    };

    ad.onError?.((err) => {
      reportErr(Number(err?.errCode ?? -1), String(err?.errMsg || 'interstitial_on_error'));
      finish(false);
    });

    ad.onClose?.(() => {
      finish(shown);
    });

    ad.onLoad?.(() => {
      if (settled || shown) return;
      try {
        const pendingShow = ad?.show?.();
        if (pendingShow && typeof (pendingShow as Promise<void>).then === 'function') {
          (pendingShow as Promise<void>)
            .then(() => {
              markShown();
            })
            .catch((e) => {
              const err = e as { errCode?: number; errMsg?: string; message?: string };
              reportErr(Number(err?.errCode ?? -1), String(err?.errMsg || err?.message || 'show_failed'));
              finish(false);
            });
        } else {
          markShown();
        }
      } catch (e) {
        const err = e as { errCode?: number; errMsg?: string; message?: string };
        reportErr(Number(err?.errCode ?? -1), String(err?.errMsg || err?.message || 'show_threw'));
        finish(false);
      }
    });

    setTimeout(() => {
      if (!settled && !shown) {
        reportErr(SDK_ERR_TIMEOUT, 'load_timeout');
        finish(false);
      }
    }, LOAD_TIMEOUT_MS);
  });

  showing = false;
  if (ok) lastShowAt = Date.now();
  console.log(`[Interstitial] ${scene} show=${ok}`);
  return ok;
}
