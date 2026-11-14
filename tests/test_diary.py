import datetime
import os
import tempfile
import unittest

from tests.support import ROOT

import brain
from diary import Diary, occurrences, parse

ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=Europe/Warsaw:20261112T100000
DTEND;TZID=Europe/Warsaw:20261112T110000
SUMMARY:Rozmowa o festiwalu\\, Sandomierz
LOCATION:online
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261113
DTEND;VALUE=DATE:20261114
SUMMARY:Urodziny mamy
END:VEVENT
BEGIN:VEVENT
DTSTART:20261102T080000
DTEND:20261102T083000
RRULE:FREQ=WEEKLY;BYDAY=MO,TH
SUMMARY:Rolka a
 ntropologiczna
END:VEVENT
BEGIN:VEVENT
DTSTART:20261112T150000
SUMMARY:Odwołane
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
"""


class Calendar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "dom.ics")
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(ICS)
        self.now = datetime.datetime(2026, 11, 12, 9, 52)                     # a Thursday
        self.diary = Diary([self.path, "# a comment", ""], clock=lambda: self.now)

    def test_a_day_lists_timed_repeating_and_all_day_events(self):
        local = datetime.datetime.now().astimezone().tzinfo
        self.assertEqual(len(parse(ICS, local)), 3)                           # the cancelled one is dropped
        today = self.diary.calendar("dziś")
        self.assertIn("08:00–08:30: Rolka antropologiczna", today)            # weekly, on Mondays and Thursdays
        self.assertIn("Rozmowa o festiwalu, Sandomierz (online)", today)
        self.assertNotIn("Urodziny", today)
        self.assertIn("piątek 13.11, cały dzień: Urodziny mamy", self.diary.calendar("jutro"))
        self.assertEqual(self.diary.calendar("2026-11-14"), "W kalendarzu nic nie ma (14.11).")
        self.assertTrue(self.diary.calendar("kiedyś").startswith("Błąd"))

    def test_repetition_rules(self):
        day = datetime.date
        event = {"start": datetime.datetime(2026, 1, 31, 9), "end": datetime.datetime(2026, 1, 31, 10), "rule": {"FREQ": "MONTHLY"}}
        self.assertEqual([w.month for w in occurrences(event, day(2026, 1, 1), day(2026, 6, 30))], [1, 3, 5])   # only months with a 31st
        event["rule"] = {"FREQ": "DAILY", "INTERVAL": "2", "COUNT": "3"}
        self.assertEqual([w.day for w in occurrences(event, day(2026, 1, 1), day(2026, 3, 1))], [31, 2, 4])
        event["rule"] = {"FREQ": "YEARLY", "UNTIL": "20280101T000000Z"}
        self.assertEqual([w.year for w in occurrences(event, day(2026, 1, 1), day(2030, 1, 1))], [2026, 2027])

    def test_a_meeting_is_announced_once_and_he_keeps_quiet_during_it(self):
        if datetime.datetime.now().astimezone().utcoffset() != datetime.timedelta(0):
            self.skipTest("written for a machine on UTC")                      # 10:00 Warsaw is 09:00 here
        self.now = datetime.datetime(2026, 11, 12, 8, 52)
        self.assertEqual(self.diary.soon(), ["Za 8 min: Rozmowa o festiwalu, Sandomierz, online."])
        self.assertEqual(self.diary.soon(), [])
        self.assertFalse(self.diary.busy())
        self.now = datetime.datetime(2026, 11, 12, 9, 30)
        self.assertTrue(self.diary.busy())

    def test_the_mind_reads_it_and_briefs_from_it(self):
        b = brain.Brain("http://unused", "test", os.path.join(ROOT, "prompts", "system.pl.txt"),
                        os.path.join(self.tmp.name, "alan.db"), diary=self.diary)
        self.assertIn("Rolka antropologiczna", b.run_tool("kuba", "calendar", '{"day": "dziś"}'))
        text = b.briefing("kuba")
        self.assertTrue(text.startswith("Odprawa na dziś. Kalendarz:"), text)
        self.assertIn("Nie ma aktywnych minutników", text)
        self.assertIn("flat", b.agenda())
