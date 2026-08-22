#!/usr/bin/env python3
"""把抠好底的菜品图裁边后放进 512x512 方画布，再压成调色板图。

仓库里已有的 dish_*.png 都是 512 见方、盘子居中留边，新菜必须一样，
不然烹饪页和图鉴里盘子大小会一张一个样。
"""
import os
import subprocess
import sys

from PIL import Image

CANVAS = 512
FILL = 0.94
ALPHA_CUT = 8


def fit(src: str, dst: str) -> None:
    im = Image.open(src).convert('RGBA')
    alpha = im.getchannel('A').point(lambda v: 255 if v > ALPHA_CUT else 0)
    box = alpha.getbbox()
    if box:
        im = im.crop(box)
    w, h = im.size
    scale = CANVAS * FILL / max(w, h)
    im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2), im)
    out.save(dst)
    subprocess.run(
        ['pngquant', '--force', '--skip-if-larger', '--quality', '60-92', '--output', dst, dst],
        check=False,
    )
    print(f'{os.path.basename(dst)} {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if name.endswith('.png'):
            fit(os.path.join(src_dir, name), os.path.join(dst_dir, name))
