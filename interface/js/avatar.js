// ALAN on screen: the character from the Alan Sanchez games, painted seated in
// his armchair, at the desk of his 1960s living room. One 2D canvas.
//
// The body is one painting (art/alan/body.webp, 1536x2048, so it stays sharp on
// a large 4K screen). His face is built in layers over it (tools/build_alan_kit.py
// cuts them):
//   m_B..m_H   mouth shapes, Rhubarb Lip Sync's set: only the mouth and chin, so the
//              rest of the face holds still while he speaks; one shape melts into the next
//   think, listen, alarm, smirk   expressions worn while he is silent (the whole head)
//   laugh, shy   worn for a moment after a line that calls for it
//   blink    closed eyelids, laid over whichever head is showing, eased in and out
// Left alone he reads, drinks a coffee, smokes, stretches or writes: each a short
// scene played from paintings of the whole figure (he lights the cigarette, draws
// on it, lets the smoke out). A scene is played only if its paintings are there.
// The room is alive in small ways, all drawn here: rain on the window at night,
// the town's lights, a car passing, birds by day, the record turning, the clock
// showing the real time, smoke, the glow of the cigarette and the lighter. The room has three paintings, for day, sunset and night, chosen
// by the clock.
// For trying things out: window.alanScene = { hour: 12, doing: 'smoke' }.
// The mouth follows Rhubarb cues when the server supplies them (signal.mouth),
// otherwise the loudness of his voice (signal.level).

import { store, signal, mode } from './store.js';

const ROOM = { w: 1920, h: 1080 };
// Where he sits in the room painting: his lap meets the desk's top edge, which hides the rest.
const SEAT = { x: 944, desk: 728, scale: 0.45 };
const BODY = { w: 1536, h: 2048, lap: 1150, centre: 768 };   // painting px
const HEAD_BOX = [540, 20, 460, 450];   // the last 50 px of a head patch fade into the body
const EYES_BOX = [640, 160, 260, 102];
const MOUTH_BOX = [640, 236];            // where a mouth patch goes
const MOUTHS = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];   // A, the closed mouth, is the painting itself
const FACES = ['think', 'listen', 'alarm', 'smirk', 'laugh', 'shy'];
const DOINGS = ['read', 'coffee', 'smoke', 'stretch', 'write'];
// How each scene plays: [painting, seconds], once through. A step whose painting is missing is left out.
const POSES = {
  read: [['read', 45]],
  write: [['write', 28]],
  stretch: [['stretch', 6]],
  coffee: [['coffee', 5], ['sip', 2.2], ['coffee', 9], ['sip', 2.2], ['coffee', 10], ['sip', 2.4], ['coffee', 4]],
  smoke: [['light', 2.8], ['drag', 1.6], ['smoke', 8], ['drag', 2.2], ['smoke', 9], ['drag', 2.2], ['smoke', 8], ['drag', 2.4], ['smoke', 5]],
};
const NEEDS = { read: ['read'], write: ['write'], stretch: ['stretch'], coffee: ['coffee'], smoke: ['smoke', 'drag'] };
// Where the cigarette's tip is in each painting, and his lips (painting px): for the smoke and the glow.
const TIP = { smoke: [1272, 318], drag: [800, 346], light: [754, 398] };
const LIPS = [770, 335];
// The window's glass in the room painting, as rectangles [x, y, w, h], the lights of the town seen through them, and things in the room.
const PANES = [[252, 0, 120, 366], [390, 0, 44, 366], [434, 0, 246, 400], [706, 0, 166, 400]];   // cut around the television, which stands in front of the glass
const TOWN = [[578, 348, 255, 170, 60], [733, 328, 60, 230, 170], [420, 292, 255, 190, 110], [790, 290, 255, 180, 100], [336, 296, 255, 175, 90], [640, 300, 250, 200, 130]];   // x, y, r, g, b
const RECORD = [1414, 403, 62, 9];     // the record on the player: centre and radii as seen from the side
const CLOCK = [1541, 156, 30];         // the sunburst clock's face
// What he has just said can leave a look on his face for a moment.
const AFTER = [
  ['laugh', /ha ha|haha|he he|zabawn|śmiesz|rozbawi|dobre[.!]|żartuj/i],
  ['shy', /przepraszam|mój błąd|pomyli|głupio mi|wstyd|niezręcznie|przyłapa/i],
];
const roomAt = (hour) => (hour >= 7 && hour < 16 ? 'day' : hour >= 16 && hour < 19 ? 'dusk' : 'night');
// Rhubarb's extended shapes and its rest shape, mapped onto the six that are painted.
const SHAPE = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', X: 'A' };
const STAND_IN = { G: 'B', H: 'C' };      // until those two are painted
// The face each state wears; idle is neutral, with a passing smirk now and then.
const WEAR = { alert: 'alarm', thinking: 'think', listening: 'listen' };
// Lights in the painting that breathe a little: [x, y, radius, strength].
const LAMPS = [[1178, 190, 420, 0.10], [1700, 590, 330, 0.12], [150, 728, 150, 0.10]];

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('missing ' + src));
  img.src = new URL('../art/' + src, import.meta.url).href;
});

