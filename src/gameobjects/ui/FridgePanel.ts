import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { TUTORIAL_DENY } from '@/config/TutorialCopy';
import { KitchenManager } from '@/managers/KitchenManager';
import { SaveManager } from '@/managers/SaveManager';
import {
  FRIDGE_STACK,
  fridgeCap,
  fridgeItemName,
  fridgeItemQty,
  fridgeKind,
  fridgeQtySum,
  itemRarity,
  kitchenBuffLine,
  putIntoFridge,
  rarityLabel,
  rarityRank,
  recipeRarity,
  type FridgeItem,
  type FridgeKind,
  type Rarity,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  UI_BTN,
  UI_KIT,
  UI_PALETTE,
  bindUiClick,
  fitTextWidth,
  makeCoinButton,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  watchTextures,
} from '@/utils/assets';
import { fridgePanelPaths } from '@/utils/panelAssets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawSceneClose,
  drawStretchSheet,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';
import { inspectFromFridge, makeItemInspectCard } from './ItemInspectCard';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

const ART = {
  cabinet: 'subpkg_kitchen/ui_fridge_panel.png',
  tab: 'subpkg_images/scene_dex_tab.png',
  tray: 'subpkg_images/scene_fridge_tray.png',
} as const;

const W = 720;
const PANEL_H = 1152;

const L = {
  tabY: 138,
  cavityX: 60,
  cavityTop: 240,
  cavityW: 594,
  cavityH: 524,
  cols: 4,
  shelfRowH: 170,
  sheetTop: 772,
  sheetX: 36,
  sheetH: 322,
  padX: 62,
} as const;

const FRIDGE_INK = {
  cabinetLine: 0x3D1E0A,
  creamShell: 0xFBF0D6,
  mintLiner: 0x93C8AB,
  deepInk: 0x1D2E27,
  domeInk: 0x24180E,
  mintAccent: 0x266350,
  creamHalo: 0xFFFDF8,
  selectedInk: 0x8F4A04,
  selectedHalo: 0xFFF4B8,
} as const;

function fridgeSlotRarity(it: FridgeItem): Rarity {
  return fridgeKind(it) === 'dish' ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId);
}

/**
 * 奶油薄荷冷藏冰箱场景：
 * 奶油白圆润冰箱顶盖配复古薄荷搪瓷铭牌「冰 箱」与磁吸分类便签页签（生鲜食材 / 做好饭菜），
 * 中段薄荷青清凉冷藏内胆铺设磨砂钢化玻璃与白搪瓷护边层架，陈列生鲜与青花瓷碟热菜，
 * 下方下门区磁吸铜钉宣纸保鲜便签，直接呈现选中项详情、份数加减与「整理 / 丢弃 / 品尝 / 卖出」按钮。
 */
