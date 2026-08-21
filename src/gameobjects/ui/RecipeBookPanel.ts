import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RECIPES } from '@/sim';
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

    const cooked = new Set(KitchenManager.save.recipesCooked);
    const title = makeLabel(`菜谱  ${cooked.size}/${RECIPES.length}`, 34, 0xF4EFE6);
    title.position.set(54, Game.safeTop + 40);
    this._root.addChild(title);
    const hint = makeLabel('做过的菜才会写进本子', 20, 0xC9B8A4);
    hint.position.set(54, Game.safeTop + 86);
    this._root.addChild(hint);

    let y = Game.safeTop + 140;
    for (const r of RECIPES) {
      const unlocked = cooked.has(r.id);
      const name = makeLabel(unlocked ? r.name : '???', 26, unlocked ? 0xF4EFE6 : 0x7A6B5C);
      name.position.set(54, y);
      this._root.addChild(name);
      const desc = makeLabel(
        unlocked ? r.desc : '还没做过',
        20,
        unlocked ? 0xC8E6A0 : 0x7A6B5C,
      );
      desc.position.set(54, y + 34);
      this._root.addChild(desc);
      y += 88;
    }

    const close = makeButton('合上', w - 108, 56, 0xC46A3A);
    close.position.set(54, h - 100);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);
  }
}
