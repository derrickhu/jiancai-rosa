import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { RunManager } from '@/managers/RunManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { BasketPanel } from '@/gameobjects/ui/BasketPanel';
import { ResultPanel } from '@/gameobjects/ui/ResultPanel';
import { EventPanel } from '@/gameobjects/ui/EventPanel';
import { ensureRecipeUnlockPanel } from '@/gameobjects/ui/RecipeUnlockPanel';
import {
  GOD_PICK,
  MARKET_ART,
  buffIconPath,
  cardName,
  diagnoseCannotPlace,
  displayName,
  getItem,
  isBasketFull,
  isRummageNode,
  liveHudBuffs,
  marketWeatherById,
  nodeEncounter,
  pileToBasketDraft,
  rarityStyleOf,
  rarityTierLabel,
  resolveRarityTier,
  sceneBg,
  stallPileArt,
  stallRummageArt,
  tryAutoPackBasket,
  urgentTaskFoodIds,
  visibleDefId,
  type ExtractResult,
  type PileItem,
  type Quality,
  type RarityTier,
  type RunEventLog,
  type StallId,
} from '@/sim';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import { makeRaritySeal } from '@/gameobjects/ui/scenePanel';
import { DuskExtendPanel } from '@/gameobjects/ui/DuskExtendPanel';
import { SteelyardPanel, type SteelyardEnterResult } from '@/gameobjects/ui/SteelyardPanel';
import { MysterySackPanel } from '@/gameobjects/ui/MysterySackPanel';
import { layoutRouteMap, type RouteCell, type RouteMapView } from '@/gameobjects/market/MapView';
import { AudioManager } from '@/core/AudioManager';
import {
  FONT,
  HUD_ICON,
  UI_PALETTE,
  attachSpriteContour,
  bindUiClick,
  fillRect,
  fitTextWidth,
  makeHandProgressBar,
  makeLabel,
  makeNewFoodTag,
  makeSlicedButton,
  makeText,
  makeUrgentFoodTag,
  uiBarPaths,
} from '@/utils/ui';
import { Platform } from '@/core/PlatformService';
import { Ease, TweenManager } from '@/core/TweenManager';
import {
  applyFit,
  fitCover,
  fitSpriteInBox,
  fitWidthBottom,
  gameTexture,
  isTextureFailed,
  isTextureReady,
  itemLookTexture,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import type { Scene } from '@/core/SceneManager';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay, stageRectOf, type TutorialTarget } from '@/gameobjects/ui/TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';
import { destroyDisplayChildren, destroyDisplayNode, isStageMounted } from '@/utils/destroy';

const REVEAL_FACE = 188;
const REVEAL_POP = 0.14;
const REVEAL_FLY = 0.26;
const REVEAL_LAND = 0.08;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const GOD_FISH = 'subpkg_images/wild_yellowfish.png';

const MARKET_SCENE_ART = {
  plaque: 'subpkg_images/scene_pk_plaque.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  seal: 'subpkg_images/scene_pk_seal.png',
} as const;

const INK = 0x2A2018;
const RED_INK = 0xB8361F;
const CREAM = 0xFFF8EC;

export class MarketScene implements Scene {
  readonly name = 'market';
  readonly container = new PIXI.Container();
  private _bg = new PIXI.Container();
  private _hud = new PIXI.Container();
  private _dusk = new PIXI.Container();
  private _res = new PIXI.Container();
  private _body = new PIXI.Container();
  private _basket = new BasketPanel();
  private _result = new ResultPanel();
  private _duskExtend = new DuskExtendPanel();
  private _steelyard = new SteelyardPanel();
  private _mysterySack = new MysterySackPanel();
  private _duskWaitTimer = 0;
  private _onRun = () => this._sync();
  private _onDuskPrompt = () => this._checkDuskPrompt();
  private _onExtract = (result: ExtractResult) => {
    this._clearDuskWait();
    this._duskExtend.close(true);
    this._steelyard.close(true);
    this._mysterySack.close(true);
    this._basket.close(true);
    this._result.open(result);
    TutorialManager.advanceTo(TutorialStep.WAIT_RESULT);
    TutorialOverlay.refresh();
  };
  private _bodyKey = '';
  private _duskNum: PIXI.Text | null = null;
  private _duskSteps = -1;
  private _duskUrgent = false;
  private _basketBtn: PIXI.Container | null = null;
  private _revealLayer = new PIXI.Container();
  private _godLayer = new PIXI.Container();
  private _godPlaying = false;
  private _flying = new Map<string, { playing: boolean; wrap: PIXI.Container | null; token: PIXI.Container | null }>();
  private _pileKick = 0;
  private _stackPos = { x: 375, y: 800 };
  private _event = new EventPanel();
  private _mapView: RouteMapView | null = null;
  /** 走路过渡期间不许重建 body，不然卡片会被抽走 */
  private _walking = false;
  private _walkTimer = { t: 0 };
  /** 已经弹过对话的节点，防止 relayout 反复弹 */
  private _shownEvent = '';
  /** 按路线节点记初始堆量，同类摊的两张卡各算各的。 */
  private _crateMax: Record<string, number> = {};
  /** 桌上已摆过的菜钉住坐标，后抽的只往空位放，不把先抽的挤走。 */
  private _tablePins = new Map<string, Map<string, { rx: number; ry: number; w: number; h: number }>>();
  private _tutCard: PIXI.Container | null = null;
  private _tutPile: PIXI.Container | null = null;
  private _tutToken: PIXI.Container | null = null;
  private _leaveBtn: PIXI.Container | null = null;
  private _backBtn: PIXI.Container | null = null;
  private _urgentFoods = new Set<string>();
  private _coinHud = { x: 120, y: 220 };
  private _syncQueued = false;
  private _hudQueued = false;
  private _duskClearQueued = false;
  private _watchedSync = new Set<string>();
  private _watchedHud = new Set<string>();

  private _scheduleSync = (): void => {
    if (this._syncQueued || !this.container.parent) return;
    this._syncQueued = true;
    const defer = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    defer(() => {
      this._syncQueued = false;
      if (this.container.parent && !this._walking) this._sync(true);
    });
  };

  private _scheduleHud = (): void => {
    if (this._hudQueued || !this.container.parent) return;
    this._hudQueued = true;
    const defer = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    defer(() => {
      this._hudQueued = false;
      if (!this.container.parent) return;
      if (this._duskClearQueued) {
        this._duskClearQueued = false;
        this._clearDusk();
      }
      this._drawHud();
    });
  };

  private _watchSyncOnce(path: string): void {
    if (!path) return;
    const tex = gameTexture(path);
    if (isTextureReady(tex)) return;
    if (this._watchedSync.has(path)) return;
    this._watchedSync.add(path);
    whenTextureReady(path, () => {
      this._watchedSync.delete(path);
      this._scheduleSync();
    });
  }

  private _watchHudOnce(path: string, clearDusk = false): void {
    if (!path) return;
    const tex = gameTexture(path);
    if (isTextureReady(tex)) return;
    const key = clearDusk ? `dusk:${path}` : path;
    if (this._watchedHud.has(key)) return;
    this._watchedHud.add(key);
    whenTextureReady(path, () => {
      this._watchedHud.delete(key);
      if (clearDusk) this._duskClearQueued = true;
      this._scheduleHud();
    });
  }

  constructor() {
    this.container.addChild(this._bg);
    this.container.addChild(this._body);
    this.container.addChild(this._revealLayer);
    this._hud.addChild(this._dusk, this._res);
    this.container.addChild(this._hud);
    this.container.addChild(this._godLayer);
    this.container.eventMode = 'static';
  }

  onEnter(): void {
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    EventBus.on(EV.runChanged, this._onRun);
    EventBus.on(EV.runExtracted, this._onExtract);
    EventBus.on(EV.runDuskPrompt, this._onDuskPrompt);
    this._bodyKey = '';
    this._crateMax = {};
    this._tablePins.clear();
    this._walking = false;
    this._body.alpha = 1;
    const pendingChoice = !!(
      RunManager.run?.lastEvent?.choices?.length
      && RunManager.run.lastEvent.nodeId === RunManager.run.atNodeId
    );
    this._shownEvent = pendingChoice ? '' : (RunManager.run?.lastEvent?.nodeId ?? '');
    AudioManager.playMarketBgm(RunManager.run?.marketId ?? 'xiangko');
    TutorialOverlay.register('market', () => this.tutorialRect());
    watchTextures([...Object.values(MARKET_SCENE_ART), ...uiBarPaths()], this._scheduleSync);
    this._sync(true);
    if (pendingChoice) this._afterStep();
    if (!TutorialManager.isActive) ensureRecipeUnlockPanel().present();
  }

  onExit(): void {
    EventBus.off(EV.runChanged, this._onRun);
    EventBus.off(EV.runExtracted, this._onExtract);
    EventBus.off(EV.runDuskPrompt, this._onDuskPrompt);
    this._syncQueued = false;
    this._hudQueued = false;
    this._duskClearQueued = false;
    this._clearDuskWait();
    this._walking = false;
    TweenManager.cancelTarget(this._walkTimer);
    TweenManager.cancelTarget(this._body);
    this._mapView = null;
    this._body.alpha = 1;
    this._tutCard = null;
    this._tutPile = null;
    this._tutToken = null;
    this._basketBtn = null;
    this._backBtn = null;
    this._leaveBtn = null;
    this._clearReveal();
    this._clearGodPick();
    this._tablePins.clear();
    this._clearDusk();
    destroyDisplayChildren(this._bg);
    destroyDisplayChildren(this._body);
    destroyDisplayChildren(this._res);
    this._duskExtend.close(true);
    this._steelyard.close(true);
    this._mysterySack.close(true);
    this._basket.close(true);
    this._event.close(true);
    TutorialOverlay.unregister('market');
  }

  relayout(): void {
    this._sync(true);
  }

