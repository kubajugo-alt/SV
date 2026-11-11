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
| Ambient / studio monitor page — kitchen Pi | §23 | next: reuses the store, feed and CRT styles |
| HA side of the avatar feed (state helpers, `alan_avatar` event with TTS envelope) | §33, §34 | to do with the HA install — contract in `interface/README.md` |
| System prompt and personality | §09, §20 | to version here once HA + Ollama are up |
| Phone interface | §17 | configuration only (HA Companion, Siri Shortcuts) — no code |
| News fetcher on Network A | §36.1 | later |
| Worker pool / per-person agents | §32 | later; single-machine first |

## Open questions from the spec

- **TTS envelope source.** §33 wants the trace locked to the audio buffer the TTS
  plays, but speech plays on the satellites, not the Mac. The page therefore
  takes a precomputed envelope in an HA event; something on the HA side has to
  compute it from the TTS output.
- **`flat_state` values** are referenced but never enumerated. The page assumes
  `normal`, `away`, `guest`, `work`, `night`, `studio`.
- **TTS engine.** §04 says Piper; §34 revises it to Voxtral + Kokoro. The
  interface is engine-agnostic.
- **Section numbering.** §31's sub-items are numbered 10–13, duplicating
  earlier section numbers.

## Other files

`alan.js`, `brigitte.js` and `alan-urban-escape (22).html` are an unrelated
earlier game prototype and are untouched.
