// Stand-in feed for developing the page before Home Assistant exists.
// Loops through a conversation; keys 1-6 force states by hand.

import { store } from '../store.js';
import { say, level } from '../speech.js';

const LINES = [
  'W salonie 21,5 stopnia. Hubert jest w domu.',
  'Światło w sypialni przygaszone. Dobranoc.',
  'Kurier zostawił paczkę przy drzwiach o 14:12.',
  'Wilgotność w kuchni spadła do 38%. Włączam nawilżacz.',
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function startDemo() {
  store.set({
    link: 'demo',
    rooms: {
      salon: { temp: 21.5, hum: 44 },
      sypialnia: { temp: 19.0, hum: 47 },
      kuchnia: { temp: 22.1, hum: 38 },
      przedpokoj: { temp: 20.4 },
      lazienka: { temp: 23.0, hum: 58 },
    },
    presence: { kuba: false, hubert: true },
    co2: 640,
    outdoor: 3.5,
    battery: 94,
  });

  let manual = false;
  let listenTimer = 0;
  const listen = () => {
    clearInterval(listenTimer);
    store.set({ alan: 'listening' });
    listenTimer = setInterval(() => (store.get().alan === 'listening' ? level(Math.random()) : clearInterval(listenTimer)), 120);
  };

  (async () => {
    for (let i = 0; ; i++) {
      await wait(6000);
      if (manual) continue;
      listen();
      await wait(2600);
      if (manual) continue;
      store.set({ alan: 'thinking' });
      await wait(2200);
      if (manual) continue;
      store.set({ alan: 'idle' });
      await wait(say({ text: LINES[i % LINES.length] }));
    }
  })();

  addEventListener('keydown', (e) => {
    const s = store.get();
    const actions = {
      1: () => store.set({ alan: 'idle' }),
      2: listen,
      3: () => store.set({ alan: 'thinking' }),
      4: () => say({ text: LINES[Math.floor(Math.random() * LINES.length)] }),
      5: () => store.set({ alerts: Object.keys(s.alerts).length ? {} : { demo: { kind: 'smoke', room: 'kuchnia' } } }),
      6: () => store.set({ flat: s.flat === 'studio' ? 'normal' : 'studio' }),
      0: () => { manual = false; },
    };
    if (!actions[e.key]) return;
    manual = e.key !== '0';
    actions[e.key]();
  });
}
