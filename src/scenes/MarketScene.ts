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
  STALLS,
  displayName,
  getItem,
  itemsForStall,
  visibleDefId,
  type PileItem,
  type RunEventLog,
  type StallId,
  getMarket,
  getSpecialty,
  MARKET_ART,
  nodeEncounter,
  RARITY_STYLE,
  rummageTitle,
  sceneBg,
  sceneTitle,
  stallPileArt,
  stallRummageArt,
} from '@/sim';
import { layoutRouteMap, type RouteCell, type RouteMapView } from '@/gameobjects/market/MapView';
import { FONT, HUD_ICON, drawRarityFrame, fillRect, makeHudButton, makeLabel, makePaperChip, makeSlicedButton, makeStatPill } from '@/utils/ui';
import { Platform } from '@/core/PlatformService';
import { TweenManager, Ease } from '@/core/TweenManager';
import { applyFit, fitCover, fitSpriteInBox, fitWidthBottom, gameTexture, isTextureFailed, isTextureReady, itemLookTexture, itemTexture, whenTextureReady } from '@/utils/assets';
import type { Scene } from '@/core/SceneManager';
import type { ExtractResult } from '@/sim';

const REVEAL_FACE = 188;
const REVEAL_POP = 0.14;
const REVEAL_FLY = 0.26;
const REVEAL_LAND = 0.08;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const GOD_FISH = 'subpkg_images/wild_yellowfish.png';

export class MarketScene implements Scene {
  readonly name = 'market';
  readonly container = new PIXI.Container();
  private _bg = new PIXI.Container();
  private _hud = new PIXI.Container();
  private _body = new PIXI.Container();
  private _basket = new BasketPanel();
  private _result = new ResultPanel();
  private _onRun = () => this._sync();
  private _onExtract = (result: ExtractResult) => this._result.open(result);
  private _bodyKey = '';
  private _timerText: PIXI.Text | null = null;
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

  constructor() {
    this.container.addChild(this._bg);
    this.container.addChild(this._body);
    this.container.addChild(this._revealLayer);
    this.container.addChild(this._hud);
    this.container.addChild(this._godLayer);
    this.container.eventMode = 'static';
  }

  onEnter(): void {
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    EventBus.on(EV.runChanged, this._onRun);
    EventBus.on(EV.runExtracted, this._onExtract);
    this._bodyKey = '';
    this._crateMax = {};
    this._walking = false;
    this._body.alpha = 1;
    this._shownEvent = RunManager.run?.lastEvent?.nodeId ?? '';
    this._sync(true);
    ensureRecipeUnlockPanel().present();
  }

  onExit(): void {
    EventBus.off(EV.runChanged, this._onRun);
    EventBus.off(EV.runExtracted, this._onExtract);
    this._walking = false;
    this._mapView = null;
    this._body.alpha = 1;
    this._clearReveal();
    this._clearGodPick();
    this._basket.close();
    this._event.close();
  }

  relayout(): void {
    this._sync(true);
  }

  private _sync(force = false): void {
    if (this._walking) return;
    if (this._godPlaying) {
      this._drawHud();
      return;
    }
    const run = RunManager.run;
    this._drawHud();
    if (!run) {
      if (force || this._bodyKey !== 'empty') {
        this._bodyKey = 'empty';
        this._body.removeChildren();
        this._bg.removeChildren();
        const empty = makeLabel('本局已结束', 32, 0xC9B8A4);
        empty.position.set(32, Game.safeTop + 40);
        this._body.addChild(empty);
      }
      return;
    }
    const key = this._pileKey();
    if (force || key !== this._bodyKey) {
      this._bodyKey = key;
      this._body.removeChildren();
      this._mapView = null;
      if (run.mode === 'map') this._drawMap(Game.designWidth);
      else if (run.mode === 'play') this._drawPlay(Game.designWidth, Game.logicHeight);
      else this._drawRummage(Game.designWidth, Game.logicHeight);
    }
  }

