import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  CAT_NAME,
  DAILY_AD_LIMITS,
  canUseDailyAd,
  catFeedOptions,
  catStateView,
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
  drawRarityFrame,
  fillRect,
  makeAdButton,
  makeLabel,
  makeRarityFlare,
  makeSlicedButton,
} from '@/utils/ui';
import {
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemTexture,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';

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
        this._paintBar(this._awayBarFill, this._awayMeta.barW, this._awayMeta.barH, ratio, 0xD98A2B);
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
    const paths: string[] = [
      P2_ART.catIdle,
      P2_ART.catAway,
      P2_ART.catGift,
      P2_ART.catCan,
      P0_ART.adClapper,
      'subpkg_kitchen/ui_pickup_flare.png',
      'subpkg_images/hud_coin.png',
      'subpkg_images/ui_menu_ticket.png',
    ];
    for (const opt of options.slice(0, 6)) {
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
    fillRect(dim, 0, 0, w, h, 0x1A120C);
    dim.alpha = 0.52;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (!this._adBusy) this.close();
    });
    this._root.addChild(dim);

    const boxW = Math.min(w - 32, 696);
    const padX = 22;
    const cw = boxW - padX * 2;
    const headH = 84;
    const heroH = 342;
    const canH = 96;
    const showFeeder = view.effectiveStatus === 'idle';
    const feederH = showFeeder ? 266 : 94;
    const boxH = headH + heroH + 12 + canH + 12 + feederH + 22;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 8, (h - boxH) / 2));

    this._catStagePos = { x: bx + boxW / 2, y: by + headH + 168 };

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

    // Header plaque
    const plaqueW = 324;
    const plaqueH = 46;
    const plaque = new PIXI.Graphics();
    plaque.lineStyle(3, INK, 1);
    plaque.beginFill(0xC46A3A, 1);
    plaque.drawRoundedRect((boxW - plaqueW) / 2, 16, plaqueW, plaqueH, 14);
    plaque.endFill();
    shell.addChild(plaque);

    const title = makeLabel(`橘 猫 ${CAT_NAME} 的 小 窝`, 27, PAPER, {
      fontFamily: TITLE_FONT,
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 4,
    });
    title.anchor.set(0.5);
    title.position.set(boxW / 2, 39);
    shell.addChild(title);

    const sub = makeLabel('喂余菜去后巷寻好货 · 亲密越高回来得越快越丰厚', 15, MUTED, { fontWeight: '700' });
    sub.anchor.set(0.5);
    sub.position.set(boxW / 2, 71);
    shell.addChild(sub);

    // Close button
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

    shell.addChild(this._buildHeroStage(view, padX, headH, cw, heroH));
    shell.addChild(this._buildActionBanner(view, padX, headH + heroH + 12, cw, canH));
    shell.addChild(this._buildBottomArea(view, feedOpts, padX, headH + heroH + 12 + canH + 12, cw, feederH));
  }

  private _paintBar(g: PIXI.Graphics, w: number, h: number, ratio: number, color: number): void {
    g.clear();
    const fw = Math.max(h, Math.round(w * Math.min(1, Math.max(0, ratio))));
    g.beginFill(color, 1);
    g.drawRoundedRect(0, 0, fw, h, h / 2);
    g.endFill();
  }

  private _buildHeroStage(view: CatStateView, x: number, y: number, w: number, h: number): PIXI.Container {
    const stage = new PIXI.Container();
    stage.position.set(x, y);

    const isGift = view.effectiveStatus === 'gift';
    const bg = new PIXI.Graphics();
    bg.lineStyle(isGift ? 3.5 : 2.5, isGift ? GOLD : WALNUT, 1);
    bg.beginFill(isGift ? 0xFFFBF0 : PAPER, 1);
    bg.drawRoundedRect(0, 0, w, h, 20);
    bg.endFill();
    stage.addChild(bg);

    // Top bond bar strip
    const bondStrip = new PIXI.Graphics();
    bondStrip.beginFill(CREAM, 1);
    bondStrip.drawRoundedRect(12, 10, w - 24, 42, 12);
    bondStrip.endFill();
    stage.addChild(bondStrip);

    const bond = view.bond;
    const bondTitle = makeLabel(`♥ 亲密 Lv.${bond.level} · ${bond.title}`, 17, TERRACOTTA, {
      fontWeight: '700',
    });
    bondTitle.anchor.set(0, 0.5);
    bondTitle.position.set(24, 31);
    stage.addChild(bondTitle);

    const barX = 224;
    const barW = 166;
    const barH = 14;
    const barBg = new PIXI.Graphics();
    barBg.lineStyle(1.5, WALNUT, 0.75);
    barBg.beginFill(0xE8D8C0, 1);
    barBg.drawRoundedRect(barX, 24, barW, barH, barH / 2);
    barBg.endFill();
    stage.addChild(barBg);

    const barFill = new PIXI.Graphics();
    barFill.position.set(barX, 24);
    this._paintBar(barFill, barW, barH, Math.max(0.08, bond.fill), 0xE07A3A);
    stage.addChild(barFill);

    const xpLabel = makeLabel(
      bond.nextCeil !== null ? `${bond.xp}/${bond.nextCeil}` : 'MAX',
      12,
      INK,
      { fontWeight: '700' },
    );
    xpLabel.anchor.set(0.5);
    xpLabel.position.set(barX + barW / 2, 31);
    stage.addChild(xpLabel);

    const perkLbl = makeLabel(
      `巡街${bond.outingMinutes}分 · 谢礼券率${Math.round(bond.ticketChance * 100)}%`,
      14,
      MUTED,
      { fontWeight: '700' },
    );
    perkLbl.anchor.set(1, 0.5);
    perkLbl.position.set(w - 22, 31);
    stage.addChild(perkLbl);

    // Centerpiece illustration
    const artPath = view.effectiveStatus === 'away'
      ? P2_ART.catAway
      : view.effectiveStatus === 'gift'
        ? P2_ART.catGift
        : P2_ART.catIdle;

    const centerY = view.effectiveStatus === 'away' ? 148 : 164;
    if (isGift) {
      const flare = makeRarityFlare('legendary', 240);
      flare.position.set(w / 2, centerY);
      stage.addChild(flare);
    }

    const catWrap = new PIXI.Container();
    catWrap.position.set(w / 2, centerY);
    const tex = gameTexture(artPath);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      const targetBox = view.effectiveStatus === 'away' ? 172 : 196;
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

    // Away live timer bar
    if (view.effectiveStatus === 'away') {
      const saveCat = KitchenManager.save.strayCat;
      const tText = makeLabel(`后巷寻宝中 · 剩 ${formatTimerShort(view.remainMs)}`, 16, TERRACOTTA, {
        fontWeight: '700',
      });
      tText.anchor.set(0.5);
      tText.position.set(w / 2, 238);
      stage.addChild(tText);

      const abW = 280;
      const abH = 14;
      const abX = Math.round((w - abW) / 2);
      const abBg = new PIXI.Graphics();
      abBg.lineStyle(1.5, WALNUT, 0.8);
      abBg.beginFill(0xE8D8C0, 1);
      abBg.drawRoundedRect(abX, 254, abW, abH, abH / 2);
      abBg.endFill();
      stage.addChild(abBg);

      const abFill = new PIXI.Graphics();
      abFill.position.set(abX, 254);
      this._paintBar(abFill, abW, abH, Math.max(0.06, view.progress), 0xD98A2B);
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

    // Bottom speech bubble
    const bubY = h - 62;
    const bub = new PIXI.Graphics();
    bub.lineStyle(1.5, LINE, 0.9);
    bub.beginFill(0xFFF6E8, 1);
    bub.drawRoundedRect(14, bubY, w - 28, 50, 14);
    bub.endFill();
    stage.addChild(bub);

    const mood = makeLabel(view.moodLine, 15, INK, {
      fontWeight: '600',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: w - 52,
    });
    mood.anchor.set(0.5);
    mood.position.set(w / 2, bubY + 25);
    stage.addChild(mood);

    return stage;
  }

  private _buildActionBanner(view: CatStateView, x: number, y: number, w: number, h: number): PIXI.Container {
    const wrap = new PIXI.Container();
    wrap.position.set(x, y);

    const bg = new PIXI.Graphics();
    bg.lineStyle(2.5, WALNUT, 0.95);
    bg.beginFill(0xFFF6E8, 1);
    bg.drawRoundedRect(0, 0, w, h, 18);
    bg.endFill();
    wrap.addChild(bg);

    const save = KitchenManager.save;

    if (view.effectiveStatus === 'unadopted') {
      const txt = makeLabel('给阿橘在阳光下留块草垫，每天帮你去菜场捡漏！', 17, INK, { fontWeight: '700' });
      txt.anchor.set(0, 0.5);
      txt.position.set(20, h / 2);
      wrap.addChild(txt);

      const adoptBtn = makeSlicedButton({
        label: '免费收留阿橘',
        width: 196,
        height: 54,
        skin: 'terracotta',
        textColor: PAPER,
        onReady: this._scheduleRelayout,
      });
      adoptBtn.position.set(w - 212, Math.round((h - 54) / 2));
      adoptBtn.on('pointertap', () => {
        if (KitchenManager.adoptCat() && this._isOpen) this.relayout();
      });
      wrap.addChild(adoptBtn);
      return wrap;
    }

    if (view.effectiveStatus === 'gift') {
      const gift = view.pendingGift;
      const previewText = gift?.deluxe
        ? '豪华红格包袱已就位（含3件稀有好食材 + 赏金）！'
        : '阿橘带回了沉甸甸的小包袱，快拆开看看有什么好货！';
      const txt = makeLabel(previewText, 17, INK, {
        fontWeight: '700',
        wordWrap: true,
        wordWrapWidth: w - 240,
      });
      txt.anchor.set(0, 0.5);
      txt.position.set(20, h / 2);
      wrap.addChild(txt);

      const claimBtn = makeSlicedButton({
        label: '拆开小包袱',
        width: 204,
        height: 56,
        skin: 'terracotta',
        textColor: PAPER,
        onReady: this._scheduleRelayout,
      });
      claimBtn.position.set(w - 220, Math.round((h - 56) / 2));
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

    // Idle or Away -> Gourmet Fish Cat Can Ad Banner!
    const canTex = gameTexture(P2_ART.catCan);
    if (isTextureReady(canTex)) {
      const cs = new PIXI.Sprite(canTex);
      fitSpriteInBox(cs, 74, 74);
      cs.anchor.set(0.5);
      cs.position.set(50, h / 2);
      wrap.addChild(cs);
    }

    const isAway = view.effectiveStatus === 'away';
    const titleStr = isAway ? '鲜鱼罐头 · 摇环立即唤回' : '鲜鱼猫罐头 · 零消耗立拿豪华礼袋';
    const subStr = isAway
      ? '免等待当场回屋，包袱里再多顺 1 件稀有好货 + 6 金'
      : '免耗冰箱食材 · 亲密+2 · 立即叼回 3 件稀有以上好货';

    const t1 = makeLabel(titleStr, 18, INK, { fontWeight: '700' });
    t1.position.set(94, 18);
    const t2 = makeLabel(subStr, 14, MUTED, { fontWeight: '600' });
    t2.position.set(94, 48);
    wrap.addChild(t1, t2);

    const adLeft = dailyAdLeft(save, 'cat_treat');
    const canTreat = canUseDailyAd(save, 'cat_treat');
    const canBtn = makeAdButton({
      label: isAway ? '摇罐头唤回' : '喂鲜鱼罐头',
      width: 198,
      height: 52,
      skin: 'terracotta',
      badge: `剩${adLeft}/${DAILY_AD_LIMITS.cat_treat}`,
      disabled: !canTreat,
      onReady: this._scheduleRelayout,
    });
    canBtn.position.set(w - 212, Math.round((h - 52) / 2));
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
      tipBox.lineStyle(1.5, LINE, 0.8);
      tipBox.beginFill(PAPER, 1);
      tipBox.drawRoundedRect(0, 0, w, h, 16);
      tipBox.endFill();
      area.addChild(tipBox);

      const msg = view.effectiveStatus === 'unadopted'
        ? '收留阿橘后，平时多余的小杂鱼、肉片或青菜都能喂它换回惊喜食材与菜谱券！'
        : view.effectiveStatus === 'away'
          ? '阿橘正在菜场摊位底下钻来钻去，等它回来就能拆红格小包袱啦！'
          : '拆开小包袱收下谢礼后，就能继续给阿橘投喂下一顿啦！';
      const lbl = makeLabel(msg, 15, MUTED, {
        fontWeight: '600',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: w - 48,
      });
      lbl.anchor.set(0.5);
      lbl.position.set(w / 2, h / 2);
      area.addChild(lbl);
      return area;
    }

    // Idle feeder section
    const hdr = makeLabel('从冰箱挑口吃的投喂（鱼肉最爱 · 亲密+2，余菜垫肚 · 亲密+1）', 15, MUTED, {
      fontWeight: '700',
    });
    hdr.anchor.set(0.5, 0);
    hdr.position.set(w / 2, 2);
    area.addChild(hdr);

    const topOpts = options.slice(0, 6);
    if (!topOpts.length) {
      const emptyBg = new PIXI.Graphics();
      emptyBg.lineStyle(1.5, LINE, 0.8);
      emptyBg.beginFill(PAPER, 1);
      emptyBg.drawRoundedRect(0, 32, w, h - 32, 16);
      emptyBg.endFill();
      const etxt = makeLabel('冰箱里还没有生鲜食材，出门去菜场捡一篮回来喂阿橘吧！', 16, MUTED, {
        fontWeight: '700',
      });
      etxt.anchor.set(0.5);
      etxt.position.set(w / 2, 32 + (h - 32) / 2);
      area.addChild(emptyBg, etxt);
      return area;
    }

    const cols = 3;
    const gapX = 12;
    const gapY = 10;
    const cardW = Math.floor((w - gapX * (cols - 1)) / cols);
    const cardH = 108;

    topOpts.forEach((opt, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = col * (cardW + gapX);
      const cy = 32 + row * (cardH + gapY);
      area.addChild(this._buildFoodCard(opt, cx, cy, cardW, cardH));
    });

    return area;
  }

  private _buildFoodCard(opt: CatFeedOption, x: number, y: number, w: number, h: number): PIXI.Container {
    const card = new PIXI.Container();
    card.position.set(x, y);

    const bg = new PIXI.Graphics();
    bg.lineStyle(2, opt.canFeed ? (opt.fav ? TERRACOTTA : WALNUT) : 0xD8CABA, 1);
    bg.beginFill(opt.canFeed ? PAPER : 0xF5EFE6, 1);
    bg.drawRoundedRect(0, 0, w, h, 14);
    bg.endFill();
    card.addChild(bg);

    const iconBox = new PIXI.Graphics();
    iconBox.beginFill(CREAM, 1);
    iconBox.drawRoundedRect(10, 14, 62, 62, 12);
    iconBox.endFill();
    drawRarityFrame(iconBox, 10, 14, 62, 62, itemRarity(opt.defId), { radius: 12 });
    card.addChild(iconBox);

    const tex = itemTexture(opt.defId);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      fitSpriteInBox(sp, 50, 50);
      sp.anchor.set(0.5);
      sp.position.set(41, 45);
      if (!opt.canFeed) sp.alpha = 0.55;
      card.addChild(sp);
    }

    const tagText = opt.fav ? '♥最爱 +2' : '亲密 +1';
    const tagLbl = makeLabel(tagText, 12, opt.fav ? TERRACOTTA : OLIVE, { fontWeight: '700' });
    tagLbl.position.set(80, 14);
    card.addChild(tagLbl);

    const nameLbl = makeLabel(opt.name, 17, opt.canFeed ? INK : 0x8A7358, { fontWeight: '700' });
    nameLbl.position.set(80, 34);
    card.addChild(nameLbl);

    const qtyLbl = makeLabel(
      `需 ${opt.need} 份（存 ${opt.have}）`,
      13,
      opt.canFeed ? OLIVE : 0xB84A32,
      { fontWeight: '700' },
    );
    qtyLbl.position.set(80, 60);
    card.addChild(qtyLbl);

    const footLbl = makeLabel(opt.canFeed ? '点此投喂 ▶' : '份数不足', 13, opt.canFeed ? TERRACOTTA : 0x9A8670, {
      fontWeight: '700',
    });
    footLbl.anchor.set(1, 1);
    footLbl.position.set(w - 12, h - 8);
    card.addChild(footLbl);

    card.eventMode = 'static';
    card.cursor = opt.canFeed ? 'pointer' : 'default';
    card.hitArea = new PIXI.Rectangle(0, 0, w, h);
    card.on('pointertap', () => {
      if (KitchenManager.feedCat(opt.defId) && this._isOpen) {
        this.relayout();
      }
    });

    return card;
  }
}
