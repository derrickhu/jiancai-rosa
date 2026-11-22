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
  tableUnlockNext,
  computeFridgeSlip,
  computeKitchenSlip,
  dailyMenuRemain,
  kitchenSlipMissToast,
  liveHudBuffs,
  layoutFor,
  saveGmLayout,
  clampHouseLevel,
  type FurnId,
  type FurnLayout,
  type KitchenSave,
} from '@/sim';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import {
  HUD_ICON,
  P2_ART,
  PLAYER_LEVEL_HUD,
  UI_PALETTE,
  bindUiClick,
  drawCraftCard,
  fillRect,
  hudBuffRowY,
  hudPillsY,
  makeButton,
  makeHudBuffRow,
  makeLabel,
  makeMuteButton,
  makePlayerLevelHud,
  makeSidebarIconBtn,
  makeSlicedButton,
  makeStatPill,
} from '@/utils/ui';
import { applyFit, fitSpriteInBox, fitWidthBottom, gameTexture, isTextureFailed, isTextureReady, mapNorm, preloadTextures, retryTexture, watchTextures, whenTextureReady } from '@/utils/assets';
import { kitchenBootPaths } from '@/utils/bootAssets';
import { dailyMenuPanelPaths, orderPanelPaths } from '@/utils/panelAssets';
import { setKitchenFridgeHudPos, setKitchenGachaHudPos } from '@/utils/coinCollect';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { destinationBootPaths } from '@/utils/outingAssets';
import { RunManager } from '@/managers/RunManager';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, worldRectToStage, type SpotlightRect, type TutorialTarget } from '@/gameobjects/ui/TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

type HotspotId = 'door' | 'basket' | 'fridge' | 'foam' | 'board';
type UpgradePick = FurnId | 'house';

