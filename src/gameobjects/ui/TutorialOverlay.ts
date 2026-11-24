/**
 * 新手指引层：四块矩形拼暗区，镂空不画所以点击穿透。
 * 白菜站在宣纸引导笺旁，手绘手指自然指引。挂 Game.stage，高于 OverlayManager。
 */
import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { EV } from '@/config/events';
import { TUTORIAL_ASSETS, TUTORIAL_COPY, TUTORIAL_INTRO } from '@/config/TutorialCopy';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { gameTexture, isTextureReady, watchTextures, whenTextureReady } from '@/utils/assets';
import { fillRect, fitTextWidth, makeText } from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawStretchSheet,
  makeSealStamp,
  sceneSprite,
} from './scenePanel';

export interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

export interface TutorialTarget {
  holes?: SpotlightRect[];
  fingerAt?: { x: number; y: number };
  dim?: boolean;
  speech?: 'top' | 'bottom';
  speechY?: number;
  title?: string;
  body?: string;
  onDismiss?: () => void;
}

type ProviderResult = SpotlightRect | TutorialTarget | null;

const WASHI = 'subpkg_images/scene_dex_washi.png';
const INK = SCENE_INK.ink;
const GOLD = 0xE8C15A;
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

function isSpotlightRect(v: ProviderResult): v is SpotlightRect {
  return !!v
    && typeof (v as SpotlightRect).w === 'number'
    && !('holes' in v)
    && !('fingerAt' in v)
    && !('dim' in v)
    && !('speech' in v)
    && !('speechY' in v)
    && !('title' in v)
    && !('body' in v);
}

class TutorialOverlayClass {
  private _root: PIXI.Container | null = null;
  private _layer = new PIXI.Container();
  private _providers = new Map<string, () => ProviderResult>();
  private _contextualProviders = new Map<string, () => TutorialTarget | null>();
  private _introPage = 0;
  private _shownStep: TutorialStep | null = null;
  private _shownContextKey = '';
  private _finger: PIXI.Container | null = null;
  private _tapRipple: PIXI.Graphics | null = null;
  private _tapDot: PIXI.Graphics | null = null;
  private _blankTap: (() => void) | null = null;
  private _paintQueued = false;
  private _onStep = (step: TutorialStep) => {
    if (step === TutorialStep.INTRO) this._introPage = 0;
    this.refresh();
  };

