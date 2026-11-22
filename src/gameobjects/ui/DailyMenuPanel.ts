import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  RECIPE_GACHA_COST,
  canUseDailyAd,
  dailyMenuProgress,
  dailyMenuRewardChips,
  fridgeDishQty,
  recipeById,
  recipeNeeds,
  recipeUnlockView,
  type DailyMenuLine,
  type DailyMenuState,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
import { playDailyMenuClearBanner } from '@/utils/dailyMenuClearFx';
import {
  P0_ART,
  SERIF_FONT,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawItemSlotBox,
  drawRecessedWell,
  drawSectionTray,
  fillRect,
  makeAdButton,
  makeArtisanShell,
  makeCraftProgressBar,
  makeLabel,
  makeRewardStrip,
  makeSlicedButton,
  makeSlotBadge,
} from '@/utils/ui';
import { dailyMenuPanelPaths } from '@/utils/panelAssets';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  watchTextures,
} from '@/utils/assets';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';

const TITLE = 'subpkg_kitchen/ui_daily_menu_title.png';
const TICKET = 'subpkg_images/ui_menu_ticket.png';
const STAMP = 'subpkg_kitchen/ui_daily_done_stamp.png';
const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const TERRACOTTA = UI_PALETTE.terracotta;
const OLIVE = UI_PALETTE.olive;

