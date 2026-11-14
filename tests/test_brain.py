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
        sent = model.spoken[0]["messages"]
        self.assertEqual(sent[0]["role"], "system")
        self.assertIn("Leci do Barcelony.", sent[0]["content"])
        self.assertEqual(len(sent), 1 + brain.WINDOW_KEEP + 1)

    def test_people_have_separate_threads(self):
        model = ScriptedModel({"content": "ok"}, {"content": "cześć"})
        b = make(self.tmp, model)
        b.reply("kuba", "sekret Kuby")
        b.reply("hubert", "cześć")
        self.assertNotIn("sekret Kuby", str(model.seen[2:]))   # neither step of Hubert's turn sees it

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

    def test_plain_talk_skips_the_tool_step(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = brain.Brain("http://unused", "test", PROMPT, os.path.join(tmp, "alan.db"))
            for text in ["Hej Alan, co słychać?", "Dobranoc", "Nudzi mi się", "Ale ty jesteś uparty"]:
                self.assertFalse(b.may_need_tools(text), text)
            for text in ["Ustaw minutnik na 5 minut", "Zapisz pomysł na rolkę", "Jaka jutro pogoda?", "Co mam dziś w kalendarzu",
                         "Opowiedz o swoim dziadku", "Jak poznałeś Vasca?", "Jestem w Las Palmas", "Dopisz mleko do listy"]:
                self.assertTrue(b.may_need_tools(text), text)
            model = ScriptedModel({"content": "Żyję. Ledwo."})
            b.chat = model
            self.assertEqual(b.reply("kuba", "Hej Alan, co słychać?"), "Żyję. Ledwo.")
            self.assertEqual(len(model.seen), 1)                     # one pass of the model, not two

    def test_household_file_is_part_of_what_he_knows(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = brain.Brain("http://unused", "test", PROMPT, os.path.join(tmp, "alan.db"))
            self.assertNotIn("DOMOWNICY: CO O NICH WIESZ", b.system("Kuba", ""))
            with open(os.path.join(tmp, "domownicy.md"), "w", encoding="utf-8") as f:
                f.write("# notatka dla edytującego\nHubert:\n- pije herbatę, nie kawę\n")
            text = b.system("Kuba", "")                    # read afresh: no restart needed
            self.assertIn("pije herbatę", text)
            self.assertNotIn("notatka dla edytującego", text)

    def test_inline_system_puts_instructions_in_the_user_message(self):
        model = ScriptedModel({"content": "ok"})
        make(self.tmp, model, inline_system=True).reply("kuba", "halo")
        sent = model.spoken[0]["messages"]
        self.assertEqual([m["role"] for m in sent], ["user"])
        self.assertIn("Jesteś Alan Sanches", sent[0]["content"])
        self.assertTrue(sent[0]["content"].endswith("── WIADOMOŚĆ OD KUBA ──\nhalo"))

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
        offered = {t["function"]["name"] for t in model.chosen[0]["tools"]}
        self.assertIn("set_timer", offered)          # his own tools are always there
        self.assertNotIn("set_light", offered)       # the flat's are not
        told = model.spoken[0]["messages"][0]["content"]
        self.assertIn("mieszkanie nie jest jeszcze podłączone", told)
        self.assertNotIn("CO ZROBIŁY NARZĘDZIA", told)   # nothing ran, so there is no report to answer to

    def test_choosing_tools_is_kept_apart_from_his_character(self):
        model = ScriptedModel({"content": "Cześć."})
        make(self.tmp, model, home=self.home).reply("kuba", "Cześć")
        choosing, speaking = model.chosen[0]["messages"][0]["content"], model.spoken[0]["messages"][0]["content"]
        self.assertIn("BRAK", choosing)
        self.assertNotIn("HUMOR", choosing)           # the short step carries no personality
        self.assertIn("HUMOR", speaking)
        self.assertIsNone(model.spoken[0]["tools"])   # and the speaking step cannot call anything

    def test_he_cannot_claim_an_action_no_tool_performed(self):
        model = ScriptedModel({"content": "Drzwi wejściowe otwarte."})
        b = make(self.tmp, model, home=self.home)
        self.assertEqual(b.reply("kuba", "Otwórz drzwi"), brain.NOT_DONE)
        self.assertEqual(len(model.chosen), 2)                      # the tools were asked a second time…
        self.assertIn("wywołaj je teraz", model.chosen[1]["messages"][0]["content"])   # …insistently
        self.assertEqual([r for _, r, _, _ in b.memory.recent("kuba")], ["user", "assistant"])

    def test_a_missed_tool_call_is_recovered_when_he_claims_the_action(self):
        calls = []

        def forgetful(messages, max_tokens, temperature, tools=None):
            calls.append(bool(tools))
            if tools:   # misses the request the first time, calls the tool when pressed
                pressed = "wywołaj je teraz" in messages[0]["content"]
                done = messages[-1]["role"] == "tool"
                return {"tool_calls": [tool_call("set_temperature", room="sypialnia", degrees=21)]} if pressed and not done else {"content": "BRAK"}
            return {"content": "Ustawione, dwadzieścia jeden stopni w sypialni."}

        b = make(self.tmp, forgetful, home=self.home)
        result = b.respond("kuba", "Ustaw w sypialni 21 stopni")
        self.assertEqual(result["actions"], [{"ok": True, "text": "ogrzewanie ustawione na 21°C w: sypialni"}])
        self.assertEqual(self.ha.STATES["climate.sypialnia"]["attributes"]["temperature"], 21)
        self.assertEqual(result["reply"], "Ustawione, dwadzieścia jeden stopni w sypialni.")

    def test_honest_and_factual_sentences_are_not_mistaken_for_claims(self):
        for fine in ("Drzwi nie są podłączone, więc ich nie otworzę.", "Tego nie zrobiłem.", "Nie włączyłem światła.",
                     "Stolicą Australii jest Canberra.", "Mogę ustawić minutnik, jeśli chcesz."):
            self.assertIsNone(brain.CLAIM.search(fine), fine)
        for claim in ("Drzwi wejściowe otwarte.", "Światło w salonie włączone na 30 procent.", "Ustawiłem 21 stopni.",
                      "Minutnik ustawiony.", "Zapamiętano."):
            self.assertIsNotNone(brain.CLAIM.search(claim), claim)

    def test_a_described_call_is_asked_for_again_as_a_real_one(self):
        model = ScriptedModel({"content": "[]"}, {"tool_calls": [tool_call("set_light", room="salon", on=True)]},
                              {"content": "Światło włączone."})
        model.queue[0] = {"content": "Należy wywołać set_light dla salonu."}
        original = model.__call__

        def talkative(messages, max_tokens, temperature, tools=None):
            if tools and model.queue and not model.queue[0].get("tool_calls") and len(model.chosen) == 0:
                model.seen.append({"messages": messages, "tools": tools})
                return model.queue.pop(0)
            return original(messages, max_tokens, temperature, tools)

        b = make(self.tmp, talkative, home=self.home)
        self.assertEqual(b.respond("kuba", "Włącz światło w salonie")["actions"], [{"ok": True, "text": "światło włączone w: salonie"}])
        self.assertEqual(self.ha.STATES["light.salon"]["state"], "on")

    def test_tool_choice_sees_only_the_message_it_acts_on(self):
        model = ScriptedModel({"content": "Dobrze."}, {"content": "Jasne."})
        b = make(self.tmp, model, home=self.home)
        b.reply("kuba", "Zimno mi w salonie")
        b.reply("kuba", "A w sypialni?")
        sent = model.chosen[1]["messages"]
        self.assertEqual([m["role"] for m in sent], ["system", "user"])       # no assistant turns to imitate
        self.assertEqual(sent[1]["content"], "Ostatnia wiadomość:\nA w sypialni?")
        self.assertNotIn("Zimno mi w salonie", str(sent))   # an earlier request cannot be carried out a turn late
        self.assertNotIn("Dobrze.", str(sent))

    def test_what_the_tools_did_is_put_in_front_of_him_when_he_speaks(self):
        model = ScriptedModel({"tool_calls": [tool_call("set_light", room="salon", on=True),
                                              tool_call("set_temperature", room="salon", degrees=40)]},
                              {"content": "Światło włączone. Czterdziestu stopni nie ustawię."})
        make(self.tmp, model, home=self.home).reply("kuba", "Światło i 40 stopni w salonie")
        told = model.spoken[0]["messages"][0]["content"]
        self.assertIn("- Wykonano: światło włączone w: salonie.", told)
        self.assertIn("- Błąd: temperatura musi być między 5 a 28 stopni. Niczego nie zmieniono.", told)
        self.assertNotIn("niczego nie włączyłeś", told)

    def test_tool_call_is_executed_and_result_returned_to_the_model(self):
        model = ScriptedModel({"content": None, "tool_calls": [tool_call("set_light", room="salon", on=True)]},
                              {"content": "Światło w salonie włączone."})
        answer = make(self.tmp, model, home=self.home).reply("kuba", "Włącz światło w salonie")
        self.assertEqual(answer, "Światło w salonie włączone.")
        self.assertEqual(self.ha.STATES["light.salon"]["state"], "on")
        second = model.seen[1]["messages"]
        self.assertEqual([m["role"] for m in second[-2:]], ["assistant", "tool"])
        self.assertIn("Wykonano", second[-1]["content"])
        self.assertLessEqual({"set_light", "set_temperature", "get_home_state", "set_timer", "edit_list"},
                             {t["function"]["name"] for t in model.seen[0]["tools"]})

    def test_actions_are_reported_for_the_screen(self):
        model = ScriptedModel({"tool_calls": [tool_call("set_light", room="salon", on=True, brightness=30),
                                              tool_call("set_temperature", room="salon", degrees=40),
                                              tool_call("get_home_state")]},
                              {"content": "Światło włączone, ale czterdziestu stopni nie ustawię."})
        result = make(self.tmp, model, home=self.home).respond("kuba", "Światło i 40 stopni")
        self.assertEqual(result["actions"], [
            {"ok": True, "text": "światło włączone w: salonie, jasność 30%"},
            {"ok": False, "text": "temperatura musi być między 5 a 28 stopni. Niczego nie zmieniono"},
        ])  # reading the state is not listed as a change

    def test_tool_calls_written_as_text_are_still_carried_out(self):
        written = '[TOOL_CALLS][{"name": "set_light", "arguments": {"room": "salon", "on": true}}]'
        model = ScriptedModel({"content": written}, {"content": "Światło włączone."})
        result = make(self.tmp, model, home=self.home).respond("kuba", "Włącz światło w salonie")
        self.assertEqual(result["reply"], "Światło włączone.")
        self.assertEqual(self.ha.STATES["light.salon"]["state"], "on")
        call = model.seen[1]["messages"][-2]["tool_calls"][0]
        self.assertEqual((len(call["id"]), model.seen[1]["messages"][-2]["content"]), (9, ""))

    def test_ordinary_text_is_not_mistaken_for_a_tool_call(self):
        for text in ("[żart] Dobrze.", '[{"name": "open_door", "arguments": {}}]', "[1, 2, 3]", "", None):
            self.assertEqual(brain.Brain.written_calls(text), [], text)

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


class OwnTools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_own_tool_call_is_carried_out_and_reported(self):
        model = ScriptedModel({"tool_calls": [tool_call("set_timer", minutes=12, label="makaron")]},
                              {"content": "Dwanaście minut, makaron."})
        b = make(self.tmp, model)
        result = b.respond("kuba", "Minutnik na 12 minut, makaron")
        self.assertEqual(result["actions"], [{"ok": True, "text": "minutnik nr 1 na 12 min (makaron)"}])
        self.assertEqual(b.own.agenda()["timers"][0]["label"], "makaron")

    def test_reading_a_list_is_not_reported_as_a_change(self):
        model = ScriptedModel({"tool_calls": [tool_call("edit_list")]}, {"content": "Lista jest pusta."})
        self.assertEqual(make(self.tmp, model).respond("kuba", "Co na liście?")["actions"], [])

    def test_remembered_facts_reach_the_model_for_that_person_only(self):
        b = make(self.tmp, ScriptedModel())
        b.own.remember("kuba", "Kuba ma uczulenie na orzechy.")
        self.assertIn("- Kuba ma uczulenie na orzechy.", b.system("kuba", ""))
        self.assertNotIn("orzechy", b.system("hubert", ""))

    def test_server_without_tool_support_falls_back_to_talking(self):
        import urllib.error

        calls = []

        def no_tools(messages, max_tokens, temperature, tools=None):
            calls.append(tools)
            if tools:
                raise urllib.error.HTTPError("http://x", 400, "does not support tools", {}, None)
            return {"content": "Cześć."}

        b = make(self.tmp, no_tools)
        self.assertEqual(b.reply("kuba", "ustaw minutnik"), "Cześć.")
        self.assertEqual(b.reply("kuba", "ustaw minutnik"), "Cześć.")
        self.assertEqual([bool(c) for c in calls], [True, False, False])   # asked once, then stopped offering


if __name__ == "__main__":
    unittest.main()
