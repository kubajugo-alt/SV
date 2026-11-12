# SV — ALAN (Autonomous Local AI Node)

Software for the ALAN home system described in *Infrastructure Plan v22*:
a fully local assistant on a Mac mini M4 (Ollama natively, Home Assistant OS in
a UTM VM), speaking Polish, with no cloud dependency.

## Install on the Mac mini

```sh
git clone https://github.com/kubajugo-alt/SV.git && cd SV
./install.sh               # needs Homebrew; first run downloads about 12 GB
scripts/start.sh           # then open http://127.0.0.1:8888/
```

`install.sh` installs Python 3.11 and Ollama, pulls the conversation model,
creates `.venv` with the voice and hearing packages, and loads both models
once to check them. It is safe to run again.

- `./install.sh --autostart` also starts the server and the full-screen page
  (`scripts/kiosk.sh`, Chromium or Chrome) at every login; `--no-autostart`
  removes that. Logs go to `~/Library/Logs/alan-server.log`.
- macOS asks once for microphone access for the browser; allow it.
- First question to ask him: "Jak masz na imię i z kim rozmawiasz?". If he
  does not answer as ALAN talking to Kuba, start with
  `scripts/start.sh --llm-inline-system`.

The script has been linted and its model-loading step run on Linux, but it has
not been run on a Mac yet.

## Tests

```sh
pip install numpy
python3 -m unittest discover -s tests -t .
```

They cover the home tools against the mock Home Assistant, memory and the tool
loop with a scripted model, and the server's endpoints with stand-in engines —
no models are downloaded. GitHub Actions runs them on every pull request,
together with syntax checks of the page's JavaScript and the shell scripts. The
page itself (face, audio, microphone) is not covered by automated tests yet.

## What gets built here vs. configured elsewhere

Most of the plan is hardware and configuration of existing software (Home
Assistant, Zigbee2MQTT, Frigate, Whisper, WireGuard, Jellyfin…). The custom
code the plan calls for is small:

| Piece | Spec | Status |
| --- | --- | --- |
| Kiosk avatar page — TV Input 2 | §02, §33 | **`interface/`** — working against a demo feed and the HA WebSocket API |
| ALAN's voice | §04, §34 | **`serve.py`** — local TTS endpoint, Chatterbox Multilingual by default (Piper as light fallback); the page plays it and lip-syncs. Speed on the Mac mini still to be measured |
| Conversation and memory | §09, §15, §20 | **`brain.py`**, **`prompts/`** — local model via Ollama, per-person threads, self-updating notes in SQLite; push-to-talk microphone with local Whisper; his own tools for timers, reminders, shared lists and explicit memory (`own.py`); tools for lights, heating and flat state through Home Assistant (`home.py`, tried against `scripts/mock_ha.py`). No wake word or search over old conversations yet |
| Ambient / studio monitor page — kitchen Pi | §23 | next: reuses the store, feed and CRT styles |
| HA side of the avatar feed (state helpers, `alan_avatar` event with TTS envelope) | §33, §34 | to do with the HA install — contract in `interface/README.md` |
| Phone interface | §17 | configuration only (HA Companion, Siri Shortcuts) — no code |
| News fetcher on Network A | §36.1 | later |
| Worker pool / per-person agents | §32 | later; single-machine first |

## Open questions from the spec

- **Where ALAN speaks.** The kiosk now voices lines through the TV, with the
  mouth locked to that audio (§33). The plan also has the room satellites
  speaking via HA; who speaks when both are in the same room is undecided.
- **`flat_state` values** are referenced but never enumerated. The page assumes
  `normal`, `away`, `guest`, `work`, `night`, `studio`.
- **TTS engine.** §34's Voxtral TTS does not fit: its model card lists nine
  languages without Polish, a CC BY-NC licence (not Apache), and a 16 GB GPU.
  Kokoro has no Polish either. Chatterbox Multilingual (MIT, Polish) is used
  instead; whether it meets the 2–4 s target on the Mac mini is unmeasured.
- **Section numbering.** §31's sub-items are numbered 10–13, duplicating
  earlier section numbers.

## Other files

`alan.js`, `brigitte.js` and `alan-urban-escape (22).html` are an unrelated
earlier game prototype and are untouched.
