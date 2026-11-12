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
import time
import urllib.request
import urllib.error
import uuid

from home import TOOLS as HOME_TOOLS
from online import SOURCES, Online
from own import NAMES as OWN_NAMES, TOOLS as OWN_TOOLS, Own
from diary import TOOL as DIARY_TOOL
from past import TOOL as PAST_TOOL, Past
from wiki import TOOL as WIKI_TOOL

WINDOW_MAX = 24   # fold into notes once this many turns are waiting
WINDOW_KEEP = 10  # turns left verbatim after folding

MAX_TOOL_ROUNDS = 3  # tool-calling rounds per turn (plus one nudge if it rambles)

# Earlier messages of the person shown to the tool-choosing step. Zero: with
# Mistral Nemo, any earlier request in view was sometimes carried out again a
# turn late. The cost is that "and in the bedroom too" needs saying in full.
DISPATCH_HISTORY = 0
FLAT_ONLY = ("── MIESZKANIE", "── JAKOŚĆ POWIETRZA", "── TRYB PRACY", "── TRYB GOŚCIA", "── DRZWI", "── BEZPIECZEŃSTWO")
GETTING_TO_KNOW = 25      # for this many of a person's messages he still asks them about themselves

# Words that claim an action. If no tool did anything this turn and he still
# uses one (not negated), the reply is rejected: he must not say "the door is
# open" on his own authority.
CLAIM = re.compile(
    r"(?<!\bnie )(?<!\bnie jest )(?<!\bnie są )(?<!\bnie został )(?<!\bnie została )(?<!\bnie zostało )\b("
    r"włączon\w*|wyłączon\w*|ustawion\w*|otwart\w*|zamknięt\w*|zapisan\w*|dopisan\w*|skreślon\w*|"
    r"zapamiętan\w*|anulowan\w*|"
    r"włączyłem|wyłączyłem|ustawiłem|otworzyłem|zamknąłem|zapisałem|dopisałem|skreśliłem|zapamiętałem|anulowałem)\b",
    re.IGNORECASE)
NOT_DONE = "Tego nie zrobiłem. Nie mam do tego narzędzia albo nie zadziałało."

DISPATCH = """Jesteś częścią asystenta domowego ALAN, która wybiera narzędzia. Nie rozmawiasz z domownikiem.
Przeczytaj jego ostatnią wiadomość i zdecyduj:
- Jeśli prosi o coś, do czego jest narzędzie, albo pyta o coś, co narzędzie potrafi sprawdzić — wywołaj je z poprawnymi parametrami. Możesz wywołać kilka narzędzi.
- Jeśli żadne narzędzie nie pasuje (zwykła rozmowa, opinia, wiedza ogólna, prośba o coś, do czego narzędzia nie ma, na przykład drzwi) — odpowiedz jednym słowem: BRAK.
Odpowiadasz wyłącznie wywołaniem narzędzia albo słowem BRAK. Nigdy nie opisuj wywołania słowami i nie pisz nic więcej.
Działasz tylko na ostatnią wiadomość; wcześniejsze są już obsłużone i służą jedynie do zrozumienia, o co chodzi.
Nie zgaduj parametrów, których w wiadomości nie ma. Nie wywołuj narzędzia drugi raz, jeśli już zwróciło wynik."""

BRIEFING_TOOL = {"type": "function", "function": {
    "name": "briefing",
    "description": "Odprawa na dziś: pogoda, kalendarz, przypomnienia i wiadomości naraz ('co dziś', 'plan dnia', 'odprawa', 'co mnie czeka').",
    "parameters": {"type": "object", "properties": {}}}}

