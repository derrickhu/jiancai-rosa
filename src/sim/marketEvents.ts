import type { MarketId } from './destinations';
import { STALLS, type StallId } from './items';

export type CardKind =
  | 'stall' | 'paystall' | 'freebie' | 'fork' | 'deadend' | 'empty' | 'favor' | 'deep' | 'recipe'
  | 'talk' | 'gather' | 'branch' | 'gate';

export interface MarketPlan {
  /** 天色：一局能付出的步数。走完天黑收摊。 */
  steps: number;
  /** 保底摊位层数。这些层整层都是摊，怎么走都撞得到。 */
  stallLayers: number;
  /** 每层卡数范围 */
  width: [number, number];
  maxDeadend: number;
  /** 第二段地图，一期不开 */
  allowDeep: boolean;
}

/** 层数比步数多，天色才是真的紧。走哪边由车道连通决定，不再发「岔路」卡。 */
export const EXTRA_LAYERS = 3;

export const MARKET_PLAN: Record<MarketId, MarketPlan> = {
  xiangko: { steps: 10, stallLayers: 3, width: [2, 3], maxDeadend: 2, allowDeep: false },
  heyan: { steps: 12, stallLayers: 4, width: [2, 3], maxDeadend: 2, allowDeep: false },
  qiaotou: { steps: 12, stallLayers: 4, width: [2, 3], maxDeadend: 2, allowDeep: false },
  shanwu: { steps: 12, stallLayers: 4, width: [2, 3], maxDeadend: 3, allowDeep: false },
  jiangbian: { steps: 14, stallLayers: 4, width: [3, 3], maxDeadend: 2, allowDeep: false },
  nanshi: { steps: 12, stallLayers: 4, width: [2, 3], maxDeadend: 3, allowDeep: false },
  laocheng: { steps: 15, stallLayers: 5, width: [3, 3], maxDeadend: 3, allowDeep: false },
  dukou: { steps: 14, stallLayers: 4, width: [3, 3], maxDeadend: 2, allowDeep: false },
  shanzhen: { steps: 12, stallLayers: 3, width: [2, 3], maxDeadend: 2, allowDeep: false },
};

/**
 * 油纸不进公共权重。每局先掷这一下，中了才放一张。
 * 巷口更松：这是第一次见油纸的地方。从没在本场捡过的，那局保底放一张。
 */
export const RECIPE_VISIT_CHANCE: Record<MarketId, number> = {
  xiangko: 0.7,
  heyan: 0.5,
  qiaotou: 0.46,
  shanwu: 0.42,
  jiangbian: 0.4,
  nanshi: 0.4,
  laocheng: 0.38,
  dukou: 0.36,
  shanzhen: 0.42,
};

/** 填非保底层用。公共权重池；每场独特内容靠脚本节拍另挂，不靠这张表。 */
export const CARD_WEIGHTS: Record<MarketId, Array<[CardKind, number]>> = {
  xiangko: [
    ['stall', 40],
    ['freebie', 16],
    ['empty', 12],
    ['favor', 10],
    ['deadend', 9],
    ['paystall', 7],
  ],
  heyan: [
    ['stall', 40],
    ['freebie', 13],
    ['empty', 11],
    ['favor', 9],
    ['deadend', 10],
    ['paystall', 11],
  ],
  qiaotou: [
    ['stall', 40],
    ['freebie', 13],
    ['empty', 11],
    ['favor', 9],
    ['deadend', 10],
    ['paystall', 11],
  ],
  shanwu: [
    ['stall', 38],
    ['freebie', 12],
    ['empty', 12],
    ['favor', 9],
    ['deadend', 11],
    ['paystall', 12],
  ],
  jiangbian: [
    ['stall', 38],
    ['freebie', 11],
    ['empty', 11],
    ['favor', 8],
    ['deadend', 11],
    ['paystall', 15],
  ],
  laocheng: [
    ['stall', 36],
    ['freebie', 9],
    ['empty', 11],
    ['favor', 8],
    ['deadend', 12],
    ['paystall', 18],
  ],
  nanshi: [
    ['stall', 38],
    ['freebie', 12],
    ['empty', 12],
    ['favor', 9],
    ['deadend', 12],
    ['paystall', 12],
  ],
  dukou: [
    ['stall', 38],
    ['freebie', 11],
    ['empty', 11],
    ['favor', 8],
    ['deadend', 11],
    ['paystall', 15],
  ],
  shanzhen: [
    ['stall', 34],
    ['freebie', 8],
    ['empty', 12],
    ['favor', 8],
    ['deadend', 12],
    ['paystall', 20],
  ],
};

