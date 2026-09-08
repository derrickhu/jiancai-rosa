import { FURN_IDS, furnLevel, houseLevel, houseRoomCandidates, type KitchenSave } from '@/sim';
import { HUD_ICON } from '@/utils/ui';
import { OUTING_CURTAIN } from '@/utils/outingAssets';
import { BOOT_BG, BOOT_FISH, BOOT_TITLE } from '@/scenes/LoadingScene';

/** 厨房首屏立刻看见的图：房间、家具、顶栏、教程角色。 */
export function kitchenBootPaths(save: KitchenSave): string[] {
  const house = houseLevel(save);
  const paths = [
    BOOT_BG,
    BOOT_TITLE,
    BOOT_FISH,
    ...houseRoomCandidates(house),
    HUD_ICON.coin,
    HUD_ICON.stamina,
    HUD_ICON.dex,
    HUD_ICON.gameClub,
    HUD_ICON.player,
    HUD_ICON.fridge,
    HUD_ICON.basket,
    'subpkg_kitchen/ui_kitchen_slip.png',
    'subpkg_kitchen/ui_recipe_paper.png',
    'subpkg_kitchen/ui_cook_level_title.png',
    'subpkg_kitchen/tutorial_hand.png',
    'subpkg_kitchen/tutorial_cabbage.png',
    OUTING_CURTAIN,
  ];
  for (const id of FURN_IDS) {
    const lv = furnLevel(save, id);
    paths.push(`subpkg_kitchen/kitchen_${id}_${lv}.png`);
    if (lv > 0) paths.push(`subpkg_kitchen/kitchen_${id}_0.png`);
  }
  return [...new Set(paths)];
}

/** 没齐就不能关 loading：房间、当前家具、顶栏图标。 */
export function kitchenCriticalPaths(save: KitchenSave): string[] {
  const house = houseLevel(save);
  const paths = [
    ...houseRoomCandidates(house),
    HUD_ICON.coin,
    HUD_ICON.stamina,
    HUD_ICON.dex,
    HUD_ICON.gameClub,
    HUD_ICON.player,
  ];
  for (const id of FURN_IDS) {
    paths.push(`subpkg_kitchen/kitchen_${id}_${furnLevel(save, id)}.png`);
  }
  return [...new Set(paths)];
}
