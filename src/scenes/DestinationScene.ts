import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import {
  cookXpView,
  staminaMax,
  isMarketUnlocked,
  marketsForVehicle,
  neighborVehicle,
  ownsRouteToMarket,
  ownsVehicle,
  specialMarketForVehicle,
  vehicleById,
  vehicleOffer,
  vehicleForMarket,
  getSpecialMarket,
  type MarketDef,
  type SpecialMarketDef,
  type VehicleId,
  explorePercent,
  marketExploration,
  liveHudBuffs,
  dailyMarketWeather,
} from '@/sim';
import { AudioManager } from '@/core/AudioManager';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import {
  HUD_ICON,
  PLAYER_LEVEL_HUD,
  UI_PALETTE,
  bindUiClick,
  drawCraftCard,
  drawRecessedWell,
  fillRect,
  hudBuffRowY,
  hudPillsY,
  makeAdButton,
  makeCraftProgressBar,
  makeHudBuffRow,
  makeLabel,
  makeMuteButton,
  makePlayerLevelHud,
  makeSlicedButton,
  makeStatPill,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { applyGray, applyFit, fitCover, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { MarketLootPanel } from '@/gameobjects/ui/MarketLootPanel';
import { marketBootPaths, specialBootPaths } from '@/utils/outingAssets';
import { SpecialMarketScene } from '@/scenes/SpecialMarketScene';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, type TutorialTarget } from '@/gameobjects/ui/TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';
import { tryShowInterstitial } from '@/services/InterstitialAdService';

const DEST_BG = 'subpkg_images/dest_street_bg.jpg';
/** 走路一屏正好四张。更高的屏卡不再拉高，多出来的空落在列表里。 */
const FIT_CARDS = 4;
const CARD_GAP = 8;
const CARD_H_MAX = 200;
const CARD_H_MIN = 156;
const DRAG_SLOP = 10;
const VEHICLE_H = 214;
const DOCK_TITLE_H = 40;
const HOME_H = 60;
const HOME_GAP = 28;
const HOME_BOTTOM = 36;
/** 招牌绳子探进顶栏，木牌本身抬到安全区附近。 */
const TITLE_LIFT = 78;
const BANNER_H = 176;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const WALNUT = 0x8B5A2B;
const TERRACOTTA = 0xC46A3A;
/** 走路鞋团得紧，车要铺满盒子，看起来才比鞋大。 */
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
  private _scroller: VerticalScroller;
  private _browse: VehicleId = 'walk';
  private _loot = new MarketLootPanel();
  private _xiangkoGo: PIXI.Container | null = null;
  private _firstWeatherTag: PIXI.Container | null = null;

  constructor() {
    this.container.eventMode = 'static';
    this.container.addChild(this._ui);
    this._scroller = new VerticalScroller(this.container, {
      slop: DRAG_SLOP,
      visible: () => !!this.container.parent && !this._loot._isOpen,
    });
  }

  onEnter(): void {
    this._browse = KitchenManager.save.vehicle;
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
    this._scroller.disable();
    this._loot.close(true);
    TutorialOverlay.unregister('dest');
    TutorialOverlay.unregisterContextual('dest_ctx');
  }

  private _contextualTip(): TutorialTarget | null {
    if (TutorialManager.isActive || this._loot._isOpen) return null;
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
    if (this.container.parent) this.relayout();
  };

  tutorialRect(): { x: number; y: number; w: number; h: number; r?: number } | null {
    if (!TutorialManager.isStep(TutorialStep.PICK_XIANGKO)) return null;
    return stageRectOf(this._xiangkoGo, 8);
  }

  relayout(): void {
    this._xiangkoGo = null;
    this._firstWeatherTag = null;
    this._ui.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const redraw = () => {
      if (this.container.parent) this.relayout();
    };
    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x1E1A16);
    this._ui.addChild(fallback);
    const bgTex = gameTexture(DEST_BG);
    whenTextureReady(DEST_BG, redraw);
    if (isTextureReady(bgTex)) {
      const scene = new PIXI.Sprite(bgTex);
      applyFit(scene, fitCover(bgTex.width, bgTex.height, w, h));
      this._ui.addChild(scene);
    }
    const veil = new PIXI.Graphics();
    fillRect(veil, 0, 0, w, h, 0x1A1410);
    veil.alpha = 0.18;
    this._ui.addChild(veil);

    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    const titleTop = Math.max(-28, top - TITLE_LIFT);
    this._drawTitle(w, titleTop, redraw);
    const pillsY = titleTop + BANNER_H + 8;
    const skill = cookXpView(KitchenManager.save);
    const profile = makePlayerLevelHud({
      avatar: HUD_ICON.player,
      level: skill.level,
      text: skill.text,
      fill: skill.fill,
      onReady: redraw,
    });
    profile.position.set(12, pillsY);
    this._ui.addChild(profile);

    const pillH = 44;
    const buffs = liveHudBuffs(KitchenManager.save);
    const pillY = hudPillsY(pillsY, pillH);
    const resX = 12 + PLAYER_LEVEL_HUD.avatar + PLAYER_LEVEL_HUD.gap + PLAYER_LEVEL_HUD.barW + 12;
    const money = makeStatPill({
      icon: HUD_ICON.coin,
      text: `${KitchenManager.save.money}`,
      width: 164,
      onIconReady: redraw,
    });
    money.position.set(resX, pillY);
    this._ui.addChild(money);

    const staMax = staminaMax(KitchenManager.save);
    const staShort = KitchenManager.save.stamina < staMax;
    const staPill = makeStatPill({
      icon: HUD_ICON.stamina,
      text: `${KitchenManager.save.stamina}/${staMax}`,
      width: 188,
      fill: KitchenManager.save.stamina / staMax,
      fillColor: 0x6BA368,
      plus: staShort,
      pulsePlus: KitchenManager.save.stamina <= 0,
      onTap: staShort
        ? () => {
          if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.HINT_DOOR)) return;
          void KitchenManager.offerShareStamina();
        }
        : undefined,
      onIconReady: redraw,
    });
    staPill.position.set(resX + 172, pillY);
    this._ui.addChild(staPill);

    if (buffs.length) {
      const row = makeHudBuffRow({
        buffs,
        onReady: redraw,
        onTap: () => ensureHudBuffPanel().open(),
      });
      row.position.set(resX, hudBuffRowY(pillY, pillH));
      this._ui.addChild(row);
    }

    const mute = makeMuteButton(44);
    mute.position.set(w - 64, pillY);
    this._ui.addChild(mute);

    const listTop = pillsY + PLAYER_LEVEL_HUD.height + 8;
    const bottomPad = Math.max(
      HOME_BOTTOM,
      (Number.isFinite(Game.safeBottom) ? Game.safeBottom : 0) + 24,
    );
    const homeY = h - HOME_H - bottomPad;
    const dockY = homeY - HOME_GAP - VEHICLE_H - DOCK_TITLE_H;
    const listH = Math.max(180, dockY - 8 - listTop);
    const cardH = Math.max(
      CARD_H_MIN,
      Math.min(CARD_H_MAX, Math.floor((listH - (FIT_CARDS - 1) * CARD_GAP) / FIT_CARDS)),
    );
    const cardStep = cardH + CARD_GAP;
    const offer = vehicleOffer(KitchenManager.save, this._browse);
    const spots = offer === 'locked' ? [] : marketsForVehicle(this._browse);
    const specialId = ownsVehicle(KitchenManager.save, this._browse)
      ? specialMarketForVehicle(this._browse)
      : null;
    const special = specialId ? getSpecialMarket(specialId) : null;
    const cards = spots.length + (special ? 1 : 0);
    const contentH = cards > 0 ? cards * cardH + Math.max(0, cards - 1) * CARD_GAP : listH;
    const list = new PIXI.Container();
    spots.forEach((market, i) => {
      list.addChild(this._card(market, 24, i * cardStep, w - 48, cardH));
    });
    if (special) {
      list.addChild(this._specialCard(special, 24, spots.length * cardStep, w - 48, cardH));
    }
    if (!cards) {
      const empty = makeLabel(
        offer === 'locked' ? '先买上一辆才能开这辆' : '更远的菜场还在路上',
        22,
        0xFFF8F0,
        { fontWeight: '600' },
      );
      empty.anchor.set(0.5);
      empty.position.set(w / 2, listH / 2);
      list.addChild(empty);
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

    this._ui.addChild(this._vehicleDock(24, dockY, w - 48, VEHICLE_H + DOCK_TITLE_H, redraw));
    this._ui.addChild(this._homeBtn((w - 280) / 2, homeY, 280, HOME_H, redraw));
    TutorialOverlay.refresh();
  }

  private _drawTitle(w: number, top: number, onReady: () => void): void {
    const bannerW = 380;
    const bannerH = BANNER_H;
    const wrap = new PIXI.Container();
    wrap.position.set((w - bannerW) / 2, top);
    const path = HUD_ICON.destBanner;
    const tex = gameTexture(path);
    whenTextureReady(path, onReady);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, bannerW, bannerH);
      sp.anchor.set(0.5);
      sp.position.set(bannerW / 2, bannerH / 2);
      wrap.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2, 0x8B5A2B, 1);
      g.beginFill(0xE8DCC8);
      g.drawRoundedRect(24, 48, bannerW - 48, 96, 18);
      g.endFill();
      wrap.addChild(g);
    }
    const title = makeLabel('今晚去哪收摊', 30, 0x3A3228, { fontWeight: '700' });
    title.anchor.set(0.5);
    title.position.set(bannerW / 2, bannerH * 0.58);
    wrap.addChild(title);
    this._ui.addChild(wrap);
  }

  private _card(market: MarketDef, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const save = KitchenManager.save;
    const routed = ownsRouteToMarket(save, market.id);
    const unlocked = routed && isMarketUnlocked(market.id, save.level);
    const needRide = vehicleForMarket(market.id);
    const pad = Math.max(12, Math.round(height * 0.085));
    const btnH = height < 176 ? 42 : 48;

    const frame = new PIXI.Graphics();
    frame.beginFill(0x160E08, 0.28);
    frame.drawRoundedRect(x, y + 5, width, height, 20);
    frame.endFill();
    frame.lineStyle(2.8, UI_PALETTE.ink, 1);
    frame.beginFill(UI_PALETTE.walnut, 1);
    frame.drawRoundedRect(x, y, width, height, 20);
    frame.endFill();
    drawCraftCard(frame, x + 6, y + 5, width - 12, height - 11, {
      radius: 15,
      tone: unlocked ? 'ivory' : 'muted',
    });
    root.addChild(frame);

    const thumbH = height - pad * 2;
    const thumbW = Math.round(Math.min(206, thumbH * (200 / 168)));
    const thumbX = x + pad;
    const thumbY = y + pad - 1;
    const textX = thumbX + thumbW + 14;
    const btnY = y + height - pad - btnH - 2;
    const thumbBg = new PIXI.Graphics();
    thumbBg.lineStyle(2.2, UI_PALETTE.ink, 1);
    thumbBg.beginFill(0x2A221C, 1);
    thumbBg.drawRoundedRect(thumbX, thumbY, thumbW, thumbH, 12);
    thumbBg.endFill();
    root.addChild(thumbBg);

    if (market.thumb) {
      const tex = gameTexture(market.thumb);
      whenTextureReady(market.thumb, () => {
        if (this.container.parent) this.relayout();
      });
      if (isTextureReady(tex)) {
        const sprite = new PIXI.Sprite(tex);
        const fit = fitCover(tex.width, tex.height, thumbW - 4, thumbH - 4);
        applyFit(sprite, fit);
        sprite.position.set(thumbX + 2 + fit.x, thumbY + 2 + fit.y);
        if (!unlocked) sprite.alpha = 0.42;
        const mask = new PIXI.Graphics();
        fillRect(mask, thumbX + 2, thumbY + 2, thumbW - 4, thumbH - 4, 0xffffff, 10);
        sprite.mask = mask;
        root.addChild(mask);
        root.addChild(sprite);
      }
    }
    if (!unlocked) {
      const lock = makeLabel('未解锁', 18, 0xFFF8F0, { fontWeight: '700' });
      const chip = new PIXI.Graphics();
      chip.lineStyle(2, UI_PALETTE.ink, 1);
      chip.beginFill(0x3A2416, 0.85);
      chip.drawRoundedRect(thumbX + (thumbW - 100) / 2, thumbY + (thumbH - 34) / 2, 100, 34, 17);
      chip.endFill();
      lock.anchor.set(0.5);
      lock.position.set(thumbX + thumbW / 2, thumbY + thumbH / 2);
      root.addChild(chip, lock);
    }

    const name = makeLabel(market.name, height < 176 ? 23 : 26, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(textX, y + pad - 2);
    root.addChild(name);

    if (unlocked && !TutorialManager.isActive) {
      const weather = dailyMarketWeather(market.id);
      const shortTag = weather.shortDesc.split('·')[0].trim();
      const tagTxt = makeLabel(`${weather.name}·${shortTag}`, 15, weather.pillInk, {
        fontWeight: '700',
      });
      const tw = Math.ceil(tagTxt.width) + 20;
      const th = 28;
      const tx = x + width - pad - tw;
      const ty = y + pad - 1;
      const tagBg = new PIXI.Graphics();
      tagBg.lineStyle(1.8, weather.pillInk, 0.85);
      tagBg.beginFill(weather.pillFill, 1);
      tagBg.drawRoundedRect(tx, ty, tw, th, th / 2);
      tagBg.endFill();
      tagTxt.anchor.set(0.5);
      tagTxt.position.set(tx + tw / 2, ty + th / 2 + 0.5);
      const weatherChip = new PIXI.Container();
      weatherChip.addChild(tagBg, tagTxt);
      root.addChild(weatherChip);
      if (!this._firstWeatherTag) this._firstWeatherTag = weatherChip;
    }

    const hint = makeLabel(market.hint, height < 176 ? 17 : 18, UI_PALETTE.muted, {
      wordWrap: true,
      wordWrapWidth: width - (textX - x) - pad,
    });
    hint.position.set(textX, y + pad + 32);
    root.addChild(hint);

    if (unlocked) {
      const goW = 158;
      const gap = 12;
      const go = this._departBtn(
        textX,
        btnY,
        goW,
        btnH,
        market.staminaCost,
        save.stamina < market.staminaCost,
        () => this._depart(market),
      );
      root.addChild(go);
      if (market.id === 'xiangko') this._xiangkoGo = go;
      root.addChild(this._exploreMeter(textX + goW + gap, btnY, btnH, market.id));
    } else {
      const label = routed ? `厨艺 ${market.unlockLevel} 级开` : `需购${needRide.name}`;
      const need = makeSlicedButton({
        label,
        width: 196,
        height: btnH,
        skin: 'cream',
        textColor: 0x7A6248,
        onReady: () => {
          if (this.container.parent) this.relayout();
        },
      });
      need.eventMode = 'none';
      need.position.set(textX, btnY);
      root.addChild(need);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(x, y, width, height);
      root.on('pointertap', () => {
        if (this._scroller.moved) return;
        AudioManager.play('ui_deny');
        Platform.showToast(
          routed
            ? `${market.name} · 厨艺 ${market.unlockLevel} 解锁`
            : `${market.name} · 买了${needRide.name}才能去`,
        );
      });
    }
    return root;
  }

  private _specialCard(market: SpecialMarketDef, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const used = KitchenManager.specialVisitCount(market.id);
    const left = used < market.dailyLimit;
    const pad = Math.max(12, Math.round(height * 0.085));
    const btnH = height < 176 ? 42 : 48;

    const frame = new PIXI.Graphics();
    frame.beginFill(0x160E08, 0.28);
    frame.drawRoundedRect(x, y + 5, width, height, 20);
    frame.endFill();
    frame.lineStyle(2.8, UI_PALETTE.ink, 1);
    frame.beginFill(left ? 0xC98E2B : UI_PALETTE.walnut, 1);
    frame.drawRoundedRect(x, y, width, height, 20);
    frame.endFill();
    drawCraftCard(frame, x + 6, y + 5, width - 12, height - 11, {
      radius: 15,
      tone: left ? 'gold' : 'muted',
    });
    root.addChild(frame);

    const thumbH = height - pad * 2;
    const thumbW = Math.round(Math.min(206, thumbH * (200 / 168)));
    const thumbX = x + pad;
    const thumbY = y + pad - 1;
    const textX = thumbX + thumbW + 14;
    const btnY = y + height - pad - btnH - 2;
    const thumbBg = new PIXI.Graphics();
    thumbBg.lineStyle(2.2, UI_PALETTE.ink, 1);
    thumbBg.beginFill(0x2A221C, 1);
    thumbBg.drawRoundedRect(thumbX, thumbY, thumbW, thumbH, 12);
    thumbBg.endFill();
    root.addChild(thumbBg);

    if (market.thumb) {
      const tex = gameTexture(market.thumb);
      whenTextureReady(market.thumb, () => {
        if (this.container.parent) this.relayout();
      });
      if (isTextureReady(tex)) {
        const sprite = new PIXI.Sprite(tex);
        const fit = fitCover(tex.width, tex.height, thumbW - 4, thumbH - 4);
        applyFit(sprite, fit);
        sprite.position.set(thumbX + 2 + fit.x, thumbY + 2 + fit.y);
        if (!left) sprite.alpha = 0.42;
        const mask = new PIXI.Graphics();
        fillRect(mask, thumbX + 2, thumbY + 2, thumbW - 4, thumbH - 4, 0xffffff, 10);
        sprite.mask = mask;
        root.addChild(mask);
        root.addChild(sprite);
      }
    }

    const name = makeLabel(`✦ ${market.name}`, height < 176 ? 23 : 26, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(textX, y + pad - 2);
    root.addChild(name);

    const hint = makeLabel(market.hint, height < 176 ? 17 : 18, UI_PALETTE.muted, {
      wordWrap: true,
      wordWrapWidth: width - (textX - x) - pad,
    });
    hint.position.set(textX, y + pad + 32);
    root.addChild(hint);

    const go = makeAdButton({
      label: '看视频进',
      width: 176,
      height: btnH,
      skin: 'gold',
      disabled: !left,
      onReady: () => {
        if (this.container.parent) this.relayout();
      },
    });
    go.position.set(textX, btnY);
    go.on('pointertap', () => {
      if (this._scroller.moved) return;
      this._enterSpecial(market);
    });
    root.addChild(go);
    const chipX = textX + 186;
    root.addChild(this._dailyChip(chipX, btnY, btnH, used, market.dailyLimit));
    const peek = 36;
    const btn = this._peekBtn(peek);
    btn.position.set(chipX + 114 + 8, btnY + Math.round((btnH - peek) / 2));
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._scroller.moved) return;
      this._loot.openSpecial(market.id);
    });
    root.addChild(btn);
    return root;
  }

  private _dailyChip(x: number, y: number, h: number, used: number, limit: number): PIXI.Container {
    const root = new PIXI.Container();
    const chip = new PIXI.Graphics();
    drawRecessedWell(chip, 0, 2, 114, h - 4, { radius: (h - 4) / 2 });
    root.addChild(chip);
    const n = makeLabel(`今日 ${used}/${limit}`, 17, used >= limit ? TERRACOTTA : UI_PALETTE.ink, { fontWeight: '700' });
    n.anchor.set(0.5);
    n.position.set(57, h / 2);
    root.addChild(n);
    root.position.set(x, y);
    return root;
  }

  /** 出发和包子消耗挤在一颗钮上。不够就数字发金。 */
  private _departBtn(
    x: number,
    y: number,
    width: number,
    height: number,
    cost: number,
    short: boolean,
    onTap: () => void,
  ): PIXI.Container {
    const btn = makeSlicedButton({
      label: '',
      width,
      height,
      skin: short ? 'terracotta' : 'olive',
      onReady: () => {
        if (this.container.parent) this.relayout();
      },
    });
    btn.position.set(x, y);
    btn.on('pointertap', () => {
      if (this._scroller.moved) return;
      onTap();
    });

    const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
    const word = makeLabel('出发', 21, 0xFFF8F0, {
      fontWeight: '700',
      stroke: UI_PALETTE.ink,
      strokeThickness: 3,
    });
    word.anchor.set(0, 0.5);
    const icon = HUD_ICON.stamina;
    whenTextureReady(icon, () => {
      if (this.container.parent) this.relayout();
    });
    const tex = gameTexture(icon);
    const bun = isTextureReady(tex) ? new PIXI.Sprite(tex) : null;
    if (bun) {
      fitSpriteInBox(bun, 22, 22);
      bun.anchor.set(0.5);
      bun.eventMode = 'none';
    }
    const n = makeLabel(`-${cost}`, 18, short ? 0xFFE27A : 0xFFF8F0, {
      fontWeight: '700',
      stroke: UI_PALETTE.ink,
      strokeThickness: 3,
    });
    n.anchor.set(0, 0.5);
    const clusterW = word.width + 4 + (bun ? 22 : 0) + 2 + n.width;
    let cx = Math.round((width - clusterW) / 2);
    const mid = height / 2 - 1;
    word.position.set(cx, mid);
    cx += word.width + 4;
    if (bun) {
      bun.position.set(cx + 11, mid);
      cx += 24;
      face.addChild(bun);
    }
    n.position.set(cx, mid);
    face.addChild(word, n);
    return btn;
  }

  /** 探索度 + 放大镜 + 双层高光进度条。 */
  private _exploreMeter(
    x: number,
    y: number,
    height: number,
    marketId: MarketDef['id'],
  ): PIXI.Container {
    const root = new PIXI.Container();
    const view = marketExploration(KitchenManager.save, marketId);
    const pct = explorePercent(view);
    const peek = 34;
    const barW = 152;

    const label = makeLabel(`探索度 ${pct}%`, 18, UI_PALETTE.ink, { fontWeight: '700' });
    label.position.set(2, 0);
    root.addChild(label);

    if (view.complete) {
      const btn = this._peekBtn(peek);
      btn.position.set(label.width + 8, -4);
      btn.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._scroller.moved) return;
        this._loot.open(marketId);
      });
      root.addChild(btn);
    }

    const barH = 16;
    const bar = makeCraftProgressBar({
      width: barW,
      height: barH,
      ratio: view.complete ? 1 : view.ratio,
      scheme: view.complete ? 'olive' : 'amber',
    });
    bar.position.set(0, height - barH - 2);
    root.addChild(bar);

    root.position.set(x, y);
    return root;
  }

  private _peekBtn(size: number): PIXI.Container {
    const root = new PIXI.Container();
    const path = HUD_ICON.peek;
    whenTextureReady(path, () => {
      if (this.container.parent) this.relayout();
    });
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
    root.hitArea = new PIXI.Rectangle(0, 0, size, size);
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
    const title = makeLabel('选择出行工具', 30, 0xFFF6EA, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      letterSpacing: 5,
      stroke: 0x3A2416,
      strokeThickness: 6,
      lineJoin: 'round',
      dropShadow: true,
      dropShadowColor: '#2A2018',
      dropShadowAlpha: 0.4,
      dropShadowDistance: 2,
      dropShadowAngle: Math.PI / 2,
      dropShadowBlur: 0,
    });
    title.anchor.set(0.5);
    title.position.set(x + width / 2, y + 20);
    root.addChild(title);

    const bodyY = y + DOCK_TITLE_H;
    const bodyH = height - DOCK_TITLE_H;
    const imgH = bodyH;
    const imgW = width - 80;
    const zoom = DOCK_ZOOM[ride.id];
    const cx = x + width / 2;
    const cy = bodyY + imgH / 2;

    whenTextureReady(ride.art, onReady);
    const tex = gameTexture(ride.art);
    let artW = 200;
    if (isTextureReady(tex)) {
      const sprite = new PIXI.Sprite(tex);
      fitSpriteInBox(sprite, imgW * zoom, imgH * zoom);
      sprite.anchor.set(0.5);
      sprite.position.set(cx, cy);
      sprite.eventMode = 'none';
      if (offer === 'buyable') applyGray(sprite);
      if (offer === 'locked') sprite.tint = 0x14110E;
      root.addChild(sprite);
      artW = sprite.width;
    }

    if (offer === 'buyable') {
      const buy = makeSlicedButton({
        label: `${ride.cost}`,
        width: 168,
        height: 44,
        skin: 'terracotta',
        onReady,
      });
      buy.position.set(x + (width - 168) / 2, y + height - 44);
      buy.on('pointertap', (e) => {
        e.stopPropagation();
        if (!KitchenManager.buyVehicle(ride.id)) return;
        this._browse = ride.id;
        this._scroller.reset();
        this.relayout();
      });
      root.addChild(buy);
      whenTextureReady(HUD_ICON.coin, onReady);
      const coin = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
      if (isTextureReady(coin.texture)) {
        fitSpriteInBox(coin, 30, 30);
        coin.anchor.set(1, 0.5);
        coin.position.set(x + (width - 168) / 2 + 52, y + height - 22);
        coin.eventMode = 'none';
        root.addChild(coin);
      }
    }

    const arrowGap = 38;
    root.addChild(this._arrow(cx - artW / 2 - arrowGap, cy, -1));
    root.addChild(this._arrow(cx + artW / 2 + arrowGap, cy, 1));
    return root;
  }

  private _homeBtn(x: number, y: number, width: number, height: number, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const btn = makeSlicedButton({
      label: '回家',
      width,
      height,
      skin: 'terracotta',
      labelOffsetX: 22,
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
    whenTextureReady(HUD_ICON.home, onReady);
    const house = new PIXI.Sprite(gameTexture(HUD_ICON.home));
    if (isTextureReady(house.texture)) {
      fitSpriteInBox(house, 58, 58);
      house.anchor.set(0.5);
      house.position.set(x + 44, y + height / 2 - 2);
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
    bg.lineStyle(2.8, UI_PALETTE.ink, 1);
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
    root.hitArea = new PIXI.Circle(0, 0, 28);
    bindUiClick(root);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this._switchVehicle(dir);
    });
    return root;
  }

  private _depart(market: MarketDef): void {
    if (TutorialManager.isActive && market.id !== 'xiangko') {
      TutorialGuard.block('departOther');
      return;
    }
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
