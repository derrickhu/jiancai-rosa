const WX_BASKET = 'adunit-fde283ee5c313801';
const WX_STAMINA = 'adunit-5029a65d9338bf20';
const WX_SPECIAL = 'adunit-d17e790a3032b27a';
const WX_DUSK_FLASHLIGHT = 'adunit-c716fa86fcfc0f51';
const WX_GACHA_BOX = 'adunit-071f43ffabdbfa6f';
const WX_CHEF_BUFF = 'adunit-a15a4083328545e7';
const WX_NEIGHBOR_ORDER = 'adunit-5631ddd46fe29b86';
const WX_DAILY_MENU = 'adunit-8426642edee27748';
const WX_PICKLE_BOOST = 'adunit-77fdf93257f7ec57';
const WX_CAT_TREAT = 'adunit-af2459538ecccca4';

const DY_BASKET = '10ggdbfh2701d4bmge';
const DY_STAMINA = 'ge896cb3h3d9bpacnp';
const DY_SPECIAL = 'f52322inh00d036hji';

/**
 * 激励视频广告位，按宿主分开。
 * 微信端已全部接入独立广告单元（菜谱箱两项共用 WX_GACHA_BOX，街坊订单两项共用 WX_NEIGHBOR_ORDER）；
 * 抖音端待新建独立广告位后替换对应常量。
 */
export const REWARDED_AD_UNITS_BY_PLATFORM = {
  wechat: {
    basket: WX_BASKET,
    stamina: WX_STAMINA,
    special: WX_SPECIAL,
    dusk_steps: WX_DUSK_FLASHLIGHT,
    gacha_free: WX_GACHA_BOX,
    gacha_topup: WX_GACHA_BOX,
    chef_buff: WX_CHEF_BUFF,
    order_double: WX_NEIGHBOR_ORDER,
    order_refresh: WX_NEIGHBOR_ORDER,
    daily_extra: WX_DAILY_MENU,
    pickle_boost: WX_PICKLE_BOOST,
    cat_treat: WX_CAT_TREAT,
    stall_favor: WX_BASKET,
    unpack_vip: WX_BASKET,
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
    pickle_boost: DY_STAMINA,
    cat_treat: DY_SPECIAL,
    stall_favor: DY_BASKET,
    unpack_vip: DY_BASKET,
  },
} as const;

/** 抖音插屏。从菜场回家进厨房时播，微信没有这条。 */
export const DOUYIN_INTERSTITIAL_AD_UNIT = '426pdmecklv18c4k1l';

export type RewardedAdScene = keyof typeof REWARDED_AD_UNITS_BY_PLATFORM.wechat;
