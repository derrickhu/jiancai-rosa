import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  fridgeCap,
  fridgeItemBlurb,
  fridgeItemName,
  fridgeItemPrice,
  fridgeKind,
  type FridgeItem,
  type FridgeKind,
} from '@/sim';
import { FONT, fillRect, makeLabel } from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  whenTextureReady,
} from '@/utils/assets';

const BG = 'subpkg_kitchen/ui_fridge_panel.png';

/** 相对冰箱贴图的留白区（与切图实测对齐）。 */
const HEADER = { y: 0.028, h: 0.188 };
const CAVITY = { x: 0.12, y: 0.228, w: 0.76, h: 0.568 };
const FOOTER = { y: 0.798, h: 0.145 };
const INK = 0x2A2018;
const CREAM = 0xF6EDE0;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;
const WALNUT = 0x8B5A2B;
const MUTED = 0x8A6A40;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const COIN = 'subpkg_images/hud_coin.png';
const BTN = {
  cream: 'subpkg_kitchen/ui_fridge_btn_cream.png',
  terracotta: 'subpkg_kitchen/ui_fridge_btn_terracotta.png',
  wood: 'subpkg_kitchen/ui_fridge_btn_wood.png',
} as const;

export class FridgePanel extends PIXI.Container {
  _isOpen = false;
  readonly selected = new Set<string>();
  onChange: (() => void) | null = null;
  private _tab: FridgeKind = 'food';
  private _root = new PIXI.Container();
  private _scrollY = 0;
  private _inspectUid: string | null = null;
  private _dragMoved = false;
  private _btnSlices = new Map<string, { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture }>();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 22;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  prune(): void {
    const valid = new Set(KitchenManager.save.fridge.map((it) => it.uid));
    for (const id of [...this.selected]) {
      if (!valid.has(id)) this.selected.delete(id);
    }
    if (this._inspectUid && !valid.has(this._inspectUid)) this._inspectUid = null;
  }

  open(tab?: FridgeKind): void {
    this.prune();
    if (tab) this._tab = tab;
    this._isOpen = true;
    this.visible = true;
    this._scrollY = 0;
    this._inspectUid = null;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
  }

  relayout(): void {
    this._root.removeChildren();
    this.prune();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.46;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const save = KitchenManager.save;
    const cap = fridgeCap(save);
    const foods = save.fridge.filter((it) => fridgeKind(it) === 'food');
    const dishes = save.fridge.filter((it) => fridgeKind(it) === 'dish');
    const items = this._tab === 'food' ? foods : dishes;
    const cols = 6;
    const used = save.fridge.length;
    const foodSlots = Math.max(foods.length, cap - dishes.length);
    const dishSlots = Math.max(dishes.length, cap - foods.length);
    const slotCount = this._tab === 'food' ? foodSlots : dishSlots;

    const box = this._fridgeBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);
    this._paintBg(shell, box.w, box.h);

    const midX = box.w / 2;
    const cx = box.w * CAVITY.x;
    const cy = box.h * CAVITY.y;
    const cw = box.w * CAVITY.w;
    const ch = box.h * CAVITY.h;
    const hy = box.h * HEADER.y;
    const hh = box.h * HEADER.h;
    const gap = 14;
    const chipW = (cw - gap) / 2;

    shell.addChild(this._title(midX, hy + hh * 0.38));
    const tabY = hy + hh - 64;
    shell.addChild(this._tabBtn('食材', 'food', cx, tabY, chipW, foods.length, used, cap));
    shell.addChild(this._tabBtn('饭菜', 'dish', cx + chipW + gap, tabY, chipW, dishes.length, used, cap));
    const pad = 8;
    const cell = Math.max(48, Math.floor((cw - pad * 2) / cols));
    const gridW = cols * cell;
    const gridX = cx + (cw - gridW) / 2;
    const contentH = Math.ceil(slotCount / cols) * cell;
    const maxScroll = Math.max(0, contentH - (ch - pad));

    this._scrollY = Math.max(-maxScroll, Math.min(0, this._scrollY));

    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRoundedRect(cx, cy, cw, ch, 18);
    mask.endFill();
    viewport.mask = mask;
    viewport.eventMode = 'static';
    viewport.hitArea = new PIXI.Rectangle(cx, cy, cw, ch);
    shell.addChild(mask);
    shell.addChild(viewport);

