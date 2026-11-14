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

from past import stems

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
    {"type": "function", "function": {
        "name": "take_note",
        "description": "Zapisuje notatkę rozmówcy: pomysł, myśl, rzecz do zrobienia, cokolwiek podyktuje ('zapisz', 'zanotuj', 'pomysł na...').",
        "parameters": {"type": "object", "required": ["text"], "properties": {
            "text": {"type": "string", "description": "treść notatki, pełnym zdaniem"}}}}},
    {"type": "function", "function": {
        "name": "find_notes",
        "description": "Szuka w notatkach rozmówcy albo podaje ostatnie ('co zapisałem o...', 'moje notatki z tego tygodnia').",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "czego dotyczą; puste = wszystkie z okresu"},
            "days": {"type": "integer", "description": "z ilu ostatnich dni, domyślnie 30"}}}}},
    {"type": "function", "function": {
        "name": "recall_talk",
        "description": "Szuka w dawnych rozmowach z rozmówcą, co kto kiedy powiedział ('mówiłem ci kiedyś o...', 'co ustaliliśmy w sprawie...').",
        "parameters": {"type": "object", "required": ["query"], "properties": {
            "query": {"type": "string", "description": "słowa kluczowe"}}}}},
    {"type": "function", "function": {
        "name": "set_place",
        "description": "Zapisuje, w jakim mieście rozmówca teraz jest ('jestem w...', 'przyleciałem do...'), żeby pogoda dotyczyła tego miejsca.",
        "parameters": {"type": "object", "required": ["place"], "properties": {
            "place": {"type": "string", "description": "miasto w mianowniku, np. Las Palmas"}}}}},
    {"type": "function", "function": {
        "name": "reading_time",
        "description": "Liczy, ile potrwa przeczytanie na głos podanego tekstu (scenariusz, lektor, rolka).",
        "parameters": {"type": "object", "required": ["text"], "properties": {
            "text": {"type": "string"}}}}},
]
NAMES = {t["function"]["name"] for t in TOOLS}

# Where the household is likely to be: name, locative ("w ..."), latitude, longitude, time zone.
PLACES = {
    "tarnobrzeg": ("Tarnobrzeg", "Tarnobrzegu", 50.573, 21.679, "Europe/Warsaw"),
    "las palmas": ("Las Palmas de Gran Canaria", "Las Palmas", 28.124, -15.430, "Atlantic/Canary"),
    "gran canaria": ("Las Palmas de Gran Canaria", "Las Palmas", 28.124, -15.430, "Atlantic/Canary"),
    "miami": ("Miami", "Miami", 25.774, -80.194, "America/New_York"),
    "barcelon": ("Barcelona", "Barcelonie", 41.385, 2.173, "Europe/Madrid"),
    "davos": ("Davos", "Davos", 46.802, 9.836, "Europe/Zurich"),
    "lizbon": ("Lizbona", "Lizbonie", 38.722, -9.139, "Europe/Lisbon"),
    "warszaw": ("Warszawa", "Warszawie", 52.230, 21.011, "Europe/Warsaw"),
    "krakow": ("Kraków", "Krakowie", 50.062, 19.938, "Europe/Warsaw"),
    "sandomierz": ("Sandomierz", "Sandomierzu", 50.682, 21.749, "Europe/Warsaw"),
    "londyn": ("Londyn", "Londynie", 51.507, -0.128, "Europe/London"),
    "london": ("Londyn", "Londynie", 51.507, -0.128, "Europe/London"),
    "santo domingo": ("Santo Domingo", "Santo Domingo", 18.486, -69.931, "America/Santo_Domingo"),
    "nowy jork": ("Nowy Jork", "Nowym Jorku", 40.713, -74.006, "America/New_York"),
    "singapur": ("Singapur", "Singapurze", 1.352, 103.820, "Asia/Singapore"),
    "frankfurt": ("Frankfurt", "Frankfurcie", 50.110, 8.682, "Europe/Berlin"),
}
WORDS_PER_MINUTE = 140   # an unhurried Polish voice-over


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
                CREATE TABLE IF NOT EXISTS jottings (
                    id INTEGER PRIMARY KEY, person TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

    # --- notes dictated to him --------------------------------------------------
    def take_note(self, person, text):
        text = str(text).strip()
        if not text:
            return "Błąd: nie podano treści notatki."
        with self.lock, self.db:
            self.db.execute("INSERT INTO jottings (person, text, at) VALUES (?, ?, ?)",
                            (person, text, self.now().isoformat(timespec="seconds")))
        return f"Wykonano: zapisano notatkę: {text}"

    def find_notes(self, person, query="", days=30):
        since = (self.now() - datetime.timedelta(days=max(1, int(days or 30)))).isoformat(timespec="seconds")
        with self.lock:
            rows = self.db.execute("SELECT text, at FROM jottings WHERE person = ? AND at >= ? ORDER BY id DESC", (person, since)).fetchall()
        wanted = set(stems(str(query or "")))
        if wanted:
            rows = [r for r in rows if wanted & set(stems(r[0]))]
        if not rows:
            return "Nie ma takich notatek." if wanted else "Nie ma notatek z tego okresu."
        return "Notatki: " + " ".join(f"[{at[8:10]}.{at[5:7]}] {text}" + ("" if text.endswith((".", "!", "?")) else ".") for text, at in rows[:12])

    # --- what was said in earlier conversations ---------------------------------------
    def recall_talk(self, person, query):
        wanted = set(stems(str(query or "")))
        if not wanted:
            return "Błąd: podaj, czego szukać w dawnych rozmowach."
        with self.lock:
            rows = self.db.execute("SELECT role, text, at FROM turns WHERE person = ? ORDER BY id", (person,)).fetchall()
        scored = sorted(((len(wanted & set(stems(text))), at, role, text) for role, text, at in rows), reverse=True)
        hits = [h for h in scored if h[0] >= max(1, min(2, len(wanted)))][:5]
        if not hits:
            return "W dawnych rozmowach nic o tym nie ma."
        who = {"user": person.capitalize(), "assistant": "ty"}
        return "Z dawnych rozmów: " + " ".join(
            f"[{at[8:10]}.{at[5:7]}.{at[:4]}] {who.get(role, role)}: {text[:300]}" for _, at, role, text in sorted(hits, key=lambda h: h[1]))

    # --- where the household is -------------------------------------------------------
    def set_place(self, person, place):
        key = plain(place)
        found = next((v for k, v in PLACES.items() if k in key), None)
        if not found:
            return (f"Błąd: nie znam współrzędnych miejsca '{place}'. Znam: "
                    + ", ".join(sorted({v[0] for v in PLACES.values()})) + ".")
        with self.lock, self.db:
            self.db.execute("INSERT INTO settings (key, value) VALUES ('place', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            (json.dumps(found, ensure_ascii=False),))
        return f"Wykonano: zapisano, że jesteście teraz w {found[1]}."

    def place(self):
        """{"name", "where", "lat", "lon", "tz"} of where they are now, or None while it was never said."""
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key = 'place'").fetchone()
        return dict(zip(("name", "where", "lat", "lon", "tz"), json.loads(row[0]))) if row else None

    # --- reading aloud --------------------------------------------------------------
    def reading_time(self, person, text):
        words = len(re.findall(r"\w+", str(text)))
        if not words:
            return "Błąd: nie podano tekstu."
        return f"Tekst ma {words} słów; czytany spokojnie na głos potrwa około {span(round(words / WORDS_PER_MINUTE * 60 / 5) * 5)}."
