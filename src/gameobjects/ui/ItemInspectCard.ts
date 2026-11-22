import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { KitchenManager } from '@/managers/KitchenManager';
import {
  RARITY_STYLE,
  displayName,
  GOD_PICK,
  fridgeItemBlurb,
  fridgeItemName,
  fridgeItemQty,
  fridgeItemUnitPrice,
  fridgeKind,
  getItem,
  itemRarity,
  rarityLabel,
  recipeById,
  recipeEatLabel,
  recipeRarity,
  recipeSellPrice,
  sellPrice,
  type FridgeItem,
  type Quality,
  type Rarity,
  type RecipeId,
} from '@/sim';
import {
  FONT,
  UI_PALETTE,
  bindUiClick,
  drawItemSlotBox,
  drawRecessedWell,
  drawSectionTray,
  fillRect,
  makeArtisanShell,
  makeLabel,
  makeSlicedButton,
  makeSlotBadge,
} from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  resolveDishAssetPath,
  resolveItemAssetPath,
  whenTextureReady,
} from '@/utils/assets';

const INK = UI_PALETTE.ink;
const PAPER = 0xFFF8F0;
const TERRACOTTA = UI_PALETTE.terracotta;
const MUTED = UI_PALETTE.muted;
const INDIGO = 0x35647B;
const COIN = 'subpkg_images/hud_coin.png';

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

export function inspectFromFridge(it: FridgeItem): ItemInspectView {
  const dish = fridgeKind(it) === 'dish';
  const recipe = dish && it.defId ? recipeById(it.defId as RecipeId) : undefined;
  return {
    title: fridgeItemName(it),
    blurb: fridgeItemBlurb(it),
    kind: dish ? 'dish' : 'food',
    defId: it.defId,
    quality: it.quality,
    rarity: dish ? recipeRarity(it.defId as RecipeId) : itemRarity(it.defId),
    unitPrice: fridgeItemUnitPrice(it, KitchenManager.save),
    maxQty: fridgeItemQty(it),
    eatLabel: recipe ? recipeEatLabel(recipe.id) : undefined,
  };
}

