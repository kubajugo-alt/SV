// POST /stt  (a WAV recording) -> {text}, recognised by ElevenLabs Scribe.
// With ?wake=1 (open microphone) the text is passed on only if it starts with his name.
// Scribe also tags sounds that are not words — a laugh, a sigh: they come first, in brackets
// ("[śmiech] no to dobranoc"), so he hears the tone of voice as well as the words.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { heard } from "../lib/hearing.mts";
export { heard } from "../lib/hearing.mts";   // the tests import it from here

const WAKE = /^[\s\p{P}]*(?:(?:hej|ej|cześć|halo|słuchaj|no)[\s\p{P}]+)?al+an(?:ie|ku)?(?![\p{L}])/iu;
export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const key = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!key) return new Response("No hearing: ELEVENLABS_API_KEY is not set", { status: 503 });
  const audio = await req.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > 4_000_000) return new Response("Expected a recording of up to 4 MB", { status: 400 });
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "said.wav");
  form.append("model_id", Netlify.env.get("ALAN_ELEVEN_STT") ?? "scribe_v1");
  form.append("language_code", "pl");
  form.append("tag_audio_events", "true");
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
    if (!res.ok) {
      console.log(`Scribe answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return new Response("The hearing service did not answer", { status: 502 });
    }
    const { text, tone } = heard(await res.json());
    const wake = new URL(req.url).searchParams.get("wake") === "1";
    if (wake && !WAKE.test(text)) return Response.json({ text: "" });    // his name is looked for in the words, not the laugh
    return Response.json({ text: tone && text ? `${tone} ${text}` : tone || text });
  } catch (err) {
    console.log(`STT failed: ${(err as Error).message}`);
    return new Response("The hearing service did not answer", { status: 502 });
  }
};

export const config: Config = { path: "/stt", method: "POST" };
