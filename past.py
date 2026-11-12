"""ALAN's own past: everything that happened to Alan Sanches in the games.

The memories are in `prompts/memories.pl.md`, written in his voice: sections
that start with `## Title`, then a line `Słowa: keyword, keyword, ...`, then
the memory. They are too long to carry in every prompt, so the model gets one
tool, `recall_past`, and fetches the sections that fit a question. He is told
to use it only when someone asks about his life.
"""

import re

TOOL = {"type": "function", "function": {
    "name": "recall_past",
    "description": "Przypomina twoje własne wspomnienia: życie Alana Sanchesa, ludzi, których znałeś, romanse, wydarzenia w Lizbonie w 1995 "
                   "i na Gran Canarii w 1996. Używaj tylko wtedy, gdy rozmówca pyta o twoją przeszłość.",
    "parameters": {"type": "object", "required": ["query"], "properties": {
        "query": {"type": "string", "description": "o co pyta rozmówca: imiona, miejsca, słowa kluczowe, np. Vasco pierwsze spotkanie; dzwon 1755; Rafa"}}}}}

MAX_CHARS = 2200
# Words that say nothing about which memory is meant.
COMMON = set("""a aby ale albo bo by byl byla bylo byly co czy czym dla do go i ich im jak jako je jego jej jest jestes juz kiedy kim kto ktora
ktory ktorym ma mi mnie moze na nad nie nim o od on ona one oni opowiedz po pod powiedz przez przy sa sie skad ta tak tam te tego tej ten to tobie
tu ty tym w we wtedy z za ze cie ci twoj twoja twoje cos mial miales bylo pamietasz wiesz""".split())
PLAIN = str.maketrans("ąćęłńóśźż", "acelnoszz")


def stems(text):
    """Words reduced so that Polish endings do not matter: lower case, no accents, first five letters."""
    words = re.findall(r"[a-z0-9]+", text.lower().translate(PLAIN))
    return [w[:5] for w in words if w not in COMMON and len(w) > 2]


class Past:
    def __init__(self, path):
        with open(path, encoding="utf-8") as f:
            parts = re.split(r"^## +", f.read(), flags=re.M)[1:]
        self.sections = []
        for part in parts:
            title, _, body = part.partition("\n")
            keys = ""
            if match := re.match(r"\s*Słowa:(.*)\n", body):
                keys, body = match.group(1), body[match.end():]
            body = re.sub(r"\s+", " ", body).strip()
            if body:
                self.sections.append({"title": title.strip(), "text": body, "title_stems": set(stems(title)),
                                      "key_stems": set(stems(keys)), "body_stems": stems(body)})
        self.name = f"{len(self.sections)} memories from {path}"

    def recall_past(self, query="", **_):
        wanted = set(stems(str(query or "")))
        if not wanted:
            return "Błąd: podaj, o co pyta rozmówca."
        scored = []
        for s in self.sections:
            body = s["body_stems"]
            score = sum(6 * (w in s["title_stems"]) + 4 * (w in s["key_stems"]) + min(3, body.count(w)) for w in wanted)
            if score:
                scored.append((score, s))
        if not scored:
            return "Błąd: nie masz takiego wspomnienia. Powiedz, że tego nie pamiętasz; niczego nie zmyślaj."
        scored.sort(key=lambda pair: -pair[0])
        out, used = [], 0
        for score, s in scored[:3]:
            if out and (used + len(s["text"]) > MAX_CHARS or score < scored[0][0] * 0.5):
                break
            out.append(f"„{s['title']}”: {s['text']}")
            used += len(s["text"])
        return "Twoje wspomnienia. " + " ".join(out)[:MAX_CHARS + 600]

    def call(self, name, arguments):
        return self.recall_past(**arguments) if name == "recall_past" and isinstance(arguments, dict) else f"Błąd: nie ma narzędzia {name}."
