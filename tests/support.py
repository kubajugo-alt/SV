"""Shared test fixtures: a mock Home Assistant and a scripted language model."""

import importlib.util
import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def load_mock_ha():
    spec = importlib.util.spec_from_file_location("mock_ha", os.path.join(ROOT, "scripts", "mock_ha.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def start_mock_ha():
    """Fresh mock Home Assistant on a free port -> (module, server, url)."""
    module = load_mock_ha()
    server = ThreadingHTTPServer(("127.0.0.1", 0), module.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return module, server, f"http://127.0.0.1:{server.server_address[1]}"


def tool_call(name, **arguments):
    return {"id": "call_1", "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


class ScriptedModel:
    """Stands in for Brain.chat: replays queued messages and records what it was sent."""

    def __init__(self, *messages):
        self.queue = list(messages)
        self.seen = []

    def __call__(self, messages, max_tokens, temperature, tools=None):
        self.seen.append({"messages": json.loads(json.dumps(messages)), "tools": tools})
        # A turn has two steps. The tool-choosing step (tools offered) takes the
        # next queued message only if it is a tool call; otherwise it answers
        # "no tool needed" and leaves the queue for the speaking step.
        if tools and not (self.queue and (self.queue[0].get("tool_calls") or str(self.queue[0].get("content")).startswith("["))):
            return {"content": "BRAK"}
        return self.queue.pop(0)

    @property
    def spoken(self):
        """The calls of the speaking step (no tools offered), in order."""
        return [s for s in self.seen if not s["tools"]]

    @property
    def chosen(self):
        """The calls of the tool-choosing step."""
        return [s for s in self.seen if s["tools"]]
