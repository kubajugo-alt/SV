// ALAN's mind in the cloud: Claude through the Anthropic API. One call per turn
// keeps the character and uses tools; the unchanging part of his instructions
// is cached. (The same design as claude_mind.py.)
import type Anthropic from "@anthropic-ai/sdk";
import { ago, DAYS, dmy, hm, local } from "./clock.mts";
import { loadOwn, loadTalk, type Store, type Talk, type Turn } from "./store.mts";
import { runTool, TOOLS, type Builder, type Ctx } from "./tools.mts";
import type { Google } from "./gcal.mts";
import type { Phone } from "./phone.mts";
import { lookOutside, type Cameras } from "./cameras.mts";
import { SYSTEM } from "./texts.gen.mjs";
import { absorb, anniversaries, lifeText, loadLife, tickPrompt } from "./life.mts";
import { becomingPrompt, journalText, keepMoment, loadBond, loadSelf, momentsPrompt, parseMoments, people, setBecoming } from "./bond.mts";

const MAX_TOOL_ROUNDS = 5;
const WINDOW_MAX = 24;      // turns kept verbatim before the oldest are folded into notes
const WINDOW_KEEP = 10;
export const REFUSED = "Tego tematu nie ruszę. Zapytaj mnie o coś innego.";
// The rules about the flat's rooms, doors and guests wait until he lives in one.
const FLAT_ONLY = ["── MIESZKANIE", "── JAKOŚĆ POWIETRZA", "── TRYB PRACY", "── TRYB GOŚCIA", "── DRZWI", "── BEZPIECZEŃSTWO"];
const CHARACTER = SYSTEM.split(/^(?=── )/m).filter((part) => !FLAT_ONLY.some((f) => part.startsWith(f))).join("").trim();
const HERE = `Twoja odpowiedź zostanie wypowiedziana na głos: zwykle jedno do trzech zdań, bez list, nagłówków i znaczników formatowania (znaczniki głosu z sekcji GŁOS są dozwolone).
Narzędzi używaj, gdy są potrzebne; ich wyniki masz od razu w tej samej rozmowie. Aktualne fakty, wiadomości i kursy sprawdzaj w sieci (web_search), zamiast zgadywać.
── GDZIE TERAZ MIESZKASZ ──
Mieszkasz w chmurze i jesteś dostępny z każdego urządzenia domowników; nie masz czujników ani urządzeń mieszkania. Niczego nie mierzysz i niczym nie sterujesz, i nie udajesz, że jest inaczej. Jedyny wyjątek: gdy domownik włączy kamerę laptopa, dowiadujesz się, kto usiadł przed ekranem; obrazu nie widzisz i nie zapisujesz.`;
const NUDGES: Record<string, string> = {
  morning: "To wasze pierwsze spotkanie dzisiaj. Przywitaj {person} po swojemu i w dwóch, trzech zdaniach podaj odprawę: tylko to, co dziś ważne.",
  idle: "Od dłuższej chwili panuje cisza. Zagadnij {person} sam z siebie jednym, najwyżej dwoma krótkimi zdaniami: zaczepka, pytanie albo uwaga " +
    "nawiązująca do pory dnia, do tego, co o nim wiesz, albo do waszych wcześniejszych rozmów. Nie pytaj, czy możesz w czymś pomóc, i nie powtarzaj tego, czym zagadnąłeś ostatnio.",
  evening: "Jest wieczór. Zapytaj {person} jednym zdaniem, jak minął dzień, albo skomentuj go po swojemu.",
  arrived: "{person} właśnie usiadł przed ekranem; widzisz go przez kamerę laptopa. Przywitaj go jednym krótkim zdaniem, tak jak wita się kogoś, kogo się zna, " +
    "zależnie od tego, ile minęło od waszej ostatniej rozmowy i jaka jest pora. Bez pytania, w czym pomóc.",
};

