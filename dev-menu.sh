#!/usr/bin/env bash

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

# Read version from package.json
APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
IMAGE="capslock/screenshot-api"

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

  if ! $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -q postgres; then
    echo "Postgres is not running. Start Docker services first (option 6 or 1)."
    return
  fi
  if ! $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -q redis; then
    echo "Redis is not running. Start Docker services first (option 6 or 1)."
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

docker_submenu() {
  local selected=0 items_len=5
  local G=$'\e[32m' R=$'\e[31m' X=$'\e[0m'

  _ditem() {
    local idx=$1 sel=$2 text=$3
    local prefix="  "; [[ $idx -eq $sel ]] && prefix="❯ "
    printf "║%s%*s║\n" "$prefix$text" $((36 - ${#text})) ""
  }

  _draw_docker_menu() {
    local sel=$1
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║       Docker Build & Push            ║"
    echo "╠══════════════════════════════════════╣"
    _ditem 0 $sel "1) Login to Docker Hub"
    _ditem 1 $sel "2) Build: $IMAGE"
    _ditem 2 $sel "3) Push to Docker Hub"
    _ditem 3 $sel "4) Build & push"
    _ditem 4 $sel "b) Back"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo -n "Select option: "
  }

  local _dmenu_lines=11

  while true; do
    _draw_docker_menu $selected

    while true; do
      local key= arrow=
      read -s -n1 key 2>/dev/null
      if [[ "$key" == $'\e' ]]; then
        read -s -n2 -t 0.1 arrow 2>/dev/null || true
      fi
      if [[ "$arrow" == '[A' ]]; then
        ((selected--)); [[ $selected -lt 0 ]] && selected=$((items_len - 1))
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_docker_menu $selected
        printf '\e[?25h'
      elif [[ "$arrow" == '[B' ]]; then
        ((selected++)); [[ $selected -ge $items_len ]] && selected=0
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_docker_menu $selected
        printf '\e[?25h'
      elif [[ "$key" == $'\e' && -z "$arrow" ]]; then
        printf '\e[%dA\e[J' $_dmenu_lines; return
      elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == "" ]]; then
        printf '\e[%dA\e[J' $_dmenu_lines
        case $selected in
          0) echo "Logging into Docker Hub..."; docker login 2>&1 | sed 's/^/  /' ;;
          1) echo "Building image..."; $DOCKER build -f docker/Dockerfile -t $IMAGE:latest -t $IMAGE:$APP_VERSION . 2>&1 | sed 's/^/  /' ;;
          2) echo "Pushing image..."; $DOCKER push $IMAGE:latest 2>&1 | sed 's/^/  /' && $DOCKER push $IMAGE:$APP_VERSION 2>&1 | sed 's/^/  /' ;;
          3) echo "Building image..."; $DOCKER build -f docker/Dockerfile -t $IMAGE:latest -t $IMAGE:$APP_VERSION . 2>&1 | sed 's/^/  /' && echo "" && echo "Pushing image..." && $DOCKER push $IMAGE:latest 2>&1 | sed 's/^/  /' && $DOCKER push $IMAGE:$APP_VERSION 2>&1 | sed 's/^/  /' ;;
          4) printf '\e[%dA\e[J' $_dmenu_lines; return ;;
        esac
        echo ""; read -s -n1 -p "Press any key to continue..."
        break
      elif [[ "$key" =~ [0-9bB] ]]; then
        case "$key" in
          1) selected=0 ;;
          2) selected=1 ;;
          3) selected=2 ;;
          4) selected=3 ;;
          b|B) printf '\e[%dA\e[J' $_dmenu_lines; return ;;
        esac
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_docker_menu $selected
        printf '\e[?25h'
      fi
    done
  done
}

