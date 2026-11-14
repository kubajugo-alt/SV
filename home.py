"""ALAN's hands: the few things he may do in the flat, through Home Assistant.

He gets a short list of tools (lights, heating, reading the flat's state) and
each call goes to Home Assistant's REST API. What he may touch is exactly what
is listed in home.json — there is deliberately no tool for doors, locks,
cameras or alarms. Every tool returns a short Polish sentence for the model to
base its answer on, and never raises: a failure comes back as a sentence too,
so he reports it instead of pretending.
"""

import json
import unicodedata
import urllib.request

MIN_TEMP, MAX_TEMP = 5.0, 28.0

ROOM_NAMES = {"salon": "salonie", "sypialnia": "sypialni", "kuchnia": "kuchni",
              "przedpokoj": "przedpokoju", "lazienka": "łazience"}
ALIASES = {"pokoj dzienny": "salon", "duzy pokoj": "salon", "living room": "salon",
           "korytarz": "przedpokoj", "hol": "przedpokoj", "hall": "przedpokoj",
           "bedroom": "sypialnia", "kitchen": "kuchnia", "bathroom": "lazienka"}
ALL = {"wszystkie", "wszedzie", "cale mieszkanie", "mieszkanie", "all", "everywhere"}

TOOLS = [
    {"type": "function", "function": {
        "name": "set_light",
        "description": "Włącza lub wyłącza światło w pokoju, opcjonalnie ustawia jasność.",
        "parameters": {"type": "object", "required": ["room", "on"], "properties": {
            "room": {"type": "string", "description": "salon, sypialnia, przedpokoj albo 'wszystkie'"},
            "on": {"type": "boolean", "description": "true = włącz, false = wyłącz"},
            "brightness": {"type": "integer", "description": "jasność w procentach, 1-100"}}}}},
    {"type": "function", "function": {
        "name": "set_temperature",
        "description": "Ustawia temperaturę ogrzewania w pokoju.",
        "parameters": {"type": "object", "required": ["room", "degrees"], "properties": {
            "room": {"type": "string", "description": "salon, sypialnia albo kuchnia"},
            "degrees": {"type": "number", "description": "temperatura w stopniach Celsjusza"}}}}},
    {"type": "function", "function": {
        "name": "get_home_state",
        "description": "Odczytuje aktualny stan mieszkania: temperatury, wilgotność, światła, ogrzewanie, kto jest w domu.",
        "parameters": {"type": "object", "properties": {}}}},
]


def plain(text):
    """'Przedpokój ' -> 'przedpokoj'"""
    text = unicodedata.normalize("NFD", str(text).strip().lower().replace("ł", "l"))
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


class Home:
    def __init__(self, url, token, mapping_path):
        self.url = url.rstrip("/")
        self.token = token
        with open(mapping_path, encoding="utf-8") as f:
            self.map = json.load(f)
        self.name = f"Home Assistant at {self.url}"

    # --- Home Assistant REST ------------------------------------------------
    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data, {
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    def service(self, domain, service, **data):
        self.request(f"/api/services/{domain}/{service}", data)

    # --- tools ----------------------------------------------------------------
    def call(self, name, arguments):
        """Run one tool call from the model; always returns a sentence."""
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
            tool = {"set_light": self.set_light, "set_temperature": self.set_temperature,
                    "get_home_state": self.get_home_state}.get(name)
            if tool is None:
                return f"Błąd: nie ma narzędzia {name}."
            return tool(**args)
        except (TypeError, ValueError) as err:
            return f"Błąd: niepoprawne parametry ({err})."
        except OSError as err:
            return f"Błąd: Home Assistant nie odpowiada ({err})."

    def rooms(self, room, group):
        key = plain(room)
        key = ALIASES.get(key, key)
        if key in ALL:
            return list(self.map[group])
        return [key] if key in self.map[group] else []

    def set_light(self, room, on, brightness=None):
        rooms = self.rooms(room, "lights")
        if not rooms:
            return f"Błąd: nie ma sterowanego światła w pokoju '{room}'. Dostępne: {', '.join(self.map['lights'])}."
        data = {}
        if on and brightness is not None:
            data["brightness_pct"] = max(1, min(100, int(brightness)))
        for r in rooms:
            self.service("light", "turn_on" if on else "turn_off", entity_id=self.map["lights"][r], **data)
        where = ", ".join(ROOM_NAMES[r] for r in rooms)
        extra = f", jasność {data['brightness_pct']}%" if data else ""
        return f"Wykonano: światło {'włączone' if on else 'wyłączone'} w: {where}{extra}."

    def set_temperature(self, room, degrees):
        rooms = self.rooms(room, "heating")
        if not rooms:
            return f"Błąd: nie ma sterowanego ogrzewania w pokoju '{room}'. Dostępne: {', '.join(self.map['heating'])}."
        degrees = float(degrees)
        if not MIN_TEMP <= degrees <= MAX_TEMP:
            return f"Błąd: temperatura musi być między {MIN_TEMP:g} a {MAX_TEMP:g} stopni. Niczego nie zmieniono."
        for r in rooms:
            self.service("climate", "set_temperature", entity_id=self.map["heating"][r], temperature=degrees)
        return f"Wykonano: ogrzewanie ustawione na {degrees:g}°C w: {', '.join(ROOM_NAMES[r] for r in rooms)}."

    def snapshot(self):
        """The flat as data, for the screen: what get_home_state says in words."""
        states = {s["entity_id"]: s for s in self.request("/api/states")}  # one request for everything

        def value(entity):
            s = states.get(entity)
            return None if s is None or s["state"] in ("unknown", "unavailable") else s["state"]

        def number(entity):
            try:
                return float(value(entity))
            except (TypeError, ValueError):
                return None

        rooms = {}
        for room in ROOM_NAMES:
            info = {"temp": number(self.map["temperature"].get(room)), "hum": number(self.map["humidity"].get(room))}
            if s := states.get(self.map["lights"].get(room)):
                level = s.get("attributes", {}).get("brightness")  # Home Assistant reports 0-255
                info["light"] = {"on": s["state"] == "on", "pct": round(level / 255 * 100) if level else None}
            if s := states.get(self.map["heating"].get(room)):
                info["heating"] = s.get("attributes", {}).get("temperature")
            rooms[room] = info
        return {
            "rooms": rooms,
            "presence": {who: value(entity) == "home" for who, entity in self.map["people"].items()},
            "other": {label: v for label, entity in self.map["other"].items() if (v := value(entity)) is not None},
        }

    def get_home_state(self):
        snap = self.snapshot()
        lines = []
        for room, info in snap["rooms"].items():
            facts = []
            if info["temp"] is not None:
                facts.append(f"{info['temp']:g}°C")
            if info["hum"] is not None:
                facts.append(f"wilgotność {info['hum']:g}%")
            if light := info.get("light"):
                pct = f" ({light['pct']}%)" if light["pct"] else ""
                facts.append(f"światło włączone{pct}" if light["on"] else "światło wyłączone")
            if info.get("heating") is not None:
                facts.append(f"ogrzewanie ustawione na {info['heating']:g}°C")
            if facts:
                lines.append(f"W {ROOM_NAMES[room]}: {', '.join(facts)}.")
        home = [who for who, there in snap["presence"].items() if there]
        lines.append(f"W domu: {', '.join(home) if home else 'nikogo'}.")
        lines += [f"{label}: {v}." for label, v in snap["other"].items()]
        return " ".join(lines)
