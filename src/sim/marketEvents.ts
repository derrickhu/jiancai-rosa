import type { MarketId } from './destinations';
import type { StallId } from './items';
import { STALL_FEE } from './packing';

export type CardKind = 'stall' | 'paystall' | 'freebie' | 'fork' | 'deadend' | 'empty' | 'favor' | 'deep';

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
  ],
  heyan: [
    ['stall', 32],
    ['freebie', 12],
    ['fork', 12],
    ['empty', 10],
    ['favor', 8],
    ['deadend', 9],
    ['paystall', 10],
  ],
  jiangbian: [
    ['stall', 30],
    ['freebie', 10],
    ['fork', 11],
    ['empty', 10],
    ['favor', 7],
    ['deadend', 10],
    ['paystall', 14],
  ],
};

/** 哪类摊多。河沿肉摊、江边水产主场都走这张表，别为菜场另写卡型。 */
export const STALL_WEIGHTS: Record<MarketId, Array<[StallId, number]>> = {
  xiangko: [['leaf', 34], ['root', 30], ['egg', 24], ['fish', 12]],
  heyan: [['leaf', 28], ['root', 28], ['egg', 26], ['fish', 18]],
  jiangbian: [['leaf', 18], ['root', 20], ['egg', 22], ['fish', 40]],
};

/** 收费摊：货更足，进场费也更狠。 */
export function paystallFee(stall: StallId): number {
  return STALL_FEE[stall] * 3 + 8;
}

/** 白捡只出这几摊的货，地上不会躺着活蟹。 */
export const FREEBIE_STALLS: StallId[] = ['leaf', 'root', 'egg'];

/** 街坊人情：下一摊免费，老板还慢慢收。 */
export const FAVOR_PACK_RATE = 0.7;

export interface EventVoice {
  /** 说话的人。null 是旁白，弹窗不画半身像 */
  speaker: string | null;
  portrait: string | null;
  lines: string[];
}

/**
 * 事件卡的台词。同一张卡备几句轮换，跑十局不至于背下来。
 * 白捡的文案在 RunManager 里现拼（要带菜名），不在这张表。
 */
export const EVENT_VOICE: Partial<Record<CardKind, EventVoice>> = {
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
};
