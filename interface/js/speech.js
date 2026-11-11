// ALAN's voice, and the level that moves his mouth.
//
// Preferred path: play real speech audio (a URL from the feed, or the local
// TTS endpoint) through an analyser, so the mouth follows the exact sound
// coming out of the speakers (spec §33).
// Fallback: no audio available — animate from a supplied or synthesised
// envelope so the face still talks, silently.

import { store, signal } from './store.js';

let ttsUrl = '';       // e.g. '/tts?text=' — emptied if the endpoint turns out to be absent
let ctx = null;
let source = null;
let raf = 0;
let current = 0;       // id of the latest utterance; older ones give way

export function configureVoice(config) {
  ttsUrl = config.tts || '';
}

function audioContext() {
  ctx ||= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Outside kiosk mode browsers keep audio locked until the first interaction.
for (const type of ['keydown', 'pointerdown']) addEventListener(type, audioContext);

function stop() {
  cancelAnimationFrame(raf);
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source = null;
  }
}

function begin(text, duration) {
  store.set({ text, speakingUntil: performance.now() + duration, utterance: store.get().utterance + 1 });
}

function finish() {
  signal.level = 0;
  store.set({ speakingUntil: 0 }); // re-render: back to the feed's state
}

async function fetchAudio(url) {
  const ac = audioContext();
  if (ac.state !== 'running') throw new Error('audio is locked until the page is clicked');
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`${res.status} from ${url}`), { status: res.status });
  return ac.decodeAudioData(await res.arrayBuffer());
}

function playAudio(text, buffer, radio) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source = ctx.createBufferSource();
  source.buffer = buffer;
  let node = source;
  if (radio) {
    // Bandwidth-limited "90s hardware" voice for boot greetings and courier mode.
    for (const [type, frequency] of [['highpass', 450], ['lowpass', 2800]]) {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      node.connect(filter);
      node = filter;
    }
  }
  node.connect(analyser);
  analyser.connect(ctx.destination);

  const samples = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    signal.level = Math.min(1, Math.sqrt(sum / samples.length) * 4); // speech RMS sits around 0.05–0.25
    raf = requestAnimationFrame(tick);
  };
  source.onended = () => { stop(); finish(); };
  begin(text, buffer.duration * 1000);
  source.start();
  raf = requestAnimationFrame(tick);
  return buffer.duration * 1000;
}

function synthEnvelope(text, rate) {
  const seconds = Math.max(1.2, text.length * 0.065);
  const n = Math.round(seconds * rate);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const ch = text[Math.floor((i / n) * text.length)] || ' ';
    const pause = /[.,;:!?—]/.test(ch) ? 0.15 : 1;
    const syllable = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 4.3);
    const phrase = 0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 0.6 + 1);
    out[i] = Math.max(0, syllable * phrase * pause * (0.8 + 0.2 * Math.random()));
  }
  return out;
}

function playEnvelope(text, env, rate) {
  const start = performance.now();
  const duration = (env.length / rate) * 1000;
  begin(text, duration);
  const tick = (now) => {
    const pos = Math.max(0, ((now - start) / 1000) * rate); // rAF time can predate `start`
    if (pos >= env.length - 1) return finish();
    const i = Math.floor(pos);
    signal.level = env[i] + (env[i + 1] - env[i]) * (pos - i);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return duration;
}

/**
 * Speak. Resolves with the utterance's duration in ms once it has started.
 * @param {object} u
 * @param {string} [u.text]       shown on screen; also voiced via the TTS endpoint if no `audio`
 * @param {string} [u.audio]      URL of ready-made speech audio
 * @param {number[]} [u.envelope] silent fallback: amplitudes 0..1 at `rate` Hz
 * @param {number} [u.rate]
 * @param {boolean} [u.radio]     bandwidth-limited voice
 */
export async function say({ text = '', audio, envelope, rate = 50, radio = false }) {
  const id = ++current;
  const url = audio || (ttsUrl && text ? ttsUrl + encodeURIComponent(text) : '');
  if (url) {
    try {
      const buffer = await fetchAudio(url);
      if (id !== current) return 0;      // a newer utterance arrived while this one loaded
      stop();
      return playAudio(text, buffer, radio);
    } catch (err) {
      console.warn('ALAN voice unavailable, mouthing silently:', err.message);
      if (!audio && (err.status === 404 || err.status === 503)) ttsUrl = ''; // no TTS on this server
      if (id !== current) return 0;
    }
  }
  stop();
  return playEnvelope(text, envelope?.length ? envelope : synthEnvelope(text, rate), rate);
}

/** Live level outside speech, e.g. room audio while listening. */
export function level(value) {
  if (performance.now() >= store.get().speakingUntil) signal.level = Math.min(1, Math.max(0, value));
}
