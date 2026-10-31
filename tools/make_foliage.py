#!/usr/bin/env python3
"""Build the tree textures from CC0 ambientCG scans (see CREDITS.md).

    python3 -I tools/make_foliage.py <folder with the unzipped LeafSet009, LeafSet010 and Bark012> assets/textures

Writes foliage/leaves.png: two 512 px leafy twigs side by side (left: LeafSet009, rounded leaves; right: LeafSet010,
maple leaves), composed from the scanned leaves with small colour shifts, the leaves at the back darker. Transparent
pixels keep the average leaf colour so mipmaps do not grow dark fringes. Also writes bark/color.jpg and
bark/normal.jpg (Bark012 at 512 px).
"""
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

TILE = 512


def leaves_of(folder, name):
    """Cut each leaf of an ambientCG leaf atlas out by the empty rows and columns between them."""
    color = Image.open(folder / name / f'{name}_1K-JPG_Color.jpg').convert('RGB')
    alpha = Image.open(folder / name / f'{name}_1K-JPG_Opacity.jpg').convert('L')
    mask = np.array(alpha) > 128

    def bands(idx):
        out, start, prev = [], idx[0], idx[0]
        for i in idx[1:]:
            if i > prev + 3:
                out.append((start, prev))
                start = i
            prev = i
        out.append((start, prev))
        return out

    cut = []
    for c0, c1 in bands(np.where(mask.any(0))[0]):
        for r0, r1 in bands(np.where(mask[:, c0:c1 + 1].any(1))[0]):
            box = (c0, r0, c1 + 1, r1 + 1)
            leaf = color.crop(box).convert('RGBA')
            leaf.putalpha(alpha.crop(box))
            cut.append(leaf)
    return cut


def twig(leaves, rng, count, size):
    """A twig seen from the side: a curved stem with side shoots, leaves along them pointing outwards."""
    tile = Image.new('RGBA', (TILE, TILE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    stems = []
    # main stem from the bottom centre, bending a little
    base, tip = (TILE * 0.5, TILE * 0.98), (TILE * (0.5 + rng.uniform(-0.08, 0.08)), TILE * 0.12)
    stems.append((base, tip, 7))
    for k in range(7):
        t = 0.18 + k * 0.11
        p = (base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t)
        side = -1 if k % 2 else 1
        a = math.radians(rng.uniform(35, 60)) * side
        length = TILE * rng.uniform(0.24, 0.36) * (1 - t * 0.4)
        stems.append((p, (p[0] + math.sin(a) * length, p[1] - math.cos(a) * length), 4))
    for (x0, y0), (x1, y1), w in stems:
        draw.line([(x0, y0), (x1, y1)], fill=(74, 56, 38, 255), width=w)

    placed = []
    for _ in range(count):
        (x0, y0), (x1, y1), _w = stems[rng.randrange(len(stems))]
        t = rng.uniform(0.15, 1.0)
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        stem_angle = math.degrees(math.atan2(x1 - x0, -(y1 - y0)))
        angle = stem_angle + rng.choice([-1, 1]) * rng.uniform(25, 75) + rng.uniform(-15, 15)
        depth = rng.random()           # 0 = at the back
        placed.append((depth, x, y, angle))
    placed.sort()
    for depth, x, y, angle in placed:
        leaf = leaves[rng.randrange(len(leaves))]
        h = size * rng.uniform(0.8, 1.15)
        w = h * leaf.width / leaf.height
        img = leaf.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
        # colour: darker at the back, a little warmer or bluer per leaf
        arr = np.array(img).astype(np.float32)
        shade = 0.55 + 0.5 * depth
        arr[..., 0] *= shade * rng.uniform(0.85, 1.08)
        arr[..., 1] *= shade * rng.uniform(0.92, 1.05)
        arr[..., 2] *= shade * rng.uniform(0.8, 1.0)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
        # leaves grow with their stalk (bottom of the scan) at the twig
        img = img.rotate(-angle, resample=Image.BICUBIC, expand=True)
        dx = math.sin(math.radians(angle)) * h * 0.45
        dy = -math.cos(math.radians(angle)) * h * 0.45
        tile.alpha_composite(img, (int(x + dx - img.width / 2), int(y + dy - img.height / 2)))
    return tile


def bleed(img):
    """Give transparent pixels the average opaque colour (no dark fringes once mipmapped)."""
    arr = np.array(img).astype(np.float32)
    solid = arr[..., 3] > 200
    mean = arr[solid][:, :3].mean(0)
    clear = arr[..., 3] < 8
    arr[clear, :3] = mean
    return Image.fromarray(arr.astype(np.uint8), 'RGBA')


def main(src, out):
    rng = random.Random(7)
    atlas = Image.new('RGBA', (TILE * 2, TILE), (0, 0, 0, 0))
    atlas.alpha_composite(twig(leaves_of(src, 'LeafSet009'), rng, 78, 70), (0, 0))
    atlas.alpha_composite(twig(leaves_of(src, 'LeafSet010'), rng, 54, 88), (TILE, 0))
    (out / 'foliage').mkdir(parents=True, exist_ok=True)
    bleed(atlas).save(out / 'foliage' / 'leaves.png', optimize=True)

    (out / 'bark').mkdir(parents=True, exist_ok=True)
    Image.open(src / 'Bark012' / 'Bark012_1K-JPG_Color.jpg').convert('RGB').resize((TILE, TILE), Image.LANCZOS).save(out / 'bark' / 'color.jpg', quality=85)
    Image.open(src / 'Bark012' / 'Bark012_1K-JPG_NormalGL.jpg').convert('RGB').resize((TILE, TILE), Image.LANCZOS).save(out / 'bark' / 'normal.jpg', quality=90)


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
