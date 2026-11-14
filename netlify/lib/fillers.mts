// Which of his "thinking" lines fits a question (interface/js/fillers.js has the lines; the keys here
// must match its sets). A small model judges it in parallel with the answer, so it costs no time.
export const FILLER_TOPICS: Record<string, string> = {
  feelings: "ktoś jest smutny, zmęczony, chory, zmartwiony, ma zły dzień",
  picture: "prośba, żeby pokazać, jak coś wygląda (zdjęcie)",
  place: "gdzie coś jest, jak dojść lub dojechać, adres, mapa",
  ride: "taksówka, Bolt, Uber, podwiezienie",
  music: "puścić muzykę, piosenkę, playlistę",
  weather: "pogoda, deszcz, temperatura",
  food: "jedzenie, zamówienie jedzenia, gotowanie, przepis, restauracja",
  plans: "kalendarz, plany, terminy, spotkania, kiedy coś jest",
  remind: "przypomnienie, minutnik, budzik, dopisanie do listy, notatka",
  travel: "podróż, lot, lotnisko, hotel, waluty, wyjazd za granicę",
  lisbon: "Lizbona, Portugalia",
  past: "przeszłość Alana: Vasco, Inês, dziadek Joaquim, Pessoa, dzwon, Gran Canaria, jego rodzina",
  self: "jak się Alan czuje, co u niego, co robi, co czyta",
  opinion: "pytanie o zdanie Alana, co sądzi, co poleca, co lepsze",
  lookup: "pytanie o fakt, wiedzę, wiadomości, ceny, coś do sprawdzenia",
  story: "domownik coś opowiada albo relacjonuje, to nie jest pytanie",
  general: "pytanie lub prośba, która nie pasuje do żadnej z powyższych",
  none: "powitanie, podziękowanie, pożegnanie, krótka reakcja albo żart, na który odpowiada się od razu",
};

export const fillerPrompt = (said: string) => `Asystent za chwilę odpowie na wiadomość domownika. Zanim odpowie, powie krótkie zdanie na czas myślenia, pasujące do tematu.
Wybierz temat wiadomości z listy. Odpowiedz wyłącznie jednym słowem: kluczem z listy.

${Object.entries(FILLER_TOPICS).map(([k, v]) => `${k}: ${v}`).join("\n")}

WIADOMOŚĆ: ${said.slice(0, 500)}`;

/** The key the model gave, or null if it gave something else. */
export function parseTopic(answer: string): string | null {
  const word = (answer.trim().toLowerCase().match(/[a-z]+/) ?? [""])[0];
  return word in FILLER_TOPICS ? word : null;
}