export class FridgePanel extends PIXI.Container {
  _isOpen = false;
  onChange: (() => void) | null = null;
  private _tab: FridgeKind = 'food';
  private _root = new PIXI.Container();
  private _inspectUid: string | null = null;
  private _fullModal = false;
  private _tutSlot: PIXI.Container | null = null;
  private _sellBtn: PIXI.Container | null = null;
  private _inspectQty = 1;
  private _scroller: VerticalScroller;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 22;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
  }

  /** 严谨的冰箱新手引导步（仅这三步限制切页签/点选与精简底部栏；HINT_DOOR 等步骤完全自由）。 */
  private get _inFridgeTut(): boolean {
    return TutorialManager.at(
      TutorialStep.OPEN_FRIDGE,
      TutorialStep.INSPECT_DISH,
      TutorialStep.SELL_DISH,
    );
  }

  /** 冰箱教学步内匹配目标「炒菜苔」：若原 dishUid 已不存在，自动兜底匹配任意 stirfry 成菜防死锁。 */
  private _isTutTargetDish(it: FridgeItem): boolean {
    if (fridgeKind(it) !== 'dish' || it.defId !== 'stirfry') return false;
    const want = TutorialManager.dishUid;
    if (want && KitchenManager.save.fridge.some((row) => row.uid === want)) {
      return it.uid === want;
    }
    return true;
  }

  prune(): void {
    const valid = new Set(KitchenManager.save.fridge.map((it) => it.uid));
    if (this._inspectUid && !valid.has(this._inspectUid)) {
      this._inspectUid = null;
      this._inspectQty = 1;
      this._fullModal = false;
    }
  }

  open(tab?: FridgeKind): void {
    if (!this._isOpen) AudioManager.play('fridge_open');
    this.prune();
    if (this._inFridgeTut) {
      this._tab = 'dish';
    } else if (tab) {
      this._tab = tab;
    }
    this._isOpen = true;
    this.visible = true;
    this._scroller.reset();
    this._scroller.enable();
    this._inspectUid = null;
    this._inspectQty = 1;
    this._fullModal = false;

    if (this._isOpen) TutorialOverlay.register('fridge', () => this.tutorialRect());
    TutorialManager.advanceIf(TutorialStep.OPEN_FRIDGE);

    if (!this._inFridgeTut) {
      const first = KitchenManager.save.fridge.find((it) => fridgeKind(it) === this._tab);
      if (first) this._inspectUid = first.uid;
    } else if (TutorialManager.isStep(TutorialStep.SELL_DISH)) {
      const tutDish = KitchenManager.save.fridge.find((it) => this._isTutTargetDish(it));
      if (tutDish) this._inspectUid = tutDish.uid;
    }

    this.relayout();
    OverlayManager.bringToFront();
    this._warm();
  }

  close(silent = false): void {
    if (!silent && TutorialGuard.block('closeFridge')) return;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._fullModal = false;
    this._paintQueued = false;
    this._scroller.disable();
    TutorialOverlay.unregister('fridge');
    this._root.removeChildren();
  }

  tutorialRect(): { x: number; y: number; w: number; h: number; r?: number } | null {
    if (!this._isOpen || !this._inFridgeTut) return null;
    if (TutorialManager.isStep(TutorialStep.INSPECT_DISH)) return stageRectOf(this._tutSlot, 6);
    if (TutorialManager.isStep(TutorialStep.SELL_DISH)) return stageRectOf(this._sellBtn, 6);
    return null;
  }

  private _warm(): void {
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        ...fridgePanelPaths(KitchenManager.save),
        HUD_ICON.coin,
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        UI_BTN.cream,
        UI_BTN.terracotta,
        UI_BTN.wood,
        'subpkg_kitchen/ui_pickup_flare.png',
      ],
      this._scheduleRelayout,
    );
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
    this._tutSlot = null;
    this._sellBtn = null;
    this._root.removeChildren();
    if (!this._isOpen) return;
    this.prune();
    this._warm();

    const save = KitchenManager.save;
    const cap = fridgeCap(save);
    const foods = save.fridge.filter((it) => fridgeKind(it) === 'food');
    const dishes = save.fridge.filter((it) => fridgeKind(it) === 'dish');
    if (this._inFridgeTut) this._tab = 'dish';
    const items = this._tab === 'food' ? foods : dishes;

    const waitInspectTap = TutorialManager.at(TutorialStep.OPEN_FRIDGE, TutorialStep.INSPECT_DISH)
      && items.some((it) => this._isTutTargetDish(it));

    if (!waitInspectTap) {
      if (!this._inspectUid || !items.some((it) => it.uid === this._inspectUid)) {
        const preferred = TutorialManager.isStep(TutorialStep.SELL_DISH)
          ? (items.find((it) => this._isTutTargetDish(it)) ?? items[0])
          : items[0];
        this._inspectUid = preferred?.uid ?? null;
        this._inspectQty = 1;
      }
    }

    const used = save.fridge.length;
    const foodSlots = Math.max(foods.length, cap - dishes.length);
    const dishSlots = Math.max(dishes.length, cap - foods.length);
    const slotCount = Math.max(8, this._tab === 'food' ? foodSlots : dishSlots);
    const foodCount = fridgeQtySum(foods);
    const dishCount = fridgeQtySum(dishes);

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH: PANEL_H,
      topBleed: 16,
      onDimTap: () => {
        if (this._fullModal) {
          this._fullModal = false;
          this.relayout();
          return;
        }
        if (TutorialGuard.block('closeFridge')) return;
        this.close();
      },
    });

    // 0. 奶油白外壳 + 薄荷青冷藏内胆复古冰箱主体
    this._drawFridgeCabinet(scene);
    this._drawFridgeBrandPlaque(scene, '冰 箱', W / 2, 28);

    // 1. 磁吸分类便签页签 + 右侧冰箱容量与保鲜说明
    scene.addChild(this._makeIndexTab('生鲜食材', 'food', 42, L.tabY, 204, foodCount));
    scene.addChild(this._makeIndexTab('做好饭菜', 'dish', 256, L.tabY, 204, dishCount));
    this._drawCapHeader(scene, used, cap, kitchenBuffLine(save));

    // 2. 薄荷青冷藏内胆与磨砂玻璃/搪瓷冷藏隔板层架
    this._drawShelves(scene, items, slotCount, scale, toStage);

    // 3. 下门区磁吸铜钉宣纸保鲜便签：选中项详情 + 整理/丢弃/品尝/卖出按钮
    drawStretchSheet(scene, SCENE_ART.sheet, L.sheetX, L.sheetTop, W - L.sheetX * 2, L.sheetH, 140, 110);
    this._drawMagnetClip(scene, W / 2, L.sheetTop + 2);
    const selected = items.find((it) => it.uid === this._inspectUid) ?? null;
    this._drawBottomSlip(scene, selected, items.length);

    drawSceneClose(scene, W - 62, 28, () => {
      if (TutorialGuard.block('closeFridge')) return;
      this.close();
    }, this._scheduleRelayout);

    // 点击底部瓷碟可放大查看完整鉴赏大笺
    if (this._fullModal && selected && !this._inFridgeTut) {
      const view = inspectFromFridge(selected);
      this._inspectQty = Math.max(1, Math.min(view.maxQty, this._inspectQty));
      this._root.addChild(makeItemInspectCard({
        view,
        qty: this._inspectQty,
        actions: true,
        onQty: (n) => {
          this._inspectQty = n;
          this.relayout();
        },
        onClose: () => {
          this._fullModal = false;
          this.relayout();
        },
        onSell: () => this._handleSell(selected),
        onEat: () => this._handleEat(selected),
        onReady: this._scheduleRelayout,
      }));
    }

    TutorialOverlay.refresh();
  }

  // ── 奶油薄荷复古冰箱柜体 + 搪瓷镶铜铭牌 ─────────────────────────────
  private _drawFridgeCabinet(scene: PIXI.Container): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0E0804, 0.42);
    shadow.drawRoundedRect(18, 22, W - 36, PANEL_H - 22, 58);
    shadow.endFill();
    scene.addChild(shadow);

    const tex = gameTexture(ART.cabinet);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = W;
      sp.height = PANEL_H;
      sp.eventMode = 'none';
      scene.addChild(sp);
      return;
    }

    // 贴图未就绪时的同比例奶油薄荷冰箱手绘矢量兜底
    const g = new PIXI.Graphics();
    g.lineStyle(4, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(FRIDGE_INK.creamShell, 1);
    g.drawRoundedRect(16, 12, W - 32, PANEL_H - 36, 52);
    g.endFill();
    g.moveTo(20, 208);
    g.lineTo(W - 20, 208);
    g.lineStyle(3, FRIDGE_INK.cabinetLine, 0.95);
    g.beginFill(FRIDGE_INK.mintLiner, 1);
    g.drawRoundedRect(56, 236, W - 112, 708, 22);
    g.endFill();
    scene.addChild(g);
  }

  /** 奶油白顶盖中央的复古薄荷搪瓷镶铜铭牌「冰 箱」。 */
  private _drawFridgeBrandPlaque(scene: PIXI.Container, title: string, cx: number, top: number): void {
    const w = 236;
    const h = 68;
    const x = cx - w / 2;
    const g = new PIXI.Graphics();

    // 柔和投影
    g.beginFill(0x2A1608, 0.16);
    g.drawRoundedRect(x + 2, top + 5, w, h, 34);
    g.endFill();

    // 复古暖黄铜外圈
    g.lineStyle(2.8, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(0xDFB468, 1);
    g.drawRoundedRect(x, top, w, h, 34);
    g.endFill();

    // 薄荷松绿搪瓷内芯 + 釉面高光
    g.lineStyle(1.8, 0xFFF9EA, 0.85);
    g.beginFill(FRIDGE_INK.mintAccent, 1);
    g.drawRoundedRect(x + 6, top + 6, w - 12, h - 12, 28);
    g.endFill();

    g.lineStyle(0);
    g.beginFill(0x64B59B, 0.34);
    g.drawRoundedRect(x + 16, top + 10, w - 32, 20, 10);
    g.endFill();

    // 左右两枚黄铜圆铆钉
    for (const dx of [-88, 88]) {
      g.lineStyle(2, FRIDGE_INK.cabinetLine, 1);
      g.beginFill(0xE8C27A, 1);
      g.drawCircle(cx + dx, top + h / 2, 6.5);
      g.endFill();
      g.lineStyle(0);
      g.beginFill(0xFFFDF4, 0.8);
      g.drawCircle(cx + dx - 1.8, top + h / 2 - 1.8, 2.2);
      g.endFill();
    }
    scene.addChild(g);

    const t = makeText('display', title, 0xFFF9EC, {
      size: 38,
      stroke: 0x133328,
      strokeWidth: 4,
    });
    t.anchor.set(0.5);
    t.position.set(cx, top + h / 2 - 1);
    scene.addChild(t);
  }

  /** 底部保鲜便签顶缘的薄荷搪瓷磁吸长扣，强化「磁吸在冰箱门上」的真实触感。 */
  private _drawMagnetClip(scene: PIXI.Container, cx: number, cy: number): void {
    const w = 96;
    const h = 16;
    const g = new PIXI.Graphics();
    g.beginFill(0x26150A, 0.22);
    g.drawRoundedRect(cx - w / 2 + 1, cy - h / 2 + 3, w, h, 8);
    g.endFill();
    g.lineStyle(2.2, FRIDGE_INK.cabinetLine, 1);
    g.beginFill(0x4E9E84, 1);
    g.drawRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.endFill();
    g.lineStyle(0);
    g.beginFill(0xBCEAD9, 0.55);
    g.drawRoundedRect(cx - w / 2 + 8, cy - h / 2 + 2.5, w - 16, 4.5, 2.2);
    g.endFill();
    scene.addChild(g);
  }

  // ── 顶部磁吸分类便签页签 + 容量抬头 ───────────────────────────────────
  private _makeIndexTab(
    title: string,
    tab: FridgeKind,
    x: number,
    y: number,
    w: number,
    count: number,
  ): PIXI.Container {
    const active = this._tab === tab;
    const root = new PIXI.Container();
    const h = active ? 68 : 58;
    root.position.set(x, active ? y : y + 10);

    const sp = sceneSprite(ART.tab, w, h);
    if (sp) {
      sp.width = w;
      sp.height = h;
      sp.tint = active ? 0xFFFDF9 : 0xCDE3D6;
      root.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.5, FRIDGE_INK.cabinetLine, 1);
      g.beginFill(active ? 0xFFFDF8 : 0xC6DED0, 1);
      g.drawRoundedRect(0, 0, w, h, 14);
      g.endFill();
      root.addChild(g);
    }

    // 小圆磁吸扣点缀
    const pin = new PIXI.Graphics();
    pin.lineStyle(1.8, FRIDGE_INK.cabinetLine, 0.9);
    pin.beginFill(active ? 0xD95B38 : 0x5A9E87, 1);
    pin.drawCircle(w / 2, 11, 5);
    pin.endFill();
    root.addChild(pin);

    if (active) {
      const bar = new PIXI.Graphics();
      bar.beginFill(SCENE_INK.red, 0.92);
      bar.drawRoundedRect(26, h - 9, w - 52, 5, 2.5);
      bar.endFill();
      root.addChild(bar);
    }

    const txt = makeText(
      'heading',
      `${title} ${count}`,
      active ? FRIDGE_INK.domeInk : 0x264237,
      {
        size: active ? 25 : 23,
        stroke: active ? 0xFFFFFF : 0xEFF8F3,
        strokeWidth: 2,
      },
    );
    txt.anchor.set(0.5);
    txt.position.set(w / 2, h / 2 + (active ? 2 : 3));
    fitTextWidth(txt, w - 20);
    root.addChild(txt);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, w, h + 8);
    bindUiClick(root);
    root.on('pointertap', () => {
      if (this._inFridgeTut && tab !== 'dish') {
        if (TutorialGuard.block('fridgeTab')) return;
      }
      if (this._tab === tab) return;
      this._tab = tab;
      this._scroller.reset();
      this._inspectUid = null;
      this._inspectQty = 1;
      this._fullModal = false;
      this.relayout();
    });
    return root;
  }

  private _drawCapHeader(
    scene: PIXI.Container,
    used: number,
    cap: number,
    buff?: string | null,
  ): void {
    const rightX = W - 44;
    const full = used >= cap;
    const capTxt = makeText('heading', `冰箱 ${used}/${cap} 格`, full ? SCENE_INK.red : FRIDGE_INK.domeInk, {
      size: 25,
      stroke: FRIDGE_INK.creamHalo,
      strokeWidth: 4,
    });
    capTxt.anchor.set(1, 0);
    capTxt.position.set(rightX, L.tabY - 4);
    fitTextWidth(capTxt, 204);
    scene.addChild(capTxt);

    const subStr = buff || (full ? '已满格 · 建议整理或出售' : '冷藏保鲜 · 同种自动叠放');
    const subColor = buff ? SCENE_INK.gold : (full ? SCENE_INK.red : FRIDGE_INK.mintAccent);
    const subTxt = makeText('caption', subStr, subColor, {
      size: 22,
      fontWeight: '700',
      stroke: FRIDGE_INK.creamHalo,
      strokeWidth: 3.5,
    });
    subTxt.anchor.set(1, 0);
    subTxt.position.set(rightX, L.tabY + 32);
    fitTextWidth(subTxt, 208);
    scene.addChild(subTxt);
  }

  // ── 中段薄荷青冷藏内胆：磨砂钢化玻璃/搪瓷隔板 + 4列保鲜陈列 ────────────
  private _drawShelves(
    scene: PIXI.Container,
    items: FridgeItem[],
    slotCount: number,
    scale: number,
    toStage: (x: number, y: number) => { x: number; y: number },
  ): void {
    // 顶部冷藏照明冷气微光 + 左右层架卡槽暗纹
    const chill = new PIXI.Graphics();
    chill.beginFill(0xF4FFFC, 0.28);
    chill.drawRoundedRect(L.cavityX + 12, L.cavityTop + 4, L.cavityW - 24, 54, 18);
    chill.endFill();
    chill.beginFill(0xFFFFFF, 0.18);
    chill.drawEllipse(W / 2, L.cavityTop + 14, 170, 18);
    chill.endFill();
    // 柔和冷气光斑
    for (const [cx, cy, r] of [
      [L.cavityX + 86, L.cavityTop + 44, 14],
      [W / 2 + 120, L.cavityTop + 38, 11],
      [W / 2 - 42, L.cavityTop + 62, 9],
    ] as const) {
      chill.beginFill(0xF6FFFD, 0.22);
      chill.drawCircle(cx, cy, r);
      chill.endFill();
    }
    // 左右内壁隔板托轨
    chill.lineStyle(2, 0x5E9E87, 0.36);
    chill.moveTo(L.cavityX + 8, L.cavityTop + 16);
    chill.lineTo(L.cavityX + 8, L.cavityTop + L.cavityH - 12);
    chill.moveTo(L.cavityX + L.cavityW - 8, L.cavityTop + 16);
    chill.lineTo(L.cavityX + L.cavityW - 8, L.cavityTop + L.cavityH - 12);
    scene.addChild(chill);

    const rows = Math.max(3, Math.ceil(slotCount / L.cols));
    const totalContentH = rows * L.shelfRowH + 14;
    const maxScroll = Math.max(0, totalContentH - L.cavityH);

    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xFFFFFF);
    mask.drawRoundedRect(L.cavityX + 2, L.cavityTop + 2, L.cavityW - 4, L.cavityH - 4, 14);
    mask.endFill();
    mask.eventMode = 'none';
    viewport.mask = mask;
    scene.addChild(mask, viewport);

    const grid = new PIXI.Container();
    grid.position.set(0, L.cavityTop);
    viewport.addChild(grid);

    const innerPad = 10;
    const plankW = L.cavityW - innerPad * 2;
    const cellW = Math.floor(plankW / L.cols);

    for (let r = 0; r < rows; r++) {
      const rowTop = 8 + r * L.shelfRowH;
      const ledgeY = rowTop + 114;

      // 通透磨砂玻璃 + 白搪瓷包边冷藏隔板
      this._drawGlassShelf(grid, L.cavityX + innerPad, ledgeY, plankW);

      // 隔板上摆放 4 列生鲜食材 / 青花瓷碟热菜
      for (let c = 0; c < L.cols; c++) {
        const idx = r * L.cols + c;
        const cx = L.cavityX + innerPad + c * cellW + cellW / 2;
        const item = items[idx];
        grid.addChild(this._makeShelfItem(cx, rowTop, cellW, item));
      }
    }

    if (!items.length) {
      const emptyMsg = this._tab === 'dish'
        ? '冰箱里还没有热菜，去灶台炒两盘吧'
        : '冰箱空空如也，出门去菜场挑点鲜货吧';
      const emptyPill = new PIXI.Graphics();
      emptyPill.beginFill(0xF6FFFC, 0.72);
      emptyPill.lineStyle(2, 0x4E8E78, 0.55);
      emptyPill.drawRoundedRect(L.cavityX + 34, L.cavityTop + L.cavityH / 2 - 34, L.cavityW - 68, 68, 34);
      emptyPill.endFill();
      scene.addChild(emptyPill);

      const emptyTxt = makeText('title', emptyMsg, FRIDGE_INK.deepInk, {
        size: 25,
        stroke: FRIDGE_INK.creamHalo,
        strokeWidth: 4,
      });
      emptyTxt.anchor.set(0.5);
      emptyTxt.position.set(W / 2, L.cavityTop + L.cavityH / 2);
      fitTextWidth(emptyTxt, L.cavityW - 96);
      scene.addChild(emptyTxt);
    }

    const stageTopLeft = toStage(L.cavityX, L.cavityTop);
    this._scroller.attach({
      content: grid,
      maxScroll,
      baseY: L.cavityTop,
      hit: {
        x: stageTopLeft.x,
        y: stageTopLeft.y,
        w: L.cavityW * scale,
        h: L.cavityH * scale,
      },
    });
  }

  /** 绘制单层通透磨砂玻璃冷藏隔板（带冰青厚度折光与白搪瓷护沿）。 */
  private _drawGlassShelf(parent: PIXI.Container, x: number, y: number, w: number): void {
    const g = new PIXI.Graphics();
    // 层板下方清凉投影
    g.beginFill(0x285A49, 0.18);
    g.drawRoundedRect(x + 4, y + 18, w - 8, 10, 5);
    g.endFill();

    // 磨砂玻璃承重台面
    g.lineStyle(1.6, 0x569882, 0.75);
    g.beginFill(0xE9FAF4, 0.80);
    g.drawRoundedRect(x + 2, y - 4, w - 4, 18, 6);
    g.endFill();

    // 玻璃冰蓝折光亮带
    g.lineStyle(0);
    g.beginFill(0xFFFFFF, 0.52);
    g.drawRoundedRect(x + 16, y - 1, w - 32, 5, 2.5);
    g.endFill();

    // 前沿白搪瓷防滑护条 + 冰青钢化玻璃切边
    g.lineStyle(2, 0x2F5548, 0.92);
    g.beginFill(0xFBFFFE, 0.96);
    g.drawRoundedRect(x, y + 9, w, 12, 6);
    g.endFill();

    g.lineStyle(0);
    g.beginFill(0x98D3C1, 0.75);
    g.drawRoundedRect(x + 6, y + 15, w - 12, 4, 2);
    g.endFill();

    g.eventMode = 'none';
    parent.addChild(g);
  }

  private _makeShelfItem(cx: number, rowTop: number, cellW: number, it?: FridgeItem): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(cx, rowTop);

    // 空层位保持通透干净的磨砂玻璃冷藏隔板，绝不画虚线圆斑
    if (!it) {
      root.eventMode = 'none';
      return root;
    }

    const isDish = fridgeKind(it) === 'dish';
    const isRotten = !isDish && it.quality === 'rotten';
    const selected = this._inspectUid === it.uid;
    const rarity = fridgeSlotRarity(it);
    const liftY = selected ? -6 : 0;

    // 隔板上的柔和半透明深色落影（成菜直接落影，生鲜小瓷碟轻柔垫影，无任何描边线圈）
    const shelfShadow = new PIXI.Graphics();
    shelfShadow.beginFill(0x1B362E, isDish ? (selected ? 0.16 : 0.22) : (selected ? 0.13 : 0.18));
    shelfShadow.drawEllipse(0, isDish ? 110 : 111, isDish ? 48 : 45, isDish ? 13 : 12);
    shelfShadow.endFill();
    shelfShadow.eventMode = 'none';
    root.addChild(shelfShadow);

    // 背后柔和暖金光晕（选中态或高稀有时点亮）
    if (selected || (!isRotten && (rarity === 'legendary' || rarity === 'epic' || it.quality === 'god'))) {
      const flare = makeRarityFlare(selected ? 'legendary' : rarity, selected ? 156 : 120);
      flare.position.set(0, 70 + liftY);
      flare.alpha = selected ? 0.88 : 0.42;
      root.addChild(flare);
    }

    // 实物主体容器：选中时整体微抬 -6px 并轻微放大 1.05x
    const body = new PIXI.Container();
    body.pivot.set(0, 80);
    body.position.set(0, 80 + liftY);
    if (selected) body.scale.set(1.05);
    root.addChild(body);

    if (isDish) {
      // 成菜本身自带 45° 立体碗盘/砂锅，绝不再垫 SCENE_ART.plate，直接放大至 116px 饱满呈现
      const tex = dishTexture(it.defId);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, 116, 116);
        icon.anchor.set(0.5);
        icon.position.set(0, 74);
        icon.eventMode = 'none';
        body.addChild(icon);
      }
    } else {
      // 生鲜食材：手绘浅口白瓷保鲜小浅碟底托 + 鲜货居中立放
      const tray = sceneSprite(ART.tray, 114, 70);
      if (tray) {
        tray.anchor.set(0.5);
        tray.position.set(0, 94);
        if (isRotten) tray.tint = 0xCEC8BC;
        body.addChild(tray);
      }
      const tex = itemLookTexture(it.defId, isRotten ? 'rotten' : 'clean');
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, 78, 78);
        icon.anchor.set(0.5, 1);
        icon.position.set(0, 105);
        icon.eventMode = 'none';
        if (isRotten) icon.tint = 0xC8BCA8;
        body.addChild(icon);
      }
    }

    // 腐坏醒目斜章 / 极鲜珍品标（深墨红/金棕字 + 奶油厚描边，薄荷底对比清晰）
    if (isRotten) {
      const rotTag = makeText('caption', '已腐', 0x992315, {
        size: 22,
        fontWeight: '700',
        stroke: FRIDGE_INK.creamHalo,
        strokeWidth: 4.5,
      });
      rotTag.anchor.set(0.5);
      rotTag.rotation = -0.12;
      rotTag.position.set(-32, 32 + liftY);
      root.addChild(rotTag);
    } else if (it.quality === 'god' || rarity === 'legendary') {
      const freshTag = makeText('caption', '极鲜', 0x8F4B06, {
        size: 22,
        fontWeight: '700',
        stroke: 0xFFFBE6,
        strokeWidth: 4.5,
      });
      freshTag.anchor.set(0.5);
      freshTag.position.set(-32, 32 + liftY);
      root.addChild(freshTag);
    }

    // 大号高对比数量角标（深浓墨色配厚奶油白描边）
    const qty = fridgeItemQty(it);
    if (qty > 1) {
      const qtyTxt = makeText('number', `×${qty}`, selected ? FRIDGE_INK.selectedInk : FRIDGE_INK.deepInk, {
        size: 24,
        stroke: selected ? FRIDGE_INK.selectedHalo : FRIDGE_INK.creamHalo,
        strokeWidth: 5,
      });
      qtyTxt.anchor.set(1, 1);
      qtyTxt.position.set(cellW / 2 - 8, 114 + liftY);
      root.addChild(qtyTxt);
    }

    // 冷藏隔板前沿书写菜名/食材名（深浓墨字 + 浅奶油描边，薄荷青底上极清晰）
    const shortName = fridgeItemName(it);
    const nameTxt = makeText(
      'caption',
      shortName,
      selected ? FRIDGE_INK.selectedInk : (isRotten ? 0x5A524A : FRIDGE_INK.deepInk),
      {
        size: 22,
        fontWeight: '700',
        stroke: selected ? FRIDGE_INK.selectedHalo : FRIDGE_INK.creamHalo,
        strokeWidth: 4.5,
      },
    );
    nameTxt.anchor.set(0.5, 0);
    nameTxt.position.set(0, 124);
    fitTextWidth(nameTxt, cellW - 8);
    root.addChild(nameTxt);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-cellW / 2 + 4, 8, cellW - 8, 154);
    root.on('pointertap', () => {
      if (this._scroller.moved) return;
      if (this._inFridgeTut && !this._isTutTargetDish(it)) {
        if (!TutorialGuard.block('inspectDish')) {
          AudioManager.play('ui_deny');
          Platform.showToast(TUTORIAL_DENY.fridgeDish);
        }
        return;
      }
      if (TutorialGuard.block('inspectDish')) return;
      AudioManager.play('ui_click');
      if (this._inspectUid === it.uid && !this._inFridgeTut) {
        this._fullModal = true;
      } else {
        this._inspectUid = it.uid;
        this._inspectQty = 1;
        this._fullModal = false;
      }
      TutorialManager.advanceIf(TutorialStep.INSPECT_DISH);
      this.relayout();
    });

    if (this._isTutTargetDish(it)) {
      this._tutSlot = root;
    }
    return root;
  }

  // ── 底部磁吸铜钉宣纸保鲜便签：直接呈现选中详情与整理/丢弃/品尝/卖出按钮 ──
  private _drawBottomSlip(
    scene: PIXI.Container,
    selected: FridgeItem | null,
    tabItemCount: number,
  ): void {
    const top = L.sheetTop;
    const left = L.padX;
    const right = W - L.padX;
    const contentW = right - left;

    if (!selected) {
      const showInspectTut = TutorialManager.isStep(TutorialStep.INSPECT_DISH)
        && KitchenManager.save.fridge.some((it) => fridgeKind(it) === 'dish' && it.defId === 'stirfry');

      const msg = showInspectTut
        ? '请轻触上方层架里的「炒菜苔」'
        : (tabItemCount === 0
          ? (this._tab === 'dish'
            ? '冰箱里还没有热菜，去灶台炒两盘吧'
            : '冰箱空空如也，出门去菜场挑点鲜货吧')
          : '点选层架上的食材或饭菜即可打理');
      const hint = makeText('title', msg, showInspectTut ? SCENE_INK.red : SCENE_INK.soft, {
        size: showInspectTut ? 27 : 26,
      });
      hint.anchor.set(0.5);
      hint.position.set(W / 2, showInspectTut ? top + 148 : top + 114);
      fitTextWidth(hint, contentW);
      scene.addChild(hint);

      if (!showInspectTut && !this._inFridgeTut) {
        const hasAny = KitchenManager.save.fridge.length > 0;
        const btnY = top + 204;
        const btnH = 60;

        if (hasAny) {
          const btnW = 242;
          const gap = 24;
          const startX = Math.round((W - (btnW * 2 + gap)) / 2);

          const tidyBtn = makeSlicedButton({
            label: '整理冰箱',
            width: btnW,
            height: btnH,
            skin: 'olive',
            fontSize: 26,
            onReady: this._scheduleRelayout,
          });
          tidyBtn.position.set(startX, btnY);
          tidyBtn.on('pointertap', () => this._tidyFridge());

          const closeBtn = makeSlicedButton({
            label: '关上冰箱',
            width: btnW,
            height: btnH,
            skin: 'wood',
            fontSize: 26,
            onReady: this._scheduleRelayout,
          });
          closeBtn.position.set(startX + btnW + gap, btnY);
          closeBtn.on('pointertap', () => this.close());

          scene.addChild(tidyBtn, closeBtn);
        } else {
          const btnW = 256;
          const closeBtn = makeSlicedButton({
            label: '关上冰箱',
            width: btnW,
            height: btnH,
            skin: 'wood',
            fontSize: 27,
            onReady: this._scheduleRelayout,
          });
          closeBtn.position.set(Math.round((W - btnW) / 2), btnY);
          closeBtn.on('pointertap', () => this.close());
          scene.addChild(closeBtn);
        }
      }
      return;
    }

    const view = inspectFromFridge(selected);
    this._inspectQty = Math.max(1, Math.min(view.maxQty, this._inspectQty));
    const qty = this._inspectQty;
    const unit = view.unitPrice;
    const goldN = unit * qty;
    const canEat = view.kind === 'dish' && !!view.eatLabel;

    // 左：选中物展示（生鲜食材垫浅口白瓷保鲜碟，做好饭菜绝不垫底盘、直接放大至 126px 配柔和底影）
    const plateCx = left + 58;
    const plateCy = top + 108;
    if (view.kind === 'dish') {
      const dishShadow = new PIXI.Graphics();
      dishShadow.beginFill(0x2A1A0E, 0.22);
      dishShadow.drawEllipse(plateCx, plateCy + 34, 52, 15);
      dishShadow.endFill();
      dishShadow.eventMode = 'none';
      scene.addChild(dishShadow);

      const dTex = dishTexture(view.defId);
      if (isTextureReady(dTex)) {
        const ic = new PIXI.Sprite(dTex);
        fitSpriteInBox(ic, 126, 126);
        ic.anchor.set(0.5);
        ic.position.set(plateCx, plateCy - 2);
        ic.eventMode = 'none';
        scene.addChild(ic);
      }
    } else {
      const trayShadow = new PIXI.Graphics();
      trayShadow.beginFill(0x2A1A0E, 0.16);
      trayShadow.drawEllipse(plateCx, plateCy + 32, 50, 14);
      trayShadow.endFill();
      trayShadow.eventMode = 'none';
      scene.addChild(trayShadow);

      const tray = sceneSprite(ART.tray, 130, 80);
      if (tray) {
        tray.anchor.set(0.5);
        tray.position.set(plateCx, plateCy + 12);
        if (view.quality === 'rotten') tray.tint = 0xD8CCB8;
        scene.addChild(tray);
      }
      const iconTex = itemLookTexture(view.defId, view.quality === 'rotten' ? 'rotten' : 'clean');
      if (isTextureReady(iconTex)) {
        const ic = new PIXI.Sprite(iconTex);
        fitSpriteInBox(ic, 86, 86);
        ic.anchor.set(0.5, 1);
        ic.position.set(plateCx, plateCy + 23);
        ic.eventMode = 'none';
        if (view.quality === 'rotten') ic.tint = 0xC8BCA8;
        scene.addChild(ic);
      }
    }
    if (!this._inFridgeTut) {
      const hitPlate = new PIXI.Container();
      hitPlate.eventMode = 'static';
      hitPlate.cursor = 'pointer';
      hitPlate.hitArea = new PIXI.Rectangle(plateCx - 62, plateCy - 60, 124, 110);
      hitPlate.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._fullModal = true;
        this.relayout();
      });
      scene.addChild(hitPlate);
    }

    // 中：名称 + 品阶朱印 + 单价/功效 + 风味简评（避开右上黄铜图钉）
    const infoX = left + 132;
    const showStepper = view.maxQty > 1 && !this._inFridgeTut;
    const stepperCx = right - 110;
    const infoRight = showStepper ? stepperCx - 82 : right - 30;

    const title = makeText('title', view.title, SCENE_INK.ink, { size: 30 });
    title.position.set(infoX, top + 34);
    fitTextWidth(title, Math.max(96, infoRight - infoX - 54));
    scene.addChild(title);

    const seal = makeSealStamp(rarityLabel(view.rarity), 44, -0.08);
    seal.position.set(infoX + title.width + 28, top + 54);
    scene.addChild(seal);

    // 第二行：食效或单价状态
    const line2Y = top + 82;
    if (view.eatLabel) {
      const eatTxt = makeText('body', `食效 · ${view.eatLabel}`, SCENE_INK.green, {
        size: 23,
        fontWeight: '700',
      });
      eatTxt.position.set(infoX, line2Y);
      fitTextWidth(eatTxt, right - infoX);
      scene.addChild(eatTxt);
    } else if (unit > 0) {
      const pRow = new PIXI.Container();
      pRow.position.set(infoX, line2Y + 14);
      const cSp = sceneSprite(HUD_ICON.coin, 26, 26);
      let px = 0;
      if (cSp) {
        cSp.anchor.set(0, 0.5);
        pRow.addChild(cSp);
        px = 30;
      }
      const pTxt = makeText(
        'number',
        `${unit}/份${view.note ? `  ·  ${view.note}` : ''}`,
        SCENE_INK.gold,
        { size: 23 },
      );
      pTxt.anchor.set(0, 0.5);
      pTxt.position.set(px, 0);
      fitTextWidth(pTxt, right - infoX - px);
      pRow.addChild(pTxt);
      scene.addChild(pRow);
    } else {
      const rotTxt = makeText('body', '已变质腐坏 · 不可下锅，请及时丢弃', SCENE_INK.red, {
        size: 23,
        fontWeight: '700',
      });
      rotTxt.position.set(infoX, line2Y);
      fitTextWidth(rotTxt, right - infoX);
      scene.addChild(rotTxt);
    }

    // 第三行：风味评述（22pt）
    const blurb = makeText('body', view.blurb, SCENE_INK.soft, {
      size: 22,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: right - infoX,
      lineHeight: 28,
    });
    blurb.position.set(infoX, top + 116);
    if (blurb.height > 58) {
      const short = view.blurb.length > 26 ? `${view.blurb.slice(0, 25)}…` : view.blurb;
      blurb.text = short;
    }
    scene.addChild(blurb);

    // 右上：份数加减器
    if (showStepper) {
      scene.addChild(this._makeSlipStepper(stepperCx, top + 54, qty, view.maxQty));
    }

    // 水墨分割线 + 底部手绘操作按钮行
    drawInkDivider(scene, left, top + 188, contentW, 0.48, 10);

    const btnY = top + 212;
    const btnH = 58;

    if (this._inFridgeTut) {
      // 冰箱新手教学态：突出「品尝 / 卖出」
      const gap = 16;
      const eatW = 212;
      const sellW = contentW - eatW - gap;
      const eatBtn = makeSlicedButton({
        label: '品尝享用',
        width: eatW,
        height: btnH,
        skin: 'olive',
        fontSize: 27,
        onReady: this._scheduleRelayout,
      });
      eatBtn.position.set(left, btnY);
      eatBtn.on('pointertap', () => this._handleEat(selected));
      scene.addChild(eatBtn);

      const sellBtn = makeCoinButton({
        prefix: '卖出',
        price: goldN,
        width: sellW,
        height: btnH,
        skin: 'gold',
        textColor: SCENE_INK.ink,
        fontSize: 28,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      sellBtn.position.set(left + eatW + gap, btnY);
      sellBtn.on('pointertap', () => this._handleSell(selected));
      this._sellBtn = sellBtn;
      scene.addChild(sellBtn);
      return;
    }

    if (canEat) {
      // 饭菜四钮：整理 | 丢弃 | 品尝 | 卖出
      const gap = 10;
      const tidyW = 118;
      const dropW = 118;
      const eatW = 140;
      const sellW = contentW - tidyW - dropW - eatW - gap * 3;

      const tidyBtn = makeSlicedButton({
        label: '整理',
        width: tidyW,
        height: btnH,
        skin: 'cream',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      tidyBtn.position.set(left, btnY);
      tidyBtn.on('pointertap', () => this._tidyFridge());

      const dropBtn = makeSlicedButton({
        label: '丢弃',
        width: dropW,
        height: btnH,
        skin: 'wood',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      dropBtn.position.set(left + tidyW + gap, btnY);
      dropBtn.on('pointertap', () => this._discardItem(selected, qty));

      const eatBtn = makeSlicedButton({
        label: '品尝',
        width: eatW,
        height: btnH,
        skin: 'olive',
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      eatBtn.position.set(left + tidyW + dropW + gap * 2, btnY);
      eatBtn.on('pointertap', () => this._handleEat(selected));

      const sellBtn = makeCoinButton({
        prefix: '卖',
        price: goldN,
        width: sellW,
        height: btnH,
        skin: 'gold',
        textColor: SCENE_INK.ink,
        fontSize: 25,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      sellBtn.position.set(left + tidyW + dropW + eatW + gap * 3, btnY);
      sellBtn.on('pointertap', () => this._handleSell(selected));
      this._sellBtn = sellBtn;

      scene.addChild(tidyBtn, dropBtn, eatBtn, sellBtn);
    } else {
      // 食材三钮：整理冰箱 | 丢弃 | 卖出
      const gap = 12;
      const tidyW = 166;
      const dropW = 160;
      const sellW = contentW - tidyW - dropW - gap * 2;

      const tidyBtn = makeSlicedButton({
        label: '整理冰箱',
        width: tidyW,
        height: btnH,
        skin: 'cream',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      tidyBtn.position.set(left, btnY);
      tidyBtn.on('pointertap', () => this._tidyFridge());

      const dropBtn = makeSlicedButton({
        label: qty > 1 ? `丢弃×${qty}` : '丢弃',
        width: dropW,
        height: btnH,
        skin: unit <= 0 ? 'terracotta' : 'wood',
        fontSize: 25,
        onReady: this._scheduleRelayout,
      });
      dropBtn.position.set(left + tidyW + gap, btnY);
      dropBtn.on('pointertap', () => this._discardItem(selected, qty));

      const sellBtn = unit > 0
        ? makeCoinButton({
          prefix: '卖出',
          price: goldN,
          width: sellW,
          height: btnH,
          skin: 'gold',
          textColor: SCENE_INK.ink,
          fontSize: 26,
          silent: true,
          onReady: this._scheduleRelayout,
        })
        : makeSlicedButton({
          label: '已坏不可卖',
          width: sellW,
          height: btnH,
          skin: 'cream',
          textColor: 0x8A7358,
          fontSize: 24,
          silent: true,
          onReady: this._scheduleRelayout,
        });
      sellBtn.position.set(left + tidyW + dropW + gap * 2, btnY);
      sellBtn.on('pointertap', () => {
        if (unit <= 0) {
          AudioManager.play('ui_deny');
          Platform.showToast('变质食材卖不掉，点旁边的「丢弃」清理腾格吧');
          return;
        }
        this._handleSell(selected);
      });
      this._sellBtn = sellBtn;

      scene.addChild(tidyBtn, dropBtn, sellBtn);
    }
  }

  private _makeSlipStepper(cx: number, cy: number, qty: number, max: number): PIXI.Container {
    const root = new PIXI.Container();
    const span = 62;
    const mkBtn = (glyph: string, on: boolean, dx: number, delta: number) => {
      const b = new PIXI.Container();
      const g = new PIXI.Graphics();
      g.lineStyle(2.2, UI_PALETTE.ink, 1);
      g.beginFill(on ? UI_PALETTE.terracotta : 0xDFD2BE, 1);
      g.drawCircle(0, 0, 19);
      g.endFill();
      const t = makeText('heading', glyph, on ? 0xFFF8F0 : SCENE_INK.muted, {
        size: 24,
        ...(on ? { stroke: UI_PALETTE.ink, strokeWidth: 3 } : {}),
      });
      t.anchor.set(0.5);
      t.position.set(0, -1);
      b.addChild(g, t);
      b.position.set(cx + dx, cy);
      b.alpha = on ? 1 : 0.52;
      b.eventMode = 'static';
      b.cursor = on ? 'pointer' : 'default';
      b.hitArea = new PIXI.Circle(0, 0, 24);
      if (on) {
        bindUiClick(b);
        b.on('pointertap', (e) => {
          e.stopPropagation();
          this._inspectQty = Math.max(1, Math.min(max, qty + delta));
          this.relayout();
        });
      }
      return b;
    };
    const label = makeText('number', `${qty}/${max}`, SCENE_INK.ink, { size: 24 });
    label.anchor.set(0.5);
    label.position.set(cx, cy - 1);
    root.addChild(mkBtn('－', qty > 1, -span, -1), label, mkBtn('＋', qty < max, span, 1));
    return root;
  }

  private _handleSell(it: FridgeItem): void {
    if (TutorialGuard.block('sellDish')) return;
    const prevStep = TutorialManager.currentStep;
    if (!KitchenManager.sellQty(it.uid, this._inspectQty)) return;
    TutorialManager.onSold(it.uid);
    this._fullModal = false;
    this._inspectQty = 1;
    // 仅当本次出售真正推进了新手教学（SELL_DISH -> CLAIM_GIFT）时才自动收起冰箱弹礼金；已在 HINT_DOOR 时保持冰箱不闪退
    if (TutorialManager.currentStep !== prevStep && TutorialManager.at(TutorialStep.CLAIM_GIFT, TutorialStep.HINT_DOOR)) {
      this.close(true);
    } else {
      this.relayout();
    }
    this.onChange?.();
  }

  private _handleEat(it: FridgeItem): void {
    if (TutorialGuard.block('eatDish')) return;
    if (!KitchenManager.eat(it.uid, this._inspectQty)) return;
    this._fullModal = false;
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }

  private _discardItem(it: FridgeItem, qty: number): void {
    if (this._inFridgeTut) return;
    const save = KitchenManager.save;
    const target = save.fridge.find((row) => row.uid === it.uid);
    if (!target) return;
    const have = fridgeItemQty(target);
    const drop = Math.min(have, Math.max(1, Math.floor(qty)));
    const itemName = fridgeItemName(target);
    const nextFridge = have > drop
      ? save.fridge.map((row) => (row.uid === it.uid ? { ...row, qty: have - drop } : row))
      : save.fridge.filter((row) => row.uid !== it.uid);

    SaveManager.replace({ ...save, fridge: nextFridge });
    KitchenManager.emit();
    AudioManager.play('ui_click');
    Platform.showToast(`已清理丢弃「${itemName}」×${drop}`);
    this._fullModal = false;
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }

  private _tidyFridge(): void {
    if (this._inFridgeTut) return;
    const save = KitchenManager.save;
    if (!save.fridge.length) {
      Platform.showToast('冰箱空空的，无需整理');
      return;
    }
    const cleanItems = save.fridge.filter((it) => fridgeKind(it) === 'dish' || it.quality !== 'rotten');
    const rottenItems = save.fridge.filter((it) => fridgeKind(it) === 'food' && it.quality === 'rotten');

    // 合并同种鲜货/饭菜，变质品单独合并置于末尾方便清理
    const mergedClean = cleanItems.reduce(
      (acc, it) => putIntoFridge(acc, { ...it, qty: fridgeItemQty(it) }),
      [] as FridgeItem[],
    );

    const mergedRotten: FridgeItem[] = [];
    for (const rot of rottenItems) {
      let left = fridgeItemQty(rot);
      for (const ex of mergedRotten) {
        if (left <= 0) break;
        if (ex.defId !== rot.defId) continue;
        const space = FRIDGE_STACK - fridgeItemQty(ex);
        if (space <= 0) continue;
        const add = Math.min(space, left);
        ex.qty = fridgeItemQty(ex) + add;
        left -= add;
      }
      if (left > 0) mergedRotten.push({ ...rot, qty: left });
    }

    const sortFn = (a: FridgeItem, b: FridgeItem): number => {
      const ka = fridgeKind(a) === 'dish' ? 1 : 0;
      const kb = fridgeKind(b) === 'dish' ? 1 : 0;
      if (ka !== kb) return ka - kb;
      const ra = rarityRank(fridgeSlotRarity(a));
      const rb = rarityRank(fridgeSlotRarity(b));
      if (ra !== rb) return rb - ra;
      if (a.defId !== b.defId) return a.defId.localeCompare(b.defId);
      return fridgeItemQty(b) - fridgeItemQty(a);
    };

    mergedClean.sort(sortFn);
    mergedRotten.sort(sortFn);

    const nextFridge = [...mergedClean, ...mergedRotten];
    SaveManager.replace({ ...save, fridge: nextFridge });
    KitchenManager.emit();
    AudioManager.play('event_pop');
    Platform.showToast(
      mergedRotten.length > 0
        ? `冰箱已归置整齐（有 ${mergedRotten.length} 格变质食材已排至末尾）`
        : '冰箱已归置整齐！',
      'success',
    );
    this._scroller.reset();
    this._inspectQty = 1;
    this.relayout();
    this.onChange?.();
  }
}
