#!/usr/bin/env python3
"""只挖掉「和画布边缘连通的白」，盘沿和奶白汤留着。

菜品图是白底上的奶油色盘子，rembg 那类模型会连汤带碗一起当背景吃掉，
所以这里改成从四边漫延的连通判定：深棕描边一圈就把盘内挡住了。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

WHITE_CUT = 238  # 比这更亮且够灰的像素才算候选背景
CHROMA_CUT = 12


def cut(src: str, dst: str) -> None:
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    bright = a.min(axis=2) >= WHITE_CUT
    flat = (a.max(axis=2) - a.min(axis=2)) <= CHROMA_CUT
    cand = bright & flat

    lab, n = ndimage.label(cand)
    edge = set(lab[0].tolist()) | set(lab[-1].tolist()) | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
    edge.discard(0)
    bg = np.isin(lab, list(edge))

    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), 'L')
    # 硬边在 64px 下会有锯齿，糊一像素再拉回来当羽化用
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8)).point(lambda v: 0 if v < 40 else v)
    out = im.convert('RGBA')
    out.putalpha(alpha)
    out.save(dst)
    print(f'{os.path.basename(dst)} cut {bg.mean() * 100:.0f}% bg')


if __name__ == '__main__':
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if name.endswith('.png'):
            cut(os.path.join(src_dir, name), os.path.join(dst_dir, name))
