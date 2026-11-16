#!/usr/bin/env python3
"""Property scout for São Miguel do Gostoso (RN, Brazil) and the towns around it.

Collects houses, land and other property for sale, converts prices to euros,
keeps a history of every listing (new, price changes, removed) and writes a
self-contained HTML report with photos.

Standard library only. Run:  python3 property_scout/scout.py
See property_scout/README.md for the options.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import gzip
import html
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "config.json"
DEFAULT_DATA = HERE / "data" / "listings.json"
DEFAULT_REPORT = HERE / "report" / "index.html"
PHOTO_CACHE = HERE / "data" / "photos"

SOURCE = "Chaves na Mão"
BASE = "https://www.chavesnamao.com.br"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def today() -> str:
    return dt.date.today().isoformat()


# --------------------------------------------------------------------------- HTTP


class Http:
    """Polite fetcher: one request at a time, a delay between requests, robots.txt respected."""

    def __init__(self, user_agent: str, delay: float):
        self.ua = user_agent
        self.delay = delay
        self._last = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def _wait(self):
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last = time.monotonic()

    def _raw(self, url: str, timeout: int = 30) -> tuple[int, bytes]:
        self._wait()
        req = urllib.request.Request(url, headers={
            "User-Agent": self.ua,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
            "Accept-Encoding": "gzip",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return r.status, body
        except urllib.error.HTTPError as e:
            return e.code, b""
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log(f"  network error for {url}: {e}")
            return 0, b""

    def allowed(self, url: str) -> bool:
        host = urlparse(url).scheme + "://" + urlparse(url).netloc
        if host not in self._robots:
            status, body = self._raw(host + "/robots.txt")
            rp = None
            if status == 200:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(body.decode("utf-8", "replace").splitlines())
            self._robots[host] = rp
        rp = self._robots[host]
        return True if rp is None else rp.can_fetch(self.ua, url)

    def get(self, url: str, binary: bool = False, retries: int = 2):
        if not self.allowed(url):
            log(f"  skipped (robots.txt disallows): {url}")
            return None
        for attempt in range(retries + 1):
            status, body = self._raw(url)
            if status == 200:
                return body if binary else body.decode("utf-8", "replace")
            if status in (403, 404, 410, 401):
                log(f"  HTTP {status}: {url}")
                return None
            time.sleep(2 * (attempt + 1))
        log(f"  gave up on {url}")
        return None


# --------------------------------------------------------------------------- FX


def brl_to_eur_rate(http: Http, fallback: float) -> dict:
    """1 BRL in EUR. ECB rate via Frankfurter, then Polish central bank cross rate, then config."""
    try:
        body = http.get("https://api.frankfurter.dev/v1/latest?from=BRL&to=EUR")
        if body:
            d = json.loads(body)
            return {"rate": float(d["rates"]["EUR"]), "date": d.get("date", today()),
                    "source": "European Central Bank (via frankfurter.dev)"}
    except Exception as e:  # noqa: BLE001
        log(f"  frankfurter failed: {e}")
    try:
        brl = json.loads(http.get("https://api.nbp.pl/api/exchangerates/rates/a/brl/?format=json") or "null")
        eur = json.loads(http.get("https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json") or "null")
        if brl and eur:
            return {"rate": brl["rates"][0]["mid"] / eur["rates"][0]["mid"],
                    "date": brl["rates"][0]["effectiveDate"],
                    "source": "National Bank of Poland cross rate (BRL/PLN ÷ EUR/PLN)"}
    except Exception as e:  # noqa: BLE001
        log(f"  NBP failed: {e}")
    return {"rate": fallback, "date": today(), "source": "fixed fallback rate from config.json"}


# --------------------------------------------------------------------------- parsing helpers


_LD_RE = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)


def jsonld_objects(page: str) -> list[dict]:
    out: list[dict] = []
    for m in _LD_RE.finditer(page):
        try:
            data = json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            continue
        stack = data if isinstance(data, list) else [data]
        for obj in stack:
            if isinstance(obj, dict):
                out.append(obj)
                for g in obj.get("@graph", []) or []:
                    if isinstance(g, dict):
                        out.append(g)
    return out


def num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d.,]*", str(v))
    if not m:
        return None
    s = m.group(0)
    if "," in s and "." in s:          # 1.234,56
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1 or re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")         # 1.234.567
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def listing_id(url: str) -> str | None:
    m = re.search(r"/id-(\d+)/?", url)
    return m.group(1) if m else None


_SLUG_RE = re.compile(r"/imovel/(?P<kind>[a-z-]+?)-a-venda-(?P<rest>.*?)/id-\d+")


def slug_facts(url: str) -> dict:
    """The listing URL carries kind, total area and price: .../casa-a-venda-2-quartos-...-240m2-RS420000/id-1/"""
    out: dict = {}
    m = _SLUG_RE.search(url)
    if m:
        out["kind"] = m.group("kind")
        a = re.search(r"-(\d+)m2(?:-|$)", m.group("rest"))
        if a:
            out["total_area_m2"] = float(a.group(1))
    return out


KIND_LABELS = {
    "casa": "House", "casa-em-condominio": "House in condominium", "sobrado": "House",
    "terreno": "Land", "terreno-em-condominio": "Land in condominium", "lote": "Land",
    "apartamento": "Apartment", "cobertura": "Apartment", "flat": "Apartment", "kitnet": "Apartment",
    "chacara": "Smallholding", "sitio": "Smallholding", "fazenda": "Farm",
    "casa-comercial": "Commercial", "ponto-comercial": "Commercial", "pousada": "Commercial",
    "hotel": "Commercial", "predio": "Commercial", "sala-comercial": "Commercial",
    "galpao": "Commercial", "loja": "Commercial", "area": "Land", "terreno-comercial": "Land",
}


def small_photo(url: str) -> str:
    """Chaves na Mão serves resized photos by path; 640x400 at quality 60 is ~13 KB."""
    return re.sub(r"/imn/[0-9xX]+/N(?:/\d+)?/", "/imn/0640x0400/N/60/", url)


def big_photo(url: str) -> str:
    return re.sub(r"/imn/[0-9xX]+/N(?:/\d+)?/", "/imn/1200x0800/N/70/", url)


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# --------------------------------------------------------------------------- Chaves na Mão


def parse_search_page(page: str) -> tuple[list[dict], int | None]:
    """Listings from a search page's schema.org RealEstateListing block, and the total the site reports."""
    for obj in jsonld_objects(page):
        if obj.get("@type") != "RealEstateListing":
            continue
        offers = obj.get("offers") or {}
        if not isinstance(offers, dict) or "itemListElement" not in offers:
            continue
        items = []
        for o in offers.get("itemListElement") or []:
            url = o.get("url") or ""
            lid = listing_id(url)
            if not lid:
                continue
            it = o.get("itemOffered") or {}
            addr = it.get("address") or {}
            geo = it.get("geo") or {}
            fs = it.get("floorSize") or {}
            items.append({
                "id": f"cnm-{lid}",
                "source": SOURCE,
                "url": url,
                "title": o.get("name") or "",
                "price_brl": num(o.get("price")),
                "schema_type": it.get("@type"),
                "bedrooms": num(it.get("numberOfBedrooms") or it.get("numberOfRooms")),
                "bathrooms": num(it.get("numberOfBathroomsTotal")),
                "area_m2": num(fs.get("value") or fs.get("unitText")),
                "street": (addr.get("streetAddress") or "").strip(),
                "neighbourhood": (addr.get("addressLocality") or "").strip(),
                "region": (addr.get("addressRegion") or "").strip(),
                "lat": num(geo.get("latitude")),
                "lon": num(geo.get("longitude")),
                "photos": [it["image"]] if isinstance(it.get("image"), str) else list(it.get("image") or []),
                "agency": ((o.get("offeredBy") or {}).get("name") or "").strip(),
                **slug_facts(url),
            })
        total = num(offers.get("numberOfItems"))
        return items, int(total) if total is not None else None
    return [], None


