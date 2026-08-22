import * as PIXI from 'pixi.js';
import { ImageResource } from '@pixi/core';
import { Platform } from '@/core/PlatformService';

const cache = new Map<string, PIXI.Texture>();
const waiters = new Map<string, Array<() => void>>();
const failed = new Set<string>();

function emptyTexture(): PIXI.Texture {
  const pixels = new Uint8Array([0, 0, 0, 0]);
  return new PIXI.Texture(PIXI.BaseTexture.fromBuffer(pixels, 1, 1));
}

function adopt(tex: PIXI.Texture, img: any): void {
  const resource = new ImageResource(img, { createBitmap: false, autoLoad: true });
  const base = new PIXI.BaseTexture(resource);
  const w = Math.max(1, img.width || base.width || 1);
  const h = Math.max(1, img.height || base.height || 1);
  tex.baseTexture = base;
  tex.frame = new PIXI.Rectangle(0, 0, w, h);
  tex.orig = new PIXI.Rectangle(0, 0, w, h);
  tex.updateUvs();
}

function flush(path: string): void {
  const list = waiters.get(path);
  if (!list) return;
  waiters.delete(path);
  for (const cb of list) {
    try { cb(); } catch (e) { console.warn('[assets] ready cb', e); }
  }
}

/**
 * 微信里不要 PIXI.Texture.from(path)。
 * 等 wx.createImage onload 后再绑 ImageResource，并关掉 createImageBitmap。
 */
export function gameTexture(path: string): PIXI.Texture {
  const hit = cache.get(path);
  if (hit) return hit;

  const tex = emptyTexture();
  cache.set(path, tex);

  const img = Platform.createImage();
  img.onload = () => {
    try {
      adopt(tex, img);
      console.log('[assets] loaded', path, img.width, img.height);
    } catch (e) {
      console.warn('[assets] bind 失败', path, e);
    }
    flush(path);
  };
  img.onerror = (err: unknown) => {
    console.warn('[assets] 图片加载失败', path, err);
    failed.add(path);
    flush(path);
  };
  img.src = path;
  return tex;
}

/** 微信分包根目录；勿再用 `images/`，开发者工具会把它当纯资源目录，导致 loadSubpackage module not found。 */
export const IMG_DIR = 'subpkg_images';

export function imgPath(file: string): string {
  return `${IMG_DIR}/${file}`;
}

export function itemTexture(id: string): PIXI.Texture {
  return gameTexture(imgPath(`${id}.png`));
}

export type ItemLook = 'clean' | 'dirty' | 'rotten';

/** 脏/坏图没有就回落到干净图，调用方可用 tint 区分。 */
export function itemLookTexture(id: string, look: ItemLook): PIXI.Texture {
  if (look === 'clean') return itemTexture(id);
  const path = imgPath(`${id}_${look}.png`);
  if (failed.has(path)) return itemTexture(id);
  const named = gameTexture(path);
  if (isTextureReady(named)) return named;
  return itemTexture(id);
}

export function dishTexture(recipeId: string): PIXI.Texture {
  return gameTexture(imgPath(`dish_${recipeId}.png`));
}

export function isTextureReady(tex: PIXI.Texture): boolean {
  return !!(tex.valid && tex.width > 2 && tex.height > 2);
}

export function isTextureFailed(path: string): boolean {
  return failed.has(path);
}

/** 未加载时 width 是 1，不能拿来算缩放，否则会放大几百倍盖住全屏。 */
export function readyTextureSize(tex: PIXI.Texture, fallback = 256): { w: number; h: number } {
  if (isTextureReady(tex)) return { w: tex.width, h: tex.height };
  return { w: fallback, h: fallback };
}

/** 真灰度，不要用 tint 压暗——带颜色的暗调看起来仍像没解锁的彩图。 */
let _gray: PIXI.ColorMatrixFilter | null = null;

export function applyGray(target: PIXI.DisplayObject): void {
  if (!_gray) {
    _gray = new PIXI.ColorMatrixFilter();
    _gray.desaturate();
  }
  target.filters = [_gray];
}

export function fitSpriteInBox(sprite: PIXI.Sprite, boxW: number, boxH: number, fallback = 256): number {
  const { w, h } = readyTextureSize(sprite.texture, fallback);
  const scale = Math.min(boxW / Math.max(1, w), boxH / Math.max(1, h));
  sprite.scale.set(scale);
  return scale;
}

/** 仅在贴图尚未就绪时回调，避免已加载时同步重绘死循环。 */
export function whenTextureReady(path: string, onReady: () => void): void {
  if (failed.has(path)) return;
  const tex = gameTexture(path);
  if (isTextureReady(tex)) return;
  const list = waiters.get(path) ?? [];
  list.push(onReady);
  waiters.set(path, list);
}

export function isTextureSettled(path: string): boolean {
  if (failed.has(path)) return true;
  const tex = cache.get(path);
  return !!(tex && isTextureReady(tex));
}

/** 成功或失败都算完成，用来挡在进厨房之前。 */
export function preloadTextures(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return Promise.resolve();
  let done = 0;
  return new Promise((resolve) => {
    const tick = (): void => {
      done += 1;
      onProgress?.(done, unique.length);
      if (done >= unique.length) resolve();
    };
    for (const path of unique) {
      let armed = false;
      const once = (): void => {
        if (armed) return;
        armed = true;
        tick();
      };
      if (isTextureSettled(path)) {
        once();
        continue;
      }
      const list = waiters.get(path) ?? [];
      list.push(once);
      waiters.set(path, list);
      gameTexture(path);
      if (isTextureSettled(path)) once();
    }
  });
}

export interface SceneFit {
  x: number;
  y: number;
  scale: number;
  srcW: number;
  srcH: number;
}

/** 铺满设计宽，底对齐，保证桌面/摊面不被裁掉。 */
export function fitWidthBottom(srcW: number, srcH: number, viewW: number, viewH: number): SceneFit {
  const sw = srcW > 0 ? srcW : viewW;
  const sh = srcH > 0 ? srcH : viewH;
  const scale = viewW / sw;
  return { x: 0, y: viewH - sh * scale, scale, srcW: sw, srcH: sh };
}

/** 铺满视口，用于翻摊桌面，避免 4:3 底图只挤在屏幕下沿。 */
export function fitCover(srcW: number, srcH: number, viewW: number, viewH: number): SceneFit {
  const sw = srcW > 0 ? srcW : viewW;
  const sh = srcH > 0 ? srcH : viewH;
  const scale = Math.max(viewW / sw, viewH / sh);
  return {
    x: (viewW - sw * scale) / 2,
    y: (viewH - sh * scale) / 2,
    scale,
    srcW: sw,
    srcH: sh,
  };
}

export function mapNorm(
  fit: SceneFit,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: fit.x + nx * fit.srcW * fit.scale,
    y: fit.y + ny * fit.srcH * fit.scale,
    w: nw * fit.srcW * fit.scale,
    h: nh * fit.srcH * fit.scale,
  };
}

export function applyFit(sprite: PIXI.Sprite, fit: SceneFit): void {
  sprite.position.set(fit.x, fit.y);
  sprite.scale.set(fit.scale);
}
