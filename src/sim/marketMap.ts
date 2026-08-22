import type { MarketId } from './destinations';
import { STALLS, stallsForMarket, type StallId } from './items';
import {
  CARD_WEIGHTS,
  EXTRA_LAYERS,
  MARKET_PLAN,
  STALL_WEIGHTS,
  paystallFee,
  type CardKind,
} from './marketEvents';
import { mulberry32, rngInt, rngPick, rngShuffle, rngWeighted, type Rng } from './rng';

/** 左中右三条道。卡片按车道对齐摆，「选了左边右边就过不去」才看得出来。 */
export const LANES = 3;

export interface MapNode {
  id: string;
  layer: number;
  /** 0 左 / 1 中 / 2 右 */
  lane: number;
  kind: CardKind;
  /** 摊位卡与收费摊才有 */
  stall?: StallId;
  /** 收费摊的固定进场费；普通摊按 STALL_FEE 现算，这里是 0 */
  fee: number;
  /** 厨艺门槛，0 为不限 */
  cookNeed: number;
  /** 耗几步天色。岔路 0 步。 */
  steps: number;
  next: string[];
}

export interface MarketMap {
  marketId: MarketId;
  seed: number;
  nodes: Record<string, MapNode>;
  /** 每层的 nodeId，纵向推进 */
  layers: string[][];
}

/** 这几种卡要走过一次才明牌，之前只显示背面。 */
const MYSTERY: CardKind[] = ['freebie', 'deadend', 'empty', 'favor', 'recipe'];

export function isMysteryCard(kind: CardKind): boolean {
  return MYSTERY.includes(kind);
}

const STALL_NAME: Record<StallId, string> = STALLS.reduce(
  (acc, s) => Object.assign(acc, { [s.id]: s.name }),
  {} as Record<StallId, string>,
);

const CARD_NAME: Record<CardKind, string> = {
  stall: '摊位',
  paystall: '货足的摊',
  freebie: '地上一把',
  fork: '岔路',
  deadend: '死胡同',
  empty: '空摊',
  favor: '街坊人情',
  deep: '巷子深处',
  recipe: '油纸菜谱',
};

const CARD_HINT: Record<CardKind, string> = {
  stall: '进去翻剩货',
  paystall: '要价高，剩得多',
  freebie: '白捡一件进篮',
  fork: '不耗天色，三道全开',
  deadend: '白走一步',
  empty: '没货，看清下一层',
  favor: '下一摊免费还慢',
  deep: '再往里走一段',
  recipe: '一张油纸，上面有菜',
};

export function cardName(node: MapNode, revealed: boolean): string {
  if (!revealed && isMysteryCard(node.kind)) return '？';
  if (node.kind === 'stall') return STALL_NAME[node.stall!];
  // 卡面窄，收费摊去掉「摊」字腾出「好货」两个字
  if (node.kind === 'paystall') return `${STALL_NAME[node.stall!].replace(/摊$/, '')}·好货`;
  return CARD_NAME[node.kind];
}

export function cardHint(node: MapNode, revealed: boolean): string {
  if (!revealed && isMysteryCard(node.kind)) return '走过才知道';
  return CARD_HINT[node.kind];
}

export function nodeAt(map: MarketMap, id: string): MapNode {
  const node = map.nodes[id];
  if (!node) throw new Error(`未知路线节点: ${id}`);
  return node;
}

export function layerCount(marketId: MarketId): number {
  return MARKET_PLAN[marketId].steps + EXTRA_LAYERS;
}

/**
 * 先铺保底摊位层，再按权重填其余层，最后按车道连边。
 * 反过来做（先随机再补保底）会出现整局撞不到蛋豆摊的局。
 */
