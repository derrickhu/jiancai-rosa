import type { MarketId } from './destinations';
import { getItem, sellPrice, type Quality } from './items';
import type { Rarity } from './rarity';

export type RecipeId =
  // 普通（白）：开局 + 烹饪台
  | 'stirfry' | 'tomato_egg' | 'scallion_tofu' | 'smashed_cucumber'
  | 'vinegar_potato' | 'garlic_bokchoy' | 'stir_beans' | 'blistered_pepper'
  | 'lettuce_salad' | 'harvard_veg_soup' | 'spinach_egg_soup' | 'celery_dried_tofu'
  | 'three_fresh' | 'melon_kelp' | 'candied_taro' | 'ants_tree'
  | 'oyster_egg' | 'stir_liver' | 'tremella_lily_soup'
  | 'vinegar_cabbage' | 'pepper_pork'
  // 良品（绿）：厨艺升级送；剩下的散在中低级市场油纸
  | 'perilla_cucumber' | 'onion_wood_ear' | 'chive_shrimp' | 'mushroom_bokchoy' | 'carrot_mushroom' | 'broccoli_garlic' | 'lotus_pepper' | 'yuxiang_eggplant'
  | 'wood_ear_egg' | 'clam_soup' | 'tomato_fish' | 'mixed_fish_pot' | 'pan_hairtail'
  | 'crucian_tofu' | 'potato_chicken' | 'bamboo_pork'
  | 'yam_chestnut' | 'dried_tofu_pork' | 'chestnut_duck'
  // 上品（蓝）：只能在中高级市场的油纸上捡
  | 'garlic_shrimp' | 'ginger_crab' | 'steam_yellowfish' | 'braised_eel' | 'wild_fish_soup'
  | 'radish_ribs' | 'cabbage_belly' | 'braised_beef' | 'ham_melon_soup' | 'matsutake_chicken'
  | 'yandu_xian' | 'maoxuewang';

export interface RecipeFood {
  uid?: string;
  defId: string;
  quality: Quality;
  inspected: boolean;
  freshness: number;
  kind?: string;
  qty?: number;
}

export interface RecipeDef {
  id: RecipeId;
  name: string;
  desc: string;
  group: string;
  rarity: Rarity;
  blurb: string;
  xp: number;
  firstXp: number;
  /** 可重复的材料清单：出现两次就是要两份。 */
  needs: string[];
  /** 吃一口的效果。不填按体力 +1。出门 buff 以后往这里加。 */
  eat?: { stamina?: number };
  match: (items: RecipeFood[]) => boolean;
  cook: (items: RecipeFood[]) => number;
}

export interface RecipeNeed {
  label: string;
  have: number;
  need: number;
  iconId: string;
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
    const sum = Math.round(materialSum(items) * mult);
    return extra ? extra(items, sum) : sum;
  };
}

/**
 * 两道菜的「食材种类集合」不能相同。份数不同也算重复：
 * 番茄炒蛋（番茄+蛋2）和番茄蛋汤（番茄+蛋1）会让人不知道该攒哪道。
 * 种类集合 = 去重后的 needs，不管各要几份。
 */
export function ingredientSetKey(needs: readonly string[]): string {
  return [...new Set(needs)].sort().join(',');
}

/** 旧存档 id → 现用 id。已删的同质菜直接丢掉，不迁到还在的菜上。 */
export const RECIPE_ID_ALIASES: Record<string, RecipeId> = {
  tomato_egg_soup: 'spinach_egg_soup',
  egg_tofu_soup: 'spinach_egg_soup',
  braised_eggplant: 'garlic_bokchoy',
  onion_egg: 'onion_wood_ear',
  pan_smallfish: 'mixed_fish_pot',
};

export function migrateRecipeId(id: string): RecipeId | null {
  const next = RECIPE_ID_ALIASES[id] ?? id;
  return isRecipeId(next) ? next : null;
}

