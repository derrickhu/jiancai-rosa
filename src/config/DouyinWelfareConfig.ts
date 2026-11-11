/**
 * 抖音侧边栏复访、添加到桌面。微信不展示。
 * 金币对齐游戏圈每日 50，桌面奖励只发一次，避免把厨房经济打穿。
 */

export const DOUYIN_WELFARE = {
  sidebarCoins: 50,
  desktopCoins: 100,
} as const;

/** 会经 Platform 存储落到 jiancai_tt_ 下，不进云存档白名单。 */
export const DOUYIN_WELFARE_STORAGE_KEY = 'jiancai_douyin_welfare';

export const DOUYIN_GAME_NAME = '捡菜市集';
