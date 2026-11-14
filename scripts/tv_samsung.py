#!/usr/bin/env python3
"""Puts ALAN on a Samsung TV: wakes the TV and switches it to the Mac's HDMI input.

Runs on the Mac mini next to the TV. ALAN's page (opened with ?tv=http://127.0.0.1:8765)
calls POST /show when he is called by name or speaks up; this then
  1. wakes the TV over the network if it is off (Wake-on-LAN), and
  2. sends the remote-control key for the Mac's HDMI input over the TV's own
     local API (wss://TV:8002, the one the SmartThings phone app uses).
Only the standard library; nothing leaves the home network.

    python3 scripts/tv_samsung.py --tv 192.168.1.50 --hdmi 2 --pair   # once: accept "Allow" on the TV
    python3 scripts/tv_samsung.py --tv 192.168.1.50 --hdmi 2 --show   # try it
    python3 scripts/tv_samsung.py --tv 192.168.1.50 --hdmi 2          # serve http://127.0.0.1:8765

On the TV (names differ a little between years): Settings → General → External Device
Manager → Device Connection Manager → Access Notification on; and Settings → General →
Network → Expert Settings → Power On with Mobile on, so it can be woken while off.
"""

import argparse
import base64
import json
import os
import socket
import ssl
import struct
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = base64.b64encode(b"ALAN").decode()
STATE = os.path.expanduser("~/.alan-tv.json")     # the pairing token the TV hands out, and its MAC address


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    with open(STATE, "w") as f:
        json.dump(state, f)
    os.chmod(STATE, 0o600)


def info(tv, port=8001, timeout=2.0):
    """The TV's description of itself, or None while it is off or asleep."""
    try:
        with urllib.request.urlopen(f"http://{tv}:{port}/api/v2/", timeout=timeout) as r:
            return json.load(r)
    except (OSError, ValueError):
        return None


def wake(mac, broadcast="255.255.255.255"):
    """Wake-on-LAN: the magic packet, sent a few times."""
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + raw * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            s.sendto(packet, (broadcast, 9))
            time.sleep(0.1)


# --- a minimal WebSocket client: enough for one short exchange with the TV --------------------

class Socket:
    def __init__(self, host, port, path, secure=True, timeout=30.0):
        raw = socket.create_connection((host, port), timeout=timeout)
        if secure:                                   # the TV's certificate is self-signed
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            raw = context.wrap_socket(raw, server_hostname=host)
        self.sock = raw
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("the TV closed the connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.split(b"\r\n", 1)[0].decode(errors="replace"))

    def _exact(self, n):
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("the TV closed the connection")
            out += chunk
        return out

    def receive(self):
        """The next text message, as JSON."""
        while True:
            b1, b2 = self._exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            mask = self._exact(4) if b2 & 0x80 else None
            data = self._exact(n)
            if mask:
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
            op = b1 & 0x0F
            if op == 0x8:
                raise ConnectionError("the TV refused the connection (not allowed on the TV?)")
            if op == 0x1:
                return json.loads(data.decode())

    def send(self, message):
        data = json.dumps(message).encode()
        mask = os.urandom(4)
        head = bytes([0x81])
        n = len(data)
        head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
        self.sock.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def press(tv, key, token="", port=8002, secure=True):
    """Connects to the TV's remote-control channel, presses one key; returns the token the TV gave."""
    path = f"/api/v2/channels/samsung.remote.control?name={NAME}" + (f"&token={token}" if token else "")
    ws = Socket(tv, port, path, secure=secure)
    try:
        while True:                                   # wait to be let in (the first time, someone presses Allow)
            message = ws.receive()
            if message.get("event") == "ms.channel.connect":
                token = (message.get("data") or {}).get("token") or token
                break
            if message.get("event") == "ms.channel.unauthorized":
                raise PermissionError("the TV did not allow ALAN; accept it on the TV and try again")
        ws.send({"method": "ms.remote.control",
                 "params": {"Cmd": "Click", "DataOfCmd": key, "Option": "false", "TypeOfRemote": "SendRemoteKey"}})
        time.sleep(0.3)
        return token
    finally:
        ws.close()


class TV:
    def __init__(self, host, hdmi, port=8002, info_port=8001, secure=True):
        self.host, self.key, self.port, self.info_port, self.secure = host, f"KEY_HDMI{hdmi}", port, info_port, secure
        self.lock = threading.Lock()
        self.state = load_state()

    def show(self):
        """Wake the TV if it is off, then switch it to the Mac."""
        with self.lock:
            about = info(self.host, self.info_port)
            if about:
                mac = (about.get("device") or {}).get("wifiMac")
                if mac and mac != self.state.get("mac"):
                    self.state["mac"] = mac
                    save_state(self.state)
            elif self.state.get("mac"):
                wake(self.state["mac"])
                for _ in range(30):                   # a TV takes a few seconds to come up
                    time.sleep(0.5)
                    if info(self.host, self.info_port, timeout=1.0):
                        break
                time.sleep(1.5)
            else:
                raise ConnectionError("the TV is off and its MAC address is not known yet: run --pair once while it is on")
            token = press(self.host, self.key, self.state.get("token", ""), self.port, self.secure)
            if token and token != self.state.get("token"):
                self.state["token"] = token
                save_state(self.state)


def serve(tv, port, origins):
    class Handler(BaseHTTPRequestHandler):
        def _cors(self):
            origin = self.headers.get("Origin", "")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")   # an https page calling this machine

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self):
            if self.path != "/show":
                self.send_response(404)
                self.end_headers()
                return
            threading.Thread(target=self._show, daemon=True).start()   # answer at once; the TV may take seconds
            self.send_response(202)
            self._cors()
            self.end_headers()

        def _show(self):
            try:
                tv.show()
            except Exception as err:                  # logged, never fatal: he still talks on the Mac
                print(f"TV: {err}", flush=True)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"ALAN's TV helper on http://127.0.0.1:{port} (TV {tv.host}, {tv.key})", flush=True)
    server.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tv", required=True, help="the TV's IP address on the home network")
    ap.add_argument("--hdmi", type=int, default=1, help="the HDMI input the Mac is plugged into (default %(default)s)")
    ap.add_argument("--port", type=int, default=8765, help="where the helper listens, on this machine only")
    ap.add_argument("--origin", action="append", default=["https://alan-sanches-dom.netlify.app", "http://127.0.0.1:8888"],
                    help="page addresses allowed to call the helper")
    ap.add_argument("--pair", action="store_true", help="connect once, so the TV asks to allow ALAN; remembers its MAC")
    ap.add_argument("--show", action="store_true", help="wake the TV and switch to the Mac now, then exit")
    args = ap.parse_args()
    tv = TV(args.tv, args.hdmi)
    if args.pair or args.show:
        tv.show()
        print("Done: the TV is on the Mac's input." + ("" if tv.state.get("mac") else " (MAC address not read: Wake-on-LAN will not work)"))
        return
    serve(tv, args.port, set(args.origin))


if __name__ == "__main__":
    main()
