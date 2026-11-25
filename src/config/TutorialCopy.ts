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
    title: '收摊寻鲜',
    body: '傍晚菜场刚散集，\n摊上漏了不少水灵好货！',
  },
  {
    title: '跟我走一趟',
    body: '出门翻摊装满篮，\n回家热火炒头锅！',
  },
];

export const TUTORIAL_COPY: Record<number, { title: string; body: string }> = {
  [TutorialStep.GO_OUT]: {
    title: '出门赶集',
    body: '厨房木门直通菜场。\n点它，今晚先去巷口！',
  },
  [TutorialStep.PICK_XIANGKO]: {
    title: '巷口最近',
    body: '点「出发」花 1 点体力进场，\n每趟出门都能带一篮好菜回来。',
  },
  [TutorialStep.CLICK_CARD]: {
    title: '走进菜摊',
    body: '脚下这张是免费叶菜摊。\n点它进去翻好货！',
  },
  [TutorialStep.CLICK_PILE]: {
    title: '翻开遮挡堆',
    body: '点摊上的遮挡堆，\n把藏着的菜翻到桌上。',
  },
  [TutorialStep.TAKE_LOOT]: {
    title: '好菜进篮',
    body: '点桌上的新鲜菜苔收进菜篮。\n把这摊剩货全翻完再走！',
  },
  [TutorialStep.OPEN_BASKET]: {
    title: '这摊翻空啦',
    body: '好菜都进篮了！点顶上「菜篮」，\n看一眼干湿分区怎么装。',
  },
  [TutorialStep.BASKET_DRY]: {
    title: '浅色是干区',
    body: '菜苔、豆腐、鸡蛋这类日常干货\n自动摆在浅色格。点一下继续。',
  },
  [TutorialStep.BASKET_WET]: {
    title: '青色是湿区',
    body: '鲜鱼、河虾、螃蟹这类水产湿货\n放入青色湿格保鲜。点一下看收尾。',
  },
  [TutorialStep.CLOSE_BASKET]: {
    title: '关好继续逛',
    body: '篮满时也能拖格子换位。\n点下方按钮关好菜篮！',
  },
  [TutorialStep.RETURN_MAP]: {
    title: '回到菜场路',
    body: '这摊已经翻干净啦！\n点左上角「返回菜场」继续往前逛。',
  },
  [TutorialStep.FREE_WALK]: {
    title: '再逛一步',
    body: '点脚下路线卡多捡点菜，\n或随时点右上角「回家」开火！',
  },
  [TutorialStep.WAIT_RESULT]: {
    title: '满载收摊',
    body: '今晚捡到的鲜货全在这儿啦！\n点空白处带回厨房。',
  },
  [TutorialStep.COOK_TABLE]: {
    title: '热锅开火',
    body: '点烹饪台，\n用刚捡的菜苔炒头锅家常菜！',
  },
  [TutorialStep.COOK_DISH]: {
    title: '下锅翻炒',
    body: '材料齐备！点「烹饪」出锅，\n多做还能升铜银金三勺涨身价。',
  },
  [TutorialStep.OPEN_FRIDGE]: {
    title: '鲜菜入柜',
    body: '刚出锅的热菜存进冰箱啦，\n点冰箱打开看看！',
  },
  [TutorialStep.INSPECT_DISH]: {
    title: '查看熟菜',
    body: '点这盘刚炒好的「炒菜苔」，\n熟菜既能吃补加成，也能卖钱！',
  },
  [TutorialStep.SELL_DISH]: {
    title: '开张第一金',
    body: '点「卖掉」换今晚第一笔菜钱！',
  },
  [TutorialStep.HINT_DOOR]: {
    title: '随时出门赶集',
    body: '新菜谱已到手！点木门再去逛一趟凑食材，\n或点左侧「抽谱」开箱领新谱！',
  },
};

export const TUTORIAL_DENY = {
  default: '先点高亮位置完成这一步',
  otherMarket: '第一趟先去家门口的巷口收摊',
  otherCard: '先走进脚下这张叶菜摊',
  homeEarly: '先去巷口逛一趟带点菜回来',
  pileFirst: '先点遮挡堆把菜翻出来',
  takeCaitai: '先把桌上的好菜收进菜篮',
  basketFirst: '先把这摊翻完，点顶上菜篮看一眼',
  closeBasket: '点下方按钮关好菜篮',
  returnMap: '这摊翻完啦，点左上角返回菜场',
  extractEarly: '先点返回菜场走一步，马上就能回家',
  goHome: '点屏幕空白处回家',
  cookOnly: '头一锅先炒拿手的炒菜苔',
  fridgeDish: '先点刚出锅的那盘炒菜苔',
  sellOnly: '这盘先卖掉换开张菜钱',
  closeLater: '跟着小手点一下就搞定啦',
} as const;
