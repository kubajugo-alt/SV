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
python3 serve.py                    # from the repo root; silent
python3 serve.py --voice ~/alan/voices/pl_PL-darkman-medium.onnx   # with a voice
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

`serve.py` serves the page and a local text-to-speech endpoint, `/tts?text=…`,
backed by [Piper](https://github.com/OHF-Voice/piper1-gpl). Everything runs on
the machine; no audio or text leaves it.

```sh
pip install piper-tts
# a Polish voice: the .onnx and its .onnx.json, side by side
#   https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL
python3 serve.py --voice path/to/pl_PL-darkman-medium.onnx
```

Whenever ALAN is given a line, the page fetches the audio, plays it through the
TV, and moves the mouth from the level of the sound actually playing — so face
and voice cannot drift. Outside kiosk mode, click the page once to unlock audio.

- No voice loaded, or audio blocked: the face mouths the line silently.
- `tts: ''` in the config keeps the TV silent (e.g. if satellites do the talking).
- `"radio": true` on a line gives the bandwidth-limited "90s hardware" voice of §33.
- Piper is the engine available today and §34's fallback. Swapping in Voxtral or
  Kokoro later only means changing what answers `/tts`.

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
js/speech.js         voice playback, live level for the mouth, silent fallback
js/avatar.js         WebGL face shader (eyes + trace mouth)
js/ui.js             panel, typed text, alert, boot sequence
js/feeds/demo.js     simulator
js/feeds/ha.js       Home Assistant WebSocket client
```
