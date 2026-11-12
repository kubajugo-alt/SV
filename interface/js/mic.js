// Talking to ALAN.
//
// Hold Space, speak, release: while the key is down the microphone is recorded
// and its level drives the face; on release the recording goes to the local
// speech recogniser (serve.py /stt) and the text is sent to him like a typed line.
//
// Or say his name (hands-free, key M): the microphone stays open, each stretch
// of speech is recognised on this machine, and it reaches him only if it starts
// with "Alan" — or follows within a few seconds of his own answer, so a
// conversation needs the name once. Everything else is dropped unread. He does
// not listen while he is speaking, so he never answers himself.

import { store, mode } from './store.js';
import { level, hush } from './speech.js';

const RATE = 16000;          // what the recogniser wants
const MIN_SECONDS = 0.35;    // shorter than this is a stray key press
// Hands-free listening.
const WAKE = /^[\s\p{P}]*(?:(?:hej|ej|cześć|halo|słuchaj|no)[\s\p{P}]+)?al+an(?:ie|ku)?(?![\p{L}])[\s\p{P}]*(.*)$/isu;
const PAUSE_MS = 800;        // this much silence ends a stretch of speech
const MAX_SECONDS = 20;
const FOLLOW_MS = 12000;     // after his answer, the next thing said needs no name
const NAME_MS = 8000;        // after a bare "Alan?", he waits this long for the rest
// What the recogniser tends to "hear" in noise and silence; never a message for him.
const PHANTOM = /dzięk\p{L}* za (oglądanie|uwagę)|napisy (stworzone|wykonane)|subskryb|zapraszam na|www\.|^\W*(dziękuję|dzięki|tak|no|aha|mhm)?\W*$/iu;

/** What was meant for him in a recognised sentence: the words after his name, '' for the bare name, null if he was not addressed. */
export function addressed(text) {
  const match = WAKE.exec(text || '');
  return match ? match[1].trim() : null;
}

function wav(samples) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return view.buffer;
}

async function resample(chunks, from) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const offline = new OfflineAudioContext(1, Math.ceil((length * RATE) / from), RATE);
  const buffer = offline.createBuffer(1, length, from);
  let at = 0;
  for (const c of chunks) { buffer.copyToChannel(c, 0, at); at += c.length; }
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

