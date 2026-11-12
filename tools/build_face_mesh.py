#!/usr/bin/env python3
"""Build interface/js/face-mesh.js: the nodes and links ALAN's face is drawn from.

    python3 tools/build_face_mesh.py path/to/canonical_face_model.obj

Source: MediaPipe's canonical face model (Apache-2.0), a generic face of 468
points: github.com/google-ai-edge/mediapipe, mediapipe/modules/face_geometry/data.
This script sculpts it into a handsome man's face (angular jaw, square chin,
high cheekbones, strong brow, straight nose), adds nodes for hair, the back of
the head, neck and shoulders, and a loose cloud around them, then links near
neighbours. Deterministic.

Per node it writes: position (x, y, z), three random numbers, jaw weight
(how far it follows an opening mouth), lid offset (how far it drops in a
blink) and kind (0 face, 1 head and shoulders, 2 surrounding cloud).
"""

import json
import math
import os
import random
import sys

UPPER_LID = {  # upper-lid landmark -> the lower-lid landmark beneath it
    246: 7, 161: 163, 160: 144, 159: 145, 158: 153, 157: 154, 173: 155,
    466: 249, 388: 390, 387: 373, 386: 374, 385: 380, 384: 381, 398: 382,
}
# The lines that make a face read as a face: drawn brighter than the rest of the mesh.
FEATURES = [
    [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
     148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],            # outline and jaw
    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],   # lips
    [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],                                                # the line between them
    [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],                 # eyes
    [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
    [46, 53, 52, 65, 55], [276, 283, 282, 295, 285],                                                   # brows
    [168, 6, 197, 195, 5, 4], [98, 97, 2, 326, 327],                                                   # nose
]
SCALE = 0.1  # centimetres -> units; the head ends up about 2.3 units tall

rnd = random.Random(1964)
src = sys.argv[1]
verts, faces = [], []
for line in open(src):
    part = line.split()
    if part[:1] == ["v"]:
        verts.append([float(v) for v in part[1:4]])
    elif part[:1] == ["f"]:
        faces.append([int(v.split("/")[0]) - 1 for v in part[1:]])

# --- sculpt the generic face into a handsome man's: a defined, angular jaw, a
# firm square chin, high cheekbones over leaner cheeks, a strong brow over
# deeper-set eyes, a straight narrow nose.
MOUTH_Y = (verts[13][1] + verts[14][1]) / 2
CHIN_Y = verts[152][1]


def bump(v, centre, width):
    return math.exp(-((v - centre) / width) ** 2)


shaped = []
for x, y, z in verts:
    ax = abs(x)
    side = 1 if x >= 0 else -1
    below = max(0.0, min(1.0, (-1.0 - y) / (-1.0 - CHIN_Y)))        # 0 at the nose base, 1 at the chin
    y -= 0.75 * below ** 2                                           # longer lower third
    jaw_angle = bump(y, -6.6, 2.4) * bump(ax, 6.2, 2.6)              # the corner of the jaw, under the ear
    ax += 0.55 * jaw_angle
    z -= 0.25 * jaw_angle
    chin = bump(y, CHIN_Y - 0.75, 1.5) * bump(ax, 0.0, 3.2)          # square it off and bring it forward
    ax += 0.55 * chin * min(1.0, ax / 1.5)
    z += 0.55 * chin
    hollow = bump(y, -3.4, 1.7) * bump(ax, 5.0, 1.5)                 # lean cheek under the cheekbone
    z -= 0.55 * hollow
    ax -= 0.25 * hollow
    cheekbone = bump(y, 0.4, 1.3) * bump(ax, 5.6, 1.6)
    z += 0.45 * cheekbone
    ax += 0.20 * cheekbone
    brow = bump(y, 4.2, 0.9) * (1 - bump(ax, 0.0, 0.9) * 0.4)        # brow ridge, a little lower and heavier
    z += 0.60 * brow
    y -= 0.22 * brow
    socket = bump(y, 2.7, 0.9) * bump(ax, 3.2, 1.6)                  # eyes set back beneath it
    z -= 0.30 * socket
    nose = bump(ax, 0.0, 1.6) * (1.0 if -2.4 < y < 3.0 else 0.0)     # straighter, narrower
    ax *= 1 - 0.14 * nose
    temple = bump(y, 5.0, 2.2) * bump(ax, 6.5, 1.5)
    ax -= 0.25 * temple
    shaped.append([side * ax, y, z])

# Open the eyes a little: the model's are nearly closed, which reads as tired.
LOWER_LID = set(UPPER_LID.values())
for i in UPPER_LID:
    shaped[i][1] += 0.20
for i in LOWER_LID:
    shaped[i][1] -= 0.10

nodes = []  # [x, y, z, jaw, lid, kind]
for i, (x, y, z) in enumerate(shaped):
    jaw = 0.0
    if y < MOUTH_Y:
        depth = min(1.0, (MOUTH_Y - y) / (MOUTH_Y - CHIN_Y))
        side = min(1.0, abs(x) / 7.5)
        jaw = (0.5 + 0.5 * depth) * (1 - 0.7 * side ** 2)
    lid = (shaped[i][1] - shaped[UPPER_LID[i]][1]) * 0.9 if i in UPPER_LID else 0.0
    nodes.append([x, y, z, jaw, lid, 0])

bold = set()
for line in FEATURES:
    for a, b in zip(line, line[1:]):
        bold.add((min(a, b), max(a, b)))

