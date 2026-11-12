#!/usr/bin/env python3
"""Build the point cloud ALAN's head is drawn from.

    python3 tools/build_head_cloud.py path/to/base.obj

Source: the MakeHuman base mesh (CC0), a full neutral human figure:
github.com/makehumancommunity/makehuman, makehuman/data/3dobjs/base.obj.
This script keeps the head, neck and shoulders plus the eyeballs, sculpts the
face towards a handsome man's (angular jaw, firm chin, cheekbones, brow,
straight nose), then covers every quad with an even grid of points that follow
the mesh's own edge loops — tens of thousands of them, each with its surface
normal so it can be lit. A sparse network of links is laid over the surface
and a loose cloud is scattered around it. Deterministic.

Writes, next to the page:
  interface/data/head.points.bin   Int16, 9 per point:
        x y z (1/4000 unit) · normal x y z (1/32767) · jaw weight · glow · kind
        glow: 1 iris, -1 rest of the eyeball, 0 elsewhere
        kind: 0 surface, 1 network node on the surface, 2 surrounding cloud
  interface/data/head.links.bin    Uint16 pairs of point indices
"""

import array
import math
import os
import random
import sys

SPACING = 0.0235        # distance between neighbouring points, in model units (decimetres)
CUT_Y = 4.75            # keep everything above the upper chest
CENTRE = (0.0, 7.05, 0.35)
EYE_Y, MOUTH_Y = 7.284, 6.66
POS, UNIT = 4000, 32767

rnd = random.Random(1964)
verts, groups, group = [], {}, None
for line in open(sys.argv[1]):
    part = line.split()
    if part[:1] == ["v"]:
        verts.append([float(v) for v in part[1:4]])
    elif part[:1] == ["g"]:
        group = part[1]
    elif part[:1] == ["f"]:
        groups.setdefault(group, []).append([int(v.split("/")[0]) - 1 for v in part[1:]])


def bump(v, centre, width):
    return math.exp(-((v - centre) / width) ** 2)


def sculpt(x, y, z):
    """Reshape the front of the head; the back of the skull is left alone."""
    front = max(0.0, min(1.0, (z - 0.25) / 0.6))
    if front == 0.0 or y < 5.9:
        return [x, y, z]
    ax, side = abs(x), (1 if x >= 0 else -1)
    cy = (y - EYE_Y) * 10 + 2.66                      # centimetres, with the eyes at 2.66
    cx = ax * 10
    dx = dy = dz = 0.0
    below = max(0.0, min(1.0, (-1.0 - cy) / 8.4))
    dy -= 0.50 * below ** 2                            # longer lower third
    jaw = bump(cy, -6.8, 2.4) * bump(cx, 6.0, 2.6)     # the corner of the jaw
    dx += 0.55 * jaw
    chin = bump(cy, -9.6, 1.6) * bump(cx, 0.0, 3.2)    # square and forward
    dx += 0.45 * chin * min(1.0, cx / 1.5)
    dz += 0.50 * chin
    hollow = bump(cy, -3.4, 1.7) * bump(cx, 5.0, 1.5)  # lean cheek under the cheekbone
    dz -= 0.45 * hollow
    dx -= 0.20 * hollow
    cheekbone = bump(cy, 0.4, 1.3) * bump(cx, 5.6, 1.6)
    dz += 0.40 * cheekbone
    brow = bump(cy, 4.2, 0.9) * (1 - bump(cx, 0.0, 0.9) * 0.4)
    dz += 0.55 * brow
    dy -= 0.15 * brow
    nose = bump(cx, 0.0, 1.6) * (1.0 if -2.4 < cy < 3.0 else 0.0)
    dx -= 0.10 * nose * cx
    return [side * (ax + dx * front / 10), y + dy * front / 10, z + dz * front / 10]


shaped = [sculpt(*v) for v in verts]


def normal_of(quad):
    a, b, c, d = (shaped[i] for i in quad)
    u = [c[k] - a[k] for k in range(3)]
    v = [d[k] - b[k] for k in range(3)]
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]


def unit(v):
    length = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / length for c in v]


def inside_mouth(q):
    """The model has a mouth cavity behind the lips; as points it would show through the face."""
    x, y, z = (sum(shaped[i][k] for i in q) / 4 for k in range(3))
    return abs(x) < 0.42 and 6.32 < y < 6.95 and 0.35 < z < 1.20


quads = [q for q in groups["body"] if all(shaped[i][1] > CUT_Y for i in q) and not inside_mouth(q)]
eyes = groups["helper-l-eye"] + groups["helper-r-eye"]
vnormal = {}
for q in quads + eyes:
    n = normal_of(q)                                    # area-weighted
    for i in q:
        acc = vnormal.setdefault(i, [0.0, 0.0, 0.0])
        for k in range(3):
            acc[k] += n[k]