/**
 * 菜谱的经验和加价倍率都从稀有度推：
 *   经验 = 底经验 + 份数 × 每份经验
 * 「份数」是材料清单的长度，所以要三份蒜的菜天然比要一份的值钱。
 * 想调升级快慢改这三行就够，别去逐道菜手填。
 */
const XP_BASE: Record<Rarity, number> = { common: 3, rare: 8, epic: 16 };
const XP_PER_PORTION: Record<Rarity, number> = { common: 1.5, rare: 2.5, epic: 4 };
const COOK_MUL: Record<Rarity, number> = { common: 1.6, rare: 1.9, epic: 2.2 };

/** 把可重复清单折成「番茄 1 / 鸡蛋 2」，保持首次出现的顺序。 */
export function tallyNeeds(needs: string[]): Array<{ id: string; n: number }> {
  const out: Array<{ id: string; n: number }> = [];
  for (const id of needs) {
    const hit = out.find((row) => row.id === id);
    if (hit) hit.n += 1;
    else out.push({ id, n: 1 });
  }
  return out;
}

function describe(needs: string[]): string {
  return tallyNeeds(needs).map(({ id, n }) => `${getItem(id).name} ${n}`).join(' + ');
}

function dish(
  id: RecipeId,
  name: string,
  group: string,
  rarity: Rarity,
  blurb: string,
  needs: string[],
  extra?: (items: RecipeFood[], sum: number) => number,
): RecipeDef {
  const xp = Math.round(XP_BASE[rarity] + needs.length * XP_PER_PORTION[rarity]);
  return {
    id,
    name,
    desc: describe(needs),
    group,
    rarity,
    blurb,
    xp,
    firstXp: Math.round(xp / 2),
    needs,
    match: exact(needs),
    cook: priced(COOK_MUL[rarity], extra),
  };
}