/** 哪类摊多。河沿肉摊、江边水产主场都走这张表，别为菜场另写卡型。 */
export const STALL_WEIGHTS: Record<MarketId, Array<[StallId, number]>> = {
  xiangko: [['leaf', 38], ['root', 34], ['egg', 28]],
  heyan: [['leaf', 28], ['root', 26], ['egg', 22], ['fish', 24]],
  qiaotou: [['leaf', 26], ['root', 22], ['egg', 16], ['fish', 20], ['meat', 16]],
  shanwu: [['leaf', 28], ['root', 40], ['egg', 32]],
  jiangbian: [['leaf', 10], ['egg', 16], ['fish', 64], ['meat', 10]],
  nanshi: [['leaf', 18], ['egg', 42], ['meat', 40]],
  laocheng: [['leaf', 22], ['root', 28], ['egg', 16], ['meat', 34]],
  dukou: [['egg', 32], ['fish', 68]],
  shanzhen: [['leaf', 8], ['root', 16], ['egg', 28], ['fish', 24], ['meat', 24]],
};

/**
 * 巷口少铺；河沿只比巷口多 1 件上限。没写的场走 STALLS 默认件数。
 * 收费摊再另加 paystallPileBonus。
 */
const MARKET_STALL_COUNT: Partial<Record<MarketId, Partial<Record<StallId, [number, number]>>>> = {
  xiangko: {
    leaf: [3, 4],
    root: [3, 4],
    egg: [3, 4],
    fish: [2, 3],
  },
  heyan: {
    leaf: [3, 5],
    root: [3, 5],
    egg: [3, 5],
    fish: [2, 4],
    meat: [3, 4],
  },
  qiaotou: {
    leaf: [3, 5],
    root: [3, 5],
    egg: [3, 4],
    fish: [2, 4],
    meat: [3, 4],
  },
};

export function stallPileRange(marketId: MarketId, stall: StallId): [number, number] {
  return MARKET_STALL_COUNT[marketId]?.[stall] ?? STALLS.find((s) => s.id === stall)?.count ?? [3, 5];
}

/** 收费摊比普通摊多留一点，巷口只多 1 件，免得一摊就塞满塑料袋。 */
export function paystallPileBonus(marketId: MarketId): number {
  return marketId === 'xiangko' || marketId === 'heyan' || marketId === 'qiaotou' ? 1 : 2;
}

/**
 * 普通摊底价。巷口一律 1 金，后场才按货量和出好货概率加价。
 * 第一摊仍免费，见 run.nodeFee。
 */
const MARKET_ENTRY: Record<MarketId, number> = {
  xiangko: 1,
  heyan: 2,
  qiaotou: 2,
  shanwu: 3,
  jiangbian: 3,
  nanshi: 3,
  laocheng: 4,
  dukou: 4,
  shanzhen: 5,
};

/** 鱼摊/肉摊货贵、蓝紫多，普通摊之上再加。巷口不加，避免开局鱼摊也劝退。 */
const STALL_ENTRY_EXTRA: Record<StallId, number> = {
  leaf: 0,
  root: 0,
  egg: 0,
  fish: 2,
  meat: 3,
};

const SPECIALTY_ENTRY_EXTRA: Record<string, number> = {
  fungus: 2,
  lotus: 2,
  nightcatch: 4,
  cured: 4,
  treasure: 5,
};

export function stallEntryFee(marketId: MarketId, stall: StallId = 'egg'): number {
  if (marketId === 'xiangko') return 1;
  return MARKET_ENTRY[marketId] + (STALL_ENTRY_EXTRA[stall] ?? 0);
}

/** 收费摊货更多、坏货更少。巷口只贵到 3，后场再叠摊型。 */
export function paystallFee(marketId: MarketId, stall: StallId): number {
  if (marketId === 'xiangko') return 3;
  return stallEntryFee(marketId, stall) + 3 + (STALL_ENTRY_EXTRA[stall] ?? 0);
}

