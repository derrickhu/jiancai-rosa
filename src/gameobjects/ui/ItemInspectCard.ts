import * as PIXI from 'pixi.js';
import { AudioManager } from '@/core/AudioManager';
import { Game } from '@/core/Game';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  displayName,
  GOD_PICK,
  fridgeItemBlurb,
  fridgeItemName,
  fridgeItemQty,
  fridgeItemUnitPrice,
  fridgeKind,
  getItem,
  itemRarity,
  recipeById,
  recipeEatLabel,
  recipeMinStoveLv,
  recipeRarity,
  recipeSellPrice,
  resolveRarityTier,
  sellPrice,
  type FridgeItem,
  type Quality,
  type Rarity,
  type RecipeId,
} from '@/sim';
import {
  HUD_ICON,
  UI_BTN,
  UI_KIT,
  UI_PALETTE,
  attachSpriteContour,
  bindUiClick,
  fillRect,
  fitTextWidth,
  makeCoinButton,
  makeSlicedButton,
  makeText,
} from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  watchTextures,
} from '@/utils/assets';
import {
  SCENE_ART,
  SCENE_INK,
  drawInkDivider,
  drawSceneClose,
  drawStretchSheet,
  makeRaritySeal,
  makeSealStamp,
  sceneArtPaths,
  sceneSprite,
} from './scenePanel';

export interface ItemInspectView {
  title: string;
  blurb: string;
  kind: 'food' | 'dish';
  defId: string;
  quality: Quality;
  rarity: Rarity;
  unitPrice: number;
  maxQty: number;
  eatLabel?: string;
  /** 占格、干湿等，跟在品质后面。 */
  note?: string;
  iconPath?: string;
  /** 有值就替代售价行。空字符串则不画售价。 */
  priceLine?: string;
}

function cleanFoodBlurb(defId: string, raw: string, quality: Quality): string {
  if (quality === 'rotten') return raw;
  if (defId === 'tofu') return '嫩得像刚睡醒，白玉一方，下汤煎烧都鲜滑。';
  if (defId === 'dried_tofu') return '压得紧实的豆香小方，切丝小炒最下饭。';
  return raw;
}

export function inspectFromFridge(it: FridgeItem): ItemInspectView {
  const dish = fridgeKind(it) === 'dish';
  const recipe = dish && it.defId ? recipeById(it.defId as RecipeId) : undefined;
  let note: string | undefined;
  if (dish) {
    note = recipe ? `${recipe.group} · 私房热菜` : '灶台成菜';
  } else if (it.quality === 'rotten') {
    note = '久置变质 · 不可下锅';
  } else {
    try {
      const def = getItem(it.defId);
      note = `${def.zone === 'wet' ? '湿货鲜材' : '干货食材'} · 占篮 ${def.w}×${def.h}`;
    } catch {
      note = '市井鲜材';
    }
  }
  const rawBlurb = fridgeItemBlurb(it);
  return {
    title: fridgeItemName(it),
    blurb: dish ? rawBlurb : cleanFoodBlurb(it.defId, rawBlurb, it.quality),
    kind: dish ? 'dish' : 'food',
    defId: it.defId,
    quality: it.quality,
    rarity: dish ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId),
    unitPrice: fridgeItemUnitPrice(it, KitchenManager.save),
    maxQty: fridgeItemQty(it),
    eatLabel: recipe ? recipeEatLabel(recipe.id) : undefined,
    note,
  };
}

export function inspectFromRecipe(id: RecipeId): ItemInspectView | null {
  const recipe = recipeById(id);
  if (!recipe) return null;
  const needStove = recipeMinStoveLv(id);
  return {
    title: recipe.name,
    blurb: recipe.blurb,
    kind: 'dish',
    defId: id,
    quality: 'fresh',
    rarity: recipe.rarity,
    unitPrice: recipeSellPrice(id),
    maxQty: 1,
    eatLabel: recipeEatLabel(id),
    note: `${recipe.group} · 灶台Lv.${needStove}`,
  };
}

export function inspectFromItem(id: string): ItemInspectView | null {
  return inspectFromFood({ defId: id, quality: 'common', inspected: true });
}

