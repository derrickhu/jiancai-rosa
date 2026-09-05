import { recipeById, RECIPES, type RecipeId } from './recipes';
import type { StallId } from './items';

/** 吃一口的效果。挂在菜上；前期共用基础招，新类型按解锁往后开。 */
export type DishEffectId =
  | 'stamina_1'
  | 'stamina_2'
  | 'steps_1'
  | 'steps_2'
  | 'luck_rare'
  | 'luck_epic'
  | 'fee_half'
  | 'fee_free'
  | 'bag_dry_1'
  | 'bag_wet_1'
  | 'bag_dry_row'
  | 'bag_wet_row'
  | 'stall_leaf'
  | 'stall_fish'
  | 'stall_meat'
  | 'sell_up'
  | 'cook_xp'
  | 'order_soon';

export type DishTiming = 'instant' | 'kitchen' | 'outing';

export interface DishEffectDef {
  id: DishEffectId;
  timing: DishTiming;
  /** 详情卡：吃：…… */
  eatLabel: string;
  /** 选点页 / HUD 一行 */
  outingLine?: string;
  kitchenLine?: string;
}

export interface OutingBuff {
  kind: DishEffectId;
  recipeId: RecipeId;
}

export interface KitchenBuff {
  kind: DishEffectId;
  recipeId: RecipeId;
  until: number;
}

export interface OutingRunMods {
  extraSteps: number;
  luckRare: number;
  luckEpic: number;
  feeMul: number;
  stallBias?: StallId;
  extraDryCells: number;
  extraWetCells: number;
  extraDryRows: number;
  extraWetRows: number;
}

export const SELL_UP_MS = 30 * 60 * 1000;
export const SELL_UP_MUL = 1.5;
export const COOK_XP_MUL = 1.5;

export const DISH_EFFECTS: Record<DishEffectId, DishEffectDef> = {
  stamina_1: { id: 'stamina_1', timing: 'instant', eatLabel: '吃：垫一口，体力 +1' },
  stamina_2: { id: 'stamina_2', timing: 'instant', eatLabel: '吃：垫两口，体力 +2' },
  steps_1: {
    id: 'steps_1',
    timing: 'outing',
    eatLabel: '吃：下一趟天色 +1',
    outingLine: '这趟天色 +1',
  },
  steps_2: {
    id: 'steps_2',
    timing: 'outing',
    eatLabel: '吃：下一趟天色 +2',
    outingLine: '这趟天色 +2',
  },
  luck_rare: {
    id: 'luck_rare',
    timing: 'outing',
    eatLabel: '吃：下一趟良品更肯露头',
    outingLine: '这趟良品更肯露头',
  },
  luck_epic: {
    id: 'luck_epic',
    timing: 'outing',
    eatLabel: '吃：下一趟上品更肯露头',
    outingLine: '这趟上品更肯露头',
  },
  fee_half: {
    id: 'fee_half',
    timing: 'outing',
    eatLabel: '吃：下一趟进场费减半',
    outingLine: '这趟进场费减半',
  },
  fee_free: {
    id: 'fee_free',
    timing: 'outing',
    eatLabel: '吃：下一趟进场不收钱',
    outingLine: '这趟进场不收钱',
  },
  bag_dry_1: {
    id: 'bag_dry_1',
    timing: 'outing',
    eatLabel: '吃：下一趟干区多塞 1 格',
    outingLine: '这趟干区多 1 格',
  },
  bag_wet_1: {
    id: 'bag_wet_1',
    timing: 'outing',
    eatLabel: '吃：下一趟湿区多塞 1 格',
    outingLine: '这趟湿区多 1 格',
  },
  bag_dry_row: {
    id: 'bag_dry_row',
    timing: 'outing',
    eatLabel: '吃：下一趟干区多 1 行',
    outingLine: '这趟干区多 1 行',
  },
  bag_wet_row: {
    id: 'bag_wet_row',
    timing: 'outing',
    eatLabel: '吃：下一趟湿区多 1 行',
    outingLine: '这趟湿区多 1 行',
  },
  stall_leaf: {
    id: 'stall_leaf',
    timing: 'outing',
    eatLabel: '吃：下一趟叶子摊更密',
    outingLine: '这趟叶子摊更密',
  },
  stall_fish: {
    id: 'stall_fish',
    timing: 'outing',
    eatLabel: '吃：下一趟鱼摊更密',
    outingLine: '这趟鱼摊更密',
  },
  stall_meat: {
    id: 'stall_meat',
    timing: 'outing',
    eatLabel: '吃：下一趟肉摊更密',
    outingLine: '这趟肉摊更密',
  },
  sell_up: {
    id: 'sell_up',
    timing: 'kitchen',
    eatLabel: '吃：半小时内售价 ×1.5',
    kitchenLine: '售价 ×1.5',
  },
  cook_xp: {
    id: 'cook_xp',
    timing: 'kitchen',
    eatLabel: '吃：下一锅厨艺经验 ×1.5',
    kitchenLine: '下一锅经验 ×1.5',
  },
  order_soon: { id: 'order_soon', timing: 'instant', eatLabel: '吃：街坊马上再来点菜' },
};

