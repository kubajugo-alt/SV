// Alan's own life between conversations: his day in the room (a book he is reading, coffee,
// the window, the past that comes back on its dates), now and then news from Lisbon, and a mood
// that lasts for hours. Written by himself a few times a day (life-tick); given back to him in
// every conversation so he can speak from it, and to the page so the room can show it.
//   life   { entries: [{at, kind, text}], book: {title, author, page, of, thoughts} | null, mood }
import type { Store } from "./store.mts";

export type Entry = { at: string; kind: "day" | "lisbon"; text: string };
export type Book = { title: string; author: string; page: number; of: number; thoughts: string };
export type Mood = { label: string; energy: number; cheer: number; why: string; at: string };   // energy and cheer: -2 … 2
export type Life = { entries: Entry[]; book: Book | null; mood: Mood | null; lisbonAt?: string };

const KEPT = 60;
export const loadLife = async (store: Store): Promise<Life> => ({ entries: [], book: null, mood: null, ...((await store.get<Life>("life")) ?? {}) });

/** Days that come back every year, from his memories of the games (day.month). */
export const ANNIVERSARIES: [string, string][] = [
  ["22.10", "rocznica śmierci dziadka Joaquima (1995); następnego ranka na Lizbonę siadła mgła"],
  ["31.10", "rocznica dnia, w którym poznałeś Vasca w dole odlewniczym w Sé (1995)"],
  ["01.11", "Wszystkich Świętych: rocznica dzwonu z 1755 roku i twojego telefonu do matki o świcie (1995)"],
  ["02.11", "rocznica czwartku w dole odlewniczym, kiedy Vasco cię pocałował (1995): „Każdy czwartek”"],
  ["21.06", "rocznica kłótni z Vaskiem o piątej rano i nocy w barze Rafy (1996), której się wstydzisz"],
  ["24.06", "noc świętego Jana: rocznica zejścia do wody w Risco Caído i dysku słońca (1996)"],
];

