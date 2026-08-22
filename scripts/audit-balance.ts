/**
 * 数值自检：跑 `npx tsx scripts/audit-balance.ts`。
 * 只读，不改数据。改完食材/菜谱表就跑一次，别靠肉眼核对。
 */
import { ITEMS, GOD_PICK, getItem } from '../src/sim/items';
import {
  RECIPES,
  START_RECIPES,
  TABLE_UNLOCKS,
  COOK_UNLOCK_AT,
  MARKET_RECIPE_POOL,
  tallyNeeds,
} from '../src/sim/recipes';
import { MARKETS } from '../src/sim/destinations';
import type { Rarity } from '../src/sim/rarity';

const RARITY_CN: Record<Rarity, string> = { common: '普通', rare: '高级', epic: '稀有' };
let problems = 0;
const bad = (msg: string) => {
  problems += 1;
  console.log(`  ✗ ${msg}`);
};

console.log('\n=== 食材：稀有度 / 占格 / 每格单价 ===');
for (const r of ['common', 'rare', 'epic'] as Rarity[]) {
  const rows = [...ITEMS, GOD_PICK]
    .filter((it) => it.rarity === r)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  console.log(`\n[${RARITY_CN[r]}] ${rows.length} 种`);
  for (const it of rows) {
    const area = it.w * it.h;
    const per = (it.prices.common / area).toFixed(2);
    console.log(
      `  ${it.name.padEnd(6, '　')} ${it.w}×${it.h}=${area}格  常${String(it.prices.common).padStart(3)}` +
      ` 鲜${String(it.prices.fresh).padStart(3)} 精${String(it.prices.premium).padStart(3)}  每格${per}`,
    );
  }
}

console.log('\n=== 规则校验：同稀有度内，占格越大越贵 ===');
for (const r of ['common', 'rare', 'epic'] as Rarity[]) {
  const rows = [...ITEMS].filter((it) => it.rarity === r && it.zone === 'dry' && !it.stalls.includes('meat'));
  const sorted = [...rows].sort((a, b) => a.w * a.h - b.w * b.h);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.w * cur.h > prev.w * prev.h && cur.prices.common < prev.prices.common) {
      bad(`${RARITY_CN[r]}：${cur.name} 更占格却比 ${prev.name} 便宜`);
    }
  }
}

console.log('\n=== 规则校验：同占格下，稀有度越高越贵 ===');
const byArea = new Map<string, Array<{ name: string; rarity: Rarity; price: number }>>();
for (const it of ITEMS) {
  if (it.zone !== 'dry' || it.stalls.includes('meat')) continue;
  const key = String(it.w * it.h);
  if (!byArea.has(key)) byArea.set(key, []);
  byArea.get(key)!.push({ name: it.name, rarity: it.rarity, price: it.prices.common });
}
const rank: Record<Rarity, number> = { common: 0, rare: 1, epic: 2 };
for (const [area, rows] of byArea) {
  for (const a of rows) {
    for (const b of rows) {
      if (rank[a.rarity] > rank[b.rarity] && a.price <= b.price) {
        bad(`${area} 格：${a.name}(${RARITY_CN[a.rarity]}) 不比 ${b.name}(${RARITY_CN[b.rarity]}) 贵`);
      }
    }
  }
}

console.log('\n=== 菜谱：份数 / 经验 / 材料成本 / 出锅价 ===');
for (const r of ['common', 'rare', 'epic'] as Rarity[]) {
  const rows = RECIPES.filter((x) => x.rarity === r);
  console.log(`\n[${RARITY_CN[r]}菜] ${rows.length} 道`);
  for (const rec of rows) {
    const cost = rec.needs.reduce((s, id) => s + getItem(id).prices.common, 0);
    const sell = rec.needs.length
      ? rec.cook(rec.needs.map((id) => ({ defId: id, quality: 'common' as const, inspected: true, freshness: 1 })))
      : 0;
    const kinds = tallyNeeds(rec.needs).length;
    console.log(
      `  ${rec.name.padEnd(6, '　')} ${kinds}种${rec.needs.length}份  经验${String(rec.xp).padStart(3)}` +
      `(首${rec.firstXp})  料${String(cost).padStart(3)} → 卖${String(sell).padStart(3)}  赚${sell - cost}`,
    );
    for (const id of rec.needs) {
      try {
        getItem(id);
      } catch {
        bad(`${rec.name} 引用了不存在的食材 ${id}`);
      }
    }
  }
}

console.log('\n=== 解锁覆盖 ===');
const seen = new Map<string, string[]>();
const note = (id: string, from: string) => {
  if (!seen.has(id)) seen.set(id, []);
  seen.get(id)!.push(from);
};
START_RECIPES.forEach((id) => note(id, '开局'));
TABLE_UNLOCKS.forEach((row, i) => row.forEach((id) => note(id, `烹饪台${i + 1}`)));
Object.entries(COOK_UNLOCK_AT).forEach(([lv, id]) => note(id, `厨艺${lv}`));
Object.entries(MARKET_RECIPE_POOL).forEach(([m, ids]) => ids.forEach((id) => note(id, `市场:${m}`)));

for (const rec of RECIPES) {
  const from = seen.get(rec.id);
  if (!from) bad(`${rec.name} 没有任何解锁来源`);
}
for (const [id, from] of seen) {
  const rec = RECIPES.find((r) => r.id === id);
  if (!rec) {
    bad(`解锁表里有未知菜谱 ${id}`);
    continue;
  }
  const shop = from.filter((f) => f.startsWith('市场:'));
  const grant = from.filter((f) => !f.startsWith('市场:'));
  if (grant.length > 1) bad(`${rec.name} 被送了多次：${grant.join(' / ')}`);
  if (grant.length && shop.length) bad(`${rec.name} 既被送又在市场池里：${from.join(' / ')}`);
  if (rec.rarity === 'common' && shop.length) bad(`${rec.name} 是普通菜却进了市场池`);
  if (rec.rarity === 'epic' && grant.length) bad(`${rec.name} 是稀有菜却被白送`);
}
console.log(`  开局 ${START_RECIPES.length} 本 / 烹饪台 ${TABLE_UNLOCKS.flat().length} 本 ` +
  `/ 厨艺 ${Object.keys(COOK_UNLOCK_AT).length} 本 / 市场池 ${new Set(Object.values(MARKET_RECIPE_POOL).flat()).size} 本`);

console.log('\n=== 菜场 ===');
for (const m of MARKETS) {
  const pool = MARKET_RECIPE_POOL[m.id];
  const rar = pool.map((id) => RARITY_CN[RECIPES.find((r) => r.id === id)!.rarity]);
  console.log(`  ${m.name}  厨艺${m.unlockLevel}  包子${m.staminaCost}  油纸池 ${pool.length} 本 [${[...new Set(rar)].join('/')}]`);
}

console.log(problems ? `\n发现 ${problems} 处问题\n` : '\n全部通过\n');
