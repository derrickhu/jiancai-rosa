import {
  GOD_PICK,
  displayName,
  initialFreshness,
  rollMarketItem,
  sellPrice,
  type Quality,
  type StallId,
} from './items';
import type { MarketId } from './destinations';
import { PACK_RATE, STALL_FEE } from './packing';
import { FAVOR_PACK_RATE, FREEBIE_STALLS, MARKET_PLAN, paystallPileBonus, stallPileRange, type CardKind } from './marketEvents';
import { isRummageNode, mapRummageNodes, nodeEncounter } from './encounters';
import { buildMarketMap, mapStallNodes, type MapNode, type MarketMap } from './marketMap';
import { bagItemName } from './talkScripts';
import type { SceneResume } from './routeScenes';
import { getSpecialty, rollSpecialtyItem } from './specialties';
import { mulberry32, newSeed, rngInt, rngPick, type Rng } from './rng';
import type { BasketItem, BasketState } from './basket';

/** 天色（步数）管全局。摊内不再倒计时装箱。play 是采集 / 小游戏。 */
export type RunMode = 'map' | 'rummage' | 'play';
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

/** 走过一张事件卡的战果。场景据此弹对话或拾取窗，不再只发一条 toast。 */
export interface RunEventLog {
  nodeId: string;
  kind: CardKind;
  marketId: MarketId;
  /** 弹窗正文。事件卡是一句人话，白捡是一句旁白。 */
  text: string;
  /** 白捡到的东西；没捡到东西的卡是 null */
  gain: { defId: string; quality: Quality; taken: boolean } | null;
  scriptId?: string;
  speaker?: string;
  portrait?: string | null;
  choices?: Array<{ label: string; steps?: number }>;
}

export interface GatherSpot {
  uid: string;
  defId: string;
  taken: boolean;
  x: number;
  y: number;
}

export interface GatherPlay {
  type: 'gather';
  nodeId: string;
  picksLeft: number;
  spots: GatherSpot[];
  bg?: string;
}

export type PlayState = GatherPlay;

export interface RunState {
  seed: number;
  marketId: MarketId;
  mode: RunMode;
  map: MarketMap;
  stepsMax: number;
  stepsLeft: number;
  /** 已经站上的卡，null 表示还在巷口没迈第一步 */
  atNodeId: string | null;
  /** 这一层能点的卡 */
  options: string[];
  visited: string[];
  /** 空摊看清的下层卡，无视明牌 */
  peeked: string[];
  /** 正在翻的摊位卡 */
  currentNodeId: string | null;
  /** nodeId → 这摊的货。摊位卡各自一堆，同类摊不共享。 */
  piles: Record<string, PileItem[]>;
  packing: Record<string, number>;
  paid: string[];
  /** 街坊人情：下一摊免摊位费 */
  freePass: boolean;
  /** 街坊人情拖住的摊，老板装箱慢 */
  slowNodes: string[];
  ended: boolean;
  extract?: ExtractResult;
  /** 路线页那行事件回执 */
  note: string;
  /** 最近一张事件卡的战果，给弹窗用 */
  lastEvent?: RunEventLog;
  sceneId: string;
  bag: Array<{ id: string; qty: number }>;
  flags: string[];
  returnStack: SceneResume[];
  play?: PlayState;
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

function rollQuality(rng: Rng, paid = false): Quality {
  const rotten = paid ? 0.06 : 0.18;
  return rng() < rotten ? 'rotten' : 'common';
}

export function createRun(opts: {
  allowGodPick: boolean;
  marketId?: MarketId;
  seed?: number;
  cookLevel?: number;
  allowRecipe?: boolean;
  /** 已解锁菜谱要用的食材。传进来摊上就会多出这些货。 */
  wanted?: ReadonlySet<string>;
}): RunState {
  const marketId = opts.marketId ?? 'xiangko';
  const seed = opts.seed ?? newSeed();
  const cookLevel = opts.cookLevel ?? 1;
  const map = buildMarketMap(marketId, seed, { allowRecipe: opts.allowRecipe !== false });
  const plan = MARKET_PLAN[marketId];
  // 单独一条 rng：改品质规则不该把地图布局也换掉
  const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0);

  const piles: Record<string, PileItem[]> = {};
  const packing: Record<string, number> = {};
  for (const node of mapRummageNodes(map)) {
    const enc = nodeEncounter(node);
    if (enc.type !== 'rummage') continue;
    const paid = node.kind === 'paystall';
    const spec = enc.specialty ? getSpecialty(enc.specialty) : undefined;
    const range = spec ? spec.count : stallPileRange(marketId, node.stall ?? 'egg');
    const bonus = paid ? paystallPileBonus(marketId) : 0;
    const n = rngInt(rng, range[0] + bonus, range[1] + bonus);
    const list: PileItem[] = [];
    for (let i = 0; i < n; i++) {
      const def = spec
        ? rollSpecialtyItem(spec.id, rng, cookLevel)
        : rollMarketItem(marketId, node.stall ?? 'egg', cookLevel, rng, opts.wanted);
      list.push({
        uid: nextUid('p'),
        defId: def.id,
        quality: rollQuality(rng, paid),
        revealed: false,
        inspected: false,
        washed: false,
        drawn: false,
      });
    }
    piles[node.id] = list;
    packing[node.id] = 0;
  }

