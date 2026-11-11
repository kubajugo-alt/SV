# ALAN kiosk interface

The page Chromium shows in kiosk mode on TV Input 2 (spec §02, §33): an amber
CRT terminal with ALAN's face, a typed-in transcript of what he says, and an
instrument panel of flat status.

The face is two phosphor eyes and an oscilloscope-trace mouth. This departs
from §33, which specified an abstract entity "not a head": the eyes blink,
glance around when idle, widen when listening, narrow and drift aside when
thinking, and go round and red on an alert; the mouth rests in a faint smile
and becomes the live speech waveform when ALAN talks.

Static files, no build step, no dependencies, no internet access needed
(the font is vendored). Tier 1 of §33: one fragment shader on the GPU.

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
with its built-in voice, speaking Polish:

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

### Hands: lights, heating, state of the flat

With `--ha-url` (and the token in `ALAN_HA_TOKEN`) the model gets three tools,
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
css/crt.css          palette, type, scanlines, alert + dark modes
js/main.js           config merge, boot, wiring
js/store.js          page state + mode priority
js/home.js           live state of the flat for the panel
js/chat.js           conversation prompt shared by keyboard and microphone
js/mic.js            push-to-talk recording and speech recognition
js/speech.js         voice playback, live level for the mouth, silent fallback
js/avatar.js         WebGL face shader (eyes + trace mouth)
js/ui.js             panel, typed text, alert, boot sequence
js/feeds/demo.js     simulator
js/feeds/ha.js       Home Assistant WebSocket client
```
