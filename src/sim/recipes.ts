import type { MarketId } from './destinations';
import { getItem, sellPrice, type Quality } from './items';

export type RecipeId =
  | 'stirfry' | 'tomato_egg' | 'smashed_cucumber' | 'lettuce_salad' | 'garlic_bokchoy'
  | 'vinegar_cabbage' | 'vinegar_potato' | 'pepper_potato' | 'braised_eggplant' | 'tomato_tofu'
  | 'cucumber_egg' | 'corn_egg' | 'tomato_egg_soup' | 'stir_beans' | 'blistered_pepper'
  | 'garlic_pumpkin' | 'onion_potato' | 'pan_smallfish' | 'rape_tofu' | 'radish_tofu'
  | 'garlic_shrimp' | 'chive_egg' | 'onion_egg' | 'spinach_egg_soup' | 'garlic_water_spinach'
  | 'celery_dried_tofu' | 'sprout_chive' | 'mushroom_bokchoy' | 'carrot_mushroom' | 'broccoli_garlic'
  | 'lotus_pepper' | 'home_tofu' | 'yuxiang_eggplant' | 'three_fresh' | 'melon_kelp'
  | 'pan_hairtail' | 'clam_soup' | 'garlic_clam' | 'tomato_fish' | 'shrimp_egg'
  | 'shrimp_tofu' | 'braised_hairtail' | 'pepper_pork' | 'potato_chicken' | 'ginger_crab'
  | 'steam_yellowfish' | 'yellowfish_tofu' | 'crucian_tofu' | 'radish_ribs' | 'cabbage_belly';

export interface RecipeFood {
  uid?: string;
  defId: string;
  quality: Quality;
  inspected: boolean;
  freshness: number;
  kind?: string;
}

export interface RecipeDef {
  id: RecipeId;
  name: string;
  desc: string;
  group: string;
  blurb: string;
  xp: number;
  firstXp: number;
  needs: string[];
  match: (items: RecipeFood[]) => boolean;
  cook: (items: RecipeFood[]) => number;
}

export interface RecipeNeed {
  label: string;
  have: number;
  need: number;
  iconId: string;
}

function isDryVeg(id: string): boolean {
  const it = getItem(id);
  return !!it.vegetable && it.zone === 'dry';
}

function materialSum(items: RecipeFood[]): number {
  return items.reduce((s, it) => s + sellPrice(it.defId, it.quality, it.inspected, it.freshness), 0);
}

function exact(ids: string[]) {
  const key = [...ids].sort().join(',');
  return (items: RecipeFood[]) => items.length === ids.length && items.map((it) => it.defId).sort().join(',') === key;
}

function priced(mult: number, extra?: (items: RecipeFood[], sum: number) => number) {
  return (items: RecipeFood[]) => {
    let sum = Math.round(materialSum(items) * mult);
    return extra ? extra(items, sum) : sum;
  };
}

/** 文档原表是 8–32；0.5 让每盘少给一点，升级不会两三下就满。 */
const RECIPE_XP_SCALE = 0.5;

function scaledRecipeXp(base: number): number {
  return Math.max(3, Math.round(base * RECIPE_XP_SCALE));
}

function dish(
  id: RecipeId,
  name: string,
  group: string,
  blurb: string,
  xp: number,
  needs: string[],
  mult: number,
  extra?: (items: RecipeFood[], sum: number) => number,
): RecipeDef {
  const desc = needs.map((nid) => `${getItem(nid).name} 1`).join(' + ');
  const given = scaledRecipeXp(xp);
  return {
    id,
    name,
    desc,
    group,
    blurb,
    xp: given,
    firstXp: Math.round(given / 2),
    needs,
    match: exact(needs),
    cook: priced(mult, extra),
  };
}

