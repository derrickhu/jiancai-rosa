import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager } from '@/core/SceneManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { Platform } from '@/core/PlatformService';
import {
  fridgeItemName,
  fridgeItemPrice,
  fridgeItemQty,
  fridgeKind,
  fridgeRoom,
  type ExtractedItem,
  type ExtractResult,
  type Quality,
} from '@/sim';
import { HUD_ICON, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, itemLookTexture, whenTextureReady } from '@/utils/assets';

const KIND_TEXT = {
  safe: '挑完回家',
  messy: '天黑收摊了',
} as const;

const TITLE_ART = {
  safe: 'subpkg_kitchen/ui_result_title_safe.png',
  messy: 'subpkg_kitchen/ui_result_title_messy.png',
} as const;

const BG = 'subpkg_kitchen/ui_result_panel.png';
const BTN = 'subpkg_kitchen/ui_fridge_btn_terracotta.png';
const BURST = 'subpkg_kitchen/ui_result_burst.png';
const PAGE = { x: 0.08, y: 0.07, w: 0.84, h: 0.86 };
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const FLOAT_FONT = 'Kaiti SC, STKaiti, Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const GOLD = 0xC48A14;
const FLOAT_COLOR: Record<Quality, number> = {
  rotten: 0xC9B8A8,
  common: 0xFFF6E8,
  fresh: 0x7EE36A,
  premium: 0x7EC8FF,
  god: 0xFFD24A,
};

