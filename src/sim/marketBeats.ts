import type { Encounter } from './encounters';
import { encounterFromKind } from './encounters';
import type { CardKind } from './marketEvents';
import type { MapNode, RouteScene } from './marketMap';
import { linkSceneLayers, makeSceneNode } from './marketMap';
import { rngInt, rngPick, rngShuffle, type Rng } from './rng';
import type { MarketId } from './destinations';

export interface OverlaySpec {
  kind: CardKind;
  title: string;
  templateId: string;
  cardArt?: string;
  encounter?: Encounter;
}

interface BeatCtx {
  nodes: Record<string, MapNode>;
  layers: string[][];
  scenes: Record<string, RouteScene>;
  rng: Rng;
  used: Set<string>;
}

type BeatFn = (ctx: BeatCtx) => void;

function isReplaceable(node: MapNode): boolean {
  return node.kind !== 'stall' && node.kind !== 'paystall' && node.kind !== 'recipe';
}

function pickOverlaySlot(
  ctx: BeatCtx,
  from: number,
  to: number,
  sideOnly = false,
): string | undefined {
  const cands = ctx.layers.slice(from, to).flat().filter((id) => {
    if (ctx.used.has(id)) return false;
    const n = ctx.nodes[id];
    if (!n || !isReplaceable(n)) return false;
    if (n.sceneId && n.sceneId !== 'main') return false;
    if (sideOnly && n.lane === 1) return false;
    return true;
  });
  const id = cands.length ? rngPick(ctx.rng, cands) : ctx.layers.flat().find((nid) => {
    if (ctx.used.has(nid)) return false;
    return isReplaceable(ctx.nodes[nid]);
  });
  if (id) ctx.used.add(id);
  return id;
}

function overlayCard(ctx: BeatCtx, id: string, spec: OverlaySpec): void {
  const old = ctx.nodes[id];
  ctx.nodes[id] = {
    ...old,
    stall: undefined,
    fee: 0,
    kind: spec.kind,
    title: spec.title,
    templateId: spec.templateId,
    cardArt: spec.cardArt,
    encounter: spec.encounter,
  };
  if (!ctx.nodes[id].encounter) ctx.nodes[id].encounter = encounterFromKind(ctx.nodes[id]);
}

function attachScene(
  ctx: BeatCtx,
  scene: { id: string; bg: string; rows: MapNode[][] },
): void {
  const layerIds = scene.rows.map((row) => row.map((n) => n.id));
  scene.rows.flat().forEach((node) => {
    ctx.nodes[node.id] = node;
  });
  linkSceneLayers(ctx.rng, ctx.nodes, layerIds);
  ctx.scenes[scene.id] = { id: scene.id, bg: scene.bg, layers: layerIds };
}

function pickBeats(rng: Rng, beats: BeatFn[], n: number): BeatFn[] {
  return rngShuffle(rng, beats).slice(0, Math.min(n, beats.length));
}

function applyPicked(ctx: BeatCtx, beats: BeatFn[], count: number): void {
  pickBeats(ctx.rng, beats, count).forEach((fn) => fn(ctx));
}