def parse_detail_page(page: str) -> dict:
    out: dict = {}
    for obj in jsonld_objects(page):
        if obj.get("@type") != "RealEstateListing":
            continue
        out["date_posted"] = (obj.get("datePosted") or "")[:10] or None
        out["date_modified"] = (obj.get("dateModified") or "")[:10] or None
        if obj.get("description"):
            out["description"] = re.sub(r"\s+", " ", html.unescape(obj["description"])).strip()
        about = obj.get("about") or {}
        imgs = about.get("image") or []
        if isinstance(imgs, str):
            imgs = [imgs]
        if imgs:
            out["photos"] = list(dict.fromkeys(imgs))
        summary = about.get("description") or ""
        m = re.search(r"Falar com (.+?), ref\.?:?\s*(?:do im[oó]vel:?)?\s*([^.]+)?", summary)
        if m:
            out["agency"] = m.group(1).strip()
            if m.group(2):
                out["agency_ref"] = m.group(2).strip()
        g = re.search(r"(\d+) garage", summary)
        if g:
            out["parking"] = float(g.group(1))
        offer = about.get("offers") or {}
        it = offer.get("itemOffered") or {}
        fs = it.get("floorSize") or {}
        if num(fs.get("value")):
            out["area_m2"] = num(fs.get("value"))
        if num(offer.get("price")):
            out["price_brl"] = num(offer.get("price"))
        addr = it.get("address") or {}
        if addr.get("streetAddress"):
            out["street"] = addr["streetAddress"].strip()
        out["amenities"] = [a.get("name") for a in it.get("amenityFeature") or []
                            if isinstance(a, dict) and a.get("name") and a.get("value", True)]
        break
    return out