export const RECIPES: RecipeDef[] = [
  {
    id: 'stirfry',
    name: '清炒时蔬',
    desc: '任意 2 个干蔬菜',
    group: '家常',
    blurb: '两把绿叶子进锅，出来就是“今晚吃素”。',
    xp: scaledRecipeXp(8),
    firstXp: Math.round(scaledRecipeXp(8) / 2),
    needs: [],
    match: (items) => items.length === 2 && items.every((it) => isDryVeg(it.defId)),
    cook: priced(1.4, (items, sum) => (items.some((it) => it.defId === 'cilantro') ? Math.round(sum * 1.1) : sum)),
  },
  dish('tomato_egg', '番茄炒蛋', '家常', '中式厨房的起手式。红黄一碰，连外卖都要让路。', 16, ['tomato', 'egg'], 1.8, (items, sum) => (
    items.every((it) => it.freshness >= 2) ? Math.round(sum * 1.2) : sum
  )),
  dish('smashed_cucumber', '拍黄瓜', '凉菜', '不用开火。拍一下，蒜和香菜负责像一盘菜。', 8, ['cucumber', 'garlic', 'cilantro'], 1.5),
  dish('lettuce_salad', '凉拌生菜', '凉菜', '整棵脑袋撕开，比炒更懂它。', 8, ['lettuce', 'garlic'], 1.5),
  dish('garlic_bokchoy', '蒜蓉小白菜', '家常', '蒜末一响，小白菜就肯软下来。', 8, ['bokchoy', 'garlic'], 1.6),
  dish('vinegar_cabbage', '醋溜白菜', '家常', '外帮也能炒，酸一下才像晚饭。', 10, ['cabbage', 'ginger'], 1.6),
  dish('vinegar_potato', '醋溜土豆丝', '家常', '切丝是玩家脑内完成的，锅里只见一块变一盘。', 10, ['potato', 'ginger'], 1.6),
  dish('pepper_potato', '青椒土豆丝', '家常', '两样都常见，合在一起才像过日子。', 12, ['pepper', 'potato'], 1.7),
  dish('braised_eggplant', '红烧茄子', '家常', '吸油的紫家伙，蒜把它按进酱色。', 12, ['eggplant', 'garlic'], 1.7),
  dish('tomato_tofu', '西红柿炒豆腐', '家常', '没鸡蛋也能红，豆腐负责温柔。', 14, ['tomato', 'tofu'], 1.7),
  dish('cucumber_egg', '黄瓜炒鸡蛋', '家常', '清淡到像没做，但比清炒多一个蛋。', 14, ['cucumber', 'egg'], 1.7),
  dish('corn_egg', '玉米炒蛋', '家常', '金钉子碰金蛋，孩子最肯坐下。', 16, ['corn', 'egg'], 1.7),
  dish('tomato_egg_soup', '番茄蛋汤', '汤', '炒腻了就下面，同一对材料第二条活路。', 12, ['tomato', 'egg'], 1.4),
  dish('stir_beans', '素炒豆角', '家常', '一把绿筷子过热锅，比干煸省事。', 10, ['greenbean', 'garlic'], 1.6),
  dish('blistered_pepper', '虎皮青椒', '家常', '皮起泡才算数，蒜是收尾。', 12, ['pepper', 'garlic'], 1.7),
  dish('garlic_pumpkin', '蒜蓉南瓜', '家常', '甜的，蒜压一压才不像点心。', 10, ['pumpkin', 'garlic'], 1.6),
  dish('onion_potato', '洋葱土豆', '家常', '素版家里的炒肉底，已经能吃。', 12, ['onion', 'potato'], 1.6),
  dish('pan_smallfish', '香煎小鱼', '水产', '巷口水产摊的老实货，煎香就能下酒。', 16, ['smallfish', 'garlic'], 1.8),
  dish('rape_tofu', '油菜豆腐', '家常', '绿白一盘，比白菜省地方。', 14, ['rapeseed', 'tofu'], 1.7),
  dish('radish_tofu', '萝卜烧豆腐', '家常', '白对白，姜在灶台里，不另占格。', 14, ['radish', 'tofu'], 1.7),
  dish('garlic_shrimp', '蒜蓉虾', '水产', '蒜末噼啪一响，虾就同意被你卖掉。', 28, ['garlic', 'shrimp'], 2.0, (items, sum) => {
    const shrimp = items.find((it) => it.defId === 'shrimp');
    return shrimp && shrimp.inspected && shrimp.quality === 'premium' ? sum + 20 : sum;
  }),
  dish('chive_egg', '韭菜炒蛋', '家常', '香味先到，蛋只负责金黄。', 16, ['chive', 'egg'], 1.7),
  dish('onion_egg', '洋葱炒蛋', '家常', '蛋多一种脾气，洋葱负责出汗。', 16, ['onion', 'egg'], 1.7),
  dish('spinach_egg_soup', '菠菜蛋花汤', '汤', '红根还可以留，汤绿了就算成功。', 12, ['spinach', 'egg'], 1.4),
  dish('garlic_water_spinach', '蒜蓉空心菜', '家常', '空心管吸蒜，比小白菜野一点。', 10, ['water_spinach', 'garlic'], 1.6),
  dish('celery_dried_tofu', '芹菜香干', '家常', '俩都耐造，适合冰箱快满时清位。', 14, ['celery', 'dried_tofu'], 1.7),
  dish('sprout_chive', '豆芽炒韭菜', '家常', '两把须子见面，出锅还脆。', 12, ['sprout', 'chive'], 1.6),
  dish('mushroom_bokchoy', '香菇青菜', '家常', '鲜菇配最常见的叶子，不靠鸡汤。', 12, ['mushroom', 'bokchoy'], 1.7),
  dish('carrot_mushroom', '胡萝卜炒香菇', '家常', '橙和褐，素炒里最像「加了荤」。', 14, ['carrot', 'mushroom'], 1.7),
  dish('broccoli_garlic', '素炒西兰花', '家常', '认市场货，不认西餐厅。', 10, ['broccoli', 'garlic'], 1.6),
  dish('lotus_pepper', '莲藕炒青椒', '家常', '孔还在，青椒负责颜色。', 14, ['lotus', 'pepper'], 1.7),
  dish('home_tofu', '家常豆腐', '家常', '三样都常见，合在一起才叫家常。', 16, ['tofu', 'pepper', 'garlic'], 1.8),
  dish('yuxiang_eggplant', '鱼香茄子', '家常', '没有肉末也叫鱼香，姜蒜把故事讲完。', 18, ['eggplant', 'garlic', 'ginger'], 1.8),
  dish('three_fresh', '地三鲜', '家常', '东北家常的三兄弟，占格不小。', 20, ['potato', 'eggplant', 'pepper'], 1.8),
  dish('melon_kelp', '冬瓜海带汤', '汤', '两块湿咸，夏天最肯进嘴。', 16, ['melon', 'kelp'], 1.4),
  dish('pan_hairtail', '干煎带鱼', '水产', '银腰带下锅，蒜是边角料。', 22, ['hairtail', 'garlic'], 1.9),
  dish('clam_soup', '姜汤花蛤', '水产', '吐沙在玩家脑内完成，姜负责安心。', 20, ['clam', 'ginger'], 1.8),
  dish('garlic_clam', '蒜蓉花蛤', '水产', '比汤更吵，蒜末和壳一起响。', 22, ['clam', 'garlic'], 1.9),
  dish('tomato_fish', '番茄小鱼', '水产', '酸甜兜住小鱼，比清蒸省事。', 18, ['smallfish', 'tomato'], 1.8),
  dish('shrimp_egg', '虾仁炒蛋', '水产', '蛋涨份量，虾涨面子。', 24, ['shrimp', 'egg'], 1.9),
  dish('shrimp_tofu', '虾仁豆腐', '水产', '嫩对嫩，比蒜蓉虾温柔。', 24, ['shrimp', 'tofu'], 1.9),
  dish('braised_hairtail', '红烧带鱼', '水产', '姜蒜把腥按住，带鱼才肯红。', 26, ['hairtail', 'ginger', 'garlic'], 2.0),
  dish('pepper_pork', '青椒炒肉', '荤', '肉摊开门第一道，青椒比肉还常见。', 20, ['pepper', 'pork'], 1.9),
  dish('potato_chicken', '土豆烧鸡腿', '荤', '一块泥里的、一只带骨的，炖到软。', 22, ['potato', 'chicken_leg'], 1.9),
  dish('ginger_crab', '葱姜炒蟹', '水产', '钳子还在挥，姜和洋葱负责把它按住。', 32, ['crab', 'ginger', 'onion'], 2.1),
  dish('steam_yellowfish', '清蒸黄鱼', '水产', '金灿灿一条，姜片比酱料诚实。', 28, ['yellowfish', 'ginger'], 2.0),
  dish('yellowfish_tofu', '豆腐烧黄鱼', '水产', '面子鱼配老实豆腐，一盘能待客。', 30, ['yellowfish', 'tofu'], 2.0),
  dish('crucian_tofu', '鲫鱼豆腐汤', '汤', '土鲫认汤，不认红烧。', 26, ['crucian', 'tofu', 'ginger'], 1.5),
  dish('radish_ribs', '萝卜炖排骨', '荤', '白萝卜吸骨头，厨房会香一夜。', 28, ['radish', 'ribs'], 2.0),
  dish('cabbage_belly', '白菜烧五花', '荤', '层层白菜包住肥瘦，是冬天的晚饭。', 24, ['cabbage', 'pork_belly'], 1.9),
];

