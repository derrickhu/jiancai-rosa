import { TutorialStep } from '@/managers/TutorialManager';

export const TUTORIAL_ASSETS = {
  hand: 'subpkg_kitchen/tutorial_hand.png',
  cabbage: 'subpkg_kitchen/tutorial_cabbage.png',
  paper: 'subpkg_kitchen/tutorial_paper.png',
  intro1: 'subpkg_kitchen/tutorial_intro_1.jpg',
  intro2: 'subpkg_kitchen/tutorial_intro_2.jpg',
} as const;

export interface TutorialIntroPage {
  image: string;
  title: string;
  body: string;
  button: string;
}

export const TUTORIAL_INTRO: TutorialIntroPage[] = [
  {
    image: TUTORIAL_ASSETS.intro1,
    title: '天黑了',
    body: '菜场还在收摊。\n地上漏的菜，不捡可惜。',
    button: '下一页',
  },
  {
    image: TUTORIAL_ASSETS.intro2,
    title: '跟我走一趟',
    body: '出门翻堆，装进篮，\n回家炒一盘。',
    button: '开始捡菜',
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
    title: '看一眼篮',
    body: '顶上那颗菜篮。\n点开，确认菜在里面。',
  },
  [TutorialStep.GO_HOME]: {
    title: '可以回家了',
    body: '够今晚炒一盘。\n点回家。',
  },
  [TutorialStep.WAIT_RESULT]: {
    title: '收摊账',
    body: '点空白处，\n把这页翻过去。',
  },
  [TutorialStep.COOK_TABLE]: {
    title: '开火',
    body: '点灶台。\n我们炒一盘菜苔。',
  },
  [TutorialStep.COOK_DISH]: {
    title: '下锅',
    body: '菜谱已经是炒菜苔。\n点「烹饪」。',
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
    body: '点「卖掉」。\n今晚第一笔钱。',
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
  goHome: '先点回家',
  cookOnly: '这趟只炒菜苔',
  fridgeDish: '先点刚炒好的那盘',
  sellOnly: '这盘先卖掉',
  closeLater: '先按手指走完这一下',
} as const;