export class ResultPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _data: ExtractResult | null = null;
  private _sell = new Set<string>();
  private _scroller: VerticalScroller;
  private _celebrate = false;
  private _pops: PIXI.Container[] = [];

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 30;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    this.on('pointertap', this._onBgTap);
  }

  private _onBgTap = (): void => {
    if (!this._isOpen) return;
    if (this._data?.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) return;
    this.close();
  };

  open(result: ExtractResult): void {
    this._isOpen = true;
    this.visible = true;
    this._data = result;
    this._sell.clear();
    this._celebrate = true;
    this._scroller.reset();
    this._scroller.enable();
    AudioManager.play(result.kind === 'safe' ? 'result_safe' : 'result_dusk');
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
    this._stopPops();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }

  relayout(result?: ExtractResult): void {
    const data = result ?? this._data ?? RunManager.run?.extract;
    this._stopPops();
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
    const celebrate = this._celebrate;
    this._celebrate = false;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.58;
    dim.eventMode = 'static';
    dim.cursor = 'pointer';
    dim.on('pointertap', this._onBgTap);
    this._root.addChild(dim);

    const items = data.items;
    const n = items.length;
    const art = n <= 1 ? 236 : n <= 3 ? 168 : 132;
    const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n <= 4 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
    const gap = 16;
    const gridW = n ? cols * art + (cols - 1) * gap : art;
    const gridH = n ? rows * art + (rows - 1) * gap : art;

    const stack = new PIXI.Container();
    stack.eventMode = 'none';
    this._root.addChild(stack);
    let y = 0;

    const titleW = w - 40;
    const titleH = Math.round(titleW * 0.44);
    const banner = this._titleArt(data.kind, titleW, titleH);
    banner.position.set(-titleW / 2, y);
    stack.addChild(banner);
    y += titleH + 4;

    const burst = new PIXI.Sprite(gameTexture(BURST));
    const bindBurst = (): void => {
      if (burst.destroyed) return;
      burst.texture = gameTexture(BURST);
      const side = Math.max(gridW, gridH) * (n <= 1 ? 1.7 : 1.35);
      burst.width = side;
      burst.height = side;
    };
    whenTextureReady(BURST, bindBurst);
    bindBurst();
    burst.anchor.set(0.5);
    burst.position.set(0, y + gridH / 2);
    burst.blendMode = PIXI.BLEND_MODES.ADD;
    burst.alpha = 0.92;
    burst.eventMode = 'none';
    this._pops.push(burst);
    stack.addChild(burst);

    const icons = new PIXI.Container();
    icons.position.set(-gridW / 2, y);
    stack.addChild(icons);
    if (!n) {
      const empty = this._floatLabel('两手空空', 'common');
      empty.position.set((gridW - empty.width) / 2, (gridH - empty.height) / 2);
      icons.addChild(empty);
    } else {
      items.forEach((it, i) => {
        const icon = this._lootIcon(it, art);
        icon.position.set((i % cols) * (art + gap), Math.floor(i / cols) * (art + gap));
        icons.addChild(icon);
        if (celebrate) this._pop(icon, 0.08 + i * 0.06);
      });
    }
    y += gridH;

    const top = Game.safeTop + 20;
    const bottom = h - Math.max(16, Game.safeBottom + 16);
    stack.position.set(w / 2, top + Math.max(0, (bottom - top - y) / 2));

    if (n && celebrate) {
      this._playLootFloats(
        this._floatRows(items),
        w / 2,
        stack.y + titleH + 8 + gridH * 0.42,
      );
    }

    if (celebrate) {
      burst.alpha = 0;
      burst.scale.set(0.72);
      banner.alpha = 0;
      this._pop(banner, 0);
      TweenManager.to({ target: burst, props: { alpha: 0.92 }, duration: 0.36, ease: Ease.easeOutQuad });
      TweenManager.to({
        target: burst.scale,
        props: { x: 1, y: 1 },
        duration: 0.42,
        ease: Ease.easeOutQuad,
      });
    }
  }

  private _titleArt(kind: keyof typeof TITLE_ART, boxW: number, boxH: number): PIXI.Container {
    const root = new PIXI.Container();
    const path = TITLE_ART[kind];
    const sp = new PIXI.Sprite(gameTexture(path));
    const bind = (): void => {
      if (sp.destroyed) return;
      sp.texture = gameTexture(path);
      if (!isTextureReady(sp.texture)) return;
      const scale = boxW / Math.max(1, sp.texture.width);
      sp.width = boxW;
      sp.height = sp.texture.height * scale;
      sp.position.set(0, Math.max(0, (boxH - sp.height) / 2));
    };
    whenTextureReady(path, bind);
    bind();
    sp.eventMode = 'none';
    root.addChild(sp);
    if (!isTextureReady(sp.texture)) {
      const fallback = makeLabel(KIND_TEXT[kind], 48, 0xF6D56A, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: 0x2A2018,
        strokeThickness: 7,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(boxW / 2, boxH / 2);
      root.addChild(fallback);
    }
    root.hitArea = new PIXI.Rectangle(0, 0, boxW, boxH);
    root.eventMode = 'none';
    return root;
  }

  private _floatRows(items: ExtractedItem[]): { name: string; gold: number; quality: Quality }[] {
    const map = new Map<string, { name: string; gold: number; quality: Quality }>();
    for (const it of items) {
      const key = `${it.defId}|${it.quality}`;
      const hit = map.get(key);
      const gold = Math.max(0, it.sell);
      if (hit) hit.gold += gold;
      else map.set(key, { name: it.name, gold, quality: it.quality });
    }
    return [...map.values()];
  }

  private _floatLabel(text: string, quality: Quality): PIXI.Text {
    const fill = FLOAT_COLOR[quality] ?? FLOAT_COLOR.common;
    return makeLabel(text, 36, fill, {
      fontFamily: FLOAT_FONT,
      fontWeight: '700',
      stroke: 0x2A2018,
      strokeThickness: 7,
      letterSpacing: 1,
    });
  }

  private _playLootFloats(
    rows: { name: string; gold: number; quality: Quality }[],
    x: number,
    y: number,
  ): void {
    const layer = new PIXI.Container();
    layer.eventMode = 'none';
    this._root.addChild(layer);
    const step = 0.56;
    rows.forEach((row, i) => {
      const lab = this._floatLabel(`${row.name}+${row.gold}`, row.quality);
      lab.anchor.set(0.5);
      lab.position.set(x, y);
      lab.alpha = 0;
      lab.scale.set(0.7);
      layer.addChild(lab);
      this._pops.push(lab);
      const delay = 0.22 + i * step;
      TweenManager.to({
        target: lab,
        props: { alpha: 1 },
        duration: 0.1,
        delay,
        ease: Ease.easeOutQuad,
        onComplete: () => {
          if (lab.destroyed) return;
          TweenManager.to({
            target: lab,
            props: { alpha: 0 },
            duration: 0.3,
            delay: 0.4,
            ease: Ease.easeInQuad,
          });
        },
      });
      TweenManager.to({
        target: lab.scale,
        props: { x: 1, y: 1 },
        duration: 0.18,
        delay,
        ease: Ease.easeOutBack,
      });
      TweenManager.to({
        target: lab,
        props: { y: y - 100 },
        duration: 0.95,
        delay,
        ease: Ease.easeOutQuad,
      });
    });
  }

  private _lootIcon(it: ExtractedItem, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const look = it.quality === 'rotten' ? 'rotten' : 'clean';
    const path = `subpkg_images/${it.defId}${look === 'rotten' ? '_rotten' : ''}.png`;
    const icon = new PIXI.Sprite(itemLookTexture(it.defId, look));
    const bindIcon = (): void => {
      if (icon.destroyed) return;
      icon.texture = itemLookTexture(it.defId, look);
      if (isTextureReady(icon.texture)) fitSpriteInBox(icon, size, size);
    };
    whenTextureReady(path, bindIcon);
    bindIcon();
    icon.anchor.set(0.5);
    icon.position.set(size / 2, size / 2);
    icon.eventMode = 'none';
    root.addChild(icon);
    root.eventMode = 'none';
    return root;
  }

  private _mountShell(w: number, h: number): { box: { x: number; y: number; w: number; h: number }; shell: PIXI.Container } {
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    const box = this._shellBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    this._root.addChild(shell);
    this._paintBg(shell, box.w, box.h);
    return { box, shell };
  }

  private _shellBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const marginX = 28;
    const top = Game.safeTop + 28;
    const bottom = Math.max(20, Game.safeBottom + 20);
    const maxW = screenW - marginX * 2;
    const maxH = screenH - top - bottom;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1203;
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
    g.beginFill(0xFFF8EE);
    g.drawRoundedRect(0, 0, width, height, 36);
    g.endFill();
    host.addChild(g);
  }

  private _coinValue(amount: number, size: number): PIXI.Container {
    const row = new PIXI.Container();
    const coin = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
    const icon = Math.round(size * 1.15);
    const bindCoin = (): void => {
      if (coin.destroyed) return;
      coin.texture = gameTexture(HUD_ICON.coin);
      if (isTextureReady(coin.texture)) fitSpriteInBox(coin, icon, icon);
      else {
        coin.width = icon;
        coin.height = icon;
      }
    };
    whenTextureReady(HUD_ICON.coin, bindCoin);
    bindCoin();
    coin.anchor.set(0, 0.5);
    coin.eventMode = 'none';
    row.addChild(coin);
    const n = makeLabel(String(Math.max(0, amount)), size, GOLD, {
      fontWeight: '700',
      stroke: 0xFFF6E8,
      strokeThickness: Math.max(3, Math.round(size * 0.16)),
    });
    n.anchor.set(0, 0.5);
    n.position.set(icon + 6, 0);
    row.addChild(n);
    coin.position.set(0, 0);
    return row;
  }

  private _pop(target: PIXI.Container, delay: number): void {
    this._pops.push(target);
    target.alpha = 0;
    target.scale.set(0.72);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.22,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: 1, y: 1 },
      duration: 0.28,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopPops(): void {
    for (const node of this._pops) {
      TweenManager.cancelTarget(node);
      TweenManager.cancelTarget(node.scale);
    }
    this._pops = [];
  }

  private _drawPick(data: ExtractResult): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const haul = KitchenManager.pendingHaul ?? data.items;
    const need = KitchenManager.unpackNeed();
    const picked = this._picked();
    const ready = picked >= need;
    const gold = this._pickedGold(haul);
    const { box, shell } = this._mountShell(w, h);

    const px = box.w * PAGE.x;
    const py = box.h * PAGE.y;
    const pw = box.w * PAGE.w;
    const ph = box.h * PAGE.h;
    const hx = px + pw / 2;
    const title = new PIXI.Text('冰箱装不下', {
      fontFamily: TITLE_FONT,
      fontSize: 36,
      fill: INK,
      fontWeight: '700',
      stroke: '#FFF6E8',
      strokeThickness: 5,
      letterSpacing: 2,
    });
    title.anchor.set(0.5);
    title.position.set(hx, py + 28);
    title.eventMode = 'none';
    shell.addChild(title);

    const room = fridgeRoom(KitchenManager.save);
    const hint = makeLabel(
      `还能装 ${room} 格，带回 ${haul.length} 件。点选卖掉，至少 ${need} 件。`,
      18,
      0x6B5340,
      { wordWrap: true, breakWords: true, wordWrapWidth: pw * 0.88, align: 'center' },
    );
    hint.anchor.set(0.5, 0);
    hint.position.set(hx, py + 50);
    shell.addChild(hint);

    const cx = px + 8;
    const cy = py + 96;
    const cw = pw - 16;
    const ch = ph - 96 - 78;
    const viewport = new PIXI.Container();
    viewport.position.set(cx, cy);
    const mask = new PIXI.Graphics();
    fillRect(mask, cx, cy, cw, ch, 0xffffff);
    mask.eventMode = 'none';
    const list = new PIXI.Container();
    list.mask = mask;
    viewport.addChild(list);
    shell.addChild(mask, viewport);

    let y = 0;
    const addHead = (text: string) => {
      const lab = makeLabel(text, 20, GOLD, { fontWeight: '700' });
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
        width: cw,
      }));
      y += 76;
    }
    addHead('冰箱里也可以卖');
    for (const it of KitchenManager.save.fridge) {
      const qty = fridgeItemQty(it);
      list.addChild(this._pickRow({
        key: `f:${it.uid}`,
        name: qty > 1 ? `${fridgeItemName(it)} ×${qty}` : fridgeItemName(it),
        sell: fridgeItemPrice(it),
        defId: it.defId,
        dish: fridgeKind(it) === 'dish',
        rotten: it.quality === 'rotten',
        x: 0,
        y,
        width: cw,
      }));
      y += 76;
    }
    this._scroller.attach({
      content: list,
      maxScroll: Math.max(0, y - ch),
      baseY: 0,
      hit: { x: box.x + cx, y: box.y + cy, w: cw, h: ch },
    });

    if (ready) {
      const status = this._coinValue(gold, 18);
      status.pivot.set(status.width / 2, 0);
      status.position.set(hx, py + ph - 72);
      shell.addChild(status);
    } else {
      const status = makeLabel(`再选 ${need - picked} 件卖掉`, 18, 0xC46A3A, { fontWeight: '700' });
      status.anchor.set(0.5, 0);
      status.position.set(hx, py + ph - 72);
      shell.addChild(status);
    }

    const btnW = Math.min(280, pw * 0.62);
    const btnH = 48;
    const ok = makeSlicedButton({
      label: ready ? '卖掉选中的' : `再选 ${need - picked} 件`,
      width: btnW,
      height: btnH,
      path: BTN,
      silent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    ok.alpha = ready ? 1 : 0.55;
    ok.position.set(px + (pw - btnW) / 2, py + ph - btnH - 8);
    ok.on('pointertap', () => this._confirm());
    shell.addChild(ok);
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
    bg.lineStyle(3, on ? 0xC46A3A : 0xC4A574, 1);
    bg.beginFill(on ? 0xF3D2B4 : 0xFFF8F0);
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

    const name = makeLabel(opts.name, 22, INK, { fontWeight: '700' });
    name.position.set(opts.x + 72, opts.y + 10);
    root.addChild(name);
    if (opts.sell > 0) {
      const price = this._coinValue(opts.sell, 20);
      price.position.set(opts.x + 72, opts.y + 50);
      root.addChild(price);
    } else {
      const price = makeLabel('卖不掉', 18, 0xC9B8A4);
      price.position.set(opts.x + 72, opts.y + 38);
      root.addChild(price);
    }

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
      AudioManager.play('ui_deny');
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
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    if (gained > 0) AudioManager.play('coin_gain');
    this._data = this._data ? { ...this._data, needsPick: false } : null;
    Platform.showToast(gained > 0 ? `卖掉了，${kept} 件进冰箱，收入 ${gained}` : `${kept} 件进了冰箱`, 'success');
    this._isOpen = false;
    this.visible = false;
    this._sell.clear();
    this._stopPops();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }
}
