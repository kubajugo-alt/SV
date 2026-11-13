// Writing to a Google calendar, as a service account the calendar was shared with.
// Reading stays with the .ics addresses (diary.mts); this only adds events.

export type Google = { email: string; key: string; calendar: string };
export type NewEvent = { title: string; start: string; end?: string; location?: string; notes?: string };

const b64url = (data: ArrayBuffer | string) =>
  Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)).toString("base64url");

/** A short-lived access token for the service account, by signing a JWT with its key. */
async function accessToken(google: Google, now: Date, fetcher: typeof fetch): Promise<string> {
  const pem = google.key.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(pem, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const at = Math.floor(now.getTime() / 1000);
  const claim = { iss: google.email, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat: at, exp: at + 600 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`Google nie przyjął klucza konta usługi (${res.status})`);
  return (await res.json()).access_token;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/;
const nextDay = (day: string) => new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

/** The body Google expects: whole days as dates, anything else as local time in the given zone. */
export function eventBody(ev: NewEvent, tz: string) {
  const title = String(ev.title ?? "").trim();
  const start = String(ev.start ?? "").trim();
  const end = String(ev.end ?? "").trim();
  if (!title) throw new Error("brak tytułu wydarzenia");
  const more = { summary: title, ...(ev.location ? { location: String(ev.location) } : {}), ...(ev.notes ? { description: String(ev.notes) } : {}) };
  if (DAY.test(start)) {
    if (end && !DAY.test(end)) throw new Error("wydarzenie całodniowe kończy się datą RRRR-MM-DD");
    if (end && end < start) throw new Error("koniec jest przed początkiem");
    return { ...more, start: { date: start }, end: { date: nextDay(end || start) } };          // Google's end date is exclusive
  }
  const from = MOMENT.exec(start);
  if (!from) throw new Error("początek podaj jako RRRR-MM-DD GG:MM albo RRRR-MM-DD");
  let to = MOMENT.exec(end);
  if (end && !to) throw new Error("koniec podaj jako RRRR-MM-DD GG:MM");
  if (!to) {                                                                                    // an hour by default
    const later = new Date(Date.parse(`${from[1]}T${from[2]}:00Z`) + 3600000).toISOString();
    to = MOMENT.exec(later.slice(0, 16))!;
  }
  if (`${to[1]}T${to[2]}` <= `${from[1]}T${from[2]}`) throw new Error("koniec jest przed początkiem");
  return { ...more, start: { dateTime: `${from[1]}T${from[2]}:00`, timeZone: tz }, end: { dateTime: `${to[1]}T${to[2]}:00`, timeZone: tz } };
}

export async function addEvent(google: Google, ev: NewEvent, tz: string, now: Date, fetcher: typeof fetch = fetch) {
  const body = eventBody(ev, tz);
  const token = await accessToken(google, now, fetcher);
  const res = await fetcher(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(google.calendar)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new Error("Google nie widzi tego kalendarza: nie został udostępniony kontu usługi albo identyfikator jest inny");
  if (res.status === 403) throw new Error("konto usługi nie ma prawa zmieniać wydarzeń w tym kalendarzu");
  if (!res.ok) throw new Error(`Google odpowiedział ${res.status}`);
  return body;
}