dev_submenu() {
  local selected=0 items_len=10
  local G=$'\e[32m' R=$'\e[31m' X=$'\e[0m'

  _ditem() {
    local idx=$1 sel=$2 text=$3 cmd=$4 color=$5
    local prefix="  "; [[ $idx -eq $sel ]] && prefix="❯ "
    local pad=$((36 - ${#text}))
    local line="$prefix$text"
    if [[ -n "$cmd" && "$line" == *"$cmd"* ]]; then
      line="${line/$cmd/${color}$cmd${X}}"
    fi
    printf "║%s%*s║\n" "$line" $pad ""
  }

  _draw_dev_menu() {
    local sel=$1
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║        Development — Control         ║"
    echo "╠══════════════════════════════════════╣"
    _ditem 0 $sel "1) Start all (Docker + App + Worker)"
    _ditem 1 $sel "2) Stop all"
    _ditem 2 $sel "3) Restart all"
    _ditem 3 $sel "4) $app_cmd app" "$app_cmd" "$app_c"
    _ditem 4 $sel "5) $worker_cmd worker" "$worker_cmd" "$worker_c"
    _ditem 5 $sel "6) $docker_cmd Docker services" "$docker_cmd" "$docker_c"
    _ditem 6 $sel "7) Run migrations"
    _ditem 7 $sel "8) Show status"
    _ditem 8 $sel "k) Kill :3000"
    _ditem 9 $sel "b) Back to main menu"
    echo "╠══════════════════════════════════════╣"
    printf "║  Docker: %s    App: %s     Worker: %s   ║\n" "$docker_status" "$app_status" "$worker_status"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo -n "Select option: "
  }

  local _dmenu_lines=18

  _dev_run() {
    printf '\e[%dA\e[J' $_dmenu_lines
    case "$1" in
      0) all_up ;;
      1) all_down ;;
      2) restart ;;
      3) if $app_running; then stop_app; else start_app; fi ;;
      4) if $worker_running; then stop_worker; else start_worker; fi ;;
      5) if $docker_running; then stop_docker; else start_docker; fi ;;
      6) echo "Running migrations..."; npm run migrate 2>&1 | sed 's/^/  /' ;;
      7) status; echo ""; read -s -n1 -p "Press any key to continue..." ;;
      8) local pid=$(lsof -ti :3000 2>/dev/null); if [ -n "$pid" ]; then echo "Killing PID $pid on :3000..."; kill $pid 2>/dev/null; sleep 1; echo "Done."; else echo "Nothing running on :3000."; fi ;;
      9) return ;;
    esac
  }

  while true; do
    local docker_running=false app_running=false worker_running=false
    if $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -q postgres; then docker_running=true; fi
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then app_running=true; fi
    if pgrep -f "node src/workers/renderer.js" >/dev/null 2>&1; then worker_running=true; fi
    local docker_status="${R}✗${X}"; $docker_running && docker_status="${G}✓${X}"
    local app_status="${R}✗${X}"; $app_running && app_status="${G}✓${X}"
    local worker_status="${R}✗${X}"; $worker_running && worker_status="${G}✓${X}"
    local app_cmd="Start" app_c="$G"; $app_running && { app_cmd="Stop"; app_c="$R"; }
    local worker_cmd="Start" worker_c="$G"; $worker_running && { worker_cmd="Stop"; worker_c="$R"; }
    local docker_cmd="Start" docker_c="$G"; $docker_running && { docker_cmd="Stop"; docker_c="$R"; }

    _draw_dev_menu $selected

    while true; do
      local key= arrow=
      read -s -n1 key 2>/dev/null
      if [[ "$key" == $'\e' ]]; then
        read -s -n2 -t 0.1 arrow 2>/dev/null || true
      fi
      if [[ "$arrow" == '[A' ]]; then
        ((selected--)); [[ $selected -lt 0 ]] && selected=$((items_len - 1))
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_dev_menu $selected
        printf '\e[?25h'
      elif [[ "$arrow" == '[B' ]]; then
        ((selected++)); [[ $selected -ge $items_len ]] && selected=0
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_dev_menu $selected
        printf '\e[?25h'
      elif [[ "$key" == $'\e' && -z "$arrow" ]]; then
        printf '\e[%dA\e[J' $_dmenu_lines; return
      elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == "" ]]; then
        [[ $selected -eq 9 ]] && { printf '\e[%dA\e[J' $_dmenu_lines; return; }
        _dev_run $selected
        echo ""; read -s -n1 -p "Press any key to continue..."
        break
      elif [[ "$key" =~ [0-8kKbB] ]]; then
        case "$key" in
          [0-8]) local n=$key; [[ $n -ge 1 ]] && _dev_run $((n - 1)) || _dev_run 0 ;;
          k|K) _dev_run 8 ;;
          b|B) printf '\e[%dA\e[J' $_dmenu_lines; return ;;
        esac
        echo ""; read -s -n1 -p "Press any key to continue..."
        break
      fi
    done
  done
}

