import * as PIXI from 'pixi.js';
import { ImageResource } from '@pixi/core';
import { CdnAssetService } from '@/core/CdnAssetService';
import { Game } from '@/core/Game';
import { Platform } from '@/core/PlatformService';
import { ensureSubpackage, subpackageForPath } from '@/utils/bootSubpackages';

const cache = new Map<string, PIXI.Texture>();
const waiters = new Map<string, Array<() => void>>();
const failed = new Set<string>();
const imageRetries = new Map<string, number>();
const _lastAccess = new Map<string, number>();
let _accessSeq = 0;
let _autoTrimTimer = 0;
const IMAGE_RETRY = 2;
const AUTO_TRIM_TRIGGER_MB = 62;
const AUTO_TRIM_TARGET_MB = 48;
const ADOPT_LARGE_PIXEL_THRESHOLD = 512 * 512;
const ADOPT_FRAME_BUDGET = 2;
const ADOPT_PRELOAD_BATCH = 8;
const WATCH_THROTTLE_MS = 72;

interface AdoptTask {
  path: string;
  tex: PIXI.Texture;
  img: any;
}

const _adoptQueue: AdoptTask[] = [];
let _adoptScheduled = false;
let _activePreloads = 0;

const _nextFrame: (cb: () => void) => unknown = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (cb: () => void) => globalThis.setTimeout(cb, 0);

function touchAccess(path: string): void {
  _lastAccess.set(path, ++_accessSeq);
}

function getCachedApproxBytes(): number {
  let bytes = 0;
  for (const tex of cache.values()) {
    if (isTextureReady(tex)) {
      bytes += tex.width * tex.height * 4;
    }
  }
  return bytes;
}

function scheduleAutoBudgetTrim(): void {
  if (_autoTrimTimer) return;
  _autoTrimTimer = globalThis.setTimeout(() => {
    _autoTrimTimer = 0;
    if (getCachedApproxBytes() > AUTO_TRIM_TRIGGER_MB * 1024 * 1024) {
      trimTexturesToBudget(AUTO_TRIM_TARGET_MB, true);
    }
  }, 80) as unknown as number;
}

let _placeholderBase: PIXI.BaseTexture | null = null;
function getPlaceholderBase(): PIXI.BaseTexture {
  if (!_placeholderBase || _placeholderBase.destroyed) {
    const pixels = new Uint8Array([0, 0, 0, 0]);
    _placeholderBase = PIXI.BaseTexture.fromBuffer(pixels, 1, 1);
  }
  return _placeholderBase;
}

function emptyTexture(): PIXI.Texture {
  return new PIXI.Texture(getPlaceholderBase());
}

function adopt(tex: PIXI.Texture, img: any, path?: string): void {
  const prevBase = tex.baseTexture;
  const resource = new ImageResource(img, { createBitmap: false, autoLoad: true });
  const base = new PIXI.BaseTexture(resource);
  const w = Math.max(1, img.width || base.width || 1);
  const h = Math.max(1, img.height || base.height || 1);
  tex.baseTexture = base;
  tex.frame = new PIXI.Rectangle(0, 0, w, h);
  tex.orig = new PIXI.Rectangle(0, 0, w, h);
  tex.updateUvs();
  if (path) touchAccess(path);
  if (prevBase && prevBase !== base && prevBase !== _placeholderBase && !prevBase.destroyed) {
    try { prevBase.destroy(); } catch { /* ignore */ }
  }
  if (getCachedApproxBytes() > AUTO_TRIM_TRIGGER_MB * 1024 * 1024) {
    scheduleAutoBudgetTrim();
  }
}

function flush(path: string): void {
  const list = waiters.get(path);
  if (!list) return;
  waiters.delete(path);
  for (const cb of list) {
    try { cb(); } catch (e) { console.warn('[assets] ready cb', e); }
  }
}