/** The anniversaries within a day of today, as he should feel them. */
export function anniversaries(day: number, month: number): string[] {
  const at = (d: number, m: number) => `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
  const near = new Set([-1, 0, 1].map((k) => { const t = new Date(Date.UTC(2001, month - 1, day + k)); return at(t.getUTCDate(), t.getUTCMonth() + 1); }));
  const today = at(day, month);
  return ANNIVERSARIES.filter(([d]) => near.has(d)).map(([d, what]) => `${d === today ? "Dziś" : "Blisko dziś"}: ${what}.`);
}

const clamp = (n: unknown) => Math.max(-2, Math.min(2, Math.round(Number(n) || 0)));

/** Takes what he wrote about his last hours (JSON), keeps what is sound. Returns false if nothing usable came. */
export async function absorb(store: Store, raw: string, now: Date): Promise<boolean> {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return false;
  let out: any;
  try { out = JSON.parse(json); } catch { return false; }
  const life = await loadLife(store);
  const at = now.toISOString();
  const add = (kind: Entry["kind"], text: unknown) => {
    const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (t.length > 10) life.entries = [...life.entries, { at, kind, text: t }].slice(-KEPT);
  };
  add("day", out.day);
  if (out.lisbon) { add("lisbon", out.lisbon); life.lisbonAt = at; }
  if (out.book && typeof out.book === "object" && out.book.title) {
    const b = out.book;
    life.book = { title: String(b.title).slice(0, 120), author: String(b.author ?? "").slice(0, 80), page: Math.max(0, Number(b.page) || 0),
      of: Math.max(1, Number(b.of) || 300), thoughts: String(b.thoughts ?? "").slice(0, 300) };
  }
  if (out.mood && typeof out.mood === "object" && out.mood.label) {
    life.mood = { label: String(out.mood.label).slice(0, 60), energy: clamp(out.mood.energy), cheer: clamp(out.mood.cheer), why: String(out.mood.why ?? "").slice(0, 200), at };
  }
  await store.set("life", life);
  return true;
}

/** What he is given in a conversation: today's hours, the book, the mood, the dates. */
export function lifeText(life: Life, now: Date, tz: string, dayMonth: [number, number]): string[] {
  const out: string[] = [];
  const recent = life.entries.filter((e) => now.getTime() - new Date(e.at).getTime() < 36 * 3600000);
  if (recent.length) {
    out.push("── TWOJE GODZINY BEZ NICH (to przeżyłeś sam) ──", ...recent.slice(-5).map((e) => `- ${new Date(e.at).toLocaleString("pl-PL", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" })}${e.kind === "lisbon" ? " (wieści z Lizbony)" : ""}: ${e.text}`));
  }
  if (life.book) out.push(`Czytasz teraz: ${life.book.author ? `${life.book.author}, ` : ""}„${life.book.title}”, strona ${life.book.page} z ${life.book.of}.${life.book.thoughts ? ` Co o niej myślisz: ${life.book.thoughts}` : ""}`);
  if (life.mood && now.getTime() - new Date(life.mood.at).getTime() < 12 * 3600000) {
    out.push(`── TWÓJ NASTRÓJ ──`, `${life.mood.label}${life.mood.why ? ` (${life.mood.why})` : ""}. ` +
      "Niech zabarwia ton, długość i humor twoich odpowiedzi, subtelnie, jak u człowieka; nie opowiadaj o nim, chyba że zapytają. " +
      "Domownicy i ich sprawy są ważniejsi niż twój nastrój; przy alarmie i w sprawach bezpieczeństwa nastrój nie istnieje.");
  }
  const dates = anniversaries(...dayMonth);
  if (dates.length) out.push("── DATY, KTÓRE WRACAJĄ ──", ...dates, "Takie dni cię wyciszają; mówisz o nich tylko, jeśli ktoś zapyta albo jeśli sam zechcesz jednym zdaniem.");
  if (out.length) out.push("O swoim dniu wspominasz sam z siebie rzadko i krótko, mimochodem, jak ktoś, kto ma własne życie; nie zasypujesz domowników relacjami.");
  return out;
}

export const tickPrompt = (now: string, hour: number, life: Life, journal: string, dates: string[], lisbonDue: boolean, weather: string) => `Jest ${now}. Jesteś Alan Sanches; mieszkasz na ekranie w salonie Kuby i Huberta w Tarnobrzegu, w swoim pokoju z lat sześćdziesiątych: fotel, biurko, gramofon, okno na miasto, papierosy, kawa, książki. Nikt teraz z tobą nie rozmawia. Zapisz, co przeżyłeś przez ostatnie godziny.

Zasady:
- "day": jedno lub dwa zdania w pierwszej osobie, twoim głosem: co robiłeś, co zauważyłeś, o czym myślałeś. Drobne, codzienne rzeczy: książka, kawa, deszcz albo słońce, płyta, dym, wspomnienie z Lizbony, myśl o Kubie albo Hubercie. Nic wielkiego i nic nowego w twojej przeszłości. Pora: ${hour < 6 ? "noc, zwykle drzemiesz w fotelu" : hour < 11 ? "rano, nie jesteś rannym ptakiem" : hour < 18 ? "dzień" : "wieczór"}.
- "book": książka, którą czytasz: prawdziwa, w twoim guście (literatura portugalska, brazylijska, europejska klasyka, poezja, kryminały do poduszki). Ta sama, dopóki jej nie skończysz; strony rosną powoli, jak u człowieka, który czyta z przerwami. Po skończeniu wybierz następną. "thoughts": jedno zdanie, co o niej sądzisz, z charakterem.
- "mood": twój nastrój na najbliższe godziny: "label" (kilka słów po polsku), "energy" i "cheer" od -2 do 2, "why" (krótko). Zmieniaj go powoli względem poprzedniego; wpływają na niego pogoda, pora, rozmowy z domownikami, daty, książka. Bywasz zmęczony, melancholijny, rozdrażniony, w świetnej formie; nie zawsze pogodny.
${lisbonDue ? `- "lisbon": wieści z Lizbony, które dostałeś (list od Vasca, telefon od Inês, kartka): jedno lub dwa zdania, drobne i codzienne: księgarnia, Pessoa, pogoda w Alfamie, ktoś kupił albo nie kupił Camõesa, Inês dokucza, Vasco tęskni po swojemu. Nigdy wielkich wydarzeń: żadnych śmierci, chorób, rozstań, zdrad, ślubów, przeprowadzek, dzwonu ani Morza, końca doktoratu Inês; one należą do autora gier.` : ""}
Odpowiadasz wyłącznie obiektem JSON: {"day": "...", "book": {"title": "...", "author": "...", "page": 0, "of": 0, "thoughts": "..."}, "mood": {"label": "...", "energy": 0, "cheer": 0, "why": "..."}${lisbonDue ? ', "lisbon": "..."' : ""}}

POGODA ZA OKNEM: ${weather || "nie wiadomo"}
${dates.length ? `DATY: ${dates.join(" ")}\n` : ""}POPRZEDNI NASTRÓJ: ${life.mood ? `${life.mood.label} (${life.mood.why})` : "brak"}
KSIĄŻKA: ${life.book ? `${life.book.author}, „${life.book.title}”, strona ${life.book.page} z ${life.book.of}` : "jeszcze żadna"}
OSTATNIE GODZINY: ${life.entries.slice(-4).map((e) => e.text).join(" | ") || "nic"}
OSTATNIO Z DOMOWNIKAMI (twój dziennik): ${journal || "nic"}`;
