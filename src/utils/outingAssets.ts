import { MARKETS, MARKET_ART, VEHICLES, sceneBg, type MarketId, type RunState } from '@/sim';
import { CARD_FRAME } from '@/gameobjects/market/MapView';
import { HUD_ICON, UI_BTN } from '@/utils/ui';

/** 出门过场整图。厨房启动时预载，点门不用再等一堆菜图。 */
export const OUTING_CURTAIN = 'subpkg_images/outing_curtain.jpg';

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
    ...VEHICLES.map((v) => v.art),
  ];
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
