// Where to eat, drink and go out in Tarnobrzeg and Sandomierz.
// The list comes from OpenStreetMap through the Overpass API (data © OpenStreetMap contributors, ODbL),
// is kept in the store and refreshed weekly; the household's own notes about places are kept beside it.
import type { Store } from "./store.mts";
import { stems } from "./words.mts";

export type Place = { name: string; town: string; kind: string; address?: string; phone?: string; hours?: string; website?: string; cuisine?: string; note?: string };
export type Places = { at: string; rows: Place[] };
export type PlaceNote = { name: string; town: string; text: string; who: string; at: string };

/** South, west, north, east. Sandomierz first: where the boxes meet, a place belongs to it. */
export const TOWNS: Record<string, [number, number, number, number]> = {
  Sandomierz: [50.645, 21.68, 50.72, 21.80],
  Tarnobrzeg: [50.5, 21.58, 50.645, 21.80],
};

/** OSM key -> value -> the kind he speaks of. */
const KINDS: Record<string, Record<string, string>> = {
  amenity: { restaurant: "restauracja", bar: "bar", pub: "pub", cafe: "kawiarnia", fast_food: "szybkie jedzenie", ice_cream: "lodziarnia", biergarten: "ogródek piwny",
    nightclub: "klub", theatre: "teatr", cinema: "kino", library: "biblioteka", arts_centre: "dom kultury", community_centre: "dom kultury", marketplace: "targ" },
  shop: { bakery: "piekarnia", pastry: "cukiernia", confectionery: "cukiernia", wine: "sklep z winem" },
  craft: { winery: "winnica", brewery: "browar" },
  tourism: { museum: "muzeum", gallery: "galeria", attraction: "atrakcja", viewpoint: "punkt widokowy" },
  historic: { castle: "zamek", monument: "zabytek", city_gate: "zabytek", ruins: "zabytek", church: "zabytkowy kościół" },
};
const SERVERS = ["https://overpass-api.de", "https://overpass.private.coffee", "https://overpass.kumi.systems"];   // the same data on each

export function overpassQuery(town: string): string {
  const box = TOWNS[town].join(",");
  const parts = Object.entries(KINDS).map(([key, values]) => `nwr["${key}"~"^(${Object.keys(values).join("|")})$"]["name"](${box});`).join("");
  return `[out:json][timeout:20];(${parts});out tags center;`;
}

/** One OSM element -> a place, or null when it is not one of the kinds above. */
export function placeOf(tags: Record<string, string>, town: string): Place | null {
  const kind = Object.entries(KINDS).map(([key, values]) => values[tags[key]]).find(Boolean);
  if (!kind || !tags.name?.trim()) return null;
  const address = [tags["addr:street"] ?? tags["addr:place"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const place: Place = { name: tags.name.trim(), town, kind };
  const more: [keyof Place, string | undefined][] = [["address", address], ["phone", tags["contact:phone"] ?? tags.phone], ["hours", tags.opening_hours],
    ["website", tags["contact:website"] ?? tags.website], ["cuisine", tags.cuisine?.replace(/;/g, ", ").replace(/_/g, " ")], ["note", tags["description:pl"] ?? tags.description]];
  for (const [key, value] of more) if (value?.trim()) place[key] = value.trim().slice(0, 300);
  return place;
}

/** Download both towns afresh. Throws when no server answers. */
export async function fetchPlaces(now: Date, fetcher: typeof fetch = fetch): Promise<Places> {
  const found = new Map<string, Place>();
  // Both towns at once, each from the first server that answers: the whole download has to fit in one function call.
  const lists = await Promise.all(Object.keys(TOWNS).map(async (town) => {
    for (const server of SERVERS) {
      try {
        const res = await fetcher(`${server}/api/interpreter`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "alan-home-places/1.0" },
          body: new URLSearchParams({ data: overpassQuery(town) }), signal: AbortSignal.timeout(7000) });
        if (res.ok) return { town, elements: ((await res.json()).elements ?? []) as { tags?: Record<string, string> }[] };
      } catch { /* the next server */ }
    }
    throw new Error("serwery map nie odpowiedziały");
  }));
  for (const { town, elements } of lists) {
    for (const element of elements) {
      const place = placeOf(element.tags ?? {}, town);
      const key = place && `${place.name.toLowerCase()}|${place.address ?? ""}`;
      if (place && (!found.has(key!) || Object.keys(place).length > Object.keys(found.get(key!)!).length)) found.set(key!, place);   // mapped twice: the fuller entry
    }
  }
  if (found.size < 5) throw new Error("serwer map zwrócił pustą listę");       // never replace a good list with nothing
  return { at: now.toISOString(), rows: [...found.values()].sort((a, b) => a.town.localeCompare(b.town) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "pl")) };
}

/** The stored list; downloaded when there is none yet or when forced (the weekly run). A failed download keeps the old list. */
export async function loadPlaces(store: Store, now: Date, fetcher?: typeof fetch, force = false): Promise<Places | null> {
  const have = await store.get<Places>("places");
  if (have && !force) return have;
  try {
    const fresh = await fetchPlaces(now, fetcher);
    await store.set("places", fresh);
    return fresh;
  } catch (err) {
    console.log(`Places not refreshed: ${(err as Error).message}`);
    return have;
  }
}

const has = (hay: string, wanted: string[]) => { const got = new Set(stems(hay)); return wanted.every((w) => got.has(w)); };

/** Places matching the town, the kind and the words, each with what the household noted about it. */
export function findPlaces(places: Place[], notes: PlaceNote[], ask: { query?: string; town?: string; kind?: string }): string {
  const town = Object.keys(TOWNS).find((t) => stems(ask.town ?? "").some((s) => stems(t).includes(s)));
  const kind = stems(ask.kind ?? "");
  const words = stems(ask.query ?? "");
  const noted = (p: { name: string; town: string }) => notes.filter((n) => n.town === p.town && n.name.toLowerCase() === p.name.toLowerCase());
  const own: Place[] = notes.filter((n) => !places.some((p) => p.town === n.town && p.name.toLowerCase() === n.name.toLowerCase()))
    .filter((n, i, all) => all.findIndex((m) => m.name.toLowerCase() === n.name.toLowerCase() && m.town === n.town) === i)
    .map((n) => ({ name: n.name, town: n.town, kind: "miejsce dopisane przez domowników" }));
  const hits = [...places, ...own].filter((p) => (!town || p.town === town)
    && (!kind.length || has(`${p.kind} ${p.cuisine ?? ""}`, kind))
    && (!words.length || has(`${p.name} ${p.kind} ${p.cuisine ?? ""} ${p.note ?? ""} ${p.address ?? ""} ${noted(p).map((n) => n.text).join(" ")}`, words)));
  if (!hits.length) return "W bazie miejsc nic takiego nie ma. Możesz poszukać w sieci.";
  hits.sort((a, b) => noted(b).length - noted(a).length || Object.keys(b).length - Object.keys(a).length);     // what the household knows first, then the fuller entries
  const lines = hits.slice(0, 8).map((p) => [`${p.name} (${p.kind}, ${p.town})`, p.address && `adres: ${p.address}`, p.cuisine && `kuchnia: ${p.cuisine}`, p.phone && `tel. ${p.phone}`,
    p.hours && `godziny: ${p.hours}`, p.website && `strona: ${p.website}`, p.note, ...noted(p).map((n) => `notatka domowników (${n.who}): ${n.text}`)].filter(Boolean).join("; "));
  return `Miejsca (${hits.length > 8 ? `8 z ${hits.length}` : hits.length}): ${lines.join(" | ")}.`;
}
