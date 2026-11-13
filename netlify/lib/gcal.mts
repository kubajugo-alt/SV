// Writing to a Google calendar, as a service account the calendar was shared with.
// Reading stays with the .ics addresses (diary.mts); this adds events and changes them.

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

/** Start and end as Google expects them: whole days as dates, anything else as local time in the given zone. */
export function times(startIn: unknown, endIn: unknown, tz: string, lengthMs = 0) {
  const start = String(startIn ?? "").trim();
  const end = String(endIn ?? "").trim();
  if (DAY.test(start) && !end && lengthMs > 86400000) {                                        // a moved event keeps its length
    return { start: { date: start }, end: { date: new Date(Date.parse(start + "T00:00:00Z") + lengthMs).toISOString().slice(0, 10) } };
  }
  if (DAY.test(start)) {
    if (end && !DAY.test(end)) throw new Error("wydarzenie całodniowe kończy się datą RRRR-MM-DD");
    if (end && end < start) throw new Error("koniec jest przed początkiem");
    return { start: { date: start }, end: { date: nextDay(end || start) } };          // Google's end date is exclusive
  }
  const from = MOMENT.exec(start);
  if (!from) throw new Error("początek podaj jako RRRR-MM-DD GG:MM albo RRRR-MM-DD");
  let to = MOMENT.exec(end);
  if (end && !to) throw new Error("koniec podaj jako RRRR-MM-DD GG:MM");
  if (!to) {                                                                                    // an hour by default
    const later = new Date(Date.parse(`${from[1]}T${from[2]}:00Z`) + (lengthMs || 3600000)).toISOString();
    to = MOMENT.exec(later.slice(0, 16))!;
  }
  if (`${to[1]}T${to[2]}` <= `${from[1]}T${from[2]}`) throw new Error("koniec jest przed początkiem");
  return { start: { dateTime: `${from[1]}T${from[2]}:00`, timeZone: tz }, end: { dateTime: `${to[1]}T${to[2]}:00`, timeZone: tz } };
}

/** The body of a new event. */
export function eventBody(ev: NewEvent, tz: string) {
  const title = String(ev.title ?? "").trim();
  if (!title) throw new Error("brak tytułu wydarzenia");
  return { summary: title, ...(ev.location ? { location: String(ev.location) } : {}), ...(ev.notes ? { description: String(ev.notes) } : {}), ...times(ev.start, ev.end, tz) };
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

type Found = { id: string; summary?: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } };

/**
 * Change one event: found among those between `from` and `to` by words of its title, then patched.
 * A repeating event is changed on that one day only.
 */
export async function changeEvent(google: Google, find: { from: Date; to: Date; matches: (title: string) => boolean },
  change: Partial<NewEvent>, tz: string, now: Date, fetcher: typeof fetch = fetch) {
  const patch: Record<string, unknown> = {};
  if (change.title?.trim()) patch.summary = change.title.trim();
  if (change.location !== undefined) patch.location = String(change.location);
  if (change.notes !== undefined) patch.description = String(change.notes);
  if (change.end && !change.start) throw new Error("żeby zmienić koniec, podaj też początek wydarzenia");
  if (!change.start && !Object.keys(patch).length) throw new Error("nie podano, co zmienić");
  const token = await accessToken(google, now, fetcher);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(google.calendar)}/events`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const list = await fetcher(`${base}?${new URLSearchParams({ timeMin: find.from.toISOString(), timeMax: find.to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50" })}`, { headers });
  if (list.status === 404) throw new Error("Google nie widzi tego kalendarza: nie został udostępniony kontu usługi albo identyfikator jest inny");
  if (!list.ok) throw new Error(`Google odpowiedział ${list.status}`);
  const found = (((await list.json()).items ?? []) as Found[]).filter((e) => find.matches(e.summary ?? ""));
  if (!found.length) throw new Error("tego dnia nie ma w kalendarzu takiego wydarzenia");
  if (found.length > 1) throw new Error(`tego dnia pasuje kilka wydarzeń: ${found.map((e) => e.summary).join(", ")}; dopytaj, o które chodzi`);
  const [event] = found;
  if (change.start) {
    const length = Date.parse(event.end.dateTime ?? event.end.date ?? "") - Date.parse(event.start.dateTime ?? event.start.date ?? "");
    Object.assign(patch, times(change.start, change.end, tz, Number.isFinite(length) ? length : 0));
  }
  const res = await fetcher(`${base}/${encodeURIComponent(event.id)}`, { method: "PATCH", headers, body: JSON.stringify(patch) });
  if (res.status === 403) throw new Error("konto usługi nie ma prawa zmieniać wydarzeń w tym kalendarzu");
  if (!res.ok) throw new Error(`Google odpowiedział ${res.status}`);
  return { was: event.summary ?? "", patch: patch as { summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } } };
}
