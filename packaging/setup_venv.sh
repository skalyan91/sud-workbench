#!/bin/bash
# Quiet, no-sudo first-launch setup for the bootstrap build of SUD Workbench.
#
# ONLY creates the per-user venv and pip-installs the CORE deps. It assumes a suitable python3.12
# already exists — the launcher only takes this path when find_py() succeeds, so no Homebrew/network
# install (and hence no sudo) is needed here. The heavy Stanza/Japanese/Arabic tiers still download
# on demand at runtime.
#
# The launcher runs this piped into the native progress helper:  setup_venv.sh 2>setup.log | progress
# So this script speaks a tiny marker protocol on STDOUT for the progress window …
#     MSG <text>        → set the status label
#     PROGRESS <0..1>   → set the determinate bar fraction
#     DONE              → success; the helper closes its window
# … while all real pip output goes to STDERR (which the launcher redirects into setup.log), keeping
# it out of the user's face. On full success it writes a sentinel so later launches skip setup.
set -e
set -o pipefail

RES="$(cd "$(dirname "$0")" && pwd)"
APPSUP="$HOME/Library/Application Support/SUD Workbench"
VENV="$APPSUP/venv"
mkdir -p "$APPSUP"

# Shared python-detection helper (defines find_py).
. "$RES/find_py.sh"

# Marker helpers — these are the ONLY things allowed to write to stdout (the progress pipe).
say() { printf 'MSG %s\n' "$1"; }
bar() { printf 'PROGRESS %s\n' "$1"; }

bar 0.05
say "Locating Python 3.12…"
PY="$(find_py || true)"
if [ -z "$PY" ]; then
  # The launcher should not have taken this path without a python3.12; bail so it can fall back.
  echo "setup_venv: no python3.12 found" 1>&2
  exit 1
fi
echo "Using Python: $PY ($("$PY" --version 2>&1))" 1>&2

bar 0.15
say "Creating the environment…"
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV" 1>&2
fi

bar 0.35
say "Upgrading pip…"
"$VENV/bin/python" -m pip install --upgrade pip 1>&2

bar 0.55
say "Installing dependencies (this can take a few minutes)…"
# Coarse progress: nudge the bar upward as pip reports each "Collecting" line, capped short of the
# final phase. All pip chatter is copied to stderr (→ setup.log), never to the progress pipe.
frac=0.55
"$VENV/bin/python" -m pip install -r "$RES/requirements-core.txt" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line" 1>&2
  case "$line" in
    Collecting*|Downloading*)
      frac=$(awk -v f="$frac" 'BEGIN{ f+=0.03; if (f>0.9) f=0.9; printf "%.3f", f }')
      bar "$frac"
      ;;
  esac
done

bar 0.97
say "Finishing up…"
# Sentinel: a completed core install. The launcher checks this (not just the venv python) so a
# half-built venv from an interrupted run is never mistaken for a ready one.
touch "$VENV/.sud-core-ready"

bar 1.0
printf 'DONE\n'