/**
 * 新类型按解锁往后滴，不要开局就把目录用光。
 *   巷口 / 烹饪台前四级：只有体力+1、天色+1、干区+1 格
 *   河沿：第一次湿区+1 格
 *   厨艺 4 / 烹饪台 5–6：叶子摊、练锅、良品运、限时售价
 *   厨艺 8 / 山坞：天色+2、进场半价、召街坊
 *   江边 / 南门：偏鱼摊、体力+2、偏肉摊
 *   上品台 / 老城：湿/干整行
 *   渡口 / 山珍 / 厨艺 13+：上品运、进场免费
 */
export const RECIPE_EAT: Record<RecipeId, DishEffectId> = {
  // 开局三道：三种基础里选今晚要哪样
  stirfry: 'stamina_1',
  tomato_egg: 'steps_1',
  scallion_tofu: 'bag_dry_1',

  // 烹饪台前四级 + 巷口油纸 + 厨艺 2：还在三种基础里打转
  vinegar_potato: 'stamina_1',
  three_fresh: 'bag_dry_1',
  lettuce_salad: 'steps_1',
  candied_taro: 'stamina_1',
  mushroom_bokchoy: 'bag_dry_1',
  broccoli_garlic: 'bag_dry_1',

  // 河沿：第一次湿格
  tomato_fish: 'bag_wet_1',
  melon_kelp: 'steps_1',

  // 桥头：湿格 / 还是垫一口
  chive_shrimp: 'bag_wet_1',
  stir_liver: 'stamina_1',

  // 厨艺 4：第一次偏摊
  perilla_cucumber: 'stall_leaf',

  // 烹饪台 5–6：第一次厨房槽、第一次幸运
  harvard_veg_soup: 'cook_xp',
  oyster_egg: 'luck_rare',

  // 厨艺 6：第一次限时售价
  clam_soup: 'sell_up',

  // 厨艺 8：第一次天色 +2
  crucian_tofu: 'steps_2',

  // 山坞：召街坊、进场半价
  yam_chestnut: 'order_soon',
  chestnut_duck: 'fee_half',

  // 江边：幸运、偏鱼摊
  mixed_fish_pot: 'luck_rare',
  pan_hairtail: 'stall_fish',

  // 厨艺 10–11：体力 +2、半价荤
  potato_chicken: 'stamina_2',
  yuxiang_pork: 'fee_half',

  // 南门
  dried_tofu_pork: 'stall_meat',
  spinach_ham: 'steps_2',

  // 烹饪台上品：第一次整行湿区
  lotus_shrimp_box: 'bag_wet_row',
  celery_beef: 'fee_half',
  tremella_lily_soup: 'steps_2',

  // 厨艺 12 / 老城
  radish_ribs: 'cook_xp',
  cabbage_belly: 'sell_up',
  braised_beef: 'bag_dry_row',

  // 厨艺 13 / 渡口：上品运
  steam_yellowfish: 'luck_epic',
  garlic_shrimp: 'bag_wet_row',
  braised_eel: 'luck_epic',

  // 厨艺 14–15 / 山珍：进场免费
  matsutake_chicken: 'fee_free',
  melon_cup: 'bag_wet_row',
  ginger_crab: 'luck_epic',
  yandu_xian: 'steps_2',
  maoxuewang: 'stall_meat',

  // 隐藏：按稀有度对齐，不比同期可见菜更肥
  smashed_cucumber: 'bag_dry_1',
  garlic_bokchoy: 'stamina_1',
  vinegar_cabbage: 'stamina_1',
  stir_beans: 'bag_dry_1',
  blistered_pepper: 'bag_dry_1',
  spinach_egg_soup: 'steps_1',
  qianlong_cabbage: 'steps_1',
  celery_dried_tofu: 'cook_xp',
  ants_tree: 'cook_xp',
  onion_wood_ear: 'bag_dry_1',
  lotus_pepper: 'bag_dry_1',
  carrot_mushroom: 'luck_rare',
  yuxiang_eggplant: 'sell_up',
  wood_ear_egg: 'stamina_2',
  pepper_pork: 'fee_half',
  bamboo_pork: 'fee_half',
  ham_melon_soup: 'steps_2',
  wild_fish_soup: 'luck_epic',
};

