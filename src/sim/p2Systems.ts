import { dexActiveBonuses } from './dex';
import { MARKETS } from './destinations';
import { GOD_PICK, ITEMS, PICKLE_ITEM_IDS, getItem, itemArea, marketFoodIds } from './items';
import {
  applyNeighborReward,
  canUseDailyAd,
  cookLevel,
  countFridgeFood,
  deductFridgeFoods,
  markDailyAdUsed,
  recipeUnlockView,
  type KitchenSave,
} from './kitchen';
import { rarityRank } from './rarity';
import { isRecipeUnlocked, recipeById, type RecipeId } from './recipes';
import { mulberry32, rngPick, rngWeighted, type Rng } from './rng';

// ═══════════════════════════════════════════════════════════════════════════
// 1. 老坛腌制坊（Pickle Jar System）
// ═══════════════════════════════════════════════════════════════════════════

export const PICKLE_UNLOCK_LEVEL = 2;
export const SECOND_JAR_COST = 120;

export type PickleFormulaId = 'cucumber' | 'garlic' | 'greens' | 'chili';

export interface PickleFormulaInput {
  defId: string;
  qty: number;
}

export interface PickleFormulaDef {
  id: PickleFormulaId;
  name: string;
  outputDefId: string;
  baseQty: number;
  durationMs: number;
  unlockCookLevel: number;
  unlockRecipeId: RecipeId;
  inputs: PickleFormulaInput[];
  blurb: string;
}

export interface PickleJarSlot {
  formulaId: PickleFormulaId;
  startedAt: number;
  readyAt: number;
  boosted?: boolean;
  bonusQty?: number;
}

export const PICKLE_FORMULAS: readonly PickleFormulaDef[] = [
  {
    id: 'cucumber',
    name: '脆腌黄瓜',
    outputDefId: 'pickled_cucumber',
    baseQty: 2,
    durationMs: 45 * 60 * 1000,
    unlockCookLevel: 2,
    unlockRecipeId: 'crispy_cucumber_egg',
    inputs: [
      { defId: 'cucumber', qty: 2 },
      { defId: 'garlic', qty: 1 },
    ],
    blurb: '顶花黄瓜拍裂拌蒜，老盐水浸四十五分钟，捞出来咔嚓响。',
  },
  {
    id: 'garlic',
    name: '糖醋腊八蒜',
    outputDefId: 'pickled_garlic',
    baseQty: 2,
    durationMs: 90 * 60 * 1000,
    unlockCookLevel: 2,
    unlockRecipeId: 'jade_garlic_tofu',
    inputs: [
      { defId: 'garlic', qty: 3 },
    ],
    blurb: '白蒜浸进陈年米醋，等它慢慢变绿，酸甜脆爽不冲鼻。',
  },
  {
    id: 'greens',
    name: '老坛酸菜',
    outputDefId: 'pickled_greens',
    baseQty: 2,
    durationMs: 120 * 60 * 1000,
    unlockCookLevel: 3,
    unlockRecipeId: 'sauerkraut_fish',
    inputs: [
      { defId: 'bokchoy', qty: 3 },
      { defId: 'ginger', qty: 1 },
    ],
    blurb: '三棵青菜压进琥珀老卤，姜片镇底，熬一锅金汤全靠它。',
  },
  {
    id: 'chili',
    name: '红油剁椒',
    outputDefId: 'pickled_chili',
    baseQty: 2,
    durationMs: 180 * 60 * 1000,
    unlockCookLevel: 5,
    unlockRecipeId: 'chopped_chili_fish',
    inputs: [
      { defId: 'pepper', qty: 3 },
      { defId: 'garlic', qty: 1 },
    ],
    blurb: '鲜椒细细剁碎封坛，蒜香封顶，揭盖就是镇店大菜的排面。',
  },
];

export function pickleFormulaById(id: string): PickleFormulaDef | undefined {
  return PICKLE_FORMULAS.find((f) => f.id === id);
}

export function defaultPickleJars(): Array<PickleJarSlot | null> {
  return [null, null];
}

export function migratePickleJars(raw: unknown): Array<PickleJarSlot | null> {
  const base: Array<PickleJarSlot | null> = [null, null];
  if (!Array.isArray(raw)) return base;
  for (let i = 0; i < 2; i++) {
    const row = raw[i];
    if (!row || typeof row !== 'object') continue;
    const rec = row as Partial<PickleJarSlot>;
    if (typeof rec.formulaId !== 'string' || !pickleFormulaById(rec.formulaId)) continue;
    const startedAt = typeof rec.startedAt === 'number' && Number.isFinite(rec.startedAt)
      ? Math.max(0, Math.floor(rec.startedAt))
      : 0;
    const readyAt = typeof rec.readyAt === 'number' && Number.isFinite(rec.readyAt)
      ? Math.max(0, Math.floor(rec.readyAt))
      : 0;
    if (readyAt <= 0) continue;
    base[i] = {
      formulaId: rec.formulaId as PickleFormulaId,
      startedAt,
      readyAt,
      boosted: rec.boosted === true,
      bonusQty: typeof rec.bonusQty === 'number' && Number.isFinite(rec.bonusQty)
        ? Math.max(0, Math.floor(rec.bonusQty))
        : 0,
    };
  }
  return base;
}

export function pickleUnlocked(save: Pick<KitchenSave, 'level'>): boolean {
  return cookLevel(save as KitchenSave) >= PICKLE_UNLOCK_LEVEL;
}

