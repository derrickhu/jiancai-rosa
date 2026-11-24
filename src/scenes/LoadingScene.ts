import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import type { Scene } from '@/core/SceneManager';
import { UI_PALETTE, fillRect, fitTextWidth, makeHandProgressBar, makeText, uiBarPaths } from '@/utils/ui';
import { applyFit, fitCover, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';

export const BOOT_BG = 'boot/loading_bg.jpg';
export const BOOT_TITLE = 'boot/title_logo.png';
export const BOOT_FISH = 'boot/fish.png';

const BAR_W = 580;
const BAR_H = 38;

const MARKET_TIPS = [
  '早集天色有限，认准「急需」食材先收入篮中',
  '窗边老坛封水腌菜，首坛揭盖立送私房大菜谱',
  '每天各菜场天时签不同，挑免单或加步数更划算',
  '喂饱窗边小橘猫阿橘，它会去集市叼回稀有好货',
  '好菜多下锅提升熟练度，解锁星级铜勺与银勺加成',
];

const HEALTH_NOTICE = [
  '《健康游戏忠告》',
  '抵制不良游戏，拒绝盗版游戏 · 注意自我保护，谨防受骗上当',
  '适度游戏益脑，沉迷游戏伤身 · 合理安排时间，享受健康生活',
];

export class LoadingScene implements Scene {
  readonly name = 'loading';
  readonly container = new PIXI.Container();
  private _root = new PIXI.Container();
  private _setBarRatio: ((r: number) => void) | null = null;
  private _pctText: PIXI.Text | null = null;
  private _statusText: PIXI.Text | null = null;
  private _fish: PIXI.Sprite | null = null;
  private _bar = { x: 0, y: 0, w: BAR_W, h: BAR_H };
  private _progress = 0.08;
  private _target = 0.08;
  private _waveT = 0;
  private _paintQueued = false;
  private _tipIdx = Math.floor(Math.random() * MARKET_TIPS.length);
  private _boundUpdate = () => this.update(Game.ticker.deltaMS / 1000);

  private _scheduleRelayout = (): void => {
    if (!this.container.parent || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this.container.parent) this.relayout();
    });
  };

  setProgress(ratio: number): void {
    const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const jumpOrRewind = r < this._target || Math.abs(r - this._progress) >= 0.18;
    this._target = r;
    if (jumpOrRewind) {
      this._progress = r;
    }
    this._paintProgress();
  }

  constructor() {
    this.container.addChild(this._root);
  }

  onEnter(): void {
    this._tipIdx = Math.floor(Math.random() * MARKET_TIPS.length);
    this._paintQueued = false;
    watchTextures([BOOT_BG, BOOT_TITLE, BOOT_FISH, ...uiBarPaths()], this._scheduleRelayout);
    Game.ticker.remove(this._boundUpdate);
    Game.ticker.add(this._boundUpdate);
    this.relayout();
  }

  onExit(): void {
    this._paintQueued = false;
    Game.ticker.remove(this._boundUpdate);
  }

  relayout(): void {
    this._root.removeChildren();
    this._setBarRatio = null;
    this._pctText = null;
    this._statusText = null;
    this._fish = null;
    const w = Game.designWidth;
    const h = Game.logicHeight;

    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x2B1E14);
    this._root.addChild(fallback);

    const bgTex = gameTexture(BOOT_BG);
    if (isTextureReady(bgTex)) {
      const bg = new PIXI.Sprite(bgTex);
      applyFit(bg, fitCover(bgTex.width, bgTex.height, w, h));
      this._root.addChild(bg);
    }

    const footShade = new PIXI.Graphics();
    footShade.beginFill(0x1E120A, 0.48);
    footShade.drawRect(0, h - 320 - Game.safeBottom, w, 320 + Game.safeBottom);
    footShade.endFill();
    this._root.addChild(footShade);

    const titleTex = gameTexture(BOOT_TITLE);
    if (isTextureReady(titleTex)) {
      const title = new PIXI.Sprite(titleTex);
      title.anchor.set(0.5, 0.5);
      const titleW = Math.min(696, w * 0.93);
      title.scale.set(titleW / Math.max(1, titleTex.width));
      title.position.set(w / 2, Math.max(264, Game.safeTop + 190));
      this._root.addChild(title);
    }

    const noticeBottom = Math.max(20, Game.safeBottom + 14);
    const noticeBlockH = 92;
    const barY = h - noticeBottom - noticeBlockH - BAR_H - 18;
    const barW = Math.min(BAR_W, w - 96);
    this._bar = { x: Math.round((w - barW) / 2), y: barY, w: barW, h: BAR_H };

    // ── 温馨市井小贴士 ──────────────────────────────────────────────────────
    this._drawTipSlip(w, barY - 122);

    // ── 进度文字行：左侧烟火状态 + 右侧大号百分比 ───────────────────────────
    const status = makeText('heading', this._statusCopy(this._progress), 0xFFF8EC, {
      size: 26,
      stroke: 0x2A1A0E,
      strokeWidth: 5,
    });
    status.anchor.set(0, 1);
    status.position.set(this._bar.x + 4, barY - 10);
    this._root.addChild(status);
    this._statusText = status;

    const pct = makeText('number', `${Math.round(this._progress * 100)}%`, 0xFFE082, {
      size: 30,
      stroke: 0x2A1A0E,
      strokeWidth: 5,
    });
    pct.anchor.set(1, 1);
    pct.position.set(this._bar.x + this._bar.w - 4, barY - 8);
    this._root.addChild(pct);
    this._pctText = pct;

    // ── 手绘进度槽 ──────────────────────────────────────────────────────────
    const handBar = makeHandProgressBar({
      width: this._bar.w,
      height: this._bar.h,
      ratio: Math.max(0.06, this._progress),
      onReady: this._scheduleRelayout,
    });
    handBar.node.position.set(this._bar.x, this._bar.y);
    this._root.addChild(handBar.node);
    this._setBarRatio = handBar.setRatio;

    const fishTex = gameTexture(BOOT_FISH);
    if (isTextureReady(fishTex)) {
      const fish = new PIXI.Sprite(fishTex);
      fish.anchor.set(0.5);
      fish.rotation = Math.PI / 2;
      const targetH = 56;
      fish.scale.set(targetH / Math.max(1, fishTex.width));
      this._root.addChild(fish);
      this._fish = fish;
    }

    this._paintProgress();

    // ── 健康游戏忠告 ────────────────────────────────────────────────────────
    const noticeTop = barY + BAR_H + 16;
    const nTitle = makeText('caption', HEALTH_NOTICE[0], 0xF3E4CC, {
      size: 22,
      fontWeight: '700',
      stroke: 0x24150B,
      strokeWidth: 4,
    });
    nTitle.anchor.set(0.5, 0);
    nTitle.position.set(w / 2, noticeTop);
    this._root.addChild(nTitle);

    HEALTH_NOTICE.slice(1).forEach((line, i) => {
      const lab = makeText('caption', line, 0xDFCBB0, {
        size: 20,
        fontWeight: '600',
        stroke: 0x24150B,
        strokeWidth: 3,
      });
      lab.anchor.set(0.5, 0);
      fitTextWidth(lab, w - 36);
      lab.position.set(w / 2, noticeTop + 30 + i * 26);
      this._root.addChild(lab);
    });
  }

  private _drawTipSlip(w: number, topY: number): void {
    const slipW = Math.min(646, w - 52);
    const slipH = 60;
    const sx = Math.round((w - slipW) / 2);
    const g = new PIXI.Graphics();
    g.beginFill(0x140B05, 0.28);
    g.drawRoundedRect(sx, topY + 4, slipW, slipH, 10);
    g.endFill();
    g.lineStyle(2.4, UI_PALETTE.ink, 1);
    g.beginFill(0xFAF0DA, 0.96);
    g.drawRoundedRect(sx, topY, slipW, slipH, 8);
    g.endFill();
    g.lineStyle(1, 0xC6A87E, 0.7);
    g.drawRoundedRect(sx + 14, topY + 5, slipW - 28, slipH - 10, 5);
    for (const tx of [sx + 16, sx + slipW - 16]) {
      g.lineStyle(1.4, 0x3A220E, 0.9);
      g.beginFill(0xE5BA60, 1);
      g.drawCircle(tx, topY + slipH / 2, 4);
      g.endFill();
    }
    this._root.addChild(g);

    const tipText = makeText('body', `市井小贴士：${MARKET_TIPS[this._tipIdx]}`, UI_PALETTE.ink, {
      size: 23,
      fontWeight: '700',
    });
    tipText.anchor.set(0.5);
    fitTextWidth(tipText, slipW - 60);
    tipText.position.set(w / 2, topY + slipH / 2);
    this._root.addChild(tipText);
  }

  private _statusCopy(p: number): string {
    if (p < 0.38) return '正在支摊备菜…';
    if (p < 0.78) return '正在挑拣水灵鲜货…';
    return '炉火已旺，马上开张…';
  }

  update(dt: number): void {
    this._waveT += dt;
    const t = Math.min(1, dt * 7);
    this._progress += (this._target - this._progress) * t;
    if (this._target >= 1) this._progress = Math.max(this._progress, 0.98);
    this._paintProgress();
  }

  private _paintProgress(): void {
    const { x, y, w, h } = this._bar;
    const ratio = Math.min(1, Math.max(0.06, this._progress));
    this._setBarRatio?.(ratio);
    if (this._pctText && !this._pctText.destroyed) {
      this._pctText.text = `${Math.round(this._progress * 100)}%`;
    }
    if (this._statusText && !this._statusText.destroyed) {
      this._statusText.text = this._statusCopy(this._progress);
    }
    if (this._fish) {
      const fw = Math.max(h * 1.2, w * ratio);
      const bob = Math.sin(this._waveT * 6) * 2.5;
      this._fish.position.set(x + fw - 8, y + h / 2 + bob);
    }
  }
}