export const RECIPES: RecipeDef[] = [
  // ── 普通（白）：两三样常见货，锅一响就成 ──────────────────
  dish('stirfry', '炒菜苔', '家常', 'common', '细秆进锅，花还在。只吃菜苔，别的绿叶子一棵不动。', ['caitai', 'caitai']),
  dish('tomato_egg', '番茄炒蛋', '家常', 'common', '中式厨房的起手式。红黄一碰，连外卖都要让路。', ['tomato', 'egg', 'egg']),
  dish('scallion_tofu', '小葱拌豆腐', '凉菜', 'common', '不用开火，一清二白，端上桌全靠那把葱花。', ['scallion', 'tofu']),
  dish('smashed_cucumber', '凉拌黄瓜', '凉菜', 'common', '不用开火。拍一下，蒜和香菜负责像一盘菜。', ['cucumber', 'garlic', 'cilantro']),
  dish('vinegar_potato', '醋溜土豆丝', '家常', 'common', '切丝是玩家脑内完成的，锅里只见两块变一盘。', ['potato', 'potato', 'ginger']),
  dish('garlic_bokchoy', '蒜蓉小白菜', '家常', 'common', '蒜末一响，小白菜就肯软下来。两棵才够一盘。', ['bokchoy', 'bokchoy', 'garlic']),
  dish('vinegar_cabbage', '醋溜白菜', '家常', 'common', '外帮也能炒，酸一下才像晚饭。', ['cabbage', 'ginger']),
  dish('stir_beans', '素炒豆角', '家常', 'common', '一把绿筷子过热锅，比干煸省事。', ['greenbean', 'garlic']),
  dish('blistered_pepper', '虎皮青椒', '家常', 'common', '皮起泡才算数，蒜是收尾。', ['pepper', 'pepper', 'garlic']),
  dish('spinach_egg_soup', '菠菜蛋花汤', '汤', 'common', '红根还可以留，汤绿了就算成功。', ['spinach', 'egg']),
  dish('celery_dried_tofu', '芹菜香干', '家常', 'common', '俩都耐造，适合冰箱快满时清位。香干得切够两块。', ['celery', 'dried_tofu', 'dried_tofu']),
  dish('three_fresh', '地三鲜', '家常', 'common', '东北家常的三兄弟，占格不小。', ['potato', 'eggplant', 'pepper']),
  dish('melon_kelp', '冬瓜海带汤', '汤', 'common', '两块湿咸，夏天最肯进嘴。', ['melon', 'kelp']),
  dish('lettuce_salad', '生菜沙拉', '凉菜', 'common', '整棵脑袋撕开，番茄和黄瓜负责像一盘西餐。', ['lettuce', 'tomato', 'cucumber']),
  dish('harvard_veg_soup', '哈佛蔬菜汤', '汤', 'common', '名字唬人，其实就是土豆胡萝卜玉米番茄一锅炖。', ['potato', 'carrot', 'corn', 'tomato']),
  dish('candied_taro', '拔丝芋头', '家常', 'common', '两块芋头，糖在玩家脑内完成，出锅还能拉丝。', ['taro', 'taro']),
  dish('ants_tree', '蚂蚁上树', '荤', 'common', '粉丝是树，肉末是蚁，一盘里挤满了故事。', ['vermicelli', 'pork', 'pork']),
  dish('oyster_egg', '生蚝煎蛋', '水产', 'common', '壳里的人下了蛋，金黄把腥按住。', ['oyster', 'egg', 'egg']),
  dish('stir_liver', '小炒猪肝', '荤', 'common', '火要大，肝要嫩，青椒负责叫。', ['pork_liver', 'pepper', 'garlic']),
  dish('pepper_pork', '青椒炒肉', '荤', 'common', '肉摊开门第一道，姜负责去腥。', ['pork', 'pork', 'pepper', 'pepper', 'ginger']),
  dish('tremella_lily_soup', '银耳百合莲子汤', '汤', 'common', '四样干货泡开，汤才肯白，枸杞负责像有人懂。', ['tremella', 'lily', 'lotus_seed', 'goji']),

  // ── 良品（绿）：开始要绿货，或者要成把地放 ──────────────────
  dish('perilla_cucumber', '紫苏黄瓜', '家常', 'rare', '湘味热锅。黄瓜片煎黄，紫苏叶和朝天椒一起香起来。', ['perilla', 'cucumber', 'bird_chili']),
  dish('onion_wood_ear', '洋葱拌木耳', '凉菜', 'rare', '不用开火。木耳泡开，洋葱一拌，黑白脆。', ['onion', 'wood_ear', 'wood_ear']),
  dish('chive_shrimp', '韭菜炒河虾', '水产', 'rare', '青的香，灰的弹，河沿水边才配这盘。', ['chive', 'river_shrimp', 'river_shrimp']),
  dish('mushroom_bokchoy', '香菇青菜', '家常', 'rare', '鲜菇配最常见的叶子，不靠鸡汤。菇得放够两朵。', ['mushroom', 'mushroom', 'bokchoy', 'bokchoy']),
  dish('carrot_mushroom', '胡萝卜炒香菇', '家常', 'rare', '橙和褐，素炒里最像「加了荤」。', ['mushroom', 'mushroom', 'carrot', 'carrot']),
  dish('broccoli_garlic', '素炒西兰花', '家常', 'rare', '认市场货，不认西餐厅。蒜要两头才压得住。', ['broccoli', 'garlic', 'garlic']),
  dish('lotus_pepper', '莲藕炒青椒', '家常', 'rare', '孔还在，青椒负责颜色。', ['lotus', 'lotus', 'pepper']),
  dish('yuxiang_eggplant', '鱼香茄子', '家常', 'rare', '没有肉末也叫鱼香，姜蒜把故事讲完。', ['eggplant', 'eggplant', 'garlic', 'garlic', 'ginger']),
  dish('wood_ear_egg', '木耳炒蛋', '家常', 'rare', '黑白分明，脆的那半是木耳在负责。', ['wood_ear', 'wood_ear', 'egg', 'egg']),
  dish('clam_soup', '姜汤花蛤', '汤', 'rare', '吐沙在玩家脑内完成，姜负责安心。三只才听得见响。', ['clam', 'clam', 'clam', 'ginger']),
  dish('tomato_fish', '番茄小鱼', '水产', 'rare', '酸甜兜住小鱼，比清蒸省事。', ['smallfish', 'smallfish', 'tomato', 'tomato']),
  dish('mixed_fish_pot', '杂鱼锅', '汤', 'rare', '什么鱼都肯下。小鱼两条，再加一条土鲫，姜把腥按住。', ['smallfish', 'smallfish', 'crucian', 'ginger']),
  dish('pan_hairtail', '干煎带鱼', '水产', 'rare', '银腰带下锅，姜蒜是边角料。', ['hairtail', 'ginger', 'garlic']),
  dish('crucian_tofu', '鲫鱼豆腐汤', '汤', 'rare', '土鲫认汤，不认红烧。', ['crucian', 'tofu', 'ginger']),
  dish('potato_chicken', '土豆烧鸡腿', '荤', 'rare', '一只带骨的，两块泥里的，炖到软。', ['chicken_leg', 'potato', 'potato']),
  dish('bamboo_pork', '春笋炒肉', '荤', 'rare', '笋比肉贵的那一个月，才配这么炒。', ['bamboo_shoot', 'bamboo_shoot', 'pork']),
  dish('yam_chestnut', '板栗山药煲', '家常', 'rare', '两样都粉，一锅炖到互相分不清。', ['yam', 'yam', 'chestnut', 'chestnut', 'chestnut']),
  dish('dried_tofu_pork', '香干回锅肉', '荤', 'rare', '肉先煸出油，香干再进去抢。', ['pork', 'pork', 'dried_tofu', 'dried_tofu', 'pepper']),
  dish('chestnut_duck', '板栗烧鸭', '荤', 'rare', '鸭油裹住栗子，八角负责出香。', ['duck_leg', 'chestnut', 'chestnut', 'chestnut', 'ginger', 'star_anise']),

  // ── 上品（蓝）：非得攒蓝货不可，一盘顶一天 ──────────────────
  dish('garlic_shrimp', '蒜蓉虾', '水产', 'epic', '蒜末噼啪一响，三只虾就同意被你卖掉。', ['shrimp', 'shrimp', 'shrimp', 'garlic', 'garlic']),
  dish('ginger_crab', '葱姜炒蟹', '水产', 'epic', '钳子还在挥，葱姜负责把它按住。', ['crab', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('steam_yellowfish', '清蒸黄鱼', '水产', 'epic', '金灿灿一条，姜片比酱料诚实。', ['yellowfish', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('braised_eel', '红烧河鳗', '水产', 'epic', '整条不切段，酱色收到发亮才算数。', ['river_eel', 'garlic', 'garlic', 'garlic', 'ginger', 'scallion']),
  dish('wild_fish_soup', '野生黄鱼汤', '汤', 'epic', '奶白一锅，喝的人不说话，只顾着喝。', ['wild_yellowfish', 'tofu', 'ginger', 'scallion']),
  dish('radish_ribs', '萝卜炖排骨', '荤', 'epic', '白萝卜吸骨头，厨房会香一夜。', ['ribs', 'radish', 'radish', 'ginger', 'star_anise']),
  dish('cabbage_belly', '白菜烧五花', '荤', 'epic', '层层白菜包住肥瘦，是冬天的晚饭。', ['pork_belly', 'cabbage', 'ginger', 'garlic']),
  dish('braised_beef', '红烧牛腩', '荤', 'epic', '炖到筷子能戳穿，萝卜比肉先被抢光。', ['beef_brisket', 'radish', 'radish', 'ginger', 'garlic', 'garlic', 'star_anise']),
  dish('ham_melon_soup', '火腿冬瓜汤', '汤', 'epic', '一片老火腿就把整锅水变成了汤。', ['ham', 'melon', 'ginger']),
  dish('matsutake_chicken', '松茸炖鸡', '汤', 'epic', '揭盖那一下，整间屋子都知道你今天买了什么。', ['matsutake', 'chicken_leg', 'ginger']),
  dish('yandu_xian', '腌笃鲜', '汤', 'epic', '咸的鲜的一起笃，笋在里面最耐心。', ['ham', 'pork_belly', 'bamboo_shoot', 'bamboo_shoot', 'tofu']),
  dish('maoxuewang', '毛血旺', '荤', 'epic', '一锅红，朝天椒和花椒负责叫醒。', ['duck_blood', 'duck_blood', 'sprout', 'pork', 'garlic', 'bird_chili', 'peppercorn']),
];

/** 两道菜去重后的食材种类不能撞车，份数不同也算重复。 */
export function findDuplicateIngredientSets(recipes: readonly RecipeDef[] = RECIPES): Array<[RecipeDef, RecipeDef]> {
  const seen = new Map<string, RecipeDef>();
  const dups: Array<[RecipeDef, RecipeDef]> = [];
  for (const rec of recipes) {
    const key = ingredientSetKey(rec.needs);
    const prev = seen.get(key);
    if (prev) dups.push([prev, rec]);
    else seen.set(key, rec);
  }
  return dups;
}

{
  const dups = findDuplicateIngredientSets();
  if (dups.length) {
    const detail = dups
      .map(([a, b]) => `${a.name}(${a.id}) / ${b.name}(${b.id}) → [${ingredientSetKey(a.needs)}]`)
      .join('；');
    throw new Error(`菜谱食材种类重复：${detail}`);
  }
}

export const START_RECIPES: RecipeId[] = ['stirfry', 'tomato_egg', 'scallion_tofu'];

/**
 * 烹饪台主要送普通菜。
 * 下标 0 = 烹饪台升到内部 1（界面 2 级）新给的。
 * 前两档只用巷口货；河沿开场那档补凉拌黄瓜 / 杂鱼锅（绿谱，要鲫鱼） / 洋葱拌木耳 / 醋溜白菜。
 * 韭菜炒河虾走河沿油纸，不再白送炒蛋。
 * 紫苏黄瓜是良品绿谱，材料只出香料夜摊，台 1 先让人认得这道菜。
 */
export const TABLE_UNLOCKS: RecipeId[][] = [
  ['perilla_cucumber', 'vinegar_potato'],
  ['garlic_bokchoy'],
  ['smashed_cucumber', 'mixed_fish_pot', 'blistered_pepper', 'lettuce_salad', 'onion_wood_ear', 'vinegar_cabbage'],
  ['stir_beans', 'harvard_veg_soup'],
  ['spinach_egg_soup', 'candied_taro'],
  ['celery_dried_tofu', 'ants_tree'],
  ['three_fresh', 'stir_liver', 'pepper_pork'],
  ['melon_kelp'],
  ['oyster_egg', 'tremella_lily_soup'],
];

/** 厨艺升级送良品菜，不必每级都送。空档留给以后加菜。上品蓝本一律不走这里。 */
export type CookUnlockGrant = RecipeId | readonly RecipeId[];

export const COOK_UNLOCK_AT: Record<number, CookUnlockGrant> = {
  2: 'broccoli_garlic',
  3: 'carrot_mushroom',
  4: 'potato_chicken',
  5: 'yuxiang_eggplant',
  6: 'lotus_pepper',
  7: 'clam_soup',
  8: 'wood_ear_egg',
  9: 'bamboo_pork',
  13: 'pan_hairtail',
  14: 'crucian_tofu',
};

export function cookUnlocksAt(level: number): RecipeId[] {
  const row = COOK_UNLOCK_AT[level];
  if (!row) return [];
  return typeof row === 'string' ? [row] : [...row];
}

/**
 * 油纸菜谱池。巷口和河沿只压得到绿本，上品蓝本要走到山坞以后才见得着。
 * 允许跨场重复，捡过的会被 remainingMarketRecipes 滤掉。
 */
export const MARKET_RECIPE_POOL: Record<MarketId, RecipeId[]> = {
  xiangko: ['mushroom_bokchoy', 'tomato_fish'],
  heyan: ['dried_tofu_pork', 'chive_shrimp', 'cabbage_belly', 'radish_ribs'],
  shanwu: ['yam_chestnut', 'chestnut_duck', 'matsutake_chicken', 'yandu_xian'],
  jiangbian: [
    'garlic_shrimp', 'ginger_crab', 'steam_yellowfish', 'braised_eel', 'wild_fish_soup',
  ],
  laocheng: ['braised_beef', 'ham_melon_soup', 'yandu_xian', 'radish_ribs', 'cabbage_belly', 'matsutake_chicken', 'maoxuewang'],
};

export function isRecipeId(id: string): id is RecipeId {
  return RECIPES.some((r) => r.id === id);
}

export function recipeById(id: RecipeId): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipeEatStamina(recipe: RecipeDef): number {
  const n = recipe.eat?.stamina;
  return typeof n === 'number' && n > 0 ? Math.floor(n) : 1;
}

export function recipeSellPrice(id: RecipeId): number {
  const recipe = recipeById(id);
  if (!recipe) return 0;
  return recipe.cook(recipe.needs.map((defId) => ({
    defId,
    quality: 'common' as const,
    inspected: true,
    freshness: 1,
  })));
}

export function recipeRarity(id: RecipeId): Rarity {
  return recipeById(id)?.rarity ?? 'common';
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
    out.push(...cookUnlocksAt(lv));
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
    if (cookUnlocksAt(lv).includes(id)) return true;
  }
  return false;
}

export function unlockedRecipes(save: RecipeUnlockView): RecipeDef[] {
  return RECIPES.filter((r) => isRecipeUnlocked(save, r.id));
}

/** 已解锁菜谱要用到的食材。摊上抽货靠它加权，货才跟得上菜谱。 */
export function unlockedIngredients(save: RecipeUnlockView): Set<string> {
  const out = new Set<string>();
  for (const r of unlockedRecipes(save)) {
    for (const id of r.needs) out.add(id);
  }
  return out;
}

export function remainingMarketRecipes(marketId: MarketId, found: RecipeId[]): RecipeId[] {
  const have = new Set(found);
  return MARKET_RECIPE_POOL[marketId].filter((id) => !have.has(id));
}

function foodQty(it: RecipeFood): number {
  return Math.max(1, Math.floor(it.qty ?? 1));
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
  return tallyNeeds(recipe.needs).map(({ id, n }) => ({
    label: getItem(id).name,
    iconId: id,
    have: foods.filter((it) => it.defId === id).reduce((sum, it) => sum + foodQty(it), 0),
    need: n,
  }));
}

export function pickRecipeFoods(save: RecipeUnlockView, recipeId: RecipeId): RecipeFood[] {
  const foods = usableFoods(save);
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
  const picked: RecipeFood[] = [];
  const left = new Map<string, number>();
  for (const it of foods) {
    if (it.uid) left.set(it.uid, foodQty(it));
  }
  for (const id of recipe.needs) {
    const hit = freshest(foods.filter((it) => it.defId === id && (it.uid ? (left.get(it.uid) ?? 0) > 0 : true)));
    if (!hit) return [];
    if (hit.uid) left.set(hit.uid, (left.get(hit.uid) ?? 1) - 1);
    picked.push({ ...hit, qty: 1 });
  }
  return picked;
}

export function recipeCanCook(save: RecipeUnlockView, recipeId: RecipeId): boolean {
  return recipeCookCount(save, recipeId) > 0;
}

/** 按冰箱现有份数，这道菜现在能连做几份。材料共用时各自独立算。 */
export function recipeCookCount(save: RecipeUnlockView, recipeId: RecipeId): number {
  if (!isRecipeUnlocked(save, recipeId)) return 0;
  const needs = recipeNeeds(save, recipeId);
  if (!needs.length) return 0;
  return Math.min(...needs.map((row) => Math.floor(row.have / row.need)));
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
