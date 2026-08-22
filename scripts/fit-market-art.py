#!/usr/bin/env python3
"""把新菜场底图 / 卡面 / 目的地缩略图压成和现有资源一样的 JPG。"""
import os
import sys

from PIL import Image


def jpg(src: str, dst: str, size: tuple[int, int], quality: int) -> None:
    im = Image.open(src).convert('RGB')
    im = im.resize(size, Image.LANCZOS)
    im.save(dst, 'JPEG', quality=quality, optimize=True)
    print(f'{os.path.basename(dst)} {im.size} {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    assets = sys.argv[2]
    out = os.path.join(root, 'minigame/subpkg_images')

    jpg(os.path.join(assets, 'dest_shanwu.png'), os.path.join(out, 'dest_shanwu.jpg'), (640, 360), 82)
    jpg(os.path.join(assets, 'dest_laocheng.png'), os.path.join(out, 'dest_laocheng.jpg'), (640, 360), 82)
    jpg(os.path.join(assets, 'market_cards_shanwu.png'), os.path.join(out, 'market_cards_shanwu.jpg'), (960, 873), 80)
    jpg(os.path.join(assets, 'market_cards_laocheng.png'), os.path.join(out, 'market_cards_laocheng.jpg'), (960, 873), 80)

    route_shanwu = os.path.join(assets, 'market_route_shanwu_v2.png')
    if not os.path.exists(route_shanwu):
        route_shanwu = os.path.join(assets, 'market_route_shanwu.png')
    jpg(route_shanwu, os.path.join(out, 'market_route_shanwu.jpg'), (576, 1024), 80)
    jpg(os.path.join(assets, 'market_route_laocheng.png'), os.path.join(out, 'market_route_laocheng.jpg'), (576, 1024), 80)
