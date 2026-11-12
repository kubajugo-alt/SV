#!/usr/bin/env python3
"""Serve ALAN's kiosk page and his voice from one origin.

    python3 serve.py                      # Chatterbox, ALAN's voice from the games, Polish
    python3 serve.py --engine piper --voice ~/alan/voices/pl_PL-darkman-medium.onnx
    python3 serve.py --engine none        # page only, silent

  /            the kiosk page (interface/)
  /tts?text=   speech for `text` as WAV, synthesised locally
  /stt         POST a recording (WAV) -> {"text": "..."}; local speech recognition
  /home        the flat's current state as JSON, for the panel (needs --ha-url)
  /agenda      timers and reminders: lines that have come due, and what is still running
  /chat        POST {"text": "...", "person": "kuba"} -> {"reply": "...", "actions": [...]}
               conversation with the local language model, with memory (brain.py)

Engines (both run entirely on this machine):
  chatterbox   default. Natural voice, heavier. `pip install chatterbox-tts`
  elevenlabs   the games' voice from the cloud: fast and natural, but the text of each spoken
               line leaves the machine. Key in data/elevenlabs.key or ALAN_ELEVENLABS_KEY
  piper        light and fast, more robotic. `pip install piper-tts` plus a voice file

If the chosen engine cannot be loaded the page still works; /tts answers 503
and the face mouths its lines silently.
"""

import argparse
import contextlib
import functools
import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "interface")
MAX_CHARS = 1000
MAX_AUDIO = 10 * 1024 * 1024
# His name at the start of what was said (the page has the same rule in js/mic.js).
WAKE = re.compile(r"^\W*(?:(?:hej|ej|cześć|halo|słuchaj|no)\W+)?al+an(?:ie|ku)?(?!\w)", re.I)

engine = None
rhubarb = ""         # path of the Rhubarb Lip Sync binary, if there is one
lipsync = "rhubarb"  # or "words" (timing from the recogniser) or "level" (loudness only)
brain = None
ears = None
lock = threading.Lock()  # neither engine is safe to call from two threads at once


def pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buf.getvalue()