  private _pileKey(): string {
    const run = RunManager.run;
    if (!run) return 'empty';
    if (run.mode === 'rummage' && run.currentNodeId) {
      const pile = (run.piles[run.currentNodeId] ?? [])
        .map((it) => `${it.uid}:${it.drawn?1:0}${it.revealed?1:0}${it.inspected?1:0}${it.washed?1:0}`)
        .join(',');
      return `rummage|${run.currentNodeId}|${pile}`;
    }
    if (run.mode === 'play' && run.play?.type === 'gather') {
      const spots = run.play.spots.map((s) => `${s.uid}:${s.taken ? 1 : 0}`).join(',');
      return `play|${run.play.nodeId}|${run.play.picksLeft}|${spots}`;
    }
    return `map|${run.sceneId}|${run.atNodeId ?? '-'}|${run.stepsLeft}|${run.options.join(',')}|${run.peeked.length}|${run.note}`;
  }

  private _drawHud(): void {
    this._hud.removeChildren();
    const run = RunManager.run;
    const w = Game.designWidth;
    if (!run) {
      this._timerText = null;
      return;
    }

    const y = Game.safeTop + 6;
    const redraw = () => {
      if (this.container.parent) this._drawHud();
    };
    const dusk = makeStatPill({
      icon: HUD_ICON.clock,
      text: `天色 ${run.stepsLeft}`,
      width: 148,
      fill: run.stepsLeft / Math.max(1, run.stepsMax),
      fillColor: run.stepsLeft <= 2 ? 0xE07A5F : 0xE0A100,
      onIconReady: redraw,
    });
    dusk.position.set(14, y);
    this._hud.addChild(dusk);
    this._timerText = dusk.children.find((c) => c instanceof PIXI.Text) as PIXI.Text;

    const midPill = makeStatPill({
      icon: HUD_ICON.coin,
      text: `${KitchenManager.save.money}`,
      width: 168,
      onIconReady: redraw,
    });
    midPill.position.set(168, y);
    this._hud.addChild(midPill);

    const room = KitchenManager.fridgeRoom();
    const bag = RunManager.basket.items;
    const bagN = bag.length;
    const bagNeed = KitchenManager.fridgeSlotsNeeded(bag);
    const bagWet = bag.filter((it) => {
      try {
        return getItem(it.defId).zone === 'wet';
      } catch {
        return false;
      }
    }).length;
    const ice = makeStatPill({
      icon: HUD_ICON.fridge,
      text: room > 0 ? `空${room}` : '满',
      width: 118,
      ...(bagNeed > room ? { fill: 1, fillColor: 0xE07A5F } : {}),
      onIconReady: redraw,
    });
    ice.position.set(342, y);
    this._hud.addChild(ice);

    this._basketBtn = makeStatPill({
      icon: HUD_ICON.basket,
      text: `干${bagN - bagWet}湿${bagWet}`,
      width: 124,
      ...(bagNeed > room ? { fill: 1, fillColor: 0xE07A5F } : {}),
      onIconReady: redraw,
    });
    this._basketBtn.eventMode = 'static';
    this._basketBtn.cursor = 'pointer';
    this._basketBtn.hitArea = new PIXI.Rectangle(0, 0, 124, 44);
    this._basketBtn.position.set(466, y);
    this._basketBtn.on('pointertap', () => this._basket.open());
    this._hud.addChild(this._basketBtn);

    const leave = makeHudButton('回家', 132, 44, 0xC46A3A);
    leave.position.set(w - 146, y);
    leave.on('pointertap', () => RunManager.extract(true));
    this._hud.addChild(leave);
  }

