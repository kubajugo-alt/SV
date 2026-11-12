"""ALAN's own past: everything that happened to Alan Sanches in the games.

The memories are in `prompts/memories.pl.md`, written in his voice: sections
that start with `## Title`, then a line `Słowa: keyword, keyword, ...`, then
the memory. They are too long to carry in every prompt, so the model gets one
tool, `recall_past`, and fetches the sections that fit a question. He is told
to use it only when someone asks about his life.
"""

import re
import unicodedata

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
tu ty tym w we wtedy z za cie ci twoj twoja twoje cos mial miales bylo pamietasz wiesz stalo stal jakis jakies jakas kiedys bardzo prosze cos tym czemu dlaczego gdzie ile""".split())
# Forms whose stem changes, brought to the form the memories use.
SAME = {"ojca": "ojciec", "ojcem": "ojciec", "ojcu": "ojciec", "ojcze": "ojciec", "tata": "ojciec", "taty": "ojciec", "tato": "ojciec",
        "mama": "matka", "mamy": "matka", "mame": "matka", "mamie": "matka", "psa": "pies", "kota": "kot", "kotem": "kot",
        "dziadkiem": "dziadek", "dziadku": "dziadek", "dziadka": "dziadek", "chlopak": "partner", "chlopaka": "partner",
        "facet": "partner", "faceta": "partner", "maz": "partner", "meza": "partner", "kochales": "milosc", "kochasz": "milosc", "vaskiem": "vasco", "vaskowi": "vasco", "vasku": "vasco"}


def plain(word):
    """Lower case without accents of any language: Zé -> ze, Inês -> ines, łódź -> lodz."""
    word = unicodedata.normalize("NFKD", word.lower().replace("ł", "l"))
    return "".join(ch for ch in word if not unicodedata.combining(ch))


def stems(text):
    """Words reduced so that Polish endings do not matter: no accents, first four or five letters."""
    out = []
    for word in re.findall(r"[^\W_]+", text):
        word = plain(word)
        word = SAME.get(word, word)
        if len(word) > 1 and word not in COMMON and (len(word) > 2 or text.strip().lower() != word):
            out.append(word[:4] if len(word) <= 5 else word[:5])      # short words lose only their ending
    return out


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
            hits = [max(9 * (w in s["title_stems"]), 5 * (w in s["key_stems"])) + min(3, body.count(w)) for w in wanted]
            # A memory that answers every word of the question beats one that repeats a single word often.
            score = sum(hits) * (1 + sum(1 for h in hits if h >= 5)) * (1 + sum(1 for h in hits if h))
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
