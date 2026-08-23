import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  RARITY_STYLE,
  itemRarity,
  rarityLabel,
  recipeCanCook,
  recipeCookCount,
  recipeNeeds,
  recipeUnlockView,
  recipeXp,
  unlockedRecipes,
  type RecipeId,
} from '@/sim';
import { FONT, drawRarityFrame, fillRect, makeLabel } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  whenTextureReady,
} from '@/utils/assets';

const BG = 'subpkg_kitchen/ui_cook_panel.png';
const INK = 0x2A2018;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;
const MUTED = 0x8A6A40;
const OK = 0x5C6B4A;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const COOK_BTN = 'subpkg_kitchen/ui_cook_btn.png';
const BTN = {
  cream: 'subpkg_kitchen/ui_fridge_btn_cream.png',
  terracotta: 'subpkg_kitchen/ui_fridge_btn_terracotta.png',
} as const;

/** 相对砧板纸面（左有木铲，内容整体右移）。 */
const PAGE = { x: 0.22, y: 0.10, w: 0.64, h: 0.72 };
const INSET = { x: 0.22, y: 0.20, w: 0.64, h: 0.58 };
const LEFT_W = 0.36;

export class CookPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _pick: RecipeId = 'stirfry';
  private _btnSlices = new Map<string, { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture }>();
  private _scroller: VerticalScroller;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 23;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
  }

  open(): void {
    this._isOpen = true;
    this.visible = true;
    const known = unlockedRecipes(recipeUnlockView(KitchenManager.save));
    if (!known.some((r) => r.id === this._pick)) this._pick = known[0]?.id ?? 'stirfry';
    this._scroller.reset();
    this._scroller.enable();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._scroller.disable();
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
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
    this._paintBg(shell, box.w, box.h);

    shell.addChild(this._title(box.w * (PAGE.x + PAGE.w * 0.5), box.h * (PAGE.y + 0.045)));
    shell.addChild(this._sideList(box.x, box.y, box.w, box.h));
    shell.addChild(this._stage(box.w, box.h));
  }

  private _boardBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const top = Game.safeTop + 4;
    const maxW = screenW - 20;
    const maxH = screenH - top - 8;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1267;
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
      fillRect(g, 0, 0, width, height, 0x8B5A2B, 28);
      fillRect(g, width * 0.14, height * 0.1, width * 0.72, height * 0.72, 0xF6EDE0, 16);
    host.addChild(g);
  }

  private _title(cx: number, cy: number): PIXI.Container {
    const root = new PIXI.Container();
    const name = new PIXI.Text('烹  饪', {
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

  private _sideList(ox: number, oy: number, bw: number, bh: number): PIXI.Container {
    const root = new PIXI.Container();
    const x = bw * INSET.x;
    const y = bh * INSET.y;
    const width = bw * INSET.w * LEFT_W;
    const view = recipeUnlockView(KitchenManager.save);
    const known = unlockedRecipes(view);
    const head = makeLabel(`菜谱  ${known.length}`, 26, INK, { fontWeight: '700' });
    head.position.set(x + 8, y + 2);
    root.addChild(head);

    const listTop = y + 38;
    const listH = bh * (INSET.y + INSET.h) - listTop - 8;
    const list = new PIXI.Container();
    const groups = [...new Set(known.map((r) => r.group))];
    let cy = 0;
    const rowW = width - 12;
    for (const group of groups) {
      const tag = makeLabel(group, 18, TERRACOTTA, { fontWeight: '700' });
      tag.position.set(x + 10, cy);
      list.addChild(tag);
      cy += 28;
      for (const recipe of known.filter((r) => r.group === group)) {
        const on = this._pick === recipe.id;
        const row = this._chip(recipe.name, rowW, 44, on ? 'on' : 'off');
        // 行首一道色条，翻列表时不用点开就知道这本值不值得攒材料
        const tab = new PIXI.Graphics();
        tab.beginFill(RARITY_STYLE[recipe.rarity].frame, 1);
        tab.drawRoundedRect(7, 11, 6, 22, 3);
        tab.endFill();
        tab.eventMode = 'none';
        row.addChild(tab);
        const can = recipeCookCount(view, recipe.id);
        row.alpha = can > 0 || on ? 1 : 0.75;
        if (can > 0) row.addChild(this._readyBadge(rowW, can));
        row.position.set(x + 6, cy);
        row.on('pointertap', () => {
          if (this._scroller.moved) return;
          this._pick = recipe.id;
          this.relayout();
        });
        list.addChild(row);
        cy += 52;
      }
      cy += 10;
    }
    const maxScroll = Math.max(0, cy - listH);
    list.y = listTop;
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(x, listTop, width, listH);
      mask.endFill();
      mask.eventMode = 'none';
      root.addChild(mask);
      list.mask = mask;
    }
    root.addChild(list);
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: { x: ox + x, y: oy + listTop, w: width, h: listH },
    });
    return root;
  }

  private _stage(bw: number, bh: number): PIXI.Container {
    const root = new PIXI.Container();
    const view = recipeUnlockView(KitchenManager.save);
    const recipe = unlockedRecipes(view).find((r) => r.id === this._pick) ?? unlockedRecipes(view)[0];
    if (!recipe) return root;
    this._pick = recipe.id;
    const needs = recipeNeeds(view, recipe.id);
    const ready = recipeCanCook(view, recipe.id);

    const pad = bw * 0.02;
    const dx = bw * (INSET.x + INSET.w * LEFT_W) + pad;
    const dy = bh * INSET.y;
    const dw = bw * INSET.w * (1 - LEFT_W) - pad;
    const dh = bh * INSET.h * 0.36;
    const dishPath = `subpkg_images/dish_${recipe.id}.png`;
    whenTextureReady(dishPath, () => {
      if (this._isOpen) this.relayout();
    });
    const frame = new PIXI.Graphics();
    drawRarityFrame(frame, dx + 2, dy + 2, dw - 4, dh - 4, recipe.rarity, { radius: 14 });
    frame.eventMode = 'none';
    root.addChild(frame);

    const dish = new PIXI.Sprite(dishTexture(recipe.id));
    fitSpriteInBox(dish, dw * 0.86, dh * 0.86);
    dish.anchor.set(0.5);
    dish.position.set(dx + dw / 2, dy + dh / 2);
    dish.eventMode = 'none';
    root.addChild(dish);

    const name = makeLabel(recipe.name, 24, INK, { fontWeight: '700' });
    name.anchor.set(0.5);
    name.position.set(dx + dw / 2, dy + dh + 10);
    root.addChild(name);
    const xp = recipeXp(KitchenManager.save, recipe.id);
    const xpLabel = makeLabel(
      `${rarityLabel(recipe.rarity)}  ·  +${xp} 经验`,
      16,
      RARITY_STYLE[recipe.rarity].ink,
      { fontWeight: '700' },
    );
    xpLabel.anchor.set(0.5);
    xpLabel.position.set(dx + dw / 2, dy + dh + 34);
    root.addChild(xpLabel);

    const tx = dx;
    const ty = dy + dh + 48;
    const tw = dw;
    const th = bh * (INSET.y + INSET.h) - ty;
    const blurb = new PIXI.Text(recipe.blurb, {
      fontFamily: FONT,
      fontSize: 16,
      fill: MUTED,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: Math.max(80, tw - 20),
      lineHeight: 24,
    });
    blurb.position.set(tx + 8, ty + 6);
    blurb.eventMode = 'none';
    root.addChild(blurb);

    const slot = Math.min(78, (tw - 20) / Math.max(2, needs.length));
    const gap = 10;
    const rowW = needs.length * slot + (needs.length - 1) * gap;
    let sx = tx + (tw - rowW) / 2;
    const slotY = ty + 10 + blurb.height + 8;
    needs.forEach((need) => {
      root.addChild(this._needSlot(sx, slotY, slot, need.label, need.iconId, need.have, need.need));
      sx += slot + gap;
    });

    const btnH = 62;
    const btn = this._cookAction(tw - 8, btnH, ready);
    btn.position.set(tx + 4, ty + th - btnH - 4);
    root.addChild(btn);
    return root;
  }

  private _cookAction(width: number, height: number, ready: boolean): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(COOK_BTN, () => {
      if (this._isOpen) this.relayout();
    });
    const slices = this._buttonSlices(COOK_BTN);
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
      const bg = new PIXI.Graphics();
      bg.lineStyle(3, INK, 1);
      bg.beginFill(TERRACOTTA);
      bg.drawRoundedRect(0, 0, width, height, height / 2);
      bg.endFill();
      root.addChild(bg);
    }
    const text = makeLabel('烹饪', Math.min(28, height * 0.42), PAPER, { fontWeight: '700' });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2 + 1);
    root.addChild(text);
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    if (ready) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.alpha = 1;
      root.on('pointertap', () => {
        KitchenManager.cook(this._pick);
        if (this._isOpen) this.relayout();
      });
    } else {
      root.eventMode = 'none';
      root.alpha = 0.42;
    }
    return root;
  }

  private _needSlot(
    x: number,
    y: number,
    size: number,
    label: string,
    iconId: string,
    have: number,
    need: number,
  ): PIXI.Container {
    const ok = have >= need;
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(PAPER, 0.9);
    bg.drawRoundedRect(x, y, size, size, 12);
    bg.endFill();
    drawRarityFrame(bg, x + 2, y + 2, size - 4, size - 4, itemRarity(iconId), { radius: 12 });
    if (ok) {
      bg.lineStyle(2, OK, 0.85);
      bg.drawRoundedRect(x, y, size, size, 12);
    }
    root.addChild(bg);

    const path = `subpkg_images/${iconId}.png`;
    whenTextureReady(path, () => {
      if (this._isOpen) this.relayout();
    });
    const icon = new PIXI.Sprite(itemTexture(iconId));
    fitSpriteInBox(icon, size - 20, size - 26);
    icon.anchor.set(0.5);
    icon.position.set(x + size / 2, y + size / 2 - 6);
    icon.eventMode = 'none';
    if (!ok) icon.alpha = 0.45;
    root.addChild(icon);

    const count = makeLabel(`${have}/${need}`, 15, ok ? OK : TERRACOTTA, { fontWeight: '700' });
    count.anchor.set(0.5, 1);
    count.position.set(x + size / 2, y + size - 3);
    root.addChild(count);

    const name = makeLabel(label, 14, INK, { fontWeight: '600' });
    name.anchor.set(0.5, 0);
    name.position.set(x + size / 2, y + size + 4);
    root.addChild(name);
    return root;
  }

  private _readyBadge(rowW: number, count: number): PIXI.Container {
    const root = new PIXI.Container();
    const text = count > 99 ? '99+' : `${count}`;
    const wide = text.length > 1;
    const w = wide ? 28 : 22;
    const h = 22;
    const g = new PIXI.Graphics();
    g.beginFill(0xD94A3A, 1);
    g.drawRoundedRect(0, 0, w, h, h / 2);
    g.endFill();
    g.eventMode = 'none';
    const n = makeLabel(text, 13, PAPER, { fontWeight: '700' });
    n.anchor.set(0.5);
    n.position.set(w / 2, h / 2 + 0.5);
    root.addChild(g, n);
    root.eventMode = 'none';
    root.position.set(rowW - w + 4, -7);
    return root;
  }

  private _chip(label: string, width: number, height: number, kind: 'primary' | 'idle' | 'on' | 'off'): PIXI.Container {
    const path = kind === 'primary' || kind === 'on' ? BTN.terracotta : BTN.cream;
    const texts = {
      primary: PAPER,
      on: PAPER,
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
      const fills = { primary: TERRACOTTA, on: TERRACOTTA, idle: 0xE4D4BE, off: 0xF6EDE0 };
      const bg = new PIXI.Graphics();
      bg.lineStyle(3, INK, 1);
      bg.beginFill(fills[kind]);
      bg.drawRoundedRect(0, 0, width, height, height / 2);
      bg.endFill();
      root.addChild(bg);
    }
    const text = makeLabel(label, Math.min(20, height * 0.46), texts[kind], { fontWeight: '700' });
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
}