/** 山坞：小路和菌摊每局都在，不进抽样池。 */
function applyShanwuBeats(ctx: BeatCtx): void {
  const pathId = pickOverlaySlot(ctx, 4, 9, true);
  if (pathId) {
    overlayCard(ctx, pathId, {
      kind: 'branch',
      title: '杂草小路',
      templateId: 'shanwu_hidden_path',
      cardArt: 'subpkg_images/market_card_shanwu_trail.jpg',
      encounter: { type: 'branch', sceneId: 'shanwu_trail' },
    });
  }
  const fungusId = pickOverlaySlot(ctx, 2, 7, false);
  if (fungusId) {
    overlayCard(ctx, fungusId, {
      kind: 'stall',
      title: '菌摊',
      templateId: 'shanwu_fungus',
      cardArt: 'subpkg_images/market_card_shanwu_fungus.jpg',
      encounter: { type: 'rummage', specialty: 'fungus' },
    });
  }
  attachScene(ctx, {
    id: 'shanwu_trail',
    bg: 'subpkg_images/market_route_shanwu_trail.jpg',
    rows: [
      [
        makeSceneNode({
          id: 'sw_t0_0', layer: 0, lane: 0, kind: 'freebie', steps: 1,
          sceneId: 'shanwu_trail', title: '篓底一把', templateId: 'shanwu_trail_freebie',
        }),
        makeSceneNode({
          id: 'sw_t0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
          sceneId: 'shanwu_trail', title: '砍柴的', templateId: 'shanwu_woodcutter',
          cardArt: 'subpkg_images/market_card_shanwu_woodcutter.jpg',
          encounter: { type: 'talk', scriptId: 'shanwu_woodcutter' },
        }),
        makeSceneNode({
          id: 'sw_t0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
          sceneId: 'shanwu_trail', title: '收完的摊', templateId: 'shanwu_trail_empty',
        }),
      ],
      [
        makeSceneNode({
          id: 'sw_t1_0', layer: 1, lane: 0, kind: 'deadend', steps: 1,
          sceneId: 'shanwu_trail', title: '竹林断了', templateId: 'shanwu_trail_deadend',
        }),
        makeSceneNode({
          id: 'sw_t1_1', layer: 1, lane: 1, kind: 'branch', steps: 1,
          sceneId: 'shanwu_trail', title: '山洞', templateId: 'shanwu_cave_mouth',
          cardArt: 'subpkg_images/market_card_shanwu_cave.jpg',
          encounter: { type: 'branch', sceneId: 'shanwu_cave' },
        }),
        makeSceneNode({
          id: 'sw_t1_2', layer: 1, lane: 2, kind: 'stall', steps: 1,
          sceneId: 'shanwu_trail', title: '菌摊', templateId: 'shanwu_trail_fungus',
          cardArt: 'subpkg_images/market_card_shanwu_fungus.jpg',
          encounter: { type: 'rummage', specialty: 'fungus' },
        }),
      ],
    ],
  });
  attachScene(ctx, {
    id: 'shanwu_cave',
    bg: 'subpkg_images/market_route_shanwu_cave.jpg',
    rows: [[
      makeSceneNode({
        id: 'sw_c0_0', layer: 0, lane: 0, kind: 'freebie', steps: 1,
        sceneId: 'shanwu_cave', title: '石缝里', templateId: 'shanwu_cave_freebie',
      }),
      makeSceneNode({
        id: 'sw_c0_1', layer: 0, lane: 1, kind: 'gather', steps: 1,
        sceneId: 'shanwu_cave', title: '石壁菌子', templateId: 'shanwu_mushroom_wall',
        cardArt: 'subpkg_images/market_card_shanwu_cave.jpg',
        encounter: {
          type: 'gather',
          pool: ['mushroom', 'wood_ear'],
          picks: 3,
          bg: 'subpkg_images/stall_rummage_shanwu_cave.jpg',
        },
      }),
      makeSceneNode({
        id: 'sw_c0_2', layer: 0, lane: 2, kind: 'deadend', steps: 1,
        sceneId: 'shanwu_cave', title: '塌方了', templateId: 'shanwu_cave_deadend',
      }),
    ]],
  });
}

const heyanDock: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 4, 9, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'branch',
    title: '船坞口',
    templateId: 'heyan_dock_gate',
    cardArt: 'subpkg_images/market_card_heyan_dock.jpg',
    encounter: { type: 'branch', sceneId: 'heyan_dock' },
  });
  attachScene(ctx, {
    id: 'heyan_dock',
    bg: 'subpkg_images/market_route_heyan_dock.jpg',
    rows: [
      [
        makeSceneNode({
          id: 'hy_d0_0', layer: 0, lane: 0, kind: 'freebie', steps: 1,
          sceneId: 'heyan_dock', title: '船板上一把', templateId: 'heyan_dock_freebie',
        }),
        makeSceneNode({
          id: 'hy_d0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
          sceneId: 'heyan_dock', title: '刘伯', templateId: 'heyan_uncle',
          cardArt: 'subpkg_images/market_card_heyan_uncle.jpg',
          encounter: { type: 'talk', scriptId: 'heyan_uncle' },
        }),
        makeSceneNode({
          id: 'hy_d0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
          sceneId: 'heyan_dock', title: '收完的船', templateId: 'heyan_dock_empty',
        }),
      ],
      [
        makeSceneNode({
          id: 'hy_d1_0', layer: 1, lane: 0, kind: 'deadend', steps: 1,
          sceneId: 'heyan_dock', title: '潮退了', templateId: 'heyan_dock_deadend',
        }),
        makeSceneNode({
          id: 'hy_d1_1', layer: 1, lane: 1, kind: 'gather', steps: 1,
          sceneId: 'heyan_dock', title: '水边野菜', templateId: 'heyan_dock_gather',
          cardArt: 'subpkg_images/market_card_heyan_bank.jpg',
          encounter: {
            type: 'gather',
            pool: ['kelp', 'scallion'],
            picks: 3,
            bg: 'subpkg_images/stall_rummage_heyan_bank.jpg',
          },
        }),
        makeSceneNode({
          id: 'hy_d1_2', layer: 1, lane: 2, kind: 'empty', steps: 1,
          sceneId: 'heyan_dock', title: '空埠头', templateId: 'heyan_dock_empty2',
        }),
      ],
    ],
  });
};

