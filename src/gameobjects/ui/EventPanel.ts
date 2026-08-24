import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { eventVoice, type RunEventLog } from '@/sim';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from '@/utils/assets';
import { fillRect, makeLabel, makePaperChip, makeSlicedButton } from '@/utils/ui';

/**
 * 走过事件卡之后的那一下：半身像 + 一句人话。
 * 白捡不走这里，场景里直接把菜弹出来飞进篮子。
 * talk 带选项时必须点一项，点暗幕不关。
 */
export class EventPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _log: RunEventLog | null = null;
  private _onChoice: ((index: number) => boolean | void) | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 26;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(log: RunEventLog, onChoice?: (index: number) => boolean | void): void {
    if (log.gain && !log.choices?.length) return;
    AudioManager.play('event_pop');
    this._log = log;
    this._onChoice = onChoice ?? null;
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._log = null;
    this._onChoice = null;
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    const log = this._log;
    if (!log) return;
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const voice = eventVoice(log.marketId, log.kind);
    const speaker = log.speaker ?? voice?.speaker ?? null;
    const portrait = log.portrait ?? voice?.portrait ?? null;
    const choices = log.choices ?? [];
    const x = 24;
    const boxW = w - 48;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.48;
    dim.eventMode = 'static';
    if (!choices.length) dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const text = makeLabel(log.text, 25, 0xF4EFE6, {
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: boxW - 76,
      lineHeight: 38,
    });
    const textPad = speaker ? 46 : 40;
    const choiceH = choices.length ? choices.length * 64 + 8 : 56;
    const boxH = textPad + Math.ceil(text.height) + 28 + choiceH + 20;
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

    if (speaker) {
      const chip = makePaperChip(speaker, { size: 22 });
      chip.position.set(x + 26, y - 20);
      this._root.addChild(chip);
    }

    text.position.set(x + 38, y + textPad);
    this._root.addChild(text);

    if (choices.length) {
      choices.forEach((choice, i) => {
        const cost = choice.steps ? ` · 天色-${choice.steps}` : '';
        const btn = makeSlicedButton({
          label: `${choice.label}${cost}`,
          width: boxW - 52,
          height: 56,
          skin: i === choices.length - 1 ? 'cream' : 'terracotta',
          textColor: i === choices.length - 1 ? 0x3A3228 : 0xFFF8F0,
          onReady: () => {
            if (this._isOpen) this.relayout();
          },
        });
        btn.position.set(x + 26, y + boxH - 20 - (choices.length - i) * 64);
        btn.on('pointertap', () => {
          const pick = this._onChoice;
          const ok = pick?.(i);
          if (ok === false) return;
          this.close();
        });
        this._root.addChild(btn);
      });
      return;
    }

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
