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

# Patches laid over the one neutral face: the mouth (Rhubarb's shapes; A, the smile, is the painting itself;
# N is a calm closed mouth for pauses in speech) and the eyes (half-closed lids, glances, raised brows).
# Each is sharpened and its colours matched to the body painting, so it does not show as a softer, different
# patch, and it is kept inside the body's own outline, so no grey from the generated picture's background shows.
body_rgba = np.asarray(body).astype(np.float32)

def patch(source, box, soft, name):
    if not os.path.exists(source): return
    whole = Image.open(source).convert('RGB')
    # A generated painting can sit a few pixels off the body: find where its cheeks and chin match best.
    g = np.asarray(whole.convert('L')).astype(np.float32)
    r = np.asarray(body.convert('L')).astype(np.float32)[box[1]:box[3], box[0]:box[2]]
    w, h = box[2] - box[0], box[3] - box[1]
    ring = np.ones((h, w), bool); ring[int(h * .2):int(h * .83), int(w * .19):int(w * .81)] = False
    shift = min(((np.abs(g[box[1] + dy:box[3] + dy, box[0] + dx:box[2] + dx] - r)[ring].mean(), dx, dy)
                 for dy in range(-6, 7) for dx in range(-6, 7)))[1:]
    p = whole.crop((box[0] + shift[0], box[1] + shift[1], box[2] + shift[0], box[3] + shift[1]))
    edges = lambda im: np.asarray(im.convert('L').filter(ImageFilter.FIND_EDGES)).astype(np.float32).var()
    if edges(p) < 0.7 * edges(body.convert('RGB').crop(box)):   # a softer picture than the body: sharpen it to match
        p = p.filter(ImageFilter.UnsharpMask(radius=2.2, percent=170, threshold=2))
    a = np.asarray(p).astype(np.float32)
    ref = body_rgba[box[1]:box[3], box[0]:box[2]]
    m = np.asarray(soft).astype(np.float32) / 255 * (ref[..., 3] / 255)
    yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
    cy, cx = m.shape[0] * 0.47, m.shape[1] * 0.5
    inner = (m > 0.5) & (((xx - cx) / (m.shape[1] * 0.3)) ** 2 + ((yy - cy) / (m.shape[0] * 0.25)) ** 2 > 1)   # skin around the feature, not the feature itself
    for c in range(3):                                   # same light and colour as the face around it
        mu, sd = a[..., c][inner].mean(), a[..., c][inner].std() + 1e-3
        rmu, rsd = ref[..., c][inner].mean(), ref[..., c][inner].std() + 1e-3
        a[..., c] = (a[..., c] - mu) * (0.5 + 0.5 * rsd / sd) + rmu
    out = np.dstack([np.clip(a, 0, 255), m * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(f'{OUT}/{name}.webp', quality=95, alpha_quality=100, method=6)

def oval(box, inset):
    w, h = box[2] - box[0], box[3] - box[1]
    o = Image.new('L', (w, h), 0); ImageDraw.Draw(o).ellipse((inset[0], inset[1], w - inset[0], h - inset[1]), fill=255)
    return o.filter(ImageFilter.GaussianBlur(inset[2]))

mouth_soft = oval(MOUTH, (22, 18, 14))
for shape, source in {'N': 'N', 'B': 'B2', 'C': 'C2', 'D': 'D2', 'E': 'E', 'F': 'F', 'G': 'G', 'H': 'H'}.items():
    patch(f'kit/{source}.png', MOUTH, mouth_soft, f'm_{shape}')
EYES_WIDE = (EYES[0], EYES[1] - 40, EYES[2], EYES[3])   # the brows sit above the eyes
eyes_soft = oval(EYES_WIDE, (14, 10, 9))
for name in ('half', 'left', 'right', 'brows'):
    patch(f'kit/eyes_{name}.png', EYES_WIDE, eyes_soft, f'e_{name}')

# Whole figures for what he does when nobody is talking to him.
for name in ('read', 'coffee', 'sip', 'smoke', 'drag', 'light', 'stretch', 'write'):
    if not os.path.exists(f'kit/{name}.png'): continue
    cut(f'kit/{name}.png').save(f'{OUT}/{name}.webp', quality=92, alpha_quality=100, method=6)
# Animated steps: frames generated with Ludo (animateSpriteKeyframes, True Size, margin "none") from a crop
# of the scene's paintings, laid back over the base painting at the crop's place. Their edges fade where the
# crop cut through the figure, so they melt into the painting around them.
ANIMS = {'sip': ((60, 0, 1084, 976), 'kit/sip_frames')}
for name, (box, folder) in ANIMS.items():
    if not os.path.isdir(folder): continue
    os.makedirs(f'{OUT}/{name}', exist_ok=True)
    w, h = box[2] - box[0], box[3] - box[1]
    edge = np.ones((h, w), np.float32)
    ramp = np.linspace(0, 1, 48, dtype=np.float32)
    edge[:, :48] *= ramp[None, :]; edge[:, -48:] *= ramp[::-1][None, :]; edge[-48:, :] *= ramp[::-1][:, None]
    for i, path in enumerate(sorted(os.listdir(folder))):
        f = np.asarray(Image.open(f'{folder}/{path}').convert('RGBA')).astype(np.float32)
        f[..., 3] *= edge
        Image.fromarray(f.astype(np.uint8), 'RGBA').save(f'{OUT}/{name}/{i:02d}.webp', quality=86, alpha_quality=90, method=6)
for name in ('room_day', 'room_dusk'):
    Image.open(f'kit/{name}.png').convert('RGB').save(f'{OUT}/../{name}.jpg', quality=88)
