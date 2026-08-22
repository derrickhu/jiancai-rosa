#!/usr/bin/env python3
"""把抠好底的素材裁边、缩到长边 320，输出到目标目录，再交给 pngquant 压成调色板图。

仓库里已有的食材图都是这个规格，新图必须对齐，不然摊位上大小和文件体积都对不上。
"""
import os
import subprocess
import sys

from PIL import Image

LONG_SIDE = 320
ALPHA_CUT = 8


def fit(src: str, dst: str) -> None:
    im = Image.open(src).convert('RGBA')
    alpha = im.getchannel('A').point(lambda v: 255 if v > ALPHA_CUT else 0)
    box = alpha.getbbox()
    if box:
        im = im.crop(box)
    w, h = im.size
    scale = LONG_SIDE / max(w, h)
    im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    im.save(dst)
    subprocess.run(
        ['pngquant', '--force', '--skip-if-larger', '--quality', '60-92', '--output', dst, dst],
        check=False,
    )
    print(f'{os.path.basename(dst)} {im.size} {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if name.endswith('.png'):
            fit(os.path.join(src_dir, name), os.path.join(dst_dir, name))
