import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { Game } from '@/core/Game';
import { Ease, TweenManager } from '@/core/TweenManager';
import { cookXpView, type RecipeId } from '@/sim';
import type { Rarity } from '@/sim/rarity';
import { KitchenManager } from '@/managers/KitchenManager';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from './assets';
import { HUD_ICON, PLAYER_LEVEL_HUD, makeLabel, makePlayerLevelHud, makeRarityFlare } from './ui';

const Z = 30500;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const DISH = 168;
const FLARE = 320;
const BADGE = 52;
const EXP_GAP = 76;

export interface CookReadyInfo {
  recipeId: RecipeId;
  cooked: number;
  xp: number;
  levels: number;
  rarity: Rarity;
}

let _layer: PIXI.Container | null = null;
let _flies: Array<{ t: number }> = [];
let _pendingLevels = false;

export function kitchenXpHudOrigin(): { x: number; y: number } {
  const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
  return { x: 12, y: Math.max(4, top - 16) };
}

export function kitchenXpBarCenter(): { x: number; y: number } {
  const origin = kitchenXpHudOrigin();
  const { avatar, gap, barW, barH } = PLAYER_LEVEL_HUD;
  return {
    x: origin.x + avatar + gap + barW / 2,
    y: origin.y + Math.round((avatar - barH) / 2) - 2 + barH / 2,
  };
}

export function playCookReadyFx(info: CookReadyInfo): void {
  if (!Game.stage) {
    _flushLevels();
    if (info.levels > 0) EventBus.emit(EV.cookLeveled);
    return;
  }
  _flushLevels();
  clearCookReadyFx(false);
  _pendingLevels = info.levels > 0;

  const layer = new PIXI.Container();
  layer.eventMode = 'none';
  layer.zIndex = Z;
  Game.stage.sortableChildren = true;
  Game.stage.addChild(layer);
  _layer = layer;

  const origin = kitchenXpHudOrigin();
  const skill = cookXpView(KitchenManager.save);
  const hud = makePlayerLevelHud({
    avatar: HUD_ICON.player,
    level: skill.level,
    text: skill.text,
    fill: skill.fill,
  });
  hud.position.set(origin.x, origin.y);
  hud.alpha = 0;
  layer.addChild(hud);

  const band = _drawBand();
  band.name = 'cookBand';
  band.alpha = 0;
  layer.addChild(band);

  const pop = _drawPop(info);
  pop.position.set(Game.designWidth / 2, Math.round(Game.logicHeight * 0.42));
  pop.alpha = 0;
  pop.scale.set(0.86);
  layer.addChild(pop);

  AudioManager.play('cook_ready');
  TweenManager.to({
    target: band,
    props: { alpha: 1 },
    duration: 0.16,
    ease: Ease.easeOutQuad,
  });
  TweenManager.to({
    target: pop,
    props: { alpha: 1 },
    duration: 0.18,
    ease: Ease.easeOutQuad,
  });
  TweenManager.to({
    target: pop.scale,
    props: { x: 1, y: 1 },
    duration: 0.22,
    ease: Ease.easeOutBack,
  });
  TweenManager.to({
    target: hud,
    props: { alpha: 1 },
    duration: 0.2,
    ease: Ease.easeOutQuad,
  });

  const badge = pop.getChildByName('expBadge') as PIXI.Container | null;
  if (!badge || info.xp <= 0) {
    TweenManager.to({
      target: pop,
      props: { alpha: 0 },
      duration: 0.22,
      delay: 1.15,
      onComplete: () => _fadeOut(layer, pop),
    });
    return;
  }

  TweenManager.to({
    target: { t: 0 },
    props: { t: 1 },
    duration: 0.02,
    delay: 0.62,
    onComplete: () => _flyExp(layer, pop, badge, hud, info.xp),
  });
}

export function clearCookReadyFx(flush = true): void {
  if (flush) _flushLevels();
  for (const fly of _flies) TweenManager.cancelTarget(fly);
  _flies = [];
  if (!_layer) return;
  _cancelTree(_layer);
  if (!_layer.destroyed) _layer.destroy({ children: true });
  _layer = null;
}

function _starCount(xp: number): number {
  return Math.max(5, Math.min(8, 4 + Math.floor(xp / 5)));
}

