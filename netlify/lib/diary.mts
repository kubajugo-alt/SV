// Read-only calendars from iCalendar (.ics) addresses listed in ALAN_CALENDARS.
// Timed and all-day events, time zones, and repeating events with
// FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL and (weekly) BYDAY.
// Exceptions to a repetition (EXDATE, edited single occurrences) are not applied.
import { DAYS, instant, local } from "./clock.mts";

type Event = { start: Date; end: Date; allDay: boolean; summary: string; location: string; rule?: Record<string, string>; day: [number, number, number] };
const BYDAY: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const DAY = 86400000;

const unescape = (text: string) => text.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function moment(value: string, params: string, tz: string): { at: Date; allDay: boolean; day: [number, number, number] } {
  const v = value.trim();
  const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
  if (!v.includes("T")) return { at: instant(y, mo, d, 0, 0, tz), allDay: true, day: [y, mo, d] };
  const h = +v.slice(9, 11), mi = +v.slice(11, 13);
  if (v.endsWith("Z")) return { at: new Date(Date.UTC(y, mo - 1, d, h, mi)), allDay: false, day: [y, mo, d] };
  const zone = /TZID=([^;:]+)/.exec(params)?.[1]?.replace(/"/g, "");
  let at: Date;
  try { at = instant(y, mo, d, h, mi, zone || tz); } catch { at = instant(y, mo, d, h, mi, tz); }
  return { at, allDay: false, day: [y, mo, d] };
}

export function parse(text: string, tz: string): Event[] {
  const events: Event[] = [];
  let now: Partial<Event> | null = null;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (line === "BEGIN:VEVENT") now = {};
    else if (line === "END:VEVENT" && now) {
      if (now.start && now.summary) {
        now.end ??= new Date(now.start.getTime() + (now.allDay ? DAY : 3600000));
        now.location ??= "";
        events.push(now as Event);
      }
      now = null;
    } else if (now && line.includes(":")) {
      const colon = line.indexOf(":");
      const head = line.slice(0, colon), value = line.slice(colon + 1);
      const [name, ...rest] = head.split(";");
      const params = rest.join(";");
      if (name === "DTSTART") { const m = moment(value, params, tz); now.start = m.at; now.allDay = m.allDay; now.day = m.day; }
      else if (name === "DTEND") now.end = moment(value, params, tz).at;
      else if (name === "SUMMARY") now.summary = unescape(value);
      else if (name === "LOCATION") now.location = unescape(value);
      else if (name === "RRULE") now.rule = Object.fromEntries(value.split(";").filter((p) => p.includes("=")).map((p) => p.split("=", 2) as [string, string]));
      else if (name === "STATUS" && value.trim() === "CANCELLED") delete now.summary;
    }
  }
  return events;
}

const dayNumber = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY);

/** Whether a repeating event falls on a calendar day (in its own local date terms). */
function repeatsOn(event: Event, y: number, m: number, d: number): boolean {
  const rule = event.rule!;
  const [sy, sm, sd] = event.day;
  const from = dayNumber(sy, sm, sd), on = dayNumber(y, m, d);
  if (on < from) return false;
  if (rule.UNTIL && on > dayNumber(+rule.UNTIL.slice(0, 4), +rule.UNTIL.slice(4, 6), +rule.UNTIL.slice(6, 8))) return false;
  const every = Math.max(1, parseInt(rule.INTERVAL ?? "1") || 1);
  const weekday = (n: number) => ((n + 3) % 7 + 7) % 7;                 // 0 = Monday (1 Jan 1970 was a Thursday)
  const matches = (n: number, yy: number, mm: number, dd: number): boolean => {
    if (rule.FREQ === "DAILY") return (n - from) % every === 0;
    if (rule.FREQ === "WEEKLY") {
      const days = (rule.BYDAY ?? "").split(",").map((x) => BYDAY[x.slice(-2)]).filter((x) => x !== undefined);
      const weeks = Math.floor((n - weekday(n)) / 7) - Math.floor((from - weekday(from)) / 7);
      return (days.length ? days : [weekday(from)]).includes(weekday(n)) && weeks % every === 0;
    }
    if (rule.FREQ === "MONTHLY") return dd === sd && ((yy - sy) * 12 + mm - sm) % every === 0;
    if (rule.FREQ === "YEARLY") return dd === sd && mm === sm && (yy - sy) % every === 0;
    return n === from;
  };
  if (!matches(on, y, m, d)) return false;
  if (/^\d+$/.test(rule.COUNT ?? "")) {                                   // count the occurrences up to this day
    let seen = 0;
    for (let n = from; n <= on && n - from < 4000; n++) {
      const date = new Date(n * DAY);
      if (matches(n, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())) seen++;
    }
    return seen <= +rule.COUNT;
  }
  return true;
}

export type Entry = { start: Date; end: Date; allDay: boolean; summary: string; location: string };

/** Every occurrence on the local days first..first+days-1, sorted. */
export function occurrences(events: Event[], first: [number, number, number], days: number, tz: string): Entry[] {
  const out: Entry[] = [];
  const base = dayNumber(...first);
  for (let n = base; n < base + days; n++) {
    const date = new Date(n * DAY);
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
    const dayStart = instant(y, m, d, 0, 0, tz).getTime(), dayEnd = dayStart + DAY;
    for (const e of events) {
      const length = e.end.getTime() - e.start.getTime();
      if (e.rule) {
        if (!repeatsOn(e, y, m, d)) continue;
        const l = local(e.start, tz);
        const start = e.allDay ? new Date(dayStart) : instant(y, m, d, l.hour, l.minute, tz);
        out.push({ start, end: new Date(start.getTime() + length), allDay: e.allDay, summary: e.summary, location: e.location });
      } else if (e.start.getTime() < dayEnd && e.end.getTime() > dayStart && (e.start.getTime() >= dayStart || n === base)) {
        out.push({ start: e.start, end: e.end, allDay: e.allDay, summary: e.summary, location: e.location });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const cache = new Map<string, { at: number; text: string }>();

export async function readCalendars(sources: string[], tz: string, fetcher: typeof fetch = fetch) {
  const events: Event[] = [];
  for (const source of sources) {
    const hit = cache.get(source);
    let text = hit && Date.now() - hit.at < 600000 ? hit.text : "";
    if (!text) {
      try {
        const res = await fetcher(source, { headers: { "User-Agent": "ALAN" } });
        if (res.ok) { text = await res.text(); cache.set(source, { at: Date.now(), text }); }
      } catch { text = hit?.text ?? ""; }
    }
    events.push(...parse(text, tz));
  }
  return events;
}

export function describe(entries: Entry[], tz: string, empty: string): string {
  if (!entries.length) return empty;
  const two = (n: number) => String(n).padStart(2, "0");
  return "Kalendarz: " + entries.map((e) => {
    const s = local(e.start, tz), en = local(e.end, tz);
    const when = e.allDay ? "cały dzień" : `${two(s.hour)}:${two(s.minute)}–${two(en.hour)}:${two(en.minute)}`;
    return `${DAYS[s.weekday]} ${two(s.day)}.${two(s.month)}, ${when}: ${e.summary}${e.location ? ` (${e.location})` : ""}`;
  }).join("; ") + ".";
}
