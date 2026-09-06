import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { GAME_CLUB_DAILY_COINS } from '@/sim';
import { fetchDailyPostCount, isGameClubButtonSupported } from '@/services/GameClubService';
import { HUD_ICON, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

const BG = 'subpkg_kitchen/ui_gameclub_panel.png';
const INK = 0x2A2018;
const PAPER = 0xFFF8F0;
const WALNUT = 0x8B5A2B;
const ACCENT = 0xC46A3A;
const GOLD = 0xD4922A;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';

/** 贴图实测锚点：标题牌 / 气泡白底（不含左尾）/ 木条 / 底栏，相对整板。 */
const ART = {
  title: { cx: 0.494, cy: 0.136 },
  close: { cx: 0.858, cy: 0.156 },
  bubble: { x: 0.522, y: 0.282, w: 0.328, h: 0.292 },
  plank: { x: 0.130, y: 0.610, w: 0.740, cy: 0.692 },
  enter: { cy: 0.858 },
} as const;

export class GameClubPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _enterRoot: PIXI.Container | null = null;
  private _postCount = 0;
  private _refreshing = false;
  private _lastErrorToastAt = 0;
  private _gameClubButton: { show?: () => void; hide?: () => void; destroy?: () => void; style?: Record<string, unknown> } | null = null;
  private readonly _returnTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly _onWxShow = (): void => {
    if (!this._isOpen) return;
    this._scheduleReturnRefreshes();
  };

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 27;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    try { Platform.api?.onShow?.(this._onWxShow); } catch (_) {}
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_click');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    void this._refreshStatus();
    this._syncNativeButton();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._clearReturnTimers();
    this._destroyNativeButton();
  }

  relayout(): void {
    this._root.removeChildren();
    this._enterRoot = null;
    if (!this._isOpen) {
      this._destroyNativeButton();
      return;
    }
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.48;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    whenTextureReady(BG, () => {
      if (this._isOpen) this.relayout();
    });
    whenTextureReady(HUD_ICON.coin, () => {
      if (this._isOpen) this.relayout();
    });

    const box = this._panelBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);
    this._paintBg(shell, box.w, box.h);

    const title = makeLabel('游戏圈', Math.round(box.w * 0.078), INK, {
      fontWeight: '700',
      fontFamily: TITLE_FONT,
    });
    title.anchor.set(0.5);
    title.position.set(box.w * ART.title.cx, box.h * ART.title.cy);
    shell.addChild(title);

    const close = this._closeHit(box.w, box.h);
    shell.addChild(close);

    this._drawLine(shell, box.w, box.h);
    this._drawTask(shell, box.w, box.h);
    this._drawEnter(shell, box.w, box.h);
    this._syncNativeButton();
  }

  private _panelBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(BG);
    const marginX = 28;
    const top = Game.safeTop + 12;
    const bottom = 16;
    const maxW = Math.min(screenW - marginX * 2, 560);
    const maxH = screenH - top - bottom;
    const tw = isTextureReady(tex) ? tex.width : 527;
    const th = isTextureReady(tex) ? tex.height : 720;
    const scale = Math.min(maxW / tw, maxH / th);
    const w = tw * scale;
    const h = th * scale;
    return { x: (screenW - w) / 2, y: top + (maxH - h) / 2, w, h };
  }

  private _paintBg(host: PIXI.Container, width: number, height: number): void {
    const tex = gameTexture(BG);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = width;
      sp.height = height;
      sp.eventMode = 'none';
      host.addChild(sp);
      return;
    }
    const g = new PIXI.Graphics();
    g.beginFill(0x8B5A2B);
    g.drawRoundedRect(0, 0, width, height, 28);
    g.endFill();
    g.beginFill(0xF3E6D0);
    g.drawRoundedRect(width * 0.06, height * 0.07, width * 0.88, height * 0.86, 18);
    g.endFill();
    host.addChild(g);
  }

  private _closeHit(pw: number, ph: number): PIXI.Container {
    const r = Math.max(18, pw * 0.045);
    const root = new PIXI.Container();
    root.position.set(pw * ART.close.cx, ph * ART.close.cy);
    const mark = makeLabel('×', Math.round(r * 1.35), PAPER, { fontWeight: '700' });
    mark.anchor.set(0.5);
    mark.eventMode = 'none';
    root.addChild(mark);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(0, 0, r);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.close();
    });
    return root;
  }

  private _drawLine(shell: PIXI.Container, pw: number, ph: number): void {
    const boxX = pw * ART.bubble.x;
    const boxY = ph * ART.bubble.y;
    const boxW = pw * ART.bubble.w;
    const boxH = ph * ART.bubble.h;
    const size = Math.round(pw * 0.048);
    const prizeSize = Math.round(size * 1.16);
    const rows: Array<{ text: string; color: number; size: number }> = [
      { text: '每日去游戏圈', color: ACCENT, size },
      { text: '发个帖，', color: ACCENT, size },
      { text: '回来就能领', color: ACCENT, size },
      { text: `${GAME_CLUB_DAILY_COINS} 金币`, color: GOLD, size: prizeSize },
    ];
    const stack = new PIXI.Container();
    let y = 0;
    for (const row of rows) {
      const label = makeLabel(row.text, row.size, row.color, {
        fontWeight: '700',
        fontFamily: TITLE_FONT,
        align: 'center',
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, y);
      label.eventMode = 'none';
      stack.addChild(label);
      y += Math.round(row.size * 1.32);
    }
    stack.position.set(boxX + boxW / 2, boxY + boxH / 2 - y / 2);
    stack.eventMode = 'none';
    shell.addChild(stack);
  }

  private _drawTask(shell: PIXI.Container, pw: number, ph: number): void {
    const claimed = KitchenManager.hasClaimedGameClubToday();
    const claimable = KitchenManager.canClaimGameClub(this._postCount);
    const done = Math.min(1, this._postCount);
    const left = pw * ART.plank.x;
    const width = pw * ART.plank.w;
    const midY = ph * ART.plank.cy;

    const reward = new PIXI.Container();
    const coinTex = gameTexture(HUD_ICON.coin);
    let rewardW = 0;
    if (isTextureReady(coinTex)) {
      const spr = new PIXI.Sprite(coinTex);
      fitSpriteInBox(spr, 34, 34);
      spr.anchor.set(0.5);
      spr.position.set(17, 0);
      spr.eventMode = 'none';
      reward.addChild(spr);
      rewardW = 34;
    }
    const amt = makeLabel(`${GAME_CLUB_DAILY_COINS}`, Math.round(pw * 0.048), WALNUT, { fontWeight: '700' });
    amt.anchor.set(0, 0.5);
    amt.position.set(rewardW + 6, 1);
    amt.eventMode = 'none';
    reward.addChild(amt);
    reward.position.set(left, midY);
    shell.addChild(reward);

    const barW = Math.round(width * 0.32);
    const barH = 26;
    const barX = left + width * 0.36;
    const track = new PIXI.Graphics();
    fillRect(track, 0, -barH / 2, barW, barH, 0xD8C4A4, 13);
    const fill = new PIXI.Graphics();
    fillRect(fill, 0, -barH / 2, Math.max(0, barW * done), barH, 0xE8A04A, 13);
    const prog = makeLabel(`${done}/1`, 18, INK, { fontWeight: '700' });
    prog.anchor.set(0.5);
    prog.position.set(barW / 2, 1);
    track.eventMode = 'none';
    fill.eventMode = 'none';
    prog.eventMode = 'none';
    const bar = new PIXI.Container();
    bar.addChild(track, fill, prog);
    bar.position.set(barX, midY);
    shell.addChild(bar);

    const claimW = Math.min(120, Math.round(width * 0.28));
    const claimH = 46;
    const claim = makeSlicedButton({
      label: claimed ? '已领取' : '领取',
      width: claimW,
      height: claimH,
      skin: claimable ? 'terracotta' : 'wood',
      textColor: PAPER,
      silent: true,
    });
    claim.position.set(left + width - claimW, midY - claimH / 2);
    claim.alpha = claimable ? 1 : 0.55;
    claim.eventMode = claimable ? 'static' : 'none';
    claim.cursor = claimable ? 'pointer' : 'default';
    claim.on('pointertap', (e) => {
      e.stopPropagation();
      this._handleClaim();
    });
    shell.addChild(claim);
  }

  private _drawEnter(shell: PIXI.Container, pw: number, ph: number): void {
    const btnW = Math.min(pw * 0.62, 320);
    const btnH = 56;
    const enter = makeSlicedButton({
      label: '进入游戏圈',
      width: btnW,
      height: btnH,
      skin: 'terracotta',
      textColor: PAPER,
      silent: true,
    });
    enter.position.set((pw - btnW) / 2, ph * ART.enter.cy - btnH / 2);
    enter.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      if (isGameClubButtonSupported()) {
        this._syncNativeButton(true);
        Platform.showToast('请再点一次进入游戏圈');
        return;
      }
      Platform.showToast('游戏圈仅微信内可用');
    });
    this._enterRoot = enter;
    shell.addChild(enter);
  }

  private _handleClaim(): void {
    if (!KitchenManager.canClaimGameClub(this._postCount)) {
      if (this._postCount < 1) Platform.showToast('请先在游戏圈发帖');
      else if (KitchenManager.hasClaimedGameClubToday()) Platform.showToast('今日奖励已领取');
      return;
    }
    if (!KitchenManager.claimGameClubDaily(this._postCount)) return;
    this.relayout();
  }

  private async _refreshStatus(): Promise<void> {
    if (this._refreshing || !this._isOpen) return;
    this._refreshing = true;
    try {
      const status = await fetchDailyPostCount();
      if (!this._isOpen) return;
      this._postCount = status.postCount;
      if (status.error) this._toastError(status.error);
      this.relayout();
      if (this._postCount >= 1) this._clearReturnTimers();
    } finally {
      this._refreshing = false;
    }
  }

  private _scheduleReturnRefreshes(): void {
    this._clearReturnTimers();
    for (const delayMs of [0, 1500, 4000, 8000]) {
      this._returnTimers.push(setTimeout(() => {
        if (!this._isOpen) return;
        void this._refreshStatus();
      }, delayMs));
    }
  }

  private _clearReturnTimers(): void {
    while (this._returnTimers.length) {
      const t = this._returnTimers.pop();
      if (t) clearTimeout(t);
    }
  }

  private _toastError(error: string): void {
    const now = Date.now();
    if (now - this._lastErrorToastAt < 5000) return;
    this._lastErrorToastAt = now;
    Platform.showToast(error);
  }

  private _enterRectPx(): { left: number; top: number; width: number; height: number } | null {
    const root = this._enterRoot;
    if (!root) return null;
    const bounds = root.hitArea instanceof PIXI.Rectangle
      ? root.hitArea
      : root.getLocalBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const topLeft = root.toGlobal(new PIXI.Point(bounds.x, bounds.y));
    const bottomRight = root.toGlobal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));
    return {
      left: Math.round(topLeft.x / Game.dpr),
      top: Math.round(topLeft.y / Game.dpr),
      width: Math.max(1, Math.round((bottomRight.x - topLeft.x) / Game.dpr)),
      height: Math.max(1, Math.round((bottomRight.y - topLeft.y) / Game.dpr)),
    };
  }

  private _canSyncNative(): boolean {
    if (!this._isOpen || !this.visible || !this.parent) return false;
    let node: PIXI.DisplayObject | null = this;
    while (node) {
      if (node === Game.stage) return true;
      node = node.parent;
    }
    return false;
  }

  private _ensureNativeButton(): void {
    const api = Platform.api;
    if (this._gameClubButton || !api?.createGameClubButton) return;
    const rect = this._enterRectPx();
    if (!rect) return;
    try {
      const btn = api.createGameClubButton({
        type: 'text',
        text: ' ',
        style: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          backgroundColor: 'rgba(0,0,0,0.01)',
          borderColor: 'rgba(0,0,0,0)',
          borderWidth: 0,
          borderRadius: Math.round(rect.height / 2),
          color: 'rgba(0,0,0,0)',
          textAlign: 'center',
          fontSize: 12,
          lineHeight: rect.height,
        },
      });
      this._gameClubButton = btn;
      btn?.hide?.();
    } catch (error) {
      console.warn('[GameClubPanel] createGameClubButton failed', error);
      this._destroyNativeButton();
    }
  }

  private _destroyNativeButton(): void {
    if (this._enterRoot) {
      this._enterRoot.eventMode = 'static';
      this._enterRoot.cursor = 'pointer';
    }
    if (!this._gameClubButton) return;
    try { this._gameClubButton.hide?.(); } catch (_) {}
    try { this._gameClubButton.destroy?.(); } catch (error) {
      console.warn('[GameClubPanel] destroy game club button failed', error);
    }
    this._gameClubButton = null;
  }

  private _syncNativeButton(forceInteractive = false): void {
    const api = Platform.api;
    if (!this._canSyncNative() || !api?.createGameClubButton) {
      this._destroyNativeButton();
      return;
    }
    this._ensureNativeButton();
    if (!this._gameClubButton) return;
    const rect = this._enterRectPx();
    if (!rect) {
      this._destroyNativeButton();
      return;
    }
    try {
      if (this._gameClubButton.style) {
        Object.assign(this._gameClubButton.style, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          borderRadius: Math.round(rect.height / 2),
          lineHeight: rect.height,
        });
      }
      this._gameClubButton.show?.();
      if (this._enterRoot) {
        this._enterRoot.eventMode = forceInteractive ? 'static' : 'none';
        this._enterRoot.cursor = forceInteractive ? 'pointer' : 'default';
      }
    } catch (error) {
      console.warn('[GameClubPanel] sync game club button failed', error);
      this._destroyNativeButton();
    }
  }
}