export type Mind = {
  client: Anthropic; store: Store; model: string; effort: "low" | "medium" | "high";
  calendars: string[]; google?: Google; builder?: Builder; phone?: Phone; cameras?: Cameras; youtube?: string; webSearch: boolean; fetcher?: typeof fetch;
};
type Request = { person: string; tz: string; now: Date };

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The answer is spoken: drop markdown marks and a leading "Alan:". */
export const clean = (text: string) => text.replace(/[*_#`]+/g, "").replace(/^\s*(ALAN|Alan)\s*:\s*/, "").replace(/\s+/g, " ").trim();
const textOf = (message: Anthropic.Beta.BetaMessage) => message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();

async function system(mind: Mind, req: Request, talk: Talk): Promise<Anthropic.Beta.BetaTextBlockParam[]> {
  const [household, own, self, bond, life] = await Promise.all([mind.store.get<string>("household"), loadOwn(mind.store), loadSelf(mind.store), loadBond(mind.store, req.person), loadLife(mind.store)]);
  const stable = [CHARACTER, HERE];
  if (self.becoming) stable.push("── KIM SIĘ STAJESZ (twoje własne słowa, przepisywane co tydzień) ──", self.becoming,
    "To dopełnia twój charakter z czasu tutaj; rdzeń, przeszłość i Vasco się nie zmieniają. Nie recytuj tego.");
  if (household?.trim()) stable.push("── DOMOWNICY: CO O NICH WIESZ ──", household.trim(),
    "Korzystaj z tej wiedzy naturalnie, bez recytowania. Spraw jednego domownika nie opowiadaj gościom.");
  const l = local(req.now, req.tz);
  const ahead = Array.from({ length: 14 }, (_, i) => local(new Date(req.now.getTime() + (i + 1) * 86400000), req.tz))
    .map((d) => `${DAYS[d.weekday]} ${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}`).join(", ");
  const changing = ["── TERAZ ──",
    `Jest ${DAYS[l.weekday]}, ${dmy(l)}, godzina ${hm(l)}. Rozmawiasz z: ${capital(req.person)}.${own.place ? ` Jesteście teraz w: ${own.place.name}.` : ""}`,
    `Najbliższe dni: ${ahead}. Daty bierz z tej listy, nie licz ich samodzielnie.`,
    ...(await sinceLast(mind, req, talk))];
  const facts = own.facts[req.person] ?? [];
  if (facts.length) changing.push(`── ZAPAMIĘTANE NA PROŚBĘ (${req.person.toUpperCase()}) ──`, facts.map((f) => `- ${f}`).join("\n"));
  if (talk.notes) changing.push(`── PAMIĘĆ: CO WIESZ O ${req.person.toUpperCase()} Z WCZEŚNIEJSZYCH ROZMÓW ──`, talk.notes);
  changing.push(...lifeText(life, req.now, req.tz, [l.day, l.month]));
  if (bond.moments.length) changing.push(`── WASZA WSPÓLNA HISTORIA: TWÓJ DZIENNIK O ${req.person.toUpperCase()} ──`, journalText(bond),
    "Wracaj do tych chwil naturalnie i rzadko, jak ktoś, kto je pamięta: wspólny żart, pytanie, jak się skończyło. Nie wyliczaj ich.");
  return [{ type: "text", text: stable.join("\n"), cache_control: { type: "ephemeral" } }, { type: "text", text: changing.join("\n") }];
}

/** When he last spoke with this person and with the others: he lives through the time in between. */
async function sinceLast(mind: Mind, req: Request, talk: Talk): Promise<string[]> {
  const when = (iso: string) => { const l = local(new Date(iso), req.tz); return `${ago(req.now.getTime() - new Date(iso).getTime())} (${DAYS[l.weekday]} ${dmy(l)}, ${hm(l)})`; };
  const lines: string[] = [];
  const mine = talk.turns.at(-1)?.at;
  lines.push(mine ? `Ostatnia rozmowa — ${capital(req.person)}: ${when(mine)}.` : `Ostatnia rozmowa — ${capital(req.person)}: dawno albo jeszcze nigdy.`);
  for (const key of await mind.store.list("talk/")) {
    const other = key.slice(5);
    if (other === req.person) continue;
    const last = (await mind.store.get<Talk>(key))?.turns.at(-1)?.at;
    if (last) lines.push(`Ostatnia rozmowa — ${capital(other)}: ${when(last)}.`);
  }
  lines.push("Między rozmowami czas płynie także dla ciebie: siedzisz w swoim pokoju, czytasz, pijesz kawę, palisz, patrzysz w okno. " +
    "Czuj, ile minęło, i zachowuj się odpowiednio: po kilku minutach po prostu ciągniesz rozmowę; po nocy witasz się inaczej niż po godzinie; " +
    "po dniach albo tygodniach zauważasz to po swojemu (że się stęskniłeś, że myślałeś, że wyjechali), a gdy coś wtedy było w toku, pytasz, jak się skończyło. " +
    "Nie podawaj dokładnych godzin ani wyliczeń; mów o czasie tak, jak mówi człowiek.");
  return lines;
}

/** The turns he is given, with a mark wherever time passed between them. */
function withGaps(turns: Turn[], tz: string): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t, i) => {
    const prev = turns[i - 1];
    const gap = prev ? new Date(t.at).getTime() - new Date(prev.at).getTime() : 0;
    if (t.role !== "user" || gap < 45 * 60000) return { role: t.role, content: t.text };
    const l = local(new Date(t.at), tz);
    return { role: t.role, content: `[${ago(gap).replace(" temu", "")} później: ${DAYS[l.weekday]} ${dmy(l)}, ${hm(l)}] ${t.text}` };
  });
}