def scout_chaves_na_mao(http: Http, cfg: dict) -> tuple[dict[str, dict], list[dict]]:
    """Returns (listings by id, per-page coverage notes)."""
    found: dict[str, dict] = {}
    coverage: list[dict] = []
    for town in cfg["towns"]:
        for cat in cfg["categories"]:
            url = f"{BASE}/{cat['slug']}/{town['slug']}/"
            log(f"- {town['name']} / {cat['label']}")
            page = http.get(url)
            if page is None:
                coverage.append({"town": town["name"], "category": cat["label"], "url": url,
                                 "ok": False, "shown": 0, "total": None})
                continue
            items, total = parse_search_page(page)
            # When a search has few results the site pads the page with similar listings from
            # other searches; the real matches come first, so keep only as many as it reports.
            if total is not None:
                items = items[:total]
            coverage.append({"town": town["name"], "category": cat["label"], "url": url, "ok": True,
                             "shown": len(items), "total": total if total is not None else len(items)})
            for it in items:
                it["town"] = next((t["name"] for t in cfg["towns"] if f"-{t['slug']}-" in it["url"]), town["name"])
                it["category"] = cat["label"]
                prev = found.get(it["id"])
                # a house listed under both "House" and "House in condominium" keeps the more specific one
                if prev and prev["category"] == "House in condominium":
                    continue
                found[it["id"]] = {**(prev or {}), **it}
    return found, coverage


# --------------------------------------------------------------------------- state


def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    return {"meta": {}, "listings": {}}


def save_state(path: Path, state: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1, sort_keys=True), "utf-8")
    tmp.replace(path)


def property_type(rec: dict) -> str:
    kind = rec.get("kind") or ""
    if kind in KIND_LABELS:
        label = KIND_LABELS[kind]
        if label == "House" and rec.get("category") == "House in condominium":
            return "House in condominium"
        return label
    return rec.get("category") or "Other"


def merge(state: dict, found: dict[str, dict], coverage: list[dict], fx: dict, cfg: dict) -> list[dict]:
    """Fold this run into the stored history. Returns the list of change events."""
    now = today()
    events: list[dict] = []
    listings = state.setdefault("listings", {})
    complete_pages = {(c["town"], c["category"]) for c in coverage
                      if c["ok"] and c["total"] is not None and c["shown"] >= c["total"]}

    for lid, new in found.items():
        old = listings.get(lid)
        if old is None:
            rec = {**new, "first_seen": now, "last_seen": now, "status": "active",
                   "price_history": [{"date": now, "brl": new.get("price_brl")}]}
            listings[lid] = rec
            events.append({"kind": "new", "id": lid})
            continue
        was_gone = old.get("status") == "removed"
        old_price = old.get("price_brl")
        keep = {k: old[k] for k in ("first_seen", "price_history", "description", "amenities",
                                    "date_posted", "date_modified", "detail_fetched", "agency_ref",
                                    "parking") if k in old}
        # search pages give one photo; keep the full gallery fetched from the listing page
        photos = old.get("photos") if len(old.get("photos") or []) > len(new.get("photos") or []) else new.get("photos")
        rec = {**old, **new, **keep, "photos": photos, "last_seen": now, "status": "active"}
        if new.get("price_brl") and old_price and abs(new["price_brl"] - old_price) >= 1:
            rec["price_history"] = rec.get("price_history", []) + [{"date": now, "brl": new["price_brl"]}]
            rec.pop("detail_fetched", None)   # look at the listing again
            events.append({"kind": "price_down" if new["price_brl"] < old_price else "price_up",
                           "id": lid, "from": old_price, "to": new["price_brl"]})
        if was_gone:
            events.append({"kind": "back", "id": lid})
        listings[lid] = rec

    for lid, rec in listings.items():
        if lid in found or rec.get("status") == "removed":
            continue
        # only call a listing removed when its search page was read in full
        if (rec.get("town"), rec.get("category")) in complete_pages:
            rec["status"] = "removed"
            rec["removed_on"] = now
            events.append({"kind": "removed", "id": lid})

    state["meta"] = {"last_run": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                     "first_run": (state.get("meta") or {}).get("first_run") or now,
                     "fx": fx, "coverage": coverage, "source": SOURCE, "home": cfg["home"]}
    return events