/** 菌摊 / 藕摊 / 夜鲜 / 咸货：件数多、好货概率高。 */
export function specialtyFee(marketId: MarketId, specialty: string): number {
  return MARKET_ENTRY[marketId] + (SPECIALTY_ENTRY_EXTRA[specialty] ?? 2);
}

export function rummageEntryFee(
  marketId: MarketId,
  opts: { kind: CardKind; stall?: StallId; specialty?: string },
): number {
  if (opts.kind === 'paystall') return paystallFee(marketId, opts.stall ?? 'egg');
  if (opts.specialty) return specialtyFee(marketId, opts.specialty);
  return stallEntryFee(marketId, opts.stall ?? 'egg');
}

/** 白捡只出这几摊的货，地上不会躺着活蟹。 */
export const FREEBIE_STALLS: StallId[] = ['leaf', 'root', 'egg'];

/** 街坊人情：下一摊免费。 */
export const FAVOR_PACK_RATE = 0.7;

/** 每个菜场自己的路线底图和卡面图集，别三个场共用巷口那一套。 */
export const MARKET_ART: Record<MarketId, { routeBg: string; cardAtlas: string; meatCard?: string }> = {
  xiangko: {
    routeBg: 'subpkg_images/market_route_1.jpg',
    cardAtlas: 'subpkg_images/market_cards.jpg',
  },
  heyan: {
    routeBg: 'subpkg_images/market_route_heyan.jpg',
    cardAtlas: 'subpkg_images/market_cards_heyan.jpg',
    meatCard: 'subpkg_images/market_card_heyan_meat.jpg',
  },
  qiaotou: {
    routeBg: 'subpkg_images/market_route_qiaotou.jpg',
    cardAtlas: 'subpkg_images/market_cards_qiaotou.jpg',
    meatCard: 'subpkg_images/market_card_qiaotou_meat.jpg',
  },
  nanshi: {
    routeBg: 'subpkg_images/market_route_nanshi.jpg',
    cardAtlas: 'subpkg_images/market_cards_nanshi.jpg',
    meatCard: 'subpkg_images/market_card_nanshi_meat.jpg',
  },
  shanwu: {
    routeBg: 'subpkg_images/market_route_shanwu.jpg',
    cardAtlas: 'subpkg_images/market_cards_shanwu.jpg',
    meatCard: 'subpkg_images/market_card_shanwu_meat.jpg',
  },
  jiangbian: {
    routeBg: 'subpkg_images/market_route_jiangbian.jpg',
    cardAtlas: 'subpkg_images/market_cards_jiangbian.jpg',
    meatCard: 'subpkg_images/market_card_jiangbian_meat.jpg',
  },
  laocheng: {
    routeBg: 'subpkg_images/market_route_laocheng.jpg',
    cardAtlas: 'subpkg_images/market_cards_laocheng.jpg',
    meatCard: 'subpkg_images/market_card_laocheng_meat.jpg',
  },
  dukou: {
    routeBg: 'subpkg_images/market_route_dukou.jpg',
    cardAtlas: 'subpkg_images/market_cards_dukou.jpg',
  },
  shanzhen: {
    routeBg: 'subpkg_images/market_route_shanzhen.jpg',
    cardAtlas: 'subpkg_images/market_cards_shanzhen.jpg',
    meatCard: 'subpkg_images/market_card_shanzhen_meat.jpg',
  },
};

const XIANGKO_RUMMAGE: Record<StallId, string> = {
  leaf: 'subpkg_images/stall_rummage_leaf.jpg',
  root: 'subpkg_images/stall_rummage_root.jpg',
  egg: 'subpkg_images/stall_rummage_egg.jpg',
  fish: 'subpkg_images/stall_rummage_fish.jpg',
  meat: 'subpkg_images/stall_rummage_egg.jpg',
};

const XIANGKO_PILE: Record<StallId, string> = {
  leaf: 'subpkg_images/stall_pile_leaf.png',
  root: 'subpkg_images/stall_pile_root.png',
  egg: 'subpkg_images/stall_pile_egg.png',
  fish: 'subpkg_images/stall_pile_fish.png',
  meat: 'subpkg_images/stall_pile_egg.png',
};

