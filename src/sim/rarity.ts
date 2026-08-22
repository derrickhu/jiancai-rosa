/**
 * 稀有度是整套数值的主线：它同时决定食材每格单价、菜谱份量、经验、
 * 掉率和格子边框颜色。改这里等于改全局手感，别在别处另开一套档位。
 */
export type Rarity = 'common' | 'rare' | 'epic';

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic'];

export interface RarityStyle {
  label: string;
  /** 格子描边 */
  frame: number;
  /** 描边外侧的浅色晕，弱光下也分得出蓝紫 */
  glow: number;
  ink: number;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: { label: '普通', frame: 0x4C8C3A, glow: 0x9ED17C, ink: 0x2F5A22 },
  rare: { label: '高级', frame: 0x3A6ABF, glow: 0x86AEEA, ink: 0x22406F },
  epic: { label: '稀有', frame: 0x8A4ABF, glow: 0xC79AE8, ink: 0x4E2470 },
};

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

export function rarityLabel(r: Rarity): string {
  return RARITY_STYLE[r].label;
}

export function rarityFrame(r: Rarity): number {
  return RARITY_STYLE[r].frame;
}
