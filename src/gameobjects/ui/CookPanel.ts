import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CHEF_FIRE_XP_MUL,
  DAILY_AD_LIMITS,
  RARITY_STYLE,
  canUseDailyAd,
  chefFireRemainMs,
  dailyAdLeft,
  formatChefFireRemain,
  isChefFireActive,
  itemRarity,
  rarityLabel,
  recipeCanCook,
  recipeCookCount,
  recipeCookMax,
  recipeMasteryView,
  recipeNeeds,
  recipeUnlockView,
  recipeXp,
  unlockedRecipes,
  computeKitchenSlip,
  kitchenSlipPins,
  recipeEatLabel,
  type RecipeId,
} from '@/sim';
import {
  FONT,
  P0_ART,
  bindUiClick,
  drawItemSlotBox,
  drawRecessedWell,
  drawSectionTray,
  fillRect,
  makeLabel,
  makeMasterySpoonRow,
  makeOrnamentalDivider,
  makeSlotBadge,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  watchTextures,
} from '@/utils/assets';
import { cookPanelPaths } from '@/utils/panelAssets';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  makeQtyStepper,
  type ItemInspectView,
} from './ItemInspectCard';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, type TutorialTarget } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

const BG = 'subpkg_kitchen/ui_cook_panel.png';
const INK = 0x2A2018;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;
const MUTED = 0x8A6A40;
const OK = 0x5C6B4A;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const COOK_BTN = 'subpkg_kitchen/ui_cook_btn.png';
const BTN = {
  cream: 'subpkg_kitchen/ui_fridge_btn_cream.png',
  terracotta: 'subpkg_kitchen/ui_fridge_btn_terracotta.png',
} as const;

/** 相对砧板纸面（左有木铲，列表再往左贴一点）。 */
const PAGE = { x: 0.22, y: 0.10, w: 0.64, h: 0.72 };
const INSET = { x: 0.145, y: 0.20, w: 0.715, h: 0.58 };
const LEFT_W = 0.36;

