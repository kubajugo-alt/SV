#!/bin/bash
# Start ALAN's server (page, voice, hearing, conversation). Extra arguments go
# to serve.py, e.g.  scripts/start.sh --stt-model small
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Ollama gives a model a small context window by default, and ALAN's instructions
# alone are longer: the start of them (who he is) would be cut off and he would
# answer like a stock assistant. "alan-nemo" is mistral-nemo with a window that fits.
BASE="${ALAN_LLM_BASE:-mistral-nemo}"
if [ -z "${ALAN_LLM_MODEL:-}" ] && command -v ollama >/dev/null && ollama list 2>/dev/null | grep -q "^$BASE"; then
  if ! ollama list | grep -q "^alan-nemo"; then
    TMP="$(mktemp)"
    printf 'FROM %s\nPARAMETER num_ctx 8192\n' "$BASE" > "$TMP"
    ollama create alan-nemo -f "$TMP" >/dev/null && echo "Utworzono model alan-nemo (mistral-nemo z większym kontekstem)."
    rm -f "$TMP"
  fi
  ollama list | grep -q "^alan-nemo" && export ALAN_LLM_MODEL=alan-nemo
fi

exec "$REPO/.venv/bin/python" serve.py "$@"
