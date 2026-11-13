import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { eventBody } from "../lib/gcal.mts";
import { cuesFromCharacters } from "../lib/voice.mts";
import { passwordMatches, sessionCookie, signedIn } from "../lib/auth.mts";
import { nudge, REFUSED, respond, sentenceCutter, type Mind } from "../lib/mind.mts";
import { memoryStore, type Talk } from "../lib/store.mts";
import { agenda, runTool } from "../lib/tools.mts";

const text = (words: string) => ({ type: "text", text: words });
const call = (name: string, input: object) => ({ type: "tool_use", id: "toolu_" + name, name, input });

/** Stands in for the Anthropic client: replays queued responses and records the requests. */
function fakeMind(...responses: [object[], string][]) {
  const seen: any[] = [];
  const store = memoryStore({ household: "Hubert pije herbatę, nie kawę." });
  const create = async (request: any) => {
    seen.push(structuredClone(request));
    const [content, stop_reason] = responses.shift()!;
    return { content, stop_reason };
  };
  const stream = (request: any) => {                       // text arrives a few characters at a time
    const heard: ((delta: string) => void)[] = [];
    const answer = { on: (_: "text", cb: (delta: string) => void) => (heard.push(cb), answer), finalMessage: async () => {
      const message = await create(request);
      for (const block of message.content as any[]) if (block.type === "text") for (const piece of block.text.match(/[\s\S]{1,7}/g) ?? []) heard.forEach((cb) => cb(piece));
      return message;
    } };
    return answer;
  };
  const client = { beta: { messages: { create, stream } } };
  const mind = { client, store, model: "claude-opus-5-5", effort: "low", calendars: [], webSearch: true } as unknown as Mind;
  return { mind, seen, store };
}
const at = { person: "kuba", tz: "Europe/Warsaw", now: new Date("2026-11-13T08:00:00Z") };

test("plain talk is one call, with his character cached and the clock after it", async () => {
  const { mind, seen, store } = fakeMind([[{ type: "thinking", thinking: "" }, text("Żyję. Ledwo.")], "end_turn"]);
  const out = await respond(mind, at, "Co słychać?");
  assert.equal(out.reply, "Żyję. Ledwo.");
  assert.deepEqual(out.actions, []);
  assert.equal(seen.length, 1);
  const [stable, changing] = seen[0].system;
  assert.match(stable.text, /Jesteś Alan Sanches/);
  assert.match(stable.text, /Hubert pije herbatę/);
  assert.doesNotMatch(stable.text, /── DRZWI/);
  assert.deepEqual(stable.cache_control, { type: "ephemeral" });
  assert.match(changing.text, /Jest piątek, 13\.11\.2026, godzina 09:00\. Rozmawiasz z: Kuba\./);
  assert.equal(seen[0].fallbacks, "default");
  assert.deepEqual(seen[0].output_config, { effort: "low" });
  assert.ok(seen[0].tools.some((t: any) => t.name === "take_note") && seen[0].tools.some((t: any) => t.type === "web_search_20260209"));
  const talk = (await store.get<Talk>("talk/kuba"))!;
  assert.deepEqual(talk.turns.map((t) => t.role), ["user", "assistant"]);
  assert.equal(((await store.get<any[]>("log/kuba/2026-11")) ?? []).length, 2);
});

test("tools run, their results go back in one message, failures are marked", async () => {
  const thinking = { type: "thinking", thinking: "", signature: "sig" };
  const { mind, seen } = fakeMind(
    [[thinking, call("take_note", { text: "Ślimaki w sosie szarym" }), call("set_place", { place: "Ułan Bator" })], "tool_use"],
    [[text("Zapisane. A gdzie leży Ułan Bator, nie wiem.")], "end_turn"]);
  const out = await respond(mind, at, "Zapisz pomysł i ustaw miejsce");
  assert.deepEqual(out.actions.map((a) => a.ok), [true, false]);
  const second = seen[1].messages;
  assert.deepEqual(second.at(-2).content[0], thinking);                 // his turn passed back unchanged
  const results = second.at(-1).content;
  assert.deepEqual(results.map((r: any) => r.tool_use_id), ["toolu_take_note", "toolu_set_place"]);
  assert.equal(results[1].is_error, true);
  assert.match(await runTool("find_notes", {}, { store: mind.store, ...at, calendars: [] }), /Ślimaki/);
});

test("a refusal is spoken plainly; he can speak first; old turns fold into notes", async () => {
  const { mind, seen, store } = fakeMind([[], "refusal"], [[text("Cisza jak w księgarni.")], "end_turn"], [[text("ok")], "end_turn"], [[text("- Kuba lubi ślimaki.")], "end_turn"]);
  assert.equal((await respond(mind, at, "coś, czego nie wolno")).reply, REFUSED);
  assert.equal((await nudge(mind, at, "idle")).reply, "Cisza jak w księgarni.");
  assert.match(seen[1].messages.at(-1).content, /To nie jest wiadomość od domownika/);
  assert.equal((await nudge(mind, at, "nonsense")).reply, "");
  const talk = (await store.get<Talk>("talk/kuba"))!;
  for (let i = 0; i < 24; i++) talk.turns.push({ role: i % 2 ? "assistant" : "user", text: `t${i}`, at: "2026-11-13T08:00:00.000Z" });
  await store.set("talk/kuba", talk);
  await (await respond(mind, at, "jeszcze jedno")).after();
  const folded = (await store.get<Talk>("talk/kuba"))!;
  assert.equal(folded.notes, "- Kuba lubi ślimaki.");
  assert.equal(folded.turns.length, 10);
});

