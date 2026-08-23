import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import {
  STAMINA_MAX,
  cookXpView,
  isMarketUnlocked,
  marketsForVehicle,
  neighborVehicle,
  ownsRouteToMarket,
  ownsVehicle,
  vehicleById,
  vehicleOffer,
  vehicleForMarket,
  type MarketDef,
  type VehicleId,
} from '@/sim';
import { HUD_ICON, fillRect, makeCookSkillPill, makeLabel, makeSlicedButton, makeStatPill } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { applyGray, applyFit, fitCover, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { marketBootPaths } from '@/utils/outingAssets';

const DEST_BG = 'subpkg_images/dest_street_bg.jpg';
/** 卡高 200 + 间距 14。菜场超过四个就得滚，别把「回家」挤下屏。 */
const CARD_STEP = 214;
const DRAG_SLOP = 10;
const VEHICLE_H = 220;
const DOCK_TITLE_H = 44;
const HOME_H = 64;
/** 出行区和回家钮拉开，鞋底下不要贴着回家。 */
const HOME_GAP = 168;
/** 回家钮回到靠近屏底的位置。 */
const HOME_BOTTOM = 20;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const WALNUT = 0x8B5A2B;
const TERRACOTTA = 0xC46A3A;
/** 走路鞋团得紧，车要铺满盒子，看起来才比鞋大。 */
const DOCK_ZOOM: Record<VehicleId, number> = {
  walk: 0.72,
  bike: 1,
  ebike: 1,
  truck: 1,
};

export class DestinationScene implements Scene {
  readonly name = 'destinations';
  readonly container = new PIXI.Container();
  private _ui = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _browse: VehicleId = 'walk';

  constructor() {
    this.container.eventMode = 'static';
    this.container.addChild(this._ui);
    this._scroller = new VerticalScroller(this.container, {
      slop: DRAG_SLOP,
      visible: () => !!this.container.parent,
    });
  }

  onEnter(): void {
    this._browse = KitchenManager.save.vehicle;
    this._scroller.enable();
    this.relayout();
  }

  onExit(): void {
    this._scroller.disable();
  }

  relayout(): void {
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
    const headerH = this._drawTitle(w, top, redraw);
    const pillsY = top + headerH + 4;
    const skill = cookXpView(KitchenManager.save);
    const skillPill = makeCookSkillPill({
      level: skill.level,
      text: skill.text,
      width: 200,
      fill: skill.fill,
    });
    skillPill.position.set(20, pillsY);
    this._ui.addChild(skillPill);

    const sta = KitchenManager.save.stamina;
    const staPill = makeStatPill({
      icon: 'subpkg_images/hud_stamina.png',
      text: `${sta}/${STAMINA_MAX}`,
      width: 210,
      fill: sta / STAMINA_MAX,
      fillColor: 0x6BA368,
      onIconReady: redraw,
    });
    staPill.position.set(232, pillsY);
    this._ui.addChild(staPill);

    const room = KitchenManager.fridgeRoom();
    const canStack = KitchenManager.fridgeAcceptsOuting();
    const icePill = makeStatPill({
      icon: HUD_ICON.fridge,
      text: room > 0 ? `空 ${room}` : canStack ? '可叠' : '满了',
      width: 200,
      ...(room > 0 || canStack ? {} : { fill: 1, fillColor: 0xE07A5F }),
      onIconReady: redraw,
    });
    icePill.position.set(454, pillsY);
    this._ui.addChild(icePill);

    const listTop = pillsY + 52;
    const homeY = h - HOME_H - HOME_BOTTOM;
    const dockY = homeY - HOME_GAP - VEHICLE_H - DOCK_TITLE_H;
    const listH = Math.max(180, dockY - 10 - listTop);
    const offer = vehicleOffer(KitchenManager.save, this._browse);
    const spots = offer === 'locked' ? [] : marketsForVehicle(this._browse);
    const contentH = Math.max(spots.length, 1) * CARD_STEP;
    const list = new PIXI.Container();
    spots.forEach((market, i) => {
      list.addChild(this._card(market, 24, i * CARD_STEP, w - 48));
    });
    if (!spots.length) {
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
  }

  private _drawTitle(w: number, top: number, onReady: () => void): number {
    const bannerW = 380;
    const bannerH = 176;
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
    return bannerH;
  }

  private _card(market: MarketDef, x: number, y: number, width: number): PIXI.Container {
    const root = new PIXI.Container();
    const save = KitchenManager.save;
    const routed = ownsRouteToMarket(save, market.id);
    const unlocked = routed && isMarketUnlocked(market.id, save.level);
    const needRide = vehicleForMarket(market.id);
    const height = 200;
    const frame = new PIXI.Graphics();
    fillRect(frame, x, y, width, height, 0x5A4636, 18);
    root.addChild(frame);
    const paper = new PIXI.Graphics();
    paper.lineStyle(3, 0x8B5A2B, 1);
    paper.beginFill(unlocked ? 0xFFF6EA : 0xEDE3D2);
    paper.drawRoundedRect(x + 6, y + 6, width - 12, height - 12, 14);
    paper.endFill();
    root.addChild(paper);

    const thumbW = 200;
    const thumbH = 168;
    const thumbX = x + 16;
    const thumbY = y + 16;
    const thumbBg = new PIXI.Graphics();
    fillRect(thumbBg, thumbX, thumbY, thumbW, thumbH, 0x2A221C, 12);
    root.addChild(thumbBg);

    if (market.thumb) {
      const tex = gameTexture(market.thumb);
      whenTextureReady(market.thumb, () => {
        if (this.container.parent) this.relayout();
      });
      if (isTextureReady(tex)) {
        const sprite = new PIXI.Sprite(tex);
        const fit = fitCover(tex.width, tex.height, thumbW, thumbH);
        applyFit(sprite, fit);
        sprite.position.set(thumbX + fit.x, thumbY + fit.y);
        if (!unlocked) sprite.alpha = 0.42;
        const mask = new PIXI.Graphics();
        fillRect(mask, thumbX, thumbY, thumbW, thumbH, 0xffffff, 12);
        sprite.mask = mask;
        root.addChild(mask);
        root.addChild(sprite);
      }
    }
    if (!unlocked) {
      const lock = makeLabel('未解锁', 20, 0xFFF8F0, { fontWeight: '700' });
      const chip = new PIXI.Graphics();
      chip.beginFill(0x2A2018, 0.62);
      chip.drawRoundedRect(thumbX + 48, thumbY + 66, 104, 36, 18);
      chip.endFill();
      lock.position.set(thumbX + 62, thumbY + 72);
      root.addChild(chip);
      root.addChild(lock);
    }

    const name = makeLabel(market.name, 28, 0x2A2018, { fontWeight: '700' });
    name.position.set(x + 236, y + 20);
    root.addChild(name);

    const hint = makeLabel(market.hint, 20, 0x5A4636, {
      wordWrap: true,
      wordWrapWidth: width - 260,
    });
    hint.position.set(x + 236, y + 62);
    root.addChild(hint);

    if (unlocked) {
      const go = makeSlicedButton({
        label: '出发',
        width: 168,
        height: 48,
        skin: 'terracotta',
        onReady: () => {
          if (this.container.parent) this.relayout();
        },
      });
      go.position.set(x + 236, y + 136);
      go.on('pointertap', () => {
        if (this._scroller.moved) return;
        this._depart(market);
      });
      root.addChild(go);
      root.addChild(this._staminaCost(x + 416, y + 136, market.staminaCost, save.stamina < market.staminaCost));
    } else {
      const label = routed ? `厨艺 ${market.unlockLevel} 解锁` : `先买${needRide.name}`;
      const need = makeSlicedButton({
        label,
        width: 168,
        height: 48,
        skin: 'wood',
        onReady: () => {
          if (this.container.parent) this.relayout();
        },
      });
      need.eventMode = 'none';
      need.position.set(x + 236, y + 136);
      root.addChild(need);
      root.addChild(this._staminaCost(x + 416, y + 136, market.staminaCost, false));
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(x, y, width, height);
      root.on('pointertap', () => {
        if (this._scroller.moved) return;
        Platform.showToast(
          routed
            ? `${market.name} · 厨艺 ${market.unlockLevel} 解锁`
            : `${market.name} · 买了${needRide.name}才能去`,
        );
      });
    }
    return root;
  }

  /** 出发钮右边：包子图 + 消耗。不够就数字发红。 */
  private _staminaCost(x: number, y: number, cost: number, short: boolean): PIXI.Container {
    const root = new PIXI.Container();
    const chip = new PIXI.Graphics();
    chip.lineStyle(2, 0x8B5A2B, 1);
    chip.beginFill(0xFFF6EA);
    chip.drawRoundedRect(0, 0, 118, 48, 24);
    chip.endFill();
    root.addChild(chip);

    const icon = HUD_ICON.stamina;
    whenTextureReady(icon, () => {
      if (this.container.parent) this.relayout();
    });
    const tex = gameTexture(icon);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 40, 40);
      sp.anchor.set(0.5);
      sp.position.set(28, 24);
      root.addChild(sp);
    }

    const n = makeLabel(`-${cost}`, 24, short ? 0xC46A3A : 0x3A3228, { fontWeight: '700' });
    n.anchor.set(0, 0.5);
    n.position.set(52, 24);
    root.addChild(n);
    root.position.set(x, y);
    return root;
  }

  private _switchVehicle(dir: -1 | 1): void {
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
    bg.beginFill(0xE8DFD0, 1);
    bg.lineStyle(2, WALNUT, 1);
    bg.drawCircle(0, 0, 22);
    bg.endFill();
    const tri = new PIXI.Graphics();
    tri.beginFill(TERRACOTTA, 1);
    if (dir < 0) {
      tri.moveTo(6, -10);
      tri.lineTo(6, 10);
      tri.lineTo(-8, 0);
    } else {
      tri.moveTo(-6, -10);
      tri.lineTo(-6, 10);
      tri.lineTo(8, 0);
    }
    tri.closePath();
    tri.endFill();
    root.addChild(bg, tri);
    root.position.set(cx, cy);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(0, 0, 28);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this._switchVehicle(dir);
    });
    return root;
  }

  private _depart(market: MarketDef): void {
    if (!ownsRouteToMarket(KitchenManager.save, market.id)) {
      const ride = vehicleForMarket(market.id);
      Platform.showToast(`买了${ride.name}才能去${market.name}`);
      return;
    }
    if (!isMarketUnlocked(market.id, KitchenManager.save.level)) {
      Platform.showToast(`${market.name} · 厨艺 ${market.unlockLevel} 解锁`);
      return;
    }
    if (!KitchenManager.canGoMarket()) {
      Platform.showToast('体力不足，看个广告也能出门');
      return;
    }
    if (!KitchenManager.fridgeAcceptsOuting()) {
      Platform.showToast('冰箱满了，先卖掉或做菜再出门');
      return;
    }
    if (OutingCurtain.busy) return;
    if (!RunManager.start(market.id)) return;
    OutingCurtain.play({
      paths: marketBootPaths(market.id, RunManager.run ?? undefined),
      then: () => SceneManager.switchTo('market'),
    });
  }
}
