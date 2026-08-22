import type { MarketId } from './destinations';
import { rngPick, type Rng } from './rng';

export type Zone = 'dry' | 'wet';
export type Quality = 'rotten' | 'common' | 'fresh' | 'premium' | 'god';
export type StallId = 'leaf' | 'root' | 'egg' | 'fish' | 'meat';

export interface ItemDef {
  id: string;
  name: string;
  /** 占格宽。后继美术按 w:h 出图，不要做成统一方图标。 */
  w: number;
  h: number;
  zone: Zone;
  live?: boolean;
  fragile?: boolean;
  squeezable?: boolean;
  hard?: boolean;
  bulky?: boolean;
  vegetable?: boolean;
  prices: Record<'common' | 'fresh' | 'premium', number> & { god?: number };
  stalls: StallId[];
  color: number;
  /** 给玩家看的一句闲话。新食材入库必须写，1～2 句，有活人感。 */
  blurb: string;
  /** 坏掉时的吐槽。没有就用通用烂货句。 */
  blurbRotten?: string;
}

export const QUALITY_RANK: Record<Quality, number> = {
  rotten: 0,
  common: 1,
  fresh: 2,
  premium: 3,
  god: 4,
};

export const RANK_TO_QUALITY: Quality[] = ['common', 'common', 'fresh', 'premium', 'god'];

