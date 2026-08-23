import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager } from '@/core/SceneManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { Platform } from '@/core/PlatformService';
import {
  fridgeItemName,
  fridgeItemPrice,
  fridgeKind,
  fridgeRoom,
  type ExtractResult,
} from '@/sim';
import { fillRect, makeButton, makeLabel } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { dishTexture, fitSpriteInBox, isTextureReady, itemLookTexture, whenTextureReady } from '@/utils/assets';

const KIND_TEXT = {
  safe: '挑完回家',
  messy: '天黑收摊了',
} as const;

export class ResultPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _data: ExtractResult | null = null;
  private _sell = new Set<string>();
  private _scroller: VerticalScroller;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 30;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
  }

  open(result: ExtractResult): void {
    this._isOpen = true;
    this.visible = true;
    this._data = result;
    this._sell.clear();
    this._scroller.reset();
    this._scroller.enable();
    this.relayout(result);
    OverlayManager.bringToFront();
  }

  close(): void {
    if (KitchenManager.pendingHaul?.length) {
      Platform.showToast(`再卖掉 ${KitchenManager.unpackNeed() - this._picked()} 件才能装下`);
      return;
    }
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._sell.clear();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }

  relayout(result?: ExtractResult): void {
    const data = result ?? this._data ?? RunManager.run?.extract;
    this._root.removeChildren();
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) return;
    this._data = data;
    if (data.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) {
      this._drawPick(data);
      return;
    }
    this._drawSummary(data);
  }

  private _drawSummary(data: ExtractResult): void {
    this._scroller.clear();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.6;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    const panel = new PIXI.Graphics();
    fillRect(panel, 40, Game.safeTop + 40, w - 80, h - Game.safeTop - 80, 0x3A3228, 18);
    this._root.addChild(panel);

    const title = makeLabel(KIND_TEXT[data.kind], 40, data.kind === 'safe' ? 0xC8E6A0 : 0xF4C430);
    title.position.set(64, Game.safeTop + 64);
    this._root.addChild(title);

    const sub = makeLabel(
      data.items.length ? `带回 ${data.items.length} 件，都进了冰箱` : '两手空空',
      22,
      0xC9B8A4,
    );
    sub.position.set(64, Game.safeTop + 118);
    this._root.addChild(sub);

    let y = Game.safeTop + 160;
    const rottenN = data.items.filter((it) => it.quality === 'rotten').length;
    if (rottenN > 0) {
      const note = makeLabel(`有 ${rottenN} 件是坏的，也带回来了`, 22, 0xE07A5F);
      note.position.set(64, y);
      this._root.addChild(note);
      y += 36;
    }
    for (const it of data.items.slice(0, 10)) {
      const row = makeLabel(`${it.name}  ·  ${it.sell} 金币`, 22, 0xF4EFE6);
      row.position.set(64, y);
      this._root.addChild(row);
      y += 34;
    }
    if (data.items.length > 10) {
      const more = makeLabel(`还有 ${data.items.length - 10} 件`, 20, 0xC9B8A4);
      more.position.set(64, y);
      this._root.addChild(more);
    }

    const ok = makeButton('回厨房', w - 128, 64, 0xC46A3A);
    ok.position.set(64, h - 120);
    ok.on('pointertap', () => this.close());
    this._root.addChild(ok);
  }

  private _drawPick(data: ExtractResult): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const haul = KitchenManager.pendingHaul ?? data.items;
    const need = KitchenManager.unpackNeed();
    const picked = this._picked();
    const ready = picked >= need;
    const gold = this._pickedGold(haul);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.6;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    const panel = new PIXI.Graphics();
    fillRect(panel, 24, Game.safeTop + 20, w - 48, h - Game.safeTop - 40, 0x3A3228, 18);
    panel.eventMode = 'static';
    this._root.addChild(panel);

    const title = makeLabel('冰箱装不下', 36, 0xF4C430);
    title.position.set(48, Game.safeTop + 40);
    this._root.addChild(title);

    const room = fridgeRoom(KitchenManager.save);
    const hint = makeLabel(
      `还能装 ${room} 件，带回 ${haul.length} 件。点选要卖掉的，至少卖掉 ${need} 件。`,
      20,
      0xC9B8A4,
      { wordWrap: true, breakWords: true, wordWrapWidth: w - 120 },
    );
    hint.position.set(48, Game.safeTop + 88);
    this._root.addChild(hint);

    const listTop = Game.safeTop + 88 + hint.height + 16;
    const listBottom = h - 132;
    const listH = Math.max(120, listBottom - listTop);
    const viewport = new PIXI.Container();
    viewport.position.set(40, listTop);
    const mask = new PIXI.Graphics();
    fillRect(mask, 40, listTop, w - 80, listH, 0xffffff);
    mask.eventMode = 'none';
    const list = new PIXI.Container();
    list.mask = mask;
    viewport.addChild(list);
    this._root.addChild(mask, viewport);

    let y = 0;
    const addHead = (text: string) => {
      const lab = makeLabel(text, 20, 0xE0A100, { fontWeight: '700' });
      lab.position.set(8, y);
      list.addChild(lab);
      y += 36;
    };
    addHead('刚带回');
    for (const it of haul) {
      list.addChild(this._pickRow({
        key: `h:${it.uid}`,
        name: it.name,
        sell: it.sell,
        defId: it.defId,
        dish: false,
        rotten: it.quality === 'rotten',
        x: 0,
        y,
        width: w - 88,
      }));
      y += 76;
    }
    addHead('冰箱里也可以卖');
    for (const it of KitchenManager.save.fridge) {
      list.addChild(this._pickRow({
        key: `f:${it.uid}`,
        name: fridgeItemName(it),
        sell: fridgeItemPrice(it),
        defId: it.defId,
        dish: fridgeKind(it) === 'dish',
        rotten: it.quality === 'rotten',
        x: 0,
        y,
        width: w - 88,
      }));
      y += 76;
    }
    this._scroller.attach({
      content: list,
      maxScroll: Math.max(0, y - listH),
      baseY: 0,
      hit: { x: 40, y: listTop, w: w - 80, h: listH },
    });

    const status = makeLabel(
      ready
        ? `已选 ${picked} 件 · 卖掉可得 ${gold} 金币`
        : `已选 ${picked} 件 · 还差 ${need - picked} 件`,
      20,
      ready ? 0xC8E6A0 : 0xE07A5F,
    );
    status.position.set(48, h - 118);
    this._root.addChild(status);

    const ok = makeButton(
      ready ? `卖掉选中的，装下剩下的` : `再选 ${need - picked} 件卖掉`,
      w - 96,
      56,
      ready ? 0xC46A3A : 0x5A5248,
    );
    ok.alpha = ready ? 1 : 0.55;
    ok.position.set(48, h - 88);
    ok.on('pointertap', () => this._confirm());
    this._root.addChild(ok);
  }

  private _pickRow(opts: {
    key: string;
    name: string;
    sell: number;
    defId: string;
    dish: boolean;
    rotten: boolean;
    x: number;
    y: number;
    width: number;
  }): PIXI.Container {
    const on = this._sell.has(opts.key);
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.lineStyle(3, on ? 0xC46A3A : 0x2A2018, 1);
    bg.beginFill(on ? 0x5A3228 : 0x2C261F);
    bg.drawRoundedRect(opts.x, opts.y, opts.width, 68, 12);
    bg.endFill();
    root.addChild(bg);

    const icon = new PIXI.Sprite(opts.dish ? dishTexture(opts.defId) : itemLookTexture(opts.defId, opts.rotten ? 'rotten' : 'clean'));
    const path = opts.dish
      ? `subpkg_images/dish_${opts.defId}.png`
      : `subpkg_images/${opts.defId}${opts.rotten ? '_rotten' : ''}.png`;
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    if (isTextureReady(icon.texture)) {
      fitSpriteInBox(icon, 52, 52);
    }
    icon.anchor.set(0.5);
    icon.position.set(opts.x + 36, opts.y + 34);
    icon.eventMode = 'none';
    root.addChild(icon);

    const name = makeLabel(opts.name, 22, 0xF4EFE6, { fontWeight: '700' });
    name.position.set(opts.x + 72, opts.y + 10);
    root.addChild(name);
    const price = makeLabel(opts.sell > 0 ? `${opts.sell} 金币` : '卖不掉，但能腾格', 18, on ? 0xF2C14D : 0xC9B8A4);
    price.position.set(opts.x + 72, opts.y + 38);
    root.addChild(price);

    const mark = makeLabel(on ? '卖掉' : '留下', 20, on ? 0xF2C14D : 0x8A6A40, { fontWeight: '700' });
    mark.anchor.set(1, 0.5);
    mark.position.set(opts.x + opts.width - 16, opts.y + 34);
    root.addChild(mark);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(opts.x, opts.y, opts.width, 68);
    root.on('pointertap', () => {
      if (this._scroller.moved) return;
      if (this._sell.has(opts.key)) this._sell.delete(opts.key);
      else this._sell.add(opts.key);
      this.relayout();
    });
    return root;
  }

  private _picked(): number {
    return this._sell.size;
  }

  private _pickedGold(haul: { uid: string; sell: number }[]): number {
    let gold = 0;
    for (const key of this._sell) {
      if (key.startsWith('h:')) {
        const uid = key.slice(2);
        gold += haul.find((it) => it.uid === uid)?.sell ?? 0;
      } else if (key.startsWith('f:')) {
        const uid = key.slice(2);
        const it = KitchenManager.save.fridge.find((row) => row.uid === uid);
        if (it) gold += fridgeItemPrice(it);
      }
    }
    return gold;
  }

  private _confirm(): void {
    const need = KitchenManager.unpackNeed();
    if (this._picked() < need) {
      Platform.showToast(`再卖掉 ${need - this._picked()} 件才能装下`);
      return;
    }
    const sellHaul: string[] = [];
    const sellFridge: string[] = [];
    for (const key of this._sell) {
      if (key.startsWith('h:')) sellHaul.push(key.slice(2));
      else if (key.startsWith('f:')) sellFridge.push(key.slice(2));
    }
    const { error, gained, kept } = KitchenManager.commitUnpack(sellHaul, sellFridge);
    if (error) {
      Platform.showToast(error);
      return;
    }
    this._data = this._data ? { ...this._data, needsPick: false } : null;
    Platform.showToast(gained > 0 ? `卖掉了，${kept} 件进冰箱，收入 ${gained} 金币` : `${kept} 件进了冰箱`, 'success');
    this._isOpen = false;
    this.visible = false;
    this._sell.clear();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }
}
