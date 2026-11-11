// Plays a speech envelope into `signal.level` so the trace moves with the voice.
// The envelope is the amplitude of the very audio buffer the TTS engine plays
// (spec §33); when a feed can't supply one we synthesise a plausible cadence.

import { store, signal } from './store.js';

let raf = 0;

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

/**
 * @param {{text?: string, envelope?: number[], rate?: number}} utterance
 *   envelope: amplitudes 0..1 sampled at `rate` Hz (default 50), starting now.
 */
export function say({ text = '', envelope, rate = 50 }) {
  const env = envelope?.length ? envelope : synthEnvelope(text, rate);
  const start = performance.now();
  const duration = (env.length / rate) * 1000;
  store.set({ text, speakingUntil: start + duration, utterance: store.get().utterance + 1 });

  cancelAnimationFrame(raf);
  const tick = (now) => {
    const pos = Math.max(0, ((now - start) / 1000) * rate); // rAF time can predate `start`
    if (pos >= env.length - 1) {
      signal.level = 0;
      store.set({ speakingUntil: 0 }); // re-render: back to the feed's state
      return;
    }
    const i = Math.floor(pos);
    signal.level = env[i] + (env[i + 1] - env[i]) * (pos - i);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return duration;
}

/** Live level outside speech, e.g. room audio while listening. */
export function level(value) {
  if (performance.now() >= store.get().speakingUntil) signal.level = Math.min(1, Math.max(0, value));
}
