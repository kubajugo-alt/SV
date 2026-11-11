// Typed conversation: a terminal prompt under the transcript.
// Enter focuses it, Enter sends, Escape leaves. ALAN listens while you type,
// thinks while the model answers, then speaks the reply.

import { store } from './store.js';
import { say } from './speech.js';

export function startChat(config) {
  const form = document.getElementById('ask');
  const input = document.getElementById('ask-input');
  if (!config.chat) { form.hidden = true; return; }
  document.getElementById('ask-who').textContent = `${config.person}>`;

  let waiting = false;

  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') input.blur();
  });

  input.addEventListener('input', () => {
    dispatchEvent(new Event('alan:chat'));
    if (!waiting) store.set({ alan: input.value ? 'listening' : 'idle' });
  });
  input.addEventListener('blur', () => { if (!waiting) store.set({ alan: 'idle' }); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || waiting) return;
    waiting = true;
    input.value = '';
    dispatchEvent(new Event('alan:chat'));
    store.set({ alan: 'thinking' });
    let reply;
    try {
      const res = await fetch(config.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, person: config.person }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      reply = (await res.json()).reply;
    } catch (err) {
      console.warn('ALAN chat failed:', err.message);
      reply = 'Nie mam teraz połączenia z modelem językowym.';
    }
    waiting = false;
    store.set({ alan: 'idle' });   // say() shows "thinking" itself while the voice is prepared
    say({ text: reply });
  });
}
