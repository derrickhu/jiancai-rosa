import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  DAILY_AD_LIMITS,
  PICKLE_FORMULAS,
  SECOND_JAR_COST,
  canUseDailyAd,
  dailyAdLeft,
  formatDurationLabel,
  formatTimerShort,
  itemRarity,
  pickleFormulaStatus,
  pickleSlotsView,
  recipeById,
  type PickleFormulaDef,
  type PickleSlotView,
} from '@/sim';
import { playRewardCollect } from '@/utils/coinCollect';
import {
  P0_ART,
  P2_ART,
  drawRarityFrame,
  fillRect,
  makeAdButton,
  makeLabel,
  makeRarityFlare,
  makeSlicedButton,
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

const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const MUTED = 0x7A5A34;
const PAPER = 0xFFF8F0;
const CREAM = 0xF6EDE0;
const WALNUT = 0x8B5A2B;
const LINE = 0xC4A574;
const TERRACOTTA = 0xC46A3A;
const OLIVE = 0x4E8A42;
const GOLD = 0xC48A14;
const COIN_ICON = 'subpkg_images/hud_coin.png';

interface LiveJarHud {
  slotIndex: 0 | 1;
  readyAt: number;
  startedAt: number;
  durationMs: number;
  timerText: PIXI.Text;
  barFill: PIXI.Graphics;
  barW: number;
  barH: number;
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
    this._root.removeChildren();
  }

  private _startTick(): void {
    this._stopTick();
    this._tickTimer = setInterval(() => {
      if (!this._isOpen) return;
      const now = Date.now();
      let crossedReady = false;
      for (const hud of this._liveJars) {
        if (hud.timerText.destroyed || hud.barFill.destroyed) continue;
        const remain = Math.max(0, hud.readyAt - now);
        if (remain <= 0) {
          crossedReady = true;
          break;
        }
        hud.timerText.text = `发酵中 · 剩 ${formatTimerShort(remain)}`;
        const total = Math.max(1, hud.readyAt - hud.startedAt || hud.durationMs);
        const ratio = Math.min(1, Math.max(0.05, 1 - remain / total));
        this._paintProgressBar(hud.barFill, hud.barW, hud.barH, ratio);
      }
      if (crossedReady && !this._adBusy) {
        this.relayout();
      }
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
    const paths: string[] = [
      P2_ART.pickleIdle,
      P2_ART.pickleReady,
      P0_ART.adClapper,
      COIN_ICON,
      'subpkg_kitchen/ui_pickup_flare.png',
    ];
    for (const f of PICKLE_FORMULAS) {
      paths.push(resolveItemAssetPath(f.outputDefId));
      paths.push(resolveDishAssetPath(f.unlockRecipeId));
      for (const inp of f.inputs) paths.push(resolveItemAssetPath(inp.defId));
    }
    watchTextures(paths, this._scheduleRelayout);
  }

  relayout(): void {
    this._root.removeChildren();
    this._liveJars = [];
    this._jarCenters = [];
    if (!this._isOpen) return;
    this._warmAssets();

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.52;
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

    const boxW = Math.min(w - 32, 704);
    const padX = 22;
    const cw = boxW - padX * 2;
    const headH = 84;
    const jarCardH = 264;
    const divH = 34;
    const rowH = 138;
    const rowGap = 10;
    const rowsBlockH = PICKLE_FORMULAS.length * rowH + (PICKLE_FORMULAS.length - 1) * rowGap;
    const boxH = headH + jarCardH + divH + rowsBlockH + 24;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 8, (h - boxH) / 2));

    const shell = new PIXI.Container();
    shell.position.set(bx, by);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, boxW, boxH);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);

    const panel = new PIXI.Graphics();
    panel.lineStyle(5, WALNUT, 1);
    panel.beginFill(CREAM, 1);
    panel.drawRoundedRect(0, 0, boxW, boxH, 28);
    panel.endFill();
    shell.addChild(panel);

    const inner = new PIXI.Graphics();
    inner.lineStyle(2, LINE, 0.72);
    inner.beginFill(0xF3E6D0, 1);
    inner.drawRoundedRect(12, 12, boxW - 24, boxH - 24, 20);
    inner.endFill();
    shell.addChild(inner);

    // Top plaque header
    const plaqueW = 312;
    const plaqueH = 46;
    const plaque = new PIXI.Graphics();
    plaque.lineStyle(3, INK, 1);
    plaque.beginFill(0x8B5A2B, 1);
    plaque.drawRoundedRect((boxW - plaqueW) / 2, 16, plaqueW, plaqueH, 14);
    plaque.endFill();
    shell.addChild(plaque);

    const title = makeLabel('老 坛 腌 制 坊', 28, 0xFFF8F0, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 4,
    });
    title.anchor.set(0.5);
    title.position.set(boxW / 2, 39);
    shell.addChild(title);

    const sub = makeLabel('余菜封水慢发酵 · 首坛揭盖送私房大菜谱', 15, MUTED, { fontWeight: '700' });
    sub.anchor.set(0.5);
    sub.position.set(boxW / 2, 71);
    shell.addChild(sub);

    // Top-right close button
    const closeBtn = new PIXI.Container();
    const cg = new PIXI.Graphics();
    cg.lineStyle(3, INK, 1);
    cg.beginFill(TERRACOTTA, 1);
    cg.drawCircle(20, 20, 19);
    cg.endFill();
    const cx = makeLabel('×', 26, PAPER, { fontWeight: '700' });
    cx.anchor.set(0.5);
    cx.position.set(20, 18.5);
    closeBtn.addChild(cg, cx);
    closeBtn.position.set(boxW - 56, 19);
    closeBtn.eventMode = 'static';
    closeBtn.cursor = 'pointer';
    closeBtn.hitArea = new PIXI.Circle(20, 20, 24);
    closeBtn.on('pointertap', () => {
      if (!this._adBusy) this.close();
    });
    shell.addChild(closeBtn);

    const save = KitchenManager.save;
    const now = Date.now();
    const slots = pickleSlotsView(save, now);
    const jarGap = 14;
    const jarW = Math.floor((cw - jarGap) / 2);

    slots.forEach((slotView, idx) => {
      const jx = padX + idx * (jarW + jarGap);
      const jy = headH;
      this._jarCenters[idx] = { x: bx + jx + jarW / 2, y: by + jy + 92 };
      shell.addChild(this._buildJarCard(slotView, jx, jy, jarW, jarCardH));
    });

    // Section divider
    const divY = headH + jarCardH + divH / 2;
    const divLine = new PIXI.Graphics();
    divLine.lineStyle(1.5, LINE, 0.8);
    divLine.moveTo(padX + 12, divY);
    divLine.lineTo(boxW / 2 - 142, divY);
    divLine.moveTo(boxW / 2 + 142, divY);
    divLine.lineTo(boxW - padX - 12, divY);
    shell.addChild(divLine);

    const divLabel = makeLabel('传家老卤方子（点菜品或原料可看详情）', 15, MUTED, { fontWeight: '700' });
    divLabel.anchor.set(0.5);
    divLabel.position.set(boxW / 2, divY);
    shell.addChild(divLabel);

    const hasEmptyJar = slots.some((s) => s.status === 'empty');
    const listTop = headH + jarCardH + divH;
    PICKLE_FORMULAS.forEach((formula, i) => {
      const ry = listTop + i * (rowH + rowGap);
      shell.addChild(this._buildFormulaRow(formula, padX, ry, cw, rowH, hasEmptyJar));
    });

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

  private _paintProgressBar(g: PIXI.Graphics, w: number, h: number, ratio: number): void {
    g.clear();
    const fillW = Math.max(h, Math.round(w * Math.min(1, Math.max(0, ratio))));
    g.beginFill(0xD98A2B, 1);
    g.drawRoundedRect(0, 0, fillW, h, h / 2);
    g.endFill();
  }

  private _buildJarCard(view: PickleSlotView, x: number, y: number, w: number, h: number): PIXI.Container {
    const card = new PIXI.Container();
    card.position.set(x, y);

    const isReady = view.status === 'ready';
    const bg = new PIXI.Graphics();
    bg.lineStyle(isReady ? 3.5 : 2.5, isReady ? GOLD : WALNUT, 1);
    bg.beginFill(isReady ? 0xFFFBF0 : PAPER, 1);
    bg.drawRoundedRect(0, 0, w, h, 18);
    bg.endFill();
    card.addChild(bg);

    const slotTitle = view.index === 0 ? '一号老坛' : '二号老坛';
    const save = KitchenManager.save;

    if (view.status === 'locked') {
      const hdr = makeLabel(`${slotTitle} · 待添置`, 18, MUTED, { fontWeight: '700' });
      hdr.anchor.set(0.5, 0);
      hdr.position.set(w / 2, 12);
      card.addChild(hdr);

      const jarTex = gameTexture(P2_ART.pickleIdle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 118, 118);
        spr.anchor.set(0.5);
        spr.position.set(w / 2, 102);
        spr.tint = 0xC9B8A4;
        spr.alpha = 0.72;
        card.addChild(spr);
      }
      const desc = makeLabel('双坛齐发，酸菜剁椒两不误', 14, MUTED, { fontWeight: '600' });
      desc.anchor.set(0.5);
      desc.position.set(w / 2, 180);
      card.addChild(desc);

      const canBuy = save.money >= SECOND_JAR_COST;
      const buyBtn = makeSlicedButton({
        label: `添置 · ${SECOND_JAR_COST} 金`,
        width: w - 28,
        height: 48,
        skin: canBuy ? 'wood' : 'cream',
        textColor: canBuy ? PAPER : 0x8A7358,
        labelOffsetX: 12,
        onReady: this._scheduleRelayout,
        silent: !canBuy,
      });
      const cTex = gameTexture(COIN_ICON);
      if (isTextureReady(cTex)) {
        const cs = new PIXI.Sprite(cTex);
        fitSpriteInBox(cs, 28, 28);
        cs.anchor.set(0.5);
        cs.position.set(36, 24);
        cs.eventMode = 'none';
        buyBtn.addChild(cs);
      }
      buyBtn.position.set(14, h - 60);
      buyBtn.on('pointertap', () => {
        if (KitchenManager.buySecondJar() && this._isOpen) this.relayout();
      });
      card.addChild(buyBtn);
      return card;
    }

    if (view.status === 'empty') {
      const hdr = makeLabel(`${slotTitle} · 空闲中`, 18, INK, { fontWeight: '700' });
      hdr.anchor.set(0.5, 0);
      hdr.position.set(w / 2, 12);
      card.addChild(hdr);

      const jarTex = gameTexture(P2_ART.pickleIdle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 130, 130);
        spr.anchor.set(0.5);
        spr.position.set(w / 2, 112);
        card.addChild(spr);
      }

      const pill = new PIXI.Graphics();
      pill.lineStyle(1.5, LINE, 0.9);
      pill.beginFill(CREAM, 1);
      pill.drawRoundedRect(18, h - 54, w - 36, 38, 19);
      pill.endFill();
      card.addChild(pill);

      const hint = makeLabel('挑下方老卤方子封水入坛', 15, MUTED, { fontWeight: '700' });
      hint.anchor.set(0.5);
      hint.position.set(w / 2, h - 35);
      card.addChild(hint);
      return card;
    }

    const formula = view.formula!;
    if (view.status === 'fermenting') {
      const hdr = makeLabel(`${slotTitle} · ${formula.name}×${view.yieldQty}`, 18, INK, { fontWeight: '700' });
      hdr.anchor.set(0.5, 0);
      hdr.position.set(w / 2, 10);
      card.addChild(hdr);

      const jarTex = gameTexture(P2_ART.pickleIdle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 108, 108);
        spr.anchor.set(0.5);
        spr.position.set(w / 2 - 14, 92);
        card.addChild(spr);
      }
      // Output item mini badge
      const outTex = itemTexture(formula.outputDefId);
      if (isTextureReady(outTex)) {
        const badgeBg = new PIXI.Graphics();
        badgeBg.lineStyle(2.5, WALNUT, 1);
        badgeBg.beginFill(PAPER, 1);
        badgeBg.drawCircle(w / 2 + 46, 116, 26);
        badgeBg.endFill();
        const os = new PIXI.Sprite(outTex);
        fitSpriteInBox(os, 38, 38);
        os.anchor.set(0.5);
        os.position.set(w / 2 + 46, 116);
        card.addChild(badgeBg, os);
      }

      const timerText = makeLabel(`发酵中 · 剩 ${formatTimerShort(view.remainMs)}`, 15, TERRACOTTA, {
        fontWeight: '700',
      });
      timerText.anchor.set(0.5);
      timerText.position.set(w / 2, 160);
      card.addChild(timerText);

      const barW = w - 36;
      const barH = 14;
      const barBg = new PIXI.Graphics();
      barBg.lineStyle(1.5, WALNUT, 0.8);
      barBg.beginFill(0xE8D8C0, 1);
      barBg.drawRoundedRect(18, 176, barW, barH, barH / 2);
      barBg.endFill();
      card.addChild(barBg);

      const barFill = new PIXI.Graphics();
      barFill.position.set(18, 176);
      this._paintProgressBar(barFill, barW, barH, Math.max(0.05, view.progress));
      card.addChild(barFill);

      this._liveJars.push({
        slotIndex: view.index,
        readyAt: view.slot!.readyAt,
        startedAt: view.slot!.startedAt,
        durationMs: formula.durationMs,
        timerText,
        barFill,
        barW,
        barH,
      });

      const adLeft = dailyAdLeft(save, 'pickle_boost');
      const canBoost = canUseDailyAd(save, 'pickle_boost');
      const boostBtn = makeAdButton({
        label: '秘方催熟 +1份',
        width: w - 28,
        height: 48,
        skin: 'terracotta',
        badge: `剩${adLeft}/${DAILY_AD_LIMITS.pickle_boost}`,
        disabled: !canBoost,
        onReady: this._scheduleRelayout,
      });
      boostBtn.position.set(14, h - 60);
      boostBtn.on('pointertap', () => {
        if (this._adBusy) return;
        if (!canBoost) {
          Platform.showToast('今日秘方催熟次数已用完，明天再来');
          return;
        }
        this._adBusy = true;
        Platform.showRewardedVideo(
          'pickle_boost',
          () => {
            this._adBusy = false;
            KitchenManager.boostPickleJar(view.index);
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      card.addChild(boostBtn);
      return card;
    }

    // READY state!
    const bonusMark = view.slot?.boosted ? '（秘方加量！）' : '';
    const hdr = makeLabel(`${formula.name}×${view.yieldQty}${bonusMark}`, 17, GOLD, { fontWeight: '700' });
    hdr.anchor.set(0.5, 0);
    hdr.position.set(w / 2, 10);
    card.addChild(hdr);

    const flare = makeRarityFlare(itemRarity(formula.outputDefId), 190);
    flare.position.set(w / 2, 102);
    card.addChild(flare);

    const readyTex = gameTexture(P2_ART.pickleReady);
    if (isTextureReady(readyTex)) {
      const spr = new PIXI.Sprite(readyTex);
      fitSpriteInBox(spr, 122, 122);
      spr.anchor.set(0.5);
      spr.position.set(w / 2, 102);
      card.addChild(spr);
      TweenManager.to({
        target: spr.scale,
        props: { x: spr.scale.x * 1.05, y: spr.scale.y * 1.05 },
        duration: 0.65,
        ease: Ease.easeInOutQuad,
      });
    }

    const readySub = makeLabel('老卤发透 · 酸香扑鼻！', 15, OLIVE, { fontWeight: '700' });
    readySub.anchor.set(0.5);
    readySub.position.set(w / 2, 176);
    card.addChild(readySub);

    const harvestBtn = makeSlicedButton({
      label: `揭盖收菜 ×${view.yieldQty}`,
      width: w - 28,
      height: 50,
      skin: 'terracotta',
      textColor: PAPER,
      onReady: this._scheduleRelayout,
    });
    harvestBtn.position.set(14, h - 62);
    harvestBtn.on('pointertap', () => {
      const from = this._jarCenters[view.index] ?? { x: Game.designWidth / 2, y: Game.logicHeight * 0.35 };
      const res = KitchenManager.harvestPickleJar(view.index);
      if (!res.ok) return;
      playRewardCollect({
        gold: 0,
        foldGold: res.foldGold,
        foodDefId: res.outputDefId,
        foodFolded: res.foodFolded,
        from,
      });
      if (this._isOpen) this.relayout();
    });
    card.addChild(harvestBtn);
    return card;
  }

  private _buildFormulaRow(
    formula: PickleFormulaDef,
    x: number,
    y: number,
    w: number,
    h: number,
    hasEmptyJar: boolean,
  ): PIXI.Container {
    const row = new PIXI.Container();
    row.position.set(x, y);

    const status = pickleFormulaStatus(KitchenManager.save, formula.id);
    const bg = new PIXI.Graphics();
    bg.lineStyle(2, status.levelMet ? LINE : 0xD8CABA, 1);
    bg.beginFill(status.levelMet ? PAPER : 0xF5EFE6, 1);
    bg.drawRoundedRect(0, 0, w, h, 16);
    bg.endFill();
    row.addChild(bg);

    // Left output pickled icon box (tap to inspect)
    const iconBox = new PIXI.Container();
    iconBox.position.set(14, 14);
    const ibg = new PIXI.Graphics();
    ibg.beginFill(CREAM, 1);
    ibg.drawRoundedRect(0, 0, 84, 84, 14);
    ibg.endFill();
    drawRarityFrame(ibg, 0, 0, 84, 84, itemRarity(formula.outputDefId), { radius: 14 });
    iconBox.addChild(ibg);

    const outTex = itemTexture(formula.outputDefId);
    if (isTextureReady(outTex)) {
      const sp = new PIXI.Sprite(outTex);
      fitSpriteInBox(sp, 68, 68);
      sp.anchor.set(0.5);
      sp.position.set(42, 42);
      if (!status.levelMet) sp.alpha = 0.55;
      iconBox.addChild(sp);
    }
    iconBox.eventMode = 'static';
    iconBox.cursor = 'pointer';
    iconBox.hitArea = new PIXI.Rectangle(0, 0, 84, 84);
    iconBox.on('pointertap', () => {
      AudioManager.play('ui_click');
      const v = inspectFromItem(formula.outputDefId);
      if (v) v.note = `${v.note ?? ''} · 老坛腌制出品`;
      this._inspect = v;
      this.relayout();
    });
    row.addChild(iconBox);

    // Duration pill under icon
    const durLbl = makeLabel(`⏱ ${formatDurationLabel(formula.durationMs)}`, 13, MUTED, { fontWeight: '700' });
    durLbl.anchor.set(0.5, 0);
    durLbl.position.set(56, 105);
    row.addChild(durLbl);

    // Middle info column
    const midX = 112;
    const nameLbl = makeLabel(`${formula.name} ×${formula.baseQty}`, 21, status.levelMet ? INK : 0x8A7358, {
      fontWeight: '700',
    });
    nameLbl.position.set(midX, 12);
    row.addChild(nameLbl);

    // Signature dish unlock badge (clickable to inspect dish!)
    const sigRecipe = recipeById(formula.unlockRecipeId);
    if (sigRecipe) {
      const chip = new PIXI.Container();
      const chipText = status.recipeAlreadyUnlocked
        ? `招牌：${sigRecipe.name} ✓`
        : `首坛送谱：${sigRecipe.name}`;
      const clbl = makeLabel(chipText, 13, status.recipeAlreadyUnlocked ? OLIVE : TERRACOTTA, {
        fontWeight: '700',
      });
      const cw = Math.ceil(clbl.width) + 36;
      const ch = 24;
      const cbg = new PIXI.Graphics();
      cbg.lineStyle(1.5, status.recipeAlreadyUnlocked ? OLIVE : TERRACOTTA, 0.85);
      cbg.beginFill(status.recipeAlreadyUnlocked ? 0xEEF7EA : 0xFFF2E8, 1);
      cbg.drawRoundedRect(0, 0, cw, ch, ch / 2);
      cbg.endFill();
      chip.addChild(cbg);

      const dTex = dishTexture(sigRecipe.id);
      if (isTextureReady(dTex)) {
        const ds = new PIXI.Sprite(dTex);
        fitSpriteInBox(ds, 20, 20);
        ds.anchor.set(0.5);
        ds.position.set(14, ch / 2);
        chip.addChild(ds);
      }
      clbl.anchor.set(0, 0.5);
      clbl.position.set(26, ch / 2 + 0.5);
      chip.addChild(clbl);
      chip.position.set(midX + Math.ceil(nameLbl.width) + 10, 13);
      chip.eventMode = 'static';
      chip.cursor = 'pointer';
      chip.hitArea = new PIXI.Rectangle(0, -4, cw, ch + 8);
      chip.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._inspect = inspectFromRecipe(sigRecipe.id);
        this.relayout();
      });
      row.addChild(chip);
    }

    const blurbLbl = makeLabel(formula.blurb, 14, MUTED, {
      wordWrap: true,
      wordWrapWidth: w - midX - 168,
    });
    blurbLbl.position.set(midX, 42);
    row.addChild(blurbLbl);

    // Input ingredient chips row
    let ix = midX;
    const iy = 88;
    for (const inp of status.inputs) {
      const ok = inp.have >= inp.need;
      const ichip = new PIXI.Container();
      const itxt = makeLabel(`${inp.name} ${inp.have}/${inp.need}`, 14, ok ? OLIVE : 0xB84A32, {
        fontWeight: '700',
      });
      const iw = Math.ceil(itxt.width) + 40;
      const ih = 32;
      const ib = new PIXI.Graphics();
      ib.lineStyle(1.5, ok ? 0x7AB06A : 0xD89A88, 1);
      ib.beginFill(ok ? 0xF3FAEF : 0xFDF2EE, 1);
      ib.drawRoundedRect(0, 0, iw, ih, ih / 2);
      ib.endFill();
      ichip.addChild(ib);

      const itex = itemTexture(inp.defId);
      if (isTextureReady(itex)) {
        const isp = new PIXI.Sprite(itex);
        fitSpriteInBox(isp, 24, 24);
        isp.anchor.set(0.5);
        isp.position.set(17, ih / 2);
        ichip.addChild(isp);
      }
      itxt.anchor.set(0, 0.5);
      itxt.position.set(31, ih / 2 + 0.5);
      ichip.addChild(itxt);
      ichip.position.set(ix, iy);
      ichip.eventMode = 'static';
      ichip.cursor = 'pointer';
      ichip.hitArea = new PIXI.Rectangle(0, 0, iw, ih);
      ichip.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._inspect = inspectFromItem(inp.defId);
        this.relayout();
      });
      row.addChild(ichip);
      ix += iw + 10;
    }

    // Right action button
    const btnW = 144;
    const btnH = 50;
    const btnX = w - btnW - 14;
    const btnY = Math.round((h - btnH) / 2);

    if (!status.levelMet) {
      const lockPill = new PIXI.Graphics();
      lockPill.lineStyle(1.5, 0xC9B8A4, 1);
      lockPill.beginFill(0xEAE0D2, 1);
      lockPill.drawRoundedRect(btnX, btnY + 4, btnW, 42, 21);
      lockPill.endFill();
      const ltxt = makeLabel(`厨艺 ${formula.unlockCookLevel} 级开`, 15, 0x8A7358, { fontWeight: '700' });
      ltxt.anchor.set(0.5);
      ltxt.position.set(btnX + btnW / 2, btnY + 25);
      row.addChild(lockPill, ltxt);
      return row;
    }

    const canStart = hasEmptyJar && status.canAffordInputs;
    const btnLabel = !hasEmptyJar ? '坛位已满' : status.canAffordInputs ? '封水下坛' : '鲜菜不足';
    const startBtn = makeSlicedButton({
      label: btnLabel,
      width: btnW,
      height: btnH,
      skin: canStart ? 'terracotta' : 'cream',
      textColor: canStart ? PAPER : 0x8A7358,
      onReady: this._scheduleRelayout,
      silent: !canStart,
    });
    if (!canStart) startBtn.alpha = 0.82;
    startBtn.position.set(btnX, btnY);
    startBtn.on('pointertap', () => {
      if (KitchenManager.startPickleJar(formula.id) && this._isOpen) {
        this.relayout();
      }
    });
    row.addChild(startBtn);
    return row;
  }
}
