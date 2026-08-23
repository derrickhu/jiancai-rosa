import type { MarketId } from './destinations';
import { MARKET_ART } from './marketEvents';

export interface SceneResume {
  sceneId: string;
  options: string[];
}

export interface RouteSceneDef {
  id: string;
  title: string;
  bg: string;
  enterNote: string;
}

const SHANWU_SCENES: Record<string, RouteSceneDef> = {
  main: {
    id: 'main',
    title: '山坞早集',
    bg: MARKET_ART.shanwu.routeBg,
    enterNote: '回到石阶大路。',
  },
  shanwu_trail: {
    id: 'shanwu_trail',
    title: '林间小路',
    bg: 'subpkg_images/market_route_shanwu_trail.jpg',
    enterNote: '杂草里踩出一条更窄的路。',
  },
  shanwu_cave: {
    id: 'shanwu_cave',
    title: '山洞',
    bg: 'subpkg_images/market_route_shanwu_cave.jpg',
    enterNote: '洞口潮气扑出来，石壁上全是菌。',
  },
};

export function sceneDef(marketId: MarketId, sceneId: string): RouteSceneDef {
  if (marketId === 'shanwu' && SHANWU_SCENES[sceneId]) return SHANWU_SCENES[sceneId];
  return {
    id: sceneId,
    title: '',
    bg: MARKET_ART[marketId].routeBg,
    enterNote: '',
  };
}

export function sceneBg(marketId: MarketId, sceneId: string): string {
  const path = sceneDef(marketId, sceneId).bg;
  return path;
}

export function sceneTitle(marketId: MarketId, sceneId: string): string {
  return sceneDef(marketId, sceneId).title;
}
