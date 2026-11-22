import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { buffIconPath, liveHudBuffs, type HudBuff } from '@/sim';
import {
  PLAYER_LEVEL_HUD,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeLabel,
} from '@/utils/ui';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';

const INDIGO = 0x35647B;
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

    watchTextures(
      [UI_KIT.headerRibbon, UI_KIT.closeRound, ...buffs.map((buff) => buffIconPath(buff.icon))],
      () => {
        if (this._isOpen) this.relayout();
      },
    );

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.48;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const cardW = Math.min(540, w - 56);
    const rowH = 88;
    const rowGap = 10;
    const contentTop = 66;
    const cardH = contentTop + buffs.length * rowH + (buffs.length - 1) * rowGap + 28;
    const hudBottom = Math.max(4, (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) - 16)
      + PLAYER_LEVEL_HUD.height
      + 22;
    const x = Math.round((w - cardW) / 2);
    const y = Math.round(Math.min(
      Math.max(hudBottom, Game.safeTop + 32),
      Math.max(32, h - cardH - 80),
    ));

    const { shell } = makeArtisanShell({
      width: cardW,
      height: cardH,
      title: '食 补 增 益',
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this.close(),
    });
    shell.position.set(x, y);
    this._root.addChild(shell);

    buffs.forEach((buff, i) => {
      shell.addChild(this._row(buff, 24, contentTop + i * (rowH + rowGap), cardW - 48, rowH));
    });
  }

  private _row(buff: HudBuff, x: number, y: number, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, { radius: 16, tone: 'ivory' });
    root.addChild(bg);

    const iconBox = 64;
    const iy = y + Math.round((height - iconBox) / 2);
    const iconBg = new PIXI.Graphics();
    drawRecessedWell(iconBg, x + 12, iy, iconBox, iconBox, { radius: 14 });
    root.addChild(iconBg);

    const path = buffIconPath(buff.icon);
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, iconBox - 12, iconBox - 12);
      spr.anchor.set(0.5);
      spr.position.set(x + 12 + iconBox / 2, y + height / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    }

    const label = makeLabel(buff.label, 20, INDIGO, {
      fontWeight: '700',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width - iconBox - 44,
      lineHeight: 28,
    });
    label.anchor.set(0, 0.5);
    label.position.set(x + iconBox + 28, y + height / 2);
    root.addChild(label);
    return root;
  }
}

let _panel: HudBuffPanel | null = null;

export function ensureHudBuffPanel(): HudBuffPanel {
  if (!_panel || _panel.destroyed) _panel = new HudBuffPanel();
  return _panel;
}