export function buildMarketMap(marketId: MarketId, seed: number, opts?: { allowRecipe?: boolean }): MarketMap {
  const plan = MARKET_PLAN[marketId];
  const rng = mulberry32(seed);
  const total = layerCount(marketId);

  const widths: number[] = [];
  for (let i = 0; i < total; i++) widths.push(rngInt(rng, plan.width[0], plan.width[1]));

  const stallLayers = pickStallLayers(rng, plan.stallLayers, plan.steps, total);
  const kinds: CardKind[][] = [];
  let deadends = 0;

  for (let layer = 0; layer < total; layer++) {
    const width = widths[layer];
    const row: CardKind[] = [];
    if (stallLayers.includes(layer)) {
      for (let i = 0; i < width; i++) row.push('stall');
    } else {
      const pool = CARD_WEIGHTS[marketId].filter(([kind]) => {
        if (kind === 'deep' && !plan.allowDeep) return false;
        if (kind === 'deadend' && deadends >= plan.maxDeadend) return false;
        if (kind === 'recipe' && opts?.allowRecipe === false) return false;
        // 开局第一层不给死胡同，也不给岔路，别让人第一下就白走
        if (layer === 0 && (kind === 'deadend' || kind === 'fork')) return false;
        return true;
      });
      for (let i = 0; i < width; i++) {
        // 同层不重复卡型，一层三张死胡同太蠢
        const avail = pool.filter(([kind]) => kind === 'stall' || !row.includes(kind));
        const kind = rngWeighted(rng, avail.length ? avail : pool);
        if (kind === 'deadend') deadends += 1;
        row.push(kind);
      }
    }
    kinds.push(row);
  }

  const stallCycle = stallRotation(rng, marketId);
  let cursor = 0;
  const nodes: Record<string, MapNode> = {};
  const layers: string[][] = [];

  kinds.forEach((row, layer) => {
    const lanes = pickLanes(rng, row.length);
    const ids: string[] = [];
    // 保底层同层不出重复摊型，让玩家选「哪个摊」而不是「要不要摊」
    const used: StallId[] = [];
    row.forEach((kind, i) => {
      const id = `n${layer}_${i}`;
      const node: MapNode = {
        id,
        layer,
        lane: lanes[i],
        kind,
        fee: 0,
        cookNeed: 0,
        steps: kind === 'fork' ? 0 : 1,
        next: [],
      };
      if (kind === 'stall' || kind === 'paystall') {
        let stall = stallCycle[cursor % stallCycle.length];
        let guard = 0;
        while (used.includes(stall) && guard < stallCycle.length) {
          cursor += 1;
          stall = stallCycle[cursor % stallCycle.length];
          guard += 1;
        }
        cursor += 1;
        used.push(stall);
        node.stall = stall;
        if (kind === 'paystall') node.fee = paystallFee(stall);
      }
      nodes[id] = node;
      ids.push(id);
    });
    layers.push(ids);
  });

  linkLayers(rng, nodes, layers);
  return { marketId, seed, nodes, layers };
}

/** 两张卡时换着贴左/贴右/分两边，别每层都长一个样。 */
function pickLanes(rng: Rng, width: number): number[] {
  if (width >= LANES) return [0, 1, 2];
  if (width <= 1) return [1];
  return rngPick(rng, [[0, 1], [1, 2], [0, 2]]);
}

/** 保底层摊在前 steps 层里均匀铺开，第 0 层不占（开局先给点自由）。 */
function pickStallLayers(rng: Rng, want: number, steps: number, total: number): number[] {
  const span = Math.min(steps, total);
  const out: number[] = [];
  for (let i = 0; i < want; i++) {
    const base = Math.round(((i + 1) * span) / (want + 1));
    const jitter = rngInt(rng, -1, 1);
    let layer = Math.min(span - 1, Math.max(1, base + jitter));
    while (out.includes(layer)) layer = Math.min(span - 1, layer + 1);
    if (!out.includes(layer)) out.push(layer);
  }
  return out;
}

/** 四类摊轮转，保证一局里各类都露过面。 */
function stallRotation(rng: Rng, marketId: MarketId): StallId[] {
  const weights = STALL_WEIGHTS[marketId];
  const base = rngShuffle(rng, stallsForMarket(marketId));
  const extra: StallId[] = [];
  for (let i = 0; i < 6; i++) extra.push(rngWeighted(rng, weights));
  return [...base, ...extra];
}

function nearestInLane(nodes: Record<string, MapNode>, ids: string[], lane: number): string {
  return ids.reduce((best, id) => (
    Math.abs(nodes[id].lane - lane) < Math.abs(nodes[best].lane - lane) ? id : best
  ), ids[0]);
}

/**
 * 只能走到相邻车道，最多两张：选了左边，最右边那张就过不去。
 * 岔路例外，它把整排都打开——这才是「岔路」的意思。
 */
function linkLayers(rng: Rng, nodes: Record<string, MapNode>, layers: string[][]): void {
  for (let i = 0; i < layers.length - 1; i++) {
    const cur = layers[i];
    const nxt = layers[i + 1];
    cur.forEach((id) => {
      const node = nodes[id];
      if (node.kind === 'fork') {
        node.next = nxt.slice();
        return;
      }
      if (node.kind === 'deadend') {
        node.next = [nearestInLane(nodes, nxt, node.lane)];
        return;
      }
      let reach = nxt.filter((nid) => Math.abs(nodes[nid].lane - node.lane) <= 1);
      if (!reach.length) reach = [nearestInLane(nodes, nxt, node.lane)];
      if (reach.length > 2) {
        // 中间车道能碰到三张，砍掉一张才有方向可言
        const same = reach.filter((nid) => nodes[nid].lane === node.lane);
        const side = rngShuffle(rng, reach.filter((nid) => nodes[nid].lane !== node.lane));
        reach = [...same, ...side].slice(0, 2);
      }
      node.next = nxt.filter((nid) => reach.includes(nid));
    });
    // 没有入边的卡等于不存在，补一条最近的
    nxt.forEach((nid) => {
      if (cur.some((cid) => nodes[cid].next.includes(nid))) return;
      const near = nearestInLane(nodes, cur, nodes[nid].lane);
      nodes[near].next.push(nid);
      nodes[near].next = nxt.filter((x) => nodes[near].next.includes(x));
    });
  }
  layers[layers.length - 1].forEach((id) => {
    nodes[id].next = [];
  });
}

export function mapStallNodes(map: MarketMap): MapNode[] {
  return Object.values(map.nodes).filter((n) => !!n.stall);
}
