import type { MarketId } from './destinations';
import type { Rarity } from './rarity';
import { rngPick, rngWeighted, type Rng } from './rng';

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
  /** 普通绿 / 高级蓝 / 稀有紫。它同时决定单价、掉率和格子边框。 */
  rarity: Rarity;
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

/**
 * 售价一律由这条式子推出来，表里不再手填散数：
 *   基准 = 每格单价 × 占格数 + 稀有度底价
 *   常价 = 基准 × 大件补贴 × 水产/肉系数
 * 「每格单价随稀有度涨」保证同样占格下稀有的更值钱；
 * 「大件补贴」保证一件 6 格的货不至于输给六件 1 格的货。
 */
const PER_CELL: Record<Rarity, number> = { common: 1.5, rare: 3, epic: 5 };
const RARITY_FLOOR: Record<Rarity, number> = { common: 0.5, rare: 3, epic: 5 };
const WET_MUL = 1.4;
const MEAT_MUL = 1.25;

function bulkBonus(area: number): number {
  if (area >= 6) return 1.3;
  if (area >= 4) return 1.15;
  return 1;
}

type ItemSpec = Omit<ItemDef, 'prices'> & { prices?: Partial<ItemDef['prices']> };

function priced(spec: ItemSpec): ItemDef {
  const area = spec.w * spec.h;
  const base = PER_CELL[spec.rarity] * area + RARITY_FLOOR[spec.rarity];
  const wet = spec.zone === 'wet' ? WET_MUL : 1;
  const meat = spec.stalls.includes('meat') ? MEAT_MUL : 1;
  const common = Math.max(2, Math.round(base * bulkBonus(area) * wet * meat));
  return {
    ...spec,
    prices: {
      common,
      fresh: Math.round(common * 2),
      premium: Math.round(common * 3.5),
      ...spec.prices,
    },
  };
}

