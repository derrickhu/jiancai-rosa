import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { TutorialOverlay } from '@/gameobjects/ui/TutorialOverlay';
import { Platform } from '@/core/PlatformService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren, destroyDisplayNode } from '@/utils/destroy';
import {
  DEX_ENTRY_GOLD,
  DEX_FOOD_CATS,
  DEX_STAMP_SETS,
  RARITY_STYLE,
  dexMilestoneStatus,
  dexObtainHint,
  dexRedDotCount,
  dexStampSetStatus,
  dishGroupCatIcon,
  dishGroupTheme,
  dishGroups,
  dishesInGroup,
  foodsInCat,
  getItem,
  isDexEntryClaimed,
  isDishUnlocked,
  isFoodUnlocked,
  isRecipeId,
  isStampMemberUnlocked,
  itemRarity,
  rarityLabel,
  recipeById,
  recipeEatLabel,
  recipeMasteryView,
  recipeRarity,
  recipeSellPrice,
  sellPrice,
  stampMemberName,
  unclaimedDexInDishGroup,
  unclaimedDexInFoodCat,
  unclaimedDexStampSets,
  type DexEntryKind,
  type DexFoodCat,
  type DexTab,
  type KitchenSave,
  type Rarity,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
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
import {
  applyGray,
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  imgPath,
  isTextureReady,
  itemTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import { PANEL_SHELL } from '@/utils/panelAssets';
import { VerticalScroller } from '@/utils/scroll';
import {
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawStretchSheet,
  makeInlineRewards,
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
  spot: 'subpkg_images/scene_dex_spot.png',
  washi: 'subpkg_images/scene_dex_washi.png',
  note: 'subpkg_images/scene_club_note.png',
} as const;

const W = 720;
const H = 1073;
const PAGE_X = 114;
const PAGE_R = 650;
const PAGE_W = PAGE_R - PAGE_X;

type View =
  | { kind: 'home' }
  | { kind: 'food'; cat: DexFoodCat }
  | { kind: 'dish'; group: string };

interface DexDetailModal {
  kind: DexEntryKind;
  id: string;
  unlocked: boolean;
  title: string;
  subtitle: string;
  metaLine?: string;
  blurb: string;
  eatLine?: string;
  rarity: Rarity;
  stars?: 0 | 1 | 2 | 3;
}

interface DexVirtualBlock {
  y: number;
  h: number;
  render: () => PIXI.Container;
}

export class DexPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _tab: DexTab = 'food';
  private _view: View = { kind: 'home' };
  private _scroller: VerticalScroller;
  private _paintQueued = false;
  private _detail: DexDetailModal | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 24;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, {
      visible: () => this._isOpen && !this._detail,
    });
  }

  open(tab: DexTab = 'food'): void {
    this._tab = tab;
    this._view = { kind: 'home' };
    this._detail = null;
    this._scroller.reset();
    this._scroller.enable();
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._detail = null;
    this._paintQueued = false;
    this._scroller.disable();
    this._scroller.clear();
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

  private _warmView(): void {
    const save = KitchenManager.save;
    const paths: string[] = [
      ...Object.values(ART),
      ...PANEL_SHELL.dex,
      ...sceneArtPaths(),
      ...uiBarPaths(),
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      HUD_ICON.coin,
      HUD_ICON.ticket,
      P0_ART.dexStamp,
      ...P0_ART.spoons,
    ];
    const entryIcons: string[] = [];
    const catIconToPath = (icon: string): string =>
      icon.startsWith('dex_cat_') ? imgPath(`${icon}.png`) : resolveItemAssetPath(icon);

    if (this._view.kind === 'home') {
      if (this._tab === 'food') {
        for (const cat of DEX_FOOD_CATS.slice(0, 12)) {
          entryIcons.push(catIconToPath(cat.icon));
        }
      } else if (this._tab === 'dish') {
        for (const group of dishGroups().slice(0, 12)) {
          entryIcons.push(catIconToPath(dishGroupCatIcon(group)));
        }
      } else {
        for (const setDef of DEX_STAMP_SETS) {
          for (const m of setDef.members) {
            if (entryIcons.length >= 12) break;
            entryIcons.push(m.kind === 'food' ? resolveItemAssetPath(m.id) : resolveDishAssetPath(m.id));
          }
          if (entryIcons.length >= 12) break;
        }
      }
    } else if (this._view.kind === 'food') {
      for (const it of foodsInCat(this._view.cat).slice(0, 12)) {
        entryIcons.push(resolveItemAssetPath(it.id));
      }
    } else {
      for (const it of dishesInGroup(this._view.group, save.recipesFound).slice(0, 12)) {
        entryIcons.push(resolveDishAssetPath(it.id));
      }
    }
    paths.push(...entryIcons);
    if (this._detail) {
      paths.push(
        this._detail.kind === 'dish'
          ? resolveDishAssetPath(this._detail.id)
          : resolveItemAssetPath(this._detail.id),
      );
    }
    watchTextures([...new Set(paths)], this._scheduleRelayout);
  }

  relayout(): void {
    this._scroller.clear();
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;
    this._warmView();

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
        if (this._detail) {
          AudioManager.play('ui_close');
          this._detail = null;
          this.relayout();
          return;
        }
        this.close();
      },
    });

    this._drawBookBase(scene);
    drawPlaqueTitle(scene, this._titleText(), W / 2, -42, 348);
    drawSceneClose(
      scene,
      W - 54,
      -18,
      () => {
        if (this._detail) {
          AudioManager.play('ui_close');
          this._detail = null;
          this.relayout();
          return;
        }
        this.close();
      },
      this._scheduleRelayout,
    );

    this._drawHeaderSection(scene, toStage);
    this._drawNavSection(scene);
    this._drawScrollViewport(scene, toStage);

    if (this._detail) {
      this._drawDetailModal(this._detail);
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

  private _drawHeaderSection(
    scene: PIXI.Container,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const save = KitchenManager.save;
    const { have, total } = this._progress(save);
    const ms = dexMilestoneStatus(save);
    const claimable = dexRedDotCount(save) > 0;

    // 避开顶部木匾底沿（y≈132）与右上暗红丝带书签（x≈515..628, y≈0..202）
    const row1Cy = 168;
    const stampIcon = sceneSprite(P0_ART.dexStamp, 46, 46);
    if (stampIcon) {
      stampIcon.anchor.set(0, 0.5);
      stampIcon.position.set(PAGE_X, row1Cy);
      scene.addChild(stampIcon);
    }

    const progTitle = makeText('title', `已收录 ${have}/${total}`, SCENE_INK.ink, { size: 28 });
    progTitle.anchor.set(0, 0.5);
    progTitle.position.set(PAGE_X + 54, row1Cy);
    fitTextWidth(progTitle, 332);
    scene.addChild(progTitle);

    // 第二行位于 y=208..264，完整落在暗红丝带燕尾下方，全宽可用且字号不压缩
    const row2Top = 208;
    const msTextStr = ms.readySteps > 0
      ? `里程碑可领券 ×${ms.readySteps}`
      : `再集 ${Math.max(1, ms.stepNeed - ms.stepProgress)} 味赠菜谱券`;

    if (claimable) {
      const btnW = 172;
      const btnH = 56;
      const barW = PAGE_W - btnW - 18;
      const bar = makeHandProgressBar({
        width: barW,
        height: 18,
        ratio: total > 0 ? have / total : 0,
        onReady: this._scheduleRelayout,
      });
      bar.node.position.set(PAGE_X, row2Top + 4);
      scene.addChild(bar.node);

      const msTxt = makeText(
        'caption',
        msTextStr,
        ms.readySteps > 0 ? SCENE_INK.red : SCENE_INK.gold,
        { size: 22, fontWeight: '700' },
      );
      msTxt.anchor.set(0, 0);
      msTxt.position.set(PAGE_X + 2, row2Top + 30);
      fitTextWidth(msTxt, barW - 4);
      scene.addChild(msTxt);

      const claimBtn = makeSlicedButton({
        label: '盖章领赏',
        width: btnW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      claimBtn.position.set(PAGE_R - btnW, row2Top + 2);
      claimBtn.on('pointertap', (e) => {
        e.stopPropagation();
        const res = KitchenManager.claimAllDex();
        if (res.gold <= 0 && res.tickets <= 0) return;
        analytics.trackDexClaim({
          claimType: 'claim_all',
          entriesCount: res.entriesCount,
          milestonesCount: res.milestonesCount,
          stampSetsCount: res.stampSetsCount,
          goldGained: res.gold,
          ticketsGained: res.tickets,
        });
        const from = toStage(PAGE_R - btnW / 2, row2Top + 30);
        if (res.gold > 0) playRewardCollect({ gold: res.gold, from });
        if (res.tickets > 0) playTicketCollect(from, kitchenGachaHudPos(), 0);
        const parts: string[] = [];
        if (res.gold > 0) parts.push(`+${res.gold} 金币`);
        if (res.tickets > 0) parts.push(`菜谱券 ×${res.tickets}`);
        Platform.showToast(`盖章领赏：${parts.join('  ')}`, 'success');
        if (this._isOpen) this.relayout();
      });
      scene.addChild(claimBtn);
    } else {
      const msTxt = makeText('caption', msTextStr, SCENE_INK.gold, { size: 23, fontWeight: '700' });
      msTxt.anchor.set(1, 0.5);
      msTxt.position.set(PAGE_R, row2Top + 22);
      scene.addChild(msTxt);

      const barW = Math.max(220, PAGE_W - Math.ceil(msTxt.width) - 20);
      const bar = makeHandProgressBar({
        width: barW,
        height: 20,
        ratio: total > 0 ? have / total : 0,
        onReady: this._scheduleRelayout,
      });
      bar.node.position.set(PAGE_X, row2Top + 12);
      scene.addChild(bar.node);
    }
  }

  private _drawNavSection(scene: PIXI.Container): void {
    const navY = 276;
    const save = KitchenManager.save;

    if (this._view.kind === 'home') {
      const gap = 13;
      const tabW = Math.floor((PAGE_W - gap * 2) / 3);
      const tabH = 60;
      const foodRed = DEX_FOOD_CATS.reduce((n, c) => n + unclaimedDexInFoodCat(save, c.id), 0);
      const dishRed = dishGroups().reduce((n, g) => n + unclaimedDexInDishGroup(save, g), 0);
      const stampRed = unclaimedDexStampSets(save).length;

      const tabs: Array<{ id: DexTab; label: string; badge: number }> = [
        { id: 'food', label: '食材篇', badge: foodRed },
        { id: 'dish', label: '菜谱篇', badge: dishRed },
        { id: 'stamp', label: '集章册', badge: stampRed },
      ];

      tabs.forEach((item, idx) => {
        const active = this._tab === item.id;
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
          underline.drawRoundedRect(tabW * 0.22, th - 8, tabW * 0.56, 4, 2);
          underline.endFill();
          wrap.addChild(underline);
        }

        const lbl = makeText(
          'heading',
          item.label,
          active ? SCENE_INK.red : SCENE_INK.soft,
          { size: active ? 28 : 25 },
        );
        lbl.anchor.set(0.5);
        lbl.position.set(tabW / 2, th * 0.48);
        wrap.addChild(lbl);

        if (item.badge > 0) {
          const seal = makeSealStamp(`新${item.badge}`, 44, 0.12);
          seal.position.set(tabW - 14, 8);
          wrap.addChild(seal);
        }

        wrap.eventMode = 'static';
        wrap.cursor = 'pointer';
        wrap.hitArea = new PIXI.Rectangle(0, 0, tabW, th);
        wrap.on('pointertap', () => {
          if (this._tab === item.id) return;
          AudioManager.play('ui_click');
          this._tab = item.id;
          this._view = { kind: 'home' };
          this._detail = null;
          this._scroller.reset();
          this.relayout();
        });
        scene.addChild(wrap);
      });
    } else {
      const backBtn = makeSlicedButton({
        label: '← 返回目录',
        width: 184,
        height: 52,
        skin: 'cream',
        fontSize: 24,
        onReady: this._scheduleRelayout,
      });
      backBtn.position.set(PAGE_X, navY + 2);
      backBtn.on('pointertap', () => {
        this._view = { kind: 'home' };
        this._detail = null;
        this._scroller.reset();
        this.relayout();
      });
      scene.addChild(backBtn);

      const tip = makeText('caption', '轻点相片翻看风味与线索', SCENE_INK.muted, { size: 22, fontWeight: '600' });
      tip.anchor.set(1, 0.5);
      tip.position.set(PAGE_R, navY + 28);
      fitTextWidth(tip, PAGE_W - 198);
      scene.addChild(tip);
    }

    drawInkDivider(scene, PAGE_X, navY + 60, PAGE_W, 0.55, 10);
  }

  private _drawScrollViewport(
    scene: PIXI.Container,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const listTop = 350;
    const listBottom = 972;
    const listH = listBottom - listTop;

    const list = new PIXI.Container();
    list.position.set(PAGE_X, listTop);
    let layout: { contentH: number; blocks: DexVirtualBlock[] };
    if (this._view.kind === 'home') {
      if (this._tab === 'food') layout = this._paintFoodCats();
      else if (this._tab === 'dish') layout = this._paintDishCats();
      else layout = this._paintStampSets(toStage, listTop);
    } else {
      layout = this._paintGrid();
    }
    const contentH = layout.contentH + 24;

    const mask = new PIXI.Graphics();
    fillRect(mask, PAGE_X - 8, listTop, PAGE_W + 16, listH, 0xFFFFFF);
    mask.eventMode = 'none';
    const viewport = new PIXI.Container();
    viewport.eventMode = 'static';
    viewport.hitArea = new PIXI.Rectangle(PAGE_X, listTop, PAGE_W, listH);
    viewport.mask = mask;
    viewport.addChild(list);
    scene.addChild(mask, viewport);

    const BUFFER = 180;
    const mounted = new Map<number, PIXI.Container>();
    const syncWindow = (scrollY: number): void => {
      if (list.destroyed) return;
      const scrollTop = -scrollY;
      const minY = scrollTop - BUFFER;
      const maxY = scrollTop + listH + BUFFER;
      for (const [idx, node] of mounted) {
        const b = layout.blocks[idx];
        if (!b || b.y + b.h < minY || b.y > maxY) {
          mounted.delete(idx);
          destroyDisplayNode(node);
        }
      }
      for (let i = 0; i < layout.blocks.length; i++) {
        if (mounted.has(i)) continue;
        const b = layout.blocks[i];
        if (b.y + b.h < minY || b.y > maxY) continue;
        const node = b.render();
        list.addChild(node);
        mounted.set(i, node);
      }
    };

    const tl = toStage(PAGE_X, listTop);
    const br = toStage(PAGE_R, listBottom);
    this._scroller.attach({
      content: list,
      maxScroll: Math.max(0, contentH - listH),
      baseY: listTop,
      hit: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
      onScroll: syncWindow,
    });
  }

  private _paintFoodCats(): { contentH: number; blocks: DexVirtualBlock[] } {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      DEX_FOOD_CATS.map((cat) => {
        const items = foodsInCat(cat.id);
        const have = items.filter((it) => isFoodUnlocked(save, it.id)).length;
        return {
          label: cat.label,
          icon: cat.icon,
          have,
          total: items.length,
          unclaimed: unclaimedDexInFoodCat(save, cat.id),
          ink: cat.ink,
          onTap: () => {
            AudioManager.play('ui_click');
            this._view = { kind: 'food', cat: cat.id };
            this._detail = null;
            this._scroller.reset();
            this.relayout();
          },
        };
      }),
    );
  }

  private _paintDishCats(): { contentH: number; blocks: DexVirtualBlock[] } {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      dishGroups().map((group) => {
        const items = dishesInGroup(group, save.recipesFound);
        const have = items.filter((it) => isDishUnlocked(save, it.id)).length;
        return {
          label: group,
          icon: dishGroupCatIcon(group),
          have,
          total: items.length,
          unclaimed: unclaimedDexInDishGroup(save, group),
          ink: dishGroupTheme(group).ink,
          onTap: () => {
            AudioManager.play('ui_click');
            this._view = { kind: 'dish', group };
            this._detail = null;
            this._scroller.reset();
            this.relayout();
          },
        };
      }),
    );
  }

  private _paintCatGrid(
    cats: Array<{
      label: string;
      icon: string;
      have: number;
      total: number;
      unclaimed: number;
      ink: number;
      onTap: () => void;
    }>,
  ): { contentH: number; blocks: DexVirtualBlock[] } {
    const cols = 2;
    const gapX = 20;
    const gapY = 22;
    const cardW = Math.floor((PAGE_W - gapX) / cols);
    const cardH = 340;
    const blocks: DexVirtualBlock[] = [];

    cats.forEach((cat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (cardW + gapX);
      const y = row * (cardH + gapY);

      blocks.push({
        y,
        h: cardH,
        render: () => {
          const card = new PIXI.Container();
          card.pivot.set(cardW / 2, cardH / 2);
          card.position.set(x + cardW / 2, y + cardH / 2);
          card.rotation = col === 0 ? -0.015 : 0.015;

          const photoTex = gameTexture(ART.photo);
          if (isTextureReady(photoTex)) {
            const frame = new PIXI.Sprite(photoTex);
            frame.width = cardW;
            frame.height = cardH;
            card.addChild(frame);
          } else {
            const fb = new PIXI.Graphics();
            fb.lineStyle(2.5, SCENE_INK.ink, 1);
            fb.beginFill(0xFAF0DC, 1);
            fb.drawRoundedRect(0, 12, cardW, cardH - 12, 10);
            fb.endFill();
            card.addChild(fb);
          }

          // 拍立得相窗区域（对应 240x337 原图的 [20..220, 40..264]）
          const winX = Math.round(cardW * 0.088);
          const winY = Math.round(cardH * 0.122);
          const winW = Math.round(cardW * 0.824);
          const winH = Math.round(cardH * 0.656);

          const iconHolder = new PIXI.Container();
          iconHolder.eventMode = 'none';
          card.addChild(iconHolder);
          const catPath = imgPath(`${cat.icon}.png`);
          const mountCatPic = (tex: PIXI.Texture) => {
            const spr = new PIXI.Sprite(tex);
            const scale = Math.max(winW / tex.width, winH / tex.height);
            spr.scale.set(scale);
            spr.anchor.set(0.5);
            spr.position.set(winX + winW / 2, winY + winH / 2);
            const mask = new PIXI.Graphics();
            fillRect(mask, winX + 2, winY + 2, winW - 4, winH - 4, 0xFFFFFF, 6);
            spr.mask = mask;
            iconHolder.addChild(mask, spr);
          };
          const catTex = gameTexture(catPath);
          if (isTextureReady(catTex)) {
            mountCatPic(catTex);
          } else {
            whenTextureReady(catPath, () => {
              if (iconHolder.destroyed || !iconHolder.parent) return;
              const rTex = gameTexture(catPath);
              if (isTextureReady(rTex)) mountCatPic(rTex);
            });
          }

          const name = makeText('title', cat.label, cat.ink, { size: 30 });
          name.anchor.set(0, 0.5);
          name.position.set(winX + 2, winY + winH + 28);
          fitTextWidth(name, winW * 0.58);
          card.addChild(name);

          const cnt = makeText('number', `${cat.have}/${cat.total}`, SCENE_INK.ink, { size: 25 });
          cnt.anchor.set(1, 0.5);
          cnt.position.set(winX + winW - 2, winY + winH + 28);
          card.addChild(cnt);

          const bar = makeHandProgressBar({
            width: winW,
            height: 14,
            ratio: cat.total > 0 ? cat.have / cat.total : 0,
            onReady: this._scheduleRelayout,
          });
          bar.node.position.set(winX, winY + winH + 50);
          card.addChild(bar.node);

          if (cat.unclaimed > 0) {
            const seal = makeSealStamp(`新${cat.unclaimed}`, 52, 0.12);
            seal.position.set(cardW - 30, 38);
            card.addChild(seal);
          }

          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
          card.on('pointertap', () => {
            if (this._scroller.moved) return;
            cat.onTap();
          });
          return card;
        },
      });
    });

    return {
      contentH: Math.ceil(cats.length / cols) * (cardH + gapY),
      blocks,
    };
  }

  private _paintGrid(): { contentH: number; blocks: DexVirtualBlock[] } {
    const save = KitchenManager.save;
    const isDish = this._view.kind === 'dish';
    const entries: Array<{
      id: string;
      name: string;
      blurb: string;
      unlocked: boolean;
      dish: boolean;
      rarity: Rarity;
    }> = this._view.kind === 'food'
      ? foodsInCat(this._view.cat).map((it) => ({
        id: it.id,
        name: it.name,
        blurb: it.blurb,
        unlocked: isFoodUnlocked(save, it.id),
        dish: false,
        rarity: it.rarity,
      }))
      : this._view.kind === 'dish'
        ? dishesInGroup(this._view.group, save.recipesFound).map((it) => ({
          id: it.id,
          name: it.name,
          blurb: it.blurb,
          unlocked: isDishUnlocked(save, it.id),
          dish: true,
          rarity: it.rarity,
        }))
        : [];

    if (!entries.length) {
      return {
        contentH: 80,
        blocks: [
          {
            y: 0,
            h: 80,
            render: () => {
              const empty = makeText('body', '这一页还空着，去菜场逛逛吧。', SCENE_INK.muted, { size: 26 });
              empty.position.set(12, 24);
              return empty;
            },
          },
        ],
      };
    }

    const cols = 2;
    const gapX = 20;
    const gapY = 22;
    const cardW = Math.floor((PAGE_W - gapX) / cols);
    const cardH = 336;
    const blocks: DexVirtualBlock[] = [];

    entries.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (cardW + gapX);
      const y = row * (cardH + gapY);
      const entryKind: DexEntryKind = it.dish ? 'dish' : 'food';
      const unclaimed = it.unlocked && !isDexEntryClaimed(save, entryKind, it.id);
      const iconPath = it.dish ? resolveDishAssetPath(it.id) : resolveItemAssetPath(it.id);

      blocks.push({
        y,
        h: cardH,
        render: () => {
          const card = new PIXI.Container();
          card.pivot.set(cardW / 2, cardH / 2);
          card.position.set(x + cardW / 2, y + cardH / 2);

          if (it.unlocked) {
            card.rotation = (i % 2 === 0 ? -1 : 1) * 0.014;
            const photoTex = gameTexture(ART.photo);
            if (isTextureReady(photoTex)) {
              const frame = new PIXI.Sprite(photoTex);
              frame.width = cardW;
              frame.height = cardH;
              card.addChild(frame);
            } else {
              const fb = new PIXI.Graphics();
              fb.lineStyle(2.5, SCENE_INK.ink, 1);
              fb.beginFill(0xFAF0DC, 1);
              fb.drawRoundedRect(0, 12, cardW, cardH - 12, 10);
              fb.endFill();
              card.addChild(fb);
            }

            const winCx = cardW / 2;
            const winCy = isDish ? 136 : 148;

            const iconHolder = new PIXI.Container();
            iconHolder.eventMode = 'none';
            card.addChild(iconHolder);
            const mountUnlockedIcon = (t: PIXI.Texture) => {
              const spr = new PIXI.Sprite(t);
              fitSpriteInBox(spr, 152, 152);
              spr.anchor.set(0.5);
              spr.position.set(winCx, winCy);
              spr.eventMode = 'none';
              iconHolder.addChild(spr);
              attachSpriteContour(iconHolder, spr, it.rarity, {
                selected: it.rarity === 'legendary',
              });
            };
            const tex = it.dish ? dishTexture(it.id) : itemTexture(it.id);
            if (isTextureReady(tex)) {
              mountUnlockedIcon(tex);
            } else {
              whenTextureReady(iconPath, () => {
                if (iconHolder.destroyed || !iconHolder.parent) return;
                const rTex = gameTexture(iconPath);
                if (isTextureReady(rTex)) mountUnlockedIcon(rTex);
              });
            }

            if (it.rarity !== 'common') {
              const rSeal = makeRaritySeal(it.rarity, 44, -0.08);
              rSeal.position.set(46, 62);
              card.addChild(rSeal);
            }

            if (it.dish && isRecipeId(it.id)) {
              const mastery = recipeMasteryView(save, it.id);
              const spoonSize = 28;
              const spoonGap = 5;
              const spoons = makeMasterySpoonRow({
                stars: mastery.stars,
                size: spoonSize,
                gap: spoonGap,
                onReady: this._scheduleRelayout,
              });
              const sw = spoonSize * 3 + spoonGap * 2;
              spoons.position.set(Math.round((cardW - sw) / 2), 218);
              card.addChild(spoons);
            }

            const name = makeText('title', it.name, SCENE_INK.ink, { size: 27 });
            name.anchor.set(0.5);
            name.position.set(cardW / 2, 294);
            fitTextWidth(name, cardW - 44);
            card.addChild(name);

            if (unclaimed) {
              const seal = makeSealStamp(`+${DEX_ENTRY_GOLD}金`, 54, 0.12);
              seal.position.set(cardW - 30, 38);
              card.addChild(seal);
            }
          } else {
            const washi = sceneSprite(ART.washi, 118, 22);
            if (washi) {
              washi.anchor.set(0.5);
              washi.position.set(cardW / 2, 22);
              washi.rotation = i % 2 === 0 ? -0.025 : 0.025;
              card.addChild(washi);
            }

            const spot = sceneSprite(ART.spot, 186, 186);
            if (spot) {
              spot.anchor.set(0.5);
              spot.position.set(cardW / 2, 134);
              card.addChild(spot);
            } else {
              const g = new PIXI.Graphics();
              g.lineStyle(2, 0xB89A74, 0.7);
              g.beginFill(0xFFFBF0, 0.75);
              g.drawCircle(cardW / 2, 134, 88);
              g.endFill();
              card.addChild(g);
            }

            const iconHolder = new PIXI.Container();
            iconHolder.eventMode = 'none';
            card.addChild(iconHolder);
            const mountLockedIcon = (t: PIXI.Texture) => {
              const spr = new PIXI.Sprite(t);
              fitSpriteInBox(spr, 126, 126);
              spr.anchor.set(0.5);
              spr.position.set(cardW / 2, 134);
              applyGray(spr);
              spr.alpha = 0.34;
              spr.eventMode = 'none';
              iconHolder.addChild(spr);
            };
            const tex = it.dish ? dishTexture(it.id) : itemTexture(it.id);
            if (isTextureReady(tex)) {
              mountLockedIcon(tex);
            } else {
              whenTextureReady(iconPath, () => {
                if (iconHolder.destroyed || !iconHolder.parent) return;
                const rTex = gameTexture(iconPath);
                if (isTextureReady(rTex)) mountLockedIcon(rTex);
              });
            }

            const title = makeText('heading', it.dish ? '待寻菜谱' : '待寻食材', SCENE_INK.soft, { size: 26 });
            title.anchor.set(0.5);
            title.position.set(cardW / 2, 256);
            card.addChild(title);

            const hint = makeText('caption', '轻点看寻味线索 ›', SCENE_INK.muted, { size: 22, fontWeight: '600' });
            hint.anchor.set(0.5);
            hint.position.set(cardW / 2, 294);
            card.addChild(hint);
          }

          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
          card.on('pointertap', (e) => {
            if (this._scroller.moved) return;
            AudioManager.play('ui_click');
            if (it.unlocked && unclaimed) {
              const gold = KitchenManager.claimDexEntry(entryKind, it.id);
              if (gold > 0) {
                analytics.trackDexClaim({
                  claimType: 'entry',
                  targetKind: entryKind,
                  targetId: it.id,
                  entriesCount: 1,
                  goldGained: gold,
                  ticketsGained: 0,
                });
                playRewardCollect({ gold, from: { x: e.global.x, y: e.global.y } });
              }
            }
            this._detail = this._buildDetail(entryKind, it.id, it.unlocked);
            this.relayout();
          });
          return card;
        },
      });
    });

    return {
      contentH: Math.ceil(entries.length / cols) * (cardH + gapY),
      blocks,
    };
  }

  private _paintStampSets(
    toStage: (x: number, y: number) => { x: number; y: number },
    listTop: number,
  ): { contentH: number; blocks: DexVirtualBlock[] } {
    const save = KitchenManager.save;
    let y = 0;
    const blocks: DexVirtualBlock[] = [];

    DEX_STAMP_SETS.forEach((def, setIdx) => {
      const cols = 4;
      const gapX = 12;
      const cellW = Math.floor((PAGE_W - gapX * (cols - 1)) / cols);
      const rowH = 136;
      const gridTop = 104;
      const rows = Math.ceil(def.members.length / cols);
      const footTop = gridTop + rows * rowH + 10;
      const secH = footTop + 86;
      const secY = y;
      y += secH + 22;

      blocks.push({
        y: secY,
        h: secH,
        render: () => {
          const st = dexStampSetStatus(save, def);
          const sec = new PIXI.Container();
          sec.position.set(0, secY);

          const washi = sceneSprite(ART.washi, 108, 20);
          if (washi) {
            washi.position.set(0, 2);
            washi.alpha = 0.85;
            sec.addChild(washi);
          }

          const title = makeText('title', `《${def.title}》`, SCENE_INK.ink, { size: 30 });
          title.position.set(0, 24);
          fitTextWidth(title, PAGE_W - 160);
          sec.addChild(title);

          const statusStr = st.claimed
            ? '已盖章生效'
            : st.readyToClaim
              ? '已集齐 · 可盖章'
              : `已集 ${st.have}/${st.total}`;
          const statusCol = st.claimed
            ? SCENE_INK.green
            : st.readyToClaim
              ? SCENE_INK.red
              : SCENE_INK.muted;
          const statusTxt = makeText('heading', statusStr, statusCol, { size: 24 });
          statusTxt.anchor.set(1, 0.5);
          statusTxt.position.set(PAGE_W, 42);
          sec.addChild(statusTxt);

          const sub = makeText('caption', def.subtitle, SCENE_INK.soft, { size: 22, fontWeight: '600' });
          sub.position.set(2, 66);
          fitTextWidth(sub, PAGE_W - 4);
          sec.addChild(sub);

          def.members.forEach((m, idx) => {
            const unlocked = isStampMemberUnlocked(save, m);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const cy = gridTop + row * rowH;

            const cell = new PIXI.Container();
            cell.position.set(col * (cellW + gapX), cy);

            const spot = sceneSprite(ART.spot, 94, 94);
            if (spot) {
              spot.anchor.set(0.5);
              spot.position.set(cellW / 2, 48);
              if (unlocked) spot.tint = 0xFFF6E0;
              cell.addChild(spot);
            } else {
              const g = new PIXI.Graphics();
              g.lineStyle(2, 0xB89A74, 0.8);
              g.beginFill(0xFFFBF0, 0.85);
              g.drawCircle(cellW / 2, 48, 44);
              g.endFill();
              cell.addChild(g);
            }

            const mRarity: Rarity = m.kind === 'food'
              ? itemRarity(m.id)
              : (isRecipeId(m.id) ? recipeRarity(m.id) : 'common');

            const iconHolder = new PIXI.Container();
            iconHolder.eventMode = 'none';
            cell.addChild(iconHolder);
            const mPath = m.kind === 'food' ? resolveItemAssetPath(m.id) : resolveDishAssetPath(m.id);
            const mountStampIcon = (t: PIXI.Texture) => {
              const spr = new PIXI.Sprite(t);
              fitSpriteInBox(spr, 72, 72);
              spr.anchor.set(0.5);
              spr.position.set(cellW / 2, 48);
              if (!unlocked) {
                applyGray(spr);
                spr.alpha = 0.36;
              }
              spr.eventMode = 'none';
              iconHolder.addChild(spr);
              if (unlocked) {
                attachSpriteContour(iconHolder, spr, mRarity, { thicknessScale: 0.8 });
              }
            };
            const tex = m.kind === 'food' ? itemTexture(m.id) : dishTexture(m.id);
            if (isTextureReady(tex)) {
              mountStampIcon(tex);
            } else {
              whenTextureReady(mPath, () => {
                if (iconHolder.destroyed || !iconHolder.parent) return;
                const rTex = gameTexture(mPath);
                if (isTextureReady(rTex)) mountStampIcon(rTex);
              });
            }

            const mName = stampMemberName(m);
            const lbl = makeText(
              'caption',
              mName,
              unlocked ? SCENE_INK.ink : SCENE_INK.muted,
              { size: 22, fontWeight: unlocked ? '700' : '600' },
            );
            lbl.anchor.set(0.5, 0);
            lbl.position.set(cellW / 2, 98);
            fitTextWidth(lbl, cellW - 4);
            cell.addChild(lbl);

            cell.eventMode = 'static';
            cell.cursor = 'pointer';
            cell.hitArea = new PIXI.Rectangle(0, 0, cellW, rowH);
            cell.on('pointertap', () => {
              if (this._scroller.moved) return;
              AudioManager.play('ui_click');
              this._detail = this._buildDetail(m.kind, m.id, unlocked, `收录于《${def.title}》集章册`);
              this.relayout();
            });
            sec.addChild(cell);
          });

          const rightReserve = st.readyToClaim ? 182 : (st.claimed ? 136 : 12);

          const buffText = `✦ ${def.buffLabel.replace(/^永久加成：/, '集齐加成：')}`;
          const buffLbl = makeText(
            'heading',
            buffText,
            st.claimed ? SCENE_INK.green : SCENE_INK.gold,
            { size: 24 },
          );
          buffLbl.position.set(2, footTop);
          fitTextWidth(buffLbl, PAGE_W - rightReserve);
          sec.addChild(buffLbl);

          const chips: Array<{ icon?: string; label: string }> = [
            { icon: HUD_ICON.coin, label: `+${def.rewardGold}` },
          ];
          if (def.rewardTickets > 0) {
            chips.push({ icon: HUD_ICON.ticket, label: `×${def.rewardTickets}` });
          }
          const rewLead = makeText('caption', '集齐礼：', SCENE_INK.soft, { size: 23, fontWeight: '700' });
          rewLead.anchor.set(0, 0.5);
          rewLead.position.set(2, footTop + 52);
          sec.addChild(rewLead);

          const rewInline = makeInlineRewards(chips, {
            size: 24,
            iconSize: 34,
            color: SCENE_INK.ink,
            goldColor: SCENE_INK.gold,
            resolveItemIcon: resolveItemAssetPath,
          });
          rewInline.position.set(2 + rewLead.width + 4, footTop + 52);
          sec.addChild(rewInline);

          if (st.readyToClaim) {
            const btnW = 168;
            const btnH = 56;
            const claimBtn = makeSlicedButton({
              label: '盖章领赏',
              width: btnW,
              height: btnH,
              skin: 'terracotta',
              fontSize: 25,
              onReady: this._scheduleRelayout,
            });
            claimBtn.position.set(PAGE_W - btnW, footTop + 8);
            claimBtn.on('pointertap', (e) => {
              e.stopPropagation();
              if (this._scroller.moved) return;
              const res = KitchenManager.claimStampSet(def.id);
              if (!res.claimed) return;
              analytics.trackDexClaim({
                claimType: 'stamp_set',
                targetKind: 'stamp_set',
                targetId: def.id,
                stampSetsCount: 1,
                goldGained: res.gold,
                ticketsGained: res.tickets,
              });
              const from = toStage(PAGE_X + PAGE_W - btnW / 2, listTop + secY + footTop + 36 + this._scroller.y);
              if (res.gold > 0) playRewardCollect({ gold: res.gold, from });
              if (res.tickets > 0) playTicketCollect(from, kitchenGachaHudPos(), 0);
              Platform.showToast(`《${def.title}》盖章！${res.buffLabel}`, 'success');
              if (this._isOpen) this.relayout();
            });
            sec.addChild(claimBtn);
          } else if (st.claimed) {
            const stampWood = sceneSprite(P0_ART.dexStamp, 54, 54);
            if (stampWood) {
              stampWood.anchor.set(0.5);
              stampWood.position.set(PAGE_W - 96, footTop + 36);
              sec.addChild(stampWood);
            }
            const seal = makeSealStamp('已生效', 56, -0.14);
            seal.position.set(PAGE_W - 34, footTop + 36);
            sec.addChild(seal);
          }

          if (setIdx < DEX_STAMP_SETS.length - 1) {
            drawInkDivider(sec, 0, secH, PAGE_W, 0.45, 10);
          }
          return sec;
        },
      });
    });

    return {
      contentH: y,
      blocks,
    };
  }

  private _buildDetail(
    kind: DexEntryKind,
    id: string,
    unlocked: boolean,
    extraNote?: string,
  ): DexDetailModal {
    const save = KitchenManager.save;
    if (kind === 'food') {
      const def = getItem(id);
      if (!unlocked) {
        return {
          kind: 'food',
          id,
          unlocked: false,
          title: '待收录食材',
          subtitle: `${rarityLabel(def.rarity)} · ${def.zone === 'wet' ? '水产湿货' : '鲜蔬干货'}`,
          metaLine: extraNote,
          blurb: dexObtainHint('food', id),
          rarity: def.rarity,
        };
      }
      const price = sellPrice(id, 'common', true);
      return {
        kind: 'food',
        id,
        unlocked: true,
        title: def.name,
        subtitle: `${rarityLabel(def.rarity)} · ${def.zone === 'wet' ? '湿货' : '干货'} ${def.w}×${def.h}`,
        metaLine: extraNote ?? (price > 0 ? `参考单价：${price} 金币` : undefined),
        blurb: def.blurb,
        rarity: def.rarity,
      };
    }

    const recipe = isRecipeId(id) ? recipeById(id) : undefined;
    const rarity: Rarity = recipe ? recipe.rarity : 'common';
    if (!unlocked || !recipe) {
      return {
        kind: 'dish',
        id,
        unlocked: false,
        title: '待领悟菜谱',
        subtitle: `${rarityLabel(rarity)} · ${recipe?.group ?? '私房菜'}`,
        metaLine: extraNote,
        blurb: dexObtainHint('dish', id),
        rarity,
      };
    }

    const mastery = recipeMasteryView(save, recipe.id);
    const sell = recipeSellPrice(recipe.id);
    return {
      kind: 'dish',
      id,
      unlocked: true,
      title: recipe.name,
      subtitle: `${rarityLabel(recipe.rarity)} · ${recipe.group} · 售价 ${sell} 金`,
      metaLine: `${mastery.title}（已掌勺 ${mastery.cooked} 锅）${extraNote ? ` · ${extraNote}` : ''}`,
      blurb: recipe.blurb,
      eatLine: `✦ 食用风味：${recipeEatLabel(recipe.id)}`,
      rarity: recipe.rarity,
      stars: mastery.stars,
    };
  }

  private _drawDetailModal(detail: DexDetailModal): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;

    const modalRoot = new PIXI.Container();
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    dim.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_close');
      this._detail = null;
      this.relayout();
    });
    modalRoot.addChild(dim);

    const noteW = Math.min(620, sw - 40);
    const blurbText = new PIXI.Text(detail.blurb, {
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

    const topAreaH = 356;
    const eatExtraH = detail.eatLine ? 48 : 0;
    const noteH = Math.max(556, topAreaH + Math.ceil(blurbText.height) + eatExtraH + 128);

    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, noteW, noteH);
    card.on('pointertap', (e) => e.stopPropagation());

    drawStretchSheet(card, ART.note, 0, 0, noteW, noteH, 128, 125, 0xF7EAD0);

    // 左侧拍立得实物照（避开顶部中央红图钉 y:0..98）
    const photoW = 192;
    const photoH = 264;
    const photoWrap = new PIXI.Container();
    photoWrap.pivot.set(photoW / 2, photoH / 2);
    photoWrap.position.set(44 + photoW / 2, 108 + photoH / 2);
    photoWrap.rotation = -0.028;

    const pTex = gameTexture(ART.photo);
    if (isTextureReady(pTex)) {
      const pf = new PIXI.Sprite(pTex);
      pf.width = photoW;
      pf.height = photoH;
      photoWrap.addChild(pf);
    }
    const itemTex = detail.kind === 'dish' ? dishTexture(detail.id) : itemTexture(detail.id);
    if (isTextureReady(itemTex)) {
      const sp = new PIXI.Sprite(itemTex);
      fitSpriteInBox(sp, 124, 124);
      sp.anchor.set(0.5);
      sp.position.set(photoW / 2, 118);
      if (!detail.unlocked) {
        applyGray(sp);
        sp.alpha = 0.36;
      }
      photoWrap.addChild(sp);
      if (detail.unlocked) {
        attachSpriteContour(photoWrap, sp, detail.rarity, { selected: true });
      }
    }
    if (detail.unlocked && detail.stars !== undefined) {
      const spoons = makeMasterySpoonRow({
        stars: detail.stars,
        size: 26,
        gap: 4,
        onReady: this._scheduleRelayout,
      });
      spoons.position.set(Math.round((photoW - (26 * 3 + 8)) / 2), 182);
      photoWrap.addChild(spoons);
    }
    const capLbl = makeText(
      'caption',
      detail.unlocked ? '已收录' : '未收录',
      detail.unlocked ? SCENE_INK.green : SCENE_INK.muted,
      { size: 22, fontWeight: '700' },
    );
    capLbl.anchor.set(0.5);
    capLbl.position.set(photoW / 2, 232);
    photoWrap.addChild(capLbl);
    card.addChild(photoWrap);

    // 右侧大字词条名 + 品质/掌勺信息
    const infoX = 256;
    const infoW = noteW - infoX - 42;
    const title = makeText('display', detail.title, SCENE_INK.ink, { size: 34 });
    title.position.set(infoX, 124);
    fitTextWidth(title, infoW);
    card.addChild(title);

    const sub = makeText('heading', detail.subtitle, RARITY_STYLE[detail.rarity].ink, { size: 24 });
    sub.position.set(infoX, 180);
    fitTextWidth(sub, infoW);
    card.addChild(sub);

    if (detail.metaLine) {
      const meta = new PIXI.Text(detail.metaLine, {
        fontFamily: FONT,
        fontSize: 22,
        fill: SCENE_INK.soft,
        fontWeight: '600',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: detail.unlocked ? infoW - 68 : infoW,
        lineHeight: 30,
      });
      meta.eventMode = 'none';
      meta.position.set(infoX, 222);
      card.addChild(meta);
    }

    if (detail.unlocked) {
      const seal = makeRaritySeal(detail.rarity, 56, 0.10);
      seal.position.set(noteW - 64, 304);
      card.addChild(seal);
    }

    drawInkDivider(card, 46, topAreaH + 16, noteW - 92, 0.5, 10);

    blurbText.position.set(48, topAreaH + 38);
    card.addChild(blurbText);

    let nextY = topAreaH + 42 + Math.ceil(blurbText.height) + 12;
    if (detail.eatLine) {
      const eat = makeText('heading', detail.eatLine, SCENE_INK.green, { size: 24 });
      eat.position.set(48, nextY);
      fitTextWidth(eat, noteW - 96);
      card.addChild(eat);
      nextY += 44;
    }

    const closeBtnW = 228;
    const closeBtnH = 56;
    const okBtn = makeSlicedButton({
      label: '合上便签',
      width: closeBtnW,
      height: closeBtnH,
      skin: 'olive',
      fontSize: 26,
      onReady: this._scheduleRelayout,
    });
    okBtn.position.set(Math.round((noteW - closeBtnW) / 2), noteH - closeBtnH - 34);
    okBtn.on('pointertap', () => {
      this._detail = null;
      this.relayout();
    });
    card.addChild(okBtn);

    drawSceneClose(
      card,
      noteW - 44,
      14,
      () => {
        AudioManager.play('ui_close');
        this._detail = null;
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

  private _titleText(): string {
    const view = this._view;
    if (view.kind === 'food') {
      const label = DEX_FOOD_CATS.find((c) => c.id === view.cat)?.label ?? '食材';
      return `${label}手账`;
    }
    if (view.kind === 'dish') return `${view.group}菜谱`;
    return this._tab === 'stamp' ? '烟火集章册' : '烟火手账';
  }

  private _progress(s: KitchenSave): { have: number; total: number } {
    if (this._view.kind === 'food') {
      const items = foodsInCat(this._view.cat);
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._view.kind === 'dish') {
      const items = dishesInGroup(this._view.group, s.recipesFound);
      return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._tab === 'food') {
      const items = DEX_FOOD_CATS.flatMap((c) => foodsInCat(c.id));
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._tab === 'stamp') {
      const done = DEX_STAMP_SETS.filter((d) => dexStampSetStatus(s, d).claimed).length;
      return { have: done, total: DEX_STAMP_SETS.length };
    }
    const items = dishGroups().flatMap((g) => dishesInGroup(g, s.recipesFound));
    return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
  }
}
