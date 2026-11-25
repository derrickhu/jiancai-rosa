import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager, type ActiveTween } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager } from '@/core/SceneManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { Platform } from '@/core/PlatformService';
import { tryShowInterstitial } from '@/services/InterstitialAdService';
import { destroyDisplayChildren, destroyDisplayNode } from '@/utils/destroy';
import {
  canUseDailyAd,
  dailyAdLeft,
  fridgeCap,
  fridgeItemPrice,
  fridgeItemQty,
  fridgeKind,
  itemRarity,
  previewFridgeAfterHaul,
  rarityRank,
  rarityStyleOf,
  rarityTierLabel,
  recipeRarity,
  resolveRarityTier,
  type ExtractedItem,
  type ExtractResult,
  type FridgeItem,
  type Rarity,
  type RarityTier,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  P0_ART,
  UI_KIT,
  attachSpriteContour,
  bindUiClick,
  drawItemSlotBox,
  drawRarityFrame,
  fillRect,
  fitTextWidth,
  makeAdButton,
  makeCornerMark,
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
  whenTextureReady,
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
  makeRaritySeal,
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
} as const;

const SUMMARY_W = 724;
const PICK_W = 720;
const GRID_W = 684;
const INK = SCENE_INK.ink;
const DARK_STROKE = 0x22130A;
const STAGE_BG = 0x150E09;
const ROTTEN_FLOAT = 0xC9B8A8;
const LEGENDARY_FLOAT = 0xDF9BFF;

const FLOAT_X_OFFSETS = [-18, 18, -10, 10] as const;
const FLOAT_START_Y_RATIO = 0.55;

function fridgeSlotRarity(it: FridgeItem): Rarity {
  return fridgeKind(it) === 'dish' ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId);
}

function tierSortScore(tier: RarityTier): number {
  return tier === 'god' ? 4 : rarityRank(tier);
}

function tierFloatColor(tier: RarityTier, rotten = false): number {
  if (rotten) return ROTTEN_FLOAT;
  if (tier === 'legendary') return LEGENDARY_FLOAT;
  return rarityStyleOf(tier).float;
}

interface GroupedLoot {
  defId: string;
  name: string;
  quality: ExtractedItem['quality'];
  rarity: Rarity;
  tier: RarityTier;
  rotten: boolean;
  qty: number;
  totalSell: number;
}

interface GridSpec {
  cols: number;
  iconSize: number;
  cellH: number;
  maxVisibleRows: number;
}

function resolveGridSpec(count: number): GridSpec {
  if (count <= 1) {
    return { cols: 1, iconSize: 184, cellH: 240, maxVisibleRows: 1 };
  }
  if (count === 2) {
    return { cols: 2, iconSize: 156, cellH: 214, maxVisibleRows: 1 };
  }
  if (count === 3) {
    return { cols: 3, iconSize: 132, cellH: 196, maxVisibleRows: 1 };
  }
  if (count === 4) {
    return { cols: 2, iconSize: 136, cellH: 186, maxVisibleRows: 2 };
  }
  if (count <= 6) {
    return { cols: 3, iconSize: 120, cellH: 170, maxVisibleRows: 2 };
  }
  if (count <= 8) {
    return { cols: 4, iconSize: 106, cellH: 156, maxVisibleRows: 2 };
  }
  if (count <= 12) {
    return { cols: 4, iconSize: 96, cellH: 142, maxVisibleRows: 3 };
  }
  return { cols: 4, iconSize: 88, cellH: 128, maxVisibleRows: 4 };
}

/** 柔和深暖暗角遮罩底（无刺眼黄光/放射光斑，以温润深胡桃暗调烘托鲜亮菜品轮廓）。 */
function makeWarmVignetteBackdrop(sw: number, sh: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  g.eventMode = 'none';

  // 主体深暖炭褐底幕
  fillRect(g, 0, 0, sw, sh, STAGE_BG);
  g.alpha = 0.91;

  // 中央柔和暗暖木桌面底韵（极低饱和度与不透明度，绝不泛黄）
  g.beginFill(0x2B1C11, 0.22);
  g.drawEllipse(sw * 0.5, sh * 0.46, sw * 0.56, sh * 0.34);
  g.endFill();

  // 上下边缘自然收暗暗角带，聚拢视线到中央陈列区
  const topBand = Math.round(sh * 0.16);
  const botBand = Math.round(sh * 0.18);
  g.beginFill(0x080402, 0.30);
  g.drawRect(0, 0, sw, topBand);
  g.drawRect(0, sh - botBand, sw, botBand);
  g.endFill();

  g.beginFill(0x080402, 0.16);
  g.drawRect(0, 0, sw, Math.round(topBand * 1.65));
  g.drawRect(0, sh - Math.round(botBand * 1.65), sw, Math.round(botBand * 1.65));
  g.endFill();

  return g;
}