const SPECS: ItemSpec[] = [
  // ── 叶菜摊 ──────────────────────────────────────────────
  { id: 'bokchoy', name: '小白菜', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x6BA368, blurb: '摊上最常见的绿叶子，帮你证明今晚真的开过火。', blurbRotten: '叶子摊成湿报纸，连虫都懒得来。' },
  { id: 'caitai', name: '菜苔', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x7CB342, blurb: '细秆顶着小黄花，一炒就是晚饭。别跟油菜整棵搞混。', blurbRotten: '花谢了，秆也软成了一撮绳。' },
  { id: 'cilantro', name: '香菜', w: 1, h: 1, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x3D7A3A, blurb: '有人闻见就逃，有人觉得没它不算一盘菜。', blurbRotten: '香气先走了，只剩一撮黑头发。' },
  { id: 'perilla', name: '紫苏', w: 1, h: 1, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['leaf'], color: 0x5A3A6A, blurb: '紫叶子带着清香，夜摊上才肯露脸。', blurbRotten: '紫褪成褐，香气也不肯留。' },
  { id: 'bird_chili', name: '朝天椒', w: 1, h: 1, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['leaf'], color: 0xC43A28, blurb: '朝天一簇小红椒，看着就知道嘴要遭殃。', blurbRotten: '蔫成一撮红线，辣也泄了。' },
  { id: 'scallion', name: '小葱', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x6FB04A, blurb: '一把细葱，切末往上一撒，整盘菜就像有人管。', blurbRotten: '葱白发滑，香味比谁都先走。' },
  { id: 'spinach', name: '菠菜', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x3D7A3A, blurb: '红根还在，才像刚从筐里拔的。', blurbRotten: '叶子黑了，红根也救不回来。' },
  { id: 'chive', name: '韭菜', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x4A8A3A, blurb: '香味先到，河虾最肯跟它见面。', blurbRotten: '软成一撮青丝，香气先走了。' },
  { id: 'celery', name: '芹菜', w: 1, h: 3, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x7BB05A, blurb: '叶子也能吃，别只留下秆。', blurbRotten: '秆还硬，叶子已经认输。' },
  { id: 'water_spinach', name: '空心菜', w: 1, h: 3, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x5A9A48, blurb: '空心管，灶上烫一下就软。', blurbRotten: '管子瘪了，只剩一缕湿绳。' },
  { id: 'lettuce', name: '生菜', w: 2, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x8FCB6B, blurb: '一整个脆生生的脑袋，凉拌比炒更懂它。', blurbRotten: '边儿发红了，像熬夜熬过头。' },
  { id: 'rapeseed', name: '油菜', w: 2, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['leaf'], color: 0x6BA368, blurb: '油亮小棵，比白菜省位。', blurbRotten: '帮子发黏，油亮变成油腻。' },
  { id: 'cabbage', name: '白菜', w: 2, h: 3, zone: 'dry', rarity: 'common', vegetable: true, bulky: true, stalls: ['leaf'], color: 0xC8E6A0, blurb: '层层叠叠能包一冬，也最擅长在菜篮里占座。', blurbRotten: '外帮黏了，里面还在装完好。' },
  { id: 'broccoli', name: '西兰花', w: 2, h: 2, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['leaf'], color: 0x3F8A4A, blurb: '菜市场已经认它，不是西餐厅。', blurbRotten: '花球发黄，小粒开始散架。' },

  // ── 根茎摊 ──────────────────────────────────────────────
  { id: 'potato', name: '土豆', w: 1, h: 1, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0xC4A574, blurb: '泥里翻出来的万能演员，炖炒炸都认它。', blurbRotten: '发芽了还想上班，建议它休息。' },
  { id: 'onion', name: '洋葱', w: 1, h: 1, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0xC9A06A, blurb: '剥开会熏人，炒蛋很听话。', blurbRotten: '外皮发霉，里面还在装硬。' },
  { id: 'carrot', name: '胡萝卜', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0xE07A3A, blurb: '橙得诚实，切片就进锅。', blurbRotten: '中间空了，敲一敲是失望。' },
  { id: 'eggplant', name: '茄子', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0x6A3D8A, blurb: '紫得发亮的整根货，别问切面，它还没准备好。', blurbRotten: '褐斑爬上来了，光泽先辞职。' },
  { id: 'pepper', name: '青椒', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0x4CAF50, blurb: '灯笼一样挂着，配谁都像家常。', blurbRotten: '皮皱了，里面开始出水。' },
  { id: 'corn', name: '玉米', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, hard: true, stalls: ['root'], color: 0xE8C547, blurb: '一捧金钉子，烤一烤连芯都能聊两句。', blurbRotten: '粒儿瘪了，只剩一根失望的棒子。' },
  { id: 'radish', name: '萝卜', w: 1, h: 3, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0xF2E6D8, blurb: '皮白心脆，生啃也行，是北方冬天的良心。', blurbRotten: '空心了，敲一敲全是失望。' },
  { id: 'cucumber', name: '黄瓜', w: 1, h: 3, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0x4CAF50, blurb: '顶花带刺才算新鲜，咬一口能听到水声。', blurbRotten: '软得像一条后悔的丝瓜。' },
  { id: 'greenbean', name: '豆角', w: 1, h: 3, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['root'], color: 0x5C8A3A, blurb: '一把绿筷子，干煸最出声。', blurbRotten: '软得打卷，咬下去没有脆。' },
  { id: 'pumpkin', name: '南瓜', w: 2, h: 2, zone: 'dry', rarity: 'common', vegetable: true, bulky: true, stalls: ['root'], color: 0xE0A100, blurb: '一块金疙瘩，比冬瓜乖。', blurbRotten: '皮还硬，瓤已经泄气。' },
  { id: 'melon', name: '冬瓜', w: 3, h: 2, zone: 'dry', rarity: 'common', vegetable: true, bulky: true, stalls: ['root'], color: 0x9BBB7A, blurb: '菜市场的沙发垫，又白又沉，下汤化成温柔。', blurbRotten: '霜打过了，抱起来像一袋叹气。' },
  { id: 'lotus', name: '莲藕', w: 2, h: 1, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['root'], color: 0xE8D4C4, blurb: '带泥的孔，炒一炒还脆。', blurbRotten: '孔发黑，泥味先翻上来。' },
  { id: 'bamboo_shoot', name: '春笋', w: 1, h: 3, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['root'], color: 0xE8DCC0, blurb: '带壳一支，剥到最后只剩一小截，脆得值这个价。', blurbRotten: '根部发苦，剥开全是老丝。' },
  { id: 'yam', name: '山药', w: 1, h: 3, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['root'], color: 0xE4D8C4, blurb: '削皮时手会痒，炖到粉糯你就原谅它了。', blurbRotten: '断面发褐，黏液变成了浆。' },
  { id: 'chestnut', name: '板栗', w: 1, h: 1, zone: 'dry', rarity: 'rare', hard: true, stalls: ['root'], color: 0x8B5A2B, blurb: '带壳的小硬球，炖肉时它最肯出甜。', blurbRotten: '壳里长毛了，仁也蔫成一团。' },
  { id: 'taro', name: '芋头', w: 2, h: 2, zone: 'dry', rarity: 'rare', vegetable: true, bulky: true, stalls: ['root'], color: 0xC4B090, blurb: '泥衣还在的紫褐疙瘩，拔丝之前得先认它。', blurbRotten: '切开发红，粉变成了浆。' },
  { id: 'lily', name: '百合', w: 1, h: 2, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['root'], color: 0xF4EFE6, blurb: '一层一层的白瓣，看起来像还没开的灯。', blurbRotten: '瓣边发褐，甜味先走了。' },

  // ── 蛋豆摊 ──────────────────────────────────────────────
  { id: 'tomato', name: '番茄', w: 1, h: 1, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['egg'], color: 0xD64545, blurb: '红得心虚，一切就流汁，天生来配鸡蛋。', blurbRotten: '皮皱成老太太，汁还在装年轻。' },
  { id: 'garlic', name: '大蒜', w: 1, h: 1, zone: 'dry', rarity: 'common', stalls: ['egg'], color: 0xEDE6D9, blurb: '一小头脾气很大，灶台没它就像没开门。', blurbRotten: '干瘪发芽，气味还在坚持上班。' },
  { id: 'ginger', name: '生姜', w: 1, h: 1, zone: 'dry', rarity: 'common', stalls: ['egg'], color: 0xD4A574, blurb: '长得像迷路的手指，去腥暖胃全靠它吼一嗓。', blurbRotten: '皱得像晒干的秘密，辣味所剩无几。' },
  { id: 'egg', name: '鸡蛋', w: 1, h: 1, zone: 'dry', rarity: 'common', fragile: true, stalls: ['egg'], color: 0xF4D58D, blurb: '圆得过分老实，一磕就决定今晚炒还是煮。', blurbRotten: '摇一摇有声，说明它已经有了自己的想法。' },
  { id: 'dried_tofu', name: '豆腐干', w: 1, h: 1, zone: 'dry', rarity: 'common', stalls: ['egg'], color: 0xC4A574, blurb: '比豆腐经造，不怕挤。', blurbRotten: '发黏发酸，边儿先黑。' },
  { id: 'sprout', name: '豆芽', w: 1, h: 2, zone: 'dry', rarity: 'common', vegetable: true, stalls: ['egg'], color: 0xF4EFE6, blurb: '一把白须，隔夜就蔫。', blurbRotten: '须子发褐，闻着像隔夜的水。' },
  { id: 'tofu', name: '豆腐', w: 2, h: 1, zone: 'dry', rarity: 'common', squeezable: true, stalls: ['egg'], color: 0xF7F2E4, blurb: '嫩得像刚睡醒，旁边千万别放活物。', blurbRotten: '发酸了，谁碰谁后悔。' },
  { id: 'mushroom', name: '香菇', w: 1, h: 1, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['egg'], color: 0x6B4A32, blurb: '干香菇泡发太麻烦，收摊只捡鲜的。', blurbRotten: '伞沿发黏，香气变成潮味。' },
  { id: 'wood_ear', name: '木耳', w: 1, h: 1, zone: 'dry', rarity: 'rare', vegetable: true, stalls: ['egg'], color: 0x3A2A22, blurb: '泡开才见分量，一小撮能撑起一整盘。', blurbRotten: '泡过头了，软塌塌的没有脆。' },
  { id: 'matsutake', name: '松茸', w: 1, h: 2, zone: 'dry', rarity: 'epic', vegetable: true, stalls: ['egg'], color: 0xC4A882, blurb: '山坞一年只出这几天，香气隔着筐往外跑。', blurbRotten: '香气散尽，只剩一段木头味。' },
  { id: 'vermicelli', name: '粉丝', w: 1, h: 2, zone: 'dry', rarity: 'common', stalls: ['egg'], color: 0xE8E0D0, blurb: '一把干白线，泡开才肯软，专给肉末当梯子。', blurbRotten: '受潮结块，掰开全是灰。' },
  { id: 'lotus_seed', name: '莲子', w: 1, h: 1, zone: 'dry', rarity: 'rare', hard: true, stalls: ['egg'], color: 0xE8D8B0, blurb: '一捧浅褐小仁，芯还在，熬汤才肯甜。', blurbRotten: '生虫了，仁里先空。' },
  { id: 'tremella', name: '银耳', w: 1, h: 1, zone: 'dry', rarity: 'rare', stalls: ['egg'], color: 0xF2E6D0, blurb: '干花一样的白耳朵，泡一夜才肯张开。', blurbRotten: '发黄发酸，泡开也救不了。' },
  { id: 'goji', name: '枸杞', w: 1, h: 1, zone: 'dry', rarity: 'common', stalls: ['egg'], color: 0xC45A3A, blurb: '一把红点子，丢进汤里就像有人懂养生。', blurbRotten: '干瘪发黑，甜味变成潮味。' },
  { id: 'peppercorn', name: '花椒', w: 1, h: 1, zone: 'dry', rarity: 'rare', stalls: ['egg'], color: 0x8A4A28, blurb: '一把麻点子，夜摊揭开才肯给你。', blurbRotten: '油败发黑，麻味先走了。' },
  { id: 'star_anise', name: '八角', w: 1, h: 1, zone: 'dry', rarity: 'rare', hard: true, stalls: ['egg'], color: 0x6A3A18, blurb: '一颗星，红烧锅里最肯出味道。', blurbRotten: '边儿发霉，香气变成潮木头。' },
  { id: 'dried_chili', name: '干辣椒', w: 1, h: 1, zone: 'dry', rarity: 'rare', hard: true, stalls: ['egg'], color: 0xA33A28, blurb: '一撮皱红皮，比鲜椒更会在锅里说话。', blurbRotten: '潮了发黑，辣也泄成灰。' },

  // ── 水产摊 ──────────────────────────────────────────────
  { id: 'smallfish', name: '小鱼', w: 1, h: 2, zone: 'wet', rarity: 'common', stalls: ['fish'], color: 0x6B8E9F, blurb: '银闪闪一小条，可能是漏网之鱼，也可能是漏网之神。', blurbRotten: '眼睛先翻白，味道随后赶到。' },
  { id: 'kelp', name: '海带', w: 2, h: 1, zone: 'wet', rarity: 'common', stalls: ['fish'], color: 0x3A5A48, blurb: '湿咸一条，配冬瓜最稳。', blurbRotten: '滑得抓不住，咸味只剩腥。' },
  { id: 'clam', name: '花蛤', w: 1, h: 1, zone: 'wet', rarity: 'rare', stalls: ['fish'], color: 0xB8A38A, blurb: '闭嘴的小房子，吐沙之后才肯跟你做汤。', blurbRotten: '张嘴不闭，里面已经没人在家。' },
  { id: 'crucian', name: '鲫鱼', w: 2, h: 2, zone: 'wet', rarity: 'rare', stalls: ['fish'], color: 0x7A8A78, blurb: '土鲫，炖汤才认识它。', blurbRotten: '鳞先立起来，汤也救不了。' },
  { id: 'hairtail', name: '带鱼', w: 1, h: 4, zone: 'wet', rarity: 'rare', stalls: ['fish'], color: 0x8FA8B5, blurb: '细长一条像银腰带，占格吓人，下锅却很识相。', blurbRotten: '银光褪尽，只剩一条咸湿的悔恨。' },
  { id: 'shrimp', name: '虾', w: 1, h: 1, zone: 'wet', rarity: 'epic', stalls: ['fish'], color: 0xE07A5F, blurb: '弯着腰的红家伙，一格的地方，一格的傲气。', blurbRotten: '头先黑，说明它已经写完遗书。' },
  { id: 'yellowfish', name: '黄鱼', w: 2, h: 1, zone: 'wet', rarity: 'epic', stalls: ['fish'], color: 0xE0A100, blurb: '金灿灿一条，黄鱼摊上的面子工程。', blurbRotten: '金色褪成旧窗帘，刺还在坚持存在。' },
  { id: 'crab', name: '螃蟹', w: 2, h: 2, zone: 'wet', rarity: 'epic', live: true, stalls: ['fish'], color: 0xC0392B, blurb: '还在挥钳子，活的才算数，别让它在篮里散步。', blurbRotten: '钳子掉了，脾气也没了。' },
  { id: 'river_eel', name: '河鳗', w: 1, h: 4, zone: 'wet', rarity: 'epic', stalls: ['fish'], color: 0x4A5A50, blurb: '滑得抓不住，肉厚，江边人一般自己留着吃。', blurbRotten: '身上黏液发白，腥气顶人。' },
  { id: 'river_shrimp', name: '河虾', w: 1, h: 2, zone: 'wet', rarity: 'rare', stalls: ['fish'], color: 0xD4785A, blurb: '青灰色一小把，比海虾老实，韭菜一响就熟。', blurbRotten: '头先黑，须子先断。' },
  { id: 'oyster', name: '生蚝', w: 2, h: 1, zone: 'wet', rarity: 'epic', live: true, stalls: ['fish'], color: 0x8A9A8A, blurb: '石头一样的壳，撬开才见人。活的才配下蛋。', blurbRotten: '壳还闭着，里面已经没人在家。' },

  // ── 肉摊 ────────────────────────────────────────────────
  { id: 'pork', name: '猪肉片', w: 2, h: 1, zone: 'dry', rarity: 'rare', stalls: ['meat'], color: 0xE07A7A, blurb: '薄片，青椒一响就是晚饭。', blurbRotten: '边儿发绿，别再假装能炒。' },
  { id: 'chicken_leg', name: '鸡腿', w: 2, h: 2, zone: 'dry', rarity: 'rare', stalls: ['meat'], color: 0xC4A06A, blurb: '带骨一只，土豆愿意陪着炖。', blurbRotten: '皮发黏，骨头还在硬撑。' },
  { id: 'duck_leg', name: '鸭腿', w: 2, h: 2, zone: 'dry', rarity: 'rare', stalls: ['meat'], color: 0xB08050, blurb: '带皮一只，下锅之前先把油煸出来。', blurbRotten: '皮色发暗，油味比肉先坏。' },
  { id: 'pork_belly', name: '五花肉', w: 2, h: 1, zone: 'dry', rarity: 'epic', stalls: ['meat'], color: 0xD45A5A, blurb: '一层肥一层瘦，白菜肯跟它过。', blurbRotten: '肥的先油败，瘦的跟着发黏。' },
  { id: 'ribs', name: '排骨', w: 2, h: 2, zone: 'dry', rarity: 'epic', stalls: ['meat'], color: 0xA86A5A, blurb: '短肋几根，萝卜汤的骨头。', blurbRotten: '肉离了骨，味道先走。' },
  { id: 'ham', name: '火腿', w: 2, h: 1, zone: 'dry', rarity: 'epic', stalls: ['meat'], color: 0xB5504A, blurb: '梁上挂了一年的咸货，切一片就能吊一锅汤。', blurbRotten: '油边发哈，咸味也压不住了。' },
  { id: 'beef_brisket', name: '牛腩', w: 2, h: 2, zone: 'dry', rarity: 'epic', stalls: ['meat'], color: 0x9A4A3A, blurb: '带筋一块，得炖足两个钟头才肯松口。', blurbRotten: '筋发黏，红色褪成了灰。' },
  { id: 'pork_liver', name: '猪肝', w: 2, h: 1, zone: 'dry', rarity: 'rare', stalls: ['meat'], color: 0x8A3030, blurb: '一整叶深褐的肝，火要大，锅要快。', blurbRotten: '表面发绿，腥得先翻脸。' },
  { id: 'duck_blood', name: '鸭血', w: 1, h: 1, zone: 'dry', rarity: 'epic', stalls: ['meat'], color: 0x6A2028, blurb: '一方深褐的嫩块，毛血旺没有它就不肯开场。', blurbRotten: '边儿发灰，嫩变成了散。' },
];

