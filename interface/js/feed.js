// ALAN's own calendar (cloud only): key K shows the address to subscribe to in a calendar app.

import { overlay } from './login.js';

export function startFeed(config) {
  if (!config.cloud) return;
  let open = null;
  addEventListener('keydown', async (e) => {
    if (e.code !== 'KeyK' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const res = await fetch('calendar-link').catch(() => null);
    if (!res?.ok) return;
    const { url } = await res.json();
    open = overlay('<label for="cal">KALENDARZ ALANA — ADRES DO SUBSKRYPCJI</label><input id="cal" readonly>'
      + '<p>W Kalendarzu Google: Inne kalendarze → + → Z adresu URL, i wklej ten adres. W Kalendarzu Apple: Plik → Nowa subskrypcja kalendarza. '
      + 'Kto zna ten adres, widzi wydarzenia, więc nie udostępniaj go dalej.</p>'
      + '<p><button type="button" id="cal-copy">KOPIUJ</button> <button type="button" id="cal-close">ZAMKNIJ</button> <span id="cal-note"></span></p>');
    open.classList.add('wide');
    const field = open.querySelector('#cal');
    field.value = url;
    field.style.width = 'min(60em, 90vw)';
    field.focus();
    field.select();
    const close = () => { open.remove(); open = null; };
    open.querySelector('#cal-close').addEventListener('click', close);
    open.querySelector('#cal-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); open.querySelector('#cal-note').textContent = 'Skopiowano.'; } catch { field.select(); }
    });
    open.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); });
    open.addEventListener('submit', (ev) => ev.preventDefault());
  });
}
