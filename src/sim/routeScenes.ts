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

const SCENES: Partial<Record<MarketId, Record<string, RouteSceneDef>>> = {
  shanwu: {
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
  },
  heyan: {
    main: {
      id: 'main',
      title: '河沿早市',
      bg: MARKET_ART.heyan.routeBg,
      enterNote: '回到河沿大路。',
    },
    heyan_dock: {
      id: 'heyan_dock',
      title: '船坞',
      bg: 'subpkg_images/market_route_heyan_dock.jpg',
      enterNote: '下到河埠，缆绳还湿着。',
    },
  },
  jiangbian: {
    main: {
      id: 'main',
      title: '江边渔市',
      bg: MARKET_ART.jiangbian.routeBg,
      enterNote: '回到江边灯笼底下。',
    },
    jiangbian_pier: {
      id: 'jiangbian_pier',
      title: '夜栈',
      bg: 'subpkg_images/market_route_jiangbian_pier.jpg',
      enterNote: '栈板吱呀一声，潮气扑上来。',
    },
    jiangbian_cabin: {
      id: 'jiangbian_cabin',
      title: '船舱',
      bg: 'subpkg_images/market_route_jiangbian_cabin.jpg',
      enterNote: '钻进舱，鱼腥比灯还先到。',
    },
  },
  laocheng: {
    main: {
      id: 'main',
      title: '老城菜行',
      bg: MARKET_ART.laocheng.routeBg,
      enterNote: '回到青石大厅。',
    },
    laocheng_back: {
      id: 'laocheng_back',
      title: '后厨',
      bg: 'subpkg_images/market_route_laocheng_back.jpg',
      enterNote: '钥匙对上了。梁上还挂着咸货。',
    },
    laocheng_alley: {
      id: 'laocheng_alley',
      title: '青石巷',
      bg: 'subpkg_images/market_route_laocheng_alley.jpg',
      enterNote: '拐进一条更窄的青石巷。',
    },
  },
};

export function sceneDef(marketId: MarketId, sceneId: string): RouteSceneDef {
  const hit = SCENES[marketId]?.[sceneId];
  if (hit) return hit;
  return {
    id: sceneId,
    title: '',
    bg: MARKET_ART[marketId].routeBg,
    enterNote: sceneId === 'main' ? '' : '路拐进另一边。',
  };
}

export function sceneBg(marketId: MarketId, sceneId: string): string {
  return sceneDef(marketId, sceneId).bg;
}

export function sceneTitle(marketId: MarketId, sceneId: string): string {
  return sceneDef(marketId, sceneId).title;
}
