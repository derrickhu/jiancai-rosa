import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { RunManager } from '@/managers/RunManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { BasketPanel } from '@/gameobjects/ui/BasketPanel';
import { ResultPanel } from '@/gameobjects/ui/ResultPanel';
import {
  PACK_FULL,
  STALL_FEE,
  stallPacked,
  STALLS,
  displayName,
  getItem,
  itemsForStall,
  visibleDefId,
  type PileItem,
  type StallId,
  getMarket,
} from '@/sim';
import { HUD_ICON, fillRect, makeHudButton, makeLabel, makePaperChip, makeStatPill } from '@/utils/ui';
import { Platform } from '@/core/PlatformService';
import { TweenManager, Ease } from '@/core/TweenManager';
import { applyFit, fitCover, fitSpriteInBox, fitWidthBottom, gameTexture, isTextureFailed, isTextureReady, itemLookTexture, mapNorm, whenTextureReady } from '@/utils/assets';
import type { Scene } from '@/core/SceneManager';
import type { ExtractResult } from '@/sim';

const HOLD_SEC = 0.45;
const REVEAL_FACE = 188;
const REVEAL_POP = 0.14;
const REVEAL_FLY = 0.26;
const REVEAL_LAND = 0.08;

const STALL_HOTSPOTS: Record<StallId, { nx: number; ny: number; nw: number; nh: number }> = {
  leaf: { nx: 0.00, ny: 0.58, nw: 0.40, nh: 0.34 },
  egg: { nx: 0.03, ny: 0.24, nw: 0.42, nh: 0.32 },
  root: { nx: 0.58, ny: 0.56, nw: 0.40, nh: 0.36 },
  fish: { nx: 0.50, ny: 0.34, nw: 0.46, nh: 0.22 },
};

const STALL_BG: Record<StallId, string> = {
  leaf: 'subpkg_images/stall_rummage_leaf.jpg',
  root: 'subpkg_images/stall_rummage_root.jpg',
  egg: 'subpkg_images/stall_rummage_egg.jpg',
  fish: 'subpkg_images/stall_rummage_fish.jpg',
};

