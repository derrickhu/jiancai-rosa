import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CHEF_FIRE_XP_MUL,
  DAILY_AD_LIMITS,
  canUseDailyAd,
  chefFireRemainMs,
  computeKitchenSlip,
  dailyAdLeft,
  formatChefFireRemain,
  isChefFireActive,
  kitchenSlipPins,
  rarityLabel,
  recipeCanCook,
  recipeCookCount,
  recipeCookMax,
  recipeEatLabel,
  recipeMasteryMul,
  recipeMasteryView,
  recipeNeeds,
  recipeSellPrice,
  recipeUnlockView,
  recipeXp,
  unlockedRecipes,
  type RecipeDef,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  P0_ART,
  UI_BTN,
  UI_KIT,
  UI_PALETTE,
  bindUiClick,
  fitTextWidth,
  makeAdButton,
  makeMasterySpoonRow,
  makeRarityFlare,
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
  makeNeedIcons,
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
  headerH: 96,
  headX: 88,
  headR: 632,
  rowH: 106,
  secH: 46,
  contentX: 62,
  contentR: 658,
} as const;

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
  private _root = new PIXI.Container();
  private _pick: RecipeId = 'stirfry';
  private _cookQty = 1;
  private _inspect: ItemInspectView | null = null;
  private _scroller: VerticalScroller;
  private _cookBtn: PIXI.Container | null = null;
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
    this._warm();
  }

  close(silent = false): void {
    if (!silent && TutorialGuard.block('closeCook')) return;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._adBusy = false;
    this._paintQueued = false;
    this._clearFireTimer();
    this._scroller.disable();
    TutorialOverlay.unregister('cook');
    this._root.removeChildren();
  }

  private _armFireTimer(): void {
    this._clearFireTimer();
    this._fireTimer = globalThis.setInterval(() => {
      if (!this._isOpen || this._inspect || this._adBusy) return;
      if (isChefFireActive(KitchenManager.save)) this.relayout();
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

  private _warm(): void {
    const save = KitchenManager.save;
    const view = recipeUnlockView(save);
    const known = unlockedRecipes(view);
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
      'subpkg_kitchen/ui_pickup_flare.png',
    ];
    for (const r of known) {
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
    this._root.removeChildren();
    if (!this._isOpen) return;
    this._warm();

    const sheetH = 544;
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
    const ready = recipeCanCook(view, recipe.id);
    const waiting = KitchenManager.wantedNeighborRecipeIds().has(recipe.id);

    // 1. 案板左区：大尺寸 45° 立体成菜稳落案板柔和投影（避开左上蒜辫 x<=116，不叠青花底盘）
    const plateCx = 214;
    const dishCy = 248;
    const dishSize = 188;

    const flare = makeRarityFlare(recipe.rarity, 224);
    flare.position.set(plateCx, dishCy - 4);
    scene.addChild(flare);

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

    const rSeal = makeSealStamp(rarityLabel(recipe.rarity), 46, 0.08);
    rSeal.position.set(upperRight - 22, 150);
    scene.addChild(rSeal);

    // 售价与厨艺经验直排
    const estPrice = Math.round(recipeSellPrice(recipe.id) * recipeMasteryMul(mastery.cooked));
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
          : `已做 ${mastery.cooked} 锅`;
      const mTxt = makeText('caption', bonusStr, mastery.stars >= 2 ? 0xFFD984 : 0xF2DEC0, {
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

    // 5. 案板下护墙板第二行：手绘旺火双倍激励钮 + 开火烹饪主按钮
    const btnY = 414;
    const btnH = 62;
    if (this._inCookTut) {
      const tutW = 408;
      const cookBtn = this._makeCookMainButton(tutW, btnH, ready, qty);
      cookBtn.position.set(Math.round((W - tutW) / 2), btnY);
      this._cookBtn = cookBtn;
      scene.addChild(cookBtn);
    } else {
      const fireBtn = this._makeChefFireButton(266, btnH);
      fireBtn.position.set(48, btnY);
      scene.addChild(fireBtn);

      const cookW = 342;
      const cookBtn = this._makeCookMainButton(cookW, btnH, ready, qty);
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
      const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
      const wok = sceneSprite(P0_ART.chefFire, 40, 40);
      if (wok) {
        wok.anchor.set(0.5);
        wok.position.set(34, height / 2 - 1);
        face.addChild(wok);
      }
    } else {
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
          KitchenManager.activateChefFire();
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    return btn;
  }

  private _makeCookMainButton(width: number, height: number, ready: boolean, qty: number): PIXI.Container {
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

  // ── 下段铜钉宣纸挂单：分组大字食谱卷轴 ─────────────────────────────
  private _drawRecipeScroll(
    scene: PIXI.Container,
    known: RecipeDef[],
    view: ReturnType<typeof recipeUnlockView>,
    sheetH: number,
    scale: number,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const cookableTotal = known.filter((r) => recipeCookCount(view, r.id) > 0).length;
    const headCy = L.sheetTop + 56;

    const headTitle = makeText('display', '食谱挂单', SCENE_INK.ink, { size: 32 });
    headTitle.anchor.set(0, 0.5);
    headTitle.position.set(L.headX, headCy);
    scene.addChild(headTitle);

    const headStat = makeText(
      'body',
      `可下锅 ${cookableTotal} / ${known.length} 道`,
      cookableTotal > 0 ? SCENE_INK.green : SCENE_INK.muted,
      { size: 23, fontWeight: '700' },
    );
    headStat.anchor.set(1, 0.5);
    headStat.position.set(L.headR, headCy);
    scene.addChild(headStat);

    drawInkDivider(scene, L.contentX, L.sheetTop + L.headerH - 12, L.contentR - L.contentX, 0.62, 12);

    const slip = computeKitchenSlip(KitchenManager.save);
    const wantedSet = KitchenManager.wantedNeighborRecipeIds();
    const pinnedIds = [
      ...wantedSet,
      ...kitchenSlipPins(slip),
    ].filter((id, i, all) => known.some((r) => r.id === id) && all.indexOf(id) === i);
    const pinned = pinnedIds.map((id) => known.find((r) => r.id === id)!);
    const rest = known.filter((r) => !pinnedIds.includes(r.id));
    const groups = [...new Set(rest.map((r) => r.group))];

    const listTop = L.sheetTop + L.headerH;
    const listViewH = sheetH - L.headerH - 34;
    const content = new PIXI.Container();
    let cy = 0;
    let pickRowY = 0;

    const addSectionHeader = (title: string, color: number) => {
      const sec = new PIXI.Container();
      sec.position.set(0, cy);
      const txt = makeText('heading', `· ${title} ·`, color, { size: 23 });
      txt.anchor.set(0.5);
      txt.position.set(W / 2, L.secH / 2 + 2);
      sec.addChild(txt);
      content.addChild(sec);
      cy += L.secH;
    };

    const addRecipeRow = (recipe: RecipeDef, showDivider: boolean) => {
      const on = this._pick === recipe.id;
      if (on) pickRowY = cy;
      const can = recipeCookCount(view, recipe.id);
      const waiting = wantedSet.has(recipe.id);
      const needs = recipeNeeds(view, recipe.id);

      const row = new PIXI.Container();
      row.position.set(0, cy);

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

      // 左：立体成菜大图标直呈（去掉重复底盘，菜品细节一眼看清）
      const dishNode = makeDishDisplay({
        dishPath: resolveDishAssetPath(recipe.id),
        size: 90,
        dim: can === 0 && !on,
        shadowAlpha: 0.20,
      });
      dishNode.position.set(L.contentX + 46, 54);
      row.addChild(dishNode);

      // 中上：菜名 + 街坊急单朱印
      const midX = L.contentX + 108;
      const rightColW = 148;
      const maxMidW = L.contentR - rightColW - midX;

      const rName = makeText(
        'title',
        recipe.name,
        can > 0 || on ? SCENE_INK.ink : SCENE_INK.soft,
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

      // 中下：无框食材余量直排
      const needIcons = makeNeedIcons(
        needs.map((n) => ({
          iconPath: resolveItemAssetPath(n.iconId),
          have: n.have,
          need: n.need,
        })),
        { iconSize: 36, size: 23, maxW: maxMidW + 10 },
      );
      needIcons.node.position.set(midX, 74);
      if (can === 0 && !on) needIcons.node.alpha = 0.82;
      row.addChild(needIcons.node);

      // 右：可做锅数 / 缺料 + 售价
      const statusTxt = makeText(
        'heading',
        can > 0 ? `可做 ${can} 锅` : '缺食材',
        can > 0 ? SCENE_INK.green : SCENE_INK.red,
        { size: 25 },
      );
      statusTxt.anchor.set(1, 0);
      statusTxt.position.set(L.contentR, 18);
      if (can === 0 && !on) statusTxt.alpha = 0.75;
      row.addChild(statusTxt);

      const priceVal = recipeSellPrice(recipe.id);
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

      content.addChild(row);
      cy += L.rowH;
    };

    if (pinned.length) {
      addSectionHeader('急单与推荐', SCENE_INK.red);
      pinned.forEach((r, idx) => addRecipeRow(r, idx < pinned.length - 1));
    }

    for (const group of groups) {
      const listInGroup = rest.filter((r) => r.group === group);
      if (!listInGroup.length) continue;
      addSectionHeader(group, SCENE_INK.soft);
      listInGroup.forEach((r, idx) => addRecipeRow(r, idx < listInGroup.length - 1));
    }

    const maxScroll = Math.max(0, cy - listViewH);
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
    });

    if (this._needScrollToPick && maxScroll > 0) {
      this._needScrollToPick = false;
      const targetOffset = Math.max(0, Math.min(maxScroll, pickRowY - listViewH * 0.3));
      this._scroller.apply(-targetOffset);
    }
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
    const step = TutorialManager.currentStep;
    KitchenManager.cook(this._pick, this._cookQty);
    TutorialManager.onCooked(this._pick);
    if (TutorialManager.currentStep !== step) {
      this.close(true);
      return;
    }
    if (this._isOpen) this.relayout();
  }
}
