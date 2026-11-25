import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager, type CookLevelUp } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  CAT_UNLOCK_LEVEL,
  PICKLE_UNLOCK_LEVEL,
  RARITY_STYLE,
  marketsUnlockedBetween,
  rarityLabel,
  recipeById,
  staminaMax,
  type MarketDef,
  type RecipeDef,
} from '@/sim';
import {
  P2_ART,
  UI_KIT,
  attachSpriteContour,
  fillRect,
  fitTextWidth,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  resolveDishAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawStretchSheet,
  makeRaritySeal,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';
import { ensureRecipeUnlockPanel } from './RecipeUnlockPanel';
import { TutorialOverlay } from './TutorialOverlay';

const TITLE_BANNER = 'subpkg_kitchen/ui_cook_level_title.png';
const SPOT = 'subpkg_images/scene_dex_spot.png';

/**
 * 厨艺晋升喜报匾额 + 铜钉宣纸解锁清单场景：
 * 金光霞彩托起晋升横匾，宣纸笺上以大字晋升阶位、朱红喜印、青花瓷碟新菜谱与新集市画片呈现。
 */
export class CookLevelUpPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _fx: PIXI.Container[] = [];
  private _celebrate = false;
  private _openedAt = 0;
  private _data: CookLevelUp | null = null;
  private _paintQueued = false;

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
    TutorialOverlay.refresh();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._paintQueued = false;
    this._stopFx();
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
    const data = this._data ?? KitchenManager.peekCookLevelUp();
    this._stopFx();
    destroyDisplayChildren(this._root);
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) {
      this.close();
      return;
    }
    this._data = data;
    this._draw(data);
  }

  private _warmAssets(recipes: RecipeDef[], markets: MarketDef[], features: Array<{ icon: string }>): void {
    const paths: string[] = [
      TITLE_BANNER,
      SPOT,
      ...sceneArtPaths(),
      UI_KIT.btnGold,
    ];
    for (const r of recipes) paths.push(resolveDishAssetPath(r.id));
    for (const m of markets) paths.push(m.thumb);
    for (const f of features) paths.push(f.icon);
    watchTextures(paths, this._scheduleRelayout);
  }

  private _draw(data: CookLevelUp): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    const celebrate = this._celebrate;
    this._celebrate = false;

    const recipes = data.recipes.map((id) => recipeById(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const markets = marketsUnlockedBetween(data.from, data.to);
    const features = this._featureUnlocks(data);
    this._warmAssets(recipes, markets, features);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x140C07);
    dim.alpha = 0.72;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this._advance());
    this._root.addChild(dim);

    const sheetW = 656;
    const padX = 48;
    const contentW = sheetW - padX * 2;
    const bannerW = 584;
    const bannerH = Math.round(bannerW * (220 / 502));
    const sheetTop = bannerH - 36;

    // 预计算宣纸高度：晋升阶位区 + 奖励区 + 收下按钮
    const staminaFrom = staminaMax(data.from);
    const staminaTo = staminaMax(data.to);
    const hasStaminaUp = staminaTo > staminaFrom;

    let bodyH = hasStaminaUp ? 148 : 114; // 顶部等级阶位区
    bodyH += 24; // 分割线间距

    const hasUnlocks = features.length > 0 || recipes.length > 0 || markets.length > 0;
    if (hasUnlocks) {
      bodyH += 44; // 「新章开启」小标题
      if (features.length) {
        bodyH += features.length * 124 + 8;
      }
      if (recipes.length) {
        const cols = recipes.length <= 2 ? recipes.length : 3;
        const rows = Math.ceil(recipes.length / cols);
        const rowH = recipes.length <= 2 ? 216 : 196;
        bodyH += rows * rowH + 10;
      }
      if (markets.length) {
        const thumbW = markets.length === 1 ? 308 : 244;
        const thumbH = Math.round((thumbW * 9) / 16);
        bodyH += thumbH + 92;
      }
    } else {
      bodyH += 92;
    }

    const btnH = 64;
    const sheetH = Math.max(360, bodyH + btnH + 64);
    const totalH = sheetTop + sheetH;

    const stage = new PIXI.Container();
    stage.eventMode = 'static';
    stage.on('pointertap', () => this._advance());

    const availW = sw - 24;
    const availH = sh - Game.safeTop - Math.max(24, Game.safeBottom) - 24;
    const scale = Math.min(1, availW / sheetW, availH / totalH);
    stage.scale.set(scale);
    const sx = Math.round(sw / 2);
    const sy = Math.round(Game.safeTop + 12 + Math.max(0, (availH - totalH * scale) / 2));
    stage.position.set(sx, sy);
    this._root.addChild(stage);

    // 1. 铜钉宣纸喜报卷轴（位于匾额下方）
    const sheetWrap = new PIXI.Container();
    sheetWrap.position.set(-sheetW / 2, sheetTop);
    stage.addChild(sheetWrap);

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0A0502, 0.46);
    shadow.drawRoundedRect(10, 16, sheetW - 16, sheetH - 6, 20);
    shadow.endFill();
    sheetWrap.addChild(shadow);

    drawStretchSheet(sheetWrap, SCENE_ART.sheet, 0, 0, sheetW, sheetH, 140, 120);

    // 3. 顶部金匾丝带标题（压在宣纸上沿）
    const banner = this._titleBanner(bannerW, bannerH);
    banner.position.set(-bannerW / 2, 0);
    stage.addChild(banner);

    // 4. 宣纸内晋升阶位与朱印
    let cy = 54;
    const lvRow = this._lvStep(data);
    lvRow.root.position.set((sheetW - lvRow.width) / 2, cy);
    sheetWrap.addChild(lvRow.root);

    const seal = makeSealStamp('晋升', 60, -0.1);
    seal.position.set(sheetW - padX - 30, cy + lvRow.height / 2);
    sheetWrap.addChild(seal);
    cy += lvRow.height + 10;

    if (hasStaminaUp) {
      const stamTxt = makeText('body', `体力上限提升  ${staminaFrom} ➔ ${staminaTo}`, SCENE_INK.green, {
        size: 25,
        fontWeight: '700',
      });
      stamTxt.anchor.set(0.5, 0);
      stamTxt.position.set(sheetW / 2, cy);
      sheetWrap.addChild(stamTxt);
      cy += 38;
    } else {
      cy += 8;
    }

    drawInkDivider(sheetWrap, padX, cy + 4, contentW, 0.58, 12);
    cy += 26;

    // 5. 解锁内容展示
    if (hasUnlocks) {
      const secHead = makeText('heading', '· 新 章 开 启 ·', SCENE_INK.red, { size: 28 });
      secHead.anchor.set(0.5, 0);
      secHead.position.set(sheetW / 2, cy);
      sheetWrap.addChild(secHead);
      cy += 44;

      if (features.length) {
        features.forEach((feat, idx) => {
          const fRow = this._featureRow(feat, sheetW, padX, idx < features.length - 1 || recipes.length > 0 || markets.length > 0);
          fRow.position.set(0, cy);
          sheetWrap.addChild(fRow);
          if (celebrate) this._pop(fRow, 0.14 + idx * 0.08);
          cy += 124;
        });
        cy += 8;
      }

      if (recipes.length) {
        const cols = recipes.length <= 2 ? recipes.length : 3;
        const plateW = recipes.length <= 2 ? 172 : 148;
        const cellW = Math.floor(contentW / cols);
        const rowH = recipes.length <= 2 ? 216 : 196;
        recipes.forEach((recipe, idx) => {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const card = this._recipePlate(recipe, plateW);
          card.position.set(padX + col * cellW + cellW / 2, cy + row * rowH);
          sheetWrap.addChild(card);
          if (celebrate) this._pop(card, 0.16 + idx * 0.08);
        });
        cy += Math.ceil(recipes.length / cols) * rowH + 10;
      }

      if (markets.length) {
        const thumbW = markets.length === 1 ? 308 : 244;
        const thumbH = Math.round((thumbW * 9) / 16);
        const mRow = this._marketRow(markets, thumbW, thumbH);
        mRow.position.set(sheetW / 2, cy);
        sheetWrap.addChild(mRow);
        if (celebrate) this._pop(mRow, 0.2 + recipes.length * 0.08);
        cy += thumbH + 92;
      }
    } else {
      const praise = makeText('title', '炉火渐纯青，手艺更上一层楼！', SCENE_INK.soft, { size: 28 });
      praise.anchor.set(0.5, 0);
      praise.position.set(sheetW / 2, cy + 20);
      fitTextWidth(praise, contentW);
      sheetWrap.addChild(praise);
      cy += 92;
    }

    // 6. 底部手绘喜庆金钮
    const btnW = 280;
    const okBtn = makeSlicedButton({
      label: '欢喜收下',
      width: btnW,
      height: btnH,
      skin: 'gold',
      textColor: SCENE_INK.ink,
      fontSize: 28,
      onReady: this._scheduleRelayout,
    });
    okBtn.position.set(Math.round((sheetW - btnW) / 2), sheetH - btnH - 36);
    okBtn.on('pointertap', (e) => {
      e.stopPropagation();
      this._advance();
    });
    sheetWrap.addChild(okBtn);

    if (celebrate) {
      this._pop(banner, 0);
      this._pop(lvRow.root, 0.06);
      this._sparks(sx, sy + bannerH * 0.56 * scale);
      if (recipes.length) {
        globalThis.setTimeout?.(() => {
          if (this._isOpen) AudioManager.playGain();
        }, 280);
      }
    }
  }

  private _titleBanner(width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const tex = gameTexture(TITLE_BANNER);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      const s = width / Math.max(1, tex.width);
      sp.width = width;
      sp.height = tex.height * s;
      sp.position.set(0, Math.max(0, (height - sp.height) / 2));
      sp.eventMode = 'none';
      root.addChild(sp);
      attachSpriteContour(root, sp, 'god', {
        onDark: true,
        selected: true,
        thicknessScale: 1.12,
      });
    } else {
      const fallback = makeText('display', '恭喜厨艺升级', 0xF6D56A, {
        size: 42,
        stroke: 0x2A2018,
        strokeWidth: 6,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(width / 2, height / 2);
      root.addChild(fallback);
    }
    root.eventMode = 'none';
    return root;
  }

  private _lvStep(data: CookLevelUp): { root: PIXI.Container; width: number; height: number } {
    const root = new PIXI.Container();
    const from = makeText('display', `Lv.${data.from}`, SCENE_INK.soft, { size: 38 });
    const arrow = makeText('display', '➔', SCENE_INK.red, { size: 34 });
    const to = makeText('display', `Lv.${data.to}`, SCENE_INK.red, {
      size: 48,
      stroke: 0xFFF4D4,
      strokeWidth: 5,
    });
    const gap = 16;
    const height = Math.max(from.height, to.height);
    const mid = height / 2;
    from.anchor.set(0, 0.5);
    arrow.anchor.set(0, 0.5);
    to.anchor.set(0, 0.5);
    from.position.set(0, mid);
    arrow.position.set(from.width + gap, mid);
    to.position.set(arrow.x + arrow.width + gap, mid - 1);
    const width = to.x + to.width;
    root.addChild(from, arrow, to);
    root.eventMode = 'none';
    return { root, width, height };
  }

  private _recipePlate(recipe: RecipeDef, plateW: number): PIXI.Container {
    const root = new PIXI.Container();
    const plateCy = Math.round(plateW * 0.50);

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x2A1A0E, 0.22);
    shadow.drawEllipse(0, plateCy + Math.round(plateW * 0.24), Math.round(plateW * 0.38), Math.round(plateW * 0.12));
    shadow.endFill();
    shadow.eventMode = 'none';
    root.addChild(shadow);

    const dTex = dishTexture(recipe.id);
    if (isTextureReady(dTex)) {
      const dish = new PIXI.Sprite(dTex);
      const iconS = Math.round(plateW * 0.94);
      fitSpriteInBox(dish, iconS, iconS);
      dish.anchor.set(0.5);
      dish.position.set(0, plateCy - 2);
      dish.eventMode = 'none';
      root.addChild(dish);
      attachSpriteContour(root, dish, recipe.rarity, {
        selected: recipe.rarity !== 'common',
      });
    }

    const seal = recipe.rarity === 'common'
      ? makeSealStamp('新谱', 46, -0.1)
      : makeRaritySeal(recipe.rarity, 46, -0.1);
    seal.position.set(plateW * 0.36, 22);
    root.addChild(seal);

    const nameColor = recipe.rarity === 'common' ? SCENE_INK.ink : RARITY_STYLE[recipe.rarity].ink;
    const name = makeText('title', recipe.name, nameColor, { size: plateW >= 168 ? 28 : 25 });
    name.anchor.set(0.5, 0);
    name.position.set(0, plateCy + Math.round(plateW * 0.36));
    fitTextWidth(name, plateW + 28);
    root.addChild(name);

    const subColor = recipe.rarity === 'common' ? SCENE_INK.muted : RARITY_STYLE[recipe.rarity].ink;
    const sub = makeText('caption', `${rarityLabel(recipe.rarity)} · ${recipe.group}`, subColor, {
      size: 22,
      fontWeight: '600',
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(0, name.y + 34);
    fitTextWidth(sub, plateW + 28);
    root.addChild(sub);

    root.eventMode = 'none';
    return root;
  }

  private _marketRow(markets: MarketDef[], thumbW: number, thumbH: number): PIXI.Container {
    const root = new PIXI.Container();
    const gap = 28;
    const total = markets.length * thumbW + (markets.length - 1) * gap;
    markets.forEach((market, i) => {
      const cx = -total / 2 + i * (thumbW + gap) + thumbW / 2;
      const frame = new PIXI.Graphics();
      frame.beginFill(0x1E120A, 0.22);
      frame.drawRoundedRect(cx - thumbW / 2 + 3, 5, thumbW, thumbH + 10, 10);
      frame.endFill();
      frame.lineStyle(2.5, SCENE_INK.ink, 1);
      frame.beginFill(0xFFFDF7, 1);
      frame.drawRoundedRect(cx - thumbW / 2, 0, thumbW, thumbH + 10, 10);
      frame.endFill();
      root.addChild(frame);

      const tex = gameTexture(market.thumb);
      if (isTextureReady(tex)) {
        const mask = new PIXI.Graphics();
        mask.beginFill(0xFFFFFF);
        mask.drawRoundedRect(cx - thumbW / 2 + 5, 5, thumbW - 10, thumbH, 7);
        mask.endFill();
        const thumb = new PIXI.Sprite(tex);
        const s = Math.max((thumbW - 10) / tex.width, thumbH / tex.height);
        thumb.scale.set(s);
        thumb.anchor.set(0.5);
        thumb.position.set(cx, 5 + thumbH / 2);
        thumb.mask = mask;
        thumb.eventMode = 'none';
        root.addChild(mask, thumb);
      }

      const seal = makeSealStamp('新集', 50, -0.08);
      seal.position.set(cx + thumbW / 2 - 18, 18);
      root.addChild(seal);

      const name = makeText('title', `解锁新菜场 · ${market.name}`, SCENE_INK.ink, { size: 26 });
      name.anchor.set(0.5, 0);
      name.position.set(cx, thumbH + 18);
      fitTextWidth(name, thumbW + 30);
      root.addChild(name);

      const hint = makeText('caption', '出门即可前往赶集寻鲜', SCENE_INK.muted, { size: 22, fontWeight: '600' });
      hint.anchor.set(0.5, 0);
      hint.position.set(cx, thumbH + 52);
      root.addChild(hint);
    });
    root.eventMode = 'none';
    return root;
  }

  private _featureUnlocks(data: CookLevelUp): Array<{ icon: string; seal: string; title: string; sub: string }> {
    const out: Array<{ icon: string; seal: string; title: string; sub: string }> = [];
    if (data.from < PICKLE_UNLOCK_LEVEL && data.to >= PICKLE_UNLOCK_LEVEL) {
      out.push({
        icon: P2_ART.pickleIdle,
        seal: '新坊',
        title: '老坛腌制坊开启',
        sub: '厨房右滑窗边角 · 余菜入坛送私房大菜谱',
      });
    }
    if (data.from < CAT_UNLOCK_LEVEL && data.to >= CAT_UNLOCK_LEVEL) {
      out.push({
        icon: P2_ART.catIdle,
        seal: '新宠',
        title: '橘猫阿橘闻香上门',
        sub: '厨房右滑窗边角 · 免费收留每天寻宝带礼',
      });
    }
    return out;
  }

  private _featureRow(
    info: { icon: string; seal: string; title: string; sub: string },
    sheetW: number,
    padX: number,
    divider: boolean,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const cy = 56;
    const iconCx = padX + 52;

    const spot = sceneSprite(SPOT, 98, 98);
    if (spot) {
      spot.anchor.set(0.5);
      spot.position.set(iconCx, cy);
      root.addChild(spot);
    }

    const tex = gameTexture(info.icon);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, 86, 86);
      spr.anchor.set(0.5);
      spr.position.set(iconCx, cy);
      spr.eventMode = 'none';
      root.addChild(spr);
      attachSpriteContour(root, spr, 'god', { selected: true, thicknessScale: 0.92 });
    }

    const textX = padX + 118;
    const sealX = sheetW - padX - 28;
    const seal = makeSealStamp(info.seal, 50, -0.09);
    seal.position.set(sealX, cy);
    root.addChild(seal);

    const maxW = sealX - 36 - textX;
    const t = makeText('title', info.title, SCENE_INK.ink, { size: 28 });
    t.position.set(textX, 18);
    fitTextWidth(t, maxW);
    root.addChild(t);

    const s = makeText('body', info.sub, SCENE_INK.soft, { size: 22 });
    s.position.set(textX, 58);
    fitTextWidth(s, maxW);
    root.addChild(s);

    if (divider) {
      drawInkDivider(root, padX, 112, sheetW - padX * 2, 0.34, 10);
    }
    root.eventMode = 'none';
    return root;
  }

  private _sparks(x: number, y: number): void {
    const colors = [0xF2C14D, 0xFFF6E8, 0xE07A3A, 0xC4A574];
    for (let i = 0; i < 22; i++) {
      const dot = new PIXI.Graphics();
      const r = 2.5 + Math.random() * 3.5;
      dot.beginFill(colors[i % colors.length], 0.95);
      dot.drawCircle(0, 0, r);
      dot.endFill();
      dot.position.set(x, y);
      dot.eventMode = 'none';
      this._root.addChild(dot);
      this._fx.push(dot);
      const ang = (Math.PI * 2 * i) / 22 + Math.random() * 0.4;
      const dist = 70 + Math.random() * 130;
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
    const box = target.getLocalBounds();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    target.pivot.set(cx, cy);
    target.position.x += cx;
    target.position.y += cy;
    target.alpha = 0;
    target.scale.set(0.76);
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
    TutorialOverlay.refresh();
  }
}

let _panel: CookLevelUpPanel | null = null;

export function ensureCookLevelUpPanel(): CookLevelUpPanel {
  if (!_panel) _panel = new CookLevelUpPanel();
  return _panel;
}
