import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { EV } from '@/config/events';
import { TUTORIAL_GIFT_COINS, TUTORIAL_GIFT_TICKETS, TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { kitchenGachaHudPos, playCoinCollect, playTicketCollect } from '@/utils/coinCollect';
import { watchTextures } from '@/utils/assets';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  HUD_ICON,
  UI_KIT,
  attachSpriteContour,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import { TutorialGuard } from '@/systems/TutorialGuard';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneWall,
  drawStretchSheet,
  makePlateItem,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  wall: 'subpkg_images/scene_order_wall.png',
  basket: 'subpkg_images/scene_club_basket.png',
  title: 'subpkg_kitchen/ui_tutorial_gift_title.png',
  menuTicket: 'subpkg_images/ui_menu_ticket.png',
} as const;

const W = 684;
const Z = 25000;
/** 卖掉后先看厨房和卖出提示，再出礼金。 */
const GIFT_DELAY_MS = 1800;

export class TutorialGiftPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _coinStagePos = { x: 300, y: 500 };
  private _ticketStagePos = { x: 450, y: 500 };
  private _claiming = false;
  private _celebrate = false;
  private _paintQueued = false;
  private _timer = 0;
  private _fx: PIXI.DisplayObject[] = [];

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
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
    void silent;
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
    this._stopFx();
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;

    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        HUD_ICON.coin,
        HUD_ICON.ticket,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
      ],
      this._scheduleRelayout,
    );

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const celebrate = this._celebrate;
    this._celebrate = false;

    const sheetTop = 252;
    const sheetH = 576;
    const panelH = sheetTop + sheetH + 30;

    const { scene, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 52,
      dimAlpha: 0.68,
      onDimTap: () => {},
    });

    drawSceneWall(scene, ART.wall, W, panelH, 160, 110);

    // 顶部大牌匾标题
    const plaqueWrap = new PIXI.Container();
    const titleArt = sceneSprite(ART.title, 396, 86);
    if (titleArt) {
      titleArt.anchor.set(0.5);
      titleArt.position.set(W / 2, 16);
      plaqueWrap.addChild(titleArt);
    } else {
      drawPlaqueTitle(plaqueWrap, '开张大吉礼篮', W / 2, -46, 360);
    }
    scene.addChild(plaqueWrap);

    // 顶部温暖竹编礼篮实物 + 贴边暖金轮廓光
    const basketWrap = new PIXI.Container();
    basketWrap.position.set(W / 2, 162);
    const basketSp = sceneSprite(ART.basket, 248, 168);
    if (basketSp) {
      basketSp.anchor.set(0.5);
      basketWrap.addChild(basketSp);
      attachSpriteContour(basketWrap, basketSp, 'god', {
        onDark: true,
        selected: true,
        thicknessScale: 1.0,
      });
    }
    scene.addChild(basketWrap);

    // 钉在木板上的宣纸贺帖
    const sheetX = 28;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 130, 110);

    // 首行标题与「大吉」朱印内收至 94..W-94 且下移至 sheetTop+66，完全避开左右黄铜图钉
    const headL = 94;
    const headR = W - 94;
    const contentL = 68;
    const contentW = W - contentL * 2;

    const greetLead = makeText('title', '街坊邻里凑的开伙贺礼', SCENE_INK.ink, { size: 30 });
    greetLead.anchor.set(0, 0.5);
    greetLead.position.set(headL, sheetTop + 66);
    scene.addChild(greetLead);

    const seal = makeSealStamp('大吉', 52, 0.1);
    seal.position.set(headR - 26, sheetTop + 66);
    scene.addChild(seal);

    drawInkDivider(scene, contentL, sheetTop + 106, contentW, 0.5, 10);

    // 两只青花瓷碟盛放金币与秘传菜谱券
    const leftCx = Math.round(W * 0.31);
    const rightCx = Math.round(W * 0.69);
    const plateCy = sheetTop + 196;

    this._coinStagePos = toStage(leftCx, plateCy);
    this._ticketStagePos = toStage(rightCx, plateCy);

    const rewardGroup = new PIXI.Container();
    scene.addChild(rewardGroup);

    const coinPlate = makePlateItem({
      iconPath: HUD_ICON.coin,
      plateW: 152,
      iconSize: 88,
      rarity: 'god',
      contourOpts: { selected: true, thicknessScale: 0.92 },
    });
    coinPlate.position.set(leftCx, plateCy);
    rewardGroup.addChild(coinPlate);

    const amt1 = makeText('display', `+${TUTORIAL_GIFT_COINS}`, SCENE_INK.gold, { size: 38 });
    amt1.anchor.set(0.5, 0);
    amt1.position.set(leftCx, plateCy + 46);
    const unit1 = makeText('body', '开张买菜金', SCENE_INK.soft, { size: 24, fontWeight: '700' });
    unit1.anchor.set(0.5, 0);
    unit1.position.set(leftCx, plateCy + 94);
    rewardGroup.addChild(amt1, unit1);

    const ticketPlate = makePlateItem({
      iconPath: ART.menuTicket,
      plateW: 152,
      iconSize: 96,
      rarity: 'epic',
      contourOpts: { selected: true, thicknessScale: 0.92 },
    });
    ticketPlate.position.set(rightCx, plateCy);
    rewardGroup.addChild(ticketPlate);

    const amt2 = makeText('display', `×${TUTORIAL_GIFT_TICKETS}`, SCENE_INK.red, { size: 38 });
    amt2.anchor.set(0.5, 0);
    amt2.position.set(rightCx, plateCy + 46);
    const unit2 = makeText('body', '秘传菜谱券', SCENE_INK.soft, { size: 24, fontWeight: '700' });
    unit2.anchor.set(0.5, 0);
    unit2.position.set(rightCx, plateCy + 94);
    rewardGroup.addChild(amt2, unit2);

    const divY = plateCy + 144;
    drawInkDivider(scene, contentL, divY, contentW, 0.45, 10);

    const body = makeText(
      'body',
      '头锅开张大吉！送你菜钱升级厨房，\n再送两张菜谱券去抽新家常菜！',
      SCENE_INK.ink,
      {
        size: 25,
        align: 'center',
        lineHeight: 38,
      },
    );
    body.anchor.set(0.5, 0);
    body.position.set(W / 2, divY + 22);
    scene.addChild(body);

    // 充足间距：body 底约 sheetTop+448，按钮从 sheetTop+476 开始，底留白 36px，零重叠
    const btnW = 340;
    const btnH = 64;
    const btnY = divY + 22 + Math.ceil(body.height) + 28;
    const btn = makeSlicedButton({
      label: '开心收下贺礼',
      width: btnW,
      height: btnH,
      skin: 'gold',
      textColor: SCENE_INK.ink,
      fontSize: 28,
      onReady: this._scheduleRelayout,
    });
    btn.position.set((W - btnW) / 2, btnY);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._claim();
    });
    scene.addChild(btn);

    if (celebrate) {
      this._pop(plaqueWrap, 0);
      this._pop(basketWrap, 0.05);
      this._pop(rewardGroup, 0.12);
      const centerStage = toStage(W / 2, plateCy);
      this._sparks(centerStage.x, centerStage.y);
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

  private _sparks(x: number, y: number): void {
    const colors = [0xF2C14D, 0xFFF6E8, 0xE07A3A, 0xC4A574];
    for (let i = 0; i < 10; i++) {
      const dot = new PIXI.Graphics();
      const r = 2.5 + Math.random() * 2.5;
      dot.beginFill(colors[i % colors.length], 0.65);
      dot.drawCircle(0, 0, r);
      dot.endFill();
      dot.position.set(x, y);
      dot.eventMode = 'none';
      this._root.addChild(dot);
      this._fx.push(dot);
      const ang = (Math.PI * 2 * i) / 10 + Math.random() * 0.35;
      const dist = 64 + Math.random() * 100;
      TweenManager.to({
        target: dot,
        props: {
          x: x + Math.cos(ang) * dist,
          y: y + Math.sin(ang) * dist,
          alpha: 0,
        },
        duration: 0.65 + Math.random() * 0.28,
        delay: 0.04 + Math.random() * 0.1,
        ease: Ease.easeOutQuad,
      });
    }
  }

  private _pop(target: PIXI.Container, delay: number): void {
    this._fx.push(target);
    target.alpha = 0;
    target.scale.set(0.8);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.22,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: 1, y: 1 },
      duration: 0.28,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopFx(): void {
    for (const node of this._fx) {
      TweenManager.cancelTarget(node);
      if ('scale' in node && node.scale) TweenManager.cancelTarget(node.scale);
    }
    this._fx = [];
  }

  private _claim(): void {
    if (this._claiming || TutorialGuard.block('claimGift')) return;
    this._claiming = true;
    const coinFrom = this._coinStagePos;
    const ticketFrom = this._ticketStagePos;
    const granted = TutorialManager.claimGift();
    this.close(true);
    if (granted) {
      playCoinCollect(coinFrom, 7);
      playTicketCollect(ticketFrom, kitchenGachaHudPos(), 0.12);
    }
  }
}

let _panel: TutorialGiftPanel | null = null;

export function ensureTutorialGiftPanel(): HudOrGift {
  if (!_panel) _panel = new TutorialGiftPanel();
  return _panel;
}
type HudOrGift = TutorialGiftPanel;
