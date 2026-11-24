# Prezentowy nalot

Part 3 of the Christmas trilogy (after the Kaka living-room game in `kaka/` and *Kaczor do sauny!* in `kaczor-do-sauny/`). A horizontal side-scrolling shoot 'em up: Kaka, Kaczor and their 4-year-old son Mikołaj fly a sleigh pulled by Rudolf over a snowy Polish village at night, dropping presents into chimneys while Inez, Gayzilla and the Grinch try to stop them from small planes.

## Play
- Arrows / WASD fly the sleigh · Space / J: Kaczor throws snowballs · X / K: Mikołaj drops a present · C / L: Rudolf's nose sends out waves of red light that shoot down every plane they reach, wipe out enemy shots and hit the boss hard (2 per level) · P pause · M mute.
- Phones: drag anywhere to steer, on-screen buttons for snowball, present and Rudolf's nose; subtitles move to the top.
- Presents drift back with the ground, so drop one when a chimney is just under the sleigh; the chimney marker turns gold ("TERAZ!") when a drop would land in it. A delivered house lights up and its chimney smokes. Hitting the very centre of a chimney scores a bonus.
- A plane that is shot down vanishes in a cloud of dust and its pilot floats away on a parachute (goblins and the Grinch on patched olive ones, rebel elves on striped ones, Inez on pink hearts); shot ravens tumble down dazed, shedding feathers. Bosses escape the same way.
- Shot-down planes sometimes drop power-ups: candy cane (triple snowballs), cookie with milk (+1 heart), star (shield).
- Stars at the end of a level: 1 for finishing, 2 for ≥50% of the chimneys, 3 for ≥75%.

## Level 1: Nad osiedlem
About 2.5 minutes of houses with flocks of ravens in pink scarves that throw stolen Christmas baubles (sine waves, dives with bauble volleys, lines), then a boss fight with the Great Raven (crown, pink boa, a sack of stolen baubles): bauble fans, homing streams, a dash at the sleigh and, once angry, a rain of baubles. As he flees he promises to tell "the boss" everything.

## Cutscene: Skraj lasu
After the Great Raven flees, "Dalej" lands the sleigh on a clearing at the edge of the forest. Maryańska (the hippie mentor from *Kaczor do sauny!*, her Ludo animations and voice) waits by her tent and campfire and sends the family into the forest; Kaczor, Kaka and Mikołaj answer. "Pomiń" skips it. Maryańska then invites them into her tent.

## Maryańska's tent
After the landing Maryańska invites the family into her tent (a hub like the living room in the Kaka game). Three glowing spots start three Christmas mini-games, and each finished one changes the tent:
- **Pierniki z ziołami** (stove and table): cut six gingerbread cookies out of the dough, then bake three trays by stopping the oven needle in the golden zone. A plate of iced cookies appears on the table.
- **Łapacz snów** (hook over the entrance): Maryańska shows a sequence of beads, feathers and cones; repeat it (3, 4, then 5 items). The dream catcher and two garlands of dried oranges appear.
- **Kolęda na gitarze** (guitar): "Cicha noc" (Silent Night, public domain) falls on three strings; hit the notes with A S D (or J K L, arrows, taps) for plucked-string sounds while Maryańska strums the bass; 60% of the notes passes. The fairy lights light up.
"Pomiń minigry" goes straight to level 2; when all three are done Maryańska sends the family off.

## Level 2: Leśne gobliny
A night forest. Presents go to beaver lodges (stick chimney) and badger setts (stone chimney pipe); a delivered home's animal pops out hugging its present and thanks the family. Tall snowy trees stand between the homes: their crowns hurt the sleigh (crown shapes in `art/trees.json`), so the sleigh flies high and dives between trees to drop presents. Green goblins in rusty planes throw lumps of coal, some of them in arcs; the boss is the Grinch in his patched plane, throwing coal. Level 2 can also be picked on the title screen once unlocked (or with `?level=2`). Test links: `?tent` opens Maryańska's tent, `?cut` plays the landing cutscene.

