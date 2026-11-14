import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { eventBody } from "../lib/gcal.mts";
import { approveProposal, listProposals } from "../lib/proposals.mts";
import { loadPlaces, overpassQuery, TOWNS } from "../lib/places.mts";
import { DEFAULT_CAMERAS, lookOutside, parseCameras } from "../lib/cameras.mts";
import { cuesFromCharacters } from "../lib/voice.mts";
import { passwordMatches, sessionCookie, signedIn } from "../lib/auth.mts";
import { nudge, REFUSED, respond, sentenceCutter, type Mind } from "../lib/mind.mts";
import { loadOwn, memoryStore, type Talk } from "../lib/store.mts";
import { feedKey, toIcs } from "../lib/owncal.mts";
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
  assert.match(await runTool("add_event", { title: "Coś", start: "2026-11-17" }, { ...ctx, google: undefined }), /^Wykonano: dopisano do kalendarza „Coś”, 2026-11-17, cały dzień/);   // his own calendar
  assert.equal(calls.length, 2);
});

test("he moves an event, keeping its length, and asks when several fit", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const calls: { url: string; init: any }[] = [];
  let items: object[] = [
    { id: "a1", summary: "Dentysta", start: { dateTime: "2026-11-17T09:30:00+01:00" }, end: { dateTime: "2026-11-17T10:15:00+01:00" } },
    { id: "b2", summary: "Obiad z mamą", start: { dateTime: "2026-11-17T14:00:00+01:00" }, end: { dateTime: "2026-11-17T15:00:00+01:00" } }];
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return String(url).includes("oauth2") ? Response.json({ access_token: "tok" }) : Response.json(init.method === "PATCH" ? {} : { items });
  }) as typeof fetch;
  const ctx = { store: memoryStore(), ...at, calendars: [], fetcher, google: { email: "alan@x.iam.gserviceaccount.com", key, calendar: "primary" } };
  assert.match(await runTool("change_event", { find: "dentysta", day: "2026-11-17", start: "2026-11-18 11:00" }, ctx), /^Wykonano: zmieniono w kalendarzu „Dentysta”, teraz 2026-11-18 11:00–11:45\./);
  assert.match(calls[1].url, /timeMin=2026-11-16T23%3A00%3A00\.000Z&timeMax=2026-11-17T23%3A00%3A00\.000Z&singleEvents=true/);
  assert.equal(calls[2].url, "https://www.googleapis.com/calendar/v3/calendars/primary/events/a1");
  assert.deepEqual(JSON.parse(calls[2].init.body), { start: { dateTime: "2026-11-18T11:00:00", timeZone: "Europe/Warsaw" }, end: { dateTime: "2026-11-18T11:45:00", timeZone: "Europe/Warsaw" } });
  assert.match(await runTool("change_event", { find: "obiad", day: "2026-11-17", title: "Obiad u mamy", location: "Miechocin" }, ctx), /zmieniono w kalendarzu „Obiad z mamą” na „Obiad u mamy”\.$/);
  assert.deepEqual(JSON.parse(calls.at(-1)!.init.body), { summary: "Obiad u mamy", location: "Miechocin" });
  items = [...items, { id: "c3", summary: "Dentysta kontrola", start: { dateTime: "2026-11-17T16:00:00+01:00" }, end: { dateTime: "2026-11-17T16:30:00+01:00" } }];
  assert.match(await runTool("change_event", { find: "dentysta", day: "2026-11-17", start: "2026-11-19 10:00" }, ctx), /^Błąd: tego dnia pasuje kilka wydarzeń: Dentysta, Dentysta kontrola/);
  assert.match(await runTool("change_event", { find: "fryzjer", day: "2026-11-17", title: "X" }, ctx), /^Błąd: tego dnia nie ma/);
  assert.match(await runTool("change_event", { find: "obiad", day: "2026-11-17" }, ctx), /^Błąd: nie podano, co zmienić/);
});

