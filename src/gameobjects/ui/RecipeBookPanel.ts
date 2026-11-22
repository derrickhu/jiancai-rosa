import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { listedRecipes, recipeEatLabel, recipeUnlockView, unlockedRecipes } from '@/sim';
import { dishTexture, fitSpriteInBox, isTextureReady, resolveDishAssetPath, watchTextures } from '@/utils/assets';
import {
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeLabel,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';

export class RecipeBookPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 25;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._scroller.disable();
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;

    const view = recipeUnlockView(KitchenManager.save);
    const known = unlockedRecipes(view);
    const cooked = new Set(KitchenManager.save.recipesCooked);
    const totalCount = listedRecipes(undefined, KitchenManager.save.recipesFound).length;

    watchTextures(
      [UI_KIT.headerRibbon, UI_KIT.closeRound, ...known.map((r) => resolveDishAssetPath(r.id))],
      () => {
        if (this._isOpen) this.relayout();
      },
    );

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const boxW = Math.min(w - 36, 680);
    const boxH = Math.min(h - Game.safeTop - 48, 1080);
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 22, (h - boxH) / 2));
    const padX = 26;
    const cw = boxW - padX * 2;
    const listTop = 94;
    const listH = boxH - listTop - 28;

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '私 房 菜 谱 册',
      subtitle: `已掌握 ${known.length}/${totalCount} 道 · 做过的菜已盖勾`,
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this.close(),
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    const list = new PIXI.Container();
    const rowH = 104;
    const rowGap = 10;
    let y = 0;
    for (const r of known) {
      const done = cooked.has(r.id);
      const card = new PIXI.Container();
      card.position.set(padX, y);
      const bg = new PIXI.Graphics();
      drawCraftCard(bg, 0, 0, cw, rowH, { radius: 16, tone: done ? 'olive' : 'ivory' });
      card.addChild(bg);

      const iconBg = new PIXI.Graphics();
      drawRecessedWell(iconBg, 14, 14, 76, 76, { radius: 14 });
      card.addChild(iconBg);

      const dTex = dishTexture(r.id);
      if (isTextureReady(dTex)) {
        const sp = new PIXI.Sprite(dTex);
        fitSpriteInBox(sp, 62, 62);
        sp.anchor.set(0.5);
        sp.position.set(52, 52);
        card.addChild(sp);
      }

      const name = makeLabel(`${done ? '✓ ' : ''}${r.name}`, 21, UI_PALETTE.ink, { fontWeight: '700' });
      name.position.set(104, 12);
      card.addChild(name);

      const desc = makeLabel(r.desc, 15, UI_PALETTE.muted);
      desc.position.set(104, 43);
      card.addChild(desc);

      const eat = makeLabel(`✦ ${recipeEatLabel(r.id)}`, 14, UI_PALETTE.olive, { fontWeight: '700' });
      eat.position.set(104, 69);
      card.addChild(eat);

      list.addChild(card);
      y += rowH + rowGap;
    }

    list.y = listTop;
    const contentH = Math.max(0, y - rowGap);
    const maxScroll = Math.max(0, contentH - listH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      fillRect(mask, padX - 2, listTop, cw + 4, listH, 0xffffff, 14);
      mask.eventMode = 'none';
      shell.addChild(mask);
      list.mask = mask;
    }
    shell.addChild(list);
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: { x: bx + padX, y: by + listTop, w: cw, h: listH },
    });
  }
}