export const ITEMS: ItemDef[] = SPECS.map(priced);

export const GOD_PICK: ItemDef = priced({
  id: 'wild_yellowfish',
  name: '野生大黄鱼',
  w: 2,
  h: 3,
  zone: 'wet',
  rarity: 'epic',
  stalls: ['fish'],
  prices: { god: 120 },
  color: 0xF4C430,
  blurb: '传说中的野生货，检视之前它只肯装成小鱼。',
  blurbRotten: '神捡也会过期，神话变成了鱼干。',
});

const BY_ID = new Map<string, ItemDef>([
  ...ITEMS.map((it) => [it.id, it] as const),
  [GOD_PICK.id, GOD_PICK],
]);

export function getItem(id: string): ItemDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`未知食材: ${id}`);
  return def;
}

export function itemRarity(id: string): Rarity {
  return getItem(id).rarity;
}

export function itemsForStall(stall: StallId): ItemDef[] {
  return ITEMS.filter((it) => it.stalls.includes(stall));
}

export function itemArea(id: string): number {
  const def = getItem(id);
  return def.w * def.h;
}

interface StallPool {
  common: string[];
  rare: string[];
  epic: string[];
}

function pool(common: string[], rare: string[] = [], epic: string[] = []): StallPool {
  return { common, rare, epic };
}