export function startMic(config, ask) {
  if (!config.stt || !ask || !navigator.mediaDevices?.getUserMedia) return;

  let ctx = null;
  let stream = null;
  let tap = null;        // { source, node } while recording
  let chunks = [];
  let held = false;

  async function begin() {
    held = true;
    hush();                                   // talking over him stops him
    dispatchEvent(new Event('alan:chat'));
    try {
      stream ||= await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      console.warn('ALAN cannot use the microphone:', err.message);
      held = false;
      return;
    }
    if (!held || tap) return;                 // key already released, or already recording
    ctx ||= new AudioContext();
    await ctx.resume();
    chunks = [];
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      chunks.push(data);
      let sum = 0;
      for (const s of data) sum += s * s;
      level(Math.sqrt(sum / data.length) * 5);
    };
    source.connect(node);
    node.connect(ctx.destination);            // a processor only runs when connected; it outputs silence
    tap = { source, node };
    store.set({ alan: 'listening' });
  }

  async function end() {
    held = false;
    if (!tap) return;
    tap.source.disconnect();
    tap.node.disconnect();
    tap = null;
    const recorded = chunks;
    chunks = [];
    const seconds = recorded.reduce((n, c) => n + c.length, 0) / ctx.sampleRate;
    if (seconds < MIN_SECONDS) { store.set({ alan: 'idle' }); return; }

    store.set({ alan: 'thinking' });
    let text = '';
    try {
      const res = await fetch(config.stt, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav(await resample(recorded, ctx.sampleRate)),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      text = (await res.json()).text;
    } catch (err) {
      console.warn('ALAN speech recognition failed:', err.message);
    }
    if (text) ask(text);
    else store.set({ alan: 'idle' });         // heard nothing intelligible
  }

  // --- hands-free ------------------------------------------------------------
  let open = null;            // { source, node } while the microphone stays open
  let floor = 0.004;          // running estimate of the room's noise
  let speech = [];            // chunks of the stretch being spoken
  let lead = [];              // the last moments before it, so the first syllable is kept
  let voiced = 0;             // ms of sound in the stretch
  let silent = 0;             // ms of silence since the last sound
  let awakeUntil = 0;         // until then, what is said is for him without his name
  let wasSpeaking = false;

  async function recognise(recorded, rate) {
    try {
      const res = await fetch(config.stt, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav(await resample(recorded, rate)),
      });
      return res.ok ? (await res.json()).text : '';
    } catch { return ''; }
  }

  async function heard(recorded, rate) {
    const awake = Date.now() < awakeUntil;
    if (awake) store.set({ alan: 'thinking' });
    const text = await recognise(recorded, rate);
    const forHim = addressed(text);
    if (forHim === '') {                        // just his name: he turns to listen
      awakeUntil = Date.now() + NAME_MS;
      hush();
      store.set({ alan: 'listening' });
      setTimeout(() => { if (Date.now() >= awakeUntil && store.get().alan === 'listening' && !tap) store.set({ alan: 'idle' }); }, NAME_MS + 100);
    } else if (forHim || (awake && text && !PHANTOM.test(text))) {
      awakeUntil = 0;
      ask(forHim || text);
    } else if (awake) {
      store.set({ alan: 'idle' });
    }
  }

  function listenOn(e) {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    const ms = (data.length / ctx.sampleRate) * 1000;
    const s = store.get();
    const m = mode(s);
    if (m === 'speaking') wasSpeaking = true;
    else if (wasSpeaking) { wasSpeaking = false; awakeUntil = Date.now() + FOLLOW_MS; }   // he has just finished: your turn
    if (tap || s.busy || s.flat === 'studio' || m === 'speaking' || s.preparing) { speech = []; voiced = 0; return; }
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    const loud = rms > Math.max(0.012, floor * 3.5);
    if (!loud && !speech.length) floor = floor * 0.97 + rms * 0.03;
    if (Date.now() < awakeUntil) level(rms * 5);       // his face follows you while he is listening
    if (!speech.length) {
      if (!loud) { lead.push(data); if (lead.length > 4) lead.shift(); return; }
      speech = [...lead, data]; lead = []; voiced = ms; silent = 0;
      return;
    }
    speech.push(data);
    if (loud) { voiced += ms; silent = 0; } else silent += ms;
    const seconds = (speech.length * data.length) / ctx.sampleRate;
    if (silent < PAUSE_MS && seconds < MAX_SECONDS) return;
    const done = speech;
    speech = [];
    if (voiced >= MIN_SECONDS * 1000) heard(done, ctx.sampleRate);
    voiced = 0;
  }

  async function handsfree(on) {
    if (!on) {
      if (open) { open.source.disconnect(); open.node.disconnect(); open = null; }
      store.set({ handsfree: false });
      return;
    }
    try {
      stream ||= await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      console.warn('ALAN cannot use the microphone:', err.message);
      store.set({ handsfree: false });
      return;
    }
    ctx ||= new AudioContext();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!open) {
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = listenOn;
      source.connect(node);
      node.connect(ctx.destination);
      open = { source, node };
    }
    store.set({ handsfree: true });
  }
  if (config.handsfree) handsfree(true);
  // A browser outside kiosk mode keeps audio asleep until the first key or click.
  for (const type of ['keydown', 'pointerdown']) addEventListener(type, () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });

  const typing = (e) => e.target instanceof HTMLInputElement;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || typing(e)) return;
    e.preventDefault();
    begin();
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space' && held) end(); });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey) handsfree(!store.get().handsfree);
  });
  addEventListener('blur', () => { if (held) end(); });
}