  private _scheduleRefresh = (): void => {
    if (this._paintQueued) return;
    if (!TutorialManager.isActive && !this._shownContextKey) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (TutorialManager.isActive || !!this._shownContextKey) this.refresh();
    });
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
    OverlayManager.onBroughtToFront(() => this.refresh());
    this.refresh();
  }

  ensureTop(): void {
    if (!this._root || !Game.stage) return;
    Game.stage.addChild(this._root);
    this._root.zIndex = 20000;
  }

  register(id: string, get: () => ProviderResult): void {
    this._providers.set(id, get);
    this.refresh();
  }

  unregister(id: string): void {
    this._providers.delete(id);
  }

  registerContextual(id: string, get: () => TutorialTarget | null): void {
    this._contextualProviders.set(id, get);
    this.refresh();
  }

  unregisterContextual(id: string): void {
    this._contextualProviders.delete(id);
    this.refresh();
  }

  onBlankTap(fn: (() => void) | null): void {
    this._blankTap = fn;
  }

  refresh(): void {
    this.mount();
    if (!this._root) return;
    this.ensureTop();
    if (!TutorialManager.isActive) {
      const ctx = this._rawContextual();
      if (!ctx) {
        this._clear();
        this._shownContextKey = '';
        this._root.visible = false;
        return;
      }
      this._root.visible = true;
      this._drawContextual(ctx);
      return;
    }
    this._shownContextKey = '';
    this._root.visible = true;
    const step = TutorialManager.currentStep;
    if (step === TutorialStep.INTRO) {
      this._drawIntro();
      return;
    }
    if (step === TutorialStep.CLAIM_GIFT) {
      this._clear();
      this._root.visible = false;
      return;
    }
    this._drawGuide(step);
  }

  private _rawContextual(): TutorialTarget | null {
    const ids = [...this._contextualProviders.keys()].reverse();
    for (const id of ids) {
      const raw = this._contextualProviders.get(id)?.() ?? null;
      if (raw && (raw.title || raw.body || raw.fingerAt || (raw.holes && raw.holes.length))) {
        return raw;
      }
    }
    return null;
  }

  private _drawContextual(raw: TutorialTarget): void {
    const key = `${raw.title ?? ''}|${raw.body ?? ''}`;
    const fresh = this._shownContextKey !== key;
    this._clear();
    this._shownContextKey = key;
    const w = Game.designWidth;
    const holes = (raw.holes ?? []).filter((h) => h.w > 8 && h.h > 8);
    const fingerAt = raw.fingerAt ?? (holes[0]
      ? { x: holes[0].x + holes[0].w * 0.5, y: holes[0].y + holes[0].h * 0.5 }
      : undefined);

    for (const hole of holes) this._drawGlow(hole);
    if (fingerAt) this._startFinger(fingerAt, holes[0]);

    if (raw.title && raw.body) {
      const speech = this._speech(raw.title, raw.body, w / 2, 0, w - 32, true, undefined, { ...raw, dim: false, holes, fingerAt });
      if (raw.onDismiss) {
        speech.eventMode = 'static';
        speech.cursor = 'pointer';
        speech.on('pointertap', (e) => {
          e.stopPropagation();
          AudioManager.play('ui_click');
          raw.onDismiss?.();
        });
      }
      this._layer.addChild(speech);
    }
    if (fresh) AudioManager.play('tutorial_pop');
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

  private _rawTarget(): ProviderResult {
    const ids = [...this._providers.keys()].reverse();
    for (const id of ids) {
      const raw = this._providers.get(id)?.() ?? null;
      if (!raw) continue;
      if (isSpotlightRect(raw)) {
        if (raw.w > 8 && raw.h > 8) return raw;
        continue;
      }
      if ((raw.holes && raw.holes.length) || raw.fingerAt || raw.dim === false || raw.speech || raw.speechY != null || raw.title || raw.body) {
        return raw;
      }
    }
    return null;
  }

  private _normalize(_step: TutorialStep, rawInput?: ProviderResult): TutorialTarget {
    const raw = rawInput === undefined ? this._rawTarget() : rawInput;
    const dim = TutorialManager.usesMask();
    if (!raw) return { dim };
    if (isSpotlightRect(raw)) {
      return {
        dim,
        holes: [raw],
        fingerAt: { x: raw.x + raw.w * 0.5, y: raw.y + raw.h * 0.5 },
      };
    }
    const holes = (raw.holes ?? []).filter((h) => h.w > 8 && h.h > 8);
    const fingerAt = raw.fingerAt ?? (holes[0]
      ? { x: holes[0].x + holes[0].w * 0.5, y: holes[0].y + holes[0].h * 0.5 }
      : undefined);
    return {
      dim: raw.dim ?? dim,
      holes,
      fingerAt,
      speech: raw.speech,
      speechY: raw.speechY,
      title: raw.title,
      body: raw.body,
    };
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
    dim.cursor = 'pointer';
    dim.on('pointertap', () => this._nextIntro());
    this._layer.addChild(dim);

    const cabbage = this._cabbage(216);
    cabbage.position.set(w / 2, Game.safeTop + Math.min(h * 0.25, 272));
    cabbage.eventMode = 'none';
    this._layer.addChild(cabbage);

    const footHint = `点任意处继续 (${this._introPage + 1}/${TUTORIAL_INTRO.length}) ▸`;
    const bubble = this._speech(page.title, page.body, w / 2, cabbage.y + 132, w - 40, false, footHint);
    this._layer.addChild(bubble);

    const tap = new PIXI.Graphics();
    tap.beginFill(0xffffff, 0.001);
    tap.drawRect(0, 0, w, h);
    tap.endFill();
    tap.eventMode = 'static';
    tap.cursor = 'pointer';
    tap.on('pointertap', () => this._nextIntro());
    this._layer.addChild(tap);

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

  private _drawGuide(step: TutorialStep): void {
    const raw = this._rawTarget();
    if (!raw && (step === TutorialStep.FREE_WALK || step === TutorialStep.HINT_DOOR)) {
      this._clear();
      if (this._root) this._root.visible = false;
      return;
    }
    const fresh = this._shownStep !== step;
    this._clear();
    this._shownStep = step;
    const w = Game.designWidth;
    const target = this._normalize(step, raw);
    const holes = target.holes ?? [];
    const copy = (target.title && target.body)
      ? { title: target.title, body: target.body }
      : TUTORIAL_COPY[step];

    if (target.dim) {
      if (holes.length) {
        for (const hole of holes) this._drawHole(hole);
      }
    }

    for (const hole of holes) this._drawGlow(hole);

    if (TutorialManager.tapHoleAdvances()) {
      for (const hole of holes) this._holeCatcher(hole, step);
    }
    if (step === TutorialStep.COOK_DISH) {
      for (const hole of holes) this._cookHoleCatcher(hole);
    }
    if (step === TutorialStep.CLOSE_BASKET) {
      for (const hole of holes) this._closeBasketHoleCatcher(hole);
    }

    if (target.fingerAt && step !== TutorialStep.WAIT_RESULT) {
      this._startFinger(target.fingerAt, holes[0]);
    }

    if (step === TutorialStep.WAIT_RESULT) {
      const tap = new PIXI.Graphics();
      tap.beginFill(0xffffff, 0.001);
      tap.drawRect(0, 0, w, Game.logicHeight);
      tap.endFill();
      tap.hitArea = new PIXI.Rectangle(0, 0, w, Game.logicHeight);
      tap.eventMode = 'static';
      tap.cursor = 'pointer';
      tap.on('pointertap', () => this._blankTap?.());
      this._layer.addChild(tap);
    }

    if (copy) {
      this._layer.addChild(this._speech(copy.title, copy.body, w / 2, 0, w - 32, true, undefined, target));
    }
    if (fresh) AudioManager.play(holes.length && target.dim ? 'tutorial_hint' : 'tutorial_pop');
  }

  private _holeCatcher(sp: SpotlightRect, step: TutorialStep): void {
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.001);
    g.drawRoundedRect(sp.x, sp.y, sp.w, sp.h, sp.r ?? 16);
    g.endFill();
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.on('pointertap', () => {
      TutorialManager.advanceIf(step);
    });
    this._layer.addChild(g);
  }

  private _lastCookTap = 0;
  private _lastCloseBasketTap = 0;

  private _cookHoleCatcher(sp: SpotlightRect): void {
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.001);
    g.drawRoundedRect(sp.x, sp.y, sp.w, sp.h, sp.r ?? 16);
    g.endFill();
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.on('pointertap', () => {
      const now = Date.now();
      if (now - this._lastCookTap < 280) return;
      this._lastCookTap = now;
      EventBus.emit(EV.tutorialCook);
    });
    this._layer.addChild(g);
  }

  private _closeBasketHoleCatcher(sp: SpotlightRect): void {
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.001);
    g.drawRoundedRect(sp.x, sp.y, sp.w, sp.h, sp.r ?? 16);
    g.endFill();
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.on('pointertap', () => {
      const now = Date.now();
      if (now - this._lastCloseBasketTap < 280) return;
      this._lastCloseBasketTap = now;
      EventBus.emit(EV.tutorialCloseBasket);
    });
    this._layer.addChild(g);
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

  private _resolveFingerPose(
    at: { x: number; y: number },
    hole?: SpotlightRect,
  ): { x: number; y: number; size: number; flipX: boolean; rotation: number } {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const isLargeProp = !!hole && hole.h > 136;
    const size = isLargeProp ? 122 : 108;
    const reachX = Math.round(size * 0.74);
    const reachY = Math.round(size * 0.86);
    let tipX = at.x;
    let tipY = at.y;

    if (hole) {
      if (!isLargeProp) {
        tipY = hole.y + hole.h - 4;
        const preferX = hole.x + hole.w * (hole.w > 180 ? 0.68 : 0.60);
        tipX = preferX + reachX <= w - 8
          ? preferX
          : hole.x + hole.w * (hole.w > 180 ? 0.34 : 0.40);
      } else {
        tipY = hole.y + hole.h * 0.50;
        const preferX = hole.x + hole.w * 0.54;
        tipX = preferX + reachX <= w - 8 ? preferX : hole.x + hole.w * 0.42;
      }
    }

    const flipX = tipX + reachX > w - 8;
    let rotation = 0;
    if (tipY + reachY > h - 8) {
      if (hole) {
        tipX = flipX ? hole.x + 8 : hole.x + hole.w - 8;
        tipY = Math.min(hole.y + hole.h * 0.58, h - reachY - 6);
      } else {
        tipY = h - reachY - 6;
      }
      rotation = flipX ? 0.32 : -0.32;
    }

    return { x: tipX, y: tipY, size, flipX, rotation };
  }

  private _startFinger(at: { x: number; y: number }, hole?: SpotlightRect): void {
    const pose = this._resolveFingerPose(at, hole);

    const ripple = new PIXI.Graphics();
    ripple.lineStyle(5.5, INK, 0.45);
    ripple.drawCircle(0, 0, 18);
    ripple.lineStyle(3.5, 0xFFE26A, 1);
    ripple.beginFill(0xFFF8DC, 0.24);
    ripple.drawCircle(0, 0, 18);
    ripple.endFill();
    ripple.position.set(pose.x, pose.y);
    ripple.eventMode = 'none';
    this._layer.addChild(ripple);
    this._tapRipple = ripple;

    const dot = new PIXI.Graphics();
    dot.lineStyle(2.8, INK, 0.9);
    dot.beginFill(0xFFD447, 0.96);
    dot.drawCircle(0, 0, 9.5);
    dot.endFill();
    dot.lineStyle(0);
    dot.beginFill(0xFFFDF6, 0.95);
    dot.drawCircle(0, 0, 4.5);
    dot.endFill();
    dot.position.set(pose.x, pose.y);
    dot.eventMode = 'none';
    this._layer.addChild(dot);
    this._tapDot = dot;

    const finger = this._makeFinger(pose.size);
    const baseSignX = pose.flipX ? -1 : 1;
    const restDx = pose.flipX ? -16 : 16;
    const restDy = 16;
    const restX = pose.x + restDx;
    const restY = pose.y + restDy;
    finger.scale.set(baseSignX * 1.04, 1.04);
    finger.rotation = pose.rotation;
    finger.position.set(restX, restY);
    finger.eventMode = 'none';
    this._layer.addChild(finger);
    this._finger = finger;

    const bounce = (): void => {
      if (!this._finger || this._finger.destroyed) return;
      if (this._tapRipple && !this._tapRipple.destroyed) {
        this._tapRipple.scale.set(0.6);
        this._tapRipple.alpha = 0.15;
      }
      if (this._tapDot && !this._tapDot.destroyed) {
        this._tapDot.scale.set(0.85);
      }
      TweenManager.to({
        target: this._finger,
        props: { x: pose.x, y: pose.y },
        duration: 0.36,
        ease: Ease.easeInQuad,
      });
      TweenManager.to({
        target: this._finger.scale,
        props: { x: baseSignX * 0.93, y: 0.93 },
        duration: 0.36,
        ease: Ease.easeInQuad,
        onComplete: () => {
          if (!this._finger || this._finger.destroyed) return;
          if (this._tapDot && !this._tapDot.destroyed) {
            this._tapDot.scale.set(1.22);
            TweenManager.to({
              target: this._tapDot.scale,
              props: { x: 0.85, y: 0.85 },
              duration: 0.44,
              ease: Ease.easeOutQuad,
            });
          }
          if (this._tapRipple && !this._tapRipple.destroyed) {
            this._tapRipple.scale.set(0.7);
            this._tapRipple.alpha = 0.95;
            TweenManager.to({
              target: this._tapRipple.scale,
              props: { x: 1.9, y: 1.9 },
              duration: 0.48,
              ease: Ease.easeOutQuad,
            });
            TweenManager.to({
              target: this._tapRipple,
              props: { alpha: 0 },
              duration: 0.48,
              ease: Ease.easeOutQuad,
            });
          }
          TweenManager.to({
            target: this._finger,
            props: { x: restX, y: restY },
            duration: 0.44,
            ease: Ease.easeOutQuad,
          });
          TweenManager.to({
            target: this._finger.scale,
            props: { x: baseSignX * 1.04, y: 1.04 },
            duration: 0.44,
            ease: Ease.easeOutQuad,
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
      TweenManager.cancelTarget(this._finger.scale);
      this._finger = null;
    }
    if (this._tapRipple) {
      TweenManager.cancelTarget(this._tapRipple);
      TweenManager.cancelTarget(this._tapRipple.scale);
      this._tapRipple = null;
    }
    if (this._tapDot) {
      TweenManager.cancelTarget(this._tapDot);
      TweenManager.cancelTarget(this._tapDot.scale);
      this._tapDot = null;
    }
  }

  private _makeFinger(size: number): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(TUTORIAL_ASSETS.hand, () => {
      if (
        (TutorialManager.isActive && this._shownStep && this._shownStep !== TutorialStep.INTRO)
        || !!this._shownContextKey
      ) {
        this._scheduleRefresh();
      }
    });
    const tex = gameTexture(TUTORIAL_ASSETS.hand);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.24, 0.12);
      sp.width = size;
      sp.height = size;
      root.addChild(sp);
      return root;
    }
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 1);
    g.beginFill(0xFFF3DC);
    g.drawCircle(12, 16, 16);
    g.endFill();
    root.addChild(g);
    return root;
  }

  private _speech(
    title: string,
    body: string,
    cx: number,
    y: number,
    maxW: number,
    showCabbage: boolean,
    footHint?: string,
    targetForY?: TutorialTarget,
  ): PIXI.Container {
    watchTextures(
      [SCENE_ART.sheet, SCENE_ART.seal, SCENE_ART.divider, WASHI],
      this._scheduleRefresh,
    );

    const root = new PIXI.Container();
    const cabSize = showCabbage ? 100 : 0;
    const gap = showCabbage ? 8 : 0;
    const width = Math.min(maxW - cabSize - gap, 592);
    // 左右留足 58px 彻底避开宣纸四角黄铜图钉
    const padL = 58;
    const padR = 58;

    const titleT = makeText('title', title, INK, { size: 32 });
    fitTextWidth(titleT, width - padL - padR - 56);

    const bodyT = makeText('body', body, SCENE_INK.soft, {
      size: 25,
      fontWeight: '600',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width - padL - padR,
      lineHeight: 38,
    });

    const titleTop = 30;
    const footH = footHint ? 34 : 0;
    const height = Math.max(150, titleTop + titleT.height + 18 + bodyT.height + footH + 30);

    const paper = this._paper(width, height);
    paper.position.set(cabSize + gap, 0);
    root.addChild(paper);

    const paperLeft = cabSize + gap;
    titleT.position.set(paperLeft + padL, titleTop);
    root.addChild(titleT);

    const seal = makeSealStamp('指引', 42, 0.08);
    seal.position.set(paperLeft + width - 72, titleTop + 18);
    root.addChild(seal);

    const divY = titleTop + titleT.height + 6;
    drawInkDivider(root, paperLeft + padL, divY, width - padL - padR, 0.45, 9);

    bodyT.position.set(paperLeft + padL, divY + 12);
    root.addChild(bodyT);

    if (footHint) {
      const hintLbl = makeText('caption', footHint, SCENE_INK.gold, { size: 22, fontWeight: '700' });
      hintLbl.anchor.set(1, 1);
      hintLbl.position.set(paperLeft + width - padR, height - 20);
      root.addChild(hintLbl);
    }

    if (showCabbage) {
      const cabbage = this._cabbage(cabSize);
      cabbage.position.set(cabSize / 2, height * 0.54);
      root.addChild(cabbage);
    }

    const resolvedY = targetForY ? this._bubbleY(targetForY, height) : y;
    const minTop = Game.safeTop + 14;
    const maxTop = Math.max(minTop, Game.logicHeight - Math.max(28, Game.safeBottom + 20) - height);
    const clampedY = Math.max(minTop, Math.min(resolvedY, maxTop));

    const total = cabSize + gap + width;
    const left = Math.max(10, Math.min(cx - total / 2, Game.designWidth - total - 10));
    root.position.set(left, clampedY);
    root.eventMode = 'none';
    return root;
  }

  private _paper(width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x160C05, 0.28);
    shadow.drawRoundedRect(4, 8, width - 4, height - 2, 16);
    shadow.endFill();
    root.addChild(shadow);

    drawStretchSheet(root, SCENE_ART.sheet, 0, 0, width, height, 84, 72);

    const washi = sceneSprite(WASHI, 128, 24);
    if (washi) {
      washi.anchor.set(0.5);
      washi.rotation = -0.04;
      washi.position.set(width / 2, 2);
      root.addChild(washi);
    }
    return root;
  }

  private _cabbage(size: number): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(TUTORIAL_ASSETS.cabbage, this._scheduleRefresh);
    const tex = gameTexture(TUTORIAL_ASSETS.cabbage);
    root.eventMode = 'none';
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.width = size;
      sp.height = size;
      sp.eventMode = 'none';
      root.addChild(sp);
      return root;
    }
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 1);
    g.beginFill(0xC8E09A);
    g.drawCircle(0, 4, size * 0.36);
    g.endFill();
    root.addChild(g);
    return root;
  }

  private _bubbleY(target: TutorialTarget, bubbleH = 196): number {
    const h = Game.logicHeight;
    const top = Game.safeTop + 16;
    const bottom = Math.max(top, h - Math.max(28, Game.safeBottom + 20) - bubbleH);
    const rect = target.holes?.[0] ?? null;
    if (target.speechY != null) return Math.max(top, Math.min(target.speechY, bottom));
    if (target.speech === 'top') return top;
    if (target.speech === 'bottom') {
      if (rect && rect.y + rect.h + 104 > bottom && rect.y > top + bubbleH + 24) return top;
      return bottom;
    }
    if (!rect || !target.dim) {
      if (rect && rect.y + rect.h + 104 > bottom && rect.y > top + bubbleH + 24) return top;
      return bottom;
    }
    const above = rect.y - 28 - bubbleH;
    const below = rect.y + rect.h + 104;
    if (below <= bottom) return below;
    if (above >= top) return above;
    return top;
  }
}

export const TutorialOverlay = new TutorialOverlayClass();