class Chatterbox:
    """Resemble AI's multilingual model. Uses its built-in voice unless a
    reference recording is given, in which case it speaks with that timbre."""

    def __init__(self, language, reference, device, exaggeration, cfg_weight):
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        self.torch = torch
        self.language = language
        self.options = {"exaggeration": exaggeration, "cfg_weight": cfg_weight}
        with self._weights_on_cpu(device):
            self.model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device(device))
        if reference:
            # Analyse the reference voice once. Passed with every line instead, the library
            # would load and analyse the recording again each time, seconds per sentence.
            try:
                self.model.prepare_conditionals(os.path.expanduser(reference), exaggeration=exaggeration)
            except Exception as err:   # an older library without this call: fall back to the slow way
                print(f"Voice reference will be analysed per line: {err!r}", flush=True)
                self.options["audio_prompt_path"] = os.path.expanduser(reference)

        # The library always lets the model produce up to 1000 speech tokens
        # (40 s). Short lines then ramble: after the words come silence, noises
        # or the phrase again. Pass our own limit, sized to the text, instead.
        self.budget = None
        inference = self.model.t3.inference

        def limited(*args, **kwargs):
            if self.budget:
                kwargs["max_new_tokens"] = self.budget
            return inference(*args, **kwargs)

        self.model.t3.inference = limited
        self.name = f"chatterbox ({device}, {language}, {'voice from ' + reference if reference else 'built-in voice'})"

    @contextlib.contextmanager
    def _weights_on_cpu(self, device):
        # The library loads GPU-saved weights without a device hint, which
        # fails on machines without CUDA. Map them to CPU while loading.
        if device == "cuda":
            yield
            return
        original = self.torch.load
        self.torch.load = lambda *a, **k: original(*a, **{**k, "map_location": "cpu"})
        try:
            yield
        finally:
            self.torch.load = original

    @staticmethod
    def split(text, limit=240):
        """Whole sentences, grouped into pieces of up to `limit` characters.
        The model cuts off on long input and rambles on very short input, so
        short sentences travel with their neighbours."""
        parts = []
        for sentence in re.split(r"(?<=[.!?…])\s+", text):
            if parts and len(parts[-1]) + len(sentence) < limit:
                parts[-1] += " " + sentence
            elif sentence:
                parts.append(sentence)
        return parts

    def speak(self, part):
        """One piece of text -> audio, without the model's habit of carrying on."""
        # Speech runs at 25 tokens a second and Polish at under 2 tokens a
        # character; allow well over that, plus half a second, and no more.
        self.budget = int(12 + 3 * len(part))
        try:
            audio = self.model.generate(part, language_id=self.language, **self.options).squeeze(0).cpu()
        finally:
            self.budget = None
        return self.trim(audio, self.model.sr, one_phrase=not re.search(r"[,;:.!?…—–-]\s", part))

    def trim(self, audio, rate, one_phrase):
        """Cut what comes after the words. The end is the first long silence
        once speech has started: 0.8 s anywhere, or just 0.16 s when the text
        is a single phrase with no pause of its own to protect."""
        frame = int(rate * 0.02)
        usable = audio[: len(audio) // frame * frame]
        if len(usable) == 0:
            return audio
        energy = usable.reshape(-1, frame).pow(2).mean(dim=1).sqrt()
        # Low threshold: a final "ch" or "s" is far quieter than the vowels.
        voiced = (energy > max(0.004, 0.03 * float(energy.max()))).tolist()
        longest_gap = round((0.16 if one_phrase else 0.8) / 0.02)
        spoken, quiet, end = 0, 0, len(voiced)
        for i, on in enumerate(voiced):
            if on:
                spoken, quiet = spoken + 1, 0
            else:
                quiet += 1
                if spoken >= 5 and quiet >= longest_gap:   # 5 frames = 0.1 s of real speech first
                    end = i - quiet + 1
                    break
        else:
            end = len(voiced) - quiet                       # only trailing silence to drop
        keep = min(len(audio), (end + 8) * frame)           # leave 160 ms so the last sound is not clipped
        out = audio[:keep].clone()
        fade = min(len(out), int(rate * 0.03))
        out[-fade:] *= self.torch.linspace(1, 0, fade)
        return out

    def wav(self, text: str) -> bytes:
        text = re.sub(r"\bALAN\b", "Alan", text)  # all-caps reads as an acronym
        parts = self.split(text)
        chunks = [self.speak(s) for s in parts]
        pause = self.torch.zeros(int(self.model.sr * 0.18))
        joined = []
        for chunk in chunks:
            joined += [chunk.cpu(), pause]
        audio = self.torch.cat(joined[:-1]).clamp(-1, 1)
        return pcm_to_wav((audio * 32767).short().numpy().tobytes(), self.model.sr)


class Piper:
    """Small, fast VITS voices. `pitch` shifts the voice in semitones the way a
    slowed tape does: speak faster, then play back slower by the same factor."""

    def __init__(self, voice, pitch):
        from piper import PiperVoice, SynthesisConfig

        if not voice:
            raise ValueError("--engine piper needs --voice path/to/voice.onnx")
        self.voice = PiperVoice.load(os.path.expanduser(voice))
        self.factor = 2 ** (-pitch / 12)
        self.config = SynthesisConfig(length_scale=1 / self.factor)
        self.name = f"piper ({voice}, pitch {pitch:+g})"

    def wav(self, text: str) -> bytes:
        chunks = list(self.voice.synthesize(text, self.config))
        pcm = b"".join(c.audio_int16_bytes for c in chunks)
        return pcm_to_wav(pcm, round(chunks[0].sample_rate / self.factor))


class ElevenLabs:
    """ALAN's voice from ElevenLabs: the voice the games were recorded with, fast and natural.

    The one part of him that is not local. What leaves the machine is the text of each line he
    speaks, nothing else: not what was said to him, not his memory. If the service cannot be
    reached, the local engine in `fallback` (loaded on first need) speaks instead.
    """

    ROGER = "CwhRBWXzGAHq8TQ4Fs17"   # "Roger", Alan's voice in the games (scripts/cast.json there)
    RATE = 24000

    def __init__(self, key, voice, model, language, fallback=None):
        if not key:
            raise ValueError("no ElevenLabs key: put it in the file elevenlabs.key in the data folder, or in ALAN_ELEVENLABS_KEY")
        self.key, self.voice, self.model, self.language = key.strip(), voice or self.ROGER, model, language
        self.fallback, self.local = fallback, None
        self.name = f"elevenlabs ({self.model}, voice {self.voice})"

    def fetch(self, text, fmt):
        body = {"text": text, "model_id": self.model}
        if "v2_5" in self.model:              # only these models take a language hint
            body["language_code"] = self.language
        request = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice}?output_format={fmt}",
            data=json.dumps(body).encode(), headers={"xi-api-key": self.key, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as r:
            return r.read()

    def wav(self, text: str) -> bytes:
        text = re.sub(r"\bALAN\b", "Alan", text)
        try:
            try:
                return pcm_to_wav(self.fetch(text, f"pcm_{self.RATE}"), self.RATE)   # PCM, so the mouth can be read from it
            except urllib.error.HTTPError as err:
                if err.code not in (400, 403, 422):
                    raise
                return self.fetch(text, "mp3_44100_128")                            # a plan without PCM output
        except Exception as err:
            if not self.fallback:
                raise
            print(f"ElevenLabs did not answer ({err!r}); speaking with the local voice.", flush=True)
            self.local = self.local or self.fallback()
            return self.local.wav(text)


class Whisper:
    """Speech recognition with faster-whisper (`pip install faster-whisper`)."""

    def __init__(self, model, language):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model, device="auto", compute_type="int8")
        self.language = language
        self.lock = threading.Lock()
        self.name = f"faster-whisper {model} ({language})"

    @staticmethod
    def samples(audio: bytes):
        """16-bit WAV of any rate or channel count -> mono float32 at 16 kHz.
        Decoded here so the recogniser's own media decoder is not needed."""
        import numpy as np

        with wave.open(io.BytesIO(audio)) as wav:
            if wav.getsampwidth() != 2:
                raise ValueError("expected 16-bit PCM WAV")
            rate, channels = wav.getframerate(), wav.getnchannels()
            pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        pcm = pcm.reshape(-1, channels).mean(axis=1)
        if rate != 16000:
            pcm = np.interp(np.arange(0, len(pcm), rate / 16000), np.arange(len(pcm)), pcm).astype(np.float32)
        return pcm

    def text(self, audio: bytes, seconds: float = 0) -> str:
        """What was said; with `seconds`, only in the first so many seconds, read quickly."""
        pcm = self.samples(audio)
        if seconds:
            pcm = pcm[:int(seconds * 16000)]
        with self.lock:
            segments, _ = self.model.transcribe(
                pcm, language=self.language, beam_size=5,
                vad_filter=True,                                   # silence in, nothing out
                initial_prompt="ALAN, Kuba, Hubert, Tarnobrzeg.",  # names he should spell right
            )
            return " ".join(s.text.strip() for s in segments).strip()

    def words(self, audio: bytes) -> list:
        """When each word of a recording is spoken: [(start s, end s, word), ...]."""
        pcm = self.samples(audio)
        with self.lock:
            segments, _ = self.model.transcribe(pcm, language=self.language, beam_size=1, word_timestamps=True,
                                                condition_on_previous_text=False)
            return [(w.start, w.end, w.word) for s in segments for w in (s.words or [])]


