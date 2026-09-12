import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { SceneManager } from '@/core/SceneManager';
import { KitchenManager } from '@/managers/KitchenManager';
import { RunManager } from '@/managers/RunManager';
import { Platform } from '@/core/PlatformService';
import {
  RARITY_STYLE,
  fridgeCap,
  fridgeItemPrice,
  fridgeItemQty,
  fridgeKind,
  itemRarity,
  previewFridgeAfterHaul,
  recipeRarity,
  type ExtractedItem,
  type ExtractResult,
  type FridgeItem,
  type Rarity,
  type RecipeId,
} from '@/sim';
import { HUD_ICON, bindUiClick, drawRarityFrame, fillRect, makeCornerMark, makeLabel, makeQtyMark, makeSlicedButton } from '@/utils/ui';
import { VerticalScroller } from '@/utils/scroll';
import { dishTexture, fitSpriteInBox, gameTexture, isTextureReady, itemLookTexture, watchTextures, whenTextureReady } from '@/utils/assets';
import { PANEL_SHELL, fridgeItemPath } from '@/utils/panelAssets';
import { TutorialManager, TutorialStep } from '@/managers/TutorialManager';
import { TutorialOverlay } from './TutorialOverlay';
import { TutorialGuard } from '@/systems/TutorialGuard';

const KIND_TEXT = {
  safe: '挑完回家',
  messy: '天黑收摊了',
} as const;

const TITLE_ART = {
  safe: 'subpkg_kitchen/ui_result_title_safe.png',
  messy: 'subpkg_kitchen/ui_result_title_messy.png',
} as const;

const FRIDGE_BG = 'subpkg_kitchen/ui_fridge_panel.png';
const BTN = 'subpkg_kitchen/ui_fridge_btn_terracotta.png';
const BURST = 'subpkg_kitchen/ui_result_burst.png';
const HEADER = { y: 0.028, h: 0.188 };
const CAVITY = { x: 0.12, y: 0.228, w: 0.76, h: 0.568 };
const FOOTER = { y: 0.798, h: 0.145 };
const TITLE_FONT = 'Songti SC, STSong, PingFang SC, serif';
const FLOAT_FONT = 'Kaiti SC, STKaiti, Songti SC, STSong, PingFang SC, serif';
const INK = 0x2A2018;
const GOLD = 0xC48A14;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;
const WALNUT = 0x8B5A2B;
const ROTTEN_FLOAT = 0xC9B8A8;

function fridgeSlotRarity(it: FridgeItem): Rarity {
  return fridgeKind(it) === 'dish' ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId);
}