/** 细腻克制的暖金手绘分割细线（两段式渐隐细线 + 中央微菱星点，拉开上下呼吸感）。 */
function drawWarmGoldDivider(parent: PIXI.Container, cx: number, y: number, width = 560): void {
  const g = new PIXI.Graphics();
  g.eventMode = 'none';

  const half = Math.round(width * 0.5);
  const midSpan = Math.round(width * 0.28);
  const gap = 11;

  // 外段纤细渐隐暖铜线
  g.lineStyle(1.1, 0xC89B54, 0.24);
  g.moveTo(cx - half, y);
  g.lineTo(cx - midSpan, y);
  g.moveTo(cx + midSpan, y);
  g.lineTo(cx + half, y);

  // 内段温润鎏金细线
  g.lineStyle(1.5, 0xE7BF74, 0.46);
  g.moveTo(cx - midSpan, y);
  g.lineTo(cx - gap, y);
  g.moveTo(cx + gap, y);
  g.lineTo(cx + midSpan, y);

  // 中央小巧菱星与两侧微圆点
  g.lineStyle(0);
  g.beginFill(0xF3D48E, 0.68);
  g.moveTo(cx, y - 3.6);
  g.lineTo(cx + 3.6, y);
  g.lineTo(cx, y + 3.6);
  g.lineTo(cx - 3.6, y);
  g.closePath();
  g.drawCircle(cx - gap - 4, y, 1.5);
  g.drawCircle(cx + gap + 4, y, 1.5);
  g.endFill();

  parent.addChild(g);
}

/** 蔫菜专属灰褐小方印，尺寸与品质篆印对齐。 */
function makeRottenSeal(size: number, rotation = -0.08): PIXI.Container {
  const root = new PIXI.Container();
  root.eventMode = 'none';
  const rOuter = Math.max(6, Math.round(size * 0.18));
  const inset = Math.max(3, Math.round(size * 0.09));
  const rInner = Math.max(3, rOuter - 2.5);

  const g = new PIXI.Graphics();
  g.beginFill(0x140C07, 0.28);
  g.drawRoundedRect(-size / 2 + 1.5, -size / 2 + 2, size, size, rOuter);
  g.endFill();

  g.lineStyle(2, 0x3D332B, 0.96);
  g.beginFill(0x6D6055, 0.95);
  g.drawRoundedRect(-size / 2, -size / 2, size, size, rOuter);
  g.endFill();

  g.lineStyle(1.2, 0xD8CCC0, 0.68);
  g.drawRoundedRect(
    -size / 2 + inset,
    -size / 2 + inset,
    size - inset * 2,
    size - inset * 2,
    rInner,
  );
  root.addChild(g);

  const fontSize = Math.max(15, Math.round(size * 0.36));
  const t = makeText('caption', '蔫了', 0xEFE6DC, {
    size: fontSize,
    fontWeight: '700',
    stroke: 0x2F2620,
    strokeWidth: 2,
  });
  t.anchor.set(0.5);
  t.position.set(0, -0.5);
  if (t.width > size - inset * 2 - 3) {
    t.scale.set((size - inset * 2 - 3) / t.width);
  }
  root.addChild(t);
  root.rotation = rotation;
  return root;
}