/**
 * 每个菜场只开一小撮品类，往后一场比一场宽。摊型的键序就是路线里的摊位轮转序，
 * 别随手调换。同一 id 可以在多个场里出现，但稀有档必须和 ItemDef.rarity 一致。
 */
const MARKET_POOLS: Record<MarketId, Partial<Record<StallId, StallPool>>> = {
  xiangko: {
    leaf: pool(['bokchoy', 'caitai', 'cilantro', 'scallion']),
    root: pool(['potato', 'cucumber', 'eggplant']),
    egg: pool(['tomato', 'garlic', 'ginger', 'egg', 'tofu'], ['mushroom']),
    fish: pool(['smallfish']),
  },
  heyan: {
    leaf: pool(
      ['bokchoy', 'caitai', 'cilantro', 'scallion', 'spinach', 'chive', 'cabbage', 'lettuce', 'celery'],
      ['broccoli'],
    ),
    root: pool(
      ['potato', 'radish', 'cucumber', 'eggplant', 'pepper', 'onion', 'carrot', 'corn', 'greenbean'],
      ['lotus'],
    ),
    egg: pool(['tomato', 'garlic', 'ginger', 'egg', 'tofu', 'dried_tofu', 'sprout', 'vermicelli'], ['mushroom']),
    fish: pool(['smallfish', 'kelp'], ['clam', 'crucian', 'river_shrimp'], ['shrimp']),
    meat: pool([], ['pork', 'chicken_leg', 'pork_liver'], ['pork_belly']),
  },
  shanwu: {
    leaf: pool(
      ['bokchoy', 'caitai', 'cilantro', 'scallion', 'chive', 'celery', 'water_spinach', 'rapeseed'],
      ['broccoli'],
    ),
    root: pool(
      ['potato', 'radish', 'carrot', 'corn', 'greenbean', 'pumpkin'],
      ['bamboo_shoot', 'yam', 'chestnut', 'lotus', 'taro', 'lily'],
    ),
    egg: pool(['egg', 'tofu', 'dried_tofu', 'garlic', 'ginger', 'sprout', 'vermicelli'], ['mushroom', 'wood_ear'], ['matsutake']),
    meat: pool([], ['chicken_leg', 'duck_leg', 'pork', 'pork_liver'], ['ribs']),
  },
  jiangbian: {
    leaf: pool(['bokchoy', 'caitai', 'cilantro', 'scallion', 'cabbage']),
    root: pool(['radish', 'potato', 'onion', 'melon']),
    egg: pool(['tomato', 'garlic', 'ginger', 'egg', 'tofu', 'vermicelli'], ['mushroom']),
    fish: pool(
      ['smallfish', 'kelp'],
      ['clam', 'crucian', 'hairtail', 'river_shrimp'],
      ['shrimp', 'crab', 'yellowfish', 'river_eel', 'oyster'],
    ),
    meat: pool([], ['pork', 'chicken_leg', 'pork_liver'], ['pork_belly', 'ribs']),
  },
  laocheng: {
    leaf: pool(['cabbage', 'scallion', 'cilantro', 'lettuce', 'rapeseed'], ['broccoli']),
    root: pool(['radish', 'potato', 'melon', 'pumpkin'], ['lotus', 'bamboo_shoot', 'yam', 'chestnut', 'taro', 'lily']),
    egg: pool(['egg', 'tofu', 'garlic', 'ginger', 'dried_tofu', 'vermicelli', 'goji'], ['mushroom', 'wood_ear', 'lotus_seed', 'tremella'], ['matsutake']),
    fish: pool(['kelp'], ['clam', 'crucian', 'hairtail', 'river_shrimp'], ['shrimp', 'crab', 'yellowfish', 'river_eel', 'oyster']),
    meat: pool([], ['pork', 'chicken_leg', 'duck_leg', 'pork_liver'], ['pork_belly', 'ribs', 'beef_brisket', 'ham', 'duck_blood']),
  },
};

