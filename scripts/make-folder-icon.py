"""
Builds the folder icons Windows shows for the VibeDownloader folders:
the standard yellow Windows folder with only a logo at the bottom-right.

    python scripts/make-folder-icon.py

  build/folder-icon.ico            VibeDownloader folder (public/logo.png)
  build/folder-icons/<platform>.ico  one per platform folder (platfrome-icons/*.png)

Needs Pillow. The base folder is build/windows-folder-base.png, the real Windows
folder icon (extracted from imageres.dll). Logos come in all sizes and margins, so each
one is trimmed to its visible edges and scaled to the same footprint before placing.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'build', 'windows-folder-base.png')
APP_LOGO = os.path.join(ROOT, 'public', 'logo.png')
SRC_DIR = os.path.join(ROOT, 'platfrome-icons')
OUT_APP = os.path.join(ROOT, 'build', 'folder-icon.ico')
OUT_DIR = os.path.join(ROOT, 'build', 'folder-icons')

# platform key (matches electron/utils/paths.ts) -> source file name
PLATFORMS = {
    'youtube': 'youtube.png',
    'instagram': 'instagram.png',
    'tiktok': 'tiktok.png',
    'facebook': 'facebook.png',
    'spotify': 'spotify.png',
    'x': 'x.png',
    'pinterest': 'pintarest.png',
    'soundcloud': 'soundcloud.png',
    'twitch': 'twitch.png',
}

S = 256
MAX_W, MAX_H = 124, 108   # every logo is scaled to fit this footprint
CX, CY = 188, 168         # footprint centre: bottom-right of the folder
SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]


def make(logo_path):
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(Image.open(BASE).convert('RGBA'))

    logo = Image.open(logo_path).convert('RGBA')
    logo = logo.crop(logo.getbbox())            # drop empty margins
    k = min(MAX_W / logo.width, MAX_H / logo.height)
    w, h = max(1, round(logo.width * k)), max(1, round(logo.height * k))
    # Shrink in two steps for very large sources, so edges stay clean.
    while logo.width > w * 2:
        logo = logo.resize((logo.width // 2, logo.height // 2), Image.LANCZOS)
    logo = logo.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, (CX - w // 2, CY - h // 2))
    return canvas


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, format='ICO', sizes=SIZES)
    print('wrote', os.path.relpath(path, ROOT), os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    save(make(APP_LOGO), OUT_APP)
    for key, name in PLATFORMS.items():
        src = os.path.join(SRC_DIR, name)
        if not os.path.exists(src):
            print('skipped', key, '(missing', name + ')')
            continue
        save(make(src), os.path.join(OUT_DIR, key + '.ico'))