# What he is asked to do when he speaks unprompted.
NUDGES = {
    "morning": "To wasze pierwsze spotkanie dzisiaj. Przywitaj {person} po swojemu i w dwóch, trzech zdaniach podaj odprawę na podstawie "
               "wyników narzędzi: tylko to, co dziś ważne.",
    "idle": "Od dłuższej chwili panuje cisza. Zagadnij {person} sam z siebie jednym, najwyżej dwoma krótkimi zdaniami: zaczepka, pytanie "
            "albo uwaga nawiązująca do pory dnia, do tego, co o nim wiesz, albo do waszych wcześniejszych rozmów. "
            "Nie pytaj, czy możesz w czymś pomóc, i nie powtarzaj tego, czym zagadnąłeś ostatnio.",
    "evening": "Jest wieczór. Zapytaj {person} jednym zdaniem, jak minął dzień, albo skomentuj go po swojemu.",
}

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

    def count(self, person):
        """How many things this person has ever said to him."""
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM turns WHERE person = ? AND role = 'user'", (person,)).fetchone()[0]

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
    def __init__(self, llm_url, model, prompt_path, db_path, inline_system=False, home=None, online=(), wiki=None, diary=None):
        self.url = llm_url.rstrip("/") + "/v1/chat/completions"
        self.model = model
        with open(prompt_path, encoding="utf-8") as f:
            self.prompt = f.read().strip()
        if not home:
            # No flat behind him yet: the rules about rooms, air, doors and guests would only crowd the
            # model's limited context and push his character out of it.
            parts = re.split(r"(?m)^(?=── )", self.prompt)
            self.prompt = "".join(p for p in parts if not p.startswith(FLAT_ONLY)).strip()
        self.memory = Memory(db_path)
        # What he is told about the household up front: a private file beside his memory, never in the repository.
        self.household_path = os.path.join(os.path.dirname(os.path.abspath(db_path)), "domownicy.md")
        self.folding = threading.Lock()  # one notes rewrite at a time
        self.inline_system = inline_system
        self.home = home  # home.Home, or None while the flat is not connected
        self.own = Own(self.memory)
        # Which outside sources he may consult; none unless switched on.
        self.online = Online(self.memory, os.path.join(os.path.dirname(os.path.abspath(__file__)), "online.json"),
                             list(online)) if online else None
        self.wiki = wiki  # wiki.Encyclopedia, or None without an archive on disk
        # His own life, if the memories file is there (next to the prompt).
        memories = os.path.join(os.path.dirname(os.path.abspath(prompt_path)), "memories.pl.md")
        self.past = Past(memories) if os.path.isfile(memories) else None
        self.diary = diary  # diary.Diary, or None without calendars
        self.tools = (OWN_TOOLS + (HOME_TOOLS if home else []) + (self.online.tools if self.online else [])
                      + ([WIKI_TOOL] if wiki else []) + ([PAST_TOOL] if self.past else [])
                      + ([DIARY_TOOL] if diary else []) + [BRIEFING_TOOL])
        self.tools_work = True  # cleared if the model server turns out not to accept tools
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
        text = (content or "").strip().removeprefix("[TOOL_CALLS]").strip()
        if not text.startswith("["):
            return []
        try:
            items = json.loads(text)
        except ValueError:
            return []
        known = {t["function"]["name"] for t in OWN_TOOLS + HOME_TOOLS} | {"check_online", "look_up", "recall_past", "calendar", "briefing"}
        if not isinstance(items, list) or not items or not all(
                isinstance(i, dict) and i.get("name") in known for i in items):
            return []
        return [{"id": uuid.uuid4().hex[:9], "type": "function",   # Mistral wants 9-character ids
                 "function": {"name": i["name"], "arguments": json.dumps(i.get("arguments") or {})}}
                for i in items]

    def run_tool(self, person, name, arguments):
        if name in OWN_NAMES:
            return self.own.call(person, name, arguments)
        if name == "check_online" and self.online:
            self.online.place = self.own.place()
            return self.online.call(name, arguments)
        if name == "calendar" and self.diary:
            return self.diary.call(name, json.loads(arguments) if isinstance(arguments, str) else (arguments or {}))
        if name == "briefing":
            return self.briefing(person)
        if name == "look_up" and self.wiki:
            return self.wiki.call(name, arguments)
        if name == "recall_past" and self.past:
            return self.past.call(name, arguments)
        if self.home:
            return self.home.call(name, arguments)
        return f"Błąd: nie ma narzędzia {name}."

    def agenda(self):
        """For the page: what to say now (timers, reminders, a meeting about to start) and what is running."""
        out = self.own.agenda()
        if self.diary:
            try:
                out["say"] += self.diary.soon()
            except Exception as err:   # a broken calendar must not stop the timers
                print(f"Calendar check failed: {err!r}", flush=True)
        out["flat"] = bool(self.home)
        return out

    def briefing(self, person):
        """Everything for the day in one result: weather where they are, the calendar, reminders, headlines."""
        parts = []
        if self.online and "weather" in self.online.enabled:
            self.online.place = self.own.place()
            weather = self.online.call("check_online", {"source": "weather"})
            parts.append(" ".join(re.split(r"(?<=\.) (?=Jutro|Pojutrze)", weather)[:2]) if not weather.startswith("Błąd") else weather)
        if self.diary:
            parts.append(self.diary.calendar("dziś"))
        parts.append(self.own.show_reminders(person))
        if self.online and "news" in self.online.enabled:
            parts.append(self.online.call("check_online", {"source": "news"}))
        return "Odprawa na dziś. " + " ".join(parts)

    def nudge(self, person, kind):
        """He speaks first: a greeting with the day's briefing, a remark after a long silence, an evening question.

        -> {"reply": text} ("" when he should stay quiet). Nothing is stored as said by the person.
        """
        if kind not in NUDGES or (self.diary and self.diary.busy()):
            return {"reply": ""}
        notes, _ = self.memory.notes(person)
        history = [{"role": role, "content": content} for _, role, content, _ in self.memory.recent(person)]
        results = [self.briefing(person)] if kind == "morning" else []
        said = f"[To nie jest wiadomość od domownika. {NUDGES[kind].format(person=person.capitalize())}]"
        answer = self.clean(self.complete(self.frame(self.system(person, notes, results), history, said, person),
                                          max_tokens=220 if results else 90, temperature=0.8))
        if answer:
            self.memory.add(person, "assistant", answer)
        return {"reply": answer}

    def frame(self, system, history, text, person):
        """System text + past turns + the new message, in the shape the runtime needs."""
        if self.inline_system:
            # Some runtimes drop the system role for Mistral models. Put the
            # instructions in front of the newest message, where Mistral's own
            # template places them.
            return history + [{"role": "user", "content": f"{system}\n\n── WIADOMOŚĆ OD {person.upper()} ──\n{text}"}]
        return [{"role": "system", "content": system}] + history + [{"role": "user", "content": text}]

    def act(self, person, history, text, insist=False):
        """Step one of a turn: decide which tools the request needs and run them.

        Done as its own short exchange, apart from ALAN's personality. Given the
        whole character sheet at once, the model would rather say "done" in
        character than actually call a tool; asked only "which tool, if any?",
        it calls them. Returns (tool results, actions for the screen).
        """
        results, actions = [], []
        if not self.tools_work:
            return results, actions
        # Only the person's own earlier messages, as plain context. ALAN's past
        # replies are left out: seeing "done" after each request, the model
        # learns to answer "done" here too instead of calling the tool.
        earlier = [m["content"] for m in history if m["role"] == "user"][-DISPATCH_HISTORY:] if DISPATCH_HISTORY else []
        context = ("Wcześniejsze wiadomości (już obsłużone, tylko dla kontekstu):\n"
                   + "\n".join(f"- {m}" for m in earlier) + "\n\n") if earlier else ""
        system = self.dispatcher(person) + ("\nTa wiadomość prosi o wykonanie czegoś. Jeśli pasuje do niej którekolwiek "
                                            "narzędzie, wywołaj je teraz." if insist else "")
        messages = self.frame(system, [], f"{context}Ostatnia wiadomość:\n{text}", person)
        nudged = False
        for _ in range(MAX_TOOL_ROUNDS + 1):
            try:
                message = self.chat(messages, max_tokens=300, temperature=0.1, tools=self.tools)
            except urllib.error.HTTPError as err:
                if err.code != 400 or results:
                    raise
                # e.g. an Ollama model without tool support: carry on as plain conversation
                print("The model server refused tools; ALAN will only talk.", flush=True)
                self.tools_work = False
                break
            content = (message.get("content") or "").strip()
            calls = message.get("tool_calls") or self.written_calls(content)
            if not calls:
                if results or nudged or not content or content.upper().startswith("BRAK"):
                    break
                # It described a call in words, or started chatting. Ask once more, firmly.
                nudged = True
                messages += [{"role": "assistant", "content": content},
                             {"role": "user", "content": "Odpowiedz wyłącznie wywołaniem narzędzia albo słowem BRAK."}]
                continue
            messages.append({"role": "assistant", "content": "", "tool_calls": calls})
            for call in calls:
                name = call["function"]["name"]
                result = self.run_tool(person, name, call["function"].get("arguments"))
                print(f"Tool: {name}({call['function'].get('arguments')}) -> {result}", flush=True)
                messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
                results.append(result)
                if result.startswith(("Wykonano", "Błąd")):   # reading something is not a change
                    actions.append({"ok": result.startswith("Wykonano"), "text": result.split(": ", 1)[-1].rstrip(".")})
        return results, actions

    def dispatcher(self, person):
        parts = [DISPATCH]
        if self.wiki:
            parts.append("Wyjątek: masz encyklopedię (look_up). Gdy domownik pyta o fakty — kto, co, gdzie, kiedy, ile, jak coś działa, "
                         "o osobę, miejsce, wydarzenie historyczne, pojęcie — wywołaj look_up z hasłem zamiast odpowiadać BRAK.")
        if self.past:
            parts.append("Wyjątek: gdy domownik pyta asystenta o jego własne życie, przeszłość, rodzinę, znajomych, romanse albo przygody "
                         "(Lizbona, dzwon, Vasco, Gran Canaria i tym podobne) — wywołaj recall_past ze słowami kluczowymi pytania. "
                         "Nie wywołuj go, gdy pytanie nie dotyczy jego przeszłości.")
        return "\n".join(parts + [self.moment(person)])

    def moment(self, person):
        now = datetime.datetime.now()
        # Small models get date arithmetic wrong; give them the calendar to read from.
        ahead = ", ".join(f"{DAYS[d.weekday()]} {d:%d.%m}" for d in (now + datetime.timedelta(days=i) for i in range(1, 15)))
        place = self.own.place()
        where = f" Jesteście teraz w: {place['name']}." if place else ""
        return (f"Jest {DAYS[now.weekday()]}, {now:%d.%m.%Y}, godzina {now:%H:%M}. Rozmawiasz z: {person.capitalize()}.{where}\n"
                f"Najbliższe dni: {ahead}. Daty bierz z tej listy, nie licz ich samodzielnie.")

    def household(self):
        """The household file, read afresh each time so edits take effect without a restart; lines starting with # are notes to the editor."""
        try:
            with open(self.household_path, encoding="utf-8") as f:
                return "\n".join(line.rstrip() for line in f if line.strip() and not line.startswith("#"))[:6000]
        except OSError:
            return ""

    def system(self, person, notes, results=None):
        """ALAN's character, what he knows, and — decisive for honesty — what the tools did this turn."""
        parts = [self.prompt]
        if household := self.household():
            parts += ["── DOMOWNICY: CO O NICH WIESZ ──", household,
                      "Korzystaj z tej wiedzy naturalnie, bez recytowania. Spraw jednego domownika nie opowiadaj gościom."]
        if not self.home:
            parts += ["── GDZIE TERAZ MIESZKASZ ──",
                      "Na razie mieszkasz w laptopie, nie w mieszkaniu: nie masz czujników, kamer ani urządzeń. Niczego nie mierzysz "
                      "i niczym nie sterujesz, i nie udajesz, że jest inaczej. Jesteś towarzyszem przy pracy i w podróży: rozmowa, "
                      "pamięć, notatki, przypomnienia, plan dnia, sprawdzanie faktów."]
        if self.memory.count(person) < GETTING_TO_KNOW:
            parts += ["── POZNAWANIE ──",
                      f"Dopiero poznajesz {person.capitalize()}. Gdy rozmowa na to pozwala, dorzuć na końcu jedno krótkie pytanie o niego "
                      "(praca, rytm dnia, jedzenie, co lubi, co go teraz zajmuje), o coś, czego jeszcze nie wiesz. Jedno pytanie, "
                      "nie w każdej wypowiedzi, nigdy przy krótkich poleceniach. Przy pierwszej rozmowie przedstaw się po swojemu."]
        parts += ["── TERAZ ──", self.moment(person), self.abilities()]
        if facts := self.own.facts(person):
            parts += [f"── ZAPAMIĘTANE NA PROŚBĘ ({person.upper()}) ──", "\n".join(f"- {f}" for f in facts)]
        if notes:
            parts += [f"── PAMIĘĆ: CO WIESZ O {person.upper()} Z WCZEŚNIEJSZYCH ROZMÓW ──", notes]
        if results:
            parts.append("── CO ZROBIŁY NARZĘDZIA W TEJ CHWILI ──")
            parts += [f"- {r}" for r in results]
            parts.append("Odpowiedz na podstawie tych wyników. 'Wykonano' znaczy, że to zrobiłeś; 'Błąd' znaczy, że się nie udało — "
                         "powiedz krótko dlaczego. Liczby i fakty podawaj dokładnie tak, jak są w wynikach.")
        return "\n".join(parts)

    def abilities(self):
        can = ["minutnik, przypomnienia i budzik, wspólne listy (np. zakupy), zapamiętywanie na prośbę, notatki dyktowane i ich "
               "wyszukiwanie, szukanie w dawnych rozmowach, odprawa na dziś, liczenie czasu czytania tekstu"]
        cannot = ["drzwi, zamki, kamery"]
        if self.diary:
            can.append("odczyt kalendarza (bez dopisywania)")
        else:
            cannot.append("kalendarz (nie jest podłączony)")
        if self.home:
            can.append("światło, ogrzewanie i odczyt stanu mieszkania")
        else:
            cannot.append("światło, ogrzewanie i czujniki (mieszkanie nie jest jeszcze podłączone)")
        if self.wiki:
            can.append("sprawdzanie faktów w encyklopedii zapisanej lokalnie")
        if self.online:
            can.append("dane z zewnątrz: " + ", ".join(SOURCES[s] for s in self.online.enabled))
        else:
            cannot.append("internet: nie znasz aktualnej pogody, wiadomości ani kursów")
        return f"Potrafisz: {'; '.join(can)}. Nie potrafisz: {'; '.join(cannot)}."

    def speak(self, person, notes, history, text, results):
        """Step two of a turn: the reply in character, given what the tools did."""
        # When tools ran, their report also rides right behind the message: the
        # last thing the model reads. (Attached to plain chat it derails the reply.)
        said = f"{text}\n\n[Narzędzia wykonały: {' '.join(results)}]" if results else text
        return self.clean(self.complete(self.frame(self.system(person, notes, results), history, said, person),
                                        max_tokens=220, temperature=0.6))

    def reply(self, person, text):
        return self.respond(person, text)["reply"]

    def respond(self, person, text):
        """-> {"reply": what he says, "actions": [{"ok": bool, "text": what he changed or could not}]}"""
        notes, _ = self.memory.notes(person)
        history = [{"role": role, "content": content} for _, role, content, _ in self.memory.recent(person)]
        started = time.monotonic()
        results, actions = self.act(person, history, text)
        chosen = time.monotonic()
        answer = self.speak(person, notes, history, text, results)
        print(f"Timing: choosing tools {chosen - started:.1f} s, wording the answer {time.monotonic() - chosen:.1f} s", flush=True)
        if not results and CLAIM.search(answer):
            # He says he did something, but no tool ran. Most often the request was
            # real and the tool-choosing step missed it: try that step once more,
            # insisting. If still nothing was done, he may not claim otherwise.
            print(f"Unfounded claim: {answer!r}; asking the tools again.", flush=True)
            results, actions = self.act(person, history, text, insist=True)
            answer = self.speak(person, notes, history, text, results) if results else NOT_DONE
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