export function inspectFromFood(opts: {
  defId: string;
  quality: Quality;
  inspected?: boolean;
}): ItemInspectView | null {
  try {
    const inspected = opts.inspected ?? true;
    const lookId = opts.defId === GOD_PICK.id && !inspected ? 'smallfish' : opts.defId;
    const def = getItem(opts.defId);
    const look = getItem(lookId);
    return {
      title: displayName(opts.defId, inspected, opts.quality),
      blurb: opts.quality === 'rotten'
        ? (def.blurbRotten ?? '放久了，连自己都认不出自己。')
        : cleanFoodBlurb(lookId, look.blurb, opts.quality),
      kind: 'food',
      defId: lookId,
      quality: opts.quality,
      rarity: look.rarity,
      unitPrice: sellPrice(opts.defId, opts.quality, inspected),
      maxQty: 1,
      note: opts.quality === 'rotten'
        ? '久置变质 · 不可下锅'
        : `${def.zone === 'wet' ? '湿货' : '干货'} · 占篮 ${def.w}×${def.h}`,
    };
  } catch {
    return null;
  }
}

function resolveInspectIconPath(view: ItemInspectView): string {
  if (view.iconPath) return view.iconPath;
  if (view.kind === 'dish') return resolveDishAssetPath(view.defId);
  return resolveItemAssetPath(view.defId, view.quality === 'rotten');
}

/**
 * 宣纸鉴赏笺浮层：
 * 铜钉卷角宣纸底 + 青花瓷碟托物 + 朱红品阶印章 + 水墨分割线 + 大字风味评述与功效，
 * 彻底告别多层圆角小色块框。
 */
