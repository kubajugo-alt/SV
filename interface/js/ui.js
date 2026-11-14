// DOM layer: instrument-panel readouts, typed-in speech, alert takeover, boot.

import { store, mode, isDark } from './store.js';
import qrcode from './vendor/qrcode.js';
import { tv } from './avatar.js';

const codes = new Map();   // address -> image source, so a redraw does not compute the code again

function qr(url) {
  const img = document.createElement('img');
  img.className = 'qr';
  img.alt = 'Kod QR';
  try {
    if (!codes.has(url)) {
      const code = qrcode(0, 'M');
      code.addData(url);
      code.make();
      codes.set(url, code.createDataURL(4, 8));
    }
    img.src = codes.get(url);
  } catch { img.hidden = true; }           // an address too long for a code: the link alone
  return img;
}

const $ = (id) => document.getElementById(id);

const STATUS = { idle: 'CZUWAM', listening: 'SŁUCHAM', thinking: 'MYŚLĘ', speaking: 'MÓWIĘ', alert: 'ALARM' };
const FLAT = { away: 'TRYB WYJAZDU', guest: 'TRYB GOŚCIA', work: 'TRYB PRACY', night: 'TRYB NOCNY' };
const ALERT = { smoke: 'DYM', co: 'CZAD', water: 'WYCIEK WODY' };
const ALERT_RANK = ['co', 'smoke', 'water']; // most dangerous first
const ROOM = { salon: 'SALON', sypialnia: 'SYPIALNIA', kuchnia: 'KUCHNIA', przedpokoj: 'PRZEDPOKÓJ', lazienka: 'ŁAZIENKA' };
const LINK = { solo: '', demo: 'DEMO', connecting: 'ŁĄCZENIE…', online: 'ONLINE', offline: 'BRAK ŁĄCZA' };

const num = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits).replace('.', ',') : '--');

// A cell whose value just changed glows for a few seconds, so a change made by
// ALAN (or anyone) is easy to spot in the panel.
const FLASH_MS = 6000;
const lastValue = new Map();   // label -> value
const changedAt = new Map();   // label -> performance.now()
let flashTimer = 0;
let quietUntil = 0;           // no glow while the panel fills in after start-up

function cell(label, value, warn = false, flash = true) {
  const el = document.createElement('span');
  el.className = warn ? 'cell warn' : 'cell';
  const b = document.createElement('b');
  b.textContent = label;
  el.append(b, value);

  const now = performance.now();
  if (flash && now > quietUntil && lastValue.has(label) && lastValue.get(label) !== value) changedAt.set(label, now);
  lastValue.set(label, value);
  const age = now - (changedAt.get(label) ?? -Infinity);
  if (age < FLASH_MS) {
    el.classList.add('changed');
    el.style.animationDelay = `${-age}ms`;   // the panel is rebuilt on every render; keep the glow's clock
  }
  return el;
}

// --- typed-in text -------------------------------------------------------
let typing = 0;
let clearTimer = 0;
let shown = 0;

// --- his words on the desk top -------------------------------------------
// The room painting covers the window (as avatar.js draws it); the desk top runs from y 735 to 955 of its 1080.
const ROOM_W = 1920, ROOM_H = 1080, DESK = [735, 955];

function placeOnDesk() {
  const k = Math.max(innerWidth / ROOM_W, innerHeight / ROOM_H);
  const offset = (innerHeight - ROOM_H * k) / 2;
  const top = Math.max(0, offset + DESK[0] * k);
  const bottom = Math.min(innerHeight - 4, offset + DESK[1] * k);
  document.documentElement.style.setProperty('--desk-top', `${top}px`);
  document.documentElement.style.setProperty('--desk-h', `${Math.max(60, bottom - top)}px`);
  fitWords();
}

/** The largest size, up to the usual one, at which everything in the box fits on the desk. */
function fitWords() {
  const box = $('speech');
  let size = 1.6;
  box.style.setProperty('--say-size', `${size}em`);
  // The height of what is in the box (centred content that overflows is not counted by scrollHeight).
  const used = () => [...box.children].filter((el) => !el.hidden).reduce((sum, el) => {
    const style = getComputedStyle(el);
    return sum + el.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }, 0);
  while (size > 0.7 && used() > box.clientHeight - 2) {
    size -= 0.05;
    box.style.setProperty('--say-size', `${size}em`);
  }
}

