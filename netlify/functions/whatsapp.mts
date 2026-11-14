// Meta's webhook for Alan's WhatsApp number (lib/whatsapp.mts).
//   GET  /whatsapp  Meta checks the address once, with WHATSAPP_VERIFY_TOKEN
//   POST /whatsapp  a message: answered at once with 200 (Meta does not wait), then he reads,
//                   shows "pisze…", thinks and writes back.
import type { Config, Context } from "@netlify/functions";
import { mind, who, whatsapp } from "../lib/env.mts";
import { respond } from "../lib/mind.mts";
import { chatText, download, firstTime, incoming, seenAndTyping, sendImage, sendText, shown, signedByMeta, type Incoming, type WhatsApp } from "../lib/whatsapp.mts";
import { heard } from "../lib/hearing.mts";

async function hear(wa: WhatsApp, media: string): Promise<string> {
  const key = Netlify.env.get("ELEVENLABS_API_KEY");
  const audio = key ? await download(wa, media) : null;
  if (!key || !audio) return "";
  const form = new FormData();
  form.append("file", audio, "voice.ogg");
  form.append("model_id", Netlify.env.get("ALAN_ELEVEN_STT") ?? "scribe_v1");
  form.append("language_code", "pl");
  form.append("tag_audio_events", "true");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) { console.log(`WhatsApp voice note: Scribe answered ${res.status}`); return ""; }
  const { text, tone } = heard(await res.json());
  return tone && text ? `${tone} ${text}` : tone || text;
}

async function answer(wa: WhatsApp, m: Incoming) {
  const person = wa.people.get(m.from)!;
  const brain = mind();
  if (!(await firstTime(brain.store, m.id))) return;
  await seenAndTyping(wa, m.id);
  let text = m.kind === "text" ? (m.text ?? "").trim() : m.kind === "audio" ? await hear(wa, m.media ?? "") : "";
  if (!text) {
    await sendText(wa, m.from, m.kind === "audio" ? "Nie dosłyszałem tej głosówki. Napisz mi to, proszę." : "Na razie czytam tylko tekst i słucham głosówek.");
    return;
  }
  text = text.slice(0, 2000);
  try {
    const result = await respond(brain, who(person, "Europe/Warsaw"), `[WhatsApp] ${text}`);
    const extra = shown(result.actions);
    await sendText(wa, m.from, [chatText(result.reply), ...extra.lines].filter(Boolean).join("\n\n"));
    for (const p of extra.photos) await sendImage(wa, m.from, p.link, p.caption);
    await result.after();
  } catch (err) {
    console.log(`WhatsApp answer failed: ${(err as Error).message}`);
    await sendText(wa, m.from, "Coś mi się zacięło w głowie. Spróbuj za chwilę.");
  }
}

export default async (req: Request, context: Context) => {
  const wa = whatsapp();
  if (!wa) return new Response("WhatsApp is not set up", { status: 503 });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === wa.verify;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!signedByMeta(raw, req.headers.get("x-hub-signature-256"), wa.appSecret)) return new Response("bad signature", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  for (const m of incoming(body)) {
    if (!wa.people.has(m.from)) { console.log("WhatsApp: a message from a number not in ALAN_WHATSAPP_PEOPLE, ignored."); continue; }
    context.waitUntil(answer(wa, m));
  }
  return new Response("ok");
};

export const config: Config = { path: "/whatsapp", method: ["GET", "POST"] };
