import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { buffIconPath, liveHudBuffs, type HudBuff } from '@/sim';
import { PLAYER_LEVEL_HUD, fillRect, makeLabel } from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';

const INK = 0x2A2018;
const CREAM = 0xF6EDE0;
const PAPER = 0xFFF8F0;
const INDIGO = 0x3D6A82;
const Z = 40;

export class HudBuffPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = Z;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    EventBus.on(EV.kitchenChanged, () => {
      if (this._isOpen) this.relayout();
    });
  }

  open(): void {
    const buffs = liveHudBuffs(KitchenManager.save);
    if (!buffs.length) return;
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;
    const buffs = liveHudBuffs(KitchenManager.save);
    if (!buffs.length) {
      this.close(true);
      return;
    }

    watchTextures(buffs.map((buff) => buffIconPath(buff.icon)), () => {
      if (this._isOpen) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.35;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const cardW = Math.min(520, w - 64);
    const rowH = 88;
    const headH = 36;
    const pad = 28;
    const cardH = pad + headH + 12 + buffs.length * rowH + 16;
    const hudBottom = Math.max(4, (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) - 16)
      + PLAYER_LEVEL_HUD.height
      + 12;
    const x = Math.round((w - cardW) / 2);
    const y = Math.round(Math.min(
      Math.max(hudBottom, Game.safeTop + 24),
      Math.max(24, h - cardH - 80),
    ));

    const card = new PIXI.Container();
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
    card.on('pointertap', (e) => e.stopPropagation());
    card.position.set(x, y);
    this._root.addChild(card);

    const plate = new PIXI.Graphics();
    plate.lineStyle(4, INK, 1);
    plate.beginFill(CREAM);
    plate.drawRoundedRect(0, 0, cardW, cardH, 22);
    plate.endFill();
    plate.beginFill(PAPER);
    plate.drawRoundedRect(12, 12, cardW - 24, cardH - 24, 16);
    plate.endFill();
    card.addChild(plate);

    const title = makeLabel('当前效果', 28, INK, { fontWeight: '700' });
    title.position.set(28, 28);
    card.addChild(title);

    buffs.forEach((buff, i) => {
      card.addChild(this._row(buff, 28, 28 + headH + 12 + i * rowH, cardW - 56, rowH - 8));
    });
  }

  private _row(buff: HudBuff, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const iconBox = 72;
    const iconBg = new PIXI.Graphics();
    iconBg.beginFill(0xE8DFD0, 0.7);
    iconBg.drawRoundedRect(x, y + (height - iconBox) / 2, iconBox, iconBox, 16);
    iconBg.endFill();
    root.addChild(iconBg);

    const path = buffIconPath(buff.icon);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, iconBox - 16, iconBox - 16);
      spr.anchor.set(0.5);
      spr.position.set(x + iconBox / 2, y + height / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    }

    const label = new PIXI.Text(buff.label, {
      fontFamily: 'Kaiti SC, STKaiti, Songti SC, STSong, serif',
      fontSize: 24,
      fill: INDIGO,
      fontWeight: '700',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width - iconBox - 16,
      lineHeight: 34,
    });
    label.anchor.set(0, 0.5);
    label.position.set(x + iconBox + 16, y + height / 2);
    label.eventMode = 'none';
    root.addChild(label);
    return root;
  }
}

let _panel: HudBuffPanel | null = null;

export function ensureHudBuffPanel(): HudBuffPanel {
  if (!_panel || _panel.destroyed) _panel = new HudBuffPanel();
  return _panel;
}
