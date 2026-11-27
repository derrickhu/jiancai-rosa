import { MARKETS, type MarketId } from './destinations';
import { GOD_PICK, PICKLE_ITEM_IDS, getItem, marketFoodIds, sellPrice, type Quality } from './items';
import type { Rarity } from './rarity';

export type RecipeId =
  | 'stirfry' | 'tomato_egg' | 'scallion_tofu' | 'smashed_cucumber'
  | 'vinegar_potato' | 'garlic_bokchoy' | 'stir_beans' | 'blistered_pepper'
  | 'lettuce_salad' | 'harvard_veg_soup' | 'spinach_egg_soup' | 'celery_dried_tofu'
  | 'three_fresh' | 'melon_kelp' | 'candied_taro' | 'ants_tree'
  | 'oyster_egg' | 'stir_liver' | 'tremella_lily_soup'
  | 'vinegar_cabbage' | 'pepper_pork' | 'qianlong_cabbage'
  | 'perilla_cucumber' | 'onion_wood_ear' | 'chive_shrimp' | 'mushroom_bokchoy' | 'carrot_mushroom' | 'broccoli_garlic' | 'lotus_pepper' | 'lotus_shrimp_box' | 'yuxiang_eggplant'
  | 'wood_ear_egg' | 'clam_soup' | 'tomato_fish' | 'mixed_fish_pot' | 'pan_hairtail'
  | 'crucian_tofu' | 'potato_chicken' | 'bamboo_pork'
  | 'yam_chestnut' | 'dried_tofu_pork' | 'chestnut_duck'
  | 'yuxiang_pork' | 'spinach_ham' | 'celery_beef' | 'melon_cup'
  | 'garlic_shrimp' | 'ginger_crab' | 'steam_yellowfish' | 'braised_eel' | 'wild_fish_soup'
  | 'radish_ribs' | 'cabbage_belly' | 'braised_beef' | 'ham_melon_soup' | 'matsutake_chicken'
  | 'yandu_xian' | 'maoxuewang'
  | 'garlic_water_spinach' | 'rape_tofu' | 'corn_egg'
  | 'bitter_egg' | 'apple_ribs' | 'asparagus_lamb' | 'pear_tremella' | 'steam_bass'
  | 'pineapple_pork' | 'mango_shrimp' | 'loofah_soup' | 'braised_lamb' | 'lychee_ribs' | 'papaya_fish'
  | 'orange_wings' | 'coconut_chicken'
  | 'hawthorn_ribs' | 'pear_shrimp' | 'dragon_beef' | 'lemon_bass' | 'squid_stir' | 'pea_shrimp' | 'garlic_okra'
  | 'crispy_cucumber_egg' | 'jade_garlic_tofu' | 'sauerkraut_fish' | 'chopped_chili_fish'
  | 'chive_egg' | 'cilantro_egg' | 'onion_egg' | 'pepper_potato' | 'onion_potato'
  | 'tomato_tofu' | 'radish_tofu' | 'sprout_chive' | 'braised_eggplant' | 'garlic_pumpkin'
  | 'home_tofu' | 'garlic_clam' | 'mushroom_yam_soup' | 'shrimp_egg' | 'shrimp_tofu'
  | 'braised_hairtail' | 'bamboo_chicken' | 'yellowfish_tofu' | 'crab_tofu';

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
  /** @deprecated 吃法改走 dishEffects.RECIPE_EAT，不再写在这。 */
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
  tomato_egg_soup: 'spinach_ham',
  egg_tofu_soup: 'spinach_ham',
  spinach_egg_soup: 'spinach_ham',
  ham_melon_soup: 'melon_cup',
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
const XP_BASE: Record<Rarity, number> = { common: 3, rare: 8, epic: 16, legendary: 28 };
const XP_PER_PORTION: Record<Rarity, number> = { common: 1.5, rare: 2.5, epic: 4, legendary: 5.5 };
const COOK_MUL: Record<Rarity, number> = { common: 1.6, rare: 1.9, epic: 2.2, legendary: 2.6 };

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
  dish('stirfry', '炒菜苔', '家常', 'common', '细秆进锅，花还在。只吃菜苔，别的绿叶子一棵不动。', ['caitai']),
  dish('tomato_egg', '番茄炒蛋', '家常', 'common', '中式厨房的起手式。红黄一碰，连外卖都要让路。', ['tomato', 'egg', 'egg']),
  dish('scallion_tofu', '小葱拌豆腐', '凉菜', 'common', '不用开火，一清二白，端上桌全靠那把葱花。', ['scallion', 'tofu']),
  dish('smashed_cucumber', '凉拌黄瓜', '凉菜', 'rare', '不用开火。拍一下，蒜和香菜负责像一盘菜。', ['cucumber', 'garlic', 'cilantro']),
  dish('vinegar_potato', '清炒土豆丝', '家常', 'common', '切丝是玩家脑内完成的，锅里只见两块变一盘。', ['potato', 'potato']),
  dish('garlic_bokchoy', '蒜蓉小白菜', '家常', 'common', '蒜末一响，小白菜就肯软下来。两棵才够一盘。', ['bokchoy', 'bokchoy', 'garlic']),
  dish('vinegar_cabbage', '醋溜白菜', '家常', 'common', '外帮也能炒，酸一下才像晚饭。', ['cabbage', 'ginger']),
  dish('qianlong_cabbage', '乾隆白菜', '家常', 'rare', '一棵白菜进锅，汤色清白，端上来像有人会过日子。', ['cabbage']),
  dish('stir_beans', '素炒豆角', '家常', 'rare', '一把绿筷子过热锅，比干煸省事。', ['greenbean', 'garlic']),
  dish('blistered_pepper', '虎皮青椒', '家常', 'common', '皮起泡才算数，蒜是收尾。', ['pepper', 'pepper', 'garlic']),
  dish('spinach_egg_soup', '菠菜蛋花汤', '汤', 'common', '红根还可以留，汤绿了就算成功。', ['spinach', 'egg']),
  dish('celery_dried_tofu', '芹菜香干', '家常', 'common', '俩都耐造，适合冰箱快满时清位。香干得切够两块。', ['celery', 'dried_tofu', 'dried_tofu']),
  dish('three_fresh', '地三鲜', '家常', 'common', '东北家常的三兄弟，占格不小。', ['potato', 'eggplant', 'pepper']),
  dish('melon_kelp', '冬瓜海带汤', '汤', 'common', '两块湿咸，夏天最肯进嘴。', ['melon', 'kelp']),
  dish('lettuce_salad', '生菜沙拉', '凉菜', 'common', '整棵脑袋撕开，番茄和黄瓜负责像一盘西餐。', ['lettuce', 'tomato', 'cucumber']),
  dish('harvard_veg_soup', '哈佛蔬菜汤', '汤', 'rare', '名字唬人，其实就是卷心菜洋葱胡萝卜南瓜一锅炖。', ['round_cabbage', 'onion', 'carrot', 'pumpkin']),
  dish('candied_taro', '拔丝芋头', '家常', 'common', '两块芋头，糖在玩家脑内完成，出锅还能拉丝。', ['taro', 'taro']),
  dish('ants_tree', '蚂蚁上树', '荤', 'rare', '粉丝是树，肉末是蚁，一盘里挤满了故事。', ['vermicelli', 'pork', 'pork']),
  dish('garlic_water_spinach', '蒜蓉空心菜', '家常', 'rare', '空心管烫软，两棵才够一盘，蒜末负责出声。', ['water_spinach', 'water_spinach', 'garlic']),
  dish('rape_tofu', '油菜豆腐', '家常', 'rare', '油亮小棵配白豆腐，汤色清白才像晚饭。', ['rapeseed', 'tofu']),
  dish('corn_egg', '玉米炒蛋', '家常', 'rare', '金钉子撞上金窝，一盘里全是黄。', ['corn', 'egg', 'egg']),
  dish('oyster_egg', '蚝仔煎', '水产', 'rare', '壳里的人下了蛋，金黄把腥按住。', ['oyster', 'egg', 'egg']),
  dish('stir_liver', '小炒猪肝', '荤', 'common', '火要大，肝要嫩，青椒负责叫。', ['pork_liver', 'pepper', 'garlic']),
  dish('pepper_pork', '青椒炒肉', '荤', 'common', '肉摊开门第一道，姜负责去腥。', ['pork', 'pork', 'pepper', 'pepper', 'ginger']),
  dish('tremella_lily_soup', '银耳百合莲子汤', '汤', 'epic', '四样干货泡开，汤才肯白，枸杞负责像有人懂。', ['tremella', 'lily', 'lotus_seed', 'goji']),

  // ── 良品（绿）：开始要绿货，或者要成把地放 ──────────────────
  dish('perilla_cucumber', '紫苏黄瓜', '家常', 'rare', '湘味热锅。黄瓜片煎黄，紫苏叶和朝天椒一起香起来。', ['perilla', 'cucumber', 'bird_chili']),
  dish('onion_wood_ear', '洋葱拌木耳', '凉菜', 'rare', '不用开火。木耳泡开，洋葱一拌，黑白脆。', ['onion', 'wood_ear', 'wood_ear']),
  dish('chive_shrimp', '韭菜炒河虾', '水产', 'rare', '青的香，灰的弹，桥头水边才配这盘。', ['chive', 'river_shrimp', 'river_shrimp']),
  dish('mushroom_bokchoy', '香菇青菜', '家常', 'common', '鲜菇配最常见的叶子，不靠鸡汤。菇得放够两朵。', ['mushroom', 'mushroom', 'bokchoy', 'bokchoy']),
  dish('carrot_mushroom', '胡萝卜炒香菇', '家常', 'rare', '橙和褐，素炒里最像「加了荤」。', ['mushroom', 'mushroom', 'carrot', 'carrot']),
  dish('broccoli_garlic', '素炒西兰花', '家常', 'rare', '认市场货，不认西餐厅。蒜要两头才压得住。', ['broccoli', 'garlic', 'garlic']),
  dish('lotus_pepper', '莲藕炒青椒', '家常', 'rare', '孔还在，青椒负责颜色。', ['lotus', 'lotus', 'pepper']),
  dish('lotus_shrimp_box', '虾滑藕盒', '荤', 'epic', '两片藕夹住虾滑，孔里也塞满，炸一炸才响。', ['lotus', 'lotus', 'river_shrimp']),
  dish('yuxiang_eggplant', '鱼香茄子', '家常', 'rare', '没有肉末也叫鱼香，姜蒜把故事讲完。', ['eggplant', 'eggplant', 'garlic', 'garlic', 'ginger']),
  dish('wood_ear_egg', '木耳炒蛋', '家常', 'rare', '黑白分明，脆的那半是木耳在负责。', ['wood_ear', 'wood_ear', 'egg', 'egg']),
  dish('clam_soup', '姜汤花蛤', '汤', 'rare', '吐沙在玩家脑内完成，姜负责安心。三只才听得见响。', ['clam', 'clam', 'clam', 'ginger']),
  dish('tomato_fish', '番茄小鱼', '水产', 'common', '酸甜兜住小鱼，比清蒸省事。', ['smallfish', 'smallfish', 'tomato', 'tomato']),
  dish('mixed_fish_pot', '杂鱼锅', '汤', 'rare', '什么鱼都肯下。小鱼两条，再加一条土鲫，姜把腥按住。', ['smallfish', 'smallfish', 'crucian', 'ginger']),
  dish('pan_hairtail', '干煎带鱼', '水产', 'rare', '银腰带下锅，姜蒜是边角料。', ['hairtail', 'ginger', 'garlic']),
  dish('crucian_tofu', '鲫鱼豆腐汤', '汤', 'rare', '土鲫认汤，不认红烧。', ['crucian', 'tofu', 'ginger']),
  dish('potato_chicken', '土豆烧鸡腿', '荤', 'rare', '一只带骨的，两块泥里的，炖到软。', ['chicken_leg', 'potato', 'potato']),
  dish('bamboo_pork', '春笋炒肉', '荤', 'rare', '笋比肉贵的那一个月，才配这么炒。', ['bamboo_shoot', 'bamboo_shoot', 'pork']),
  dish('yam_chestnut', '板栗山药煲', '家常', 'rare', '两样都粉，一锅炖到互相分不清。', ['yam', 'yam', 'chestnut', 'chestnut', 'chestnut']),
  dish('dried_tofu_pork', '香干回锅肉', '荤', 'rare', '肉先煸出油，香干再进去抢。', ['pork', 'pork', 'dried_tofu', 'dried_tofu', 'pepper']),
  dish('chestnut_duck', '板栗烧鸭', '荤', 'rare', '鸭油裹住栗子，八角负责出香。', ['duck_leg', 'chestnut', 'chestnut', 'chestnut', 'ginger', 'star_anise']),
  dish('yuxiang_pork', '鱼香肉丝', '荤', 'rare', '胡萝卜木耳青椒跟肉丝一起响，鱼香在酱里。', ['carrot', 'wood_ear', 'pepper', 'pork']),
  dish('spinach_ham', '上汤菠菜', '汤', 'rare', '皮蛋和火腿把一锅水变成汤，菠菜最后下。', ['spinach', 'century_egg', 'ham']),
  dish('celery_beef', '芹菜炒牛肉', '荤', 'epic', '芹菜秆还脆，牛肉条刚断生。', ['celery', 'beef']),
  dish('melon_cup', '冬瓜盅', '汤', 'legendary', '挖空的冬瓜盛着干贝虾菇，枸杞点在面上。', ['melon', 'dried_scallop', 'shrimp', 'mushroom', 'pork', 'goji']),

  // ── 上品（蓝）：非得攒蓝货不可，一盘顶一天 ──────────────────
  dish('garlic_shrimp', '蒜蓉虾', '水产', 'epic', '蒜末噼啪一响，三只虾就同意被你卖掉。', ['shrimp', 'shrimp', 'shrimp', 'garlic', 'garlic']),
  dish('ginger_crab', '葱姜炒蟹', '水产', 'legendary', '钳子还在挥，葱姜负责把它按住。', ['crab', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('steam_yellowfish', '清蒸黄鱼', '水产', 'epic', '金灿灿一条，姜片比酱料诚实。', ['yellowfish', 'ginger', 'ginger', 'scallion', 'scallion']),
  dish('braised_eel', '红烧河鳗', '水产', 'epic', '整条不切段，酱色收到发亮才算数。', ['river_eel', 'garlic', 'garlic', 'garlic', 'ginger', 'scallion']),
  dish('wild_fish_soup', '野生黄鱼汤', '汤', 'epic', '奶白一锅，喝的人不说话，只顾着喝。', ['wild_yellowfish', 'tofu', 'ginger', 'scallion']),
  dish('radish_ribs', '萝卜炖排骨', '荤', 'epic', '白萝卜吸骨头，厨房会香一夜。', ['ribs', 'radish', 'radish', 'ginger']),
  dish('cabbage_belly', '白菜烧五花', '荤', 'epic', '层层白菜包住肥瘦，是冬天的晚饭。', ['pork_belly', 'cabbage', 'ginger', 'garlic']),
  dish('braised_beef', '红烧牛腩', '荤', 'epic', '炖到筷子能戳穿，萝卜比肉先被抢光。', ['beef_brisket', 'radish', 'radish', 'ginger', 'garlic', 'garlic', 'star_anise']),
  dish('ham_melon_soup', '火腿冬瓜汤', '汤', 'epic', '一片老火腿就把整锅水变成了汤。', ['ham', 'melon', 'ginger']),
  dish('matsutake_chicken', '松茸炖鸡', '汤', 'legendary', '揭盖那一下，整间屋子都知道你今天买了什么。', ['matsutake', 'chicken_leg', 'ginger']),
  dish('yandu_xian', '腌笃鲜', '汤', 'legendary', '咸的鲜的一起笃，笋在里面最耐心。', ['ham', 'pork_belly', 'bamboo_shoot', 'bamboo_shoot', 'tofu']),
  dish('maoxuewang', '毛血旺', '荤', 'epic', '一锅红，干辣椒和花椒负责叫醒。', ['duck_blood', 'duck_blood', 'sprout', 'pork', 'garlic', 'dried_chili', 'peppercorn']),

  dish('bitter_egg', '苦瓜炒蛋', '家常', 'rare', '苦收在蛋里，两只蛋才盖得住。', ['bitter_melon', 'egg', 'egg']),
  dish('apple_ribs', '苹果焖排', '荤', 'epic', '苹果把排骨的油吸走，姜负责收尾。', ['apple', 'ribs', 'ginger']),
  dish('asparagus_lamb', '芦笋羊肉', '荤', 'epic', '绿矛还脆，羊肉刚断生。', ['asparagus', 'lamb', 'garlic']),
  dish('pear_tremella', '雪梨银耳羹', '汤', 'epic', '雪梨把银耳炖开，枸杞点在面上。', ['pear', 'tremella', 'goji']),
  dish('steam_bass', '清蒸鲈鱼', '水产', 'epic', '银鳞一条，葱姜比酱诚实。', ['seabass', 'ginger', 'scallion', 'scallion']),
  dish('pineapple_pork', '菠萝咕咾肉', '荤', 'epic', '菠萝和五花一起响，青椒负责颜色。', ['pineapple', 'pork_belly', 'pepper']),
  dish('mango_shrimp', '芒果炒虾', '水产', 'epic', '金黄撞上红虾，两只才够一盘。', ['mango', 'shrimp', 'shrimp']),
  dish('loofah_soup', '丝瓜蛋汤', '汤', 'rare', '丝瓜一软，蛋花才肯散开。', ['loofah', 'egg', 'scallion']),
  dish('braised_lamb', '红烧羊肉', '荤', 'epic', '两块羊肉，姜蒜把膻按住。', ['lamb', 'lamb', 'ginger', 'garlic']),
  dish('lychee_ribs', '荔枝排骨', '荤', 'epic', '红壳的甜裹住排骨，姜负责不腻。', ['lychee', 'ribs', 'ginger']),
  dish('papaya_fish', '木瓜鲫鱼汤', '汤', 'epic', '木瓜把土鲫的腥按住，姜在锅边。', ['papaya', 'crucian', 'ginger']),
  dish('orange_wings', '橙香鸡翅', '荤', 'epic', '鲜橙先到手。翅膀摊上没有，靠街坊或抽谱。', ['orange', 'chicken_wing', 'chicken_wing']),
  dish('coconut_chicken', '椰子鸡', '荤', 'epic', '椰子刚在埠头开，鸡腿是老相识。', ['coconut', 'chicken_leg', 'ginger']),
  dish('hawthorn_ribs', '山楂焖排', '荤', 'epic', '山楂收油，萝卜垫底。', ['hawthorn', 'ribs', 'radish']),
  dish('pear_shrimp', '雪梨虾仁', '水产', 'epic', '雪梨的清盖住虾的甜。', ['pear', 'shrimp', 'goji']),
  dish('dragon_beef', '火龙果牛肉', '荤', 'legendary', '粉皮和红肉一起下锅，青椒负责叫。', ['dragonfruit', 'beef', 'pepper']),
  dish('lemon_bass', '柠檬蒸鲈鱼', '水产', 'epic', '柠檬片压在银鳞上，葱还在。', ['lemon', 'seabass', 'scallion']),
  dish('squid_stir', '爆炒鱿鱼', '水产', 'legendary', '一整只卷起来，蒜姜青椒一起响。', ['squid', 'garlic', 'pepper', 'ginger']),
  dish('pea_shrimp', '豌豆虾仁', '水产', 'epic', '绿荚和红虾，蒜是收尾。', ['pea', 'shrimp', 'garlic']),
  dish('garlic_okra', '蒜蓉秋葵', '家常', 'rare', '两头蒜才压得住那点黏。', ['okra', 'garlic', 'garlic']),

  // ── 老坛私房菜：首坛开盖解锁，把平价鲜菜熬成高溢价招牌 ────────
  dish('crispy_cucumber_egg', '脆瓜炒蛋', '家常', 'rare', '脆腌黄瓜丁撞进热油蛋花里，嚼得满屋咔嚓响。', ['pickled_cucumber', 'egg', 'egg']),
  dish('jade_garlic_tofu', '翡翠蒜烧豆腐', '家常', 'epic', '焦黄豆腐吸饱浓汁，顶上几瓣翡翠蒜酸甜解腻。', ['pickled_garlic', 'tofu', 'tofu']),
  dish('sauerkraut_fish', '老坛酸菜鱼', '水产', 'epic', '金汤滚白鱼，老坛酸菜把小杂鱼捧成了镇店大菜。', ['pickled_greens', 'smallfish', 'smallfish']),
  dish('chopped_chili_fish', '剁椒蒸鲜鱼', '水产', 'legendary', '红亮剁椒盖满整条鲜鱼，热油一泼，白米饭自己往碗里跑。', ['pickled_chili', 'crucian', 'tofu']),

  // ── 秘传抽谱池：分档家常 / 河海 / 镇席名菜 ────────────────────
  dish('chive_egg', '韭菜炒蛋', '家常', 'common', '头刀春韭切碎撞进蛋液，锅边一圈焦香最下饭。', ['chive', 'egg', 'egg']),
  dish('cilantro_egg', '香菜炒蛋', '家常', 'common', '爱它的人连汤汁都不剩，金黄里裹着满屋清香。', ['cilantro', 'egg', 'egg']),
  dish('onion_egg', '洋葱炒蛋', '家常', 'common', '紫皮洋葱煸出甜水，蛋花蓬松兜住甜香。', ['onion', 'egg', 'egg']),
  dish('pepper_potato', '青椒土豆丝', '家常', 'common', '青椒断生、土豆丝脆爽，大火快颠十秒出锅。', ['pepper', 'potato', 'potato']),
  dish('onion_potato', '洋葱炒土豆', '家常', 'common', '土豆片煎出金边，洋葱丝把焦香全裹在盘底。', ['onion', 'potato', 'potato']),
  dish('tomato_tofu', '番茄烧豆腐', '家常', 'common', '红沙番茄熬出浓汁，白豆腐咕嘟咕嘟吸饱酸甜。', ['tomato', 'tofu', 'tofu']),
  dish('radish_tofu', '萝卜炖豆腐', '汤', 'common', '白萝卜清甜配嫩豆腐，热乎乎一碗顺气暖胃。', ['radish', 'tofu']),
  dish('sprout_chive', '韭菜炒豆芽', '家常', 'common', '银芽配绿韭，旺火一兜脆生生端上桌。', ['sprout', 'chive']),
  dish('braised_eggplant', '蒜香烧茄子', '家常', 'rare', '紫茄滚刀吸满浓油赤酱，出锅前撒一把生蒜末。', ['eggplant', 'eggplant', 'garlic']),
  dish('garlic_pumpkin', '蒜香南瓜', '家常', 'rare', '粉糯老南瓜焖出金沙边，蒜香裹着回甜。', ['pumpkin', 'garlic']),
  dish('home_tofu', '家常烧豆腐', '家常', 'rare', '两面煎黄的老豆腐配木耳青椒，芡汁亮晶晶挂满。', ['tofu', 'pepper', 'wood_ear']),
  dish('garlic_clam', '蒜蓉花蛤', '水产', 'rare', '金银蒜末铺底猛火焗开，壳一张嘴鲜汁四溢。', ['clam', 'clam', 'garlic']),
  dish('mushroom_yam_soup', '香菇山药汤', '汤', 'rare', '鲜菇吊出醇汤，铁棍山药炖到绵软起沙。', ['mushroom', 'yam']),
  dish('shrimp_egg', '虾仁滑蛋', '水产', 'rare', '粉红大虾仁卧在半凝固的滑嫩蛋浪里。', ['shrimp', 'egg', 'egg']),
  dish('shrimp_tofu', '虾仁蒸豆腐', '水产', 'rare', '玉白豆腐托着鲜弹虾仁，淋一勺豉油鲜掉眉毛。', ['shrimp', 'tofu']),
  dish('braised_hairtail', '红烧带鱼', '水产', 'epic', '宽油煎定银鳞，葱姜浓汁慢收，连鱼骨都酥香。', ['hairtail', 'ginger', 'scallion']),
  dish('bamboo_chicken', '春笋炖鸡', '荤', 'epic', '雨后嫩春笋吸尽鸡汤金油，山野鲜气扑面而来。', ['bamboo_shoot', 'chicken_leg']),
  dish('yellowfish_tofu', '黄鱼炖豆腐', '水产', 'epic', '金鳞黄鱼慢煨成奶白浓汤，千滚豆腐嫩如凝脂。', ['yellowfish', 'tofu']),
  dish('crab_tofu', '蟹黄豆腐', '水产', 'legendary', '澄黄蟹膏熬化进热油，每一块嫩豆腐都裹着金沙。', ['crab', 'tofu', 'tofu']),
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

export const PICKLE_RECIPE_IDS: readonly RecipeId[] = [
  'crispy_cucumber_egg',
  'jade_garlic_tofu',
  'sauerkraut_fish',
  'chopped_chili_fish',
];

/** 还留在表里，图鉴 / 菜谱本 / 下锅都不露。 */
export const HIDDEN_RECIPE_IDS: ReadonlySet<RecipeId> = new Set([
  'smashed_cucumber',
  'stir_beans',
  'ants_tree',
  'garlic_water_spinach',
  'rape_tofu',
  'corn_egg',
  'garlic_bokchoy',
  'qianlong_cabbage',
  'carrot_mushroom',
  'lotus_pepper',
  'pepper_pork',
  'vinegar_cabbage',
  'blistered_pepper',
  'celery_dried_tofu',
  'onion_wood_ear',
  'yuxiang_eggplant',
  'wood_ear_egg',
  'bamboo_pork',
  'spinach_egg_soup',
  'ham_melon_soup',
  'wild_fish_soup',
  'hawthorn_ribs',
  'squid_stir',
  'chive_egg',
  'cilantro_egg',
  'onion_egg',
  'pepper_potato',
  'onion_potato',
  'tomato_tofu',
  'radish_tofu',
  'sprout_chive',
  'braised_eggplant',
  'garlic_pumpkin',
  'home_tofu',
  'garlic_clam',
  'mushroom_yam_soup',
  'shrimp_egg',
  'shrimp_tofu',
  'braised_hairtail',
  'bamboo_chicken',
  'yellowfish_tofu',
  'crab_tofu',
  ...PICKLE_RECIPE_IDS,
]);

export function listedRecipes(
  recipes: readonly RecipeDef[] = RECIPES,
  found: readonly RecipeId[] = [],
): RecipeDef[] {
  return recipes.filter((r) => !HIDDEN_RECIPE_IDS.has(r.id) || found.includes(r.id));
}

/**
 * 烹饪台每次升一级只送 1 本。门槛见 kitchen FURN_COOK_NEED.table。
 */
export const TABLE_UNLOCKS: RecipeId[][] = [
  ['vinegar_potato'],
  ['three_fresh'],
  ['lettuce_salad'],
  ['candied_taro'],
  ['harvard_veg_soup'],
  ['oyster_egg'],
  ['lotus_shrimp_box'],
  ['celery_beef'],
  ['tremella_lily_soup'],
  [],
  ['orange_wings'],
  [],
  ['coconut_chicken'],
];

/** 厨艺升级送礼。3/5/7/9 空着，良品主料还没出。 */
export type CookUnlockGrant = RecipeId | readonly RecipeId[];

export const COOK_UNLOCK_AT: Record<number, CookUnlockGrant> = {
  2: 'broccoli_garlic',
  4: 'perilla_cucumber',
  6: 'clam_soup',
  8: 'crucian_tofu',
  10: 'potato_chicken',
  11: 'yuxiang_pork',
  12: 'radish_ribs',
  13: 'steam_yellowfish',
  14: 'matsutake_chicken',
  15: 'maoxuewang',
  16: 'bitter_egg',
  17: 'pear_shrimp',
  18: 'apple_ribs',
  19: 'garlic_okra',
  20: 'asparagus_lamb',
  21: 'pea_shrimp',
  22: 'pear_tremella',
  23: 'lemon_bass',
  24: 'steam_bass',
  25: 'dragon_beef',
};

export function cookUnlocksAt(level: number): RecipeId[] {
  const row = COOK_UNLOCK_AT[level];
  if (!row) return [];
  return typeof row === 'string' ? [row] : [...row];
}

/**
 * 油纸菜谱池。各场不重复；捡过的会被 remainingMarketRecipes 滤掉。
 */
export const MARKET_RECIPE_POOL: Record<MarketId, RecipeId[]> = {
  xiangko: ['mushroom_bokchoy'],
  heyan: ['tomato_fish', 'melon_kelp'],
  qiaotou: ['chive_shrimp', 'stir_liver'],
  shanwu: ['yam_chestnut', 'chestnut_duck'],
  jiangbian: ['mixed_fish_pot', 'pan_hairtail'],
  nanshi: ['dried_tofu_pork', 'spinach_ham'],
  laocheng: ['cabbage_belly', 'braised_beef'],
  dukou: ['garlic_shrimp', 'braised_eel'],
  shanzhen: ['ginger_crab', 'melon_cup', 'yandu_xian'],
  guoyuan: ['pineapple_pork', 'mango_shrimp'],
  tiantou: ['loofah_soup', 'braised_lamb'],
  futou: ['lychee_ribs', 'papaya_fish'],
};

export function isRecipeId(id: string): id is RecipeId {
  return RECIPES.some((r) => r.id === id);
}

export function recipeById(id: RecipeId): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** 只给体力类效果用。其它吃法返回 0，但菜仍然能吃。 */
export function recipeEatStamina(recipe: RecipeDef): number {
  if (recipe.eat?.stamina && recipe.eat.stamina > 0) return Math.floor(recipe.eat.stamina);
  return 0;
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

/** 固定特调菜谱的内部灶台等级门槛（0 对应界面 1 级灶台，依此类推）。 */
const SPECIAL_RECIPE_MIN_TABLE: Partial<Record<RecipeId, number>> = {
  crispy_cucumber_egg: 3, // 4级灶台
  jade_garlic_tofu: 5,    // 6级灶台
  sauerkraut_fish: 6,     // 7级灶台
  chopped_chili_fish: 9,  // 10级灶台
  wild_fish_soup: 6,      // 7级灶台
};

const _ingMinMarketLevelCache = new Map<string, number>();
function ingredientMinMarketUnlockLevel(defId: string): number {
  const hit = _ingMinMarketLevelCache.get(defId);
  if (hit !== undefined) return hit;
  if (defId === GOD_PICK.id) {
    _ingMinMarketLevelCache.set(defId, 9);
    return 9;
  }
  if (PICKLE_ITEM_IDS.has(defId)) {
    _ingMinMarketLevelCache.set(defId, 5);
    return 5;
  }
  if (defId === 'chicken_wing') {
    _ingMinMarketLevelCache.set(defId, 16);
    return 16;
  }
  let best = 99;
  for (const m of MARKETS) {
    if (marketFoodIds(m.id).includes(defId)) {
      if (m.unlockLevel < best) best = m.unlockLevel;
    }
  }
  const resolved = best === 99 ? 1 : best;
  _ingMinMarketLevelCache.set(defId, resolved);
  return resolved;
}

/** 将主料所属菜场解锁厨艺等级映射为基础内部灶台等级（严格不超过该厨艺等级可升到的灶台上限）。 */
function baseTableLevelFromMarketUnlock(unlockLv: number): number {
  if (unlockLv <= 1) return 0;  // 巷口 → 1级灶台
  if (unlockLv <= 3) return 1;  // 河沿 → 2级灶台
  if (unlockLv <= 5) return 2;  // 桥头 → 3级灶台
  if (unlockLv <= 7) return 4;  // 山坞 → 5级灶台
  if (unlockLv <= 9) return 5;  // 江边 → 6级灶台
  if (unlockLv <= 11) return 6; // 南市 → 7级灶台
  if (unlockLv <= 12) return 7; // 老城 → 8级灶台
  if (unlockLv <= 13) return 8; // 渡口 → 9级灶台
  if (unlockLv <= 14) return 8; // 山珍 → 9级灶台
  if (unlockLv <= 16) return 9; // 果园 → 10级灶台
  if (unlockLv <= 19) return 10; // 田头 → 11级灶台
  return 11;                    // 埠头 → 12级灶台
}

const RARITY_MIN_TABLE: Record<Rarity, number> = {
  common: 0,    // 最低 1 级灶台
  rare: 1,      // 最低 2 级灶台（1级初始煤气灶需先升1次才能炒良品菜）
  epic: 5,      // 最低 6 级灶台（精装屋岛台灶）
  legendary: 8, // 最低 9 级灶台（雅致屋大理石岛台及以上）
};

const _recipeMinTableCache = new Map<RecipeId, number>();

/**
 * 菜谱开火所需的内部烹饪台等级（0–13，对应界面显示 Lv.1–Lv.14）：
 * - 开局 3 道家常菜恒为 0（1 级灶台直接可做）；
 * - 随烹饪台升级附赠的 TABLE_UNLOCKS[i] 精确对齐为 i+1（升到该级必能立即开炒）；
 * - 其余菜谱（厨艺领悟 / 菜场拾取 / 寻味盲盒 / 老坛秘方）按「品阶保底 + 主料菜场阶段」自动推导，
 *   且对 COOK_UNLOCK_AT 在低厨艺等级赠送的菜做上限保护，确保玩家在当前厨艺下能通过升级灶台解锁。
 */
export function recipeMinTableLevel(id: RecipeId): number {
  const cached = _recipeMinTableCache.get(id);
  if (cached !== undefined) return cached;

  let res = 0;
  if (START_RECIPES.includes(id)) {
    res = 0;
  } else if (SPECIAL_RECIPE_MIN_TABLE[id] !== undefined) {
    res = SPECIAL_RECIPE_MIN_TABLE[id]!;
  } else {
    let tableGrantIdx = -1;
    for (let i = 0; i < TABLE_UNLOCKS.length; i++) {
      if (TABLE_UNLOCKS[i].includes(id)) {
        tableGrantIdx = i;
        break;
      }
    }
    if (tableGrantIdx >= 0) {
      res = tableGrantIdx + 1;
    } else {
      const rec = recipeById(id);
      if (rec) {
        const maxMktLv = rec.needs.reduce(
          (mx, fid) => Math.max(mx, ingredientMinMarketUnlockLevel(fid)),
          1,
        );
        let base = Math.max(RARITY_MIN_TABLE[rec.rarity], baseTableLevelFromMarketUnlock(maxMktLv));
        if (rec.rarity === 'legendary' && maxMktLv >= 22) {
          base = Math.max(base, 11); // 埠头终局珍品（火龙果牛肉、爆炒鱿鱼）需 12 级灶台
        }
        // 若为厨艺升级赠送菜谱，确保所需灶台不超过该厨艺等级可升到的灶台上限
        for (const [lvStr, grant] of Object.entries(COOK_UNLOCK_AT)) {
          const list = typeof grant === 'string' ? [grant] : grant;
          if (list.includes(id)) {
            const cookLv = Number(lvStr);
            const reachableCap = cookLv <= 2 ? 1
              : cookLv === 3 ? 2
              : cookLv === 4 ? 3
              : cookLv <= 6 ? 4
              : cookLv <= 8 ? 5
              : cookLv <= 10 ? 6
              : cookLv === 11 ? 7
              : cookLv === 12 ? 8
              : cookLv <= 15 ? 9
              : cookLv <= 17 ? 10
              : cookLv <= 19 ? 11
              : cookLv <= 21 ? 12
              : 13;
            base = Math.min(base, reachableCap);
            break;
          }
        }
        res = Math.max(0, Math.min(13, base));
      }
    }
  }

  _recipeMinTableCache.set(id, res);
  return res;
}

/** 菜谱开火所需的界面显示灶台等级（1–14 级）。 */
export function recipeMinStoveLv(id: RecipeId): number {
  return recipeMinTableLevel(id) + 1;
}

/** 当前灶台等级是否已满足该菜谱的开火要求。 */
export function isRecipeStoveReady(
  save: Pick<RecipeUnlockView, 'tableLevel'>,
  id: RecipeId,
): boolean {
  const cur = Math.max(0, Math.floor(save.tableLevel || 0));
  return cur >= recipeMinTableLevel(id);
}

export function isRecipeUnlocked(save: RecipeUnlockView, id: RecipeId): boolean {
  if (save.recipesFound.includes(id)) return true;
  if (HIDDEN_RECIPE_IDS.has(id)) return false;
  if (START_RECIPES.includes(id)) return true;
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

/** 已获得菜谱 且 当前烹饪台等级已满足开火条件的菜谱列表。 */
export function cookableUnlockedRecipes(save: RecipeUnlockView): RecipeDef[] {
  return RECIPES.filter((r) => isRecipeUnlocked(save, r.id) && isRecipeStoveReady(save, r.id));
}

/**
 * 烹饪台从 fromTableLevel 升到 toTableLevel 后新增可开火的菜谱：
 * 包含随台新赠的 TABLE_UNLOCKS，以及玩家此前已抽到/捡到但因灶台不足被锁住的藏谱。
 */
export function newlyCookableByTableUpgrade(
  save: RecipeUnlockView,
  fromTableLevel: number,
  toTableLevel = fromTableLevel + 1,
): RecipeDef[] {
  const beforeView: RecipeUnlockView = { ...save, tableLevel: fromTableLevel };
  const afterView: RecipeUnlockView = { ...save, tableLevel: toTableLevel };
  return RECIPES.filter((r) => {
    const canBefore = isRecipeUnlocked(beforeView, r.id) && isRecipeStoveReady(beforeView, r.id);
    const canAfter = isRecipeUnlocked(afterView, r.id) && isRecipeStoveReady(afterView, r.id);
    return !canBefore && canAfter && !HIDDEN_RECIPE_IDS.has(r.id)
      || (!canBefore && canAfter && save.recipesFound.includes(r.id));
  });
}

/**
 * 已解锁且当前（或仅差 1 级灶台）可做的菜谱食材集合。
 * 菜场摊位掉率加权仅看此集合，避免过早抽到的高阶锁谱稀释眼下能做的食材。
 */
export function unlockedIngredients(save: RecipeUnlockView): Set<string> {
  const curTable = Math.max(0, Math.floor(save.tableLevel || 0));
  const out = new Set<string>();
  for (const r of unlockedRecipes(save)) {
    if (recipeMinTableLevel(r.id) <= curTable + 1) {
      for (const id of r.needs) out.add(id);
    }
  }
  if (out.size === 0) {
    for (const sid of START_RECIPES) {
      const sr = recipeById(sid);
      if (sr) for (const id of sr.needs) out.add(id);
    }
  }
  return out;
}

export function remainingMarketRecipes(marketId: MarketId, found: RecipeId[]): RecipeId[] {
  const have = new Set(found);
  return MARKET_RECIPE_POOL[marketId].filter((id) => !have.has(id));
}

function foodQty(it: RecipeFood): number {
  const raw = it.qty ?? 1;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function usableFoods(save: RecipeUnlockView): RecipeFood[] {
  return save.fridge.filter((it) => it.kind !== 'dish' && it.quality !== 'rotten' && foodQty(it) > 0);
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

/** 按格扣料，不按 uid 合并。旧档里几格共用一个 uid 时，合并会把 8 份收成 1 份，页面上够、下锅不够。 */
export function pickRecipeFoods(save: RecipeUnlockView, recipeId: RecipeId): RecipeFood[] {
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
  const pool = usableFoods(save).map((it) => ({ it, left: foodQty(it) }));
  const picked: RecipeFood[] = [];
  for (const id of recipe.needs) {
    const hit = pool
      .filter((row) => row.it.defId === id && row.left > 0)
      .sort((a, b) => b.it.freshness - a.it.freshness)[0];
    if (!hit) return [];
    hit.left -= 1;
    picked.push({ ...hit.it, qty: 1 });
  }
  return picked;
}

export function recipeCanCook(save: RecipeUnlockView, recipeId: RecipeId): boolean {
  return isRecipeUnlocked(save, recipeId)
    && isRecipeStoveReady(save, recipeId)
    && pickRecipeFoods(save, recipeId).length > 0;
}

/** 按冰箱现有份数，这道菜现在能连做几份（灶台等级未达标时为 0）。材料共用时各自独立算。 */
export function recipeCookCount(save: RecipeUnlockView, recipeId: RecipeId): number {
  if (!isRecipeUnlocked(save, recipeId) || !isRecipeStoveReady(save, recipeId)) return 0;
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
