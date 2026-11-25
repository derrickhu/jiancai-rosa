import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { destroyDisplayChildren, destroyDisplayNode } from '@/utils/destroy';
import { TUTORIAL_DENY } from '@/config/TutorialCopy';
import { KitchenManager } from '@/managers/KitchenManager';
import { SaveManager } from '@/managers/SaveManager';
import {
  FRIDGE_STACK,
  MARKETS,
  PICKLE_ITEM_IDS,
  fridgeCap,
  fridgeItemName,
  fridgeItemQty,
  fridgeItemUnitPrice,
  fridgeKind,
  fridgeQtySum,
  getItem,
  itemRarity,
  kitchenBuffLine,
  liveNeighborOrders,
  marketFoodIds,
  putIntoFridge,
  rarityRank,
  recipeById,
  recipeRarity,
  recipeUnlockView,
  resolveRarityTier,
  unlockedRecipes,
  type FridgeItem,
  type FridgeKind,
  type KitchenSave,
  type Rarity,
  type RarityTier,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  UI_BTN,
  UI_KIT,
  UI_PALETTE,
  attachSpriteContour,
  bindUiClick,
  fitTextWidth,
  makeCoinButton,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import { PANEL_SHELL } from '@/utils/panelAssets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawSceneClose,
  drawStretchSheet,
  makeRaritySeal,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';
import { inspectFromFridge, makeItemInspectCard } from './ItemInspectCard';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

const ART = {
  cabinet: 'subpkg_kitchen/ui_fridge_panel.png',
  tab: 'subpkg_images/scene_dex_tab.png',
  tray: 'subpkg_images/scene_fridge_tray.png',
} as const;

const W = 720;
const PANEL_H = 1152;

const L = {
  tabY: 136,
  cavityX: 60,
  cavityTop: 240,
  cavityW: 594,
  cavityH: 524,
  cols: 4,
  shelfRowH: 166,
  sheetTop: 772,
  sheetX: 36,
  sheetH: 322,
  padX: 62,
} as const;

const FRIDGE_INK = {
  cabinetLine: 0x3D1E0A,
  creamShell: 0xFBF0D6,
  mintLiner: 0x93C8AB,
  deepInk: 0x1D2E27,
  domeInk: 0x24180E,
  mintAccent: 0x266350,
  creamHalo: 0xFFFDF8,
  selectedInk: 0x8F4A04,
  selectedHalo: 0xFFF4B8,
} as const;

type FridgeSortMode = 'default' | 'most' | 'least';

function fridgeSlotRarity(it: FridgeItem): Rarity {
  return fridgeKind(it) === 'dish' ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId);
}

function fridgeSlotVisualTier(it: FridgeItem): RarityTier {
  const base = fridgeSlotRarity(it);
  return fridgeKind(it) === 'food' ? resolveRarityTier(base, it.quality) : base;
}

interface SurplusEntry {
  kind: FridgeKind;
  defId: string;
  name: string;
  repItem: FridgeItem;
  totalQty: number;
  urgentKeep: number;
  sellableQty: number;
  unitPrice: number;
  sellableGold: number;
  hint: string;
}

interface ShortageEntry {
  defId: string;
  name: string;
  have: number;
  urgentNeed: number;
  reason: string;
  marketHint: string;
  urgent: boolean;
}

interface FridgeInventorySnapshot {
  foodTotals: Map<string, number>;
  dishTotals: Map<RecipeId, number>;
  urgentDishNeed: Map<RecipeId, { need: number; dishName: string }>;
  urgentFoodNeed: Map<string, { need: number; dishNames: string[] }>;
  rottenSlots: FridgeItem[];
  rottenQty: number;
  surplusList: SurplusEntry[];
  shortageList: ShortageEntry[];
}

function findFoodSourceLabel(defId: string, level: number): string {
  if (PICKLE_ITEM_IDS.has(defId)) return '老坛腌制';
  if (defId === 'chicken_wing') return '街坊/抽谱';
  const unlockedHits = MARKETS.filter((m) => m.unlockLevel <= level && marketFoodIds(m.id).includes(defId));
  if (unlockedHits.length > 0) {
    return unlockedHits.slice(0, 2).map((m) => m.name.replace(/菜场$/, '')).join('/');
  }
  const lockedHit = MARKETS.find((m) => m.unlockLevel > level && marketFoodIds(m.id).includes(defId));
  if (lockedHit) return `${lockedHit.name.replace(/菜场$/, '')}(待开)`;
  return '赶集寻觅';
}

function buildInventorySnapshot(save: KitchenSave, now = Date.now()): FridgeInventorySnapshot {
  const foodTotals = new Map<string, number>();
  const dishTotals = new Map<RecipeId, number>();
  const rottenSlots: FridgeItem[] = [];
  let rottenQty = 0;

  for (const it of save.fridge) {
    const qty = fridgeItemQty(it);
    if (qty <= 0) continue;
    if (fridgeKind(it) === 'dish') {
      const rid = it.defId as RecipeId;
      dishTotals.set(rid, (dishTotals.get(rid) ?? 0) + qty);
    } else if (it.quality === 'rotten') {
      rottenSlots.push(it);
      rottenQty += qty;
    } else {
      foodTotals.set(it.defId, (foodTotals.get(it.defId) ?? 0) + qty);
    }
  }

  // 1. 统计当前今日菜单（未领完）与街坊挂单急需的成菜与原材料
  const urgentDishNeed = new Map<RecipeId, { need: number; dishName: string }>();
  const addDishDemand = (rid: RecipeId, count: number) => {
    if (count <= 0) return;
    const r = recipeById(rid);
    if (!r) return;
    const prev = urgentDishNeed.get(rid);
    urgentDishNeed.set(rid, { need: (prev?.need ?? 0) + count, dishName: r.name });
  };

  if (save.dailyMenu && !save.dailyMenu.boardClaimed) {
    for (const line of save.dailyMenu.lines) {
      addDishDemand(line.recipeId, Math.max(0, line.need - line.done));
    }
  }
  for (const order of liveNeighborOrders(save.neighborOrders, now)) {
    addDishDemand(order.recipeId, 1);
  }

  const urgentFoodNeed = new Map<string, { need: number; dishNames: string[] }>();
  for (const [rid, info] of urgentDishNeed) {
    const haveDish = dishTotals.get(rid) ?? 0;
    const missingPortions = Math.max(0, info.need - haveDish);
    if (missingPortions <= 0) continue;
    const recipe = recipeById(rid);
    if (!recipe) continue;
    for (const ingId of recipe.needs) {
      const prev = urgentFoodNeed.get(ingId) ?? { need: 0, dishNames: [] };
      prev.need += missingPortions;
      if (!prev.dishNames.includes(recipe.name)) prev.dishNames.push(recipe.name);
      urgentFoodNeed.set(ingId, prev);
    }
  }

  // 2. 汇总【囤货最多 · 宜售卖/消耗】榜单（同 defId 合并统计）
  const groupedClean = new Map<string, { kind: FridgeKind; defId: string; repItem: FridgeItem; totalQty: number }>();
  for (const it of save.fridge) {
    const kind = fridgeKind(it);
    if (kind === 'food' && it.quality === 'rotten') continue;
    const key = `${kind}|${it.defId}`;
    const qty = fridgeItemQty(it);
    const prev = groupedClean.get(key);
    if (!prev) {
      groupedClean.set(key, { kind, defId: it.defId, repItem: it, totalQty: qty });
    } else {
      prev.totalQty += qty;
      if (qty > fridgeItemQty(prev.repItem)) prev.repItem = it;
    }
  }

  const surplusCandidates: SurplusEntry[] = [];
  for (const g of groupedClean.values()) {
    const unitPrice = fridgeItemUnitPrice(g.repItem, save, now);
    const urgentKeep = g.kind === 'dish'
      ? (urgentDishNeed.get(g.defId as RecipeId)?.need ?? 0)
      : (urgentFoodNeed.get(g.defId)?.need ?? 0);
    const sellableQty = Math.max(0, g.totalQty - urgentKeep);
    const name = fridgeItemName(g.repItem);
    let hint = '';
    if (urgentKeep > 0 && sellableQty > 0) {
      hint = `留${urgentKeep}份交单 · 余${sellableQty}份可卖`;
    } else if (urgentKeep > 0 && sellableQty === 0) {
      hint = '急单全数要用 · 勿卖';
    } else if (g.kind === 'dish') {
      hint = g.totalQty >= 2 ? '现成热菜富余 · 宜卖或享用' : '现成热菜 · 可卖换钱';
    } else if (g.totalQty >= 6) {
      hint = '囤货大户 · 放心售卖或猛炒';
    } else if (g.totalQty >= 3) {
      hint = '库存充裕 · 可按需售卖变现';
    } else {
      hint = '余量平稳';
    }
    surplusCandidates.push({
      kind: g.kind,
      defId: g.defId,
      name,
      repItem: g.repItem,
      totalQty: g.totalQty,
      urgentKeep,
      sellableQty,
      unitPrice,
      sellableGold: sellableQty * unitPrice,
      hint,
    });
  }

  surplusCandidates.sort((a, b) => {
    const aRich = a.sellableQty >= 3 ? 1 : 0;
    const bRich = b.sellableQty >= 3 ? 1 : 0;
    if (aRich !== bRich) return bRich - aRich;
    if (a.totalQty !== b.totalQty) return b.totalQty - a.totalQty;
    if (a.sellableGold !== b.sellableGold) return b.sellableGold - a.sellableGold;
    return a.defId.localeCompare(b.defId);
  });
  const surplusList = surplusCandidates
    .filter((row) => row.totalQty >= 2 || (surplusCandidates[0]?.totalQty ?? 0) < 2)
    .slice(0, 4);

  // 3. 汇总【紧缺/待捡 · 菜单与常做菜谱缺口】榜单
  const shortageList: ShortageEntry[] = [];
  const seenShortage = new Set<string>();

  // 3a. 今日菜单与街坊点单直接缺料或刚够孤本
  const urgentEntries = [...urgentFoodNeed.entries()].sort((a, b) => {
    const haveA = foodTotals.get(a[0]) ?? 0;
    const haveB = foodTotals.get(b[0]) ?? 0;
    return (haveA - a[1].need) - (haveB - b[1].need);
  });

  for (const [ingId, info] of urgentEntries) {
    if (shortageList.length >= 4) break;
    const have = foodTotals.get(ingId) ?? 0;
    if (have > info.need) continue;
    let itemName = ingId;
    try { itemName = getItem(ingId).name; } catch { continue; }
    const marketHint = findFoodSourceLabel(ingId, save.level);
    const dishTag = info.dishNames[0] ?? '急单';
    const lack = Math.max(0, info.need - have);
    shortageList.push({
      defId: ingId,
      name: itemName,
      have,
      urgentNeed: info.need,
      reason: lack > 0 ? `${dishTag}缺 ${lack} 份` : `${dishTag}刚够(${have}/${info.need})`,
      marketHint,
      urgent: true,
    });
    seenShortage.add(ingId);
  }

  // 3b. 已解锁常做菜谱高频原材料的 0 库存断档或仅剩 1 份预警
  if (shortageList.length < 4) {
    const unlocked = unlockedRecipes(recipeUnlockView(save));
    const usage = new Map<string, { count: number; sampleDish: string }>();
    for (const r of unlocked) {
      if (r.id === 'wild_fish_soup') continue;
      for (const ingId of new Set(r.needs)) {
        const prev = usage.get(ingId);
        if (!prev) usage.set(ingId, { count: 1, sampleDish: r.name });
        else prev.count += 1;
      }
    }

    const recipeGaps = [...usage.entries()]
      .filter(([ingId]) => !seenShortage.has(ingId) && (foodTotals.get(ingId) ?? 0) <= 1)
      .sort((a, b) => {
        const haveA = foodTotals.get(a[0]) ?? 0;
        const haveB = foodTotals.get(b[0]) ?? 0;
        if (haveA !== haveB) return haveA - haveB;
        return b[1].count - a[1].count;
      });

    for (const [ingId, meta] of recipeGaps) {
      if (shortageList.length >= 4) break;
      let itemName = ingId;
      try { itemName = getItem(ingId).name; } catch { continue; }
      const have = foodTotals.get(ingId) ?? 0;
      const marketHint = findFoodSourceLabel(ingId, save.level);
      shortageList.push({
        defId: ingId,
        name: itemName,
        have,
        urgentNeed: 0,
        reason: have === 0
          ? `断档 0份（${meta.sampleDish}${meta.count > 1 ? `等${meta.count}道` : ''}）`
          : `仅剩 1份（${meta.sampleDish}备料）`,
        marketHint,
        urgent: false,
      });
      seenShortage.add(ingId);
    }
  }

  return {
    foodTotals,
    dishTotals,
    urgentDishNeed,
    urgentFoodNeed,
    rottenSlots,
    rottenQty,
    surplusList,
    shortageList,
  };
}