const heyanLotus: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 2, 8, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'stall',
    title: '藕摊',
    templateId: 'heyan_lotus',
    cardArt: 'subpkg_images/market_card_heyan_lotus.jpg',
    encounter: { type: 'rummage', specialty: 'lotus' },
  });
};

const heyanUncle: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 2, 7, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'talk',
    title: '刘伯',
    templateId: 'heyan_uncle',
    cardArt: 'subpkg_images/market_card_heyan_uncle.jpg',
    encounter: { type: 'talk', scriptId: 'heyan_uncle' },
  });
};

const heyanBank: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 3, 9, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'gather',
    title: '河滩',
    templateId: 'heyan_bank',
    cardArt: 'subpkg_images/market_card_heyan_bank.jpg',
    encounter: {
      type: 'gather',
      pool: ['kelp', 'scallion'],
      picks: 3,
      bg: 'subpkg_images/stall_rummage_heyan_bank.jpg',
    },
  });
};

const jiangbianPier: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 4, 10, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'branch',
    title: '夜栈',
    templateId: 'jiangbian_pier_gate',
    cardArt: 'subpkg_images/market_card_jiangbian_pier.jpg',
    encounter: { type: 'branch', sceneId: 'jiangbian_pier' },
  });
  attachScene(ctx, {
    id: 'jiangbian_pier',
    bg: 'subpkg_images/market_route_jiangbian_pier.jpg',
    rows: [
      [
        makeSceneNode({
          id: 'jb_p0_0', layer: 0, lane: 0, kind: 'freebie', steps: 1,
          sceneId: 'jiangbian_pier', title: '网兜一把', templateId: 'jiangbian_pier_freebie',
        }),
        makeSceneNode({
          id: 'jb_p0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
          sceneId: 'jiangbian_pier', title: '阿珠', templateId: 'jiangbian_aunt',
          cardArt: 'subpkg_images/market_card_jiangbian_aunt.jpg',
          encounter: { type: 'talk', scriptId: 'jiangbian_aunt' },
        }),
        makeSceneNode({
          id: 'jb_p0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
          sceneId: 'jiangbian_pier', title: '收完的网', templateId: 'jiangbian_pier_empty',
        }),
      ],
      [
        makeSceneNode({
          id: 'jb_p1_0', layer: 1, lane: 0, kind: 'deadend', steps: 1,
          sceneId: 'jiangbian_pier', title: '潮漫上来', templateId: 'jiangbian_pier_deadend',
        }),
        makeSceneNode({
          id: 'jb_p1_1', layer: 1, lane: 1, kind: 'gather', steps: 1,
          sceneId: 'jiangbian_pier', title: '网里漏鱼', templateId: 'jiangbian_pier_gather',
          cardArt: 'subpkg_images/market_card_jiangbian_pier.jpg',
          encounter: {
            type: 'gather',
            pool: ['smallfish', 'kelp', 'clam'],
            picks: 3,
            bg: 'subpkg_images/stall_rummage_jiangbian_pier.jpg',
          },
        }),
        makeSceneNode({
          id: 'jb_p1_2', layer: 1, lane: 2, kind: 'empty', steps: 1,
          sceneId: 'jiangbian_pier', title: '空栈板', templateId: 'jiangbian_pier_empty2',
        }),
      ],
    ],
  });
};

