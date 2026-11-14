import os
import tempfile
import unittest
from types import SimpleNamespace as NS

from tests.support import ROOT

try:
    from claude_mind import REFUSED, ClaudeBrain
except ImportError:                      # the anthropic package is not installed
    ClaudeBrain = None

PROMPT = os.path.join(ROOT, "prompts", "system.pl.txt")


def text(words):
    return NS(type="text", text=words)


def call(name, **arguments):
    return NS(type="tool_use", id="toolu_" + name, name=name, input=arguments)


class FakeClaude:
    """Stands in for the Anthropic client: replays queued responses and records the requests."""

    def __init__(self, *responses):
        self.queue, self.seen = list(responses), []
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **request):
        self.seen.append(request)
        content, stop = self.queue.pop(0)
        return NS(content=content, stop_reason=stop)


@unittest.skipUnless(ClaudeBrain, "anthropic is not installed")
class Claude(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def mind(self, *responses):
        self.client = FakeClaude(*responses)
        return ClaudeBrain("claude-opus-5-5", PROMPT, os.path.join(self.tmp.name, "alan.db"), client=self.client)

    def test_plain_talk_is_one_call_with_his_character_cached(self):
        b = self.mind(([NS(type="thinking", thinking=""), text("Żyję. Ledwo.")], "end_turn"))
        self.assertEqual(b.respond("kuba", "Co słychać?"), {"reply": "Żyję. Ledwo.", "actions": []})
        request = self.client.seen[0]
        self.assertEqual(len(self.client.seen), 1)
        self.assertEqual(request["model"], "claude-opus-5-5")
        self.assertEqual(request["output_config"], {"effort": "low"})
        self.assertEqual(request["fallbacks"], "default")
        stable, changing = request["system"]
        self.assertIn("Jesteś Alan Sanches", stable["text"])
        self.assertEqual(stable["cache_control"], {"type": "ephemeral"})
        self.assertNotIn("Jest ", stable["text"][:40])
        self.assertIn("── TERAZ ──", changing["text"])               # the clock sits after the cached part
        self.assertNotIn("cache_control", changing)
        self.assertIn("take_note", [t["name"] for t in request["tools"]])
        self.assertEqual(request["messages"], [{"role": "user", "content": "Co słychać?"}])
        self.assertEqual([r for _, r, _, _ in b.memory.recent("kuba")], ["user", "assistant"])

    def test_a_tool_is_run_and_its_result_goes_back_in_one_message(self):
        thinking = NS(type="thinking", thinking="", signature="sig")
        b = self.mind(([thinking, call("take_note", text="Ślimaki w sosie szarym"), call("set_timer", minutes=2)], "tool_use"),
                      ([text("Zapisane, a minutnik tyka.")], "end_turn"))
        out = b.respond("kuba", "Zapisz pomysł: ślimaki w sosie szarym. I minutnik na dwie minuty.")
        self.assertEqual(out["reply"], "Zapisane, a minutnik tyka.")
        self.assertEqual([a["ok"] for a in out["actions"]], [True, True])
        self.assertIn("Ślimaki", b.own.find_notes("kuba"))
        second = self.client.seen[1]["messages"]
        self.assertIs(second[1]["content"][0], thinking)               # his turn is passed back unchanged
        results = second[2]["content"]
        self.assertEqual([r["tool_use_id"] for r in results], ["toolu_take_note", "toolu_set_timer"])
        self.assertTrue(all(r["type"] == "tool_result" for r in results))

    def test_a_failed_tool_is_marked_and_a_refusal_is_spoken_plainly(self):
        b = self.mind(([call("set_place", place="Ułan Bator")], "tool_use"), ([text("Nie wiem, gdzie to jest.")], "end_turn"),
                      ([], "refusal"))
        out = b.respond("kuba", "Jestem w Ułan Bator")
        self.assertEqual(out["actions"][0]["ok"], False)
        self.assertTrue(self.client.seen[1]["messages"][2]["content"][0]["is_error"])
        self.assertEqual(b.respond("kuba", "coś, czego nie wolno")["reply"], REFUSED)

    def test_he_can_speak_first_through_claude_too(self):
        b = self.mind(([text("Cisza jak w księgarni w poniedziałek.")], "end_turn"))
        self.assertEqual(b.nudge("kuba", "idle")["reply"], "Cisza jak w księgarni w poniedziałek.")
        request = self.client.seen[0]
        self.assertIn("Jesteś Alan Sanches", request["system"])
        self.assertIn("To nie jest wiadomość od domownika", request["messages"][-1]["content"])
