/** 微信激励视频广告位，和后台三个场景一一对应。 */
export const REWARDED_AD_UNITS = {
  basket: 'adunit-fde283ee5c313801',
  stamina: 'adunit-5029a65d9338bf20',
  special: 'adunit-d17e790a3032b27a',
} as const;

export type RewardedAdScene = keyof typeof REWARDED_AD_UNITS;
