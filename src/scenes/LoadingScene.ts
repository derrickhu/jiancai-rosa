import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import type { Scene } from '@/core/SceneManager';
import { fillRect, makeLabel } from '@/utils/ui';
import { applyFit, fitCover, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';

export const BOOT_BG = 'boot/loading_bg.jpg';
export const BOOT_TITLE = 'boot/title_logo.png';
export const BOOT_FISH = 'boot/fish.png';

const BAR_W = 520;
const BAR_H = 32;
const HEALTH_NOTICE = [
  '健康游戏公告',
  '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。',
];

export class LoadingScene implements Scene {
  readonly name = 'loading';
  readonly container = new PIXI.Container();
  private _root = new PIXI.Container();
  private _barFill: PIXI.Graphics | null = null;
  private _fish: PIXI.Sprite | null = null;
  private _bar = { x: 0, y: 0, w: BAR_W, h: BAR_H };
  private _progress = 0.16;
  private _boundUpdate = () => this.update(Game.ticker.deltaMS / 1000);

  constructor() {
    this.container.addChild(this._root);
  }

  onEnter(): void {
    Game.ticker.add(this._boundUpdate);
    this.relayout();
  }

  onExit(): void {
    Game.ticker.remove(this._boundUpdate);
  }

  relayout(): void {
    this._root.removeChildren();
    this._barFill = null;
    this._fish = null;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const redraw = () => {
      if (this.container.parent) this.relayout();
    };

    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x1A2430);
    this._root.addChild(fallback);

    const bgTex = gameTexture(BOOT_BG);
    whenTextureReady(BOOT_BG, redraw);
    if (isTextureReady(bgTex)) {
      const bg = new PIXI.Sprite(bgTex);
      applyFit(bg, fitCover(bgTex.width, bgTex.height, w, h));
      this._root.addChild(bg);
    }

    const titleTex = gameTexture(BOOT_TITLE);
    whenTextureReady(BOOT_TITLE, redraw);
    if (isTextureReady(titleTex)) {
      const title = new PIXI.Sprite(titleTex);
      title.anchor.set(0.5, 0.5);
      const titleW = Math.min(700, w * 0.94);
      title.scale.set(titleW / Math.max(1, titleTex.width));
      title.position.set(w / 2, Math.max(168, Game.safeTop + 96));
      this._root.addChild(title);
    }

    const noticeBottom = 22 + Game.safeBottom;
    const barY = h - noticeBottom - 92;
    this._bar = { x: (w - BAR_W) / 2, y: barY, w: BAR_W, h: BAR_H };

    const hint = makeLabel('正在开摊…', 26, 0xF4EFE6, { fontWeight: '700' });
    hint.anchor.set(0.5);
    hint.position.set(w / 2, barY - 28);
    this._root.addChild(hint);

    this._drawBar();

    const fishTex = gameTexture(BOOT_FISH);
    whenTextureReady(BOOT_FISH, redraw);
    if (isTextureReady(fishTex)) {
      const fish = new PIXI.Sprite(fishTex);
      fish.anchor.set(0.5);
      fish.rotation = Math.PI / 2;
      const targetH = 48;
      fish.scale.set(targetH / Math.max(1, fishTex.width));
      this._root.addChild(fish);
      this._fish = fish;
    }

    this._paintProgress();

    const title = makeLabel(HEALTH_NOTICE[0], 18, 0xE8D8C0, { fontWeight: '700' });
    title.anchor.set(0.5, 0);
    title.position.set(w / 2, barY + BAR_H + 16);
    this._root.addChild(title);
    HEALTH_NOTICE.slice(1).forEach((line, i) => {
      const lab = makeLabel(line, 14, 0xC8B8A0, { fontWeight: '500' });
      lab.anchor.set(0.5, 0);
      lab.position.set(w / 2, barY + BAR_H + 40 + i * 20);
      this._root.addChild(lab);
    });
  }

  update(dt: number): void {
    this._progress = Math.min(0.96, this._progress + dt * 0.22);
    this._paintProgress();
  }

  private _drawBar(): void {
    const { x, y, w, h } = this._bar;
    const rim = new PIXI.Graphics();
    fillRect(rim, x - 4, y - 4, w + 8, h + 8, 0xC4A574, 18);
    this._root.addChild(rim);
    const well = new PIXI.Graphics();
    fillRect(well, x, y, w, h, 0x1A1410, 14);
    this._root.addChild(well);
    const fill = new PIXI.Graphics();
    this._root.addChild(fill);
    this._barFill = fill;
  }

  private _paintProgress(): void {
    const { x, y, w, h } = this._bar;
    const fw = Math.max(h, w * this._progress);
    if (this._barFill) {
      this._barFill.clear();
      fillRect(this._barFill, x, y, fw, h, 0xE07A3A, 14);
      fillRect(this._barFill, x, y, fw, Math.max(6, h * 0.38), 0xF0A05A, 14);
    }
    if (this._fish) {
      this._fish.position.set(x + fw - 6, y + h / 2);
    }
  }
}
