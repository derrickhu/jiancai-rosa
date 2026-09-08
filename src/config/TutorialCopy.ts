import { TutorialStep } from '@/managers/TutorialManager';

export const TUTORIAL_ASSETS = {
  hand: 'subpkg_kitchen/tutorial_hand.png',
  cabbage: 'subpkg_kitchen/tutorial_cabbage.png',
} as const;

export interface TutorialIntroPage {
  title: string;
  body: string;
}

export const TUTORIAL_INTRO: TutorialIntroPage[] = [
  {
    title: '天黑了',
    body: '菜场还在收摊。\n地上漏的菜，不捡可惜。',
  },
  {
    title: '跟我走一趟',
    body: '出门翻堆，装进篮，\n回家炒一盘。',
  },
];

export const TUTORIAL_COPY: Record<number, { title: string; body: string }> = {
  [TutorialStep.GO_OUT]: {
    title: '先出门',
    body: '厨房这扇门通菜场。\n点它，今晚去巷口。',
  },
  [TutorialStep.PICK_XIANGKO]: {
    title: '巷口最近',
    body: '点「出发」，花 1 点体力。\n别的场先别去。',
  },
  [TutorialStep.CLICK_CARD]: {
    title: '走进摊位',
    body: '脚下这张是翻摊。\n点它，进去翻剩货。',
  },
  [TutorialStep.CLICK_PILE]: {
    title: '抽一棵上来',
    body: '点遮挡堆。\n菜会落到桌上。',
  },
  [TutorialStep.TAKE_LOOT]: {
    title: '捡进篮',
    body: '桌上那棵菜苔，\n点一下就进篮。',
  },
  [TutorialStep.OPEN_BASKET]: {
    title: '看看菜篮',
    body: '顶上那颗菜篮。\n点开，我告诉你怎么装。',
  },
  [TutorialStep.BASKET_DRY]: {
    title: '干区',
    body: '浅色格子放干货。\n菜苔、豆腐这类不怕干。\n点这里看下一段。',
  },
  [TutorialStep.BASKET_WET]: {
    title: '湿区',
    body: '青格子放湿货。\n鱼、叶菜要垫湿，才不容易坏。\n点这里继续。',
  },
  [TutorialStep.CLOSE_BASKET]: {
    title: '关好篮',
    body: '记住干湿分开。\n点「关好」，回菜场接着走。',
  },
  [TutorialStep.RETURN_MAP]: {
    title: '回菜场',
    body: '点「返回菜场」。\n先别回家，路上还能再翻。',
  },
  [TutorialStep.FREE_WALK]: {
    title: '自己挑路',
    body: '脚下的卡你自己点。\n天黑或点回家，都能收摊。',
  },
  [TutorialStep.WAIT_RESULT]: {
    title: '今晚收成',
    body: '这些是带回来的菜。\n点空白，回家。',
  },
  [TutorialStep.COOK_TABLE]: {
    title: '开火',
    body: '点灶台。\n我们炒一盘菜苔。',
  },
  [TutorialStep.COOK_DISH]: {
    title: '下锅',
    body: '左边是炒菜苔。\n材料够了，点「烹饪」。',
  },
  [TutorialStep.OPEN_FRIDGE]: {
    title: '出锅了',
    body: '菜进冰箱了。\n点冰箱打开。',
  },
  [TutorialStep.INSPECT_DISH]: {
    title: '看看这盘',
    body: '点刚炒好的那份。\n别的先别动。',
  },
  [TutorialStep.SELL_DISH]: {
    title: '卖掉',
    body: '点右边「卖掉」。\n今晚第一笔钱。',
  },
  [TutorialStep.HINT_DOOR]: {
    title: '再出门',
    body: '礼金到了。\n门还在那儿，想翻就再去。',
  },
};

export const TUTORIAL_DENY = {
  default: '先点高亮那儿',
  otherMarket: '今晚先去巷口',
  otherCard: '先走这张翻摊',
  homeEarly: '先去巷口走一趟',
  pileFirst: '先抽遮挡堆',
  takeCaitai: '先把桌上的菜苔捡进篮',
  basketFirst: '先打开菜篮看一眼',
  closeBasket: '先把篮关好',
  returnMap: '先点返回菜场',
  extractEarly: '先回菜场走走，再收摊',
  goHome: '点空白回家',
  cookOnly: '这趟只炒菜苔',
  fridgeDish: '先点刚炒好的那盘',
  sellOnly: '这盘先卖掉',
  closeLater: '先按手指走完这一下',
} as const;
