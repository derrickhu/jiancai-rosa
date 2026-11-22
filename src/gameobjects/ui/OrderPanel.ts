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
import {
  P0_ART,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawItemSlotBox,
  drawSectionTray,
  fillRect,
  makeAdButton,
  makeArtisanShell,
  makeLabel,
  makeRewardStrip,
  makeSlicedButton,
  makeSlotBadge,
} from '@/utils/ui';
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

const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const TERRACOTTA = UI_PALETTE.terracotta;
const OLIVE = UI_PALETTE.olive;
const GOLD = 0xB87910;

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
      [
        UI_KIT.headerRibbon,
        UI_KIT.closeRound,
        UI_KIT.btnOlive,
        UI_KIT.btnGold,
        ...orderPanelPaths(KitchenManager.save, KitchenManager.liveNeighborOrders()),
        P0_ART.adClapper,
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
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) {
        this._inspect = null;
        this.relayout();
        return;
      }
      if (!this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const rowH = 260;
    const rowGap = 12;
    const boxW = Math.min(w - 30, 710);
    const padX = 24;
    const contentTop = 66;
    const boxH = contentTop + orders.length * rowH + (orders.length - 1) * rowGap + 26;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 22, (h - boxH) / 2 + 6));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '街 坊 点 菜',
      onReady: this._scheduleRelayout,
      closeSilent: true,
      onClose: () => {
        if (!this._adBusy) this.close();
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    orders.forEach((order, i) => {
      shell.addChild(this._row(order, padX, contentTop + i * (rowH + rowGap), boxW - padX * 2, rowH, now));
    });

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onClose: () => {
          AudioManager.play('ui_close');
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
    const save = KitchenManager.save;
    const npc = neighborNpc(order.npcId);
    const recipe = recipeById(order.recipeId);
    const view = recipeUnlockView(save);
    const have = fridgeDishQty(save.fridge, order.recipeId);

    const headerH = 44;
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, {
      radius: 16,
      tone: have > 0 ? 'gold' : 'ivory',
      headerH,
    });
    root.addChild(bg);

    const canRefresh = canUseDailyAd(save, 'order_refresh', now);
    const refreshLeft = dailyAdLeft(save, 'order_refresh', now);
    const canDouble = canUseDailyAd(save, 'order_double', now);
    const doubleLeft = dailyAdLeft(save, 'order_double', now);

    // Structured top header bar: Dish order title on left + Timer tag & Abandon link on right
    const name = makeLabel(`${npc.name}点：${recipe?.name ?? '家常菜'}`, 21, INK, { fontWeight: '700' });
    name.anchor.set(0, 0.5);
    name.position.set(x + 16, y + headerH / 2 + 1);
    root.addChild(name);

    const remainTxt = `⏱ ${formatOrderRemain(order.expiresAt - now)}`;
    const remainLbl = makeLabel(remainTxt, 15, 0xFFFDF8, { fontWeight: '700' });
    const rPillW = Math.ceil(remainLbl.width) + 18;
    const rPillH = 26;
    const rPill = new PIXI.Graphics();
    rPill.beginFill(0x7A5B40, 1);
    rPill.drawRoundedRect(0, 0, rPillW, rPillH, rPillH / 2);
    rPill.endFill();
    remainLbl.anchor.set(0.5);
    remainLbl.position.set(rPillW / 2, rPillH / 2);
    const rWrap = new PIXI.Container();
    rWrap.addChild(rPill, remainLbl);
    const rightMetaX = x + width - (canRefresh ? rPillW + 94 : rPillW + 14);
    rWrap.position.set(rightMetaX, y + Math.round((headerH - rPillH) / 2) + 1);
    root.addChild(rWrap);

    if (canRefresh) {
      const dropLink = makeLabel('放弃此单', 15, MUTED, { fontWeight: '700' });
      dropLink.anchor.set(0, 0.5);
      dropLink.position.set(rightMetaX + rPillW + 10, y + headerH / 2 + 1);
      dropLink.eventMode = 'static';
      dropLink.cursor = 'pointer';
      dropLink.hitArea = new PIXI.Rectangle(-6, -14, dropLink.width + 12, 28);
      dropLink.on('pointertap', (e) => {
        e.stopPropagation();
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      root.addChild(dropLink);
    }

    const bodyTop = y + headerH + 10;
    const faceW = 128;
    const faceH = height - headerH - 20;
    const faceX = x + 12;

    // Framed recessed portrait card slot
    const arch = new PIXI.Graphics();
    drawSectionTray(arch, faceX, bodyTop, faceW, faceH, { radius: 13, tone: 'sand' });
    root.addChild(arch);

    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, faceW - 8, faceH - 6);
      spr.anchor.set(0.5, 1);
      spr.position.set(faceX + faceW / 2, bodyTop + faceH - 2);
      spr.eventMode = 'none';
      const clip = new PIXI.Graphics();
      clip.beginFill(0xffffff);
      clip.drawRoundedRect(faceX + 2, bodyTop + 2, faceW - 4, faceH - 4, 11);
      clip.endFill();
      spr.mask = clip;
      root.addChild(clip, spr);
    }

    const actW = 146;
    const actX = x + width - actW - 12;

    if (canRefresh) {
      const refreshBtn = makeAdButton({
        label: '换一单',
        width: actW,
        height: 42,
        skin: 'cream',
        textColor: INK,
        badge: `免冷·${refreshLeft}`,
        onReady: this._scheduleRelayout,
      });
      refreshBtn.position.set(actX, bodyTop + 4);
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
      drop.position.set(actX, bodyTop + 4);
      drop.on('pointertap', () => {
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      root.addChild(drop);
    }

    // Center Unified Recessed Tray: Dish Tile + Required Ingredients / Ready Status
    const colX = faceX + faceW + 12;
    const trayW = actX - colX - 12;
    const trayH = 82;
    const trayY = bodyTop + 4;
    const tray = new PIXI.Graphics();
    drawSectionTray(tray, colX, trayY, trayW, trayH, {
      radius: 13,
      tone: have > 0 ? 'sage' : 'sand',
    });
    root.addChild(tray);

    const dishSize = 66;
    root.addChild(this._dishTile(order, colX + 8, trayY + 8, dishSize));

    const innerX = colX + 8 + dishSize + 10;
    const missing = recipeNeeds(view, order.recipeId).filter((row) => row.have < row.need);
    if (have > 0) {
      const readyTitle = makeLabel('✓ 菜已备好', 18, OLIVE, { fontWeight: '700' });
      readyTitle.position.set(innerX, trayY + 16);
      const readySub = makeLabel(canDouble ? '可双倍领谢礼' : '点交菜立领赏金', 15, 0x55734A, { fontWeight: '700' });
      readySub.position.set(innerX, trayY + 45);
      root.addChild(readyTitle, readySub);
    } else if (missing.length) {
      const lackTag = makeLabel('缺料', 16, 0x7A5B40, { fontWeight: '700' });
      lackTag.anchor.set(0.5);
      lackTag.position.set(innerX + 18, trayY + trayH / 2);
      root.addChild(lackTag);
      let usedX = innerX + 42;
      const slotS = 62;
      for (const row of missing) {
        if (usedX + slotS > colX + trayW - 6) break;
        root.addChild(this._needTile(usedX, trayY + Math.round((trayH - slotS) / 2), slotS, row.iconId, row.have, row.need));
        usedX += slotS + 6;
      }
    } else {
      const ready = makeLabel('食材齐备', 18, OLIVE, { fontWeight: '700' });
      ready.anchor.set(0, 0.5);
      ready.position.set(innerX, trayY + trayH / 2);
      root.addChild(ready);
      const cook = makeSlicedButton({
        label: '去做菜',
        width: 106,
        height: 42,
        skin: 'terracotta',
        textColor: 0xFFF8F0,
        fontSize: 18,
        onReady: this._scheduleRelayout,
      });
      cook.position.set(innerX + Math.ceil(ready.width) + 10, trayY + Math.round((trayH - 42) / 2));
      cook.on('pointertap', () => {
        this.onCook?.(order.recipeId);
      });
      root.addChild(cook);
    }

    // Bottom Structured Reward Strip aligned cleanly with tray
    const chips = neighborRewardChips(neighborOrderReward(order));
    if (chips.length) {
      const strip = makeRewardStrip(chips, this._scheduleRelayout, '谢礼', 'paper');
      strip.position.set(colX, bodyTop + trayH + 18);
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
      height: 44,
      skin: have > 0 ? 'olive' : 'cream',
      textColor: have > 0 ? 0xFFF8F0 : 0x8A7358,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(actX, bodyTop + 56);
    btn.on('pointertap', () => submitNormal(false));
    root.addChild(btn);

    if (canDouble) {
      const dblBtn = makeAdButton({
        label: '双倍交菜',
        width: actW,
        height: 46,
        skin: 'gold',
        disabled: have <= 0,
        badge: `×2·剩${doubleLeft}`,
        onReady: this._scheduleRelayout,
      });
      dblBtn.position.set(actX, bodyTop + 112);
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
    const recipe = recipeById(order.recipeId);
    const plate = new PIXI.Graphics();
    drawItemSlotBox(plate, x, y, size, size, { radius: 11, rarity: recipe?.rarity ?? 'common' });
    root.addChild(plate);
    const dishTex = dishTexture(order.recipeId);
    if (isTextureReady(dishTex)) {
      const dish = new PIXI.Sprite(dishTex);
      fitSpriteInBox(dish, size - 10, size - 10);
      dish.anchor.set(0.5);
      dish.position.set(x + size / 2, y + size / 2 - 1);
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
    drawItemSlotBox(plate, x, y, size, size, { radius: 10, dimmed: have < need });
    root.addChild(plate);
    const iconTex = itemTexture(iconId);
    if (isTextureReady(iconTex)) {
      const icon = new PIXI.Sprite(iconTex);
      fitSpriteInBox(icon, size - 12, size - 12);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2 - 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    }

    const badge = makeSlotBadge(`${have}/${need}`, have >= need ? 'olive' : 'lack', 13);
    badge.node.position.set(x + size - badge.w - 2, y + size - badge.h - 2);
    root.addChild(badge.node);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
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
