// GET /tts?text=...  -> the line spoken in the games' ElevenLabs voice (MP3), with
// mouth cues in X-Mouth-Cues worked out from the character timing ElevenLabs returns.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { cuesFromCharacters, spokenOnly, voicePlan } from "../lib/voice.mts";

const ROGER = "CwhRBWXzGAHq8TQ4Fs17";       // Alan's voice in the games

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const raw = (new URL(req.url).searchParams.get("text") ?? "").trim().replace(/\bALAN\b/g, "Alan");
  if (!raw || raw.length > 1000) return new Response("text must be 1-1000 characters", { status: 400 });
  const key = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!key) return new Response("No voice: ELEVENLABS_API_KEY is not set", { status: 503 });
  const voice = Netlify.env.get("ALAN_ELEVEN_VOICE") ?? ROGER;
  // Mixed voice: the fast model for ordinary lines; a line with a voice tag goes to the expressive one (lib/voice.mts).
  const plan = voicePlan(raw, Netlify.env.get("ALAN_ELEVEN_MODEL") ?? "eleven_flash_v2_5", Netlify.env.get("ALAN_ELEVEN_EXPRESSIVE") ?? "eleven_v3");
  const call = (path: string, model: string, text: string) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}${path}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, ...(model.includes("v2_5") ? { language_code: "pl" } : {}) }),
  });
  try {
    for (const { model, text } of plan) {
      const timed = await call("/with-timestamps", model, text);
      if (timed.ok) {
        const data = await timed.json() as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
        const a = data.alignment ? spokenOnly(data.alignment.characters, data.alignment.character_start_times_seconds, data.alignment.character_end_times_seconds) : null;
        const cues = a ? cuesFromCharacters(a.chars, a.starts, a.ends) : [];
        return new Response(Buffer.from(data.audio_base64, "base64"), {
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Model": model, ...(cues.length > 2 ? { "X-Mouth-Cues": JSON.stringify(cues).slice(0, 7000) } : {}) },
        });
      }
      console.log(`ElevenLabs timing (${model}) answered ${timed.status}; asking for plain audio.`);
      const plain = await call("", model, text);
      if (plain.ok) return new Response(plain.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Model": model } });
      console.log(`ElevenLabs (${model}) answered ${plain.status}: ${(await plain.text()).slice(0, 200)}`);
    }
    return new Response("The voice service did not answer", { status: 502 });
  } catch (err) {
    console.log(`TTS failed: ${(err as Error).message}`);
    return new Response("The voice service did not answer", { status: 502 });
  }
};

export const config: Config = { path: "/tts", method: "GET" };