export class CookPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _pick: RecipeId = 'stirfry';
  private _cookQty = 1;
  private _inspect: ItemInspectView | null = null;
  private _btnSlices = new Map<string, { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture }>();
  private _scroller: VerticalScroller;
  private _cookBtn: PIXI.Container | null = null;
  private _paintQueued = false;
  private _fireTimer = 0;
  private _adBusy = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 23;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    EventBus.on(EV.tutorialCook, this._onTutorialCook);
    EventBus.on(EV.kitchenChanged, this._scheduleRelayout);
  }

  open(recipeId?: RecipeId): void {
    if (!this._isOpen) AudioManager.play('cook_done');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    this._cookQty = 1;
    if (!TutorialManager.isActive) warmupAdScene('chef_buff');
    const known = unlockedRecipes(recipeUnlockView(KitchenManager.save));
    if (TutorialManager.at(TutorialStep.COOK_TABLE, TutorialStep.COOK_DISH)) {
      this._pick = 'stirfry';
    } else if (recipeId && known.some((r) => r.id === recipeId)) {
      this._pick = recipeId;
    } else if (!known.some((r) => r.id === this._pick)) {
      this._pick = known[0]?.id ?? 'stirfry';
    }
    this._scroller.reset();
    this._scroller.enable();
    this._adBusy = false;
    this._armFireTimer();
    this.relayout();
    OverlayManager.bringToFront();
    if (this._isOpen) TutorialOverlay.register('cook', () => this.tutorialCookRect());
    TutorialManager.advanceIf(TutorialStep.COOK_TABLE);
    this._warm();
  }

  close(silent = false): void {
    if (!silent && TutorialGuard.block('closeCook')) return;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._adBusy = false;
    this._clearFireTimer();
    this._scroller.disable();
    TutorialOverlay.unregister('cook');
  }

  private _armFireTimer(): void {
    this._clearFireTimer();
    this._fireTimer = globalThis.setInterval(() => {
      if (!this._isOpen || this._inspect) return;
      if (isChefFireActive(KitchenManager.save)) this.relayout();
    }, 1000) as unknown as number;
  }

  private _clearFireTimer(): void {
    if (this._fireTimer) globalThis.clearInterval?.(this._fireTimer);
    this._fireTimer = 0;
  }

  tutorialCookRect(): TutorialTarget | null {
    if (!TutorialManager.isStep(TutorialStep.COOK_DISH) || !this._isOpen) return null;
    const cook = stageRectOf(this._cookBtn, 10);
    if (cook) {
      return {
        holes: [cook],
        fingerAt: { x: cook.x + cook.w * 0.5, y: cook.y + cook.h * 0.5 },
      };
    }
    const box = this._boardBox(Game.designWidth, Game.logicHeight);
    return {
      holes: [{
        x: box.x + box.w * 0.22,
        y: box.y + box.h * 0.78,
        w: box.w * 0.64,
        h: box.h * 0.14,
        r: 18,
      }],
      fingerAt: { x: box.x + box.w * 0.54, y: box.y + box.h * 0.86 },
    };
  }

  private _warm(): void {
    watchTextures(
      [
        ...cookPanelPaths(KitchenManager.save, this._pick),
        P0_ART.chefFire,
        P0_ART.adClapper,
        ...P0_ART.spoons,
      ],
      this._scheduleRelayout,
    );
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
    this._warm();
    this._cookBtn = null;
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.46;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (TutorialGuard.block('closeCook')) return;
      this.close();
    });
    this._root.addChild(dim);

    const box = this._boardBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);
    this._paintBg(shell, box.w, box.h);

    const showFire = !TutorialManager.isActive;
    const titleX = showFire ? box.w * 0.39 : box.w * (PAGE.x + PAGE.w * 0.5);
    shell.addChild(this._title(titleX, box.h * (PAGE.y + 0.045)));
    if (showFire) {
      shell.addChild(this._chefFireWidget(box.w, box.h));
    }
    shell.addChild(this._sideList(box.x, box.y, box.w, box.h));
    shell.addChild(this._stage(box.w, box.h));

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onClose: () => {
          this._inspect = null;
          this.relayout();
        },
        onReady: () => {
          if (this._isOpen) this.relayout();
        },
      }));
    }
    TutorialOverlay.refresh();
  }

  private _boardBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const top = Game.safeTop + 4;
    const maxW = screenW - 20;
    const maxH = screenH - top - 8;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1267;
    const scale = Math.min(maxW / tw, maxH / th);
    const w = tw * scale;
    const h = th * scale;
    return { x: (screenW - w) / 2, y: top + (maxH - h) / 2, w, h };
  }

  private _paintBg(host: PIXI.Container, width: number, height: number): void {
    const tex = gameTexture(BG);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = width;
      sp.height = height;
      sp.eventMode = 'none';
      host.addChild(sp);
      return;
    }
    const g = new PIXI.Graphics();
      fillRect(g, 0, 0, width, height, 0x8B5A2B, 28);
      fillRect(g, width * 0.14, height * 0.1, width * 0.72, height * 0.72, 0xF6EDE0, 16);
    host.addChild(g);
  }

  private _title(cx: number, cy: number): PIXI.Container {
    const root = new PIXI.Container();
    const name = new PIXI.Text('烹  饪', {
      fontFamily: TITLE_FONT,
      fontSize: 40,
      fill: INK,
      fontWeight: '700',
      letterSpacing: 6,
      stroke: '#F6EDE0',
      strokeThickness: 5,
      dropShadow: true,
      dropShadowColor: '#C4A574',
      dropShadowAlpha: 0.55,
      dropShadowDistance: 2,
      dropShadowBlur: 0,
      dropShadowAngle: Math.PI / 2,
    });
    name.anchor.set(0.5);
    name.position.set(cx, cy);
    name.eventMode = 'none';
    root.addChild(name);
    return root;
  }

  private _chefFireWidget(bw: number, bh: number): PIXI.Container {
    const save = KitchenManager.save;
    const now = Date.now();
    const active = isChefFireActive(save, now);
    const remain = chefFireRemainMs(save, now);
    const left = dailyAdLeft(save, 'chef_buff', now);
    const canAd = canUseDailyAd(save, 'chef_buff', now);

    const pillW = Math.min(226, Math.round(bw * 0.315));
    const pillH = 50;
    const root = new PIXI.Container();
    root.position.set(Math.round(bw * 0.862 - pillW), Math.round(bh * (PAGE.y + 0.045) - pillH / 2));

    const bg = new PIXI.Graphics();
    bg.lineStyle(2.5, active ? 0xD4711E : 0x8B5A2B, 1);
    bg.beginFill(active ? 0xFFF1D6 : (canAd ? 0xC46A3A : 0xE6DAC8), 1);
    bg.drawRoundedRect(0, 0, pillW, pillH, pillH / 2);
    bg.endFill();
    root.addChild(bg);

    const wokTex = gameTexture(P0_ART.chefFire);
    if (isTextureReady(wokTex)) {
      const wok = new PIXI.Sprite(wokTex);
      fitSpriteInBox(wok, 46, 46);
      wok.anchor.set(0.5);
      wok.position.set(26, pillH / 2 - 1);
      wok.eventMode = 'none';
      if (!active && !canAd) wok.alpha = 0.55;
      root.addChild(wok);
    }

    const line1Text = active
      ? `旺火 ${formatChefFireRemain(remain)}`
      : canAd
        ? '点旺火 15分'
        : '今日旺火已满';
    const line2Text = active
      ? '经验+30% · 概率双份'
      : canAd
        ? `经验+30%·双份 (${left}/${DAILY_AD_LIMITS.chef_buff})`
        : '明天再来升旺火';

    const t1 = makeLabel(line1Text, 17, active ? TERRACOTTA : (canAd ? PAPER : MUTED), { fontWeight: '700' });
    t1.position.set(50, 6);
    const t2 = makeLabel(line2Text, 13, active ? INK : (canAd ? 0xFFEAD2 : MUTED), { fontWeight: '600' });
    t2.position.set(50, 27);
    root.addChild(t1, t2);

    if (!active && canAd) {
      const clapTex = gameTexture(P0_ART.adClapper);
      if (isTextureReady(clapTex)) {
        const clap = new PIXI.Sprite(clapTex);
        fitSpriteInBox(clap, 26, 26);
        clap.anchor.set(0.5);
        clap.position.set(pillW - 14, 6);
        clap.eventMode = 'none';
        root.addChild(clap);
      }
    }

    root.eventMode = 'static';
    root.cursor = canAd || active ? 'pointer' : 'default';
    root.hitArea = new PIXI.Rectangle(0, 0, pillW, pillH);
    bindUiClick(root);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._adBusy) return;
      if (active && !canAd) {
        Platform.showToast(`旺火燃烧中（剩 ${formatChefFireRemain(remain)}）：下锅经验 +30%，35% 概率多盛一份！`);
        return;
      }
      if (!canAd) {
        Platform.showToast('今天的旺火次数已经用完啦，明天再来');
        return;
      }
      this._adBusy = true;
      Platform.showRewardedVideo(
        'chef_buff',
        () => {
          this._adBusy = false;
          KitchenManager.activateChefFire();
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    return root;
  }

  private _sideList(ox: number, oy: number, bw: number, bh: number): PIXI.Container {
    const root = new PIXI.Container();
    const x = bw * INSET.x;
    const y = bh * INSET.y;
    const width = bw * INSET.w * LEFT_W;
    const view = recipeUnlockView(KitchenManager.save);
    const known = unlockedRecipes(view);
    const slip = computeKitchenSlip(KitchenManager.save);
    const pinnedIds = [
      ...KitchenManager.wantedNeighborRecipeIds(),
      ...kitchenSlipPins(slip),
    ].filter((id, i, all) => known.some((r) => r.id === id) && all.indexOf(id) === i);
    const pinned = pinnedIds.map((id) => known.find((r) => r.id === id)!);
    const rest = known.filter((r) => !pinnedIds.includes(r.id));
    const head = makeLabel(`菜谱  ${known.length}`, 26, INK, { fontWeight: '700' });
    head.position.set(x + 8, y + 2);
    root.addChild(head);

    const listTop = y + 38;
    const listH = bh * (INSET.y + INSET.h) - listTop - 8;
    const list = new PIXI.Container();
    const groups = [...new Set(rest.map((r) => r.group))];
    let cy = 0;
    const rowW = width - 12;
    const addRow = (recipe: (typeof known)[number]) => {
      const on = this._pick === recipe.id;
      const row = this._chip(recipe.name, rowW, 44, on ? 'on' : 'off');
      const tab = new PIXI.Graphics();
      tab.beginFill(RARITY_STYLE[recipe.rarity].frame, 1);
      tab.drawRoundedRect(7, 11, 6, 22, 3);
      tab.endFill();
      tab.eventMode = 'none';
      row.addChild(tab);
      const can = recipeCookCount(view, recipe.id);
      const waiting = KitchenManager.wantedNeighborRecipeIds().has(recipe.id);
      row.alpha = can > 0 || on ? 1 : 0.75;
      if (can > 0) row.addChild(this._readyBadge(rowW, can));
      if (waiting) row.addChild(this._waitBadge(can > 0 ? rowW - 62 : rowW - 30));
      row.position.set(x + 6, cy);
      row.on('pointertap', () => {
        if (this._scroller.moved) return;
        if (TutorialManager.isActive && recipe.id !== 'stirfry') {
          TutorialGuard.block('pickRecipe');
          return;
        }
        if (this._pick !== recipe.id) this._cookQty = 1;
        this._pick = recipe.id;
        this.relayout();
      });
      list.addChild(row);
      cy += 52;
    };
    if (pinned.length) {
      const div = makeOrnamentalDivider(rowW, '先做', { fontSize: 15, color: TERRACOTTA });
      div.position.set(x + 6, cy + 12);
      list.addChild(div);
      cy += 28;
      for (const recipe of pinned) addRow(recipe);
      cy += 10;
    }
    for (const group of groups) {
      const div = makeOrnamentalDivider(rowW, group, { fontSize: 15, color: 0x6E5038 });
      div.position.set(x + 6, cy + 12);
      list.addChild(div);
      cy += 28;
      for (const recipe of rest.filter((r) => r.group === group)) addRow(recipe);
      cy += 10;
    }
    const maxScroll = Math.max(0, cy - listH);
    list.y = listTop;
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(x, listTop, width, listH);
      mask.endFill();
      mask.eventMode = 'none';
      root.addChild(mask);
      list.mask = mask;
    }
    root.addChild(list);
    this._scroller.attach({
      content: list,
      maxScroll,
      baseY: listTop,
      hit: { x: ox + x, y: oy + listTop, w: width, h: listH },
    });
    return root;
  }

  private _stage(bw: number, bh: number): PIXI.Container {
    const root = new PIXI.Container();
    const view = recipeUnlockView(KitchenManager.save);
    const recipe = unlockedRecipes(view).find((r) => r.id === this._pick) ?? unlockedRecipes(view)[0];
    if (!recipe) return root;
    this._pick = recipe.id;
    const needs = recipeNeeds(view, recipe.id);
    const max = recipeCookMax(KitchenManager.save, recipe.id);
    this._cookQty = Math.max(1, Math.min(this._cookQty, Math.max(1, max)));
    const qty = max > 0 ? this._cookQty : 1;
    const ready = recipeCanCook(view, recipe.id);

    const pad = bw * 0.02;
    const dx = bw * (INSET.x + INSET.w * LEFT_W) + pad;
    const dy = bh * INSET.y + 4;
    const dw = bw * INSET.w * (1 - LEFT_W) - pad;
    const dishSize = Math.min(Math.round(dw * 0.68), Math.round(bh * INSET.h * 0.22));
    const dishX = dx + (dw - dishSize) / 2;
    const frame = new PIXI.Graphics();
    drawItemSlotBox(frame, dishX, dy, dishSize, dishSize, { radius: 14, rarity: recipe.rarity });
    frame.eventMode = 'none';
    root.addChild(frame);

    const dishTex = dishTexture(recipe.id);
    if (isTextureReady(dishTex)) {
      const dish = new PIXI.Sprite(dishTex);
      fitSpriteInBox(dish, dishSize * 0.78, dishSize * 0.78);
      dish.anchor.set(0.5);
      dish.position.set(dishX + dishSize / 2, dy + dishSize / 2 - 1);
      dish.eventMode = 'none';
      root.addChild(dish);
    }
    const dishHit = new PIXI.Container();
    dishHit.eventMode = 'static';
    dishHit.cursor = 'pointer';
    dishHit.hitArea = new PIXI.Rectangle(dishX, dy, dishSize, dishSize);
    dishHit.on('pointertap', (e) => {
      e.stopPropagation();
      this._inspect = inspectFromRecipe(recipe.id);
      this.relayout();
    });
    root.addChild(dishHit);

    const save = KitchenManager.save;
    const mastery = recipeMasteryView(save, recipe.id);
    if (!TutorialManager.isActive) {
      const mChip = new PIXI.Container();
      const spoons = makeMasterySpoonRow({
        stars: mastery.stars,
        size: 24,
        gap: 2,
        onReady: this._scheduleRelayout,
      });
      const subTxt = mastery.stars >= 3
        ? '+20%'
        : mastery.stars === 2
          ? '+10%'
          : `${mastery.cooked}锅`;
      const mLbl = makeLabel(subTxt, 14, mastery.stars >= 2 ? TERRACOTTA : MUTED, { fontWeight: '700' });
      const pillW = 3 * 24 + 2 * 2 + 8 + Math.ceil(mLbl.width) + 16;
      const pillH = 28;
      const pillBg = new PIXI.Graphics();
      pillBg.lineStyle(2, mastery.stars >= 3 ? 0xD49B28 : 0x8B5A2B, 1);
      pillBg.beginFill(0xFFF8F0, 0.96);
      pillBg.drawRoundedRect(0, 0, pillW, pillH, pillH / 2);
      pillBg.endFill();
      spoons.position.set(8, 2);
      mLbl.anchor.set(0, 0.5);
      mLbl.position.set(8 + 3 * 24 + 4 + 4, pillH / 2 + 0.5);
      mChip.addChild(pillBg, spoons, mLbl);
      mChip.position.set(Math.round(dishX + (dishSize - pillW) / 2), dy + dishSize - 22);
      mChip.eventMode = 'static';
      mChip.cursor = 'pointer';
      mChip.hitArea = new PIXI.Rectangle(0, 0, pillW, pillH);
      mChip.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        Platform.showToast(`${recipe.name} · ${mastery.title}（已做${mastery.cooked}锅）\n${mastery.bonusText}`);
      });
      root.addChild(mChip);
    }

    const cx = dx + dw / 2;
    const nameY = dy + dishSize + 24;
    const name = makeLabel(recipe.name, 28, INK, { fontWeight: '700' });
    name.anchor.set(0.5);
    name.position.set(cx, nameY);
    root.addChild(name);
    const waiting = KitchenManager.wantedNeighborRecipeIds().has(recipe.id);
    if (waiting) {
      const wait = makeLabel('街坊在等', 18, TERRACOTTA, { fontWeight: '700' });
      wait.anchor.set(0.5);
      wait.position.set(cx, nameY + 28);
      root.addChild(wait);
    }
    const baseXp = recipeXp(save, recipe.id);
    const fireOn = isChefFireActive(save);
    const shownXp = fireOn ? Math.round(baseXp * CHEF_FIRE_XP_MUL) : baseXp;
    const xpLabel = makeLabel(
      `${rarityLabel(recipe.rarity)}  ·  +${shownXp} 经验${fireOn ? ' (旺火)' : ''}`,
      18,
      fireOn ? TERRACOTTA : RARITY_STYLE[recipe.rarity].ink,
      { fontWeight: '700' },
    );
    xpLabel.anchor.set(0.5);
    xpLabel.position.set(cx, nameY + (waiting ? 50 : 30));
    root.addChild(xpLabel);
    const eatY = nameY + (waiting ? 72 : 52);
    const eat = makeLabel(recipeEatLabel(recipe.id), 18, 0x3D6A82, { fontWeight: '700' });
    eat.anchor.set(0.5);
    eat.position.set(cx, eatY);
    root.addChild(eat);

    const tx = dx;
    const tw = dw;
    const blurb = new PIXI.Text(recipe.blurb, {
      fontFamily: FONT,
      fontSize: 16,
      fill: 0x5C442E,
      fontWeight: '600',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: Math.max(80, tw - 28),
      lineHeight: 23,
    });
    blurb.eventMode = 'none';
    const blurbBoxY = eatY + 18;
    const blurbBoxH = Math.max(44, Math.ceil(blurb.height) + 16);
    const blurbBg = new PIXI.Graphics();
    drawRecessedWell(blurbBg, tx + 2, blurbBoxY, tw - 4, blurbBoxH, { radius: 11 });
    blurb.position.set(tx + 14, blurbBoxY + 8);
    root.addChild(blurbBg, blurb);

    const gap = 8;
    const trayPad = 8;
    const slotW = Math.min(82, Math.floor((tw - 4 - trayPad * 2 - (needs.length - 1) * gap) / Math.max(2, needs.length)));
    const slotH = slotW + 22;
    const rowW = needs.length * slotW + (needs.length - 1) * gap;
    const trayW = Math.min(tw - 4, Math.max(rowW + trayPad * 2, Math.round(tw * 0.82)));
    const trayX = tx + Math.round((tw - trayW) / 2);
    const slotY = blurbBoxY + blurbBoxH + 10;
    const trayBg = new PIXI.Graphics();
    drawSectionTray(trayBg, trayX, slotY, trayW, slotH + trayPad * 2, { radius: 13, tone: 'sand' });
    root.addChild(trayBg);

    let sx = trayX + Math.round((trayW - rowW) / 2);
    needs.forEach((need) => {
      root.addChild(this._needSlot(sx, slotY + trayPad, slotW, slotH, need.label, need.iconId, need.have, need.need * qty));
      sx += slotW + gap;
    });

    const btnH = 62;
    const stageBottom = bh * (INSET.y + INSET.h);
    const btnY = stageBottom - btnH - 4;
    if (max > 0) {
      root.addChild(makeQtyStepper(cx, btnY - 36, qty, max, (n) => {
        this._cookQty = n;
        this.relayout();
      }));
    }
    const btn = this._cookAction(tw - 8, btnH, ready);
    btn.position.set(tx + 4, btnY);
    this._cookBtn = btn;
    root.addChild(btn);
    return root;
  }

  private _cookAction(width: number, height: number, ready: boolean): PIXI.Container {
    const root = new PIXI.Container();
    const slices = this._buttonSlices(COOK_BTN);
    if (slices) {
      const th = slices.left.height;
      const cap = slices.left.width * (height / th);
      const left = new PIXI.Sprite(slices.left);
      left.height = height;
      left.width = cap;
      left.eventMode = 'none';
      const right = new PIXI.Sprite(slices.right);
      right.height = height;
      right.width = cap;
      right.x = width - cap;
      right.eventMode = 'none';
      const mid = new PIXI.Sprite(slices.mid);
      mid.height = height;
      mid.x = cap;
      mid.width = Math.max(1, width - cap * 2);
      mid.eventMode = 'none';
      root.addChild(left, mid, right);
    } else {
      const bg = new PIXI.Graphics();
      bg.lineStyle(3, INK, 1);
      bg.beginFill(TERRACOTTA);
      bg.drawRoundedRect(0, 0, width, height, height / 2);
      bg.endFill();
      root.addChild(bg);
    }
    const text = makeLabel('烹饪', Math.min(28, height * 0.42), PAPER, { fontWeight: '700' });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2 + 1);
    root.addChild(text);
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    if (ready) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.alpha = 1;
      root.on('pointertap', () => this._doCook());
    } else {
      root.eventMode = 'none';
      root.alpha = 0.42;
    }
    return root;
  }

  private _onTutorialCook = (): void => {
    if (!this._isOpen) return;
    this._pick = 'stirfry';
    this._doCook();
  };

  private _doCook(): void {
    if (TutorialManager.isActive && this._pick !== 'stirfry') {
      TutorialGuard.block('cook');
      return;
    }
    if (TutorialGuard.block('cook')) return;
    const step = TutorialManager.currentStep;
    KitchenManager.cook(this._pick, this._cookQty);
    TutorialManager.onCooked(this._pick);
    if (TutorialManager.currentStep !== step) {
      this.close(true);
      return;
    }
    if (this._isOpen) this.relayout();
  }

  private _needSlot(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    iconId: string,
    have: number,
    need: number,
  ): PIXI.Container {
    const ok = have >= need;
    const footerH = 22;
    const iconAreaH = h - footerH;
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawItemSlotBox(bg, x, y, w, h, {
      radius: 10,
      rarity: itemRarity(iconId),
      dimmed: !ok,
      footerH,
    });
    root.addChild(bg);

    const iconTex = itemTexture(iconId);
    if (isTextureReady(iconTex)) {
      const icon = new PIXI.Sprite(iconTex);
      fitSpriteInBox(icon, w - 16, iconAreaH - 14);
      icon.anchor.set(0.5);
      icon.position.set(x + w / 2, y + iconAreaH / 2 - 1);
      icon.eventMode = 'none';
      if (!ok) icon.alpha = 0.55;
      root.addChild(icon);
    }

    const badge = makeSlotBadge(`${have}/${need}`, ok ? 'olive' : 'lack', 11);
    badge.node.position.set(x + w - badge.w - 3, y + iconAreaH - badge.h - 2);
    root.addChild(badge.node);

    const name = makeLabel(label, 13, ok ? INK : 0x7A6652, { fontWeight: '700' });
    name.anchor.set(0.5);
    name.position.set(x + w / 2, y + h - footerH / 2 - 1);
    root.addChild(name);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, w, h);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this._inspect = inspectFromItem(iconId);
      this.relayout();
    });
    return root;
  }

  private _waitBadge(x: number): PIXI.Container {
    const root = new PIXI.Container();
    const text = makeLabel('等', 16, PAPER, { fontWeight: '700' });
    const w = 28;
    const h = 26;
    const g = new PIXI.Graphics();
    g.beginFill(0x3A6ABF, 1);
    g.drawRoundedRect(0, 0, w, h, 10);
    g.endFill();
    g.eventMode = 'none';
    text.anchor.set(0.5);
    text.position.set(w / 2, h / 2 + 0.5);
    root.addChild(g, text);
    root.eventMode = 'none';
    root.position.set(x, -10);
    return root;
  }

  private _readyBadge(rowW: number, count: number): PIXI.Container {
    const root = new PIXI.Container();
    const text = count > 99 ? '99+' : `${count}`;
    const wide = text.length > 1;
    const w = wide ? 28 : 22;
    const h = 22;
    const g = new PIXI.Graphics();
    g.beginFill(0xD94A3A, 1);
    g.drawRoundedRect(0, 0, w, h, h / 2);
    g.endFill();
    g.eventMode = 'none';
    const n = makeLabel(text, 13, PAPER, { fontWeight: '700' });
    n.anchor.set(0.5);
    n.position.set(w / 2, h / 2 + 0.5);
    root.addChild(g, n);
    root.eventMode = 'none';
    root.position.set(rowW - w + 4, -7);
    return root;
  }

  private _chip(label: string, width: number, height: number, kind: 'primary' | 'idle' | 'on' | 'off'): PIXI.Container {
    const path = kind === 'primary' || kind === 'on' ? BTN.terracotta : BTN.cream;
    const texts = {
      primary: PAPER,
      on: PAPER,
      idle: MUTED,
      off: INK,
    };
    const root = new PIXI.Container();
    const slices = this._buttonSlices(path);
    if (slices) {
      const th = slices.left.height;
      const cap = slices.left.width * (height / th);
      const left = new PIXI.Sprite(slices.left);
      left.height = height;
      left.width = cap;
      left.eventMode = 'none';
      const right = new PIXI.Sprite(slices.right);
      right.height = height;
      right.width = cap;
      right.x = width - cap;
      right.eventMode = 'none';
      const mid = new PIXI.Sprite(slices.mid);
      mid.height = height;
      mid.x = cap;
      mid.width = Math.max(1, width - cap * 2);
      mid.eventMode = 'none';
      root.addChild(left, mid, right);
    } else {
      const fills = { primary: TERRACOTTA, on: TERRACOTTA, idle: 0xE4D4BE, off: 0xF6EDE0 };
      const bg = new PIXI.Graphics();
      bg.lineStyle(3, INK, 1);
      bg.beginFill(fills[kind]);
      bg.drawRoundedRect(0, 0, width, height, height / 2);
      bg.endFill();
      root.addChild(bg);
    }
    const text = makeLabel(label, Math.min(20, height * 0.46), texts[kind], { fontWeight: '700' });
    text.anchor.set(0.5);
    text.position.set(width / 2, height / 2 + 1);
    root.addChild(text);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    bindUiClick(root);
    return root;
  }

  private _buttonSlices(path: string): { left: PIXI.Texture; mid: PIXI.Texture; right: PIXI.Texture } | null {
    const hit = this._btnSlices.get(path);
    if (hit) return hit;
    const tex = gameTexture(path);
    if (!isTextureReady(tex)) return null;
    const tw = tex.width;
    const th = tex.height;
    const cap = Math.min(Math.floor(th * 0.5), Math.floor(tw * 0.34));
    const midW = Math.max(1, tw - cap * 2);
    const slices = {
      left: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(0, 0, cap, th)),
      mid: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(cap, 0, midW, th)),
      right: new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tw - cap, 0, cap, th)),
    };
    this._btnSlices.set(path, slices);
    return slices;
  }
}
