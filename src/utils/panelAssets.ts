/**
 * 菜单打开时再加载：先出空壳，贴图到了再刷最新内容。
 */
import {
  DEX_FOOD_CATS,
  DEX_STAMP_SETS,
  dishGroupCatIcon,
  dishGroups,
  dishesInGroup,
  foodsInCat,
  fridgeKind,
  neighborNpc,
  recipeNeeds,
  recipeUnlockView,
  unlockedRecipes,
  type DexFoodCat,
  type DexTab,
  type FridgeItem,
  type KitchenSave,
  type NeighborOrder,
  type RecipeId,
} from '@/sim';
import { sceneArtPaths } from '@/gameobjects/ui/scenePanel';
import { HUD_ICON, P0_ART, UI_KIT, uiBarPaths } from '@/utils/ui';
import { imgPath, resolveDishAssetPath, resolveItemAssetPath } from '@/utils/assets';

const SCENE_SHARED = [
  ...sceneArtPaths(),
  ...uiBarPaths(),
  UI_KIT.closeRound,
  UI_KIT.btnOlive,
  UI_KIT.btnGold,
] as const;

export const PANEL_SHELL = {
  dex: [
    'subpkg_images/scene_dex_book.png',
    'subpkg_images/scene_dex_tab.png',
    'subpkg_images/scene_dex_photo.png',
    'subpkg_images/scene_dex_spot.png',
    'subpkg_images/scene_dex_washi.png',
    'subpkg_images/scene_club_note.png',
    P0_ART.dexStamp,
    ...P0_ART.spoons,
    ...SCENE_SHARED,
  ],
  fridge: [
    'subpkg_images/scene_dex_tab.png',
    'subpkg_images/scene_fridge_tray.png',
    'subpkg_kitchen/ui_fridge_panel.png',
    'subpkg_kitchen/ui_fridge_btn_terracotta.png',
    'subpkg_kitchen/ui_fridge_btn_cream.png',
    'subpkg_kitchen/ui_fridge_btn_wood.png',
    ...SCENE_SHARED,
  ],
  cook: [
    'subpkg_images/scene_pk_cellar_wall.png',
    'subpkg_kitchen/ui_cook_btn.png',
    'subpkg_kitchen/ui_fridge_btn_terracotta.png',
    'subpkg_kitchen/ui_fridge_btn_cream.png',
    P0_ART.chefFire,
    P0_ART.adClapper,
    ...P0_ART.spoons,
    ...SCENE_SHARED,
  ],
  basket: [
    'subpkg_kitchen/ui_basket_panel.png',
    'subpkg_images/scene_dex_washi.png',
    ...SCENE_SHARED,
  ],
  gameClub: [
    'subpkg_images/scene_club_board.png',
    'subpkg_images/scene_club_note.png',
    'subpkg_images/scene_club_basket.png',
    HUD_ICON.coin,
    HUD_ICON.ticket,
    ...SCENE_SHARED,
  ],
  gacha: [
    'subpkg_images/scene_gacha_wall.png',
    'subpkg_images/scene_gacha_cushion.png',
    'subpkg_images/hud_gacha_box.png',
    P0_ART.gachaStage,
    P0_ART.adClapper,
    HUD_ICON.ticket,
    ...SCENE_SHARED,
  ],
  strayCat: [
    'subpkg_images/scene_cat_nook_wall.png',
    'subpkg_images/scene_cat_mat.png',
    'subpkg_images/scene_cat_bowl.png',
    'subpkg_images/scene_cat_bubble.png',
    'subpkg_images/scene_cat_heart_tag.png',
    'subpkg_images/scene_cat_paw.png',
    ...SCENE_SHARED,
  ],
} as const;

export function itemIconPath(id: string, rotten = false): string {
  if (id.startsWith('dex_cat_')) return imgPath(`${id}.png`);
  return resolveItemAssetPath(id, rotten);
}

export function dishIconPath(id: string): string {
  return resolveDishAssetPath(id);
}

