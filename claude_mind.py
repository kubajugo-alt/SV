"""ALAN's mind on Claude, through the Anthropic API.

The same character, memory and tools as the local mind in brain.py, but one
call does what the local model needed two passes for: Claude keeps the
character and calls tools in the same turn. The long, unchanging part of his
instructions is cached between turns.

What leaves the machine with this mind: his instructions (including the
household file), the recent conversation and notes, and tool results. The
memory itself (SQLite) stays here.

Needs `pip install anthropic` and a key: the file anthropic.key in the data
folder, or ANTHROPIC_API_KEY, or an `ant auth login` profile.
"""

import json
import threading
import time

import anthropic

from brain import Brain

MAX_TOOL_ROUNDS = 5
REFUSED = "Tego tematu nie ruszę. Zapytaj mnie o coś innego."
VOICE = ("Twoja odpowiedź zostanie wypowiedziana na głos: zwykle jedno do trzech zdań, bez list, nagłówków i znaczników. "
         "Narzędzi używaj, gdy są potrzebne; ich wyniki masz od razu w tej samej rozmowie.")


class ClaudeBrain(Brain):
    def __init__(self, model, prompt_path, db_path, home=None, online=(), wiki=None, diary=None, key=None, effort="low", client=None):
        super().__init__("https://api.anthropic.com", model, prompt_path, db_path, False, home, online, wiki, diary)
        self.client = client or (anthropic.Anthropic(api_key=key.strip()) if key else anthropic.Anthropic())
        self.effort = effort
        # The same tools, in the shape the Messages API takes.
        self.claude_tools = [{"name": t["function"]["name"], "description": t["function"]["description"],
                              "input_schema": t["function"]["parameters"]} for t in self.tools]
        self.name = f"{model} (Claude, effort {effort})"

    # --- his instructions: the unchanging part first, so it is cached ---------------
    def stable(self):
        parts = [self.prompt, VOICE]
        if household := self.household():
            parts += ["── DOMOWNICY: CO O NICH WIESZ ──", household,
                      "Korzystaj z tej wiedzy naturalnie, bez recytowania. Spraw jednego domownika nie opowiadaj gościom."]
        if not self.home:
            parts += ["── GDZIE TERAZ MIESZKASZ ──",
                      "Na razie mieszkasz w laptopie, nie w mieszkaniu: nie masz czujników, kamer ani urządzeń. Niczego nie mierzysz "
                      "i niczym nie sterujesz, i nie udajesz, że jest inaczej."]
        if self.past:
            parts.append("O swojej przeszłości opowiadasz na podstawie narzędzia recall_past: wywołaj je, gdy ktoś pyta o twoje życie, "
                         "ludzi, których znałeś, albo wydarzenia z Lizbony i Gran Canarii.")
        return "\n".join(parts)

    def changing(self, person, notes):
        parts = ["── TERAZ ──", self.moment(person), self.abilities()]
        if facts := self.own.facts(person):
            parts += [f"── ZAPAMIĘTANE NA PROŚBĘ ({person.upper()}) ──", "\n".join(f"- {f}" for f in facts)]
        if notes:
            parts += [f"── PAMIĘĆ: CO WIESZ O {person.upper()} Z WCZEŚNIEJSZYCH ROZMÓW ──", notes]
        return "\n".join(parts)

    def system_blocks(self, person, notes):
        return [{"type": "text", "text": self.stable(), "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": self.changing(person, notes)}]

    # --- one round trip ---------------------------------------------------------------
    def ask(self, system, messages, tools=None, max_tokens=4000):
        request = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": messages,
                   "output_config": {"effort": self.effort}}
        if tools:
            request["tools"] = tools
        # If a safety classifier declines the request, the API re-runs it on a fallback model
        # in the same call instead of leaving him without an answer.
        return self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **request)

    @staticmethod
    def text_of(response):
        return " ".join(block.text for block in response.content if block.type == "text").strip()

    # --- a turn -----------------------------------------------------------------------
    def converse(self, person, history, said, system):
        """Run the turn, tools included. -> (what he says, tool results, actions for the screen)"""
        messages = history + [{"role": "user", "content": said}]
        results, actions = [], []
        for _ in range(MAX_TOOL_ROUNDS + 1):
            response = self.ask(system, messages, self.claude_tools)
            if response.stop_reason == "refusal":
                return REFUSED, results, actions
            calls = [block for block in response.content if block.type == "tool_use"]
            if response.stop_reason != "tool_use" or not calls:
                return self.clean(self.text_of(response)), results, actions
            messages.append({"role": "assistant", "content": response.content})   # unchanged, thinking included
            answers = []
            for call in calls:
                result = self.run_tool(person, call.name, dict(call.input or {}))
                print(f"Tool: {call.name}({json.dumps(call.input, ensure_ascii=False)}) -> {result}", flush=True)
                results.append(result)
                if result.startswith(("Wykonano", "Błąd")):                       # reading something is not a change
                    actions.append({"ok": result.startswith("Wykonano"), "text": result.split(": ", 1)[-1].rstrip(".")})
                answers.append({"type": "tool_result", "tool_use_id": call.id, "content": result,
                                **({"is_error": True} if result.startswith("Błąd") else {})})
            messages.append({"role": "user", "content": answers})                 # all results in one message
        return self.clean(self.text_of(response)), results, actions

    def respond(self, person, text):
        notes, _ = self.memory.notes(person)
        history = [{"role": role, "content": content} for _, role, content, _ in self.memory.recent(person)]
        started = time.monotonic()
        try:
            answer, _, actions = self.converse(person, history, text, self.system_blocks(person, notes))
        except anthropic.APIStatusError as err:
            print(f"Claude answered {err.status_code}: {err.message}", flush=True)
            raise
        print(f"Timing: Claude {time.monotonic() - started:.1f} s", flush=True)
        if not answer:
            raise RuntimeError("the model returned an empty answer")
        self.memory.add(person, "user", text)
        self.memory.add(person, "assistant", answer)
        threading.Thread(target=self.fold, args=(person,), daemon=True).start()
        return {"reply": answer, "actions": actions}

    # --- used by the parts shared with the local mind (speaking first, folding notes) ---
    def complete(self, messages, max_tokens, temperature):
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        rest = [m for m in messages if m["role"] != "system"]
        response = self.ask(system or anthropic.NOT_GIVEN, rest, max_tokens=max(max_tokens * 4, 2000))
        return "" if response.stop_reason == "refusal" else self.text_of(response)

    def keep_warm(self):
        """Nothing to keep in memory: the model is not on this machine."""
