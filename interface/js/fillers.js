// What he says while the answer is on its way, chosen by what was asked, so the pause sounds like
// him getting to it: the calendar, the window, the map, his own past. They never promise an answer's
// content. Recorded ahead (speech.js prepare) and kept by the browser, so each costs a voice once.

const SETS = {
  feelings: ['Słyszę cię. Daj mi chwilę.', 'Mhm. Jestem tu, nigdzie się nie wybieram.', 'Rozumiem. Moment, pomyślę, jak ci pomóc.', 'Hej. Spokojnie, posłuchaj mnie przez chwilę.',
    'Oj. Usiądź wygodnie, zaraz coś wymyślimy.', 'Wiem, wiem. Daj mi sekundę, dobiorę słowa.', 'Chodź tu. Zaraz porozmawiamy na spokojnie.'],
  picture: ['Zaraz ci pokażę.', 'Moment, poszukam porządnego zdjęcia.', 'Chwila, zaraz zobaczysz na własne oczy.',
    'Zaraz wyświetlę, lepiej raz zobaczyć.', 'Moment, włączę telewizor, będzie widać lepiej.', 'Chwileczkę, szukam ładnego ujęcia.'],
  place: ['Zaraz, rozłożę mapę.', 'Moment, sprawdzę, gdzie to dokładnie jest.', 'Chwila, poszukam tego na mapie.', 'Zaraz, wyznaczę ci drogę.',
    'Moment, gdzie ja mam te okulary do map.', 'Zaraz zlokalizuję, nie uciekniesz mi.', 'Chwila, sprawdzę, jak daleko to jest.'],
  music: ['Muzyka, mówisz. Już szukam.', 'Chwileczkę, przejrzę płyty.', 'Zaraz coś znajdziemy, tylko nie mów, że chcesz disco polo.',
    'Moment, nastawię coś porządnego.', 'Zaraz, tylko odkurzę gramofon.', 'Chwila, poszukam czegoś w twoim stylu.'],
  weather: ['Zaraz zerknę, co tam na niebie.', 'Moment, sprawdzę pogodę, zanim coś obiecam.', 'Pogoda, mówisz. Zaraz popatrzę za okno.', 'Chwila, nie chcę cię wysłać bez parasola.',
    'Moment, zapytam chmur, co planują.', 'Zaraz sprawdzę, czy brać kurtkę.', 'Chwileczkę, prognoza się ładuje, jak zwykle powoli.'],
  food: ['Jedzenie, mój ulubiony temat. Chwileczkę.', 'Zaraz zajrzę, co da się zamówić.', 'Moment, głodnemu się nie odmawia.', 'Hmm, niech pomyślę, na co masz ochotę.',
    'Zaraz coś wymyślimy, nikt tu nie będzie głodny.', 'Moment, przejrzę karty dań.', 'Chwila, ślinka mi już cieknie.'],
  plans: ['Zaraz, zajrzę do kalendarza.', 'Moment, sprawdzę, co tam masz zapisane.', 'Chwileczkę, przekartkuję terminarz.', 'Daj mi sekundę, policzę te dni.',
    'Moment, zobaczę, czy masz wolne okienko.', 'Zaraz, ułożę ci ten dzień.', 'Chwila, sprawdzę, co cię czeka.'],
  self: ['Co u mnie? Zaraz, zrobię szybki bilans.', 'Miło, że pytasz. Daj mi sekundę.', 'U mnie? Hmm, niech się zastanowię, od czego zacząć.',
    'O, rzadko ktoś pyta. Chwilę.', 'U mnie po staremu, ale zaraz ci opowiem.', 'Moment, odłożę książkę.'],
  past: ['Dawno nikt mnie o to nie pytał. Moment.', 'Zaraz, muszę to dobrze opowiedzieć.', 'Hmm, wracamy do starych spraw. Daj mi chwilę.',
    'Ech, to były czasy. Chwila.', 'Moment, odkurzę pamięć.', 'Zaraz, niech sobie to poukładam po kolei.'],
  lisbon: ['Ech, Lizbona. Daj mi chwilę.', 'Lizbona, mówisz. Zaraz, niech sobie przypomnę.',
    'O, moje miasto. Moment.', 'Lizbona. Zaraz, aż poczułem zapach kawy.', 'Chwila, niech wrócę myślami do Alfamy.'],
  story: ['Mhm. Daj mi chwilę, niech to przetrawię.', 'No proszę. Moment, poukładam sobie to w głowie.', 'Słucham, słucham. Sekundę.',
    'Ciekawe. Daj mi chwilę.', 'Ojej. Zaraz, niech to do mnie dotrze.', 'Mhm, mhm. Moment.'],
  opinion: ['Hmm, mam na ten temat zdanie, tylko je ubiorę w słowa.', 'Dobre pytanie, nie chcę odpowiedzieć byle czego.', 'Zaraz, niech się zastanowię, co naprawdę myślę.',
    'Moje zdanie? Uwaga, może być stronnicze. Chwila.', 'Hmm, zaraz ci powiem, co o tym sądzę.', 'Moment, ważę za i przeciw.'],
  remind: ['Zaraz, zapiszę to sobie.', 'Moment, zanotuję, żeby nie umknęło.', 'Dobrze, już biorę ołówek.',
    'Zaraz, zawiążę sobie supełek na pamięć.', 'Moment, zapisuję, nic nie zginie.', 'Już notuję, spokojnie.'],
  ride: ['Zaraz, sprawdzę, co jeździ w okolicy.', 'Moment, załatwimy ci jakiś transport.', 'Chwila, zobaczę, jak cię tam dowieźć.',
    'Zaraz znajdziemy ci kierowcę.', 'Moment, sprawdzę, kto jest najbliżej.', 'Chwileczkę, zamawiam ci rydwan.'],
  travel: ['Podróże, to lubię. Daj mi chwilę.', 'Moment, sprawdzę, jak to tam wygląda.', 'Zaraz, przypomnę sobie, co o tym wiem.', 'Chwila, nie chcę, żebyś utknął na lotnisku.',
    'Moment, zajrzę do przewodnika.', 'Zaraz, sprawdzę, co warto wiedzieć na miejscu.', 'Chwila, spakujemy to porządnie.'],
  lookup: ['Dobre pytanie. Sprawdzę, żeby nie zmyślać.', 'Moment, poszukam, wolę mieć pewność.', 'Zaraz, upewnię się, zanim coś powiem.', 'Hmm, tego nie mam w głowie. Już sprawdzam.',
    'Chwila, zajrzę do źródeł.', 'Moment, sprawdzę, co mówią mądrzejsi ode mnie.', 'Zaraz się dowiem, nie zgadujmy.'],
  work: ['Praca, rozumiem. Daj mi chwilę.', 'Moment, podejdźmy do tego porządnie.', 'Zaraz, zbiorę to w całość.', 'Chwila, pomyślę, jak to najlepiej ugryźć.'],
  health: ['Oj. Daj mi chwilę, sprawdzę to porządnie.', 'Moment, zdrowie to nie żarty.', 'Zaraz, niech pomyślę, co ci może pomóc.', 'Chwila, upewnię się, zanim coś doradzę.'],
  shopping: ['Zakupy, mówisz. Zaraz poszukam.', 'Moment, porównam, co się opłaca.', 'Chwila, poszukam czegoś porządnego.', 'Zaraz zajrzę do sklepów.'],
  money: ['Pieniądze, temat delikatny. Chwila.', 'Moment, policzę to dokładnie.', 'Zaraz, wyciągnę kalkulator.', 'Chwileczkę, przeliczę to na spokojnie.'],
  home: ['Sprawy domowe. Daj mi chwilę.', 'Moment, pomyślę, jak to ogarnąć.', 'Zaraz, coś na to poradzimy.', 'Chwila, zajrzę, co się da zrobić.'],
  sleep: ['O tej porze? Daj mi chwilę.', 'Mhm. Pomyślmy spokojnie, po cichu.', 'Zaraz, nie musimy się spieszyć.', 'Chwila, zrobimy to tak, żebyś mógł zasnąć.'],
  games: ['O, gramy? Daj mi sekundę.', 'Moment, wymyślę coś dobrego.', 'Zaraz, tylko rozgrzeję szare komórki.', 'Chwila, tasuję karty.'],
  writing: ['Pisanie, to lubię. Daj mi chwilę.', 'Moment, poszukam właściwych słów.', 'Zaraz, ostrzę pióro.', 'Chwila, niech to dobrze zabrzmi.'],
  advice: ['Hmm, to nie jest prosta sprawa. Daj mi chwilę.', 'Moment, pomyślę, co ja bym zrobił.', 'Zaraz, rozważmy to razem.', 'Chwila, nie chcę ci doradzić byle czego.'],
  news: ['Zaraz sprawdzę, co słychać w świecie.', 'Moment, przejrzę wiadomości.', 'Chwila, zobaczę, co się wydarzyło.', 'Zaraz, zajrzę do gazet.'],
  general: ['Hmm, daj mi sekundę, zbiorę myśli.', 'Zaraz, zaraz, niech to sobie poukładam.', 'Chwila, nie chcę palnąć głupstwa.',
    'Momencik, myślę. Wiem, rzadko mi się to zdarza.', 'No dobrze, tylko się zastanowię.', 'Chwileczkę, już do tego dochodzę.',
    'Moment, niech to przemyślę.', 'Zaraz, daj mi chwilę na kawę i myśl.', 'Hmm, ciekawe. Sekundę.'],
};

