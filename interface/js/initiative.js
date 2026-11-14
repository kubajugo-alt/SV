// ALAN speaks first, now and then: a greeting with the day's plan at the first
// sign of you in the morning, a remark after a long silence, a question in the
// evening. The server writes the line (serve.py /chat with `nudge`); it answers
// with nothing while a meeting from the calendar is on. Key I switches this off
// and on; the choice is remembered on this machine.

import { store, mode } from './store.js';
import { say } from './speech.js';

const today = () => new Date().toDateString();
const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window: forget it */ } };

export function startInitiative(config) {
  const rules = config.initiative;
  if (!config.chat || !rules) return;
  store.set({ initiative: rules.on && recall('alan.initiative') !== 'off' });

  let lastVoice = Date.now();       // when either of them last spoke
  let seenToday = false;            // a key or pointer has moved since midnight
  let nextIdle = 0;
  const idleGap = () => rules.idleMinutes * 60000 * (0.75 + Math.random() * 0.5);
  nextIdle = Date.now() + idleGap();

  const touched = () => { lastVoice = Date.now(); nextIdle = lastVoice + idleGap(); };
  addEventListener('alan:chat', touched);
  for (const type of ['keydown', 'pointerdown', 'pointermove']) addEventListener(type, () => { seenToday = true; }, { passive: true });

  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyI' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const on = !store.get().initiative;
    keep('alan.initiative', on ? 'on' : 'off');
    store.set({ initiative: on });
  });

  async function nudge(kind) {
    store.set({ busy: true });
    let reply = '';
    try {
      const res = await fetch(config.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nudge: kind, person: store.get().person, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (res.ok) ({ reply = '' } = await res.json());
    } catch { /* no model behind the server: he stays quiet */ }
    store.set({ busy: false });
    touched();
    if (reply) say({ text: reply });
  }

  setInterval(() => {
    const s = store.get();
    const hour = new Date().getHours();
    if (!s.initiative || s.busy || s.flat === 'studio' || document.hidden || mode(s) !== 'idle') return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.value) return;   // you are typing to him
    if (hour < rules.from || hour >= rules.to) return;
    if (seenToday && recall('alan.morning') !== today()) {
      keep('alan.morning', today());
      if (hour < 12) return void nudge('morning');
    }
    if (hour >= rules.eveningAt && recall('alan.evening') !== today() && Date.now() - lastVoice > 10 * 60000) {
      keep('alan.evening', today());
      return void nudge('evening');
    }
    if (Date.now() > nextIdle) nudge('idle');
  }, 20000);
}
