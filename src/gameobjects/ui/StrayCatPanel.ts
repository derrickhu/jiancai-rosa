import * as PIXI from 'pixi.js';
import { analytics } from '@/analytics';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { Ease, TweenManager } from '@/core/TweenManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { destroyDisplayChildren, isStageMounted } from '@/utils/destroy';
import {
  CAT_BED_TIER_DEFS,
  CAT_NAME,
  CAT_UNLOCK_LEVEL,
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
  HUD_ICON,
  P0_ART,
  P2_ART,
  UI_KIT,
  attachSpriteContour,
  fitTextWidth,
  makeAdButton,
  makeCoinButton,
  makeHandProgressBar,
  makeSlicedButton,
  makeText,
  uiBarPaths,
} from '@/utils/ui';
import { gameTexture, isTextureReady, resolveItemAssetPath, watchTextures } from '@/utils/assets';
import {
  makeItemInspectCard,
  type ItemInspectView,
} from './ItemInspectCard';
import {
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  makeHangTag,
  makeSceneRoot,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

/** 阿橘小窝：一扇晒太阳的窗，阿橘趴在窗台上；窗台下是木护墙，摆着草编餐垫和猫碗。 */
const ART = {
  wall: 'subpkg_images/scene_cat_nook_wall.png',
  bowl: 'subpkg_images/scene_cat_bowl.png',
  paw: 'subpkg_images/scene_cat_paw.png',
  bubble: 'subpkg_images/scene_cat_bubble.png',
  heart: 'subpkg_images/scene_cat_heart_tag.png',
  mat: 'subpkg_images/scene_cat_mat.png',
} as const;

const W = 720;
/** 墙图 720×964：窗台受光面 y≈438–460，护墙板从 y≈470 开始。 */
const L = {
  wallSliceTop: 476,
  wallSliceBottom: 64,
  sillY: 452,
  catCx: 360,
  catSize: 236,
  lowerTop: 486,
  bedRowH: 92,
  bondRowH: 76,
  actionRowH: 122,
  bowlRowStep: 198,
  contentX: 52,
  contentR: 668,
} as const;

const CREAM = 0xFFF4DE;
const WARM_SUB = 0xF3DDB6;
const STROKE = 0x3A2414;

/** 护墙板上的字：奶油色 + 深棕描边，木纹上也清楚。 */
function woodText(
  role: 'title' | 'heading' | 'body' | 'caption',
  text: string,
  size: number,
  color: number = CREAM,
): PIXI.Text {
  return makeText(role, text, color, {
    size,
    stroke: STROKE,
    strokeWidth: Math.max(3, Math.round(size * 0.16)),
  });
}

export class StrayCatPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _inspect: ItemInspectView | null = null;
  private _paintQueued = false;
  private _adBusy = false;
  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _awayTimer: {
    text: PIXI.Text;
    setRatio: (r: number) => void;
    startedAt: number;
    returnAt: number;
  } | null = null;
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
    this._inspect = null;
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
    this._inspect = null;
    this._adBusy = false;
    this._paintQueued = false;
    this._awayTimer = null;
    destroyDisplayChildren(this._root);
  }

  private _startTick(): void {
    this._stopTick();
    this._tickTimer = setInterval(() => {
      if (!this._isOpen || !this._awayTimer) return;
      const t = this._awayTimer;
      if (t.text.destroyed) return;
      const now = Date.now();
      const remain = Math.max(0, t.returnAt - now);
      if (remain <= 0) {
        if (!this._adBusy) this.relayout();
        return;
      }
      t.text.text = `还要 ${formatTimerShort(remain)}`;
      const total = Math.max(1, t.returnAt - t.startedAt);
      t.setRatio(Math.min(1, Math.max(0.06, 1 - remain / total)));
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
      ...Object.values(ART),
      ...sceneArtPaths(),
      ...uiBarPaths(),
      HUD_ICON.coin,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      tierArt.idle,
      tierArt.away,
      tierArt.gift,
      P2_ART.catCan,
      P0_ART.adClapper,
    ];
    for (const opt of options.slice(0, 8)) paths.push(resolveItemAssetPath(opt.defId));
    watchTextures(paths, this._scheduleRelayout);
  }

  relayout(): void {
    destroyDisplayChildren(this._root);
    this._awayTimer = null;
    if (!this._isOpen) return;

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const save = KitchenManager.save;
    const view = catStateView(save, Date.now());
    const feedOpts = catFeedOptions(save);
    this._warmAssets(feedOpts);

    const status = view.effectiveStatus;
    const showFeeder = status === 'idle';
    const feedRows = showFeeder ? Math.max(1, Math.ceil(Math.min(8, feedOpts.length) / 4)) : 0;
    const feederH = showFeeder ? (feedOpts.length ? 58 + feedRows * L.bowlRowStep : 116) : 92;
    const panelH = L.lowerTop + L.bedRowH + L.bondRowH + L.actionRowH + feederH + 38;

    const { scene, toStage } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 44,
      onDimTap: () => {
        if (this._inspect) {
          this._inspect = null;
          this.relayout();
          return;
        }
        if (!this._adBusy) this.close();
      },
    });
    this._catStagePos = toStage(L.catCx, L.sillY - 96);

    drawSceneWall(scene, ART.wall, W, panelH, L.wallSliceTop, L.wallSliceBottom);
    drawPlaqueTitle(scene, `${CAT_NAME}的小窝`, W / 2);
    this._drawCat(scene, view);
    this._drawHeart(scene, view);
    this._drawBubble(scene, view);

    const spanW = L.contentR - L.contentX;
    let y = L.lowerTop;
    this._drawBedRow(scene, y);
    y += L.bedRowH;
    drawInkDivider(scene, L.contentX, y - 6, spanW, 0.34, 10);

    this._drawBondRow(scene, view, y);
    y += L.bondRowH;
    drawInkDivider(scene, L.contentX, y - 6, spanW, 0.34, 10);

    this._drawActionRow(scene, view, y);
    y += L.actionRowH;
    drawInkDivider(scene, L.contentX, y - 6, spanW, 0.34, 10);

    if (showFeeder) this._drawFeeder(scene, feedOpts, y);
    else this._drawNote(scene, view, y);

    drawSceneClose(
      scene,
      W - 46,
      -20,
      () => {
        if (!this._adBusy) this.close();
      },
      this._scheduleRelayout,
    );

    if (this._inspect) {
      this._root.addChild(makeItemInspectCard({
        view: this._inspect,
        qty: 1,
        actions: false,
        onQty: () => {},
        onClose: () => {
          AudioManager.play('ui_close');
          this._inspect = null;
          this.relayout();
        },
        onReady: this._scheduleRelayout,
      }));
    }
  }

  private _claimGift(): void {
    const from = this._catStagePos;
    const res = KitchenManager.claimCatGiftBundle();
    if (!res.ok) return;
    const nextSave = KitchenManager.save;
    analytics.trackCatAction({
      action: 'claim_gift',
      bondLevel: catStateView(nextSave, Date.now()).bond.level,
      bedTier: catBedTier(nextSave),
      deluxe: res.deluxe,
      goldGained: res.totalGold,
      ticketsGained: res.tickets,
      foodsCount: res.foods.reduce((s, f) => s + f.qty, 0),
    });
    const firstFood = res.foods[0];
    playRewardCollect({
      gold: res.gold,
      foldGold: res.foldGold,
      foodDefId: firstFood?.defId,
      foodFolded: firstFood?.folded,
      from,
    });
    if (res.tickets > 0) playTicketCollect(from, kitchenGachaHudPos());
    if (this._isOpen) this.relayout();
  }

  // ── 窗台上的阿橘 ──────────────────────────────────────────────────────
  private _drawCat(scene: PIXI.Container, view: CatStateView): void {
    const tierArt = P2_ART.catTiers[catBedTier(KitchenManager.save)];
    const status = view.effectiveStatus;
    const path = status === 'away' ? tierArt.away : status === 'gift' ? tierArt.gift : tierArt.idle;
    const size = status === 'away' ? 204 : L.catSize;
    const cat = sceneSprite(path, size, size);
    if (cat) {
      cat.anchor.set(0.5, 1);
      if (status === 'locked') {
        cat.tint = 0x5A402C;
        cat.alpha = 0.65;
      }
      const wrap = new PIXI.Container();
      wrap.position.set(L.catCx, L.sillY + 6);
      wrap.addChild(cat);
      if (status === 'gift') {
        attachSpriteContour(wrap, cat, view.pendingGift?.deluxe ? 'legendary' : 'epic', {
          selected: true,
          thicknessScale: 1.08,
        });
      }
      scene.addChild(wrap);

      if (status === 'idle' || status === 'gift') {
        const breathe = (): void => {
          if (!isStageMounted(wrap)) return;
          TweenManager.to({
            target: wrap.scale,
            props: { x: 1.022, y: 0.985 },
            duration: 1.1,
            ease: Ease.easeInOutQuad,
            onComplete: () => {
              if (!isStageMounted(wrap)) return;
              TweenManager.to({
                target: wrap.scale,
                props: { x: 1, y: 1 },
                duration: 1.1,
                ease: Ease.easeInOutQuad,
                onComplete: breathe,
              });
            },
          });
        };
        breathe();
      }

      if (status === 'idle' || status === 'unadopted') {
        wrap.eventMode = 'static';
        wrap.cursor = 'pointer';
        wrap.hitArea = new PIXI.Rectangle(-size / 2, -size, size, size);
        wrap.on('pointertap', () => {
          AudioManager.play('event_pop');
          Platform.showToast(`${CAT_NAME}眯着眼睛呼噜噜蹭了蹭你的手心~`);
        });
      } else if (status === 'gift') {
        wrap.eventMode = 'static';
        wrap.cursor = 'pointer';
        wrap.hitArea = new PIXI.Rectangle(-size / 2, -size, size, size);
        wrap.on('pointertap', () => this._claimGift());
      }
    }

    if (status === 'away') {
      // 悬在草垫梅花爪印上方的牛皮纸签：去哪儿了、多久回来（不挡草垫爪印与青菜叶）
      const tag = makeHangTag(258);
      tag.node.pivot.set(tag.faceCx, 0);
      tag.node.position.set(L.catCx, 238);
      tag.node.rotation = -0.028;

      const t1 = makeText('title', '去后巷寻宝了', SCENE_INK.soft, { size: 24 });
      t1.anchor.set(0.5);
      t1.position.set(tag.faceCx, tag.h * 0.29);
      fitTextWidth(t1, tag.faceW - 10);

      const t2 = makeText('title', `还要 ${formatTimerShort(view.remainMs)}`, SCENE_INK.red, { size: 24 });
      t2.anchor.set(0.5);
      t2.position.set(tag.faceCx, tag.h * 0.55);
      fitTextWidth(t2, tag.faceW - 10);

      const bar = makeHandProgressBar({
        width: tag.faceW - 18,
        height: 16,
        ratio: Math.max(0.06, view.progress),
        onReady: this._scheduleRelayout,
      });
      bar.node.position.set(tag.faceX + 9, tag.h * 0.72);
      tag.node.addChild(t1, t2, bar.node);
      scene.addChild(tag.node);

      const saveCat = KitchenManager.save.strayCat;
      if (saveCat) {
        this._awayTimer = {
          text: t2,
          setRatio: bar.setRatio,
          startedAt: saveCat.startedAt,
          returnAt: saveCat.returnAt,
        };
      }
    }
  }

  // ── 墙右侧小鱼干下方挂的木心牌：亲密等级 ──────────────────────────────
  private _drawHeart(scene: PIXI.Container, view: CatStateView): void {
    if (!view.adopted) return;
    const cx = 620;
    const top = 250;
    const heartW = 114;
    const heart = sceneSprite(ART.heart, heartW);
    let faceCy = top + 68;
    let bottomY = top + 120;
    if (heart) {
      heart.position.set(cx - heartW / 2, top);
      scene.addChild(heart);
      faceCy = top + heart.height * 0.56;
      bottomY = top + heart.height;
    }
    const lv = makeText('title', `Lv.${view.bond.level}`, 0x5A2E12, {
      size: 27,
      stroke: 0xF7DDB2,
      strokeWidth: 3,
    });
    lv.anchor.set(0.5);
    lv.position.set(cx, faceCy);
    scene.addChild(lv);

    const title = makeText('caption', view.bond.title, 0x5A3A22, {
      size: 22,
      fontWeight: '700',
      stroke: CREAM,
      strokeWidth: 4,
    });
    title.anchor.set(0.5, 0);
    title.position.set(cx, bottomY + 2);
    scene.addChild(title);
  }

  // ── 阿橘的心里话：避开左侧风铃，浮在晴窗上方，尾巴指向阿橘 ─────────────
  private _drawBubble(scene: PIXI.Container, view: CatStateView): void {
    if (!view.moodLine) return;
    const bw = 368;
    const t = makeText('body', view.moodLine, SCENE_INK.ink, {
      size: 22,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: bw - 56,
      align: 'center',
      lineHeight: 29,
    });
    const bh = Math.max(94, Math.ceil(t.height) + 46);
    const x = 108;
    const y = 132;
    const bubbleTex = gameTexture(ART.bubble);
    if (isTextureReady(bubbleTex)) {
      const k = bw / bubbleTex.width;
      const plane = new PIXI.NineSlicePlane(bubbleTex, 60 / k, 40 / k, 60 / k, 70 / k);
      plane.width = bubbleTex.width;
      plane.height = bh / k;
      plane.scale.set(-k, k); // 水平镜像：让气泡尖尾朝右下指向阿橘
      plane.position.set(x + bw, y);
      scene.addChild(plane);
    } else {
      const fb = new PIXI.Graphics();
      fb.lineStyle(2.5, SCENE_INK.ink, 0.9);
      fb.beginFill(0xFFF6E4, 0.96);
      fb.drawRoundedRect(x, y, bw, bh - 14, 22);
      fb.endFill();
      scene.addChild(fb);
    }
    t.anchor.set(0.5);
    t.position.set(x + bw / 2, y + (bh - 16) / 2);
    scene.addChild(t);
  }

  // ── 护墙板第一行：猫窝档次 + 焕新 ──────────────────────────────────────
  private _drawBedRow(scene: PIXI.Container, y: number): void {
    const save = KitchenManager.save;
    const def = CAT_BED_TIER_DEFS[catBedTier(save)];
    const st = catBedUpgradeState(save);

    const btnW = 192;
    const btnH = 56;
    const bx = L.contentR - btnW;

    const name = woodText('heading', `猫窝 · ${def.name}`, 28);
    name.position.set(L.contentX, y + 8);
    scene.addChild(name);

    const perk = st.status === 'max'
      ? '巡街最快 · 上品好货与带券率最高'
      : `下一阶：${st.nextDesc}`;
    const perkT = woodText('caption', perk, 22, WARM_SUB);
    perkT.position.set(L.contentX, y + 48);
    fitTextWidth(perkT, st.status === 'max' ? L.contentR - L.contentX - 110 : bx - L.contentX - 16);
    scene.addChild(perkT);

    if (st.status === 'max') {
      const maxTag = woodText('heading', '已满阶', 24, 0xFFE082);
      maxTag.anchor.set(1, 0.5);
      maxTag.position.set(L.contentR, y + 42);
      scene.addChild(maxTag);
      return;
    }

    const lockedByLevel = cookLevel(save) < st.cookNeed;
    const ready = st.status === 'ready';
    const btn = lockedByLevel
      ? makeSlicedButton({
        label: `${st.cookNeed}级可焕新`,
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 22,
        silent: true,
        onReady: this._scheduleRelayout,
      })
      : makeCoinButton({
        prefix: '焕新',
        price: st.cost,
        width: btnW,
        height: btnH,
        skin: ready ? 'gold' : 'cream',
        textColor: ready ? SCENE_INK.ink : 0x8A7358,
        fontSize: 24,
        silent: !ready,
        onReady: this._scheduleRelayout,
      });
    btn.position.set(bx, y + 14);
    btn.on('pointertap', () => {
      const cost = st.cost;
      if (KitchenManager.upgradeCatBed()) {
        const nextSave = KitchenManager.save;
        const nextTier = catBedTier(nextSave);
        analytics.trackCatAction({
          action: 'upgrade_bed',
          bedTier: nextTier,
          costGold: cost,
        });
        analytics.trackKitchenUpgrade({
          targetType: 'cat_bed',
          targetId: 'cat_bed',
          newLevel: nextTier + 1,
          costGold: cost,
          cookLevel: cookLevel(nextSave),
        });
        if (this._isOpen) this.relayout();
      }
    });
    scene.addChild(btn);
  }

  // ── 第二行：亲密进度（小爪印 / 手绘进度槽）+ 巡街/带券率 ─────────────────
  private _drawBondRow(scene: PIXI.Container, view: CatStateView, y: number): void {
    if (!view.adopted) {
      const msg = view.effectiveStatus === 'locked'
        ? `厨艺升到 ${CAT_UNLOCK_LEVEL} 级，${CAT_NAME}就会顺着饭香找上门`
        : `收留后，${CAT_NAME}每天去菜场后巷帮你寻好货`;
      const t = woodText('body', msg, 24, WARM_SUB);
      t.position.set(L.contentX, y + 20);
      fitTextWidth(t, L.contentR - L.contentX);
      scene.addChild(t);
      return;
    }

    const bond = view.bond;
    const cy = y + 36;
    const label = woodText('heading', '亲密', 26);
    label.anchor.set(0, 0.5);
    label.position.set(L.contentX, cy);
    scene.addChild(label);

    const save = KitchenManager.save;
    const mins = catEffectiveOutingMinutes(save, bond.outingMinutes);
    const pct = Math.round((bond.ticketChance + CAT_BED_TIER_DEFS[catBedTier(save)].ticketBonus) * 100);
    const stat = woodText('caption', `巡街${mins}分 · 带券${pct}%`, 22, WARM_SUB);
    stat.anchor.set(1, 0.5);
    stat.position.set(L.contentR, cy);
    scene.addChild(stat);

    let x = L.contentX + label.width + 14;
    const maxed = bond.nextCeil === null;
    const span = maxed ? 0 : bond.nextCeil! - bond.curFloor;
    const got = maxed ? 0 : bond.xp - bond.curFloor;

    // 6 步以内用梅花小爪印直排，步数更多时用手绘蜜色进度条避免与右侧属性碰撞
    if (!maxed && span > 0 && span <= 6) {
      for (let i = 0; i < span; i++) {
        const paw = sceneSprite(ART.paw, 34, 34);
        if (!paw) break;
        paw.anchor.set(0, 0.5);
        paw.position.set(x, cy);
        if (i >= got) {
          paw.tint = 0x5C3D24;
          paw.alpha = 0.52;
        }
        scene.addChild(paw);
        x += 40;
      }
    } else {
      const availBarW = Math.min(196, Math.max(110, stat.x - stat.width - x - 86));
      const bar = makeHandProgressBar({
        width: availBarW,
        height: 22,
        ratio: maxed ? 1 : Math.max(0.06, bond.fill),
        onReady: this._scheduleRelayout,
      });
      bar.node.position.set(x, cy - 11);
      scene.addChild(bar.node);
      const n = woodText('caption', maxed ? 'MAX' : `${got}/${span}`, 22);
      n.anchor.set(0, 0.5);
      n.position.set(x + availBarW + 10, cy);
      scene.addChild(n);
    }
  }

  // ── 第三行：收留 / 拆包袱 / 鲜鱼罐头 ───────────────────────────────────
  private _drawActionRow(scene: PIXI.Container, view: CatStateView, y: number): void {
    const status = view.effectiveStatus;
    const btnW = 220;
    const btnH = 62;
    const bx = L.contentR - btnW;
    const by = y + 28;

    if (status === 'locked') {
      const t1 = woodText('title', '墙根草垫还空着', 28);
      t1.position.set(L.contentX, y + 20);
      const t2 = woodText('caption', `厨艺达到 ${CAT_UNLOCK_LEVEL} 级即可免费收留`, 22, WARM_SUB);
      t2.position.set(L.contentX, y + 64);
      fitTextWidth(t2, bx - L.contentX - 16);
      scene.addChild(t1, t2);

      const lockBtn = makeSlicedButton({
        label: `厨艺${CAT_UNLOCK_LEVEL}级开启`,
        width: btnW,
        height: btnH,
        skin: 'cream',
        textColor: 0x8A7358,
        fontSize: 24,
        silent: true,
        onReady: this._scheduleRelayout,
      });
      lockBtn.position.set(bx, by);
      lockBtn.on('pointertap', () => {
        AudioManager.play('ui_deny');
        Platform.showToast(`厨艺升到 ${CAT_UNLOCK_LEVEL} 级就能收留${CAT_NAME}啦`);
      });
      scene.addChild(lockBtn);
      return;
    }

    if (status === 'unadopted' || status === 'gift') {
      const isGift = status === 'gift';
      const line1 = isGift
        ? (view.pendingGift?.deluxe ? '豪华红格包袱到啦！' : `${CAT_NAME}叼回一只小包袱`)
        : '给它留块暖草垫吧';
      const line2 = isGift
        ? (view.pendingGift?.deluxe ? '内含 3 件好货与赏金谢礼' : '快帮它解开红格布结看看')
        : '免费收留，不花一分钱';
      const t1 = woodText('title', line1, 30);
      t1.position.set(L.contentX, y + 20);
      fitTextWidth(t1, bx - L.contentX - 16);
      const t2 = woodText('caption', line2, 22, WARM_SUB);
      t2.position.set(L.contentX, y + 66);
      fitTextWidth(t2, bx - L.contentX - 16);
      scene.addChild(t1, t2);

      const btn = makeSlicedButton({
        label: isGift ? '拆开包袱' : '免费收留',
        width: btnW,
        height: btnH,
        skin: 'olive',
        fontSize: 28,
        onReady: this._scheduleRelayout,
      });
      btn.position.set(bx, by);
      btn.on('pointertap', () => {
        if (!isGift) {
          if (KitchenManager.adoptCat()) {
            const nextSave = KitchenManager.save;
            analytics.trackCatAction({
              action: 'adopt',
              bondLevel: catStateView(nextSave, Date.now()).bond.level,
              bedTier: catBedTier(nextSave),
            });
            if (this._isOpen) this.relayout();
          }
          return;
        }
        this._claimGift();
      });
      scene.addChild(btn);
      return;
    }

    // idle / away：鲜鱼罐头（点击罐头图标可查看说明）
    const canHit = new PIXI.Container();
    canHit.position.set(L.contentX + 44, y + 60);
    const can = sceneSprite(P2_ART.catCan, 88, 88);
    if (can) {
      can.anchor.set(0.5);
      canHit.addChild(can);
    }
    canHit.eventMode = 'static';
    canHit.cursor = 'pointer';
    canHit.hitArea = new PIXI.Rectangle(-46, -46, 92, 92);
    canHit.on('pointertap', (e) => {
      e.stopPropagation();
      AudioManager.play('ui_click');
      this._inspect = this._canInspect(status === 'away');
      this.relayout();
    });
    scene.addChild(canHit);

    const tx = L.contentX + 102;
    const isAway = status === 'away';
    const t1 = woodText('title', isAway ? '摇罐头唤它回家' : '鲜鱼罐头', 28);
    t1.position.set(tx, y + 20);
    fitTextWidth(t1, bx - tx - 12);
    const t2 = woodText(
      'caption',
      isAway ? '立刻回屋，还多顺 1 件好货' : '免食材 · 亲密+2 · 立拿豪华包袱',
      22,
      WARM_SUB,
    );
    t2.position.set(tx, y + 66);
    fitTextWidth(t2, bx - tx - 12);
    scene.addChild(t1, t2);

    const left = dailyAdLeft(KitchenManager.save, 'cat_treat');
    const canUse = canUseDailyAd(KitchenManager.save, 'cat_treat');
    const btn = makeAdButton({
      label: isAway ? '摇铃唤回' : '喂罐头',
      width: btnW,
      height: btnH,
      skin: 'gold',
      badge: `${left}/${DAILY_AD_LIMITS.cat_treat}`,
      disabled: !canUse,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(bx, by);
    btn.on('pointertap', () => {
      if (this._adBusy) return;
      if (!canUse) {
        Platform.showToast('今天的鲜鱼罐头喂完啦，明天再来宠它');
        return;
      }
      this._adBusy = true;
      Platform.showRewardedVideo(
        'cat_treat',
        () => {
          this._adBusy = false;
          const mode = KitchenManager.useCatCan();
          if (mode) {
            const nextSave = KitchenManager.save;
            analytics.trackCatAction({
              action: 'ad_can',
              catMode: mode,
              bondLevel: catStateView(nextSave, Date.now()).bond.level,
              bedTier: catBedTier(nextSave),
              deluxe: mode === 'deluxe_instant',
            });
          }
          if (this._isOpen) this.relayout();
        },
        () => {
          this._adBusy = false;
        },
      );
    });
    scene.addChild(btn);
  }

  private _canInspect(isAway: boolean): ItemInspectView {
    return {
      title: '鲜鱼罐头',
      blurb: isAway
        ? `咔哒拉开拉环，正在后巷巡街的${CAT_NAME}会立刻飞奔回屋，还会顺爪多捎一件稀有好货与赏金！`
        : `不消耗冰箱食材，${CAT_NAME}舔光鲜鱼罐头后亲密直加 2 点，并当场叼回装着 3 件稀有好货的豪华红格包袱！`,
      kind: 'food',
      defId: 'cat_can',
      quality: 'fresh',
      rarity: 'epic',
      unitPrice: 0,
      maxQty: 1,
      iconPath: P2_ART.catCan,
      note: `每日限 ${DAILY_AD_LIMITS.cat_treat} 次`,
      priceLine: '看视频免费宠猫',
      eatLabel: isAway ? '摇铃立归 · 包袱加量' : '亲密 +2 · 立得 3 件好货',
    };
  }

  private _drawNote(scene: PIXI.Container, view: CatStateView, y: number): void {
    const status = view.effectiveStatus;
    const msg = status === 'locked'
      ? '多做几道拿手好菜提升厨艺，很快就能遇见小橘猫啦'
      : status === 'unadopted'
        ? `收留后，冰箱里的余菜小鱼都能喂${CAT_NAME}换谢礼`
        : status === 'away'
          ? `${CAT_NAME}正在菜场后巷寻宝，回来就能拆红格包袱`
          : '先拆开包袱收下谢礼，再给它添下一顿吧';
    const t = woodText('body', msg, 24, WARM_SUB);
    t.anchor.set(0.5, 0);
    t.position.set(W / 2, y + 26);
    fitTextWidth(t, L.contentR - L.contentX);
    scene.addChild(t);
  }

  // ── 投喂：草编餐垫上一排猫碗，碗里盛着冰箱生鲜余菜 ───────────────────────
  private _drawFeeder(scene: PIXI.Container, opts: CatFeedOption[], y: number): void {
    const head = woodText('heading', '投喂余菜', 28);
    head.position.set(L.contentX, y + 10);
    scene.addChild(head);

    const rule = woodText('caption', '鱼肉 ♥+2 · 蔬果 ♥+1 · 点碗投喂', 22, WARM_SUB);
    rule.anchor.set(1, 0);
    rule.position.set(L.contentR, y + 16);
    fitTextWidth(rule, L.contentR - L.contentX - head.width - 20);
    scene.addChild(rule);

    if (!opts.length) {
      const t = woodText('body', '冰箱还没有生鲜余菜，先去菜场捡一篮回来吧', 24, WARM_SUB);
      t.anchor.set(0.5, 0);
      t.position.set(W / 2, y + 64);
      fitTextWidth(t, L.contentR - L.contentX);
      scene.addChild(t);
      return;
    }

    const list = opts.slice(0, 8);
    const perRow = 4;
    const spanW = L.contentR - L.contentX;
    const cellW = spanW / perRow;
    const rows = Math.ceil(list.length / perRow);
    const matTex = gameTexture(ART.mat);

    for (let r = 0; r < rows; r++) {
      const rowY = y + 58 + r * L.bowlRowStep;
      // 九宫格拉伸草编餐垫：绳编圆弧两端不挤压变形
      const matW = spanW + 16;
      const matH = 72;
      if (isTextureReady(matTex)) {
        const s = Math.min(1, matH / matTex.height);
        const plane = new PIXI.NineSlicePlane(matTex, 96, 36, 96, 36);
        plane.width = matW / s;
        plane.height = matH / s;
        plane.scale.set(s);
        plane.position.set(L.contentX - 8, rowY + 62);
        scene.addChild(plane);
      }
      for (let c = 0; c < perRow; c++) {
        const opt = list[r * perRow + c];
        if (!opt) continue;
        this._drawBowl(scene, opt, L.contentX + cellW * c + cellW / 2, rowY);
      }
    }
  }

  private _drawBowl(scene: PIXI.Container, opt: CatFeedOption, cx: number, top: number): void {
    const cell = new PIXI.Container();
    cell.position.set(cx, top);

    const face = new PIXI.Container();
    face.eventMode = 'none';
    cell.addChild(face);

    const bowl = sceneSprite(ART.bowl, 114);
    const bowlCy = 70;
    if (bowl) {
      bowl.anchor.set(0.5);
      bowl.position.set(0, bowlCy);
      face.addChild(bowl);
    }
    const icon = sceneSprite(resolveItemAssetPath(opt.defId), 64, 64);
    if (icon) {
      icon.anchor.set(0.5, 1);
      icon.position.set(0, bowlCy + 10);
      face.addChild(icon);
      if (opt.canFeed) {
        attachSpriteContour(face, icon, itemRarity(opt.defId), { thicknessScale: 0.8 });
      }
    }

    // 碗沿右上角爱心值
    const heartT = makeText(
      'number',
      opt.fav ? '♥+2' : '♥+1',
      opt.fav ? 0xD6452A : 0x8A5A3A,
      { size: 22, stroke: 0xFFF6E6, strokeWidth: 4 },
    );
    heartT.anchor.set(0.5);
    heartT.position.set(40, 22);
    face.addChild(heartT);

    // 餐垫下方清楚标出菜名与数量，不压碗底与小爪印
    const name = woodText('caption', opt.name, 23);
    name.anchor.set(0.5, 0);
    name.position.set(0, 128);
    fitTextWidth(name, 146);
    face.addChild(name);

    const qty = makeText(
      'number',
      `${opt.have}/${opt.need}`,
      opt.canFeed ? 0xC9F0A8 : 0xFFB39E,
      { size: 23, stroke: STROKE, strokeWidth: 4 },
    );
    qty.anchor.set(0.5, 0);
    qty.position.set(0, 158);
    face.addChild(qty);

    if (!opt.canFeed) {
      if (bowl) bowl.alpha = 0.62;
      if (icon) icon.alpha = 0.5;
    }

    cell.eventMode = 'static';
    cell.cursor = 'pointer';
    cell.hitArea = new PIXI.Rectangle(-74, 8, 148, 184);
    const resetFace = (): void => {
      face.y = 0;
      face.scale.set(1);
    };
    cell.on('pointerdown', () => {
      face.y = 2;
      face.scale.set(0.96);
    });
    cell.on('pointerup', resetFace);
    cell.on('pointerupoutside', resetFace);
    cell.on('pointercancel', resetFace);
    cell.on('pointertap', () => {
      if (KitchenManager.feedCat(opt.defId)) {
        const nextSave = KitchenManager.save;
        analytics.trackCatAction({
          action: 'feed',
          foodId: opt.defId,
          fav: opt.fav,
          bondLevel: catStateView(nextSave, Date.now()).bond.level,
          bedTier: catBedTier(nextSave),
        });
        if (this._isOpen) this.relayout();
      }
    });
    scene.addChild(cell);
  }
}
