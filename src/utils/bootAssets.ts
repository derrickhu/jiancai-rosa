import { FURN_IDS, furnLevel, houseLevel, houseRoomCandidates, type KitchenSave } from '@/sim';
import { OUTING_CURTAIN } from '@/utils/outingAssets';

/** 厨房首屏会立刻画出来的图：空屋、当前家具、顶栏。 */
export function kitchenBootPaths(save: KitchenSave): string[] {
  const house = houseLevel(save);
  const paths = [
    ...houseRoomCandidates(house),
    'subpkg_images/hud_coin.png',
    'subpkg_images/hud_stamina.png',
    'subpkg_images/hud_dex.png',
    'subpkg_kitchen/ui_recipe_paper.png',
    'subpkg_kitchen/ui_cook_level_title.png',
    'subpkg_kitchen/ui_result_burst.png',
    'subpkg_kitchen/ui_result_card.png',
    OUTING_CURTAIN,
  ];
  for (const id of FURN_IDS) {
    const lv = furnLevel(save, id);
    paths.push(`subpkg_kitchen/kitchen_${id}_${lv}.png`);
  }
  return paths;
}
