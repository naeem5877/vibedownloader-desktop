"""
Builds per-platform folder icons for macOS and Linux (Windows: make-folder-icon.py).

    python scripts/make-folder-icons-all.py

  build/folder-icons-mac/<key>.icns     (+ app.icns)
  build/folder-icons-linux/<key>.png    (+ app.png)   512x512

Uses the stand-in bases in build/folder-bases/{mac,linux}.png (1024 px, 256 grid).
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASES = os.path.join(ROOT, 'build', 'folder-bases')
SRC_DIR = os.path.join(ROOT, 'platfrome-icons')
APP_LOGO = os.path.join(ROOT, 'public', 'logo.png')
PLATFORMS = {
    'youtube': 'youtube.png', 'instagram': 'instagram.png', 'tiktok': 'tiktok.png',
    'facebook': 'facebook.png', 'spotify': 'spotify.png', 'x': 'x.png',
    'pinterest': 'pintarest.png', 'soundcloud': 'soundcloud.png', 'twitch': 'twitch.png',
}
S = 1024
K = S / 256
MAX_W, MAX_H = 124 * K, 108 * K
CX, CY = 188 * K, 168 * K


def make(base_name, logo_path):
    canvas = Image.open(os.path.join(BASES, base_name + '.png')).convert('RGBA')
    logo = Image.open(logo_path).convert('RGBA')
    logo = logo.crop(logo.getbbox())
    k = min(MAX_W / logo.width, MAX_H / logo.height)
    w, h = max(1, round(logo.width * k)), max(1, round(logo.height * k))
    while logo.width > w * 2:
        logo = logo.resize((logo.width // 2, logo.height // 2), Image.LANCZOS)
    logo = logo.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, (round(CX - w / 2), round(CY - h / 2)))
    return canvas


def out(base, ext, fmt, size=None):
    d = os.path.join(ROOT, 'build', 'folder-icons-' + ('mac' if base == 'mac' else 'linux'))
    os.makedirs(d, exist_ok=True)
    return d


if __name__ == '__main__':
    jobs = [('app', APP_LOGO)] + [(k, os.path.join(SRC_DIR, v)) for k, v in PLATFORMS.items()]
    for key, src in jobs:
        if not os.path.exists(src):
            print('skipped', key); continue
        m = make('mac', src)
        d = out('mac', 'icns', 'ICNS'); m.save(os.path.join(d, key + '.icns'), format='ICNS')
        l = make('linux', src).resize((512, 512), Image.LANCZOS)
        d = out('linux', 'png', 'PNG'); l.save(os.path.join(d, key + '.png'))
        print('wrote', key)