  tutorialRect(): TutorialTarget | null {
    if (!TutorialManager.isActive) return null;
    const step = TutorialManager.currentStep;
    const map = RunManager.run?.mode === 'map';
    const stall = RunManager.run?.mode === 'rummage' || RunManager.run?.mode === 'play';
    const top = map ? this._hudFloor() + 8 : undefined;
    const speech = map ? 'top' as const : stall ? 'bottom' as const : undefined;

    if (step === TutorialStep.CLICK_CARD) return this._aim(this._tutCard, 6, { speech, speechY: top });
    if (step === TutorialStep.CLICK_PILE) return this._aim(this._tutPile, 8, { speech: 'bottom' });
    if (step === TutorialStep.TAKE_LOOT) {
      if (this._tutToken) {
        const firstPick = RunManager.basket.items.length === 0;
        const copy = firstPick
          ? { title: '好菜进篮', body: '点桌上的新鲜菜苔，自动收进菜篮。' }
          : { title: '收下水灵好货', body: '这棵水灵小白菜也是好货！点它收进菜篮。' };
        const aim = this._aim(this._tutToken, 8, { speech: 'bottom' });
        return aim ? { ...aim, ...copy } : { speech: 'bottom', ...copy };
      }
      if (RunManager.crateLeft().length > 0) {
        const hasRottenOnTable = RunManager.currentPile().some((it) => it.quality === 'rotten');
        const copy = hasRottenOnTable
          ? {
            title: '烂菜不捡 · 接着翻',
            body: '带 ✕ 的烂菜不能装（点它可随手拨走）。\n再点遮挡堆，把最后一件翻出来！',
          }
          : {
            title: '继续翻完这摊',
            body: '遮挡堆里还有剩货，继续点它翻出来！',
          };
        const aim = this._aim(this._tutPile, 8, { speech: 'bottom' });
        return aim ? { ...aim, ...copy } : { speech: 'bottom', ...copy };
      }
      return this._aim(this._basketBtn, 6, { speech: 'bottom' });
    }
    if (step === TutorialStep.OPEN_BASKET) return this._aim(this._basketBtn, 6, { speech: 'bottom', speechY: top });
    if (step === TutorialStep.RETURN_MAP) return this._aim(this._backBtn, 6, { speech: 'bottom' });
    if (step === TutorialStep.GO_HOME) return this._aim(this._leaveBtn, 6, { speech, speechY: top });
    if (step === TutorialStep.FREE_WALK) {
      if (
        this._basket._isOpen
        || this._event._isOpen
        || this._mysterySack._isOpen
        || this._steelyard._isOpen
        || this._duskExtend._isOpen
      ) {
        return null;
      }
      const visitedCount = RunManager.run?.visited.length ?? 0;
      if (stall) {
        const loot = this._aim(this._tutToken, 8, { dim: false, speech: 'bottom' });
        if (loot) {
          return {
            ...loot,
            title: '好菜进篮',
            body: '点桌上的好菜收进菜篮（带 ✕ 的烂菜可点走或不管）。',
          };
        }
        const hasCrate = RunManager.crateLeft().length > 0;
        const hasCleanPile = RunManager.currentPile().some((it) => it.quality !== 'rotten');
        if (hasCrate) {
          const pileAim = this._aim(this._tutPile, 8, { dim: false, speech: 'bottom' });
          const drawCopy = {
            title: '继续翻堆',
            body: '点摊上的遮挡堆，把藏着的菜翻到桌上。',
          };
          return pileAim ? { ...pileAim, ...drawCopy } : { dim: false, speech: 'bottom', ...drawCopy };
        }
        if (!hasCleanPile) {
          const targetBtn = visitedCount >= 2 ? this._leaveBtn : this._backBtn;
          const exitAim = this._aim(targetBtn, 6, { dim: false, speech: 'bottom' });
          const doneCopy = visitedCount >= 2
            ? {
              title: '这摊翻空啦',
              body: '菜够下锅了！点右上角「回家」开火，或回菜场再逛。',
            }
            : {
              title: '这摊翻空啦',
              body: '点左上角「返回菜场」继续往前走。',
            };
          return exitAim ? { ...exitAim, ...doneCopy } : { dim: false, speech: 'bottom', ...doneCopy };
        }
      }
      const caitaiCount = RunManager.basket.items.filter(
        (it) => it.defId === 'caitai' && it.quality !== 'rotten',
      ).length;
      if (caitaiCount < 1) {
        const cardAim = this._aim(this._tutCard, 6, { dim: false, speech: 'top', speechY: top });
        const needCopy = {
          title: '再捡一棵菜苔',
          body: '篮里还没菜苔！点脚下的路线卡再翻一棵，\n回家才能下锅炒菜苔。',
        };
        return cardAim ? { ...cardAim, ...needCopy } : { dim: false, speech: 'top', speechY: top, ...needCopy };
      }
      if (visitedCount < 2 && this._tutCard) {
        const cardAim = this._aim(this._tutCard, 6, { dim: false, speech: 'top', speechY: top });
        const moreCopy = {
          title: '再逛一步',
          body: '点脚下的路线卡再顺手逛一步，\n也能随时点右上角「回家」开火。',
        };
        return cardAim ? { ...cardAim, ...moreCopy } : { dim: false, speech: 'top', speechY: top, ...moreCopy };
      }
      const homeAim = this._aim(this._leaveBtn, 6, { dim: false, speech: 'top', speechY: top });
      const homeCopy = {
        title: '收获够下锅啦',
        body: '材料齐活！点右上角「回家」开火炒菜，\n想多捡点也能继续逛到天黑。',
      };
      return homeAim ? { ...homeAim, ...homeCopy } : { dim: false, speech: 'top', speechY: top, ...homeCopy };
    }
    return null;
  }

  private _aim(
    obj: PIXI.Container | null,
    pad: number,
    extra: Pick<TutorialTarget, 'speech' | 'speechY' | 'dim'> = {},
  ): TutorialTarget | null {
    const rect = stageRectOf(obj, pad);
    if (!rect) return extra.speech || extra.speechY != null || extra.dim === false
      ? { dim: extra.dim, speech: extra.speech, speechY: extra.speechY }
      : null;
    return {
      holes: [rect],
      fingerAt: { x: rect.x + rect.w * 0.5, y: rect.y + rect.h * 0.5 },
      speech: extra.speech,
      speechY: extra.speechY,
      dim: extra.dim,
    };
  }

  private _sync(force = false): void {
    if (this._walking) return;
    if (this._godPlaying) {
      this._drawHud();
      return;
    }
    const run = RunManager.run;
    this._urgentFoods = urgentTaskFoodIds(KitchenManager.save, RunManager.basket.items);
    this._drawHud();
    if (!run) {
      if (force || this._bodyKey !== 'empty') {
        this._bodyKey = 'empty';
        destroyDisplayChildren(this._body);
        destroyDisplayChildren(this._bg);
        const empty = makeLabel('本局已结束', 32, 0xC9B8A4);
        empty.position.set(32, Game.safeTop + 40);
        this._body.addChild(empty);
      }
      return;
    }
    const key = this._pileKey();
    if (force || key !== this._bodyKey) {
      const rummageKey = run.currentNodeId ? `rummage|${run.currentNodeId}|` : '';
      if (run.mode === 'rummage' && rummageKey && !this._bodyKey.startsWith(rummageKey)) {
        this._clearStalePops();
      }
      this._bodyKey = key;
      destroyDisplayChildren(this._body);
      this._mapView = null;
      if (run.mode === 'map') this._drawMap(Game.designWidth);
      else if (run.mode === 'play') this._drawPlay(Game.designWidth, Game.logicHeight);
      else this._drawRummage(Game.designWidth, Game.logicHeight);
    }
    if (run.pendingMysterySack && !this._walking && !this._mysterySack._isOpen) {
      this._mysterySack.open();
    }
    this._checkDuskPrompt();
    TutorialOverlay.refresh();
  }

  private _clearDuskWait(): void {
    if (this._duskWaitTimer) {
      globalThis.clearTimeout?.(this._duskWaitTimer);
      this._duskWaitTimer = 0;
    }
  }

  private _checkDuskPrompt(): void {
    const run = RunManager.run;
    if (!run || run.ended || !run.duskPromptPending) {
      this._clearDuskWait();
      if (this._duskExtend._isOpen) this._duskExtend.close(true);
      return;
    }
    if (
      this._walking
      || this._event._isOpen
      || this._steelyard._isOpen
      || this._mysterySack._isOpen
      || ensureRecipeUnlockPanel()._isOpen
    ) {
      if (!this._duskWaitTimer) {
        this._duskWaitTimer = globalThis.setTimeout(() => {
          this._duskWaitTimer = 0;
          this._checkDuskPrompt();
        }, 280) as unknown as number;
      }
      return;
    }
    this._clearDuskWait();
    this._basket.close(true);
    this._duskExtend.open();
  }

  private _pileKey(): string {
    const run = RunManager.run;
    if (!run) return 'empty';
    if (run.mode === 'rummage' && run.currentNodeId) {
      const pile = (run.piles[run.currentNodeId] ?? [])
        .map((it) => `${it.uid}:${it.drawn?1:0}${it.revealed?1:0}${it.inspected?1:0}${it.washed?1:0}`)
        .join(',');
      const urg = [...this._urgentFoods].sort().join(',');
      return `rummage|${run.currentNodeId}|${pile}|${urg}`;
    }
    if (run.mode === 'play' && run.play?.type === 'gather') {
      const spots = run.play.spots.map((s) => `${s.uid}:${s.taken ? 1 : 0}`).join(',');
      return `play|${run.play.nodeId}|${run.play.picksLeft}|${spots}`;
    }
    return `map|${run.sceneId}|${run.atNodeId ?? '-'}|${run.stepsLeft}|${run.options.join(',')}|${run.peeked.length}|${(run.steelyardDone ?? []).join(',')}|${run.weatherFreePaidLeft ? 1 : 0}|${run.note}`;
  }

  private _hudTop(): number {
    return Math.max(6, (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) - 4);
  }

  private _pillY(): number {
    return this._hudTop() + 132;
  }

