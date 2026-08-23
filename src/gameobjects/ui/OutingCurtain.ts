import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { applyFit, fitCover, gameTexture, isTextureReady, isTextureSettled, preloadTextures, whenTextureReady } from '@/utils/assets';
import { OUTING_CURTAIN } from '@/utils/outingAssets';
import { fillRect } from '@/utils/ui';

const MAX_WAIT = 8;
const CELL = 62;
const SHRINK = 0.42;
const STAGGER = 0.58;

type Dot = { x: number; y: number; maxR: number; delay: number };

/**
 * 出门过场：只在下一页图还没齐时挡住。已经在缓存里就直接进。
 * 齐了用圆点网格缩小露出底图。
 */
class OutingCurtainClass {
  readonly container = new PIXI.Container();
  private _sheet = new PIXI.Container();
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
    this.container.removeChildren();
    this._sheet.removeChildren();
    this.container.alpha = 1;
    this.container.visible = true;
    this.container.eventMode = 'static';
    this.container.cursor = 'default';

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    this.container.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
    });

    const paper = new PIXI.Graphics();
    fillRect(paper, 0, 0, w, h, 0xF3E2C6);
    this._sheet.addChild(paper);

    const paintCover = (): void => {
      if (!this.container.visible || this.container.destroyed) return;
      const tex = gameTexture(OUTING_CURTAIN);
      if (!isTextureReady(tex)) return;
      const old = this._sheet.children.find((c) => c instanceof PIXI.Sprite);
      if (old) this._sheet.removeChild(old);
      const sp = new PIXI.Sprite(tex);
      applyFit(sp, fitCover(tex.width, tex.height, w, h));
      this._sheet.addChild(sp);
    };
    whenTextureReady(OUTING_CURTAIN, paintCover);
    paintCover();

    this._dots = this._makeDots(w, h);
    this._drawMask(0);
    this._sheet.mask = this._maskG;
    this.container.addChild(this._sheet);
    this.container.addChild(this._maskG);
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
