import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { AudioManager } from '@/core/AudioManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { ResultPanel } from '@/gameobjects/ui/ResultPanel';
import {
  SPECIAL_TIMING,
  buffIconPath,
  getItem,
  getSpecialMarket,
  itemRarity,
  liveHudBuffs,
  mulberry32,
  newSeed,
  resolveSpecialDrop,
  rngInt,
  sellPrice,
  specialLootIds,
  specialResultLine,
  toSpecialExtracted,
  type ExtractedItem,
  type SpecialMarketDef,
  type SpecialMarketId,
  type TimingGrade,
} from '@/sim';
import { ensureHudBuffPanel } from '@/gameobjects/ui/HudBuffPanel';
import {
  inspectFromFood,
  inspectFromItem,
  makeItemInspectCard,
  type ItemInspectView,
} from '@/gameobjects/ui/ItemInspectCard';
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
import {
  HUD_ICON,
  fillRect,
  fitTextWidth,
  makeMuteButton,
  makeNewFoodTag,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';

type Phase = 'idle' | 'telegraph' | 'hitWindow' | 'late' | 'resolve' | 'done';

const SPECIAL_SCENE_ART = {
  plaque: 'subpkg_images/scene_pk_plaque.png',
  plate: 'subpkg_images/scene_pk_plate.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  sheet: 'subpkg_images/scene_pk_recipe_sheet.png',
  slip: 'subpkg_kitchen/ui_kitchen_slip.png',
} as const;

const INK = 0x2A2018;
const RED_INK = 0xB8361F;
const GREEN_INK = 0x2F6E2A;
const CREAM = 0xFFF8EC;

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
  private _result = new ResultPanel();
  private _boundUpdate = () => this.update(Game.ticker.deltaMS / 1000);
  private _def: SpecialMarketDef | null = null;
  private _rng = mulberry32(1);
  private _round = 0;
  private _haul: ExtractedItem[] = [];
  private _phase: Phase = 'idle';
  private _phaseT = 0;
  private _phaseDur = 1;
  private _hotJar = 2;
  private _actors: Record<string, PIXI.Container> = {};
  private _cueWrap: PIXI.Container | null = null;
  private _cueText: PIXI.Text | null = null;
  private _settled = false;
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
    this.container.addChild(this._bg);
    this.container.addChild(this._play);
    this.container.addChild(this._fx);
    this.container.addChild(this._hud);
    this._inspectHost.zIndex = 27;
    this._inspectHost.visible = false;
    this.container.eventMode = 'static';
    this.container.on('pointertap', () => {
      if (this._inspect) return;
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
    this._inspect = null;
    this._paintQueued = false;
    this._inspectHost.visible = false;
    OverlayManager.container.addChild(this._inspectHost);
    this._rng = mulberry32(newSeed());
    this._round = 0;
    this._haul = [];
    this._settled = false;
    this._phase = 'idle';
    this._phaseT = 0;
    this._phaseDur = this._idleDur();
    AudioManager.playMarketBgm(this._def.bgmMarket);
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    watchTextures(
      [
        this._def.bg,
        ...Object.values(SPECIAL_SCENE_ART),
        HUD_ICON.clock,
        HUD_ICON.basket,
        HUD_ICON.coin,
        ...specialLootIds(this._def).slice(0, 5).map((fid) => resolveItemAssetPath(fid)),
      ],
      this._schedulePaint,
    );
    Game.ticker.remove(this._boundUpdate);
    Game.ticker.add(this._boundUpdate);
    this._paint();
  }

  onExit(): void {
    Game.ticker.remove(this._boundUpdate);
    this._paintQueued = false;
    this._play.removeChildren();
    this._fx.removeChildren();
    this._inspect = null;
    this._inspectHost.visible = false;
    this._inspectHost.removeChildren();
    if (this._inspectHost.parent) this._inspectHost.parent.removeChild(this._inspectHost);
    this._actors = {};
    this._cueWrap = null;
    this._cueText = null;
  }

  relayout(): void {
    if (!this._def) return;
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    this._paint();
  }

  update(dt: number): void {
    if (!this._def || this._phase === 'done' || this._inspect) return;
    this._phaseT += dt;
    if (this._phaseT >= this._phaseDur) {
      this._advance();
    }
    this._tickActors();
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
    this._inspectHost.removeChildren();
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
        this._inspectHost.removeChildren();
      },
    }));
  }

  private _drawBg(def: SpecialMarketDef): void {
    this._bg.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, def.flavor === 'fish' ? 0x1A3040 : def.flavor === 'dry' ? 0x3A2A1C : 0x241820);
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
    const vignette = new PIXI.Graphics();
    vignette.beginFill(0x140C06, 0.24);
    vignette.drawRect(0, 0, w, h);
    vignette.endFill();
    this._bg.addChild(vignette);
  }

  private _drawHud(def: SpecialMarketDef): void {
    this._hud.removeChildren();
    const w = Game.designWidth;
    const top = Math.max(8, Number.isFinite(Game.safeTop) ? Game.safeTop : 96);
    const onReady = this._schedulePaint;

    // 1. 顶部居中悬挂木招牌（34pt）
    const pw = 312;
    const plaqueWrap = new PIXI.Container();
    plaqueWrap.position.set((w - pw) / 2, top - 28);
    plaqueWrap.eventMode = 'none';
    const pTex = gameTexture(SPECIAL_SCENE_ART.plaque);
    let faceCy = 76;
    if (isTextureReady(pTex)) {
      const sp = new PIXI.Sprite(pTex);
      sp.width = pw;
      sp.scale.y = sp.scale.x;
      plaqueWrap.addChild(sp);
      faceCy = sp.height * 0.64;
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(3, INK, 1);
      g.beginFill(0xC89660, 1);
      g.drawRoundedRect(0, 32, pw, 82, 14);
      g.endFill();
      plaqueWrap.addChild(g);
      faceCy = 73;
    }
    const title = makeText('display', def.name, 0x4A2A12, {
      size: 34,
      stroke: 0xF6DDB0,
      strokeWidth: 3,
    });
    title.anchor.set(0.5);
    fitTextWidth(title, pw - 52);
    title.position.set(pw / 2, faceCy);
    plaqueWrap.addChild(title);
    this._hud.addChild(plaqueWrap);

    if (this._haul.length > 0 && !this._settled) {
      const leaveBtn = makeSlicedButton({
        label: '收摊带走',
        width: 152,
        height: 50,
        skin: 'terracotta',
        fontSize: 22,
        onReady,
      });
      leaveBtn.position.set(16, top + 12);
      leaveBtn.on('pointertap', (e) => {
        e.stopPropagation();
        this._finish();
      });
      this._hud.addChild(leaveBtn);
    }

    const mute = makeMuteButton(48);
    mute.position.set(w - 64, top + 12);
    mute.on('pointertap', (e) => e.stopPropagation());
    this._hud.addChild(mute);

    // 2. 第二行：轮次宣纸签 + 已收鲜货签 + 增益 Buff
    const rowY = top + 102;
    const roundSlip = this._makeInfoSlip(
      HUD_ICON.clock,
      `第 ${Math.min(this._round + 1, def.rounds)}/${def.rounds} 手`,
      216,
    );
    roundSlip.position.set(w / 2 - 216 - 8, rowY);
    this._hud.addChild(roundSlip);

    const bagSlip = this._makeInfoSlip(
      HUD_ICON.basket,
      `已收 ${this._haul.length} 件`,
      196,
    );
    bagSlip.position.set(w / 2 + 8, rowY);
    this._hud.addChild(bagSlip);

    const buffs = liveHudBuffs(KitchenManager.save);
    if (buffs.length) {
      const buffRow = new PIXI.Container();
      const bSize = 40;
      buffs.forEach((buff, i) => {
        const path = buffIconPath(buff.icon);
        this._watchOnce(path);
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
      buffRow.position.set((w - buffs.length * 48 + 8) / 2, rowY + 54);
      this._hud.addChild(buffRow);
    }

    // 3. 摊主对话纸笺 + 今晚招牌青花瓷碟货架（增高留白，品名绝不压底框）
    const shelfTop = rowY + (buffs.length ? 102 : 58);
    this._drawStallShelf(def, w, shelfTop);

    // 4. 底部流动摊车木托盘收获栏
    this._drawHaulStrip(w);
  }

  private _makeInfoSlip(icon: string, text: string, width: number): PIXI.Container {
    const root = new PIXI.Container();
    root.eventMode = 'none';
    const h = 48;
    const barX = 18;
    const barW = width - barX;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x140B05, 0.28);
    bg.drawRoundedRect(barX, 4, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2.4, INK, 1);
    bg.beginFill(0xFAF0DA, 0.98);
    bg.drawRoundedRect(barX, 0, barW, h, 10);
    bg.endFill();
    bg.lineStyle(2, INK, 1);
    bg.beginFill(0x7A4B24, 1);
    bg.drawRoundedRect(barX + barW - 8, -1, 8, h + 2, 4);
    bg.endFill();
    root.addChild(bg);

    const lbl = makeText('number', text, INK, { size: 24 });
    lbl.anchor.set(0.5);
    fitTextWidth(lbl, barW - 34);
    lbl.position.set(barX + 20 + (barW - 34) / 2, h / 2 - 0.5);
    root.addChild(lbl);

    this._watchOnce(icon);
    const icTex = gameTexture(icon);
    if (isTextureReady(icTex)) {
      const sp = new PIXI.Sprite(icTex);
      fitSpriteInBox(sp, 50, 50);
      sp.anchor.set(0.5);
      sp.position.set(22, h / 2);
      root.addChild(sp);
    }
    return root;
  }

  /** 摊主纸笺吆喝 + 4 碟招牌鲜货预览（充裕底距，品名清晰居中于宣纸内芯）。 */
  private _drawStallShelf(def: SpecialMarketDef, w: number, topY: number): void {
    const boxW = w - 40;
    const boxH = 190;
    const x = 20;
    const panel = new PIXI.Container();
    panel.position.set(x, topY);
    panel.eventMode = 'static';
    panel.on('pointertap', (e) => e.stopPropagation());

    const bg = new PIXI.Graphics();
    bg.beginFill(0x140A04, 0.34);
    bg.drawRoundedRect(4, 6, boxW - 8, boxH - 2, 16);
    bg.endFill();
    bg.lineStyle(2.6, INK, 1);
    bg.beginFill(0x6B4022, 0.96);
    bg.drawRoundedRect(0, 0, boxW, boxH, 16);
    bg.endFill();
    bg.lineStyle(1.4, 0xDFB870, 0.8);
    bg.beginFill(0xFAF0DA, 0.97);
    bg.drawRoundedRect(8, 8, boxW - 16, boxH - 18, 12);
    bg.endFill();
    panel.addChild(bg);

    const note = makeText('body', `摊主招呼：「${def.hint}」 · 点碟鉴赏鲜货`, INK, {
      size: 21,
      fontWeight: '700',
    });
    note.position.set(22, 16);
    fitTextWidth(note, boxW - 44);
    panel.addChild(note);

    const items = specialLootIds(def).slice(0, 4);
    const colW = (boxW - 32) / Math.max(1, items.length);
    const plateTex = gameTexture(SPECIAL_SCENE_ART.plate);
    const coinTex = gameTexture(HUD_ICON.coin);

    items.forEach((id, idx) => {
      const itemDef = getItem(id);
      const price = sellPrice(id, 'fresh', true);
      const cx = 16 + colW * (idx + 0.5);
      const cell = new PIXI.Container();
      cell.position.set(cx, 92);

      if (isTextureReady(plateTex)) {
        const pl = new PIXI.Sprite(plateTex);
        fitSpriteInBox(pl, 108, 76);
        pl.anchor.set(0.5);
        pl.position.set(0, 4);
        cell.addChild(pl);
      } else {
        const g = new PIXI.Graphics();
        g.lineStyle(1.8, 0x4A6B8A, 0.8);
        g.beginFill(0xFFFDF8, 1);
        g.drawEllipse(0, 6, 46, 22);
        g.endFill();
        cell.addChild(g);
      }

      const iPath = resolveItemAssetPath(id);
      this._watchOnce(iPath);
      const fTex = itemLookTexture(id, 'clean');
      if (isTextureReady(fTex)) {
        const sp = new PIXI.Sprite(fTex);
        fitSpriteInBox(sp, 58, 58);
        sp.anchor.set(0.5, 1);
        sp.position.set(0, 14);
        cell.addChild(sp);
      }

      const nm = makeText('caption', itemDef.name, INK, { size: 20, fontWeight: '700' });
      nm.anchor.set(0.5);
      fitTextWidth(nm, colW - 12);
      nm.position.set(0, 50);
      cell.addChild(nm);

      if (price > 0) {
        const vTag = new PIXI.Container();
        let vx = 0;
        if (isTextureReady(coinTex)) {
          const cs = new PIXI.Sprite(coinTex);
          fitSpriteInBox(cs, 20, 20);
          cs.anchor.set(0, 0.5);
          vTag.addChild(cs);
          vx = 22;
        }
        const vt = makeText('caption', `${price}`, 0x8F5608, {
          size: 20,
          fontWeight: '700',
          stroke: 0xFFFDF7,
          strokeWidth: 3,
        });
        vt.anchor.set(0, 0.5);
        vt.position.set(vx, 0);
        vTag.addChild(vt);
        vTag.position.set(16, -30);
        cell.addChild(vTag);
      }

      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(-colW / 2 + 4, -44, colW - 8, 118);
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        const v = inspectFromItem(id);
        if (v) v.note = `${v.note ?? ''} · ${def.name}招牌鲜货`;
        this._inspect = v;
        this._paintInspect();
      });
      panel.addChild(cell);
    });

    this._hud.addChild(panel);
  }

  private _drawHaulStrip(w: number): void {
    const trayW = w - 40;
    const trayH = 116;
    const x = 20;
    const y = Game.logicHeight - Math.max(20, Game.safeBottom + 14) - trayH;

    const tray = new PIXI.Container();
    tray.position.set(x, y);
    tray.eventMode = 'static';
    tray.on('pointertap', (e) => e.stopPropagation());

    const bg = new PIXI.Graphics();
    bg.beginFill(0x120A04, 0.36);
    bg.drawRoundedRect(2, 6, trayW - 4, trayH - 2, 16);
    bg.endFill();
    bg.lineStyle(2.8, INK, 1);
    bg.beginFill(0x6B4022, 0.96);
    bg.drawRoundedRect(0, 0, trayW, trayH, 16);
    bg.endFill();
    bg.lineStyle(1.4, 0xB8824C, 0.85);
    bg.beginFill(0x8A5630, 0.95);
    bg.drawRoundedRect(8, 8, trayW - 16, trayH - 18, 12);
    bg.endFill();
    tray.addChild(bg);

    if (!this._haul.length) {
      const empty = makeText('body', '木托盘还空着 · 看准时机点摊面收鲜货！', CREAM, {
        size: 23,
        stroke: INK,
        strokeWidth: 4,
      });
      empty.anchor.set(0.5);
      fitTextWidth(empty, trayW - 44);
      empty.position.set(trayW / 2, trayH / 2 - 2);
      tray.addChild(empty);
      this._hud.addChild(tray);
      return;
    }

    const shown = this._haul.slice(-5);
    const slotW = (trayW - 28) / 5;
    const plateTex = gameTexture(SPECIAL_SCENE_ART.plate);

    shown.forEach((it, i) => {
      const cx = 14 + slotW * (i + 0.5);
      const cell = new PIXI.Container();
      cell.position.set(cx, 48);

      if (isTextureReady(plateTex)) {
        const pl = new PIXI.Sprite(plateTex);
        fitSpriteInBox(pl, 102, 72);
        pl.anchor.set(0.5);
        pl.position.set(0, 4);
        cell.addChild(pl);
      }

      const tex = itemLookTexture(it.defId, 'clean');
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, 58, 58);
        sp.anchor.set(0.5, 1);
        sp.position.set(0, 14);
        cell.addChild(sp);
      }

      const shortName = getItem(it.defId).name;
      const nm = makeText('caption', shortName, CREAM, {
        size: 20,
        fontWeight: '700',
        stroke: 0x241408,
        strokeWidth: 4,
      });
      nm.anchor.set(0.5);
      fitTextWidth(nm, slotW - 8);
      nm.position.set(0, 42);
      cell.addChild(nm);

      cell.eventMode = 'static';
      cell.cursor = 'pointer';
      cell.hitArea = new PIXI.Rectangle(-slotW / 2 + 2, -40, slotW - 4, 102);
      cell.on('pointertap', (e) => {
        e.stopPropagation();
        AudioManager.play('ui_click');
        this._inspect = inspectFromFood({ defId: it.defId, quality: it.quality, inspected: true });
        this._paintInspect();
      });
      tray.addChild(cell);
    });

    this._hud.addChild(tray);
  }

  private _drawPlay(def: SpecialMarketDef): void {
    this._play.removeChildren();
    this._actors = {};
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const cy = Math.round(h * 0.60);
    if (def.flavor === 'spice') this._buildSpice(w, cy);
    else if (def.flavor === 'fish') this._buildFish(w, cy);
    else this._buildDry(w, cy);

    const cueWrap = new PIXI.Container();
    cueWrap.position.set(w / 2, Math.round(h * 0.785));
    cueWrap.eventMode = 'none';

    const cw = 420;
    const ch = 60;
    const cbg = new PIXI.Graphics();
    cbg.name = 'cueBg';
    cbg.beginFill(0x140A04, 0.32);
    cbg.drawRoundedRect(-cw / 2, -ch / 2 + 4, cw, ch, 14);
    cbg.endFill();
    cbg.lineStyle(2.6, INK, 1);
    cbg.beginFill(0xFAF0DA, 0.97);
    cbg.drawRoundedRect(-cw / 2, -ch / 2, cw, ch, 14);
    cbg.endFill();
    cueWrap.addChild(cbg);

    const cue = makeText('heading', def.cue, INK, { size: 28 });
    cue.anchor.set(0.5);
    cueWrap.addChild(cue);

    this._play.addChild(cueWrap);
    this._cueWrap = cueWrap;
    this._cueText = cue;
  }

  private _buildSpice(w: number, cy: number): void {
    const JAR = 'subpkg_images/special_spice_jar.png';
    const LID = 'subpkg_images/special_spice_jar_lid.png';
    this._watchOnce(JAR);
    this._watchOnce(LID);

    const counter = new PIXI.Graphics();
    counter.beginFill(0x140A04, 0.34);
    counter.drawRoundedRect(32, cy + 32, w - 64, 34, 12);
    counter.endFill();
    counter.lineStyle(3, INK, 1);
    counter.beginFill(0x7A4B24, 1);
    counter.drawRoundedRect(28, cy + 26, w - 56, 32, 10);
    counter.endFill();
    counter.lineStyle(0);
    counter.beginFill(0xA66E3E, 0.8);
    counter.drawRoundedRect(34, cy + 29, w - 68, 9, 4);
    counter.endFill();
    this._play.addChild(counter);

    const jarTex = gameTexture(JAR);
    const lidTex = gameTexture(LID);
    const jars = 5;
    const gap = 124;
    const start = w / 2 - ((jars - 1) * gap) / 2;
    for (let i = 0; i < jars; i++) {
      const jar = new PIXI.Container();
      if (isTextureReady(jarTex)) {
        const body = new PIXI.Sprite(jarTex);
        fitSpriteInBox(body, 92, 102);
        body.anchor.set(0.5, 1);
        body.position.set(0, 36);
        body.eventMode = 'none';
        jar.addChild(body);
      } else {
        const body = new PIXI.Graphics();
        body.lineStyle(2.5, INK, 1);
        body.beginFill(0x8B5A2B);
        body.drawRoundedRect(-32, -16, 64, 80, 18);
        body.endFill();
        jar.addChild(body);
      }
      const steam = new PIXI.Graphics();
      steam.name = 'steam';
      jar.addChild(steam);
      if (isTextureReady(lidTex)) {
        const lid = new PIXI.Sprite(lidTex);
        fitSpriteInBox(lid, 96, 48);
        lid.anchor.set(0.5, 1);
        lid.position.set(0, -34);
        lid.eventMode = 'none';
        lid.name = 'lid';
        jar.addChild(lid);
      } else {
        const lid = new PIXI.Graphics();
        lid.lineStyle(2, INK, 1);
        lid.beginFill(0xE8C47A);
        lid.drawRoundedRect(-36, -28, 72, 24, 8);
        lid.endFill();
        lid.name = 'lid';
        jar.addChild(lid);
      }
      jar.position.set(start + i * gap, cy);
      this._play.addChild(jar);
      this._actors[`jar${i}`] = jar;
    }
  }

  private _buildFish(w: number, cy: number): void {
    const water = new PIXI.Graphics();
    water.beginFill(0x1E4B5C, 0.78);
    water.drawEllipse(0, 0, 248, 80);
    water.endFill();
    water.lineStyle(2.5, 0x8CE0DC, 0.42);
    water.drawEllipse(0, 0, 210, 62);
    water.lineStyle(0);
    water.beginFill(0x8CE0DC, 0.28);
    water.drawEllipse(-46, -20, 82, 18);
    water.endFill();
    water.position.set(w / 2 - 16, cy + 32);
    this._play.addChild(water);

    const ripple = new PIXI.Graphics();
    ripple.name = 'ripple';
    ripple.position.set(w / 2 - 8, cy + 28);
    this._play.addChild(ripple);
    this._actors.ripple = ripple;

    const rod = new PIXI.Graphics();
    rod.lineStyle(7, 0x8B5A2B, 1);
    rod.moveTo(w - 64, cy - 170);
    rod.lineTo(w / 2 + 40, cy - 42);
    rod.lineStyle(2.2, 0xF5E8CE, 0.95);
    rod.moveTo(w / 2 + 40, cy - 42);
    rod.lineTo(w / 2 - 8, cy + 8);
    this._play.addChild(rod);

    const bobber = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.lineStyle(2.2, INK, 1);
    g.beginFill(0xD93B28);
    g.drawCircle(0, -12, 12);
    g.endFill();
    g.beginFill(0xFFF6EA);
    g.drawCircle(0, 4, 11);
    g.endFill();
    bobber.addChild(g);
    bobber.position.set(w / 2 - 8, cy + 8);
    this._play.addChild(bobber);
    this._actors.bobber = bobber;
  }

  private _buildDry(w: number, cy: number): void {
    const tray = new PIXI.Container();
    const board = new PIXI.Graphics();
    board.beginFill(0x140A04, 0.28);
    board.drawRoundedRect(-170, -76, 340, 160, 24);
    board.endFill();
    board.lineStyle(6, 0x7A4B24, 1);
    board.beginFill(0xCFA86E);
    board.drawRoundedRect(-172, -80, 344, 160, 24);
    board.endFill();
    board.lineStyle(2, 0x9C6B38, 0.8);
    board.beginFill(0xF0CE7E);
    board.drawEllipse(0, 0, 128, 56);
    board.endFill();
    tray.addChild(board);
    tray.position.set(w / 2, cy);
    this._play.addChild(tray);
    this._actors.tray = tray;
    this._actors.trayFace = board;
  }

  private _tickActors(): void {
    const def = this._def;
    if (!def) return;
    const p = Math.min(1, this._phaseT / Math.max(0.001, this._phaseDur));
    if (def.flavor === 'spice') this._tickSpice(p);
    else if (def.flavor === 'fish') this._tickFish(p);
    else this._tickDry(p);

    if (this._cueWrap && this._cueText) {
      const hit = this._phase === 'hitWindow';
      const live = this._phase === 'telegraph' || hit;
      this._cueWrap.alpha = hit ? 1 : live ? 0.94 : 0.78;
      this._cueWrap.scale.set(hit ? 1.07 : 1);
      const wantCopy = hit ? `✦ 趁现在点！${def.cue}！` : def.cue;
      if (this._cueText.text !== wantCopy) {
        this._cueText.text = wantCopy;
        this._cueText.style.fill = hit ? RED_INK : INK;
      }
    }
  }

  private _tickSpice(p: number): void {
    for (let i = 0; i < 5; i++) {
      const jar = this._actors[`jar${i}`];
      if (!jar) continue;
      const lid = jar.getChildByName('lid') as PIXI.Graphics | null;
      const steam = jar.getChildByName('steam') as PIXI.Graphics | null;
      const hot = i === this._hotJar;
      let lidY = 0;
      let steamA = 0;
      let steamS = 0.2;
      if (hot && this._phase === 'telegraph') {
        lidY = -Math.abs(Math.sin(p * Math.PI * 6)) * (9 + p * 11);
        steamA = 0.28 + p * 0.56;
        steamS = 0.38 + p * 0.72;
      } else if (hot && this._phase === 'hitWindow') {
        lidY = -26;
        steamA = 0.96;
        steamS = 1.2 + Math.sin(this._phaseT * 18) * 0.1;
      } else if (hot && this._phase === 'late') {
        lidY = -8 * (1 - p);
        steamA = 0.5 * (1 - p);
        steamS = 0.8 * (1 - p);
      }
      if (lid) lid.y = -34 + lidY;
      if (steam) {
        steam.clear();
        if (steamA > 0.02) {
          steam.beginFill(0xFFF8EC, steamA);
          steam.drawCircle(-9, -56, 11 * steamS);
          steam.drawCircle(7, -72, 16 * steamS);
          steam.drawCircle(2, -94, 10 * steamS);
          steam.endFill();
        }
      }
    }
  }

  private _tickFish(p: number): void {
    const bobber = this._actors.bobber;
    const ripple = this._actors.ripple as PIXI.Graphics | undefined;
    if (!bobber) return;
    let y = 0;
    let x = 0;
    if (this._phase === 'telegraph') y = Math.sin(p * Math.PI * 5) * 8;
    else if (this._phase === 'hitWindow') y = 28 + Math.sin(this._phaseT * 22) * 3.5;
    else if (this._phase === 'late') {
      y = 8 * (1 - p);
      x = p * 38;
    }
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const cy = Math.round(h * 0.60);
    bobber.position.set(w / 2 - 8 + x, cy + 8 + y);

    if (ripple) {
      ripple.clear();
      if (this._phase === 'hitWindow') {
        ripple.lineStyle(3, 0xFFE680, 0.85);
        ripple.drawEllipse(0, 0, 44 + Math.sin(this._phaseT * 16) * 8, 16);
      }
    }
  }

  private _tickDry(p: number): void {
    const tray = this._actors.tray;
    if (!tray) return;
    let angle = 0;
    let gold = false;
    let drift = 0;
    let alpha = 1;
    if (this._phase === 'telegraph') {
      angle = p * Math.PI;
      gold = angle > Math.PI / 2;
    } else if (this._phase === 'hitWindow') {
      angle = Math.PI;
      gold = true;
      tray.scale.y = 1 + Math.sin(this._phaseT * 16) * 0.035;
    } else if (this._phase === 'late') {
      angle = Math.PI + p * 0.6;
      gold = true;
      drift = p * 160;
      alpha = 1 - p;
    } else {
      tray.scale.y = 1;
    }
    tray.scale.x = Math.max(0.12, Math.abs(Math.cos(angle)));
    tray.x = Game.designWidth / 2 + drift;
    tray.alpha = alpha;
    const face = this._actors.trayFace as PIXI.Graphics | undefined;
    if (face) face.tint = gold ? 0xFFE070 : 0xC8D4A0;
  }

  private _onTap(): void {
    if (this._phase === 'telegraph') this._resolve('early');
    else if (this._phase === 'hitWindow') this._resolve('hit');
    else if (this._phase === 'late') this._resolve('late');
  }

  private _advance(): void {
    if (this._phase === 'idle') {
      this._hotJar = rngInt(this._rng, 0, 4);
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

  private _resolve(grade: TimingGrade): void {
    const def = this._def;
    if (!def || this._phase === 'resolve' || this._phase === 'done') return;
    const drop = resolveSpecialDrop(def, grade, this._rng);
    const line = specialResultLine(def, grade, drop);
    let firstSeen = false;
    if (drop) {
      this._haul.push(toSpecialExtracted(drop.defId, drop.quality));
      firstSeen = KitchenManager.discoverFood(drop.defId, drop.quality);
      const wet = getItem(drop.defId).zone === 'wet';
      if (grade === 'hit') AudioManager.playGain();
      else AudioManager.play('gather');
      AudioManager.play(wet ? 'pickup_wet' : 'pickup_veg');
    } else {
      AudioManager.play('ui_deny');
    }
    this._flash(line, !!drop, grade === 'hit', drop ? { defId: drop.defId, firstSeen } : undefined);
    this._drawHud(def);
    this._setPhase('resolve', SPECIAL_TIMING.resolveHold);
  }

  private _nextRound(): void {
    const def = this._def;
    if (!def) return;
    this._round += 1;
    if (this._round >= def.rounds) {
      this._finish();
      return;
    }
    this._drawPlay(def);
    this._drawHud(def);
    this._setPhase('idle', this._idleDur());
  }

  private _finish(): void {
    if (this._settled || !this._def) return;
    this._settled = true;
    this._phase = 'done';
    this._inspect = null;
    this._inspectHost.visible = false;
    this._inspectHost.removeChildren();
    const unpack = KitchenManager.receiveExtract(this._haul);
    this._result.open({
      kind: 'safe',
      items: this._haul,
      lost: 0,
      needsPick: unpack.needsPick,
    });
  }

  private _flash(
    line: string,
    ok: boolean,
    perfect: boolean,
    drop?: { defId: string; firstSeen?: boolean },
  ): void {
    this._fx.removeChildren().forEach((child) => child.destroy({ children: true }));
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';

    if (drop) {
      const path = `subpkg_images/${drop.defId}.png`;
      whenTextureReady(path, () => {
        if (this.container.parent && this._phase === 'resolve') this._flash(line, ok, perfect, drop);
      });
      const glow = makeRarityFlare(itemRarity(drop.defId), 280);
      glow.position.set(0, -106);
      wrap.addChild(glow);

      const pTex = gameTexture(SPECIAL_SCENE_ART.plate);
      if (isTextureReady(pTex)) {
        const plate = new PIXI.Sprite(pTex);
        fitSpriteInBox(plate, 184, 130);
        plate.anchor.set(0.5);
        plate.position.set(0, -80);
        wrap.addChild(plate);
      }

      const tex = itemLookTexture(drop.defId, 'clean');
      if (isTextureReady(tex)) {
        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 1);
        fitSpriteInBox(sprite, 144, 144);
        sprite.position.set(0, -56);
        wrap.addChild(sprite);
      }

      if (perfect) {
        const seal = new PIXI.Container();
        const sTex = gameTexture(SPECIAL_SCENE_ART.seal);
        if (isTextureReady(sTex)) {
          const sp = new PIXI.Sprite(sTex);
          fitSpriteInBox(sp, 52, 52);
          sp.anchor.set(0.5);
          seal.addChild(sp);
        } else {
          const sg = new PIXI.Graphics();
          sg.beginFill(0xC43426, 1);
          sg.drawRoundedRect(-26, -26, 52, 52, 8);
          sg.endFill();
          seal.addChild(sg);
        }
        const st = makeText('caption', '好手', 0xFFF4E6, { size: 19, fontWeight: '700' });
        st.anchor.set(0.5);
        seal.addChild(st);
        seal.rotation = -0.12;
        seal.position.set(88, -148);
        wrap.addChild(seal);
      }

      if (drop.firstSeen) {
        const badge = makeNewFoodTag(24);
        badge.position.set(0, -198);
        wrap.addChild(badge);
      }
    }

    const label = makeText('title', line, ok ? (perfect ? GREEN_INK : INK) : RED_INK, { size: 28 });
    label.anchor.set(0.5);
    const w = Math.max(256, Math.ceil(label.width) + 56);
    const h = 60;

    const chip = new PIXI.Graphics();
    chip.beginFill(0x140A04, 0.32);
    chip.drawRoundedRect(-w / 2, -h / 2 + 4, w, h, 12);
    chip.endFill();
    chip.lineStyle(2.6, ok ? INK : RED_INK, 1);
    chip.beginFill(ok ? 0xFFF6DE : 0xFCEAE4, 0.98);
    chip.drawRoundedRect(-w / 2, -h / 2, w, h, 12);
    bgEnds(chip, w, h);
    wrap.addChild(chip, label);
    wrap.position.set(Game.designWidth / 2, Game.logicHeight * (drop ? 0.56 : 0.50));
    this._fx.addChild(wrap);
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

function bgEnds(g: PIXI.Graphics, w: number, h: number): void {
  g.endFill();
  for (const side of [-1, 1] as const) {
    g.lineStyle(2, INK, 1);
    g.beginFill(0x7A4B24, 1);
    g.drawRoundedRect(side < 0 ? -w / 2 : w / 2 - 9, -h / 2 - 2, 9, h + 4, 4);
    g.endFill();
  }
}
