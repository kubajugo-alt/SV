"""ALAN's mind: conversation with a local language model, with memory.

Each person has their own thread. Two layers of memory, both in one SQLite file:

  recent turns   the last exchanges, sent to the model word for word
  notes          a compact record per person — facts, preferences, open threads —
                 that the model itself rewrites whenever older turns are about
                 to fall out of the recent window

So nothing is silently forgotten: a turn is either still in the window or has
been folded into the notes. The model is reached over the OpenAI-compatible
chat API, which Ollama serves at http://127.0.0.1:11434.
"""

import datetime
import json
import os
import re
import sqlite3
import threading
import urllib.request
import uuid

WINDOW_MAX = 24   # fold into notes once this many turns are waiting
WINDOW_KEEP = 10  # turns left verbatim after folding

MAX_TOOL_ROUNDS = 3

# He must never claim an action or a reading that did not actually happen.
NOT_CONNECTED = ("Sterowanie urządzeniami, czujniki, kamery i kalendarz nie są jeszcze podłączone. "
                 "Nie twierdź, że coś włączyłeś, zmieniłeś lub odczytałeś — powiedz krótko, że jeszcze tego nie potrafisz.")
CONNECTED = ("Masz narzędzia: set_light (światło), set_temperature (ogrzewanie) i get_home_state (stan mieszkania). "
             "Gdy ktoś prosi o światło lub ogrzewanie albo pyta o stan mieszkania, użyj narzędzia, zanim odpowiesz. "
             "Mów, że coś zrobiłeś, tylko jeśli narzędzie odpowiedziało 'Wykonano'; gdy zwróci błąd, powiedz krótko, czego nie da się zrobić. "
             "Temperatury i stan świateł podawaj wyłącznie z get_home_state, nigdy z pamięci. "
             "Drzwi, zamki, kamery i kalendarz nie są podłączone.")

DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]

CONSOLIDATE = """Prowadzisz notatki pamięci asystenta domowego ALAN o osobie: {person}.
Poniżej są dotychczasowe notatki i nowy fragment rozmowy. Napisz zaktualizowane notatki.

Zasady:
- Zachowaj wszystko, co nadal jest prawdziwe i przydatne; popraw to, co się zmieniło.
- Zapisuj fakty, preferencje, plany, prośby o zapamiętanie i niedokończone wątki.
- Terminy zapisuj dokładnie tak, jak padły w rozmowie, razem z datą rozmowy z nawiasu; nie przeliczaj ich na inne daty.
- Pomijaj grzeczności i rzeczy jednorazowe bez znaczenia na przyszłość.
- Krótkie zdania po polsku, każde w osobnej linii, najwyżej 40 linii. Bez komentarza.

DOTYCHCZASOWE NOTATKI:
{notes}

NOWY FRAGMENT ROZMOWY:
{turns}

ZAKTUALIZOWANE NOTATKI:"""


