#!/bin/bash
# /usr/bin/sud-workbench — the RPM's thin launcher, counterpart of make_bootstrap_app.sh's
# "SUD Workbench" binary (macOS) and make_win_app.py's launcher.c/launcher.vbs (Windows).
#
# Launch decision (simpler than macOS's three-way split — see below for why):
#   1. venv already set up (sentinel present) → run the app.
#   2. first launch → run setup_venv.sh SYNCHRONOUSLY, in whatever terminal/output stream this
#      process already has, then launch on success.
#
# NO FAST-PATH/SLOW-PATH SPLIT, UNLIKE macOS. make_bootstrap_app.sh's launcher chooses between a
# silent GUI progress window (packaging/Progress.swift) and a visible Terminal, because macOS's first
# launch may ALSO need to install Homebrew + Python — a multi-minute, sudo-prompting operation nobody
# should sit through with no explanation. Here the RPM's own `Requires: python3.12 gtk3 …` already
# guarantees every system dependency before `dnf install` finishes, so first launch is JUST the pip
# install of requirements-core.txt (a minute or two, no sudo, no Homebrew-equivalent). A native GTK
# progress window would be nice polish (see setup_venv.sh's note on the marker protocol it still
# speaks, ready for exactly this) but isn't load-bearing the way the macOS split is — so this script
# stays a plain synchronous run. A user launching from a terminal sees the setup messages directly;
# a user launching from the desktop grid sees whatever their desktop environment does with a slow-
# starting app's stdout (usually nothing, which is the same "just wait" experience as any other
# first-run Python/pip installer under a .desktop launcher — Signal Desktop, several Electron apps,
# etc. all take this same posture on first run).
set -e

RES="/opt/sud-workbench"
APPSUP="${XDG_DATA_HOME:-$HOME/.local/share}/SUD Workbench"
VENV="$APPSUP/venv"

run_app() {
  export PYTHONPATH="$RES/appsrc"
  cd "$RES/appsrc"
  exec "$VENV/bin/python" -m app "$@"
}

# 1) Ready venv → run. The sentinel (.sud-core-ready) means the core install actually finished, so a
#    half-built venv from an interrupted setup is never mistaken for a ready one — same convention as
#    the macOS/Windows launchers.
if [ -x "$VENV/bin/python" ] && [ -f "$VENV/.sud-core-ready" ]; then
  run_app "$@"
fi

# 2) First launch: build the venv. Real pip output goes to setup.log (it is verbose and not
#    interesting on a normal run); the short status lines setup_venv.sh itself prints go straight to
#    this process's own stdout/stderr, since there is no separate progress window consuming them yet.
mkdir -p "$APPSUP"
echo "SUD Workbench — first-launch setup (this can take a minute or two)…" 1>&2
if ! "$RES/setup_venv.sh" 2>"$APPSUP/setup.log"; then
  echo "error: first-launch setup failed — see: $APPSUP/setup.log" 1>&2
  exit 1
fi

if [ -x "$VENV/bin/python" ] && [ -f "$VENV/.sud-core-ready" ]; then
  run_app "$@"
fi

echo "error: setup finished but the environment still isn't ready — see: $APPSUP/setup.log" 1>&2
exit 1
