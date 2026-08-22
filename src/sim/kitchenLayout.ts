export type FurnId = 'fridge' | 'cook' | 'table' | 'basket' | 'foam' | 'recipe';

export const FURN_IDS: FurnId[] = ['fridge', 'table', 'basket', 'foam'];
export const FURN_MAX_LEVEL = 9;
export const FURN_LEVEL_COUNT = FURN_MAX_LEVEL + 1;

export const HOUSE_MAX_LEVEL = 2;
export const HOUSE_LEVEL_COUNT = HOUSE_MAX_LEVEL + 1;
export const HOUSE_LABEL = ['陋屋', '精装屋', '雅致屋'] as const;
/** 三档同机位、同画幅，一屏看完，不再加宽。 */
export const HOUSE_SCREENS = [1.22, 1.22, 1.22];
export const HOUSE_FALLBACK_SIZE = [
  { w: 853, h: 1280 },
  { w: 853, h: 1280 },
  { w: 853, h: 1280 },
];

export interface FurnLayout {
  id: FurnId;
  level: number;
  house: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  hang?: boolean;
}

export const FURN_LABEL: Record<FurnId, string> = {
  fridge: '冰箱',
  cook: '炒菜区',
  recipe: '菜谱',
  table: '烹饪台',
  basket: '菜篮',
  foam: '泡沫箱',
};

/** 本档房屋能装下的家具最高级（0–9）。 */
const HOUSE_FURN_CAP: Record<number, Record<FurnId, number>> = {
  0: { fridge: 3, cook: 2, table: 2, basket: 3, foam: 2, recipe: 2 },
  1: { fridge: 5, cook: 5, table: 5, basket: 5, foam: 4, recipe: 5 },
  2: { fridge: 9, cook: 9, table: 9, basket: 9, foam: 9, recipe: 9 },
};

export function clampFurnLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(FURN_MAX_LEVEL, Math.floor(level)));
}

export function clampHouseLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(HOUSE_MAX_LEVEL, Math.floor(level)));
}

export function houseLabel(level = 0): string {
  return HOUSE_LABEL[clampHouseLevel(level)];
}

export function houseFurnCap(house: number, id: FurnId): number {
  return HOUSE_FURN_CAP[clampHouseLevel(house)][id];
}

export function minHouseForFurn(id: FurnId, furnLevel: number): number {
  const lv = clampFurnLevel(furnLevel);
  for (let h = 0; h <= HOUSE_MAX_LEVEL; h++) {
    if (houseFurnCap(h, id) >= lv) return h;
  }
  return HOUSE_MAX_LEVEL;
}

export function houseRoomCandidates(house: number): string[] {
  const h = clampHouseLevel(house);
  const paths = [`subpkg_kitchen/kitchen_room_${h}.jpg`];
  if (h === 2) paths.push('subpkg_images/kitchen_room.jpg');
  return paths;
}

export function houseDoor(_house: number): { nx: number; ny: number; nw: number; nh: number } {
  return { nx: 0.00, ny: 0.16, nw: 0.24, nh: 0.50 };
}

/** 房屋升级箭头钉在门扇上（门中线、门板上沿），跟房间贴图走。 */
export function houseUpgradeMark(_house = 0): { nx: number; ny: number } {
  const door = houseDoor(_house);
  return { nx: door.nx + door.nw * 0.5, ny: door.ny + door.nh * 0.28 };
}

/** 质变道具按当前形态显示名字（装修面板 / GM / 热区）。 */
export function furnLabel(id: FurnId, level = 0): string {
  const lv = clampFurnLevel(level);
  if (id === 'foam') {
    if (lv <= 1) return '水桶';
    if (lv <= 4) return '泡沫箱';
    if (lv <= 7) return '保温箱';
    return '双层保温箱';
  }
  if (id === 'basket') {
    if (lv <= 1) return '塑料袋';
    if (lv <= 3) return '小菜篮';
    if (lv <= 5) return '菜篮';
    if (lv <= 7) return '菜筐';
    return '双层菜篮';
  }
  if (id === 'table') {
    if (lv >= 8) return '大理石岛台';
    if (lv >= 5) return '岛台灶';
    if (lv >= 3) return '蛋卷桌';
    return '烹饪台';
  }
  return FURN_LABEL[id];
}