/** 一次抽货里蓝货/紫货的基础概率。厨艺每升一级再各加一点点。 */
const RARE_CHANCE: Record<MarketId, number> = {
  xiangko: 0.02,
  heyan: 0.13,
  shanwu: 0.22,
  jiangbian: 0.24,
  laocheng: 0.34,
};

const EPIC_CHANCE: Record<MarketId, number> = {
  xiangko: 0,
  heyan: 0.012,
  shanwu: 0.03,
  jiangbian: 0.05,
  laocheng: 0.09,
};

const RARE_PER_LEVEL = 0.004;
const EPIC_PER_LEVEL = 0.0015;

export function stallsForMarket(marketId: MarketId): StallId[] {
  return Object.keys(MARKET_POOLS[marketId]) as StallId[];
}

/** 手里已解锁的菜谱要用到的食材，在摊上加权。 */
function pickBiased(rng: Rng, ids: string[], wanted?: ReadonlySet<string>): string {
  if (!wanted || ids.length < 2) return rngPick(rng, ids);
  return rngWeighted(rng, ids.map((id) => [id, wanted.has(id) ? 3 : 1] as const));
}

/**
 * 摊上抽一件。先掷稀有度，再在该档里按「菜谱要不要」加权挑一件——
 * 这样摊上的货跟得上手里的菜谱，同时始终留着一条撞见紫货的窄缝。
 */
