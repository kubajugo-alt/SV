// Timers and reminders. Every 2 s the page asks the server (serve.py /agenda)
// what has come due — ALAN then says it without being asked — and what is
// still running, which the panel shows as a countdown.

import { store } from './store.js';
import { say } from './speech.js';

export function startAgenda(config) {
  if (!config.agenda) return;
  let polling = 0;

  async function poll() {
    let agenda;
    try {
      const res = await fetch(config.agenda);
      if (res.status === 503 || res.status === 404) { clearInterval(polling); return; }   // no mind behind this server
      if (!res.ok) throw new Error(`${res.status}`);
      agenda = await res.json();
    } catch {
      return;   // server restarting; try again in 2 s
    }
    const now = Date.now();
    const patch = { timers: agenda.timers.map((t) => ({ label: t.label, endsAt: now + t.seconds * 1000 })) };
    if (agenda.say.length) {
      patch.actions = agenda.say.map((text) => ({ ok: true, text: text.replace(/\.$/, '') }));
      say({ text: agenda.say.join(' ') });
    }
    store.set(patch);
  }

  polling = setInterval(poll, config.agendaEvery || 2000);
  // The countdown ticks every second between polls.
  setInterval(() => { if (store.get().timers.length) store.set({}); }, 1000);
  poll();
}
