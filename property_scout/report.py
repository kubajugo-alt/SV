"""Renders the property scout's HTML report: one self-contained page, data embedded."""
from __future__ import annotations

import json


def render(listings: list[dict], meta: dict) -> str:
    data = json.dumps({"listings": listings, "meta": meta}, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("</", "<\\/")
    return PAGE.replace("__DATA__", data)


PAGE = r"""<title>Gostoso Property Scout</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Inter:wght@400;500;600&display=swap">
<style>
/* Layout: a filter rail on top, then a grid of listing cards; a dialog holds one listing's full file. */
:root {
  --bg: #eef3f2;          /* sea salt */
  --surface: #ffffff;
  --ink: #10232a;         /* deep Atlantic */
  --muted: #56686d;
  --line: #d3dedd;
  --accent: #0d6b67;      /* lagoon teal */
  --accent-ink: #ffffff;
  --sand: #e7d3a8;        /* dune */
  --star: #c98a12;
  --good: #23743a;
  --bad: #a83a32;
  --chip: #e1eceb;
  --shadow: 0 1px 2px rgb(16 35 42 / .06), 0 6px 18px rgb(16 35 42 / .06);
  --display: "Archivo", "Arial Narrow", system-ui, sans-serif;
  --body: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c1619; --surface: #13222a; --ink: #e4eeee; --muted: #93a6aa; --line: #22363d;
  --accent: #52c3ba; --accent-ink: #062022; --sand: #6b5a35; --star: #f0b84e;
  --good: #72d08a; --bad: #f08a80; --chip: #1b2f36;
  --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 6px 18px rgb(0 0 0 / .25); color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0c1619; --surface: #13222a; --ink: #e4eeee; --muted: #93a6aa; --line: #22363d;
  --accent: #52c3ba; --accent-ink: #062022; --sand: #6b5a35; --star: #f0b84e;
  --good: #72d08a; --bad: #f08a80; --chip: #1b2f36;
  --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 6px 18px rgb(0 0 0 / .25); color-scheme: dark; }

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); }
.wrap { max-width: 1320px; margin: 0 auto; padding-block: 28px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
a { color: var(--accent); }
button, select, input { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.num { font-variant-numeric: tabular-nums; }

header.top { display: grid; gap: 6px; margin-bottom: 22px; }
.eyebrow { font: 600 12px/1 var(--body); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
h1 { font: 800 clamp(30px, 5vw, 46px)/1.02 var(--display); font-stretch: 72%; margin: 0; letter-spacing: -.01em; text-wrap: balance; }
.sub { color: var(--muted); margin: 0; max-width: 70ch; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 14px; }
.stat b { display: block; font: 700 26px/1.1 var(--display); font-stretch: 80%; font-variant-numeric: tabular-nums; }
.stat span { font-size: 12px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }

.filters { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg);
  padding-block: 12px; border-bottom: 1px solid var(--line); margin-bottom: 18px; display: grid; gap: 10px; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.chip small { color: inherit; opacity: .65; margin-left: 4px; }
.field { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.field select, .field input[type=search], .field input[type=number] { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; color: var(--ink); min-width: 0; }
.field input[type=search] { width: min(260px, 60vw); }
.field input[type=number] { width: 110px; }
.check { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
.count { margin-left: auto; font-size: 13px; color: var(--muted); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 18px; }
.card { background: var(--surface); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); display: flex; flex-direction: column; min-width: 0; }
.card.removed { opacity: .55; }
.ph { position: relative; aspect-ratio: 16 / 10; background: var(--chip); max-width: 100%; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.ph .none { display: grid; place-items: center; height: 100%; color: var(--muted); font-size: 13px; }
.ph .nav { position: absolute; top: 50%; translate: 0 -50%; width: 34px; height: 34px; border-radius: 50%; border: 0;
  background: rgb(255 255 255 / .85); color: #10232a; cursor: pointer; font-size: 18px; line-height: 1; display: grid; place-items: center; }
.ph .prev { left: 8px; } .ph .next { right: 8px; }
.ph .pc { position: absolute; right: 8px; bottom: 8px; background: rgb(0 0 0 / .55); color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.badges { position: absolute; left: 8px; top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.badge { font: 700 11px/1 var(--body); letter-spacing: .06em; text-transform: uppercase; padding: 5px 8px; border-radius: 6px; background: var(--surface); color: var(--ink); }
.badge.new { background: var(--accent); color: var(--accent-ink); }
.badge.down { background: var(--good); color: var(--surface); }
.badge.up { background: var(--bad); color: var(--surface); }
.badge.gone { background: var(--ink); color: var(--bg); }
.star { position: absolute; right: 8px; top: 8px; border: 0; width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
  background: rgb(255 255 255 / .85); color: #8a7a5a; font-size: 18px; display: grid; place-items: center; }
.star[aria-pressed="true"] { color: #c98a12; }
.body { padding: 14px 16px 16px; display: grid; gap: 6px; flex: 1; align-content: start; cursor: pointer; }
.price { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.price b { font: 800 27px/1 var(--display); font-stretch: 78%; font-variant-numeric: tabular-nums; }
.price span { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.specs { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
.specs .t { font-weight: 600; color: var(--accent); }
.where { font-size: 13px; color: var(--muted); }
.ttl { font-size: 13px; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.agency { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; margin-top: 4px; }
.empty { padding: 40px; text-align: center; color: var(--muted); grid-column: 1 / -1; }

dialog { border: 0; padding: 0; border-radius: 14px; width: min(980px, calc(100vw - 24px)); max-height: calc(100dvh - 24px);
  background: var(--surface); color: var(--ink); box-shadow: 0 20px 60px rgb(0 0 0 / .35); }
dialog::backdrop { background: rgb(6 18 22 / .6); }
.dlg { display: grid; gap: 18px; padding: 0 0 22px; }
.dlg .hero { position: relative; background: #000; aspect-ratio: 16 / 9; max-height: 60vh; width: 100%; }
.dlg .hero img { width: 100%; height: 100%; object-fit: contain; display: block; }
.dlg .close { position: absolute; right: 10px; top: 10px; z-index: 2; border: 0; border-radius: 999px; padding: 6px 12px; background: rgb(255 255 255 / .9); color: #10232a; cursor: pointer; font-weight: 600; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; padding: 0 22px; }
.thumbs img { width: 92px; height: 62px; object-fit: cover; border-radius: 6px; cursor: pointer; opacity: .7; flex: none; }
.thumbs img[aria-current="true"] { opacity: 1; outline: 2px solid var(--accent); }
.dlg .inner { padding: 0 22px; display: grid; gap: 16px; min-width: 0; }
.dlg h2 { font: 700 24px/1.15 var(--display); font-stretch: 85%; margin: 0; text-wrap: balance; }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); gap: 10px 20px; margin: 0; }
.facts div { border-bottom: 1px solid var(--line); padding-bottom: 6px; min-width: 0; }
.facts dt { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.amen { display: flex; flex-wrap: wrap; gap: 6px; }
.amen span { background: var(--chip); border-radius: 6px; padding: 3px 8px; font-size: 12px; }
.desc { white-space: pre-line; max-width: 75ch; margin: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; border: 1px solid var(--line); color: var(--ink); background: var(--surface); }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.hist { font-size: 13px; color: var(--muted); }
h3 { font: 700 13px/1 var(--body); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
footer { margin-top: 40px; font-size: 13px; color: var(--muted); display: grid; gap: 8px; max-width: 90ch; }
footer table { border-collapse: collapse; font-size: 12px; }
footer td, footer th { padding: 3px 10px 3px 0; text-align: left; border-bottom: 1px solid var(--line); }
.tablewrap { overflow-x: auto; }
@media (max-width: 700px) { .filters { position: static; } }
@media (prefers-reduced-motion: no-preference) { .card { transition: transform .15s ease; } .card:hover { transform: translateY(-2px); } }
</style>

<div class="wrap">
  <header class="top">
    <div class="eyebrow">São Miguel do Gostoso · Rio Grande do Norte · Brazil</div>
    <h1>Gostoso Property Scout</h1>
    <p class="sub" id="sub"></p>
    <div class="stats" id="stats"></div>
  </header>

  <section class="filters" aria-label="Filters">
    <div class="row" id="types"></div>
    <div class="row">
      <label class="field">Town <select id="town"></select></label>
      <label class="field">Max € <input id="maxp" type="number" min="0" step="10000" placeholder="any" inputmode="numeric"></label>
      <label class="field">Min bedrooms <select id="beds"><option value="0">any</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
      <label class="field">Sort <select id="sort">
        <option value="new">Newest first</option><option value="pa">Price, low to high</option><option value="pd">Price, high to low</option>
        <option value="m2">€ per m², lowest</option><option value="area">Largest area</option><option value="dist">Closest to Gostoso</option></select></label>
      <label class="field"><input id="q" type="search" placeholder="Search: beach, pool, Tourinhos…"></label>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" id="onlyNew"> New this week</label>
      <label class="check"><input type="checkbox" id="onlyDrop"> Price dropped</label>
      <label class="check"><input type="checkbox" id="onlyFav"> My shortlist</label>
      <label class="check"><input type="checkbox" id="showGone"> Show removed</label>
      <span class="count num" id="count"></span>
    </div>
  </section>

  <main class="grid" id="grid"></main>

  <footer id="foot"></footer>
</div>

<dialog id="dlg" aria-label="Listing details"></dialog>

<script>
const DATA = __DATA__;
const L = DATA.listings, M = DATA.meta;
const $ = s => document.querySelector(s);
const eur = v => v == null ? "price on request" : "€" + Math.round(v).toLocaleString("en-GB");
const brl = v => v == null ? "" : "R$ " + Math.round(v).toLocaleString("pt-BR");
const m2 = v => v ? Math.round(v).toLocaleString("en-GB") + " m²" : "";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isLand = r => /^(Land|Farm|Smallholding)/.test(r.type || "");
const clean = v => /n[ãa]o (dispon[ií]vel|informad|encontrad)/i.test(String(v ?? "")) ? "" : v;
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const lastRun = (M.last_run || "").slice(0, 10);
const isNew = r => r.first_seen > (M.first_run || "") && daysBetween(r.first_seen, lastRun) <= 7;
const lastChange = r => { const h = (r.price_history || []).filter(x => x.brl); return h.length > 1 ? h[h.length-1].brl - h[h.length-2].brl : 0; };

let fav = new Set();
try { fav = new Set(JSON.parse(localStorage.getItem("scout-fav") || "[]")); } catch (e) {}
const saveFav = () => { try { localStorage.setItem("scout-fav", JSON.stringify([...fav])); } catch (e) {} };

const active = L.filter(r => r.status === "active" && !r.outside_filters);
const TYPES = ["House", "House in condominium", "Land", "Land in condominium", "Apartment", "Smallholding", "Farm", "Commercial", "Other"];
const typeCount = t => active.filter(r => r.type === t).length;
const state = { types: new Set(), town: "", maxp: "", beds: 0, sort: "new", q: "", onlyNew: false, onlyDrop: false, onlyFav: false, showGone: false };
try { Object.assign(state, JSON.parse(localStorage.getItem("scout-filters") || "{}"), { types: new Set(JSON.parse(localStorage.getItem("scout-types") || "[]")) }); } catch (e) {}

function header() {
  const fx = M.fx || {};
  $("#sub").innerHTML = `Houses, land and other property for sale in and around São Miguel do Gostoso, prices in euros. ` +
    `Updated ${esc(M.last_run)} · 1 BRL = €${(fx.rate || 0).toFixed(4)} (${esc(fx.source)}, ${esc(fx.date)}).`;
  const land = active.filter(r => r.type.startsWith("Land") && r.eur_per_m2).map(r => r.eur_per_m2).sort((a,b)=>a-b);
  const houses = active.filter(r => r.type.startsWith("House") && r.price_eur).map(r => r.price_eur).sort((a,b)=>a-b);
  const med = a => a.length ? a[Math.floor(a.length/2)] : null;
  const stats = [
    [active.length, "for sale now"],
    [active.filter(isNew).length, "new this week"],
    [active.filter(r => lastChange(r) < 0).length, "price drops"],
    [houses.length ? eur(med(houses)) : "–", "median house"],
    [land.length ? "€" + med(land).toLocaleString("en-GB") + "/m²" : "–", "median land"],
  ];
  $("#stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
}

function controls() {
  $("#types").innerHTML = TYPES.filter(typeCount).map(t =>
    `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="${state.types.has(t)}">${esc(t)}<small>${typeCount(t)}</small></button>`).join("");
  $("#types").onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return;
    const t = b.dataset.t; state.types.has(t) ? state.types.delete(t) : state.types.add(t);
    b.setAttribute("aria-pressed", state.types.has(t)); draw(); };
  const towns = [...new Set(L.map(r => r.town))].sort((a, b) => a === M.home?.name ? -1 : b === M.home?.name ? 1 : a.localeCompare(b));
  $("#town").innerHTML = `<option value="">All towns</option>` + towns.map(t => `<option>${esc(t)}</option>`).join("");
  for (const id of ["town", "maxp", "beds", "sort", "q"]) {
    const el = $("#" + id); el.value = state[id] ?? ""; el.oninput = () => { state[id] = el.value; draw(); };
  }
  for (const id of ["onlyNew", "onlyDrop", "onlyFav", "showGone"]) {
    const el = $("#" + id); el.checked = !!state[id]; el.onchange = () => { state[id] = el.checked; draw(); };
  }
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const maxp = Number(state.maxp) || 0;
  let rows = L.filter(r => (state.showGone ? true : r.status === "active") && !r.outside_filters);
  if (state.types.size) rows = rows.filter(r => state.types.has(r.type));
  if (state.town) rows = rows.filter(r => r.town === state.town);
  if (maxp) rows = rows.filter(r => r.price_eur && r.price_eur <= maxp);
  if (+state.beds) rows = rows.filter(r => (r.bedrooms || 0) >= +state.beds);
  if (state.onlyNew) rows = rows.filter(isNew);
  if (state.onlyDrop) rows = rows.filter(r => lastChange(r) < 0);
  if (state.onlyFav) rows = rows.filter(r => fav.has(r.id));
  if (q) rows = rows.filter(r => [r.title, r.description, r.neighbourhood, r.street, r.town, r.agency, r.type, ...(r.amenities || [])].join(" ").toLowerCase().includes(q));
  const big = 1e15, by = {
    new: (a, b) => (b.first_seen || "").localeCompare(a.first_seen || "") || (b.date_posted || "").localeCompare(a.date_posted || ""),
    pa: (a, b) => (a.price_eur ?? big) - (b.price_eur ?? big),
    pd: (a, b) => (b.price_eur ?? -1) - (a.price_eur ?? -1),
    m2: (a, b) => (a.eur_per_m2 ?? big) - (b.eur_per_m2 ?? big),
    area: (a, b) => (b.total_area_m2 || b.area_m2 || 0) - (a.total_area_m2 || a.area_m2 || 0),
    dist: (a, b) => (a.km_from_home ?? big) - (b.km_from_home ?? big),
  };
  return rows.sort(by[state.sort] || by.new);
}

function specs(r) {
  const s = [`<span class="t">${esc(r.type)}</span>`];
  if (r.bedrooms) s.push(`${r.bedrooms} bed`);
  if (r.bathrooms) s.push(`${r.bathrooms} bath`);
  if (isLand(r)) { const a = r.total_area_m2 || r.area_m2; if (a) s.push(`${m2(a)} plot`); return s.join("<span aria-hidden='true'>·</span>"); }
  if (r.area_m2) s.push(`${m2(r.area_m2)} built`);
  if (r.total_area_m2 && r.total_area_m2 !== r.area_m2) s.push(`${m2(r.total_area_m2)} total`);
  return s.join("<span aria-hidden='true'>·</span>");
}
function badges(r) {
  const b = [];
  if (r.status !== "active") b.push(`<span class="badge gone">Removed</span>`);
  if (isNew(r)) b.push(`<span class="badge new">New</span>`);
  const c = lastChange(r);
  if (c < 0) b.push(`<span class="badge down">Price ↓ ${eur(-c * (M.fx?.rate || 0))}</span>`);
  if (c > 0) b.push(`<span class="badge up">Price ↑</span>`);
  return b.join("");
}
const where = r => [clean(r.neighbourhood) && r.neighbourhood.split(",")[0], r.town].filter(Boolean).join(", ") + (r.km_from_home != null && r.town !== M.home?.name ? ` · ~${r.km_from_home} km from Gostoso` : "");

function card(r) {
  const n = r.photos.length;
  return `<article class="card${r.status !== "active" ? " removed" : ""}" data-id="${esc(r.id)}">
    <div class="ph" data-i="0">
      ${n ? `<img src="${esc(r.photos[0])}" alt="${esc(r.type)} in ${esc(r.town)}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="none">No photo</div>`}
      ${n > 1 ? `<button class="nav prev" type="button" aria-label="Previous photo">‹</button><button class="nav next" type="button" aria-label="Next photo">›</button>` : ""}
      ${n ? `<span class="pc num">1/${n + (r.more_photos || 0)}</span>` : ""}
      <div class="badges">${badges(r)}</div>
      <button class="star" type="button" aria-label="Add to shortlist" aria-pressed="${fav.has(r.id)}">★</button>
    </div>
    <div class="body" role="button" tabindex="0" aria-label="Open details">
      <div class="price"><b>${eur(r.price_eur)}</b><span>${brl(r.price_brl)}${r.eur_per_m2 ? " · €" + r.eur_per_m2.toLocaleString("en-GB") + "/m²" : ""}</span></div>
      <div class="specs">${specs(r)}</div>
      <div class="where">${esc(where(r))}</div>
      <div class="ttl">${esc(r.title)}</div>
      ${r.agency ? `<div class="agency">${esc(r.agency)}</div>` : ""}
    </div>
  </article>`;
}

function draw() {
  try { const { types, ...rest } = state; localStorage.setItem("scout-filters", JSON.stringify(rest)); localStorage.setItem("scout-types", JSON.stringify([...types])); } catch (e) {}
  const rows = filtered();
  $("#count").textContent = `${rows.length} shown`;
  $("#grid").innerHTML = rows.length ? rows.map(card).join("") : `<div class="empty">Nothing matches these filters. Clear a filter or raise the price limit.</div>`;
}

const byId = id => L.find(r => r.id === id);
$("#grid").addEventListener("click", e => {
  const c = e.target.closest(".card"); if (!c) return;
  const r = byId(c.dataset.id);
  if (e.target.closest(".star")) {
    fav.has(r.id) ? fav.delete(r.id) : fav.add(r.id); saveFav();
    e.target.closest(".star").setAttribute("aria-pressed", fav.has(r.id)); return;
  }
  const nav = e.target.closest(".nav");
  if (nav) {
    const ph = c.querySelector(".ph"); let i = +ph.dataset.i + (nav.classList.contains("next") ? 1 : -1);
    i = (i + r.photos.length) % r.photos.length; ph.dataset.i = i;
    ph.querySelector("img").src = r.photos[i]; ph.querySelector(".pc").textContent = `${i + 1}/${r.photos.length + (r.more_photos || 0)}`; return;
  }
  if (e.target.closest(".body, img")) open(r, +c.querySelector(".ph").dataset.i || 0);
});
$("#grid").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".body")) { e.preventDefault(); open(byId(e.target.closest(".card").dataset.id), 0); } });

function open(r, start) {
  const d = $("#dlg"), rate = M.fx?.rate || 0;
  const hist = (r.price_history || []).filter(h => h.brl);
  const facts = [
    ["Price", eur(r.price_eur)], ["Price in reais", brl(r.price_brl)], ["€ per m²", r.eur_per_m2 ? "€" + r.eur_per_m2.toLocaleString("en-GB") : ""],
    ["Type", r.type], ...(isLand(r) ? [["Plot size", m2(r.total_area_m2 || r.area_m2)]] : [["Built area", m2(r.area_m2)], ["Total area", m2(r.total_area_m2)]]),
    ["Bedrooms", r.bedrooms], ["Bathrooms", r.bathrooms], ["Parking", r.parking],
    ["Neighbourhood", clean(r.neighbourhood)], ["Street", clean(r.street)], ["Town", r.town],
    ["From Gostoso centre", r.km_from_home != null && r.town !== M.home?.name ? `~${r.km_from_home} km` : ""],
    ["Agency", r.agency], ["Agency reference", r.agency_ref],
    ["Listed on site", r.date_posted], ["Updated on site", r.date_modified], ["First seen by scout", r.first_seen],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0);
  const tr = r.description ? "https://translate.google.com/?sl=pt&tl=en&op=translate&text=" + encodeURIComponent(r.description.slice(0, 1800)) : "";
  const map = r.lat && r.lon ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}` : "";
  d.innerHTML = `<div class="dlg">
    <div class="hero">${r.photos.length ? `<img id="big" src="${esc(r.photos[start] || r.photos[0])}" alt="Photo of the listing" referrerpolicy="no-referrer">` : ""}
      <button class="close" type="button" id="x">Close</button></div>
    ${r.photos.length > 1 ? `<div class="thumbs" id="th">${r.photos.map((p, i) => `<img src="${esc(p)}" data-i="${i}" alt="Photo ${i + 1}" loading="lazy" referrerpolicy="no-referrer" aria-current="${i === start}">`).join("")}</div>` : ""}
    <div class="inner">
      <div><div class="price"><b>${eur(r.price_eur)}</b><span>${brl(r.price_brl)}</span></div><h2>${esc(r.title)}</h2></div>
      <div class="actions">
        <a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener">Open listing on ${esc(r.source)}</a>
        ${map ? `<a class="btn" href="${esc(map)}" target="_blank" rel="noopener">Area on map</a>` : ""}
        ${tr ? `<a class="btn" href="${esc(tr)}" target="_blank" rel="noopener">Translate description</a>` : ""}
      </div>
      ${r.more_photos ? `<p class="hist">${r.more_photos} more photos on the listing page.</p>` : ""}
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${hist.length > 1 ? `<div><h3>Price history</h3><div class="hist num">${hist.map(h => `${esc(h.date)}: ${brl(h.brl)} (${eur(h.brl * rate)})`).join(" → ")}</div></div>` : ""}
      ${(r.amenities || []).length ? `<div><h3>Features</h3><div class="amen">${r.amenities.map(a => `<span>${esc(a)}</span>`).join("")}</div></div>` : ""}
      ${r.description ? `<div><h3>Description (Portuguese)</h3><p class="desc">${esc(r.description)}</p></div>` : ""}
    </div></div>`;
  d.querySelector("#x").onclick = () => d.close();
  const th = d.querySelector("#th");
  if (th) th.onclick = e => { const t = e.target.closest("img"); if (!t) return;
    d.querySelector("#big").src = t.src; th.querySelectorAll("img").forEach(i => i.setAttribute("aria-current", i === t)); };
  d.showModal(); d.scrollTop = 0;
}
$("#dlg").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

function footer() {
  const cov = M.coverage || [];
  const cut = cov.filter(c => c.ok && c.total > c.shown);
  const failed = cov.filter(c => !c.ok);
  $("#foot").innerHTML = `
    <div>Source: ${esc(M.source)} (chavesnamao.com.br), read once a day from its public search pages and listing pages.
    Prices are the asking prices in the ads, converted at the day's rate; confirm everything with the agency, and check the
    property's <em>matrícula</em> (registry record) and the agent's CRECI number before paying anything.</div>
    ${cut.length ? `<div>Some searches have more results than one page shows. See the rest on the site:
      ${cut.map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.town)} ${esc(c.category.toLowerCase())} (${c.shown} of ${c.total})</a>`).join(", ")}.</div>` : ""}
    ${failed.length ? `<div>Could not read this run: ${failed.map(c => esc(c.town + " " + c.category.toLowerCase())).join(", ")}.</div>` : ""}
    <details><summary>Pages read this run</summary><div class="tablewrap"><table><tr><th>Town</th><th>Type</th><th>Listings</th></tr>
      ${cov.map(c => `<tr><td>${esc(c.town)}</td><td>${esc(c.category)}</td><td class="num">${c.ok ? c.shown + (c.total > c.shown ? " of " + c.total : "") : "failed"}</td></tr>`).join("")}
    </table></div></details>`;
}

header(); controls(); draw(); footer();
</script>
"""
