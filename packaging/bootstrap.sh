#!/bin/bash
# First-launch setup for the bootstrap build of SUD Workbench.
#
# Builds a per-user virtualenv from the user's OWN Python 3.12 (a Homebrew/framework build linked
# against the current macOS SDK), so the app runs as a modern-SDK process and gets the native Tahoe
# window chrome — unlike a bundled python-build-standalone (SDK 15.5). Installs only the CORE
# (torch-free) deps; the heavy Stanza/Japanese/Arabic tiers still download on demand.
#
# Run in a Terminal window by the app launcher on first launch (so pip/brew output is visible and
# any sudo prompt works). On success it launches the app; subsequent launches skip this entirely.
set -e

RES="$(cd "$(dirname "$0")" && pwd)"
APPSUP="$HOME/Library/Application Support/SUD Workbench"
VENV="$APPSUP/venv"
mkdir -p "$APPSUP"

echo "──────────────────────────────────────────────"
echo "  SUD Workbench — first-launch setup"
echo "──────────────────────────────────────────────"

# 1) Find a Python 3.12 built against a recent SDK. Homebrew's is preferred (it tracks the current
#    macOS SDK → the app gets the native Tahoe appearance); a python.org framework build also works.
#    Detection lives in the shared find_py.sh (also used by the launcher and setup_venv.sh).
. "$RES/find_py.sh"

PY="$(find_py || true)"
if [ -z "$PY" ]; then
  echo "• No Python 3.12 found — installing one via Homebrew."
  if ! command -v brew >/dev/null 2>&1; then
    echo "• Homebrew isn't installed. Installing it now (you may be asked for your password)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$([ -x /opt/homebrew/bin/brew ] && /opt/homebrew/bin/brew shellenv || /usr/local/bin/brew shellenv)"
  fi
  echo "• brew install python@3.12 …"
  brew install python@3.12
  PY="$(find_py)"
fi
[ -n "$PY" ] || { echo "error: could not find or install Python 3.12."; echo "Install it (e.g. 'brew install python@3.12') and reopen SUD Workbench."; read -r -p "Press Return to close…" _; exit 1; }
echo "• Using Python: $PY  ($("$PY" --version 2>&1))"

# 2) Create the venv (from that Python → modern SDK) and install the core deps.
if [ ! -x "$VENV/bin/python" ]; then
  echo "• Creating the environment at: $VENV"
  "$PY" -m venv "$VENV"
fi
echo "• Installing core dependencies (this can take a few minutes on first run)…"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$RES/requirements-core.txt"

# Sentinel: a completed core install. The launcher checks this (not just the venv python) so a
# half-built venv from an interrupted run is never mistaken for a ready one. Kept in step with the
# quiet GUI path (setup_venv.sh), which writes the same marker.
touch "$VENV/.sud-core-ready"

echo "• Setup complete."
echo "──────────────────────────────────────────────"

# 3) Launch the app (this window can be closed once the app window appears).
export PYTHONPATH="$RES/appsrc"
cd "$RES/appsrc"
exec "$VENV/bin/python" -m app
