// Talking to ALAN: hold Space, speak, release.
// While the key is down the microphone is recorded and its level drives the
// face; on release the recording goes to the local speech recogniser
// (serve.py /stt) and the recognised text is sent to ALAN like a typed line.
// Push-to-talk also keeps him from hearing his own voice from the TV.

import { store } from './store.js';
import { level, hush } from './speech.js';

const RATE = 16000;          // what the recogniser wants
const MIN_SECONDS = 0.35;    // shorter than this is a stray key press

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

  const typing = (e) => e.target instanceof HTMLInputElement;
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || typing(e)) return;
    e.preventDefault();
    begin();
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space' && held) end(); });
  addEventListener('blur', () => { if (held) end(); });
}
