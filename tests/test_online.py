import datetime
import json
import os
import tempfile
import unittest
import urllib.error

from tests.support import ROOT, ScriptedModel, tool_call

import brain
import online

CONFIG = os.path.join(ROOT, "online.json")

FORECAST = {"current": {"temperature_2m": 3.1, "weather_code": 3, "wind_speed_10m": 7.9},
            "daily": {"time": ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"], "weather_code": [51, 61, 3, 0],
                      "temperature_2m_max": [8.0, 5.0, 6.8, 7.5], "temperature_2m_min": [3.0, 0.7, -1.2, -1.7],
                      "precipitation_sum": [0.4, 10.8, 0.0, 0.0], "precipitation_probability_max": [65, 100, 0, None],
                      "wind_speed_10m_max": [9.0, 19.1, 22.0, 18.0]}}
WARNINGS = [{"teryt": ["0201", "0202"], "nazwa_zdarzenia": "Silny wiatr", "stopien": "1",
             "obowiazuje_od": "2026-11-13 10:00", "obowiazuje_do": "2026-11-13 20:00"},
            {"teryt": ["1820", "1864"], "nazwa_zdarzenia": "Oblodzenie", "stopien": "2",
             "obowiazuje_od": "2026-11-14 00:00", "obowiazuje_do": "2026-11-14 09:00"}]
AIR = {"AqIndex": {"Data wykonania obliczeń indeksu": "2026-11-12 01:20:15", "Nazwa kategorii indeksu": "Dobry",
                   "Nazwa kategorii indeksu dla wskażnika PM10": "Dobry", "Nazwa kategorii indeksu dla wskażnika SO2": None}}
RSS = b"""<rss><channel>
<item><title>Og\xc3\xb3lna wiadomo\xc5\x9b\xc4\x87</title><link>https://example.org/a</link></item>
<item><title>Remont mostu</title><link>https://example.org/tarnobrzeg/most</link></item>
<item><title>Sandomierz: jarmark</title><link>https://example.org/b</link></item></channel></rss>"""


class FakeNet:
    """Stands in for Online.fetch: canned answers by URL fragment, and a record of what was asked."""

    def __init__(self, answers):
        self.answers, self.asked, self.down = answers, [], False

    def __call__(self, url):
        self.asked.append(url)
        if self.down:
            raise OSError("no route")
        for fragment, answer in self.answers.items():
            if fragment in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer if isinstance(answer, bytes) else json.dumps(answer).encode()
        raise AssertionError(f"unexpected request: {url}")


class Clock:
    now = datetime.datetime(2026, 11, 12, 2, 0)

    def __call__(self):
        return self.now


def not_found():
    return urllib.error.HTTPError("http://x", 404, "Not Found", {}, None)


