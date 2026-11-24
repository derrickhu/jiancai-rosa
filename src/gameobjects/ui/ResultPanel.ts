import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager } from '@/core/SceneManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { Platform } from '@/core/PlatformService';
import { tryShowInterstitial } from '@/services/InterstitialAdService';
import {
  RARITY_STYLE,
  canUseDailyAd,
  dailyAdLeft,
  fridgeCap,
  fridgeItemPrice,
  fridgeItemQty,
  fridgeKind,
  itemRarity,
  previewFridgeAfterHaul,
  recipeRarity,
  type ExtractedItem,
  type ExtractResult,
  type FridgeItem,
  type Rarity,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  P0_ART,
  UI_KIT,
  bindUiClick,
  drawItemSlotBox,
  fitTextWidth,
  makeAdButton,
  makeCornerMark,
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
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import { fridgeItemPath } from '@/utils/panelAssets';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneWall,
  drawStretchSheet,
  makePlateItem,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  wall: 'subpkg_images/scene_order_wall.png',
  basket: 'subpkg_images/scene_club_basket.png',
  titleSafe: 'subpkg_kitchen/ui_result_title_safe.png',
  titleMessy: 'subpkg_kitchen/ui_result_title_messy.png',
  flare: 'subpkg_kitchen/ui_pickup_flare.png',
} as const;

const W = 720;
const INK = SCENE_INK.ink;
const ROTTEN_FLOAT = 0xC9B8A8;

function fridgeSlotRarity(it: FridgeItem): Rarity {
  return fridgeKind(it) === 'dish' ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId);
}

interface GroupedLoot {
  defId: string;
  name: string;
  quality: ExtractedItem['quality'];
  rarity: Rarity;
  rotten: boolean;
  qty: number;
  totalSell: number;
}

