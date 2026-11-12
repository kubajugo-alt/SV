import os
import tempfile
import unittest

from tests.support import ROOT

import brain

try:
    import libzim.writer
    from wiki import Encyclopedia
except ImportError:
    libzim = None

PAGES = {
    "Tarnobrzeg": "<p>Tarnobrzeg[1] – miasto na prawach powiatu w województwie podkarpackim, położone nad Wisłą .</p>"
                  "<table><tr><td>Liczba ludności 44 tysiące i jeszcze dużo tekstu w tabeli, którego nie czytamy</td></tr></table>"
                  "<p>Miasto było ośrodkiem wydobycia siarki; kopalnię w Machowie zamieniono na Jezioro Tarnobrzeskie.</p>",
    "Siarka": "<p>Siarka (S) – pierwiastek chemiczny o liczbie atomowej 16, niemetal z grupy tlenowców w układzie okresowym.</p>",
}


@unittest.skipUnless(libzim, "libzim is not installed")
class Wiki(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = os.path.join(cls.tmp.name, "wikipedia_pl_test.zim")

        class Page(libzim.writer.Item):
            def __init__(self, title, body):
                super().__init__()
                self.title, self.body = title, body

            def get_path(self): return self.title
            def get_title(self): return self.title
            def get_mimetype(self): return "text/html"
            def get_hints(self): return {libzim.writer.Hint.FRONT_ARTICLE: True}

            def get_contentprovider(self):
                return libzim.writer.StringProvider(f"<html><body><h1>{self.title}</h1>{self.body}</body></html>")

        with libzim.writer.Creator(cls.path).config_indexing(True, "pl") as creator:
            creator.set_mainpath("Tarnobrzeg")
            for title, body in PAGES.items():
                creator.add_item(Page(title, body))
        cls.wiki = Encyclopedia(cls.path)

    @classmethod
    def tearDownClass(cls):
        del cls.wiki
        cls.tmp.cleanup()

    def test_article_by_title_is_prose_only(self):
        text = self.wiki.look_up("tarnobrzeg")
        self.assertTrue(text.startswith("Encyklopedia, hasło „Tarnobrzeg”: Tarnobrzeg – miasto na prawach powiatu"), text)
        self.assertIn("położone nad Wisłą.", text)          # the reference mark and the stray space are gone
        self.assertIn("Jezioro Tarnobrzeskie", text)
        self.assertNotIn("tabeli", text)

    def test_found_by_its_text_when_no_title_matches(self):
        self.assertIn("hasło „Siarka”", self.wiki.look_up("niemetal tlenowców"))

    def test_misses_and_empty_questions_are_errors(self):
        self.assertEqual(self.wiki.look_up("kwazar"), "Błąd: w encyklopedii nie ma hasła o 'kwazar'.")
        self.assertTrue(self.wiki.look_up("  ").startswith("Błąd: podaj hasło"))

    def test_the_mind_uses_it_for_a_question_of_fact(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = brain.Brain("http://unused", "test", os.path.join(ROOT, "prompts", "system.pl.txt"),
                            os.path.join(tmp, "alan.db"), wiki=self.wiki)
            self.assertIn("look_up", [t["function"]["name"] for t in b.tools])
            self.assertIn("encyklopedi", b.abilities())
            self.assertIn("look_up", b.dispatcher("Kuba"))
            self.assertIn("pierwiastek chemiczny", b.run_tool("Kuba", "look_up", {"query": "Siarka"}))