export class DailyMenuPanel extends PIXI.Container {
  _isOpen = false;
  onCook: ((recipeId: DailyMenuLine['recipeId']) => void) | null = null;
  private _root = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;
  private _adBusy = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 25;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    KitchenManager.ensureDailyMenu();
    if (!KitchenManager.save.dailyMenu) return;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    warmupAdScene('daily_extra');
    this._warm();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._paintQueued = false;
    this._root.removeChildren();
  }

  private _warm(): void {
    watchTextures(
      [
        UI_KIT.closeRound,
        UI_KIT.btnOlive,
        UI_KIT.btnGold,
        ...dailyMenuPanelPaths(KitchenManager.save),
        P0_ART.adClapper,
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
    this._root.removeChildren();
    if (!this._isOpen) return;
    this._warm();
    KitchenManager.ensureDailyMenu();
    const menu = KitchenManager.save.dailyMenu;
    if (!menu) {
      this.close(true);
      return;
    }

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) {
        this._inspect = null;
        this.relayout();
        return;
      }
      if (!this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const canExtra = menu.boardClaimed && canUseDailyAd(KitchenManager.save, 'daily_extra');
    const rowH = canExtra ? 222 : 238;
    const rowGap = 11;
    const boxW = Math.min(w - 30, 706);
    const padX = 24;
    const cw = boxW - padX * 2;
    const titleH = 54;
    const prizeH = 88;
    const headH = 22 + titleH + 8 + prizeH + 12;
    const footH = canExtra ? 94 : 26;
    const boxH = headH + menu.lines.length * rowH + (menu.lines.length - 1) * rowGap + footH;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 16, (h - boxH) / 2));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      onReady: this._scheduleRelayout,
      closeSilent: true,
      onClose: () => {
        if (!this._adBusy) this.close();
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    shell.addChild(this._title(menu, padX, 20, cw, titleH));
    shell.addChild(this._progress(menu, padX, 20 + titleH + 8, cw, prizeH));

    menu.lines.forEach((line, i) => {
      shell.addChild(this._row(line, padX, headH + i * (rowH + rowGap), cw, rowH));
    });

    if (canExtra) {
      const stripY = boxH - footH + 6;
      const strip = new PIXI.Graphics();
      drawCraftCard(strip, padX, stripY, cw, 66, { radius: 16, tone: 'gold' });
      shell.addChild(strip);

      const note = makeLabel('街坊没吃尽兴！加开晚市再领 1 张菜谱券', 17, INK, { fontWeight: '700' });
      note.anchor.set(0, 0.5);
      note.position.set(padX + 18, stripY + 32);
      shell.addChild(note);

      const extraBtn = makeAdButton({
        label: '加开晚市',
        width: 192,
        height: 46,
        skin: 'gold',
        badge: '送券×1',
        onReady: this._scheduleRelayout,
      });
      extraBtn.position.set(padX + cw - 204, stripY + 10);
      extraBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'daily_extra',
          () => {
            this._adBusy = false;
            KitchenManager.unlockExtraDailyMenu();
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      shell.addChild(extraBtn);
    }

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onClose: () => {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
        },
        onReady: this._scheduleRelayout,
      }));
    }
  }

  private _title(menu: DailyMenuState, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const tex = gameTexture(TITLE);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, width - 90, height);
      spr.anchor.set(0.5);
      spr.position.set(x + width / 2, y + height / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const fallback = makeLabel('今 日 菜 单', 32, INK, {
        fontFamily: SERIF_FONT,
        fontWeight: '700',
        stroke: 0xFFF6E8,
        strokeThickness: 5,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(x + width / 2, y + height / 2);
      root.addChild(fallback);
    }
    if (menu.extraRound) {
      const tag = new PIXI.Container();
      const txt = makeLabel('晚市加桌', 14, 0xFFF8F0, { fontWeight: '700' });
      const tw = Math.ceil(txt.width) + 20;
      const th = 26;
      const g = new PIXI.Graphics();
      g.lineStyle(2, INK, 1);
      g.beginFill(TERRACOTTA, 1);
      g.drawRoundedRect(0, 0, tw, th, th / 2);
      g.endFill();
      txt.anchor.set(0.5);
      txt.position.set(tw / 2, th / 2);
      tag.addChild(g, txt);
      tag.position.set(x + 6, y + Math.round((height - th) / 2));
      tag.eventMode = 'none';
      root.addChild(tag);
    }
    return root;
  }

  private _progress(menu: DailyMenuState, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const well = new PIXI.Graphics();
    drawRecessedWell(well, x, y, width, height, { radius: 16 });
    root.addChild(well);

    const { done, need, ratio } = dailyMenuProgress(menu);
    const claimed = menu.boardClaimed;
    const tickets = Math.max(1, menu.board?.tickets ?? 1);
    const iconW = 78;
    const iconH = 54;
    const gap = 16;
    const barW = Math.min(340, width - iconW - gap - 44);
    const groupW = barW + gap + iconW;
    const barX = x + Math.round((width - groupW) / 2);
    const barY = y + 40;
    const iconX = barX + barW + gap + iconW / 2;
    const iconY = y + height / 2 - 4;

    const hint = claimed
      ? '✓ 本桌三道已齐 · 菜谱券已发放'
      : need > 0
        ? `上菜进度 ${done}/${need} · 满桌送菜谱券`
        : '全部完成后可获得奖励';
    const count = makeLabel(hint, 17, claimed ? OLIVE : INK, { fontWeight: '700' });
    count.anchor.set(0.5, 0);
    count.position.set(barX + barW / 2, y + 11);
    root.addChild(count);

    const bar = makeCraftProgressBar({
      width: barW,
      height: 22,
      ratio: claimed ? 1 : ratio,
      scheme: claimed ? 'olive' : 'terracotta',
    });
    bar.position.set(barX, barY);
    root.addChild(bar);

    const hit = new PIXI.Container();
    const tex = gameTexture(TICKET);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, iconW, iconH);
      spr.anchor.set(0.5);
      spr.alpha = claimed || ratio >= 1 ? 1 : 0.88;
      spr.eventMode = 'none';
      hit.addChild(spr);
    }
    const tag = makeLabel(claimed ? '已发' : `×${tickets}`, 16, claimed ? OLIVE : TERRACOTTA, {
      fontWeight: '700',
    });
    tag.anchor.set(0.5, 0);
    tag.position.set(0, iconH / 2 - 2);
    hit.addChild(tag);
    hit.position.set(iconX, iconY);
    hit.eventMode = 'static';
    hit.cursor = 'pointer';
    hit.hitArea = new PIXI.Rectangle(-iconW / 2, -iconH / 2, iconW, iconH + 20);
    hit.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._inspect = this._ticketInspect(tickets, claimed);
      this.relayout();
    });
    root.addChild(hit);
    return root;
  }

  private _ticketInspect(tickets: number, claimed: boolean): ItemInspectView {
    return {
      title: '菜谱券',
      blurb: '小饭桌三道都交齐后自动发一张。去抽谱口花两张开一次箱子：可能是还没做过的菜谱，也可能是稀有以上的食材。',
      kind: 'food',
      defId: 'recipe_ticket',
      quality: 'fresh',
      rarity: 'rare',
      unitPrice: 0,
      maxQty: 1,
      iconPath: TICKET,
      note: claimed ? '今日已发' : `完成菜单发 ×${tickets}`,
      priceLine: `抽一次要 ${RECIPE_GACHA_COST} 张`,
      eatLabel: '点左侧抽谱就能用',
    };
  }

  private _row(line: DailyMenuLine, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const recipe = recipeById(line.recipeId);
    const view = recipeUnlockView(KitchenManager.save);
    const have = fridgeDishQty(KitchenManager.save.fridge, line.recipeId);
    const done = line.done >= line.need;

    const headerH = 44;
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, {
      radius: 16,
      tone: done ? 'olive' : have > 0 ? 'gold' : 'ivory',
      headerH,
    });
    root.addChild(bg);

    const name = makeLabel(recipe?.name ?? '菜', 21, INK, { fontWeight: '700' });
    name.anchor.set(0, 0.5);
    name.position.set(x + 16, y + headerH / 2 + 1);
    root.addChild(name);

    const progStr = done ? '✓ 已上齐' : `要交 ${line.done}/${line.need} · 冰箱 ${have} 盘`;
    const progLbl = makeLabel(progStr, 15, 0xFFFDF8, { fontWeight: '700' });
    const pW = Math.ceil(progLbl.width) + 20;
    const pH = 26;
    const pBg = new PIXI.Graphics();
    pBg.beginFill(done ? OLIVE : have > 0 ? 0xB87910 : 0x7A5B40, 1);
    pBg.drawRoundedRect(0, 0, pW, pH, pH / 2);
    pBg.endFill();
    progLbl.anchor.set(0.5);
    progLbl.position.set(pW / 2, pH / 2);
    const pWrap = new PIXI.Container();
    pWrap.addChild(pBg, progLbl);
    pWrap.position.set(x + width - pW - 14, y + Math.round((headerH - pH) / 2) + 1);
    root.addChild(pWrap);

    const bodyY = y + headerH + 8;
    const pad = 14;
    const actW = 124;
    const trayW = width - pad * 2 - actW - 14;
    const trayH = 82;
    const tray = new PIXI.Graphics();
    drawSectionTray(tray, x + pad, bodyY, trayW, trayH, {
      radius: 13,
      tone: done || have > 0 ? 'sage' : 'sand',
    });
    root.addChild(tray);

    const dishSize = 66;
    root.addChild(this._dishTile(line.recipeId, x + pad + 8, bodyY + 8, dishSize));

    const innerX = x + pad + 8 + dishSize + 12;
    const missing = recipeNeeds(view, line.recipeId).filter((row) => row.have < row.need);
    if (done) {
      const ready = makeLabel('✓ 街坊已经美美吃上啦！', 18, OLIVE, { fontWeight: '700' });
      ready.anchor.set(0, 0.5);
      ready.position.set(innerX, bodyY + trayH / 2);
      root.addChild(ready);
    } else if (have > 0) {
      const ready = makeLabel('✓ 冰箱有现成，点交菜上桌！', 18, OLIVE, { fontWeight: '700' });
      ready.anchor.set(0, 0.5);
      ready.position.set(innerX, bodyY + trayH / 2);
      root.addChild(ready);
    } else if (missing.length) {
      const lack = makeLabel('缺料', 16, 0x7A5B40, { fontWeight: '700' });
      lack.anchor.set(0.5);
      lack.position.set(innerX + 18, bodyY + trayH / 2);
      root.addChild(lack);
      let usedX = innerX + 42;
      const slotS = 62;
      for (const row of missing) {
        if (usedX + slotS > x + pad + trayW - 6) break;
        root.addChild(this._needTile(usedX, bodyY + Math.round((trayH - slotS) / 2), slotS, row.iconId, row.have, row.need));
        usedX += slotS + 6;
      }
    } else {
      const ready = makeLabel('食材齐备', 18, OLIVE, { fontWeight: '700' });
      ready.anchor.set(0, 0.5);
      ready.position.set(innerX, bodyY + trayH / 2);
      root.addChild(ready);
      const cook = makeSlicedButton({
        label: '去做菜',
        width: 110,
        height: 42,
        skin: 'terracotta',
        textColor: 0xFFF8F0,
        fontSize: 18,
        onReady: this._scheduleRelayout,
      });
      cook.position.set(innerX + Math.ceil(ready.width) + 10, bodyY + Math.round((trayH - 42) / 2));
      cook.on('pointertap', () => {
        this.onCook?.(line.recipeId);
      });
      root.addChild(cook);
    }

    const chips = dailyMenuRewardChips(line);
    if (chips.length) {
      const strip = makeRewardStrip(chips, this._scheduleRelayout, done ? '已发' : '赏金', 'paper');
      strip.position.set(x + pad, y + height - 50);
      root.addChild(strip);
    }

    if (done) {
      root.addChild(this._doneStamp(x + width - 78, bodyY + trayH / 2 + 16));
    } else {
      const btn = makeSlicedButton({
        label: '交菜',
        width: actW,
        height: 50,
        skin: have > 0 ? 'olive' : 'cream',
        textColor: have > 0 ? 0xFFF8F0 : 0x8A7358,
        onReady: this._scheduleRelayout,
      });
      btn.position.set(x + width - actW - 14, bodyY + Math.round((trayH - 50) / 2));
      btn.on('pointertap', () => {
        const gain = KitchenManager.submitDailyMenu(line.recipeId);
        this._inspect = null;
        if (this._isOpen) this.relayout();
        if (gain) this._playSubmitFx(gain);
      });
      root.addChild(btn);
    }
    return root;
  }

  private _playSubmitFx(gain: {
    gold?: number;
    foldGold?: number;
    foodDefId?: string;
    foodFolded?: boolean;
    tickets?: number;
  }): void {
    const tickets = Math.max(0, Math.floor(gain.tickets ?? 0));
    const from = {
      x: Game.designWidth / 2,
      y: Math.round(Game.logicHeight * 0.42),
    };
    playRewardCollect({ ...gain, tickets: 0, from }, () => {
      if (tickets <= 0) return;
      playDailyMenuClearBanner(() => {
        playTicketCollect(from, kitchenGachaHudPos(), 0);
      });
    });
  }

  private _doneStamp(cx: number, cy: number): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const tex = gameTexture(STAMP);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, 104, 104);
      spr.anchor.set(0.5);
      spr.angle = -16;
      spr.alpha = 0.94;
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const mark = makeLabel('完成', 28, TERRACOTTA, {
        fontFamily: SERIF_FONT,
        fontWeight: '700',
        stroke: 0xFFF6E8,
        strokeThickness: 5,
      });
      mark.anchor.set(0.5);
      mark.angle = -16;
      root.addChild(mark);
    }
    root.position.set(cx, cy);
    return root;
  }

  private _dishTile(recipeId: DailyMenuLine['recipeId'], x: number, y: number, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const recipe = recipeById(recipeId);
    const plate = new PIXI.Graphics();
    drawItemSlotBox(plate, x, y, size, size, { radius: 11, rarity: recipe?.rarity ?? 'common' });
    root.addChild(plate);
    const dishTex = dishTexture(recipeId);
    if (isTextureReady(dishTex)) {
      const dish = new PIXI.Sprite(dishTex);
      fitSpriteInBox(dish, size - 10, size - 10);
      dish.anchor.set(0.5);
      dish.position.set(x + size / 2, y + size / 2 - 1);
      dish.eventMode = 'none';
      root.addChild(dish);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      const view = inspectFromRecipe(recipeId);
      if (!view) return;
      AudioManager.play('ui_click');
      this._inspect = view;
      this.relayout();
    });
    return root;
  }

  private _needTile(x: number, y: number, size: number, iconId: string, have: number, need: number): PIXI.Container {
    const root = new PIXI.Container();
    const plate = new PIXI.Graphics();
    drawItemSlotBox(plate, x, y, size, size, { radius: 10, dimmed: have < need });
    root.addChild(plate);
    const iconTex = itemTexture(iconId);
    if (isTextureReady(iconTex)) {
      const icon = new PIXI.Sprite(iconTex);
      fitSpriteInBox(icon, size - 12, size - 12);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2 - 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    }

    const badge = makeSlotBadge(`${have}/${need}`, have >= need ? 'olive' : 'lack', 13);
    badge.node.position.set(x + size - badge.w - 2, y + size - badge.h - 2);
    root.addChild(badge.node);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      const view = inspectFromItem(iconId);
      if (!view) return;
      AudioManager.play('ui_click');
      this._inspect = view;
      this.relayout();
    });
    return root;
  }
}
