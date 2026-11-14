// What he says while the answer is on its way, chosen by what was asked, so the pause sounds like
// him getting to it: the calendar, the window, the map, his own past. They never promise an answer's
// content. Recorded ahead (speech.js prepare) and kept by the browser, so each costs a voice once.

const SETS = {
  feelings: ['Słyszę cię. Daj mi chwilę.', 'Mhm. Jestem tu, nigdzie się nie wybieram.', 'Rozumiem. Moment, pomyślę, jak ci pomóc.', 'Hej. Spokojnie, posłuchaj mnie przez chwilę.'],
  picture: ['Zaraz ci pokażę.', 'Moment, poszukam porządnego zdjęcia.', 'Chwila, zaraz zobaczysz na własne oczy.'],
  place: ['Zaraz, rozłożę mapę.', 'Moment, sprawdzę, gdzie to dokładnie jest.', 'Chwila, poszukam tego na mapie.', 'Zaraz, wyznaczę ci drogę.'],
  music: ['Muzyka, mówisz. Już szukam.', 'Chwileczkę, przejrzę płyty.', 'Zaraz coś znajdziemy, tylko nie mów, że chcesz disco polo.'],
  weather: ['Zaraz zerknę, co tam na niebie.', 'Moment, sprawdzę pogodę, zanim coś obiecam.', 'Pogoda, mówisz. Zaraz popatrzę za okno.', 'Chwila, nie chcę cię wysłać bez parasola.'],
  food: ['Jedzenie, mój ulubiony temat. Chwileczkę.', 'Zaraz zajrzę, co da się zamówić.', 'Moment, głodnemu się nie odmawia.', 'Hmm, niech pomyślę, na co masz ochotę.'],
  plans: ['Zaraz, zajrzę do kalendarza.', 'Moment, sprawdzę, co tam masz zapisane.', 'Chwileczkę, przekartkuję terminarz.', 'Daj mi sekundę, policzę te dni.'],
  self: ['O mnie? No proszę. Chwilę.', 'Co u mnie? Zaraz, zrobię szybki bilans.', 'Miło, że pytasz. Daj mi sekundę.'],
  past: ['Hmm, dobre pytanie. Daj mi chwilę.', 'Dawno nikt mnie o to nie pytał. Moment.', 'Zaraz, muszę to dobrze opowiedzieć.', 'Ech, Lizbona. Daj mi chwilę.'],
  remind: ['Zaraz, zapiszę to sobie.', 'Moment, zanotuję, żeby nie umknęło.', 'Dobrze, już biorę ołówek.'],
  ride: ['Zaraz, sprawdzę, co jeździ w okolicy.', 'Moment, załatwimy ci jakiś transport.', 'Chwila, zobaczę, jak cię tam dowieźć.'],
  travel: ['Podróże, to lubię. Daj mi chwilę.', 'Moment, sprawdzę, jak to tam wygląda.', 'Zaraz, przypomnę sobie, co o tym wiem.', 'Chwila, nie chcę, żebyś utknął na lotnisku.'],
  lookup: ['Dobre pytanie. Sprawdzę, żeby nie zmyślać.', 'Moment, poszukam, wolę mieć pewność.', 'Zaraz, upewnię się, zanim coś powiem.', 'Hmm, tego nie mam w głowie. Już sprawdzam.'],
  general: ['Hmm, daj mi sekundę, zbiorę myśli.', 'Zaraz, zaraz, niech to sobie poukładam.', 'Dobre pytanie. Chwila, nie chcę palnąć głupstwa.',
    'Momencik, myślę. Wiem, rzadko mi się to zdarza.', 'No dobrze, tylko się zastanowię.', 'Chwileczkę, już do tego dochodzę.'],
};

// First match wins: what matters most first (how someone feels), the general case last.
const TOPICS = [
  ['feelings', /smutn|źle się czuj|zmęczon|płacz|boję|martwi|stres|zły dzień|kiepsk|tęskn|samotn|chory|choruj/],
  ['picture', /jak wygląda|pokaż (mi )?(zdjęci|jak)|zdjęci/],
  ['remind', /przypomn|minutnik|budzik|zanotuj|zapisz|dopisz|do listy|na listę|z listy/],
  ['ride', /taksówk|\bbolt|uber(?! eats)|podwiez|zawieź/],
  ['place', /gdzie (jest|są|to)|mapa|na mapie|jak daleko|jak (dojść|dojechać)|adres/],
  ['music', /muzyk|piosenk|zagraj|puść|playlist|youtube|płyt|posłuchać/],
  ['weather', /pogod|deszcz|pada|słońc|temperatur|zimno|ciepło|parasol|śnieg|wiatr|mróz|upał/],
  ['food', /jedzeni|głodn|zjeść|obiad|kolacj|śniadani|pizz|glovo|uber eats|restaurac|zamów|przepis|ugotow|kuchni/],
  ['plans', /kalendarz|spotkani|jutro|pojutrze|w (poniedziałek|wtorek|środę|czwartek|piątek|sobotę|niedzielę)|o której|termin|zaplanuj/],
  ['past', /vasc|inês|ines|pessoa|dziadek|joaquim|lizbon|alfam|dzwon|matk|ojc/],
  ['self', /jak się masz|co u ciebie|co czytasz|co robiłeś|opowiedz (mi )?o (sobie|tobie)|\b(ty|tobie|ciebie|twój|twoja|twoje)\b.*\?/],
  ['travel', /\blot\b|lotów|lecę|lotnisk|samolot|podróż|wyjazd|wyjeżdż|hotel|esta|walut|kurs (dolara|euro)|dolar|euro\b|paszport|bagaż|nowy jork|nowym jorku|miami|barcelon|davos|londyn/],
  ['lookup', /co to (jest|znaczy)|kto to|dlaczego|jak działa|ile (kosztuje|jest|trwa)|kiedy (jest|będzie)|wiadomości|sprawdź|wyszukaj|znajdź|czy wiesz/],
];

/** Which kind of question this is. */
export const topicOf = (text) => (TOPICS.find(([, words]) => words.test(String(text).toLowerCase())) || ['general'])[0];

/** All of them, for recording; a short greeting needs none. */
export const ALL_FILLERS = Object.values(SETS).flat();

/** A few of each kind, for recording on this visit; the browser keeps them, so over visits all get recorded once. */
export function someFillers(perSet = 2) {
  return Object.values(SETS).flatMap((lines) => [...lines].sort(() => Math.random() - 0.5).slice(0, perSet));
}

/**
 * The line to say for this question: from its topic if one of those is recorded, else a general one;
 * never one of the last few said. `isReady(line)` tells whether a line is recorded.
 */
export function pickFiller(text, isReady, recent = []) {
  const topic = topicOf(text);
  const fresh = (lines) => lines.filter((line) => isReady(line) && !recent.includes(line));
  const pool = fresh(SETS[topic]).length ? fresh(SETS[topic]) : fresh(SETS.general);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export const TOPIC_LINES = SETS;
