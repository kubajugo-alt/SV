// ALAN's mind in the cloud: Claude through the Anthropic API. One call per turn
// keeps the character and uses tools; the unchanging part of his instructions
// is cached. (The same design as claude_mind.py.)
import type Anthropic from "@anthropic-ai/sdk";
import { DAYS, dmy, hm, local } from "./clock.mts";
import { loadOwn, loadTalk, type Store, type Talk, type Turn } from "./store.mts";
import { runTool, TOOLS, type Builder, type Ctx } from "./tools.mts";
import type { Google } from "./gcal.mts";
import type { Phone } from "./phone.mts";
import { SYSTEM } from "./texts.gen.mjs";

const MAX_TOOL_ROUNDS = 5;
const WINDOW_MAX = 24;      // turns kept verbatim before the oldest are folded into notes
const WINDOW_KEEP = 10;
export const REFUSED = "Tego tematu nie ruszę. Zapytaj mnie o coś innego.";
// The rules about the flat's rooms, doors and guests wait until he lives in one.
const FLAT_ONLY = ["── MIESZKANIE", "── JAKOŚĆ POWIETRZA", "── TRYB PRACY", "── TRYB GOŚCIA", "── DRZWI", "── BEZPIECZEŃSTWO"];
const CHARACTER = SYSTEM.split(/^(?=── )/m).filter((part) => !FLAT_ONLY.some((f) => part.startsWith(f))).join("").trim();
const HERE = `Twoja odpowiedź zostanie wypowiedziana na głos: zwykle jedno do trzech zdań, bez list, nagłówków i znaczników.
Narzędzi używaj, gdy są potrzebne; ich wyniki masz od razu w tej samej rozmowie. Aktualne fakty, wiadomości i kursy sprawdzaj w sieci (web_search), zamiast zgadywać.
── GDZIE TERAZ MIESZKASZ ──
Mieszkasz w chmurze i jesteś dostępny z każdego urządzenia domowników; nie masz czujników, kamer ani urządzeń mieszkania. Niczego nie mierzysz i niczym nie sterujesz, i nie udajesz, że jest inaczej.`;
const NUDGES: Record<string, string> = {
  morning: "To wasze pierwsze spotkanie dzisiaj. Przywitaj {person} po swojemu i w dwóch, trzech zdaniach podaj odprawę: tylko to, co dziś ważne.",
  idle: "Od dłuższej chwili panuje cisza. Zagadnij {person} sam z siebie jednym, najwyżej dwoma krótkimi zdaniami: zaczepka, pytanie albo uwaga " +
    "nawiązująca do pory dnia, do tego, co o nim wiesz, albo do waszych wcześniejszych rozmów. Nie pytaj, czy możesz w czymś pomóc, i nie powtarzaj tego, czym zagadnąłeś ostatnio.",
  evening: "Jest wieczór. Zapytaj {person} jednym zdaniem, jak minął dzień, albo skomentuj go po swojemu.",
};

export type Mind = {
  client: Anthropic; store: Store; model: string; effort: "low" | "medium" | "high";
  calendars: string[]; google?: Google; builder?: Builder; phone?: Phone; webSearch: boolean; fetcher?: typeof fetch;
};
type Request = { person: string; tz: string; now: Date };

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The answer is spoken: drop markdown marks and a leading "Alan:". */
export const clean = (text: string) => text.replace(/[*_#`]+/g, "").replace(/^\s*(ALAN|Alan)\s*:\s*/, "").replace(/\s+/g, " ").trim();
const textOf = (message: Anthropic.Beta.BetaMessage) => message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();

async function system(mind: Mind, req: Request, talk: Talk): Promise<Anthropic.Beta.BetaTextBlockParam[]> {
  const [household, own] = await Promise.all([mind.store.get<string>("household"), loadOwn(mind.store)]);
  const stable = [CHARACTER, HERE];
  if (household?.trim()) stable.push("── DOMOWNICY: CO O NICH WIESZ ──", household.trim(),
    "Korzystaj z tej wiedzy naturalnie, bez recytowania. Spraw jednego domownika nie opowiadaj gościom.");
  const l = local(req.now, req.tz);
  const ahead = Array.from({ length: 14 }, (_, i) => local(new Date(req.now.getTime() + (i + 1) * 86400000), req.tz))
    .map((d) => `${DAYS[d.weekday]} ${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}`).join(", ");
  const changing = ["── TERAZ ──",
    `Jest ${DAYS[l.weekday]}, ${dmy(l)}, godzina ${hm(l)}. Rozmawiasz z: ${capital(req.person)}.${own.place ? ` Jesteście teraz w: ${own.place.name}.` : ""}`,
    `Najbliższe dni: ${ahead}. Daty bierz z tej listy, nie licz ich samodzielnie.`];
  const facts = own.facts[req.person] ?? [];
  if (facts.length) changing.push(`── ZAPAMIĘTANE NA PROŚBĘ (${req.person.toUpperCase()}) ──`, facts.map((f) => `- ${f}`).join("\n"));
  if (talk.notes) changing.push(`── PAMIĘĆ: CO WIESZ O ${req.person.toUpperCase()} Z WCZEŚNIEJSZYCH ROZMÓW ──`, talk.notes);
  return [{ type: "text", text: stable.join("\n"), cache_control: { type: "ephemeral" } }, { type: "text", text: changing.join("\n") }];
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
  const ctx: Ctx = { store: mind.store, person: req.person, tz: req.tz, now: req.now, calendars: mind.calendars, google: mind.google, builder: mind.builder, phone: mind.phone, fetcher: mind.fetcher };
  const messages: Anthropic.Beta.BetaMessageParam[] = [...talk.turns.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: said }];
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
- Zapisuj fakty, preferencje, plany, prośby o zapamiętanie i niedokończone wątki.
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
  };
}

export async function respond(mind: Mind, req: Request, text: string, onText?: (delta: string) => void) {
  const talk = await loadTalk(mind.store, req.person);
  const started = Date.now();
  const { reply, actions } = await converse(mind, req, talk, text, onText);
  console.log(`Timing: Claude ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!reply) throw new Error("the model returned an empty answer");
  const at = req.now.toISOString();
  const after = await remember(mind, req, talk, [{ role: "user", text, at }, { role: "assistant", text: reply, at }]);
  return { reply, actions, after };
}

/** He speaks first. -> reply "" when he should stay quiet. */
export async function nudge(mind: Mind, req: Request, kind: string) {
  if (!NUDGES[kind]) return { reply: "", after: async () => {} };
  const talk = await loadTalk(mind.store, req.person);
  let said = `[To nie jest wiadomość od domownika. ${NUDGES[kind].replace("{person}", capital(req.person))}`;
  if (kind === "morning") {
    const ctx: Ctx = { store: mind.store, person: req.person, tz: req.tz, now: req.now, calendars: mind.calendars, google: mind.google, builder: mind.builder, phone: mind.phone, fetcher: mind.fetcher };
    said += ` Dane do odprawy: ${await runTool("briefing", {}, ctx)}`;
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [...talk.turns.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: said + "]" }];
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
