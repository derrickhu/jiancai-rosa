import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { getItem, itemRarity } from '@/sim/items';
import { fitSpriteInBox, gameTexture, isTextureFailed, isTextureReady, whenTextureReady } from './assets';
import { HUD_ICON, PLAYER_LEVEL_HUD, makeRarityFlare } from './ui';

const COIN = HUD_ICON.coin;
const TICKET = 'subpkg_images/ui_menu_ticket.png';
const Z = 200;
const SIZE = 18;
const FACE = 168;
const FLARE = 320;

let _layer: PIXI.Container | null = null;
let _gainLayer: PIXI.Container | null = null;
let _fridgePos: { x: number; y: number } | null = null;
let _gachaPos: { x: number; y: number } | null = null;

export interface RewardCollectGain {
  gold?: number;
  foldGold?: number;
  foodDefId?: string;
  foodFolded?: boolean;
  tickets?: number;
  from?: { x: number; y: number };
}

/** 厨房顶栏金币图标中心，和 KitchenScene HUD 同一套坐标。 */
export function kitchenCoinHudPos(): { x: number; y: number } {
  const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
  const y = Math.max(4, top - 16);
  const pillH = 44;
  const extra = 0;
  const pillY = y + Math.round((PLAYER_LEVEL_HUD.avatar - pillH) / 2) + extra;
  const resX = 12 + PLAYER_LEVEL_HUD.avatar + PLAYER_LEVEL_HUD.gap + PLAYER_LEVEL_HUD.barW + 12;
  return { x: resX + 24, y: pillY + pillH / 2 };
}

export function setKitchenFridgeHudPos(pos: { x: number; y: number }): void {
  _fridgePos = pos;
}

export function setKitchenGachaHudPos(pos: { x: number; y: number }): void {
  _gachaPos = pos;
}

export function kitchenFridgeHudPos(): { x: number; y: number } {
  return _fridgePos ?? { x: Game.designWidth * 0.52, y: Game.logicHeight * 0.58 };
}

export function kitchenGachaHudPos(): { x: number; y: number } {
  const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
  return _gachaPos ?? { x: 53, y: top + 430 };
}

export function playRewardCollect(gain: RewardCollectGain, onDone?: () => void): void {
  const coins = Math.max(0, Math.floor(gain.gold ?? 0) + Math.max(0, Math.floor(gain.foldGold ?? 0)));
  const tickets = Math.max(0, Math.floor(gain.tickets ?? 0));
  const foodId = gain.foodDefId || '';
  if (coins <= 0 && tickets <= 0 && !foodId) {
    onDone?.();
    return;
  }
  const from = gain.from ?? {
    x: Game.designWidth / 2,
    y: Math.round(Game.logicHeight * 0.42),
  };
  const foodTo = gain.foodFolded ? kitchenCoinHudPos() : kitchenFridgeHudPos();
  let left = (foodId ? 1 : 0) + (coins > 0 ? 1 : 0) + (tickets > 0 ? 1 : 0);
  const tick = (): void => {
    left -= 1;
    if (left <= 0) onDone?.();
  };
  if (foodId) playItemCollect(foodId, from, foodTo, tick);
  if (coins > 0) {
    const n = Math.max(4, Math.min(12, coins));
    playCoinCollect(from, n, foodId ? 0.16 : 0, tick);
  }
  if (tickets > 0) {
    playTicketCollect(from, kitchenGachaHudPos(), foodId ? 0.36 : 0.08, tick);
  }
}

export function playCoinCollect(
  from: { x: number; y: number },
  count = 10,
  delay = 0,
  onDone?: () => void,
): void {
  const host = _fxHost();
  if (!host) {
    onDone?.();
    return;
  }
  _clear();
  const layer = new PIXI.Container();
  layer.eventMode = 'none';
  layer.zIndex = Z;
  host.sortableChildren = true;
  host.addChild(layer);
  _layer = layer;

  const to = kitchenCoinHudPos();
  whenTextureReady(COIN, () => {
    if (_layer === layer && _fxHost()) playCoinCollect(from, count, delay, onDone);
  });

  let left = count;
  const finish = (): void => {
    left -= 1;
    if (left > 0) return;
    if (_layer === layer) _clear();
    onDone?.();
  };

  for (let i = 0; i < count; i++) {
    const { coin, base } = _makeCoin();
    const ox = from.x + (Math.random() - 0.5) * 40;
    const oy = from.y + (Math.random() - 0.5) * 28;
    const midX = (ox + to.x) * 0.5 + (Math.random() - 0.5) * 64;
    const midY = Math.min(oy, to.y) - 56 - Math.random() * 36;
    coin.position.set(ox, oy);
    coin.alpha = 0;
    coin.scale.set(base * 0.35);
    layer.addChild(coin);

    const fly = { t: 0 };
    TweenManager.to({
      target: fly,
      props: { t: 1 },
      duration: 0.58,
      delay: delay + i * 0.055,
      ease: Ease.easeInOutQuad,
      onUpdate: () => {
        if (coin.destroyed) return;
        const t = fly.t;
        const omt = 1 - t;
        coin.x = omt * omt * ox + 2 * omt * t * midX + t * t * to.x;
        coin.y = omt * omt * oy + 2 * omt * t * midY + t * t * to.y;
        coin.alpha = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
        const pop = 0.85 + 0.2 * Math.sin(Math.min(1, t / 0.35) * Math.PI);
        coin.scale.set(base * pop);
      },
      onComplete: () => {
        if (!coin.destroyed) coin.destroy();
        if (i === 0) AudioManager.play('coin_gain');
        finish();
      },
    });
  }
  if (delay <= 0) AudioManager.play('coin_gain');
  else {
    TweenManager.to({
      target: { t: 0 },
      props: { t: 1 },
      duration: 0.02,
      delay,
      onComplete: () => AudioManager.play('coin_gain'),
    });
  }
}

