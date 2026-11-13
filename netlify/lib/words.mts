// Polish text helpers shared by the search over his memories, notes and old talks.
// (The same rules as past.py.)

const COMMON = new Set(`a aby ale albo bo by byl byla bylo byly co czy czym dla do go i ich im jak jako je jego jej jest jestes juz kiedy kim kto ktora
ktory ktorym ma mi mnie moze na nad nie nim o od on ona one oni opowiedz po pod powiedz przez przy sa sie skad ta tak tam te tego tej ten to tobie
tu ty tym w we wtedy z za cie ci twoj twoja twoje cos mial miales pamietasz wiesz stalo stal jakis jakies jakas kiedys bardzo prosze czemu dlaczego gdzie ile`.split(/\s+/));

const SAME: Record<string, string> = {
  ojca: "ojciec", ojcem: "ojciec", ojcu: "ojciec", ojcze: "ojciec", tata: "ojciec", taty: "ojciec", tato: "ojciec",
  mama: "matka", mamy: "matka", mame: "matka", mamie: "matka", psa: "pies", kota: "kot", kotem: "kot",
  dziadkiem: "dziadek", dziadku: "dziadek", dziadka: "dziadek", chlopak: "partner", chlopaka: "partner",
  facet: "partner", faceta: "partner", maz: "partner", meza: "partner", kochales: "milosc", kochasz: "milosc",
  vaskiem: "vasco", vaskowi: "vasco", vasku: "vasco",
};

/** Lower case without accents of any language: Zé -> ze, Inês -> ines, łódź -> lodz. */
export function plain(word: string): string {
  return word.toLowerCase().replaceAll("ł", "l").normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Words reduced so that Polish endings do not matter. */
export function stems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    let word = plain(raw);
    word = SAME[word] ?? word;
    if (word.length > 1 && !COMMON.has(word)) {
      out.push(word.length <= 5 ? word.slice(0, 4) : word.slice(0, 5));
    }
  }
  return out;
}