export function inspectFromRecipe(id: RecipeId): ItemInspectView | null {
  const recipe = recipeById(id);
  if (!recipe) return null;
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
        : look.blurb,
      kind: 'food',
      defId: lookId,
      quality: opts.quality,
      rarity: look.rarity,
      unitPrice: sellPrice(opts.defId, opts.quality, inspected),
      maxQty: 1,
      note: `${def.zone === 'wet' ? '湿货' : '干货'} ${def.w}×${def.h}`,
    };
  } catch {
    return null;
  }
}

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
  const root = new PIXI.Container();
  const w = Game.designWidth;
  const h = Game.logicHeight;
  const dim = new PIXI.Graphics();
  fillRect(dim, 0, 0, w, h, 0x160E08);
  dim.alpha = 0.46;
  dim.eventMode = 'static';
  dim.on('pointertap', opts.onClose);
  root.addChild(dim);

  const canEat = view.kind === 'dish' && !!view.eatLabel;
  const showUsage = !!view.eatLabel;
  const showStepper = opts.actions && view.maxQty > 1;
  const cardW = Math.min(536, w - 56);
  const cardH = opts.actions
    ? (showStepper || canEat ? 446 : 398)
    : (showUsage ? 368 : 326);

  const { shell: card } = makeArtisanShell({
    width: cardW,
    height: cardH,
    onReady: opts.onReady,
    closeSilent: true,
    onClose: opts.onClose,
  });
  card.position.set(Math.round((w - cardW) / 2), Math.round((h - cardH) / 2));
  root.addChild(card);

  const headerTray = new PIXI.Graphics();
  drawSectionTray(headerTray, 26, 24, cardW - 52, 102, { radius: 14, tone: 'sand' });
  card.addChild(headerTray);

  const iconBox = 86;
  const iconHost = new PIXI.Container();
  const iconBg = new PIXI.Graphics();
  drawItemSlotBox(iconBg, 0, 0, iconBox, iconBox, { radius: 13, rarity: view.rarity });
  iconHost.addChild(iconBg);

  if (view.iconPath) {
    whenTextureReady(view.iconPath, () => opts.onReady?.());
    const tex = gameTexture(view.iconPath);
    if (isTextureReady(tex)) {
      const icon = new PIXI.Sprite(tex);
      fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
      icon.anchor.set(0.5);
      icon.position.set(iconBox / 2, iconBox / 2);
      iconHost.addChild(icon);
    }
  } else if (view.kind === 'dish') {
    const path = resolveDishAssetPath(view.defId);
    whenTextureReady(path, () => opts.onReady?.());
    const tex = dishTexture(view.defId);
    if (isTextureReady(tex)) {
      const icon = new PIXI.Sprite(tex);
      fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
      icon.anchor.set(0.5);
      icon.position.set(iconBox / 2, iconBox / 2);
      iconHost.addChild(icon);
    }
  } else {
    const look = view.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
    const path = resolveItemAssetPath(view.defId, look === 'rotten');
    whenTextureReady(path, () => opts.onReady?.());
    const tex = itemLookTexture(view.defId, look);
    if (isTextureReady(tex)) {
      const icon = new PIXI.Sprite(tex);
      fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
      icon.anchor.set(0.5);
      icon.position.set(iconBox / 2, iconBox / 2);
      iconHost.addChild(icon);
    }
  }
  iconHost.position.set(34, 32);
  if (view.maxQty > 1) {
    const badge = makeSlotBadge(`×${view.maxQty}`, 'olive', 13);
    badge.node.position.set(iconBox - badge.w - 3, iconBox - badge.h - 3);
    iconHost.addChild(badge.node);
  }
  card.addChild(iconHost);

  const name = makeLabel(view.title, 24, INK, { fontWeight: '700' });
  name.position.set(134, 32);
  card.addChild(name);

  const gradeText = view.note ? `${rarityLabel(view.rarity)} · ${view.note}` : rarityLabel(view.rarity);
  const grade = makeLabel(gradeText, 15, RARITY_STYLE[view.rarity].ink, { fontWeight: '700' });
  const gradePill = new PIXI.Graphics();
  gradePill.lineStyle(1.4, 0x9C7D5A, 0.9);
  gradePill.beginFill(0xFFFBF2, 1);
  gradePill.drawRoundedRect(134, 65, Math.ceil(grade.width) + 18, 24, 8);
  gradePill.endFill();
  grade.position.set(143, 68);
  card.addChild(gradePill, grade);

  const unit = view.unitPrice;
  const goldN = unit * qty;
  if (view.priceLine !== undefined) {
    if (view.priceLine) {
      const gold = makeLabel(view.priceLine, 17, TERRACOTTA, { fontWeight: '700' });
      gold.position.set(134, 94);
      card.addChild(gold);
    }
  } else if (unit > 0) {
    const gold = makeLabel(`单价  ${unit}`, 17, 0x8F5808, { fontWeight: '700' });
    gold.position.set(134, 94);
    card.addChild(gold);
    whenTextureReady(COIN, () => opts.onReady?.());
    const coinTex = gameTexture(COIN);
    if (isTextureReady(coinTex)) {
      const coin = new PIXI.Sprite(coinTex);
      fitSpriteInBox(coin, 24, 24);
      coin.anchor.set(0, 0.5);
      coin.position.set(134 + gold.width + 6, 105);
      coin.eventMode = 'none';
      card.addChild(coin);
    }
  } else {
    const gold = makeLabel('坏了，卖不掉', 19, MUTED, { fontWeight: '700' });
    gold.position.set(134, 96);
    card.addChild(gold);
  }

  const blurb = new PIXI.Text(view.blurb, {
    fontFamily: FONT,
    fontSize: 19,
    fill: INK,
    fontWeight: '500',
    wordWrap: true,
    breakWords: true,
    wordWrapWidth: cardW - 84,
    lineHeight: 30,
  });
  blurb.eventMode = 'none';
  const wellH = Math.max(72, Math.min(104, Math.ceil(blurb.height) + 24));
  const blurbWell = new PIXI.Graphics();
  drawRecessedWell(blurbWell, 28, 134, cardW - 56, wellH, { radius: 14 });
  blurb.position.set(42, 146);
  card.addChild(blurbWell, blurb);

  let y = 134 + wellH + 12;
  if (showUsage) {
    const eatPill = new PIXI.Graphics();
    eatPill.lineStyle(1.4, 0x99BDCD, 0.9);
    eatPill.beginFill(0xEDF5F8, 1);
    eatPill.drawRoundedRect(28, y, cardW - 56, 36, 18);
    eatPill.endFill();
    const eat = makeLabel(`✦ ${view.eatLabel ?? '食用增益'}`, 17, INDIGO, { fontWeight: '700' });
    eat.anchor.set(0.5);
    eat.position.set(cardW / 2, y + 18);
    card.addChild(eatPill, eat);
    y += 46;
  }

  if (showStepper) {
    card.addChild(makeQtyStepper(cardW / 2, y + 22, qty, view.maxQty, opts.onQty));
    y += 58;
  }

  if (!opts.actions) return root;

  const btnW = cardW - 56;
  const btnY = cardH - 74;
  const half = Math.floor((btnW - 14) / 2);
  if (canEat) {
    const eatBtn = makeSlicedButton({
      label: '吃掉',
      width: half,
      height: 50,
      skin: 'olive',
      textColor: PAPER,
      onReady: opts.onReady,
    });
    eatBtn.position.set(28, btnY);
    eatBtn.on('pointertap', () => opts.onEat?.());
    card.addChild(eatBtn);

    const sell = makeSellChip(half, 50, unit > 0 ? goldN : 0, opts.onReady);
    sell.position.set(28 + half + 14, btnY);
    sell.on('pointertap', () => {
      if (unit <= 0) return;
      opts.onSell?.();
    });
    opts.onSellBtn?.(sell);
    card.addChild(sell);
  } else {
    const sell = makeSellChip(btnW, 50, unit > 0 ? goldN : 0, opts.onReady);
    sell.position.set(28, btnY);
    sell.on('pointertap', () => {
      if (unit <= 0) return;
      opts.onSell?.();
    });
    opts.onSellBtn?.(sell);
    card.addChild(sell);
  }
  return root;
}

