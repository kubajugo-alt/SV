// ALAN on screen: the painted character from the Alan Sanchez games, sitting
// at the desk in his 1960s living room. One 2D canvas, redrawn each frame.
//
// The body is one painting (art/alan/body.webp). His face is changed by laying
// small patches over it, exactly as the games do:
//   mouth shapes A-F (Rhubarb Lip Sync's basic shapes) while he speaks,
//   closed eyelids for a blink,
//   eight expressions (the whole face, worn while he is silent).
// The mouth follows Rhubarb cues when the server supplies them (signal.mouth),
// otherwise the loudness of his voice (signal.level).

import { store, signal, mode } from './store.js';

const ROOM = { w: 1920, h: 1080 };
// Where he sits in the room painting: centred on the armchair, cut off by the desk's top edge.
const SEAT = { x: 944, desk: 724, scale: 1.42 };
const BODY = { w: 261, h: 749, belt: 318, face: 122 };  // sprite px; `belt` meets the desk, `face` is the head's centre line
const MOUTH_BOX = [92, 51, 61, 67];
const FACE_BOX = [92, 38, 61, 80];
const MOUTHS = ['A', 'B', 'C', 'D', 'E', 'F'];
const FACES = ['anger', 'concern', 'embarrassed', 'fear', 'joy', 'mischievous', 'sadness', 'surprise'];
// Rhubarb's extended shapes and its rest shape, mapped onto the six that are painted.
const SHAPE = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'B', H: 'C', X: 'A' };
// The face each state wears; idle is neutral, with a passing smirk now and then.
const WEAR = { alert: 'fear', thinking: 'concern', listening: 'surprise' };
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
  const [room, body] = await Promise.all([
    load('room.jpg'),
    load('alan/body.webp'),
    keep('blink', 'alan/eyes_closed.webp'),
    ...MOUTHS.map((m) => keep(m, `alan/${m}.webp`)),
    ...FACES.map((face) => keep(face, `alan/emo_${face}.webp`)),
  ]);

  // He is composed off screen at sprite size, then placed in the room.
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
  const pose = { lean: 0, tilt: 0, nod: 0 };
  let running = false;

  function paintFigure(m, now) {
    let wear = WEAR[m];
    if (m === 'idle' && now > smirkAt) {
      wear = 'mischievous';
      if (now > smirkAt + 2600) smirkAt = now + 20000 + Math.random() * 30000;
    }
    if (now > blinkAt + 140) blinkAt = now + 2200 + Math.random() * 3800;
    const blinking = now > blinkAt;

    let want = 'A';
    if (m === 'speaking') want = SHAPE[signal.mouth] || mouthFor(signal.level);
    if (want !== mouth && now - mouthSince > 55) { mouth = want; mouthSince = now; } // never flicker faster than speech

    f.clearRect(0, 0, BODY.w, BODY.h);
    f.drawImage(body, 0, 0);
    if (m === 'speaking') {
      f.drawImage(art[mouth], ...MOUTH_BOX);
      if (blinking) f.drawImage(art.blink, ...MOUTH_BOX);
    } else if (wear) {
      f.drawImage(art[wear], ...FACE_BOX);
    } else if (blinking) {
      f.drawImage(art.blink, ...MOUTH_BOX);
    }
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
    g.drawImage(room, 0, 0);

    // Lamps and the radio dial: slow breathing; the radio also follows his voice.
    g.globalCompositeOperation = 'lighter';
    LAMPS.forEach(([x, y, r, strength], i) => {
      const live = i === 2 ? signal.level * 1.5 : 0;
      const a = strength * (0.55 + 0.45 * Math.sin(t * (0.5 + i * 0.23) + i * 2) + live);
      const glow = g.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, `rgba(255, 190, 110, ${Math.max(0, a)})`);
      glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      g.fillStyle = glow;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
    g.globalCompositeOperation = 'source-over';

    // Him: leans in to listen, tilts his head to think, nods along with his own voice.
    paintFigure(m, now);
    pose.lean += ((m === 'listening' ? 1 : m === 'alert' ? 0.6 : 0) - pose.lean) * 0.06;
    pose.tilt += ((m === 'thinking' ? 1 : 0) - pose.tilt) * 0.05;
    pose.nod += ((m === 'speaking' ? signal.level : 0) - pose.nod) * 0.2;
    const breath = Math.sin(t * 1.25) * 0.006;
    const scale = SEAT.scale * (1 + pose.lean * 0.035);
    g.save();
    g.beginPath();
    g.rect(0, 0, ROOM.w, SEAT.desk);          // the desk hides him from the belt down
    g.clip();
    g.translate(SEAT.x, SEAT.desk + 6);
    g.rotate(Math.sin(t * 0.4) * 0.004 + pose.tilt * 0.022);
    g.scale(scale, scale * (1 + breath));
    g.drawImage(figure, -BODY.face, -BODY.belt + pose.nod * 2.5);
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
