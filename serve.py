#!/usr/bin/env python3
"""Serve ALAN's kiosk page and his voice from one origin.

    python3 serve.py --voice ~/alan/voices/pl_PL-darkman-medium.onnx

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
lock = threading.Lock()  # Piper is not safe to call from two threads at once


@functools.lru_cache(maxsize=128)  # repeated lines (greetings, confirmations) are instant
def synthesise(text: str) -> bytes:
    buf = io.BytesIO()
    with lock, wave.open(buf, "wb") as wav:
        voice.synthesize_wav(text, wav)
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
    global voice
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default=os.environ.get("ALAN_VOICE"), help="path to a Piper .onnx voice (or $ALAN_VOICE)")
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to serve other devices on Network B")
    ap.add_argument("--port", type=int, default=8888)
    args = ap.parse_args()

    if args.voice:
        from piper import PiperVoice  # imported late so the page works without it

        voice = PiperVoice.load(os.path.expanduser(args.voice))
        print(f"Voice: {args.voice}")
    else:
        print("No --voice given: ALAN will be silent.")

    handler = functools.partial(Handler, directory=ROOT)
    print(f"ALAN on http://{args.host}:{args.port}/")
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
