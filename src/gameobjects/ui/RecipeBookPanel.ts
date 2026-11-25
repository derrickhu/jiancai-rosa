import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  RARITY_STYLE,
  listedRecipes,
  rarityLabel,
  recipeById,
  recipeEatLabel,
  recipeMasteryView,
  recipeNeeds,
  recipeSellPrice,
  recipeUnlockView,
  unlockedRecipes,
  type RecipeDef,
  type RecipeId,
} from '@/sim';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  FONT,
  HUD_ICON,
  P0_ART,
  UI_KIT,
  attachSpriteContour,
  fillRect,
  fitTextWidth,
  makeHandProgressBar,
  makeMasterySpoonRow,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawStretchSheet,
  makeNeedIcons,
  makeRaritySeal,
  makeSealStamp,
  makeSceneRoot,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  book: 'subpkg_images/scene_dex_book.png',
  tab: 'subpkg_images/scene_dex_tab.png',
  photo: 'subpkg_images/scene_dex_photo.png',
  washi: 'subpkg_images/scene_dex_washi.png',
  note: 'subpkg_images/scene_club_note.png',
} as const;

const W = 720;
const H = 1073;
const PAGE_X = 114;
const PAGE_R = 650;
const PAGE_W = PAGE_R - PAGE_X;

type FilterTab = 'all' | 'cooked' | 'fresh';

