import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  formatOrderRemain,
  neighborNpc,
  neighborOrderReward,
  neighborRewardChips,
  recipeById,
  recipeNeeds,
  recipeUnlockView,
  type NeighborOrder,
} from '@/sim';
import { fillRect, makeLabel, makeRewardStrip, makeSlicedButton } from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  whenTextureReady,
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
  private _root = new PIXI.Container();
  private _timer = 0;
  private _inspect: ItemInspectView | null = null;

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
    this._armTimer();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
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
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.36;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) return;
      this.close();
    });
    this._root.addChild(dim);

    const rowH = 200;
    const boxW = w - 40;
    const headH = 118;
    const footH = 72;
    const boxH = headH + orders.length * (rowH + 14) + footH;
    const x = 20;
    const y = Math.round(Math.max(Game.safeTop + 16, (h - boxH) / 2));

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
    const hint = makeLabel('做好了当场结，菜你留着。街坊有时还会拿家里余的换。', 18, MUTED, {
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
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
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
        onReady: () => {
          if (this._isOpen) this.relayout();
        },
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

    const npc = neighborNpc(order.npcId);
    const recipe = recipeById(order.recipeId);
    const view = recipeUnlockView(KitchenManager.save);
    const pad = 20;
    const face = 92;
    const faceX = x + pad;
    const faceY = y + Math.round((height - face) / 2);
    whenTextureReady(npc.portrait, () => {
      if (this._isOpen) this.relayout();
    });
    const facePlate = new PIXI.Graphics();
    facePlate.beginFill(CREAM);
    facePlate.drawRoundedRect(faceX, faceY, face, face, 16);
    facePlate.endFill();
    root.addChild(facePlate);
    const tex = gameTexture(npc.portrait);
    if (isTextureReady(tex)) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRoundedRect(faceX, faceY, face, face, 16);
      mask.endFill();
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, face, face);
      spr.anchor.set(0.5);
      spr.position.set(faceX + face / 2, faceY + face / 2);
      spr.mask = mask;
      spr.eventMode = 'none';
      root.addChild(mask, spr);
    } else {
      const fallback = new PIXI.Graphics();
      fillRect(fallback, faceX, faceY, face, face, TERRACOTTA, 16);
      root.addChild(fallback);
    }
    const faceFrame = new PIXI.Graphics();
    faceFrame.lineStyle(3, WALNUT, 1);
    faceFrame.drawRoundedRect(faceX, faceY, face, face, 16);
    root.addChild(faceFrame);

    const drop = makeSlicedButton({
      label: '放弃',
      width: 112,
      height: 44,
      skin: 'cream',
      textColor: INK,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    drop.position.set(x + width - 132, y + pad);
    drop.on('pointertap', () => {
      KitchenManager.abandonNeighborOrder(order.id);
      this._inspect = null;
      if (this._isOpen) this.relayout();
    });
    root.addChild(drop);

    const colX = faceX + face + 18;
    const dishSize = 72;
    root.addChild(this._dishTile(order, colX, y + Math.round((height - dishSize) / 2), dishSize));

    const textX = colX + dishSize + 16;
    const name = makeLabel(`${npc.name}要的${recipe?.name ?? '菜'}`, 24, INK, { fontWeight: '700' });
    name.position.set(textX, y + pad + 4);
    root.addChild(name);
    const remain = makeLabel(formatOrderRemain(order.expiresAt - now), 20, GOLD, { fontWeight: '700' });
    remain.position.set(textX, y + pad + 40);
    root.addChild(remain);

    const metaY = y + pad + 96;
    const missing = recipeNeeds(view, order.recipeId).filter((row) => row.have < row.need);
    let usedX = textX;
    if (missing.length) {
      const lack = makeLabel('还缺', 20, MUTED);
      lack.anchor.set(0, 0.5);
      lack.position.set(textX, metaY + 22);
      root.addChild(lack);
      usedX = textX + Math.ceil(lack.width) + 12;
      for (const row of missing) {
        root.addChild(this._needTile(usedX, metaY, 48, row.iconId, row.have, row.need));
        usedX += 58;
      }
    } else {
      const ready = makeLabel('冰箱里已经齐了，做了就给。', 20, MUTED);
      ready.position.set(textX, metaY + 14);
      root.addChild(ready);
      usedX = textX + Math.ceil(ready.width);
    }

    const chips = neighborRewardChips(neighborOrderReward(order));
    if (chips.length) {
      const strip = makeRewardStrip(chips, () => {
        if (this._isOpen) this.relayout();
      }, '做成给', 'paper');
      const stripX = x + width - pad - strip.width;
      strip.position.set(Math.max(usedX + 24, stripX), metaY + 4);
      root.addChild(strip);
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
    const path = `subpkg_images/dish_${order.recipeId}.png`;
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    const dish = new PIXI.Sprite(dishTexture(order.recipeId));
    fitSpriteInBox(dish, size - 10, size - 10);
    dish.anchor.set(0.5);
    dish.position.set(x + size / 2, y + size / 2);
    dish.eventMode = 'none';
    root.addChild(dish);

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
    const path = `subpkg_images/${iconId}.png`;
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    const icon = new PIXI.Sprite(itemTexture(iconId));
    fitSpriteInBox(icon, size - 8, size - 8);
    icon.anchor.set(0.5);
    icon.position.set(x + size / 2, y + size / 2);
    icon.eventMode = 'none';
    root.addChild(icon);

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
