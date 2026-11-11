# SV — ALAN (Autonomous Local AI Node)

Software for the ALAN home system described in *Infrastructure Plan v22*:
a fully local assistant on a Mac mini M4 (Ollama natively, Home Assistant OS in
a UTM VM), speaking Polish, with no cloud dependency.

## What gets built here vs. configured elsewhere

Most of the plan is hardware and configuration of existing software (Home
Assistant, Zigbee2MQTT, Frigate, Whisper, WireGuard, Jellyfin…). The custom
code the plan calls for is small:

| Piece | Spec | Status |
| --- | --- | --- |
| Kiosk avatar page — TV Input 2 | §02, §33 | **`interface/`** — working against a demo feed and the HA WebSocket API |
| ALAN's voice | §04, §34 | **`serve.py`** — local TTS endpoint, Chatterbox Multilingual by default (Piper as light fallback); the page plays it and lip-syncs. Speed on the Mac mini still to be measured |
| Conversation and memory | §09, §15, §20 | **`brain.py`**, **`prompts/`** — local model via Ollama, per-person threads, self-updating notes in SQLite; push-to-talk microphone with local Whisper. No device control, wake word or search over old conversations yet |
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
