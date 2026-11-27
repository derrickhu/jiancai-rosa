import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { RecipeBookPanel } from '@/gameobjects/ui/RecipeBookPanel';
import { DexPanel } from '@/gameobjects/ui/DexPanel';
import { FridgePanel } from '@/gameobjects/ui/FridgePanel';
import { CookPanel } from '@/gameobjects/ui/CookPanel';
import { OrderPanel } from '@/gameobjects/ui/OrderPanel';
import { DailyMenuPanel } from '@/gameobjects/ui/DailyMenuPanel';
import { RecipeDrawPanel } from '@/gameobjects/ui/RecipeDrawPanel';
import { EventPanel } from '@/gameobjects/ui/EventPanel';
import { GameClubPanel } from '@/gameobjects/ui/GameClubPanel';
import { DouyinWelfarePanel } from '@/gameobjects/ui/DouyinWelfarePanel';
import { DouyinWelfareManager } from '@/managers/DouyinWelfareManager';
import { UpgradePanel } from '@/gameobjects/ui/UpgradePanel';
import { PicklePanel } from '@/gameobjects/ui/PicklePanel';
import { StrayCatPanel } from '@/gameobjects/ui/StrayCatPanel';
import { ensureRecipeUnlockPanel } from '@/gameobjects/ui/RecipeUnlockPanel';
import { ensureCookLevelUpPanel } from '@/gameobjects/ui/CookLevelUpPanel';
import { ensureTutorialGiftPanel } from '@/gameobjects/ui/TutorialGiftPanel';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import { Platform } from '@/core/PlatformService';
import { CdnAssetService } from '@/core/CdnAssetService';
import { clearCookReadyFx, playCookReadyFx } from '@/utils/cookReadyFx';
import {
  staminaMax,
  FURN_ART_MAX_LEVEL,
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_FALLBACK_SIZE,
  HOUSE_MAX_LEVEL,
  HOUSE_SCREENS,
  cloneLayout,
  dumpKitchenLayout,
  furnLabel,
  furnLevel,
  furnUpgradeState,
  houseDoor,
  houseFurnCap,
  houseLabel,
  houseLevel,
  houseRoomCandidates,
  houseUpgradeMark,
  houseUpgradeState,
  minHouseForFurn,
  cookXpView,
  furnCookNeed,
  cookLevel,
  canUseDailyAd,
  CAT_BAY_POSE,
  CAT_UNLOCK_LEVEL,
  catStateView,
  catUnlocked,
  dexRedDotCount,
  PICKLE_BAY_DUAL_POSES,
  PICKLE_BAY_POSE,
  PICKLE_UNLOCK_LEVEL,
  catBedTier,
  pickleFermentingCount,
  pickleReadyCount,
  pickleSlotView,
  pickleTier,
  pickleUnlocked,
  neighborOfferLog,
  neighborNpc,
  bagDryCols,
  bagRows,
  fridgeOwnCap,
  foamWetCols,
  foamWetRows,
  newlyCookableByTableUpgrade,
  recipeUnlockView,
  stovePriceMul,
  tableUnlockNext,
  computeFridgeSlip,
  computeKitchenSlip,
  dailyMenuRemain,
  kitchenSlipMissToast,
  liveHudBuffs,
  layoutFor,
  saveGmLayout,
  clampHouseLevel,
  buffIconPath,
  type FurnId,
  type FurnLayout,
  type KitchenSave,
} from '@/sim';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import {
  HUD_ICON,
  P2_ART,
  UI_KIT,
  UI_PALETTE,
  bindUiClick,
  fillRect,
  fitTextWidth,
  makeButton,
  makeCoinButton,
  makeHandProgressBar,
  makeLabel,
  makeMuteButton,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import {
  applyFit,
  fitSpriteInBox,
  fitWidthBottom,
  gameTexture,
  isTextureFailed,
  isTextureReady,
  mapNorm,
  retryTexture,
  trimTexturesToBudget,
  whenTextureReady,
} from '@/utils/assets';
import { kitchenBootPaths } from '@/utils/bootAssets';
import { setKitchenFridgeHudPos, setKitchenGachaHudPos } from '@/utils/coinCollect';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { destinationBootPaths } from '@/utils/outingAssets';
import { RunManager } from '@/managers/RunManager';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, worldRectToStage, type SpotlightRect, type TutorialTarget } from '@/gameobjects/ui/TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';
import { destroyDisplayChildren, isStageMounted } from '@/utils/destroy';

type HotspotId = 'door' | 'basket' | 'fridge' | 'foam' | 'board';
type UpgradePick = FurnId | 'house';

const DRAG_SLOP = 14;
const HOUSE_UPGRADE_SHIFT_X = 50;

const KITCHEN_SCENE_ART = {
  plaque: 'subpkg_images/scene_pk_plaque.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  sheet: 'subpkg_images/scene_pk_recipe_sheet.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  divider: 'subpkg_images/scene_pk_ink_divider.png',
  bubble: 'subpkg_images/scene_cat_bubble.png',
} as const;

const IDLE_DISK_PREFETCH_PATHS = [
  'subpkg_images/scene_pk_cellar_wall.png',
  'subpkg_images/scene_pk_recipe_sheet.png',
  'subpkg_images/scene_pk_plaque.png',
  'subpkg_images/scene_pk_plate.png',
  'subpkg_images/scene_pk_seal.png',
  'subpkg_images/scene_pk_ink_divider.png',
  'subpkg_images/scene_dex_book.png',
  'subpkg_images/scene_dex_tab.png',
  'subpkg_images/scene_order_wall.png',
  'subpkg_images/scene_menu_wall.png',
  'subpkg_images/dest_street_bg.jpg',
  'subpkg_images/outing_curtain.jpg',
] as const;

const INK = 0x2A2018;
const INK_SOFT = 0x5A4430;
const MUTED = 0x8A6E52;
const RED_INK = 0xB8361F;
const GREEN_INK = 0x3F7034;
const CREAM = 0xFFF8EC;

export class KitchenScene implements Scene {
  readonly name = 'kitchen';
  readonly container = new PIXI.Container();
  private _world = new PIXI.Container();
  private _viewClip = new PIXI.Graphics();
  private _ui = new PIXI.Container();
  private _fridge = new FridgePanel();
  private _cook = new CookPanel();
  private _recipeBook = new RecipeBookPanel();
  private _dex = new DexPanel();
  private _orders = new OrderPanel();
  private _daily = new DailyMenuPanel();
  private _gacha = new RecipeDrawPanel();
  private _event = new EventPanel();
  private _gameClub = new GameClubPanel();
  private _welfare = new DouyinWelfarePanel();
  private _upgrade = new UpgradePanel();
  private _pickle = new PicklePanel();
  private _strayCat = new StrayCatPanel();
  private _p2WatchTimer: ReturnType<typeof setInterval> | null = null;
  private _lastP2Sig = '';
  private _panTween = { x: 0 };
  private _toWindowTab: PIXI.Container | null = null;
  private _toDoorTab: PIXI.Container | null = null;
  private _gachaBtn: PIXI.Container | null = null;
  private _picklePropNode: PIXI.Container | null = null;
  private _catPropNode: PIXI.Container | null = null;
  private static _idleDiskPrefetched = false;
  private _offerTimer = 0;
  private _overlayTrimTimer: ReturnType<typeof setTimeout> | null = null;
  private _idlePrefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private _inKitchen = false;
  private _dirtyUnderOverlay = false;
  private _onChange = () => {
    const blocking = this._overlayBlocking();
    const fx = KitchenManager.consumeCookFx();
    if (fx && !blocking) playCookReadyFx(fx);
    if (KitchenManager.consumeNudgeOffer()) this._queueNeighborOffer();
    if (blocking) {
      this._dirtyUnderOverlay = true;
      return;
    }
    this._scheduleRelayout();
  };
  private _onTutorialStep = () => {
    if (!this.container.parent || this._itemDrag) return;
    if (this._overlayBlocking() && !TutorialManager.isStep(TutorialStep.COOK_DISH)) {
      this._dirtyUnderOverlay = true;
      return;
    }
    this.relayout();
  };
  private _onTutorialCompleted = () => {
    if (!this.container.parent) return;
    KitchenManager.beginKitchenVisit();
    this._queueNeighborOffer();
    this.relayout();
  };
  private _worldSize = { w: 750, h: 1334 };
  private _pan = { x: 0, y: 0 };
  private _drag: { x: number; y: number; sx: number; sy: number; px: number; py: number } | null = null;
  private _dragMoved = false;
  private _gm = false;
  private _layout: FurnLayout[] = cloneLayout();
  private _fit = { x: 0, y: 0, scale: 1, srcW: 1600, srcH: 900 };
  private _itemDrag: { id: FurnId; nx0: number; ny0: number } | null = null;
  private _gmPick: FurnId | null = null;
  private _gmView: Record<FurnId, number> = { fridge: 0, table: 0, basket: 0, foam: 0 };
  private _gmHouse = 0;
  private _furnRoots = new Map<FurnId, PIXI.Container>();
  private _upgradePick: UpgradePick | null = null;
  private _spotRects = new Map<HotspotId, { x: number; y: number; w: number; h: number }>();
  private _tableUpgradeRect: { x: number; y: number; w: number; h: number } | null = null;
  private _upgradeConfirmRect: { x: number; y: number; w: number; h: number } | null = null;
  private _bootRetryLeft = 8;
  private _bootRetryTimer = 0;
  private _wipeArmed = 0;
  private _paintQueued = false;
  private _watched = new Set<string>();

