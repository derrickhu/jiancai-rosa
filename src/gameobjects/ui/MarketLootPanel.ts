import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  getItem,
  getMarket,
  getSpecialMarket,
  marketLootRows,
  specialLootIds,
  type MarketId,
  type SpecialMarketId,
} from '@/sim';
import { VerticalScroller } from '@/utils/scroll';
import {
  fitSpriteInBox,
  isTextureReady,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import {
  UI_KIT,
  drawItemSlotBox,
  drawSectionTray,
  fillRect,
  makeArtisanShell,
} from '@/utils/ui';
import { inspectFromItem, makeItemInspectCard, type ItemInspectView } from './ItemInspectCard';

const COLS = 5;
const CELL = 88;
const GAP = 10;

export class MarketLootPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _marketId: MarketId | null = null;
  private _specialId: SpecialMarketId | null = null;
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
    this._specialId = null;
    this._present(marketId, null);
  }

  openSpecial(specialId: SpecialMarketId): void {
    this._marketId = null;
    this._present(null, specialId);
  }

  private _present(marketId: MarketId | null, specialId: SpecialMarketId | null): void {
    this._marketId = marketId;
    this._specialId = specialId;
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
    this._specialId = null;
    this._inspect = null;
    this._scroller.disable();
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    const marketId = this._marketId;
    const specialId = this._specialId;
    if (!this._isOpen || (!marketId && !specialId)) return;

    watchTextures([UI_KIT.headerRibbon, UI_KIT.closeRound], () => {
      if (this._isOpen) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) {
        this._inspect = null;
        this.relayout();
        return;
      }
      this.close();
    });
    this._root.addChild(dim);

    const rows = specialId
      ? specialLootIds(getSpecialMarket(specialId)).map((id) => ({ id }))
      : marketLootRows(marketId!, KitchenManager.save.level);
    const gridW = COLS * CELL + (COLS - 1) * GAP;
    const cardW = Math.min(584, w - 44);
    const innerW = cardW - 60;
    const cols = innerW >= gridW ? COLS : Math.max(3, Math.floor((innerW + GAP) / (CELL + GAP)));
    const usedGridW = cols * CELL + (cols - 1) * GAP;
    const lineCount = Math.max(1, Math.ceil(rows.length / cols));
    const gridH = lineCount * CELL + Math.max(0, lineCount - 1) * GAP;
    const listH = Math.min(gridH + 20, Math.max(CELL * 2 + GAP + 20, Math.round(h * 0.44)));
    const listTop = 94;
    const cardH = listTop + listH + 28;
    const x = Math.round((w - cardW) / 2);
    const y = Math.round(Math.max(Game.safeTop + 26, (h - cardH) / 2));

    const titleText = specialId ? getSpecialMarket(specialId).name : getMarket(marketId!).name;
    const subText = specialId ? '专场摊头产出 · 点图标查详情' : '本集市可捡好货 · 点图标查详情';

    const { shell: card } = makeArtisanShell({
      width: cardW,
      height: cardH,
      title: titleText,
      subtitle: subText,
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this.close(),
    });
    card.position.set(x, y);
    this._root.addChild(card);

    const well = new PIXI.Graphics();
    drawSectionTray(well, 22, listTop, cardW - 44, listH, { radius: 14, tone: 'sand' });
    card.addChild(well);

    const list = new PIXI.Container();
    const gridX = Math.round((cardW - usedGridW) / 2);
    rows.forEach((row, i) => {
      const cx = gridX + (i % cols) * (CELL + GAP);
      const cy = 10 + Math.floor(i / cols) * (CELL + GAP);
      list.addChild(this._cell(cx, cy, CELL, row.id));
    });
    list.position.set(0, listTop);
    card.addChild(list);

    const maxScroll = Math.max(0, gridH + 20 - listH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      fillRect(mask, 24, listTop + 2, cardW - 48, listH - 4, 0xffffff, 12);
      mask.eventMode = 'none';
      card.addChild(mask);
      list.mask = mask;
    }
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: { x: x + 22, y: y + listTop, w: cardW - 44, h: listH },
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
    drawItemSlotBox(bg, x, y, size, size, { radius: 11, rarity: def.rarity });
    root.addChild(bg);

    const path = resolveItemAssetPath(id);
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
      AudioManager.play('ui_click');
      this._inspect = inspectFromItem(id);
      this.relayout();
    });
    return root;
  }
}
