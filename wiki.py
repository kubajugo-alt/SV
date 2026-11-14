"""ALAN's encyclopedia: Wikipedia read from a file on this machine.

The file is a Kiwix archive (.zim) of Polish Wikipedia, see
https://download.kiwix.org/zim/wikipedia/ (`wikipedia_pl_all_nopic_*.zim` is the
whole text without pictures; `..._mini_...` only the openings of articles).
Nothing leaves the machine: the archive carries its own search index.

Needs `pip install libzim`. One tool for the model, `look_up`.
"""

import html.parser
import re
import threading

TOOL = {"type": "function", "function": {
    "name": "look_up",
    "description": "Sprawdza hasło w encyklopedii (Wikipedia zapisana lokalnie): fakty, osoby, miejsca, historia, nauka, pojęcia. "
                   "Nie zna bieżących wydarzeń.",
    "parameters": {"type": "object", "required": ["query"], "properties": {
        "query": {"type": "string", "description": "hasło w mianowniku, np. Maria Skłodowska-Curie, Tarnobrzeg, fotosynteza"}}}}}

MAX_CHARS = 1500
SKIP = {"script", "style", "table", "sup", "figure", "figcaption", "nav", "footer", "noscript"}


class Prose(html.parser.HTMLParser):
    """The paragraphs of an article page, without tables, references, captions or scripts."""

    def __init__(self):
        super().__init__()
        self.skipping, self.in_p, self.now, self.paragraphs = 0, False, [], []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skipping += 1
        elif tag == "p" and not self.skipping:
            self.in_p, self.now = True, []

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skipping = max(0, self.skipping - 1)
        elif tag == "p" and self.in_p:
            self.in_p = False
            text = re.sub(r"\s+", " ", "".join(self.now)).strip()
            text = re.sub(r"\s+([,.;:)])", r"\1", re.sub(r"\[[^\]]{0,12}\]", "", text))
            if len(text) > 40:                       # skips stubs such as coordinates
                self.paragraphs.append(text)

    def handle_data(self, data):
        if self.in_p and not self.skipping:
            self.now.append(data)


class Encyclopedia:
    def __init__(self, path):
        from libzim.reader import Archive   # imported here so ALAN starts without the library when no archive is used

        self.zim = Archive(path)
        self.lock = threading.Lock()         # the library's searchers are not safe to share between threads
        self.name = f"{path} ({self.zim.article_count} articles{'' if self.zim.has_fulltext_index else ', titles only'})"

    def find(self, query):
        """Paths of the best articles: by title first, then by the text."""
        from libzim.search import Query, Searcher
        from libzim.suggestion import SuggestionSearcher

        paths = list(SuggestionSearcher(self.zim).suggest(query).get_results(0, 5))
        exact = [p for p in paths if self.zim.get_entry_by_path(p).title.lower() == query.lower()]
        if exact:
            return exact
        if not paths and self.zim.has_fulltext_index:
            paths = [getattr(r, 'path', r) for r in Searcher(self.zim).search(Query().set_query(query)).get_results(0, 3)]
        return paths

    def look_up(self, query="", **_):
        query = re.sub(r"\s+", " ", str(query or "")).strip()
        if not query:
            return "Błąd: podaj hasło do sprawdzenia w encyklopedii."
        with self.lock:
            for path in self.find(query):
                entry = self.zim.get_entry_by_path(path)
                item = entry.get_item()
                if not item.mimetype.startswith("text/html"):
                    continue
                prose = Prose()
                prose.feed(bytes(item.content).decode("utf-8", "replace"))
                text = " ".join(prose.paragraphs)
                if not text:
                    continue
                if len(text) > MAX_CHARS:
                    text = text[:MAX_CHARS].rsplit(". ", 1)[0] + "."
                return f"Encyklopedia, hasło „{item.title}”: {text}"
        return f"Błąd: w encyklopedii nie ma hasła o '{query}'."

    def call(self, name, arguments):
        return self.look_up(**arguments) if name == "look_up" and isinstance(arguments, dict) else f"Błąd: nie ma narzędzia {name}."