  private _hudFloor(): number {
    const extra = liveHudBuffs(KitchenManager.save).length ? 48 : 0;
    return this._pillY() + 62 + extra;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 菜市场探索 HUD：天色剩余步数木匾 + 天时挂签 + 金币宣纸签 + 菜篮手绘容量进度牌 + 回家木章
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawHud(): void {
    destroyDisplayChildren(this._res);
    this._basketBtn = null;
    this._backBtn = null;
    const run = RunManager.run;
    const w = Game.designWidth;
    if (!run) {
      this._clearDusk();
      return;
    }

    this._syncDusk(run, w);
    const redraw = this._scheduleHud;

    const pillY = this._pillY();
    const coinW = 160;
    const bagW = 316;
    const gap = 14;
    const rowX = Math.round((w - coinW - gap - bagW) / 2);

    // 1. 金币宣纸签（25pt）
    const money = this._makeCoinHudSlip(coinW, `${KitchenManager.save.money}`);
    money.position.set(rowX, pillY + 3);
    this._coinHud = { x: rowX + 24, y: pillY + 27 };
    this._res.addChild(money);

    // 2. 菜篮容量手绘进度牌（点击即开菜篮，带实时占格进度条）
    this._basketBtn = this._makeBasketHudPlaque(bagW, redraw);
    this._basketBtn.position.set(rowX + coinW + gap, pillY);
    this._basketBtn.on('pointertap', () => {
      if (TutorialGuard.block('openBasket')) return;
      AudioManager.play('ui_click');
      this._basket.open();
      TutorialManager.advanceIf(TutorialStep.OPEN_BASKET);
    });
    this._res.addChild(this._basketBtn);

    // 3. 增益 Buff 挂章行
    const buffs = liveHudBuffs(KitchenManager.save);
    if (buffs.length) {
      const buffRow = new PIXI.Container();
      const bSize = 40;
      buffs.forEach((buff, i) => {
        const path = buffIconPath(buff.icon);
        this._watchHudOnce(path);
        const cell = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.lineStyle(2.2, INK, 0.95);
        bg.beginFill(0xFFF6E2, 0.98);
        bg.drawCircle(bSize / 2, bSize / 2, bSize / 2 - 1);
        bg.endFill();
        cell.addChild(bg);
        const bTex = gameTexture(path);
        if (isTextureReady(bTex)) {
          const sp = new PIXI.Sprite(bTex);
          fitSpriteInBox(sp, bSize - 8, bSize - 8);
          sp.anchor.set(0.5);
          sp.position.set(bSize / 2, bSize / 2);
          cell.addChild(sp);
        }
        cell.position.set(i * (bSize + 8), 0);
        cell.eventMode = 'static';
        cell.cursor = 'pointer';
        cell.hitArea = new PIXI.Rectangle(0, 0, bSize, bSize);
        cell.on('pointertap', (e) => {
          e.stopPropagation();
          AudioManager.play('ui_click');
          ensureHudBuffPanel().open();
        });
        buffRow.addChild(cell);
      });
      buffRow.position.set(rowX + 20, pillY + 60);
      this._res.addChild(buffRow);
    }

    // 4. 左上角：返回菜场木牌钮（摊位内）或 今日天时氛围挂牌（路线图内）
    const side = 96;
    const y = this._hudTop();
    const hintExit = run.mode === 'rummage'
      && !TutorialManager.usesMask()
      && !RunManager.crateLeft().length;
    const basketFull = isBasketFull(RunManager.basket);

    if (run.mode === 'rummage' || run.mode === 'play') {
      const duskOut = run.stepsLeft <= 0 && !TutorialManager.isActive;
      const back = this._roundIconBtn(
        HUD_ICON.back,
        duskOut ? '收摊回家' : '返回菜场',
        () => {
          if (TutorialGuard.block('leaveStall')) return;
          if (run.mode === 'play') RunManager.leavePlay();
          else RunManager.leaveStall();
          TutorialManager.advanceIf(TutorialStep.RETURN_MAP);
        },
        redraw,
        hintExit && !basketFull,
      );
      back.position.set(14, y);
      this._backBtn = back;
      this._res.addChild(back);
    } else if (run.weatherId && !TutorialManager.isActive) {
      const weather = marketWeatherById(run.weatherId);
      if (weather) {
        const wChip = new PIXI.Container();
        wChip.position.set(14, y + 8);
        const w1 = makeText('heading', weather.name, weather.pillInk, { size: 22 });
        const subLine = weather.freeFirstPaidStall && !run.weatherFreePaidLeft
          ? '首摊免单已享'
          : weather.shortDesc;
        const w2 = makeText('caption', subLine, 0x5A422D, { size: 20, fontWeight: '700' });
        const maxChipW = Math.round(w / 2 - 146);
        fitTextWidth(w1, maxChipW - 28);
        fitTextWidth(w2, maxChipW - 28);
        const cw = Math.min(maxChipW, Math.max(164, Math.ceil(Math.max(w1.width, w2.width)) + 28));
        const ch = 68;
        const cbg = new PIXI.Graphics();
        cbg.beginFill(0x160E08, 0.26);
        cbg.drawRoundedRect(0, 4, cw, ch, 12);
        cbg.endFill();
        cbg.lineStyle(2.4, weather.pillInk, 0.95);
        cbg.beginFill(weather.pillFill, 0.98);
        cbg.drawRoundedRect(0, 0, cw, ch, 12);
        cbg.endFill();
        // Brass tack at top-left
        cbg.lineStyle(1.2, INK, 0.85);
        cbg.beginFill(0xE8BE66, 1);
        cbg.drawCircle(11, 11, 3.5);
        cbg.endFill();
        w1.position.set(20, 8);
        w2.position.set(14, 38);
        wChip.addChild(cbg, w1, w2);
        wChip.eventMode = 'none';
        this._res.addChild(wChip);
      }
    }

    // 5. 右上角：回家木章钮
    const tutReadyHome = TutorialManager.isStep(TutorialStep.FREE_WALK)
      && (run.visited.length >= 2);
    const leave = this._roundIconBtn(HUD_ICON.leave, '回家', () => {
      if (TutorialGuard.block('extract')) return;
      RunManager.extract(true);
    }, redraw, (hintExit && basketFull) || tutReadyHome);
    leave.position.set(w - 14 - side, y);
    this._leaveBtn = leave;
    this._res.addChild(leave);
  }

  private _makeCoinHudSlip(width: number, text: string): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const h = 48;
    const barX = 20;
    const barW = width - barX;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.26);
    bg.drawRoundedRect(barX, 4, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2.5, INK, 1);
    bg.beginFill(0xFAF0DA, 0.98);
    bg.drawRoundedRect(barX, 0, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2, INK, 1);
    bg.beginFill(0x7A4B24, 1);
    bg.drawRoundedRect(barX + barW - 8, -1, 8, h + 2, 4);
    bg.endFill();
    root.addChild(bg);

    const num = makeText('number', text, INK, {
      size: 25,
      stroke: 0xFFFDF8,
      strokeWidth: 4,
    });
    num.anchor.set(0.5);
    fitTextWidth(num, barW - 30);
    num.position.set(barX + 18 + (barW - 30) / 2, h / 2 - 0.5);
    root.addChild(num);

