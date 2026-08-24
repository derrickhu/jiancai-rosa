import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  DEX_FOOD_CATS,
  dishGroupCatIcon,
  dishGroupTheme,
  dishGroups,
  dishesInGroup,
  foodsInCat,
  isDishUnlocked,
  isFoodUnlocked,
  type DexFoodCat,
  type DexTab,
  type KitchenSave,
  type Rarity,
} from '@/sim';
import { drawRarityFrame, fillRect, makeDexName, makeLabel, makeSlicedButton, makeStrokeLabel } from '@/utils/ui';
import {
  applyGray,
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  imgPath,
  isTextureReady,
  itemTexture,
  whenTextureReady,
} from '@/utils/assets';

const BG = 'subpkg_kitchen/ui_dex_panel.png';
const INK = 0x2A2018;
const MUTED = 0x8A6A40;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const PAGE = { x: 0.155, y: 0.152, w: 0.725, h: 0.688 };
const TITLE_Y = 0.052;

type View =
  | { kind: 'home' }
  | { kind: 'food'; cat: DexFoodCat }
  | { kind: 'dish'; group: string };

export class DexPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _tab: DexTab = 'food';
  private _view: View = { kind: 'home' };
  private _scrollY = 0;
  private _scrollMax = 0;
  private _scrollBaseY = 0;
  private _scrollList: PIXI.Container | null = null;
  private _scrollHit = { x: 0, y: 0, w: 0, h: 0 };
  private _dragging = false;
  private _dragY = 0;
  private _dragStart = 0;
  private _dragMoved = false;
  private _wxBound = false;
  private _paintQueued = false;
  private _inspect: { title: string; blurb: string } | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 24;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this.on('pointerdown', this._onPtrDown);
    this.on('globalpointermove', this._onPtrMove);
    this.on('pointerup', this._onPtrUp);
    this.on('pointerupoutside', this._onPtrUp);
    this.on('pointercancel', this._onPtrUp);
    this.on('wheel', this._onWheel);
  }

  open(tab: DexTab = 'food'): void {
    this._tab = tab;
    this._view = { kind: 'home' };
    this._scrollY = 0;
    this._inspect = null;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    this._bindWx(true);
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._dragging = false;
    this._bindWx(false);
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const redraw = this._scheduleRelayout;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.46;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const box = this._boardBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);

    const bgTex = gameTexture(BG);
    whenTextureReady(BG, redraw);
    if (isTextureReady(bgTex)) {
      const bg = new PIXI.Sprite(bgTex);
      bg.width = box.w;
      bg.height = box.h;
      shell.addChild(bg);
    } else {
      const fb = new PIXI.Graphics();
      fillRect(fb, 0, 0, box.w, box.h, 0x8B5A2B, 24);
      fillRect(fb, box.w * 0.12, box.h * 0.08, box.w * 0.8, box.h * 0.8, 0xF6EDE0, 16);
      shell.addChild(fb);
    }

    this._drawClose(shell, box.w);
    const page = {
      x: box.w * PAGE.x,
      y: box.h * PAGE.y,
      w: box.w * PAGE.w,
      h: box.h * PAGE.h,
    };
    this._drawHeader(shell, box.w, box.h, page, redraw);
    this._drawBody(shell, box, page, redraw);
    this._drawFooter(shell, box.w, box.h, page);
  }

  private _boardBox(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const top = (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 8;
    const bottom = 16 + Game.safeBottom;
    const height = Math.min(h - top - bottom, 1120);
    const width = Math.min(w - 24, Math.round(height * (750 / 1136)));
    return { x: (w - width) / 2, y: top + (h - top - bottom - height) / 2, w: width, h: height };
  }

  private _drawClose(shell: PIXI.Container, bw: number): void {
    const btn = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 1);
    g.beginFill(0xC46A3A);
    g.drawCircle(22, 22, 20);
    g.endFill();
    const x = makeLabel('×', 28, 0xFFF8F0, { fontWeight: '700' });
    x.anchor.set(0.5);
    x.position.set(22, 20);
    btn.addChild(g, x);
    btn.position.set(bw - 58, 18);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = new PIXI.Circle(22, 22, 22);
    btn.on('pointertap', () => this.close());
    shell.addChild(btn);
  }

  private _drawHeader(
    shell: PIXI.Container,
    bw: number,
    bh: number,
    page: { x: number; y: number; w: number },
    redraw: () => void,
  ): void {
    const title = this._titleText();
    const head = makeLabel(title, 36, INK, { fontFamily: TITLE_FONT, fontWeight: '700' });
    head.anchor.set(0.5);
    head.position.set(bw / 2, bh * TITLE_Y);
    shell.addChild(head);

    const save = KitchenManager.save;
    const { have, total } = this._progress(save);
    const pill = makeLabel(`已收集  ${have}/${total}`, 20, 0xFFF8F0, { fontWeight: '700' });
    const pw = Math.max(168, pill.width + 28);
    const bg = new PIXI.Graphics();
    fillRect(bg, 0, 0, pw, 34, 0x8B5A2B, 16);
    const wrap = new PIXI.Container();
    wrap.addChild(bg);
    pill.anchor.set(0.5);
    pill.position.set(pw / 2, 17);
    wrap.addChild(pill);
    wrap.position.set(page.x + (page.w - pw) / 2, page.y + 8);
    shell.addChild(wrap);

    if (this._view.kind === 'home') {
      const tabY = page.y + 52;
      const tw = (page.w - 12) / 2;
      (['food', 'dish'] as const).forEach((tab, i) => {
        const on = this._tab === tab;
        const btn = makeSlicedButton({
          label: tab === 'food' ? '食材' : '菜品',
          width: tw,
          height: 48,
          skin: on ? 'terracotta' : 'cream',
          textColor: on ? 0xFFF8F0 : INK,
          onReady: redraw,
        });
        btn.position.set(page.x + i * (tw + 12), tabY);
        btn.on('pointertap', () => {
          this._tab = tab;
          this._view = { kind: 'home' };
          this._scrollY = 0;
          this._inspect = null;
          this.relayout();
        });
        shell.addChild(btn);
      });
    }
  }

  private _titleText(): string {
    const view = this._view;
    if (view.kind === 'food') {
      return DEX_FOOD_CATS.find((c) => c.id === view.cat)?.label ?? '食材';
    }
    if (view.kind === 'dish') return view.group;
    return '图鉴';
  }

  private _progress(s: KitchenSave): { have: number; total: number } {
    if (this._view.kind === 'food') {
      const items = foodsInCat(this._view.cat);
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._view.kind === 'dish') {
      const items = dishesInGroup(this._view.group);
      return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._tab === 'food') {
      const items = DEX_FOOD_CATS.flatMap((c) => foodsInCat(c.id));
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    const items = dishGroups().flatMap((g) => dishesInGroup(g));
    return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
  }

  private _drawBody(
    shell: PIXI.Container,
    box: { x: number; y: number },
    page: { x: number; y: number; w: number; h: number },
    redraw: () => void,
  ): void {
    const top = this._view.kind === 'home' ? page.y + 112 : page.y + 52;
    const bottom = page.y + page.h - (this._inspect ? 88 : 8);
    const area = { x: page.x, y: top, w: page.w, h: Math.max(80, bottom - top) };
    const list = new PIXI.Container();
    let contentH = 0;
    if (this._view.kind === 'home') {
      contentH = this._tab === 'food'
        ? this._paintFoodCats(list, area.w, redraw)
        : this._paintDishCats(list, area.w, redraw);
    } else {
      contentH = this._paintGrid(list, area.w, redraw);
    }
    contentH += 28;

    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRect(area.x, area.y, area.w, area.h);
    mask.endFill();
    mask.eventMode = 'none';
    const viewport = new PIXI.Container();
    viewport.eventMode = 'static';
    viewport.hitArea = new PIXI.Rectangle(area.x, area.y, area.w, area.h);
    viewport.mask = mask;
    list.position.set(area.x, area.y);
    viewport.addChild(list);
    this._scrollList = list;
    this._scrollBaseY = area.y;
    this._scrollMax = Math.max(0, contentH - area.h);
    this._scrollHit = { x: box.x + area.x, y: box.y + area.y, w: area.w, h: area.h };
    this._applyScroll(this._scrollY);
    shell.addChild(mask, viewport);

    if (this._inspect) {
      const card = new PIXI.Graphics();
      fillRect(card, page.x, page.y + page.h - 80, page.w, 76, 0xEFE6D6, 12);
      shell.addChild(card);
      const name = makeDexName(this._inspect.title, 22, true);
      name.position.set(page.x + 12, page.y + page.h - 72);
      shell.addChild(name);
      const blurb = makeLabel(this._inspect.blurb, 16, MUTED, { wordWrap: true, wordWrapWidth: page.w - 24 });
      blurb.position.set(page.x + 12, page.y + page.h - 44);
      shell.addChild(blurb);
    }
  }

  private _paintFoodCats(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      list,
      width,
      DEX_FOOD_CATS.map((cat) => {
        const items = foodsInCat(cat.id);
        const have = items.filter((it) => isFoodUnlocked(save, it.id)).length;
        return {
          label: cat.label,
          icon: cat.icon,
          have,
          total: items.length,
          ink: cat.ink,
          bar: cat.bar,
          onTap: () => {
            this._view = { kind: 'food', cat: cat.id };
            this._scrollY = 0;
            this._inspect = null;
            this.relayout();
          },
        };
      }),
      redraw,
    );
  }

  private _paintDishCats(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      list,
      width,
      dishGroups().map((group) => {
        const items = dishesInGroup(group);
        const have = items.filter((it) => isDishUnlocked(save, it.id)).length;
        return {
          label: group,
          icon: dishGroupCatIcon(group),
          have,
          total: items.length,
          ...dishGroupTheme(group),
          onTap: () => {
            this._view = { kind: 'dish', group };
            this._scrollY = 0;
            this._inspect = null;
            this.relayout();
          },
        };
      }),
      redraw,
    );
  }

  private _paintCatGrid(
    list: PIXI.Container,
    width: number,
    cats: Array<{ label: string; icon: string; have: number; total: number; ink: number; bar: number; onTap: () => void }>,
    redraw: () => void,
  ): number {
    const cols = 2;
    const gap = 14;
    const cardW = (width - gap) / cols;
    const icon = Math.round(cardW * 0.9);
    const cardH = icon + 8;
    cats.forEach((cat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      list.addChild(this._catCard(
        col * (cardW + gap),
        row * (cardH + gap),
        cardW,
        cardH,
        icon,
        cat,
        redraw,
      ));
    });
    return Math.ceil(cats.length / cols) * (cardH + gap);
  }

  private _catCard(
    x: number,
    y: number,
    width: number,
    height: number,
    iconSize: number,
    cat: { label: string; icon: string; have: number; total: number; ink: number; bar: number; onTap: () => void },
    redraw: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(x, y);
    const path = imgPath(`${cat.icon}.png`);
    const tex = gameTexture(path);
    const cx = width / 2;
    const cy = 4 + iconSize / 2;
    const spr = new PIXI.Sprite(tex);
    spr.anchor.set(0.5);
    spr.position.set(cx, cy);
    const clip = new PIXI.Graphics();
    clip.eventMode = 'none';
    const fitCat = (): void => {
      fitSpriteInBox(spr, iconSize, iconSize);
      const mw = Math.max(8, spr.width * 0.97);
      const mh = Math.max(8, spr.height * 0.97);
      clip.clear();
      clip.beginFill(0xffffff);
      clip.drawRoundedRect(cx - mw / 2, cy - mh / 2, mw, mh, Math.min(mw, mh) * 0.2);
      clip.endFill();
    };
    spr.mask = clip;
    root.addChild(spr, clip);
    if (isTextureReady(tex)) fitCat();
    else whenTextureReady(path, fitCat);
    const name = makeStrokeLabel(cat.label, 26, 0xFFF8F0, cat.ink, 6, { fontFamily: TITLE_FONT });
    name.anchor.set(0.5);
    name.position.set(cx, 4 + iconSize * 0.66);
    root.addChild(name);

    const barW = iconSize * 0.68;
    const barH = 24;
    const bx = cx - barW / 2;
    const by = 4 + iconSize * 0.78;
    const bar = new PIXI.Graphics();
    bar.lineStyle(3.5, cat.ink, 1);
    bar.beginFill(0x1A1410, 0.42);
    bar.drawRoundedRect(bx, by, barW, barH, barH / 2);
    bar.endFill();
    const fillW = cat.total > 0 ? Math.max(0, barW * (cat.have / cat.total)) : 0;
    if (fillW > 6) {
      bar.beginFill(cat.bar);
      bar.drawRoundedRect(bx, by, fillW, barH, barH / 2);
      bar.endFill();
    }
    root.addChild(bar);
    const count = makeStrokeLabel(`${cat.have}/${cat.total}`, 15, 0xFFF8F0, cat.ink, 3.5);
    count.anchor.set(0.5);
    count.position.set(cx, by + barH / 2);
    root.addChild(count);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      cat.onTap();
    });
    return root;
  }

  private _paintGrid(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    const cols = 3;
    const gap = 10;
    const cellW = (width - gap * (cols - 1)) / cols;
    const dish = this._view.kind === 'dish';
    const cellH = dish ? 172 : 148;
    const iconH = dish ? 120 : 88;
    const iconY = dish ? 68 : 58;
    const labelY = dish ? 136 : 112;
    let entries: Array<{ id: string; name: string; blurb: string; unlocked: boolean; dish: boolean; rarity: Rarity }>;
    if (this._view.kind === 'food') {
      entries = foodsInCat(this._view.cat).map((it) => ({
        id: it.id,
        name: it.name,
        blurb: it.blurb,
        unlocked: isFoodUnlocked(save, it.id),
        dish: false,
        rarity: it.rarity,
      }));
    } else if (this._view.kind === 'dish') {
      entries = dishesInGroup(this._view.group).map((it) => ({
        id: it.id,
        name: it.name,
        blurb: it.blurb,
        unlocked: isDishUnlocked(save, it.id),
        dish: true,
        rarity: it.rarity,
      }));
    } else {
      entries = [];
    }
    if (!entries.length) {
      const empty = makeLabel('这类还没收过货。', 22, MUTED);
      empty.position.set(12, 16);
      list.addChild(empty);
      return 48;
    }
    entries.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new PIXI.Container();
      card.position.set(col * (cellW + gap), row * (cellH + gap));
      const g = new PIXI.Graphics();
      g.lineStyle(2, INK, 1);
      g.beginFill(it.unlocked ? 0xF4EFE6 : 0xE4D8C8);
      g.drawRoundedRect(0, 0, cellW, cellH, 12);
      g.endFill();
      // 没解锁的也描边：让人看见图鉴里还缺着哪一格紫的
      drawRarityFrame(g, 2, 2, cellW - 4, cellH - 4, it.rarity, { radius: 12 });
      card.addChild(g);
      const tex = it.dish ? dishTexture(it.id) : itemTexture(it.id);
      const path = it.dish ? `subpkg_images/dish_${it.id}.png` : `subpkg_images/${it.id}.png`;
      const spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5);
      spr.position.set(cellW / 2, iconY);
      const fitIcon = (): void => {
        fitSpriteInBox(spr, cellW - (dish ? 8 : 20), iconH);
        if (!it.unlocked) applyGray(spr);
      };
      if (isTextureReady(tex)) fitIcon();
      else whenTextureReady(path, fitIcon);
      card.addChild(spr);
      const label = makeDexName(it.unlocked ? it.name : '未解锁', dish ? 20 : 18, it.unlocked, cellW - 10);
      label.anchor.set(0.5, 0);
      label.position.set(cellW / 2, labelY);
      card.addChild(label);
      card.eventMode = 'static';
      card.cursor = it.unlocked ? 'pointer' : 'default';
      card.hitArea = new PIXI.Rectangle(0, 0, cellW, cellH);
      card.on('pointertap', () => {
        if (this._dragMoved || !it.unlocked) return;
        this._inspect = { title: it.name, blurb: it.blurb };
        this.relayout();
      });
      list.addChild(card);
    });
    return Math.ceil(entries.length / cols) * (cellH + gap);
  }

  private _drawFooter(shell: PIXI.Container, bw: number, bh: number, page: { x: number; w: number }): void {
    if (this._view.kind === 'home') return;
    const btn = makeSlicedButton({
      label: '返回',
      width: Math.min(220, page.w),
      height: 52,
      skin: 'terracotta',
      onReady: this._scheduleRelayout,
    });
    btn.position.set(page.x + (page.w - Math.min(220, page.w)) / 2, bh - 83);
    btn.on('pointertap', () => {
      this._view = { kind: 'home' };
      this._scrollY = 0;
      this._inspect = null;
      this.relayout();
    });
    shell.addChild(btn);
    void bw;
  }

  private _scheduleRelayout = (): void => {
    if (!this.visible || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this.visible) this.relayout();
    });
  };

  private _applyScroll(y: number): void {
    this._scrollY = this._scrollMax <= 0 ? 0 : Math.max(-this._scrollMax, Math.min(0, y));
    if (this._scrollList) this._scrollList.y = this._scrollBaseY + this._scrollY;
  }

  private _inScroll(p: { x: number; y: number }): boolean {
    const r = this._scrollHit;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  private _wxPoint(res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>; changedTouches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): { x: number; y: number } | null {
    const t = res.touches?.[0] ?? res.changedTouches?.[0];
    if (!t) return null;
    const scale = Game.contentScale || 1;
    return {
      x: (t.clientX ?? t.x ?? 0) / scale,
      y: (t.clientY ?? t.y ?? 0) / scale,
    };
  }

  private _beginDrag(y: number): void {
    this._dragging = true;
    this._dragMoved = false;
    this._dragY = y;
    this._dragStart = this._scrollY;
  }

  private _moveDrag(y: number): void {
    if (!this._dragging) return;
    const dy = y - this._dragY;
    if (Math.abs(dy) > 6) this._dragMoved = true;
    this._applyScroll(this._dragStart + dy);
  }

  private _onPtrDown = (e: PIXI.FederatedPointerEvent): void => {
    if (!this.visible) return;
    const p = this.toLocal(e.global);
    if (!this._inScroll(p)) return;
    this._beginDrag(p.y);
  };

  private _onPtrMove = (e: PIXI.FederatedPointerEvent): void => {
    if (!this.visible) return;
    this._moveDrag(this.toLocal(e.global).y);
  };

  private _onPtrUp = (): void => {
    this._dragging = false;
  };

  private _onWheel = (e: PIXI.FederatedWheelEvent): void => {
    if (!this.visible || this._scrollMax <= 0) return;
    const p = this.toLocal(e.global);
    if (!this._inScroll(p)) return;
    this._applyScroll(this._scrollY - e.deltaY);
  };

  private _onWxStart = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): void => {
    if (!this.visible) return;
    const p = this._wxPoint(res);
    if (!p || !this._inScroll(p)) return;
    this._beginDrag(p.y);
  };

  private _onWxMove = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): void => {
    if (!this.visible) return;
    const p = this._wxPoint(res);
    if (!p) return;
    this._moveDrag(p.y);
  };

  private _onWxEnd = (): void => {
    this._dragging = false;
  };

  private _bindWx(on: boolean): void {
    const api = Platform.api;
    if (!api?.onTouchMove) return;
    if (on && !this._wxBound) {
      try { api.onTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.onTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.onTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.onTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = true;
    } else if (!on && this._wxBound) {
      try { api.offTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.offTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.offTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.offTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = false;
    }
  }
}
