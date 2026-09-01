import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager, type CookLevelUp } from '@/managers/KitchenManager';
import {
  RARITY_STYLE,
  marketsUnlockedBetween,
  recipeById,
  type MarketDef,
  type Rarity,
  type RecipeDef,
} from '@/sim';
import { fillRect, makeLabel, makePaperChip } from '@/utils/ui';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { ensureRecipeUnlockPanel } from './RecipeUnlockPanel';

const BURST = 'subpkg_kitchen/ui_result_burst.png';
const TITLE = 'subpkg_kitchen/ui_cook_level_title.png';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const GOLD = 0xE0A100;
const CREAM = 0xFFF6E8;
const INK = 0x2A2018;
const LEVEL_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

function levelName(n: number): string {
  return `${LEVEL_CN[n] ?? n}级`;
}

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
    const art = n <= 1 ? 240 : n <= 2 ? 200 : 168;
    const gap = 22;
    const cardH = art + 52;
    const gridW = n ? cols * art + (cols - 1) * gap : 0;
    const gridH = n ? Math.ceil(n / cols) * cardH + (Math.ceil(n / cols) - 1) * 12 : 0;
    const marketSize = markets.length <= 1 ? 220 : 180;
    const marketH = markets.length ? marketSize + 36 : 0;

    const stack = new PIXI.Container();
    stack.eventMode = 'none';
    this._root.addChild(stack);

    let y = 0;
    const titleW = Math.min(w - 20, 640);
    const titleH = Math.round(titleW * (220 / 502));
    const burst = this._burst(Math.max(420, gridW + 160, marketSize + 120));
    burst.position.set(0, titleH * 0.58);
    stack.addChild(burst);

    const title = this._titleBanner(titleW, titleH);
    title.position.set(-titleW / 2, y);
    stack.addChild(title);
    y += titleH - 8;

    const step = this._lvStep(data);
    step.position.set(-step.width / 2, y);
    stack.addChild(step);
    y += step.height + 18;

    const hasReward = n > 0 || markets.length > 0;
    let head: PIXI.Container | null = null;
    if (hasReward) {
      head = makePaperChip('升级奖励', { size: 20, color: 0x8B5A2B });
      head.position.set(-head.width / 2, y);
      stack.addChild(head);
      y += head.height + 14;
    }

    if (n) {
      recipes.forEach((recipe, i) => {
        const card = this._recipeCard(recipe, art);
        const col = i % cols;
        const row = Math.floor(i / cols);
        card.position.set(
          -gridW / 2 + col * (art + gap),
          y + row * (cardH + 12),
        );
        stack.addChild(card);
        if (celebrate) this._pop(card, 0.16 + i * 0.08);
      });
      y += gridH + 12;
    }
    if (markets.length) {
      const row = this._marketRow(markets, marketSize);
      row.position.set(-row.width / 2, y);
      stack.addChild(row);
      if (celebrate) this._pop(row, 0.2 + n * 0.08);
      y += marketH;
    }
    if (!hasReward) {
      const empty = makeLabel('手艺又精一截', 24, CREAM, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: '#2A2018',
        strokeThickness: 4,
      });
      empty.anchor.set(0.5, 0);
      empty.position.set(0, y);
      stack.addChild(empty);
      y += 36;
    }

    const top = Game.safeTop + 12;
    const bottom = h - Math.max(18, Game.safeBottom + 12);
    stack.position.set(w / 2, top + Math.max(0, (bottom - top - y) / 2));

    if (celebrate) {
      this._pop(title, 0);
      this._pop(step, 0.06);
      if (head) this._pop(head, 0.1);
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

  private _lvStep(data: CookLevelUp): PIXI.Container {
    const root = new PIXI.Container();
    const cap = makeLabel('厨艺', 20, 0xE8D4A8, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: '#2A2018',
      strokeThickness: 4,
    });
    const from = this._levelPill(levelName(data.from), 0xF4EDE0, 0x6A5848, 28);
    const mid = makeLabel('升到', 22, GOLD, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: '#2A2018',
      strokeThickness: 4,
    });
    const to = this._levelPill(levelName(data.to), 0xF2C14D, INK, 36);
    cap.anchor.set(0, 0.5);
    mid.anchor.set(0, 0.5);
    const h = Math.max(from.height, to.height);
    cap.position.set(0, h / 2);
    from.position.set(cap.width + 10, (h - from.height) / 2);
    mid.position.set(from.x + from.width + 12, h / 2);
    to.position.set(mid.x + mid.width + 12, (h - to.height) / 2);
    root.addChild(cap, from, mid, to);
    root.eventMode = 'none';
    return root;
  }

  private _levelPill(text: string, fill: number, ink: number, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const label = makeLabel(text, size, ink, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    const w = Math.ceil(label.width + 28);
    const h = Math.ceil(label.height + 12);
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 0.82);
    g.beginFill(fill);
    g.drawRoundedRect(0, 0, w, h, h / 2);
    g.endFill();
    label.anchor.set(0.5);
    label.position.set(w / 2, h / 2);
    root.addChild(g, label);
    root.eventMode = 'none';
    return root;
  }

  private _recipeCard(recipe: RecipeDef, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const dish = new PIXI.Sprite(dishTexture(recipe.id));
    const dishPath = `subpkg_images/dish_${recipe.id}.png`;
    const bindDish = (): void => {
      if (dish.destroyed) return;
      dish.texture = dishTexture(recipe.id);
      fitSpriteInBox(dish, size, size);
    };
    whenTextureReady(dishPath, bindDish);
    bindDish();
    dish.anchor.set(0.5);
    dish.position.set(size / 2, size / 2);
    dish.eventMode = 'none';
    root.addChild(dish);

    const bar = this._recipeNameBar(recipe.name, recipe.rarity);
    bar.position.set((size - bar.width) / 2, size + 6);
    root.addChild(bar);
    root.eventMode = 'none';
    return root;
  }

  private _recipeNameBar(name: string, rarity: Rarity): PIXI.Container {
    const root = new PIXI.Container();
    const style = RARITY_STYLE[rarity];
    const light = rarity === 'common';
    const tagInk = light ? CREAM : style.ink;
    const tagFill = light ? 0x8A7A68 : CREAM;
    const nameColor = light ? style.ink : CREAM;
    const tag = makeLabel('菜谱', 15, tagInk, { fontWeight: '700' });
    const title = makeLabel(name, 22, nameColor, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    const tagW = Math.ceil(tag.width + 14);
    const tagH = 24;
    const h = 38;
    const pad = 8;
    const w = pad + tagW + 8 + Math.ceil(title.width) + pad;
    const bg = new PIXI.Graphics();
    bg.beginFill(style.cell, light ? 0.96 : 0.9);
    bg.lineStyle(2, style.frame, 0.95);
    bg.drawRoundedRect(0, 0, w, h, 12);
    bg.endFill();
    const tagBg = new PIXI.Graphics();
    tagBg.beginFill(tagFill, 1);
    tagBg.drawRoundedRect(pad, (h - tagH) / 2, tagW, tagH, 8);
    tagBg.endFill();
    tag.anchor.set(0.5);
    tag.position.set(pad + tagW / 2, h / 2);
    title.anchor.set(0, 0.5);
    title.position.set(pad + tagW + 8, h / 2);
    root.addChild(bg, tagBg, tag, title);
    root.eventMode = 'none';
    return root;
  }

  private _marketRow(markets: MarketDef[], size: number): PIXI.Container {
    const root = new PIXI.Container();
    let x = 0;
    const gap = 24;
    for (const market of markets) {
      const card = new PIXI.Container();
      const thumb = new PIXI.Sprite(gameTexture(market.thumb));
      const bind = (): void => {
        if (thumb.destroyed) return;
        thumb.texture = gameTexture(market.thumb);
        fitSpriteInBox(thumb, size, size);
      };
      whenTextureReady(market.thumb, bind);
      bind();
      thumb.anchor.set(0.5, 0);
      thumb.position.set(size / 2, 0);
      thumb.eventMode = 'none';
      card.addChild(thumb);
      const name = makeLabel(market.name, 22, CREAM, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: '#2A2018',
        strokeThickness: 5,
      });
      name.anchor.set(0.5, 0);
      name.position.set(size / 2, size + 6);
      card.addChild(name);
      card.position.set(x, 0);
      root.addChild(card);
      x += size + gap;
    }
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
