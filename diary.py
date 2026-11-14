"""ALAN's view of the household's calendars: read-only, from iCalendar (.ics) files.

Sources are listed one per line in `data/kalendarze.txt` (or `--calendar`):
a path to an .ics file, or an https address of one. Google Calendar and iCloud
both give a private address of this kind; an address is fetched at most every
ten minutes and nothing is ever written back.

Understands timed and all-day events, time zones, and repeating events with
FREQ=DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL and (weekly) BYDAY.
Exceptions to a repetition (EXDATE, edited single occurrences) are not applied.
"""

import datetime
import os
import re
import threading
import time
import urllib.request
import zoneinfo

TOOL = {"type": "function", "function": {
    "name": "calendar",
    "description": "Odczytuje kalendarz domowników: spotkania i wydarzenia danego dnia albo kilku kolejnych dni.",
    "parameters": {"type": "object", "properties": {
        "day": {"type": "string", "description": "dziś, jutro albo data RRRR-MM-DD; domyślnie dziś"},
        "days": {"type": "integer", "description": "ile dni od tego dnia, domyślnie 1"}}}}}

DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]
BYDAY = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
REFRESH = 600          # seconds between fetches of a remote calendar
MAX_BYTES = 5_000_000


def unescape(text):
    return re.sub(r"\\([,;\\])", r"\1", text.replace("\\n", " ").replace("\\N", " ")).strip()


def moment(value, params, local):
    """An iCalendar date or date-time -> (naive local datetime, all_day)."""
    value = value.strip()
    if "T" not in value:
        return datetime.datetime.strptime(value[:8], "%Y%m%d"), True
    when = datetime.datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        when = when.replace(tzinfo=datetime.timezone.utc)
    elif match := re.search(r"TZID=([^;:]+)", params):
        try:
            when = when.replace(tzinfo=zoneinfo.ZoneInfo(match.group(1).strip('"')))
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            pass                                  # an unknown zone name: take the time as local
    if when.tzinfo:
        when = when.astimezone(local).replace(tzinfo=None)
    return when, False


def parse(text, local):
    """-> [{"start", "end", "all_day", "summary", "location", "rule"}] for every VEVENT."""
    lines = re.sub(r"\r?\n[ \t]", "", text).splitlines()
    events, now = [], None
    for line in lines:
        if line == "BEGIN:VEVENT":
            now = {}
        elif line == "END:VEVENT" and now is not None:
            if "start" in now and now.get("summary"):
                now.setdefault("end", now["start"] + (datetime.timedelta(days=1) if now["all_day"] else datetime.timedelta(hours=1)))
                events.append(now)
            now = None
        elif now is not None and ":" in line:
            head, value = line.split(":", 1)
            name, _, params = head.partition(";")
            try:
                if name == "DTSTART":
                    now["start"], now["all_day"] = moment(value, params, local)
                elif name == "DTEND":
                    now["end"] = moment(value, params, local)[0]
                elif name == "SUMMARY":
                    now["summary"] = unescape(value)
                elif name == "LOCATION":
                    now["location"] = unescape(value)
                elif name == "RRULE":
                    now["rule"] = dict(part.split("=", 1) for part in value.split(";") if "=" in part)
                elif name == "STATUS" and value.strip() == "CANCELLED":
                    now.pop("summary", None)
            except ValueError:
                continue
    return events