type Pose = Omit<FurnLayout, 'id' | 'level' | 'house'>;

const HOUSE_POSE_MAP: Record<number, Record<FurnId, Pose>> = {
  0: {
    fridge: { nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
    cook: { nx: 0.526, ny: 0.462, nw: 0.179, nh: 0.217 },
    recipe: { nx: 0.536, ny: 0.391, nw: 0.070, nh: 0.058, hang: true },
    basket: { nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
    foam: { nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
    table: { nx: 0.174, ny: 0.640, nw: 0.420, nh: 0.360 },
  },
  1: {
    fridge: { nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
    cook: { nx: 0.526, ny: 0.462, nw: 0.179, nh: 0.217 },
    recipe: { nx: 0.536, ny: 0.391, nw: 0.070, nh: 0.058, hang: true },
    basket: { nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
    foam: { nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
    table: { nx: 0.077, ny: 0.572, nw: 0.583, nh: 0.484 },
  },
  2: {
    fridge: { nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
    cook: { nx: 0.526, ny: 0.462, nw: 0.179, nh: 0.217 },
    recipe: { nx: 0.536, ny: 0.391, nw: 0.070, nh: 0.058, hang: true },
    basket: { nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
    foam: { nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
    table: { nx: 0.077, ny: 0.572, nw: 0.583, nh: 0.484 },
  },
};

const HOUSE_BOX_SCALE = [1.65, 1.65, 1.65];

/** GM 固化：三档房屋每级坐标。有则覆盖公式。 */
const BAKED_POSES: FurnLayout[] = [
  { id: 'fridge', house: 0, level: 0, nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
  { id: 'fridge', house: 0, level: 1, nx: 0.496, ny: 0.439, nw: 0.143, nh: 0.234 },
  { id: 'fridge', house: 0, level: 2, nx: 0.488, ny: 0.397, nw: 0.174, nh: 0.285 },
  { id: 'fridge', house: 0, level: 3, nx: 0.499, ny: 0.399, nw: 0.174, nh: 0.284 },
  { id: 'fridge', house: 0, level: 4, nx: 0.491, ny: 0.350, nw: 0.208, nh: 0.341 },
  { id: 'fridge', house: 0, level: 5, nx: 0.511, ny: 0.354, nw: 0.205, nh: 0.335 },
  { id: 'fridge', house: 0, level: 6, nx: 0.498, ny: 0.318, nw: 0.220, nh: 0.380 },
  { id: 'fridge', house: 0, level: 7, nx: 0.488, ny: 0.292, nw: 0.232, nh: 0.410 },
  { id: 'fridge', house: 0, level: 8, nx: 0.478, ny: 0.270, nw: 0.244, nh: 0.440 },
  { id: 'fridge', house: 0, level: 9, nx: 0.468, ny: 0.248, nw: 0.256, nh: 0.470 },
  { id: 'cook', house: 0, level: 0, nx: 0.526, ny: 0.462, nw: 0.179, nh: 0.217 },
  { id: 'cook', house: 0, level: 1, nx: 0.508, ny: 0.458, nw: 0.182, nh: 0.221 },
  { id: 'cook', house: 0, level: 2, nx: 0.487, ny: 0.378, nw: 0.244, nh: 0.296 },
  { id: 'cook', house: 0, level: 3, nx: 0.489, ny: 0.431, nw: 0.221, nh: 0.269 },
  { id: 'cook', house: 0, level: 4, nx: 0.480, ny: 0.408, nw: 0.241, nh: 0.292 },
  { id: 'cook', house: 0, level: 5, nx: 0.470, ny: 0.384, nw: 0.260, nh: 0.316 },
  { id: 'cook', house: 0, level: 6, nx: 0.460, ny: 0.360, nw: 0.280, nh: 0.340 },
  { id: 'cook', house: 0, level: 7, nx: 0.450, ny: 0.336, nw: 0.300, nh: 0.364 },
  { id: 'cook', house: 0, level: 8, nx: 0.440, ny: 0.312, nw: 0.319, nh: 0.388 },
  { id: 'cook', house: 0, level: 9, nx: 0.431, ny: 0.289, nw: 0.339, nh: 0.411 },
  { id: 'recipe', house: 0, level: 0, nx: 0.536, ny: 0.391, nw: 0.070, nh: 0.058, hang: true },
  { id: 'recipe', house: 0, level: 1, nx: 0.535, ny: 0.391, nw: 0.063, nh: 0.080, hang: true },
  { id: 'recipe', house: 0, level: 2, nx: 0.527, ny: 0.384, nw: 0.086, nh: 0.072, hang: true },
  { id: 'recipe', house: 0, level: 3, nx: 0.542, ny: 0.382, nw: 0.060, nh: 0.080, hang: true },
  { id: 'recipe', house: 0, level: 4, nx: 0.526, ny: 0.374, nw: 0.093, nh: 0.080, hang: true },
  { id: 'recipe', house: 0, level: 5, nx: 0.744, ny: 0.300, nw: 0.112, nh: 0.093, hang: true },
  { id: 'recipe', house: 0, level: 6, nx: 0.740, ny: 0.300, nw: 0.120, nh: 0.100, hang: true },
  { id: 'recipe', house: 0, level: 7, nx: 0.736, ny: 0.300, nw: 0.128, nh: 0.107, hang: true },
  { id: 'recipe', house: 0, level: 8, nx: 0.732, ny: 0.300, nw: 0.137, nh: 0.114, hang: true },
  { id: 'recipe', house: 0, level: 9, nx: 0.727, ny: 0.300, nw: 0.145, nh: 0.121, hang: true },
  { id: 'basket', house: 0, level: 0, nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
  { id: 'basket', house: 0, level: 1, nx: 0.311, ny: 0.352, nw: 0.101, nh: 0.294, hang: true },
  { id: 'basket', house: 0, level: 2, nx: 0.323, ny: 0.344, nw: 0.096, nh: 0.218, hang: true },
  { id: 'basket', house: 0, level: 3, nx: 0.319, ny: 0.343, nw: 0.109, nh: 0.234, hang: true },
  { id: 'basket', house: 0, level: 4, nx: 0.316, ny: 0.341, nw: 0.120, nh: 0.264, hang: true },
  { id: 'basket', house: 0, level: 5, nx: 0.305, ny: 0.347, nw: 0.135, nh: 0.284, hang: true },
  { id: 'basket', house: 0, level: 6, nx: 0.303, ny: 0.339, nw: 0.148, nh: 0.294, hang: true },
  { id: 'basket', house: 0, level: 7, nx: 0.286, ny: 0.346, nw: 0.165, nh: 0.310, hang: true },
  { id: 'basket', house: 0, level: 8, nx: 0.286, ny: 0.344, nw: 0.157, nh: 0.350, hang: true },
  { id: 'basket', house: 0, level: 9, nx: 0.282, ny: 0.346, nw: 0.181, nh: 0.383, hang: true },
  { id: 'foam', house: 0, level: 0, nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
  { id: 'foam', house: 0, level: 1, nx: 0.257, ny: 0.460, nw: 0.112, nh: 0.211 },
  { id: 'foam', house: 0, level: 2, nx: 0.266, ny: 0.505, nw: 0.144, nh: 0.184 },
  { id: 'foam', house: 0, level: 3, nx: 0.261, ny: 0.493, nw: 0.160, nh: 0.203 },
  { id: 'foam', house: 0, level: 4, nx: 0.257, ny: 0.495, nw: 0.179, nh: 0.224 },
  { id: 'foam', house: 0, level: 5, nx: 0.263, ny: 0.492, nw: 0.173, nh: 0.215 },
  { id: 'foam', house: 0, level: 6, nx: 0.264, ny: 0.479, nw: 0.173, nh: 0.211 },
  { id: 'foam', house: 0, level: 7, nx: 0.256, ny: 0.484, nw: 0.190, nh: 0.218 },
  { id: 'foam', house: 0, level: 8, nx: 0.254, ny: 0.429, nw: 0.178, nh: 0.277 },
  { id: 'foam', house: 0, level: 9, nx: 0.261, ny: 0.397, nw: 0.206, nh: 0.310 },
  { id: 'table', house: 0, level: 0, nx: 0.174, ny: 0.640, nw: 0.420, nh: 0.360 },
  { id: 'table', house: 0, level: 1, nx: 0.170, ny: 0.652, nw: 0.440, nh: 0.370 },
  { id: 'table', house: 0, level: 2, nx: 0.165, ny: 0.622, nw: 0.460, nh: 0.380 },
  { id: 'table', house: 0, level: 3, nx: 0.107, ny: 0.614, nw: 0.528, nh: 0.429 },
  { id: 'table', house: 0, level: 4, nx: 0.108, ny: 0.623, nw: 0.545, nh: 0.446 },
  { id: 'table', house: 0, level: 5, nx: 0.086, ny: 0.593, nw: 0.572, nh: 0.473 },
  { id: 'table', house: 0, level: 6, nx: 0.077, ny: 0.572, nw: 0.583, nh: 0.484 },
  { id: 'table', house: 0, level: 7, nx: 0.067, ny: 0.553, nw: 0.594, nh: 0.495 },
  { id: 'table', house: 0, level: 8, nx: 0.055, ny: 0.537, nw: 0.605, nh: 0.506 },
  { id: 'table', house: 0, level: 9, nx: 0.049, ny: 0.537, nw: 0.616, nh: 0.517 },
  { id: 'fridge', house: 1, level: 0, nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
  { id: 'fridge', house: 1, level: 1, nx: 0.496, ny: 0.439, nw: 0.143, nh: 0.234 },
  { id: 'fridge', house: 1, level: 2, nx: 0.488, ny: 0.397, nw: 0.174, nh: 0.285 },
  { id: 'fridge', house: 1, level: 3, nx: 0.499, ny: 0.399, nw: 0.174, nh: 0.284 },
  { id: 'fridge', house: 1, level: 4, nx: 0.491, ny: 0.350, nw: 0.208, nh: 0.341 },
  { id: 'fridge', house: 1, level: 5, nx: 0.511, ny: 0.354, nw: 0.205, nh: 0.335 },
  { id: 'fridge', house: 1, level: 6, nx: 0.498, ny: 0.318, nw: 0.220, nh: 0.380 },
  { id: 'fridge', house: 1, level: 7, nx: 0.488, ny: 0.292, nw: 0.232, nh: 0.410 },
  { id: 'fridge', house: 1, level: 8, nx: 0.478, ny: 0.270, nw: 0.244, nh: 0.440 },
  { id: 'fridge', house: 1, level: 9, nx: 0.468, ny: 0.248, nw: 0.256, nh: 0.470 },
  { id: 'table', house: 1, level: 0, nx: 0.174, ny: 0.640, nw: 0.420, nh: 0.360 },
  { id: 'table', house: 1, level: 1, nx: 0.170, ny: 0.652, nw: 0.440, nh: 0.370 },
  { id: 'table', house: 1, level: 2, nx: 0.165, ny: 0.622, nw: 0.460, nh: 0.380 },
  { id: 'table', house: 1, level: 3, nx: 0.107, ny: 0.614, nw: 0.528, nh: 0.429 },
  { id: 'table', house: 1, level: 4, nx: 0.108, ny: 0.623, nw: 0.545, nh: 0.446 },
  { id: 'table', house: 1, level: 5, nx: 0.086, ny: 0.593, nw: 0.572, nh: 0.473 },
  { id: 'table', house: 1, level: 6, nx: 0.077, ny: 0.572, nw: 0.583, nh: 0.484 },
  { id: 'table', house: 1, level: 7, nx: 0.067, ny: 0.553, nw: 0.594, nh: 0.495 },
  { id: 'table', house: 1, level: 8, nx: 0.055, ny: 0.537, nw: 0.605, nh: 0.506 },
  { id: 'table', house: 1, level: 9, nx: 0.049, ny: 0.537, nw: 0.616, nh: 0.517 },
  { id: 'basket', house: 1, level: 0, nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
  { id: 'basket', house: 1, level: 1, nx: 0.311, ny: 0.352, nw: 0.101, nh: 0.294, hang: true },
  { id: 'basket', house: 1, level: 2, nx: 0.323, ny: 0.344, nw: 0.096, nh: 0.218, hang: true },
  { id: 'basket', house: 1, level: 3, nx: 0.319, ny: 0.343, nw: 0.109, nh: 0.234, hang: true },
  { id: 'basket', house: 1, level: 4, nx: 0.316, ny: 0.341, nw: 0.120, nh: 0.264, hang: true },
  { id: 'basket', house: 1, level: 5, nx: 0.305, ny: 0.347, nw: 0.135, nh: 0.284, hang: true },
  { id: 'basket', house: 1, level: 6, nx: 0.303, ny: 0.339, nw: 0.148, nh: 0.294, hang: true },
  { id: 'basket', house: 1, level: 7, nx: 0.286, ny: 0.346, nw: 0.165, nh: 0.310, hang: true },
  { id: 'basket', house: 1, level: 8, nx: 0.286, ny: 0.344, nw: 0.157, nh: 0.350, hang: true },
  { id: 'basket', house: 1, level: 9, nx: 0.282, ny: 0.346, nw: 0.181, nh: 0.383, hang: true },
  { id: 'foam', house: 1, level: 0, nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
  { id: 'foam', house: 1, level: 1, nx: 0.257, ny: 0.460, nw: 0.112, nh: 0.211 },
  { id: 'foam', house: 1, level: 2, nx: 0.266, ny: 0.505, nw: 0.144, nh: 0.184 },
  { id: 'foam', house: 1, level: 3, nx: 0.261, ny: 0.493, nw: 0.160, nh: 0.203 },
  { id: 'foam', house: 1, level: 4, nx: 0.257, ny: 0.495, nw: 0.179, nh: 0.224 },
  { id: 'foam', house: 1, level: 5, nx: 0.263, ny: 0.492, nw: 0.173, nh: 0.215 },
  { id: 'foam', house: 1, level: 6, nx: 0.264, ny: 0.479, nw: 0.173, nh: 0.211 },
  { id: 'foam', house: 1, level: 7, nx: 0.256, ny: 0.484, nw: 0.190, nh: 0.218 },
  { id: 'foam', house: 1, level: 8, nx: 0.254, ny: 0.429, nw: 0.178, nh: 0.277 },
  { id: 'foam', house: 1, level: 9, nx: 0.261, ny: 0.397, nw: 0.206, nh: 0.310 },
  { id: 'fridge', house: 2, level: 0, nx: 0.481, ny: 0.410, nw: 0.166, nh: 0.272 },
  { id: 'fridge', house: 2, level: 1, nx: 0.496, ny: 0.439, nw: 0.143, nh: 0.234 },
  { id: 'fridge', house: 2, level: 2, nx: 0.488, ny: 0.397, nw: 0.174, nh: 0.285 },
  { id: 'fridge', house: 2, level: 3, nx: 0.499, ny: 0.399, nw: 0.174, nh: 0.284 },
  { id: 'fridge', house: 2, level: 4, nx: 0.491, ny: 0.350, nw: 0.208, nh: 0.341 },
  { id: 'fridge', house: 2, level: 5, nx: 0.511, ny: 0.354, nw: 0.205, nh: 0.335 },
  { id: 'fridge', house: 2, level: 6, nx: 0.498, ny: 0.318, nw: 0.220, nh: 0.380 },
  { id: 'fridge', house: 2, level: 7, nx: 0.488, ny: 0.292, nw: 0.232, nh: 0.410 },
  { id: 'fridge', house: 2, level: 8, nx: 0.478, ny: 0.270, nw: 0.244, nh: 0.440 },
  { id: 'fridge', house: 2, level: 9, nx: 0.468, ny: 0.248, nw: 0.256, nh: 0.470 },
  { id: 'table', house: 2, level: 0, nx: 0.174, ny: 0.640, nw: 0.420, nh: 0.360 },
  { id: 'table', house: 2, level: 1, nx: 0.170, ny: 0.652, nw: 0.440, nh: 0.370 },
  { id: 'table', house: 2, level: 2, nx: 0.165, ny: 0.622, nw: 0.460, nh: 0.380 },
  { id: 'table', house: 2, level: 3, nx: 0.107, ny: 0.614, nw: 0.528, nh: 0.429 },
  { id: 'table', house: 2, level: 4, nx: 0.108, ny: 0.623, nw: 0.545, nh: 0.446 },
  { id: 'table', house: 2, level: 5, nx: 0.086, ny: 0.593, nw: 0.572, nh: 0.473 },
  { id: 'table', house: 2, level: 6, nx: 0.077, ny: 0.572, nw: 0.583, nh: 0.484 },
  { id: 'table', house: 2, level: 7, nx: 0.067, ny: 0.553, nw: 0.594, nh: 0.495 },
  { id: 'table', house: 2, level: 8, nx: 0.055, ny: 0.537, nw: 0.605, nh: 0.506 },
  { id: 'table', house: 2, level: 9, nx: 0.049, ny: 0.537, nw: 0.616, nh: 0.517 },
  { id: 'basket', house: 2, level: 0, nx: 0.325, ny: 0.348, nw: 0.087, nh: 0.268, hang: true },
  { id: 'basket', house: 2, level: 1, nx: 0.311, ny: 0.352, nw: 0.101, nh: 0.294, hang: true },
  { id: 'basket', house: 2, level: 2, nx: 0.323, ny: 0.344, nw: 0.096, nh: 0.218, hang: true },
  { id: 'basket', house: 2, level: 3, nx: 0.319, ny: 0.343, nw: 0.109, nh: 0.234, hang: true },
  { id: 'basket', house: 2, level: 4, nx: 0.316, ny: 0.341, nw: 0.120, nh: 0.264, hang: true },
  { id: 'basket', house: 2, level: 5, nx: 0.305, ny: 0.347, nw: 0.135, nh: 0.284, hang: true },
  { id: 'basket', house: 2, level: 6, nx: 0.303, ny: 0.339, nw: 0.148, nh: 0.294, hang: true },
  { id: 'basket', house: 2, level: 7, nx: 0.286, ny: 0.346, nw: 0.165, nh: 0.310, hang: true },
  { id: 'basket', house: 2, level: 8, nx: 0.286, ny: 0.344, nw: 0.157, nh: 0.350, hang: true },
  { id: 'basket', house: 2, level: 9, nx: 0.282, ny: 0.346, nw: 0.181, nh: 0.383, hang: true },
  { id: 'foam', house: 2, level: 0, nx: 0.276, ny: 0.485, nw: 0.091, nh: 0.178 },
  { id: 'foam', house: 2, level: 1, nx: 0.257, ny: 0.460, nw: 0.112, nh: 0.211 },
  { id: 'foam', house: 2, level: 2, nx: 0.266, ny: 0.505, nw: 0.144, nh: 0.184 },
  { id: 'foam', house: 2, level: 3, nx: 0.261, ny: 0.493, nw: 0.160, nh: 0.203 },
  { id: 'foam', house: 2, level: 4, nx: 0.257, ny: 0.495, nw: 0.179, nh: 0.224 },
  { id: 'foam', house: 2, level: 5, nx: 0.263, ny: 0.492, nw: 0.173, nh: 0.215 },
  { id: 'foam', house: 2, level: 6, nx: 0.264, ny: 0.479, nw: 0.173, nh: 0.211 },
  { id: 'foam', house: 2, level: 7, nx: 0.256, ny: 0.484, nw: 0.190, nh: 0.218 },
  { id: 'foam', house: 2, level: 8, nx: 0.254, ny: 0.429, nw: 0.178, nh: 0.277 },
  { id: 'foam', house: 2, level: 9, nx: 0.261, ny: 0.397, nw: 0.206, nh: 0.310 },
];

const BAKED_MAP = new Map(
  BAKED_POSES.map((it) => [`${it.house}:${it.id}:${it.level}`, it] as const),
);

/** 泡沫/菜篮质变后的默认框。落地钉底、挂件钉顶。 */
const STAGE_BOX: Partial<Record<FurnId, Record<number, { nw: number; nh: number }>>> = {
  foam: {
    0: { nw: 0.050, nh: 0.098 },
    1: { nw: 0.068, nh: 0.128 },
    2: { nw: 0.072, nh: 0.092 },
    3: { nw: 0.080, nh: 0.102 },
    4: { nw: 0.090, nh: 0.112 },
    5: { nw: 0.095, nh: 0.118 },
    6: { nw: 0.105, nh: 0.128 },
    7: { nw: 0.115, nh: 0.132 },
    8: { nw: 0.108, nh: 0.168 },
    9: { nw: 0.125, nh: 0.188 },
  },
  basket: {
    0: { nw: 0.048, nh: 0.148 },
    1: { nw: 0.056, nh: 0.162 },
    2: { nw: 0.058, nh: 0.132 },
    3: { nw: 0.066, nh: 0.142 },
    4: { nw: 0.073, nh: 0.160 },
    5: { nw: 0.082, nh: 0.172 },
    6: { nw: 0.090, nh: 0.178 },
    7: { nw: 0.100, nh: 0.188 },
    8: { nw: 0.095, nh: 0.212 },
    9: { nw: 0.110, nh: 0.232 },
  },
  table: {
    5: { nw: 0.34, nh: 0.30 },
    6: { nw: 0.38, nh: 0.32 },
    7: { nw: 0.42, nh: 0.34 },
    8: { nw: 0.46, nh: 0.36 },
    9: { nw: 0.50, nh: 0.38 },
  },
};

function poseAt(id: FurnId, level: number, house = 2): FurnLayout {
  const h = clampHouseLevel(house);
  const lv = clampFurnLevel(level);
  const baked = BAKED_MAP.get(`${h}:${id}:${lv}`) ?? BAKED_MAP.get(`0:${id}:${lv}`);
  if (baked) {
    const hang = baked.hang || HOUSE_POSE_MAP[h][id].hang;
    return { ...baked, id, level: lv, house: h, ...(hang ? { hang: true as const } : {}) };
  }
  const base = HOUSE_POSE_MAP[h][id];
  const scale = HOUSE_BOX_SCALE[h];
  const box = STAGE_BOX[id]?.[lv];
  const g = 0.58 + Math.max(0, lv) * 0.07;
  const nw = (box ? box.nw * scale : Math.min(0.62, base.nw * g));
  const nh = (box ? box.nh * scale : Math.min(0.72, base.nh * g));
  const nx = base.nx - (nw - base.nw) / 2;
  const ny = base.hang ? base.ny : base.ny + base.nh - nh;
  return {
    id,
    level: lv,
    house: h,
    nx,
    ny,
    nw,
    nh,
    ...(base.hang ? { hang: true as const } : {}),
  };
}

export const DEFAULT_FURNITURE_LAYOUT: FurnLayout[] = Array.from(
  { length: HOUSE_LEVEL_COUNT },
  (_, house) => house,
).flatMap((house) =>
  FURN_IDS.flatMap((id) =>
    Array.from({ length: FURN_LEVEL_COUNT }, (_, level) => poseAt(id, level, house)),
  ),
);

export function layoutFor(list: FurnLayout[], id: FurnId, level: number, house = 2): FurnLayout {
  const lv = clampFurnLevel(level);
  const h = clampHouseLevel(house);
  return list.find((it) => it.id === id && it.level === lv && clampHouseLevel(it.house ?? 2) === h)
    ?? poseAt(id, lv, h);
}

export function cloneLayout(list: FurnLayout[] = DEFAULT_FURNITURE_LAYOUT): FurnLayout[] {
  return list.map((it) => ({ ...it }));
}

const GM_KEY = 'jiancai_kitchen_gm';

export function loadGmLayout(): FurnLayout[] {
  try {
    const raw = (globalThis as any).wx?.getStorageSync?.(GM_KEY)
      ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(GM_KEY) : null);
    if (!raw || typeof raw !== 'string') return cloneLayout();
    const parsed = JSON.parse(raw) as FurnLayout[];
    if (!Array.isArray(parsed) || !parsed.length) return cloneLayout();
    return DEFAULT_FURNITURE_LAYOUT.map((base) => {
      const hit = parsed.find((it) =>
        it.id === base.id
        && (it.level ?? 0) === base.level
        && clampHouseLevel(it.house ?? 2) === base.house,
      ) ?? (base.house === 2
        ? parsed.find((it) => it.id === base.id && (it.level ?? 0) === base.level && it.house == null)
        : undefined)
        ?? parsed.find((it) => it.id === base.id && it.level == null && base.level === 0 && base.house === 2);
      return hit ? { ...base, ...hit, id: base.id, level: base.level, house: base.house } : { ...base };
    });
  } catch {
    return cloneLayout();
  }
}

export function saveGmLayout(list: FurnLayout[]): void {
  const text = JSON.stringify(list);
  try { (globalThis as any).wx?.setStorageSync?.(GM_KEY, text); } catch (_) {}
  try { localStorage?.setItem(GM_KEY, text); } catch (_) {}
}

export function dumpKitchenLayout(
  list: FurnLayout[],
  house?: number,
  view?: Partial<Record<FurnId, number>>,
): string {
  const h = house == null ? null : clampHouseLevel(house);
  const rows = [...list]
    .filter((it) => h == null || clampHouseLevel(it.house ?? 2) === h)
    .sort((a, b) => {
      const ha = clampHouseLevel(a.house ?? 2) - clampHouseLevel(b.house ?? 2);
      if (ha) return ha;
      const id = FURN_IDS.indexOf(a.id) - FURN_IDS.indexOf(b.id);
      return id || a.level - b.level;
    })
    .map((it) => {
      const hang = it.hang ? ', hang: true' : '';
      const mark = view && view[it.id] === it.level ? ' // 当前预览' : '';
      return `  { id: '${it.id}', house: ${clampHouseLevel(it.house ?? 2)}, level: ${it.level}, nx: ${it.nx.toFixed(3)}, ny: ${it.ny.toFixed(3)}, nw: ${it.nw.toFixed(3)}, nh: ${it.nh.toFixed(3)}${hang} },${mark}`;
    });
  const preview = view
    ? `当前预览 ${FURN_IDS.map((id) => `${id} ${(view[id] ?? 0) + 1}级`).join(' · ')}`
    : '';
  return [
    h == null ? '厨房家具布局（房屋×等级）' : `厨房家具布局 · ${houseLabel(h)}`,
    preview,
    '每件家具每一级单独记坐标；点一件再用级+/-切换后再拖。',
    '',
    'FURNITURE =',
    '[',
    ...rows,
    ']',
  ].filter((line) => line !== undefined).join('\n');
}
