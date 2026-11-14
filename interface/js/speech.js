// ALAN's voice, and what moves his mouth: Rhubarb cues when the server sends
// them with the audio, and always the live level of the sound.
//
// Preferred path: play real speech audio (a URL from the feed, or the local
// TTS endpoint) through an analyser, so the mouth follows the exact sound
// coming out of the speakers (spec §33).
// Fallback: no audio available — animate from a supplied or synthesised
// envelope so the face still talks, silently.

import { store, signal } from './store.js';

// Extra delay between the computer and the speakers that the browser cannot know (a TV's own sound path).
const LATENCY = Number(new URLSearchParams(location.search).get('lipsync') || 0) / 1000;
let ttsUrl = '';       // e.g. '/tts?text=' — emptied if the endpoint turns out to be absent
let ctx = null;
let source = null;
let raf = 0;
let current = 0;       // id of the latest utterance; older ones give way
let onEnd = null;      // called once when the line being spoken stops, however it stops

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
  const done = onEnd;
  onEnd = null;
  done?.();
}

function begin(text, duration) {
  store.set({ text, preparing: false, speakingUntil: performance.now() + duration, utterance: store.get().utterance + 1 });
}

function finish() {
  signal.level = 0;
  signal.mouth = null;
  store.set({ speakingUntil: 0 }); // re-render: back to the feed's state
}

async function fetchAudio(url) {
  const ac = audioContext();
  if (ac.state !== 'running') throw new Error('audio is locked until the page is clicked');
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`${res.status} from ${url}`), { status: res.status });
  let cues = null;                       // [[start s, shape], ...] from Rhubarb Lip Sync, if the server has it
  try { cues = JSON.parse(res.headers.get('X-Mouth-Cues') || 'null'); } catch { /* go by loudness */ }
  return { buffer: await ac.decodeAudioData(await res.arrayBuffer()), cues };
}

function playAudio(text, buffer, radio, cues) {
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
  let startedAt = 0;
  let next = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    signal.level = Math.min(1, Math.sqrt(sum / samples.length) * 4); // speech RMS sits around 0.05–0.25
    if (cues?.length) {
      // What is heard now left the browser a little earlier (the sound card, the TV): the mouth follows the ear.
      const at = ctx.currentTime - startedAt - (ctx.outputLatency || ctx.baseLatency || 0) - LATENCY;
      while (next < cues.length && cues[next][0] <= at) signal.mouth = cues[next++][1];
    }
    raf = requestAnimationFrame(tick);
  };
  source.onended = () => { stop(); finish(); };
  begin(text, buffer.duration * 1000);
  source.start();
  startedAt = ctx.currentTime;
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
    if (pos >= env.length - 1) { stop(); return finish(); }
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
  if (store.get().flat === 'studio' && !Object.keys(store.get().alerts).length) return 0;   // recording: not a word
  const id = ++current;
  const url = audio || (ttsUrl && text ? ttsUrl + encodeURIComponent(text) : '');
  if (url) {
    try {
      store.set({ preparing: true });    // a heavy voice engine can take seconds
      const { buffer, cues } = await fetchAudio(url);
      if (id !== current) return 0;      // a newer utterance arrived while this one loaded
      stop();
      return playAudio(text, buffer, radio, cues);
    } catch (err) {
      console.warn('ALAN voice unavailable, mouthing silently:', err.message);
      if (!audio && (err.status === 404 || err.status === 503)) ttsUrl = ''; // no TTS on this server
      if (id !== current) return 0;
    }
  }
  stop();
  return playEnvelope(text, envelope?.length ? envelope : synthEnvelope(text, rate), rate);
}

// Lines kept ready to say at once: fetched once, then played from memory.
const ready = new Map();   // text -> Promise<{buffer, cues} | null>

function voiced(text) {
  if (ready.has(text)) return ready.get(text);
  const url = ttsUrl ? ttsUrl + encodeURIComponent(text) : '';
  return !url ? Promise.resolve(null) : fetchAudio(url).catch((err) => {
    console.warn('ALAN voice unavailable, mouthing silently:', err.message);
    if (err.status === 404 || err.status === 503) ttsUrl = '';
    return null;
  });
}

/** Have these lines recorded ahead of need (the little things he says while he thinks). */
export function prepare(lines) {
  for (const line of lines) {
    if (ready.has(line)) continue;
    const audio = voiced(line);
    ready.set(line, audio);
    audio.then((got) => { if (!got) ready.delete(line); });      // not recorded this time: try again later
  }
}

/** Whether a line is recorded and can be said without a wait. */
export const prepared = (line) => ready.has(line);

/**
 * Speak an answer that arrives sentence by sentence: each sentence's audio is fetched the moment it
 * is known, and they are played in order, so he starts talking before the whole answer is written.
 * @returns {{push: (text: string) => void, end: () => Promise<void>}} end() resolves when he has finished (or was cut off)
 */
export function speakStream() {
  const quiet = store.get().flat === 'studio' && !Object.keys(store.get().alerts).length;   // recording: not a word
  const id = ++current;
  let line = Promise.resolve();
  let first = true;
  return {
    push(text) {
      if (!text || quiet || id !== current) return;
      if (first) { first = false; store.set({ preparing: true }); }
      const coming = voiced(text);
      line = line.then(async () => {
        const audio = await coming;
        if (id !== current) return;
        stop();
        await new Promise((resolve) => {
          onEnd = resolve;
          if (audio) playAudio(text, audio.buffer, false, audio.cues);
          else playEnvelope(text, synthEnvelope(text, 50), 50);
        });
      });
    },
    end() {
      return line.then(() => { if (id === current) store.set({ preparing: false }); });
    },
  };
}

/** Stop talking at once — someone is speaking to him. */
export function hush() {
  current++;                    // abandons a line still being prepared
  stop();
  store.set({ preparing: false });
  finish();
}

/** Live level outside speech, e.g. room audio while listening. */
export function level(value) {
  if (performance.now() >= store.get().speakingUntil) signal.level = Math.min(1, Math.max(0, value));
}
