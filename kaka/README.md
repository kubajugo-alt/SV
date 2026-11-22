# Świąteczna przygoda Kaki

A short, cosy point-and-click Christmas game in Polish, built from *Kaka's Christmas Adventure — Game Bible*.
One living room, five mini-games, and the first star at the end.

Live: https://swieta-kaki.netlify.app (Netlify site `swieta-kaki`, deployed from this folder, which has its own `netlify.toml`).

Or open `kaka/index.html` through any static server (e.g. `python3 -m http.server` inside `kaka/`). Single page, no build step, works on desktop and phone. Progress is saved in the browser.

| Task | Where in the room | Mini-game |
| --- | --- | --- |
| Upiec pierniczki | Kitchen door | Catch the ingredients in the bowl, avoid Kaczor's socks (15 to win) |
| Ubrać choinkę | Tree | Repeat the order the baubles light up in (3 rounds) |
| Dwanaście potraw | Sideboard (recipes) | Memory pairs of the twelve Wigilia dishes (2 × 6) |
| Nakryć do stołu | Table | Put things down in order (sianko → obrus → opłatek → talerze → świeca), then count plates including the extra one |
| Lampki z Kaczorem | Fireplace | Keep Kaczor awake while he untangles the lights |

Each finished task changes the room. When all five are done, the sky goes dark and the first star appears in the window; click it for the ending.

## Assets
- `art/` — painted art generated with Gemini 3 Pro Image (first character sketches came from Canva and were used as references): the room background, sprites that change as tasks are finished (bare/decorated tree, empty/set table, lights, cookies), Kaka, Kaczor, 12 dish cards (`art/dish/`), 6 falling ingredients (`art/ing/`) and the Wigilia ending. Sprites were cut out of white backgrounds and saved as WebP.
- `audio/music.mp3` — original instrumental background music (a gentle "Cicha noc" / Silent Night arrangement: piano, bells, strings) generated with Google Lyria 3.5. It loops quietly and dips while someone is talking.
- `audio/` — voice lines generated with ElevenLabs (`eleven_v4`): Kaka is the "KateCosm" voice, Kaczor is "Maks". Line texts live in `LINES` in `index.html`.
