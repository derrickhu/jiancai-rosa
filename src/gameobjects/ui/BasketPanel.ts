import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { EventBus } from '@/core/EventBus';
import { Platform } from '@/core/PlatformService';
import { EV } from '@/config/events';
import { RunManager } from '@/managers/RunManager';
import {
  occupiedCells,
  validPlacements,
  footprint,
  getItem,
  displayName,
  shapeLabel,
  type BasketItem,
  type PileItem,
} from '@/sim';
import { fillRect, makeButton, makeLabel } from '@/utils/ui';
import { itemTexture } from '@/utils/assets';

export class BasketPanel extends PIXI.Container {
  _isOpen = false;
  placingUid: string | null = null;
  selectedUid: string | null = null;
  placingRot: 0 | 1 = 0;
  private _root = new PIXI.Container();
  private _unsub: (() => void) | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 20;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(placingUid?: string): void {
    this.placingUid = placingUid ?? null;
    this.selectedUid = null;
    this.placingRot = 0;
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    this._unsub?.();
    const handler = () => this.relayout();
    EventBus.on(EV.basketChanged, handler);
    this._unsub = () => EventBus.off(EV.basketChanged, handler);
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this.placingUid = null;
    this._unsub?.();
    this._unsub = null;
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.62;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    const basket = RunManager.basket;
    const pile = this._findPlacing();
    const placingDef = pile ? getItem(pile.defId) : null;

    const btnH = 200;
    const maxGridW = w - 64;
    const maxGridH = h - Game.safeTop - btnH - 160;
    const cell = Math.max(40, Math.min(68, Math.floor(maxGridW / basket.cols), Math.floor(maxGridH / basket.rows)));
    const gridW = basket.cols * cell;
    const gridH = basket.rows * cell;
    const panelW = Math.min(w - 24, Math.max(gridW + 40, 680));
    const panelH = Math.min(h - Game.safeTop - 16, gridH + btnH + 120);
    const panelX = (w - panelW) / 2;
    const panelY = Game.safeTop + 8;

    const panel = new PIXI.Graphics();
    fillRect(panel, panelX, panelY, panelW, panelH, 0x3A3228, 18);
    panel.eventMode = 'none';
    this._root.addChild(panel);

    const title = makeLabel(this.placingUid ? '点绿色格放下' : '菜篮', 30, 0xF4EFE6);
    title.position.set(panelX + 20, panelY + 14);
    this._root.addChild(title);

    const hint = makeLabel(
      this.placingUid && placingDef
        ? `正在摆：${displayName(placingDef.id, pile!.inspected, pile!.quality)}  ${shapeLabel(placingDef.id, this.placingRot)}  ·  绿格可放`
        : `左 ${basket.wetCols} 列湿区` + (basket.insulatedBottom ? ' · 底行保温' : ' · 点格子里的菜可旋转'),
      18,
      0xC9B8A4,
    );
    hint.position.set(panelX + 20, panelY + 52);
    this._root.addChild(hint);

    const gridX = panelX + (panelW - gridW) / 2;
    const gridY = panelY + 88;

    const valid = this.placingUid && placingDef
      ? validPlacements(basket, this.placingUid, placingDef.id, this.placingRot)
      : [];

    const validSet = new Set(valid.map((v) => `${v.x},${v.y}`));

    for (let y = 0; y < basket.rows; y++) {
      for (let x = 0; x < basket.cols; x++) {
        const wet = x < basket.wetCols || (basket.insulatedBottom && y === basket.rows - 1);
        const canDrop = validSet.has(`${x},${y}`);
        const cellG = new PIXI.Graphics();
        fillRect(cellG, gridX + x * cell, gridY + y * cell, cell - 3, cell - 3, canDrop ? 0x3D7A3A : wet ? 0x2A4A5A : 0x5A4A38, 6);
        if (canDrop) {
          cellG.lineStyle(3, 0x8FCB6B);
          cellG.drawRoundedRect(gridX + x * cell, gridY + y * cell, cell - 3, cell - 3, 6);
          cellG.lineStyle(0);
          const mark = makeLabel('放', 16, 0xE8FFD0);
          mark.position.set(gridX + x * cell + 8, gridY + y * cell + 8);
          this._root.addChild(cellG);
          this._root.addChild(mark);
          cellG.eventMode = 'static';
          cellG.cursor = 'pointer';
          cellG.hitArea = new PIXI.Rectangle(gridX + x * cell, gridY + y * cell, cell - 3, cell - 3);
          const ox = x;
          const oy = y;
          cellG.on('pointertap', () => this._dropAt(ox, oy));
        } else {
          cellG.eventMode = 'none';
          this._root.addChild(cellG);
        }
      }
    }

    if (this.placingUid && placingDef && valid.length === 0) {
      const none = makeLabel('这个方向放不下，点「旋转」换个方向', 20, 0xE07A5F);
      none.position.set(panelX + 20, gridY + gridH + 8);
      this._root.addChild(none);
    }

    for (const item of basket.items) {
      const def = getItem(item.defId);
      const cells = occupiedCells(item);
      const minX = Math.min(...cells.map((c) => c.x));
      const minY = Math.min(...cells.map((c) => c.y));
      const { w: fw, h: fh } = footprint(def, item.rot);
      const gx = new PIXI.Graphics();
      const selected = item.uid === this.selectedUid;
      gx.lineStyle(selected ? 4 : item.pinned ? 3 : 1, selected ? 0xF4C430 : 0x1A140F, 0.8);
      fillRect(gx, gridX + minX * cell, gridY + minY * cell, fw * cell - 3, fh * cell - 3, def.color, 8);
      for (let row = 0; row < fh; row++) {
        for (let col = 0; col < fw; col++) {
          gx.lineStyle(1, 0x1A140F, 0.25);
          gx.drawRoundedRect(gridX + (minX + col) * cell + 4, gridY + (minY + row) * cell + 4, cell - 11, cell - 11, 4);
        }
      }
      gx.eventMode = 'static';
      gx.cursor = 'pointer';
      gx.hitArea = new PIXI.Rectangle(gridX + minX * cell, gridY + minY * cell, fw * cell - 3, fh * cell - 3);
      gx.on('pointertap', () => {
        this.selectedUid = item.uid;
        this.relayout();
      });
      this._root.addChild(gx);
      const icon = new PIXI.Sprite(itemTexture(item.defId));
      icon.width = fw * cell - 16;
      icon.height = fh * cell - 16;
      icon.position.set(gridX + minX * cell + 6, gridY + minY * cell + 4);
      icon.eventMode = 'none';
      this._root.addChild(icon);
      const t = makeLabel(`${displayName(item.defId, item.inspected, item.quality)}\n${shapeLabel(item.defId, item.rot)}`, 15, 0xFFF8F0, {
        align: 'center',
        wordWrap: true,
        wordWrapWidth: fw * cell - 12,
      });
      t.anchor.set(0.5);
      t.position.set(gridX + minX * cell + (fw * cell) / 2, gridY + minY * cell + (fh * cell) / 2);
      this._root.addChild(t);
    }

    const btnY = panelY + panelH - 132;
    if (this.placingUid) {
      const rot = makeButton(`旋转 ${placingDef ? shapeLabel(placingDef.id, this.placingRot === 0 ? 1 : 0) : ''}`, 220, 56, 0x5C6B4A);
      rot.position.set(panelX + 20, btnY);
      rot.on('pointertap', () => {
        this.placingRot = this.placingRot === 0 ? 1 : 0;
        this.relayout();
      });
      this._root.addChild(rot);
    }

    const selected = basket.items.find((it) => it.uid === this.selectedUid);
    if (selected && !this.placingUid) {
      const rot = makeButton('旋转', 140, 52, 0x5C6B4A);
      rot.position.set(panelX + 20, btnY);
      rot.on('pointertap', () => this.rotateSelected(selected));
      this._root.addChild(rot);

      const pin = makeButton(selected.pinned ? '取消压底' : '压篮底', 160, 52, 0x4A6B7A);
      pin.position.set(panelX + 172, btnY);
      pin.on('pointertap', () => {
        RunManager.togglePin(selected.uid);
        this.relayout();
      });
      this._root.addChild(pin);

      const drop = makeButton('丢掉', 140, 52, 0x8A3B32);
      drop.position.set(panelX + 344, btnY);
      drop.on('pointertap', () => {
        RunManager.discard(selected.uid);
        this.selectedUid = null;
        this.relayout();
      });
      this._root.addChild(drop);
    }

    const close = makeButton(this.placingUid ? '先不放了' : '关闭', panelW - 40, 56, 0xC46A3A);
    close.position.set(panelX + 20, panelY + panelH - 68);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);
  }

  private _dropAt(x: number, y: number): void {
    if (!this.placingUid) return;
    const err = RunManager.dropFromPileToCell(this.placingUid, x, y, this.placingRot);
    if (err) {
      Platform.showToast(err);
      return;
    }
    this.placingUid = null;
    this.relayout();
  }

  private _findPlacing(): PileItem | undefined {
    if (!this.placingUid) return undefined;
    const fromCurrent = RunManager.currentPile().find((it) => it.uid === this.placingUid);
    if (fromCurrent) return fromCurrent;
    if (!RunManager.run) return undefined;
    for (const list of Object.values(RunManager.run.piles)) {
      const found = list.find((it) => it.uid === this.placingUid);
      if (found) return found;
    }
    return undefined;
  }

  private rotateSelected(item: BasketItem): void {
    const nextRot: 0 | 1 = item.rot === 0 ? 1 : 0;
    const err = RunManager.tryManualPlace({ ...item, rot: nextRot });
    if (err) {
      Platform.showToast(err);
      return;
    }
    this.relayout();
  }
}