vnormal = {i: unit(n) for i, n in vnormal.items()}

points = []   # [x, y, z, nx, ny, nz, jaw, glow, kind]


def jaw_weight(x, y, z):
    """How far a point follows the opening jaw: the lower lip and chin fully, fading out to the sides and neck."""
    if y >= MOUTH_Y or z < 0.55 or y < 5.75:
        return 0.0
    depth = min(1.0, (MOUTH_Y - y) / 0.10)             # the lower lip moves at once
    side = min(1.0, abs(x) / 0.78)
    neck = min(1.0, (y - 5.75) / 0.30)
    front = min(1.0, (z - 0.55) / 0.35)
    return depth * (1 - 0.8 * side ** 2) * neck * front


def cover(quad, spacing, eye=None):
    a, b, c, d = (shaped[i] for i in quad)
    na, nb, nc, nd = (vnormal[i] for i in quad)
    nu = max(1, round(math.dist(a, b) / spacing))
    nv = max(1, round(math.dist(b, c) / spacing))
    for i in range(nu):
        for j in range(nv):
            s, t = (i + 0.5) / nu, (j + 0.5) / nv
            w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
            p = [w[0] * a[k] + w[1] * b[k] + w[2] * c[k] + w[3] * d[k] for k in range(3)]
            n = unit([w[0] * na[k] + w[1] * nb[k] + w[2] * nc[k] + w[3] * nd[k] for k in range(3)])
            glow = 0.0
            if eye:                                     # iris: a bright ring round a dark pupil, facing forward
                away = math.acos(max(-1.0, min(1.0, unit([p[k] - eye[k] for k in range(3)])[2])))
                if away > 1.35:                          # the back of the eyeball is never seen
                    continue
                glow = 1.0 if 0.10 < away < 0.30 else -1.0   # iris, or the rest of the eyeball (drawn dimmer)
            points.append(p + n + [jaw_weight(*p), glow, 0])


for q in quads:
    cover(q, SPACING)
for name in ("helper-l-eye", "helper-r-eye"):
    ids = {i for q in groups[name] for i in q}
    centre = [sum(shaped[i][k] for i in ids) / len(ids) for k in range(3)]
    for q in groups[name]:
        cover(q, SPACING * 0.8, centre)
surface = len(points)

# --- a sparse network laid over the surface
picked = rnd.sample(range(surface), 1100)
for i in picked:
    points[i][8] = 1
links = set()
cell = 0.5
grid = {}
for i in picked:
    grid.setdefault(tuple(int(points[i][k] // cell) for k in range(3)), []).append(i)
for i in picked:
    key = tuple(int(points[i][k] // cell) for k in range(3))
    near = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for j in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), []):
                    if j != i:
                        near.append((math.dist(points[i][:3], points[j][:3]), j))
    for dist, j in sorted(near)[:3]:
        if dist < 0.42:
            links.add((min(i, j), max(i, j)))

# --- the cloud around him, with a few long links of its own
start = len(points)
while len(points) - start < 520:
    x, y, z = rnd.uniform(-6.5, 6.5), rnd.uniform(4.2, 10.0), rnd.uniform(-5.0, 2.6)
    if abs(x) < 1.5 and 5.6 < y < 8.8 and z > -1.2:   # keep the head itself clear
        continue
    points.append([x, y, z, 0.0, 0.0, 1.0, 0.0, 0.0, 2])
cloud = range(start, len(points))
for i in cloud:
    near = sorted((math.dist(points[i][:3], points[j][:3]), j) for j in cloud if j != i)[:2]
    for dist, j in near:
        if dist < 1.5 and rnd.random() < 0.55:
            links.add((min(i, j), max(i, j)))

assert len(points) < 65536, "links are 16-bit"
data = array.array("h")
for p in points:
    data.extend([max(-32767, min(32767, round((p[k] - CENTRE[k]) * POS))) for k in range(3)])
    data.extend([round(p[k] * UNIT) for k in range(3, 6)])
    data.extend([round(p[6] * UNIT), round(p[7] * UNIT), int(p[8])])
flat = array.array("H", [i for pair in sorted(links) for i in pair])
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "interface", "data")
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "head.points.bin"), "wb") as f:
    data.tofile(f)
with open(os.path.join(out, "head.links.bin"), "wb") as f:
    flat.tofile(f)
print(f"{len(points)} points ({surface} on the surface, {len(picked)} network nodes, {len(points) - start} cloud), "
      f"{len(links)} links, {os.path.getsize(os.path.join(out, 'head.points.bin')) // 1024} KB")
