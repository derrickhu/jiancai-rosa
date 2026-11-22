import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { eventVoice, neighborRewardChips, type RunEventLog } from '@/sim';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures, whenTextureReady } from '@/utils/assets';
import {
  UI_KIT,
  UI_PALETTE,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeHeaderRibbon,
  makeLabel,
  makeRewardStrip,
  makeSlicedButton,
} from '@/utils/ui';

/**
 * 走过事件卡之后的那一下：半身像 + 暖宣纸木框对话卡。
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

    watchTextures([UI_KIT.headerRibbon, UI_KIT.btnOlive], () => {
      if (this._isOpen) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const voice = eventVoice(log.marketId, log.kind);
    const speaker = log.speaker ?? voice?.speaker ?? null;
    const portrait = log.portrait ?? voice?.portrait ?? null;
    const choices = log.choices ?? [];
    const x = 22;
    const boxW = w - 44;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.54;
    dim.eventMode = 'static';
    if (!choices.length) dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const text = makeLabel(log.text, 23, UI_PALETTE.ink, {
      fontWeight: '600',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: boxW - 92,
      lineHeight: 36,
    });
    const textTop = speaker ? 54 : 34;
    const wellH = Math.ceil(text.height) + 32;
    const choiceH = choices.length ? choices.length * 64 + 8 : 60;
    const rewardChips = rewardChipsOf(log);
    const rewardH = rewardChips.length ? 54 : 0;
    const boxH = textTop + wellH + 16 + rewardH + choiceH + 26;
    const y = Math.round(h - boxH - 132);

    if (portrait) {
      whenTextureReady(portrait, () => {
        if (this._isOpen) this.relayout();
      });
      const tex = gameTexture(portrait);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5, 1);
        fitSpriteInBox(sp, 480, Math.min(580, y - Game.safeTop - 12));
        sp.position.set(Math.round(w * 0.38), y + 32);
        this._root.addChild(sp);
      }
    }

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    shell.position.set(x, y);
    this._root.addChild(shell);

    if (speaker) {
      const nameW = Math.max(188, speaker.length * 32 + 96);
      const nameplate = makeHeaderRibbon({
        title: speaker,
        width: nameW,
        height: 54,
        fontSize: 23,
        onReady: () => {
          if (this._isOpen) this.relayout();
        },
      });
      nameplate.position.set(24, -18);
      shell.addChild(nameplate);
    }

    const well = new PIXI.Graphics();
    drawRecessedWell(well, 26, textTop, boxW - 52, wellH, { radius: 16 });
    text.position.set(46, textTop + 16);
    shell.addChild(well, text);

    if (rewardChips.length) {
      const strip = makeRewardStrip(
        rewardChips,
        () => {
          if (this._isOpen) this.relayout();
        },
        '做成给',
        'paper',
      );
      strip.position.set(30, textTop + wellH + 10);
      shell.addChild(strip);
    }

    if (choices.length) {
      choices.forEach((choice, i) => {
        const cost = choice.steps ? ` · 天色-${choice.steps}` : '';
        const isLast = i === choices.length - 1;
        const btn = makeSlicedButton({
          label: `${choice.label}${cost}`,
          width: boxW - 52,
          height: 54,
          skin: isLast ? 'cream' : 'terracotta',
          textColor: isLast ? UI_PALETTE.ink : 0xFFF8F0,
          onReady: () => {
            if (this._isOpen) this.relayout();
          },
        });
        btn.position.set(26, boxH - 22 - (choices.length - i) * 64);
        btn.on('pointertap', () => {
          const pick = this._onChoice;
          const ok = pick?.(i);
          if (ok === false) return;
          this.close();
        });
        shell.addChild(btn);
      });
      return;
    }

    const btnW = 208;
    const btn = makeSlicedButton({
      label: '知道了',
      width: btnW,
      height: 52,
      skin: 'olive',
      textColor: 0xFFF8F0,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    btn.position.set(boxW - btnW - 26, boxH - 76);
    btn.on('pointertap', () => this.close());
    shell.addChild(btn);
  }
}

function rewardChipsOf(log: RunEventLog): Array<{ icon?: string; itemId?: string; label: string }> {
  const rewards = log.rewards;
  if (!rewards) return [];
  return neighborRewardChips({
    gold: rewards.gold ?? 0,
    food: rewards.foods?.[0],
  });
}
