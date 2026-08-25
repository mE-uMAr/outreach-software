#!/usr/bin/env bash
#
# Build the Windows installers locally and publish them to a GitHub release.
#
# Everything runs on this machine — there is no CI. Building here is free,
# reproduces exactly what a user installs, and lets a broken build be caught
# before anything is published rather than after.
#
# Usage:
#   ./scripts/release.sh                 # build, then publish as v<package.json version>
#   ./scripts/release.sh v1.2.0          # build and publish under an explicit tag
#   ./scripts/release.sh --build-only    # build the installers, publish nothing
#   ./scripts/release.sh --draft         # publish as a draft release
#   ./scripts/release.sh --notes "..."   # release notes (defaults to the commit subject)
#
# Requirements: Node 20+, Python 3.11+, and the GitHub CLI (`gh auth login`).

set -euo pipefail
# Without this, `./scripts/release.sh | tail` reports tail's exit status and a
# failed build looks like a successful one.
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BLUE=$'\033[0;34m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BLUE" "$OFF" "$1"; }
ok()   { printf '%s  ✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s  !%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

TAG=""
BUILD_ONLY=0
DRAFT=0
NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) BUILD_ONLY=1 ;;
    --draft)      DRAFT=1 ;;
    --notes)      NOTES="${2:-}"; shift ;;
    -h|--help)    sed -n '2,18p' "$0"; exit 0 ;;
    v*)           TAG="$1" ;;
    *)            die "Unknown option: $1" ;;
  esac
  shift
done

VERSION="$(node -p "require('./package.json').version")"
TAG="${TAG:-v$VERSION}"

# --------------------------------------------------------------- prerequisites

step "Checking prerequisites"
command -v node >/dev/null || die "node is not installed (need Node 20+)"
command -v python >/dev/null || command -v python3 >/dev/null || die "python is not installed"
ok "node $(node --version)"

PY="python"
command -v python >/dev/null 2>&1 || PY="python3"
if [[ -x ".venv/Scripts/python.exe" ]]; then
  PY=".venv/Scripts/python.exe"