export const START_RECIPES: RecipeId[] = ['stirfry', 'tomato_egg'];

/** 下标 0 = 烹饪台升到内部 1（界面 2 级）新给的三本。 */
export const TABLE_UNLOCKS: RecipeId[][] = [
  ['garlic_bokchoy', 'vinegar_cabbage', 'vinegar_potato'],
  ['lettuce_salad', 'braised_eggplant', 'tomato_tofu'],
  ['cucumber_egg', 'corn_egg', 'tomato_egg_soup'],
  ['pepper_potato', 'blistered_pepper', 'onion_potato'],
  ['stir_beans', 'rape_tofu', 'onion_egg'],
  ['chive_egg', 'spinach_egg_soup', 'radish_tofu'],
  ['home_tofu', 'tomato_fish', 'sprout_chive'],
  ['garlic_pumpkin', 'garlic_water_spinach', 'celery_dried_tofu'],
  ['mushroom_bokchoy', 'carrot_mushroom', 'broccoli_garlic'],
];

/** 升到这个厨艺等级当天给的一本。 */
export const COOK_UNLOCK_AT: Record<number, RecipeId> = {
  2: 'garlic_shrimp',
  3: 'yuxiang_eggplant',
  4: 'three_fresh',
  5: 'pepper_pork',
  6: 'potato_chicken',
  7: 'clam_soup',
  8: 'pan_hairtail',
  9: 'shrimp_egg',
  10: 'garlic_clam',
  11: 'shrimp_tofu',
  12: 'braised_hairtail',
  13: 'cabbage_belly',
  14: 'radish_ribs',
  15: 'crucian_tofu',
};

