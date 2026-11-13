#!/usr/bin/env bash
# `make dev`: the API (tsx) and the web (vite) together, stopped together.
# `a & b & wait` left them orphaned on Ctrl+C (background jobs of a non-interactive shell ignore SIGINT),
# so the next start found 8787/8788 still taken. Here both process trees are killed whole
# on exit, Ctrl+C, terminal closed, or when the other one dies; a stale dev server of this repo still
# holding a port is stopped before starting.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_PORT="${SANGHA_PORT:-8787}"
API_PORT="${SANGHA_API_PORT:-8788}"
export SANGHA_API_PORT="$API_PORT"

# Stop whatever of ours still listens on a port; refuse to touch anything else.
free_port() {
  local port=$1 pid cwd
  for pid in $(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    if [ -f "$ROOT/data/sangha.pid" ] && [ "$(cat "$ROOT/data/sangha.pid")" = "$pid" ]; then
      echo "Port $port is taken by the Sangha of 'make serve' (pid $pid): run 'make stop' first." >&2; exit 1
    fi
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in
      "$ROOT"|"$ROOT"/*)
        echo "Port $port: an old dev server of this repo is still running (pid $pid), stopping it."
        kill "$pid" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
        kill -9 "$pid" 2>/dev/null ;;
      *)
        echo "Port $port is taken by another program:" >&2; ps -o pid,command -p "$pid" >&2; exit 1 ;;
    esac
  done
}
free_port "$WEB_PORT"
free_port "$API_PORT"

# Not `set -m`: it would hand the terminal to each foreground `sleep`, which then swallows Ctrl+C.
# The whole tree (npm → sh → tsx/node, vite) is killed instead.
tree() { local c; for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }
cd "$ROOT"
SANGHA_DEV=1 PORT="$API_PORT" npm run dev -w @sangha/server & API=$!
npm run dev -w @sangha/web & WEB=$!

stopping=
cleanup() {
  [ -n "$stopping" ] && return; stopping=1
  trap '' INT TERM HUP
  local pids p alive; pids=$(tree "$API"; tree "$WEB")
  kill -TERM $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=; for p in $pids; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ -z "$alive" ] && return 0
    sleep 0.3
  done
  kill -KILL $pids 2>/dev/null
}
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP
trap cleanup EXIT

while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do sleep 1; done
kill -0 "$API" 2>/dev/null && echo "The web (vite) stopped: stopping the API too." >&2
kill -0 "$WEB" 2>/dev/null && echo "The API stopped: stopping the web too." >&2
exit 1
