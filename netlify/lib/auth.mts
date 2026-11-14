// Only the household gets in: one shared password (ALAN_PASSWORD), exchanged
// for a signed cookie. Every function that touches his mind, memory or the paid
// services checks it.
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "alan_session";
const DAYS = 60;

const sign = (expires: string, secret: string) => createHmac("sha256", secret).update(expires).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function passwordMatches(given: string, secret: string): boolean {
  return Boolean(secret) && same(sign(given, "alan"), sign(secret, "alan"));   // compare digests: no length or timing leak
}

export function sessionCookie(secret: string, now = Date.now()): string {
  const expires = String(now + DAYS * 86400000);
  return `${COOKIE}=${expires}.${sign(expires, secret)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export function signedIn(req: Request, secret: string, now = Date.now()): boolean {
  if (!secret) return false;
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]+)`).exec(req.headers.get("cookie") ?? "");
  return Boolean(match) && +match![1] > now && same(match![2], sign(match![1], secret));
}

/** The 401 every protected function answers with when the cookie is missing. */
export function guard(req: Request): Response | null {
  const secret = Netlify.env.get("ALAN_PASSWORD") ?? "";
  if (!secret) return Response.json({ error: "ALAN_PASSWORD is not set for this site" }, { status: 503 });
  return signedIn(req, secret) ? null : Response.json({ error: "sign in" }, { status: 401 });
}