class Memory:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS turns (
                    id INTEGER PRIMARY KEY, person TEXT NOT NULL, role TEXT NOT NULL,
                    text TEXT NOT NULL, at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notes (
                    person TEXT PRIMARY KEY, text TEXT NOT NULL, upto INTEGER NOT NULL);
            """)

    def add(self, person, role, text):
        with self.lock, self.db:
            self.db.execute("INSERT INTO turns (person, role, text, at) VALUES (?, ?, ?, ?)",
                            (person, role, text, datetime.datetime.now().isoformat(timespec="seconds")))

    def notes(self, person):
        """(notes text, id of the last turn they cover)"""
        with self.lock:
            row = self.db.execute("SELECT text, upto FROM notes WHERE person = ?", (person,)).fetchone()
        return row or ("", 0)

    def recent(self, person):
        """Turns not yet folded into the notes, oldest first: (id, role, text, at)."""
        upto = self.notes(person)[1]
        with self.lock:
            return self.db.execute("SELECT id, role, text, at FROM turns WHERE person = ? AND id > ? ORDER BY id",
                                   (person, upto)).fetchall()

    def set_notes(self, person, text, upto):
        with self.lock, self.db:
            self.db.execute("INSERT INTO notes (person, text, upto) VALUES (?, ?, ?) "
                            "ON CONFLICT(person) DO UPDATE SET text = excluded.text, upto = excluded.upto",
                            (person, text, upto))


class Brain:
    def __init__(self, llm_url, model, prompt_path, db_path, inline_system=False, home=None):
        self.url = llm_url.rstrip("/") + "/v1/chat/completions"
        self.model = model
        with open(prompt_path, encoding="utf-8") as f:
            self.prompt = f.read().strip()
        self.memory = Memory(db_path)
        self.folding = threading.Lock()  # one notes rewrite at a time
        self.inline_system = inline_system
        self.home = home  # home.Home, or None while the flat is not connected
        self.name = f"{model} at {llm_url}"

    def chat(self, messages, max_tokens, temperature, tools=None):
        """One round trip to the model; returns its message (content and/or tool_calls)."""
        body = {"model": self.model, "messages": messages, "stream": False,
                "max_tokens": max_tokens, "temperature": temperature}
        if tools:
            body["tools"] = tools
        request = urllib.request.Request(self.url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)["choices"][0]["message"]

    def complete(self, messages, max_tokens, temperature):
        return (self.chat(messages, max_tokens, temperature).get("content") or "").strip()

    @staticmethod
    def written_calls(content):
        """Tool calls a runtime left in the text instead of parsing them.

        Mistral models emit `[TOOL_CALLS][{"name": ..., "arguments": {...}}]`;
        Ollama turns that into proper tool_calls, some other servers pass it
        through as the answer. Recognise it rather than have ALAN read it aloud.
        """
        from home import TOOLS

        text = (content or "").strip().removeprefix("[TOOL_CALLS]").strip()
        if not text.startswith("["):
            return []
        try:
            items = json.loads(text)
        except ValueError:
            return []
        known = {t["function"]["name"] for t in TOOLS}
        if not isinstance(items, list) or not items or not all(
                isinstance(i, dict) and i.get("name") in known for i in items):
            return []
        return [{"id": uuid.uuid4().hex[:9], "type": "function",   # Mistral wants 9-character ids
                 "function": {"name": i["name"], "arguments": json.dumps(i.get("arguments") or {})}}
                for i in items]

    def converse(self, messages):
        """Let the model use its tools -> (what it finally says, what it did)."""
        actions = []
        if not self.home:
            return self.complete(messages, max_tokens=220, temperature=0.6), actions
        from home import TOOLS

        messages = list(messages)
        for _ in range(MAX_TOOL_ROUNDS):
            message = self.chat(messages, max_tokens=300, temperature=0.4, tools=TOOLS)
            calls = message.get("tool_calls") or self.written_calls(message.get("content"))
            if not calls:
                return (message.get("content") or "").strip(), actions
            said = "" if not message.get("tool_calls") else message.get("content") or ""  # written calls are not speech
            messages.append({"role": "assistant", "content": said, "tool_calls": calls})
            for call in calls:
                result = self.home.call(call["function"]["name"], call["function"].get("arguments"))
                print(f"Tool: {call['function']['name']}({call['function'].get('arguments')}) -> {result}", flush=True)
                messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
                if call["function"]["name"] != "get_home_state":   # reading is not a change
                    done = result.startswith("Wykonano")
                    actions.append({"ok": done, "text": result.split(": ", 1)[-1].rstrip(".")})
        # Still calling tools after several rounds: make it answer with what it has.
        return self.complete(messages, max_tokens=220, temperature=0.4), actions

    def system(self, person, notes):
        now = datetime.datetime.now()
        # Small models get date arithmetic wrong; give them the calendar to read from.
        ahead = ", ".join(f"{DAYS[d.weekday()]} {d:%d.%m}" for d in (now + datetime.timedelta(days=i) for i in range(1, 15)))
        parts = [
            self.prompt,
            "── TERAZ ──",
            f"Jest {DAYS[now.weekday()]}, {now:%d.%m.%Y}, godzina {now:%H:%M}. Rozmawiasz z: {person.capitalize()}.",
            f"Najbliższe dni: {ahead}. Daty bierz z tej listy, nie licz ich samodzielnie.",
            CONNECTED if self.home else NOT_CONNECTED,
        ]
        if notes:
            parts += [f"── PAMIĘĆ: CO WIESZ O {person.upper()} Z WCZEŚNIEJSZYCH ROZMÓW ──", notes]
        return "\n".join(parts)

    def reply(self, person, text):
        return self.respond(person, text)["reply"]

    def respond(self, person, text):
        """-> {"reply": what he says, "actions": [{"ok": bool, "text": what he changed or could not}]}"""
        notes, _ = self.memory.notes(person)
        system = self.system(person, notes)
        history = [{"role": role, "content": content} for _, role, content, _ in self.memory.recent(person)]
        if self.inline_system:
            # Some runtimes drop the system role for Mistral models. Put the
            # instructions in front of the newest message, where Mistral's own
            # template places them.
            messages = history + [{"role": "user", "content": f"{system}\n\n── WIADOMOŚĆ OD {person.upper()} ──\n{text}"}]
        else:
            messages = [{"role": "system", "content": system}] + history + [{"role": "user", "content": text}]
        said, actions = self.converse(messages)
        answer = self.clean(said)
        if not answer:
            raise RuntimeError("the model returned an empty answer")
        self.memory.add(person, "user", text)       # stored only once the model has answered
        self.memory.add(person, "assistant", answer)
        threading.Thread(target=self.fold, args=(person,), daemon=True).start()
        return {"reply": answer, "actions": actions}

    @staticmethod
    def clean(text):
        """The answer is spoken: drop markdown and stage directions."""
        text = re.sub(r"[*_#`]+", "", text)
        text = re.sub(r"^\s*(ALAN|Alan)\s*:\s*", "", text)
        return re.sub(r"\s+", " ", text).strip()

    def fold(self, person):
        """Rewrite the notes to absorb the oldest turns once the window is full."""
        with self.folding:
            turns = self.memory.recent(person)
            if len(turns) <= WINDOW_MAX:
                return
            old = turns[:len(turns) - WINDOW_KEEP]
            notes, _ = self.memory.notes(person)
            transcript = "\n".join(f"[{at[:16].replace('T', ' ')}] {'ALAN' if role == 'assistant' else person.capitalize()}: {content}"
                                   for _, role, content, at in old)
            prompt = CONSOLIDATE.format(person=person.capitalize(), notes=notes or "(brak)", turns=transcript)
            try:
                updated = self.complete([{"role": "user", "content": prompt}], max_tokens=700, temperature=0.2)
            except Exception as err:   # keep the turns in the window and try again next time
                print(f"Memory fold failed: {err!r}")
                return
            if updated:
                self.memory.set_notes(person, updated, old[-1][0])