const jiangbianCatch: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 2, 8, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'stall',
    title: '鲜货筐',
    templateId: 'jiangbian_nightcatch',
    cardArt: 'subpkg_images/market_card_jiangbian_nightcatch.jpg',
    encounter: { type: 'rummage', specialty: 'nightcatch' },
  });
};

const jiangbianAunt: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 2, 8, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'talk',
    title: '阿珠',
    templateId: 'jiangbian_aunt',
    cardArt: 'subpkg_images/market_card_jiangbian_aunt.jpg',
    encounter: { type: 'talk', scriptId: 'jiangbian_aunt' },
  });
};

const jiangbianCabin: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 5, 11, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'branch',
    title: '船舱',
    templateId: 'jiangbian_cabin_gate',
    cardArt: 'subpkg_images/market_card_jiangbian_cabin.jpg',
    encounter: { type: 'branch', sceneId: 'jiangbian_cabin' },
  });
  attachScene(ctx, {
    id: 'jiangbian_cabin',
    bg: 'subpkg_images/market_route_jiangbian_cabin.jpg',
    rows: [[
      makeSceneNode({
        id: 'jb_c0_0', layer: 0, lane: 0, kind: 'freebie', steps: 1,
        sceneId: 'jiangbian_cabin', title: '篓底一把', templateId: 'jiangbian_cabin_freebie',
      }),
      makeSceneNode({
        id: 'jb_c0_1', layer: 0, lane: 1, kind: 'stall', steps: 1,
        sceneId: 'jiangbian_cabin', title: '舱里水产', templateId: 'jiangbian_cabin_fish',
        encounter: { type: 'rummage', stall: 'fish' },
      }),
      makeSceneNode({
        id: 'jb_c0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
        sceneId: 'jiangbian_cabin', title: '空舱', templateId: 'jiangbian_cabin_empty',
      }),
    ]],
  });
};

const laochengClerk: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 2, 7, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'talk',
    title: '账房伙计',
    templateId: 'laocheng_clerk',
    cardArt: 'subpkg_images/market_card_laocheng_clerk.jpg',
    encounter: { type: 'talk', scriptId: 'laocheng_clerk' },
  });
};

const laochengGate: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 5, 12, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'gate',
    title: '后厨门',
    templateId: 'laocheng_gate',
    cardArt: 'subpkg_images/market_card_laocheng_gate.jpg',
    encounter: {
      type: 'gate',
      need: 'shop_key',
      pass: { type: 'branch', sceneId: 'laocheng_back' },
    },
  });
  attachScene(ctx, {
    id: 'laocheng_back',
    bg: 'subpkg_images/market_route_laocheng_back.jpg',
    rows: [[
      makeSceneNode({
        id: 'lc_b0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
        sceneId: 'laocheng_back', title: '梁上咸货', templateId: 'laocheng_back_cured',
        cardArt: 'subpkg_images/market_card_laocheng_cured.jpg',
        encounter: { type: 'rummage', specialty: 'cured' },
      }),
      makeSceneNode({
        id: 'lc_b0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
        sceneId: 'laocheng_back', title: '菜行老板', templateId: 'laocheng_boss',
        cardArt: 'subpkg_images/market_card_laocheng_clerk.jpg',
        encounter: { type: 'talk', scriptId: 'laocheng_boss' },
      }),
      makeSceneNode({
        id: 'lc_b0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
        sceneId: 'laocheng_back', title: '空灶台', templateId: 'laocheng_back_empty',
      }),
    ]],
  });
};

const laochengCured: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 3, 10, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'stall',
    title: '梁上咸货',
    templateId: 'laocheng_cured',
    cardArt: 'subpkg_images/market_card_laocheng_cured.jpg',
    encounter: { type: 'rummage', specialty: 'cured' },
  });
};

