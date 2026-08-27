import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { EventBus } from '@/core/EventBus';
import { SceneManager, type Scene } from '@/core/SceneManager';
import { EV } from '@/config/events';
import { KitchenManager } from '@/managers/KitchenManager';
import { RecipeBookPanel } from '@/gameobjects/ui/RecipeBookPanel';
import { DexPanel } from '@/gameobjects/ui/DexPanel';
import { FridgePanel } from '@/gameobjects/ui/FridgePanel';
import { CookPanel } from '@/gameobjects/ui/CookPanel';
import { UpgradePanel } from '@/gameobjects/ui/UpgradePanel';
import { ensureRecipeUnlockPanel } from '@/gameobjects/ui/RecipeUnlockPanel';
import { Platform } from '@/core/PlatformService';
import {
  STAMINA_MAX,
  FURN_IDS,
  FURN_MAX_LEVEL,
  HOUSE_FALLBACK_SIZE,
  HOUSE_MAX_LEVEL,
  HOUSE_SCREENS,
  cloneLayout,
  dumpKitchenLayout,
  furnLabel,
  furnLevel,
  furnUpgradeState,
  houseDoor,
  houseFurnCap,
  houseLabel,
  houseLevel,
  houseRoomCandidates,
  houseUpgradeMark,
  houseUpgradeState,
  minHouseForFurn,
  cookXpView,
  furnCookNeed,
  cookLevel,
  bagDryCols,
  bagRows,
  fridgeOwnCap,
  foamWetCols,
  foamWetRows,
  tableUnlockNext,
  layoutFor,
  saveGmLayout,
  clampHouseLevel,
  type FurnId,
  type FurnLayout,
  type KitchenSave,
} from '@/sim';
import { AudioManager } from '@/core/AudioManager';
import { HUD_ICON, bindUiClick, fillRect, makeButton, makeCookSkillPill, makeLabel, makeMuteButton, makeStatPill } from '@/utils/ui';
import { applyFit, fitSpriteInBox, fitWidthBottom, gameTexture, isTextureFailed, isTextureReady, mapNorm, whenTextureReady } from '@/utils/assets';
import { OutingCurtain } from '@/gameobjects/ui/OutingCurtain';
import { destinationBootPaths } from '@/utils/outingAssets';

type HotspotId = 'door' | 'basket' | 'fridge' | 'foam' | 'board';
type UpgradePick = FurnId | 'house';

const DRAG_SLOP = 14;
const HOUSE_UPGRADE_SHIFT_X = 50;