export interface PickleSlotView {
  index: 0 | 1;
  locked: boolean;
  slot: PickleJarSlot | null;
  status: 'locked' | 'empty' | 'fermenting' | 'ready';
  remainMs: number;
  progress: number;
  formula?: PickleFormulaDef;
  yieldQty: number;
}

export function pickleSlotView(save: KitchenSave, index: 0 | 1, now = Date.now()): PickleSlotView {
  const unlocked = index === 0 ? true : !!save.secondJarUnlocked;
  if (!unlocked) {
    return { index, locked: true, slot: null, status: 'locked', remainMs: 0, progress: 0, yieldQty: 0 };
  }
  const jars = save.pickleJars ?? defaultPickleJars();
  const slot = jars[index] ?? null;
  if (!slot) {
    return { index, locked: false, slot: null, status: 'empty', remainMs: 0, progress: 0, yieldQty: 0 };
  }
  const formula = pickleFormulaById(slot.formulaId);
  if (!formula) {
    return { index, locked: false, slot: null, status: 'empty', remainMs: 0, progress: 0, yieldQty: 0 };
  }
  const remainMs = Math.max(0, slot.readyAt - now);
  const total = Math.max(1, slot.readyAt - slot.startedAt || formula.durationMs);
  const progress = remainMs <= 0 ? 1 : Math.min(1, Math.max(0, 1 - remainMs / total));
  const yieldQty = formula.baseQty + Math.max(0, slot.bonusQty ?? 0);
  return {
    index,
    locked: false,
    slot,
    status: remainMs <= 0 ? 'ready' : 'fermenting',
    remainMs,
    progress,
    formula,
    yieldQty,
  };
}

export function pickleSlotsView(save: KitchenSave, now = Date.now()): [PickleSlotView, PickleSlotView] {
  return [pickleSlotView(save, 0, now), pickleSlotView(save, 1, now)];
}

export function pickleReadyCount(save: KitchenSave, now = Date.now()): number {
  if (!pickleUnlocked(save)) return 0;
  return pickleSlotsView(save, now).filter((s) => s.status === 'ready').length;
}

export function pickleFermentingCount(save: KitchenSave, now = Date.now()): number {
  if (!pickleUnlocked(save)) return 0;
  return pickleSlotsView(save, now).filter((s) => s.status === 'fermenting').length;
}

export interface PickleInputStatus {
  defId: string;
  name: string;
  have: number;
  need: number;
}

export function pickleFormulaStatus(save: KitchenSave, formulaId: PickleFormulaId): {
  formula: PickleFormulaDef;
  levelMet: boolean;
  inputs: PickleInputStatus[];
  canAffordInputs: boolean;
  recipeAlreadyUnlocked: boolean;
} {
  const formula = pickleFormulaById(formulaId) ?? PICKLE_FORMULAS[0];
  const levelMet = cookLevel(save) >= formula.unlockCookLevel;
  const inputs = formula.inputs.map((inp) => ({
    defId: inp.defId,
    name: getItem(inp.defId).name,
    have: countFridgeFood(save.fridge, inp.defId),
    need: inp.qty,
  }));
  const canAffordInputs = inputs.every((row) => row.have >= row.need);
  const recipeAlreadyUnlocked = isRecipeUnlocked(recipeUnlockView(save), formula.unlockRecipeId);
  return { formula, levelMet, inputs, canAffordInputs, recipeAlreadyUnlocked };
}

export function formatTimerShort(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}时${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(s).padStart(2, '0')}秒`;
  return `${s}秒`;
}

export function formatDurationLabel(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}小时`;
  if (mins >= 60) return `${Math.floor(mins / 60)}小时${mins % 60}分`;
  return `${mins}分钟`;
}

export type PickleTier = 0 | 1 | 2;

export interface PickleTierDef {
  tier: PickleTier;
  name: string;
  cost: number;
  cookNeed: number;
  durationMul: number;
  extraYieldChance: number;
  desc: string;
}

export const PICKLE_TIER_DEFS: readonly PickleTierDef[] = [
  { tier: 0, name: '粗陶老坛', cost: 0, cookNeed: 2, durationMul: 1, extraYieldChance: 0, desc: '朴拙透气的粗陶老坛' },
  { tier: 1, name: '青釉双耳坛', cost: 680, cookNeed: 8, durationMul: 0.92, extraYieldChance: 0, desc: '发酵耗时 -8% · 青瓷锁鲜更醇厚' },
  { tier: 2, name: '青花御瓷坛', cost: 2600, cookNeed: 14, durationMul: 0.84, extraYieldChance: 0.30, desc: '发酵耗时 -16% · 30% 多出 1 份' },
];

export function pickleTier(save: Pick<KitchenSave, 'pickleTier'>): PickleTier {
  return save.pickleTier === 2 ? 2 : save.pickleTier === 1 ? 1 : 0;
}

export function pickleEffectiveDurationMs(
  save: Pick<KitchenSave, 'pickleTier' | 'dexStampsClaimed'>,
  baseDurationMs: number,
): number {
  const tierDef = PICKLE_TIER_DEFS[pickleTier(save)];
  const stampMul = dexActiveBonuses(save).pickleDurationMul;
  return Math.max(60 * 1000, Math.round(baseDurationMs * tierDef.durationMul * stampMul));
}