export const ITEMS: ItemDef[] = [
  { id: 'bokchoy', name: '小白菜', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 4, fresh: 8, premium: 14 }, color: 0x6BA368, blurb: '摊上最常见的绿叶子，帮你证明今晚真的开过火。', blurbRotten: '叶子摊成湿报纸，连虫都懒得来。' },
  { id: 'lettuce', name: '生菜', w: 2, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 5, fresh: 10, premium: 16 }, color: 0x8FCB6B, blurb: '一整个脆生生的脑袋，凉拌比炒更懂它。', blurbRotten: '边儿发红了，像熬夜熬过头。' },
  { id: 'cabbage', name: '白菜', w: 2, h: 3, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 7, fresh: 14, premium: 22 }, color: 0xC8E6A0, blurb: '层层叠叠能包一冬，也最擅长在菜篮里占座。', blurbRotten: '外帮黏了，里面还在装完好。' },
  { id: 'cilantro', name: '香菜', w: 1, h: 1, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 3, fresh: 7, premium: 12 }, color: 0x3D7A3A, blurb: '有人闻见就逃，有人觉得没它不算一盘菜。', blurbRotten: '香气先走了，只剩一撮黑头发。' },
  { id: 'radish', name: '萝卜', w: 1, h: 3, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 4, fresh: 9, premium: 15 }, color: 0xF2E6D8, blurb: '皮白心脆，生啃也行，是北方冬天的良心。', blurbRotten: '空心了，敲一敲全是失望。' },
  { id: 'potato', name: '土豆', w: 1, h: 1, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 3, fresh: 6, premium: 10 }, color: 0xC4A574, blurb: '泥里翻出来的万能演员，炖炒炸都认它。', blurbRotten: '发芽了还想上班，建议它休息。' },
  { id: 'cucumber', name: '黄瓜', w: 1, h: 3, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 4, fresh: 8, premium: 14 }, color: 0x4CAF50, blurb: '顶花带刺才算新鲜，咬一口能听到水声。', blurbRotten: '软得像一条后悔的丝瓜。' },
  { id: 'eggplant', name: '茄子', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x6A3D8A, blurb: '紫得发亮的整根货，别问切面，它还没准备好。', blurbRotten: '褐斑爬上来了，光泽先辞职。' },
  { id: 'corn', name: '玉米', w: 1, h: 2, zone: 'dry', vegetable: true, hard: true, stalls: ['root'], prices: { common: 5, fresh: 9, premium: 15 }, color: 0xE8C547, blurb: '一捧金钉子，烤一烤连芯都能聊两句。', blurbRotten: '粒儿瘪了，只剩一根失望的棒子。' },
  { id: 'melon', name: '冬瓜', w: 3, h: 2, zone: 'dry', vegetable: true, bulky: true, stalls: ['root'], prices: { common: 8, fresh: 14, premium: 20 }, color: 0x9BBB7A, blurb: '菜市场的沙发垫，又白又沉，下汤化成温柔。', blurbRotten: '霜打过了，抱起来像一袋叹气。' },
  { id: 'tomato', name: '番茄', w: 1, h: 1, zone: 'dry', vegetable: true, stalls: ['egg'], prices: { common: 4, fresh: 9, premium: 16 }, color: 0xD64545, blurb: '红得心虚，一切就流汁，天生来配鸡蛋。', blurbRotten: '皮皱成老太太，汁还在装年轻。' },
  { id: 'garlic', name: '大蒜', w: 1, h: 1, zone: 'dry', stalls: ['egg'], prices: { common: 3, fresh: 6, premium: 11 }, color: 0xEDE6D9, blurb: '一小头脾气很大，灶台没它就像没开门。', blurbRotten: '干瘪发芽，气味还在坚持上班。' },
  { id: 'ginger', name: '生姜', w: 1, h: 1, zone: 'dry', stalls: ['egg'], prices: { common: 3, fresh: 6, premium: 10 }, color: 0xD4A574, blurb: '长得像迷路的手指，去腥暖胃全靠它吼一嗓。', blurbRotten: '皱得像晒干的秘密，辣味所剩无几。' },
  { id: 'egg', name: '鸡蛋', w: 1, h: 1, zone: 'dry', fragile: true, stalls: ['egg'], prices: { common: 5, fresh: 10, premium: 18 }, color: 0xF4D58D, blurb: '圆得过分老实，一磕就决定今晚炒还是煮。', blurbRotten: '摇一摇有声，说明它已经有了自己的想法。' },
  { id: 'tofu', name: '豆腐', w: 2, h: 1, zone: 'dry', squeezable: true, stalls: ['egg'], prices: { common: 5, fresh: 10, premium: 16 }, color: 0xF7F2E4, blurb: '嫩得像刚睡醒，旁边千万别放活物。', blurbRotten: '发酸了，谁碰谁后悔。' },
  { id: 'smallfish', name: '小鱼', w: 1, h: 2, zone: 'wet', stalls: ['fish'], prices: { common: 6, fresh: 12, premium: 20 }, color: 0x6B8E9F, blurb: '银闪闪一小条，可能是漏网之鱼，也可能是漏网之神。', blurbRotten: '眼睛先翻白，味道随后赶到。' },
  { id: 'hairtail', name: '带鱼', w: 1, h: 4, zone: 'wet', stalls: ['fish'], prices: { common: 7, fresh: 15, premium: 26 }, color: 0x8FA8B5, blurb: '细长一条像银腰带，占格吓人，下锅却很识相。', blurbRotten: '银光褪尽，只剩一条咸湿的悔恨。' },
  { id: 'shrimp', name: '虾', w: 1, h: 1, zone: 'wet', stalls: ['fish'], prices: { common: 8, fresh: 16, premium: 28 }, color: 0xE07A5F, blurb: '弯着腰的红家伙，蒜一响它就值回票价。', blurbRotten: '头先黑，说明它已经写完遗书。' },
  { id: 'clam', name: '花蛤', w: 1, h: 1, zone: 'wet', stalls: ['fish'], prices: { common: 6, fresh: 12, premium: 22 }, color: 0xB8A38A, blurb: '闭嘴的小房子，吐沙之后才肯跟你做汤。', blurbRotten: '张嘴不闭，里面已经没人在家。' },
  { id: 'crab', name: '螃蟹', w: 2, h: 2, zone: 'wet', live: true, stalls: ['fish'], prices: { common: 12, fresh: 24, premium: 40 }, color: 0xC0392B, blurb: '还在挥钳子，活的才算数，别让它在篮里散步。', blurbRotten: '钳子掉了，脾气也没了。' },
  { id: 'yellowfish', name: '黄鱼', w: 2, h: 1, zone: 'wet', stalls: ['fish'], prices: { common: 14, fresh: 28, premium: 48 }, color: 0xE0A100, blurb: '金灿灿一条，黄鱼摊上的面子工程。', blurbRotten: '金色褪成旧窗帘，刺还在坚持存在。' },
  { id: 'spinach', name: '菠菜', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 4, fresh: 8, premium: 14 }, color: 0x3D7A3A, blurb: '红根还在，才像刚从筐里拔的。', blurbRotten: '叶子黑了，红根也救不回来。' },
  { id: 'chive', name: '韭菜', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x4A8A3A, blurb: '香味先到，炒蛋的固定搭档。', blurbRotten: '软成一撮青丝，香气先走了。' },
  { id: 'water_spinach', name: '空心菜', w: 1, h: 3, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x5A9A48, blurb: '空心管，灶上烫一下就软。', blurbRotten: '管子瘪了，只剩一缕湿绳。' },
  { id: 'rapeseed', name: '油菜', w: 2, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 5, fresh: 9, premium: 15 }, color: 0x6BA368, blurb: '油亮小棵，比白菜省位。', blurbRotten: '帮子发黏，油亮变成油腻。' },
  { id: 'celery', name: '芹菜', w: 1, h: 3, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x7BB05A, blurb: '叶子也能吃，别只留下秆。', blurbRotten: '秆还硬，叶子已经认输。' },
  { id: 'broccoli', name: '西兰花', w: 2, h: 2, zone: 'dry', vegetable: true, stalls: ['leaf'], prices: { common: 6, fresh: 11, premium: 18 }, color: 0x3F8A4A, blurb: '菜市场已经认它，不是西餐厅。', blurbRotten: '花球发黄，小粒开始散架。' },
  { id: 'pepper', name: '青椒', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x4CAF50, blurb: '灯笼一样挂着，配谁都像家常。', blurbRotten: '皮皱了，里面开始出水。' },
  { id: 'onion', name: '洋葱', w: 1, h: 1, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 3, fresh: 7, premium: 12 }, color: 0xC9A06A, blurb: '剥开会熏人，炒蛋很听话。', blurbRotten: '外皮发霉，里面还在装硬。' },
  { id: 'carrot', name: '胡萝卜', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 3, fresh: 7, premium: 12 }, color: 0xE07A3A, blurb: '橙得诚实，切片就进锅。', blurbRotten: '中间空了，敲一敲是失望。' },
  { id: 'pumpkin', name: '南瓜', w: 2, h: 2, zone: 'dry', vegetable: true, bulky: true, stalls: ['root'], prices: { common: 6, fresh: 11, premium: 17 }, color: 0xE0A100, blurb: '一块金疙瘩，比冬瓜乖。', blurbRotten: '皮还硬，瓤已经泄气。' },
  { id: 'greenbean', name: '豆角', w: 1, h: 3, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0x5C8A3A, blurb: '一把绿筷子，干煸最出声。', blurbRotten: '软得打卷，咬下去没有脆。' },
  { id: 'lotus', name: '莲藕', w: 2, h: 1, zone: 'dry', vegetable: true, stalls: ['root'], prices: { common: 6, fresh: 12, premium: 18 }, color: 0xE8D4C4, blurb: '带泥的孔，炒一炒还脆。', blurbRotten: '孔发黑，泥味先翻上来。' },
  { id: 'dried_tofu', name: '豆腐干', w: 1, h: 1, zone: 'dry', stalls: ['egg'], prices: { common: 4, fresh: 8, premium: 13 }, color: 0xC4A574, blurb: '比豆腐经造，不怕挤。', blurbRotten: '发黏发酸，边儿先黑。' },
  { id: 'sprout', name: '豆芽', w: 1, h: 2, zone: 'dry', vegetable: true, stalls: ['egg'], prices: { common: 3, fresh: 6, premium: 11 }, color: 0xF4EFE6, blurb: '一把白须，隔夜就蔫。', blurbRotten: '须子发褐，闻着像隔夜的水。' },
  { id: 'mushroom', name: '香菇', w: 1, h: 1, zone: 'dry', vegetable: true, stalls: ['egg'], prices: { common: 5, fresh: 10, premium: 16 }, color: 0x6B4A32, blurb: '干香菇泡发太麻烦，收摊只捡鲜的。', blurbRotten: '伞沿发黏，香气变成潮味。' },
  { id: 'kelp', name: '海带', w: 2, h: 1, zone: 'wet', stalls: ['fish'], prices: { common: 5, fresh: 10, premium: 16 }, color: 0x3A5A48, blurb: '湿咸一条，配冬瓜最稳。', blurbRotten: '滑得抓不住，咸味只剩腥。' },
  { id: 'crucian', name: '鲫鱼', w: 2, h: 2, zone: 'wet', stalls: ['fish'], prices: { common: 8, fresh: 16, premium: 26 }, color: 0x7A8A78, blurb: '土鲫，炖汤才认识它。', blurbRotten: '鳞先立起来，汤也救不了。' },
  { id: 'pork', name: '猪肉片', w: 2, h: 1, zone: 'dry', stalls: ['meat'], prices: { common: 8, fresh: 16, premium: 26 }, color: 0xE07A7A, blurb: '薄片，青椒一响就是晚饭。', blurbRotten: '边儿发绿，别再假装能炒。' },
  { id: 'pork_belly', name: '五花肉', w: 2, h: 1, zone: 'dry', stalls: ['meat'], prices: { common: 10, fresh: 20, premium: 32 }, color: 0xD45A5A, blurb: '一层肥一层瘦，白菜肯跟它过。', blurbRotten: '肥的先油败，瘦的跟着发黏。' },
  { id: 'chicken_leg', name: '鸡腿', w: 2, h: 2, zone: 'dry', stalls: ['meat'], prices: { common: 9, fresh: 18, premium: 28 }, color: 0xC4A06A, blurb: '带骨一只，土豆愿意陪着炖。', blurbRotten: '皮发黏，骨头还在硬撑。' },
  { id: 'ribs', name: '排骨', w: 2, h: 2, zone: 'dry', stalls: ['meat'], prices: { common: 11, fresh: 22, premium: 34 }, color: 0xA86A5A, blurb: '短肋几根，萝卜汤的骨头。', blurbRotten: '肉离了骨，味道先走。' },
];

