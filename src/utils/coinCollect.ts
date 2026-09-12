import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { Ease, TweenManager } from '@/core/TweenManager';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from './assets';
import { HUD_ICON, PLAYER_LEVEL_HUD } from './ui';

const COIN = HUD_ICON.coin;
const Z = 31000;
const SIZE = 22;

let _layer: PIXI.Container | null = null;

/** 厨房顶栏金币图标中心，和 KitchenScene HUD 同一套坐标。 */
export function kitchenCoinHudPos(): { x: number; y: number } {
  const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
  const y = Math.max(4, top - 16);
  const pillH = 44;
  const pillY = y + Math.round((PLAYER_LEVEL_HUD.avatar - pillH) / 2);
  const resX = 12 + PLAYER_LEVEL_HUD.avatar + PLAYER_LEVEL_HUD.gap + PLAYER_LEVEL_HUD.barW + 12;
  return { x: resX + 24, y: pillY + pillH / 2 };
}

export function playCoinCollect(from: { x: number; y: number }, count = 10): void {
  if (!Game.stage) return;
  _clear();
  const layer = new PIXI.Container();
  layer.eventMode = 'none';
  layer.zIndex = Z;
  Game.stage.sortableChildren = true;
  Game.stage.addChild(layer);
  _layer = layer;

  const to = kitchenCoinHudPos();
  whenTextureReady(COIN, () => {
    if (_layer === layer && Game.stage) playCoinCollect(from, count);
  });

  let left = count;
  const finish = (): void => {
    left -= 1;
    if (left > 0) return;
    if (_layer === layer) _clear();
  };

  for (let i = 0; i < count; i++) {
    const coin = _makeCoin();
    const ox = from.x + (Math.random() - 0.5) * 56;
    const oy = from.y + (Math.random() - 0.5) * 36;
    const midX = (ox + to.x) * 0.5 + (Math.random() - 0.5) * 90;
    const midY = Math.min(oy, to.y) - 70 - Math.random() * 50;
    coin.position.set(ox, oy);
    coin.alpha = 0;
    coin.scale.set(0.35);
    layer.addChild(coin);

    const fly = { t: 0 };
    TweenManager.to({
      target: fly,
      props: { t: 1 },
      duration: 0.58,
      delay: i * 0.055,
      ease: Ease.easeInOutQuad,
      onUpdate: () => {
        if (coin.destroyed) return;
        const t = fly.t;
        const omt = 1 - t;
        coin.x = omt * omt * ox + 2 * omt * t * midX + t * t * to.x;
        coin.y = omt * omt * oy + 2 * omt * t * midY + t * t * to.y;
        coin.alpha = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
        const pop = 0.85 + 0.2 * Math.sin(Math.min(1, t / 0.35) * Math.PI);
        coin.scale.set(pop);
      },
      onComplete: () => {
        if (!coin.destroyed) coin.destroy();
        if (i === 0) AudioManager.play('coin_gain');
        finish();
      },
    });
  }
  AudioManager.play('coin_gain');
}

function _makeCoin(): PIXI.Sprite {
  const spr = new PIXI.Sprite(gameTexture(COIN));
  spr.anchor.set(0.5);
  spr.eventMode = 'none';
  if (isTextureReady(spr.texture)) fitSpriteInBox(spr, SIZE, SIZE);
  else {
    spr.width = SIZE;
    spr.height = SIZE;
  }
  return spr;
}

function _clear(): void {
  if (!_layer) return;
  for (const child of _layer.children) TweenManager.cancelTarget(child);
  if (!_layer.destroyed) _layer.destroy({ children: true });
  _layer = null;
}
