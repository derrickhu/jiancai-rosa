import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  HUD_ICON,
  MARKET_PROP_ART,
  P0_ART,
  UI_KIT,
  fitTextWidth,
  makeAdButton,
  makeCoinButton,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import { watchTextures } from '@/utils/assets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeHangTag,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const WALL = 'subpkg_images/scene_pk_cellar_wall.png';
const W = 700;
const INK = SCENE_INK.ink;

const BULLSEYE_HALF = 0.068; // 13.6% gold center
const STEADY_HALF = 0.18;    // 36% green zone

export interface SteelyardEnterResult {
  feeOverride: number;
  bonusItems: number;
  usedStallFavor?: boolean;
}

type Phase = 'swinging' | 'bullseye' | 'steady' | 'miss';

export class SteelyardPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _poiseNode: PIXI.Container | null = null;
  private _trackX = 0;
  private _trackW = 1;
  private _elapsed = 0;
  private _cursor = 0.15;
  private _phase: Phase = 'swinging';
  private _adBusy = false;
  private _paintQueued = false;

  private _nodeId = '';
  private _stallTitle = '好货摊';
  private _fee = 6;
  private _onEnter: ((res: SteelyardEnterResult) => void) | null = null;
  private _onCancel: ((tried: boolean) => void) | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(opts: {
    nodeId: string;
    stallTitle: string;
    fee: number;
    onEnter: (res: SteelyardEnterResult) => void;
    onCancel: (tried: boolean) => void;
  }): void {
    this._nodeId = opts.nodeId;
    this._stallTitle = opts.stallTitle;
    this._fee = Math.max(1, Math.floor(opts.fee));
    this._onEnter = opts.onEnter;
    this._onCancel = opts.onCancel;
    this._phase = 'swinging';
    this._elapsed = Math.random() * Math.PI * 2;
    this._cursor = 0.5 + 0.44 * Math.sin(this._elapsed);
    this._adBusy = false;
    this._isOpen = true;
    this.visible = true;
    AudioManager.play('ui_open');
    warmupAdScene('stall_favor');
    this._bindTicker(true);
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    this._bindTicker(false);
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._poiseNode = null;
    this._adBusy = false;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
  }

  private _bindTicker(on: boolean): void {
    PIXI.Ticker.shared.remove(this._onTick, this);
    if (on) PIXI.Ticker.shared.add(this._onTick, this);
  }

  private _onTick = (delta: number): void => {
    if (!this._isOpen || this._phase !== 'swinging') return;
    this._elapsed += (delta / 60) * 3.05;
    this._cursor = 0.5 + 0.44 * Math.sin(this._elapsed);
    if (this._poiseNode && !this._poiseNode.destroyed) {
      this._poiseNode.x = this._trackX + this._cursor * this._trackW;
    }
  };

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
    this._poiseNode = null;
    if (!this._isOpen) return;

    watchTextures(
      [
        WALL,
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        MARKET_PROP_ART.steelyardIcon,
        P0_ART.adClapper,
        HUD_ICON.coin,
      ],
      this._scheduleRelayout,
    );

    const sheetTop = 336;
    const sheetH = 446;
    const panelH = sheetTop + sheetH + 28;

    const { scene } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 46,
      dimAlpha: 0.66,
      onDimTap: () => {
        if (this._adBusy) return;
        const tried = this._phase !== 'swinging';
        const cb = this._onCancel;
        this.close();
        cb?.(tried);
      },
    });

    // 场景木墙与搁板（搁板顶面在 y≈305）
    drawSceneWall(scene, WALL, W, panelH, 430, 64);
    drawPlaqueTitle(scene, '老杆秤稳准星', W / 2, -44, 360);
    drawSceneClose(scene, W - 46, -20, () => {
      if (this._adBusy) return;
      const tried = this._phase !== 'swinging';
      const cb = this._onCancel;
      this.close();
      cb?.(tried);
    }, this._scheduleRelayout);

    // 搁板上摆黄铜杆秤实物 + 右侧挂摊位牛皮纸签
    const iconSp = sceneSprite(MARKET_PROP_ART.steelyardIcon, 158, 158);
    if (iconSp) {
      iconSp.anchor.set(0.5, 1);
      iconSp.position.set(206, 308);
      scene.addChild(iconSp);
    }

    const tag = makeHangTag(310);
    tag.node.pivot.set(tag.faceCx, 0);
    tag.node.position.set(478, 148);
    tag.node.rotation = 0.03;
    scene.addChild(tag.node);

    const stallT = makeText('title', this._stallTitle, INK, { size: 28 });
    stallT.anchor.set(0.5);
    stallT.position.set(tag.faceCx, tag.h * 0.36);
    fitTextWidth(stallT, tag.faceW - 10);
    tag.node.addChild(stallT);

    const feeRow = new PIXI.Container();
    const feePre = makeText('body', '原摊费 ', SCENE_INK.soft, { size: 23 });
    feePre.anchor.set(0, 0.5);
    feeRow.addChild(feePre);
    let fx = feePre.width;
    const coinSp = sceneSprite(HUD_ICON.coin, 26, 26);
    if (coinSp) {
      coinSp.anchor.set(0, 0.5);
      coinSp.position.set(fx, 0);
      feeRow.addChild(coinSp);
      fx += 30;
    }
    const feeNum = makeText('number', `${this._fee}`, SCENE_INK.gold, { size: 25 });
    feeNum.anchor.set(0, 0.5);
    feeNum.position.set(fx, 0);
    feeRow.addChild(feeNum);
    const feeTotalW = fx + feeNum.width;
    feeRow.position.set(tag.faceCx - feeTotalW / 2, tag.h * 0.7);
    tag.node.addChild(feeRow);

    // 搁板下方钉宣纸称重台单
    const sheetX = 26;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 140, 120);

    const headL = 92;
    const headR = W - 92;
    const contentL = 62;
    const contentR = W - 62;
    const contentW = contentR - contentL;
    const halfFee = Math.max(1, Math.floor(this._fee * 0.5));

    // 大字读数与规则说明（首行内收至 92..W-92 且下移至 sheetTop+64，彻底避开左右铜钉）
    let headline = '手稳准星正，看准金心点「定秤」！';
    let headColor: number = INK;
    let stampTxt = '';
    if (this._phase === 'bullseye') {
      headline = '一秤定音！免单 + 多塞 2 件好货！';
      headColor = SCENE_INK.green;
      stampTxt = '头彩';
    } else if (this._phase === 'steady') {
      headline = `秤杆稳平！半价 ${halfFee} 金 + 多塞 1 件！`;
      headColor = SCENE_INK.green;
      stampTxt = '稳准';
    } else if (this._phase === 'miss') {
      headline = '秤砣偏了一点点 · 失手零惩罚';
      headColor = SCENE_INK.red;
    }

    const headW = headR - headL;
    const headLbl = makeText('title', headline, headColor, { size: 28 });
    headLbl.anchor.set(0, 0.5);
    headLbl.position.set(headL, sheetTop + 64);
    fitTextWidth(headLbl, stampTxt ? headW - 68 : headW);
    scene.addChild(headLbl);

    if (stampTxt) {
      const seal = makeSealStamp(stampTxt, 50, -0.1);
      seal.position.set(headR - 25, sheetTop + 64);
      scene.addChild(seal);
    }

    // 区间图例行（23pt 清晰墨字 + 色块点，不套小圆框）
    const legY = sheetTop + 114;
    const legG = new PIXI.Graphics();
    legG.lineStyle(1.8, INK, 0.9);
    legG.beginFill(0xF5C23E, 1);
    legG.drawRoundedRect(contentL, legY - 10, 20, 20, 5);
    legG.endFill();
    legG.beginFill(0x5E9B4E, 1);
    legG.drawRoundedRect(contentL + 266, legY - 10, 20, 20, 5);
    legG.endFill();
    scene.addChild(legG);

    const legGold = makeText('body', '金心：免单 + 送2件', SCENE_INK.gold, { size: 23, fontWeight: '700' });
    legGold.anchor.set(0, 0.5);
    legGold.position.set(contentL + 28, legY);

    const legGreen = makeText('body', `绿区：半价(${halfFee}) + 送1件`, SCENE_INK.green, { size: 23, fontWeight: '700' });
    legGreen.anchor.set(0, 0.5);
    legGreen.position.set(contentL + 294, legY);
    fitTextWidth(legGreen, contentR - (contentL + 294));
    scene.addChild(legGold, legGreen);

    drawInkDivider(scene, contentL, sheetTop + 144, contentW, 0.5, 11);

    // ── 老式乌木铜星杆秤舞台 ─────────────────────────────────────────────
    const stageTop = sheetTop + 168;
    const stageH = 148;
    const trackMargin = 22;
    const trackX = contentL + trackMargin;
    const trackW = contentW - trackMargin * 2;
    const beamY = stageTop + 66;
    const beamH = 32;
    this._trackX = trackX;
    this._trackW = trackW;

    // 温润浅底衬托秤杆，边缘水墨细线，不套厚黑框
    const mat = new PIXI.Graphics();
    mat.lineStyle(2, 0xB89B74, 0.75);
    mat.beginFill(0xEFE2CA, 0.85);
    mat.drawRoundedRect(contentL, stageTop, contentW, stageH, 16);
    mat.endFill();
    scene.addChild(mat);

    const fulcrumHint = makeText('caption', '▼ 定盘金星 ▼', SCENE_INK.gold, { size: 22, fontWeight: '700' });
    fulcrumHint.anchor.set(0.5, 0);
    fulcrumHint.position.set(W / 2, stageTop + 10);
    scene.addChild(fulcrumHint);

    const beam = new PIXI.Graphics();
    // 乌木秤杆
    beam.lineStyle(3, INK, 1);
    beam.beginFill(0x6E411F, 1);
    beam.drawRoundedRect(trackX, beamY - beamH / 2, trackW, beamH, beamH / 2);
    beam.endFill();

    // 稳平绿区
    const stX = trackX + (0.5 - STEADY_HALF) * trackW;
    const stW = STEADY_HALF * 2 * trackW;
    beam.lineStyle(0);
    beam.beginFill(0x5E9B4E, 0.96);
    beam.drawRoundedRect(stX, beamY - beamH / 2 + 3, stW, beamH - 6, (beamH - 6) / 2);
    beam.endFill();

    // 靶心金区
    const buX = trackX + (0.5 - BULLSEYE_HALF) * trackW;
    const buW = BULLSEYE_HALF * 2 * trackW;
    beam.beginFill(0xF5C23E, 1);
    beam.drawRoundedRect(buX, beamY - beamH / 2 + 3, buW, beamH - 6, 8);
    beam.endFill();

    // 秤星铜点
    beam.beginFill(0xFFF6D6, 0.92);
    for (let i = 1; i <= 11; i++) {
      const sx = trackX + (i / 12) * trackW;
      beam.drawCircle(sx, beamY, i === 6 ? 4.5 : 2.5);
    }
    beam.endFill();

    // 中央铜提纽准星三角
    beam.lineStyle(2.2, INK, 1);
    beam.beginFill(0xE8B238, 1);
    beam.moveTo(trackX + trackW / 2, beamY - beamH / 2 - 1);
    beam.lineTo(trackX + trackW / 2 - 9, beamY - beamH / 2 - 14);
    beam.lineTo(trackX + trackW / 2 + 9, beamY - beamH / 2 - 14);
    beam.closePath();
    beam.endFill();
    scene.addChild(beam);

    // 摆动黄铜秤砣
    const poise = new PIXI.Container();
    const pg = new PIXI.Graphics();
    pg.lineStyle(3, 0xB83224, 1);
    pg.moveTo(0, -beamH / 2 - 2);
    pg.lineTo(0, 26);
    pg.lineStyle(2.6, INK, 1);
    pg.beginFill(0xD89B28, 1);
    pg.drawRoundedRect(-6, -beamH / 2 - 5, 12, beamH + 10, 5);
    pg.endFill();
    pg.beginFill(0xEBB63E, 1);
    pg.drawRoundedRect(-16, 24, 32, 34, 10);
    pg.endFill();
    pg.lineStyle(0);
    pg.beginFill(0xFFF4C2, 0.72);
    pg.drawRoundedRect(-10, 29, 8, 20, 4);
    pg.endFill();
    poise.addChild(pg);
    poise.position.set(trackX + this._cursor * trackW, beamY);
    scene.addChild(poise);
    this._poiseNode = poise;

    // 底部操作按钮区
    const btnY = stageTop + stageH + 24;
    const btnH = 62;

    if (this._phase === 'swinging') {
      const hitTray = new PIXI.Container();
      hitTray.eventMode = 'static';
      hitTray.cursor = 'pointer';
      hitTray.hitArea = new PIXI.Rectangle(contentL, stageTop, contentW, stageH);
      hitTray.on('pointertap', () => this._stopPoise());
      scene.addChild(hitTray);

      const canPay = KitchenManager.save.money >= this._fee;
      if (canPay) {
        const gap = 14;
        const stopW = Math.round(contentW * 0.62);
        const skipW = contentW - stopW - gap;

        const stopBtn = makeSlicedButton({
          label: '定 秤 ！',
          width: stopW,
          height: btnH,
          skin: 'gold',
          textColor: INK,
          fontSize: 30,
          onReady: this._scheduleRelayout,
        });
        stopBtn.position.set(contentL, btnY);
        stopBtn.on('pointertap', () => this._stopPoise());
        scene.addChild(stopBtn);

        const directBtn = makeCoinButton({
          prefix: '直付',
          price: this._fee,
          width: skipW,
          height: btnH,
          skin: 'cream',
          textColor: INK,
          fontSize: 25,
          onReady: this._scheduleRelayout,
        });
        directBtn.position.set(contentL + stopW + gap, btnY);
        directBtn.on('pointertap', () => {
          analytics.trackSteelyardSettle({
            marketId: RunManager.run?.marketId,
            phase: this._phase,
            action: 'pay',
            feePaid: this._fee,
            bonusItems: 0,
          });
          const cb = this._onEnter;
          this.close(true);
          cb?.({ feeOverride: this._fee, bonusItems: 0 });
        });
        scene.addChild(directBtn);
      } else {
        const stopBtn = makeSlicedButton({
          label: '定 秤 搏 免 单 ！',
          width: contentW,
          height: btnH,
          skin: 'gold',
          textColor: INK,
          fontSize: 28,
          onReady: this._scheduleRelayout,
        });
        stopBtn.position.set(contentL, btnY);
        stopBtn.on('pointertap', () => this._stopPoise());
        scene.addChild(stopBtn);
      }
      return;
    }

    const canAffordHalf = KitchenManager.save.money >= halfFee;
    const favorLeft = !RunManager.run?.stallFavorUsed;

    if (this._phase === 'bullseye') {
      const goBtn = makeSlicedButton({
        label: '免单进摊翻好货！',
        width: contentW,
        height: btnH,
        skin: 'olive',
        fontSize: 28,
        onReady: this._scheduleRelayout,
      });
      goBtn.position.set(contentL, btnY);
      goBtn.on('pointertap', () => {
        analytics.trackSteelyardSettle({
          marketId: RunManager.run?.marketId,
          phase: 'green',
          action: 'pay',
          feePaid: 0,
          bonusItems: 2,
        });
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: 0, bonusItems: 2 });
      });
      scene.addChild(goBtn);
      return;
    }

    if (this._phase === 'steady' && canAffordHalf) {
      const goBtn = makeCoinButton({
        prefix: '半价进摊(+1件)',
        price: halfFee,
        width: contentW,
        height: btnH,
        skin: 'olive',
        textColor: 0xFFF8F0,
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      goBtn.position.set(contentL, btnY);
      goBtn.on('pointertap', () => {
        analytics.trackSteelyardSettle({
          marketId: RunManager.run?.marketId,
          phase: 'steady',
          action: 'pay',
          feePaid: halfFee,
          bonusItems: 1,
        });
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: halfFee, bonusItems: 1 });
      });
      scene.addChild(goBtn);
      return;
    }

    // 偏出绿区或半价钱不够：提供帮摊主收筐免单激励视频 + 正常付费/逛别处
    const gap = 14;
    const adW = Math.round(contentW * 0.58);
    const subW = contentW - adW - gap;
    const adBtn = makeAdButton({
      label: '帮收筐 免单+2件',
      width: adW,
      height: btnH,
      skin: 'gold',
      textColor: INK,
      badge: favorLeft ? '本局限1' : '已用过',
      disabled: !favorLeft,
      onReady: this._scheduleRelayout,
    });
    adBtn.position.set(contentL, btnY);
    if (favorLeft) {
      adBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'stall_favor',
          () => {
            this._adBusy = false;
            analytics.trackSteelyardSettle({
              marketId: RunManager.run?.marketId,
              phase: this._phase,
              action: 'ad_favor',
              feePaid: 0,
              bonusItems: 2,
            });
            const cb = this._onEnter;
            this.close(true);
            cb?.({ feeOverride: 0, bonusItems: 2, usedStallFavor: true });
          },
          () => {
            this._adBusy = false;
          },
        );
      });
    }
    scene.addChild(adBtn);

    const payFee = this._phase === 'steady' ? halfFee : this._fee;
    const canPay = KitchenManager.save.money >= payFee;
    const rightBtn = canPay
      ? makeCoinButton({
        prefix: '进摊',
        price: payFee,
        width: subW,
        height: btnH,
        skin: 'terracotta',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      })
      : makeSlicedButton({
        label: '先逛别处',
        width: subW,
        height: btnH,
        skin: 'cream',
        textColor: INK,
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
    rightBtn.position.set(contentL + adW + gap, btnY);
    rightBtn.on('pointertap', () => {
      if (canPay) {
        const bonus = this._phase === 'steady' ? 1 : 0;
        analytics.trackSteelyardSettle({
          marketId: RunManager.run?.marketId,
          phase: this._phase,
          action: 'pay',
          feePaid: payFee,
          bonusItems: bonus,
        });
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: payFee, bonusItems: bonus });
      } else {
        analytics.trackSteelyardSettle({
          marketId: RunManager.run?.marketId,
          phase: this._phase,
          action: 'leave',
          feePaid: 0,
          bonusItems: 0,
        });
        const cb = this._onCancel;
        this.close();
        cb?.(true);
      }
    });
    scene.addChild(rightBtn);
  }

  private _stopPoise(): void {
    if (this._phase !== 'swinging') return;
    const diff = Math.abs(this._cursor - 0.5);
    if (diff <= BULLSEYE_HALF) {
      this._phase = 'bullseye';
      AudioManager.play('recipe_paper');
    } else if (diff <= STEADY_HALF) {
      this._phase = 'steady';
      AudioManager.play('event_pop');
    } else {
      this._phase = 'miss';
      AudioManager.play('ui_click');
    }
    RunManager.markSteelyardDone(this._nodeId);
    this.relayout();
  }
}
