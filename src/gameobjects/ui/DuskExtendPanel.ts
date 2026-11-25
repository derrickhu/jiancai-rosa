import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { RunManager } from '@/managers/RunManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import { DUSK_EXTEND_STEPS } from '@/sim';
import { watchTextures } from '@/utils/assets';
import {
  P0_ART,
  UI_KIT,
  attachSpriteContour,
  fitTextWidth,
  makeAdButton,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawStretchSheet,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const W = 660;
const H = 900;
const INK = SCENE_INK.ink;

export class DuskExtendPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _lamp: PIXI.Container | null = null;
  private _paintQueued = false;
  private _busy = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 29;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (this._isOpen) return;
    if (!RunManager.run?.duskPromptPending) return;
    this._isOpen = true;
    this.visible = true;
    this._busy = false;
    warmupAdScene('dusk_steps');
    AudioManager.play('result_dusk');
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    this._stopLampAnim();
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._busy = false;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
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

  private _stopLampAnim(): void {
    if (this._lamp) {
      TweenManager.cancelTarget(this._lamp);
      this._lamp = null;
    }
  }

  relayout(): void {
    this._stopLampAnim();
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;

    watchTextures(
      [
        P0_ART.gachaStage,
        P0_ART.duskFlashlight,
        P0_ART.adClapper,
        UI_KIT.btnGold,
        ...sceneArtPaths(),
      ],
      this._scheduleRelayout,
    );

    const { scene } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: H,
      topBleed: 24,
      dimAlpha: 0.74,
      onDimTap: () => {},
    });

    // 暮色红灯笼木牌舞台（508×694 等比放到 660×900）
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0D0703, 0.48);
    shadow.drawRoundedRect(10, 18, W - 20, H - 12, 34);
    shadow.endFill();
    scene.addChild(shadow);

    const stageBg = sceneSprite(P0_ART.gachaStage, W, H);
    if (stageBg) {
      stageBg.width = W;
      stageBg.height = H;
      scene.addChild(stageBg);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(6, 0x5A3518, 1);
      fb.beginFill(0xF6EDE0, 1);
      fb.drawRoundedRect(0, 0, W, H, 28);
      fb.endFill();
      scene.addChild(fb);
    }

    // 顶部木匾牌面正中大字标题（H * 0.105 对准木牌中心）
    const title = makeText('display', '天黑收摊啦', 0x4A2A12, {
      size: 40,
      stroke: 0xF6DDB0,
      strokeWidth: 4,
    });
    title.anchor.set(0.5);
    title.position.set(W / 2, Math.round(H * 0.105));
    scene.addChild(title);

    // 舞台中央：老式铁皮手电筒实物贴边暖金轮廓光 + 朱印
    const centerY = Math.round(H * 0.365);
    const lampWrap = new PIXI.Container();
    lampWrap.position.set(W / 2, centerY);
    lampWrap.eventMode = 'none';
    const flash = sceneSprite(P0_ART.duskFlashlight, 404, 270);
    if (flash) {
      flash.anchor.set(0.5);
      lampWrap.addChild(flash);
      attachSpriteContour(lampWrap, flash, 'god', {
        onDark: true,
        selected: true,
        thicknessScale: 1.1,
      });
    }
    scene.addChild(lampWrap);
    this._lamp = lampWrap;
    this._floatLamp(lampWrap, centerY);

    const seal = makeSealStamp('夜逛', 54, 0.1);
    seal.position.set(W - 124, centerY - 88);
    scene.addChild(seal);

    // 钉在灯下的宣纸提示笺（首行避开四角黄铜图钉）
    const sheetX = 56;
    const sheetY = Math.round(H * 0.535);
    const sheetW = W - sheetX * 2;
    const sheetH = 204;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetY, sheetW, sheetH, 86, 76);

    const highlights = RunManager.duskAheadHighlights();
    const aheadText = highlights.length
      ? `前头未逛：${highlights.join(' · ')}`
      : '街尾还有老摊主没收完筐，不翻可惜！';
    const aheadLbl = makeText(
      'title',
      aheadText,
      highlights.length ? SCENE_INK.red : INK,
      { size: 26 },
    );
    aheadLbl.anchor.set(0.5);
    aheadLbl.position.set(W / 2, sheetY + 64);
    fitTextWidth(aheadLbl, sheetW - 128);
    scene.addChild(aheadLbl);

    drawInkDivider(scene, sheetX + 52, sheetY + 104, sheetW - 104, 0.48, 10);

    const desc = makeText(
      'body',
      `借摊主手电筒照路，摸黑再逛 ${DUSK_EXTEND_STEPS} 步！`,
      INK,
      { size: 25, fontWeight: '700' },
    );
    desc.anchor.set(0.5);
    desc.position.set(W / 2, sheetY + 148);
    fitTextWidth(desc, sheetW - 84);
    scene.addChild(desc);

    // 底部木框奶油栏内的大号双按钮
    const btnY = Math.round(H * 0.816);
    const btnH = 62;
    const gap = 16;
    const homeW = 212;
    const adW = 340;
    const startX = Math.round((W - (homeW + gap + adW)) / 2);

    const homeBtn = makeSlicedButton({
      label: '直接回家',
      width: homeW,
      height: btnH,
      skin: 'cream',
      textColor: INK,
      fontSize: 26,
      onReady: this._scheduleRelayout,
    });
    homeBtn.position.set(startX, btnY);
    homeBtn.on('pointertap', () => {
      if (this._busy) return;
      analytics.trackDuskExtendChoice({
        marketId: RunManager.run?.marketId,
        action: 'go_home',
        stepsAdded: 0,
        basketItems: RunManager.basket.items.length,
      });
      this.close(true);
      RunManager.declineDuskExtend();
    });
    scene.addChild(homeBtn);

    const adBtn = makeAdButton({
      label: `借手电 +${DUSK_EXTEND_STEPS}步`,
      width: adW,
      height: btnH,
      skin: 'gold',
      textColor: INK,
      badge: '本局限1',
      onReady: this._scheduleRelayout,
    });
    adBtn.position.set(startX + homeW + gap, btnY);
    adBtn.on('pointertap', () => {
      if (this._busy) return;
      this._busy = true;
      Platform.showRewardedVideo(
        'dusk_steps',
        () => {
          analytics.trackDuskExtendChoice({
            marketId: RunManager.run?.marketId,
            action: 'extend_ad',
            stepsAdded: DUSK_EXTEND_STEPS,
            basketItems: RunManager.basket.items.length,
          });
          this.close(true);
          RunManager.extendDuskSteps(DUSK_EXTEND_STEPS);
        },
        () => {
          this._busy = false;
        },
      );
    });
    scene.addChild(adBtn);
  }

  private _floatLamp(target: PIXI.Container, baseY: number): void {
    const stepUp = (): void => {
      if (!this._isOpen || target.destroyed) return;
      TweenManager.to({
        target,
        props: { y: baseY - 8 },
        duration: 1.1,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._isOpen || target.destroyed) return;
          TweenManager.to({
            target,
            props: { y: baseY + 6 },
            duration: 1.1,
            ease: Ease.easeInOutQuad,
            onComplete: stepUp,
          });
        },
      });
    };
    stepUp();
  }
}