export const MARKET_RECIPE_POOL: Record<MarketId, RecipeId[]> = {
  xiangko: ['smashed_cucumber', 'pan_smallfish'],
  heyan: ['melon_kelp', 'lotus_pepper'],
  jiangbian: ['ginger_crab', 'steam_yellowfish', 'yellowfish_tofu'],
};

export function isRecipeId(id: string): id is RecipeId {
  return RECIPES.some((r) => r.id === id);
}

export function recipeById(id: RecipeId): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipesGainedByTable(fromLevel: number, toLevel: number): RecipeId[] {
  const out: RecipeId[] = [];
  for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
    const row = TABLE_UNLOCKS[lv - 1];
    if (row) out.push(...row);
  }
  return out;
}

export function recipesGainedByCook(fromLevel: number, toLevel: number): RecipeId[] {
  const out: RecipeId[] = [];
  for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
    const id = COOK_UNLOCK_AT[lv];
    if (id) out.push(id);
  }
  return out;
}

export interface RecipeUnlockView {
  level: number;
  tableLevel: number;
  recipesFound: readonly RecipeId[];
  recipesCooked: readonly RecipeId[];
  fridge: RecipeFood[];
}

export function isRecipeUnlocked(save: RecipeUnlockView, id: RecipeId): boolean {
  if (START_RECIPES.includes(id)) return true;
  if (save.recipesFound.includes(id)) return true;
  const table = Math.max(0, Math.floor(save.tableLevel));
  for (let i = 0; i < table && i < TABLE_UNLOCKS.length; i++) {
    if (TABLE_UNLOCKS[i].includes(id)) return true;
  }
  const cook = Math.max(1, Math.floor(save.level));
  for (let lv = 2; lv <= cook; lv++) {
    if (COOK_UNLOCK_AT[lv] === id) return true;
  }
  return false;
}

