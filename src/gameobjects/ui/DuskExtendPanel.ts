import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { RunManager } from '@/managers/RunManager';
import { DUSK_EXTEND_STEPS } from '@/sim';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';
import { P0_ART, fillRect, makeAdButton, makeLabel, makeSlicedButton } from '@/utils/ui';

const BURST = 'subpkg_kitchen/ui_result_burst.png';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x7A5A34;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;

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
    this._root.removeChildren();
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
    this._root.removeChildren();
    if (!this._isOpen) return;

    watchTextures([P0_ART.gachaStage, P0_ART.duskFlashlight, P0_ART.adClapper, BURST], this._scheduleRelayout);

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160F0A);
    dim.alpha = 0.72;
    dim.eventMode = 'static';
    dim.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(dim);

    const boardW = Math.min(w - 44, 620);
    const boardH = Math.round(boardW * (694 / 508));
    const bx = Math.round((w - boardW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 12, (h - boardH) / 2));

    const card = new PIXI.Container();
    card.position.set(bx, by);
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, boardW, boardH);
    card.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(card);

    const stageTex = gameTexture(P0_ART.gachaStage);
    if (isTextureReady(stageTex)) {
      const bg = new PIXI.Sprite(stageTex);
      bg.width = boardW;
      bg.height = boardH;
      bg.eventMode = 'none';
      card.addChild(bg);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(6, 0x8B5A2B, 1);
      fb.beginFill(0xF6EDE0, 1);
      fb.drawRoundedRect(0, 0, boardW, boardH, 28);
      fb.endFill();
      card.addChild(fb);
    }

    // Header Plaque Title
    const title = makeLabel('天黑收摊啦', 34, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: 0xFFF6E8,
      strokeThickness: 5,
    });
    title.anchor.set(0.5);
    title.position.set(boardW / 2, Math.round(boardH * 0.145));
    card.addChild(title);

    // Centerpiece Flashlight + Soft Sunburst Glow
    const centerY = Math.round(boardH * 0.43);
    const burstTex = gameTexture(BURST);
    if (isTextureReady(burstTex)) {
      const burst = new PIXI.Sprite(burstTex);
      fitSpriteInBox(burst, boardW * 0.68, boardW * 0.68);
      burst.anchor.set(0.5);
      burst.position.set(boardW / 2, centerY);
      burst.alpha = 0.65;
      burst.eventMode = 'none';
      card.addChild(burst);
    }

    const lampWrap = new PIXI.Container();
    lampWrap.position.set(boardW / 2, centerY);
    lampWrap.eventMode = 'none';
    const flashTex = gameTexture(P0_ART.duskFlashlight);
    if (isTextureReady(flashTex)) {
      const spr = new PIXI.Sprite(flashTex);
      fitSpriteInBox(spr, boardW * 0.64, boardH * 0.34);
      spr.anchor.set(0.5);
      lampWrap.addChild(spr);
    }
    card.addChild(lampWrap);
    this._lamp = lampWrap;
    this._floatLamp(lampWrap, centerY);

    // Ahead Route Highlights
    const highlights = RunManager.duskAheadHighlights();
    const tagY = Math.round(boardH * 0.635);
    if (highlights.length) {
      const lead = makeLabel('前头还没逛完：', 20, MUTED, { fontWeight: '700' });
      lead.anchor.set(0.5);
      lead.position.set(boardW / 2, tagY - 22);
      card.addChild(lead);

      const row = new PIXI.Container();
      let curX = 0;
      highlights.forEach((txt, idx) => {
        if (idx > 0) curX += 10;
        const chip = this._highlightChip(txt);
        chip.x = curX;
        curX += chip.width;
        row.addChild(chip);
      });
      row.position.set(Math.round((boardW - curX) / 2), tagY + 2);
      card.addChild(row);
    } else {
      const lead = makeLabel('街尾还有摊主没收完筐，不翻可惜！', 22, INK, { fontWeight: '700' });
      lead.anchor.set(0.5);
      lead.position.set(boardW / 2, tagY);
      card.addChild(lead);
    }

    const desc = makeLabel(
      `看一段视频借摊主手电筒，摸黑再逛 ${DUSK_EXTEND_STEPS} 步`,
      20,
      INK,
      { fontWeight: '700' },
    );
    desc.anchor.set(0.5);
    desc.position.set(boardW / 2, Math.round(boardH * 0.728));
    card.addChild(desc);

    // Footer Buttons inside bottom cream band
    const btnY = Math.round(boardH * 0.812);
    const btnH = 56;
    const gap = 16;
    const homeW = 190;
    const adW = Math.min(316, boardW - 84 - homeW - gap);
    const totalW = homeW + gap + adW;
    const startX = Math.round((boardW - totalW) / 2);

    const homeBtn = makeSlicedButton({
      label: '直接回家',
      width: homeW,
      height: btnH,
      skin: 'cream',
      textColor: INK,
      onReady: this._scheduleRelayout,
    });
    homeBtn.position.set(startX, btnY);
    homeBtn.on('pointertap', () => {
      if (this._busy) return;
      this.close(true);
      RunManager.declineDuskExtend();
    });
    card.addChild(homeBtn);

    const adBtn = makeAdButton({
      label: `借手电 +${DUSK_EXTEND_STEPS}步`,
      width: adW,
      height: btnH,
      skin: 'gold',
      badge: '限1次',
      onReady: this._scheduleRelayout,
    });
    adBtn.position.set(startX + homeW + gap, btnY);
    adBtn.on('pointertap', () => {
      if (this._busy) return;
      this._busy = true;
      Platform.showRewardedVideo(
        'dusk_steps',
        () => {
          this.close(true);
          RunManager.extendDuskSteps(DUSK_EXTEND_STEPS);
        },
        () => {
          this._busy = false;
        },
      );
    });
    card.addChild(adBtn);
  }

  private _highlightChip(text: string): PIXI.Container {
    const wrap = new PIXI.Container();
    const lbl = makeLabel(text, 18, TERRACOTTA, { fontWeight: '700' });
    const pw = Math.ceil(lbl.width) + 22;
    const ph = 32;
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, 0xC4A574, 1);
    bg.beginFill(PAPER, 1);
    bg.drawRoundedRect(0, 0, pw, ph, ph / 2);
    bg.endFill();
    lbl.anchor.set(0.5);
    lbl.position.set(pw / 2, ph / 2 + 0.5);
    wrap.addChild(bg, lbl);
    wrap.eventMode = 'none';
    return wrap;
  }

  private _floatLamp(target: PIXI.Container, baseY: number): void {
    const stepUp = (): void => {
      if (!this._isOpen || target.destroyed) return;
      TweenManager.to({
        target,
        props: { y: baseY - 7 },
        duration: 1.1,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._isOpen || target.destroyed) return;
          TweenManager.to({
            target,
            props: { y: baseY + 5 },
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
