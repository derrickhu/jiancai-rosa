import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { EV } from '@/config/events';
import { TUTORIAL_GIFT_COINS, TUTORIAL_GIFT_TICKETS, TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { kitchenGachaHudPos, playCoinCollect, playTicketCollect } from '@/utils/coinCollect';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { HUD_ICON, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { TutorialGuard } from '@/systems/TutorialGuard';

const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const GOLD = 0xF2C14D;
const CREAM = 0xFFF6E8;
const MUTED = 0xE8D4A8;
const INK = 0x2A2018;
const COIN = HUD_ICON.coin;
const TICKET = HUD_ICON.ticket;
const BURST = 'subpkg_kitchen/ui_result_burst.png';
const TITLE = 'subpkg_kitchen/ui_tutorial_gift_title.png';
const BURST_ALPHA = 0.28;
const Z = 25000;
/** 卖掉后先看厨房和卖出提示，再出礼金。 */
const GIFT_DELAY_MS = 1800;
const COIN_BOX = 72;

export class TutorialGiftPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _stack: PIXI.Container | null = null;
  private _coin: PIXI.Sprite | null = null;
  private _claiming = false;
  private _celebrate = false;
  private _timer = 0;
  private _fx: PIXI.Container[] = [];

  constructor() {
    super();
    this.visible = false;
    this.zIndex = Z;
    this.eventMode = 'static';
    this.addChild(this._root);
    Game.stage.sortableChildren = true;
    Game.stage.addChild(this);
    Game.onViewportChange(() => {
      if (this._isOpen) this.relayout();
    });
    EventBus.on(EV.tutorialStepChanged, (step: TutorialStep) => {
      if (step === TutorialStep.CLAIM_GIFT) this._schedulePresent();
      else this.close(true);
    });
    EventBus.on(EV.tutorialCompleted, () => this.close(true));
  }

  present(): void {
    if (!TutorialManager.isStep(TutorialStep.CLAIM_GIFT)) return;
    if (TutorialManager.giftAlreadyClaimed()) {
      TutorialManager.advanceTo(TutorialStep.HINT_DOOR);
      return;
    }
    if (!this._isOpen) {
      this._celebrate = true;
      AudioManager.play('result_safe');
    }
    this._isOpen = true;
    this._claiming = false;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    Game.stage.addChild(this);
    this.zIndex = Z;
  }

  close(silent = false): void {
    this._cancelSchedule();
    this._stopFx();
    this._isOpen = false;
    this.visible = false;
    this._claiming = false;
    this._celebrate = false;
    this._stack = null;
    this._coin = null;
    this._root.removeChildren();
    void silent;
  }

  relayout(): void {
    this._stopFx();
    this._root.removeChildren();
    this._stack = null;
    this._coin = null;
    if (!this._isOpen) return;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const celebrate = this._celebrate;
    this._celebrate = false;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.62;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    whenTextureReady(COIN, () => {
      if (this._isOpen) this.relayout();
    });
    whenTextureReady(TICKET, () => {
      if (this._isOpen) this.relayout();
    });
    whenTextureReady(BURST, () => {
      if (this._isOpen) this.relayout();
    });
    whenTextureReady(TITLE, () => {
      if (this._isOpen) this.relayout();
    });

    const stack = new PIXI.Container();
    stack.eventMode = 'passive';
    this._root.addChild(stack);
    this._stack = stack;

    const burst = this._burst(Math.min(w - 80, 400));
    burst.position.set(0, 40);
    stack.addChild(burst);

    let y = 0;
    const title = this._titleArt(Math.min(w - 96, 420), 72);
    title.position.set(0, y);
    stack.addChild(title);
    y += 72 + 18;

    // Dual reward cards: +30 Gold & +2 Recipe Tickets
    const rewardRow = new PIXI.Container();
    const colSep = 180;

    const coinCol = new PIXI.Container();
    coinCol.position.set(-colSep / 2, 0);
    const glow1 = new PIXI.Graphics();
    glow1.beginFill(0xF2C14D, 0.18);
    glow1.drawCircle(0, COIN_BOX / 2, 48);
    glow1.endFill();
    const coin = new PIXI.Sprite(gameTexture(COIN));
    fitSpriteInBox(coin, COIN_BOX, COIN_BOX);
    coin.anchor.set(0.5);
    coin.position.set(0, COIN_BOX / 2);
    this._coin = coin;
    const amt1 = makeLabel(`+${TUTORIAL_GIFT_COINS}`, 44, GOLD, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 6,
    });
    amt1.anchor.set(0.5, 0);
    amt1.position.set(0, COIN_BOX + 8);
    const unit1 = makeLabel('开张金币', 20, MUTED, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 4,
    });
    unit1.anchor.set(0.5, 0);
    unit1.position.set(0, COIN_BOX + 8 + amt1.height + 2);
    coinCol.addChild(glow1, coin, amt1, unit1);

    const ticketCol = new PIXI.Container();
    ticketCol.position.set(colSep / 2, 0);
    const glow2 = new PIXI.Graphics();
    glow2.beginFill(0xE89B48, 0.20);
    glow2.drawCircle(0, COIN_BOX / 2, 48);
    glow2.endFill();
    const tSpr = new PIXI.Sprite(gameTexture(TICKET));
    fitSpriteInBox(tSpr, COIN_BOX + 6, COIN_BOX + 6);
    tSpr.anchor.set(0.5);
    tSpr.position.set(0, COIN_BOX / 2);
    const amt2 = makeLabel(`×${TUTORIAL_GIFT_TICKETS}`, 44, 0xFFE28A, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 6,
    });
    amt2.anchor.set(0.5, 0);
    amt2.position.set(0, COIN_BOX + 8);
    const unit2 = makeLabel('秘传菜谱券', 20, MUTED, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 4,
    });
    unit2.anchor.set(0.5, 0);
    unit2.position.set(0, COIN_BOX + 8 + amt2.height + 2);
    ticketCol.addChild(glow2, tSpr, amt2, unit2);

    rewardRow.addChild(coinCol, ticketCol);
    rewardRow.position.set(0, y);
    rewardRow.eventMode = 'none';
    stack.addChild(rewardRow);
    y += COIN_BOX + 8 + amt1.height + unit1.height + 22;

    const body = makeLabel('头锅开张大吉！送你菜钱升灶台，再送两张券抽新菜谱！', 21, CREAM, {
      fontWeight: '600',
      stroke: INK,
      strokeThickness: 4,
    });
    body.anchor.set(0.5, 0);
    body.position.set(0, y);
    stack.addChild(body);
    y += body.height + 28;

    const btnW = 216;
    const btnH = 54;
    const btn = makeSlicedButton({
      label: '开心收下',
      width: btnW,
      height: btnH,
      skin: 'terracotta',
      fontSize: 22,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    btn.pivot.set(btnW / 2, btnH / 2);
    btn.position.set(0, y + btnH / 2);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._claim();
    });
    stack.addChild(btn);
    y += btnH;

    const top = Game.safeTop + 16;
    const bottom = h - Math.max(20, Game.safeBottom + 16);
    stack.position.set(w / 2, top + Math.max(0, (bottom - top - y) / 2));

    if (celebrate) {
      this._pop(title, 0);
      this._pop(rewardRow, 0.08);
      this._pop(body, 0.18);
      this._pop(btn, 0.24);
      this._spin(burst);
      this._pulse(burst);
      this._sparks(stack.x, stack.y + rewardRow.y + COIN_BOX / 2);
    }
  }

  private _schedulePresent(): void {
    this._cancelSchedule();
    if (TutorialManager.giftAlreadyClaimed()) {
      TutorialManager.advanceTo(TutorialStep.HINT_DOOR);
      return;
    }
    this._timer = globalThis.setTimeout(() => {
      this._timer = 0;
      this.present();
    }, GIFT_DELAY_MS) as unknown as number;
  }

  private _cancelSchedule(): void {
    if (!this._timer) return;
    globalThis.clearTimeout(this._timer);
    this._timer = 0;
  }

  private _titleArt(width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const tex = gameTexture(TITLE);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, width, height);
      spr.anchor.set(0.5, 0);
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const fallback = makeLabel('新手礼金', 40, GOLD, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        letterSpacing: 4,
        stroke: INK,
        strokeThickness: 6,
      });
      fallback.anchor.set(0.5, 0);
      root.addChild(fallback);
    }
    return root;
  }

  private _burst(side: number): PIXI.Sprite {
    const burst = new PIXI.Sprite(gameTexture(BURST));
    const bind = (): void => {
      if (burst.destroyed) return;
      burst.texture = gameTexture(BURST);
      fitSpriteInBox(burst, side, side);
    };
    whenTextureReady(BURST, bind);
    bind();
    burst.anchor.set(0.5);
    burst.blendMode = PIXI.BLEND_MODES.ADD;
    burst.alpha = BURST_ALPHA;
    burst.tint = 0xC4A050;
    burst.eventMode = 'none';
    this._fx.push(burst);
    return burst;
  }

  private _spin(burst: PIXI.Sprite): void {
    const turn = (): void => {
      if (!this._isOpen || burst.destroyed) return;
      TweenManager.to({
        target: burst,
        props: { rotation: burst.rotation + Math.PI * 2 },
        duration: 14,
        ease: Ease.linear,
        onComplete: turn,
      });
    };
    turn();
  }

  private _pulse(burst: PIXI.Sprite): void {
    const base = burst.scale.x || 1;
    burst.alpha = 0;
    burst.scale.set(base * 0.7);
    TweenManager.to({
      target: burst,
      props: { alpha: BURST_ALPHA },
      duration: 0.36,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: burst.scale,
      props: { x: base, y: base },
      duration: 0.42,
      ease: Ease.easeOutQuad,
    });
  }

  private _sparks(x: number, y: number): void {
      const colors = [0xF2C14D, 0xFFF6E8, 0xE07A3A, 0xC4A574];
    for (let i = 0; i < 10; i++) {
      const dot = new PIXI.Graphics();
      const r = 2 + Math.random() * 2.4;
      dot.beginFill(colors[i % colors.length], 0.55);
      dot.drawCircle(0, 0, r);
      dot.endFill();
      dot.position.set(x, y);
      dot.eventMode = 'none';
      this._root.addChild(dot);
      this._fx.push(dot);
      const ang = (Math.PI * 2 * i) / 10 + Math.random() * 0.35;
      const dist = 56 + Math.random() * 90;
      TweenManager.to({
        target: dot,
        props: {
          x: x + Math.cos(ang) * dist,
          y: y + Math.sin(ang) * dist,
          alpha: 0,
        },
        duration: 0.62 + Math.random() * 0.28,
        delay: 0.04 + Math.random() * 0.1,
        ease: Ease.easeOutQuad,
      });
    }
  }

  private _pop(target: PIXI.Container, delay: number, base = 1): void {
    this._fx.push(target);
    target.alpha = 0;
    target.scale.set(base * 0.72);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.22,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: base, y: base },
      duration: 0.28,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopFx(): void {
    for (const node of this._fx) {
      TweenManager.cancelTarget(node);
      TweenManager.cancelTarget(node.scale);
    }
    this._fx = [];
  }

  private _claim(): void {
    if (this._claiming || TutorialGuard.block('claimGift')) return;
    this._claiming = true;
    const from = this._coin && this._stack
      ? { x: this._stack.x + this._coin.x, y: this._stack.y + this._coin.y }
      : { x: Game.designWidth / 2, y: Game.logicHeight * 0.46 };
    const granted = TutorialManager.claimGift();
    this.close(true);
    if (granted) {
      playCoinCollect(from, 7);
      playTicketCollect({ x: from.x + 140, y: from.y }, kitchenGachaHudPos(), 0.12);
    }
  }
}

let _panel: TutorialGiftPanel | null = null;

export function ensureTutorialGiftPanel(): TutorialGiftPanel {
  if (!_panel) _panel = new TutorialGiftPanel();
  return _panel;
}
