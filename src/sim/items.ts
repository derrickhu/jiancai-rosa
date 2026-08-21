export type Zone = 'dry' | 'wet';
export type Quality = 'rotten' | 'common' | 'fresh' | 'premium' | 'god';
export type StallId = 'leaf' | 'root' | 'egg' | 'fish';

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

export function sellPrice(defId: string, quality: Quality, inspected: boolean, freshness: number): number {
  if (quality === 'rotten') return 0;
  if (!inspected) quality = 'common';
  const def = getItem(defId);
  if (defId === GOD_PICK.id && inspected) return def.prices.god ?? 90;
  const rank = Math.max(1, Math.min(3, freshness));
  const q = RANK_TO_QUALITY[rank] as Exclude<Quality, 'god'>;
  const used = QUALITY_RANK[quality] < rank ? quality : q;
  const key = used === 'god' ? 'premium' : used;
  return def.prices[key] ?? def.prices.common;
}

export function initialFreshness(quality: Quality): number {
  return QUALITY_RANK[quality];
}

export const STALLS: Array<{ id: StallId; name: string; hint: string; count: [number, number] }> = [
  { id: 'leaf', name: '叶菜摊', hint: '注意低，适合开局', count: [5, 7] },
  { id: 'root', name: '根茎摊', hint: '冬瓜占格大', count: [5, 7] },
  { id: 'egg', name: '蛋豆摊', hint: '蛋易碎，豆腐怕挤', count: [4, 6] },
  { id: 'fish', name: '水产摊', hint: '好货显眼，注意涨得快', count: [4, 6] },
];
