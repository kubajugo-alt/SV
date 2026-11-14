// ALAN's tools in the cloud: the same ones as own.py, past.py, diary.py and the
// weather from online.py. Each returns a sentence in Polish; "Wykonano" marks a
// change he made, "Błąd" something that could not be done.
import type Anthropic from "@anthropic-ai/sdk";
import { DAYS, dmy, hm, instant, local, span } from "./clock.mts";
import { describe, occurrences, parse, readCalendars } from "./diary.mts";
import { addEvent, changeEvent, type Google } from "./gcal.mts";
import { callOutcome, CALLS_A_DAY, placeCall, polishNumber, type Phone } from "./phone.mts";
import { parseMemories, recallPast } from "./past.mts";
import { findPlaces, loadPlaces, TOWNS } from "./places.mts";
import type { Cameras } from "./cameras.mts";
import { moved, newEvent, onDay, toIcs, whenText } from "./owncal.mts";
import { loadOwn, type Own, type Store } from "./store.mts";
import { plain, stems } from "./words.mts";
import { MEMORIES } from "./texts.gen.mjs";

export type Ctx = { store: Store; person: string; tz: string; now: Date; calendars: string[]; google?: Google; builder?: Builder; phone?: Phone; cameras?: Cameras; youtube?: string; fetcher?: typeof fetch };
/**
 * Who changes his own code. Either a Claude Code routine (its id, trig_..., and the token of its API trigger),
 * or the repository on GitHub: he opens an issue titled [ALAN] and a GitHub Actions workflow runs Claude Code on it.
 */
export type Builder = { token: string; routine?: string; repo?: string };

const text = (description: string) => ({ type: "string" as const, description });
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Tool =>
  ({ name, description, input_schema: { type: "object", properties, required } });

