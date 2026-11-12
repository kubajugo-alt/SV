// ALAN on screen: the character from the Alan Sanchez games, painted seated in
// his armchair, at the desk of his 1960s living room. One 2D canvas.
//
// The body is one painting (art/alan/body.webp, 1536x2048, so it stays sharp on
// a large 4K screen). His face is changed by replacing the head with another
// painting of it (tools/build_alan_kit.py cuts them):
//   A-F      mouth shapes, Rhubarb Lip Sync's basic set, while he speaks
//   think, listen, alarm, smirk   expressions worn while he is silent
//   laugh, shy   worn for a moment after a line that calls for it
//   blink    closed eyelids, laid over whichever head is showing
// Left alone he picks up a book or a coffee (read.webp, coffee.webp: the whole
// figure again). The room has three paintings, for day, sunset and night, chosen
// by the clock; Pessoa the cat sometimes sits on the desk.
// For trying things out: window.alanScene = { hour: 12, cat: true, doing: 'read' }.
// The mouth follows Rhubarb cues when the server supplies them (signal.mouth),
// otherwise the loudness of his voice (signal.level).

import { store, signal, mode } from './store.js';

const ROOM = { w: 1920, h: 1080 };
// Where he sits in the room painting: his lap meets the desk's top edge, which hides the rest.
const SEAT = { x: 944, desk: 728, scale: 0.45 };
const BODY = { w: 1536, h: 2048, lap: 1150, centre: 768 };   // painting px
const HEAD_BOX = [540, 20, 460, 450];   // the last 50 px of a head patch fade into the body
const EYES_BOX = [640, 160, 260, 102];
const MOUTHS = ['A', 'B', 'C', 'D', 'E', 'F'];
const FACES = ['think', 'listen', 'alarm', 'smirk', 'laugh', 'shy'];
const DOINGS = ['read', 'coffee'];
// What he has just said can leave a look on his face for a moment.
const AFTER = [
  ['laugh', /ha ha|haha|he he|zabawn|śmiesz|rozbawi|dobre[.!]|żartuj/i],
  ['shy', /przepraszam|mój błąd|pomyli|głupio mi|wstyd|niezręcznie|przyłapa/i],
];
const CAT = { x: 530, y: 772, height: 215 };   // where Pessoa sits: on the desk, between the radio and him
const roomAt = (hour) => (hour >= 7 && hour < 16 ? 'day' : hour >= 16 && hour < 19 ? 'dusk' : 'night');
// Rhubarb's extended shapes and its rest shape, mapped onto the six that are painted.
const SHAPE = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'B', H: 'C', X: 'A' };
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
  return level < 0.07 ? 'A' : level < 0.2 ? 'B' : level < 0.45 ? 'C' : 'D';
}

