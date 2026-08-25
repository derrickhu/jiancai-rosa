import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { AudioManager } from '@/core/AudioManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { ResultPanel } from '@/gameobjects/ui/ResultPanel';
import {
  SPECIAL_TIMING,
  getItem,
  getSpecialMarket,
  mulberry32,
  newSeed,
  resolveSpecialDrop,
  rngInt,
  specialResultLine,
  toSpecialExtracted,
  type ExtractedItem,
  type SpecialMarketDef,
  type SpecialMarketId,
  type TimingGrade,
} from '@/sim';
import { applyFit, fitCover, fitSpriteInBox, gameTexture, isTextureReady, itemLookTexture, whenTextureReady } from '@/utils/assets';
import { HUD_ICON, fillRect, makeLabel, makeMuteButton, makePaperChip, makeStatPill } from '@/utils/ui';

type Phase = 'idle' | 'telegraph' | 'hitWindow' | 'late' | 'resolve' | 'done';

export class SpecialMarketScene implements Scene {
  readonly name = 'specialMarket';
  readonly container = new PIXI.Container();
  private static _queued: SpecialMarketId | null = null;

  private _bg = new PIXI.Container();
  private _play = new PIXI.Container();
  private _hud = new PIXI.Container();
  private _fx = new PIXI.Container();
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
  private _cue: PIXI.Text | null = null;
  private _settled = false;

  static queue(id: SpecialMarketId): void {
    SpecialMarketScene._queued = id;
  }

  constructor() {
    this.container.addChild(this._bg);
    this.container.addChild(this._play);
    this.container.addChild(this._fx);
    this.container.addChild(this._hud);
    this.container.eventMode = 'static';
    this.container.on('pointertap', () => this._onTap());
    this._hud.eventMode = 'static';
    this._hud.on('pointertap', (e) => e.stopPropagation());
  }

  onEnter(): void {
    const id = SpecialMarketScene._queued;
    if (!id) {
      SceneManager.switchTo('destinations');
      return;
    }
    this._def = getSpecialMarket(id);
    this._rng = mulberry32(newSeed());
    this._round = 0;
    this._haul = [];
    this._settled = false;
    this._phase = 'idle';
    this._phaseT = 0;
    this._phaseDur = this._idleDur();
    AudioManager.playMarketBgm(this._def.bgmMarket);
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    Game.ticker.remove(this._boundUpdate);
    Game.ticker.add(this._boundUpdate);
    this._paint();
  }

  onExit(): void {
    Game.ticker.remove(this._boundUpdate);
    this._play.removeChildren();
    this._fx.removeChildren();
    this._actors = {};
    this._cue = null;
  }

  relayout(): void {
    if (!this._def) return;
    this.container.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    this._paint();
  }

  update(dt: number): void {
    if (!this._def || this._phase === 'done') return;
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
    this._tickActors();
  }

