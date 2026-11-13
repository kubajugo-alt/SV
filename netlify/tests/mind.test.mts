import assert from "node:assert/strict";
import { test } from "node:test";
import { cuesFromCharacters } from "../lib/voice.mts";
import { passwordMatches, sessionCookie, signedIn } from "../lib/auth.mts";
import { nudge, REFUSED, respond, type Mind } from "../lib/mind.mts";
import { memoryStore, type Talk } from "../lib/store.mts";
import { agenda, runTool } from "../lib/tools.mts";

const text = (words: string) => ({ type: "text", text: words });
const call = (name: string, input: object) => ({ type: "tool_use", id: "toolu_" + name, name, input });

/** Stands in for the Anthropic client: replays queued responses and records the requests. */
function fakeMind(...responses: [object[], string][]) {
  const seen: any[] = [];
  const store = memoryStore({ household: "Hubert pije herbatę, nie kawę." });
  const client = { beta: { messages: { create: async (request: any) => {
    seen.push(structuredClone(request));
    const [content, stop_reason] = responses.shift()!;
    return { content, stop_reason };
  } } } };
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
