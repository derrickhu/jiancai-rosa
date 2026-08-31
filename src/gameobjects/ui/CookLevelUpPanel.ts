import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager, type CookLevelUp } from '@/managers/KitchenManager';
import {
  marketsUnlockedBetween,
  recipeById,
  recipeRarity,
  type MarketDef,
  type RecipeId,
} from '@/sim';
import {
  drawRarityFrame,
  fillRect,
  makeLabel,
  makeRarityFlare,
  makeSlicedButton,
} from '@/utils/ui';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { ensureRecipeUnlockPanel } from './RecipeUnlockPanel';

const BURST = 'subpkg_kitchen/ui_result_burst.png';
const CARD = 'subpkg_kitchen/ui_result_card.png';
const TITLE = 'subpkg_kitchen/ui_cook_level_title.png';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const WALNUT = 0x8B5A2B;
const GOLD = 0xE0A100;
const CREAM = 0xFFF6E8;
const PAPER = 0xFFF8F0;

export class CookLevelUpPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _fx: PIXI.Container[] = [];
  private _celebrate = false;
  private _openedAt = 0;
  private _data: CookLevelUp | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 32;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    EventBus.on(EV.cookLeveled, () => this.present());
  }

  present(): void {
    if (!KitchenManager.peekCookLevelUp()) return;
    this._isOpen = true;
    this.visible = true;
    this._celebrate = true;
    this._openedAt = Date.now();
    this._data = KitchenManager.peekCookLevelUp();
    AudioManager.play('level_up');
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._stopFx();
    this._root.removeChildren();
  }

  relayout(): void {
    const data = this._data ?? KitchenManager.peekCookLevelUp();
    this._stopFx();
    this._root.removeChildren();
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) {
      this.close();
      return;
    }
    this._data = data;
    this._draw(data);
  }

  private _draw(data: CookLevelUp): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const celebrate = this._celebrate;
    this._celebrate = false;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.62;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._advance());
    this._root.addChild(dim);

    const recipes = data.recipes.map((id) => recipeById(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const markets = marketsUnlockedBetween(data.from, data.to);
    const n = recipes.length;
    const cols = n <= 1 ? 1 : n === 2 ? 2 : 3;
    const art = n <= 1 ? 176 : n <= 2 ? 150 : 124;
    const gap = 14;
    const gridW = n ? cols * art + (cols - 1) * gap : 0;
    const gridH = n ? Math.ceil(n / cols) * art + (Math.ceil(n / cols) - 1) * gap : 0;

    const stack = new PIXI.Container();
    stack.eventMode = 'passive';
    this._root.addChild(stack);

    let y = 0;
    const titleW = Math.min(w - 20, 640);
    const titleH = Math.round(titleW * (220 / 502));
    const burst = this._burst(Math.max(360, gridW + 120));
    burst.position.set(0, titleH * 0.52);
    stack.addChild(burst);

    const title = this._titleBanner(titleW, titleH);
    title.position.set(-titleW / 2, y);
    stack.addChild(title);
    y += titleH + 4;

    const seal = this._seal(data);
    seal.position.set(-seal.width / 2, y);
    stack.addChild(seal);
    y += seal.height + 10;

    const step = makeLabel(`${data.from} 级  →  ${data.to} 级`, 20, GOLD, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: '#2A2018',
      strokeThickness: 4,
    });
    step.anchor.set(0.5, 0);
    step.position.set(0, y);
    stack.addChild(step);
    y += 36;

    const sheetW = Math.min(w - 40, Math.max(340, gridW + 48, markets.length ? 360 : 0));
    const sheetPad = 20;
    const headH = 28;
    const marketH = markets.length ? 92 : 0;
    const emptyH = !n && !markets.length ? 36 : 0;
    const sheetH = sheetPad + headH + (n ? gridH + 8 : 0) + marketH + emptyH + sheetPad;
    const sheet = this._sheet(sheetW, sheetH);
    sheet.position.set(-sheetW / 2, y);
    stack.addChild(sheet);

    const head = makeLabel(n || markets.length ? '升级奖励' : '手艺又精一截', 20, WALNUT, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    head.anchor.set(0.5, 0);
    head.position.set(0, y + sheetPad - 2);
    stack.addChild(head);

    let innerY = y + sheetPad + headH;
    if (n) {
      recipes.forEach((recipe, i) => {
        const card = this._recipeCard(recipe.id, recipe.name, art);
        const col = i % cols;
        const row = Math.floor(i / cols);
        card.position.set(
          -gridW / 2 + col * (art + gap),
          innerY + row * (art + gap),
        );
        stack.addChild(card);
        if (celebrate) this._pop(card, 0.18 + i * 0.08);
      });
      innerY += gridH + 8;
    }
    if (markets.length) {
      const row = this._marketRow(markets, sheetW - 32);
      row.position.set(-row.width / 2, innerY);
      stack.addChild(row);
      if (celebrate) this._pop(row, 0.22 + n * 0.08);
      innerY += marketH;
    }
    if (!n && !markets.length) {
      const empty = makeLabel('继续做菜，火候更稳了', 18, 0x8A6A40, { fontWeight: '600' });
      empty.anchor.set(0.5, 0);
      empty.position.set(0, innerY);
      stack.addChild(empty);
    }
    y += sheetH + 18;

    const btnW = 220;
    const btn = makeSlicedButton({
      label: KitchenManager.cookLevelUpLeft() > 1 ? '继续' : '收下',
      width: btnW,
      height: 52,
      skin: 'terracotta',
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    btn.eventMode = 'static';
    btn.position.set(-btnW / 2, y);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._advance(true);
    });
    const btnWrap = new PIXI.Container();
    btnWrap.addChild(btn);
    stack.addChild(btnWrap);
    y += 52;

    const top = Game.safeTop + 12;
    const bottom = h - Math.max(18, Game.safeBottom + 12);
    stack.position.set(w / 2, top + Math.max(0, (bottom - top - y) / 2));
    btnWrap.eventMode = 'static';

    if (celebrate) {
      this._pop(title, 0);
      this._pop(seal, 0.06);
      this._pop(step, 0.1);
      this._pop(sheet, 0.12);
      this._pop(head, 0.14);
      this._pop(btnWrap, 0.28);
      this._spin(burst);
      this._pulse(burst);
      this._sparks(w / 2, stack.y + titleH * 0.52);
      if (n) {
        globalThis.setTimeout?.(() => {
          if (this._isOpen) AudioManager.play('item_reveal');
        }, 280);
      }
    }
  }

  private _titleBanner(width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const sp = new PIXI.Sprite(gameTexture(TITLE));
    const bind = (): void => {
      if (sp.destroyed) return;
      sp.texture = gameTexture(TITLE);
      if (!isTextureReady(sp.texture)) return;
      const scale = width / Math.max(1, sp.texture.width);
      sp.width = width;
      sp.height = sp.texture.height * scale;
      sp.position.set(0, Math.max(0, (height - sp.height) / 2));
    };
    whenTextureReady(TITLE, bind);
    bind();
    sp.eventMode = 'none';
    root.addChild(sp);
    if (!isTextureReady(sp.texture)) {
      const fallback = makeLabel('恭喜厨艺升级', 36, 0xF6D56A, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: 0x2A2018,
        strokeThickness: 6,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(width / 2, height / 2);
      root.addChild(fallback);
    }
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    root.eventMode = 'none';
    return root;
  }

  private _seal(data: CookLevelUp): PIXI.Container {
    const root = new PIXI.Container();
    const size = 128;
    const g = new PIXI.Graphics();
    g.beginFill(0x000000, 0.16);
    g.drawCircle(size / 2 + 3, size / 2 + 5, size / 2 - 2);
    g.endFill();
    g.lineStyle(5, INK, 1);
    g.beginFill(0xF2C14D);
    g.drawCircle(size / 2, size / 2, size / 2 - 4);
    g.endFill();
    g.lineStyle(2, 0xFFF3C4, 0.9);
    g.drawCircle(size / 2, size / 2, size / 2 - 12);
    root.addChild(g);
    const cap = makeLabel('厨艺', 16, WALNUT, { fontFamily: TITLE_FONT, fontWeight: '700' });
    cap.anchor.set(0.5);
    cap.position.set(size / 2, 34);
    root.addChild(cap);
    const lv = new PIXI.Text(`${data.to}`, {
      fontFamily: TITLE_FONT,
      fontSize: data.to >= 10 ? 42 : 52,
      fill: INK,
      fontWeight: '700',
    });
    lv.anchor.set(0.5);
    lv.position.set(size / 2, 76);
    lv.eventMode = 'none';
    root.addChild(lv);
    root.eventMode = 'none';
    return root;
  }

  private _sheet(width: number, height: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.lineStyle(3, 0xC4A574, 1);
    g.beginFill(PAPER, 0.94);
    g.drawRoundedRect(0, 0, width, height, 18);
    g.endFill();
    g.eventMode = 'none';
    return g;
  }

  private _recipeCard(id: RecipeId, name: string, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const flare = makeRarityFlare(recipeRarity(id), size * 1.15);
    flare.position.set(size / 2, size / 2 - 8);
    root.addChild(flare);

    const frame = new PIXI.Sprite(gameTexture(CARD));
    const bindCard = (): void => {
      if (frame.destroyed) return;
      frame.texture = gameTexture(CARD);
      fitSpriteInBox(frame, size, size);
    };
    whenTextureReady(CARD, bindCard);
    bindCard();
    frame.anchor.set(0.5);
    frame.position.set(size / 2, size / 2 - 6);
    frame.eventMode = 'none';
    root.addChild(frame);

    const dish = new PIXI.Sprite(dishTexture(id));
    const dishPath = `subpkg_images/dish_${id}.png`;
    const bindDish = (): void => {
      if (dish.destroyed) return;
      dish.texture = dishTexture(id);
      fitSpriteInBox(dish, size * 0.58, size * 0.5);
    };
    whenTextureReady(dishPath, bindDish);
    bindDish();
    dish.anchor.set(0.5);
    dish.position.set(size / 2, size * 0.42);
    dish.eventMode = 'none';
    root.addChild(dish);

    const ring = new PIXI.Graphics();
    drawRarityFrame(ring, 10, 8, size - 20, size - 28, recipeRarity(id), { radius: 14 });
    ring.eventMode = 'none';
    root.addChild(ring);

    const label = makeLabel(name, 16, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: CREAM,
      strokeThickness: 3,
    });
    label.anchor.set(0.5, 1);
    label.position.set(size / 2, size - 8);
    root.addChild(label);
    root.eventMode = 'none';
    return root;
  }

  private _marketRow(markets: MarketDef[], maxW: number): PIXI.Container {
    const root = new PIXI.Container();
    const cap = makeLabel('新菜场', 16, WALNUT, { fontWeight: '700' });
    cap.position.set(0, 0);
    root.addChild(cap);
    let x = 0;
    const tile = 72;
    const gap = 10;
    const row = new PIXI.Container();
    for (const market of markets) {
      const card = new PIXI.Container();
      const bg = new PIXI.Graphics();
      bg.lineStyle(2, 0xC4A574, 1);
      bg.beginFill(0xFFF8F0, 0.96);
      bg.drawRoundedRect(0, 0, tile + 36, tile, 10);
      bg.endFill();
      card.addChild(bg);
      const thumb = new PIXI.Sprite(gameTexture(market.thumb));
      const bind = (): void => {
        if (thumb.destroyed) return;
        thumb.texture = gameTexture(market.thumb);
        fitSpriteInBox(thumb, tile - 8, tile - 22);
      };
      whenTextureReady(market.thumb, bind);
      bind();
      thumb.anchor.set(0.5, 0);
      thumb.position.set((tile + 36) / 2, 6);
      thumb.eventMode = 'none';
      card.addChild(thumb);
      const name = makeLabel(market.name, 13, INK, { fontWeight: '700' });
      name.anchor.set(0.5, 1);
      name.position.set((tile + 36) / 2, tile - 4);
      card.addChild(name);
      card.position.set(x, 0);
      row.addChild(card);
      x += tile + 36 + gap;
    }
    const total = Math.max(cap.width, x - gap);
    cap.position.set((Math.min(maxW, total) - cap.width) / 2, 0);
    row.position.set((Math.min(maxW, total) - (x - gap)) / 2, 18);
    root.addChild(row);
    root.eventMode = 'none';
    return root;
  }

  private _burst(side: number): PIXI.Sprite {
    const burst = new PIXI.Sprite(gameTexture(BURST));
    const bind = (): void => {
      if (burst.destroyed) return;
      burst.texture = gameTexture(BURST);
      burst.width = side;
      burst.height = side;
    };
    whenTextureReady(BURST, bind);
    bind();
    burst.anchor.set(0.5);
    burst.blendMode = PIXI.BLEND_MODES.ADD;
    burst.alpha = 0.9;
    burst.eventMode = 'none';
    this._fx.push(burst);
    return burst;
  }

  private _spin(burst: PIXI.Sprite): void {
    const turn = (): void => {
      if (!this._isOpen || burst.destroyed) return;
      TweenManager.to({
        target: burst,
        props: { rotation: burst.rotation + Math.PI * 2 },
        duration: 14,
        ease: Ease.linear,
        onComplete: turn,
      });
    };
    turn();
  }

  private _pulse(burst: PIXI.Sprite): void {
    burst.alpha = 0;
    burst.scale.set(0.7);
    TweenManager.to({
      target: burst,
      props: { alpha: 0.92 },
      duration: 0.36,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: burst.scale,
      props: { x: 1, y: 1 },
      duration: 0.42,
      ease: Ease.easeOutQuad,
    });
  }

  private _sparks(x: number, y: number): void {
    const colors = [0xF2C14D, 0xFFF6E8, 0xE07A3A, 0xC4A574];
    for (let i = 0; i < 22; i++) {
      const dot = new PIXI.Graphics();
      const r = 2 + Math.random() * 3.5;
      dot.beginFill(colors[i % colors.length], 0.95);
      dot.drawCircle(0, 0, r);
      dot.endFill();
      dot.position.set(x, y);
      dot.eventMode = 'none';
      this._root.addChild(dot);
      this._fx.push(dot);
      const ang = (Math.PI * 2 * i) / 22 + Math.random() * 0.4;
      const dist = 70 + Math.random() * 120;
      TweenManager.to({
        target: dot,
        props: {
          x: x + Math.cos(ang) * dist,
          y: y + Math.sin(ang) * dist,
          alpha: 0,
        },
        duration: 0.7 + Math.random() * 0.35,
        delay: 0.04 + Math.random() * 0.12,
        ease: Ease.easeOutQuad,
      });
    }
  }

  private _pop(target: PIXI.Container, delay: number): void {
    this._fx.push(target);
    target.alpha = 0;
    target.scale.set(0.72);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.24,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: 1, y: 1 },
      duration: 0.3,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopFx(): void {
    for (const node of this._fx) {
      TweenManager.cancelTarget(node);
      TweenManager.cancelTarget(node.scale);
    }
    this._fx = [];
  }

  private _advance(force = false): void {
    if (!force && Date.now() - this._openedAt < 520) return;
    KitchenManager.shiftCookLevelUp();
    if (KitchenManager.peekCookLevelUp()) {
      this._celebrate = true;
      this._openedAt = Date.now();
      this._data = KitchenManager.peekCookLevelUp();
      AudioManager.play('level_up');
      this.relayout();
      return;
    }
    this.close();
    ensureRecipeUnlockPanel().present();
  }
}

let _panel: CookLevelUpPanel | null = null;

export function ensureCookLevelUpPanel(): CookLevelUpPanel {
  if (!_panel) _panel = new CookLevelUpPanel();
  return _panel;
}
