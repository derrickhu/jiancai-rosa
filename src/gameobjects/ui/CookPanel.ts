import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren, destroyDisplayNode } from '@/utils/destroy';
import {
  CHEF_FIRE_XP_MUL,
  DAILY_AD_LIMITS,
  RARITY_STYLE,
  canUseDailyAd,
  chefFireRemainMs,
  computeKitchenSlip,
  dailyAdLeft,
  formatChefFireRemain,
  furnLevel,
  isChefFireActive,
  isRecipeStoveReady,
  kitchenSlipPins,
  recipeById,
  recipeCanCook,
  recipeCookCount,
  recipeCookMax,
  recipeEatLabel,
  recipeMasteryMul,
  recipeMasteryView,
  recipeMinStoveLv,
  recipeNeeds,
  recipeSellPrice,
  recipeUnlockView,
  recipeXp,
  stovePriceMul,
  unlockedRecipes,
  type KitchenSave,
  type RecipeDef,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  P0_ART,
  UI_BTN,
  UI_KIT,
  UI_PALETTE,
  attachSpriteContour,
  bindUiClick,
  fitTextWidth,
  makeAdButton,
  makeMasterySpoonRow,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import { cookPanelPaths } from '@/utils/panelAssets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeDishDisplay,
  makeRaritySeal,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, type TutorialTarget } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

const ART = {
  wall: 'subpkg_images/scene_pk_cellar_wall.png',
  cookBtn: 'subpkg_kitchen/ui_cook_btn.png',
  spot: 'subpkg_images/scene_dex_spot.png',
} as const;

const W = 720;
const L = {
  wallSliceTop: 430,
  wallSliceBottom: 64,
  shelfTop: 314,
  sheetTop: 492,
  sheetX: 26,
  headerH: 124,
  headX: 90,
  headR: 630,
  rowH: 106,
  secH: 46,
  contentX: 62,
  contentR: 658,
} as const;

type RecipeFilterTab = 'all' | 'ready' | 'home' | 'meat' | 'seafood' | 'soup_cold';

const FILTER_TABS: ReadonlyArray<{
  id: RecipeFilterTab;
  label: string;
  match?: (r: RecipeDef) => boolean;
}> = [
  { id: 'all', label: '全部' },
  { id: 'ready', label: '可做' },
  { id: 'home', label: '家常', match: (r) => r.group === '家常' },
  { id: 'meat', label: '荤菜', match: (r) => r.group === '荤' },
  { id: 'seafood', label: '水产', match: (r) => r.group === '水产' },
  { id: 'soup_cold', label: '汤·凉', match: (r) => r.group === '汤' || r.group === '凉菜' },
];

const GROUP_DISPLAY_LABEL: Record<string, string> = {
  家常: '家常小炒',
  荤: '荤菜硬菜',
  水产: '河海鲜货',
  汤: '暖胃汤羹',
  凉菜: '爽口凉菜',
};

const CREAM = 0xFFF6E2;
const WOOD_STROKE = 0x382010;

/**
 * 烟火灶台与食谱挂单场景：
 * 上段暖光灶台木架呈放青花大瓷碟成菜、大字名讳、售价/经验、三勺熟练度与无框食材余量；
 * 中段护墙板承载食效提示、连做份数、旺火激励与开火大按钮；
 * 下段铜钉宣纸挂单铺展全部已解锁食谱，可做/缺料与所需食材一目了然。
 */
