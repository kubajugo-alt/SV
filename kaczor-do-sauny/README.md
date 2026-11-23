# Kaczor do sauny!

A 2D side-scrolling platformer starring Kaczor, deployed as its own Netlify project: https://kaczor-do-sauny.netlify.app (publish directory `.`, no build).

## Play
- ◀ ▶ / A D — run · Space / ▲ / W — jump (hold in the air to open the paraglider) · X / J — punch · C / K — snowball
- Kaka chases from the left with her chore list (meter at the top); if she catches up, the level restarts. She waits while Kaczor rides a lift.
- Inez clones patrol and blow kisses; Gayzilla wants a selfie and, when refused, angrily throws his phone (punch or snowball it away). A punch, a snowball or a jump on the head sends either of them spinning away. The same enemy is never on screen twice.
- Maryańska, Kaczor's hippie mentor, stands by the middle checkpoint of every level (by the sauna in the last one): she gives a pep talk and keeps Kaka chatting for 3 seconds.
- Between levels Jugo narrates the story (voiced story card before every level and at the finale), followed by Kaczor's own line.
- Collect birch whisks (25 = +1 heart) and sauna ladles (+1 heart); birch posts with a towel are checkpoints.
- At each sauna Kaczor changes into a towel and walks in; the last one is the gay sauna finale.
- Phones get touch buttons and the game turns sideways when held upright. The title screen has a level picker for unlocked levels; `?level=N` jumps to a level. Progress is saved in `localStorage` (`kz-level`).

## Levels
Ten generated levels (seeded chunks, about 860–1000 tiles each) with checkpoints every ~85 tiles:
1. Osiedle · 2. Las brzozowy · 3. Zamarznięte jezioro (slippery) · 4. Jarmark świąteczny · 5. Stok narciarski (slippery) · 6. Lodowa jaskinia (dark) · 7. Bałtyk zimą · 8. Tatry i paralotnia · 9. Gorące źródła · 10. Wioska saun

Mechanics: moving lifts and gondolas, crumbling ice, springs, falling icicles, wind gusts, steam vents that lift the paraglider, water.

## Art and code
- Animations: every character and action is a Ludo.ai sprite animation (`art/anim/*.webp` strips plus `anim.json`), baked to the same standing height so Kaczor, Kaka, Inez, Gayzilla and Maryańska match in size. Still Gemini frames (`art/kz_*`, `kaka_*`, `inez_*`, `gay_*`, `mar_idle`) are the fallback while strips load.
- Backgrounds `art/bg*.webp` are cut to tile seamlessly (minimum-error seam + two-band blend), so they repeat forever with parallax.
- Platforms are not images: they are drawn in code with a texture per world, snow caps, icicles and lights.
- Voices from ElevenLabs (`audio/`), music `audio/music.mp3`.