export function makeItemInspectCard(opts: {
  view: ItemInspectView;
  qty: number;
  actions: boolean;
  onQty: (n: number) => void;
  onClose: () => void;
  onSell?: () => void;
  onEat?: () => void;
  onReady?: () => void;
  onSellBtn?: (btn: PIXI.Container) => void;
}): PIXI.Container {
  const view = opts.view;
  const qty = Math.max(1, Math.min(view.maxQty, Math.floor(opts.qty)));
  const iconPath = resolveInspectIconPath(view);

  watchTextures(
    [
      ...sceneArtPaths(),
      HUD_ICON.coin,
      UI_KIT.closeRound,
      UI_KIT.btnOlive,
      UI_KIT.btnGold,
      UI_BTN.terracotta,
      UI_BTN.cream,
      iconPath,
    ],
    () => opts.onReady?.(),
  );

  const root = new PIXI.Container();
  const sw = Game.designWidth;
  const sh = Game.logicHeight;

  const dim = new PIXI.Graphics();
  fillRect(dim, 0, 0, sw, sh, 0x160E08);
  dim.alpha = 0.62;
  dim.eventMode = 'static';
  dim.on('pointertap', opts.onClose);
  root.addChild(dim);

  const cardW = Math.min(628, sw - 44);
  const padX = 52;
  const contentW = cardW - padX * 2;
  const canEat = view.kind === 'dish' && !!view.eatLabel;
  const showUsage = !!view.eatLabel;
  const showStepper = opts.actions && view.maxQty > 1;

  // 先排版测量高度，确保宣纸笺随文案自动舒展不裁字
  const blurb = makeText('body', view.blurb, SCENE_INK.ink, {
    size: 26,
    wordWrap: true,
    breakWords: true,
    wordWrapWidth: contentW,
    lineHeight: 38,
  });
  const blurbTop = 228;
  const blurbH = Math.max(76, Math.ceil(blurb.height));

  let cursorY = blurbTop + blurbH + 20;
  let usageNode: PIXI.Container | null = null;
  let usageY = 0;
  if (showUsage) {
    usageY = cursorY;
    usageNode = new PIXI.Container();
    const prefix = makeText('heading', '食效 · ', SCENE_INK.red, { size: 25 });
    const desc = makeText('body', view.eatLabel ?? '食用增益', SCENE_INK.green, {
      size: 25,
      fontWeight: '700',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: Math.max(180, contentW - prefix.width - 6),
      lineHeight: 34,
    });
    desc.position.set(prefix.width, 0);
    usageNode.addChild(prefix, desc);
    cursorY += 20 + Math.max(36, Math.ceil(desc.height)) + 16;
  }

  let stepperY = 0;
  if (showStepper) {
    stepperY = cursorY + 32;
    cursorY += 76;
  }

  let btnY = 0;
  const btnH = 62;
  if (opts.actions) {
    btnY = cursorY + 8;
    cursorY = btnY + btnH + 46;
  } else {
    cursorY += 54;
  }

  const cardH = Math.max(380, cursorY);
  const card = new PIXI.Container();
  card.eventMode = 'static';
  card.hitArea = new PIXI.Rectangle(0, -24, cardW + 20, cardH + 36);
  card.on('pointertap', (e) => e.stopPropagation());

  const availH = sh - Game.safeTop - Math.max(20, Game.safeBottom) - 40;
  const scale = Math.min(1, (sw - 28) / cardW, availH / cardH);
  card.scale.set(scale);
  card.position.set(
    Math.round((sw - cardW * scale) / 2),
    Math.round(Game.safeTop + 20 + Math.max(0, (availH - cardH * scale) / 2)),
  );
  root.addChild(card);

  // 宣纸投影 + 铜钉卷角宣纸底
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x0E0804, 0.44);
  shadow.drawRoundedRect(10, 16, cardW - 16, cardH - 8, 18);
  shadow.endFill();
  card.addChild(shadow);

  drawStretchSheet(card, SCENE_ART.sheet, 0, 0, cardW, cardH, 140, 120);

  // ── 顶部实物区：成菜去底盘大尺寸直呈（配柔和墨影），食材/道具保留青花瓷碟托底，轮廓光紧贴实物边缘 ──
  const plateCx = 134;
  const plateCy = 132;
  const visualTier = resolveRarityTier(view.rarity, view.quality);

  const plateW = 176;
  let itemTex: PIXI.Texture;
  if (view.iconPath) {
    itemTex = gameTexture(view.iconPath);
  } else if (view.kind === 'dish') {
    itemTex = dishTexture(view.defId);
  } else {
    itemTex = itemLookTexture(view.defId, view.quality === 'rotten' ? 'rotten' : 'clean');
  }

  if (view.kind === 'dish') {
    const dishShadow = new PIXI.Graphics();
    dishShadow.beginFill(0x2A1A0E, 0.22);
    dishShadow.drawEllipse(plateCx, plateCy + 42, 68, 19);
    dishShadow.endFill();
    dishShadow.eventMode = 'none';
    card.addChild(dishShadow);

    if (isTextureReady(itemTex)) {
      const icon = new PIXI.Sprite(itemTex);
      fitSpriteInBox(icon, 172, 172);
      icon.anchor.set(0.5);
      icon.position.set(plateCx, plateCy - 6);
      icon.eventMode = 'none';
      card.addChild(icon);
      if (view.quality !== 'rotten') {
        attachSpriteContour(card, icon, visualTier, {
          selected: visualTier !== 'common',
          thicknessScale: 1.08,
        });
      }
    }
  } else {
    const plate = sceneSprite(SCENE_ART.plate, plateW);
    if (plate) {
      plate.anchor.set(0.5);
      plate.position.set(plateCx, plateCy + 14);
      if (view.quality === 'rotten') plate.tint = 0xD8CCB8;
      card.addChild(plate);
    }
    if (isTextureReady(itemTex)) {
      const icon = new PIXI.Sprite(itemTex);
      fitSpriteInBox(icon, 114, 114);
      icon.anchor.set(0.5, 1);
      icon.position.set(plateCx, plateCy + 32);
      icon.eventMode = 'none';
      card.addChild(icon);
      if (view.quality !== 'rotten') {
        attachSpriteContour(card, icon, visualTier, {
          selected: visualTier !== 'common',
          thicknessScale: 1.05,
        });
      }
    }
  }

  if (view.maxQty > 1) {
    const qtyMark = makeText('number', `×${view.maxQty}`, SCENE_INK.red, {
      size: 26,
      stroke: 0xFFF8EA,
      strokeWidth: 5,
    });
    qtyMark.anchor.set(1, 1);
    qtyMark.position.set(plateCx + plateW / 2 + 4, plateCy + 54);
    card.addChild(qtyMark);
  }

  // 右侧文字与品阶色篆印（避开宣纸右上黄铜图钉）
  const infoX = 242;
  const infoR = cardW - padX;
  const sealSize = 58;
  const seal = view.quality === 'rotten'
    ? makeSealStamp('变质', sealSize, -0.09)
    : makeRaritySeal(visualTier, sealSize, -0.09);
  seal.position.set(infoR - 36, 82);
  card.addChild(seal);

  const title = makeText('title', view.title, SCENE_INK.ink, { size: 36 });
  title.position.set(infoX, 50);
  fitTextWidth(title, infoR - infoX - sealSize - 20);
  card.addChild(title);

  const noteStr = view.note || (view.kind === 'dish' ? '灶台家常味' : '市井精挑鲜材');
  const noteTxt = makeText(
    'body',
    noteStr,
    view.quality === 'rotten' ? SCENE_INK.red : SCENE_INK.soft,
    { size: 23 },
  );
  noteTxt.position.set(infoX, 98);
  fitTextWidth(noteTxt, infoR - infoX - sealSize - 10);
  card.addChild(noteTxt);

  // 售价直排：无框金币图标 + 大字墨金数值
  const unit = view.unitPrice;
  const goldN = unit * qty;
  const priceY = 152;
  if (view.priceLine !== undefined) {
    if (view.priceLine) {
      const customPrice = makeText('heading', view.priceLine, SCENE_INK.gold, { size: 25 });
      customPrice.anchor.set(0, 0.5);
      customPrice.position.set(infoX, priceY);
      fitTextWidth(customPrice, infoR - infoX);
      card.addChild(customPrice);
    }
  } else if (unit > 0) {
    const priceRow = new PIXI.Container();
    priceRow.position.set(infoX, priceY);
    const coinSp = sceneSprite(HUD_ICON.coin, 30, 30);
    let px = 0;
    if (coinSp) {
      coinSp.anchor.set(0, 0.5);
      priceRow.addChild(coinSp);
      px = 36;
    }
    const priceStr = opts.actions && qty > 1
      ? `单价 ${unit} · 共 ${goldN}`
      : `单价 ${unit}`;
    const priceTxt = makeText('number', priceStr, SCENE_INK.gold, { size: 26 });
    priceTxt.anchor.set(0, 0.5);
    priceTxt.position.set(px, 0);
    fitTextWidth(priceTxt, infoR - infoX - px);
    priceRow.addChild(priceTxt);
    card.addChild(priceRow);
  } else {
    const rottenTxt = makeText('body', '已变质 · 无法售卖', SCENE_INK.red, { size: 24, fontWeight: '700' });
    rottenTxt.anchor.set(0, 0.5);
    rottenTxt.position.set(infoX, priceY);
    card.addChild(rottenTxt);
  }

  // 水墨分割线 + 风味评述正文
  drawInkDivider(card, padX, 204, contentW, 0.58, 12);
  blurb.position.set(padX, blurbTop);
  card.addChild(blurb);

  // 食用功效（无框水墨行）
  if (usageNode) {
    drawInkDivider(card, padX, usageY, contentW, 0.28, 8);
    usageNode.position.set(padX, usageY + 18);
    card.addChild(usageNode);
  }

  // 份数加减器
  if (showStepper) {
    card.addChild(makeQtyStepper(cardW / 2, stepperY, qty, view.maxQty, opts.onQty));
  }

  // 底部手绘操作按钮或轻触收起提示
  if (opts.actions) {
    const gap = 18;
    if (canEat) {
      const half = Math.floor((contentW - gap) / 2);
      const eatBtn = makeSlicedButton({
        label: '品尝享用',
        width: half,
        height: btnH,
        skin: 'olive',
        fontSize: 28,
        onReady: opts.onReady,
      });
      eatBtn.position.set(padX, btnY);
      eatBtn.on('pointertap', () => opts.onEat?.());
      card.addChild(eatBtn);

      const sellBtn = makeInspectSellBtn(half, btnH, unit > 0 ? goldN : 0, opts.onReady);
      sellBtn.position.set(padX + half + gap, btnY);
      sellBtn.on('pointertap', () => {
        if (unit <= 0) return;
        opts.onSell?.();
      });
      opts.onSellBtn?.(sellBtn);
      card.addChild(sellBtn);
    } else {
      const sellBtn = makeInspectSellBtn(contentW, btnH, unit > 0 ? goldN : 0, opts.onReady);
      sellBtn.position.set(padX, btnY);
      sellBtn.on('pointertap', () => {
        if (unit <= 0) return;
        opts.onSell?.();
      });
      opts.onSellBtn?.(sellBtn);
      card.addChild(sellBtn);
    }
  } else {
    const hint = makeText('caption', '轻触空白处收起', SCENE_INK.muted, { size: 22 });
    hint.anchor.set(0.5, 1);
    hint.position.set(cardW / 2, cardH - 22);
    card.addChild(hint);
  }

  drawSceneClose(card, cardW - 44, -18, () => {
    AudioManager.play('ui_close');
    opts.onClose();
  }, opts.onReady);

  return root;
}

