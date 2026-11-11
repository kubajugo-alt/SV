import functools
import io
import json
import struct
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer

from tests.support import ROOT, start_mock_ha

import home
import serve


def wav_bytes(seconds=0.2, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * int(seconds * rate))
    return buf.getvalue()


class FakeVoice:
    name = "fake"

    def wav(self, text):
        return wav_bytes()


class FakeEars:
    name = "fake"

    def text(self, audio):
        serve.Whisper.samples(audio)  # the real decoder: rejects anything that is not 16-bit WAV
        return "dzień dobry"


class FakeBrain:
    name = "fake"

    home = None

    def respond(self, person, text):
        if text == "boom":
            raise OSError("model down")
        return {"reply": f"{person}: {text}", "actions": []}


class Server(unittest.TestCase):
    def setUp(self):
        serve.engine, serve.ears, serve.brain = None, None, None
        serve.synthesise.cache_clear()
        handler = functools.partial(serve.Handler, directory=serve.ROOT)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def request(self, path, data=None):
        try:
            with urllib.request.urlopen(urllib.request.Request(self.url + path, data), timeout=10) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as err:
            return err.code, b""

    def test_page_is_served_and_nothing_outside_it(self):
        status, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>ALAN</title>", body)
        self.assertEqual(self.request("/js/main.js")[0], 200)
        self.assertEqual(self.request("/../serve.py")[0], 404)

    def test_everything_answers_503_or_works_without_engines(self):
        self.assertEqual(self.request("/tts?text=hej")[0], 503)
        self.assertEqual(self.request("/stt", wav_bytes())[0], 503)
        self.assertEqual(self.request("/chat", b'{"text": "hej"}')[0], 503)

    def test_tts(self):
        serve.engine = FakeVoice()
        status, body = self.request("/tts?text=Dzie%C5%84%20dobry")
        self.assertEqual((status, body[:4]), (200, b"RIFF"))
        self.assertEqual(self.request("/tts?text=")[0], 400)
        self.assertEqual(self.request("/tts?text=" + "a" * (serve.MAX_CHARS + 1))[0], 400)

    def test_stt(self):
        serve.ears = FakeEars()
        status, body = self.request("/stt", wav_bytes())
        self.assertEqual((status, json.loads(body)), (200, {"text": "dzień dobry"}))
        self.assertEqual(self.request("/stt", b"not audio at all")[0], 400)
        self.assertEqual(self.request("/stt", b"")[0], 400)

    def test_recordings_are_resampled_to_16k_mono(self):
        self.assertEqual(len(serve.Whisper.samples(wav_bytes(1.0, 48000))), 16000)

    def test_chat(self):
        serve.brain = FakeBrain()
        status, body = self.request("/chat", json.dumps({"text": "cześć", "person": "Hubert"}).encode())
        self.assertEqual((status, json.loads(body)), (200, {"reply": "hubert: cześć", "actions": []}))
        for bad in (b"{}", b'{"text": ""}', b"nonsense", b'{"text": "x", "person": "../etc"}'):
            self.assertEqual(self.request("/chat", bad)[0], 400, bad)
        self.assertEqual(self.request("/chat", b'{"text": "boom"}')[0], 502)
        self.assertEqual(self.request("/nothing", b"{}")[0], 404)

    def test_home_state_for_the_panel(self):
        self.assertEqual(self.request("/home")[0], 503)
        ha, server, url = start_mock_ha()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        serve.brain = FakeBrain()
        serve.brain.home = home.Home(url, "token", f"{ROOT}/home.json")
        serve.brain.home.call("set_light", {"room": "salon", "on": True, "brightness": 30})
        status, body = self.request("/home")
        snap = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(snap["rooms"]["salon"], {"temp": 21.5, "hum": 44.0, "light": {"on": True, "pct": 30}, "heating": 21.0})
        self.assertEqual(snap["rooms"]["lazienka"], {"temp": 23.0, "hum": 58.0})
        self.assertEqual(snap["presence"], {"Kuba": True, "Hubert": True})
        server.shutdown()
        server.server_close()
        self.assertEqual(self.request("/home")[0], 502)

    def test_sentences_are_grouped_for_the_voice(self):
        parts = serve.Chatterbox.split("Dzień dobry. Jestem ALAN. " + "To jest dłuższe zdanie testowe. " * 12)
        self.assertTrue(parts[0].startswith("Dzień dobry. Jestem ALAN. To jest"))
        self.assertTrue(all(len(p) <= 240 for p in parts))
        self.assertEqual(" ".join(parts).split(), ("Dzień dobry. Jestem ALAN. " + "To jest dłuższe zdanie testowe. " * 12).split())


if __name__ == "__main__":
    unittest.main()