export const TOOLS: Anthropic.Tool[] = [
  tool("set_timer", "Ustawia minutnik, który zadzwoni po podanym czasie.",
    { minutes: { type: "number", description: "za ile minut; pół minuty to 0.5" }, label: text("czego dotyczy, np. makaron") }, ["minutes"]),
  tool("set_reminder", "Ustawia przypomnienie albo budzik na konkretną datę i godzinę.",
    { when: text("format RRRR-MM-DD GG:MM, np. 2026-11-17 09:00; sama godzina GG:MM oznacza najbliższą taką godzinę"), text: text("o czym przypomnieć") }, ["when", "text"]),
  tool("show_reminders", "Podaje aktywne minutniki i przypomnienia z ich numerami."),
  tool("cancel_reminder", "Anuluje minutnik lub przypomnienie o podanym numerze (numery podaje show_reminders).", { number: { type: "integer" } }, ["number"]),
  tool("edit_list", "Wspólna lista domowa: dopisuje i skreśla pozycje, a bez zmian po prostu ją odczytuje. Domyślnie lista zakupów.",
    { list: text("nazwa listy, domyślnie zakupy"), add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } }),
  tool("remember", "Zapamiętuje na stałe fakt, o którego zapamiętanie rozmówca wyraźnie poprosił.", { fact: text("pełne zdanie, zrozumiałe bez kontekstu rozmowy") }, ["fact"]),
  tool("forget", "Usuwa zapamiętane fakty dotyczące podanego tematu.", { about: text("słowo lub fraza, której dotyczy fakt") }, ["about"]),
  tool("take_note", "Zapisuje notatkę rozmówcy: pomysł, myśl, rzecz do zrobienia, cokolwiek podyktuje.", { text: text("treść notatki, pełnym zdaniem") }, ["text"]),
  tool("find_notes", "Szuka w notatkach rozmówcy albo podaje ostatnie.",
    { query: text("czego dotyczą; puste = wszystkie z okresu"), days: { type: "integer", description: "z ilu ostatnich dni, domyślnie 30" } }),
  tool("recall_talk", "Szuka w dawnych rozmowach z rozmówcą, co kto kiedy powiedział.", { query: text("słowa kluczowe") }, ["query"]),
  tool("set_place", "Zapisuje, w jakim mieście rozmówca teraz jest, żeby pogoda dotyczyła tego miejsca.", { place: text("miasto w mianowniku, np. Las Palmas") }, ["place"]),
  tool("reading_time", "Liczy, ile potrwa przeczytanie na głos podanego tekstu.", { text: { type: "string" } }, ["text"]),
  tool("recall_past", "Twoje własne wspomnienia: życie Alana Sanchesa, ludzie, których znałeś, romanse, Lizbona 1995 i Gran Canaria 1996. " +
    "Używaj, gdy rozmówca pyta o twoją przeszłość.", { query: text("imiona, miejsca, słowa kluczowe pytania") }, ["query"]),
  tool("weather", "Aktualna pogoda i prognoza na trzy dni tam, gdzie rozmówca teraz jest."),
  tool("calendar", "Odczytuje kalendarz domowników: wydarzenia danego dnia albo kilku kolejnych dni.",
    { day: text("dziś, jutro albo data RRRR-MM-DD; domyślnie dziś"), days: { type: "integer", description: "ile dni od tego dnia, domyślnie 1" } }),
  tool("add_event", "Dopisuje wydarzenie do kalendarza domowników. Tylko gdy rozmówca wyraźnie o to prosi i znasz dzień; gdy brakuje dnia albo godziny, najpierw dopytaj.",
    { title: text("krótki tytuł wydarzenia"), start: text("RRRR-MM-DD GG:MM, a dla wydarzenia całodniowego sama data RRRR-MM-DD"),
      end: text("koniec w tym samym formacie; domyślnie godzina później albo ten sam dzień"), location: text("miejsce, jeśli podano"), notes: text("opis, jeśli podano") }, ["title", "start"]),
  tool("change_event", "Zmienia wydarzenie, które sam dopisałeś do kalendarza: przesuwa je, zmienia tytuł, miejsce albo opis, albo je usuwa. Tylko gdy rozmówca wyraźnie o to prosi. " +
    "Wydarzenie cykliczne zmienia się tylko w tym jednym dniu.",
    { find: text("słowa z obecnego tytułu wydarzenia"), day: text("dzień, w którym wydarzenie jest teraz: RRRR-MM-DD"),
      title: text("nowy tytuł, jeśli ma się zmienić"), start: text("nowy początek: RRRR-MM-DD GG:MM albo RRRR-MM-DD dla całodniowego; długość zostaje, jeśli nie podasz końca"),
      end: text("nowy koniec w tym samym formacie; wymaga podania start"), location: text("nowe miejsce"), notes: text("nowy opis"), cancel: { type: "boolean", description: "true = usuń wydarzenie" } }, ["find", "day"]),
  tool("request_feature", "Zleca programiście (Claude Code) dopisanie tobie nowej umiejętności albo zmianę w tym, jak działasz. " +
    "Tylko gdy rozmówca wyraźnie prosi, żebyś się czegoś nauczył albo coś w sobie zmienił, i tylko raz na prośbę. Zmiana nie dzieje się od razu: powstaje propozycja, którą Kuba musi zatwierdzić.",
    { request: text("co dokładnie ma zostać dodane lub zmienione, pełnymi zdaniami, ze szczegółami podanymi przez rozmówcę") }, ["request"]),
  tool("show_link", "Pokazuje rozmówcy na ekranie link z kodem QR do zeskanowania telefonem: ofertę w sklepie (np. Allegro), restaurację w aplikacji z jedzeniem, stronę rezerwacji. " +
    "Tak pomagasz w zakupach i zamówieniach: znajdujesz w sieci, wybierasz, pokazujesz link. Jedzenie z dostawą domownicy zamawiają przez Glovo i Uber Eats: gdy chcą coś zamówić, najpierw sprawdź ulubione (favourite_food); gdy tam nie ma, wyszukaj w sieci stronę restauracji albo dania na glovoapp.com (np. „Glovo Tarnobrzeg pizza”) i pokaż ją, a gdy się spodoba, zaproponuj zapisanie jej w ulubionych. Sam niczego nie kupujesz ani nie zamawiasz i nigdy nie mów, że to zrobiłeś. Adres bierz z wyników wyszukiwania, nie zmyślaj go.",
    { title: text("krótki opis, np. Filtr do ekspresu, 64 zł, Allegro"), url: text("pełny adres https://") }, ["title", "url"]),
  tool("favourite_food", "Ulubione zamówienia domowników (jedzenie z Glovo, Uber Eats albo z restauracji): szuka ich i pokazuje link z kodem QR do zamówienia jednym ruchem w telefonie, " +
    "albo zapisuje nowe, gdy rozmówca prosi, żeby zapamiętać zamówienie, albo zgodzi się, gdy to zaproponujesz. Sam niczego nie zamawiasz.",
    { action: { type: "string", enum: ["find", "save", "forget"], description: "find: szukaj i pokaż; save: zapisz nowe; forget: usuń" },
      query: text("find/forget: słowa, np. pizza, Roma, to co zawsze; puste = lista wszystkich"),
      name: text("save: krótka nazwa, którą domownicy będą tego szukać, np. pizza z Romy"),
      place: text("save: restauracja albo sklep"), what: text("save: co dokładnie zamawiają, z dodatkami"),
      url: text("save: pełny adres https:// strony z tym daniem albo restauracją w Glovo lub Uber Eats, wzięty z wyszukiwania lub od rozmówcy") }, ["action"]),
  tool("show_map", "Pokazuje na ekranie małą mapę z zaznaczonym miejscem: gdy pytają, gdzie coś jest, jak daleko, albo mówisz o miejscu, które warto zobaczyć na mapie.",
    { place: text("adres albo nazwa miejsca z miastem, np. Zamek Tarnowskich, Tarnobrzeg") }, ["place"]),
  tool("show_picture", "Pokazuje na ekranie zdjęcie: gdy pytają, jak coś albo ktoś wygląda (budynek, zwierzę, potrawa, dzieło, miejsce, postać). " +
    "Szuka zdjęcia w Wikipedii; jeśli masz z wyszukiwania bezpośredni adres obrazka (.jpg, .png, .webp), możesz go podać. Opisz krótko, co widać.",
    { query: text("czego zdjęcie, np. Zamek Krzyżtopór, pierogi ruskie, kot syjamski"), url: text("opcjonalnie: bezpośredni adres https:// obrazka") }, ["query"]),
  tool("music", "Muzyka z YouTube (i YouTube Music), grana na ekranie w domu: puszcza utwór, album, wykonawcę albo zapamiętaną playlistę domowników, zatrzymuje ją, " +
    "zapamiętuje playlistę lub utwór pod nazwą, gdy rozmówca poda link (music.youtube.com albo youtube.com), i zapomina. Zapamiętane szukaj najpierw: „moja playlista do gotowania”.",
    { action: { type: "string", enum: ["play", "stop", "save", "forget", "list"], description: "play: graj; stop: wyłącz; save: zapamiętaj link; forget: zapomnij; list: co zapamiętane" },
      query: text("play/forget: co grać, np. Dawid Podsiadło Małomiasteczkowy, jazz do pracy, moja playlista na wieczór"),
      kind: { type: "string", enum: ["song", "playlist"], description: "play: song = jeden utwór; playlist = album, składanka, wykonawca na dłużej" },
      name: text("save: nazwa, pod którą domownicy będą o to prosić"), url: text("save: link do playlisty albo utworu na YouTube lub YouTube Music") }, ["action"]),
  tool("ride_link", "Przygotowuje przejazd: pokazuje na ekranie link z kodem QR, który otwiera w telefonie aplikację Uber z wpisanym celem (odbiór z miejsca, gdzie jest telefon). " +
    "Przejazd zamawia i potwierdza rozmówca w telefonie. W Tarnobrzegu Uber jeździ, ale aut jest mniej niż w Bolcie, a Bolt nie ma takiego linku: " +
    "pokaż link do Ubera i dodaj, że w Bolcie będzie pewnie szybciej, albo zaproponuj telefon po taksówkę.",
    { destination: text("dokąd: adres albo nazwa miejsca z miastem, np. Lotnisko Rzeszów-Jasionka") }, ["destination"]),
  tool("phone_call", "Dzwoni w imieniu rozmówcy pod polski numer i załatwia jedną sprawę: zamawia taksówkę, jedzenie z dostawą (płatność przy odbiorze), rezerwuje stolik, pyta o godziny otwarcia. " +
    "Numer bierz od rozmówcy albo z wyszukiwania w sieci, nigdy go nie zmyślaj. Pierwsze użycie tylko przygotowuje rozmowę: powtórz wtedy rozmówcy, do kogo i z czym dzwonisz, i zapytaj, czy dzwonić. " +
    "Dopiero gdy w następnej wypowiedzi potwierdzi, użyj narzędzia drugi raz z tymi samymi danymi. Wynik rozmowy poznasz później (call_result).",
    { name: text("do kogo, np. Radio Taxi Tarnobrzeg"), number: text("numer telefonu, 9 cyfr"),
      task: text("co dokładnie załatwić, ze wszystkimi szczegółami: adres, godzina, na kogo, co zamówić, jak zapłacić") }, ["name", "number", "task"]),
  tool("call_result", "Podaje, jak poszły ostatnie rozmowy telefoniczne, które wykonałeś."),
  tool("find_place", "Twoja baza miejsc w Tarnobrzegu i Sandomierzu: restauracje, bary, puby, kawiarnie, cukiernie, winnice, kina, teatry, muzea, galerie, domy kultury, zabytki. " +
    "Podaje adres, telefon, godziny otwarcia, kuchnię i to, co domownicy sami o miejscu powiedzieli. Używaj, gdy pytają, gdzie zjeść, wypić, dokąd pójść, albo o konkretne miejsce. " +
    "Godziny są zapisane skrótami (Mo-Fr 10:00-22:00); podawaj je po ludzku. O bieżący repertuar i wydarzenia pytaj wyszukiwarkę.",
    { query: text("nazwa albo słowa kluczowe, np. pizza, zamek; puste = wszystko danego rodzaju"), town: text("Tarnobrzeg albo Sandomierz; puste = oba"),
      kind: text("rodzaj: restauracja, bar, pub, kawiarnia, cukiernia, winnica, kino, teatr, muzeum, galeria, dom kultury, zabytek...") }),
  tool("note_place", "Zapisuje, co rozmówca powiedział o miejscu w Tarnobrzegu albo Sandomierzu: opinię, co warto zamówić, że zamknięte, że nowe. Dopisuje też miejsce, którego w bazie nie ma. " +
    "Tylko gdy rozmówca wyraźnie coś o miejscu mówi lub prosi o zapisanie.",
    { name: text("nazwa miejsca, tak jak w bazie, jeśli tam jest"), town: text("Tarnobrzeg albo Sandomierz"), text: text("co zapisać, pełnym zdaniem") }, ["name", "town", "text"]),
  tool("look_outside", "Patrzysz przez kamerę internetową, jak naprawdę wygląda teraz na dworze w Tarnobrzegu (nad jeziorem) albo w Sandomierzu: dostajesz zdjęcie. " +
    "Używaj, gdy rozmówca pyta, jak jest na dworze, czy pada, czy trzeba parasol, czy jest mgła; dobrze łączyć z prognozą (weather).",
    { where: text("Tarnobrzeg albo Sandomierz; domyślnie Tarnobrzeg") }),
  tool("briefing", "Odprawa na dziś: pogoda, kalendarz i przypomnienia naraz ('co dziś', 'plan dnia', 'co mnie czeka')."),
];

