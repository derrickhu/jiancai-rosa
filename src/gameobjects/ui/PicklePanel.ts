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
  P0_ART,
  P2_ART,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawItemSlotBox,
  drawRecessedWell,
  drawSectionTray,
  fillRect,
  makeAdButton,
  makeArtisanShell,
  makeLabel,
  makeOrnamentalDivider,
  makeRarityFlare,
  makeSlicedButton,
  makeSlotBadge,
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

const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const PAPER = 0xFFF8F0;
const TERRACOTTA = UI_PALETTE.terracotta;
const OLIVE = UI_PALETTE.olive;
const GOLD = 0xB87910;
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
        const ratio = Math.min(1, Math.max(0.06, 1 - remain / total));
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
    const tierArt = P2_ART.pickleTiers[pickleTier(KitchenManager.save)];
    const paths: string[] = [
      UI_KIT.headerRibbon,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      tierArt.idle,
      tierArt.ready,
      P2_ART.pickleIdle,
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
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.58;
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

    const boxW = Math.min(w - 30, 706);
    const padX = 24;
    const cw = boxW - padX * 2;
    const contentTop = 64;
    const tierBarH = 54;
    const jarTop = contentTop + tierBarH + 10;
    const jarCardH = 248;
    const divH = 36;
    const rowH = 118;
    const rowGap = 10;
    const rowsBlockH = PICKLE_FORMULAS.length * rowH + (PICKLE_FORMULAS.length - 1) * rowGap;
    const boxH = jarTop + jarCardH + divH + rowsBlockH + 24;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 14, (h - boxH) / 2 + 4));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '老 坛 腌 制 坊',
      onReady: this._scheduleRelayout,
      closeSilent: true,
      onClose: () => {
        if (!this._adBusy) this.close();
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    const save = KitchenManager.save;
    shell.addChild(this._buildTierBar(save, padX, contentTop, cw, tierBarH));

    const now = Date.now();
    const slots = pickleSlotsView(save, now);
    const jarGap = 14;
    const jarW = Math.floor((cw - jarGap) / 2);

    slots.forEach((slotView, idx) => {
      const jx = padX + idx * (jarW + jarGap);
      const jy = jarTop;
      this._jarCenters[idx] = { x: bx + jx + jarW / 2, y: by + jy + 102 };
      shell.addChild(this._buildJarCard(slotView, jx, jy, jarW, jarCardH));
    });

    const div = makeOrnamentalDivider(cw, '老卤配方 · 点图标查详情', { fontSize: 17 });
    div.position.set(padX, jarTop + jarCardH + Math.round(divH / 2));
    shell.addChild(div);

    const hasEmptyJar = slots.some((s) => s.status === 'empty');
    const listTop = jarTop + jarCardH + divH;
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
    const pad = 2;
    const fh = h - pad * 2;
    const fillW = Math.max(fh, Math.round((w - pad * 2) * Math.min(1, Math.max(0, ratio))));
    g.beginFill(0xDF9628, 1);
    g.drawRoundedRect(pad, pad, fillW, fh, fh / 2);
    g.endFill();
    g.beginFill(0xF7C665, 0.55);
    g.drawRoundedRect(pad + 3, pad + 1.5, Math.max(4, fillW - 6), Math.max(3, fh * 0.38), fh / 4);
    g.endFill();
  }

  private _buildTierBar(save: typeof KitchenManager.save, x: number, y: number, w: number, h: number): PIXI.Container {
    const bar = new PIXI.Container();
    bar.position.set(x, y);
    const bg = new PIXI.Graphics();
    drawSectionTray(bg, 0, 0, w, h, { radius: 13, tone: 'sand' });
    bar.addChild(bg);

    const curTier = pickleTier(save);
    const curDef = PICKLE_TIER_DEFS[curTier];
    const st = pickleUpgradeState(save);
    const lbl = makeLabel(`器物：${curDef.name}`, 18, INK, { fontWeight: '700' });
    lbl.anchor.set(0, 0.5);
    lbl.position.set(14, h / 2);
    bar.addChild(lbl);

    const perkChip = makeSlotBadge(
      st.status === 'max' ? '发酵-16% · 额外+1概率' : `升阶：${st.nextDesc.split('·')[0].trim()}`,
      st.status === 'max' ? 'gold' : 'olive',
      14,
    );
    perkChip.node.position.set(14 + Math.ceil(lbl.width) + 10, Math.round((h - perkChip.h) / 2));
    bar.addChild(perkChip.node);

    if (st.status === 'max') {
      const done = makeSlotBadge('✓ 御瓷满阶', 'gold', 15);
      done.node.position.set(w - done.w - 12, Math.round((h - done.h) / 2));
      bar.addChild(done.node);
    } else {
      const ready = st.status === 'ready';
      const btnText = ready
        ? `${st.cost}金 升阶`
        : cookLevel(save) < st.cookNeed
          ? `Lv.${st.cookNeed} 解锁`
          : `${st.cost}金 升阶`;
      const btnW = 144;
      const btnH = 40;
      const btn = makeSlicedButton({
        label: btnText,
        width: btnW,
        height: btnH,
        skin: ready ? 'gold' : 'cream',
        textColor: ready ? INK : 0x8A7358,
        fontSize: 17,
        silent: !ready,
        onReady: this._scheduleRelayout,
      });
      btn.position.set(w - btnW - 8, Math.round((h - btnH) / 2));
      btn.on('pointertap', () => {
        if (KitchenManager.upgradePickleJar() && this._isOpen) this.relayout();
      });
      bar.addChild(btn);
    }
    return bar;
  }

  private _buildJarCard(view: PickleSlotView, x: number, y: number, w: number, h: number): PIXI.Container {
    const card = new PIXI.Container();
    card.position.set(x, y);

    const isReady = view.status === 'ready';
    const isLocked = view.status === 'locked';
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, 0, 0, w, h, {
      radius: 18,
      tone: isReady ? 'gold' : isLocked ? 'muted' : 'ivory',
      headerH: 42,
    });
    card.addChild(bg);

    const slotTitle = view.index === 0 ? '一号老坛' : '二号老坛';
    const save = KitchenManager.save;
    const tierArt = P2_ART.pickleTiers[pickleTier(save)];

    if (isLocked) {
      const hdr = makeLabel(`${slotTitle} · 待添置`, 19, MUTED, { fontWeight: '700' });
      hdr.anchor.set(0.5);
      hdr.position.set(w / 2, 22);
      card.addChild(hdr);

      const jarTex = gameTexture(tierArt.idle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 112, 112);
        spr.anchor.set(0.5);
        spr.position.set(w / 2, 108);
        spr.tint = 0xC8B7A2;
        spr.alpha = 0.72;
        card.addChild(spr);
      }
      const desc = makeLabel('双坛齐发 · 酸菜剁椒两不误', 16, MUTED, { fontWeight: '700' });
      desc.anchor.set(0.5);
      desc.position.set(w / 2, 176);
      card.addChild(desc);

      const canBuy = save.money >= SECOND_JAR_COST;
      const buyBtn = makeSlicedButton({
        label: `添置 · ${SECOND_JAR_COST} 金`,
        width: w - 28,
        height: 48,
        skin: canBuy ? 'gold' : 'cream',
        textColor: canBuy ? INK : 0x8A7358,
        fontSize: 20,
        labelOffsetX: 12,
        onReady: this._scheduleRelayout,
        silent: !canBuy,
      });
      const face = ((buyBtn as any)._face as PIXI.Container | undefined) ?? buyBtn;
      const cTex = gameTexture(COIN_ICON);
      if (isTextureReady(cTex)) {
        const cs = new PIXI.Sprite(cTex);
        fitSpriteInBox(cs, 26, 26);
        cs.anchor.set(0.5);
        cs.position.set(36, 23);
        cs.eventMode = 'none';
        face.addChild(cs);
      }
      buyBtn.position.set(14, h - 58);
      buyBtn.on('pointertap', () => {
        if (KitchenManager.buySecondJar() && this._isOpen) this.relayout();
      });
      card.addChild(buyBtn);
      return card;
    }

    if (view.status === 'empty') {
      const hdr = makeLabel(`${slotTitle} · 空闲中`, 19, INK, { fontWeight: '700' });
      hdr.anchor.set(0.5);
      hdr.position.set(w / 2, 22);
      card.addChild(hdr);

      // Soft warm halo behind jar
      const halo = new PIXI.Graphics();
      halo.beginFill(0xF5E7CE, 0.75);
      halo.drawCircle(w / 2, 118, 54);
      halo.endFill();
      card.addChild(halo);

      const jarTex = gameTexture(tierArt.idle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 120, 120);
        spr.anchor.set(0.5);
        spr.position.set(w / 2, 115);
        card.addChild(spr);
      }

      const well = new PIXI.Graphics();
      drawRecessedWell(well, 16, h - 54, w - 32, 40, { radius: 20 });
      card.addChild(well);

      const hint = makeLabel('点下方配方封水入坛', 16, MUTED, { fontWeight: '700' });
      hint.anchor.set(0.5);
      hint.position.set(w / 2, h - 34);
      card.addChild(hint);
      return card;
    }

    const formula = view.formula!;
    if (view.status === 'fermenting') {
      const hdr = makeLabel(`${slotTitle} · ${formula.name}×${view.yieldQty}`, 18, INK, { fontWeight: '700' });
      hdr.anchor.set(0.5);
      hdr.position.set(w / 2, 22);
      card.addChild(hdr);

      const jarTex = gameTexture(tierArt.idle);
      if (isTextureReady(jarTex)) {
        const spr = new PIXI.Sprite(jarTex);
        fitSpriteInBox(spr, 98, 98);
        spr.anchor.set(0.5);
        spr.position.set(w / 2 - 14, 98);
        card.addChild(spr);
      }
      const outTex = itemTexture(formula.outputDefId);
      if (isTextureReady(outTex)) {
        const badgeBg = new PIXI.Graphics();
        badgeBg.lineStyle(2.2, UI_PALETTE.ink, 1);
        badgeBg.beginFill(0xFFFBF2, 1);
        badgeBg.drawCircle(w / 2 + 46, 120, 25);
        badgeBg.endFill();
        const os = new PIXI.Sprite(outTex);
        fitSpriteInBox(os, 36, 36);
        os.anchor.set(0.5);
        os.position.set(w / 2 + 46, 120);
        card.addChild(badgeBg, os);
      }

      const timerText = makeLabel(`发酵中 · 剩 ${formatTimerShort(view.remainMs)}`, 16, TERRACOTTA, {
        fontWeight: '700',
      });
      timerText.anchor.set(0.5);
      timerText.position.set(w / 2, 160);
      card.addChild(timerText);

      const barW = w - 34;
      const barH = 16;
      const barBg = new PIXI.Graphics();
      barBg.lineStyle(1.6, 0x8F6D47, 1);
      barBg.beginFill(0xE6D6BE, 1);
      barBg.drawRoundedRect(17, 176, barW, barH, barH / 2);
      barBg.endFill();
      card.addChild(barBg);

      const barFill = new PIXI.Graphics();
      barFill.position.set(17, 176);
      this._paintProgressBar(barFill, barW, barH, Math.max(0.06, view.progress));
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
        skin: 'gold',
        badge: `剩${adLeft}/${DAILY_AD_LIMITS.pickle_boost}`,
        disabled: !canBoost,
        onReady: this._scheduleRelayout,
      });
      boostBtn.position.set(14, h - 57);
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

    // READY state
    const bonusMark = view.slot?.boosted ? ' · 加量' : '';
    const hdr = makeLabel(`${formula.name}×${view.yieldQty}${bonusMark}`, 18, GOLD, { fontWeight: '700' });
    hdr.anchor.set(0.5);
    hdr.position.set(w / 2, 22);
    card.addChild(hdr);

    const flare = makeRarityFlare(itemRarity(formula.outputDefId), 184);
    flare.position.set(w / 2, 108);
    card.addChild(flare);

    const readyTex = gameTexture(tierArt.ready);
    if (isTextureReady(readyTex)) {
      const spr = new PIXI.Sprite(readyTex);
      fitSpriteInBox(spr, 118, 118);
      spr.anchor.set(0.5);
      spr.position.set(w / 2, 108);
      card.addChild(spr);
      TweenManager.to({
        target: spr.scale,
        props: { x: spr.scale.x * 1.05, y: spr.scale.y * 1.05 },
        duration: 0.65,
        ease: Ease.easeInOutQuad,
      });
    }

    const readySub = makeLabel('老卤发透 · 酸香扑鼻！', 16, OLIVE, { fontWeight: '700' });
    readySub.anchor.set(0.5);
    readySub.position.set(w / 2, 175);
    card.addChild(readySub);

    const harvestBtn = makeSlicedButton({
      label: `揭盖收菜 ×${view.yieldQty}`,
      width: w - 28,
      height: 50,
      skin: 'olive',
      textColor: PAPER,
      fontSize: 20,
      onReady: this._scheduleRelayout,
    });
    harvestBtn.position.set(14, h - 59);
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
    drawCraftCard(bg, 0, 0, w, h, {
      radius: 16,
      tone: status.levelMet ? 'ivory' : 'muted',
    });
    row.addChild(bg);

    // Left output pickled icon slot (3D beveled slot + integrated duration footer & ×2 badge)
    const iconW = 86;
    const iconH = 98;
    const footerH = 26;
    const iconBox = new PIXI.Container();
    iconBox.position.set(12, Math.round((h - iconH) / 2));
    const ibg = new PIXI.Graphics();
    drawItemSlotBox(ibg, 0, 0, iconW, iconH, {
      radius: 12,
      rarity: itemRarity(formula.outputDefId),
      dimmed: !status.levelMet,
      footerH,
    });
    iconBox.addChild(ibg);

    const outTex = itemTexture(formula.outputDefId);
    if (isTextureReady(outTex)) {
      const sp = new PIXI.Sprite(outTex);
      fitSpriteInBox(sp, 58, 58);
      sp.anchor.set(0.5);
      sp.position.set(iconW / 2, (iconH - footerH) / 2 - 1);
      if (!status.levelMet) sp.alpha = 0.55;
      iconBox.addChild(sp);
    }
    const yieldBadge = makeSlotBadge(`×${formula.baseQty}`, 'olive', 13);
    yieldBadge.node.position.set(iconW - yieldBadge.w - 3, iconH - footerH - yieldBadge.h - 2);
    iconBox.addChild(yieldBadge.node);

    const effMs = pickleEffectiveDurationMs(KitchenManager.save, formula.durationMs);
    const durLbl = makeLabel(formatDurationLabel(effMs), 14, 0x5E442D, { fontWeight: '700' });
    durLbl.anchor.set(0.5);
    durLbl.position.set(iconW / 2, iconH - footerH / 2 - 1);
    iconBox.addChild(durLbl);

    iconBox.eventMode = 'static';
    iconBox.cursor = 'pointer';
    iconBox.hitArea = new PIXI.Rectangle(0, 0, iconW, iconH);
    iconBox.on('pointertap', () => {
      AudioManager.play('ui_click');
      const v = inspectFromItem(formula.outputDefId);
      if (v) v.note = `${v.note ?? ''} · 老坛腌制出品`;
      this._inspect = v;
      this.relayout();
    });
    row.addChild(iconBox);

    // Middle info column + structured ingredient tray (clean 2-row hierarchy without prose clutter)
    const midX = 110;
    const btnW = 140;
    const midAvailW = w - midX - btnW - 24;

    const nameLbl = makeLabel(formula.name, 22, status.levelMet ? INK : 0x8A7358, {
      fontWeight: '700',
    });
    nameLbl.position.set(midX, 13);
    row.addChild(nameLbl);

    const sigRecipe = recipeById(formula.unlockRecipeId);
    if (sigRecipe) {
      const chip = new PIXI.Container();
      const chipText = status.recipeAlreadyUnlocked
        ? `已得谱 ✓`
        : `送谱：${sigRecipe.name}`;
      const clbl = makeLabel(chipText, 15, status.recipeAlreadyUnlocked ? OLIVE : 0x8F5808, {
        fontWeight: '700',
      });
      const cw = Math.ceil(clbl.width) + 36;
      const ch = 28;
      const cbg = new PIXI.Graphics();
      cbg.lineStyle(1.6, status.recipeAlreadyUnlocked ? 0x679458 : 0xBA8832, 0.95);
      cbg.beginFill(status.recipeAlreadyUnlocked ? 0xEFF7EC : 0xFFF7E0, 1);
      cbg.drawRoundedRect(0, 0, cw, ch, 8);
      cbg.endFill();
      chip.addChild(cbg);

      const dTex = dishTexture(sigRecipe.id);
      if (isTextureReady(dTex)) {
        const ds = new PIXI.Sprite(dTex);
        fitSpriteInBox(ds, 22, 22);
        ds.anchor.set(0.5);
        ds.position.set(14, ch / 2);
        chip.addChild(ds);
      }
      clbl.anchor.set(0, 0.5);
      clbl.position.set(27, ch / 2);
      chip.addChild(clbl);
      chip.position.set(midX + Math.ceil(nameLbl.width) + 10, 12);
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

    // Recessed uniform ingredient slot strip
    const trayY = 50;
    const trayH = 56;
    const ingTray = new PIXI.Graphics();
    drawSectionTray(ingTray, midX, trayY, midAvailW, trayH, { radius: 10, tone: 'sand' });
    row.addChild(ingTray);

    let ix = midX + 6;
    for (const inp of status.inputs) {
      const ok = inp.have >= inp.need;
      const ichip = new PIXI.Container();
      const itxt = makeLabel(inp.name, 16, ok ? INK : 0x7A6652, { fontWeight: '700' });
      const badge = makeSlotBadge(`${inp.have}/${inp.need}`, ok ? 'olive' : 'lack', 14);
      const iw = 42 + Math.ceil(itxt.width) + badge.w + 16;
      const ih = 44;
      const ib = new PIXI.Graphics();
      drawItemSlotBox(ib, 0, 0, iw, ih, { radius: 9, dimmed: !ok, medallion: false });
      ichip.addChild(ib);

      const itex = itemTexture(inp.defId);
      if (isTextureReady(itex)) {
        const isp = new PIXI.Sprite(itex);
        fitSpriteInBox(isp, 30, 30);
        isp.anchor.set(0.5);
        isp.position.set(21, ih / 2 - 1);
        ichip.addChild(isp);
      }
      itxt.anchor.set(0, 0.5);
      itxt.position.set(40, ih / 2 - 1);
      badge.node.position.set(iw - badge.w - 6, Math.round((ih - badge.h) / 2) - 1);
      ichip.addChild(itxt, badge.node);
      ichip.position.set(ix, trayY + 6);
      ichip.eventMode = 'static';
      ichip.cursor = 'pointer';
      ichip.hitArea = new PIXI.Rectangle(0, 0, iw, ih);
      ichip.on('pointertap', () => {
        AudioManager.play('ui_click');
        this._inspect = inspectFromItem(inp.defId);
        this.relayout();
      });
      row.addChild(ichip);
      ix += iw + 8;
    }

    // Right action button
    const btnH = 52;
    const btnX = w - btnW - 14;
    const btnY = Math.round((h - btnH) / 2);

    if (!status.levelMet) {
      const lockPill = new PIXI.Graphics();
      drawRecessedWell(lockPill, btnX, btnY + 3, btnW, 46, { radius: 23 });
      const ltxt = makeLabel(`Lv.${formula.unlockCookLevel} 解锁`, 17, 0x8A7358, { fontWeight: '700' });
      ltxt.anchor.set(0.5);
      ltxt.position.set(btnX + btnW / 2, btnY + 26);
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
      fontSize: 19,
      onReady: this._scheduleRelayout,
      silent: !canStart,
    });
    if (!canStart) startBtn.alpha = 0.85;
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
