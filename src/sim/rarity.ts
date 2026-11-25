/**
 * 稀有度是整套数值的主线：它同时决定食材每格单价、菜谱份量、经验、
 * 掉率和格子边框颜色。改这里等于改全局手感，别在别处另开一套档位。
 *
 *   1 普通 白（温润素白/茶褐）
 *   2 良品 绿（鲜翠春绿）
 *   3 上品 蓝（晴空钴蓝）
 *   4 珍品 紫（紫罗兰/丁香紫）
 *   * 天选 金（鎏金暖橙，用于 quality === 'god' 视觉表现，不写入 Rarity 数值枚举）
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** 视觉表现阶位：四档基础稀有度 + 天选极鲜（god）鎏金阶。 */
export type RarityTier = Rarity | 'god';

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface RarityStyle {
  label: string;
  /** 格子描边 */
  frame: number;
  /** 描边外侧与背光柔晕色（浅底/暗底通吃） */
  glow: number;
  /** 宣纸/浅底上的品阶深色字墨 */
  ink: number;
  /** 收摊飘字、暗底高光用的亮色 */
  float: number;
  /** 搜打撤式物品格底色：浅亮罩，配 cellAlpha 透出藤编 */
  cell: number;
  cellAlpha: number;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: {
    label: '普通',
    frame: 0xDFD0BA,
    glow: 0xFFF5DE,
    ink: 0x6A5542,
    float: 0xFFF8EC,
    cell: 0xFFF8EC,
    cellAlpha: 0.28,
  },
  rare: {
    label: '良品',
    frame: 0x3EB848,
    glow: 0x6BE068,
    ink: 0x1F6E2C,
    float: 0x6EE86A,
    cell: 0x5AD662,
    cellAlpha: 0.34,
  },
  epic: {
    label: '上品',
    frame: 0x2E82E6,
    glow: 0x5CB2FF,
    ink: 0x1B549E,
    float: 0x66C0FF,
    cell: 0x52AAF5,
    cellAlpha: 0.35,
  },
  legendary: {
    label: '珍品',
    frame: 0x9442E0,
    glow: 0xC47AFF,
    ink: 0x6422A2,
    float: 0xD68EFF,
    cell: 0xB870F2,
    cellAlpha: 0.36,
  },
};

/** 天选极鲜（quality === 'god'）专属鎏金暖橙视觉配置。 */
export const GOD_RARITY_STYLE: RarityStyle = {
  label: '天选',
  frame: 0xEE8C18,
  glow: 0xFFD052,
  ink: 0xA65206,
  float: 0xFFD454,
  cell: 0xF5AD3C,
  cellAlpha: 0.38,
};

/** 第 5 档极品橙预留常量（兼容旧引用）。 */
export const RESERVED_RARITY_STYLE = {
  mythic: { label: '极品', frame: 0xEE8C18, glow: 0xFFD052, ink: 0x8A3A10, float: 0xFFD052, cell: 0xF0B060, cellAlpha: 0.36 },
} as const;

export function resolveRarityTier(rarity: Rarity, quality?: string): RarityTier {
  return quality === 'god' ? 'god' : rarity;
}

export function rarityStyleOf(tier: RarityTier): RarityStyle {
  return tier === 'god' ? GOD_RARITY_STYLE : RARITY_STYLE[tier];
}

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

export function rarityLabel(r: Rarity): string {
  return RARITY_STYLE[r].label;
}

export function rarityTierLabel(tier: RarityTier): string {
  return tier === 'god' ? '极鲜' : RARITY_STYLE[tier].label;
}

export function rarityFrame(r: Rarity): number {
  return RARITY_STYLE[r].frame;
}

export function rarityCell(r: Rarity): number {
  return RARITY_STYLE[r].cell;
}

export function rarityCellAlpha(r: Rarity): number {
  return RARITY_STYLE[r].cellAlpha;
}
