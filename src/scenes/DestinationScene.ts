import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import {
  MARKET_PLAN,
  VEHICLES,
  buffIconPath,
  cookXpView,
  dailyMarketWeather,
  explorePercent,
  getSpecialMarket,
  isMarketUnlocked,
  liveHudBuffs,
  marketExploration,
  marketExploreFoods,
  marketsForVehicle,
  neighborVehicle,
  ownsRouteToMarket,
  ownsVehicle,
  specialLootIds,
  specialMarketForVehicle,
  staminaMax,
  vehicleById,
  vehicleForMarket,
  vehicleOffer,
  type MarketDef,
  type SpecialMarketDef,
  type VehicleId,
} from '@/sim';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import {
  inspectFromItem,
  makeItemInspectCard,
  type ItemInspectView,
} from '@/gameobjects/ui/ItemInspectCard';
import {
  HUD_ICON,
  UI_PALETTE,
  bindUiClick,
  fillRect,
  fitTextWidth,
  makeAdButton,
  makeCoinButton,
  makeHandProgressBar,
  makeMuteButton,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  applyFit,
  applyGray,
  fitCover,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { MarketLootPanel } from '@/gameobjects/ui/MarketLootPanel';
import { marketBootPaths, specialBootPaths } from '@/utils/outingAssets';
import { SpecialMarketScene } from '@/scenes/SpecialMarketScene';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, type TutorialTarget } from '@/gameobjects/ui/TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';
import { tryShowInterstitial } from '@/services/InterstitialAdService';
import { destroyDisplayChildren } from '@/utils/destroy';

const DEST_BG = 'subpkg_images/dest_street_bg.jpg';
const DEST_ART = {
  sheet: 'subpkg_images/scene_pk_recipe_sheet.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  divider: 'subpkg_images/scene_pk_ink_divider.png',
  photo: 'subpkg_images/scene_dex_photo.png',
  washi: 'subpkg_images/scene_dex_washi.png',
  tab: 'subpkg_images/scene_dex_tab.png',
  spot: 'subpkg_images/scene_dex_spot.png',
} as const;

const INK = 0x2A2018;
const INK_SOFT = 0x5A4430;
const MUTED = 0x8A6E52;
const RED_INK = 0xB8361F;
const GREEN_INK = 0x3F7034;
const CREAM = 0xFFF8EC;
const TERRACOTTA = 0xC46A3A;

const CARD_H = 228;
const CARD_GAP = 14;
const DRAG_SLOP = 10;
const TAB_BAR_H = 54;
const DOCK_H = 114;
const HOME_H = 62;
const TITLE_LIFT = 74;
const BANNER_H = 166;

const DOCK_ZOOM: Record<VehicleId, number> = {
  walk: 0.94,
  bike: 1.08,
  ebike: 1.08,
  truck: 1.08,
};

export class DestinationScene implements Scene {
  readonly name = 'destinations';
  readonly container = new PIXI.Container();
  private _ui = new PIXI.Container();
  private _inspectHost = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _scroller: VerticalScroller;
  private _browse: VehicleId = 'walk';
  private _loot = new MarketLootPanel();
  private _xiangkoGo: PIXI.Container | null = null;
  private _firstWeatherTag: PIXI.Container | null = null;
  private _paintQueued = false;
  private _watched = new Set<string>();

