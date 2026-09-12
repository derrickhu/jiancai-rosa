import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { TUTORIAL_GIFT_COINS, TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { playCoinCollect } from '@/utils/coinCollect';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { HUD_ICON, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';
import { TutorialGuard } from '@/systems/TutorialGuard';

const INK = 0x2A2018;
const PAPER = 0xFFF8F0;
const GOLD = 0xD4922A;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const COIN = HUD_ICON.coin;
const Z = 25000;

export class TutorialGiftPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _claiming = false;
  private _btn: PIXI.Container | null = null;

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
      if (step === TutorialStep.CLAIM_GIFT) this.present();
      else if (this._isOpen && step !== TutorialStep.CLAIM_GIFT) this.close(true);
    });
    EventBus.on(EV.tutorialCompleted, () => this.close(true));
  }

  present(): void {
    if (!TutorialManager.isStep(TutorialStep.CLAIM_GIFT)) return;
    if (TutorialManager.giftAlreadyClaimed()) {
      TutorialManager.advanceTo(TutorialStep.HINT_DOOR);
      return;
    }
    if (!this._isOpen) AudioManager.play('result_safe');
    this._isOpen = true;
    this._claiming = false;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    Game.stage.addChild(this);
    this.zIndex = Z;
  }

  close(silent = false): void {
    this._isOpen = false;
    this.visible = false;
    this._claiming = false;
    this._btn = null;
    this._root.removeChildren();
    if (!silent) return;
  }

  relayout(): void {
    this._root.removeChildren();
    this._btn = null;
    if (!this._isOpen) return;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.58;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    whenTextureReady(COIN, () => {
      if (this._isOpen) this.relayout();
    });

    const cardW = Math.min(560, w - 64);
    const cardH = 420;
    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
    card.on('pointertap', (e) => e.stopPropagation());
    card.position.set((w - cardW) / 2, Math.max(Game.safeTop + 24, (h - cardH) / 2 - 12));
    this._root.addChild(card);

    const paper = new PIXI.Graphics();
    paper.beginFill(0x2A2018, 0.16);
    paper.drawRoundedRect(5, 8, cardW, cardH, 22);
    paper.endFill();
    paper.lineStyle(3, INK, 1);
    paper.beginFill(PAPER);
    paper.drawRoundedRect(0, 0, cardW, cardH, 22);
    paper.endFill();
    paper.beginFill(0xF3E2C4, 0.55);
    paper.drawRoundedRect(16, 12, cardW - 32, 12, 4);
    paper.endFill();
    card.addChild(paper);

    const title = makeLabel('新手礼金', 34, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    title.anchor.set(0.5, 0);
    title.position.set(cardW / 2, 28);
    card.addChild(title);

    const coin = new PIXI.Sprite(gameTexture(COIN));
    if (isTextureReady(coin.texture)) fitSpriteInBox(coin, 120, 120);
    else {
      coin.width = 120;
      coin.height = 120;
    }
    coin.anchor.set(0.5);
    coin.position.set(cardW / 2, 168);
    coin.eventMode = 'none';
    card.addChild(coin);

    const amount = makeLabel(`+${TUTORIAL_GIFT_COINS} 金币`, 32, GOLD, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    amount.anchor.set(0.5, 0);
    amount.position.set(cardW / 2, 236);
    card.addChild(amount);

    const body = makeLabel('走完这一趟，送你一点菜钱。', 22, 0x5A4636, { fontWeight: '500' });
    body.anchor.set(0.5, 0);
    body.position.set(cardW / 2, 280);
    card.addChild(body);

    const btn = makeSlicedButton({
      label: '领取',
      width: 200,
      height: 56,
      skin: 'terracotta',
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    btn.position.set((cardW - 200) / 2, 334);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._claim();
    });
    card.addChild(btn);
    this._btn = btn;
  }

  private _claim(): void {
    if (this._claiming || TutorialGuard.block('claimGift')) return;
    this._claiming = true;
    const from = this._btn
      ? { x: this._btn.parent.x + this._btn.x + 100, y: this._btn.parent.y + this._btn.y + 28 }
      : { x: Game.designWidth / 2, y: Game.logicHeight * 0.55 };
    const granted = TutorialManager.claimGift();
    this.close(true);
    if (granted) playCoinCollect(from, 10);
  }
}

let _panel: TutorialGiftPanel | null = null;

export function ensureTutorialGiftPanel(): TutorialGiftPanel {
  if (!_panel) _panel = new TutorialGiftPanel();
  return _panel;
}
