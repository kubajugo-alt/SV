// ALAN's eyes: the laptop's own webcam, off unless switched on (key O; the choice is
// remembered on this machine). About once a second a small, low-resolution frame is
// searched for a face (face-api, running in this page). A face he was shown in the same
// window (enrolment, key O) is Kuba or Hubert; any other face is a guest and is
// neither greeted nor kept. When someone he knows comes back after a while, the
// conversation switches to them and he greets them (an 'arrived' nudge, initiative.js).
//
// Privacy: frames, pictures and face descriptors never leave this browser. The
// descriptors live only in this browser's localStorage; nothing here calls the server
// except the greeting, which carries a name and nothing else. A mark in the top bar
// shows while the camera is on.

import { store, signal } from './store.js';
import { overlay } from './login.js';

// Pinned, so the code that sees the household's faces cannot change under it.
const FACE_API = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
const EVERY = 1000;               // ms between looks
const MATCH = 0.5;                // descriptor distance under which it is the same face (face-api's usual 0.6, stricter)
const ARRIVED_AFTER = 2 * 60000;  // nobody in view this long, then a face: someone came in
const AWAY_AFTER = 10 * 60000;    // nobody this long: "you were away" is worth saying
const NAME_WITHIN = 20000;        // after a face appears, how long it may take to see who it is (turned away, bad light)
const SAMPLES = 5;                // looks taken when someone shows him their face

const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const keep = (key, value) => { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private window: forget it */ } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The faces he knows: person -> descriptors (arrays of 128 numbers), from this browser only. */
function faces() {
  try { return JSON.parse(recall('alan.faces') || '{}') || {}; } catch { return {}; }
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** Whose face this is, or '' for a stranger. */
function whose(descriptor, known) {
  let best = '', nearest = MATCH;
  for (const [person, samples] of Object.entries(known)) {
    for (const sample of samples) {
      const d = distance(descriptor, sample);
      if (d < nearest) { nearest = d; best = person; }
    }
  }
  return best;
}

let api = null;
/** face-api and its three small models (detector, landmarks, recogniser), fetched once, when first needed. */
function faceApi() {
  api ||= (async () => {
    const mod = await import(FACE_API);
    const faceapi = mod.nets ? mod : mod.default;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
    ]);
    return faceapi;
  })().catch((err) => { api = null; throw err; });
  return api;
}

