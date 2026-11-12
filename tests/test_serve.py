import functools
import io
import json
import os
import struct
import tempfile
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

    said = "dzień dobry"

    def text(self, audio, seconds=0):
        serve.Whisper.samples(audio)  # the real decoder: rejects anything that is not 16-bit WAV
        return self.said


class FakeBrain:
    name = "fake"

    home = None

    class own:
        @staticmethod
        def agenda():
            return {"say": ["Minutnik: czas minął."], "timers": [], "reminders": []}

    def respond(self, person, text):
        if text == "boom":
            raise OSError("model down")
        return {"reply": f"{person}: {text}", "actions": []}


class Server(unittest.TestCase):
    def setUp(self):
        serve.engine, serve.ears, serve.brain, serve.rhubarb, serve.lipsync = None, None, None, "", "rhubarb"
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

    def test_tts_carries_mouth_cues_when_rhubarb_is_there(self):
        serve.engine = FakeVoice()
        with urllib.request.urlopen(self.url + "/tts?text=hej", timeout=10) as r:
            self.assertIsNone(r.headers["X-Mouth-Cues"])            # no Rhubarb: the page goes by loudness
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "rhubarb")
            with open(fake, "w") as f:                               # stands in for the real binary
                f.write('#!/bin/sh\ntest "$1" = --version && exit 0\ntest -s "$8" || exit 1\n'
                        'echo \'{"mouthCues":[{"start":0.0,"end":0.21,"value":"X"},{"start":0.214,"end":0.5,"value":"D"}]}\'\n')
            os.chmod(fake, 0o755)
            serve.rhubarb = serve.find_rhubarb(fake)
            serve.synthesise.cache_clear()
            with urllib.request.urlopen(self.url + "/tts?text=hej", timeout=10) as r:
                self.assertEqual(json.loads(r.headers["X-Mouth-Cues"]), [[0.0, "X"], [0.21, "D"]])
            serve.rhubarb = os.path.join(tmp, "missing")             # a broken Rhubarb must not cost him his voice
            serve.synthesise.cache_clear()
            with urllib.request.urlopen(self.url + "/tts?text=hej", timeout=10) as r:
                self.assertEqual((r.status, r.headers["X-Mouth-Cues"]), (200, None))

    def test_lip_sync_from_word_timing(self):
        self.assertEqual(serve.shapes_of("Dzień"), [("B", 1), ("C", 2), ("B", 1)])       # dz-e-ń: the i only softens
        self.assertEqual([s for s, _ in serve.shapes_of("mała szuflada")], list("ADFDBFBCDBD"))
        cues = serve.cues_from_words([(0.2, 0.5, " Mam"), (0.5, 0.8, " psa."), (1.5, 1.7, " O!")])
        self.assertEqual(cues, [[0.0, "X"], [0.2, "A"], [0.28, "D"], [0.43, "A"], [0.57, "B"], [0.65, "D"],
                                [0.8, "X"], [1.5, "E"], [1.7, "X"]])
        self.assertEqual([s for _, s in serve.cues_from_words([(0.0, 0.5, " 21")])], list("XCBCBCBX"))   # numbers still move
        serve.engine, serve.ears, serve.lipsync = FakeVoice(), FakeEars(), "words"
        FakeEars.words = lambda self, audio: [(0.0, 0.3, "tak")]
        self.addCleanup(lambda: delattr(FakeEars, "words"))
        with urllib.request.urlopen(self.url + "/tts?text=tak", timeout=10) as r:
            self.assertEqual(json.loads(r.headers["X-Mouth-Cues"]), [[0.0, "X"], [0.0, "B"], [0.07, "D"], [0.22, "B"], [0.3, "X"]])

    def test_elevenlabs_voice_and_its_local_fallback(self):
        calls = []

        class Answer:
            def __init__(self, data): self.data = data
            def read(self): return self.data
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def cloud(request, timeout=0):
            calls.append((request.full_url, json.loads(request.data), dict(request.header_items())))
            if "pcm" in request.full_url and len(calls) == 3:
                raise serve.urllib.error.HTTPError(request.full_url, 403, "no pcm on this plan", {}, None)
            if len(calls) >= 5:
                raise OSError("offline")
            return Answer(b"ID3mp3" if "mp3" in request.full_url else b"\x00\x00" * 2400)

        real, serve.urllib.request.urlopen = serve.urllib.request.urlopen, cloud
        self.addCleanup(setattr, serve.urllib.request, "urlopen", real)
        with self.assertRaises(ValueError):
            serve.ElevenLabs("", None, "eleven_v4", "pl")
        voice = serve.ElevenLabs(" key ", None, "eleven_flash_v2_5", "pl", fallback=FakeVoice)
        self.assertEqual(voice.wav("Cześć, tu ALAN.")[:4], b"RIFF")
        url, body, headers = calls[0]
        self.assertIn(serve.ElevenLabs.ROGER + "?output_format=pcm_24000", url)
        self.assertEqual(body, {"text": "Cześć, tu Alan.", "model_id": "eleven_flash_v2_5", "language_code": "pl"})
        self.assertEqual(headers["Xi-api-key"], "key")
        voice.model = "eleven_v4"
        voice.wav("raz")
        self.assertNotIn("language_code", calls[1][1])
        self.assertEqual(voice.wav("bez pcm"), b"ID3mp3")                 # calls 3 and 4: PCM refused, MP3 taken
        self.assertEqual(serve.mouth_cues(b"ID3mp3"), "")
        self.assertEqual(voice.wav("bez sieci")[:4], b"RIFF")             # the local voice steps in
        self.assertIsInstance(voice.local, FakeVoice)

    def test_stt(self):
        serve.ears = FakeEars()
        status, body = self.request("/stt", wav_bytes())
        self.assertEqual((status, json.loads(body)), (200, {"text": "dzień dobry"}))
        self.assertEqual(self.request("/stt", b"not audio at all")[0], 400)
        self.assertEqual(self.request("/stt", b"")[0], 400)

    def test_open_microphone_passes_on_only_what_starts_with_his_name(self):
        serve.ears = FakeEars()
        self.assertEqual(json.loads(self.request("/stt?wake=1", wav_bytes())[1]), {"text": ""})     # the room's talk stays in the room
        serve.ears.said = "Hej Alan, która godzina?"
        self.assertEqual(json.loads(self.request("/stt?wake=1", wav_bytes())[1]), {"text": "Hej Alan, która godzina?"})
        for said, his in [("Alanie.", True), ("Alanowi powiedz", False), ("To balans", False), ("  allan?", True)]:
            self.assertEqual(bool(serve.WAKE.match(said)), his, said)

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

    def test_agenda(self):
        self.assertEqual(self.request("/agenda")[0], 503)
        serve.brain = FakeBrain()
        status, body = self.request("/agenda")
        self.assertEqual((status, json.loads(body)), (200, {"say": ["Minutnik: czas minął."], "timers": [], "reminders": []}))

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
