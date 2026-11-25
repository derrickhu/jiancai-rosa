import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  DAILY_AD_LIMITS,
  PICKLE_FORMULAS,
  PICKLE_TIER_DEFS,
  SECOND_JAR_COST,
  canUseDailyAd,
  cookLevel,
  dailyAdLeft,
  formatDurationLabel,
  formatTimerShort,
  itemRarity,
  pickleEffectiveDurationMs,
  pickleFormulaStatus,
  pickleSlotsView,
  pickleTier,
  pickleUpgradeState,
  recipeById,
  type PickleFormulaDef,
  type PickleSlotView,
} from '@/sim';
import { playRewardCollect } from '@/utils/coinCollect';
import {
  HUD_ICON,
  P0_ART,
  P2_ART,
  UI_KIT,
  attachSpriteContour,
  fillRect,
  fitTextWidth,
  makeAdButton,
  makeCloseButton,
  makeCoinButton,
  makeHandProgressBar,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  inspectFromItem,
  inspectFromRecipe,
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';

/** 老坛场景贴图：一面木墙 + 搁板 + 钉在墙上的配方纸，所有元素放进同一个场景里。 */
const ART = {
  wall: 'subpkg_images/scene_pk_cellar_wall.png',
  sheet: 'subpkg_images/scene_pk_recipe_sheet.png',
  plate: 'subpkg_images/scene_pk_plate.png',
  tag: 'subpkg_images/scene_pk_tag_h.png',
  seal: 'subpkg_images/scene_pk_seal.png',
  plaque: 'subpkg_images/scene_pk_plaque.png',
  hourglass: 'subpkg_images/scene_pk_hourglass.png',
  divider: 'subpkg_images/scene_pk_ink_divider.png',
} as const;

const INK = 0x2A2018;
const INK_SOFT = 0x5A4430;
const MUTED = 0x8A6E52;
const RED_INK = 0xB8361F;
const GREEN_INK = 0x3F7034;
const CREAM = 0xFFF6E2;

/**
 * 版式（按 720 宽设计，整体等比缩放适配屏幕）。
 * 墙图原始 720×964：搁板台面在 y≈314，搁板前沿底在 y≈350。
 */
const W = 720;
const L = {
  wallSliceTop: 430,
  wallSliceBottom: 64,
  shelfTop: 314,
  jarCols: [190, 530] as const,
  jarH: 140,
  tagY: 354,
  tagW: 236,
  btnY: 474,
  btnW: 236,
  btnH: 58,
  sheetTop: 548,
  sheetX: 28,
  headerH: 96,
  rowH: 120,
  sheetBottomPad: 46,
  contentX: 68,
  contentR: 652,
} as const;

interface LiveJarHud {
  readyAt: number;
  startedAt: number;
  durationMs: number;
  timerText: PIXI.Text;
  setRatio: (r: number) => void;
}

export class PicklePanel extends PIXI.Container {
  _isOpen = false;
  onGoCook: ((recipeId: PickleFormulaDef['unlockRecipeId']) => void) | null = null;
  private _root = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;
  private _adBusy = false;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _liveJars: LiveJarHud[] = [];
  private _jarCenters: Array<{ x: number; y: number }> = [];

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 26;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this._inspect = null;
    this._adBusy = false;
    warmupAdScene('pickle_boost');
    this._startTick();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    this._stopTick();
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._adBusy = false;
    this._paintQueued = false;
    this._liveJars = [];
    destroyDisplayChildren(this._root);
  }

  private _startTick(): void {
    this._stopTick();
    this._tickTimer = setInterval(() => {
      if (!this._isOpen) return;
      const now = Date.now();
      let crossedReady = false;
      for (const hud of this._liveJars) {
        if (hud.timerText.destroyed) continue;
        const remain = Math.max(0, hud.readyAt - now);
        if (remain <= 0) {
          crossedReady = true;
          break;
        }
        hud.timerText.text = `还要 ${formatTimerShort(remain)}`;
        const total = Math.max(1, hud.readyAt - hud.startedAt || hud.durationMs);
        hud.setRatio(Math.min(1, Math.max(0.06, 1 - remain / total)));
      }
      if (crossedReady && !this._adBusy) this.relayout();
    }, 1000);
  }

  private _stopTick(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  private _scheduleRelayout = (): void => {
    if (!this._isOpen || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this._isOpen) this.relayout();
    });
  };

  private _warmAssets(): void {
    const tierArt = P2_ART.pickleTiers[pickleTier(KitchenManager.save)];
    const paths: string[] = [
      ...Object.values(ART),
      ...uiBarPaths(),
      HUD_ICON.coin,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      tierArt.idle,
      tierArt.ready,
      P0_ART.adClapper,
    ];
    for (const f of PICKLE_FORMULAS) {
      paths.push(resolveItemAssetPath(f.outputDefId));
      paths.push(resolveDishAssetPath(f.unlockRecipeId));
      for (const inp of f.inputs) paths.push(resolveItemAssetPath(inp.defId));
    }
    watchTextures(paths, this._scheduleRelayout);
  }

  relayout(): void {
    destroyDisplayChildren(this._root);
    this._liveJars = [];
    this._jarCenters = [];
    if (!this._isOpen) return;
    this._warmAssets();

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.66;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._inspect) {
        this._inspect = null;
        this.relayout();
        return;
      }
      if (!this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const n = PICKLE_FORMULAS.length;
    const sheetH = L.headerH + n * L.rowH + L.sheetBottomPad;
    const panelH = L.sheetTop + sheetH + 22;

    const scene = new PIXI.Container();
    scene.eventMode = 'static';
    scene.hitArea = new PIXI.Rectangle(0, -50, W, panelH + 60);
    scene.on('pointertap', (e) => e.stopPropagation());

    const availW = sw - 16;
    const availH = sh - Game.safeTop - 40 - Math.max(16, Game.safeBottom);
    const scale = Math.min(1, availW / W, availH / (panelH + 40));
    scene.scale.set(scale);
    const sx = Math.round((sw - W * scale) / 2);
    const sy = Math.round(Game.safeTop + 40 + Math.max(0, (availH - (panelH + 40) * scale) / 2));
    scene.position.set(sx, sy);
    this._root.addChild(scene);

    const save = KitchenManager.save;
    this._drawWall(scene, panelH);
    this._drawTitlePlaque(scene);

    const slots = pickleSlotsView(save, Date.now());
    slots.forEach((view, idx) => {
      const cx = L.jarCols[idx];
      this._jarCenters[idx] = { x: sx + cx * scale, y: sy + (L.shelfTop - L.jarH / 2) * scale };
      this._drawJarColumn(scene, view, cx);
    });

    this._drawSheet(scene, sheetH);
    this._drawSheetHeader(scene, save);
    const hasEmptyJar = slots.some((s) => s.status === 'empty');
    PICKLE_FORMULAS.forEach((formula, i) => {
      const ry = L.sheetTop + L.headerH + i * L.rowH;
      this._drawFormulaRow(scene, formula, ry, hasEmptyJar, i < n - 1);
    });

    const closeBtn = makeCloseButton({
      size: 60,
      silent: true,
      onReady: this._scheduleRelayout,
      onTap: () => {
        if (!this._adBusy) this.close();
      },
    });
    closeBtn.position.set(W - 46, -20);
    scene.addChild(closeBtn);

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onReady: this._scheduleRelayout,
        onClose: () => {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
        },
      }));
    }
  }

  // ── 场景底：木墙（上段原样，中段竖向拉伸，下段原样） ─────────────────────
  private _drawWall(scene: PIXI.Container, panelH: number): void {
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x0E0804, 0.45);
    shadow.drawRoundedRect(8, 14, W - 16, panelH - 4, 34);
    shadow.endFill();
    scene.addChild(shadow);
    const tex = gameTexture(ART.wall);
    if (isTextureReady(tex)) {
      const plane = new PIXI.NineSlicePlane(tex, 0, L.wallSliceTop, 0, L.wallSliceBottom);
      plane.width = W;
      plane.height = panelH;
      scene.addChild(plane);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(4, INK, 1);
      g.beginFill(0x6B3F22, 1);
      g.drawRoundedRect(0, 0, W, panelH, 30);
      g.endFill();
      g.lineStyle(0);
      g.beginFill(0x8A5A34, 1);
      g.drawRect(24, L.shelfTop - 6, W - 48, 36);
      g.endFill();
      scene.addChild(g);
    }
  }

  private _sprite(path: string, w: number, h?: number): PIXI.Sprite | null {
    const tex = gameTexture(path);
    if (!isTextureReady(tex)) return null;
    const sp = new PIXI.Sprite(tex);
    if (h === undefined) {
      sp.width = w;
      sp.scale.y = sp.scale.x;
    } else {
      fitSpriteInBox(sp, w, h);
    }
    return sp;
  }

  // ── 标题：挂在墙上的木招牌 ─────────────────────────────────────────────
  private _drawTitlePlaque(scene: PIXI.Container): void {
    const pw = 336;
    const plaque = this._sprite(ART.plaque, pw);
    const top = -44;
    let faceCy = 70;
    if (plaque) {
      plaque.position.set((W - pw) / 2, top);
      scene.addChild(plaque);
      faceCy = top + plaque.height * 0.64;
    }
    const t = makeText('display', '老坛腌制坊', 0x4A2A12, { size: 40, stroke: 0xF6DDB0, strokeWidth: 3 });
    t.anchor.set(0.5);
    t.position.set(W / 2, faceCy);
    scene.addChild(t);
  }

  // ── 一口坛 = 搁板上的坛子 + 搁板下挂的牛皮纸签 + 一个动作按钮 ─────────────
  private _drawJarColumn(scene: PIXI.Container, view: PickleSlotView, cx: number): void {
    const save = KitchenManager.save;
    const tierArt = P2_ART.pickleTiers[pickleTier(save)];
    const isReady = view.status === 'ready';
    const isLocked = view.status === 'locked';

    const jar = this._sprite(isReady ? tierArt.ready : tierArt.idle, L.jarH, L.jarH);
    if (jar) {
      jar.anchor.set(0.5, 1);
      jar.position.set(cx, L.shelfTop + 4);
      if (isLocked) {
        jar.tint = 0x3A2616;
        jar.alpha = 0.42;
      }
      scene.addChild(jar);
      if (view.formula && (isReady || view.status === 'fermenting')) {
        attachSpriteContour(scene, jar, itemRarity(view.formula.outputDefId), {
          onDark: true,
          selected: isReady,
          thicknessScale: isReady ? 1.05 : 0.85,
          alpha: isReady ? undefined : 0.66,
        });
      }
      if (isReady) {
        TweenManager.to({
          target: jar.scale,
          props: { x: jar.scale.x * 1.05, y: jar.scale.y * 1.05 },
          duration: 0.65,
          ease: Ease.easeInOutQuad,
        });
      }
    }

    // 牛皮纸签（左侧是麻绳，右侧 70% 是可写的面）
    const tag = new PIXI.Container();
    const tagSp = this._sprite(ART.tag, L.tagW);
    const tagH = tagSp ? tagSp.height : 114;
    if (tagSp) tag.addChild(tagSp);
    const faceX = L.tagW * 0.31;
    const faceW = L.tagW - faceX - 10;
    const faceCx = faceX + faceW / 2;
    tag.pivot.set(faceCx, 0);
    tag.position.set(cx, L.tagY);
    tag.rotation = cx < W / 2 ? -0.035 : 0.035;
    scene.addChild(tag);

    const line1 = (text: string, color: number, size = 26): PIXI.Text => {
      const t = makeText('title', text, color, { size });
      t.anchor.set(0.5);
      t.position.set(faceCx, tagH * 0.36);
      fitTextWidth(t, faceW - 8);
      tag.addChild(t);
      return t;
    };
    const line2 = (text: string, color: number): PIXI.Text => {
      const t = makeText('caption', text, color, { size: 22, fontWeight: '600' });
      t.anchor.set(0.5);
      t.position.set(faceCx, tagH * 0.68);
      fitTextWidth(t, faceW - 8);
      tag.addChild(t);
      return t;
    };

    const btnX = cx - L.btnW / 2;
    if (isLocked) {
      line1('二号坛位', INK_SOFT);
      line2('再添一口坛', MUTED);
      const canBuy = save.money >= SECOND_JAR_COST;
      const buyBtn = makeCoinButton({
        prefix: '添置',
        price: SECOND_JAR_COST,
        width: L.btnW,
        height: L.btnH,
        skin: canBuy ? 'gold' : 'cream',
        textColor: canBuy ? INK : 0x8A7358,
        fontSize: 26,
        onReady: this._scheduleRelayout,
        silent: !canBuy,
      });
      buyBtn.position.set(btnX, L.btnY);
      buyBtn.on('pointertap', () => {
        if (KitchenManager.buySecondJar()) {
          analytics.trackPickleAction({
            action: 'buy_jar',
            slotIndex: 1,
            pickleTier: pickleTier(KitchenManager.save),
            costGold: SECOND_JAR_COST,
          });
          if (this._isOpen) this.relayout();
        }
      });
      scene.addChild(buyBtn);
      return;
    }

    if (view.status === 'empty') {
      line1('空坛', INK);
      line2('选下面的配方', MUTED);
      return;
    }

    const formula = view.formula!;
    if (view.status === 'fermenting') {
      const timer = makeText('title', `还要 ${formatTimerShort(view.remainMs)}`, RED_INK, { size: 25 });
      timer.anchor.set(0.5);
      timer.position.set(faceCx, tagH * 0.34);
      fitTextWidth(timer, faceW - 8);
      tag.addChild(timer);
      const bar = makeHandProgressBar({
        width: faceW - 16,
        height: 18,
        ratio: Math.max(0.06, view.progress),
        onReady: this._scheduleRelayout,
      });
      bar.node.position.set(faceX + 8, tagH * 0.58);
      tag.addChild(bar.node);
      this._liveJars.push({
        readyAt: view.slot!.readyAt,
        startedAt: view.slot!.startedAt,
        durationMs: formula.durationMs,
        timerText: timer,
        setRatio: bar.setRatio,
      });

      const adLeft = dailyAdLeft(save, 'pickle_boost');
      const canBoost = canUseDailyAd(save, 'pickle_boost');
      const boostBtn = makeAdButton({
        label: '催熟+1份',
        width: L.btnW,
        height: L.btnH,
        skin: 'gold',
        badge: `${adLeft}/${DAILY_AD_LIMITS.pickle_boost}`,
        disabled: !canBoost,
        onReady: this._scheduleRelayout,
      });
      boostBtn.position.set(btnX, L.btnY);
      boostBtn.on('pointertap', () => {
        if (this._adBusy) return;
        if (!canBoost) {
          Platform.showToast('今日催熟次数已用完，明天再来');
          return;
        }
        this._adBusy = true;
        Platform.showRewardedVideo(
          'pickle_boost',
          () => {
            this._adBusy = false;
            if (KitchenManager.boostPickleJar(view.index)) {
              analytics.trackPickleAction({
                action: 'ad_boost',
                formulaId: formula.id,
                outputDefId: formula.outputDefId,
                slotIndex: view.index,
                pickleTier: pickleTier(KitchenManager.save),
                qty: view.yieldQty + 1,
              });
            }
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      scene.addChild(boostBtn);
      // 坛口挂个小名牌：坛里腌的是什么
      const nameT = makeText('caption', `${formula.name} ×${view.yieldQty}`, CREAM, { size: 22, fontWeight: '700', stroke: 0x3A2414, strokeWidth: 4 });
      nameT.anchor.set(0.5);
      nameT.position.set(cx, L.shelfTop - L.jarH - 14);
      scene.addChild(nameT);
      return;
    }

    // READY
    line1('腌好了！', GREEN_INK, 28);
    line2(`${formula.name} ×${view.yieldQty}${view.slot?.boosted ? ' 加量' : ''}`, INK_SOFT);
    const harvestBtn = makeSlicedButton({
      label: '开坛收菜',
      width: L.btnW,
      height: L.btnH,
      skin: 'olive',
      fontSize: 28,
      onReady: this._scheduleRelayout,
    });
    harvestBtn.position.set(btnX, L.btnY);
    harvestBtn.on('pointertap', () => {
      const idx = view.index;
      const from = this._jarCenters[idx] ?? { x: Game.designWidth / 2, y: Game.logicHeight * 0.35 };
      const res = KitchenManager.harvestPickleJar(idx);
      if (!res.ok) return;
      analytics.trackPickleAction({
        action: 'harvest',
        formulaId: formula.id,
        outputDefId: res.outputDefId,
        slotIndex: idx,
        pickleTier: pickleTier(KitchenManager.save),
        qty: res.qty,
        foldGold: res.foldGold,
        unlockedRecipeId: res.unlockedRecipeId,
      });
      playRewardCollect({
        gold: 0,
        foldGold: res.foldGold,
        foodDefId: res.outputDefId,
        foodFolded: res.foodFolded,
        from,
      });
      if (this._isOpen) this.relayout();
    });
    scene.addChild(harvestBtn);
  }

  // ── 墙上钉着的配方纸（上下端原样，中段拉伸） ─────────────────────────────
  private _drawSheet(scene: PIXI.Container, sheetH: number): void {
    const tex = gameTexture(ART.sheet);
    const sw = W - L.sheetX * 2;
    if (isTextureReady(tex)) {
      const plane = new PIXI.NineSlicePlane(tex, 0, 140, 0, 120);
      plane.width = sw;
      plane.height = sheetH;
      plane.position.set(L.sheetX, L.sheetTop);
      scene.addChild(plane);
    } else {
      const g = new PIXI.Graphics();
      g.lineStyle(2, 0xB59A74, 1);
      g.beginFill(0xF8ECD2, 1);
      g.drawRect(L.sheetX, L.sheetTop, sw, sheetH);
      g.endFill();
      scene.addChild(g);
    }
  }

  private _drawSheetHeader(scene: PIXI.Container, save: typeof KitchenManager.save): void {
    const cy = L.sheetTop + 58;
    const title = makeText('display', '老卤配方', INK, { size: 34 });
    title.anchor.set(0, 0.5);
    title.position.set(L.contentX, cy);
    scene.addChild(title);

    // 右侧：当前坛 + 升阶（文字直接写在纸上，不加框）
    const tierName = PICKLE_TIER_DEFS[pickleTier(save)].name;
    const st = pickleUpgradeState(save);
    const btnW = 168;
    const btnH = 50;
    if (st.status === 'max') {
      const done = makeText('heading', `${tierName} · 已满阶`, 0x9A5A06, { size: 24 });
      done.anchor.set(1, 0.5);
      done.position.set(L.contentR, cy);
      scene.addChild(done);
    } else {
      const ready = st.status === 'ready';
      const lockedByLevel = cookLevel(save) < st.cookNeed;
      const btn = lockedByLevel
        ? makeSlicedButton({
          label: `${st.cookNeed}级可升`,
          width: btnW,
          height: btnH,
          skin: 'cream',
          textColor: 0x8A7358,
          fontSize: 22,
          silent: true,
          onReady: this._scheduleRelayout,
        })
        : makeCoinButton({
          prefix: '升阶',
          price: st.cost,
          width: btnW,
          height: btnH,
          skin: ready ? 'gold' : 'cream',
          textColor: ready ? INK : 0x8A7358,
          fontSize: 22,
          onReady: this._scheduleRelayout,
          silent: !ready,
        });
      btn.position.set(L.contentR - btnW, cy - btnH / 2);
      btn.on('pointertap', () => {
        if (!ready) {
          Platform.showToast(`下一阶：${st.nextDesc}`);
          return;
        }
        const cost = st.cost;
        if (KitchenManager.upgradePickleJar()) {
          const nextSave = KitchenManager.save;
          const nextTier = pickleTier(nextSave);
          analytics.trackPickleAction({
            action: 'upgrade_tier',
            pickleTier: nextTier,
            costGold: cost,
          });
          analytics.trackKitchenUpgrade({
            targetType: 'pickle_jar',
            targetId: 'pickle_jar',
            newLevel: nextTier + 1,
            costGold: cost,
            cookLevel: cookLevel(nextSave),
          });
          if (this._isOpen) this.relayout();
        }
      });
      scene.addChild(btn);
      const tn = makeText('body', tierName, MUTED, { size: 24 });
      tn.anchor.set(1, 0.5);
      tn.position.set(L.contentR - btnW - 12, cy);
      scene.addChild(tn);
    }

    const div = this._sprite(ART.divider, L.contentR - L.contentX);
    if (div) {
      div.height = 14;
      div.alpha = 0.7;
      div.position.set(L.contentX, L.sheetTop + L.headerH - 12);
      scene.addChild(div);
    }
  }

  // ── 配方一行：瓷碟上的成品 / 名称+朱印 / 食材 / 按钮+沙漏 ─────────────────
  private _drawFormulaRow(
    scene: PIXI.Container,
    formula: PickleFormulaDef,
    y: number,
    hasEmptyJar: boolean,
    divider: boolean,
  ): void {
    const status = pickleFormulaStatus(KitchenManager.save, formula.id);
    const locked = !status.levelMet;
    const row = new PIXI.Container();
    row.position.set(0, y);
    scene.addChild(row);
    const fade = (o: PIXI.DisplayObject): void => {
      if (locked) o.alpha = 0.45;
    };

    // 瓷碟 + 成品（轮廓光紧贴成品自身边缘，不弄脏青花瓷碟与米黄宣纸）
    const plateW = 122;
    const plateX = L.contentX - 6;
    const plate = this._sprite(ART.plate, plateW);
    const plateCy = 74;
    const dish = new PIXI.Container();
    const outRarity = itemRarity(formula.outputDefId);
    const canStartNow = !locked && hasEmptyJar && status.canAffordInputs;
    if (plate) {
      plate.anchor.set(0.5);
      plate.position.set(plateX + plateW / 2, plateCy);
      dish.addChild(plate);
    }
    const out = this._sprite(resolveItemAssetPath(formula.outputDefId), 72, 72);
    if (out) {
      out.anchor.set(0.5, 1);
      out.position.set(plateX + plateW / 2, plateCy + 14);
      dish.addChild(out);
      attachSpriteContour(dish, out, outRarity, { selected: canStartNow });
    }
    const qty = makeText('number', `×${formula.baseQty}`, RED_INK, { size: 24, stroke: 0xFFF8EA, strokeWidth: 5 });
    qty.anchor.set(1, 1);
    qty.position.set(plateX + plateW + 2, plateCy + 40);
    dish.addChild(qty);
    fade(dish);
    dish.eventMode = 'static';
    dish.cursor = 'pointer';
    dish.hitArea = new PIXI.Rectangle(plateX, 6, plateW, 108);
    dish.on('pointertap', () => {
      AudioManager.play('ui_click');
      const v = inspectFromItem(formula.outputDefId);
      if (v) v.note = `${v.note ?? ''} · 老坛腌制出品`;
      this._inspect = v;
      this.relayout();
    });
    row.addChild(dish);

    // 右：按钮 + 沙漏时长
    const btnW = 150;
    const btnH = 56;
    const btnX = L.contentR - btnW;
    const btnY = 16;
    const effMs = pickleEffectiveDurationMs(KitchenManager.save, formula.durationMs);
    const time = new PIXI.Container();
    const tt = makeText('caption', formatDurationLabel(effMs), MUTED, { size: 22, fontWeight: '600' });
    tt.anchor.set(0, 0.5);
    const hg = this._sprite(ART.hourglass, 18, 26);
    let tx = 0;
    if (hg) {
      hg.anchor.set(0, 0.5);
      time.addChild(hg);
      tx = 24;
    }
    tt.position.set(tx, 0);
    time.addChild(tt);
    time.position.set(btnX + btnW / 2 - (tx + tt.width) / 2, btnY + btnH + 22);
    row.addChild(time);

    // 中：名称 + 朱红「送谱」印 + 可点击菜品小碟
    const midX = plateX + plateW + 22;
    const name = makeText('title', formula.name, INK, { size: 30 });
    name.position.set(midX, 14);
    fitTextWidth(name, btnX - midX - 112);
    fade(name);
    row.addChild(name);

    const sigRecipe = recipeById(formula.unlockRecipeId);
    if (sigRecipe && !status.recipeAlreadyUnlocked) {
      const sealS = 46;
      const dishR = 23;
      const giftX = midX + name.width + 10;
      const giftGroup = new PIXI.Container();
      giftGroup.position.set(giftX, 32);

      const seal = new PIXI.Container();
      const sealSp = this._sprite(ART.seal, sealS, sealS);
      if (sealSp) seal.addChild(sealSp);
      const st = makeText('caption', '送谱', 0xFFF4E6, { size: 19, fontWeight: '700' });
      st.anchor.set(0.5);
      st.position.set(sealS / 2, sealS / 2);
      seal.addChild(st);
      seal.pivot.set(sealS / 2, sealS / 2);
      seal.rotation = -0.1;
      seal.position.set(sealS / 2, 0);
      giftGroup.addChild(seal);

      let totalGiftW = sealS;
      const dTex = dishTexture(sigRecipe.id);
      if (giftX + sealS + dishR * 2 + 10 <= btnX) {
        const dishCx = sealS + 8 + dishR;
        if (isTextureReady(dTex)) {
          const ds = new PIXI.Sprite(dTex);
          fitSpriteInBox(ds, 46, 46);
          ds.anchor.set(0.5);
          ds.position.set(dishCx, 0);
          giftGroup.addChild(ds);
          attachSpriteContour(giftGroup, ds, sigRecipe.rarity, { thicknessScale: 0.78 });
        }
        totalGiftW = dishCx + dishR;
      }

      giftGroup.eventMode = 'static';
      giftGroup.cursor = 'pointer';
      giftGroup.hitArea = new PIXI.Rectangle(-6, -28, totalGiftW + 12, 56);
      giftGroup.on('pointertap', () => {
        AudioManager.play('ui_click');
        const v = inspectFromRecipe(sigRecipe.id);
        if (v) v.note = '首坛揭盖即送此菜谱';
        this._inspect = v;
        this.relayout();
      });
      row.addChild(giftGroup);
    }

    // 食材：图标 + 墨字数量（缺的写红字），不加框
    let ix = midX;
    const iy = 86;
    for (const inp of status.inputs) {
      const ok = inp.have >= inp.need;
      const g = new PIXI.Container();
      const ic = this._sprite(resolveItemAssetPath(inp.defId), 46, 46);
      if (ic) {
        ic.anchor.set(0.5);
        ic.position.set(23, 0);
        g.addChild(ic);
      }
      const cnt = makeText('number', `${inp.have}/${inp.need}`, ok ? GREEN_INK : RED_INK, { size: 26 });
      cnt.anchor.set(0, 0.5);
      cnt.position.set(50, 1);
      g.addChild(cnt);
      g.position.set(ix, iy);
      fade(g);
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.hitArea = new PIXI.Rectangle(-4, -28, 54 + cnt.width, 56);
      g.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._inspect = inspectFromItem(inp.defId);
        this.relayout();
      });
      row.addChild(g);
      ix += 54 + Math.ceil(cnt.width) + 22;
    }

    if (locked) {
      const lt = makeText('heading', `厨艺${formula.unlockCookLevel}级`, MUTED, { size: 26 });
      lt.anchor.set(0.5);
      lt.position.set(btnX + btnW / 2, btnY + btnH / 2 - 10);
      const lt2 = makeText('caption', '解锁', MUTED, { size: 22 });
      lt2.anchor.set(0.5);
      lt2.position.set(btnX + btnW / 2, btnY + btnH / 2 + 20);
      row.addChild(lt, lt2);
      time.alpha = 0.45;
    } else {
      const canStart = hasEmptyJar && status.canAffordInputs;
      const startBtn = makeSlicedButton({
        label: !hasEmptyJar ? '坛已满' : status.canAffordInputs ? '下坛' : '菜不够',
        width: btnW,
        height: btnH,
        skin: canStart ? 'terracotta' : 'cream',
        textColor: canStart ? 0xFFF8F0 : 0x8A7358,
        fontSize: 26,
        onReady: this._scheduleRelayout,
        silent: !canStart,
      });
      startBtn.position.set(btnX, btnY);
      startBtn.on('pointertap', () => {
        if (!canStart) {
          AudioManager.play('ui_deny');
          Platform.showToast(!hasEmptyJar ? '两口坛都在腌，开坛后再下' : '食材还不够，点食材看看去哪儿捡');
          return;
        }
        if (KitchenManager.startPickleJar(formula.id)) {
          analytics.trackPickleAction({
            action: 'start',
            formulaId: formula.id,
            outputDefId: formula.outputDefId,
            pickleTier: pickleTier(KitchenManager.save),
            qty: formula.baseQty,
          });
          if (this._isOpen) this.relayout();
        }
      });
      row.addChild(startBtn);
    }

    if (divider) {
      const div = this._sprite(ART.divider, L.contentR - L.contentX);
      if (div) {
        div.height = 10;
        div.alpha = 0.32;
        div.position.set(L.contentX, L.rowH - 6);
        row.addChild(div);
      }
    }
  }
}
