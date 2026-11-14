// GET /calendar.ics?key=...  -> ALAN's own calendar as an iCalendar feed, for calendar apps to subscribe to.
// GET /calendar-link         -> {url}: that address, for someone signed in.
// The key in the address is derived from the household password; a calendar app cannot sign in.
import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { feedKey, toIcs } from "../lib/owncal.mts";
import { blobStore, loadOwn } from "../lib/store.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  const secret = Netlify.env.get("ALAN_PASSWORD") ?? "";
  if (url.pathname === "/calendar-link") return guard(req) ?? Response.json({ url: `${url.origin}/calendar.ics?key=${feedKey(secret)}` });
  const given = Buffer.from(url.searchParams.get("key") ?? "");
  const wanted = Buffer.from(secret ? feedKey(secret) : "");
  if (!secret || given.length !== wanted.length || !timingSafeEqual(given, wanted)) return new Response("Not found", { status: 404 });
  const own = await loadOwn(blobStore());
  return new Response(toIcs(own.events, new Date()), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
};

export const config: Config = { path: ["/calendar.ics", "/calendar-link"], method: "GET" };