test("a feature request goes to the Claude Code routine and is noted", async () => {
  const calls: { url: string; init: any }[] = [];
  let status = 200;
  const fetcher = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_x" }, { status });
  }) as typeof fetch;
  const ctx = { store: memoryStore(), ...at, calendars: [], fetcher, builder: { routine: "trig_abc", token: "tok" } };
  assert.match(await runTool("request_feature", { request: "Naucz się podawać kursy walut z NBP." }, ctx), /^Wykonano: zlecenie przekazane/);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/claude_code/routines/trig_abc/fire");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.match(JSON.parse(calls[0].init.body).text, /Kuba\), przekazana przez Alana:\nNaucz się podawać kursy walut/);
  assert.match(await runTool("find_notes", { query: "zlecenie" }, ctx), /kursy walut.*session_x/);
  status = 401;
  assert.match(await runTool("request_feature", { request: "Naucz się czegoś nowego." }, ctx), /^Błąd: programista nie przyjął zlecenia \(401\)/);
  assert.match(await runTool("request_feature", { request: "Naucz się czegoś nowego." }, { ...ctx, builder: undefined }), /^Błąd: nie masz połączenia/);
});

test("his proposals are listed with their tests, and only a ready one of his own is merged", async () => {
  const pull = (number: number, ref: string, extra: object = {}) => ({ number, title: "Kursy walut", body: "Opis", html_url: `https://github.com/o/r/pull/${number}`, draft: true, state: "open",
    node_id: "PR_" + number, head: { ref, sha: "sha" + number, repo: { full_name: "o/r" } }, ...extra });
  const pulls = [pull(7, "alan/kursy"), pull(8, "claude/other"), pull(9, "alan/zly", { head: { ref: "alan/zly", sha: "sha9", repo: { full_name: "evil/r" } } }), pull(10, "alan/czerwony")];
  const runs: Record<string, object[]> = { sha7: [{ status: "completed", conclusion: "success" }], sha10: [{ status: "completed", conclusion: "failure" }] };
  const calls: string[] = [];
  const fetcher = (async (url: any, init: any = {}) => {
    const path = String(url).replace("https://api.github.com", "");
    calls.push(`${init.method ?? "GET"} ${path}`);
    assert.equal(init.headers.Authorization, "Bearer t");
    if (path.startsWith("/repos/o/r/pulls?")) return Response.json(pulls);
    if (path.includes("/actions/runs")) return Response.json({ workflow_runs: runs[/head_sha=(\w+)/.exec(path)![1]] ?? [] });
    if (path === "/graphql") return Response.json({ data: {} });
    if (path.endsWith("/merge")) { assert.deepEqual(JSON.parse(init.body), { merge_method: "squash", sha: "sha7" }); return Response.json({ merged: true }); }
    const found = pulls.find((p) => path === `/repos/o/r/pulls/${p.number}`);
    return found ? Response.json(found) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  const gh = { token: "t", repo: "o/r" };
  assert.deepEqual((await listProposals(gh, fetcher)).map((p) => [p.number, p.state]), [[7, "ready"], [10, "failing"]]);
  assert.equal(await approveProposal(gh, 7, fetcher), "Kursy walut");
  assert.deepEqual(calls.slice(-3), ["GET /repos/o/r/actions/runs?head_sha=sha7&per_page=20", "POST /graphql", "PUT /repos/o/r/pulls/7/merge"]);
  await assert.rejects(approveProposal(gh, 8, fetcher), /nie jest otwarta propozycja Alana/);
  await assert.rejects(approveProposal(gh, 9, fetcher), /nie jest otwarta propozycja Alana/);
  await assert.rejects(approveProposal(gh, 10, fetcher), /testy tej propozycji nie przechodzą/);
  await assert.rejects(approveProposal(gh, 99, fetcher), /nie ma takiej propozycji/);
  assert.equal(calls.filter((c) => c.startsWith("PUT")).length, 1);
});

test("links for shopping and rides are shown, never made up into purchases", async () => {
  const ctx = { store: memoryStore(), ...at, calendars: [] };
  assert.equal(await runTool("show_link", { title: "Filtr do ekspresu, 64 zł", url: "https://allegro.pl/oferta/filtr-123" }, ctx), "Wykonano: link na ekranie: Filtr do ekspresu, 64 zł https://allegro.pl/oferta/filtr-123");
  for (const url of ["http://allegro.pl/x", "javascript:alert(1)", "https://user@evil.example/x", "nie adres"]) assert.match(await runTool("show_link", { title: "X", url }, ctx), /^Błąd/);
  const ride = await runTool("ride_link", { destination: "Lotnisko Rzeszów-Jasionka" }, ctx);
  assert.match(ride, /https:\/\/m\.uber\.com\/ul\/\?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=Lotnisko%20Rzesz%C3%B3w-Jasionka$/);
});

test("a phone call is proposed first, placed only when confirmed in a later turn, and reported once", async () => {
  const calls: { url: string; init: any }[] = [];
  let status = "in-progress";
  const fetcher = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/outbound-call")) return Response.json({ success: true, message: "ok", conversation_id: "conv_1", callSid: "CA1" });
    return Response.json({ status, transcript: [{ role: "agent", message: "Dzień dobry" }, { role: "user", message: "Będzie za dziesięć minut." }],
      analysis: { call_successful: "success", transcript_summary: "Taksówka przyjedzie za dziesięć minut." } });
  }) as typeof fetch;
  const store = memoryStore();
  const phone = { key: "k", agent: "agent_1", number: "phnum_1" };
  const ctx = { store, ...at, calendars: [], fetcher, phone };
  const ask = { name: "Radio Taxi", number: "15 822 12 34", task: "Taksówka na Waryńskiego 6, jak najszybciej, na nazwisko Jugo." };
  assert.match(await runTool("phone_call", ask, ctx), /^Rozmowa przygotowana, jeszcze nie dzwonisz\. .*\+48158221234/);
  assert.match(await runTool("phone_call", ask, ctx), /^Rozmowa przygotowana/);                       // the same turn cannot confirm itself
  assert.equal(calls.length, 0);
  const later = { ...ctx, now: new Date(at.now.getTime() + 20000) };
  assert.match(await runTool("phone_call", { ...ask, number: "158221299" }, later), /^Rozmowa przygotowana/);   // another number starts over
  const later2 = { ...ctx, now: new Date(at.now.getTime() + 40000) };
  assert.match(await runTool("phone_call", { ...ask, number: "158221299" }, later2), /^Wykonano: dzwonię do Radio Taxi/);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual([sent.agent_id, sent.agent_phone_number_id, sent.to_number], ["agent_1", "phnum_1", "+48158221299"]);
  assert.equal(sent.conversation_initiation_client_data.dynamic_variables.task, ask.task);
  assert.equal(calls[0].init.headers["xi-api-key"], "k");
  for (const bad of ["112", "+44 20 7946 0958", "700 123 456", "801 123 456", "abc"]) assert.match(await runTool("phone_call", { ...ask, number: bad }, later2), /^Błąd: dzwonisz tylko/);
  assert.deepEqual((await agenda(store, new Date(later2.now.getTime() + 60000), phone, fetcher)).say, []);            // still talking
  status = "done";
  assert.deepEqual((await agenda(store, new Date(later2.now.getTime() + 90000), phone, fetcher)).say, ["Kuba, rozmowa z Radio Taxi: Taksówka przyjedzie za dziesięć minut."]);
  assert.deepEqual((await agenda(store, new Date(later2.now.getTime() + 120000), phone, fetcher)).say, []);           // said once
  assert.match(await runTool("call_result", {}, later2), /Radio Taxi \(09:00\): Taksówka przyjedzie za dziesięć minut\./);
  assert.match(await runTool("phone_call", ask, { ...ctx, phone: undefined }), /^Błąd: nie masz podłączonego telefonu/);
});