elif [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
fi
ok "python $("$PY" --version 2>&1 | cut -d' ' -f2) ($PY)"

if [[ $BUILD_ONLY -eq 0 ]]; then
  command -v gh >/dev/null || die "the GitHub CLI is not installed — see https://cli.github.com"
  gh auth status >/dev/null 2>&1 || die "not signed in to GitHub — run: gh auth login"
  ok "gh authenticated"
fi

# ------------------------------------------------------------------ the build

step "Installing dependencies"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
"$PY" -m pip install --quiet --disable-pip-version-check -r requirements-dev.txt
ok "dependencies ready"

step "Checking the engine"
"$PY" -m ruff check engine || die "engine lint failed"
"$PY" -m pytest -q || die "engine tests failed"
ok "engine checks passed"

step "Type-checking the app"
npm run typecheck || die "typecheck failed"
ok "types clean"

step "Freezing the engine"
rm -rf dist/linkedin-outreach-engine
"$PY" -m PyInstaller --clean --noconfirm --workpath .pyinstaller engine.spec \
  || die "PyInstaller failed"

ENGINE_EXE="dist/linkedin-outreach-engine/linkedin-outreach-engine.exe"
[[ -f "$ENGINE_EXE" ]] || ENGINE_EXE="dist/linkedin-outreach-engine/linkedin-outreach-engine"
[[ -f "$ENGINE_EXE" ]] || die "the frozen engine is missing from dist/"
ok "engine frozen"

# The frozen binary is what users actually run, so it is smoke-tested as itself
# — from a different directory, with a real request — rather than trusted
# because the source-mode engine worked.
step "Smoke-testing the frozen engine"
SMOKE_OUT="$(cd "$(dirname "$ENGINE_EXE")" && printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"system.info"}' \
  '{"jsonrpc":"2.0","id":2,"method":"system.dbInfo"}' \
  '{"jsonrpc":"2.0","id":3,"method":"browser.status"}' \
  | "./$(basename "$ENGINE_EXE")" 2>/dev/null)" || die "the frozen engine did not run"

grep -q '"result"' <<<"$SMOKE_OUT" || die "the frozen engine returned no result"
grep -q '"schemaVersion"' <<<"$SMOKE_OUT" || die "the frozen engine could not open its database"
ok "frozen engine answers over stdio"

# electron-builder downloads a code-signing bundle containing macOS symlinks.
# Windows refuses to create those without elevation, which fails the whole
# extraction — so the bundle is unpacked here without them. rcedit, the part
# actually needed on Windows, is kept.
WINCODESIGN_VERSION="2.6.0"
WINCODESIGN_CACHE="${LOCALAPPDATA:-$HOME/AppData/Local}/electron-builder/Cache/winCodeSign"
WINCODESIGN_DIR="$WINCODESIGN_CACHE/winCodeSign-$WINCODESIGN_VERSION"

if [[ ! -f "$WINCODESIGN_DIR/rcedit-x64.exe" ]]; then
  step "Preparing the Windows signing tools"
  ARCHIVE="$(find "$WINCODESIGN_CACHE" -maxdepth 1 -name '*.7z' 2>/dev/null | head -1 || true)"
  if [[ -n "$ARCHIVE" ]]; then
    rm -rf "$WINCODESIGN_DIR"
    ./node_modules/7zip-bin/win/x64/7za.exe x -bd -y "$ARCHIVE" "-o$WINCODESIGN_DIR" '-xr!darwin' >/dev/null       && ok "signing tools ready (macOS files skipped)"       || warn "could not pre-extract the signing tools; electron-builder will retry"
  else
    warn "no cached signing bundle yet — the first build downloads it"
  fi
fi

step "Building the installers"
npx electron-vite build || die "renderer build failed"
npx electron-builder --win --config electron-builder.yml || die "electron-builder failed"

mapfile -t ARTIFACTS < <(find release -maxdepth 1 -type f \
  \( -name '*.exe' -o -name '*.blockmap' -o -name 'latest*.yml' \) | sort)
[[ ${#ARTIFACTS[@]} -gt 0 ]] || die "no installers were produced in release/"

ok "built ${#ARTIFACTS[@]} artifact(s):"
for artifact in "${ARTIFACTS[@]}"; do
  printf '      %s (%s)\n' "$(basename "$artifact")" "$(du -h "$artifact" | cut -f1)"
done

if [[ $BUILD_ONLY -eq 1 ]]; then
  step "Done"
  ok "installers are in release/ — nothing published (--build-only)"
  exit 0
fi

# ------------------------------------------------------------------ publishing

step "Publishing $TAG"

if [[ -z "$NOTES" ]]; then
  NOTES="$(git log -1 --pretty=%s)"
fi

RELEASE_BODY="$(cat <<EOF
$NOTES

## Install

Download **LinkedIn Outreach-Setup-$VERSION-x64.exe** and run it. The portable
build needs no installation.

Windows SmartScreen warns on first run because the build is not code-signed —
choose *More info → Run anyway*.

## What is included

The installer is self-contained: Chromium (the app UI), CPython and the engine
all ship inside it, so the machine needs neither Python nor Node.js. On first run
the app asks you to connect Claude and LinkedIn, and to download the private
browser the automation drives.

Built locally from \`$(git rev-parse --short HEAD)\`.
EOF
)"

if gh release view "$TAG" >/dev/null 2>&1; then
  warn "release $TAG already exists — uploading over its assets"
  gh release upload "$TAG" "${ARTIFACTS[@]}" --clobber || die "upload failed"
else
  DRAFT_FLAG=()
  [[ $DRAFT -eq 1 ]] && DRAFT_FLAG=(--draft)

  # Tag the exact commit that produced these binaries, so a release can always
  # be traced back to the source it was built from.
  git tag -f "$TAG" >/dev/null
  git push -f origin "$TAG" >/dev/null 2>&1 || warn "could not push the tag"

  gh release create "$TAG" "${ARTIFACTS[@]}" \
    --title "LinkedIn Outreach $VERSION" \
    --notes "$RELEASE_BODY" \
    "${DRAFT_FLAG[@]}" || die "creating the release failed"
fi

step "Done"
ok "published $TAG — $(gh release view "$TAG" --json url --jq .url)"
