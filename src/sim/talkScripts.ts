export interface TalkChoice {
  label: string;
  /** 选这项再耗几步天色。写在按钮上。 */
  steps?: number;
  /** 进篮的菜。数组就当场掷一个，别每局同一根。 */
  grantFood?: string | string[];
  grantItem?: string;
  setFlag?: string;
  gotoScene?: string;
}

export interface TalkScript {
  id: string;
  speaker: string;
  portrait: string | null;
  text: string;
  choices: TalkChoice[];
}

export const BAG_ITEM_NAME: Record<string, string> = {
  shop_key: '后厨钥匙',
};

export const TALK_SCRIPTS: Record<string, TalkScript> = {
  shanwu_woodcutter: {
    id: 'shanwu_woodcutter',
    speaker: '砍柴的',
    portrait: 'subpkg_images/npc_shanwu_vendor.png',
    text: '这担柴散了。帮我捆一下？手上有刚收的栗子，也有一把潮菌。',
    choices: [
      { label: '帮一把，换栗', steps: 1, grantFood: 'chestnut', setFlag: 'helped_woodcutter' },
      { label: '帮一把，换菌', steps: 1, grantFood: 'mushroom', setFlag: 'helped_woodcutter' },
      { label: '没工夫' },
    ],
  },
  xiangko_vendor: {
    id: 'xiangko_vendor',
    speaker: '收摊老板',
    portrait: 'subpkg_images/npc_vendor.png',
    text: '筐还没收完。帮我拢一下？葱、香菜、鸡蛋，你挑一样。',
    choices: [
      { label: '帮收筐', steps: 1, grantFood: ['scallion', 'cilantro', 'egg'], setFlag: 'helped_xiangko_vendor' },
      { label: '没工夫' },
    ],
  },
  heyan_uncle: {
    id: 'heyan_uncle',
    speaker: '刘伯',
    portrait: 'subpkg_images/npc_heyan_uncle.png',
    text: '船缆松了。帮我看一会儿？早上刚从泥里拔的，藕和空心菜都有。',
    choices: [
      { label: '帮看船', steps: 1, grantFood: ['lotus', 'water_spinach'], setFlag: 'helped_heyan_uncle' },
      { label: '没工夫' },
    ],
  },
  jiangbian_aunt: {
    id: 'jiangbian_aunt',
    speaker: '渔市阿珠',
    portrait: 'subpkg_images/npc_jiangbian_aunt.png',
    text: '这一筐还没抬上岸。搭把手？花蛤和海带，你拿一样。',
    choices: [
      { label: '帮抬筐', steps: 1, grantFood: ['clam', 'kelp'], setFlag: 'helped_jiangbian_aunt' },
      { label: '没工夫' },
    ],
  },
  laocheng_clerk: {
    id: 'laocheng_clerk',
    speaker: '账房伙计',
    portrait: 'subpkg_images/npc_laocheng_vendor.png',
    text: '账对不上。帮我核一页？这把后厨钥匙先给你，再塞你一块豆腐干。',
    choices: [
      {
        label: '帮记账',
        steps: 1,
        grantItem: 'shop_key',
        grantFood: 'dried_tofu',
        setFlag: 'helped_laocheng_clerk',
      },
      { label: '没工夫' },
    ],
  },
  laocheng_boss: {
    id: 'laocheng_boss',
    speaker: '菜行老板',
    portrait: 'subpkg_images/npc_laocheng_boss.png',
    text: '后厨不常让人进。梁上还挂着昨天的货，火腿和牛腩，你要哪样？',
    choices: [
      { label: '要一块', steps: 1, grantFood: ['ham', 'beef_brisket'], setFlag: 'met_laocheng_boss' },
      { label: '看看就走' },
    ],
  },
  guoyuan_tao: {
    id: 'guoyuan_tao',
    speaker: '阿桃',
    portrait: 'subpkg_images/npc_guoyuan_tao.png',
    text: '果筐还没拢完。帮我归一下？菠萝、苹果、苦瓜，你挑一样带走。',
    choices: [
      { label: '帮归筐', steps: 1, grantFood: ['pineapple', 'apple', 'bitter_melon'], setFlag: 'met_guoyuan_tao' },
      { label: '没工夫' },
    ],
  },
  tiantou_zhou: {
    id: 'tiantou_zhou',
    speaker: '老周',
    portrait: 'subpkg_images/npc_tiantou_zhou.png',
    text: '天快黑了，案板还没收。帮我看一会儿？丝瓜、芦笋、羊肉，你要哪样。',
    choices: [
      { label: '帮看案', steps: 1, grantFood: ['loofah', 'asparagus', 'lamb'], setFlag: 'met_tiantou_zhou' },
      { label: '没工夫' },
    ],
  },
  futou_hai: {
    id: 'futou_hai',
    speaker: '阿海',
    portrait: 'subpkg_images/npc_futou_hai.png',
    text: '潮要上来，筐还敞着。帮我盖一下？荔枝、鲈鱼、鱿鱼，你挑一样。',
    choices: [
      { label: '帮盖筐', steps: 1, grantFood: ['lychee', 'seabass', 'squid'], setFlag: 'met_futou_hai' },
      { label: '没工夫' },
    ],
  },
};

export function talkScript(id: string): TalkScript | undefined {
  return TALK_SCRIPTS[id];
}

export function bagItemName(id: string): string {
  return BAG_ITEM_NAME[id] ?? id;
}

export function pickTalkFood(grant: TalkChoice['grantFood'], rng: () => number): string | undefined {
  if (!grant) return undefined;
  const pool = Array.isArray(grant) ? grant : [grant];
  if (!pool.length) return undefined;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
