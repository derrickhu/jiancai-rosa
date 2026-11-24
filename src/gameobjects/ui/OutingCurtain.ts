import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { Ease, TweenManager } from '@/core/TweenManager';
import { applyFit, fitCover, gameTexture, isTextureReady, isTextureSettled, preloadTextures, watchTextures, whenTextureReady } from '@/utils/assets';
import { OUTING_CURTAIN } from '@/utils/outingAssets';
import { fillRect, makeText } from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawStretchSheet,
  makeSealStamp,
  sceneArtPaths,
} from './scenePanel';

const MAX_WAIT = 8;
const CELL = 62;
const SHRINK = 0.42;
const STAGGER = 0.58;

type Dot = { x: number; y: number; maxR: number; delay: number };

/**
 * 出门/归家转场幕布：只在下一页贴图尚未就绪时遮挡过渡，已在缓存则零延迟直入；
 * 加载期间展示木牌匾 + 宣纸出行纸签与轻柔呼吸律动，就绪后圆点网格退散。
 */
class OutingCurtainClass {
  readonly container = new PIXI.Container();
  private _sheet = new PIXI.Container();
  private _centerCard: PIXI.Container | null = null;
  private _maskG = new PIXI.Graphics();
  private _dots: Dot[] = [];
  private _busy = false;
  private _revealT = -1;
  private _boundTick = () => this._tick(Game.ticker.deltaMS / 1000);

  get busy(): boolean {
    return this._busy;
  }