function bindWhenValid(path: string, tex: PIXI.Texture): void {
  if (isTextureReady(tex)) {
    flush(path);
    return;
  }
  const base = tex.baseTexture;
  let armed = false;
  const done = (): void => {
    if (armed) return;
    armed = true;
    base.off('loaded', done);
    base.off('update', done);
    flush(path);
  };
  base.once('loaded', done);
  base.once('update', done);
  globalThis.setTimeout(done, 800);
}

function runAdoptTask(task: AdoptTask): void {
  try {
    adopt(task.tex, task.img, task.path);
    imageRetries.delete(task.path);
    failed.delete(task.path);
    bindWhenValid(task.path, task.tex);
  } catch (e) {
    console.warn('[assets] bind 失败', task.path, e);
    flush(task.path);
  }
}

function scheduleAdoptQueue(): void {
  if (_adoptScheduled || _adoptQueue.length === 0) return;
  _adoptScheduled = true;
  _nextFrame(processAdoptQueue);
}

function processAdoptQueue(): void {
  _adoptScheduled = false;
  if (_adoptQueue.length === 0) return;

  if (_activePreloads > 0) {
    // 启动 Loading / 过场幕布预载阶段：每帧最多消费 8 张图，保障进度条极速跑满
    let count = 0;
    while (_adoptQueue.length > 0 && count < ADOPT_PRELOAD_BATCH) {
      const task = _adoptQueue.shift()!;
      if (task.tex.destroyed || cache.get(task.path) !== task.tex) {
        continue;
      }
      count += 1;
      runAdoptTask(task);
    }
  } else {
    // 局内无遮罩游玩阶段：按帧预算（2 单位）平滑上传 GPU 纹理，消除多图同时 onload 引起的单帧掉帧尖峰
    let used = 0;
    while (_adoptQueue.length > 0 && used < ADOPT_FRAME_BUDGET) {
      const head = _adoptQueue[0];
      if (head.tex.destroyed || cache.get(head.path) !== head.tex) {
        _adoptQueue.shift();
        continue;
      }
      const pixels = (Number(head.img?.width) || 0) * (Number(head.img?.height) || 0);
      const cost = pixels > ADOPT_LARGE_PIXEL_THRESHOLD ? 2 : 1;
      if (used > 0 && used + cost > ADOPT_FRAME_BUDGET) {
        break;
      }
      _adoptQueue.shift();
      used += cost;
      runAdoptTask(head);
    }
  }

  if (_adoptQueue.length > 0) {
    scheduleAdoptQueue();
  }
}

function enqueueAdopt(path: string, tex: PIXI.Texture, img: any): void {
  _adoptQueue.push({ path, tex, img });
  scheduleAdoptQueue();
}

/**
 * 微信里不要 PIXI.Texture.from(path)。
 * 等 wx.createImage onload 后再分帧绑 ImageResource，并关掉 createImageBitmap。
 */
export function gameTexture(path: string): PIXI.Texture {
  const hit = cache.get(path);
  if (hit) {
    touchAccess(path);
    return hit;
  }

  const tex = emptyTexture();
  cache.set(path, tex);
  touchAccess(path);

  const img = Platform.createImage();
  let httpsTried = false;
  let loaded = false;
  const https = CdnAssetService.isCdnPath(path) ? CdnAssetService.publicUrl(path) : '';
  const finishFail = (err: unknown): void => {
    console.warn('[assets] 图片加载失败', path, err);
    failed.add(path);
    flush(path);
  };
  const assignSrc = (src: string): void => {
    try {
      img.src = src;
    } catch (e) {
      finishFail(e);
    }
  };
  img.onload = () => {
    loaded = true;
    img.onload = null;
    img.onerror = null;
    enqueueAdopt(path, tex, img);
  };
  img.onerror = (err: unknown) => {
    if (!httpsTried && https && img.src !== https) {
      httpsTried = true;
      assignSrc(https);
      return;
    }
    const n = imageRetries.get(path) ?? 0;
    const pkg = subpackageForPath(path);
    if (n < IMAGE_RETRY) {
      imageRetries.set(path, n + 1);
      globalThis.setTimeout(() => {
        void (async () => {
          if (pkg) await ensureSubpackage(pkg);
          if (CdnAssetService.isCdnPath(path)) {
            CdnAssetService.invalidateCache(path);
            try {
              assignSrc(await CdnAssetService.resolveOrDownload(path));
              return;
            } catch (_) { /* 下面回落相对路径 */ }
          }
          assignSrc(path);
        })().catch(finishFail);
      }, 600 * (n + 1));
      return;
    }
    finishFail(err);
  };
  globalThis.setTimeout(() => {
    if (loaded || isTextureReady(tex) || failed.has(path)) return;
    img.onerror?.(new Error('decode timeout'));
  }, 8000);
  void CdnAssetService.resolveOrDownload(path).then(assignSrc).catch((err) => {
    if (https) {
      assignSrc(https);
      return;
    }
    console.warn('[assets] CDN 解析失败，回落本地路径', path, err);
    assignSrc(path);
  });
  return tex;
}