const PLACES: Record<string, [string, string, number, number, string]> = {
  tarnobrzeg: ["Tarnobrzeg", "Tarnobrzegu", 50.573, 21.679, "Europe/Warsaw"],
  "las palmas": ["Las Palmas de Gran Canaria", "Las Palmas", 28.124, -15.43, "Atlantic/Canary"],
  "gran canaria": ["Las Palmas de Gran Canaria", "Las Palmas", 28.124, -15.43, "Atlantic/Canary"],
  miami: ["Miami", "Miami", 25.774, -80.194, "America/New_York"],
  barcelon: ["Barcelona", "Barcelonie", 41.385, 2.173, "Europe/Madrid"],
  davos: ["Davos", "Davos", 46.802, 9.836, "Europe/Zurich"],
  lizbon: ["Lizbona", "Lizbonie", 38.722, -9.139, "Europe/Lisbon"],
  warszaw: ["Warszawa", "Warszawie", 52.23, 21.011, "Europe/Warsaw"],
  krakow: ["Kraków", "Krakowie", 50.062, 19.938, "Europe/Warsaw"],
  sandomierz: ["Sandomierz", "Sandomierzu", 50.682, 21.749, "Europe/Warsaw"],
  londyn: ["Londyn", "Londynie", 51.507, -0.128, "Europe/London"],
  london: ["Londyn", "Londynie", 51.507, -0.128, "Europe/London"],
  "santo domingo": ["Santo Domingo", "Santo Domingo", 18.486, -69.931, "America/Santo_Domingo"],
  "nowy jork": ["Nowy Jork", "Nowym Jorku", 40.713, -74.006, "America/New_York"],
  singapur: ["Singapur", "Singapurze", 1.352, 103.82, "Asia/Singapore"],
  frankfurt: ["Frankfurt", "Frankfurcie", 50.11, 8.682, "Europe/Berlin"],
};
const HOME = { name: "Tarnobrzeg", where: "Tarnobrzegu", lat: 50.573, lon: 21.679, tz: "Europe/Warsaw" };
const WMO: Record<number, string> = {
  0: "bezchmurnie", 1: "przeważnie pogodnie", 2: "częściowe zachmurzenie", 3: "pochmurno", 45: "mgła", 48: "mgła osadzająca szadź",
  51: "lekka mżawka", 53: "mżawka", 55: "gęsta mżawka", 61: "lekki deszcz", 63: "deszcz", 65: "ulewny deszcz", 66: "marznący deszcz",
  67: "marznący deszcz", 71: "lekki śnieg", 73: "śnieg", 75: "intensywny śnieg", 77: "ziarna śnieżne", 80: "przelotny deszcz",
  81: "przelotny deszcz", 82: "gwałtowne ulewy", 85: "przelotny śnieg", 86: "intensywny przelotny śnieg", 95: "burza", 96: "burza z gradem", 99: "burza z gradem",
};
const num = (value: number, digits = 0) => value.toFixed(digits).replace(".", ",");
const memories = parseMemories(MEMORIES);
/** A song or playlist from a YouTube or YouTube Music link. */
export function youtubeId(link: string): { kind: "video" | "list"; id: string } | undefined {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return undefined; }
  if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) return undefined;
  const list = url.searchParams.get("list"), video = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
  if (list && /^[\w-]{10,64}$/.test(list)) return { kind: "list", id: list };
  if (video && /^[\w-]{11}$/.test(video)) return { kind: "video", id: video };
  return undefined;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parseWhen(value: string, ctx: Ctx): Date | null {
  const m = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?)?\s*(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(String(value).trim().replace("T", " "));
  if (!m) return null;
  const [, y, mo, d, d2, mo2, y2, hour, minute] = m;
  const now = local(ctx.now, ctx.tz);
  let when: Date;
  if (y) when = instant(+y, +mo, +d, +hour, +minute, ctx.tz);
  else if (d2) {
    when = instant(+(y2 ?? now.year), +mo2, +d2, +hour, +minute, ctx.tz);
    if (!y2 && when <= ctx.now) when = instant(now.year + 1, +mo2, +d2, +hour, +minute, ctx.tz);
  } else {
    when = instant(now.year, now.month, now.day, +hour, +minute, ctx.tz);
    if (when <= ctx.now) when = new Date(when.getTime() + 86400000);
  }
  return Number.isNaN(when.getTime()) ? null : when;
}