  if (opts.allowGodPick && rng() < 0.85) {
    const fishNodes = mapStallNodes(map).filter((n) => n.stall === 'fish');
    if (fishNodes.length) {
      const host = piles[rngPick(rng, fishNodes).id];
      const victim = host?.find((it) => it.defId === 'smallfish') ?? (host?.length ? rngPick(rng, host) : null);
      if (victim) {
        victim.defId = GOD_PICK.id;
        victim.disguiseId = 'smallfish';
        victim.quality = 'god';
      }
    }
  }

  return {
    seed,
    marketId,
    mode: 'map',
    map,
    stepsMax: plan.steps,
    stepsLeft: plan.steps,
    atNodeId: null,
    options: map.layers[0].slice(),
    visited: [],
    peeked: [],
    currentNodeId: null,
    piles,
    packing,
    paid: [],
    freePass: false,
    slowNodes: [],
    ended: false,
    extract: undefined,
    note: '天还没黑，挑条路走。',
    sceneId: 'main',
    bag: [],
    flags: [],
    returnStack: [],
  };
}

export function hasGodPick(state: RunState): boolean {
  return Object.values(state.piles).some((list) => list.some((it) => it.defId === GOD_PICK.id));
}

/** 摊位费：第一摊白翻，人情也白翻，之后按摊型收。收费摊按卡上的标价。 */
export function nodeFee(state: RunState, node: MapNode): number {
  if (!isRummageNode(node)) return 0;
  if (state.paid.includes(node.id)) return 0;
  if (state.freePass) return 0;
  if (node.kind === 'paystall') return node.fee;
  return state.paid.length === 0 ? 0 : STALL_FEE[node.stall ?? 'egg'];
}

/** 天色不够、钱不够、厨艺不够都拦在这。看得见进不去，别把卡藏起来。 */
export function cardBlock(
  state: RunState,
  node: MapNode,
  money: number,
  cookLevel: number,
  /** 预览前方的卡时跳过天色判定，那时候剩几步还说不准 */
  ignoreSteps = false,
): string | null {
  if (!ignoreSteps && node.steps > state.stepsLeft) return '天色不够了';
  if (node.cookNeed > cookLevel) return `厨艺 ${node.cookNeed} 级才认得`;
  const enc = nodeEncounter(node);
  if (enc.type === 'gate') {
    const have = state.bag.some((it) => it.id === enc.need && it.qty > 0);
    if (!have) return `缺${bagItemName(enc.need)}`;
  }
  const fee = nodeFee(state, node);
  if (fee > money) return `差 ${fee - money} 金币`;
  return null;
}

export function currentNode(state: RunState): MapNode | null {
  return state.currentNodeId ? state.map.nodes[state.currentNodeId] ?? null : null;
}

export function currentStallId(state: RunState): StallId | null {
  const node = currentNode(state);
  if (!node) return null;
  const enc = nodeEncounter(node);
  if (enc.type === 'rummage' && enc.stall) return enc.stall;
  return node.stall ?? null;
}

export function packRate(state: RunState, nodeId: string): number {
  const node = state.map.nodes[nodeId];
  if (!node?.stall) return 0;
  const slow = state.slowNodes.includes(nodeId) ? FAVOR_PACK_RATE : 1;
  return PACK_RATE[node.stall] * slow;
}

export function visibleDefId(item: PileItem): string {
  if (item.defId === GOD_PICK.id && !item.inspected) return item.disguiseId || 'smallfish';
  return item.defId;
}

/** 装箱倒计时已停用：天色管整局，摊内不催。 */
export function tickRun(state: RunState, _dt: number, _interacting: boolean): RunState {
  return state;
}

/** 白捡的货：地上躺着的只会是叶菜根茎蛋豆，不会是活蟹。 */
export function rollFreebie(
  rng: Rng,
  marketId: MarketId = 'xiangko',
  cookLevel = 1,
  wanted?: ReadonlySet<string>,
): { defId: string; quality: Quality } {
  const stall = rngPick(rng, FREEBIE_STALLS);
  const def = rollMarketItem(marketId, stall, cookLevel, rng, wanted);
  return { defId: def.id, quality: rng() < 0.7 ? 'common' : 'fresh' };
}

export function settleExtract(kind: ExtractKind, basket: BasketState): ExtractResult {
  const items: ExtractedItem[] = basket.items.filter((it) => it.quality !== 'rotten').map((it) => ({
    uid: it.uid,
    defId: it.defId,
    quality: it.quality,
    inspected: it.inspected,
    freshness: it.freshness,
    name: displayName(it.defId, it.inspected, it.quality),
    sell: sellPrice(it.defId, it.quality, it.inspected, it.freshness),
  }));
  return { kind, items, lost: 0 };
}

/** 主动收工是 safe，天黑被赶出来是 messy。 */
export function decideExtract(state: RunState, voluntary: boolean): ExtractKind {
  if (!voluntary || state.stepsLeft <= 0) return 'messy';
  return 'safe';
}

export function pileToBasketDraft(item: PileItem): Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'> {
  const inspected = item.defId === GOD_PICK.id ? item.inspected : true;
  return {
    uid: item.uid,
    defId: item.defId,
    quality: item.quality,
    inspected,
    freshness: initialFreshness(item.quality),
  };
}

export function freebieToBasketDraft(defId: string, quality: Quality): Omit<BasketItem, 'x' | 'y' | 'rot' | 'pinned' | 'dampened'> {
  return {
    uid: nextUid('f'),
    defId,
    quality,
    inspected: true,
    freshness: initialFreshness(quality),
  };
}