export type PropUpgradeState =
  | { status: 'max'; curName: string }
  | { status: 'ready'; cost: number; nextName: string; nextDesc: string; cookNeed: number }
  | { status: 'blocked'; cost: number; nextName: string; nextDesc: string; cookNeed: number; error: string };

export function pickleUpgradeState(save: KitchenSave): PropUpgradeState {
  const cur = pickleTier(save);
  if (cur >= 2) return { status: 'max', curName: PICKLE_TIER_DEFS[2].name };
  const next = PICKLE_TIER_DEFS[(cur + 1) as PickleTier];
  if (cookLevel(save) < next.cookNeed) {
    return {
      status: 'blocked',
      cost: next.cost,
      nextName: next.name,
      nextDesc: next.desc,
      cookNeed: next.cookNeed,
      error: `厨艺 ${next.cookNeed} 级解锁「${next.name}」`,
    };
  }
  if (save.money < next.cost) {
    return {
      status: 'blocked',
      cost: next.cost,
      nextName: next.name,
      nextDesc: next.desc,
      cookNeed: next.cookNeed,
      error: `差 ${next.cost - save.money} 金币`,
    };
  }
  return {
    status: 'ready',
    cost: next.cost,
    nextName: next.name,
    nextDesc: next.desc,
    cookNeed: next.cookNeed,
  };
}

export function buyPickleTierUpgrade(save: KitchenSave): { save: KitchenSave; nextName?: string; error?: string } {
  const st = pickleUpgradeState(save);
  if (st.status === 'max') return { save, error: '老坛已经是最高品阶啦' };
  if (st.status === 'blocked') return { save, error: st.error };
  const nextTier = (pickleTier(save) + 1) as PickleTier;
  return {
    save: {
      ...save,
      money: save.money - st.cost,
      pickleTier: nextTier,
    },
    nextName: st.nextName,
  };
}

export function buySecondPickleJar(save: KitchenSave): { save: KitchenSave; error?: string } {
  if (!pickleUnlocked(save)) {
    return { save, error: `厨艺 ${PICKLE_UNLOCK_LEVEL} 级开启老坛腌制坊` };
  }
  if (save.secondJarUnlocked) {
    return { save, error: '二号老坛已经添置好啦' };
  }
  if (save.money < SECOND_JAR_COST) {
    return { save, error: `还差 ${SECOND_JAR_COST - save.money} 金币才能添二号坛` };
  }
  return {
    save: {
      ...save,
      money: save.money - SECOND_JAR_COST,
      secondJarUnlocked: true,
      pickleJars: migratePickleJars(save.pickleJars),
    },
  };
}

export function startPickle(
  save: KitchenSave,
  formulaId: PickleFormulaId,
  preferredSlot?: 0 | 1,
  now = Date.now(),
): { save: KitchenSave; slotIndex?: 0 | 1; error?: string } {
  if (!pickleUnlocked(save)) {
    return { save, error: `厨艺 ${PICKLE_UNLOCK_LEVEL} 级开启老坛腌制坊` };
  }
  const formula = pickleFormulaById(formulaId);
  if (!formula) return { save, error: '未知腌制方子' };
  if (cookLevel(save) < formula.unlockCookLevel) {
    return { save, error: `厨艺 ${formula.unlockCookLevel} 级解锁「${formula.name}」` };
  }
  const slots = pickleSlotsView(save, now);
  let target: PickleSlotView | undefined;
  if (preferredSlot !== undefined) {
    const cand = slots[preferredSlot];
    if (cand && cand.status === 'empty') target = cand;
  }
  if (!target) {
    target = slots.find((s) => s.status === 'empty');
  }
  if (!target) {
    const anyReady = slots.some((s) => s.status === 'ready');
    return {
      save,
      error: anyReady ? '先把发好的老坛揭盖收进冰箱吧' : '坛子都在忙着发酵呢',
    };
  }
  const deducted = deductFridgeFoods(save.fridge, formula.inputs);
  if (!deducted.ok) {
    const lack = pickleFormulaStatus(save, formulaId).inputs
      .filter((r) => r.have < r.need)
      .map((r) => `${r.name}×${r.need - r.have}`)
      .join('、');
    return { save, error: `冰箱里还差：${lack || '鲜菜原料'}` };
  }
  const effDuration = pickleEffectiveDurationMs(save, formula.durationMs);
  const extraChance = PICKLE_TIER_DEFS[pickleTier(save)].extraYieldChance;
  const roll = mulberry32((now ^ 0x51C1E5) >>> 0)();
  const bonusQty = extraChance > 0 && roll < extraChance ? 1 : 0;
  const nextJars = migratePickleJars(save.pickleJars);
  nextJars[target.index] = {
    formulaId: formula.id,
    startedAt: now,
    readyAt: now + effDuration,
    boosted: false,
    bonusQty,
  };
  return {
    save: {
      ...save,
      fridge: deducted.fridge,
      pickleJars: nextJars,
    },
    slotIndex: target.index,
  };
}