  /** 卡片路线：脚下一排能点，前方两排只看。走左边就够不着最右边。 */
  private _drawMap(w: number): void {
    const run = RunManager.run!;
    const h = Game.logicHeight;
    const art = MARKET_ART[run.marketId];
    this._paintScene(sceneBg(run.marketId, run.sceneId) || art.routeBg, 'cover');

    const sceneName = sceneTitle(run.marketId, run.sceneId);
    const marketName = sceneName || getMarket(run.marketId).name;
    const seg = run.visited.length ? ` · 走过 ${run.visited.length} 段` : '';
    const title = makePaperChip(`${marketName}${seg}`, { size: 22 });
    title.position.set(20, Game.safeTop + 58);
    this._body.addChild(title);

    const note = makeLabel(run.note, 20, 0xF4EFE6, {
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: w - 80,
    });
    const noteBg = new PIXI.Graphics();
    fillRect(noteBg, 20, Game.safeTop + 106, Math.min(w - 40, note.width + 32), note.height + 20, 0x2A2018, 12);
    noteBg.alpha = 0.66;
    note.position.set(36, Game.safeTop + 116);
    this._body.addChild(noteBg);
    this._body.addChild(note);

    const redraw = () => {
      if (this.container.parent) this._sync(true);
    };
    // 当前那排落在居中稍靠下，下方留出的路面是走路过渡的去处
    const cardsBottom = Math.round(h * 0.72);
    const blocked = RunManager.allBlocked();
    const view = layoutRouteMap({
      rows: RunManager.routeRows(3),
      viewWidth: w,
      top: Game.safeTop + 162,
      bottom: cardsBottom,
      onPick: (id) => this._walkTo(id),
      showRoot: !blocked,
      atlas: art.cardAtlas,
      meatCard: art.meatCard,
      onReady: redraw,
    });
    this._mapView = view;
    this._body.addChild(view.root);

    if (blocked) {
      const bypass = makeSlicedButton({
        label: '都进不去 · 绕过去（耗 1 步）',
        width: 380,
        height: 58,
        skin: 'terracotta',
        onReady: redraw,
      });
      bypass.position.set(Math.round((w - 380) / 2), cardsBottom + 40);
      bypass.on('pointertap', () => this._walkBypass());
      this._body.addChild(bypass);
    }

    const tip = makePaperChip('走左边就够不着最右边 · 走进小路会换场景', { size: 17 });
    tip.position.set(Math.round((w - tip.width) / 2), h - 84);
    this._body.addChild(tip);
  }

  /** 点卡不立刻结算：先演一段往前走，脚下的卡迎面掠过，后排下移接位。 */
  private _walkTo(nodeId: string): void {
    if (this._walking) return;
    const run = RunManager.run;
    const view = this._mapView;
    if (!run || !view?.rows.length) {
      RunManager.enterNode(nodeId);
      return;
    }
    const picked = view.rows[0].find((c) => c.option.node.id === nodeId);
    if (!picked) {
      RunManager.enterNode(nodeId);
      return;
    }
    this._walkForward(picked.option.node.next, picked, () => {
      RunManager.enterNode(nodeId);
      this._afterStep();
    });
  }