    const grid = new PIXI.Container();
    grid.position.set(0, this._scrollY);
    viewport.addChild(grid);
    for (let i = 0; i < slotCount; i++) {
      const x = gridX + (i % cols) * cell;
      const y = cy + pad + Math.floor(i / cols) * cell;
      grid.addChild(this._slot(x, y, cell - 8, items[i]));
    }

    this._bindScroll(viewport, grid, maxScroll);

    if (!items.length) {
      const empty = makeLabel(
        this._tab === 'dish' ? '还没有做好的饭菜' : '空空的，出门收摊翻一趟',
        20,
        MUTED,
        { fontWeight: '600' },
      );
      empty.anchor.set(0.5);
      empty.position.set(midX, cy + Math.min(ch - 28, pad + Math.ceil(slotCount / cols) * cell + 26));
      shell.addChild(empty);
    }

    const fy = box.h * FOOTER.y;
    const fh = box.h * FOOTER.h;
    const picked = items.filter((it) => this.selected.has(it.uid));
    const uids = picked.map((it) => it.uid);
    const btnH = 46;
    const btnY = fy + Math.max(6, (fh - btnH) * 0.28) + 20;
    const sell = this._chip(uids.length ? `卖掉 ${uids.length}` : '卖掉', chipW, btnH, uids.length ? 'primary' : 'idle');
    sell.position.set(cx, btnY);
    sell.on('pointertap', () => {
      if (!uids.length) return;
      KitchenManager.sell(uids);
      this.selected.clear();
      this._inspectUid = null;
      this.relayout();
      this.onChange?.();
    });
    shell.addChild(sell);
    const close = this._chip('关门', chipW, btnH, 'wood');
    close.position.set(cx + chipW + gap, btnY);
    close.on('pointertap', () => this.close());
    shell.addChild(close);

