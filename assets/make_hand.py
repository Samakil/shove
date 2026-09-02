#!/usr/bin/env python3
"""Drain-theme shove hand.

Still frame: hand.png
Sheet:       hand_sheet.png  (6 frames, 512 each, left to right)
Preview gif: hand_shove.gif
"""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 512
FILL = (232, 232, 236, 255)
NAIL = (200, 200, 206, 255)
DIR = "."


def capsule(draw, a, b, radius, fill):
    r = int(radius)
    draw.line([a, b], fill=fill, width=max(2, r * 2))
    for p in (a, b):
        draw.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=fill)


def ellipse_c(draw, cx, cy, rx, ry, fill):
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=fill)


def finger(draw, base, angle_deg, length, thick, fill, nail):
    ang = math.radians(angle_deg)
    tip = (base[0] + math.cos(ang) * length, base[1] + math.sin(ang) * length)
    mid = (
        base[0] + math.cos(ang) * length * 0.52,
        base[1] + math.sin(ang) * length * 0.52,
    )
    capsule(draw, base, mid, thick, fill)
    capsule(draw, mid, tip, thick * 0.86, fill)
    ellipse_c(draw, base[0], base[1], thick + 3, thick + 2, fill)
    nx = tip[0] + math.cos(ang) * thick * 0.12
    ny = tip[1] + math.sin(ang) * thick * 0.12
    ellipse_c(draw, nx, ny, thick * 0.68, thick * 0.48, nail)


POSES = [
    ("rest",   1.00, 1.00, 0,    0),
    ("gather", 0.62, 0.94, 8,   -6),
    ("coil",   0.38, 0.86, 22, -12),
    ("strike", 1.18, 1.16, -18,  10),
    ("splay",  1.32, 1.08, -8,   16),
    ("settle", 1.06, 1.02, -2,    4),
]


def pose_frame(name, spread, length_m, wrist_pull, thumb_extra, size=SIZE):
    s = size * 2
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = s / 2.0

    palm = (cx - 8 + wrist_pull, cy + 4)
    ellipse_c(d, palm[0], palm[1], 132, 108, FILL)

    wrist_end = (palm[0] - 210, palm[1] + 6)
    capsule(d, (palm[0] - 90, palm[1] + 4), wrist_end, 56, FILL)
    ellipse_c(d, wrist_end[0], wrist_end[1], 62, 54, FILL)

    origin_x = palm[0] + 78
    specs = [
        (-28, 248, 30, -58),
        (-9, 278, 34, -16),
        (10, 262, 32, 26),
        (30, 214, 27, 64),
    ]
    for ang, length, thick, yoff in specs:
        base = (origin_x + 6, palm[1] + yoff)
        finger(d, base, ang * spread, length * length_m, thick, FILL, NAIL)

    thumb_base = (palm[0] - 10, palm[1] + 78)
    finger(d, thumb_base, 52 + thumb_extra, 168 * (0.92 + 0.08 * length_m), 32, FILL, NAIL)

    im = im.filter(ImageFilter.GaussianBlur(radius=0.45))
    im = im.resize((size, size), Image.Resampling.LANCZOS)
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 18:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (232, 232, 236, a)
    return im


def make_sheet(frames, size=SIZE):
    n = len(frames)
    out = Image.new("RGBA", (size * n, size), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        out.paste(fr, (i * size, 0), fr)
    return out


def preview_on_dark(im):
    bg = Image.new("RGBA", im.size, (11, 13, 18, 255))
    bg.alpha_composite(im)
    return bg.convert("P", palette=Image.ADAPTIVE, colors=64)


def main():
    frames = []
    named = {}
    for name, spread, length_m, wrist_pull, thumb_extra in POSES:
        fr = pose_frame(name, spread, length_m, wrist_pull, thumb_extra)
        frames.append(fr)
        named[name] = fr
        fr.save(f"{DIR}/hand_{name}.png", "PNG")

    named["rest"].save(f"{DIR}/hand.png", "PNG")
    make_sheet(frames).save(f"{DIR}/hand_sheet.png", "PNG")

    gif_order = [0, 0, 1, 2, 3, 4, 5, 5, 0]
    gif_frames = [preview_on_dark(frames[i]) for i in gif_order]
    gif_frames[0].save(
        f"{DIR}/hand_shove.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=[280, 80, 70, 55, 70, 90, 120, 180, 240],
        loop=0,
        disposal=2,
        optimize=False,
    )
    print("frames:", [p[0] for p in POSES])
    print("wrote hand.png hand_sheet.png hand_shove.gif")


if __name__ == "__main__":
    main()