function makeInspectSellBtn(
  width: number,
  height: number,
  gold: number,
  onReady?: () => void,
): PIXI.Container {
  if (gold > 0) {
    return makeCoinButton({
      prefix: '卖出',
      price: gold,
      width,
      height,
      skin: 'gold',
      textColor: SCENE_INK.ink,
      fontSize: 28,
      onReady,
      silent: true,
    });
  }
  return makeSlicedButton({
    label: '无法售卖',
    width,
    height,
    skin: 'cream',
    textColor: 0x8A7358,
    fontSize: 26,
    onReady,
    silent: true,
  });
}

/**
 * 手绘木扣份数加减器（无小塑料凹槽框，大字清晰易点）。
 */
export function makeQtyStepper(
  cx: number,
  cy: number,
  qty: number,
  max: number,
  onQty: (n: number) => void,
): PIXI.Container {
  const root = new PIXI.Container();
  const span = 108;

  // 柔和墨迹底衬线，不套厚重色块框
  const line = new PIXI.Graphics();
  line.lineStyle(2, 0xB89A74, 0.55);
  line.moveTo(cx - span + 28, cy + 20);
  line.lineTo(cx + span - 28, cy + 20);
  root.addChild(line);

  const minus = makeRoundStepBtn('－', qty > 1);
  minus.position.set(cx - span, cy);
  minus.on('pointertap', (e) => {
    e.stopPropagation();
    if (qty <= 1) return;
    onQty(qty - 1);
  });

  const plus = makeRoundStepBtn('＋', qty < max);
  plus.position.set(cx + span, cy);
  plus.on('pointertap', (e) => {
    e.stopPropagation();
    if (qty >= max) return;
    onQty(qty + 1);
  });

  const n = makeText('number', `${qty} / ${max}`, SCENE_INK.ink, { size: 28 });
  n.anchor.set(0.5);
  n.position.set(cx, cy - 2);
  root.addChild(minus, plus, n);
  return root;
}

