#!/usr/bin/env python3
"""用实机截图和游戏原素材拼宣传图，不重生场景、不造角色。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path("/Users/rosa/rosa_games/jiancai-rosa")
SHOT = Path("/Users/rosa/.cursor/projects/Users-rosa-rosa-games-jiancai-rosa/assets")
OUT = Path("/Users/rosa/rosa_games/game_assets/jiancai-rosa/推广")

KITCHEN_RICH = SHOT / "a3f33917a8e36d79226d28761bad7e78-e7a89cc6-427b-4dc0-8d12-776b2d3cb846.jpg"
KITCHEN_POOR = SHOT / "f65981c836c712f5a75dc8654f38b365-bb844528-b4ca-4122-877f-8c48468653b8.jpg"
MARKET = SHOT / "c0cdfd69ed06c6bc1b677cb9dd38820d-a64f4e63-1545-4e4f-a104-cb7ccd22d770.jpg"

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
if not Path(FONT).exists():
    FONT = "/System/Library/Fonts/PingFang.ttc"

WALL = (245, 232, 210)


def font(size: int, index: int = 1) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT, size, index=index)
    except Exception:
        return ImageFont.truetype(FONT, size)


def clone_patch(im: Image.Image, dest, src) -> None:
    patch = im.crop(src).resize((dest[2] - dest[0], dest[3] - dest[1]), Image.Resampling.BICUBIC)
    im.paste(patch, (dest[0], dest[1]))


def kitchen_poor() -> Image.Image:
    im = Image.open(KITCHEN_POOR).convert("RGB")
    # 只要房间中段：门、挂钩袋、水桶、小冰箱、灶，避开顶栏和 GM。
    im = im.crop((50, 188, 472, 930))
    # 冰箱升级卡用右侧墙面补掉。
    clone_patch(im, (210, 230, 410, 390), (80, 40, 200, 140))
    return im


def kitchen_rich() -> Image.Image:
    im = Image.open(KITCHEN_RICH).convert("RGB")
    im = im.crop((70, 175, 472, 930))
    # 灶前升级卡用地面补掉。
    clone_patch(im, (10, 340, 250, 520), (260, 560, 390, 700))
    return im


def market_scene() -> Image.Image:
    im = Image.open(MARKET).convert("RGB")
    # 左侧菜堆 + 中间土豆，切掉顶栏、底栏和右侧一堆卡片。
    return im.crop((0, 200, 300, 800))


def crop_cover(im: Image.Image, size: tuple[int, int], y_bias=0.45) -> Image.Image:
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    nw, nh = round(im.width * scale), round(im.height * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, min(nh - th, round((nh - th) * y_bias)))
    return im.crop((left, top, left + tw, top + th))


def paste_center(dst: Image.Image, src: Image.Image, cx: int, cy: int, max_w: int) -> None:
    src = src.convert("RGBA")
    scale = max_w / src.width
    src = src.resize((max_w, max(1, round(src.height * scale))), Image.Resampling.LANCZOS)
    dst.paste(src, (int(cx - src.width / 2), int(cy - src.height / 2)), src)


def add_flare(dst: Image.Image, path: Path, cx: int, cy: int, size: int, alpha=0.7) -> None:
    flare = Image.open(path).convert("RGBA")
    flare = flare.resize((size, size), Image.Resampling.LANCZOS)
    a = flare.split()[3].point(lambda p: int(p * alpha))
    flare.putalpha(a)
    dst.paste(flare, (cx - size // 2, cy - size // 2), flare)


def draw_3d_text(base: Image.Image, text: str, cx: int, cy: int, size: int) -> None:
    f = font(size)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    bbox = dr.textbbox((0, 0), text, font=f, stroke_width=max(6, size // 10))
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = cx - w // 2 - bbox[0], cy - h // 2 - bbox[1]
    dark = (58, 36, 20, 255)
    for i in range(8, 0, -1):
        dr.text((x + i, y + i), text, font=f, fill=dark)
    sw = max(8, size // 8)
    dr.text((x, y), text, font=f, fill=(255, 214, 64, 255), stroke_width=sw, stroke_fill=dark)
    dr.text((x, y), text, font=f, fill=(255, 220, 72, 255), stroke_width=max(3, sw // 3), stroke_fill=(255, 252, 240, 255))
    dr.text((x, y), text, font=f, fill=(255, 214, 56, 255))
    base.alpha_composite(layer)


def draw_ribbon(base: Image.Image, text: str, cx: int, cy: int, width: int, height: int) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    x0, y0 = cx - width // 2, cy - height // 2
    fill = (255, 250, 240, 250)
    line = (90, 55, 30, 255)
    dr.rounded_rectangle((x0, y0, x0 + width, y0 + height), radius=height // 2, fill=fill, outline=line, width=3)
    tail = height // 2 + 10
    dr.polygon([(x0 + 4, y0 + 4), (x0 - tail, cy), (x0 + 4, y0 + height - 4)], fill=fill)
    dr.polygon([(x0 + width - 4, y0 + 4), (x0 + width + tail, cy), (x0 + width - 4, y0 + height - 4)], fill=fill)
    f = font(max(24, height - 20))
    bbox = dr.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    dr.text((cx - tw // 2 - bbox[0], cy - th // 2 - bbox[1]), text, font=f, fill=(74, 43, 24, 255))
    base.alpha_composite(layer)


def title_block(im: Image.Image, title: str, sub: str, cx: int, title_y: int, title_size: int, ribbon_w: int) -> None:
    draw_3d_text(im, title, cx, title_y, title_size)
    draw_ribbon(im, sub, cx, title_y + int(title_size * 0.85), ribbon_w, max(40, title_size // 2))


def save_jpg(im: Image.Image, path: Path, limit_kb: int, strict_lt=False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = im.convert("RGB")
    for q in range(90, 47, -3):
        rgb.save(path, "JPEG", quality=q, optimize=True, progressive=True, subsampling=2)
        ok = path.stat().st_size < limit_kb * 1024 if strict_lt else path.stat().st_size <= limit_kb * 1024
        if ok:
            print(f"{path.name}: {rgb.size[0]}x{rgb.size[1]}, {path.stat().st_size/1024:.1f}KB, q={q}")
            return
    print(f"{path.name}: FAIL {path.stat().st_size/1024:.1f}KB")


def load_rgba(rel: str) -> Image.Image:
    return Image.open(ROOT / rel).convert("RGBA")


def theme_renovate(portrait: bool) -> Image.Image:
    poor = kitchen_poor().convert("RGBA")
    rich = kitchen_rich().convert("RGBA")
    if portrait:
        canvas = Image.new("RGBA", (720, 1280), WALL)
        canvas.paste(crop_cover(poor, (720, 560), 0.35), (0, 0))
        canvas.paste(crop_cover(rich, (720, 560), 0.35), (0, 720))
        ImageDraw.Draw(canvas).rectangle((0, 548, 720, 732), fill=(255, 246, 220, 255))
        title_block(canvas, "赚钱改造", "落魄厨房变新家", 360, 640, 78, 460)
        paste_center(canvas, load_rgba("minigame/subpkg_images/hud_coin.png"), 360, 80, 84)
    else:
        canvas = Image.new("RGBA", (1280, 720), WALL)
        canvas.paste(crop_cover(poor, (620, 720), 0.4), (0, 0))
        canvas.paste(crop_cover(rich, (620, 720), 0.4), (660, 0))
        ImageDraw.Draw(canvas).rectangle((608, 0, 672, 720), fill=(255, 246, 220, 255))
        title_block(canvas, "赚钱改造", "落魄厨房变新家", 640, 600, 82, 500)
        paste_center(canvas, load_rgba("minigame/subpkg_images/hud_coin.png"), 640, 78, 84)
    return canvas


def theme_market(portrait: bool) -> Image.Image:
    raw = market_scene()
    size = (720, 1280) if portrait else (1280, 720)
    canvas = crop_cover(raw, size, 0.35).convert("RGBA")
    flare = ROOT / "minigame/subpkg_kitchen/ui_pickup_flare.png"
    potato = load_rgba("minigame/subpkg_images/potato.png")
    if portrait:
        add_flare(canvas, flare, 400, 560, 380, 0.5)
        paste_center(canvas, potato, 400, 560, 300)
        title_block(canvas, "菜场捡宝", "翻摊就有惊喜", 360, 1080, 82, 460)
    else:
        add_flare(canvas, flare, 860, 330, 340, 0.48)
        paste_center(canvas, potato, 860, 340, 260)
        title_block(canvas, "菜场捡宝", "翻摊就有惊喜", 340, 580, 78, 440)
    return canvas


def theme_chef(portrait: bool) -> Image.Image:
    raw = kitchen_rich()
    size = (720, 1280) if portrait else (1280, 720)
    canvas = crop_cover(raw, size, 0.62).convert("RGBA")
    paper = load_rgba("minigame/subpkg_kitchen/ui_recipe_paper.png")
    dish_a = load_rgba("minigame/subpkg_images/dish_tomato_egg.png")
    dish_b = load_rgba("minigame/subpkg_images/dish_stirfry.png")
    book = load_rgba("minigame/subpkg_kitchen/kitchen_dex_book.png")
    flare = ROOT / "minigame/subpkg_kitchen/ui_pickup_flare.png"
    if portrait:
        add_flare(canvas, flare, 360, 380, 300, 0.4)
        paste_center(canvas, paper, 360, 390, 360)
        paste_center(canvas, dish_a, 275, 410, 160)
        paste_center(canvas, dish_b, 450, 410, 160)
        paste_center(canvas, book, 118, 180, 120)
        title_block(canvas, "升级大厨", "解锁新菜谱", 360, 1080, 82, 430)
    else:
        add_flare(canvas, flare, 1000, 280, 280, 0.38)
        paste_center(canvas, paper, 1000, 290, 320)
        paste_center(canvas, dish_a, 915, 310, 150)
        paste_center(canvas, dish_b, 1085, 310, 150)
        paste_center(canvas, book, 150, 120, 120)
        title_block(canvas, "升级大厨", "解锁新菜谱", 340, 580, 78, 420)
    return canvas


def main() -> None:
    jobs = [
        ("landscape_01_renovate_v3_1280x720.jpg", theme_renovate(False), 200, False),
        ("portrait_01_renovate_v3_720x1280.jpg", theme_renovate(True), 200, True),
        ("landscape_02_market_v3_1280x720.jpg", theme_market(False), 200, False),
        ("portrait_02_market_v3_720x1280.jpg", theme_market(True), 200, True),
        ("landscape_03_chef_v3_1280x720.jpg", theme_chef(False), 200, False),
        ("portrait_03_chef_v3_720x1280.jpg", theme_chef(True), 200, True),
    ]
    final = OUT / "成品"
    raw = OUT / "母版"
    raw.mkdir(parents=True, exist_ok=True)
    for name, im, limit, strict in jobs:
        png = raw / name.replace(".jpg", ".png")
        im.convert("RGBA").save(png)
        save_jpg(im, final / name, limit, strict)


if __name__ == "__main__":
    main()
