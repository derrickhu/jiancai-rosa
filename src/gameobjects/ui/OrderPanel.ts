import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  canUseDailyAd,
  dailyAdLeft,
  formatOrderRemain,
  fridgeDishQty,
  neighborNpc,
  neighborOrderReward,
  neighborRewardChips,
  recipeById,
  recipeNeeds,
  recipeUnlockView,
  type NeighborOrder,
  type RecipeId,
} from '@/sim';
import { playRewardCollect } from '@/utils/coinCollect';
import { orderPanelPaths } from '@/utils/panelAssets';
import { P0_ART, fillRect, makeAdButton, makeLabel, makeRewardStrip, makeSlicedButton } from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  watchTextures,
} from '@/utils/assets';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';

const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x8A6A40;
const PAPER = 0xFFF8F0;
const CREAM = 0xF6EDE0;
const WALNUT = 0x8B5A2B;
const LINE = 0xC4A574;
const TERRACOTTA = 0xC46A3A;
const GOLD = 0xC48A14;

export class OrderPanel extends PIXI.Container {
  _isOpen = false;
  onCook: ((recipeId: RecipeId) => void) | null = null;
  private _root = new PIXI.Container();
  private _timer = 0;
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;
  private _adBusy = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 25;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    KitchenManager.sweepNeighborOrders();
    if (!KitchenManager.liveNeighborOrders().length) return;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    warmupAdScene('order_double');
    this._armTimer();
    this._warm();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._paintQueued = false;
    this._clearTimer();
    this._root.removeChildren();
  }

  private _warm(): void {
    watchTextures(
      [...orderPanelPaths(KitchenManager.save, KitchenManager.liveNeighborOrders()), P0_ART.adClapper],
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

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;
    this._warm();
    const now = Date.now();
    const orders = KitchenManager.liveNeighborOrders(now);
    if (!orders.length) {
      this.close(true);
      return;
    }

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.36;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) return;
      this.close();
    });
    this._root.addChild(dim);

    const rowH = 264;
    const boxW = w - 36;
    const headH = 118;
    const footH = 72;
    const boxH = headH + orders.length * (rowH + 14) + footH;
    const x = 18;
    const y = Math.round(Math.max(Game.safeTop + 14, (h - boxH) / 2));

    const panel = new PIXI.Graphics();
    panel.lineStyle(5, WALNUT, 1);
    panel.beginFill(CREAM);
    panel.drawRoundedRect(x, y, boxW, boxH, 28);
    panel.endFill();
    panel.eventMode = 'static';
    panel.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(panel);
    const inner = new PIXI.Graphics();
    inner.lineStyle(2, LINE, 0.7);
    inner.beginFill(0xF3E6D0);
    inner.drawRoundedRect(x + 14, y + 14, boxW - 28, boxH - 28, 20);
    inner.endFill();
    this._root.addChild(inner);

    const title = new PIXI.Text('街坊点菜', {
      fontFamily: TITLE_FONT,
      fontSize: 34,
      fill: INK,
      fontWeight: '700',
      letterSpacing: 2,
      stroke: '#FFF6E8',
      strokeThickness: 5,
    });
    title.position.set(x + 36, y + 28);
    title.eventMode = 'none';
    this._root.addChild(title);
    const hint = makeLabel('做好了点交菜。街坊给钱，有时还拿家里余的换。', 18, MUTED, {
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: boxW - 72,
    });
    hint.position.set(x + 36, y + 72);
    this._root.addChild(hint);

    orders.forEach((order, i) => {
      this._root.addChild(this._row(order, x + 28, y + headH + i * (rowH + 14), boxW - 56, rowH, now));
    });

    const closeW = 168;
    const close = makeSlicedButton({
      label: '关上',
      width: closeW,
      height: 46,
      skin: 'wood',
      onReady: this._scheduleRelayout,
    });
    close.position.set(x + (boxW - closeW) / 2, y + boxH - 60);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);

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
  }

  private _row(
    order: NeighborOrder,
    x: number,
    y: number,
    width: number,
    height: number,
    now: number,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.lineStyle(3, LINE, 1);
    bg.beginFill(PAPER, 1);
    bg.drawRoundedRect(x, y, width, height, 16);
    bg.endFill();
    root.addChild(bg);

    const save = KitchenManager.save;
    const npc = neighborNpc(order.npcId);
    const recipe = recipeById(order.recipeId);
    const view = recipeUnlockView(save);
    const have = fridgeDishQty(save.fridge, order.recipeId);
    const canRefresh = canUseDailyAd(save, 'order_refresh', now);
    const refreshLeft = dailyAdLeft(save, 'order_refresh', now);
    const canDouble = canUseDailyAd(save, 'order_double', now);
    const doubleLeft = dailyAdLeft(save, 'order_double', now);

    const pad = 14;
    const faceW = 142;
    const faceH = 216;
    const faceX = x + 8;
    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, faceW, faceH);
      spr.anchor.set(0.5, 1);
      spr.position.set(faceX + faceW / 2, y + height - 8);
      spr.eventMode = 'none';
      root.addChild(spr);
    }

    const actW = 148;
    const actX = x + width - actW - 12;

    if (canRefresh) {
      const refreshBtn = makeAdButton({
        label: '换一单',
        width: actW,
        height: 42,
        skin: 'cream',
        textColor: INK,
        badge: `免冷却·${refreshLeft}`,
        onReady: this._scheduleRelayout,
      });
      refreshBtn.position.set(actX, y + pad + 2);
      refreshBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'order_refresh',
          () => {
            this._adBusy = false;
            KitchenManager.refreshNeighborOrder(order.id);
            this._inspect = null;
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      root.addChild(refreshBtn);
    } else {
      const drop = makeSlicedButton({
        label: '放弃',
        width: actW,
        height: 42,
        skin: 'cream',
        textColor: INK,
        onReady: this._scheduleRelayout,
      });
      drop.position.set(actX, y + pad + 2);
      drop.on('pointertap', () => {
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      root.addChild(drop);
    }

    const colX = faceX + faceW + 6;
    const dishSize = 62;
    root.addChild(this._dishTile(order, colX, y + pad + 4, dishSize));

    const textX = colX + dishSize + 12;
    const name = makeLabel(`${npc.name}要的${recipe?.name ?? '菜'}`, 21, INK, { fontWeight: '700' });
    name.position.set(textX, y + pad + 2);
    root.addChild(name);
    const remain = makeLabel(formatOrderRemain(order.expiresAt - now), 19, GOLD, { fontWeight: '700' });
    remain.position.set(textX, y + pad + 34);
    root.addChild(remain);

    if (canRefresh) {
      const dropLink = makeLabel('放弃此单', 16, MUTED, { fontWeight: '600' });
      dropLink.position.set(textX + Math.ceil(remain.width) + 14, y + pad + 36);
      dropLink.eventMode = 'static';
      dropLink.cursor = 'pointer';
      dropLink.hitArea = new PIXI.Rectangle(-6, -4, dropLink.width + 12, 26);
      dropLink.on('pointertap', (e) => {
        e.stopPropagation();
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      root.addChild(dropLink);
    }

    const lackY = y + pad + 82;
    const missing = recipeNeeds(view, order.recipeId).filter((row) => row.have < row.need);
    if (have > 0) {
      const ready = makeLabel(
        canDouble ? '菜已备好！可双倍领街坊谢礼' : '冰箱里有现成的，点交菜就扣。',
        19,
        canDouble ? TERRACOTTA : MUTED,
        { fontWeight: '700' },
      );
      ready.position.set(textX, lackY + 14);
      root.addChild(ready);
    } else if (missing.length) {
      const lack = makeLabel('还缺', 19, MUTED);
      lack.anchor.set(0, 0.5);
      lack.position.set(textX, lackY + 24);
      root.addChild(lack);
      let usedX = textX + Math.ceil(lack.width) + 10;
      for (const row of missing) {
        if (usedX + 52 > actX - 6) break;
        root.addChild(this._needTile(usedX, lackY, 46, row.iconId, row.have, row.need));
        usedX += 54;
      }
    } else {
      const ready = makeLabel('材料齐了', 19, MUTED);
      ready.anchor.set(0, 0.5);
      ready.position.set(textX, lackY + 22);
      root.addChild(ready);
      const cook = makeSlicedButton({
        label: '去做菜',
        width: 108,
        height: 42,
        skin: 'terracotta',
        textColor: 0xFFF8F0,
        onReady: this._scheduleRelayout,
      });
      cook.position.set(textX + Math.ceil(ready.width) + 10, lackY);
      cook.on('pointertap', () => {
        this.onCook?.(order.recipeId);
      });
      root.addChild(cook);
    }

    const chips = neighborRewardChips(neighborOrderReward(order));
    if (chips.length) {
      const strip = makeRewardStrip(chips, this._scheduleRelayout, '交菜给', 'paper');
      strip.position.set(colX, y + pad + 178);
      root.addChild(strip);
    }

    const submitNormal = (doubled: boolean): void => {
      const gain = KitchenManager.submitNeighborOrder(order.id, { doubled });
      if (!gain) return;
      this._inspect = null;
      const from = { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.42) };
      if (KitchenManager.liveNeighborOrders().length) this.relayout();
      else this.close(true);
      playRewardCollect({ ...gain, from });
    };

    const btn = makeSlicedButton({
      label: '交菜',
      width: actW,
      height: 42,
      skin: have > 0 ? (canDouble ? 'wood' : 'terracotta') : 'cream',
      textColor: have > 0 ? 0xFFF8F0 : INK,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(actX, y + pad + 54);
    btn.on('pointertap', () => submitNormal(false));
    root.addChild(btn);

    if (canDouble) {
      const dblBtn = makeAdButton({
        label: '双倍交菜',
        width: actW,
        height: 44,
        skin: 'terracotta',
        disabled: have <= 0,
        badge: `×2·剩${doubleLeft}`,
        onReady: this._scheduleRelayout,
      });
      dblBtn.position.set(actX, y + pad + 108);
      dblBtn.on('pointertap', () => {
        if (this._adBusy) return;
        if (have <= 0) {
          AudioManager.play('ui_deny');
          Platform.showToast('先把这道菜做出来放冰箱，就能双倍交单！');
          return;
        }
        this._adBusy = true;
        Platform.showRewardedVideo(
          'order_double',
          () => {
            this._adBusy = false;
            submitNormal(true);
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      root.addChild(dblBtn);
    }
    return root;
  }

  private _dishTile(order: NeighborOrder, x: number, y: number, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const plate = new PIXI.Graphics();
    plate.lineStyle(2, LINE, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(x, y, size, size, 14);
    plate.endFill();
    root.addChild(plate);
    const dishTex = dishTexture(order.recipeId);
    if (isTextureReady(dishTex)) {
      const dish = new PIXI.Sprite(dishTex);
      fitSpriteInBox(dish, size - 10, size - 10);
      dish.anchor.set(0.5);
      dish.position.set(x + size / 2, y + size / 2);
      dish.eventMode = 'none';
      root.addChild(dish);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      const view = inspectFromRecipe(order.recipeId);
      if (!view) return;
      AudioManager.play('ui_click');
      this._inspect = view;
      this.relayout();
    });
    return root;
  }

  private _needTile(x: number, y: number, size: number, iconId: string, have: number, need: number): PIXI.Container {
    const root = new PIXI.Container();
    const plate = new PIXI.Graphics();
    plate.lineStyle(2, LINE, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(x, y, size, size, 12);
    plate.endFill();
    root.addChild(plate);
    const iconTex = itemTexture(iconId);
    if (isTextureReady(iconTex)) {
      const icon = new PIXI.Sprite(iconTex);
      fitSpriteInBox(icon, size - 8, size - 8);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    }

    const count = makeLabel(`${have}/${need}`, 16, TERRACOTTA, { fontWeight: '700' });
    count.anchor.set(0.5, 0);
    count.position.set(x + size / 2, y + size + 2);
    root.addChild(count);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size + 20);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      const view = inspectFromItem(iconId);
      if (!view) return;
      AudioManager.play('ui_click');
      this._inspect = view;
      this.relayout();
    });
    return root;
  }

  private _armTimer(): void {
    this._clearTimer();
    this._timer = globalThis.setInterval(() => {
      if (!this._isOpen || this._inspect) return;
      KitchenManager.sweepNeighborOrders();
      this.relayout();
    }, 1000) as unknown as number;
  }

  private _clearTimer(): void {
    if (this._timer) globalThis.clearInterval?.(this._timer);
    this._timer = 0;
  }
}