def derive(state: dict, cfg: dict):
    """Fields computed from the stored ones: type, euro price, euro per m², distance, price change."""
    fx = state["meta"]["fx"]
    home = cfg["home"]
    listings = state["listings"]
    for rec in listings.values():
        rec["type"] = property_type(rec)
        p = rec.get("price_brl")
        rec["price_eur"] = round(p * fx["rate"]) if p else None
        land = rec.get("total_area_m2")
        built = rec.get("area_m2")
        basis = (land or built) if rec["type"].startswith("Land") or rec["type"] in ("Farm", "Smallholding") else (built or land)
        rec["eur_per_m2"] = round(rec["price_eur"] / basis) if rec["price_eur"] and basis else None
        if rec.get("lat") and rec.get("lon"):
            rec["km_from_home"] = round(haversine_km(home["lat"], home["lon"], rec["lat"], rec["lon"]), 1)
        hist = [h["brl"] for h in rec.get("price_history", []) if h.get("brl")]
        rec["price_change_pct"] = round((hist[-1] - hist[0]) / hist[0] * 100, 1) if len(hist) > 1 else None


def fetch_details(http: Http, state: dict, cfg: dict, limit: int):
    now = dt.date.today()
    todo = []
    for rec in state["listings"].values():
        if rec.get("status") != "active":
            continue
        last = rec.get("detail_fetched")
        if last and (now - dt.date.fromisoformat(last)).days < cfg["detail_refresh_days"]:
            continue
        todo.append(rec)
    todo.sort(key=lambda r: r.get("detail_fetched") or "")   # never-fetched first
    if len(todo) > limit:
        log(f"{len(todo)} listings need details; fetching {limit} this run")
        todo = todo[:limit]
    for i, rec in enumerate(todo, 1):
        log(f"  details {i}/{len(todo)}: {rec['id']}")
        page = http.get(rec["url"])
        if page is None:
            continue
        d = parse_detail_page(page)
        d = {k: v for k, v in d.items() if v not in (None, "", [])}
        rec.update(d)
        rec["detail_fetched"] = today()


def apply_filters(state: dict, cfg: dict):
    f = cfg.get("filters") or {}
    lo, hi = f.get("min_price_eur"), f.get("max_price_eur")
    for rec in state["listings"].values():
        e = rec.get("price_eur")
        rec["outside_filters"] = bool(e and ((lo and e < lo) or (hi and e > hi)))


# --------------------------------------------------------------------------- change summary


def changes_markdown(events: list[dict], state: dict) -> str:
    if not events:
        return ""
    L = state["listings"]
    fx = state["meta"]["fx"]

    def line(rec, extra=""):
        eur = f"€{rec['price_eur']:,.0f}" if rec.get("price_eur") else "price on request"
        bits = [rec.get("type", ""), rec.get("town", "")]
        if rec.get("bedrooms"):
            bits.append(f"{rec['bedrooms']:.0f} bed")
        area = rec.get("area_m2") or rec.get("total_area_m2")
        if area:
            bits.append(f"{area:,.0f} m²")
        return f"- **{eur}** {extra}· {' · '.join(b for b in bits if b)} — [{rec.get('title','listing')[:90]}]({rec['url']})"

    out = [f"Property scout run {state['meta']['last_run']} (1 BRL = €{fx['rate']:.4f})", ""]
    groups = [("new", "New listings"), ("price_down", "Price drops"), ("price_up", "Price rises"),
              ("back", "Back on the market"), ("removed", "Removed")]
    for kind, head in groups:
        evs = [e for e in events if e["kind"] == kind and e["id"] in L and not L[e["id"]].get("outside_filters")]
        if not evs:
            continue
        out += [f"### {head} ({len(evs)})", ""]
        for e in evs:
            rec = L[e["id"]]
            extra = ""
            if kind.startswith("price"):
                extra = f"(was €{e['from'] * fx['rate']:,.0f}) "
            out.append(line(rec, extra))
        out.append("")
    return "\n".join(out) if len(out) > 2 else ""