export class CookPanel extends PIXI.Container {
  _isOpen = false;
  onUpgradeStove: (() => void) | null = null;
  private _root = new PIXI.Container();
  private _pick: RecipeId = 'stirfry';
  private _filterTab: RecipeFilterTab = 'all';
  private _cookQty = 1;
  private _inspect: ItemInspectView | null = null;
  private _scroller: VerticalScroller;
  private _cookBtn: PIXI.Container | null = null;
  private _chefFireText: PIXI.Text | null = null;
  private _wasChefFireActive = false;
  private _paintQueued = false;
  private _fireTimer = 0;
  private _adBusy = false;
  private _needScrollToPick = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 23;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    EventBus.on(EV.tutorialCook, this._onTutorialCook);
    EventBus.on(EV.kitchenChanged, this._scheduleRelayout);
  }

  private get _inCookTut(): boolean {
    return TutorialManager.at(TutorialStep.COOK_TABLE, TutorialStep.COOK_DISH);
  }

  open(recipeId?: RecipeId): void {
    if (!this._isOpen) AudioManager.play('cook_done');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    this._cookQty = 1;
    if (!this._inCookTut) warmupAdScene('chef_buff');
    const known = unlockedRecipes(recipeUnlockView(KitchenManager.save));
    this._filterTab = 'all';
    if (this._inCookTut) {
      this._pick = 'stirfry';
    } else if (recipeId && known.some((r) => r.id === recipeId)) {
      this._pick = recipeId;
    } else if (!known.some((r) => r.id === this._pick)) {
      this._pick = known[0]?.id ?? 'stirfry';
    }
    this._scroller.reset();
    this._scroller.enable();
    this._needScrollToPick = Boolean(recipeId);
    this._adBusy = false;
    this._armFireTimer();
    this.relayout();
    OverlayManager.bringToFront();
    if (this._isOpen) TutorialOverlay.register('cook', () => this.tutorialCookRect());
    TutorialManager.advanceIf(TutorialStep.COOK_TABLE);
  }

  close(silent = false): void {
    if (!silent && TutorialGuard.block('closeCook')) return;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._adBusy = false;
    this._paintQueued = false;
    this._chefFireText = null;
    this._clearFireTimer();
    this._scroller.disable();
    this._scroller.clear();
    TutorialOverlay.unregister('cook');
    destroyDisplayChildren(this._root);
  }

  private _armFireTimer(): void {
    this._clearFireTimer();
    this._wasChefFireActive = isChefFireActive(KitchenManager.save);
    this._fireTimer = globalThis.setInterval(() => {
      if (!this._isOpen || this._adBusy) return;
      const save = KitchenManager.save;
      const now = Date.now();
      const active = isChefFireActive(save, now);
      if (active) {
        this._wasChefFireActive = true;
        if (this._chefFireText && !this._chefFireText.destroyed) {
          const nextText = `旺火 ${formatChefFireRemain(chefFireRemainMs(save, now))}`;
          if (this._chefFireText.text !== nextText) {
            this._chefFireText.text = nextText;
          }
        }
        return;
      }
      if (this._wasChefFireActive) {
        this._wasChefFireActive = false;
        if (!this._inspect) this._scheduleRelayout();
      }
    }, 1000) as unknown as number;
  }

  private _clearFireTimer(): void {
    if (this._fireTimer) globalThis.clearInterval?.(this._fireTimer);
    this._fireTimer = 0;
  }

  tutorialCookRect(): TutorialTarget | null {
    if (!TutorialManager.isStep(TutorialStep.COOK_DISH) || !this._isOpen) return null;
    const cook = stageRectOf(this._cookBtn, 10);
    if (cook) {
      return {
        holes: [cook],
        fingerAt: { x: cook.x + cook.w * 0.5, y: cook.y + cook.h * 0.5 },
      };
    }
    return null;
  }

  private _warm(visibleRecipes: readonly RecipeDef[]): void {
    const save = KitchenManager.save;
    const view = recipeUnlockView(save);
    const paths: string[] = [
      ...Object.values(ART),
      ...sceneArtPaths(),
      ...cookPanelPaths(save, this._pick),
      HUD_ICON.coin,
      UI_KIT.closeRound,
      UI_KIT.btnGold,
      UI_KIT.btnOlive,
      UI_BTN.terracotta,
      UI_BTN.cream,
      P0_ART.chefFire,
      P0_ART.adClapper,
      ...P0_ART.spoons,
    ];
    for (const r of visibleRecipes.slice(0, 8)) {
      paths.push(resolveDishAssetPath(r.id));
      for (const n of recipeNeeds(view, r.id)) {
        paths.push(resolveItemAssetPath(n.iconId));
      }
    }
    watchTextures(paths, this._scheduleRelayout);
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

  relayout(): void {
    this._cookBtn = null;
    this._chefFireText = null;
    this._scroller.clear();
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;
    this._wasChefFireActive = isChefFireActive(KitchenManager.save);

    const sheetH = 580;
    const panelH = L.sheetTop + sheetH + 22;

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 44,
      onDimTap: () => {
        if (this._inspect) {
          this._inspect = null;
          this.relayout();
          return;
        }
        if (this._adBusy) return;
        if (TutorialGuard.block('closeCook')) return;
        this.close();
      },
    });

    drawSceneWall(scene, ART.wall, W, panelH, L.wallSliceTop, L.wallSliceBottom);
    drawPlaqueTitle(scene, '烟火灶台', W / 2);

    const save = KitchenManager.save;
    const view = recipeUnlockView(save);
    const known = unlockedRecipes(view);
    const recipe = known.find((r) => r.id === this._pick) ?? known[0];

    if (recipe) {
      this._pick = recipe.id;
      this._drawCounterStage(scene, recipe, view);
    }

    drawStretchSheet(scene, SCENE_ART.sheet, L.sheetX, L.sheetTop, W - L.sheetX * 2, sheetH, 140, 120);
    this._drawRecipeScroll(scene, known, view, sheetH, scale, toStage);

    drawSceneClose(scene, W - 46, -20, () => {
      if (this._adBusy) return;
      if (TutorialGuard.block('closeCook')) return;
      this.close();
    }, this._scheduleRelayout);

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onClose: () => {
          this._inspect = null;
          this.relayout();
        },
        onReady: this._scheduleRelayout,
      }));
    }
    TutorialOverlay.refresh();
  }

  // ── 上段灶台案板：大瓷碟菜肴 + 名讳/售价/熟练勺 + 无框食材余量 + 烹饪动作 ──
  private _drawCounterStage(
    scene: PIXI.Container,
    recipe: RecipeDef,
    view: ReturnType<typeof recipeUnlockView>,
  ): void {
    const save = KitchenManager.save;
    const needs = recipeNeeds(view, recipe.id);
    const max = recipeCookMax(save, recipe.id);
    this._cookQty = Math.max(1, Math.min(this._cookQty, Math.max(1, max)));
    const qty = max > 0 ? this._cookQty : 1;
    const stoveOk = isRecipeStoveReady(view, recipe.id);
    const needStoveLv = recipeMinStoveLv(recipe.id);
    const ready = recipeCanCook(view, recipe.id);
    const waiting = this._urgentRecipeIds(save).has(recipe.id);

    // 1. 案板左区：大尺寸 45° 立体成菜稳落案板柔和投影（避开左上蒜辫 x<=116，不叠青花底盘）
    const plateCx = 214;
    const dishCy = 248;
    const dishSize = 188;

    const dishGroup = new PIXI.Container();
    const boardShadow = new PIXI.Graphics();
    boardShadow.beginFill(0x1C0E06, 0.30);
    boardShadow.drawEllipse(plateCx, dishCy + 54, 76, 21);
    boardShadow.endFill();
    boardShadow.eventMode = 'none';
    dishGroup.addChild(boardShadow);

    const dTex = dishTexture(recipe.id);
    if (isTextureReady(dTex)) {
      const dishSp = new PIXI.Sprite(dTex);
      fitSpriteInBox(dishSp, dishSize, dishSize);
      dishSp.anchor.set(0.5);
      dishSp.position.set(plateCx, dishCy);
      dishSp.eventMode = 'none';
      dishGroup.addChild(dishSp);
      attachSpriteContour(dishGroup, dishSp, recipe.rarity, {
        onDark: true,
        selected: recipe.rarity !== 'common',
        thicknessScale: 1.08,
      });
    }
    if (waiting) {
      const waitSeal = makeSealStamp('急单', 50, -0.1);
      waitSeal.position.set(plateCx - 68, dishCy - 60);
      dishGroup.addChild(waitSeal);
    }
    dishGroup.eventMode = 'static';
    dishGroup.cursor = 'pointer';
    dishGroup.hitArea = new PIXI.Rectangle(plateCx - dishSize / 2, dishCy - 90, dishSize, 172);
    dishGroup.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._inspect = inspectFromRecipe(recipe.id);
      this.relayout();
    });
    scene.addChild(dishGroup);

    // 2. 案板右区（y=130..244 避开右上辣椒串 x>=608，y>=252 可延展至 668）
    const infoX = 326;
    const upperRight = 602;
    const mastery = recipeMasteryView(save, recipe.id);

    const name = makeText('title', recipe.name, CREAM, {
      size: 34,
      stroke: WOOD_STROKE,
      strokeWidth: 5,
    });
    name.position.set(infoX, 128);
    fitTextWidth(name, upperRight - infoX - 54);
    scene.addChild(name);

    const rSeal = makeRaritySeal(recipe.rarity, 46, 0.08);
    rSeal.position.set(upperRight - 22, 150);
    scene.addChild(rSeal);

    // 售价与厨艺经验直排（计入当前三勺熟练度加成与灶台火候售价加成）
    const estPrice = Math.round(
      recipeSellPrice(recipe.id)
      * recipeMasteryMul(mastery.cooked, recipe.rarity)
      * stovePriceMul(furnLevel(save, 'table')),
    );
    const baseXp = recipeXp(save, recipe.id);
    const fireOn = isChefFireActive(save);
    const shownXp = fireOn ? Math.round(baseXp * CHEF_FIRE_XP_MUL) : baseXp;

    const metaRow = new PIXI.Container();
    metaRow.position.set(infoX, 184);
    let mx = 0;
    const coinSp = sceneSprite(HUD_ICON.coin, 28, 28);
    if (coinSp) {
      coinSp.anchor.set(0, 0.5);
      metaRow.addChild(coinSp);
      mx = 32;
    }
    const metaStr = `${estPrice}  ·  厨艺+${shownXp}${fireOn ? '(旺火)' : ''}`;
    const metaTxt = makeText('number', metaStr, fireOn ? 0xFFBE78 : 0xFFE29A, {
      size: 24,
      stroke: WOOD_STROKE,
      strokeWidth: 4,
    });
    metaTxt.anchor.set(0, 0.5);
    metaTxt.position.set(mx, 0);
    fitTextWidth(metaTxt, upperRight - infoX - mx);
    metaRow.addChild(metaTxt);
    scene.addChild(metaRow);

    // 三勺星级熟练度（无框直排在木墙上，点击查看详情）
    if (!this._inCookTut) {
      const mRow = new PIXI.Container();
      mRow.position.set(infoX, 212);
      const spoons = makeMasterySpoonRow({
        stars: mastery.stars,
        size: 30,
        gap: 4,
        onReady: this._scheduleRelayout,
      });
      mRow.addChild(spoons);
      const bonusStr = mastery.stars >= 3
        ? '金勺售价+20%'
        : mastery.stars === 2
          ? '银勺售价+10%'
          : mastery.stars === 1
            ? '铜勺售价+5%'
            : `已做 ${mastery.cooked}/${mastery.nextNeed ?? 1} 锅`;
      const mTxt = makeText('caption', bonusStr, mastery.stars >= 1 ? 0xFFD984 : 0xF2DEC0, {
        size: 22,
        fontWeight: '700',
        stroke: WOOD_STROKE,
        strokeWidth: 4,
      });
      mTxt.anchor.set(0, 0.5);
      mTxt.position.set(3 * 30 + 2 * 4 + 10, 15);
      fitTextWidth(mTxt, upperRight - infoX - 108);
      mRow.addChild(mTxt);
      mRow.eventMode = 'static';
      mRow.cursor = 'pointer';
      mRow.hitArea = new PIXI.Rectangle(-4, -4, 276, 38);
      mRow.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        Platform.showToast(`${recipe.name} · ${mastery.title}（已做${mastery.cooked}锅）\n${mastery.bonusText}`);
      });
      scene.addChild(mRow);
    }

    // 3. 案板台面食材需求（大图标 + 有/要 直排，点击查看详情或提示缺料）
    let ix = infoX;
    const iy = 286;
    const maxItemSpan = Math.floor((674 - infoX) / Math.max(1, needs.length));
    for (const need of needs) {
      const req = need.need * qty;
      const ok = need.have >= req;
      const cell = new PIXI.Container();
      cell.position.set(ix, iy);

      const saucer = sceneSprite(ART.spot, 58, 58);
      if (saucer) {
        saucer.anchor.set(0.5);
        saucer.position.set(27, 0);
        saucer.alpha = ok ? 0.9 : 0.55;
        cell.addChild(saucer);
      }
      const iTex = itemTexture(need.iconId);
      if (isTextureReady(iTex)) {
        const ic = new PIXI.Sprite(iTex);
        fitSpriteInBox(ic, 48, 48);
        ic.anchor.set(0.5);
        ic.position.set(27, 0);
        if (!ok) ic.alpha = 0.65;
        cell.addChild(ic);
      }
      const cnt = makeText('number', `${need.have}/${req}`, ok ? 0xC6F6A6 : 0xFFA28E, {
        size: 25,
        stroke: WOOD_STROKE,
        strokeWidth: 5,
      });
      cnt.anchor.set(0, 0.5);
      cnt.position.set(58, 2);
      fitTextWidth(cnt, Math.max(46, maxItemSpan - 62));
      cell.addChild(cnt);

      const cellW = Math.min(maxItemSpan, 62 + Math.ceil(cnt.width) + 12);
      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(-4, -32, cellW + 8, 64);
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        if (!ok) {
          Platform.showToast(`还差 ${req - need.have} 份「${need.label}」`);
        }
        this._inspect = inspectFromItem(need.iconId);
        this.relayout();
      });
      scene.addChild(cell);
      ix += cellW;
    }

    // 4. 案板下护墙板第一行：食用功效 + 连做份数加减
    const buffY = 380;
    const showStepper = max > 1 && !this._inCookTut;
    const eatTxt = makeText('body', `食效 · ${recipeEatLabel(recipe.id)}`, 0xDCEDC2, {
      size: 23,
      fontWeight: '700',
      stroke: WOOD_STROKE,
      strokeWidth: 4,
    });
    eatTxt.anchor.set(0, 0.5);
    eatTxt.position.set(48, buffY);
    fitTextWidth(eatTxt, showStepper ? 410 : 624);
    scene.addChild(eatTxt);

    if (showStepper) {
      scene.addChild(this._makeWoodStepper(578, buffY, qty, max));
    }

    // 5. 案板下护墙板第二行：手绘旺火双倍激励钮 + 开火烹饪主按钮（灶台不足时一键跳升级）
    const btnY = 414;
    const btnH = 62;
    if (this._inCookTut) {
      const tutW = 408;
      const cookBtn = this._makeCookMainButton(tutW, btnH, ready, qty, stoveOk, needStoveLv);
      cookBtn.position.set(Math.round((W - tutW) / 2), btnY);
      this._cookBtn = cookBtn;
      scene.addChild(cookBtn);
    } else {
      const fireBtn = this._makeChefFireButton(266, btnH);
      fireBtn.position.set(48, btnY);
      scene.addChild(fireBtn);

      const cookW = 342;
      const cookBtn = this._makeCookMainButton(cookW, btnH, ready, qty, stoveOk, needStoveLv);
      cookBtn.position.set(W - 48 - cookW, btnY);
      this._cookBtn = cookBtn;
      scene.addChild(cookBtn);
    }
  }

  private _makeWoodStepper(cx: number, cy: number, qty: number, max: number): PIXI.Container {
    const root = new PIXI.Container();
    const span = 82;
    const mkBtn = (glyph: string, on: boolean, dx: number, delta: number) => {
      const b = new PIXI.Container();
      const g = new PIXI.Graphics();
      g.lineStyle(2.4, UI_PALETTE.ink, 1);
      g.beginFill(on ? UI_PALETTE.terracotta : 0x7A5A3E, 1);
      g.drawCircle(0, 0, 20);
      g.endFill();
      const t = makeText('heading', glyph, 0xFFF8F0, { size: 25, stroke: UI_PALETTE.ink, strokeWidth: 3 });
      t.anchor.set(0.5);
      t.position.set(0, -1);
      b.addChild(g, t);
      b.position.set(cx + dx, cy);
      b.alpha = on ? 1 : 0.48;
      b.eventMode = 'static';
      b.cursor = on ? 'pointer' : 'default';
      b.hitArea = new PIXI.Circle(0, 0, 26);
      if (on) {
        bindUiClick(b);
        b.on('pointertap', (e) => {
          e.stopPropagation();
          this._cookQty = Math.max(1, Math.min(max, qty + delta));
          this.relayout();
        });
      }
      return b;
    };
    const label = makeText('number', `${qty}/${max}锅`, CREAM, {
      size: 24,
      stroke: WOOD_STROKE,
      strokeWidth: 4,
    });
    label.anchor.set(0.5);
    label.position.set(cx, cy);
    root.addChild(mkBtn('－', qty > 1, -span, -1), label, mkBtn('＋', qty < max, span, 1));
    return root;
  }

  private _makeChefFireButton(width: number, height: number): PIXI.Container {
    const save = KitchenManager.save;
    const now = Date.now();
    const active = isChefFireActive(save, now);
    const remain = chefFireRemainMs(save, now);
    const left = dailyAdLeft(save, 'chef_buff', now);
    const canAd = canUseDailyAd(save, 'chef_buff', now);

    let btn: PIXI.Container;
    if (active) {
      btn = makeSlicedButton({
        label: `旺火 ${formatChefFireRemain(remain)}`,
        width,
        height,
        skin: 'gold',
        textColor: SCENE_INK.ink,
        fontSize: 24,
        labelOffsetX: 18,
        onReady: this._scheduleRelayout,
      });
      this._chefFireText = ((btn as any)._label as PIXI.Text | undefined) ?? null;
      const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
      const wok = sceneSprite(P0_ART.chefFire, 40, 40);
      if (wok) {
        wok.anchor.set(0.5);
        wok.position.set(34, height / 2 - 1);
        face.addChild(wok);
      }
    } else {
      this._chefFireText = null;
      btn = makeAdButton({
        label: '旺火·双份',
        width,
        height,
        skin: 'gold',
        badge: `${left}/${DAILY_AD_LIMITS.chef_buff}`,
        disabled: !canAd,
        onReady: this._scheduleRelayout,
      });
    }

    btn.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._adBusy) return;
      if (active && !canAd) {
        Platform.showToast(`旺火燃烧中（剩 ${formatChefFireRemain(remain)}）：经验+30%，35%概率出双份！`);
        return;
      }
      if (!canAd) {
        Platform.showToast('今日旺火次数已用完，明天再来');
        return;
      }
      this._adBusy = true;
      Platform.showRewardedVideo(
        'chef_buff',
        () => {
          this._adBusy = false;
          if (KitchenManager.activateChefFire()) {
            analytics.trackCookAction({
              action: 'ad_chef_fire',
              cookLevel: KitchenManager.save.level,
            });
          }
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    return btn;
  }

  private _makeCookMainButton(
    width: number,
    height: number,
    ready: boolean,
    qty: number,
    stoveOk = true,
    needStoveLv = 1,
  ): PIXI.Container {
    if (!stoveOk) {
      const upBtn = makeSlicedButton({
        label: `去升 ${needStoveLv} 级灶台`,
        width,
        height,
        skin: 'olive',
        textColor: 0xFFF8F0,
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      upBtn.on('pointertap', (e) => {
        e.stopPropagation();
        if (this.onUpgradeStove) {
          this.close(true);
          this.onUpgradeStove();
        } else {
          Platform.showToast(`请先在厨房将烹饪台升至 ${needStoveLv} 级`);
        }
      });
      return upBtn;
    }
    const label = ready
      ? (qty > 1 ? `开火做 ${qty} 锅` : '开火烹饪')
      : '食材不足';
    const btn = makeSlicedButton({
      label,
      width,
      height,
      path: ready ? ART.cookBtn : undefined,
      skin: ready ? 'terracotta' : 'cream',
      textColor: ready ? 0xFFF8F0 : 0x8A7358,
      fontSize: 28,
      silent: true,
      onReady: this._scheduleRelayout,
    });
    if (!ready) btn.alpha = 0.78;
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      if (!ready) {
        AudioManager.play('ui_deny');
        Platform.showToast('食材还不够，点上方食材查看详情或去菜场捡菜吧');
        return;
      }
      this._doCook();
    });
    return btn;
  }

  /** 今日菜单未交齐菜肴 + 街坊点单挂单菜肴，统一作为急单置顶并盖朱印。 */
  private _urgentRecipeIds(save: KitchenSave): Set<RecipeId> {
    const out = new Set<RecipeId>(KitchenManager.wantedNeighborRecipeIds());
    if (save.dailyMenu && !save.dailyMenu.boardClaimed) {
      for (const line of save.dailyMenu.lines) {
        if (line.done < line.need) out.add(line.recipeId);
      }
    }
    return out;
  }

  private _recipesForTab(
    tab: RecipeFilterTab,
    known: RecipeDef[],
    view: ReturnType<typeof recipeUnlockView>,
  ): RecipeDef[] {
    if (tab === 'all') return known;
    if (tab === 'ready') return known.filter((r) => recipeCookCount(view, r.id) > 0);
    const def = FILTER_TABS.find((t) => t.id === tab);
    return def?.match ? known.filter(def.match) : known;
  }

  private _drawFilterTabs(
    scene: PIXI.Container,
    known: RecipeDef[],
    view: ReturnType<typeof recipeUnlockView>,
    cookableTotal: number,
  ): void {
    const tabY = L.sheetTop + 62;
    const tabH = 42;
    const gap = 8;
    const totalAvailW = W - 104;
    const tabW = Math.floor((totalAvailW - gap * (FILTER_TABS.length - 1)) / FILTER_TABS.length);
    const startX = Math.round((W - (tabW * FILTER_TABS.length + gap * (FILTER_TABS.length - 1))) / 2);

    FILTER_TABS.forEach((tab, idx) => {
      const active = this._filterTab === tab.id;
      const node = new PIXI.Container();
      node.position.set(startX + idx * (tabW + gap), tabY);

      const bg = new PIXI.Graphics();
      if (active) {
        bg.beginFill(0x1E1108, 0.22);
        bg.drawRoundedRect(1, 3, tabW, tabH, 9);
        bg.endFill();
        bg.lineStyle(2.2, SCENE_INK.ink, 1);
        bg.beginFill(0x63381B, 1);
        bg.drawRoundedRect(0, 0, tabW, tabH, 9);
        bg.endFill();
        bg.lineStyle(1, 0xE7BF78, 0.85);
        bg.drawRoundedRect(3, 3, tabW - 6, tabH - 6, 6.5);
      } else {
        bg.lineStyle(1.8, 0x9A7C58, 0.88);
        bg.beginFill(0xEFE1C4, 0.92);
        bg.drawRoundedRect(0, 1, tabW, tabH - 2, 8);
        bg.endFill();
      }
      bg.eventMode = 'none';
      node.addChild(bg);

      const lbl = makeText(
        'heading',
        tab.label,
        active ? 0xFFF7E6 : SCENE_INK.soft,
        {
          size: 22,
          stroke: active ? 0x2B1608 : undefined,
          strokeWidth: active ? 2.5 : 0,
        },
      );
      lbl.anchor.set(0.5);
      fitTextWidth(lbl, tabW - 12);
      lbl.position.set(tabW / 2, tabH / 2 - 0.5);
      node.addChild(lbl);

      if (tab.id === 'ready' && cookableTotal > 0 && !active) {
        const dot = new PIXI.Graphics();
        dot.lineStyle(1.5, 0xFFF8EA, 1);
        dot.beginFill(SCENE_INK.green, 1);
        dot.drawCircle(tabW - 9, 9, 5);
        dot.endFill();
        dot.eventMode = 'none';
        node.addChild(dot);
      }

      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.hitArea = new PIXI.Rectangle(-2, -3, tabW + 4, tabH + 6);
      node.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._inCookTut && tab.id !== 'all') {
          TutorialGuard.block('pickRecipe');
          return;
        }
        if (this._filterTab === tab.id) return;
        AudioManager.play('ui_click');
        this._filterTab = tab.id;
        this._scroller.reset();
        this._needScrollToPick = false;
        const subset = this._recipesForTab(tab.id, known, view);
        if (subset.length > 0 && !subset.some((r) => r.id === this._pick)) {
          const urgent = this._urgentRecipeIds(KitchenManager.save);
          const firstUrgent = subset.find((r) => urgent.has(r.id));
          const firstReady = subset.find((r) => recipeCookCount(view, r.id) > 0);
          this._pick = (firstUrgent ?? firstReady ?? subset[0]).id;
          this._cookQty = 1;
        }
        this.relayout();
      });
      scene.addChild(node);
    });
  }

  // ── 下段铜钉宣纸挂单：分类书签筛选 + 分组大字食谱卷轴 ───────────────────
  private _drawRecipeScroll(
    scene: PIXI.Container,
    known: RecipeDef[],
    view: ReturnType<typeof recipeUnlockView>,
    sheetH: number,
    scale: number,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const save = KitchenManager.save;
    const cookableTotal = known.filter((r) => recipeCookCount(view, r.id) > 0).length;
    const headCy = L.sheetTop + 36;

    const headTitle = makeText('display', '食谱挂单', SCENE_INK.ink, { size: 30 });
    headTitle.anchor.set(0, 0.5);
    headTitle.position.set(L.headX, headCy);
    scene.addChild(headTitle);

    const headStat = makeText(
      'body',
      `可下锅 ${cookableTotal} / ${known.length} 道`,
      cookableTotal > 0 ? SCENE_INK.green : SCENE_INK.muted,
      { size: 22, fontWeight: '700' },
    );
    headStat.anchor.set(1, 0.5);
    headStat.position.set(L.headR, headCy);
    scene.addChild(headStat);

    this._drawFilterTabs(scene, known, view, cookableTotal);
    drawInkDivider(scene, L.contentX, L.sheetTop + L.headerH - 12, L.contentR - L.contentX, 0.62, 10);

    const slip = computeKitchenSlip(save);
    const wantedSet = this._urgentRecipeIds(save);

    const listTop = L.sheetTop + L.headerH;
    const listViewH = sheetH - L.headerH - 30;
    const content = new PIXI.Container();
    let cy = 0;
    let pickRowY = 0;

    const entries: Array<{
      y: number;
      h: number;
      recipe?: RecipeDef;
      render: () => PIXI.Container;
    }> = [];

    const addSectionHeader = (title: string, color: number) => {
      const y = cy;
      entries.push({
        y,
        h: L.secH,
        render: () => {
          const sec = new PIXI.Container();
          sec.position.set(0, y);
          const txt = makeText('heading', `· ${title} ·`, color, { size: 23 });
          txt.anchor.set(0.5);
          txt.position.set(W / 2, L.secH / 2 + 2);
          sec.addChild(txt);
          return sec;
        },
      });
      cy += L.secH;
    };

    const sortReadyFirst = (list: RecipeDef[]): RecipeDef[] =>
      [...list].sort((a, b) => {
        const sa = isRecipeStoveReady(view, a.id) ? 1 : 0;
        const sb = isRecipeStoveReady(view, b.id) ? 1 : 0;
        if (sa !== sb) return sb - sa;
        const ca = recipeCookCount(view, a.id) > 0 ? 1 : 0;
        const cb = recipeCookCount(view, b.id) > 0 ? 1 : 0;
        return cb - ca;
      });

    const addRecipeRow = (recipe: RecipeDef, showDivider: boolean) => {
      const y = cy;
      if (this._pick === recipe.id) pickRowY = y;
      entries.push({
        y,
        h: L.rowH,
        recipe,
        render: () => this._buildRecipeRow(recipe, y, showDivider, view, wantedSet),
      });
      cy += L.rowH;
    };

    const addEmptyHint = (title: string, sub: string) => {
      entries.push({
        y: 0,
        h: listViewH,
        render: () => {
          const empty = new PIXI.Container();
          empty.position.set(0, Math.round(listViewH * 0.30));
          const t1 = makeText('heading', title, SCENE_INK.soft, { size: 26 });
          t1.anchor.set(0.5);
          t1.position.set(W / 2, 0);
          const t2 = makeText('body', sub, SCENE_INK.muted, { size: 21 });
          t2.anchor.set(0.5);
          fitTextWidth(t2, L.contentR - L.contentX - 20);
          t2.position.set(W / 2, 42);
          empty.addChild(t1, t2);
          return empty;
        },
      });
      cy = listViewH;
    };

    if (this._filterTab === 'all') {
      const pinnedIds = [
        ...wantedSet,
        ...kitchenSlipPins(slip),
      ].filter((id, i, all) => known.some((r) => r.id === id) && all.indexOf(id) === i);
      const pinned = pinnedIds.map((id) => known.find((r) => r.id === id)!);
      const rest = known.filter((r) => !pinnedIds.includes(r.id));
      const orderedGroups = ['家常', '荤', '水产', '汤', '凉菜'];
      const groups = [
        ...orderedGroups.filter((g) => rest.some((r) => r.group === g)),
        ...[...new Set(rest.map((r) => r.group))].filter((g) => !orderedGroups.includes(g)),
      ];

      if (pinned.length) {
        addSectionHeader('急单与推荐', SCENE_INK.red);
        pinned.forEach((r, idx) => addRecipeRow(r, idx < pinned.length - 1));
      }
      for (const group of groups) {
        const listInGroup = sortReadyFirst(rest.filter((r) => r.group === group));
        if (!listInGroup.length) continue;
        addSectionHeader(GROUP_DISPLAY_LABEL[group] ?? group, SCENE_INK.soft);
        listInGroup.forEach((r, idx) => addRecipeRow(r, idx < listInGroup.length - 1));
      }
    } else if (this._filterTab === 'ready') {
      const readyList = known.filter((r) => recipeCookCount(view, r.id) > 0);
      if (!readyList.length) {
        addEmptyHint(
          '眼下暂无齐备可下锅的菜肴',
          '去菜场挑些鲜货回来，或点「全部」看看缺哪味食材吧',
        );
      } else {
        const urgentReady = readyList.filter((r) => wantedSet.has(r.id));
        const otherReady = readyList.filter((r) => !wantedSet.has(r.id));
        if (urgentReady.length) {
          addSectionHeader('急单优先', SCENE_INK.red);
          urgentReady.forEach((r, idx) => addRecipeRow(r, idx < urgentReady.length - 1));
        }
        if (otherReady.length) {
          if (urgentReady.length) addSectionHeader('食材齐备', SCENE_INK.green);
          otherReady.forEach((r, idx) => addRecipeRow(r, idx < otherReady.length - 1));
        }
      }
    } else {
      const activeDef = FILTER_TABS.find((t) => t.id === this._filterTab)!;
      const catList = this._recipesForTab(this._filterTab, known, view);
      if (!catList.length) {
        addEmptyHint(
          `暂未解锁「${activeDef.label}」食谱`,
          '升级灶台、开启寻味秘匣或老坛腌菜可习得更多拿手好菜',
        );
      } else {
        const urgentCat = sortReadyFirst(catList.filter((r) => wantedSet.has(r.id)));
        const restCat = sortReadyFirst(catList.filter((r) => !wantedSet.has(r.id)));
        if (urgentCat.length) {
          addSectionHeader('急单优先', SCENE_INK.red);
          urgentCat.forEach((r, idx) => addRecipeRow(r, idx < urgentCat.length - 1));
        }
        if (this._filterTab === 'soup_cold') {
          for (const subGroup of ['汤', '凉菜']) {
            const subList = restCat.filter((r) => r.group === subGroup);
            if (!subList.length) continue;
            addSectionHeader(GROUP_DISPLAY_LABEL[subGroup] ?? subGroup, SCENE_INK.soft);
            subList.forEach((r, idx) => addRecipeRow(r, idx < subList.length - 1));
          }
        } else if (restCat.length) {
          if (urgentCat.length) {
            addSectionHeader(GROUP_DISPLAY_LABEL[restCat[0].group] ?? activeDef.label, SCENE_INK.soft);
          }
          restCat.forEach((r, idx) => addRecipeRow(r, idx < restCat.length - 1));
        }
      }
    }

    const maxScroll = Math.max(0, cy - listViewH);
    if (this._needScrollToPick) {
      this._needScrollToPick = false;
      if (maxScroll > 0) {
        const targetOffset = Math.max(0, Math.min(maxScroll, pickRowY - listViewH * 0.3));
        this._scroller.y = -targetOffset;
      }
    }

    const initScrollTop = maxScroll <= 0 ? 0 : Math.max(0, Math.min(maxScroll, -this._scroller.y));
    const warmRecipes: RecipeDef[] = [];
    for (const e of entries) {
      if (!e.recipe) continue;
      if (e.y + e.h >= initScrollTop - 106) {
        warmRecipes.push(e.recipe);
        if (warmRecipes.length >= 6) break;
      }
    }
    if (warmRecipes.length < 6) {
      for (const e of entries) {
        if (!e.recipe || warmRecipes.includes(e.recipe)) continue;
        warmRecipes.push(e.recipe);
        if (warmRecipes.length >= 6) break;
      }
    }
    this._warm(warmRecipes);

    content.position.set(0, listTop);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xFFFFFF);
      mask.drawRect(L.sheetX + 10, listTop, W - (L.sheetX + 10) * 2, listViewH);
      mask.endFill();
      mask.eventMode = 'none';
      scene.addChild(mask);
      content.mask = mask;
    }
    scene.addChild(content);

    const BUFFER = 106;
    const mounted = new Map<number, PIXI.Container>();
    const syncWindow = (scrollY: number): void => {
      if (content.destroyed) return;
      const scrollTop = -scrollY;
      const minY = scrollTop - BUFFER;
      const maxY = scrollTop + listViewH + BUFFER;
      for (const [idx, node] of mounted) {
        const e = entries[idx];
        if (!e || e.y + e.h < minY || e.y > maxY) {
          mounted.delete(idx);
          destroyDisplayNode(node);
        }
      }
      for (let i = 0; i < entries.length; i++) {
        if (mounted.has(i)) continue;
        const e = entries[i];
        if (e.y + e.h < minY || e.y > maxY) continue;
        const node = e.render();
        content.addChild(node);
        mounted.set(i, node);
      }
    };

    const stageTopLeft = toStage(L.sheetX, listTop);
    this._scroller.attach({
      content,
      maxScroll,
      baseY: listTop,
      hit: {
        x: stageTopLeft.x,
        y: stageTopLeft.y,
        w: (W - L.sheetX * 2) * scale,
        h: listViewH * scale,
      },
      onScroll: syncWindow,
    });
  }

  private _buildRecipeRow(
    recipe: RecipeDef,
    rowY: number,
    showDivider: boolean,
    view: ReturnType<typeof recipeUnlockView>,
    wantedSet: Set<RecipeId>,
  ): PIXI.Container {
    const on = this._pick === recipe.id;
    const stoveOk = isRecipeStoveReady(view, recipe.id);
    const needStoveLv = recipeMinStoveLv(recipe.id);
    const can = recipeCookCount(view, recipe.id);
    const waiting = wantedSet.has(recipe.id);
    const needs = recipeNeeds(view, recipe.id);

    const row = new PIXI.Container();
    row.position.set(0, rowY);

    if (on) {
      const highlight = new PIXI.Graphics();
      highlight.beginFill(0xE8C788, 0.36);
      highlight.drawRoundedRect(L.contentX - 10, 4, L.contentR - L.contentX + 20, L.rowH - 10, 10);
      highlight.endFill();
      highlight.beginFill(SCENE_INK.red, 0.92);
      highlight.drawRoundedRect(L.contentX - 10, 14, 6, L.rowH - 30, 3);
      highlight.endFill();
      row.addChild(highlight);
    }

    const dishPath = resolveDishAssetPath(recipe.id);
    const dishSize = 90;
    const rowContourOpts = {
      selected: on,
      alpha: can === 0 && !on ? 0.55 : undefined,
      thicknessScale: 0.9,
    };
    const dishNode = makeDishDisplay({
      dishPath,
      size: dishSize,
      dim: can === 0 && !on,
      shadowAlpha: 0.20,
      rarity: recipe.rarity,
      contourOpts: rowContourOpts,
    });
    dishNode.position.set(L.contentX + 46, 54);
    row.addChild(dishNode);
    if (!isTextureReady(gameTexture(dishPath))) {
      whenTextureReady(dishPath, () => {
        if (dishNode.destroyed || !dishNode.parent) return;
        const tex = gameTexture(dishPath);
        if (!isTextureReady(tex)) return;
        const iconSp = new PIXI.Sprite(tex);
        fitSpriteInBox(iconSp, dishSize, dishSize);
        iconSp.anchor.set(0.5);
        iconSp.position.set(0, -Math.round(dishSize * 0.04));
        iconSp.eventMode = 'none';
        dishNode.addChild(iconSp);
        attachSpriteContour(dishNode, iconSp, recipe.rarity, rowContourOpts);
      });
    }

    const midX = L.contentX + 108;
    const rightColW = 148;
    const maxMidW = L.contentR - rightColW - midX;
    const nameColor = recipe.rarity !== 'common'
      ? RARITY_STYLE[recipe.rarity].ink
      : (can > 0 || on ? SCENE_INK.ink : SCENE_INK.soft);

    const rName = makeText(
      'title',
      recipe.name,
      nameColor,
      { size: 28 },
    );
    rName.position.set(midX, 14);
    fitTextWidth(rName, waiting ? maxMidW - 54 : maxMidW);
    if (can === 0 && !on) rName.alpha = 0.78;
    row.addChild(rName);

    if (waiting) {
      const seal = makeSealStamp('急单', 42, -0.08);
      seal.position.set(midX + rName.width + 26, 32);
      row.addChild(seal);
    }

    const needIcons = this._makeLazyNeedIcons(
      needs.map((n) => ({
        iconPath: resolveItemAssetPath(n.iconId),
        have: n.have,
        need: n.need,
      })),
      36,
      23,
      maxMidW + 10,
    );
    needIcons.position.set(midX, 74);
    if (can === 0 && !on) needIcons.alpha = 0.82;
    row.addChild(needIcons);

    const statusLabel = !stoveOk
      ? `需${needStoveLv}级灶台`
      : can > 0
        ? `可做 ${can} 锅`
        : '缺食材';
    const statusColor = !stoveOk
      ? 0xB85418
      : can > 0
        ? SCENE_INK.green
        : SCENE_INK.red;
    const statusTxt = makeText(
      'heading',
      statusLabel,
      statusColor,
      { size: !stoveOk ? 23 : 25 },
    );
    statusTxt.anchor.set(1, 0);
    statusTxt.position.set(L.contentR, 18);
    if (can === 0 && stoveOk && !on) statusTxt.alpha = 0.75;
    row.addChild(statusTxt);

    const save = KitchenManager.save;
    const mastery = recipeMasteryView(save, recipe.id);
    const priceVal = Math.round(
      recipeSellPrice(recipe.id)
      * recipeMasteryMul(mastery.cooked, recipe.rarity)
      * stovePriceMul(furnLevel(save, 'table')),
    );
    const priceTxt = makeText('number', `${priceVal}`, SCENE_INK.gold, { size: 23 });
    priceTxt.anchor.set(1, 0.5);
    priceTxt.position.set(L.contentR, 72);
    row.addChild(priceTxt);
    const cSp = sceneSprite(HUD_ICON.coin, 24, 24);
    if (cSp) {
      cSp.anchor.set(1, 0.5);
      cSp.position.set(L.contentR - priceTxt.width - 5, 72);
      row.addChild(cSp);
    }

    if (showDivider) {
      drawInkDivider(row, L.contentX, L.rowH - 8, L.contentR - L.contentX, 0.3, 8);
    }

    row.eventMode = 'static';
    row.cursor = 'pointer';
    row.hitArea = new PIXI.Rectangle(L.sheetX + 10, 0, W - (L.sheetX + 10) * 2, L.rowH);
    row.on('pointertap', () => {
      if (this._scroller.moved) return;
      if (this._inCookTut && recipe.id !== 'stirfry') {
        TutorialGuard.block('pickRecipe');
        return;
      }
      if (recipe.id !== 'stirfry' && TutorialGuard.block('pickRecipe')) return;
      AudioManager.play('ui_click');
      if (this._pick !== recipe.id) this._cookQty = 1;
      this._pick = recipe.id;
      this.relayout();
    });

    return row;
  }

  private _makeLazyNeedIcons(
    needs: Array<{ iconPath: string; have: number; need: number }>,
    iconSize: number,
    fontSize: number,
    maxW: number,
  ): PIXI.Container {
    const node = new PIXI.Container();
    node.eventMode = 'none';
    let x = 0;
    for (const n of needs) {
      const ok = n.have >= n.need;
      const t = makeText('number', `${n.have}/${n.need}`, ok ? SCENE_INK.green : SCENE_INK.red, {
        size: fontSize,
      });
      const w = iconSize + 4 + t.width;
      if (maxW && x + w > maxW) {
        destroyDisplayNode(t);
        break;
      }
      const slotX = x;
      const sp = sceneSprite(n.iconPath, iconSize, iconSize);
      if (sp) {
        sp.anchor.set(0, 0.5);
        sp.position.set(slotX, 0);
        node.addChild(sp);
      } else {
        whenTextureReady(n.iconPath, () => {
          if (node.destroyed || !node.parent) return;
          const rTex = gameTexture(n.iconPath);
          if (!isTextureReady(rTex)) return;
          const lateSp = new PIXI.Sprite(rTex);
          fitSpriteInBox(lateSp, iconSize, iconSize);
          lateSp.anchor.set(0, 0.5);
          lateSp.position.set(slotX, 0);
          lateSp.eventMode = 'none';
          node.addChild(lateSp);
        });
      }
      t.anchor.set(0, 0.5);
      t.position.set(slotX + iconSize + 4, 1);
      node.addChild(t);
      x += w + 14;
    }
    return node;
  }

  private _onTutorialCook = (): void => {
    if (!this._isOpen) return;
    this._pick = 'stirfry';
    this._doCook();
  };

  private _doCook(): void {
    if (this._inCookTut && this._pick !== 'stirfry') {
      TutorialGuard.block('cook');
      return;
    }
    if (TutorialGuard.block('cook')) return;
    const recipeId = this._pick;
    const batchQty = this._cookQty;
    const beforeSave = KitchenManager.save;
    const beforeLv = beforeSave.level;
    const beforeTickets = beforeSave.recipeTickets;
    const fireOn = isChefFireActive(beforeSave);
    const beforeCooked = recipeMasteryView(beforeSave, recipeId).cooked;

    const step = TutorialManager.currentStep;
    KitchenManager.cook(recipeId, batchQty);

    const afterSave = KitchenManager.save;
    const afterMastery = recipeMasteryView(afterSave, recipeId);
    const cookedDelta = Math.max(0, afterMastery.cooked - beforeCooked);
    if (cookedDelta > 0) {
      const levelsGained = Math.max(0, afterSave.level - beforeLv);
      const ticketsGained = Math.max(0, afterSave.recipeTickets - beforeTickets);
      analytics.trackCookAction({
        action: 'cook',
        recipeId,
        rarity: recipeById(recipeId)?.rarity ?? 'common',
        batchQty,
        cookedCount: cookedDelta,
        chefFireActive: fireOn,
        cookLevel: afterSave.level,
        levelsGained,
        masteryStars: afterMastery.stars,
        masteryTickets: ticketsGained,
      });
      if (levelsGained > 0) {
        analytics.trackCookLevelUp(beforeLv, afterSave.level, 'cook');
      }
    }

    TutorialManager.onCooked(recipeId);
    if (TutorialManager.currentStep !== step) {
      this.close(true);
      return;
    }
    if (this._isOpen) this.relayout();
  }
}
