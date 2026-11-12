#!/bin/bash
# Set ALAN up on a Mac: local model, voice, hearing, and (optionally) start at login.
#
#   ./install.sh                 install or update everything
#   ./install.sh --autostart     also start ALAN and the full-screen page at login
#   ./install.sh --no-autostart  remove the start-at-login setup
#   ./install.sh --wiki          also download Polish Wikipedia for offline use (large; see below)
#
# Safe to run again: each step is skipped when it is already done.
# Needs Homebrew (https://brew.sh). Downloads about 12 GB on the first run.

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
MODEL="${ALAN_LLM_MODEL:-mistral-nemo}"
STT_MODEL="${ALAN_STT_MODEL:-medium}"
AGENTS="$HOME/Library/LaunchAgents"
LABELS=(pl.alan.server pl.alan.kiosk)

step() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mBłąd: %s\033[0m\n' "$1" >&2; exit 1; }

remove_autostart() {
  for label in "${LABELS[@]}"; do
    launchctl unload -w "$AGENTS/$label.plist" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
  done
}

[ "$(uname -s)" = "Darwin" ] || fail "ten skrypt jest przeznaczony dla macOS."
[ "$(uname -m)" = "arm64" ] || echo "Uwaga: to nie jest Mac z procesorem Apple; głos i model będą działać wolno."

if [ "${1:-}" = "--no-autostart" ]; then
  remove_autostart
  echo "Usunięto uruchamianie przy logowaniu."
  exit 0
fi

command -v brew >/dev/null || fail "brak Homebrew. Zainstaluj go ze strony https://brew.sh i uruchom skrypt ponownie."

step "Narzędzia (Python 3.11, Ollama)"
brew list python@3.11 >/dev/null 2>&1 || brew install python@3.11
command -v ollama >/dev/null || brew install ollama
PYTHON="$(brew --prefix python@3.11)/bin/python3.11"

step "Model językowy ($MODEL)"
if ! curl -fsS -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  brew services start ollama
  for _ in $(seq 1 30); do
    curl -fsS -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -fsS -m 3 http://127.0.0.1:11434/api/version >/dev/null || fail "Ollama nie odpowiada na porcie 11434."
ollama list | grep -q "^$MODEL" || ollama pull "$MODEL"

step "Środowisko Pythona (głos i słuch)"
[ -x "$REPO/.venv/bin/python" ] || "$PYTHON" -m venv "$REPO/.venv"
"$REPO/.venv/bin/pip" install --quiet --upgrade pip
"$REPO/.venv/bin/pip" install --quiet chatterbox-tts faster-whisper libzim "setuptools<81"

step "Pobieranie i sprawdzenie modeli głosu i słuchu"
(cd "$REPO" && ALAN_STT_MODEL="$STT_MODEL" "$REPO/.venv/bin/python" - <<'PY'
import os
import serve

ears = serve.Whisper(os.environ["ALAN_STT_MODEL"], "pl")
print("Słuch:", ears.name)
voice = serve.Chatterbox("pl", "voices/alan.wav", "auto", 0.5, 0.5)
print("Głos: ", voice.name)
PY
)

step "Ruch ust (Rhubarb Lip Sync)"
# Optional: without it ALAN still talks, his mouth just follows loudness.
RHUBARB="$REPO/vendor/rhubarb/rhubarb"
if [ ! -x "$RHUBARB" ]; then
  TMP="$(mktemp -d)"
  if curl -fsSL -m 300 -o "$TMP/rhubarb.zip" "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.13.0/Rhubarb-Lip-Sync-1.13.0-macOS.zip" \
     && unzip -q "$TMP/rhubarb.zip" -d "$TMP"; then
    rm -rf "$REPO/vendor/rhubarb"
    mkdir -p "$REPO/vendor"
    mv "$TMP/Rhubarb-Lip-Sync-1.13.0-macOS" "$REPO/vendor/rhubarb"
    xattr -dr com.apple.quarantine "$REPO/vendor/rhubarb" 2>/dev/null || true
  else
    echo "Nie udało się pobrać Rhubarba — usta będą podążać za głośnością głosu."
  fi
  rm -rf "$TMP"
fi
if [ -x "$RHUBARB" ] && ! "$RHUBARB" --version >/dev/null 2>&1; then
  echo "Rhubarb jest pobrany, ale się nie uruchamia. To program dla procesorów Intela;"
  echo "na Macu z Apple Silicon wymaga Rosetty:  softwareupdate --install-rosetta --agree-to-license"
  echo "Bez niej usta będą podążać za głośnością głosu."
fi

if [ "${1:-}" = "--wiki" ]; then
  step "Encyklopedia offline (polska Wikipedia z Kiwix)"
  # ALAN_WIKI_KIND: nopic = whole text without pictures (default), mini = openings of articles only, maxi = with pictures.
  KIND="${ALAN_WIKI_KIND:-nopic}"
  LIST="https://download.kiwix.org/zim/wikipedia/"
  NAME="$(curl -fsSL -m 60 "$LIST" | grep -o "wikipedia_pl_all_${KIND}_[0-9-]*\.zim" | sort -u | tail -1 || true)"
  [ -n "$NAME" ] || fail "nie znalazłem pliku wikipedia_pl_all_${KIND} na $LIST. Pobierz go ręcznie do $REPO/data/."
  mkdir -p "$REPO/data"
  if [ -f "$REPO/data/$NAME" ]; then
    echo "Jest już: data/$NAME"
  else
    SIZE="$(curl -fsSIL -m 60 "$LIST$NAME" | awk 'tolower($1)=="content-length:" {n=$2} END {printf "%.1f", n/1e9}')"
    echo "Pobieram $NAME (${SIZE} GB). Przerwane pobieranie można wznowić tym samym poleceniem."
    curl -fL -C - -o "$REPO/data/$NAME.part" "$LIST$NAME"
    mv "$REPO/data/$NAME.part" "$REPO/data/$NAME"
  fi
  "$REPO/.venv/bin/python" -c "import sys; sys.path.insert(0, '$REPO'); from wiki import Encyclopedia; print('Encyklopedia:', Encyclopedia('$REPO/data/$NAME').name)"
fi

if [ "${1:-}" = "--autostart" ]; then
  step "Uruchamianie przy logowaniu"
  mkdir -p "$AGENTS" "$HOME/Library/Logs"
  remove_autostart
  for label in "${LABELS[@]}"; do
    sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" "$REPO/scripts/launchd/$label.plist" > "$AGENTS/$label.plist"
    launchctl load -w "$AGENTS/$label.plist"
  done
  echo "ALAN wystartuje po każdym zalogowaniu. Logi: ~/Library/Logs/alan-server.log"
fi

step "Gotowe"
cat <<TXT
Uruchomienie ręczne:   $REPO/scripts/start.sh
Strona:                http://127.0.0.1:8888/
Pełny ekran (kiosk):   $REPO/scripts/kiosk.sh
Start przy logowaniu:  $REPO/install.sh --autostart
Wikipedia offline:     $REPO/install.sh --wiki

Na stronie: przytrzymaj spację i mów, albo Enter, tekst, Enter.
TXT