/** 翻堆底图：巷口沿用旧文件，后四个场按市场×摊位各一张。专属摊走 specialty。 */
export function stallRummageArt(marketId: MarketId, stall?: StallId, specialty?: string): string {
  if (specialty) return `subpkg_images/stall_rummage_${marketId}_${specialty}.jpg`;
  if (!stall) return XIANGKO_RUMMAGE.egg;
  if (marketId === 'xiangko') return XIANGKO_RUMMAGE[stall];
  return `subpkg_images/stall_rummage_${marketId}_${stall}.jpg`;
}

/** 可点遮挡堆：巷口沿用旧文件，后四个场按市场×摊位各一张。 */
export function stallPileArt(marketId: MarketId, stall?: StallId, specialty?: string): string {
  if (specialty) return `subpkg_images/stall_pile_${marketId}_${specialty}.png`;
  if (!stall) return XIANGKO_PILE.egg;
  if (marketId === 'xiangko') return XIANGKO_PILE[stall];
  return `subpkg_images/stall_pile_${marketId}_${stall}.png`;
}

export interface EventVoice {
  /** 说话的人。null 是旁白，弹窗不画半身像 */
  speaker: string | null;
  portrait: string | null;
  lines: string[];
}

/**
 * 事件卡台词按菜场分开。同一张卡备几句轮换，跑十局不至于背下来。
 * 白捡的文案在 RunManager 里现拼（要带菜名），不在这张表。
 */
