# Cuts ALAN's seated painting and its face frames (Canva exports, grey background) into the kit the page uses.
import os
import sys
from collections import deque
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
OUT = sys.argv[1]
HEAD = (540, 20, 1000, 470)      # replaced whole for expressions; fades out over the last 50 px
MOUTH = (640, 236, 900, 440)     # mouth, lower cheeks and chin: all that changes while he speaks
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
    # Grey caught between locks of hair, and the grey fringe the painting's soft edges leave:
    # near the background, anything close to its colour goes too, and edge pixels are unmixed from it.
    grown = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(31))) > 0
    dist = np.abs(a - bg).sum(2)
    m |= grown & (dist < 70) & (np.ptp(a, axis=2) < 26)
    band = (np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0) & ~m
    alpha = np.where(m, 0.0, 1.0)
    alpha[band] = np.clip((dist[band] - 40) / 110.0, 0.0, 1.0)
    al = alpha[..., None]
    rgb = np.where(al > 0.05, (a - (1 - al) * bg) / np.maximum(al, 0.05), a)
    out = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    out.putalpha(out.getchannel('A').filter(ImageFilter.GaussianBlur(0.6)))
    return out

body = cut('seated.png'); body.save(f'{OUT}/body.webp', quality=92, alpha_quality=100, method=6)
w, h = HEAD[2] - HEAD[0], HEAD[3] - HEAD[1]
fade = np.ones((h, w)); fade[h - 50:] = np.linspace(1, 0, 50)[:, None]
frames = {n: f'kit/{n}.png' for n in ['think', 'listen', 'alarm', 'smirk', 'laugh', 'shy']}
for name, path in frames.items():
    p = cut(path).crop(HEAD); a = np.asarray(p).copy()
    a[..., 3] = (a[..., 3] * fade).astype(np.uint8)
    Image.fromarray(a).save(f'{OUT}/{name}.webp', quality=92, alpha_quality=100, method=6)
e = Image.open('kit/blink.png').convert('RGBA').crop(EYES)
mask = Image.new('L', e.size, 0); ImageDraw.Draw(mask).ellipse((14, 12, e.width - 14, e.height - 12), fill=255)
e.putalpha(mask.filter(ImageFilter.GaussianBlur(9))); e.save(f'{OUT}/blink.webp', quality=92, alpha_quality=100, method=6)

# Mouth shapes (Rhubarb's A-H; A is the painting itself): only the mouth is cut out, with a soft edge,
# so the eyes, brows and hair of the one neutral face stay perfectly still while he speaks.
mw, mh = MOUTH[2] - MOUTH[0], MOUTH[3] - MOUTH[1]
soft = Image.new('L', (mw, mh), 0); ImageDraw.Draw(soft).ellipse((22, 18, mw - 22, mh - 14), fill=255)
soft = soft.filter(ImageFilter.GaussianBlur(14))
for shape, source in {'B': 'B2', 'C': 'C2', 'D': 'D2', 'E': 'E', 'F': 'F', 'G': 'G', 'H': 'H'}.items():
    m = Image.open(f'kit/{source}.png').convert('RGBA').crop(MOUTH); m.putalpha(soft)
    m.save(f'{OUT}/m_{shape}.webp', quality=94, alpha_quality=100, method=6)

# Whole figures for what he does when nobody is talking to him.
for name in ('read', 'coffee', 'sip', 'smoke', 'drag', 'light', 'stretch', 'write'):
    if not os.path.exists(f'kit/{name}.png'): continue
    cut(f'kit/{name}.png').save(f'{OUT}/{name}.webp', quality=92, alpha_quality=100, method=6)
for name in ('room_day', 'room_dusk'):
    Image.open(f'kit/{name}.png').convert('RGB').save(f'{OUT}/../{name}.jpg', quality=88)
