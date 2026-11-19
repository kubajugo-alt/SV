import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool } from "../lib/tools.mts";
import { memoryStore } from "../lib/store.mts";
import { judgeTake, speak, voiceTest, type Voice } from "../lib/voice.mts";

const v: Voice = { key: "test-key", voice: "VOICE", fast: "eleven_flash_v2_5", expressive: "" };

/** ElevenLabs as the test needs it: each model's timing of the text it got, with audio of a chosen length. */
function fakeEleven(behave: (model: string, text: string, call: number) => { status?: number; seconds?: number; upTo?: number }) {
  const sent: { model: string; text: string }[] = [];
  let calls = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/user/subscription")) return Response.json({ tier: "starter", character_count: 12000, character_limit: 30000 });
    const body = JSON.parse(String(init!.body));
    sent.push({ model: body.model_id, text: body.text });
    const how = behave(body.model_id, body.text, ++calls);
    if (how.status) return new Response("too_many_concurrent_requests", { status: how.status });
    const chars = [...body.text].slice(0, how.upTo ?? Infinity);
    const step = 1 / 14;                                     // 14 characters a second
    const starts = chars.map((_, i) => i * step), ends = chars.map((_, i) => (i + 1) * step);
    const seconds = how.seconds ?? chars.length * step;
    return Response.json({ audio_base64: Buffer.alloc(Math.round(seconds * 16000)).toString("base64"),
      alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } });
  }) as typeof fetch;
  return { fetcher, sent };
}

test("a take is judged by what was spoken: whole, cut short, or stalled", () => {
  const timing = (n: number, gapAt = -1) => {
    const chars = Array(n).fill("a"), starts = chars.map((_, i) => i * 0.07 + (gapAt >= 0 && i >= gapAt ? 2 : 0));
    return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: starts.map((s) => s + 0.07) };
  };
  const text = "a".repeat(100);
  assert.equal(judgeTake(text, 7 * 16000, timing(100), 1200).cut, false);
  assert.match(judgeTake(text, 7 * 16000, timing(100), 1200).text, /odpowiedź po 1,2 s, nagranie 7,0 s, 14,3 znaków\/s, bez urywania/);
  assert.match(judgeTake(text, 3 * 16000, timing(100), 900).text, /nagranie \(3,0 s\) kończy się przed końcem tekstu/);
  assert.match(judgeTake(text, 5 * 16000, timing(60), 900).text, /przeczytał tylko 60 z 100 znaków/);
  assert.match(judgeTake(text, 9 * 16000, timing(100, 50), 900).text, /dziura w mowie 2,0 s/);
  assert.equal(judgeTake("ab [short pause] cd", 1 * 16000, timing(6), 100).cut, false);   // the tag is not spoken
});

test("the voice test compares the models on a long line with a pause, and finds the one that cuts", async () => {
  const { fetcher, sent } = fakeEleven((model) => (model === "eleven_multilingual_v2" ? { seconds: 4 } : model === "eleven_turbo_v2_5" ? { status: 400 } : {}));
  const report = await voiceTest(v, fetcher);
  assert.deepEqual(sent.map((s) => s.model).sort(), ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_v3"]);
  assert.match(sent.find((s) => s.model === "eleven_v3")!.text, /\[short pause\]/);            // v3 performs the pause
  assert.doesNotMatch(sent.find((s) => s.model === "eleven_flash_v2_5")!.text, /\[/);         // the others hear "…"
  assert.match(report, /^Wykonano test głosu ElevenLabs \(głos VOICE\) na tekście \d+ znaków ze znacznikiem \[pause\]\./);
  assert.match(report, /eleven_flash_v2_5 \(twój obecny\): odpowiedź po [\d,]+ s, nagranie [\d,]+ s, [\d,]+ znaków\/s, bez urywania\./);
  assert.match(report, /eleven_multilingual_v2: .*kończy się przed końcem tekstu/);
  assert.match(report, /eleven_turbo_v2_5: błąd 400/);
  assert.match(report, /Bez urywania: eleven_flash_v2_5, eleven_v3\./);
  assert.match(report, /Konto starter: zużyte 12000 z 30000 znaków/);
  assert.doesNotMatch(report, /429/);
});

test("a refused request (429) is asked again; refusals that last are reported as the limit of requests at a time", async () => {
  const again = fakeEleven((_, __, call) => (call === 1 ? { status: 429 } : {}));
  const res = await speak(v, "eleven_flash_v2_5", "Dzień dobry.", true, again.fetcher, [1]);
  assert.equal(res.status, 200);
  assert.equal(again.sent.length, 2);
  const busy = fakeEleven((model) => (model === "eleven_v3" ? { status: 429 } : {}));
  const report = await voiceTest(v, busy.fetcher, ["eleven_flash_v2_5", "eleven_v3", "nie_model"], "Krótki tekst do sprawdzenia, czy głos dochodzi do końca.", [1, 1]);
  assert.equal(busy.sent.filter((s) => s.model === "eleven_v3").length, 3);
  assert.ok(!busy.sent.some((s) => s.model === "nie_model"));
  assert.match(report, /eleven_v3: błąd 429/);
  assert.match(report, /odrzuciło mimo ponowień 1 z 2 równoczesnych zapytań \(429\)/);
});

test("voice_test is a tool: without the key it says so, and a text too long is refused", async () => {
  const ctx = { store: memoryStore(), person: "kuba", tz: "Europe/Warsaw", now: new Date("2026-11-19T10:00:00Z"), calendars: [] };
  assert.match(await runTool("voice_test", {}, ctx), /^Błąd: nie masz podłączonego głosu ElevenLabs/);
  assert.match(await runTool("voice_test", { text: "a".repeat(1001) }, { ...ctx, voice: v }), /^Błąd: tekst do testu może mieć najwyżej 1000 znaków/);
  const { fetcher } = fakeEleven(() => ({}));
  assert.match(await runTool("voice_test", { models: ["eleven_flash_v2_5"] }, { ...ctx, voice: v, fetcher }), /^Wykonano test głosu.*Bez urywania: eleven_flash_v2_5\./);
});
