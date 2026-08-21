export type MarketId = 'xiangko' | 'heyan' | 'jiangbian';

export interface MarketDef {
  id: MarketId;
  name: string;
  hint: string;
  unlockLevel: number;
  thumb: string;
}

/** 出门后选点。目前只开巷口，等级系统接上后按 unlockLevel 解锁。 */
export const MARKETS: MarketDef[] = [
  {
    id: 'xiangko',
    name: '巷口收摊',
    hint: '家门口这条小街，收摊了还能翻一翻。',
    unlockLevel: 1,
    thumb: 'subpkg_images/market_overview.jpg',
  },
  {
    id: 'heyan',
    name: '河沿早市',
    hint: '摊位更多，好菜也更多。',
    unlockLevel: 4,
    thumb: 'subpkg_images/dest_heyan.jpg',
  },
  {
    id: 'jiangbian',
    name: '江边渔市',
    hint: '水产多，注意也涨得快。',
    unlockLevel: 8,
    thumb: 'subpkg_images/dest_jiangbian.jpg',
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
