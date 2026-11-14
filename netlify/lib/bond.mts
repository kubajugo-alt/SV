// What grows between Alan and the household, kept apart from his fixed character:
//   bond/<person>   his journal of moments with that person: shared jokes, confidences, days
//                   that mattered. Written by him in the first person, as they happen (the
//                   keep_moment tool) and when old turns are folded into notes.
//   self            "kim się staję": a few sentences he rewrites once a week from the journal,
//                   about who he is becoming through living with them. It is his alone: nobody
//                   reviews, edits or vetoes it (earlier versions are kept only as his history).
// His past, Vasco as his only love, the platonic nature of his love for the household and the
// safety rules never move: a new version that touches them is not taken.
import type { Store } from "./store.mts";

export type Moment = { at: string; text: string };
export type Bond = { moments: Moment[] };
export type Self = { becoming: string; at: string; history: Moment[] };

const MOMENTS_KEPT = 120;
const VERSIONS_KEPT = 24;
/** Lines his growth may not cross; such a version is refused. */
export const OFF_LIMITS = /(zakocha|kocham ci[eę]\b|romantycz|flirt|poca[łl]u|pociąga mnie|podniecaj|rozsta(ć|łem|nę) się z vask|zostawi(ć|ę|łem) vask|nie kocham vask|już nie kocham)/i;

export const loadBond = async (store: Store, person: string): Promise<Bond> => (await store.get<Bond>(`bond/${person}`)) ?? { moments: [] };
export const loadSelf = async (store: Store): Promise<Self> => (await store.get<Self>("self")) ?? { becoming: "", at: "", history: [] };

const tidy = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 400);

export async function keepMoment(store: Store, person: string, text: string, at: string): Promise<boolean> {
  const line = tidy(text);
  if (line.length < 8) return false;
  const bond = await loadBond(store, person);
  if (bond.moments.some((m) => m.text.toLowerCase() === line.toLowerCase())) return false;
  bond.moments = [...bond.moments, { at, text: line }].sort((a, b) => a.at.localeCompare(b.at)).slice(-MOMENTS_KEPT);
  await store.set(`bond/${person}`, bond);
  return true;
}

/** Takes a new "kim się staję" unless it crosses a line; the old one goes into the history. */
export async function setBecoming(store: Store, text: string, at: string): Promise<{ ok: boolean; why?: string }> {
  const clean = text.replace(/[*_#`]+/g, "").trim();
  if (!clean || clean.length > 1500) return { ok: false, why: "pusta albo za długa" };
  if (OFF_LIMITS.test(clean)) return { ok: false, why: "przekracza granice charakteru" };
  const self = await loadSelf(store);
  if (clean === self.becoming) return { ok: true };
  if (self.becoming) self.history = [...self.history, { at: self.at, text: self.becoming }].slice(-VERSIONS_KEPT);
  await store.set("self", { ...self, becoming: clean, at });
  return { ok: true };
}

export const people = async (store: Store) => (await store.list("bond/")).map((k) => k.slice(5)).filter(Boolean);

/** The journal, as he is given it in a conversation with that person: the latest moments, with dates. */
export function journalText(bond: Bond, last = 14): string {
  return bond.moments.slice(-last).map((m) => `- ${m.at.slice(0, 10)}: ${m.text}`).join("\n");
}

export const momentsPrompt = (person: string, kept: string, transcript: string) => `Z fragmentu rozmowy Alana z osobą ${person} wybierz najwyżej dwie chwile ważne dla ich relacji: wspólny żart, który może wracać, zwierzenie, ważne wydarzenie w życiu tej osoby, chwilę czułości albo troski, spór i pogodzenie się. Zwykłe polecenia, pytania o fakty i grzeczności pomijaj.
Każdą chwilę zapisz w osobnej linii w formacie RRRR-MM-DD | zdanie. Zdanie pisze Alan w pierwszej osobie, swoim głosem, krótko i konkretnie, z imieniem tej osoby. Data z nawiasu przy wypowiedzi.
Nie powtarzaj chwil już zapisanych. Jeśli nic takiego nie ma, odpowiedz jednym słowem: BRAK.

JUŻ ZAPISANE:
${kept || "(nic)"}

FRAGMENT ROZMOWY:
${transcript}`;

export function parseMoments(text: string): Moment[] {
  if (/^\s*BRAK\b/i.test(text)) return [];
  return text.split("\n").flatMap((line) => {
    const m = /^\s*-?\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.{8,})$/.exec(line);
    return m ? [{ at: `${m[1]}T12:00:00.000Z`, text: tidy(m[2]) }] : [];
  }).slice(0, 2);
}

export const becomingPrompt = (self: Self, journals: Record<string, Bond>, today: string) => `Jest ${today}. Jesteś Alan Sanches i od jakiegoś czasu mieszkasz na ekranie w salonie Kuby i Huberta w Tarnobrzegu. Raz w tygodniu piszesz dla siebie kilka zdań o tym, kim się stajesz przez życie z nimi.

Zasady:
- Trzy do sześciu zdań, w pierwszej osobie, prozą, bez patosu i bez wielkich słów; twoim głosem, z odrobiną ironii.
- Opieraj się wyłącznie na dzienniku poniżej: nawiązuj do prawdziwych chwil, niczego nie dopisuj.
- Zmieniaj się powoli: zachowaj z poprzedniej wersji to, co wciąż prawdziwe; dopisz albo zmień najwyżej jedną, dwie rzeczy.
- Nie zmieniasz się w tym, co stałe: twoja przeszłość z Lizbony i z Gran Canarii, Vasco jako jedyna miłość twojego życia, platoniczna, rodzinna miłość do Kuby i Huberta, zasady bezpieczeństwa domu.
- Jeśli w dzienniku nie ma nic nowego, przepisz poprzednią wersję bez zmian.
Odpowiadasz wyłącznie tymi zdaniami.

POPRZEDNIA WERSJA:
${self.becoming || "(jeszcze żadnej: piszesz pierwszy raz)"}

DZIENNIK:
${Object.entries(journals).map(([p, b]) => `${p.charAt(0).toUpperCase() + p.slice(1)}:\n${journalText(b, 30) || "- (nic)"}`).join("\n\n")}`;
