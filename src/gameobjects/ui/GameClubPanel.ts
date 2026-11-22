import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { dailyGameClubPack, itemRarity } from '@/sim';
import { fetchDailyPostCount, isGameClubButtonSupported } from '@/services/GameClubService';
import { HUD_ICON, drawItemSlotBox, fillRect, makeLabel, makeSlicedButton, makeSlotBadge } from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady, itemTexture, watchTextures, whenTextureReady } from '@/utils/assets';
import { PANEL_SHELL, itemIconPath } from '@/utils/panelAssets';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';

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
    if (!Platform.isWechat) {
      Platform.showToast('游戏圈仅微信内可用');
      return;
    }
    if (!this._isOpen) AudioManager.play('ui_click');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    watchTextures([...PANEL_SHELL.gameClub], () => {
      if (this._isOpen) this.relayout();
    });
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

    const pack = dailyGameClubPack(KitchenManager.save);
    watchTextures(
      [BG, HUD_ICON.ticket, HUD_ICON.coin, ...pack.foods.map((f) => itemIconPath(f.defId))],
      () => {
        if (this._isOpen) this.relayout();
      },
    );

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
    const pack = dailyGameClubPack(KitchenManager.save);
    const foodNames = pack.foods.map((f) => (f.qty > 1 ? `${f.name}×${f.qty}` : f.name)).join('、');
    const boxX = pw * ART.bubble.x;
    const boxY = ph * ART.bubble.y;
    const boxW = pw * ART.bubble.w;
    const boxH = ph * ART.bubble.h;
    const size = Math.round(pw * 0.041);
    const prizeSize = Math.round(pw * 0.044);
    const rows: Array<{ text: string; color: number; size: number }> = [
      { text: '每日去游戏圈晒晒菜', color: ACCENT, size },
      { text: '回来领鲜货补给包：', color: WALNUT, size },
      { text: foodNames, color: GOLD, size: prizeSize },
      { text: `+ 菜谱券 ×${pack.tickets}`, color: ACCENT, size: prizeSize },
    ];
    const stack = new PIXI.Container();
    let y = 0;
    for (const row of rows) {
      const label = makeLabel(row.text, row.size, row.color, {
        fontWeight: '700',
        fontFamily: TITLE_FONT,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: boxW - 10,
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, y);
      label.eventMode = 'none';
      stack.addChild(label);
      y += Math.round(label.height + 4);
    }
    stack.position.set(boxX + boxW / 2, boxY + boxH / 2 - y / 2);
    stack.eventMode = 'none';
    shell.addChild(stack);
  }

  private _drawTask(shell: PIXI.Container, pw: number, ph: number): void {
    const pack = dailyGameClubPack(KitchenManager.save);
    const claimed = KitchenManager.hasClaimedGameClubToday();
    const claimable = KitchenManager.canClaimGameClub(this._postCount);
    const done = Math.min(1, this._postCount);
    const left = pw * ART.plank.x;
    const width = pw * ART.plank.w;
    const midY = ph * ART.plank.cy;

    // Left: tactile slot tiles for today's 2 rare/epic foods + 1 recipe ticket
    const reward = new PIXI.Container();
    const slotSize = Math.min(48, Math.round(width * 0.118));
    const slotGap = 5;
    let sx = 0;
    for (const f of pack.foods) {
      const slot = new PIXI.Container();
      slot.position.set(sx, -slotSize / 2);
      const sg = new PIXI.Graphics();
      drawItemSlotBox(sg, 0, 0, slotSize, slotSize, {
        radius: 9,
        rarity: itemRarity(f.defId),
        dimmed: claimed,
      });
      slot.addChild(sg);
      const tex = itemTexture(f.defId);
      if (isTextureReady(tex)) {
        const spr = new PIXI.Sprite(tex);
        fitSpriteInBox(spr, slotSize - 8, slotSize - 8);
        spr.anchor.set(0.5);
        spr.position.set(slotSize / 2, slotSize / 2);
        slot.addChild(spr);
      }
      if (f.qty > 1) {
        const b = makeSlotBadge(`×${f.qty}`, 'olive', 10);
        b.node.position.set(slotSize - b.w + 2, slotSize - b.h + 2);
        slot.addChild(b.node);
      }
      reward.addChild(slot);
      sx += slotSize + slotGap;
    }
    // Recipe ticket slot
    const tSlot = new PIXI.Container();
    tSlot.position.set(sx, -slotSize / 2);
    const tg = new PIXI.Graphics();
    drawItemSlotBox(tg, 0, 0, slotSize, slotSize, {
      radius: 9,
      rarity: 'epic',
      dimmed: claimed,
    });
    tSlot.addChild(tg);
    const ticketTex = gameTexture(HUD_ICON.ticket);
    if (isTextureReady(ticketTex)) {
      const tspr = new PIXI.Sprite(ticketTex);
      fitSpriteInBox(tspr, slotSize - 8, slotSize - 8);
      tspr.anchor.set(0.5);
      tspr.position.set(slotSize / 2, slotSize / 2);
      tSlot.addChild(tspr);
    }
    const tb = makeSlotBadge(`×${pack.tickets}`, 'gold', 10);
    tb.node.position.set(slotSize - tb.w + 2, slotSize - tb.h + 2);
    tSlot.addChild(tb.node);
    reward.addChild(tSlot);
    sx += slotSize;

    reward.position.set(left, midY);
    reward.eventMode = 'none';
    shell.addChild(reward);

    const claimW = Math.min(112, Math.round(width * 0.26));
    const barX = left + sx + 10;
    const barW = Math.max(54, Math.round(width - sx - claimW - 20));
    const barH = 24;
    const track = new PIXI.Graphics();
    fillRect(track, 0, -barH / 2, barW, barH, 0xD8C4A4, 12);
    const fill = new PIXI.Graphics();
    fillRect(fill, 0, -barH / 2, Math.max(0, barW * done), barH, 0xE8A04A, 12);
    const prog = makeLabel(`${done}/1`, 16, INK, { fontWeight: '700' });
    prog.anchor.set(0.5);
    prog.position.set(barW / 2, 1);
    track.eventMode = 'none';
    fill.eventMode = 'none';
    prog.eventMode = 'none';
    const bar = new PIXI.Container();
    bar.addChild(track, fill, prog);
    bar.position.set(barX, midY);
    shell.addChild(bar);

    const claimH = 46;
    const claim = makeSlicedButton({
      label: claimed ? '已领取' : '领补给',
      width: claimW,
      height: claimH,
      skin: claimable ? 'terracotta' : 'wood',
      textColor: PAPER,
      fontSize: 18,
      silent: true,
    });
    claim.position.set(left + width - claimW, midY - claimH / 2);
    claim.alpha = claimable ? 1 : 0.55;
    claim.eventMode = claimable ? 'static' : 'none';
    claim.cursor = claimable ? 'pointer' : 'default';
    claim.on('pointertap', (e) => {
      e.stopPropagation();
      this._handleClaim({ x: e.global.x, y: e.global.y });
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

  private _handleClaim(from?: { x: number; y: number }): void {
    if (!KitchenManager.canClaimGameClub(this._postCount)) {
      if (this._postCount < 1) Platform.showToast('请先在游戏圈发帖');
      else if (KitchenManager.hasClaimedGameClubToday()) Platform.showToast('今日奖励已领取');
      return;
    }
    const res = KitchenManager.claimGameClubDaily(this._postCount);
    if (!res.ok) return;
    const origin = from ?? { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.62) };
    const firstFood = res.foods.find((f) => !f.folded);
    playRewardCollect({
      gold: res.foldGold,
      foodDefId: firstFood?.defId,
      foodFolded: !firstFood && res.foldGold > 0,
      from: origin,
    });
    if (res.tickets > 0) {
      playTicketCollect(origin, kitchenGachaHudPos(), 0.08);
    }
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