# Polish spelling is close to its sounds, so the letters of a word give its mouth shapes
# (Rhubarb Lip Sync's set: A lips closed, B teeth nearly together, C open, D wide open,
# E rounded, F puckered). Digraphs first; what is not listed is not a sound of its own.
MOUTH_OF = {
    "sz": "B", "cz": "B", "rz": "B", "ch": "B", "dz": "B", "dż": "B", "dź": "B",
    "a": "D", "e": "C", "ę": "C", "i": "B", "y": "B", "o": "E", "ą": "E", "u": "F", "ó": "F", "ł": "F",
    "p": "A", "b": "A", "m": "A", "l": "C",
    **{c: "B" for c in "cćdfghjknńrsśtwzźżvxq"},
}
VOWELS = "aeęiyoąuó"


def shapes_of(word: str) -> list:
    """[(shape, weight), ...] for a word; vowels last twice as long as consonants."""
    word, out, i = word.lower(), [], 0
    while i < len(word):
        two = word[i:i + 2]
        if two in MOUTH_OF:
            out.append((MOUTH_OF[two], 1))
            i += 2
            continue
        ch = word[i]
        i += 1
        if ch == "i" and i < len(word) and word[i] in VOWELS:
            continue                                    # "ie", "ia": the i only softens the consonant
        if ch in MOUTH_OF:
            out.append((MOUTH_OF[ch], 2 if ch in VOWELS else 1))
    return out


