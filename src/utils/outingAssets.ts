import { MARKETS, MARKET_ART, SPECIAL_MARKETS, VEHICLES, getSpecialMarket, specialBootItems, sceneBg, type MarketId, type RunState, type SpecialMarketId } from '@/sim';
import { CARD_FRAME } from '@/gameobjects/market/MapView';
import { HUD_ICON, UI_BTN } from '@/utils/ui';

/** 出门过场整图。厨房启动时预载，点门不用再等一堆菜图。 */
export const OUTING_CURTAIN = 'subpkg_images/outing_curtain.jpg';

/** 挑完回家领奖壳，进菜场时预载，收摊不用再等贴图。 */
export const RESULT_UI = [
  'subpkg_kitchen/ui_result_panel.png',
  'subpkg_kitchen/ui_result_burst.png',
  'subpkg_kitchen/ui_result_title_safe.png',
  'subpkg_kitchen/ui_result_title_messy.png',
] as const;

/** 选点页开门后立刻要用的图。 */
export function destinationBootPaths(): string[] {
  return [
    'subpkg_images/dest_street_bg.jpg',
    HUD_ICON.destBanner,
    HUD_ICON.home,
    HUD_ICON.stamina,
    HUD_ICON.fridge,
    UI_BTN.terracotta,
    UI_BTN.cream,
    UI_BTN.wood,
    ...MARKETS.map((m) => m.thumb),
    ...SPECIAL_MARKETS.map((m) => m.thumb),
    ...VEHICLES.map((v) => v.art),
  ];
}

export function specialBootPaths(id: SpecialMarketId): string[] {
  const def = getSpecialMarket(id);
  return [...new Set([
    def.bg,
    def.thumb,
    ...RESULT_UI,
    ...specialBootItems(def).map((itemId) => `subpkg_images/${itemId}.png`),
  ])];
}

/** 进某个菜场路线页立刻要用的图。只算场景，不算厨房里已经有的顶栏。 */
export function marketBootPaths(marketId: MarketId, run?: RunState): string[] {
  const art = MARKET_ART[marketId];
  const paths = [
    sceneBg(marketId, run?.sceneId ?? 'main'),
    art.routeBg,
    art.cardAtlas,
    art.meatCard,
    CARD_FRAME,
    ...RESULT_UI,
  ];
  if (run) {
    Object.values(run.map.scenes).forEach((scene) => {
      if (scene.bg) paths.push(scene.bg);
    });
    Object.values(run.map.nodes).forEach((node) => {
      if (node.cardArt) paths.push(node.cardArt);
    });
  }
  return [...new Set(paths.filter((path): path is string => !!path))];
}
