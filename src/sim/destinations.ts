export type MarketId = 'xiangko' | 'heyan' | 'shanwu' | 'jiangbian' | 'laocheng';

export interface MarketDef {
  id: MarketId;
  name: string;
  hint: string;
  unlockLevel: number;
  /** 出门扣几口包子。走得越远越费。 */
  staminaCost: number;
  thumb: string;
}

/**
 * 五个点按厨艺 1/4/7/10/13 依次开。每开一场只多放一小撮新食材，
 * 不要为了「货多」把所有品类堆进同一个场，节奏全靠这条线撑。
 */
export const MARKETS: MarketDef[] = [
  {
    id: 'xiangko',
    name: '巷口收摊',
    hint: '家门口这条小街，收摊了还能翻一翻。',
    unlockLevel: 1,
    staminaCost: 1,
    thumb: 'subpkg_images/market_overview.jpg',
  },
  {
    id: 'heyan',
    name: '河沿早市',
    hint: '摊位更多，肉摊也开门了。',
    unlockLevel: 4,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_heyan.jpg',
  },
  {
    id: 'shanwu',
    name: '山坞早集',
    hint: '翻过一道坡，笋和菌子还带着土。',
    unlockLevel: 7,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_shanwu.jpg',
  },
  {
    id: 'jiangbian',
    name: '江边渔市',
    hint: '水产多，注意也涨得快。',
    unlockLevel: 10,
    staminaCost: 2,
    thumb: 'subpkg_images/dest_jiangbian.jpg',
  },
  {
    id: 'laocheng',
    name: '老城菜行',
    hint: '青石板的老字号，火腿和牛腩挂在梁上。',
    unlockLevel: 13,
    staminaCost: 2,
    thumb: 'subpkg_images/dest_laocheng.jpg',
  },
];

export function getMarket(id: MarketId): MarketDef {
  const hit = MARKETS.find((m) => m.id === id);
  if (!hit) throw new Error(`未知菜场: ${id}`);
  return hit;
}

export function isMarketUnlocked(id: MarketId, level: number): boolean {
  return level >= getMarket(id).unlockLevel;
}
