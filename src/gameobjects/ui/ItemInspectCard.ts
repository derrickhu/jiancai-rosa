import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import {
  fridgeItemBlurb,
  fridgeItemName,
  fridgeItemQty,
  fridgeItemUnitPrice,
  fridgeKind,
  getItem,
  recipeById,
  recipeEatStamina,
  recipeSellPrice,
  sellPrice,
  type FridgeItem,
  type Quality,
  type RecipeId,
} from '@/sim';
import { FONT, bindUiClick, fillRect, makeLabel, makeQtyMark } from '@/utils/ui';
import {
  dishTexture,
  fitSpriteInBox,
  gameTexture,
  isTextureReady,
  itemLookTexture,
  whenTextureReady,
} from '@/utils/assets';

const INK = 0x2A2018;
const CREAM = 0xF6EDE0;
const PAPER = 0xFFF8F0;
const TERRACOTTA = 0xC46A3A;
const MUTED = 0x8A6A40;
const INDIGO = 0x3D6A82;
const COIN = 'subpkg_images/hud_coin.png';
const BTN = {
  cream: 'subpkg_kitchen/ui_fridge_btn_cream.png',
  terracotta: 'subpkg_kitchen/ui_fridge_btn_terracotta.png',
} as const;

export interface ItemInspectView {
  title: string;
  blurb: string;
  kind: 'food' | 'dish';
  defId: string;
  quality: Quality;
  unitPrice: number;
  maxQty: number;
  eatStamina?: number;
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
    unitPrice: fridgeItemUnitPrice(it),
    maxQty: fridgeItemQty(it),
    eatStamina: recipe ? recipeEatStamina(recipe) : undefined,
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
    unitPrice: recipeSellPrice(id),
    maxQty: 1,
    eatStamina: recipeEatStamina(recipe),
  };
}