/** 首屏分包未齐时失败的图，清掉占位后再拉一次。 */
export function retryTexture(path: string): PIXI.Texture {
  const prev = cache.get(path);
  if (prev && isTextureReady(prev)) return prev;
  failed.delete(path);
  imageRetries.delete(path);
  if (prev) {
    cache.delete(path);
    const oldBase = prev.baseTexture;
    if (oldBase && oldBase !== _placeholderBase && !oldBase.destroyed) {
      try { oldBase.destroy(); } catch { /* ignore */ }
    }
    try { prev.destroy(false); } catch { /* ignore */ }
  }
  return gameTexture(path);
}

/** 遍历当前舞台显示树，收集所有正在被可见场景与已打开弹窗节点引用的 BaseTexture（跳过已关闭的顶层隐藏容器/弹窗）。 */
function collectMountedBaseTextures(root: PIXI.DisplayObject | null | undefined): Set<PIXI.BaseTexture> {
  const used = new Set<PIXI.BaseTexture>();
  if (!root || root.destroyed) return used;
  const stack: PIXI.DisplayObject[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (!cur || cur.destroyed) continue;
    const anyCur = cur as any;
    if (!cur.visible) {
      const isTopHidden = cur.parent === root;
      const isClosedOverlayChild = !!(cur.parent && cur.parent.parent === root && (cur.parent as any).zIndex === 10000);
      const isClosedPanel = anyCur._isOpen === false;
      if (isTopHidden || isClosedOverlayChild || isClosedPanel) {
        continue;
      }
    }
    const rawTex = anyCur.texture ?? anyCur._texture ?? anyCur.shader?.texture ?? anyCur.shader?.uniforms?.uSampler;
    const baseTex: PIXI.BaseTexture | undefined = rawTex instanceof PIXI.BaseTexture ? rawTex : rawTex?.baseTexture;
    if (baseTex && !baseTex.destroyed) used.add(baseTex);
    if (cur instanceof PIXI.Container && cur.children.length > 0) {
      for (let i = 0; i < cur.children.length; i++) {
        stack.push(cur.children[i]);
      }
    }
  }
  return used;
}

const PROTECTED_CORE_PATHS: ReadonlySet<string> = new Set([
  'subpkg_kitchen/ui_cook_btn.png',
  'subpkg_images/scene_pk_plaque.png',
  'subpkg_images/scene_pk_tag_h.png',
  'subpkg_images/scene_pk_plate.png',
  'subpkg_images/scene_pk_seal.png',
  'subpkg_images/scene_pk_hourglass.png',
  'subpkg_images/scene_pk_ink_divider.png',
]);

/** 高频微型公共底件与启动核心小图标白名单，永不误删。 */
function isProtectedCoreAsset(path: string): boolean {
  if (path === 'boot/loading_bg.jpg') return false;
  if (path.startsWith('boot/')) return true;
  if (PROTECTED_CORE_PATHS.has(path)) return true;
  return path.startsWith('subpkg_kitchen/hud_')
    || path.startsWith('subpkg_kitchen/ui_btn_')
    || path.startsWith('subpkg_kitchen/ui_fridge_btn_')
    || path.startsWith('subpkg_kitchen/ui_kit_')
    || path.startsWith('subpkg_kitchen/ui_close_')
    || path.startsWith('subpkg_kitchen/ui_header_');
}

