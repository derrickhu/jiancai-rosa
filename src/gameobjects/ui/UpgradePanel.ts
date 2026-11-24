import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CAT_BED_TIER_DEFS,
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_MAX_LEVEL,
  PICKLE_TIER_DEFS,
  bagDryCols,
  bagRows,
  catBedTier,
  catBedUpgradeState,
  catUnlocked,
  cookLevel,
  foamWetCols,
  foamWetRows,
  fridgeOwnCap,
  furnCookNeed,
  furnLabel,
  furnLevel,
  furnUpgradeState,
  houseCookNeed,
  houseFurnCap,
  houseLabel,
  houseLevel,
  houseUpgradeState,
  minHouseForFurn,
  outingDryCells,
  outingWetCells,
  pickleTier,
  pickleUnlocked,
  pickleUpgradeState,
  tableUnlockNext,
  type FurnId,
  type PropUpgradeState,
} from '@/sim';
import { VerticalScroller } from '@/utils/scroll';
import { fitSpriteInBox, gameTexture, isTextureReady, watchTextures } from '@/utils/assets';
import {
  HUD_ICON,
  P2_ART,
  UI_BTN,
  UI_KIT,
  fitTextWidth,
  makeCoinButton,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  wall: 'subpkg_images/scene_order_wall.png',
  spot: 'subpkg_images/scene_dex_spot.png',
  photo: 'subpkg_images/scene_order_photo.png',
} as const;

const W = 720;
const L = {
  wallSliceTop: 150,
  wallSliceBottom: 90,
  houseTop: 94,
  houseH: 186,
  sheetTop: 294,
  sheetX: 26,
  headerH: 96,
  headX: 88,
  headR: 632,
  rowH: 138,
  contentX: 62,
  contentR: 658,
} as const;

const CREAM = 0xFFF5E2;
const WOOD_STROKE = 0x382010;

function furnSpritePath(id: FurnId, level: number): string {
  const lv = Math.max(0, Math.min(FURN_MAX_LEVEL, level));
  return `subpkg_kitchen/kitchen_${id}_${lv}.png`;
}

function houseSpritePath(level: number): string {
  const lv = Math.max(0, Math.min(HOUSE_MAX_LEVEL, level));
  return `subpkg_kitchen/kitchen_room_${lv}.jpg`;
}

function furnGainDesc(id: FurnId, lv: number): string {
  const maxed = lv >= FURN_MAX_LEVEL;
  if (id === 'fridge') {
    const cur = fridgeOwnCap(lv);
    return maxed ? `储物容量 ${cur} 格 · 已臻满阶` : `储物容量 ${cur} ➔ ${fridgeOwnCap(lv + 1)} 格`;
  }
  if (id === 'basket') {
    const cur = outingDryCells(lv);
    return maxed
      ? `干货区 ${bagDryCols(lv)}×${bagRows(lv)}（${cur}格）`
      : `出门干货区 ${cur} ➔ ${outingDryCells(lv + 1)} 格`;
  }
  if (id === 'foam') {
    const cur = outingWetCells(lv);
    return maxed
      ? `湿货区 ${foamWetCols(lv)}×${foamWetRows(lv)}（${cur}格）`
      : `出门湿货区 ${cur} ➔ ${outingWetCells(lv + 1)} 格`;
  }
  if (maxed) return '御膳双灶满阶 · 尽览家常百味';
  const unlockN = tableUnlockNext(lv);
  if (unlockN > 0) return `修缮即赠 ${unlockN} 道新菜谱`;
  return `灶台焕新为「${furnLabel('table', lv + 1)}」`;
}

/**
 * 匠人修缮图谱场景：
 * 上方木墙悬挂宅院扩建实景对比，下方铜钉宣纸铺展器物修缮前后实物与大字属性提升。
 */
