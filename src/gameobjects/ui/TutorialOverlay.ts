/**
 * 新手指引层：四块矩形拼暗区，镂空不画所以点击穿透。
 * 挂 Game.stage，zIndex 高于 OverlayManager。
 */
import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { EV } from '@/config/events';
import {
  TUTORIAL_ASSETS,
  TUTORIAL_COPY,
  TUTORIAL_INTRO,
} from '@/config/TutorialCopy';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { FONT, fillRect, makeLabel, makeSlicedButton } from '@/utils/ui';

export interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const GOLD = 0xE8C15A;
const PAPER = 0xFFF6EA;
const DIM = 0.56;

export function stageRectOf(obj: PIXI.Container | null | undefined, pad = 10): SpotlightRect | null {
  if (!obj || obj.destroyed || !obj.worldVisible) return null;
  const b = obj.getBounds();
  if (b.width < 4 || b.height < 4) return null;
  const tl = Game.stage.toLocal({ x: b.x, y: b.y });
  const br = Game.stage.toLocal({ x: b.x + b.width, y: b.y + b.height });
  return {
    x: tl.x - pad,
    y: tl.y - pad,
    w: Math.max(44, br.x - tl.x + pad * 2),
    h: Math.max(44, br.y - tl.y + pad * 2),
    r: 16,
  };
}

export function worldRectToStage(
  world: PIXI.Container,
  rect: { x: number; y: number; w: number; h: number },
  pad = 10,
): SpotlightRect | null {
  if (!world.parent) return null;
  const tl = Game.stage.toLocal(world.toGlobal({ x: rect.x, y: rect.y }));
  const br = Game.stage.toLocal(world.toGlobal({ x: rect.x + rect.w, y: rect.y + rect.h }));
  return {
    x: tl.x - pad,
    y: tl.y - pad,
    w: Math.max(44, br.x - tl.x + pad * 2),
    h: Math.max(44, br.y - tl.y + pad * 2),
    r: 18,
  };
}

class TutorialOverlayClass {
  private _root: PIXI.Container | null = null;
  private _layer = new PIXI.Container();
  private _providers = new Map<string, () => SpotlightRect | null>();
  private _introPage = 0;
  private _shownStep: TutorialStep | null = null;
  private _finger: PIXI.Container | null = null;
  private _onStep = (step: TutorialStep) => {
    if (step === TutorialStep.INTRO) this._introPage = 0;
    this.refresh();
  };

  mount(): void {
    if (this._root) {
      this.ensureTop();
      return;
    }
    this._root = new PIXI.Container();
    this._root.zIndex = 20000;
    this._root.sortableChildren = true;
    this._root.eventMode = 'passive';
    this._layer.eventMode = 'passive';
    this._root.addChild(this._layer);
    Game.stage.sortableChildren = true;
    Game.stage.addChild(this._root);
    EventBus.on(EV.tutorialStepChanged, this._onStep);
    EventBus.on(EV.tutorialCompleted, this._onCompleted);
    Game.onViewportChange(() => this.refresh());
    OverlayManager.onBroughtToFront(() => this.ensureTop());
    this.refresh();
  }

  ensureTop(): void {
    if (!this._root || !Game.stage) return;
    if (this._root.parent !== Game.stage) Game.stage.addChild(this._root);
    else Game.stage.addChild(this._root);
    this._root.zIndex = 20000;
  }

  register(id: string, get: () => SpotlightRect | null): void {
    this._providers.set(id, get);
    this.refresh();
  }

  unregister(id: string): void {
    this._providers.delete(id);
  }

  refresh(): void {
    this.mount();
    if (!this._root) return;
    this.ensureTop();
    if (!TutorialManager.isActive) {
      this._clear();
      this._root.visible = false;
      return;
    }
    this._root.visible = true;
    const step = TutorialManager.currentStep;
    if (step === TutorialStep.INTRO) {
      this._drawIntro();
      return;
    }
    this._drawGuide(step);
  }

  private _onCompleted = (): void => {
    AudioManager.play('tutorial_ok');
    this._clear();
    if (this._root) this._root.visible = false;
  };

  private _clear(): void {
    this._stopFinger();
    TweenManager.cancelTarget(this._layer);
    this._layer.removeChildren();
    this._shownStep = null;
  }

  private _target(): SpotlightRect | null {
    const ids = [...this._providers.keys()].reverse();
    for (const id of ids) {
      const rect = this._providers.get(id)?.() ?? null;
      if (rect && rect.w > 8 && rect.h > 8) return rect;
    }
    return null;
  }

