"""ALAN's own tools: things he can do with nothing but himself.

Timers, reminders, shared lists (shopping by default) and things he is asked
to remember or forget. All of it lives in the same SQLite file as his memory,
so it survives a restart. Like the home tools, each call returns one short
Polish sentence for the model and never raises.

Timers and reminders have to speak up on their own: `agenda()` hands the page
whatever has come due (once) plus what is still running, and the page says it.
"""

import datetime
import json
import re
import unicodedata

MAX_TIMER_MINUTES = 24 * 60

TOOLS = [
    {"type": "function", "function": {
        "name": "set_timer",
        "description": "Ustawia minutnik, który zadzwoni po podanym czasie.",
        "parameters": {"type": "object", "required": ["minutes"], "properties": {
            "minutes": {"type": "number", "description": "za ile minut; pół minuty to 0.5"},
            "label": {"type": "string", "description": "czego dotyczy, np. makaron"}}}}},
    {"type": "function", "function": {
        "name": "set_reminder",
        "description": "Ustawia przypomnienie albo budzik na konkretną datę i godzinę.",
        "parameters": {"type": "object", "required": ["when", "text"], "properties": {
            "when": {"type": "string", "description": "format RRRR-MM-DD GG:MM, np. 2026-11-17 09:00; sama godzina GG:MM oznacza najbliższą taką godzinę"},
            "text": {"type": "string", "description": "o czym przypomnieć"}}}}},
    {"type": "function", "function": {
        "name": "show_reminders",
        "description": "Podaje aktywne minutniki i przypomnienia z ich numerami.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "cancel_reminder",
        "description": "Anuluje minutnik lub przypomnienie o podanym numerze (numery podaje show_reminders).",
        "parameters": {"type": "object", "required": ["number"], "properties": {
            "number": {"type": "integer"}}}}},
    {"type": "function", "function": {
        "name": "edit_list",
        "description": "Wspólna lista domowa: dopisuje i skreśla pozycje, a bez zmian po prostu ją odczytuje. Domyślnie lista zakupów.",
        "parameters": {"type": "object", "properties": {
            "list": {"type": "string", "description": "nazwa listy, domyślnie zakupy"},
            "add": {"type": "array", "items": {"type": "string"}, "description": "pozycje do dopisania"},
            "remove": {"type": "array", "items": {"type": "string"}, "description": "pozycje do skreślenia"}}}}},
    {"type": "function", "function": {
        "name": "remember",
        "description": "Zapamiętuje na stałe fakt, o którego zapamiętanie rozmówca wyraźnie poprosił.",
        "parameters": {"type": "object", "required": ["fact"], "properties": {
            "fact": {"type": "string", "description": "pełne zdanie, zrozumiałe bez kontekstu rozmowy"}}}}},
    {"type": "function", "function": {
        "name": "forget",
        "description": "Usuwa zapamiętane fakty dotyczące podanego tematu.",
        "parameters": {"type": "object", "required": ["about"], "properties": {
            "about": {"type": "string", "description": "słowo lub fraza, której dotyczy fakt"}}}}},
]
NAMES = {t["function"]["name"] for t in TOOLS}


def plain(text):
    text = unicodedata.normalize("NFD", str(text).strip().lower().replace("ł", "l"))
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def span(seconds):
    """90 -> 'półtorej minuty' is beyond us; '1 min 30 s' is clear enough."""
    seconds = max(0, round(seconds))
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    parts = [f"{h} godz." if h else "", f"{m} min" if m else "", f"{s} s" if s and not h else ""]
    return " ".join(p for p in parts if p) or "0 s"


def parse_when(text, now):
    """'2026-11-17 09:00', '17.11 09:00', '17.11.2026 9:00' or '09:00' -> datetime, or None."""
    text = str(text).strip().replace("T", " ")
    m = re.fullmatch(r"(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?)?\s*(\d{1,2})[:.](\d{2})(?::\d{2})?", text)
    if not m:
        return None
    y, mo, d, d2, mo2, y2, hour, minute = m.groups()
    try:
        if y:
            return datetime.datetime(int(y), int(mo), int(d), int(hour), int(minute))
        if d2:
            when = datetime.datetime(int(y2 or now.year), int(mo2), int(d2), int(hour), int(minute))
            return when.replace(year=when.year + 1) if not y2 and when < now else when
        when = now.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
        return when + datetime.timedelta(days=1) if when <= now else when
    except ValueError:
        return None


