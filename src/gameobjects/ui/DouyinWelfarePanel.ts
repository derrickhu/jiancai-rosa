/**
 * 抖音侧边栏复访 + 添加到桌面（街坊福利公告栏场景版）。
 * 「去侧边栏」「添加到桌面」必须停在 pointertap 的同步栈里，不能包 await。
 */
import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { DOUYIN_GAME_NAME, DOUYIN_WELFARE } from '@/config/DouyinWelfareConfig';
import { DouyinWelfareManager } from '@/managers/DouyinWelfareManager';
import { DesktopEntry, SidebarEntry } from '@/platform/douyinEntry';
import { watchTextures } from '@/utils/assets';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  HUD_ICON,
  UI_KIT,
  fitTextWidth,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
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
  board: 'subpkg_images/scene_club_board.png',
  note: 'subpkg_images/scene_club_note.png',
  basket: 'subpkg_images/scene_club_basket.png',
} as const;

const W = 720;
const NOTE_X = 62;
const NOTE_W = W - NOTE_X * 2;

const SIDEBAR_STEPS = [
  '壹 · 点击抖音首页左上角「侧边栏」',
  `贰 · 找到并点开「${DOUYIN_GAME_NAME}」`,
  `叁 · 回到小店即可立领 +${DOUYIN_WELFARE.sidebarCoins} 金币`,
] as const;