  private _drawIntro(): void {
    this._clear();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const page = TUTORIAL_INTRO[this._introPage] ?? TUTORIAL_INTRO[0];
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.72;
    dim.eventMode = 'static';
    this._layer.addChild(dim);

    const artH = Math.min(h * 0.46, 520);
    const artW = Math.min(w - 48, artH * 0.75);
    const artY = Game.safeTop + 28;
    this._layer.addChild(this._introArt(page.image, (w - artW) / 2, artY, artW, artH));

    const bubbleY = artY + artH + 18;
    this._layer.addChild(this._speech(page.title, page.body, w / 2, bubbleY, w - 56));

    const btnW = 280;
    const btn = makeSlicedButton({
      label: page.button,
      width: btnW,
      height: 58,
      skin: 'terracotta',
      onReady: () => {
        if (TutorialManager.isStep(TutorialStep.INTRO)) this.refresh();
      },
    });
    btn.position.set((w - btnW) / 2, h - Math.max(36, Game.safeBottom + 28) - 58);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointertap', () => this._nextIntro());
    this._layer.addChild(btn);

    if (this._shownStep !== TutorialStep.INTRO) {
      this._shownStep = TutorialStep.INTRO;
      AudioManager.play('tutorial_pop');
    }
  }

  private _nextIntro(): void {
    AudioManager.play('tutorial_ok');
    if (this._introPage < TUTORIAL_INTRO.length - 1) {
      this._introPage += 1;
      this.refresh();
      return;
    }
    TutorialManager.advanceTo(TutorialStep.GO_OUT);
  }

