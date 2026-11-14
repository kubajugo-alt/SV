import os
import tempfile
import unittest

from tests.support import ROOT

import brain
from past import Past

MEMORIES = """## Dziadek Joaquim
Słowa: dziadek, joaquim, księgarnia, ludwisarz, wychował

Dziadek Joaquim wychował mnie nad księgarnią w Alfamie. Nauczył mnie książek, kawy i milczenia.

## Noc z Duarte
Słowa: duarte, gitarzysta, romans, kochanek, fado, tawerna

Duarte grał na gitarze dla Dony Amálii. Spędziliśmy razem noc w księgarni; był lekki jak jego muzyka.

## Zatopiony dzwon
Słowa: dzwon, morze, 1755, cysterna

Dzwon odlali moi przodkowie. W 1755 roku przywołał Morze.
"""


class Memories(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "memories.pl.md")
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(MEMORIES)
        self.past = Past(self.path)

    def test_the_right_memory_comes_back_whatever_the_word_endings(self):
        text = self.past.recall_past("Opowiedz o swoim dziadku")
        self.assertTrue(text.startswith("Twoje wspomnienia. „Dziadek Joaquim”: Dziadek Joaquim wychował mnie"), text)
        self.assertNotIn("Duarte", text)
        self.assertIn("Noc z Duarte", self.past.recall_past("miałeś jakieś romanse?"))
        self.assertIn("przywołał Morze", self.past.recall_past("co się stało z dzwonem w 1755"))

    def test_what_he_does_not_remember_is_said_so(self):
        self.assertIn("nie masz takiego wspomnienia", self.past.recall_past("Paryż"))
        self.assertTrue(self.past.recall_past("a co to").startswith("Błąd: podaj"))

    def test_the_mind_has_the_tool_only_with_a_memories_file(self):
        prompt = os.path.join(self.tmp.name, "system.pl.txt")
        with open(os.path.join(ROOT, "prompts", "system.pl.txt"), encoding="utf-8") as src, open(prompt, "w", encoding="utf-8") as dst:
            dst.write(src.read())
        b = brain.Brain("http://unused", "test", prompt, os.path.join(self.tmp.name, "alan.db"))
        self.assertIn("recall_past", [t["function"]["name"] for t in b.tools])
        self.assertIn("recall_past", b.dispatcher("Kuba"))
        self.assertIn("lekki jak jego muzyka", b.run_tool("Kuba", "recall_past", {"query": "Duarte"}))
        os.remove(self.path)
        bare = brain.Brain("http://unused", "test", prompt, os.path.join(self.tmp.name, "b.db"))
        self.assertNotIn("recall_past", [t["function"]["name"] for t in bare.tools])
        self.assertNotIn("recall_past", bare.dispatcher("Kuba"))