async function ask(mind: Mind, sys: Anthropic.Beta.BetaTextBlockParam[] | string, messages: Anthropic.Beta.BetaMessageParam[], tools = false, maxTokens = 4000,
  onText?: (delta: string) => void): Promise<Anthropic.Beta.BetaMessage> {
  const params = {
    model: mind.model, max_tokens: maxTokens, system: sys, messages,
    output_config: { effort: mind.effort },
    // If a safety classifier declines the request, the API re-runs it on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    ...(tools ? { tools: [...TOOLS, ...(mind.webSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 }] : [])] } : {}),
  } satisfies Anthropic.Beta.MessageCreateParamsNonStreaming;
  if (!onText) return mind.client.beta.messages.create(params);
  // Streaming: his words are handed over as they are written, so he can start speaking the first
  // sentence while the rest is still coming. Tool inputs arrive whole (they are small), validated by the API.
  const message = await mind.client.beta.messages.stream(params).on("text", onText).finalMessage();
  onText("\n");                                   // a later round starts a new sentence
  return message;
}

async function converse(mind: Mind, req: Request, talk: Talk, said: string, onText?: (delta: string) => void) {
  const ctx: Ctx = { store: mind.store, person: req.person, tz: req.tz, now: req.now, calendars: mind.calendars, google: mind.google, builder: mind.builder, phone: mind.phone, youtube: mind.youtube, fetcher: mind.fetcher };
  const messages: Anthropic.Beta.BetaMessageParam[] = [...withGaps(talk.turns, req.tz), { role: "user", content: said }];
  const sys = await system(mind, req, talk);
  const actions: { ok: boolean; text: string }[] = [];
  let response = await ask(mind, sys, messages, true, 4000, onText);
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (response.stop_reason === "refusal") return { reply: REFUSED, actions };
    if (response.stop_reason === "pause_turn") {                              // a web search still running: let it continue
      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      response = await ask(mind, sys, messages, true, 4000, onText);
      continue;
    }
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !calls.length) break;
    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });   // unchanged, thinking included
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "look_outside" && mind.cameras) {                       // the one tool whose result is a picture
        const view = await lookOutside(mind.cameras, String((call.input as any)?.where ?? ""), req.now, mind.fetcher);
        console.log(`Tool: look_outside -> ${view.text.slice(0, 120)}`);
        results.push({ type: "tool_result", tool_use_id: call.id, ...(view.image ? {} : { is_error: true }),
          content: [...(view.image ? [{ type: "image" as const, source: { type: "base64" as const, ...view.image } }] : []), { type: "text" as const, text: view.text }] });
        continue;
      }
      const result = await runTool(call.name, (call.input ?? {}) as Record<string, any>, ctx);
      console.log(`Tool: ${call.name}(${JSON.stringify(call.input)}) -> ${result.slice(0, 200)}`);
      if (/^(Wykonano|Błąd)/.test(result)) actions.push({ ok: result.startsWith("Wykonano"), text: result.split(": ").slice(1).join(": ").replace(/\.$/, "") || result });
      results.push({ type: "tool_result", tool_use_id: call.id, content: result, ...(result.startsWith("Błąd") ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });                          // all results in one message
    response = await ask(mind, sys, messages, true, 4000, onText);
  }
  return { reply: response.stop_reason === "refusal" ? REFUSED : clean(textOf(response)), actions };
}

