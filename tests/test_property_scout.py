"""Offline tests for property_scout: parsing, euro conversion and change tracking. No network."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "property_scout"))

import scout  # noqa: E402
import report  # noqa: E402


def ld(obj):
    return f'<script type="application/ld+json">{json.dumps(obj, ensure_ascii=False)}</script>'


def offer(lid, price, slug, town="rn-sao-miguel-do-gostoso", rooms=2):
    return {
        "@type": "Offer", "name": f"Casa {lid}", "price": str(price), "priceCurrency": "BRL",
        "url": f"https://www.chavesnamao.com.br/imovel/{slug}-{town}-centro-240m2-RS{price}/id-{lid}/",
        "itemOffered": {"@type": "SingleFamilyResidence", "numberOfBedrooms": rooms, "numberOfBathroomsTotal": 1,
                        "floorSize": {"unitText": "110m²"},
                        "address": {"addressLocality": "Centro", "addressRegion": "São Miguel do Gostoso, RN",
                                    "streetAddress": "Rua dos Pescadores"},
                        "geo": {"latitude": "-5.12", "longitude": "-35.63"},
                        "image": "https://www.chavesnamao.com.br/imn/0340X0250/N/80/imoveis/1/x-1.jpg"},
        "offeredBy": {"@type": "RealEstateAgent", "name": "Agência Teste"},
    }


def search_page(offers, total):
    return "<html>" + ld({"@context": "https://schema.org", "@type": "Organization", "name": "x"}) + ld({
        "@type": "RealEstateListing",
        "offers": {"@type": "ItemList", "numberOfItems": total, "itemListElement": offers}}) + "</html>"


DETAIL = "<html>" + ld({"@graph": [{"@type": "WebPage"}, {
    "@type": "RealEstateListing", "datePosted": "2025-06-12T20:06:07.000Z", "dateModified": "2026-05-27T03:17:28.000Z",
    "description": "Casa térrea &amp; piscina,   perto da praia.",
    "about": {"@type": "Product",
              "description": "Comprar Casa por R$ 420000 com 2 quartos, 6 garagens e com 110m². Falar com TR IMÓVEIS, ref: do imóvel: CA8174.",
              "image": ["https://www.chavesnamao.com.br/imn/1200x0800/N/70/imoveis/1/a-1.jpg",
                        "https://www.chavesnamao.com.br/imn/1200x0800/N/70/imoveis/1/a-2.jpg"],
              "offers": {"price": 420000, "itemOffered": {
                  "floorSize": {"value": "110"},
                  "address": {"streetAddress": "Avenida Dos Arecifes"},
                  "amenityFeature": [{"name": "Piscina", "value": True}, {"name": "Lareira", "value": False}]}}}}]}) + "</html>"

CFG = {"home": {"name": "São Miguel do Gostoso", "lat": -5.1236, "lon": -35.6355},
       "towns": [{"name": "São Miguel do Gostoso", "slug": "rn-sao-miguel-do-gostoso"}, {"name": "Touros", "slug": "rn-touros"}],
       "categories": [{"label": "House", "slug": "casas-a-venda"}],
       "filters": {"min_price_eur": 5000, "max_price_eur": None}}
FX = {"rate": 0.16, "date": "2026-11-16", "source": "test"}


class FakeHttp:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, binary=False):
        return self.pages.get(url)


class Parsing(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(scout.num("1483848"), 1483848)
        self.assertEqual(scout.num("R$ 1.483.848"), 1483848)
        self.assertEqual(scout.num("1.234,56"), 1234.56)
        self.assertEqual(scout.num("382m²"), 382)
        self.assertEqual(scout.num("-35.63595"), -35.63595)
        self.assertIsNone(scout.num(None))

    def test_slug(self):
        f = scout.slug_facts("https://www.chavesnamao.com.br/imovel/casa-em-condominio-a-venda-3-quartos-rn-touros-centro-400m2-RS450000/id-16243411/")
        self.assertEqual(f, {"kind": "casa-em-condominio", "total_area_m2": 400.0})
        self.assertEqual(scout.listing_id("https://x/imovel/a/id-123/"), "123")

    def test_search_page(self):
        items, total = scout.parse_search_page(search_page([offer(1, 420000, "casa-a-venda-2-quartos")], 1))
        self.assertEqual(total, 1)
        it = items[0]
        self.assertEqual((it["id"], it["price_brl"], it["bedrooms"], it["area_m2"]), ("cnm-1", 420000, 2, 110))
        self.assertEqual((it["lat"], it["lon"]), (-5.12, -35.63))
        self.assertEqual(it["agency"], "Agência Teste")
        self.assertEqual(it["total_area_m2"], 240)

    def test_detail_page(self):
        d = scout.parse_detail_page(DETAIL)
        self.assertEqual(d["agency"], "TR IMÓVEIS")
        self.assertEqual(d["agency_ref"], "CA8174")
        self.assertEqual(d["parking"], 6)
        self.assertEqual(d["amenities"], ["Piscina"])
        self.assertEqual(d["description"], "Casa térrea & piscina, perto da praia.")
        self.assertEqual(len(d["photos"]), 2)
        self.assertEqual(d["date_posted"], "2025-06-12")

    def test_photo_sizes(self):
        u = "https://www.chavesnamao.com.br/imn/0340X0250/N/80/imoveis/1/x-1.jpg"
        self.assertIn("/imn/0640x0400/N/60/", scout.small_photo(u))
        self.assertIn("/imn/1200x0800/N/70/", scout.big_photo(u))


class Tracking(unittest.TestCase):
    def run_once(self, offers, total):
        url = "https://www.chavesnamao.com.br/casas-a-venda/rn-sao-miguel-do-gostoso/"
        pages = {url: search_page(offers, total)}
        cfg = {**CFG, "towns": CFG["towns"][:1]}
        found, cov = scout.scout_chaves_na_mao(FakeHttp(pages), cfg)
        events = scout.merge(self.state, found, cov, FX, cfg)
        scout.derive(self.state, cfg)
        return events

    def setUp(self):
        self.state = {"meta": {}, "listings": {}}

    def test_new_then_price_drop_then_removed(self):
        ev = self.run_once([offer(1, 420000, "casa-a-venda-2-quartos"), offer(2, 300000, "casa-a-venda-1-quarto")], 2)
        self.assertEqual(sorted(e["kind"] for e in ev), ["new", "new"])
        rec = self.state["listings"]["cnm-1"]
        self.assertEqual(rec["price_eur"], 67200)
        self.assertEqual(rec["type"], "House")
        self.assertEqual(rec["eur_per_m2"], round(67200 / 110))

        ev = self.run_once([offer(1, 400000, "casa-a-venda-2-quartos"), offer(2, 300000, "casa-a-venda-1-quarto")], 2)
        self.assertEqual(ev, [{"kind": "price_down", "id": "cnm-1", "from": 420000, "to": 400000}])
        self.assertEqual(len(self.state["listings"]["cnm-1"]["price_history"]), 2)
        self.assertAlmostEqual(self.state["listings"]["cnm-1"]["price_change_pct"], -4.8)

        ev = self.run_once([offer(1, 400000, "casa-a-venda-2-quartos")], 1)
        self.assertEqual(ev, [{"kind": "removed", "id": "cnm-2"}])
        self.assertEqual(self.state["listings"]["cnm-2"]["status"], "removed")

        ev = self.run_once([offer(1, 400000, "casa-a-venda-2-quartos"), offer(2, 300000, "casa-a-venda-1-quarto")], 2)
        self.assertEqual([e["kind"] for e in ev], ["back"])

    def test_padding_and_partial_pages(self):
        # the site pads short result pages with other listings; only the first `total` count
        ev = self.run_once([offer(1, 420000, "casa-a-venda-2-quartos"), offer(9, 999000, "casa-a-venda-5-quartos", town="rn-natal")], 1)
        self.assertEqual(list(self.state["listings"]), ["cnm-1"])
        # a page showing fewer than the total never marks anything removed
        self.run_once([offer(2, 300000, "casa-a-venda-1-quarto")], 40)
        self.assertEqual(self.state["listings"]["cnm-1"]["status"], "active")

    def test_changes_summary_and_report(self):
        self.run_once([offer(1, 420000, "casa-a-venda-2-quartos")], 1)
        ev = self.run_once([offer(1, 380000, "casa-a-venda-2-quartos")], 1)
        scout.apply_filters(self.state, CFG)
        md = scout.changes_markdown(ev, self.state)
        self.assertIn("Price drops (1)", md)
        self.assertIn("€60,800", md)
        page = report.render(list(self.state["listings"].values()), self.state["meta"])
        self.assertIn("<title>Gostoso Property Scout</title>", page[:200])
        self.assertNotIn("__DATA__", page)


class Cli(unittest.TestCase):
    def test_report_only_needs_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            rc = scout.main(["--report-only", "--data", os.path.join(tmp, "none.json"),
                             "--report", os.path.join(tmp, "r.html")])
            self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()
