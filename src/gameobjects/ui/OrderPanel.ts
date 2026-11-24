import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  canUseDailyAd,
  dailyAdLeft,
  formatOrderRemain,
  fridgeDishQty,
  neighborNpc,
  neighborOrderReward,
  neighborRewardChips,
  recipeById,
  recipeNeeds,
  recipeUnlockView,
  type NeighborNpc,
  type NeighborOrder,
  type RecipeId,
} from '@/sim';
import { playRewardCollect } from '@/utils/coinCollect';
import { orderPanelPaths } from '@/utils/panelAssets';
import {
  P0_ART,
  UI_KIT,
  fitTextWidth,
  makeAdButton,
  makeRarityFlare,
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

/** 街坊邻里留言点单墙：麻绳木墙 + 撕边信笺点菜单 + 绿格胶带拍立得头像。 */
const ART = {
  wall: 'subpkg_images/scene_order_wall.png',
  slip: 'subpkg_images/scene_order_slip.png',
  photo: 'subpkg_images/scene_order_photo.png',
  flare: 'subpkg_kitchen/ui_pickup_flare.png',
} as const;

const W = 720;
const L = {
  wallSliceTop: 180,
  wallSliceBottom: 130,
  slipX: 54,
  slipW: 612,
  slipH: 384,
  slipGap: 24,
  firstSlipY: 142,
  bottomLedgePad: 96,
} as const;

interface LiveOrderTimer {
  expiresAt: number;
  textNode: PIXI.Text;
}

export class OrderPanel extends PIXI.Container {
  _isOpen = false;
  onCook: ((recipeId: RecipeId) => void) | null = null;
  private _root = new PIXI.Container();
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _liveTimers: LiveOrderTimer[] = [];
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
    KitchenManager.sweepNeighborOrders();
    if (!KitchenManager.liveNeighborOrders().length) return;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    this._adBusy = false;
    warmupAdScene('order_double');
    warmupAdScene('order_refresh');
    this._armTimer();
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
    this._liveTimers = [];
    this._clearTimer();
    this._root.removeChildren();
  }

  private _warm(): void {
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        UI_KIT.btnOlive,
        UI_KIT.btnGold,
        ...orderPanelPaths(KitchenManager.save, KitchenManager.liveNeighborOrders()),
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
    this._liveTimers = [];
    if (!this._isOpen) return;
    this._warm();
    const now = Date.now();
    const orders = KitchenManager.liveNeighborOrders(now);
    if (!orders.length) {
      this.close(true);
      return;
    }

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const n = orders.length;
    const panelH = L.firstSlipY + n * L.slipH + (n - 1) * L.slipGap + L.bottomLedgePad;

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

    drawSceneWall(scene, ART.wall, W, panelH, L.wallSliceTop, L.wallSliceBottom, 0x7A4924);
    drawPlaqueTitle(scene, '街坊点菜', W / 2, -44, 344);

    orders.forEach((order, idx) => {
      const sy = L.firstSlipY + idx * (L.slipH + L.slipGap);
      this._drawOrderSlip(scene, order, L.slipX, sy, L.slipW, L.slipH, now);
    });

    // 右下角铜铃轻点彩蛋
    const bellHit = new PIXI.Container();
    bellHit.position.set(592, panelH - 108);
    bellHit.eventMode = 'static';
    bellHit.cursor = 'pointer';
    bellHit.hitArea = new PIXI.Rectangle(0, 0, 92, 88);
    bellHit.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('event_pop');
      Platform.showToast('叮铃~ 街坊们闻着灶台香来留单啦');
    });
    scene.addChild(bellHit);

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

  // ── 一张钉在木墙上的街坊点菜单纸 ─────────────────────────────────────────
  private _drawOrderSlip(
    scene: PIXI.Container,
    order: NeighborOrder,
    x: number,
    y: number,
    width: number,
    height: number,
    now: number,
  ): void {
    const slip = new PIXI.Container();
    slip.position.set(x, y);
    scene.addChild(slip);

    // 纸片投影 + 拉伸信笺纸底 + 顶部黄铜图钉
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x1E0F06, 0.26);
    shadow.drawRoundedRect(6, 10, width - 4, height - 4, 8);
    shadow.endFill();
    slip.addChild(shadow);

    drawStretchSheet(slip, ART.slip, 0, 0, width, height, 48, 36, 0xF7E8CB);

    const tack = new PIXI.Graphics();
    tack.beginFill(0x2A180B, 0.35);
    tack.drawCircle(width / 2 + 2, 16, 11);
    tack.endFill();
    tack.lineStyle(2, 0x3A2210, 1);
    tack.beginFill(0xD8A24A, 1);
    tack.drawCircle(width / 2, 13, 10);
    tack.endFill();
    tack.lineStyle(0);
    tack.beginFill(0xFFE7A8, 0.8);
    tack.drawCircle(width / 2 - 3, 10, 3.5);
    tack.endFill();
    slip.addChild(tack);

    const save = KitchenManager.save;
    const npc = neighborNpc(order.npcId);
    const recipe = recipeById(order.recipeId);
    const view = recipeUnlockView(save);
    const have = fridgeDishQty(save.fridge, order.recipeId);
    const needs = recipeNeeds(view, order.recipeId);
    const missing = needs.filter((r) => r.have < r.need);

    const canRefresh = canUseDailyAd(save, 'order_refresh', now);
    const refreshLeft = dailyAdLeft(save, 'order_refresh', now);
    const canDouble = canUseDailyAd(save, 'order_double', now);
    const doubleLeft = dailyAdLeft(save, 'order_double', now);

    // 左上：绿格胶带拍立得街坊相片
    const photo = this._makePolaroid(npc, 166);
    photo.position.set(-14, 14);
    slip.addChild(photo);

    // 右上：手写感大字诉求 + 沙漏倒计时（无胶囊黑框）
    const headLeft = 162;
    const headRight = width - 26;
    const remainMs = Math.max(0, order.expiresAt - now);
    const urgent = remainMs < 15 * 60 * 1000;

    const timerBox = new PIXI.Container();
    const hg = sceneSprite(SCENE_ART.hourglass, 18, 26);
    let tx = 0;
    if (hg) {
      hg.anchor.set(0, 0.5);
      timerBox.addChild(hg);
      tx = 24;
    }
    const timerTxt = makeText(
      'caption',
      formatOrderRemain(remainMs),
      urgent ? SCENE_INK.red : SCENE_INK.muted,
      { size: 22, fontWeight: '700' },
    );
    timerTxt.anchor.set(0, 0.5);
    timerTxt.position.set(tx, 0);
    timerBox.addChild(timerTxt);
    const timerW = tx + Math.ceil(timerTxt.width);
    timerBox.position.set(headRight - timerW, 48);
    slip.addChild(timerBox);
    this._liveTimers.push({ expiresAt: order.expiresAt, textNode: timerTxt });

    const dishTitle = makeText('title', `想吃 · ${recipe?.name ?? '家常菜'}`, SCENE_INK.ink, { size: 30 });
    dishTitle.anchor.set(0, 0.5);
    dishTitle.position.set(headLeft, 48);
    fitTextWidth(dishTitle, Math.max(140, headRight - timerW - headLeft - 14));
    slip.addChild(dishTitle);

    drawInkDivider(slip, headLeft, 76, headRight - headLeft, 0.38, 10);

    // 中部：立体成菜大图标直呈 + 食材余量/备好状态（去掉重复底盘）
    const plateCx = 224;
    const plateCy = 158;
    if (have > 0) {
      const flare = makeRarityFlare(recipe?.rarity ?? 'common', 156);
      flare.position.set(plateCx, plateCy - 2);
      slip.addChild(flare);
    }
    const plateNode = makeDishDisplay({
      dishPath: resolveDishAssetPath(order.recipeId),
      size: 108,
      shadowAlpha: 0.22,
    });
    plateNode.position.set(plateCx, plateCy + 4);
    plateNode.eventMode = 'static';
    plateNode.cursor = 'pointer';
    plateNode.hitArea = new PIXI.Rectangle(-62, -64, 124, 124);
    plateNode.on('pointertap', (e) => {
      e.stopPropagation();
      const v = inspectFromRecipe(order.recipeId);
      if (!v) return;
      AudioManager.play('ui_click');
      this._inspect = v;
      this.relayout();
    });
    slip.addChild(plateNode);

    const midX = 296;
    const maxMidW = headRight - midX;
    if (have > 0) {
      const readyTitle = makeText('heading', `✓ 冰箱现成 ${have} 盘`, SCENE_INK.green, { size: 26 });
      readyTitle.anchor.set(0, 0.5);
      readyTitle.position.set(midX, 134);
      fitTextWidth(readyTitle, maxMidW);

      const readySub = makeText(
        'body',
        canDouble ? '直接交菜，或看视频双倍领谢礼' : '端过去就能领街坊谢礼啦',
        SCENE_INK.soft,
        { size: 22 },
      );
      readySub.anchor.set(0, 0.5);
      readySub.position.set(midX, 178);
      fitTextWidth(readySub, maxMidW);
      slip.addChild(readyTitle, readySub);
    } else if (missing.length === 0) {
      const canCookTitle = makeText('heading', '食材齐备 · 下锅就能炒', SCENE_INK.green, { size: 25 });
      canCookTitle.anchor.set(0, 0.5);
      canCookTitle.position.set(midX, 126);
      fitTextWidth(canCookTitle, maxMidW);
      slip.addChild(canCookTitle);

      const needsRow = this._makeClickableNeeds(needs, maxMidW);
      needsRow.position.set(midX, 178);
      slip.addChild(needsRow);
    } else {
      const lackTitle = makeText('body', '还差这几味食材：', SCENE_INK.soft, { size: 23 });
      lackTitle.anchor.set(0, 0.5);
      lackTitle.position.set(midX, 124);
      slip.addChild(lackTitle);

      const needsRow = this._makeClickableNeeds(needs, maxMidW);
      needsRow.position.set(midX, 176);
      slip.addChild(needsRow);
    }

    // 下部：水墨分割线 + 无框大字谢礼 + 动作按钮栏
    drawInkDivider(slip, 28, 236, width - 56, 0.4, 12);

    const reward = neighborOrderReward(order);
    const chips = neighborRewardChips(reward);
    if (chips.length) {
      const rewardLine = new PIXI.Container();
      rewardLine.position.set(30, 272);
      const lead = makeText('heading', '街坊谢礼：', SCENE_INK.soft, { size: 24 });
      lead.anchor.set(0, 0.5);
      rewardLine.addChild(lead);

      const inline = makeInlineRewards(chips, {
        size: 26,
        iconSize: 38,
        color: SCENE_INK.ink,
        goldColor: SCENE_INK.gold,
        gap: 16,
        resolveItemIcon: resolveItemAssetPath,
      });
      inline.position.set(lead.width + 4, 0);
      rewardLine.addChild(inline);

      let totalRw = lead.width + 4 + inline.width;
      if (reward.food?.tease) {
        const teaseSeal = makeSealStamp('鲜货', 44, -0.1);
        teaseSeal.position.set(totalRw + 26, 0);
        rewardLine.addChild(teaseSeal);
        totalRw += 52;
      }

      const maxRw = canRefresh ? width - 166 : width - 60;
      if (totalRw > maxRw && maxRw > 120) {
        rewardLine.scale.set(maxRw / totalRw);
      }

      if (reward.food?.defId) {
        const foodId = reward.food.defId;
        rewardLine.eventMode = 'static';
        rewardLine.cursor = 'pointer';
        rewardLine.hitArea = new PIXI.Rectangle(-4, -24, Math.ceil(totalRw) + 8, 48);
        rewardLine.on('pointertap', (e) => {
          e.stopPropagation();
          const v = inspectFromItem(foodId);
          if (!v) return;
          if (reward.food?.tease) v.note = `${v.note ?? ''} · 街坊私藏鲜货`;
          AudioManager.play('ui_click');
          this._inspect = v;
          this.relayout();
        });
      }
      slip.addChild(rewardLine);
    }

    if (canRefresh) {
      const dropLink = makeText('caption', '婉拒此单', SCENE_INK.muted, { size: 22, fontWeight: '700' });
      dropLink.anchor.set(1, 0.5);
      dropLink.position.set(headRight, 272);
      dropLink.eventMode = 'static';
      dropLink.cursor = 'pointer';
      dropLink.hitArea = new PIXI.Rectangle(-dropLink.width - 10, -20, dropLink.width + 20, 40);
      dropLink.on('pointertap', (e) => {
        e.stopPropagation();
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      slip.addChild(dropLink);
    }

    // 底部操作按钮行（x: 28..584，高 56）
    const btnY = 308;
    const btnH = 56;
    const leftBtnW = 166;
    if (canRefresh) {
      const refreshBtn = makeAdButton({
        label: '换一单',
        width: leftBtnW,
        height: btnH,
        skin: 'cream',
        textColor: SCENE_INK.ink,
        badge: `免冷·${refreshLeft}`,
        onReady: this._scheduleRelayout,
      });
      refreshBtn.position.set(28, btnY);
      refreshBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'order_refresh',
          () => {
            this._adBusy = false;
            KitchenManager.refreshNeighborOrder(order.id);
            this._inspect = null;
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      slip.addChild(refreshBtn);
    } else {
      const dropBtn = makeSlicedButton({
        label: '婉拒此单',
        width: leftBtnW,
        height: btnH,
        skin: 'cream',
        textColor: SCENE_INK.soft,
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      dropBtn.position.set(28, btnY);
      dropBtn.on('pointertap', () => {
        KitchenManager.abandonNeighborOrder(order.id);
        this._inspect = null;
        if (this._isOpen) this.relayout();
      });
      slip.addChild(dropBtn);
    }

    const submitOrder = (doubled: boolean, fromX: number): void => {
      const from = this._toStage(x + fromX, y + btnY + btnH / 2);
      const gain = KitchenManager.submitNeighborOrder(order.id, { doubled });
      if (!gain) return;
      this._inspect = null;
      if (KitchenManager.liveNeighborOrders().length) this.relayout();
      else this.close(true);
      playRewardCollect({ ...gain, from });
    };

    const rightStart = 208;
    const rightSpan = headRight - rightStart; // 378px
    if (have > 0) {
      if (canDouble) {
        const subW = 170;
        const dblW = rightSpan - subW - 12; // 196px
        const subBtn = makeSlicedButton({
          label: '交菜',
          width: subW,
          height: btnH,
          skin: 'olive',
          fontSize: 28,
          onReady: this._scheduleRelayout,
        });
        subBtn.position.set(rightStart, btnY);
        subBtn.on('pointertap', () => submitOrder(false, rightStart + subW / 2));

        const dblBtn = makeAdButton({
          label: '双倍交菜',
          width: dblW,
          height: btnH,
          skin: 'gold',
          badge: `×2·剩${doubleLeft}`,
          onReady: this._scheduleRelayout,
        });
        dblBtn.position.set(rightStart + subW + 12, btnY);
        dblBtn.on('pointertap', () => {
          if (this._adBusy) return;
          this._adBusy = true;
          Platform.showRewardedVideo(
            'order_double',
            () => {
              this._adBusy = false;
              submitOrder(true, rightStart + subW + 12 + dblW / 2);
            },
            () => {
              this._adBusy = false;
            },
          );
        });
        slip.addChild(subBtn, dblBtn);
      } else {
        const subBtn = makeSlicedButton({
          label: '交菜领礼',
          width: rightSpan,
          height: btnH,
          skin: 'olive',
          fontSize: 28,
          onReady: this._scheduleRelayout,
        });
        subBtn.position.set(rightStart, btnY);
        subBtn.on('pointertap', () => submitOrder(false, rightStart + rightSpan / 2));
        slip.addChild(subBtn);
      }
    } else {
      const cookW = 222;
      const subW = rightSpan - cookW - 12; // 144px
      const cookBtn = makeSlicedButton({
        label: missing.length === 0 ? '去做菜' : '去灶台看',
        width: cookW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 27,
        onReady: this._scheduleRelayout,
      });
      cookBtn.position.set(rightStart, btnY);
      cookBtn.on('pointertap', () => {
        this.onCook?.(order.recipeId);
      });

      const subBtn = makeSlicedButton({
        label: '交菜',
        width: subW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      subBtn.position.set(rightStart + cookW + 12, btnY);
      subBtn.on('pointertap', () => submitOrder(false, rightStart + cookW + 12 + subW / 2));
      slip.addChild(cookBtn, subBtn);
    }
  }

  // ── 拍立得相框 + 街坊肖像 + 相纸手写署名 ─────────────────────────────────
  private _makePolaroid(npc: NeighborNpc, photoW: number): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const s = photoW / 220;
    const photoH = Math.round(252 * s);
    const tilt = -0.113; // 对应原图 220×252 预倾斜角 -6.5°

    const frameSp = sceneSprite(ART.photo, photoW, photoH);
    if (frameSp) {
      root.addChild(frameSp);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(3, SCENE_INK.ink, 1);
      fb.beginFill(0xFAF0DC, 1);
      fb.drawRoundedRect(6, 16, photoW - 12, photoH - 20, 6);
      fb.endFill();
      root.addChild(fb);
    }

    // 相纸内窗精确四角（原图 220×252：(21,48)-(179,30)-(196,185)-(37,204)）
    const p1x = 21 * s; const p1y = 48 * s;
    const p2x = 179 * s; const p2y = 30 * s;
    const p3x = 196 * s; const p3y = 185 * s;
    const p4x = 37 * s; const p4y = 204 * s;

    const backdrop = new PIXI.Graphics();
    backdrop.beginFill(0xF6E8CE, 1);
    backdrop.moveTo(p1x, p1y);
    backdrop.lineTo(p2x, p2y);
    backdrop.lineTo(p3x, p3y);
    backdrop.lineTo(p4x, p4y);
    backdrop.closePath();
    backdrop.endFill();
    root.addChild(backdrop);

    const npcTex = gameTexture(npc.portrait);
    if (isTextureReady(npcTex)) {
      const clip = new PIXI.Graphics();
      clip.beginFill(0xffffff, 1);
      clip.moveTo(p1x, p1y);
      clip.lineTo(p2x, p2y);
      clip.lineTo(p3x, p3y);
      clip.lineTo(p4x, p4y);
      clip.closePath();
      clip.endFill();

      const spr = new PIXI.Sprite(npcTex);
      fitSpriteInBox(spr, 164 * s, 164 * s);
      spr.anchor.set(0.5, 1);
      spr.rotation = tilt;
      spr.position.set(117 * s, 196 * s);
      spr.mask = clip;
      spr.eventMode = 'none';
      root.addChild(clip, spr);
    }

    const rim = new PIXI.Graphics();
    rim.lineStyle(1.8, 0x3F2E1E, 0.9);
    rim.moveTo(p1x, p1y);
    rim.lineTo(p2x, p2y);
    rim.lineTo(p3x, p3y);
    rim.lineTo(p4x, p4y);
    rim.closePath();
    root.addChild(rim);

    // 相纸底栏手写街坊名字
    const nameTxt = makeText('heading', npc.name, SCENE_INK.ink, { size: 23 });
    nameTxt.anchor.set(0.5);
    nameTxt.rotation = tilt;
    nameTxt.position.set(118 * s, 222 * s);
    fitTextWidth(nameTxt, 148 * s);
    root.addChild(nameTxt);

    return root;
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

  private _armTimer(): void {
    this._clearTimer();
    this._timer = setInterval(() => {
      if (!this._isOpen) return;
      const now = Date.now();
      let anyExpired = false;
      for (const item of this._liveTimers) {
        if (item.textNode.destroyed) continue;
        const remain = item.expiresAt - now;
        if (remain <= 0) {
          anyExpired = true;
          break;
        }
        item.textNode.text = formatOrderRemain(remain);
        item.textNode.style.fill = remain < 15 * 60 * 1000 ? SCENE_INK.red : SCENE_INK.muted;
      }
      if (anyExpired && !this._adBusy) {
        KitchenManager.sweepNeighborOrders();
        if (this._isOpen) this.relayout();
      }
    }, 1000);
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
