// ALAN's own calendar: events he was asked to write down, kept in the store and published as an
// iCalendar feed (/calendar.ics?key=...) that the household subscribes to in Google Calendar,
// Apple Calendar or Outlook. For households whose main calendar cannot be written to from outside.
import { createHmac } from "node:crypto";
import { instant } from "./clock.mts";
import { times, type NewEvent } from "./gcal.mts";

type When = { date?: string; dateTime?: string; timeZone?: string };
export type OwnEvent = { id: string; title: string; start: When; end: When; location?: string; notes?: string; by: string; made: string };

/** The secret part of the feed's address: derived from the household password, so there is nothing more to set. */
export const feedKey = (secret: string) => createHmac("sha256", secret).update("alan-calendar-feed").digest("hex").slice(0, 32);

export function newEvent(ev: NewEvent, tz: string, by: string, now: Date): OwnEvent {
  const title = String(ev.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new Error("brak tytułu wydarzenia");
  return { id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title, ...times(ev.start, ev.end, tz),
    ...(ev.location ? { location: String(ev.location).slice(0, 200) } : {}), ...(ev.notes ? { notes: String(ev.notes).slice(0, 1000) } : {}), by, made: now.toISOString() };
}

/** The first day of an event, RRRR-MM-DD, and whether it covers the given day. */
export const onDay = (ev: OwnEvent, day: string) => ev.start.date ? ev.start.date <= day && day < ev.end.date! : ev.start.dateTime!.slice(0, 10) === day;

/** Start and end of an event when its start moves: the length is kept unless a new end is given. */
export function moved(ev: OwnEvent, start: unknown, end: unknown, tz: string) {
  const length = ev.start.date ? Date.parse(ev.end.date + "T00:00:00Z") - Date.parse(ev.start.date + "T00:00:00Z")
    : Date.parse(ev.end.dateTime + "Z") - Date.parse(ev.start.dateTime + "Z");
  return times(start, end, tz, length);
}

/** How he says when an event is. */
export const whenText = (ev: { start: When; end: When }) => ev.start.date ? `${ev.start.date}, cały dzień` : `${ev.start.dateTime!.slice(0, 10)} ${ev.start.dateTime!.slice(11, 16)}–${ev.end.dateTime!.slice(11, 16)}`;

const esc = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const utc = (when: When) => {
  const [, y, mo, d, h, mi] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(when.dateTime!)!.map(Number);
  return stamp(instant(y, mo, d, h, mi, when.timeZone ?? "Europe/Warsaw"));
};
const fold = (line: string) => line.match(/.{1,60}/gu)!.join("\r\n ");       // short enough in bytes even when every letter is Polish

export function toIcs(events: OwnEvent[], now: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ALAN//Kalendarz//PL", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Alan", "X-PUBLISHED-TTL:PT1H"];
  for (const ev of events) {
    lines.push("BEGIN:VEVENT", `UID:${ev.id}@alan`, `DTSTAMP:${stamp(new Date(ev.made))}`, `LAST-MODIFIED:${stamp(now)}`,
      ...(ev.start.date ? [`DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${ev.end.date!.replace(/-/g, "")}`] : [`DTSTART:${utc(ev.start)}`, `DTEND:${utc(ev.end)}`]),
      `SUMMARY:${esc(ev.title)}`, ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []), ...(ev.notes ? [`DESCRIPTION:${esc(ev.notes)}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