deploy_submenu() {
  local selected=0 items_len=8
  local G=$'\e[32m' R=$'\e[31m' X=$'\e[0m'

  _ditem() {
    local idx=$1 sel=$2 text=$3
    local prefix="  "; [[ $idx -eq $sel ]] && prefix="❯ "
    printf "║%s%*s║\n" "$prefix$text" $((36 - ${#text})) ""
  }

  _draw_deploy_menu() {
    local sel=$1
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║            Deploy — v$APP_VERSION            ║"
    echo "╠══════════════════════════════════════╣"
    _ditem 0 $sel "1) Run tests"
    _ditem 1 $sel "2) Bump patch (v$APP_VERSION →)"
    _ditem 2 $sel "3) Bump minor (v$APP_VERSION →)"
    _ditem 3 $sel "4) Bump major (v$APP_VERSION →)"
    _ditem 4 $sel "5) Docker build/push"
    _ditem 5 $sel "6) Git commit"
    _ditem 6 $sel "7) Git push"
    _ditem 7 $sel "b) Back to main menu"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo -n "Select option: "
  }

  local _dmenu_lines=14

  _deploy_run() {
    printf '\e[%dA\e[J' $_dmenu_lines
    case "$1" in
      0) echo "Running tests..."; npm test 2>&1 | sed 's/^/  /' ;;
      1) echo "Bumping patch: v$APP_VERSION →"; npm version patch --no-git-tag-version 2>&1 | sed 's/^/  /'; APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0"); echo "  v$APP_VERSION" ;;
      2) echo "Bumping minor: v$APP_VERSION →"; npm version minor --no-git-tag-version 2>&1 | sed 's/^/  /'; APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0"); echo "  v$APP_VERSION" ;;
      3) echo "Bumping major: v$APP_VERSION →"; npm version major --no-git-tag-version 2>&1 | sed 's/^/  /'; APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0"); echo "  v$APP_VERSION" ;;
      4) docker_submenu ;;
       5) echo "Staging all changes..."; git add -A 2>&1 | sed 's/^/  /'; if [ -f release-note.md ]; then git commit -F release-note.md 2>&1 | sed 's/^/  /'; APP_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0"); else echo "release-note.md not found, skipping commit."; fi ;;
      6) echo "Pushing..."; git push 2>&1 | sed 's/^/  /' ;;
      7) return ;;
    esac
  }

  while true; do
    _draw_deploy_menu $selected

    while true; do
      local key= arrow=
      read -s -n1 key 2>/dev/null
      if [[ "$key" == $'\e' ]]; then
        read -s -n2 -t 0.1 arrow 2>/dev/null || true
      fi
      if [[ "$arrow" == '[A' ]]; then
        ((selected--)); [[ $selected -lt 0 ]] && selected=$((items_len - 1))
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_deploy_menu $selected
        printf '\e[?25h'
      elif [[ "$arrow" == '[B' ]]; then
        ((selected++)); [[ $selected -ge $items_len ]] && selected=0
        printf '\e[?25l\e[%dA\r' $_dmenu_lines
        _draw_deploy_menu $selected
        printf '\e[?25h'
      elif [[ "$key" == $'\e' && -z "$arrow" ]]; then
        printf '\e[%dA\e[J' $_dmenu_lines; return
      elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == "" ]]; then
        case $selected in
          4) printf '\e[%dA\e[J' $_dmenu_lines; docker_submenu ;;
          7) printf '\e[%dA\e[J' $_dmenu_lines; return ;;
          *) _deploy_run $selected; echo ""; read -s -n1 -p "Press any key to continue..." ;;
        esac
        break
      elif [[ "$key" =~ [0-9bB] ]]; then
        case "$key" in
          1) _deploy_run 0 ;;
          2) _deploy_run 1 ;;
          3) _deploy_run 2 ;;
          4) _deploy_run 3 ;;
          5) printf '\e[%dA\e[J' $_dmenu_lines; docker_submenu ;;
          6) _deploy_run 5 ;;
          7) _deploy_run 6 ;;
          b|B) printf '\e[%dA\e[J' $_dmenu_lines; return ;;
        esac
        [[ "$key" != "5" ]] && { echo ""; read -s -n1 -p "Press any key to continue..."; }
        break
      fi
    done
  done
}