  /** 绕过去也是走一步：新的一排就是当前所有卡的下一层，动画照用。 */
  private _walkBypass(): void {
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

  /**
   * keepIds 是走完这步还留在路上的卡。它们顺着自己那条道下移放大接位，
   * 够不着的原地淡出——方向约束在动画里也说得清。
   */
  private _walkForward(keepIds: string[], picked: RouteCell | null, done: () => void): void {
    const run = RunManager.run!;
    const view = this._mapView!;
    this._walking = true;
    const dur = 0.34;

    TweenManager.to({ target: view.links, props: { alpha: 0 }, duration: dur * 0.6 });

    view.rows[0].forEach((cell) => {
      const chosen = cell === picked;
      // 进摊的卡放得更大，像整个人钻进摊子里
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

    // 单独一条空 tween 收尾，免得挂在某张卡上被销毁带走
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

  /** 走完一步：对话弹窗，白捡直接把菜弹出来飞进顶栏篮子。 */
  private _afterStep(): void {
    const run = RunManager.run;
    const ev = run?.lastEvent;
    if (!run || run.ended || !ev || ev.nodeId === this._shownEvent) return;
    this._shownEvent = ev.nodeId;
    if (ev.gain) this._popFreebie(ev);
    else if (ev.kind === 'recipe' && KitchenManager.peekRecipeUnlock()) ensureRecipeUnlockPanel().present();
    else if (ev.choices?.length) {
      this._event.open(ev, (index) => {
        if (!RunManager.chooseTalk(index)) return false;
        const after = RunManager.run?.lastEvent;
        if (after?.gain) this._popFreebie(after);
      });
    }
    else this._event.open(ev);
  }

  /**
   * 白捡不走面板：菜从路中间冒出来，停一下，再飞进顶栏篮子。
   * 篮子满了就灰掉淡出，不硬塞。
   */
  private _popFreebie(ev: RunEventLog): void {
    const gain = ev.gain;
    if (!gain) return;
    const path = `subpkg_images/${gain.defId}.png`;
    whenTextureReady(path, () => {
      if (RunManager.run?.lastEvent?.nodeId === ev.nodeId) this._popFreebie(ev);
    });
    const tex = itemTexture(gain.defId);
    if (!isTextureReady(tex)) return;

    const wrap = new PIXI.Container();
    const glow = new PIXI.Graphics();
    glow.beginFill(0xF4EFE6, 0.3);
    glow.drawCircle(0, 0, 110);
    glow.endFill();
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    fitSpriteInBox(sprite, 220, 220);
    if (!gain.taken) sprite.tint = 0x9A9086;
    const name = makeLabel(displayName(gain.defId, false, gain.quality), 26, 0xFFF8F0, {
      fontWeight: '700',
      dropShadow: true,
      dropShadowColor: 0x2A2018,
      dropShadowDistance: 2,
      dropShadowBlur: 3,
      dropShadowAlpha: 0.7,
    });
    name.anchor.set(0.5, 0);
    name.position.set(0, 118);
    wrap.addChild(glow, sprite, name);
    wrap.position.set(Game.designWidth / 2, Math.round(Game.logicHeight * 0.46));
    wrap.scale.set(0.2);
    wrap.alpha = 0;
    this._revealLayer.addChild(wrap);

    const land = this._basketBtn
      ? {
        x: this._basketBtn.x + 62,
        y: this._basketBtn.y + 22,
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
          Platform.showToast('篮子满了，拖开点位子再捡');
          const lootUid = RunManager.pendingLoot[0]?.uid;
          if (lootUid) this._basket.open(lootUid);
          TweenManager.to({
            target: wrap,
            props: { alpha: 0, y: wrap.y + 24 },
            duration: 0.28,
            delay: 0.35,
            onComplete: () => {
              if (wrap.parent) wrap.parent.removeChild(wrap);
            },
          });
          return;
        }
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
            if (wrap.parent) wrap.parent.removeChild(wrap);
          },
        });
      },
    });
  }

  /** 山洞采菌：石壁上看得见的菌，点一下摘一朵，限次数。 */
  private _drawPlay(w: number, h: number): void {
    const run = RunManager.run!;
    const play = run.play;
    if (!play || play.type !== 'gather') {
      this._paintScene(sceneBg(run.marketId, run.sceneId), 'cover');
      const back = makeHudButton('回路线', 140, 44, 0xEFE6D6, 0x3A3228);
      back.position.set(16, Game.safeTop + 58);
      back.on('pointertap', () => RunManager.leavePlay());
      this._body.addChild(back);
      return;
    }

    const caveWall = `subpkg_images/stall_rummage_${run.marketId}_cave.jpg`;
    whenTextureReady(caveWall, () => {
      if (this.container.parent) this._sync(true);
    });
    this._paintScene(
      isTextureFailed(caveWall) ? sceneBg(run.marketId, run.sceneId) : caveWall,
      'cover',
    );

    const back = makeHudButton('回路线', 140, 44, 0xEFE6D6, 0x3A3228);
    back.position.set(16, Game.safeTop + 58);
    back.on('pointertap', () => RunManager.leavePlay());
    this._body.addChild(back);

    const node = run.map.nodes[play.nodeId];
    const name = makePaperChip(node?.title || '石壁菌子', { size: 24 });
    name.position.set(168, Game.safeTop + 58);
    this._body.addChild(name);

    const tip = makePaperChip(
      play.picksLeft > 0 ? `点菌摘下来 · 还能摘 ${play.picksLeft} 朵` : '手上摘够了，可以出洞',
      { size: 18 },
    );
    tip.position.set(16, Game.safeTop + 110);
    this._body.addChild(tip);

    play.spots.forEach((spot) => {
      if (spot.taken) return;
      const path = `subpkg_images/${spot.defId}.png`;
      whenTextureReady(path, () => {
        if (this.container.parent) this._sync(true);
      });
      const tex = itemTexture(spot.defId);
      const x = Math.round(w * spot.x);
      const y = Math.round(h * spot.y);
      const wrap = new PIXI.Container();
      wrap.position.set(x, y);
      wrap.eventMode = 'static';
      wrap.cursor = play.picksLeft > 0 ? 'pointer' : 'default';
      wrap.hitArea = new PIXI.Rectangle(-56, -56, 112, 112);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        fitSpriteInBox(sp, 110, 110);
        wrap.addChild(sp);
      } else {
        const fallback = new PIXI.Graphics();
        fallback.beginFill(0x6B4A32);
        fallback.drawCircle(0, 0, 28);
        fallback.endFill();
        wrap.addChild(fallback);
      }
      wrap.on('pointertap', () => {
        if (play.picksLeft <= 0) {
          Platform.showToast('手上摘够了');
          return;
        }
        const result = RunManager.pickGather(spot.uid);
        const ev = RunManager.run?.lastEvent;
        if (ev?.gain) this._popFreebie(ev);
        if (result === 'need_space') this._basket.open();
      });
      this._body.addChild(wrap);
    });
  }

  private _drawRummage(w: number, h: number): void {
    const run = RunManager.run!;
    const nodeId = run.currentNodeId!;
    const node = run.map.nodes[nodeId];
    const enc = nodeEncounter(node);
    const specialty = enc.type === 'rummage' ? enc.specialty : undefined;
    const stallId = (enc.type === 'rummage' && enc.stall) || node.stall;
    const stall = stallId ? STALLS.find((s) => s.id === stallId) : undefined;
    const spec = specialty ? getSpecialty(specialty) : undefined;
    const preloadIds = spec
      ? [...spec.common, ...spec.rare, ...spec.epic]
      : stallId
        ? itemsForStall(stallId).map((def) => def.id)
        : [];
    preloadIds.forEach((id) => {
      gameTexture(`subpkg_images/${id}.png`);
      gameTexture(`subpkg_images/${id}_rotten.png`);
    });
    if (stallId === 'fish') gameTexture(GOD_FISH);
    this._paintScene(stallRummageArt(run.marketId, stallId, specialty), 'cover');

    const back = makeHudButton('回路线', 140, 44, 0xEFE6D6, 0x3A3228);
    back.position.set(16, Game.safeTop + 58);
    back.on('pointertap', () => RunManager.leaveStall());
    this._body.addChild(back);

    const name = makePaperChip(rummageTitle(node) || stall?.name || node.title || '摊', { size: 24 });
    name.position.set(168, Game.safeTop + 58);
    this._body.addChild(name);

    const tip = makePaperChip('连点遮挡堆抽取 · 点桌上的菜入篮', { size: 18 });
    tip.position.set(16, Game.safeTop + 110);
    this._body.addChild(tip);

    const table = {
      x: 24,
      y: Math.round(h * 0.26),
      w: w - 48,
      h: 280,
    };
    this._stackPos = { x: Math.round(w * 0.5), y: Math.round(h * 0.60) };
    this._body.addChild(this._stallPile(nodeId, stallId, this._stackPos.x, this._stackPos.y, specialty));

    const placed = this._packPile(RunManager.currentPile(), table);
    placed.forEach((slot) => {
      const token = this._pileToken(slot.item, slot.x, slot.y, slot.w, slot.h);
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
    whenTextureReady(path, () => {
      if (this.container.parent) this._sync(true);
    });
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
      const tag = makeLabel(`点遮挡堆抽取  ${left}`, 24, 0xFFF8F0);
      tag.anchor.set(0.5);
      const tagY = cy + (boxH * ratio) * 0.42 + 8;
      const tagBg = new PIXI.Graphics();
      fillRect(tagBg, cx - 150, tagY - 23, 300, 46, 0x2A2018, 12);
      tagBg.alpha = 0.72;
      tag.position.set(cx, tagY);
      root.addChild(tagBg);
      root.addChild(tag);
    }
    const hit = Math.max(120, boxW * Math.max(ratio, 0.28));
    root.eventMode = 'static';
    root.cursor = left > 0 ? 'pointer' : 'default';
    root.hitArea = new PIXI.Rectangle(cx - hit / 2, cy - hit / 2, hit, hit + 36);
    root.on('pointertap', () => this._drawOne());
    return root;
  }

  private _drawOne(): void {
    const crate = RunManager.crateLeft();
    if (!crate.length) {
      RunManager.drawFromCrate();
      return;
    }
    const pick = crate[Math.floor(Math.random() * crate.length)];
    if (this._flying.has(pick.uid)) return;
    this._flying.set(pick.uid, { playing: false, wrap: null, token: null });
    this._pileKick += 1;
    RunManager.drawFromCrate(pick.uid);
  }

  private _playDrawReveal(
    item: PileItem,
    slot: { x: number; y: number; w: number; h: number },
  ): void {
    const flight = this._flying.get(item.uid);
    if (!flight) return;
    const defId = visibleDefId(item);
    const look = item.quality === 'rotten' ? 'rotten' : 'clean';
    const lookPath = look === 'clean' ? `subpkg_images/${defId}.png` : `subpkg_images/${defId}_${look}.png`;
    const sprite = new PIXI.Sprite(itemLookTexture(defId, look));
    if (look === 'rotten' && !isTextureReady(gameTexture(`subpkg_images/${defId}_rotten.png`))) sprite.tint = 0x6B4A32;
    sprite.anchor.set(0.5);
    if (!isTextureReady(sprite.texture)) {
      if (isTextureFailed(lookPath)) {
        this._landFlight(item.uid);
        return;
      }
      whenTextureReady(lookPath, () => {
        if (this._flying.get(item.uid)?.playing) this._playDrawReveal(item, slot);
      });
      return;
    }
    if (flight.wrap) return;

    const glow = new PIXI.Graphics();
    glow.beginFill(0xF4EFE6, 0.28);
    glow.drawCircle(0, 0, 96);
    glow.endFill();
    glow.alpha = 0;

    fitSpriteInBox(sprite, REVEAL_FACE, REVEAL_FACE);
    const tableScale = Math.min(slot.w / REVEAL_FACE, slot.h / REVEAL_FACE) * 0.92;
    const index = Math.max(0, this._flying.size - 1);
    const startX = this._stackPos.x + index * 16;
    const startY = this._stackPos.y - index * 22;

    const wrap = new PIXI.Container();
    wrap.addChild(glow);
    wrap.addChild(sprite);
    wrap.position.set(startX, startY);
    wrap.scale.set(0.22);
    this._revealLayer.addChild(wrap);
    flight.wrap = wrap;

    const name = makeLabel(
      displayName(defId, item.inspected, item.quality === 'god' ? 'common' : item.quality),
      22,
      item.quality === 'rotten' ? 0xE07A5F : 0xFFF8F0,
      { fontWeight: '700' },
    );
    name.anchor.set(0.5, 1);
    name.alpha = 0;
    name.position.set(0, -REVEAL_FACE * 0.48);
    wrap.addChild(name);

    const landX = slot.x + slot.w / 2;
    const landY = slot.y + slot.h / 2;
    const finish = () => this._landFlight(item.uid);

    TweenManager.to({ target: glow, props: { alpha: 1 }, duration: 0.1 });
    TweenManager.to({ target: name, props: { alpha: 1 }, duration: 0.1 });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: REVEAL_POP,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({ target: glow, props: { alpha: 0 }, duration: 0.16 });
        TweenManager.to({ target: name, props: { alpha: 0 }, duration: 0.16 });
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
      TweenManager.cancelTarget(flight.wrap);
      TweenManager.cancelTarget(flight.wrap.scale);
      flight.wrap.children.forEach((child) => TweenManager.cancelTarget(child));
      if (flight.wrap.parent) flight.wrap.parent.removeChild(flight.wrap);
    }
    if (flight.token && !flight.token.destroyed) flight.token.alpha = 1;
    this._flying.delete(uid);
  }

  private _clearReveal(): void {
    [...this._flying.keys()].forEach((uid) => this._landFlight(uid));
    this._revealLayer.removeChildren();
    this._pileKick = 0;
  }

  private _paintScene(path: string, mode: 'bottom' | 'cover' = 'bottom'): void {
    this._bg.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, 0x3A3228);
    this._bg.addChild(fallback);
    const tex = gameTexture(path);
    whenTextureReady(path, () => {
      if (this.container.parent) this._sync(true);
    });
    if (isTextureReady(tex)) {
      const scene = new PIXI.Sprite(tex);
      const fit = mode === 'cover'
        ? fitCover(tex.width, tex.height, w, h)
        : fitWidthBottom(tex.width, tex.height, w, h);
      applyFit(scene, fit);
      this._bg.addChild(scene);
    }
  }

  private _packPile(
    pile: PileItem[],
    table: { x: number; y: number; w: number; h: number },
  ): Array<{ item: PileItem; x: number; y: number; w: number; h: number }> {
    const unit = Math.min(112, Math.floor(table.w / 5.4));
    let cx = table.x;
    let cy = table.y;
    let rowH = 0;
    const out: Array<{ item: PileItem; x: number; y: number; w: number; h: number }> = [];
    for (const item of pile) {
      const def = getItem(visibleDefId(item));
      const tw = Math.max(unit, def.w * unit);
      const th = Math.max(unit, def.h * unit);
      if (cx + tw > table.x + table.w && cx > table.x) {
        cx = table.x;
        cy += rowH + 16;
        rowH = 0;
      }
      out.push({ item, x: cx, y: cy, w: tw, h: th });
      cx += tw + 14;
      rowH = Math.max(rowH, th);
    }
    return out;
  }

  private _pileToken(
    item: PileItem,
    x: number,
    y: number,
    tw: number,
    th: number,
  ): PIXI.Container {
    const def = getItem(visibleDefId(item));
    const root = new PIXI.Container();
    root.position.set(x, y);

    // 摊上只给蓝紫货描边，绿货全描一遍会把整张桌子变成彩灯
    if (def.rarity !== 'common') {
      const halo = new PIXI.Graphics();
      halo.beginFill(RARITY_STYLE[def.rarity].glow, 0.16);
      halo.drawRoundedRect(2, 2, tw - 4, th - 4, 14);
      halo.endFill();
      drawRarityFrame(halo, 2, 2, tw - 4, th - 4, def.rarity, { radius: 14 });
      halo.eventMode = 'none';
      root.addChild(halo);
    }

    const look = item.quality === 'rotten' ? 'rotten' : 'clean';
    const icon = new PIXI.Sprite(itemLookTexture(visibleDefId(item), look));
    whenTextureReady(`subpkg_images/${visibleDefId(item)}${look === 'clean' ? '' : `_${look}`}.png`, () => {
      if (this.container.parent) this._sync(true);
    });
    fitSpriteInBox(icon, tw * 0.92, th * 0.92);
    icon.anchor.set(0.5);
    icon.position.set(tw / 2, th / 2);
    if (look === 'rotten' && !isTextureReady(gameTexture(`subpkg_images/${def.id}_rotten.png`))) icon.tint = 0x6B4A32;
    root.addChild(icon);
    const tag = makeLabel(RunManager.labelFor(item), 16, item.quality === 'rotten' ? 0xE07A5F : 0xFFF8F0);
    tag.anchor.set(0.5, 1);
    tag.position.set(tw / 2, th - 2);
    root.addChild(tag);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, tw, th);
    root.on('pointertap', () => this._takeItem(item.uid));
    return root;
  }

  private _takeItem(uid: string): void {
    const item = this._findPile(uid);
    if (item?.defId === GOD_PICK.id && !item.inspected) {
      this._playGodPick(uid);
      return;
    }
    const result = RunManager.take(uid);
    if (result === 'rotten') Platform.showToast('坏了，捡不了');
    if (result === 'need_space') this._basket.open(uid);
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

    const glow = new PIXI.Graphics();
    glow.beginFill(0xF4C430, 0.28);
    glow.drawCircle(0, 16, 168);
    glow.endFill();
    glow.beginFill(0xFFF8F0, 0.16);
    glow.drawCircle(0, 16, 108);
    glow.endFill();
    wrap.addChild(glow);

    const fish = new PIXI.Sprite(tex);
    fish.anchor.set(0.5);
    fitSpriteInBox(fish, 340, 280);
    fish.position.set(0, 28);
    wrap.addChild(fish);

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

    const land = this._basketBtn
      ? { x: this._basketBtn.x + 62, y: this._basketBtn.y + 22 }
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
            finish(result === 'need_space');
          },
        });
      },
    });
  }

  private _clearGodPick(): void {
    this._godLayer.children.forEach((child) => {
      TweenManager.cancelTarget(child);
      if ('scale' in child) TweenManager.cancelTarget((child as PIXI.Container).scale);
      if (child instanceof PIXI.Container) {
        child.children.forEach((grand) => TweenManager.cancelTarget(grand));
      }
    });
    this._godLayer.removeChildren();
    this._godPlaying = false;
  }

  private _findPile(uid: string): PileItem | undefined {
    return RunManager.currentPile().find((it) => it.uid === uid)
      ?? (RunManager.run
        ? (Object.values(RunManager.run.piles) as PileItem[][]).flat().find((it) => it.uid === uid)
        : undefined);
  }
}
