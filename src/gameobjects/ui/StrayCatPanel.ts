import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CAT_BED_TIER_DEFS,
  CAT_NAME,
  DAILY_AD_LIMITS,
  canUseDailyAd,
  catBedTier,
  catBedUpgradeState,
  catEffectiveOutingMinutes,
  catFeedOptions,
  catStateView,
  cookLevel,
  dailyAdLeft,
  formatTimerShort,
  itemRarity,
  type CatFeedOption,
  type CatStateView,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
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
  makeCraftProgressBar,
  makeLabel,
  makeOrnamentalDivider,
  makeRarityFlare,
  makeSlicedButton,
  makeSlotBadge,
} from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';

const INK = UI_PALETTE.ink;
const MUTED = UI_PALETTE.muted;
const PAPER = 0xFFF8F0;
const TERRACOTTA = UI_PALETTE.terracotta;
const OLIVE = UI_PALETTE.olive;

export class StrayCatPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _paintQueued = false;
  private _adBusy = false;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _awayTimerText: PIXI.Text | null = null;
  private _awayBarFill: PIXI.Graphics | null = null;
  private _awayMeta: { startedAt: number; returnAt: number; barW: number; barH: number } | null = null;
  private _catStagePos = { x: 375, y: 420 };

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
    this._adBusy = false;
    warmupAdScene('cat_treat');
    this._startTick();
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    this._stopTick();
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._adBusy = false;
    this._paintQueued = false;
    this._awayTimerText = null;
    this._awayBarFill = null;
    this._awayMeta = null;
    this._root.removeChildren();
  }

  private _startTick(): void {
    this._stopTick();
    this._tickTimer = setInterval(() => {
      if (!this._isOpen || !this._awayMeta) return;
      const now = Date.now();
      const remain = Math.max(0, this._awayMeta.returnAt - now);
      if (remain <= 0) {
        if (!this._adBusy) this.relayout();
        return;
      }
      if (this._awayTimerText && !this._awayTimerText.destroyed) {
        this._awayTimerText.text = `后巷寻宝中 · 剩 ${formatTimerShort(remain)}`;
      }
      if (this._awayBarFill && !this._awayBarFill.destroyed) {
        const total = Math.max(1, this._awayMeta.returnAt - this._awayMeta.startedAt);
        const ratio = Math.min(1, Math.max(0.06, 1 - remain / total));
        this._paintBar(this._awayBarFill, this._awayMeta.barW, this._awayMeta.barH, ratio);
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

  private _warmAssets(options: CatFeedOption[]): void {
    const tierArt = P2_ART.catTiers[catBedTier(KitchenManager.save)];
    const paths: string[] = [
      UI_KIT.headerRibbon,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      tierArt.idle,
      tierArt.away,
      tierArt.gift,
      P2_ART.catCan,
      P0_ART.adClapper,
      'subpkg_kitchen/ui_pickup_flare.png',
      'subpkg_images/hud_coin.png',
      'subpkg_images/ui_menu_ticket.png',
    ];
    for (const opt of options.slice(0, 8)) {
      paths.push(resolveItemAssetPath(opt.defId));
    }
    watchTextures(paths, this._scheduleRelayout);
  }

  relayout(): void {
    this._root.removeChildren();
    this._awayTimerText = null;
    this._awayBarFill = null;
    this._awayMeta = null;
    if (!this._isOpen) return;

    const save = KitchenManager.save;
    const now = Date.now();
    const view = catStateView(save, now);
    const feedOpts = catFeedOptions(save);
    this._warmAssets(feedOpts);

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.58;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (!this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const boxW = Math.min(w - 30, 698);
    const padX = 24;
    const cw = boxW - padX * 2;
    const contentTop = 64;
    const tierBarH = 54;
    const stageTop = contentTop + tierBarH + 10;
    const heroH = 314;
    const canH = 94;
    const showFeeder = view.effectiveStatus === 'idle';
    const feederH = showFeeder ? 298 : 80;
    const boxH = stageTop + heroH + 10 + canH + 10 + feederH + 24;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 14, (h - boxH) / 2 + 4));

    this._catStagePos = { x: bx + boxW / 2, y: by + stageTop + 154 };

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: `橘 猫 ${CAT_NAME} 的 小 窝`,
      onReady: this._scheduleRelayout,
      closeSilent: true,
      onClose: () => {
        if (!this._adBusy) this.close();
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    shell.addChild(this._buildBedTierBar(save, padX, contentTop, cw, tierBarH));
    shell.addChild(this._buildHeroStage(view, padX, stageTop, cw, heroH));
    shell.addChild(this._buildActionBanner(view, padX, stageTop + heroH + 10, cw, canH));
    shell.addChild(this._buildBottomArea(view, feedOpts, padX, stageTop + heroH + 10 + canH + 10, cw, feederH));
  }

  private _buildBedTierBar(save: typeof KitchenManager.save, x: number, y: number, w: number, h: number): PIXI.Container {
    const bar = new PIXI.Container();
    bar.position.set(x, y);
    const bg = new PIXI.Graphics();
    drawSectionTray(bg, 0, 0, w, h, { radius: 13, tone: 'sand' });
    bar.addChild(bg);

    const curDef = CAT_BED_TIER_DEFS[catBedTier(save)];
    const st = catBedUpgradeState(save);
    const lbl = makeLabel(`猫窝：${curDef.name}`, 18, INK, { fontWeight: '700' });
    lbl.anchor.set(0, 0.5);
    lbl.position.set(14, h / 2);
    bar.addChild(lbl);

    const perkChip = makeSlotBadge(
      st.status === 'max' ? '巡街-16% · 券率+8%' : `焕新：${st.nextDesc.split('·')[0].trim()}`,
      st.status === 'max' ? 'gold' : 'olive',
      14,
    );
    perkChip.node.position.set(14 + Math.ceil(lbl.width) + 10, Math.round((h - perkChip.h) / 2));
    bar.addChild(perkChip.node);

    if (st.status === 'max') {
      const done = makeSlotBadge('✓ 雕榻满阶', 'gold', 15);
      done.node.position.set(w - done.w - 12, Math.round((h - done.h) / 2));
      bar.addChild(done.node);
    } else {
      const ready = st.status === 'ready';
      const btnText = ready
        ? `${st.cost}金 焕新`
        : cookLevel(save) < st.cookNeed
          ? `Lv.${st.cookNeed} 解锁`
          : `${st.cost}金 焕新`;
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
        if (KitchenManager.upgradeCatBed() && this._isOpen) this.relayout();
      });
      bar.addChild(btn);
    }
    return bar;
  }

  private _paintBar(g: PIXI.Graphics, w: number, h: number, ratio: number): void {
    g.clear();
    const pad = 2;
    const fh = h - pad * 2;
    const fw = Math.max(fh, Math.round((w - pad * 2) * Math.min(1, Math.max(0, ratio))));
    g.beginFill(0xDF9628, 1);
    g.drawRoundedRect(pad, pad, fw, fh, fh / 2);
    g.endFill();
    g.beginFill(0xF7C665, 0.55);
    g.drawRoundedRect(pad + 3, pad + 1.5, Math.max(4, fw - 6), Math.max(3, fh * 0.38), fh / 4);
    g.endFill();
  }

  private _buildHeroStage(view: CatStateView, x: number, y: number, w: number, h: number): PIXI.Container {
    const stage = new PIXI.Container();
    stage.position.set(x, y);

    const isGift = view.effectiveStatus === 'gift';
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, 0, 0, w, h, {
      radius: 20,
      tone: isGift ? 'gold' : 'ivory',
      headerH: 50,
    });
    stage.addChild(bg);

    const bond = view.bond;
    const bondTitle = makeLabel(`♥ Lv.${bond.level} · ${bond.title}`, 18, TERRACOTTA, {
      fontWeight: '700',
    });
    bondTitle.anchor.set(0, 0.5);
    bondTitle.position.set(18, 26);
    stage.addChild(bondTitle);

    const barX = 198;
    const barW = 160;
    const xpBar = makeCraftProgressBar({
      width: barW,
      height: 22,
      ratio: Math.max(0.08, bond.fill),
      scheme: 'terracotta',
      text: bond.nextCeil !== null ? `${bond.xp}/${bond.nextCeil}` : 'MAX',
      fontSize: 14,
    });
    xpBar.position.set(barX, 15);
    stage.addChild(xpBar);

    const save = KitchenManager.save;
    const effMins = catEffectiveOutingMinutes(save, bond.outingMinutes);
    const bedBonus = CAT_BED_TIER_DEFS[catBedTier(save)].ticketBonus;
    const perkLbl = makeLabel(
      `巡街${effMins}分 · 券率${Math.round((bond.ticketChance + bedBonus) * 100)}%`,
      16,
      MUTED,
      { fontWeight: '700' },
    );
    perkLbl.anchor.set(1, 0.5);
    perkLbl.position.set(w - 18, 26);
    stage.addChild(perkLbl);

    // Warm sunlit halo behind 阿橘
    const centerY = view.effectiveStatus === 'away' ? 140 : 152;
    const halo = new PIXI.Graphics();
    halo.beginFill(isGift ? 0xFBE9B2 : 0xF6EAD4, 0.72);
    halo.drawCircle(w / 2, centerY + 6, 72);
    halo.endFill();
    stage.addChild(halo);

    const tierArt = P2_ART.catTiers[catBedTier(save)];
    const artPath = view.effectiveStatus === 'away'
      ? tierArt.away
      : view.effectiveStatus === 'gift'
        ? tierArt.gift
        : tierArt.idle;

    if (isGift) {
      const flare = makeRarityFlare('legendary', 236);
      flare.position.set(w / 2, centerY);
      stage.addChild(flare);
    }

    const catWrap = new PIXI.Container();
    catWrap.position.set(w / 2, centerY);
    const tex = gameTexture(artPath);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      const targetBox = view.effectiveStatus === 'away' ? 170 : 194;
      fitSpriteInBox(spr, targetBox, targetBox);
      spr.anchor.set(0.5);
      catWrap.addChild(spr);

      if (view.effectiveStatus === 'idle' || view.effectiveStatus === 'gift') {
        const baseSx = spr.scale.x;
        const baseSy = spr.scale.y;
        const breathe = (): void => {
          if (spr.destroyed) return;
          TweenManager.to({
            target: spr.scale,
            props: { x: baseSx * 1.03, y: baseSy * 0.97 },
            duration: 1.1,
            ease: Ease.easeInOutQuad,
            onComplete: () => {
              if (spr.destroyed) return;
              TweenManager.to({
                target: spr.scale,
                props: { x: baseSx, y: baseSy },
                duration: 1.1,
                ease: Ease.easeInOutQuad,
                onComplete: breathe,
              });
            },
          });
        };
        breathe();
      }
    }
    if (view.effectiveStatus === 'idle' || view.effectiveStatus === 'unadopted') {
      catWrap.eventMode = 'static';
      catWrap.cursor = 'pointer';
      catWrap.hitArea = new PIXI.Circle(0, 0, 96);
      catWrap.on('pointertap', () => {
        AudioManager.play('event_pop');
        Platform.showToast('阿橘眯着眼睛呼噜噜蹭了蹭你的手心~');
      });
    }
    stage.addChild(catWrap);

    if (view.effectiveStatus === 'away') {
      const saveCat = KitchenManager.save.strayCat;
      const tText = makeLabel(`后巷寻宝中 · 剩 ${formatTimerShort(view.remainMs)}`, 17, TERRACOTTA, {
        fontWeight: '700',
      });
      tText.anchor.set(0.5);
      tText.position.set(w / 2, 224);
      stage.addChild(tText);

      const abW = 280;
      const abH = 15;
      const abX = Math.round((w - abW) / 2);
      const abBg = new PIXI.Graphics();
      abBg.lineStyle(1.6, 0x8F6D47, 1);
      abBg.beginFill(0xE6D6BE, 1);
      abBg.drawRoundedRect(abX, 241, abW, abH, abH / 2);
      abBg.endFill();
      stage.addChild(abBg);

      const abFill = new PIXI.Graphics();
      abFill.position.set(abX, 241);
      this._paintBar(abFill, abW, abH, Math.max(0.06, view.progress));
      stage.addChild(abFill);

      this._awayTimerText = tText;
      this._awayBarFill = abFill;
      if (saveCat) {
        this._awayMeta = {
          startedAt: saveCat.startedAt,
          returnAt: saveCat.returnAt,
          barW: abW,
          barH: abH,
        };
      }
    }

    // Recessed warm linen speech quote bubble with upward pointer
    const bubY = h - 56;
    const bub = new PIXI.Graphics();
    drawRecessedWell(bub, 16, bubY, w - 32, 44, { radius: 14, pointerTopX: w / 2 });
    stage.addChild(bub);

    const mood = makeLabel(view.moodLine, 16, INK, {
      fontWeight: '700',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: w - 52,
    });
    mood.anchor.set(0.5);
    mood.position.set(w / 2, bubY + 22);
    stage.addChild(mood);

    return stage;
  }

  private _buildActionBanner(view: CatStateView, x: number, y: number, w: number, h: number): PIXI.Container {
    const wrap = new PIXI.Container();
    wrap.position.set(x, y);

    const isGift = view.effectiveStatus === 'gift';
    const isUnadopted = view.effectiveStatus === 'unadopted';
    const bg = new PIXI.Graphics();
    drawCraftCard(bg, 0, 0, w, h, {
      radius: 18,
      tone: isGift ? 'gold' : isUnadopted ? 'olive' : 'warm',
    });
    wrap.addChild(bg);

    const save = KitchenManager.save;

    if (isUnadopted) {
      const txt = makeLabel('给阿橘留块草垫，每天去菜场帮你寻好货！', 18, INK, { fontWeight: '700' });
      txt.anchor.set(0, 0.5);
      txt.position.set(20, h / 2 - 1);
      wrap.addChild(txt);

      const adoptBtn = makeSlicedButton({
        label: '免费收留',
        width: 186,
        height: 52,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 20,
        onReady: this._scheduleRelayout,
      });
      adoptBtn.position.set(w - 202, Math.round((h - 52) / 2));
      adoptBtn.on('pointertap', () => {
        if (KitchenManager.adoptCat() && this._isOpen) this.relayout();
      });
      wrap.addChild(adoptBtn);
      return wrap;
    }

    if (isGift) {
      const gift = view.pendingGift;
      const previewText = gift?.deluxe
        ? '豪华红格包袱就位（3件稀有好货+赏金）！'
        : '阿橘带回了沉甸甸的小包袱，快拆开看看！';
      const txt = makeLabel(previewText, 18, INK, {
        fontWeight: '700',
        wordWrap: true,
        wordWrapWidth: w - 232,
      });
      txt.anchor.set(0, 0.5);
      txt.position.set(20, h / 2 - 1);
      wrap.addChild(txt);

      const claimBtn = makeSlicedButton({
        label: '拆开包袱',
        width: 192,
        height: 54,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 20,
        onReady: this._scheduleRelayout,
      });
      claimBtn.position.set(w - 208, Math.round((h - 54) / 2));
      claimBtn.on('pointertap', () => {
        const from = this._catStagePos;
        const res = KitchenManager.claimCatGiftBundle();
        if (!res.ok) return;
        const firstFood = res.foods[0];
        playRewardCollect({
          gold: res.gold,
          foldGold: res.foldGold,
          foodDefId: firstFood?.defId,
          foodFolded: firstFood?.folded,
          from,
        });
        if (res.tickets > 0) {
          playTicketCollect(from, kitchenGachaHudPos());
        }
        if (this._isOpen) this.relayout();
      });
      wrap.addChild(claimBtn);
      return wrap;
    }

    // Idle or Away -> Gourmet Fish Cat Can Ad Banner
    const canHalo = new PIXI.Graphics();
    canHalo.beginFill(0xF6E4C2, 0.8);
    canHalo.drawCircle(50, h / 2, 34);
    canHalo.endFill();
    wrap.addChild(canHalo);

    const canTex = gameTexture(P2_ART.catCan);
    if (isTextureReady(canTex)) {
      const cs = new PIXI.Sprite(canTex);
      fitSpriteInBox(cs, 70, 70);
      cs.anchor.set(0.5);
      cs.position.set(50, h / 2);
      wrap.addChild(cs);
    }

    const isAway = view.effectiveStatus === 'away';
    const titleStr = isAway ? '鲜鱼罐头 · 摇环唤回' : '鲜鱼猫罐头';
    const subStr = isAway
      ? '当场回屋 · 多带 1 件稀有好货 + 6金'
      : '免食材 · 亲密+2 · 立拿 3 件稀有好货';

    const t1 = makeLabel(titleStr, 20, INK, { fontWeight: '700' });
    t1.position.set(94, 18);
    const t2 = makeLabel(subStr, 16, MUTED, { fontWeight: '700' });
    t2.position.set(94, 52);
    wrap.addChild(t1, t2);

    const adLeft = dailyAdLeft(save, 'cat_treat');
    const canTreat = canUseDailyAd(save, 'cat_treat');
    const canBtn = makeAdButton({
      label: isAway ? '摇铃唤回' : '喂罐头',
      width: 188,
      height: 52,
      skin: 'gold',
      badge: `剩${adLeft}/${DAILY_AD_LIMITS.cat_treat}`,
      disabled: !canTreat,
      onReady: this._scheduleRelayout,
    });
    canBtn.position.set(w - 202, Math.round((h - 52) / 2));
    canBtn.on('pointertap', () => {
      if (this._adBusy) return;
      if (!canTreat) {
        Platform.showToast('今天的鲜鱼罐头喂完啦，明天再来宠它');
        return;
      }
      this._adBusy = true;
      Platform.showRewardedVideo(
        'cat_treat',
        () => {
          this._adBusy = false;
          KitchenManager.useCatCan();
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    wrap.addChild(canBtn);
    return wrap;
  }

  private _buildBottomArea(
    view: CatStateView,
    options: CatFeedOption[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): PIXI.Container {
    const area = new PIXI.Container();
    area.position.set(x, y);

    if (view.effectiveStatus !== 'idle') {
      const tipBox = new PIXI.Graphics();
      drawRecessedWell(tipBox, 0, 0, w, h, { radius: 16 });
      area.addChild(tipBox);

      const msg = view.effectiveStatus === 'unadopted'
        ? '收留阿橘后，余菜小鱼都能喂它换惊喜谢礼！'
        : view.effectiveStatus === 'away'
          ? '阿橘正在菜场寻宝，回来就能拆红格包袱啦！'
          : '先拆开上面的小包袱收下谢礼，再投喂下一顿吧！';
      const lbl = makeLabel(msg, 17, MUTED, {
        fontWeight: '700',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: w - 48,
      });
      lbl.anchor.set(0.5);
      lbl.position.set(w / 2, h / 2);
      area.addChild(lbl);
      return area;
    }

    // Idle feeder section — clean 4-column × 2-row item slot grid
    const div = makeOrnamentalDivider(w, '投喂余菜 · 鱼肉♥+2 / 素菜♥+1', { fontSize: 17 });
    div.position.set(0, 13);
    area.addChild(div);

    const topOpts = options.slice(0, 8);
    if (!topOpts.length) {
      const emptyBg = new PIXI.Graphics();
      drawRecessedWell(emptyBg, 0, 34, w, h - 34, { radius: 16 });
      const etxt = makeLabel('冰箱还没有生鲜食材，出门去菜场捡一篮回来吧！', 18, MUTED, {
        fontWeight: '700',
      });
      etxt.anchor.set(0.5);
      etxt.position.set(w / 2, 34 + (h - 34) / 2);
      area.addChild(emptyBg, etxt);
      return area;
    }

    const trayY = 32;
    const trayPad = 10;
    const cols = 4;
    const gapX = 10;
    const gapY = 10;
    const innerW = w - trayPad * 2;
    const cardW = Math.floor((innerW - gapX * (cols - 1)) / cols);
    const cardH = Math.floor((h - trayY - trayPad * 2 - gapY) / 2);

    const trayBg = new PIXI.Graphics();
    drawSectionTray(trayBg, 0, trayY, w, h - trayY, { radius: 14, tone: 'sand' });
    area.addChild(trayBg);

    for (let idx = 0; idx < 8; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = trayPad + col * (cardW + gapX);
      const cy = trayY + trayPad + row * (cardH + gapY);
      const opt = topOpts[idx];
      if (opt) {
        area.addChild(this._buildFoodCard(opt, cx, cy, cardW, cardH));
      } else {
        const emptySlot = new PIXI.Graphics();
        drawItemSlotBox(emptySlot, cx, cy, cardW, cardH, { radius: 12, empty: true });
        area.addChild(emptySlot);
      }
    }

    return area;
  }

  private _buildFoodCard(opt: CatFeedOption, x: number, y: number, w: number, h: number): PIXI.Container {
    const card = new PIXI.Container();
    card.position.set(x, y);

    const footerH = 30;
    const bodyH = h - footerH;
    const bg = new PIXI.Graphics();
    drawItemSlotBox(bg, 0, 0, w, h, {
      radius: 12,
      rarity: itemRarity(opt.defId),
      dimmed: !opt.canFeed,
      footerH,
    });
    card.addChild(bg);

    const tex = itemTexture(opt.defId);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, Math.min(w - 26, 62), Math.min(bodyH - 12, 62));
      sp.anchor.set(0.5);
      sp.position.set(w / 2, bodyH / 2 + 1);
      if (!opt.canFeed) sp.alpha = 0.55;
      card.addChild(sp);
    }

    const bondBadge = makeSlotBadge(opt.fav ? '♥+2' : '♥+1', opt.fav ? 'gold' : 'ink', 13);
    bondBadge.node.position.set(5, 5);
    card.addChild(bondBadge.node);

    const qtyBadge = makeSlotBadge(`${opt.have}/${opt.need}`, opt.canFeed ? 'olive' : 'lack', 14);
    qtyBadge.node.position.set(w - qtyBadge.w - 5, bodyH - qtyBadge.h - 4);
    card.addChild(qtyBadge.node);

    const footLbl = makeLabel(opt.name, 16, opt.canFeed ? INK : 0x7A6652, { fontWeight: '700' });
    footLbl.anchor.set(0.5);
    footLbl.position.set(w / 2, h - footerH / 2 - 1);
    card.addChild(footLbl);

    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.hitArea = new PIXI.Rectangle(0, 0, w, h);
    card.on('pointertap', () => {
      if (KitchenManager.feedCat(opt.defId) && this._isOpen) {
        this.relayout();
      }
    });

    return card;
  }
}
