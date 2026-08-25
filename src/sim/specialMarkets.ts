import { displayName, getItem, initialFreshness, sellPrice, type Quality } from './items';
import { rngWeighted, type Rng } from './rng';
import { nextUid, type ExtractedItem } from './run';
import type { VehicleId } from './vehicles';

export type SpecialMarketId = 'spice_night' | 'riverside_fish' | 'oldtown_dry';
export type SpecialFlavor = 'spice' | 'fish' | 'dry';
export type TimingGrade = 'early' | 'hit' | 'late';

export interface SpecialDrop {
  id: string;
  weight: number;
}

export interface SpecialMarketDef {
  id: SpecialMarketId;
  name: string;
  hint: string;
  vehicle: VehicleId;
  dailyLimit: number;
  rounds: number;
  thumb: string;
  bg: string;
  flavor: SpecialFlavor;
  cue: string;
  bgmMarket: 'xiangko' | 'jiangbian' | 'laocheng';
  targetPool: SpecialDrop[];
  consolationPool: SpecialDrop[];
}

export const SPECIAL_DAILY_LIMIT = 2;
export const SPECIAL_ROUNDS = 5;

export const SPECIAL_TIMING = {
  idleMin: 0.55,
  idleMax: 0.9,
  telegraphMin: 0.75,
  telegraphMax: 1.45,
  hitWindow: 0.4,
  lateHold: 0.5,
  resolveHold: 1.15,
} as const;

export const SPECIAL_MARKETS: SpecialMarketDef[] = [
  {
    id: 'spice_night',
    name: '香料夜摊',
    hint: '哪一窝热气顶上来再揭。',
    vehicle: 'walk',
    dailyLimit: SPECIAL_DAILY_LIMIT,
    rounds: SPECIAL_ROUNDS,
    thumb: 'subpkg_images/dest_spice_night.jpg',
    bg: 'subpkg_images/special_spice_bg.jpg',
    flavor: 'spice',
    cue: '热气顶满再揭',
    bgmMarket: 'xiangko',
    targetPool: [
      { id: 'perilla', weight: 3 },
      { id: 'bird_chili', weight: 3 },
      { id: 'peppercorn', weight: 3 },
      { id: 'star_anise', weight: 2 },
      { id: 'dried_chili', weight: 2 },
      { id: 'scallion', weight: 2 },
      { id: 'garlic', weight: 2 },
      { id: 'ginger', weight: 2 },
      { id: 'cilantro', weight: 2 },
    ],
    consolationPool: [
      { id: 'scallion', weight: 2 },
      { id: 'garlic', weight: 2 },
      { id: 'ginger', weight: 2 },
      { id: 'cilantro', weight: 1 },
    ],
  },
  {
    id: 'riverside_fish',
    name: '江边垂钓',
    hint: '漂猛点那一下再收杆。',
    vehicle: 'bike',
    dailyLimit: SPECIAL_DAILY_LIMIT,
    rounds: SPECIAL_ROUNDS,
    thumb: 'subpkg_images/dest_riverside_fish.jpg',
    bg: 'subpkg_images/special_fish_bg.jpg',
    flavor: 'fish',
    cue: '漂猛点再收',
    bgmMarket: 'jiangbian',
    targetPool: [
      { id: 'smallfish', weight: 4 },
      { id: 'clam', weight: 3 },
      { id: 'crucian', weight: 3 },
      { id: 'river_shrimp', weight: 3 },
      { id: 'hairtail', weight: 2 },
      { id: 'shrimp', weight: 1 },
      { id: 'yellowfish', weight: 1 },
      { id: 'oyster', weight: 1 },
    ],
    consolationPool: [],
  },
  {
    id: 'oldtown_dry',
    name: '老城干货店',
    hint: '竹匾金黄那面朝上再进袋。',
    vehicle: 'ebike',
    dailyLimit: SPECIAL_DAILY_LIMIT,
    rounds: SPECIAL_ROUNDS,
    thumb: 'subpkg_images/dest_oldtown_dry.jpg',
    bg: 'subpkg_images/special_dry_bg.jpg',
    flavor: 'dry',
    cue: '金黄朝上再收',
    bgmMarket: 'laocheng',
    targetPool: [
      { id: 'lotus_seed', weight: 3 },
      { id: 'lily', weight: 3 },
      { id: 'goji', weight: 3 },
      { id: 'tremella', weight: 3 },
      { id: 'mushroom', weight: 1 },
      { id: 'wood_ear', weight: 1 },
    ],
    consolationPool: [
      { id: 'goji', weight: 2 },
      { id: 'lotus_seed', weight: 1 },
    ],
  },
];

const BY_ID = new Map(SPECIAL_MARKETS.map((m) => [m.id, m] as const));

export function isSpecialMarketId(id: unknown): id is SpecialMarketId {
  return typeof id === 'string' && BY_ID.has(id as SpecialMarketId);
}

export function getSpecialMarket(id: SpecialMarketId): SpecialMarketDef {
  const hit = BY_ID.get(id);
  if (!hit) throw new Error(`未知特殊市场: ${id}`);
  return hit;
}

export function pickSpecialDrop(pool: readonly SpecialDrop[], rng: Rng): string {
  if (!pool.length) throw new Error('特殊市场掉落池是空的');
  return rngWeighted(rng, pool.map((it) => [it.id, it.weight] as const));
}

export function resolveSpecialDrop(
  def: SpecialMarketDef,
  grade: TimingGrade,
  rng: Rng,
): { defId: string; quality: Quality } | null {
  if (def.flavor === 'spice') {
    if (grade === 'early') return null;
    if (grade === 'late') return { defId: pickSpecialDrop(def.consolationPool, rng), quality: 'common' };
    return { defId: pickSpecialDrop(def.targetPool, rng), quality: 'fresh' };
  }
  if (def.flavor === 'fish') {
    if (grade !== 'hit') return null;
    return { defId: pickSpecialDrop(def.targetPool, rng), quality: 'fresh' };
  }
  if (grade === 'late') return null;
  if (grade === 'early') return { defId: pickSpecialDrop(def.consolationPool, rng), quality: 'common' };
  return { defId: pickSpecialDrop(def.targetPool, rng), quality: 'fresh' };
}

export function specialResultLine(
  def: SpecialMarketDef,
  grade: TimingGrade,
  drop: { defId: string; quality: Quality } | null,
): string {
  const name = drop ? getItem(drop.defId).name : '';
  if (def.flavor === 'spice') {
    if (grade === 'early') return '点早了，还没香';
    if (grade === 'late') return `香散了，摸到${name}`;
    return `揭开了·${name}`;
  }
  if (def.flavor === 'fish') {
    if (grade === 'early') return '脱钩了';
    if (grade === 'late') return '线松了';
    return `上来了·${name}`;
  }
  if (grade === 'early') return `还是生货·${name}`;
  if (grade === 'late') return '被风吹走了';
  return `收进袋·${name}`;
}

export function toSpecialExtracted(defId: string, quality: Quality): ExtractedItem {
  return {
    uid: nextUid('s'),
    defId,
    quality,
    inspected: true,
    freshness: initialFreshness(quality),
    name: displayName(defId, true, quality),
    sell: sellPrice(defId, quality, true),
  };
}

export function specialBootItems(def: SpecialMarketDef): string[] {
  const ids = new Set<string>();
  for (const it of [...def.targetPool, ...def.consolationPool]) ids.add(it.id);
  return [...ids];
}
