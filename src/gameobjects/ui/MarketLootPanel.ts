import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  getItem,
  getMarket,
  getSpecialMarket,
  marketLootRows,
  rarityLabel,
  rarityStyleOf,
  specialLootIds,
  type MarketId,
  type SpecialMarketId,
} from '@/sim';
import { VerticalScroller } from '@/utils/scroll';
import {
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  UI_KIT,
  fitTextWidth,
  makeText,
} from '@/utils/ui';
import { inspectFromItem, makeItemInspectCard, type ItemInspectView } from './ItemInspectCard';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makePlateItem,
  makeRaritySeal,
  makeSceneRoot,
  sceneArtPaths,
} from './scenePanel';

const WALL = 'subpkg_images/scene_order_wall.png';
const W = 688;
const COLS = 3;
const CELL_H = 178;

export class MarketLootPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _marketId: MarketId | null = null;
  private _specialId: SpecialMarketId | null = null;
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;

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
    this._paintQueued = false;
    this._scroller.disable();
    destroyDisplayChildren(this._root);
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
    destroyDisplayChildren(this._root);
    const marketId = this._marketId;
    const specialId = this._specialId;
    if (!this._isOpen || (!marketId && !specialId)) return;

    const rows = specialId
      ? specialLootIds(getSpecialMarket(specialId)).map((id) => ({ id }))
      : marketLootRows(marketId!, KitchenManager.save.level);

    watchTextures(
      [
        WALL,
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        ...rows.map((r) => resolveItemAssetPath(r.id)),
      ],
      this._scheduleRelayout,
    );

    const lineCount = Math.max(1, Math.ceil(rows.length / COLS));
    const gridH = lineCount * CELL_H;
    const maxVisibleLines = 3.35;
    const listH = Math.min(gridH + 12, Math.round(CELL_H * maxVisibleLines));

    const sheetTop = 144;
    const headerH = 104;
    const sheetBottomPad = 36;
    const sheetH = headerH + listH + sheetBottomPad;
    const panelH = sheetTop + sheetH + 28;

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 52,
      dimAlpha: 0.64,
      onDimTap: () => {
        if (this._inspect) {
          this._inspect = null;
          this.relayout();
          return;
        }
        this.close();
      },
    });

    drawSceneWall(scene, WALL, W, panelH, 160, 110);

    const titleText = specialId ? getSpecialMarket(specialId).name : getMarket(marketId!).name;
    drawPlaqueTitle(scene, titleText, W / 2, -46, 352);
    drawSceneClose(scene, W - 46, -20, () => this.close(), this._scheduleRelayout);

    const sheetX = 26;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 140, 120);

    const headL = 94;
    const headR = W - 94;
    const contentL = 56;
    const contentR = W - 56;
    const contentW = contentR - contentL;

    const headCy = sheetTop + 62;
    const subTitle = makeText(
      'title',
      specialId ? '专场鲜货单' : '本集鲜货单',
      SCENE_INK.ink,
      { size: 30 },
    );
    subTitle.anchor.set(0, 0.5);
    subTitle.position.set(headL, headCy);
    scene.addChild(subTitle);

    const tip = makeText('caption', `共 ${rows.length} 味 · 点碟看详情`, SCENE_INK.muted, { size: 22, fontWeight: '600' });
    tip.anchor.set(1, 0.5);
    tip.position.set(headR, headCy);
    scene.addChild(tip);

    drawInkDivider(scene, contentL, sheetTop + headerH - 12, contentW, 0.52, 11);

    const listTop = sheetTop + headerH;
    const colW = Math.floor(contentW / COLS);
    const viewport = new PIXI.Container();
    const list = new PIXI.Container();
    viewport.addChild(list);
    scene.addChild(viewport);

    rows.forEach((row, i) => {
      const col = i % COLS;
      const r = Math.floor(i / COLS);
      const cx = contentL + col * colW + colW / 2;
      const cy = r * CELL_H + 74;
      list.addChild(this._plateCell(cx, cy, colW, row.id));
    });
    list.position.set(0, listTop);

    const maxScroll = Math.max(0, gridH + 12 - listH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(contentL - 8, listTop, contentW + 16, listH);
      mask.endFill();
      mask.eventMode = 'none';
      scene.addChild(mask);
      viewport.mask = mask;
    }

    const hitTl = toStage(contentL, listTop);
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: {
        x: hitTl.x,
        y: hitTl.y,
        w: contentW * scale,
        h: listH * scale,
      },
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

  private _plateCell(cx: number, cy: number, colW: number, id: string): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(cx, cy);
    const def = getItem(id);
    const style = rarityStyleOf(def.rarity);

    const plate = makePlateItem({
      iconPath: resolveItemAssetPath(id),
      plateW: 132,
      iconSize: 80,
      rarity: def.rarity,
      contourOpts: { selected: def.rarity === 'legendary', thicknessScale: 0.92 },
    });
    root.addChild(plate);

    if (def.rarity !== 'common') {
      const seal = makeRaritySeal(def.rarity, 42, -0.09);
      seal.position.set(48, -36);
      root.addChild(seal);
    }

    const nameColor = def.rarity === 'common' ? SCENE_INK.ink : style.ink;
    const nameLbl = makeText('body', def.name, nameColor, { size: 25, fontWeight: '700' });
    nameLbl.anchor.set(0.5, 0);
    nameLbl.position.set(0, 42);
    fitTextWidth(nameLbl, colW - 14);
    root.addChild(nameLbl);

    const zoneCopy = def.rarity === 'common'
      ? `普通 · ${def.zone === 'wet' ? '湿货' : '干货'} · ${def.w}×${def.h}`
      : `${rarityLabel(def.rarity)} · ${def.zone === 'wet' ? '湿货' : '干货'} · ${def.w}×${def.h}`;
    const zoneLbl = makeText(
      'caption',
      zoneCopy,
      def.rarity === 'common' ? SCENE_INK.muted : style.ink,
      { size: 21 },
    );
    zoneLbl.anchor.set(0.5, 0);
    zoneLbl.position.set(0, 74);
    fitTextWidth(zoneLbl, colW - 10);
    if (def.rarity !== 'common') zoneLbl.alpha = 0.85;
    root.addChild(zoneLbl);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-colW / 2 + 4, -68, colW - 8, CELL_H - 8);
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
