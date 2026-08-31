/**
 * 稀有度是整套数值的主线：它同时决定食材每格单价、菜谱份量、经验、
 * 掉率和格子边框颜色。改这里等于改全局手感，别在别处另开一套档位。
 *
 *   1 普通 白
 *   2 良品 绿
 *   3 上品 蓝
 *   4 珍品 紫
 *   5 极品 橙   ← 预留，不要写进 Rarity
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface RarityStyle {
  label: string;
  /** 格子描边 */
  frame: number;
  /** 描边外侧的浅色晕，奶油底上也分得出白绿蓝紫 */
  glow: number;
  ink: number;
  /** 收摊飘字等大字用的亮色 */
  float: number;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: { label: '普通', frame: 0xF4EDE0, glow: 0x8A7A68, ink: 0x6A5848, float: 0xFFF6E8 },
  rare: { label: '良品', frame: 0x4C8C3A, glow: 0x9ED17C, ink: 0x2F5A22, float: 0x8FDE6A },
  epic: { label: '上品', frame: 0x3A6ABF, glow: 0x86AEEA, ink: 0x22406F, float: 0x7EC8FF },
  legendary: { label: '珍品', frame: 0x8A4ABF, glow: 0xC79AE8, ink: 0x4E2470, float: 0xD4A0F0 },
};

/** 第 5 档极品橙。现在不要写进 Rarity。 */
export const RESERVED_RARITY_STYLE = {
  mythic: { label: '极品', frame: 0xD4782A, glow: 0xF0B060, ink: 0x8A3A10, float: 0xFFB14A },
} as const;

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

export function rarityLabel(r: Rarity): string {
  return RARITY_STYLE[r].label;
}

export function rarityFrame(r: Rarity): number {
  return RARITY_STYLE[r].frame;
}
