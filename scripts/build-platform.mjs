/**
 * 把一份内容树 + 一份 bundle 组装成各平台可直接用开发者工具打开的目录。
 *
 * 业界对齐：xiaochu2 / huahua —— 源一份，build/<端> 是生成物。
 *
 *   CLI：node scripts/build-platform.mjs [wechat|all] [--full]
 *   仅 `vite build --watch` 会在插件里组装；一次性 `vite build` 不组装，
 *   留给本脚本在 vite 之后跑。
 *
 * 目前只接入微信；后续加抖音时在 PLATFORMS 里加 douyin 并补 platform/douyin/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyFileIfStale,
  createMirrorStats,
  isRealDir,
  lstatOrNull,
  mirrorDir,
} from './lib/mirror-tree.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = path.join(rootDir, 'minigame');
export const PLATFORM_DIR = path.join(rootDir, 'platform');
export const BUILD_DIR = path.join(rootDir, 'build');
export const BUNDLE_DIR = path.join(rootDir, '.bundle');

export const PLATFORMS = ['wechat'];
export const DEFAULT_PLATFORMS = ['wechat'];

const KEEP = new Set(['project.private.config.json']);
const SKIP_FROM_CONTENT = new Set([
  'game-bundle.js',
  'index.html',
  'game.json',
  'project.config.json',
  'project.private.config.json',
  '.cdn_stripped',
]);

function fail(msg) {
  throw new Error(`[build-platform] ${msg}`);
}

function bundleDirOf(_platform) {
  return BUNDLE_DIR;
}

function cleanStale(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (KEEP.has(entry) || entry.startsWith('.') || entry.endsWith('.zip')) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function inheritAppid(outConfigPath, freshConfig) {
  if (freshConfig.appid) return { config: freshConfig, inherited: null };
  if (!fs.existsSync(outConfigPath)) return { config: freshConfig, inherited: null };
  try {
    const prev = JSON.parse(fs.readFileSync(outConfigPath, 'utf8'));
    if (!prev.appid) return { config: freshConfig, inherited: null };
    return { config: { ...freshConfig, appid: prev.appid }, inherited: prev.appid };
  } catch {
    return { config: freshConfig, inherited: null };
  }
}

function contentLooksCopied(out) {
  const imagesOk = !fs.existsSync(path.join(CONTENT_DIR, 'subpkg_images'))
    || isRealDir(path.join(out, 'subpkg_images'));
  const kitchenOk = !fs.existsSync(path.join(CONTENT_DIR, 'subpkg_kitchen'))
    || isRealDir(path.join(out, 'subpkg_kitchen'));
  const leftoverLink = ['subpkg_images', 'subpkg_kitchen', 'pixi-adapter', 'game.js', 'runtime.js']
    .some((name) => {
      const st = lstatOrNull(path.join(out, name));
      return Boolean(st && st.isSymbolicLink());
    });
  return imagesOk && kitchenOk && !leftoverLink;
}

function formatStats(stats) {
  return `+${stats.copied} ~${stats.skipped} -${stats.pruned}`
    + (stats.repaired ? ` !${stats.repaired}` : '');
}

const RELOAD_TICK_RE = /\n;\/\* jiancai-reload \d+ \*\/\n$/;

/** 小游戏工具通常只因 js/json 变化自动编译；只换图时轻碰 game.js 让模拟器自己起来。 */
function pokeSimulator(out, stats) {
  if (stats.copied === 0 && stats.pruned === 0 && stats.repaired === 0) return;
  const gameJs = path.join(out, 'game.js');
  if (!fs.existsSync(gameJs)) return;
  const prev = fs.readFileSync(gameJs, 'utf8');
  const next = `${prev.replace(RELOAD_TICK_RE, '')}\n;/* jiancai-reload ${Date.now()} */\n`;
  if (next !== prev) fs.writeFileSync(gameJs, next);
}