export class KitchenScene implements Scene {
  readonly name = 'kitchen';
  readonly container = new PIXI.Container();
  private _world = new PIXI.Container();
  private _viewClip = new PIXI.Graphics();
  private _ui = new PIXI.Container();
  private _fridge = new FridgePanel();
  private _cook = new CookPanel();
  private _recipeBook = new RecipeBookPanel();
  private _dex = new DexPanel();
  private _upgrade = new UpgradePanel();
  private _onChange = () => {
    const fx = KitchenManager.consumeCookFx();
    if (fx) {
      this._xpPop = {
        text: fx.levels > 0 ? `厨艺升到 ${KitchenManager.save.level} 级` : `+${fx.xp} 经验`,
        until: Date.now() + 1500,
      };
      globalThis.clearTimeout?.(this._xpPopTimer);
      this._xpPopTimer = globalThis.setTimeout(() => {
        this._xpPop = null;
        if (this.container.parent) this.relayout();
      }, 1500) as unknown as number;
    }
    this.relayout();
  };
  private _worldSize = { w: 750, h: 1334 };
  private _pan = { x: 0, y: 0 };
  private _drag: { x: number; y: number; sx: number; sy: number; px: number; py: number } | null = null;
  private _dragMoved = false;
  private _gm = false;
  private _layout: FurnLayout[] = cloneLayout();
  private _fit = { x: 0, y: 0, scale: 1, srcW: 1600, srcH: 900 };
  private _itemDrag: { id: FurnId; nx0: number; ny0: number } | null = null;
  private _gmPick: FurnId | null = null;
  private _gmView: Record<FurnId, number> = { fridge: 0, table: 0, basket: 0, foam: 0 };
  private _gmHouse = 0;
  private _furnRoots = new Map<FurnId, PIXI.Container>();
  private _upgradePick: UpgradePick | null = null;
  private _xpPop: { text: string; until: number } | null = null;
  private _xpPopTimer = 0;
  private _onDown = (e: PIXI.FederatedPointerEvent) => {
    const p = this.container.toLocal(e.global);
    this._beginDrag(p.x, p.y);
  };
  private _onMove = (e: PIXI.FederatedPointerEvent) => {
    const p = this.container.toLocal(e.global);
    this._applyDragDelta(p.x - (this._drag?.x ?? p.x), p.y - (this._drag?.y ?? p.y));
  };
  private _onUp = () => this._endDrag();
  private _onWxStart = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }) => {
    if (this._fridge.visible || this._cook.visible || this._recipeBook.visible || this._upgrade.visible || this._dex.visible) return;
    const p = this._wxPoint(res);
    if (p) this._beginDrag(p.x, p.y);
  };
  private _onWxMove = (res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }) => {
    if (this._fridge.visible || this._cook.visible || this._recipeBook.visible || this._upgrade.visible || this._dex.visible) return;
    const p = this._wxPoint(res);
    if (!p || !this._drag) return;
    this._applyDragDelta(p.x - this._drag.x, p.y - this._drag.y);
  };

  constructor() {
    this.container.addChild(this._world);
    this.container.addChild(this._viewClip);
    this.container.addChild(this._ui);
    this._viewClip.eventMode = 'none';
    this._world.mask = this._viewClip;
    this._fridge.onChange = () => this.relayout();
    ensureRecipeUnlockPanel();
    this.container.eventMode = 'static';
    this._world.eventMode = 'static';
    this._ui.eventMode = 'passive';
  }

  onEnter(): void {
    EventBus.on(EV.kitchenChanged, this._onChange);
    this._pan.x = 0;
    this._pan.y = 0;
    this.container.on('pointerdown', this._onDown);
    this.container.on('pointerup', this._onUp);
    this.container.on('pointerupoutside', this._onUp);
    this.container.on('pointercancel', this._onUp);
    if (Platform.api?.onTouchMove) {
      try { Platform.api.onTouchStart?.(this._onWxStart); } catch (_) {}
      try { Platform.api.onTouchMove?.(this._onWxMove); } catch (_) {}
      try { Platform.api.onTouchEnd?.(this._onUp); } catch (_) {}
      try { Platform.api.onTouchCancel?.(this._onUp); } catch (_) {}
    } else {
      this.container.on('globalpointermove', this._onMove);
    }
    this.relayout();
    AudioManager.playBgm('kitchen');
    ensureRecipeUnlockPanel().present();
  }

  onExit(): void {
    EventBus.off(EV.kitchenChanged, this._onChange);
    this.container.off('pointerdown', this._onDown);
    this.container.off('globalpointermove', this._onMove);
    this.container.off('pointerup', this._onUp);
    this.container.off('pointerupoutside', this._onUp);
    this.container.off('pointercancel', this._onUp);
    try { Platform.api?.offTouchStart?.(this._onWxStart); } catch (_) {}
    try { Platform.api?.offTouchMove?.(this._onWxMove); } catch (_) {}
    try { Platform.api?.offTouchEnd?.(this._onUp); } catch (_) {}
    try { Platform.api?.offTouchCancel?.(this._onUp); } catch (_) {}
    this._endDrag();
    this._fridge.close(true);
    this._cook.close(true);
    this._recipeBook.close(true);
    this._dex.close(true);
    this._upgrade.close(true);
    this._upgradePick = null;
    this._xpPop = null;
    globalThis.clearTimeout?.(this._xpPopTimer);
  }

  relayout(): void {
    this._fridge.prune();
    this._world.removeChildren();
    this._ui.removeChildren();
    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.container.hitArea = new PIXI.Rectangle(0, 0, w, h);
    this._viewClip.clear();
    this._viewClip.beginFill(0xffffff);
    this._viewClip.drawRect(0, 0, w, h);
    this._viewClip.endFill();
    this._world.mask = this._viewClip;
    const save = KitchenManager.save;
    const house = this._viewHouse();
    const roomPath = this._roomPath(house);
    const tex = gameTexture(roomPath);
    whenTextureReady(roomPath, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
    const fb = HOUSE_FALLBACK_SIZE[house];
    const srcW = isTextureReady(tex) ? tex.width : fb.w;
    const srcH = isTextureReady(tex) ? tex.height : fb.h;
    const scale = Math.max(h / srcH, (w * HOUSE_SCREENS[house]) / srcW);
    const worldW = Math.round(srcW * scale);
    const worldH = Math.round(srcH * scale);
    this._worldSize = { w: worldW, h: worldH };
    this._world.hitArea = new PIXI.Rectangle(0, 0, worldW, worldH);
    const fit = { x: 0, y: h - worldH, scale, srcW, srcH };
    this._fit = fit;
    this._furnRoots.clear();

    const fallback = new PIXI.Graphics();
    fillRect(fallback, 0, 0, worldW, worldH, 0xF3E2C6);
    fillRect(fallback, 0, worldH * 0.62, worldW, worldH * 0.38, 0xD8C3A5);
    fallback.eventMode = 'none';
    this._world.addChild(fallback);

    if (isTextureReady(tex)) {
      const scene = new PIXI.Sprite(tex);
      applyFit(scene, fit);
      scene.eventMode = 'none';
      this._world.addChild(scene);
    } else {
      this._paintStandIn(fit);
    }

    for (const id of FURN_IDS) {
      this._world.addChild(this._furniture(this._furnAt(id), save, fit));
    }

    if (!this._gm) {
      for (const spot of this._hotspotsFromLayout()) {
        const rect = spot.id === 'board'
          ? this._cookHitRect()
          : mapNorm(fit, spot.nx, spot.ny, spot.nw, spot.nh);
        this._world.addChild(this._hotspot(spot.id, spot.label, rect));
      }
      for (const id of FURN_IDS) {
        const badge = this._upgradeBadge(id, this._furnSpriteRect(id));
        if (badge) this._world.addChild(badge);
      }
      const houseBadge = this._houseUpgradeBadge();
      if (houseBadge) this._world.addChild(houseBadge);
    }

    this._applyPan();
    this._drawHud(w);
    if (!this._gm && this._upgradePick) this._drawUpgradeCard(this._upgradePick);
  }

  private _wxPoint(res: { touches?: Array<{ clientX?: number; clientY?: number; x?: number; y?: number }> }): { x: number; y: number } | null {
    const t = res.touches?.[0];
    if (!t) return null;
    const scale = Game.contentScale || 1;
    return {
      x: (t.clientX ?? t.x ?? 0) / scale,
      y: (t.clientY ?? t.y ?? 0) / scale,
    };
  }

  private _beginDrag(x: number, y: number): void {
    this._dragMoved = false;
    this._drag = { x, y, sx: x, sy: y, px: this._pan.x, py: this._pan.y };
  }

  private _applyDragDelta(dx: number, dy: number): void {
    if (!this._drag) return;
    if (Math.abs(this._drag.x + dx - this._drag.sx) > DRAG_SLOP
      || Math.abs(this._drag.y + dy - this._drag.sy) > DRAG_SLOP) {
      this._dragMoved = true;
    }
    if (!this._dragMoved) return;
    this._drag.x += dx;
    this._drag.y += dy;
    if (this._itemDrag) {
      const item = this._furnAt(this._itemDrag.id);
      if (!item) return;
      item.nx = Math.max(-item.nw * 0.35, Math.min(1.05, this._itemDrag.nx0 + (this._drag.x - this._drag.sx) / this._worldSize.w));
      item.ny = Math.max(-item.nh * 0.2, Math.min(0.96, this._itemDrag.ny0 + (this._drag.y - this._drag.sy) / this._worldSize.h));
      this._placeFurnRoot(item);
    }
  }

  private _endDrag(): void {
    if (this._itemDrag) saveGmLayout(this._layout);
    this._itemDrag = null;
    this._drag = null;
  }

  private _placeFurnRoot(item: FurnLayout): void {
    const root = this._furnRoots.get(item.id);
    if (!root) return;
    const rect = mapNorm(this._fit, item.nx, item.ny, item.nw, item.nh);
    root.position.set(rect.x, rect.y);
  }

  private _applyPan(): void {
    const viewW = Game.designWidth;
    const worldW = this._fit.srcW * this._fit.scale;
    const minX = Math.min(0, viewW - worldW);
    this._pan.x = Math.max(minX, Math.min(0, this._pan.x));
    this._pan.y = 0;
    this._world.position.set(this._pan.x, 0);
  }

  private _furniture(
    furn: FurnLayout,
    save: KitchenSave,
    fit: ReturnType<typeof fitWidthBottom>,
  ): PIXI.Container {
    const root = new PIXI.Container();
    const rect = mapNorm(fit, furn.nx, furn.ny, furn.nw, furn.nh);
    root.position.set(rect.x, rect.y);
    const path = this._furnPath(furn.id, this._viewLevel(furn.id));
    const tex = gameTexture(path);
    whenTextureReady(path, () => {
      if (this.container.parent && !this._itemDrag) this.relayout();
    });
    if (isTextureReady(tex)) {
      const sprite = new PIXI.Sprite(tex);
      fitSpriteInBox(sprite, rect.w, rect.h);
      sprite.anchor.set(0.5, furn.hang ? 0 : 1);
      sprite.position.set(rect.w / 2, furn.hang ? 0 : rect.h);
      sprite.eventMode = 'none';
      root.addChild(sprite);
    }
    const tag = makeLabel(furnLabel(furn.id, this._viewLevel(furn.id)), 18, 0xFFF8F0);
    const tagBg = new PIXI.Graphics();
    fillRect(tagBg, 4, 4, Math.min(rect.w - 8, tag.width + 16), 28, 0x2A2018, 8);
    tagBg.alpha = 0.7;
    tag.position.set(12, 8);
    if (this._gm) {
      root.addChild(tagBg);
      root.addChild(tag);
    }
    if (this._gm) {
      const frame = new PIXI.Graphics();
      frame.lineStyle(2, this._gmPick === furn.id ? 0xE0A100 : 0xFFFFFF, 0.7);
      frame.drawRoundedRect(0, 0, rect.w, rect.h, 10);
      frame.eventMode = 'none';
      root.addChild(frame);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new PIXI.Rectangle(0, 0, rect.w, rect.h);
      root.on('pointerdown', (e) => {
        e.stopPropagation();
        this._gmPick = furn.id;
        this._itemDrag = { id: furn.id, nx0: furn.nx, ny0: furn.ny };
        const p = this.container.toLocal(e.global);
        this._beginDrag(p.x, p.y);
      });
    } else {
      root.eventMode = 'none';
    }
    this._furnRoots.set(furn.id, root);
    return root;
  }

  private _viewLevel(id: FurnId): number {
    if (this._gm) return this._gmView[id] ?? furnLevel(KitchenManager.save, id);
    return furnLevel(KitchenManager.save, id);
  }

  private _viewHouse(): number {
    if (this._gm) return clampHouseLevel(this._gmHouse);
    return houseLevel(KitchenManager.save);
  }

  private _roomPath(house: number): string {
    for (const path of houseRoomCandidates(house)) {
      const tex = gameTexture(path);
      if (isTextureReady(tex)) return path;
      if (!isTextureFailed(path)) return path;
    }
    return houseRoomCandidates(house)[0];
  }

  private _furnAt(id: FurnId): FurnLayout {
    return layoutFor(this._layout, id, this._viewLevel(id), this._viewHouse());
  }

  /** 贴图在布局框里的实际位置：落地钉底、挂件钉顶，不含框里的空档。 */
  private _furnSpriteRect(id: FurnId): { x: number; y: number; w: number; h: number } {
    const furn = this._furnAt(id);
    const box = mapNorm(this._fit, furn.nx, furn.ny, furn.nw, furn.nh);
    const tex = gameTexture(this._furnPath(id, this._viewLevel(id)));
    const tw = isTextureReady(tex) ? tex.width : 256;
    const th = isTextureReady(tex) ? tex.height : 256;
    const scale = Math.min(box.w / Math.max(1, tw), box.h / Math.max(1, th));
    const w = tw * scale;
    const h = th * scale;
    return {
      x: box.x + (box.w - w) / 2,
      y: furn.hang ? box.y : box.y + box.h - h,
      w,
      h,
    };
  }

  private _furnPath(id: FurnId, level: number): string {
    for (let lv = level; lv >= 0; lv--) {
      const path = `subpkg_kitchen/kitchen_${id}_${lv}.png`;
      const tex = gameTexture(path);
      if (isTextureReady(tex)) return path;
      if (!isTextureFailed(path)) return path;
    }
    return `subpkg_kitchen/kitchen_${id}_0.png`;
  }

  private _paintStandIn(fit: ReturnType<typeof fitWidthBottom>): void {
    const g = new PIXI.Graphics();
    const box = (nx: number, ny: number, nw: number, nh: number, color: number) => {
      const r = mapNorm(fit, nx, ny, nw, nh);
      fillRect(g, r.x, r.y, r.w, r.h, color, 12);
    };
    box(0.02, 0.12, 0.26, 0.32, 0x8B5A2B);
    box(0.26, 0.16, 0.16, 0.18, 0xC4A574);
    box(0.36, 0.12, 0.32, 0.38, 0xE8D9C4);
    box(0.30, 0.48, 0.22, 0.12, 0xF4EFE6);
    box(0.68, 0.22, 0.30, 0.32, 0x4A433C);
    box(0.38, 0.60, 0.48, 0.22, 0xC4A574);
    box(0.02, 0.64, 0.36, 0.28, 0x8B5A2B);
    this._world.addChild(g);
  }

  private _drawHud(w: number): void {
    const save = KitchenManager.save;
    const top = Number.isFinite(Game.safeTop) ? Game.safeTop : 96;
    const y = top + 6;
    const redraw = () => {
      if (this.container.parent) this.relayout();
    };

    const money = makeStatPill({
      icon: 'subpkg_images/hud_coin.png',
      text: `${save.money}`,
      width: 176,
      onIconReady: redraw,
    });
    money.position.set(16, y);
    this._ui.addChild(money);

    const sta = makeStatPill({
      icon: 'subpkg_images/hud_stamina.png',
      text: `${save.stamina}/${STAMINA_MAX}`,
      width: 210,
      fill: save.stamina / STAMINA_MAX,
      fillColor: 0x6BA368,
      onIconReady: redraw,
    });
    sta.position.set(204, y);
    this._ui.addChild(sta);

    const skill = cookXpView(save);
    const skillW = 188;
    const skillPill = makeCookSkillPill({
      level: skill.level,
      text: skill.text,
      width: skillW,
      fill: skill.fill,
    });
    skillPill.position.set(w - 16 - skillW, y);
    this._ui.addChild(skillPill);
    if (this._xpPop && Date.now() < this._xpPop.until) {
      const pop = makeLabel(this._xpPop.text, 22, 0xF2C14D, { fontWeight: '700' });
      pop.anchor.set(1, 0);
      pop.position.set(w - 16, y + 50);
      this._ui.addChild(pop);
    }

    this._drawDexHud(top, redraw);
    const mute = makeMuteButton(48);
    mute.position.set(16, top + 330);
    const stopMute = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    mute.on('pointerdown', stopMute);
    this._ui.addChild(mute);
    if (!KitchenManager.canGoMarket()) {
      const ad = makeButton('看广告 +1 体力', 220, 48, 0x4A6B7A);
      ad.position.set(16, top + 72);
      ad.on('pointertap', () => KitchenManager.watchAdStamina());
      this._ui.addChild(ad);
    }

    if (this._gm) {
      const hint = makeLabel('GM：拖家具 · 屋+/屋-换房子 · 导出后发给我固化', 18, 0xF4EFE6);
      const hintBg = new PIXI.Graphics();
      fillRect(hintBg, 16, Game.logicHeight - 56, w - 32, 40, 0x2A2018, 12);
      hintBg.alpha = 0.55;
      hint.position.set(32, Game.logicHeight - 48);
      this._ui.addChild(hintBg);
      this._ui.addChild(hint);
    }
    this._drawGmBar(w);
  }

  private _drawDexHud(top: number, redraw: () => void): void {
    const path = HUD_ICON.dex;
    whenTextureReady(path, redraw);
    const size = 86;
    const root = new PIXI.Container();
    const tex = gameTexture(path);
    if (isTextureReady(tex)) {
      const spr = new PIXI.Sprite(tex);
      fitSpriteInBox(spr, size, size);
      spr.anchor.set(0.5);
      spr.position.set(size / 2, size / 2);
      spr.eventMode = 'none';
      root.addChild(spr);
    } else {
      const g = new PIXI.Graphics();
      fillRect(g, 4, 4, size - 8, size - 8, 0xC46A3A, 18);
      root.addChild(g);
    }
    const chip = new PIXI.Graphics();
    fillRect(chip, 8, size - 2, size - 16, 26, 0xFFF8F0, 12);
    chip.alpha = 0.92;
    const label = makeLabel('图鉴', 18, 0x2A2018, { fontWeight: '700' });
    label.anchor.set(0.5, 0);
    label.position.set(size / 2, size);
    root.addChild(chip, label);
    root.position.set(10, top + 208);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, size, size + 28);
    const stop = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    root.on('pointerdown', stop);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this._dex.open();
    });
    this._ui.addChild(root);
  }

  private _drawGmBar(w: number): void {
    const y = Game.logicHeight - 118;
    const stop = (e: PIXI.FederatedPointerEvent) => e.stopPropagation();
    const gm = makeButton(this._gm ? 'GM开' : 'GM关', 100, 48, this._gm ? 0xC46A3A : 0x4A433C);
    gm.position.set(16, y);
    gm.on('pointerdown', stop);
    gm.on('pointertap', () => {
      this._gm = !this._gm;
      if (this._gm) {
        for (const id of FURN_IDS) this._gmView[id] = furnLevel(KitchenManager.save, id);
        this._gmHouse = houseLevel(KitchenManager.save);
      }
      this.relayout();
    });
    this._ui.addChild(gm);

    if (!this._gm) return;
    const dump = makeButton('导出布局', 140, 48, 0x5C6B4A);
    dump.position.set(128, y);
    dump.on('pointerdown', stop);
    dump.on('pointertap', () => this._exportLayout());
    this._ui.addChild(dump);

    const reset = makeButton('重置', 90, 48, 0x4A433C);
    reset.position.set(280, y);
    reset.on('pointerdown', stop);
    reset.on('pointertap', () => {
      this._layout = cloneLayout();
      saveGmLayout(this._layout);
      this.relayout();
    });
    this._ui.addChild(reset);

    const smaller = makeButton('小', 64, 48, 0x4A6B7A);
    smaller.position.set(378, y);
    smaller.on('pointerdown', stop);
    smaller.on('pointertap', () => this._scalePick(0.9));
    this._ui.addChild(smaller);

    const bigger = makeButton('大', 64, 48, 0x4A6B7A);
    bigger.position.set(448, y);
    bigger.on('pointerdown', stop);
    bigger.on('pointertap', () => this._scalePick(1.1));
    this._ui.addChild(bigger);

    const down = makeButton('级-', 64, 48, 0x6B5A3A);
    down.position.set(518, y);
    down.on('pointerdown', stop);
    down.on('pointertap', () => this._nudgeGmLevel(-1));
    this._ui.addChild(down);

    const up = makeButton('级+', 64, 48, 0x6B5A3A);
    up.position.set(588, y);
    up.on('pointerdown', stop);
    up.on('pointertap', () => this._nudgeGmLevel(1));
    this._ui.addChild(up);

    const houseDown = makeButton('屋-', 64, 44, 0x8B5A2B);
    houseDown.position.set(16, y - 52);
    houseDown.on('pointerdown', stop);
    houseDown.on('pointertap', () => this._nudgeGmHouse(-1));
    this._ui.addChild(houseDown);

    const houseUp = makeButton('屋+', 64, 44, 0x8B5A2B);
    houseUp.position.set(86, y - 52);
    houseUp.on('pointerdown', stop);
    houseUp.on('pointertap', () => this._nudgeGmHouse(1));
    this._ui.addChild(houseUp);

    const houseName = makeLabel(houseLabel(this._viewHouse()), 18, 0xF4EFE6);
    houseName.position.set(160, y - 42);
    this._ui.addChild(houseName);

    const artDown = makeButton('艺-', 64, 44, 0x6B3A3A);
    artDown.position.set(280, y - 52);
    artDown.on('pointerdown', stop);
    artDown.on('pointertap', () => KitchenManager.gmNudgeCookLevel(-1));
    this._ui.addChild(artDown);

    const artUp = makeButton('艺+', 64, 44, 0x6B3A3A);
    artUp.position.set(350, y - 52);
    artUp.on('pointerdown', stop);
    artUp.on('pointertap', () => KitchenManager.gmNudgeCookLevel(1));
    this._ui.addChild(artUp);

    const xpUp = makeButton('经验+', 80, 44, 0x6B3A3A);
    xpUp.position.set(420, y - 52);
    xpUp.on('pointerdown', stop);
    xpUp.on('pointertap', () => KitchenManager.gmAddCookXp(50));
    this._ui.addChild(xpUp);

    const staUp = makeButton('体+', 64, 44, 0x3A6B5A);
    staUp.position.set(508, y - 52);
    staUp.on('pointerdown', stop);
    staUp.on('pointertap', () => KitchenManager.gmAddStamina(5));
    this._ui.addChild(staUp);

    const goldUp = makeButton('金+', 64, 44, 0x8B6A20);
    goldUp.position.set(578, y - 52);
    goldUp.on('pointerdown', stop);
    goldUp.on('pointertap', () => KitchenManager.gmAddMoney(100));
    this._ui.addChild(goldUp);

    const artName = makeLabel(`厨艺 ${KitchenManager.save.level}`, 18, 0xF4EFE6);
    artName.position.set(510, y - 28);
    this._ui.addChild(artName);

    const pick = this._gmPick;
    const lv = pick ? this._viewLevel(pick) : 0;
    const name = makeLabel(
      pick ? `${furnLabel(pick, lv)} ${lv + 1}级` : '点一件再拖',
      18,
      0xE0A100,
    );
    name.position.set(16, y - 28);
    this._ui.addChild(name);
  }

  private _nudgeGmHouse(delta: number): void {
    this._gmHouse = clampHouseLevel(this._viewHouse() + delta);
    this.relayout();
  }

  private _nudgeGmLevel(delta: number): void {
    if (!this._gmPick) {
      Platform.showToast('先点一件家具');
      return;
    }
    const cur = this._viewLevel(this._gmPick);
    this._gmView[this._gmPick] = Math.max(0, Math.min(FURN_MAX_LEVEL, cur + delta));
    this.relayout();
  }

  private _scalePick(mult: number): void {
    if (!this._gmPick) {
      Platform.showToast('先点一件家具');
      return;
    }
    const item = this._furnAt(this._gmPick);
    if (!item) return;
    item.nw = Math.max(0.06, Math.min(0.88, item.nw * mult));
    item.nh = Math.max(0.08, Math.min(0.88, item.nh * mult));
    saveGmLayout(this._layout);
    this.relayout();
  }

  private _exportLayout(): void {
    const text = dumpKitchenLayout(this._layout, this._viewHouse(), this._gmView);
    console.log(text);
    Platform.setClipboard(text);
    Platform.showToast('布局已复制到剪贴板');
  }

  private _hotspotsFromLayout(): Array<{ id: HotspotId; nx: number; ny: number; nw: number; nh: number; label: string }> {
    const fridge = this._furnAt('fridge');
    const table = this._furnAt('table');
    const basket = this._furnAt('basket');
    const foam = this._furnAt('foam');
    const door = houseDoor(this._viewHouse());
    return [
      { id: 'door', nx: door.nx, ny: door.ny + 0.12, nw: door.nw, nh: door.nh - 0.12, label: '出门' },
      ...(basket ? [{ ...basket, id: 'basket' as const, label: furnLabel('basket', this._viewLevel('basket')) }] : []),
      ...(fridge ? [{ ...fridge, id: 'fridge' as const, label: '冰箱' }] : []),
      ...(foam ? [{ ...foam, id: 'foam' as const, label: furnLabel('foam', this._viewLevel('foam')) }] : []),
      ...(table ? [{ ...table, id: 'board' as const, label: '烹饪' }] : []),
    ];
  }

  /** 只点锅/灶，不要整张桌子布局框里的空地。 */
  private _cookHitRect(): { x: number; y: number; w: number; h: number } {
    const spr = this._furnSpriteRect('table');
    const lv = this._viewLevel('table');
    if (lv >= 5) {
      return {
        x: spr.x + spr.w * 0.08,
        y: spr.y + spr.h * 0.04,
        w: spr.w * 0.84,
        h: spr.h * 0.48,
      };
    }
    return {
      x: spr.x + spr.w * 0.14,
      y: spr.y + spr.h * 0.02,
      w: spr.w * 0.72,
      h: spr.h * 0.50,
    };
  }

  private _houseUpgradeBadge(): PIXI.Container | null {
    const save = KitchenManager.save;
    const level = houseLevel(save);
    if (level >= HOUSE_MAX_LEVEL) return null;
    const state = houseUpgradeState(save);
    const ready = state.status === 'ready';
    const open = this._upgradePick === 'house';
    const mark = houseUpgradeMark(this._viewHouse());
    const pin = mapNorm(this._fit, mark.nx, mark.ny, 0, 0);
    const size = Math.round(Math.min(48, Math.max(40, this._fit.srcH * this._fit.scale * 0.034)));
    const root = this._makeUpgradeBadge(size, ready, open);
    root.position.set(pin.x - size / 2 + HOUSE_UPGRADE_SHIFT_X, pin.y - size / 2);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._upgradePick = this._upgradePick === 'house' ? null : 'house';
      this.relayout();
    });
    return root;
  }

  private _makeUpgradeBadge(size: number, ready: boolean, open: boolean): PIXI.Container {
    const root = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.lineStyle(3, 0x2A2018, 1);
    bg.beginFill(ready || open ? 0xF2C14D : 0xE8DFD0);
    bg.drawCircle(size / 2, size / 2, size / 2 - 2);
    bg.endFill();
    root.addChild(bg);
    const arrow = new PIXI.Graphics();
    drawUpArrow(arrow, size / 2, size / 2, size, ready || open ? 0x2A2018 : 0x8A7A60);
    root.addChild(arrow);
    root.alpha = ready || open ? 1 : 0.72;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Circle(size / 2, size / 2, size / 2);
    bindUiClick(root);
    root.on('pointerdown', (e) => e.stopPropagation());
    return root;
  }

  private _upgradeBadge(
    id: FurnId,
    rect: { x: number; y: number; w: number; h: number },
  ): PIXI.Container | null {
    const state = furnUpgradeState(KitchenManager.save, id);
    if (state.status === 'max') return null;
    const ready = state.status === 'ready';
    const open = this._upgradePick === id;
    const size = 44;
    const root = this._makeUpgradeBadge(size, ready, open);
    root.position.set(rect.x + rect.w / 2 - size / 2, rect.y - size + 10);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._upgradePick = this._upgradePick === id ? null : id;
      this.relayout();
    });
    return root;
  }

  private _drawHouseUpgradeCard(): void {
    const save = KitchenManager.save;
    const level = houseLevel(save);
    const state = houseUpgradeState(save);
    const maxed = state.status === 'max';
    const ready = state.status === 'ready';
    const cost = state.status === 'max' ? 0 : state.cost;
    const mark = houseUpgradeMark(this._viewHouse());
    const pin = mapNorm(this._fit, mark.nx, mark.ny, 0, 0);
    const w = Game.designWidth;
    const cardW = 236;
    const cardH = 148;
    let x = pin.x + HOUSE_UPGRADE_SHIFT_X + this._pan.x - cardW / 2;
    let y = pin.y + this._pan.y - cardH - 28;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 64, y);

    const veil = new PIXI.Graphics();
    veil.beginFill(0x000000, 0.001);
    veil.drawRect(0, 0, w, Game.logicHeight);
    veil.endFill();
    veil.eventMode = 'static';
    veil.on('pointerdown', (e) => e.stopPropagation());
    veil.on('pointertap', () => {
      this._upgradePick = null;
      this.relayout();
    });
    this._ui.addChild(veil);

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.on('pointerdown', (e) => e.stopPropagation());
    card.on('pointertap', (e) => e.stopPropagation());

    const shadow = new PIXI.Graphics();
    fillRect(shadow, 4, 6, cardW, cardH, 0x2A2018, 16);
    shadow.alpha = 0.22;
    card.addChild(shadow);

    const panel = new PIXI.Graphics();
    panel.lineStyle(3, 0x2A2018, 1);
    panel.beginFill(0xFFF8F0);
    panel.drawRoundedRect(0, 0, cardW, cardH, 16);
    panel.endFill();
    card.addChild(panel);

    const name = makeLabel(houseLabel(level), 28, 0x2A2018, { fontWeight: '700' });
    name.position.set(18, 16);
    card.addChild(name);
    const levelText = makeLabel(
      maxed ? '已最高档' : `${level + 1}/${HOUSE_MAX_LEVEL + 1} 档`,
      20,
      0x8A6A40,
    );
    levelText.position.set(18, 52);
    card.addChild(levelText);

    if (!maxed) {
      const btn = makeButton(
        ready ? `装修  ${cost}` : state.status === 'blocked' ? state.error : `装修  ${cost}`,
        cardW - 36,
        52,
        ready ? 0xC46A3A : 0xC9B8A4,
        ready ? 0xFFF8F0 : 0x6A5A4A,
      );
      btn.position.set(18, 82);
      btn.alpha = ready ? 1 : 0.7;
      btn.on('pointertap', () => {
        if (!ready) {
          if (state.status === 'blocked') Platform.showToast(state.error);
          return;
        }
        KitchenManager.upgradeHouse();
        this._upgradePick = null;
      });
      card.addChild(btn);
    }
    this._ui.addChild(card);
  }

  private _drawUpgradeCard(id: UpgradePick): void {
    if (id === 'house') {
      this._drawHouseUpgradeCard();
      return;
    }
    const save = KitchenManager.save;
    const lv = furnLevel(save, id);
    const state = furnUpgradeState(save, id);
    const rect = this._furnSpriteRect(id);
    const w = Game.designWidth;
    const cardW = 252;
    const cardH = 148;
    let x = rect.x + rect.w / 2 + this._pan.x - cardW / 2;
    let y = rect.y + this._pan.y - cardH - 58;
    x = Math.max(16, Math.min(w - cardW - 16, x));
    y = Math.max((Number.isFinite(Game.safeTop) ? Game.safeTop : 96) + 64, y);

    const veil = new PIXI.Graphics();
    veil.beginFill(0x000000, 0.001);
    veil.drawRect(0, 0, w, Game.logicHeight);
    veil.endFill();
    veil.eventMode = 'static';
    veil.on('pointerdown', (e) => e.stopPropagation());
    veil.on('pointertap', () => {
      this._upgradePick = null;
      this.relayout();
    });
    this._ui.addChild(veil);

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.on('pointerdown', (e) => e.stopPropagation());
    card.on('pointertap', (e) => e.stopPropagation());

    const shadow = new PIXI.Graphics();
    fillRect(shadow, 4, 6, cardW, cardH, 0x2A2018, 16);
    shadow.alpha = 0.22;
    card.addChild(shadow);

    const panel = new PIXI.Graphics();
    panel.lineStyle(3, 0x2A2018, 1);
    panel.beginFill(0xFFF8F0);
    panel.drawRoundedRect(0, 0, cardW, cardH, 16);
    panel.endFill();
    card.addChild(panel);

    const shown = lv + 1;
    const name = makeLabel(furnLabel(id, lv), 28, 0x2A2018, { fontWeight: '700' });
    name.position.set(18, 16);
    card.addChild(name);
    const grade = makeLabel(`${shown}级`, 20, 0x8A6A40);
    grade.position.set(18 + name.width + 8, 22);
    card.addChild(grade);
    const cookNeed = furnCookNeed(id, lv);
    const capLine = (() => {
      if (state.status === 'max') return '已满级';
      const nextShown = lv + 2;
      if (id === 'fridge') {
        return `${nextShown}级容量  ${fridgeOwnCap(lv)}→${fridgeOwnCap(lv + 1)}`;
      }
      if (id === 'foam') {
        return `${nextShown}级容量  ${foamWetCols(lv)}×${foamWetRows(lv)}→${foamWetCols(lv + 1)}×${foamWetRows(lv + 1)}`;
      }
      if (id === 'basket') {
        return `${nextShown}级容量  ${bagDryCols(lv)}×${bagRows(lv)}→${bagDryCols(lv + 1)}×${bagRows(lv + 1)}`;
      }
      if (id === 'table') {
        return `${nextShown}级  解锁 ${tableUnlockNext(lv)} 本菜谱`;
      }
      return `${nextShown}级`;
    })();
    const level = makeLabel(capLine, 20, 0x8A6A40);
    level.position.set(18, 52);
    card.addChild(level);

    if (state.status !== 'max') {
      const ready = state.status === 'ready';
      const needHouse = state.status === 'blocked' && lv >= houseFurnCap(houseLevel(save), id);
      const needCook = state.status === 'blocked' && cookLevel(save) < cookNeed;
      const btnText = needHouse
        ? `要${houseLabel(minHouseForFurn(id, lv + 1))}`
        : needCook
          ? `厨艺 ${cookNeed} 级才能升`
          : `升级  ${state.cost}`;
      const btn = makeButton(btnText, cardW - 36, 52, ready ? 0xC46A3A : 0xC9B8A4, ready ? 0xFFF8F0 : 0x6A5A4A);
      btn.position.set(18, 82);
      btn.alpha = ready ? 1 : 0.7;
      btn.on('pointertap', () => {
        if (!ready) {
          if (state.status === 'blocked') Platform.showToast(state.error);
          return;
        }
        KitchenManager.upgrade(id);
      });
      card.addChild(btn);
    }
    this._ui.addChild(card);
  }

  private _hotspot(
    id: HotspotId,
    _label: string,
    rect: { x: number; y: number; w: number; h: number },
  ): PIXI.Container {
    const root = new PIXI.Container();
    root.position.set(rect.x, rect.y);
    const hit = new PIXI.Graphics();
    hit.beginFill(0xffffff, 0.001);
    hit.drawRoundedRect(0, 0, rect.w, rect.h, 10);
    hit.endFill();
    root.addChild(hit);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, rect.w, rect.h);
    root.on('pointertap', () => {
      if (this._dragMoved) return;
      this._onSpot(id);
    });
    return root;
  }

  private _onSpot(id: HotspotId): void {
    if (id === 'door') {
      this.goMarket();
      return;
    }
    if (id === 'fridge') {
      this._fridge.open();
      return;
    }
    if (id === 'board') {
      this._cook.open();
      return;
    }
    if (id === 'basket' || id === 'foam') {
      this._upgradePick = id;
      this.relayout();
    }
  }

  private goMarket(): void {
    if (!KitchenManager.canGoMarket()) {
      AudioManager.play('ui_deny');
      Platform.showToast('体力不足，看个广告也能出门');
      return;
    }
    if (OutingCurtain.busy) return;
    AudioManager.play('outing');
    OutingCurtain.play({
      paths: destinationBootPaths(),
      then: () => SceneManager.switchTo('destinations'),
    });
  }
}

function drawUpArrow(g: PIXI.Graphics, cx: number, cy: number, size: number, color: number): void {
  const s = size * 0.42;
  g.beginFill(color);
  g.moveTo(cx, cy - s * 0.55);
  g.lineTo(cx + s * 0.46, cy - s * 0.02);
  g.lineTo(cx + s * 0.18, cy - s * 0.02);
  g.lineTo(cx + s * 0.18, cy + s * 0.52);
  g.lineTo(cx - s * 0.18, cy + s * 0.52);
  g.lineTo(cx - s * 0.18, cy - s * 0.02);
  g.lineTo(cx - s * 0.46, cy - s * 0.02);
  g.closePath();
  g.endFill();
}
