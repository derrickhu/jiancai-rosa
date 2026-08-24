import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { recipeById } from '@/sim';
import { FONT, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

const PAPER = 'subpkg_kitchen/ui_recipe_paper.png';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const WALNUT = 0x8B5A2B;

export class RecipeUnlockPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    EventBus.on(EV.recipeUnlocked, () => this.present());
  }

  present(forceSound = false): void {
    if (!KitchenManager.peekRecipeUnlock()) return;
    if (forceSound || !this._isOpen) AudioManager.play('recipe_paper');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    const id = KitchenManager.peekRecipeUnlock();
    const recipe = id ? recipeById(id) : undefined;
    if (!id || !recipe) {
      this.close();
      return;
    }

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._advance());
    this._root.addChild(dim);

    whenTextureReady(PAPER, () => {
      if (this._isOpen && KitchenManager.peekRecipeUnlock() === id) this.relayout();
    });
    const dishPath = `subpkg_images/dish_${recipe.id}.png`;
    whenTextureReady(dishPath, () => {
      if (this._isOpen && KitchenManager.peekRecipeUnlock() === id) this.relayout();
    });

    const tex = gameTexture(PAPER);
    const paper = new PIXI.Container();
    const maxW = Math.min(w - 48, 520);
    const maxH = Math.min(h - Game.safeTop - 160, 720);
    let pw = maxW;
    let ph = maxH * 0.82;
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, maxW, maxH);
      sp.anchor.set(0.5, 0);
      sp.eventMode = 'none';
      pw = sp.width;
      ph = sp.height;
      paper.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.beginFill(0xF3E2C6);
      g.drawRoundedRect(-maxW / 2, 0, maxW, ph, 18);
      g.endFill();
      paper.addChild(g);
    }

    const dish = new PIXI.Sprite(dishTexture(recipe.id));
    fitSpriteInBox(dish, pw * 0.46, ph * 0.32);
    dish.anchor.set(0.5);
    dish.position.set(0, ph * 0.40);
    dish.eventMode = 'none';
    paper.addChild(dish);

    const head = new PIXI.Text('解锁新菜', {
      fontFamily: TITLE_FONT,
      fontSize: 26,
      fill: WALNUT,
      fontWeight: '700',
      stroke: '#F6EDE0',
      strokeThickness: 4,
    });
    head.anchor.set(0.5);
    head.eventMode = 'none';
    head.position.set(0, ph * 0.62);
    paper.addChild(head);

    const name = new PIXI.Text(recipe.name, {
      fontFamily: TITLE_FONT,
      fontSize: 36,
      fill: INK,
      fontWeight: '700',
      stroke: '#F6EDE0',
      strokeThickness: 5,
    });
    name.anchor.set(0.5);
    name.eventMode = 'none';
    name.position.set(0, ph * 0.72);
    paper.addChild(name);

    paper.eventMode = 'static';
    paper.hitArea = new PIXI.Rectangle(-pw / 2, 0, pw, ph);
    paper.on('pointertap', (e) => e.stopPropagation());
    paper.position.set(w / 2, Game.safeTop + Math.max(24, (h - Game.safeTop - ph - 88) / 2));
    this._root.addChild(paper);

    const more = KitchenManager.recipeUnlockLeft() > 1;
    const btn = makeSlicedButton({
      label: more ? '下一张' : '收下',
      width: 200,
      height: 52,
      skin: 'terracotta',
      onReady: () => {
        if (this._isOpen && KitchenManager.peekRecipeUnlock() === id) this.relayout();
      },
    });
    btn.position.set((w - 200) / 2, paper.y + ph + 16);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._advance();
    });
    this._root.addChild(btn);

    if (more) {
      const hint = makeLabel(`还有 ${KitchenManager.recipeUnlockLeft() - 1} 张`, 18, 0xF4EFE6, {
        fontFamily: FONT,
        fontWeight: '600',
      });
      hint.anchor.set(0.5);
      hint.position.set(w / 2, btn.y + 68);
      this._root.addChild(hint);
    }
  }

  private _advance(): void {
    KitchenManager.shiftRecipeUnlock();
    if (KitchenManager.peekRecipeUnlock()) {
      AudioManager.play('recipe_paper');
      this.relayout();
      return;
    }
    this.close();
  }
}

let _panel: RecipeUnlockPanel | null = null;

export function ensureRecipeUnlockPanel(): RecipeUnlockPanel {
  if (!_panel) _panel = new RecipeUnlockPanel();
  return _panel;
}
