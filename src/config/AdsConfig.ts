/**
 * 激励视频广告位，按宿主分开。
 * 抖音位在开放平台建好后填进来；空字符串表示这一端还不能播，真机不会白送奖励。
 */
export const REWARDED_AD_UNITS_BY_PLATFORM = {
  wechat: {
    basket: 'adunit-fde283ee5c313801',
    stamina: 'adunit-5029a65d9338bf20',
    special: 'adunit-d17e790a3032b27a',
  },
  douyin: {
    basket: '10ggdbfh2701d4bmge',
    stamina: 'ge896cb3h3d9bpacnp',
    special: 'f52322inh00d036hji',
  },
} as const;

/** 抖音插屏。从菜场回家进厨房时播，微信没有这条。 */
export const DOUYIN_INTERSTITIAL_AD_UNIT = '426pdmecklv18c4k1l';

export type RewardedAdScene = keyof typeof REWARDED_AD_UNITS_BY_PLATFORM.wechat;