export function boostPickleByAd(
  save: KitchenSave,
  slotIndex: 0 | 1,
  now = Date.now(),
): { save: KitchenSave; error?: string } {
  if (!canUseDailyAd(save, 'pickle_boost', now)) {
    return { save, error: '今日秘方催熟次数已用完，明天再来' };
  }
  const view = pickleSlotView(save, slotIndex, now);
  if (view.status !== 'fermenting' || !view.slot || !view.formula) {
    return { save, error: '这口坛子已经发好啦，直接揭盖吧' };
  }
  const nextJars = migratePickleJars(save.pickleJars);
  nextJars[slotIndex] = {
    ...view.slot,
    readyAt: now,
    boosted: true,
    bonusQty: Math.max(1, (view.slot.bonusQty ?? 0) + 1),
  };
  const marked = markDailyAdUsed({ ...save, pickleJars: nextJars }, 'pickle_boost', now);
  return { save: marked };
}

export function harvestPickle(
  save: KitchenSave,
  slotIndex: 0 | 1,
  now = Date.now(),
): {
  save: KitchenSave;
  error?: string;
  outputDefId?: string;
  outputName?: string;
  qty: number;
  foodFolded: boolean;
  foldGold: number;
  unlockedRecipeId?: RecipeId;
} {
  const empty = { qty: 0, foodFolded: false, foldGold: 0 };
  const view = pickleSlotView(save, slotIndex, now);
  if (view.status !== 'ready' || !view.slot || !view.formula) {
    return { save, error: '老坛还没发透，再等一等吧', ...empty };
  }
  const qty = view.yieldQty;
  const outputDefId = view.formula.outputDefId;
  const outputName = getItem(outputDefId).name;
  const nextJars = migratePickleJars(save.pickleJars);
  nextJars[slotIndex] = null;

  const clearedSave: KitchenSave = { ...save, pickleJars: nextJars };
  const granted = applyNeighborReward(clearedSave, {
    gold: 0,
    food: { defId: outputDefId, qty },
  });
  let nextSave = granted.save;
  let unlockedRecipeId: RecipeId | undefined;
  const sigId = view.formula.unlockRecipeId;
  if (recipeById(sigId) && !isRecipeUnlocked(recipeUnlockView(nextSave), sigId)) {
    nextSave = {
      ...nextSave,
      recipesFound: nextSave.recipesFound.includes(sigId)
        ? nextSave.recipesFound
        : [...nextSave.recipesFound, sigId],
    };
    unlockedRecipeId = sigId;
  }
  return {
    save: nextSave,
    outputDefId,
    outputName,
    qty,
    foodFolded: granted.foodFolded,
    foldGold: granted.foldGold,
    unlockedRecipeId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 菜场流浪小橘猫「阿橘」（Stray Orange Tabby Cat System）
// ═══════════════════════════════════════════════════════════════════════════

export const CAT_UNLOCK_LEVEL = 4;
export const CAT_NAME = '阿橘';

export interface CatGiftFood {
  defId: string;
  qty: number;
}

export interface CatGiftBundle {
  foods: CatGiftFood[];
  gold: number;
  tickets: number;
  deluxe?: boolean;
  note: string;
}

export interface StrayCatState {
  adopted: boolean;
  bondXp: number;
  status: 'idle' | 'away' | 'gift';
  startedAt: number;
  returnAt: number;
  pendingGift?: CatGiftBundle;
}

interface CatBondTier {
  level: number;
  minXp: number;
  title: string;
  outingMinutes: number;
  ticketChance: number;
  goldMin: number;
  goldMax: number;
}

const CAT_BOND_TIERS: readonly CatBondTier[] = [
  { level: 1, minXp: 0, title: '初熟络', outingMinutes: 50, ticketChance: 0.10, goldMin: 8, goldMax: 12 },
  { level: 2, minXp: 3, title: '蹭裤脚', outingMinutes: 45, ticketChance: 0.14, goldMin: 9, goldMax: 13 },
  { level: 3, minXp: 8, title: '翻肚皮', outingMinutes: 40, ticketChance: 0.18, goldMin: 10, goldMax: 15 },
  { level: 4, minXp: 16, title: '巡街王', outingMinutes: 35, ticketChance: 0.22, goldMin: 11, goldMax: 16 },
  { level: 5, minXp: 28, title: '镇店喵', outingMinutes: 30, ticketChance: 0.26, goldMin: 12, goldMax: 18 },
];

export function defaultStrayCat(): StrayCatState {
  return {
    adopted: false,
    bondXp: 0,
    status: 'idle',
    startedAt: 0,
    returnAt: 0,
    pendingGift: undefined,
  };
}

function migrateCatGift(raw: unknown): CatGiftBundle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Partial<CatGiftBundle>;
  const foods: CatGiftFood[] = [];
  if (Array.isArray(rec.foods)) {
    for (const row of rec.foods) {
      if (!row || typeof row !== 'object') continue;
      const f = row as { defId?: unknown; qty?: unknown };
      if (typeof f.defId !== 'string' || !ITEMS.some((it) => it.id === f.defId)) continue;
      const qty = typeof f.qty === 'number' && Number.isFinite(f.qty) ? Math.max(1, Math.floor(f.qty)) : 1;
      foods.push({ defId: f.defId, qty });
    }
  }
  const gold = typeof rec.gold === 'number' && Number.isFinite(rec.gold) ? Math.max(0, Math.floor(rec.gold)) : 0;
  const tickets = typeof rec.tickets === 'number' && Number.isFinite(rec.tickets)
    ? Math.max(0, Math.floor(rec.tickets))
    : 0;
  if (!foods.length && gold <= 0 && tickets <= 0) return undefined;
  return {
    foods,
    gold,
    tickets,
    deluxe: rec.deluxe === true,
    note: typeof rec.note === 'string' && rec.note ? rec.note : '阿橘从菜场角落叼回来的谢礼。',
  };
}

export function migrateStrayCat(raw: unknown): StrayCatState {
  const base = defaultStrayCat();
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Partial<StrayCatState>;
  const status = rec.status === 'away' || rec.status === 'gift' ? rec.status : 'idle';
  const pendingGift = migrateCatGift(rec.pendingGift);
  const safeStatus = (status === 'away' || status === 'gift') && !pendingGift ? 'idle' : status;
  return {
    adopted: rec.adopted === true,
    bondXp: typeof rec.bondXp === 'number' && Number.isFinite(rec.bondXp) ? Math.max(0, Math.floor(rec.bondXp)) : 0,
    status: safeStatus,
    startedAt: typeof rec.startedAt === 'number' && Number.isFinite(rec.startedAt)
      ? Math.max(0, Math.floor(rec.startedAt))
      : 0,
    returnAt: typeof rec.returnAt === 'number' && Number.isFinite(rec.returnAt)
      ? Math.max(0, Math.floor(rec.returnAt))
      : 0,
    pendingGift: safeStatus === 'idle' ? undefined : pendingGift,
  };
}

export function catUnlocked(save: Pick<KitchenSave, 'level'> & { strayCat?: { adopted?: boolean } }): boolean {
  return cookLevel(save as KitchenSave) >= CAT_UNLOCK_LEVEL || !!save.strayCat?.adopted;
}

export interface CatBondView {
  level: number;
  title: string;
  xp: number;
  curFloor: number;
  nextCeil: number | null;
  fill: number;
  outingMinutes: number;
  ticketChance: number;
  goldMin: number;
  goldMax: number;
}

export function catBondView(bondXp: number): CatBondView {
  const xp = Math.max(0, Math.floor(bondXp || 0));
  let cur = CAT_BOND_TIERS[0];
  let next: CatBondTier | undefined;
  for (let i = 0; i < CAT_BOND_TIERS.length; i++) {
    if (xp >= CAT_BOND_TIERS[i].minXp) {
      cur = CAT_BOND_TIERS[i];
      next = CAT_BOND_TIERS[i + 1];
    }
  }
  const curFloor = cur.minXp;
  const nextCeil = next ? next.minXp : null;
  const fill = nextCeil !== null && nextCeil > curFloor
    ? Math.min(1, Math.max(0, (xp - curFloor) / (nextCeil - curFloor)))
    : 1;
  return {
    level: cur.level,
    title: cur.title,
    xp,
    curFloor,
    nextCeil,
    fill,
    outingMinutes: cur.outingMinutes,
    ticketChance: cur.ticketChance,
    goldMin: cur.goldMin,
    goldMax: cur.goldMax,
  };
}

export interface CatStateView {
  unlocked: boolean;
  adopted: boolean;
  effectiveStatus: 'locked' | 'unadopted' | 'idle' | 'away' | 'gift';
  remainMs: number;
  progress: number;
  bond: CatBondView;
  pendingGift?: CatGiftBundle;
  moodLine: string;
}

export function catStateView(save: KitchenSave, now = Date.now()): CatStateView {
  const cat = migrateStrayCat(save.strayCat);
  const bond = catBondView(cat.bondXp);
  if (!catUnlocked(save)) {
    return {
      unlocked: false,
      adopted: false,
      effectiveStatus: 'locked',
      remainMs: 0,
      progress: 0,
      bond,
      moodLine: `厨艺升到 ${CAT_UNLOCK_LEVEL} 级，菜场那只小橘猫就会顺着饭香找上门。`,
    };
  }
  if (!cat.adopted) {
    return {
      unlocked: true,
      adopted: false,
      effectiveStatus: 'unadopted',
      remainMs: 0,
      progress: 0,
      bond,
      moodLine: '门口蹲着一只圆滚滚的流浪小橘猫，正眼巴巴闻你家的灶台香呢。',
    };
  }
  if (cat.status === 'gift' || (cat.status === 'away' && now >= cat.returnAt)) {
    return {
      unlocked: true,
      adopted: true,
      effectiveStatus: 'gift',
      remainMs: 0,
      progress: 1,
      bond,
      pendingGift: cat.pendingGift,
      moodLine: cat.pendingGift?.note ?? '阿橘端端正正按着一只红格小包袱，等你夸它能干！',
    };
  }
  if (cat.status === 'away') {
    const remainMs = Math.max(0, cat.returnAt - now);
    const total = Math.max(1, cat.returnAt - cat.startedAt || bond.outingMinutes * 60 * 1000);
    const progress = Math.min(1, Math.max(0, 1 - remainMs / total));
    return {
      unlocked: true,
      adopted: true,
      effectiveStatus: 'away',
      remainMs,
      progress,
      bond,
      pendingGift: cat.pendingGift,
      moodLine: '草垫上留着两枚梅花脚印和一片青菜叶——阿橘去后巷帮你寻摸好货啦。',
    };
  }
  const idleLines = [
    '阿橘揣着小手窝在草垫上呼噜噜，尾巴尖一晃一晃地看着冰箱。',
    '喂条小杂鱼或两把余菜，阿橘吃饱就会去菜场后巷给你叼谢礼回来！',
    '阿橘把下巴搁在青瓷碗边，喵呜一声提醒你今天还没投喂呢。',
  ];
  const lineIdx = Math.abs(cat.bondXp) % idleLines.length;
  return {
    unlocked: true,
    adopted: true,
    effectiveStatus: 'idle',
    remainMs: 0,
    progress: 0,
    bond,
    moodLine: idleLines[lineIdx],
  };
}

export interface CatFeedOption {
  defId: string;
  name: string;
  have: number;
  need: number;
  canFeed: boolean;
  fav: boolean;
  bondGain: number;
}

export function isCatFavoriteFood(defId: string): boolean {
  const def = getItem(defId);
  return def.stalls.includes('fish') || def.stalls.includes('meat');
}

export function catFeedNeedQty(defId: string): number {
  if (isCatFavoriteFood(defId)) return 1;
  return itemArea(defId) >= 4 ? 1 : 2;
}

export function catFeedOptions(save: KitchenSave): CatFeedOption[] {
  const counts = new Map<string, number>();
  for (const it of save.fridge) {
    if (it.kind === 'dish' || it.quality === 'rotten') continue;
    if (it.defId === GOD_PICK.id || PICKLE_ITEM_IDS.has(it.defId)) continue;
    const qty = Math.max(0, Math.floor(Number(it.qty ?? 1)));
    if (qty <= 0) continue;
    counts.set(it.defId, (counts.get(it.defId) ?? 0) + qty);
  }
  const out: CatFeedOption[] = [];
  for (const [defId, have] of counts) {
    const fav = isCatFavoriteFood(defId);
    const need = catFeedNeedQty(defId);
    out.push({
      defId,
      name: getItem(defId).name,
      have,
      need,
      canFeed: have >= need,
      fav,
      bondGain: fav ? 2 : 1,
    });
  }
  return out.sort((a, b) => {
    if (a.canFeed !== b.canFeed) return a.canFeed ? -1 : 1;
    if (a.fav !== b.fav) return a.fav ? -1 : 1;
    return b.have - a.have || a.defId.localeCompare(b.defId);
  });
}

export type CatBedTier = 0 | 1 | 2;

export interface CatBedTierDef {
  tier: CatBedTier;
  name: string;
  cost: number;
  cookNeed: number;
  durationMul: number;
  epicWeightMul: number;
  ticketBonus: number;
  desc: string;
}

export const CAT_BED_TIER_DEFS: readonly CatBedTierDef[] = [
  { tier: 0, name: '蒲草软垫', cost: 0, cookNeed: 2, durationMul: 1, epicWeightMul: 1, ticketBonus: 0, desc: '暖烘烘的蒲草圆垫' },
  { tier: 1, name: '柿红碎花棉窝', cost: 520, cookNeed: 7, durationMul: 0.92, epicWeightMul: 1.3, ticketBonus: 0.04, desc: '巡街耗时 -8% · 上品好货率提升' },
  { tier: 2, name: '花梨雕花猫榻', cost: 2200, cookNeed: 13, durationMul: 0.84, epicWeightMul: 1.65, ticketBonus: 0.08, desc: '巡街耗时 -16% · 上品与菜谱券率大幅提升' },
];

export function catBedTier(save: Pick<KitchenSave, 'catBedTier'>): CatBedTier {
  return save.catBedTier === 2 ? 2 : save.catBedTier === 1 ? 1 : 0;
}

export function catEffectiveOutingMinutes(
  save: Pick<KitchenSave, 'catBedTier' | 'dexStampsClaimed'>,
  baseMinutes: number,
): number {
  const bedDef = CAT_BED_TIER_DEFS[catBedTier(save)];
  const stampMul = dexActiveBonuses(save).catDurationMul;
  return Math.max(5, Math.round(baseMinutes * bedDef.durationMul * stampMul));
}

export function catBedUpgradeState(save: KitchenSave): PropUpgradeState {
  const cur = catBedTier(save);
  if (cur >= 2) return { status: 'max', curName: CAT_BED_TIER_DEFS[2].name };
  const next = CAT_BED_TIER_DEFS[(cur + 1) as CatBedTier];
  if (cookLevel(save) < next.cookNeed) {
    return {
      status: 'blocked',
      cost: next.cost,
      nextName: next.name,
      nextDesc: next.desc,
      cookNeed: next.cookNeed,
      error: `厨艺 ${next.cookNeed} 级解锁「${next.name}」`,
    };
  }
  if (save.money < next.cost) {
    return {
      status: 'blocked',
      cost: next.cost,
      nextName: next.name,
      nextDesc: next.desc,
      cookNeed: next.cookNeed,
      error: `差 ${next.cost - save.money} 金币`,
    };
  }
  return {
    status: 'ready',
    cost: next.cost,
    nextName: next.name,
    nextDesc: next.desc,
    cookNeed: next.cookNeed,
  };
}

export function buyCatBedTierUpgrade(save: KitchenSave): { save: KitchenSave; nextName?: string; error?: string } {
  const st = catBedUpgradeState(save);
  if (st.status === 'max') return { save, error: '阿橘的小窝已经是最高品阶啦' };
  if (st.status === 'blocked') return { save, error: st.error };
  const nextTier = (catBedTier(save) + 1) as CatBedTier;
  return {
    save: {
      ...save,
      money: save.money - st.cost,
      catBedTier: nextTier,
    },
    nextName: st.nextName,
  };
}

export function adoptStrayCat(save: KitchenSave): { save: KitchenSave; error?: string } {
  if (!catUnlocked(save)) {
    return { save, error: `厨艺 ${CAT_UNLOCK_LEVEL} 级才能收留小橘猫` };
  }
  const cur = migrateStrayCat(save.strayCat);
  if (cur.adopted) return { save };
  return {
    save: {
      ...save,
      strayCat: { ...cur, adopted: true, status: 'idle' },
    },
  };
}

function catGiftPool(save: KitchenSave, deluxe: boolean): Array<[string, number]> {
  const lv = cookLevel(save);
  const bedDef = CAT_BED_TIER_DEFS[catBedTier(save)];
  const seen = new Set([...save.dexSeen, ...save.dexInspected]);
  // Collect foods from unlocked markets + the very next locked market for delightful surprise!
  const sortedMarkets = [...MARKETS].sort((a, b) => a.unlockLevel - b.unlockLevel);
  const allowedMarkets = sortedMarkets.filter((m) => m.unlockLevel <= lv);
  const nextLocked = sortedMarkets.find((m) => m.unlockLevel > lv);
  if (nextLocked) allowedMarkets.push(nextLocked);

  const ids = new Set<string>();
  for (const m of allowedMarkets) {
    for (const id of marketFoodIds(m.id)) {
      if (id !== GOD_PICK.id && !PICKLE_ITEM_IDS.has(id)) ids.add(id);
    }
  }
  if (lv >= 6) ids.add('chicken_wing');

  const weighted: Array<[string, number]> = [];
  for (const id of ids) {
    const def = getItem(id);
    const r = rarityRank(def.rarity);
    if (deluxe && r === 0) continue; // Deluxe fish can guarantees rare/epic/legendary foods!
    let w = r === 0 ? 1.5 : r === 1 ? 6 : r === 2 ? 4 * bedDef.epicWeightMul : 1.5 * bedDef.epicWeightMul;
    if (!seen.has(id)) w *= 1.8;
    weighted.push([id, w]);
  }
  if (!weighted.length) {
    return [
      ['mushroom', 5],
      ['shrimp', 3],
      ['egg', 2],
    ];
  }
  return weighted;
}

function rollCatGiftBundle(
  save: KitchenSave,
  bond: CatBondView,
  rng: Rng,
  opts: { favFood?: boolean; deluxe?: boolean },
): CatGiftBundle {
  const bedDef = CAT_BED_TIER_DEFS[catBedTier(save)];
  const pool = catGiftPool(save, !!opts.deluxe);
  const picksCount = opts.deluxe ? 3 : 2;
  const foodMap = new Map<string, number>();
  for (let i = 0; i < picksCount; i++) {
    const picked = rngWeighted(rng, pool);
    foodMap.set(picked, (foodMap.get(picked) ?? 0) + 1);
  }
  const foods: CatGiftFood[] = [...foodMap.entries()].map(([defId, qty]) => ({ defId, qty }));
  const goldLo = opts.deluxe ? 14 : bond.goldMin + (opts.favFood ? 2 : 0);
  const goldHi = opts.deluxe ? 22 : bond.goldMax + (opts.favFood ? 3 : 0);
  const gold = goldLo + Math.floor(rng() * Math.max(1, goldHi - goldLo + 1));
  const ticketRate = (opts.deluxe ? Math.max(0.35, bond.ticketChance + 0.12) : bond.ticketChance + (opts.favFood ? 0.04 : 0)) + bedDef.ticketBonus;
  const tickets = rng() < ticketRate ? 1 : 0;
  const notes = opts.deluxe
    ? [
      '阿橘舔干净鲜鱼罐头，精神抖擞地从菜行后巷叼回了豪华大包袱！',
      '阿橘吃美了，连隔壁摊主私藏的好货都给你讨了回来！',
    ]
    : [
      '阿橘钻进收摊后的菜筐底，替你扒拉出一包水灵好货！',
      '鱼摊老板见阿橘乖巧，顺手往它小包袱里塞了份谢礼。',
      '阿橘踩着夕阳跑回屋，骄傲地把红格包袱推到你脚边！',
    ];
  return {
    foods,
    gold,
    tickets,
    deluxe: opts.deluxe,
    note: rngPick(rng, notes),
  };
}

export function feedCatFromFridge(
  save: KitchenSave,
  defId: string,
  now = Date.now(),
): { save: KitchenSave; error?: string; bondGain?: number; outingMinutes?: number } {
  if (!catUnlocked(save)) {
    return { save, error: `厨艺 ${CAT_UNLOCK_LEVEL} 级开启阿橘小窝` };
  }
  const view = catStateView(save, now);
  if (view.effectiveStatus === 'away') {
    return { save, error: '阿橘正在菜场巡街呢，摇个罐头能立刻唤回它' };
  }
  if (view.effectiveStatus === 'gift') {
    return { save, error: '先帮阿橘拆开脚边的小包袱吧' };
  }
  if (!ITEMS.some((it) => it.id === defId) || defId === GOD_PICK.id || PICKLE_ITEM_IDS.has(defId)) {
    return { save, error: '阿橘闻了闻，这味留着自家做菜吧' };
  }
  const need = catFeedNeedQty(defId);
  const deducted = deductFridgeFoods(save.fridge, [{ defId, qty: need }]);
  if (!deducted.ok) {
    return { save, error: `需要 ${getItem(defId).name}×${need} 才够喂饱阿橘` };
  }
  const fav = isCatFavoriteFood(defId);
  const bondGain = fav ? 2 : 1;
  const curCat = migrateStrayCat(save.strayCat);
  const nextBondXp = curCat.bondXp + bondGain;
  const nextBond = catBondView(nextBondXp);
  const effMinutes = catEffectiveOutingMinutes(save, nextBond.outingMinutes);
  const durationMs = effMinutes * 60 * 1000;
  const rng = mulberry32((now ^ (nextBondXp * 0x9E3779B1)) >>> 0);
  const gift = rollCatGiftBundle(save, nextBond, rng, { favFood: fav, deluxe: false });

  return {
    save: {
      ...save,
      fridge: deducted.fridge,
      strayCat: {
        adopted: true,
        bondXp: nextBondXp,
        status: 'away',
        startedAt: now,
        returnAt: now + durationMs,
        pendingGift: gift,
      },
    },
    bondGain,
    outingMinutes: effMinutes,
  };
}

export function useCatCanByAd(
  save: KitchenSave,
  now = Date.now(),
): { save: KitchenSave; mode?: 'deluxe_instant' | 'instant_recall'; error?: string } {
  if (!catUnlocked(save)) {
    return { save, error: `厨艺 ${CAT_UNLOCK_LEVEL} 级开启阿橘小窝` };
  }
  if (!canUseDailyAd(save, 'cat_treat', now)) {
    return { save, error: '今天的鲜鱼罐头喂完啦，明天再来宠它' };
  }
  const view = catStateView(save, now);
  if (view.effectiveStatus === 'gift') {
    return { save, error: '阿橘已经叼着包袱在等你啦，先拆包袱吧' };
  }
  const curCat = migrateStrayCat(save.strayCat);
  const rng = mulberry32((now ^ 0xCA7CA7) >>> 0);

  if (view.effectiveStatus === 'away' && curCat.pendingGift) {
    const nextBondXp = curCat.bondXp + 1;
    const pool = catGiftPool(save, true);
    const bonusDefId = rngWeighted(rng, pool);
    const mergedFoods = curCat.pendingGift.foods.map((f) => ({ ...f }));
    const hit = mergedFoods.find((f) => f.defId === bonusDefId);
    if (hit) hit.qty += 1;
    else mergedFoods.push({ defId: bonusDefId, qty: 1 });

    const upgradedGift: CatGiftBundle = {
      foods: mergedFoods,
      gold: curCat.pendingGift.gold + 6,
      tickets: curCat.pendingGift.tickets,
      deluxe: true,
      note: '听见鲜鱼罐头咔哒一声，阿橘多顺了一件好货飞奔回屋！',
    };
    const marked = markDailyAdUsed({
      ...save,
      strayCat: {
        adopted: true,
        bondXp: nextBondXp,
        status: 'gift',
        startedAt: curCat.startedAt,
        returnAt: now,
        pendingGift: upgradedGift,
      },
    }, 'cat_treat', now);
    return { save: marked, mode: 'instant_recall' };
  }

  // Unadopted or idle -> 0 fridge cost, +2 bond XP, instant deluxe gift ready to unwrap!
  const nextBondXp = curCat.bondXp + 2;
  const nextBond = catBondView(nextBondXp);
  const deluxeGift = rollCatGiftBundle(save, nextBond, rng, { favFood: true, deluxe: true });
  const marked = markDailyAdUsed({
    ...save,
    strayCat: {
      adopted: true,
      bondXp: nextBondXp,
      status: 'gift',
      startedAt: now,
      returnAt: now,
      pendingGift: deluxeGift,
    },
  }, 'cat_treat', now);
  return { save: marked, mode: 'deluxe_instant' };
}

export function claimCatGift(
  save: KitchenSave,
  now = Date.now(),
): {
  save: KitchenSave;
  error?: string;
  foods: Array<{ defId: string; name: string; qty: number; folded: boolean }>;
  foldGold: number;
  gold: number;
  totalGold: number;
  tickets: number;
  deluxe: boolean;
} {
  const empty = { foods: [], foldGold: 0, gold: 0, totalGold: 0, tickets: 0, deluxe: false };
  const view = catStateView(save, now);
  if (view.effectiveStatus !== 'gift' || !view.pendingGift) {
    return { save, error: '阿橘脚边还没有可拆的小包袱', ...empty };
  }
  const gift = view.pendingGift;
  const curCat = migrateStrayCat(save.strayCat);
  let nextSave: KitchenSave = {
    ...save,
    money: save.money + gift.gold,
    recipeTickets: save.recipeTickets + gift.tickets,
    strayCat: {
      adopted: true,
      bondXp: curCat.bondXp,
      status: 'idle',
      startedAt: 0,
      returnAt: 0,
      pendingGift: undefined,
    },
  };
  const foodsOut: Array<{ defId: string; name: string; qty: number; folded: boolean }> = [];
  let foldGold = 0;
  for (const f of gift.foods) {
    const granted = applyNeighborReward(nextSave, {
      gold: 0,
      food: { defId: f.defId, qty: f.qty },
    });
    nextSave = granted.save;
    foldGold += granted.foldGold;
    foodsOut.push({
      defId: f.defId,
      name: getItem(f.defId).name,
      qty: f.qty,
      folded: granted.foodFolded,
    });
  }
  return {
    save: nextSave,
    foods: foodsOut,
    foldGold,
    gold: gift.gold,
    totalGold: gift.gold + foldGold,
    tickets: gift.tickets,
    deluxe: !!gift.deluxe,
  };
}
