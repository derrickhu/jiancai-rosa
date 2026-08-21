import {
  GOD_PICK,
  STALLS,
  displayName,
  initialFreshness,
  itemsForStall,
  sellPrice,
  type Quality,
  type StallId,
} from './items';
import type { MarketId } from './destinations';
import { PACK_FULL, PACK_RATE, clampPack, emptyPacking } from './packing';
import type { BasketItem, BasketState } from './basket';

export const RUN_SECONDS = 150;
export const DIM_AT = 30;
export const WASH_AT = 10;

export type RunMode = 'overview' | 'rummage';
export type ExtractKind = 'safe' | 'messy';

export interface PileItem {
  uid: string;
  defId: string;
  disguiseId?: string;
  quality: Quality;
  revealed: boolean;
  inspected: boolean;
  washed: boolean;
  /** 已从菜筐抽到桌上。 */
  drawn: boolean;
}

export interface RunState {
  timeLeft: number;
  packing: Record<StallId, number>;
  paid: StallId[];
  mode: RunMode;
  marketId: MarketId;
  currentStall: StallId | null;
  piles: Record<StallId, PileItem[]>;
  ended: boolean;
  extract?: ExtractResult;
}

export interface ExtractedItem {
  uid: string;
  defId: string;
  quality: Quality;
  inspected: boolean;
  freshness: number;
  name: string;
  sell: number;
}

export interface ExtractResult {
  kind: ExtractKind;
  items: ExtractedItem[];
  lost: number;
  needsPick?: boolean;
}

let _uidSeq = 1;
export function nextUid(prefix = 'i'): string {
  _uidSeq += 1;
  return `${prefix}${_uidSeq.toString(36)}`;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function rollQuality(): Quality {
  const r = Math.random();
  if (r < 0.18) return 'rotten';
  if (r < 0.62) return 'common';
  if (r < 0.88) return 'fresh';
  return 'premium';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createRun(opts: { allowGodPick: boolean; marketId?: MarketId }): RunState {
  const piles = {} as Record<StallId, PileItem[]>;

  for (const stall of STALLS) {
    const pool = itemsForStall(stall.id);
    const n = randInt(stall.count[0], stall.count[1]);
    const list: PileItem[] = [];
    for (let i = 0; i < n; i++) {
      const def = pick(pool);
      list.push({
        uid: nextUid('p'),
        defId: def.id,
        quality: rollQuality(),
        revealed: false,
        inspected: false,
        washed: false,
        drawn: false,
      });
    }
    piles[stall.id] = list;
  }

  if (opts.allowGodPick && Math.random() < 0.85) {
    const fish = piles.fish;
    const host = fish.find((it) => it.defId === 'smallfish') ?? pick(fish);
    if (host) {
      host.defId = GOD_PICK.id;
      host.disguiseId = 'smallfish';
      host.quality = 'god';
    }
  }

  return {
    timeLeft: RUN_SECONDS,
    packing: emptyPacking(),
    paid: [],
    mode: 'overview',
    marketId: opts.marketId ?? 'xiangko',
    currentStall: null,
    piles,
    ended: false,
    extract: undefined,
  };
}

export function visibleDefId(item: PileItem): string {
  if (item.defId === GOD_PICK.id && !item.inspected) return item.disguiseId || 'smallfish';
  return item.defId;
}

export function tickRun(state: RunState, dt: number, _interacting: boolean): RunState {
  if (state.ended) return state;
  let timeLeft = Math.max(0, state.timeLeft - dt);
  const packing = { ...state.packing };
  const piles = { ...state.piles };

  if (state.mode === 'rummage' && state.currentStall) {
    const id = state.currentStall;
    packing[id] = clampPack(packing[id] + dt * PACK_RATE[id]);
    if (packing[id] >= PACK_FULL) {
      piles[id] = piles[id].map((it) => (it.washed ? it : { ...it, washed: true }));
    }
  }

  if (timeLeft <= WASH_AT) {
    const washChance = dt * 2;
    if (Math.random() < washChance) {
      const stallIds = STALLS.map((s) => s.id);
      const stall = pick(stallIds);
      const ground = piles[stall].filter((it) => !it.washed);
      if (ground.length) {
        const victim = pick(ground);
        piles[stall] = piles[stall].map((it) => (it.uid === victim.uid ? { ...it, washed: true } : it));
      }
    }
  }

  const ended = timeLeft <= 0 ? true : state.ended;
  return { ...state, timeLeft, packing, piles, ended };
}

export function settleExtract(kind: ExtractKind, basket: BasketState): ExtractResult {
  const items: ExtractedItem[] = basket.items.map((it) => {
    let quality = it.quality;
    let freshness = it.freshness;
    if (kind === 'messy' && quality !== 'rotten') freshness -= 2;
    if (it.dampened && quality !== 'rotten') freshness -= 1;
    if (quality === 'rotten' || freshness <= 0) {
      quality = 'rotten';
      freshness = 1;
    }
    return {
      uid: it.uid,
      defId: it.defId,
      quality,
      inspected: it.inspected,
      freshness,
      name: displayName(it.defId, it.inspected, quality),
      sell: sellPrice(it.defId, quality, it.inspected, freshness),
    };
  });
  return { kind, items, lost: 0 };
}

export function decideExtract(state: RunState, voluntary: boolean): ExtractKind {
  if (!voluntary || state.timeLeft <= 0) return 'messy';
  return 'safe';
}

export function pileToBasketDraft(item: PileItem): Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'> {
  return {
    uid: item.uid,
    defId: item.defId,
    quality: item.quality,
    inspected: item.inspected,
    freshness: initialFreshness(item.quality),
  };
}
