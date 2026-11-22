import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { RunManager } from '@/managers/RunManager';
import { getItem, itemRarity, type MysterySackPrize, type Rarity } from '@/sim';
import {
  HUD_ICON,
  MARKET_PROP_ART,
  P0_ART,
  UI_KIT,
  UI_PALETTE,
  drawCraftCard,
  drawItemSlotBox,
  drawSectionTray,
  fillRect,
  makeAdButton,
  makeArtisanShell,
  makeLabel,
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
const OLIVE = UI_PALETTE.olive;

export class MysterySackPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _adBusy = false;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 28;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(): void {
    if (!RunManager.run?.pendingMysterySack) return;
    if (!this._isOpen) AudioManager.play('event_pop');
    this._isOpen = true;
    this.visible = true;
    this._adBusy = false;
    warmupAdScene('stall_favor');
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._adBusy = false;
    this._root.removeChildren();
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

  private _prizeMeta(p: MysterySackPrize): { name: string; rarity: Rarity; isTicket: boolean } {
    if (p.kind === 'ticket') {
      return { name: `菜谱券 ×${p.qty}`, rarity: 'epic', isTicket: true };
    }
    const def = getItem(p.defId);
    return { name: def.name, rarity: itemRarity(p.defId), isTicket: false };
  }

  relayout(): void {
    this._root.removeChildren();
    if (!this._isOpen) return;
    const ms = RunManager.run?.pendingMysterySack;
    if (!ms) {
      this.close(true);
      return;
    }

    const foodPaths = ms.sacks
      .filter((s): s is Extract<MysterySackPrize, { kind: 'food' }> => s.kind === 'food')
      .map((s) => resolveItemAssetPath(s.defId));
    watchTextures(
      [
        UI_KIT.headerRibbon,
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        MARKET_PROP_ART.mysterySack,
        HUD_ICON.ticket,
        P0_ART.adClapper,
        'subpkg_kitchen/ui_pickup_flare.png',
        ...foodPaths,
      ],
      this._scheduleRelayout,
    );

    const w = Game.designWidth;
    const h = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, w, h);

    const revealed = ms.pickedIdx !== null;

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, w, h, 0x160E08);
    dim.alpha = 0.58;
    dim.eventMode = 'static';
    dim.on('pointertap', () => {
      if (this._adBusy || !revealed) return;
      this._finish();
    });
    this._root.addChild(dim);

    const boxW = Math.min(w - 32, 668);
    const boxH = 516;
    const padX = 24;
    const cw = boxW - padX * 2;
    const bx = Math.round((w - boxW) / 2);
    const by = Math.round(Math.max(Game.safeTop + 30, (h - boxH) / 2));

    const { shell } = makeArtisanShell({
      width: boxW,
      height: boxH,
      title: '压 箱 尾 货 篓',
      subtitle: revealed
        ? '三只麻袋全揭晓 · 好货已入菜篮'
        : '老摊主留下的三只麻袋 · 免费任挑一袋！',
      closeSilent: true,
      onReady: this._scheduleRelayout,
      onClose: () => {
        if (this._adBusy) return;
        if (!revealed) {
          Platform.showToast('先免费挑一只麻袋拆开吧！');
          return;
        }
        this._finish();
      },
    });
    shell.position.set(bx, by);
    this._root.addChild(shell);

    const trayY = 96;
    const trayH = 294;
    const tray = new PIXI.Graphics();
    drawSectionTray(tray, padX, trayY, cw, trayH, { radius: 18, tone: 'sand' });
    shell.addChild(tray);

    const gap = 12;
    const cardW = Math.floor((cw - 24 - gap * 2) / 3);
    const cardH = trayH - 24;
    const titles = ['一号麻袋', '二号麻袋', '三号麻袋'];

    ms.sacks.forEach((prize, idx) => {
      const i = idx as 0 | 1 | 2;
      const cx = padX + 12 + i * (cardW + gap);
      const cy = trayY + 12;
      const isPicked = ms.pickedIdx === i;
      const isTaken = isPicked || ms.sweptByAd;
      const meta = this._prizeMeta(prize);

      const card = new PIXI.Container();
      card.position.set(cx, cy);

      const cbg = new PIXI.Graphics();
      if (!revealed) {
        drawCraftCard(cbg, 0, 0, cardW, cardH, { radius: 16, tone: 'ivory', headerH: 38 });
      } else {
        drawItemSlotBox(cbg, 0, 0, cardW, cardH, {
          radius: 16,
          rarity: meta.rarity,
          selected: isTaken,
          dimmed: !isTaken,
          footerH: 44,
        });
      }
      card.addChild(cbg);

      if (!revealed) {
        const hdr = makeLabel(titles[i], 17, INK, { fontWeight: '700' });
        hdr.anchor.set(0.5);
        hdr.position.set(cardW / 2, 20);
        card.addChild(hdr);

        const sackTex = gameTexture(MARKET_PROP_ART.mysterySack);
        if (isTextureReady(sackTex)) {
          const spr = new PIXI.Sprite(sackTex);
          fitSpriteInBox(spr, cardW - 22, 148);
          spr.anchor.set(0.5);
          spr.position.set(cardW / 2, 126);
          card.addChild(spr);
          TweenManager.to({
            target: spr.scale,
            props: { x: spr.scale.x * 1.04, y: spr.scale.y * 0.97 },
            duration: 0.75 + i * 0.12,
            ease: Ease.easeInOutQuad,
          });
        }

        const pickBtn = makeSlicedButton({
          label: '免费拆开',
          width: cardW - 20,
          height: 42,
          skin: 'gold',
          textColor: INK,
          fontSize: 17,
          onReady: this._scheduleRelayout,
        });
        pickBtn.position.set(10, cardH - 54);
        card.addChild(pickBtn);

        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
        card.on('pointertap', () => {
          const res = RunManager.pickMysterySack(i);
          if (!res.ok) return;
          AudioManager.play(res.isTicket ? 'recipe_paper' : 'event_pop');
          Platform.showToast(`拆出好货：${res.label}！`, 'success');
          this.relayout();
        });
      } else {
        if (isTaken) {
          const flare = makeRarityFlare(meta.rarity, 148);
          flare.position.set(cardW / 2, 114);
          card.addChild(flare);
        }

        const iconTex = meta.isTicket
          ? gameTexture(HUD_ICON.ticket)
          : itemTexture((prize as Extract<MysterySackPrize, { kind: 'food' }>).defId);
        if (isTextureReady(iconTex)) {
          const spr = new PIXI.Sprite(iconTex);
          fitSpriteInBox(spr, cardW - 34, 124);
          spr.anchor.set(0.5);
          spr.position.set(cardW / 2, 116);
          if (!isTaken) spr.alpha = 0.78;
          card.addChild(spr);
        }

        const tag = makeSlotBadge(
          isTaken ? '✓ 已收入' : '未拿走',
          isTaken ? 'olive' : 'ink',
          14,
        );
        tag.node.position.set(Math.round((cardW - tag.w) / 2), 11);
        card.addChild(tag.node);

        const nameLbl = makeLabel(meta.name, 18, INK, { fontWeight: '700' });
        nameLbl.anchor.set(0.5);
        nameLbl.position.set(cardW / 2, cardH - 22);
        card.addChild(nameLbl);
      }

      shell.addChild(card);
    });

    if (!revealed) {
      const tip = makeLabel('袋里必出跨场鲜货、老坛腌菜或菜谱券！', 17, OLIVE, { fontWeight: '700' });
      tip.anchor.set(0.5);
      tip.position.set(boxW / 2, trayY + trayH + 46);
      shell.addChild(tip);
      return;
    }

    const canSweep = !ms.sweptByAd && !RunManager.run?.sackSweepUsed;
    const btnY = boxH - 82;
    if (canSweep) {
      const adW = Math.round(cw * 0.60);
      const goW = cw - adW - 12;
      const adBtn = makeAdButton({
        label: '全收下(领剩2袋)',
        width: adW,
        height: 54,
        skin: 'gold',
        textColor: INK,
        badge: '本局限1',
        onReady: this._scheduleRelayout,
      });
      adBtn.position.set(padX, btnY);
      adBtn.on('pointertap', () => {
        if (this._adBusy) return;
        this._adBusy = true;
        Platform.showRewardedVideo(
          'stall_favor',
          () => {
            this._adBusy = false;
            const res = RunManager.sweepMysterySacksByAd();
            if (res.ok) {
              AudioManager.play(res.tickets > 0 ? 'recipe_paper' : 'event_pop');
              Platform.showToast(`全收下啦：${res.labels.join(' · ')}！`, 'success');
            }
            if (this._isOpen) this.relayout();
          },
          () => {
            this._adBusy = false;
          },
        );
      });
      shell.addChild(adBtn);

      const doneBtn = makeSlicedButton({
        label: '继续逛集',
        width: goW,
        height: 54,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 19,
        onReady: this._scheduleRelayout,
      });
      doneBtn.position.set(padX + adW + 12, btnY);
      doneBtn.on('pointertap', () => this._finish());
      shell.addChild(doneBtn);
    } else {
      const doneBtn = makeSlicedButton({
        label: '满载继续逛集！',
        width: cw,
        height: 54,
        skin: 'olive',
        textColor: PAPER,
        fontSize: 21,
        onReady: this._scheduleRelayout,
      });
      doneBtn.position.set(padX, btnY);
      doneBtn.on('pointertap', () => this._finish());
      shell.addChild(doneBtn);
    }
  }

  private _finish(): void {
    this.close(true);
    AudioManager.play('ui_click');
    RunManager.finishMysterySack();
  }
}
