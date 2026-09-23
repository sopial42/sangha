#!/usr/bin/env sh
# Run the built Sangha server in the background, detached from the terminal that started it.
# Usage: scripts/serve.sh start|stop|status
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/sangha.pid"
LOG_FILE="$ROOT/data/sangha.log"
PORT="${PORT:-8787}"
mkdir -p "$ROOT/data"

running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then echo "☸ Sangha tourne déjà (pid $(cat "$PID_FILE")) : http://127.0.0.1:$PORT"; exit 0; fi
    [ -f "$ROOT/apps/server/dist/index.js" ] || { echo "Pas de build : lance d'abord npm run build"; exit 1; }
    cd "$ROOT"
    # A new session (setsid): closing the terminal or the tool that launched it does not stop the server.
    nohup python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
      env PORT="$PORT" SANGHA_DB="$ROOT/data/sangha.db" \
      node --disable-warning=ExperimentalWarning "$ROOT/apps/server/dist/index.js" >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then echo "☸ Sangha : http://127.0.0.1:$PORT (pid $(cat "$PID_FILE"), logs $LOG_FILE)"; exit 0; fi
      sleep 1
    done
    echo "Le serveur ne répond pas : voir $LOG_FILE"; exit 1
    ;;
  stop)
    if running; then kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE" && echo "☸ Sangha arrêté"; else rm -f "$PID_FILE"; echo "Sangha ne tournait pas"; fi
    ;;
  status)
    if running; then echo "☸ Sangha tourne (pid $(cat "$PID_FILE")) : http://127.0.0.1:$PORT"; else echo "Sangha est arrêté"; fi
    ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
