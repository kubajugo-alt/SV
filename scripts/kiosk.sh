#!/bin/bash
# Show ALAN full screen. Waits for the server, then opens Chromium (or Chrome)
# in kiosk mode with sound and microphone allowed without prompts.
set -euo pipefail
URL="${ALAN_URL:-http://127.0.0.1:8888/}"

BROWSER=""
for app in "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  if [ -x "$app" ]; then BROWSER="$app"; break; fi
done
[ -n "$BROWSER" ] || { echo "Nie znaleziono Chromium ani Google Chrome w /Applications." >&2; exit 1; }

# The voice and hearing models take a while to load after a reboot.
for _ in $(seq 1 300); do
  curl -fsS -m 2 -o /dev/null "$URL" && break
  sleep 2
done

exec "$BROWSER" --kiosk --no-first-run --noerrdialogs \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --user-data-dir="$HOME/Library/Application Support/alan-kiosk" \
  "$URL"
