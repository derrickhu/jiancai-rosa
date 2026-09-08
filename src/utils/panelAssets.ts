/**
 * 菜单打开时再加载：先出空壳，贴图到了再刷最新内容。
 */
import {
  DEX_FOOD_CATS,
  dishGroupCatIcon,
  dishGroups,
  dishesInGroup,
  foodsInCat,
  fridgeKind,
  recipeNeeds,
  recipeUnlockView,
  unlockedRecipes,
  type DexFoodCat,
  type FridgeItem,
  type KitchenSave,
  type RecipeId,
} from '@/sim';
import { HUD_ICON } from '@/utils/ui';
import { imgPath } from '@/utils/assets';

export const PANEL_SHELL = {
  dex: ['subpkg_kitchen/ui_dex_panel.png'],
  fridge: [
    'subpkg_kitchen/ui_fridge_panel.png',
    'subpkg_kitchen/ui_fridge_btn_terracotta.png',
    'subpkg_kitchen/ui_fridge_btn_cream.png',
    'subpkg_kitchen/ui_fridge_btn_wood.png',
  ],
  cook: [
    'subpkg_kitchen/ui_cook_panel.png',
    'subpkg_kitchen/ui_cook_btn.png',
    'subpkg_kitchen/ui_fridge_btn_terracotta.png',
    'subpkg_kitchen/ui_fridge_btn_cream.png',
  ],
  basket: ['subpkg_kitchen/ui_basket_panel.png'],
  gameClub: ['subpkg_kitchen/ui_gameclub_panel.png', HUD_ICON.coin],
} as const;

export function itemIconPath(id: string, rotten = false): string {
  return imgPath(`${id}${rotten ? '_rotten' : ''}.png`);
}

export function dishIconPath(id: string): string {
  return imgPath(`dish_${id}.png`);
}

export function dexViewPaths(save: KitchenSave, view: { kind: 'home'; tab: 'food' | 'dish' } | { kind: 'food'; cat: string } | { kind: 'dish'; group: string }): string[] {
  const paths = [...PANEL_SHELL.dex];
  if (view.kind === 'home') {
    if (view.tab === 'food') {
      for (const cat of DEX_FOOD_CATS) paths.push(itemIconPath(cat.icon));
    } else {
      for (const group of dishGroups()) paths.push(itemIconPath(dishGroupCatIcon(group)));
    }
    return paths;
  }
  if (view.kind === 'food') {
    for (const it of foodsInCat(view.cat as DexFoodCat)) {
      paths.push(itemIconPath(it.id));
    }
    return paths;
  }
  for (const it of dishesInGroup(view.group)) {
    paths.push(dishIconPath(it.id));
  }
  void save;
  return paths;
}

export function fridgeItemPath(it: FridgeItem): string {
  if (fridgeKind(it) === 'dish') return dishIconPath(it.defId);
  return itemIconPath(it.defId, it.quality === 'rotten');
}

export function fridgePanelPaths(save: KitchenSave): string[] {
  return [...PANEL_SHELL.fridge, ...save.fridge.map(fridgeItemPath)];
}

export function cookPanelPaths(save: KitchenSave, pick: RecipeId): string[] {
  const view = recipeUnlockView(save);
  const known = unlockedRecipes(view);
  const recipe = known.find((r) => r.id === pick) ?? known[0];
  const paths = [...PANEL_SHELL.cook];
  if (!recipe) return paths;
  paths.push(dishIconPath(recipe.id));
  for (const need of recipeNeeds(view, recipe.id)) {
    paths.push(itemIconPath(need.iconId));
  }
  return paths;
}

export function basketPanelPaths(defIds: string[]): string[] {
  return [...PANEL_SHELL.basket, ...defIds.map((id) => itemIconPath(id))];
}
