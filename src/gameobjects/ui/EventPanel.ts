import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { eventVoice, type RunEventLog } from '@/sim';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { fillRect, makeLabel, makePaperChip, makeSlicedButton } from '@/utils/ui';

/**
 * 走过事件卡之后的那一下：半身像 + 一句人话。
 * 白捡不走这里，场景里直接把菜弹出来飞进篮子。
 */
export class EventPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _log: RunEventLog | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 26;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(log: RunEventLog): void {
    if (log.gain) return;
    this._log = log;
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
    this._log = null;
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    const log = this._log;
    if (!log) return;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const voice = eventVoice(log.marketId, log.kind);
    const portrait = voice?.portrait ?? null;
    const x = 24;
    const boxW = w - 48;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.48;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const text = makeLabel(log.text, 25, 0xF4EFE6, {
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: boxW - 76,
      lineHeight: 38,
    });
    const textPad = voice?.speaker ? 46 : 40;
    const boxH = textPad + Math.ceil(text.height) + 28 + 56 + 20;
    const y = Math.round(h - boxH - 150);

    if (portrait) {
      whenTextureReady(portrait, () => {
        if (this._isOpen) this.relayout();
      });
      const tex = gameTexture(portrait);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5, 1);
        fitSpriteInBox(sp, 480, Math.min(580, y - Game.safeTop - 16));
        sp.position.set(Math.round(w * 0.38), y + 34);
        this._root.addChild(sp);
      }
    }

    const panel = new PIXI.Graphics();
    fillRect(panel, x, y, boxW, boxH, 0x3A3228, 20);
    panel.eventMode = 'static';
    this._root.addChild(panel);
    const inner = new PIXI.Graphics();
    fillRect(inner, x + 12, y + 12, boxW - 24, boxH - 24, 0x2C261F, 14);
    inner.alpha = 0.8;
    this._root.addChild(inner);

    if (voice?.speaker) {
      const chip = makePaperChip(voice.speaker, { size: 22 });
      chip.position.set(x + 26, y - 20);
      this._root.addChild(chip);
    }

    text.position.set(x + 38, y + textPad);
    this._root.addChild(text);

    const btnW = 200;
    const btn = makeSlicedButton({
      label: '知道了',
      width: btnW,
      height: 56,
      skin: 'cream',
      textColor: 0x3A3228,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    btn.position.set(x + boxW - btnW - 26, y + boxH - 76);
    btn.on('pointertap', () => this.close());
    this._root.addChild(btn);
  }
}
