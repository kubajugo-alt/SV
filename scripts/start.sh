#!/bin/bash
# Start ALAN's server (page, voice, hearing, conversation). Extra arguments go
# to serve.py, e.g.  scripts/start.sh --stt-model small
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
exec "$REPO/.venv/bin/python" serve.py "$@"
