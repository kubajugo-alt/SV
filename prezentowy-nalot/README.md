# Prezentowy nalot

Part 3 of the Christmas trilogy (after the Kaka living-room game in `kaka/` and *Kaczor do sauny!* in `kaczor-do-sauny/`). A horizontal side-scrolling shoot 'em up: Kaka, Kaczor and their 4-year-old son Mikołaj fly a sleigh pulled by Rudolf over a snowy Polish village at night, dropping presents into chimneys while Inez, Gayzilla and the Grinch try to stop them from small planes.

## Play
- Arrows / WASD fly the sleigh · Space / J: Kaczor throws snowballs · X / K: Mikołaj drops a present · C / L: Rudolf's nose sends out waves of red light that shoot down every plane they reach, wipe out enemy shots and hit the boss hard (2 per level) · P pause · M mute.
- Phones: drag anywhere to steer, on-screen buttons for snowball, present and Rudolf's nose; subtitles move to the top.
- Presents drift back with the ground, so drop one when a chimney is just under the sleigh; the chimney marker turns gold ("TERAZ!") when a drop would land in it. A delivered house lights up and its chimney smokes. Hitting the very centre of a chimney scores a bonus.
- A plane that is shot down vanishes in a cloud of dust and its pilot floats away on a parachute (Inez on pink hearts, Gayzilla on a rainbow, the Grinch on a patched olive one); the Inez boss escapes the same way.
- Shot-down planes sometimes drop power-ups: candy cane (triple snowballs), cookie with milk (+1 heart), star (shield).
- Stars at the end of a level: 1 for finishing, 2 for ≥50% of the chimneys, 3 for ≥75%.

## Level 1: Nad osiedlem
About 2.5 minutes of houses with waves of Inez's pink biplanes (sine waves, dives with kiss volleys, lines), then a boss fight with Inez in a big biplane: kiss fans, homing kiss streams, a dash at the sleigh and, once angry, a rain of kisses. Levels 2 (Gayzilla) and 3 (Grinch) are next; their planes, voice lines and animations are already in `art/` and `audio/`.

## Assets
- Art by Gemini (`art/`): sleigh with the family and Rudolf in strict side view (Kaczor flies bare-headed), the three pilots on parachutes, three enemy planes, four houses with chimney positions in `houses.json`, a seamless night panorama, presents, power-ups and title art. The Grinch is an original grumpy green goblin design.
- Animations by Ludo.ai (`art/anim/`): flying loops for the sleigh and each plane.
- Voices by ElevenLabs (`audio/`): Kaka (KateCosm), Kaczor (Maks), Inez (Magda) and Gayzilla (kAImil) as in the other games; Mikołaj and the Grinch use fictional-character voices from the ElevenLabs library: "Teddy Twinkle – Cute Cartoon Boy" and "Nib – Mischievous Goblin" (both English-language voices speaking Polish).
- Music and most sound effects come from *Kaczor do sauny!*; sleigh bells and small blips are synthesised with Web Audio.

Single static `index.html`, no build. Best score per level is kept in `localStorage`.
