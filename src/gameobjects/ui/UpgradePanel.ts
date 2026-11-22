import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CAT_BED_TIER_DEFS,
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_MAX_LEVEL,
  PICKLE_TIER_DEFS,
  catBedTier,
  catBedUpgradeState,
  catUnlocked,
  furnLabel,
  furnLevel,
  houseFurnCap,
  houseLabel,
  houseLevel,
  houseUpgradeState,
  minHouseForFurn,
  furnUpgradeState,
  pickleTier,
  pickleUnlocked,
  pickleUpgradeState,
  type FurnId,
  type PropUpgradeState,
} from '@/sim';
import { watchTextures } from '@/utils/assets';
import {
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawRecessedWell,
  fillRect,
  makeArtisanShell,
  makeLabel,
  makeSlicedButton,
} from '@/utils/ui';

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
    this._root.removeChildren();
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;

    watchTextures([UI_KIT.headerRibbon, UI_KIT.closeRound, UI_KIT.btnOlive, UI_KIT.btnGold], () => {
      if (this._isOpen) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.56;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const save = KitchenManager.save;
    const showProps = pickleUnlocked(save) || catUnlocked(save);
    const propCount = (pickleUnlocked(save) ? 1 : 0) + (catUnlocked(save) ? 1 : 0);
    const boxW = Math.min(w - 36, 680);
    const padX = 26;
    const cw = boxW - padX * 2;
    const contentTop = 90;
    const houseH = 80;
    const rowH = 64;
    const rowGap = 9;
    const totalRows = FURN_IDS.length + propCount;
    const boxH = contentTop + houseH + 12 + totalRows * rowH + Math.max(0, totalRows - 1) * rowGap + (showProps ? 8 : 0) + 26;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 14, (h - boxH) / 2));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '装 修 厨 房',
      subtitle: '先把屋子扩宽敞，大件厨具与窗边器物才更气派',
      closeSilent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
      onClose: () => this.close(),
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    const house = houseLevel(save);
    shell.addChild(this._houseRow(house, padX, contentTop, cw, houseH));

    let y = contentTop + houseH + 12;
    for (const id of FURN_IDS) {
      shell.addChild(this._row(id, furnLevel(save, id), house, padX, y, cw, rowH));
      y += rowH + rowGap;
    }
    if (showProps) {
      y += 4;
      if (pickleUnlocked(save)) {
        const pTier = pickleTier(save);
        shell.addChild(this._propRow(
          `🏺 ${PICKLE_TIER_DEFS[pTier].name}`,
          `老坛品阶 ${pTier + 1}/3 · ${PICKLE_TIER_DEFS[pTier].desc}`,
          pickleUpgradeState(save),
          () => KitchenManager.upgradePickleJar(),
          padX,
          y,
          cw,
          rowH,
        ));
        y += rowH + rowGap;
      }
      if (catUnlocked(save)) {
        const cTier = catBedTier(save);
        shell.addChild(this._propRow(
          `🐾 ${CAT_BED_TIER_DEFS[cTier].name}`,
          `猫窝品阶 ${cTier + 1}/3 · ${CAT_BED_TIER_DEFS[cTier].desc}`,
          catBedUpgradeState(save),
          () => KitchenManager.upgradeCatBed(),
          padX,
          y,
          cw,
          rowH,
        ));
      }
    }
  }

  private _propRow(
    title: string,
    subText: string,
    state: PropUpgradeState,
    onBuy: () => boolean,
    x: number,
    y: number,
    width: number,
    height: number,
  ): PIXI.Container {
    const row = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, { radius: 14, tone: 'ivory' });
    row.addChild(bg);

    const name = makeLabel(title, 19, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(x + 18, y + 10);
    row.addChild(name);

    const sub = makeLabel(subText, 13, UI_PALETTE.muted, { fontWeight: '600' });
    sub.position.set(x + 18, y + 37);
    row.addChild(sub);

    if (state.status === 'max') {
      const done = makeLabel('✓ 满阶', 18, UI_PALETTE.olive, { fontWeight: '700' });
      done.anchor.set(1, 0.5);
      done.position.set(x + width - 20, y + height / 2);
      row.addChild(done);
      return row;
    }

    const ready = state.status === 'ready';
    const btn = makeSlicedButton({
      label: ready ? `${state.cost} 金升阶` : state.error,
      width: 162,
      height: 42,
      skin: ready ? 'olive' : 'cream',
      textColor: ready ? 0xFFF8F0 : 0x8A7358,
      fontSize: 14,
      silent: !ready,
    });
    if (!ready) btn.alpha = 0.85;
    btn.position.set(x + width - 176, y + Math.round((height - 42) / 2));
    btn.on('pointertap', () => {
      onBuy();
      this.relayout();
    });
    row.addChild(btn);
    return row;
  }

  private _houseRow(level: number, x: number, y: number, width: number, height: number): PIXI.Container {
    const row = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, { radius: 16, tone: 'gold' });
    row.addChild(bg);

    const name = makeLabel(`🏠 ${houseLabel(level)}`, 23, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(x + 18, y + 14);
    row.addChild(name);

    const sub = makeLabel(`房屋档次 ${level + 1}/${HOUSE_MAX_LEVEL + 1}`, 15, UI_PALETTE.muted, { fontWeight: '600' });
    sub.position.set(x + 22, y + 46);
    row.addChild(sub);

    if (level >= HOUSE_MAX_LEVEL) {
      const done = makeLabel('✓ 已满档', 19, UI_PALETTE.olive, { fontWeight: '700' });
      done.anchor.set(1, 0.5);
      done.position.set(x + width - 20, y + height / 2);
      row.addChild(done);
      return row;
    }

    const state = houseUpgradeState(KitchenManager.save);
    const ready = state.status === 'ready';
    const label = state.status === 'blocked' ? state.error : `装修 · ${state.status === 'max' ? 0 : state.cost} 金`;
    const btn = makeSlicedButton({
      label,
      width: 184,
      height: 48,
      skin: ready ? 'gold' : 'cream',
      textColor: ready ? UI_PALETTE.ink : 0x8A7358,
      silent: !ready,
    });
    if (!ready) btn.alpha = 0.8;
    btn.position.set(x + width - 198, y + Math.round((height - 48) / 2));
    btn.on('pointertap', () => {
      KitchenManager.upgradeHouse();
      this.relayout();
    });
    row.addChild(btn);
    return row;
  }

  private _row(id: FurnId, level: number, house: number, x: number, y: number, width: number, height: number): PIXI.Container {
    const row = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, x, y, width, height, { radius: 14, tone: 'ivory' });
    row.addChild(bg);

    const name = makeLabel(`${furnLabel(id, level)}`, 20, UI_PALETTE.ink, { fontWeight: '700' });
    name.position.set(x + 18, y + 11);
    row.addChild(name);

    const lv = makeLabel(`等级 ${level + 1}/${FURN_MAX_LEVEL + 1}`, 14, UI_PALETTE.muted, { fontWeight: '600' });
    lv.position.set(x + 18, y + 39);
    row.addChild(lv);

    if (level >= FURN_MAX_LEVEL) {
      const done = makeLabel('✓ 满级', 18, UI_PALETTE.olive, { fontWeight: '700' });
      done.anchor.set(1, 0.5);
      done.position.set(x + width - 20, y + height / 2);
      row.addChild(done);
      return row;
    }

    const state = furnUpgradeState(KitchenManager.save, id);
    if (state.status === 'blocked' && level >= houseFurnCap(house, id)) {
      const need = houseLabel(minHouseForFurn(id, level + 1));
      const well = new PIXI.Graphics();
      drawRecessedWell(well, x + width - 166, y + 14, 152, 40, { radius: 20 });
      const locked = makeLabel(`需${need}`, 15, UI_PALETTE.muted, { fontWeight: '700' });
      locked.anchor.set(0.5);
      locked.position.set(x + width - 90, y + 34);
      row.addChild(well, locked);
      return row;
    }

    const cost = state.status === 'max' ? 0 : state.cost;
    const ready = state.status === 'ready';
    const btn = makeSlicedButton({
      label: `${cost} 金升级`,
      width: 156,
      height: 44,
      skin: ready ? 'olive' : 'cream',
      textColor: ready ? 0xFFF8F0 : 0x8A7358,
      silent: !ready,
    });
    if (!ready) btn.alpha = 0.8;
    btn.position.set(x + width - 170, y + Math.round((height - 44) / 2));
    btn.on('pointertap', () => {
      KitchenManager.upgrade(id);
      this.relayout();
    });
    row.addChild(btn);
    return row;
  }
}