test("timers come due once; reminders use the household's clock", async () => {
  const store = memoryStore();
  const ctx = { store, ...at, calendars: [] };
  assert.match(await runTool("set_timer", { minutes: 2, label: "makaron" }, ctx), /minutnik nr 1 na 2 min \(makaron\)/);
  assert.match(await runTool("set_reminder", { when: "18:30", text: "zadzwonić do mamy" }, ctx), /na 13\.11\.2026 o 18:30/);
  assert.equal((await agenda(store, new Date("2026-11-13T08:01:00Z"))).timers[0].seconds, 60);
  assert.deepEqual((await agenda(store, new Date("2026-11-13T08:03:00Z"))).say, ["Minutnik makaron: czas minął."]);
  assert.deepEqual((await agenda(store, new Date("2026-11-13T08:04:00Z"))).say, []);
  assert.deepEqual((await agenda(store, new Date("2026-11-13T17:30:30Z"))).say, ["Kuba, przypomnienie: zadzwonić do mamy."]);
});

test("the password opens a signed session and nothing else does", () => {
  assert.ok(passwordMatches("sezam", "sezam"));
  assert.ok(!passwordMatches("sezam2", "sezam") && !passwordMatches("", "sezam") && !passwordMatches("", ""));
  const cookie = sessionCookie("sezam", 1000).split(";")[0];
  const req = (c: string) => new Request("https://x/", { headers: { cookie: c } });
  assert.ok(signedIn(req(cookie), "sezam", 2000));
  assert.ok(!signedIn(req(cookie), "inne", 2000));                       // signed with another password
  assert.ok(!signedIn(req(cookie), "sezam", 1000 + 61 * 86400000));      // expired
  assert.ok(!signedIn(req(cookie.replace(/\d\./, "9.")), "sezam", 2000));  // tampered expiry
  assert.ok(!signedIn(req(""), "sezam", 2000));
});

test("mouth shapes follow the letters and rest in pauses", () => {
  const chars = [..."Mam, o!"];
  const starts = chars.map((_, i) => i * 0.1), ends = starts.map((s, i) => (i === 3 ? s + 0.4 : s + 0.1));
  assert.deepEqual(cuesFromCharacters(chars, starts, ends), [[0, "X"], [0, "A"], [0.1, "D"], [0.2, "A"], [0.3, "X"], [0.5, "E"], [0.7, "X"]]);
});

test("a streamed answer is handed over sentence by sentence, across tool rounds", async () => {
  const { mind, seen } = fakeMind(
    [[text("Chwila, zajrzę do notatek."), call("find_notes", {})], "tool_use"],
    [[text("Nic tam nie ma. **Pusto** jak w kasie po remoncie! Dr. Kowalski by się uśmiał.")], "end_turn"]);
  const said: string[] = [];
  const cutter = sentenceCutter((s) => said.push(s));
  const out = await respond(mind, at, "Co mam w notatkach?", (delta) => cutter.add(delta));
  cutter.end();
  assert.equal(seen.length, 2);
  assert.deepEqual(said, ["Chwila, zajrzę do notatek.", "Nic tam nie ma. Pusto jak w kasie po remoncie!", "Dr. Kowalski by się uśmiał."]);
  assert.match(out.reply, /Kowalski/);
});

test("he adds an event to the Google calendar as a service account", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = (privateKey.export({ type: "pkcs8", format: "pem" }) as string).replace(/\n/g, "\\n");   // as pasted from the key file
  const calls: { url: string; init: any }[] = [];
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return String(url).includes("oauth2") ? Response.json({ access_token: "tok" }) : Response.json({ id: "1" });
  }) as typeof fetch;
  const ctx = { store: memoryStore(), ...at, calendars: [], fetcher, google: { email: "alan@x.iam.gserviceaccount.com", key, calendar: "ktos@example.com" } };
  assert.match(await runTool("add_event", { title: "Dentysta", start: "2026-11-17 09:30", location: "Tarnobrzeg" }, ctx), /^Wykonano: dopisano do kalendarza „Dentysta”, 2026-11-17 09:30–10:30\./);
  assert.match(calls[0].init.body.get("assertion"), /^[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(calls[1].url, "https://www.googleapis.com/calendar/v3/calendars/ktos%40example.com/events");
  assert.equal(calls[1].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[1].init.body), { summary: "Dentysta", location: "Tarnobrzeg",
    start: { dateTime: "2026-11-17T09:30:00", timeZone: "Europe/Warsaw" }, end: { dateTime: "2026-11-17T10:30:00", timeZone: "Europe/Warsaw" } });
  assert.deepEqual(eventBody({ title: "Sibos", start: "2026-11-20", end: "2026-11-22" }, "Europe/Warsaw"), { summary: "Sibos", start: { date: "2026-11-20" }, end: { date: "2026-11-23" } });
  assert.match(await runTool("add_event", { title: "Coś", start: "w piątek" }, ctx), /^Błąd: początek podaj/);
  assert.match(await runTool("add_event", { title: "Coś", start: "2026-11-17" }, { ...ctx, google: undefined }), /^Błąd: nie masz prawa pisać/);
});