/** 真正跨大场景的一次性背景大图（不含弹窗底板；弹窗底板交由 48~62MB LRU 水位常驻保温与淘汰）。 */
function isTransientLargeSceneAsset(path: string): boolean {
  return path === 'boot/loading_bg.jpg'
    || path === 'subpkg_images/dest_street_bg.jpg'
    || path === 'subpkg_images/outing_curtain.jpg'
    || path.startsWith('subpkg_images/stall_')
    || path.startsWith('subpkg_images/market_')
    || path.startsWith('subpkg_images/special_')
    || path.startsWith('subpkg_kitchen/kitchen_room_');
}

function evictCachedTexture(path: string, tex: PIXI.Texture): void {
  const base = tex.baseTexture;
  cache.delete(path);
  failed.delete(path);
  imageRetries.delete(path);
  _lastAccess.delete(path);
  if (base && base !== _placeholderBase && !base.destroyed) {
    try {
      const res = base.resource as any;
      const srcImg = res?.source;
      if (srcImg && typeof srcImg === 'object') {
        try {
          srcImg.onload = null;
          srcImg.onerror = null;
          if ('src' in srcImg) srcImg.src = '';
        } catch { /* ignore */ }
      }
      base.destroy();
    } catch { /* ignore */ }
  }
  try {
    tex.destroy(false);
  } catch { /* ignore */ }
}

/**
 * 显存预算与 LRU 自动水位裁剪：
 * 1. dropTransientScenes 为真时，立即卸载所有未挂载的跨大场景背景大图；
 * 2. 若剩余缓存总显存仍高于 maxMB，按 _lastAccess 从最久未使用到最近使用（LRU）依次卸载未挂载的非保护贴图，直到回落至 maxMB 以下。
 * 严格保护：当前挂载节点引用的 BaseTexture、有 waiters 的路径、keepPaths 及高频公共微型底件绝不卸载。
 */
export function trimTexturesToBudget(
  maxMB = AUTO_TRIM_TARGET_MB,
  dropTransientScenes = true,
  keepPaths?: Iterable<string>,
): number {
  const mounted = collectMountedBaseTextures(Game.stage);
  const keep = new Set<string>(keepPaths ?? []);
  let evicted = 0;

  for (const [path, tex] of [...cache.entries()]) {
    if (keep.has(path) || waiters.has(path) || isProtectedCoreAsset(path)) continue;
    if (tex.baseTexture && mounted.has(tex.baseTexture)) continue;

    if (failed.has(path)) {
      evictCachedTexture(path, tex);
      evicted += 1;
      continue;
    }

    if (!isTextureReady(tex)) continue;

    if (dropTransientScenes && isTransientLargeSceneAsset(path)) {
      evictCachedTexture(path, tex);
      evicted += 1;
    }
  }

  let bytes = getCachedApproxBytes();
  const budgetBytes = Math.max(0, maxMB) * 1024 * 1024;
  if (bytes > budgetBytes) {
    const lruCandidates: Array<{ path: string; tex: PIXI.Texture; seq: number; texBytes: number }> = [];
    for (const [path, tex] of cache.entries()) {
      if (keep.has(path) || waiters.has(path) || isProtectedCoreAsset(path)) continue;
      if (tex.baseTexture && mounted.has(tex.baseTexture)) continue;
      if (!isTextureReady(tex)) continue;
      lruCandidates.push({
        path,
        tex,
        seq: _lastAccess.get(path) ?? 0,
        texBytes: tex.width * tex.height * 4,
      });
    }
    lruCandidates.sort((a, b) => a.seq - b.seq);
    for (const item of lruCandidates) {
      if (bytes <= budgetBytes) break;
      evictCachedTexture(item.path, item.tex);
      bytes -= item.texBytes;
      evicted += 1;
    }
  }

  return evicted;
}

/**
 * 安全卸载当前未挂载在舞台上的非当前场景超大图纹理与超出预算的闲置贴图（兼容场景切换与 wx/tt.onMemoryWarning）。
 */
