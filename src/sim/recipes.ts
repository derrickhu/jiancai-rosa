import type { MarketId } from './destinations';
import { getItem, sellPrice, type Quality } from './items';
import type { Rarity } from './rarity';

export type RecipeId =
  // 普通（绿）：烹饪台一级一级送
  | 'stirfry' | 'tomato_egg' | 'scallion_tofu' | 'smashed_cucumber' | 'lettuce_salad'
  | 'garlic_bokchoy' | 'vinegar_cabbage' | 'vinegar_potato' | 'pepper_potato' | 'braised_eggplant'
  | 'tomato_tofu' | 'cucumber_egg' | 'corn_egg' | 'egg_tofu_soup' | 'stir_beans'
  | 'blistered_pepper' | 'garlic_pumpkin' | 'onion_potato' | 'rape_tofu' | 'radish_tofu'
  | 'chive_egg' | 'onion_egg' | 'spinach_egg_soup' | 'garlic_water_spinach' | 'celery_dried_tofu'
  | 'sprout_chive' | 'pan_smallfish' | 'three_fresh' | 'home_tofu' | 'melon_kelp'
  // 高级（蓝）：厨艺每升一级送一本，剩下的散在中低级市场
  | 'mushroom_bokchoy' | 'carrot_mushroom' | 'broccoli_garlic' | 'lotus_pepper' | 'yuxiang_eggplant'
  | 'wood_ear_egg' | 'clam_soup' | 'garlic_clam' | 'tomato_fish' | 'pan_hairtail'
  | 'braised_hairtail' | 'crucian_tofu' | 'pepper_pork' | 'potato_chicken' | 'bamboo_pork'
  | 'bamboo_chicken' | 'yam_chestnut' | 'mushroom_yam_soup' | 'dried_tofu_pork' | 'chestnut_duck'
  // 稀有（紫）：只能在中高级市场的油纸上捡
  | 'garlic_shrimp' | 'shrimp_egg' | 'shrimp_tofu' | 'ginger_crab' | 'crab_tofu'
  | 'steam_yellowfish' | 'yellowfish_tofu' | 'braised_eel' | 'wild_fish_soup' | 'radish_ribs'
  | 'cabbage_belly' | 'braised_beef' | 'ham_melon_soup' | 'matsutake_chicken' | 'yandu_xian';

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
  rarity: Rarity;
  blurb: string;
  xp: number;
  firstXp: number;
  /** 可重复的材料清单：出现两次就是要两份。 */
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

