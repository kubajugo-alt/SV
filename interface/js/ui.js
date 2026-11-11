// DOM layer: instrument-panel readouts, typed-in speech, alert takeover, boot.

import { store, mode, isDark } from './store.js';

const $ = (id) => document.getElementById(id);

const STATUS = { idle: 'CZUWAM', listening: 'SŁUCHAM', thinking: 'MYŚLĘ', speaking: 'MÓWIĘ', alert: 'ALARM' };
const FLAT = { away: 'TRYB WYJAZDU', guest: 'TRYB GOŚCIA', work: 'TRYB PRACY', night: 'TRYB NOCNY' };
const ALERT = { smoke: 'DYM', co: 'CZAD', water: 'WYCIEK WODY' };
const ALERT_RANK = ['co', 'smoke', 'water']; // most dangerous first
const ROOM = { salon: 'SALON', sypialnia: 'SYPIALNIA', kuchnia: 'KUCHNIA', przedpokoj: 'PRZEDPOKÓJ', lazienka: 'ŁAZIENKA' };
const LINK = { demo: 'DEMO', connecting: 'ŁĄCZENIE…', online: 'ONLINE', offline: 'BRAK ŁĄCZA' };

const num = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits).replace('.', ',') : '--');

function cell(label, value, warn = false) {
  const el = document.createElement('span');
  el.className = warn ? 'cell warn' : 'cell';
  const b = document.createElement('b');
  b.textContent = label;
  el.append(b, value);
  return el;
}

// --- typed-in text -------------------------------------------------------
let typing = 0;
let clearTimer = 0;
let shown = 0;

function type(text, duration) {
  clearInterval(typing);
  clearTimeout(clearTimer);
  const out = $('typed');
  out.textContent = '';
  if (!text) return;
  // Finish typing a little before the voice does; never slower than 25 cps.
  const step = Math.min(40, (duration * 0.85) / text.length);
  let i = 0;
  typing = setInterval(() => {
    out.textContent = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(typing);
      clearTimer = setTimeout(() => { out.textContent = ''; }, duration * 0.15 + 8000);
    }
  }, step);
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

  $('rooms').replaceChildren(...Object.keys(ROOM)
    .filter((r) => s.rooms[r])
    .map((r) => {
      const { temp, hum } = s.rooms[r];
      return cell(ROOM[r], `${num(temp, 1)}°` + (Number.isFinite(hum) ? ` ${num(hum)}%` : ''));
    }));

  const home = Object.keys(s.presence).filter((p) => s.presence[p]).join(' + ') || 'NIKOGO';
  const vitals = [cell('W DOMU', home)];
  if (s.outdoor != null) vitals.push(cell('ZEWN.', `${num(s.outdoor, 1)}°`));
  if (s.co2 != null) vitals.push(cell('CO2', `${num(s.co2)} PPM`, s.co2 > 1200));
  if (s.battery != null) vitals.push(cell('BATERIA', `${num(s.battery)}%`, s.battery < 20));
  vitals.push(cell('ŁĄCZE', LINK[s.link], s.link === 'offline'));
  $('vitals').replaceChildren(...vitals);
}

function clock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' })
    + '  ' + now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export function startUI(config) {
  store.subscribe((s) => render(s, config));
  clock();
  setInterval(clock, 1000);
}

// --- boot sequence -------------------------------------------------------
const BOOT_LINES = [
  'ALAN BIOS v22.0  (C) 1991 TARNOBRZEG',
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
      osc.type = 'square';
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