class Sources(unittest.TestCase):
    def make(self, answers, enabled=tuple(online.SOURCES)):
        self.clock = Clock()
        memory = brain.Memory(os.path.join(tempfile.mkdtemp(), "alan.db"))
        o = online.Online(memory, CONFIG, list(enabled), self.clock)
        o.fetch = self.net = FakeNet(answers)
        return o

    def ask(self, o, source, query=""):
        return o.call("check_online", {"source": source, "query": query})

    def test_weather_with_a_local_warning(self):
        text = self.ask(self.make({"open-meteo": FORECAST, "warningsmeteo": WARNINGS}), "weather")
        self.assertIn("Teraz 3,1°C, pochmurno, wiatr 8 km/h.", text)
        self.assertIn("Jutro (piątek 13.11): od 1 do 5°C, słaby deszcz, opady 10,8 mm, szansa opadów 100%, wiatr do 19 km/h.", text)
        self.assertIn("Niedziela 15.11: od -2 do 8°C, bezchmurnie, bez opadów, szansa opadów 0%", text)
        self.assertIn("Ostrzeżenia IMGW: Oblodzenie 2. stopnia, od 2026-11-14 00:00 do 2026-11-14 09:00.", text)
        self.assertNotIn("Silny wiatr", text)   # another county's warning

    def test_weather_without_warnings_and_when_warnings_fail(self):
        calm = self.ask(self.make({"open-meteo": FORECAST, "warningsmeteo": {"message": "Brak ostrzeżeń meteorologicznych"}}), "weather")
        self.assertTrue(calm.endswith("Ostrzeżenia IMGW: brak."))
        broken = self.ask(self.make({"open-meteo": FORECAST, "warningsmeteo": OSError("down")}), "weather")
        self.assertTrue(broken.endswith("Ostrzeżeń IMGW nie udało się sprawdzić."))

    def test_air(self):
        self.assertEqual(self.ask(self.make({"gios": AIR}), "air"),
                         "Indeks jakości powietrza w Tarnobrzegu (stacja ul. Dąbrowskiej, 01:20): dobry. Wskaźniki: PM10: dobry.")

    def test_rates(self):
        rate = lambda name, mid: {"currency": name, "rates": [{"effectiveDate": "2026-11-10", "mid": mid}]}  # noqa: E731
        o = self.make({"/a/eur/": rate("euro", 4.3895), "/a/usd/": rate("dolar amerykański", 3.9099),
                       "/a/gbp/": rate("funt szterling", 5.249), "/a/xyz/": not_found()})
        self.assertEqual(self.ask(o, "rates"), "euro (EUR): 4,3895 zł, kurs średni NBP z 2026-11-10; "
                                               "dolar amerykański (USD): 3,9099 zł, kurs średni NBP z 2026-11-10.")
        self.assertIn("funt szterling (GBP): 5,2490 zł", self.ask(o, "rates", "Funt"))
        self.assertEqual(self.ask(o, "rates", "xyz"), "Błąd: NBP nie podaje kursu waluty XYZ.")
        self.assertTrue(self.ask(o, "rates", "pieniądze").startswith("Błąd: nie znam waluty"))

    def test_wikipedia(self):
        long = "Tarnobrzeg – miasto w Polsce. " + "Zdanie wypełniające. " * 80
        o = self.make({"list=search&srsearch=Tarnobrzeg": {"query": {"search": [{"title": "Tarnobrzeg"}]}},
                       "list=search&srsearch=nic": {"query": {"search": []}},
                       "prop=extracts": {"query": {"pages": {"1": {"title": "Tarnobrzeg", "extract": long}}}}})
        text = self.ask(o, "wiki", "Tarnobrzeg")
        self.assertTrue(text.startswith("Wikipedia, hasło „Tarnobrzeg”: Tarnobrzeg – miasto w Polsce."))
        self.assertLess(len(text), 960)
        self.assertTrue(text.endswith("."))
        self.assertEqual(self.ask(o, "wiki", "nic"), "Błąd: Wikipedia nie ma hasła o 'nic'.")
        self.assertTrue(self.ask(o, "wiki").startswith("Błąd: podaj hasło"))

    def test_news_puts_local_headlines_first_and_gives_titles_only(self):
        self.assertEqual(self.ask(self.make({"echodnia": RSS}), "news"),
                         "Nagłówki: Remont mostu | Sandomierz: jarmark | Ogólna wiadomość")

    def test_parcel(self):
        number = "1" * 24
        o = self.make({number: {"status": "ready_to_pickup", "tracking_details": [{"datetime": "2026-11-11T14:12:00.000+01:00"}]},
                       "2" * 24: not_found()})
        self.assertEqual(self.ask(o, "parcel", number), f"Paczka {number}: czeka w paczkomacie na odbiór (od 2026-11-11 14:12).")
        self.assertEqual(self.ask(o, "parcel", "2" * 24), f"Błąd: InPost nie zna przesyłki {'2' * 24}.")
        self.assertTrue(self.ask(o, "parcel", "12345").startswith("Błąd: numer przesyłki InPost ma 24 cyfry"))
        self.assertEqual(len(self.net.asked), 2)   # the malformed number never left the flat

    def test_answers_are_cached_and_survive_a_dropped_line(self):
        o = self.make({"gios": AIR})
        first = self.ask(o, "air")
        self.assertEqual(self.ask(o, "air"), first)
        self.assertEqual(len(self.net.asked), 1)
        self.clock.now += datetime.timedelta(hours=2)
        self.net.down = True
        self.assertEqual(self.ask(o, "air"), f"Brak połączenia; dane z 12.11 02:00: {first}")

    def test_no_connection_and_no_cache_is_an_honest_error(self):
        o = self.make({})
        self.net.down = True
        self.assertEqual(self.ask(o, "weather"), "Błąd: źródło pogoda i ostrzeżenia teraz nie odpowiada.")

    def test_only_enabled_sources_and_only_listed_hosts(self):
        o = self.make({}, enabled=("weather",))
        self.assertEqual(o.tools[0]["function"]["parameters"]["properties"]["source"]["enum"], ["weather"])
        self.assertTrue(self.ask(o, "wiki", "Tarnobrzeg").startswith("Błąd: źródło 'wiki' nie jest dostępne"))
        self.assertEqual(self.net.asked, [])
        real = online.Online(brain.Memory(os.path.join(tempfile.mkdtemp(), "a.db")), CONFIG, ["weather"])
        self.assertEqual(real.hosts, {"api.open-meteo.com", "danepubliczne.imgw.pl"})
        for url in ("https://pl.wikipedia.org/wiki/X", "https://example.com/", "https://api.open-meteo.com.evil.example/"):
            with self.assertRaises(PermissionError):
                real.fetch(url)
        with self.assertRaises(ValueError):
            online.Online(brain.Memory(os.path.join(tempfile.mkdtemp(), "b.db")), CONFIG, ["tides"])


class InConversation(unittest.TestCase):
    def make(self, model, **kwargs):
        b = brain.Brain("http://unused", "test", os.path.join(ROOT, "prompts", "system.pl.txt"),
                        os.path.join(tempfile.mkdtemp(), "alan.db"), **kwargs)
        b.chat = model
        return b

    def test_offline_by_default(self):
        model = ScriptedModel({"content": "Nie wiem."})
        self.make(model).reply("kuba", "Jaka pogoda?")
        self.assertNotIn("check_online", {t["function"]["name"] for t in model.chosen[0]["tools"]})
        self.assertIn("internet: nie znasz aktualnej pogody", model.spoken[0]["messages"][0]["content"])

    def test_lookup_reaches_the_model_and_is_not_logged_as_a_change(self):
        model = ScriptedModel({"tool_calls": [tool_call("check_online", source="air")]}, {"content": "Powietrze jest dobre."})
        b = self.make(model, online=["air", "weather"])
        b.online.fetch = FakeNet({"gios": AIR})
        result = b.respond("kuba", "Jakie jest powietrze?")
        self.assertEqual(result, {"reply": "Powietrze jest dobre.", "actions": []})
        told = model.spoken[0]["messages"][0]["content"]
        self.assertIn("- Indeks jakości powietrza w Tarnobrzegu", told)   # he answers from the looked-up text
        self.assertIn("dane z zewnątrz: pogoda i ostrzeżenia, jakość powietrza na zewnątrz", told)


if __name__ == "__main__":
    unittest.main()
