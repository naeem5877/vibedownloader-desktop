"""
Draws STAND-IN base folders for systems whose real folder icon can't be extracted on a
Windows 11 machine: build/folder-bases/{win10,mac,linux}.png (1024x1024).

    python scripts/make-folder-bases.py

These are close approximations, not Apple's / Microsoft's / a distro's own artwork.
To use a real one instead, save a transparent PNG of that system's folder as
build/folder-bases/<name>.png (keep the folder inside roughly x 16-240, y 34-210 of a
256 grid, like win11.png) and just run make-folder-icon.py - do NOT re-run this script,
it would overwrite it.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'folder-bases')
S = 1024
K = S / 256  # all coordinates below are on a 256 grid


def grad(top, bottom, y0, y1):
    g = Image.new('RGBA', (S, S))
    px = g.load()
    a, b = int(y0 * K), int(y1 * K)
    for y in range(S):
        t = min(1, max(0, (y - a) / max(1, b - a)))
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        for x in range(S):
            px[x, y] = c
    return g


def rr(canvas, box, r, fill):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([int(v * K) for v in box], int(r * K), fill=255)
    canvas.paste(fill, (0, 0), m)


def poly(canvas, pts, fill):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).polygon([(int(x * K), int(y * K)) for x, y in pts], fill=255)
    canvas.paste(fill, (0, 0), m)


def shadow(canvas, box, r, alpha, blur, dy):
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([int(v * K) for v in box], int(r * K), fill=(0, 0, 0, alpha))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur * K)), (0, int(dy * K)))


def highlight(canvas, box, r, rgba):
    h = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(h).rounded_rectangle([int(v * K) for v in box], int(r * K), fill=rgba)
    canvas.alpha_composite(h.filter(ImageFilter.GaussianBlur(0.6 * K)))


def win10():
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    back = grad((240, 190, 60), (226, 168, 36), 34, 210)
    # back panel with its tab (Windows 10: nearly square corners, slanted tab)
    poly(c, [(16, 38), (22, 34), (98, 34), (108, 46), (234, 46), (240, 52), (240, 204), (234, 210), (22, 210), (16, 204)], back)
    front = grad((255, 232, 150), (255, 208, 84), 60, 210)
    rr(c, (16, 60, 240, 210), 3, front)
    highlight(c, (17, 61, 239, 64), 1, (255, 246, 205, 200))
    return c


def mac():
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow(c, (20, 60, 236, 212), 16, 90, 5, 3)
    back = grad((88, 178, 246), (46, 134, 224), 34, 210)
    rr(c, (16, 34, 108, 90), 14, back)       # tab
    rr(c, (16, 50, 240, 206), 16, back)      # back body
    front = grad((126, 204, 252), (62, 164, 244), 66, 210)
    rr(c, (16, 68, 240, 210), 16, front)
    highlight(c, (22, 70, 234, 74), 2, (230, 246, 255, 170))
    return c


def linux():
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    back = grad((78, 142, 232), (53, 132, 228), 34, 210)
    rr(c, (16, 34, 112, 88), 12, back)
    rr(c, (16, 48, 240, 206), 12, back)
    front = grad((153, 193, 241), (98, 160, 234), 64, 210)
    rr(c, (16, 66, 240, 210), 12, front)
    highlight(c, (22, 68, 234, 71), 2, (255, 255, 255, 120))
    return c


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('win10', win10), ('mac', mac), ('linux', linux)):
        fn().save(os.path.join(OUT, name + '.png'))
        print('wrote', name + '.png')