const laochengAlley: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 4, 11, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'branch',
    title: '青石巷',
    templateId: 'laocheng_alley_gate',
    cardArt: 'subpkg_images/market_card_laocheng_alley.jpg',
    encounter: { type: 'branch', sceneId: 'laocheng_alley' },
  });
  attachScene(ctx, {
    id: 'laocheng_alley',
    bg: 'subpkg_images/market_route_laocheng_alley.jpg',
    rows: [[
      makeSceneNode({
        id: 'lc_a0_0', layer: 0, lane: 0, kind: 'favor', steps: 1,
        sceneId: 'laocheng_alley', title: '巷口熟人', templateId: 'laocheng_alley_favor',
      }),
      makeSceneNode({
        id: 'lc_a0_1', layer: 0, lane: 1, kind: 'freebie', steps: 1,
        sceneId: 'laocheng_alley', title: '台阶一把', templateId: 'laocheng_alley_freebie',
      }),
      makeSceneNode({
        id: 'lc_a0_2', layer: 0, lane: 2, kind: 'talk', steps: 1,
        sceneId: 'laocheng_alley', title: '菜行老板', templateId: 'laocheng_boss',
        cardArt: 'subpkg_images/market_card_laocheng_clerk.jpg',
        encounter: { type: 'talk', scriptId: 'laocheng_boss' },
      }),
    ]],
  });
};

const xiangkoVendor: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 1, 6, false);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'talk',
    title: '收摊老板',
    templateId: 'xiangko_vendor',
    encounter: { type: 'talk', scriptId: 'xiangko_vendor' },
  });
};

const xiangkoStair: BeatFn = (ctx) => {
  const id = pickOverlaySlot(ctx, 1, 6, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'freebie',
    title: '楼道口一把',
    templateId: 'xiangko_stair_freebie',
  });
};

function openBranch(
  ctx: BeatCtx,
  from: number,
  to: number,
  title: string,
  templateId: string,
  sceneId: string,
  bg: string,
  rows: MapNode[][],
): void {
  const id = pickOverlaySlot(ctx, from, to, true);
  if (!id) return;
  overlayCard(ctx, id, {
    kind: 'branch',
    title,
    templateId,
    encounter: { type: 'branch', sceneId },
  });
  attachScene(ctx, { id: sceneId, bg, rows });
}

function applyGuoyuanBeats(ctx: BeatCtx): void {
  openBranch(ctx, 3, 9, '果林小路', 'guoyuan_orchard_gate', 'guoyuan_orchard', 'subpkg_images/market_route_guoyuan_orchard.jpg', [[
    makeSceneNode({
      id: 'gy_o0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'guoyuan_orchard', title: '林边果筐', templateId: 'guoyuan_orchard_fruit',
      stall: 'root', encounter: { type: 'rummage', stall: 'root' },
    }),
    makeSceneNode({
      id: 'gy_o0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
      sceneId: 'guoyuan_orchard', title: '阿桃', templateId: 'guoyuan_tao',
      encounter: { type: 'talk', scriptId: 'guoyuan_tao' },
    }),
    makeSceneNode({
      id: 'gy_o0_2', layer: 0, lane: 2, kind: 'freebie', steps: 1,
      sceneId: 'guoyuan_orchard', title: '树下一把', templateId: 'guoyuan_orchard_freebie',
    }),
  ], [
    makeSceneNode({
      id: 'gy_o1_0', layer: 1, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'guoyuan_orchard', title: '苦瓜架', templateId: 'guoyuan_orchard_bitter',
      stall: 'leaf', encounter: { type: 'rummage', stall: 'leaf' },
    }),
    makeSceneNode({
      id: 'gy_o1_1', layer: 1, lane: 2, kind: 'empty', steps: 1,
      sceneId: 'guoyuan_orchard', title: '空果筐', templateId: 'guoyuan_orchard_empty',
    }),
  ]]);
  openBranch(ctx, 8, 16, '温室棚', 'guoyuan_glass_gate', 'guoyuan_glass', 'subpkg_images/market_route_guoyuan_glass.jpg', [[
    makeSceneNode({
      id: 'gy_g0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'guoyuan_glass', title: '棚里果筐', templateId: 'guoyuan_glass_fruit',
      stall: 'root', encounter: { type: 'rummage', stall: 'root' },
    }),
    makeSceneNode({
      id: 'gy_g0_1', layer: 0, lane: 1, kind: 'favor', steps: 1,
      sceneId: 'guoyuan_glass', title: '阿桃的凳', templateId: 'guoyuan_glass_favor',
    }),
    makeSceneNode({
      id: 'gy_g0_2', layer: 0, lane: 2, kind: 'stall', steps: 1,
      sceneId: 'guoyuan_glass', title: '蛋篓', templateId: 'guoyuan_glass_egg',
      stall: 'egg', encounter: { type: 'rummage', stall: 'egg' },
    }),
  ], [
    makeSceneNode({
      id: 'gy_g1_0', layer: 1, lane: 1, kind: 'freebie', steps: 1,
      sceneId: 'guoyuan_glass', title: '棚角一把', templateId: 'guoyuan_glass_freebie',
    }),
  ]]);
}