class Own:
    def __init__(self, memory, clock=datetime.datetime.now):
        self.db, self.lock, self.now = memory.db, memory.lock, clock
        with self.lock, self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS reminders (
                    id INTEGER PRIMARY KEY, person TEXT NOT NULL, kind TEXT NOT NULL,
                    due TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS lists (
                    list TEXT NOT NULL, item TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (list, key));
                CREATE TABLE IF NOT EXISTS facts (
                    id INTEGER PRIMARY KEY, person TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
            """)

    def call(self, person, name, arguments):
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
            return getattr(self, name)(person, **args) if name in NAMES else f"Błąd: nie ma narzędzia {name}."
        except (TypeError, ValueError) as err:
            return f"Błąd: niepoprawne parametry ({err})."

    # --- timers and reminders ---------------------------------------------------
    def _add(self, person, kind, due, text):
        with self.lock, self.db:
            return self.db.execute("INSERT INTO reminders (person, kind, due, text) VALUES (?, ?, ?, ?)",
                                   (person, kind, due.isoformat(timespec="seconds"), text)).lastrowid

    def _active(self):
        with self.lock:
            rows = self.db.execute("SELECT id, person, kind, due, text FROM reminders WHERE done = 0 ORDER BY due").fetchall()
        return [(i, person, kind, datetime.datetime.fromisoformat(due), text) for i, person, kind, due, text in rows]

    def set_timer(self, person, minutes, label=""):
        minutes = float(minutes)
        if not 0 < minutes <= MAX_TIMER_MINUTES:
            return "Błąd: minutnik można ustawić na czas od kilku sekund do 24 godzin."
        label = str(label or "").strip()
        number = self._add(person, "timer", self.now() + datetime.timedelta(minutes=minutes), label)
        return f"Wykonano: minutnik nr {number} na {span(minutes * 60)}{f' ({label})' if label else ''}."

    def set_reminder(self, person, when, text):
        now = self.now()
        due = parse_when(when, now)
        text = str(text).strip()
        if due is None:
            return f"Błąd: nie rozumiem terminu '{when}'. Podaj go jako RRRR-MM-DD GG:MM."
        if due <= now:
            return f"Błąd: {due:%d.%m.%Y %H:%M} już minęło. Niczego nie ustawiono."
        if not text:
            return "Błąd: brakuje treści przypomnienia."
        number = self._add(person, "reminder", due, text)
        return f"Wykonano: przypomnienie nr {number} na {due:%d.%m.%Y} o {due:%H:%M}: {text}."

    def show_reminders(self, person):
        now, lines = self.now(), []
        for number, who, kind, due, text in self._active():
            if kind == "timer":
                lines.append(f"nr {number} minutnik{f' {text}' if text else ''}, zostało {span((due - now).total_seconds())}")
            else:
                lines.append(f"nr {number} przypomnienie dla {who.capitalize()} na {due:%d.%m.%Y %H:%M}: {text}")
        return "Aktywne: " + "; ".join(lines) + "." if lines else "Nie ma aktywnych minutników ani przypomnień."

    def cancel_reminder(self, person, number):
        with self.lock, self.db:
            row = self.db.execute("SELECT kind, text FROM reminders WHERE id = ? AND done = 0", (int(number),)).fetchone()
            if not row:
                return f"Błąd: nie ma aktywnego minutnika ani przypomnienia nr {number}."
            self.db.execute("UPDATE reminders SET done = 1 WHERE id = ?", (int(number),))
        kind = "minutnik" if row[0] == "timer" else "przypomnienie"
        return f"Wykonano: anulowano {kind} nr {number}{f' ({row[1]})' if row[1] else ''}."

    def agenda(self):
        """For the page: lines to say now (handed out once) and what is still running."""
        now, say, timers, reminders = self.now(), [], [], []
        for number, who, kind, due, text in self._active():
            if due <= now:
                say.append(f"Minutnik{f' {text}' if text else ''}: czas minął." if kind == "timer"
                           else f"{who.capitalize()}, przypomnienie: {text}.")
                with self.lock, self.db:
                    self.db.execute("UPDATE reminders SET done = 1 WHERE id = ?", (number,))
            elif kind == "timer":
                timers.append({"number": number, "label": text, "seconds": round((due - now).total_seconds())})
            else:
                reminders.append({"number": number, "person": who, "due": due.isoformat(timespec="minutes"), "text": text})
        return {"say": say, "timers": timers, "reminders": reminders}

    # --- lists ---------------------------------------------------------------------
    def edit_list(self, person, list="zakupy", add=None, remove=None):   # noqa: A002 (the tool's parameter name)
        name = plain(list) or "zakupy"
        added, removed, missing = [], [], []
        with self.lock, self.db:
            for item in add or []:
                item = str(item).strip()
                if item and self.db.execute("INSERT OR IGNORE INTO lists (list, item, key) VALUES (?, ?, ?)",
                                            (name, item, plain(item))).rowcount:
                    added.append(item)
            for item in remove or []:
                done = self.db.execute("DELETE FROM lists WHERE list = ? AND key = ?", (name, plain(item))).rowcount
                (removed if done else missing).append(str(item).strip())
            items = [r[0] for r in self.db.execute("SELECT item FROM lists WHERE list = ? ORDER BY rowid", (name,))]
        now = f"Lista {name}: {', '.join(items)}." if items else f"Lista {name} jest pusta."
        changes = [f"dopisano: {', '.join(added)}" if added else "", f"skreślono: {', '.join(removed)}" if removed else ""]
        changes = "; ".join(c for c in changes if c)
        if missing:
            return f"Błąd: na liście {name} nie ma: {', '.join(missing)}. {f'Wykonano: {changes}. ' if changes else ''}{now}"
        return f"Wykonano: {changes}. {now}" if changes else now

    # --- explicit memory -----------------------------------------------------------
    def remember(self, person, fact):
        fact = str(fact).strip()
        if not fact:
            return "Błąd: nie podano, co zapamiętać."
        with self.lock, self.db:
            self.db.execute("INSERT INTO facts (person, text, at) VALUES (?, ?, ?)",
                            (person, fact, self.now().isoformat(timespec="seconds")))
        return f"Wykonano: zapamiętano: {fact}"

    def forget(self, person, about):
        key = plain(about)
        if len(key) < 3:
            return "Błąd: podaj dokładniej, o czym zapomnieć."
        with self.lock, self.db:
            hits = [(i, t) for i, t in self.db.execute("SELECT id, text FROM facts WHERE person = ?", (person,)) if key in plain(t)]
            self.db.executemany("DELETE FROM facts WHERE id = ?", [(i,) for i, _ in hits])
        if not hits:
            return f"Błąd: nie mam zapamiętanego niczego o '{about}'."
        return f"Wykonano: zapomniano: {'; '.join(t for _, t in hits)}"

    def facts(self, person):
        with self.lock:
            return [r[0] for r in self.db.execute("SELECT text FROM facts WHERE person = ? ORDER BY id", (person,))]