def cues_from_words(words: list) -> list:
    """Mouth cues [[start s, shape], ...] from timed words; the mouth rests (X) in the gaps."""
    cues, last = [[0.0, "X"]], 0.0
    for start, end, word in words:
        shapes = shapes_of(word)
        if not shapes and any(ch.isdigit() for ch in word):     # "21": spoken, but spelled without letters
            shapes = [("C", 2), ("B", 1)] * max(1, round((end - start) / 0.18))
        if not shapes or end <= start:
            continue
        start = max(start, last)
        if start - last > 0.12 and cues[-1][1] != "X":
            cues.append([round(last, 2), "X"])
        t, per = start, (end - start) / sum(w for _, w in shapes)
        for shape, weight in shapes:
            if cues[-1][1] != shape:
                cues.append([round(t, 2), shape])
            t += per * weight
        last = end
    cues.append([round(last, 2), "X"])
    return cues


def mouth_cues(audio: bytes) -> str:
    """The mouth shapes for a spoken WAV, as compact JSON [[start s, shape], ...], or "".

    Rhubarb Lip Sync by default, if its binary is there (phonetic recogniser, any
    language). With `--lipsync words` and hearing loaded, the recogniser times each
    word of ALAN's own line and the word's letters give the shapes. With neither,
    the page moves the mouth by loudness.
    """
    if not audio.startswith(b"RIFF"):       # compressed audio from a cloud voice: the page goes by loudness
        return ""
    if lipsync == "words" and ears is not None and hasattr(ears, "words"):
        try:
            cues = cues_from_words(ears.words(audio))
            if len(cues) > 2:
                return json.dumps(cues, separators=(",", ":"))
        except Exception as err:
            print(f"Lip sync by word timing failed: {err!r}", file=sys.stderr)
    if lipsync == "level" or not rhubarb:
        return ""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "line.wav")
            with open(path, "wb") as f:
                f.write(audio)
            out = subprocess.run([rhubarb, "-q", "-f", "json", "-r", "phonetic", "--extendedShapes", "", path],
                                 capture_output=True, text=True, timeout=30, check=True).stdout
        cues = [[round(c["start"], 2), c["value"]] for c in json.loads(out)["mouthCues"]]
        return json.dumps(cues, separators=(",", ":"))
    except Exception as err:  # the mouth falls back to following loudness
        print(f"Rhubarb failed: {err!r}", file=sys.stderr)
        return ""


def find_rhubarb(path: str) -> str:
    for candidate in (path, os.path.join(HERE, "vendor", "rhubarb", "rhubarb"), shutil.which("rhubarb")):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            try:
                subprocess.run([candidate, "--version"], capture_output=True, timeout=20, check=True)
                return candidate
            except (OSError, subprocess.SubprocessError) as err:
                # On Apple Silicon the macOS build needs Rosetta: softwareupdate --install-rosetta --agree-to-license
                print(f"Rhubarb is there but does not run ({candidate}): {err!r}", flush=True)
    return ""


