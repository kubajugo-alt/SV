import datetime
import os
import tempfile
import unittest

from tests.support import ROOT, ScriptedModel

import brain

PROMPT = os.path.join(ROOT, "prompts", "system.pl.txt")


class More(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.b = brain.Brain("http://unused", "test", PROMPT, os.path.join(self.tmp.name, "alan.db"))
        self.own = self.b.own

    def test_notes_are_kept_and_found_whatever_the_word_endings(self):
        self.assertTrue(self.own.take_note("kuba", "Pomysł na rolkę: ślimaki w sosie szarym").startswith("Wykonano: zapisano"))
        self.own.take_note("kuba", "Zadzwonić do drukarni w sprawie plakatów")
        self.own.take_note("hubert", "Kupić kardamon")
        found = self.own.find_notes("kuba", "rolki o ślimakach")
        self.assertIn("ślimaki w sosie szarym", found)
        self.assertNotIn("drukarni", found)
        self.assertNotIn("kardamon", self.own.find_notes("kuba"))              # each person has their own
        self.assertIn("drukarni", self.own.find_notes("kuba"))
        self.assertEqual(self.own.find_notes("kuba", "festiwal"), "Nie ma takich notatek.")

    def test_old_conversations_can_be_searched(self):
        self.b.memory.add("kuba", "user", "Festiwal w Sandomierzu robimy w lipcu, budżet jeszcze nieustalony.")
        self.b.memory.add("kuba", "assistant", "Lipiec w Sandomierzu. Zapisane w głowie, czyli nigdzie.")
        self.b.memory.add("kuba", "user", "Która godzina?")
        found = self.own.recall_talk("kuba", "budżet festiwalu")
        self.assertIn("Kuba: Festiwal w Sandomierzu", found)
        self.assertNotIn("godzina", found)
        self.assertEqual(self.own.recall_talk("kuba", "Unitree"), "W dawnych rozmowach nic o tym nie ma.")

    def test_where_they_are_changes_what_he_is_told_and_the_weather(self):
        self.assertIsNone(self.own.place())
        self.assertNotIn("Jesteście teraz w", self.b.moment("kuba"))
        self.assertEqual(self.own.set_place("kuba", "w Las Palmas"), "Wykonano: zapisano, że jesteście teraz w Las Palmas.")
        self.assertEqual(self.own.place()["tz"], "Atlantic/Canary")
        self.assertIn("Jesteście teraz w: Las Palmas de Gran Canaria.", self.b.moment("kuba"))
        self.assertTrue(self.own.set_place("kuba", "Ułan Bator").startswith("Błąd: nie znam współrzędnych"))

    def test_reading_time(self):
        self.assertIn("280 słów; czytany spokojnie na głos potrwa około 2 min", self.own.reading_time("kuba", "słowo " * 280))

    def test_on_a_laptop_he_knows_he_has_no_flat(self):
        text = self.b.system("hubert", "")
        self.assertIn("mieszkasz w laptopie", text)
        self.assertNotIn("── DRZWI", text)                # the flat's rules are left out
        self.assertNotIn("POZNAWANIE", text)              # questions about the person belong to when he speaks first
        self.assertIn("Najpierw odpowiadasz wprost", text)

    def test_he_can_speak_first_and_it_is_not_stored_as_the_person_speaking(self):
        model = ScriptedModel({"content": "Cisza jak w księgarni w poniedziałek. Żyjesz tam?"})
        self.b.chat = model
        self.assertEqual(self.b.nudge("kuba", "idle")["reply"], "Cisza jak w księgarni w poniedziałek. Żyjesz tam?")
        self.assertIn("To nie jest wiadomość od domownika", model.seen[0]["messages"][-1]["content"])
        self.assertEqual([role for _, role, _, _ in self.b.memory.recent("kuba")], ["assistant"])
        self.assertEqual(self.b.nudge("kuba", "nonsense"), {"reply": ""})

    def test_the_morning_greeting_carries_the_briefing(self):
        model = ScriptedModel({"content": "Dzień dobry. Nic cię dziś nie goni."})
        self.b.chat = model
        self.b.nudge("kuba", "morning")
        self.assertIn("Odprawa na dziś.", model.seen[0]["messages"][0]["content"])
