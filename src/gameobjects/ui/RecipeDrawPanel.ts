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
  canUseDailyAd,
  dailyAdLeft,
  freshGachaRecipes,
  gachaPityLeft,
  itemRarity,
  recipeUnlockView,
  type GachaDrawMode,
  type RecipeId,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
import { P0_ART, UI_KIT, fillRect, makeAdButton, makeCloseButton, makeLabel, makeRarityFlare, makeSlicedButton } from '@/utils/ui';
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

const TICKET = 'subpkg_images/ui_menu_ticket.png';
const BOX = 'subpkg_images/hud_gacha_box.png';
const PAPER = 'subpkg_kitchen/ui_recipe_paper.png';
const FLARE = 'subpkg_kitchen/ui_pickup_flare.png';
const LACK_HINT = '做小饭桌或盖图鉴章可拿菜谱券';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x7A5A34;
const SHAKE_SEC = 0.4;
const SPIN_SEC = 0.95;
const LAND_SEC = 0.18;

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

export class RecipeDrawPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _box: PIXI.Container | null = null;
  private _paper: PIXI.Container | null = null;
  private _playing = false;
  private _adBusy = false;
  private _pending: DrawResult | null = null;
  private _lastTap = 0;
  private _paintQueued = false;

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
    warmupAdScene('gacha_free');
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    const pending = this._pending;
    this._clearFx();
    this._playing = false;
    this._adBusy = false;
    this._paintQueued = false;
    this._pending = null;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._root.removeChildren();
    this._box = null;
    if (pending) this._deliver(pending);
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

    watchTextures([P0_ART.gachaStage, P0_ART.adClapper, UI_KIT.closeRound, UI_KIT.btnGold, BOX, TICKET, PAPER, FLARE], this._scheduleRelayout);

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160F0A);
    dim.alpha = 0.72;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (!this._playing && !this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const boardW = Math.min(w - 36, 628);
    const boardH = Math.round(boardW * (694 / 508));
    const bx = Math.round((w - boardW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 12, (h - boardH) / 2));

    const shell = new PIXI.Container();
    shell.position.set(bx, by);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, boardW, boardH);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);

    const stageTex = gameTexture(P0_ART.gachaStage);
    if (isTextureReady(stageTex)) {
      const bg = new PIXI.Sprite(stageTex);
      bg.width = boardW;
      bg.height = boardH;
      bg.eventMode = 'none';
      shell.addChild(bg);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(6, 0x8B5A2B, 1);
      fb.beginFill(0xF6EDE0, 1);
      fb.drawRoundedRect(0, 0, boardW, boardH, 28);
      fb.endFill();
      shell.addChild(fb);
    }

    // Top-right crafted close button
    const closeBtn = makeCloseButton({
      size: 46,
      silent: true,
      onReady: this._scheduleRelayout,
      onTap: () => {
        if (!this._playing && !this._adBusy) this.close();
      },
    });
    closeBtn.position.set(boardW - 58, 44);
    shell.addChild(closeBtn);

    const save = KitchenManager.save;
    const tickets = save.recipeTickets;
    const remainRecipes = freshGachaRecipes(recipeUnlockView(save)).length;
    const isMasterChest = remainRecipes <= 0;
    const pityLeft = gachaPityLeft(save);

    // Header Title on Wooden Plaque
    const title = makeLabel(isMasterChest ? '名 厨 秘 匣' : '菜 谱 抽 箱', 34, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: 0xFFF6E8,
      strokeThickness: 5,
    });
    title.anchor.set(0.5);
    title.position.set(boardW / 2, Math.round(boardH * 0.145));
    shell.addChild(title);

    // Ticket Pill + Pool Info
    const subY = Math.round(boardH * 0.255);
    const pityTag = pityLeft <= 1 ? '本箱必出新菜谱！' : `再开${pityLeft}箱内必出新谱`;
    const subText = !isMasterChest
      ? `还剩 ${remainRecipes} 本秘传菜谱 · ${pityTag}`
      : '秘传菜谱已集齐 · 必出火候心得 / 臻品陈酿 / 鸿运签';
    const sub = makeLabel(subText, 18, !isMasterChest && pityLeft <= 1 ? 0xC46A3A : MUTED, { fontWeight: '700' });
    sub.anchor.set(0.5);
    sub.position.set(boardW / 2, subY);
    shell.addChild(sub);

    const ticketPill = this._ticketBadge(tickets);
    ticketPill.position.set(Math.round((boardW - 168) / 2), subY + 22);
    shell.addChild(ticketPill);

    // Center Gacha Box (positioned in stage coordinates on _root so shake/spin coordinates stay clean)
    const boxSize = Math.round(Math.min(320, boardW * 0.54));
    const boxStageX = bx + Math.round(boardW / 2);
    const boxStageY = by + Math.round(boardH * 0.525);

    const box = new PIXI.Container();
    const tex = gameTexture(BOX);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, boxSize, boxSize);
      spr.anchor.set(0.5);
      spr.eventMode = 'none';
      box.addChild(spr);
    }
    box.position.set(boxStageX, boxStageY);
    box.eventMode = 'static';
    box.hitArea = new PIXI.Rectangle(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
    box.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(box);
    this._box = box;

    // Footer Action Area (Bottom 22% band)
    const btnY = Math.round(boardH * 0.798);
    const btnH = 56;
    const gap = 14;
    const padX = 44;
    const colW = Math.floor((boardW - padX * 2 - gap) / 2);

    const canTicket = tickets >= RECIPE_GACHA_COST;
    const topupLeft = dailyAdLeft(save, 'gacha_topup');
    const canTopup = !canTicket && tickets === 1 && canUseDailyAd(save, 'gacha_topup');
    const freeAvail = canUseDailyAd(save, 'gacha_free');

    // Left Button: Ticket Draw OR 1-Ticket Ad Top-up
    let leftBtn: PIXI.Container;
    if (canTicket) {
      leftBtn = this._ticketDrawBtn(tickets, colW, btnH, true);
      leftBtn.on('pointertap', (e) => {
        e.stopPropagation();
        this._runDraw('ticket');
      });
    } else if (canTopup) {
      leftBtn = makeAdButton({
        label: '差1券 · 补齐开',
        width: colW,
        height: btnH,
        skin: 'terracotta',
        badge: `剩${topupLeft}/${DAILY_AD_LIMITS.gacha_topup}`,
        onReady: this._scheduleRelayout,
      });
      leftBtn.on('pointertap', (e) => {
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
      leftBtn = this._ticketDrawBtn(tickets, colW, btnH, false);
      leftBtn.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_deny');
        Platform.showToast(LACK_HINT);
      });
    }
    leftBtn.position.set(padX, btnY);
    shell.addChild(leftBtn);

    // Right Button: Daily Free Ad Draw
    const rightBtn = freeAvail
      ? makeAdButton({
        label: '免费开一箱',
        width: colW,
        height: btnH,
        skin: 'gold',
        badge: '每日1次',
        onReady: this._scheduleRelayout,
      })
      : makeSlicedButton({
        label: '今日免费已领',
        width: colW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        onReady: this._scheduleRelayout,
        silent: true,
      });
    if (!freeAvail) {
      rightBtn.alpha = 0.72;
      rightBtn.cursor = 'default';
    }
    rightBtn.position.set(padX + colW + gap, btnY);
    rightBtn.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._playing || this._adBusy) return;
      if (!freeAvail) {
        Platform.showToast('今天的免费箱子已经开过啦，明天再来');
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
    shell.addChild(rightBtn);

    const footTip = makeLabel(
      tickets === 1 && canTopup ? '手里已有 1 张券，看视频可免第 2 张券直接开箱！' : LACK_HINT,
      16,
      MUTED,
      { fontWeight: '600' },
    );
    footTip.anchor.set(0.5);
    footTip.position.set(boardW / 2, btnY + btnH + 22);
    shell.addChild(footTip);
  }

  private _ticketBadge(tickets: number): PIXI.Container {
    const wrap = new PIXI.Container();
    const w = 168;
    const h = 34;
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, 0x8B5A2B, 1);
    bg.beginFill(0xFFF8F0, 1);
    bg.drawRoundedRect(0, 0, w, h, h / 2);
    bg.endFill();
    wrap.addChild(bg);

    const tex = gameTexture(TICKET);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 34, 28);
      sp.anchor.set(0.5);
      sp.position.set(30, h / 2);
      wrap.addChild(sp);
    }
    const lbl = makeLabel(`菜谱券  ${tickets}/${RECIPE_GACHA_COST}`, 17, INK, { fontWeight: '700' });
    lbl.anchor.set(0, 0.5);
    lbl.position.set(52, h / 2 + 0.5);
    wrap.addChild(lbl);
    wrap.eventMode = 'none';
    return wrap;
  }

  private _ticketDrawBtn(tickets: number, width: number, height: number, ready: boolean): PIXI.Container {
    const btn = makeSlicedButton({
      label: ready ? `开一箱 (${tickets}/${RECIPE_GACHA_COST})` : `券不足 (${tickets}/${RECIPE_GACHA_COST})`,
      width,
      height,
      skin: ready ? 'terracotta' : 'cream',
      textColor: ready ? 0xFFF8F0 : 0x8A7358,
      labelOffsetX: 16,
      onReady: this._scheduleRelayout,
      silent: !ready,
    });
    const ticketTex = gameTexture(TICKET);
    if (isTextureReady(ticketTex)) {
      const spr = new PIXI.Sprite(ticketTex);
      fitSpriteInBox(spr, 34, 34);
      spr.anchor.set(0.5);
      spr.position.set(28, height / 2);
      spr.eventMode = 'none';
      if (!ready) spr.alpha = 0.55;
      btn.addChild(spr);
    }
    if (!ready) btn.alpha = 0.78;
    return btn;
  }

  private _runDraw(mode: GachaDrawMode): void {
    const now = Date.now();
    if (now - this._lastTap < 280) return;
    this._lastTap = now;
    if (this._playing) return;
    const result = KitchenManager.drawRecipe({ reveal: false, mode });
    if (!result.ok) return;
    this._playing = true;
    this._pending = result;
    const afterShake = (): void => {
      if (!this._playing) return;
      if (result.foodDefId) {
        this._waitPath(resolveItemAssetPath(result.foodDefId), () => {
          if (!this._playing) return;
          this._spinItem(result.foodDefId!, result.foodQty ?? 1, () => {
            if (!this._playing) return;
            this._finishDraw();
          });
        });
        return;
      }
      this._waitPath(PAPER, () => {
        if (!this._playing) return;
        this._spinPaper(result.duplicate && !result.specialKind, () => {
          if (!this._playing) return;
          this._finishDraw();
        });
      });
    };
    if (result.foodDefId) itemTexture(result.foodDefId);
    else gameTexture(PAPER);
    this._shakeBox(afterShake);
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
    const tex = gameTexture(PAPER);
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
      const tag = makeLabel(`x${qty}`, 40, 0xFFF8F0, {
        fontWeight: '700',
        stroke: 0x2A2018,
        strokeThickness: 6,
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
    const pending = this._pending;
    this._playing = false;
    this._pending = null;
    if (pending) this._deliver(pending);
    this._clearFx();
    if (this._isOpen) this.relayout();
  }

  private _deliver(result: DrawResult): void {
    const from = this._box
      ? { x: this._box.x, y: this._box.y - 60 }
      : { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.42) };
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