## Jugo's gingerbread cottage
After the Grinch, "Dalej" lands the sleigh at the edge of the village, in front of Jugo's rainbow gingerbread cottage. Jugo invites the family in: Gayzilla, in a headscarf and patchwork apron, stirs a bubbling cauldron like Baba Jaga and spoils Santa, whom both of them call "Papi" (hearts drift between them, Jugo holds mistletoe). Three glowing spots start three mini-games:
- **Kociołek Gayzilli** (cauldron): move the cauldron (mouse, touch, ← →) and catch ten recipe items (porcini, beetroot, gingerbread); rotten eggs and smelly socks spoil the soup, three of them start it over. The steam turns green and cheerful.
- **Karmienie Papiego** (armchair): Papi sways in his armchair; click or tap to throw pierogi and makowiec into his mouth, eight within 40 seconds. A plate of food and more hearts appear.
- **Taniec z Papim** (disco ball): Gayzilla shows arrow steps, repeat them with the arrows or by clicking (3, 4, 5, then 6 steps) while Papi dances along. The disco ball lights up the room.
When all three are done Papi confesses why he is hiding with the boys: Inez was the new Mrs. Claus, the romance failed, and she turned the elves against him and took over the North Pole (Kaka works out that Inez sent the ravens). Papi decides women are too much trouble and he is staying with the boys, because at least Gayzilla cooks well; Kaka protests, and Papi sends the family to the North Pole. Level 3 follows. Test links: `?village` plays the landing at Jugo's, `?cottage` opens the cottage.

## Level 3: Biegun północny
An aurora night over the ice. Presents go down the chimneys of elf workshops and ice houses flying Inez's pink flags; each delivery frees an elf, who pops out cheering. Rebel elves in candy-striped planes throw snowballs (denser waves than before), and the boss is Inez in her pink biplane with more health and the full kiss arsenal. Afterwards "Dalej" lands the sleigh at Santa's workshop: Papi thanks the family, the freed elves dance, and he admits he will still spend Christmas Eve at Jugo and Gayzilla's for pierogi. A "Wesołych Świąt" card ends the trilogy. Test links: `?level=3` unlocks the level on the title screen, `?pole` plays the ending.

## Assets
- Art by Gemini (`art/`): sleigh with the family and Rudolf in strict side view (Kaczor flies bare-headed), ravens (and the Great Raven), pilots on parachutes, enemy planes (goblin, rebel elf, Inez), houses, animal homes and elf workshops with chimney positions in `houses.json`, seamless night, forest and North Pole panoramas, presents, power-ups and title art. The Grinch is an original grumpy green goblin design.
- Animations by Ludo.ai (`art/anim/`): flying loops for the sleigh, the planes and the ravens.
- Voices by ElevenLabs (`audio/`): Maryańska (Anita) as in *Kaczor do sauny!*; the beaver and the badger use the library character voices "Snippy Bamboozle – Friendly Beaver" and "Edgar – Gentle Cartoon Character"; Kaka (KateCosm), Kaczor (Maks), Inez (Magda), Gayzilla (kAImil) and Jugo (James) as in the other games; Papi (Santa) uses the library voice "Mr. Claus – The Classic Jolly Santa", the rebel elf "Minty The Holiday Elf", the freed elves "Álfwyn – Excitable & Squeaky" and the Great Raven "Squeegal – Comedic Villain"; Mikołaj and the Grinch use fictional-character voices from the ElevenLabs library: "Teddy Twinkle – Cute Cartoon Boy" and "Nib – Mischievous Goblin" (both English-language voices speaking Polish).
- Music (including the North Pole track) and most sound effects come from *Kaczor do sauny!*; sleigh bells and small blips are synthesised with Web Audio.

Single static `index.html`, no build. Best score per level is kept in `localStorage`.
