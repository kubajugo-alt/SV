"""ALAN's narrow window on the outside world.

One tool, `check_online`, with a fixed set of read-only sources. Each source
is a public service that needs no account:

  weather   forecast (Open-Meteo) and official warnings (IMGW)
  air       outdoor air quality index (GIOŚ)
  rates     exchange rates (NBP)
  wiki      Polish Wikipedia, the opening of one article
  news      headlines from the configured feeds — titles only, never article text
  parcel    InPost parcel status

Rules this module keeps:
- Off unless switched on, source by source (serve.py --online).
- It contacts only the hosts listed below plus the configured news feeds.
- Only `wiki` and `parcel` send anything of yours out (the search phrase, the
  tracking number); the others send at most the town's coordinates.
- Answers are cached, so a dropped line gives older data with its time, not silence.
- Like every tool it returns one Polish sentence and never raises.
"""

import datetime
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SOURCES = {
    "weather": "pogoda i ostrzeżenia",
    "air": "jakość powietrza na zewnątrz",
    "rates": "kursy walut",
    "wiki": "Wikipedia",
    "news": "nagłówki wiadomości",
    "parcel": "status paczki InPost",
}
HOSTS = {
    "weather": {"api.open-meteo.com", "danepubliczne.imgw.pl"},
    "air": {"api.gios.gov.pl"},
    "rates": {"api.nbp.pl"},
    "wiki": {"pl.wikipedia.org"},
    "news": set(),      # filled from online.json
    "parcel": {"api-shipx-pl.easypack24.net"},
}
MAX_AGE = {"weather": 20, "air": 30, "rates": 360, "wiki": 7 * 24 * 60, "news": 20, "parcel": 5}  # minutes
USER_AGENT = "ALAN-home/1.0 (local home assistant)"
MAX_BYTES = 2_000_000

DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]
WMO = {0: "bezchmurnie", 1: "prawie bezchmurnie", 2: "częściowe zachmurzenie", 3: "pochmurno",
       45: "mgła", 48: "mgła osadzająca szadź", 51: "słaba mżawka", 53: "mżawka", 55: "gęsta mżawka",
       56: "marznąca mżawka", 57: "marznąca mżawka", 61: "słaby deszcz", 63: "deszcz", 65: "ulewny deszcz",
       66: "marznący deszcz", 67: "marznący deszcz", 71: "słaby śnieg", 73: "śnieg", 75: "intensywny śnieg",
       77: "śnieg ziarnisty", 80: "przelotny deszcz", 81: "przelotny deszcz", 82: "gwałtowne ulewy",
       85: "przelotny śnieg", 86: "intensywny przelotny śnieg", 95: "burza", 96: "burza z gradem", 99: "burza z gradem"}
CURRENCIES = {"euro": "EUR", "eur": "EUR", "dolar": "USD", "usd": "USD", "funt": "GBP", "gbp": "GBP",
              "frank": "CHF", "chf": "CHF", "korona czeska": "CZK", "czk": "CZK", "hrywna": "UAH", "uah": "UAH"}
PARCEL = {"created": "nadawca przygotował przesyłkę", "confirmed": "przesyłka przygotowana przez nadawcę",
          "collected_from_sender": "odebrana od nadawcy", "taken_by_courier": "odebrana przez kuriera",
          "adopted_at_source_branch": "przyjęta w oddziale nadawczym", "sent_from_source_branch": "w drodze z oddziału nadawczego",
          "adopted_at_sorting_center": "w sortowni", "sent_from_sorting_center": "wysłana z sortowni",
          "adopted_at_target_branch": "w oddziale docelowym", "out_for_delivery": "wydana do doręczenia",
          "ready_to_pickup": "czeka w paczkomacie na odbiór", "delivered": "doręczona",
          "pickup_reminder_sent": "czeka na odbiór, wysłano przypomnienie", "returned_to_sender": "zwrócona do nadawcy",
          "avizo": "awizowana", "canceled": "anulowana"}


def num(value, digits=0):
    return f"{value:.{digits}f}".replace(".", ",")


