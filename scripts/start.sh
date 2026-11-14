#!/bin/bash
# Start ALAN's server (page, voice, hearing, conversation). Extra arguments go
# to serve.py, e.g.  scripts/start.sh --stt-model small
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Ollama gives a model a small context window by default, and ALAN's instructions
# alone are longer: the start of them (who he is) would be cut off and he would
# answer like a stock assistant. "alan-nemo" is mistral-nemo with a window that fits.
# With an Anthropic key on this machine he thinks with Claude (ALAN_MIND=local keeps the local model).
if [ -z "${ALAN_MIND:-}" ] && [ -s "$REPO/data/anthropic.key" ]; then
  export ALAN_MIND=claude
  export ALAN_STT_MODEL="${ALAN_STT_MODEL:-small}"      # the light recogniser is plenty beside a cloud mind
  "$REPO/.venv/bin/python" -c "import anthropic" 2>/dev/null || "$REPO/.venv/bin/pip" install --quiet anthropic
fi

BASE="${ALAN_LLM_BASE:-mistral-nemo}"
if [ "${ALAN_MIND:-local}" = "local" ] && [ -z "${ALAN_LLM_MODEL:-}" ] && command -v ollama >/dev/null; then
  MODELS="$(ollama list 2>/dev/null || true)"     # read once: piping it into grep -q can fail under pipefail
  if grep -q "^$BASE" <<<"$MODELS"; then
    if ! grep -q "^alan-nemo" <<<"$MODELS"; then
      TMP="$(mktemp)"
      printf 'FROM %s\nPARAMETER num_ctx 8192\n' "$BASE" > "$TMP"
      ollama create alan-nemo -f "$TMP" >/dev/null 2>&1 && echo "Utworzono model alan-nemo (mistral-nemo z większym kontekstem)."
      rm -f "$TMP"
      MODELS="$(ollama list 2>/dev/null || true)"
    fi
    if grep -q "^alan-nemo" <<<"$MODELS"; then export ALAN_LLM_MODEL=alan-nemo; fi
  fi
fi

# With an ElevenLabs key on this machine he speaks with the games' voice from the cloud
# (ALAN_ENGINE=chatterbox keeps everything local).
if [ -z "${ALAN_ENGINE:-}" ] && [ -s "$REPO/data/elevenlabs.key" ]; then
  export ALAN_ENGINE=elevenlabs
fi

exec "$REPO/.venv/bin/python" serve.py "$@"
