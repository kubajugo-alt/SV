import os
import tempfile
import time
import unittest

from tests.support import ROOT, ScriptedModel, start_mock_ha, tool_call

import brain
import home

PROMPT = os.path.join(ROOT, "prompts", "system.pl.txt")


def make(tmp, model, **kwargs):
    b = brain.Brain("http://unused", "test", PROMPT, os.path.join(tmp, "alan.db"), **kwargs)
    b.chat = model
    return b


def settle(b):
    """Wait for a background notes rewrite, if one was started."""
    time.sleep(0.05)
    with b.folding:
        pass


class Memory(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def talk(self, b, person, n):
        for i in range(n):
            b.chat.queue.append({"content": f"odpowiedź {i}"})
            b.chat.queue.append({"content": "Lubi herbatę.\nLeci do Barcelony."})  # used only if a fold happens
            b.reply(person, f"wiadomość {i}")
            settle(b)

    def test_old_turns_fold_into_notes_and_nothing_is_lost(self):
        b = make(self.tmp, ScriptedModel())
        self.talk(b, "kuba", 13)  # 26 turns > WINDOW_MAX
        notes, upto = b.memory.notes("kuba")
        recent = b.memory.recent("kuba")
        self.assertIn("Barcelony", notes)
        self.assertEqual(len(recent), brain.WINDOW_KEEP)
        self.assertEqual(recent[0][0], upto + 1)  # window starts right after what the notes cover

    def test_notes_reach_the_model_after_a_restart(self):
        self.talk(make(self.tmp, ScriptedModel()), "kuba", 13)
        model = ScriptedModel({"content": "Do Barcelony."})
        make(self.tmp, model).reply("kuba", "Dokąd lecę?")
        sent = model.seen[0]["messages"]
        self.assertEqual(sent[0]["role"], "system")
        self.assertIn("Leci do Barcelony.", sent[0]["content"])
        self.assertEqual(len(sent), 1 + brain.WINDOW_KEEP + 1)

    def test_people_have_separate_threads(self):
        model = ScriptedModel({"content": "ok"}, {"content": "cześć"})
        b = make(self.tmp, model)
        b.reply("kuba", "sekret Kuby")
        b.reply("hubert", "cześć")
        self.assertNotIn("sekret Kuby", str(model.seen[1]["messages"]))

    def test_failed_model_call_stores_nothing(self):
        def broken(*args, **kwargs):
            raise OSError("model down")

        b = make(self.tmp, broken)
        with self.assertRaises(OSError):
            b.reply("kuba", "halo")
        self.assertEqual(b.memory.recent("kuba"), [])

    def test_answer_is_cleaned_for_speech(self):
        b = make(self.tmp, ScriptedModel({"content": "ALAN: **Dobrze.**\n\n  Zrobione."}))
        self.assertEqual(b.reply("kuba", "x"), "Dobrze. Zrobione.")

    def test_inline_system_puts_instructions_in_the_user_message(self):
        model = ScriptedModel({"content": "ok"})
        make(self.tmp, model, inline_system=True).reply("kuba", "halo")
        sent = model.seen[0]["messages"]
        self.assertEqual([m["role"] for m in sent], ["user"])
        self.assertIn("Jesteś ALAN", sent[0]["content"])
        self.assertTrue(sent[0]["content"].endswith("halo"))

    def test_context_carries_date_and_calendar(self):
        system = make(self.tmp, ScriptedModel()).system("kuba", "")
        self.assertIn("Najbliższe dni:", system)
        self.assertEqual(system.split("Najbliższe dni:")[1].split(". Daty")[0].count(","), 13)


class Tools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.ha, self.server, url = start_mock_ha()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.home = home.Home(url, "token", f"{ROOT}/home.json")

    def test_without_home_he_is_told_nothing_is_connected(self):
        model = ScriptedModel({"content": "Jeszcze tego nie potrafię."})
        make(self.tmp, model).reply("kuba", "Włącz światło")
        self.assertIsNone(model.seen[0]["tools"])
        self.assertIn("nie są jeszcze podłączone", model.seen[0]["messages"][0]["content"])

    def test_tool_call_is_executed_and_result_returned_to_the_model(self):
        model = ScriptedModel({"content": None, "tool_calls": [tool_call("set_light", room="salon", on=True)]},
                              {"content": "Światło w salonie włączone."})
        answer = make(self.tmp, model, home=self.home).reply("kuba", "Włącz światło w salonie")
        self.assertEqual(answer, "Światło w salonie włączone.")
        self.assertEqual(self.ha.STATES["light.salon"]["state"], "on")
        second = model.seen[1]["messages"]
        self.assertEqual([m["role"] for m in second[-2:]], ["assistant", "tool"])
        self.assertIn("Wykonano", second[-1]["content"])
        self.assertEqual({t["function"]["name"] for t in model.seen[0]["tools"]},
                         {"set_light", "set_temperature", "get_home_state"})

    def test_refused_action_is_reported_to_the_model(self):
        model = ScriptedModel({"tool_calls": [tool_call("set_temperature", room="salon", degrees=40)]},
                              {"content": "Czterdziestu stopni nie ustawię."})
        make(self.tmp, model, home=self.home).reply("kuba", "Ustaw 40 stopni")
        self.assertTrue(model.seen[1]["messages"][-1]["content"].startswith("Błąd"))
        self.assertEqual(self.ha.STATES["climate.salon"]["attributes"]["temperature"], 21.0)

    def test_tool_rounds_are_limited(self):
        loop = {"tool_calls": [tool_call("get_home_state")]}
        model = ScriptedModel(*[loop] * brain.MAX_TOOL_ROUNDS, {"content": "Dość."})
        self.assertEqual(make(self.tmp, model, home=self.home).reply("kuba", "pętla"), "Dość.")
        self.assertIsNone(model.seen[-1]["tools"])  # the last call no longer offers tools

    def test_only_words_are_remembered_not_tool_traffic(self):
        model = ScriptedModel({"tool_calls": [tool_call("get_home_state")]}, {"content": "Dwadzieścia jeden i pół."})
        b = make(self.tmp, model, home=self.home)
        b.reply("kuba", "Ile jest w salonie?")
        self.assertEqual([role for _, role, _, _ in b.memory.recent("kuba")], ["user", "assistant"])


if __name__ == "__main__":
    unittest.main()
