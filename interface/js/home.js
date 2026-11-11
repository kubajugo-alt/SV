// Keeps the panel true to the flat: reads its state from the server
// (serve.py /home, backed by Home Assistant) at start, every 30 s, and right
// after ALAN has acted — so what he changed shows up at once.

import { store } from './store.js';

const OTHER = { 'CO2 w salonie (ppm)': 'co2', 'temperatura na zewnątrz (°C)': 'outdoor', 'bateria EcoFlow (%)': 'battery' };

export function startHome(config) {
  if (!config.home) return;
  let timer = 0;

  async function refresh() {
    let snap;
    try {
      const res = await fetch(config.home);
      if (res.status === 503) { clearInterval(timer); return; }   // no Home Assistant behind this server
      if (!res.ok) throw new Error(`${res.status}`);
      snap = await res.json();
    } catch (err) {
      console.warn('ALAN could not read the flat:', err.message);
      return;
    }
    const patch = { rooms: snap.rooms, presence: {} };
    for (const [who, there] of Object.entries(snap.presence)) patch.presence[who.toLowerCase()] = there;
    for (const [label, value] of Object.entries(snap.other)) {
      if (OTHER[label]) patch[OTHER[label]] = parseFloat(value);
    }
    store.set(patch);
  }

  timer = setInterval(refresh, 30000);
  addEventListener('alan:acted', refresh);
  refresh();
}
