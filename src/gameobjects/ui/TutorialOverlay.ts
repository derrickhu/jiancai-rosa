/**
 * 新手指引层：四块矩形拼暗区，镂空不画所以点击穿透。
 * 白菜站在气泡外面，手指横着指。挂 Game.stage，高于 OverlayManager。
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
import { gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { FONT, fillRect, makeLabel } from '@/utils/ui';

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
}

type ProviderResult = SpotlightRect | TutorialTarget | null;

const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const GOLD = 0xE8C15A;
const PAPER = 0xFFF6EA;
const CLIP = 0x8B5A2B;
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
  private _introPage = 0;
  private _shownStep: TutorialStep | null = null;
  private _finger: PIXI.Container | null = null;
  private _blankTap: (() => void) | null = null;
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

  onBlankTap(fn: (() => void) | null): void {
    this._blankTap = fn;
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

  private _normalize(step: TutorialStep): TutorialTarget {
    const raw = this._rawTarget();
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

    const cabbage = this._cabbage(200);
    cabbage.position.set(w / 2, Game.safeTop + Math.min(h * 0.26, 280));
    cabbage.eventMode = 'none';
    this._layer.addChild(cabbage);

    const bubble = this._speech(page.title, page.body, w / 2, cabbage.y + 132, w - 48, false);
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
    const fresh = this._shownStep !== step;
    this._clear();
    this._shownStep = step;
    const w = Game.designWidth;
    const target = this._normalize(step);
    const holes = target.holes ?? [];
    const copy = (target.title && target.body)
      ? { title: target.title, body: target.body }
      : TUTORIAL_COPY[step];

    if (target.dim) {
      if (holes.length) {
        for (const hole of holes) this._drawHole(hole);
      } else {
        const dim = new PIXI.Graphics();
        fillRect(dim, 0, 0, w, Game.logicHeight, 0x000000);
        dim.alpha = DIM;
        dim.eventMode = 'static';
        this._layer.addChild(dim);
      }
    }

    if (target.dim) {
      for (const hole of holes) this._drawGlow(hole);
    }

    if (TutorialManager.tapHoleAdvances()) {
      for (const hole of holes) this._holeCatcher(hole, step);
    }

    if (target.fingerAt && step !== TutorialStep.WAIT_RESULT) {
      this._startFinger(target.fingerAt);
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
      const bubbleY = this._bubbleY(target);
      this._layer.addChild(this._speech(copy.title, copy.body, w / 2, bubbleY, w - 56, true));
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

  private _startFinger(at: { x: number; y: number }): void {
    const finger = this._makeFinger();
    const flip = at.x + 120 > Game.designWidth - 16;
    const x = flip ? at.x - 8 : at.x + 40;
    const y = at.y;
    finger.scale.x = flip ? -1 : 1;
    finger.position.set(x, y);
    finger.eventMode = 'none';
    this._layer.addChild(finger);
    this._finger = finger;
    const toward = flip ? -14 : 14;
    const bounce = (): void => {
      if (!this._finger || this._finger.destroyed) return;
      TweenManager.to({
        target: this._finger,
        props: { x: x + toward },
        duration: 0.36,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._finger || this._finger.destroyed) return;
          TweenManager.to({
            target: this._finger,
            props: { x },
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
      sp.anchor.set(0.08, 0.38);
      sp.width = 96;
      sp.height = 96;
      root.addChild(sp);
      return root;
    }
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 1);
    g.beginFill(0xF2C7A4);
    g.drawRoundedRect(8, -16, 46, 28, 10);
    g.drawRoundedRect(-36, -10, 52, 18, 9);
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
  ): PIXI.Container {
    const root = new PIXI.Container();
    const cabSize = showCabbage ? 96 : 0;
    const gap = showCabbage ? 10 : 0;
    const width = Math.min(maxW - cabSize - gap, 560);
    const padL = 26;
    const padR = 26;
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
    const paper = this._paper(width, height);
    paper.position.set(cabSize + gap, 0);
    root.addChild(paper);
    titleT.position.set(cabSize + gap + padL, 22);
    bodyT.position.set(cabSize + gap + padL, 22 + titleT.height + 8);
    root.addChild(titleT, bodyT);

    if (showCabbage) {
      const cabbage = this._cabbage(cabSize);
      cabbage.position.set(cabSize / 2, height * 0.52);
      root.addChild(cabbage);
    }

    const total = cabSize + gap + width;
    const left = Math.max(14, Math.min(cx - total / 2, Game.designWidth - total - 14));
    root.position.set(left, y);
    root.eventMode = 'none';
    return root;
  }

  private _paper(width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.beginFill(0x2A2018, 0.16);
    g.drawRoundedRect(4, 6, width, height, 18);
    g.endFill();
    g.lineStyle(3, INK, 1);
    g.beginFill(PAPER);
    g.drawRoundedRect(0, 0, width, height, 18);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(0xF3E2C4, 0.55);
    g.drawRoundedRect(10, 8, width - 20, 10, 4);
    g.endFill();
    root.addChild(g);

    const clip = new PIXI.Graphics();
    clip.beginFill(CLIP);
    clip.drawRoundedRect(width / 2 - 16, -10, 32, 22, 5);
    clip.endFill();
    clip.beginFill(0xC48A3A);
    clip.drawRoundedRect(width / 2 - 12, -6, 24, 8, 3);
    clip.endFill();
    root.addChild(clip);
    return root;
  }

  private _cabbage(size: number): PIXI.Container {
    const root = new PIXI.Container();
    whenTextureReady(TUTORIAL_ASSETS.cabbage, () => {
      if (TutorialManager.isActive) this.refresh();
    });
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

  private _bubbleY(target: TutorialTarget): number {
    const h = Game.logicHeight;
    const top = Game.safeTop + 16;
    const bottom = h - Math.max(28, Game.safeBottom + 20) - 150;
    if (target.speechY != null) return target.speechY;
    if (target.speech === 'top') return top;
    if (target.speech === 'bottom') return bottom;
    const rect = target.holes?.[0] ?? null;
    if (!rect || !target.dim) return bottom;
    const above = rect.y - 28 - 130;
    const below = rect.y + rect.h + 18;
    if (below < bottom) return below;
    if (above > top) return above;
    return top;
  }
}

export const TutorialOverlay = new TutorialOverlayClass();
