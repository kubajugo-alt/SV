import unittest

from tests.support import ROOT, start_mock_ha

import home


class HomeTools(unittest.TestCase):
    def setUp(self):
        self.ha, self.server, url = start_mock_ha()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.home = home.Home(url, "token", f"{ROOT}/home.json")

    def test_light_on_with_brightness(self):
        result = self.home.call("set_light", '{"room": "Salon", "on": true, "brightness": 60}')
        self.assertIn("Wykonano", result)
        self.assertEqual(self.ha.STATES["light.salon"]["state"], "on")
        self.assertEqual(self.ha.STATES["light.salon"]["attributes"]["brightness"], 153)

    def test_room_names_are_forgiving(self):
        self.assertIn("Wykonano", self.home.call("set_light", {"room": " Przedpokój", "on": False}))
        self.assertEqual(self.ha.STATES["light.przedpokoj"]["state"], "off")
        self.assertIn("Wykonano", self.home.call("set_light", {"room": "korytarz", "on": True}))
        self.assertEqual(self.ha.STATES["light.przedpokoj"]["state"], "on")

    def test_all_rooms(self):
        self.home.call("set_light", {"room": "wszystkie", "on": True})
        self.assertTrue(all(self.ha.STATES[e]["state"] == "on" for e in self.home.map["lights"].values()))

    def test_room_without_a_light_changes_nothing(self):
        before = {k: dict(v) for k, v in self.ha.STATES.items()}
        result = self.home.call("set_light", {"room": "kuchnia", "on": True})
        self.assertTrue(result.startswith("Błąd"))
        self.assertEqual(before, self.ha.STATES)

    def test_temperature_is_set_and_limited(self):
        self.assertIn("Wykonano", self.home.call("set_temperature", {"room": "sypialnia", "degrees": 20.5}))
        self.assertEqual(self.ha.STATES["climate.sypialnia"]["attributes"]["temperature"], 20.5)
        for degrees in (35, 2):
            self.assertTrue(self.home.call("set_temperature", {"room": "salon", "degrees": degrees}).startswith("Błąd"))
        self.assertEqual(self.ha.STATES["climate.salon"]["attributes"]["temperature"], 21.0)

    def test_state_reads_live_values(self):
        self.home.call("set_light", {"room": "salon", "on": True, "brightness": 30})
        state = self.home.call("get_home_state", {})
        self.assertIn("W salonie: 21.5°C, wilgotność 44%, światło włączone (30%)", state)
        self.assertIn("W domu: Kuba, Hubert.", state)

    def test_no_tool_for_doors(self):
        self.assertTrue(self.home.call("open_door", {}).startswith("Błąd"))
        self.assertNotIn("door", " ".join(t["function"]["name"] for t in home.TOOLS))

    def test_bad_arguments_and_dead_server_become_sentences(self):
        self.assertTrue(self.home.call("set_light", '{"room": "salon"}').startswith("Błąd"))
        self.assertTrue(self.home.call("set_light", "not json").startswith("Błąd"))
        dead = home.Home("http://127.0.0.1:9", "token", f"{ROOT}/home.json")
        self.assertIn("nie odpowiada", dead.call("set_light", {"room": "salon", "on": True}))


if __name__ == "__main__":
    unittest.main()
