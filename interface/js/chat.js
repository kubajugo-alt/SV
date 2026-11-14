// Conversation: a terminal prompt under the transcript, shared by keyboard and
// microphone. Enter focuses it, Enter sends, Escape leaves. ALAN listens while
// you type, thinks while the model answers, then speaks the reply.

import { store } from './store.js';
import { prepare, prepared, speakStream } from './speech.js';

// What he mutters while the answer is on its way, so the pause is his and not the machine's.
// Recorded once per visit, then said from memory.
const FILLERS = ['Hmm.', 'Chwileczkę.', 'Niech pomyślę.', 'Momencik.', 'Zaraz, zaraz.', 'Dobre pytanie.', 'No dobrze.'];
const FILLER_AFTER = 900;   // ms of silence before he says one

/** @returns {((text: string) => Promise<void>) | undefined} ask — send a line to ALAN */
export function startChat(config) {
  const form = document.getElementById('ask');
  const input = document.getElementById('ask-input');
  if (!config.chat) { form.hidden = true; return undefined; }
  store.subscribe((s) => { document.getElementById('ask-who').textContent = `${s.person}>`; });

  let waiting = false;
  let exchange = 0;
  let lastFiller = '';
  // The first click or key unlocks the sound; a moment later his mutters are recorded, ready for the first question.
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => setTimeout(() => prepare(FILLERS), 600), { once: true });

  async function ask(text) {
    text = text.trim();
    if (!text || waiting) return;
    waiting = true;
    input.value = '';
    input.placeholder = text;          // what he heard or read stays visible, dimmed
    dispatchEvent(new Event('alan:chat'));
    store.set({ alan: 'thinking', busy: true });
    let actions = [];
    store.set({ actions: [] });       // the previous exchange's log goes away
    const mine = ++exchange;
    const speaker = speakStream();    // whatever he was saying gives way
    let spoken = 0;
    const speak = (line) => {
      clearTimeout(filler);
      if (!spoken++) store.set({ alan: 'idle' });   // the voice shows "thinking" itself while a line is prepared
      speaker.push(line);
    };
    // If the answer is slow to start, he fills the silence with one of his recorded mutters (never the same twice running).
    const recorded = FILLERS.filter((line) => prepared(line) && line !== lastFiller);
    const filler = setTimeout(() => {
      if (spoken || !recorded.length) return;
      lastFiller = recorded[Math.floor(Math.random() * recorded.length)];
      speaker.push(lastFiller);
    }, FILLER_AFTER);
    prepare(FILLERS);
    try {
      const res = await fetch(config.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, person: store.get().person, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, stream: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const take = (data) => {
        if (data.error) throw new Error(data.error);
        if (data.say) speak(data.say);
        if (data.actions) actions = data.actions;
        if (data.reply && !spoken) speak(data.reply);
      };
      if ((res.headers.get('Content-Type') || '').includes('ndjson')) {
        // The cloud answers one JSON object per line: {"say": sentence}..., then {"reply", "actions"}.
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let pending = '';
        for (;;) {
          const { value, done } = await reader.read();
          pending += value || '';
          const lines = pending.split('\n');
          pending = done ? '' : lines.pop();
          for (const one of lines) if (one.trim()) take(JSON.parse(one));
          if (done) break;
        }
      } else take(await res.json());   // the server at home answers in one piece
    } catch (err) {
      console.warn('ALAN chat failed:', err.message);
      clearTimeout(filler);
      speak(spoken ? 'I tu zgubiłem wątek. Połączenie się urwało.' : 'Nie mam teraz połączenia z modelem językowym.');
    }
    waiting = false;
    store.set({ alan: 'idle', actions });
    if (actions.length) dispatchEvent(new Event('alan:acted'));
    await speaker.end();              // until he has finished, the microphone and his own initiative wait
    if (mine === exchange) store.set({ busy: false });
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