export class RecipeBookPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _filter: FilterTab = 'all';
  private _inspectId: RecipeId | null = null;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 25;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, {
      visible: () => this._isOpen && !this._inspectId,
    });
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._filter = 'all';
    this._inspectId = null;
    this._scroller.reset();
    this._scroller.enable();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspectId = null;
    this._paintQueued = false;
    this._scroller.disable();
    this._scroller.clear();
    destroyDisplayChildren(this._root);
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

    const save = KitchenManager.save;
    const view = recipeUnlockView(save);
    const known = unlockedRecipes(view);
    const cookedSet = new Set(save.recipesCooked);
    const totalCount = listedRecipes(undefined, save.recipesFound).length;

    const paths: string[] = [
      ...Object.values(ART),
      ...sceneArtPaths(),
      ...uiBarPaths(),
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      HUD_ICON.coin,
      P0_ART.dexStamp,
      ...P0_ART.spoons,
    ];
    for (const r of known) {
      paths.push(resolveDishAssetPath(r.id));
      for (const n of recipeNeeds(view, r.id)) {
        paths.push(resolveItemAssetPath(n.iconId));
      }
    }
    watchTextures([...new Set(paths)], this._scheduleRelayout);

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const { scene, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: H,
      topBleed: 44,
      dimAlpha: 0.66,
      onDimTap: () => {
        if (this._inspectId) {
          AudioManager.play('ui_close');
          this._inspectId = null;
          this.relayout();
          return;
        }
        this.close();
      },
    });

    this._drawBookBase(scene);
    drawPlaqueTitle(scene, '私房菜谱册', W / 2, -42, 348);
    drawSceneClose(
      scene,
      W - 54,
      -18,
      () => {
        if (this._inspectId) {
          AudioManager.play('ui_close');
          this._inspectId = null;
          this.relayout();
          return;
        }
        this.close();
      },
      this._scheduleRelayout,
    );

    const cookedCount = known.filter((r) => cookedSet.has(r.id)).length;
    this._drawHeader(scene, known.length, totalCount, cookedCount);
    this._drawFilterTabs(scene, known.length, cookedCount);

    const filtered = this._filter === 'cooked'
      ? known.filter((r) => cookedSet.has(r.id))
      : this._filter === 'fresh'
        ? known.filter((r) => !cookedSet.has(r.id))
        : known;

    this._drawRecipeList(scene, filtered, cookedSet, view, toStage);

    if (this._inspectId) {
      const target = recipeById(this._inspectId);
      if (target) this._drawInspectModal(target, view, cookedSet.has(target.id));
    }
  }

  private _drawBookBase(scene: PIXI.Container): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0E0804, 0.45);
    shadow.drawRoundedRect(10, 14, W - 20, H - 6, 36);
    shadow.endFill();
    scene.addChild(shadow);

    const book = sceneSprite(ART.book, W, H);
    if (book) {
      scene.addChild(book);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(4, SCENE_INK.ink, 1);
      fb.beginFill(0x5E381E, 1);
      fb.drawRoundedRect(0, 0, W, H, 32);
      fb.endFill();
      fb.lineStyle(2, 0xB89A72, 1);
      fb.beginFill(0xF6EAD2, 1);
      fb.drawRoundedRect(74, 58, W - 114, H - 132, 20);
      fb.endFill();
      scene.addChild(fb);
    }
  }

  private _drawHeader(
    scene: PIXI.Container,
    knownCount: number,
    totalCount: number,
    cookedCount: number,
  ): void {
    // 第一行位于木匾底沿（y≈132）下方，且严格控制在暗红丝带书签左侧（x<=504）
    const row1Cy = 168;
    const stampIcon = sceneSprite(P0_ART.dexStamp, 46, 46);
    if (stampIcon) {
      stampIcon.anchor.set(0, 0.5);
      stampIcon.position.set(PAGE_X, row1Cy);
      scene.addChild(stampIcon);
    }

    const head = makeText('title', `已掌握 ${knownCount}/${totalCount} 道`, SCENE_INK.ink, { size: 28 });
    head.anchor.set(0, 0.5);
    head.position.set(PAGE_X + 54, row1Cy);
    fitTextWidth(head, 332);
    scene.addChild(head);

    // 第二行位于暗红丝带燕尾下方（y>=208），右侧绿字落在纯米白纸面上清晰醒目
    const row2Cy = 224;
    const sub = makeText('heading', `已掌勺 ${cookedCount} 道`, SCENE_INK.green, { size: 24 });
    sub.anchor.set(1, 0.5);
    sub.position.set(PAGE_R, row2Cy);
    scene.addChild(sub);

    const barW = Math.max(240, PAGE_W - Math.ceil(sub.width) - 22);
    const bar = makeHandProgressBar({
      width: barW,
      height: 20,
      ratio: totalCount > 0 ? knownCount / totalCount : 0,
      onReady: this._scheduleRelayout,
    });
    bar.node.position.set(PAGE_X, row2Cy - 10);
    scene.addChild(bar.node);
  }

  private _drawFilterTabs(scene: PIXI.Container, knownCount: number, cookedCount: number): void {
    const navY = 262;
    const gap = 13;
    const tabW = Math.floor((PAGE_W - gap * 2) / 3);
    const tabH = 60;
    const freshCount = Math.max(0, knownCount - cookedCount);

    const tabs: Array<{ id: FilterTab; label: string }> = [
      { id: 'all', label: `全部 ${knownCount}` },
      { id: 'cooked', label: `已掌勺 ${cookedCount}` },
      { id: 'fresh', label: `待试菜 ${freshCount}` },
    ];

    tabs.forEach((item, idx) => {
      const active = this._filter === item.id;
      const wrap = new PIXI.Container();
      const ty = active ? navY - 4 : navY + 4;
      const th = active ? tabH + 4 : tabH - 4;
      wrap.position.set(PAGE_X + idx * (tabW + gap), ty);

      const tex = gameTexture(ART.tab);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.width = tabW;
        sp.height = th;
        sp.tint = active ? 0xFFFBF2 : 0xE6D3B5;
        wrap.addChild(sp);
      } else {
        const g = new PIXI.Graphics();
        g.lineStyle(2.5, SCENE_INK.ink, 1);
        g.beginFill(active ? 0xFFFBF2 : 0xE6D3B5, 1);
        g.drawRoundedRect(0, 0, tabW, th, 14);
        g.endFill();
        wrap.addChild(g);
      }

      if (active) {
        const underline = new PIXI.Graphics();
        underline.beginFill(SCENE_INK.red, 0.9);
        underline.drawRoundedRect(tabW * 0.2, th - 8, tabW * 0.6, 4, 2);
        underline.endFill();
        wrap.addChild(underline);
      }

      const lbl = makeText('heading', item.label, active ? SCENE_INK.red : SCENE_INK.soft, {
        size: active ? 26 : 24,
      });
      lbl.anchor.set(0.5);
      lbl.position.set(tabW / 2, th * 0.48);
      fitTextWidth(lbl, tabW - 18);
      wrap.addChild(lbl);

      wrap.eventMode = 'static';
      wrap.cursor = 'pointer';
      wrap.hitArea = new PIXI.Rectangle(0, 0, tabW, th);
      wrap.on('pointertap', () => {
        if (this._filter === item.id) return;
        AudioManager.play('ui_click');
        this._filter = item.id;
        this._scroller.reset();
        this.relayout();
      });
      scene.addChild(wrap);
    });

    drawInkDivider(scene, PAGE_X, navY + 60, PAGE_W, 0.55, 10);
  }

  private _drawRecipeList(
    scene: PIXI.Container,
    recipes: readonly RecipeDef[],
    cookedSet: Set<RecipeId>,
    view: ReturnType<typeof recipeUnlockView>,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const listTop = 336;
    const listBottom = 972;
    const listH = listBottom - listTop;

    const list = new PIXI.Container();
    list.position.set(PAGE_X, listTop);

    let y = 0;
    if (!recipes.length) {
      const emptyMsg = this._filter === 'fresh'
        ? '已掌握的菜谱全都亲自下过锅啦！'
        : '还没有符合这一类的私房菜谱。';
      const empty = makeText('body', emptyMsg, SCENE_INK.muted, { size: 25 });
      empty.position.set(8, 36);
      list.addChild(empty);
      y = 120;
    } else {
      const save = KitchenManager.save;
      const rowH = 192;
      recipes.forEach((r, idx) => {
        const done = cookedSet.has(r.id);
        const row = new PIXI.Container();
        row.position.set(0, y);

        // 左侧拍立得相片贴纸
        const photoW = 126;
        const photoH = 172;
        const photo = new PIXI.Container();
        photo.pivot.set(photoW / 2, photoH / 2);
        photo.position.set(photoW / 2 + 2, rowH / 2 - 4);
        photo.rotation = idx % 2 === 0 ? -0.022 : 0.022;

        const pTex = gameTexture(ART.photo);
        if (isTextureReady(pTex)) {
          const pf = new PIXI.Sprite(pTex);
          pf.width = photoW;
          pf.height = photoH;
          photo.addChild(pf);
        } else {
          const g = new PIXI.Graphics();
          g.lineStyle(2, SCENE_INK.ink, 1);
          g.beginFill(0xFAF0DC, 1);
          g.drawRoundedRect(0, 8, photoW, photoH - 8, 8);
          g.endFill();
          photo.addChild(g);
        }

        const dTex = dishTexture(r.id);
        if (isTextureReady(dTex)) {
          const sp = new PIXI.Sprite(dTex);
          fitSpriteInBox(sp, 86, 86);
          sp.anchor.set(0.5);
          sp.position.set(photoW / 2, 78);
          photo.addChild(sp);
          attachSpriteContour(photo, sp, r.rarity, {
            selected: r.rarity === 'legendary',
            thicknessScale: 0.88,
          });
        }

        if (r.rarity !== 'common') {
          const rSeal = makeRaritySeal(r.rarity, 38, -0.08);
          rSeal.position.set(25, 32);
          photo.addChild(rSeal);
        }

        const mastery = recipeMasteryView(save, r.id);
        const spoons = makeMasterySpoonRow({
          stars: mastery.stars,
          size: 22,
          gap: 3,
          onReady: this._scheduleRelayout,
        });
        spoons.position.set(Math.round((photoW - (22 * 3 + 6)) / 2), 138);
        photo.addChild(spoons);
        row.addChild(photo);

        // 右侧手账文字区（无框直接写在点阵纸上）
        const rx = 146;
        const rw = PAGE_W - rx;

        const name = makeText('title', r.name, SCENE_INK.ink, { size: 29 });
        name.position.set(rx, 10);
        fitTextWidth(name, rw - 88);
        row.addChild(name);

        if (done) {
          const seal = makeSealStamp('已掌勺', 50, -0.1);
          seal.position.set(PAGE_W - 28, 30);
          row.addChild(seal);
        } else {
          const freshTag = makeText('caption', '待试菜', SCENE_INK.red, { size: 22, fontWeight: '700' });
          freshTag.anchor.set(1, 0.5);
          freshTag.position.set(PAGE_W - 4, 28);
          row.addChild(freshTag);
        }

        const needs = recipeNeeds(view, r.id).map((n) => ({
          iconPath: resolveItemAssetPath(n.iconId),
          have: n.have,
          need: n.need,
        }));
        const needRow = makeNeedIcons(needs, {
          iconSize: 40,
          size: 23,
          maxW: rw - 4,
        });
        needRow.node.position.set(rx, 82);
        row.addChild(needRow.node);

        const eat = makeText('caption', `✦ ${recipeEatLabel(r.id)}`, SCENE_INK.green, {
          size: 22,
          fontWeight: '700',
        });
        eat.anchor.set(0, 0.5);
        eat.position.set(rx, 140);
        fitTextWidth(eat, rw - 108);
        row.addChild(eat);

        const price = recipeSellPrice(r.id);
        const priceTxt = makeText('number', `${price}`, SCENE_INK.gold, { size: 24 });
        priceTxt.anchor.set(1, 0.5);
        priceTxt.position.set(PAGE_W - 2, 140);
        row.addChild(priceTxt);
        const coinSp = sceneSprite(HUD_ICON.coin, 28, 28);
        if (coinSp) {
          coinSp.anchor.set(1, 0.5);
          coinSp.position.set(PAGE_W - priceTxt.width - 6, 140);
          row.addChild(coinSp);
        }

        if (idx < recipes.length - 1) {
          drawInkDivider(row, 0, rowH - 10, PAGE_W, 0.42, 9);
        }

        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.hitArea = new PIXI.Rectangle(0, 0, PAGE_W, rowH);
        row.on('pointertap', () => {
          if (this._scroller.moved) return;
          AudioManager.play('ui_click');
          this._inspectId = r.id;
          this.relayout();
        });
        list.addChild(row);
        y += rowH;
      });
    }

    const contentH = y + 16;
    const mask = new PIXI.Graphics();
    fillRect(mask, PAGE_X - 8, listTop, PAGE_W + 16, listH, 0xFFFFFF);
    mask.eventMode = 'none';
    const viewport = new PIXI.Container();
    viewport.eventMode = 'static';
    viewport.hitArea = new PIXI.Rectangle(PAGE_X, listTop, PAGE_W, listH);
    viewport.mask = mask;
    viewport.addChild(list);
    scene.addChild(mask, viewport);

    const tl = toStage(PAGE_X, listTop);
    const br = toStage(PAGE_R, listBottom);
    this._scroller.attach({
      content: list,
      maxScroll: Math.max(0, contentH - listH),
      baseY: listTop,
      hit: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
    });
  }

  private _drawInspectModal(
    recipe: RecipeDef,
    view: ReturnType<typeof recipeUnlockView>,
    done: boolean,
  ): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    const save = KitchenManager.save;
    const mastery = recipeMasteryView(save, recipe.id);
    const sell = recipeSellPrice(recipe.id);

    const modalRoot = new PIXI.Container();
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    dim.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_close');
      this._inspectId = null;
      this.relayout();
    });
    modalRoot.addChild(dim);

    const noteW = Math.min(620, sw - 40);
    const blurbText = new PIXI.Text(recipe.blurb, {
      fontFamily: FONT,
      fontSize: 25,
      fill: SCENE_INK.ink,
      fontWeight: '600',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: noteW - 96,
      lineHeight: 36,
    });
    blurbText.eventMode = 'none';

    const topAreaH = 372;
    const noteH = Math.max(596, topAreaH + Math.ceil(blurbText.height) + 178);

    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, noteW, noteH);
    card.on('pointertap', (e) => e.stopPropagation());

    drawStretchSheet(card, ART.note, 0, 0, noteW, noteH, 128, 125, 0xF7EAD0);

    const photoW = 192;
    const photoH = 264;
    const photoWrap = new PIXI.Container();
    photoWrap.pivot.set(photoW / 2, photoH / 2);
    photoWrap.position.set(44 + photoW / 2, 108 + photoH / 2);
    photoWrap.rotation = -0.026;

    const pTex = gameTexture(ART.photo);
    if (isTextureReady(pTex)) {
      const pf = new PIXI.Sprite(pTex);
      pf.width = photoW;
      pf.height = photoH;
      photoWrap.addChild(pf);
    }
    const dTex = dishTexture(recipe.id);
    if (isTextureReady(dTex)) {
      const sp = new PIXI.Sprite(dTex);
      fitSpriteInBox(sp, 126, 126);
      sp.anchor.set(0.5);
      sp.position.set(photoW / 2, 116);
      photoWrap.addChild(sp);
      attachSpriteContour(photoWrap, sp, recipe.rarity, { selected: true });
    }
    const spoons = makeMasterySpoonRow({
      stars: mastery.stars,
      size: 26,
      gap: 4,
      onReady: this._scheduleRelayout,
    });
    spoons.position.set(Math.round((photoW - (26 * 3 + 8)) / 2), 182);
    photoWrap.addChild(spoons);

    const capLbl = makeText(
      'caption',
      done ? '已掌勺' : '待试菜',
      done ? SCENE_INK.green : SCENE_INK.red,
      { size: 22, fontWeight: '700' },
    );
    capLbl.anchor.set(0.5);
    capLbl.position.set(photoW / 2, 232);
    photoWrap.addChild(capLbl);
    card.addChild(photoWrap);

    const infoX = 256;
    const infoW = noteW - infoX - 42;
    const title = makeText('display', recipe.name, SCENE_INK.ink, { size: 34 });
    title.position.set(infoX, 120);
    fitTextWidth(title, infoW - 64);
    card.addChild(title);

    const sub = makeText(
      'heading',
      `${rarityLabel(recipe.rarity)} · ${recipe.group} · 售价 ${sell} 金`,
      RARITY_STYLE[recipe.rarity].ink,
      { size: 24 },
    );
    sub.position.set(infoX, 176);
    fitTextWidth(sub, infoW - 64);
    card.addChild(sub);

    const rSeal = makeRaritySeal(recipe.rarity, 54, 0.09);
    rSeal.position.set(noteW - 66, 156);
    card.addChild(rSeal);

    const potTxt = makeText(
      'caption',
      `${mastery.title} · 累计下锅 ${mastery.cooked} 次`,
      SCENE_INK.soft,
      { size: 22, fontWeight: '600' },
    );
    potTxt.position.set(infoX, 218);
    fitTextWidth(potTxt, infoW);
    card.addChild(potTxt);

    const needs = recipeNeeds(view, recipe.id).map((n) => ({
      iconPath: resolveItemAssetPath(n.iconId),
      have: n.have,
      need: n.need,
    }));
    const needIcons = makeNeedIcons(needs, {
      iconSize: 42,
      size: 24,
      maxW: infoW,
    });
    needIcons.node.position.set(infoX, 290);
    card.addChild(needIcons.node);

    drawInkDivider(card, 46, topAreaH + 14, noteW - 92, 0.5, 10);

    blurbText.position.set(48, topAreaH + 36);
    card.addChild(blurbText);

    const eatY = topAreaH + 40 + Math.ceil(blurbText.height) + 14;
    const eat = makeText('heading', `✦ 食用风味：${recipeEatLabel(recipe.id)}`, SCENE_INK.green, { size: 24 });
    eat.position.set(48, eatY);
    fitTextWidth(eat, noteW - 96);
    card.addChild(eat);

    const okBtnW = 228;
    const okBtnH = 56;
    const okBtn = makeSlicedButton({
      label: '合上菜谱',
      width: okBtnW,
      height: okBtnH,
      skin: 'olive',
      fontSize: 26,
      onReady: this._scheduleRelayout,
    });
    okBtn.position.set(Math.round((noteW - okBtnW) / 2), noteH - okBtnH - 32);
    okBtn.on('pointertap', () => {
      this._inspectId = null;
      this.relayout();
    });
    card.addChild(okBtn);

    drawSceneClose(
      card,
      noteW - 44,
      14,
      () => {
        AudioManager.play('ui_close');
        this._inspectId = null;
        this.relayout();
      },
      this._scheduleRelayout,
    );

    const fitScale = Math.min(1, (sh - Game.safeTop - 48) / noteH);
    card.pivot.set(noteW / 2, noteH / 2);
    card.position.set(sw / 2, Math.round(Game.safeTop + (sh - Game.safeTop) / 2));
    card.scale.set(fitScale * 0.92);
    TweenManager.to({
      target: card.scale,
      props: { x: fitScale, y: fitScale },
      duration: 0.18,
      ease: Ease.easeOutBack,
    });
    modalRoot.addChild(card);
    this._root.addChild(modalRoot);
  }
}
