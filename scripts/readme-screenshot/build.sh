#!/usr/bin/env bash
# Rebuilds docs/screenshot.png from demo data. Needs `make dev` running, Google Chrome, node and Pillow.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/out/desk"
node "$HERE/capture.mjs" "$WORK/out/desk" 1440 900
python3 "$HERE/compose.py" "$WORK"
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1600,1000 \
  --virtual-time-budget=4000 --screenshot="$WORK/hero.png" "file://$WORK/compose.html" 2>/dev/null
python3 -c "from PIL import Image; Image.open('$WORK/hero.png').convert('RGB').resize((2400, 1500), Image.LANCZOS).save('$ROOT/docs/screenshot.png', optimize=True)"
echo "docs/screenshot.png updated"
