import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  RARITY_STYLE,
  rarityLabel,
  recipeById,
  recipeEatLabel,
  recipeNeeds,
  recipeSellPrice,
  recipeUnlockView,
} from '@/sim';
import {
  FONT,
  HUD_ICON,
  UI_KIT,
  attachSpriteContour,
  fitTextWidth,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import { TutorialOverlay } from './TutorialOverlay';
import {
  SCENE_INK,
  drawInkDivider,
  makeDishDisplay,
  makeRaritySeal,
  makeSealStamp,
  makeSceneRoot,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  paper: 'subpkg_kitchen/ui_recipe_paper.png',
  cushion: 'subpkg_images/scene_gacha_cushion.png',
} as const;

const W = 660;
const H = 1058;

export class RecipeUnlockPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _paintQueued = false;
  private _stampedId: string | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    EventBus.on(EV.recipeUnlocked, () => this.present());
  }

  present(forceSound: boolean | { silent?: boolean } = false): void {
    if (!KitchenManager.peekRecipeUnlock()) return;
    const silent = typeof forceSound === 'object' && !!forceSound.silent;
    if (!silent && (forceSound === true || !this._isOpen)) AudioManager.play('recipe_paper');
    this._isOpen = true;
    this.visible = true;
    this._stampedId = null;
    this.relayout();
    OverlayManager.bringToFront();
    TutorialOverlay.refresh();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._paintQueued = false;
    this._stampedId = null;
    destroyDisplayChildren(this._root);
    TutorialOverlay.refresh();
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen) this.relayout();
    });
  };

  relayout(): void {
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;

    const id = KitchenManager.peekRecipeUnlock();
    const recipe = id ? recipeById(id) : undefined;
    if (!id || !recipe) {
      this.close();
      return;
    }

    const view = recipeUnlockView(KitchenManager.save);
    const needs = recipeNeeds(view, recipe.id);
    const dishPath = resolveDishAssetPath(recipe.id);

    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        UI_KIT.btnOlive,
        HUD_ICON.coin,
        dishPath,
        ...needs.map((n) => resolveItemAssetPath(n.iconId)),
      ],
      this._scheduleRelayout,
    );

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const { scene } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: H,
      topBleed: 18,
      dimAlpha: 0.72,
      onDimTap: () => this._advance(),
    });

    // 木夹古法食谱宣纸（720x1101 等比落位，外沿勾勒品阶贴边轮廓光）
    const paperW = 616;
    const paperH = 942;
    const paperX = Math.round((W - paperW) / 2);
    const paperTex = gameTexture(ART.paper);
    if (isTextureReady(paperTex)) {
      const sp = new PIXI.Sprite(paperTex);
      fitSpriteInBox(sp, paperW, paperH);
      sp.anchor.set(0.5, 0);
      sp.position.set(W / 2, 0);
      sp.eventMode = 'none';
      scene.addChild(sp);
      attachSpriteContour(scene, sp, recipe.rarity, {
        onDark: true,
        selected: true,
        thicknessScale: 1.05,
      });
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(3, SCENE_INK.ink, 1);
      fb.beginFill(0xF6E6C6, 1);
      fb.drawRoundedRect(paperX, 24, paperW, paperH - 24, 22);
      fb.endFill();
      scene.addChild(fb);
    }

    const cx = W / 2;

    // 1. 宣纸眉批（ui_recipe_paper.png 顶部中央木夹子垂至 y≈170，眉批落于木夹正下方）
    const brow = makeText('heading', '✦ 领 悟 私 房 新 菜 谱 ✦', SCENE_INK.red, {
      size: 28,
      stroke: 0xFFF7E6,
      strokeWidth: 4,
    });
    brow.anchor.set(0.5);
    brow.position.set(cx, 204);
    scene.addChild(brow);

    // 2. 锦缎托垫 + 大尺寸立体成菜贴边发光直呈 + 左右对称品阶印/新谱朱印
    const cushion = sceneSprite(ART.cushion, 360, 200);
    if (cushion) {
      cushion.anchor.set(0.5);
      cushion.position.set(cx, 428);
      scene.addChild(cushion);
    }

    const plateDish = makeDishDisplay({
      dishPath,
      size: 192,
      shadowAlpha: 0.30,
      shadowColor: 0x3A0A06,
      rarity: recipe.rarity,
      contourOpts: { selected: true, thicknessScale: 1.12 },
    });
    plateDish.position.set(cx, 356);
    scene.addChild(plateDish);

    const raritySeal = makeRaritySeal(recipe.rarity, 64, -0.09);
    raritySeal.position.set(cx - 168, 278);
    scene.addChild(raritySeal);

    const seal = makeSealStamp('新谱收录', 74, 0.12);
    seal.position.set(cx + 168, 276);
    scene.addChild(seal);

    if (this._stampedId !== id) {
      this._stampedId = id;
      raritySeal.scale.set(1.75);
      raritySeal.alpha = 0.15;
      TweenManager.to({
        target: raritySeal,
        props: { alpha: 1 },
        duration: 0.14,
      });
      TweenManager.to({
        target: raritySeal.scale,
        props: { x: 1, y: 1 },
        duration: 0.24,
        ease: Ease.easeOutBack,
      });

      seal.scale.set(1.85);
      seal.alpha = 0.2;
      TweenManager.to({
        target: seal,
        props: { alpha: 1 },
        duration: 0.14,
        delay: 0.05,
      });
      TweenManager.to({
        target: seal.scale,
        props: { x: 1, y: 1 },
        duration: 0.26,
        delay: 0.05,
        ease: Ease.easeOutBack,
      });
    }

    drawInkDivider(scene, paperX + 64, 530, paperW - 128, 0.55, 10);

    // 3. 大字菜名 + 品质售价
    const dishName = makeText('display', recipe.name, SCENE_INK.ink, {
      size: 40,
      stroke: 0xFFF8EA,
      strokeWidth: 5,
    });
    dishName.anchor.set(0.5);
    dishName.position.set(cx, 584);
    fitTextWidth(dishName, paperW - 112);
    scene.addChild(dishName);

    const sell = recipeSellPrice(recipe.id);
    const meta = makeText(
      'heading',
      `${rarityLabel(recipe.rarity)} · ${recipe.group} · 售价 ${sell} 金`,
      RARITY_STYLE[recipe.rarity].ink,
      { size: 25, stroke: 0xFFF8EA, strokeWidth: 3 },
    );
    meta.anchor.set(0.5);
    meta.position.set(cx, 636);
    fitTextWidth(meta, paperW - 112);
    scene.addChild(meta);

    // 4. 配料图标横排（无框直绘在宣纸上）
    const ingRow = new PIXI.Container();
    let ix = 0;
    const ingLead = makeText('caption', '配料：', SCENE_INK.soft, { size: 23, fontWeight: '700' });
    ingLead.anchor.set(0, 0.5);
    ingRow.addChild(ingLead);
    ix += ingLead.width + 6;

    for (const n of needs) {
      const sp = sceneSprite(resolveItemAssetPath(n.iconId), 42, 42);
      if (sp) {
        sp.anchor.set(0, 0.5);
        sp.position.set(ix, 0);
        ingRow.addChild(sp);
        ix += 46;
      }
      const lbl = makeText('caption', `${n.label}×${n.need}`, SCENE_INK.ink, {
        size: 23,
        fontWeight: '700',
      });
      lbl.anchor.set(0, 0.5);
      lbl.position.set(ix, 0);
      ingRow.addChild(lbl);
      ix += lbl.width + 18;
    }
    const maxIngW = paperW - 112;
    if (ix > maxIngW && ix > 0) {
      ingRow.scale.set(maxIngW / ix);
    }
    const scaledIngW = Math.max(0, ix - 18) * ingRow.scale.x;
    ingRow.position.set(Math.round(cx - scaledIngW / 2), 690);
    scene.addChild(ingRow);

    // 5. 风味小记 + 食用增益
    const blurb = new PIXI.Text(recipe.blurb, {
      fontFamily: FONT,
      fontSize: 24,
      fill: SCENE_INK.soft,
      fontWeight: '600',
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: paperW - 124,
      lineHeight: 34,
    });
    blurb.anchor.set(0.5, 0);
    blurb.position.set(cx, 736);
    blurb.eventMode = 'none';
    scene.addChild(blurb);

    const eatY = Math.min(868, 736 + Math.ceil(blurb.height) + 18);
    const eat = makeText('heading', `✦ ${recipeEatLabel(recipe.id)}`, SCENE_INK.green, {
      size: 25,
      stroke: 0xFFF9EC,
      strokeWidth: 4,
    });
    eat.anchor.set(0.5);
    eat.position.set(cx, eatY);
    fitTextWidth(eat, paperW - 112);
    scene.addChild(eat);

    // 6. 收下 / 下一道按钮
    const leftCount = KitchenManager.recipeUnlockLeft();
    const more = leftCount > 1;
    const btnW = 296;
    const btnH = 64;
    const btn = makeSlicedButton({
      label: more ? `下一道新谱 (剩${leftCount - 1})` : '收入私房菜谱',
      width: btnW,
      height: btnH,
      skin: 'olive',
      fontSize: 28,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(Math.round(cx - btnW / 2), 966);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._advance();
    });
    scene.addChild(btn);
  }

  private _advance(): void {
    KitchenManager.shiftRecipeUnlock();
    if (KitchenManager.peekRecipeUnlock()) {
      AudioManager.play('recipe_paper');
      this._stampedId = null;
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
