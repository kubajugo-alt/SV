# ALAN kiosk interface

The page Chromium shows in kiosk mode on TV Input 2 (spec §02, §33): ALAN in
his living room, what he says, and the state of the flat.

ALAN is the character from the Alan Sanchez games (repository
`kubajugo-alt/alansanchez`), painted seated in his armchair, at the desk of a
1960s living room: teak panelling, a sunburst clock, a valve radio, rain on the
window. This departs from §33, which specified an abstract CRT entity "not a
head".

- `art/alan/body.webp` is the painting of him (1536x2048, shown at under half
  size on a 1080p screen, so it stays sharp on a large 4K one). His face
  changes by replacing the head with another painting of it: mouth shapes
  `A`–`F` (Rhubarb Lip Sync's basic shapes), the expressions `think`, `listen`,
  `alarm` and `smirk`, and `blink` laid over the eyes.
- The paintings were generated in Canva from the games' character sheet, each
  face frame as an edit of the seated painting; `tools/build_alan_kit.py` cuts
  the exports into the kit. The Canva exports themselves are not in the
  repository.
- `art/room.jpg` is the room (1920x1080, also from Canva). Where he sits in it,
  and which lights breathe, are constants at the top of `js/avatar.js`. The
  desk hides his legs.
- Idle he blinks and now and then smirks; listening he leans in with raised
  brows; thinking he looks away; an alert alarms him and turns the room red.
  While he speaks the mouth follows the cues the server sends with the audio
  (header `X-Mouth-Cues` on `/tts`), otherwise the loudness of his voice. The
  radio dial glows with his voice.
- Lip sync is done by Rhubarb Lip Sync, as in the games: the server runs it on
  each synthesised line (phonetic recogniser, which does not depend on the
  language) and sends its cues with the audio. `install.sh` downloads the
  binary to `vendor/rhubarb/` (`--rhubarb PATH` or `ALAN_RHUBARB` for another
  place). The macOS build is for Intel processors and needs Rosetta on Apple
  Silicon. Not yet run for real: here only with a stand-in binary in the tests.
- `--lipsync words` is an alternative that needs no Rhubarb: the speech
  recogniser times each word of the line and the word's Polish spelling gives
  the shapes (2.3 s extra for a 6 s line with the `small` model on a 4-core
  CPU). `--lipsync level`, or no Rhubarb binary, moves the mouth by loudness.

Static files, no build step, no dependencies, no internet access needed
(the typeface, IBM Plex Mono, is vendored).

## On a laptop

Until the flat is wired, ALAN lives on a laptop: the page starts with the feed
`solo` (no rooms, no sensors; `?feed=demo` shows the made-up flat), and without
`--ha-url` he is told he has no flat to mind. `scripts/window.sh` opens him in a
window of his own beside your work; `scripts/kiosk.sh` is the full-screen form.

- **Say his name.** With `handsfree` on (the default; key `M`), the microphone
  stays open, each stretch of speech is recognised on this machine, and it
  reaches him only if it starts with "Alan" or follows within 12 s of his own
  answer. Everything else is dropped. Holding Space still works.
- **He speaks first** (`initiative` in `js/config.js`; key `I`): a greeting
  with the day's briefing at the first sign of you after 8:00, a remark after
  about 45 minutes of silence, a question in the evening; never during a
  calendar event, in studio mode or between 22:00 and 8:00.
- **Keys:** `Enter` type, `Space` talk, `M` microphone mode, `P` who is talking
  (Kuba / Hubert, separate memories), `I` speaking first, `S` studio mode
  (black screen, no sound, no listening).
- **Calendar:** put the address of an `.ics` calendar (Google Calendar: "secret
  address in iCal format"; or a file path) on a line of `data/kalendarze.txt`.
  He reads it, never writes to it, announces a meeting ten minutes ahead and
  keeps quiet while one is on.
- **Where you are:** tell him ("jestem w Las Palmas"); the weather and the
  briefing follow. He knows the coordinates of a fixed list of cities
  (`PLACES` in `own.py`).
- **More tools** (`own.py`): dictated notes and their search, search of old
  conversations, reading time of a text, and `briefing` (weather, calendar,
  reminders, headlines in one go).

## Run

```sh
python3 serve.py                    # from the repo root; see Voice below
python3 serve.py --engine none      # page only, silent
# http://localhost:8888/            demo feed
# http://localhost:8888/?boot=0     skip the boot sequence
```

Any static file server also works for the page alone (`cd interface && python3 -m http.server 8888`).

Demo keys: `1` idle · `2` listening · `3` thinking · `4` speak · `5` toggle
alert · `6` toggle studio (dark) · `0` resume the automatic loop.

Kiosk launch on the Mac mini:

```sh
chromium --kiosk --autoplay-policy=no-user-gesture-required http://localhost:8888/
```

## Voice

`serve.py` serves the page and a local text-to-speech endpoint, `/tts?text=…`.
Everything runs on the machine; no audio or text leaves it.

The default engine is [Chatterbox Multilingual](https://github.com/resemble-ai/chatterbox)
speaking Polish in ALAN's voice from the games: the timbre is taken from
`voices/alan.wav`, 30 s of his recorded lines from `kubajugo-alt/alansanchez`
(`--voice builtin` gives the model's own voice, `--voice FILE` another one):

```sh
pip install chatterbox-tts        # Python 3.11 recommended; on 3.13 also: pip install "setuptools<81"
python3 serve.py                  # first start downloads about 3 GB of model weights
```

Whenever ALAN is given a line, the page fetches the audio, plays it through the
TV, and moves the mouth from the level of the sound actually playing — so face
and voice cannot drift. While the audio is being prepared the face shows
"thinking". Outside kiosk mode, click the page once to unlock audio.

- **Speed.** On a 4-core CPU with no GPU a line takes 15–35 s to prepare, far
  from the plan's 2–4 s. It uses Apple's GPU (`mps`) automatically on the Mac
  mini; how fast that is still has to be measured there. Lines already spoken
  are cached and play instantly; `--warm "Dzień dobry."` prepares fixed lines
  (greetings, courier message) at startup.
- **Memory.** The model is about 3 GB on disk; its RAM use next to Ollama on
  the 16 GB Mac mini is unmeasured.
- **Another voice.** `--voice recording.wav` makes Chatterbox speak with the
  timbre of that recording (10–20 s of clean speech). `--exaggeration` and
  `--cfg-weight` adjust how lively and how measured he sounds.
- **Short lines.** The model tends to carry on after the words (silence,
  noises, the phrase again), so `serve.py` limits how much it may produce for
  a given text and cuts the audio at the first long silence after the words.
  "Gotowe." went from 2–3 s to under a second. Pronunciation of some short
  phrases on their own is still shaky ("Już włączam." was heard back wrong).
- **Piper** remains as the light, fast, more robotic fallback:
  `pip install piper-tts`, then
  `python3 serve.py --engine piper --voice path/to/pl_PL-darkman-medium.onnx`
  (voices: https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL).
  `--pitch -2` deepens a Piper voice.
- `python3 serve.py --engine none`, or an engine that fails to load, leaves the
  page working and the face mouthing silently.
- `tts: ''` in the config keeps the TV silent (e.g. if satellites do the talking).
- `"radio": true` on a line gives the bandwidth-limited "90s hardware" voice of §33.

## Conversation and memory

`serve.py` also answers `POST /chat`, which gives ALAN a mind: a local language
model with the personality from §09 of the plan (`prompts/system.pl.txt`) and
memory (`brain.py`). Nothing leaves the machine.

```sh
ollama pull mistral-nemo          # the plan's conversation model
python3 serve.py                  # talks to Ollama at http://127.0.0.1:11434
```

Two ways to talk to him on the page:

- **Voice** — hold Space, speak, release. His face follows the microphone
  level while you talk; pressing Space while he is speaking cuts him off.
- **Keyboard** — press Enter, type, press Enter.

Either way he thinks while the model answers and then speaks the reply; the line
he heard or read stays visible, dimmed, in the prompt.

Speech is recognised locally by faster-whisper (`pip install faster-whisper`),
`medium` by default as in §04; `--stt-model small` is faster and a little less
accurate, `--stt-model none` turns the microphone off. The browser asks for
microphone permission once; in kiosk mode add `--use-fake-ui-for-media-stream`
to Chromium's flags to skip the prompt.

How he remembers:

- **Recent turns** — the last exchanges go to the model word for word.
- **Notes** — when more than 24 turns are waiting, the model rewrites a compact
  record of that person (facts, preferences, dated plans, things he was asked to
  remember, unfinished threads) and the oldest turns are folded into it. A turn
  is always either in the window or in the notes.
- **Per person** — Kuba and Hubert have separate threads and notes. Who is
  typing comes from `person` in the config; recognising a speaker by voice is
  not built.
- **Across restarts** — everything is in `data/alan.db` (SQLite, git-ignored).
  Delete the file to wipe his memory.

### His own tools: timers, reminders, lists, things to remember

These need nothing but ALAN himself and are always available (`own.py`):

| Tool | Does |
| --- | --- |
| `set_timer` | a timer in minutes, with an optional label |
| `set_reminder` | a reminder or alarm for a date and time |
| `show_reminders`, `cancel_reminder` | what is running, and cancelling by number |
| `edit_list` | shared household lists, shopping by default: add, cross off, read |
| `remember`, `forget` | facts he was explicitly asked to keep, per person |

- A running timer counts down in the panel. When a timer or reminder comes
  due, ALAN says so on his own and the line stays in the action log.
- Lists are shared by the household; reminders and remembered facts belong to
  the person who asked. Remembered facts are put in front of the model on
  every turn, separately from the automatic notes.
- Everything is stored in `data/alan.db` and survives a restart.
- If the model server does not accept tools at all, ALAN notices on the first
  attempt and carries on as plain conversation.

### A narrow window outside: weather, air, rates, Wikipedia, news, parcels

ALAN is offline unless you switch sources on, one by one:

```sh
scripts/start.sh --online weather,air,rates      # or: --online all
```

He then gets one more tool, `check_online`, limited to those sources (`online.py`):

| Source | Gives him | Service | Leaves the flat |
| --- | --- | --- | --- |
| `weather` | now, four days ahead, official warnings | Open-Meteo, IMGW | the town's coordinates |
| `air` | outdoor air quality index | GIOŚ | a station number |
| `rates` | exchange rates | NBP | the currency |
| `wiki` | the opening of a Polish Wikipedia article | Wikipedia | what was looked up |
| `news` | headlines, local ones first; titles only | feeds in `online.json` | nothing |
| `parcel` | InPost parcel status | InPost | the tracking number |

- All are public, read-only and need no account. He can contact only the hosts
  of the sources you enabled; anything else is refused in code.
- Answers are cached (20 minutes for weather, a week for Wikipedia). If the
  line drops he gives the last answer with its time, and says so.
- The town, air station and news feeds are set in `online.json`.
- Not the plan's final shape: §36 wants the fetching done on Network A with
  only digest text crossing to ALAN. Here it runs inside his own process.
- The default news feed is regional, not Tarnobrzeg-specific; local feeds
  still have to be found and added.

### Hands: lights, heating, state of the flat

With `--ha-url` (and the token in `ALAN_HA_TOKEN`) the model gets three more tools,
which `home.py` carries out through Home Assistant's REST API:

| Tool | Does |
| --- | --- |
| `set_light` | a room's light on / off, optional brightness; `wszystkie` for all |
| `set_temperature` | a room's heating target, limited to 5–28 °C |
| `get_home_state` | temperatures, humidity, lights, heating, who is home, CO2, battery |

Which entities these touch is listed in `home.json` (placeholder ids for now).
There is deliberately no tool for doors, locks, cameras or alarms. A tool that
fails answers with the reason, and ALAN is told to report it, not to pretend.

What he did is shown on the screen:

- **Action log** beside the face — one line per change, `[ OK ]` or `[ !! ]`
  with the reason when something was refused. It clears at the next exchange.
- **Live panel** — with `--ha-url` the panel reads the flat from the server
  (`/home`) at start, every 30 s and right after he acts, and shows each
  room's light and heating target. A value that just changed is highlighted
  for a few seconds.

To try it before Home Assistant exists:

```sh
python3 scripts/mock_ha.py &          # a made-up flat on port 8123; prints every change
ALAN_HA_TOKEN=test scripts/start.sh --ha-url http://127.0.0.1:8123
```

Then: "Włącz światło w salonie", "Ile jest stopni w sypialni?". Pointing
`--ha-url` at the real Home Assistant later is the only change needed, apart
from the entity ids. Without `--ha-url` he says he cannot control anything yet.

Limits of this first version:

- Tool use needs a model and runtime with tool calling. The plan's Mistral Nemo
  on Ollama has it, but that combination is untested here: the loop was
  verified with a scripted model, and a small test model picked the right
  tools but wrote them out as text instead of calling them.
- Push-to-talk only: no wake word, and no room satellites — the microphone is
  the one on the machine showing the page.
- The notes are one text per person, read in full every time. Search over old
  conversations (the plan's ChromaDB) is not built.
- Offline encyclopedia: with a Kiwix archive of Polish Wikipedia in `data/`
  (`./install.sh --wiki` downloads `wikipedia_pl_all_nopic_*.zim`, the whole
  text without pictures; `ALAN_WIKI_KIND=mini` for article openings only), the
  model gets a tool `look_up` and is told to use it for questions of fact. It
  finds the article by title, else by full-text search inside the archive, and
  reads the first 1,500 characters of its prose. Nothing leaves the machine.
  `--wiki FILE.zim` names another archive; needs `pip install libzim`. Tested
  here on a small archive built in the tests; the real archive and the
  download step have not been run.
- `--llm-url` / `--llm-model` point at any OpenAI-compatible server; `--llm-url ''`
  turns conversation off, and `chat: ''` in the config hides the prompt.

## Connecting Home Assistant

Copy `js/config.local.example.js` to `js/config.local.js` (git-ignored), set the
HA WebSocket URL and a long-lived token for a dedicated non-admin user. Entity
ids are mapped in `js/config.js` — rename them there to match the real install.

The page is read-only. It expects from HA:

| What | How | Notes |
| --- | --- | --- |
| ALAN state | `input_select.alan_state`: `idle` / `listening` / `thinking` | Set by the voice pipeline automations. |
| Flat state | `input_select.flat_state` | `studio` blacks the screen and stops rendering; `away` / `guest` / `work` / `night` show a mode label. |
| Alerts | smoke / CO / leak `binary_sensor`s | Read directly from the sensors, so the alert screen never depends on the LLM. An alert overrides everything, including studio dark. |
| Panel | room temperature / humidity, `person.*`, CO2, outdoor temperature, battery | Missing entities are simply not shown. |
| Speech | event `alan_avatar` with `{ "text": "..." }` | The page voices the text through `/tts`. Optional: `"audio": "<url>"` to play ready-made speech instead, `"radio": true`, or — for a silent TV — `"envelope": [0..1, ...], "rate": 50` to drive the mouth from audio played elsewhere. |
| Room level | event `alan_avatar` with `{ "level": 0..1 }` | Optional, while listening. |

Screen priority: alert > speech in progress > `alan_state`.

## Layout

```
index.html
css/crt.css          palette, type, alert + dark modes
js/main.js           config merge, boot, wiring
js/store.js          page state + mode priority
js/home.js           live state of the flat for the panel
js/agenda.js         timers and reminders: countdown, spoken when due
js/chat.js           conversation prompt shared by keyboard and microphone
js/mic.js            push-to-talk recording and speech recognition
js/speech.js         voice playback, mouth cues and live level, silent fallback
art/                 the room painting, his body and the face patches
js/avatar.js         the scene: where he sits, his expressions per state, mouth shapes
js/ui.js             panel, typed text, alert, boot sequence
js/feeds/demo.js     simulator
js/feeds/ha.js       Home Assistant WebSocket client
```
