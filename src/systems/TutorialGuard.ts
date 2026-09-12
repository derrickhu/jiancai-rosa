import { Platform } from '@/core/PlatformService';
import { AudioManager } from '@/core/AudioManager';
import { TUTORIAL_DENY } from '@/config/TutorialCopy';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';

export type TutorialAction =
  | 'door'
  | 'departXiangko'
  | 'departOther'
  | 'goHomeDest'
  | 'specialMarket'
  | 'switchVehicle'
  | 'walkCard'
  | 'walkOtherCard'
  | 'drawPile'
  | 'takeLoot'
  | 'openBasket'
  | 'leaveStall'
  | 'extract'
  | 'openCook'
  | 'cook'
  | 'pickRecipe'
  | 'openFridge'
  | 'inspectDish'
  | 'sellDish'
  | 'eatDish'
  | 'fridgeTab'
  | 'closeCook'
  | 'closeFridge'
  | 'closeBasket'
  | 'closeResult'
  | 'neighbor'
  | 'upgrade'
  | 'gameClub'
  | 'claimGift';

const FREE_WALK: TutorialAction[] = [
  'walkCard',
  'walkOtherCard',
  'drawPile',
  'takeLoot',
  'openBasket',
  'closeBasket',
  'leaveStall',
  'extract',
];

const ALLOWED: Partial<Record<TutorialStep, TutorialAction[]>> = {
  [TutorialStep.INTRO]: [],
  [TutorialStep.GO_OUT]: ['door'],
  [TutorialStep.PICK_XIANGKO]: ['departXiangko'],
  [TutorialStep.CLICK_CARD]: ['walkCard'],
  [TutorialStep.CLICK_PILE]: ['drawPile'],
  [TutorialStep.TAKE_LOOT]: ['takeLoot'],
  [TutorialStep.OPEN_BASKET]: ['openBasket'],
  [TutorialStep.BASKET_DRY]: [],
  [TutorialStep.BASKET_WET]: [],
  [TutorialStep.CLOSE_BASKET]: ['closeBasket'],
  [TutorialStep.RETURN_MAP]: ['leaveStall'],
  [TutorialStep.FREE_WALK]: FREE_WALK,
  [TutorialStep.GO_HOME]: ['extract', 'closeBasket'],
  [TutorialStep.WAIT_RESULT]: ['closeResult'],
  [TutorialStep.COOK_TABLE]: ['openCook'],
  [TutorialStep.COOK_DISH]: ['cook', 'openCook', 'pickRecipe'],
  [TutorialStep.OPEN_FRIDGE]: ['openFridge'],
  [TutorialStep.INSPECT_DISH]: ['inspectDish'],
  [TutorialStep.SELL_DISH]: ['sellDish'],
  [TutorialStep.CLAIM_GIFT]: ['claimGift'],
  [TutorialStep.HINT_DOOR]: [],
};

const DENY: Partial<Record<TutorialAction, string>> = {
  departOther: TUTORIAL_DENY.otherMarket,
  goHomeDest: TUTORIAL_DENY.homeEarly,
  specialMarket: TUTORIAL_DENY.otherMarket,
  switchVehicle: TUTORIAL_DENY.otherMarket,
  walkOtherCard: TUTORIAL_DENY.otherCard,
  drawPile: TUTORIAL_DENY.pileFirst,
  takeLoot: TUTORIAL_DENY.takeCaitai,
  openBasket: TUTORIAL_DENY.basketFirst,
  leaveStall: TUTORIAL_DENY.returnMap,
  extract: TUTORIAL_DENY.extractEarly,
  cook: TUTORIAL_DENY.cookOnly,
  pickRecipe: TUTORIAL_DENY.cookOnly,
  inspectDish: TUTORIAL_DENY.fridgeDish,
  sellDish: TUTORIAL_DENY.sellOnly,
  eatDish: TUTORIAL_DENY.sellOnly,
  closeCook: TUTORIAL_DENY.closeLater,
  closeFridge: TUTORIAL_DENY.closeLater,
  closeBasket: TUTORIAL_DENY.closeBasket,
};

export const TutorialGuard = {
  allows(action: TutorialAction): boolean {
    if (!TutorialManager.isActive) return true;
    if (TutorialManager.isStep(TutorialStep.HINT_DOOR)) return true;
    const ok = ALLOWED[TutorialManager.currentStep] ?? [];
    return ok.includes(action);
  },

  block(action: TutorialAction, toast = true): boolean {
    if (this.allows(action)) return false;
    if (toast && TutorialManager.isActive) {
      AudioManager.play('ui_deny');
      Platform.showToast(DENY[action] ?? TUTORIAL_DENY.default);
    }
    return true;
  },
};