  private _drawBg(def: SpecialMarketDef): void {
    this._bg.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, w, h, def.flavor === 'fish' ? 0x1A3040 : def.flavor === 'dry' ? 0x3A2A1C : 0x241820);
    this._bg.addChild(fallback);
    whenTextureReady(def.bg, () => {
      if (this.container.parent && this._def?.id === def.id) this._drawBg(def);
    });
    const tex = gameTexture(def.bg);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      const fit = fitCover(tex.width, tex.height, w, h);
      applyFit(sp, fit);
      sp.position.set(fit.x, fit.y);
      this._bg.addChild(sp);
    }
  }

  private _drawHud(def: SpecialMarketDef): void {
    this._hud.removeChildren();
    const w = Game.designWidth;
    const y = Game.safeTop + 6;
    const redraw = () => {
      if (this.container.parent && this._def) this._drawHud(this._def);
    };
    const title = makePaperChip(def.name, { size: 22 });
    title.position.set(14, y);
    this._hud.addChild(title);

    const round = makeStatPill({
      icon: HUD_ICON.clock,
      text: `第 ${Math.min(this._round + 1, def.rounds)}/${def.rounds} 手`,
      width: 168,
      onIconReady: redraw,
    });
    round.position.set(14, y + 52);
    this._hud.addChild(round);

    const bag = makeStatPill({
      icon: HUD_ICON.basket,
      text: `已收 ${this._haul.length}`,
      width: 132,
      onIconReady: redraw,
    });
    bag.position.set(190, y + 52);
    this._hud.addChild(bag);

    const mute = makeMuteButton(40);
    mute.position.set(w - 56, y);
    this._hud.addChild(mute);

    this._drawHaulStrip();
  }

  private _drawHaulStrip(): void {
    if (!this._haul.length) return;
    const strip = new PIXI.Container();
    const y = Game.logicHeight - Math.max(88, Game.safeBottom + 72);
    this._haul.slice(-5).forEach((it, i) => {
      const cell = new PIXI.Container();
      const bg = new PIXI.Graphics();
      fillRect(bg, 0, 0, 56, 56, 0xFFF6EA, 12);
      cell.addChild(bg);
      const tex = itemLookTexture(it.defId, 'clean');
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        fitSpriteInBox(sp, 46, 46);
        sp.anchor.set(0.5);
        sp.position.set(28, 28);
        cell.addChild(sp);
      }
      cell.position.set(24 + i * 64, y);
      strip.addChild(cell);
    });
    this._hud.addChild(strip);
  }

  private _drawPlay(def: SpecialMarketDef): void {
    this._play.removeChildren();
    this._actors = {};
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const cy = h * 0.52;
    if (def.flavor === 'spice') this._buildSpice(w, cy);
    else if (def.flavor === 'fish') this._buildFish(w, cy);
    else this._buildDry(w, cy);

    const cue = makeLabel(def.cue, 26, 0xFFF6EA, { fontWeight: '700' });
    cue.anchor.set(0.5);
    cue.position.set(w / 2, h * 0.78);
    this._play.addChild(cue);
    this._cue = cue;
  }

  private _buildSpice(w: number, cy: number): void {
    const jars = 5;
    const gap = 118;
    const start = w / 2 - ((jars - 1) * gap) / 2;
    for (let i = 0; i < jars; i++) {
      const jar = new PIXI.Container();
      const body = new PIXI.Graphics();
      body.beginFill(0x6A3A28);
      body.drawRoundedRect(-28, -8, 56, 72, 12);
      body.endFill();
      body.beginFill(0xC46A3A);
      body.drawRoundedRect(-24, 8, 48, 44, 8);
      body.endFill();
      const lid = new PIXI.Graphics();
      lid.beginFill(0xE8C47A);
      lid.drawRoundedRect(-32, -22, 64, 22, 8);
      lid.endFill();
      lid.beginFill(0x8B5A2B);
      lid.drawRoundedRect(-8, -30, 16, 12, 4);
      lid.endFill();
      lid.name = 'lid';
      const steam = new PIXI.Graphics();
      steam.name = 'steam';
      jar.addChild(body, steam, lid);
      jar.position.set(start + i * gap, cy);
      this._play.addChild(jar);
      this._actors[`jar${i}`] = jar;
    }
  }

  private _buildFish(w: number, cy: number): void {
    const water = new PIXI.Graphics();
    water.beginFill(0x2A5A6A, 0.72);
    water.drawEllipse(0, 0, 220, 70);
    water.endFill();
    water.beginFill(0x7EC8C4, 0.28);
    water.drawEllipse(-40, -18, 70, 16);
    water.endFill();
    water.position.set(w / 2 - 20, cy + 36);
    this._play.addChild(water);

    const rod = new PIXI.Graphics();
    rod.lineStyle(6, 0x8B5A2B, 1);
    rod.moveTo(w - 80, cy - 220);
    rod.lineTo(w / 2 + 36, cy - 40);
    rod.lineStyle(2, 0xE8DCC8, 1);
    rod.moveTo(w / 2 + 36, cy - 40);
    rod.lineTo(w / 2 - 8, cy + 8);
    this._play.addChild(rod);

    const bobber = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.beginFill(0xC43A28);
    g.drawCircle(0, -10, 10);
    g.endFill();
    g.beginFill(0xFFF6EA);
    g.drawCircle(0, 4, 9);
    g.endFill();
    bobber.addChild(g);
    bobber.position.set(w / 2 - 8, cy + 8);
    this._play.addChild(bobber);
    this._actors.bobber = bobber;
  }

  private _buildDry(w: number, cy: number): void {
    const tray = new PIXI.Container();
    const board = new PIXI.Graphics();
    board.beginFill(0xC4A06A);
    board.drawRoundedRect(-150, -70, 300, 140, 18);
    board.endFill();
    board.lineStyle(6, 0x8B5A2B, 1);
    board.drawRoundedRect(-150, -70, 300, 140, 18);
    board.beginFill(0xE8C47A);
    board.drawEllipse(0, 0, 110, 48);
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
    if (this._cue) {
      const live = this._phase === 'telegraph' || this._phase === 'hitWindow';
      this._cue.alpha = this._phase === 'hitWindow' ? 1 : live ? 0.84 : 0.55;
      this._cue.scale.set(this._phase === 'hitWindow' ? 1.06 : 1);
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
        lidY = -Math.abs(Math.sin(p * Math.PI * 6)) * (8 + p * 10);
        steamA = 0.25 + p * 0.55;
        steamS = 0.35 + p * 0.7;
      } else if (hot && this._phase === 'hitWindow') {
        lidY = -22;
        steamA = 0.95;
        steamS = 1.15 + Math.sin(this._phaseT * 18) * 0.08;
      } else if (hot && this._phase === 'late') {
        lidY = -8 * (1 - p);
        steamA = 0.5 * (1 - p);
        steamS = 0.8 * (1 - p);
      }
      if (lid) lid.y = lidY;
      if (steam) {
        steam.clear();
        if (steamA > 0.02) {
          steam.beginFill(0xF4EFE6, steamA);
          steam.drawCircle(-8, -48, 10 * steamS);
          steam.drawCircle(6, -62, 14 * steamS);
          steam.drawCircle(2, -80, 9 * steamS);
          steam.endFill();
        }
      }
    }
  }

  private _tickFish(p: number): void {
    const bobber = this._actors.bobber;
    if (!bobber) return;
    let y = 0;
    let x = 0;
    if (this._phase === 'telegraph') y = Math.sin(p * Math.PI * 5) * 7;
    else if (this._phase === 'hitWindow') y = 26 + Math.sin(this._phaseT * 22) * 3;
    else if (this._phase === 'late') {
      y = 8 * (1 - p);
      x = p * 36;
    }
    const w = Game.designWidth;
    const h = Game.logicHeight;
    bobber.position.set(w / 2 - 8 + x, h * 0.52 + 8 + y);
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
      tray.scale.y = 1 + Math.sin(this._phaseT * 16) * 0.03;
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
    if (face) face.tint = gold ? 0xF0D060 : 0xC8D4A0;
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
    if (drop) {
      this._haul.push(toSpecialExtracted(drop.defId, drop.quality));
      const wet = getItem(drop.defId).zone === 'wet';
      AudioManager.play(grade === 'hit' ? 'item_reveal' : 'gather');
      AudioManager.play(wet ? 'pickup_wet' : 'pickup_veg');
    } else {
      AudioManager.play('ui_deny');
    }
    this._flash(line, !!drop);
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
    const unpack = KitchenManager.receiveExtract(this._haul);
    this._result.open({
      kind: 'safe',
      items: this._haul,
      lost: 0,
      needsPick: unpack.needsPick,
    });
  }

  private _flash(line: string, ok: boolean): void {
    this._fx.removeChildren();
    const chip = new PIXI.Graphics();
    const label = makeLabel(line, 28, ok ? 0x3A3228 : 0xFFF6EA, { fontWeight: '700' });
    const w = Math.max(220, label.width + 48);
    const h = 56;
    chip.beginFill(ok ? 0xF4E8C4 : 0x2A2018, 0.92);
    chip.lineStyle(3, ok ? 0xC48A14 : 0x8B5A2B, 1);
    chip.drawRoundedRect(-w / 2, -h / 2, w, h, 28);
    chip.endFill();
    label.anchor.set(0.5);
    const wrap = new PIXI.Container();
    wrap.addChild(chip, label);
    wrap.position.set(Game.designWidth / 2, Game.logicHeight * 0.34);
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
