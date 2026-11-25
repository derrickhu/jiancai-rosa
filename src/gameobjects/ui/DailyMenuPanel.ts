import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { TutorialOverlay } from '@/gameobjects/ui/TutorialOverlay';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
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
  UI_KIT,
  attachSpriteContour,
  fitTextWidth,
  makeAdButton,
  makeHandProgressBar,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import { dailyMenuPanelPaths } from '@/utils/panelAssets';
import {
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeDishDisplay,
  makeInlineRewards,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

/** 今日菜单挂牌墙：两侧红灯笼 + 麻绳悬吊黑板 + 铜钉宣纸菜单笺。 */
const ART = {
  wall: 'subpkg_images/scene_menu_wall.png',
  ticket: 'subpkg_images/ui_menu_ticket.png',
} as const;

const W = 720;
const L = {
  wallSliceTop: 320,
  wallSliceBottom: 140,
  boardLeft: 154,
  boardRight: 568,
  boardTop: 278,
  sheetTop: 404,
  sheetX: 28,
  sheetTopPad: 32,
  sheetBottomPad: 36,
  rowH: 178,
  extraH: 102,
  contentX: 62,
  contentR: 658,
} as const;

export class DailyMenuPanel extends PIXI.Container {
  _isOpen = false;
  onCook: ((recipeId: DailyMenuLine['recipeId']) => void) | null = null;
  private _root = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;
  private _adBusy = false;
  private _toStage: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });

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
    this._adBusy = false;
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
    this._adBusy = false;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
    TutorialOverlay.refresh();
  }

  private _warm(): void {
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        ...uiBarPaths(),
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
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;
    this._warm();
    KitchenManager.ensureDailyMenu();
    const menu = KitchenManager.save.dailyMenu;
    if (!menu) {
      this.close(true);
      return;
    }

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const canExtra = menu.boardClaimed && canUseDailyAd(KitchenManager.save, 'daily_extra');
    const n = menu.lines.length;
    const sheetH = L.sheetTopPad + n * L.rowH + (canExtra ? L.extraH : 0) + L.sheetBottomPad;
    const panelH = L.sheetTop + sheetH + 34;

    const { scene, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 44,
      onDimTap: () => {
        if (this._inspect) {
          this._inspect = null;
          this.relayout();
          return;
        }
        if (!this._adBusy) this.close();
      },
    });
    this._toStage = toStage;

    drawSceneWall(scene, ART.wall, W, panelH, L.wallSliceTop, L.wallSliceBottom, 0x4A2A18);
    drawPlaqueTitle(scene, '今日菜单', W / 2, -44, 344);
    if (menu.extraRound) {
      const extraSeal = makeSealStamp('晚市', 52, 0.09);
      extraSeal.position.set(W / 2 + 168, 42);
      scene.addChild(extraSeal);
    }

    this._drawChalkProgress(scene, menu);

    drawStretchSheet(
      scene,
      SCENE_ART.sheet,
      L.sheetX,
      L.sheetTop,
      W - L.sheetX * 2,
      sheetH,
      140,
      120,
    );

    menu.lines.forEach((line, i) => {
      const ry = L.sheetTop + L.sheetTopPad + i * L.rowH;
      this._drawMenuLine(scene, line, ry, i < n - 1 || canExtra);
    });

    if (canExtra) {
      const extraY = L.sheetTop + L.sheetTopPad + n * L.rowH;
      this._drawExtraRoundFooter(scene, extraY);
    }

    drawSceneClose(
      scene,
      W - 46,
      -20,
      () => {
        if (!this._adBusy) this.close();
      },
      this._scheduleRelayout,
    );

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

  // ── 黑板横幅：粉笔上菜进度 + 悬钉满桌菜谱券 ───────────────────────────────
  private _drawChalkProgress(scene: PIXI.Container, menu: DailyMenuState): void {
    const { done, need, ratio } = dailyMenuProgress(menu);
    const claimed = menu.boardClaimed;
    const tickets = Math.max(1, menu.board?.tickets ?? 1);

    const leftX = L.boardLeft;
    const barW = 294;
    const hint = claimed
      ? '✓ 本桌三道已齐 · 菜谱券已入袋'
      : need > 0
        ? `${menu.extraRound ? '晚市' : '今日'}上菜 ${done}/${need} · 满桌赠菜谱券`
        : '交齐今日三道拿菜谱券';
    const headline = makeText('heading', hint, claimed ? 0xC2F5A8 : SCENE_INK.cream, {
      size: 25,
      stroke: 0x162219,
      strokeWidth: 4,
    });
    headline.anchor.set(0, 0.5);
    headline.position.set(leftX, L.boardTop + 34);
    fitTextWidth(headline, barW + 6);
    scene.addChild(headline);

    const bar = makeHandProgressBar({
      width: barW,
      height: 22,
      ratio: claimed ? 1 : Math.max(0.06, ratio),
      onReady: this._scheduleRelayout,
    });
    bar.node.position.set(leftX, L.boardTop + 68);
    scene.addChild(bar.node);

    // 右侧：实物菜谱券（点按可查看详情）
    const ticketCx = 516;
    const ticketCy = L.boardTop + 50;
    const ticketHit = new PIXI.Container();
    ticketHit.position.set(ticketCx, ticketCy);
    const sp = sceneSprite(ART.ticket, 86, 62);
    if (sp) {
      sp.anchor.set(0.5);
      sp.rotation = -0.08;
      sp.alpha = claimed ? 0.85 : 1;
      ticketHit.addChild(sp);
      if (!claimed && ratio >= 1) {
        attachSpriteContour(ticketHit, sp, 'god', {
          onDark: true,
          selected: true,
          thicknessScale: 0.95,
        });
      }
    }
    const countTxt = makeText(
      'number',
      claimed ? '已发' : `×${tickets}`,
      claimed ? 0xC2F5A8 : 0xFFE082,
      { size: 22, stroke: 0x162219, strokeWidth: 4 },
    );
    countTxt.anchor.set(0.5, 0);
    countTxt.position.set(0, 26);
    ticketHit.addChild(countTxt);

    ticketHit.eventMode = 'static';
    ticketHit.cursor = 'pointer';
    ticketHit.hitArea = new PIXI.Rectangle(-54, -40, 108, 98);
    ticketHit.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._inspect = this._ticketInspect(tickets, claimed);
      this.relayout();
    });
    scene.addChild(ticketHit);
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
      iconPath: ART.ticket,
      note: claimed ? '今日已发' : `完成菜单发 ×${tickets}`,
      priceLine: `抽一次要 ${RECIPE_GACHA_COST} 张`,
      eatLabel: '点厨房左侧抽谱台即可使用',
    };
  }

  // ── 宣纸菜单单行：青花瓷碟菜品 / 大字菜名+食材需求+无框赏金 / 按钮或完成红印 ──
  private _drawMenuLine(
    scene: PIXI.Container,
    line: DailyMenuLine,
    y: number,
    showDivider: boolean,
  ): void {
    const row = new PIXI.Container();
    row.position.set(0, y);
    scene.addChild(row);

    const save = KitchenManager.save;
    const recipe = recipeById(line.recipeId);
    const view = recipeUnlockView(save);
    const have = fridgeDishQty(save.fridge, line.recipeId);
    const done = line.done >= line.need;
    const needs = recipeNeeds(view, line.recipeId);
    const missing = needs.filter((n) => n.have < n.need);

    // 左：立体成菜大图标直呈（贴边品质轮廓光，点击预览菜谱详情）
    const plateCx = L.contentX + 58;
    const plateCy = 88;
    const dishRarity = recipe?.rarity ?? 'common';
    const dishNode = makeDishDisplay({
      dishPath: resolveDishAssetPath(line.recipeId),
      size: 106,
      qty: line.need > 1 ? line.need : undefined,
      dim: false,
      shadowAlpha: 0.22,
      rarity: dishRarity,
      contourOpts: {
        selected: have > 0 && !done,
        alpha: done ? 0.65 : undefined,
      },
    });
    dishNode.position.set(plateCx, plateCy + 4);
    dishNode.eventMode = 'static';
    dishNode.cursor = 'pointer';
    dishNode.hitArea = new PIXI.Rectangle(-62, -64, 124, 124);
    dishNode.on('pointertap', (e) => {
      e.stopPropagation();
      const inspect = inspectFromRecipe(line.recipeId);
      if (!inspect) return;
      AudioManager.play('ui_click');
      this._inspect = inspect;
      this.relayout();
    });
    row.addChild(dishNode);

    // 右列宽度与位置预留
    const btnW = 152;
    const btnH = 58;
    const btnX = L.contentR - btnW;
    const midX = L.contentX + 132;
    const maxMidW = btnX - midX - 14;

    // 中上：菜名（30pt）+ 多盘进度说明
    const dishName = makeText('title', recipe?.name ?? '家常菜', SCENE_INK.ink, { size: 30 });
    dishName.anchor.set(0, 0.5);
    dishName.position.set(midX, 32);
    const needSuffix = !done && line.need > 1 ? `${line.done}/${line.need}盘` : '';
    if (needSuffix) {
      const suffixT = makeText('caption', needSuffix, SCENE_INK.soft, { size: 22, fontWeight: '700' });
      suffixT.anchor.set(1, 0.5);
      suffixT.position.set(btnX - 14, 34);
      fitTextWidth(dishName, Math.max(120, maxMidW - suffixT.width - 10));
      row.addChild(dishName, suffixT);
    } else {
      fitTextWidth(dishName, maxMidW);
      row.addChild(dishName);
    }

    // 中间：现成提示 或 无框食材图标+大字余量（可点按查食材）
    const midCy = 86;
    if (done) {
      const doneNote = makeText('body', '街坊已经美美吃上啦！', SCENE_INK.green, { size: 24 });
      doneNote.anchor.set(0, 0.5);
      doneNote.position.set(midX, midCy);
      fitTextWidth(doneNote, maxMidW);
      row.addChild(doneNote);
    } else if (have > 0) {
      const readyNote = makeText('body', `冰箱现成 ${have} 盘 · 可直接端上桌`, SCENE_INK.green, { size: 24 });
      readyNote.anchor.set(0, 0.5);
      readyNote.position.set(midX, midCy);
      fitTextWidth(readyNote, maxMidW);
      row.addChild(readyNote);
    } else {
      const needsRow = this._makeClickableNeeds(needs, maxMidW);
      needsRow.position.set(midX, midCy);
      row.addChild(needsRow);
    }

    // 中下：无框赏金直排（图标 + 大数字）
    const chips = dailyMenuRewardChips(line);
    if (chips.length) {
      const rewardLine = new PIXI.Container();
      rewardLine.position.set(midX, 140);
      const lead = makeText('caption', done ? '已发赏：' : '赏金：', SCENE_INK.muted, {
        size: 22,
        fontWeight: '600',
      });
      lead.anchor.set(0, 0.5);
      rewardLine.addChild(lead);

      const inline = makeInlineRewards(chips, {
        size: 24,
        iconSize: 34,
        color: SCENE_INK.ink,
        goldColor: SCENE_INK.gold,
        gap: 14,
        resolveItemIcon: resolveItemAssetPath,
      });
      inline.position.set(lead.width + 4, 0);
      rewardLine.addChild(inline);

      const totalRw = lead.width + 4 + inline.width;
      const rwMax = done ? (L.contentR - midX - 96) : maxMidW + 16;
      if (totalRw > rwMax && rwMax > 80) {
        rewardLine.scale.set(rwMax / totalRw);
      }

      if (line.food?.defId) {
        const foodId = line.food.defId;
        rewardLine.eventMode = 'static';
        rewardLine.cursor = 'pointer';
        rewardLine.hitArea = new PIXI.Rectangle(-4, -22, Math.ceil(totalRw) + 8, 44);
        rewardLine.on('pointertap', (e) => {
          e.stopPropagation();
          const v = inspectFromItem(foodId);
          if (!v) return;
          if (line.food?.tease) v.note = `${v.note ?? ''} · 街坊鲜货回礼`;
          AudioManager.play('ui_click');
          this._inspect = v;
          this.relayout();
        });
      }
      row.addChild(rewardLine);
    }

    // 右侧：完成盖朱印 / 交菜 / 去做菜
    const btnCx = btnX + btnW / 2;
    if (done) {
      const stamp = makeSealStamp('已上齐', 78, -0.14);
      stamp.position.set(btnCx, 88);
      row.addChild(stamp);
    } else if (have > 0) {
      const submitBtn = makeSlicedButton({
        label: '交菜',
        width: btnW,
        height: btnH,
        skin: 'olive',
        fontSize: 28,
        onReady: this._scheduleRelayout,
      });
      submitBtn.position.set(btnX, 38);
      submitBtn.on('pointertap', () => {
        const from = this._toStage(btnCx, y + 67);
        this._submitDishLine(line.recipeId, from);
      });
      row.addChild(submitBtn);

      const stockTxt = makeText('caption', `存 ${have} 盘`, SCENE_INK.green, { size: 22, fontWeight: '700' });
      stockTxt.anchor.set(0.5);
      stockTxt.position.set(btnCx, 118);
      row.addChild(stockTxt);
    } else if (missing.length === 0) {
      const cookBtn = makeSlicedButton({
        label: '去做菜',
        width: btnW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 27,
        onReady: this._scheduleRelayout,
      });
      cookBtn.position.set(btnX, 38);
      cookBtn.on('pointertap', () => {
        this.onCook?.(line.recipeId);
      });
      row.addChild(cookBtn);

      const readyTxt = makeText('caption', '食材齐备', SCENE_INK.green, { size: 22, fontWeight: '700' });
      readyTxt.anchor.set(0.5);
      readyTxt.position.set(btnCx, 118);
      row.addChild(readyTxt);
    } else {
      const lackBtn = makeSlicedButton({
        label: '交菜',
        width: btnW,
        height: 54,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      lackBtn.position.set(btnX, 38);
      lackBtn.on('pointertap', () => {
        const from = this._toStage(btnCx, y + 65);
        this._submitDishLine(line.recipeId, from);
      });
      row.addChild(lackBtn);

      const goStove = makeText('caption', '去灶台看 ›', SCENE_INK.soft, { size: 22, fontWeight: '700' });
      goStove.anchor.set(0.5);
      goStove.position.set(btnCx, 118);
      goStove.eventMode = 'static';
      goStove.cursor = 'pointer';
      goStove.hitArea = new PIXI.Rectangle(-btnW / 2, -20, btnW, 40);
      goStove.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        this.onCook?.(line.recipeId);
      });
      row.addChild(goStove);
    }

    if (showDivider) {
      drawInkDivider(row, L.contentX, L.rowH - 8, L.contentR - L.contentX, 0.42, 12);
    }
  }

  private _makeClickableNeeds(
    needs: Array<{ iconId: string; have: number; need: number }>,
    maxW: number,
  ): PIXI.Container {
    const wrap = new PIXI.Container();
    let x = 0;
    const iconS = 42;
    for (const item of needs) {
      const ok = item.have >= item.need;
      const g = new PIXI.Container();
      const sp = sceneSprite(resolveItemAssetPath(item.iconId), iconS, iconS);
      if (sp) {
        sp.anchor.set(0.5);
        sp.position.set(iconS / 2, 0);
        g.addChild(sp);
      }
      const cnt = makeText('number', `${item.have}/${item.need}`, ok ? SCENE_INK.green : SCENE_INK.red, {
        size: 24,
      });
      cnt.anchor.set(0, 0.5);
      cnt.position.set(iconS + 4, 1);
      g.addChild(cnt);

      const cellW = iconS + 4 + Math.ceil(cnt.width);
      g.position.set(x, 0);
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.hitArea = new PIXI.Rectangle(-4, -24, cellW + 8, 48);
      g.on('pointertap', (e) => {
        e.stopPropagation();
        const v = inspectFromItem(item.iconId);
        if (!v) return;
        AudioManager.play('ui_click');
        this._inspect = v;
        this.relayout();
      });
      wrap.addChild(g);
      x += cellW + 14;
    }
    const totalW = Math.max(0, x - 14);
    if (totalW > maxW && maxW > 60) {
      wrap.scale.set(maxW / totalW);
    }
    return wrap;
  }

  // ── 纸单底部晚市加桌邀请 ─────────────────────────────────────────────────
  private _drawExtraRoundFooter(scene: PIXI.Container, y: number): void {
    const foot = new PIXI.Container();
    foot.position.set(0, y);
    scene.addChild(foot);

    const cy = L.extraH / 2 + 2;
    const ticketSp = sceneSprite(ART.ticket, 58, 42);
    if (ticketSp) {
      ticketSp.anchor.set(0, 0.5);
      ticketSp.rotation = -0.06;
      ticketSp.position.set(L.contentX, cy);
      foot.addChild(ticketSp);
    }

    const btnW = 198;
    const btnH = 56;
    const btnX = L.contentR - btnW;
    const noteX = L.contentX + 68;
    const note = makeText('heading', '街坊没吃尽兴！加开晚市再赠券', SCENE_INK.ink, { size: 24 });
    note.anchor.set(0, 0.5);
    note.position.set(noteX, cy);
    fitTextWidth(note, btnX - noteX - 12);
    foot.addChild(note);

    const extraBtn = makeAdButton({
      label: '加开晚市',
      width: btnW,
      height: btnH,
      skin: 'gold',
      badge: '送券×1',
      onReady: this._scheduleRelayout,
    });
    extraBtn.position.set(btnX, cy - btnH / 2);
    extraBtn.on('pointertap', () => {
      if (this._adBusy) return;
      this._adBusy = true;
      Platform.showRewardedVideo(
        'daily_extra',
        () => {
          this._adBusy = false;
          if (KitchenManager.unlockExtraDailyMenu()) {
            analytics.trackDailyMenuAction({
              action: 'ad_extra_round',
              isExtraRound: true,
            });
          }
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    foot.addChild(extraBtn);
  }

  private _submitDishLine(recipeId: DailyMenuLine['recipeId'], from: { x: number; y: number }): void {
    const gain = KitchenManager.submitDailyMenu(recipeId);
    this._inspect = null;
    if (this._isOpen) this.relayout();
    if (!gain) return;
    const menu = KitchenManager.save.dailyMenu;
    const prog = menu ? dailyMenuProgress(menu) : { done: 0, need: 3 };
    const tickets = Math.max(0, Math.floor(gain.tickets ?? 0));
    const goldGained = Math.max(0, Math.floor((gain.gold ?? 0) + (gain.foldGold ?? 0)));
    analytics.trackDailyMenuAction({
      action: 'submit_dish',
      recipeId,
      isExtraRound: Boolean(menu?.extraRound),
      doneCount: prog.done,
      needCount: prog.need,
      goldGained,
      ticketsGained: tickets,
      foodGiftId: gain.foodDefId,
    });
    if (tickets > 0) {
      analytics.trackDailyMenuAction({
        action: 'board_clear',
        recipeId,
        isExtraRound: Boolean(menu?.extraRound),
        doneCount: prog.done,
        needCount: prog.need,
        goldGained,
        ticketsGained: tickets,
      });
    }
    this._playSubmitFx(gain, from);
  }

  private _playSubmitFx(
    gain: {
      gold?: number;
      foldGold?: number;
      foodDefId?: string;
      foodFolded?: boolean;
      tickets?: number;
    },
    from: { x: number; y: number },
  ): void {
    const tickets = Math.max(0, Math.floor(gain.tickets ?? 0));
    playRewardCollect({ ...gain, tickets: 0, from }, () => {
      if (tickets <= 0) return;
      playDailyMenuClearBanner(() => {
        playTicketCollect(from, kitchenGachaHudPos(), 0);
      });
    });
  }
}
