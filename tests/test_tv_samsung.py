import base64
import hashlib
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import tv_samsung  # noqa: E402


class FakeTV:
    """The TV's two local ports: its description over HTTP and the remote-control WebSocket (plain, for the test)."""

    def __init__(self, ask_first=True):
        self.keys, self.paths, self.ask_first = [], [], ask_first
        outer = self

        class Info(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"device": {"wifiMac": "AA:BB:CC:DD:EE:FF", "name": "TV"}}).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.info = ThreadingHTTPServer(("127.0.0.1", 0), Info)
        threading.Thread(target=self.info.serve_forever, daemon=True).start()
        self.ws = socket.socket()
        self.ws.bind(("127.0.0.1", 0))
        self.ws.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            conn, _ = self.ws.accept()
            threading.Thread(target=self._talk, args=(conn,), daemon=True).start()

    def _talk(self, conn):
        head = b""
        while b"\r\n\r\n" not in head:
            head += conn.recv(1)
        lines = head.decode().split("\r\n")
        self.paths.append(lines[0].split()[1])
        key = next(line.split(": ", 1)[1] for line in lines if line.lower().startswith("sec-websocket-key"))
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n".encode())

        def send(obj):
            data = json.dumps(obj).encode()
            conn.sendall(bytes([0x81, len(data)]) if len(data) < 126 else bytes([0x81, 126]) + struct.pack(">H", len(data)))
            conn.sendall(data)

        if self.ask_first:
            send({"event": "ms.channel.timeOut"})       # what the TV says while it waits for someone to press Allow
        send({"event": "ms.channel.connect", "data": {"token": "12345678"}})
        b1, b2 = conn.recv(2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", conn.recv(2))[0]
        mask = conn.recv(4)
        data = b""
        while len(data) < n:
            data += conn.recv(n - len(data))
        self.keys.append(json.loads(bytes(c ^ mask[i % 4] for i, c in enumerate(data))))
        conn.close()

    def close(self):
        self.info.shutdown()
        self.info.server_close()
        self.ws.close()


class TVHelper(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tv_samsung.STATE = os.path.join(self.tmp.name, "tv.json")
        self.fake = FakeTV()
        self.addCleanup(self.fake.close)
        self.tv = tv_samsung.TV("127.0.0.1", 2, port=self.fake.ws.getsockname()[1], info_port=self.fake.info.server_address[1], secure=False)

    def test_pairs_then_presses_the_hdmi_key_and_remembers_token_and_mac(self):
        self.tv.show()
        self.assertEqual(self.fake.keys[0]["params"]["DataOfCmd"], "KEY_HDMI2")
        self.assertEqual(self.fake.keys[0]["method"], "ms.remote.control")
        self.assertIn("name=QUxBTg==", self.fake.paths[0])
        self.assertNotIn("token=", self.fake.paths[0])
        self.assertEqual(tv_samsung.load_state(), {"mac": "AA:BB:CC:DD:EE:FF", "token": "12345678"})
        self.tv.show()                                   # the second time the TV is not asked again
        self.assertIn("token=12345678", self.fake.paths[1])
        self.assertEqual(oct(os.stat(tv_samsung.STATE).st_mode & 0o777), "0o600")

    def test_an_off_tv_is_woken_with_its_mac(self):
        tv_samsung.save_state({"mac": "AA:BB:CC:DD:EE:FF"})
        self.tv.state = tv_samsung.load_state()
        sent = []
        real_wake, real_info = tv_samsung.wake, tv_samsung.info
        calls = {"n": 0}

        def info(*a, **k):                               # off at first, on once woken
            calls["n"] += 1
            return None if calls["n"] == 1 else real_info(*a, **k)
        tv_samsung.wake, tv_samsung.info = sent.append, info
        self.addCleanup(setattr, tv_samsung, "wake", real_wake)
        self.addCleanup(setattr, tv_samsung, "info", real_info)
        real_sleep = tv_samsung.time.sleep
        tv_samsung.time.sleep = lambda s: None
        self.addCleanup(setattr, tv_samsung.time, "sleep", real_sleep)
        self.tv.show()
        self.assertEqual(sent, ["AA:BB:CC:DD:EE:FF"])
        self.assertEqual(self.fake.keys[0]["params"]["DataOfCmd"], "KEY_HDMI2")

    def test_magic_packet(self):
        captured = []

        class Sock:
            def __init__(self, *a): pass
            def setsockopt(self, *a): pass
            def sendto(self, data, where): captured.append((data, where))
            def __enter__(self): return self
            def __exit__(self, *a): return False
        real = tv_samsung.socket.socket
        tv_samsung.socket.socket = Sock
        self.addCleanup(setattr, tv_samsung.socket, "socket", real)
        tv_samsung.wake("AA:BB:CC:DD:EE:FF")
        data, where = captured[0]
        self.assertEqual(data, b"\xff" * 6 + bytes.fromhex("AABBCCDDEEFF") * 16)
        self.assertEqual(where, ("255.255.255.255", 9))

    def test_the_page_may_call_it_from_its_own_address_only(self):
        server_thread = threading.Thread(target=tv_samsung.serve, args=(self.tv, 0, {"https://alan.example"}), daemon=True)
        # serve() binds port 0 inside; find it through a small wrapper instead
        handler_server = {}
        real = tv_samsung.ThreadingHTTPServer

        class Capture(real):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                handler_server["s"] = self
        tv_samsung.ThreadingHTTPServer = Capture
        self.addCleanup(setattr, tv_samsung, "ThreadingHTTPServer", real)
        server_thread.start()
        while "s" not in handler_server:
            pass
        server = handler_server["s"]
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_address[1]}/show"
        req = urllib.request.Request(url, method="OPTIONS", headers={"Origin": "https://alan.example", "Access-Control-Request-Private-Network": "true"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.headers["Access-Control-Allow-Origin"], "https://alan.example")
            self.assertEqual(r.headers["Access-Control-Allow-Private-Network"], "true")
        req = urllib.request.Request(url, method="OPTIONS", headers={"Origin": "https://evil.example"})
        with urllib.request.urlopen(req) as r:
            self.assertIsNone(r.headers["Access-Control-Allow-Origin"])
        with urllib.request.urlopen(urllib.request.Request(url, data=b"", method="POST", headers={"Origin": "https://alan.example"})) as r:
            self.assertEqual(r.status, 202)
        for _ in range(100):
            if self.fake.keys:
                break
            threading.Event().wait(0.05)
        self.assertEqual(self.fake.keys[0]["params"]["DataOfCmd"], "KEY_HDMI2")


if __name__ == "__main__":
    unittest.main()
