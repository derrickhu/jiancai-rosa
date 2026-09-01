import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  formatOrderRemain,
  missingNeedHint,
  neighborNpc,
  recipeById,
  recipeUnlockView,
  type NeighborOrder,
} from '@/sim';
import { fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

const INK = 0xF4EFE6;
const MUTED = 0xC9B8A4;
const TERRACOTTA = 0xC46A3A;

export class OrderPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _timer = 0;

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
    this._armTimer();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._clearTimer();
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;
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
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.5;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const rowH = 168;
    const boxW = w - 48;
    const boxH = 108 + orders.length * (rowH + 12) + 72;
    const x = 24;
    const y = Math.round(Math.max(Game.safeTop + 24, (h - boxH) / 2));

    const panel = new PIXI.Graphics();
    fillRect(panel, x, y, boxW, boxH, 0x3A3228, 20);
    panel.eventMode = 'static';
    panel.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(panel);
    const inner = new PIXI.Graphics();
    fillRect(inner, x + 12, y + 12, boxW - 24, boxH - 24, 0x2C261F, 14);
    inner.alpha = 0.86;
    this._root.addChild(inner);

    const title = makeLabel('街坊点菜', 32, INK, { fontWeight: '700' });
    title.position.set(x + 36, y + 28);
    this._root.addChild(title);
    const hint = makeLabel('做出来当场多给一笔，菜还在冰箱里。', 20, MUTED);
    hint.position.set(x + 36, y + 68);
    this._root.addChild(hint);

    orders.forEach((order, i) => {
      this._root.addChild(this._row(order, x + 28, y + 108 + i * (rowH + 12), boxW - 56, rowH, now));
    });

    const close = makeSlicedButton({
      label: '关掉',
      width: boxW - 56,
      height: 56,
      skin: 'cream',
      textColor: 0x3A3228,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    close.position.set(x + 28, y + boxH - 76);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);
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
    fillRect(bg, x, y, width, height, 0x4A3A28, 14);
    root.addChild(bg);

    const npc = neighborNpc(order.npcId);
    const recipe = recipeById(order.recipeId);
    const view = recipeUnlockView(KitchenManager.save);
    const face = 96;
    whenTextureReady(npc.portrait, () => {
      if (this._isOpen) this.relayout();
    });
    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRoundedRect(x + 14, y + 16, face, face, 16);
      mask.endFill();
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, face, face);
      spr.anchor.set(0.5);
      spr.position.set(x + 14 + face / 2, y + 16 + face / 2);
      spr.mask = mask;
      spr.eventMode = 'none';
      root.addChild(mask, spr);
    } else {
      const fallback = new PIXI.Graphics();
      fillRect(fallback, x + 14, y + 16, face, face, TERRACOTTA, 16);
      root.addChild(fallback);
    }

    const dishPath = `subpkg_images/dish_${order.recipeId}.png`;
    whenTextureReady(dishPath, () => {
      if (this._isOpen) this.relayout();
    });
    const dish = new PIXI.Sprite(dishTexture(order.recipeId));
    fitSpriteInBox(dish, 44, 44);
    dish.anchor.set(0, 0.5);
    dish.position.set(x + 126, y + 36);
    dish.eventMode = 'none';
    root.addChild(dish);

    const name = makeLabel(`${npc.name}要的${recipe?.name ?? '菜'}`, 24, INK, { fontWeight: '700' });
    name.position.set(x + 176, y + 20);
    root.addChild(name);
    const remain = makeLabel(formatOrderRemain(order.expiresAt - now), 20, 0xF2C14D, { fontWeight: '700' });
    remain.position.set(x + 176, y + 54);
    root.addChild(remain);
    const lack = makeLabel(missingNeedHint(view, order.recipeId), 20, MUTED);
    lack.position.set(x + 126, y + 86);
    root.addChild(lack);

    const drop = makeSlicedButton({
      label: '放弃',
      width: 120,
      height: 44,
      skin: 'cream',
      textColor: 0x3A3228,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    drop.position.set(x + width - 134, y + height - 56);
    drop.on('pointertap', () => {
      KitchenManager.abandonNeighborOrder(order.id);
      if (this._isOpen) this.relayout();
    });
    root.addChild(drop);
    return root;
  }

  private _armTimer(): void {
    this._clearTimer();
    this._timer = globalThis.setInterval(() => {
      if (!this._isOpen) return;
      KitchenManager.sweepNeighborOrders();
      this.relayout();
    }, 1000) as unknown as number;
  }

  private _clearTimer(): void {
    if (this._timer) globalThis.clearInterval?.(this._timer);
    this._timer = 0;
  }
}
