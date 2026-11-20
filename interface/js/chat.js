// Conversation: a terminal prompt under the transcript, shared by keyboard and
// microphone. Enter focuses it, Enter sends, Escape leaves. ALAN listens while
// you type, thinks while the model answers, then speaks the reply.

import { store } from './store.js';
import { prepare, prepared, speakStream, takeInterrupted } from './speech.js';
import { pickFiller, someFillers, TOPIC_LINES, topicOf } from './fillers.js';

// What he says while the answer is on its way (fillers.js), so the pause is his and not the machine's.
const FILLER_AFTER = 900;   // ms of silence before he says one
// What he murmurs while you talk to him at length (mic.js), recorded along with the fillers.
export const BACKCHANNEL = ['Mhm.', 'Aha.', 'No.'];

/** @returns {((text: string) => Promise<void>) | undefined} ask — send a line to ALAN */
export function startChat(config) {
  const form = document.getElementById('ask');
  const input = document.getElementById('ask-input');
  if (!config.chat) { form.hidden = true; return undefined; }
  store.subscribe((s) => { document.getElementById('ask-who').textContent = `${s.person}>`; });

  let waiting = false;
  let exchange = 0;
  const recentFillers = [];
  // The first click or key unlocks the sound; a moment later his mutters are recorded, ready for the first question.
  let readied = false;
  const ready = () => { if (!readied) { readied = true; setTimeout(() => prepare([...(config.fillers ? someFillers(2) : []), ...BACKCHANNEL]), 600); } };
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, ready, { once: true });
  // Talked over (speech.js interrupt()): the reply still being written is abandoned, so the next question is heard.
  let cancel = null;
  addEventListener('alan:interrupted', () => {
    cancel?.abort();
    store.set({ busy: false, alan: 'idle' });
  });

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
      clearTimeout(lastChance);
      if (!spoken++) store.set({ alan: 'idle' });   // the voice shows "thinking" itself while a line is prepared
      speaker.push(line);
    };
    // If the answer is slow to start, he fills the silence with a recorded line that fits the question
    // (not one of the last few). A greeting is answered fast enough to need none.
    // The server names the topic (a quick judgement made alongside the answer); his own guess by
    // keywords is used only if that has not come in time.
    const greeting = text.split(/\s+/).length <= 3 && /^(hej|cześć|siema|dzień dobry|dobry wieczór|dobranoc|halo|elo)\b/i.test(text);
    let serverTopic = null, due = false, fillerDone = false, lastChance = null;
    const sayFiller = (topic) => {
      if (fillerDone || spoken || greeting) return;
      fillerDone = true;
      const line = pickFiller(text, prepared, recentFillers, topic);
      if (!line) return;
      recentFillers.push(line);
      if (recentFillers.length > 5) recentFillers.shift();
      speaker.push(line);
    };
    const filler = !config.fillers ? null : setTimeout(() => {
      due = true;
      if (serverTopic) sayFiller(serverTopic);
      else lastChance = setTimeout(() => sayFiller(serverTopic ?? topicOf(text)), 700);
    }, FILLER_AFTER);
    const abort = cancel = new AbortController();
    const interrupted = takeInterrupted();   // he was cut off last time: the server learns how much was heard
    try {
      const res = await fetch(config.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, person: store.get().person, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, stream: true,
          ...(interrupted ? { interrupted } : {}),
        }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const take = (data) => {
        if (data.error) throw new Error(data.error);
        if (data.filler && config.fillers) {
          serverTopic = data.filler;
          prepare(TOPIC_LINES[serverTopic] || []);   // the rest of this kind, for the next time
          if (due) { clearTimeout(lastChance); sayFiller(serverTopic); }
        }
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
      clearTimeout(filler);
      clearTimeout(lastChance);
      if (abort.signal.aborted) { waiting = false; return; }   // talked over: the new question takes it from here
      console.warn('ALAN chat failed:', err.message);
      speak(spoken ? 'I tu zgubiłem wątek. Połączenie się urwało.' : 'Nie mam teraz połączenia z modelem językowym.');
    }
    if (cancel === abort) cancel = null;
    if (abort.signal.aborted) { waiting = false; return; }
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