    const inspecting = items.find((it) => it.uid === this._inspectUid);
    if (inspecting) this._root.addChild(this._inspectCard(inspecting, w, h));
  }

  private _fridgeBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const marginX = 18;
    const top = Game.safeTop + 4;
    const bottom = 10;
    const maxW = screenW - marginX * 2;
    const maxH = screenH - top - bottom;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1280;
    const scale = Math.min(maxW / tw, maxH / th);
    const w = tw * scale;
    const h = th * scale;
    return { x: (screenW - w) / 2, y: top + (maxH - h) / 2, w, h };
  }

  private _paintBg(host: PIXI.Container, width: number, height: number): void {
    whenTextureReady(BG, () => {
      if (this._isOpen) this.relayout();
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
    g.beginFill(0xF3E6D0);
    g.drawRoundedRect(0, 0, width, height, 36);
    g.endFill();
    g.beginFill(0xB8D4C8);
    g.drawRoundedRect(width * CAVITY.x, height * CAVITY.y, width * CAVITY.w, height * CAVITY.h, 16);
    g.endFill();
    host.addChild(g);
  }

  private _bindScroll(viewport: PIXI.Container, grid: PIXI.Container, maxScroll: number): void {
    if (maxScroll <= 0) return;
    let dragging = false;
    let startY = 0;
    let startScroll = 0;
    viewport.on('pointerdown', (e) => {
      dragging = true;
      this._dragMoved = false;
      startY = e.global.y;
      startScroll = this._scrollY;
    });
    const move = (e: PIXI.FederatedPointerEvent) => {
      if (!dragging) return;
      const dy = e.global.y - startY;
      if (Math.abs(dy) > 8) this._dragMoved = true;
      this._scrollY = Math.max(-maxScroll, Math.min(0, startScroll + dy));
      grid.y = this._scrollY;
    };
    const end = () => {
      dragging = false;
    };
    viewport.on('pointermove', move);
    viewport.on('pointerup', end);
    viewport.on('pointerupoutside', end);
  }

  private _title(cx: number, cy: number): PIXI.Container {
    const root = new PIXI.Container();
    const name = new PIXI.Text('冰  箱', {
      fontFamily: TITLE_FONT,
      fontSize: 40,
      fill: INK,
      fontWeight: '700',
      letterSpacing: 6,
      stroke: '#F6EDE0',
      strokeThickness: 5,
      dropShadow: true,
      dropShadowColor: '#C4A574',
      dropShadowAlpha: 0.55,
      dropShadowDistance: 2,
      dropShadowBlur: 0,
      dropShadowAngle: Math.PI / 2,
    });
    name.anchor.set(0.5);
    name.position.set(cx, cy);
    name.eventMode = 'none';
    root.addChild(name);
    return root;
  }

  private _chip(label: string, width: number, height: number, kind: 'primary' | 'wood' | 'idle' | 'on' | 'off'): PIXI.Container {
    const path = kind === 'wood' ? BTN.wood : (kind === 'primary' || kind === 'on' ? BTN.terracotta : BTN.cream);
    const texts = {
      primary: PAPER,
      on: PAPER,
      wood: PAPER,
      idle: MUTED,
      off: INK,
    };
    const root = new PIXI.Container();
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    const slices = this._buttonSlices(path);
    if (slices) {
      const th = slices.left.height;
      const cap = slices.left.width * (height / th);
      const left = new PIXI.Sprite(slices.left);
      left.height = height;
      left.width = cap;
      left.eventMode = 'none';
      const right = new PIXI.Sprite(slices.right);
      right.height = height;
      right.width = cap;
      right.x = width - cap;
      right.eventMode = 'none';
      const mid = new PIXI.Sprite(slices.mid);
      mid.height = height;
      mid.x = cap;
      mid.width = Math.max(1, width - cap * 2);
      mid.eventMode = 'none';
      root.addChild(left, mid, right);
    } else {
      const fills = { primary: TERRACOTTA, on: TERRACOTTA, wood: WALNUT, idle: 0xE4D4BE, off: CREAM };
      const bg = new PIXI.Graphics();
      bg.lineStyle(3, INK, 1);
      bg.beginFill(fills[kind]);
      bg.drawRoundedRect(0, 0, width, height, height / 2);
      bg.endFill();
      root.addChild(bg);
    }
    const text = makeLabel(label, Math.min(24, height * 0.44), texts[kind], { fontWeight: '700' });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2 + 1);
    root.addChild(text);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    return root;
  }

  private _buttonSlices(path: string): { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture } | null {
    const hit = this._btnSlices.get(path);
    if (hit) return hit;
    const tex = gameTexture(path);
    if (!isTextureReady(tex)) return null;
    const tw = tex.width;
    const th = tex.height;
    const cap = Math.min(Math.floor(th * 0.5), Math.floor(tw * 0.34));
    const midW = Math.max(1, tw - cap * 2);
    const slices = {
      left: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(0, 0, cap, th)),
      mid: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(cap, 0, midW, th)),
      right: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tw - cap, 0, cap, th)),
    };
    this._btnSlices.set(path, slices);
    return slices;
  }

  private _tabBtn(
    label: string,
    tab: FridgeKind,
    x: number,
    y: number,
    width: number,
    count: number,
    used: number,
    cap: number,
  ): PIXI.Container {
    const on = this._tab === tab;
    const root = this._chip(on ? `${label}  ${used}/${cap}` : `${label}  ${count}`, width, 40, on ? 'on' : 'off');
    root.position.set(x, y);
    root.on('pointertap', () => {
      this._tab = tab;
      this.selected.clear();
      this._scrollY = 0;
      this._inspectUid = null;
      this.relayout();
    });
    return root;
  }

  private _slot(x: number, y: number, size: number, it?: FridgeItem): PIXI.Container {
    const root = new PIXI.Container();
    const on = !!(it && this.selected.has(it.uid));
    const bg = new PIXI.Graphics();
    bg.lineStyle(on ? 4 : 2, on ? 0xE0A100 : INK, on ? 1 : 0.22);
    bg.beginFill(it ? PAPER : 0xE8DFD0, it ? 0.96 : 0.42);
    bg.drawRoundedRect(x, y, size, size, 12);
    bg.endFill();
    root.addChild(bg);
    if (!it) {
      root.eventMode = 'none';
      return root;
    }
    if (fridgeKind(it) === 'dish') {
      const icon = new PIXI.Sprite(dishTexture(it.defId));
      whenTextureReady(`subpkg_images/dish_${it.defId}.png`, () => {
        if (this._isOpen) this.relayout();
      });
      fitSpriteInBox(icon, size - 12, size - 12);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    } else {
      const look = it.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
      const icon = new PIXI.Sprite(itemLookTexture(it.defId, look));
      fitSpriteInBox(icon, size - 12, size - 12);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    }
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this.selected.add(it.uid);
      this._inspectUid = it.uid;
      this.relayout();
    });
    return root;
  }

  private _inspectCard(it: FridgeItem, screenW: number, screenH: number): PIXI.Container {
    const root = new PIXI.Container();
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, screenW, screenH, 0x000000);
    dim.alpha = 0.35;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      this._inspectUid = null;
      this.relayout();
    });
    root.addChild(dim);

    const cardW = Math.min(520, screenW - 64);
    const cardH = 368;
    const cardX = (screenW - cardW) / 2;
    const cardY = (screenH - cardH) / 2;
    const card = new PIXI.Container();
    card.position.set(cardX, cardY);
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
    card.on('pointertap', (e) => e.stopPropagation());
    root.addChild(card);

    const plate = new PIXI.Graphics();
    plate.lineStyle(4, INK, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(0, 0, cardW, cardH, 22);
    plate.endFill();
    plate.beginFill(PAPER);
    plate.drawRoundedRect(12, 12, cardW - 24, cardH - 24, 16);
    plate.endFill();
    card.addChild(plate);

    const iconBox = 88;
    const iconHost = new PIXI.Container();
    const iconBg = new PIXI.Graphics();
    iconBg.lineStyle(2, INK, 0.25);
    iconBg.beginFill(0xE8DFD0, 0.7);
    iconBg.drawRoundedRect(0, 0, iconBox, iconBox, 16);
    iconBg.endFill();
    iconHost.addChild(iconBg);
    if (fridgeKind(it) === 'dish') {
      const icon = new PIXI.Sprite(dishTexture(it.defId));
      fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
      icon.anchor.set(0.5);
      icon.position.set(iconBox / 2, iconBox / 2);
      iconHost.addChild(icon);
    } else {
      const look = it.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
      const icon = new PIXI.Sprite(itemLookTexture(it.defId, look));
      fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
      icon.anchor.set(0.5);
      icon.position.set(iconBox / 2, iconBox / 2);
      iconHost.addChild(icon);
    }
    iconHost.position.set(28, 28);
    card.addChild(iconHost);

    const name = makeLabel(fridgeItemName(it), 28, INK, { fontWeight: '700' });
    name.position.set(132, 36);
    card.addChild(name);

    const price = fridgeItemPrice(it);
    if (price > 0) {
      const gold = makeLabel(`能卖  ${price}`, 22, TERRACOTTA, { fontWeight: '700' });
      gold.position.set(132, 78);
      card.addChild(gold);
      whenTextureReady(COIN, () => {
        if (this._isOpen) this.relayout();
      });
      const coinTex = gameTexture(COIN);
      if (isTextureReady(coinTex)) {
        const coin = new PIXI.Sprite(coinTex);
        fitSpriteInBox(coin, 32, 32);
        coin.anchor.set(0, 0.5);
        coin.position.set(132 + gold.width + 6, 90);
        coin.eventMode = 'none';
        card.addChild(coin);
      }
    } else {
      const gold = makeLabel('坏了，卖不掉', 22, MUTED, { fontWeight: '700' });
      gold.position.set(132, 78);
      card.addChild(gold);
    }

    const blurb = new PIXI.Text(fridgeItemBlurb(it), {
      fontFamily: FONT,
      fontSize: 22,
      fill: MUTED,
      fontWeight: '500',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: cardW - 56,
      lineHeight: 34,
    });
    blurb.position.set(28, 136);
    blurb.eventMode = 'none';
    card.addChild(blurb);

    const btnW = cardW - 56;
    const sellOne = this._chip('卖出', btnW, 48, price > 0 ? 'primary' : 'idle');
    sellOne.position.set(28, cardH - 68);
    sellOne.on('pointertap', () => {
      if (price <= 0) return;
      KitchenManager.sell([it.uid]);
      this.selected.delete(it.uid);
      this._inspectUid = null;
      this.relayout();
      this.onChange?.();
    });
    card.addChild(sellOne);
    return root;
  }

}
