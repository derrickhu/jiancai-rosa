import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_MAX_LEVEL,
  furnLabel,
  furnLevel,
  houseFurnCap,
  houseLabel,
  houseLevel,
  houseUpgradeState,
  minHouseForFurn,
  furnUpgradeState,
  type FurnId,
} from '@/sim';
import { fillRect, makeButton, makeLabel } from '@/utils/ui';

export class UpgradePanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 24;
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(): void {
    this._isOpen = false;
    this.visible = false;
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.55;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const panel = new PIXI.Graphics();
    fillRect(panel, 24, Game.safeTop + 20, w - 48, h - Game.safeTop - 40, 0x3A3228, 18);
    panel.eventMode = 'static';
    this._root.addChild(panel);

    const title = makeLabel('装修厨房', 34, 0xF4EFE6);
    title.position.set(48, Game.safeTop + 40);
    this._root.addChild(title);
    const hint = makeLabel('大件家具要先把屋子装修上去，才放得下', 20, 0xC9B8A4);
    hint.position.set(48, Game.safeTop + 86);
    this._root.addChild(hint);

    const save = KitchenManager.save;
    const house = houseLevel(save);
    this._root.addChild(this._houseRow(house, 40, Game.safeTop + 128, w - 80));

    let y = Game.safeTop + 212;
    for (const id of FURN_IDS) {
      this._root.addChild(this._row(id, furnLevel(save, id), house, 40, y, w - 80));
      y += 68;
    }

    const close = makeButton('关掉', w - 96, 56, 0xC46A3A);
    close.position.set(48, h - 100);
    close.on('pointertap', () => this.close());
    this._root.addChild(close);
  }

  private _houseRow(level: number, x: number, y: number, width: number): PIXI.Container {
    const row = new PIXI.Container();
    const bg = new PIXI.Graphics();
    fillRect(bg, x, y, width, 72, 0x4A3A28, 10);
    row.addChild(bg);
    const name = makeLabel(`${houseLabel(level)}  ${level + 1}/${HOUSE_MAX_LEVEL + 1}档`, 26, 0xF4EFE6);
    name.position.set(x + 16, y + 20);
    row.addChild(name);
    if (level >= HOUSE_MAX_LEVEL) {
      const done = makeLabel('最大', 22, 0xC8E6A0);
      done.position.set(x + width - 90, y + 22);
      row.addChild(done);
      return row;
    }
    const state = houseUpgradeState(KitchenManager.save);
    const ready = state.status === 'ready';
    const label = state.status === 'blocked' ? state.error : `装修 ${state.status === 'max' ? 0 : state.cost}`;
    const btn = makeButton(label, 168, 52, ready ? 0xC46A3A : 0x5A5248);
    btn.alpha = ready ? 1 : 0.45;
    btn.position.set(x + width - 180, y + 10);
    btn.on('pointertap', () => {
      KitchenManager.upgradeHouse();
      this.relayout();
    });
    row.addChild(btn);
    return row;
  }

  private _row(id: FurnId, level: number, house: number, x: number, y: number, width: number): PIXI.Container {
    const row = new PIXI.Container();
    const bg = new PIXI.Graphics();
    fillRect(bg, x, y, width, 60, 0x2C261F, 10);
    row.addChild(bg);
    const name = makeLabel(`${furnLabel(id, level)}  ${level + 1}/${FURN_MAX_LEVEL + 1}级`, 22, 0xF4EFE6);
    name.position.set(x + 16, y + 16);
    row.addChild(name);
    if (level >= FURN_MAX_LEVEL) {
      const done = makeLabel('满级', 20, 0xC8E6A0);
      done.position.set(x + width - 90, y + 16);
      row.addChild(done);
      return row;
    }
    const state = furnUpgradeState(KitchenManager.save, id);
    if (state.status === 'blocked' && level >= houseFurnCap(house, id)) {
      const need = houseLabel(minHouseForFurn(id, level + 1));
      const locked = makeLabel(`要${need}`, 20, 0xE0A100);
      locked.alpha = 0.7;
      locked.position.set(x + width - 140, y + 16);
      row.addChild(locked);
      return row;
    }
    const cost = state.status === 'max' ? 0 : state.cost;
    const ready = state.status === 'ready';
    const btn = makeButton(`${cost}金币`, 150, 44, ready ? 0x5C6B4A : 0x5A5248);
    btn.alpha = ready ? 1 : 0.45;
    btn.position.set(x + width - 162, y + 8);
    btn.on('pointertap', () => {
      KitchenManager.upgrade(id);
      this.relayout();
    });
    row.addChild(btn);
    return row;
  }
}
