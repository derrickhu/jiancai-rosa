import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { TutorialOverlay } from '@/gameobjects/ui/TutorialOverlay';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import { dailyGameClubPack } from '@/sim';
import { fetchDailyPostCount, isGameClubButtonSupported } from '@/services/GameClubService';
import {
  HUD_ICON,
  UI_KIT,
  fitTextWidth,
  makeHandProgressBar,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  watchTextures,
} from '@/utils/assets';
import { PANEL_SHELL, itemIconPath } from '@/utils/panelAssets';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
import {
  inspectFromItem,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';
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
  flare: 'subpkg_kitchen/ui_pickup_flare.png',
} as const;

const W = 720;
const H = 1036;

export class GameClubPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _enterRoot: PIXI.Container | null = null;
  private _postCount = 0;
  private _refreshing = false;
  private _paintQueued = false;
  private _inspect: ItemInspectView | null = null;
  private _lastErrorToastAt = 0;
  private _gameClubButton: {
    show?: () => void;
    hide?: () => void;
    destroy?: () => void;
    style?: Record<string, unknown>;
  } | null = null;
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
    this._inspect = null;
    this.relayout();
    OverlayManager.bringToFront();
    void this._refreshStatus();
    this._syncNativeButton();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._paintQueued = false;
    this._clearReturnTimers();
    this._destroyNativeButton();
    this._root.removeChildren();
    TutorialOverlay.refresh();
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
    this._enterRoot = null;
    if (!this._isOpen) {
      this._destroyNativeButton();
      return;
    }

    const pack = dailyGameClubPack(KitchenManager.save);
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        ...uiBarPaths(),
        ...PANEL_SHELL.gameClub,
        UI_KIT.closeRound,
        UI_KIT.btnOlive,
        HUD_ICON.ticket,
        HUD_ICON.coin,
        ...pack.foods.map((f) => itemIconPath(f.defId)),
      ],
      this._scheduleRelayout,
    );

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const { scene, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: H,
      topBleed: 44,
      dimAlpha: 0.66,
      onDimTap: () => {
        if (this._inspect) {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
          return;
        }
        this.close();
      },
    });

    // 木框软木公告栏底图
    drawSceneWall(scene, ART.board, W, H, 200, 180, 0x8B5A2B);
    drawPlaqueTitle(scene, '街坊游戏圈', W / 2, -42, 348);
    drawSceneClose(
      scene,
      W - 54,
      -18,
      () => {
        if (this._inspect) {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
          return;
        }
        this.close();
      },
      this._scheduleRelayout,
    );

    // 钉选大号便签纸（保留顶部中央红图钉 y:0..110 与卷角底，正文全部从 noteY+138 起排）
    const noteX = 64;
    const noteY = 112;
    const noteW = W - noteX * 2;
    const noteH = 712;
    drawStretchSheet(scene, ART.note, noteX, noteY, noteW, noteH, 128, 125, 0xF7EAD0);

    const cx = W / 2;
    const head = makeText('display', '每日晒菜 · 领鲜货补给篮', SCENE_INK.ink, { size: 33 });
    head.anchor.set(0.5);
    head.position.set(cx, noteY + 138);
    fitTextWidth(head, noteW - 88);
    scene.addChild(head);

    const sub = makeText(
      'body',
      '去微信游戏圈发帖晒晒拿手好菜，回来即领今日鲜货礼！',
      SCENE_INK.soft,
      { size: 23 },
    );
    sub.anchor.set(0.5);
    sub.position.set(cx, noteY + 184);
    fitTextWidth(sub, noteW - 88);
    scene.addChild(sub);

    drawInkDivider(scene, noteX + 48, noteY + 212, noteW - 96, 0.5, 10);

    // 福利竹编礼篮（底沿位于 noteY+463，下方清单位于 noteY+508 留出近 30px 呼吸间距）
    this._drawGiftBasket(scene, pack, cx, noteY + 332);

    const foodNames = pack.foods.map((f) => (f.qty > 1 ? `${f.name}×${f.qty}` : f.name)).join('、');
    const manifest = makeText(
      'heading',
      `今日礼篮：${foodNames}  +  菜谱券 ×${pack.tickets}`,
      SCENE_INK.gold,
      { size: 24 },
    );
    manifest.anchor.set(0.5);
    manifest.position.set(cx, noteY + 508);
    fitTextWidth(manifest, noteW - 88);
    scene.addChild(manifest);

    drawInkDivider(scene, noteX + 48, noteY + 540, noteW - 96, 0.45, 9);

    // 任务发帖进度 + 拎走礼篮按钮
    this._drawTaskProgress(scene, noteX, noteY + 562, noteW, toStage);

    // 底部进入微信游戏圈主按钮（对齐原生透明按钮）
    this._drawEnterButton(scene);

    if (this._inspect) {
      this._destroyNativeButton();
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onReady: this._scheduleRelayout,
        onClose: () => {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
        },
      }));
    } else {
      this._syncNativeButton();
    }
  }

  private _drawGiftBasket(
    scene: PIXI.Container,
    pack: ReturnType<typeof dailyGameClubPack>,
    cx: number,
    basketCy: number,
  ): void {
    const claimed = KitchenManager.hasClaimedGameClubToday();

    const flare = makeRarityFlare('epic', 310);
    flare.alpha = claimed ? 0.25 : 0.58;
    flare.position.set(cx, basketCy - 38);
    scene.addChild(flare);

    const basket = sceneSprite(ART.basket, 356, 238);
    if (basket) {
      basket.anchor.set(0.5);
      basket.position.set(cx, basketCy + 16);
      if (claimed) basket.alpha = 0.72;
      scene.addChild(basket);
    }

    // 篮中实物（2 味珍稀鲜货 + 菜谱券，点击食材可看详情）
    const totalItems = pack.foods.length + 1;
    const stepX = 104;
    const startX = cx - ((totalItems - 1) * stepX) / 2;
    const itemCy = basketCy - 34;

    pack.foods.forEach((f, idx) => {
      const ix = startX + idx * stepX;
      const node = new PIXI.Container();
      node.position.set(ix, itemCy);

      const tex = itemTexture(f.defId);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, 86, 86);
        sp.anchor.set(0.5);
        node.addChild(sp);
      }
      if (f.qty > 1) {
        const q = makeText('number', `×${f.qty}`, SCENE_INK.red, {
          size: 24,
          stroke: 0xFFF8EA,
          strokeWidth: 5,
        });
        q.anchor.set(1, 1);
        q.position.set(44, 42);
        node.addChild(q);
      }
      if (claimed) node.alpha = 0.56;

      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.hitArea = new PIXI.Rectangle(-48, -48, 96, 96);
      node.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        const v = inspectFromItem(f.defId);
        if (v) v.note = `${v.note ?? ''} · 游戏圈每日鲜货补给`;
        this._inspect = v;
        this.relayout();
      });
      scene.addChild(node);
    });

    // 菜谱券实物
    const tx = startX + pack.foods.length * stepX;
    const ticketNode = new PIXI.Container();
    ticketNode.position.set(tx, itemCy + 2);
    const tSp = sceneSprite(HUD_ICON.ticket, 82, 74);
    if (tSp) {
      tSp.anchor.set(0.5);
      ticketNode.addChild(tSp);
    }
    const tq = makeText('number', `×${pack.tickets}`, SCENE_INK.gold, {
      size: 24,
      stroke: 0xFFF8EA,
      strokeWidth: 5,
    });
    tq.anchor.set(1, 1);
    tq.position.set(44, 40);
    ticketNode.addChild(tq);
    if (claimed) ticketNode.alpha = 0.56;
    scene.addChild(ticketNode);
  }

  private _drawTaskProgress(
    scene: PIXI.Container,
    noteX: number,
    topY: number,
    noteW: number,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    const claimed = KitchenManager.hasClaimedGameClubToday();
    const claimable = KitchenManager.canClaimGameClub(this._postCount);
    const done = Math.min(1, this._postCount);

    const leftX = noteX + 48;
    const rightX = noteX + noteW - 48;
    const statusText = claimed
      ? '今日补给已入库'
      : claimable
        ? '发帖已达标 · 可领礼篮！'
        : `今日发帖进度  ${done}/1`;
    const statusCol = claimed
      ? SCENE_INK.green
      : claimable
        ? SCENE_INK.red
        : SCENE_INK.ink;

    const progTitle = makeText('heading', statusText, statusCol, { size: 25 });
    progTitle.position.set(leftX, topY + 6);
    fitTextWidth(progTitle, noteW - 310);
    scene.addChild(progTitle);

    const barW = noteW - 312;
    const bar = makeHandProgressBar({
      width: barW,
      height: 22,
      ratio: claimed ? 1 : done,
      onReady: this._scheduleRelayout,
    });
    bar.node.position.set(leftX, topY + 54);
    scene.addChild(bar.node);

    if (claimed) {
      const seal = makeSealStamp('今日已领', 66, -0.12);
      seal.position.set(rightX - 64, topY + 46);
      scene.addChild(seal);
      return;
    }

    const btnW = 192;
    const btnH = 60;
    const claimBtn = makeSlicedButton({
      label: claimable ? '拎走礼篮' : '待发帖领',
      width: btnW,
      height: btnH,
      skin: claimable ? 'olive' : 'cream',
      textColor: claimable ? undefined : 0x8A7358,
      fontSize: 26,
      silent: !claimable,
      onReady: this._scheduleRelayout,
    });
    if (!claimable) claimBtn.alpha = 0.82;
    claimBtn.position.set(rightX - btnW, topY + 14);
    claimBtn.on('pointertap', (e) => {
      e.stopPropagation();
      const from = toStage(rightX - btnW / 2, topY + 44);
      this._handleClaim(from);
    });
    scene.addChild(claimBtn);
  }

  private _drawEnterButton(scene: PIXI.Container): void {
    const btnW = 412;
    const btnH = 68;
    const btnX = Math.round((W - btnW) / 2);
    const btnY = 858;

    const enter = makeSlicedButton({
      label: '去游戏圈晒菜',
      width: btnW,
      height: btnH,
      skin: 'terracotta',
      fontSize: 30,
      silent: true,
      onReady: this._scheduleRelayout,
    });
    enter.position.set(btnX, btnY);
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
    scene.addChild(enter);

    const tip = makeText('caption', '发帖后返回小店会自动刷新领奖状态', SCENE_INK.cream, {
      size: 22,
      fontWeight: '600',
      stroke: 0x3A2010,
      strokeWidth: 4,
    });
    tip.anchor.set(0.5);
    tip.position.set(W / 2, btnY + btnH + 30);
    scene.addChild(tip);
  }

  private _handleClaim(from?: { x: number; y: number }): void {
    if (!KitchenManager.canClaimGameClub(this._postCount)) {
      if (this._postCount < 1) Platform.showToast('请先去游戏圈发帖晒菜');
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
    if (!this._isOpen || !this.visible || !this.parent || !!this._inspect) return false;
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
