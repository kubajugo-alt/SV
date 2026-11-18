# Podłączenie domu do Alana: Home Assistant na Macu mini

Alan działa w chmurze (Netlify). Żeby widział i sterował mieszkaniem, potrzebuje
Home Assistanta działającego w domu (na Macu mini) i bezpiecznego adresu
**https**, pod którym chmura może się z nim połączyć. Całość zajmuje około
godziny.

Alan dostaje dwa narzędzia:

- **home_state** – odczyt: temperatury, wilgotność, czujniki, światła, gniazdka,
  ogrzewanie, kto jest w domu;
- **home_control** – sterowanie: włącz/wyłącz/przełącz światło, gniazdko lub
  wentylator, jasność światła, temperatura ogrzewania (5–28 °C).

Zamków, alarmu, drzwi, bram, rolet ani kamer Alan celowo **nie** obsługuje,
nawet jeśli są w Home Assistancie.

## 1. Przygotuj Maca mini

1. Podłącz Maca mini do prądu i do routera (najlepiej kablem Ethernet).
2. *Ustawienia systemowe → Energia*: włącz „Zapobiegaj automatycznemu
   usypianiu, gdy ekran jest wyłączony” i „Uruchamiaj automatycznie po awarii
   zasilania”.
3. *Ustawienia systemowe → Użytkownicy i grupy*: włącz automatyczne logowanie
   (żeby po restarcie wszystko wstało samo).

## 2. Zainstaluj Home Assistant OS w maszynie wirtualnej (UTM)

1. Pobierz i zainstaluj **UTM** ze strony <https://mac.getutm.app>.
2. Pobierz obraz **Home Assistant OS** dla Apple Silicon (`generic-aarch64`,
   plik `.qcow2.xz`) ze strony <https://www.home-assistant.io/installation/macos>
   i rozpakuj go (dwuklik).
3. W UTM: *Utwórz nową maszynę → Wirtualizuj → Inny*, pomiń obraz ISO,
   pamięć 4 GB, 2 rdzenie, dysk możesz usunąć; potem w ustawieniach maszyny
   dodaj dysk *Importuj* i wskaż rozpakowany plik `.qcow2`.
4. W ustawieniach maszyny: *Sieć → Tryb sieci: Bridged (zaawansowane)*, żeby
   Home Assistant miał własny adres w domowej sieci.
5. Uruchom maszynę. Po kilku minutach otwórz w przeglądarce na Macu
   `http://homeassistant.local:8123` i załóż konto właściciela.
6. Żeby maszyna startowała sama: dodaj UTM do *Ustawienia systemowe → Ogólne →
   Rzeczy otwierane podczas logowania*, a w UTM włącz automatyczne uruchamianie
   maszyny (albo uruchamiaj ją ręcznie po restarcie Maca).

## 3. Dodaj urządzenia

W Home Assistancie: *Ustawienia → Urządzenia i usługi*. Większość urządzeń
w sieci domowej wykrywa się sama (pojawią się jako „Odkryte”) – kliknij
*Konfiguruj*. Pozostałe dodaj przyciskiem *Dodaj integrację* (np. Tuya, Philips
Hue, Shelly, Xiaomi, Netatmo, EcoFlow).

Nadaj urządzeniom czytelne polskie nazwy, np. „Światło salon”, „Gniazdko
czajnik”, „Ogrzewanie sypialnia”, „Temperatura kuchnia” – Alan szuka urządzeń
po tych nazwach.

## 4. Utwórz token dla Alana

1. Kliknij swoje imię w lewym dolnym rogu → zakładka *Bezpieczeństwo*.
2. Na dole: *Tokeny dostępu długoterminowego → Utwórz token*, nazwa „Alan”.
3. Skopiuj token (pokazuje się tylko raz). Nie wklejaj go nigdzie poza
   ustawieniami Netlify.

## 5. Udostępnij Home Assistanta bezpiecznie przez internet (https)

Alan w chmurze musi mieć adres https. Wybierz jedną z dróg:

- **Najprościej: Home Assistant Cloud (Nabu Casa)**, płatne (kilka euro
  miesięcznie, miesiąc próbny za darmo). *Ustawienia → Home Assistant Cloud*,
  załóż konto, włącz *Zdalny dostęp*. Adres wygląda jak
  `https://abcd1234.ui.nabu.casa`.
- **Za darmo: Cloudflare Tunnel** (wymaga własnej domeny w Cloudflare).
  *Ustawienia → Dodatki → Sklep z dodatkami*, dodaj repozytorium
  `https://github.com/brenner-tobias/addon-cloudflared`, zainstaluj
  „Cloudflared” i postępuj według jego instrukcji. Adres to np.
  `https://dom.twojadomena.pl`.

Nie otwieraj portów na routerze i nie używaj adresu `http://`.
Sprawdź na telefonie poza Wi-Fi (na danych komórkowych), że adres otwiera
stronę logowania Home Assistanta.

## 6. Wpisz dane w Netlify

W panelu Netlify: *Site configuration → Environment variables* dodaj:

| Zmienna | Wartość |
|---|---|
| `HOME_ASSISTANT_URL` | adres z punktu 5, np. `https://abcd1234.ui.nabu.casa` |
| `HOME_ASSISTANT_TOKEN` | token z punktu 4 |

Potem *Deploys → Trigger deploy*. Gotowe – zapytaj Alana: „Jaka jest
temperatura w salonie?” albo „Zgaś światło w salonie”.

## Gdy coś nie działa

- Alan mówi, że nie ma dostępu do domu – brakuje jednej ze zmiennych albo adres
  nie zaczyna się od `https://`.
- „zły token” – utwórz nowy token (punkt 4) i podmień go w Netlify.
- „nie odpowiada” – sprawdź, czy Mac i maszyna w UTM działają i czy adres
  z punktu 5 otwiera się z telefonu poza domem.
- Token możesz w każdej chwili usunąć w Home Assistancie (punkt 4) – Alan od
  razu traci dostęp.
