#!/usr/bin/env python3
"""Serve ALAN's kiosk page and his voice from one origin.

    python3 serve.py --voice ~/alan/voices/pl_PL-darkman-medium.onnx [--pitch -2]

  /            the kiosk page (interface/)
  /tts?text=   speech for `text` as WAV, synthesised locally with Piper

Without --voice (or without `pip install piper-tts`) the page still works;
/tts answers 503 and the face falls back to silent mouth movement.
Standard library only, apart from the optional piper-tts.
"""

import argparse
import functools
import io
import os
import threading
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "interface")
MAX_CHARS = 1000

voice = None
SynthesisConfig = None
pitch = 0.0  # semitones; negative is deeper
lock = threading.Lock()  # Piper is not safe to call from two threads at once


@functools.lru_cache(maxsize=128)  # repeated lines (greetings, confirmations) are instant
def synthesise(text: str) -> bytes:
    # Deepen the voice the way a slowed tape does: speak faster, then play the
    # samples back slower by the same factor. Pitch and resonance both drop,
    # which reads as a bigger chest, and the pace stays about the same.
    factor = 2 ** (-pitch / 12)
    with lock:
        chunks = list(voice.synthesize(text, SynthesisConfig(length_scale=1 / factor)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(round(chunks[0].sample_rate / factor))
        wav.writeframes(b"".join(c.audio_int16_bytes for c in chunks))
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/tts":
            return super().do_GET()
        text = parse_qs(url.query).get("text", [""])[0].strip()
        if voice is None:
            return self.send_error(503, "No voice loaded")
        if not text or len(text) > MAX_CHARS:
            return self.send_error(400, f"text must be 1-{MAX_CHARS} characters")
        audio = synthesise(text)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, fmt, *args):
        if "/tts" in str(args[0]) or str(args[1])[0] in "45":
            super().log_message(fmt, *args)


def main():
    global voice, SynthesisConfig, pitch
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default=os.environ.get("ALAN_VOICE"), help="path to a Piper .onnx voice (or $ALAN_VOICE)")
    ap.add_argument("--pitch", type=float, default=pitch, help="semitones to shift the voice; negative is deeper (default %(default)s, 0 = as recorded)")
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to serve other devices on Network B")
    ap.add_argument("--port", type=int, default=8888)
    args = ap.parse_args()
    pitch = args.pitch

    if args.voice:
        from piper import PiperVoice, SynthesisConfig  # imported late so the page works without it

        voice = PiperVoice.load(os.path.expanduser(args.voice))
        print(f"Voice: {args.voice} (pitch {pitch:+g} semitones)")
    else:
        print("No --voice given: ALAN will be silent.")

    handler = functools.partial(Handler, directory=ROOT)
    print(f"ALAN on http://{args.host}:{args.port}/")
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