function showReminders(own: Own, ctx: Ctx): string {
  const lines = own.reminders.filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due)).map((r) => {
    const due = new Date(r.due);
    if (r.kind === "timer") return `nr ${r.id} minutnik${r.text ? ` ${r.text}` : ""}, zostało ${span((due.getTime() - ctx.now.getTime()) / 1000)}`;
    const l = local(due, ctx.tz);
    return `nr ${r.id} przypomnienie dla ${capital(r.person)} na ${dmy(l)} ${hm(l)}: ${r.text}`;
  });
  return lines.length ? "Aktywne: " + lines.join("; ") + "." : "Nie ma aktywnych minutników ani przypomnień.";
}

async function weather(own: Own, ctx: Ctx): Promise<string> {
  const place = own.place ?? HOME;
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: String(place.lat), longitude: String(place.lon), timezone: place.tz, forecast_days: "3",
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
  });
  try {
    const res = await (ctx.fetcher ?? fetch)(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as any;
    const parts = [`Pogoda w ${place.where}. Teraz ${num(data.current.temperature_2m, 1)}°C, ${WMO[data.current.weather_code] ?? "zmienne warunki"}, wiatr ${num(data.current.wind_speed_10m)} km/h.`];
    data.daily.time.forEach((day: string, i: number) => {
      const date = new Date(day + "T12:00:00Z");
      const label = `${["Dziś", "Jutro", "Pojutrze"][i]} (${DAYS[(date.getUTCDay() + 6) % 7]} ${day.slice(8, 10)}.${day.slice(5, 7)})`;
      const rain = data.daily.precipitation_sum[i] || 0;
      parts.push(`${label}: od ${num(data.daily.temperature_2m_min[i])} do ${num(data.daily.temperature_2m_max[i])}°C, ${WMO[data.daily.weather_code[i]] ?? "zmienne warunki"}, ` +
        (rain ? `opady ${num(rain, 1)} mm, ` : "bez opadów, ") + `szansa opadów ${data.daily.precipitation_probability_max[i] || 0}%, wiatr do ${num(data.daily.wind_speed_10m_max[i])} km/h.`);
    });
    return parts.join(" ");
  } catch (err) {
    return `Błąd: nie udało się pobrać pogody (${(err as Error).message}).`;
  }
}

async function calendar(ctx: Ctx, day = "", days = 1): Promise<string> {
  const own = await loadOwn(ctx.store);
  if (!ctx.calendars.length && !own.events.length) return "W kalendarzu nic nie ma.";
  const today = local(ctx.now, ctx.tz);
  const word = String(day ?? "").trim().toLowerCase();
  let first: [number, number, number] = [today.year, today.month, today.day];
  if (word === "jutro") {
    const t = local(new Date(instant(today.year, today.month, today.day, 12, 0, ctx.tz).getTime() + 86400000), ctx.tz);
    first = [t.year, t.month, t.day];
  } else if (!["", "dziś", "dzis", "dzisiaj"].includes(word)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
    if (!m) return `Błąd: nie rozumiem dnia '${day}'. Podaj dziś, jutro albo RRRR-MM-DD.`;
    first = [+m[1], +m[2], +m[3]];
  }
  days = Math.max(1, Math.min(14, Math.trunc(Number(days) || 1)));
  const events = [...(ctx.calendars.length ? await readCalendars(ctx.calendars, ctx.tz, ctx.fetcher) : []), ...parse(toIcs(own.events, ctx.now), ctx.tz)];
  return describe(occurrences(events, first, days, ctx.tz), ctx.tz, "W kalendarzu nic nie ma.");
}