export function trimSceneTextures(opts?: {
  aggressive?: boolean;
  keepPaths?: Iterable<string>;
}): number {
  const maxMB = opts?.aggressive ? 36 : AUTO_TRIM_TARGET_MB;
  return trimTexturesToBudget(maxMB, true, opts?.keepPaths);
}

export function getTextureCacheStats(): { cachedCount: number; readyCount: number; approxMB: number } {
  let readyCount = 0;
  let bytes = 0;
  for (const tex of cache.values()) {
    if (isTextureReady(tex)) {
      readyCount += 1;
      bytes += tex.width * tex.height * 4;
    }
  }
  return {
    cachedCount: cache.size,
    readyCount,
    approxMB: Math.round((bytes / (1024 * 1024)) * 100) / 100,
  };
}

/** 微信分包根目录；勿再用 `images/`，开发者工具会把它当纯资源目录，导致 loadSubpackage module not found。 */
export const IMG_DIR = 'subpkg_images';

const KITCHEN_BUNDLED_ITEMS = new Set([
  'pickled_cucumber',
  'pickled_garlic',
  'pickled_greens',
  'pickled_chili',
]);

const KITCHEN_BUNDLED_DISHES = new Set([
  'crispy_cucumber_egg',
  'jade_garlic_tofu',
  'sauerkraut_fish',
  'chopped_chili_fish',
  'apple_ribs',
  'asparagus_lamb',
  'bitter_egg',
  'braised_lamb',
  'coconut_chicken',
  'dragon_beef',
  'garlic_okra',
  'hawthorn_ribs',
  'lemon_bass',
  'loofah_soup',
  'lychee_ribs',
  'mango_shrimp',
  'orange_wings',
  'papaya_fish',
  'pea_shrimp',
  'pear_shrimp',
  'pear_tremella',
  'pineapple_pork',
  'squid_stir',
  'steam_bass',
]);

/** minigame/subpkg_images/*_rotten.png 真实存在的全部 94 项烂菜贴图白名单，根除不存在贴图的 404 下载重试风暴。 */
export const ROTTEN_ITEM_IDS: ReadonlySet<string> = new Set([
  'apple', 'asparagus', 'bamboo_shoot', 'beef_brisket', 'beef', 'bird_chili', 'bitter_melon',
  'bokchoy', 'broccoli', 'cabbage', 'caitai', 'carrot', 'celery', 'century_egg', 'chestnut',
  'chicken_leg', 'chicken_wing', 'chive', 'cilantro', 'clam', 'coconut', 'corn', 'crab',
  'crucian', 'cucumber', 'dragonfruit', 'dried_chili', 'dried_scallop', 'dried_tofu',
  'duck_blood', 'duck_leg', 'egg', 'eggplant', 'garlic', 'ginger', 'goji', 'greenbean',
  'hairtail', 'ham', 'hawthorn', 'kelp', 'lamb', 'lemon', 'lettuce', 'lettuce_stem', 'lily',
  'loofah', 'lotus', 'lotus_seed', 'lychee', 'mango', 'matsutake', 'melon', 'mushroom', 'okra',
  'onion', 'orange', 'oyster', 'papaya', 'pea', 'pear', 'pepper', 'peppercorn', 'perilla',
  'pineapple', 'pork_belly', 'pork_liver', 'pork', 'potato', 'pumpkin', 'radish', 'rapeseed',
  'ribs', 'river_eel', 'river_shrimp', 'round_cabbage', 'scallion', 'seabass', 'shrimp',
  'smallfish', 'spinach', 'sprout', 'squid', 'star_anise', 'taro', 'tofu', 'tomato',
  'tremella', 'vermicelli', 'water_spinach', 'wild_yellowfish', 'wood_ear', 'yam', 'yellowfish',
]);

export function hasRottenTexture(id: string): boolean {
  return !KITCHEN_BUNDLED_ITEMS.has(id) && ROTTEN_ITEM_IDS.has(id);
}

export function imgPath(file: string): string {
  return `${IMG_DIR}/${file}`;
}

