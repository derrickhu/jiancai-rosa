import type { MarketId } from './destinations';
import type { StallId } from './items';
import { STALL_FEE } from './packing';

export type CardKind = 'stall' | 'paystall' | 'freebie' | 'fork' | 'deadend' | 'empty' | 'favor' | 'deep' | 'recipe';

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

/** 层数比步数多，天色才是真的紧；岔路 0 步 = 白送一层。 */
export const EXTRA_LAYERS = 3;

export const MARKET_PLAN: Record<MarketId, MarketPlan> = {
  xiangko: { steps: 10, stallLayers: 3, width: [2, 3], maxDeadend: 2, allowDeep: false },
  heyan: { steps: 12, stallLayers: 4, width: [2, 3], maxDeadend: 2, allowDeep: false },
  jiangbian: { steps: 14, stallLayers: 4, width: [3, 3], maxDeadend: 2, allowDeep: false },
};

/** 填非保底层用。三个菜场同一套卡型，只改权重。 */
export const CARD_WEIGHTS: Record<MarketId, Array<[CardKind, number]>> = {
  xiangko: [
    ['stall', 30],
    ['freebie', 15],
    ['fork', 13],
    ['empty', 11],
    ['favor', 9],
    ['deadend', 8],
    ['paystall', 6],
    ['recipe', 5],
  ],
  heyan: [
    ['stall', 32],
    ['freebie', 12],
    ['fork', 12],
    ['empty', 10],
    ['favor', 8],
    ['deadend', 9],
    ['paystall', 10],
    ['recipe', 5],
  ],
  jiangbian: [
    ['stall', 30],
    ['freebie', 10],
    ['fork', 11],
    ['empty', 10],
    ['favor', 7],
    ['deadend', 10],
    ['paystall', 14],
    ['recipe', 4],
  ],
};

/** 哪类摊多。河沿肉摊、江边水产主场都走这张表，别为菜场另写卡型。 */
export const STALL_WEIGHTS: Record<MarketId, Array<[StallId, number]>> = {
  xiangko: [['leaf', 34], ['root', 30], ['egg', 24], ['fish', 12]],
  heyan: [['leaf', 26], ['root', 24], ['egg', 22], ['fish', 14], ['meat', 14]],
  jiangbian: [['leaf', 16], ['root', 16], ['egg', 18], ['fish', 38], ['meat', 12]],
};

/** 收费摊：货更足，进场费也更狠。 */
export function paystallFee(stall: StallId): number {
  return STALL_FEE[stall] * 3 + 8;
}

/** 白捡只出这几摊的货，地上不会躺着活蟹。 */
export const FREEBIE_STALLS: StallId[] = ['leaf', 'root', 'egg'];

/** 街坊人情：下一摊免费，老板还慢慢收。 */
export const FAVOR_PACK_RATE = 0.7;

/** 每个菜场自己的路线底图和卡面图集，别三个场共用巷口那一套。 */
export const MARKET_ART: Record<MarketId, { routeBg: string; cardAtlas: string }> = {
  xiangko: {
    routeBg: 'subpkg_images/market_route_1.jpg',
    cardAtlas: 'subpkg_images/market_cards.jpg',
  },
  heyan: {
    routeBg: 'subpkg_images/market_route_heyan.jpg',
    cardAtlas: 'subpkg_images/market_cards_heyan.jpg',
  },
  jiangbian: {
    routeBg: 'subpkg_images/market_route_jiangbian.jpg',
    cardAtlas: 'subpkg_images/market_cards_jiangbian.jpg',
  },
};

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
        '这摊卖完了。往水边走，萝卜还堆着。',
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
};

export function eventVoice(marketId: MarketId, kind: CardKind): EventVoice | undefined {
  return EVENT_VOICE[marketId]?.[kind];
}