function applyTiantouBeats(ctx: BeatCtx): void {
  openBranch(ctx, 3, 9, '田埂小路', 'tiantou_ridge_gate', 'tiantou_ridge', 'subpkg_images/market_route_tiantou_ridge.jpg', [[
    makeSceneNode({
      id: 'tt_r0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'tiantou_ridge', title: '埂上田菜', templateId: 'tiantou_ridge_leaf',
      stall: 'leaf', encounter: { type: 'rummage', stall: 'leaf' },
    }),
    makeSceneNode({
      id: 'tt_r0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
      sceneId: 'tiantou_ridge', title: '老周', templateId: 'tiantou_zhou',
      encounter: { type: 'talk', scriptId: 'tiantou_zhou' },
    }),
    makeSceneNode({
      id: 'tt_r0_2', layer: 0, lane: 2, kind: 'freebie', steps: 1,
      sceneId: 'tiantou_ridge', title: '沟边一把', templateId: 'tiantou_ridge_freebie',
    }),
  ], [
    makeSceneNode({
      id: 'tt_r1_0', layer: 1, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'tiantou_ridge', title: '芦笋捆', templateId: 'tiantou_ridge_asparagus',
      stall: 'leaf', encounter: { type: 'rummage', stall: 'leaf' },
    }),
    makeSceneNode({
      id: 'tt_r1_1', layer: 1, lane: 2, kind: 'empty', steps: 1,
      sceneId: 'tiantou_ridge', title: '空菜筐', templateId: 'tiantou_ridge_empty',
    }),
  ]]);
  openBranch(ctx, 8, 16, '羊圈边', 'tiantou_pen_gate', 'tiantou_pen', 'subpkg_images/market_route_tiantou_pen.jpg', [[
    makeSceneNode({
      id: 'tt_p0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'tiantou_pen', title: '羊肉案', templateId: 'tiantou_pen_meat',
      stall: 'meat', encounter: { type: 'rummage', stall: 'meat' },
    }),
    makeSceneNode({
      id: 'tt_p0_1', layer: 0, lane: 1, kind: 'favor', steps: 1,
      sceneId: 'tiantou_pen', title: '老周的凳', templateId: 'tiantou_pen_favor',
    }),
    makeSceneNode({
      id: 'tt_p0_2', layer: 0, lane: 2, kind: 'empty', steps: 1,
      sceneId: 'tiantou_pen', title: '空草料', templateId: 'tiantou_pen_empty',
    }),
  ], [
    makeSceneNode({
      id: 'tt_p1_0', layer: 1, lane: 1, kind: 'freebie', steps: 1,
      sceneId: 'tiantou_pen', title: '圈边一把', templateId: 'tiantou_pen_freebie',
    }),
  ]]);
}

