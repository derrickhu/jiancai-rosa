export type MarketId =
  | 'xiangko' | 'heyan' | 'qiaotou'
  | 'shanwu' | 'jiangbian' | 'nanshi'
  | 'laocheng' | 'dukou' | 'shanzhen';

export interface MarketDef {
  id: MarketId;
  name: string;
  hint: string;
  unlockLevel: number;
  /** 出门扣几口包子。现在各场一律 1。 */
  staminaCost: number;
  thumb: string;
}

/**
 * 九个点按厨艺 1/3/5/7/9/11/12/13/14 开。
 * 每开一场只多放一小撮新食材，节奏全靠这条线撑。
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
    hint: '河边青菜和河鲜，案板还没开门。',
    unlockLevel: 3,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_heyan.jpg',
  },
  {
    id: 'qiaotou',
    name: '桥头早市',
    hint: '过了石桥，田头货和案板都在这边。',
    unlockLevel: 5,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_qiaotou.jpg',
  },
  {
    id: 'shanwu',
    name: '山坞早集',
    hint: '翻过一道坡，栗子和菌子还带着土。',
    unlockLevel: 7,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_shanwu.jpg',
  },
  {
    id: 'jiangbian',
    name: '江边渔市',
    hint: '水产多，注意也涨得快。',
    unlockLevel: 9,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_jiangbian.jpg',
  },
  {
    id: 'nanshi',
    name: '南门菜市',
    hint: '城门里的豆干、禽和酱，和江边不是一路货。',
    unlockLevel: 11,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_nanshi.jpg',
  },
  {
    id: 'laocheng',
    name: '老城菜行',
    hint: '青石板的老字号，牛腩和五花挂在梁上。',
    unlockLevel: 12,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_laocheng.jpg',
  },
  {
    id: 'dukou',
    name: '渡口渔行',
    hint: '石埠上的海鲜行，干货篓搁在船舱一角。',
    unlockLevel: 13,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_dukou.jpg',
  },
  {
    id: 'shanzhen',
    name: '山珍行',
    hint: '蟹篓、松茸和梁上火腿，不是随便逛的场。',
    unlockLevel: 14,
    staminaCost: 1,
    thumb: 'subpkg_images/dest_shanzhen.jpg',
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

/** 厨艺从 from 升到 to 时新开的菜场。 */
export function marketsUnlockedBetween(fromLevel: number, toLevel: number): MarketDef[] {
  return MARKETS.filter((m) => m.unlockLevel > fromLevel && m.unlockLevel <= toLevel);
}
