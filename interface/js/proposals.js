// The changes to himself that ALAN asked the programmer for (cloud only): key Z lists
// them; one whose tests have passed can be approved, which merges it on GitHub.
// He says so once when a new proposal is ready.

import { store } from './store.js';
import { say } from './speech.js';
import { overlay } from './login.js';

const STATES = { building: 'W BUDOWIE — TESTY TRWAJĄ', ready: 'GOTOWA', failing: 'TESTY NIE PRZECHODZĄ' };
const EVERY = 5 * 60 * 1000;

const el = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };

export function startProposals(config) {
  if (!config.cloud) return;
  let open = null;
  let off = false;                  // no GitHub token on the site: nothing to show, stop asking

  async function load() {
    if (off) return null;
    const res = await fetch('proposals').catch(() => null);
    if (res?.status === 503) off = true;
    return res?.ok ? (await res.json()).proposals : null;
  }

  function draw(list, note = '') {
    const box = open.querySelector('#pr-list');
    box.replaceChildren();
    if (!list) box.append(el('p', off ? 'Alan nie ma jeszcze połączenia z GitHubem.' : 'Nie udało się pobrać propozycji.'));
    else if (!list.length) box.append(el('p', 'Żadna propozycja nie czeka.'));
    for (const p of list ?? []) {
      const item = el('article', '');
      const link = el('a', 'ZOBACZ NA GITHUBIE');
      link.href = p.url; link.target = '_blank'; link.rel = 'noopener';
      const approve = el('button', 'ZATWIERDŹ');
      approve.type = 'button';
      approve.disabled = p.state !== 'ready';
      approve.addEventListener('click', async () => {
        if (approve.dataset.sure !== '1') { approve.dataset.sure = '1'; approve.textContent = 'NA PEWNO? KLIKNIJ JESZCZE RAZ'; return; }
        approve.disabled = true;
        const res = await fetch('proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: p.number }) });
        const out = await res.json().catch(() => ({}));
        draw(await load(), res.ok ? `Zatwierdzono: ${out.title}. Zmiana zadziała po wdrożeniu strony.` : `Nie zatwierdzono: ${out.error || res.status}.`);
      });
      const actions = el('p', '');
      actions.append(approve, ' ', link);
      item.append(el('h3', `#${p.number} ${p.title}`), el('p', STATES[p.state] || p.state, `pr-state ${p.state}`), el('pre', p.body || '(bez opisu)'), actions);
      box.append(item);
    }
    open.querySelector('#pr-note').textContent = note;
    open.focus();                   // keeps Escape working after a button was replaced
  }

  addEventListener('keydown', async (e) => {
    if (e.code !== 'KeyZ' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    open = overlay('<label>PROPOZYCJE ZMIAN W ALANIE</label><div id="pr-list"><p>Pobieram…</p></div><p><button type="button" id="pr-close">ZAMKNIJ</button> <span id="pr-note"></span></p>');
    open.classList.add('wide', 'proposals');
    open.tabIndex = -1;
    open.focus();
    const close = () => { open.remove(); open = null; };
    open.querySelector('#pr-close').addEventListener('click', close);
    open.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); });   // his other keys rest while this is open
    open.addEventListener('submit', (ev) => ev.preventDefault());
    draw(await load());
  });

  // He mentions a proposal once, when its tests have passed.
  let told = [];
  try { told = JSON.parse(localStorage.getItem('alan.proposals') || '[]'); } catch { /* start afresh */ }
  setInterval(async () => {
    const s = store.get();
    if (document.hidden || s.busy || s.flat === 'studio' || open) return;
    const fresh = ((await load()) ?? []).filter((p) => p.state === 'ready' && !told.includes(p.number));
    if (!fresh.length) return;
    told = [...told, ...fresh.map((p) => p.number)].slice(-50);
    try { localStorage.setItem('alan.proposals', JSON.stringify(told)); } catch { /* he may repeat himself after a reload */ }
    say({ text: `Propozycja zmiany jest gotowa: ${fresh[0].title}. Naciśnij Z, żeby ją obejrzeć i zatwierdzić.` });
  }, EVERY);
}
