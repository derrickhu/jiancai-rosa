import { getItem, type ItemDef } from './items';
import { rngPick, rngWeighted, type Rng } from './rng';

/** 不走五类大摊的专属货池。 */
export interface SpecialtyDef {
  id: string;
  name: string;
  hint: string;
  count: [number, number];
  common: string[];
  rare: string[];
  epic: string[];
  legendary?: string[];
  epicChance?: number;
  rareChance?: number;
  legendaryChance?: number;
}

export const SPECIALTIES: Record<string, SpecialtyDef> = {
  fungus: {
    id: 'fungus',
    name: '菌摊',
    hint: '山坞才有的鲜菌',
    count: [3, 5],
    common: ['mushroom'],
    rare: ['wood_ear'],
    epic: [],
  },
  lotus: {
    id: 'lotus',
    name: '藕摊',
    hint: '泥里拔上来的',
    count: [3, 5],
    common: ['lotus'],
    rare: [],
    epic: [],
  },
  nightcatch: {
    id: 'nightcatch',
    name: '鲜货筐',
    hint: '夜里刚起网的',
    count: [3, 5],
    common: ['smallfish', 'kelp'],
    rare: ['clam', 'crucian', 'hairtail', 'oyster'],
    epic: ['shrimp', 'yellowfish'],
    rareChance: 0.36,
    epicChance: 0.1,
  },
  cured: {
    id: 'cured',
    name: '梁上咸货',
    hint: '老字号挂着的',
    count: [3, 4],
    common: ['pork'],
    rare: [],
    epic: ['pork_belly', 'beef_brisket'],
    rareChance: 0.2,
    epicChance: 0.22,
  },
  treasure: {
    id: 'treasure',
    name: '山珍筐',
    hint: '松茸和干贝',
    count: [3, 4],
    common: ['goji'],
    rare: ['mushroom'],
    epic: [],
    legendary: ['matsutake', 'dried_scallop'],
    rareChance: 0.2,
    legendaryChance: 0.32,
  },
};

export function getSpecialty(id: string): SpecialtyDef | undefined {
  return SPECIALTIES[id];
}

export function rollSpecialtyItem(
  id: string,
  rng: Rng,
  cookLevel = 1,
  luck?: { rare?: number; epic?: number },
): ItemDef {
  const spec = SPECIALTIES[id];
  if (!spec) return getItem('mushroom');
  const lv = Math.max(0, cookLevel - 1);
  const legendary = spec.legendaryChance ?? 0;
  const epic = (spec.epicChance ?? 0.04 + lv * 0.004) + Math.max(0, luck?.epic ?? 0);
  const rare = (spec.rareChance ?? 0.22 + lv * 0.01) + Math.max(0, luck?.rare ?? 0);
  const roll = rng();
  let ids = spec.common;
  if ((spec.legendary?.length ?? 0) && roll < legendary) ids = spec.legendary ?? spec.common;
  else if (spec.epic.length && roll < legendary + epic) ids = spec.epic;
  else if (spec.rare.length && roll < legendary + epic + rare) ids = spec.rare;
  if (!ids.length) ids = spec.common;
  return getItem(rngPick(rng, ids));
}

export function rollGatherSpot(pool: string[], rng: Rng): string {
  if (pool.includes('wood_ear') && rng() < 0.32) return 'wood_ear';
  return rngWeighted(rng, pool.map((id) => [id, id === 'mushroom' ? 4 : 2] as const));
}