{
  const missing = RECIPES.filter((r) => !RECIPE_EAT[r.id]).map((r) => r.id);
  if (missing.length) throw new Error(`菜谱缺少吃法：${missing.join('，')}`);
}

export function recipeEatEffect(id: RecipeId): DishEffectId {
  return RECIPE_EAT[id] ?? 'stamina_1';
}

export function recipeEatDef(id: RecipeId): DishEffectDef {
  return DISH_EFFECTS[recipeEatEffect(id)];
}

export function recipeEatLabel(id: RecipeId): string {
  return recipeEatDef(id).eatLabel;
}

export function recipeEatStaminaGain(id: RecipeId): number {
  const effect = recipeEatEffect(id);
  if (effect === 'stamina_1') return 1;
  if (effect === 'stamina_2') return 2;
  return 0;
}

export function dishEffectDef(id: DishEffectId): DishEffectDef {
  return DISH_EFFECTS[id];
}

export interface EatSaveSlice {
  stamina: number;
  staminaAt: number;
  outingBuff?: OutingBuff;
  kitchenBuff?: KitchenBuff;
  neighborOfferAt: number;
}

export function liveOutingBuff<T extends { outingBuff?: OutingBuff }>(save: T): OutingBuff | undefined {
  const buff = save.outingBuff;
  if (!buff) return undefined;
  if (dishEffectDef(buff.kind).timing !== 'outing') return undefined;
  return buff;
}

export function liveKitchenBuff<T extends { kitchenBuff?: KitchenBuff }>(
  save: T,
  now = Date.now(),
): KitchenBuff | undefined {
  const buff = save.kitchenBuff;
  if (!buff) return undefined;
  if (dishEffectDef(buff.kind).timing !== 'kitchen') return undefined;
  if (buff.kind !== 'cook_xp' && buff.until > 0 && buff.until <= now) return undefined;
  return buff;
}

export function outingBuffLine<T extends { outingBuff?: OutingBuff }>(save: T): string | null {
  const buff = liveOutingBuff(save);
  if (!buff) return null;
  const line = dishEffectDef(buff.kind).outingLine;
  const name = recipeById(buff.recipeId)?.name;
  if (!line) return null;
  return name ? `${line}（${name}）` : line;
}

export function kitchenBuffLine<T extends { kitchenBuff?: KitchenBuff }>(save: T, now = Date.now()): string | null {
  const buff = liveKitchenBuff(save, now);
  if (!buff) return null;
  const line = dishEffectDef(buff.kind).kitchenLine;
  const name = recipeById(buff.recipeId)?.name;
  if (!line) return null;
  if (buff.kind === 'sell_up' && buff.until > now) {
    const min = Math.max(1, Math.ceil((buff.until - now) / 60000));
    return name ? `${line} · 还剩 ${min} 分钟（${name}）` : `${line} · 还剩 ${min} 分钟`;
  }
  return name ? `${line}（${name}）` : line;
}

export function kitchenSellMul<T extends { kitchenBuff?: KitchenBuff }>(save: T, now = Date.now()): number {
  const buff = liveKitchenBuff(save, now);
  return buff?.kind === 'sell_up' ? SELL_UP_MUL : 1;
}

export function kitchenCookXpMul<T extends { kitchenBuff?: KitchenBuff }>(save: T, now = Date.now()): number {
  const buff = liveKitchenBuff(save, now);
  return buff?.kind === 'cook_xp' ? COOK_XP_MUL : 1;
}

export function consumeCookXpBuff<T extends { kitchenBuff?: KitchenBuff }>(save: T, now = Date.now()): T {
  const buff = liveKitchenBuff(save, now);
  if (buff?.kind !== 'cook_xp') return save;
  const next = { ...save };
  delete next.kitchenBuff;
  return next;
}

export function clearOutingBuff<T extends { outingBuff?: OutingBuff }>(save: T): T {
  if (!save.outingBuff) return save;
  const next = { ...save };
  delete next.outingBuff;
  return next;
}

