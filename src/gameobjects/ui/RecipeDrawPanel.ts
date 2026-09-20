import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { ensureRecipeUnlockPanel } from '@/gameobjects/ui/RecipeUnlockPanel';
import { RECIPE_GACHA_COST, type RecipeId } from '@/sim';
import { playRewardCollect } from '@/utils/coinCollect';
import { fillRect, makeLabel } from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  imgPath,
  isTextureFailed,
  isTextureReady,
  itemTexture,
  watchTextures,
  whenTextureReady,
} from '@/utils/assets';

const TICKET = 'subpkg_images/ui_menu_ticket.png';
const BOX = 'subpkg_images/hud_gacha_box.png';
const PAPER = 'subpkg_kitchen/ui_recipe_paper.png';
const LACK_HINT = '完成小饭桌任务可以获得菜谱券';
const TEASE = '箱子里不定是菜谱，也可能是好食材。';
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const SHAKE_SEC = 0.4;
const SPIN_SEC = 0.95;
const LAND_SEC = 0.18;

type DrawResult = {
  recipeId?: RecipeId;
  foodDefId?: string;
  foodFolded?: boolean;
  foldGold?: number;
  duplicate: boolean;
  gold: number;
  toast: string;
};

export class RecipeDrawPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _box: PIXI.Container | null = null;
  private _paper: PIXI.Container | null = null;
  private _playing = false;
  private _pending: DrawResult | null = null;
  private _lastTap = 0;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 27;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    const pending = this._pending;
    this._clearFx();
    this._playing = false;
    this._pending = null;
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._root.removeChildren();
    this._box = null;
    if (pending) this._deliver(pending);
  }

  relayout(): void {
    if (this._playing) return;
    this._clearFx();
    this._root.removeChildren();
    this._box = null;
    if (!this._isOpen) return;

    watchTextures([BOX, TICKET, PAPER], () => {
      if (this._isOpen && !this._playing) this.relayout();
    });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.78;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (!this._playing) this.close();
    });
    this._root.addChild(dim);

    const boxSize = Math.min(460, w - 48);
    const btnW = 280;
    const btnH = 58;
    const gap = 28;
    const hintH = 64;
    const blockH = hintH + boxSize + gap + btnH;
    const top = Math.round(Math.max(Game.safeTop + 24, (h - blockH) / 2 - 12));
    const cx = w / 2;

    const tease = makeLabel(TEASE, 28, 0xFFF6E8, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: 0x2A2018,
      strokeThickness: 5,
    });
    tease.anchor.set(0.5, 0.5);
    tease.position.set(cx, top + hintH / 2);
    tease.eventMode = 'none';
    this._root.addChild(tease);

    const box = new PIXI.Container();
    const tex = gameTexture(BOX);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, boxSize, boxSize);
      spr.anchor.set(0.5);
      spr.eventMode = 'none';
      box.addChild(spr);
    }
    box.position.set(cx, top + hintH + boxSize / 2);
    box.eventMode = 'static';
    box.hitArea = new PIXI.Rectangle(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
    box.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(box);
    this._box = box;

    const tickets = KitchenManager.save.recipeTickets;
    const ready = tickets >= RECIPE_GACHA_COST;
    const btn = this._drawBtn(tickets, ready, btnW, btnH);
    btn.position.set(cx - btnW / 2, top + hintH + boxSize + gap);
    btn.on('pointertap', (e) => {
      e.stopPropagation();
      this._onDraw(ready);
    });
    this._root.addChild(btn);
  }

  private _onDraw(ready: boolean): void {
    const now = Date.now();
    if (now - this._lastTap < 280) return;
    this._lastTap = now;
    if (this._playing) return;
    if (!ready) {
      AudioManager.play('ui_deny');
      Platform.showToast(LACK_HINT);
      return;
    }
    const result = KitchenManager.drawRecipe({ reveal: false });
    if (!result.ok) return;
    this._playing = true;
    this._pending = result;
    const afterShake = (): void => {
      if (!this._playing) return;
      if (result.foodDefId) {
        this._waitPath(imgPath(`${result.foodDefId}.png`), () => {
          if (!this._playing) return;
          this._spinItem(result.foodDefId!, () => {
            if (!this._playing) return;
            this._finishDraw();
          });
        });
        return;
      }
      this._waitPath(PAPER, () => {
        if (!this._playing) return;
        this._spinPaper(result.duplicate, () => {
          if (!this._playing) return;
          this._finishDraw();
        });
      });
    };
    if (result.foodDefId) itemTexture(result.foodDefId);
    else gameTexture(PAPER);
    this._shakeBox(afterShake);
  }

  private _shakeBox(done: () => void): void {
    const box = this._box;
    if (!box) {
      done();
      return;
    }
    TweenManager.cancelTarget(box);
    TweenManager.cancelTarget(box.scale);
    const st = { t: 0 };
    box.rotation = 0;
    box.scale.set(1);
    AudioManager.play('upgrade');
    TweenManager.to({
      target: st,
      props: { t: 1 },
      duration: SHAKE_SEC,
      onUpdate: () => {
        if (box.destroyed) return;
        const t = st.t;
        const damp = 1 - t;
        box.rotation = Math.sin(t * Math.PI * 10) * 0.16 * damp;
        box.scale.set(1 + Math.sin(t * Math.PI * 8) * 0.05 * damp);
      },
      onComplete: () => {
        if (!box.destroyed) {
          box.rotation = 0;
          box.scale.set(1);
        }
        done();
      },
    });
  }

  private _waitPath(path: string, done: () => void): void {
    const tex = gameTexture(path);
    if (isTextureReady(tex) || isTextureFailed(path)) {
      done();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      done();
    };
    whenTextureReady(path, finish);
    globalThis.setTimeout(finish, 800);
  }

  private _spinPaper(duplicate: boolean, done: () => void): void {
    const box = this._box;
    const tex = gameTexture(PAPER);
    if (!box || !isTextureReady(tex)) {
      done();
      return;
    }
    if (this._paper && !this._paper.destroyed) this._paper.destroy({ children: true });

    const w = Game.designWidth;
    const h = Game.logicHeight;
    const maxW = Math.min(w - 48, 520);
    const maxH = Math.min(h - Game.safeTop - 160, 720);
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, maxW, maxH);
    spr.anchor.set(0.5);
    spr.eventMode = 'none';
    const destY = Game.safeTop + Math.max(24, (h - Game.safeTop - spr.height - 88) / 2) + spr.height / 2;

    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    wrap.position.set(box.x, box.y + 36);
    wrap.scale.set(0.08);
    wrap.rotation = Math.PI * 1.65;
    wrap.alpha = 0;
    wrap.addChild(spr);
    this._root.addChild(wrap);
    this._paper = wrap;
    AudioManager.play(duplicate ? 'event_pop' : 'recipe_paper');
    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.08 });
    TweenManager.to({
      target: wrap,
      props: { x: w / 2, y: destY, rotation: 0 },
      duration: SPIN_SEC,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: SPIN_SEC,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({
          target: { t: 0 },
          props: { t: 1 },
          duration: LAND_SEC,
          onComplete: done,
        });
      },
    });
  }

  private _spinItem(defId: string, done: () => void): void {
    const box = this._box;
    const tex = itemTexture(defId);
    if (!box || !isTextureReady(tex)) {
      done();
      return;
    }
    if (this._paper && !this._paper.destroyed) this._paper.destroy({ children: true });
    const spr = new PIXI.Sprite(tex);
    fitSpriteInBox(spr, 240, 240);
    spr.anchor.set(0.5);
    spr.eventMode = 'none';
    const wrap = new PIXI.Container();
    wrap.eventMode = 'none';
    wrap.position.set(box.x, box.y + 36);
    wrap.scale.set(0.08);
    wrap.rotation = Math.PI * 1.65;
    wrap.alpha = 0;
    wrap.addChild(spr);
    this._root.addChild(wrap);
    this._paper = wrap;
    AudioManager.play('event_pop');
    TweenManager.to({ target: wrap, props: { alpha: 1 }, duration: 0.08 });
    TweenManager.to({
      target: wrap,
      props: { y: box.y - 80, rotation: 0 },
      duration: SPIN_SEC,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: wrap.scale,
      props: { x: 1, y: 1 },
      duration: SPIN_SEC,
      ease: Ease.easeOutBack,
      onComplete: () => {
        TweenManager.to({
          target: { t: 0 },
          props: { t: 1 },
          duration: LAND_SEC,
          onComplete: done,
        });
      },
    });
  }

  private _finishDraw(): void {
    const pending = this._pending;
    this._playing = false;
    this._pending = null;
    if (pending) this._deliver(pending);
    this._clearFx();
    if (this._isOpen) this.relayout();
  }

  private _deliver(result: DrawResult): void {
    const from = this._box
      ? { x: this._box.x, y: this._box.y - 80 }
      : { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.42) };
    if (result.foodDefId) {
      playRewardCollect({
        gold: result.gold,
        foldGold: result.foldGold,
        foodDefId: result.foodDefId,
        foodFolded: result.foodFolded,
        from,
      });
      return;
    }
    if (result.duplicate) {
      AudioManager.play('coin_gain');
      playRewardCollect({ gold: result.gold, from });
      return;
    }
    if (result.recipeId) {
      KitchenManager.enqueueRecipeUnlocks([result.recipeId], 0, false);
      ensureRecipeUnlockPanel().present({ silent: true });
    }
  }

  private _clearFx(): void {
    if (this._box && !this._box.destroyed) {
      TweenManager.cancelTarget(this._box);
      TweenManager.cancelTarget(this._box.scale);
      this._box.rotation = 0;
      this._box.scale.set(1);
    }
    if (this._paper) {
      TweenManager.cancelTarget(this._paper);
      TweenManager.cancelTarget(this._paper.scale);
      if (!this._paper.destroyed) this._paper.destroy({ children: true });
      this._paper = null;
    }
  }

  private _drawBtn(tickets: number, ready: boolean, width: number, height: number): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.lineStyle(4, ready ? 0x8B5A2B : 0xC4A574, 1);
    bg.beginFill(ready ? 0xC46A3A : 0x2A2018);
    bg.drawRoundedRect(0, 0, width, height, height / 2);
    bg.endFill();
    root.addChild(bg);

    const label = makeLabel(`${tickets} / ${RECIPE_GACHA_COST}`, 26, ready ? 0xFFF8F0 : 0xF0D9A8, {
      fontWeight: '700',
    });
    const iconSize = 40;
    const ticketTex = gameTexture(TICKET);
    const iconW = isTextureReady(ticketTex) ? iconSize + 10 : 0;
    const groupW = iconW + label.width;
    const x0 = (width - groupW) / 2;
    if (isTextureReady(ticketTex)) {
      const spr = new PIXI.Sprite(ticketTex);
      fitSpriteInBox(spr, iconSize, iconSize);
      spr.anchor.set(0, 0.5);
      spr.position.set(x0, height / 2);
      spr.eventMode = 'none';
      if (!ready) spr.alpha = 0.92;
      root.addChild(spr);
    }
    label.anchor.set(0, 0.5);
    label.position.set(x0 + iconW, height / 2 + 1);
    root.addChild(label);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    return root;
  }
}