export function makeQtyStepper(
  cx: number,
  cy: number,
  qty: number,
  max: number,
  onQty: (n: number) => void,
): PIXI.Container {
  const root = new PIXI.Container();
  const track = new PIXI.Graphics();
  drawRecessedWell(track, cx - 118, cy - 22, 236, 44, { radius: 22 });
  root.addChild(track);

  const minus = makeRoundBtn('－', qty > 1);
  minus.position.set(cx - 88, cy);
  minus.on('pointertap', () => {
    if (qty <= 1) return;
    onQty(qty - 1);
  });
  const plus = makeRoundBtn('＋', qty < max);
  plus.position.set(cx + 88, cy);
  plus.on('pointertap', () => {
    if (qty >= max) return;
    onQty(qty + 1);
  });
  const n = makeLabel(`${qty} / ${max}`, 22, INK, { fontWeight: '700' });
  n.anchor.set(0.5);
  n.position.set(cx, cy);
  root.addChild(minus, plus, n);
  return root;
}

function makeRoundBtn(label: string, on: boolean): PIXI.Container {
  const root = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.lineStyle(2.5, INK, 1);
  g.beginFill(on ? TERRACOTTA : 0xDFD0BC, 1);
  g.drawCircle(0, 0, 20);
  g.endFill();
  const text = makeLabel(label, 24, on ? PAPER : MUTED, { fontWeight: '700' });
  text.anchor.set(0.5);
  text.position.set(0, -1);
  root.addChild(g, text);
  root.eventMode = 'static';
  root.cursor = on ? 'pointer' : 'default';
  root.hitArea = new PIXI.Circle(0, 0, 24);
  if (on) bindUiClick(root);
  root.alpha = on ? 1 : 0.55;
  return root;
}

function makeSellChip(
  width: number,
  height: number,
  gold: number,
  onReady?: () => void,
): PIXI.Container {
  const btn = makeSlicedButton({
    label: '',
    width,
    height,
    skin: gold > 0 ? 'terracotta' : 'cream',
    onReady,
  });
  const face = ((btn as any)._face as PIXI.Container | undefined) ?? btn;
  const row = new PIXI.Container();
  row.eventMode = 'none';
  const label = makeLabel('卖出', Math.min(23, height * 0.42), gold > 0 ? PAPER : MUTED, {
    fontWeight: '700',
    ...(gold > 0 ? { stroke: INK, strokeThickness: 3 } : {}),
  });
  label.anchor.set(0, 0.5);
  row.addChild(label);
  let x = label.width + 8;
  if (gold > 0) {
    whenTextureReady(COIN, () => onReady?.());
    const coin = new PIXI.Sprite(gameTexture(COIN));
    if (isTextureReady(coin.texture)) {
      fitSpriteInBox(coin, 26, 26);
      coin.anchor.set(0, 0.5);
      coin.position.set(x, 0);
      row.addChild(coin);
      x += 30;
    }
    const n = makeLabel(String(gold), Math.min(22, height * 0.4), PAPER, {
      fontWeight: '700',
      stroke: INK,
      strokeThickness: 3,
    });
    n.anchor.set(0, 0.5);
    n.position.set(x, 0);
    row.addChild(n);
    x += n.width;
  }
  row.position.set(Math.round((width - x) / 2), height / 2 - 1);
  face.addChild(row);
  return btn;
}
