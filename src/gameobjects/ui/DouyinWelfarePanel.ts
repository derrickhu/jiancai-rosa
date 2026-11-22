/**
 * 抖音侧边栏复访 + 添加到桌面。
 * 「去侧边栏」「添加到桌面」必须停在 pointertap 的同步栈里，不能包 await。
 */
import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { DOUYIN_GAME_NAME, DOUYIN_WELFARE } from '@/config/DouyinWelfareConfig';
import { DouyinWelfareManager } from '@/managers/DouyinWelfareManager';
import { DesktopEntry, SidebarEntry } from '@/platform/douyinEntry';
import { watchTextures } from '@/utils/assets';
import {
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeLabel,
  makeSlicedButton,
} from '@/utils/ui';

const PANEL_W = 636;
const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;

const SIDEBAR_STEPS = [
  '点击抖音首页侧边栏',
  `找到并点击「${DOUYIN_GAME_NAME}」`,
  '回到游戏即可领取金币',
] as const;

export class DouyinWelfarePanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _dim = new PIXI.Graphics();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.eventMode = 'static';
    this.addChild(this._dim);
    this.addChild(this._root);
    this._dim.eventMode = 'static';
    this._dim.on('pointertap', () => this.close());
    this._root.eventMode = 'static';
    this._root.on('pointertap', (e: PIXI.FederatedPointerEvent) => e.stopPropagation());
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!Platform.isDouyin) return;
    if (!this._isOpen) AudioManager.play('ui_click');
    this._isOpen = true;
    this.visible = true;
    DesktopEntry.refreshStatus();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
  }

  refreshIfOpen(): void {
    if (this._isOpen) this.relayout();
  }

  relayout(): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this._dim.clear();
    fillRect(this._dim, 0, 0, w, h, 0x160E08);
    this._dim.alpha = 0.56;

    this._root.removeChildren();
    if (!this._isOpen) return;

    watchTextures([UI_KIT.headerRibbon, UI_KIT.closeRound, UI_KIT.btnOlive, UI_KIT.btnGold], () => {
      if (this._isOpen) this.relayout();
    });

    const contentTop = 88;
    const padX = 26;
    const cardW = PANEL_W - padX * 2;
    const sidebarCard = this._buildSidebarCard(cardW);
    const sidebarH = (sidebarCard as any)._cardH as number;
    const desktopCard = this._buildDesktopCard(cardW);
    const desktopH = (desktopCard as any)._cardH as number;

    const panelH = contentTop + sidebarH + 14 + desktopH + 28;
    const { shell } = makeArtisanShell({
      width: PANEL_W,
      height: panelH,
      title: '抖 音 福 利',
      subtitle: '每日复访与桌面快捷入口专享赏金',
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this.close(),
    });
    this._root.addChild(shell);

    sidebarCard.position.set(padX, contentTop);
    desktopCard.position.set(padX, contentTop + sidebarH + 14);
    shell.addChild(sidebarCard, desktopCard);

    this._root.hitArea = new PIXI.Rectangle(0, 0, PANEL_W, panelH);
    this._root.position.set(Math.round((w - PANEL_W) / 2), Math.round(Math.max(Game.safeTop + 26, (h - panelH) / 2)));
  }

  private _buildSidebarCard(cardW: number): PIXI.Container {
    const claimed = DouyinWelfareManager.sidebarClaimedToday;
    const fromSidebar = SidebarEntry.isFromSidebar();
    const wrap = new PIXI.Container();
    const showSteps = !fromSidebar || claimed;
    const cardH = showSteps ? 286 : 168;

    const bg = new PIXI.Graphics();
    drawCraftCard(bg, 0, 0, cardW, cardH, { radius: 18, tone: fromSidebar && !claimed ? 'gold' : 'ivory' });
    wrap.addChild(bg);

    const head = makeLabel('侧边栏复访礼', 23, INK, { fontWeight: '700' });
    head.position.set(20, 16);
    wrap.addChild(head);

    const sub = makeLabel(`每日一次 · 立领 +${DOUYIN_WELFARE.sidebarCoins} 金币`, 17, 0xB87910, { fontWeight: '700' });
    sub.position.set(20, 50);
    wrap.addChild(sub);

    let btnY = 92;
    if (showSteps) {
      const well = new PIXI.Graphics();
      drawRecessedWell(well, 18, 84, cardW - 36, 114, { radius: 14 });
      wrap.addChild(well);
      SIDEBAR_STEPS.forEach((text, i) => {
        const row = makeLabel(`${i + 1}. ${text}`, 18, MUTED, { fontWeight: '600' });
        row.position.set(34, 96 + i * 32);
        wrap.addChild(row);
      });
      btnY = 212;
    }

    const label = claimed ? '今日已领取' : fromSidebar ? '领取金币奖励' : '去侧边栏';
    const btn = makeSlicedButton({
      label,
      width: cardW - 36,
      height: 54,
      skin: claimed ? 'cream' : fromSidebar ? 'olive' : 'terracotta',
      textColor: claimed ? 0x8A7358 : 0xFFF8F0,
      silent: claimed,
    });
    btn.position.set(18, btnY);
    btn.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      this._onSidebarTap();
    });
    wrap.addChild(btn);
    (wrap as any)._cardH = cardH;
    return wrap;
  }

  private _buildDesktopCard(cardW: number): PIXI.Container {
    const claimed = DouyinWelfareManager.desktopRewardClaimed;
    const ready = DesktopEntry.alreadyAdded && !claimed;
    const wrap = new PIXI.Container();
    const cardH = 168;

    const bg = new PIXI.Graphics();
    drawCraftCard(bg, 0, 0, cardW, cardH, { radius: 18, tone: ready ? 'gold' : 'ivory' });
    wrap.addChild(bg);

    const head = makeLabel('添加到手机桌面', 23, INK, { fontWeight: '700' });
    head.position.set(20, 16);
    wrap.addChild(head);

    const sub = makeLabel(`首次添加专享 · 立领 +${DOUYIN_WELFARE.desktopCoins} 金币`, 17, 0xB87910, { fontWeight: '700' });
    sub.position.set(20, 50);
    wrap.addChild(sub);

    const label = claimed ? '已领取' : ready ? '领取金币奖励' : '添加到桌面';
    const btn = makeSlicedButton({
      label,
      width: cardW - 36,
      height: 54,
      skin: claimed ? 'cream' : ready ? 'olive' : 'terracotta',
      textColor: claimed ? 0x8A7358 : 0xFFF8F0,
      silent: claimed,
    });
    btn.position.set(18, 94);
    btn.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      this._onDesktopTap();
    });
    wrap.addChild(btn);
    (wrap as any)._cardH = cardH;
    return wrap;
  }

  private _onSidebarTap(): void {
    if (DouyinWelfareManager.sidebarClaimedToday) {
      Platform.showToast('今日奖励已领取');
      return;
    }
    if (SidebarEntry.isFromSidebar()) {
      if (DouyinWelfareManager.claimSidebarReward()) this.relayout();
      return;
    }
    SidebarEntry.navigate({
      onFail: () => Platform.showToast('请从抖音首页侧边栏进入'),
    });
  }

  private _onDesktopTap(): void {
    if (DouyinWelfareManager.desktopRewardClaimed) {
      Platform.showToast('桌面奖励已领取');
      return;
    }
    if (DesktopEntry.alreadyAdded) {
      if (DouyinWelfareManager.claimDesktopReward()) this.relayout();
      return;
    }
    const started = DesktopEntry.add({
      onSuccess: () => {
        DouyinWelfareManager.claimDesktopReward();
        if (this._isOpen) this.relayout();
      },
      onFail: () => Platform.showToast('添加失败，请重试'),
    });
    if (!started) Platform.showToast('当前环境不支持添加到桌面');
  }
}
