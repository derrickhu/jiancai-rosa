import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  RECIPE_GACHA_COST,
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
import { fillRect, makeLabel, makeRewardStrip, makeSlicedButton } from '@/utils/ui';
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
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x8A6A40;
const PAPER = 0xFFF8F0;
const CREAM = 0xF6EDE0;
const WALNUT = 0x8B5A2B;
const LINE = 0xC4A574;
const TERRACOTTA = 0xC46A3A;
const GOLD = 0xC48A14;

export class DailyMenuPanel extends PIXI.Container {
  _isOpen = false;
  onCook: ((recipeId: DailyMenuLine['recipeId']) => void) | null = null;
  private _root = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;

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
    watchTextures(dailyMenuPanelPaths(KitchenManager.save), this._scheduleRelayout);
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
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.36;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) return;
      this.close();
    });
    this._root.addChild(dim);

    const rowH = 248;
    const boxW = w - 40;
    const titleH = 52;
    const prizeH = 100;
    const headH = 16 + titleH + 8 + prizeH + 10;
    const footH = 72;
    const boxH = headH + menu.lines.length * (rowH + 14) + footH;
    const x = 20;
    const y = Math.round(Math.max(Game.safeTop + 16, (h - boxH) / 2));

    const panel = new PIXI.Graphics();
    panel.lineStyle(5, WALNUT, 1);
    panel.beginFill(CREAM);
    panel.drawRoundedRect(x, y, boxW, boxH, 28);
    panel.endFill();
    panel.eventMode = 'static';
    panel.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(panel);
    const inner = new PIXI.Graphics();
    inner.lineStyle(2, LINE, 0.7);
    inner.beginFill(0xF3E6D0);
    inner.drawRoundedRect(x + 14, y + 14, boxW - 28, boxH - 28, 20);
    inner.endFill();
    this._root.addChild(inner);

    this._root.addChild(this._title(x + 20, y + 16, boxW - 40, titleH));
    this._root.addChild(this._progress(menu, x + 28, y + 16 + titleH + 8, boxW - 56, prizeH));

    menu.lines.forEach((line, i) => {
      this._root.addChild(this._row(line, x + 28, y + headH + i * (rowH + 14), boxW - 56, rowH));
    });

    const closeW = 168;
    const close = makeSlicedButton({
      label: '关上',
      width: closeW,
      height: 46,
      skin: 'wood',
      onReady: this._scheduleRelayout,
    });
    close.position.set(x + (boxW - closeW) / 2, y + boxH - 60);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);

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
        onReady: this._scheduleRelayout,
      }));
    }
  }

  private _title(x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const tex = gameTexture(TITLE);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, width, height);
      spr.anchor.set(0.5);
      spr.position.set(x + width / 2, y + height / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const fallback = makeLabel('今日菜单', 34, INK, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: 0xFFF6E8,
        strokeThickness: 5,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(x + width / 2, y + height / 2);
      root.addChild(fallback);
    }
    return root;
  }

  private _progress(menu: DailyMenuState, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const { done, need, ratio } = dailyMenuProgress(menu);
    const claimed = menu.boardClaimed;
    const tickets = Math.max(1, menu.board?.tickets ?? 1);
    const iconW = 80;
    const iconH = 58;
    const gap = 12;
    const hintH = 24;
    const barH = 22;
    const barW = Math.min(300, Math.max(200, width - iconW - gap - 48));
    const groupW = barW + gap + iconW;
    const barX = x + Math.max(0, (width - groupW) / 2);
    const barY = y + hintH + 8;
    const iconX = barX + barW + gap + iconW / 2;
    const iconY = barY + barH / 2;

    const well = new PIXI.Graphics();
    well.lineStyle(3, LINE, 1);
    well.beginFill(PAPER, 1);
    well.drawRoundedRect(barX, barY, barW, barH, barH / 2);
    well.endFill();
    root.addChild(well);

    const innerPad = 4;
    const innerW = barW - innerPad * 2;
    const innerH = barH - innerPad * 2;
    const fillW = claimed || ratio >= 1
      ? innerW
      : ratio > 0
        ? Math.max(innerH, innerW * ratio)
        : 0;
    if (fillW > 0) {
      const fill = new PIXI.Graphics();
      fill.beginFill(claimed ? 0x6BA368 : TERRACOTTA, 1);
      fill.drawRoundedRect(barX + innerPad, barY + innerPad, fillW, innerH, innerH / 2);
      fill.endFill();
      fill.beginFill(0xFFF6E8, 0.28);
      fill.drawRoundedRect(barX + innerPad, barY + innerPad, fillW, Math.max(6, innerH * 0.38), innerH / 2);
      fill.endFill();
      root.addChild(fill);
    }

    const hint = claimed
      ? '奖励已发'
      : need > 0
        ? `${done}/${need}  全部完成后可获得奖励`
        : '全部完成后可获得奖励';
    const count = makeLabel(hint, 18, INK, { fontWeight: '700' });
    count.anchor.set(0.5, 0);
    count.position.set(barX + barW / 2, y);
    count.eventMode = 'none';
    root.addChild(count);

    const hit = new PIXI.Container();
    const tex = gameTexture(TICKET);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, iconW, iconH);
      spr.anchor.set(0.5);
      spr.position.set(0, 0);
      spr.alpha = claimed || ratio >= 1 ? 1 : 0.86;
      spr.eventMode = 'none';
      hit.addChild(spr);
    }
    const tag = makeLabel(claimed ? '已发' : `×${tickets}`, 16, claimed ? 0x6BA368 : TERRACOTTA, {
      fontWeight: '700',
    });
    tag.anchor.set(0.5, 0);
    tag.position.set(0, iconH / 2);
    tag.eventMode = 'none';
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
    const bg = new PIXI.Graphics();
    bg.lineStyle(3, LINE, 1);
    bg.beginFill(PAPER, 1);
    bg.drawRoundedRect(x, y, width, height, 16);
    bg.endFill();
    root.addChild(bg);

    const recipe = recipeById(line.recipeId);
    const view = recipeUnlockView(KitchenManager.save);
    const have = fridgeDishQty(KitchenManager.save.fridge, line.recipeId);
    const done = line.done >= line.need;
    const pad = 16;
    const dishSize = 72;
    root.addChild(this._dishTile(line.recipeId, x + pad, y + pad + 8, dishSize));

    const textX = x + pad + dishSize + 16;
    const name = makeLabel(recipe?.name ?? '菜', 22, INK, { fontWeight: '700' });
    name.position.set(textX, y + pad + 2);
    root.addChild(name);
    const progress = makeLabel(
      done ? '交齐了' : `要交 ${line.done}/${line.need}  ·  冰箱 ${have} 盘`,
      20,
      done ? GOLD : TERRACOTTA,
      { fontWeight: '700' },
    );
    progress.position.set(textX, y + pad + 36);
    root.addChild(progress);

    const lackY = y + pad + 82;
    const missing = recipeNeeds(view, line.recipeId).filter((row) => row.have < row.need);
    if (done) {
      const ready = makeLabel('这行已经收下了。', 20, MUTED);
      ready.position.set(textX, lackY + 14);
      root.addChild(ready);
    } else if (have > 0) {
      const ready = makeLabel('冰箱里有现成的，点交菜就扣。', 20, MUTED);
      ready.position.set(textX, lackY + 14);
      root.addChild(ready);
    } else if (missing.length) {
      const lack = makeLabel('还缺', 20, MUTED);
      lack.anchor.set(0, 0.5);
      lack.position.set(textX, lackY + 24);
      root.addChild(lack);
      let usedX = textX + Math.ceil(lack.width) + 12;
      for (const row of missing) {
        root.addChild(this._needTile(usedX, lackY, 48, row.iconId, row.have, row.need));
        usedX += 58;
      }
    } else {
      const ready = makeLabel('材料齐了，去做再交。', 20, MUTED);
      ready.anchor.set(0, 0.5);
      ready.position.set(textX, lackY + 22);
      root.addChild(ready);
      const cook = makeSlicedButton({
        label: '去做菜',
        width: 112,
        height: 44,
        skin: 'terracotta',
        textColor: 0xFFF8F0,
        onReady: this._scheduleRelayout,
      });
      cook.position.set(textX + Math.ceil(ready.width) + 12, lackY);
      cook.on('pointertap', () => {
        this.onCook?.(line.recipeId);
      });
      root.addChild(cook);
    }

    const chips = dailyMenuRewardChips(line);
    if (chips.length) {
      const strip = makeRewardStrip(chips, this._scheduleRelayout, done ? '已发' : '交齐给', 'paper');
      strip.position.set(textX, y + pad + 164);
      root.addChild(strip);
    }

    if (done) {
      root.addChild(this._doneStamp(x + width - 118, y + pad + 58));
    } else {
      const btn = makeSlicedButton({
        label: '交菜',
        width: 112,
        height: 44,
        skin: have > 0 ? 'terracotta' : 'cream',
        textColor: have > 0 ? 0xFFF8F0 : INK,
        onReady: this._scheduleRelayout,
      });
      btn.position.set(x + width - 128, y + pad);
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
      fitSpriteInBox(spr, 108, 108);
      spr.anchor.set(0.5);
      spr.angle = -16;
      spr.alpha = 0.94;
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const mark = makeLabel('完成', 28, TERRACOTTA, {
        fontFamily: TITLE_FONT,
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
    const plate = new PIXI.Graphics();
    plate.lineStyle(2, LINE, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(x, y, size, size, 14);
    plate.endFill();
    root.addChild(plate);
    const dishTex = dishTexture(recipeId);
    if (isTextureReady(dishTex)) {
      const dish = new PIXI.Sprite(dishTex);
      fitSpriteInBox(dish, size - 10, size - 10);
      dish.anchor.set(0.5);
      dish.position.set(x + size / 2, y + size / 2);
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
    plate.lineStyle(2, LINE, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(x, y, size, size, 12);
    plate.endFill();
    root.addChild(plate);
    const iconTex = itemTexture(iconId);
    if (isTextureReady(iconTex)) {
      const icon = new PIXI.Sprite(iconTex);
      fitSpriteInBox(icon, size - 8, size - 8);
      icon.anchor.set(0.5);
      icon.position.set(x + size / 2, y + size / 2);
      icon.eventMode = 'none';
      root.addChild(icon);
    }

    const count = makeLabel(`${have}/${need}`, 16, TERRACOTTA, { fontWeight: '700' });
    count.anchor.set(0.5, 0);
    count.position.set(x + size / 2, y + size + 2);
    root.addChild(count);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size + 20);
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
