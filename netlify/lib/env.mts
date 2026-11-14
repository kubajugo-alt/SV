// What the functions read from the site's environment.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_CAMERAS, parseCameras } from "./cameras.mts";
import { safeZone } from "./clock.mts";
import type { Mind } from "./mind.mts";
import { blobStore } from "./store.mts";
import { parsePeople, type WhatsApp } from "./whatsapp.mts";

/** The phone: an ElevenLabs agent and the number it calls from. */
export function phone() {
  const p = { key: Netlify.env.get("ELEVENLABS_API_KEY") ?? "", agent: Netlify.env.get("ALAN_CALL_AGENT_ID") ?? "", number: Netlify.env.get("ALAN_CALL_NUMBER_ID") ?? "" };
  return p.key && p.agent && p.number ? p : undefined;
}

/** Alan's WhatsApp number (lib/whatsapp.mts): all five settings, or none. */
export function whatsapp(): WhatsApp | undefined {
  const get = (k: string) => Netlify.env.get(k) ?? "";
  const wa = { token: get("WHATSAPP_TOKEN"), phoneId: get("WHATSAPP_PHONE_ID"), appSecret: get("WHATSAPP_APP_SECRET"), verify: get("WHATSAPP_VERIFY_TOKEN"), people: parsePeople(get("ALAN_WHATSAPP_PEOPLE")) };
  return wa.token && wa.phoneId && wa.appSecret && wa.verify && wa.people.size ? wa : undefined;
}

/** Who changes his code: a Claude Code routine when its token is set, else the GitHub repository (issues picked up by a workflow). */
function builder() {
  const routine = Netlify.env.get("ALAN_ROUTINE_ID"), token = Netlify.env.get("ALAN_ROUTINE_TOKEN");
  if (routine && token) return { routine, token };
  const github = Netlify.env.get("ALAN_GITHUB_TOKEN");
  return github ? { token: github, repo: Netlify.env.get("ALAN_GITHUB_REPO") ?? "kubajugo-alt/SV" } : undefined;
}

export function mind(): Mind {
  // Writing to the calendar: a Google service account the calendar was shared with.
  const google = { email: Netlify.env.get("GOOGLE_CLIENT_EMAIL") ?? "", key: Netlify.env.get("GOOGLE_PRIVATE_KEY") ?? "", calendar: Netlify.env.get("ALAN_CALENDAR_ID") ?? "" };
  const effort = Netlify.env.get("ALAN_CLAUDE_EFFORT") ?? "low";
  return {
    client: new Anthropic({ apiKey: Netlify.env.get("ANTHROPIC_API_KEY") }),
    store: blobStore(),
    model: Netlify.env.get("ALAN_CLAUDE_MODEL") ?? "claude-sonnet-5-5",   // talk, notes, digests, journal, the weekly reflection
    effort: effort === "medium" || effort === "high" ? effort : "low",
    calendars: (Netlify.env.get("ALAN_CALENDARS") ?? "").split(/[\s,]+/).filter((u) => u.startsWith("https://")),
    google: google.email && google.key && google.calendar ? google : undefined,
    builder: builder(),
    phone: phone(),
    cameras: Netlify.env.get("WINDY_API_KEY")
      ? { key: Netlify.env.get("WINDY_API_KEY")!, list: parseCameras(Netlify.env.get("ALAN_WEBCAMS") ?? DEFAULT_CAMERAS) } : undefined,
    youtube: Netlify.env.get("YOUTUBE_API_KEY") || undefined,
    background: Netlify.env.get("ALAN_BACKGROUND_MODEL") || "claude-haiku-5-5",
    webSearch: (Netlify.env.get("ALAN_WEB_SEARCH") ?? "on") !== "off",
  };
}

/** Who is talking and in which time zone, from what the page sent. */
export function who(person: unknown, tz: unknown) {
  const name = String(person ?? "kuba").toLowerCase();
  return { person: /^[a-ząćęłńóśźż]{1,24}$/.test(name) ? name : "kuba", tz: safeZone(tz), now: new Date() };
}
