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
An aurora night over the ice. Presents go down the chimneys of elf workshops and ice houses flying Inez's pink flags; each delivery frees an elf, who pops out cheering. Rebel elves in candy-striped planes throw snowballs (denser waves than before). There is no boss fight yet: at the end Inez flies by in her pink biplane, taunts Kaczor and shoots the sleigh down with a giant heart, and the family crash-lands in front of the elf village. "Dalej" opens the elf village platformer. Test link: `?level=3` unlocks the level on the title screen.

## Wioska elfów (platformer, `wioska/`)
The elf village is played on foot with the engine of *Kaczor do sauny!* (copied into `wioska/` and reskinned): Kaczor runs, jumps, glides, punches and throws snowballs through a generated village level (one level, snowy platforms, crumbling bridges, springs, icicles, moving platforms). Rebel elves (Ludo animations: walk, throw, hit, dizzy, huff, pant) throw snowballs, wind-up nutcracker soldiers charge along the ground and toy planes swoop; Kaczor comments on each kind. Ten loyal elves sit in candy-cane cages: touch or punch a cage to free the elf, who jumps for joy and thanks him (counter at the top). Candy canes are the collectibles (25 = +1 heart), hot cocoa gives a heart, a golden star hides on a high ledge, candy-cane lanterns are checkpoints, and Kaka does not chase anyone here. At the end the Elf General (the rebel elf, bigger, in the mini-boss slot) guards the gate of Santa's workshop with snowball volleys, homing snowballs, charges and a snowball rain; he can only be hurt when out of breath or by a stomp. Beyond the gate a card says the village is free but Inez still rules the pole; "Dalej" returns to the main game with `?after=wioska`, which shows a "Ciąg dalszy nastąpi" card (the final battle with Inez comes later). `wioska/?boss` jumps to the General. The title screen of the main game gets a "Wioska elfów" button once level 3 is done.

## Fabryka zabawek: Maryańska and the snow cannon
After the village (`?after=wioska`) the family walks into the toy factory, where Maryańska turns out to be part of the elf resistance against Inez. Three logic puzzles in the workshop each give a part of the weapon, a **snow cannon**:
- **Rury z parą** (pipes on the left wall): rotate pipe tiles until steam flows from the boiler to the compressor (random solvable layout every time) → the steam boiler.
- **Panel celownika** (lamp panel): Lights Out on a 4×4 grid — a press toggles a lamp and its neighbours, light all sixteen → the brass sight.
- **Szyfr do magazynu** (storage door): a Mastermind lock with four different coloured baubles out of six, ten tries, ● right place / ○ right colour → the snowball hopper.
The parts land on the workbench and the cannon appears; Maryańska sends Kaczor through the production hall while the others get the bobsled ready. Test link: `?fab`.

## Hala produkcyjna (platformer, `wioska/?level=2`)
The second level of the platformer engine: a toy-factory hall with wooden platforms, lots of springs (also springs on the edge of a pit that throw you across), moving platforms and lifts, and a new mechanic — **swinging ropes** over pits: jump and grab a rope in the air, pump with ◀ ▶ to swing higher, and let go with a jump; the release keeps the swing's speed. Wide pits have two ropes and a crumbling stepping stone. Rebel elves, toy soldiers, toy planes and caged elves as in the village; no boss, the goal is the factory's loading gate. Afterwards `?after=fabryka` shows the bobsled card.

## Pościg w bobslejach (`bobslej/`, Mode 7)
The finale with Inez, in a pseudo-3D Mode 7 view (an SNES-kart style floor rendered per scanline at 320×180 and scaled up, sky from the North Pole panorama, billboard trees, candy-cane poles and obstacles, a minimap). Kaczor steers the red bobsled with Kaka and little Mikołaj, who fires the snow cannon (Space / X / ❄; the brass sight curves snowballs gently towards Inez). Inez races ahead in her pink bobsled on a rubber band (she never runs away or falls behind for long), throws gift boxes and heart balloons onto the track (they spin you out; snowballs pop them), and staying off the ice halves your speed. Six hits before she completes three laps win; then `../?after=bobslej` leads to the ending at Santa's workshop (Papi, the freed elves, `?pole`) and the "Wesołych Świąt" card.

## Assets
- Art by Gemini (`art/`): sleigh with the family and Rudolf in strict side view (Kaczor flies bare-headed), ravens (and the Great Raven), pilots on parachutes, enemy planes (goblin, rebel elf, Inez), houses, animal homes and elf workshops with chimney positions in `houses.json`, seamless night, forest and North Pole panoramas, presents, power-ups and title art. The Grinch is an original grumpy green goblin design.
- Animations by Ludo.ai (`art/anim/`): flying loops for the sleigh, the planes and the ravens.
- Voices by ElevenLabs (`audio/`): Maryańska (Anita) as in *Kaczor do sauny!*; the beaver and the badger use the library character voices "Snippy Bamboozle – Friendly Beaver" and "Edgar – Gentle Cartoon Character"; Kaka (KateCosm), Kaczor (Maks), Inez (Magda), Gayzilla (kAImil) and Jugo (James) as in the other games; Papi (Santa) uses the library voice "Mr. Claus – The Classic Jolly Santa", the rebel elf "Minty The Holiday Elf", the freed elves "Álfwyn – Excitable & Squeaky", the Elf General "Chuck – Goblin" and the Great Raven "Squeegal – Comedic Villain"; Mikołaj and the Grinch use fictional-character voices from the ElevenLabs library: "Teddy Twinkle – Cute Cartoon Boy" and "Nib – Mischievous Goblin" (both English-language voices speaking Polish).
- Music (including the North Pole track) and most sound effects come from *Kaczor do sauny!*; sleigh bells and small blips are synthesised with Web Audio.

Single static `index.html`, no build. Best score per level is kept in `localStorage`.