/** Run one tool. Always returns a sentence. */
export async function runTool(name: string, input: Record<string, any>, ctx: Ctx): Promise<string> {
  const { store, person } = ctx;
  const own = await loadOwn(store);
  const save = () => store.set("own", own);
  try {
    switch (name) {
      case "set_timer": {
        const minutes = Number(input.minutes);
        if (!(minutes > 0 && minutes <= 1440)) return "Błąd: minutnik można ustawić na czas od kilku sekund do 24 godzin.";
        const label = String(input.label ?? "").trim();
        const id = ++own.seq;
        own.reminders.push({ id, person, kind: "timer", due: new Date(ctx.now.getTime() + minutes * 60000).toISOString(), text: label, done: false });
        await save();
        return `Wykonano: minutnik nr ${id} na ${span(minutes * 60)}${label ? ` (${label})` : ""}.`;
      }
      case "set_reminder": {
        const due = parseWhen(input.when, ctx);
        const what = String(input.text ?? "").trim();
        if (!due) return `Błąd: nie rozumiem terminu '${input.when}'. Podaj go jako RRRR-MM-DD GG:MM.`;
        const l = local(due, ctx.tz);
        if (due <= ctx.now) return `Błąd: ${dmy(l)} ${hm(l)} już minęło. Niczego nie ustawiono.`;
        if (!what) return "Błąd: brakuje treści przypomnienia.";
        const id = ++own.seq;
        own.reminders.push({ id, person, kind: "reminder", due: due.toISOString(), text: what, done: false });
        await save();
        return `Wykonano: przypomnienie nr ${id} na ${dmy(l)} o ${hm(l)}: ${what}.`;
      }
      case "show_reminders":
        return showReminders(own, ctx);
      case "cancel_reminder": {
        const found = own.reminders.find((r) => r.id === Number(input.number) && !r.done);
        if (!found) return `Błąd: nie ma aktywnego minutnika ani przypomnienia nr ${input.number}.`;
        found.done = true;
        await save();
        return `Wykonano: anulowano ${found.kind === "timer" ? "minutnik" : "przypomnienie"} nr ${found.id}${found.text ? ` (${found.text})` : ""}.`;
      }
      case "edit_list": {
        const list = plain(String(input.list ?? "")) || "zakupy";
        const items = (own.lists[list] ??= []);
        const added: string[] = [], removed: string[] = [], missing: string[] = [];
        for (const raw of input.add ?? []) {
          const item = String(raw).trim();
          if (item && !items.some((i) => plain(i) === plain(item))) { items.push(item); added.push(item); }
        }
        for (const raw of input.remove ?? []) {
          const at = items.findIndex((i) => plain(i) === plain(String(raw)));
          if (at >= 0) { removed.push(items[at]); items.splice(at, 1); } else missing.push(String(raw).trim());
        }
        if (added.length || removed.length) await save();
        const now = items.length ? `Lista ${list}: ${items.join(", ")}.` : `Lista ${list} jest pusta.`;
        const changes = [added.length ? `dopisano: ${added.join(", ")}` : "", removed.length ? `skreślono: ${removed.join(", ")}` : ""].filter(Boolean).join("; ");
        if (missing.length) return `Błąd: na liście ${list} nie ma: ${missing.join(", ")}. ${changes ? `Wykonano: ${changes}. ` : ""}${now}`;
        return changes ? `Wykonano: ${changes}. ${now}` : now;
      }
      case "remember": {
        const fact = String(input.fact ?? "").trim();
        if (!fact) return "Błąd: nie podano, co zapamiętać.";
        (own.facts[person] ??= []).push(fact);
        await save();
        return `Wykonano: zapamiętano: ${fact}`;
      }
      case "forget": {
        const key = plain(String(input.about ?? ""));
        if (key.length < 3) return "Błąd: podaj dokładniej, o czym zapomnieć.";
        const all = own.facts[person] ?? [];
        const hits = all.filter((f) => plain(f).includes(key));
        if (!hits.length) return `Błąd: nie mam zapamiętanego niczego o '${input.about}'.`;
        own.facts[person] = all.filter((f) => !hits.includes(f));
        await save();
        return `Wykonano: zapomniano: ${hits.join("; ")}`;
      }
      case "take_note": {
        const note = String(input.text ?? "").trim();
        if (!note) return "Błąd: nie podano treści notatki.";
        (own.jottings[person] ??= []).push({ text: note, at: ctx.now.toISOString() });
        await save();
        return `Wykonano: zapisano notatkę: ${note}`;
      }
      case "find_notes": {
        const since = ctx.now.getTime() - Math.max(1, Number(input.days) || 30) * 86400000;
        const wanted = new Set(stems(String(input.query ?? "")));
        let rows = (own.jottings[person] ?? []).filter((j) => new Date(j.at).getTime() >= since).reverse();
        if (wanted.size) rows = rows.filter((j) => stems(j.text).some((s) => wanted.has(s)));
        if (!rows.length) return wanted.size ? "Nie ma takich notatek." : "Nie ma notatek z tego okresu.";
        return "Notatki: " + rows.slice(0, 12).map((j) => {
          const l = local(new Date(j.at), ctx.tz);
          return `[${String(l.day).padStart(2, "0")}.${String(l.month).padStart(2, "0")}] ${j.text}${/[.!?]$/.test(j.text) ? "" : "."}`;
        }).join(" ");
      }
      case "recall_talk": {
        const wanted = new Set(stems(String(input.query ?? "")));
        if (!wanted.size) return "Błąd: podaj, czego szukać w dawnych rozmowach.";
        const keys = (await store.list(`log/${person}/`)).sort().slice(-24);
        const turns = (await Promise.all(keys.map((k) => store.get<{ role: string; text: string; at: string }[]>(k)))).flatMap((t) => t ?? []);
        const need = Math.max(1, Math.min(2, wanted.size));
        const hits = turns.map((t) => ({ t, n: new Set(stems(t.text).filter((s) => wanted.has(s))).size }))
          .filter((h) => h.n >= need).sort((a, b) => b.n - a.n).slice(0, 5).map((h) => h.t).sort((a, b) => a.at.localeCompare(b.at));
        if (!hits.length) return "W dawnych rozmowach nic o tym nie ma.";
        return "Z dawnych rozmów: " + hits.map((t) => `[${dmy(local(new Date(t.at), ctx.tz))}] ${t.role === "user" ? capital(person) : "ty"}: ${t.text.slice(0, 300)}`).join(" ");
      }
      case "set_place": {
        const key = plain(String(input.place ?? ""));
        const found = Object.entries(PLACES).find(([k]) => key.includes(k))?.[1];
        if (!found) return `Błąd: nie znam współrzędnych miejsca '${input.place}'. Znam: ${[...new Set(Object.values(PLACES).map((p) => p[0]))].sort().join(", ")}.`;
        own.place = { name: found[0], where: found[1], lat: found[2], lon: found[3], tz: found[4] };
        await save();
        return `Wykonano: zapisano, że jesteście teraz w ${found[1]}.`;
      }
      case "reading_time": {
        const words = (String(input.text ?? "").match(/[\p{L}\p{N}]+/gu) ?? []).length;
        if (!words) return "Błąd: nie podano tekstu.";
        return `Tekst ma ${words} słów; czytany spokojnie na głos potrwa około ${span(Math.round(words / 140 * 60 / 5) * 5)}.`;
      }
      case "recall_past":
        return recallPast(memories, String(input.query ?? ""));
      case "weather":
        return await weather(own, ctx);
      case "calendar":
        return await calendar(ctx, input.day, input.days);
      case "add_event": {
        if (!ctx.google) {
          try {
            const made = newEvent(input as any, ctx.tz, person, ctx.now);
            own.events = [...own.events, made].slice(-1000);
            await save();
            return `Wykonano: dopisano do kalendarza „${made.title}”, ${whenText(made)}.`;
          } catch (err) {
            return `Błąd: ${(err as Error).message}.`;
          }
        }
        try {
          const made = await addEvent(ctx.google, input as any, ctx.tz, ctx.now, ctx.fetcher);
          const when = "date" in made.start ? `${made.start.date}, cały dzień` : `${made.start.dateTime.slice(0, 10)} ${made.start.dateTime.slice(11, 16)}–${made.end.dateTime!.slice(11, 16)}`;
          return `Wykonano: dopisano do kalendarza „${made.summary}”, ${when}.`;
        } catch (err) {
          return `Błąd: ${(err as Error).message}.`;
        }
      }
      case "change_event": {
        const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.day ?? "").trim());
        const wanted = stems(String(input.find ?? ""));
        if (!day || !wanted.length) return "Błąd: podaj słowa z tytułu wydarzenia i dzień RRRR-MM-DD, w którym ono teraz jest.";
        if (!ctx.google) {
          const fits = own.events.filter((e) => onDay(e, day[0]) && wanted.every((w) => stems(e.title).includes(w)));
          if (!fits.length) return "Błąd: tego dnia nie ma w twoim kalendarzu takiego wydarzenia. Wydarzeń z kalendarzy, które tylko czytasz, nie możesz zmieniać.";
          if (fits.length > 1) return `Błąd: tego dnia pasuje kilka wydarzeń: ${fits.map((e) => e.title).join(", ")}; dopytaj, o które chodzi.`;
          const [event] = fits;
          if (input.cancel === true) {
            own.events = own.events.filter((e) => e !== event);
            await save();
            return `Wykonano: usunięto z kalendarza „${event.title}”, ${whenText(event)}.`;
          }
          if (input.end && !input.start) return "Błąd: żeby zmienić koniec, podaj też początek wydarzenia.";
          if (!input.start && !input.title && input.location === undefined && input.notes === undefined) return "Błąd: nie podano, co zmienić.";
          const was = event.title;
          try {
            if (input.start) Object.assign(event, moved(event, input.start, input.end, ctx.tz));
          } catch (err) {
            return `Błąd: ${(err as Error).message}.`;
          }
          if (String(input.title ?? "").trim()) event.title = String(input.title).trim().slice(0, 200);
          if (input.location !== undefined) event.location = String(input.location).slice(0, 200);
          if (input.notes !== undefined) event.notes = String(input.notes).slice(0, 1000);
          await save();
          return `Wykonano: zmieniono w kalendarzu „${was}”${event.title !== was ? ` na „${event.title}”` : ""}${input.start ? `, teraz ${whenText(event)}` : ""}.`;
        }
        if (input.cancel === true) return "Błąd: z kalendarza Google nie usuwasz wydarzeń; rozmówca musi to zrobić sam.";
        try {
          const from = instant(+day[1], +day[2], +day[3], 0, 0, ctx.tz);
          const done = await changeEvent(ctx.google, { from, to: new Date(from.getTime() + 86400000), matches: (title) => { const has = new Set(stems(title)); return wanted.every((w) => has.has(w)); } },
            { title: input.title, start: input.start, end: input.end, location: input.location, notes: input.notes }, ctx.tz, ctx.now, ctx.fetcher);
          const s = done.patch.start, e = done.patch.end;
          const when = !s ? "" : s.date ? `, teraz ${s.date}, cały dzień` : `, teraz ${s.dateTime!.slice(0, 10)} ${s.dateTime!.slice(11, 16)}–${e!.dateTime!.slice(11, 16)}`;
          return `Wykonano: zmieniono w kalendarzu „${done.was}”${done.patch.summary ? ` na „${done.patch.summary}”` : ""}${when}.`;
        } catch (err) {
          return `Błąd: ${(err as Error).message}.`;
        }
      }
      case "request_feature": {
        const request = String(input.request ?? "").trim();
        if (!ctx.builder) return "Błąd: nie masz połączenia z programistą; nie możesz zlecać zmian w sobie.";
        if (request.length < 10) return "Błąd: opisz dokładniej, co ma zostać dodane.";
        const who = capital(person);
        const fetcher = ctx.fetcher ?? fetch;
        let link = "";
        if (ctx.builder.routine) {
          const res = await fetcher(`https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(ctx.builder.routine)}/fire`, {
            method: "POST",
            headers: { Authorization: `Bearer ${ctx.builder.token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "experimental-cc-routine-2026-04-01", "Content-Type": "application/json" },
            body: JSON.stringify({ text: `Prośba od domownika (${who}), przekazana przez Alana:\n${request.slice(0, 4000)}` }),
          });
          if (res.status === 429) return "Błąd: za dużo zleceń w ostatniej godzinie; spróbuj później.";
          if (!res.ok) return `Błąd: programista nie przyjął zlecenia (${res.status}).`;
          link = (await res.json().catch(() => ({}))).claude_code_session_url ?? "";
        } else {
          // An issue in the repository; the workflow .github/workflows/alan.yml picks up those titled [ALAN].
          const title = `[ALAN] ${request.replace(/\s+/g, " ").slice(0, 80)}${request.length > 80 ? "…" : ""}`;
          const res = await fetcher(`https://api.github.com/repos/${ctx.builder.repo}/issues`, {
            method: "POST",
            headers: { Authorization: `Bearer ${ctx.builder.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "alan-home", "Content-Type": "application/json" },
            body: JSON.stringify({ title, body: `Prośba od domownika (${who}), przekazana przez Alana:\n\n${request.slice(0, 4000)}` }),
          });
          if (!res.ok) return `Błąd: GitHub nie przyjął zlecenia (${res.status}).`;
          link = (await res.json().catch(() => ({}))).html_url ?? "";
        }
        (own.jottings[person] ??= []).push({ at: ctx.now.toISOString(), text: `Zlecenie dla programisty: ${request}${link ? ` (${link})` : ""}` });
        await save();
        return "Wykonano: zlecenie przekazane programiście. Przygotuje propozycję zmiany; zacznie działać, gdy Kuba ją zatwierdzi.";
      }
      case "show_link": {
        const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        let url: URL;
        try { url = new URL(String(input.url ?? "").trim()); } catch { return "Błąd: to nie jest poprawny adres."; }
        if (url.protocol !== "https:" || url.username || url.href.length > 600 || !title) return "Błąd: podaj tytuł i adres zaczynający się od https://.";
        return `Wykonano: link na ekranie: ${title} ${url.href}`;
      }
      case "favourite_food": {
        const action = String(input.action ?? "find");
        if (action === "save") {
          const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
          const place = String(input.place ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
          const what = String(input.what ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
          let url: URL;
          try { url = new URL(String(input.url ?? "").trim()); } catch { return "Błąd: podaj pełny adres strony z zamówieniem (https://)."; }
          if (url.protocol !== "https:" || url.username || url.href.length > 600) return "Błąd: adres musi zaczynać się od https://.";
          if (!name || !what) return "Błąd: podaj nazwę ulubionego i co dokładnie zamawiacie.";
          own.favourites = [...own.favourites.filter((f) => f.name.toLowerCase() !== name.toLowerCase()),
            { name, place, what, url: url.href, who: capital(person), at: ctx.now.toISOString() }].slice(-100);
          await save();
          return `Wykonano: zapisano w ulubionych „${name}” (${place ? `${place}: ` : ""}${what}).`;
        }
        const words = stems(String(input.query ?? ""));
        const hits = own.favourites.filter((f) => {
          if (!words.length) return true;
          const has = new Set(stems(`${f.name} ${f.place} ${f.what}`));
          return words.some((w) => has.has(w));
        }).sort((a, b) => (b.used ?? b.at).localeCompare(a.used ?? a.at));
        if (action === "forget") {
          if (!words.length || !hits.length) return "Błąd: nie ma takiego ulubionego.";
          own.favourites = own.favourites.filter((f) => !hits.includes(f));
          await save();
          return `Wykonano: usunięto z ulubionych: ${hits.map((f) => f.name).join(", ")}.`;
        }
        if (!own.favourites.length) return "Nie ma jeszcze ulubionych zamówień. Wyszukaj w sieci i zaproponuj zapisanie.";
        if (!hits.length) return `Wśród ulubionych nic takiego nie ma. Są: ${own.favourites.map((f) => f.name).join(", ")}.`;
        if (!words.length || hits.length > 2) return `Ulubione: ${hits.slice(0, 10).map((f) => `${f.name} (${f.place}: ${f.what})`).join("; ")}. Zapytaj, które pokazać.`;
        for (const f of hits) f.used = ctx.now.toISOString();
        await save();
        return `Wykonano: link na ekranie: ${hits.map((f) => `${f.name}, ${f.what} ${f.url}`).join(" oraz ")}`;
      }
      case "music": {
        const action = String(input.action ?? "play");
        if (action === "stop") return "Wykonano: muzyka: stop";
        if (action === "list") return own.music.length ? `Zapamiętana muzyka: ${own.music.map((t) => t.name).join(", ")}.` : "Nie ma jeszcze zapamiętanej muzyki.";
        if (action === "save") {
          const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
          const found = youtubeId(String(input.url ?? ""));
          if (!found) return "Błąd: podaj link do playlisty albo utworu z YouTube lub YouTube Music.";
          if (!name) return "Błąd: podaj nazwę, pod którą to zapamiętać.";
          own.music = [...own.music.filter((t) => t.name.toLowerCase() !== name.toLowerCase()), { name, ...found, who: capital(person), at: ctx.now.toISOString() }].slice(-100);
          await save();
          return `Wykonano: zapamiętano muzykę „${name}”.`;
        }
        const query = String(input.query ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        const words = stems(query);
        const saved = words.length ? own.music.filter((t) => { const has = new Set(stems(t.name)); return words.filter((w) => has.has(w)).length >= Math.min(2, stems(t.name).length); }) : [];
        if (action === "forget") {
          if (!saved.length) return "Błąd: nie ma takiej zapamiętanej muzyki.";
          own.music = own.music.filter((t) => !saved.includes(t));
          await save();
          return `Wykonano: zapomniano: ${saved.map((t) => t.name).join(", ")}.`;
        }
        if (saved.length) {
          const t = saved.sort((a, b) => (b.used ?? b.at).localeCompare(a.used ?? a.at))[0];
          t.used = ctx.now.toISOString();
          await save();
          return `Wykonano: muzyka: ${t.name} yt:${t.kind}:${t.id}`;
        }
        const direct = youtubeId(query);
        if (direct) return `Wykonano: muzyka: z linku yt:${direct.kind}:${direct.id}`;
        if (!query) return "Błąd: powiedz, co zagrać.";
        if (!ctx.youtube) return "Błąd: nie mam dostępu do wyszukiwania w YouTube (brak klucza YOUTUBE_API_KEY). Zapamiętane playlisty mogę grać.";
        const list = input.kind === "playlist";
        const res = await (ctx.fetcher ?? fetch)(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: "snippet", q: query, maxResults: "1", regionCode: "PL",
          type: list ? "playlist" : "video", ...(list ? {} : { videoCategoryId: "10", videoEmbeddable: "true" }), key: ctx.youtube })}`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return `Błąd: YouTube nie odpowiedział (${res.status}).`;
        const item = ((await res.json()) as any).items?.[0];
        const id = list ? item?.id?.playlistId : item?.id?.videoId;
        if (!id) return `Błąd: nie znalazłem w YouTube „${query}”.`;
        const title = String(item.snippet?.title ?? query).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
        return `Wykonano: muzyka: ${title} yt:${list ? "list" : "video"}:${id}`;
      }
      case "show_map": {
        const place = String(input.place ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
        if (place.length < 3) return "Błąd: podaj, jakie miejsce pokazać.";
        const res = await (ctx.fetcher ?? fetch)(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: place, format: "jsonv2", limit: "1", "accept-language": "pl" })}`,
          { headers: { "User-Agent": "alan-home-assistant/1.0" }, signal: AbortSignal.timeout(6000) });
        const found = res.ok ? ((await res.json()) as { lat: string; lon: string; display_name: string }[])[0] : undefined;
        if (!found) return `Błąd: nie znalazłem na mapie miejsca „${place}”.`;
        const name = found.display_name.split(",").slice(0, 3).join(",").trim();
        return `Wykonano: mapa na ekranie: ${name} @${Number(found.lat).toFixed(5)},${Number(found.lon).toFixed(5)}`;
      }
      case "show_picture": {
        const query = String(input.query ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (query.length < 2) return "Błąd: podaj, czego zdjęcie pokazać.";
        const direct = String(input.url ?? "").trim();
        if (/^https:\/\/[^\s]+\.(jpe?g|png|webp|gif)(\?\S*)?$/i.test(direct)) return `Wykonano: obraz na ekranie: ${query} ${direct}`;
        for (const lang of ["pl", "en"]) {
          const res = await (ctx.fetcher ?? fetch)(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: query,
            gsrlimit: "5", prop: "pageimages", piprop: "thumbnail", pithumbsize: "800" })}`, { headers: { "User-Agent": "alan-home-assistant/1.0" }, signal: AbortSignal.timeout(6000) });
          if (!res.ok) continue;
          const pages = Object.values(((await res.json()) as any).query?.pages ?? {}) as { index: number; title: string; thumbnail?: { source: string } }[];
          const best = pages.filter((p) => p.thumbnail?.source).sort((a, b) => a.index - b.index)[0];
          if (best) return `Wykonano: obraz na ekranie: ${best.title} ${best.thumbnail!.source}`;
        }
        return `Błąd: nie znalazłem zdjęcia „${query}”.`;
      }
      case "ride_link": {
        const to = String(input.destination ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
        if (to.length < 3) return "Błąd: podaj, dokąd ma być przejazd.";
        const uber = `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=${encodeURIComponent(to)}`;
        return `Wykonano: link na ekranie: Uber do: ${to} ${uber}`;
      }
      case "phone_call": {
        if (!ctx.phone) return "Błąd: nie masz podłączonego telefonu; możesz podać numer, żeby rozmówca zadzwonił sam.";
        const number = polishNumber(input.number);
        const to = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        const task = String(input.task ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
        if (!number) return "Błąd: dzwonisz tylko pod zwykłe polskie numery (9 cyfr), nie pod numery specjalne, płatne ani zagraniczne.";
        if (!to || task.length < 10) return "Błąd: podaj, do kogo dzwonisz i co dokładnie masz załatwić.";
        const day = ctx.now.getTime() - 86400000;
        if (own.calls.filter((c) => new Date(c.at).getTime() > day).length >= CALLS_A_DAY) return `Błąd: wykonałeś już ${CALLS_A_DAY} rozmów w ciągu doby; to limit.`;
        const waiting = own.pendingCall;
        const confirmed = waiting && waiting.number === number && waiting.person === person && waiting.at !== ctx.now.toISOString()
          && ctx.now.getTime() - new Date(waiting.at).getTime() < 10 * 60000;
        if (!confirmed) {
          own.pendingCall = { at: ctx.now.toISOString(), person, name: to, number, task };
          await save();
          return `Rozmowa przygotowana, jeszcze nie dzwonisz. Powtórz rozmówcy: dzwonisz do ${to} (${number}) w sprawie: ${task}. Zapytaj, czy dzwonić; po potwierdzeniu użyj narzędzia ponownie.`;
        }
        const call = { ...waiting!, task };          // the number and the name are the ones that were read back
        try {
          const id = await placeCall(ctx.phone, call, ctx.fetcher);
          own.calls = [...own.calls, { id, at: ctx.now.toISOString(), person, name: call.name, number, task, told: false }].slice(-30);
          own.pendingCall = null;
          await save();
          return `Wykonano: dzwonię do ${call.name}. Wynik rozmowy podam, gdy się skończy.`;
        } catch (err) {
          return `Błąd: nie udało się zadzwonić (${(err as Error).message}).`;
        }
      }
      case "call_result": {
        if (!ctx.phone) return "Błąd: nie masz podłączonego telefonu.";
        const recent = own.calls.slice(-3).reverse();
        if (!recent.length) return "Nie wykonałeś jeszcze żadnej rozmowy.";
        const lines = await Promise.all(recent.map(async (c) => {
          const outcome = await callOutcome(ctx.phone!, c.id, ctx.fetcher).catch(() => "nie udało się sprawdzić wyniku");
          return `${c.name} (${hm(local(new Date(c.at), ctx.tz))}): ${outcome ?? "rozmowa jeszcze trwa"}.`;
        }));
        return "Rozmowy telefoniczne: " + lines.join(" ");
      }
      case "find_place": {
        const places = await loadPlaces(store, ctx.now, ctx.fetcher);
        if (!places && !own.placeNotes.length) return "Błąd: baza miejsc jeszcze się nie pobrała. Poszukaj w sieci.";
        return findPlaces(places?.rows ?? [], own.placeNotes, { query: input.query, town: input.town, kind: input.kind });
      }
      case "note_place": {
        const town = Object.keys(TOWNS).find((t) => stems(String(input.town ?? "")).some((s) => stems(t).includes(s)));
        const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        const note = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
        if (!town) return "Błąd: baza obejmuje Tarnobrzeg i Sandomierz; podaj jedno z tych miast.";
        if (!name || note.length < 3) return "Błąd: podaj nazwę miejsca i co o nim zapisać.";
        const known = (await loadPlaces(store, ctx.now, ctx.fetcher))?.rows.find((p) => p.town === town && p.name.toLowerCase() === name.toLowerCase());
        own.placeNotes = [...own.placeNotes, { name: known?.name ?? name, town, text: note, who: capital(person), at: ctx.now.toISOString() }].slice(-400);
        await save();
        return `Wykonano: zapisano o miejscu ${known?.name ?? name} (${town})${known ? "" : ", którego nie było w bazie"}: ${note}`;
      }
      case "look_outside":
        return "Błąd: nie masz podłączonych kamer.";       // with cameras, the mind answers this one itself: the result is a picture
      case "briefing": {
        const parts = [(await weather(own, ctx)).split(/(?<=\.) (?=Jutro)/)[0]];
        parts.push(await calendar(ctx));
        parts.push(showReminders(own, ctx));
        return "Odprawa na dziś. " + parts.join(" ");
      }
      default:
        return `Błąd: nie ma narzędzia ${name}.`;
    }
  } catch (err) {
    return `Błąd: niepoprawne parametry (${(err as Error).message}).`;
  }
}

/** For the page: what to say now (handed out once) and which timers are running. */
export async function agenda(store: Store, now: Date, phone?: Phone, fetcher?: typeof fetch) {
  const own = await loadOwn(store);
  const say: string[] = [];
  const timers: { number: number; label: string; seconds: number }[] = [];
  let changed = false;
  for (const r of own.reminders) {
    if (r.done) continue;
    const due = new Date(r.due);
    if (due <= now) {
      say.push(r.kind === "timer" ? `Minutnik${r.text ? ` ${r.text}` : ""}: czas minął.` : `${capital(r.person)}, przypomnienie: ${r.text}.`);
      r.done = true;
      changed = true;
    } else if (r.kind === "timer") timers.push({ number: r.id, label: r.text, seconds: Math.round((due.getTime() - now.getTime()) / 1000) });
  }
  // A phone call he made has ended: he reports how it went, once.
  for (const call of phone ? own.calls.filter((c) => !c.told) : []) {
    const age = now.getTime() - new Date(call.at).getTime();
    if (age < 20000) continue;
    const outcome = await callOutcome(phone!, call.id, fetcher).catch(() => null);
    if (outcome === null && age < 15 * 60000) continue;
    say.push(`${capital(call.person)}, rozmowa z ${call.name}: ${outcome ?? "nie wiem, jak się skończyła"}${/[.!?]$/.test(outcome ?? "") ? "" : "."}`);
    call.told = true;
    changed = true;
  }
  if (changed) {
    own.reminders = own.reminders.filter((r) => !r.done || now.getTime() - new Date(r.due).getTime() < 7 * 86400000);
    await store.set("own", own);
  }
  return { say, timers, reminders: [], flat: false };
}
