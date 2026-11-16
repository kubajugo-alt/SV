# Gostoso Property Scout

Looks for houses, land and other property for sale in São Miguel do Gostoso (Rio Grande
do Norte, Brazil) and the towns around it, converts every price to euros, keeps the
history of each listing and builds one HTML page with photos, details and filters.

## Run it

Python 3.9+ and nothing else (standard library only).

```sh
python3 property_scout/scout.py                 # scout, then write property_scout/report/index.html
open property_scout/report/index.html            # macOS; any browser works
```

The first run reads every listing page, so it takes a few minutes; it waits 1.5 s
between requests. Later runs only read listings that are new, changed price, or were
last read more than a week ago.

| Option | What it does |
|---|---|
| `--report-only` | Rebuild the page from the stored history, no web requests |
| `--no-details` | Search pages only: faster, but one photo per listing and no descriptions |
| `--embed-photos 4` | Put 4 photos per listing inside the page, so the single file can be sent to someone |
| `--changes changes.md` | Write what is new, cheaper, more expensive or removed since the last run |
| `--report path.html` | Write the page somewhere else |

## What the page shows

- Price in euros (and the original reais), euros per m² (plot size for land, built area otherwise)
- Type, bedrooms, bathrooms, parking, built area and plot / total area
- Neighbourhood, street, town and distance from the centre of Gostoso
- Agency and its reference, date listed, full Portuguese description with a translate link, features
- Every photo (a gallery in the details view)
- Badges for new listings and price drops, and the price history
- Filters by type, town, maximum price in euros, bedrooms, text search ("piscina", "praia",
  "Tourinhos"…), and a shortlist you can star (kept in your browser)

## Every day on GitHub

`.github/workflows/property-scout.yml` runs the scout every morning at 06:17 Brazil time. It
commits the history (`data/listings.json`) and the page (`report/index.html`), attaches a
self-contained copy of the page with photos to the run, and opens an issue that lists new
listings and price changes. GitHub emails new issues to people who watch the repository,
so watching it is enough to get an alert. It can also be started by hand from the
Actions tab ("property scout", Run workflow).

## Where the listings come from

[Chaves na Mão](https://www.chavesnamao.com.br), one of the big Brazilian portals, which
carries listings from many local agencies (RE/MAX, Kacá Borges, TR Imóveis and others).
The scout reads its public search pages per town and property type and each listing's
page, using the structured data (schema.org) the site publishes for search engines. It
follows the site's robots.txt, sends one request at a time and identifies itself.

ZAP Imóveis, VivaReal, OLX, Imovelweb and Casa Mineira refuse automated visitors, so
they are not scouted. Many Gostoso agencies post the same properties on several
portals, so this source covers much of the market, but not all of it. Worth checking by
hand now and then: VivaReal, ZAP, OLX, and local agencies' own sites and Instagram pages.

Search pages show at most 30 listings. If a town and type ever has more, the page's
footer says so and links to the rest on the site.

## Settings (`config.json`)

- `towns`: the towns to search, by the site's slug (`rn-touros`). Defaults: São Miguel do
  Gostoso, Touros (Santo Cristo, Perobas, Carnaubinha), São Bento do Norte, Pedra Grande,
  Parazinho.
- `categories`: the property types to search.
- `filters.min_price_eur` / `max_price_eur`: listings outside this range are left out of the
  page and the alerts (they stay in the history). The minimum of €5,000 removes ads with
  placeholder prices.
- `detail_refresh_days`, `request_delay_seconds`, `max_detail_fetches_per_run`.

Euro prices use the European Central Bank's rate of the day (via frankfurter.dev), then
the Polish central bank's cross rate if that fails, then `fx_fallback_brl_to_eur`.

## Before buying

Asking prices are what the ads say. Confirm every detail with the agency, ask for the
property's *matrícula* (land registry record) and *certidões negativas*, check that the
agent has a CRECI registration, and be careful with beachfront land, which may sit on
federal coastal land (*terreno de marinha*).

## Tests

```sh
python3 -m unittest tests.test_property_scout -v
```