  private _scheduleRelayout = (): void => {
    if (!this.container.parent || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this.container.parent) this.relayout();
    });
  };

  private _watchOnce(path: string): void {
    if (!path || isTextureReady(gameTexture(path)) || this._watched.has(path)) return;
    this._watched.add(path);
    whenTextureReady(path, () => {
      this._watched.delete(path);
      this._scheduleRelayout();
    });
  }

  constructor() {
    this.container.eventMode = 'static';
    this.container.addChild(this._ui);
    this._inspectHost.zIndex = 27;
    this._inspectHost.visible = false;
    this._scroller = new VerticalScroller(this.container, {
      slop: DRAG_SLOP,
      visible: () => !!this.container.parent && !this._loot._isOpen && !this._inspect,
    });
  }

  onEnter(): void {
    this._browse = KitchenManager.save.vehicle;
    this._inspect = null;
    this._paintQueued = false;
    this._inspectHost.visible = false;
    OverlayManager.container.addChild(this._inspectHost);
    this._scroller.enable();
    EventBus.on(EV.kitchenChanged, this._onKitchen);
    AudioManager.playBgm('outing');
    TutorialOverlay.register('dest', () => this.tutorialRect());
    TutorialOverlay.registerContextual('dest_ctx', () => this._contextualTip());
    TutorialManager.advanceIf(TutorialStep.GO_OUT);
    this.relayout();
  }

  onExit(): void {
    EventBus.off(EV.kitchenChanged, this._onKitchen);
    this._paintQueued = false;
    this._scroller.clear();
    this._scroller.disable();
    this._loot.close(true);
    this._xiangkoGo = null;
    this._firstWeatherTag = null;
    this._inspect = null;
    this._inspectHost.visible = false;
    destroyDisplayChildren(this._inspectHost);
    destroyDisplayChildren(this._ui);
    if (this._inspectHost.parent) this._inspectHost.parent.removeChild(this._inspectHost);
    TutorialOverlay.unregister('dest');
    TutorialOverlay.unregisterContextual('dest_ctx');
  }

  private _contextualTip(): TutorialTarget | null {
    if (TutorialManager.isActive || this._loot._isOpen || this._inspect) return null;
    if (KitchenManager.hasSeenGuide('guide_weather')) return null;
    const hole = stageRectOf(this._firstWeatherTag, 6);
    if (!hole) return null;
    return {
      dim: false,
      holes: [hole],
      fingerAt: { x: hole.x + hole.w * 0.5, y: hole.y + hole.h * 0.5 },
      speech: 'bottom',
      title: '今日菜场天时签',
      body: '每天各菜场都有不同「天时签」（首摊免单、多塞好菜或加步数），看准天时出发更划算！（点气泡可收起）',
      onDismiss: () => KitchenManager.markGuideSeen('guide_weather'),
    };
  }

  private _onKitchen = (): void => {
    this._scheduleRelayout();
  };

  tutorialRect(): { x: number; y: number; w: number; h: number; r?: number } | null {
    if (!TutorialManager.isStep(TutorialStep.PICK_XIANGKO)) return null;
    return stageRectOf(this._xiangkoGo, 8);
  }

  relayout(): void {
    this._xiangkoGo = null;
    this._firstWeatherTag = null;
    this._scroller.clear();
    destroyDisplayChildren(this._ui);
    destroyDisplayChildren(this._inspectHost);
    this._inspectHost.visible = false;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const onReady = this._scheduleRelayout;

    const watchList: string[] = [
      DEST_BG,
      HUD_ICON.destBanner,
      HUD_ICON.player,
      HUD_ICON.coin,
      HUD_ICON.stamina,
      HUD_ICON.clock,
      HUD_ICON.peek,
      HUD_ICON.home,
      ...Object.values(DEST_ART),
      ...uiBarPaths(),
    ];
    for (const p of watchList) this._watchOnce(p);

    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x261B12);
    this._ui.addChild(fallback);
    const bgTex = gameTexture(DEST_BG);
    if (isTextureReady(bgTex)) {
      const scene = new PIXI.Sprite(bgTex);
      applyFit(scene, fitCover(bgTex.width, bgTex.height, w, h));
      this._ui.addChild(scene);
    }
    const veil = new PIXI.Graphics();
    fillRect(veil, 0, 0, w, h, 0x1A120B);
    veil.alpha = 0.22;
    this._ui.addChild(veil);

    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    const titleTop = Math.max(-24, top - TITLE_LIFT);
    this._drawTitle(w, titleTop);

    // ── 顶部厨艺与资源条 ────────────────────────────────────────────────────
    const hudY = titleTop + BANNER_H + 4;
    this._drawTopHud(w, hudY, onReady);

    const buffs = liveHudBuffs(KitchenManager.save);
    const hudBottom = hudY + 84 + (buffs.length ? 46 : 0);

    // ── 交通工具手绘路牌切页签 ──────────────────────────────────────────────
    const tabsY = hudBottom + 6;
    this._ui.addChild(this._vehicleTabStrip(20, tabsY, w - 40, TAB_BAR_H));

    // ── 中部集市路线宣纸画片列表 ────────────────────────────────────────────
    const listTop = tabsY + TAB_BAR_H + 8;
    const bottomPad = Math.max(24, (Number.isFinite(Game.safeBottom) ? Game.safeBottom : 0) + 18);
    const homeY = h - HOME_H - bottomPad;
    const dockY = homeY - 12 - DOCK_H;
    const listH = Math.max(220, dockY - 10 - listTop);

    const offer = vehicleOffer(KitchenManager.save, this._browse);
    const spots = offer === 'locked' ? [] : marketsForVehicle(this._browse);
    const specialId = ownsVehicle(KitchenManager.save, this._browse)
      ? specialMarketForVehicle(this._browse)
      : null;
    const special = specialId ? getSpecialMarket(specialId) : null;
    const cardCount = spots.length + (special ? 1 : 0);
    const cardStep = CARD_H + CARD_GAP;
    const contentH = cardCount > 0 ? cardCount * CARD_H + Math.max(0, cardCount - 1) * CARD_GAP + 8 : listH;

    const list = new PIXI.Container();
    spots.forEach((market, i) => {
      list.addChild(this._card(market, 20, i * cardStep, w - 40, CARD_H, onReady));
    });
    if (special) {
      list.addChild(this._specialCard(special, 20, spots.length * cardStep, w - 40, CARD_H, onReady));
    }
    if (!cardCount) {
      const emptySlip = new PIXI.Container();
      const sw = w - 80;
      const sh = 150;
      const sx = 40;
      const sy = Math.max(16, Math.round((listH - sh) / 2));
      this._drawSheetBg(emptySlip, sx, sy, sw, sh);
      const prevRide = vehicleById(neighborVehicle(this._browse, -1));
      const msg = offer === 'locked'
        ? `先添置「${prevRide.name}」，才能打通这趟远路`
        : '更远的市集还在探路中';
      const empty = makeText('heading', msg, INK, { size: 26 });
      empty.anchor.set(0.5);
      fitTextWidth(empty, sw - 56);
      empty.position.set(w / 2, sy + sh / 2);
      emptySlip.addChild(empty);
      list.addChild(emptySlip);
    }
    this._ui.addChild(list);

    if (contentH > listH) {
      const mask = new PIXI.Graphics();
      fillRect(mask, 0, listTop, w, listH, 0xffffff);
      mask.eventMode = 'none';
      this._ui.addChild(mask);
      list.mask = mask;
    }
    this._scroller.attach({
      content: list,
      maxScroll: Math.max(0, contentH - listH),
      baseY: listTop,
      hit: { x: 0, y: listTop, w, h: listH },
    });

    // ── 底部座驾展示台 + 回家大木钮 ─────────────────────────────────────────
    this._ui.addChild(this._vehicleDock(20, dockY, w - 40, DOCK_H, onReady));
    this._ui.addChild(this._homeBtn((w - 296) / 2, homeY, 296, HOME_H, onReady));

    if (this._inspect) {
      this._inspectHost.visible = true;
      OverlayManager.bringToFront();
      this._inspectHost.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onReady,
        onClose: () => {
          AudioManager.play('ui_close');
          this._inspect = null;
          this._inspectHost.visible = false;
          destroyDisplayChildren(this._inspectHost);
        },
      }));
    }

    TutorialOverlay.refresh();
  }

  private _drawTitle(w: number, top: number): void {
    const bannerW = 432;
    const bannerH = BANNER_H;
    const wrap = new PIXI.Container();
    wrap.position.set((w - bannerW) / 2, top);
    const path = HUD_ICON.destBanner;
    this._watchOnce(path);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, bannerW, bannerH);
      sp.anchor.set(0.5);
      sp.position.set(bannerW / 2, bannerH / 2);
      wrap.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(3, INK, 1);
      g.beginFill(0xFAF0DA);
      g.drawRoundedRect(32, 44, bannerW - 64, 96, 16);
      g.endFill();
      wrap.addChild(g);
    }
    const title = makeText('display', '今天去哪儿赶集', 0x4A2A12, {
      size: 36,
      stroke: 0xFFF5D8,
      strokeWidth: 4,
    });
    title.anchor.set(0.5);
    fitTextWidth(title, bannerW - 130);
    title.position.set(bannerW / 2, bannerH * 0.59);
    wrap.addChild(title);
    this._ui.addChild(wrap);
  }

  private _drawTopHud(w: number, y: number, onReady: () => void): void {
    const save = KitchenManager.save;
    const skill = cookXpView(save);

    const avatarR = 40;
    const cx = 14 + avatarR;
    const cy = y + avatarR + 2;
    const wingX = cx + 14;
    const wingW = 192;
    const wingH = 74;
    const wingY = cy - wingH / 2;

    const wing = new PIXI.Graphics();
    wing.beginFill(0x160E08, 0.28);
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
    this._ui.addChild(wing);

    const contentLeft = cx + avatarR + 10;
    const barW = wingX + wingW - 14 - contentLeft;
    const lvTxt = makeText('heading', `厨艺 ${skill.level}级`, INK, { size: 23 });
    lvTxt.anchor.set(0, 0.5);
    lvTxt.position.set(contentLeft, wingY + 22);
    fitTextWidth(lvTxt, barW);
    this._ui.addChild(lvTxt);

    const bar = makeHandProgressBar({
      width: barW,
      height: 22,
      ratio: Math.max(0.06, skill.fill),
      onReady,
    });
    bar.node.position.set(contentLeft, wingY + 42);
    this._ui.addChild(bar.node);

    const xpTxt = makeText('caption', skill.text, INK, {
      size: 20,
      fontWeight: '700',
      stroke: 0xFFFDF8,
      strokeWidth: 4,
    });
    xpTxt.anchor.set(0.5);
    fitTextWidth(xpTxt, barW - 8);
    xpTxt.position.set(contentLeft + barW / 2, wingY + 53);
    this._ui.addChild(xpTxt);

    const ring = new PIXI.Graphics();
    ring.beginFill(0x160E08, 0.3);
    ring.drawCircle(cx, cy + 3.5, avatarR + 1);
    ring.endFill();
    ring.lineStyle(3, INK, 1);
    ring.beginFill(UI_PALETTE.brass, 1);
    ring.drawCircle(cx, cy, avatarR);
    ring.endFill();
    ring.lineStyle(1.5, 0x6E441E, 0.9);
    ring.beginFill(0xF8EEDC, 1);
    ring.drawCircle(cx, cy, avatarR - 4.5);
    ring.endFill();
    this._ui.addChild(ring);

    const pTex = gameTexture(HUD_ICON.player);
    if (isTextureReady(pTex)) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawCircle(cx, cy, avatarR - 5.5);
      mask.endFill();
      const spr = new PIXI.Sprite(pTex);
      const side = (avatarR - 5.5) * 2;
      fitSpriteInBox(spr, side * 1.16, side * 1.16);
      spr.anchor.set(0.5);
      spr.position.set(cx, cy);
      spr.mask = mask;
      spr.eventMode = 'none';
      this._ui.addChild(mask, spr);
    }

    const resX = 270;
    const slipY = cy - 24;
    const coinSlip = this._makeHudSlip({
      icon: HUD_ICON.coin,
      text: `${save.money}`,
      width: 174,
    });
    coinSlip.position.set(resX, slipY);
    this._ui.addChild(coinSlip);

    const staMax = staminaMax(save);
    const staShort = save.stamina < staMax;
    const staSlip = this._makeHudSlip({
      icon: HUD_ICON.stamina,
      text: `${save.stamina}/${staMax}`,
      width: 202,
      ratio: save.stamina / Math.max(1, staMax),
      plus: staShort,
      pulsePlus: save.stamina <= 0,
      onTap: staShort
        ? () => {
          if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.HINT_DOOR)) return;
          void KitchenManager.offerShareStamina();
        }
        : undefined,
    });
    staSlip.position.set(resX + 182, slipY);
    this._ui.addChild(staSlip);

    const mute = makeMuteButton(48);
    mute.position.set(w - 64, slipY);
    this._ui.addChild(mute);

    const buffs = liveHudBuffs(save);
    if (buffs.length) {
      const buffRow = new PIXI.Container();
      const bSize = 40;
      buffs.forEach((buff, i) => {
        const path = buffIconPath(buff.icon);
        this._watchOnce(path);
        const cell = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.lineStyle(2.2, INK, 0.95);
        bg.beginFill(0xFFF6E2, 0.98);
        bg.drawCircle(bSize / 2, bSize / 2, bSize / 2 - 1);
        bg.endFill();
        cell.addChild(bg);
        const bTex = gameTexture(path);
        if (isTextureReady(bTex)) {
          const sp = new PIXI.Sprite(bTex);
          fitSpriteInBox(sp, bSize - 8, bSize - 8);
          sp.anchor.set(0.5);
          sp.position.set(bSize / 2, bSize / 2);
          cell.addChild(sp);
        }
        cell.position.set(i * (bSize + 8), 0);
        cell.eventMode = 'static';
        cell.cursor = 'pointer';
        cell.hitArea = new PIXI.Rectangle(0, 0, bSize, bSize);
        cell.on('pointertap', (e) => {
          e.stopPropagation();
          AudioManager.play('ui_click');
          ensureHudBuffPanel().open();
        });
        buffRow.addChild(cell);
      });
      buffRow.position.set(resX + 18, slipY + 54);
      this._ui.addChild(buffRow);
    }
  }

  private _makeHudSlip(opts: {
    icon: string;
    text: string;
    width: number;
    ratio?: number;
    plus?: boolean;
    pulsePlus?: boolean;
    onTap?: () => void;
  }): PIXI.Container {
    const root = new PIXI.Container();
    const h = 48;
    const barX = 20;
    const barW = opts.width - barX;

    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.26);
    bg.drawRoundedRect(barX, 4, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2.5, INK, 1);
    bg.beginFill(0xFAF0DA, 0.98);
    bg.drawRoundedRect(barX, 0, barW, h, 10);
    bg.endFill();
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
    const availW = barW - (opts.plus ? 56 : 30);
    fitTextWidth(num, availW);
    num.position.set(barX + 18 + availW / 2, h / 2 - 0.5);
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
      pg.lineStyle(2.4, INK, 1);
      pg.beginFill(opts.pulsePlus ? 0xD9412E : 0xC46234, 1);
      pg.drawCircle(0, 0, 15);
      pg.endFill();
      pg.lineStyle(0);
      pg.beginFill(CREAM, 1);
      pg.drawRoundedRect(-7, -2, 14, 4, 2);
      pg.drawRoundedRect(-2, -7, 4, 14, 2);
      pg.endFill();
      plusWrap.addChild(pg);
      root.addChild(plusWrap);
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

  private _vehicleTabStrip(x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(x, y);
    const gap = 10;
    const tabW = Math.floor((width - gap * (VEHICLES.length - 1)) / VEHICLES.length);
    this._watchOnce(DEST_ART.tab);
    const tabTex = gameTexture(DEST_ART.tab);

    VEHICLES.forEach((v, idx) => {
      const active = this._browse === v.id;
      const offer = vehicleOffer(KitchenManager.save, v.id);
      const cell = new PIXI.Container();
      cell.position.set(idx * (tabW + gap), active ? 0 : 4);
      const ch = active ? height : height - 4;

      if (isTextureReady(tabTex)) {
        const sp = new PIXI.Sprite(tabTex);
        sp.width = tabW;
        sp.height = ch;
        if (!active) sp.tint = offer === 'owned' ? 0xE5D4B8 : 0xC9B8A0;
        cell.addChild(sp);
      } else {
        const g = new PIXI.Graphics();
        g.lineStyle(2.5, INK, 1);
        g.beginFill(active ? 0xFFF7E2 : offer === 'owned' ? 0xE6D5B8 : 0xCEC0AA, 1);
        g.drawRoundedRect(0, 0, tabW, ch, 12);
        g.endFill();
        cell.addChild(g);
      }

      if (active) {
        const bar = new PIXI.Graphics();
        bar.beginFill(RED_INK, 0.9);
        bar.drawRoundedRect(18, ch - 7, tabW - 36, 4, 2);
        bar.endFill();
        cell.addChild(bar);
      }

      const txtCol = active ? INK : offer === 'owned' ? INK_SOFT : MUTED;
      const lbl = makeText('heading', v.name, txtCol, { size: 24 });
      lbl.anchor.set(0.5);
      fitTextWidth(lbl, tabW - 20);
      lbl.position.set(tabW / 2, ch / 2 - (active ? 2 : 0));
      cell.addChild(lbl);

      if (offer === 'buyable') {
        const dot = new PIXI.Graphics();
        dot.lineStyle(2, INK, 1);
        dot.beginFill(0xE8A832, 1);
        dot.drawCircle(tabW - 12, 10, 7);
        dot.endFill();
        cell.addChild(dot);
      }

      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(0, 0, tabW, height);
      cell.on('pointerdown', (e) => e.stopPropagation());
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        if (TutorialGuard.block('switchVehicle')) return;
        AudioManager.play('ui_click');
        this._browse = v.id;
        if (ownsVehicle(KitchenManager.save, v.id)) {
          KitchenManager.setVehicle(v.id);
        }
        this._scroller.reset();
        this.relayout();
      });
      root.addChild(cell);
    });
    return root;
  }

  private _drawSheetBg(parent: PIXI.Container, x: number, y: number, w: number, h: number, goldTint = false): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x120A05, 0.34);
    shadow.drawRoundedRect(x + 4, y + 7, w - 4, h - 2, 14);
    shadow.endFill();
    parent.addChild(shadow);

    const tex = gameTexture(DEST_ART.sheet);
    if (isTextureReady(tex)) {
      const k = w / tex.width;
      const plane = new PIXI.NineSlicePlane(tex, 0, 120, 0, 110);
      plane.width = tex.width;
      plane.height = h / k;
      plane.scale.set(k);
      plane.position.set(x, y);
      if (goldTint) plane.tint = 0xFFEFCA;
      parent.addChild(plane);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.6, INK, 1);
      g.beginFill(goldTint ? 0xFFF2CF : 0xF8ECD2, 1);
      g.drawRoundedRect(x, y, w, h, 14);
      g.endFill();
      parent.addChild(g);
    }
  }

  private _drawPostcardThumb(
    parent: PIXI.Container,
    thumbPath: string,
    x: number,
    y: number,
    w: number,
    h: number,
    dimmed: boolean,
    badgeCopy: string | null,
  ): void {
    const card = new PIXI.Container();
    card.position.set(x + w / 2, y + h / 2);
    card.rotation = -0.022;

    const frameG = new PIXI.Graphics();
    frameG.beginFill(0x180F07, 0.22);
    frameG.drawRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 10);
    frameG.endFill();
    frameG.lineStyle(2.2, 0x4A3420, 1);
    frameG.beginFill(0xFFFBF2, 1);
    frameG.drawRoundedRect(-w / 2, -h / 2, w, h, 8);
    frameG.endFill();
    card.addChild(frameG);

    const pad = 9;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2 - 4;
    const innerX = -w / 2 + pad;
    const innerY = -h / 2 + pad;

    const innerBg = new PIXI.Graphics();
    innerBg.beginFill(0x2E2218, 1);
    innerBg.drawRoundedRect(innerX, innerY, innerW, innerH, 5);
    innerBg.endFill();
    card.addChild(innerBg);

    if (thumbPath) {
      this._watchOnce(thumbPath);
      const tex = gameTexture(thumbPath);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        const fit = fitCover(tex.width, tex.height, innerW, innerH);
        applyFit(sp, fit);
        sp.position.set(innerX + fit.x, innerY + fit.y);
        if (dimmed) sp.alpha = 0.42;
        const mask = new PIXI.Graphics();
        fillRect(mask, innerX, innerY, innerW, innerH, 0xffffff, 5);
        sp.mask = mask;
        card.addChild(mask, sp);
      }
    }

    const washiTex = gameTexture(DEST_ART.washi);
    if (isTextureReady(washiTex)) {
      const ws = new PIXI.Sprite(washiTex);
      ws.width = 76;
      ws.height = 16;
      ws.anchor.set(0.5);
      ws.position.set(0, -h / 2 + 2);
      card.addChild(ws);
    }

    if (dimmed) {
      const seal = this._makeSeal('未开', 54);
      seal.position.set(0, 0);
      card.addChild(seal);
    } else if (badgeCopy) {
      const clockTex = gameTexture(HUD_ICON.clock);
      const stepRow = new PIXI.Container();
      let sx = 0;
      if (isTextureReady(clockTex)) {
        const cs = new PIXI.Sprite(clockTex);
        fitSpriteInBox(cs, 24, 24);
        cs.anchor.set(0, 0.5);
        stepRow.addChild(cs);
        sx = 26;
      }
      const st = makeText('caption', badgeCopy, 0xFFF8EC, {
        size: 20,
        fontWeight: '700',
        stroke: 0x24150B,
        strokeWidth: 5,
      });
      st.anchor.set(0, 0.5);
      st.position.set(sx, 0);
      stepRow.addChild(st);
      stepRow.position.set(innerX + 8, innerY + innerH - 16);
      card.addChild(stepRow);
    }

    card.eventMode = 'none';
    parent.addChild(card);
  }

  private _makeSeal(text: string, size = 48): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const tex = gameTexture(DEST_ART.seal);
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
    root.rotation = -0.1;
    return root;
  }

  private _drawSpecialtyPreview(
    parent: PIXI.Container,
    foodIds: string[],
    x: number,
    y: number,
    unlocked: boolean,
  ): void {
    const row = new PIXI.Container();
    row.position.set(x, y);
    const lead = makeText('caption', '风物', MUTED, { size: 20, fontWeight: '700' });
    lead.anchor.set(0, 0.5);
    lead.position.set(0, 22);
    row.addChild(lead);

    const spotTex = gameTexture(DEST_ART.spot);
    let ix = lead.width + 12;
    for (const id of foodIds.slice(0, 4)) {
      const p = resolveItemAssetPath(id);
      this._watchOnce(p);
      const cell = new PIXI.Container();
      cell.position.set(ix, 0);

      if (isTextureReady(spotTex)) {
        const bg = new PIXI.Sprite(spotTex);
        fitSpriteInBox(bg, 44, 44);
        bg.anchor.set(0.5);
        bg.position.set(22, 22);
        bg.alpha = 0.35;
        cell.addChild(bg);
      } else {
        const bg = new PIXI.Graphics();
        bg.beginFill(0xEAD8BA, 0.65);
        bg.drawCircle(22, 22, 20);
        bg.endFill();
        cell.addChild(bg);
      }

      const fTex = itemTexture(id);
      if (isTextureReady(fTex)) {
        const sp = new PIXI.Sprite(fTex);
        fitSpriteInBox(sp, 40, 40);
        sp.anchor.set(0.5);
        sp.position.set(22, 22);
        if (!unlocked) {
          sp.tint = 0x5A4634;
          sp.alpha = 0.55;
        }
        cell.addChild(sp);
      }

      if (unlocked && (!TutorialManager.isActive || TutorialManager.isStep(TutorialStep.HINT_DOOR))) {
        cell.eventMode = 'static';
        cell.cursor = 'pointer';
        cell.hitArea = new PIXI.Rectangle(-2, -2, 48, 48);
        cell.on('pointertap', (e) => {
          e.stopPropagation();
          if (this._scroller.moved) return;
          AudioManager.play('ui_click');
          this._inspect = inspectFromItem(id);
          this.relayout();
        });
      }
      row.addChild(cell);
      ix += 50;
    }
    parent.addChild(row);
  }

  private _card(
    market: MarketDef,
    x: number,
    y: number,
    width: number,
    height: number,
    onReady: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const save = KitchenManager.save;
    const routed = ownsRouteToMarket(save, market.id);
    const unlocked = routed && isMarketUnlocked(market.id, save.level);
    const needRide = vehicleForMarket(market.id);

    this._drawSheetBg(root, x, y, width, height, false);
    if (!unlocked) root.alpha = 0.92;

    const thumbX = x + 26;
    const thumbY = y + 18;
    const thumbW = 190;
    const thumbH = height - 36;
    const steps = MARKET_PLAN[market.id]?.steps ?? 12;
    this._drawPostcardThumb(root, market.thumb, thumbX, thumbY, thumbW, thumbH, !unlocked, `${steps}步`);

    const textX = thumbX + thumbW + 20;
    // Inset right edge past top-right brass tack on scene_pk_recipe_sheet.png
    const rightEdge = x + width - 86;
    const bodyRight = x + width - 26;
    const availW = bodyRight - textX;

    const name = makeText('title', market.name, INK, { size: 32 });
    name.position.set(textX, y + 18);
    root.addChild(name);

    if (unlocked && !TutorialManager.isActive) {
      const weather = dailyMarketWeather(market.id);
      const shortTag = weather.shortDesc.split('·')[0].trim();
      const weatherChip = this._makeWeatherHangTag(`${weather.name}·${shortTag}`, weather.pillFill, weather.pillInk);
      weatherChip.position.set(rightEdge, y + 36);
      root.addChild(weatherChip);
      fitTextWidth(name, Math.max(120, rightEdge - textX - weatherChip.width - 12));
      if (!this._firstWeatherTag) this._firstWeatherTag = weatherChip;
    } else {
      fitTextWidth(name, rightEdge - textX);
    }

    const hint = makeText('body', market.hint, INK_SOFT, { size: 21 });
    hint.position.set(textX, y + 60);
    fitTextWidth(hint, availW);
    root.addChild(hint);

    const dTex = gameTexture(DEST_ART.divider);
    if (isTextureReady(dTex)) {
      const div = new PIXI.Sprite(dTex);
      div.width = availW;
      div.height = 8;
      div.alpha = 0.35;
      div.position.set(textX, y + 92);
      div.eventMode = 'none';
      root.addChild(div);
    }

    const foods = marketExploreFoods(market.id);
    this._drawSpecialtyPreview(root, foods, textX, y + 102, unlocked);

    const btnH = 56;
    const btnY = y + height - btnH - 16;
    if (unlocked) {
      const goW = 186;
      const goX = bodyRight - goW;
      const go = this._departBtn(
        goX,
        btnY,
        goW,
        btnH,
        market.staminaCost,
        save.stamina < market.staminaCost,
        () => this._depart(market),
        onReady,
      );
      root.addChild(go);
      if (market.id === 'xiangko') this._xiangkoGo = go;
      root.addChild(this._exploreMeter(textX, btnY + 4, goX - textX - 16, btnH - 8, market.id, onReady));
    } else {
      const label = routed ? `厨艺 ${market.unlockLevel} 级开集` : `需添置${needRide.name}`;
      const need = makeSlicedButton({
        label,
        width: 224,
        height: btnH,
        skin: 'cream',
        textColor: 0x7A6248,
        fontSize: 23,
        silent: true,
        onReady,
      });
      need.eventMode = 'none';
      need.position.set(bodyRight - 224, btnY);
      root.addChild(need);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(x, y, width, height);
      root.on('pointertap', () => {
        if (this._scroller.moved) return;
        AudioManager.play('ui_deny');
        Platform.showToast(
          routed
            ? `${market.name} · 厨艺 ${market.unlockLevel} 级解锁`
            : `${market.name} · 添置${needRide.name}后即可前往`,
        );
      });
    }
    return root;
  }

  private _makeWeatherHangTag(text: string, fill: number, ink: number): PIXI.Container {
    const wrap = new PIXI.Container();
    const lbl = makeText('caption', text, ink, { size: 20, fontWeight: '700' });
    const w = Math.ceil(lbl.width) + 26;
    const h = 34;
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, ink, 0.9);
    bg.beginFill(fill, 0.98);
    bg.drawRoundedRect(-w, -h / 2, w, h, 8);
    bg.endFill();
    bg.lineStyle(1.2, INK, 0.85);
    bg.beginFill(0xE8BE66, 1);
    bg.drawCircle(-w + 9, 0, 3);
    bg.endFill();
    lbl.anchor.set(0.5);
    lbl.position.set(-w / 2 + 4, 0);
    wrap.addChild(bg, lbl);
    wrap.rotation = 0.02;
    return wrap;
  }

  private _makeSpecialPlayTag(id: SpecialMarketDef['id']): { node: PIXI.Container; width: number } {
    const META: Record<SpecialMarketDef['id'], { label: string; fill: number; stroke: number; ink: number; dot: number }> = {
      spice_night: { label: '闻香揭罐', fill: 0xFFF0D4, stroke: 0xA84B20, ink: 0x8C3814, dot: 0xE07028 },
      riverside_fish: { label: '夜泊看漂', fill: 0xE6F4F1, stroke: 0x2E6E74, ink: 0x1D5258, dot: 0x3A959E },
      oldtown_dry: { label: '颠匾收货', fill: 0xFFF3CF, stroke: 0xA06A18, ink: 0x7A4B0C, dot: 0xE29B24 },
      field_night: { label: '提灯夜摘', fill: 0xEAF5DF, stroke: 0x3F7230, ink: 0x2B571E, dot: 0x62A844 },
    };
    const style = META[id];
    const node = new PIXI.Container();
    node.eventMode = 'none';
    const lbl = makeText('caption', style.label, style.ink, { size: 18, fontWeight: '700' });
    const w = Math.ceil(lbl.width) + 28;
    const h = 30;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x24150B, 0.12);
    bg.drawRoundedRect(1, -h / 2 + 2, w, h, h / 2);
    bg.endFill();
    bg.lineStyle(1.8, style.stroke, 0.92);
    bg.beginFill(style.fill, 0.98);
    bg.drawRoundedRect(0, -h / 2, w, h, h / 2);
    bg.endFill();
    bg.lineStyle(1, style.stroke, 0.7);
    bg.beginFill(style.dot, 1);
    bg.drawCircle(11, 0, 3.4);
    bg.endFill();
    lbl.anchor.set(0, 0.5);
    lbl.position.set(19, -0.5);
    node.addChild(bg, lbl);
    return { node, width: w };
  }

  private _specialCard(
    market: SpecialMarketDef,
    x: number,
    y: number,
    width: number,
    height: number,
    onReady: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const used = KitchenManager.specialVisitCount(market.id);
    const left = used < market.dailyLimit;

    this._drawSheetBg(root, x, y, width, height, left);

    const thumbX = x + 26;
    const thumbY = y + 18;
    const thumbW = 190;
    const thumbH = height - 36;
    this._drawPostcardThumb(root, market.thumb, thumbX, thumbY, thumbW, thumbH, !left, `免体力·${market.rounds}手`);

    const textX = thumbX + thumbW + 20;
    const rightEdge = x + width - 86;
    const bodyRight = x + width - 26;
    const availW = bodyRight - textX;

    const seal = this._makeSeal('奇遇', 44);
    seal.position.set(rightEdge - 20, y + 35);
    root.addChild(seal);

    const playTag = this._makeSpecialPlayTag(market.id);
    const name = makeText('title', market.name, INK, { size: 31 });
    name.position.set(textX, y + 17);
    const maxNameW = Math.max(116, (rightEdge - 44) - textX - playTag.width - 16);
    fitTextWidth(name, maxNameW);
    root.addChild(name);

    playTag.node.position.set(textX + name.width + 10, y + 35);
    root.addChild(playTag.node);

    const hint = makeText('body', market.hint, INK_SOFT, { size: 21 });
    hint.position.set(textX, y + 59);
    fitTextWidth(hint, availW);
    root.addChild(hint);

    const dTex = gameTexture(DEST_ART.divider);
    if (isTextureReady(dTex)) {
      const div = new PIXI.Sprite(dTex);
      div.width = availW;
      div.height = 8;
      div.alpha = 0.35;
      div.position.set(textX, y + 90);
      div.eventMode = 'none';
      root.addChild(div);
    }

    this._drawSpecialtyPreview(root, specialLootIds(market), textX, y + 99, true);

    const btnH = 58;
    const btnY = y + height - btnH - 15;
    const goW = 208;
    const goX = bodyRight - goW;

    const remain = Math.max(0, market.dailyLimit - used);
    const dailyTxt = makeText(
      'body',
      remain > 0 ? `今日可逛 ${remain}/${market.dailyLimit}` : `今日已逛 ${used}/${market.dailyLimit}`,
      remain > 0 ? GREEN_INK : RED_INK,
      { size: 21, fontWeight: '700' },
    );
    dailyTxt.anchor.set(0, 0.5);
    const peekSize = 40;
    const leftClusterMaxW = goX - textX - 16;
    fitTextWidth(dailyTxt, Math.max(96, leftClusterMaxW - peekSize - 10));
    dailyTxt.position.set(textX, btnY + btnH / 2);
    root.addChild(dailyTxt);

    const peekWrap = new PIXI.Container();
    const peekBg = new PIXI.Graphics();
    peekBg.beginFill(0x24150B, 0.14);
    peekBg.drawCircle(peekSize / 2, peekSize / 2 + 2, peekSize / 2 - 1);
    peekBg.endFill();
    peekBg.lineStyle(1.8, 0x8A6236, 0.9);
    peekBg.beginFill(0xFFF7E4, 0.96);
    peekBg.drawCircle(peekSize / 2, peekSize / 2, peekSize / 2 - 1);
    peekBg.endFill();
    peekWrap.addChild(peekBg);
    const peek = this._peekBtn(peekSize - 8);
    peek.position.set(4, 4);
    peek.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._scroller.moved) return;
      this._loot.openSpecial(market.id);
    });
    peekWrap.addChild(peek);
    peekWrap.position.set(textX + dailyTxt.width + 10, btnY + (btnH - peekSize) / 2);
    root.addChild(peekWrap);

    if (left) {
      const btnGlow = new PIXI.Graphics();
      btnGlow.beginFill(0xF5B82E, 0.22);
      btnGlow.drawRoundedRect(goX - 3, btnY - 2, goW + 6, btnH + 5, 16);
      btnGlow.endFill();
      btnGlow.eventMode = 'none';
      root.addChild(btnGlow);
    }

    const go = makeAdButton({
      label: left ? '免费寻鲜' : '明日再来',
      width: goW,
      height: btnH,
      skin: 'gold',
      textColor: 0x3B1F08,
      disabled: !left,
      onReady,
    });
    go.position.set(goX, btnY);
    go.on('pointertap', () => {
      if (this._scroller.moved) return;
      this._enterSpecial(market);
    });
    root.addChild(go);

    return root;
  }

  private _departBtn(
    x: number,
    y: number,
    width: number,
    height: number,
    cost: number,
    short: boolean,
    onTap: () => void,
    onReady: () => void,
  ): PIXI.Container {
    const btn = makeSlicedButton({
      label: '',
      width,
      height,
      skin: short ? 'terracotta' : 'olive',
      onReady,
    });
    btn.position.set(x, y);
    btn.on('pointertap', () => {
      if (this._scroller.moved) return;
      onTap();
    });

    const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
    const word = makeText('heading', '出发', 0xFFF8F0, {
      size: 26,
      stroke: short ? INK : 0x1F3D1B,
      strokeWidth: 4,
    });
    word.anchor.set(0, 0.5);

    const tex = gameTexture(HUD_ICON.stamina);
    const bun = isTextureReady(tex) ? new PIXI.Sprite(tex) : null;
    if (bun) {
      fitSpriteInBox(bun, 30, 30);
      bun.anchor.set(0.5);
      bun.eventMode = 'none';
    }
    const n = makeText('number', `-${cost}`, short ? 0xFFE27A : 0xFFF8F0, {
      size: 24,
      stroke: INK,
      strokeWidth: 4,
    });
    n.anchor.set(0, 0.5);

    const clusterW = word.width + 8 + (bun ? 30 : 0) + 3 + n.width;
    let cx = Math.round((width - clusterW) / 2);
    const mid = height / 2 - 1;
    word.position.set(cx, mid);
    cx += word.width + 8;
    if (bun) {
      bun.position.set(cx + 15, mid);
      cx += 32;
      face.addChild(bun);
    }
    n.position.set(cx, mid);
    face.addChild(word, n);
    return btn;
  }

  private _exploreMeter(
    x: number,
    y: number,
    width: number,
    height: number,
    marketId: MarketDef['id'],
    onReady: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const view = marketExploration(KitchenManager.save, marketId);
    const pct = explorePercent(view);
    const barW = Math.max(120, Math.min(184, width));

    const label = makeText('caption', `探索 ${pct}%`, view.complete ? GREEN_INK : INK, {
      size: 21,
      fontWeight: '700',
    });
    label.position.set(0, 0);
    root.addChild(label);

    if (view.complete) {
      const btn = this._peekBtn(38);
      btn.position.set(label.width + 8, -5);
      btn.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._scroller.moved) return;
        this._loot.open(marketId);
      });
      root.addChild(btn);
    }

    const bar = makeHandProgressBar({
      width: barW,
      height: 18,
      ratio: Math.max(0.06, view.complete ? 1 : view.ratio),
      onReady,
    });
    bar.node.position.set(0, height - 18);
    root.addChild(bar.node);

    root.position.set(x, y);
    return root;
  }

  private _peekBtn(size: number): PIXI.Container {
    const root = new PIXI.Container();
    const path = HUD_ICON.peek;
    this._watchOnce(path);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size, size);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    }
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-4, -4, size + 8, size + 8);
    bindUiClick(root);
    return root;
  }

  private _switchVehicle(dir: -1 | 1): void {
    if (TutorialGuard.block('switchVehicle')) return;
    this._browse = neighborVehicle(this._browse, dir);
    if (ownsVehicle(KitchenManager.save, this._browse)) {
      KitchenManager.setVehicle(this._browse);
    }
    this._scroller.reset();
    this.relayout();
  }

  private _vehicleDock(x: number, y: number, width: number, height: number, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const ride = vehicleById(this._browse);
    const offer = vehicleOffer(KitchenManager.save, ride.id);

    const bg = new PIXI.Graphics();
    bg.beginFill(0x140B05, 0.34);
    bg.drawRoundedRect(x + 2, y + 6, width - 4, height - 2, 16);
    bg.endFill();
    bg.lineStyle(2.6, INK, 1);
    bg.beginFill(0xFAF0DA, 0.96);
    bg.drawRoundedRect(x, y, width, height, 16);
    bg.endFill();
    bg.lineStyle(1.2, 0xC6A87E, 0.75);
    bg.drawRoundedRect(x + 64, y + 8, width - 128, height - 16, 10);
    root.addChild(bg);

    this._watchOnce(ride.art);
    const tex = gameTexture(ride.art);
    const artCx = x + 158;
    const cy = y + height / 2;
    if (isTextureReady(tex)) {
      const sprite = new PIXI.Sprite(tex);
      const zoom = DOCK_ZOOM[ride.id];
      fitSpriteInBox(sprite, 152 * zoom, (height - 12) * zoom);
      sprite.anchor.set(0.5);
      sprite.position.set(artCx, cy);
      sprite.eventMode = 'none';
      if (offer === 'buyable') applyGray(sprite);
      if (offer === 'locked') sprite.tint = 0x1A1410;
      root.addChild(sprite);
    }

    const infoX = x + 252;
    const infoMaxW = x + width - 74 - infoX;

    if (offer === 'buyable') {
      const title = makeText('heading', `${ride.name} · 待添置`, INK, { size: 24 });
      title.position.set(infoX, y + 14);
      fitTextWidth(title, infoMaxW);
      root.addChild(title);

      const canAfford = KitchenManager.save.money >= ride.cost;
      const buy = makeCoinButton({
        prefix: '添置',
        price: ride.cost,
        width: Math.min(220, infoMaxW),
        height: 50,
        skin: canAfford ? 'gold' : 'cream',
        textColor: canAfford ? INK : 0x8A7358,
        fontSize: 24,
        onReady,
      });
      buy.position.set(infoX, y + 52);
      buy.on('pointertap', (e) => {
        e.stopPropagation();
        if (!KitchenManager.buyVehicle(ride.id)) return;
        this._browse = ride.id;
        this._scroller.reset();
        this.relayout();
      });
      root.addChild(buy);
    } else {
      const badgeStr = offer === 'owned' ? '当前座驾' : '尚未开通';
      const title = makeText('heading', `${ride.name} · ${badgeStr}`, offer === 'owned' ? INK : MUTED, { size: 25 });
      title.position.set(infoX, y + 20);
      fitTextWidth(title, infoMaxW);
      root.addChild(title);

      const blurb = makeText('body', ride.blurb, INK_SOFT, { size: 22 });
      blurb.position.set(infoX, y + 60);
      fitTextWidth(blurb, infoMaxW);
      root.addChild(blurb);
    }

    root.addChild(this._arrow(x + 34, cy, -1));
    root.addChild(this._arrow(x + width - 34, cy, 1));
    return root;
  }

  private _homeBtn(x: number, y: number, width: number, height: number, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const btn = makeSlicedButton({
      label: '回小厨',
      width,
      height,
      skin: 'terracotta',
      fontSize: 28,
      labelOffsetX: 24,
      onReady,
    });
    btn.position.set(x, y);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      if (TutorialGuard.block('goHomeDest')) return;
      void tryShowInterstitial('go_home');
      SceneManager.switchTo('kitchen');
    });
    root.addChild(btn);
    this._watchOnce(HUD_ICON.home);
    const house = new PIXI.Sprite(gameTexture(HUD_ICON.home));
    if (isTextureReady(house.texture)) {
      fitSpriteInBox(house, 58, 58);
      house.anchor.set(0.5);
      house.position.set(x + 56, y + height / 2 - 2);
      house.eventMode = 'none';
      root.addChild(house);
    }
    return root;
  }

  private _arrow(cx: number, cy: number, dir: -1 | 1): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.28);
    bg.drawCircle(0, 3, 24);
    bg.endFill();
    bg.lineStyle(2.8, INK, 1);
    bg.beginFill(UI_PALETTE.brass, 1);
    bg.drawCircle(0, 0, 23);
    bg.endFill();
    bg.lineStyle(1.4, 0xFFFDF8, 0.85);
    bg.beginFill(0xFFF9EE, 1);
    bg.drawCircle(0, 0, 18.5);
    bg.endFill();
    const tri = new PIXI.Graphics();
    tri.beginFill(TERRACOTTA, 1);
    if (dir < 0) {
      tri.moveTo(5, -9);
      tri.lineTo(5, 9);
      tri.lineTo(-8, 0);
    } else {
      tri.moveTo(-5, -9);
      tri.lineTo(-5, 9);
      tri.lineTo(8, 0);
    }
    tri.closePath();
    tri.endFill();
    root.addChild(bg, tri);
    root.position.set(cx, cy);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(0, 0, 30);
    bindUiClick(root);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this._switchVehicle(dir);
    });
    return root;
  }

  private _depart(market: MarketDef): void {
    if (market.id !== 'xiangko' && TutorialGuard.block('departOther')) return;
    if (TutorialGuard.block(market.id === 'xiangko' ? 'departXiangko' : 'departOther')) return;
    if (!ownsRouteToMarket(KitchenManager.save, market.id)) {
      const ride = vehicleForMarket(market.id);
      AudioManager.play('ui_deny');
      Platform.showToast(`买了${ride.name}才能去${market.name}`);
      return;
    }
    if (!isMarketUnlocked(market.id, KitchenManager.save.level)) {
      AudioManager.play('ui_deny');
      Platform.showToast(`${market.name} · 厨艺 ${market.unlockLevel} 解锁`);
      return;
    }
    if (!KitchenManager.canGoMarket(market.staminaCost)) {
      AudioManager.play('ui_deny');
      void KitchenManager.offerShareStamina();
      return;
    }
    if (!KitchenManager.fridgeAcceptsOuting()) {
      AudioManager.play('ui_deny');
      Platform.showToast('冰箱满了，先卖掉或做菜再出门');
      return;
    }
    if (OutingCurtain.busy) return;
    if (!RunManager.start(market.id)) return;
    if (!TutorialManager.isActive) KitchenManager.markGuideSeen('guide_weather');
    TutorialManager.advanceIf(TutorialStep.PICK_XIANGKO);
    OutingCurtain.play({
      paths: marketBootPaths(market.id, RunManager.run ?? undefined),
      then: () => SceneManager.switchTo('market'),
    });
  }

  private _enterSpecial(market: SpecialMarketDef): void {
    if (TutorialGuard.block('specialMarket')) return;
    if (!ownsVehicle(KitchenManager.save, market.vehicle)) {
      const ride = vehicleById(market.vehicle);
      AudioManager.play('ui_deny');
      Platform.showToast(`买了${ride.name}才能去${market.name}`);
      return;
    }
    if (!KitchenManager.canVisitSpecial(market.id)) {
      AudioManager.play('ui_deny');
      Platform.showToast('今天次数用完了，0点重置');
      return;
    }
    if (!KitchenManager.fridgeAcceptsOuting()) {
      AudioManager.play('ui_deny');
      Platform.showToast('冰箱满了，先卖掉或做菜再出门');
      return;
    }
    if (OutingCurtain.busy) return;
    Platform.showRewardedVideo('special', () => {
      if (!KitchenManager.canVisitSpecial(market.id)) {
        Platform.showToast('今天次数用完了，0点重置');
        return;
      }
      KitchenManager.markSpecialVisit(market.id);
      SpecialMarketScene.queue(market.id);
      OutingCurtain.play({
        paths: specialBootPaths(market.id),
        then: () => SceneManager.switchTo('specialMarket'),
      });
    });
  }
}
