import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Ease, TweenManager } from '@/core/TweenManager';
import { OverlayManager } from '@/core/OverlayManager';
import { Platform } from '@/core/PlatformService';
import { warmupAdScene } from '@/services/RewardedAdService';
import { RunManager } from '@/managers/RunManager';
import { RARITY_STYLE, getItem, itemRarity, type MysterySackPrize, type Rarity } from '@/sim';
import {
  MARKET_PROP_ART,
  P0_ART,
  UI_KIT,
  fitTextWidth,
  makeAdButton,
  makeRarityFlare,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawPlaqueTitle,
  drawSceneClose,
  drawSceneWall,
  drawStretchSheet,
  makeHangTag,
  makePlateItem,
  makeSceneRoot,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const ART = {
  wall: 'subpkg_images/scene_gacha_wall.png',
  menuTicket: 'subpkg_images/ui_menu_ticket.png',
  flare: 'subpkg_kitchen/ui_pickup_flare.png',
} as const;

const W = 720;
const COLS_X = [158, 360, 562] as const;
const INK = SCENE_INK.ink;

export class MysterySackPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _adBusy = false;
  private _paintQueued = false;
  private _animTargets: PIXI.DisplayObject[] = [];

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
    this._stopAnims();
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._adBusy = false;
    this._paintQueued = false;
    this._root.removeChildren();
  }

  private _stopAnims(): void {
    for (const t of this._animTargets) {
      TweenManager.cancelTarget(t);
      if ('scale' in t && t.scale) TweenManager.cancelTarget(t.scale);
    }
    this._animTargets = [];
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

  private _prizeMeta(p: MysterySackPrize): { name: string; rarity: Rarity; isTicket: boolean; iconPath: string } {
    if (p.kind === 'ticket') {
      return { name: `菜谱券 ×${p.qty}`, rarity: 'epic', isTicket: true, iconPath: ART.menuTicket };
    }
    const def = getItem(p.defId);
    return {
      name: def.name,
      rarity: itemRarity(p.defId),
      isTicket: false,
      iconPath: resolveItemAssetPath(p.defId),
    };
  }

  relayout(): void {
    this._stopAnims();
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
        ...Object.values(ART),
        ...sceneArtPaths(),
        UI_KIT.closeRound,
        UI_KIT.btnGold,
        UI_KIT.btnOlive,
        MARKET_PROP_ART.mysterySack,
        P0_ART.adClapper,
        ...foodPaths,
      ],
      this._scheduleRelayout,
    );

    const revealed = ms.pickedIdx !== null;
    const panelH = 924;

    const { scene } = makeSceneRoot({
      parent: this._root,
      designW: W,
      panelH,
      topBleed: 52,
      dimAlpha: 0.66,
      onDimTap: () => {
        if (this._adBusy || !revealed) return;
        this._finish();
      },
    });

    // 红灯笼木案市集摊位背景（案台面在 y≈552）
    drawSceneWall(scene, ART.wall, W, panelH, 760, 80);
    drawPlaqueTitle(scene, '压箱尾货篓', W / 2, -46, 348);
    drawSceneClose(scene, W - 46, -20, () => {
      if (this._adBusy) return;
      if (!revealed) {
        Platform.showToast('先免费挑一只麻袋拆开吧！');
        return;
      }
      this._finish();
    }, this._scheduleRelayout);

    // 墙面宽幅宣纸告示笺（从 y=144 起铺，避开木匾底边与左右铜钉）
    const topNoteX = 68;
    const topNoteY = 144;
    const topNoteW = W - topNoteX * 2;
    const topNoteH = 148;
    drawStretchSheet(scene, SCENE_ART.sheet, topNoteX, topNoteY, topNoteW, topNoteH, 78, 68);

    const headline = makeText(
      'title',
      revealed ? '三只麻袋全揭晓！' : '老摊主留下的三只粗布袋',
      INK,
      { size: 28 },
    );
    headline.anchor.set(0.5);
    headline.position.set(W / 2, topNoteY + 58);
    fitTextWidth(headline, topNoteW - 124);
    scene.addChild(headline);

    const subline = makeText(
      'body',
      revealed ? '挑中的好货已稳妥塞进菜篮' : '免费任挑一袋 · 必出跨场鲜货/腌菜/菜谱券',
      revealed ? SCENE_INK.green : SCENE_INK.soft,
      { size: 22, fontWeight: '700' },
    );
    subline.anchor.set(0.5);
    subline.position.set(W / 2, topNoteY + 104);
    fitTextWidth(subline, topNoteW - 76);
    scene.addChild(subline);

    const titles = ['一号麻袋', '二号麻袋', '三号麻袋'] as const;
    const tableY = 556;

    if (!revealed) {
      // 未拆前：三只粗布麻袋并排摆在红布木案台上 + 挂牛皮纸签 + 醒目拆袋钮
      ms.sacks.forEach((_prize, idx) => {
        const i = idx as 0 | 1 | 2;
        const cx = COLS_X[i];
        const col = new PIXI.Container();

        const tag = makeHangTag(184);
        tag.node.pivot.set(tag.faceCx, 0);
        tag.node.position.set(cx, 314);
        tag.node.rotation = i === 0 ? -0.04 : i === 2 ? 0.04 : 0;
        const tagT = makeText('heading', titles[i], INK, { size: 23 });
        tagT.anchor.set(0.5);
        tagT.position.set(tag.faceCx, tag.h * 0.5);
        fitTextWidth(tagT, tag.faceW - 8);
        tag.node.addChild(tagT);
        col.addChild(tag.node);

        const sackSp = sceneSprite(MARKET_PROP_ART.mysterySack, 174, 174);
        if (sackSp) {
          sackSp.anchor.set(0.5, 1);
          sackSp.position.set(cx, tableY + 8);
          col.addChild(sackSp);
          this._animTargets.push(sackSp);
          const baseSx = sackSp.scale.x;
          const baseSy = sackSp.scale.y;
          const breathe = (): void => {
            if (!this._isOpen || sackSp.destroyed) return;
            TweenManager.to({
              target: sackSp.scale,
              props: { x: baseSx * 1.04, y: baseSy * 0.96 },
              duration: 0.72 + i * 0.1,
              ease: Ease.easeInOutQuad,
              onComplete: () => {
                if (!this._isOpen || sackSp.destroyed) return;
                TweenManager.to({
                  target: sackSp.scale,
                  props: { x: baseSx, y: baseSy },
                  duration: 0.72 + i * 0.1,
                  ease: Ease.easeInOutQuad,
                  onComplete: breathe,
                });
              },
            });
          };
          breathe();
        }

        const btnW = 180;
        const btnH = 58;
        const pickBtn = makeSlicedButton({
          label: '免费拆开',
          width: btnW,
          height: btnH,
          skin: 'gold',
          textColor: INK,
          fontSize: 25,
          onReady: this._scheduleRelayout,
        });
        pickBtn.position.set(cx - btnW / 2, tableY + 30);
        pickBtn.eventMode = 'none';
        col.addChild(pickBtn);

        col.eventMode = 'static';
        col.cursor = 'pointer';
        col.hitArea = new PIXI.Rectangle(cx - 98, 314, 196, tableY + 30 + btnH - 314);
        col.on('pointertap', () => {
          const res = RunManager.pickMysterySack(i);
          if (!res.ok) return;
          AudioManager.play(res.isTicket ? 'recipe_paper' : 'event_pop');
          Platform.showToast(`拆出好货：${res.label}！`, 'success');
          this.relayout();
        });
        scene.addChild(col);
      });

      // 案台下方宣纸提示条（首行下移避开铜钉）
      const footX = 40;
      const footY = 690;
      const footW = W - footX * 2;
      drawStretchSheet(scene, SCENE_ART.sheet, footX, footY, footW, 174, 80, 70);
      const footTitle = makeText('heading', '挑一只顺眼的粗布袋解开麻绳吧！', INK, { size: 26 });
      footTitle.anchor.set(0.5);
      footTitle.position.set(W / 2, footY + 66);
      fitTextWidth(footTitle, footW - 128);
      scene.addChild(footTitle);

      const footSub = makeText('body', '拆开后还能看清另外两只袋子里藏了啥好货', SCENE_INK.muted, { size: 22 });
      footSub.anchor.set(0.5);
      footSub.position.set(W / 2, footY + 112);
      fitTextWidth(footSub, footW - 88);
      scene.addChild(footSub);
      return;
    }

    // ── 已拆开：三只青花瓷碟陈列在红布木案台上 + 下方宣纸揭晓单与操作按钮 ────────
    const sheetTop = 586;
    const sheetH = 306;
    drawStretchSheet(scene, SCENE_ART.sheet, 28, sheetTop, W - 56, sheetH, 120, 110);

    ms.sacks.forEach((prize, idx) => {
      const i = idx as 0 | 1 | 2;
      const cx = COLS_X[i];
      const isPicked = ms.pickedIdx === i;
      const isTaken = isPicked || ms.sweptByAd;
      const meta = this._prizeMeta(prize);

      const dishWrap = new PIXI.Container();
      dishWrap.position.set(cx, tableY - 26);

      if (isTaken) {
        const flare = makeRarityFlare(meta.rarity, 196);
        flare.position.set(0, -14);
        dishWrap.addChild(flare);
      }

      const plate = makePlateItem({
        iconPath: meta.iconPath,
        plateW: 164,
        iconSize: meta.isTicket ? 108 : 102,
        dim: !isTaken,
      });
      dishWrap.addChild(plate);

      if (isTaken) {
        const stamp = makeSealStamp('收入', 50, -0.1);
        stamp.position.set(56, -48);
        dishWrap.addChild(stamp);
      }
      scene.addChild(dishWrap);

      // 宣纸单对应列写出大字品名与状态（下移至 sheetTop+58 彻底避开两侧黄铜图钉）
      const nameColor = isTaken ? (RARITY_STYLE[meta.rarity]?.ink ?? INK) : SCENE_INK.muted;
      const nameLbl = makeText('title', meta.name, nameColor, { size: 26 });
      nameLbl.anchor.set(0.5, 0);
      nameLbl.position.set(cx, sheetTop + 58);
      fitTextWidth(nameLbl, 176);
      scene.addChild(nameLbl);

      const stLbl = makeText(
        'caption',
        isTaken ? '✓ 已收进篮' : '未拿走',
        isTaken ? SCENE_INK.green : SCENE_INK.muted,
        { size: 22, fontWeight: '700' },
      );
      stLbl.anchor.set(0.5, 0);
      stLbl.position.set(cx, sheetTop + 96);
      scene.addChild(stLbl);
    });

    const contentL = 64;
    const contentR = W - 64;
    const contentW = contentR - contentL;
    drawInkDivider(scene, contentL, sheetTop + 144, contentW, 0.5, 11);

    const canSweep = !ms.sweptByAd && !RunManager.run?.sackSweepUsed;
    const btnY = sheetTop + 174;
    const btnH = 62;

    if (canSweep) {
      const gap = 14;
      const adW = Math.round(contentW * 0.62);
      const goW = contentW - adW - gap;
      const adBtn = makeAdButton({
        label: '全收下(领剩2袋)',
        width: adW,
        height: btnH,
        skin: 'gold',
        textColor: INK,
        badge: '本局限1',
        onReady: this._scheduleRelayout,
      });
      adBtn.position.set(contentL, btnY);
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
      scene.addChild(adBtn);

      const doneBtn = makeSlicedButton({
        label: '继续逛集',
        width: goW,
        height: btnH,
        skin: 'olive',
        fontSize: 26,
        onReady: this._scheduleRelayout,
      });
      doneBtn.position.set(contentL + adW + gap, btnY);
      doneBtn.on('pointertap', () => this._finish());
      scene.addChild(doneBtn);
    } else {
      const doneBtn = makeSlicedButton({
        label: '满载继续逛集！',
        width: contentW,
        height: btnH,
        skin: 'olive',
        fontSize: 28,
        onReady: this._scheduleRelayout,
      });
      doneBtn.position.set(contentL, btnY);
      doneBtn.on('pointertap', () => this._finish());
      scene.addChild(doneBtn);
    }
  }

  private _finish(): void {
    this.close(true);
    AudioManager.play('ui_click');
    RunManager.finishMysterySack();
  }
}