/**
 * 奶油薄荷冷藏冰箱 + 库存买卖/捡菜决策中心：
 * 顶盖配复古薄荷搪瓷铭牌与三枚磁吸便签（生鲜食材 / 做好饭菜 / 盘点笺），
 * 冷藏内胆顶部设通透磨砂「品阶 / 数量多→少 / 数量少→多」排序签与「急用 / 富余 / 仅1份」直觉角标，
 * 支持一键合堆整理并展开宣纸「冰箱库存盘点笺」，清晰指明什么菜多可卖、什么菜缺该去哪捡。
 */
export class FridgePanel extends PIXI.Container {
  _isOpen = false;
  onChange: (() => void) | null = null;
  private _tab: FridgeKind = 'food';
  private _sortMode: FridgeSortMode = 'default';
  private _ledgerOpen = false;
  private _root = new PIXI.Container();
  private _inspectUid: string | null = null;
  private _fullModal = false;
  private _tutSlot: PIXI.Container | null = null;
  private _sellBtn: PIXI.Container | null = null;
  private _inspectQty = 1;
  private _scroller: VerticalScroller;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 22;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen && !this._ledgerOpen });
  }

  /** 严谨的冰箱新手引导步（仅这三步限制切页签/点选与精简底部栏；HINT_DOOR 等步骤完全自由）。 */
  private get _inFridgeTut(): boolean {
    return TutorialManager.at(
      TutorialStep.OPEN_FRIDGE,
      TutorialStep.INSPECT_DISH,
      TutorialStep.SELL_DISH,
    );
  }

  /** 冰箱教学步内匹配目标「炒菜苔」：若原 dishUid 已不存在，自动兜底匹配任意 stirfry 成菜防死锁。 */
  private _isTutTargetDish(it: FridgeItem): boolean {
    if (fridgeKind(it) !== 'dish' || it.defId !== 'stirfry') return false;
    const want = TutorialManager.dishUid;
    if (want && KitchenManager.save.fridge.some((row) => row.uid === want)) {
      return it.uid === want;
    }
    return true;
  }

  prune(): void {
    const valid = new Set(KitchenManager.save.fridge.map((it) => it.uid));
    if (this._inspectUid && !valid.has(this._inspectUid)) {
      this._inspectUid = null;
      this._inspectQty = 1;
      this._fullModal = false;
    }
  }

  open(tab?: FridgeKind): void {
    if (!this._isOpen) AudioManager.play('fridge_open');
    this.prune();
    this._ledgerOpen = false;
    if (this._inFridgeTut) {
      this._tab = 'dish';
      this._sortMode = 'default';
    } else if (tab) {
      this._tab = tab;
    }
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this._inspectUid = null;
    this._inspectQty = 1;
    this._fullModal = false;

    if (this._isOpen) TutorialOverlay.register('fridge', () => this.tutorialRect());
    TutorialManager.advanceIf(TutorialStep.OPEN_FRIDGE);

    if (!this._inFridgeTut) {
      const snap = buildInventorySnapshot(KitchenManager.save);
      const rawTabItems = KitchenManager.save.fridge.filter((it) => fridgeKind(it) === this._tab);
      const sorted = this._sortItemsForView(rawTabItems, snap);
      if (sorted[0]) this._inspectUid = sorted[0].uid;
    } else if (TutorialManager.isStep(TutorialStep.SELL_DISH)) {
      const tutDish = KitchenManager.save.fridge.find((it) => this._isTutTargetDish(it));
      if (tutDish) this._inspectUid = tutDish.uid;
    }

    this.relayout();
    OverlayManager.bringToFront();
    this._warm();
  }

  close(silent = false): void {
    if (!silent && TutorialGuard.block('closeFridge')) return;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._fullModal = false;
    this._ledgerOpen = false;
    this._paintQueued = false;
    this._scroller.disable();
    this._scroller.clear();
    TutorialOverlay.unregister('fridge');
    destroyDisplayChildren(this._root);
  }

  tutorialRect(): { x: number; y: number; w: number; h: number; r?: number } | null {
    if (!this._isOpen || !this._inFridgeTut) return null;
    if (TutorialManager.isStep(TutorialStep.INSPECT_DISH)) return stageRectOf(this._tutSlot, 6);
    if (TutorialManager.isStep(TutorialStep.SELL_DISH)) return stageRectOf(this._sellBtn, 6);
    return null;
  }

  private _warm(): void {
    const save = KitchenManager.save;
    const snap = buildInventorySnapshot(save);
    const itemPaths: string[] = [];
    for (const it of save.fridge) {
      if (fridgeKind(it) === 'dish') {
        itemPaths.push(resolveDishAssetPath(it.defId));
      } else {
        itemPaths.push(resolveItemAssetPath(it.defId, false));
        if (it.quality === 'rotten') {
          itemLookTexture(it.defId, 'rotten');
        }
      }
    }
    const extraShortagePaths = snap.shortageList.map((s) => resolveItemAssetPath(s.defId, false));
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        ...PANEL_SHELL.fridge,
        ...itemPaths,
        ...extraShortagePaths,
        HUD_ICON.coin,
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        UI_BTN.cream,
        UI_BTN.terracotta,
        UI_BTN.wood,
      ],
      this._scheduleRelayout,
    );
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen) this.relayout();
    });
  };

  private _sortItemsForView(items: readonly FridgeItem[], snap: FridgeInventorySnapshot): FridgeItem[] {
    if (this._inFridgeTut) return items.slice();
    const totalOf = (it: FridgeItem): number => {
      if (fridgeKind(it) === 'dish') return snap.dishTotals.get(it.defId as RecipeId) ?? fridgeItemQty(it);
      if (it.quality === 'rotten') return fridgeItemQty(it);
      return snap.foodTotals.get(it.defId) ?? fridgeItemQty(it);
    };
    const isUrgent = (it: FridgeItem): number => {
      if (fridgeKind(it) === 'dish') {
        return snap.urgentDishNeed.has(it.defId as RecipeId) ? 1 : 0;
      }
      if (it.quality === 'rotten') return 0;
      return snap.urgentFoodNeed.has(it.defId) ? 1 : 0;
    };

    return items.slice().sort((a, b) => {
      // 腐坏食材始终归置末尾，不干扰好菜决策
      const rotA = fridgeKind(a) === 'food' && a.quality === 'rotten' ? 1 : 0;
      const rotB = fridgeKind(b) === 'food' && b.quality === 'rotten' ? 1 : 0;
      if (rotA !== rotB) return rotA - rotB;

      if (this._sortMode === 'most') {
        const qa = totalOf(a);
        const qb = totalOf(b);
        if (qa !== qb) return qb - qa;
        const sa = fridgeItemQty(a);
        const sb = fridgeItemQty(b);
        if (sa !== sb) return sb - sa;
      } else if (this._sortMode === 'least') {
        const qa = totalOf(a);
        const qb = totalOf(b);
        if (qa !== qb) return qa - qb;
        const ua = isUrgent(a);
        const ub = isUrgent(b);
        if (ua !== ub) return ub - ua;
      } else {
        const ra = rarityRank(fridgeSlotRarity(a));
        const rb = rarityRank(fridgeSlotRarity(b));
        if (ra !== rb) return rb - ra;
      }

      const ra = rarityRank(fridgeSlotRarity(a));
      const rb = rarityRank(fridgeSlotRarity(b));
      if (ra !== rb) return rb - ra;
      if (a.defId !== b.defId) return a.defId.localeCompare(b.defId);
      return fridgeItemQty(b) - fridgeItemQty(a);
    });
  }

  relayout(): void {
    this._tutSlot = null;
    this._sellBtn = null;
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;
    this.prune();
    this._warm();

    const save = KitchenManager.save;
    const snap = buildInventorySnapshot(save);
    const cap = fridgeCap(save);
    const foods = save.fridge.filter((it) => fridgeKind(it) === 'food');
    const dishes = save.fridge.filter((it) => fridgeKind(it) === 'dish');
    if (this._inFridgeTut) {
      this._tab = 'dish';
      this._ledgerOpen = false;
      this._sortMode = 'default';
    }
    const rawItems = this._tab === 'food' ? foods : dishes;
    const items = this._sortItemsForView(rawItems, snap);

    const waitInspectTap = TutorialManager.at(TutorialStep.OPEN_FRIDGE, TutorialStep.INSPECT_DISH)
      && items.some((it) => this._isTutTargetDish(it));

    if (!waitInspectTap && !this._ledgerOpen) {
      if (!this._inspectUid || !items.some((it) => it.uid === this._inspectUid)) {
        const preferred = TutorialManager.isStep(TutorialStep.SELL_DISH)
          ? (items.find((it) => this._isTutTargetDish(it)) ?? items[0])
          : items[0];
        this._inspectUid = preferred?.uid ?? null;
        this._inspectQty = 1;
      }
    }

    const used = save.fridge.length;
    const foodSlots = Math.max(foods.length, cap - dishes.length);
    const dishSlots = Math.max(dishes.length, cap - foods.length);
    const slotCount = Math.max(8, this._tab === 'food' ? foodSlots : dishSlots);
    const foodCount = fridgeQtySum(foods);
    const dishCount = fridgeQtySum(dishes);

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: PANEL_H,
      topBleed: 16,
      onDimTap: () => {
        if (this._fullModal) {
          this._fullModal = false;
          this.relayout();
          return;
        }
        if (TutorialGuard.block('closeFridge')) return;
        this.close();
      },
    });

    // 0. 奶油白外壳 + 薄荷青冷藏内胆复古冰箱主体
    this._drawFridgeCabinet(scene);
    this._drawFridgeBrandPlaque(scene, '冰 箱', W / 2, 28);

    // 1. 磁吸分类便签页签（生鲜 / 饭菜 / 盘点笺）+ 右侧冰箱容量
    if (this._inFridgeTut) {
      scene.addChild(this._makeIndexTab('生鲜食材', 'food', 42, L.tabY, 204, foodCount));
      scene.addChild(this._makeIndexTab('做好饭菜', 'dish', 256, L.tabY, 204, dishCount));
      this._drawCapHeader(scene, used, cap, kitchenBuffLine(save), 204);
    } else {
      scene.addChild(this._makeIndexTab('生鲜', 'food', 34, L.tabY, 162, foodCount));
      scene.addChild(this._makeIndexTab('饭菜', 'dish', 202, L.tabY, 162, dishCount));
      scene.addChild(this._makeLedgerTab(370, L.tabY, 134, snap));
      this._drawCapHeader(scene, used, cap, kitchenBuffLine(save), 170);
    }

    if (this._ledgerOpen && !this._inFridgeTut) {
      // 展开宣纸「冰箱库存盘点笺」：一目了然看清囤货大户与菜单/菜谱缺口
      this._drawInventoryLedger(scene, save, snap, used, cap, foodCount, dishCount);
    } else {
      // 2. 薄荷青冷藏内胆：顶部排序切换签 + 磨砂玻璃冷藏层架
      this._drawShelves(scene, items, slotCount, scale, toStage, snap);

      // 3. 下门区磁吸铜钉宣纸保鲜便签：选中项详情 + 决策建议 + 一键整理/丢弃/品尝/卖出
      drawStretchSheet(scene, SCENE_ART.sheet, L.sheetX, L.sheetTop, W - L.sheetX * 2, L.sheetH, 140, 110);
      this._drawMagnetClip(scene, W / 2, L.sheetTop + 2);
      const selected = items.find((it) => it.uid === this._inspectUid) ?? null;
      this._drawBottomSlip(scene, selected, items.length, snap);
    }

    drawSceneClose(scene, W - 62, 28, () => {
      if (TutorialGuard.block('closeFridge')) return;
      this.close();
    }, this._scheduleRelayout);

    // 点击底部瓷碟可放大查看完整鉴赏大笺
    const selectedForModal = items.find((it) => it.uid === this._inspectUid) ?? null;
    if (this._fullModal && selectedForModal && !this._inFridgeTut && !this._ledgerOpen) {
      const view = inspectFromFridge(selectedForModal);
      this._inspectQty = Math.max(1, Math.min(view.maxQty, this._inspectQty));
      this._root.addChild(makeItemInspectCard({
        view,
        qty: this._inspectQty,
        actions: true,
        onQty: (n) => {
          this._inspectQty = n;
          this.relayout();
        },
        onClose: () => {
          this._fullModal = false;
          this.relayout();
        },
        onSell: () => this._handleSell(selectedForModal),
        onEat: () => this._handleEat(selectedForModal),
        onReady: this._scheduleRelayout,
      }));
    }

    TutorialOverlay.refresh();
  }

  // ── 奶油薄荷复古冰箱柜体 + 搪瓷镶铜铭牌 ─────────────────────────────
  private _drawFridgeCabinet(scene: PIXI.Container): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0E0804, 0.42);
    shadow.drawRoundedRect(18, 22, W - 36, PANEL_H - 22, 58);
    shadow.endFill();
    scene.addChild(shadow);

    const tex = gameTexture(ART.cabinet);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = W;
      sp.height = PANEL_H;
      sp.eventMode = 'none';
      scene.addChild(sp);
      return;
    }

    const g = new PIXI.Graphics();
    g.lineStyle(4, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(FRIDGE_INK.creamShell, 1);
    g.drawRoundedRect(16, 12, W - 32, PANEL_H - 36, 52);
    g.endFill();
    g.moveTo(20, 208);
    g.lineTo(W - 20, 208);
    g.lineStyle(3, FRIDGE_INK.cabinetLine, 0.95);
    g.beginFill(FRIDGE_INK.mintLiner, 1);
    g.drawRoundedRect(56, 236, W - 112, 708, 22);
    g.endFill();
    scene.addChild(g);
  }

  /** 奶油白顶盖中央的复古薄荷搪瓷镶铜铭牌「冰 箱」。 */
  private _drawFridgeBrandPlaque(scene: PIXI.Container, title: string, cx: number, top: number): void {
    const w = 236;
    const h = 68;
    const x = cx - w / 2;
    const g = new PIXI.Graphics();

    g.beginFill(0x2A1608, 0.16);
    g.drawRoundedRect(x + 2, top + 5, w, h, 34);
    g.endFill();

    g.lineStyle(2.8, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(0xDFB468, 1);
    g.drawRoundedRect(x, top, w, h, 34);
    g.endFill();

    g.lineStyle(1.8, 0xFFF9EA, 0.85);
    g.beginFill(FRIDGE_INK.mintAccent, 1);
    g.drawRoundedRect(x + 6, top + 6, w - 12, h - 12, 28);
    g.endFill();

    g.lineStyle(0);
    g.beginFill(0x64B59B, 0.34);
    g.drawRoundedRect(x + 16, top + 10, w - 32, 20, 10);
    g.endFill();

    for (const dx of [-88, 88]) {
      g.lineStyle(2, FRIDGE_INK.cabinetLine, 1);
      g.beginFill(0xE8C27A, 1);
      g.drawCircle(cx + dx, top + h / 2, 6.5);
      g.endFill();
      g.lineStyle(0);
      g.beginFill(0xFFFDF4, 0.8);
      g.drawCircle(cx + dx - 1.8, top + h / 2 - 1.8, 2.2);
      g.endFill();
    }
    scene.addChild(g);

    const t = makeText('display', title, 0xFFF9EC, {
      size: 38,
      stroke: 0x133328,
      strokeWidth: 4,
    });
    t.anchor.set(0.5);
    t.position.set(cx, top + h / 2 - 1);
    scene.addChild(t);
  }

  /** 保鲜便签/盘点笺顶缘的薄荷搪瓷磁吸长扣。 */
  private _drawMagnetClip(scene: PIXI.Container, cx: number, cy: number): void {
    const w = 96;
    const h = 16;
    const g = new PIXI.Graphics();
    g.beginFill(0x26150A, 0.22);
    g.drawRoundedRect(cx - w / 2 + 1, cy - h / 2 + 3, w, h, 8);
    g.endFill();
    g.lineStyle(2.2, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(0x4E9E84, 1);
    g.drawRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(0xBCEAD9, 0.55);
    g.drawRoundedRect(cx - w / 2 + 8, cy - h / 2 + 2.5, w - 16, 4.5, 2.2);
    g.endFill();
    scene.addChild(g);
  }

  // ── 顶部磁吸分类便签页签 + 盘点书签 + 容量抬头 ──────────────────────
  private _makeIndexTab(
    title: string,
    tab: FridgeKind,
    x: number,
    y: number,
    w: number,
    count: number,
  ): PIXI.Container {
    const active = !this._ledgerOpen && this._tab === tab;
    const root = new PIXI.Container();
    const h = active ? 68 : 58;
    root.position.set(x, active ? y : y + 10);

    const sp = sceneSprite(ART.tab, w, h);
    if (sp) {
      sp.width = w;
      sp.height = h;
      sp.tint = active ? 0xFFFDF9 : 0xCDE3D6;
      root.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.5, FRIDGE_INK.cabinetLine, 1);
      g.beginFill(active ? 0xFFFDF8 : 0xC6DED0, 1);
      g.drawRoundedRect(0, 0, w, h, 14);
      g.endFill();
      root.addChild(g);
    }

    const pin = new PIXI.Graphics();
    pin.lineStyle(1.8, FRIDGE_INK.cabinetLine, 0.9);
    pin.beginFill(active ? 0xD95B38 : 0x5A9E87, 1);
    pin.drawCircle(w / 2, 11, 5);
    pin.endFill();
    root.addChild(pin);

    if (active) {
      const bar = new PIXI.Graphics();
      bar.beginFill(SCENE_INK.red, 0.92);
      bar.drawRoundedRect(22, h - 9, w - 44, 5, 2.5);
      bar.endFill();
      root.addChild(bar);
    }

    const txt = makeText(
      'heading',
      `${title} ${count}`,
      active ? FRIDGE_INK.domeInk : 0x264237,
      {
        size: active ? 24 : 22,
        stroke: active ? 0xFFFFFF : 0xEFF8F3,
        strokeWidth: 2,
      },
    );
    txt.anchor.set(0.5);
    txt.position.set(w / 2, h / 2 + (active ? 2 : 3));
    fitTextWidth(txt, w - 18);
    root.addChild(txt);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h + 8);
    bindUiClick(root);
    root.on('pointertap', () => {
      if (this._inFridgeTut && tab !== 'dish') {
        if (TutorialGuard.block('fridgeTab')) return;
      }
      if (!this._ledgerOpen && this._tab === tab) return;
      this._ledgerOpen = false;
      this._tab = tab;
      this._scroller.reset();
      this._inspectUid = null;
      this._inspectQty = 1;
      this._fullModal = false;
      this.relayout();
    });
    return root;
  }

  /** 页签旁的「盘点笺」磁吸书签：随时一键查看多寡囤货与赶集缺口。 */
  private _makeLedgerTab(
    x: number,
    y: number,
    w: number,
    snap: FridgeInventorySnapshot,
  ): PIXI.Container {
    const active = this._ledgerOpen;
    const root = new PIXI.Container();
    const h = active ? 68 : 58;
    root.position.set(x, active ? y : y + 10);

    const sp = sceneSprite(ART.tab, w, h);
    if (sp) {
      sp.width = w;
      sp.height = h;
      sp.tint = active ? 0xFFF8E6 : 0xF5E5C2;
      root.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.5, FRIDGE_INK.cabinetLine, 1);
      g.beginFill(active ? 0xFFF8E6 : 0xF3E2BD, 1);
      g.drawRoundedRect(0, 0, w, h, 14);
      g.endFill();
      root.addChild(g);
    }

    const hasUrgentGap = snap.shortageList.some((s) => s.urgent && s.have < s.urgentNeed);
    const pin = new PIXI.Graphics();
    pin.lineStyle(1.8, FRIDGE_INK.cabinetLine, 0.9);
    pin.beginFill(active || hasUrgentGap ? SCENE_INK.red : 0xC8882A, 1);
    pin.drawCircle(w / 2, 11, 5);
    pin.endFill();
    root.addChild(pin);

    if (active) {
      const bar = new PIXI.Graphics();
      bar.beginFill(SCENE_INK.red, 0.92);
      bar.drawRoundedRect(20, h - 9, w - 40, 5, 2.5);
      bar.endFill();
      root.addChild(bar);
    }

    const txt = makeText(
      'heading',
      '盘点笺',
      active ? SCENE_INK.red : 0x5E3814,
      {
        size: active ? 24 : 22,
        stroke: 0xFFFDF6,
        strokeWidth: 2.5,
      },
    );
    txt.anchor.set(0.5);
    txt.position.set(w / 2, h / 2 + (active ? 2 : 3));
    fitTextWidth(txt, w - 16);
    root.addChild(txt);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h + 8);
    bindUiClick(root);
    root.on('pointertap', () => {
      if (this._inFridgeTut) return;
      this._ledgerOpen = !this._ledgerOpen;
      this._fullModal = false;
      this.relayout();
    });
    return root;
  }

  private _drawCapHeader(
    scene: PIXI.Container,
    used: number,
    cap: number,
    buff: string | null | undefined,
    maxW: number,
  ): void {
    const rightX = W - 38;
    const full = used >= cap;
    const capTxt = makeText('heading', `冰箱 ${used}/${cap} 格`, full ? SCENE_INK.red : FRIDGE_INK.domeInk, {
      size: 23,
      stroke: FRIDGE_INK.creamHalo,
      strokeWidth: 4,
    });
    capTxt.anchor.set(1, 0);
    capTxt.position.set(rightX, L.tabY - 2);
    fitTextWidth(capTxt, maxW);
    scene.addChild(capTxt);

    const subStr = buff || (full ? '已满格 · 建议整理/售卖' : '同种自动叠放');
    const subColor = buff ? SCENE_INK.gold : (full ? SCENE_INK.red : FRIDGE_INK.mintAccent);
    const subTxt = makeText('caption', subStr, subColor, {
      size: 20,
      fontWeight: '700',
      stroke: FRIDGE_INK.creamHalo,
      strokeWidth: 3.5,
    });
    subTxt.anchor.set(1, 0);
    subTxt.position.set(rightX, L.tabY + 32);
    fitTextWidth(subTxt, maxW + 4);
    scene.addChild(subTxt);
  }

  // ── 冷藏内胆顶部：磨砂玻璃排序切换条（右侧留白供后续筛选扩展） ──────────────
  private _drawSortStrip(scene: PIXI.Container): void {
    const barX = L.cavityX + 8;
    const barY = L.cavityTop + 6;
    const barW = L.cavityW - 16;
    const barH = 42;

    const bg = new PIXI.Graphics();
    bg.lineStyle(1.6, 0x4E8E78, 0.72);
    bg.beginFill(0xF5FFFB, 0.84);
    bg.drawRoundedRect(barX, barY, barW, barH, 21);
    bg.endFill();
    scene.addChild(bg);

    const modes: Array<{ id: FridgeSortMode; label: string; w: number }> = [
      { id: 'default', label: '品阶默认', w: 122 },
      { id: 'most', label: '数量多→少', w: 140 },
      { id: 'least', label: '数量少→多', w: 140 },
    ];

    let curX = barX + 8;
    for (const m of modes) {
      const on = this._sortMode === m.id;
      const pill = new PIXI.Container();
      pill.position.set(curX, barY + 4);
      const pillH = barH - 8;

      if (on) {
        const pg = new PIXI.Graphics();
        pg.beginFill(FRIDGE_INK.mintAccent, 0.96);
        pg.drawRoundedRect(0, 0, m.w, pillH, 17);
        pg.endFill();
        pill.addChild(pg);
      }

      const pt = makeText(
        'caption',
        m.label,
        on ? 0xFFFDF6 : 0x23473B,
        {
          size: 20,
          fontWeight: '700',
          ...(on ? { stroke: 0x123328, strokeWidth: 2.5 } : {}),
        },
      );
      pt.anchor.set(0.5);
      pt.position.set(m.w / 2, pillH / 2);
      fitTextWidth(pt, m.w - 12);
      pill.addChild(pt);

      pill.eventMode = 'static';
      pill.cursor = 'pointer';
      pill.hitArea = new PIXI.Rectangle(0, -2, m.w, barH);
      bindUiClick(pill);
      pill.on('pointertap', () => {
        if (this._sortMode === m.id) return;
        this._sortMode = m.id;
        analytics.trackFridgeAction({ action: 'sort_change', sortMode: m.id });
        this._scroller.reset();
        const snap = buildInventorySnapshot(KitchenManager.save);
        const tabItems = KitchenManager.save.fridge.filter((it) => fridgeKind(it) === this._tab);
        const first = this._sortItemsForView(tabItems, snap)[0];
        if (first) {
          this._inspectUid = first.uid;
          this._inspectQty = 1;
        }
        this.relayout();
      });
      scene.addChild(pill);
      curX += m.w + 6;
    }
  }

  // ── 中段薄荷青冷藏内胆：磨砂钢化玻璃/搪瓷隔板 + 4列保鲜陈列 ────────────
  private _drawShelves(
    scene: PIXI.Container,
    items: FridgeItem[],
    slotCount: number,
    scale: number,
    toStage: (x: number, y: number) => { x: number; y: number },
    snap: FridgeInventorySnapshot,
  ): void {
    const chill = new PIXI.Graphics();
    chill.beginFill(0xF4FFFC, 0.28);
    chill.drawRoundedRect(L.cavityX + 12, L.cavityTop + 4, L.cavityW - 24, 54, 18);
    chill.endFill();
    chill.beginFill(0xFFFFFF, 0.18);
    chill.drawEllipse(W / 2, L.cavityTop + 14, 170, 18);
    chill.endFill();
    for (const [cx, cy, r] of [
      [L.cavityX + 86, L.cavityTop + 64, 14],
      [W / 2 + 120, L.cavityTop + 58, 11],
      [W / 2 - 42, L.cavityTop + 82, 9],
    ] as const) {
      chill.beginFill(0xF6FFFD, 0.22);
      chill.drawCircle(cx, cy, r);
      chill.endFill();
    }
    chill.lineStyle(2, 0x5E9E87, 0.36);
    chill.moveTo(L.cavityX + 8, L.cavityTop + 16);
    chill.lineTo(L.cavityX + 8, L.cavityTop + L.cavityH - 12);
    chill.moveTo(L.cavityX + L.cavityW - 8, L.cavityTop + 16);
    chill.lineTo(L.cavityX + L.cavityW - 8, L.cavityTop + L.cavityH - 12);
    scene.addChild(chill);

    const showSortBar = !this._inFridgeTut;
    if (showSortBar) {
      this._drawSortStrip(scene);
    }

    const shelfTop = showSortBar ? L.cavityTop + 52 : L.cavityTop;
    const shelfViewH = showSortBar ? L.cavityH - 52 : L.cavityH;

    const rows = Math.max(3, Math.ceil(slotCount / L.cols));
    const totalContentH = rows * L.shelfRowH + 14;
    const maxScroll = Math.max(0, totalContentH - shelfViewH);

    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xFFFFFF);
    mask.drawRoundedRect(L.cavityX + 2, shelfTop + 2, L.cavityW - 4, shelfViewH - 4, 14);
    mask.endFill();
    mask.eventMode = 'none';
    viewport.mask = mask;
    scene.addChild(mask, viewport);

    const grid = new PIXI.Container();
    grid.position.set(0, shelfTop);
    viewport.addChild(grid);

    const innerPad = 10;
    const plankW = L.cavityW - innerPad * 2;
    const cellW = Math.floor(plankW / L.cols);

    const BUFFER = L.shelfRowH;
    const mountedRows = new Map<number, PIXI.Container>();
    const buildShelfRow = (r: number): PIXI.Container => {
      const rowNode = new PIXI.Container();
      const rowTop = 6 + r * L.shelfRowH;
      const ledgeY = rowTop + 112;
      this._drawGlassShelf(rowNode, L.cavityX + innerPad, ledgeY, plankW);
      for (let c = 0; c < L.cols; c++) {
        const idx = r * L.cols + c;
        const cx = L.cavityX + innerPad + c * cellW + cellW / 2;
        const item = items[idx];
        rowNode.addChild(this._makeShelfItem(cx, rowTop, cellW, item, snap));
      }
      return rowNode;
    };
    const syncRows = (scrollY: number): void => {
      if (grid.destroyed) return;
      const scrollTop = -scrollY;
      const minY = scrollTop - BUFFER;
      const maxY = scrollTop + shelfViewH + BUFFER;
      for (const [r, node] of mountedRows) {
        const y0 = 6 + r * L.shelfRowH;
        const y1 = y0 + L.shelfRowH;
        if (y1 < minY || y0 > maxY) {
          mountedRows.delete(r);
          destroyDisplayNode(node);
        }
      }
      for (let r = 0; r < rows; r++) {
        if (mountedRows.has(r)) continue;
        const y0 = 6 + r * L.shelfRowH;
        const y1 = y0 + L.shelfRowH;
        if (y1 < minY || y0 > maxY) continue;
        const node = buildShelfRow(r);
        grid.addChild(node);
        mountedRows.set(r, node);
      }
    };

    if (!items.length) {
      const emptyMsg = this._tab === 'dish'
        ? '冰箱里还没有热菜，去灶台炒两盘吧'
        : '冰箱空空如也，出门去菜场挑点鲜货吧';
      const emptyPill = new PIXI.Graphics();
      emptyPill.beginFill(0xF6FFFC, 0.78);
      emptyPill.lineStyle(2, 0x4E8E78, 0.55);
      emptyPill.drawRoundedRect(L.cavityX + 34, shelfTop + shelfViewH / 2 - 34, L.cavityW - 68, 68, 34);
      emptyPill.endFill();
      scene.addChild(emptyPill);

      const emptyTxt = makeText('title', emptyMsg, FRIDGE_INK.deepInk, {
        size: 25,
        stroke: FRIDGE_INK.creamHalo,
        strokeWidth: 4,
      });
      emptyTxt.anchor.set(0.5);
      emptyTxt.position.set(W / 2, shelfTop + shelfViewH / 2);
      fitTextWidth(emptyTxt, L.cavityW - 96);
      scene.addChild(emptyTxt);
    }

    const stageTopLeft = toStage(L.cavityX, shelfTop);
    this._scroller.attach({
      content: grid,
      maxScroll,
      baseY: shelfTop,
      hit: {
        x: stageTopLeft.x,
        y: stageTopLeft.y,
        w: L.cavityW * scale,
        h: shelfViewH * scale,
      },
      onScroll: syncRows,
    });
  }

  /** 绘制单层通透磨砂玻璃冷藏隔板（带冰青厚度折光与白搪瓷护沿）。 */
  private _drawGlassShelf(parent: PIXI.Container, x: number, y: number, w: number): void {
    const g = new PIXI.Graphics();
    g.beginFill(0x285A49, 0.18);
    g.drawRoundedRect(x + 4, y + 18, w - 8, 10, 5);
    g.endFill();

    g.lineStyle(1.6, 0x569882, 0.75);
    g.beginFill(0xE9FAF4, 0.80);
    g.drawRoundedRect(x + 2, y - 4, w - 4, 18, 6);
    g.endFill();

    g.lineStyle(0);
    g.beginFill(0xFFFFFF, 0.52);
    g.drawRoundedRect(x + 16, y - 1, w - 32, 5, 2.5);
    g.endFill();

    g.lineStyle(2, 0x2F5548, 0.92);
    g.beginFill(0xFBFFFE, 0.96);
    g.drawRoundedRect(x, y + 9, w, 12, 6);
    g.endFill();

    g.lineStyle(0);
    g.beginFill(0x98D3C1, 0.75);
    g.drawRoundedRect(x + 6, y + 15, w - 12, 4, 2);
    g.endFill();

    g.eventMode = 'none';
    parent.addChild(g);
  }

  private _makeShelfItem(
    cx: number,
    rowTop: number,
    cellW: number,
    it: FridgeItem | undefined,
    snap: FridgeInventorySnapshot,
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(cx, rowTop);

    if (!it) {
      root.eventMode = 'none';
      return root;
    }

    const isDish = fridgeKind(it) === 'dish';
    const isRotten = !isDish && it.quality === 'rotten';
    const selected = this._inspectUid === it.uid;
    const rarity = fridgeSlotRarity(it);
    const visualTier = isRotten ? 'common' : fridgeSlotVisualTier(it);
    const liftY = selected ? -6 : 0;

    // 隔板上的柔和半透明深色落影 + 选中态温润奶金底座指示（绝不篡改物品自身品质光色）
    const shelfShadow = new PIXI.Graphics();
    shelfShadow.beginFill(0x1B362E, isDish ? (selected ? 0.16 : 0.22) : (selected ? 0.13 : 0.18));
    shelfShadow.drawEllipse(0, isDish ? 108 : 109, isDish ? 48 : 45, isDish ? 13 : 12);
    shelfShadow.endFill();
    if (selected) {
      shelfShadow.lineStyle(2, 0xE6A43B, 0.88);
      shelfShadow.beginFill(0xFFF6D6, 0.62);
      shelfShadow.drawEllipse(0, 108, isDish ? 52 : 49, 13);
      shelfShadow.endFill();
      // 隔板护沿小巧铜金选中三角标
      shelfShadow.lineStyle(1.5, FRIDGE_INK.cabinetLine, 0.9);
      shelfShadow.beginFill(0xF2B84B, 1);
      shelfShadow.moveTo(0, 113);
      shelfShadow.lineTo(-7, 121);
      shelfShadow.lineTo(7, 121);
      shelfShadow.closePath();
      shelfShadow.endFill();
    }
    shelfShadow.eventMode = 'none';
    root.addChild(shelfShadow);

    // 实物主体容器：选中时整体微抬 -6px 并轻微放大 1.06x；品质轮廓光紧贴食材/成菜自身边缘，白瓷小碟干干净净承托
    const body = new PIXI.Container();
    body.pivot.set(0, 78);
    body.position.set(0, 78 + liftY);
    if (selected) body.scale.set(1.06);
    root.addChild(body);

    if (isDish) {
      const tex = dishTexture(it.defId);
      if (isTextureReady(tex)) {
        const dishSprite = new PIXI.Sprite(tex);
        fitSpriteInBox(dishSprite, 116, 116);
        dishSprite.anchor.set(0.5);
        dishSprite.position.set(0, 72);
        dishSprite.eventMode = 'none';
        body.addChild(dishSprite);
        attachSpriteContour(body, dishSprite, visualTier, { selected });
      }
    } else {
      const tray = sceneSprite(ART.tray, 114, 70);
      if (tray) {
        tray.anchor.set(0.5);
        tray.position.set(0, 92);
        if (isRotten) tray.tint = 0xCEC8BC;
        body.addChild(tray);
      }
      const tex = itemLookTexture(it.defId, isRotten ? 'rotten' : 'clean');
      if (isTextureReady(tex)) {
        const iconSprite = new PIXI.Sprite(tex);
        fitSpriteInBox(iconSprite, 78, 78);
        iconSprite.anchor.set(0.5, 1);
        iconSprite.position.set(0, 103);
        iconSprite.eventMode = 'none';
        if (isRotten) iconSprite.tint = 0xC8BCA8;
        body.addChild(iconSprite);
        if (!isRotten) {
          attachSpriteContour(body, iconSprite, visualTier, { selected });
        }
      }
    }

    // 左上角温润直觉状态印记（不套丑小框！用小印记/温润色字描边呈现：已腐 / 待交 / 急用 / 富余 / 极鲜 / 仅1份）
    const qty = fridgeItemQty(it);
    const totalCleanQty = isDish
      ? (snap.dishTotals.get(it.defId as RecipeId) ?? qty)
      : (isRotten ? 0 : (snap.foodTotals.get(it.defId) ?? qty));
    const urgentNeed = isDish
      ? (snap.urgentDishNeed.get(it.defId as RecipeId)?.need ?? 0)
      : (isRotten ? 0 : (snap.urgentFoodNeed.get(it.defId)?.need ?? 0));

    let badgeLabel = '';
    let badgeColor: number = 0x8F4B06;
    let badgeHalo: number = FRIDGE_INK.creamHalo;
    let badgeSize = 20;
    let badgeRot = -0.08;

    if (isRotten) {
      badgeLabel = '已腐';
      badgeColor = 0x992315;
      badgeRot = -0.12;
    } else if (!this._inFridgeTut && isDish && urgentNeed > 0) {
      badgeLabel = '待交';
      badgeColor = 0xB82918;
      badgeHalo = 0xFFFDF6;
    } else if (!this._inFridgeTut && !isDish && urgentNeed > 0 && totalCleanQty <= urgentNeed) {
      badgeLabel = '急用';
      badgeColor = 0xB82918;
      badgeHalo = 0xFFFDF6;
    } else if (!this._inFridgeTut && !isDish && urgentNeed > 0 && totalCleanQty > urgentNeed) {
      badgeLabel = '备料';
      badgeColor = 0x9E5408;
      badgeHalo = 0xFFFDF4;
      badgeSize = 19;
    } else if (!this._inFridgeTut && !isDish && totalCleanQty >= 6) {
      badgeLabel = '富余';
      badgeColor = 0x1F6B4A;
      badgeHalo = 0xF5FFFA;
    } else if (!isDish && it.quality === 'god') {
      badgeLabel = '极鲜';
      badgeColor = 0xA65206;
      badgeHalo = 0xFFFBE6;
      badgeRot = 0;
    } else if (rarity === 'legendary') {
      badgeLabel = '珍品';
      badgeColor = 0x6422A2;
      badgeHalo = 0xFCF5FF;
      badgeRot = 0;
    } else if (!this._inFridgeTut && !isDish && totalCleanQty === 1) {
      badgeLabel = '仅1份';
      badgeColor = 0x7A5026;
      badgeHalo = 0xFFFDF6;
      badgeSize = 18;
      badgeRot = 0;
    }

    if (badgeLabel) {
      const tag = makeText('caption', badgeLabel, badgeColor, {
        size: badgeSize,
        fontWeight: '700',
        stroke: badgeHalo,
        strokeWidth: 4.5,
      });
      tag.anchor.set(0.5);
      tag.rotation = badgeRot;
      tag.position.set(-34, 28 + liftY);
      root.addChild(tag);
    }

    // 右下角始终显示清晰数量 ×N（含 ×1，让谁多谁少一目了然）
    const qtyColor = selected
      ? FRIDGE_INK.selectedInk
      : qty >= 6
        ? 0x185C3F
        : qty === 1
          ? 0x3D594E
          : FRIDGE_INK.deepInk;
    const qtyTxt = makeText('number', `×${qty}`, qtyColor, {
      size: qty > 1 ? 24 : 21,
      stroke: selected ? FRIDGE_INK.selectedHalo : FRIDGE_INK.creamHalo,
      strokeWidth: 4.5,
    });
    qtyTxt.anchor.set(1, 1);
    qtyTxt.position.set(cellW / 2 - 8, 112 + liftY);
    root.addChild(qtyTxt);

    // 冷藏隔板前沿书写菜名/食材名
    const shortName = fridgeItemName(it);
    const nameTxt = makeText(
      'caption',
      shortName,
      selected ? FRIDGE_INK.selectedInk : (isRotten ? 0x5A524A : FRIDGE_INK.deepInk),
      {
        size: 22,
        fontWeight: '700',
        stroke: selected ? FRIDGE_INK.selectedHalo : FRIDGE_INK.creamHalo,
        strokeWidth: 4.5,
      },
    );
    nameTxt.anchor.set(0.5, 0);
    nameTxt.position.set(0, 122);
    fitTextWidth(nameTxt, cellW - 8);
    root.addChild(nameTxt);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-cellW / 2 + 4, 8, cellW - 8, 150);
    root.on('pointertap', () => {
      if (this._scroller.moved) return;
      if (this._inFridgeTut && !this._isTutTargetDish(it)) {
        if (!TutorialGuard.block('inspectDish')) {
          AudioManager.play('ui_deny');
          Platform.showToast(TUTORIAL_DENY.fridgeDish);
        }
        return;
      }
      if (TutorialGuard.block('inspectDish')) return;
      AudioManager.play('ui_click');
      if (this._inspectUid === it.uid && !this._inFridgeTut) {
        this._fullModal = true;
      } else {
        this._inspectUid = it.uid;
        this._inspectQty = 1;
        this._fullModal = false;
      }
      TutorialManager.advanceIf(TutorialStep.INSPECT_DISH);
      this.relayout();
    });

    if (this._isTutTargetDish(it)) {
      this._tutSlot = root;
    }
    return root;
  }

  // ── 宣纸「冰箱库存盘点笺」：囤货最多（宜卖/消耗） + 紧缺待捡（菜单与菜谱缺口） ──
  private _drawInventoryLedger(
    scene: PIXI.Container,
    save: KitchenSave,
    snap: FridgeInventorySnapshot,
    used: number,
    cap: number,
    foodCount: number,
    dishCount: number,
  ): void {
    const sheetX = 36;
    const sheetY = 226;
    const sheetW = W - sheetX * 2;
    const sheetH = 870;
    const left = 64;
    const right = W - 64;
    const contentW = right - left;

    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetY, sheetW, sheetH, 140, 110);
    this._drawMagnetClip(scene, W / 2, sheetY + 2);

    // 1. 笺头：冰箱库存盘点笺 + 朱印 + 总览摘要（首行内收至 left+40 避开左上黄铜图钉）
    const titleX = left + 40;
    const title = makeText('title', '冰箱库存盘点笺', SCENE_INK.ink, { size: 30 });
    title.position.set(titleX, sheetY + 30);
    scene.addChild(title);

    const seal = makeSealStamp('盘点', 42, -0.06);
    seal.position.set(titleX + title.width + 28, sheetY + 48);
    scene.addChild(seal);

    const freeSlots = Math.max(0, cap - used);
    const summaryStr = `生鲜 ${snap.foodTotals.size}种(${foodCount}份) · 热菜 ${dishCount}盘 · 空余 ${freeSlots}格${snap.rottenQty > 0 ? ` · 变质 ${snap.rottenQty}份` : ''}`;
    const summaryTxt = makeText('caption', summaryStr, SCENE_INK.soft, {
      size: 21,
      fontWeight: '700',
    });
    summaryTxt.position.set(left, sheetY + 74);
    fitTextWidth(summaryTxt, contentW);
    scene.addChild(summaryTxt);

    drawInkDivider(scene, left, sheetY + 108, contentW, 0.45, 8);

    // 2. 上半卷：【囤货最多 · 可放心售卖/消耗】
    let curY = sheetY + 124;
    const sec1Head = makeText('heading', '囤货最多 · 可放心售卖或下锅消耗', SCENE_INK.green, { size: 24 });
    sec1Head.position.set(left, curY);
    scene.addChild(sec1Head);

    const sec1Tip = makeText('caption', '点任意行直达售卖', SCENE_INK.muted, { size: 19 });
    sec1Tip.anchor.set(1, 0);
    sec1Tip.position.set(right, curY + 4);
    scene.addChild(sec1Tip);
    curY += 38;

    if (snap.surplusList.length === 0) {
      const emptySurplus = makeText('body', '冰箱暂无富余囤货，先出门逛菜场挑些鲜货回来吧。', SCENE_INK.soft, {
        size: 22,
      });
      emptySurplus.position.set(left + 4, curY + 18);
      fitTextWidth(emptySurplus, contentW - 8);
      scene.addChild(emptySurplus);
      curY += 72;
    } else {
      for (const row of snap.surplusList) {
        const rowH = 54;
        const rowBox = new PIXI.Container();
        rowBox.position.set(left, curY);

        const rowBg = new PIXI.Graphics();
        rowBg.beginFill(0xF6EAD2, 0.55);
        rowBg.drawRoundedRect(0, 2, contentW, rowH - 4, 12);
        rowBg.endFill();
        rowBox.addChild(rowBg);

        const tex = row.kind === 'dish' ? dishTexture(row.defId) : itemLookTexture(row.defId, 'clean');
        if (isTextureReady(tex)) {
          const ic = new PIXI.Sprite(tex);
          fitSpriteInBox(ic, 40, 40);
          ic.anchor.set(0.5);
          ic.position.set(28, rowH / 2);
          ic.eventMode = 'none';
          rowBox.addChild(ic);
        }

        const nameQty = makeText('body', `${row.name} ×${row.totalQty}`, SCENE_INK.ink, {
          size: 23,
          fontWeight: '700',
        });
        nameQty.anchor.set(0, 0.5);
        nameQty.position.set(56, rowH / 2);
        fitTextWidth(nameQty, 178);
        rowBox.addChild(nameQty);

        const hintColor = row.urgentKeep > 0 && row.sellableQty === 0
          ? SCENE_INK.red
          : row.totalQty >= 6
            ? SCENE_INK.green
            : SCENE_INK.soft;
        const hintT = makeText('caption', row.hint, hintColor, {
          size: 20,
          fontWeight: '700',
        });
        hintT.anchor.set(0, 0.5);
        hintT.position.set(242, rowH / 2);
        fitTextWidth(hintT, contentW - 368);
        rowBox.addChild(hintT);

        if (row.unitPrice > 0) {
          const goldVal = row.sellableQty > 0 ? row.sellableGold : row.totalQty * row.unitPrice;
          const coinSp = sceneSprite(HUD_ICON.coin, 22, 22);
          const goldTxt = makeText(
            'number',
            row.sellableQty > 0 ? `可卖+${goldVal}` : `估值${goldVal}`,
            row.sellableQty > 0 ? SCENE_INK.gold : SCENE_INK.muted,
            { size: 21 },
          );
          goldTxt.anchor.set(1, 0.5);
          goldTxt.position.set(contentW - 12, rowH / 2);
          rowBox.addChild(goldTxt);
          if (coinSp) {
            coinSp.anchor.set(1, 0.5);
            coinSp.position.set(contentW - 16 - goldTxt.width, rowH / 2);
            rowBox.addChild(coinSp);
          }
        }

        rowBox.eventMode = 'static';
        rowBox.cursor = 'pointer';
        rowBox.hitArea = new PIXI.Rectangle(0, 0, contentW, rowH);
        bindUiClick(rowBox);
        rowBox.on('pointertap', () => {
          this._ledgerOpen = false;
          this._tab = row.kind;
          this._inspectUid = row.repItem.uid;
          const stackMax = fridgeItemQty(row.repItem);
          this._inspectQty = Math.max(1, Math.min(stackMax, row.sellableQty > 0 ? row.sellableQty : 1));
          this.relayout();
        });

        scene.addChild(rowBox);
        curY += rowH + 4;
      }
    }

    drawInkDivider(scene, left, curY + 8, contentW, 0.42, 8);
    curY += 24;

    // 3. 下半卷：【紧缺/待捡 · 菜单与菜谱缺口】
    const sec2Sub = makeText('caption', '按菜单·点单·菜谱盘点', SCENE_INK.muted, { size: 20 });
    sec2Sub.anchor.set(1, 0);
    sec2Sub.position.set(right, curY + 3);

    const sec2Head = makeText('heading', '紧缺待捡 · 下趟赶集留意', SCENE_INK.red, { size: 24 });
    sec2Head.position.set(left, curY);
    fitTextWidth(sec2Head, Math.max(220, contentW - sec2Sub.width - 16));
    scene.addChild(sec2Head, sec2Sub);
    curY += 38;

    if (snap.shortageList.length === 0) {
      const plentyTxt = makeText(
        'body',
        '当前菜单、街坊点单与常做菜谱食材均备货充足，可安心开火做菜！',
        SCENE_INK.green,
        { size: 22, fontWeight: '700' },
      );
      plentyTxt.position.set(left + 4, curY + 18);
      fitTextWidth(plentyTxt, contentW - 8);
      scene.addChild(plentyTxt);
    } else {
      for (const gapRow of snap.shortageList) {
        const rowH = 54;
        const rowBox = new PIXI.Container();
        rowBox.position.set(left, curY);

        const rowBg = new PIXI.Graphics();
        rowBg.beginFill(gapRow.urgent ? 0xFCE6DF : 0xF7EFE0, 0.62);
        rowBg.drawRoundedRect(0, 2, contentW, rowH - 4, 12);
        rowBg.endFill();
        rowBox.addChild(rowBg);

        const tex = itemLookTexture(gapRow.defId, 'clean');
        if (isTextureReady(tex)) {
          const ic = new PIXI.Sprite(tex);
          fitSpriteInBox(ic, 40, 40);
          ic.anchor.set(0.5);
          ic.position.set(28, rowH / 2);
          ic.eventMode = 'none';
          rowBox.addChild(ic);
        }

        const stockStr = gapRow.have === 0 ? `${gapRow.name}（缺）` : `${gapRow.name}（剩${gapRow.have}）`;
        const nameT = makeText('body', stockStr, gapRow.have === 0 ? SCENE_INK.red : SCENE_INK.ink, {
          size: 22,
          fontWeight: '700',
        });
        nameT.anchor.set(0, 0.5);
        nameT.position.set(56, rowH / 2);
        fitTextWidth(nameT, 178);
        rowBox.addChild(nameT);

        const reasonT = makeText('caption', gapRow.reason, gapRow.urgent ? SCENE_INK.red : SCENE_INK.soft, {
          size: 20,
          fontWeight: '700',
        });
        reasonT.anchor.set(0, 0.5);
        reasonT.position.set(240, rowH / 2);
        fitTextWidth(reasonT, contentW - 384);
        rowBox.addChild(reasonT);

        const mktT = makeText('caption', `去${gapRow.marketHint}`, FRIDGE_INK.mintAccent, {
          size: 20,
          fontWeight: '700',
        });
        mktT.anchor.set(1, 0.5);
        mktT.position.set(contentW - 12, rowH / 2);
        fitTextWidth(mktT, 136);
        rowBox.addChild(mktT);

        scene.addChild(rowBox);
        curY += rowH + 4;
      }
    }

    // 4. 底部操作按钮行
    const btnY = sheetY + sheetH - 92;
    const btnH = 58;
    drawInkDivider(scene, left, btnY - 18, contentW, 0.42, 8);

    if (snap.rottenSlots.length > 0) {
      const gap = 12;
      const cleanRotW = 192;
      const sortW = 186;
      const backW = contentW - cleanRotW - sortW - gap * 2;

      const cleanRotBtn = makeSlicedButton({
        label: `清变质×${snap.rottenQty}`,
        width: cleanRotW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 24,
        onReady: this._scheduleRelayout,
      });
      cleanRotBtn.position.set(left, btnY);
      cleanRotBtn.on('pointertap', () => this._clearAllRotten());

      const sortBtn = makeSlicedButton({
        label: '合并重排',
        width: sortW,
        height: btnH,
        skin: 'cream',
        fontSize: 24,
        onReady: this._scheduleRelayout,
      });
      sortBtn.position.set(left + cleanRotW + gap, btnY);
      sortBtn.on('pointertap', () => this._tidyFridge(true));

      const backBtn = makeSlicedButton({
        label: '返回层架',
        width: backW,
        height: btnH,
        skin: 'olive',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      backBtn.position.set(left + cleanRotW + sortW + gap * 2, btnY);
      backBtn.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._ledgerOpen = false;
        this.relayout();
      });

      scene.addChild(cleanRotBtn, sortBtn, backBtn);
    } else {
      const gap = 18;
      const sortW = 260;
      const backW = contentW - sortW - gap;

      const sortBtn = makeSlicedButton({
        label: '合并同类并重排',
        width: sortW,
        height: btnH,
        skin: 'gold',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      sortBtn.position.set(left, btnY);
      sortBtn.on('pointertap', () => this._tidyFridge(true));

      const backBtn = makeSlicedButton({
        label: '返回层架看菜',
        width: backW,
        height: btnH,
        skin: 'olive',
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      backBtn.position.set(left + sortW + gap, btnY);
      backBtn.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._ledgerOpen = false;
        this.relayout();
      });

      scene.addChild(sortBtn, backBtn);
    }
  }

  // ── 底部磁吸铜钉宣纸保鲜便签：呈现选中详情 + 决策建议 + 整理/丢弃/品尝/卖出 ──
  private _drawBottomSlip(
    scene: PIXI.Container,
    selected: FridgeItem | null,
    tabItemCount: number,
    snap: FridgeInventorySnapshot,
  ): void {
    const top = L.sheetTop;
    const left = L.padX;
    const right = W - L.padX;
    const contentW = right - left;

    if (!selected) {
      const showInspectTut = TutorialManager.isStep(TutorialStep.INSPECT_DISH)
        && KitchenManager.save.fridge.some((it) => fridgeKind(it) === 'dish' && it.defId === 'stirfry');

      const msg = showInspectTut
        ? '请轻触上方层架里的「炒菜苔」'
        : (tabItemCount === 0
          ? (this._tab === 'dish'
            ? '冰箱里还没有热菜，去灶台炒两盘吧'
            : '冰箱空空如也，出门去菜场挑点鲜货吧')
          : '点选层架上的食材或饭菜即可打理');
      const hint = makeText('title', msg, showInspectTut ? SCENE_INK.red : SCENE_INK.soft, {
        size: showInspectTut ? 27 : 26,
      });
      hint.anchor.set(0.5);
      hint.position.set(W / 2, showInspectTut ? top + 148 : top + 108);
      fitTextWidth(hint, contentW);
      scene.addChild(hint);

      if (!showInspectTut && !this._inFridgeTut) {
        if (snap.shortageList.length > 0) {
          const missNames = snap.shortageList.slice(0, 3).map((s) => s.name).join('、');
          const sub = makeText('caption', `待捡缺口：${missNames}（点「一键整理」看详情）`, SCENE_INK.red, {
            size: 21,
            fontWeight: '700',
          });
          sub.anchor.set(0.5);
          sub.position.set(W / 2, top + 154);
          fitTextWidth(sub, contentW);
          scene.addChild(sub);
        }

        const btnY = top + 204;
        const btnH = 60;
        const btnW = 242;
        const gap = 24;
        const startX = Math.round((W - (btnW * 2 + gap)) / 2);

        const tidyBtn = makeSlicedButton({
          label: '一键整理·盘点',
          width: btnW,
          height: btnH,
          skin: 'olive',
          fontSize: 25,
          onReady: this._scheduleRelayout,
        });
        tidyBtn.position.set(startX, btnY);
        tidyBtn.on('pointertap', () => this._tidyFridge(true));

        const closeBtn = makeSlicedButton({
          label: '关上冰箱',
          width: btnW,
          height: btnH,
          skin: 'wood',
          fontSize: 26,
          onReady: this._scheduleRelayout,
        });
        closeBtn.position.set(startX + btnW + gap, btnY);
        closeBtn.on('pointertap', () => this.close());

        scene.addChild(tidyBtn, closeBtn);
      }
      return;
    }

    const view = inspectFromFridge(selected);
    this._inspectQty = Math.max(1, Math.min(view.maxQty, this._inspectQty));
    const qty = this._inspectQty;
    const unit = view.unitPrice;
    const goldN = unit * qty;
    const canEat = view.kind === 'dish' && !!view.eatLabel;

    // 左：选中物展示（紧贴食材/成菜边缘品质轮廓光，生鲜垫干净白瓷保鲜碟，成菜放大至 126px 配柔和底影）
    const plateCx = left + 58;
    const plateCy = top + 108;
    const slipTier = resolveRarityTier(view.rarity, view.quality);
    if (view.kind === 'dish') {
      const dishShadow = new PIXI.Graphics();
      dishShadow.beginFill(0x2A1A0E, 0.22);
      dishShadow.drawEllipse(plateCx, plateCy + 34, 52, 15);
      dishShadow.endFill();
      dishShadow.eventMode = 'none';
      scene.addChild(dishShadow);

      const dTex = dishTexture(view.defId);
      if (isTextureReady(dTex)) {
        const ic = new PIXI.Sprite(dTex);
        fitSpriteInBox(ic, 126, 126);
        ic.anchor.set(0.5);
        ic.position.set(plateCx, plateCy - 2);
        ic.eventMode = 'none';
        scene.addChild(ic);
        if (view.quality !== 'rotten') {
          attachSpriteContour(scene, ic, slipTier, { selected: slipTier !== 'common' });
        }
      }
    } else {
      const trayShadow = new PIXI.Graphics();
      trayShadow.beginFill(0x2A1A0E, 0.16);
      trayShadow.drawEllipse(plateCx, plateCy + 32, 50, 14);
      trayShadow.endFill();
      trayShadow.eventMode = 'none';
      scene.addChild(trayShadow);

      const tray = sceneSprite(ART.tray, 130, 80);
      if (tray) {
        tray.anchor.set(0.5);
        tray.position.set(plateCx, plateCy + 12);
        if (view.quality === 'rotten') tray.tint = 0xD8CCB8;
        scene.addChild(tray);
      }
      const iconTex = itemLookTexture(view.defId, view.quality === 'rotten' ? 'rotten' : 'clean');
      if (isTextureReady(iconTex)) {
        const ic = new PIXI.Sprite(iconTex);
        fitSpriteInBox(ic, 86, 86);
        ic.anchor.set(0.5, 1);
        ic.position.set(plateCx, plateCy + 23);
        ic.eventMode = 'none';
        if (view.quality === 'rotten') ic.tint = 0xC8BCA8;
        scene.addChild(ic);
        if (view.quality !== 'rotten') {
          attachSpriteContour(scene, ic, slipTier, { selected: slipTier !== 'common' });
        }
      }
    }
    if (!this._inFridgeTut) {
      const hitPlate = new PIXI.Container();
      hitPlate.eventMode = 'static';
      hitPlate.cursor = 'pointer';
      hitPlate.hitArea = new PIXI.Rectangle(plateCx - 62, plateCy - 60, 124, 110);
      hitPlate.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._fullModal = true;
        this.relayout();
      });
      scene.addChild(hitPlate);
    }

    // 中：名称 + 品阶朱印 + 单价/食效 + 智能库存买卖决策提示
    const infoX = left + 132;
    const showStepper = view.maxQty > 1 && !this._inFridgeTut;
    const stepperCx = right - 110;
    const infoRight = showStepper ? stepperCx - 82 : right - 30;

    const title = makeText('title', view.title, SCENE_INK.ink, { size: 30 });
    title.position.set(infoX, top + 32);
    fitTextWidth(title, Math.max(96, infoRight - infoX - 54));
    scene.addChild(title);

    const seal = view.quality === 'rotten'
      ? makeSealStamp('已腐', 44, -0.08)
      : makeRaritySeal(slipTier, 44, -0.08);
    seal.position.set(infoX + title.width + 28, top + 52);
    scene.addChild(seal);

    // 第二行：食效或单价状态
    const line2Y = top + 80;
    if (view.eatLabel) {
      const eatTxt = makeText('body', `食效 · ${view.eatLabel}`, SCENE_INK.green, {
        size: 22,
        fontWeight: '700',
      });
      eatTxt.position.set(infoX, line2Y);
      fitTextWidth(eatTxt, right - infoX);
      scene.addChild(eatTxt);
    } else if (unit > 0) {
      const pRow = new PIXI.Container();
      pRow.position.set(infoX, line2Y + 13);
      const cSp = sceneSprite(HUD_ICON.coin, 25, 25);
      let px = 0;
      if (cSp) {
        cSp.anchor.set(0, 0.5);
        pRow.addChild(cSp);
        px = 29;
      }
      const pTxt = makeText(
        'number',
        `${unit}/份${view.note ? `  ·  ${view.note}` : ''}`,
        SCENE_INK.gold,
        { size: 22 },
      );
      pTxt.anchor.set(0, 0.5);
      pTxt.position.set(px, 0);
      fitTextWidth(pTxt, right - infoX - px);
      pRow.addChild(pTxt);
      scene.addChild(pRow);
    } else {
      const rotTxt = makeText('body', '已变质腐坏 · 不可下锅，请及时丢弃', SCENE_INK.red, {
        size: 22,
        fontWeight: '700',
      });
      rotTxt.position.set(infoX, line2Y);
      fitTextWidth(rotTxt, right - infoX);
      scene.addChild(rotTxt);
    }

    // 第三行：智能库存决策建议（非教学态优先给出急用/富余/孤本提示，无特殊状态则展示风味评述）
    const advice = this._buildItemDecisionLine(selected, snap);
    if (!this._inFridgeTut && advice) {
      const advTxt = makeText('body', advice.text, advice.color, {
        size: 21,
        fontWeight: '700',
      });
      advTxt.position.set(infoX, top + 116);
      fitTextWidth(advTxt, right - infoX);
      scene.addChild(advTxt);

      const blurbShort = view.blurb.length > 22 ? `${view.blurb.slice(0, 21)}…` : view.blurb;
      const subBlurb = makeText('caption', blurbShort, SCENE_INK.soft, { size: 20 });
      subBlurb.position.set(infoX, top + 148);
      fitTextWidth(subBlurb, right - infoX);
      scene.addChild(subBlurb);
    } else {
      const blurb = makeText('body', view.blurb, SCENE_INK.soft, {
        size: 22,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: right - infoX,
        lineHeight: 28,
      });
      blurb.position.set(infoX, top + 116);
      if (blurb.height > 58) {
        blurb.text = view.blurb.length > 26 ? `${view.blurb.slice(0, 25)}…` : view.blurb;
      }
      scene.addChild(blurb);
    }

    // 右上：份数加减器
    if (showStepper) {
      scene.addChild(this._makeSlipStepper(stepperCx, top + 52, qty, view.maxQty));
    }

    drawInkDivider(scene, left, top + 188, contentW, 0.48, 10);

    const btnY = top + 212;
    const btnH = 58;

    if (this._inFridgeTut) {
      const gap = 16;
      const eatW = 212;
      const sellW = contentW - eatW - gap;
      const eatBtn = makeSlicedButton({
        label: '品尝享用',
        width: eatW,
        height: btnH,
        skin: 'olive',
        fontSize: 27,
        onReady: this._scheduleRelayout,
      });
      eatBtn.position.set(left, btnY);
      eatBtn.on('pointertap', () => this._handleEat(selected));
      scene.addChild(eatBtn);

      const sellBtn = makeCoinButton({
        prefix: '卖出',
        price: goldN,
        width: sellW,
        height: btnH,
        skin: 'gold',
        textColor: SCENE_INK.ink,
        fontSize: 28,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      sellBtn.position.set(left + eatW + gap, btnY);
      sellBtn.on('pointertap', () => this._handleSell(selected));
      this._sellBtn = sellBtn;
      scene.addChild(sellBtn);
      return;
    }

    if (canEat) {
      // 饭菜四钮：整理 | 丢弃 | 品尝 | 卖出
      const gap = 10;
      const tidyW = 126;
      const dropW = 114;
      const eatW = 136;
      const sellW = contentW - tidyW - dropW - eatW - gap * 3;

      const tidyBtn = makeSlicedButton({
        label: '一键整理',
        width: tidyW,
        height: btnH,
        skin: 'cream',
        fontSize: 23,
        onReady: this._scheduleRelayout,
      });
      tidyBtn.position.set(left, btnY);
      tidyBtn.on('pointertap', () => this._tidyFridge(true));

      const dropBtn = makeSlicedButton({
        label: '丢弃',
        width: dropW,
        height: btnH,
        skin: 'wood',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      dropBtn.position.set(left + tidyW + gap, btnY);
      dropBtn.on('pointertap', () => this._discardItem(selected, qty));

      const eatBtn = makeSlicedButton({
        label: '品尝',
        width: eatW,
        height: btnH,
        skin: 'olive',
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      eatBtn.position.set(left + tidyW + dropW + gap * 2, btnY);
      eatBtn.on('pointertap', () => this._handleEat(selected));

      const sellBtn = makeCoinButton({
        prefix: '卖',
        price: goldN,
        width: sellW,
        height: btnH,
        skin: 'gold',
        textColor: SCENE_INK.ink,
        fontSize: 25,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      sellBtn.position.set(left + tidyW + dropW + eatW + gap * 3, btnY);
      sellBtn.on('pointertap', () => this._handleSell(selected));
      this._sellBtn = sellBtn;

      scene.addChild(tidyBtn, dropBtn, eatBtn, sellBtn);
    } else {
      // 食材三钮：一键整理 | 丢弃 | 卖出
      const gap = 12;
      const tidyW = 172;
      const dropW = 156;
      const sellW = contentW - tidyW - dropW - gap * 2;

      const tidyBtn = makeSlicedButton({
        label: '一键整理',
        width: tidyW,
        height: btnH,
        skin: 'cream',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      tidyBtn.position.set(left, btnY);
      tidyBtn.on('pointertap', () => this._tidyFridge(true));

      const dropBtn = makeSlicedButton({
        label: qty > 1 ? `丢弃×${qty}` : '丢弃',
        width: dropW,
        height: btnH,
        skin: unit <= 0 ? 'terracotta' : 'wood',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      dropBtn.position.set(left + tidyW + gap, btnY);
      dropBtn.on('pointertap', () => this._discardItem(selected, qty));

      const sellBtn = unit > 0
        ? makeCoinButton({
          prefix: '卖出',
          price: goldN,
          width: sellW,
          height: btnH,
          skin: 'gold',
          textColor: SCENE_INK.ink,
          fontSize: 26,
          silent: true,
          onReady: this._scheduleRelayout,
        })
        : makeSlicedButton({
          label: '已坏不可卖',
          width: sellW,
          height: btnH,
          skin: 'cream',
          textColor: 0x8A7358,
          fontSize: 24,
          silent: true,
          onReady: this._scheduleRelayout,
        });
      sellBtn.position.set(left + tidyW + dropW + gap * 2, btnY);
      sellBtn.on('pointertap', () => {
        if (unit <= 0) {
          AudioManager.play('ui_deny');
          Platform.showToast('变质食材卖不掉，点旁边的「丢弃」清理腾格吧');
          return;
        }
        this._handleSell(selected);
      });
      this._sellBtn = sellBtn;

      scene.addChild(tidyBtn, dropBtn, sellBtn);
    }
  }

  private _buildItemDecisionLine(
    it: FridgeItem,
    snap: FridgeInventorySnapshot,
  ): { text: string; color: number } | null {
    if (fridgeKind(it) === 'dish') {
      const rid = it.defId as RecipeId;
      const total = snap.dishTotals.get(rid) ?? fridgeItemQty(it);
      const urgent = snap.urgentDishNeed.get(rid);
      if (urgent && urgent.need > 0) {
        return {
          text: `菜单/街坊急需 ${urgent.need} 盘（现存 ${total} 盘）· 建议留着交单领赏！`,
          color: SCENE_INK.red,
        };
      }
      if (total >= 3) {
        return {
          text: `同款热菜共 ${total} 盘 · 富余宜趁热卖出换钱或享用补体力`,
          color: SCENE_INK.green,
        };
      }
      return null;
    }

    if (it.quality === 'rotten') return null;
    const total = snap.foodTotals.get(it.defId) ?? fridgeItemQty(it);
    const urgent = snap.urgentFoodNeed.get(it.defId);
    if (urgent && urgent.need > 0) {
      const dishLabel = urgent.dishNames[0] ?? '急单';
      if (total <= urgent.need) {
        return {
          text: `急用备料（${dishLabel}需 ${urgent.need} 份，现存 ${total} 份）· 切勿误卖！`,
          color: SCENE_INK.red,
        };
      }
      return {
        text: `${dishLabel}需留 ${urgent.need} 份 · 其余 ${total - urgent.need} 份富余可放心卖`,
        color: 0x9E5408,
      };
    }

    if (total >= 6) {
      return {
        text: `总库存 ${total} 份 · 富余宜卖钱腾格，或去灶台猛炒消耗`,
        color: SCENE_INK.green,
      };
    }

    if (total === 1) {
      const mkt = findFoodSourceLabel(it.defId, KitchenManager.save.level);
      return {
        text: `全柜仅剩最后 1 份 · 建议留作备料（缺货可去${mkt}补）`,
        color: 0x8F4B06,
      };
    }

    return {
      text: `全柜现存 ${total} 份 · 备货适中`,
      color: FRIDGE_INK.mintAccent,
    };
  }

  private _makeSlipStepper(cx: number, cy: number, qty: number, max: number): PIXI.Container {
    const root = new PIXI.Container();
    const span = 62;
    const mkBtn = (glyph: string, on: boolean, dx: number, delta: number) => {
      const b = new PIXI.Container();
      const g = new PIXI.Graphics();
      g.lineStyle(2.2, UI_PALETTE.ink, 1);
      g.beginFill(on ? UI_PALETTE.terracotta : 0xDFD2BE, 1);
      g.drawCircle(0, 0, 19);
      g.endFill();
      const t = makeText('heading', glyph, on ? 0xFFF8F0 : SCENE_INK.muted, {
        size: 24,
        ...(on ? { stroke: UI_PALETTE.ink, strokeWidth: 3 } : {}),
      });
      t.anchor.set(0.5);
      t.position.set(0, -1);
      b.addChild(g, t);
      b.position.set(cx + dx, cy);
      b.alpha = on ? 1 : 0.52;
      b.eventMode = 'static';
      b.cursor = on ? 'pointer' : 'default';
      b.hitArea = new PIXI.Circle(0, 0, 24);
      if (on) {
        bindUiClick(b);
        b.on('pointertap', (e) => {
          e.stopPropagation();
          this._inspectQty = Math.max(1, Math.min(max, qty + delta));
          this.relayout();
        });
      }
      return b;
    };
    const label = makeText('number', `${qty}/${max}`, SCENE_INK.ink, { size: 24 });
    label.anchor.set(0.5);
    label.position.set(cx, cy - 1);
    root.addChild(mkBtn('－', qty > 1, -span, -1), label, mkBtn('＋', qty < max, span, 1));
    return root;
  }

  private _handleSell(it: FridgeItem): void {
    if (TutorialGuard.block('sellDish')) return;
    const prevStep = TutorialManager.currentStep;
    const soldQty = this._inspectQty;
    const unitGold = fridgeItemUnitPrice(it, KitchenManager.save);
    if (!KitchenManager.sellQty(it.uid, soldQty)) return;
    analytics.trackFridgeAction({
      action: 'sell',
      defId: it.defId,
      itemCount: soldQty,
      goldGained: unitGold * soldQty,
    });
    TutorialManager.onSold(it.uid);
    this._fullModal = false;
    this._inspectQty = 1;
    if (TutorialManager.currentStep !== prevStep && TutorialManager.at(TutorialStep.CLAIM_GIFT, TutorialStep.HINT_DOOR)) {
      this.close(true);
    } else {
      this.relayout();
    }
    this.onChange?.();
  }

  private _handleEat(it: FridgeItem): void {
    if (TutorialGuard.block('eatDish')) return;
    const eatQty = this._inspectQty;
    if (!KitchenManager.eat(it.uid, eatQty)) return;
    analytics.trackFridgeAction({
      action: 'eat',
      defId: it.defId,
      itemCount: eatQty,
    });
    this._fullModal = false;
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }

  private _discardItem(it: FridgeItem, qty: number): void {
    if (this._inFridgeTut) return;
    const save = KitchenManager.save;
    const target = save.fridge.find((row) => row.uid === it.uid);
    if (!target) return;
    const have = fridgeItemQty(target);
    const drop = Math.min(have, Math.max(1, Math.floor(qty)));
    const itemName = fridgeItemName(target);
    const nextFridge = have > drop
      ? save.fridge.map((row) => (row.uid === it.uid ? { ...row, qty: have - drop } : row))
      : save.fridge.filter((row) => row.uid !== it.uid);

    SaveManager.replace({ ...save, fridge: nextFridge });
    KitchenManager.emit();
    AudioManager.play('ui_click');
    Platform.showToast(`已清理丢弃「${itemName}」×${drop}`);
    this._fullModal = false;
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }

  private _clearAllRotten(): void {
    if (this._inFridgeTut) return;
    const save = KitchenManager.save;
    const rotten = save.fridge.filter((it) => fridgeKind(it) === 'food' && it.quality === 'rotten');
    if (!rotten.length) return;
    const dropSum = fridgeQtySum(rotten);
    const nextFridge = save.fridge.filter((it) => !(fridgeKind(it) === 'food' && it.quality === 'rotten'));
    SaveManager.replace({ ...save, fridge: nextFridge });
    KitchenManager.emit();
    AudioManager.play('basket_discard');
    Platform.showToast(`已一键清理全部变质食材（共 ${dropSum} 份，腾出 ${rotten.length} 格）！`, 'success');
    this.relayout();
    this.onChange?.();
  }

  private _tidyFridge(openLedger = false): void {
    if (this._inFridgeTut) return;
    const save = KitchenManager.save;
    if (!save.fridge.length) {
      if (openLedger) {
        AudioManager.play('ui_click');
        this._ledgerOpen = true;
        this.relayout();
        return;
      }
      Platform.showToast('冰箱空空的，先去赶集捡菜吧');
      return;
    }

    const prevSlots = save.fridge.length;
    const cleanItems = save.fridge.filter((it) => fridgeKind(it) === 'dish' || it.quality !== 'rotten');
    const rottenItems = save.fridge.filter((it) => fridgeKind(it) === 'food' && it.quality === 'rotten');

    const mergedClean = cleanItems.reduce(
      (acc, it) => putIntoFridge(acc, { ...it, qty: fridgeItemQty(it) }),
      [] as FridgeItem[],
    );

    const mergedRotten: FridgeItem[] = [];
    for (const rot of rottenItems) {
      let left = fridgeItemQty(rot);
      for (const ex of mergedRotten) {
        if (left <= 0) break;
        if (ex.defId !== rot.defId) continue;
        const space = FRIDGE_STACK - fridgeItemQty(ex);
        if (space <= 0) continue;
        const add = Math.min(space, left);
        ex.qty = fridgeItemQty(ex) + add;
        left -= add;
      }
      if (left > 0) mergedRotten.push({ ...rot, qty: left });
    }

    const tempSave: KitchenSave = { ...save, fridge: [...mergedClean, ...mergedRotten] };
    const snap = buildInventorySnapshot(tempSave);

    const sortedFoods = this._sortItemsForView(
      mergedClean.filter((it) => fridgeKind(it) === 'food'),
      snap,
    );
    const sortedDishes = this._sortItemsForView(
      mergedClean.filter((it) => fridgeKind(it) === 'dish'),
      snap,
    );
    mergedRotten.sort((a, b) => a.defId.localeCompare(b.defId));

    const nextFridge = [...sortedFoods, ...sortedDishes, ...mergedRotten];
    const freed = Math.max(0, prevSlots - nextFridge.length);
    SaveManager.replace({ ...save, fridge: nextFridge });
    KitchenManager.emit();
    analytics.trackFridgeAction({
      action: 'organize',
      sortMode: this._sortMode,
      itemCount: nextFridge.length,
    });
    AudioManager.play('event_pop');

    if (openLedger) {
      this._ledgerOpen = true;
    }

    const toastParts: string[] = ['冰箱已合并归置整齐'];
    if (freed > 0) toastParts.push(`腾出 ${freed} 格`);
    if (mergedRotten.length > 0) toastParts.push(`${mergedRotten.length} 格变质可清理`);
    Platform.showToast(`${toastParts.join(' · ')}！`, 'success');

    this._scroller.reset();
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }
}