export function dexViewPaths(
  save: KitchenSave,
  view: { kind: 'home'; tab: DexTab } | { kind: 'food'; cat: string } | { kind: 'dish'; group: string },
): string[] {
  const paths: string[] = [...PANEL_SHELL.dex];
  if (view.kind === 'home') {
    if (view.tab === 'food') {
      for (const cat of DEX_FOOD_CATS) paths.push(itemIconPath(cat.icon));
    } else if (view.tab === 'dish') {
      for (const group of dishGroups()) paths.push(itemIconPath(dishGroupCatIcon(group)));
    } else {
      paths.push(HUD_ICON.coin, HUD_ICON.ticket);
      for (const setDef of DEX_STAMP_SETS) {
        for (const m of setDef.members) {
          paths.push(m.kind === 'food' ? itemIconPath(m.id) : dishIconPath(m.id));
        }
      }
    }
    return [...new Set(paths)];
  }
  if (view.kind === 'food') {
    for (const it of foodsInCat(view.cat as DexFoodCat)) {
      paths.push(itemIconPath(it.id));
    }
    return [...new Set(paths)];
  }
  for (const it of dishesInGroup(view.group, save.recipesFound)) {
    paths.push(dishIconPath(it.id));
  }
  return [...new Set(paths)];
}

export function fridgeItemPath(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') return dishIconPath(it.defId);
  return itemIconPath(it.defId, it.quality === 'rotten');
}

export function fridgePanelPaths(save: KitchenSave): string[] {
  return [...new Set([...PANEL_SHELL.fridge, ...save.fridge.map(fridgeItemPath)])];
}

export function cookPanelPaths(save: KitchenSave, pick: RecipeId): string[] {
  const view = recipeUnlockView(save);
  const known = unlockedRecipes(view);
  const recipe = known.find((r) => r.id === pick) ?? known[0];
  const paths: string[] = [...PANEL_SHELL.cook];
  if (!recipe) return [...new Set(paths)];
  paths.push(dishIconPath(recipe.id));
  for (const need of recipeNeeds(view, recipe.id)) {
    paths.push(itemIconPath(need.iconId));
  }
  return [...new Set(paths)];
}

export function basketPanelPaths(defIds: string[]): string[] {
  return [...new Set([...PANEL_SHELL.basket, ...defIds.map((id) => itemIconPath(id))])];
}

const DAILY_MENU_SHELL = [
  'subpkg_images/scene_menu_wall.png',
  'subpkg_kitchen/ui_daily_menu_title.png',
  'subpkg_kitchen/ui_daily_done_stamp.png',
  'subpkg_kitchen/ui_daily_clear_banner.png',
  'subpkg_images/ui_menu_ticket.png',
  HUD_ICON.coin,
  ...SCENE_SHARED,
] as const;

export function dailyMenuPanelPaths(save: KitchenSave): string[] {
  const paths: string[] = [...DAILY_MENU_SHELL, P0_ART.adClapper];
  const menu = save.dailyMenu;
  if (!menu) return [...new Set(paths)];
  const view = recipeUnlockView(save);
  for (const line of menu.lines) {
    paths.push(dishIconPath(line.recipeId));
    for (const need of recipeNeeds(view, line.recipeId)) {
      paths.push(itemIconPath(need.iconId));
    }
    if (line.food?.defId) paths.push(itemIconPath(line.food.defId));
  }
  return [...new Set(paths)];
}

export function orderPanelPaths(save: KitchenSave, orders: readonly NeighborOrder[]): string[] {
  const paths: string[] = [
    'subpkg_images/scene_order_wall.png',
    'subpkg_images/scene_order_slip.png',
    'subpkg_images/scene_order_photo.png',
    HUD_ICON.coin,
    P0_ART.adClapper,
    ...SCENE_SHARED,
  ];
  const view = recipeUnlockView(save);
  for (const order of orders) {
    paths.push(neighborNpc(order.npcId).portrait);
    paths.push(dishIconPath(order.recipeId));
    for (const need of recipeNeeds(view, order.recipeId)) {
      paths.push(itemIconPath(need.iconId));
    }
    if (order.reward?.food?.defId) paths.push(itemIconPath(order.reward.food.defId));
  }
  return [...new Set(paths)];
}
