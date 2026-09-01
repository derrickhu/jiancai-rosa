import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { EventBus } from '@/core/EventBus';
import { Platform } from '@/core/PlatformService';
import { EV } from '@/config/events';
import { RunManager, type OutingLoot } from '@/managers/RunManager';
import {
  footprint,
  getItem,
  occupiedCells,
  packStagingLayout,
  previewDrop,
  rarityCell,
  rarityCellAlpha,
  basketCellKind,
  type BasketItem,
  type DropPreview,
  type Quality,
  type Rarity,
} from '@/sim';
import { inspectFromFood, makeItemInspectCard } from './ItemInspectCard';
import { drawRarityFrame, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { fitSpriteInBox, gameTexture, isTextureReady, itemTexture, whenTextureReady } from '@/utils/assets';

const BG = 'subpkg_kitchen/ui_basket_panel.png';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const WALNUT = 0x8B5A2B;
const WET = 0x3A6A72;
const FLEX = 0x8A9A4A;
const OK = 0x5C8A3A;
const SWAP = 0xC48A22;
const BAD = 0xB04A3A;
const STAGE = { x: 0.12, y: 0.082, w: 0.76, h: 0.210 };
const CAVITY = { x: 0.12, y: 0.365, w: 0.76, h: 0.445 };
const FOOTER = { y: 0.830, h: 0.145 };

type DragFrom = 'basket' | 'stage';

export class BasketPanel extends PIXI.Container {
  _isOpen = false;
  placingUid: string | null = null;
  selectedUid: string | null = null;
  private _inspectUid: string | null = null;
  private _rot: 0 | 1 = 0;
  private _root = new PIXI.Container();
  private _ghost = new PIXI.Graphics();
  private _float = new PIXI.Container();
  private _unsub: (() => void) | null = null;
  private _grid = { x: 0, y: 0, cell: 56, cols: 6, rows: 5 };
  private _stageRect = { x: 0, y: 0, w: 0, h: 0 };
  private _scroller: VerticalScroller;
  private _stageScroller: VerticalScroller;
  private _unlocking = false;
  private _drag: {
    uid: string;
    from: DragFrom;
    rot: 0 | 1;
    defId: string;
    ox: number;
    oy: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    liftAt: number;
    gx: number;
    gy: number;
    preview: DropPreview;
    source: PIXI.Container | null;
  } | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 20;
    this.addChild(this._root);
    this.addChild(this._ghost);
    this.addChild(this._float);
    this.eventMode = 'static';
    this.on('globalpointermove', (e) => this._onMove(e.global.x, e.global.y));
    this.on('pointerup', (e) => this._onUp(e.global.x, e.global.y));
    this.on('pointerupoutside', (e) => this._onUp(e.global.x, e.global.y));
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen && !this._drag });
    this._stageScroller = new VerticalScroller(this, { visible: () => this._isOpen && !this._drag });
  }

  open(placingUid?: string): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this.placingUid = placingUid ?? null;
    this.selectedUid = placingUid ?? null;
    this._inspectUid = null;
    this._rot = 0;
    this._drag = null;
    this._unlocking = false;
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this._stageScroller.reset();
    this._stageScroller.enable();
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    OverlayManager.container.on('pointerup', this._boundUp);
    OverlayManager.container.on('pointerupoutside', this._boundUp);
    try { Platform.api?.onTouchMove?.(this._onWxMove); } catch (_) {}
    try { Platform.api?.onTouchEnd?.(this._onWxEnd); } catch (_) {}
    try { Platform.api?.onTouchCancel?.(this._onWxEnd); } catch (_) {}
    this.relayout();
    this._unsub?.();
    const handler = () => {
      if (this._drag) return;
      this.relayout();
    };
    EventBus.on(EV.basketChanged, handler);
    this._unsub = () => EventBus.off(EV.basketChanged, handler);
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this.placingUid = null;
    this._inspectUid = null;
    this._drag = null;
    this._unlocking = false;
    this._float.removeChildren();
    this._ghost.clear();
    this._scroller.disable();
    this._stageScroller.disable();
    this._unsub?.();
    this._unsub = null;
    OverlayManager.container.off('pointerup', this._boundUp);
    OverlayManager.container.off('pointerupoutside', this._boundUp);
    try { Platform.api?.offTouchMove?.(this._onWxMove); } catch (_) {}
    try { Platform.api?.offTouchEnd?.(this._onWxEnd); } catch (_) {}
    try { Platform.api?.offTouchCancel?.(this._onWxEnd); } catch (_) {}
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._drag) this._float.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.55;
    dim.eventMode = 'none';
    this._root.addChild(dim);

    const box = this._shellBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    this._root.addChild(shell);
    this._paintBg(shell, box.w, box.h);

    const title = new PIXI.Text('出门篮', {
      fontFamily: TITLE_FONT,
      fontSize: 30,
      fill: INK,
      fontWeight: '700',
      stroke: '#F6EDE0',
      strokeThickness: 4,
    });
    title.anchor.set(0.5);
    title.position.set(box.w / 2, box.h * 0.026);
    title.eventMode = 'none';
    shell.addChild(title);

    const basket = RunManager.basket;
    const cav = {
      x: box.w * CAVITY.x,
      y: box.h * CAVITY.y,
      w: box.w * CAVITY.w,
      h: box.h * CAVITY.h,
    };
    const pad = 6;
    const cell = Math.max(24, Math.min(72, Math.floor((cav.w - pad * 2) / Math.max(1, basket.cols))));

    const staging = RunManager.stagingItems();
    const stage = {
      x: box.w * STAGE.x,
      y: box.h * STAGE.y,
      w: box.w * STAGE.w,
      h: box.h * STAGE.h,
    };
    this._stageRect = { x: box.x + stage.x, y: box.y + stage.y, w: stage.w, h: stage.h };
    this._drawStage(shell, box, stage, staging, cell, basket.cols);

    this._drawGrid(shell, box, cav, cell);

    const fy = box.h * FOOTER.y;
    const fh = box.h * FOOTER.h;
    const btnY = fy + Math.max(8, (fh - 48) * 0.35);
    const gap = 10;
    const btnW = (box.w * 0.74 - gap * 2) / 3;
    const bx = box.w * 0.13;
    const rot = makeSlicedButton({
      label: '旋转',
      width: btnW,
      height: 46,
      skin: 'wood',
      onReady: () => {
        if (this._isOpen && !this._drag) this.relayout();
      },
    });
    rot.position.set(bx, btnY);
    rot.on('pointertap', () => this._rotate());
    shell.addChild(rot);
    const drop = makeSlicedButton({
      label: '丢掉',
      width: btnW,
      height: 46,
      skin: 'cream',
      textColor: 0x8A3B32,
      onReady: () => {
        if (this._isOpen && !this._drag) this.relayout();
      },
    });
    drop.position.set(bx + btnW + gap, btnY);
    drop.on('pointertap', () => this._discard());
    shell.addChild(drop);
    const close = makeSlicedButton({
      label: '关好',
      width: btnW,
      height: 46,
      skin: 'terracotta',
      onReady: () => {
        if (this._isOpen && !this._drag) this.relayout();
      },
    });
    close.position.set(bx + (btnW + gap) * 2, btnY);
    close.on('pointertap', () => this.close());
    shell.addChild(close);

    const inspecting = this._inspectUid ? this._foodByUid(this._inspectUid) : null;
    if (inspecting) {
      const view = inspectFromFood({
        defId: inspecting.defId,
        quality: inspecting.quality,
        inspected: inspecting.inspected,
      });
      if (view) {
        this._root.addChild(makeItemInspectCard({
          view,
          qty: 1,
          actions: false,
          onQty: () => {},
          onClose: () => {
            this._inspectUid = null;
            this.relayout();
          },
          onReady: () => {
            if (this._isOpen && !this._drag) this.relayout();
          },
        }));
      }
    }
  }

  private _foodByUid(uid: string): { defId: string; quality: Quality; inspected: boolean } | null {
    const staged = RunManager.stagingItems().find((it) => it.uid === uid);
    if (staged) return staged;
    return RunManager.basket.items.find((it) => it.uid === uid) ?? null;
  }

  private _shellBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const marginX = 10;
    const top = Game.safeTop + 2;
    const bottom = 8;
    const maxW = screenW - marginX * 2;
    const maxH = screenH - top - bottom;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1246;
    const scale = Math.min(maxW / tw, maxH / th);
    const w = tw * scale;
    const h = th * scale;
    return { x: (screenW - w) / 2, y: top + (maxH - h) / 2, w, h };
  }

  private _paintBg(host: PIXI.Container, width: number, height: number): void {
    whenTextureReady(BG, () => {
      if (this._isOpen && !this._drag) this.relayout();
    });
    const tex = gameTexture(BG);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = width;
      sp.height = height;
      sp.eventMode = 'none';
      host.addChild(sp);
      return;
    }
    const g = new PIXI.Graphics();
    g.beginFill(0xC4A574);
    g.drawRoundedRect(0, 0, width, height, 28);
    g.endFill();
    host.addChild(g);
  }

  private _drawStage(
    shell: PIXI.Container,
    box: { x: number; y: number; w: number; h: number },
    stage: { x: number; y: number; w: number; h: number },
    items: OutingLoot[],
    cell: number,
    cols: number,
  ): void {
    const pad = 4;
    const stageCell = Math.max(
      22,
      Math.min(
        cell,
        Math.floor((stage.w - pad * 2) / Math.max(1, cols)),
        Math.floor((stage.h - pad * 2) / 3),
      ),
    );
    const layout = packStagingLayout(items, cols);
    const rows = layout.rows;
    const gridW = cols * stageCell;
    const gridH = rows * stageCell;
    const gridX = stage.x + (stage.w - gridW) / 2;
    const gridY = stage.y + pad;

    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRoundedRect(stage.x, stage.y, stage.w, stage.h, 10);
    mask.endFill();
    mask.eventMode = 'none';
    viewport.mask = mask;
    shell.addChild(mask);
    shell.addChild(viewport);

    const content = new PIXI.Container();
    viewport.addChild(content);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const g = new PIXI.Graphics();
        g.lineStyle(1, INK, 0.16);
        g.beginFill(0xEDE3D0, 0.38);
        g.drawRoundedRect(gridX + x * stageCell, gridY + y * stageCell, stageCell - 3, stageCell - 3, 7);
        g.endFill();
        g.eventMode = 'none';
        content.addChild(g);
      }
    }

    const byUid = new Map(items.map((it) => [it.uid, it]));
    for (const slot of layout.slots) {
      if (this._drag?.uid === slot.uid) continue;
      const it = byUid.get(slot.uid);
      if (!it) continue;
      const { w: fw, h: fh } = footprint(getItem(it.defId), slot.rot);
      content.addChild(this._itemTile({
        uid: it.uid,
        defId: it.defId,
        rarity: getItem(it.defId).rarity,
        from: 'stage',
        x: gridX + slot.x * stageCell,
        y: gridY + slot.y * stageCell,
        w: fw * stageCell - 3,
        h: fh * stageCell - 3,
        rot: slot.rot,
      }));
    }

    this._stageScroller.attach({
      content,
      maxScroll: Math.max(0, gridH - (stage.h - pad)),
      baseY: 0,
      hit: { x: box.x + stage.x, y: box.y + stage.y, w: stage.w, h: stage.h },
    });
  }

  private _drawGrid(
    shell: PIXI.Container,
    box: { x: number; y: number; w: number; h: number },
    cav: { x: number; y: number; w: number; h: number },
    cell: number,
  ): void {
    const basket = RunManager.basket;
    const pad = 6;
    const gridW = basket.cols * cell;
    const gridH = basket.rows * cell;
    const gridX = cav.x + (cav.w - gridW) / 2;
    const gridY = cav.y + pad;
    this._grid = { x: box.x + gridX, y: box.y + gridY, cell, cols: basket.cols, rows: basket.rows };

    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRoundedRect(cav.x, cav.y, cav.w, cav.h, 12);
    mask.endFill();
    mask.eventMode = 'none';
    viewport.mask = mask;
    shell.addChild(mask);
    shell.addChild(viewport);

    const padHit = new PIXI.Graphics();
    padHit.beginFill(0x000000, 0.001);
    padHit.drawRect(cav.x, cav.y, cav.w, cav.h);
    padHit.endFill();
    padHit.eventMode = 'none';
    viewport.addChild(padHit);

    const content = new PIXI.Container();
    viewport.addChild(content);

    for (let y = 0; y < basket.rows; y++) {
      for (let x = 0; x < basket.cols; x++) {
        const kind = basketCellKind(basket, x, y);
        if (kind === 'none') continue;
        const g = new PIXI.Graphics();
        if (kind === 'wet') {
          g.lineStyle(1.5, INK, 0.22);
          g.beginFill(WET, 0.34);
        } else if (kind === 'dry') {
          g.lineStyle(2, 0x6A5848, 0.42);
          g.beginFill(0xF4EDE0, 0.46);
        } else {
          g.lineStyle(1.5, INK, 0.22);
          g.beginFill(FLEX, 0.34);
        }
        g.drawRoundedRect(gridX + x * cell, gridY + y * cell, cell - 3, cell - 3, 7);
        g.endFill();
        g.eventMode = 'none';
        content.addChild(g);
      }
    }

    if (!basket.flexUnlocked) {
      content.addChild(this._flexUnlockBtn(gridX, gridY, gridW, cell));
    }

    for (const item of basket.items) {
      if (this._drag?.uid === item.uid) continue;
      content.addChild(this._basketTile(item, gridX, gridY, cell));
    }

    this._scroller.attach({
      content,
      maxScroll: Math.max(0, gridH - (cav.h - pad)),
      baseY: 0,
      hit: { x: box.x + cav.x, y: box.y + cav.y, w: cav.w, h: cav.h },
    });
  }

  private _flexUnlockBtn(gridX: number, gridY: number, gridW: number, cell: number): PIXI.Container {
    const root = new PIXI.Container();
    const w = gridW - 3;
    const h = cell - 3;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFF8F0, 0.92);
    bg.lineStyle(2, 0xC46A3A, 0.88);
    bg.drawRoundedRect(0, 0, w, h, 7);
    bg.endFill();
    root.addChild(bg);
    if (h >= 36) {
      const title = makeLabel('看广告解锁一行', Math.min(16, Math.floor(h * 0.38)), 0x8A3B32, { fontWeight: '700' });
      title.anchor.set(0.5, 1);
      title.position.set(w / 2, h * 0.52);
      root.addChild(title);
      const sub = makeLabel('当次 · 干湿都能放', Math.min(13, Math.floor(h * 0.28)), WALNUT, { fontWeight: '600' });
      sub.anchor.set(0.5, 0);
      sub.position.set(w / 2, h * 0.54);
      root.addChild(sub);
    } else {
      const title = makeLabel('看广告解锁一行 · 当次通用', Math.min(14, Math.max(10, h - 8)), 0x8A3B32, { fontWeight: '700' });
      title.anchor.set(0.5);
      title.position.set(w / 2, h / 2);
      root.addChild(title);
    }
    root.position.set(gridX, gridY);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h);
    root.on('pointertap', () => {
      if (this._scroller.moved || this._unlocking) return;
      this._watchFlexAd();
    });
    return root;
  }

  private _watchFlexAd(): void {
    if (this._unlocking || RunManager.basket.flexUnlocked) return;
    this._unlocking = true;
    Platform.showRewardedVideo(() => {
      this._unlocking = false;
      if (!RunManager.unlockBasketFlex()) return;
      AudioManager.play('ui_open');
      Platform.showToast('多了一行，干湿都能放，回家就没了', 'success');
    });
  }

  private _drawGhost(): void {
    this._ghost.clear();
    const drag = this._drag;
    if (!drag?.moved) return;
    const def = getItem(drag.defId);
    const { w: fw, h: fh } = footprint(def, drag.rot);
    const { x, cell } = this._grid;
    const tone = drag.preview === 'empty' ? OK : drag.preview === 'swap' ? SWAP : BAD;
    const line = drag.preview === 'empty' ? 0x8FCB6B : drag.preview === 'swap' ? 0xE0A100 : 0xE07A5F;
    this._ghost.beginFill(tone, 0.38);
    this._ghost.lineStyle(3, line, 0.95);
    this._ghost.drawRoundedRect(x + drag.gx * cell, this._gridTop() + drag.gy * cell, fw * cell - 3, fh * cell - 3, 8);
    this._ghost.endFill();
  }

  private _itemTile(opts: {
    uid: string;
    defId: string;
    rarity: Rarity;
    from: DragFrom;
    x: number;
    y: number;
    w: number;
    h: number;
    rot?: 0 | 1;
  }): PIXI.Container {
    const root = new PIXI.Container();
    const on = opts.uid === this.selectedUid;
    const bg = new PIXI.Graphics();
    this._paintItemCell(bg, opts.w, opts.h, opts.rarity, on);
    root.addChild(bg);
    const icon = new PIXI.Sprite(itemTexture(opts.defId));
    fitSpriteInBox(icon, opts.w - 8, opts.h - 8);
    icon.anchor.set(0.5);
    icon.position.set(opts.w / 2, opts.h / 2);
    icon.eventMode = 'none';
    root.addChild(icon);
    root.position.set(opts.x, opts.y);
    this._bindDrag(root, opts.uid, opts.defId, opts.from, opts.w, opts.h, opts.rot);
    return root;
  }

  private _paintItemCell(g: PIXI.Graphics, w: number, h: number, rarity: Rarity, selected: boolean): void {
    g.beginFill(rarityCell(rarity), rarityCellAlpha(rarity));
    g.drawRoundedRect(0, 0, w, h, 10);
    g.endFill();
    drawRarityFrame(g, 2, 2, w - 4, h - 4, rarity, { thick: selected });
    if (selected) {
      g.lineStyle(3, 0xE0A100, 1);
      g.drawRoundedRect(0, 0, w, h, 10);
    }
  }

  private _basketTile(item: BasketItem, gridX: number, gridY: number, cell: number): PIXI.Container {
    const def = getItem(item.defId);
    const cells = occupiedCells(item);
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const { w: fw, h: fh } = footprint(def, item.rot);
    return this._itemTile({
      uid: item.uid,
      defId: item.defId,
      rarity: def.rarity,
      from: 'basket',
      x: gridX + minX * cell,
      y: gridY + minY * cell,
      w: fw * cell - 3,
      h: fh * cell - 3,
      rot: item.rot,
    });
  }

  private _bindDrag(
    root: PIXI.Container,
    uid: string,
    defId: string,
    from: DragFrom,
    w: number,
    h: number,
    rot?: 0 | 1,
  ): void {
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h);
    root.on('pointerdown', (e) => {
      e.stopPropagation();
      this._scroller.cancel();
      this._stageScroller.cancel();
      const item = from === 'basket' ? RunManager.basket.items.find((it) => it.uid === uid) : null;
      this.selectedUid = uid;
      this.placingUid = from === 'stage' ? uid : this.placingUid;
      this._rot = rot ?? item?.rot ?? this._rot;
      this._drag = {
        uid,
        from,
        rot: this._rot,
        defId,
        ox: e.global.x - root.getGlobalPosition().x,
        oy: e.global.y - root.getGlobalPosition().y,
        startX: e.global.x,
        startY: e.global.y,
        lastX: e.global.x,
        lastY: e.global.y,
        moved: false,
        liftAt: 0,
        gx: 0,
        gy: 0,
        preview: 'blocked',
        source: root,
      };
      this._syncGhost(e.global.x, e.global.y);
    });
  }

  private _onMove(gx: number, gy: number): void {
    const drag = this._drag;
    if (!drag) return;
    drag.lastX = gx;
    drag.lastY = gy;
    if (!drag.moved && Math.hypot(gx - drag.startX, gy - drag.startY) > 8) {
      drag.moved = true;
      drag.liftAt = Date.now();
      if (drag.source) drag.source.visible = false;
      this._lift(drag);
    }
    if (!drag.moved) return;
    this._float.position.set(gx - drag.ox, gy - drag.oy);
    this._syncGhost(gx, gy);
    this._drawGhost();
  }

  private _onUp(gx: number, gy: number): void {
    const drag = this._drag;
    if (!drag) return;
    if (drag.liftAt && Date.now() - drag.liftAt < 100) return;
    this._drag = null;
    this._float.removeChildren();
    this._ghost.clear();
    if (!drag.moved) {
      this._inspectUid = drag.uid;
      this.relayout();
      return;
    }
    const px = Number.isFinite(gx) ? gx : drag.lastX;
    const py = Number.isFinite(gy) ? gy : drag.lastY;
    if (this._hitStage(px, py) && drag.from === 'basket') {
      const err = RunManager.returnToStaging(drag.uid);
      if (err) Platform.showToast(err);
      this.relayout();
      return;
    }
    if (drag.preview === 'blocked') {
      this.relayout();
      return;
    }
    const err = drag.from === 'basket'
      ? RunManager.moveBasketItem(drag.uid, drag.gx, drag.gy, drag.rot)
      : RunManager.dropStagingToCell(drag.uid, drag.gx, drag.gy, drag.rot);
    if (err) {
      AudioManager.play('ui_deny');
      Platform.showToast(err);
    } else {
      AudioManager.play('basket_place');
      this.placingUid = null;
    }
    this.relayout();
  }

  private _lift(drag: NonNullable<BasketPanel['_drag']>): void {
    this._float.removeChildren();
    const def = getItem(drag.defId);
    const { w: fw, h: fh } = footprint(def, drag.rot);
    const cell = this._grid.cell;
    const bw = Math.max(cell, fw * cell - 3);
    const bh = Math.max(cell, fh * cell - 3);
    const wrap = new PIXI.Container();
    wrap.alpha = 0.92;
    const bg = new PIXI.Graphics();
    this._paintItemCell(bg, bw, bh, def.rarity, false);
    wrap.addChild(bg);
    const icon = new PIXI.Sprite(itemTexture(drag.defId));
    fitSpriteInBox(icon, bw - 8, bh - 8);
    icon.anchor.set(0.5);
    icon.position.set(bw / 2, bh / 2);
    wrap.addChild(icon);
    this._float.addChild(wrap);
  }

  private _syncGhost(gx: number, gy: number): void {
    const drag = this._drag;
    if (!drag) return;
    const cell = this._cellAt(gx, gy);
    if (!cell) {
      drag.preview = 'blocked';
      return;
    }
    const def = getItem(drag.defId);
    const { w, h } = footprint(def, drag.rot);
    drag.gx = Math.max(0, Math.min(cell.x, this._grid.cols - w));
    drag.gy = Math.max(0, Math.min(cell.y, this._grid.rows - h));
    drag.preview = previewDrop(RunManager.basket, {
      uid: drag.uid,
      defId: drag.defId,
      x: drag.gx,
      y: drag.gy,
      rot: drag.rot,
    });
  }

  private _boundUp = (e: PIXI.FederatedPointerEvent): void => {
    this._onUp(e.global.x, e.global.y);
  };

  private _onWxMove = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): void => {
    const t = res.touches?.[0];
    if (!t || !this._drag) return;
    const scale = Game.contentScale || 1;
    this._onMove((t.clientX ?? t.x ?? 0) / scale, (t.clientY ?? t.y ?? 0) / scale);
  };

  private _onWxEnd = (res: {
    changedTouches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
    touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>;
  }): void => {
    const drag = this._drag;
    if (!drag) return;
    const t = res.changedTouches?.[0] ?? res.touches?.[0];
    const scale = Game.contentScale || 1;
    if (t && t.clientX != null && t.clientY != null) {
      this._onUp(t.clientX / scale, t.clientY / scale);
      return;
    }
    this._onUp(drag.lastX, drag.lastY);
  };

  private _gridTop(): number {
    return this._grid.y + this._scroller.y;
  }

  private _cellAt(left: number, top: number): { x: number; y: number } | null {
    const { x, cell, cols, rows } = this._grid;
    const cx = Math.floor((left - x) / cell);
    const cy = Math.floor((top - this._gridTop()) / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;
    return { x: cx, y: cy };
  }

  private _hitStage(gx: number, gy: number): boolean {
    const r = this._stageRect;
    return gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h;
  }

  private _rotate(): void {
    this._rot = this._rot === 0 ? 1 : 0;
    if (this._drag) {
      this._drag.rot = this._rot;
      this._lift(this._drag);
      this._syncGhost(this._drag.lastX, this._drag.lastY);
      this._drawGhost();
      return;
    }
    const selected = RunManager.basket.items.find((it) => it.uid === this.selectedUid);
    if (selected) {
      RunManager.rotateBasketItem(selected.uid);
      this.relayout();
      return;
    }
    this.relayout();
  }

  private _discard(): void {
    const uid = this.selectedUid;
    if (!uid) {
      AudioManager.play('ui_deny');
      Platform.showToast('先点一件');
      return;
    }
    AudioManager.play('basket_discard');
    if (RunManager.basket.items.some((it) => it.uid === uid)) {
      RunManager.discard(uid);
    } else {
      RunManager.discardStaging(uid);
    }
    this.selectedUid = null;
    this.placingUid = null;
    this.relayout();
  }
}