# Irises: a small ring and a centre in each eye, so he has a gaze.
for upper, lower, inner, outer in ((159, 145, 133, 33), (386, 374, 362, 263)):
    cx = (nodes[inner][0] + nodes[outer][0]) / 2
    cy = (nodes[upper][1] + nodes[lower][1]) / 2 + 0.05
    cz = max(nodes[upper][2], nodes[lower][2]) - 0.15
    centre = len(nodes)
    nodes.append([cx, cy, cz, 0.0, 0.0, 0])
    ring = []
    for k in range(8):
        a = k * math.pi / 4
        ring.append(len(nodes))
        nodes.append([cx + 0.34 * math.cos(a), cy + 0.34 * math.sin(a), cz, 0.0, 0.0, 0])
    for a, b in zip(ring, ring[1:] + ring[:1]):
        bold.add((min(a, b), max(a, b)))
    bold.add((centre, ring[0]))

edges = set()
for f in faces:
    for a, b in zip(f, f[1:] + f[:1]):
        edges.add((min(a, b), max(a, b)))


def dist(a, b):
    return math.dist(nodes[a][:3], nodes[b][:3])


def link_nearest(new, pool, k, reach):
    for i in new:
        near = sorted((dist(i, j), j) for j in pool if j != i)[:k]
        for d, j in near:
            if d < reach:
                edges.add((min(i, j), max(i, j)))


# --- the rest of the head, the neck and the shoulders, as sparse nodes
face_count = len(nodes)
bust = []
while len(bust) < 150:                                   # skull: an ellipsoid behind and above the face
    u, v = rnd.uniform(0, 2 * math.pi), math.acos(rnd.uniform(-1, 1))
    x, y, z = 8.3 * math.sin(v) * math.cos(u), 2.2 + 10.6 * math.cos(v), -3.4 + 9.6 * math.sin(v) * math.sin(u)
    in_front = z > -1.6 and y < 8.6                       # where the face already is
    if y < -6.5 or in_front:
        continue
    bust.append([x, y, z, 0.0, 0.0, 1])
hair = 0
while hair < 170:                                         # short hair with some height, swept back and to one side
    u, v = rnd.uniform(0, 2 * math.pi), math.acos(rnd.uniform(0.05, 1))
    lift = 1.0 + 0.9 * math.sin(v) * max(0.0, math.sin(u))            # fuller towards the front
    x = 8.6 * math.sin(v) * math.cos(u) + 0.6 * math.sin(v)           # slight sweep to one side
    y = 2.2 + (10.9 + lift) * math.cos(v)
    z = -3.4 + 9.9 * math.sin(v) * math.sin(u)
    if y < 6.6 + 1.6 * bump(abs(x), 6.5, 2.5) or (z > 4.4 and y < 9.3):   # keep the forehead and face clear
        continue
    bust.append([x, y, z, 0.0, 0.0, 1])
    hair += 1
for _ in range(46):                                       # neck
    a, y = rnd.uniform(0, 2 * math.pi), rnd.uniform(-17.5, -9.5)
    bust.append([5.6 * math.cos(a), y, -3.0 + 5.2 * math.sin(a), 0.0, 0.0, 1])
for _ in range(90):                                       # shoulders and upper chest
    t, a = rnd.uniform(-1, 1), rnd.uniform(-0.5, 0.5)
    x = t * 21
    y = -17.5 - 3.2 * abs(t) ** 1.6 - rnd.uniform(0, 5.5)
    bust.append([x, y, -3.0 + 6.0 * math.sin(a * math.pi) * (1 - 0.3 * abs(t)), 0.0, 0.0, 1])
start = len(nodes)
nodes += bust
link_nearest(range(start, len(nodes)), range(len(nodes)), 3, 5.2)

# --- the cloud he emerges from
start = len(nodes)
while len(nodes) - start < 190:
    x, y, z = rnd.uniform(-34, 34), rnd.uniform(-24, 15), rnd.uniform(-20, 6)
    if abs(x) < 9 and -10 < y < 12 and z > -6:            # keep the face itself clear
        continue
    nodes.append([x, y, z, 0.0, 0.0, 2])
link_nearest(range(start, len(nodes)), range(face_count, len(nodes)), 3, 9.0)

flat = []
for x, y, z, jaw, lid, kind in nodes:
    flat += [round(x * SCALE, 4), round(y * SCALE, 4), round(z * SCALE, 4),
             round(rnd.random(), 3), round(rnd.random(), 3), round(rnd.random(), 3),
             round(jaw, 3), round(lid * SCALE, 4), kind]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "interface", "js", "face-mesh.js")
with open(out, "w") as f:
    f.write("// Generated by tools/build_face_mesh.py — do not edit by hand.\n"
            "// Face geometry derived from MediaPipe's canonical face model (Apache-2.0), reshaped.\n"
            "// Per node: x, y, z, three random numbers, jaw weight, lid offset, kind (0 face, 1 head, 2 cloud).\n"
            "// LINKS is the mesh; FEATURES are the outline, eyes, brows, nose and lips, drawn brighter.\n")
    f.write(f"export const STRIDE = 9;\nexport const NODES = new Float32Array({json.dumps(flat, separators=(',', ':'))});\n")
    for name, pairs in (("LINKS", edges - bold), ("FEATURES", bold)):
        body = json.dumps(sorted(pairs), separators=(',', ':')).replace('[', '').replace(']', '')
        f.write(f"export const {name} = new Uint16Array([{body}]);\n")
print(f"{len(nodes)} nodes ({face_count} face), {len(edges - bold)} links + {len(bold)} feature links -> {os.path.normpath(out)}")