export class DouyinWelfarePanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!Platform.isDouyin) return;
    const wasOpen = this._isOpen;
    if (!wasOpen) AudioManager.play('ui_click');
    this._isOpen = true;
    this.visible = true;
    DesktopEntry.refreshStatus();
    this.relayout();
    OverlayManager.bringToFront();
    if (!wasOpen) {
      analytics.trackWelfareAction({ channel: 'dy_sidebar', action: 'open' });
    }
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
  }

  refreshIfOpen(): void {
    if (this._isOpen) this.relayout();
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

    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        UI_KIT.btnOlive,
        UI_KIT.btnGold,
        HUD_ICON.coin,
      ],
      this._scheduleRelayout,
    );

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const sidebarClaimed = DouyinWelfareManager.sidebarClaimedToday;
    const fromSidebar = SidebarEntry.isFromSidebar();
    const showSteps = !fromSidebar || sidebarClaimed;

    const note1Top = 108;
    const note1H = showSteps ? 514 : 370;
    const noteGap = 18;
    const note2Top = note1Top + note1H + noteGap;
    const note2H = 362;
    const panelH = note2Top + note2H + 62;

    const { scene } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 44,
      dimAlpha: 0.66,
      onDimTap: () => this.close(),
    });

    drawSceneWall(scene, ART.board, W, panelH, 200, 180, 0x8B5A2B);
    drawPlaqueTitle(scene, '街坊福利栏', W / 2, -42, 348);
    drawSceneClose(scene, W - 54, -18, () => this.close(), this._scheduleRelayout);

    this._drawSidebarNote(scene, note1Top, note1H, showSteps, sidebarClaimed, fromSidebar);
    this._drawDesktopNote(scene, note2Top, note2H);
  }

  private _drawSidebarNote(
    scene: PIXI.Container,
    topY: number,
    noteH: number,
    showSteps: boolean,
    claimed: boolean,
    fromSidebar: boolean,
  ): void {
    const wrap = new PIXI.Container();
    wrap.position.set(NOTE_X, topY);
    drawStretchSheet(wrap, ART.note, 0, 0, NOTE_W, noteH, 128, 125, 0xF7EAD0);

    const padX = 48;
    const innerW = NOTE_W - padX * 2;

    // 右上角福利小礼篮 + 金币赏金（整体下移至 y>=118 避开顶部中央红图钉 y:0..98）
    const basket = sceneSprite(ART.basket, 138, 92);
    if (basket) {
      basket.anchor.set(0.5);
      basket.position.set(NOTE_W - 114, 156);
      wrap.addChild(basket);
    }
    const coinSp = sceneSprite(HUD_ICON.coin, 48, 48);
    if (coinSp) {
      coinSp.anchor.set(0.5);
      coinSp.position.set(NOTE_W - 140, 142);
      wrap.addChild(coinSp);
    }
    const bonusTxt = makeText('number', `+${DOUYIN_WELFARE.sidebarCoins}`, SCENE_INK.red, {
      size: 28,
      stroke: 0xFFF8EA,
      strokeWidth: 5,
    });
    bonusTxt.anchor.set(0, 0.5);
    bonusTxt.position.set(NOTE_W - 112, 144);
    wrap.addChild(bonusTxt);

    const title = makeText('title', '侧边栏每日复访礼', SCENE_INK.ink, { size: 31 });
    title.position.set(padX, 120);
    fitTextWidth(title, innerW - 184);
    wrap.addChild(title);

    const sub = makeText('caption', '每日复访一次 · 掌柜奉上买菜赏金', SCENE_INK.soft, {
      size: 22,
      fontWeight: '600',
    });
    sub.position.set(padX, 168);
    fitTextWidth(sub, innerW - 184);
    wrap.addChild(sub);

    drawInkDivider(wrap, padX, 208, innerW, 0.48, 9);

    let btnY = 238;
    if (showSteps) {
      SIDEBAR_STEPS.forEach((step, idx) => {
        const isLast = idx === SIDEBAR_STEPS.length - 1;
        const line = makeText(
          'body',
          step,
          isLast ? SCENE_INK.gold : SCENE_INK.ink,
          { size: 24, fontWeight: isLast ? '700' : '600' },
        );
        line.position.set(padX + 4, 232 + idx * 44);
        fitTextWidth(line, innerW - 8);
        wrap.addChild(line);
      });
      btnY = 384;
    }

    if (claimed) {
      const seal = makeSealStamp('今日已领', 62, -0.12);
      seal.position.set(NOTE_W - 76, btnY + 28);
      wrap.addChild(seal);
    }

    const label = claimed
      ? '今日复访赏金已领'
      : fromSidebar
        ? `立领 +${DOUYIN_WELFARE.sidebarCoins} 金币`
        : '去侧边栏领赏';
    const btnW = claimed ? innerW - 108 : innerW;
    const btn = makeSlicedButton({
      label,
      width: btnW,
      height: 60,
      skin: claimed ? 'cream' : fromSidebar ? 'olive' : 'terracotta',
      textColor: claimed ? 0x8A7358 : undefined,
      fontSize: 27,
      silent: claimed,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(padX, btnY);
    btn.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      this._onSidebarTap();
    });
    wrap.addChild(btn);

    scene.addChild(wrap);
  }

  private _drawDesktopNote(scene: PIXI.Container, topY: number, noteH: number): void {
    const claimed = DouyinWelfareManager.desktopRewardClaimed;
    const ready = DesktopEntry.alreadyAdded && !claimed;

    const wrap = new PIXI.Container();
    wrap.position.set(NOTE_X, topY);
    drawStretchSheet(wrap, ART.note, 0, 0, NOTE_W, noteH, 128, 125, 0xF7EAD0);

    const padX = 48;
    const innerW = NOTE_W - padX * 2;

    // 右侧金币图标 + 赏金大数字（整体下移至 y>=120 避开顶部中央红图钉）
    const coinSp = sceneSprite(HUD_ICON.coin, 46, 46);
    if (coinSp) {
      coinSp.anchor.set(0.5);
      coinSp.position.set(NOTE_W - 144, 148);
      wrap.addChild(coinSp);
    }
    const bonusTxt = makeText('number', `+${DOUYIN_WELFARE.desktopCoins}`, SCENE_INK.red, {
      size: 28,
      stroke: 0xFFF8EA,
      strokeWidth: 5,
    });
    bonusTxt.anchor.set(0, 0.5);
    bonusTxt.position.set(NOTE_W - 116, 149);
    wrap.addChild(bonusTxt);

    const title = makeText('title', '添置手机桌面快捷牌', SCENE_INK.ink, { size: 31 });
    title.position.set(padX, 120);
    fitTextWidth(title, innerW - 176);
    wrap.addChild(title);

    const sub = makeText('caption', '首次添置专享 · 随时开铺买菜更顺手', SCENE_INK.soft, {
      size: 22,
      fontWeight: '600',
    });
    sub.position.set(padX, 168);
    fitTextWidth(sub, innerW - 176);
    wrap.addChild(sub);

    drawInkDivider(wrap, padX, 208, innerW, 0.48, 9);

    const btnY = 236;
    if (claimed) {
      const seal = makeSealStamp('已领取', 62, -0.12);
      seal.position.set(NOTE_W - 76, btnY + 28);
      wrap.addChild(seal);
    }

    const label = claimed
      ? '桌面赏金已领'
      : ready
        ? `立领 +${DOUYIN_WELFARE.desktopCoins} 金币`
        : '添置到手机桌面';
    const btnW = claimed ? innerW - 108 : innerW;
    const btn = makeSlicedButton({
      label,
      width: btnW,
      height: 60,
      skin: claimed ? 'cream' : ready ? 'olive' : 'terracotta',
      textColor: claimed ? 0x8A7358 : undefined,
      fontSize: 27,
      silent: claimed,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(padX, btnY);
    btn.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      this._onDesktopTap();
    });
    wrap.addChild(btn);

    scene.addChild(wrap);
  }

  private _onSidebarTap(): void {
    if (DouyinWelfareManager.sidebarClaimedToday) {
      Platform.showToast('今日奖励已领取');
      return;
    }
    if (SidebarEntry.isFromSidebar()) {
      if (DouyinWelfareManager.claimSidebarReward()) {
        analytics.trackWelfareAction({
          channel: 'dy_sidebar',
          action: 'claim',
          goldGained: DOUYIN_WELFARE.sidebarCoins,
        });
        this.relayout();
      }
      return;
    }
    SidebarEntry.navigate({
      onFail: () => Platform.showToast('请从抖音首页侧边栏进入'),
    });
    analytics.trackWelfareAction({ channel: 'dy_sidebar', action: 'navigate' });
  }

  private _onDesktopTap(): void {
    if (DouyinWelfareManager.desktopRewardClaimed) {
      Platform.showToast('桌面奖励已领取');
      return;
    }
    if (DesktopEntry.alreadyAdded) {
      if (DouyinWelfareManager.claimDesktopReward()) {
        analytics.trackWelfareAction({
          channel: 'dy_desktop',
          action: 'claim',
          goldGained: DOUYIN_WELFARE.desktopCoins,
        });
        this.relayout();
      }
      return;
    }
    const started = DesktopEntry.add({
      onSuccess: () => {
        if (DouyinWelfareManager.claimDesktopReward()) {
          analytics.trackWelfareAction({
            channel: 'dy_desktop',
            action: 'claim',
            goldGained: DOUYIN_WELFARE.desktopCoins,
          });
        }
        if (this._isOpen) this.relayout();
      },
      onFail: () => Platform.showToast('添加失败，请重试'),
    });
    if (!started) {
      Platform.showToast('当前环境不支持添加到桌面');
      return;
    }
    analytics.trackWelfareAction({ channel: 'dy_desktop', action: 'navigate' });
  }
}