/** The mouth for a loudness, when there are no cues. */
function mouthFor(level) {
  return level < 0.07 ? 'A' : level < 0.22 ? 'B' : level < 0.5 ? 'C' : 'D';
}

export async function startAvatar(canvas, isDark) {
  const g = canvas.getContext('2d');
  const art = {};
  const keep = (name, src) => load(src).then((img) => { art[name] = img; });
  const rooms = {};
  const [, body] = await Promise.all([
    Promise.all([['night', 'room.jpg'], ['day', 'room_day.jpg'], ['dusk', 'room_dusk.jpg']].map(([k, src]) => load(src).then((img) => { rooms[k] = img; }))),
    load('alan/body.webp'),
    ...['read', 'coffee', 'sip', 'smoke', 'drag', 'light', 'stretch', 'write'].map((d) => keep(d, `alan/${d}.webp`).catch(() => {})),   // a pose not painted yet is simply never struck
    keep('blink', 'alan/blink.webp'),
    ...MOUTHS.map((m) => keep(m, `alan/m_${m}.webp`).catch(() => {})),
    ...FACES.map((face) => keep(face, `alan/${face}.webp`)),
  ]);

  // He is composed off screen at the painting's size, and only when his face changes.
  const figure = document.createElement('canvas');
  figure.width = BODY.w;
  figure.height = BODY.h;
  const f = figure.getContext('2d');

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  addEventListener('resize', resize);
  resize();

  const doings = DOINGS.filter((d) => NEEDS[d].every((painting) => art[painting]));
  const stepsOf = (name) => POSES[name].filter(([painting]) => art[painting]);
  const lengthOf = (name) => stepsOf(name).reduce((sum, [, seconds]) => sum + seconds, 0) * 1000;
  const shapeOf = (cue) => { const want = SHAPE[cue] || 'A'; return art[want] || want === 'A' ? want : STAND_IN[want] || 'A'; };

  let blinkAt = performance.now() + 2500;
  let blinkLen = 200;
  let smirkAt = performance.now() + 18000;
  const pose = { lean: 0, nod: 0 };
  let running = false;

  // A layer that melts from one painting to the next instead of jumping.
  const melting = (first, ms) => ({ from: first, to: first, since: -1e9, ms });
  const melt = (layer, want, now) => {
    if (want === layer.to) return;
    layer.from = now - layer.since < layer.ms ? layer.from : layer.to;    // mid-change: keep melting from the older one
    layer.to = want;
    layer.since = now;
  };
  const amount = (layer, now) => Math.min(1, (now - layer.since) / layer.ms);
  const mouth = melting('A', 70);       // about two frames: quicker than speech, slower than a flicker
  const face = melting('A', 220);
  let mouthSince = 0;

  let shown = '';
  // What he does when left alone, and the look his last line left behind.
  const before = document.createElement('canvas');   // the figure as it was, for a soft change of pose
  before.width = BODY.w;
  before.height = BODY.h;
  let changedAt = -1e9;
  let doing = null;
  let doingSince = 0;
  let doingUntil = 0;
  let painting = null;
  let nextDoing = performance.now() + 50000;
  let idleSince = performance.now();
  let lastMode = 'idle';
  let after = null;
  let afterUntil = 0;
  let roomNow = null;
  let roomWas = null;
  let roomSince = -1e9;
  const puffs = [];                     // smoke: {x, y, vx, vy, r, born, life}
  let exhaleUntil = 0;

  /** Which painting of a scene shows now. */
  function paintingOf(name, now) {
    const steps = stepsOf(name);
    let at = ((now - doingSince) / 1000) % (lengthOf(name) / 1000);     // a scene forced for a trial plays over and over
    for (const [image, seconds] of steps) { if (at < seconds) return image; at -= seconds; }
    return steps[0][0];
  }

  function paintFigure(m, now) {
    const forced = window.alanScene?.doing;
    if (m !== 'idle') { idleSince = now; doing = null; }
    if (lastMode === 'speaking' && m === 'idle') {       // he has just finished a line
      after = (AFTER.find(([, words]) => words.test(store.get().text)) || [null])[0];
      afterUntil = now + 2600;
    }
    lastMode = m;
    if (m === 'idle' && !doing && doings.length && now > nextDoing && now - idleSince > 40000) {
      doing = doings[Math.floor(Math.random() * doings.length)];
      doingSince = now;
      doingUntil = now + lengthOf(doing) - 50;
    }
    if (doing && now > doingUntil) { doing = null; nextDoing = now + 45000 + Math.random() * 90000; }
    const name = m === 'idle' ? (doings.includes(forced) ? forced : doing) : null;
    if (name && name === forced && doing !== forced && !painting) doingSince = now;
    const was = painting;
    painting = name ? paintingOf(name, now) : null;
    if (was === 'drag' && painting !== 'drag') exhaleUntil = now + 1600;      // he lets the smoke out

    let head = WEAR[m] || 'A';
    if (m === 'idle' && after && now < afterUntil) head = after;
    else if (m === 'idle' && now > smirkAt) {
      head = 'smirk';
      if (now > smirkAt + 2600) smirkAt = now + 20000 + Math.random() * 30000;
    }
    let lips = 'A';
    if (m === 'speaking') {
      head = 'A';
      lips = signal.mouth ? shapeOf(signal.mouth) : mouthFor(signal.level);
      if (lips !== mouth.to && now - mouthSince < 45) lips = mouth.to;          // never flicker faster than speech
      else if (lips !== mouth.to) mouthSince = now;
    }
    melt(mouth, lips, now);
    melt(face, head, now);

    // A blink closes fast and opens a little slower; now and then he blinks twice.
    if (now > blinkAt + blinkLen) {
      blinkAt = now + (Math.random() < 0.18 ? 260 : 2200 + Math.random() * 3800);
      blinkLen = 170 + Math.random() * 70;
    }
    const sinceBlink = now - blinkAt;
    const still = ['alarm', 'think', 'laugh', 'shy'].includes(face.to);
    const lid = painting || still || sinceBlink < 0 ? 0 : sinceBlink < 50 ? sinceBlink / 50 : sinceBlink < blinkLen - 90 ? 1 : Math.max(0, (blinkLen - sinceBlink) / 90);

    const km = amount(mouth, now);
    const kf = amount(face, now);
    const key = painting || [face.from, face.to, kf.toFixed(2), mouth.from, mouth.to, km.toFixed(2), lid.toFixed(2)].join(' ');
    if (key === shown) return;
    if (painting !== was && (painting || was)) {         // picking something up, a drag, putting it down: dissolve
      const b = before.getContext('2d');
      b.clearRect(0, 0, BODY.w, BODY.h);
      b.drawImage(figure, 0, 0);
      changedAt = now;
    }
    shown = key;
    f.globalAlpha = 1;
    f.clearRect(0, 0, BODY.w, BODY.h);
    if (painting) { f.drawImage(art[painting], 0, 0); return; }
    f.drawImage(body, 0, 0);
    // The head: the older expression first, the newer one melting in over it.
    const [x, y] = HEAD_BOX;
    if (face.from !== 'A' && kf < 1) { f.globalAlpha = face.to === 'A' ? 1 - kf : 1; f.drawImage(art[face.from], x, y); }
    if (face.to !== 'A') { f.globalAlpha = kf; f.drawImage(art[face.to], x, y); }
    // The mouth, the same way.
    if (mouth.from !== 'A' && km < 1) { f.globalAlpha = mouth.to === 'A' ? 1 - km : 1; f.drawImage(art[mouth.from], MOUTH_BOX[0], MOUTH_BOX[1]); }
    if (mouth.to !== 'A') { f.globalAlpha = km; f.drawImage(art[mouth.to], MOUTH_BOX[0], MOUTH_BOX[1]); }
    if (lid > 0) { f.globalAlpha = lid; f.drawImage(art.blink, EYES_BOX[0], EYES_BOX[1]); }
    f.globalAlpha = 1;
  }

  // --- small life, drawn over the room painting -------------------------------------------------
  const drops = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), v: 0.5 + Math.random() * 0.7, len: 10 + Math.random() * 22 }));
  let car = { from: 0, until: 0, dir: 1 };
  let nextCar = performance.now() + 9000;
  let bird = { from: 0, until: 0, y: 90, dir: 1 };
  let nextBird = performance.now() + 15000;

  /** Through the window: rain and the town at night, a car now and then, birds by day. */
  function outside(now, t) {
    g.save();
    g.beginPath();
    for (const [x, y, w, h] of PANES) g.rect(x, y, w, h);
    g.clip();
    const night = roomNow === 'night';
    if (roomNow !== 'day') {
      // The town's lights shimmer through the wet glass; the green one is a traffic light and changes.
      g.globalCompositeOperation = 'lighter';
      TOWN.forEach(([x, y, r, gr, b], i) => {
        let a = 0.10 + 0.07 * Math.sin(t * (0.7 + i * 0.31) + i * 1.9) + 0.04 * Math.sin(t * 5.3 + i);
        let colour = `${r}, ${gr}, ${b}`;
        if (i === 1) { const phase = (t % 46) / 46; colour = phase < 0.5 ? '60, 230, 170' : phase < 0.56 ? '255, 190, 80' : '255, 70, 60'; a = 0.2; }
        const glow = g.createRadialGradient(x, y, 0, x, y, 26);
        glow.addColorStop(0, `rgba(${colour}, ${Math.max(0, a) * (night ? 1 : 0.5)})`);
        glow.addColorStop(1, `rgba(${colour}, 0)`);
        g.fillStyle = glow;
        g.fillRect(x - 26, y - 26, 52, 52);
      });
      // A car on the street below: two headlights and their smear on the wet road.
      if (now > nextCar) { car = { from: now, until: now + 5200 + Math.random() * 2500, dir: Math.random() < 0.5 ? 1 : -1 }; nextCar = car.until + 12000 + Math.random() * 40000; }
      if (now < car.until) {
        const k2 = (now - car.from) / (car.until - car.from);
        const x = car.dir > 0 ? 240 + k2 * 650 : 890 - k2 * 650;
        for (const dx of [0, 9 * car.dir]) {
          const beam = g.createRadialGradient(x + dx, 372, 0, x + dx, 372, 16);
          beam.addColorStop(0, 'rgba(255, 236, 190, 0.5)');
          beam.addColorStop(1, 'rgba(255, 236, 190, 0)');
          g.fillStyle = beam;
          g.fillRect(x + dx - 16, 356, 32, 34);
        }
        g.fillStyle = 'rgba(255, 220, 160, 0.10)';
        g.fillRect(x - 4, 380, 26, 18);
      }
      g.globalCompositeOperation = 'source-over';
    }
    if (night) {
      // Rain running down the glass.
      g.strokeStyle = 'rgba(190, 210, 255, 0.16)';
      g.lineWidth = 1.2;
      g.beginPath();
      for (const d of drops) {
        d.y += d.v * 0.012;
        if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
        const x = 252 + d.x * 620;
        const y = d.y * 400;
        g.moveTo(x, y);
        g.lineTo(x - 2, y + d.len);
      }
      g.stroke();
    } else {
      // A bird or two crossing the sky.
      if (now > nextBird) { bird = { from: now, until: now + 9000 + Math.random() * 5000, y: 50 + Math.random() * 120, dir: Math.random() < 0.5 ? 1 : -1 }; nextBird = bird.until + 20000 + Math.random() * 60000; }
      if (now < bird.until) {
        const k2 = (now - bird.from) / (bird.until - bird.from);
        g.strokeStyle = 'rgba(30, 30, 40, 0.55)';
        g.lineWidth = 1.6;
        for (const [ox, oy] of [[0, 0], [-26, 9], [-44, -4]]) {
          const x = (bird.dir > 0 ? 230 + k2 * 680 : 910 - k2 * 680) + ox * bird.dir;
          const y = bird.y + oy + Math.sin(k2 * 9 + ox) * 6;
          const flap = Math.sin(t * 9 + ox) * 4;
          g.beginPath();
          g.moveTo(x - 7, y - flap);
          g.quadraticCurveTo(x - 3, y - 2, x, y);
          g.quadraticCurveTo(x + 3, y - 2, x + 7, y - flap);
          g.stroke();
        }
      }
    }
    g.restore();
  }

  /** In the room: the record turns, the clock tells the real time. */
  function inside(now, t) {
    // A glint going round the record.
    const [rx, ry, ra, rb] = RECORD;
    const turn = t * (33.3 / 60) * Math.PI * 2;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255, 220, 170, 0.20)';
    g.lineWidth = 1.5;
    for (const offset of [0, Math.PI]) {
      g.beginPath();
      g.moveTo(rx + Math.cos(turn + offset) * ra * 0.25, ry + Math.sin(turn + offset) * rb * 0.25);
      g.lineTo(rx + Math.cos(turn + offset) * ra * 0.95, ry + Math.sin(turn + offset) * rb * 0.95);
      g.stroke();
    }
    g.restore();
    // The clock: its painted hands are covered, and the real time drawn.
    const [cx, cy, cr] = CLOCK;
    const face = g.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, cr);
    const dim = roomNow === 'day' ? 1.25 : 1;
    face.addColorStop(0, `rgb(${196 * dim}, ${150 * dim}, ${62 * dim})`);
    face.addColorStop(1, `rgb(${150 * dim}, ${108 * dim}, ${38 * dim})`);
    g.fillStyle = face;
    g.beginPath();
    g.arc(cx, cy, cr, 0, Math.PI * 2);
    g.fill();
    const time = new Date();
    const minutes = time.getMinutes() + time.getSeconds() / 60;
    const hours = (window.alanScene?.hour ?? time.getHours()) % 12 + minutes / 60;
    g.strokeStyle = 'rgba(28, 18, 8, 0.92)';
    g.lineCap = 'round';
    for (const [angle, length, width] of [[hours / 12, 0.52, 3.4], [minutes / 60, 0.8, 2.4]]) {
      const a = angle * Math.PI * 2 - Math.PI / 2;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * cr * length, cy + Math.sin(a) * cr * length);
      g.stroke();
    }
    g.fillStyle = 'rgba(28, 18, 8, 0.92)';
    g.beginPath();
    g.arc(cx, cy, 2.6, 0, Math.PI * 2);
    g.fill();
  }

  function frame(now) {
    if (isDark()) {             // studio mode: one black frame, then stop the loop
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
      running = false;
      return;
    }
    const m = mode(store.get(), now);
    if (m === 'listening') signal.level *= 0.94; // room level decays unless refreshed
    const t = now / 1000;

    // The room covers the screen; everything below is in the painting's own pixels.
    const k = Math.max(canvas.width / ROOM.w, canvas.height / ROOM.h);
    g.setTransform(k, 0, 0, k, (canvas.width - ROOM.w * k) / 2, (canvas.height - ROOM.h * k) / 2);
    g.imageSmoothingQuality = 'high';
    const want = roomAt(window.alanScene?.hour ?? new Date().getHours());
    if (want !== roomNow) { roomWas = roomNow; roomNow = want; roomSince = roomWas ? now : -1e9; }
    const turn = Math.min(1, (now - roomSince) / 4000);   // the light changes over a few seconds
    if (turn < 1 && roomWas) g.drawImage(rooms[roomWas], 0, 0);
    g.globalAlpha = turn;
    g.drawImage(rooms[roomNow], 0, 0);
    g.globalAlpha = 1;
    const lit = roomNow === 'day' ? 0.15 : 1;              // by day the lamps are off; only the radio dial glows
    outside(now, t);
    inside(now, t);

    // Lamps and the radio dial: slow breathing; the radio also follows his voice.
    g.globalCompositeOperation = 'lighter';
    LAMPS.forEach(([x, y, r, strength], i) => {
      const live = i === 2 ? signal.level * 1.5 : 0;
      const flicker = 0.04 * Math.sin(t * 13.7 + i * 5) * Math.sin(t * 3.1 + i);     // a filament is never quite steady
      const a = strength * (i === 2 ? 1 : lit) * (0.62 + 0.3 * Math.sin(t * (0.5 + i * 0.23) + i * 2) + flicker + live);
      const glow = g.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, `rgba(255, 190, 110, ${Math.max(0, a)})`);
      glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      g.fillStyle = glow;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
    g.globalCompositeOperation = 'source-over';

    // Him: leans in to listen, nods along with his own voice, breathes.
    paintFigure(m, now);
    pose.lean += ((m === 'listening' ? 1 : m === 'alert' ? 0.6 : 0) - pose.lean) * 0.06;
    pose.nod += ((m === 'speaking' ? signal.level : 0) - pose.nod) * 0.2;
    const breath = Math.sin(t * 1.25) * 0.004;
    const scale = SEAT.scale * (1 + pose.lean * 0.035);
    g.save();
    g.beginPath();
    g.rect(0, 0, ROOM.w, SEAT.desk);          // the desk hides his legs
    g.clip();
    g.translate(SEAT.x, SEAT.desk);
    g.rotate(Math.sin(t * 0.4) * 0.003);
    g.scale(scale, scale * (1 + breath));
    const settle = Math.min(1, (now - changedAt) / 450);
    if (settle < 1) { g.globalAlpha = 1 - settle; g.drawImage(before, -BODY.centre, -BODY.lap); g.globalAlpha = 1; }
    g.globalAlpha = settle;
    g.drawImage(figure, -BODY.centre, -BODY.lap + pose.nod * 6);
    g.globalAlpha = 1;
    // Smoke: a thin thread from the cigarette, and a soft cloud when he breathes out. In the figure's own space.
    const tip = TIP[painting];
    if (tip) {                                    // the ember glows, brighter as he draws on it; the lighter's flame flickers
      const hot = painting === 'drag' ? 0.75 + 0.2 * Math.sin(t * 7) : painting === 'light' ? 0.5 + 0.35 * Math.sin(t * 23) * Math.sin(t * 7.3) : 0.3 + 0.12 * Math.sin(t * 2.3);
      const reach = painting === 'light' ? 150 : painting === 'drag' ? 60 : 34;
      const ember = g.createRadialGradient(tip[0] - BODY.centre, tip[1] - BODY.lap, 0, tip[0] - BODY.centre, tip[1] - BODY.lap, reach);
      ember.addColorStop(0, `rgba(255, ${painting === 'light' ? 200 : 120}, 50, ${hot})`);
      ember.addColorStop(1, 'rgba(255, 120, 40, 0)');
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = ember;
      g.fillRect(tip[0] - BODY.centre - reach, tip[1] - BODY.lap - reach, reach * 2, reach * 2);
      g.globalCompositeOperation = 'source-over';
    }
    if (tip && painting !== 'light' && Math.random() < 0.35) puffs.push({ x: tip[0], y: tip[1], vx: (Math.random() - 0.5) * 8, vy: -38 - Math.random() * 18, r: 9, grow: 16, born: now, life: 4200, a: 0.16 });
    if (now < exhaleUntil && Math.random() < 0.6) puffs.push({ x: LIPS[0], y: LIPS[1], vx: 30 + Math.random() * 50, vy: -14 - Math.random() * 22, r: 26, grow: 60, born: now, life: 3200, a: 0.11 });
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      const age = (now - puff.born) / puff.life;
      if (age >= 1) { puffs.splice(i, 1); continue; }
      const sec = (now - puff.born) / 1000;
      const px = puff.x + puff.vx * sec + Math.sin(sec * 1.7 + puff.born) * 14 * sec - BODY.centre;
      const py = puff.y + puff.vy * sec - BODY.lap;
      const r = puff.r + puff.grow * sec;
      const cloud = g.createRadialGradient(px, py, 0, px, py, r);
      cloud.addColorStop(0, `rgba(225, 220, 210, ${puff.a * Math.sin(Math.PI * Math.min(1, age * 1.15))})`);
      cloud.addColorStop(1, 'rgba(225, 220, 210, 0)');
      g.fillStyle = cloud;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }
    g.restore();

    if (m === 'alert') {                       // the room goes red with the alarm, 1 Hz like the page
      g.fillStyle = `rgba(150, 10, 10, ${0.28 + 0.14 * Math.sin(t * Math.PI * 2)})`;
      g.fillRect(0, 0, ROOM.w, ROOM.h);
    }
    requestAnimationFrame(frame);
  }

  // Start, and restart whenever the store changes and the flat is no longer dark.
  store.subscribe(() => {
    if (!running && !isDark()) {
      running = true;
      requestAnimationFrame(frame);
    }
  });
}