export class ResultPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _data: ExtractResult | null = null;
  private _sell = new Set<string>();
  private _scroller: VerticalScroller;
  private _celebrate = false;
  private _pops: PIXI.Container[] = [];
  private _paintQueued = false;
  private _pickTapAt = 0;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 30;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
    this._scroller = new VerticalScroller(this, { visible: () => this._isOpen });
    this.on('pointertap', this._onBgTap);
  }

  private _onBgTap = (): void => {
    if (!this._isOpen) return;
    if (this._data?.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) return;
    this.close();
  };

  open(result: ExtractResult): void {
    this._isOpen = true;
    this.visible = true;
    this._data = result;
    this._sell.clear();
    this._celebrate = true;
    this._scroller.reset();
    this._scroller.enable();
    AudioManager.play(result.kind === 'safe' ? 'result_safe' : 'result_dusk');
    this.relayout(result);
    OverlayManager.bringToFront();
    TutorialOverlay.onBlankTap(this._onBgTap);
    TutorialOverlay.register('result', () => ({ dim: false }));
    TutorialOverlay.refresh();
  }

  tutorialBodyRect(): { dim: false } {
    return { dim: false };
  }

  close(): void {
    if (!this._isOpen) return;
    if (TutorialGuard.block('closeResult')) return;
    if (KitchenManager.pendingHaul?.length) {
      const left = Math.max(0, KitchenManager.unpackNeed() - this._picked());
      Platform.showToast(left > 0 ? `再卖掉 ${left} 格才能装下` : '先点下面确认卖掉');
      return;
    }
    this._isOpen = false;
    this.visible = false;
    this._data = null;
    this._sell.clear();
    this._stopPops();
    this._scroller.disable();
    TutorialOverlay.unregister('result');
    TutorialOverlay.onBlankTap(null);
    TutorialManager.advanceIf(TutorialStep.WAIT_RESULT);
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }

  relayout(result?: ExtractResult): void {
    const data = result ?? this._data ?? RunManager.run?.extract;
    this._stopPops();
    this._root.removeChildren();
    this.hitArea = new PIXI.Rectangle(0, 0, Game.designWidth, Game.logicHeight);
    if (!data) return;
    this._data = data;
    if (data.needsPick || (KitchenManager.pendingHaul?.length ?? 0) > 0) {
      this._drawPick(data);
      return;
    }
    this._drawSummary(data);
  }

  private _drawSummary(data: ExtractResult): void {
    this._scroller.clear();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const celebrate = this._celebrate;
    this._celebrate = false;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x140E0A);
    dim.alpha = 0.58;
    dim.eventMode = 'static';
    dim.cursor = 'pointer';
    dim.on('pointertap', this._onBgTap);
    this._root.addChild(dim);

    const items = data.items;
    const n = items.length;
    const art = n <= 1 ? 236 : n <= 3 ? 168 : 132;
    const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n <= 4 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
    const gap = 16;
    const gridW = n ? cols * art + (cols - 1) * gap : art;
    const gridH = n ? rows * art + (rows - 1) * gap : art;

    const stack = new PIXI.Container();
    stack.eventMode = 'none';
    this._root.addChild(stack);
    let y = 0;

    const titleW = w - 40;
    const titleH = Math.round(titleW * 0.44);
    const banner = this._titleArt(data.kind, titleW, titleH);
    banner.position.set(-titleW / 2, y);
    stack.addChild(banner);
    y += titleH + 4;

    const burst = new PIXI.Sprite(gameTexture(BURST));
    const bindBurst = (): void => {
      if (burst.destroyed) return;
      burst.texture = gameTexture(BURST);
      const side = Math.max(gridW, gridH) * (n <= 1 ? 1.7 : 1.35);
      burst.width = side;
      burst.height = side;
    };
    whenTextureReady(BURST, bindBurst);
    bindBurst();
    burst.anchor.set(0.5);
    burst.position.set(0, y + gridH / 2);
    burst.blendMode = PIXI.BLEND_MODES.ADD;
    burst.alpha = 0.92;
    burst.eventMode = 'none';
    this._pops.push(burst);
    stack.addChild(burst);

    const icons = new PIXI.Container();
    icons.position.set(-gridW / 2, y);
    stack.addChild(icons);
    if (!n) {
      const empty = this._floatLabel('两手空空', 'common');
      empty.position.set((gridW - empty.width) / 2, (gridH - empty.height) / 2);
      icons.addChild(empty);
    } else {
      items.forEach((it, i) => {
        const icon = this._lootIcon(it, art);
        icon.position.set((i % cols) * (art + gap), Math.floor(i / cols) * (art + gap));
        icons.addChild(icon);
        if (celebrate) this._pop(icon, 0.08 + i * 0.06);
      });
    }
    y += gridH;

    const top = Game.safeTop + 20;
    const bottom = h - Math.max(16, Game.safeBottom + 16);
    stack.position.set(w / 2, top + Math.max(0, (bottom - top - y) / 2));

    if (n && celebrate) {
      this._playLootFloats(
        this._floatRows(items),
        w / 2,
        stack.y + titleH + 8 + gridH * 0.42,
      );
    }

    if (celebrate) {
      burst.alpha = 0;
      burst.scale.set(0.72);
      banner.alpha = 0;
      this._pop(banner, 0);
      TweenManager.to({ target: burst, props: { alpha: 0.92 }, duration: 0.36, ease: Ease.easeOutQuad });
      TweenManager.to({
        target: burst.scale,
        props: { x: 1, y: 1 },
        duration: 0.42,
        ease: Ease.easeOutQuad,
      });
    }
  }

  private _titleArt(kind: keyof typeof TITLE_ART, boxW: number, boxH: number): PIXI.Container {
    const root = new PIXI.Container();
    const path = TITLE_ART[kind];
    const sp = new PIXI.Sprite(gameTexture(path));
    const bind = (): void => {
      if (sp.destroyed) return;
      sp.texture = gameTexture(path);
      if (!isTextureReady(sp.texture)) return;
      const scale = boxW / Math.max(1, sp.texture.width);
      sp.width = boxW;
      sp.height = sp.texture.height * scale;
      sp.position.set(0, Math.max(0, (boxH - sp.height) / 2));
    };
    whenTextureReady(path, bind);
    bind();
    sp.eventMode = 'none';
    root.addChild(sp);
    if (!isTextureReady(sp.texture)) {
      const fallback = makeLabel(KIND_TEXT[kind], 48, 0xF6D56A, {
        fontFamily: TITLE_FONT,
        fontWeight: '700',
        stroke: 0x2A2018,
        strokeThickness: 7,
      });
      fallback.anchor.set(0.5);
      fallback.position.set(boxW / 2, boxH / 2);
      root.addChild(fallback);
    }
    root.hitArea = new PIXI.Rectangle(0, 0, boxW, boxH);
    root.eventMode = 'none';
    return root;
  }

  private _floatRows(items: ExtractedItem[]): { name: string; count: number; rarity: Rarity; rotten: boolean }[] {
    const map = new Map<string, { name: string; count: number; rarity: Rarity; rotten: boolean }>();
    for (const it of items) {
      const rotten = it.quality === 'rotten';
      const rarity = itemRarity(it.defId);
      const key = `${it.defId}|${rarity}|${rotten ? 1 : 0}`;
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { name: it.name, count: 1, rarity, rotten });
    }
    return [...map.values()];
  }

  private _floatLabel(text: string, rarity: Rarity, rotten = false): PIXI.Text {
    const fill = rotten ? ROTTEN_FLOAT : (RARITY_STYLE[rarity]?.float ?? RARITY_STYLE.common.float);
    return makeLabel(text, 36, fill, {
      fontFamily: FLOAT_FONT,
      fontWeight: '700',
      stroke: 0x2A2018,
      strokeThickness: 7,
      letterSpacing: 1,
    });
  }

  private _playLootFloats(
    rows: { name: string; count: number; rarity: Rarity; rotten: boolean }[],
    x: number,
    y: number,
  ): void {
    const layer = new PIXI.Container();
    layer.eventMode = 'none';
    this._root.addChild(layer);
    const step = 0.56;
    rows.forEach((row, i) => {
      const lab = this._floatLabel(`${row.name}+${row.count}`, row.rarity, row.rotten);
      lab.anchor.set(0.5);
      lab.position.set(x, y);
      lab.alpha = 0;
      lab.scale.set(0.7);
      layer.addChild(lab);
      this._pops.push(lab);
      const delay = 0.22 + i * step;
      TweenManager.to({
        target: lab,
        props: { alpha: 1 },
        duration: 0.1,
        delay,
        ease: Ease.easeOutQuad,
        onComplete: () => {
          if (lab.destroyed) return;
          TweenManager.to({
            target: lab,
            props: { alpha: 0 },
            duration: 0.3,
            delay: 0.4,
            ease: Ease.easeInQuad,
          });
        },
      });
      TweenManager.to({
        target: lab.scale,
        props: { x: 1, y: 1 },
        duration: 0.18,
        delay,
        ease: Ease.easeOutBack,
      });
      TweenManager.to({
        target: lab,
        props: { y: y - 100 },
        duration: 0.95,
        delay,
        ease: Ease.easeOutQuad,
      });
    });
  }

  private _lootIcon(it: ExtractedItem, size: number): PIXI.Container {
    const root = new PIXI.Container();
    const look = it.quality === 'rotten' ? 'rotten' : 'clean';
    const path = `subpkg_images/${it.defId}${look === 'rotten' ? '_rotten' : ''}.png`;
    const icon = new PIXI.Sprite(itemLookTexture(it.defId, look));
    const bindIcon = (): void => {
      if (icon.destroyed) return;
      icon.texture = itemLookTexture(it.defId, look);
      if (isTextureReady(icon.texture)) fitSpriteInBox(icon, size, size);
    };
    whenTextureReady(path, bindIcon);
    bindIcon();
    icon.anchor.set(0.5);
    icon.position.set(size / 2, size / 2);
    icon.eventMode = 'none';
    root.addChild(icon);
    root.eventMode = 'none';
    return root;
  }

  private _coinValue(amount: number, size: number): PIXI.Container {
    const row = new PIXI.Container();
    const coin = new PIXI.Sprite(gameTexture(HUD_ICON.coin));
    const icon = Math.round(size * 1.15);
    const bindCoin = (): void => {
      if (coin.destroyed) return;
      coin.texture = gameTexture(HUD_ICON.coin);
      if (isTextureReady(coin.texture)) fitSpriteInBox(coin, icon, icon);
      else {
        coin.width = icon;
        coin.height = icon;
      }
    };
    whenTextureReady(HUD_ICON.coin, bindCoin);
    bindCoin();
    coin.anchor.set(0, 0.5);
    coin.eventMode = 'none';
    row.addChild(coin);
    const n = makeLabel(String(Math.max(0, amount)), size, GOLD, {
      fontWeight: '700',
      stroke: 0xFFF6E8,
      strokeThickness: Math.max(3, Math.round(size * 0.16)),
    });
    n.anchor.set(0, 0.5);
    n.position.set(icon + 6, 0);
    row.addChild(n);
    coin.position.set(0, 0);
    return row;
  }

  private _pop(target: PIXI.Container, delay: number): void {
    this._pops.push(target);
    target.alpha = 0;
    target.scale.set(0.72);
    TweenManager.to({
      target,
      props: { alpha: 1 },
      duration: 0.22,
      delay,
      ease: Ease.easeOutQuad,
    });
    TweenManager.to({
      target: target.scale,
      props: { x: 1, y: 1 },
      duration: 0.28,
      delay,
      ease: Ease.easeOutBack,
    });
  }

  private _stopPops(): void {
    for (const node of this._pops) {
      TweenManager.cancelTarget(node);
      TweenManager.cancelTarget(node.scale);
    }
    this._pops = [];
  }

  private _schedulePickRelayout = (): void => {
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

  private _drawPick(data: ExtractResult): void {
    const w = Game.designWidth;
    const h = Game.logicHeight;
    const save = KitchenManager.save;
    const haul = KitchenManager.pendingHaul ?? data.items;
    const preview = previewFridgeAfterHaul(save, haul);
    const valid = new Set(preview.map((it) => it.uid));
    for (const uid of [...this._sell]) {
      if (!valid.has(uid)) this._sell.delete(uid);
    }
    watchTextures([...PANEL_SHELL.fridge, ...preview.map(fridgeItemPath), HUD_ICON.coin], this._schedulePickRelayout);

    const cap = fridgeCap(save);
    const owned = new Set(save.fridge.map((it) => it.uid));
    const need = Math.max(0, preview.length - cap);
    const picked = this._sell.size;
    const remain = preview.length - picked;
    const ready = remain <= cap;
    const gold = preview.reduce((sum, it) => (
      this._sell.has(it.uid) ? sum + fridgeItemPrice(it, save) : sum
    ), 0);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x000000);
    dim.alpha = 0.46;
    dim.eventMode = 'static';
    this._root.addChild(dim);

    const box = this._fridgeBox(w, h);
    const shell = new PIXI.Container();
    shell.position.set(box.x, box.y);
    shell.eventMode = 'static';
    shell.hitArea = new PIXI.Rectangle(0, 0, box.w, box.h);
    this._root.addChild(shell);
    this._paintFridgeBg(shell, box.w, box.h);

    const midX = box.w / 2;
    const cx = box.w * CAVITY.x;
    const cy = box.h * CAVITY.y;
    const cw = box.w * CAVITY.w;
    const ch = box.h * CAVITY.h;
    const hy = box.h * HEADER.y;
    const hh = box.h * HEADER.h;

    const title = new PIXI.Text('腾  格  子', {
      fontFamily: TITLE_FONT,
      fontSize: 40,
      fill: INK,
      fontWeight: '700',
      letterSpacing: 6,
      stroke: '#F6EDE0',
      strokeThickness: 5,
      dropShadow: true,
      dropShadowColor: '#C4A574',
      dropShadowAlpha: 0.55,
      dropShadowDistance: 2,
      dropShadowBlur: 0,
      dropShadowAngle: Math.PI / 2,
    });
    title.anchor.set(0.5);
    title.position.set(midX, hy + hh * 0.28);
    title.eventMode = 'none';
    const count = new PIXI.Text(`${remain} / ${cap}`, {
      fontFamily: TITLE_FONT,
      fontSize: 26,
      fill: ready ? WALNUT : TERRACOTTA,
      fontWeight: '700',
      letterSpacing: 1,
      stroke: '#F6EDE0',
      strokeThickness: 4,
    });
    count.anchor.set(0.5);
    count.position.set(midX, title.y + 34);
    count.eventMode = 'none';
    const hint = makeLabel(
      ready ? '卖掉这些就能装下，还可以再改。' : `先和冰箱叠好。还要腾出 ${need - picked} 格，点格子卖掉。`,
      16,
      ready ? WALNUT : TERRACOTTA,
      { fontWeight: '700', wordWrap: true, breakWords: true, wordWrapWidth: cw, align: 'center' },
    );
    hint.anchor.set(0.5, 1);
    hint.position.set(midX, hy + hh - 8);
    shell.addChild(title, count, hint);

    const cols = 6;
    const pad = 8;
    const cell = Math.max(48, Math.floor((cw - pad * 2) / cols));
    const gridW = cols * cell;
    const gridX = cx + (cw - gridW) / 2;
    const contentH = Math.ceil(preview.length / cols) * cell;
    const viewport = new PIXI.Container();
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRoundedRect(cx, cy, cw, ch, 18);
    mask.endFill();
    mask.eventMode = 'none';
    viewport.mask = mask;
    shell.addChild(mask, viewport);

    const grid = new PIXI.Container();
    viewport.addChild(grid);
    preview.forEach((it, i) => {
      const x = gridX + (i % cols) * cell;
      const y = cy + pad + Math.floor(i / cols) * cell;
      grid.addChild(this._pickSlot(x, y, cell - 8, it, i >= cap, !owned.has(it.uid)));
    });
    this._scroller.attach({
      content: grid,
      maxScroll: Math.max(0, contentH - (ch - pad)),
      baseY: 0,
      hit: { x: box.x + cx, y: box.y + cy, w: cw, h: ch },
    });

    const fy = box.h * FOOTER.y;
    const fh = box.h * FOOTER.h;
    const btnH = 46;
    const btnY = fy + Math.max(6, (fh - btnH) * 0.28) + 20;
    if (picked > 0 && gold > 0) {
      const status = this._coinValue(gold, 18);
      status.pivot.set(status.width / 2, 0);
      status.position.set(midX, btnY - 26);
      shell.addChild(status);
    } else if (!ready) {
      const status = makeLabel(`再卖 ${need - picked} 格`, 18, TERRACOTTA, { fontWeight: '700' });
      status.anchor.set(0.5, 0);
      status.position.set(midX, btnY - 26);
      shell.addChild(status);
    }
    const btnW = Math.min(240, cw * 0.62);
    const ok = makeSlicedButton({
      label: ready ? '卖掉选中的' : `再卖 ${need - picked} 格`,
      width: btnW,
      height: btnH,
      path: BTN,
      silent: true,
      onReady: () => {
        if (this._isOpen) this.relayout();
      },
    });
    ok.alpha = ready ? 1 : 0.55;
    ok.position.set(midX - btnW / 2, btnY);
    ok.on('pointertap', () => this._confirm());
    bindUiClick(ok);
    shell.addChild(ok);
  }

  private _fridgeBox(screenW: number, screenH: number): { x: number; y: number; w: number; h: number } {
    const tex = gameTexture(FRIDGE_BG);
    const marginX = 18;
    const top = Game.safeTop + 4;
    const bottom = 10;
    const maxW = screenW - marginX * 2;
    const maxH = screenH - top - bottom;
    const tw = isTextureReady(tex) ? tex.width : 800;
    const th = isTextureReady(tex) ? tex.height : 1280;
    const scale = Math.min(maxW / tw, maxH / th);
    return { x: (screenW - tw * scale) / 2, y: top + (maxH - th * scale) / 2, w: tw * scale, h: th * scale };
  }

  private _paintFridgeBg(host: PIXI.Container, width: number, height: number): void {
    const tex = gameTexture(FRIDGE_BG);
    if (isTextureReady(tex)) {
      const sp = new PIXI.Sprite(tex);
      sp.width = width;
      sp.height = height;
      sp.eventMode = 'none';
      host.addChild(sp);
      return;
    }
    const g = new PIXI.Graphics();
    g.beginFill(0xF3E6D0);
    g.drawRoundedRect(0, 0, width, height, 36);
    g.endFill();
    g.beginFill(0xB8D4C8);
    g.drawRoundedRect(width * CAVITY.x, height * CAVITY.y, width * CAVITY.w, height * CAVITY.h, 16);
    g.endFill();
    host.addChild(g);
  }

  private _pickSlot(x: number, y: number, size: number, it: FridgeItem, overflow: boolean, isNew: boolean): PIXI.Container {
    const on = this._sell.has(it.uid);
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(on ? 0xF3D2B4 : PAPER, 0.96);
    bg.drawRoundedRect(x, y, size, size, 12);
    bg.endFill();
    drawRarityFrame(bg, x + 2, y + 2, size - 4, size - 4, fridgeSlotRarity(it), { radius: 12 });
    if (overflow && !on) {
      bg.lineStyle(3, TERRACOTTA, 0.92);
      bg.drawRoundedRect(x + 1, y + 1, size - 2, size - 2, 12);
    }
    root.addChild(bg);

    if (fridgeKind(it) === 'dish') {
      const tex = dishTexture(it.defId);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 12, size - 12);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.42;
        root.addChild(icon);
      }
    } else {
      const look = it.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
      const tex = itemLookTexture(it.defId, look);
      if (isTextureReady(tex)) {
        const icon = new PIXI.Sprite(tex);
        fitSpriteInBox(icon, size - 12, size - 12);
        icon.anchor.set(0.5);
        icon.position.set(x + size / 2, y + size / 2);
        icon.eventMode = 'none';
        if (on) icon.alpha = 0.42;
        root.addChild(icon);
      }
    }

    const qty = fridgeItemQty(it);
    if (qty > 1 && !on) {
      const n = makeQtyMark(qty, 17);
      n.anchor.set(1, 1);
      n.position.set(x + size - 4, y + size - 2);
      root.addChild(n);
    }
    if (overflow && !on) {
      const mark = makeCornerMark('超', 15, TERRACOTTA);
      mark.anchor.set(0, 0);
      mark.position.set(x + 4, y + 2);
      root.addChild(mark);
    } else if (isNew && !on) {
      const mark = makeCornerMark('新', 15, WALNUT);
      mark.anchor.set(0, 0);
      mark.position.set(x + 4, y + 2);
      root.addChild(mark);
    }
    if (on) {
      const stamp = makeLabel('卖掉', 18, TERRACOTTA, { fontWeight: '700' });
      stamp.anchor.set(0.5);
      stamp.position.set(x + size / 2, y + size / 2);
      root.addChild(stamp);
    }

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(x, y, size, size);
    root.on('pointertap', () => {
      if (this._scroller.moved) return;
      const now = Date.now();
      if (now - this._pickTapAt < 280) return;
      this._pickTapAt = now;
      AudioManager.play('ui_click');
      if (this._sell.has(it.uid)) this._sell.delete(it.uid);
      else this._sell.add(it.uid);
      this.relayout();
    });
    return root;
  }

  private _picked(): number {
    return this._sell.size;
  }

  private _confirm(): void {
    const need = KitchenManager.unpackNeed();
    if (this._picked() < need) {
      AudioManager.play('ui_deny');
      Platform.showToast(`再卖掉 ${need - this._picked()} 格才能装下`);
      return;
    }
    const { error, gained, kept } = KitchenManager.commitUnpack([...this._sell]);
    if (error) {
      AudioManager.play('ui_deny');
      Platform.showToast(error);
      return;
    }
    if (gained > 0) AudioManager.play('coin_gain');
    this._data = this._data ? { ...this._data, needsPick: false } : null;
    Platform.showToast(gained > 0 ? `卖掉了，${kept} 格进冰箱，收入 ${gained}` : `${kept} 格进了冰箱`, 'success');
    this._isOpen = false;
    this.visible = false;
    this._sell.clear();
    this._stopPops();
    this._scroller.disable();
    RunManager.clear();
    SceneManager.switchTo('kitchen');
  }
}
