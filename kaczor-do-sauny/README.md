# Kaczor do sauny!

A 2D side-scrolling platformer starring Kaczor, deployed as its own Netlify project: https://kaczor-do-sauny.netlify.app (publish directory `.`, no build).

## Play
- Difficulty on the title screen and in the pause menu: Spacer (slower Kaka, 5 hearts), Pościg (classic), Morsowanie (fast Kaka, 2 hearts).
- Esc / P or ⏸ pauses (also when the tab loses focus): resume, back to checkpoint, restart level, menu, and volume sliders for music, effects and dialogue.
- Stars per level: finish, ≥70% of the whisks, and the golden ladle hidden on a high ledge. World 1 starts gently with on-screen hints; the last world ends with a duel against Kaka at the sauna door (she throws chore lists, sends robot vacuums and charges with her mop), followed by the credits.
- ◀ ▶ / A D — run · Space / ▲ / W — jump (hold in the air to open the paraglider) · X / J — punch · C / K — snowball
- Kaka chases from the left with her chore list (meter at the top); if she catches up, the level restarts. She waits while Kaczor rides a lift.
- Enemies: Inez clones blow kisses; Gayzilla wants a selfie and, when refused, angrily throws his phone (punch or snowball it away). A punch, a snowball or a jump on the head sends either of them spinning away. Kaka's robot vacuums charge along the ground and flying chore lists swoop in waves (stomp, punch or snowball them); a name tag marks them the first time. Kaczor comments (voice + subtitle) when he spots, beats or is hit by any enemy: Inez, Gayzilla, vacuums and chore lists. The same Inez or Gayzilla is never on screen twice. Ice spikes hurt.
- Maryańska, Kaczor's hippie mentor, stands by the middle checkpoint of every level (by the sauna in the last one): Kaczor greets her, she answers with a pep talk and keeps Kaka chatting for a few seconds.
- Opening the paraglider catches an updraft once per jump.
- Between levels Jugo narrates the story (voiced story card before every level and at the finale), followed by Kaczor's own line.
- Collect birch whisks (25 = +1 heart) and sauna ladles (+1 heart); birch posts with a towel are checkpoints.
- At each sauna Kaczor changes into a towel and walks in, then a full-screen sauna card for that world appears (`art/sauna_1-9.webp`); the last one is the gay sauna finale.
- Phones get touch buttons and the game turns sideways when held upright. The title screen has a level picker for unlocked levels; `?level=N` jumps to a level. Progress is saved in `localStorage` (`kz-level`).

## Levels
Ten generated levels (seeded chunks, about 860–1000 tiles each) with checkpoints every ~85 tiles:
1. Osiedle · 2. Las brzozowy · 3. Zamarznięte jezioro (slippery) · 4. Jarmark świąteczny · 5. Stok narciarski (slippery) · 6. Lodowa jaskinia (dark) · 7. Bałtyk zimą · 8. Tatry i paralotnia · 9. Gorące źródła · 10. Wioska saun

Every world mixes climbs over floating platforms, cliffs with spikes below, pillar jumps, crumbling bridges over pits, moving platforms over pits, two-route sections and enemy ledges; gaps, spikes and enemies grow with each world. `reach.js`-style checks replay the game physics over every generated level to make sure each one can be finished.

Mechanics: moving lifts and gondolas, crumbling ice, springs, falling icicles, wind gusts, steam vents that lift the paraglider, water.

## Art and code
- The game renders at the screen's real resolution (up to 2x) and the animation strips are baked at 336px standing height, so sprites stay sharp on high-density screens.
- Animations: every character and action is a Ludo.ai sprite animation (`art/anim/*.webp` strips plus `anim.json`), baked to the same standing height so Kaczor, Kaka, Inez, Gayzilla and Maryańska match in size. Still Gemini frames (`art/kz_*`, `kaka_*`, `inez_*`, `gay_*`, `mar_idle`) are the fallback while strips load.
- Backgrounds `art/bg*.webp` are cut to tile seamlessly (minimum-error seam + two-band blend), so they repeat forever with parallax.
- Environment art by Gemini (`art/env/`): per-world floating platforms (3-slice), crumbling blocks, moving platforms (gondola, sleigh, rafts…), seamless ground textures, checkpoint posts, springs, ice spikes, icicles and steam vents; `env.json` stores where each walkable top sits.
- Voices from ElevenLabs (`audio/`). Each level has its own Lyria soundtrack (`audio/music_1-10.mp3`; `music.mp3` plays on the title screen). Kaczor grunts on jumps, punches and throws, and his hit line depends on who hit him. Dialogue is loudness-matched and the music ducks under it. Each world has its own seamless ambience loop (`audio/amb/`) and footsteps follow the ground (snow, wood, ice). Whisks give a soft rising chime. Action sound effects are ElevenLabs samples in `audio/sfx/` (jump, punch, throw, splat, pickups, hurt, enemy knocked away, phone, spring, checkpoint, paraglider, splash, level complete) played through Web Audio.
