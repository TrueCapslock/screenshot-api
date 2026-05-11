#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="/tmp/screenshot-api.pid"
LOG_FILE="/tmp/screenshot-api.log"

# Detect Docker access
DOCKER=""
if docker ps &>/dev/null; then
  DOCKER="docker"
elif sudo -n docker ps &>/dev/null 2>&1; then
  DOCKER="sudo docker"
else
  echo "Docker requires sudo — will prompt for password when needed."
  DOCKER="sudo docker"
fi

# Source NVM for Node commands
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

status() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║        Screenshot API — Status       ║"
  echo "╚══════════════════════════════════════╝"

  echo ""
  echo "[Docker Services]"
  if $DOCKER ps --format '{{.Names}} {{.State}}' 2>/dev/null | grep -q .; then
    $DOCKER ps --format 'table {{.Names}}\t{{.State}}\t{{.Ports}}' 2>/dev/null | tail -n +2 | awk '{printf "  %-20s %-10s %s\n", $1, $2, $3}'
  else
    echo "  (none running)"
  fi

  echo ""
  echo "[App]"
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "  PID: $(cat "$PID_FILE") — RUNNING"
  else
    echo "  (stopped)"
  fi

  echo ""
  echo "[Worker]"
  WORKER_PID=$(pgrep -f "node src/workers/renderer.js" 2>/dev/null || true)
  if [ -n "$WORKER_PID" ]; then
    echo "  PID: $WORKER_PID — RUNNING"
  else
    echo "  (stopped)"
  fi

  echo ""
  if command -v node &>/dev/null; then
    if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
      echo "  ✓ http://localhost:3000/health"
      echo "  ✓ http://localhost:3000/docs"
      echo "  ✓ http://localhost:3000/docs/api"
    else
      echo "  ✗ App not responding on :3000"
    fi
  fi
}

start_docker() {
  echo "Starting Postgres & Redis..."
  $DOCKER compose up -d postgres redis
  echo "Waiting for services..."
  until $DOCKER compose exec -T postgres pg_isready -U postgres &>/dev/null; do sleep 1; done
  until $DOCKER compose exec -T redis redis-cli ping &>/dev/null; do sleep 1; done
  echo "  Postgres and Redis are ready."
}

stop_docker() {
  echo "Stopping Postgres & Redis..."
  $DOCKER compose stop postgres redis
  echo "  Stopped."
}

start_app() {
  if ! command -v node &>/dev/null; then
    echo "Node.js not found. Install it or run: nvm use 22"
    return
  fi

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "App already running (PID $(cat "$PID_FILE"))"
    return
  fi

  echo "Running migrations..."
  npm run migrate 2>&1 | sed 's/^/  /'

  echo "Starting app..."
  nohup node src/index.js > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "  App started (PID $(cat "$PID_FILE"))"
  else
    echo "  App failed to start. Check $LOG_FILE"
    tail -5 "$LOG_FILE"
  fi
}

start_worker() {
  if ! command -v node &>/dev/null; then
    echo "Node.js not found."
    return
  fi

  if pgrep -f "node src/workers/renderer.js" >/dev/null 2>&1; then
    echo "Worker already running"
    return
  fi

  echo "Starting worker..."
  nohup node src/workers/renderer.js >> "$LOG_FILE" 2>&1 &
  echo "  Worker started (PID $!)"
}

stop_app() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null && echo "App stopped (PID $PID)" || echo "App not running"
    rm -f "$PID_FILE"
  else
    pkill -f "node src/index.js" 2>/dev/null && echo "App stopped" || echo "App not running"
  fi
}

stop_worker() {
  pkill -f "node src/workers/renderer.js" 2>/dev/null && echo "Worker stopped" || echo "Worker not running"
}

all_up() {
  echo "=== Starting everything ==="
  start_docker
  start_app
  start_worker
  echo ""
  status
}

all_down() {
  echo "=== Stopping everything ==="
  stop_worker
  stop_app
  stop_docker
  echo ""
  status
}

restart() {
  all_down
  all_up
}

menu() {
  while true; do
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║       Screenshot API — Control       ║"
    echo "╠══════════════════════════════════════╣"
    echo "║  1) Start all (Docker + App + Worker)║"
    echo "║  2) Stop all                         ║"
    echo "║  3) Restart all                      ║"
    echo "║  4) Start app only                   ║"
    echo "║  5) Stop app only                    ║"
    echo "║  6) Start worker only                ║"
    echo "║  7) Stop worker only                 ║"
    echo "║  8) Start Docker services            ║"
    echo "║  9) Stop Docker services             ║"
    echo "║ 10) Run migrations                   ║"
    echo "║ 11) Show status                      ║"
    echo "║ 12) Run tests                        ║"
    echo "║  q) Quit                             ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    read -rp "Select option: " choice
    echo ""

    case "$choice" in
      1)  all_up ;;
      2)  all_down ;;
      3)  restart ;;
      4)  start_app ;;
      5)  stop_app ;;
      6)  start_worker ;;
      7)  stop_worker ;;
      8)  start_docker ;;
      9)  stop_docker ;;
      10) echo "Running migrations..."; npm run migrate 2>&1 | sed 's/^/  /' ;;
      11) status ;;
      12) echo "Running tests..."; npm test 2>&1 | sed 's/^/  /' ;;
      q|Q) echo "Bye."; exit 0 ;;
      *)  echo "Invalid option." ;;
    esac
  done
}

case "${1:-}" in
  start)   all_up ;;
  stop)    all_down ;;
  restart) restart ;;
  status)  status ;;
  menu|*)  menu ;;
esac