function applyFutouBeats(ctx: BeatCtx): void {
  openBranch(ctx, 3, 10, '码头栈', 'futou_pier_gate', 'futou_pier', 'subpkg_images/market_route_futou_pier.jpg', [[
    makeSceneNode({
      id: 'ft_p0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'futou_pier', title: '栈上鱼摊', templateId: 'futou_pier_fish',
      stall: 'fish', encounter: { type: 'rummage', stall: 'fish' },
    }),
    makeSceneNode({
      id: 'ft_p0_1', layer: 0, lane: 1, kind: 'talk', steps: 1,
      sceneId: 'futou_pier', title: '阿海', templateId: 'futou_hai',
      encounter: { type: 'talk', scriptId: 'futou_hai' },
    }),
    makeSceneNode({
      id: 'ft_p0_2', layer: 0, lane: 2, kind: 'freebie', steps: 1,
      sceneId: 'futou_pier', title: '跳板一把', templateId: 'futou_pier_freebie',
    }),
  ], [
    makeSceneNode({
      id: 'ft_p1_0', layer: 1, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'futou_pier', title: '冰上鲈鱼', templateId: 'futou_pier_bass',
      stall: 'fish', encounter: { type: 'rummage', stall: 'fish' },
    }),
    makeSceneNode({
      id: 'ft_p1_1', layer: 1, lane: 2, kind: 'empty', steps: 1,
      sceneId: 'futou_pier', title: '空冰床', templateId: 'futou_pier_empty',
    }),
  ]]);
  openBranch(ctx, 9, 18, '果仓', 'futou_store_gate', 'futou_store', 'subpkg_images/market_route_futou_store.jpg', [[
    makeSceneNode({
      id: 'ft_s0_0', layer: 0, lane: 0, kind: 'stall', steps: 1,
      sceneId: 'futou_store', title: '仓里南果', templateId: 'futou_store_fruit',
      stall: 'root', encounter: { type: 'rummage', stall: 'root' },
    }),
    makeSceneNode({
      id: 'ft_s0_1', layer: 0, lane: 1, kind: 'favor', steps: 1,
      sceneId: 'futou_store', title: '阿海的凳', templateId: 'futou_store_favor',
    }),
    makeSceneNode({
      id: 'ft_s0_2', layer: 0, lane: 2, kind: 'stall', steps: 1,
      sceneId: 'futou_store', title: '葱姜篓', templateId: 'futou_store_egg',
      stall: 'egg', encounter: { type: 'rummage', stall: 'egg' },
    }),
  ], [
    makeSceneNode({
      id: 'ft_s1_0', layer: 1, lane: 1, kind: 'freebie', steps: 1,
      sceneId: 'futou_store', title: '仓角一把', templateId: 'futou_store_freebie',
    }),
  ]]);
}

export function applyMarketBeats(
  marketId: MarketId,
  nodes: Record<string, MapNode>,
  layers: string[][],
  scenes: Record<string, RouteScene>,
  rng: Rng,
): void {
  const ctx: BeatCtx = { nodes, layers, scenes, rng, used: new Set() };
  if (marketId === 'shanwu') {
    applyShanwuBeats(ctx);
    return;
  }
  if (marketId === 'xiangko') {
    applyPicked(ctx, [xiangkoVendor, xiangkoStair], 1);
    return;
  }
  if (marketId === 'heyan') {
    applyPicked(ctx, [heyanDock, heyanUncle, heyanBank], rngInt(ctx.rng, 2, 3));
    return;
  }
  if (marketId === 'jiangbian') {
    applyPicked(ctx, [jiangbianPier, jiangbianCatch, jiangbianAunt, jiangbianCabin], rngInt(ctx.rng, 2, 3));
    return;
  }
  if (marketId === 'nanshi') {
    applyPicked(ctx, [xiangkoVendor, xiangkoStair], 1);
    return;
  }
  if (marketId === 'laocheng') {
    applyPicked(ctx, [laochengClerk, laochengGate, laochengCured, laochengAlley], rngInt(ctx.rng, 2, 3));
    return;
  }
  if (marketId === 'dukou') {
    applyPicked(ctx, [jiangbianPier, jiangbianCatch, jiangbianAunt], rngInt(ctx.rng, 1, 2));
    return;
  }
  if (marketId === 'shanzhen') {
    applyPicked(ctx, [laochengClerk, laochengCured], 1);
    const treasureId = pickOverlaySlot(ctx, 2, 7, false);
    if (treasureId) {
      overlayCard(ctx, treasureId, {
        kind: 'stall',
        title: '山珍筐',
        templateId: 'shanzhen_treasure',
        encounter: { type: 'rummage', specialty: 'treasure' },
      });
    }
    return;
  }
  if (marketId === 'guoyuan') {
    applyGuoyuanBeats(ctx);
    return;
  }
  if (marketId === 'tiantou') {
    applyTiantouBeats(ctx);
    return;
  }
  if (marketId === 'futou') {
    applyFutouBeats(ctx);
  }
}
