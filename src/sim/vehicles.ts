import { MARKETS, type MarketDef, type MarketId } from './destinations';

export type VehicleId = 'walk' | 'bike' | 'ebike' | 'truck';

export interface VehicleDef {
  id: VehicleId;
  name: string;
  blurb: string;
  /** 0 表示开局就有，不用买。 */
  cost: number;
  markets: MarketId[];
  art: string;
}

/**
 * 走路开局就有。后面的只负责「看见更远的场」，进不进得去还看厨艺。
 * 小货车留给还没做的更远菜场，上面先空着。
 */
export const VEHICLES: VehicleDef[] = [
  {
    id: 'walk',
    name: '走路',
    blurb: '家门口转转，走到哪算哪。',
    cost: 0,
    markets: ['xiangko', 'heyan'],
    art: 'subpkg_images/vehicle_walk.png',
  },
  {
    id: 'bike',
    name: '自行车',
    blurb: '翻过那道坡，江边也够得着。',
    cost: 180,
    markets: ['shanwu', 'jiangbian'],
    art: 'subpkg_images/vehicle_bike.png',
  },
  {
    id: 'ebike',
    name: '电动车',
    blurb: '老城那一趟，走路要散架。',
    cost: 420,
    markets: ['laocheng'],
    art: 'subpkg_images/vehicle_ebike.png',
  },
  {
    id: 'truck',
    name: '小货车',
    blurb: '更远的场还在路上。',
    cost: 860,
    markets: [],
    art: 'subpkg_images/vehicle_truck.png',
  },
];

export function isVehicleId(id: unknown): id is VehicleId {
  return typeof id === 'string' && VEHICLES.some((v) => v.id === id);
}

export function vehicleById(id: VehicleId): VehicleDef {
  const hit = VEHICLES.find((v) => v.id === id);
  if (!hit) throw new Error(`未知交通工具: ${id}`);
  return hit;
}

export function vehicleIndex(id: VehicleId): number {
  return Math.max(0, VEHICLES.findIndex((v) => v.id === id));
}

export function neighborVehicle(id: VehicleId, dir: -1 | 1): VehicleId {
  const i = vehicleIndex(id);
  return VEHICLES[(i + dir + VEHICLES.length) % VEHICLES.length].id;
}

export type VehicleOffer = 'owned' | 'buyable' | 'locked';

/** 必须按走路→自行车→电动车→小货车买，跳级是剪影。 */
export function vehicleOffer(save: { vehicles?: readonly string[] }, id: VehicleId): VehicleOffer {
  if (ownsVehicle(save, id)) return 'owned';
  const i = vehicleIndex(id);
  if (i <= 0) return 'owned';
  return ownsVehicle(save, VEHICLES[i - 1].id) ? 'buyable' : 'locked';
}

export function marketsForVehicle(id: VehicleId): MarketDef[] {
  const allow = new Set(vehicleById(id).markets);
  return MARKETS.filter((m) => allow.has(m.id));
}

export function ownsVehicle(save: { vehicles?: readonly string[] }, id: VehicleId): boolean {
  if (id === 'walk') return true;
  return (save.vehicles ?? []).includes(id);
}

/** 身上只要有一辆能开到这个场的车，就算途径通了。 */
export function ownsRouteToMarket(save: { vehicles?: readonly string[] }, marketId: MarketId): boolean {
  return VEHICLES.some((v) => v.markets.includes(marketId) && ownsVehicle(save, v.id));
}

export function vehicleForMarket(marketId: MarketId): VehicleDef {
  return VEHICLES.find((v) => v.id !== 'truck' && v.markets.includes(marketId)) ?? VEHICLES[0];
}

/** 走路夜摊、自行车垂钓、电动车干货。小货车先空着。 */
export function specialMarketForVehicle(id: VehicleId): 'spice_night' | 'riverside_fish' | 'oldtown_dry' | null {
  if (id === 'walk') return 'spice_night';
  if (id === 'bike') return 'riverside_fish';
  if (id === 'ebike') return 'oldtown_dry';
  return null;
}

export function migrateVehicles(raw: {
  vehicle?: unknown;
  vehicles?: unknown;
}): { vehicle: VehicleId; vehicles: VehicleId[] } {
  const owned = new Set<VehicleId>(['walk']);
  if (Array.isArray(raw.vehicles)) {
    for (const id of raw.vehicles) {
      if (isVehicleId(id)) owned.add(id);
    }
  }
  const vehicle = isVehicleId(raw.vehicle) && owned.has(raw.vehicle) ? raw.vehicle : 'walk';
  return {
    vehicle,
    vehicles: VEHICLES.map((v) => v.id).filter((id) => owned.has(id)),
  };
}
