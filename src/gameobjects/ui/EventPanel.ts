import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { OverlayManager } from '@/core/OverlayManager';
import { eventVoice, neighborRewardChips, type RunEventLog } from '@/sim';
import { fitSpriteInBox, gameTexture, isTextureReady, resolveItemAssetPath, watchTextures } from '@/utils/assets';
import { destroyDisplayChildren } from '@/utils/destroy';
import {
  HUD_ICON,
  UI_KIT,
  bindUiClick,
  fillRect,
  fitTextWidth,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawSceneWall,
  drawStretchSheet,
  makeInlineRewards,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

const WALL = 'subpkg_images/scene_order_wall.png';
const WASHI = 'subpkg_images/scene_dex_washi.png';
const INK = SCENE_INK.ink;
const CHOICE_NUMS = ['壹', '贰', '叁', '肆'] as const;

/**
 * 集市奇遇事件页：半身人物立绘 + 木板钉宣纸话本笺 + 实物纸条选项。
 * talk 带选项时必须点一项，点暗幕不关。
 */
export class EventPanel extends PIXI.Container {
  _isOpen = false;
  private _root = new PIXI.Container();
  private _log: RunEventLog | null = null;
  private _onChoice: ((index: number) => boolean | void) | null = null;
  private _paintQueued = false;

  constructor() {
    super();
    this.visible = false;
    this.zIndex = 26;
    this.eventMode = 'static';
    this.addChild(this._root);
    OverlayManager.container.addChild(this);
  }

  open(log: RunEventLog, onChoice?: (index: number) => boolean | void): void {
    if (log.gain && !log.choices?.length) return;
    AudioManager.play('event_pop');
    this._log = log;
    this._onChoice = onChoice ?? null;
    this._isOpen = true;
    this.visible = true;
    this.relayout();
    OverlayManager.bringToFront();
  }

  close(silent = false): void {
    if (this._isOpen && !silent) AudioManager.play('ui_close');
    this._isOpen = false;
    this.visible = false;
    this._log = null;
    this._onChoice = null;
    this._paintQueued = false;
    destroyDisplayChildren(this._root);
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

  relayout(): void {
    destroyDisplayChildren(this._root);
    const log = this._log;
    if (!this._isOpen || !log) return;

    const voice = eventVoice(log.marketId, log.kind);
    const speaker = log.speaker ?? voice?.speaker ?? null;
    const portrait = log.portrait ?? voice?.portrait ?? null;
    const choices = log.choices ?? [];
    const rewardChips = rewardChipsOf(log);

    const watchList: string[] = [
      WALL,
      WASHI,
      ...sceneArtPaths(),
      UI_KIT.btnOlive,
      HUD_ICON.coin,
    ];
    if (portrait) watchList.push(portrait);
    for (const chip of rewardChips) {
      if (chip.icon) watchList.push(chip.icon);
      if (chip.itemId) watchList.push(resolveItemAssetPath(chip.itemId));
    }
    watchTextures(watchList, this._scheduleRelayout);

    const sw = Game.designWidth;
    const sh = Game.logicHeight;
    this.hitArea = new PIXI.Rectangle(0, 0, sw, sh);

    const dim = new PIXI.Graphics();
    fillRect(dim, 0, 0, sw, sh, 0x160E08);
    dim.alpha = 0.62;
    dim.eventMode = 'static';
    if (!choices.length) dim.on('pointertap', () => this.close());
    this._root.addChild(dim);

    const boxW = Math.min(696, sw - 28);
    const sheetMargin = 22;
    // 左右内收至 84px，彻底避开宣纸四角黄铜图钉
    const contentL = 84;
    const contentR = boxW - 84;
    const contentW = contentR - contentL;

    const storyText = makeText('body', log.text, INK, {
      size: 26,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: contentW - 56,
      lineHeight: 40,
    });

    // 木匾 plaqueTop=-56 时底边在 y≈118；宣纸从 y=126 起铺，正文从 y=180 起写，零遮挡零压钉
    const sheetTop = 126;
    const textTop = sheetTop + 56;
    const storyH = Math.ceil(storyText.height);
    const rewardH = rewardChips.length ? 64 : 0;
    const choiceGap = 14;
    const slipH = 66;
    const choicesBlockH = choices.length
      ? choices.length * slipH + (choices.length - 1) * choiceGap
      : 64;

    const sheetH = 56 + storyH + 24 + rewardH + 22 + choicesBlockH + 38;
    const boxH = sheetTop + sheetH + 24;

    const bottomMargin = Math.max(36, Game.safeBottom + 28);
    const x = Math.round((sw - boxW) / 2);
    const y = Math.round(Math.max(Game.safeTop + 128, sh - boxH - bottomMargin));

    // 半身人物立绘站在话本纸笺上方
    if (portrait) {
      const tex = gameTexture(portrait);
      if (isTextureReady(tex)) {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5, 1);
        const maxPortraitH = Math.max(200, Math.min(540, y - Game.safeTop + 88));
        fitSpriteInBox(sp, 460, maxPortraitH);
        sp.position.set(Math.round(sw * 0.36), y + sheetTop + 8);
        sp.eventMode = 'none';
        this._root.addChild(sp);
      }
    }

    const card = new PIXI.Container();
    card.position.set(x, y);
    card.eventMode = 'static';
    card.hitArea = new PIXI.Rectangle(0, -58, boxW, boxH + 66);
    card.on('pointertap', (e) => e.stopPropagation());
    this._root.addChild(card);

    // 木纹底衬 + 钉在上面的宣纸话本笺
    drawSceneWall(card, WALL, boxW, boxH, 160, 110);
    drawStretchSheet(card, SCENE_ART.sheet, sheetMargin, sheetTop, boxW - sheetMargin * 2, sheetH, 120, 100);

    // 说话人木牌名签（或居中奇遇木牌），挂在宣纸上沿以上
    const titleLabel = speaker ?? '市井奇遇';
    const plaqueW = Math.min(340, Math.max(236, titleLabel.length * 42 + 108));
    const plaqueSp = sceneSprite(SCENE_ART.plaque, plaqueW);
    const plaqueCx = portrait && speaker ? Math.min(boxW - plaqueW / 2 - 36, Math.max(plaqueW / 2 + 32, boxW * 0.38)) : boxW / 2;
    const plaqueTop = -54;
    let plaqueFaceY = plaqueTop + 108;
    if (plaqueSp) {
      plaqueSp.position.set(plaqueCx - plaqueW / 2, plaqueTop);
      card.addChild(plaqueSp);
      plaqueFaceY = plaqueTop + plaqueSp.height * 0.64;
    }
    const spkTxt = makeText('display', titleLabel, 0x4A2A12, {
      size: titleLabel.length > 5 ? 32 : 36,
      stroke: 0xF6DDB0,
      strokeWidth: 3,
    });
    spkTxt.anchor.set(0.5);
    spkTxt.position.set(plaqueCx, plaqueFaceY);
    fitTextWidth(spkTxt, plaqueW - 56);
    card.addChild(spkTxt);

    // 右侧朱红奇遇印（位于右铜钉下方内侧）
    const seal = makeSealStamp('偶遇', 48, 0.09);
    seal.position.set(contentR - 18, textTop + 26);
    card.addChild(seal);

    // 剧情正文直接书写在宣纸上
    storyText.position.set(contentL, textTop);
    card.addChild(storyText);

    const optL = 62;
    const optW = boxW - optL * 2;
    let curY = textTop + storyH + 18;
    drawInkDivider(card, optL, curY, optW, 0.48, 10);
    curY += 20;

    // 无框谢礼直排
    if (rewardChips.length) {
      const lead = makeText('body', '街坊谢礼：', SCENE_INK.soft, { size: 24, fontWeight: '700' });
      lead.anchor.set(0, 0.5);
      lead.position.set(optL, curY + 20);
      card.addChild(lead);

      const inline = makeInlineRewards(rewardChips, {
        size: 25,
        iconSize: 36,
        color: INK,
        goldColor: SCENE_INK.gold,
        resolveItemIcon: (id) => resolveItemAssetPath(id),
      });
      inline.position.set(optL + lead.width + 6, curY + 20);
      card.addChild(inline);
      curY += rewardH;
    }

    // 实物纸条式选项按钮
    if (choices.length) {
      choices.forEach((choice, i) => {
        const isLeave = i === choices.length - 1 && choices.length > 1;
        const slip = this._makePaperChoiceSlip({
          index: i,
          label: choice.label,
          stepCost: choice.steps ?? 0,
          width: optW,
          height: slipH,
          muted: isLeave,
          onTap: () => {
            const pick = this._onChoice;
            const ok = pick?.(i);
            if (ok === false) return;
            this.close();
          },
        });
        slip.position.set(optL, curY + i * (slipH + choiceGap));
        card.addChild(slip);
      });
      return;
    }

    const btnW = 248;
    const btnH = 58;
    const btn = makeSlicedButton({
      label: '记下了',
      width: btnW,
      height: btnH,
      skin: 'olive',
      fontSize: 27,
      onReady: this._scheduleRelayout,
    });
    btn.position.set(optL + optW - btnW, curY + 4);
    btn.on('pointertap', () => this.close());
    card.addChild(btn);
  }

  /** 实物手写纸签条选项按钮（胶带贴角 + 朱砂字号章 + 25pt 大字） */
  private _makePaperChoiceSlip(opts: {
    index: number;
    label: string;
    stepCost: number;
    width: number;
    height: number;
    muted: boolean;
    onTap: () => void;
  }): PIXI.Container {
    const { width, height, muted } = opts;
    const root = new PIXI.Container();

    const anchorPad = new PIXI.Graphics();
    anchorPad.beginFill(0x000000, 0.001);
    anchorPad.drawRect(0, 0, width, height);
    anchorPad.endFill();
    anchorPad.eventMode = 'none';
    root.addChild(anchorPad);

    const face = new PIXI.Container();
    face.eventMode = 'none';
    root.addChild(face);

    const bg = new PIXI.Graphics();
    bg.beginFill(0x2A1A0E, 0.16);
    bg.drawRoundedRect(2, 4, width, height, 12);
    bg.endFill();
    bg.lineStyle(2.2, muted ? 0x8F765A : 0x7A4B26, 0.95);
    bg.beginFill(muted ? 0xEFE5D2 : 0xFFF7E4, 1);
    bg.drawRoundedRect(0, 0, width, height, 12);
    bg.endFill();
    bg.lineStyle(0);
    bg.beginFill(muted ? 0x9C8265 : 0xC44A2D, 0.9);
    bg.drawRoundedRect(12, 12, 6, height - 24, 3);
    bg.endFill();
    face.addChild(bg);

    const washi = sceneSprite(WASHI, 68, 16);
    if (washi) {
      washi.anchor.set(0.5);
      washi.rotation = -0.14;
      washi.alpha = 0.72;
      washi.position.set(28, 4);
      face.addChild(washi);
    }

    const numTxt = makeText(
      'heading',
      `${CHOICE_NUMS[opts.index] ?? (opts.index + 1)}·`,
      muted ? SCENE_INK.muted : SCENE_INK.red,
      { size: 24 },
    );
    numTxt.anchor.set(0, 0.5);
    numTxt.position.set(28, height / 2);
    face.addChild(numTxt);

    let rightReserve = 22;
    if (opts.stepCost > 0) {
      const costTxt = makeText('caption', `天色 -${opts.stepCost}`, SCENE_INK.red, { size: 22, fontWeight: '700' });
      costTxt.anchor.set(1, 0.5);
      costTxt.position.set(width - 18, height / 2);
      face.addChild(costTxt);
      rightReserve = Math.ceil(costTxt.width) + 34;
    } else {
      const arrow = makeText('heading', '▸', muted ? SCENE_INK.muted : SCENE_INK.gold, { size: 26 });
      arrow.anchor.set(1, 0.5);
      arrow.position.set(width - 18, height / 2);
      face.addChild(arrow);
      rightReserve = 46;
    }

    const labelX = 28 + Math.ceil(numTxt.width) + 6;
    const mainLbl = makeText('body', opts.label, muted ? SCENE_INK.soft : INK, {
      size: 25,
      fontWeight: '700',
    });
    mainLbl.anchor.set(0.5, 0.5);
    mainLbl.anchor.set(0, 0.5);
    mainLbl.position.set(labelX, height / 2);
    fitTextWidth(mainLbl, width - labelX - rightReserve);
    face.addChild(mainLbl);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(0, 0, width, height);
    const reset = (): void => {
      face.y = 0;
      face.alpha = 1;
    };
    root.on('pointerdown', () => {
      face.y = 2;
      face.alpha = 0.94;
    });
    root.on('pointerup', reset);
    root.on('pointerupoutside', reset);
    root.on('pointercancel', reset);
    bindUiClick(root);
    root.on('pointertap', opts.onTap);
    return root;
  }
}

function rewardChipsOf(log: RunEventLog): Array<{ icon?: string; itemId?: string; label: string }> {
  const rewards = log.rewards;
  if (!rewards) return [];
  return neighborRewardChips({
    gold: rewards.gold ?? 0,
    food: rewards.foods?.[0],
  });
}
