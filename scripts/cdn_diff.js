#!/usr/bin/env node
/**
 * 对比本地 minigame/ 里该走 CDN 的文件和 manifest 记录，看线上是不是还对得上。
 * 只读，不上传。用法：node scripts/cdn_diff.js [仓库根目录]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const CDN_DIRS = ['subpkg_images', 'subpkg_audio'];
const CDN_PREFIXES = [
  'subpkg_images/market_route_',
  'subpkg_images/market_card',
  'subpkg_images/market_overview',
  'subpkg_images/stall_rummage_',
  'subpkg_images/stall_pile_',
  'subpkg_images/outing_curtain',
  'subpkg_images/dest_',
  'subpkg_images/special_',
  'subpkg_images/dish_',
  'subpkg_images/npc_',
  'subpkg_audio/',
];
const IGNORE = new Set(['game.js', '.DS_Store', 'Thumbs.db', '.gitkeep']);

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) walk(abs, rel, out);
    else if (!IGNORE.has(e.name)) out.push({ rel, abs });
  }
  return out;
}

const local = new Map();
for (const d of CDN_DIRS) {
  for (const f of walk(path.join(ROOT, 'minigame', d), d, [])) {
    if (CDN_PREFIXES.some((p) => f.rel.startsWith(p))) local.set(f.rel, md5(f.abs));
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.cdn_manifest.json'), 'utf-8'));
const remote = manifest.files ?? {};

const changed = [];
const missing = [];
const orphan = [];
for (const [rel, hash] of local) {
  if (!remote[rel]) missing.push(rel);
  else if (remote[rel].hash !== hash) changed.push(`${rel}  本地 ${hash} != 线上 ${remote[rel].hash}`);
}
for (const rel of Object.keys(remote)) if (!local.has(rel)) orphan.push(rel);

console.log(`仓库: ${ROOT}`);
console.log(`manifest: v${manifest.version}  ${manifest.updated}  前缀 ${manifest.filePrefix}`);
console.log(`本地该走 CDN 的文件: ${local.size} 个，线上记录 ${Object.keys(remote).length} 个\n`);
const dump = (title, arr) => {
  console.log(`${title}: ${arr.length}`);
  for (const s of arr) console.log(`   ${s}`);
};
dump('内容不一致（线上是旧的/别的版本）', changed);
dump('本地有但线上没有（缺上传）', missing);
dump('线上有但本地没有（多余，可删）', orphan);
