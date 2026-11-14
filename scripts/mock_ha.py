#!/usr/bin/env python3
"""A stand-in Home Assistant for trying ALAN's tools before the real one exists.

    python3 scripts/mock_ha.py            # http://127.0.0.1:8123, any token accepted

Implements just the REST calls home.py uses — reading entity states and the
light / climate services — over a made-up flat held in memory. Every change is
printed, so you can watch what ALAN actually did.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATES = {
    "light.salon": {"state": "off", "attributes": {}},
    "light.sypialnia": {"state": "off", "attributes": {}},
    "light.przedpokoj": {"state": "on", "attributes": {"brightness": 102}},
    "climate.salon": {"state": "heat", "attributes": {"temperature": 21.0}},
    "climate.sypialnia": {"state": "heat", "attributes": {"temperature": 19.0}},
    "climate.kuchnia": {"state": "heat", "attributes": {"temperature": 21.0}},
    "sensor.salon_temperature": {"state": "21.5", "attributes": {}},
    "sensor.sypialnia_temperature": {"state": "19.0", "attributes": {}},
    "sensor.kuchnia_temperature": {"state": "22.1", "attributes": {}},
    "sensor.przedpokoj_temperature": {"state": "20.4", "attributes": {}},
    "sensor.lazienka_temperature": {"state": "23.0", "attributes": {}},
    "sensor.salon_humidity": {"state": "44", "attributes": {}},
    "sensor.sypialnia_humidity": {"state": "47", "attributes": {}},
    "sensor.kuchnia_humidity": {"state": "38", "attributes": {}},
    "sensor.lazienka_humidity": {"state": "58", "attributes": {}},
    "person.kuba": {"state": "home", "attributes": {}},
    "person.hubert": {"state": "home", "attributes": {}},
    "sensor.salon_co2": {"state": "640", "attributes": {}},
    "sensor.outdoor_temperature": {"state": "3.5", "attributes": {}},
    "sensor.ecoflow_battery": {"state": "94", "attributes": {}},
}


def entity(entity_id):
    return {"entity_id": entity_id, **STATES[entity_id]}


def apply(domain, service, data):
    ids = data.get("entity_id", [])
    ids = [ids] if isinstance(ids, str) else ids
    for entity_id in ids:
        s = STATES[entity_id]  # KeyError -> 400, like HA for an unknown entity
        if (domain, service) == ("light", "turn_on"):
            s["state"] = "on"
            if "brightness_pct" in data:
                s["attributes"]["brightness"] = round(data["brightness_pct"] * 255 / 100)
        elif (domain, service) == ("light", "turn_off"):
            s["state"] = "off"
        elif (domain, service) == ("climate", "set_temperature"):
            s["attributes"]["temperature"] = data["temperature"]
        else:
            raise KeyError(f"{domain}.{service}")
        print(f"[mock HA] {domain}.{service} {entity_id} -> {s}", flush=True)
    return [entity(i) for i in ids]


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def authorised(self):
        if self.headers.get("Authorization", "").startswith("Bearer "):
            return True
        self.reply(401, {"message": "Unauthorized"})
        return False

    def do_GET(self):
        if not self.authorised():
            return
        if self.path == "/api/states":
            return self.reply(200, [entity(i) for i in STATES])
        entity_id = self.path.removeprefix("/api/states/")
        if entity_id in STATES:
            return self.reply(200, entity(entity_id))
        self.reply(404, {"message": "Entity not found."})

    def do_POST(self):
        if not self.authorised():
            return
        parts = self.path.strip("/").split("/")
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if len(parts) != 4 or parts[:2] != ["api", "services"]:
                raise KeyError(self.path)
            self.reply(200, apply(parts[2], parts[3], body))
        except (KeyError, ValueError) as err:
            self.reply(400, {"message": f"Bad request: {err}"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print(f"Mock Home Assistant on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