export function inspectFromItem(id: string): ItemInspectView | null {
  try {
    const def = getItem(id);
    return {
      title: def.name,
      blurb: def.blurb,
      kind: 'food',
      defId: id,
      quality: 'common',
      unitPrice: sellPrice(id, 'common', true),
      maxQty: 1,
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
}): PIXI.Container {
  const view = opts.view;
  const qty = Math.max(1, Math.min(view.maxQty, Math.floor(opts.qty)));
  const root = new PIXI.Container();
  const w = Game.designWidth;
  const h = Game.logicHeight;
  const dim = new PIXI.Graphics();
  fillRect(dim, 0, 0, w, h, 0x000000);
  dim.alpha = 0.35;
  dim.eventMode = 'static';
  dim.on('pointertap', opts.onClose);
  root.addChild(dim);

  const canEat = view.kind === 'dish' && (view.eatStamina ?? 0) > 0;
  const showStepper = opts.actions && view.maxQty > 1;
  const cardW = Math.min(520, w - 64);
  const cardH = opts.actions ? (showStepper || canEat ? 428 : 388) : 320;
  const card = new PIXI.Container();
  card.position.set((w - cardW) / 2, (h - cardH) / 2);
  card.eventMode = 'static';
  card.hitArea = new PIXI.Rectangle(0, 0, cardW, cardH);
  card.on('pointertap', (e) => e.stopPropagation());
  root.addChild(card);

  const plate = new PIXI.Graphics();
  plate.lineStyle(4, INK, 1);
  plate.beginFill(CREAM);
  plate.drawRoundedRect(0, 0, cardW, cardH, 22);
  plate.endFill();
  plate.beginFill(PAPER);
  plate.drawRoundedRect(12, 12, cardW - 24, cardH - 24, 16);
  plate.endFill();
  card.addChild(plate);

  const iconBox = 88;
  const iconHost = new PIXI.Container();
  const iconBg = new PIXI.Graphics();
  iconBg.lineStyle(2, INK, 0.25);
  iconBg.beginFill(0xE8DFD0, 0.7);
  iconBg.drawRoundedRect(0, 0, iconBox, iconBox, 16);
  iconBg.endFill();
  iconHost.addChild(iconBg);
  if (view.kind === 'dish') {
    const path = `subpkg_images/dish_${view.defId}.png`;
    whenTextureReady(path, () => opts.onReady?.());
    const icon = new PIXI.Sprite(dishTexture(view.defId));
    fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
    icon.anchor.set(0.5);
    icon.position.set(iconBox / 2, iconBox / 2);
    iconHost.addChild(icon);
  } else {
    const look = view.quality === 'rotten' ? 'rotten' as const : 'clean' as const;
    const icon = new PIXI.Sprite(itemLookTexture(view.defId, look));
    fitSpriteInBox(icon, iconBox - 16, iconBox - 16);
    icon.anchor.set(0.5);
    icon.position.set(iconBox / 2, iconBox / 2);
    iconHost.addChild(icon);
  }
  iconHost.position.set(28, 28);
  if (view.maxQty > 1) {
    const n = makeQtyMark(view.maxQty, 20);
    n.anchor.set(1, 1);
    n.position.set(iconBox - 4, iconBox - 2);
    iconHost.addChild(n);
  }
  card.addChild(iconHost);

  const name = makeLabel(view.title, 28, INK, { fontWeight: '700' });
  name.position.set(132, 36);
  card.addChild(name);

  const unit = view.unitPrice;
  const goldN = unit * qty;
  if (unit > 0) {
    const gold = makeLabel(`售价  ${unit}`, 22, TERRACOTTA, { fontWeight: '700' });
    gold.position.set(132, 78);
    card.addChild(gold);
    whenTextureReady(COIN, () => opts.onReady?.());
    const coinTex = gameTexture(COIN);
    if (isTextureReady(coinTex)) {
      const coin = new PIXI.Sprite(coinTex);
      fitSpriteInBox(coin, 32, 32);
      coin.anchor.set(0, 0.5);
      coin.position.set(132 + gold.width + 6, 90);
      coin.eventMode = 'none';
      card.addChild(coin);
    }
  } else {
    const gold = makeLabel('坏了，卖不掉', 22, MUTED, { fontWeight: '700' });
    gold.position.set(132, 78);
    card.addChild(gold);
  }

  const blurb = new PIXI.Text(view.blurb, {
    fontFamily: FONT,
    fontSize: 22,
    fill: MUTED,
    fontWeight: '500',
    wordWrap: true,
    breakWords: true,
    wordWrapWidth: cardW - 56,
    lineHeight: 34,
  });
  blurb.position.set(28, 136);
  blurb.eventMode = 'none';
  card.addChild(blurb);

  let y = 136 + Math.min(88, blurb.height) + 16;
  if (canEat) {
    const eat = makeLabel(`食用  体力+${view.eatStamina}`, 24, INDIGO, {
      fontFamily: 'Kaiti SC, STKaiti, Songti SC, STSong, serif',
      fontWeight: '700',
    });
    eat.position.set(28, y);
    card.addChild(eat);
    y += 38;
  }

  if (showStepper) {
    card.addChild(makeStepper(cardW / 2, y + 22, qty, view.maxQty, opts.onQty));
    y += 64;
  }

  if (!opts.actions) return root;

  const btnW = cardW - 56;
  const btnY = cardH - 68;
  const half = (btnW - 12) / 2;
  const sell = makeSellChip(canEat ? half : btnW, 48, unit > 0 ? goldN : 0, opts.onReady);
  sell.position.set(28, btnY);
  sell.on('pointertap', () => {
    if (unit <= 0) return;
    opts.onSell?.();
  });
  card.addChild(sell);
  if (canEat) {
    const eatBtn = makeChip('吃掉', half, 48, 'primary');
    eatBtn.position.set(28 + half + 12, btnY);
    eatBtn.on('pointertap', () => opts.onEat?.());
    card.addChild(eatBtn);
  }
  return root;
}

function makeStepper(
  cx: number,
  cy: number,
  qty: number,
  max: number,
  onQty: (n: number) => void,
): PIXI.Container {
  const root = new PIXI.Container();
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
  const n = makeLabel(String(qty), 30, INK, { fontWeight: '700' });
  n.anchor.set(0.5);
  n.position.set(cx, cy);
  root.addChild(minus, plus, n);
  return root;
}

function makeRoundBtn(label: string, on: boolean): PIXI.Container {
  const root = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.lineStyle(3, INK, 1);
  g.beginFill(on ? TERRACOTTA : 0xE4D4BE);
  g.drawCircle(0, 0, 22);
  g.endFill();
  const text = makeLabel(label, 26, on ? PAPER : MUTED, { fontWeight: '700' });
  text.anchor.set(0.5);
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
  const root = makeChipSkin(width, height, gold > 0 ? 'primary' : 'idle');
  const row = new PIXI.Container();
  const label = makeLabel('卖出', Math.min(24, height * 0.44), gold > 0 ? PAPER : MUTED, { fontWeight: '700' });
  label.anchor.set(0, 0.5);
  row.addChild(label);
  let x = label.width + 8;
  if (gold > 0) {
    whenTextureReady(COIN, () => onReady?.());
    const coin = new PIXI.Sprite(gameTexture(COIN));
    if (isTextureReady(coin.texture)) {
      fitSpriteInBox(coin, 26, 26);
      coin.anchor.set(0, 0.5);
      coin.eventMode = 'none';
      coin.position.set(x, 0);
      row.addChild(coin);
      x += 30;
    }
    const n = makeLabel(String(gold), Math.min(22, height * 0.4), PAPER, { fontWeight: '700' });
    n.anchor.set(0, 0.5);
    n.position.set(x, 0);
    row.addChild(n);
    x += n.width;
  }
  row.position.set((width - x) / 2, height / 2 + 1);
  root.addChild(row);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, width, height);
  bindUiClick(root);
  return root;
}

