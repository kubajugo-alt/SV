// The keys, shown on demand (? or H) instead of a permanent row at the bottom of the screen.

import { overlay } from './login.js';

const KEYS = [
  ['ENTER', 'napisz do Alana'],
  ['SPACJA (przytrzymaj)', 'mów do Alana'],
  ['M', 'mikrofon: przytrzymanie spacji albo „Alan…” bez rąk'],
  ['P', 'zmień rozmówcę'],
  ['I', 'Alan zagaduje sam albo nie'],
  ['S', 'studio: czarny ekran i cisza'],
];
const CLOUD = [
  ['U', 'co Alan wie o domownikach'],
  ['K', 'adres kalendarza Alana'],
  ['Z', 'propozycje zmian w Alanie'],
  ['B', 'kopie pamięci Alana'],
  ['J', 'dziennik Alana: kim się staje'],
];

export function startHelp(config) {
  let open = null;
  const close = () => { open?.remove(); open = null; };
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (open && (e.key === 'Escape' || e.key === '?' || e.code === 'KeyH')) { e.preventDefault(); close(); return; }
    if (open || (e.key !== '?' && e.code !== 'KeyH')) return;
    open = overlay('<label>KLAWISZE</label><dl class="keys"></dl><p><button type="button">ZAMKNIJ</button></p>');
    const list = open.querySelector('.keys');
    for (const [key, what] of [...KEYS, ...(config.cloud ? CLOUD : [])]) {
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = what;
      list.append(dt, dd);
    }
    open.querySelector('button').addEventListener('click', close);
    open.addEventListener('submit', (ev) => ev.preventDefault());
  });
}