function playItemCollect(
  defId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  onDone?: () => void,
): void {
  const path = `subpkg_images/${defId}.png`;
  const item = getItem(defId);
  const tex = gameTexture(path);
  if (isTextureReady(tex) && _fxHost()) {
    _flyGain({
      tex,
      rarity: itemRarity(defId),
      from,
      to,
      wet: item.zone === 'wet',
      onDone,
    });
    return;
  }
  AudioManager.playGain();
  AudioManager.playPickup(item.zone === 'wet' ? 'wet' : 'dry');
  if (isTextureFailed(path) || !_fxHost()) {
    onDone?.();
    return;
  }
  whenTextureReady(path, () => {
    const ready = gameTexture(path);
    if (!isTextureReady(ready) || !_fxHost()) {
      onDone?.();
      return;
    }
    _flyGain({
      tex: ready,
      rarity: itemRarity(defId),
      from,
      to,
      wet: item.zone === 'wet',
      sfx: false,
      onDone,
    });
  });
}

export function playTicketCollect(
  from: { x: number; y: number } = {
    x: Game.designWidth / 2,
    y: Math.round(Game.logicHeight * 0.42),
  },
  to: { x: number; y: number } = kitchenGachaHudPos(),
  delay = 0,
  onDone?: () => void,
): void {
  whenTextureReady(TICKET, () => {
    if (_fxHost()) playTicketCollect(from, to, delay, onDone);
  });
  const tex = gameTexture(TICKET);
  if (!isTextureReady(tex) || !_fxHost()) return;
  TweenManager.to({
    target: { t: 0 },
    props: { t: 1 },
    duration: 0.02,
    delay,
    onComplete: () => {
      if (!_fxHost()) {
        onDone?.();
        return;
      }
      _flyGain({ tex, rarity: 'rare', from, to, wet: false, size: 120, onDone });
    },
  });
}

function _flyGain(opts: {
  tex: PIXI.Texture;
  rarity: ReturnType<typeof itemRarity>;
  from: { x: number; y: number };
  to: { x: number; y: number };
  wet: boolean;
  size?: number;
  sfx?: boolean;
  onDone?: () => void;
}): void {
  const layer = _gainHost();
  if (!layer) {
    opts.onDone?.();
    return;
  }
  const face = opts.size ?? FACE;
  const wrap = new PIXI.Container();
  wrap.eventMode = 'none';
  wrap.position.set(opts.from.x, opts.from.y);
  wrap.scale.set(0.2);
  wrap.alpha = 0;
  const glow = makeRarityFlare(opts.rarity, FLARE);
  const sprite = new PIXI.Sprite(opts.tex);
  sprite.anchor.set(0.5);
  fitSpriteInBox(sprite, face, face);
  sprite.eventMode = 'none';
  wrap.addChild(glow, sprite);
  layer.addChild(wrap);
  if (opts.sfx !== false) {
    AudioManager.playGain();
    AudioManager.playPickup(opts.wet ? 'wet' : 'dry');
  }

  TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.1 });
  TweenManager.to({
    target: wrap.scale,
    props: { x: 1, y: 1 },
    duration: 0.22,
    ease: Ease.easeOutBack,
    onComplete: () => {
      if (wrap.destroyed) return;
      TweenManager.to({
        target: wrap,
        props: { x: opts.to.x, y: opts.to.y },
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
          if (!wrap.destroyed) wrap.destroy({ children: true });
          _maybeClearGain();
          opts.onDone?.();
        },
      });
    },
  });
}

function _fxHost(): PIXI.Container | null {
  if (!Game.stage) return null;
  const overlay = OverlayManager.container;
  overlay.sortableChildren = true;
  Game.stage.sortableChildren = true;
  return overlay;
}

function _gainHost(): PIXI.Container | null {
  if (_gainLayer && !_gainLayer.destroyed) return _gainLayer;
  const parent = _fxHost();
  if (!parent) return null;
  const layer = new PIXI.Container();
  layer.eventMode = 'none';
  layer.zIndex = Z + 1;
  parent.addChild(layer);
  _gainLayer = layer;
  return layer;
}

function _maybeClearGain(): void {
  if (!_gainLayer || _gainLayer.children.length) return;
  if (!_gainLayer.destroyed) _gainLayer.destroy({ children: true });
  _gainLayer = null;
}

function _makeCoin(): { coin: PIXI.Sprite; base: number } {
  const coin = new PIXI.Sprite(gameTexture(COIN));
  coin.anchor.set(0.5);
  coin.eventMode = 'none';
  const base = fitSpriteInBox(coin, SIZE, SIZE);
  return { coin, base };
}

function _clear(): void {
  if (!_layer) return;
  for (const child of _layer.children) TweenManager.cancelTarget(child);
  if (!_layer.destroyed) _layer.destroy({ children: true });
  _layer = null;
}
