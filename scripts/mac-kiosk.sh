#!/bin/bash
# Sets up the Mac mini by the TV: ALAN on the screen from login, listening for his name, and the
# Samsung TV switched over to him when he is called or speaks up.
#
#   ./scripts/mac-kiosk.sh 192.168.1.50 2      # the TV's IP address, the HDMI input the Mac is on
#
# What it does:
#  1. pairs with the TV once (accept "Allow" on the TV) and remembers its address on the network;
#  2. installs two login items (launchd agents): the TV helper (scripts/tv_samsung.py) and
#     Chrome in kiosk mode on ALAN's page, microphone allowed, listening for "Alan";
#  3. keeps the Mac awake (the screen may sleep; ALAN still hears) — this step asks for your password.
# Undo: ./scripts/mac-kiosk.sh --remove
set -euo pipefail
cd "$(dirname "$0")/.."
AGENTS="$HOME/Library/LaunchAgents"
HELPER="pl.alan.tv"
KIOSK="pl.alan.kiosk"

if [ "${1:-}" = "--remove" ]; then
  for name in "$HELPER" "$KIOSK"; do
    launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
    rm -f "$AGENTS/$name.plist"
  done
  echo "Usunięto. Ustawienia usypiania Maca zostały bez zmian (zmienisz je w Ustawieniach systemowych)."
  exit 0
fi

TV="${1:?Podaj adres IP telewizora, np. ./scripts/mac-kiosk.sh 192.168.1.50 2}"
HDMI="${2:-1}"
URL="${ALAN_URL:-https://alan-sanches-dom.netlify.app/}?boot=0&handsfree=1&tv=http://127.0.0.1:8765"
PY="$(command -v python3)"
SCRIPT="$PWD/scripts/tv_samsung.py"

BROWSER=""
for app in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$app" ]; then BROWSER="$app"; break; fi
done
[ -n "$BROWSER" ] || { echo "Zainstaluj Google Chrome i uruchom skrypt ponownie." >&2; exit 1; }

echo "1/3 Łączę się z telewizorem $TV. Jeśli na ekranie pojawi się pytanie o ALAN, wybierz Zezwól."
"$PY" "$SCRIPT" --tv "$TV" --hdmi "$HDMI" --pair

echo "2/3 Instaluję automatyczny start."
mkdir -p "$AGENTS"
cat > "$AGENTS/$HELPER.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$HELPER</string>
  <key>ProgramArguments</key><array>
    <string>$PY</string><string>$SCRIPT</string><string>--tv</string><string>$TV</string><string>--hdmi</string><string>$HDMI</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/alan-tv.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/alan-tv.log</string>
</dict></plist>
PLIST
cat > "$AGENTS/$KIOSK.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$KIOSK</string>
  <key>ProgramArguments</key><array>
    <string>$BROWSER</string><string>--kiosk</string><string>--no-first-run</string><string>--noerrdialogs</string>
    <string>--autoplay-policy=no-user-gesture-required</string><string>--use-fake-ui-for-media-stream</string>
    <string>--user-data-dir=$HOME/Library/Application Support/alan-kiosk</string><string>$URL</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PLIST
for name in "$HELPER" "$KIOSK"; do
  launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$name.plist"
done

echo "3/3 Mac ma nie usypiać (ekran może gasnąć). Za chwilę system poprosi o hasło."
sudo pmset -a sleep 0 disksleep 0 powernap 0 autorestart 1 womp 1

echo
echo "Gotowe. Alan otworzy się teraz na pełnym ekranie. Za pierwszym razem zaloguj się hasłem domowym;"
echo "przeglądarka je zapamięta. Powiedz: Hej Alan..., żeby sprawdzić przełączanie telewizora."
echo "Dziennik programu od telewizora: ~/Library/Logs/alan-tv.log"