/** 旧存档 id → 现用 id。番茄蛋汤已并进番茄炒蛋，换成豆腐蛋花汤。 */
export const RECIPE_ID_ALIASES: Record<string, RecipeId> = {
  tomato_egg_soup: 'egg_tofu_soup',
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
  // ── 普通（绿）：两三样常见货，锅一响就成 ──────────────────
  dish('stirfry', '炒菜苔', '家常', 'common', '细秆进锅，花还在。只吃菜苔，别的绿叶子一棵不动。', ['caitai', 'caitai']),
  dish('tomato_egg', '番茄炒蛋', '家常', 'common', '中式厨房的起手式。红黄一碰，连外卖都要让路。', ['tomato', 'egg', 'egg']),
  dish('scallion_tofu', '小葱拌豆腐', '凉菜', 'common', '不用开火，一清二白，端上桌全靠那把葱花。', ['scallion', 'tofu']),
  dish('smashed_cucumber', '拍黄瓜', '凉菜', 'common', '不用开火。拍一下，蒜和香菜负责像一盘菜。', ['cucumber', 'garlic', 'cilantro']),
  dish('lettuce_salad', '凉拌生菜', '凉菜', 'common', '整棵脑袋撕开，比炒更懂它。', ['lettuce', 'garlic']),
  dish('garlic_bokchoy', '蒜蓉小白菜', '家常', 'common', '蒜末一响，小白菜就肯软下来。一棵不够装盘。', ['bokchoy', 'bokchoy', 'garlic']),
  dish('vinegar_cabbage', '醋溜白菜', '家常', 'common', '外帮也能炒，酸一下才像晚饭。', ['cabbage', 'ginger']),
  dish('vinegar_potato', '醋溜土豆丝', '家常', 'common', '切丝是玩家脑内完成的，锅里只见两块变一盘。', ['potato', 'potato', 'ginger']),
  dish('pepper_potato', '青椒土豆丝', '家常', 'common', '两样都常见，合在一起才像过日子。', ['pepper', 'potato', 'potato']),
  dish('braised_eggplant', '红烧茄子', '家常', 'common', '吸油的紫家伙，蒜把它按进酱色。两根才够一盘。', ['eggplant', 'eggplant', 'garlic']),
  dish('tomato_tofu', '西红柿炒豆腐', '家常', 'common', '没鸡蛋也能红，豆腐负责温柔。', ['tomato', 'tomato', 'tofu']),
  dish('cucumber_egg', '黄瓜炒鸡蛋', '家常', 'common', '清淡到像没做，但比清炒多两个蛋。', ['cucumber', 'egg', 'egg']),
  dish('corn_egg', '玉米炒蛋', '家常', 'common', '金钉子碰金蛋，孩子最肯坐下。', ['corn', 'egg', 'egg']),
  dish('egg_tofu_soup', '豆腐蛋花汤', '汤', 'common', '一盆白的，蛋花一搅就成晚饭。不跟番茄炒蛋抢材料。', ['tofu', 'egg', 'egg']),
  dish('stir_beans', '素炒豆角', '家常', 'common', '一把绿筷子过热锅，比干煸省事。', ['greenbean', 'garlic']),
  dish('blistered_pepper', '虎皮青椒', '家常', 'common', '皮起泡才算数，蒜是收尾。', ['pepper', 'pepper', 'garlic']),
  dish('garlic_pumpkin', '蒜蓉南瓜', '家常', 'common', '甜的，蒜压一压才不像点心。', ['pumpkin', 'garlic']),
  dish('onion_potato', '洋葱土豆', '家常', 'common', '素版家里的炒肉底，已经能吃。', ['onion', 'potato']),
  dish('rape_tofu', '油菜豆腐', '家常', 'common', '绿白一盘，比白菜省地方。', ['rapeseed', 'tofu']),
  dish('radish_tofu', '萝卜烧豆腐', '家常', 'common', '白对白，姜在灶台里，不另占格。', ['radish', 'tofu']),
  dish('chive_egg', '韭菜炒蛋', '家常', 'common', '香味先到，蛋只负责金黄。', ['chive', 'egg', 'egg']),
  dish('onion_egg', '洋葱炒蛋', '家常', 'common', '蛋多一种脾气，洋葱负责出汗。', ['onion', 'egg', 'egg']),
  dish('spinach_egg_soup', '菠菜蛋花汤', '汤', 'common', '红根还可以留，汤绿了就算成功。', ['spinach', 'egg']),
  dish('garlic_water_spinach', '蒜蓉空心菜', '家常', 'common', '空心管吸蒜，比小白菜野一点。', ['water_spinach', 'garlic']),
  dish('celery_dried_tofu', '芹菜香干', '家常', 'common', '俩都耐造，适合冰箱快满时清位。香干得切够两块。', ['celery', 'dried_tofu', 'dried_tofu']),
  dish('sprout_chive', '豆芽炒韭菜', '家常', 'common', '两把须子见面，出锅还脆。', ['sprout', 'chive']),
  dish('pan_smallfish', '香煎小鱼', '水产', 'common', '巷口水产摊的老实货，煎两条才够下酒。', ['smallfish', 'smallfish', 'garlic']),
  dish('three_fresh', '地三鲜', '家常', 'common', '东北家常的三兄弟，占格不小。', ['potato', 'eggplant', 'pepper']),
  dish('home_tofu', '家常豆腐', '家常', 'common', '三样都常见，合在一起才叫家常。', ['tofu', 'pepper', 'garlic']),
  dish('melon_kelp', '冬瓜海带汤', '汤', 'common', '两块湿咸，夏天最肯进嘴。', ['melon', 'kelp']),

  // ── 高级（蓝）：开始要蓝货，或者要成把地放 ──────────────────
  dish('mushroom_bokchoy', '香菇青菜', '家常', 'rare', '鲜菇配最常见的叶子，不靠鸡汤。菇得放够两朵。', ['mushroom', 'mushroom', 'bokchoy', 'bokchoy']),
  dish('carrot_mushroom', '胡萝卜炒香菇', '家常', 'rare', '橙和褐，素炒里最像「加了荤」。', ['mushroom', 'mushroom', 'carrot', 'carrot']),
  dish('broccoli_garlic', '素炒西兰花', '家常', 'rare', '认市场货，不认西餐厅。蒜要两头才压得住。', ['broccoli', 'garlic', 'garlic']),
  dish('lotus_pepper', '莲藕炒青椒', '家常', 'rare', '孔还在，青椒负责颜色。', ['lotus', 'lotus', 'pepper']),
  dish('yuxiang_eggplant', '鱼香茄子', '家常', 'rare', '没有肉末也叫鱼香，姜蒜把故事讲完。', ['eggplant', 'eggplant', 'garlic', 'garlic', 'ginger']),
  dish('wood_ear_egg', '木耳炒蛋', '家常', 'rare', '黑白分明，脆的那半是木耳在负责。', ['wood_ear', 'wood_ear', 'egg', 'egg']),
  dish('clam_soup', '姜汤花蛤', '汤', 'rare', '吐沙在玩家脑内完成，姜负责安心。三只才听得见响。', ['clam', 'clam', 'clam', 'ginger']),
  dish('garlic_clam', '蒜蓉花蛤', '水产', 'rare', '比汤更吵，蒜末和壳一起响。', ['clam', 'clam', 'clam', 'garlic', 'garlic']),
  dish('tomato_fish', '番茄小鱼', '水产', 'rare', '酸甜兜住小鱼，比清蒸省事。', ['smallfish', 'smallfish', 'tomato', 'tomato']),
  dish('pan_hairtail', '干煎带鱼', '水产', 'rare', '银腰带下锅，姜蒜是边角料。', ['hairtail', 'ginger', 'garlic']),
  dish('braised_hairtail', '红烧带鱼', '水产', 'rare', '姜蒜把腥按住，最后那把葱才是收尾。', ['hairtail', 'ginger', 'garlic', 'garlic', 'scallion']),
  dish('crucian_tofu', '鲫鱼豆腐汤', '汤', 'rare', '土鲫认汤，不认红烧。', ['crucian', 'tofu', 'ginger']),
  dish('pepper_pork', '青椒炒肉', '荤', 'rare', '肉摊开门第一道，肉得切够两片。', ['pork', 'pork', 'pepper', 'pepper']),
  dish('potato_chicken', '土豆烧鸡腿', '荤', 'rare', '一只带骨的，两块泥里的，炖到软。', ['chicken_leg', 'potato', 'potato']),
  dish('bamboo_pork', '春笋炒肉', '荤', 'rare', '笋比肉贵的那一个月，才配这么炒。', ['bamboo_shoot', 'bamboo_shoot', 'pork']),
  dish('bamboo_chicken', '春笋炖鸡', '荤', 'rare', '一锅浑汤，笋把鸡的油都吃了。', ['chicken_leg', 'bamboo_shoot', 'bamboo_shoot']),
  dish('yam_chestnut', '板栗山药煲', '家常', 'rare', '两样都粉，一锅炖到互相分不清。', ['yam', 'yam', 'chestnut', 'chestnut', 'chestnut']),
  dish('mushroom_yam_soup', '山药香菇汤', '汤', 'rare', '素汤里最有底气的一锅，喝完手心是暖的。', ['yam', 'yam', 'mushroom', 'mushroom']),
  dish('dried_tofu_pork', '香干回锅肉', '荤', 'rare', '肉先煸出油，香干再进去抢。', ['pork', 'pork', 'dried_tofu', 'dried_tofu', 'pepper']),
  dish('chestnut_duck', '板栗烧鸭', '荤', 'rare', '鸭油裹住栗子，甜咸各占一半。', ['duck_leg', 'chestnut', 'chestnut', 'chestnut', 'ginger']),

  // ── 稀有（紫）：非得攒紫货不可，一盘顶一天 ──────────────────
  dish('garlic_shrimp', '蒜蓉虾', '水产', 'epic', '蒜末噼啪一响，三只虾就同意被你卖掉。', ['shrimp', 'shrimp', 'shrimp', 'garlic', 'garlic']),
  dish('shrimp_egg', '虾仁炒蛋', '水产', 'epic', '蛋涨份量，虾涨面子。', ['shrimp', 'shrimp', 'egg', 'egg', 'egg']),
  dish('shrimp_tofu', '虾仁豆腐', '水产', 'epic', '嫩对嫩，比蒜蓉虾温柔，也更费虾。', ['shrimp', 'shrimp', 'tofu', 'tofu', 'scallion']),
  dish('ginger_crab', '葱姜炒蟹', '水产', 'epic', '钳子还在挥，葱姜负责把它按住。', ['crab', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('crab_tofu', '蟹粉豆腐', '水产', 'epic', '拆蟹拆到手酸，最后全化进那盘白的里。', ['crab', 'tofu', 'tofu', 'ginger']),
  dish('steam_yellowfish', '清蒸黄鱼', '水产', 'epic', '金灿灿一条，姜片比酱料诚实。', ['yellowfish', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('yellowfish_tofu', '豆腐烧黄鱼', '水产', 'epic', '面子鱼配老实豆腐，一盘能待客。', ['yellowfish', 'tofu', 'tofu', 'garlic', 'garlic']),
  dish('braised_eel', '红烧河鳗', '水产', 'epic', '整条不切段，酱色收到发亮才算数。', ['river_eel', 'garlic', 'garlic', 'garlic', 'ginger', 'scallion']),
  dish('wild_fish_soup', '野生黄鱼汤', '汤', 'epic', '奶白一锅，喝的人不说话，只顾着喝。', ['wild_yellowfish', 'tofu', 'ginger', 'scallion']),
  dish('radish_ribs', '萝卜炖排骨', '荤', 'epic', '白萝卜吸骨头，厨房会香一夜。', ['ribs', 'radish', 'radish', 'ginger']),
  dish('cabbage_belly', '白菜烧五花', '荤', 'epic', '层层白菜包住肥瘦，是冬天的晚饭。', ['pork_belly', 'cabbage', 'ginger', 'garlic']),
  dish('braised_beef', '红烧牛腩', '荤', 'epic', '炖到筷子能戳穿，萝卜比肉先被抢光。', ['beef_brisket', 'radish', 'radish', 'ginger', 'garlic', 'garlic']),
  dish('ham_melon_soup', '火腿冬瓜汤', '汤', 'epic', '一片老火腿就把整锅水变成了汤。', ['ham', 'melon', 'ginger']),
  dish('matsutake_chicken', '松茸炖鸡', '汤', 'epic', '揭盖那一下，整间屋子都知道你今天买了什么。', ['matsutake', 'chicken_leg', 'ginger']),
  dish('yandu_xian', '腌笃鲜', '汤', 'epic', '咸的鲜的一起笃，笋在里面最耐心。', ['ham', 'pork_belly', 'bamboo_shoot', 'bamboo_shoot', 'tofu']),
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
 * 烹饪台只送普通菜，一级三本，九级送完 27 本。
 * 下标 0 = 烹饪台升到内部 1（界面 2 级）新给的三本。
 */
export const TABLE_UNLOCKS: RecipeId[][] = [
  ['garlic_bokchoy', 'vinegar_potato', 'egg_tofu_soup'],
  ['smashed_cucumber', 'braised_eggplant', 'tomato_tofu'],
  ['cucumber_egg', 'pepper_potato', 'onion_potato'],
  ['vinegar_cabbage', 'blistered_pepper', 'chive_egg'],
  ['corn_egg', 'stir_beans', 'onion_egg'],
  ['lettuce_salad', 'rape_tofu', 'radish_tofu'],
  ['spinach_egg_soup', 'home_tofu', 'three_fresh'],
  ['garlic_water_spinach', 'celery_dried_tofu', 'sprout_chive'],
  ['garlic_pumpkin', 'melon_kelp', 'pan_smallfish'],
];

/** 厨艺每升一级送一本高级菜。稀有菜一律不走这里。 */
export const COOK_UNLOCK_AT: Record<number, RecipeId> = {
  2: 'broccoli_garlic',
  3: 'carrot_mushroom',
  4: 'wood_ear_egg',
  5: 'yuxiang_eggplant',
  6: 'lotus_pepper',
  7: 'clam_soup',
  8: 'pepper_pork',
  9: 'bamboo_pork',
  10: 'potato_chicken',
  11: 'garlic_clam',
  12: 'bamboo_chicken',
  13: 'pan_hairtail',
  14: 'crucian_tofu',
  15: 'braised_hairtail',
};

/**
 * 油纸菜谱池。巷口和河沿只压得到蓝本，紫本要走到山坞以后才见得着。
 * 允许跨场重复，捡过的会被 remainingMarketRecipes 滤掉。
 */
export const MARKET_RECIPE_POOL: Record<MarketId, RecipeId[]> = {
  xiangko: ['mushroom_bokchoy', 'tomato_fish'],
  heyan: ['dried_tofu_pork', 'cabbage_belly', 'radish_ribs'],
  shanwu: ['yam_chestnut', 'mushroom_yam_soup', 'chestnut_duck', 'matsutake_chicken', 'yandu_xian'],
  jiangbian: [
    'garlic_shrimp', 'shrimp_egg', 'shrimp_tofu', 'ginger_crab', 'crab_tofu',
    'steam_yellowfish', 'yellowfish_tofu', 'braised_eel', 'wild_fish_soup',
  ],
  laocheng: ['braised_beef', 'ham_melon_soup', 'yandu_xian', 'radish_ribs', 'cabbage_belly', 'matsutake_chicken'],
};

export function isRecipeId(id: string): id is RecipeId {
  return RECIPES.some((r) => r.id === id);
}

export function recipeById(id: RecipeId): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
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
    have: foods.filter((it) => it.defId === id).length,
    need: n,
  }));
}

export function pickRecipeFoods(save: RecipeUnlockView, recipeId: RecipeId): RecipeFood[] {
  const foods = usableFoods(save);
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
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
