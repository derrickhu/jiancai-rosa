/**
 * 经分埋点：SDK 初始化 + 业务门面（对齐 xiaochu2 / huahua）
 *
 * - GAME_KEY / ENDPOINT 单一真源：@/config/CloudConfig
 * - 经分 gameKey 必须用 BASE_GAME_KEY（jiancai），平台分流走 platform 字段
 * - 业务侧只 import { analytics, initAnalytics, setAnalyticsUserId } from '@/analytics'
 */
import {
  Analytics,
  EVENT_NAMES,
  type DeviceInfo,
  type EventParamValue,
  type PlatformName,
} from '@gp/analytics-sdk';

import { ANALYTICS_ENDPOINT } from '@/config/CloudConfig';
import { BASE_GAME_KEY } from '@/config/gameKeyScope';
import { Platform } from '@/core/PlatformService';

export { EVENT_NAMES };
export type AnalyticsParams = Record<string, EventParamValue>;

/** 新手漏斗 step_id，顺序即漏斗顺序；上线后不要改名。 */
export const TUTORIAL_STEPS = {
  intro: 'intro',
  goOut: 'go_out',
  pickXiangko: 'pick_xiangko',
  clickCard: 'click_card',
  clickPile: 'click_pile',
  takeLoot: 'take_loot',
  openBasket: 'open_basket',
  basketDry: 'basket_dry',
  basketWet: 'basket_wet',
  closeBasket: 'close_basket',
  returnMap: 'return_map',
  freeWalk: 'free_walk',
  goHome: 'go_home',
  waitResult: 'wait_result',
  cookTable: 'cook_table',
  cookDish: 'cook_dish',
  openFridge: 'open_fridge',
  inspectDish: 'inspect_dish',
  sellDish: 'sell_dish',
  claimGift: 'claim_gift',
  hintDoor: 'hint_door',
  completed: 'completed',
} as const;

declare const __APP_VERSION__: string;

let inited = false;

function track(eventName: string, params: AnalyticsParams = {}): void {
  if (!inited) return;
  try {
    Analytics.track(eventName, params);
  } catch {
    /* SDK 未就绪或上报失败不挡玩 */
  }
}

/** SDK 初始化：main.ts 启动尽早调用；此时不要打 session_start。 */
export function initAnalytics(opts?: { endpoint?: string; userId?: string; debug?: boolean }): void {
  if (inited) return;

  Analytics.init({
    endpoint: opts?.endpoint || ANALYTICS_ENDPOINT,
    gameKey: BASE_GAME_KEY,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0',
    platform: mapPlatform(),
    deviceInfo: buildDeviceInfo(),
    initialUserId: opts?.userId,
    transport: { request: Platform.request.bind(Platform) },
    storage: {
      get: Platform.getStorageSync.bind(Platform),
      set: Platform.setStorageSync.bind(Platform),
      remove: Platform.removeStorageSync.bind(Platform),
    },
    lifecycle: { onHide: Platform.onHide.bind(Platform) },
    debug: opts?.debug ?? Platform.isDevtools,
  });

  inited = true;
  console.log(`[analytics] init gameKey=${BASE_GAME_KEY} platform=${mapPlatform()}`);
}

/** 登录拿到 openid 后调用；SDK 内部自动 track login + flush */
export function setAnalyticsUserId(userId: string): void {
  if (!inited) return;
  Analytics.setUserId(userId || '');
  if (userId) {
    console.log(`[analytics] setUserId userId=${userId}`);
  } else {
    console.warn('[analytics] setUserId skipped: empty userId');
  }
}

export const analytics = {
  track,

  trackSessionStart(params: AnalyticsParams = {}): void {
    track(EVENT_NAMES.SESSION_START, {
      entry: 'main',
      with_user_id: false,
      ...params,
    });
  },

  trackSessionEnd(reasonOrParams: string | AnalyticsParams = 'app-hide'): void {
    const params = typeof reasonOrParams === 'string'
      ? { reason: reasonOrParams }
      : reasonOrParams;
    track(EVENT_NAMES.SESSION_END, params);
  },

  trackAppShow(params: AnalyticsParams = {}): void {
    track(EVENT_NAMES.APP_SHOW, params);
  },

  trackAppError(error: unknown, extra: AnalyticsParams = {}): void {
    const err = error as { message?: string; errMsg?: string; stack?: string; errCode?: number };
    track(EVENT_NAMES.APP_ERROR, {
      err_msg: String(err?.message || err?.errMsg || error || 'unknown').slice(0, 240),
      err_code: err?.errCode == null ? -1 : Number(err.errCode),
      stack: err?.stack ? String(err.stack).slice(0, 500) : '',
      ...extra,
    });
  },

  trackTutorialStep(stepId: string, params: {
    stepIndex: number;
    status?: 'done' | 'skip';
    durationMs?: number;
  } & AnalyticsParams): void {
    const { stepIndex, status, durationMs, ...extra } = params;
    track(EVENT_NAMES.TUTORIAL_STEP, {
      step_id: stepId,
      step_index: Math.max(1, Math.floor(stepIndex)),
      status: status || 'done',
      ...(durationMs != null ? { duration_ms: Math.max(0, Math.floor(durationMs)) } : {}),
      ...extra,
    });
  },

  trackQuestStart(questId: string, questType: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.QUEST_START, { quest_id: questId, quest_type: questType, ...extra });
  },

  trackQuestComplete(questId: string, questType: string, params: {
    durationMs: number;
  } & AnalyticsParams): void {
    const { durationMs, ...extra } = params;
    track(EVENT_NAMES.QUEST_COMPLETE, {
      quest_id: questId,
      quest_type: questType,
      duration_ms: Math.max(0, Math.floor(durationMs)),
      ...extra,
    });
  },

  trackQuestAbandon(questId: string, questType: string, reason: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.QUEST_ABANDON, {
      quest_id: questId,
      quest_type: questType,
      reason,
      ...extra,
    });
  },

  trackAdRequest(scene: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.AD_REQUEST, { scene, ad_type: 'reward', ...extra });
  },

  trackAdShow(scene: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.AD_SHOW, { scene, ad_type: 'reward', ...extra });
  },

  trackAdClose(scene: string, isEnded: boolean, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.AD_CLOSE, { scene, ad_type: 'reward', is_ended: isEnded, ...extra });
  },

  trackAdError(scene: string, errCode: number, errMsg: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.AD_ERROR, {
      scene,
      ad_type: 'reward',
      err_code: Number(errCode),
      err_msg: String(errMsg || 'unknown').slice(0, 240),
      ...extra,
    });
  },

  trackShareAppMessage(entryPoint: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.SHARE_APP_MESSAGE, { entry_point: entryPoint, ...extra });
  },

  trackShareTimeline(entryPoint: string, extra: AnalyticsParams = {}): void {
    track(EVENT_NAMES.SHARE_TIMELINE, { entry_point: entryPoint, ...extra });
  },
};

function mapPlatform(): PlatformName {
  if (Platform.name === 'douyin') return 'douyin';
  if (Platform.name === 'wechat') return 'wechat';
  return Platform.isMinigame ? 'unknown' : 'h5';
}

function buildDeviceInfo(): DeviceInfo {
  const sys = Platform.getSystemInfoSync() || {};
  return {
    brand: String(sys.brand || ''),
    model: String(sys.model || ''),
    system: String(sys.system || sys.platform || ''),
    sdkVersion: String(sys.SDKVersion || sys.sdkVersion || ''),
    screenWidth: Number(sys.screenWidth) || 0,
    screenHeight: Number(sys.screenHeight) || 0,
    network: 'unknown',
  };
}