export async function startAvatar(canvas, isDark) {
  const g = canvas.getContext('2d');
  const art = {};
  const keep = (name, src) => load(src).then((img) => { art[name] = img; });
  const rooms = {};
  const [, body] = await Promise.all([
    Promise.all([['night', 'room.jpg'], ['day', 'room_day.jpg'], ['dusk', 'room_dusk.jpg']].map(([k, src]) => load(src).then((img) => { rooms[k] = img; }))),
    load('alan/body.webp'),
    keep('cat', 'cat.webp'),
    ...DOINGS.map((d) => keep(d, `alan/${d}.webp`)),
    keep('blink', 'alan/blink.webp'),
    ...MOUTHS.map((m) => keep(m, `alan/${m}.webp`)),
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

  let blinkAt = performance.now() + 2500;
  let smirkAt = performance.now() + 18000;
  let mouth = 'A';
  let mouthSince = 0;
  const pose = { lean: 0, nod: 0 };
  let running = false;

  let shown = '';
  // What he does when left alone, and the look his last line left behind.
  const before = document.createElement('canvas');   // the figure as it was, for a soft change of pose
  before.width = BODY.w;
  before.height = BODY.h;
  let changedAt = -1e9;
  let doing = null;
  let doingUntil = 0;
  let nextDoing = performance.now() + 50000;
  let idleSince = performance.now();
  let lastMode = 'idle';
  let after = null;
  let afterUntil = 0;
  let cat = { on: Math.random() < 0.4, since: -1e9, next: performance.now() + (4 + Math.random() * 5) * 60000 };
  let roomNow = null;
  let roomWas = null;
  let roomSince = -1e9;

  function paintFigure(m, now) {
    const forced = window.alanScene?.doing;
    if (m !== 'idle') { idleSince = now; doing = null; }
    if (lastMode === 'speaking' && m === 'idle') {       // he has just finished a line
      after = (AFTER.find(([, words]) => words.test(store.get().text)) || [null])[0];
      afterUntil = now + 2600;
    }
    lastMode = m;
    if (m === 'idle' && !doing && now > nextDoing && now - idleSince > 40000) {
      doing = DOINGS[Math.floor(Math.random() * DOINGS.length)];
      doingUntil = now + 25000 + Math.random() * 25000;
    }
    if (doing && now > doingUntil) { doing = null; nextDoing = now + 60000 + Math.random() * 120000; }
    const pose = m === 'idle' ? (forced || doing) : null;

    let head = WEAR[m] || 'A';
    if (m === 'idle' && after && now < afterUntil) head = after;
    else if (m === 'idle' && now > smirkAt) {
      head = 'smirk';
      if (now > smirkAt + 2600) smirkAt = now + 20000 + Math.random() * 30000;
    }
    if (m === 'speaking') {
      const want = SHAPE[signal.mouth] || mouthFor(signal.level);
      if (want !== mouth && now - mouthSince > 55) { mouth = want; mouthSince = now; } // never flicker faster than speech
      head = mouth;
    }
    if (now > blinkAt + 140) blinkAt = now + 2200 + Math.random() * 3800;
    const blinking = now > blinkAt && !pose && !['alarm', 'think', 'laugh', 'shy'].includes(head);

    const key = pose || head + (blinking ? '+blink' : '');
    if (key === shown) return;
    if (!!pose !== DOINGS.includes(shown)) {             // picking the book up or putting it down: dissolve
      const b = before.getContext('2d');
      b.clearRect(0, 0, BODY.w, BODY.h);
      b.drawImage(figure, 0, 0);
      changedAt = now;
    }
    shown = key;
    f.clearRect(0, 0, BODY.w, BODY.h);
    if (pose) { f.drawImage(art[pose], 0, 0); return; }
    f.drawImage(body, 0, 0);
    if (head !== 'A') {
      const [x, y, w, h] = HEAD_BOX;
      f.clearRect(x, y, w, h - 50);           // below this the patch fades into the body's own collar
      f.drawImage(art[head], x, y);
    }
    if (blinking) f.drawImage(art.blink, EYES_BOX[0], EYES_BOX[1]);
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

    // Lamps and the radio dial: slow breathing; the radio also follows his voice.
    g.globalCompositeOperation = 'lighter';
    LAMPS.forEach(([x, y, r, strength], i) => {
      const live = i === 2 ? signal.level * 1.5 : 0;
      const a = strength * (i === 2 ? 1 : lit) * (0.55 + 0.45 * Math.sin(t * (0.5 + i * 0.23) + i * 2) + live);
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
    const settle = Math.min(1, (now - changedAt) / 600);
    if (settle < 1) { g.globalAlpha = 1 - settle; g.drawImage(before, -BODY.centre, -BODY.lap); g.globalAlpha = 1; }
    g.globalAlpha = settle;
    g.drawImage(figure, -BODY.centre, -BODY.lap + pose.nod * 6);
    g.globalAlpha = 1;
    g.restore();

    // Pessoa comes and goes as he pleases.
    if (now > cat.next) cat = { on: !cat.on, since: now, next: now + (4 + Math.random() * 6) * 60000 };
    const catOn = window.alanScene?.cat ?? cat.on;
    const seen = Math.min(1, (now - cat.since) / 1500);
    const catAlpha = window.alanScene?.cat != null ? 1 : catOn ? seen : 1 - seen;
    if (catAlpha > 0.01 && (catOn || seen < 1)) {
      const w = (art.cat.width / art.cat.height) * CAT.height;
      g.globalAlpha = catAlpha;
      g.drawImage(art.cat, CAT.x - w / 2, CAT.y - CAT.height, w, CAT.height);
      g.globalAlpha = 1;
    }

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
