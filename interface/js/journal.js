// Key J: what grows between Alan and the household (cloud only). "Kim się staję", the few
// sentences he rewrites every Sunday, with the earlier versions and a button to go back one;
// and his journal of each person, where any moment can be crossed out.

import { overlay } from './login.js';

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const day = (iso) => iso ? new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function startJournal(config) {
  if (!config.cloud) return;
  let open = null;

  const call = async (body) => {
    const res = await fetch('bond', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).catch(() => null);
    return res?.ok ? res.json() : null;
  };

  function draw(data, note = '') {
    const box = open.querySelector('#jr-list');
    box.replaceChildren();
    if (!data) { box.append(el('p', 'Nie udało się pobrać dziennika.')); return; }
    const self = el('article', '');
    self.append(el('h3', data.self.becoming ? `Kim się staję · ${day(data.self.at)}` : 'Kim się staję'));
    self.append(el('p', data.self.becoming || 'Jeszcze nic. Pierwszy raz napiszę to w niedzielę, kiedy w dzienniku coś będzie.', 'jr-self'));
    const row = el('p', '');
    const now = el('button', 'PRZEMYŚL TERAZ');
    now.type = 'button';
    now.addEventListener('click', async () => { now.disabled = true; now.textContent = 'MYŚLĘ…'; draw(await call({ reflect: true }), 'Przemyślane.'); });
    row.append(now);
    if (data.self.history.length) {
      const undo = el('button', `COFNIJ DO WERSJI Z ${day(data.self.history.at(-1).at).toUpperCase()}`);
      undo.type = 'button';
      undo.addEventListener('click', async () => {
        if (undo.dataset.sure !== '1') { undo.dataset.sure = '1'; undo.textContent = 'NA PEWNO? KLIKNIJ JESZCZE RAZ'; return; }
        draw(await call({ undo: true }), 'Wróciłem do poprzedniej wersji.');
      });
      row.append(' ', undo);
    }
    self.append(row);
    box.append(self);
    const people = Object.keys(data.journals);
    if (!people.length) box.append(el('p', 'Dziennik jest pusty. Zapisuję w nim chwile, które coś znaczą: wspólne żarty, zwierzenia, ważne dni.'));
    for (const person of people) {
      const part = el('article', '');
      part.append(el('h3', `Dziennik: ${capital(person)}`));
      for (const m of data.journals[person]) {
        const line = el('p', '', 'jr-moment');
        const cross = el('button', '✕');
        cross.type = 'button';
        cross.title = 'skreśl';
        cross.addEventListener('click', async () => draw(await call({ forget: { person, at: m.at, text: m.text } }), 'Skreślone.'));
        line.append(el('span', day(m.at), 'jr-day'), el('span', m.text), cross);
        part.append(line);
      }
      box.append(part);
    }
    open.querySelector('#jr-note').textContent = note;
    open.focus();
  }

  addEventListener('keydown', async (e) => {
    if (e.code !== 'KeyJ' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    open = overlay('<label>DZIENNIK ALANA</label><div id="jr-list"><p>Pobieram…</p></div><p><button type="button" id="jr-close">ZAMKNIJ</button> <span id="jr-note"></span></p>');
    open.classList.add('wide', 'proposals', 'journal');
    open.tabIndex = -1;
    open.focus();
    const close = () => { open.remove(); open = null; };
    open.querySelector('#jr-close').addEventListener('click', close);
    open.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); });
    open.addEventListener('submit', (ev) => ev.preventDefault());
    draw(await call());
  });
}