function _flyExp(
  layer: PIXI.Container,
  pop: PIXI.Container,
  badge: PIXI.Container,
  hud: PIXI.Container,
  xp: number,
): void {
  if (_layer !== layer || badge.destroyed) {
    _finish(layer);
    return;
  }
  const from = layer.toLocal(badge.getGlobalPosition());
  const to = kitchenXpBarCenter();
  const n = _starCount(xp);
  let left = n;
  AudioManager.play('xp_gain');
  for (let i = 0; i < n; i++) {
    const star = _expBadge();
    const ox = from.x + (Math.random() - 0.5) * 48;
    const oy = from.y + (Math.random() - 0.5) * 28;
    const midX = (ox + to.x) * 0.5 + (Math.random() - 0.5) * 80;
    const midY = Math.min(oy, to.y) - 70 - Math.random() * 50;
    star.position.set(ox, oy);
    star.alpha = 0;
    star.scale.set(0.42);
    layer.addChild(star);
    const fly = { t: 0 };
    _flies.push(fly);
    TweenManager.to({
      target: fly,
      props: { t: 1 },
      duration: 0.58,
      delay: i * 0.055,
      ease: Ease.easeInOutQuad,
      onUpdate: () => {
        if (star.destroyed) return;
        const t = fly.t;
        const omt = 1 - t;
        star.x = omt * omt * ox + 2 * omt * t * midX + t * t * to.x;
        star.y = omt * omt * oy + 2 * omt * t * midY + t * t * to.y;
        star.alpha = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
        const grow = 0.85 + 0.22 * Math.sin(Math.min(1, t / 0.35) * Math.PI);
        star.scale.set(grow);
      },
      onComplete: () => {
        if (!star.destroyed) star.destroy({ children: true });
        left -= 1;
        if (left > 0) return;
        _flies = [];
        if (!hud.destroyed) {
          TweenManager.to({
            target: hud.scale,
            props: { x: 1.06, y: 1.06 },
            duration: 0.1,
            ease: Ease.easeOutQuad,
            onComplete: () => {
              if (hud.destroyed) return;
              TweenManager.to({
                target: hud.scale,
                props: { x: 1, y: 1 },
                duration: 0.14,
                ease: Ease.easeOutQuad,
              });
            },
          });
        }
        _fadeOut(layer, pop);
      },
    });
  }
}

function _drawBand(): PIXI.Graphics {
  const w = Game.designWidth;
  const h = Game.logicHeight;
  const bandH = 360;
  const y = Math.round(h * 0.42 - bandH / 2);
  const g = new PIXI.Graphics();
  g.beginFill(0x000000, 0.55);
  g.drawRect(0, y, w, bandH);
  g.endFill();
  return g;
}

function _drawPop(info: CookReadyInfo): PIXI.Container {
  const qty = Math.max(1, info.cooked);
  const showXp = info.xp > 0;
  const root = new PIXI.Container();

  const glow = makeRarityFlare(info.rarity, FLARE);
  glow.position.set(0, 0);
  root.addChild(glow);

  const dish = new PIXI.Sprite(dishTexture(info.recipeId));
  if (isTextureReady(dish.texture)) fitSpriteInBox(dish, DISH, DISH);
  else {
    dish.width = DISH;
    dish.height = DISH;
  }
  dish.anchor.set(0.5);
  dish.eventMode = 'none';
  root.addChild(dish);

  const count = makeLabel(`×${qty}`, 48, 0xFFF8F0, {
    fontFamily: TITLE_FONT,
    fontWeight: '700',
    stroke: '#2A2018',
    strokeThickness: 7,
  });
  count.anchor.set(0, 0.5);
  count.position.set(DISH * 0.42, 8);
  root.addChild(count);

  if (showXp) {
    const badge = _expBadge();
    badge.name = 'expBadge';
    const xp = makeLabel(`+${info.xp}`, 36, INK, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: '#FFF6E8',
      strokeThickness: 6,
    });
    xp.anchor.set(0, 0.5);
    const rowW = BADGE + 8 + xp.width;
    const rowY = DISH / 2 + EXP_GAP;
    badge.position.set(-rowW / 2 + BADGE / 2, rowY);
    xp.position.set(badge.x + BADGE / 2 + 8, rowY);
    root.addChild(badge, xp);
  }
  return root;
}

function _expBadge(): PIXI.Container {
  const root = new PIXI.Container();
  const spr = new PIXI.Sprite(gameTexture(HUD_ICON.exp));
  spr.anchor.set(0.5);
  spr.eventMode = 'none';
  if (isTextureReady(spr.texture)) fitSpriteInBox(spr, BADGE, BADGE);
  else {
    spr.width = BADGE;
    spr.height = BADGE;
  }
  whenTextureReady(HUD_ICON.exp, () => {
    if (spr.destroyed) return;
    spr.texture = gameTexture(HUD_ICON.exp);
    fitSpriteInBox(spr, BADGE, BADGE);
  });
  const mark = makeLabel('EXP', 13, 0xFFF8F0, {
    fontWeight: '800',
    stroke: '#2A2018',
    strokeThickness: 4,
  });
  mark.anchor.set(0.5);
  mark.position.set(0, 1);
  root.addChild(spr, mark);
  return root;
}

function _fadeOut(layer: PIXI.Container, pop: PIXI.Container): void {
  const band = layer.getChildByName('cookBand');
  if (band && !band.destroyed) {
    TweenManager.to({
      target: band,
      props: { alpha: 0 },
      duration: 0.2,
    });
  }
  TweenManager.to({
    target: pop,
    props: { alpha: 0 },
    duration: 0.22,
    onComplete: () => _finish(layer),
  });
}

function _finish(layer: PIXI.Container): void {
  if (_layer !== layer) return;
  _flushLevels();
  for (const fly of _flies) TweenManager.cancelTarget(fly);
  _flies = [];
  _cancelTree(layer);
  if (!layer.destroyed) layer.destroy({ children: true });
  if (_layer === layer) _layer = null;
}

function _flushLevels(): void {
  if (!_pendingLevels) return;
  _pendingLevels = false;
  EventBus.emit(EV.cookLeveled);
}

function _cancelTree(node: PIXI.Container): void {
  TweenManager.cancelTarget(node);
  TweenManager.cancelTarget(node.scale);
  for (const child of node.children) {
    if (child instanceof PIXI.Container) _cancelTree(child);
    else TweenManager.cancelTarget(child);
  }
}