// First match wins: what matters most first (how someone feels), the general case last.
const TOPICS = [
  ['feelings', /smutn|źle się czuj|zmęczon|płacz|boję|martwi|stres|zły dzień|kiepsk|tęskn|samotn|chory|choruj/],
  ['picture', /jak wygląda|pokaż (mi )?(zdjęci|jak)|zdjęci/],
  ['health', /lekarz|lek(i|ów|u)?\b|apteka|ból|boli|gorączk|przeziębi|tabletk|zdrowi/],
  ['sleep', /nie mogę (za)?spać|bezsenn|spać|zasnąć|o której wstać|obudź/],
  ['games', /zagrajmy|zagramy|zagadk|quiz|zgadnij|gra(my|ć) w|pogramy/],
  ['writing', /napisz|wymyśl|życzeni|wiersz|tekst|mail do|wiadomość do|przetłumacz/],
  ['advice', /co mam zrobić|co byś zrobił|poradź|doradź|pomóż mi (zdecydować|wybrać)|nie wiem, czy/],
  ['work', /prac(a|y|ę|uj)|projekt|klient|prezentacj|szef|zespół|deadline|festiwal|łowc/],
  ['shopping', /kupić|kup mi|zakup|allegro|prezent|sklep|zamówienie/],
  ['money', /pieniądz|rachun|zapłac|przelew|budżet|wydatk|wydał|oszczędz/],
  ['home', /sprząt|pranie|pralk|zmywar|napraw|zepsuł|ogrzewani|prąd|śmieci|mieszkani/],
  ['news', /wiadomości|co słychać na świecie|co się dzieje|sport|mecz|polityk|wybor/],
  ['remind', /przypomn|minutnik|budzik|zanotuj|zapisz|dopisz|do listy|na listę|z listy/],
  ['ride', /taksówk|\bbolt|\buber(a|em|ze|ów)?\b(?! eats)|podwiez|zawieź/],
  ['place', /gdzie (jest|są|to)|mapa|na mapie|jak daleko|jak (dojść|dojechać)|adres/],
  ['music', /muzyk|piosenk|zagraj|puść|playlist|youtube|płyt|posłuchać/],
  ['weather', /pogod|deszcz|pada|słońc|temperatur|zimno|ciepło|parasol|śnieg|wiatr|mróz|upał/],
  ['food', /jedzeni|głodn|zjeść|obiad|kolacj|śniadani|pizz|glovo|uber eats|restaurac|zamów|przepis|ugotow|kuchni/],
  ['plans', /kalendarz|spotkani|jutro|pojutrze|w (poniedziałek|wtorek|środę|czwartek|piątek|sobotę|niedzielę)|o której|termin|zaplanuj/],
  ['lisbon', /lizbon|alfam|portugal/],
  ['past', /vasc|inês|ines|pessoa|dziadek|joaquim|dzwon|twoja matk|twój ojc|gran canari/],
  ['self', /jak się masz|co u ciebie|co czytasz|co robiłeś|opowiedz (mi )?o (sobie|tobie)|\b(ty|tobie|ciebie|twój|twoja|twoje)\b.*\?/],
  ['travel', /\blot\b|lotów|lecę|lotnisk|samolot|podróż|wyjazd|wyjeżdż|hotel|esta|walut|kurs (dolara|euro)|dolar|euro\b|paszport|bagaż|nowy jork|nowym jorku|miami|barcelon|davos|londyn/],
  ['opinion', /co (o tym )?myślisz|jak (ci|tobie) się podoba|twoim zdaniem|co sądzisz|polecasz|lepiej .* czy/],
  ['lookup', /co to (jest|znaczy)|kto to|dlaczego|jak działa|ile (kosztuje|jest|trwa)|kiedy (jest|będzie)|wiadomości|sprawdź|wyszukaj|znajdź|czy wiesz/],
];

/** Which kind of question this is, by its words (the server's quicker judgement, when it comes, wins). */
export const topicOf = (text) => (TOPICS.find(([, words]) => words.test(String(text).toLowerCase())) || [/\?\s*$/.test(text) ? 'general' : 'story'])[0];

/** The topics the server may name (lib/fillers.mts keeps the same list), plus "none": better silence than a line that does not fit. */
export const TOPIC_NAMES = Object.keys(SETS);

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
export function pickFiller(text, isReady, recent = [], topic = topicOf(text)) {
  if (topic === 'none' || !SETS[topic]) return null;
  const fresh = (lines) => lines.filter((line) => isReady(line) && !recent.includes(line));
  const pool = fresh(SETS[topic]).length ? fresh(SETS[topic]) : fresh(SETS.general);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export const TOPIC_LINES = SETS;