export function unlockedRecipes(save: RecipeUnlockView): RecipeDef[] {
  return RECIPES.filter((r) => isRecipeUnlocked(save, r.id));
}

export function remainingMarketRecipes(marketId: MarketId, found: RecipeId[]): RecipeId[] {
  const have = new Set(found);
  return MARKET_RECIPE_POOL[marketId].filter((id) => !have.has(id));
}

function usableFoods(save: RecipeUnlockView): RecipeFood[] {
  return save.fridge.filter((it) => it.kind !== 'dish' && it.quality !== 'rotten');
}

function freshest(list: RecipeFood[]): RecipeFood | undefined {
  return [...list].sort((a, b) => b.freshness - a.freshness)[0];
}

export function recipeNeeds(save: RecipeUnlockView, recipeId: RecipeId): RecipeNeed[] {
  const foods = usableFoods(save);
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
  if (recipe.id === 'stirfry') {
    const veg = foods.filter((it) => isDryVeg(it.defId)).length;
    return [{ label: '干蔬菜', iconId: 'bokchoy', have: veg, need: 2 }];
  }
  return recipe.needs.map((id) => ({
    label: getItem(id).name,
    iconId: id,
    have: foods.filter((it) => it.defId === id).length,
    need: 1,
  }));
}

export function pickRecipeFoods(save: RecipeUnlockView, recipeId: RecipeId): RecipeFood[] {
  const foods = usableFoods(save);
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
  if (recipe.id === 'stirfry') {
    const veg = foods.filter((it) => isDryVeg(it.defId)).sort((a, b) => b.freshness - a.freshness);
    return veg.length >= 2 ? veg.slice(0, 2) : [];
  }
  const picked: RecipeFood[] = [];
  const used = new Set<string>();
  for (const id of recipe.needs) {
    const hit = freshest(foods.filter((it) => it.defId === id && !used.has(it.uid ?? '')));
    if (!hit) return [];
    if (hit.uid) used.add(hit.uid);
    picked.push(hit);
  }
  return picked;
}

export function recipeCanCook(save: RecipeUnlockView, recipeId: RecipeId): boolean {
  return isRecipeUnlocked(save, recipeId) && pickRecipeFoods(save, recipeId).length > 0;
}

export function recipeXp(save: { recipesCooked: readonly RecipeId[] }, recipeId: RecipeId): number {
  const recipe = recipeById(recipeId);
  if (!recipe) return 0;
  const first = !save.recipesCooked.includes(recipeId);
  return recipe.xp + (first ? recipe.firstXp : 0);
}

export function recipeUnlockView(save: {
  level: number;
  furnLevels: { table: number };
  recipesFound: readonly RecipeId[];
  recipesCooked: readonly RecipeId[];
  fridge: RecipeFood[];
}): RecipeUnlockView {
  return {
    level: save.level,
    tableLevel: save.furnLevels.table ?? 0,
    recipesFound: save.recipesFound,
    recipesCooked: save.recipesCooked,
    fridge: save.fridge,
  };
}
