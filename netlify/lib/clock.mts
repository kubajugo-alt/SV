// The household's clock. Functions run in UTC; people live in a time zone the page reports.

export const DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];

export type Local = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function safeZone(tz: unknown): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(tz) });
    return String(tz);
  } catch {
    return "Europe/Warsaw";
  }
}

/** The wall-clock time of an instant in a time zone. weekday: 0 = Monday. */
export function local(at: Date, tz: string): Local {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute,
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday),
  };
}

/** The instant at which a zone's wall clock shows the given time. */
export function instant(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const l = local(new Date(guess), tz);
    guess += wanted - Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  }
  return new Date(guess);
}

const two = (n: number) => String(n).padStart(2, "0");
export const dmy = (l: Local) => `${two(l.day)}.${two(l.month)}.${l.year}`;
export const hm = (l: Local) => `${two(l.hour)}:${two(l.minute)}`;

/** "90 s" style spans, as the local version says them. */
export function span(seconds: number): string {
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return [h ? `${h} godz.` : "", m ? `${m} min` : "", s && !h ? `${s} s` : ""].filter(Boolean).join(" ") || "0 s";
}