export class ResultPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _fxLayer = new PIXI.Container();
  private _data: ExtractResult | null = null;
  private _viewMode: 'summary' | 'pick' = 'summary';
  private _openedAt = 0;
  private _sell = new Set<string>();
  private _scroller: VerticalScroller;
  private _itemPops: PIXI.Container[] = [];
  private _floatTweens: ActiveTween[] = [];
  private _floatNodes = new Set<PIXI.Container>();
  private _paintQueued = false;
  private _pickTapAt = 0;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 30;
    this.eventMode = 'static';
    this._fxLayer.eventMode = 'none';
    this.addChild(this._root, this._fxLayer);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    this.on('pointertap', this._onPointerTap);
    Game.onViewportChange(() => {
      if (this._isOpen) this._scheduleRelayout();
    });
  }

  private _hasPendingPick(data?: ExtractResult | null): boolean {
    const cur = data ?? this._data;
    return Boolean(cur?.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0);
  }

  private _onPointerTap = (): void => {
    if (!this._isOpen) return;
    if (this._scroller.moved) {
      this._scroller.moved = false;
      return;
    }
    if (this._viewMode === 'summary') {
      this._advanceFromSummary();
    }
  };

  private _advanceFromSummary = (): void => {
    if (!this._isOpen) return;
    if (this._viewMode === 'summary' && this._hasPendingPick()) {
      AudioManager.play('ui_click');
      this._viewMode = 'pick';
      this._clearFloats();
      this._scroller.reset();
      this.relayout();
      return;
    }
    if (this._viewMode === 'pick') {
      const left = Math.max(0, KitchenManager.unpackNeed() - this._picked());
      Platform.showToast(left > 0 ? `再卖掉 ${left} 格才能装下` : '先点下方按钮确认入库');
      return;
    }
    this.close();
  };

  open(result: ExtractResult): void {
    this._isOpen = true;
    this.visible = true;
    this._data = result;
    this._openedAt = Date.now();
    this._sell.clear();
    this._clearFloats();

    const hasItems = result.items.length > 0;
    this._viewMode = !hasItems && this._hasPendingPick(result) ? 'pick' : 'summary';

    this._scroller.reset();
    this._scroller.enable();
    AudioManager.play(result.kind === 'safe' ? 'result_safe' : 'result_dusk');
    this.relayout(result);

    if (hasItems) {
      const groups = this._groupLoot(result.items);
      if (groups.length > 0) {
        this._playLootFloats(groups);
      }
    }

    OverlayManager.bringToFront();
    TutorialOverlay.onBlankTap(this._advanceFromSummary);
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
      if (this._viewMode === 'summary') {
        this._viewMode = 'pick';
        this._clearFloats();
        this._scroller.reset();
        this.relayout();
        return;
      }
      const left = Math.max(0, KitchenManager.unpackNeed() - this._picked());
      Platform.showToast(left > 0 ? `再卖掉 ${left} 格才能装下` : '先点下方按钮确认入库');
      return;
    }
    this._finalizeExitToKitchen(true);
  }

  private _finalizeExitToKitchen(allowInterstitial: boolean): void {
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._viewMode = 'summary';
    this._sell.clear();
    this._stopItemPops();
    this._clearFloats();
    this._scroller.disable();
    destroyDisplayChildren(this._root);
    TutorialOverlay.unregister('result');
    TutorialOverlay.onBlankTap(null);
    const inTutorial = TutorialManager.isActive;
    TutorialManager.advanceIf(TutorialStep.WAIT_RESULT);
    RunManager.clear();
    if (allowInterstitial && !inTutorial) {
      void tryShowInterstitial('go_home');
    }
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

  /**
   * 仅重绘 `_root` 内的静态/滚动 UI；严禁触碰 `this._fxLayer` 或停止 `_floatTweens`！
   */
  relayout(result?: ExtractResult): void {
    const data = result ?? this._data ?? RunManager.run?.extract;
    this._stopItemPops();
    destroyDisplayChildren(this._root);
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) return;
    this._data = data;

    if (this._viewMode === 'pick' && this._hasPendingPick(data)) {
      this._drawPick(data);
      return;
    }
    this._viewMode = 'summary';
    this._drawSummary(data);
  }

  private _groupLoot(items: ExtractedItem[]): GroupedLoot[] {
    const map = new Map<string, GroupedLoot>();
    for (const it of items) {
      const rotten = it.quality === 'rotten';
      const rarity = itemRarity(it.defId);
      const tier: RarityTier = rotten ? 'common' : resolveRarityTier(rarity, it.quality);
      const key = `${it.defId}|${rotten ? 'rotten' : tier}`;
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
          tier,
          rotten,
          qty: 1,
          totalSell: Math.max(0, it.sell),
        });
      }
    }
    return [...map.values()].sort((a, b) => (
      (Number(a.rotten) - Number(b.rotten))
      || (tierSortScore(b.tier) - tierSortScore(a.tier))
      || (b.totalSell - a.totalSell)
    ));
  }

  // ── 柔和深暖暗场丰收陈列台（无假黄光 · 大比例原画直呈 · 贴边剪影发光描边） ─────────
  private _drawSummary(data: ExtractResult): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    const W = SUMMARY_W;
    const shouldAnimate = Date.now() - this._openedAt <= 120;
    const hasPendingPick = this._hasPendingPick(data);

    const groups = this._groupLoot(data.items);
    const totalSell = groups.reduce((s, g) => s + g.totalSell, 0);

    const tierCounts: Record<RarityTier, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      god: 0,
    };
    for (const g of groups) {
      if (g.rotten) continue;
      tierCounts[g.tier] += g.qty;
    }

    const goodEntries: Array<{ tier: RarityTier; text: string }> = [];
    if (tierCounts.god > 0) goodEntries.push({ tier: 'god', text: `极鲜×${tierCounts.god}` });
    if (tierCounts.legendary > 0) goodEntries.push({ tier: 'legendary', text: `珍品×${tierCounts.legendary}` });
    if (tierCounts.epic > 0) goodEntries.push({ tier: 'epic', text: `上品×${tierCounts.epic}` });
    if (tierCounts.rare > 0) goodEntries.push({ tier: 'rare', text: `良品×${tierCounts.rare}` });

    // 1. 柔和深暖暗角遮罩（不加任何放射星芒与大圆光团）
    this._root.addChild(makeWarmVignetteBackdrop(sw, sh));

    // 计算舞台内容总高与等比适配缩放
    const spec = resolveGridSpec(groups.length);
    const totalRows = Math.max(1, Math.ceil(groups.length / spec.cols));
    const gridContentH = groups.length > 0 ? totalRows * spec.cellH : 244;
    const gridViewH = groups.length > 0
      ? Math.min(gridContentH, spec.maxVisibleRows * spec.cellH)
      : 244;
    const hasScroll = groups.length > spec.cols * spec.maxVisibleRows;

    const bannerH = 152;
    const subtitleCy = bannerH + 24;
    const topDividerY = subtitleCy + 28;
    const gridTop = topDividerY + 22;
    let cursorY = gridTop + gridViewH + 14;

    let scrollHintCy = 0;
    if (hasScroll) {
      scrollHintCy = cursorY + 12;
      cursorY += 32;
    }

    const botDividerY = cursorY + 6;
    cursorY = botDividerY + 22;

    let goodRowCy = 0;
    if (goodEntries.length > 0) {
      goodRowCy = cursorY + 16;
      cursorY += 42;
    } else {
      cursorY += 6;
    }

    const btnY = cursorY + 4;
    const btnW = 408;
    const btnH = 70;
    const tapHintCy = btnY + btnH + 26;
    const stageH = tapHintCy + 18;

    const safeTop = Math.max(36, Game.safeTop);
    const safeBot = Math.max(20, Game.safeBottom + 16);
    const availW = sw - 12;
    const availH = Math.max(580, sh - safeTop - safeBot);
    const scale = Math.min(1, availW / W, availH / stageH);
    const sx = Math.round((sw - W * scale) / 2);
    const sy = Math.round(safeTop + Math.max(0, (availH - stageH * scale) * 0.44));
    const toStage = (x: number, y: number) => ({ x: sx + x * scale, y: sy + y * scale });

    // 舞台主容器（eventMode 保持 passive，使空白处点击自然冒泡至 ResultPanel）
    const scene = new PIXI.Container();
    scene.eventMode = 'passive';
    scene.scale.set(scale);
    scene.position.set(sx, sy);
    this._root.addChild(scene);

    // 2. 顶部大尺寸庆贺横幅（约 468px 宽）+ 描边副标 + 暖金手绘分割细线
    const bannerWrap = new PIXI.Container();
    bannerWrap.eventMode = 'none';
    bannerWrap.position.set(W / 2, Math.round(bannerH * 0.5));
    scene.addChild(bannerWrap);

    const titlePath = data.kind === 'safe' ? ART.titleSafe : ART.titleMessy;
    const titleFallback = makeText(
      'display',
      data.kind === 'safe' ? '挑完回家' : '天黑收摊了',
      0xFFE8A6,
      { size: 50, stroke: DARK_STROKE, strokeWidth: 8 },
    );
    titleFallback.anchor.set(0.5);
    bannerWrap.addChild(titleFallback);

    const titleSp = new PIXI.Sprite(gameTexture(titlePath));
    titleSp.anchor.set(0.5);
    titleSp.eventMode = 'none';
    bannerWrap.addChild(titleSp);

    const syncTitle = (): void => {
      if (titleSp.destroyed || titleFallback.destroyed) return;
      const tex = gameTexture(titlePath);
      if (!isTextureReady(tex)) {
        titleSp.visible = false;
        titleFallback.visible = true;
        return;
      }
      titleSp.texture = tex;
      fitSpriteInBox(titleSp, 468, bannerH);
      titleSp.visible = true;
      titleFallback.visible = false;
    };
    syncTitle();
    whenTextureReady(titlePath, syncTitle);
    if (shouldAnimate) this._popItem(bannerWrap, 0);

    const subRow = this._buildSummarySubtitle(data.items.length, totalSell, data.lost, W);
    subRow.position.set(W / 2, subtitleCy);
    scene.addChild(subRow);

    drawWarmGoldDivider(scene, W / 2, topDividerY, 568);

    // 3. 宽阔大比例无盘战利品网格（GRID_W = 684）
    const contentL = Math.round((W - GRID_W) / 2);
    if (groups.length === 0) {
      this._scroller.clear();
      const emptyWrap = new PIXI.Container();
      emptyWrap.eventMode = 'none';

      const bskSp = new PIXI.Sprite(gameTexture(ART.basket));
      bskSp.anchor.set(0.5);
      bskSp.position.set(W / 2, gridTop + 94);
      bskSp.eventMode = 'none';
      const syncBsk = (): void => {
        if (bskSp.destroyed) return;
        const tex = gameTexture(ART.basket);
        if (!isTextureReady(tex)) {
          bskSp.visible = false;
          return;
        }
        bskSp.texture = tex;
        fitSpriteInBox(bskSp, 224, 156);
        bskSp.visible = true;
      };
      syncBsk();
      whenTextureReady(ART.basket, syncBsk);
      emptyWrap.addChild(bskSp);

      const emptyTxt = makeText(
        'heading',
        '两手空空归家，歇口气再去逛！',
        0xF2E2CE,
        { size: 27, stroke: DARK_STROKE, strokeWidth: 5 },
      );
      emptyTxt.anchor.set(0.5);
      emptyTxt.position.set(W / 2, gridTop + 196);
      emptyWrap.addChild(emptyTxt);
      scene.addChild(emptyWrap);
    } else {
      const colW = Math.floor(GRID_W / spec.cols);
      const viewport = new PIXI.Container();
      viewport.eventMode = 'none';
      const content = new PIXI.Container();
      content.eventMode = 'none';
      viewport.addChild(content);
      scene.addChild(viewport);

      groups.forEach((g, idx) => {
        const col = idx % spec.cols;
        const row = Math.floor(idx / spec.cols);
        const cx = contentL + col * colW + colW / 2;
        const cellTop = row * spec.cellH;
        const iconCy = Math.round(spec.cellH * 0.43);

        const cellNode = this._buildLootCell(g, spec, colW);
        cellNode.position.set(cx, cellTop + iconCy);
        content.addChild(cellNode);

        if (shouldAnimate) {
          this._popItem(cellNode, Math.min(0.44, 0.04 + idx * 0.035));
        }
      });

      content.position.set(0, gridTop);
      const maxScroll = Math.max(0, gridContentH - gridViewH);
      if (maxScroll > 0) {
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawRect(contentL - 28, gridTop - 12, GRID_W + 56, gridViewH + 20);
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
          w: GRID_W * scale,
          h: gridViewH * scale,
        },
      });
    }

    if (hasScroll) {
      const scrollHint = makeText(
        'caption',
        `↕ 上下滑动查看全部 ${groups.length} 种收获`,
        0xE5CFAF,
        { size: 22, fontWeight: '600', stroke: DARK_STROKE, strokeWidth: 4 },
      );
      scrollHint.anchor.set(0.5);
      scrollHint.position.set(W / 2, scrollHintCy);
      scene.addChild(scrollHint);
    }

    // 4. 底部收尾区：暖金分割细线 + 品阶亮点词条 + 大号主按钮 + 轻触提示
    drawWarmGoldDivider(scene, W / 2, botDividerY, 568);

    if (goodEntries.length > 0) {
      const hiRow = this._buildGoodHighlightRow(goodEntries, W - 40);
      hiRow.position.set(W / 2, goodRowCy);
      scene.addChild(hiRow);
    }

    const btnLabel = hasPendingPick
      ? '冰箱满啦 · 去腾格子'
      : groups.length > 0
        ? '收进冰箱'
        : '回厨房歇息';
    const btnSkin = hasPendingPick ? 'gold' : 'olive';
    const homeBtn = makeSlicedButton({
      label: btnLabel,
      width: btnW,
      height: btnH,
      skin: btnSkin,
      fontSize: 30,
      silent: hasPendingPick,
      onReady: this._scheduleRelayout,
    });
    homeBtn.position.set(Math.round((W - btnW) / 2), btnY);
    homeBtn.on('pointertap', (e) => {
      e.stopPropagation();
      this._advanceFromSummary();
    });
    scene.addChild(homeBtn);

    const tapHint = makeText(
      'caption',
      '轻触任意空白处即可继续',
      0xC9B49B,
      { size: 22, fontWeight: '600', stroke: 0x160C06, strokeWidth: 4 },
    );
    tapHint.anchor.set(0.5);
    tapHint.alpha = 0.88;
    tapHint.position.set(W / 2, tapHintCy);
    scene.addChild(tapHint);
  }

  private _buildSummarySubtitle(
    totalItems: number,
    totalSell: number,
    lost: number,
    stageW: number,
  ): PIXI.Container {
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';

    const row = new PIXI.Container();
    row.eventMode = 'none';
    wrap.addChild(row);

    const strokeOpts = { stroke: DARK_STROKE, strokeWidth: 5 };
    let x = 0;

    const leftTxt = makeText(
      'body',
      `共收获 ${totalItems} 件鲜货 · 估值 `,
      0xF8ECDC,
      { size: 26, fontWeight: '700', ...strokeOpts },
    );
    leftTxt.anchor.set(0, 0.5);
    leftTxt.position.set(x, 0);
    row.addChild(leftTxt);
    x += leftTxt.width + 2;

    const coinBox = 30;
    const coinSlot = new PIXI.Container();
    coinSlot.position.set(x + coinBox / 2, 0);
    row.addChild(coinSlot);

    const coinEmoji = makeText('body', '🪙', 0xFFD86B, { size: 24, ...strokeOpts });
    coinEmoji.anchor.set(0.5);
    coinSlot.addChild(coinEmoji);

    const coinSp = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
    coinSp.anchor.set(0.5);
    coinSp.eventMode = 'none';
    coinSlot.addChild(coinSp);

    const syncCoin = (): void => {
      if (coinSp.destroyed || coinEmoji.destroyed) return;
      const tex = gameTexture(HUD_ICON.coin);
      if (!isTextureReady(tex)) {
        coinSp.visible = false;
        coinEmoji.visible = true;
        return;
      }
      coinSp.texture = tex;
      fitSpriteInBox(coinSp, coinBox, coinBox);
      coinSp.visible = true;
      coinEmoji.visible = false;
    };
    syncCoin();
    whenTextureReady(HUD_ICON.coin, syncCoin);
    x += coinBox + 5;

    const sellTxt = makeText(
      'number',
      String(Math.max(0, totalSell)),
      0xFFD86B,
      { size: 28, fontWeight: '700', ...strokeOpts },
    );
    sellTxt.anchor.set(0, 0.5);
    sellTxt.position.set(x, 0);
    row.addChild(sellTxt);
    x += sellTxt.width;

    if (lost > 0) {
      const lostTxt = makeText(
        'body',
        ` · 天黑颠落 ${lost} 件`,
        0xFF7B6B,
        { size: 26, fontWeight: '700', ...strokeOpts },
      );
      lostTxt.anchor.set(0, 0.5);
      lostTxt.position.set(x + 2, 0);
      row.addChild(lostTxt);
      x += 2 + lostTxt.width;
    }

    row.position.set(-Math.round(x / 2), 0);
    const maxW = stageW - 32;
    if (x > maxW && maxW > 0) {
      wrap.scale.set(maxW / x);
    }
    return wrap;
  }

  private _buildGoodHighlightRow(
    entries: Array<{ tier: RarityTier; text: string }>,
    maxW: number,
  ): PIXI.Container {
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';

    const row = new PIXI.Container();
    row.eventMode = 'none';
    wrap.addChild(row);

    const strokeOpts = { stroke: DARK_STROKE, strokeWidth: 5 };
    let x = 0;

    const pre = makeText('body', '✦ 本趟觅得好货：', 0xFFE39E, {
      size: 24,
      fontWeight: '700',
      ...strokeOpts,
    });
    pre.anchor.set(0, 0.5);
    pre.position.set(x, 0);
    row.addChild(pre);
    x += pre.width;

    entries.forEach((entry, idx) => {
      if (idx > 0) {
        const sep = makeText('body', ' · ', 0xCBB79E, {
          size: 22,
          fontWeight: '700',
          ...strokeOpts,
        });
        sep.anchor.set(0, 0.5);
        sep.position.set(x, 0);
        row.addChild(sep);
        x += sep.width;
      }
      const part = makeText('body', entry.text, tierFloatColor(entry.tier), {
        size: 25,
        fontWeight: '700',
        ...strokeOpts,
      });
      part.anchor.set(0, 0.5);
      part.position.set(x, 0);
      row.addChild(part);
      x += part.width;
    });

    row.position.set(-Math.round(x / 2), 0);
    if (x > maxW && maxW > 0) {
      wrap.scale.set(maxW / x);
    }
    return wrap;
  }

  /**
   * 单个战利品无盘展示单元（原点在食材中心）：
   * 柔和暗色地面落影 + 原画直呈 + 沿食材剪影边缘勾勒发光外轮廓 + 左上品质徽记 + 右下数量 + 下方品阶亮色菜名。
   */
  private _buildLootCell(g: GroupedLoot, spec: GridSpec, colW: number): PIXI.Container {
    const cell = new PIXI.Container();
    cell.eventMode = 'none';

    const { iconSize, cols } = spec;
    const footY = Math.round(iconSize * 0.40);

    // 1. 柔和暗色地面投影椭圆，让食材稳稳落在台面上
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x070402, 0.46);
    shadow.drawEllipse(0, footY + 4, Math.round(iconSize * 0.40), Math.round(iconSize * 0.115));
    shadow.endFill();
    shadow.eventMode = 'none';
    cell.addChild(shadow);

    // 2. 高清食材原图（whenTextureReady 就地绑定尺寸，避免整页重绘）
    const look = g.rotten ? 'rotten' as const : 'clean' as const;
    const sp = new PIXI.Sprite(itemLookTexture(g.defId, look));
    sp.anchor.set(0.5);
    sp.position.set(0, -3);
    sp.eventMode = 'none';
    cell.addChild(sp);

    // 3. 沿着菜叶/豆腐/番茄自身边缘勾勒精致双层发光外轮廓（绝不画圆形大光斑）
    if (!g.rotten) {
      attachSpriteContour(cell, sp, g.tier, {
        onDark: true,
        selected: g.tier !== 'common',
        thicknessScale: 1.1,
      });
    }

    const cleanPath = resolveItemAssetPath(g.defId, false);
    const rottenPath = resolveItemAssetPath(g.defId, true);
    const syncIcon = (): void => {
      if (sp.destroyed) return;
      const tex = itemLookTexture(g.defId, look);
      if (!isTextureReady(tex)) {
        sp.visible = false;
        return;
      }
      sp.texture = tex;
      fitSpriteInBox(sp, iconSize, iconSize);
      if (g.rotten && tex === itemLookTexture(g.defId, 'clean')) {
        sp.tint = 0xB8AD9B;
      } else {
        sp.tint = 0xFFFFFF;
      }
      sp.visible = true;
    };
    syncIcon();
    whenTextureReady(cleanPath, syncIcon);
    if (g.rotten && rottenPath !== cleanPath) {
      whenTextureReady(rottenPath, syncIcon);
    }

    // 4. 左上角：仅对高阶品质显示精致朱印/徽记（蔫菜显示灰印），外移避开食材主体
    const sealSize = iconSize >= 132 ? 40 : (cols <= 3 ? 36 : 32);
    const sealX = -Math.round(iconSize * 0.45) - 4;
    const sealY = -Math.round(iconSize * 0.37);
    if (g.rotten) {
      const rotSeal = makeRottenSeal(sealSize, -0.08);
      rotSeal.position.set(sealX, sealY);
      cell.addChild(rotSeal);
    } else if (g.tier !== 'common') {
      const rSeal = makeRaritySeal(g.tier, sealSize, -0.08);
      rSeal.position.set(sealX, sealY);
      cell.addChild(rSeal);
    }

    // 5. 右下角：g.qty > 1 时显示醒目大号描边数量
    if (g.qty > 1) {
      const qtySize = iconSize >= 132 ? 28 : (cols <= 3 ? 26 : 24);
      const qtyLbl = makeText('number', `×${g.qty}`, 0xFFF8EC, {
        size: qtySize,
        fontWeight: '700',
        stroke: DARK_STROKE,
        strokeWidth: 6,
      });
      qtyLbl.anchor.set(1, 1);
      qtyLbl.position.set(Math.round(iconSize * 0.49) + 6, Math.round(iconSize * 0.45));
      cell.addChild(qtyLbl);
    }

    // 6. 图标正下方：食材名称（普通象牙白，高阶直取品质亮色 + 深褐描边）
    const nameSize = iconSize >= 132 ? 26 : (cols <= 3 ? 24 : 22);
    const nameColor = g.rotten
      ? ROTTEN_FLOAT
      : g.tier === 'common'
        ? 0xFFF6E8
        : tierFloatColor(g.tier);
    const nameLbl = makeText('body', g.name, nameColor, {
      size: nameSize,
      fontWeight: '700',
      stroke: DARK_STROKE,
      strokeWidth: 5,
    });
    nameLbl.anchor.set(0.5, 0);
    nameLbl.position.set(0, Math.round(iconSize * 0.46) + 3);
    fitTextWidth(nameLbl, colW - 10);
    cell.addChild(nameLbl);

    return cell;
  }

  // ── 极具获得感的「跟随品质颜色」获得物品飘字瀑布流（独立挂在 _fxLayer，无光团遮挡） ──
  private _formatLootFloatSpec(row: GroupedLoot): { text: string; color: number; size: number } {
    if (row.rotten) {
      return {
        text: `蔫了 · ${row.name} ×${row.qty}`,
        color: ROTTEN_FLOAT,
        size: 32,
      };
    }
    switch (row.tier) {
      case 'god':
        return {
          text: `✦ 极鲜 · ${row.name} ×${row.qty}`,
          color: 0xFFD454,
          size: 42,
        };
      case 'legendary':
        return {
          text: `✦ 珍品 · ${row.name} ×${row.qty}`,
          color: LEGENDARY_FLOAT,
          size: 40,
        };
      case 'epic':
        return {
          text: `+ 上品 · ${row.name} ×${row.qty}`,
          color: 0x66C0FF,
          size: 38,
        };
      case 'rare':
        return {
          text: `+ 良品 · ${row.name} ×${row.qty}`,
          color: 0x6EE86A,
          size: 36,
        };
      case 'common':
      default:
        return {
          text: `+ ${row.name} ×${row.qty}`,
          color: 0xFFF8EC,
          size: 34,
        };
    }
  }

  private _playLootFloats(rows: GroupedLoot[]): void {
    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    const step = 0.30;
    const firstDelay = 0.14;
    const startY = Math.round(sh * FLOAT_START_Y_RATIO);

    rows.slice(0, 12).forEach((row, i) => {
      const spec = this._formatLootFloatSpec(row);
      const wrap = new PIXI.Container();
      wrap.eventMode = 'none';

      const lab = makeText('title', spec.text, spec.color, {
        size: spec.size,
        fontWeight: '700',
        stroke: DARK_STROKE,
        strokeWidth: 7,
        dropShadow: true,
        dropShadowColor: '#120904',
        dropShadowAlpha: 0.65,
        dropShadowDistance: 2,
        dropShadowAngle: Math.PI / 2,
        dropShadowBlur: 2,
      });
      lab.anchor.set(0.5);
      const maxTextW = sw - 104;
      if (lab.width > maxTextW && maxTextW > 0) {
        lab.scale.set(maxTextW / lab.width);
      }
      wrap.addChild(lab);

      const xOffset = FLOAT_X_OFFSETS[i % FLOAT_X_OFFSETS.length];
      const startX = Math.round(sw / 2 + xOffset);

      wrap.position.set(startX, startY);
      wrap.alpha = 0;
      wrap.scale.set(0.65);
      this._fxLayer.addChild(wrap);
      this._floatNodes.add(wrap);

      const delay = firstDelay + i * step;

      // 弹入缩放：0.65 -> 1.08 -> 1.0
      const tScaleUp = TweenManager.to({
        target: wrap.scale,
        props: { x: 1.08, y: 1.08 },
        duration: 0.18,
        delay,
        ease: Ease.easeOutBack,
        onComplete: () => {
          if (wrap.destroyed) return;
          const tScaleSettle = TweenManager.to({
            target: wrap.scale,
            props: { x: 1, y: 1 },
            duration: 0.12,
            ease: Ease.easeInOutQuad,
          });
          this._floatTweens.push(tScaleSettle);
        },
      });

      // 匀速向上漂移 230px（总时长 1.15s，相邻两条恒定拉开 60px 阶梯间距绝不撞车）
      const tDrift = TweenManager.to({
        target: wrap,
        props: { y: startY - 230 },
        duration: 1.15,
        delay,
        ease: Ease.linear,
      });

      // 渐显后保持清晰再柔和消散（总时长 0.12 + 0.71 + 0.32 = 1.15s）
      const tFadeIn = TweenManager.to({
        target: wrap,
        props: { alpha: 1 },
        duration: 0.12,
        delay,
        ease: Ease.easeOutQuad,
        onComplete: () => {
          if (wrap.destroyed) return;
          const tFadeOut = TweenManager.to({
            target: wrap,
            props: { alpha: 0 },
            duration: 0.32,
            delay: 0.71,
            ease: Ease.easeInQuad,
            onComplete: () => {
              this._floatNodes.delete(wrap);
              if (!wrap.destroyed) {
                destroyDisplayNode(wrap);
              }
            },
          });
          this._floatTweens.push(tFadeOut);
        },
      });

      this._floatTweens.push(tScaleUp, tDrift, tFadeIn);
    });
  }

  private _clearFloats(): void {
    for (const tw of this._floatTweens) {
      TweenManager.cancel(tw);
    }
    this._floatTweens = [];
    for (const node of this._floatNodes) {
      TweenManager.cancelTarget(node);
    }
    this._floatNodes.clear();
    destroyDisplayChildren(this._fxLayer);
  }

  private _popItem(target: PIXI.Container, delay: number): void {
    this._itemPops.push(target);
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

  private _stopItemPops(): void {
    for (const node of this._itemPops) {
      TweenManager.cancelTarget(node);
    }
    this._itemPops = [];
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

  // ── 满柜腾格子：木墙 + 宣纸清点单 + 大格勾选变现 ───────────────────────────
  private _drawPick(data: ExtractResult): void {
    const W = PICK_W;
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
    const gridViewH = Math.min(gridContentH, cell * 4 + 2);

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
            analytics.trackUnpackSettle({
              mode: 'ad_vip',
              soldCount: res.soldCount,
              keptCount: res.kept,
              goldGained: res.gained,
            });
            if (res.gained > 0) AudioManager.play('coin_gain');
            this._data = this._data ? { ...this._data, needsPick: false } : null;
            Platform.showToast(
              `街坊 1.5 倍包圆 ${res.soldCount} 格余菜，入账 ${res.gained} 金！`,
              'success',
            );
            this._finalizeExitToKitchen(false);
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
    const isDish = fridgeKind(it) === 'dish';
    const rotten = !isDish && it.quality === 'rotten';
    const baseRarity = fridgeSlotRarity(it);
    const tier: RarityTier = rotten ? 'common' : resolveRarityTier(baseRarity, it.quality);
    const style = rarityStyleOf(tier);

    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    drawItemSlotBox(bg, x, y, size, size, {
      radius: 12,
      rarity: rotten ? 'common' : baseRarity,
      dimmed: on || rotten,
      selected: false,
      medallion: tier === 'common',
    });
    if (!on && !rotten) {
      if (tier !== 'common') {
        bg.lineStyle(0);
        bg.beginFill(style.cell, 0.16);
        bg.drawRoundedRect(x + 2, y + 2, size - 4, size - 6, 10);
        bg.endFill();
      }
      drawRarityFrame(bg, x + 1, y + 1, size - 2, size - 2, tier, {
        radius: 11,
        thick: tier !== 'common',
      });
      if (overflow && tier === 'common') {
        bg.lineStyle(2.2, 0xD4683A, 0.85);
        bg.drawRoundedRect(x + 1, y + 1, size - 2, size - 2, 11);
      }
    }
    root.addChild(bg);

    let iconSp: PIXI.Sprite | null = null;
    if (isDish) {
      const tex = dishTexture(it.defId);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 16, size - 16);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2 - 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.36;
        root.addChild(icon);
        iconSp = icon;
      }
    } else {
      const look = rotten ? 'rotten' as const : 'clean' as const;
      const tex = itemLookTexture(it.defId, look);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 16, size - 16);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2 - 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.36;
        root.addChild(icon);
        iconSp = icon;
      }
    }

    if (iconSp && !on && !rotten && tier !== 'common') {
      attachSpriteContour(root, iconSp, tier, {
        selected: false,
        thicknessScale: 0.92,
      });
    }

    if (!on && !rotten && tier !== 'common') {
      const tBadge = makeText('caption', rarityTierLabel(tier), style.ink, {
        size: 17,
        fontWeight: '700',
        stroke: 0xFFFDF8,
        strokeWidth: 4,
      });
      tBadge.anchor.set(1, 0);
      tBadge.position.set(x + size - 5, y + 4);
      root.addChild(tBadge);
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
    const soldCount = this._sell.size;
    const { error, gained, kept } = KitchenManager.commitUnpack([...this._sell]);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    analytics.trackUnpackSettle({
      mode: 'manual_sell',
      soldCount,
      keptCount: kept,
      goldGained: gained,
    });
    if (gained > 0) AudioManager.play('coin_gain');
    this._data = this._data ? { ...this._data, needsPick: false } : null;
    Platform.showToast(gained > 0 ? `卖掉余菜收入 ${gained} 金，${kept} 格入冰箱` : `${kept} 格收入冰箱`, 'success');
    this._finalizeExitToKitchen(true);
  }
}