export function resolveItemAssetPath(id: string, rotten = false): string {
  if (KITCHEN_BUNDLED_ITEMS.has(id)) {
    return `subpkg_kitchen/item_${id}.png`;
  }
  const useRotten = rotten && hasRottenTexture(id);
  return imgPath(`${id}${useRotten ? '_rotten' : ''}.png`);
}

export function resolveDishAssetPath(recipeId: string): string {
  if (KITCHEN_BUNDLED_DISHES.has(recipeId)) {
    return `subpkg_kitchen/dish_${recipeId}.png`;
  }
  return imgPath(`dish_${recipeId}.png`);
}

export function itemTexture(id: string): PIXI.Texture {
  return gameTexture(resolveItemAssetPath(id));
}

export type ItemLook = 'clean' | 'rotten';

/** 脏/坏图不在白名单或未就绪时直接回落到干净图（绝不发起 404 请求），调用方可用 tint 区分。 */
export function itemLookTexture(id: string, look: ItemLook): PIXI.Texture {
  if (look !== 'rotten' || !hasRottenTexture(id)) return itemTexture(id);
  const path = resolveItemAssetPath(id, true);
  if (failed.has(path)) return itemTexture(id);
  const named = gameTexture(path);
  if (isTextureReady(named)) return named;
  return itemTexture(id);
}

export function dishTexture(recipeId: string): PIXI.Texture {
  return gameTexture(resolveDishAssetPath(recipeId));
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

/** 仅在贴图尚未就绪且未失败时回调，去重防泄漏，避免已加载时同步重绘死循环或失败后永久滞留 waiters。 */
export function whenTextureReady(path: string, onReady: () => void): void {
  const tex = gameTexture(path);
  if (isTextureReady(tex) || failed.has(path)) return;
  const list = waiters.get(path) ?? [];
  if (!list.includes(onReady)) {
    list.push(onReady);
  }
  waiters.set(path, list);
}

/**
 * 打开菜单/面板时预热当前页贴图，并按 72ms 节流窗口合并刷新（避免多图陆续解码引发十余次整页 relayout）；
 * 当最后一张贴图到位（pendingCount <= 0）时，清掉节流定时器并立即在下一帧触发最终刷新，确保零额外延迟。
 */
export function watchTextures(paths: string[], onReady: () => void): void {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return;

  let pendingCount = 0;
  const pendingPaths: string[] = [];
  for (const path of unique) {
    const tex = gameTexture(path);
    if (!isTextureReady(tex) && !failed.has(path)) {
      pendingCount += 1;
      pendingPaths.push(path);
    }
  }
  if (pendingCount <= 0) return;

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let rafScheduled = false;

  const handleOneSettled = (): void => {
    pendingCount -= 1;
    if (pendingCount <= 0) {
      if (throttleTimer !== null) {
        globalThis.clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (!rafScheduled) {
        rafScheduled = true;
        _nextFrame(() => {
          rafScheduled = false;
          onReady();
        });
      }
      return;
    }
    if (throttleTimer === null) {
      throttleTimer = globalThis.setTimeout(() => {
        throttleTimer = null;
        onReady();
      }, WATCH_THROTTLE_MS);
    }
  };

  for (const path of pendingPaths) {
    let settled = false;
    whenTextureReady(path, () => {
      if (settled) return;
      settled = true;
      handleOneSettled();
    });
  }
}

export function isTextureSettled(path: string): boolean {
  if (failed.has(path)) return true;
  const tex = cache.get(path);
  return !!(tex && isTextureReady(tex));
}

/** 成功或失败都算完成，用来挡在进厨房之前。活跃期间放宽分帧上传速率至每帧 8 张。 */
export function preloadTextures(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return Promise.resolve();
  let done = 0;
  let finished = false;
  _activePreloads += 1;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (finished) return;
      done += 1;
      onProgress?.(done, unique.length);
      if (done >= unique.length) {
        finished = true;
        _activePreloads = Math.max(0, _activePreloads - 1);
        resolve();
      }
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
