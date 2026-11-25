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
import { PersistService } from '@/core/PersistService';
import { Platform } from '@/core/PlatformService';

export { EVENT_NAMES };
export type AnalyticsParams = Record<string, EventParamValue>;
export type AdTrackType = 'reward' | 'interstitial';

/** 业务自定义经分事件名（全部 snake_case，上线后保持稳定） */
export const GAME_EVENT_NAMES = {
  STEELYARD_SETTLE: 'steelyard_settle',
  MYSTERY_SACK_SETTLE: 'mystery_sack_settle',
  DUSK_EXTEND_CHOICE: 'dusk_extend_choice',
  UNPACK_SETTLE: 'unpack_settle',
  PICKLE_ACTION: 'pickle_action',
  CAT_ACTION: 'cat_action',
  GACHA_DRAW: 'gacha_draw',
  DAILY_MENU_ACTION: 'daily_menu_action',
  NEIGHBOR_ORDER_ACTION: 'neighbor_order_action',
  DEX_CLAIM: 'dex_claim',
  COOK_DISH: 'cook_dish',
  COOK_LEVEL_UP: 'cook_level_up',
  KITCHEN_UPGRADE: 'kitchen_upgrade',
  WELFARE_ACTION: 'welfare_action',
  FRIDGE_ACTION: 'fridge_action',
} as const;

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

function safeInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function safeNonNegInt(v: unknown, fallback = 0): number {
  return Math.max(0, safeInt(v, fallback));
}

function safeRate(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

function sanitizeParams(raw: Record<string, unknown>): AnalyticsParams {
  const out: AnalyticsParams = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k || v === undefined || v === null) continue;
    if (typeof v === 'boolean') {
      out[k] = v;
    } else if (typeof v === 'number') {
      out[k] = Number.isFinite(v) ? v : 0;
    } else if (typeof v === 'string') {
      out[k] = v.length > 240 ? v.slice(0, 240) : v;
    }
  }
  return out;
}

function track(eventName: string, params: Record<string, unknown> = {}): void {
  if (!inited || !eventName) return;
  try {
    Analytics.track(eventName, sanitizeParams(params));
  } catch {
    /* SDK 未就绪或上报失败不挡玩 */
  }
}

export interface AdTrackOptions extends Record<string, unknown> {
  ad_type?: AdTrackType;
  ad_unit_id?: string;
}

function buildAdTrackPayload(scene: string, opts: AdTrackOptions = {}): Record<string, unknown> {
  const { ad_type, ad_unit_id, ...rest } = opts;
  return {
    scene: String(scene || 'unknown'),
    ad_type: ad_type === 'interstitial' ? 'interstitial' : 'reward',
    ad_unit_id: String(ad_unit_id ?? ''),
    ...rest,
  };
}

const ANALYTICS_STORAGE_DEBOUNCE_MS = 300;
const _analyticsMem = new Map<string, string | null>();
const _analyticsDirty = new Map<string, string | null>();
let _analyticsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleAnalyticsStorageFlush(): void {
  if (_analyticsFlushTimer !== null) return;
  _analyticsFlushTimer = globalThis.setTimeout(() => {
    _analyticsFlushTimer = null;
    if (_analyticsDirty.size === 0) return;
    const entries = [..._analyticsDirty.entries()];
    _analyticsDirty.clear();
    void (async () => {
      for (const [k, v] of entries) {
        if (v === null) {
          await Platform.removeStorageAsync(k);
        } else {
          await Platform.setStorageAsync(k, v);
        }
      }
    })();
  }, ANALYTICS_STORAGE_DEBOUNCE_MS);
}

function _flushAnalyticsStorageSync(): void {
  if (_analyticsFlushTimer !== null) {
    clearTimeout(_analyticsFlushTimer);
    _analyticsFlushTimer = null;
  }
  if (_analyticsDirty.size === 0) return;
  const entries = [..._analyticsDirty.entries()];
  _analyticsDirty.clear();
  for (const [k, v] of entries) {
    if (v === null) {
      Platform.removeStorageSync(k);
    } else {
      Platform.setStorageSync(k, v);
    }
  }
}

