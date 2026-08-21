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

export function emptyPacking(): Record<StallId, number> {
  return { leaf: 0, root: 0, egg: 0, fish: 0 };
}

export function stallPacked(packing: Record<StallId, number>, id: StallId): boolean {
  return packing[id] >= PACK_FULL;
}
