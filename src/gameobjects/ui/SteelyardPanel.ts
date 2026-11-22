import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import {
  HUD_ICON,
  MARKET_PROP_ART,
  P0_ART,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawSectionTray,
  fillRect,
  makeAdButton,
  makeArtisanShell,
  makeLabel,
  makeSlicedButton,
  makeSlotBadge,
} from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';

const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const PAPER = 0xFFF8F0;
const TERRACOTTA = UI_PALETTE.terracotta;
const OLIVE = UI_PALETTE.olive;

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
    this._root.removeChildren();
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
    this._root.removeChildren();
    this._poiseNode = null;
    if (!this._isOpen) return;

    watchTextures(
      [
        UI_KIT.headerRibbon,
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        MARKET_PROP_ART.steelyardIcon,
        P0_ART.adClapper,
        HUD_ICON.coin,
      ],
      this._scheduleRelayout,
    );

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._adBusy) return;
      const tried = this._phase !== 'swinging';
      const cb = this._onCancel;
      this.close();
      cb?.(tried);
    });
    this._root.addChild(dim);

    const boxW = Math.min(w - 36, 650);
    const boxH = 496;
    const padX = 24;
    const cw = boxW - padX * 2;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 36, (h - boxH) / 2));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '老 杆 秤 稳 准 星',
      subtitle: `${this._stallTitle} · 原费 ${this._fee} 金（失手零惩罚）`,
      closeSilent: true,
      onReady: this._scheduleRelayout,
      onClose: () => {
        if (this._adBusy) return;
        const tried = this._phase !== 'swinging';
        const cb = this._onCancel;
        this.close();
        cb?.(tried);
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    // Top rules banner with steelyard illustration
    const infoCard = new PIXI.Graphics();
    drawCraftCard(infoCard, padX, 92, cw, 120, { radius: 16, tone: 'ivory' });
    shell.addChild(infoCard);

    const iconTex = gameTexture(MARKET_PROP_ART.steelyardIcon);
    if (isTextureReady(iconTex)) {
      const sp = new PIXI.Sprite(iconTex);
      fitSpriteInBox(sp, 94, 94);
      sp.anchor.set(0.5);
      sp.position.set(padX + 58, 152);
      shell.addChild(sp);
    }

    const r1 = makeLabel('手稳准星正，这筐好菜算你便宜！', 17, INK, {
      fontWeight: '700',
      wordWrap: true,
      wordWrapWidth: cw - 126,
    });
    r1.position.set(padX + 114, 105);
    shell.addChild(r1);

    const zGold = makeSlotBadge('金心：免单 + 多塞 2 件好货', 'gold', 14);
    zGold.node.position.set(padX + 114, 139);
    const zGreen = makeSlotBadge(`绿区：半价(${Math.max(1, Math.floor(this._fee * 0.5))}金) + 多塞 1 件`, 'olive', 14);
    zGreen.node.position.set(padX + 114, 171);
    shell.addChild(zGold.node, zGreen.node);

    // Interactive wooden steelyard beam tray
    const trayY = 224;
    const trayH = 128;
    const tray = new PIXI.Graphics();
    drawSectionTray(tray, padX, trayY, cw, trayH, { radius: 16, tone: 'sand' });
    shell.addChild(tray);

    const trackMargin = 32;
    const trackX = padX + trackMargin;
    const trackW = cw - trackMargin * 2;
    const beamY = trayY + 52;
    const beamH = 24;
    this._trackX = trackX;
    this._trackW = trackW;

    const beam = new PIXI.Graphics();
    // Wooden steelyard rod
    beam.lineStyle(2.5, INK, 1);
    beam.beginFill(0x7A4B24, 1);
    beam.drawRoundedRect(trackX, beamY - beamH / 2, trackW, beamH, beamH / 2);
    beam.endFill();

    // Steady green zone
    const stX = trackX + (0.5 - STEADY_HALF) * trackW;
    const stW = STEADY_HALF * 2 * trackW;
    beam.lineStyle(0);
    beam.beginFill(0x5E9B4E, 0.95);
    beam.drawRoundedRect(stX, beamY - beamH / 2 + 2.5, stW, beamH - 5, (beamH - 5) / 2);
    beam.endFill();

    // Bullseye gold zone
    const buX = trackX + (0.5 - BULLSEYE_HALF) * trackW;
    const buW = BULLSEYE_HALF * 2 * trackW;
    beam.beginFill(0xF5C23E, 1);
    beam.drawRoundedRect(buX, beamY - beamH / 2 + 2.5, buW, beamH - 5, 6);
    beam.endFill();

    // Brass star dots along the beam
    beam.beginFill(0xFFF3C4, 0.9);
    for (let i = 1; i <= 11; i++) {
      const sx = trackX + (i / 12) * trackW;
      beam.drawCircle(sx, beamY, i === 6 ? 3.5 : 2);
    }
    beam.endFill();

    // Center fulcrum notch
    beam.lineStyle(2, INK, 1);
    beam.beginFill(0xE8B238, 1);
    beam.moveTo(trackX + trackW / 2, beamY - beamH / 2 - 2);
    beam.lineTo(trackX + trackW / 2 - 7, beamY - beamH / 2 - 12);
    beam.lineTo(trackX + trackW / 2 + 7, beamY - beamH / 2 - 12);
    beam.closePath();
    beam.endFill();
    shell.addChild(beam);

    // Swinging brass poise weight (秤砣)
    const poise = new PIXI.Container();
    const pg = new PIXI.Graphics();
    // Red cord
    pg.lineStyle(2.5, 0xB83224, 1);
    pg.moveTo(0, -beamH / 2 - 2);
    pg.lineTo(0, 22);
    // Brass ring & weight body
    pg.lineStyle(2.4, INK, 1);
    pg.beginFill(0xD89B28, 1);
    pg.drawRoundedRect(-5, -beamH / 2 - 4, 10, beamH + 8, 4);
    pg.endFill();
    pg.beginFill(0xEBB63E, 1);
    pg.drawRoundedRect(-13, 20, 26, 28, 9);
    pg.endFill();
    pg.lineStyle(0);
    pg.beginFill(0xFFF4C2, 0.7);
    pg.drawRoundedRect(-8, 24, 7, 16, 3);
    pg.endFill();
    poise.addChild(pg);
    poise.position.set(trackX + this._cursor * trackW, beamY);
    shell.addChild(poise);
    this._poiseNode = poise;

    if (this._phase === 'swinging') {
      // Tapping the tray also stops the poise weight!
      const hitTray = new PIXI.Container();
      hitTray.eventMode = 'static';
      hitTray.cursor = 'pointer';
      hitTray.hitArea = new PIXI.Rectangle(padX, trayY, cw, trayH);
      hitTray.on('pointertap', () => this._stopPoise());
      shell.addChild(hitTray);

      const hint = makeLabel('看准秤砣滑到金心，点「定秤」免单加菜！', 16, MUTED, { fontWeight: '700' });
      hint.anchor.set(0.5);
      hint.position.set(boxW / 2, trayY + trayH + 19);
      shell.addChild(hint);

      const canPay = KitchenManager.save.money >= this._fee;
      const btnY = boxH - 82;
      if (canPay) {
        const stopW = Math.round(cw * 0.60);
        const skipW = cw - stopW - 12;
        const stopBtn = makeSlicedButton({
          label: '定 秤 ！',
          width: stopW,
          height: 56,
          skin: 'gold',
          textColor: INK,
          fontSize: 24,
          onReady: this._scheduleRelayout,
        });
        stopBtn.position.set(padX, btnY);
        stopBtn.on('pointertap', () => this._stopPoise());
        shell.addChild(stopBtn);

        const directBtn = makeSlicedButton({
          label: `直接付 ${this._fee}金`,
          width: skipW,
          height: 56,
          skin: 'cream',
          textColor: INK,
          fontSize: 17,
          onReady: this._scheduleRelayout,
        });
        directBtn.position.set(padX + stopW + 12, btnY);
        directBtn.on('pointertap', () => {
          const cb = this._onEnter;
          this.close(true);
          cb?.({ feeOverride: this._fee, bonusItems: 0 });
        });
        shell.addChild(directBtn);
      } else {
        const stopBtn = makeSlicedButton({
          label: '定 秤 搏 免 单 ！',
          width: cw,
          height: 56,
          skin: 'gold',
          textColor: INK,
          fontSize: 23,
          onReady: this._scheduleRelayout,
        });
        stopBtn.position.set(padX, btnY);
        stopBtn.on('pointertap', () => this._stopPoise());
        shell.addChild(stopBtn);
      }
      return;
    }

    // Stopped state feedback & action buttons
    const halfFee = Math.max(1, Math.floor(this._fee * 0.5));
    const canAffordHalf = KitchenManager.save.money >= halfFee;
    const canAffordFull = KitchenManager.save.money >= this._fee;
    const favorLeft = !RunManager.run?.stallFavorUsed;

    let resMsg = '';
    let resColor: number = INK;
    if (this._phase === 'bullseye') {
      resMsg = '🎯 一秤定音！免单 + 多塞 2 件好货！';
      resColor = OLIVE;
    } else if (this._phase === 'steady') {
      resMsg = canAffordHalf
        ? `✨ 秤杆稳平！半价 ${halfFee} 金 + 多塞 1 件鲜货！`
        : `✨ 秤杆稳平（半价 ${halfFee} 金），可帮收筐免单！`;
      resColor = OLIVE;
    } else {
      resMsg = '秤砣偏了一点点（零惩罚 · 可帮收筐免单进摊）';
      resColor = TERRACOTTA;
    }

    const resLbl = makeLabel(resMsg, 16, resColor, { fontWeight: '700' });
    resLbl.anchor.set(0.5);
    resLbl.position.set(boxW / 2, trayY + trayH + 19);
    shell.addChild(resLbl);

    const btnY = boxH - 82;
    if (this._phase === 'bullseye') {
      const goBtn = makeSlicedButton({
        label: '免单进摊翻好货！',
        width: cw,
        height: 56,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 22,
        onReady: this._scheduleRelayout,
      });
      goBtn.position.set(padX, btnY);
      goBtn.on('pointertap', () => {
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: 0, bonusItems: 2 });
      });
      shell.addChild(goBtn);
      return;
    }

    if (this._phase === 'steady' && canAffordHalf) {
      const goBtn = makeSlicedButton({
        label: `半价 ${halfFee} 金进摊（+1件好货）`,
        width: cw,
        height: 56,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 20,
        onReady: this._scheduleRelayout,
      });
      goBtn.position.set(padX, btnY);
      goBtn.on('pointertap', () => {
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: halfFee, bonusItems: 1 });
      });
      shell.addChild(goBtn);
      return;
    }

    // Miss OR Steady-but-broke: offer stall_favor rewarded video (1/run) + normal pay / leave
    const adW = Math.round(cw * 0.58);
    const subW = cw - adW - 12;
    const adBtn = makeAdButton({
      label: '帮收筐 免单+2好货',
      width: adW,
      height: 54,
      skin: 'gold',
      textColor: INK,
      badge: favorLeft ? '本局限1' : '已用过',
      disabled: !favorLeft,
      onReady: this._scheduleRelayout,
    });
    adBtn.position.set(padX, btnY);
    if (favorLeft) {
      adBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'stall_favor',
          () => {
            this._adBusy = false;
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
    shell.addChild(adBtn);

    const payFee = this._phase === 'steady' ? halfFee : this._fee;
    const canPay = KitchenManager.save.money >= payFee;
    const rightBtn = makeSlicedButton({
      label: canPay ? `付 ${payFee} 金进摊` : '先逛别处',
      width: subW,
      height: 54,
      skin: canPay ? 'terracotta' : 'cream',
      textColor: canPay ? PAPER : INK,
      fontSize: 17,
      onReady: this._scheduleRelayout,
    });
    rightBtn.position.set(padX + adW + 12, btnY);
    rightBtn.on('pointertap', () => {
      if (canPay) {
        const bonus = this._phase === 'steady' ? 1 : 0;
        const cb = this._onEnter;
        this.close(true);
        cb?.({ feeOverride: payFee, bonusItems: bonus });
      } else {
        const cb = this._onCancel;
        this.close();
        cb?.(true);
      }
    });
    shell.addChild(rightBtn);
  }

  private _stopPoise(): void {
    if (this._phase !== 'swinging') return;
    const diff = Math.abs(this._cursor - 0.5);
    if (diff <= BULLSEYE_HALF) {
      this._phase = 'bullseye';
      AudioManager.play('recipe_paper');
      // Auto-enter after a crisp 520ms beat if user doesn't tap first? Let's let them enjoy the satisfying click OR auto-enter cleanly! Keeping the button tactile & instant is zero-surprise and super responsive.
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
