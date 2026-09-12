/**
 * 新手指引状态机。进度写 KitchenSave.tutorialStep，完成态另记账号后台，
 * 清本地缓存或换机登录也不重走。
 */
import { EventBus } from '@/core/EventBus';
import { EV } from '@/config/events';
import { CloudSyncManager } from '@/managers/CloudSyncManager';
import { KitchenManager } from '@/managers/KitchenManager';

export enum TutorialStep {
  NOT_STARTED = 0,
  INTRO = 1,
  GO_OUT = 2,
  PICK_XIANGKO = 3,
  CLICK_CARD = 4,
  CLICK_PILE = 5,
  TAKE_LOOT = 6,
  OPEN_BASKET = 7,
  /** 旧档：摊上点回家。新流程改成收摊账后再回家。 */
  GO_HOME = 8,
  WAIT_RESULT = 9,
  COOK_TABLE = 10,
  COOK_DISH = 11,
  OPEN_FRIDGE = 12,
  INSPECT_DISH = 13,
  SELL_DISH = 14,
  BASKET_DRY = 15,
  BASKET_WET = 16,
  CLOSE_BASKET = 17,
  RETURN_MAP = 18,
  FREE_WALK = 19,
  HINT_DOOR = 20,
  CLAIM_GIFT = 21,
  COMPLETED = 99,
}

export const TUTORIAL_GIFT_COINS = 30;

export const TUTORIAL_SEQUENCE: TutorialStep[] = [
  TutorialStep.INTRO,
  TutorialStep.GO_OUT,
  TutorialStep.PICK_XIANGKO,
  TutorialStep.CLICK_CARD,
  TutorialStep.CLICK_PILE,
  TutorialStep.TAKE_LOOT,
  TutorialStep.OPEN_BASKET,
  TutorialStep.BASKET_DRY,
  TutorialStep.BASKET_WET,
  TutorialStep.CLOSE_BASKET,
  TutorialStep.RETURN_MAP,
  TutorialStep.FREE_WALK,
  TutorialStep.WAIT_RESULT,
  TutorialStep.COOK_TABLE,
  TutorialStep.COOK_DISH,
  TutorialStep.OPEN_FRIDGE,
  TutorialStep.INSPECT_DISH,
  TutorialStep.SELL_DISH,
  TutorialStep.CLAIM_GIFT,
  TutorialStep.HINT_DOOR,
  TutorialStep.COMPLETED,
];

const TUTORIAL_ORDER = new Map<TutorialStep, number>(
  TUTORIAL_SEQUENCE.map((step, index) => [step, index]),
);

class TutorialManagerClass {
  private _step: TutorialStep = TutorialStep.NOT_STARTED;
  private _started = false;
  private _dishUid = '';
  private _cardId = '';
  private _gifted = false;

  get currentStep(): TutorialStep {
    return this._step;
  }

  get isActive(): boolean {
    return this._started && this._step < TutorialStep.COMPLETED;
  }

  get isCompleted(): boolean {
    return this._step >= TutorialStep.COMPLETED;
  }

  get dishUid(): string {
    return this._dishUid;
  }

  get allowedCardId(): string {
    return this._cardId;
  }

  setAllowedCardId(id: string): void {
    this._cardId = id;
  }

  isStep(step: TutorialStep): boolean {
    return this._started && this._step === step;
  }

  at(...steps: TutorialStep[]): boolean {
    return this._started && steps.includes(this._step);
  }

  needsOutingSeed(): boolean {
    return this.isActive && this._step <= TutorialStep.RETURN_MAP;
  }

  usesMask(): boolean {
    return this.isActive
      && this._step !== TutorialStep.FREE_WALK
      && this._step !== TutorialStep.HINT_DOOR
      && this._step !== TutorialStep.CLAIM_GIFT
      && this._step !== TutorialStep.WAIT_RESULT;
  }

  tapHoleAdvances(): boolean {
    return this.at(TutorialStep.BASKET_DRY, TutorialStep.BASKET_WET);
  }

  start(): void {
    const saved = this._reconcile(this._read());
    if (saved >= TutorialStep.COMPLETED) {
      this._step = TutorialStep.COMPLETED;
      this._started = false;
      this._write(TutorialStep.COMPLETED);
      return;
    }
    this._step = saved === TutorialStep.NOT_STARTED ? TutorialStep.INTRO : saved;
    this._started = true;
    if (
      this._step >= TutorialStep.HINT_DOOR
      && this._step !== TutorialStep.CLAIM_GIFT
    ) {
      KitchenManager.noteTutorialGiftClaimed();
      this._gifted = true;
    }
    if (this._step === TutorialStep.INTRO) {
      this._gifted = false;
      this._dishUid = '';
      this._cardId = '';
    }
    this._write(this._step);
    EventBus.emit(EV.tutorialStepChanged, this._step);
  }

