import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { Ease, TweenManager } from '@/core/TweenManager';
import { fitSpriteInBox, gameTexture, isTextureReady, whenTextureReady } from './assets';
import { makeLabel } from './ui';

const BANNER = 'subpkg_kitchen/ui_daily_clear_banner.png';
const BURST = 'subpkg_kitchen/ui_result_burst.png';
const Z = 31200;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;

let _layer: PIXI.Container | null = null;

export function playDailyMenuClearBanner(onDone?: () => void): void {
  if (!Game.stage) {
    onDone?.();
    return;
  }
  whenTextureReady(BANNER, () => {
    if (Game.stage) playDailyMenuClearBanner(onDone);
  });
  if (!isTextureReady(gameTexture(BANNER))) return;
  _clear();
  const layer = new PIXI.Container();
  layer.eventMode = 'static';
  layer.zIndex = Z;
  layer.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
  Game.stage.sortableChildren = true;
  Game.stage.addChild(layer);
  _layer = layer;

  const w = Game.designWidth;
  const h = Game.logicHeight;
  const cx = w / 2;
  const cy = Math.round(h * 0.42);

  const dim = new PIXI.Graphics();
  dim.beginFill(0x1A120C, 0.42);
  dim.drawRect(0, 0, w, h);
  dim.endFill();
  dim.alpha = 0;
  dim.eventMode = 'none';
  layer.addChild(dim);

  const burst = new PIXI.Sprite(gameTexture(BURST));
  burst.anchor.set(0.5);
  burst.blendMode = PIXI.BLEND_MODES.ADD;
  burst.alpha = 0;
  burst.position.set(cx, cy);
  if (isTextureReady(burst.texture)) {
    burst.width = 520;
    burst.height = 520;
  }
  burst.eventMode = 'none';
  layer.addChild(burst);

  const wrap = new PIXI.Container();
  wrap.position.set(cx, cy);
  wrap.alpha = 0;
  wrap.scale.set(0.82);
  wrap.eventMode = 'none';
  layer.addChild(wrap);

  const tex = gameTexture(BANNER);
  if (isTextureReady(tex)) {
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, Math.min(640, w - 48), 220);
    spr.anchor.set(0.5);
    spr.eventMode = 'none';
    wrap.addChild(spr);
  }

  const title = makeLabel('全部交齐了', 42, INK, {
    fontFamily: TITLE_FONT,
    fontWeight: '700',
    stroke: 0xFFF6E8,
    strokeThickness: 7,
  });
  title.anchor.set(0.5);
  title.position.set(0, -6);
  wrap.addChild(title);
  const sub = makeLabel('菜谱券来了', 22, 0xC46A3A, { fontWeight: '700' });
  sub.anchor.set(0.5);
  sub.position.set(0, 36);
  wrap.addChild(sub);

  AudioManager.play('result_safe');
  TweenManager.to({ target: dim, props: { alpha: 1 }, duration: 0.16 });
  TweenManager.to({ target: burst, props: { alpha: 0.88 }, duration: 0.22 });
  TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.18 });
  TweenManager.to({
    target: wrap.scale,
    props: { x: 1, y: 1 },
    duration: 0.28,
    ease: Ease.easeOutBack,
  });

  const finish = (): void => {
    if (_layer !== layer) return;
    _clear();
    onDone?.();
  };

  TweenManager.to({
    target: { t: 0 },
    props: { t: 1 },
    duration: 0.02,
    delay: 1.15,
    onComplete: () => {
      if (_layer !== layer) return;
      TweenManager.to({ target: dim, props: { alpha: 0 }, duration: 0.2 });
      TweenManager.to({ target: burst, props: { alpha: 0 }, duration: 0.2 });
      TweenManager.to({
        target: wrap,
        props: { alpha: 0 },
        duration: 0.22,
        onComplete: finish,
      });
    },
  });
}

function _clear(): void {
  if (!_layer) return;
  TweenManager.cancelTarget(_layer);
  for (const child of _layer.children) {
    TweenManager.cancelTarget(child);
    TweenManager.cancelTarget(child.scale);
  }
  if (!_layer.destroyed) _layer.destroy({ children: true });
  _layer = null;
}