function makeRoundStepBtn(label: string, on: boolean): PIXI.Container {
  const root = new PIXI.Container();
  const r = 24;
  const g = new PIXI.Graphics();
  g.beginFill(0x1E120A, 0.22);
  g.drawCircle(0, 3, r);
  g.endFill();
  g.lineStyle(2.5, UI_PALETTE.ink, 1);
  g.beginFill(on ? UI_PALETTE.terracotta : 0xE5D8C3, 1);
  g.drawCircle(0, 0, r);
  g.endFill();
  if (on) {
    g.lineStyle(0);
    g.beginFill(0xFFFFFF, 0.22);
    g.drawEllipse(0, -8, 13, 5);
    g.endFill();
  }
  const text = makeText('heading', label, on ? 0xFFF8F0 : SCENE_INK.muted, {
    size: 28,
    ...(on ? { stroke: UI_PALETTE.ink, strokeWidth: 3 } : {}),
  });
  text.anchor.set(0.5);
  text.position.set(0, -1);
  root.addChild(g, text);
  root.eventMode = 'static';
  root.cursor = on ? 'pointer' : 'default';
  root.hitArea = new PIXI.Circle(0, 0, r + 8);
  if (on) bindUiClick(root);
  root.alpha = on ? 1 : 0.58;
  return root;
}
