import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { memoryStore } from "../lib/store.mts";
import { chatText, firstTime, incoming, parsePeople, sendText, shown, signedByMeta } from "../lib/whatsapp.mts";

test("who is who, and only messages Meta signed", () => {
  const people = parsePeople("48500100200=kuba, +48 600 100 200 = Hubert, zły=wpis, 123=x");
  assert.deepEqual([...people], [["48500100200", "kuba"], ["48600100200", "hubert"]]);
  const raw = JSON.stringify({ entry: [] });
  const sig = "sha256=" + createHmac("sha256", "sekret").update(raw).digest("hex");
  assert.equal(signedByMeta(raw, sig, "sekret"), true);
  assert.equal(signedByMeta(raw + " ", sig, "sekret"), false);
  assert.equal(signedByMeta(raw, sig, ""), false);
  assert.equal(signedByMeta(raw, null, "sekret"), false);
});

test("messages are read out of a webhook call; statuses are not messages; each is answered once", async () => {
  const body = { entry: [{ changes: [{ value: {
    messages: [{ id: "wamid.1", from: "48500100200", type: "text", text: { body: "Hej Alan" } }, { id: "wamid.2", from: "48500100200", type: "audio", audio: { id: "m9" } }, { id: "wamid.3", from: "48500100200", type: "sticker" }],
    statuses: [{ id: "wamid.0", status: "read" }] } }] }] };
  assert.deepEqual(incoming(body), [
    { id: "wamid.1", from: "48500100200", kind: "text", text: "Hej Alan" },
    { id: "wamid.2", from: "48500100200", kind: "audio", media: "m9" },
    { id: "wamid.3", from: "48500100200", kind: "other" }]);
  const store = memoryStore();
  assert.equal(await firstTime(store, "wamid.1"), true);
  assert.equal(await firstTime(store, "wamid.1"), false);
});

test("what he shows on the page comes as links and photos in the chat; voice tags go", async () => {
  const out = shown([
    { ok: true, text: "mapa na ekranie: Zamek Tarnowskich, Dzików, Tarnobrzeg @50.57720,21.67950" },
    { ok: true, text: "obraz na ekranie: Zamek Krzyżtopór https://upload.wikimedia.org/k.jpg" },
    { ok: true, text: "muzyka: Do gotowania yt:list:PLabcdefghij123" },
    { ok: true, text: "link na ekranie: pizza z Romy, capricciosa https://glovoapp.com/pl/pl/tarnobrzeg/roma/" },
    { ok: true, text: "zapisano na liście zakupy: mleko" },
    { ok: false, text: "nie masz podłączonych kamer" }]);
  assert.deepEqual(out.lines, [
    "📍 Zamek Tarnowskich, Dzików, Tarnobrzeg: https://www.openstreetmap.org/?mlat=50.57720&mlon=21.67950#map=17/50.57720/21.67950",
    "🎵 Do gotowania: https://music.youtube.com/playlist?list=PLabcdefghij123",
    "🔗 pizza z Romy, capricciosa https://glovoapp.com/pl/pl/tarnobrzeg/roma/",
    "⚠️ nie masz podłączonych kamer"]);
  assert.deepEqual(out.photos, [{ link: "https://upload.wikimedia.org/k.jpg", caption: "Zamek Krzyżtopór" }]);
  assert.equal(chatText("Żart. [pause] A teraz [sighs] prawda."), "Żart. A teraz prawda.");
  assert.equal(chatText("No wiesz [pause] tak bywa."), "No wiesz… tak bywa.");
  const sent: any[] = [];
  const fetcher = (async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("{}"); }) as typeof fetch;
  await sendText({ token: "t", phoneId: "123", appSecret: "s", verify: "v", people: new Map() }, "48500100200", "a ".repeat(2500), fetcher);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "https://graph.facebook.com/v21.0/123/messages");
  assert.equal(sent[0].body.to, "48500100200");
  assert.ok(sent.every((s) => s.body.text.body.length <= 4096));
});
