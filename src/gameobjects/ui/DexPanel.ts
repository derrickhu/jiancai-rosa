import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  DEX_ENTRY_GOLD,
  DEX_FOOD_CATS,
  DEX_STAMP_SETS,
  dexMilestoneStatus,
  dexObtainHint,
  dexRedDotCount,
  dexStampSetStatus,
  dishGroupCatIcon,
  dishGroupTheme,
  dishGroups,
  dishesInGroup,
  foodsInCat,
  isDexEntryClaimed,
  isDishUnlocked,
  isFoodUnlocked,
  isStampMemberUnlocked,
  itemRarity,
  recipeMasteryView,
  recipeRarity,
  stampMemberName,
  unclaimedDexInDishGroup,
  unclaimedDexInFoodCat,
  unclaimedDexStampSets,
  type DexEntryKind,
  type DexFoodCat,
  type DexTab,
  type KitchenSave,
  type Rarity,
  isRecipeId,
  recipeEatLabel,
} from '@/sim';
import { kitchenGachaHudPos, playRewardCollect, playTicketCollect } from '@/utils/coinCollect';
import {
  HUD_ICON,
  P0_ART,
  drawCraftCard,
  drawItemSlotBox,
  drawSectionTray,
  fillRect,
  makeDexName,
  makeLabel,
  makeMasterySpoonRow,
  makeSlicedButton,
  makeSlotBadge,
  makeStrokeLabel,
} from '@/utils/ui';
import {
  applyGray,
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  imgPath,
  isTextureReady,
  itemTexture,
  watchTextures,
} from '@/utils/assets';
import { dexViewPaths } from '@/utils/panelAssets';

const BG = 'subpkg_kitchen/ui_dex_panel.png';
const INK = 0x2A2018;
const MUTED = 0x8A6A40;
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const PAGE = { x: 0.155, y: 0.152, w: 0.725, h: 0.688 };
const TITLE_Y = 0.052;

type View =
  | { kind: 'home' }
  | { kind: 'food'; cat: DexFoodCat }
  | { kind: 'dish'; group: string };

