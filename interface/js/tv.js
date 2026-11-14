// Bringing him onto the TV: when he is called by name, or speaks up on his own (a reminder,
// a timer, an alert), the page asks a small helper on the same machine (scripts/tv_samsung.py)
// to wake the TV and switch it to this computer's HDMI input. Off unless config.tv is set.

import { store } from './store.js';

export function startTV(config) {
  if (!config.tv) return;
  let last = 0;
  const show = () => {
    if (Date.now() - last < 15000) return;          // the helper is idempotent, but the TV need not hear it twice
    last = Date.now();
    fetch(`${config.tv.replace(/\/$/, '')}/show`, { method: 'POST' }).catch(() => {});
  };
  addEventListener('alan:wake', show);
  addEventListener('alan:chat', show);
  let utterance = store.get().utterance;
  store.subscribe((s) => {
    if (s.utterance !== utterance) { utterance = s.utterance; show(); }   // he says something: be on screen
    if (Object.keys(s.alerts).length) show();
  });
}