  advanceTo(step: TutorialStep): void {
    if (!this._started && step !== TutorialStep.COMPLETED) return;
    if (step !== TutorialStep.COMPLETED) {
      const currentOrder = TUTORIAL_ORDER.get(this._step);
      const nextOrder = TUTORIAL_ORDER.get(step);
      if (currentOrder !== undefined && nextOrder !== undefined && nextOrder <= currentOrder) {
        return;
      }
      if (nextOrder === undefined && step <= this._step) return;
    }
    this._step = step;
    this._write(step);
    if (step >= TutorialStep.COMPLETED) {
      this._complete();
      return;
    }
    EventBus.emit(EV.tutorialStepChanged, this._step);
  }

  advanceIf(from: TutorialStep, to?: TutorialStep): boolean {
    if (!this.isStep(from)) return false;
    const idx = TUTORIAL_SEQUENCE.indexOf(from);
    const next = to ?? TUTORIAL_SEQUENCE[idx + 1] ?? TutorialStep.COMPLETED;
    this.advanceTo(next);
    return true;
  }

  onCooked(recipeId: string): void {
    if (!this.isStep(TutorialStep.COOK_DISH) || recipeId !== 'stirfry') return;
    const dish = KitchenManager.save.fridge
      .filter((it) => it.kind === 'dish' && it.defId === 'stirfry')
      .at(-1);
    if (!dish) return;
    this._dishUid = dish.uid;
    this.advanceTo(TutorialStep.OPEN_FRIDGE);
  }

  onSold(uid: string): void {
    if (!this.isStep(TutorialStep.SELL_DISH)) return;
    if (this._dishUid && uid !== this._dishUid) return;
    this.advanceTo(TutorialStep.CLAIM_GIFT);
  }

  giftAlreadyClaimed(): boolean {
    return this._gifted || !!KitchenManager.save.tutorialGiftClaimed;
  }

  claimGift(): boolean {
    if (!this.isStep(TutorialStep.CLAIM_GIFT)) return false;
    if (this.giftAlreadyClaimed()) {
      this.advanceTo(TutorialStep.HINT_DOOR);
      return false;
    }
    this._gifted = true;
    KitchenManager.claimTutorialGift(TUTORIAL_GIFT_COINS);
    this.advanceTo(TutorialStep.HINT_DOOR);
    return true;
  }

  noteDishUid(uid: string): void {
    this._dishUid = uid;
  }

  forceComplete(): void {
    this._complete();
  }

  private _complete(): void {
    this._step = TutorialStep.COMPLETED;
    this._started = false;
    this._dishUid = '';
    this._cardId = '';
    this._write(TutorialStep.COMPLETED);
    EventBus.emit(EV.tutorialCompleted);
    void CloudSyncManager.markTutorialComplete().then(() => {
      void CloudSyncManager.flushNow('tutorial-complete');
    });
  }

  private _read(): TutorialStep {
    if (CloudSyncManager.accountTutorialCompleted) return TutorialStep.COMPLETED;
    const raw = KitchenManager.save.tutorialStep;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return TutorialStep.COMPLETED;
    return raw as TutorialStep;
  }

  private _write(step: TutorialStep): void {
    KitchenManager.setTutorialStep(step);
  }

  /** 出门局不进存档。杀进程后按冰箱里有没有菜苔/炒菜苔接回去。 */
  private _reconcile(step: TutorialStep): TutorialStep {
    if (step >= TutorialStep.COMPLETED) return TutorialStep.COMPLETED;
    const fridge = KitchenManager.save.fridge;
    const hasStirfry = fridge.some((it) => it.kind === 'dish' && it.defId === 'stirfry');
    const hasCaitai = fridge.some((it) => it.defId === 'caitai');
    if (step === TutorialStep.GO_HOME) {
      if (hasStirfry) return TutorialStep.OPEN_FRIDGE;
      if (hasCaitai) return TutorialStep.COOK_TABLE;
      return TutorialStep.FREE_WALK;
    }
    if (hasStirfry && step >= TutorialStep.CLICK_CARD && step <= TutorialStep.COOK_DISH) {
      const uid = fridge.filter((it) => it.kind === 'dish' && it.defId === 'stirfry').at(-1)?.uid;
      if (uid) this._dishUid = uid;
      return TutorialStep.OPEN_FRIDGE;
    }
    if (hasCaitai && step >= TutorialStep.CLICK_CARD && step <= TutorialStep.WAIT_RESULT) {
      return TutorialStep.COOK_TABLE;
    }
    if (step >= TutorialStep.CLICK_CARD && step <= TutorialStep.WAIT_RESULT) {
      return TutorialStep.GO_OUT;
    }
    if (step >= TutorialStep.BASKET_DRY && step <= TutorialStep.FREE_WALK) {
      return hasCaitai ? TutorialStep.COOK_TABLE : TutorialStep.GO_OUT;
    }
    if ((step === TutorialStep.INSPECT_DISH || step === TutorialStep.SELL_DISH) && !hasStirfry) {
      return hasCaitai ? TutorialStep.COOK_TABLE : TutorialStep.OPEN_FRIDGE;
    }
    if (step === TutorialStep.CLAIM_GIFT && KitchenManager.save.tutorialGiftClaimed) {
      return TutorialStep.HINT_DOOR;
    }
    return step;
  }
}

export const TutorialManager = new TutorialManagerClass();