export function outingRunMods<T extends { outingBuff?: OutingBuff }>(save: T): OutingRunMods {
  const kind = liveOutingBuff(save)?.kind;
  return {
    extraSteps: kind === 'steps_2' ? 2 : kind === 'steps_1' ? 1 : 0,
    luckRare: kind === 'luck_rare' ? 0.08 : kind === 'luck_epic' ? 0.03 : 0,
    luckEpic: kind === 'luck_epic' ? 0.05 : 0,
    feeMul: kind === 'fee_free' ? 0 : kind === 'fee_half' ? 0.5 : 1,
    stallBias: kind === 'stall_leaf' ? 'leaf' : kind === 'stall_fish' ? 'fish' : kind === 'stall_meat' ? 'meat' : undefined,
    extraDryCells: kind === 'bag_dry_1' ? 1 : 0,
    extraWetCells: kind === 'bag_wet_1' ? 1 : 0,
    extraDryRows: kind === 'bag_dry_row' ? 1 : 0,
    extraWetRows: kind === 'bag_wet_row' ? 1 : 0,
  };
}

export function migrateOutingBuff(raw: unknown): OutingBuff | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as { kind?: unknown; recipeId?: unknown };
  if (typeof rec.kind !== 'string' || !(rec.kind in DISH_EFFECTS)) return undefined;
  if (typeof rec.recipeId !== 'string') return undefined;
  if (!RECIPES.some((r) => r.id === rec.recipeId)) return undefined;
  if (DISH_EFFECTS[rec.kind as DishEffectId].timing !== 'outing') return undefined;
  return { kind: rec.kind as DishEffectId, recipeId: rec.recipeId as RecipeId };
}

export function migrateKitchenBuff(raw: unknown): KitchenBuff | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as { kind?: unknown; recipeId?: unknown; until?: unknown };
  if (typeof rec.kind !== 'string' || !(rec.kind in DISH_EFFECTS)) return undefined;
  if (typeof rec.recipeId !== 'string') return undefined;
  if (!RECIPES.some((r) => r.id === rec.recipeId)) return undefined;
  if (DISH_EFFECTS[rec.kind as DishEffectId].timing !== 'kitchen') return undefined;
  const until = typeof rec.until === 'number' && Number.isFinite(rec.until) ? rec.until : 0;
  return { kind: rec.kind as DishEffectId, recipeId: rec.recipeId as RecipeId, until };
}

export function applyEatEffects<T extends EatSaveSlice>(
  save: T,
  recipeId: RecipeId,
  portions: number,
  cap: number,
  now = Date.now(),
): { save: T; stamina: number; toast: string; nudgeOffer: boolean; error?: string } {
  const recipe = recipeById(recipeId);
  const name = recipe?.name ?? '这道菜';
  const def = recipeEatDef(recipeId);
  const n = Math.max(1, Math.floor(portions));

  if (def.id === 'stamina_1' || def.id === 'stamina_2') {
    const gainEach = recipeEatStaminaGain(recipeId);
    const room = cap - save.stamina;
    if (room <= 0) {
      return { save, stamina: 0, toast: '', nudgeOffer: false, error: '体力满了，换盘有出门用的' };
    }
    const used = Math.min(n, Math.max(1, Math.floor(room / Math.max(1, gainEach))));
    const gained = used * gainEach;
    const stamina = Math.min(cap, save.stamina + gained);
    return {
      save: {
        ...save,
        stamina,
        staminaAt: stamina >= cap ? now : save.staminaAt,
      },
      stamina: gained,
      toast: `吃了${name}，体力 +${gained}`,
      nudgeOffer: false,
    };
  }

  if (def.id === 'order_soon') {
    return {
      save: { ...save, neighborOfferAt: 0 },
      stamina: 0,
      toast: `吃了${name}，街坊马上还来`,
      nudgeOffer: true,
    };
  }

  if (def.timing === 'kitchen') {
    const until = def.id === 'sell_up' ? now + SELL_UP_MS : 0;
    const prev = liveKitchenBuff(save, now);
    const replaced = prev && prev.recipeId !== recipeId;
    return {
      save: { ...save, kitchenBuff: { kind: def.id, recipeId, until } },
      stamina: 0,
      toast: replaced
        ? `改吃${name}，${def.kitchenLine ?? def.eatLabel}`
        : `吃了${name}，${def.kitchenLine ?? def.eatLabel}`,
      nudgeOffer: false,
    };
  }

  const prev = liveOutingBuff(save);
  const replaced = prev && prev.recipeId !== recipeId;
  return {
    save: { ...save, outingBuff: { kind: def.id, recipeId } },
    stamina: 0,
    toast: replaced
      ? `改吃${name}，${def.outingLine ?? def.eatLabel}`
      : `吃了${name}，${def.outingLine ?? def.eatLabel}`,
    nudgeOffer: false,
  };
}
