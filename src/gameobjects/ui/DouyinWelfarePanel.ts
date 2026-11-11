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
import { fillRect, makeLabel } from '@/utils/ui';

const PANEL_W = 640;
const INK = 0x2A2018;
const PAPER = 0xFFF8F0;
const WALNUT = 0x8B5A2B;
const ACCENT = 0xC46A3A;

const SIDEBAR_STEPS = [
  '点击抖音首页侧边栏',
  `点击「${DOUYIN_GAME_NAME}」`,
  '回到游戏领取金币',
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
    fillRect(this._dim, 0, 0, w, h, 0x2A2018);
    this._dim.alpha = 0.55;

    this._root.removeChildren();
    if (!this._isOpen) return;

    const sidebarH = this._addSidebarCard(0);
    const desktopH = this._addDesktopCard(sidebarH + 16);
    const panelH = desktopH + 28;
    const bg = new PIXI.Graphics();
    fillRect(bg, 0, 0, PANEL_W, panelH, PAPER, 28);
    bg.eventMode = 'none';
    this._root.addChildAt(bg, 0);

    const title = makeLabel('抖音福利', 36, INK, { fontWeight: '700' });
    title.anchor.set(0.5, 0);
    title.position.set(PANEL_W / 2, 28);
    this._root.addChild(title);

    const close = this._textButton('关闭', PANEL_W - 108, 24, 88, 44, WALNUT, () => this.close());
    this._root.addChild(close);

    this._root.hitArea = new PIXI.Rectangle(0, 0, PANEL_W, panelH);
    this._root.position.set((w - PANEL_W) / 2, Math.max(Game.safeTop + 24, (h - panelH) / 2));
  }

  private _addSidebarCard(y: number): number {
    const claimed = DouyinWelfareManager.sidebarClaimedToday;
    const fromSidebar = SidebarEntry.isFromSidebar();
    const x = 28;
    const cardW = PANEL_W - 56;
    let cursor = y + 96;
    const head = makeLabel('侧边栏进入', 28, INK, { fontWeight: '700' });
    head.position.set(x, cursor);
    this._root.addChild(head);
    cursor += 40;
    const sub = makeLabel(`每日一次 · ${DOUYIN_WELFARE.sidebarCoins} 金币`, 22, WALNUT);
    sub.position.set(x, cursor);
    this._root.addChild(sub);
    cursor += 40;

    if (!fromSidebar || claimed) {
      SIDEBAR_STEPS.forEach((text, i) => {
        const row = makeLabel(`${i + 1}. ${text}`, 22, INK);
        row.position.set(x, cursor);
        this._root.addChild(row);
        cursor += 34;
      });
      cursor += 8;
    }

    const label = claimed ? '今日已领' : fromSidebar ? '领取奖励' : '去侧边栏';
    const btn = this._textButton(label, x, cursor, cardW, 64, claimed ? 0xB7A898 : ACCENT, () => {
      this._onSidebarTap();
    });
    this._root.addChild(btn);
    cursor += 80;
    return cursor;
  }

  private _addDesktopCard(y: number): number {
    const claimed = DouyinWelfareManager.desktopRewardClaimed;
    const x = 28;
    const cardW = PANEL_W - 56;
    let cursor = y;
    const head = makeLabel('添加到桌面', 28, INK, { fontWeight: '700' });
    head.position.set(x, cursor);
    this._root.addChild(head);
    cursor += 40;
    const sub = makeLabel(`只领一次 · ${DOUYIN_WELFARE.desktopCoins} 金币`, 22, WALNUT);
    sub.position.set(x, cursor);
    this._root.addChild(sub);
    cursor += 48;
    const label = claimed
      ? '已领取'
      : DesktopEntry.alreadyAdded ? '领取奖励' : '添加到桌面';
    const btn = this._textButton(label, x, cursor, cardW, 64, claimed ? 0xB7A898 : ACCENT, () => {
      this._onDesktopTap();
    });
    this._root.addChild(btn);
    return cursor + 80;
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

  private _textButton(
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    onTap: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(x, y);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const bg = new PIXI.Graphics();
    fillRect(bg, 0, 0, w, h, color, 16);
    const label = makeLabel(text, 26, 0xFFF8F0, { fontWeight: '700' });
    label.anchor.set(0.5);
    label.position.set(w / 2, h / 2);
    root.addChild(bg, label);
    root.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      onTap();
    });
    return root;
  }
}