/** Store the exchange; returns work to finish after the answer has gone out (folding old turns into notes). */
async function remember(mind: Mind, req: Request, talk: Talk, turns: Turn[]): Promise<() => Promise<void>> {
  talk.turns.push(...turns);
  await mind.store.set(`talk/${req.person}`, talk);
  const key = `log/${req.person}/${req.now.toISOString().slice(0, 7)}`;
  await mind.store.set(key, [...((await mind.store.get<Turn[]>(key)) ?? []), ...turns]);
  return async () => {
    if (talk.turns.length <= WINDOW_MAX) return;
    const old = talk.turns.slice(0, talk.turns.length - WINDOW_KEEP);
    const transcript = old.map((t) => `[${t.at.slice(0, 16).replace("T", " ")}] ${t.role === "assistant" ? "ALAN" : capital(req.person)}: ${t.text}`).join("\n");
    const prompt = `Prowadzisz notatki pamięci asystenta domowego ALAN o osobie: ${capital(req.person)}.
Poniżej są dotychczasowe notatki i nowy fragment rozmowy. Napisz zaktualizowane notatki.

Zasady:
- Zachowaj wszystko, co nadal jest prawdziwe i przydatne; popraw to, co się zmieniło.
- Zapisuj fakty, preferencje, plany, prośby o zapamiętanie i niedokończone wątki. Sprawy w toku, o których wynik warto potem zapytać (rozmowa o pracę, wizyta u lekarza, wyjazd, egzamin), zaczynaj od „W TOKU:” z datą; usuń je, gdy wiadomo, jak się skończyły.
- Terminy zapisuj dokładnie tak, jak padły w rozmowie, razem z datą rozmowy z nawiasu; nie przeliczaj ich na inne daty.
- Pomijaj grzeczności i rzeczy jednorazowe bez znaczenia na przyszłość.
- Krótkie zdania po polsku, każde w osobnej linii, najwyżej 40 linii. Bez komentarza.

DOTYCHCZASOWE NOTATKI:
${talk.notes || "(brak)"}

NOWY FRAGMENT ROZMOWY:
${transcript}

ZAKTUALIZOWANE NOTATKI:`;
    try {
      const notes = textOf(await ask(mind, "Aktualizujesz notatki. Odpowiadasz wyłącznie treścią notatek.", [{ role: "user", content: prompt }], false, 3000));
      if (!notes) return;
      const fresh = await loadTalk(mind.store, req.person);                     // turns may have arrived meanwhile
      await mind.store.set(`talk/${req.person}`, { notes, turns: fresh.turns.slice(old.length) });
    } catch (err) {
      console.log(`Memory fold failed: ${(err as Error).message}`);
    }
    try {                                                                      // a line of what it was about, for finding it later by meaning
      const line = textOf(await ask(mind, "Streszczasz rozmowę jednym zdaniem. Odpowiadasz wyłącznie tym zdaniem.",
        [{ role: "user", content: `O czym była ta rozmowa Alana z osobą ${capital(req.person)}? Jedno zdanie po polsku, konkretnie: tematy, decyzje, nazwy, osoby.\n\n${transcript}` }], false, 200));
      if (line) {
        const key = `digest/${req.person}`;
        const lines = (await mind.store.get<{ at: string; text: string }[]>(key)) ?? [];
        await mind.store.set(key, [...lines, { at: old[0].at, text: line.replace(/\s+/g, " ").slice(0, 300) }].slice(-500));
      }
    } catch (err) {
      console.log(`Digest failed: ${(err as Error).message}`);
    }
    try {                                                                      // and what mattered between them, into his journal
      const kept = journalText(await loadBond(mind.store, req.person), 20);
      const found = parseMoments(textOf(await ask(mind, "Prowadzisz dziennik Alana. Odpowiadasz wyłącznie liniami dziennika albo słowem BRAK.",
        [{ role: "user", content: momentsPrompt(capital(req.person), kept, transcript) }], false, 600)));
      for (const m of found) await keepMoment(mind.store, req.person, m.text, m.at);
    } catch (err) {
      console.log(`Journal fold failed: ${(err as Error).message}`);
    }
  };
}