function type(text, duration) {
  clearInterval(typing);
  clearTimeout(clearTimer);
  const out = $('typed');
  out.textContent = '';
  if (!text) return;
  // Finish typing a little before the voice does; never slower than 25 cps.
  const step = Math.min(40, (duration * 0.85) / text.length);
  let i = 0;
  // Size for the whole line first, so the text does not shrink as it is typed.
  out.textContent = text;
  fitWords();
  out.textContent = '';
  typing = setInterval(() => {
    out.textContent = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(typing);
      clearTimer = setTimeout(() => { out.textContent = ''; }, duration * 0.15 + 8000);
    }
  }, step);
}

// --- what he did, as cards beside him --------------------------------------
// Each thing he did (or could not do), a link to open on the phone, a reminder coming due: one card,
// sliding in at the right and leaving on its own after a while (links stay longer: they are for scanning).
const NOTE_MS = { done: 20000, failed: 25000, link: 120000, reminder: 60000, map: 90000, picture: 90000 };
const KIND = {
  done: ['ZROBIONE', '✓'], failed: ['NIE WYSZŁO', '!'], link: ['DO ZESKANOWANIA TELEFONEM', '↗'], reminder: ['PRZYPOMNIENIE', '◷'],
  map: ['NA MAPIE', '⌖'], picture: ['TAK TO WYGLĄDA', '◩'],
};
const noteSeen = new Map();     // text -> when it first showed
let noteTimer = 0;