export const GOD_PICK: ItemDef = {
  id: 'wild_yellowfish',
  name: '野生大黄鱼',
  w: 2,
  h: 3,
  zone: 'wet',
  stalls: ['fish'],
  prices: { common: 90, fresh: 90, premium: 90, god: 90 },
  color: 0xF4C430,
  blurb: '传说中的野生货，检视之前它只肯装成小鱼。',
  blurbRotten: '神捡也会过期，神话变成了鱼干。',
};

const BY_ID = new Map<string, ItemDef>([
  ...ITEMS.map((it) => [it.id, it] as const),
  [GOD_PICK.id, GOD_PICK],
]);

export function getItem(id: string): ItemDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`未知食材: ${id}`);
  return def;
}

export function itemsForStall(stall: StallId): ItemDef[] {
  return ITEMS.filter((it) => it.stalls.includes(stall));
}

const XIANGKO_IDS = new Set([
  'bokchoy', 'lettuce', 'cabbage', 'cilantro',
  'radish', 'potato', 'cucumber', 'eggplant', 'corn', 'melon',
  'tomato', 'garlic', 'ginger', 'egg', 'tofu',
  'smallfish', 'hairtail', 'shrimp', 'clam', 'crab', 'yellowfish',
]);

const HEYAN_EARLY: Record<StallId, string[]> = {
  leaf: ['bokchoy', 'lettuce', 'cabbage', 'cilantro', 'spinach', 'chive', 'rapeseed'],
  root: ['radish', 'potato', 'cucumber', 'eggplant', 'corn', 'melon', 'pepper', 'onion', 'carrot', 'greenbean'],
  egg: ['tomato', 'garlic', 'ginger', 'egg', 'tofu', 'dried_tofu', 'sprout'],
  fish: ['smallfish', 'clam', 'kelp'],
  meat: ['pork', 'chicken_leg'],
};