# --------------------------------------------------------------------------- photos for a self-contained report


def embed_photos(http: Http, rec: dict, n: int) -> list[str]:
    PHOTO_CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for i, url in enumerate((rec.get("photos") or [])[:n]):
        path = PHOTO_CACHE / f"{rec['id']}-{i}.jpg"
        if not path.exists():
            data = http.get(small_photo(url), binary=True)
            if not data:
                continue
            path.write_bytes(data)
        out.append("data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode())
    return out


def build_report(state: dict, out: Path, http: Http | None, embed: int):
    from report import render  # local module

    listings = []
    for rec in state["listings"].values():
        r = {k: rec.get(k) for k in (
            "id", "url", "title", "type", "town", "neighbourhood", "street", "price_brl", "price_eur",
            "eur_per_m2", "area_m2", "total_area_m2", "bedrooms", "bathrooms", "parking", "agency",
            "agency_ref", "description", "amenities", "date_posted", "date_modified", "first_seen",
            "last_seen", "status", "removed_on", "price_history", "price_change_pct", "km_from_home",
            "lat", "lon", "source", "outside_filters")}
        photos = rec.get("photos") or []
        if embed and http is not None and rec.get("status") == "active":
            r["photos"] = embed_photos(http, rec, embed)
            r["more_photos"] = max(0, len(photos) - len(r["photos"]))
        else:
            r["photos"] = [big_photo(p) for p in photos]
            r["more_photos"] = 0
        listings.append(r)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(listings, state["meta"]), "utf-8")
    log(f"report: {out} ({out.stat().st_size / 1e6:.1f} MB, {len(listings)} listings)")


# --------------------------------------------------------------------------- main


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    ap.add_argument("--report-only", action="store_true", help="rebuild the report from stored data, no scouting")
    ap.add_argument("--no-details", action="store_true", help="skip the per-listing pages (faster, fewer photos)")
    ap.add_argument("--max-details", type=int, help="listing pages to read this run")
    ap.add_argument("--embed-photos", type=int, default=0, metavar="N",
                    help="put N photos per listing inside the report (for sharing a single file)")
    ap.add_argument("--changes", type=Path, help="write a Markdown summary of what changed")
    args = ap.parse_args(argv)

    sys.path.insert(0, str(HERE))
    cfg = json.loads(args.config.read_text("utf-8"))
    http = Http(cfg["user_agent"], cfg["request_delay_seconds"])
    state = load_state(args.data)

    if not args.report_only:
        log("Exchange rate…")
        fx = brl_to_eur_rate(http, cfg["fx_fallback_brl_to_eur"])
        log(f"  1 BRL = {fx['rate']:.4f} EUR ({fx['source']}, {fx['date']})")
        log(f"Scouting {SOURCE}…")
        found, coverage = scout_chaves_na_mao(http, cfg)
        if not found:
            log("No listings found at all; leaving stored data untouched.")
            return 2
        events = merge(state, found, coverage, fx, cfg)
        if not args.no_details:
            log("Reading listing pages…")
            fetch_details(http, state, cfg, args.max_details or cfg["max_detail_fetches_per_run"])
        derive(state, cfg)
        apply_filters(state, cfg)
        save_state(args.data, state)
        counts = {}
        for e in events:
            counts[e["kind"]] = counts.get(e["kind"], 0) + 1
        log(f"Done: {len(found)} listings seen; changes: {counts or 'none'}")
        if args.changes:
            args.changes.write_text(changes_markdown(events, state), "utf-8")

    if not state.get("listings"):
        log("No stored listings yet; run without --report-only first.")
        return 1
    build_report(state, args.report, http, args.embed_photos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