class Online:
    def __init__(self, memory, config_path, enabled, clock=datetime.datetime.now):
        unknown = set(enabled) - set(SOURCES)
        if unknown:
            raise ValueError(f"unknown online sources: {', '.join(sorted(unknown))}; choose from {', '.join(SOURCES)}")
        with open(config_path, encoding="utf-8") as f:
            self.config = json.load(f)
        self.enabled = [s for s in SOURCES if s in enabled]
        self.db, self.lock, self.now = memory.db, memory.lock, clock
        self.hosts = set().union(*(HOSTS[s] for s in self.enabled))
        if "news" in self.enabled:
            self.hosts |= {urllib.parse.urlsplit(u).hostname for u in self.config["news"]["feeds"]}
        with self.lock, self.db:
            self.db.execute("CREATE TABLE IF NOT EXISTS online_cache (key TEXT PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL)")
        self.name = ", ".join(self.enabled)

    @property
    def tools(self):
        listed = "; ".join(f"{s} = {SOURCES[s]}" for s in self.enabled)
        return [{"type": "function", "function": {
            "name": "check_online",
            "description": f"Sprawdza aktualne dane spoza mieszkania. Źródła: {listed}.",
            "parameters": {"type": "object", "required": ["source"], "properties": {
                "source": {"type": "string", "enum": self.enabled},
                "query": {"type": "string", "description": "wiki: szukane hasło; rates: waluta, np. euro; parcel: numer przesyłki; w pozostałych puste"}}}}}]

    # --- plumbing ---------------------------------------------------------------
    def fetch(self, url):
        host = urllib.parse.urlsplit(url).hostname
        if host not in self.hosts:
            raise PermissionError(f"{host} is not on ALAN's list")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*"})
        for attempt in (1, 2):
            try:
                with urllib.request.urlopen(request, timeout=8) as response:
                    return response.read(MAX_BYTES)
            except urllib.error.HTTPError as err:
                if err.code != 429 or attempt == 2:      # asked to slow down: wait once, then give up
                    raise
                time.sleep(2)
            except OSError:
                if attempt == 2:                          # one retry for a dropped or slow connection
                    raise

    def call(self, name, arguments):
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
            source, query = str(args.get("source", "")).strip().lower(), str(args.get("query") or "").strip()
        except (TypeError, ValueError, AttributeError) as err:
            return f"Błąd: niepoprawne parametry ({err})."
        if source not in self.enabled:
            return f"Błąd: źródło '{source}' nie jest dostępne. Dostępne: {', '.join(self.enabled)}."
        key = f"{source}:{query.lower()}"
        now = self.now()
        with self.lock:
            cached = self.db.execute("SELECT at, text FROM online_cache WHERE key = ?", (key,)).fetchone()
        if cached and now - datetime.datetime.fromisoformat(cached[0]) < datetime.timedelta(minutes=MAX_AGE[source]):
            return cached[1]
        try:
            text = getattr(self, source)(query)
        except LookupError as err:           # the source answered, but has nothing for this query
            return f"Błąd: {err}"
        except (OSError, ValueError, KeyError, TypeError, ET.ParseError) as err:
            print(f"Online source {source} failed: {err!r}", flush=True)
            if cached:
                at = datetime.datetime.fromisoformat(cached[0])
                return f"Brak połączenia; dane z {at:%d.%m %H:%M}: {cached[1]}"
            return f"Błąd: źródło {SOURCES[source]} teraz nie odpowiada."
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO online_cache (key, at, text) VALUES (?, ?, ?)",
                            (key, now.isoformat(timespec="seconds"), text))
        return text

    # --- sources ----------------------------------------------------------------
    def weather(self, query):
        place = self.config["place"]
        data = json.loads(self.fetch(
            "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
                "latitude": place["lat"], "longitude": place["lon"], "timezone": "Europe/Warsaw", "forecast_days": 4,
                "current": "temperature_2m,weather_code,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
                         "precipitation_probability_max,wind_speed_10m_max"})))
        now, daily = data["current"], data["daily"]
        parts = [f"Pogoda w {place['where']}. Teraz {num(now['temperature_2m'], 1)}°C, "
                 f"{WMO.get(now['weather_code'], 'zmienne warunki')}, wiatr {num(now['wind_speed_10m'])} km/h."]
        for i, day in enumerate(daily["time"]):
            date = datetime.date.fromisoformat(day)
            weekday = DAYS[date.weekday()]
            label = f"{['Dziś', 'Jutro', 'Pojutrze'][i]} ({weekday} {date:%d.%m})" if i < 3 else f"{weekday.capitalize()} {date:%d.%m}"
            rain = daily["precipitation_sum"][i] or 0
            parts.append(
                f"{label}: od {num(daily['temperature_2m_min'][i])} do "
                f"{num(daily['temperature_2m_max'][i])}°C, {WMO.get(daily['weather_code'][i], 'zmienne warunki')}, "
                + (f"opady {num(rain, 1)} mm, " if rain else "bez opadów, ")
                + f"szansa opadów {daily['precipitation_probability_max'][i] or 0}%, "
                f"wiatr do {num(daily['wind_speed_10m_max'][i])} km/h.")
        parts.append(self.warnings())
        return " ".join(parts)

    def warnings(self):
        try:
            data = json.loads(self.fetch("https://danepubliczne.imgw.pl/api/data/warningsmeteo"))
        except (OSError, ValueError):
            return "Ostrzeżeń IMGW nie udało się sprawdzić."
        mine = [w for w in data if isinstance(w, dict)
                and set(map(str, w.get("teryt") or [])) & set(self.config["place"]["teryt"])] if isinstance(data, list) else []
        if not mine:
            return "Ostrzeżenia IMGW: brak."
        return "Ostrzeżenia IMGW: " + "; ".join(
            f"{w.get('nazwa_zdarzenia', 'ostrzeżenie')} {w.get('stopien', '?')}. stopnia, "
            f"od {w.get('obowiazuje_od', '?')} do {w.get('obowiazuje_do', '?')}" for w in mine) + "."

    def air(self, query):
        station = self.config["air_station"]
        index = json.loads(self.fetch(f"https://api.gios.gov.pl/pjp-api/v1/rest/aqindex/getIndex/{station['id']}"))["AqIndex"]
        overall = index.get("Nazwa kategorii indeksu")
        if not overall:
            raise LookupError("stacja nie podaje teraz indeksu jakości powietrza.")
        details = [f"{key.rsplit(' ', 1)[-1]}: {value.lower()}" for key, value in index.items()
                   if key.startswith("Nazwa kategorii indeksu dla wska") and value]
        when = str(index.get("Data wykonania obliczeń indeksu", ""))[11:16]
        return (f"Indeks jakości powietrza w {self.config['place']['where']} (stacja {station['name']}, {when}): "
                f"{overall.lower()}." + (f" Wskaźniki: {', '.join(details)}." if details else ""))

    def rates(self, query):
        codes = [CURRENCIES.get(query.lower(), query.upper())] if query else ["EUR", "USD"]
        lines = []
        for code in codes:
            if not re.fullmatch(r"[A-Z]{3}", code):
                raise LookupError(f"nie znam waluty '{query}'.")
            try:
                rate = json.loads(self.fetch(f"https://api.nbp.pl/api/exchangerates/rates/a/{code.lower()}/?format=json"))
            except urllib.error.HTTPError as err:
                if err.code == 404:
                    raise LookupError(f"NBP nie podaje kursu waluty {code}.") from None
                raise
            last = rate["rates"][-1]
            lines.append(f"{rate['currency']} ({code}): {num(last['mid'], 4)} zł, kurs średni NBP z {last['effectiveDate']}")
        return "; ".join(lines) + "."

    def wiki(self, query):
        if not query:
            raise LookupError("podaj hasło do wyszukania w Wikipedii.")
        api = "https://pl.wikipedia.org/w/api.php?format=json&"
        found = json.loads(self.fetch(api + urllib.parse.urlencode(
            {"action": "query", "list": "search", "srsearch": query, "srlimit": 1})))["query"]["search"]
        if not found:
            raise LookupError(f"Wikipedia nie ma hasła o '{query}'.")
        pages = json.loads(self.fetch(api + urllib.parse.urlencode(
            {"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "redirects": 1,
             "titles": found[0]["title"]})))["query"]["pages"]
        page = next(iter(pages.values()))
        text = re.sub(r"\s+", " ", page.get("extract") or "").strip()
        if not text:
            raise LookupError(f"hasło '{found[0]['title']}' nie ma wstępu do przeczytania.")
        if len(text) > 900:
            text = text[:900].rsplit(". ", 1)[0] + "."
        return f"Wikipedia, hasło „{page['title']}”: {text}"

    def news(self, query):
        prefer = [p.lower() for p in self.config["news"].get("prefer", [])]
        items, failed = [], 0
        for feed in self.config["news"]["feeds"]:
            try:
                root = ET.fromstring(self.fetch(feed))
            except (OSError, ET.ParseError):
                failed += 1
                continue
            for item in root.iter("item"):
                title = re.sub(r"\s+", " ", item.findtext("title") or "").strip()
                if title:
                    local = any(p in (title + " " + (item.findtext("link") or "")).lower() for p in prefer)
                    items.append((not local, len(items), title))
        if not items:
            if failed:
                raise OSError("no news feed answered")
            raise LookupError("w źródłach nie ma teraz żadnych wiadomości.")
        items.sort()
        local = sum(1 for other, _, _ in items if not other)
        note = "" if local else " (brak wiadomości z okolicy, podaję ogólne)"
        return f"Nagłówki{note}: " + " | ".join(title for _, _, title in items[:6])

    def parcel(self, query):
        number = re.sub(r"\s+", "", query)
        if not re.fullmatch(r"\d{24}", number):
            raise LookupError("numer przesyłki InPost ma 24 cyfry.")
        try:
            data = json.loads(self.fetch(f"https://api-shipx-pl.easypack24.net/v1/tracking/{number}"))
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise LookupError(f"InPost nie zna przesyłki {number}.") from None
            raise
        status = data.get("status", "")
        steps = data.get("tracking_details") or []
        when = str(steps[0].get("datetime", ""))[:16].replace("T", " ") if steps else ""
        return f"Paczka {number}: {PARCEL.get(status, status.replace('_', ' '))}{f' (od {when})' if when else ''}."
