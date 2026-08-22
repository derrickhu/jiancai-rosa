import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { MARKETS, STAMINA_MAX, cookXpView, isMarketUnlocked, type MarketDef } from '@/sim';
import { HUD_ICON, fillRect, makeCookSkillPill, makeLabel, makeSlicedButton, makeStatPill } from '@/utils/ui';
import { applyFit, fitCover, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

const DEST_BG = 'subpkg_images/dest_street_bg.jpg';
/** 卡高 200 + 间距 14。菜场超过四个就得滚，别把「回家」挤下屏。 */
const CARD_STEP = 214;
const DRAG_SLOP = 10;

export class DestinationScene implements Scene {
  readonly name = 'destinations';
  readonly container = new PIXI.Container();
  private _ui = new PIXI.Container();
  private _scrollY = 0;
  private _dragMoved = false;

  constructor() {
    this.container.addChild(this._ui);
  }

  onEnter(): void {
    this.relayout();
  }

  relayout(): void {
    this._ui.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
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
    const icePill = makeStatPill({
      icon: HUD_ICON.fridge,
      text: room > 0 ? `空 ${room}` : '满了',
      width: 200,
      ...(room > 0 ? {} : { fill: 1, fillColor: 0xE07A5F }),
      onIconReady: redraw,
    });
    icePill.position.set(454, pillsY);
    this._ui.addChild(icePill);

    const listTop = pillsY + 52;
    const listH = Math.max(240, h - 96 - listTop);
    const contentH = MARKETS.length * CARD_STEP;
    const list = new PIXI.Container();
    MARKETS.forEach((market, i) => {
      list.addChild(this._card(market, 24, i * CARD_STEP, w - 48));
    });
    list.y = listTop + Math.max(Math.min(0, listH - contentH), Math.min(0, this._scrollY));
    this._scrollY = list.y - listTop;
    this._ui.addChild(list);

    if (contentH > listH) {
      const mask = new PIXI.Graphics();
      fillRect(mask, 0, listTop, w, listH, 0xffffff);
      this._ui.addChild(mask);
      list.mask = mask;
      this._bindScroll(list, w, listTop, listH, contentH);
    }

    const back = makeSlicedButton({
      label: '回家',
      width: w - 64,
      height: 56,
      skin: 'terracotta',
      onReady: redraw,
    });
    back.position.set(32, h - 80);
    back.on('pointertap', () => SceneManager.switchTo('kitchen'));
    this._ui.addChild(back);
  }

  private _bindScroll(
    list: PIXI.Container,
    w: number,
    top: number,
    viewH: number,
    contentH: number,
  ): void {
    const min = top + viewH - contentH;
    list.eventMode = 'static';
    list.hitArea = new PIXI.Rectangle(0, 0, w, contentH);
    let lastY = 0;
    let dragging = false;
    list.on('pointerdown', (e) => {
      dragging = true;
      this._dragMoved = false;
      lastY = e.global.y;
    });
    const end = (): void => {
      dragging = false;
    };
    list.on('pointerup', end);
    list.on('pointerupoutside', end);
    list.on('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.global.y - lastY;
      if (Math.abs(dy) > DRAG_SLOP) this._dragMoved = true;
      list.y = Math.min(top, Math.max(min, list.y + dy));
      this._scrollY = list.y - top;
      lastY = e.global.y;
    });
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
    const unlocked = isMarketUnlocked(market.id, KitchenManager.save.level);
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
        if (this._dragMoved) return;
        this._depart(market);
      });
      root.addChild(go);
      root.addChild(this._staminaCost(x + 416, y + 136, market.staminaCost, KitchenManager.save.stamina < market.staminaCost));
    } else {
      const need = makeSlicedButton({
        label: `厨艺 ${market.unlockLevel} 解锁`,
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
        if (this._dragMoved) return;
        Platform.showToast(`${market.name} · 厨艺 ${market.unlockLevel} 解锁`);
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

  private _depart(market: MarketDef): void {
    if (!KitchenManager.canGoMarket()) {
      Platform.showToast('体力不足，看个广告也能出门');
      return;
    }
    if (KitchenManager.fridgeRoom() <= 0) {
      Platform.showToast('冰箱满了，先卖掉或做菜再出门');
      return;
    }
    if (!RunManager.start(market.id)) return;
    SceneManager.switchTo('market');
  }
}