export function rollMarketItem(
  marketId: MarketId,
  stall: StallId,
  cookLevel: number,
  rng: Rng,
  wanted?: ReadonlySet<string>,
): ItemDef {
  const p = MARKET_POOLS[marketId][stall];
  if (!p) return rngPick(rng, itemsForStall(stall));

  const lv = Math.max(0, cookLevel - 1);
  const epic = EPIC_CHANCE[marketId] + lv * EPIC_PER_LEVEL;
  const rare = RARE_CHANCE[marketId] + lv * RARE_PER_LEVEL;
  const roll = rng();

  let ids: string[] = p.common;
  if (p.epic.length && roll < epic) ids = p.epic;
  else if (p.rare.length && roll < epic + rare) ids = p.rare;
  // 肉摊这种没有绿货的摊，往上一档兜底
  if (!ids.length) ids = p.rare.length ? p.rare : p.epic;
  if (!ids.length) return rngPick(rng, itemsForStall(stall));

  return getItem(pickBiased(rng, ids, wanted));
}

export function shapeLabel(defId: string, rot: 0 | 1 = 0): string {
  const def = getItem(defId);
  const w = rot === 1 ? def.h : def.w;
  const h = rot === 1 ? def.w : def.h;
  return `${w}×${h}`;
}

export function displayName(defId: string, inspected: boolean, quality: Quality): string {
  const def = getItem(defId);
  if (quality === 'rotten') return `坏了·${def.name}`;
  if (defId === GOD_PICK.id && !inspected) return '小鱼';
  if (defId === GOD_PICK.id) return `神捡·${def.name}`;
  return def.name;
}

/** 好货一个价。坏的卖不掉。神捡验出来才按神价。freshness 只留给旧存档。 */
export function sellPrice(defId: string, quality: Quality, inspected = true, _freshness = 1): number {
  if (quality === 'rotten') return 0;
  const def = getItem(defId);
  if (defId === GOD_PICK.id && inspected) return def.prices.god ?? def.prices.common;
  return Math.max(1, def.prices.common);
}

export function initialFreshness(quality: Quality): number {
  return QUALITY_RANK[quality];
}

export const STALLS: Array<{ id: StallId; name: string; hint: string; count: [number, number] }> = [
  { id: 'leaf', name: '叶菜摊', hint: '注意低，适合开局', count: [5, 7] },
  { id: 'root', name: '根茎摊', hint: '冬瓜占格大', count: [5, 7] },
  { id: 'egg', name: '蛋豆摊', hint: '蛋易碎，豆腐怕挤', count: [4, 6] },
  { id: 'fish', name: '水产摊', hint: '好货显眼，湿货占格', count: [4, 6] },
  { id: 'meat', name: '肉摊', hint: '整摊都是蓝紫货', count: [3, 5] },
];