  private _scheduleRelayout = (): void => {
    if (!this.container.parent || this._itemDrag) return;
    if (this._overlayBlocking()) {
      this._dirtyUnderOverlay = true;
      return;
    }
    if (this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (!this.container.parent || this._itemDrag) return;
      if (this._overlayBlocking()) {
        this._dirtyUnderOverlay = true;
        return;
      }
      this.relayout();
    });
  };

  private _flushDirtyUnderOverlay = (): void => {
    if (!this._inKitchen || !this.container.parent || !this._dirtyUnderOverlay) return;
    if (!this._overlayBlocking()) {
      this._scheduleRelayout();
    }
  };

  private _clearOverlayTrimTimer(): void {
    if (this._overlayTrimTimer) {
      clearTimeout(this._overlayTrimTimer);
      this._overlayTrimTimer = null;
    }
  }

  private _clearIdlePrefetchTimer(): void {
    if (this._idlePrefetchTimer) {
      clearTimeout(this._idlePrefetchTimer);
      this._idlePrefetchTimer = null;
    }
  }

  private _scheduleIdleDiskPrefetch(): void {
    if (KitchenScene._idleDiskPrefetched || this._idlePrefetchTimer) return;
    this._idlePrefetchTimer = setTimeout(() => {
      this._idlePrefetchTimer = null;
      if (KitchenScene._idleDiskPrefetched || !this._inKitchen || !this.container.parent) return;
      KitchenScene._idleDiskPrefetched = true;
      void KitchenScene._runIdleDiskPrefetch();
    }, 1500);
  }

  private static async _runIdleDiskPrefetch(): Promise<void> {
    for (let i = 0; i < IDLE_DISK_PREFETCH_PATHS.length; i++) {
      const p = IDLE_DISK_PREFETCH_PATHS[i];
      try {
        await CdnAssetService.download(p);
      } catch (_) {}
      if (i + 1 < IDLE_DISK_PREFETCH_PATHS.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 160));
      }
    }
  }

  private _scheduleOverlayTextureTrim(): void {
    this._clearOverlayTrimTimer();
    this._overlayTrimTimer = setTimeout(() => {
      this._overlayTrimTimer = null;
      if (!this._inKitchen || !this.container.parent || this._overlayBlocking()) return;
      const evicted = trimTexturesToBudget(48, false);
      if (evicted > 0) {
        Platform.triggerGC();
      }
    }, 60);
  }

  private _hookPanelClose(panel: { close: (...args: any[]) => any }): void {
    const anyPanel = panel as any;
    if (anyPanel.__kitchenCloseHooked) return;
    anyPanel.__kitchenCloseHooked = true;
    const orig = panel.close.bind(panel);
    panel.close = (...args: any[]) => {
      const res = orig(...args);
      this._flushDirtyUnderOverlay();
      if (this._inKitchen && this.container.parent && !this._overlayBlocking()) {
        this._scheduleOverlayTextureTrim();
      }
      return res;
    };
  }

  private _watchOnce(path: string): void {
    if (!path || isTextureReady(gameTexture(path)) || this._watched.has(path)) return;
    this._watched.add(path);
    whenTextureReady(path, () => {
      this._watched.delete(path);
      this._scheduleRelayout();
    });
  }
  private _onDown = (e: PIXI.FederatedPointerEvent) => {
    const p = this.container.toLocal(e.global);
    this._beginDrag(p.x, p.y);
  };
  private _onMove = (e: PIXI.FederatedPointerEvent) => {
    const p = this.container.toLocal(e.global);
    this._applyDragDelta(p.x - (this._drag?.x ?? p.x), p.y - (this._drag?.y ?? p.y));
  };
  private _onUp = () => this._endDrag();
  private _onWxStart = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }) => {
    if (this._overlayBlocking()) return;
    const p = this._wxPoint(res);
    if (p) this._beginDrag(p.x, p.y);
  };
  private _onWxMove = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }) => {
    if (this._overlayBlocking()) return;
    const p = this._wxPoint(res);
    if (!p || !this._drag) return;
    this._applyDragDelta(p.x - this._drag.x, p.y - this._drag.y);
  };

  constructor() {
    this.container.addChild(this._world);
    this.container.addChild(this._viewClip);
    this.container.addChild(this._ui);
    this._viewClip.eventMode = 'none';
    this._world.mask = this._viewClip;
    this._fridge.onChange = () => this._scheduleRelayout();
    const openStoveUpgrade = () => {
      this._upgradePick = 'table';
      this._dirtyUnderOverlay = true;
      this._scheduleRelayout();
    };
    this._cook.onUpgradeStove = openStoveUpgrade;
    this._orders.onUpgradeStove = openStoveUpgrade;
    this._daily.onUpgradeStove = openStoveUpgrade;
    this._daily.onCook = (recipeId) => {
      this._daily.close();
      this._cook.open(recipeId);
    };
    this._orders.onCook = (recipeId) => {
      this._orders.close();
      this._cook.open(recipeId);
    };
    this._pickle.onGoCook = (recipeId) => {
      this._pickle.close();
      this._cook.open(recipeId);
    };
    const unlockPanel = ensureRecipeUnlockPanel();
    const levelUpPanel = ensureCookLevelUpPanel();
    const giftPanel = ensureTutorialGiftPanel();
    const buffPanel = ensureHudBuffPanel();
    for (const p of [
      this._fridge,
      this._cook,
      this._recipeBook,
      this._dex,
      this._orders,
      this._daily,
      this._gacha,
      this._event,
      this._gameClub,
      this._welfare,
      this._upgrade,
      this._pickle,
      this._strayCat,
      unlockPanel,
      levelUpPanel,
      giftPanel,
      buffPanel,
    ]) {
      this._hookPanelClose(p);
    }
    this.container.eventMode = 'static';
    this._world.eventMode = 'static';
    this._ui.eventMode = 'passive';
    if (Platform.isDouyin) {
      Platform.onShow(() => {
        if (this.container.parent && !this._itemDrag) this.relayout();
        this._welfare.refreshIfOpen();
      });
    }
  }

  onEnter(): void {
    this._inKitchen = true;
    this._clearOverlayTrimTimer();
    EventBus.on(EV.kitchenChanged, this._onChange);
    EventBus.on(EV.tutorialStepChanged, this._onTutorialStep);
    EventBus.on(EV.tutorialCompleted, this._onTutorialCompleted);
    this._pan.x = 0;
    this._pan.y = 0;
    this.container.on('pointerdown', this._onDown);
    this.container.on('pointerup', this._onUp);
    this.container.on('pointerupoutside', this._onUp);
    this.container.on('pointercancel', this._onUp);
    if (Platform.api?.onTouchMove) {
      try { Platform.api.onTouchStart?.(this._onWxStart); } catch (_) {}
      try { Platform.api.onTouchMove?.(this._onWxMove); } catch (_) {}
      try { Platform.api.onTouchEnd?.(this._onUp); } catch (_) {}
      try { Platform.api.onTouchCancel?.(this._onUp); } catch (_) {}
    } else {
      this.container.on('globalpointermove', this._onMove);
    }
    TutorialManager.start();
    TutorialOverlay.mount();
    TutorialOverlay.register('kitchen', () => this.tutorialRect());
    TutorialOverlay.registerContextual('kitchen_ctx', () => this._contextualTip());
    this._bootRetryLeft = 8;
    this._dirtyUnderOverlay = false;
    this.relayout();
    AudioManager.playBgm('kitchen');
    if (!TutorialManager.isActive) {
      ensureCookLevelUpPanel().present();
      ensureRecipeUnlockPanel().present();
      KitchenManager.beginKitchenVisit();
      this._queueNeighborOffer();
    }
    this._startP2Watch();
    this._scheduleIdleDiskPrefetch();
  }

  private _p2Signature(): string {
    const save = KitchenManager.save;
    const now = Date.now();
    return `${pickleReadyCount(save, now)}:${pickleFermentingCount(save, now)}:${pickleTier(save)}:${catBedTier(save)}:${catStateView(save, now).effectiveStatus}`;
  }

  private _startP2Watch(): void {
    this._stopP2Watch();
    this._lastP2Sig = this._p2Signature();
    this._p2WatchTimer = setInterval(() => {
      if (!this.container.parent || this._itemDrag || this._drag) return;
      const sig = this._p2Signature();
      if (this._overlayBlocking()) {
        if (sig !== this._lastP2Sig) {
          this._lastP2Sig = sig;
          this._dirtyUnderOverlay = true;
        }
        return;
      }
      if (this._dirtyUnderOverlay || sig !== this._lastP2Sig) {
        this._lastP2Sig = sig;
        this._dirtyUnderOverlay = false;
        this._scheduleRelayout();
      }
    }, 2000);
  }

  private _stopP2Watch(): void {
    if (this._p2WatchTimer) {
      clearInterval(this._p2WatchTimer);
      this._p2WatchTimer = null;
    }
  }

  private _overlayBlocking(): boolean {
    return this._fridge.visible
      || this._cook.visible
      || this._recipeBook.visible
      || this._upgrade.visible
      || this._dex.visible
      || this._orders._isOpen
      || this._daily._isOpen
      || this._gacha._isOpen
      || this._event._isOpen
      || this._gameClub._isOpen
      || this._welfare._isOpen
      || this._pickle._isOpen
      || this._strayCat._isOpen
      || ensureRecipeUnlockPanel()._isOpen
      || ensureCookLevelUpPanel()._isOpen
      || ensureTutorialGiftPanel()._isOpen
      || ensureHudBuffPanel()._isOpen;
  }

  onExit(): void {
    this._inKitchen = false;
    this._clearOverlayTrimTimer();
    this._clearIdlePrefetchTimer();
    EventBus.off(EV.kitchenChanged, this._onChange);
    EventBus.off(EV.tutorialStepChanged, this._onTutorialStep);
    EventBus.off(EV.tutorialCompleted, this._onTutorialCompleted);
    this.container.off('pointerdown', this._onDown);
    this.container.off('globalpointermove', this._onMove);
    this.container.off('pointerup', this._onUp);
    this.container.off('pointerupoutside', this._onUp);
    this.container.off('pointercancel', this._onUp);
    try { Platform.api?.offTouchStart?.(this._onWxStart); } catch (_) {}
    try { Platform.api?.offTouchMove?.(this._onWxMove); } catch (_) {}
    try { Platform.api?.offTouchEnd?.(this._onUp); } catch (_) {}
    try { Platform.api?.offTouchCancel?.(this._onUp); } catch (_) {}
    this._endDrag();
    this._paintQueued = false;
    this._dirtyUnderOverlay = false;
    TweenManager.cancelTarget(this._panTween);
    this._clearOfferTimer();
    this._stopP2Watch();
    if (this._bootRetryTimer) {
      globalThis.clearTimeout(this._bootRetryTimer);
      this._bootRetryTimer = 0;
    }
    this._fridge.close(true);
    this._cook.close(true);
    ensureTutorialGiftPanel().close(true);
    ensureHudBuffPanel().close(true);
    this._recipeBook.close(true);
    this._dex.close(true);
    this._orders.close(true);
    this._daily.close(true);
    this._gacha.close(true);
    this._event.close(true);
    this._gameClub.close(true);
    this._welfare.close(true);
    this._upgrade.close(true);
    this._pickle.close(true);
    this._strayCat.close(true);
    this._upgradePick = null;
    clearCookReadyFx();
    TutorialOverlay.unregister('kitchen');
    TutorialOverlay.unregisterContextual('kitchen_ctx');
    this._toWindowTab = null;
    this._toDoorTab = null;
    this._gachaBtn = null;
    this._picklePropNode = null;
    this._catPropNode = null;
    this._furnRoots.clear();
    this._spotRects.clear();
    this._tableUpgradeRect = null;
    this._upgradeConfirmRect = null;
    destroyDisplayChildren(this._world);
    destroyDisplayChildren(this._ui);
  }

  relayout(): void {
    this._dirtyUnderOverlay = false;
    if (!Platform.isDevtools) this._gm = false;
    this._fridge.prune();
    destroyDisplayChildren(this._world);
    destroyDisplayChildren(this._ui);
    this._toWindowTab = null;
    this._toDoorTab = null;
    this._gachaBtn = null;
    this._picklePropNode = null;
    this._catPropNode = null;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    this._viewClip.clear();
    this._viewClip.beginFill(0xffffff);
    this._viewClip.drawRect(0, 0, w, h);
    this._viewClip.endFill();
    this._world.mask = this._viewClip;
    const save = KitchenManager.save;
    const house = this._viewHouse();
    const roomPath = this._roomPath(house);
    const tex = gameTexture(roomPath);
    const sceneWatchPaths = [
      ...kitchenBootPaths(save),
      ...Object.values(KITCHEN_SCENE_ART),
      ...uiBarPaths(),
    ];
    for (const p of sceneWatchPaths) this._watchOnce(p);
    this._watchOnce(roomPath);
    const fb = HOUSE_FALLBACK_SIZE[house];
    const srcW = isTextureReady(tex) ? tex.width : fb.w;
    const srcH = isTextureReady(tex) ? tex.height : fb.h;
    const scale = Math.max(h / srcH, (w * HOUSE_SCREENS[house]) / srcW);
    const worldW = Math.round(srcW * scale);
    const worldH = Math.round(srcH * scale);
    this._worldSize = { w: worldW, h: worldH };
    this._world.hitArea = new PIXI.Rectangle(0, 0, worldW, worldH);
    const fit = { x: 0, y: h - worldH, scale, srcW, srcH };
    this._fit = fit;
    this._furnRoots.clear();
    this._spotRects.clear();
    this._tableUpgradeRect = null;
    this._upgradeConfirmRect = null;

    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, worldW, worldH, 0xF3E2C6);
    fillRect(fallback, 0, worldH * 0.62, worldW, worldH * 0.38, 0xD8C3A5);
    fallback.eventMode = 'none';
    this._world.addChild(fallback);

    if (isTextureReady(tex)) {
      const scene = new PIXI.Sprite(tex);
      applyFit(scene, fit);
      scene.eventMode = 'none';
      this._world.addChild(scene);
    } else {
      this._paintStandIn(fit);
    }

    // 干箱站在灶台后面，框会叠到台面上。灶台最后画，贴图永远盖在最上面。
    for (const id of FURN_IDS.filter((fid) => fid !== 'table')) {
      this._world.addChild(this._furniture(this._furnAt(id), save, fit));
    }
    if (!TutorialManager.isActive) {
      this._drawPickleProp(save, fit);
    }
    this._world.addChild(this._furniture(this._furnAt('table'), save, fit));
    if (!TutorialManager.isActive) {
      this._drawCatProp(save, fit);
    }

    if (!this._gm) {
      for (const spot of this._hotspotsFromLayout()) {
        const rect = spot.id === 'board'
          ? this._cookHitRect()
          : mapNorm(fit, spot.nx, spot.ny, spot.nw, spot.nh);
        this._world.addChild(this._hotspot(spot.id, spot.label, rect));
      }
      this._drawDoorPlaque();
      this._drawKitchenSlip();
      this._drawFridgeSlip();
      if (!TutorialManager.isActive || TutorialManager.isStep(TutorialStep.HINT_DOOR)) {
        for (const id of FURN_IDS) {
          const badge = this._upgradeBadge(id, this._furnSpriteRect(id));
          if (badge) this._world.addChild(badge);
        }
        const houseBadge = this._houseUpgradeBadge();
        if (houseBadge) this._world.addChild(houseBadge);
      }
    }

    this._drawHud(w);
    this._applyPan();
    if (!this._gm && this._upgradePick) this._drawUpgradeCard(this._upgradePick);
    this._scheduleBootRetry();
    if (TutorialManager.isStep(TutorialStep.COOK_DISH) && !this._cook._isOpen && !this._gm) {
      this._cook.open('stirfry');
      return;
    }
    TutorialOverlay.refresh();
  }

  /** 分包晚到时方框先出来，图到了立刻重画，不必杀进程重进。 */
  private _scheduleBootRetry(): void {
    if (this._itemDrag || this._bootRetryLeft <= 0) return;
    const miss = kitchenBootPaths(KitchenManager.save).filter((path) => !isTextureReady(gameTexture(path)));
    if (!miss.length) {
      this._bootRetryLeft = 0;
      return;
    }
    if (this._bootRetryTimer) return;
    this._bootRetryLeft -= 1;
    this._bootRetryTimer = globalThis.setTimeout(() => {
      this._bootRetryTimer = 0;
      if (!this.container.parent) return;
      for (const path of miss) {
        this._watched.delete(path);
        retryTexture(path);
        this._watchOnce(path);
      }
    }, 700) as unknown as number;
  }

  tutorialRect(): SpotlightRect | TutorialTarget | null {
    if (!TutorialManager.isActive) return null;
    const step = TutorialManager.currentStep;
    if (step === TutorialStep.HINT_DOOR) {
      if (this._overlayBlocking()) return null;
      const save = KitchenManager.save;
      if (furnLevel(save, 'table') === 0 && furnUpgradeState(save, 'table').status === 'ready') {
        if (this._upgradePick === 'table' && this._upgradeConfirmRect) {
          const rect = worldRectToStage(this._ui, this._upgradeConfirmRect, 8);
          if (rect) {
            return {
              dim: false,
              holes: [rect],
              fingerAt: { x: rect.x + rect.w * 0.5, y: rect.y + rect.h * 0.5 },
              speech: 'bottom',
              title: '点升级学新菜',
              body: '升到 2 级烹饪台，立刻解锁「清炒土豆丝」！\n左边「抽谱」也已开启，随时能拿券开箱。',
            };
          }
        }
        if (this._tableUpgradeRect) {
          const rect = worldRectToStage(this._world, this._tableUpgradeRect, 10);
          if (rect) {
            return {
              dim: false,
              holes: [rect],
              fingerAt: { x: rect.x + rect.w * 0.5, y: rect.y + rect.h * 0.5 },
              speech: 'top',
              title: '升级灶台开新谱',
              body: '开张礼到手！点灶台上的圆箭头升级学新菜，\n左侧「抽谱」也已解锁，有 2 张券可免费开箱！',
            };
          }
        }
      }
      return worldRectToStage(this._world, this._spotRects.get('door') ?? { x: 20, y: 220, w: 160, h: 280 }, 12);
    }
    if (
      step === TutorialStep.GO_OUT
      || step === TutorialStep.PICK_XIANGKO
    ) {
      return worldRectToStage(this._world, this._spotRects.get('door') ?? { x: 20, y: 220, w: 160, h: 280 }, 12);
    }
    if (step === TutorialStep.COOK_TABLE || (step === TutorialStep.COOK_DISH && !this._cook._isOpen)) {
      return worldRectToStage(this._world, this._spotRects.get('board') ?? this._cookHitRect(), 10);
    }
    if (step === TutorialStep.OPEN_FRIDGE) {
      return worldRectToStage(this._world, this._spotRects.get('fridge') ?? this._furnSpriteRect('fridge'), 8);
    }
    return null;
  }

  private _contextualTip(): TutorialTarget | null {
    if (TutorialManager.isActive || this._gm || this._overlayBlocking() || this._upgradePick) {
      return null;
    }
    const save = KitchenManager.save;

    // 1) 主线刚结业：用开张礼送的 2 张菜谱券引导首次「抽谱箱」+ 小饭桌/图鉴说明
    if (!KitchenManager.hasSeenGuide('guide_gacha') && save.recipeTickets >= 2 && this._gachaBtn) {
      const hole = stageRectOf(this._gachaBtn, 8);
      if (hole) {
        return {
          dim: false,
          holes: [hole],
          fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
          speech: 'bottom',
          title: '免费开一箱新菜谱',
          body: '刚拿了 2 张菜谱券！点左侧「抽谱」必出好礼，平时做「小饭桌」和盖「图鉴」章都能稳定攒券！（点气泡收起）',
          onDismiss: () => KitchenManager.markGuideSeen('guide_gacha'),
        };
      }
    }

    const minX = this._minPanX();
    const atWindow = minX < -24 && this._pan.x <= minX * 0.45;

    // 2) Lv.2 开启老坛腌制坊：引导点右侧「窗边角 ▶」滑过去看老坛
    if (!KitchenManager.hasSeenGuide('guide_pickle_bay') && pickleUnlocked(save)) {
      if (!atWindow && this._toWindowTab && this._toWindowTab.visible) {
        const hole = stageRectOf(this._toWindowTab, 8);
        if (hole) {
          return {
            dim: false,
            holes: [hole],
            fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
            speech: 'bottom',
            title: '窗边老坛开张啦',
            body: '厨艺升到 2 级开启了「老坛腌制坊」！点右边「窗边角 ▶」滑过去看看吧！（点气泡收起）',
            onDismiss: () => KitchenManager.markGuideSeen('guide_pickle_bay'),
          };
        }
      } else if (this._picklePropNode) {
        const hole = stageRectOf(this._picklePropNode, 8);
        if (hole) {
          return {
            dim: false,
            holes: [hole],
            fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
            speech: 'bottom',
            title: '余菜发酵送私房菜谱',
            body: '点老坛打开腌制坊！把黄瓜、大蒜封水入坛，首坛揭盖直接送私房大菜谱！（点气泡收起）',
            onDismiss: () => KitchenManager.markGuideSeen('guide_pickle_bay'),
          };
        }
      }
    }

    // 3) Lv.4 小橘猫阿橘闻香上门：引导去窗边免费收留阿橘
    if (!KitchenManager.hasSeenGuide('guide_cat_bay') && catUnlocked(save) && !save.strayCat?.adopted) {
      if (!atWindow && this._toWindowTab && this._toWindowTab.visible) {
        const hole = stageRectOf(this._toWindowTab, 8);
        if (hole) {
          return {
            dim: false,
            holes: [hole],
            fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
            speech: 'bottom',
            title: '小橘猫闻香上门啦',
            body: '流浪小橘猫「阿橘」蹲在窗边等你呢！点右边「窗边角 ▶」去免费收留它吧！（点气泡收起）',
            onDismiss: () => KitchenManager.markGuideSeen('guide_cat_bay'),
          };
        }
      } else if (this._catPropNode) {
        const hole = stageRectOf(this._catPropNode, 8);
        if (hole) {
          return {
            dim: false,
            holes: [hole],
            fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
            speech: 'bottom',
            title: '免费收留阿橘',
            body: '点草垫收留阿橘！平时喂它余菜小鱼，它会去菜场帮你叼回稀有好货和菜谱券！（点气泡收起）',
            onDismiss: () => KitchenManager.markGuideSeen('guide_cat_bay'),
          };
        }
      }
    }

    return null;
  }

  private _wxPoint(res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): { x: number; y: number } | null {
    const t = res.touches?.[0];
    if (!t) return null;
    const scale = Game.contentScale || 1;
    return {
      x: (t.clientX ?? t.x ?? 0) / scale,
      y: (t.clientY ?? t.y ?? 0) / scale,
    };
  }

  private _beginDrag(x: number, y: number): void {
    TweenManager.cancelTarget(this._panTween);
    this._dragMoved = false;
    this._drag = { x, y, sx: x, sy: y, px: this._pan.x, py: this._pan.y };
  }

  private _applyDragDelta(dx: number, dy: number): void {
    if (!this._drag) return;
    if (Math.abs(this._drag.x + dx - this._drag.sx) > DRAG_SLOP
      || Math.abs(this._drag.y + dy - this._drag.sy) > DRAG_SLOP) {
      this._dragMoved = true;
    }
    if (!this._dragMoved) return;
    this._drag.x += dx;
    this._drag.y += dy;
    if (this._itemDrag) {
      const item = this._furnAt(this._itemDrag.id);
      if (!item) return;
      item.nx = Math.max(-item.nw * 0.35, Math.min(1.05, this._itemDrag.nx0 + (this._drag.x - this._drag.sx) / this._worldSize.w));
      item.ny = Math.max(-item.nh * 0.2, Math.min(0.96, this._itemDrag.ny0 + (this._drag.y - this._drag.sy) / this._worldSize.h));
      this._placeFurnRoot(item);
      return;
    }
    if (!TutorialManager.isActive) {
      if (this._upgradePick) {
        this._upgradePick = null;
        this.relayout();
      }
      this._pan.x = this._drag.px + (this._drag.x - this._drag.sx);
      this._applyPan();
    }
  }

  private _endDrag(): void {
    if (this._itemDrag) saveGmLayout(this._layout);
    this._itemDrag = null;
    this._drag = null;
  }

  private _placeFurnRoot(item: FurnLayout): void {
    const root = this._furnRoots.get(item.id);
    if (!root) return;
    const rect = mapNorm(this._fit, item.nx, item.ny, item.nw, item.nh);
    root.position.set(rect.x, rect.y);
  }

  private _minPanX(): number {
    const viewW = Game.designWidth;
    const worldW = this._fit.srcW * this._fit.scale;
    return Math.min(0, viewW - worldW);
  }

  private _tweenPanTo(targetX: number): void {
    const minX = this._minPanX();
    const clamped = Math.max(minX, Math.min(0, targetX));
    TweenManager.cancelTarget(this._panTween);
    this._panTween.x = this._pan.x;
    TweenManager.to({
      target: this._panTween,
      props: { x: clamped },
      duration: 0.32,
      ease: Ease.easeOutQuad,
      onUpdate: () => {
        this._pan.x = this._panTween.x;
        this._applyPan();
      },
    });
  }

  private _applyPan(): void {
    const minX = TutorialManager.isActive ? 0 : this._minPanX();
    this._pan.x = Math.max(minX, Math.min(0, this._pan.x));
    this._pan.y = 0;
    this._world.position.set(this._pan.x, 0);
    const fridgeSpot = this._spotRects.get('fridge');
    if (fridgeSpot) {
      const rect = worldRectToStage(this._world, fridgeSpot, 0);
      if (rect) setKitchenFridgeHudPos({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    }
    const atWindow = minX < -24 && this._pan.x <= minX * 0.45;
    if (this._toWindowTab) this._toWindowTab.visible = minX < -24 && !atWindow;
    if (this._toDoorTab) this._toDoorTab.visible = minX < -24 && atWindow;
    if (!TutorialManager.isActive) TutorialOverlay.refresh();
  }

  private _furniture(
    furn: FurnLayout,
    _save: KitchenSave,
    fit: ReturnType<typeof fitWidthBottom>,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const rect = mapNorm(fit, furn.nx, furn.ny, furn.nw, furn.nh);
    root.position.set(rect.x, rect.y);
    const path = this._furnPath(furn.id, this._viewLevel(furn.id));
    const tex = gameTexture(path);
    this._watchOnce(path);
    if (isTextureReady(tex)) {
      const sprite = new PIXI.Sprite(tex);
      fitSpriteInBox(sprite, rect.w, rect.h);
      sprite.anchor.set(0.5, furn.hang ? 0 : 1);
      sprite.position.set(rect.w / 2, furn.hang ? 0 : rect.h);
      sprite.eventMode = 'none';
      root.addChild(sprite);
    }
    if (this._gm) {
      const tag = makeText('caption', furnLabel(furn.id, this._viewLevel(furn.id)), CREAM, {
        size: 20,
        stroke: INK,
        strokeWidth: 4,
      });
      tag.position.set(10, 6);
      const frame = new PIXI.Graphics();
      frame.lineStyle(2, this._gmPick === furn.id ? 0xE0A100 : 0xFFFFFF, 0.7);
      frame.drawRoundedRect(0, 0, rect.w, rect.h, 10);
      frame.eventMode = 'none';
      root.addChild(frame, tag);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(0, 0, rect.w, rect.h);
      root.on('pointerdown', (e) => {
        e.stopPropagation();
        this._gmPick = furn.id;
        this._itemDrag = { id: furn.id, nx0: furn.nx, ny0: furn.ny };
        const p = this.container.toLocal(e.global);
        this._beginDrag(p.x, p.y);
      });
    } else {
      root.eventMode = 'none';
    }
    this._furnRoots.set(furn.id, root);
    return root;
  }

  private _viewLevel(id: FurnId): number {
    if (this._gm) return this._gmView[id] ?? furnLevel(KitchenManager.save, id);
    return furnLevel(KitchenManager.save, id);
  }

  private _viewHouse(): number {
    if (this._gm) return clampHouseLevel(this._gmHouse);
    return houseLevel(KitchenManager.save);
  }

  private _roomPath(house: number): string {
    for (const path of houseRoomCandidates(house)) {
      const tex = gameTexture(path);
      if (isTextureReady(tex)) return path;
      if (!isTextureFailed(path)) return path;
    }
    return houseRoomCandidates(house)[0];
  }

  private _furnAt(id: FurnId): FurnLayout {
    return layoutFor(this._layout, id, this._viewLevel(id), this._viewHouse());
  }

  /** 贴图在布局框里的实际位置：落地钉底、挂件钉顶，不含框里的空档。 */
  private _furnSpriteRect(id: FurnId): { x: number; y: number; w: number; h: number } {
    const furn = this._furnAt(id);
    const box = mapNorm(this._fit, furn.nx, furn.ny, furn.nw, furn.nh);
    const tex = gameTexture(this._furnPath(id, this._viewLevel(id)));
    const tw = isTextureReady(tex) ? tex.width : 256;
    const th = isTextureReady(tex) ? tex.height : 256;
    const scale = Math.min(box.w / Math.max(1, tw), box.h / Math.max(1, th));
    const w = tw * scale;
    const h = th * scale;
    return {
      x: box.x + (box.w - w) / 2,
      y: furn.hang ? box.y : box.y + box.h - h,
      w,
      h,
    };
  }

  private _furnPath(id: FurnId, level: number): string {
    const artLevel = Math.min(level, FURN_ART_MAX_LEVEL);
    for (let lv = artLevel; lv >= 0; lv--) {
      const path = `subpkg_kitchen/kitchen_${id}_${lv}.png`;
      const tex = gameTexture(path);
      if (isTextureReady(tex)) return path;
      if (!isTextureFailed(path)) return path;
    }
    return `subpkg_kitchen/kitchen_${id}_0.png`;
  }

  private _paintStandIn(fit: ReturnType<typeof fitWidthBottom>): void {
    const g = new PIXI.Graphics();
    const box = (nx: number, ny: number, nw: number, nh: number, color: number) => {
      const r = mapNorm(fit, nx, ny, nw, nh);
      fillRect(g, r.x, r.y, r.w, r.h, color, 12);
    };
    box(0.02, 0.12, 0.26, 0.32, 0x8B5A2B);
    box(0.26, 0.16, 0.16, 0.18, 0xC4A574);
    box(0.36, 0.12, 0.32, 0.38, 0xE8D9C4);
    box(0.30, 0.48, 0.22, 0.12, 0xF4EFE6);
    box(0.68, 0.22, 0.30, 0.32, 0x4A433C);
    box(0.38, 0.60, 0.48, 0.22, 0xC4A574);
    box(0.02, 0.64, 0.36, 0.28, 0x8B5A2B);
    this._world.addChild(g);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 主场景 HUD：木牌厨艺经验条 + 宣纸资源签（金币/体力/抽谱券）+ 房屋挂匾 + 侧栏木章 + 出门大按钮
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawHud(w: number): void {
    const save = KitchenManager.save;
    const top = Math.max(8, Number.isFinite(Game.safeTop) ? Game.safeTop : 96);
    const redraw = this._scheduleRelayout;

    const gachaUnlocked = !TutorialManager.isActive
      || TutorialManager.at(TutorialStep.CLAIM_GIFT, TutorialStep.HINT_DOOR)
      || save.tutorialGiftClaimed
      || save.recipeTickets > 0;

    // 1. 左侧厨艺头像章 + 经验手绘进度木牌
    const skill = cookXpView(save);
    const chefHud = this._makeChefPlaque({
      level: skill.level,
      xpText: skill.text,
      fill: skill.fill,
      onReady: redraw,
    });
    chefHud.position.set(12, top);
    this._ui.addChild(chefHud);

    // 2. 右侧第一行：金币签 + 体力包子签 + 菜谱券签（25pt 大数字）
    const resX = 278;
    const resY = top + 6;
    const moneyTag = this._makeResourceSlip({
      icon: HUD_ICON.coin,
      text: `${save.money}`,
      width: 148,
      onReady: redraw,
    });
    moneyTag.position.set(resX, resY);
    this._ui.addChild(moneyTag);

    const staMax = staminaMax(save);
    const staShort = save.stamina < staMax;
    const staTag = this._makeResourceSlip({
      icon: HUD_ICON.stamina,
      text: `${save.stamina}/${staMax}`,
      width: 174,
      ratio: save.stamina / Math.max(1, staMax),
      plus: staShort,
      pulsePlus: save.stamina <= 0,
      onReady: redraw,
      onTap: staShort
        ? () => {
          if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.HINT_DOOR)) return;
          void KitchenManager.offerShareStamina();
        }
        : undefined,
    });
    staTag.position.set(resX + 156, resY);
    this._ui.addChild(staTag);

    const ticketTag = this._makeResourceSlip({
      icon: HUD_ICON.ticket,
      text: `${save.recipeTickets}`,
      width: 112,
      onReady: redraw,
      onTap: gachaUnlocked
        ? () => {
          if (TutorialManager.isStep(TutorialStep.CLAIM_GIFT)) return;
          KitchenManager.markGuideSeen('guide_gacha');
          this._gacha.open();
        }
        : undefined,
    });
    ticketTag.position.set(resX + 338, resY);
    this._ui.addChild(ticketTag);

    // 3. 右侧第二行：当前房屋木挂牌 + 增益 Buff 挂签 + 静音方章
    const row2Y = top + 66;
    const housePlaque = this._makeRoomNamePlaque(houseLabel(this._viewHouse()), redraw);
    housePlaque.position.set(resX, row2Y);
    this._ui.addChild(housePlaque);

    const buffs = liveHudBuffs(save);
    if (buffs.length) {
      const buffRow = this._makeBuffTags(buffs, redraw);
      buffRow.position.set(resX + 150, row2Y + 2);
      this._ui.addChild(buffRow);
    }

    const mute = makeMuteButton(48);
    mute.position.set(w - 62, row2Y - 2);
    mute.on('pointerdown', (e: PIXI.FederatedPointerEvent) => e.stopPropagation());
    this._ui.addChild(mute);

    // 4. 左侧功能入口木牌列（紧凑间距稳排最多 5 个入口，绝不跳到右上角与「窗边角 ▶」重叠）
    const STEP = 108;
    let slotY = top + 108;
    this._drawDexHud(redraw, slotY);
    slotY += STEP;

    const postTutUnlocked = !TutorialManager.isActive || TutorialManager.isStep(TutorialStep.HINT_DOOR);
    if (postTutUnlocked && KitchenManager.save.dailyMenu) {
      this._drawDailyMenuHud(redraw, slotY);
      slotY += STEP;
    }
    if (gachaUnlocked) {
      this._drawGachaHud(redraw, slotY);
      slotY += STEP;
    }
    if (KitchenManager.liveNeighborOrders().length) {
      this._drawOrderHud(redraw, slotY);
      slotY += STEP;
    }

    // 社区/抖音福利入口：始终固定在左侧功能栏（引导进入 HINT_DOOR 或结业后即展示）
    if (postTutUnlocked && Platform.isWechat) {
      this._drawGameClubHud(redraw, slotY, 14);
      slotY += STEP;
    }
    if (postTutUnlocked && Platform.isDouyin && DouyinWelfareManager.hasEntry) {
      this._drawWelfareHud(redraw, slotY, 14);
      slotY += STEP;
    }

    // 5. 右缘切视角挂签（窗边角 ▶ / ◀ 回门口）
    if (!TutorialManager.isActive) {
      this._drawWindowCornerHud(w, save, redraw);
    }

    if (this._gm) {
      const hint = makeText('caption', 'GM：拖家具 · 屋+/屋-换房子 · 导出后发给我固化', CREAM, {
        size: 20,
        stroke: INK,
        strokeWidth: 4,
      });
      hint.position.set(24, Game.logicHeight - 48);
      this._ui.addChild(hint);
    }
    this._drawGmBar();
  }

  /** 厨艺头像铜章 + 木牌经验手绘条（全字号 ≥ 20pt）。 */
  private _makeChefPlaque(opts: {
    level: number;
    xpText: string;
    fill: number;
    onReady: () => void;
  }): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const avatarR = 42;
    const cx = avatarR;
    const cy = avatarR + 4;

    // Right wooden/parchment wing holding level title + hand progress bar
    const wingX = avatarR + 14;
    const wingW = 198;
    const wingH = 78;
    const wingY = cy - wingH / 2;

    const wing = new PIXI.Graphics();
    wing.beginFill(0x160E08, 0.26);
    wing.drawRoundedRect(wingX - 18, wingY + 4, wingW + 18, wingH, 14);
    wing.endFill();
    wing.lineStyle(2.6, INK, 1);
    wing.beginFill(0x7A4B24, 1);
    wing.drawRoundedRect(wingX - 18, wingY, wingW + 18, wingH, 14);
    wing.endFill();
    wing.lineStyle(1.2, 0xDFB870, 0.8);
    wing.beginFill(0xFAF0DA, 1);
    wing.drawRoundedRect(wingX - 12, wingY + 5, wingW + 7, wingH - 11, 10);
    wing.endFill();
    root.addChild(wing);

    const contentLeft = cx + avatarR + 10;
    const barW = wingX + wingW - 14 - contentLeft;

    const lvTitle = makeText('heading', `厨艺 ${opts.level}级`, INK, { size: 24 });
    lvTitle.anchor.set(0, 0.5);
    lvTitle.position.set(contentLeft, wingY + 23);
    fitTextWidth(lvTitle, barW);
    root.addChild(lvTitle);

    const bar = makeHandProgressBar({
      width: barW,
      height: 24,
      ratio: Math.max(0.06, opts.fill),
      onReady: opts.onReady,
    });
    bar.node.position.set(contentLeft, wingY + 43);
    root.addChild(bar.node);

    const xpTxt = makeText('caption', opts.xpText, INK, {
      size: 20,
      fontWeight: '700',
      stroke: 0xFFFDF8,
      strokeWidth: 4,
    });
    xpTxt.anchor.set(0.5);
    fitTextWidth(xpTxt, barW - 10);
    xpTxt.position.set(contentLeft + barW / 2, wingY + 55);
    root.addChild(xpTxt);

    // Brass & walnut portrait medallion
    const ring = new PIXI.Graphics();
    ring.beginFill(0x160E08, 0.3);
    ring.drawCircle(cx, cy + 4, avatarR + 1);
    ring.endFill();
    ring.lineStyle(3, INK, 1);
    ring.beginFill(UI_PALETTE.brass, 1);
    ring.drawCircle(cx, cy, avatarR);
    ring.endFill();
    ring.lineStyle(1.6, 0x6E441E, 0.9);
    ring.beginFill(0xF8EEDC, 1);
    ring.drawCircle(cx, cy, avatarR - 5);
    ring.endFill();
    root.addChild(ring);

    this._watchOnce(HUD_ICON.player);
    const pTex = gameTexture(HUD_ICON.player);
    if (isTextureReady(pTex)) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawCircle(cx, cy, avatarR - 6);
      mask.endFill();
      const spr = new PIXI.Sprite(pTex);
      const side = (avatarR - 6) * 2;
      fitSpriteInBox(spr, side * 1.16, side * 1.16);
      spr.anchor.set(0.5);
      spr.position.set(cx, cy);
      spr.mask = mask;
      spr.eventMode = 'none';
      root.addChild(mask, spr);
    }

    return root;
  }

  /** 宣纸木轴资源签：大图标外探 + 25pt 浓墨数字 + 可选加号章。 */
  private _makeResourceSlip(opts: {
    icon: string;
    text: string;
    width: number;
    ratio?: number;
    plus?: boolean;
    pulsePlus?: boolean;
    onReady: () => void;
    onTap?: () => void;
  }): PIXI.Container {
    const root = new PIXI.Container();
    const h = 48;
    const barX = 20;
    const barW = opts.width - barX;

    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.24);
    bg.drawRoundedRect(barX, 4, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2.5, INK, 1);
    bg.beginFill(0xFAF0DA, 0.98);
    bg.drawRoundedRect(barX, 0, barW, h, 10);
    bg.endFill();
    // Right walnut trim cap
    bg.lineStyle(2, INK, 1);
    bg.beginFill(0x7A4B24, 1);
    bg.drawRoundedRect(barX + barW - 8, -1, 8, h + 2, 4);
    bg.endFill();

    if (opts.ratio !== undefined) {
      const r = Math.max(0, Math.min(1, opts.ratio));
      if (r > 0) {
        const pad = 4;
        const fw = Math.max(12, (barW - 14 - pad * 2) * r);
        bg.lineStyle(0);
        bg.beginFill(0x7BB36E, 0.42);
        bg.drawRoundedRect(barX + pad, pad, fw, h - pad * 2, 6);
        bg.endFill();
      }
    }
    root.addChild(bg);

    const num = makeText('number', opts.text, INK, {
      size: 25,
      stroke: 0xFFFDF8,
      strokeWidth: 4,
    });
    num.anchor.set(0.5);
    const availTextW = barW - (opts.plus ? 56 : 30);
    fitTextWidth(num, availTextW);
    num.position.set(barX + 18 + availTextW / 2, h / 2 - 0.5);
    root.addChild(num);

    this._watchOnce(opts.icon);
    const icTex = gameTexture(opts.icon);
    if (isTextureReady(icTex)) {
      const sp = new PIXI.Sprite(icTex);
      fitSpriteInBox(sp, 54, 54);
      sp.anchor.set(0.5);
      sp.position.set(22, h / 2);
      sp.eventMode = 'none';
      root.addChild(sp);
    }

    if (opts.plus) {
      const plusWrap = new PIXI.Container();
      plusWrap.position.set(opts.width - 18, h / 2);
      plusWrap.eventMode = 'none';
      const pg = new PIXI.Graphics();
      pg.beginFill(0x160E08, 0.26);
      pg.drawCircle(0, 2.5, 16);
      pg.endFill();
      pg.lineStyle(2.4, INK, 1);
      pg.beginFill(opts.pulsePlus ? 0xD9412E : 0xC46234, 1);
      pg.drawCircle(0, 0, 15.5);
      pg.endFill();
      pg.lineStyle(0);
      pg.beginFill(CREAM, 1);
      pg.drawRoundedRect(-7.5, -2, 15, 4, 2);
      pg.drawRoundedRect(-2, -7.5, 4, 15, 2);
      pg.endFill();
      plusWrap.addChild(pg);
      root.addChild(plusWrap);
      if (opts.pulsePlus) {
        const pulse = (): void => {
          if (!isStageMounted(plusWrap)) return;
          TweenManager.to({
            target: plusWrap.scale,
            props: { x: 1.18, y: 1.18 },
            duration: 0.42,
            ease: Ease.easeOutQuad,
            onComplete: () => {
              if (!isStageMounted(plusWrap)) return;
              TweenManager.to({
                target: plusWrap.scale,
                props: { x: 1, y: 1 },
                duration: 0.42,
                ease: Ease.easeInOutQuad,
                onComplete: pulse,
              });
            },
          });
        };
        pulse();
      }
    }

    if (opts.onTap) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(0, -4, opts.width + 6, h + 8);
      root.on('pointerdown', (e) => e.stopPropagation());
      root.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        opts.onTap?.();
      });
    } else {
      root.eventMode = 'none';
    }
    return root;
  }

  /** 房屋名牌：胡桃木铜钉小横匾，点按可查看房屋修缮进度。 */
  private _makeRoomNamePlaque(roomTitle: string, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const w = 138;
    const h = 42;
    this._watchOnce(UI_KIT.headerRibbon);
    const rTex = gameTexture(UI_KIT.headerRibbon);
    if (isTextureReady(rTex)) {
      const sp = new PIXI.Sprite(rTex);
      sp.width = w;
      sp.height = h;
      sp.eventMode = 'none';
      root.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.4, INK, 1);
      g.beginFill(UI_PALETTE.walnutDark, 1);
      g.drawRoundedRect(0, 0, w, h, 10);
      g.endFill();
      g.lineStyle(1.2, UI_PALETTE.brassBright, 0.85);
      g.drawRoundedRect(4, 4, w - 8, h - 8, 7);
      root.addChild(g);
    }
    const txt = makeText('caption', roomTitle, CREAM, {
      size: 22,
      fontWeight: '700',
      stroke: 0x261509,
      strokeWidth: 4,
    });
    txt.anchor.set(0.5);
    fitTextWidth(txt, w - 26);
    txt.position.set(w / 2, h / 2 - 1);
    root.addChild(txt);

    const canInspectHouse = houseLevel(KitchenManager.save) < HOUSE_MAX_LEVEL && !TutorialManager.isActive;
    if (canInspectHouse) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(0, 0, w, h);
      root.on('pointerdown', (e) => e.stopPropagation());
      root.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        this._upgradePick = this._upgradePick === 'house' ? null : 'house';
        this.relayout();
      });
    } else {
      root.eventMode = 'none';
    }
    return root;
  }

  /** 顶栏 Buff 宣纸圆章行。 */
  private _makeBuffTags(buffs: ReturnType<typeof liveHudBuffs>, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const size = 42;
    buffs.forEach((buff, i) => {
      const path = buffIconPath(buff.icon);
      this._watchOnce(path);
      const cell = new PIXI.Container();
      const bg = new PIXI.Graphics();
      bg.beginFill(0x160E08, 0.24);
      bg.drawCircle(size / 2, size / 2 + 2.5, size / 2);
      bg.endFill();
      bg.lineStyle(2.4, INK, 0.95);
      bg.beginFill(0xFFF6E2, 0.98);
      bg.drawCircle(size / 2, size / 2, size / 2 - 1);
      bg.endFill();
      cell.addChild(bg);

      const tex = gameTexture(path);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, size - 8, size - 8);
        sp.anchor.set(0.5);
        sp.position.set(size / 2, size / 2);
        sp.eventMode = 'none';
        cell.addChild(sp);
      }
      cell.position.set(i * (size + 8), 0);
      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(0, 0, size, size);
      cell.on('pointerdown', (e) => e.stopPropagation());
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        ensureHudBuffPanel().open();
      });
      root.addChild(cell);
    });
    return root;
  }

  /** 厨房功能入口木牌徽章：大图标 + 胡桃木 22pt 铭牌 + 朱印 20pt 角标。 */
  private _makeKitchenEntryBtn(opts: {
    icon?: string;
    customIcon?: PIXI.DisplayObject;
    fallbackText: string;
    label: string;
    badgeText?: string;
    badgeTone?: 'red' | 'gold';
    highlight?: boolean;
    onReady?: () => void;
    onTap: () => void;
  }): PIXI.Container {
    const boxSize = 80;
    const plateW = 92;
    const plateH = 30;
    const totalH = boxSize + 18;
    const root = new PIXI.Container();

    const anchorPad = new PIXI.Graphics();
    anchorPad.beginFill(0x000000, 0.001);
    anchorPad.drawRect(-6, 0, plateW, totalH);
    anchorPad.endFill();
    anchorPad.eventMode = 'none';
    root.addChild(anchorPad);

    const face = new PIXI.Container();
    face.eventMode = 'none';
    root.addChild(face);

    const tile = new PIXI.Graphics();
    tile.beginFill(0x160E08, 0.28);
    tile.drawRoundedRect(0, 4, boxSize, boxSize, 18);
    tile.endFill();
    tile.lineStyle(2.6, INK, 1);
    tile.beginFill(opts.highlight ? 0xE5B24C : 0x8B5A2B, 1);
    tile.drawRoundedRect(0, 0, boxSize, boxSize, 18);
    tile.endFill();
    tile.lineStyle(1.2, 0xFFFDF8, 0.9);
    tile.beginFill(opts.highlight ? 0xFFF7DD : 0xFAF0DA, 1);
    tile.drawRoundedRect(3.5, 3.5, boxSize - 7, boxSize - 9, 14);
    tile.endFill();
    tile.lineStyle(0);
    tile.beginFill(opts.highlight ? 0xF7DF9C : 0xEFE0C4, 0.72);
    tile.drawCircle(boxSize / 2, boxSize / 2 - 4, boxSize * 0.35);
    tile.endFill();
    face.addChild(tile);

    if (opts.customIcon) {
      face.addChild(opts.customIcon);
    } else if (opts.icon) {
      this._watchOnce(opts.icon);
      const tex = gameTexture(opts.icon);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, boxSize - 14, boxSize - 18);
        sp.anchor.set(0.5);
        sp.position.set(boxSize / 2, boxSize / 2 - 4);
        sp.eventMode = 'none';
        face.addChild(sp);
      } else {
        const fb = makeText('heading', opts.fallbackText, UI_PALETTE.walnutDark, { size: 28 });
        fb.anchor.set(0.5);
        fb.position.set(boxSize / 2, boxSize / 2 - 4);
        face.addChild(fb);
      }
    } else {
      const fb = makeText('heading', opts.fallbackText, UI_PALETTE.walnutDark, { size: 28 });
      fb.anchor.set(0.5);
      fb.position.set(boxSize / 2, boxSize / 2 - 4);
      face.addChild(fb);
    }

    // Carved walnut nameplate at bottom (22pt crisp text)
    const plateX = Math.round((boxSize - plateW) / 2);
    const plateY = boxSize - 12;
    const plate = new PIXI.Graphics();
    plate.lineStyle(2.4, INK, 1);
    plate.beginFill(UI_PALETTE.walnutDark, 1);
    plate.drawRoundedRect(plateX, plateY, plateW, plateH, 10);
    plate.endFill();
    plate.lineStyle(1, 0xD6A660, 0.8);
    plate.drawRoundedRect(plateX + 2.5, plateY + 2.5, plateW - 5, plateH - 5, 8);
    face.addChild(plate);

    const nameTxt = makeText('caption', opts.label, CREAM, {
      size: 22,
      fontWeight: '700',
      stroke: 0x241408,
      strokeWidth: 3,
    });
    nameTxt.anchor.set(0.5);
    fitTextWidth(nameTxt, plateW - 10);
    nameTxt.position.set(boxSize / 2, plateY + plateH / 2 - 0.5);
    face.addChild(nameTxt);

    // Vermilion seal / gold stamp badge (20pt)
    if (opts.badgeText) {
      const isGold = opts.badgeTone === 'gold';
      const seal = new PIXI.Container();
      const bTxt = makeText('caption', opts.badgeText, isGold ? INK : 0xFFF6EA, {
        size: 20,
        fontWeight: '700',
      });
      const sealW = Math.max(32, Math.ceil(bTxt.width) + 14);
      const sealH = 30;
      const sealTex = gameTexture(KITCHEN_SCENE_ART.seal);
      if (!isGold && sealW <= 36 && isTextureReady(sealTex)) {
        const sp = new PIXI.Sprite(sealTex);
        fitSpriteInBox(sp, 34, 34);
        sp.anchor.set(0.5);
        seal.addChild(sp);
      } else {
        const sg = new PIXI.Graphics();
        sg.lineStyle(2.2, INK, 1);
        sg.beginFill(isGold ? 0xF7C948 : 0xC93828, 1);
        sg.drawRoundedRect(-sealW / 2, -sealH / 2, sealW, sealH, 8);
        sg.endFill();
        seal.addChild(sg);
      }
      bTxt.anchor.set(0.5);
      seal.addChild(bTxt);
      seal.rotation = -0.06;
      seal.position.set(boxSize - 4, 4);
      face.addChild(seal);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-8, -8, plateW + 4, totalH + 12);
    const reset = () => {
      face.y = 0;
      face.alpha = 1;
    };
    root.on('pointerdown', (e) => {
      e.stopPropagation();
      face.y = 2;
      face.alpha = 0.94;
    });
    root.on('pointerup', reset);
    root.on('pointerupoutside', reset);
    root.on('pointercancel', reset);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      opts.onTap();
    });
    return root;
  }

  /** 门扇右上留白处挂一块手绘木招牌「出门买菜」，避开左侧功能按钮列。 */
  private _drawDoorPlaque(): void {
    const doorRect = this._spotRects.get('door');
    if (!doorRect) return;
    const pw = 140;
    const host = new PIXI.Container();
    const pTex = gameTexture(KITCHEN_SCENE_ART.plaque);
    let faceCy = 42;
    if (isTextureReady(pTex)) {
      const sp = new PIXI.Sprite(pTex);
      sp.width = pw;
      sp.scale.y = sp.scale.x;
      sp.anchor.set(0.5, 0);
      sp.eventMode = 'none';
      host.addChild(sp);
      faceCy = sp.height * 0.64;
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.4, INK, 1);
      g.beginFill(0xC89660, 1);
      g.drawRoundedRect(-pw / 2, 16, pw, 48, 10);
      g.endFill();
      host.addChild(g);
      faceCy = 40;
    }
    const lbl = makeText('heading', '出门买菜', 0x4A2A12, {
      size: 22,
      stroke: 0xF6DDB0,
      strokeWidth: 3,
    });
    lbl.anchor.set(0.5);
    lbl.position.set(0, faceCy);
    host.addChild(lbl);
    // 左边缘 >= 112px 避开左侧快捷栏，Y 下移至房屋升级圆章 (pin.y + 24) 下方的门扇留白处
    const mark = houseUpgradeMark(this._viewHouse());
    const badgeBottom = houseLevel(KitchenManager.save) < HOUSE_MAX_LEVEL
      ? mapNorm(this._fit, mark.nx, mark.ny, 0, 0).y + 30
      : 0;
    const plaqueY = Math.max(doorRect.y + 78, Math.round(badgeBottom));
    host.position.set(Math.max(182, doorRect.x + doorRect.w * 0.80), plaqueY);
    host.eventMode = 'none';
    this._world.addChild(host);
  }

  private _drawOrderHud(redraw: () => void, y: number): void {
    const orders = KitchenManager.liveNeighborOrders();
    if (!orders.length) return;
    const npc = neighborNpc(orders[0].npcId);
    this._watchOnce(npc.portrait);
    const boxSize = 80;
    let customIcon: PIXI.Container | undefined;
    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      customIcon = new PIXI.Container();
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRoundedRect(6, 5, boxSize - 12, boxSize - 15, 14);
      mask.endFill();
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, boxSize - 8, boxSize - 8);
      spr.anchor.set(0.5);
      spr.position.set(boxSize / 2, boxSize / 2 - 3);
      spr.mask = mask;
      spr.eventMode = 'none';
      customIcon.addChild(mask, spr);
    }

    const n = Math.min(9, orders.length);
    const btn = this._makeKitchenEntryBtn({
      customIcon,
      fallbackText: '客',
      label: '街坊点单',
      badgeText: `${n}`,
      badgeTone: 'red',
      onReady: redraw,
      onTap: () => this._orders.open(),
    });
    btn.position.set(14, y);
    this._ui.addChild(btn);
  }

  private _drawDailyMenuHud(redraw: () => void, y: number): void {
    const save = KitchenManager.save;
    const left = dailyMenuRemain(save.dailyMenu);
    const canExtra = !!save.dailyMenu?.boardClaimed && canUseDailyAd(save, 'daily_extra');
    const badgeText = left > 0 ? `${Math.min(9, left)}` : canExtra ? '加' : undefined;
    const badgeTone = left > 0 ? 'red' : 'gold';
    const btn = this._makeKitchenEntryBtn({
      icon: HUD_ICON.dailyMenu,
      fallbackText: '桌',
      label: '今日菜单',
      badgeText,
      badgeTone,
      highlight: canExtra && left <= 0,
      onReady: redraw,
      onTap: () => this._daily.open(),
    });
    btn.position.set(14, y);
    this._ui.addChild(btn);
  }

  private _drawGachaHud(redraw: () => void, y: number): void {
    const save = KitchenManager.save;
    const tickets = save.recipeTickets;
    const freeBox = canUseDailyAd(save, 'gacha_free');
    const badgeText = tickets >= 2
      ? `${Math.min(9, tickets)}`
      : freeBox
        ? '免'
        : tickets > 0
          ? `${tickets}`
          : undefined;
    const badgeTone = tickets >= 2 || freeBox ? 'red' : 'gold';

    const btn = this._makeKitchenEntryBtn({
      icon: HUD_ICON.gacha,
      fallbackText: '谱',
      label: '寻味抽签',
      badgeText,
      badgeTone,
      highlight: tickets >= 2 || freeBox,
      onReady: redraw,
      onTap: () => {
        if (TutorialManager.isStep(TutorialStep.CLAIM_GIFT)) return;
        KitchenManager.markGuideSeen('guide_gacha');
        this._gacha.open();
      },
    });
    btn.position.set(14, y);
    setKitchenGachaHudPos({ x: 14 + 40, y: y + 40 });
    this._ui.addChild(btn);
    this._gachaBtn = btn;
  }

  private _queueNeighborOffer(): void {
    this._clearOfferTimer();
    const tick = () => {
      if (!this.container.parent) return;
      if (this._overlayBlocking()) {
        this._offerTimer = globalThis.setTimeout(tick, 350) as unknown as number;
        return;
      }
      this._presentNeighborOffer();
    };
    tick();
  }

  private _presentNeighborOffer(): void {
    if (
      this._event._isOpen
      || this._orders._isOpen
      || this._daily._isOpen
      || this._gacha._isOpen
      || this._pickle._isOpen
      || this._strayCat._isOpen
    ) return;
    const draft = KitchenManager.considerNeighborOffer();
    if (!draft) return;
    this._event.open(neighborOfferLog(draft), (i) => {
      if (i === 0) KitchenManager.acceptNeighborOffer();
      else KitchenManager.refuseNeighborOffer();
    });
  }

  private _clearOfferTimer(): void {
    if (this._offerTimer) globalThis.clearTimeout?.(this._offerTimer);
    this._offerTimer = 0;
  }

  private _drawGameClubHud(redraw: () => void, y: number, x = 14): void {
    const canClaimGift = !KitchenManager.hasClaimedGameClubToday();
    const btn = this._makeKitchenEntryBtn({
      icon: HUD_ICON.gameClub,
      fallbackText: '圈',
      label: '游戏圈',
      badgeText: canClaimGift ? '领' : undefined,
      badgeTone: 'red',
      onReady: redraw,
      onTap: () => {
        if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.HINT_DOOR)) return;
        this._gameClub.open();
      },
    });
    btn.position.set(x, y);
    this._ui.addChild(btn);
  }

  private _drawWelfareHud(_redraw: () => void, y: number, x = 14): void {
    if (!DouyinWelfareManager.hasEntry) return;
    const btn = this._makeKitchenEntryBtn({
      fallbackText: '福',
      label: '福利社',
      badgeText: DouyinWelfareManager.hasRedDot ? '领' : undefined,
      badgeTone: 'red',
      highlight: DouyinWelfareManager.hasRedDot,
      onTap: () => this._welfare.open(),
    });
    btn.position.set(x, y);
    this._ui.addChild(btn);
  }

  private _drawDexHud(redraw: () => void, y: number): void {
    const redCount = !TutorialManager.isActive ? dexRedDotCount(KitchenManager.save) : 0;
    const badgeText = redCount > 0 ? (redCount > 99 ? '99+' : `${redCount}`) : undefined;
    const btn = this._makeKitchenEntryBtn({
      icon: HUD_ICON.dex,
      fallbackText: '鉴',
      label: '烟火手账',
      badgeText,
      badgeTone: 'red',
      onReady: redraw,
      onTap: () => this._dex.open(),
    });
    btn.position.set(14, y);
    this._ui.addChild(btn);
  }

  private _drawGmBar(): void {
    if (!Platform.isDevtools) return;
    const y = Game.logicHeight - 118;
    const stop = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    const gmX = this._gm ? 16 : Game.designWidth - 116;
    const gmY = this._gm ? y : Game.logicHeight - Math.max(24, Game.safeBottom + 18) - 62;
    const gm = makeButton(this._gm ? 'GM开' : 'GM关', 100, 48, this._gm ? 0xC46A3A : 0x5A402C);
    gm.position.set(gmX, gmY);
    gm.on('pointerdown', stop);
    gm.on('pointertap', () => {
      this._gm = !this._gm;
      if (this._gm) {
        for (const id of FURN_IDS) this._gmView[id] = furnLevel(KitchenManager.save, id);
        this._gmHouse = houseLevel(KitchenManager.save);
      }
      this.relayout();
    });
    this._ui.addChild(gm);

    if (!this._gm) return;
    const dump = makeButton('导出布局', 140, 48, 0x5C6B4A);
    dump.position.set(128, y);
    dump.on('pointerdown', stop);
    dump.on('pointertap', () => this._exportLayout());
    this._ui.addChild(dump);

    const reset = makeButton('重置', 90, 48, 0x4A433C);
    reset.position.set(280, y);
    reset.on('pointerdown', stop);
    reset.on('pointertap', () => {
      this._layout = cloneLayout();
      saveGmLayout(this._layout);
      this.relayout();
    });
    this._ui.addChild(reset);

    const smaller = makeButton('小', 64, 48, 0x4A6B7A);
    smaller.position.set(378, y);
    smaller.on('pointerdown', stop);
    smaller.on('pointertap', () => this._scalePick(0.9));
    this._ui.addChild(smaller);

    const bigger = makeButton('大', 64, 48, 0x4A6B7A);
    bigger.position.set(448, y);
    bigger.on('pointerdown', stop);
    bigger.on('pointertap', () => this._scalePick(1.1));
    this._ui.addChild(bigger);

    const down = makeButton('级-', 64, 48, 0x6B5A3A);
    down.position.set(518, y);
    down.on('pointerdown', stop);
    down.on('pointertap', () => this._nudgeGmLevel(-1));
    this._ui.addChild(down);

    const up = makeButton('级+', 64, 48, 0x6B5A3A);
    up.position.set(588, y);
    up.on('pointerdown', stop);
    up.on('pointertap', () => this._nudgeGmLevel(1));
    this._ui.addChild(up);

    const houseDown = makeButton('屋-', 64, 44, 0x8B5A2B);
    houseDown.position.set(16, y - 52);
    houseDown.on('pointerdown', stop);
    houseDown.on('pointertap', () => this._nudgeGmHouse(-1));
    this._ui.addChild(houseDown);

    const houseUp = makeButton('屋+', 64, 44, 0x8B5A2B);
    houseUp.position.set(86, y - 52);
    houseUp.on('pointerdown', stop);
    houseUp.on('pointertap', () => this._nudgeGmHouse(1));
    this._ui.addChild(houseUp);

    const houseName = makeLabel(houseLabel(this._viewHouse()), 20, 0xF4EFE6);
    houseName.position.set(160, y - 42);
    this._ui.addChild(houseName);

    const artDown = makeButton('艺-', 64, 44, 0x6B3A3A);
    artDown.position.set(280, y - 52);
    artDown.on('pointerdown', stop);
    artDown.on('pointertap', () => KitchenManager.gmNudgeCookLevel(-1));
    this._ui.addChild(artDown);

    const artUp = makeButton('艺+', 64, 44, 0x6B3A3A);
    artUp.position.set(350, y - 52);
    artUp.on('pointerdown', stop);
    artUp.on('pointertap', () => KitchenManager.gmNudgeCookLevel(1));
    this._ui.addChild(artUp);

    const xpUp = makeButton('经验+', 80, 44, 0x6B3A3A);
    xpUp.position.set(420, y - 52);
    xpUp.on('pointerdown', stop);
    xpUp.on('pointertap', () => KitchenManager.gmAddCookXp(50));
    this._ui.addChild(xpUp);

    const staUp = makeButton('体+', 64, 44, 0x3A6B5A);
    staUp.position.set(508, y - 52);
    staUp.on('pointerdown', stop);
    staUp.on('pointertap', () => KitchenManager.gmAddStamina(5));
    this._ui.addChild(staUp);

    const goldUp = makeButton('金+', 64, 44, 0x8B6A20);
    goldUp.position.set(578, y - 52);
    goldUp.on('pointerdown', stop);
    goldUp.on('pointertap', () => KitchenManager.gmAddMoney(100));
    this._ui.addChild(goldUp);

    const ticketUp = makeButton('券+', 64, 44, 0x6B4A8A);
    ticketUp.position.set(658, y - 52);
    ticketUp.on('pointerdown', stop);
    ticketUp.on('pointertap', () => KitchenManager.gmAddTickets(2));
    this._ui.addChild(ticketUp);

    const wipe = makeButton('清档', 90, 44, 0x8A3B32);
    wipe.position.set(658, y);
    wipe.on('pointerdown', stop);
    wipe.on('pointertap', () => this._gmWipeSave());
    this._ui.addChild(wipe);

    const artName = makeLabel(`厨艺 ${KitchenManager.save.level}`, 20, 0xF4EFE6);
    artName.position.set(510, y - 28);
    this._ui.addChild(artName);

    const pick = this._gmPick;
    const lv = pick ? this._viewLevel(pick) : 0;
    const name = makeLabel(
      pick ? `${furnLabel(pick, lv)} ${lv + 1}级` : '点一件再拖',
      20,
      0xE0A100,
    );
    name.position.set(16, y - 28);
    this._ui.addChild(name);
  }

  private _gmWipeSave(): void {
    if (Date.now() - this._wipeArmed > 2500) {
      this._wipeArmed = Date.now();
      Platform.showToast('再点一次清档，进度会没');
      return;
    }
    this._wipeArmed = 0;
    this._fridge.close(true);
    this._cook.close(true);
    this._recipeBook.close(true);
    this._dex.close(true);
    this._orders.close(true);
    this._daily.close(true);
    this._gacha.close(true);
    this._event.close(true);
    this._gameClub.close(true);
    this._welfare.close(true);
    this._upgrade.close(true);
    this._pickle.close(true);
    this._strayCat.close(true);
    this._upgradePick = null;
    ensureRecipeUnlockPanel().close();
    ensureCookLevelUpPanel().close();
    ensureTutorialGiftPanel().close(true);
    ensureHudBuffPanel().close(true);
    RunManager.clear();
    for (const id of FURN_IDS) this._gmView[id] = 0;
    this._gmHouse = 0;
    this._layout = cloneLayout();
    KitchenManager.gmResetProgress();
    TutorialManager.start();
    TutorialOverlay.refresh();
    this.relayout();
  }

  private _nudgeGmHouse(delta: number): void {
    this._gmHouse = clampHouseLevel(this._viewHouse() + delta);
    this.relayout();
  }

  private _nudgeGmLevel(delta: number): void {
    if (!this._gmPick) {
      Platform.showToast('先点一件家具');
      return;
    }
    const cur = this._viewLevel(this._gmPick);
    this._gmView[this._gmPick] = Math.max(0, Math.min(FURN_MAX_LEVEL, cur + delta));
    this.relayout();
  }

  private _scalePick(mult: number): void {
    if (!this._gmPick) {
      Platform.showToast('先点一件家具');
      return;
    }
    const item = this._furnAt(this._gmPick);
    if (!item) return;
    item.nw = Math.max(0.06, Math.min(0.88, item.nw * mult));
    item.nh = Math.max(0.08, Math.min(0.88, item.nh * mult));
    saveGmLayout(this._layout);
    this.relayout();
  }

  private _exportLayout(): void {
    const text = dumpKitchenLayout(this._layout, this._viewHouse(), this._gmView);
    console.log(text);
    Platform.setClipboard(text);
    Platform.showToast('布局已复制到剪贴板');
  }

  private _hotspotsFromLayout(): Array<{ id: HotspotId; nx: number; ny: number; nw: number; nh: number; label: string }> {
    const fridge = this._furnAt('fridge');
    const table = this._furnAt('table');
    const basket = this._furnAt('basket');
    const foam = this._furnAt('foam');
    const door = houseDoor(this._viewHouse());
    return [
      { id: 'door', nx: door.nx, ny: door.ny + 0.12, nw: door.nw, nh: door.nh - 0.12, label: '出门' },
      ...(basket ? [{ ...basket, id: 'basket' as const, label: furnLabel('basket', this._viewLevel('basket')) }] : []),
      ...(fridge ? [{ ...fridge, id: 'fridge' as const, label: '冰箱' }] : []),
      ...(foam ? [{ ...foam, id: 'foam' as const, label: furnLabel('foam', this._viewLevel('foam')) }] : []),
      ...(table ? [{ ...table, id: 'board' as const, label: '烹饪' }] : []),
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 灶台前裙板窄横签 & 冰箱门磁吸迷你便签（小巧克制，绝不遮锅挡冰箱或撞升级箭头）
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawKitchenSlip(): void {
    const slip = computeKitchenSlip(KitchenManager.save);
    const lines: Array<{ text: string; color: number; onTap: () => void }> = [];
    if (slip.can) {
      const can = slip.can;
      lines.push({
        text: `可下锅 · ${can.name}`,
        color: GREEN_INK,
        onTap: () => this._cook.open(can.recipeId),
      });
    }
    if (slip.miss) {
      const miss = slip.miss;
      lines.push({
        text: `还差 · ${miss.itemName}`,
        color: RED_INK,
        onTap: () => {
          this._cook.open(miss.recipeId);
          Platform.showToast(kitchenSlipMissToast(miss));
        },
      });
    }
    if (!lines.length) return;
    const pot = this._cookHitRect();
    this._mountCompactSlip({
      centerX: pot.x + pot.w * 0.48,
      minX: 116,
      y: pot.y + pot.h * 0.88,
      minW: 148,
      maxW: 176,
      lines,
      fontSize: 19,
      variant: 'apron',
    });
  }

  private _drawFridgeSlip(): void {
    const rows = computeFridgeSlip(KitchenManager.save);
    if (!rows.length) return;
    const door = this._furnSpriteRect('fridge');
    const maxW = Math.round(Math.min(148, Math.max(118, door.w * 0.82)));
    const minW = Math.min(maxW, 118);
    const estH = rows.length > 1 ? 66 : 38;
    const targetY = Math.min(
      Math.max(door.y + 24, door.y + door.h - estH - 12),
      Math.round(door.y + door.h * 0.48),
    );
    this._mountCompactSlip({
      centerX: door.x + door.w * 0.46,
      minX: Math.max(24, Math.round(door.x - 4)),
      y: targetY,
      minW,
      maxW,
      lines: rows.map((row) => ({
        text: row.text,
        color: row.tone === 'full' ? RED_INK : INK,
        onTap: () => this._fridge.open(row.tab),
      })),
      fontSize: 19,
      variant: 'magnet',
    });
  }

  private _mountCompactSlip(opts: {
    centerX: number;
    minX: number;
    y: number;
    minW: number;
    maxW: number;
    lines: Array<{ text: string; color: number; onTap: () => void }>;
    fontSize: number;
    variant: 'apron' | 'magnet';
  }): void {
    const { lines, fontSize, variant } = opts;
    const textNodes = lines.map((line) =>
      makeText('body', line.text, line.color, {
        size: fontSize,
        fontWeight: '700',
        stroke: 0xFFFDF8,
        strokeWidth: 2.6,
      }),
    );
    const naturalW = Math.max(...textNodes.map((t) => Math.ceil(t.width)));
    const padX = variant === 'magnet' ? 18 : 22;
    const noteW = Math.max(opts.minW, Math.min(opts.maxW, naturalW + padX));
    const singleH = variant === 'magnet' ? 38 : 40;
    const multiH = variant === 'magnet' ? 66 : 68;
    const noteH = lines.length > 1 ? multiH : singleH;
    const x = Math.max(opts.minX, Math.round(opts.centerX - noteW / 2));
    const y = Math.min(Game.logicHeight - noteH - 18, Math.round(opts.y));

    const root = new PIXI.Container();
    root.position.set(x, y);

    const paper = new PIXI.Graphics();
    // 柔和贴面投影
    paper.beginFill(0x160E08, 0.22);
    paper.drawRoundedRect(2, 3.5, noteW, noteH, 8);
    paper.endFill();
    // 温润窄宣纸底签
    paper.lineStyle(2, INK, 0.94);
    paper.beginFill(0xFCF3DF, 0.97);
    paper.drawRoundedRect(0, 0, noteW, noteH, 8);
    paper.endFill();
    // 内衬淡褐细边
    paper.lineStyle(1, 0xDFC394, 0.75);
    paper.drawRoundedRect(3, 3, noteW - 6, noteH - 6, 6);

    if (lines.length > 1) {
      const midY = Math.round(noteH / 2);
      paper.lineStyle(1, 0xCBB089, 0.55);
      paper.moveTo(10, midY);
      paper.lineTo(noteW - 10, midY);
    }

    if (variant === 'magnet') {
      // 顶部袖珍朱砂圆磁贴（几乎不外凸，绝不碰上方升级箭头）
      const mx = noteW / 2;
      paper.lineStyle(1.8, INK, 0.95);
      paper.beginFill(0xD24630, 1);
      paper.drawCircle(mx, 1.5, 5.2);
      paper.endFill();
      paper.lineStyle(0);
      paper.beginFill(0xFFE6DA, 0.85);
      paper.drawCircle(mx - 1.5, 0, 1.6);
      paper.endFill();
    } else {
      // 灶台裙板横签四角袖珍铜钉
      paper.lineStyle(1.4, INK, 0.85);
      paper.beginFill(0xC99642, 1);
      paper.drawCircle(8, 8, 2.8);
      paper.drawCircle(noteW - 8, 8, 2.8);
      paper.endFill();
    }
    paper.eventMode = 'none';
    root.addChild(paper);

    const padTop = variant === 'magnet' ? 5 : 4;
    const innerH = noteH - padTop - 4;
    const lineH = innerH / Math.max(1, lines.length);
    const maxTextW = noteW - (variant === 'magnet' ? 16 : 22);

    lines.forEach((line, idx) => {
      const row = textNodes[idx];
      row.anchor.set(0.5);
      fitTextWidth(row, maxTextW);
      const cy = padTop + idx * lineH;
      row.position.set(noteW / 2, cy + lineH / 2 - 0.5);

      const hit = new PIXI.Graphics();
      hit.beginFill(0xffffff, 0.001);
      hit.drawRect(0, cy, noteW, lineH);
      hit.endFill();
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        line.onTap();
      });
      root.addChild(row, hit);
    });

    root.eventMode = 'static';
    root.hitArea = new PIXI.Rectangle(-2, -2, noteW + 4, noteH + 4);
    root.cursor = 'pointer';
    root.on('pointerdown', (e) => e.stopPropagation());
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._dragMoved) return;
      lines[lines.length - 1]?.onTap();
    });
    this._world.addChild(root);
  }

  /** 只点锅/灶，不要整张桌子布局框里的空地。 */
  private _cookHitRect(): { x: number; y: number; w: number; h: number } {
    const spr = this._furnSpriteRect('table');
    const lv = this._viewLevel('table');
    if (lv >= 5) {
      return {
        x: spr.x + spr.w * 0.08,
        y: spr.y + spr.h * 0.04,
        w: spr.w * 0.84,
        h: spr.h * 0.48,
      };
    }
    return {
      x: spr.x + spr.w * 0.14,
      y: spr.y + spr.h * 0.02,
      w: spr.w * 0.72,
      h: spr.h * 0.50,
    };
  }

  private _houseUpgradeBadge(): PIXI.Container | null {
    const save = KitchenManager.save;
    const level = houseLevel(save);
    if (level >= HOUSE_MAX_LEVEL) return null;
    const state = houseUpgradeState(save);
    const ready = state.status === 'ready';
    const open = this._upgradePick === 'house';
    const mark = houseUpgradeMark(this._viewHouse());
    const pin = mapNorm(this._fit, mark.nx, mark.ny, 0, 0);
    const size = 48;
    const root = this._makeUpgradeBadge(size, ready, open);
    root.position.set(pin.x - size / 2 + HOUSE_UPGRADE_SHIFT_X, pin.y - size / 2);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._upgradePick = this._upgradePick === 'house' ? null : 'house';
      this.relayout();
    });
    return root;
  }

  private _makeUpgradeBadge(size: number, ready: boolean, open: boolean): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x180F07, 0.28);
    bg.drawCircle(size / 2, size / 2 + 2.5, size / 2 - 1);
    bg.endFill();
    bg.lineStyle(2.8, UI_PALETTE.ink, 1);
    bg.beginFill(ready || open ? 0xF5C54D : 0xEFE4D2, 1);
    bg.drawCircle(size / 2, size / 2, size / 2 - 2);
    bg.endFill();
    bg.lineStyle(1.4, ready || open ? 0xFFF5CA : 0xFFFDF8, 0.85);
    bg.drawCircle(size / 2, size / 2, size / 2 - 5.5);
    root.addChild(bg);
    const arrow = new PIXI.Graphics();
    drawUpArrow(arrow, size / 2, size / 2, size, ready || open ? UI_PALETTE.ink : 0x8A7A60);
    root.addChild(arrow);
    root.alpha = ready || open ? 1 : 0.82;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(size / 2, size / 2, size / 2 + 4);
    bindUiClick(root);
    root.on('pointerdown', (e) => e.stopPropagation());
    return root;
  }

  private _upgradeBadge(
    id: FurnId,
    rect: { x: number; y: number; w: number; h: number },
  ): PIXI.Container | null {
    const state = furnUpgradeState(KitchenManager.save, id);
    if (state.status === 'max') return null;
    const ready = state.status === 'ready';
    const open = this._upgradePick === id;
    const size = 48;
    const root = this._makeUpgradeBadge(size, ready, open);
    const bx = rect.x + rect.w / 2 - size / 2;
    const by = rect.y - size + 10;
    root.position.set(bx, by);
    if (id === 'table') {
      this._tableUpgradeRect = { x: bx, y: by, w: size, h: size };
    }
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._upgradePick = this._upgradePick === id ? null : id;
      this.relayout();
    });
    return root;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 家具/房屋修缮宣纸浮签（铜钉宣纸 + 水墨分割线 + 朱印等级 + 手绘价格钮）
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawPinnedSheet(card: PIXI.Container, w: number, h: number): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x120A05, 0.34);
    shadow.drawRoundedRect(6, 10, w - 8, h - 4, 14);
    shadow.endFill();
    card.addChild(shadow);

    const sTex = gameTexture(KITCHEN_SCENE_ART.sheet);
    if (isTextureReady(sTex)) {
      const k = w / sTex.width;
      const plane = new PIXI.NineSlicePlane(sTex, 0, 120, 0, 110);
      plane.width = sTex.width;
      plane.height = h / k;
      plane.scale.set(k);
      card.addChild(plane);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.8, INK, 1);
      g.beginFill(0xF8ECD2, 1);
      g.drawRoundedRect(0, 0, w, h, 12);
      g.endFill();
      card.addChild(g);
    }

    const dTex = gameTexture(KITCHEN_SCENE_ART.divider);
    if (isTextureReady(dTex)) {
      const div = new PIXI.Sprite(dTex);
      div.width = w - 52;
      div.height = 10;
      div.alpha = 0.45;
      div.position.set(26, 66);
      div.eventMode = 'none';
      card.addChild(div);
    }
  }

  private _drawHouseUpgradeCard(): void {
    const save = KitchenManager.save;
    const level = houseLevel(save);
    const state = houseUpgradeState(save);
    const maxed = state.status === 'max';
    const ready = state.status === 'ready';
    const cost = state.status === 'max' ? 0 : state.cost;
    const mark = houseUpgradeMark(this._viewHouse());
    const pin = mapNorm(this._fit, mark.nx, mark.ny, 0, 0);
    const w = Game.designWidth;
    const cardW = 328;
    const cardH = 204;
    let x = pin.x + HOUSE_UPGRADE_SHIFT_X + this._pan.x - cardW / 2;
    let y = pin.y + this._pan.y - cardH - 28;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 74, y);

    const veil = new PIXI.Graphics();
    veil.beginFill(0x000000, 0.001);
    veil.drawRect(0, 0, w, Game.logicHeight);
    veil.endFill();
    veil.eventMode = 'static';
    veil.on('pointerdown', (e) => e.stopPropagation());
    veil.on('pointertap', () => {
      this._upgradePick = null;
      this.relayout();
    });
    this._ui.addChild(veil);

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.on('pointerdown', (e) => e.stopPropagation());
    card.on('pointertap', (e) => e.stopPropagation());
    this._drawPinnedSheet(card, cardW, cardH);

    const name = makeText('title', houseLabel(level), INK, { size: 28 });
    name.position.set(48, 22);
    fitTextWidth(name, cardW - 146);
    card.addChild(name);

    const seal = this._makeMiniSeal(`${level + 1}档`, 44);
    seal.position.set(cardW - 68, 40);
    card.addChild(seal);

    const levelText = makeText(
      'body',
      maxed ? '已修缮至最高档宅院' : `房屋进度：第 ${level + 1}/${HOUSE_MAX_LEVEL + 1} 档`,
      INK_SOFT,
      { size: 22 },
    );
    levelText.position.set(28, 82);
    fitTextWidth(levelText, cardW - 56);
    card.addChild(levelText);

    if (!maxed) {
      const btnW = cardW - 52;
      const btnH = 54;
      const redraw = this._scheduleRelayout;
      const btn = state.status === 'blocked' && !state.error.includes('金')
        ? makeSlicedButton({
          label: state.error,
          width: btnW,
          height: btnH,
          skin: 'cream',
          textColor: 0x8A7358,
          fontSize: 23,
          silent: true,
          onReady: redraw,
        })
        : makeCoinButton({
          prefix: '修缮',
          price: cost,
          width: btnW,
          height: btnH,
          skin: ready ? 'gold' : 'cream',
          textColor: ready ? INK : 0x8A7358,
          fontSize: 24,
          silent: !ready,
          onReady: redraw,
        });
      btn.position.set(26, 126);
      btn.on('pointertap', () => {
        if (!ready) {
          if (state.status === 'blocked') Platform.showToast(state.error);
          return;
        }
        KitchenManager.upgradeHouse();
        this._upgradePick = null;
      });
      card.addChild(btn);
    }
    this._ui.addChild(card);
  }

  private _drawUpgradeCard(id: UpgradePick): void {
    if (id === 'house') {
      this._drawHouseUpgradeCard();
      return;
    }
    const save = KitchenManager.save;
    const lv = furnLevel(save, id);
    const state = furnUpgradeState(save, id);
    const rect = this._furnSpriteRect(id);
    const w = Game.designWidth;
    const cardW = id === 'table' ? 372 : 340;
    const cardH = 208;
    let x = rect.x + rect.w / 2 + this._pan.x - cardW / 2;
    let y = rect.y + this._pan.y - cardH - 58;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 74, y);

    const veil = new PIXI.Graphics();
    veil.beginFill(0x000000, 0.001);
    veil.drawRect(0, 0, w, Game.logicHeight);
    veil.endFill();
    veil.eventMode = 'static';
    veil.on('pointerdown', (e) => e.stopPropagation());
    veil.on('pointertap', () => {
      this._upgradePick = null;
      this.relayout();
    });
    this._ui.addChild(veil);

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.on('pointerdown', (e) => e.stopPropagation());
    card.on('pointertap', (e) => e.stopPropagation());

    const ready = state.status === 'ready';
    this._drawPinnedSheet(card, cardW, cardH);

    const shown = lv + 1;
    const name = makeText('title', furnLabel(id, lv), INK, { size: 28 });
    name.position.set(48, 22);
    fitTextWidth(name, cardW - 146);
    card.addChild(name);

    const seal = this._makeMiniSeal(`${shown}级`, 44);
    seal.position.set(cardW - 68, 40);
    card.addChild(seal);

    const cookNeed = furnCookNeed(id, lv);
    const capLine = (() => {
      if (state.status === 'max') return '已升至最高级';
      const nextShown = lv + 2;
      if (id === 'fridge') {
        return `${nextShown}级容量  ${fridgeOwnCap(lv)} → ${fridgeOwnCap(lv + 1)} 格`;
      }
      if (id === 'foam') {
        return `湿货容量  ${foamWetCols(lv)}×${foamWetRows(lv)} → ${foamWetCols(lv + 1)}×${foamWetRows(lv + 1)}`;
      }
      if (id === 'basket') {
        return `干货容量  ${bagDryCols(lv)}×${bagRows(lv)} → ${bagDryCols(lv + 1)}×${bagRows(lv + 1)}`;
      }
      if (id === 'table') {
        const curPct = Math.round((stovePriceMul(lv) - 1) * 100);
        const nextPct = Math.round((stovePriceMul(lv + 1) - 1) * 100);
        const newly = newlyCookableByTableUpgrade(recipeUnlockView(save), lv, lv + 1);
        if (newly.length > 0) {
          return `售价+${nextPct}% · 开炒《${newly[0].name}》${newly.length > 1 ? `等${newly.length}道` : ''}`;
        }
        return `火候精进 · 成菜售价 +${curPct}% → +${nextPct}%`;
      }
      return `升至 ${nextShown} 级`;
    })();
    const level = makeText('body', capLine, INK_SOFT, { size: 22 });
    level.position.set(28, 82);
    fitTextWidth(level, cardW - 56);
    card.addChild(level);

    if (state.status !== 'max') {
      const needHouse = state.status === 'blocked' && lv >= houseFurnCap(houseLevel(save), id);
      const needCook = state.status === 'blocked' && cookLevel(save) < cookNeed;
      const btnW = cardW - 52;
      const btnH = 54;
      const redraw = this._scheduleRelayout;
      const btn = needHouse || needCook
        ? makeSlicedButton({
          label: needHouse ? `需${houseLabel(minHouseForFurn(id, lv + 1))}` : `厨艺 ${cookNeed} 级解锁`,
          width: btnW,
          height: btnH,
          skin: 'cream',
          textColor: 0x8A7358,
          fontSize: 23,
          silent: true,
          onReady: redraw,
        })
        : makeCoinButton({
          prefix: '升级',
          price: state.cost,
          width: btnW,
          height: btnH,
          skin: ready ? 'olive' : 'cream',
          textColor: ready ? 0xFFF8F0 : 0x8A7358,
          fontSize: 24,
          silent: !ready,
          onReady: redraw,
        });
      btn.position.set(26, 128);
      if (id === 'table') {
        this._upgradeConfirmRect = { x: x + 26, y: y + 128, w: btnW, h: btnH };
      }
      btn.on('pointertap', () => {
        if (!ready) {
          if (state.status === 'blocked') Platform.showToast(state.error);
          return;
        }
        if (TutorialManager.isStep(TutorialStep.HINT_DOOR) && id === 'table') {
          this._upgradePick = null;
          KitchenManager.upgrade(id);
          TutorialManager.advanceIf(TutorialStep.HINT_DOOR);
          return;
        }
        KitchenManager.upgrade(id);
      });
      card.addChild(btn);
    }
    this._ui.addChild(card);
  }

  private _makeMiniSeal(text: string, size = 44): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const tex = gameTexture(KITCHEN_SCENE_ART.seal);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, size, size);
      sp.anchor.set(0.5);
      root.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.beginFill(0xC43426, 1);
      g.drawRoundedRect(-size / 2, -size / 2, size, size, 8);
      g.endFill();
      root.addChild(g);
    }
    const t = makeText('caption', text, 0xFFF4E6, { size: 19, fontWeight: '700' });
    t.anchor.set(0.5);
    fitTextWidth(t, size - 8);
    root.addChild(t);
    root.rotation = -0.08;
    return root;
  }

  private _hotspot(
    id: HotspotId,
    _label: string,
    rect: { x: number; y: number; w: number; h: number },
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(rect.x, rect.y);
    const hit = new PIXI.Graphics();
    hit.beginFill(0xffffff, 0.001);
    hit.drawRoundedRect(0, 0, rect.w, rect.h, 10);
    hit.endFill();
    root.addChild(hit);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, rect.w, rect.h);
    this._spotRects.set(id, rect);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._onSpot(id);
    });
    return root;
  }

  private _onSpot(id: HotspotId): void {
    if (id === 'door') {
      if (TutorialGuard.block('door')) return;
      this.goMarket();
      return;
    }
    if (id === 'fridge') {
      if (TutorialGuard.block('openFridge')) return;
      this._fridge.open(TutorialManager.at(TutorialStep.OPEN_FRIDGE, TutorialStep.INSPECT_DISH, TutorialStep.SELL_DISH) ? 'dish' : undefined);
      TutorialManager.advanceIf(TutorialStep.OPEN_FRIDGE);
      return;
    }
    if (id === 'board') {
      if (TutorialGuard.block('openCook')) return;
      this._cook.open(TutorialManager.at(TutorialStep.COOK_TABLE, TutorialStep.COOK_DISH) ? 'stirfry' : undefined);
      TutorialManager.advanceIf(TutorialStep.COOK_TABLE);
      return;
    }
    if (id === 'basket' || id === 'foam') {
      if (TutorialGuard.block('upgrade')) return;
      this._upgradePick = id;
      this.relayout();
    }
  }

  /** 老坛 / 阿橘头顶手绘气泡牌（22pt 浓墨清晰大字 + 朱红提示印点）。 */
  private _makePropTag(text: string, tone: 'cream' | 'warm' | 'gold', pulse = false): PIXI.Container {
    const tag = new PIXI.Container();
    tag.eventMode = 'none';
    const textColor = tone === 'gold' ? RED_INK : tone === 'warm' ? 0x9A421A : INK;
    const lbl = makeText('body', text, textColor, {
      size: 22,
      fontWeight: '700',
    });
    const pw = Math.max(128, Math.ceil(lbl.width) + 36);
    const ph = 52;

    const bTex = gameTexture(KITCHEN_SCENE_ART.bubble);
    if (isTextureReady(bTex)) {
      const sp = new PIXI.Sprite(bTex);
      sp.width = pw;
      sp.height = ph + 10;
      sp.anchor.set(0.5);
      sp.position.set(0, 3);
      if (tone === 'gold') sp.tint = 0xFFF3C8;
      tag.addChild(sp);
    } else {
      const bg = new PIXI.Graphics();
      bg.beginFill(0x160E08, 0.24);
      bg.drawRoundedRect(-pw / 2, -ph / 2 + 3, pw, ph, 14);
      bg.endFill();
      bg.lineStyle(2.4, INK, 1);
      bg.beginFill(tone === 'gold' ? 0xFFF3C4 : 0xFAF0DA, 0.98);
      bg.drawRoundedRect(-pw / 2, -ph / 2, pw, ph, 14);
      bg.endFill();
      tag.addChild(bg);
    }
    lbl.anchor.set(0.5);
    lbl.position.set(0, -1);
    tag.addChild(lbl);

    if (pulse) {
      const dot = new PIXI.Graphics();
      dot.lineStyle(2, INK, 1);
      dot.beginFill(0xD93829, 1);
      dot.drawCircle(pw / 2 - 8, -ph / 2 + 6, 7);
      dot.endFill();
      tag.addChild(dot);

      const bob = (): void => {
        if (!isStageMounted(tag)) return;
        const y0 = tag.y;
        TweenManager.to({
          target: tag,
          props: { y: y0 - 6 },
          duration: 0.55,
          ease: Ease.easeOutQuad,
          onComplete: () => {
            if (!isStageMounted(tag)) return;
            TweenManager.to({
              target: tag,
              props: { y: y0 },
              duration: 0.55,
              ease: Ease.easeInOutQuad,
              onComplete: bob,
            });
          },
        });
      };
      bob();
    }
    return tag;
  }

  /** 右侧切视角挂签（牛皮纸麻绳挂签风格，24pt 主标 + 20pt 副标）。 */
  private _drawWindowCornerHud(w: number, save: KitchenSave, redraw: () => void): void {
    const minX = this._minPanX();
    if (minX >= -24) return;

    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    // 置于右上窗帘空白处，完全避开下方冰箱顶部便签 (y ≈ 490)
    const tabY = Math.round(Math.max(top + 132, Math.min(296, Game.logicHeight * 0.22)));
    const now = Date.now();
    const readyCount = pickleReadyCount(save, now);
    const catView = catStateView(save, now);
    const catGift = catView.effectiveStatus === 'gift';
    const catNew = catView.unlocked && catView.effectiveStatus === 'unadopted';
    const hasAlert = readyCount > 0 || catGift || catNew;

    // 1. 滑往右侧窗边角（老坛 & 阿橘）
    const toWin = new PIXI.Container();
    const winW = 196;
    const winH = 86;
    const wBg = new PIXI.Graphics();
    wBg.beginFill(0x160E08, 0.3);
    wBg.drawRoundedRect(0, 5, winW + 18, winH, 16);
    wBg.endFill();
    wBg.lineStyle(2.8, INK, 1);
    wBg.beginFill(hasAlert ? 0xD89A32 : 0x7A4B24, 1);
    wBg.drawRoundedRect(0, 0, winW + 18, winH, 16);
    wBg.endFill();
    wBg.lineStyle(1.4, 0xFFFDF8, 0.88);
    wBg.beginFill(hasAlert ? 0xFFF7DC : 0xFAF0DA, 1);
    wBg.drawRoundedRect(5, 5, winW + 12, winH - 11, 12);
    wBg.endFill();
    toWin.addChild(wBg);

    const pArt = P2_ART.pickleTiers[pickleTier(save)];
    const cArt = P2_ART.catTiers[catBedTier(save)];
    const iconPath = readyCount > 0
      ? pArt.ready
      : catGift
        ? cArt.gift
        : cArt.idle;
    this._watchOnce(iconPath);
    const itex = gameTexture(iconPath);
    if (isTextureReady(itex)) {
      const sp = new PIXI.Sprite(itex);
      fitSpriteInBox(sp, 54, 54);
      sp.anchor.set(0.5);
      sp.position.set(36, winH / 2 - 1);
      sp.eventMode = 'none';
      toWin.addChild(sp);
    }

    const t1 = makeText('heading', '窗边角 ▶', INK, { size: 24 });
    t1.position.set(68, 12);
    const subText = readyCount > 0
      ? '老坛可开！'
      : catGift
        ? '阿橘带礼！'
        : catNew
          ? '橘猫上门！'
          : '老坛·阿橘';
    const t2 = makeText('caption', subText, hasAlert ? RED_INK : MUTED, {
      size: 20,
      fontWeight: '700',
    });
    t2.position.set(68, 46);
    toWin.addChild(t1, t2);

    if (hasAlert) {
      const dot = new PIXI.Graphics();
      dot.lineStyle(2.2, INK, 1);
      dot.beginFill(0xE03E2D, 1);
      dot.drawCircle(10, 10, 9);
      dot.endFill();
      toWin.addChild(dot);
    }

    toWin.position.set(w - winW, tabY);
    toWin.eventMode = 'static';
    toWin.cursor = 'pointer';
    toWin.hitArea = new PIXI.Rectangle(-6, -4, winW + 12, winH + 8);
    toWin.on('pointerdown', (e) => e.stopPropagation());
    toWin.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._tweenPanTo(this._minPanX());
    });
    this._ui.addChild(toWin);
    this._toWindowTab = toWin;

    // 2. 滑回左侧主灶与门口
    const toDoor = new PIXI.Container();
    const doorW = 166;
    const doorH = 80;
    const dBg = new PIXI.Graphics();
    dBg.beginFill(0x160E08, 0.28);
    dBg.drawRoundedRect(0, 5, doorW + 18, doorH, 16);
    dBg.endFill();
    dBg.lineStyle(2.8, INK, 1);
    dBg.beginFill(0x7A4B24, 1);
    dBg.drawRoundedRect(0, 0, doorW + 18, doorH, 16);
    dBg.endFill();
    dBg.lineStyle(1.4, 0xFFFDF8, 0.88);
    dBg.beginFill(0xFAF0DA, 1);
    dBg.drawRoundedRect(5, 5, doorW + 12, doorH - 11, 12);
    dBg.endFill();
    toDoor.addChild(dBg);

    const dt1 = makeText('heading', '◀ 回主灶', INK, { size: 24 });
    dt1.position.set(18, 11);
    const dt2 = makeText('caption', '门口·冰柜', MUTED, { size: 20, fontWeight: '700' });
    dt2.position.set(22, 43);
    toDoor.addChild(dt1, dt2);

    toDoor.position.set(w - doorW, tabY);
    toDoor.eventMode = 'static';
    toDoor.cursor = 'pointer';
    toDoor.hitArea = new PIXI.Rectangle(-6, -4, doorW + 12, doorH + 8);
    toDoor.on('pointerdown', (e) => e.stopPropagation());
    toDoor.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._tweenPanTo(0);
    });
    this._ui.addChild(toDoor);
    this._toDoorTab = toDoor;
  }

  private _drawPickleProp(
    save: KitchenSave,
    fit: ReturnType<typeof fitWidthBottom>,
  ): void {
    const now = Date.now();
    const unlocked = pickleUnlocked(save);
    const readyCount = pickleReadyCount(save, now);
    const fermCount = pickleFermentingCount(save, now);
    const hasSecond = unlocked && !!save.secondJarUnlocked;
    const slot0Ready = unlocked && pickleSlotView(save, 0, now).status === 'ready';
    const slot1Ready = hasSecond && pickleSlotView(save, 1, now).status === 'ready';

    const pArt = P2_ART.pickleTiers[pickleTier(save)];
    const mainArt = slot0Ready ? pArt.ready : pArt.idle;
    this._watchOnce(mainArt);
    if (hasSecond) {
      const subArt = slot1Ready ? pArt.ready : pArt.idle;
      this._watchOnce(subArt);
    }

    const box = mapNorm(fit, PICKLE_BAY_POSE.nx, PICKLE_BAY_POSE.ny, PICKLE_BAY_POSE.nw, PICKLE_BAY_POSE.nh);
    const root = new PIXI.Container();
    root.position.set(box.x, box.y);

    let topAnchorX = box.w / 2;
    let topAnchorY = 0;

    if (hasSecond) {
      const b0 = mapNorm(fit, PICKLE_BAY_DUAL_POSES[0].nx, PICKLE_BAY_DUAL_POSES[0].ny, PICKLE_BAY_DUAL_POSES[0].nw, PICKLE_BAY_DUAL_POSES[0].nh);
      const b1 = mapNorm(fit, PICKLE_BAY_DUAL_POSES[1].nx, PICKLE_BAY_DUAL_POSES[1].ny, PICKLE_BAY_DUAL_POSES[1].nw, PICKLE_BAY_DUAL_POSES[1].nh);
      const tex0 = gameTexture(mainArt);
      let top0 = b0.y - box.y;
      if (isTextureReady(tex0)) {
        const spr0 = new PIXI.Sprite(tex0);
        fitSpriteInBox(spr0, b0.w, b0.h);
        spr0.anchor.set(0.5, 1);
        spr0.position.set(b0.x - box.x + b0.w / 2, b0.y - box.y + b0.h);
        spr0.eventMode = 'none';
        root.addChild(spr0);
        top0 = spr0.y - spr0.height * 0.975;
      }
      const tex1 = gameTexture(slot1Ready ? pArt.ready : pArt.idle);
      if (isTextureReady(tex1)) {
        const spr1 = new PIXI.Sprite(tex1);
        fitSpriteInBox(spr1, b1.w, b1.h);
        spr1.anchor.set(0.5, 1);
        spr1.position.set(b1.x - box.x + b1.w / 2, b1.y - box.y + b1.h);
        spr1.eventMode = 'none';
        root.addChild(spr1);
      }
      topAnchorX = ((b0.x + b0.w / 2) + (b1.x + b1.w / 2)) / 2 - box.x;
      topAnchorY = top0;
    } else {
      const tex = gameTexture(mainArt);
      if (isTextureReady(tex)) {
        const spr = new PIXI.Sprite(tex);
        fitSpriteInBox(spr, box.w, box.h);
        spr.anchor.set(0.5, 1);
        spr.position.set(box.w / 2, box.h);
        if (!unlocked) {
          spr.tint = 0xD8CABA;
          spr.alpha = 0.85;
        }
        spr.eventMode = 'none';
        root.addChild(spr);
        topAnchorY = spr.y - spr.height * 0.975;
      }
    }

    const tagText = !unlocked
      ? `老坛·${PICKLE_UNLOCK_LEVEL}级开`
      : readyCount > 0
        ? '可开坛！'
        : fermCount > 0
          ? '发酵中'
          : '老坛腌菜';
    const tone = !unlocked ? 'cream' : readyCount > 0 ? 'gold' : fermCount > 0 ? 'warm' : 'cream';
    const tag = this._makePropTag(tagText, tone, readyCount > 0);
    tag.position.set(topAnchorX, topAnchorY - 26);
    root.addChild(tag);

    if (!this._gm) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      const hitW = hasSecond ? box.w * 1.45 : box.w + 16;
      const hitH = hasSecond ? box.h * 1.32 : box.h + 30;
      root.hitArea = new PIXI.Rectangle(-12, topAnchorY - 46, hitW, hitH + 24);
      root.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        if (!unlocked) {
          AudioManager.play('ui_deny');
          Platform.showToast(`厨艺升到 ${PICKLE_UNLOCK_LEVEL} 级就能开启老坛腌制坊啦！`);
          return;
        }
        KitchenManager.markGuideSeen('guide_pickle_bay');
        this._pickle.open();
      });
    } else {
      root.eventMode = 'none';
    }
    this._world.addChild(root);
    this._picklePropNode = root;
  }

  private _drawCatProp(
    save: KitchenSave,
    fit: ReturnType<typeof fitWidthBottom>,
  ): void {
    const view = catStateView(save, Date.now());
    const cArt = P2_ART.catTiers[catBedTier(save)];
    const isFlatCushion = !view.unlocked || view.effectiveStatus === 'away';
    const artPath = isFlatCushion
      ? cArt.away
      : view.effectiveStatus === 'gift'
        ? cArt.gift
        : cArt.idle;
    this._watchOnce(artPath);

    const box = mapNorm(fit, CAT_BAY_POSE.nx, CAT_BAY_POSE.ny, CAT_BAY_POSE.nw, CAT_BAY_POSE.nh);
    const root = new PIXI.Container();
    root.position.set(box.x, box.y);
    const tex = gameTexture(artPath);
    let visibleTopY = isFlatCushion ? box.h * 0.42 : box.h * 0.16;
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, box.w, box.h);
      spr.anchor.set(0.5, 1);
      spr.position.set(box.w / 2, box.h);
      spr.eventMode = 'none';
      root.addChild(spr);
      const visibleHeightRatio = isFlatCushion ? 0.664 : 0.86;
      visibleTopY = spr.y - spr.height * visibleHeightRatio;
    }

    const tagText = !view.unlocked
      ? `猫窝·${CAT_UNLOCK_LEVEL}级来`
      : view.effectiveStatus === 'unadopted'
        ? '小橘猫来啦！'
        : view.effectiveStatus === 'gift'
          ? '阿橘带礼回！'
          : view.effectiveStatus === 'away'
            ? '阿橘巡街中'
            : '阿橘小窝';
    const isUrgent = view.effectiveStatus === 'unadopted' || view.effectiveStatus === 'gift';
    const tone = isUrgent ? 'gold' : view.effectiveStatus === 'away' ? 'warm' : 'cream';
    const tag = this._makePropTag(tagText, tone, isUrgent);
    tag.position.set(box.w / 2, visibleTopY - 26);
    root.addChild(tag);

    if (!this._gm) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(-10, visibleTopY - 46, box.w + 20, box.h - visibleTopY + 50);
      root.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        if (!view.unlocked) {
          AudioManager.play('ui_deny');
          Platform.showToast(`厨艺升到 ${CAT_UNLOCK_LEVEL} 级，流浪小橘猫就会闻香找上门啦！`);
          return;
        }
        KitchenManager.markGuideSeen('guide_cat_bay');
        this._strayCat.open();
      });
    } else {
      root.eventMode = 'none';
    }
    this._world.addChild(root);
    this._catPropNode = root;
  }

  private goMarket(): void {
    if (!KitchenManager.canGoMarket()) {
      AudioManager.play('ui_deny');
      void KitchenManager.offerShareStamina();
      return;
    }
    if (OutingCurtain.busy) return;
    AudioManager.play('outing');
    TutorialManager.advanceIf(TutorialStep.HINT_DOOR);
    OutingCurtain.play({
      paths: destinationBootPaths(),
      then: () => SceneManager.switchTo('destinations'),
    });
  }
}

function drawUpArrow(g: PIXI.Graphics, cx: number, cy: number, size: number, color: number): void {
  const s = size * 0.42;
  g.beginFill(color);
  g.moveTo(cx, cy - s * 0.55);
  g.lineTo(cx + s * 0.46, cy - s * 0.02);
  g.lineTo(cx + s * 0.18, cy - s * 0.02);
  g.lineTo(cx + s * 0.18, cy + s * 0.52);
  g.lineTo(cx - s * 0.18, cy + s * 0.52);
  g.lineTo(cx - s * 0.18, cy - s * 0.02);
  g.lineTo(cx - s * 0.46, cy - s * 0.02);
  g.closePath();
  g.endFill();
}