  private _introArt(path: string, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(x, y);
    whenTextureReady(path, () => {
      if (TutorialManager.isStep(TutorialStep.INTRO)) this.refresh();
    });
    const frame = new PIXI.Graphics();
    frame.lineStyle(4, 0x2A2018, 1);
    frame.beginFill(0x3A2A1C);
    frame.drawRoundedRect(0, 0, width, height, 22);
    frame.endFill();
    root.addChild(frame);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      const scale = Math.max(width / tex.width, height / tex.height);
      sp.anchor.set(0.5);
      sp.scale.set(scale);
      sp.position.set(width / 2, height / 2);
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRoundedRect(6, 6, width - 12, height - 12, 18);
      mask.endFill();
      sp.mask = mask;
      root.addChild(sp, mask);
    }
    return root;
  }

  private _drawGuide(step: TutorialStep): void {
    const fresh = this._shownStep !== step;
    this._clear();
    this._shownStep = step;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const rect = this._target();
    const copy = TUTORIAL_COPY[step];
    if (rect) this._drawHole(rect);
    else {
      const dim = new PIXI.Graphics();
      fillRect(dim, 0, 0, w, h, 0x000000);
      dim.alpha = step === TutorialStep.WAIT_RESULT ? 0.22 : DIM;
      dim.eventMode = step === TutorialStep.WAIT_RESULT ? 'none' : 'static';
      this._layer.addChild(dim);
    }
    if (rect) {
      this._drawGlow(rect);
      this._startFinger(rect.x + rect.w * 0.72, rect.y + rect.h * 0.78);
    }
    if (copy) {
      const bubbleY = this._bubbleY(rect, copy.body);
      this._layer.addChild(this._speech(copy.title, copy.body, w / 2, bubbleY, w - 56));
    }
    if (fresh) AudioManager.play(rect ? 'tutorial_hint' : 'tutorial_pop');
  }

  private _drawHole(sp: SpotlightRect): void {
    const W = Game.designWidth;
    const H = Game.logicHeight;
    if (sp.y > 0) this._dimRect(0, 0, W, sp.y);
    if (sp.y + sp.h < H) this._dimRect(0, sp.y + sp.h, W, H - sp.y - sp.h);
    if (sp.x > 0) this._dimRect(0, sp.y, sp.x, sp.h);
    if (sp.x + sp.w < W) this._dimRect(sp.x + sp.w, sp.y, W - sp.x - sp.w, sp.h);
  }

  private _dimRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    const g = new PIXI.Graphics();
    g.beginFill(0x000000, DIM);
    g.drawRect(x, y, w, h);
    g.endFill();
    g.eventMode = 'static';
    this._layer.addChild(g);
  }

  private _drawGlow(rect: SpotlightRect): void {
    const r = rect.r ?? 16;
    const glow = new PIXI.Graphics();
    glow.lineStyle(6, GOLD, 0.35);
    glow.drawRoundedRect(rect.x - 5, rect.y - 5, rect.w + 10, rect.h + 10, r + 6);
    glow.lineStyle(3, GOLD, 0.95);
    glow.drawRoundedRect(rect.x, rect.y, rect.w, rect.h, r);
    glow.eventMode = 'none';
    this._layer.addChild(glow);
    glow.alpha = 0.82;
    const pulse = (): void => {
      if (glow.destroyed) return;
      TweenManager.to({
        target: glow,
        props: { alpha: 1 },
        duration: 0.55,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (glow.destroyed) return;
          TweenManager.to({
            target: glow,
            props: { alpha: 0.62 },
            duration: 0.55,
            ease: Ease.easeInOutQuad,
            onComplete: pulse,
          });
        },
      });
    };
    pulse();
  }

  private _startFinger(x: number, y: number): void {
    const finger = this._makeFinger();
    finger.position.set(x, y);
    finger.eventMode = 'none';
    this._layer.addChild(finger);
    this._finger = finger;
    const baseY = y;
    const bounce = (): void => {
      if (!this._finger || this._finger.destroyed) return;
      TweenManager.to({
        target: this._finger,
        props: { y: baseY - 16 },
        duration: 0.36,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._finger || this._finger.destroyed) return;
          TweenManager.to({
            target: this._finger,
            props: { y: baseY + 4 },
            duration: 0.36,
            ease: Ease.easeInOutQuad,
            onComplete: bounce,
          });
        },
      });
    };
    bounce();
  }

  private _stopFinger(): void {
    if (this._finger) {
      TweenManager.cancelTarget(this._finger);
      this._finger = null;
    }
  }

  private _makeFinger(): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(TUTORIAL_ASSETS.hand, () => {
      if (TutorialManager.isActive && this._shownStep && this._shownStep !== TutorialStep.INTRO) {
        this.refresh();
      }
    });
    const tex = gameTexture(TUTORIAL_ASSETS.hand);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.46, 0.9);
      sp.width = 92;
      sp.height = 92;
      root.addChild(sp);
      return root;
    }
    const g = new PIXI.Graphics();
    g.beginFill(0xF2C7A4);
    g.lineStyle(3, INK, 1);
    g.drawRoundedRect(-8, 8, 28, 46, 10);
    g.drawRoundedRect(8, -18, 22, 52, 10);
    g.drawCircle(18, -22, 12);
    g.endFill();
    root.addChild(g);
    return root;
  }

  private _speech(title: string, body: string, cx: number, y: number, maxW: number): PIXI.Container {
    const root = new PIXI.Container();
    const width = Math.min(maxW, 640);
    const padL = 92;
    const padR = 28;
    const titleT = makeLabel(title, 28, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
    });
    const bodyT = new PIXI.Text(body, {
      fontFamily: FONT,
      fontSize: 24,
      fill: 0x5A4636,
      fontWeight: '500',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width - padL - padR,
      lineHeight: 36,
    });
    bodyT.eventMode = 'none';
    const height = Math.max(118, 28 + titleT.height + 10 + bodyT.height + 28);
    whenTextureReady(TUTORIAL_ASSETS.paper, () => {
      if (TutorialManager.isActive) this.refresh();
    });
    const paperTex = gameTexture(TUTORIAL_ASSETS.paper);
    if (isTextureReady(paperTex)) {
      const paper = new PIXI.Sprite(paperTex);
      paper.width = width;
      paper.height = height;
      paper.eventMode = 'none';
      root.addChild(paper);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(3, INK, 1);
      g.beginFill(PAPER);
      g.drawRoundedRect(0, 0, width, height, 18);
      g.endFill();
      root.addChild(g);
    }
    const cabbage = this._cabbage();
    cabbage.position.set(46, height / 2);
    root.addChild(cabbage);
    titleT.position.set(padL, 22);
    bodyT.position.set(padL, 22 + titleT.height + 8);
    root.addChild(titleT, bodyT);
    root.position.set(cx - width / 2, y);
    root.eventMode = 'none';
    return root;
  }

  private _cabbage(): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(TUTORIAL_ASSETS.cabbage, () => {
      if (TutorialManager.isActive) this.refresh();
    });
    const tex = gameTexture(TUTORIAL_ASSETS.cabbage);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.width = 78;
      sp.height = 78;
      root.addChild(sp);
      return root;
    }
    const g = new PIXI.Graphics();
    g.beginFill(0xC8E09A);
    g.lineStyle(3, INK, 1);
    g.drawCircle(0, 4, 28);
    g.endFill();
    root.addChild(g);
    return root;
  }

  private _bubbleY(rect: SpotlightRect | null, body: string): number {
    const h = Game.logicHeight;
    const top = Game.safeTop + 16;
    const bottom = h - Math.max(28, Game.safeBottom + 20) - 140;
    if (!rect) return Math.max(top, h * 0.62);
    const above = rect.y - 28 - 130;
    const below = rect.y + rect.h + 18;
    if (below < bottom) return below;
    if (above > top) return above;
    return top;
  }
}

export const TutorialOverlay = new TutorialOverlayClass();
