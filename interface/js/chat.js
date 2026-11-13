// Conversation: a terminal prompt under the transcript, shared by keyboard and
// microphone. Enter focuses it, Enter sends, Escape leaves. ALAN listens while
// you type, thinks while the model answers, then speaks the reply.

import { store } from './store.js';
import { say } from './speech.js';

/** @returns {((text: string) => Promise<void>) | undefined} ask — send a line to ALAN */
export function startChat(config) {
  const form = document.getElementById('ask');
  const input = document.getElementById('ask-input');
  if (!config.chat) { form.hidden = true; return undefined; }
  store.subscribe((s) => { document.getElementById('ask-who').textContent = `${s.person}>`; });

  let waiting = false;

  async function ask(text) {
    text = text.trim();
    if (!text || waiting) return;
    waiting = true;
    input.value = '';
    input.placeholder = text;          // what he heard or read stays visible, dimmed
    dispatchEvent(new Event('alan:chat'));
    store.set({ alan: 'thinking', busy: true });
    let reply;
    let actions = [];
    store.set({ actions: [] });       // the previous exchange's log goes away
    try {
      const res = await fetch(config.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, person: store.get().person, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      ({ reply, actions = [] } = await res.json());
    } catch (err) {
      console.warn('ALAN chat failed:', err.message);
      reply = 'Nie mam teraz połączenia z modelem językowym.';
    }
    waiting = false;
    store.set({ alan: 'idle', actions, busy: false });   // say() shows "thinking" itself while the voice is prepared
    if (actions.length) dispatchEvent(new Event('alan:acted'));
    say({ text: reply });
  }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target !== input)) return;   // another field has the keyboard
    if (e.key === 'Enter' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') input.blur();
  });

  input.addEventListener('input', () => {
    dispatchEvent(new Event('alan:chat'));
    if (!waiting) store.set({ alan: input.value ? 'listening' : 'idle' });
  });
  input.addEventListener('blur', () => { if (!waiting && store.get().alan === 'listening') store.set({ alan: 'idle' }); });

  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  return ask;
}