export function assemble(platform, { quiet = false, bundleDir, full = false } = {}) {
  if (!PLATFORMS.includes(platform)) fail(`未知平台 ${platform}，目前只接入：${PLATFORMS.join(' / ')}`);
  const platformSrc = path.join(PLATFORM_DIR, platform);
  if (!fs.existsSync(platformSrc)) fail(`缺少平台配置目录 platform/${platform}`);

  const resolvedBundleDir = bundleDir || bundleDirOf(platform);
  const bundle = path.join(resolvedBundleDir, 'game-bundle.js');
  if (!fs.existsSync(bundle)) {
    fail(`找不到 ${path.relative(rootDir, bundle)}，请先跑对应 vite build`);
  }
  if (!fs.existsSync(CONTENT_DIR)) fail('缺少 minigame/ 内容树');

  const out = path.join(BUILD_DIR, platform);
  const outConfig = path.join(out, 'project.config.json');
  const configSrc = path.join(platformSrc, 'project.config.json');
  let inherited = null;
  let config = null;
  if (fs.existsSync(configSrc)) {
    const fresh = JSON.parse(fs.readFileSync(configSrc, 'utf8'));
    ({ config, inherited } = inheritAppid(outConfig, fresh));
  }

  const stats = createMirrorStats();
  fs.mkdirSync(out, { recursive: true });
  if (full || !contentLooksCopied(out)) {
    cleanStale(out);
  }
  mirrorDir(CONTENT_DIR, out, { skip: SKIP_FROM_CONTENT, stats });
  const leftoverBundle = path.join(CONTENT_DIR, 'game-bundle.js');
  if (fs.existsSync(leftoverBundle)) {
    fs.rmSync(leftoverBundle);
    if (!quiet) console.log('[build-platform] 已删除 minigame/game-bundle.js（旧产物，勿用这个目录扫码）');
  }
  copyFileIfStale(bundle, path.join(out, 'game-bundle.js'), stats);
  mirrorDir(platformSrc, out, {
    skip: new Set(['project.config.json']),
    prune: false,
    stats,
  });
  if (config) {
    const rendered = `${JSON.stringify(config, null, 2)}\n`;
    const prev = fs.existsSync(outConfig) ? fs.readFileSync(outConfig, 'utf8') : '';
    if (prev !== rendered) fs.writeFileSync(outConfig, rendered, 'utf8');
  }
  pokeSimulator(out, stats);

  if (!quiet) {
    const size = (fs.statSync(bundle).size / 1024).toFixed(0);
    const appidNote = config?.appid
      ? `appid ${config.appid}${inherited ? '（沿用工具里填的，建议同步回 platform/）' : ''}`
      : '无 project.config 或 appid 未填';
    console.log(
      `[build-platform] ${platform} → build/${platform}/ (bundle ${size}KB, ${formatStats(stats)}, ${appidNote})`,
    );
  }
  return stats;
}

export function assembleAll(target = 'all', opts) {
  const targets = target === 'all' ? DEFAULT_PLATFORMS : [target];
  const all = createMirrorStats();
  for (const p of targets) {
    if (!PLATFORMS.includes(p)) fail(`未知平台 ${p}，目前只接入：${PLATFORMS.join(' / ')} / all`);
    const one = assemble(p, opts);
    all.copied += one.copied;
    all.skipped += one.skipped;
    all.pruned += one.pruned;
    all.repaired += one.repaired;
  }
  return all;
}

function shouldIgnoreWatchName(filename) {
  if (!filename) return false;
  const base = String(filename).split(/[\\/]/).pop() || '';
  if (!base) return false;
  if (base.startsWith('.')) return true;
  return base === 'game-bundle.js'
    || base === 'index.html'
    || base === '.DS_Store'
    || base === '.cdn_stripped'
    || base.endsWith('.jiancai-tmp');
}

/**
 * 只听 minigame/ 与 platform/，不听 build/。
 * 改图不会触发 Vite 重打 JS；由调用方排队跑增量 assemble。
 */
export function watchContentTrees(onChange, { debounceMs = 250 } = {}) {
  let timer = null;
  const kick = (_event, filename) => {
    if (shouldIgnoreWatchName(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  const watchers = [];
  const opts = { recursive: true };
  if (fs.existsSync(CONTENT_DIR)) watchers.push(fs.watch(CONTENT_DIR, opts, kick));
  if (fs.existsSync(PLATFORM_DIR)) watchers.push(fs.watch(PLATFORM_DIR, opts, kick));
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const full = args.includes('--full');
    const target = args.find((a) => a !== '--full') ?? process.env.JIANCAI_PLATFORM ?? 'all';
    assembleAll(target, { full });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