def occurrences(event, first, last):
    """Start times of an event (repeating or not) that fall on days first..last inclusive."""
    start, rule = event["start"], event.get("rule")
    lo = datetime.datetime.combine(first, datetime.time.min)
    hi = datetime.datetime.combine(last, datetime.time.max)
    length = event["end"] - start
    if not rule:
        return [start] if start <= hi and start + length > lo else []
    freq, every = rule.get("FREQ"), max(1, int(rule.get("INTERVAL", 1) or 1))
    count = int(rule["COUNT"]) if rule.get("COUNT", "").isdigit() else None
    until = None
    if rule.get("UNTIL"):
        try:
            until = datetime.datetime.strptime(rule["UNTIL"][:8], "%Y%m%d") + datetime.timedelta(days=1)
        except ValueError:
            pass
    weekdays = sorted(BYDAY[d[-2:]] for d in rule.get("BYDAY", "").split(",") if d[-2:] in BYDAY) if freq == "WEEKLY" else []
    out, n, cursor = [], 0, start
    for _ in range(5000):                         # a bound, in case a rule never ends
        if freq == "DAILY":
            batch = [cursor]
            step = lambda c: c + datetime.timedelta(days=every)                       # noqa: E731
        elif freq == "WEEKLY":
            monday = cursor - datetime.timedelta(days=cursor.weekday())
            batch = [monday + datetime.timedelta(days=d) for d in (weekdays or [start.weekday()])]
            step = lambda c: c + datetime.timedelta(weeks=every)                      # noqa: E731
        elif freq == "MONTHLY":
            batch = [cursor]

            def step(c):
                month = c.month - 1 + every
                for _ in range(48):               # skip months without that day (the 31st)
                    try:
                        return c.replace(year=c.year + month // 12, month=month % 12 + 1)
                    except ValueError:
                        month += every
                return c + datetime.timedelta(days=366 * 100)
        elif freq == "YEARLY":
            batch = [cursor]

            def step(c):
                for years in range(every, every * 9, every):
                    try:
                        return c.replace(year=c.year + years)
                    except ValueError:            # 29 February
                        continue
                return c + datetime.timedelta(days=366 * 100)
        else:
            return [start] if lo <= start <= hi else []
        for when in batch:
            if when < start:
                continue
            if (count is not None and n >= count) or (until and when >= until) or when > hi:
                return out
            n += 1
            if when + length > lo:
                out.append(when)
        cursor = step(cursor)
        if cursor > hi + datetime.timedelta(days=7):
            break
    return out


class Diary:
    def __init__(self, sources, clock=datetime.datetime.now):
        self.sources = [s.strip() for s in sources if s.strip() and not s.strip().startswith("#")]
        self.now = clock
        self.lock = threading.Lock()
        self.cache = {}        # source -> (fetched at, events)
        self.announced = set() # (summary, start) already spoken
        self.name = f"{len(self.sources)} calendar(s)"

    def read(self, source):
        if re.match(r"https://", source):
            with urllib.request.urlopen(urllib.request.Request(source, headers={"User-Agent": "ALAN"}), timeout=15) as r:
                return r.read(MAX_BYTES).decode("utf-8", "replace")
        with open(os.path.expanduser(source), encoding="utf-8", errors="replace") as f:
            return f.read(MAX_BYTES)

    def events(self, first, last):
        """Every occurrence on days first..last, sorted: [(start, end, all_day, summary, location)]."""
        local = datetime.datetime.now().astimezone().tzinfo
        out = []
        for source in self.sources:
            with self.lock:
                at, known = self.cache.get(source, (0, []))
                if time.monotonic() - at > REFRESH or not at:
                    try:
                        known = parse(self.read(source), local)
                    except (OSError, ValueError) as err:   # keep what was read last time
                        print(f"Calendar not read ({source[:40]}): {err!r}", flush=True)
                    self.cache[source] = (time.monotonic(), known)
            for event in known:
                length = event["end"] - event["start"]
                for when in occurrences(event, first, last):
                    out.append((when, when + length, event["all_day"], event["summary"], event.get("location", "")))
        return sorted(set(out))

    def calendar(self, day="", days=1, **_):
        today = self.now().date()
        word = str(day or "").strip().lower()
        try:
            first = today + datetime.timedelta(days=1) if word == "jutro" else today if word in ("", "dziś", "dzis", "dzisiaj") \
                else datetime.date.fromisoformat(word)
        except ValueError:
            return f"Błąd: nie rozumiem dnia '{day}'. Podaj dziś, jutro albo RRRR-MM-DD."
        days = max(1, min(14, int(days or 1)))
        found = self.events(first, first + datetime.timedelta(days=days - 1))
        if not found:
            return f"W kalendarzu nic nie ma ({first:%d.%m}{f' i kolejne {days - 1} dni' if days > 1 else ''})."
        lines = []
        for start, end, all_day, summary, location in found:
            date = f"{DAYS[start.weekday()]} {start:%d.%m}"
            when = "cały dzień" if all_day else f"{start:%H:%M}–{end:%H:%M}"
            lines.append(f"{date}, {when}: {summary}{f' ({location})' if location else ''}")
        return "Kalendarz: " + "; ".join(lines) + "."

    def soon(self, minutes=10):
        """Lines to say once: timed events that start within `minutes`."""
        now = self.now()
        say = []
        for start, _, all_day, summary, location in self.events(now.date(), now.date()):
            left = (start - now).total_seconds() / 60
            if not all_day and 0 < left <= minutes and (summary, start) not in self.announced:
                self.announced.add((summary, start))
                say.append(f"Za {max(1, round(left))} min: {summary}{f', {location}' if location else ''}.")
        return say

    def busy(self):
        """True while a timed event is on: he keeps quiet then."""
        now = self.now()
        return any(not all_day and start <= now < end for start, end, all_day, _, _ in self.events(now.date(), now.date()))

    def call(self, name, arguments):
        return self.calendar(**arguments) if name == "calendar" and isinstance(arguments, dict) else f"Błąd: nie ma narzędzia {name}."