export function startEyes(config) {
  const people = config.people || [config.person];
  const video = document.createElement('video');   // never in the page: frames go only to the detector
  video.muted = true;
  video.playsInline = true;
  let stream = null;
  let timer = 0;
  let looking = false;            // a look (or an enrolment) is under way
  let seenAt = Date.now();        // last time any face was in view
  let arriving = null;            // { at, away }: a face appeared after an absence; whose is not known yet
  let open = null;                // the overlay
  let note = '';

  const mark = document.createElement('span');
  mark.id = 'cam';
  mark.hidden = true;
  mark.textContent = '● KAMERA';
  mark.title = 'Kamera włączona. Obraz zostaje w tym komputerze.';
  document.querySelector('.bar .name')?.append(mark);

  const options = (faceapi) => new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });

  async function look() {
    if (looking || !stream || video.readyState < 2) return;
    looking = true;
    try {
      const faceapi = await faceApi();
      const found = await faceapi.detectAllFaces(video, options(faceapi)).withFaceLandmarks(true).withFaceDescriptors();
      seen(found);
    } catch (err) {
      console.warn('ALAN cannot see:', err.message);
    } finally { looking = false; }
  }

  function seen(found) {
    const now = Date.now();
    if (!found.length) {
      signal.gaze = 0;
      if (now - seenAt > AWAY_AFTER && !recall('alan.away')) keep('alan.away', String(seenAt));   // he can say you were away
      return;
    }
    if (now - seenAt >= ARRIVED_AFTER) arriving = { at: now, away: now - seenAt };   // a new coming-in replaces an old unrecognised one
    seenAt = now;
    // His head turns a little towards the largest face. The camera's picture is not mirrored:
    // the left of the picture is the right of the screen, as he looks out of it.
    const face = found.reduce((a, b) => (b.detection.box.width * b.detection.box.height > a.detection.box.width * a.detection.box.height ? b : a));
    const box = face.detection.box;
    signal.gaze = Math.max(-1, Math.min(1, -(((box.x + box.width / 2) / (video.videoWidth || 320)) * 2 - 1)));
    if (!arriving) return;
    if (now - arriving.at > NAME_WITHIN) { arriving = null; return; }   // a guest, or someone who never looked: no greeting
    const known = faces();
    const person = found.map((f) => whose(f.descriptor, known)).find((p) => p && people.includes(p));
    if (!person) return;
    const { away } = arriving;
    arriving = null;
    store.set({ person });
    const awayFrom = Number(recall('alan.away'));
    keep('alan.away', null);
    const minutes = Math.round((now - (awayFrom || now - away)) / 60000);
    dispatchEvent(new CustomEvent('alan:nudge', { detail: { kind: 'arrived', extra: minutes >= AWAY_AFTER / 60000 ? { away: minutes } : {} } }));
  }

  async function on() {
    if (stream) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();
      await faceApi();
    } catch (err) {
      console.warn('ALAN cannot use the camera:', err.message);
      note = 'Nie udało się włączyć kamery albo wczytać rozpoznawania twarzy.';
      off(false);
      return false;
    }
    keep('alan.eyes', 'on');
    seenAt = Date.now();          // whoever switched him on is here already: no greeting for that
    arriving = null;
    mark.hidden = false;
    timer = setInterval(look, EVERY);
    return true;
  }

  function off(remember = true) {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    mark.hidden = true;
    signal.gaze = 0;
    if (remember) keep('alan.eyes', 'off');
  }

  /** A few looks at the one face in view, kept as this person's. */
  async function enrol(person) {
    if (!(await on())) return draw();
    note = `${person.toUpperCase()}: patrz w kamerę…`;
    draw();
    while (looking) await pause(50);
    looking = true;
    const samples = [];
    try {
      const faceapi = await faceApi();
      for (let i = 0; i < SAMPLES * 2 && samples.length < SAMPLES; i++) {
        const found = await faceapi.detectAllFaces(video, options(faceapi)).withFaceLandmarks(true).withFaceDescriptors();
        if (found.length === 1) samples.push(Array.from(found[0].descriptor, (v) => Math.round(v * 1e4) / 1e4));
        await pause(400);
      }
    } catch (err) {
      console.warn('ALAN cannot see:', err.message);
    } finally { looking = false; }
    if (samples.length < 3) note = 'Nie widzę wyraźnie jednej twarzy. Spróbuj jeszcze raz, sam przed kamerą, w dobrym świetle.';
    else {
      keep('alan.faces', JSON.stringify({ ...faces(), [person]: samples }));
      note = `Zapamiętałem: ${person.toUpperCase()}.`;
    }
    draw();
  }

  function draw() {
    if (!open) return;
    const known = faces();
    open.querySelector('#ey-state').textContent = stream
      ? 'Kamera włączona. Obraz i twarze zostają w tej przeglądarce — nic nie wychodzi do sieci.'
      : 'Kamera wyłączona.';
    open.querySelector('#ey-toggle').textContent = stream ? 'WYŁĄCZ KAMERĘ' : 'WŁĄCZ KAMERĘ';
    const view = open.querySelector('video');
    view.hidden = !stream;
    if (view.srcObject !== stream) { view.srcObject = stream; if (stream) view.play().catch(() => {}); }
    open.querySelector('#ey-known').textContent = 'Zna twarze: ' + (people.filter((p) => known[p]).map((p) => p.toUpperCase()).join(', ') || 'jeszcze żadnej');
    open.querySelector('#ey-note').textContent = note;
  }

  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyO' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    note = '';
    open = overlay('<label>OCZY ALANA</label><p id="ey-state"></p><video muted playsinline hidden></video><p id="ey-known"></p>'
      + '<p><button type="button" id="ey-toggle"></button></p><p id="ey-enrol"></p>'
      + '<p><button type="button" id="ey-forget">ZAPOMNIJ TWARZE</button> <button type="button" id="ey-close">ZAMKNIJ</button></p><p id="ey-note"></p>');
    open.classList.add('eyes');
    open.tabIndex = -1;
    open.focus();
    for (const person of people) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `TO JA: ${person.toUpperCase()}`;
      button.addEventListener('click', () => enrol(person));
      open.querySelector('#ey-enrol').append(button, ' ');
    }
    const close = () => { open.querySelector('video').srcObject = null; open.remove(); open = null; };
    open.querySelector('#ey-toggle').addEventListener('click', async () => { note = ''; if (stream) off(); else await on(); draw(); });
    open.querySelector('#ey-forget').addEventListener('click', (ev) => {
      if (ev.target.dataset.sure !== '1') { ev.target.dataset.sure = '1'; ev.target.textContent = 'NA PEWNO? KLIKNIJ JESZCZE RAZ'; return; }
      keep('alan.faces', null);
      ev.target.dataset.sure = ''; ev.target.textContent = 'ZAPOMNIJ TWARZE';
      note = 'Zapomniałem wszystkie twarze.';
      draw();
    });
    open.querySelector('#ey-close').addEventListener('click', close);
    open.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); });   // his other keys rest while this is open
    open.addEventListener('submit', (ev) => ev.preventDefault());
    draw();
  });

  if (recall('alan.eyes') === 'on' && navigator.mediaDevices?.getUserMedia) on();
}