const HEYAN_DEEP: Record<StallId, string[]> = {
  leaf: ['water_spinach', 'celery', 'broccoli'],
  root: ['pumpkin', 'lotus'],
  egg: ['mushroom'],
  fish: [],
  meat: [],
};

const JIANGBIAN_BASE: Record<StallId, string[]> = {
  leaf: ['bokchoy', 'lettuce', 'cabbage', 'cilantro'],
  root: ['radish', 'potato', 'cucumber', 'eggplant', 'corn', 'melon'],
  egg: ['tomato', 'garlic', 'ginger', 'egg', 'tofu'],
  fish: ['smallfish', 'hairtail', 'shrimp', 'clam', 'crab', 'yellowfish', 'crucian', 'kelp'],
  meat: ['pork', 'chicken_leg'],
};

export function stallsForMarket(marketId: MarketId): StallId[] {
  return marketId === 'xiangko' ? ['leaf', 'root', 'egg', 'fish'] : ['leaf', 'root', 'egg', 'fish', 'meat'];
}

function defs(ids: string[]): ItemDef[] {
  return ids.map((id) => getItem(id));
}

/** 按菜场、厨艺往摊上抽一件。河沿水产收窄，深货厨艺 8 才进常规。 */
export function rollMarketItem(marketId: MarketId, stall: StallId, cookLevel: number, rng: Rng): ItemDef {
  if (marketId === 'xiangko') {
    const pool = itemsForStall(stall).filter((it) => XIANGKO_IDS.has(it.id));
    return rngPick(rng, pool.length ? pool : itemsForStall(stall));
  }

  if (marketId === 'heyan') {
    if (stall === 'fish') {
      if (rng() < 0.005) return getItem('crab');
      if (cookLevel >= 8 && rng() < 0.08) return getItem('crucian');
      return rngPick(rng, defs(HEYAN_EARLY.fish));
    }
    if (stall === 'meat') {
      if (cookLevel >= 8 && rng() < 0.18) return rngPick(rng, defs(['pork_belly', 'ribs']));
      return rngPick(rng, defs(HEYAN_EARLY.meat));
    }
    const ids = [...HEYAN_EARLY[stall]];
    if (cookLevel >= 8) ids.push(...HEYAN_DEEP[stall]);
    return rngPick(rng, defs(ids));
  }

  if (stall === 'leaf' && rng() < 0.15) return rngPick(rng, defs(['spinach', 'rapeseed']));
  if (stall === 'root' && rng() < 0.15) return rngPick(rng, defs(['pepper', 'onion']));
  if (stall === 'meat') {
    if (rng() < 0.18) return rngPick(rng, defs(['pork_belly', 'ribs']));
    return rngPick(rng, defs(JIANGBIAN_BASE.meat));
  }
  return rngPick(rng, defs(JIANGBIAN_BASE[stall]));
}

