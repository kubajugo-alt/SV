// Key B: the backups of his memory (cloud only). The list, when the last one worked, a backup
// taken by hand, a download (encrypted, or readable JSON), and putting one back: all of it,
// or one person's conversations, or only his lists and reminders. A restore asks twice and
// takes a backup of the present first, so it can be undone.

import { overlay } from './login.js';

const KIND = { daily: 'NOCNA', weekly: 'TYGODNIOWA', monthly: 'MIESIĘCZNA', manual: 'RĘCZNA' };
const SCOPES = [['', 'całą pamięć'], ['own', 'listy, przypomnienia, kalendarz, ulubione'], ['talk/kuba', 'rozmowy z Kubą'], ['talk/hubert', 'rozmowy z Hubertem'], ['household', 'opis domowników']];

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const when = (iso) => iso ? new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'nigdy';
const kb = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
const label = (name) => { const [kind, date] = name.split('/'); return `${KIND[kind] || kind} · ${date.replace(/^przed-przywroceniem-/, 'przed przywróceniem ').replace(/T(\d\d)-(\d\d).*$/, ' $1:$2')}`; };

export function startBackups(config) {
  if (!config.cloud) return;
  let open = null;

  async function load() {
    const res = await fetch('backup').catch(() => null);
    return res?.ok ? res.json() : null;
  }

  function sure(button, then) {          // the second click does it
    button.addEventListener('click', async () => {
      if (button.dataset.sure !== '1') { button.dataset.sure = '1'; button.textContent = 'NA PEWNO? KLIKNIJ JESZCZE RAZ'; return; }
      button.disabled = true;
      await then();
    });
  }

  async function post(body, query = '') {
    const res = await fetch(`backup${query}`, { method: 'POST', ...(body instanceof Blob ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const out = await res.json().catch(() => ({}));
    return res.ok ? out : { error: out.error || String(res.status) };
  }

  const restored = (out) => out.error ? `Nie przywrócono: ${out.error}.` : `Przywrócono ${out.restored} wpisów z ${when(out.from)}${out.removed ? `, usunięto ${out.removed} późniejszych` : ''}. Stan sprzed przywrócenia zapisano jako kopię ręczną.`;

  function draw(data, note = '') {
    const box = open.querySelector('#bk-list');
    box.replaceChildren();
    if (!data) box.append(el('p', 'Nie udało się pobrać listy kopii.'));
    else if (!data.key) box.append(el('p', 'Kopie nie działają: w ustawieniach strony w Netlify brakuje klucza ALAN_BACKUP_KEY. Dodaj długie hasło i zapisz je też w menedżerze haseł: bez niego żadnej kopii nie da się odczytać.'));
    else {
      const s = data.status || {};
      const head = el('article', '');
      head.append(el('h3', `Ostatnia kopia: ${when(s.lastOk)}${s.lastSize ? ` · ${kb(s.lastSize)}` : ''}`));
      if (s.lastError && (!s.lastOk || s.lastErrorAt > s.lastOk)) head.append(el('p', `Ostatni błąd (${when(s.lastErrorAt)}): ${s.lastError}`, 'bk-error'));
      head.append(el('p', data.offsite ? `Kopia poza Netlify (prywatne repozytorium): ${s.offsite ? when(s.offsite) : 'jeszcze nie było niedzieli'}.` : 'Kopia poza Netlify wyłączona (brak ALAN_BACKUP_TOKEN).'));
      const now = el('button', 'ZRÓB KOPIĘ TERAZ');
      now.type = 'button';
      now.addEventListener('click', async () => { now.disabled = true; const out = await post({ now: true }); draw(await load(), out.error ? `Kopia się nie udała: ${out.error}.` : `Zrobione: ${kb(out.size)}.`); });
      const scope = el('select', '');
      scope.id = 'bk-scope';
      for (const [value, text] of SCOPES) { const o = el('option', text); o.value = value; scope.append(o); }
      const upload = el('button', 'PRZYWRÓĆ Z PLIKU…');
      upload.type = 'button';
      upload.addEventListener('click', () => {
        const pick = el('input', '');
        pick.type = 'file'; pick.accept = '.alan';
        pick.addEventListener('change', async () => {
          if (!pick.files[0] || !confirm(`Przywrócić ${scope.selectedOptions[0].text} z pliku ${pick.files[0].name}?`)) return;
          draw(await load(), restored(await post(pick.files[0], `?restore=upload&only=${encodeURIComponent(scope.value)}`)));
        });
        pick.click();
      });
      const row = el('p', '');
      row.append(now, ' ', upload, ' PRZYWRACAJ: ', scope);
      head.append(row);
      box.append(head);
      if (!data.backups.length) box.append(el('p', 'Jeszcze nie ma żadnej kopii. Pierwsza zrobi się dziś w nocy albo teraz, przyciskiem.'));
      for (const b of data.backups) {
        const item = el('article', '', 'bk-item');
        const get = el('a', 'POBIERZ');
        get.href = `backup?file=${encodeURIComponent(b.name)}`;
        const read = el('a', 'CZYTELNY JSON');
        read.href = `backup?file=${encodeURIComponent(b.name)}&plain=1`;
        const back = el('button', 'PRZYWRÓĆ');
        back.type = 'button';
        sure(back, async () => draw(await load(), restored(await post({ restore: b.name, only: scope.value }))));
        const actions = el('span', '');
        actions.append(get, ' ', read, ' ', back);
        item.append(el('span', `${label(b.name)} · ${kb(b.size)}`), actions);
        box.append(item);
      }
    }
    open.querySelector('#bk-note').textContent = note;
    open.focus();
  }

  addEventListener('keydown', async (e) => {
    if (e.code !== 'KeyB' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    open = overlay('<label>KOPIE PAMIĘCI ALANA</label><div id="bk-list"><p>Pobieram…</p></div><p><button type="button" id="bk-close">ZAMKNIJ</button> <span id="bk-note"></span></p>');
    open.classList.add('wide', 'proposals', 'backups');
    open.tabIndex = -1;
    open.focus();
    const close = () => { open.remove(); open = null; };
    open.querySelector('#bk-close').addEventListener('click', close);
    open.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); });
    open.addEventListener('submit', (ev) => ev.preventDefault());
    draw(await load());
  });
}