function makeChipSkin(width: number, height: number, kind: 'primary' | 'idle'): PIXI.Container {
  const path = kind === 'primary' ? BTN.terracotta : BTN.cream;
  const root = new PIXI.Container();
  whenTextureReady(path, () => {});
  const tex = gameTexture(path);
  if (isTextureReady(tex)) {
    const tw = tex.width;
    const th = tex.height;
    const cap = Math.min(Math.floor(th * 0.5), Math.floor(tw * 0.34));
    const midW = Math.max(1, tw - cap * 2);
    const left = new PIXI.Sprite(new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(0, 0, cap, th)));
    const mid = new PIXI.Sprite(new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(cap, 0, midW, th)));
    const right = new PIXI.Sprite(new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tw - cap, 0, cap, th)));
    const capW = cap * (height / th);
    left.height = height;
    left.width = capW;
    right.height = height;
    right.width = capW;
    right.x = width - capW;
    mid.height = height;
    mid.x = capW;
    mid.width = Math.max(1, width - capW * 2);
    left.eventMode = mid.eventMode = right.eventMode = 'none';
    root.addChild(left, mid, right);
  } else {
    const bg = new PIXI.Graphics();
    bg.lineStyle(3, INK, 1);
    bg.beginFill(kind === 'primary' ? TERRACOTTA : 0xE4D4BE);
    bg.drawRoundedRect(0, 0, width, height, height / 2);
    bg.endFill();
    root.addChild(bg);
  }
  return root;
}

function makeChip(label: string, width: number, height: number, kind: 'primary' | 'idle'): PIXI.Container {
  const root = makeChipSkin(width, height, kind);
  const text = makeLabel(label, Math.min(24, height * 0.44), kind === 'primary' ? PAPER : MUTED, { fontWeight: '700' });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2 + 1);
  root.addChild(text);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new PIXI.Rectangle(0, 0, width, height);
  bindUiClick(root);
  return root;
}