const STALL_PILE: Record<StallId, string> = {
  leaf: 'subpkg_images/stall_pile_leaf.png',
  root: 'subpkg_images/stall_pile_root.png',
  egg: 'subpkg_images/stall_pile_egg.png',
  fish: 'subpkg_images/stall_pile_fish.png',
};

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
  private _boundUpdate = () => this.update(Game.ticker.deltaMS / 1000);
  private _onUp = () => this._finishHold();
  private _bodyKey = '';
  private _hold: { uid: string; ms: number; done: boolean; x: number; y: number; w: number } | null = null;
  private _holdBar = new PIXI.Graphics();
  private _timerText: PIXI.Text | null = null;
  private _attFill: PIXI.Graphics | null = null;
  private _attText: PIXI.Text | null = null;
  private _basketBtn: PIXI.Container | null = null;
  private _revealLayer = new PIXI.Container();
  private _flying = new Map<string, { playing: boolean; wrap: PIXI.Container | null; token: PIXI.Container | null }>();
  private _pileKick = 0;
  private _stackPos = { x: 375, y: 800 };
  private _crateMax: Partial<Record<StallId, number>> = {};

  constructor() {
    this.container.addChild(this._bg);
    this.container.addChild(this._body);
    this.container.addChild(this._holdBar);
    this.container.addChild(this._revealLayer);
    this.container.addChild(this._hud);
    this.container.eventMode = 'static';
  }

  onEnter(): void {
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    EventBus.on(EV.runChanged, this._onRun);
    EventBus.on(EV.runExtracted, this._onExtract);
    Game.ticker.add(this._boundUpdate);
    this.container.on('pointerup', this._onUp);
    this.container.on('pointerupoutside', this._onUp);
    this._bodyKey = '';
    this._crateMax = {};
    this._sync(true);
  }

  onExit(): void {
    EventBus.off(EV.runChanged, this._onRun);
    EventBus.off(EV.runExtracted, this._onExtract);
    Game.ticker.remove(this._boundUpdate);
    this.container.off('pointerup', this._onUp);
    this.container.off('pointerupoutside', this._onUp);
    this._hold = null;
    this._clearReveal();
    this._basket.close();
  }

  update(dt: number): void {
    if (this._result._isOpen) return;
    if (this._hold) {
      this._hold.ms += dt;
      this._paintHoldBar();
      if (!this._hold.done && this._hold.ms >= HOLD_SEC) {
        this._hold.done = true;
        const item = this._findPile(this._hold.uid);
        if (item?.revealed && !item.inspected) RunManager.inspect(item.uid);
      }
    }
    RunManager.tick(dt);
  }

  relayout(): void {
    this._sync(true);
  }

  private _sync(force = false): void {
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
      if (run.mode === 'overview') this._drawOverview(Game.designWidth);
      else this._drawRummage(Game.designWidth, Game.logicHeight);
    }
  }

  private _pileKey(): string {
    const run = RunManager.run;
    if (!run) return 'empty';
    const stall = run.currentStall ?? '-';
    const pile = run.currentStall
      ? run.piles[run.currentStall].map((it) => `${it.uid}:${it.drawn?1:0}${it.revealed?1:0}${it.inspected?1:0}${it.washed?1:0}`).join(',')
      : Object.entries(run.piles).map(([id, list]) => `${id}:${list.filter((it) => !it.washed).length}`).join('|');
    return `${run.mode}|${stall}|${pile}`;
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
    const sec = Math.ceil(run.timeLeft);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toString().padStart(2, '0');
    const timer = makeStatPill({
      icon: HUD_ICON.clock,
      text: `${m}:${s}`,
      width: 148,
      fillColor: 0xE07A5F,
      fill: sec <= 10 ? 1 : undefined,
      onIconReady: redraw,
    });
    timer.position.set(14, y);
    this._hud.addChild(timer);
    this._timerText = timer.children.find((c) => c instanceof PIXI.Text) as PIXI.Text;

    const pack = run.currentStall ? run.packing[run.currentStall] : 0;
    const packPill = makeStatPill({
      text: run.currentStall ? `装箱 ${Math.floor(pack)}` : '收摊挑拣',
      width: 168,
      ...(pack > 0
        ? { fill: pack / PACK_FULL, fillColor: pack >= 80 ? 0xE07A5F : 0xE0A100 }
        : {}),
    });
    packPill.position.set(168, y);
    this._hud.addChild(packPill);
    this._attFill = null;
    this._attText = packPill.children.find((c) => c instanceof PIXI.Text) as PIXI.Text;

    const room = KitchenManager.fridgeRoom();
    const bag = RunManager.basket.items.length;
    const ice = makeStatPill({
      icon: HUD_ICON.fridge,
      text: room > 0 ? `空${room}` : '满',
      width: 118,
      ...(bag > room || room <= 0 ? { fill: 1, fillColor: 0xE07A5F } : {}),
      onIconReady: redraw,
    });
    ice.position.set(342, y);
    this._hud.addChild(ice);

    this._basketBtn = makeStatPill({
      icon: HUD_ICON.basket,
      text: `篮 ${bag}`,
      width: 124,
      ...(bag > room ? { fill: 1, fillColor: 0xE07A5F } : {}),
      onIconReady: redraw,
    });
    this._basketBtn.eventMode = 'static';
    this._basketBtn.cursor = 'pointer';
    this._basketBtn.hitArea = new PIXI.Rectangle(0, 0, 124, 44);
    this._basketBtn.position.set(466, y);
    this._basketBtn.on('pointerdown', () => this._cancelHold());
    this._basketBtn.on('pointertap', () => this._basket.open());
    this._hud.addChild(this._basketBtn);

    const leave = makeHudButton('回家', 132, 44, 0xC46A3A);
    leave.position.set(w - 146, y);
    leave.on('pointerdown', () => this._cancelHold());
    leave.on('pointertap', () => RunManager.extract(true));
    this._hud.addChild(leave);
  }

  private _drawOverview(w: number): void {
    this._paintScene('subpkg_images/market_overview.jpg');
    const tex = gameTexture('subpkg_images/market_overview.jpg');
    const h = Game.logicHeight;
    const marketName = RunManager.run ? getMarket(RunManager.run.marketId).name : '菜场';
    const title = makePaperChip(`${marketName} · 付钱买下剩货再挑`, { size: 22 });
    title.position.set(20, Game.safeTop + 58);
    this._body.addChild(title);

    const fit = isTextureReady(tex)
      ? fitWidthBottom(tex.width, tex.height, w, h)
      : fitWidthBottom(750, Math.max(h, 1334), w, h);

    STALLS.forEach((stall) => {
      const spot = STALL_HOTSPOTS[stall.id];
      const rect = mapNorm(fit, spot.nx, spot.ny, spot.nw, spot.nh);
      const left = RunManager.run!.piles[stall.id].filter((it) => !it.washed).length;
      const packed = stallPacked(RunManager.run!.packing, stall.id);
      const paid = RunManager.run!.paid.includes(stall.id);
      const fee = RunManager.run!.paid.length === 0 ? 0 : STALL_FEE[stall.id];
      const extra = packed ? '装完' : paid ? `剩${left}` : fee === 0 ? `免费  ${left}` : `${fee}金币  ${left}`;
      const root = new PIXI.Container();
      root.position.set(rect.x, rect.y);
      const hit = new PIXI.Graphics();
      hit.beginFill(0xffffff, isTextureReady(tex) ? 0.001 : 0.18);
      hit.drawRoundedRect(0, 0, rect.w, rect.h, 12);
      hit.endFill();
      root.addChild(hit);
      const tag = makeLabel(`${stall.name}  ${extra}`, 22, packed ? 0x7A6B5C : 0xFFF8F0);
      const tagBg = new PIXI.Graphics();
      fillRect(tagBg, 8, 8, Math.min(rect.w - 16, tag.width + 20), 36, 0x2A2018, 10);
      tagBg.alpha = 0.72;
      tag.position.set(18, 14);
      root.addChild(tagBg);
      root.addChild(tag);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(0, 0, rect.w, rect.h);
      root.on('pointertap', () => RunManager.openStall(stall.id));
      this._body.addChild(root);
    });
  }

  private _drawRummage(w: number, h: number): void {
    const stallId = RunManager.run!.currentStall as StallId;
    const stall = STALLS.find((s) => s.id === stallId);
    itemsForStall(stallId).forEach((def) => {
      gameTexture(`subpkg_images/${def.id}.png`);
      gameTexture(`subpkg_images/${def.id}_rotten.png`);
    });
    this._paintScene(STALL_BG[stallId] ?? 'subpkg_images/market_overview.jpg', 'cover');

    const back = makeHudButton('回市集', 140, 44, 0xEFE6D6, 0x3A3228);
    back.position.set(16, Game.safeTop + 58);
    back.on('pointerdown', () => this._cancelHold());
    back.on('pointertap', () => RunManager.backToOverview());
    this._body.addChild(back);

    const name = makePaperChip(stall?.name ?? '', { size: 24 });
    name.position.set(168, Game.safeTop + 58);
    this._body.addChild(name);

    const tip = makePaperChip('连点遮挡堆抽取 · 桌上入篮或按住看品质', { size: 18 });
    tip.position.set(16, Game.safeTop + 110);
    this._body.addChild(tip);

    const table = {
      x: 24,
      y: Math.round(h * 0.26),
      w: w - 48,
      h: 280,
    };
    this._stackPos = { x: Math.round(w * 0.5), y: Math.round(h * 0.60) };
    this._body.addChild(this._stallPile(stallId, this._stackPos.x, this._stackPos.y));

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

  private _stallPile(stallId: StallId, cx: number, cy: number): PIXI.Container {
    const root = new PIXI.Container();
    const left = RunManager.crateLeft().length;
    if (this._crateMax[stallId] == null) this._crateMax[stallId] = Math.max(left, 1);
    const max = this._crateMax[stallId] ?? 1;
    const ratio = left <= 0 ? 0 : left / max;
    const kick = this._pileKick;
    this._pileKick = 0;
    const fromRatio = left < max && kick > 0 ? Math.min(1, (left + kick) / max) : ratio;
    const path = STALL_PILE[stallId];
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
    root.on('pointerdown', () => this._cancelHold());
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

    const name = makeLabel(displayName(defId, false, item.quality), 22, 0xFFF8F0, { fontWeight: '700' });
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
    const tag = makeLabel(RunManager.labelFor(item), 16, item.quality === 'rotten' && item.inspected ? 0xE07A5F : 0xFFF8F0);
    tag.anchor.set(0.5, 1);
    tag.position.set(tw / 2, th - 2);
    root.addChild(tag);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, tw, th);
    root.on('pointerdown', (e) => {
      e.stopPropagation();
      this._hold = { uid: item.uid, ms: 0, done: false, x, y, w: tw };
      RunManager.interacting = true;
      this._paintHoldBar();
    });
    return root;
  }

  private _paintHoldBar(): void {
    this._holdBar.clear();
    if (!this._hold || this._hold.done) return;
    const t = Math.min(1, this._hold.ms / HOLD_SEC);
    this._holdBar.beginFill(0xE0A100, 0.9);
    this._holdBar.drawRoundedRect(this._hold.x + 8, this._hold.y + 8, (this._hold.w - 16) * t, 6, 3);
    this._holdBar.endFill();
  }

  private _finishHold(): void {
    const hold = this._hold;
    this._hold = null;
    this._holdBar.clear();
    RunManager.interacting = false;
    if (!hold || hold.done) return;
    const item = this._findPile(hold.uid);
    if (!item) return;
    const result = RunManager.take(item.uid);
    if (result === 'rotten') Platform.showToast('坏了，丢掉');
    if (result === 'need_space') this._basket.open(item.uid);
  }

  private _cancelHold(): void {
    this._hold = null;
    this._holdBar.clear();
    RunManager.interacting = false;
  }

  private _findPile(uid: string): PileItem | undefined {
    return RunManager.currentPile().find((it) => it.uid === uid)
      ?? (RunManager.run
        ? (Object.values(RunManager.run.piles) as PileItem[][]).flat().find((it) => it.uid === uid)
        : undefined);
  }
}
