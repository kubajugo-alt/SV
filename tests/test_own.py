import datetime
import os
import tempfile
import unittest

from tests.support import ROOT  # noqa: F401  (puts the repo on sys.path)

import brain
import own


class Clock:
    def __init__(self):
        self.now = datetime.datetime(2026, 11, 12, 10, 0)   # a Thursday

    def __call__(self):
        return self.now

    def forward(self, **delta):
        self.now += datetime.timedelta(**delta)


class OwnTools(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(), "alan.db")
        self.clock = Clock()
        self.own = own.Own(brain.Memory(self.path), self.clock)

    def call(self, name, **args):
        return self.own.call("kuba", name, args)

    def test_timer_runs_down_and_rings_once(self):
        self.assertEqual(self.call("set_timer", minutes=1.5, label="jajka"), "Wykonano: minutnik nr 1 na 1 min 30 s (jajka).")
        self.clock.forward(seconds=30)
        self.assertEqual(self.own.agenda(), {"say": [], "reminders": [],
                                             "timers": [{"number": 1, "label": "jajka", "seconds": 60}]})
        self.clock.forward(seconds=61)
        self.assertEqual(self.own.agenda()["say"], ["Minutnik jajka: czas minął."])
        self.assertEqual(self.own.agenda(), {"say": [], "timers": [], "reminders": []})

    def test_timer_limits(self):
        for minutes in (0, -5, 24 * 60 + 1):
            self.assertTrue(self.call("set_timer", minutes=minutes).startswith("Błąd"))
        self.assertTrue(self.call("set_timer", minutes="dużo").startswith("Błąd"))

    def test_reminder_dates(self):
        cases = {"2026-11-17 09:00": "17.11.2026 o 09:00", "17.11 9:00": "17.11.2026 o 09:00",
                 "11:30": "12.11.2026 o 11:30",      # later today
                 "07:00": "13.11.2026 o 07:00",      # already past today -> tomorrow: an alarm clock
                 "01.02 08:00": "01.02.2027 o 08:00"}  # a date already gone this year -> next year
        for when, expected in cases.items():
            self.assertIn(expected, self.call("set_reminder", when=when, text="x"), when)
        for bad in ("jutro rano", "2026-13-40 09:00", "2026-11-12 09:00", ""):
            self.assertTrue(self.call("set_reminder", when=bad, text="x").startswith("Błąd"), bad)
        self.assertTrue(self.call("set_reminder", when="12:00", text=" ").startswith("Błąd"))

    def test_reminder_is_spoken_to_its_owner_when_due(self):
        self.own.call("hubert", "set_reminder", {"when": "12:00", "text": "wyjąć ciasto"})
        self.clock.forward(hours=2, minutes=1)
        self.assertEqual(self.own.agenda()["say"], ["Hubert, przypomnienie: wyjąć ciasto."])

    def test_show_and_cancel(self):
        self.assertEqual(self.call("show_reminders"), "Nie ma aktywnych minutników ani przypomnień.")
        self.call("set_timer", minutes=10, label="pranie")
        self.call("set_reminder", when="2026-11-13 09:00", text="zadzwonić do mamy")
        shown = self.call("show_reminders")
        self.assertIn("nr 1 minutnik pranie, zostało 10 min", shown)
        self.assertIn("nr 2 przypomnienie dla Kuba na 13.11.2026 09:00: zadzwonić do mamy", shown)
        self.assertEqual(self.call("cancel_reminder", number=1), "Wykonano: anulowano minutnik nr 1 (pranie).")
        self.assertTrue(self.call("cancel_reminder", number=1).startswith("Błąd"))
        self.assertNotIn("pranie", self.call("show_reminders"))

    def test_shared_list(self):
        self.assertEqual(self.call("edit_list"), "Lista zakupy jest pusta.")
        self.assertEqual(self.call("edit_list", add=["mleko", "Chleb", "mleko"]),
                         "Wykonano: dopisano: mleko, Chleb. Lista zakupy: mleko, Chleb.")
        self.assertEqual(self.own.call("hubert", "edit_list", {}), "Lista zakupy: mleko, Chleb.")   # shared by the household
        self.assertEqual(self.call("edit_list", remove=["chleb"]), "Wykonano: skreślono: chleb. Lista zakupy: mleko.")
        self.assertTrue(self.call("edit_list", remove=["masło"]).startswith("Błąd: na liście zakupy nie ma: masło."))
        self.assertEqual(self.call("edit_list", list="Prezenty", add=["książka"]),
                         "Wykonano: dopisano: książka. Lista prezenty: książka.")
        self.assertEqual(self.call("edit_list"), "Lista zakupy: mleko.")

    def test_remember_and_forget(self):
        self.call("remember", fact="Kuba ma uczulenie na orzechy.")
        self.call("remember", fact="Kod do rowerowni to 4812.")
        self.assertEqual(self.own.facts("kuba"), ["Kuba ma uczulenie na orzechy.", "Kod do rowerowni to 4812."])
        self.assertEqual(self.own.facts("hubert"), [])
        self.assertEqual(self.call("forget", about="Orzechy"), "Wykonano: zapomniano: Kuba ma uczulenie na orzechy.")
        self.assertTrue(self.call("forget", about="orzechy").startswith("Błąd"))
        self.assertTrue(self.call("forget", about="a").startswith("Błąd"))   # too vague to delete on
        self.assertEqual(self.own.facts("kuba"), ["Kod do rowerowni to 4812."])

    def test_everything_survives_a_restart(self):
        self.call("set_timer", minutes=5)
        self.call("edit_list", add=["mleko"])
        self.call("remember", fact="Kod do rowerowni to 4812.")
        again = own.Own(brain.Memory(self.path), self.clock)
        self.assertEqual(len(again.agenda()["timers"]), 1)
        self.assertEqual(again.call("kuba", "edit_list", {}), "Lista zakupy: mleko.")
        self.assertEqual(again.facts("kuba"), ["Kod do rowerowni to 4812."])

    def test_bad_calls_become_sentences(self):
        self.assertTrue(self.own.call("kuba", "set_timer", "not json").startswith("Błąd"))
        self.assertTrue(self.own.call("kuba", "set_timer", {}).startswith("Błąd"))
        self.assertTrue(self.own.call("kuba", "agenda", {}).startswith("Błąd"))     # not a tool, though it is a method
        self.assertTrue(self.own.call("kuba", "__init__", {}).startswith("Błąd"))


if __name__ == "__main__":
    unittest.main()
