# Kaczor do sauny!

A 2D side-scrolling platformer starring Kaczor, deployed as its own Netlify project: https://kaczor-do-sauny.netlify.app (publish directory `.`, no build).

## Play
- ◀ ▶ / A D — run · Space / ▲ / W — jump (hold in the air to open the paraglider) · X / J — punch · C / K — snowball
- Kaka chases from the left with her chore list (meter at the top); if she catches up, the level restarts.
- Inez clones patrol and blow kisses; a punch, a snowball or a jump on her head sends her spinning away with a „Nie, dziękuję!”.
- Collect birch whisks (25 = +1 heart) and sauna ladles (+1 heart); birch posts with a towel are checkpoints.
- At each sauna Kaczor changes into a towel and walks in; the last one is the gay sauna finale.
- Phones get touch buttons and the game turns sideways when held upright. `?level=N` jumps to a level; progress is saved in `localStorage` (`kz-level`).

## Levels
1. Osiedle — snowy suburb, wooden plank platforms with icicles and fairy lights
2. Zamarznięte jezioro — ice blocks, lake holes and bobbing ice floes
3. Góry i paralotnia — rock, floating rock ledges, wide gaps and hot-spring steam that lifts the paraglider

## Art and code
- Characters: Gemini sprite sheets cut into frames (`art/kz_*` run ×4, idle, jump, fall, punch, glide, towel ×4; `kaka_*`, `inez_*`).
- Backgrounds `art/bg1-3.webp` are cut to tile seamlessly (minimum-error seam + two-band blend), so they repeat forever with parallax.
- Platforms are not images: they are drawn in code (`drawTiles`, `platform`) with a generated texture per world (earth with pebbles, ice with streaks and cracks, layered rock), bumpy snow caps with drips, edge shading, icicles and blinking lights.
- Voices from ElevenLabs (`audio/`), music `audio/music.mp3`.
