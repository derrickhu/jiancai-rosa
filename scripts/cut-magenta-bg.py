#!/usr/bin/env python3
"""抠掉等距 sprite 的纯色底，裁到内容外接框。

键色从四角采样，不写死 #FF00FF——生图模型给的「品红」实际常落在 #DC028C 一带，
写死会一个像素都抠不掉。

去键是全图的，不只挖和画布边缘连通的那片：摊位的棚顶下、货架格子里都是被物件围住
的背景洞，只做连通判定会留一块品红在图里。代价是画面内不能出现同色内容——所以色板
里禁止玫红/品红，出图时也不许给物件用这个色。

用法：cut-magenta-bg.py <src.png|src_dir> <dst_dir> [max_edge]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

MAX_EDGE = 512
TOL = 60


def alpha_of(rgb: np.ndarray) -> Image.Image:
    corners = np.concatenate([rgb[:8, :8], rgb[:8, -8:], rgb[-8:, :8], rgb[-8:, -8:]]).reshape(-1, 3)
    key = np.median(corners, axis=0)
    bg = np.abs(rgb - key).max(axis=2) <= TOL

    # 抗锯齿边是物件色和键色的混色，留着会发紫，往里收一像素直接切掉
    keep = ndimage.binary_erosion(~bg, iterations=1)
    a = Image.fromarray(np.where(keep, 255, 0).astype(np.uint8), 'L')
    return a.filter(ImageFilter.GaussianBlur(0.6)).point(lambda v: 0 if v < 40 else v)


def cut(src: str, dst: str, max_edge: int) -> None:
    im = Image.open(src).convert('RGB')
    out = im.convert('RGBA')
    out.putalpha(alpha_of(np.asarray(im).astype(np.int16)))

    box = out.getbbox()
    if box:
        out = out.crop(box)
    if max(out.size) > max_edge:
        k = max_edge / max(out.size)
        out = out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS)

    out.save(dst)
    print(f'{os.path.basename(dst)} {out.width}x{out.height}')


if __name__ == '__main__':
    src, dst_dir = sys.argv[1], sys.argv[2]
    max_edge = int(sys.argv[3]) if len(sys.argv) > 3 else MAX_EDGE
    os.makedirs(dst_dir, exist_ok=True)
    srcs = [src] if os.path.isfile(src) else [
        os.path.join(src, n) for n in sorted(os.listdir(src)) if n.endswith('.png')
    ]
    for p in srcs:
        cut(p, os.path.join(dst_dir, os.path.basename(p)), max_edge)
