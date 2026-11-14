// GET /session -> 204 when signed in, 401 otherwise.  POST /session {password} -> sets the cookie.
import type { Config } from "@netlify/functions";
import { guard, passwordMatches, sessionCookie } from "../lib/auth.mts";

export default async (req: Request) => {
  if (req.method === "GET") return guard(req) ?? new Response(null, { status: 204 });
  const secret = Netlify.env.get("ALAN_PASSWORD") ?? "";
  if (!secret) return Response.json({ error: "ALAN_PASSWORD is not set for this site" }, { status: 503 });
  let given = "";
  try { given = String((await req.json()).password ?? ""); } catch { /* treated as a wrong password */ }
  if (!passwordMatches(given, secret)) return Response.json({ error: "wrong password" }, { status: 401 });
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(secret) } });
};

export const config: Config = {
  path: "/session",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },   // slows password guessing
};
