# Cuts ALAN's seated painting and its face frames (Canva exports, grey background) into the kit the page uses.
import sys
from collections import deque
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
OUT = sys.argv[1]
HEAD = (540, 20, 1000, 470)      # replaced whole for mouth shapes and expressions; fades out over the last 50 px
EYES = (640, 160, 900, 262)      # laid over any face for a blink

def cut(path):
    s = Image.open(path).convert('RGB'); a = np.asarray(s).astype(np.int32)
    bg = a[5:40, 5:40].reshape(-1, 3).mean(0)
    near = (np.abs(a - bg).sum(2) < 40) & (np.ptp(a, axis=2) < 18)
    H, W = near.shape; m = np.zeros((H, W), bool); q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if near[y, x] and not m[y, x]: m[y, x] = True; q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if near[y, x] and not m[y, x]: m[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            v, u = y + dy, x + dx
            if 0 <= v < H and 0 <= u < W and near[v, u] and not m[v, u]: m[v, u] = True; q.append((v, u))
    alpha = Image.fromarray((~m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = s.convert('RGBA'); out.putalpha(alpha); return out

body = cut('seated.png'); body.save(f'{OUT}/body.webp', quality=92, alpha_quality=100, method=6)
w, h = HEAD[2] - HEAD[0], HEAD[3] - HEAD[1]
fade = np.ones((h, w)); fade[h - 50:] = np.linspace(1, 0, 50)[:, None]
frames = {'A': 'seated.png', **{n: f'kit/{n}.png' for n in ['B', 'C', 'D', 'E', 'F', 'think', 'listen', 'alarm', 'smirk']}}
for name, path in frames.items():
    p = cut(path).crop(HEAD); a = np.asarray(p).copy()
    a[..., 3] = (a[..., 3] * fade).astype(np.uint8)
    Image.fromarray(a).save(f'{OUT}/{name}.webp', quality=92, alpha_quality=100, method=6)
e = Image.open('kit/blink.png').convert('RGBA').crop(EYES)
mask = Image.new('L', e.size, 0); ImageDraw.Draw(mask).ellipse((14, 12, e.width - 14, e.height - 12), fill=255)
e.putalpha(mask.filter(ImageFilter.GaussianBlur(9))); e.save(f'{OUT}/blink.webp', quality=92, alpha_quality=100, method=6)
