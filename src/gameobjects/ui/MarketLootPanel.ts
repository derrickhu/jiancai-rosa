import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  getItem,
  getMarket,
  marketLootRows,
  type MarketId,
} from '@/sim';
import { VerticalScroller } from '@/utils/scroll';
import { fitSpriteInBox, imgPath, isTextureReady, itemTexture, whenTextureReady } from '@/utils/assets';
import { drawRarityFrame, fillRect, makeLabel } from '@/utils/ui';
import { inspectFromItem, makeItemInspectCard, type ItemInspectView } from './ItemInspectCard';

const INK = 0x2A2018;
const CREAM = 0xF6EDE0;
const PAPER = 0xFFF8F0;
const MUTED = 0x8A6A40;
const COLS = 5;
const CELL = 88;
const GAP = 8;

export class MarketLootPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _marketId: MarketId | null = null;
  private _inspect: ItemInspectView | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 26;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen && !this._inspect });
  }

  open(marketId: MarketId): void {
    this._marketId = marketId;
    this._inspect = null;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._marketId = null;
    this._inspect = null;
    this._scroller.disable();
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    const marketId = this._marketId;
    if (!this._isOpen || !marketId) return;

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.35;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const rows = marketLootRows(marketId, KitchenManager.save.level);
    const gridW = COLS * CELL + (COLS - 1) * GAP;
    const cardW = Math.min(560, w - 56);
    const innerW = cardW - 48;
    const cols = innerW >= gridW ? COLS : Math.max(3, Math.floor((innerW + GAP) / (CELL + GAP)));
    const usedGridW = cols * CELL + (cols - 1) * GAP;
    const lineCount = Math.max(1, Math.ceil(rows.length / cols));
    const gridH = lineCount * CELL + Math.max(0, lineCount - 1) * GAP;
    const listH = Math.min(gridH, Math.max(CELL * 2 + GAP, h * 0.42));
    const cardH = 108 + listH + 20;
    const x = (w - cardW) / 2;
    const y = Math.round((h - cardH) / 2);

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
    card.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(card);

    const plate = new PIXI.Graphics();
    plate.lineStyle(4, INK, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(0, 0, cardW, cardH, 22);
    plate.endFill();
    plate.beginFill(PAPER);
    plate.drawRoundedRect(12, 12, cardW - 24, cardH - 24, 16);
    plate.endFill();
    card.addChild(plate);

    const market = getMarket(marketId);
    const title = makeLabel(market.name, 28, INK, { fontWeight: '700' });
    title.position.set(28, 26);
    card.addChild(title);
    const hint = makeLabel('这摊能翻到这些。', 18, MUTED, { fontWeight: '600' });
    hint.position.set(28, 62);
    card.addChild(hint);

    const listTop = 96;
    const list = new PIXI.Container();
    const gridX = (cardW - usedGridW) / 2;
    rows.forEach((row, i) => {
      const cx = gridX + (i % cols) * (CELL + GAP);
      const cy = Math.floor(i / cols) * (CELL + GAP);
      list.addChild(this._cell(cx, cy, CELL, row.id));
    });
    list.position.set(0, listTop);
    card.addChild(list);
    const maxScroll = Math.max(0, gridH - listH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      fillRect(mask, 20, listTop, cardW - 40, listH, 0xffffff);
      mask.eventMode = 'none';
      card.addChild(mask);
      list.mask = mask;
    }
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: { x: x + 20, y: y + listTop, w: cardW - 40, h: listH },
    });

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

  private _cell(x: number, y: number, size: number, id: string): PIXI.Container {
    const root = new PIXI.Container();
    const def = getItem(id);
    const bg = new PIXI.Graphics();
    bg.beginFill(PAPER, 0.96);
    bg.drawRoundedRect(x, y, size, size, 12);
    bg.endFill();
    drawRarityFrame(bg, x + 2, y + 2, size - 4, size - 4, def.rarity, { radius: 12 });
    root.addChild(bg);

    const path = imgPath(`${id}.png`);
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    const tex = itemTexture(id);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size - 16, size - 16);
      spr.anchor.set(0.5);
      spr.position.set(x + size / 2, y + size / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._scroller.moved) return;
      this._inspect = inspectFromItem(id);
      this.relayout();
    });
    return root;
  }
}