/** SDK 初始化：main.ts 启动尽早调用；此时不要打 session_start。 */
export function initAnalytics(opts?: { endpoint?: string; userId?: string; debug?: boolean }): void {
  if (inited) return;

  PersistService.onBeforeFlush(_flushAnalyticsStorageSync);

  Analytics.init({
    endpoint: opts?.endpoint || ANALYTICS_ENDPOINT,
    gameKey: BASE_GAME_KEY,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0',
    platform: mapPlatform(),
    deviceInfo: buildDeviceInfo(),
    initialUserId: opts?.userId,
    transport: { request: Platform.request.bind(Platform) },
    storage: {
      get: (key: string): string | null => {
        if (_analyticsMem.has(key)) {
          return _analyticsMem.get(key) ?? null;
        }
        const val = Platform.getStorageSync(key);
        _analyticsMem.set(key, val);
        return val;
      },
      set: (key: string, value: string): void => {
        _analyticsMem.set(key, value);
        if (PersistService.isImmediateSyncActive) {
          _analyticsDirty.delete(key);
          Platform.setStorageSync(key, value);
          return;
        }
        _analyticsDirty.set(key, value);
        _scheduleAnalyticsStorageFlush();
      },
      remove: (key: string): void => {
        _analyticsMem.set(key, null);
        if (PersistService.isImmediateSyncActive) {
          _analyticsDirty.delete(key);
          Platform.removeStorageSync(key);
          return;
        }
        _analyticsDirty.set(key, null);
        _scheduleAnalyticsStorageFlush();
      },
    },
    lifecycle: {
      onHide: (cb: () => void) => {
        Platform.onHide(() => {
          try {
            cb();
          } finally {
            _flushAnalyticsStorageSync();
          }
        });
      },
    },
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
      err_code: err?.errCode == null ? -1 : safeInt(err.errCode, -1),
      stack: err?.stack ? String(err.stack).slice(0, 500) : '',
      ...extra,
    });
  },

  trackTutorialStep(stepId: string, params: {
    stepIndex: number;
    status?: 'done' | 'skip';
    durationMs?: number;
  } & Record<string, unknown>): void {
    const { stepIndex, status, durationMs, ...extra } = params;
    track(EVENT_NAMES.TUTORIAL_STEP, {
      step_id: stepId,
      step_index: Math.max(1, safeInt(stepIndex, 1)),
      status: status || 'done',
      ...(durationMs != null ? { duration_ms: safeNonNegInt(durationMs) } : {}),
      ...extra,
    });
  },

  // ── 赶集与特色集市漏斗（统一走 SDK 标准 quest_* 事件 + 细分交互事件） ──────────

  trackQuestStart(questId: string, questType: string, extra: Record<string, unknown> = {}): void {
    track(EVENT_NAMES.QUEST_START, { quest_id: questId, quest_type: questType, ...extra });
  },

  trackQuestComplete(questId: string, questType: string, params: {
    durationMs: number;
  } & Record<string, unknown>): void {
    const { durationMs, ...extra } = params;
    track(EVENT_NAMES.QUEST_COMPLETE, {
      quest_id: questId,
      quest_type: questType,
      duration_ms: safeNonNegInt(durationMs),
      ...extra,
    });
  },

  trackQuestAbandon(questId: string, questType: string, reason: string, extra: Record<string, unknown> = {}): void {
    track(EVENT_NAMES.QUEST_ABANDON, {
      quest_id: questId,
      quest_type: questType,
      reason,
      ...extra,
    });
  },

  /** 特色货车集市（香料摊 / 夜钓车 / 山货铺）进场 */
  trackSpecialMarketStart(params: {
    marketId: string;
    flavor?: string;
    rounds?: number;
    vehicleId?: string;
    cookLevel?: number;
  }): void {
    track(EVENT_NAMES.QUEST_START, {
      quest_id: `special_${params.marketId}`,
      quest_type: 'special_market',
      market_id: params.marketId,
      ...(params.flavor ? { flavor: params.flavor } : {}),
      ...(params.rounds != null ? { rounds_total: safeNonNegInt(params.rounds) } : {}),
      ...(params.vehicleId ? { vehicle_id: params.vehicleId } : {}),
      ...(params.cookLevel != null ? { cook_level: safeNonNegInt(params.cookLevel) } : {}),
    });
  },

  /** 特色货车集市结算离场 */
  trackSpecialMarketComplete(params: {
    marketId: string;
    durationMs: number;
    roundsPlayed: number;
    roundsTotal: number;
    itemCount: number;
    haulValue?: number;
    hitCount?: number;
    earlyLeave?: boolean;
    needsPick?: boolean;
  }): void {
    track(EVENT_NAMES.QUEST_COMPLETE, {
      quest_id: `special_${params.marketId}`,
      quest_type: 'special_market',
      market_id: params.marketId,
      duration_ms: safeNonNegInt(params.durationMs),
      rounds_played: safeNonNegInt(params.roundsPlayed),
      rounds_total: safeNonNegInt(params.roundsTotal),
      item_count: safeNonNegInt(params.itemCount),
      ...(params.haulValue != null ? { haul_value: safeNonNegInt(params.haulValue) } : {}),
      ...(params.hitCount != null ? { hit_count: safeNonNegInt(params.hitCount) } : {}),
      early_leave: Boolean(params.earlyLeave),
      needs_pick: Boolean(params.needsPick),
    });
  },

  /** 赶集普通菜场补充指标辅助格式化（供 RunManager 直接透传 extra） */
  formatOutingMetrics(params: {
    weatherId?: string;
    vehicleId?: string;
    cookLevel?: number;
    staminaCost?: number;
    basketCapacity?: number;
    basketUsedCells?: number;
    flexUnlocked?: boolean;
    duskExtended?: boolean;
    haulValue?: number;
    rarePlusCount?: number;
    needsPick?: boolean;
  }): Record<string, unknown> {
    const cap = safeNonNegInt(params.basketCapacity);
    const used = safeNonNegInt(params.basketUsedCells);
    return {
      ...(params.weatherId ? { weather_id: params.weatherId } : {}),
      ...(params.vehicleId ? { vehicle_id: params.vehicleId } : {}),
      ...(params.cookLevel != null ? { cook_level: safeNonNegInt(params.cookLevel) } : {}),
      ...(params.staminaCost != null ? { stamina_cost: safeNonNegInt(params.staminaCost) } : {}),
      ...(cap > 0 ? { basket_capacity: cap, basket_fill_rate: safeRate(used / cap) } : {}),
      ...(params.flexUnlocked != null ? { flex_unlocked: Boolean(params.flexUnlocked) } : {}),
      ...(params.duskExtended != null ? { dusk_extended: Boolean(params.duskExtended) } : {}),
      ...(params.haulValue != null ? { haul_value: safeNonNegInt(params.haulValue) } : {}),
      ...(params.rarePlusCount != null ? { rare_plus_count: safeNonNegInt(params.rarePlusCount) } : {}),
      ...(params.needsPick != null ? { needs_pick: Boolean(params.needsPick) } : {}),
    };
  },

  /** 老杆秤精品摊称重结算 */
  trackSteelyardSettle(params: {
    marketId?: string;
    phase: 'green' | 'steady' | 'miss' | string;
    action: 'pay' | 'ad_favor' | 'leave';
    feePaid: number;
    bonusItems: number;
  }): void {
    track(GAME_EVENT_NAMES.STEELYARD_SETTLE, {
      ...(params.marketId ? { market_id: params.marketId } : {}),
      phase: params.phase,
      action: params.action,
      fee_paid: safeNonNegInt(params.feePaid),
      bonus_items: safeNonNegInt(params.bonusItems),
    });
  },

  /** 神秘盲袋奇遇抽选与看广告全收 */
  trackMysterySackSettle(params: {
    marketId?: string;
    action: 'pick_one' | 'ad_sweep';
    ticketsGained?: number;
    goldGained?: number;
    itemsGained?: number;
  }): void {
    track(GAME_EVENT_NAMES.MYSTERY_SACK_SETTLE, {
      ...(params.marketId ? { market_id: params.marketId } : {}),
      action: params.action,
      tickets_gained: safeNonNegInt(params.ticketsGained),
      gold_gained: safeNonNegInt(params.goldGained),
      items_gained: safeNonNegInt(params.itemsGained),
    });
  },

  /** 天黑借手电筒续步弹窗决策 */
  trackDuskExtendChoice(params: {
    marketId?: string;
    action: 'extend_ad' | 'go_home';
    stepsAdded?: number;
    basketItems?: number;
  }): void {
    track(GAME_EVENT_NAMES.DUSK_EXTEND_CHOICE, {
      ...(params.marketId ? { market_id: params.marketId } : {}),
      action: params.action,
      steps_added: safeNonNegInt(params.stepsAdded),
      basket_items: safeNonNegInt(params.basketItems),
    });
  },

  /** 满柜回家余菜结算（手动挑卖 vs 街坊 1.5 倍包圆广告） */
  trackUnpackSettle(params: {
    mode: 'manual_sell' | 'ad_vip';
    soldCount: number;
    keptCount: number;
    goldGained: number;
  }): void {
    track(GAME_EVENT_NAMES.UNPACK_SETTLE, {
      mode: params.mode,
      sold_count: safeNonNegInt(params.soldCount),
      kept_count: safeNonNegInt(params.keptCount),
      gold_gained: safeNonNegInt(params.goldGained),
    });
  },

  // ── 广告全链路四阶段埋点（支持 reward / interstitial + ad_unit_id） ──────────

  trackAdRequest(scene: string, opts: AdTrackOptions = {}): void {
    track(EVENT_NAMES.AD_REQUEST, buildAdTrackPayload(scene, opts));
  },

  trackAdShow(scene: string, opts: AdTrackOptions = {}): void {
    track(EVENT_NAMES.AD_SHOW, buildAdTrackPayload(scene, opts));
  },

  trackAdClose(scene: string, isEnded: boolean, opts: AdTrackOptions = {}): void {
    track(EVENT_NAMES.AD_CLOSE, {
      ...buildAdTrackPayload(scene, opts),
      is_ended: Boolean(isEnded),
    });
  },

  trackAdError(scene: string, errCode: number, errMsg: string, opts: AdTrackOptions = {}): void {
    track(EVENT_NAMES.AD_ERROR, {
      ...buildAdTrackPayload(scene, opts),
      err_code: safeInt(errCode, -1),
      err_msg: String(errMsg || 'unknown').slice(0, 240),
    });
  },

  // ── 社交分享埋点 ───────────────────────────────────────────────────────────

  trackShareAppMessage(entryPoint: string, extra: Record<string, unknown> = {}): void {
    track(EVENT_NAMES.SHARE_APP_MESSAGE, { entry_point: entryPoint, ...extra });
  },

  trackShareTimeline(entryPoint: string, extra: Record<string, unknown> = {}): void {
    track(EVENT_NAMES.SHARE_TIMELINE, { entry_point: entryPoint, ...extra });
  },

  // ── 厨房 P0 / P2 核心留存与商业化模块埋点 ──────────────────────────────────

  /** 老坛腌制坊：下坛、收菜、广告催熟、添二号坛、老坛升阶 */
  trackPickleAction(params: {
    action: 'start' | 'harvest' | 'ad_boost' | 'buy_jar' | 'upgrade_tier';
    formulaId?: string;
    outputDefId?: string;
    slotIndex?: number;
    pickleTier?: number;
    qty?: number;
    foldGold?: number;
    unlockedRecipeId?: string;
    costGold?: number;
  }): void {
    track(GAME_EVENT_NAMES.PICKLE_ACTION, {
      action: params.action,
      ...(params.formulaId ? { formula_id: params.formulaId } : {}),
      ...(params.outputDefId ? { output_id: params.outputDefId } : {}),
      ...(params.slotIndex != null ? { slot_index: safeNonNegInt(params.slotIndex) } : {}),
      ...(params.pickleTier != null ? { pickle_tier: safeNonNegInt(params.pickleTier) } : {}),
      ...(params.qty != null ? { qty: safeNonNegInt(params.qty) } : {}),
      ...(params.foldGold != null ? { fold_gold: safeNonNegInt(params.foldGold) } : {}),
      ...(params.unlockedRecipeId ? { unlocked_recipe_id: params.unlockedRecipeId } : {}),
      ...(params.costGold != null ? { cost_gold: safeNonNegInt(params.costGold) } : {}),
    });
  },

  /** 墙根花猫阿橘：收留、投喂巡街、拆回礼手信、看视频喂罐头/唤回、猫窝升阶 */
  trackCatAction(params: {
    action: 'adopt' | 'feed' | 'claim_gift' | 'ad_can' | 'upgrade_bed';
    foodId?: string;
    fav?: boolean;
    catMode?: string;
    bondLevel?: number;
    bedTier?: number;
    deluxe?: boolean;
    goldGained?: number;
    ticketsGained?: number;
    foodsCount?: number;
    costGold?: number;
  }): void {
    track(GAME_EVENT_NAMES.CAT_ACTION, {
      action: params.action,
      ...(params.foodId ? { food_id: params.foodId } : {}),
      ...(params.fav != null ? { is_fav: Boolean(params.fav) } : {}),
      ...(params.catMode ? { cat_mode: params.catMode } : {}),
      ...(params.bondLevel != null ? { bond_level: safeNonNegInt(params.bondLevel) } : {}),
      ...(params.bedTier != null ? { bed_tier: safeNonNegInt(params.bedTier) } : {}),
      ...(params.deluxe != null ? { deluxe: Boolean(params.deluxe) } : {}),
      ...(params.goldGained != null ? { gold_gained: safeNonNegInt(params.goldGained) } : {}),
      ...(params.ticketsGained != null ? { tickets_gained: safeNonNegInt(params.ticketsGained) } : {}),
      ...(params.foodsCount != null ? { foods_count: safeNonNegInt(params.foodsCount) } : {}),
      ...(params.costGold != null ? { cost_gold: safeNonNegInt(params.costGold) } : {}),
    });
  },

  /** 寻味抽签 / 名厨秘匣：单抽、连抽、差1券看广告补齐抽、每日免费看广告抽 */
  trackGachaDraw(params: {
    chestType: 'regular' | 'master';
    drawMode: 'ticket' | 'multi_ticket' | 'ad_free' | 'ad_topup';
    drawCount: number;
    ticketsSpent: number;
    ticketsRemain?: number;
    newRecipesCount: number;
    dupCount: number;
    foodsCount: number;
    specialCount?: number;
    specialKind?: string;
    topRarity?: string;
    goldGained?: number;
    bonusTickets?: number;
  }): void {
    track(GAME_EVENT_NAMES.GACHA_DRAW, {
      chest_type: params.chestType,
      draw_mode: params.drawMode,
      draw_count: Math.max(1, safeInt(params.drawCount, 1)),
      tickets_spent: safeNonNegInt(params.ticketsSpent),
      ...(params.ticketsRemain != null ? { tickets_remain: safeNonNegInt(params.ticketsRemain) } : {}),
      new_recipes_count: safeNonNegInt(params.newRecipesCount),
      dup_count: safeNonNegInt(params.dupCount),
      foods_count: safeNonNegInt(params.foodsCount),
      ...(params.specialCount != null ? { special_count: safeNonNegInt(params.specialCount) } : {}),
      ...(params.specialKind ? { special_kind: params.specialKind } : {}),
      ...(params.topRarity ? { top_rarity: params.topRarity } : {}),
      gold_gained: safeNonNegInt(params.goldGained),
      bonus_tickets: safeNonNegInt(params.bonusTickets),
    });
  },

  /** 今日菜单：单道交菜、整桌三道全清发券、看视频加开晚市 */
  trackDailyMenuAction(params: {
    action: 'submit_dish' | 'board_clear' | 'ad_extra_round';
    recipeId?: string;
    isExtraRound?: boolean;
    doneCount?: number;
    needCount?: number;
    goldGained?: number;
    ticketsGained?: number;
    foodGiftId?: string;
  }): void {
    track(GAME_EVENT_NAMES.DAILY_MENU_ACTION, {
      action: params.action,
      ...(params.recipeId ? { recipe_id: params.recipeId } : {}),
      ...(params.isExtraRound != null ? { is_extra_round: Boolean(params.isExtraRound) } : {}),
      ...(params.doneCount != null ? { done_count: safeNonNegInt(params.doneCount) } : {}),
      ...(params.needCount != null ? { need_count: safeNonNegInt(params.needCount) } : {}),
      ...(params.goldGained != null ? { gold_gained: safeNonNegInt(params.goldGained) } : {}),
      ...(params.ticketsGained != null ? { tickets_gained: safeNonNegInt(params.ticketsGained) } : {}),
      ...(params.foodGiftId ? { food_gift_id: params.foodGiftId } : {}),
    });
  },

  /** 街坊点单：普通交单、双倍交单、看视频换单、婉拒弃单 */
  trackNeighborOrderAction(params: {
    action: 'submit' | 'submit_double' | 'ad_refresh' | 'abandon';
    orderId: string;
    npcId?: string;
    recipeId?: string;
    doubled?: boolean;
    goldGained?: number;
    foodGiftId?: string;
  }): void {
    track(GAME_EVENT_NAMES.NEIGHBOR_ORDER_ACTION, {
      action: params.action,
      order_id: params.orderId,
      ...(params.npcId ? { npc_id: params.npcId } : {}),
      ...(params.recipeId ? { recipe_id: params.recipeId } : {}),
      ...(params.doubled != null ? { doubled: Boolean(params.doubled) } : {}),
      ...(params.goldGained != null ? { gold_gained: safeNonNegInt(params.goldGained) } : {}),
      ...(params.foodGiftId ? { food_gift_id: params.foodGiftId } : {}),
    });
  },

  /** 烟火手账与集章册：单条领金、一键盖章领赏（含里程碑券）、篇章集齐盖章 */
  trackDexClaim(params: {
    claimType: 'entry' | 'claim_all' | 'stamp_set';
    targetKind?: string;
    targetId?: string;
    entriesCount?: number;
    milestonesCount?: number;
    stampSetsCount?: number;
    goldGained: number;
    ticketsGained: number;
  }): void {
    track(GAME_EVENT_NAMES.DEX_CLAIM, {
      claim_type: params.claimType,
      ...(params.targetKind ? { target_kind: params.targetKind } : {}),
      ...(params.targetId ? { target_id: params.targetId } : {}),
      ...(params.entriesCount != null ? { entries_count: safeNonNegInt(params.entriesCount) } : {}),
      ...(params.milestonesCount != null ? { milestones_count: safeNonNegInt(params.milestonesCount) } : {}),
      ...(params.stampSetsCount != null ? { stamp_sets_count: safeNonNegInt(params.stampSetsCount) } : {}),
      gold_gained: safeNonNegInt(params.goldGained),
      tickets_gained: safeNonNegInt(params.ticketsGained),
    });
  },

  /** 烟火灶台：开火做菜 / 点燃大厨旺火 */
  trackCookAction(params: {
    action: 'cook' | 'ad_chef_fire';
    recipeId?: string;
    rarity?: string;
    batchQty?: number;
    cookedCount?: number;
    chefFireActive?: boolean;
    doubled?: boolean;
    xpGained?: number;
    cookLevel?: number;
    levelsGained?: number;
    masteryStars?: number;
    masteryTickets?: number;
  }): void {
    track(GAME_EVENT_NAMES.COOK_DISH, {
      action: params.action,
      ...(params.recipeId ? { recipe_id: params.recipeId } : {}),
      ...(params.rarity ? { rarity: params.rarity } : {}),
      ...(params.batchQty != null ? { batch_qty: safeNonNegInt(params.batchQty) } : {}),
      ...(params.cookedCount != null ? { cooked_count: safeNonNegInt(params.cookedCount) } : {}),
      ...(params.chefFireActive != null ? { chef_fire_active: Boolean(params.chefFireActive) } : {}),
      ...(params.doubled != null ? { doubled: Boolean(params.doubled) } : {}),
      ...(params.xpGained != null ? { xp_gained: safeNonNegInt(params.xpGained) } : {}),
      ...(params.cookLevel != null ? { cook_level: safeNonNegInt(params.cookLevel) } : {}),
      ...(params.levelsGained != null ? { levels_gained: safeNonNegInt(params.levelsGained) } : {}),
      ...(params.masteryStars != null ? { mastery_stars: safeNonNegInt(params.masteryStars) } : {}),
      ...(params.masteryTickets != null ? { mastery_tickets: safeNonNegInt(params.masteryTickets) } : {}),
    });
  },

  /** 厨艺等级提升 */
  trackCookLevelUp(fromLevel: number, toLevel: number, source = 'cook'): void {
    if (toLevel <= fromLevel) return;
    track(GAME_EVENT_NAMES.COOK_LEVEL_UP, {
      from_level: safeNonNegInt(fromLevel),
      to_level: safeNonNegInt(toLevel),
      source,
    });
  },

  /** 匠人修缮与座驾购置：房屋扩建、器物升级、老坛/猫窝升阶、购买交通工具 */
  trackKitchenUpgrade(params: {
    targetType: 'house' | 'furn' | 'pickle_jar' | 'cat_bed' | 'vehicle';
    targetId: string;
    newLevel: number;
    costGold?: number;
    cookLevel?: number;
  }): void {
    track(GAME_EVENT_NAMES.KITCHEN_UPGRADE, {
      target_type: params.targetType,
      target_id: params.targetId,
      new_level: safeNonNegInt(params.newLevel),
      ...(params.costGold != null ? { cost_gold: safeNonNegInt(params.costGold) } : {}),
      ...(params.cookLevel != null ? { cook_level: safeNonNegInt(params.cookLevel) } : {}),
    });
  },

  /** 社区与平台福利：微信游戏圈 / 抖音侧边栏复访 / 抖音添加桌面 */
  trackWelfareAction(params: {
    channel: 'wx_game_club' | 'dy_sidebar' | 'dy_desktop';
    action: 'open' | 'navigate' | 'claim';
    goldGained?: number;
    ticketsGained?: number;
    foodsCount?: number;
    postCount?: number;
  }): void {
    track(GAME_EVENT_NAMES.WELFARE_ACTION, {
      channel: params.channel,
      action: params.action,
      ...(params.goldGained != null ? { gold_gained: safeNonNegInt(params.goldGained) } : {}),
      ...(params.ticketsGained != null ? { tickets_gained: safeNonNegInt(params.ticketsGained) } : {}),
      ...(params.foodsCount != null ? { foods_count: safeNonNegInt(params.foodsCount) } : {}),
      ...(params.postCount != null ? { post_count: safeNonNegInt(params.postCount) } : {}),
    });
  },

  /** 冰箱库存操作：一键整理、切换排序、批量售卖、直接食用 */
  trackFridgeAction(params: {
    action: 'organize' | 'sort_change' | 'sell' | 'eat';
    sortMode?: string;
    itemCount?: number;
    goldGained?: number;
    defId?: string;
  }): void {
    track(GAME_EVENT_NAMES.FRIDGE_ACTION, {
      action: params.action,
      ...(params.sortMode ? { sort_mode: params.sortMode } : {}),
      ...(params.itemCount != null ? { item_count: safeNonNegInt(params.itemCount) } : {}),
      ...(params.goldGained != null ? { gold_gained: safeNonNegInt(params.goldGained) } : {}),
      ...(params.defId ? { def_id: params.defId } : {}),
    });
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
