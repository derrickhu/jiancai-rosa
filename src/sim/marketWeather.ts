import type { MarketId } from './destinations';
import type { StallId } from './items';
import { todayKey } from './kitchen';

export type MarketWeatherId =
  | 'early_dispersed'
  | 'rain_rush'
  | 'banquet_cancel'
  | 'neighbor_fair';

export interface MarketWeatherDef {
  id: MarketWeatherId;
  name: string;
  badge: string;
  shortDesc: string;
  /** Pill background color */
  pillFill: number;
  /** Pill border / text color */
  pillInk: number;
  extraSteps: number;
  luckRare: number;
  luckEpic: number;
  stallBias?: StallId;
  /** 首座原本要收钱的摊位免单 */
  freeFirstPaidStall: boolean;
  /** 收费好货摊额外多塞几件货 */
  paystallExtraItems: number;
  /** 额外多刷几个压箱尾货篓奇遇点 */
  extraMysterySacks: number;
}

export const MARKET_WEATHERS: readonly MarketWeatherDef[] = [
  {
    id: 'early_dispersed',
    name: '早集刚散',
    badge: '今日·早集刚散',
    shortDesc: '首座收费摊免单',
    pillFill: 0xEAF5E4,
    pillInk: 0x2F6829,
    extraSteps: 0,
    luckRare: 0.02,
    luckEpic: 0,
    freeFirstPaidStall: true,
    paystallExtraItems: 0,
    extraMysterySacks: 0,
  },
  {
    id: 'rain_rush',
    name: '阵雨收摊',
    badge: '今日·阵雨收摊',
    shortDesc: '水产旺 · 良上品率↑',
    pillFill: 0xE5F2F8,
    pillInk: 0x245872,
    extraSteps: 0,
    luckRare: 0.08,
    luckEpic: 0.06,
    stallBias: 'fish',
    freeFirstPaidStall: false,
    paystallExtraItems: 0,
    extraMysterySacks: 0,
  },
  {
    id: 'banquet_cancel',
    name: '酒楼退单',
    badge: '今日·酒楼退单',
    shortDesc: '好货摊多塞2件 · 上品↑',
    pillFill: 0xFBECE4,
    pillInk: 0xA24222,
    extraSteps: 0,
    luckRare: 0.04,
    luckEpic: 0.08,
    freeFirstPaidStall: false,
    paystallExtraItems: 2,
    extraMysterySacks: 0,
  },
  {
    id: 'neighbor_fair',
    name: '邻里赶集',
    badge: '今日·邻里赶集',
    shortDesc: '天色+1 · 尾货篓翻倍',
    pillFill: 0xFFF4DC,
    pillInk: 0x946210,
    extraSteps: 1,
    luckRare: 0.03,
    luckEpic: 0.03,
    freeFirstPaidStall: false,
    paystallExtraItems: 0,
    extraMysterySacks: 1,
  },
];

export function marketWeatherById(id?: string): MarketWeatherDef | undefined {
  return MARKET_WEATHERS.find((w) => w.id === id);
}

/** 按本地日期 + 菜场 ID 确定性轮换今日集市天时签，同日重进保持一致，不同菜场错开。 */
export function dailyMarketWeather(marketId: MarketId, now = Date.now()): MarketWeatherDef {
  const key = `${todayKey(now)}:${marketId}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  }
  return MARKET_WEATHERS[h % MARKET_WEATHERS.length];
}
