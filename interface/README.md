# ALAN kiosk interface

The page Chromium shows in kiosk mode on TV Input 2 (spec §02, §33): an amber
CRT terminal with an audio-reactive oscilloscope "entity", a typed-in transcript
of what ALAN says, and an instrument panel of flat status.

Static files, no build step, no dependencies, no internet access needed
(the font is vendored). Tier 1 of §33: one fragment shader on the GPU.

## Run

```sh
cd interface && python3 -m http.server 8888
# http://localhost:8888/            demo feed
# http://localhost:8888/?boot=0     skip the boot sequence
```

Demo keys: `1` idle · `2` listening · `3` thinking · `4` speak · `5` toggle
alert · `6` toggle studio (dark) · `0` resume the automatic loop.

Kiosk launch on the Mac mini:

```sh
chromium --kiosk --autoplay-policy=no-user-gesture-required http://localhost:8888/
```

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
| Speech | event `alan_avatar` with `{ "text": "...", "envelope": [0..1, ...], "rate": 50 }` | `envelope` is the amplitude of the TTS audio buffer, sampled at `rate` Hz, fired when playback starts. Without it the page synthesises a cadence from the text. |
| Room level | event `alan_avatar` with `{ "level": 0..1 }` | Optional, while listening. |

Screen priority: alert > speech in progress > `alan_state`.

## Layout

```
index.html
css/crt.css          palette, type, scanlines, alert + dark modes
js/main.js           config merge, boot, wiring
js/store.js          page state + mode priority
js/speech.js         envelope playback -> live level
js/avatar.js         WebGL trace shader
js/ui.js             panel, typed text, alert, boot sequence
js/feeds/demo.js     simulator
js/feeds/ha.js       Home Assistant WebSocket client
```