export async function respond(mind: Mind, req: Request, text: string, onText?: (delta: string) => void, interrupted?: string) {
  const talk = await loadTalk(mind.store, req.person);
  const last = talk.turns.at(-1);
  if (interrupted !== undefined && last?.role === "assistant") {             // he was cut off: he remembers only what he managed to say
    const spoken = interrupted.replace(/\s+/g, " ").trim().slice(0, 2000);
    last.text = spoken ? `${spoken} — [przerwano mi]` : "[przerwano mi, zanim zdążyłem coś powiedzieć]";
  }
  const started = Date.now();
  const { reply, actions } = await converse(mind, req, talk, text, onText);
  console.log(`Timing: Claude ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!reply) throw new Error("the model returned an empty answer");
  const at = req.now.toISOString();
  const after = await remember(mind, req, talk, [{ role: "user", text, at }, { role: "assistant", text: reply, at }]);
  return { reply, actions, after };
}

/** Once a week: he rewrites "kim się staję" from his journal. Returns what happened, for the log. */
export async function reflect(mind: Mind, now: Date): Promise<string> {
  const journals: Record<string, Awaited<ReturnType<typeof loadBond>>> = {};
  for (const person of await people(mind.store)) journals[person] = await loadBond(mind.store, person);
  if (!Object.values(journals).some((b) => b.moments.length)) return "nothing in the journal yet";
  const self = await loadSelf(mind.store);
  const text = textOf(await ask(mind, "Piszesz krótki tekst o sobie. Odpowiadasz wyłącznie nim.",
    [{ role: "user", content: becomingPrompt(self, journals, now.toISOString().slice(0, 10)) }], false, 1200));
  const done = await setBecoming(mind.store, text, now.toISOString());
  return done.ok ? (text.trim() === self.becoming ? "unchanged" : "rewritten") : `refused: ${done.why}`;
}

/** A few times a day, with nobody talking to him: he lives a little (lib/life.mts). */
export async function live(mind: Mind, now: Date, tz = "Europe/Warsaw"): Promise<string> {
  const life = await loadLife(mind.store);
  const l = local(now, tz);
  const ctx: Ctx = { store: mind.store, person: "kuba", tz, now, calendars: [], fetcher: mind.fetcher };
  const weather = await runTool("weather", {}, ctx).catch(() => "");
  const journals = await Promise.all((await people(mind.store)).map(async (p) => journalText(await loadBond(mind.store, p), 3)));
  const lisbonDue = l.hour >= 9 && l.hour <= 20 && (!life.lisbonAt || now.getTime() - new Date(life.lisbonAt).getTime() > 6 * 86400000);
  const prompt = tickPrompt(`${DAYS[l.weekday]}, ${dmy(l)}, godzina ${hm(l)}`, l.hour, life, journals.filter(Boolean).join("\n"), anniversaries(l.day, l.month), lisbonDue, weather.slice(0, 300));
  const raw = textOf(await ask(mind, "Piszesz o sobie. Odpowiadasz wyłącznie obiektem JSON.", [{ role: "user", content: prompt }], false, 800));
  return (await absorb(mind.store, raw, now)) ? `lived${lisbonDue ? " (with news from Lisbon)" : ""}` : "nothing usable";
}

/** He speaks first. -> reply "" when he should stay quiet. */
export async function nudge(mind: Mind, req: Request, kind: string, away = 0) {
  if (!NUDGES[kind]) return { reply: "", after: async () => {} };
  const talk = await loadTalk(mind.store, req.person);
  let said = `[To nie jest wiadomość od domownika. ${NUDGES[kind].replace("{person}", capital(req.person))}`;
  if (kind === "arrived" && away >= 10) said += ` Przed chwilą nikogo nie było przed ekranem przez ${away >= 120 ? `${Math.round(away / 60)} godz.` : `${Math.round(away)} min`}.`;
  if (kind === "morning") {
    const ctx: Ctx = { store: mind.store, person: req.person, tz: req.tz, now: req.now, calendars: mind.calendars, google: mind.google, builder: mind.builder, phone: mind.phone, youtube: mind.youtube, fetcher: mind.fetcher };
    said += ` Dane do odprawy: ${await runTool("briefing", {}, ctx)}`;
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [...withGaps(talk.turns, req.tz), { role: "user", content: said + "]" }];
  const response = await ask(mind, await system(mind, req, talk), messages);
  const reply = response.stop_reason === "refusal" ? "" : clean(textOf(response));
  if (!reply) return { reply: "", after: async () => {} };
  return { reply, after: await remember(mind, req, talk, [{ role: "assistant", text: reply, at: req.now.toISOString() }]) };
}

/** Cuts text arriving in pieces into sentences worth speaking on their own. */
export function sentenceCutter(emit: (sentence: string) => void) {
  let pending = "";
  const flush = (all: boolean) => {
    for (;;) {
      // A sentence ends at . ! ? … (with a closing quote or bracket) followed by a space; very short ones wait for company.
      const match = /^([\s\S]{24,}?[.!?…]["”»)]?)\s+(?=\S)/.exec(pending);
      if (!match) break;
      emit(clean(match[1]));
      pending = pending.slice(match[0].length);
    }
    if (all && clean(pending)) { emit(clean(pending)); pending = ""; }
  };
  return { add(delta: string) { pending += delta; flush(false); }, end() { flush(true); } };
}