  play(opts: { paths: string[]; then: () => void }): void {
    if (this._busy) return;
    const pending = [...new Set(opts.paths.filter(Boolean))].filter((path) => !isTextureSettled(path));
    if (!pending.length) {
      opts.then();
      return;
    }

    this._busy = true;
    this._revealT = -1;
    this._mount();
    this._paint();
    this._lift();

    const timeout = new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, MAX_WAIT * 1000);
    });
    void Promise.race([preloadTextures(pending), timeout]).then(() => {
      try {
        opts.then();
      } catch (e) {
        console.warn('[OutingCurtain] then', e);
      }
      this._lift();
      this._revealT = 0;
    });
  }

  private _mount(): void {
    if (!this.container.parent && Game.stage) {
      this.container.zIndex = 20000;
      Game.stage.addChild(this.container);
    }
    Game.ticker.remove(this._boundTick);
    Game.ticker.add(this._boundTick);
  }

  private _lift(): void {
    const parent = this.container.parent;
    if (!parent) return;
    parent.removeChild(this.container);
    parent.addChild(this.container);
  }

  private _paint(): void {
    this._stopCardAnim();
    this.container.removeChildren();
    this._sheet.removeChildren();
    this.container.alpha = 1;
    this.container.visible = true;
    this.container.eventMode = 'static';
    this.container.cursor = 'default';

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    this.container.removeAllListeners();
    this.container.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
    });

    const bgLayer = new PIXI.Container();
    const paper = new PIXI.Graphics();
    fillRect(paper, 0, 0, w, h, 0xF3E2C6);
    bgLayer.addChild(paper);
    this._sheet.addChild(bgLayer);

    const paintCover = (): void => {
      if (!this.container.visible || this.container.destroyed) return;
      const tex = gameTexture(OUTING_CURTAIN);
      if (!isTextureReady(tex)) return;
      const old = bgLayer.children.find((c) => c instanceof PIXI.Sprite);
      if (old) bgLayer.removeChild(old);
      const sp = new PIXI.Sprite(tex);
      applyFit(sp, fitCover(tex.width, tex.height, w, h));
      bgLayer.addChild(sp);
    };
    whenTextureReady(OUTING_CURTAIN, paintCover);
    paintCover();

    // 中心木牌匾 + 宣纸路引签（带呼吸动效）
    const cardHost = new PIXI.Container();
    cardHost.position.set(w / 2, Math.round(h * 0.46));
    this._sheet.addChild(cardHost);
    this._centerCard = cardHost;

    const rebuildSign = (): void => {
      if (!this.container.visible || cardHost.destroyed) return;
      cardHost.removeChildren();

      const noteW = 508;
      const noteH = 224;
      const noteTop = -32;
      const shadow = new PIXI.Graphics();
      shadow.beginFill(0x2A1A0E, 0.22);
      shadow.drawRoundedRect(-noteW / 2 + 6, noteTop + 6, noteW - 4, noteH + 4, 18);
      shadow.endFill();
      cardHost.addChild(shadow);

      drawStretchSheet(cardHost, SCENE_ART.sheet, -noteW / 2, noteTop, noteW, noteH, 86, 74);
      drawPlaqueTitle(cardHost, '市井烟火路', 0, -228, 352);

      const line1 = makeText('title', '提着竹篮 · 寻味街巷', SCENE_INK.ink, { size: 30 });
      line1.anchor.set(0.5);
      line1.position.set(0, noteTop + 68);
      cardHost.addChild(line1);

      drawInkDivider(cardHost, -noteW / 2 + 56, noteTop + 108, noteW - 112, 0.45, 9);

      const line2 = makeText('body', '正在铺开热气腾腾的摊头…', SCENE_INK.soft, { size: 24, fontWeight: '600' });
      line2.anchor.set(0.5);
      line2.position.set(0, noteTop + 152);
      cardHost.addChild(line2);

      const seal = makeSealStamp('赶集', 46, 0.09);
      seal.position.set(noteW / 2 - 76, noteTop + 68);
      cardHost.addChild(seal);
    };
    watchTextures(sceneArtPaths(), rebuildSign);
    rebuildSign();
    this._breatheCard(cardHost, cardHost.y);

    this._dots = this._makeDots(w, h);
    this._drawMask(0);
    this._sheet.mask = this._maskG;
    this.container.addChild(this._sheet);
    this.container.addChild(this._maskG);
  }

  private _breatheCard(card: PIXI.Container, baseY: number): void {
    const floatUp = (): void => {
      if (!this._busy || card.destroyed) return;
      TweenManager.to({
        target: card,
        props: { y: baseY - 6 },
        duration: 0.9,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._busy || card.destroyed) return;
          TweenManager.to({
            target: card,
            props: { y: baseY + 6 },
            duration: 0.9,
            ease: Ease.easeInOutQuad,
            onComplete: floatUp,
          });
        },
      });
    };
    floatUp();
  }

  private _stopCardAnim(): void {
    if (this._centerCard) {
      TweenManager.cancelTarget(this._centerCard);
      this._centerCard = null;
    }
  }

  private _makeDots(w: number, h: number): Dot[] {
    const cols = Math.ceil(w / CELL) + 1;
    const rows = Math.ceil(h / CELL) + 1;
    const maxR = CELL * 0.78;
    const farthest = cols + rows - 2;
    const dots: Dot[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        dots.push({
          x: col * CELL,
          y: row * CELL,
          maxR,
          delay: farthest > 0 ? ((col + row) / farthest) * STAGGER : 0,
        });
      }
    }
    return dots;
  }

  private _drawMask(elapsed: number): void {
    const g = this._maskG;
    g.clear();
    g.beginFill(0xffffff);
    for (const dot of this._dots) {
      const local = Math.max(0, Math.min(1, (elapsed - dot.delay) / SHRINK));
      const k = local * local;
      const r = dot.maxR * (1 - k);
      if (r > 0.4) g.drawCircle(dot.x, dot.y, r);
    }
    g.endFill();
  }

  private _tick(dt: number): void {
    if (this._revealT < 0 || !this.container.visible) return;
    this._revealT += dt;
    this._drawMask(this._revealT);
    if (this._revealT >= STAGGER + SHRINK) this._clear();
  }

  private _clear(): void {
    Game.ticker.remove(this._boundTick);
    this._stopCardAnim();
    this._revealT = -1;
    this._sheet.mask = null;
    this.container.removeAllListeners();
    this.container.removeChildren();
    this._sheet.removeChildren();
    this._maskG.clear();
    this.container.visible = false;
    this.container.eventMode = 'none';
    this._busy = false;
  }
}

export const OutingCurtain = new OutingCurtainClass();