const DRAG_SLOP = 14;
const HOUSE_UPGRADE_SHIFT_X = 50;
const KITCHEN_SLIP = 'subpkg_kitchen/ui_kitchen_slip.png';

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
  private _offerTimer = 0;
  private _onChange = () => {
    const fx = KitchenManager.consumeCookFx();
    if (fx) playCookReadyFx(fx);
    if (KitchenManager.consumeNudgeOffer()) this._queueNeighborOffer();
    this._warmPanelArt();
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
    this._fridge.onChange = () => this.relayout();
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
    ensureRecipeUnlockPanel();
    ensureCookLevelUpPanel();
    ensureTutorialGiftPanel();
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
    EventBus.on(EV.kitchenChanged, this._onChange);
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
    this._bootRetryLeft = 8;
    this.relayout();
    AudioManager.playBgm('kitchen');
    if (!TutorialManager.isActive) {
      ensureCookLevelUpPanel().present();
      ensureRecipeUnlockPanel().present();
      KitchenManager.beginKitchenVisit();
      this._warmPanelArt();
      this._queueNeighborOffer();
    }
    this._startP2Watch();
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
      if (sig !== this._lastP2Sig) {
        this._lastP2Sig = sig;
        this.relayout();
      }
    }, 2000);
  }

  private _stopP2Watch(): void {
    if (this._p2WatchTimer) {
      clearInterval(this._p2WatchTimer);
      this._p2WatchTimer = null;
    }
  }

  private _warmPanelArt(): void {
    void preloadTextures(dailyMenuPanelPaths(KitchenManager.save));
    void preloadTextures(orderPanelPaths(KitchenManager.save, KitchenManager.liveNeighborOrders()));
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
    EventBus.off(EV.kitchenChanged, this._onChange);
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
  }

  relayout(): void {
    if (!Platform.isDevtools) this._gm = false;
    this._fridge.prune();
    this._world.removeChildren();
    this._ui.removeChildren();
    this._toWindowTab = null;
    this._toDoorTab = null;
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
    watchTextures(kitchenBootPaths(save), () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
    whenTextureReady(roomPath, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
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
      for (const path of miss) retryTexture(path);
      watchTextures(miss, () => {
        if (this.container.parent && !this._itemDrag) this.relayout();
      });
    }, 700) as unknown as number;
  }

  tutorialRect(): SpotlightRect | TutorialTarget | null {
    if (!TutorialManager.isActive) return null;
    const step = TutorialManager.currentStep;
    if (step === TutorialStep.HINT_DOOR) {
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
              body: '升到 2 级烹饪台，立刻解锁「清炒土豆丝」！\n做熟菜才能涨厨艺开新菜场。',
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
              title: '升级灶台学新菜',
              body: '刚挣了菜钱！点灶台上的圆箭头升级，\n解锁新菜谱，做熟菜才能涨厨艺。',
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
  }

  private _furniture(
    furn: FurnLayout,
    save: KitchenSave,
    fit: ReturnType<typeof fitWidthBottom>,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const rect = mapNorm(fit, furn.nx, furn.ny, furn.nw, furn.nh);
    root.position.set(rect.x, rect.y);
    const path = this._furnPath(furn.id, this._viewLevel(furn.id));
    const tex = gameTexture(path);
    whenTextureReady(path, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
    if (isTextureReady(tex)) {
      const sprite = new PIXI.Sprite(tex);
      fitSpriteInBox(sprite, rect.w, rect.h);
      sprite.anchor.set(0.5, furn.hang ? 0 : 1);
      sprite.position.set(rect.w / 2, furn.hang ? 0 : rect.h);
      sprite.eventMode = 'none';
      root.addChild(sprite);
    }
    const tag = makeLabel(furnLabel(furn.id, this._viewLevel(furn.id)), 18, 0xFFF8F0);
    const tagBg = new PIXI.Graphics();
    fillRect(tagBg, 4, 4, Math.min(rect.w - 8, tag.width + 16), 28, 0x2A2018, 8);
    tagBg.alpha = 0.7;
    tag.position.set(12, 8);
    if (this._gm) {
      root.addChild(tagBg);
      root.addChild(tag);
    }
    if (this._gm) {
      const frame = new PIXI.Graphics();
      frame.lineStyle(2, this._gmPick === furn.id ? 0xE0A100 : 0xFFFFFF, 0.7);
      frame.drawRoundedRect(0, 0, rect.w, rect.h, 10);
      frame.eventMode = 'none';
      root.addChild(frame);
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

  private _drawHud(w: number): void {
    const save = KitchenManager.save;
    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    const y = Math.max(4, top - 16);
    const redraw = () => {
      if (this.container.parent) this.relayout();
    };

    const skill = cookXpView(save);
    const profile = makePlayerLevelHud({
      avatar: HUD_ICON.player,
      level: skill.level,
      text: skill.text,
      fill: skill.fill,
      onReady: redraw,
    });
    profile.position.set(12, y);
    this._ui.addChild(profile);

    const pillH = 44;
    const buffs = liveHudBuffs(save);
    const pillY = hudPillsY(y, pillH);
    const resX = 12 + PLAYER_LEVEL_HUD.avatar + PLAYER_LEVEL_HUD.gap + PLAYER_LEVEL_HUD.barW + 12;
    const money = makeStatPill({
      icon: 'subpkg_images/hud_coin.png',
      text: `${save.money}`,
      width: 164,
      onIconReady: redraw,
    });
    money.position.set(resX, pillY);
    this._ui.addChild(money);

    const staMax = staminaMax(save);
    const staShort = save.stamina < staMax;
    const sta = makeStatPill({
      icon: 'subpkg_images/hud_stamina.png',
      text: `${save.stamina}/${staMax}`,
      width: 188,
      fill: save.stamina / staMax,
      fillColor: 0x6BA368,
      plus: staShort,
      pulsePlus: save.stamina <= 0,
      onTap: staShort
        ? () => {
          if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.HINT_DOOR)) return;
          void KitchenManager.offerShareStamina();
        }
        : undefined,
      onIconReady: redraw,
    });
    sta.position.set(resX + 172, pillY);
    this._ui.addChild(sta);

    if (buffs.length) {
      const row = makeHudBuffRow({
        buffs,
        onReady: redraw,
        onTap: () => ensureHudBuffPanel().open(),
      });
      row.position.set(resX, hudBuffRowY(pillY, pillH));
      this._ui.addChild(row);
    }


    const STEP = 100;
    const dexY = top + 148;
    let slot = dexY;
    this._drawDexHud(redraw, slot);
    slot += STEP;
    if (Platform.isWechat) {
      this._drawGameClubHud(redraw, slot);
      slot += STEP;
    }
    if (Platform.isDouyin) {
      this._drawWelfareHud(redraw, slot);
      slot += STEP;
    }
    if (!TutorialManager.isActive && KitchenManager.save.dailyMenu) {
      this._drawDailyMenuHud(redraw, slot);
      slot += STEP;
    }
    if (!TutorialManager.isActive) {
      this._drawGachaHud(redraw, slot);
      slot += STEP;
    }
    if (KitchenManager.liveNeighborOrders().length) {
      this._drawOrderHud(redraw, slot);
      slot += STEP;
    }
    const mute = makeMuteButton(48);
    mute.position.set(22, slot + 12);
    const stopMute = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    mute.on('pointerdown', stopMute);
    this._ui.addChild(mute);

    if (!TutorialManager.isActive) {
      this._drawWindowCornerHud(w, save, redraw);
    }

    if (this._gm) {
      const hint = makeLabel('GM：拖家具 · 屋+/屋-换房子 · 导出后发给我固化', 18, 0xF4EFE6);
      const hintBg = new PIXI.Graphics();
      fillRect(hintBg, 16, Game.logicHeight - 56, w - 32, 40, 0x2A2018, 12);
      hintBg.alpha = 0.55;
      hint.position.set(32, Game.logicHeight - 48);
      this._ui.addChild(hintBg);
      this._ui.addChild(hint);
    }
    this._drawGmBar(w);
  }

  private _drawOrderHud(redraw: () => void, y: number): void {
    const orders = KitchenManager.liveNeighborOrders();
    if (!orders.length) return;
    const npc = neighborNpc(orders[0].npcId);
    whenTextureReady(npc.portrait, redraw);
    const size = 72;
    let customIcon: PIXI.Container | undefined;
    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      customIcon = new PIXI.Container();
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRoundedRect(5, 4, size - 10, size - 12, 14);
      mask.endFill();
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size - 6, size - 6);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2 - 2);
      spr.mask = mask;
      spr.eventMode = 'none';
      customIcon.addChild(mask, spr);
    }

    const n = Math.min(9, orders.length);
    const btn = makeSidebarIconBtn({
      customIcon,
      fallbackText: '客',
      label: '点菜',
      badgeText: `${n}`,
      badgeTone: 'red',
      size,
      onReady: redraw,
      onTap: () => this._orders.open(),
    });
    btn.position.set(12, y);
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
  }

  private _drawDailyMenuHud(redraw: () => void, y: number): void {
    const save = KitchenManager.save;
    const left = dailyMenuRemain(save.dailyMenu);
    const canExtra = !!save.dailyMenu?.boardClaimed && canUseDailyAd(save, 'daily_extra');
    const badgeText = left > 0 ? `${Math.min(9, left)}` : canExtra ? '加' : undefined;
    const badgeTone = left > 0 ? 'red' : 'gold';
    const btn = makeSidebarIconBtn({
      icon: HUD_ICON.dailyMenu,
      fallbackText: '桌',
      label: '小饭桌',
      badgeText,
      badgeTone,
      highlight: canExtra && left <= 0,
      size: 72,
      onReady: redraw,
      onTap: () => this._daily.open(),
    });
    btn.position.set(12, y);
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
  }

  private _drawGachaHud(redraw: () => void, y: number): void {
    const size = 72;
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

    const btn = makeSidebarIconBtn({
      icon: HUD_ICON.gacha,
      fallbackText: '谱',
      label: '抽谱',
      badgeText,
      badgeTone,
      highlight: tickets >= 2 || freeBox,
      size,
      onReady: redraw,
      onTap: () => this._gacha.open(),
    });
    btn.position.set(12, y);
    setKitchenGachaHudPos({ x: 12 + size / 2, y: y + size / 2 });
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
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

  private _drawGameClubHud(redraw: () => void, y: number): void {
    const btn = makeSidebarIconBtn({
      icon: HUD_ICON.gameClub,
      fallbackText: '圈',
      label: '游戏圈',
      size: 72,
      onReady: redraw,
      onTap: () => this._gameClub.open(),
    });
    btn.position.set(12, y);
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
  }

  private _drawWelfareHud(_redraw: () => void, y: number): void {
    if (!DouyinWelfareManager.hasEntry) return;
    const btn = makeSidebarIconBtn({
      fallbackText: '福',
      label: '福利',
      badgeText: DouyinWelfareManager.hasRedDot ? '领' : undefined,
      badgeTone: 'red',
      highlight: DouyinWelfareManager.hasRedDot,
      size: 72,
      onTap: () => this._welfare.open(),
    });
    btn.position.set(12, y);
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
  }

  private _drawDexHud(redraw: () => void, y: number): void {
    const redCount = !TutorialManager.isActive ? dexRedDotCount(KitchenManager.save) : 0;
    const badgeText = redCount > 0 ? (redCount > 99 ? '99+' : `${redCount}`) : undefined;
    const btn = makeSidebarIconBtn({
      icon: HUD_ICON.dex,
      fallbackText: '鉴',
      label: '图鉴',
      badgeText,
      badgeTone: 'red',
      size: 72,
      onReady: redraw,
      onTap: () => this._dex.open(),
    });
    btn.position.set(12, y);
    btn.on('pointerdown', (e) => e.stopPropagation());
    this._ui.addChild(btn);
  }

  private _drawGmBar(w: number): void {
    if (!Platform.isDevtools) return;
    const y = Game.logicHeight - 118;
    const stop = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    const gm = makeButton(this._gm ? 'GM开' : 'GM关', 100, 48, this._gm ? 0xC46A3A : 0x4A433C);
    gm.position.set(16, y);
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

    const houseName = makeLabel(houseLabel(this._viewHouse()), 18, 0xF4EFE6);
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

    const artName = makeLabel(`厨艺 ${KitchenManager.save.level}`, 18, 0xF4EFE6);
    artName.position.set(510, y - 28);
    this._ui.addChild(artName);

    const pick = this._gmPick;
    const lv = pick ? this._viewLevel(pick) : 0;
    const name = makeLabel(
      pick ? `${furnLabel(pick, lv)} ${lv + 1}级` : '点一件再拖',
      18,
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

  private _drawKitchenSlip(): void {
    const slip = computeKitchenSlip(KitchenManager.save);
    const lines: Array<{ text: string; color: number; onTap: () => void }> = [];
    if (slip.can) {
      const can = slip.can;
      lines.push({
        text: `能做 · ${can.name}`,
        color: 0x2A2018,
        onTap: () => this._cook.open(can.recipeId),
      });
    }
    if (slip.miss) {
      const miss = slip.miss;
      lines.push({
        text: `还差 · ${miss.itemName}`,
        color: 0xC46A3A,
        onTap: () => {
          this._cook.open(miss.recipeId);
          Platform.showToast(kitchenSlipMissToast(miss));
        },
      });
    }
    if (!lines.length) return;
    const pot = this._cookHitRect();
    const lv = this._viewLevel('table');
    const maxW = lv <= 4 ? 118 : 132;
    const minW = 92;
    this._mountOilSlip(
      pot.x + pot.w * 0.30,
      pot.y + pot.h * 0.04,
      pot.w * 0.38,
      maxW,
      minW,
      lines,
      -0.16,
      14,
    );
  }

  private _drawFridgeSlip(): void {
    const rows = computeFridgeSlip(KitchenManager.save);
    if (!rows.length) return;
    const door = this._furnSpriteRect('fridge');
    const lv = this._viewLevel('fridge');
    const maxW = lv <= 2 ? 108 : lv <= 5 ? 132 : 156;
    const minW = lv <= 2 ? 88 : 104;
    const wantW = door.w * (lv <= 2 ? 0.52 : 0.40);
    const noteW = Math.round(Math.min(maxW, Math.max(minW, wantW)));
    const tex = gameTexture(KITCHEN_SLIP);
    const ratio = isTextureReady(tex) && tex.width > 0 ? tex.height / tex.width : 457 / 720;
    const noteH = Math.round(noteW * ratio);
    this._mountOilSlip(
      door.x + door.w * 0.58,
      door.y - noteH * 0.18,
      noteW,
      noteW,
      noteW,
      rows.map((row) => ({
        text: row.text,
        color: row.tone === 'full' ? 0xC46A3A : 0x2A2018,
        onTap: () => this._fridge.open(row.tab),
      })),
      0,
      lv <= 2 ? 13 : 15,
    );
  }

  private _mountOilSlip(
    x: number,
    y: number,
    wantW: number,
    maxW: number,
    minW: number,
    lines: Array<{ text: string; color: number; onTap: () => void }>,
    lift = 0,
    fontSize = 16,
  ): void {
    whenTextureReady(KITCHEN_SLIP, () => {
      if (this.container.parent) this.relayout();
    });
    const tex = gameTexture(KITCHEN_SLIP);
    const noteW = Math.round(Math.min(maxW, Math.max(minW, wantW)));
    const ratio = isTextureReady(tex) && tex.width > 0 ? tex.height / tex.width : 457 / 720;
    const noteH = Math.round(noteW * ratio);
    const root = new PIXI.Container();
    root.position.set(x, y + noteH * lift);
    if (isTextureReady(tex)) {
      const paper = new PIXI.Sprite(tex);
      paper.width = noteW;
      paper.height = noteH;
      paper.eventMode = 'none';
      root.addChild(paper);
    } else {
      const paper = new PIXI.Graphics();
      paper.beginFill(0xF6E4B8, 0.96);
      paper.lineStyle(2, 0xC46A3A, 0.85);
      paper.drawRoundedRect(0, 0, noteW, noteH, 8);
      paper.endFill();
      paper.eventMode = 'none';
      root.addChild(paper);
    }
    const textX = noteW * 0.13;
    const textW = noteW * 0.74;
    const textTop = noteH * 0.34;
    const textH = noteH * 0.46;
    const lineH = Math.max(fontSize + 4, textH / Math.max(1, lines.length));
    let cy = textTop + (textH - lineH * lines.length) / 2;
    for (const line of lines) {
      const row = makeLabel(line.text, fontSize, line.color, { fontWeight: '700' });
      row.position.set(textX, cy + (lineH - row.height) / 2);
      row.eventMode = 'none';
      if (row.width > textW) row.scale.set(textW / row.width);
      const hit = new PIXI.Graphics();
      hit.beginFill(0xffffff, 0.001);
      hit.drawRect(textX - 4, cy, textW + 8, lineH);
      hit.endFill();
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        line.onTap();
      });
      root.addChild(row, hit);
      cy += lineH;
    }
    root.eventMode = 'static';
    root.hitArea = new PIXI.Rectangle(0, 0, noteW, noteH);
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
    const size = Math.round(Math.min(48, Math.max(40, this._fit.srcH * this._fit.scale * 0.034)));
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
    root.alpha = ready || open ? 1 : 0.78;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(size / 2, size / 2, size / 2);
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
    const size = 44;
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
    const cardW = 248;
    const cardH = 156;
    let x = pin.x + HOUSE_UPGRADE_SHIFT_X + this._pan.x - cardW / 2;
    let y = pin.y + this._pan.y - cardH - 28;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 64, y);

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

    const panel = new PIXI.Graphics();
    panel.beginFill(0x160E08, 0.28);
    panel.drawRoundedRect(0, 6, cardW, cardH, 20);
    panel.endFill();
    panel.lineStyle(3, UI_PALETTE.ink, 1);
    panel.beginFill(UI_PALETTE.walnut, 1);
    panel.drawRoundedRect(0, 0, cardW, cardH, 20);
    panel.endFill();
    drawCraftCard(panel, 6, 6, cardW - 12, cardH - 13, {
      radius: 15,
      tone: ready ? 'gold' : 'ivory',
      headerH: 42,
    });
    card.addChild(panel);

    const name = makeLabel(houseLabel(level), 22, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(18, 14);
    card.addChild(name);
    const levelText = makeLabel(
      maxed ? '✓ 已最高档' : `房屋进度：${level + 1}/${HOUSE_MAX_LEVEL + 1} 档`,
      16,
      UI_PALETTE.muted,
      { fontWeight: '600' },
    );
    levelText.position.set(18, 56);
    card.addChild(levelText);

    if (!maxed) {
      const labelText = ready ? `装修 · ${cost} 金` : state.status === 'blocked' ? state.error : `装修 · ${cost} 金`;
      const btn = makeSlicedButton({
        label: labelText,
        width: cardW - 36,
        height: 46,
        skin: ready ? 'gold' : 'cream',
        textColor: ready ? UI_PALETTE.ink : 0x8A7358,
        fontSize: 18,
        silent: !ready,
      });
      btn.position.set(18, 90);
      btn.alpha = ready ? 1 : 0.85;
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
    const cardW = 264;
    const cardH = 156;
    let x = rect.x + rect.w / 2 + this._pan.x - cardW / 2;
    let y = rect.y + this._pan.y - cardH - 58;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 64, y);

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
    const panel = new PIXI.Graphics();
    panel.beginFill(0x160E08, 0.28);
    panel.drawRoundedRect(0, 6, cardW, cardH, 20);
    panel.endFill();
    panel.lineStyle(3, UI_PALETTE.ink, 1);
    panel.beginFill(UI_PALETTE.walnut, 1);
    panel.drawRoundedRect(0, 0, cardW, cardH, 20);
    panel.endFill();
    drawCraftCard(panel, 6, 6, cardW - 12, cardH - 13, {
      radius: 15,
      tone: ready ? 'gold' : 'ivory',
      headerH: 42,
    });
    card.addChild(panel);

    const shown = lv + 1;
    const name = makeLabel(furnLabel(id, lv), 22, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(18, 14);
    card.addChild(name);
    const grade = makeLabel(`Lv.${shown}`, 16, UI_PALETTE.muted, { fontWeight: '700' });
    grade.anchor.set(1, 0);
    grade.position.set(cardW - 18, 18);
    card.addChild(grade);

    const cookNeed = furnCookNeed(id, lv);
    const capLine = (() => {
      if (state.status === 'max') return '✓ 已满级';
      const nextShown = lv + 2;
      if (id === 'fridge') {
        return `${nextShown}级容量  ${fridgeOwnCap(lv)} → ${fridgeOwnCap(lv + 1)}`;
      }
      if (id === 'foam') {
        return `容量  ${foamWetCols(lv)}×${foamWetRows(lv)} → ${foamWetCols(lv + 1)}×${foamWetRows(lv + 1)}`;
      }
      if (id === 'basket') {
        return `容量  ${bagDryCols(lv)}×${bagRows(lv)} → ${bagDryCols(lv + 1)}×${bagRows(lv + 1)}`;
      }
      if (id === 'table') {
        const unlocks = tableUnlockNext(lv);
        return unlocks > 0 ? `${nextShown}级解锁 ${unlocks} 本菜谱` : `升至 ${nextShown} 级`;
      }
      return `升至 ${nextShown} 级`;
    })();
    const level = makeLabel(capLine, 16, UI_PALETTE.muted, { fontWeight: '600' });
    level.position.set(18, 56);
    card.addChild(level);

    if (state.status !== 'max') {
      const needHouse = state.status === 'blocked' && lv >= houseFurnCap(houseLevel(save), id);
      const needCook = state.status === 'blocked' && cookLevel(save) < cookNeed;
      const btnText = needHouse
        ? `需${houseLabel(minHouseForFurn(id, lv + 1))}`
        : needCook
          ? `厨艺 ${cookNeed} 级解锁`
          : `升级 · ${state.cost} 金`;
      const btn = makeSlicedButton({
        label: btnText,
        width: cardW - 36,
        height: 46,
        skin: ready ? 'olive' : 'cream',
        textColor: ready ? 0xFFF8F0 : 0x8A7358,
        fontSize: 18,
        silent: !ready,
      });
      btn.position.set(18, 90);
      btn.alpha = ready ? 1 : 0.85;
      if (id === 'table') {
        this._upgradeConfirmRect = { x: x + 18, y: y + 90, w: cardW - 36, h: 46 };
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

  private _makePropTag(text: string, tone: 'cream' | 'warm' | 'gold', pulse = false): PIXI.Container {
    const tag = new PIXI.Container();
    tag.eventMode = 'none';
    const textColor = tone === 'cream' || tone === 'gold' ? UI_PALETTE.ink : 0xFFF8F0;
    const fillColor = tone === 'gold' ? 0xF7CD5C : tone === 'warm' ? 0xCC6B3B : 0xFFFBF3;
    const lbl = makeLabel(text, 15, textColor, { fontWeight: '700' });
    const pw = Math.ceil(lbl.width) + 24;
    const ph = 28;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x180F07, 0.24);
    bg.drawRoundedRect(-pw / 2, -ph / 2 + 2.5, pw, ph, ph / 2);
    bg.endFill();
    bg.lineStyle(2.2, UI_PALETTE.ink, 1);
    bg.beginFill(fillColor, 0.98);
    bg.drawRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    bg.endFill();
    lbl.anchor.set(0.5);
    lbl.position.set(0, 0);
    tag.addChild(bg, lbl);
    if (pulse) {
      const bob = (): void => {
        if (tag.destroyed || !tag.parent) return;
        const y0 = tag.y;
        TweenManager.to({
          target: tag,
          props: { y: y0 - 5 },
          duration: 0.55,
          ease: Ease.easeOutQuad,
          onComplete: () => {
            if (tag.destroyed || !tag.parent) return;
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

  private _drawWindowCornerHud(w: number, save: KitchenSave, redraw: () => void): void {
    const minX = this._minPanX();
    if (minX >= -24) return;

    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    const tabY = Math.round(Math.max(top + 168, Game.logicHeight * 0.34));
    const now = Date.now();
    const readyCount = pickleReadyCount(save, now);
    const catView = catStateView(save, now);
    const catGift = catView.effectiveStatus === 'gift';
    const catNew = catView.unlocked && catView.effectiveStatus === 'unadopted';
    const hasAlert = readyCount > 0 || catGift || catNew;

    // 1. Tab to glide right to Sunlit Window Bay (老坛 & 阿橘)
    const toWin = new PIXI.Container();
    const winW = 148;
    const winH = 72;
    const wBg = new PIXI.Graphics();
    wBg.beginFill(0x160E08, 0.28);
    wBg.drawRoundedRect(0, 4, winW + 16, winH, 20);
    wBg.endFill();
    wBg.lineStyle(2.8, UI_PALETTE.ink, 1);
    wBg.beginFill(hasAlert ? 0xE2AA40 : UI_PALETTE.walnut, 1);
    wBg.drawRoundedRect(0, 0, winW + 16, winH, 20);
    wBg.endFill();
    wBg.lineStyle(1.2, 0xFFFDF8, 0.9);
    wBg.beginFill(hasAlert ? 0xFFF8DF : 0xFFF9EE, 1);
    wBg.drawRoundedRect(4, 4, winW + 12, winH - 9, 16);
    wBg.endFill();
    toWin.addChild(wBg);

    const pArt = P2_ART.pickleTiers[pickleTier(save)];
    const cArt = P2_ART.catTiers[catBedTier(save)];
    const iconPath = readyCount > 0
      ? pArt.ready
      : catGift
        ? cArt.gift
        : cArt.idle;
    whenTextureReady(iconPath, redraw);
    const itex = gameTexture(iconPath);
    if (isTextureReady(itex)) {
      const sp = new PIXI.Sprite(itex);
      fitSpriteInBox(sp, 46, 46);
      sp.anchor.set(0.5);
      sp.position.set(30, winH / 2 - 1);
      sp.eventMode = 'none';
      toWin.addChild(sp);
    }

    const t1 = makeLabel('窗边角 ▶', 17, UI_PALETTE.ink, { fontWeight: '700' });
    t1.position.set(55, 11);
    const subText = readyCount > 0
      ? '老坛可开！'
      : catGift
        ? '阿橘带礼！'
        : catNew
          ? '橘猫上门！'
          : '老坛·阿橘';
    const t2 = makeLabel(subText, 14, hasAlert ? UI_PALETTE.terracotta : UI_PALETTE.muted, { fontWeight: '700' });
    t2.position.set(55, 36);
    toWin.addChild(t1, t2);

    if (hasAlert) {
      const dot = new PIXI.Graphics();
      dot.lineStyle(2, UI_PALETTE.ink, 1);
      dot.beginFill(0xE03E2D, 1);
      dot.drawCircle(8, 8, 8);
      dot.endFill();
      toWin.addChild(dot);
    }

    toWin.position.set(w - winW, tabY);
    toWin.eventMode = 'static';
    toWin.cursor = 'pointer';
    toWin.hitArea = new PIXI.Rectangle(-6, -4, winW + 10, winH + 8);
    toWin.on('pointerdown', (e) => e.stopPropagation());
    toWin.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._tweenPanTo(this._minPanX());
    });
    this._ui.addChild(toWin);
    this._toWindowTab = toWin;

    // 2. Tab to glide back left to Door & Stove when viewing Window Bay
    const toDoor = new PIXI.Container();
    const doorW = 128;
    const doorH = 64;
    const dBg = new PIXI.Graphics();
    dBg.beginFill(0x160E08, 0.26);
    dBg.drawRoundedRect(0, 4, doorW + 16, doorH, 18);
    dBg.endFill();
    dBg.lineStyle(2.8, UI_PALETTE.ink, 1);
    dBg.beginFill(UI_PALETTE.walnut, 1);
    dBg.drawRoundedRect(0, 0, doorW + 16, doorH, 18);
    dBg.endFill();
    dBg.lineStyle(1.2, 0xFFFDF8, 0.9);
    dBg.beginFill(0xFFF9EE, 1);
    dBg.drawRoundedRect(4, 4, doorW + 12, doorH - 9, 14);
    dBg.endFill();
    toDoor.addChild(dBg);

    const dt1 = makeLabel('◀ 回门口', 17, UI_PALETTE.ink, { fontWeight: '700' });
    dt1.position.set(16, 10);
    const dt2 = makeLabel('出门·主灶', 14, UI_PALETTE.muted, { fontWeight: '700' });
    dt2.position.set(18, 34);
    toDoor.addChild(dt1, dt2);

    toDoor.position.set(w - doorW, tabY);
    toDoor.eventMode = 'static';
    toDoor.cursor = 'pointer';
    toDoor.hitArea = new PIXI.Rectangle(-6, -4, doorW + 10, doorH + 8);
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
    whenTextureReady(mainArt, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
    if (hasSecond) {
      const subArt = slot1Ready ? pArt.ready : pArt.idle;
      whenTextureReady(subArt, () => {
        if (this.container.parent && !this._itemDrag) this.relayout();
      });
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
    tag.position.set(topAnchorX, topAnchorY - 18);
    root.addChild(tag);

    if (!this._gm) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      const hitW = hasSecond ? box.w * 1.45 : box.w + 12;
      const hitH = hasSecond ? box.h * 1.32 : box.h + 24;
      root.hitArea = new PIXI.Rectangle(-10, topAnchorY - 30, hitW, hitH + 16);
      root.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        if (!unlocked) {
          AudioManager.play('ui_deny');
          Platform.showToast(`厨艺升到 ${PICKLE_UNLOCK_LEVEL} 级就能开启老坛腌制坊啦！`);
          return;
        }
        this._pickle.open();
      });
    } else {
      root.eventMode = 'none';
    }
    this._world.addChild(root);
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
    whenTextureReady(artPath, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });

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
            : '阿橘';
    const isUrgent = view.effectiveStatus === 'unadopted' || view.effectiveStatus === 'gift';
    const tone = isUrgent ? 'gold' : view.effectiveStatus === 'away' ? 'warm' : 'cream';
    const tag = this._makePropTag(tagText, tone, isUrgent);
    tag.position.set(box.w / 2, visibleTopY - 18);
    root.addChild(tag);

    if (!this._gm) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(-6, visibleTopY - 30, box.w + 12, box.h - visibleTopY + 34);
      root.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._dragMoved) return;
        if (!view.unlocked) {
          AudioManager.play('ui_deny');
          Platform.showToast(`厨艺升到 ${CAT_UNLOCK_LEVEL} 级，流浪小橘猫就会闻香找上门啦！`);
          return;
        }
        this._strayCat.open();
      });
    } else {
      root.eventMode = 'none';
    }
    this._world.addChild(root);
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
