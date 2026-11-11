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

WINDOW_MAX = 24   # fold into notes once this many turns are waiting
WINDOW_KEEP = 10  # turns left verbatim after folding

DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]

CONSOLIDATE = """Prowadzisz notatki pamięci asystenta domowego ALAN o osobie: {person}.
Poniżej są dotychczasowe notatki i nowy fragment rozmowy. Napisz zaktualizowane notatki.

Zasady:
- Zachowaj wszystko, co nadal jest prawdziwe i przydatne; popraw to, co się zmieniło.
- Zapisuj fakty, preferencje, plany z datami, prośby o zapamiętanie i niedokończone wątki.
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
    def __init__(self, llm_url, model, prompt_path, db_path):
        self.url = llm_url.rstrip("/") + "/v1/chat/completions"
        self.model = model
        with open(prompt_path, encoding="utf-8") as f:
            self.prompt = f.read().strip()
        self.memory = Memory(db_path)
        self.folding = threading.Lock()  # one notes rewrite at a time
        self.name = f"{model} at {llm_url}"

    def complete(self, messages, max_tokens, temperature):
        body = json.dumps({"model": self.model, "messages": messages, "stream": False,
                           "max_tokens": max_tokens, "temperature": temperature}).encode()
        request = urllib.request.Request(self.url, body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)["choices"][0]["message"]["content"].strip()

    def system(self, person, notes):
        now = datetime.datetime.now()
        parts = [
            self.prompt,
            "── TERAZ ──",
            f"Jest {DAYS[now.weekday()]}, {now:%d.%m.%Y}, godzina {now:%H:%M}. Rozmawiasz z: {person.capitalize()}.",
            # Until Home Assistant is connected he must not pretend to act or to read sensors.
            "Sterowanie urządzeniami, czujniki, kamery i kalendarz nie są jeszcze podłączone. "
            "Nie twierdź, że coś włączyłeś, zmieniłeś lub odczytałeś — powiedz krótko, że jeszcze tego nie potrafisz.",
        ]
        if notes:
            parts += [f"── PAMIĘĆ: CO WIESZ O {person.upper()} Z WCZEŚNIEJSZYCH ROZMÓW ──", notes]
        return "\n".join(parts)

    def reply(self, person, text):
        notes, _ = self.memory.notes(person)
        messages = [{"role": "system", "content": self.system(person, notes)}]
        messages += [{"role": role, "content": content} for _, role, content, _ in self.memory.recent(person)]
        messages.append({"role": "user", "content": text})
        answer = self.clean(self.complete(messages, max_tokens=220, temperature=0.6))
        self.memory.add(person, "user", text)       # stored only once the model has answered
        self.memory.add(person, "assistant", answer)
        threading.Thread(target=self.fold, args=(person,), daemon=True).start()
        return answer

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
