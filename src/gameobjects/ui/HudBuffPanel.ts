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
  fillRect,
  makeText,
} from '@/utils/ui';
import { watchTextures } from '@/utils/assets';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makePlateItem,
  makeSealStamp,
  sceneArtPaths,
} from './scenePanel';

const WALL = 'subpkg_images/scene_order_wall.png';
const W = 640;
const ROW_H = 108;
const Z = 40;

export class HudBuffPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _paintQueued = false;

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
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen) this.relayout();
    });
  };

  relayout(): void {
    destroyDisplayChildren(this._root);
    if (!this._isOpen) return;
    const buffs = liveHudBuffs(KitchenManager.save);
    if (!buffs.length) {
      this.close(true);
      return;
    }

    watchTextures(
      [
        WALL,
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        ...buffs.map((buff) => buffIconPath(buff.icon)),
      ],
      this._scheduleRelayout,
    );

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    // 木匾 top=-46, width=336 时底边在 y≈128；宣纸从 y=140 起铺，避免遮挡木匾下沿
    const sheetTop = 140;
    const headerH = 96;
    const sheetH = headerH + buffs.length * ROW_H + 38;
    const panelH = sheetTop + sheetH + 28;

    const hudBottom = Math.max(4, (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) - 16)
      + PLAYER_LEVEL_HUD.height
      + 52;
    const availW = sw - 28;
    const availH = sh - hudBottom - Math.max(24, Game.safeBottom + 16);
    const scale = Math.min(1, availW / W, availH / panelH);

    const scene = new PIXI.Container();
    scene.eventMode = 'static';
    scene.hitArea = new PIXI.Rectangle(0, -52, W, panelH + 62);
    scene.on('pointertap', (e) => e.stopPropagation());
    scene.scale.set(scale);
    scene.position.set(
      Math.round((sw - W * scale) / 2),
      Math.round(Math.max(Game.safeTop + 56, Math.min(hudBottom, sh - panelH * scale - 40))),
    );
    this._root.addChild(scene);

    drawSceneWall(scene, WALL, W, panelH, 160, 110);
    drawPlaqueTitle(scene, '食补增益', W / 2, -46, 336);
    drawSceneClose(scene, W - 44, -20, () => this.close(), this._scheduleRelayout);

    const sheetX = 24;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 110, 96);

    // 抬头内收避开左右铜钉（x: 92..W-92, cy: sheetTop+62）
    const headL = 92;
    const headR = W - 92;
    const contentL = 62;
    const contentW = W - contentL * 2;

    const sub = makeText('body', '刚吃下的热菜食补效果：', SCENE_INK.soft, { size: 24, fontWeight: '700' });
    sub.anchor.set(0, 0.5);
    sub.position.set(headL, sheetTop + 60);
    scene.addChild(sub);

    const seal = makeSealStamp('生效', 46, -0.09);
    seal.position.set(headR - 24, sheetTop + 60);
    scene.addChild(seal);

    drawInkDivider(scene, contentL, sheetTop + headerH - 10, contentW, 0.5, 10);

    buffs.forEach((buff, i) => {
      const ry = sheetTop + headerH + i * ROW_H;
      scene.addChild(this._row(buff, contentL, ry, contentW, ROW_H, i < buffs.length - 1));
    });
  }

  private _row(
    buff: HudBuff,
    x: number,
    y: number,
    width: number,
    height: number,
    divider: boolean,
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(0, y);

    const plateW = 104;
    const plate = makePlateItem({
      iconPath: buffIconPath(buff.icon),
      plateW,
      iconSize: 64,
    });
    plate.position.set(x + plateW / 2, height / 2 + 4);
    root.addChild(plate);

    const textX = x + plateW + 20;
    const label = makeText('body', buff.label, SCENE_INK.ink, {
      size: 25,
      fontWeight: '700',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: width - plateW - 24,
      lineHeight: 36,
    });
    label.anchor.set(0, 0.5);
    label.position.set(textX, height / 2);
    root.addChild(label);

    if (divider) {
      drawInkDivider(root, x, height - 6, width, 0.34, 8);
    }
    return root;
  }
}

let _panel: HudBuffPanel | null = null;

export function ensureHudBuffPanel(): HudBuffPanel {
  if (!_panel || _panel.destroyed) _panel = new HudBuffPanel();
  return _panel;
}