export class ResultPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _data: ExtractResult | null = null;
  private _sell = new Set<string>();
  private _scroller: VerticalScroller;
  private _celebrate = false;
  private _pops: PIXI.Container[] = [];
  private _paintQueued = false;
  private _pickTapAt = 0;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 30;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    this.on('pointertap', this._onBgTap);
  }

  private _onBgTap = (): void => {
    if (!this._isOpen) return;
    if (this._data?.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) return;
    this.close();
  };

  open(result: ExtractResult): void {
    this._isOpen = true;
    this.visible = true;
    this._data = result;
    this._sell.clear();
    this._celebrate = true;
    this._scroller.reset();
    this._scroller.enable();
    AudioManager.play(result.kind === 'safe' ? 'result_safe' : 'result_dusk');
    this.relayout(result);
    OverlayManager.bringToFront();
    TutorialOverlay.onBlankTap(this._onBgTap);
    TutorialOverlay.register('result', () => ({ dim: false }));
    TutorialOverlay.refresh();
  }

  tutorialBodyRect(): { dim: false } {
    return { dim: false };
  }

  close(): void {
    if (!this._isOpen) return;
    if (TutorialGuard.block('closeResult')) return;
    if (KitchenManager.pendingHaul?.length) {
      const left = Math.max(0, KitchenManager.unpackNeed() - this._picked());
      Platform.showToast(left > 0 ? `再卖掉 ${left} 格才能装下` : '先点下方按钮确认入库');
      return;
    }
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._sell.clear();
    this._stopPops();
    this._scroller.disable();
    TutorialOverlay.unregister('result');
    TutorialOverlay.onBlankTap(null);
    const inTutorial = TutorialManager.isActive;
    TutorialManager.advanceIf(TutorialStep.WAIT_RESULT);
    RunManager.clear();
    if (!inTutorial) void tryShowInterstitial('go_home');
    SceneManager.switchTo('kitchen');
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

  relayout(result?: ExtractResult): void {
    const data = result ?? this._data ?? RunManager.run?.extract;
    this._stopPops();
    this._root.removeChildren();
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) return;
    this._data = data;
    if (data.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) {
      this._drawPick(data);
      return;
    }
    this._drawSummary(data);
  }

  private _groupLoot(items: ExtractedItem[]): GroupedLoot[] {
    const map = new Map<string, GroupedLoot>();
    for (const it of items) {
      const rotten = it.quality === 'rotten';
      const rarity = itemRarity(it.defId);
      const key = `${it.defId}|${rotten ? 'rotten' : 'clean'}`;
      const hit = map.get(key);
      if (hit) {
        hit.qty += 1;
        hit.totalSell += Math.max(0, it.sell);
      } else {
        map.set(key, {
          defId: it.defId,
          name: it.name,
          quality: it.quality,
          rarity,
          rotten,
          qty: 1,
          totalSell: Math.max(0, it.sell),
        });
      }
    }
    return [...map.values()];
  }

  // ── 赶集归家木案收获账单场景 ────────────────────────────────────────────
  private _drawSummary(data: ExtractResult): void {
    const celebrate = this._celebrate;
    this._celebrate = false;

    const groups = this._groupLoot(data.items);
    const itemPaths = groups.map((g) => resolveItemAssetPath(g.defId, g.rotten));
    watchTextures(
      [
        ...Object.values(ART),
        ...sceneArtPaths(),
        HUD_ICON.coin,
        UI_KIT.btnOlive,
        UI_KIT.btnGold,
        ...itemPaths,
      ],
      this._scheduleRelayout,
    );

    const cols = groups.length <= 2 ? Math.max(1, groups.length) : 3;
    const rows = Math.max(1, Math.ceil(groups.length / cols));
    const cellH = 166;
    const maxVisibleRows = 3;
    const gridContentH = groups.length ? rows * cellH : 210;
    const gridViewH = Math.min(gridContentH, maxVisibleRows * cellH);

    const sheetTop = 144;
    const headerH = 104;
    const summaryH = 66;
    const btnAreaH = 92;
    const sheetH = headerH + gridViewH + summaryH + btnAreaH + 26;
    const panelH = sheetTop + sheetH + 30;

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 64,
      dimAlpha: 0.66,
      onDimTap: this._onBgTap,
    });

    // 允许点击收获账单空白处也直接回厨（保持与 WAIT_RESULT 引导兼容）
    scene.cursor = 'pointer';

    drawSceneWall(scene, ART.wall, W, panelH, 160, 110);

    // 顶部大牌匾 / 庆贺横幅
    const bannerWrap = new PIXI.Container();
    const titlePath = data.kind === 'safe' ? ART.titleSafe : ART.titleMessy;
    const topFlare = makeRarityFlare('legendary', 400);
    topFlare.alpha = 0.6;
    topFlare.position.set(W / 2, 46);
    scene.addChild(topFlare);

    const titleSp = sceneSprite(titlePath, 432, 164);
    if (titleSp) {
      titleSp.anchor.set(0.5);
      titleSp.position.set(W / 2, 42);
      bannerWrap.addChild(titleSp);
    } else {
      drawPlaqueTitle(
        bannerWrap,
        data.kind === 'safe' ? '满载归家' : '天黑收摊',
        W / 2,
        -46,
        352,
      );
    }
    scene.addChild(bannerWrap);

    // 钉在木案墙上的宣纸收获账单
    const sheetX = 28;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 140, 120);

    const headL = 96;
    const headR = W - 96;
    const contentL = 68;
    const contentR = W - 68;
    const contentW = contentR - contentL;

    // 账单抬头 + 朱红印章（内收至 96..W-96 且下移至 sheetTop+64，完全避开左右铜钉）
    const headCy = sheetTop + 64;
    const billTitle = makeText(
      'title',
      data.kind === 'safe' ? '本趟收获单' : '暮色清点单',
      INK,
      { size: 32 },
    );
    billTitle.anchor.set(0, 0.5);
    billTitle.position.set(headL, headCy);
    scene.addChild(billTitle);

    const stamp = makeSealStamp(data.kind === 'safe' ? '丰收' : '归家', 50, -0.09);
    stamp.position.set(headR - 25, headCy);
    scene.addChild(stamp);

    const totalCount = makeText('body', `共 ${data.items.length} 件`, SCENE_INK.soft, { size: 24 });
    totalCount.anchor.set(1, 0.5);
    totalCount.position.set(headR - 62, headCy);
    scene.addChild(totalCount);

    drawInkDivider(scene, contentL, sheetTop + headerH - 12, contentW, 0.55, 12);

    // 战利品瓷碟陈列区
    const gridTop = sheetTop + headerH + 6;
    if (!groups.length) {
      this._scroller.clear();
      const emptyWrap = new PIXI.Container();
      const bsk = sceneSprite(ART.basket, 196, 136);
      if (bsk) {
        bsk.anchor.set(0.5);
        bsk.position.set(W / 2, gridTop + 76);
        emptyWrap.addChild(bsk);
      }
      const emptyTxt = makeText('heading', '两手空空归家，歇口气再去逛！', SCENE_INK.soft, { size: 26 });
      emptyTxt.anchor.set(0.5);
      emptyTxt.position.set(W / 2, gridTop + 168);
      emptyWrap.addChild(emptyTxt);
      scene.addChild(emptyWrap);
    } else {
      const colW = Math.floor(contentW / cols);
      const viewport = new PIXI.Container();
      const content = new PIXI.Container();
      viewport.addChild(content);
      scene.addChild(viewport);

      groups.forEach((g, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cx = contentL + col * colW + colW / 2;
        const cy = row * cellH + 74;

        const cellNode = new PIXI.Container();
        cellNode.position.set(cx, cy);

        if (!g.rotten && g.rarity !== 'common') {
          const flare = makeRarityFlare(g.rarity, 152);
          flare.position.set(0, -10);
          cellNode.addChild(flare);
        }

        const plate = makePlateItem({
          iconPath: resolveItemAssetPath(g.defId, g.rotten),
          plateW: cols === 1 ? 168 : 134,
          iconSize: cols === 1 ? 104 : 84,
          qty: g.qty,
        });
        cellNode.addChild(plate);

        if (g.rotten) {
          const rotStamp = makeSealStamp('蔫了', 42, 0.12);
          rotStamp.position.set(-44, -34);
          cellNode.addChild(rotStamp);
        }

        const nameColor = g.rotten ? SCENE_INK.muted : (RARITY_STYLE[g.rarity]?.ink ?? INK);
        const nameLbl = makeText('body', g.name, nameColor, { size: 24, fontWeight: '700' });
        nameLbl.anchor.set(0.5, 0);
        nameLbl.position.set(0, 44);
        fitTextWidth(nameLbl, colW - 14);
        cellNode.addChild(nameLbl);

        content.addChild(cellNode);
        if (celebrate) this._pop(cellNode, 0.06 + idx * 0.05);
      });

      content.position.set(0, gridTop);
      const maxScroll = Math.max(0, gridContentH - gridViewH);
      if (maxScroll > 0) {
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawRect(contentL - 10, gridTop - 6, contentW + 20, gridViewH + 10);
        mask.endFill();
        mask.eventMode = 'none';
        scene.addChild(mask);
        viewport.mask = mask;
      }
      const tlStage = toStage(contentL, gridTop);
      this._scroller.attach({
        content,
        maxScroll,
        baseY: gridTop,
        hit: {
          x: tlStage.x,
          y: tlStage.y,
          w: contentW * scale,
          h: gridViewH * scale,
        },
      });
    }

    // 底部估值汇总行 + 醒目入库按钮
    const sumY = gridTop + gridViewH + 8;
    drawInkDivider(scene, contentL, sumY, contentW, 0.45, 10);

    const totalSell = groups.reduce((s, g) => s + g.totalSell, 0);
    const valRow = this._coinInline('鲜货估值', totalSell, 25);
    valRow.position.set(contentL, sumY + 36);
    scene.addChild(valRow);

    const statusNote = data.lost > 0
      ? makeText('body', `天黑颠落 ${data.lost} 件`, SCENE_INK.red, { size: 23, fontWeight: '700' })
      : makeText('body', '全部稳妥收入冰箱', SCENE_INK.green, { size: 23, fontWeight: '700' });
    statusNote.anchor.set(1, 0.5);
    statusNote.position.set(contentR, sumY + 36);
    scene.addChild(statusNote);

    const btnW = 356;
    const btnH = 62;
    const btnY = sumY + summaryH + 6;
    const homeBtn = makeSlicedButton({
      label: groups.length > 0 ? '收进冰箱 · 回厨房' : '回厨房歇息',
      width: btnW,
      height: btnH,
      skin: 'olive',
      fontSize: 28,
      onReady: this._scheduleRelayout,
    });
    homeBtn.position.set(Math.round((W - btnW) / 2), btnY);
    homeBtn.on('pointertap', (e) => {
      e.stopPropagation();
      this._onBgTap();
    });
    scene.addChild(homeBtn);

    if (groups.length && celebrate) {
      const floatCenter = toStage(W / 2, gridTop + gridViewH * 0.42);
      this._playLootFloats(groups, floatCenter.x, floatCenter.y);
    }
    if (celebrate) {
      this._pop(bannerWrap, 0);
    }
  }

  private _coinInline(prefix: string, amount: number, size: number): PIXI.Container {
    const row = new PIXI.Container();
    row.eventMode = 'none';
    let x = 0;
    if (prefix) {
      const pre = makeText('body', `${prefix} `, SCENE_INK.soft, { size });
      pre.anchor.set(0, 0.5);
      pre.position.set(0, 0);
      row.addChild(pre);
      x += pre.width + 4;
    }
    const iconS = Math.round(size * 1.25);
    const coin = sceneSprite(HUD_ICON.coin, iconS, iconS);
    if (coin) {
      coin.anchor.set(0, 0.5);
      coin.position.set(x, 0);
      row.addChild(coin);
      x += iconS + 5;
    }
    const num = makeText('number', String(Math.max(0, amount)), SCENE_INK.gold, { size: size + 2 });
    num.anchor.set(0, 0.5);
    num.position.set(x, 0);
    row.addChild(num);
    return row;
  }

  private _floatLabel(text: string, rarity: Rarity, rotten = false): PIXI.Text {
    const fill = rotten ? ROTTEN_FLOAT : (RARITY_STYLE[rarity]?.float ?? RARITY_STYLE.common.float);
    return makeText('title', text, fill, {
      size: 36,
      stroke: INK,
      strokeWidth: 7,
    });
  }

  private _playLootFloats(rows: GroupedLoot[], x: number, y: number): void {
    const layer = new PIXI.Container();
    layer.eventMode = 'none';
    this._root.addChild(layer);
    const step = 0.5;
    rows.slice(0, 6).forEach((row, i) => {
      const lab = this._floatLabel(`${row.name} +${row.qty}`, row.rarity, row.rotten);
      lab.anchor.set(0.5);
      lab.position.set(x, y);
      lab.alpha = 0;
      lab.scale.set(0.72);
      layer.addChild(lab);
      this._pops.push(lab);
      const delay = 0.2 + i * step;
      TweenManager.to({
        target: lab,
        props: { alpha: 1 },
        duration: 0.12,
        delay,
        ease: Ease.easeOutQuad,
        onComplete: () => {
          if (lab.destroyed) return;
          TweenManager.to({
            target: lab,
            props: { alpha: 0 },
            duration: 0.3,
            delay: 0.42,
            ease: Ease.easeInQuad,
          });
        },
      });
      TweenManager.to({
        target: lab.scale,
        props: { x: 1, y: 1 },
        duration: 0.2,
        delay,
        ease: Ease.easeOutBack,
      });
      TweenManager.to({
        target: lab,
        props: { y: y - 96 },
        duration: 0.9,
        delay,
        ease: Ease.easeOutQuad,
      });
    });
  }

  private _pop(target: PIXI.Container, delay: number): void {
    this._pops.push(target);
    target.alpha = 0;
    target.scale.set(0.78);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.22,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: 1, y: 1 },
      duration: 0.28,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopPops(): void {
    for (const node of this._pops) {
      TweenManager.cancelTarget(node);
      TweenManager.cancelTarget(node.scale);
    }
    this._pops = [];
  }

  // ── 满柜腾格子：木墙 + 宣纸清点单 + 大格勾选变现 ───────────────────────────
  private _drawPick(data: ExtractResult): void {
    const save = KitchenManager.save;
    const haul = KitchenManager.pendingHaul ?? data.items;
    const preview = previewFridgeAfterHaul(save, haul);
    const valid = new Set(preview.map((it) => it.uid));
    for (const uid of [...this._sell]) {
      if (!valid.has(uid)) this._sell.delete(uid);
    }

    watchTextures(
      [
        ART.wall,
        ...sceneArtPaths(),
        P0_ART.adClapper,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        HUD_ICON.coin,
        ...preview.map(fridgeItemPath),
      ],
      this._scheduleRelayout,
    );

    const cap = fridgeCap(save);
    const owned = new Set(save.fridge.map((it) => it.uid));
    const need = Math.max(0, preview.length - cap);
    const picked = this._sell.size;
    const remain = preview.length - picked;
    const ready = remain <= cap;
    const gold = preview.reduce((sum, it) => (
      this._sell.has(it.uid) ? sum + fridgeItemPrice(it, save) : sum
    ), 0);

    const cols = 5;
    const contentL = 56;
    const contentR = W - 56;
    const contentW = contentR - contentL;
    const cell = Math.floor(contentW / cols);
    const totalRows = Math.max(1, Math.ceil(preview.length / cols));
    const gridContentH = totalRows * cell;
    const gridViewH = Math.min(gridContentH, cell * 4 + 12);

    const sheetTop = 142;
    const headerH = 136;
    const footerH = 128;
    const sheetH = headerH + gridViewH + footerH + 22;
    const panelH = sheetTop + sheetH + 28;

    const { scene, scale, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 52,
      dimAlpha: 0.66,
      onDimTap: () => {
        const left = Math.max(0, need - picked);
        Platform.showToast(left > 0 ? `还需勾选 ${left} 格卖掉才能装下` : '请点下方确认按钮入库');
      },
    });

    drawSceneWall(scene, ART.wall, W, panelH, 160, 110);
    drawPlaqueTitle(scene, '冰箱腾格子', W / 2, -46, 344);

    const sheetX = 28;
    const sheetW = W - sheetX * 2;
    drawStretchSheet(scene, SCENE_ART.sheet, sheetX, sheetTop, sheetW, sheetH, 140, 120);

    // 宣纸抬头内收至 94..W-94 且下移至 sheetTop+62，彻底避开木匾底边与左右铜钉
    const headL = 94;
    const headR = W - 94;
    const topRowY = sheetTop + 62;
    const capLbl = makeText(
      'title',
      `占格 ${remain} / ${cap}`,
      ready ? SCENE_INK.green : SCENE_INK.red,
      { size: 30 },
    );
    capLbl.anchor.set(0, 0.5);
    capLbl.position.set(headL, topRowY);
    scene.addChild(capLbl);

    if (picked > 0 && gold > 0) {
      const gainRow = this._coinInline('变现', gold, 24);
      gainRow.position.set(headR - gainRow.width, topRowY);
      scene.addChild(gainRow);
    } else {
      const diffTxt = makeText('heading', `需腾 ${Math.max(0, need - picked)} 格`, SCENE_INK.red, { size: 26 });
      diffTxt.anchor.set(1, 0.5);
      diffTxt.position.set(headR, topRowY);
      scene.addChild(diffTxt);
    }

    const subHint = makeText(
      'body',
      ready ? '空位已够！可继续调整，或点下方确认入库' : `点选要卖掉的食材，再腾 ${need - picked} 格即可装下`,
      ready ? SCENE_INK.soft : SCENE_INK.red,
      { size: 23 },
    );
    subHint.anchor.set(0, 0.5);
    subHint.position.set(contentL, sheetTop + 102);
    fitTextWidth(subHint, contentW);
    scene.addChild(subHint);

    drawInkDivider(scene, contentL, sheetTop + headerH - 12, contentW, 0.5, 10);

    // 物品格滚动视图
    const gridTop = sheetTop + headerH;
    const viewport = new PIXI.Container();
    const grid = new PIXI.Container();
    viewport.addChild(grid);
    scene.addChild(viewport);

    preview.forEach((it, i) => {
      const gx = contentL + (i % cols) * cell + 4;
      const gy = Math.floor(i / cols) * cell + 4;
      grid.addChild(this._pickSlot(gx, gy, cell - 8, it, i >= cap, !owned.has(it.uid)));
    });
    grid.position.set(0, gridTop);

    const maxScroll = Math.max(0, gridContentH - gridViewH);
    if (maxScroll > 0) {
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawRect(contentL - 4, gridTop, contentW + 8, gridViewH);
      mask.endFill();
      mask.eventMode = 'none';
      scene.addChild(mask);
      viewport.mask = mask;
    }

    const hitStage = toStage(contentL, gridTop);
    this._scroller.attach({
      content: grid,
      maxScroll,
      baseY: gridTop,
      hit: {
        x: hitStage.x,
        y: hitStage.y,
        w: contentW * scale,
        h: gridViewH * scale,
      },
    });

    // 底部操作区
    const footTop = gridTop + gridViewH + 10;
    drawInkDivider(scene, contentL, footTop, contentW, 0.45, 10);

    const btnY = footTop + 44;
    const btnH = 60;
    const showVip = !TutorialManager.isActive && need > 0;

    if (showVip) {
      const adLeft = dailyAdLeft(save, 'unpack_vip');
      const canVip = canUseDailyAd(save, 'unpack_vip');
      const gap = 14;
      const vipW = Math.round((contentW - gap) * 0.56);
      const okW = contentW - gap - vipW;

      const vipTip = makeText('caption', '或请街坊 1.5 倍高价包圆溢出余菜：', SCENE_INK.muted, { size: 22, fontWeight: '600' });
      vipTip.anchor.set(0.5, 0.5);
      vipTip.position.set(W / 2, footTop + 22);
      scene.addChild(vipTip);

      const vipBtn = makeAdButton({
        label: '1.5倍包圆余菜',
        width: vipW,
        height: btnH,
        skin: 'gold',
        textColor: INK,
        badge: canVip ? `剩${adLeft}次` : '今日已满',
        disabled: !canVip,
        onReady: this._scheduleRelayout,
      });
      vipBtn.position.set(contentL, btnY);
      if (canVip) {
        vipBtn.on('pointertap', () => {
          Platform.showRewardedVideo('unpack_vip', () => {
            const res = KitchenManager.vipUnpackOverflow();
            if (res.error) return;
            if (res.gained > 0) AudioManager.play('coin_gain');
            this._data = this._data ? { ...this._data, needsPick: false } : null;
            Platform.showToast(
              `街坊 1.5 倍包圆 ${res.soldCount} 格余菜，入账 ${res.gained} 金！`,
              'success',
            );
            this._isOpen = false;
            this.visible = false;
            this._sell.clear();
            this._stopPops();
            this._scroller.disable();
            RunManager.clear();
            SceneManager.switchTo('kitchen');
          });
        });
      }
      scene.addChild(vipBtn);

      const ok = makeSlicedButton({
        label: ready ? '确认入库' : `还差 ${need - picked} 格`,
        width: okW,
        height: btnH,
        skin: ready ? 'olive' : 'terracotta',
        fontSize: 25,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      ok.alpha = ready ? 1 : 0.62;
      ok.position.set(contentL + vipW + gap, btnY);
      ok.on('pointertap', () => this._confirm());
      bindUiClick(ok);
      scene.addChild(ok);
    } else {
      const btnW = 340;
      const ok = makeSlicedButton({
        label: ready ? '卖出所选 · 入库' : `再选 ${need - picked} 格`,
        width: btnW,
        height: btnH,
        skin: ready ? 'olive' : 'terracotta',
        fontSize: 26,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      ok.alpha = ready ? 1 : 0.62;
      ok.position.set(Math.round((W - btnW) / 2), btnY);
      ok.on('pointertap', () => this._confirm());
      bindUiClick(ok);
      scene.addChild(ok);
    }
  }

  private _pickSlot(x: number, y: number, size: number, it: FridgeItem, overflow: boolean, isNew: boolean): PIXI.Container {
    const on = this._sell.has(it.uid);
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawItemSlotBox(bg, x, y, size, size, {
      radius: 12,
      rarity: fridgeSlotRarity(it),
      dimmed: on,
      selected: overflow && !on,
    });
    root.addChild(bg);

    if (fridgeKind(it) === 'dish') {
      const tex = dishTexture(it.defId);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 16, size - 16);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2 - 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.36;
        root.addChild(icon);
      }
    } else {
      const look = it.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
      const tex = itemLookTexture(it.defId, look);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 16, size - 16);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2 - 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.36;
        root.addChild(icon);
      }
    }

    const qty = fridgeItemQty(it);
    if (qty > 1 && !on) {
      const qTxt = makeText('number', `×${qty}`, INK, { size: 22, stroke: 0xFFF8EA, strokeWidth: 4 });
      qTxt.anchor.set(1, 1);
      qTxt.position.set(x + size - 5, y + size - 3);
      root.addChild(qTxt);
    }
    if (overflow && !on) {
      const mark = makeCornerMark('超', 20, SCENE_INK.red);
      mark.anchor.set(0, 0);
      mark.position.set(x + 6, y + 4);
      root.addChild(mark);
    } else if (isNew && !on) {
      const mark = makeCornerMark('新', 20, SCENE_INK.green);
      mark.anchor.set(0, 0);
      mark.position.set(x + 6, y + 4);
      root.addChild(mark);
    }
    if (on) {
      const stamp = makeSealStamp('卖出', 52, -0.1);
      stamp.position.set(x + size / 2, y + size / 2);
      root.addChild(stamp);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', () => {
      if (this._scroller.moved) return;
      const now = Date.now();
      if (now - this._pickTapAt < 280) return;
      this._pickTapAt = now;
      AudioManager.play('ui_click');
      if (this._sell.has(it.uid)) this._sell.delete(it.uid);
      else this._sell.add(it.uid);
      this.relayout();
    });
    return root;
  }

  private _picked(): number {
    return this._sell.size;
  }

  private _confirm(): void {
    const need = KitchenManager.unpackNeed();
    if (this._picked() < need) {
      AudioManager.play('ui_deny');
      Platform.showToast(`再勾选 ${need - this._picked()} 格卖掉才能装下`);
      return;
    }
    const { error, gained, kept } = KitchenManager.commitUnpack([...this._sell]);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    if (gained > 0) AudioManager.play('coin_gain');
    this._data = this._data ? { ...this._data, needsPick: false } : null;
    Platform.showToast(gained > 0 ? `卖掉余菜收入 ${gained} 金，${kept} 格入冰箱` : `${kept} 格收入冰箱`, 'success');
    this._isOpen = false;
    this.visible = false;
    this._sell.clear();
    this._stopPops();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }
}