@functools.lru_cache(maxsize=256)  # repeated lines (greetings, confirmations) are instant
def synthesise(text: str) -> tuple[bytes, str]:
    started = time.monotonic()
    with lock:
        waited = time.monotonic() - started
        audio = engine.wav(text)
    spoken = time.monotonic() - started - waited
    cues = mouth_cues(audio)
    print(f"Timing: voice {spoken:.1f} s (waited {waited:.1f} s for the engine), mouth {time.monotonic() - started - waited - spoken:.1f} s, "
          f"{len(text)} characters", flush=True)
    return audio, cues


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/home":
            return self.do_home()
        if url.path == "/agenda":
            if brain is None:
                return self.send_error(503, "No language model configured")
            return self.send_json(brain.agenda() if hasattr(brain, "agenda") else brain.own.agenda())
        if url.path != "/tts":
            return super().do_GET()
        text = parse_qs(url.query).get("text", [""])[0].strip()
        if engine is None:
            return self.send_error(503, "No voice loaded")
        if not text or len(text) > MAX_CHARS:
            return self.send_error(400, f"text must be 1-{MAX_CHARS} characters")
        try:
            audio, cues = synthesise(text)
        except Exception as err:  # a failed line must not take the page down
            print(f"TTS failed: {err!r}", file=sys.stderr)
            return self.send_error(500, "Synthesis failed")
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav" if audio.startswith(b"RIFF") else "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        if cues:
            self.send_header("X-Mouth-Cues", cues)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(audio)

    def send_json(self, data):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_home(self):
        home = brain.home if brain else None
        if home is None:
            return self.send_error(503, "Home Assistant is not connected")
        try:
            self.send_json(home.snapshot())
        except OSError as err:
            print(f"Home state failed: {err!r}", file=sys.stderr)
            self.send_error(502, "Home Assistant did not answer")

    def do_stt(self):
        if ears is None:
            return self.send_error(503, "No speech recognition loaded")
        size = int(self.headers.get("Content-Length", 0))
        if not 0 < size <= MAX_AUDIO:
            return self.send_error(400, "Expected a recording of up to 10 MB")
        # ?wake=1: the microphone is open all the time. Only the opening of the recording is read first,
        # and unless it starts with his name the rest is never recognised, returned or logged.
        wake = parse_qs(urlparse(self.path).query).get("wake") == ["1"]
        try:
            started = time.monotonic()
            audio = self.rfile.read(size)
            if wake and not WAKE.match(ears.text(audio, 3.0)):
                return self.send_json({"text": ""})
            text = ears.text(audio)
            print(f"Timing: hearing {time.monotonic() - started:.1f} s", flush=True)
        except Exception as err:  # unreadable audio, …
            print(f"STT failed: {err!r}", file=sys.stderr)
            return self.send_error(400, "Could not read that recording")
        print(f"Heard: {text!r}", flush=True)
        self.send_json({"text": text})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/stt":
            return self.do_stt()
        if path != "/chat":
            return self.send_error(404)
        if brain is None:
            return self.send_error(503, "No language model configured")
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 16384)))
            nudge = str(body.get("nudge", ""))            # he speaks first: morning | idle | evening
            text = "" if nudge else str(body["text"]).strip()
            person = str(body.get("person", "kuba")).lower()
            if (not text and not nudge) or len(text) > 2000 or not re.fullmatch(r"[a-ząćęłńóśźż]{1,24}", person):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.send_error(400, "Expected JSON with text (1-2000 chars) and an optional person name")
        try:
            answer = brain.nudge(person, nudge) if nudge else brain.respond(person, text)
        except Exception as err:  # model not running, timed out, …
            print(f"Chat failed: {err!r}", file=sys.stderr)
            return self.send_error(502, "The language model did not answer")
        self.send_json(answer)

    def log_message(self, fmt, *args):
        if "/tts" in str(args[0]) or "/chat" in str(args[0]) or "/stt" in str(args[0]) or str(args[1])[0] in "45":
            super().log_message(fmt, *args)