test("the places list comes from the map, is searched by town, kind and words, and carries the household's notes", async () => {
  const sandomierz = [
    { tags: { name: "Winnica Sandomierska", craft: "winery", "addr:street": "Zawichojska", "addr:housenumber": "2", phone: "+48 15 000 00 00" } },
    { tags: { name: "Zamek Królewski", historic: "castle", tourism: "museum", opening_hours: "Tu-Su 10:00-17:00" } },
    { tags: { name: "Sklep rybny", shop: "seafood" } }];
  const tarnobrzeg = [
    { tags: { name: "Pizzeria Roma", amenity: "restaurant", cuisine: "pizza;italian", "addr:street": "Sienkiewicza", "addr:housenumber": "10", opening_hours: "Mo-Su 12:00-22:00" } },
    { tags: { name: "Pizzeria Roma", amenity: "restaurant", "addr:street": "Sienkiewicza", "addr:housenumber": "10" } },
    { tags: { name: "Kino Wisła", amenity: "cinema" } }, { tags: { name: "Zamek Tarnowskich", historic: "castle" } }, { tags: { amenity: "bar" } }];
  let down = false;
  const asked: string[] = [];
  const fetcher = (async (url: any, init: any) => {
    if (down) throw new Error("offline");
    const query = init.body.get("data") as string;
    asked.push(query);
    return Response.json({ elements: query.includes(TOWNS.Sandomierz.join(",")) ? sandomierz : tarnobrzeg });
  }) as typeof fetch;
  const store = memoryStore();
  const ctx = { store, ...at, calendars: [], fetcher };
  assert.match(overpassQuery("Tarnobrzeg"), /nwr\["amenity"~"\^\(restaurant\|bar\|pub\|cafe.*\]\["name"\]\(50\.5,21\.58,50\.645,21\.8\);/);
  const pizza = await runTool("find_place", { query: "pizza", town: "w Tarnobrzegu" }, ctx);
  assert.equal(pizza, "Miejsca (1): Pizzeria Roma (restauracja, Tarnobrzeg); adres: Sienkiewicza 10; kuchnia: pizza, italian; godziny: Mo-Su 12:00-22:00.");
  assert.equal(asked.length, 2);
  assert.equal((await store.get<any>("places")).rows.length, 5);                       // no fish shop, no nameless bar, the pizzeria once
  assert.match(await runTool("find_place", { kind: "zamek" }, ctx), /^Miejsca \(2\): .*Zamek Królewski \(muzeum, Sandomierz\).*Zamek Tarnowskich \(zamek, Tarnobrzeg\)|^Miejsca \(1\)/);
  assert.match(await runTool("note_place", { name: "pizzeria roma", town: "Tarnobrzeg", text: "Najlepsza capricciosa w mieście." }, ctx), /^Wykonano: zapisano o miejscu Pizzeria Roma \(Tarnobrzeg\): Najlepsza/);
  assert.match(await runTool("note_place", { name: "Bar u Zdzicha", town: "Sandomierzu", text: "Nowy bar przy rynku, dobre piwo." }, ctx), /Bar u Zdzicha \(Sandomierz\), którego nie było w bazie/);
  assert.match(await runTool("note_place", { name: "X", town: "Kraków", text: "Dobre." }, ctx), /^Błąd: baza obejmuje/);
  assert.match(await runTool("find_place", { query: "capricciosa" }, ctx), /Pizzeria Roma.*notatka domowników \(Kuba\): Najlepsza capricciosa w mieście\./);
  assert.match(await runTool("find_place", { query: "piwo", town: "Sandomierz" }, ctx), /Bar u Zdzicha \(miejsce dopisane przez domowników, Sandomierz\); notatka domowników/);
  assert.equal(asked.length, 2);                                                         // the stored list is used
  down = true;
  assert.equal((await loadPlaces(store, at.now, fetcher, true))!.rows.length, 5);       // a failed refresh keeps the old list
  assert.match(await runTool("find_place", { query: "sushi" }, ctx), /^W bazie miejsc nic takiego nie ma/);
  assert.match(await runTool("find_place", {}, { ...ctx, store: memoryStore() }), /^Błąd: baza miejsc jeszcze się nie pobrała/);
});

test("he looks outside through a webcam: the picture goes to the model with its age", async () => {
  const asked: string[] = [];
  const fetcher = (async (url: any, init: any = {}) => {
    asked.push(String(url));
    if (String(url).includes("api.windy.com")) {
      assert.equal(init.headers["x-windy-api-key"], "wk");
      return Response.json({ title: "Sandomierz", lastUpdatedOn: "2026-11-13T07:48:00Z", images: { current: { preview: "https://images.example/s.jpg" } } });
    }
    return new Response(new Uint8Array([255, 216, 255, 224]), { headers: { "Content-Type": "image/jpeg" } });
  }) as typeof fetch;
  const { mind, seen } = fakeMind([[call("look_outside", { where: "Sandomierz" })], "tool_use"], [[text("Szaro, mokro, parasol się przyda.")], "end_turn"]);
  Object.assign(mind, { fetcher, cameras: { key: "wk", list: parseCameras(DEFAULT_CAMERAS) } });
  const out = await respond(mind, at, "Jak jest w Sandomierzu?");
  assert.equal(out.reply, "Szaro, mokro, parasol się przyda.");
  assert.deepEqual(asked, ["https://api.windy.com/webcams/api/v3/webcams/1306880639?include=images", "https://images.example/s.jpg"]);
  const [picture, words] = seen[1].messages.at(-1).content[0].content;
  assert.deepEqual(picture, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" } });
  assert.match(words.text, /^Kamera: Sandomierz\. Obraz sprzed 12 min\./);
  assert.equal((await lookOutside({ key: "wk", list: parseCameras(DEFAULT_CAMERAS) }, "", at.now, (async () => new Response("", { status: 401 })) as typeof fetch)).text,
    "Błąd: kamera Jezioro Tarnobrzeskie w Tarnobrzegu nie odpowiada (401).");
  assert.match(await runTool("look_outside", {}, { store: memoryStore(), ...at, calendars: [] }), /^Błąd: nie masz podłączonych kamer/);
});

test("without Google he keeps a calendar of his own, publishes it as a feed and reads it back", async () => {
  const store = memoryStore();
  const ctx = { store, ...at, calendars: [] };
  assert.equal(await runTool("add_event", { title: "Dentysta, przegląd", start: "2026-11-17 09:30", location: "Tarnobrzeg" }, ctx), "Wykonano: dopisano do kalendarza „Dentysta, przegląd”, 2026-11-17 09:30–10:30.");
  assert.match(await runTool("add_event", { title: "Sibos", start: "2026-11-20", end: "2026-11-22" }, ctx), /„Sibos”, 2026-11-20, cały dzień\.$/);
  assert.match(await runTool("add_event", { title: "Coś", start: "w piątek" }, ctx), /^Błąd: początek podaj/);
  const own = await loadOwn(store);
  const ics = toIcs(own.events, at.now);
  assert.match(ics, /BEGIN:VCALENDAR\r\n[\s\S]*DTSTART:20261117T083000Z\r\nDTEND:20261117T093000Z\r\nSUMMARY:Dentysta\\, przegląd\r\nLOCATION:Tarnobrzeg\r\nEND:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261123\r\nSUMMARY:Sibos/);
  assert.match(await runTool("calendar", { day: "2026-11-17" }, ctx), /09:30–10:30: Dentysta, przegląd \(Tarnobrzeg\)/);
  assert.match(await runTool("calendar", { day: "2026-11-21" }, ctx), /cały dzień: Sibos/);
  assert.equal(await runTool("change_event", { find: "dentysta", day: "2026-11-17", start: "2026-11-18 11:00", title: "Dentysta" }, ctx), "Wykonano: zmieniono w kalendarzu „Dentysta, przegląd” na „Dentysta”, teraz 2026-11-18 11:00–12:00.");
  assert.match(await runTool("change_event", { find: "dentysta", day: "2026-11-17", title: "X" }, ctx), /^Błąd: tego dnia nie ma w twoim kalendarzu/);
  assert.match(await runTool("change_event", { find: "sibos", day: "2026-11-21", cancel: true }, ctx), /^Wykonano: usunięto z kalendarza „Sibos”/);
  assert.deepEqual((await loadOwn(store)).events.map((e) => e.title), ["Dentysta"]);
  assert.equal(feedKey("haslo").length, 32);
  assert.notEqual(feedKey("haslo"), feedKey("inne"));
});

test("without a routine, a feature request becomes an [ALAN] issue on GitHub", async () => {
  const calls: { url: string; init: any }[] = [];
  const fetcher = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return Response.json({ html_url: "https://github.com/o/r/issues/5" }, { status: 201 }); }) as typeof fetch;
  const ctx = { store: memoryStore(), ...at, calendars: [], fetcher, builder: { token: "ghp", repo: "o/r" } };
  assert.match(await runTool("request_feature", { request: "Naucz się podawać kursy walut z NBP." }, ctx), /^Wykonano: zlecenie przekazane/);
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/issues");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.title, "[ALAN] Naucz się podawać kursy walut z NBP.");
  assert.match(sent.body, /Kuba\), przekazana przez Alana:\n\nNaucz się/);
  assert.match(await runTool("find_notes", { query: "zlecenie" }, ctx), /issues\/5/);
});
