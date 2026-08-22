import type { StallId } from './items';

/** 装箱满了，这摊桌上没挑走的被老板装车。 */
export const PACK_FULL = 100;

export const STALL_FEE: Record<StallId, number> = {
  leaf: 2,
  root: 3,
  egg: 3,
  fish: 5,
};

/** 每秒装箱进度。水产摊收得快。 */
export const PACK_RATE: Record<StallId, number> = {
  leaf: 2,
  root: 2.4,
  egg: 2.4,
  fish: 3.2,
};

export function clampPack(value: number): number {
  return Math.max(0, Math.min(PACK_FULL, value));
}

/** 装箱按路线节点记，同类摊的两张卡各装各的。 */
export function stallPacked(packing: Record<string, number>, id: string): boolean {
  return (packing[id] ?? 0) >= PACK_FULL;
}
