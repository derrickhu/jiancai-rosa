const WX_BASKET = 'adunit-fde283ee5c313801';
const WX_STAMINA = 'adunit-5029a65d9338bf20';
const WX_SPECIAL = 'adunit-d17e790a3032b27a';

const DY_BASKET = '10ggdbfh2701d4bmge';
const DY_STAMINA = 'ge896cb3h3d9bpacnp';
const DY_SPECIAL = 'f52322inh00d036hji';

/**
 * 激励视频广告位，按宿主分开。
 * P0 新增场景先复用已过审的三个单元 ID（埋点仍按独立 scene 上报），
 * 待微信/抖音后台新建独立广告位后直接替换对应常量即可。
 */
export const REWARDED_AD_UNITS_BY_PLATFORM = {
  wechat: {
    basket: WX_BASKET,
    stamina: WX_STAMINA,
    special: WX_SPECIAL,
    dusk_steps: WX_BASKET,
    gacha_free: WX_SPECIAL,
    gacha_topup: WX_SPECIAL,
    chef_buff: WX_STAMINA,
    order_double: WX_STAMINA,
    order_refresh: WX_BASKET,
    daily_extra: WX_SPECIAL,
  },
  douyin: {
    basket: DY_BASKET,
    stamina: DY_STAMINA,
    special: DY_SPECIAL,
    dusk_steps: DY_BASKET,
    gacha_free: DY_SPECIAL,
    gacha_topup: DY_SPECIAL,
    chef_buff: DY_STAMINA,
    order_double: DY_STAMINA,
    order_refresh: DY_BASKET,
    daily_extra: DY_SPECIAL,
  },
} as const;

/** 抖音插屏。从菜场回家进厨房时播，微信没有这条。 */
export const DOUYIN_INTERSTITIAL_AD_UNIT = '426pdmecklv18c4k1l';

export type RewardedAdScene = keyof typeof REWARDED_AD_UNITS_BY_PLATFORM.wechat;