export const EVENT_VOICE: Record<MarketId, Partial<Record<CardKind, EventVoice>>> = {
  xiangko: {
    favor: {
      speaker: '巷口张婶',
      portrait: 'subpkg_images/npc_neighbor.png',
      lines: [
        '囡囡，前头那摊我替你打过招呼了。慢慢翻，他不催你。',
        '你妈从前也这个点来。前面那摊你只管挑，账记我头上。',
        '别急别急，前头那摊我说过了。他手脚慢，够你挑一阵。',
      ],
    },
    empty: {
      speaker: '收摊的摊主',
      portrait: 'subpkg_images/npc_vendor.png',
      lines: [
        '收光啦，明早再来。前头张婶还没走，你快些去。',
        '晚咯，筐都空了。往前两步还有摊没收，我瞧见的。',
        '今天就这样喽。你往前看看，那几家还亮着灯。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '巷子到这儿就没路了，墙根堆着几只空筐。',
        '走到底才看清是条死巷。回头再挑一条吧。',
        '前面是别人家的后门。天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '巷口张婶',
      portrait: 'subpkg_images/npc_neighbor.png',
      lines: [
        '筐底压着一张油纸，字还认得。你拿走吧。',
        '这张谱我用不着了，你拿去试试。',
        '别嫌皱，上面那道菜我从前常做。',
      ],
    },
  },
  heyan: {
    favor: {
      speaker: '河沿刘伯',
      portrait: 'subpkg_images/npc_heyan_uncle.png',
      lines: [
        '早市这摊我熟。你去翻，他不跟你计较那几个钱。',
        '雾还没散，前头那家我打过招呼，慢慢挑。',
        '船刚靠岸，货是新的。后面那摊算我的。',
      ],
    },
    empty: {
      speaker: '早市摊嫂',
      portrait: 'subpkg_images/npc_heyan_vendor.png',
      lines: [
        '早市收得快，筐空了。河边那几家灯还亮着。',
        '这摊卖完了。往水边走，青菜还堆着。',
        '来晚了一步。前面雾里还有人在装筐。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '路到河堤就断了，脚下是湿草和缆绳。',
        '走到码头尽头，船已经撑走了。',
        '这边是洗衣埠，没有摊。天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '河沿刘伯',
      portrait: 'subpkg_images/npc_heyan_uncle.png',
      lines: [
        '早市筐底常夹着这种纸。你收着。',
        '船娘留下的，我认字不多，你拿去。',
        '雾里摸出来的一张，回去照着做。',
      ],
    },
  },
  qiaotou: {
    favor: {
      speaker: '桥头周嫂',
      portrait: 'subpkg_images/npc_heyan_vendor.png',
      lines: [
        '石桥那边我熟。你去翻，账先记我头上。',
        '田头货刚卸下，前头那担我打过招呼。',
        '案板上那几根你慢慢挑，他不催。',
      ],
    },
    empty: {
      speaker: '担货的汉子',
      portrait: 'subpkg_images/npc_heyan_uncle.png',
      lines: [
        '这担空了。桥那边还有人在卸筐。',
        '来晚了。往桥头走，青菜还堆着。',
        '卖完了。前面石阶上还有几家没收。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '路到桥洞就断了，脚下是青苔和河水。',
        '走到堤坝尽头，没有摊，只有几根缆桩。',
        '这边是过水涵洞，天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '桥头周嫂',
      portrait: 'subpkg_images/npc_heyan_vendor.png',
      lines: [
        '筐底压着一张油纸，桥头常有这种。',
        '这谱我用不着了，你拿去配田头那几样。',
        '纸皱了，字还在。回去照着炖。',
      ],
    },
  },
  shanwu: {
    favor: {
      speaker: '山坞阿婆',
      portrait: 'subpkg_images/npc_shanwu_granny.png',
      lines: [
        '前头那家我孙子看着摊。你慢慢挑，他不会说你。',
        '笋是天没亮挖的，还带土。前面那摊算我的。',
        '山路难走，你既然上来了，就多翻两筐。',
      ],
    },
    empty: {
      speaker: '挑担的山客',
      portrait: 'subpkg_images/npc_shanwu_vendor.png',
      lines: [
        '这担子空了，我下山去咯。坡上那家还没走。',
        '菌子早卖光了，来得晚喽。往竹林那边看看。',
        '就剩两根扁担。你往前走，还有人在歇脚。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '路进了竹林就断了，脚下全是笋壳。',
        '走到半坡，前面是别人家的地。天色白耗了一步。',
        '这边只有一口井和几只空篓。',
      ],
    },
    recipe: {
      speaker: '山坞阿婆',
      portrait: 'subpkg_images/npc_shanwu_granny.png',
      lines: [
        '篓底垫着的这张纸，你识字，拿去。',
        '山里的做法，写在这上头。别弄湿了。',
        '我记不住了，你替我记着。',
      ],
    },
  },
  jiangbian: {
    favor: {
      speaker: '渔市阿珠',
      portrait: 'subpkg_images/npc_jiangbian_aunt.png',
      lines: [
        '夜里这摊我熟。你翻，秤我帮你看着。',
        '潮水刚退，前头那家我说过了，别急。',
        '带鱼还在冰上。后面那摊账记我身上。',
      ],
    },
    empty: {
      speaker: '收网的伙计',
      portrait: 'subpkg_images/npc_jiangbian_vendor.png',
      lines: [
        '这筐收光了。码头尽头那盏灯还没关。',
        '鱼走了。往栈桥走，黄鱼还堆着冰。',
        '晚了。前面船上还有人在分货。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '栈桥到这儿没路了，下面是黑水。',
        '走到堤坝尽头，只听见船缆响。',
        '这是卸货的岔口，没有摊。天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '渔市阿珠',
      portrait: 'subpkg_images/npc_jiangbian_aunt.png',
      lines: [
        '秤底下压着一张，夜市别浪费。',
        '夹给你的，回去照着做。',
        '潮水带来的纸，字还在。',
      ],
    },
  },
  laocheng: {
    favor: {
      speaker: '菜行陈老板',
      portrait: 'subpkg_images/npc_laocheng_boss.png',
      lines: [
        '认得你妈。前头那间报我姓陈，秤给你放平。',
        '老行里的规矩，熟客不催。你只管慢慢看。',
        '梁上那条腿是去年的。前面那家账先记着。',
      ],
    },
    empty: {
      speaker: '菜行伙计',
      portrait: 'subpkg_images/npc_laocheng_vendor.png',
      lines: [
        '这间早上就订光了。里进还有两间没关板。',
        '好货不上架，来晚就没有。往后堂走走。',
        '空了空了。石板路尽头那家灯还亮着。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '巷子被一道院墙封死，墙上还留着旧行号。',
        '走到底是间关了板的铺子。天色白耗了一步。',
        '这条是运货的后弄，没有摊，只有一地稻草。',
      ],
    },
    recipe: {
      speaker: '菜行陈老板',
      portrait: 'subpkg_images/npc_laocheng_boss.png',
      lines: [
        '老账本里夹着的，行里没人做了。你拿去。',
        '这道菜从前是给东家做的。别糟蹋了。',
        '纸脆，你收好。上头那几味，市面上不常有。',
      ],
    },
  },
  nanshi: {
    favor: {
      speaker: '南门豆腐坊',
      portrait: 'subpkg_images/npc_laocheng_vendor.png',
      lines: [
        '豆干刚出锅。前头那摊我打过招呼，慢慢翻。',
        '禽笼子还在响。后面那家账记我头上。',
        '酱缸揭开了，你去挑，他不催。',
      ],
    },
    empty: {
      speaker: '担筐的伙计',
      portrait: 'subpkg_images/npc_laocheng_vendor.png',
      lines: [
        '这摊空了。城门里那家豆干还热着。',
        '来晚了。往南走，禽还在叫。',
        '卖完了。前面巷子灯还亮。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '巷子拐进豆腐坊后院，没有摊。',
        '走到城门根，路被一排酱缸堵住了。',
        '这边是卸货的弄堂。天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '南门豆腐坊',
      portrait: 'subpkg_images/npc_laocheng_vendor.png',
      lines: [
        '案板底下压着一张，豆香还在纸上。',
        '城南的做法，你拿去试试。',
        '别嫌油，上头那道菜我从前常做。',
      ],
    },
  },
  dukou: {
    favor: {
      speaker: '渡口船娘',
      portrait: 'subpkg_images/npc_jiangbian_aunt.png',
      lines: [
        '船刚靠。前头那筐我打过招呼，慢慢挑。',
        '潮水好，黄鱼还在冰上。后面那摊算我的。',
        '干货篓在舱里。你去翻，秤我帮你看着。',
      ],
    },
    empty: {
      speaker: '收网的伙计',
      portrait: 'subpkg_images/npc_jiangbian_vendor.png',
      lines: [
        '这筐收光了。石埠尽头那盏灯还没关。',
        '鱼走了。往船上走，河鳗还泡着。',
        '晚了。前面舱里还有人在分货。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '栈桥到这儿没路了，下面是黑水。',
        '走到堤坝尽头，只听见船缆响。',
        '这是卸货的岔口，没有摊。天色白耗了一步。',
      ],
    },
    recipe: {
      speaker: '渡口船娘',
      portrait: 'subpkg_images/npc_jiangbian_aunt.png',
      lines: [
        '舱底压着一张，字还认得。',
        '潮水带来的纸，回去照着做。',
        '夹给你的，别弄湿了。',
      ],
    },
  },
  shanzhen: {
    favor: {
      speaker: '山珍行账房',
      portrait: 'subpkg_images/npc_laocheng_boss.png',
      lines: [
        '认得你。前头那篓报我的号，慢慢看。',
        '松茸不常有。后面那筐账先记着。',
        '梁上那腿是去年的。你只管翻。',
      ],
    },
    empty: {
      speaker: '行里伙计',
      portrait: 'subpkg_images/npc_laocheng_vendor.png',
      lines: [
        '这间订光了。里进还有两篓没关。',
        '好货不上架，来晚就没有。往后堂走走。',
        '空了。木梁尽头那盏灯还亮着。',
      ],
    },
    deadend: {
      speaker: null,
      portrait: null,
      lines: [
        '巷子被一道木栅封死，墙上还留着旧行号。',
        '走到底是间关了板的库房。天色白耗了一步。',
        '这条是运货的后弄，没有摊。',
      ],
    },
    recipe: {
      speaker: '山珍行账房',
      portrait: 'subpkg_images/npc_laocheng_boss.png',
      lines: [
        '老账本里夹着的，行里没人做了。你拿去。',
        '这道菜从前是给东家做的。别糟蹋了。',
        '纸脆，你收好。上头那几味，市面上不常有。',
      ],
    },
  },
};

export function eventVoice(marketId: MarketId, kind: CardKind): EventVoice | undefined {
  return EVENT_VOICE[marketId]?.[kind];
}
