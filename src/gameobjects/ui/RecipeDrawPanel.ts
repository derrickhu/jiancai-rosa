import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { ensureRecipeUnlockPanel } from '@/gameobjects/ui/RecipeUnlockPanel';
import { TutorialOverlay } from '@/gameobjects/ui/TutorialOverlay';
import {
  DAILY_AD_LIMITS,
  RECIPE_GACHA_COST,
  RECIPE_GACHA_PITY,
  RECIPE_GACHA_POOL,
  RECIPE_GACHA_RECIPE_RATE,
  canUseDailyAd,
  dailyAdLeft,
  freshGachaRecipes,
  gachaPityLeft,
  getItem,
  itemRarity,
  recipeById,
  recipeUnlockView,
  type GachaDrawMode,
  type RecipeId,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
import {
  FONT,
  HUD_ICON,
  P0_ART,
  UI_KIT,
  fillRect,
  fitTextWidth,
  makeAdButton,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  isTextureFailed,
  isTextureReady,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import {
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeSealStamp,
  makeSceneRoot,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  wall: 'subpkg_images/scene_gacha_wall.png',
  cushion: 'subpkg_images/scene_gacha_cushion.png',
  tab: 'subpkg_images/scene_dex_tab.png',
  note: 'subpkg_images/scene_club_note.png',
  box: 'subpkg_images/hud_gacha_box.png',
  ticket: 'subpkg_images/ui_menu_ticket.png',
  paper: 'subpkg_kitchen/ui_recipe_paper.png',
  flare: 'subpkg_kitchen/ui_pickup_flare.png',
} as const;

const LACK_HINT = '做今日菜单或盖图鉴章可得菜谱券';
const W = 720;
const H = 1086;
const SHAKE_SEC = 0.4;
const SPIN_SEC = 0.9;
const LAND_SEC = 0.16;

type DrawResult = {
  recipeId?: RecipeId;
  foodDefId?: string;
  foodQty?: number;
  foodFolded?: boolean;
  foldGold?: number;
  duplicate: boolean;
  gold: number;
  toast: string;
  specialKind?: 'mastery_note' | 'outing_charm';
  masteryRecipeId?: RecipeId;
  bonusTickets?: number;
};

type TierTab = 'regular' | 'master';

export class RecipeDrawPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _box: PIXI.Container | null = null;
  private _paper: PIXI.Container | null = null;
  private _playing = false;
  private _adBusy = false;
  private _pendingList: DrawResult[] = [];
  private _multiTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastTap = 0;
  private _paintQueued = false;
  private _tierTab: TierTab = 'regular';
  private _showPoolModal = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 27;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._adBusy = false;
    this._showPoolModal = false;
    const isMaster = freshGachaRecipes(recipeUnlockView(KitchenManager.save)).length <= 0;
    this._tierTab = isMaster ? 'master' : 'regular';
    warmupAdScene('gacha_free');
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._multiTimer) {
      clearTimeout(this._multiTimer);
      this._multiTimer = null;
    }
    const pending = [...this._pendingList];
    this._pendingList = [];
    this._clearFx();
    this._playing = false;
    this._adBusy = false;
    this._paintQueued = false;
    this._showPoolModal = false;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._root.removeChildren();
    this._box = null;
    if (pending.length) this._deliverBatch(pending);
    TutorialOverlay.refresh();
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._playing || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen && !this._playing) this.relayout();
    });
  };

  relayout(): void {
    if (this._playing) return;
    this._clearFx();
    this._root.removeChildren();
    this._box = null;
    if (!this._isOpen) return;

    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        P0_ART.adClapper,
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        HUD_ICON.coin,
      ],
      this._scheduleRelayout,
    );

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const save = KitchenManager.save;
    const tickets = save.recipeTickets;
    const remainRecipes = freshGachaRecipes(recipeUnlockView(save)).length;
    const isMasterChest = remainRecipes <= 0;
    if (isMasterChest) this._tierTab = 'master';
    const pityLeft = gachaPityLeft(save);

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: H,
      topBleed: 44,
      dimAlpha: 0.72,
      onDimTap: () => {
        if (this._showPoolModal) {
          AudioManager.play('ui_close');
          this._showPoolModal = false;
          this.relayout();
          return;
        }
        if (!this._playing && !this._adBusy) this.close();
      },
    });

    // 博古木架场景墙（保留顶部双红灯笼与底部供桌，拉伸中间木墙与霞光）
    drawSceneWall(scene, ART.wall, W, H, 350, 440, 0x5A361C);
    drawPlaqueTitle(scene, isMasterChest ? '名厨秘匣台' : '寻味抽签台', W / 2, -42, 348);
    drawSceneClose(
      scene,
      W - 54,
      -18,
      () => {
        if (this._showPoolModal) {
          AudioManager.play('ui_close');
          this._showPoolModal = false;
          this.relayout();
          return;
        }
        if (!this._playing && !this._adBusy) this.close();
      },
      this._scheduleRelayout,
    );

    // 1. 档位切换签（位于两盏红灯笼之间 x:188..532）
    this._drawTierSwitch(scene, isMasterChest);

    // 2. 菜谱券存量 + 保底/概率大字说明
    this._drawPoolBanner(scene, tickets, remainRecipes, isMasterChest, pityLeft);

    // 3. 供桌锦缎托垫 + 秘匣实物
    const tableCy = 668;
    const cushion = sceneSprite(ART.cushion, 376, 208);
    if (cushion) {
      cushion.anchor.set(0.5);
      cushion.position.set(W / 2, tableCy);
      scene.addChild(cushion);
    }

    const flare = makeRarityFlare(
      !isMasterChest && pityLeft <= 1 ? 'legendary' : 'epic',
      380,
    );
    flare.alpha = !isMasterChest && pityLeft <= 1 ? 0.76 : 0.52;
    flare.position.set(W / 2, tableCy - 118);
    scene.addChild(flare);

    // 概率·池览朱印挂牌（挂在锦垫右上侧）
    const oddsSeal = makeSealStamp('池览', 58, 0.1);
    oddsSeal.position.set(W / 2 + 196, tableCy - 188);
    oddsSeal.eventMode = 'static';
    oddsSeal.cursor = 'pointer';
    oddsSeal.hitArea = new PIXI.Circle(0, 0, 36);
    oddsSeal.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._showPoolModal = true;
      this.relayout();
    });
    scene.addChild(oddsSeal);

    // 供桌前帘金字提示
    const clothNote = makeText(
      'heading',
      this._tierTab === 'master'
        ? '秘匣常驻 · 必出心得 / 陈酿 / 鸿运签'
        : (pityLeft <= 1 ? '吉时已到 · 本匣必出未收录新菜谱！' : `每 ${RECIPE_GACHA_COST} 张菜谱券开一匣 · 轻点秘匣看详情`),
      0xFFEAC2,
      { size: 23, stroke: 0x3D160E, strokeWidth: 4 },
    );
    clothNote.anchor.set(0.5);
    clothNote.position.set(W / 2, tableCy + 108);
    fitTextWidth(clothNote, 520);
    scene.addChild(clothNote);

    // 抽签木匣挂在舞台坐标层（方便摇晃与飞卷轴动画），但在池览弹窗下保持层级合理
    const boxCenter = toStage(W / 2, tableCy - 112);
    const boxSize = Math.round(288 * scale);
    const box = new PIXI.Container();
    const boxTex = gameTexture(ART.box);
    if (isTextureReady(boxTex)) {
      const spr = new PIXI.Sprite(boxTex);
      fitSpriteInBox(spr, boxSize, boxSize);
      spr.anchor.set(0.5);
      spr.eventMode = 'none';
      box.addChild(spr);
    }
    if (this._tierTab === 'master' && !isMasterChest) {
      box.alpha = 0.85;
    }
    box.position.set(boxCenter.x, boxCenter.y);
    box.eventMode = 'static';
    box.cursor = 'pointer';
    box.hitArea = new PIXI.Rectangle(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
    box.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._playing || this._adBusy) return;
      AudioManager.play('ui_click');
      this._showPoolModal = true;
      this.relayout();
    });
    this._root.addChild(box);
    this._box = box;

    // 4. 底部大气抽签动作区（单抽 / 连抽 / 看广告免费抽）
    this._drawActionZone(scene, tickets, isMasterChest);

    if (this._showPoolModal) {
      this._drawPoolModal(remainRecipes, isMasterChest, pityLeft);
    }
  }

  private _drawTierSwitch(scene: PIXI.Container, isMasterChest: boolean): void {
    const tabY = 136;
    const tabW = 160;
    const tabH = 52;
    const gap = 16;
    const startX = Math.round((W - (tabW * 2 + gap)) / 2);

    const tiers: Array<{ id: TierTab; label: string }> = [
      { id: 'regular', label: '寻味秘匣' },
      { id: 'master', label: '名厨秘匣' },
    ];

    tiers.forEach((t, i) => {
      const active = this._tierTab === t.id;
      const lockedRegularDone = t.id === 'regular' && isMasterChest;
      const wrap = new PIXI.Container();
      wrap.position.set(startX + i * (tabW + gap), active ? tabY - 2 : tabY + 2);

      const tex = gameTexture(ART.tab);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.width = tabW;
        sp.height = tabH;
        sp.tint = active ? 0xFFFBF0 : 0xD8BE98;
        wrap.addChild(sp);
      } else {
        const g = new PIXI.Graphics();
        g.lineStyle(2.5, SCENE_INK.ink, 1);
        g.beginFill(active ? 0xFFFBF0 : 0xD8BE98, 1);
        g.drawRoundedRect(0, 0, tabW, tabH, 14);
        g.endFill();
        wrap.addChild(g);
      }

      if (active) {
        const bar = new PIXI.Graphics();
        bar.beginFill(SCENE_INK.red, 0.92);
        bar.drawRoundedRect(tabW * 0.22, tabH - 7, tabW * 0.56, 4, 2);
        bar.endFill();
        wrap.addChild(bar);
      }

      const txt = makeText(
        'heading',
        lockedRegularDone ? '寻味已满' : t.label,
        active ? SCENE_INK.red : SCENE_INK.soft,
        { size: 25 },
      );
      txt.anchor.set(0.5);
      txt.position.set(tabW / 2, tabH * 0.48);
      fitTextWidth(txt, tabW - 18);
      wrap.addChild(txt);

      wrap.eventMode = 'static';
      wrap.cursor = 'pointer';
      wrap.hitArea = new PIXI.Rectangle(0, 0, tabW, tabH);
      wrap.on('pointertap', () => {
        if (lockedRegularDone) {
          Platform.showToast('全部秘传菜谱已集齐，现已升级为名厨秘匣！');
          return;
        }
        if (this._tierTab === t.id) return;
        AudioManager.play('ui_click');
        this._tierTab = t.id;
        this.relayout();
      });
      scene.addChild(wrap);
    });
  }

  private _drawPoolBanner(
    scene: PIXI.Container,
    tickets: number,
    remainRecipes: number,
    isMasterChest: boolean,
    pityLeft: number,
  ): void {
    // 菜谱券图标 + 大数字（无廉价白底圆角框）
    const ticketRow = new PIXI.Container();
    const tSp = sceneSprite(ART.ticket, 54, 42);
    let tx = 0;
    if (tSp) {
      tSp.anchor.set(0, 0.5);
      ticketRow.addChild(tSp);
      tx = 62;
    }
    const tLbl = makeText('title', `菜谱券  ${tickets} 张`, SCENE_INK.cream, {
      size: 30,
      stroke: 0x3A1E0E,
      strokeWidth: 5,
    });
    tLbl.anchor.set(0, 0.5);
    tLbl.position.set(tx, 0);
    ticketRow.addChild(tLbl);
    ticketRow.position.set(Math.round((W - (tx + tLbl.width)) / 2), 226);
    scene.addChild(ticketRow);

    if (this._tierTab === 'master') {
      const rateLine = makeText(
        'heading',
        '火候心得 35% · 臻品陈酿 45% · 鸿运签 20%',
        0xFFE8B0,
        { size: 24, stroke: 0x3A1E0E, strokeWidth: 4 },
      );
      rateLine.anchor.set(0.5);
      rateLine.position.set(W / 2, 278);
      fitTextWidth(rateLine, 540);
      scene.addChild(rateLine);

      const subLine = makeText(
        'caption',
        isMasterChest ? '秘传菜谱已圆满 · 每次开启必得名厨珍宝' : `集齐剩余 ${remainRecipes} 道秘谱后自动解锁此匣`,
        SCENE_INK.cream,
        { size: 22, fontWeight: '700', stroke: 0x3A1E0E, strokeWidth: 4 },
      );
      subLine.anchor.set(0.5);
      subLine.position.set(W / 2, 316);
      fitTextWidth(subLine, 540);
      scene.addChild(subLine);
      return;
    }

    const ratePct = Math.round(RECIPE_GACHA_RECIPE_RATE * 100);
    const pityStr = pityLeft <= 1
      ? '本匣保底必出新谱！'
      : `再开 ${pityLeft} 匣内必出新谱`;
    const mainLine = makeText(
      'heading',
      `新谱概率 ${ratePct}% · ${pityStr}`,
      pityLeft <= 1 ? 0xFFE47A : 0xFFF2D4,
      { size: 25, stroke: 0x3A1E0E, strokeWidth: 4 },
    );
    mainLine.anchor.set(0.5);
    mainLine.position.set(W / 2, 278);
    fitTextWidth(mainLine, 540);
    scene.addChild(mainLine);

    const subLine = makeText(
      'caption',
      `待寻秘传菜谱 ${remainRecipes}/${RECIPE_GACHA_POOL.length} 道 · 未出谱得 3~5 份珍稀鲜货`,
      SCENE_INK.cream,
      { size: 22, fontWeight: '700', stroke: 0x3A1E0E, strokeWidth: 4 },
    );
    subLine.anchor.set(0.5);
    subLine.position.set(W / 2, 316);
    fitTextWidth(subLine, 580);
    scene.addChild(subLine);
  }

  private _drawActionZone(
    scene: PIXI.Container,
    tickets: number,
    isMasterChest: boolean,
  ): void {
    const save = KitchenManager.save;

    // 若玩家正在预览尚未解锁的「名厨秘匣」，提供醒目的切回抽签按钮
    if (this._tierTab === 'master' && !isMasterChest) {
      const backBtn = makeSlicedButton({
        label: '切回「寻味秘匣」抽签',
        width: 396,
        height: 64,
        skin: 'terracotta',
        fontSize: 28,
        onReady: this._scheduleRelayout,
      });
      backBtn.position.set(Math.round((W - 396) / 2), 872);
      backBtn.on('pointertap', () => {
        this._tierTab = 'regular';
        this.relayout();
      });
      scene.addChild(backBtn);

      const note = makeText(
        'caption',
        '抽齐全部秘传菜谱后，秘匣将自动晋升为名厨秘匣',
        0xEAD4B4,
        { size: 22, fontWeight: '600', stroke: 0x2A160A, strokeWidth: 3 },
      );
      note.anchor.set(0.5);
      note.position.set(W / 2, 964);
      scene.addChild(note);
      return;
    }

    const row1Y = 834;
    const btnH = 64;
    const padX = 44;
    const gap = 20;
    const colW = Math.floor((W - padX * 2 - gap) / 2);

    const canSingle = tickets >= RECIPE_GACHA_COST;
    const topupLeft = dailyAdLeft(save, 'gacha_topup');
    const canTopup = !canSingle && tickets === 1 && canUseDailyAd(save, 'gacha_topup');
    const freeAvail = canUseDailyAd(save, 'gacha_free');

    // 左钮：单抽 / 差1券看视频补齐开
    let singleBtn: PIXI.Container;
    if (canSingle) {
      singleBtn = this._makeTicketDrawBtn(`单抽一匣 (${RECIPE_GACHA_COST}券)`, colW, btnH, true, 'terracotta');
      singleBtn.on('pointertap', (e) => {
        e.stopPropagation();
        this._runDraw('ticket');
      });
    } else if (canTopup) {
      singleBtn = makeAdButton({
        label: '差1券·补齐开',
        width: colW,
        height: btnH,
        skin: 'terracotta',
        onReady: this._scheduleRelayout,
      });
      singleBtn.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._playing || this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'gacha_topup',
          () => {
            this._adBusy = false;
            this._runDraw('ad_topup');
          },
          () => {
            this._adBusy = false;
          },
        );
      });
    } else {
      singleBtn = this._makeTicketDrawBtn(`单抽一匣 (${tickets}/${RECIPE_GACHA_COST})`, colW, btnH, false, 'cream');
      singleBtn.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_deny');
        Platform.showToast(LACK_HINT);
      });
    }
    singleBtn.position.set(padX, row1Y);
    scene.addChild(singleBtn);

    // 右钮：连抽（优先匹配 4 连保底或 3 连，若满 4 券也可连开 2 匣）
    const multiCount = tickets >= RECIPE_GACHA_COST * 4
      ? 4
      : tickets >= RECIPE_GACHA_COST * 3
        ? 3
        : tickets >= RECIPE_GACHA_COST * 2
          ? 2
          : 3;
    const multiCost = multiCount * RECIPE_GACHA_COST;
    const canMulti = tickets >= multiCost;
    const multiBtn = this._makeTicketDrawBtn(
      `连开${multiCount}匣 (${multiCost}券)`,
      colW,
      btnH,
      canMulti,
      canMulti ? 'gold' : 'cream',
    );
    multiBtn.position.set(padX + colW + gap, row1Y);
    multiBtn.on('pointertap', (e) => {
      e.stopPropagation();
      if (!canMulti) {
        AudioManager.play('ui_deny');
        Platform.showToast(`连开 ${multiCount} 匣需 ${multiCost} 张菜谱券，${LACK_HINT}`);
        return;
      }
      this._runMultiDraw(multiCount);
    });
    scene.addChild(multiBtn);

    // 第二行：每日看视频免费抽签大按钮
    const row2Y = 914;
    const freeW = 436;
    const freeH = 60;
    const freeBtn = freeAvail
      ? makeAdButton({
        label: '免费开一匣 · 每日福利',
        width: freeW,
        height: freeH,
        skin: 'olive',
        onReady: this._scheduleRelayout,
      })
      : makeSlicedButton({
        label: '今日免费一匣已领',
        width: freeW,
        height: freeH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 25,
        silent: true,
        onReady: this._scheduleRelayout,
      });
    if (!freeAvail) {
      freeBtn.alpha = 0.78;
      freeBtn.cursor = 'default';
    }
    freeBtn.position.set(Math.round((W - freeW) / 2), row2Y);
    freeBtn.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._playing || this._adBusy) return;
      if (!freeAvail) {
        Platform.showToast('今天的免费秘匣已开启过啦，明天再来');
        return;
      }
      this._adBusy = true;
      Platform.showRewardedVideo(
        'gacha_free',
        () => {
          this._adBusy = false;
          this._runDraw('ad_free');
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    scene.addChild(freeBtn);

    const tipStr = canTopup
      ? `手里已有 1 张券，看视频可免第 2 张券开匣（今日剩 ${topupLeft}/${DAILY_AD_LIMITS.gacha_topup} 次）`
      : LACK_HINT;
    const footTip = makeText('caption', tipStr, 0xEAD4B4, {
      size: 22,
      fontWeight: '600',
      stroke: 0x2A160A,
      strokeWidth: 3,
    });
    footTip.anchor.set(0.5);
    footTip.position.set(W / 2, row2Y + freeH + 28);
    fitTextWidth(footTip, W - 72);
    scene.addChild(footTip);
  }

  private _makeTicketDrawBtn(
    label: string,
    width: number,
    height: number,
    ready: boolean,
    skin: 'terracotta' | 'gold' | 'cream',
  ): PIXI.Container {
    const btn = makeSlicedButton({
      label,
      width,
      height,
      skin: ready ? skin : 'cream',
      textColor: !ready ? 0x8A7358 : undefined,
      fontSize: 25,
      labelOffsetX: 18,
      onReady: this._scheduleRelayout,
      silent: !ready,
    });
    const tSp = sceneSprite(ART.ticket, 38, 32);
    if (tSp) {
      tSp.anchor.set(0.5);
      tSp.position.set(30, height / 2 - 1);
      if (!ready) tSp.alpha = 0.5;
      btn.addChild(tSp);
    }
    if (!ready) btn.alpha = 0.8;
    return btn;
  }

  private _drawPoolModal(
    remainRecipes: number,
    isMasterChest: boolean,
    pityLeft: number,
  ): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    const modalRoot = new PIXI.Container();

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_close');
      this._showPoolModal = false;
      this.relayout();
    });
    modalRoot.addChild(dim);

    const noteW = Math.min(624, sw - 40);
    const noteH = 712;
    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, noteW, noteH);
    card.on('pointertap', (e) => e.stopPropagation());

    drawStretchSheet(card, ART.note, 0, 0, noteW, noteH, 128, 125, 0xF7EAD0);

    const head = makeText('display', '寻味秘匣 · 概率与保底', SCENE_INK.ink, { size: 34 });
    head.anchor.set(0.5);
    head.position.set(noteW / 2, 134);
    fitTextWidth(head, noteW - 96);
    card.addChild(head);

    drawInkDivider(card, 48, 172, noteW - 96, 0.5, 10);

    const lines: Array<{ title: string; body: string; color: number }> = [
      {
        title: `一、寻味秘匣（剩余 ${remainRecipes} 道未收录秘谱）`,
        body: `• 私房新菜谱：基础概率 ${Math.round(RECIPE_GACHA_RECIPE_RATE * 100)}%，最多连续 ${RECIPE_GACHA_PITY} 匣必出新菜谱（当前再开 ${isMasterChest ? 0 : pityLeft} 匣必出）！\n• 珍稀鲜货包：概率 ${100 - Math.round(RECIPE_GACHA_RECIPE_RATE * 100)}%，随机获得 3～5 份良品/上品/传世鲜货食材。`,
        color: SCENE_INK.red,
      },
      {
        title: '二、名厨秘匣（秘传菜谱集齐后自动晋升）',
        body: '• 主厨火候心得（35%）：菜谱熟练度直接 +3 锅，满金勺另赠菜谱券！\n• 臻品老坛陈酿（45%）：得 2～4 份上品/传世食材或老坛发酵成品。\n• 出行鸿运吉签（20%）：下趟逛菜场免单或天色 +2，并附赠盘缠赏金。',
        color: SCENE_INK.gold,
      },
    ];

    let cy = 198;
    for (const sec of lines) {
      const t = makeText('heading', sec.title, sec.color, { size: 26 });
      t.position.set(48, cy);
      fitTextWidth(t, noteW - 96);
      card.addChild(t);
      cy += 42;

      const b = new PIXI.Text(sec.body, {
        fontFamily: FONT,
        fontSize: 23,
        fill: SCENE_INK.ink,
        fontWeight: '600',
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: noteW - 96,
        lineHeight: 34,
      });
      b.eventMode = 'none';
      b.position.set(48, cy);
      card.addChild(b);
      cy += Math.ceil(b.height) + 24;
    }

    const okBtn = makeSlicedButton({
      label: '知晓了',
      width: 224,
      height: 56,
      skin: 'olive',
      fontSize: 26,
      onReady: this._scheduleRelayout,
    });
    okBtn.position.set(Math.round((noteW - 224) / 2), noteH - 90);
    okBtn.on('pointertap', () => {
      this._showPoolModal = false;
      this.relayout();
    });
    card.addChild(okBtn);

    drawSceneClose(
      card,
      noteW - 44,
      14,
      () => {
        AudioManager.play('ui_close');
        this._showPoolModal = false;
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

  private _runDraw(mode: GachaDrawMode): void {
    const now = Date.now();
    if (now - this._lastTap < 280) return;
    this._lastTap = now;
    if (this._playing) return;
    const result = KitchenManager.drawRecipe({ reveal: false, mode });
    if (!result.ok) return;
    this._playing = true;
    this._pendingList = [result];
    this._playBatchReveal([result]);
  }

  private _runMultiDraw(count: number): void {
    const now = Date.now();
    if (now - this._lastTap < 280) return;
    this._lastTap = now;
    if (this._playing) return;

    const first = KitchenManager.drawRecipe({ reveal: false, mode: 'ticket' });
    if (!first.ok) return;
    this._playing = true;
    this._pendingList = [first];

    let left = count - 1;
    let shakeDone = false;
    let rollsDone = left <= 0;

    const tryProceed = (): void => {
      if (!this._playing || !shakeDone || !rollsDone) return;
      this._animateShowcase(this._pendingList);
    };

    const stepRoll = (): void => {
      if (!this._playing || left <= 0) {
        rollsDone = true;
        tryProceed();
        return;
      }
      this._multiTimer = setTimeout(() => {
        this._multiTimer = null;
        if (!this._playing) return;
        const r = KitchenManager.drawRecipe({ reveal: false, mode: 'ticket' });
        if (r.ok) this._pendingList.push(r);
        left -= 1;
        if (left <= 0 || !r.ok) {
          rollsDone = true;
          tryProceed();
        } else {
          stepRoll();
        }
      }, 32);
    };

    stepRoll();
    this._shakeBox(() => {
      shakeDone = true;
      tryProceed();
    });
  }

  private _playBatchReveal(batch: DrawResult[]): void {
    const hero = batch.find((r) => r.recipeId && !r.duplicate) ?? batch[0];
    if (hero?.foodDefId) itemTexture(hero.foodDefId);
    else gameTexture(ART.paper);
    this._shakeBox(() => {
      if (!this._playing) return;
      this._animateShowcase(batch);
    });
  }

  private _animateShowcase(batch: DrawResult[]): void {
    const recipeHero = batch.find((r) => r.recipeId && !r.duplicate);
    const paperHero = recipeHero ?? batch.find((r) => !r.foodDefId);
    if (paperHero) {
      this._waitPath(ART.paper, () => {
        if (!this._playing) return;
        this._spinPaper(!recipeHero && paperHero.duplicate && !paperHero.specialKind, () => {
          if (!this._playing) return;
          this._finishDraw();
        });
      });
      return;
    }
    const foodHero = batch[0];
    if (foodHero?.foodDefId) {
      const totalSameQty = batch
        .filter((b) => b.foodDefId === foodHero.foodDefId)
        .reduce((s, b) => s + (b.foodQty ?? 1), 0);
      this._waitPath(resolveItemAssetPath(foodHero.foodDefId), () => {
        if (!this._playing) return;
        this._spinItem(foodHero.foodDefId!, totalSameQty, () => {
          if (!this._playing) return;
          this._finishDraw();
        });
      });
      return;
    }
    this._finishDraw();
  }

  private _shakeBox(done: () => void): void {
    const box = this._box;
    if (!box) {
      done();
      return;
    }
    TweenManager.cancelTarget(box);
    TweenManager.cancelTarget(box.scale);
    const st = { t: 0 };
    box.rotation = 0;
    box.scale.set(1);
    AudioManager.play('upgrade');
    TweenManager.to({
      target: st,
      props: { t: 1 },
      duration: SHAKE_SEC,
      onUpdate: () => {
        if (box.destroyed) return;
        const t = st.t;
        const damp = 1 - t;
        box.rotation = Math.sin(t * Math.PI * 10) * 0.16 * damp;
        box.scale.set(1 + Math.sin(t * Math.PI * 8) * 0.05 * damp);
      },
      onComplete: () => {
        if (!box.destroyed) {
          box.rotation = 0;
          box.scale.set(1);
        }
        done();
      },
    });
  }

  private _waitPath(path: string, done: () => void): void {
    const tex = gameTexture(path);
    if (isTextureReady(tex) || isTextureFailed(path)) {
      done();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      done();
    };
    whenTextureReady(path, finish);
    globalThis.setTimeout(finish, 800);
  }

  private _spinPaper(duplicate: boolean, done: () => void): void {
    const box = this._box;
    const tex = gameTexture(ART.paper);
    if (!box || !isTextureReady(tex)) {
      done();
      return;
    }
    if (this._paper && !this._paper.destroyed) this._paper.destroy({ children: true });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const maxW = Math.min(w - 48, 520);
    const maxH = Math.min(h - Game.safeTop - 160, 720);
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, maxW, maxH);
    spr.anchor.set(0.5);
    spr.eventMode = 'none';
    const destY = Game.safeTop + Math.max(24, (h - Game.safeTop - spr.height - 88) / 2) + spr.height / 2;

    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    wrap.position.set(box.x, box.y + 36);
    wrap.scale.set(0.08);
    wrap.rotation = Math.PI * 1.65;
    wrap.alpha = 0;
    wrap.addChild(spr);
    this._root.addChild(wrap);
    this._paper = wrap;
    AudioManager.play(duplicate ? 'event_pop' : 'recipe_paper');
    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.08 });
    TweenManager.to({
      target: wrap,
      props: { x: w / 2, y: destY, rotation: 0 },
      duration: SPIN_SEC,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: SPIN_SEC,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({
          target: { t: 0 },
          props: { t: 1 },
          duration: LAND_SEC,
          onComplete: done,
        });
      },
    });
  }

  private _spinItem(defId: string, qty: number, done: () => void): void {
    const box = this._box;
    const tex = itemTexture(defId);
    if (!box || !isTextureReady(tex)) {
      done();
      return;
    }
    if (this._paper && !this._paper.destroyed) this._paper.destroy({ children: true });
    const face = 240;
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    wrap.position.set(box.x, box.y + 36);
    wrap.scale.set(0.08);
    wrap.alpha = 0;

    const spin = new PIXI.Container();
    spin.eventMode = 'none';
    spin.rotation = Math.PI * 1.65;
    const glow = makeRarityFlare(itemRarity(defId), 420);
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, face, face);
    spr.anchor.set(0.5);
    spr.eventMode = 'none';
    spin.addChild(glow, spr);
    wrap.addChild(spin);

    if (qty > 1) {
      const tag = makeText('display', `×${qty}`, SCENE_INK.cream, {
        size: 42,
        stroke: SCENE_INK.ink,
        strokeWidth: 6,
      });
      tag.anchor.set(1, 1);
      tag.position.set(face / 2 - 2, face / 2 + 4);
      wrap.addChild(tag);
    }

    this._root.addChild(wrap);
    this._paper = wrap;
    AudioManager.play('event_pop');
    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.08 });
    TweenManager.to({
      target: wrap,
      props: { y: box.y - 60 },
      duration: SPIN_SEC,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: spin,
      props: { rotation: 0 },
      duration: SPIN_SEC,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: SPIN_SEC,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({
          target: { t: 0 },
          props: { t: 1 },
          duration: LAND_SEC,
          onComplete: done,
        });
      },
    });
  }

  private _finishDraw(): void {
    const batch = [...this._pendingList];
    this._playing = false;
    this._pendingList = [];
    if (batch.length) this._deliverBatch(batch);
    this._clearFx();
    if (this._isOpen) this.relayout();
  }

  private _deliverBatch(batch: DrawResult[]): void {
    const from = this._box
      ? { x: this._box.x, y: this._box.y - 60 }
      : { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.42) };

    if (batch.length === 1) {
      this._deliverSingle(batch[0], from);
      return;
    }

    const newRecipes: RecipeId[] = [];
    let totalGold = 0;
    let totalFoldGold = 0;
    let totalBonusTickets = 0;
    let firstFoodId: string | undefined;
    let anyFoodUnfolded = false;
    const summaryParts: string[] = [];

    for (const r of batch) {
      totalGold += r.gold;
      totalFoldGold += r.foldGold ?? 0;
      totalBonusTickets += r.bonusTickets ?? 0;
      if (r.recipeId && !r.duplicate) {
        newRecipes.push(r.recipeId);
        const rName = recipeById(r.recipeId)?.name ?? '新菜谱';
        summaryParts.push(`《${rName}》`);
      } else if (r.foodDefId) {
        if (!firstFoodId) firstFoodId = r.foodDefId;
        if (!r.foodFolded) anyFoodUnfolded = true;
        summaryParts.push(`${getItem(r.foodDefId).name}×${r.foodQty ?? 1}`);
      } else if (r.specialKind && r.toast) {
        summaryParts.push(r.toast.split('：')[0] ?? '秘匣奇珍');
      } else if (r.duplicate && r.gold > 0) {
        summaryParts.push(`折金+${r.gold}`);
      }
    }

    if (totalGold > 0 || totalFoldGold > 0 || firstFoodId) {
      playRewardCollect({
        gold: totalGold,
        foldGold: totalFoldGold,
        foodDefId: firstFoodId,
        foodFolded: !anyFoodUnfolded && totalFoldGold > 0,
        from,
      });
    }
    if (totalBonusTickets > 0) {
      playTicketCollect(from, kitchenGachaHudPos(), 0);
    }

    if (summaryParts.length) {
      Platform.showToast(`连开收获：${summaryParts.join('、')}`, 'success');
    }

    if (newRecipes.length > 0) {
      KitchenManager.enqueueRecipeUnlocks(newRecipes, 0, false);
      ensureRecipeUnlockPanel().present({ silent: true });
    }
  }

  private _deliverSingle(result: DrawResult, from: { x: number; y: number }): void {
    if (result.specialKind) {
      if (result.toast) Platform.showToast(result.toast, 'success');
      if (result.gold > 0) playRewardCollect({ gold: result.gold, from });
      if ((result.bonusTickets ?? 0) > 0) playTicketCollect(from, kitchenGachaHudPos(), 0);
      return;
    }
    if (result.foodDefId) {
      if (result.toast) Platform.showToast(result.toast, 'success');
      playRewardCollect({
        gold: result.gold,
        foldGold: result.foldGold,
        foodDefId: result.foodDefId,
        foodFolded: result.foodFolded,
        from,
      });
      return;
    }
    if (result.duplicate) {
      AudioManager.play('coin_gain');
      if (result.toast) Platform.showToast(result.toast, 'success');
      playRewardCollect({ gold: result.gold, from });
      return;
    }
    if (result.recipeId) {
      KitchenManager.enqueueRecipeUnlocks([result.recipeId], 0, false);
      ensureRecipeUnlockPanel().present({ silent: true });
    }
  }

  private _clearFx(): void {
    if (this._box && !this._box.destroyed) {
      TweenManager.cancelTarget(this._box);
      TweenManager.cancelTarget(this._box.scale);
      this._box.rotation = 0;
      this._box.scale.set(1);
    }
    if (this._paper) {
      TweenManager.cancelTarget(this._paper);
      TweenManager.cancelTarget(this._paper.scale);
      for (const child of this._paper.children) TweenManager.cancelTarget(child);
      if (!this._paper.destroyed) this._paper.destroy({ children: true });
      this._paper = null;
    }
  }
}
