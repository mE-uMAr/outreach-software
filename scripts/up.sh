#!/usr/bin/env bash
#
# One-command local start.
#
# Brings up everything needed to run the app from a clean checkout:
#   1. Node dependencies
#   2. a Python virtualenv with the engine's dependencies
#   3. the Electron app in dev mode (which spawns the engine itself)
#
# Usage:
#   ./scripts/up.sh              # set up if needed, then run
#   ./scripts/up.sh --setup-only # prepare dependencies and exit
#   ./scripts/up.sh --clean      # reinstall node_modules and .venv first

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BLUE=$'\033[0;34m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'; OFF=$'\033[0m'
step() { printf '%s==>%s %s\n' "$BLUE" "$OFF" "$1"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

SETUP_ONLY=0
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --setup-only) SETUP_ONLY=1 ;;
    --clean)      CLEAN=1 ;;
    -h|--help)    sed -n '2,14p' "$0"; exit 0 ;;
    *)            die "Unknown option: $arg" ;;
  esac
done

# ---------------------------------------------------------------- prerequisites

step "Checking prerequisites"
command -v node >/dev/null || die "node is not installed (need Node 20+)"
command -v npm  >/dev/null || die "npm is not installed"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required, found $(node -v)"

PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null; then PYTHON_BIN="$candidate"; break; fi
done
[ -n "$PYTHON_BIN" ] || die "python3 is not installed (need Python 3.11+)"
ok "node $(node -v), npm $(npm -v), $($PYTHON_BIN --version)"

if [ "$CLEAN" -eq 1 ]; then
  step "Removing node_modules and .venv"
  rm -rf node_modules .venv
  ok "cleaned"
fi

# ------------------------------------------------------------------------ node

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  step "Installing Node dependencies"
  npm install --no-audit --no-fund
  ok "node_modules ready"
else
  ok "Node dependencies up to date"
fi

# Electron ships a prebuilt binary downloaded by its postinstall script. A
# blocked or interrupted download leaves the package present but unusable.
ELECTRON_BIN="node_modules/electron/dist/electron"
case "$(uname -s)" in
  Darwin)      ELECTRON_BIN="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ;;
  MINGW*|MSYS*|CYGWIN*) ELECTRON_BIN="node_modules/electron/dist/electron.exe" ;;
esac

if [ ! -e "$ELECTRON_BIN" ]; then
  step "Downloading the Electron binary (~110 MB)"
  # An interrupted download leaves a half-extracted dist/ that the installer then
  # treats as complete, so it is cleared before each attempt.
  for attempt in 1 2 3; do
    rm -rf node_modules/electron/dist
    if node node_modules/electron/install.js; then break; fi
    warn "attempt $attempt failed; retrying"
  done
  [ -e "$ELECTRON_BIN" ] || die "Electron download failed — re-run once github.com is reachable"
  ok "Electron binary ready"
fi

# ---------------------------------------------------------------------- python

if [ ! -d .venv ]; then
  step "Creating the Python virtualenv"
  "$PYTHON_BIN" -m venv .venv
  ok ".venv created"
fi

VENV_PY=".venv/bin/python"
[ -x "$VENV_PY" ] || VENV_PY=".venv/Scripts/python.exe"   # Git Bash on Windows

if ! "$VENV_PY" -c 'import httpx, playwright' >/dev/null 2>&1; then
  step "Installing engine dependencies"
  PIP_LOG="$(mktemp)"
  "$VENV_PY" -m pip install --quiet --upgrade pip >>"$PIP_LOG" 2>&1 || true
  if "$VENV_PY" -m pip install --quiet -r requirements-dev.txt >>"$PIP_LOG" 2>&1; then
    ok "engine dependencies installed"
  else
    warn "pip install failed — the engine still boots and the UI still opens,"
    warn "but browser automation stays unavailable until Playwright installs."
    warn "last error: $(grep -m1 '^ERROR' "$PIP_LOG" || tail -n1 "$PIP_LOG")"
    warn "full log: $PIP_LOG"
  fi
else
  ok "Engine dependencies up to date"
fi

# ----------------------------------------------------------------- smoke check

step "Checking the engine responds"
if printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.info"}' \
    | "$VENV_PY" -u engine/main.py 2>/dev/null | grep -q '"result"'; then
  ok "engine answered system.info"
else
  die "engine did not respond — run: $VENV_PY engine/main.py"
fi

# Chromium is what the automation drives. The app can also download it from
# Settings on first use, so a failure here is a warning, not a stop.
if "$VENV_PY" -c 'import playwright' >/dev/null 2>&1; then
  if "$VENV_PY" -c '
import sys
from pathlib import Path
sys.path.insert(0, ".")
from engine.services.browser.runtime import runtime_status
sys.exit(0 if runtime_status()["installed"] else 1)
' >/dev/null 2>&1; then
    ok "Chromium ready for automation"
  else
    step "Downloading Chromium for the automation (~150 MB)"
    if "$VENV_PY" -m playwright install chromium >/dev/null 2>&1; then
      ok "Chromium installed"
    else
      warn "Chromium download failed — install it from Settings inside the app"
    fi
  fi
fi

if [ "$SETUP_ONLY" -eq 1 ]; then
  step "Setup complete"
  echo "Run './scripts/up.sh' (or 'npm run dev') to start the app."
  exit 0
fi

# -------------------------------------------------------------------- run them

step "Starting LinkedIn Outreach"
echo "   Electron + Vite with HMR; the Python engine is spawned by the app."
echo "   Press Ctrl+C to stop everything."
echo
exec npm run dev