export function shapeLabel(defId: string, rot: 0 | 1 = 0): string {
  const def = getItem(defId);
  const w = rot === 1 ? def.h : def.w;
  const h = rot === 1 ? def.w : def.h;
  return `${w}×${h}`;
}

export function displayName(defId: string, inspected: boolean, quality: Quality): string {
  const def = getItem(defId);
  if (quality === 'rotten' && inspected) return `坏了·${def.name}`;
  if (defId === GOD_PICK.id && !inspected) return '小鱼';
  if (!inspected) return def.name;
  if (quality === 'god') return `神捡·${def.name}`;
  if (quality === 'premium') return `精品·${def.name}`;
  if (quality === 'fresh') return `新鲜·${def.name}`;
  return def.name;
}

/** 表里是设计原价；0.5 让卖生食/熟菜都慢一点攒钱。 */
export const SELL_PRICE_SCALE = 0.5;

export function sellPrice(defId: string, quality: Quality, inspected: boolean, freshness: number): number {
  if (quality === 'rotten') return 0;
  if (!inspected) quality = 'common';
  const def = getItem(defId);
  if (defId === GOD_PICK.id && inspected) {
    return Math.max(1, Math.round((def.prices.god ?? 90) * SELL_PRICE_SCALE));
  }
  const rank = Math.max(1, Math.min(3, freshness));
  const q = RANK_TO_QUALITY[rank] as Exclude<Quality, 'god'>;
  const used = QUALITY_RANK[quality] < rank ? quality : q;
  const key = used === 'god' ? 'premium' : used;
  const raw = def.prices[key] ?? def.prices.common;
  return Math.max(1, Math.round(raw * SELL_PRICE_SCALE));
}

export function initialFreshness(quality: Quality): number {
  return QUALITY_RANK[quality];
}

export const STALLS: Array<{ id: StallId; name: string; hint: string; count: [number, number] }> = [
  { id: 'leaf', name: '叶菜摊', hint: '注意低，适合开局', count: [5, 7] },
  { id: 'root', name: '根茎摊', hint: '冬瓜占格大', count: [5, 7] },
  { id: 'egg', name: '蛋豆摊', hint: '蛋易碎，豆腐怕挤', count: [4, 6] },
  { id: 'fish', name: '水产摊', hint: '好货显眼，注意涨得快', count: [4, 6] },
  { id: 'meat', name: '肉摊', hint: '河沿才开门', count: [3, 5] },
];
