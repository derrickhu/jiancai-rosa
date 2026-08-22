import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RECIPES, recipeUnlockView, unlockedRecipes } from '@/sim';
import { fillRect, makeButton, makeLabel } from '@/utils/ui';

export class RecipeBookPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 25;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.55;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const panel = new PIXI.Graphics();
    fillRect(panel, 30, Game.safeTop + 20, w - 60, h - Game.safeTop - 40, 0x3A3228, 18);
    panel.eventMode = 'static';
    this._root.addChild(panel);

    const view = recipeUnlockView(KitchenManager.save);
    const known = unlockedRecipes(view);
    const cooked = new Set(KitchenManager.save.recipesCooked);
    const title = makeLabel(`菜谱  已会 ${known.length}/${RECIPES.length}`, 30, 0xF4EFE6);
    title.position.set(54, Game.safeTop + 40);
    this._root.addChild(title);
    const hint = makeLabel('没解锁的不写名字。做过的会打个勾。', 20, 0xC9B8A4);
    hint.position.set(54, Game.safeTop + 80);
    this._root.addChild(hint);

    const listTop = Game.safeTop + 120;
    const listH = h - listTop - 120;
    const list = new PIXI.Container();
    let y = 0;
    for (const r of known) {
      const done = cooked.has(r.id);
      const name = makeLabel(`${done ? '✓ ' : ''}${r.name}`, 26, done ? 0xC8E6A0 : 0xF4EFE6);
      name.position.set(54, y);
      list.addChild(name);
      const desc = makeLabel(r.desc, 20, 0xC9B8A4);
      desc.position.set(54, y + 32);
      list.addChild(desc);
      y += 80;
    }
    list.y = listTop;
    const maxScroll = Math.max(0, y - listH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(40, listTop, w - 80, listH);
      mask.endFill();
      this._root.addChild(mask);
      list.mask = mask;
      list.eventMode = 'static';
      list.hitArea = new PIXI.Rectangle(40, 0, w - 80, y);
      let lastY = 0;
      let dragging = false;
      list.on('pointerdown', (e) => { dragging = true; lastY = e.global.y; });
      list.on('pointerup', () => { dragging = false; });
      list.on('pointerupoutside', () => { dragging = false; });
      list.on('pointermove', (e) => {
        if (!dragging) return;
        const next = list.y + (e.global.y - lastY);
        list.y = Math.min(listTop, Math.max(listTop - maxScroll, next));
        lastY = e.global.y;
      });
    }
    this._root.addChild(list);

    const close = makeButton('合上', w - 108, 56, 0xC46A3A);
    close.position.set(54, h - 100);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);
  }
}
