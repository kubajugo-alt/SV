// GET /tts?text=...  -> the line spoken in the games' ElevenLabs voice (MP3), with
// mouth cues in X-Mouth-Cues worked out from the character timing ElevenLabs returns.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { cuesFromCharacters } from "../lib/voice.mts";

const ROGER = "CwhRBWXzGAHq8TQ4Fs17";       // Alan's voice in the games

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const raw = (new URL(req.url).searchParams.get("text") ?? "").trim().replace(/\bALAN\b/g, "Alan");
  if (!raw || raw.length > 1000) return new Response("text must be 1-1000 characters", { status: 400 });
  const key = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!key) return new Response("No voice: ELEVENLABS_API_KEY is not set", { status: 503 });
  const voice = Netlify.env.get("ALAN_ELEVEN_VOICE") ?? ROGER;
  const model = Netlify.env.get("ALAN_ELEVEN_MODEL") ?? "eleven_flash_v2_5"   // made for live conversation; eleven_v4 is the games' model;
  // His voice tags ([sighs], [laughs], [pause]…) are performed by the v3-style models; any other model would read them out, so they go.
  const text = /eleven_v[3-9]/.test(model) ? raw : raw.replace(/\s*\[pause\]\s*/gi, "… ").replace(/\s*\[(sighs|laughs|chuckles|whispers)\]\s*/gi, " ").replace(/\s+/g, " ").trim();
  const call = (path: string) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}${path}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, ...(model.includes("v2_5") ? { language_code: "pl" } : {}) }),
  });
  try {
    const timed = await call("/with-timestamps");
    if (timed.ok) {
      const data = await timed.json() as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
      const a = data.alignment;
      const cues = a ? cuesFromCharacters(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : [];
      return new Response(Buffer.from(data.audio_base64, "base64"), {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...(cues.length > 2 ? { "X-Mouth-Cues": JSON.stringify(cues).slice(0, 7000) } : {}) },
      });
    }
    console.log(`ElevenLabs timing answered ${timed.status}; asking for plain audio.`);
    const plain = await call("");
    if (!plain.ok) {
      console.log(`ElevenLabs answered ${plain.status}: ${(await plain.text()).slice(0, 200)}`);
      return new Response("The voice service did not answer", { status: 502 });
    }
    return new Response(plain.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.log(`TTS failed: ${(err as Error).message}`);
    return new Response("The voice service did not answer", { status: 502 });
  }
};

export const config: Config = { path: "/tts", method: "GET" };