def main():
    global engine, brain, ears, rhubarb, lipsync
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", choices=["chatterbox", "elevenlabs", "piper", "none"], default=os.environ.get("ALAN_ENGINE", "chatterbox"))
    ap.add_argument("--eleven-model", default=os.environ.get("ALAN_ELEVEN_MODEL", "eleven_v4"),
                    help="elevenlabs: the model (default %(default)s, as in the games; eleven_flash_v2_5 is the fastest)")
    ap.add_argument("--no-local-voice", action="store_true",
                    help="elevenlabs: stay silent when the service cannot be reached instead of loading the local voice")
    ap.add_argument("--voice", default=os.environ.get("ALAN_VOICE"),
                    help="chatterbox: reference recording to take the timbre from (default: voices/alan.wav, his voice "
                         "from the games; 'builtin' for the model's own voice); piper: the .onnx voice (required)")
    ap.add_argument("--language", default="pl", help="language code for speech and recognition (default %(default)s)")
    ap.add_argument("--device", default="auto", help="chatterbox: auto, cuda, mps or cpu")
    ap.add_argument("--exaggeration", type=float, default=0.5, help="chatterbox expressiveness, 0.25-2 (default %(default)s)")
    ap.add_argument("--cfg-weight", type=float, default=0.5, help="chatterbox pacing/adherence, 0-1 (default %(default)s)")
    ap.add_argument("--pitch", type=float, default=0.0, help="piper only: semitones to shift the voice, negative is deeper")
    ap.add_argument("--warm", action="append", default=[], metavar="TEXT", help="line to synthesise at startup so it is instant later (repeatable)")
    ap.add_argument("--lipsync", choices=["rhubarb", "words", "level"], default=os.environ.get("ALAN_LIPSYNC", "rhubarb"),
                    help="what moves his mouth: Rhubarb Lip Sync (default), word timing from his hearing plus Polish spelling, "
                         "or loudness only")
    ap.add_argument("--rhubarb", default=os.environ.get("ALAN_RHUBARB", ""),
                    help="path of the Rhubarb Lip Sync binary for mouth shapes (default: vendor/rhubarb/rhubarb or PATH; without it the mouth follows loudness)")
    ap.add_argument("--stt-model", default=os.environ.get("ALAN_STT_MODEL", "medium"),
                    help="faster-whisper model for the microphone: tiny, base, small, medium, large-v3; 'none' disables (default %(default)s)")
    ap.add_argument("--llm-url", default=os.environ.get("ALAN_LLM_URL", "http://127.0.0.1:11434"),
                    help="OpenAI-compatible server for conversation; Ollama's default address. '' disables /chat")
    ap.add_argument("--llm-model", default=os.environ.get("ALAN_LLM_MODEL", "mistral-nemo"))
    ap.add_argument("--llm-inline-system", action="store_true",
                    help="send ALAN's instructions inside the user message, for runtimes that ignore the system role (not needed with Ollama)")
    ap.add_argument("--ha-url", default=os.environ.get("ALAN_HA_URL", ""),
                    help="Home Assistant address, e.g. http://homeassistant.local:8123; gives ALAN his tools (lights, heating, state)")
    ap.add_argument("--ha-token", default=os.environ.get("ALAN_HA_TOKEN", ""),
                    help="long-lived access token; prefer the ALAN_HA_TOKEN environment variable")
    ap.add_argument("--online", default=os.environ.get("ALAN_ONLINE", ""), metavar="SOURCES",
                    help="outside sources ALAN may consult, comma-separated: weather, air, rates, wiki, news, parcel, or 'all'. "
                         "Default: none — he stays offline")
    ap.add_argument("--calendar", action="append", default=[], metavar="ICS",
                    help="a calendar to read: an .ics file or its https address (repeatable); default: the lines of kalendarze.txt in the data folder")
    ap.add_argument("--wiki", default=os.environ.get("ALAN_WIKI", ""), metavar="FILE.zim",
                    help="offline Wikipedia (a Kiwix .zim archive) he may look facts up in; default: the newest .zim in the data folder")
    ap.add_argument("--data", default=os.path.join(HERE, "data"), help="folder for ALAN's memory (default %(default)s)")
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to serve other devices on Network B")
    ap.add_argument("--port", type=int, default=8888)
    args = ap.parse_args()

    try:
        if args.engine == "chatterbox":
            own_voice = os.path.join(HERE, "voices", "alan.wav")   # ALAN's voice from the games
            if args.voice == "builtin":
                args.voice = None
            elif not args.voice and os.path.isfile(own_voice):
                args.voice = own_voice
            engine = Chatterbox(args.language, args.voice, args.device, args.exaggeration, args.cfg_weight)
        elif args.engine == "elevenlabs":
            key = os.environ.get("ALAN_ELEVENLABS_KEY", "")
            try:
                with open(os.path.join(args.data, "elevenlabs.key"), encoding="utf-8") as f:
                    key = key or f.read()
            except OSError:
                pass
            own_voice = os.path.join(HERE, "voices", "alan.wav")
            local = None if args.no_local_voice else (
                lambda: Chatterbox(args.language, own_voice if os.path.isfile(own_voice) else None, args.device, args.exaggeration, args.cfg_weight))
            engine = ElevenLabs(key, args.voice, args.eleven_model, args.language, local)
        elif args.engine == "piper":
            engine = Piper(args.voice, args.pitch)
    except Exception as err:
        print(f"Could not load the {args.engine} voice ({err!r}). ALAN will be silent.", file=sys.stderr)
    print(f"Voice: {engine.name if engine else 'none'}", flush=True)
    if args.stt_model != "none":
        try:
            ears = Whisper(args.stt_model, args.language)
        except Exception as err:
            print(f"Could not load speech recognition ({err!r}). The microphone will not work.", file=sys.stderr)
    print(f"Ears: {ears.name if ears else 'none'}", flush=True)
    if args.llm_url:
        from brain import Brain

        from online import SOURCES

        online = list(SOURCES) if args.online.strip().lower() == "all" else [s.strip().lower() for s in args.online.split(",") if s.strip()]
        if unknown := sorted(set(online) - set(SOURCES)):
            ap.error(f"--online: unknown source {', '.join(unknown)}; choose from {', '.join(SOURCES)} or 'all'")
        home = None
        if args.ha_url:
            from home import Home

            home = Home(args.ha_url, args.ha_token, os.path.join(HERE, "home.json"))
        wiki = None
        archive = args.wiki or next(iter(sorted(glob.glob(os.path.join(args.data, "*.zim")), reverse=True)), "")
        if archive:
            try:
                from wiki import Encyclopedia

                wiki = Encyclopedia(os.path.expanduser(archive))
            except Exception as err:  # a missing library or a broken download must not stop him talking
                print(f"Encyclopedia not loaded ({archive}): {err!r}", file=sys.stderr)
        calendars = list(args.calendar)
        try:
            with open(os.path.join(args.data, "kalendarze.txt"), encoding="utf-8") as f:
                calendars += f.read().splitlines()
        except OSError:
            pass
        diary = None
        if any(c.strip() and not c.strip().startswith("#") for c in calendars):
            from diary import Diary

            diary = Diary(calendars)
        brain = Brain(args.llm_url, args.llm_model, os.path.join(HERE, "prompts", "system.pl.txt"),
                      os.path.join(args.data, "alan.db"), args.llm_inline_system, home, online, wiki, diary)
        print(f"Calendar: {diary.name if diary else 'none (no kalendarze.txt in the data folder)'}", flush=True)
        print(f"Mind: {brain.name}", flush=True)
        brain.keep_warm()
        print(f"Encyclopedia: {wiki.name if wiki else 'none (no .zim archive in the data folder)'}", flush=True)
        print(f"Hands: {home.name if home else 'none (no --ha-url)'}", flush=True)
        print(f"Outside: {brain.online.name if brain.online else 'nothing (no --online)'}", flush=True)
    rhubarb = find_rhubarb(args.rhubarb)
    lipsync = args.lipsync
    mouth = ("word timing from his hearing" if lipsync == "words" and ears is not None
             else f"Rhubarb Lip Sync ({rhubarb})" if lipsync != "level" and rhubarb else "follows loudness (no Rhubarb found)"
             if lipsync == "rhubarb" else "follows loudness")
    print(f"Mouth: {mouth}", flush=True)
    for line in args.warm:
        synthesise(line)

    handler = functools.partial(Handler, directory=ROOT)
    print(f"ALAN on http://{args.host}:{args.port}/", flush=True)
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