/** A small map from OpenStreetMap's tiles, the place marked with a brass pin. */
function mapCard(text) {
  const [, name, lat, lon] = /^mapa na ekranie:\s*(.*?)\s*@(-?[\d.]+),(-?[\d.]+)/i.exec(text) || [];
  const box = document.createElement('figure');
  box.className = 'map';
  const caption = document.createElement('figcaption');
  caption.textContent = name || '';
  if (!lat) { box.append(caption); return box; }
  const W = 360, H = 220, Z = 15;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;               // sharp on a large screen
  const g = canvas.getContext('2d');
  g.scale(2, 2);
  const n = 2 ** Z;
  const x = ((+lon + 180) / 360) * n;
  const rad = (+lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const px = x * 256 - W / 2, py = y * 256 - H / 2;          // the top-left corner, in world pixels
  const pin = () => {
    g.fillStyle = 'rgba(30, 16, 6, .35)';
    g.beginPath(); g.ellipse(W / 2, H / 2 + 2, 7, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9963f'; g.strokeStyle = '#2a1608'; g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, H / 2 - 16, 9, Math.PI, 0); g.lineTo(W / 2, H / 2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#f8ead0'; g.beginPath(); g.arc(W / 2, H / 2 - 16, 3.5, 0, Math.PI * 2); g.fill();
  };
  g.fillStyle = '#e8dcc4'; g.fillRect(0, 0, W, H);
  let waiting = 0;
  for (let tx = Math.floor(px / 256); tx <= Math.floor((px + W) / 256); tx++) {
    for (let ty = Math.floor(py / 256); ty <= Math.floor((py + H) / 256); ty++) {
      const img = new Image();
      waiting++;
      img.onload = img.onerror = () => {
        if (img.naturalWidth) g.drawImage(img, tx * 256 - px, ty * 256 - py);
        if (--waiting === 0) { g.fillStyle = 'rgba(120, 70, 20, .12)'; g.fillRect(0, 0, W, H); pin(); }   // a warm wash so it sits in the room
      };
      img.src = `https://tile.openstreetmap.org/${Z}/${((tx % n) + n) % n}/${ty}.png`;
    }
  }
  const credit = document.createElement('small');
  credit.textContent = '© OpenStreetMap';
  box.append(canvas, caption, credit);
  return box;
}

/** A picture from the web, with what it shows. */
function pictureCard(text) {
  const [, title, url] = /^obraz na ekranie:\s*(.*?)\s+(https:\/\/\S+)$/i.exec(text) || [];
  const box = document.createElement('figure');
  box.className = 'picture';
  const img = document.createElement('img');
  img.alt = title || '';
  img.referrerPolicy = 'no-referrer';
  img.src = url || '';
  img.onerror = () => { img.hidden = true; };
  const caption = document.createElement('figcaption');
  caption.textContent = title || '';
  box.append(img, caption);
  return box;
}

function kindOf(a) {
  if (!a.ok) return 'failed';
  if (/^mapa na ekranie:/i.test(a.text)) return 'map';
  if (/^obraz na ekranie:/i.test(a.text)) return 'picture';
  if (/https:\/\//.test(a.text)) return 'link';
  if (/^(minutnik|przypomnienie|\p{L}+, przypomnienie|za \d+ min)/iu.test(a.text)) return 'reminder';
  return 'done';
}

const pictures = new Map();   // map and picture cards, kept so they are not fetched again on every redraw

function drawNotes(actions) {
  const now = Date.now();
  for (const key of pictures.keys()) if (!actions.some((a) => a.text === key)) pictures.delete(key);
  for (const key of noteSeen.keys()) if (!actions.some((a) => a.text === key)) noteSeen.delete(key);
  const live = actions.filter((a) => {
    if (!noteSeen.has(a.text)) noteSeen.set(a.text, now);
    return now - noteSeen.get(a.text) < NOTE_MS[kindOf(a)];
  }).filter((a, i, all) => !/^(mapa|obraz) na ekranie:/i.test(a.text)            // one map or picture at a time: the newest
    || !all.slice(i + 1).some((b) => /^(mapa|obraz) na ekranie:/i.test(b.text)));
  $('actions').replaceChildren(...live.slice(-3).reverse().map((a) => {   // the newest three, newest on top
    const kind = kindOf(a);
    const li = document.createElement('li');
    li.className = `note ${kind}`;
    const left = NOTE_MS[kind] - (now - noteSeen.get(a.text));
    li.style.setProperty('--life', `${left}ms`);
    const head = document.createElement('div');
    head.className = 'note-head';
    head.innerHTML = '<span class="mark"></span><span class="label"></span><span class="when"></span>';
    head.querySelector('.mark').textContent = KIND[kind][1];
    head.querySelector('.label').textContent = KIND[kind][0];
    head.querySelector('.when').textContent = new Date(noteSeen.get(a.text)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const body = document.createElement('div');
    body.className = 'note-body';
    if (kind === 'map' || kind === 'picture') {
      if (!pictures.has(a.text)) {                     // made once, and put on the television in the room as well
        const fig = kind === 'map' ? mapCard(a.text) : pictureCard(a.text);
        pictures.set(a.text, fig);
        tv.picture = fig.querySelector('canvas, img');   // a newer one takes the television over
        tv.on = performance.now();
        tv.off = tv.on + left;
      }
      body.append(pictures.get(a.text));
      li.append(head, body);
      return li;
    }
    const text = a.text.replace(/^link na ekranie:\s*/i, '').replace(/^(\p{L}+), przypomnienie:\s*/u, '$1: ');
    for (const part of text.split(/(https:\/\/\S+)/)) {
      if (!part.startsWith('https://')) { if (part.trim()) body.append(part.replace(/\s+oraz\s*$/, '')); continue; }
      const link = document.createElement('a');
      link.href = part; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = new URL(part).hostname.replace(/^www\./, '');
      const scan = document.createElement('figure');
      scan.className = 'scan';
      scan.append(qr(part), link);
      body.append(scan);
    }
    li.append(head, body);
    return li;
  }));
  clearTimeout(noteTimer);
  const next = Math.min(...live.map((a) => NOTE_MS[kindOf(a)] - (now - noteSeen.get(a.text))));
  if (Number.isFinite(next)) noteTimer = setTimeout(() => drawNotes(store.get().actions), Math.max(200, next + 50));
}

// --- render --------------------------------------------------------------
function render(s, config) {
  const m = mode(s);
  const dark = isDark(config, s);
  document.body.dataset.alan = m;
  document.body.dataset.flat = dark ? 'dark' : s.flat;

  $('status').textContent = `> ${STATUS[m]}`;
  $('mode').textContent = FLAT[s.flat] || '';

  const alerts = Object.values(s.alerts).sort((a, b) => ALERT_RANK.indexOf(a.kind) - ALERT_RANK.indexOf(b.kind));
  $('alert').hidden = !alerts.length;
  if (alerts.length) {
    $('alert-kind').textContent = ALERT[alerts[0].kind] || 'ALARM';
    $('alert-where').textContent = [...new Set(alerts.map((a) => ROOM[a.room] || a.room))].join(' · ');
  }

  if (s.utterance !== shown) {
    shown = s.utterance;
    type(s.text, Math.max(1500, s.speakingUntil - performance.now()));
  }

  drawNotes(s.actions);

  $('rooms').replaceChildren(...Object.keys(ROOM)
    .filter((r) => s.rooms[r])
    .map((r) => {
      const { temp, hum, light, heating } = s.rooms[r];
      let value = `${num(temp, 1)}°` + (Number.isFinite(hum) ? ` ${num(hum)}%` : '');
      if (light) value += light.on ? ` · ŚWIATŁO ${light.pct ? `${light.pct}%` : 'WŁ.'}` : ' · ŚWIATŁO WYŁ.';
      if (Number.isFinite(heating)) value += ` · GRZANIE ${num(heating, 1)}°`;
      return cell(ROOM[r], value);
    }));

  const home = Object.keys(s.presence).filter((p) => s.presence[p]).join(' + ') || 'NIKOGO';
  const vitals = s.timers.map((t) => {
    const left = Math.max(0, Math.round((t.endsAt - Date.now()) / 1000));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return cell(`MINUTNIK${t.label ? ` ${t.label}` : ''}`, clock, left <= 10, false);   // a countdown always changes
  });
  if (Object.keys(s.presence).length) vitals.push(cell('W DOMU', home));
  if (s.outdoor != null) vitals.push(cell('ZEWN.', `${num(s.outdoor, 1)}°`));
  if (s.co2 != null) vitals.push(cell('CO2', `${num(s.co2)} PPM`, s.co2 > 1200));
  if (s.battery != null) vitals.push(cell('BATERIA', `${num(s.battery)}%`, s.battery < 20));
  if (LINK[s.link]) vitals.push(cell('ŁĄCZE', LINK[s.link], s.link === 'offline'));
  // Who he is talking with and how to reach him: one quiet line in the top bar, not a panel row.
  $('who').textContent = s.link === 'solo'
    ? `· ${s.person.toUpperCase()} · ${s.handsfree ? 'POWIEDZ „ALAN”' : 'SPACJA = MÓW'}${s.initiative ? '' : ' · BEZ ZAGADYWANIA'} · ? POMOC`
    : '';
  $('vitals').replaceChildren(...vitals);
  // The panel only appears when there is something to read in it (sensors, timers, presence).
  document.querySelector('.panel').hidden = !vitals.length && !$('rooms').childElementCount;

  // One more render when the newest glow runs out, to drop the class.
  clearTimeout(flashTimer);
  const newest = Math.max(-Infinity, ...changedAt.values());
  const left = FLASH_MS - (performance.now() - newest);
  if (left > 0) flashTimer = setTimeout(() => render(store.get(), config), left + 50);
}

function clock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric' }).replace(',', '')
    + ' · ' + now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export function startUI(config) {
  quietUntil = performance.now() + 4000;
  store.subscribe((s) => render(s, config));
  addEventListener('resize', placeOnDesk);
  placeOnDesk();
  clock();
  setInterval(clock, 1000);
}

// --- boot sequence -------------------------------------------------------
const BOOT_LINES = [
  'ALAN · AUTONOMOUS LOCAL AI NODE',
  '',
  'PAMIĘĆ ................ 16384 MB OK',
  'SIEĆ B ................ OK',
  'HOME ASSISTANT ........ OK',
  'ZIGBEE ................ OK',
  'MODEL JĘZYKOWY ........ OK',
  'CZUJNIKI DYMU / CO .... OK',
  '',
  'DZIEŃ DOBRY.',
];

function chime() {
  try {
    const ac = new AudioContext();
    [[220, 0], [330, 0.12], [440, 0.24]].forEach(([freq, at]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.05, ac.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.5);
      osc.connect(gain).connect(ac.destination);
      osc.start(ac.currentTime + at);
      osc.stop(ac.currentTime + at + 0.5);
    });
  } catch { /* autoplay blocked or no audio device — boot stays silent */ }
}

export function boot(config) {
  const el = $('boot');
  el.hidden = false;
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i === BOOT_LINES.length) {
        if (config.chime) chime();
        setTimeout(() => { el.hidden = true; resolve(); }, 900);
        return;
      }
      el.textContent += BOOT_LINES[i++] + '\n';
      setTimeout(next, 140 + Math.random() * 160);
    };
    next();
  });
}
