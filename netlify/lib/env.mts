// What the functions read from the site's environment.
import Anthropic from "@anthropic-ai/sdk";
import { safeZone } from "./clock.mts";
import type { Mind } from "./mind.mts";
import { blobStore } from "./store.mts";

export function mind(): Mind {
  const effort = Netlify.env.get("ALAN_CLAUDE_EFFORT") ?? "low";
  return {
    client: new Anthropic({ apiKey: Netlify.env.get("ANTHROPIC_API_KEY") }),
    store: blobStore(),
    model: Netlify.env.get("ALAN_CLAUDE_MODEL") ?? "claude-opus-5-5",
    effort: effort === "medium" || effort === "high" ? effort : "low",
    calendars: (Netlify.env.get("ALAN_CALENDARS") ?? "").split(/[\s,]+/).filter((u) => u.startsWith("https://")),
    webSearch: (Netlify.env.get("ALAN_WEB_SEARCH") ?? "on") !== "off",
  };
}

/** Who is talking and in which time zone, from what the page sent. */
export function who(person: unknown, tz: unknown) {
  const name = String(person ?? "kuba").toLowerCase();
  return { person: /^[a-ząćęłńóśźż]{1,24}$/.test(name) ? name : "kuba", tz: safeZone(tz), now: new Date() };
}
