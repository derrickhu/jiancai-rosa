import type { MarketId } from './destinations';
import type { Quality, StallId } from './items';
import type { CardKind } from './marketEvents';
import type { MapNode, MarketMap } from './marketMap';
import type { MinigameId } from './minigames';
import { remainingMarketRecipes, recipeById, type RecipeId } from './recipes';
import type { Rng } from './rng';
import { rngPick } from './rng';
import { sceneDef } from './routeScenes';
import { getSpecialty } from './specialties';
import { talkScript } from './talkScripts';
import type { RunEventLog, RunState } from './run';

export type RunItemId = string;

export type Encounter =
  | { type: 'rummage'; stall?: StallId; specialty?: string }
  | { type: 'talk'; scriptId: string }
  | { type: 'gather'; pool: string[]; picks: number }
  | { type: 'branch'; sceneId: string }
  | { type: 'gate'; need: RunItemId }
  | { type: 'minigame'; game: MinigameId }
  | { type: 'peek' }
  | { type: 'favor' }
  | { type: 'deadend' }
  | { type: 'recipe' }
  | { type: 'freebie' };

export function encounterFromKind(node: MapNode): Encounter {
  if (node.stall) return { type: 'rummage', stall: node.stall };
  switch (node.kind) {
    case 'paystall':
    case 'stall':
      return { type: 'rummage', stall: node.stall };
    case 'empty':
    case 'fork':
    case 'deep':
      return { type: 'peek' };
    case 'talk':
      return { type: 'talk', scriptId: node.templateId ?? '' };
    case 'gather':
      return { type: 'gather', pool: ['mushroom', 'wood_ear', 'matsutake'], picks: 3 };
    case 'branch':
      return { type: 'branch', sceneId: 'main' };
    default:
      return { type: node.kind };
  }
}

export function nodeEncounter(node: MapNode): Encounter {
  return node.encounter ?? encounterFromKind(node);
}

export function isRummageNode(node: MapNode): boolean {
  return nodeEncounter(node).type === 'rummage';
}

export function mapRummageNodes(map: MarketMap): MapNode[] {
  return Object.values(map.nodes).filter(isRummageNode);
}

export interface EncounterCtx {
  rng: Rng;
  state: RunState;
  node: MapNode;
  cookLevel: number;
  recipesFound: RecipeId[];
  findRecipe: (id: RecipeId) => void;
  voice: (kind: CardKind) => string;
}

export interface EncounterResult {
  state: RunState;
  enter?: 'rummage' | 'play';
  food?: { defId: string; quality: Quality };
}

function log(
  node: MapNode,
  marketId: MarketId,
  text: string,
  extra: Partial<RunEventLog> = {},
): RunEventLog {
  return {
    nodeId: node.id,
    kind: node.kind,
    marketId,
    text,
    gain: extra.gain ?? null,
    ...extra,
  };
}

export function applyEncounter(ctx: EncounterCtx): EncounterResult {
  const { state, node, rng } = ctx;
  const enc = nodeEncounter(node);

  switch (enc.type) {
    case 'rummage':
      return { state, enter: 'rummage' };
    case 'freebie':
      return { state };
    case 'deadend':
      return {
        state: {
          ...state,
          note: '死胡同，天色白耗了一步。',
          lastEvent: log(node, state.marketId, ctx.voice('deadend')),
        },
      };
    case 'peek':
      return {
        state: {
          ...state,
          peeked: [...state.peeked, ...node.next],
          note: node.next.length ? '摊上收干净了，倒是看清了前面的路。' : '摊上收干净了，前面没路了。',
          lastEvent: log(node, state.marketId, ctx.voice('empty')),
        },
      };
    case 'favor':
      return {
        state: {
          ...state,
          freePass: true,
          note: '街坊打了招呼，下一摊白翻，老板还慢慢收。',
          lastEvent: log(node, state.marketId, ctx.voice('favor')),
        },
      };
    case 'recipe': {
      if (state.flags.includes('got_recipe')) {
        return {
          state: {
            ...state,
            note: '纸上的字看不清了。',
            lastEvent: log(node, state.marketId, '油纸湿透了，字认不出来。'),
          },
        };
      }
      const left = remainingMarketRecipes(state.marketId, ctx.recipesFound);
      const id = left.length ? rngPick(rng, left) : null;
      if (!id) {
        return {
          state: {
            ...state,
            note: '纸上的字看不清了。',
            lastEvent: log(node, state.marketId, '油纸湿透了，字认不出来。'),
          },
        };
      }
      ctx.findRecipe(id);
      const name = recipeById(id)?.name ?? '一道菜';
      return {
        state: {
          ...state,
          flags: state.flags.includes('got_recipe') ? state.flags : [...state.flags, 'got_recipe'],
          note: `记下了「${name}」。`,
          lastEvent: log(node, state.marketId, `${ctx.voice('recipe')}\n记下了：${name}`),
        },
      };
    }
    case 'talk': {
      const script = talkScript(enc.scriptId);
      if (!script) return { state };
      return {
        state: {
          ...state,
          note: `${script.speaker}拦在路边。`,
          lastEvent: log(node, state.marketId, script.text, {
            scriptId: script.id,
            speaker: script.speaker,
            portrait: script.portrait,
            choices: script.choices.map((c) => ({ label: c.label, steps: c.steps })),
          }),
        },
      };
    }
    case 'gather':
      return {
        state: {
          ...state,
          note: '石壁上的菌还在长。',
        },
        enter: 'play',
      };
    case 'branch': {
      const scene = state.map.scenes[enc.sceneId];
      const def = sceneDef(state.marketId, enc.sceneId);
      const first = scene?.layers[0] ?? [];
      return {
        state: {
          ...state,
          sceneId: enc.sceneId,
          options: first.slice(),
          returnStack: [...state.returnStack, { sceneId: state.sceneId, options: node.next.slice() }],
          flags: state.flags.includes(`scene:${enc.sceneId}`)
            ? state.flags
            : [...state.flags, `scene:${enc.sceneId}`],
          note: def.enterNote || '路拐进另一边。',
        },
      };
    }
    case 'gate': {
      const have = state.bag.some((it) => it.id === enc.need && it.qty > 0);
      if (!have) {
        return {
          state: {
            ...state,
            note: '门锁着。',
            lastEvent: log(node, state.marketId, '门锁着。身上没有能开它的东西。'),
          },
        };
      }
      return {
        state: {
          ...state,
          note: '门开了。',
          lastEvent: log(node, state.marketId, '钥匙对上了。门里还有货。'),
        },
      };
    }
    case 'minigame':
      return { state, enter: 'play' };
    default:
      return { state };
  }
}

export function resumeScenes(state: RunState): RunState {
  let next = state;
  while (next.options.length === 0 && next.returnStack.length) {
    const top = next.returnStack[next.returnStack.length - 1];
    const def = sceneDef(next.marketId, top.sceneId);
    next = {
      ...next,
      sceneId: top.sceneId,
      options: top.options,
      returnStack: next.returnStack.slice(0, -1),
      note: top.options.length ? (def.enterNote || '绕回大路了。') : next.note,
    };
  }
  return next;
}

export function rummageTitle(node: MapNode): string | null {
  const enc = nodeEncounter(node);
  if (enc.type !== 'rummage') return null;
  if (enc.specialty) return getSpecialty(enc.specialty)?.name ?? '专属摊';
  return null;
}