export class DexPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _tab: DexTab = 'food';
  private _view: View = { kind: 'home' };
  private _scrollY = 0;
  private _scrollMax = 0;
  private _scrollBaseY = 0;
  private _scrollList: PIXI.Container | null = null;
  private _scrollHit = { x: 0, y: 0, w: 0, h: 0 };
  private _dragging = false;
  private _dragY = 0;
  private _dragStart = 0;
  private _dragMoved = false;
  private _wxBound = false;
  private _paintQueued = false;
  private _inspect: { title: string; blurb: string } | null = null;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 24;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this.on('pointerdown', this._onPtrDown);
    this.on('globalpointermove', this._onPtrMove);
    this.on('pointerup', this._onPtrUp);
    this.on('pointerupoutside', this._onPtrUp);
    this.on('pointercancel', this._onPtrUp);
    this.on('wheel', this._onWheel);
  }

  open(tab: DexTab = 'food'): void {
    this._tab = tab;
    this._view = { kind: 'home' };
    this._scrollY = 0;
    this._inspect = null;
    if (!this._isOpen) AudioManager.play('ui_open');
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
    this._bindWx(true);
    this._warmView();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._inspect = null;
    this._dragging = false;
    this._bindWx(false);
  }

  relayout(): void {
    this._root.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);
    const redraw = this._scheduleRelayout;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.46;
    dim.eventMode = 'static';
    dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const box = this._boardBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    shell.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(shell);

    this._warmView();
    const bgTex = gameTexture(BG);
    if (isTextureReady(bgTex)) {
      const bg = new PIXI.Sprite(bgTex);
      bg.width = box.w;
      bg.height = box.h;
      shell.addChild(bg);
    }

    this._drawClose(shell, box.w);
    const page = {
      x: box.w * PAGE.x,
      y: box.h * PAGE.y,
      w: box.w * PAGE.w,
      h: box.h * PAGE.h,
    };
    this._drawHeader(shell, box.w, box.h, page, redraw);
    this._drawBody(shell, box, page, redraw);
    this._drawFooter(shell, box.w, box.h, page);
  }

  private _boardBox(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const top = (Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 8;
    const bottom = 16 + Game.safeBottom;
    const height = Math.min(h - top - bottom, 1120);
    const width = Math.min(w - 24, Math.round(height * (750 / 1136)));
    return { x: (w - width) / 2, y: top + (h - top - bottom - height) / 2, w: width, h: height };
  }

  private _drawClose(shell: PIXI.Container, bw: number): void {
    const btn = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.lineStyle(3, INK, 1);
    g.beginFill(0xC46A3A);
    g.drawCircle(22, 22, 20);
    g.endFill();
    const x = makeLabel('×', 28, 0xFFF8F0, { fontWeight: '700' });
    x.anchor.set(0.5);
    x.position.set(22, 20);
    btn.addChild(g, x);
    btn.position.set(bw - 58, 18);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = new PIXI.Circle(22, 22, 22);
    btn.on('pointertap', () => this.close());
    shell.addChild(btn);
  }

  private _drawHeader(
    shell: PIXI.Container,
    bw: number,
    bh: number,
    page: { x: number; y: number; w: number },
    redraw: () => void,
  ): void {
    const title = this._titleText();
    const head = makeLabel(title, 36, INK, { fontFamily: TITLE_FONT, fontWeight: '700' });
    head.anchor.set(0.5);
    head.position.set(bw / 2, bh * TITLE_Y);
    shell.addChild(head);

    const save = KitchenManager.save;
    const { have, total } = this._progress(save);
    const ms = dexMilestoneStatus(save);
    const claimable = dexRedDotCount(save) > 0;

    const barH = 54;
    const bar = new PIXI.Container();
    bar.position.set(page.x, page.y + 4);
    const barBg = new PIXI.Graphics();
    barBg.lineStyle(2.5, 0x8B5A2B, 1);
    barBg.beginFill(0xFFF6E8, 0.96);
    barBg.drawRoundedRect(0, 0, page.w, barH, 16);
    barBg.endFill();
    bar.addChild(barBg);

    const stampTex = gameTexture(P0_ART.dexStamp);
    if (isTextureReady(stampTex)) {
      const sp = new PIXI.Sprite(stampTex);
      fitSpriteInBox(sp, 42, 42);
      sp.anchor.set(0.5);
      sp.position.set(28, barH / 2);
      sp.eventMode = 'none';
      bar.addChild(sp);
    }

    const line1 = makeLabel(
      `已收集 ${have}/${total}  ·  集章 ${ms.stepProgress}/${ms.stepNeed}`,
      17,
      INK,
      { fontWeight: '700' },
    );
    line1.position.set(52, 7);
    const line2 = makeLabel(
      ms.readySteps > 0 ? `集章满档！可领菜谱券 ×${ms.readySteps}` : '每集满 6 项送菜谱券×1 + 12金',
      13,
      ms.readySteps > 0 ? 0xC46A3A : MUTED,
      { fontWeight: '600' },
    );
    line2.position.set(52, 30);
    bar.addChild(line1, line2);

    if (claimable) {
      const btnW = 122;
      const btnH = 38;
      const claimBtn = makeSlicedButton({
        label: '盖章领赏',
        width: btnW,
        height: btnH,
        skin: 'terracotta',
        textColor: 0xFFF8F0,
        onReady: redraw,
      });
      claimBtn.position.set(page.w - btnW - 8, Math.round((barH - btnH) / 2));
      claimBtn.on('pointertap', (e) => {
        e.stopPropagation();
        const res = KitchenManager.claimAllDex();
        if (res.gold <= 0 && res.tickets <= 0) return;
        const from = { x: Game.designWidth / 2, y: Math.round(Game.logicHeight * 0.28) };
        if (res.gold > 0) playRewardCollect({ gold: res.gold, from });
        if (res.tickets > 0) playTicketCollect(from, kitchenGachaHudPos(), 0);
        const parts: string[] = [];
        if (res.gold > 0) parts.push(`+${res.gold} 金`);
        if (res.tickets > 0) parts.push(`菜谱券 ×${res.tickets}`);
        Platform.showToast(`盖章领赏：${parts.join('  ')}`, 'success');
        if (this.visible) this.relayout();
      });
      bar.addChild(claimBtn);
    }
    shell.addChild(bar);

    if (this._view.kind === 'home') {
      const tabY = page.y + 66;
      const gap = 8;
      const tw = (page.w - gap * 2) / 3;
      const stampReady = unclaimedDexStampSets(save).length;
      (['food', 'dish', 'stamp'] as const).forEach((tab, i) => {
        const on = this._tab === tab;
        const label = tab === 'food' ? '食材' : tab === 'dish' ? '菜品' : '集章册';
        const btn = makeSlicedButton({
          label,
          width: tw,
          height: 46,
          skin: on ? 'terracotta' : 'cream',
          textColor: on ? 0xFFF8F0 : INK,
          fontSize: 20,
          onReady: redraw,
        });
        btn.position.set(page.x + i * (tw + gap), tabY);
        if (tab === 'stamp' && stampReady > 0) {
          const dot = makeSlotBadge(`可盖${stampReady}`, 'lack', 12);
          dot.node.position.set(tw - dot.w + 4, -8);
          btn.addChild(dot.node);
        }
        btn.on('pointertap', () => {
          this._tab = tab;
          this._view = { kind: 'home' };
          this._scrollY = 0;
          this._inspect = null;
          this.relayout();
        });
        shell.addChild(btn);
      });
    }
  }

  private _titleText(): string {
    const view = this._view;
    if (view.kind === 'food') {
      return DEX_FOOD_CATS.find((c) => c.id === view.cat)?.label ?? '食材';
    }
    if (view.kind === 'dish') return view.group;
    return this._tab === 'stamp' ? '烟火集章' : '图鉴';
  }

  private _progress(s: KitchenSave): { have: number; total: number } {
    if (this._view.kind === 'food') {
      const items = foodsInCat(this._view.cat);
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._view.kind === 'dish') {
      const items = dishesInGroup(this._view.group, s.recipesFound);
      return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._tab === 'food') {
      const items = DEX_FOOD_CATS.flatMap((c) => foodsInCat(c.id));
      return { have: items.filter((it) => isFoodUnlocked(s, it.id)).length, total: items.length };
    }
    if (this._tab === 'stamp') {
      const done = DEX_STAMP_SETS.filter((d) => dexStampSetStatus(s, d).claimed).length;
      return { have: done, total: DEX_STAMP_SETS.length };
    }
    const items = dishGroups().flatMap((g) => dishesInGroup(g, s.recipesFound));
    return { have: items.filter((it) => isDishUnlocked(s, it.id)).length, total: items.length };
  }

  private _drawBody(
    shell: PIXI.Container,
    box: { x: number; y: number },
    page: { x: number; y: number; w: number; h: number },
    redraw: () => void,
  ): void {
    const top = this._view.kind === 'home' ? page.y + 122 : page.y + 66;
    const bottom = page.y + page.h - (this._inspect ? 88 : 8);
    const area = { x: page.x, y: top, w: page.w, h: Math.max(80, bottom - top) };
    const list = new PIXI.Container();
    let contentH = 0;
    if (this._view.kind === 'home') {
      if (this._tab === 'food') contentH = this._paintFoodCats(list, area.w, redraw);
      else if (this._tab === 'dish') contentH = this._paintDishCats(list, area.w, redraw);
      else contentH = this._paintStampSets(list, area.w, redraw);
    } else {
      contentH = this._paintGrid(list, area.w, redraw);
    }
    contentH += 28;

    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRect(area.x, area.y, area.w, area.h);
    mask.endFill();
    mask.eventMode = 'none';
    const viewport = new PIXI.Container();
    viewport.eventMode = 'static';
    viewport.hitArea = new PIXI.Rectangle(area.x, area.y, area.w, area.h);
    viewport.mask = mask;
    list.position.set(area.x, area.y);
    viewport.addChild(list);
    this._scrollList = list;
    this._scrollBaseY = area.y;
    this._scrollMax = Math.max(0, contentH - area.h);
    this._scrollHit = { x: box.x + area.x, y: box.y + area.y, w: area.w, h: area.h };
    this._applyScroll(this._scrollY);
    shell.addChild(mask, viewport);

    if (this._inspect) {
      const card = new PIXI.Graphics();
      fillRect(card, page.x, page.y + page.h - 80, page.w, 76, 0xEFE6D6, 12);
      shell.addChild(card);
      const name = makeDexName(this._inspect.title, 22, true);
      name.position.set(page.x + 12, page.y + page.h - 72);
      shell.addChild(name);
      const blurb = makeLabel(this._inspect.blurb, 16, MUTED, { wordWrap: true, wordWrapWidth: page.w - 24 });
      blurb.position.set(page.x + 12, page.y + page.h - 44);
      shell.addChild(blurb);
    }
  }

  private _paintFoodCats(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      list,
      width,
      DEX_FOOD_CATS.map((cat) => {
        const items = foodsInCat(cat.id);
        const have = items.filter((it) => isFoodUnlocked(save, it.id)).length;
        const unclaimed = unclaimedDexInFoodCat(save, cat.id);
        return {
          label: cat.label,
          icon: cat.icon,
          have,
          total: items.length,
          unclaimed,
          ink: cat.ink,
          bar: cat.bar,
          onTap: () => {
            this._view = { kind: 'food', cat: cat.id };
            this._scrollY = 0;
            this._inspect = null;
            this.relayout();
          },
        };
      }),
      redraw,
    );
  }

  private _paintDishCats(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    return this._paintCatGrid(
      list,
      width,
      dishGroups().map((group) => {
        const items = dishesInGroup(group, save.recipesFound);
        const have = items.filter((it) => isDishUnlocked(save, it.id)).length;
        const unclaimed = unclaimedDexInDishGroup(save, group);
        return {
          label: group,
          icon: dishGroupCatIcon(group),
          have,
          total: items.length,
          unclaimed,
          ...dishGroupTheme(group),
          onTap: () => {
            this._view = { kind: 'dish', group };
            this._scrollY = 0;
            this._inspect = null;
            this.relayout();
          },
        };
      }),
      redraw,
    );
  }

  private _paintCatGrid(
    list: PIXI.Container,
    width: number,
    cats: Array<{ label: string; icon: string; have: number; total: number; unclaimed: number; ink: number; bar: number; onTap: () => void }>,
    redraw: () => void,
  ): number {
    const cols = 2;
    const gap = 14;
    const cardW = (width - gap) / cols;
    const icon = Math.round(cardW * 0.9);
    const cardH = icon + 8;
    cats.forEach((cat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      list.addChild(this._catCard(
        col * (cardW + gap),
        row * (cardH + gap),
        cardW,
        cardH,
        icon,
        cat,
        redraw,
      ));
    });
    return Math.ceil(cats.length / cols) * (cardH + gap);
  }

  private _catCard(
    x: number,
    y: number,
    width: number,
    height: number,
    iconSize: number,
    cat: { label: string; icon: string; have: number; total: number; unclaimed: number; ink: number; bar: number; onTap: () => void },
    _redraw: () => void,
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(x, y);
    const path = imgPath(`${cat.icon}.png`);
    const tex = gameTexture(path);
    const cx = width / 2;
    const cy = 4 + iconSize / 2;
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5);
      spr.position.set(cx, cy);
      fitSpriteInBox(spr, iconSize, iconSize);
      const clip = new PIXI.Graphics();
      clip.eventMode = 'none';
      const mw = Math.max(8, spr.width * 0.97);
      const mh = Math.max(8, spr.height * 0.97);
      clip.beginFill(0xffffff);
      clip.drawRoundedRect(cx - mw / 2, cy - mh / 2, mw, mh, Math.min(mw, mh) * 0.2);
      clip.endFill();
      spr.mask = clip;
      root.addChild(spr, clip);
    }
    const name = makeStrokeLabel(cat.label, 26, 0xFFF8F0, cat.ink, 6, { fontFamily: TITLE_FONT });
    name.anchor.set(0.5);
    name.position.set(cx, 4 + iconSize * 0.66);
    root.addChild(name);

    const barW = iconSize * 0.68;
    const barH = 24;
    const bx = cx - barW / 2;
    const by = 4 + iconSize * 0.78;
    const bar = new PIXI.Graphics();
    bar.lineStyle(3.5, cat.ink, 1);
    bar.beginFill(0x1A1410, 0.42);
    bar.drawRoundedRect(bx, by, barW, barH, barH / 2);
    bar.endFill();
    const fillW = cat.total > 0 ? Math.max(0, barW * (cat.have / cat.total)) : 0;
    if (fillW > 6) {
      bar.beginFill(cat.bar);
      bar.drawRoundedRect(bx, by, fillW, barH, barH / 2);
      bar.endFill();
    }
    root.addChild(bar);
    const count = makeStrokeLabel(`${cat.have}/${cat.total}`, 15, 0xFFF8F0, cat.ink, 3.5);
    count.anchor.set(0.5);
    count.position.set(cx, by + barH / 2);
    root.addChild(count);

    if (cat.unclaimed > 0) {
      const badge = new PIXI.Container();
      const txt = makeLabel(`新 ${cat.unclaimed}`, 14, 0xFFF8F0, { fontWeight: '700' });
      const bw = Math.max(44, Math.ceil(txt.width) + 16);
      const bh = 24;
      const g = new PIXI.Graphics();
      g.lineStyle(2, INK, 1);
      g.beginFill(0xD94A3A, 1);
      g.drawRoundedRect(0, 0, bw, bh, bh / 2);
      g.endFill();
      txt.anchor.set(0.5);
      txt.position.set(bw / 2, bh / 2 + 0.5);
      badge.addChild(g, txt);
      badge.position.set(width - bw - 8, 8);
      badge.eventMode = 'none';
      root.addChild(badge);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      cat.onTap();
    });
    return root;
  }

  private _paintStampSets(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    let y = 0;
    const gap = 12;
    for (const def of DEX_STAMP_SETS) {
      const st = dexStampSetStatus(save, def);
      const cardH = 196;
      const card = new PIXI.Container();
      card.position.set(0, y);

      const bg = new PIXI.Graphics();
      drawCraftCard(bg, 0, 0, width, cardH, {
        radius: 16,
        tone: st.claimed ? 'gold' : st.readyToClaim ? 'warm' : 'ivory',
      });
      // Left accent bar
      bg.lineStyle(0);
      bg.beginFill(def.accent, 0.92);
      bg.drawRoundedRect(5, 8, 6, cardH - 16, 3);
      bg.endFill();
      card.addChild(bg);

      const title = makeLabel(`《${def.title}》`, 20, INK, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
      });
      title.position.set(16, 10);
      card.addChild(title);

      const progBadge = makeSlotBadge(
        st.claimed ? '已盖章生效' : `${st.have}/${st.total}`,
        st.claimed ? 'gold' : st.readyToClaim ? 'lack' : 'ink',
        12,
      );
      progBadge.node.position.set(width - progBadge.w - 12, 10);
      card.addChild(progBadge.node);

      const sub = makeLabel(def.subtitle, 13, MUTED);
      sub.position.set(18, 36);
      card.addChild(sub);

      // Recessed tray holding the 6-7 member slots
      const trayX = 16;
      const trayY = 58;
      const trayW = width - 32;
      const trayH = 74;
      const tray = new PIXI.Graphics();
      drawSectionTray(tray, trayX, trayY, trayW, trayH, { radius: 12, tone: 'sand' });
      card.addChild(tray);

      const count = def.members.length;
      const slotGap = 6;
      const slotSize = Math.min(58, Math.floor((trayW - 14 - slotGap * (count - 1)) / count));
      const rowW = count * slotSize + (count - 1) * slotGap;
      const startX = trayX + Math.round((trayW - rowW) / 2);
      const slotY = trayY + Math.round((trayH - slotSize) / 2);

      def.members.forEach((m, idx) => {
        const unlocked = isStampMemberUnlocked(save, m);
        const rarity: Rarity = m.kind === 'food'
          ? itemRarity(m.id)
          : (isRecipeId(m.id) ? recipeRarity(m.id) : 'common');
        const sx = startX + idx * (slotSize + slotGap);
        const slot = new PIXI.Container();
        slot.position.set(sx, slotY);
        const sg = new PIXI.Graphics();
        drawItemSlotBox(sg, 0, 0, slotSize, slotSize, {
          radius: 10,
          rarity,
          dimmed: !unlocked,
        });
        slot.addChild(sg);

        const tex = m.kind === 'food' ? itemTexture(m.id) : dishTexture(m.id);
        if (isTextureReady(tex)) {
          const spr = new PIXI.Sprite(tex);
          fitSpriteInBox(spr, slotSize - 10, slotSize - 10);
          spr.anchor.set(0.5);
          spr.position.set(slotSize / 2, slotSize / 2);
          if (!unlocked) applyGray(spr);
          slot.addChild(spr);
        }
        slot.eventMode = 'static';
        slot.cursor = 'pointer';
        slot.hitArea = new PIXI.Rectangle(0, 0, slotSize, slotSize);
        slot.on('pointertap', () => {
          if (this._dragMoved) return;
          const mName = stampMemberName(m);
          this._inspect = unlocked
            ? { title: mName, blurb: `已收录进《${def.title}》集章册。` }
            : { title: `待收集 · ${mName}`, blurb: dexObtainHint(m.kind, m.id) };
          this.relayout();
        });
        card.addChild(slot);
      });

      // Bottom buff + reward / claim button
      const buffTxt = makeLabel(def.buffLabel, 14, st.claimed ? 0x3D7A32 : 0x6A4A24, {
        fontWeight: '700',
      });
      buffTxt.position.set(18, 140);
      card.addChild(buffTxt);

      const rewParts = [`+${def.rewardGold}金`];
      if (def.rewardTickets > 0) rewParts.push(`菜谱券×${def.rewardTickets}`);
      const rewTxt = makeLabel(`集齐礼：${rewParts.join(' · ')}`, 13, MUTED, { fontWeight: '600' });
      rewTxt.position.set(18, 163);
      card.addChild(rewTxt);

      if (st.readyToClaim) {
        const btnW = 118;
        const btnH = 38;
        const claimBtn = makeSlicedButton({
          label: '盖章激活',
          width: btnW,
          height: btnH,
          skin: 'terracotta',
          textColor: 0xFFF8F0,
          fontSize: 16,
          onReady: redraw,
        });
        claimBtn.position.set(width - btnW - 14, 144);
        claimBtn.on('pointertap', (e) => {
          e.stopPropagation();
          if (this._dragMoved) return;
          const res = KitchenManager.claimStampSet(def.id);
          if (!res.claimed) return;
          const from = { x: e.global.x, y: e.global.y };
          if (res.gold > 0) playRewardCollect({ gold: res.gold, from });
          if (res.tickets > 0) playTicketCollect(from, kitchenGachaHudPos(), 0);
          Platform.showToast(`《${def.title}》盖章！${res.buffLabel}`, 'success');
          if (this.visible) this.relayout();
        });
        card.addChild(claimBtn);
      } else if (st.claimed) {
        const stampTex = gameTexture(P0_ART.dexStamp);
        if (isTextureReady(stampTex)) {
          const seal = new PIXI.Sprite(stampTex);
          fitSpriteInBox(seal, 46, 46);
          seal.anchor.set(0.5);
          seal.rotation = -0.18;
          seal.alpha = 0.9;
          seal.position.set(width - 42, 162);
          seal.eventMode = 'none';
          card.addChild(seal);
        }
      }

      list.addChild(card);
      y += cardH + gap;
    }
    return y;
  }

  private _paintGrid(list: PIXI.Container, width: number, redraw: () => void): number {
    const save = KitchenManager.save;
    const cols = 3;
    const gap = 10;
    const cellW = (width - gap * (cols - 1)) / cols;
    const dish = this._view.kind === 'dish';
    const cellH = dish ? 182 : 148;
    const iconH = dish ? 112 : 88;
    let entries: Array<{ id: string; name: string; blurb: string; unlocked: boolean; dish: boolean; rarity: Rarity }>;
    if (this._view.kind === 'food') {
      entries = foodsInCat(this._view.cat).map((it) => ({
        id: it.id,
        name: it.name,
        blurb: it.blurb,
        unlocked: isFoodUnlocked(save, it.id),
        dish: false,
        rarity: it.rarity,
      }));
    } else if (this._view.kind === 'dish') {
      entries = dishesInGroup(this._view.group, save.recipesFound).map((it) => ({
        id: it.id,
        name: it.name,
        blurb: it.blurb,
        unlocked: isDishUnlocked(save, it.id),
        dish: true,
        rarity: it.rarity,
      }));
    } else {
      entries = [];
    }
    if (!entries.length) {
      const empty = makeLabel('这类还没收过货。', 22, MUTED);
      empty.position.set(12, 16);
      list.addChild(empty);
      return 48;
    }
    entries.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new PIXI.Container();
      card.position.set(col * (cellW + gap), row * (cellH + gap));
      const footerH = dish ? 40 : 36;
      const g = new PIXI.Graphics();
      drawItemSlotBox(g, 0, 0, cellW, cellH, {
        radius: 13,
        rarity: it.rarity,
        dimmed: !it.unlocked,
        footerH,
      });
      card.addChild(g);
      const tex = it.dish ? dishTexture(it.id) : itemTexture(it.id);
      if (isTextureReady(tex)) {
        const spr = new PIXI.Sprite(tex);
        spr.anchor.set(0.5);
        spr.position.set(cellW / 2, dish ? 54 : 52);
        fitSpriteInBox(spr, cellW - (dish ? 14 : 22), iconH - 6);
        if (!it.unlocked) applyGray(spr);
        card.addChild(spr);
      }
      const label = makeDexName(it.unlocked ? it.name : '未解锁', dish ? 17 : 16, it.unlocked, cellW - 10);
      label.anchor.set(0.5);
      label.position.set(cellW / 2, cellH - footerH / 2 - 1);
      card.addChild(label);

      const entryKind: DexEntryKind = it.dish ? 'dish' : 'food';
      const unclaimed = it.unlocked && !isDexEntryClaimed(save, entryKind, it.id);
      if (it.dish && it.unlocked && isRecipeId(it.id)) {
        const mastery = recipeMasteryView(save, it.id);
        const spoons = makeMasterySpoonRow({
          stars: mastery.stars,
          size: 20,
          gap: 2,
          onReady: redraw,
        });
        spoons.position.set(Math.round((cellW - (20 * 3 + 4)) / 2), 116);
        card.addChild(spoons);
      }
      if (unclaimed) {
        const tag = new PIXI.Container();
        const txt = makeLabel(`新 +${DEX_ENTRY_GOLD}金`, 13, 0xFFF8F0, { fontWeight: '700' });
        const tw = Math.ceil(txt.width) + 14;
        const th = 22;
        const bg = new PIXI.Graphics();
        bg.lineStyle(1.8, INK, 1);
        bg.beginFill(0xD94A3A, 1);
        bg.drawRoundedRect(0, 0, tw, th, th / 2);
        bg.endFill();
        txt.anchor.set(0.5);
        txt.position.set(tw / 2, th / 2 + 0.5);
        tag.addChild(bg, txt);
        tag.position.set(cellW - tw - 4, 4);
        tag.eventMode = 'none';
        card.addChild(tag);
      }

      card.eventMode = 'static';
      card.cursor = 'pointer';
      card.hitArea = new PIXI.Rectangle(0, 0, cellW, cellH);
      card.on('pointertap', (e) => {
        if (this._dragMoved) return;
        if (!it.unlocked) {
          this._inspect = {
            title: `未解锁 · ${it.dish ? '待寻菜谱' : '待寻食材'}`,
            blurb: dexObtainHint(entryKind, it.id),
          };
          this.relayout();
          return;
        }
        if (unclaimed) {
          const gold = KitchenManager.claimDexEntry(entryKind, it.id);
          if (gold > 0) {
            const p = e.global;
            playRewardCollect({ gold, from: { x: p.x, y: p.y } });
          }
        }
        let blurb = it.blurb;
        if (it.dish && isRecipeId(it.id)) {
          const m = recipeMasteryView(KitchenManager.save, it.id);
          blurb = `${it.blurb}  ${recipeEatLabel(it.id)}（${m.title} · 已做${m.cooked}锅）`;
        }
        this._inspect = {
          title: it.name,
          blurb,
        };
        this.relayout();
      });
      list.addChild(card);
    });
    return Math.ceil(entries.length / cols) * (cellH + gap);
  }

  private _drawFooter(shell: PIXI.Container, bw: number, bh: number, page: { x: number; w: number }): void {
    if (this._view.kind === 'home') return;
    const btn = makeSlicedButton({
      label: '返回',
      width: Math.min(220, page.w),
      height: 52,
      skin: 'terracotta',
      onReady: this._scheduleRelayout,
    });
    btn.position.set(page.x + (page.w - Math.min(220, page.w)) / 2, bh - 83);
    btn.on('pointertap', () => {
      this._view = { kind: 'home' };
      this._scrollY = 0;
      this._inspect = null;
      this.relayout();
    });
    shell.addChild(btn);
    void bw;
  }

  private _warmView(): void {
    const view = this._view.kind === 'home'
      ? { kind: 'home' as const, tab: this._tab }
      : this._view;
    watchTextures(
      [...dexViewPaths(KitchenManager.save, view), P0_ART.dexStamp, ...P0_ART.spoons],
      this._scheduleRelayout,
    );
  }

  private _scheduleRelayout = (): void => {
    if (!this.visible || this._paintQueued) return;
    this._paintQueued = true;
    const later = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
    later(() => {
      this._paintQueued = false;
      if (this.visible) this.relayout();
    });
  };

  private _applyScroll(y: number): void {
    this._scrollY = this._scrollMax <= 0 ? 0 : Math.max(-this._scrollMax, Math.min(0, y));
    if (this._scrollList) this._scrollList.y = this._scrollBaseY + this._scrollY;
  }

  private _inScroll(p: { x: number; y: number }): boolean {
    const r = this._scrollHit;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  private _wxPoint(res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }>; changedTouches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): { x: number; y: number } | null {
    const t = res.touches?.[0] ?? res.changedTouches?.[0];
    if (!t) return null;
    const scale = Game.contentScale || 1;
    return {
      x: (t.clientX ?? t.x ?? 0) / scale,
      y: (t.clientY ?? t.y ?? 0) / scale,
    };
  }

  private _beginDrag(y: number): void {
    this._dragging = true;
    this._dragMoved = false;
    this._dragY = y;
    this._dragStart = this._scrollY;
  }

  private _moveDrag(y: number): void {
    if (!this._dragging) return;
    const dy = y - this._dragY;
    if (Math.abs(dy) > 6) this._dragMoved = true;
    this._applyScroll(this._dragStart + dy);
  }

  private _onPtrDown = (e: PIXI.FederatedPointerEvent): void => {
    if (!this.visible) return;
    const p = this.toLocal(e.global);
    if (!this._inScroll(p)) return;
    this._beginDrag(p.y);
  };

  private _onPtrMove = (e: PIXI.FederatedPointerEvent): void => {
    if (!this.visible) return;
    this._moveDrag(this.toLocal(e.global).y);
  };

  private _onPtrUp = (): void => {
    this._dragging = false;
  };

  private _onWheel = (e: PIXI.FederatedWheelEvent): void => {
    if (!this.visible || this._scrollMax <= 0) return;
    const p = this.toLocal(e.global);
    if (!this._inScroll(p)) return;
    this._applyScroll(this._scrollY - e.deltaY);
  };

  private _onWxStart = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): void => {
    if (!this.visible) return;
    const p = this._wxPoint(res);
    if (!p || !this._inScroll(p)) return;
    this._beginDrag(p.y);
  };

  private _onWxMove = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): void => {
    if (!this.visible) return;
    const p = this._wxPoint(res);
    if (!p) return;
    this._moveDrag(p.y);
  };

  private _onWxEnd = (): void => {
    this._dragging = false;
  };

  private _bindWx(on: boolean): void {
    const api = Platform.api;
    if (!api?.onTouchMove) return;
    if (on && !this._wxBound) {
      try { api.onTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.onTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.onTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.onTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = true;
    } else if (!on && this._wxBound) {
      try { api.offTouchStart?.(this._onWxStart); } catch (_) {}
      try { api.offTouchMove?.(this._onWxMove); } catch (_) {}
      try { api.offTouchEnd?.(this._onWxEnd); } catch (_) {}
      try { api.offTouchCancel?.(this._onWxEnd); } catch (_) {}
      this._wxBound = false;
    }
  }
}