export class UpgradePanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _scroller: VerticalScroller;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 24;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._paintQueued = false;
    this._scroller.disable();
    this._root.removeChildren();
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

  private _warmAssets(): void {
    const save = KitchenManager.save;
    const hLv = houseLevel(save);
    const paths: string[] = [
      ...Object.values(ART),
      ...sceneArtPaths(),
      HUD_ICON.coin,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      UI_BTN.cream,
      UI_BTN.terracotta,
      'subpkg_kitchen/ui_pickup_flare.png',
      houseSpritePath(hLv),
      houseSpritePath(Math.min(HOUSE_MAX_LEVEL, hLv + 1)),
    ];
    for (const id of FURN_IDS) {
      const lv = furnLevel(save, id);
      paths.push(furnSpritePath(id, lv));
      paths.push(furnSpritePath(id, Math.min(FURN_MAX_LEVEL, lv + 1)));
    }
    if (pickleUnlocked(save)) {
      const pt = pickleTier(save);
      paths.push(P2_ART.pickleTiers[pt].idle);
      paths.push(P2_ART.pickleTiers[Math.min(2, pt + 1)].idle);
    }
    if (catUnlocked(save)) {
      const ct = catBedTier(save);
      paths.push(P2_ART.catTiers[ct].idle);
      paths.push(P2_ART.catTiers[Math.min(2, ct + 1)].idle);
    }
    watchTextures(paths, this._scheduleRelayout);
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;
    this._warmAssets();

    const save = KitchenManager.save;
    const hasPickle = pickleUnlocked(save);
    const hasCat = catUnlocked(save);
    const totalRows = FURN_IDS.length + (hasPickle ? 1 : 0) + (hasCat ? 1 : 0);

    // 宣纸卷轴可视高度：4行全显，多于4行时平滑竖滑
    const visibleRows = Math.min(totalRows, 4.4);
    const listViewH = Math.round(visibleRows * L.rowH);
    const sheetH = L.headerH + listViewH + 34;
    const panelH = L.sheetTop + sheetH + 24;

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 44,
      onDimTap: () => this.close(),
    });

    drawSceneWall(scene, ART.wall, W, panelH, L.wallSliceTop, L.wallSliceBottom);
    drawPlaqueTitle(scene, '匠人修缮谱', W / 2);

    // 上段木墙区：屋舍扩建前后实景对比
    this._drawHouseShowcase(scene, houseLevel(save));

    // 下段宣纸卷轴：器物修缮清单
    drawStretchSheet(scene, SCENE_ART.sheet, L.sheetX, L.sheetTop, W - L.sheetX * 2, sheetH, 140, 120);
    this._drawSheetHeader(scene, save.money);

    const listTop = L.sheetTop + L.headerH;
    const content = new PIXI.Container();
    let ry = 0;
    let idx = 0;

    for (const id of FURN_IDS) {
      content.addChild(this._drawFurnRow(id, furnLevel(save, id), houseLevel(save), ry, idx < totalRows - 1));
      ry += L.rowH;
      idx += 1;
    }

    if (hasPickle) {
      const pt = pickleTier(save);
      const nextPt = Math.min(2, pt + 1) as 0 | 1 | 2;
      const curDef = PICKLE_TIER_DEFS[pt];
      const nextDef = PICKLE_TIER_DEFS[nextPt];
      const st = pickleUpgradeState(save);
      content.addChild(this._drawPropRow({
        curIcon: P2_ART.pickleTiers[pt].idle,
        nextIcon: P2_ART.pickleTiers[nextPt].idle,
        title: pt < 2 ? `${curDef.name} ➔ ${nextDef.name}` : curDef.name,
        levelTag: `品阶 ${pt + 1}/3`,
        gainText: st.status === 'max' ? curDef.desc : st.nextDesc,
        state: st,
        onBuy: () => KitchenManager.upgradePickleJar(),
        y: ry,
        divider: idx < totalRows - 1,
      }));
      ry += L.rowH;
      idx += 1;
    }

    if (hasCat) {
      const ct = catBedTier(save);
      const nextCt = Math.min(2, ct + 1) as 0 | 1 | 2;
      const curDef = CAT_BED_TIER_DEFS[ct];
      const nextDef = CAT_BED_TIER_DEFS[nextCt];
      const st = catBedUpgradeState(save);
      content.addChild(this._drawPropRow({
        curIcon: P2_ART.catTiers[ct].idle,
        nextIcon: P2_ART.catTiers[nextCt].idle,
        title: ct < 2 ? `${curDef.name} ➔ ${nextDef.name}` : curDef.name,
        levelTag: `品阶 ${ct + 1}/3`,
        gainText: st.status === 'max' ? curDef.desc : st.nextDesc,
        state: st,
        onBuy: () => KitchenManager.upgradeCatBed(),
        y: ry,
        divider: idx < totalRows - 1,
      }));
      ry += L.rowH;
      idx += 1;
    }

    const maxScroll = Math.max(0, ry - listViewH);
    content.position.set(0, listTop);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xFFFFFF);
      mask.drawRect(L.sheetX + 12, listTop, W - (L.sheetX + 12) * 2, listViewH);
      mask.endFill();
      mask.eventMode = 'none';
      scene.addChild(mask);
      content.mask = mask;
    }
    scene.addChild(content);

    const stageTopLeft = toStage(L.sheetX, listTop);
    this._scroller.attach({
      content,
      maxScroll,
      baseY: listTop,
      hit: {
        x: stageTopLeft.x,
        y: stageTopLeft.y,
        w: (W - L.sheetX * 2) * scale,
        h: listViewH * scale,
      },
    });

    drawSceneClose(scene, W - 46, -20, () => this.close(), this._scheduleRelayout);
  }

  // ── 木墙上段：屋舍扩建前后实景相片对比 ──────────────────────────────
  private _drawHouseShowcase(scene: PIXI.Container, level: number): void {
    const save = KitchenManager.save;
    const maxed = level >= HOUSE_MAX_LEVEL;
    const y = L.houseTop;

    // 左侧：升级前后屋舍相框缩略图
    const curFrame = this._makeRoomPhoto(houseSpritePath(level), 94, 122, false);
    curFrame.position.set(44, y + 26);
    curFrame.rotation = -0.03;
    scene.addChild(curFrame);

    let textX = 162;
    if (!maxed) {
      const arrow = makeText('title', '➔', 0xF7D794, { size: 28, stroke: WOOD_STROKE, strokeWidth: 5 });
      arrow.anchor.set(0.5);
      arrow.position.set(154, y + 88);
      scene.addChild(arrow);

      const nextFrame = this._makeRoomPhoto(houseSpritePath(level + 1), 94, 122, true);
      nextFrame.position.set(172, y + 26);
      nextFrame.rotation = 0.025;
      scene.addChild(nextFrame);
      textX = 282;
    }

    const titleStr = maxed
      ? `${houseLabel(level)} · 满堂华彩`
      : `${houseLabel(level)} ➔ ${houseLabel(level + 1)}`;
    const title = makeText('title', titleStr, CREAM, { size: 30, stroke: WOOD_STROKE, strokeWidth: 5 });
    title.position.set(textX, y + 20);
    fitTextWidth(title, L.contentR - textX);
    scene.addChild(title);

    const nextCap = houseFurnCap(Math.min(HOUSE_MAX_LEVEL, level + 1), 'fridge') + 1;
    const gainStr = maxed
      ? `屋舍档次 ${level + 1}/${HOUSE_MAX_LEVEL + 1} · 全屋器物可升至 15 级`
      : `全屋器物上限提升至 ${nextCap} 级`;
    const gain = makeText('body', gainStr, 0xFFE4AE, { size: 23, stroke: WOOD_STROKE, strokeWidth: 4 });
    gain.position.set(textX, y + 64);
    fitTextWidth(gain, L.contentR - textX);
    scene.addChild(gain);

    if (maxed) {
      const seal = makeSealStamp('满堂', 60, -0.08);
      seal.position.set(L.contentR - 36, y + 126);
      scene.addChild(seal);
      return;
    }

    const state = houseUpgradeState(save);
    const ready = state.status === 'ready';
    const needCook = houseCookNeed(level);
    const lockedByCook = cookLevel(save) < needCook;
    const btnW = 216;
    const btnH = 56;
    const btn = lockedByCook
      ? makeSlicedButton({
        label: `厨艺 ${needCook} 级可修`,
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 23,
        silent: true,
        onReady: this._scheduleRelayout,
      })
      : makeCoinButton({
        prefix: '扩建',
        price: state.status === 'max' ? 0 : state.cost,
        width: btnW,
        height: btnH,
        skin: ready ? 'gold' : 'cream',
        textColor: ready ? SCENE_INK.ink : 0x8A7358,
        fontSize: 25,
        silent: !ready,
        onReady: this._scheduleRelayout,
      });
    btn.position.set(textX, y + 108);
    btn.on('pointertap', () => {
      if (this._scroller.moved) return;
      KitchenManager.upgradeHouse();
      if (this._isOpen) this.relayout();
    });
    scene.addChild(btn);
  }

  private _makeRoomPhoto(path: string, w: number, h: number, highlight: boolean): PIXI.Container {
    const root = new PIXI.Container();
    const border = new PIXI.Graphics();
    border.beginFill(0x120904, 0.36);
    border.drawRoundedRect(3, 5, w, h, 8);
    border.endFill();
    border.lineStyle(2.5, highlight ? 0xE6B04B : 0x3A2414, 1);
    border.beginFill(0xFFF6E6, 1);
    border.drawRoundedRect(0, 0, w, h, 8);
    border.endFill();
    root.addChild(border);

    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const pad = 6;
      const iw = w - pad * 2;
      const ih = h - pad * 2;
      const mask = new PIXI.Graphics();
      mask.beginFill(0xFFFFFF);
      mask.drawRoundedRect(pad, pad, iw, ih, 5);
      mask.endFill();
      const sp = new PIXI.Sprite(tex);
      const s = Math.max(iw / tex.width, ih / tex.height);
      sp.scale.set(s);
      sp.anchor.set(0.5);
      sp.position.set(w / 2, h / 2);
      sp.mask = mask;
      root.addChild(mask, sp);
    }
    return root;
  }

  // ── 宣纸卷轴抬头：左书标题，右列当前银钱余额（内收避让左右黄铜图钉） ──
  private _drawSheetHeader(scene: PIXI.Container, money: number): void {
    const cy = L.sheetTop + 56;
    const title = makeText('display', '器物营造录', SCENE_INK.ink, { size: 32 });
    title.anchor.set(0, 0.5);
    title.position.set(L.headX, cy);
    scene.addChild(title);

    const coinRow = new PIXI.Container();
    const moneyTxt = makeText('number', `${money}`, SCENE_INK.gold, { size: 26 });
    moneyTxt.anchor.set(1, 0.5);
    moneyTxt.position.set(L.headR, cy);
    coinRow.addChild(moneyTxt);

    const coinSp = sceneSprite(HUD_ICON.coin, 30, 30);
    if (coinSp) {
      coinSp.anchor.set(1, 0.5);
      coinSp.position.set(L.headR - moneyTxt.width - 6, cy);
      coinRow.addChild(coinSp);
    }
    const labelTxt = makeText('caption', '现银', SCENE_INK.muted, { size: 22, fontWeight: '600' });
    labelTxt.anchor.set(1, 0.5);
    labelTxt.position.set(L.headR - moneyTxt.width - (coinSp ? 44 : 10), cy);
    coinRow.addChild(labelTxt);
    scene.addChild(coinRow);

    drawInkDivider(scene, L.contentX, L.sheetTop + L.headerH - 12, L.contentR - L.contentX, 0.62, 12);
  }

  // ── 单行家具修缮：实物对比 + 大字属性提升 + 金币按钮 ──────────────
  private _drawFurnRow(
    id: FurnId,
    level: number,
    house: number,
    y: number,
    divider: boolean,
  ): PIXI.Container {
    const maxed = level >= FURN_MAX_LEVEL;
    const curName = furnLabel(id, level);
    const nextName = furnLabel(id, Math.min(FURN_MAX_LEVEL, level + 1));
    const title = !maxed && nextName !== curName ? `${curName} ➔ ${nextName}` : curName;

    const save = KitchenManager.save;
    const state = furnUpgradeState(save, id);
    const blockedByHouse = !maxed && level >= houseFurnCap(house, id);
    const needCook = furnCookNeed(id, level);
    const blockedByCook = !maxed && !blockedByHouse && cookLevel(save) < needCook;

    let conditionLine = '';
    let lockBtnLabel = '';
    if (blockedByHouse) {
      const needH = houseLabel(minHouseForFurn(id, level + 1));
      conditionLine = `需先扩建至「${needH}」`;
      lockBtnLabel = `需${needH}`;
    } else if (blockedByCook) {
      conditionLine = `需厨艺达到 Lv.${needCook}`;
      lockBtnLabel = `厨艺${needCook}级`;
    }

    return this._buildCraftRow({
      curIcon: furnSpritePath(id, level),
      nextIcon: maxed ? null : furnSpritePath(id, level + 1),
      title,
      levelTag: `Lv.${level + 1}/${FURN_MAX_LEVEL + 1}`,
      gainText: furnGainDesc(id, level),
      conditionLine,
      maxed,
      ready: state.status === 'ready',
      cost: state.status === 'max' ? 0 : state.cost,
      lockBtnLabel,
      onTap: () => {
        if (this._scroller.moved) return;
        KitchenManager.upgrade(id);
        if (this._isOpen) this.relayout();
      },
      y,
      divider,
    });
  }

  private _drawPropRow(opts: {
    curIcon: string;
    nextIcon: string;
    title: string;
    levelTag: string;
    gainText: string;
    state: PropUpgradeState;
    onBuy: () => boolean;
    y: number;
    divider: boolean;
  }): PIXI.Container {
    const save = KitchenManager.save;
    const st = opts.state;
    const maxed = st.status === 'max';
    const cookNeed = st.status === 'max' ? 0 : st.cookNeed;
    const cost = st.status === 'max' ? 0 : st.cost;
    const lockedByCook = !maxed && cookLevel(save) < cookNeed;
    return this._buildCraftRow({
      curIcon: opts.curIcon,
      nextIcon: maxed ? null : opts.nextIcon,
      title: opts.title,
      levelTag: opts.levelTag,
      gainText: opts.gainText.split('·')[0].trim(),
      conditionLine: lockedByCook ? `需厨艺达到 Lv.${cookNeed}` : '',
      maxed,
      ready: st.status === 'ready',
      cost,
      lockBtnLabel: lockedByCook ? `厨艺${cookNeed}级` : '',
      onTap: () => {
        if (this._scroller.moved) return;
        if (!maxed && st.status !== 'ready' && !lockedByCook) {
          opts.onBuy();
          return;
        }
        if (lockedByCook) {
          AudioManager.play('ui_deny');
          Platform.showToast(`厨艺达到 ${cookNeed} 级后可升阶`);
          return;
        }
        if (opts.onBuy() && this._isOpen) this.relayout();
      },
      y: opts.y,
      divider: opts.divider,
    });
  }

  private _buildCraftRow(opts: {
    curIcon: string;
    nextIcon: string | null;
    title: string;
    levelTag: string;
    gainText: string;
    conditionLine: string;
    maxed: boolean;
    ready: boolean;
    cost: number;
    lockBtnLabel: string;
    onTap: () => void;
    y: number;
    divider: boolean;
  }): PIXI.Container {
    const row = new PIXI.Container();
    row.position.set(0, opts.y);

    // 左侧：升级前后实物对比（不套圆角框，落在纸笺水墨圆垫上）
    const cy = L.rowH / 2 - 2;
    if (opts.maxed || !opts.nextIcon) {
      const cx = L.contentX + 76;
      const flare = makeRarityFlare('legendary', 132);
      flare.position.set(cx, cy);
      row.addChild(flare);
      const spot = sceneSprite(ART.spot, 102, 102);
      if (spot) {
        spot.anchor.set(0.5);
        spot.position.set(cx, cy);
        row.addChild(spot);
      }
      const sp = this._itemSprite(opts.curIcon, 88, 88);
      if (sp) {
        sp.position.set(cx, cy);
        row.addChild(sp);
      }
    } else {
      const cx1 = L.contentX + 38;
      const cx2 = L.contentX + 132;
      const spot1 = sceneSprite(ART.spot, 78, 78);
      if (spot1) {
        spot1.anchor.set(0.5);
        spot1.alpha = 0.72;
        spot1.position.set(cx1, cy);
        row.addChild(spot1);
      }
      const sp1 = this._itemSprite(opts.curIcon, 68, 68);
      if (sp1) {
        sp1.position.set(cx1, cy);
        row.addChild(sp1);
      }

      const arr = makeText('heading', '➔', SCENE_INK.muted, { size: 22 });
      arr.anchor.set(0.5);
      arr.position.set((cx1 + cx2) / 2, cy);
      row.addChild(arr);

      const spot2 = sceneSprite(ART.spot, 86, 86);
      if (spot2) {
        spot2.anchor.set(0.5);
        spot2.position.set(cx2, cy);
        row.addChild(spot2);
      }
      const sp2 = this._itemSprite(opts.nextIcon, 76, 76);
      if (sp2) {
        sp2.position.set(cx2, cy);
        row.addChild(sp2);
      }
    }

    // 中间：器物名 + 等级 + 大字属性提升
    const midX = L.contentX + 184;
    const btnW = 162;
    const btnH = 56;
    const btnX = L.contentR - btnW;
    const maxTextW = btnX - midX - 14;

    const hasCond = !!opts.conditionLine;
    const nameY = hasCond ? 14 : 24;
    const nameTxt = makeText('title', opts.title, SCENE_INK.ink, { size: 27 });
    nameTxt.position.set(midX, nameY);
    fitTextWidth(nameTxt, maxTextW - 86);
    row.addChild(nameTxt);

    const lvTxt = makeText('caption', opts.levelTag, SCENE_INK.muted, { size: 22, fontWeight: '700' });
    lvTxt.position.set(midX + nameTxt.width + 10, nameY + 5);
    if (lvTxt.x + lvTxt.width <= btnX - 8) {
      row.addChild(lvTxt);
    }

    const gainTxt = makeText('body', opts.gainText, opts.maxed ? SCENE_INK.gold : SCENE_INK.green, {
      size: 23,
      fontWeight: '700',
    });
    gainTxt.position.set(midX, hasCond ? 54 : 68);
    fitTextWidth(gainTxt, maxTextW);
    row.addChild(gainTxt);

    if (hasCond) {
      const condTxt = makeText('caption', opts.conditionLine, SCENE_INK.red, { size: 22, fontWeight: '600' });
      condTxt.position.set(midX, 90);
      fitTextWidth(condTxt, maxTextW);
      row.addChild(condTxt);
    }

    // 右侧：满阶朱印 / 条件按钮 / 金币修缮按钮
    if (opts.maxed) {
      const seal = makeSealStamp('满阶', 56, -0.09);
      seal.position.set(L.contentR - 36, cy);
      row.addChild(seal);
    } else if (opts.lockBtnLabel) {
      const lockBtn = makeSlicedButton({
        label: opts.lockBtnLabel,
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 23,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      lockBtn.position.set(btnX, Math.round((L.rowH - btnH) / 2));
      lockBtn.on('pointertap', opts.onTap);
      row.addChild(lockBtn);
    } else {
      const buyBtn = makeCoinButton({
        prefix: '修缮',
        price: opts.cost,
        width: btnW,
        height: btnH,
        skin: opts.ready ? 'olive' : 'cream',
        textColor: opts.ready ? 0xFFF8F0 : 0x8A7358,
        fontSize: 24,
        silent: !opts.ready,
        onReady: this._scheduleRelayout,
      });
      buyBtn.position.set(btnX, Math.round((L.rowH - btnH) / 2));
      buyBtn.on('pointertap', opts.onTap);
      row.addChild(buyBtn);
    }

    if (opts.divider) {
      drawInkDivider(row, L.contentX, L.rowH - 10, L.contentR - L.contentX, 0.36, 10);
    }
    return row;
  }

  private _itemSprite(path: string, w: number, h: number): PIXI.Sprite | null {
    const tex = gameTexture(path);
    if (!isTextureReady(tex)) return null;
    const sp = new PIXI.Sprite(tex);
    fitSpriteInBox(sp, w, h);
    sp.anchor.set(0.5);
    sp.eventMode = 'none';
    return sp;
  }
}