    this._watchHudOnce(HUD_ICON.coin);
    const cTex = gameTexture(HUD_ICON.coin);
    if (isTextureReady(cTex)) {
      const sp = new PIXI.Sprite(cTex);
      fitSpriteInBox(sp, 52, 52);
      sp.anchor.set(0.5);
      sp.position.set(22, h / 2);
      root.addChild(sp);
    }
    return root;
  }

  /** 菜篮容量手绘木牌：大菜篮图标 + 干湿件数 + 实时占格手绘进度条。 */
  private _makeBasketHudPlaque(width: number, onReady: () => void): PIXI.Container {
    const root = new PIXI.Container();
    const h = 54;
    const barX = 24;
    const barW = width - barX;

    const bState = RunManager.basket;
    const bag = bState.items;
    let bagWet = 0;
    let usedCells = 0;
    for (const it of bag) {
      try {
        const def = getItem(it.defId);
        if (def.zone === 'wet') bagWet += 1;
        usedCells += def.w * def.h;
      } catch {
        usedCells += 1;
      }
    }
    const dryCount = bag.length - bagWet;
    const dryCap = (bState.cols - bState.wetCols) * bState.dryRows + (bState.pocketDry ? 1 : 0);
    const wetCap = bState.wetCols * bState.wetRows + (bState.pocketWet ? 1 : 0);
    const flexCap = bState.flexUnlocked ? bState.cols : 0;
    const totalCap = Math.max(1, dryCap + wetCap + flexCap);
    const ratio = Math.min(1, usedCells / totalCap);
    const full = isBasketFull(bState) || KitchenManager.fridgeSlotsNeeded(bag) > KitchenManager.fridgeRoom();

    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.28);
    bg.drawRoundedRect(barX, 4, barW, h, 12);
    bg.endFill();
    bg.lineStyle(2.5, full ? RED_INK : INK, 1);
    bg.beginFill(full ? 0xFCE8E2 : 0xFAF0DA, 0.98);
    bg.drawRoundedRect(barX, 0, barW, h, 12);
    bg.endFill();
    bg.lineStyle(2, INK, 1);
    bg.beginFill(0x7A4B24, 1);
    bg.drawRoundedRect(barX + barW - 8, -1, 8, h + 2, 4);
    bg.endFill();
    root.addChild(bg);

    const innerX = barX + 34;
    const innerW = barW - 50;
    const titleCopy = full
      ? `篮满 · 干${dryCount} 湿${bagWet}`
      : `菜篮 · 干${dryCount} 湿${bagWet}`;
    const lbl = makeText('caption', titleCopy, full ? RED_INK : INK, {
      size: 21,
      fontWeight: '700',
    });
    lbl.position.set(innerX, 4);
    fitTextWidth(lbl, innerW);
    root.addChild(lbl);

    const bar = makeHandProgressBar({
      width: innerW,
      height: 15,
      ratio: bag.length > 0 ? Math.max(0.08, ratio) : 0,
      onReady,
    });
    bar.node.position.set(innerX, 32);
    root.addChild(bar.node);

    this._watchHudOnce(HUD_ICON.basket);
    const bTex = gameTexture(HUD_ICON.basket);
    if (isTextureReady(bTex)) {
      const sp = new PIXI.Sprite(bTex);
      fitSpriteInBox(sp, 58, 58);
      sp.anchor.set(0.5);
      sp.position.set(28, h / 2);
      sp.eventMode = 'none';
      root.addChild(sp);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, -4, width, h + 8);
    return root;
  }

  /** 中央悬挂天色剩余步数木匾（保留弹跳与天黑频闪动效）。 */
  private _syncDusk(run: NonNullable<typeof RunManager.run>, w: number): void {
    const urgent = run.stepsLeft <= 2;
    const top = this._hudTop();
    const cx = w / 2;
    if (!this._dusk.getChildByName('duskClock')) this._clearDusk();
    if (!this._duskNum) {
      const plaqueHost = new PIXI.Container();
      plaqueHost.name = 'duskPlaque';
      const pw = 244;
      const ph = 122;
      const pTex = gameTexture(MARKET_SCENE_ART.plaque);
      if (isTextureReady(pTex)) {
        const sp = new PIXI.Sprite(pTex);
        sp.width = pw;
        sp.height = ph;
        sp.anchor.set(0.5, 0);
        sp.position.set(cx, top - 16);
        plaqueHost.addChild(sp);
      } else {
        const g = new PIXI.Graphics();
        g.beginFill(0x160E08, 0.3);
        g.drawRoundedRect(cx - pw / 2 + 2, top + 10, pw - 4, 96, 16);
        g.endFill();
        g.lineStyle(2.8, INK, 1);
        g.beginFill(0x8B5A2B, 1);
        g.drawRoundedRect(cx - pw / 2, top + 6, pw, 96, 16);
        g.endFill();
        g.lineStyle(1.4, 0xF3D49B, 0.85);
        g.beginFill(0xB8824C, 1);
        g.drawRoundedRect(cx - pw / 2 + 6, top + 12, pw - 12, 84, 12);
        g.endFill();
        plaqueHost.addChild(g);
      }
      plaqueHost.eventMode = 'none';
      this._dusk.addChild(plaqueHost);

      const clock = new PIXI.Sprite(gameTexture(HUD_ICON.clock));
      clock.name = 'duskClock';
      clock.anchor.set(0.5);
      clock.eventMode = 'none';
      this._watchHudOnce(HUD_ICON.clock, true);
      this._watchHudOnce(MARKET_SCENE_ART.plaque, true);
      this._dusk.addChild(clock);

      const cap = makeText('heading', '天色', CREAM, {
        size: 24,
        stroke: 0x2A180C,
        strokeWidth: 5,
      });
      cap.anchor.set(0.5);
      cap.name = 'duskCap';
      this._dusk.addChild(cap);

      const num = makeLabel(`${run.stepsLeft}`, 60, 0xFFE074, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: '#2A180C',
        strokeThickness: 7,
      });
      num.anchor.set(0.5);
      this._dusk.addChild(num);
      this._duskNum = num;

      const unit = makeText('caption', '步', CREAM, {
        size: 22,
        fontWeight: '700',
        stroke: 0x2A180C,
        strokeWidth: 4,
      });
      unit.anchor.set(0, 0.5);
      unit.name = 'duskUnit';
      this._dusk.addChild(unit);
    }

    const clock = this._dusk.getChildByName('duskClock') as PIXI.Sprite | null;
    const cap = this._dusk.getChildByName('duskCap') as PIXI.Text | null;
    const unit = this._dusk.getChildByName('duskUnit') as PIXI.Text | null;
    const faceCy = top + 60;

    if (clock && isTextureReady(clock.texture)) {
      fitSpriteInBox(clock, 42, 42);
      clock.position.set(cx - 72, faceCy - 12);
    }
    if (cap) {
      cap.position.set(cx - 72, faceCy + 20);
    }
    const num = this._duskNum;
    num.position.set(cx + 16, faceCy + 2);
    if (num.text !== `${run.stepsLeft}`) num.text = `${run.stepsLeft}`;
    if (unit) {
      unit.position.set(cx + 16 + num.width / 2 + 4, faceCy + 10);
    }

    if (urgent !== this._duskUrgent) {
      num.style.fill = urgent ? 0xF0503E : 0xFFE074;
      this._duskUrgent = urgent;
      this._setDuskBlink(urgent);
    }
    if (this._duskSteps >= 0 && run.stepsLeft < this._duskSteps) this._punchDusk();
    this._duskSteps = run.stepsLeft;
  }

  private _punchDusk(): void {
    const num = this._duskNum;
    if (!num || num.destroyed) return;
    TweenManager.cancelTarget(num.scale);
    num.scale.set(1);
    TweenManager.to({
      target: num.scale,
      props: { x: 1.34, y: 1.34 },
      duration: 0.1,
      ease: Ease.easeOutQuad,
      onComplete: () => {
        if (!num.destroyed) {
          TweenManager.to({
            target: num.scale,
            props: { x: 1, y: 1 },
            duration: 0.22,
            ease: Ease.easeOutBack,
          });
        }
      },
    });
  }

  private _setDuskBlink(on: boolean): void {
    const num = this._duskNum;
    if (!num || num.destroyed) return;
    TweenManager.cancelTarget(num);
    num.alpha = 1;
    if (!on) return;
    const pulse = (): void => {
      if (!this._duskUrgent || !this._duskNum || this._duskNum.destroyed) return;
      TweenManager.to({
        target: this._duskNum,
        props: { alpha: 0.28 },
        duration: 0.36,
        ease: Ease.easeInOutQuad,
        onComplete: () => {
          if (!this._duskUrgent || !this._duskNum || this._duskNum.destroyed) return;
          TweenManager.to({
            target: this._duskNum,
            props: { alpha: 1 },
            duration: 0.36,
            ease: Ease.easeInOutQuad,
            onComplete: pulse,
          });
        },
      });
    };
    pulse();
  }

  private _clearDusk(): void {
    if (this._duskNum) {
      TweenManager.cancelTarget(this._duskNum);
    }
    destroyDisplayChildren(this._dusk);
    this._duskNum = null;
    this._duskSteps = -1;
    this._duskUrgent = false;
  }

  /** 返回菜场 / 回家胡桃木圆章按钮（22pt 铭牌）。 */
  private _roundIconBtn(
    icon: string,
    label: string,
    onTap: () => void,
    onReady: () => void,
    highlight = false,
  ): PIXI.Container {
    const size = 96;
    const root = new PIXI.Container();
    if (highlight) {
      const halo = new PIXI.Graphics();
      halo.beginFill(0xF2C14D, 0.36);
      halo.drawCircle(size / 2, size / 2, size / 2 + 12);
      halo.endFill();
      halo.eventMode = 'none';
      root.addChild(halo);
      const pulse = (): void => {
        if (!isStageMounted(halo)) return;
        TweenManager.to({
          target: halo,
          props: { alpha: 0.28 },
          duration: 0.55,
          ease: Ease.easeInOutQuad,
          onComplete: () => {
            if (!isStageMounted(halo)) return;
            TweenManager.to({
              target: halo,
              props: { alpha: 1 },
              duration: 0.55,
              ease: Ease.easeInOutQuad,
              onComplete: pulse,
            });
          },
        });
      };
      pulse();
    }
    const plate = new PIXI.Graphics();
    plate.beginFill(0x180F07, 0.28);
    plate.drawCircle(size / 2 + 1, size / 2 + 3.5, size / 2);
    plate.endFill();
    plate.lineStyle(3.2, INK, 1);
    plate.beginFill(highlight ? 0xE2843A : 0xC46A3A);
    plate.drawCircle(size / 2, size / 2, size / 2 - 2);
    plate.endFill();
    plate.lineStyle(highlight ? 3.5 : 2, 0xF5CB68, highlight ? 1 : 0.88);
    plate.drawCircle(size / 2, size / 2, size / 2 - 8);
    root.addChild(plate);

    this._watchHudOnce(icon);
    const spr = new PIXI.Sprite(gameTexture(icon));
    if (isTextureReady(spr.texture)) {
      fitSpriteInBox(spr, 68, 68);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2 - 4);
      spr.eventMode = 'none';
      root.addChild(spr);
    }

    // Carved walnut nameplate at bottom
    const pw = Math.max(size + 8, label.length * 22 + 20);
    const ph = 30;
    const px = Math.round((size - pw) / 2);
    const py = size - 14;
    const namePlate = new PIXI.Graphics();
    namePlate.lineStyle(2.4, INK, 1);
    namePlate.beginFill(UI_PALETTE.walnutDark, 1);
    namePlate.drawRoundedRect(px, py, pw, ph, 10);
    namePlate.endFill();
    namePlate.lineStyle(1, 0xD6A660, 0.8);
    namePlate.drawRoundedRect(px + 2.5, py + 2.5, pw - 5, ph - 5, 8);
    root.addChild(namePlate);

    const tag = makeText('caption', label, CREAM, {
      size: 22,
      fontWeight: '700',
      stroke: 0x241408,
      strokeWidth: 3,
    });
    tag.anchor.set(0.5);
    fitTextWidth(tag, pw - 12);
    tag.position.set(size / 2, py + ph / 2 - 0.5);
    root.addChild(tag);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-8, -6, size + 16, size + 28);
    bindUiClick(root);
    root.on('pointertap', onTap);
    return root;
  }

  /** 卡片路线：脚下一排能点，前方两排只看。走左边就够不着最右边。 */
  private _drawMap(w: number): void {
    const run = RunManager.run!;
    const h = Game.logicHeight;
    const art = MARKET_ART[run.marketId];
    this._paintScene(sceneBg(run.marketId, run.sceneId) || art.routeBg, 'cover');

    const redraw = this._scheduleSync;
    const cardsBottom = Math.round(h * 0.72);
    const blocked = RunManager.allBlocked();
    const view = layoutRouteMap({
      rows: RunManager.routeRows(3),
      viewWidth: w,
      top: this._hudFloor() + 8,
      bottom: cardsBottom,
      onPick: (id) => this._walkTo(id),
      showRoot: !blocked,
      atlas: art.cardAtlas,
      meatCard: art.meatCard,
      marketId: run.marketId,
      onReady: redraw,
    });
    this._mapView = view;
    this._body.addChild(view.root);
    const want = TutorialManager.allowedCardId;
    const front = view.rows[0] ?? [];
    const cell = front.find((c) => c.option.node.id === want && !c.option.blocked)
      ?? front.find((c) => isRummageNode(c.option.node) && !c.option.blocked)
      ?? front.find((c) => !c.option.blocked);
    this._tutCard = cell?.card ?? null;

    if (blocked) {
      const bypass = makeSlicedButton({
        label: '都进不去 · 绕道前行（耗1步）',
        width: 400,
        height: 62,
        skin: 'terracotta',
        fontSize: 26,
        onReady: redraw,
      });
      bypass.position.set(Math.round((w - 400) / 2), cardsBottom + 36);
      bypass.on('pointertap', () => this._walkBypass());
      this._body.addChild(bypass);
    }
  }

  private _walkTo(nodeId: string): void {
    if (TutorialManager.isActive && TutorialManager.isStep(TutorialStep.CLICK_CARD)) {
      if (nodeId !== TutorialManager.allowedCardId) {
        TutorialGuard.block('walkOtherCard');
        return;
      }
    } else if (TutorialGuard.block('walkCard')) {
      return;
    }
    if (this._walking) return;
    const run = RunManager.run;
    const view = this._mapView;
    if (!run || !view?.rows.length) {
      RunManager.enterNode(nodeId);
      this._onTutorialEntered(nodeId);
      return;
    }
    const picked = view.rows[0].find((c) => c.option.node.id === nodeId);
    if (!picked) {
      RunManager.enterNode(nodeId);
      return;
    }
    const opt = picked.option;
    if (
      !TutorialManager.isActive
      && isRummageNode(opt.node)
      && opt.fee > 0
      && !opt.steelyardDone
    ) {
      this._steelyard.open({
        nodeId,
        stallTitle: cardName(opt.node, true, run.marketId),
        fee: opt.fee,
        onEnter: (res) => this._executeWalkTo(nodeId, picked, res),
        onCancel: () => this._sync(true),
      });
      return;
    }
    this._executeWalkTo(nodeId, picked);
  }

  private _executeWalkTo(
    nodeId: string,
    picked: RouteCell,
    steelyardRes?: SteelyardEnterResult,
  ): void {
    this._walkForward(picked.option.node.next, picked, () => {
      RunManager.enterNode(nodeId, steelyardRes);
      this._onTutorialEntered(nodeId);
      this._afterStep();
    });
  }

  private _onTutorialEntered(nodeId: string): void {
    const node = RunManager.run?.map.nodes[nodeId];
    if (node && isRummageNode(node)) TutorialManager.advanceIf(TutorialStep.CLICK_CARD);
  }

  private _walkBypass(): void {
    if (TutorialManager.isActive && !TutorialManager.isStep(TutorialStep.FREE_WALK)) {
      TutorialGuard.block('walkOtherCard');
      return;
    }
    if (this._walking) return;
    const run = RunManager.run;
    const view = this._mapView;
    if (!run || !view?.rows.length) {
      RunManager.bypass();
      return;
    }
    const merged: string[] = [];
    run.options.forEach((id) => {
      run.map.nodes[id].next.forEach((nid) => {
        if (!merged.includes(nid)) merged.push(nid);
      });
    });
    this._walkForward(merged, null, () => {
      RunManager.bypass();
      this._afterStep();
    });
  }

  private _walkForward(keepIds: string[], picked: RouteCell | null, done: () => void): void {
    const run = RunManager.run!;
    const view = this._mapView!;
    this._walking = true;
    AudioManager.play('walk');
    const dur = 0.34;

    TweenManager.to({ target: view.links, props: { alpha: 0 }, duration: dur * 0.6 });

    view.rows[0].forEach((cell) => {
      const chosen = cell === picked;
      const grow = chosen ? (cell.option.node.encounter?.type === 'rummage' || cell.option.node.stall ? 1.8 : 1.45) : 1.1;
      TweenManager.to({
        target: cell.card,
        props: { y: cell.card.y + (chosen ? 170 : 96), alpha: 0 },
        duration: chosen ? dur : dur * 0.75,
        ease: Ease.easeInQuad,
      });
      TweenManager.to({ target: cell.card.scale, props: { x: grow, y: grow }, duration: dur, ease: Ease.easeInQuad });
    });

    let stay = keepIds;
    for (let i = 1; i < view.rows.length; i++) {
      const slot = view.rows[i - 1][0];
      const next: string[] = [];
      view.rows[i].forEach((cell) => {
        const id = cell.option.node.id;
        if (!stay.includes(id)) {
          TweenManager.to({ target: cell.card, props: { alpha: 0 }, duration: dur * 0.6, ease: Ease.easeInQuad });
          return;
        }
        run.map.nodes[id].next.forEach((nid) => {
          if (!next.includes(nid)) next.push(nid);
        });
        const scale = slot.width / cell.width;
        TweenManager.to({
          target: cell.card,
          props: { y: slot.cy, alpha: 1 },
          duration: dur,
          ease: Ease.easeInOutQuad,
        });
        TweenManager.to({ target: cell.card.scale, props: { x: scale, y: scale }, duration: dur, ease: Ease.easeInOutQuad });
      });
      stay = next;
    }

    TweenManager.to({
      target: this._walkTimer,
      props: { t: 1 },
      duration: dur,
      onComplete: () => {
        this._walkTimer.t = 0;
        this._walking = false;
        done();
        this._body.alpha = 0.45;
        TweenManager.to({ target: this._body, props: { alpha: 1 }, duration: 0.16 });
      },
    });
  }

  private _afterStep(): void {
    const run = RunManager.run;
    if (run?.pendingMysterySack) {
      this._mysterySack.open();
      return;
    }
    const ev = run?.lastEvent;
    if (!run || run.ended || !ev) return;
    if (run.mode === 'rummage' || run.mode === 'play') return;
    if (ev.nodeId !== run.atNodeId || ev.kind === 'gather') return;
    if (ev.nodeId === this._shownEvent) return;
    this._shownEvent = ev.nodeId;
    if (ev.gain) this._popFreebie(ev);
    else if (ev.kind === 'recipe' && KitchenManager.peekRecipeUnlock()) {
      ensureRecipeUnlockPanel().present(true);
    } else if (ev.choices?.length) {
      this._event.open(ev, (index) => {
        if (!RunManager.chooseTalk(index)) return false;
        const after = RunManager.run?.lastEvent;
        if (after?.gain) this._popFreebie(after);
      });
    } else {
      this._event.open(ev);
    }
  }

  private _visualTier(defId: string, quality?: Quality): RarityTier {
    if (defId === GOD_PICK.id || quality === 'god') return 'god';
    return resolveRarityTier(getItem(defId).rarity, quality);
  }

  /** 白捡鲜货弹出：光晕 + 实物 + 品阶小章 + 温润宣纸名签飞入菜篮。 */
  private _popFreebie(ev: RunEventLog): void {
    const gain = ev.gain;
    if (!gain) return;
    const path = resolveItemAssetPath(gain.defId);
    const tex = itemTexture(gain.defId);
    if (!isTextureReady(tex)) {
      if (!isTextureFailed(path)) {
        const key = `freebie:${ev.nodeId}:${path}`;
        if (!this._watchedSync.has(key)) {
          this._watchedSync.add(key);
          whenTextureReady(path, () => {
            this._watchedSync.delete(key);
            const now = RunManager.run;
            if (!now || now.mode === 'rummage') return;
            if (now.lastEvent?.nodeId !== ev.nodeId || now.lastEvent.gain?.defId !== ev.gain?.defId) return;
            this._popFreebie(ev);
          });
        }
      }
      return;
    }

    const rotten = gain.quality === 'rotten';
    const tier: RarityTier = rotten ? 'common' : this._visualTier(gain.defId, gain.quality);
    const style = rarityStyleOf(tier);
    const labelText = displayName(gain.defId, false, gain.quality);

    const wrap = new PIXI.Container();
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    fitSpriteInBox(sprite, 224, 224);
    if (!gain.taken) sprite.tint = 0x9A9086;

    // 宣纸木钉名签承载拾取品名（按品阶点缀边框与墨色）
    const nameSlip = new PIXI.Container();
    const nameInk = rotten ? 0x8A6E52 : (tier === 'common' ? INK : style.ink);
    const name = makeText('title', labelText, nameInk, { size: 28 });
    name.anchor.set(0.5);
    const nw = Math.max(188, Math.ceil(name.width) + 48);
    const nh = 54;
    const nbg = new PIXI.Graphics();
    nbg.beginFill(0x160E08, 0.28);
    nbg.drawRoundedRect(-nw / 2 + 2, -nh / 2 + 4, nw - 4, nh, 10);
    nbg.endFill();
    nbg.lineStyle(2.6, !rotten && tier !== 'common' ? style.frame : INK, 1);
    nbg.beginFill(0xFAF0DA, 0.98);
    nbg.drawRoundedRect(-nw / 2, -nh / 2, nw, nh, 10);
    nbg.endFill();
    if (!rotten && tier !== 'common') {
      nbg.lineStyle(1.2, style.glow, 0.65);
      nbg.drawRoundedRect(-nw / 2 + 4, -nh / 2 + 4, nw - 8, nh - 8, 7);
    }
    nameSlip.addChild(nbg, name);
    nameSlip.position.set(0, 140);

    wrap.addChild(sprite, nameSlip);
    if (!rotten) {
      attachSpriteContour(wrap, sprite, tier, {
        onDark: true,
        selected: tier !== 'common',
        thicknessScale: 1.15,
      });
    }
    if (!rotten && tier !== 'common') {
      const rSeal = makeRaritySeal(tier, 48, -0.1);
      rSeal.position.set(92, -92);
      wrap.addChild(rSeal);
    }
    if (gain.firstSeen && !rotten) {
      const badge = makeNewFoodTag(26);
      badge.position.set(0, -136);
      wrap.addChild(badge);
    }
    const startX = Game.designWidth / 2;
    const startY = Math.round(Game.logicHeight * 0.46);
    wrap.position.set(startX, startY);
    wrap.scale.set(0.2);
    wrap.alpha = 0;
    this._revealLayer.addChild(wrap);
    AudioManager.playGain();

    const land = this._basketBtn
      ? {
        x: this._basketBtn.x + 36,
        y: this._basketBtn.y + 26,
      }
      : { x: 528, y: Game.safeTop + 28 };

    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.1 });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: 0.22,
      ease: Ease.easeOutBack,
      onComplete: () => {
        if (!gain.taken) {
          AudioManager.play('ui_deny');
          Platform.showToast(diagnoseCannotPlace(RunManager.basket, gain.defId));
          const lootUid = RunManager.pendingLoot[0]?.uid;
          if (lootUid) this._basket.open(lootUid);
          TweenManager.to({
            target: wrap,
            props: { alpha: 0, y: wrap.y + 24 },
            duration: 0.28,
            delay: 0.35,
            onComplete: () => {
              destroyDisplayNode(wrap);
            },
          });
          return;
        }
        this._spawnTierFloat(
          tier !== 'common' ? `${rarityTierLabel(tier)} · ${labelText} +1` : `${labelText} +1`,
          tier,
          startX,
          startY - 64,
        );
        TweenManager.to({
          target: wrap,
          props: { x: land.x, y: land.y },
          duration: 0.38,
          delay: 0.28,
          ease: Ease.easeInQuad,
        });
        TweenManager.to({
          target: wrap.scale,
          props: { x: 0.18, y: 0.18 },
          duration: 0.38,
          delay: 0.28,
          ease: Ease.easeInQuad,
        });
        TweenManager.to({
          target: wrap,
          props: { alpha: 0 },
          duration: 0.18,
          delay: 0.5,
          onComplete: () => {
            this._punchBasketBtn();
            destroyDisplayNode(wrap);
          },
        });
      },
    });
  }

  private _spawnTierFloat(text: string, tier: RarityTier, x: number, y: number): void {
    const style = rarityStyleOf(tier);
    const flt = makeText('title', text, style.float, {
      size: 30,
      stroke: 0x241408,
      strokeWidth: 6,
    });
    flt.anchor.set(0.5);
    flt.position.set(x, y);
    flt.alpha = 0;
    flt.scale.set(0.75);
    this._revealLayer.addChild(flt);
    TweenManager.to({ target: flt, props: { alpha: 1 }, duration: 0.1 });
    TweenManager.to({
      target: flt.scale,
      props: { x: 1, y: 1 },
      duration: 0.2,
      ease: Ease.easeOutBack,
    });
    TweenManager.to({
      target: flt,
      props: { y: y - 76 },
      duration: 0.72,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: flt,
      props: { alpha: 0 },
      duration: 0.24,
      delay: 0.48,
      ease: Ease.easeInQuad,
      onComplete: () => {
        destroyDisplayNode(flt);
      },
    });
  }

  private _punchBasketBtn(): void {
    const btn = this._basketBtn;
    if (!btn || btn.destroyed || !isStageMounted(btn)) return;
    TweenManager.cancelTarget(btn.scale);
    btn.scale.set(1);
    TweenManager.to({
      target: btn.scale,
      props: { x: 1.08, y: 1.08 },
      duration: 0.09,
      ease: Ease.easeOutQuad,
      onComplete: () => {
        if (!btn.destroyed && isStageMounted(btn)) {
          TweenManager.to({
            target: btn.scale,
            props: { x: 1, y: 1 },
            duration: 0.16,
            ease: Ease.easeOutBack,
          });
        }
      },
    });
  }

  /** 山洞采菌：石壁上看得见的菌，点一下摘一朵，附宣纸提示牌。 */
  private _drawPlay(w: number, h: number): void {
    const run = RunManager.run!;
    const play = run.play;
    if (!play || play.type !== 'gather') {
      this._paintScene(sceneBg(run.marketId, run.sceneId), 'cover');
      return;
    }

    const gatherBg = play.bg || sceneBg(run.marketId, run.sceneId);
    this._watchSyncOnce(gatherBg);
    this._paintScene(
      isTextureFailed(gatherBg) ? sceneBg(run.marketId, run.sceneId) : gatherBg,
      'cover',
    );

    // 采摘剩余次数宣纸提示签
    const note = this._makeSceneSlip(
      play.picksLeft > 0 ? `点石壁鲜货采摘 · 还能摘 ${play.picksLeft} 朵` : '这处已经采够啦，返回继续逛吧',
      play.picksLeft > 0 ? INK : RED_INK,
    );
    note.position.set(w / 2, h - Math.max(48, Game.safeBottom + 36) - 36);
    this._body.addChild(note);

    play.spots.forEach((spot) => {
      if (spot.taken) return;
      const def = getItem(spot.defId);
      const spotTier = def.rarity as RarityTier;
      const spotStyle = rarityStyleOf(spotTier);
      const path = resolveItemAssetPath(spot.defId);
      this._watchSyncOnce(path);
      const tex = itemTexture(spot.defId);
      const x = Math.round(w * spot.x);
      const y = Math.round(h * spot.y);
      const wrap = new PIXI.Container();
      wrap.position.set(x, y);
      wrap.eventMode = 'static';
      wrap.cursor = play.picksLeft > 0 ? 'pointer' : 'default';
      wrap.hitArea = new PIXI.Rectangle(-58, -58, 116, 116);

      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        fitSpriteInBox(sp, 112, 112);
        wrap.addChild(sp);
        attachSpriteContour(wrap, sp, spotTier, {
          onDark: true,
          selected: spotTier === 'legendary' || spotTier === 'god',
          pulse: spotTier !== 'common',
        });
      } else {
        const fallback = new PIXI.Graphics();
        fallback.beginFill(0x6B4A32);
        fallback.drawCircle(0, 0, 28);
        fallback.endFill();
        wrap.addChild(fallback);
      }
      const spotLbl = makeText('caption', def.name, spotStyle.float, {
        size: 20,
        fontWeight: '700',
        stroke: 0x241408,
        strokeWidth: 4,
      });
      spotLbl.anchor.set(0.5, 0);
      spotLbl.position.set(0, 48);
      wrap.addChild(spotLbl);
      if (spot.firstSeen) {
        const badge = makeNewFoodTag(24);
        badge.position.set(0, -72);
        wrap.addChild(badge);
      }
      wrap.on('pointertap', () => {
        if (play.picksLeft <= 0) {
          AudioManager.play('ui_deny');
          Platform.showToast('手上拿够了');
          return;
        }
        const result = RunManager.pickGather(spot.uid);
        const ev = RunManager.run?.lastEvent;
        if (result === 'need_space') {
          AudioManager.play('ui_deny');
          Platform.showToast(diagnoseCannotPlace(RunManager.basket, spot.defId));
          this._basket.open(RunManager.pendingLoot.at(-1)?.uid);
          return;
        }
        if (ev?.gain) {
          this._shownEvent = ev.nodeId;
          this._popFreebie(ev);
        }
      });
      this._body.addChild(wrap);
    });
  }

  /** 手绘宣纸横签（彻底替代原半透明黑框提示条）。 */
  private _makeSceneSlip(copy: string, inkColor = INK): PIXI.Container {
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    const lbl = makeText('heading', copy, inkColor, { size: 24 });
    lbl.anchor.set(0.5);
    const pw = Math.max(296, Math.ceil(lbl.width) + 56);
    const ph = 54;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x160E08, 0.3);
    bg.drawRoundedRect(-pw / 2, -ph / 2 + 4, pw, ph, 10);
    bg.endFill();
    bg.lineStyle(2.5, INK, 1);
    bg.beginFill(0xFAF0DA, 0.96);
    bg.drawRoundedRect(-pw / 2, -ph / 2, pw, ph, 10);
    bg.endFill();
    bg.lineStyle(1.2, 0xC6A87E, 0.72);
    bg.drawRoundedRect(-pw / 2 + 12, -ph / 2 + 5, pw - 24, ph - 10, 6);
    for (const side of [-1, 1] as const) {
      bg.lineStyle(2, INK, 1);
      bg.beginFill(0x7A4B24, 1);
      bg.drawRoundedRect(side < 0 ? -pw / 2 : pw / 2 - 9, -ph / 2 - 2, 9, ph + 4, 4);
      bg.endFill();
    }
    wrap.addChild(bg, lbl);
    return wrap;
  }

  private _drawRummage(w: number, h: number): void {
    const run = RunManager.run!;
    const nodeId = run.currentNodeId!;
    const node = run.map.nodes[nodeId];
    const enc = nodeEncounter(node);
    const specialty = enc.type === 'rummage' ? enc.specialty : undefined;
    const stallId = (enc.type === 'rummage' && enc.stall) || node.stall;
    const nodePile = run.piles[nodeId] ?? [];
    for (const it of nodePile) {
      const vId = visibleDefId(it);
      gameTexture(resolveItemAssetPath(vId, false));
      if (it.quality === 'rotten') {
        itemLookTexture(vId, 'rotten');
      }
    }
    if (nodePile.some((it) => it.defId === GOD_PICK.id)) {
      gameTexture(GOD_FISH);
    }
    this._paintScene(stallRummageArt(run.marketId, stallId, specialty), 'cover');

    const tableTop = run.marketId === 'heyan' && stallId === 'egg' ? 0.36 : 0.26;
    const table = {
      x: 24,
      y: Math.round(h * tableTop),
      w: w - 48,
      h: 280,
    };
    this._stackPos = { x: Math.round(w * 0.5), y: Math.round(h * 0.60) };
    this._tutCard = null;
    this._tutToken = null;
    const pile = this._stallPile(nodeId, stallId, this._stackPos.x, this._stackPos.y, specialty);
    this._tutPile = pile;
    this._body.addChild(pile);

    const placed = this._packPile(nodeId, RunManager.currentPile(), table);
    placed.forEach((slot) => {
      const token = this._pileToken(slot.item, slot.x, slot.y, slot.w, slot.h);
      if (slot.item.quality !== 'rotten') {
        if (!this._tutToken || slot.item.defId === 'caitai') this._tutToken = token;
      }
      const flight = this._flying.get(slot.item.uid);
      if (flight) {
        token.alpha = 0;
        flight.token = token;
      }
      this._body.addChild(token);
    });
    this._flying.forEach((flight, uid) => {
      if (flight.playing) return;
      const slot = placed.find((s) => s.item.uid === uid);
      const item = slot ? this._findPile(uid) : undefined;
      if (slot && item) {
        flight.playing = true;
        this._playDrawReveal(item, slot);
      } else {
        if (flight.token) flight.token.alpha = 1;
        this._flying.delete(uid);
      }
    });
  }

  private _stallPile(nodeId: string, stallId: StallId | undefined, cx: number, cy: number, specialty?: string): PIXI.Container {
    const root = new PIXI.Container();
    const left = RunManager.crateLeft().length;
    if (this._crateMax[nodeId] == null) this._crateMax[nodeId] = Math.max(left, 1);
    const max = this._crateMax[nodeId] ?? 1;
    const ratio = left <= 0 ? 0 : left / max;
    const kick = this._pileKick;
    this._pileKick = 0;
    const fromRatio = left < max && kick > 0 ? Math.min(1, (left + kick) / max) : ratio;
    const path = stallPileArt(RunManager.run!.marketId, stallId, specialty);
    const tex = gameTexture(path);
    this._watchSyncOnce(path);
    const boxW = 560;
    const boxH = 500;
    if (isTextureReady(tex) && (left > 0 || fromRatio > 0)) {
      const sprite = new PIXI.Sprite(tex);
      const iw = tex.width || 720;
      const ih = tex.height || 640;
      const base = Math.min(boxW / iw, boxH / ih);
      sprite.anchor.set(0.5);
      sprite.position.set(cx, cy);
      sprite.scale.set(base * fromRatio);
      if (fromRatio !== ratio) {
        TweenManager.to({
          target: sprite.scale,
          props: { x: base * ratio, y: base * ratio },
          duration: 0.32,
          ease: Ease.easeOutQuad,
        });
      }
      root.addChild(sprite);
    }
    if (left > 0) {
      const tagY = cy + (boxH * ratio) * 0.42 + 16;
      const slip = this._makeSceneSlip(`点此翻找鲜货 · 剩 ${left} 件`, INK);
      slip.position.set(cx, tagY);
      root.addChild(slip);
    }
    const hit = Math.max(140, boxW * Math.max(ratio, 0.32));
    root.eventMode = 'static';
    root.cursor = left > 0 ? 'pointer' : 'default';
    root.hitArea = new PIXI.Rectangle(cx - hit / 2, cy - hit / 2, hit, hit + 52);
    root.on('pointertap', () => this._drawOne());
    return root;
  }

  private _drawOne(): void {
    if (TutorialGuard.block('drawPile')) return;
    if (
      TutorialManager.isStep(TutorialStep.TAKE_LOOT)
      && RunManager.currentPile().some((it) => it.quality !== 'rotten')
    ) {
      AudioManager.play('ui_deny');
      Platform.showToast('先把桌上的好菜收进菜篮，再继续抽');
      return;
    }
    const crate = RunManager.crateLeft();
    if (!crate.length) {
      RunManager.drawFromCrate();
      return;
    }
    const pick = TutorialManager.isStep(TutorialStep.CLICK_PILE)
      ? crate.find((it) => it.defId === 'caitai' && it.quality !== 'rotten') ?? crate[0]
      : TutorialManager.isStep(TutorialStep.TAKE_LOOT)
        ? (crate.length >= 2
          ? crate.find((it) => it.quality === 'rotten') ?? crate[0]
          : crate.find((it) => it.quality !== 'rotten') ?? crate[0])
        : crate[Math.floor(Math.random() * crate.length)];
    if (this._flying.has(pick.uid)) return;
    AudioManager.play('rummage');
    this._flying.set(pick.uid, { playing: false, wrap: null, token: null });
    this._pileKick += 1;
    RunManager.drawFromCrate(pick.uid);
    TutorialManager.advanceIf(TutorialStep.CLICK_PILE);
    TutorialOverlay.refresh();
  }

  private _playDrawReveal(
    item: PileItem,
    slot: { x: number; y: number; w: number; h: number },
  ): void {
    const flight = this._flying.get(item.uid);
    if (!flight) return;
    const defId = visibleDefId(item);
    const rotten = item.quality === 'rotten';
    const look = rotten ? 'rotten' : 'clean';
    const cleanPath = resolveItemAssetPath(defId, false);
    const cleanTex = itemTexture(defId);
    const lookTex = itemLookTexture(defId, look);
    const sprite = new PIXI.Sprite(lookTex);
    if (rotten && lookTex === cleanTex) sprite.tint = 0x6B4A32;
    sprite.anchor.set(0.5);
    if (!isTextureReady(sprite.texture)) {
      if (isTextureFailed(cleanPath)) {
        this._landFlight(item.uid);
        return;
      }
      whenTextureReady(cleanPath, () => {
        if (this._flying.get(item.uid)?.playing) this._playDrawReveal(item, slot);
      });
      return;
    }
    if (flight.wrap) return;
    AudioManager.playGain();

    const rottenReveal = item.quality === 'rotten';
    const tier: RarityTier = rottenReveal ? 'common' : this._visualTier(defId, item.quality);
    const style = rarityStyleOf(tier);

    fitSpriteInBox(sprite, REVEAL_FACE, REVEAL_FACE);
    const tableScale = Math.min(slot.w / REVEAL_FACE, slot.h / REVEAL_FACE) * 0.92;
    const index = Math.max(0, this._flying.size - 1);
    const startX = this._stackPos.x + index * 16;
    const startY = this._stackPos.y - index * 22;

    const wrap = new PIXI.Container();
    wrap.addChild(sprite);
    if (!rottenReveal) {
      attachSpriteContour(wrap, sprite, tier, {
        onDark: true,
        selected: tier !== 'common',
        thicknessScale: 1.1,
      });
    }
    wrap.position.set(startX, startY);
    wrap.scale.set(0.22);
    this._revealLayer.addChild(wrap);
    flight.wrap = wrap;

    const baseRevealName = displayName(defId, item.inspected, item.quality === 'god' ? 'common' : item.quality);
    const revealCopy = !rottenReveal && tier !== 'common'
      ? `${rarityTierLabel(tier)} · ${baseRevealName}`
      : baseRevealName;
    const name = makeText(
      'heading',
      revealCopy,
      rottenReveal ? 0xFFA58E : style.float,
      { size: 26, stroke: 0x241408, strokeWidth: 5 },
    );
    name.anchor.set(0.5, 1);
    name.alpha = 0;
    name.position.set(0, -REVEAL_FACE * 0.48);
    wrap.addChild(name);
    let badge: PIXI.Container | null = null;
    if (item.firstSeen && item.quality !== 'rotten') {
      badge = makeNewFoodTag(24);
      badge.alpha = 0;
      badge.position.set(0, -REVEAL_FACE * 0.48 - 32);
      wrap.addChild(badge);
    }

    const landX = slot.x + slot.w / 2;
    const landY = slot.y + slot.h / 2;
    const finish = () => this._landFlight(item.uid);

    TweenManager.to({ target: name, props: { alpha: 1 }, duration: 0.1 });
    if (badge) TweenManager.to({ target: badge, props: { alpha: 1 }, duration: 0.1 });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: REVEAL_POP,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({ target: name, props: { alpha: 0 }, duration: 0.16 });
        if (badge) TweenManager.to({ target: badge, props: { alpha: 0 }, duration: 0.16 });
        TweenManager.to({
          target: wrap,
          props: { x: landX, y: landY },
          duration: REVEAL_FLY,
          ease: Ease.easeInOutQuad,
        });
        TweenManager.to({
          target: wrap.scale,
          props: { x: tableScale, y: tableScale },
          duration: REVEAL_FLY,
          ease: Ease.easeInQuad,
          onComplete: () => {
            TweenManager.to({
              target: wrap.scale,
              props: { x: tableScale * 1.08, y: tableScale * 0.92 },
              duration: REVEAL_LAND * 0.5,
              onComplete: () => {
                TweenManager.to({
                  target: wrap.scale,
                  props: { x: tableScale, y: tableScale },
                  duration: REVEAL_LAND * 0.5,
                  onComplete: finish,
                });
              },
            });
          },
        });
      },
    });
  }

  private _landFlight(uid: string): void {
    const flight = this._flying.get(uid);
    if (!flight) return;
    if (flight.wrap) {
      destroyDisplayNode(flight.wrap);
    }
    if (flight.token && !flight.token.destroyed) flight.token.alpha = 1;
    this._flying.delete(uid);
  }

  private _clearReveal(): void {
    [...this._flying.keys()].forEach((uid) => this._landFlight(uid));
    destroyDisplayChildren(this._revealLayer);
    this._pileKick = 0;
  }

  private _clearStalePops(): void {
    const keep = new Set(
      [...this._flying.values()].map((flight) => flight.wrap).filter((wrap): wrap is PIXI.Container => !!wrap),
    );
    for (const child of [...this._revealLayer.children]) {
      if (keep.has(child as PIXI.Container)) continue;
      destroyDisplayNode(child);
    }
  }

  private _paintScene(path: string, mode: 'bottom' | 'cover' = 'bottom'): void {
    destroyDisplayChildren(this._bg);
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x3A3228);
    this._bg.addChild(fallback);
    const tex = gameTexture(path);
    this._watchSyncOnce(path);
    if (isTextureReady(tex)) {
      const scene = new PIXI.Sprite(tex);
      const fit = mode === 'cover'
        ? fitCover(tex.width, tex.height, w, h)
        : fitWidthBottom(tex.width, tex.height, w, h);
      applyFit(scene, fit);
      this._bg.addChild(scene);
    }
  }

  private _pinsFor(nodeId: string): Map<string, { rx: number; ry: number; w: number; h: number }> {
    let pins = this._tablePins.get(nodeId);
    if (!pins) {
      pins = new Map();
      this._tablePins.set(nodeId, pins);
    }
    return pins;
  }

  private _packPile(
    nodeId: string,
    pile: PileItem[],
    table: { x: number; y: number; w: number; h: number },
  ): Array<{ item: PileItem; x: number; y: number; w: number; h: number }> {
    const unit = Math.min(112, Math.floor(table.w / 5.4));
    const gapX = 14;
    const gapY = 16;
    const pins = this._pinsFor(nodeId);
    const live = new Set(pile.map((it) => it.uid));
    for (const uid of [...pins.keys()]) {
      if (!live.has(uid)) pins.delete(uid);
    }

    const sizeOf = (item: PileItem): { w: number; h: number } => {
      const def = getItem(visibleDefId(item));
      return { w: Math.max(unit, def.w * unit), h: Math.max(unit, def.h * unit) };
    };

    const out: Array<{ item: PileItem; x: number; y: number; w: number; h: number }> = [];
    const pending: PileItem[] = [];
    for (const item of pile) {
      const size = sizeOf(item);
      const pin = pins.get(item.uid);
      if (pin && pin.w === size.w && pin.h === size.h) {
        out.push({ item, x: table.x + pin.rx, y: table.y + pin.ry, w: pin.w, h: pin.h });
      } else {
        pending.push(item);
      }
    }

    const appendSlot = (tw: number, th: number): { x: number; y: number; w: number; h: number } => {
      if (!out.length) return { x: table.x, y: table.y, w: tw, h: th };
      const lastY = Math.max(...out.map((slot) => slot.y));
      const row = out.filter((slot) => slot.y === lastY);
      const rowH = Math.max(...row.map((slot) => slot.h));
      const cx = Math.max(...row.map((slot) => slot.x + slot.w + gapX));
      if (cx + tw > table.x + table.w && row.length) {
        return { x: table.x, y: lastY + rowH + gapY, w: tw, h: th };
      }
      return { x: cx, y: lastY, w: tw, h: th };
    };

    for (const item of pending) {
      const size = sizeOf(item);
      const slot = appendSlot(size.w, size.h);
      out.push({ item, ...slot });
      pins.set(item.uid, { rx: slot.x - table.x, ry: slot.y - table.y, w: slot.w, h: slot.h });
    }
    return out;
  }

  /** 摊桌上的鲜货：对应品质呼吸背光 + 品阶色标菜名牌 + 新食材/急需角标。 */
  private _pileToken(
    item: PileItem,
    x: number,
    y: number,
    tw: number,
    th: number,
  ): PIXI.Container {
    const vDefId = visibleDefId(item);
    const def = getItem(vDefId);
    const root = new PIXI.Container();
    root.position.set(x, y);

    const rotten = item.quality === 'rotten';
    const look = rotten ? 'rotten' : 'clean';
    const tier: RarityTier = rotten ? 'common' : this._visualTier(vDefId, item.quality);
    const style = rarityStyleOf(tier);
    const cleanTex = itemTexture(vDefId);
    const lookTex = itemLookTexture(vDefId, look);
    const icon = new PIXI.Sprite(lookTex);
    this._watchSyncOnce(resolveItemAssetPath(vDefId, false));

    const rawLabel = RunManager.labelFor(item);
    const tagH = 30;
    const iconAreaH = Math.max(48, th - tagH - 2);
    const iconCy = iconAreaH / 2;

    fitSpriteInBox(icon, tw * 0.88, iconAreaH);
    icon.anchor.set(0.5);
    icon.position.set(tw / 2, iconCy);
    if (rotten) icon.alpha = 0.72;
    if (rotten && lookTex === cleanTex) icon.tint = 0x6B4A32;
    root.addChild(icon);
    if (!rotten && tier !== 'common') {
      attachSpriteContour(root, icon, tier, {
        onDark: true,
        selected: tier === 'legendary' || tier === 'god',
        pulse: tier === 'legendary' || tier === 'god',
        thicknessScale: 1.05,
      });
    }

    if (!rotten && tier !== 'common') {
      const pillWrap = new PIXI.Container();
      pillWrap.eventMode = 'none';
      const tag = makeText('body', rawLabel, style.float, {
        size: 22,
        fontWeight: '700',
        stroke: 0x1E120A,
        strokeWidth: 4,
      });
      tag.anchor.set(0, 0.5);
      const maxPillW = Math.max(108, tw + 14);
      fitTextWidth(tag, maxPillW - 26);
      const dotSpace = 13;
      const innerW = dotSpace + tag.width;
      const pw = Math.min(maxPillW, Math.max(76, Math.ceil(innerW) + 18));
      const ph = 28;
      const pbg = new PIXI.Graphics();
      pbg.lineStyle(1.8, style.frame, 0.96);
      pbg.beginFill(0x21140B, 0.84);
      pbg.drawRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      pbg.endFill();
      pbg.lineStyle(1, 0xFFFDF8, 0.55);
      pbg.beginFill(style.glow, 1);
      pbg.drawCircle(-innerW / 2 + 4, 0, 4.2);
      pbg.endFill();
      tag.position.set(-innerW / 2 + dotSpace, -0.5);
      pillWrap.addChild(pbg, tag);
      pillWrap.position.set(tw / 2, th - ph / 2);
      root.addChild(pillWrap);
    } else {
      const tag = makeText(
        'body',
        rotten ? `✕ ${rawLabel}` : rawLabel,
        rotten ? 0xFFA088 : style.float,
        {
          size: 23,
          fontWeight: '700',
          stroke: 0x241408,
          strokeWidth: 5,
        },
      );
      tag.anchor.set(0.5, 1);
      fitTextWidth(tag, Math.max(106, tw + 12));
      tag.position.set(tw / 2, th);
      root.addChild(tag);
    }

    const isUrgent = !rotten && this._urgentFoods.has(def.id);
    if (item.firstSeen && !rotten) {
      const badge = makeNewFoodTag(24);
      badge.position.set(tw / 2, icon.y - icon.height * 0.5 + 6);
      root.addChild(badge);
      if (isUrgent) {
        const urg = makeUrgentFoodTag(20);
        urg.position.set(tw / 2, icon.y - icon.height * 0.5 + 38);
        root.addChild(urg);
      }
    } else if (isUrgent) {
      const urg = makeUrgentFoodTag(20);
      urg.position.set(tw / 2, icon.y - icon.height * 0.5 + 6);
      root.addChild(urg);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, tw, th);
    root.on('pointertap', () => this._takeItem(item.uid, { x: x + tw / 2, y: y + iconCy }));
    return root;
  }

  private _takeItem(uid: string, fromPos?: { x: number; y: number }): void {
    const item = this._findPile(uid);
    if (!item) return;
    if (item.quality === 'rotten') {
      Platform.vibrateShort('light');
      AudioManager.play('rummage');
      RunManager.discardRotten(uid);
      Platform.showToast('烂菜已随手拨到一边');
      TutorialOverlay.refresh();
      return;
    }
    if (!TutorialManager.isStep(TutorialStep.TAKE_LOOT) && TutorialGuard.block('takeLoot')) {
      return;
    }
    Platform.vibrateShort('light');
    if (item.defId === GOD_PICK.id && !item.inspected) {
      this._playGodPick(uid);
      return;
    }
    const vDefId = visibleDefId(item);
    if (!tryAutoPackBasket(RunManager.basket, pileToBasketDraft(item))) {
      AudioManager.play('ui_deny');
      Platform.showToast(diagnoseCannotPlace(RunManager.basket, vDefId));
      this._basket.open(uid);
      return;
    }
    const tier = this._visualTier(vDefId, item.quality);
    const labelText = RunManager.labelFor(item);
    if (tier === 'god' || tier === 'legendary' || tier === 'epic') AudioManager.playGain();
    else AudioManager.play('basket_place');
    RunManager.take(uid);
    this._playPickupFly(vDefId, tier, labelText, fromPos ?? this._stackPos);
    if (TutorialManager.isStep(TutorialStep.TAKE_LOOT)) {
      const crateEmpty = RunManager.crateLeft().length === 0;
      const cleanLeft = RunManager.currentPile().some((it) => it.quality !== 'rotten');
      if (RunManager.basket.items.length > 0 && crateEmpty && !cleanLeft) {
        TutorialManager.advanceIf(TutorialStep.TAKE_LOOT);
      } else {
        TutorialOverlay.refresh();
      }
    }
  }

  /** 摊桌拾取鲜货飞入竹篮：对应白/绿/蓝/紫/金品质光效 + 飘字。 */
  private _playPickupFly(
    defId: string,
    tier: RarityTier,
    labelText: string,
    from: { x: number; y: number },
  ): void {
    const land = this._basketBtn
      ? { x: this._basketBtn.x + 32, y: this._basketBtn.y + 26 }
      : { x: 528, y: Game.safeTop + 28 };

    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    wrap.position.set(from.x, from.y);

    const tex = itemLookTexture(defId, 'clean');
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 94, 94);
      sp.anchor.set(0.5);
      wrap.addChild(sp);
      attachSpriteContour(wrap, sp, tier, {
        onDark: true,
        selected: tier !== 'common',
        thicknessScale: 1.05,
      });
    }
    wrap.scale.set(1.08);
    this._revealLayer.addChild(wrap);

    const floatCopy = tier !== 'common'
      ? `${rarityTierLabel(tier)} · ${labelText} +1`
      : `${labelText} +1`;
    this._spawnTierFloat(floatCopy, tier, from.x, from.y - 24);

    TweenManager.to({
      target: wrap,
      props: { x: land.x, y: land.y },
      duration: 0.32,
      ease: Ease.easeInQuad,
    });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 0.24, y: 0.24 },
      duration: 0.32,
      ease: Ease.easeInQuad,
    });
    TweenManager.to({
      target: wrap,
      props: { alpha: 0.15 },
      duration: 0.16,
      delay: 0.18,
      onComplete: () => {
        this._punchBasketBtn();
        destroyDisplayNode(wrap);
      },
    });
  }

  private _playGodPick(uid: string): void {
    if (this._godPlaying && this._godLayer.children.length) return;
    const item = this._findPile(uid);
    if (!item || item.defId !== GOD_PICK.id || item.inspected) return;
    whenTextureReady(GOD_FISH, () => {
      if (this._findPile(uid)?.defId === GOD_PICK.id) this._playGodPick(uid);
    });
    const tex = gameTexture(GOD_FISH);
    if (!isTextureReady(tex)) return;

    this._clearGodPick();
    this._godPlaying = true;
    AudioManager.playGain();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const cx = w / 2;
    const cy = Math.round(h * 0.46);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0;
    dim.eventMode = 'static';
    this._godLayer.addChild(dim);

    const wrap = new PIXI.Container();
    wrap.position.set(cx, cy);
    wrap.scale.set(0.18);
    wrap.alpha = 0;
    this._godLayer.addChild(wrap);

    const fish = new PIXI.Sprite(tex);
    fish.anchor.set(0.5);
    fitSpriteInBox(fish, 340, 280);
    fish.position.set(0, 28);
    wrap.addChild(fish);
    attachSpriteContour(wrap, fish, 'god', {
      onDark: true,
      selected: true,
      thicknessScale: 1.25,
      pulse: true,
    });

    const godSeal = makeRaritySeal('god', 56, -0.1, '天选');
    godSeal.position.set(138, -88);
    wrap.addChild(godSeal);

    const title = new PIXI.Text('神  捡', {
      fontFamily: TITLE_FONT,
      fontSize: 64,
      fill: 0xF4C430,
      fontWeight: '700',
      letterSpacing: 10,
      stroke: '#2A2018',
      strokeThickness: 8,
      dropShadow: true,
      dropShadowColor: '#8B5A2B',
      dropShadowAlpha: 0.55,
      dropShadowDistance: 3,
      dropShadowBlur: 0,
      dropShadowAngle: Math.PI / 2,
    });
    title.anchor.set(0.5);
    title.position.set(0, -168);
    wrap.addChild(title);

    const name = makeLabel('野生大黄鱼', 30, 0xFFF8F0, {
      fontFamily: FONT,
      fontWeight: '700',
      stroke: 0x2A2018,
      strokeThickness: 6,
    });
    name.anchor.set(0.5);
    name.position.set(0, -108);
    wrap.addChild(name);
    if (KitchenManager.discoverFood(GOD_PICK.id, undefined, RunManager.run?.marketId)) {
      const badge = makeNewFoodTag(28);
      badge.position.set(0, -228);
      wrap.addChild(badge);
    }

    const land = this._basketBtn
      ? { x: this._basketBtn.x + 36, y: this._basketBtn.y + 26 }
      : { x: 528, y: Game.safeTop + 28 };

    const finish = (openBasket: boolean): void => {
      this._clearGodPick();
      if (openBasket) this._basket.open(uid);
    };

    TweenManager.to({ target: dim, props: { alpha: 0.62 }, duration: 0.16 });
    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.12 });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: 0.28,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({
          target: wrap,
          props: { x: land.x, y: land.y },
          duration: 0.42,
          delay: 0.72,
          ease: Ease.easeInQuad,
        });
        TweenManager.to({
          target: wrap.scale,
          props: { x: 0.16, y: 0.16 },
          duration: 0.42,
          delay: 0.72,
          ease: Ease.easeInQuad,
        });
        TweenManager.to({
          target: dim,
          props: { alpha: 0 },
          duration: 0.28,
          delay: 0.86,
        });
        TweenManager.to({
          target: wrap,
          props: { alpha: 0 },
          duration: 0.2,
          delay: 0.96,
          onComplete: () => {
            const result = RunManager.take(uid, { quiet: true });
            if (result === 'need_space') {
              Platform.showToast(diagnoseCannotPlace(RunManager.basket, GOD_PICK.id));
            }
            finish(result === 'need_space');
          },
        });
      },
    });
  }

  private _clearGodPick(): void {
    destroyDisplayChildren(this._godLayer);
    this._godPlaying = false;
  }

  private _findPile(uid: string): PileItem | undefined {
    return RunManager.currentPile().find((it) => it.uid === uid)
      ?? (RunManager.run
        ? (Object.values(RunManager.run.piles) as PileItem[][]).flat().find((it) => it.uid === uid)
        : undefined);
  }
}
