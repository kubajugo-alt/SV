// In the cloud ALAN is behind a password; on a machine at home (serve.py) there
// is no /session and nothing here gets in the way.
// Also: the household notes, edited in place (key U), which he reads every turn.

const overlay = (html) => {
  const el = document.createElement('form');
  el.className = 'overlay';
  el.innerHTML = html;
  document.body.append(el);
  return el;
};

/** Resolves once this browser may talk to him. */
export async function signIn() {
  let state;
  try { state = (await fetch('session')).status; } catch { return; }
  if (state === 503) {
    overlay('<p>ALAN nie ma jeszcze hasła. Ustaw zmienną ALAN_PASSWORD w ustawieniach strony na Netlify i wdróż ją ponownie.</p>');
    return new Promise(() => {});
  }
  if (state !== 401) return;                       // signed in already, or not the cloud
  const form = overlay('<label for="pw">ALAN · HASŁO</label><input id="pw" type="password" autocomplete="current-password" autofocus><p id="pw-note"></p>');
  await new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.querySelector('#pw').value }),
      });
      if (res.ok) { form.remove(); resolve(); return; }
      form.querySelector('#pw-note').textContent = res.status === 429 ? 'Za dużo prób. Odczekaj minutę.' : 'To nie to hasło.';
      form.querySelector('#pw').select();
    });
  });
}

/** Key U: what he is told about the household. Only where the server keeps it (the cloud). */
export function startHousehold(config) {
  if (!config.cloud) return;
  let open = null;
  addEventListener('keydown', async (e) => {
    if (e.code !== 'KeyU' || open || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const res = await fetch('household');
    if (!res.ok) return;
    open = overlay('<label for="hh">CO ALAN WIE O DOMOWNIKACH</label><textarea id="hh" maxlength="12000" spellcheck="false"></textarea>'
      + '<p><button type="submit">ZAPISZ</button> <button type="button" id="hh-close">ZAMKNIJ</button> <span id="hh-note"></span></p>');
    open.classList.add('wide');
    const area = open.querySelector('#hh');
    area.value = (await res.json()).text;
    area.focus();
    const close = () => { open.remove(); open = null; };
    open.querySelector('#hh-close').addEventListener('click', close);
    open.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
    open.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const saved = await fetch('household', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: area.value }) });
      open.querySelector('#hh-note').textContent = saved.ok ? 'Zapisano.' : 'Nie udało się zapisać.';
      if (saved.ok) setTimeout(close, 700);
    });
  });
}
