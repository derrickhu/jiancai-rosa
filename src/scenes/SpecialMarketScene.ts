import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import {
  inspectFromFood,
  makeItemInspectCard,
  type ItemInspectView,
} from '@/gameobjects/ui/ItemInspectCard';
import { MarketLootPanel } from '@/gameobjects/ui/MarketLootPanel';
import { ResultPanel } from '@/gameobjects/ui/ResultPanel';
import { makeRaritySeal } from '@/gameobjects/ui/scenePanel';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import {
  SPECIAL_TIMING,
  buffIconPath,
  getItem,
  getSpecialMarket,
  itemRarity,
  liveHudBuffs,
  mulberry32,
  newSeed,
  rarityStyleOf,
  resolveRarityTier,
  resolveSpecialDrop,
  rngInt,
  specialLootIds,
  specialResultLine,
  toSpecialExtracted,
  type ExtractedItem,
  type Quality,
  type RarityTier,
  type SpecialFlavor,
  type SpecialMarketDef,
  type SpecialMarketId,
  type TimingGrade,
} from '@/sim';
import {
  applyFit,
  fitCover,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  resolveItemAssetPath,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';
import { destroyDisplayChildren, destroyDisplayNode, isStageMounted } from '@/utils/destroy';
import {
  HUD_ICON,
  attachSpriteContour,
  fillRect,
  fitTextWidth,
  makeMuteButton,
  makeNewFoodTag,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';

type Phase = 'idle' | 'telegraph' | 'hitWindow' | 'late' | 'resolve' | 'done';

const SPECIAL_ART = {
  plaque: 'subpkg_images/scene_pk_plaque.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  actionDrum: 'subpkg_images/special_action_drum.png',
  spiceTable: 'subpkg_images/special_spice_table.png',
  spiceJar: 'subpkg_images/special_spice_jar.png',
  spiceLid: 'subpkg_images/special_spice_jar_lid.png',
  spiceSteam: 'subpkg_images/special_spice_steam.png',
  fishRod: 'subpkg_images/special_fish_rod.png',
  fishBobber: 'subpkg_images/special_fish_bobber.png',
  fishSplash: 'subpkg_images/special_fish_splash.png',
  dryRaw: 'subpkg_images/special_dry_tray_raw.png',
  dryGold: 'subpkg_images/special_dry_tray_gold.png',
  fieldMound: 'subpkg_images/special_field_mound.png',
  fieldLantern: 'subpkg_images/special_field_lantern.png',
} as const;

const INK = 0x2A2018;
const DARK_STROKE = 0x221208;
const CORAL_MISS = 0xFF8A70;
const CREAM = 0xFFF8EC;
const JAR_NUMS = ['壹', '贰', '叁', '肆', '伍'] as const;

interface MergedHaulGroup {
  key: string;
  defId: string;
  quality: Quality;
  tier: RarityTier;
  qty: number;
  latestUid: string;
}

interface FireflySeed {
  bx: number;
  by: number;
  rx: number;
  ry: number;
  speed: number;
  phase: number;
  size: number;
}

function flavorOf(def: SpecialMarketDef): SpecialFlavor {
  if (def.id === 'field_night' || (def.flavor as string) === 'field') return 'field';
  return def.flavor;
}

function flavorProps(flavor: SpecialFlavor): string[] {
  if (flavor === 'spice') {
    return [SPECIAL_ART.spiceTable, SPECIAL_ART.spiceJar, SPECIAL_ART.spiceLid, SPECIAL_ART.spiceSteam];
  }
  if (flavor === 'fish') {
    return [SPECIAL_ART.fishRod, SPECIAL_ART.fishBobber, SPECIAL_ART.fishSplash];
  }
  if (flavor === 'field') {
    return [SPECIAL_ART.fieldMound, SPECIAL_ART.fieldLantern];
  }
  return [SPECIAL_ART.dryRaw, SPECIAL_ART.dryGold];
}

function waitCopyOf(flavor: SpecialFlavor): string {
  if (flavor === 'spice') return '屏息看热气…';
  if (flavor === 'fish') return '稳住看浮漂…';
  if (flavor === 'field') return '提灯寻熟菜…';
  return '竹匾翻晒中…';
}

function hitCopyOf(flavor: SpecialFlavor): string {
  if (flavor === 'spice') return '✦ 揭开陶罐！';
  if (flavor === 'fish') return '✦ 猛提鱼竿！';
  if (flavor === 'field') return '✦ 伸手摘菜！';
  return '✦ 收拢竹匾！';
}

export class SpecialMarketScene implements Scene {
  readonly name = 'specialMarket';
  readonly container = new PIXI.Container();
  private static _queued: SpecialMarketId | null = null;

  private _bg = new PIXI.Container();
  private _play = new PIXI.Container();
  private _hud = new PIXI.Container();
  private _fx = new PIXI.Container();
  private _inspectHost = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _loot = new MarketLootPanel();
  private _result = new ResultPanel();
  private _boundUpdate = () => this.update(Game.ticker.deltaMS / 1000);

  private _def: SpecialMarketDef | null = null;
  private _rng = mulberry32(1);
  private _round = 0;
  private _haul: ExtractedItem[] = [];
  private _flyingUid: string | null = null;
  private _haulSlots = new Map<string, { x: number; y: number; cell: PIXI.Container }>();

  private _phase: Phase = 'idle';
  private _phaseT = 0;
  private _phaseDur = 1;
  private _sceneT = 0;
  private _lastGrade: TimingGrade | null = null;

  private _hotJar = 2;
  private _hotMound = 0;
  private _lanternStart = { x: 354, y: 652 };
  private _fireflies: FireflySeed[] = [];

  private _actors: Record<string, PIXI.Container> = {};
  private _drumWrap: PIXI.Container | null = null;
  private _drumFace: PIXI.Container | null = null;
  private _drumBody: PIXI.DisplayObject | null = null;
  private _drumLabel: PIXI.Text | null = null;
  private _drumFlare: PIXI.DisplayObject | null = null;
  private _drumCharge: PIXI.Graphics | null = null;
  private _drumPressing = false;

  private _settled = false;
  private _enteredAt = 0;
  private _hitCount = 0;
  private _paintQueued = false;
  private _watched = new Set<string>();

  private _schedulePaint = (): void => {
    if (!this.container.parent || !this._def || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this.container.parent && this._def) this._paint();
    });
  };

  private _watchOnce(path: string): void {
    if (!path || isTextureReady(gameTexture(path)) || this._watched.has(path)) return;
    this._watched.add(path);
    whenTextureReady(path, () => {
      this._watched.delete(path);
      this._schedulePaint();
    });
  }

  static queue(id: SpecialMarketId): void {
    SpecialMarketScene._queued = id;
  }

  constructor() {
    this._play.sortableChildren = true;
    this._fx.eventMode = 'none';
    this.container.addChild(this._bg);
    this.container.addChild(this._play);
    this.container.addChild(this._hud);
    this.container.addChild(this._fx);
    this._inspectHost.zIndex = 27;
    this._inspectHost.visible = false;
    this.container.eventMode = 'static';
    this.container.on('pointertap', () => {
      if (this._inspect || this._loot._isOpen) return;
      this._pulseDrumTap();
      this._onTap();
    });
    this._hud.eventMode = 'passive';
  }

  onEnter(): void {
    const id = SpecialMarketScene._queued;
    if (!id) {
      SceneManager.switchTo('destinations');
      return;
    }
    this._def = getSpecialMarket(id);
    this._loot.close(true);
    this._inspect = null;
    this._paintQueued = false;
    this._flyingUid = null;
    this._lastGrade = null;
    this._haulSlots.clear();
    destroyDisplayChildren(this._fx);
    this._inspectHost.visible = false;
    OverlayManager.container.addChild(this._inspectHost);

    this._rng = mulberry32(newSeed());
    this._round = 0;
    this._haul = [];
    this._settled = false;
    this._enteredAt = Date.now();
    this._hitCount = 0;
    this._sceneT = 0;
    this._hotJar = 2;
    this._hotMound = 1;
    this._lanternStart = { x: Game.designWidth * 0.47, y: Math.round(Game.logicHeight * 0.465) };
    this._initFireflies();

    this._phase = 'idle';
    this._phaseT = 0;
    this._phaseDur = this._idleDur();

    const flavor = flavorOf(this._def);
    analytics.trackSpecialMarketStart({
      marketId: id,
      flavor: this._def.flavor,
      rounds: this._def.rounds,
      vehicleId: this._def.vehicle,
      cookLevel: KitchenManager.save.level,
    });
    AudioManager.playMarketBgm(this._def.bgmMarket);
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);

    watchTextures(
      [
        this._def.bg,
        SPECIAL_ART.plaque,
        SPECIAL_ART.seal,
        SPECIAL_ART.actionDrum,
        ...flavorProps(flavor),
        HUD_ICON.clock,
        HUD_ICON.basket,
        HUD_ICON.peek,
        ...specialLootIds(this._def).slice(0, 6).map((fid) => resolveItemAssetPath(fid)),
      ],
      this._schedulePaint,
    );

    Game.ticker.remove(this._boundUpdate);
    Game.ticker.add(this._boundUpdate);
    RunManager.saveSpecialCheckpoint(this._def.id, this._round, this._haul);
    this._paint();
  }

  onExit(): void {
    Game.ticker.remove(this._boundUpdate);
    this._paintQueued = false;
    this._flyingUid = null;
    this._haulSlots.clear();
    this._loot.close(true);
    destroyDisplayChildren(this._bg);
    destroyDisplayChildren(this._play);
    destroyDisplayChildren(this._hud);
    destroyDisplayChildren(this._fx);
    this._inspect = null;
    this._inspectHost.visible = false;
    destroyDisplayChildren(this._inspectHost);
    if (this._inspectHost.parent) this._inspectHost.parent.removeChild(this._inspectHost);
    this._actors = {};
    this._resetDrumRefs();
  }

  relayout(): void {
    if (!this._def) return;
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    this._paint();
    if (this._loot._isOpen) this._loot.relayout();
  }

  update(dt: number): void {
    if (!this._def || this._phase === 'done' || this._inspect || this._loot._isOpen) return;
    this._sceneT += dt;
    this._phaseT += dt;
    if (this._phaseT >= this._phaseDur) {
      this._advance();
    }
    this._tickActors();
  }

  private _resetDrumRefs(): void {
    this._drumWrap = null;
    this._drumFace = null;
    this._drumBody = null;
    this._drumLabel = null;
    this._drumFlare = null;
    this._drumCharge = null;
    this._drumPressing = false;
  }

  private _initFireflies(): void {
    this._fireflies = [];
    for (let i = 0; i < 8; i++) {
      this._fireflies.push({
        bx: 84 + ((i * 83) % 580),
        by: 270 + ((i * 119) % 540),
        rx: 22 + (i % 3) * 14,
        ry: 14 + ((i + 1) % 3) * 10,
        speed: 0.75 + (i % 4) * 0.24,
        phase: i * 1.17,
        size: 3.2 + (i % 3) * 1.1,
      });
    }
  }

  private _paint(): void {
    const def = this._def;
    if (!def) return;
    this._drawBg(def);
    this._drawPlay(def);
    this._drawHud(def);
    this._paintInspect();
    this._tickActors();
  }

  private _paintInspect(): void {
    destroyDisplayChildren(this._inspectHost);
    if (!this._inspect) {
      this._inspectHost.visible = false;
      return;
    }
    this._inspectHost.visible = true;
    OverlayManager.bringToFront();
    this._inspectHost.addChild(makeItemInspectCard({
      view: this._inspect,
      qty: 1,
      actions: false,
      onQty: () => {},
      onReady: () => {
        if (this.container.parent && this._inspect) this._paintInspect();
      },
      onClose: () => {
        AudioManager.play('ui_close');
        this._inspect = null;
        this._inspectHost.visible = false;
        destroyDisplayChildren(this._inspectHost);
      },
    }));
  }

  private _drawBg(def: SpecialMarketDef): void {
    destroyDisplayChildren(this._bg);
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const flavor = flavorOf(def);
    const fallback = new PIXI.Graphics();
    fillRect(
      fallback,
      0,
      0,
      w,
      h,
      flavor === 'fish' ? 0x1A3040 : flavor === 'dry' ? 0x3A2A1C : flavor === 'field' ? 0x18261E : 0x241820,
    );
    this._bg.addChild(fallback);
    this._watchOnce(def.bg);
    const tex = gameTexture(def.bg);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      const fit = fitCover(tex.width, tex.height, w, h);
      applyFit(sp, fit);
      sp.position.set(fit.x, fit.y);
      this._bg.addChild(sp);
    }
    // 仅在顶栏与最底端做极轻暗角衬字，将中央 750px+ 黄金视野通透还给原画场景
    const topShade = new PIXI.Graphics();
    topShade.beginFill(0x100804, 0.22);
    topShade.drawRect(0, 0, w, 176);
    topShade.endFill();
    topShade.beginFill(0x100804, 0.26);
    topShade.drawRect(0, h - 220, w, 220);
    topShade.endFill();
    this._bg.addChild(topShade);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 顶部紧凑 HUD（严格压缩在 top ~ top + 114 内）+ 鲜货图鉴入口 + 底部无盘合并竹篓
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawHud(def: SpecialMarketDef): void {
    destroyDisplayChildren(this._hud);
    const w = Game.designWidth;
    const top = Math.max(48, Number.isFinite(Game.safeTop) ? Game.safeTop : 88);
    const onReady = this._schedulePaint;

    // 1. 顶部居中悬挂木匾招牌（高压缩，底边落在 top + 72 以内）
    const pw = 276;
    const plaqueWrap = new PIXI.Container();
    plaqueWrap.position.set(Math.round((w - pw) / 2), top - 44);
    plaqueWrap.eventMode = 'none';
    this._watchOnce(SPECIAL_ART.plaque);
    const pTex = gameTexture(SPECIAL_ART.plaque);
    let faceCy = 86;
    if (isTextureReady(pTex)) {
      const sp = new PIXI.Sprite(pTex);
      sp.width = pw;
      sp.scale.y = sp.scale.x;
      plaqueWrap.addChild(sp);
      faceCy = sp.height * 0.64;
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2.8, INK, 1);
      g.beginFill(0xC89660, 1);
      g.drawRoundedRect(0, 44, pw, 68, 14);
      g.endFill();
      plaqueWrap.addChild(g);
      faceCy = 78;
    }
    const title = makeText('display', def.name, 0x4A2A12, {
      size: 31,
      stroke: 0xF6DDB0,
      strokeWidth: 3,
    });
    title.anchor.set(0.5);
    fitTextWidth(title, pw - 48);
    title.position.set(pw / 2, faceCy);
    plaqueWrap.addChild(title);
    this._hud.addChild(plaqueWrap);

    // 左侧：有收获后浮现精致「收摊带走」按钮
    if (this._haul.length > 0 && !this._settled) {
      const leaveBtn = makeSlicedButton({
        label: '收摊带走',
        width: 148,
        height: 46,
        skin: 'terracotta',
        fontSize: 21,
        onReady,
      });
      leaveBtn.position.set(16, top + 4);
      leaveBtn.on('pointertap', (e) => {
        e.stopPropagation();
        this._finish();
      });
      this._hud.addChild(leaveBtn);
    }

    // 右侧：静音小章 + 可选料理增益小圆章
    const mute = makeMuteButton(44);
    mute.position.set(w - 60, top + 5);
    mute.on('pointertap', (e) => e.stopPropagation());
    this._hud.addChild(mute);

    const buffs = liveHudBuffs(KitchenManager.save);
    if (buffs.length) {
      const buffRow = new PIXI.Container();
      const bSize = 36;
      const shownBuffs = buffs.slice(0, 3);
      shownBuffs.forEach((buff, i) => {
        const path = buffIconPath(buff.icon);
        this._watchOnce(path);
        const cell = new PIXI.Container();
        const bg = new PIXI.Graphics();
        bg.lineStyle(2, INK, 0.95);
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
        cell.position.set(i * (bSize + 6), 0);
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
      const bw = shownBuffs.length * (bSize + 6) - 6;
      buffRow.position.set(w - 68 - bw, top + 9);
      this._hud.addChild(buffRow);
    }

    // 2. 第二行（y = top + 72，高 40，底边严格 <= top + 112）：轮次签 + 已收签 + 「鲜货图鉴」木牌签
    const rowY = top + 72;
    const wRound = 186;
    const wBag = 166;
    const wLoot = 176;
    const gap = 12;
    const totalRowW = wRound + gap + wBag + gap + wLoot;
    const startX = Math.round((w - totalRowW) / 2);

    const roundSlip = this._makeBookmarkSlip(
      HUD_ICON.clock,
      `第 ${Math.min(this._round + 1, def.rounds)}/${def.rounds} 手`,
      wRound,
    );
    roundSlip.position.set(startX, rowY);
    this._hud.addChild(roundSlip);

    const bagSlip = this._makeBookmarkSlip(
      HUD_ICON.basket,
      `已收 ${this._haul.length} 件`,
      wBag,
    );
    bagSlip.position.set(startX + wRound + gap, rowY);
    this._hud.addChild(bagSlip);

    const lootBtn = this._makeLootDexButton(wLoot, () => {
      this._loot.openSpecial(def.id);
    });
    lootBtn.position.set(startX + wRound + gap + wBag + gap, rowY);
    this._hud.addChild(lootBtn);

    // 3. 底部无盘合并收获竹篓栏（高 94px）
    this._drawHaulStrip(w);
  }

  private _makeBookmarkSlip(icon: string, text: string, width: number): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const h = 40;
    const barX = 14;
    const barW = width - barX;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x140A04, 0.30);
    bg.drawRoundedRect(barX, 3, barW, h, 9);
    bg.endFill();
    bg.lineStyle(2.2, INK, 1);
    bg.beginFill(0xFAF0DA, 0.97);
    bg.drawRoundedRect(barX, 0, barW, h, 9);
    bg.endFill();
    bg.lineStyle(1.8, INK, 1);
    bg.beginFill(0x7A4B24, 1);
    bg.drawRoundedRect(barX + barW - 7, -0.5, 7, h + 1, 3.5);
    bg.endFill();
    root.addChild(bg);

    const lbl = makeText('number', text, INK, { size: 21 });
    lbl.anchor.set(0.5);
    fitTextWidth(lbl, barW - 32);
    lbl.position.set(barX + 18 + (barW - 32) / 2, h / 2 - 0.5);
    root.addChild(lbl);

    this._watchOnce(icon);
    const icTex = gameTexture(icon);
    if (isTextureReady(icTex)) {
      const sp = new PIXI.Sprite(icTex);
      fitSpriteInBox(sp, 42, 42);
      sp.anchor.set(0.5);
      sp.position.set(18, h / 2);
      root.addChild(sp);
    }
    return root;
  }

  private _makeLootDexButton(width: number, onTap: () => void): PIXI.Container {
    const h = 40;
    const root = new PIXI.Container();
    const face = new PIXI.Container();
    face.eventMode = 'none';
    root.addChild(face);

    const barX = 12;
    const barW = width - barX;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x120904, 0.34);
    bg.drawRoundedRect(barX, 3.5, barW, h, 10);
    bg.endFill();
    // 铜镶边暖琥珀木签
    bg.lineStyle(2.3, INK, 1);
    bg.beginFill(0x5C351B, 1);
    bg.drawRoundedRect(barX, 0, barW, h, 10);
    bg.endFill();
    bg.lineStyle(1.3, 0xF0C96B, 0.92);
    bg.beginFill(0x7A4724, 1);
    bg.drawRoundedRect(barX + 2.5, 2, barW - 5, h - 5.5, 8);
    bg.endFill();
    bg.lineStyle(0);
    bg.beginFill(0xFFE8A6, 0.16);
    bg.drawRoundedRect(barX + 6, 4, barW - 12, 9, 4);
    bg.endFill();
    face.addChild(bg);

    const lbl = makeText('caption', '鲜货图鉴', 0xFFF5DC, {
      size: 21,
      fontWeight: '700',
      stroke: 0x261308,
      strokeWidth: 3.5,
    });
    lbl.anchor.set(0.5);
    fitTextWidth(lbl, barW - 34);
    lbl.position.set(barX + 18 + (barW - 26) / 2, h / 2 - 0.5);
    face.addChild(lbl);

    this._watchOnce(HUD_ICON.peek);
    const icTex = gameTexture(HUD_ICON.peek);
    if (isTextureReady(icTex)) {
      const sp = new PIXI.Sprite(icTex);
      fitSpriteInBox(sp, 40, 40);
      sp.anchor.set(0.5);
      sp.position.set(18, h / 2 - 0.5);
      face.addChild(sp);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, -4, width + 4, h + 8);
    const reset = (): void => {
      face.y = 0;
      face.alpha = 1;
    };
    root.on('pointerdown', (e) => {
      e.stopPropagation();
      face.y = 2;
      face.alpha = 0.92;
    });
    root.on('pointerup', reset);
    root.on('pointerupoutside', reset);
    root.on('pointercancel', reset);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      onTap();
    });
    return root;
  }

  private _mergedHaulGroups(): MergedHaulGroup[] {
    const map = new Map<string, MergedHaulGroup>();
    const order: MergedHaulGroup[] = [];
    for (const it of this._haul) {
      const q: Quality = it.quality ?? 'common';
      const key = `${it.defId}__${q}`;
      let hit = map.get(key);
      if (!hit) {
        hit = {
          key,
          defId: it.defId,
          quality: q,
          tier: resolveRarityTier(itemRarity(it.defId), q),
          qty: 0,
          latestUid: it.uid,
        };
        map.set(key, hit);
        order.push(hit);
      }
      hit.qty += 1;
      hit.latestUid = it.uid;
    }
    return order.length > 6 ? order.slice(-6) : order;
  }

  private _haulTopY(): number {
    const trayH = 94;
    const bottomPad = Math.max(14, Game.safeBottom + 10);
    return Game.logicHeight - bottomPad - trayH;
  }

  private _drawHaulStrip(w: number): void {
    this._haulSlots.clear();
    const trayW = w - 36;
    const trayH = 94;
    const x = 18;
    const y = this._haulTopY();

    const tray = new PIXI.Container();
    tray.position.set(x, y);
    tray.eventMode = 'static';
    tray.on('pointertap', (e) => e.stopPropagation());

    const bg = new PIXI.Graphics();
    // 柔和暗影
    bg.beginFill(0x0E0703, 0.44);
    bg.drawRoundedRect(2, 5, trayW - 4, trayH - 1, 18);
    bg.endFill();
    // 胡桃木竹编外沿
    bg.lineStyle(2.6, INK, 1);
    bg.beginFill(0x5B351B, 0.96);
    bg.drawRoundedRect(0, 0, trayW, trayH, 18);
    bg.endFill();
    // 铜金细嵌线 + 深木内衬底槽
    bg.lineStyle(1.4, 0xC69050, 0.78);
    bg.beginFill(0x3B2110, 0.96);
    bg.drawRoundedRect(6, 6, trayW - 12, trayH - 13, 13);
    bg.endFill();
    tray.addChild(bg);

    const groups = this._mergedHaulGroups();
    if (!groups.length) {
      const def = this._def;
      const hint = def
        ? `竹篓还空着 · 「${def.hint.replace(/[。！]$/, '')}」`
        : '竹篓还空着 · 看准时机出手收鲜货！';
      const empty = makeText('body', hint, 0xF5E6CC, {
        size: 21,
        stroke: DARK_STROKE,
        strokeWidth: 4,
      });
      empty.anchor.set(0.5);
      fitTextWidth(empty, trayW - 40);
      empty.position.set(trayW / 2, trayH / 2 - 1);
      tray.addChild(empty);
      this._hud.addChild(tray);
      return;
    }

    const maxSlots = 6;
    const slotW = (trayW - 20) / maxSlots;

    for (let i = 0; i < maxSlots; i++) {
      const cx = 10 + slotW * (i + 0.5);
      const cy = 46;
      const group = groups[i];

      // 每个槽位绘深木凹槽底衬（无青花瓷盘！）
      const recess = new PIXI.Graphics();
      const rw = slotW - 8;
      const rh = 76;
      recess.lineStyle(1.4, group ? rarityStyleOf(group.tier).frame : 0x6B4326, group ? (group.tier === 'common' ? 0.42 : 0.82) : 0.35);
      recess.beginFill(0x261409, group ? 0.72 : 0.42);
      recess.drawRoundedRect(cx - rw / 2, cy - rh / 2, rw, rh, 11);
      recess.endFill();
      tray.addChild(recess);

      if (!group) continue;

      const cell = new PIXI.Container();
      cell.position.set(cx, cy);
      this._haulSlots.set(group.key, { x: x + cx, y: y + cy, cell });

      // 若该物品尚在半空抛物线飞行，且原本此槽数量为 1，则先留出空槽等落地瞬间弹入！
      const inFlightHere = this._flyingUid !== null && group.latestUid === this._flyingUid;
      const visibleQty = inFlightHere ? group.qty - 1 : group.qty;
      if (visibleQty <= 0) {
        tray.addChild(cell);
        continue;
      }

      const tier = group.tier;
      const style = rarityStyleOf(tier);

      const iPath = resolveItemAssetPath(group.defId);
      this._watchOnce(iPath);
      const tex = itemLookTexture(group.defId, 'clean');
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, 54, 54);
        sp.anchor.set(0.5);
        sp.position.set(0, -8);
        cell.addChild(sp);
        attachSpriteContour(cell, sp, tier, {
          onDark: true,
          selected: tier === 'legendary' || tier === 'god',
          thicknessScale: 0.85,
        });
      }

      const qtyLbl = makeText('number', `×${visibleQty}`, visibleQty > 1 ? 0xFFE999 : CREAM, {
        size: 19,
        stroke: DARK_STROKE,
        strokeWidth: 4.5,
      });
      qtyLbl.anchor.set(1, 1);
      qtyLbl.position.set(rw / 2 - 4, 15);
      cell.addChild(qtyLbl);

      const shortName = getItem(group.defId).name;
      const nm = makeText('caption', shortName, tier === 'common' ? CREAM : style.float, {
        size: 18,
        fontWeight: '700',
        stroke: DARK_STROKE,
        strokeWidth: 3.8,
      });
      nm.anchor.set(0.5);
      fitTextWidth(nm, rw - 6);
      nm.position.set(0, 25);
      cell.addChild(nm);

      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(-rw / 2, -rh / 2, rw, rh);
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        this._inspect = inspectFromFood({ defId: group.defId, quality: group.quality, inspected: true });
        this._paintInspect();
      });
      tray.addChild(cell);
    }

    this._hud.addChild(tray);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 四大奇遇集市专属手绘舞台 + 底部中央铜箍木牌出手大钮
  // ═══════════════════════════════════════════════════════════════════════════

  private _drawPlay(def: SpecialMarketDef): void {
    destroyDisplayChildren(this._play);
    this._actors = {};
    this._resetDrumRefs();

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const flavor = flavorOf(def);

    if (flavor === 'spice') this._buildSpiceStage(w, h);
    else if (flavor === 'fish') this._buildFishStage(w, h);
    else if (flavor === 'field') this._buildFieldStage(w, h);
    else this._buildDryStage(w, h);

    this._buildActionDrum(def, w);
  }

  private _buildActionDrum(def: SpecialMarketDef, w: number): void {
    const btnW = 352;
    const btnH = 112;
    const cy = this._haulTopY() - 12 - btnH / 2;

    const wrap = new PIXI.Container();
    wrap.position.set(w / 2, cy);
    wrap.zIndex = 30;
    wrap.eventMode = 'static';
    wrap.cursor = 'pointer';
    wrap.hitArea = new PIXI.Rectangle(-btnW / 2 - 12, -btnH / 2 - 8, btnW + 24, btnH + 16);

    const face = new PIXI.Container();
    face.eventMode = 'none';
    wrap.addChild(face);

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0D0603, 0.46);
    shadow.drawRoundedRect(-btnW / 2 + 8, -btnH / 2 + 10, btnW - 16, btnH - 8, 26);
    shadow.endFill();
    face.addChild(shadow);

    this._watchOnce(SPECIAL_ART.actionDrum);
    const dTex = gameTexture(SPECIAL_ART.actionDrum);
    let body: PIXI.DisplayObject;
    let flare: PIXI.DisplayObject | null = null;
    if (isTextureReady(dTex)) {
      const sp = new PIXI.Sprite(dTex);
      sp.anchor.set(0.5);
      sp.width = btnW;
      sp.height = btnH;
      face.addChild(sp);
      flare = attachSpriteContour(face, sp, 'god', {
        onDark: true,
        selected: true,
        thicknessScale: 1.05,
      });
      if (flare) flare.visible = false;
      body = sp;
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(3.2, INK, 1);
      g.beginFill(0x8C311E, 1);
      g.drawRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 24);
      g.endFill();
      g.lineStyle(2.2, 0xD9A84E, 0.95);
      g.beginFill(0xB8442A, 1);
      g.drawRoundedRect(-btnW / 2 + 8, -btnH / 2 + 7, btnW - 16, btnH - 18, 18);
      g.endFill();
      face.addChild(g);
      body = g;
    }

    // 底部嵌入式蓄势节奏微光条
    const charge = new PIXI.Graphics();
    charge.position.set(0, btnH / 2 - 20);
    face.addChild(charge);

    const flavor = flavorOf(def);
    const label = makeText('heading', waitCopyOf(flavor), 0xF7E8CE, {
      size: 28,
      stroke: DARK_STROKE,
      strokeWidth: 5.5,
    });
    label.anchor.set(0.5);
    label.position.set(0, -4);
    face.addChild(label);

    const release = (): void => {
      this._drumPressing = false;
      face.y = 0;
    };
    wrap.on('pointerdown', (e) => {
      e.stopPropagation();
      this._drumPressing = true;
      face.y = 4;
      face.scale.set(0.95);
    });
    wrap.on('pointerup', release);
    wrap.on('pointerupoutside', release);
    wrap.on('pointercancel', release);
    wrap.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._inspect || this._loot._isOpen) return;
      this._pulseDrumTap();
      this._onTap();
    });

    this._play.addChild(wrap);
    this._drumWrap = wrap;
    this._drumFace = face;
    this._drumBody = body;
    this._drumLabel = label;
    this._drumFlare = flare;
    this._drumCharge = charge;
  }

  private _pulseDrumTap(): void {
    const face = this._drumFace;
    if (!face || face.destroyed) return;
    TweenManager.cancelTarget(face.scale);
    face.scale.set(0.93);
    TweenManager.to({
      target: face.scale,
      props: { x: 1, y: 1 },
      duration: 0.18,
      ease: Ease.easeOutBack,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. 香料夜摊（spice）：厚重木摊案板 + 5 只贴斗方签陶罐 + 磕盖顶起 + 多层手绘香气云
  // ───────────────────────────────────────────────────────────────────────────

  private _spiceJarCoords(w: number, h: number): Array<{ x: number; y: number; scale: number }> {
    const baseY = Math.round(h * 0.632);
    const xs = [-236, -118, 0, 118, 236];
    const dy = [-10, 6, -8, 6, -10];
    const sc = [0.95, 1.02, 0.97, 1.02, 0.95];
    return xs.map((dx, i) => ({ x: w / 2 + dx, y: baseY + dy[i], scale: sc[i] }));
  }

  private _buildSpiceStage(w: number, h: number): void {
    this._watchOnce(SPECIAL_ART.spiceTable);
    this._watchOnce(SPECIAL_ART.spiceJar);
    this._watchOnce(SPECIAL_ART.spiceLid);
    this._watchOnce(SPECIAL_ART.spiceSteam);

    const tableY = Math.round(h * 0.664);

    // 夜市案台克制柔暖环境微光（不泛黄遮挡）
    const warmGlow = new PIXI.Graphics();
    warmGlow.blendMode = PIXI.BLEND_MODES.ADD;
    warmGlow.beginFill(0xFFD685, 0.35);
    warmGlow.drawEllipse(0, 0, 260, 68);
    warmGlow.endFill();
    warmGlow.alpha = 0.11;
    warmGlow.position.set(w / 2, tableY - 46);
    warmGlow.zIndex = 1;
    this._play.addChild(warmGlow);
    this._actors.spiceAmbient = warmGlow;

    // 案板与石板路接触暗影
    const tableWrap = new PIXI.Container();
    tableWrap.position.set(w / 2, tableY);
    tableWrap.zIndex = 2;
    const tShadow = new PIXI.Graphics();
    tShadow.beginFill(0x090503, 0.48);
    tShadow.drawEllipse(0, 68, 332, 26);
    tShadow.endFill();
    tableWrap.addChild(tShadow);

    const tTex = gameTexture(SPECIAL_ART.spiceTable);
    if (isTextureReady(tTex)) {
      const sp = new PIXI.Sprite(tTex);
      sp.anchor.set(0.5);
      sp.width = 688;
      sp.scale.y = sp.scale.x;
      tableWrap.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(3, INK, 1);
      g.beginFill(0x6E4221, 1);
      g.drawRoundedRect(-340, -56, 680, 126, 14);
      g.endFill();
      tableWrap.addChild(g);
    }
    this._play.addChild(tableWrap);

    const jarTex = gameTexture(SPECIAL_ART.spiceJar);
    const lidTex = gameTexture(SPECIAL_ART.spiceLid);
    const steamTex = gameTexture(SPECIAL_ART.spiceSteam);
    const coords = this._spiceJarCoords(w, h);

    coords.forEach((pt, i) => {
      const jar = new PIXI.Container();
      jar.position.set(pt.x, pt.y);
      jar.scale.set(pt.scale);
      jar.zIndex = 5 + Math.round(pt.y);

      const jShadow = new PIXI.Graphics();
      jShadow.beginFill(0x140A04, 0.48);
      jShadow.drawEllipse(0, 14, 44, 13);
      jShadow.endFill();
      jar.addChild(jShadow);

      // 罐口克制暖光（位于罐体上方、木盖下方）
      const mouthGlow = new PIXI.Graphics();
      mouthGlow.name = 'mouthGlow';
      mouthGlow.blendMode = PIXI.BLEND_MODES.ADD;
      mouthGlow.beginFill(0xFFE082, 0.34);
      mouthGlow.drawEllipse(0, 0, 32, 13);
      mouthGlow.endFill();
      mouthGlow.alpha = 0;
      mouthGlow.position.set(0, -76);
      jar.addChild(mouthGlow);

      const bodyWrap = new PIXI.Container();
      bodyWrap.name = 'bodyWrap';
      if (isTextureReady(jarTex)) {
        const body = new PIXI.Sprite(jarTex);
        fitSpriteInBox(body, 98, 104);
        body.anchor.set(0.5, 1);
        body.position.set(0, 18);
        bodyWrap.addChild(body);
      } else {
        const body = new PIXI.Graphics();
        body.lineStyle(2.6, INK, 1);
        body.beginFill(0x8B5328, 1);
        body.drawRoundedRect(-38, -74, 76, 90, 24);
        body.endFill();
        bodyWrap.addChild(body);
      }

      // 古朴斗方朱边小木签（壹~伍）
      const tag = new PIXI.Container();
      tag.position.set(0, -28);
      const tg = new PIXI.Graphics();
      tg.lineStyle(1.8, 0x3B1E0E, 0.95);
      tg.beginFill(0xF6E8CA, 0.96);
      tg.moveTo(0, -16);
      tg.lineTo(16, 0);
      tg.lineTo(0, 16);
      tg.lineTo(-16, 0);
      tg.closePath();
      tg.endFill();
      tg.lineStyle(1, 0xB83824, 0.78);
      tg.moveTo(0, -12);
      tg.lineTo(12, 0);
      tg.lineTo(0, 12);
      tg.lineTo(-12, 0);
      tg.closePath();
      tag.addChild(tg);
      const num = makeText('caption', JAR_NUMS[i], 0x5C2214, { size: 16, fontWeight: '700' });
      num.anchor.set(0.5);
      tag.addChild(num);
      bodyWrap.addChild(tag);
      jar.addChild(bodyWrap);

      // 双层手绘袅袅香气云 + 金色香韵星点
      const steamWrap = new PIXI.Container();
      steamWrap.name = 'steamWrap';
      steamWrap.position.set(0, -72);
      if (isTextureReady(steamTex)) {
        const sBack = new PIXI.Sprite(steamTex);
        sBack.name = 'steamBack';
        fitSpriteInBox(sBack, 98, 156);
        sBack.anchor.set(0.51, 0.98);
        sBack.scale.x *= -0.82;
        sBack.scale.y *= 0.82;
        sBack.position.set(-10, -4);
        sBack.alpha = 0;

        const sFront = new PIXI.Sprite(steamTex);
        sFront.name = 'steamFront';
        fitSpriteInBox(sFront, 114, 182);
        sFront.anchor.set(0.51, 0.98);
        sFront.alpha = 0;

        steamWrap.addChild(sBack, sFront);
      } else {
        const fb = new PIXI.Graphics();
        fb.name = 'steamFallback';
        steamWrap.addChild(fb);
      }
      const sparks = new PIXI.Graphics();
      sparks.name = 'steamSparks';
      steamWrap.addChild(sparks);
      jar.addChild(steamWrap);

      // 陶罐木盖
      const lidWrap = new PIXI.Container();
      lidWrap.name = 'lid';
      lidWrap.position.set(0, -64);
      if (isTextureReady(lidTex)) {
        const lid = new PIXI.Sprite(lidTex);
        fitSpriteInBox(lid, 98, 70);
        lid.anchor.set(0.5, 0.78);
        lidWrap.addChild(lid);
      } else {
        const lid = new PIXI.Graphics();
        lid.lineStyle(2.4, INK, 1);
        lid.beginFill(0xD9A25F, 1);
        lid.drawEllipse(0, -8, 42, 16);
        lid.endFill();
        lidWrap.addChild(lid);
      }
      jar.addChild(lidWrap);

      jar.eventMode = 'static';
      jar.cursor = 'pointer';
      jar.hitArea = new PIXI.Rectangle(-54, -140, 108, 166);
      jar.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._inspect || this._loot._isOpen) return;
        this._pulseDrumTap();
        this._onTap();
      });

      this._play.addChild(jar);
      this._actors[`jar${i}`] = jar;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. 江边垂钓（fish）：真实夕阳江面水波 + 水下摆尾鱼影 + 竹竿弧线 + 半浸葫芦漂 + 皇冠水花
  // ───────────────────────────────────────────────────────────────────────────

  private _fishSpot(w: number, h: number): { x: number; y: number } {
    return { x: Math.round(w * 0.48), y: Math.round(h * 0.568) };
  }

  private _buildFishStage(w: number, h: number): void {
    this._watchOnce(SPECIAL_ART.fishRod);
    this._watchOnce(SPECIAL_ART.fishBobber);
    this._watchOnce(SPECIAL_ART.fishSplash);

    const spot = this._fishSpot(w, h);

    // 1. 水下灵动游弋暗色鱼影（在金色水波之下）
    const fishShadow = new PIXI.Graphics();
    fishShadow.zIndex = 3;
    this._play.addChild(fishShadow);
    this._actors.fishShadow = fishShadow;

    // 2. 江面柔美金色夕阳水波纹（无任何生硬椭圆实心水坑！）
    const waterRipples = new PIXI.Graphics();
    waterRipples.position.set(spot.x, spot.y + 8);
    waterRipples.zIndex = 4;
    this._play.addChild(waterRipples);
    this._actors.waterRipples = waterRipples;

    // 咬钩时刻克制水面微光（绝不遮挡左下方咬钩鱼影）
    const biteFlare = new PIXI.Graphics();
    biteFlare.blendMode = PIXI.BLEND_MODES.ADD;
    biteFlare.beginFill(0xFFE898, 0.28);
    biteFlare.drawEllipse(0, 0, 48, 16);
    biteFlare.endFill();
    biteFlare.alpha = 0;
    biteFlare.position.set(spot.x + 8, spot.y + 4);
    biteFlare.zIndex = 5;
    this._play.addChild(biteFlare);
    this._actors.biteFlare = biteFlare;

    // 3. 半浸江水的红白葫芦立漂（zIndex 高于水花后壁，黑漂半沉时红漂头清晰嵌在破水孔中央！）
    const bobberWrap = new PIXI.Container();
    bobberWrap.position.set(spot.x, spot.y);
    bobberWrap.zIndex = 8;

    const bTex = gameTexture(SPECIAL_ART.fishBobber);
    const waterY = 8;

    // 水下折射虚影（营造真实入水通透感）
    const underSub = new PIXI.Container();
    underSub.name = 'underSub';
    const underMask = new PIXI.Graphics();
    underMask.beginFill(0xffffff);
    underMask.drawRect(-60, waterY, 120, 120);
    underMask.endFill();
    bobberWrap.addChild(underMask, underSub);
    underSub.mask = underMask;

    // 水上清晰立漂主体（随下沉自然没入水面遮罩之下！）
    const aboveSub = new PIXI.Container();
    aboveSub.name = 'aboveSub';
    const aboveMask = new PIXI.Graphics();
    aboveMask.beginFill(0xffffff);
    aboveMask.drawRect(-70, -140, 140, 140 + waterY);
    aboveMask.endFill();
    bobberWrap.addChild(aboveMask, aboveSub);
    aboveSub.mask = aboveMask;

    const gourdShift = new PIXI.Container();
    gourdShift.name = 'gourdShift';
    const underShift = new PIXI.Container();
    underShift.name = 'underShift';
    aboveSub.addChild(gourdShift);
    underSub.addChild(underShift);

    if (isTextureReady(bTex)) {
      const spAbove = new PIXI.Sprite(bTex);
      fitSpriteInBox(spAbove, 50, 114);
      spAbove.anchor.set(0.5, 0.52);
      spAbove.rotation = -0.28;
      gourdShift.addChild(spAbove);

      const spUnder = new PIXI.Sprite(bTex);
      fitSpriteInBox(spUnder, 50, 114);
      spUnder.anchor.set(0.5, 0.52);
      spUnder.rotation = -0.28;
      spUnder.tint = 0x52889C;
      spUnder.alpha = 0.30;
      underShift.addChild(spUnder);
    } else {
      const fg = new PIXI.Graphics();
      fg.lineStyle(2.2, INK, 1);
      fg.beginFill(0xD93B28, 1);
      fg.drawCircle(0, -22, 12);
      fg.endFill();
      fg.beginFill(0xFFF6EA, 1);
      fg.drawCircle(0, -4, 14);
      fg.endFill();
      gourdShift.addChild(fg);
    }

    // 漂顶精确连线锚点（对齐旋转后红漂顶珠像素，随 gourdShift 同步起伏下沉）
    const bobberTip = new PIXI.Container();
    bobberTip.name = 'bobberTip';
    bobberTip.position.set(-2.5, -58);
    gourdShift.addChild(bobberTip);

    // 水面贴合张力金圈
    const meniscus = new PIXI.Graphics();
    meniscus.name = 'meniscus';
    meniscus.position.set(0, waterY);
    bobberWrap.addChild(meniscus);

    bobberWrap.eventMode = 'static';
    bobberWrap.cursor = 'pointer';
    bobberWrap.hitArea = new PIXI.Rectangle(-110, -90, 220, 160);
    bobberWrap.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._inspect || this._loot._isOpen) return;
      this._pulseDrumTap();
      this._onTap();
    });
    this._play.addChild(bobberWrap);
    this._actors.bobber = bobberWrap;

    // 4. 手绘水花皇冠（破水镂空中心 anchor(0.5, 0.69) 精确包裹浮漂入水点）
    const splashWrap = new PIXI.Container();
    splashWrap.position.set(spot.x, spot.y + waterY);
    splashWrap.zIndex = 7;
    splashWrap.alpha = 0;
    const spTex = gameTexture(SPECIAL_ART.fishSplash);
    if (isTextureReady(spTex)) {
      const sp = new PIXI.Sprite(spTex);
      fitSpriteInBox(sp, 228, 178);
      sp.anchor.set(0.5, 0.69);
      splashWrap.addChild(sp);
    } else {
      const sg = new PIXI.Graphics();
      sg.lineStyle(3, 0xFFF3C4, 0.9);
      sg.drawEllipse(0, 0, 68, 22);
      splashWrap.addChild(sg);
    }
    this._play.addChild(splashWrap);
    this._actors.splash = splashWrap;

    // 5. 二阶贝塞尔柔韧弧形鱼线
    const lineG = new PIXI.Graphics();
    lineG.zIndex = 9;
    this._play.addChild(lineG);
    this._actors.fishLine = lineG;

    // 6. 右下木栈道斜伸出的手绘青竹鱼竿（右下缠绳握把 anchor(0.95, 0.94)，竿尖精确像素 (0.01, 0.01)）
    const rodPivot = new PIXI.Container();
    rodPivot.position.set(w - 22, Math.round(h * 0.708));
    rodPivot.zIndex = 10;

    const rTex = gameTexture(SPECIAL_ART.fishRod);
    const rodTip = new PIXI.Container();
    rodTip.name = 'rodTip';
    if (isTextureReady(rTex)) {
      const rodSpr = new PIXI.Sprite(rTex);
      fitSpriteInBox(rodSpr, 362, 370);
      rodSpr.anchor.set(0.95, 0.94);
      rodPivot.addChild(rodSpr);
      rodTip.position.set(-rodSpr.width * 0.94, -rodSpr.height * 0.93);
    } else {
      const rg = new PIXI.Graphics();
      rg.lineStyle(7, 0x9C7A32, 1);
      rg.moveTo(0, 0);
      rg.quadraticCurveTo(-150, -185, -328, -334);
      rodPivot.addChild(rg);
      rodTip.position.set(-328, -334);
    }
    rodPivot.addChild(rodTip);
    this._play.addChild(rodPivot);
    this._actors.rod = rodPivot;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. 老城干货店（dry）：古朴十字木架麻席严丝合缝盖住原画空匾 + 3D 抛颠翻面金黄竹匾
  // ───────────────────────────────────────────────────────────────────────────

  private _dryCenter(_w: number, h: number): { x: number; y: number } {
    return { x: 379, y: Math.round(h * 0.715) };
  }

  private _buildDryStage(w: number, h: number): void {
    this._watchOnce(SPECIAL_ART.dryRaw);
    this._watchOnce(SPECIAL_ART.dryGold);

    // 精确内收覆盖 special_dry_bg.jpg 地面空竹匾（cx=379, cy≈963, rx=241, ry=184）：
    // 稳态/金黄态由 500×364 动态圆竹匾完整包住麻席不露黑边，高抛腾空时露出下方十字木托架零穿帮！
    const standCx = 379;
    const standCy = Math.round(h * 0.722);
    const stand = new PIXI.Graphics();
    stand.zIndex = 2;
    stand.beginFill(0x120B06, 0.46);
    stand.drawEllipse(standCx, standCy + 2, 248, 185);
    stand.endFill();
    stand.lineStyle(2.4, 0x24160C, 0.92);
    stand.beginFill(0x3B2B1E, 0.98);
    stand.drawEllipse(standCx, standCy, 243, 182);
    stand.endFill();
    stand.lineStyle(1.6, 0x6A4E36, 0.62);
    stand.drawEllipse(standCx, standCy, 228, 168);
    // 晒匾十字榫卯木托架横梁（当竹匾抛起时露出下方的真实木架支撑！）
    stand.lineStyle(2.6, 0x1E1108, 0.95);
    stand.beginFill(0x5E3A1E, 1);
    stand.drawRoundedRect(standCx - 210, standCy - 14, 420, 26, 8);
    stand.endFill();
    stand.beginFill(0x4E2F18, 1);
    stand.drawRoundedRect(standCx - 16, standCy - 150, 32, 300, 8);
    stand.endFill();
    // 十字中心铜铆钉
    stand.lineStyle(1.6, 0x241208, 1);
    stand.beginFill(0xC99642, 1);
    stand.drawCircle(standCx, standCy - 1, 8);
    stand.endFill();
    this._play.addChild(stand);

    const center = this._dryCenter(w, h);

    // 随竹匾抛起高度动态缩放的地面落影
    const trayShadow = new PIXI.Graphics();
    trayShadow.beginFill(0x0E0703, 0.46);
    trayShadow.drawEllipse(0, 0, 232, 158);
    trayShadow.endFill();
    trayShadow.position.set(center.x, center.y + 10);
    trayShadow.zIndex = 3;
    this._play.addChild(trayShadow);
    this._actors.trayShadow = trayShadow;

    // 动态圆竹匾主体（raw 与 gold 同画幅等比放大至 500×362 严丝合缝包住底图空匾，金黄态贴边勾勒暖金轮廓）
    const trayWrap = new PIXI.Container();
    trayWrap.position.set(center.x, center.y);
    trayWrap.zIndex = 6;

    const rawTex = gameTexture(SPECIAL_ART.dryRaw);
    const goldTex = gameTexture(SPECIAL_ART.dryGold);
    const trayW = 500;
    const trayH = 362;

    const rawNode = new PIXI.Container();
    rawNode.name = 'rawFace';
    if (isTextureReady(rawTex)) {
      const sp = new PIXI.Sprite(rawTex);
      sp.anchor.set(0.5);
      sp.width = trayW;
      sp.height = trayH;
      rawNode.addChild(sp);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(5, 0x6E4420, 1);
      g.beginFill(0xCBB48C, 1);
      g.drawEllipse(0, 0, trayW / 2, trayH / 2);
      g.endFill();
      rawNode.addChild(g);
    }

    const goldNode = new PIXI.Container();
    goldNode.name = 'goldFace';
    goldNode.visible = false;
    if (isTextureReady(goldTex)) {
      const sp = new PIXI.Sprite(goldTex);
      sp.anchor.set(0.5);
      sp.width = trayW;
      sp.height = trayH;
      goldNode.addChild(sp);
      attachSpriteContour(goldNode, sp, 'god', {
        onDark: true,
        selected: true,
        thicknessScale: 1.08,
      });
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(5, 0x7A4818, 1);
      g.beginFill(0xF2C24E, 1);
      g.drawEllipse(0, 0, trayW / 2, trayH / 2);
      g.endFill();
      goldNode.addChild(g);
    }

    trayWrap.addChild(rawNode, goldNode);

    trayWrap.eventMode = 'static';
    trayWrap.cursor = 'pointer';
    trayWrap.hitArea = new PIXI.Ellipse(0, 0, trayW / 2, trayH / 2);
    trayWrap.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._inspect || this._loot._isOpen) return;
      this._pulseDrumTap();
      this._onTap();
    });
    this._play.addChild(trayWrap);
    this._actors.tray = trayWrap;

    // 颠匾飞舞的金黄干货碎光粒子层
    const tossSparks = new PIXI.Graphics();
    tossSparks.position.set(center.x, center.y);
    tossSparks.zIndex = 8;
    this._play.addChild(tossSparks);
    this._actors.tossSparks = tossSparks;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. 田埂夜摘（field）：2×2 错落青翠菜垄 + 萤火虫微光 + 复古提梁马灯巡垄聚光
  // ───────────────────────────────────────────────────────────────────────────

  private _fieldMoundCoords(w: number, h: number): Array<{ x: number; y: number; scale: number }> {
    // 精准落位在月夜泥垄菜畦内，完整避开右侧蹲姿摘瓜少女（x≈490..690, y≈670..960）
    return [
      { x: Math.round(w * 0.312), y: Math.round(h * 0.674), scale: 0.85 },
      { x: Math.round(w * 0.576), y: Math.round(h * 0.698), scale: 0.87 },
      { x: Math.round(w * 0.340), y: Math.round(h * 0.768), scale: 0.99 },
      { x: Math.round(w * 0.656), y: Math.round(h * 0.776), scale: 0.99 },
    ];
  }

  private _buildFieldStage(w: number, h: number): void {
    this._watchOnce(SPECIAL_ART.fieldMound);
    this._watchOnce(SPECIAL_ART.fieldLantern);

    const mTex = gameTexture(SPECIAL_ART.fieldMound);
    const lTex = gameTexture(SPECIAL_ART.fieldLantern);
    const coords = this._fieldMoundCoords(w, h);

    coords.forEach((pt, i) => {
      const mound = new PIXI.Container();
      mound.position.set(pt.x, pt.y);
      mound.scale.set(pt.scale);
      mound.zIndex = 6 + i * 2;

      const mShadow = new PIXI.Graphics();
      mShadow.beginFill(0x0B0805, 0.46);
      mShadow.drawEllipse(0, 26, 114, 34);
      mShadow.endFill();
      mound.addChild(mShadow);

      const bushWrap = new PIXI.Container();
      bushWrap.name = 'bushWrap';
      if (isTextureReady(mTex)) {
        const sp = new PIXI.Sprite(mTex);
        fitSpriteInBox(sp, 256, 174);
        sp.anchor.set(0.5, 0.62);
        bushWrap.addChild(sp);
        const bushContour = attachSpriteContour(bushWrap, sp, 'rare', {
          onDark: true,
          selected: true,
          thicknessScale: 1.08,
        });
        if (bushContour) {
          bushContour.name = 'bushContour';
          bushContour.visible = false;
        }
      } else {
        const g = new PIXI.Graphics();
        g.beginFill(0x4B321E, 1);
        g.drawEllipse(0, 14, 102, 38);
        g.endFill();
        g.beginFill(0x3D8C40, 1);
        g.drawEllipse(0, -12, 82, 42);
        g.endFill();
        bushWrap.addChild(g);
      }
      mound.addChild(bushWrap);

      const dew = new PIXI.Graphics();
      dew.name = 'dewSparks';
      mound.addChild(dew);

      mound.eventMode = 'static';
      mound.cursor = 'pointer';
      mound.hitArea = new PIXI.Ellipse(0, -4, 118, 72);
      mound.on('pointertap', (e) => {
        e.stopPropagation();
        if (this._inspect || this._loot._isOpen) return;
        this._pulseDrumTap();
        this._onTap();
      });

      this._play.addChild(mound);
      this._actors[`mound${i}`] = mound;
    });

    // 马灯投射的温暖金色扇形光罩（ADD 混合柔光，zIndex 高于全部菜垄！）
    const lightBeam = new PIXI.Graphics();
    lightBeam.blendMode = PIXI.BLEND_MODES.ADD;
    lightBeam.zIndex = 22;
    this._play.addChild(lightBeam);
    this._actors.lightBeam = lightBeam;

    // 复古发光提梁马灯（悬于菜垄上方夜空，绕顶部提环自然摆动）
    const lantern = new PIXI.Container();
    lantern.position.set(this._lanternStart.x, this._lanternStart.y);
    lantern.zIndex = 24;

    const flameFlare = new PIXI.Graphics();
    flameFlare.name = 'flameFlare';
    flameFlare.blendMode = PIXI.BLEND_MODES.ADD;
    flameFlare.beginFill(0xFFD66B, 0.16);
    flameFlare.drawCircle(0, 0, 38);
    flameFlare.endFill();
    flameFlare.beginFill(0xFFF0A8, 0.30);
    flameFlare.drawCircle(0, 0, 16);
    flameFlare.endFill();
    flameFlare.alpha = 0.42;
    flameFlare.position.set(0, 92);
    lantern.addChild(flameFlare);

    if (isTextureReady(lTex)) {
      const sp = new PIXI.Sprite(lTex);
      fitSpriteInBox(sp, 104, 176);
      sp.anchor.set(0.5, 0.05);
      lantern.addChild(sp);
    } else {
      const lg = new PIXI.Graphics();
      lg.lineStyle(3, INK, 1);
      lg.beginFill(0x9E6030, 1);
      lg.drawRoundedRect(-28, 16, 56, 110, 14);
      lg.endFill();
      lg.beginFill(0xFFE074, 0.95);
      lg.drawCircle(0, 74, 18);
      lg.endFill();
      lantern.addChild(lg);
    }
    this._play.addChild(lantern);
    this._actors.lantern = lantern;

    // 月夜田埂缓缓闪烁漂浮的萤火虫层
    const fireflyG = new PIXI.Graphics();
    fireflyG.blendMode = PIXI.BLEND_MODES.ADD;
    fireflyG.zIndex = 26;
    this._play.addChild(fireflyG);
    this._actors.fireflies = fireflyG;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 逐帧丝滑动态驱动
  // ═══════════════════════════════════════════════════════════════════════════

  private _tickActors(): void {
    const def = this._def;
    if (!def) return;
    const p = Math.min(1, this._phaseT / Math.max(0.001, this._phaseDur));
    const flavor = flavorOf(def);

    if (flavor === 'spice') this._tickSpice(p);
    else if (flavor === 'fish') this._tickFish(p);
    else if (flavor === 'field') this._tickField(p);
    else this._tickDry(p);

    this._tickActionDrum(flavor, p);
  }

  private _tickActionDrum(flavor: SpecialFlavor, p: number): void {
    if (!this._drumWrap || !this._drumFace || !this._drumLabel) return;
    const hit = this._phase === 'hitWindow';
    const tele = this._phase === 'telegraph';
    const late = this._phase === 'late';
    const resolve = this._phase === 'resolve';

    if (this._drumFlare) {
      this._drumFlare.visible = hit;
    }

    if (!this._drumPressing) {
      if (hit) {
        const pulse = 1.06 + Math.sin(this._phaseT * 22) * 0.024;
        this._drumFace.scale.set(pulse);
      } else {
        const breath = 1 + Math.sin(this._sceneT * 3.2) * 0.01;
        this._drumFace.scale.set(breath);
      }
    }

    if (this._drumBody && 'tint' in this._drumBody) {
      (this._drumBody as PIXI.Sprite).tint = hit
        ? 0xFFFFFF
        : tele
          ? 0xEED4BE
          : late || resolve
            ? 0xBCA492
            : 0xDFC4AE;
    }

    const wantCopy = hit
      ? hitCopyOf(flavor)
      : late
        ? '时机溜走啦…'
        : resolve
          ? (this._round + 1 >= (this._def?.rounds ?? 10) ? '准备收摊…' : '准备下一手…')
          : waitCopyOf(flavor);
    if (this._drumLabel.text !== wantCopy) {
      this._drumLabel.text = wantCopy;
      this._drumLabel.style.fontSize = hit ? 31 : 26;
      this._drumLabel.style.fill = hit ? 0xFFF292 : late ? 0xD8C2AE : 0xF7E8CE;
      this._drumLabel.scale.set(1);
      fitTextWidth(this._drumLabel, 286);
    }

    if (this._drumCharge) {
      const g = this._drumCharge;
      g.clear();
      const barW = 216;
      const barH = 6;
      g.beginFill(0x1E0D06, 0.55);
      g.drawRoundedRect(-barW / 2, -barH / 2, barW, barH, 3);
      g.endFill();
      const ratio = hit ? 1 : tele ? Math.max(0.08, p) : this._phase === 'idle' ? 0.12 : 0;
      if (ratio > 0) {
        const col = hit ? 0xFFE875 : tele ? 0xF5B349 : 0xB8824C;
        const fw = Math.max(10, barW * ratio);
        g.beginFill(col, hit ? 0.98 : 0.85);
        g.drawRoundedRect(-barW / 2, -barH / 2, fw, barH, 3);
        g.endFill();
      }
    }
  }

  private _tickSpice(p: number): void {
    const amb = this._actors.spiceAmbient;
    if (amb) {
      amb.alpha = this._phase === 'hitWindow'
        ? 0.22 + Math.sin(this._sceneT * 8) * 0.03
        : 0.11 + Math.sin(this._sceneT * 2.2) * 0.02;
    }

    for (let i = 0; i < 5; i++) {
      const jar = this._actors[`jar${i}`];
      if (!jar) continue;
      const hot = i === this._hotJar;
      const lid = jar.getChildByName('lid') as PIXI.Container | null;
      const bodyWrap = jar.getChildByName('bodyWrap') as PIXI.Container | null;
      const mouthGlow = jar.getChildByName('mouthGlow') as PIXI.Container | null;
      const steamWrap = jar.getChildByName('steamWrap') as PIXI.Container | null;

      let lidX = 0;
      let lidY = -64;
      let lidRot = 0;
      let bodyX = 0;
      let glowA = 0;
      let steamA = 0;
      let steamScale = 0.35;
      let goldSteam = false;

      if (hot && this._phase === 'telegraph') {
        const hop = Math.abs(Math.sin(p * Math.PI * 7.5));
        lidY = -64 - hop * (7 + p * 13);
        lidRot = Math.sin(p * Math.PI * 15) * (0.06 + p * 0.10);
        bodyX = Math.sin(p * Math.PI * 18) * (1.2 + p * 1.8);
        glowA = 0.20 + p * 0.45;
        steamA = 0.24 + p * 0.56;
        steamScale = 0.42 + p * 0.44;
      } else if (hot && this._phase === 'hitWindow') {
        lidX = 6;
        lidY = -108 + Math.sin(this._phaseT * 22) * 4;
        lidRot = 0.26 + Math.sin(this._phaseT * 18) * 0.05;
        glowA = 0.94;
        steamA = 0.98;
        steamScale = 1.06 + Math.sin(this._phaseT * 16) * 0.07;
        goldSteam = true;
      } else if (hot && this._phase === 'resolve' && this._lastGrade === 'hit') {
        // 揭盖命中：木盖干脆掀飞旋转到罐侧！
        const rp = Math.min(1, p * 2.4);
        lidX = 46 * Ease.easeOutQuad(rp);
        lidY = -98 + 26 * rp;
        lidRot = 0.95 * Ease.easeOutBack(rp);
        glowA = 0.65 * (1 - p);
        steamA = 0.72 * (1 - p);
        steamScale = 1.12;
        goldSteam = true;
      } else if (hot && this._phase === 'late') {
        lidY = -64 - 8 * (1 - p);
        lidRot = 0.05 * (1 - p);
        glowA = 0.32 * (1 - p);
        steamA = 0.48 * (1 - p);
        steamScale = 0.78 * (1 - p * 0.4);
      }

      if (lid) {
        lid.position.set(lidX, lidY);
        lid.rotation = lidRot;
      }
      if (bodyWrap) bodyWrap.x = bodyX;
      if (mouthGlow) {
        mouthGlow.alpha = glowA * 0.6;
      }
      if (steamWrap) {
        const sFront = steamWrap.getChildByName('steamFront') as PIXI.Sprite | null;
        const sBack = steamWrap.getChildByName('steamBack') as PIXI.Sprite | null;
        const sFb = steamWrap.getChildByName('steamFallback') as PIXI.Graphics | null;
        const sparks = steamWrap.getChildByName('steamSparks') as PIXI.Graphics | null;

        if (sFront && sBack) {
          const baseFrontS = Math.min(114 / sFront.texture.width, 182 / sFront.texture.height);
          const baseBackS = Math.min(98 / sBack.texture.width, 156 / sBack.texture.height) * 0.84;
          sFront.alpha = steamA;
          sFront.scale.set(baseFrontS * steamScale);
          sFront.rotation = Math.sin(this._sceneT * 5.2 + i) * 0.08;
          sFront.tint = goldSteam ? 0xFFE9A6 : 0xFFF7E8;

          sBack.alpha = steamA * 0.78;
          sBack.scale.set(-baseBackS * steamScale, baseBackS * steamScale * 0.95);
          sBack.rotation = -Math.sin(this._sceneT * 4.4 + i) * 0.10;
          sBack.tint = goldSteam ? 0xFFD878 : 0xF7E6C8;
        } else if (sFb) {
          sFb.clear();
          if (steamA > 0.02) {
            sFb.beginFill(goldSteam ? 0xFFE694 : 0xFFF8EC, steamA);
            sFb.drawCircle(-8, -28 * steamScale, 12 * steamScale);
            sFb.drawCircle(9, -54 * steamScale, 16 * steamScale);
            sFb.drawCircle(-2, -82 * steamScale, 11 * steamScale);
            sFb.endFill();
          }
        }

        if (sparks) {
          sparks.clear();
          if (steamA > 0.25) {
            for (let k = 0; k < 5; k++) {
              const cyc = (this._sceneT * 1.6 + k * 0.21) % 1;
              const sx = Math.sin(this._sceneT * 4 + k * 2.1) * (16 + cyc * 18);
              const sy = -18 - cyc * 124 * steamScale;
              const sa = Math.sin(cyc * Math.PI) * steamA;
              sparks.beginFill(goldSteam ? 0xFFE46B : 0xFFECC8, sa);
              sparks.drawCircle(sx, sy, goldSteam ? 3.2 : 2.2);
              sparks.endFill();
            }
          }
        }
      }
    }
  }

  private _tickFish(p: number): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const spot = this._fishSpot(w, h);
    const bobber = this._actors.bobber;
    const ripples = this._actors.waterRipples as PIXI.Graphics | undefined;
    const fishShadow = this._actors.fishShadow as PIXI.Graphics | undefined;
    const splash = this._actors.splash;
    const biteFlare = this._actors.biteFlare;
    const rod = this._actors.rod;
    const fishLine = this._actors.fishLine as PIXI.Graphics | undefined;
    if (!bobber) return;

    // 浮漂起伏与黑漂下沉逻辑
    let dipY = Math.sin(this._sceneT * 2.6) * 2.5;
    let driftX = 0;
    let rodRot = Math.sin(this._sceneT * 1.8) * 0.018;
    let rodScaleY = 1;
    let lineSag = 26;

    if (this._phase === 'telegraph') {
      // 3 次灵动顿口试探点漂
      const n1 = Math.exp(-(((p - 0.24) / 0.065) ** 2));
      const n2 = Math.exp(-(((p - 0.56) / 0.065) ** 2));
      const n3 = Math.exp(-(((p - 0.84) / 0.055) ** 2));
      const nibble = n1 * 9 + n2 * 13 + n3 * 10;
      dipY = nibble + Math.sin(this._sceneT * 5) * 1.5;
      rodRot = -0.0032 * nibble + Math.sin(this._sceneT * 2.2) * 0.012;
      lineSag = Math.max(8, 24 - nibble * 1.1);
    } else if (this._phase === 'hitWindow') {
      // 猛然半沉黑漂（红漂顶与上肚皮嵌在皇冠水花破水孔中央剧烈颤动）+ 鱼竿弯弓蓄力 + 鱼线绷直！
      dipY = 18 + Math.sin(this._phaseT * 26) * 2.8;
      driftX = Math.sin(this._phaseT * 30) * 2.2;
      rodRot = -0.145 + Math.sin(this._phaseT * 24) * 0.018;
      rodScaleY = 0.93;
      lineSag = 0;
    } else if (this._phase === 'resolve' && this._lastGrade === 'hit') {
      // 提竿瞬间帅气向上扬竿回弹！
      const whip = Math.sin(Math.min(1, p * 1.8) * Math.PI * 0.65);
      rodRot = 0.25 * whip;
      dipY = -12 * (1 - p);
      lineSag = 6 + p * 18;
    } else if (this._phase === 'late') {
      dipY = 6 * (1 - p);
      driftX = p * 26;
      rodRot = 0.04 * (1 - p);
      lineSag = 32;
    }

    bobber.position.set(spot.x + driftX, spot.y);
    const gourdShift = bobber.getChildByName('aboveSub', true)
      ? (bobber.getChildByName('aboveSub') as PIXI.Container).getChildByName('gourdShift') as PIXI.Container | null
      : null;
    const underShift = bobber.getChildByName('underSub')
      ? (bobber.getChildByName('underSub') as PIXI.Container).getChildByName('underShift') as PIXI.Container | null
      : null;
    if (gourdShift) {
      gourdShift.y = dipY;
      gourdShift.rotation = Math.sin(this._sceneT * 3.4) * 0.035;
    }
    if (underShift) {
      underShift.y = dipY;
      underShift.rotation = Math.sin(this._sceneT * 3.4) * 0.035;
    }

    const meniscus = bobber.getChildByName('meniscus') as PIXI.Graphics | null;
    if (meniscus) {
      meniscus.clear();
      const mr = this._phase === 'hitWindow' ? 28 : 20 + Math.sin(this._sceneT * 3) * 2;
      meniscus.lineStyle(2, 0xFFE69E, this._phase === 'hitWindow' ? 0.85 : 0.52);
      meniscus.drawEllipse(0, 0, mr, mr * 0.30);
    }

    // 江面金色夕阳水波与激波环
    if (ripples) {
      ripples.clear();
      for (let k = 0; k < 3; k++) {
        const cyc = (this._sceneT * (this._phase === 'hitWindow' ? 1.45 : 0.48) + k / 3) % 1;
        const rx = 28 + cyc * (this._phase === 'hitWindow' ? 128 : 88);
        const ry = rx * 0.29;
        const alpha = (1 - cyc) * (this._phase === 'hitWindow' ? 0.72 : 0.30);
        ripples.lineStyle(this._phase === 'hitWindow' ? 2.8 : 1.6, 0xFFD982, alpha);
        ripples.drawEllipse(driftX, 0, rx, ry);
      }
      if (this._phase === 'hitWindow') {
        const pulseR = 46 + Math.sin(this._phaseT * 20) * 10;
        ripples.lineStyle(3.2, 0xFFF2A6, 0.9);
        ripples.drawEllipse(driftX, 0, pulseR, pulseR * 0.32);
      }
    }

    // 皇冠水花与水面金辉
      if (splash) {
      if (this._phase === 'hitWindow') {
        splash.alpha = 0.94;
        splash.position.set(spot.x + driftX, spot.y + 8);
        splash.scale.set(0.88 + Math.sin(this._phaseT * 22) * 0.08);
      } else if (this._phase === 'resolve' && this._lastGrade === 'hit') {
        const sp = Math.min(1, p * 2.2);
        splash.alpha = Math.max(0, 1 - sp);
        splash.scale.set(0.95 + sp * 0.45);
      } else {
        splash.alpha = 0;
      }
    }
    if (biteFlare) {
      biteFlare.alpha = this._phase === 'hitWindow' ? 0.52 : 0;
    }

    // 水下摆尾暗色鱼影动态绘制（咬钩时位于水花左下方清澈水面，鱼嘴右上紧咬浮漂水下脚！）
    if (fishShadow) {
      fishShadow.clear();
      let fx = spot.x - 104 + Math.cos(this._sceneT * 1.3) * 42;
      let fy = spot.y + 38 + Math.sin(this._sceneT * 2.1) * 14;
      let fAlpha = 0.46;
      let wagFreq = 7;

      if (this._phase === 'telegraph') {
        const easeP = Ease.easeInOutQuad(p);
        fx = (spot.x - 128) * (1 - easeP) + (spot.x - 76) * easeP;
        fy = (spot.y + 48) * (1 - easeP) + (spot.y + 34) * easeP;
        fAlpha = 0.50 + easeP * 0.24;
        wagFreq = 13;
      } else if (this._phase === 'hitWindow') {
        fx = spot.x - 74 + Math.sin(this._phaseT * 28) * 4;
        fy = spot.y + 34;
        fAlpha = 0.80;
        wagFreq = 26;
      } else if (this._phase === 'late') {
        fx = spot.x + 20 + p * 135;
        fy = spot.y + 26 + p * 28;
        fAlpha = 0.55 * (1 - p);
        wagFreq = 18;
      } else if (this._phase === 'resolve' && this._lastGrade === 'hit') {
        fAlpha = 0;
      }

      if (fAlpha > 0.03) {
        const angle = Math.atan2((spot.y + 10) - fy, (spot.x - 16) - fx);
        const heading = this._phase === 'late'
          ? 0.22
          : this._phase === 'idle'
            ? Math.sin(this._sceneT * 1.3) * 0.35
            : angle * 0.72;
        const wag = Math.sin(this._sceneT * wagFreq) * 7.5;
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const rotPt = (lx: number, ly: number): [number, number] => [
          fx + lx * cos - ly * sin,
          fy + lx * sin + ly * cos,
        ];

        fishShadow.beginFill(0x091A28, fAlpha);
        const [hx, hy] = rotPt(26, 0);
        const [uc1x, uc1y] = rotPt(8, -13);
        const [uc2x, uc2y] = rotPt(-18, -9 + wag * 0.35);
        const [tx, ty] = rotPt(-34, wag * 0.7);
        const [t1x, t1y] = rotPt(-48, -12 + wag);
        const [tmx, tmy] = rotPt(-41, wag * 0.85);
        const [t2x, t2y] = rotPt(-48, 12 + wag);
        const [lc2x, lc2y] = rotPt(-18, 9 + wag * 0.35);
        const [lc1x, lc1y] = rotPt(8, 13);

        fishShadow.moveTo(hx, hy);
        fishShadow.bezierCurveTo(uc1x, uc1y, uc2x, uc2y, tx, ty);
        fishShadow.lineTo(t1x, t1y);
        fishShadow.lineTo(tmx, tmy);
        fishShadow.lineTo(t2x, t2y);
        fishShadow.lineTo(tx, ty);
        fishShadow.bezierCurveTo(lc2x, lc2y, lc1x, lc1y, hx, hy);
        fishShadow.endFill();
      }
    }

    // 竹竿旋转与精确二阶贝塞尔弧形鱼线绘制
    if (rod) {
      rod.rotation = rodRot;
      rod.scale.set(1, rodScaleY);
    }

    if (fishLine && rod && gourdShift) {
      fishLine.clear();
      const rodTip = rod.getChildByName('rodTip');
      const bobberTip = gourdShift.getChildByName('bobberTip');
      if (rodTip && bobberTip) {
        const pStart = this._play.toLocal(rodTip.getGlobalPosition());
        // 鱼线终点钳制在水面之上，黑漂沉入水底时鱼线直插水花中心！
        const rawEnd = this._play.toLocal(bobberTip.getGlobalPosition());
        const waterSurfaceY = spot.y + 8;
        const endX = rawEnd.x;
        const endY = Math.min(rawEnd.y, waterSurfaceY);
        const ctrlX = (pStart.x + endX) * 0.5 - lineSag * 0.25;
        const ctrlY = (pStart.y + endY) * 0.5 + lineSag;

        fishLine.lineStyle(
          this._phase === 'hitWindow' ? 2.4 : 1.9,
          this._phase === 'hitWindow' ? 0xFFFBE8 : 0xF5E8CE,
          this._phase === 'hitWindow' ? 0.96 : 0.82,
        );
        fishLine.moveTo(pStart.x, pStart.y);
        fishLine.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
      }
    }
  }

  private _tickDry(p: number): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const center = this._dryCenter(w, h);
    const tray = this._actors.tray;
    const shadow = this._actors.trayShadow;
    const sparks = this._actors.tossSparks as PIXI.Graphics | undefined;
    if (!tray) return;

    const rawFace = tray.getChildByName('rawFace');
    const goldFace = tray.getChildByName('goldFace');

    let liftY = Math.sin(this._sceneT * 2.4) * 3;
    let driftX = 0;
    let scaleX = 1;
    let scaleY = 1;
    let rot = Math.sin(this._sceneT * 1.8) * 0.014;
    let alpha = 1;
    let showGold = false;

    if (this._phase === 'telegraph') {
      if (p < 0.16) {
        // 向下蓄力微沉
        const dp = p / 0.16;
        liftY = Math.sin(dp * Math.PI * 0.5) * 14;
        scaleX = 1 + dp * 0.03;
        scaleY = 1 - dp * 0.05;
        showGold = false;
      } else {
        // 向上真实抛物线腾空 + 3D 前后翻面（过零点无缝切换 raw -> gold！）
        const fp = (p - 0.16) / 0.84;
        liftY = 14 * (1 - Math.min(1, fp * 4)) - Math.sin(fp * Math.PI) * 98;
        const cosV = Math.cos(fp * Math.PI);
        scaleY = Math.max(0.06, Math.abs(cosV));
        scaleX = 1 + Math.sin(fp * Math.PI) * 0.06;
        rot = Math.sin(fp * Math.PI) * -0.05;
        showGold = fp >= 0.5;
      }
    } else if (this._phase === 'hitWindow') {
      showGold = true;
      const pulse = 1 + Math.sin(this._phaseT * 18) * 0.025;
      scaleX = pulse;
      scaleY = pulse;
      liftY = -4 + Math.sin(this._phaseT * 16) * 3;
      rot = 0;
    } else if (this._phase === 'resolve' && this._lastGrade === 'hit') {
      showGold = true;
      const bounce = Math.sin(Math.min(1, p * 2.2) * Math.PI);
      scaleX = 1 + bounce * 0.06;
      scaleY = 1 - bounce * 0.04;
    } else if (this._phase === 'late') {
      showGold = true;
      driftX = Ease.easeInQuad(p) * 165;
      liftY = -p * 24;
      rot = p * 0.18;
      alpha = Math.max(0, 1 - p * 1.05);
    }

    if (rawFace) rawFace.visible = !showGold;
    if (goldFace) goldFace.visible = showGold;

    tray.position.set(center.x + driftX, center.y + liftY);
    tray.scale.set(scaleX, scaleY);
    tray.rotation = rot;
    tray.alpha = alpha;

    if (shadow) {
      const heightRatio = Math.max(0, -liftY / 98);
      shadow.position.set(center.x + driftX * 0.85, center.y + 10);
      shadow.scale.set(1 - heightRatio * 0.22);
      shadow.alpha = alpha * (0.46 - heightRatio * 0.22);
    }

    if (sparks) {
      sparks.clear();
      if ((this._phase === 'telegraph' && p > 0.22) || this._phase === 'hitWindow') {
        const count = this._phase === 'hitWindow' ? 8 : 6;
        for (let k = 0; k < count; k++) {
          const ang = (k / count) * Math.PI * 2 + this._sceneT * 1.8;
          const rx = 148 + Math.sin(this._sceneT * 5 + k) * 32;
          const ry = 92 + Math.cos(this._sceneT * 4 + k) * 20;
          const sx = driftX + Math.cos(ang) * rx;
          const sy = liftY + Math.sin(ang) * ry - 18;
          const col = k % 3 === 0 ? 0xE8442E : 0xFFE270;
          sparks.beginFill(col, this._phase === 'hitWindow' ? 0.9 : 0.72);
          sparks.drawCircle(sx, sy, k % 2 === 0 ? 3.8 : 2.6);
          sparks.endFill();
        }
      }
    }
  }

  private _tickField(p: number): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const coords = this._fieldMoundCoords(w, h);
    const lantern = this._actors.lantern;
    const lightBeam = this._actors.lightBeam as PIXI.Graphics | undefined;
    const fireflies = this._actors.fireflies as PIXI.Graphics | undefined;

    // 1. 萤火虫月夜漂浮闪烁
    if (fireflies) {
      fireflies.clear();
      for (const ff of this._fireflies) {
        const fx = ff.bx + Math.sin(this._sceneT * ff.speed + ff.phase) * ff.rx;
        const fy = ff.by + Math.cos(this._sceneT * ff.speed * 0.82 + ff.phase) * ff.ry;
        const tw = 0.25 + 0.75 * Math.max(0, Math.sin(this._sceneT * 2.8 + ff.phase));
        fireflies.beginFill(0xCAFF64, tw * 0.26);
        fireflies.drawCircle(fx, fy, ff.size * 3.2);
        fireflies.endFill();
        fireflies.beginFill(0xFFF699, tw * 0.95);
        fireflies.drawCircle(fx, fy, ff.size);
        fireflies.endFill();
      }
    }

    // 2. 复古马灯高悬夜空巡垄位移与惯性轻摆（始终高于四丛菜垄，暖金光束直投目标熟菜丛）
    const idleX = w * 0.47 + Math.sin(this._sceneT * 1.4) * 26;
    const idleY = Math.round(h * 0.465) + Math.cos(this._sceneT * 1.9) * 8;
    const target = coords[this._hotMound] ?? coords[0];
    const targetLanternX = target.x;
    const targetLanternY = Math.min(target.y - 236, Math.round(h * 0.505));

    let lx = idleX;
    let ly = idleY;
    let lRot = Math.sin(this._sceneT * 2.1) * 0.055;
    let beamAlpha = 0.24;
    let beamSpread = 98;
    let beamEndX = idleX;
    let beamEndY = idleY + 280;
    let flameAlpha = 0.46;

    if (this._phase === 'telegraph') {
      const ep = Ease.easeInOutQuad(p);
      lx = this._lanternStart.x + (targetLanternX - this._lanternStart.x) * ep;
      ly = this._lanternStart.y + (targetLanternY - this._lanternStart.y) * ep;
      const vx = (targetLanternX - this._lanternStart.x) * (1 - Math.abs(2 * p - 1));
      lRot = Math.max(-0.22, Math.min(0.22, -vx * 0.00075)) + Math.sin(this._sceneT * 5) * 0.03;
      beamAlpha = 0.28 + ep * 0.36;
      beamSpread = 98 + ep * 24;
      beamEndX = lx + (target.x - lx) * ep;
      beamEndY = (ly + 260) * (1 - ep) + (target.y + 8) * ep;
      flameAlpha = 0.50 + ep * 0.34;
    } else if (this._phase === 'hitWindow') {
      lx = targetLanternX;
      ly = targetLanternY + Math.sin(this._phaseT * 16) * 3;
      lRot = Math.sin(this._phaseT * 14) * 0.035;
      beamAlpha = 0.82 + Math.sin(this._phaseT * 18) * 0.08;
      beamSpread = 132;
      beamEndX = target.x;
      beamEndY = target.y + 8;
      flameAlpha = 0.98;
    } else if (this._phase === 'late' || this._phase === 'resolve') {
      lx = targetLanternX;
      ly = targetLanternY;
      lRot = Math.sin(this._sceneT * 2.5) * 0.04;
      beamAlpha = 0.34 * (1 - p * 0.6);
      beamSpread = 108;
      beamEndX = target.x;
      beamEndY = target.y + 8;
      flameAlpha = 0.48;
    }

    if (lantern) {
      lantern.position.set(lx, ly);
      lantern.rotation = lRot;
      const flameFlare = lantern.getChildByName('flameFlare');
      if (flameFlare) {
        flameFlare.alpha = flameAlpha;
        flameFlare.scale.set(this._phase === 'hitWindow' ? 1.18 : 0.92);
      }
    }

    if (lightBeam) {
      lightBeam.clear();
      const lampCoreX = lx - Math.sin(lRot) * 92;
      const lampCoreY = ly + Math.cos(lRot) * 92;
      const endY = Math.max(lampCoreY + 110, beamEndY);

      // 双层柔光扇形罩 + 泥垄目标菜丛暖金聚光光斑
      lightBeam.beginFill(0xFFD262, beamAlpha * 0.28);
      lightBeam.moveTo(lampCoreX - 18, lampCoreY);
      lightBeam.lineTo(lampCoreX + 18, lampCoreY);
      lightBeam.lineTo(beamEndX + beamSpread, endY);
      lightBeam.lineTo(beamEndX - beamSpread, endY);
      lightBeam.closePath();
      lightBeam.endFill();

      lightBeam.beginFill(0xFFE896, beamAlpha * 0.22);
      lightBeam.moveTo(lampCoreX - 10, lampCoreY);
      lightBeam.lineTo(lampCoreX + 10, lampCoreY);
      lightBeam.lineTo(beamEndX + beamSpread * 0.62, endY);
      lightBeam.lineTo(beamEndX - beamSpread * 0.62, endY);
      lightBeam.closePath();
      lightBeam.endFill();

      lightBeam.beginFill(0xFFDC73, beamAlpha * 0.32);
      lightBeam.drawEllipse(beamEndX, endY, beamSpread * 0.95, 36);
      lightBeam.endFill();
    }

    // 3. 4 丛青翠菜垄动态呼吸与熟透贴边轮廓光/星芒反馈
    for (let i = 0; i < 4; i++) {
      const mound = this._actors[`mound${i}`];
      if (!mound) continue;
      const hot = i === this._hotMound;
      const bush = mound.getChildByName('bushWrap') as PIXI.Container | null;
      const dew = mound.getChildByName('dewSparks') as PIXI.Graphics | null;

      let bRot = Math.sin(this._sceneT * 1.9 + i * 1.3) * 0.012;
      let bScale = 1;
      let eAlpha = 0;

      if (hot && this._phase === 'telegraph') {
        const rustle = p > 0.35 ? (p - 0.35) / 0.65 : 0;
        bRot = Math.sin(this._sceneT * 18) * 0.045 * rustle;
        bScale = 1 + rustle * 0.04;
        eAlpha = rustle * 0.42;
      } else if (hot && this._phase === 'hitWindow') {
        bScale = 1.07 + Math.sin(this._phaseT * 20) * 0.025;
        bRot = Math.sin(this._phaseT * 16) * 0.028;
        eAlpha = 0.78;
      } else if (hot && this._phase === 'resolve' && this._lastGrade === 'hit') {
        const pop = Math.sin(Math.min(1, p * 2.5) * Math.PI);
        bScale = 1 - pop * 0.10;
        eAlpha = 0.55 * (1 - p);
      }

      if (bush) {
        bush.rotation = bRot;
        bush.scale.set(bScale);
        const bushContour = bush.getChildByName('bushContour');
        if (bushContour) {
          bushContour.visible = eAlpha > 0.12;
        }
      }
      if (dew) {
        dew.clear();
        if (hot && (this._phase === 'hitWindow' || (this._phase === 'telegraph' && p > 0.55))) {
          const dAlpha = this._phase === 'hitWindow' ? 0.92 : (p - 0.55) * 1.5;
          const pts: Array<[number, number, number]> = [
            [-58, -36, 5.5],
            [48, -42, 6.2],
            [-12, -56, 5.0],
            [24, -18, 4.5],
            [-36, -8, 4.2],
          ];
          pts.forEach(([dx, dy, r], idx) => {
            const tw = 0.5 + 0.5 * Math.sin(this._sceneT * 14 + idx * 1.4);
            this._drawFourPointStar(dew, dx, dy, r * tw + 2, idx % 2 === 0 ? 0xFFF49C : 0x9EFFA8, dAlpha);
          });
        }
      }
    }
  }

  private _drawFourPointStar(
    g: PIXI.Graphics,
    x: number,
    y: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    g.beginFill(color, alpha);
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.26, y - r * 0.26);
    g.lineTo(x + r, y);
    g.lineTo(x + r * 0.26, y + r * 0.26);
    g.lineTo(x, y + r);
    g.lineTo(x - r * 0.26, y + r * 0.26);
    g.lineTo(x - r, y);
    g.lineTo(x - r * 0.26, y - r * 0.26);
    g.closePath();
    g.endFill();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 判定推进、无遮挡跃出抛物线入篓动效 & 描边飘字（零瓷盘、零中央横幅遮挡！）
  // ═══════════════════════════════════════════════════════════════════════════

  private _onTap(): void {
    if (this._phase === 'telegraph') this._resolve('early');
    else if (this._phase === 'hitWindow') this._resolve('hit');
    else if (this._phase === 'late') this._resolve('late');
  }

  private _advance(): void {
    const def = this._def;
    if (!def) return;
    if (this._phase === 'idle') {
      this._hotJar = rngInt(this._rng, 0, 4);
      this._hotMound = rngInt(this._rng, 0, 3);
      const lantern = this._actors.lantern;
      if (lantern) {
        this._lanternStart = { x: lantern.x, y: lantern.y };
      }
      this._setPhase('telegraph', this._rand(SPECIAL_TIMING.telegraphMin, SPECIAL_TIMING.telegraphMax));
      return;
    }
    if (this._phase === 'telegraph') {
      this._setPhase('hitWindow', SPECIAL_TIMING.hitWindow);
      return;
    }
    if (this._phase === 'hitWindow') {
      this._setPhase('late', SPECIAL_TIMING.lateHold);
      return;
    }
    if (this._phase === 'late') {
      this._resolve('late');
      return;
    }
    if (this._phase === 'resolve') {
      this._nextRound();
    }
  }

  private _activePropOrigin(def: SpecialMarketDef): { x: number; y: number; actor?: PIXI.Container } {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const flavor = flavorOf(def);
    if (flavor === 'spice') {
      const jar = this._actors[`jar${this._hotJar}`];
      if (jar) return { x: jar.x, y: jar.y - 76, actor: jar };
      return { x: w / 2, y: Math.round(h * 0.56) };
    }
    if (flavor === 'fish') {
      const spot = this._fishSpot(w, h);
      return { x: spot.x, y: spot.y - 4, actor: this._actors.bobber };
    }
    if (flavor === 'field') {
      const mound = this._actors[`mound${this._hotMound}`];
      if (mound) return { x: mound.x, y: mound.y - 34, actor: mound };
      return { x: w / 2, y: Math.round(h * 0.70) };
    }
    const center = this._dryCenter(w, h);
    const tray = this._actors.tray;
    return { x: tray ? tray.x : center.x, y: (tray ? tray.y : center.y) - 24, actor: tray };
  }

  private _resolve(grade: TimingGrade): void {
    const def = this._def;
    if (!def || this._phase === 'resolve' || this._phase === 'done') return;
    this._lastGrade = grade;
    if (grade === 'hit') this._hitCount += 1;

    const drop = resolveSpecialDrop(def, grade, this._rng);
    const line = specialResultLine(def, grade, drop);
    const origin = this._activePropOrigin(def);

    if (drop) {
      const extracted = toSpecialExtracted(drop.defId, drop.quality);
      this._haul.push(extracted);
      this._flyingUid = extracted.uid;
      RunManager.saveSpecialCheckpoint(def.id, this._round, this._haul);
      const firstSeen = KitchenManager.discoverFood(drop.defId, drop.quality);
      const wet = getItem(drop.defId).zone === 'wet';
      if (grade === 'hit') AudioManager.playGain();
      else AudioManager.play('gather');
      AudioManager.play(wet ? 'pickup_wet' : 'pickup_veg');

      // 先刷新 HUD 以锁定底部竹篓目标格坐标（飞行途中由 _flyingUid 暂缓显示新增的 +1）
      this._drawHud(def);
      this._playDropHarvestFx({
        defId: drop.defId,
        quality: drop.quality,
        uid: extracted.uid,
        firstSeen,
        perfect: grade === 'hit',
        line,
        originX: origin.x,
        originY: origin.y,
      });
    } else {
      AudioManager.play('ui_deny');
      this._drawHud(def);
      this._playMissFx(line, origin.x, origin.y, origin.actor);
    }

    this._setPhase('resolve', SPECIAL_TIMING.resolveHold);
  }

  private _playDropHarvestFx(opts: {
    defId: string;
    quality: Quality;
    uid: string;
    firstSeen: boolean;
    perfect: boolean;
    line: string;
    originX: number;
    originY: number;
  }): void {
    const w = Game.designWidth;
    const dropTier = resolveRarityTier(itemRarity(opts.defId), opts.quality);
    const style = rarityStyleOf(dropTier);

    // 1. 道具斜上方清透无底框彩色描边飘字（完全不压下方道具主体！）
    const floatCopy = opts.perfect ? `✦ 好手！${opts.line}` : `+ ${opts.line}`;
    const floatColor = dropTier === 'common'
      ? (opts.perfect ? 0xFFE996 : CREAM)
      : style.float;
    const floatWrap = new PIXI.Container();
    floatWrap.eventMode = 'none';
    const floatTxt = makeText('title', floatCopy, floatColor, {
      size: opts.perfect ? 32 : 28,
      stroke: DARK_STROKE,
      strokeWidth: 6.5,
    });
    floatTxt.anchor.set(0.5);
    fitTextWidth(floatTxt, w - 64);
    floatWrap.addChild(floatTxt);

    const fxStartX = Math.max(150, Math.min(w - 150, opts.originX));
    const fxStartY = Math.max(205, opts.originY - 122);
    floatWrap.position.set(fxStartX, fxStartY);
    floatWrap.scale.set(0.68);
    this._fx.addChild(floatWrap);

    TweenManager.to({
      target: floatWrap.scale,
      props: { x: 1.04, y: 1.04 },
      duration: 0.20,
      ease: Ease.easeOutBack,
      onComplete: () => {
        if (!isStageMounted(floatWrap)) return;
        TweenManager.to({
          target: floatWrap.scale,
          props: { x: 1, y: 1 },
          duration: 0.14,
          ease: Ease.easeOutQuad,
        });
      },
    });
    TweenManager.to({
      target: floatWrap,
      props: { y: fxStartY - 76 },
      duration: 0.90,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: floatWrap,
      props: { alpha: 0 },
      delay: 0.58,
      duration: 0.32,
      ease: Ease.linear,
      onComplete: () => destroyDisplayNode(floatWrap),
    });

    // 2. 无盘鲜货主体从触发道具真实坐标轻盈跃起 -> 二阶贝塞尔弧线飞入底部对应竹篓格！
    const flyNode = new PIXI.Container();
    flyNode.eventMode = 'none';
    flyNode.position.set(opts.originX, opts.originY);
    flyNode.scale.set(0.38);

    const iconSpr = new PIXI.Sprite(itemLookTexture(opts.defId, 'clean'));
    iconSpr.anchor.set(0.5);
    const bindIcon = (): void => {
      if (iconSpr.destroyed) return;
      const tex = itemLookTexture(opts.defId, 'clean');
      if (isTextureReady(tex)) {
        iconSpr.texture = tex;
        fitSpriteInBox(iconSpr, 94, 94);
      }
    };
    bindIcon();
    whenTextureReady(resolveItemAssetPath(opts.defId), bindIcon);
    flyNode.addChild(iconSpr);
    attachSpriteContour(flyNode, iconSpr, dropTier, {
      onDark: true,
      selected: opts.perfect || dropTier !== 'common',
      thicknessScale: 1.1,
    });

    if (dropTier !== 'common') {
      const rSeal = makeRaritySeal(dropTier, 34, -0.08);
      rSeal.position.set(-46, -36);
      flyNode.addChild(rSeal);
    }
    if (opts.perfect) {
      const seal = this._makeMiniGoodHandSeal();
      seal.position.set(46, -36);
      flyNode.addChild(seal);
    }
    if (opts.firstSeen) {
      const newBadge = makeNewFoodTag(19);
      newBadge.position.set(0, -64);
      flyNode.addChild(newBadge);
    }
    this._fx.addChild(flyNode);

    const peakX = opts.originX;
    const peakY = opts.originY - 86;

    // 第一段（0 ~ 0.34s）：从道具口清透弹起
    TweenManager.to({
      target: flyNode.scale,
      props: { x: 1.08, y: 1.08 },
      duration: 0.22,
      ease: Ease.easeOutBack,
      onComplete: () => {
        if (!isStageMounted(flyNode)) return;
        TweenManager.to({
          target: flyNode.scale,
          props: { x: 1, y: 1 },
          duration: 0.12,
          ease: Ease.easeOutQuad,
        });
      },
    });
    TweenManager.to({
      target: flyNode,
      props: { x: peakX, y: peakY },
      duration: 0.34,
      ease: Ease.easeOutQuad,
      onComplete: () => {
        if (!isStageMounted(flyNode)) return;
        // 第二段（0.35s ~ 0.83s）：二阶贝塞尔弧线带流光飞入底部收获竹篓对应格！
        const slotKey = `${opts.defId}__${opts.quality}`;
        const slotInfo = this._haulSlots.get(slotKey);
        const destX = slotInfo ? slotInfo.x : w / 2;
        const destY = slotInfo ? slotInfo.y - 6 : this._haulTopY() + 42;
        const sideBend = peakX < destX ? -56 : 56;
        const ctrlX = (peakX + destX) * 0.5 + sideBend;
        const ctrlY = Math.min(peakY, destY) - 108;

        const state = { t: 0, lastTrail: 0 };
        TweenManager.to({
          target: state,
          props: { t: 1 },
          duration: 0.48,
          ease: Ease.easeInOutQuad,
          onUpdate: () => {
            if (!isStageMounted(flyNode)) return;
            const u = 1 - state.t;
            const bx = u * u * peakX + 2 * u * state.t * ctrlX + state.t * state.t * destX;
            const by = u * u * peakY + 2 * u * state.t * ctrlY + state.t * state.t * destY;
            flyNode.position.set(bx, by);
            const sc = 1 - state.t * 0.44;
            flyNode.scale.set(sc);

            if (state.t - state.lastTrail >= 0.11 && state.t < 0.9) {
              state.lastTrail = state.t;
              this._spawnTrailMote(bx, by, dropTier === 'common' ? 0xFFE9A6 : style.glow);
            }
          },
          onComplete: () => {
            destroyDisplayNode(flyNode);
            if (this._flyingUid === opts.uid) {
              this._flyingUid = null;
            }
            if (!this.container.parent || !this._def) return;
            AudioManager.play('basket_place');
            this._drawHud(this._def);
            const landed = this._haulSlots.get(slotKey);
            this._playSlotLandingPop(
              landed ? landed.x : destX,
              landed ? landed.y : destY,
              dropTier,
              landed?.cell,
            );
          },
        });
      },
    });
  }

  private _spawnTrailMote(x: number, y: number, color: number): void {
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    g.beginFill(color, 0.85);
    g.drawCircle(0, 0, 5);
    g.endFill();
    g.position.set(x, y);
    this._fx.addChild(g);
    TweenManager.to({
      target: g,
      props: { alpha: 0, y: y - 14 },
      duration: 0.24,
      ease: Ease.easeOutQuad,
      onComplete: () => destroyDisplayNode(g),
    });
    TweenManager.to({
      target: g.scale,
      props: { x: 0.2, y: 0.2 },
      duration: 0.24,
      ease: Ease.linear,
    });
  }

  private _playSlotLandingPop(
    x: number,
    y: number,
    tier: RarityTier,
    cell?: PIXI.Container,
  ): void {
    const ringColor = tier === 'common' ? 0xFFE699 : rarityStyleOf(tier).glow;
    const burst = new PIXI.Graphics();
    burst.eventMode = 'none';
    burst.lineStyle(2.4, ringColor, 0.86);
    burst.drawRoundedRect(-28, -28, 56, 56, 12);
    burst.position.set(x, y - 4);
    burst.scale.set(0.72);
    this._fx.addChild(burst);
    TweenManager.to({
      target: burst.scale,
      props: { x: 1.28, y: 1.28 },
      duration: 0.26,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: burst,
      props: { alpha: 0 },
      duration: 0.26,
      ease: Ease.linear,
      onComplete: () => destroyDisplayNode(burst),
    });

    if (cell && isStageMounted(cell)) {
      cell.scale.set(1.22);
      TweenManager.to({
        target: cell.scale,
        props: { x: 1, y: 1 },
        duration: 0.26,
        ease: Ease.easeOutBack,
      });
    }
  }

  private _playMissFx(
    line: string,
    originX: number,
    originY: number,
    actor?: PIXI.Container,
  ): void {
    const w = Game.designWidth;
    // 对应道具与底部木牌大钮轻巧左右顿挫抖动
    const shakeNode = (node: PIXI.Container | null | undefined, amp: number): void => {
      if (!node || !isStageMounted(node)) return;
      const baseX = node.x;
      const st = { t: 0 };
      TweenManager.to({
        target: st,
        props: { t: 1 },
        duration: 0.28,
        ease: Ease.linear,
        onUpdate: () => {
          if (!node.destroyed) {
            node.x = baseX + Math.sin(st.t * Math.PI * 5) * amp * (1 - st.t);
          }
        },
        onComplete: () => {
          if (!node.destroyed) node.x = baseX;
        },
      });
    };
    shakeNode(actor, 9);
    shakeNode(this._drumFace, 7);

    // 干净利落的无底框暖珊瑚红描边飘字
    const txt = makeText('title', line, CORAL_MISS, {
      size: 29,
      stroke: 0x24120A,
      strokeWidth: 6.5,
    });
    txt.anchor.set(0.5);
    fitTextWidth(txt, w - 64);
    const sx = Math.max(140, Math.min(w - 140, originX));
    const sy = Math.max(210, originY - 68);
    txt.position.set(sx, sy);
    txt.scale.set(0.75);
    this._fx.addChild(txt);

    TweenManager.to({
      target: txt.scale,
      props: { x: 1, y: 1 },
      duration: 0.18,
      ease: Ease.easeOutBack,
    });
    TweenManager.to({
      target: txt,
      props: { y: sy - 64 },
      duration: 0.78,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: txt,
      props: { alpha: 0 },
      delay: 0.48,
      duration: 0.30,
      ease: Ease.linear,
      onComplete: () => destroyDisplayNode(txt),
    });
  }

  private _makeMiniGoodHandSeal(): PIXI.Container {
    const seal = new PIXI.Container();
    seal.eventMode = 'none';
    this._watchOnce(SPECIAL_ART.seal);
    const sTex = gameTexture(SPECIAL_ART.seal);
    if (isTextureReady(sTex)) {
      const sp = new PIXI.Sprite(sTex);
      fitSpriteInBox(sp, 38, 38);
      sp.anchor.set(0.5);
      seal.addChild(sp);
    } else {
      const sg = new PIXI.Graphics();
      sg.beginFill(0xC43426, 1);
      sg.drawRoundedRect(-19, -19, 38, 38, 7);
      sg.endFill();
      seal.addChild(sg);
    }
    const st = makeText('caption', '好手', 0xFFF4E6, { size: 15, fontWeight: '700' });
    st.anchor.set(0.5);
    seal.addChild(st);
    seal.rotation = 0.10;
    return seal;
  }

  private _nextRound(): void {
    const def = this._def;
    if (!def) return;
    this._flyingUid = null;
    this._round += 1;
    if (this._round >= def.rounds) {
      this._finish();
      return;
    }
    RunManager.saveSpecialCheckpoint(def.id, this._round, this._haul);
    this._drawPlay(def);
    this._drawHud(def);
    this._setPhase('idle', this._idleDur());
  }

  private _finish(): void {
    if (this._settled || !this._def) return;
    this._settled = true;
    this._phase = 'done';
    this._flyingUid = null;
    this._loot.close(true);
    this._inspect = null;
    this._inspectHost.visible = false;
    destroyDisplayChildren(this._inspectHost);
    destroyDisplayChildren(this._fx);

    const unpack = KitchenManager.receiveExtract(this._haul);
    const extract = {
      kind: 'safe' as const,
      items: this._haul,
      lost: 0,
      needsPick: unpack.needsPick,
    };
    analytics.trackSpecialMarketComplete({
      marketId: this._def.id,
      durationMs: Math.max(0, Date.now() - this._enteredAt),
      roundsPlayed: this._round,
      roundsTotal: this._def.rounds,
      itemCount: this._haul.length,
      haulValue: this._haul.reduce((s, it) => s + Math.max(0, it.sell), 0),
      hitCount: this._hitCount,
      earlyLeave: this._round < this._def.rounds,
      needsPick: unpack.needsPick,
    });
    RunManager.settleSpecialCheckpoint(extract);
    this._result.open(extract);
  }

  private _setPhase(phase: Phase, dur: number): void {
    this._phase = phase;
    this._phaseT = 0;
    this._phaseDur = dur;
    this._tickActors();
  }

  private _idleDur(): number {
    return this._rand(SPECIAL_TIMING.idleMin, SPECIAL_TIMING.idleMax);
  }

  private _rand(min: number, max: number): number {
    return min + this._rng() * (max - min);
  }
}