menu() {
  local selected=0 items_len=3
  local G=$'\e[32m' R=$'\e[31m' X=$'\e[0m'

  _ritem() {
    local idx=$1 sel=$2 text=$3
    local prefix="  "; [[ $idx -eq $sel ]] && prefix="❯ "
    printf "║%s%*s║\n" "$prefix$text" $((36 - ${#text})) ""
  }

  _draw_menu() {
    local sel=$1
    echo ""
    echo "╔══════════════════════════════════════╗"
    echo "║       Screenshot API — Menu          ║"
    echo "╠══════════════════════════════════════╣"
    _ritem 0 $sel "1) Development"
    _ritem 1 $sel "2) Deploy"
    _ritem 2 $sel "q) Quit"
    echo "╚══════════════════════════════════════╝"
    echo ""
    echo -n "Select option: "
  }

  local menu_lines=9

  _exec() {
    printf '\e[%dA\e[J' $menu_lines
    case "$1" in
      0) dev_submenu ;;
      1) deploy_submenu ;;
      2) echo "Bye."; exit 0 ;;
    esac
  }

  while true; do
    _draw_menu $selected

    while true; do
      local key= arrow=
      read -s -n1 key 2>/dev/null
      if [[ "$key" == $'\e' ]]; then
        read -s -n2 -t 0.1 arrow 2>/dev/null || true
      fi
      if [[ "$arrow" == '[A' ]]; then
        ((selected--)); [[ $selected -lt 0 ]] && selected=$((items_len - 1))
        printf '\e[?25l\e[%dA\r' $menu_lines
        _draw_menu $selected
        printf '\e[?25h'
      elif [[ "$arrow" == '[B' ]]; then
        ((selected++)); [[ $selected -ge $items_len ]] && selected=0
        printf '\e[?25l\e[%dA\r' $menu_lines
        _draw_menu $selected
        printf '\e[?25h'
      elif [[ "$key" == $'\e' && -z "$arrow" ]]; then
        printf '\e[%dA\e[J' $menu_lines; echo "Bye."; exit 0
      elif [[ "$key" == $'\n' || "$key" == $'\r' || "$key" == "" ]]; then
        _exec $selected; break
      elif [[ "$key" =~ [0-9qQ] ]]; then
        case "$key" in
          1|2) _exec $(($key - 1)); break ;;
          q|Q) echo "Bye."; exit 0 ;;
        esac
      fi
    done
  done
}

case "${1:-}" in
  start)   all_up ;;
  stop)    all_down ;;
  restart) restart ;;
  status)  status ;;
  menu|*)  menu ;;
esac
