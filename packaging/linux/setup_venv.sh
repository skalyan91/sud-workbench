#!/bin/bash
# First-launch setup for the Debian/apt build of SUD Workbench — the Linux counterpart of
# packaging/setup_venv.sh (macOS) and packaging/windows/setup_venv.ps1.
#
# Builds a per-user venv from the SYSTEM python3.12 that DEBIAN/control already guaranteed present
# (`Depends: python3 (>= 3.12), python3-venv`, enforced by apt/dpkg before this script exists on
# disk anywhere). That is the one structural difference from the other two platforms' quiet-setup
# scripts: there is no "Python might be missing, install it first" branch here at all — no Homebrew
# tap, no winget/python.org ladder — because dpkg already refused to install this package without
# it. What is left to do at first run is exactly what setup_venv.sh/setup_venv.ps1 already do once
# their own Python search succeeds: create the venv, pip install the CORE (torch-free) deps. The
# heavy Stanza/Japanese/Arabic tiers still download on demand at runtime via app/extras.py, same as
# every other platform.
#
# ⚠ --system-site-packages IS LOAD-BEARING, AND IS THE ONE GENUINE LINUX WRINKLE IN THIS WHOLE
# MODEL — read this before "simplifying" it away. pywebview's GTK backend (what app/linux/shell.py's
# runtime chrome sits on top of) needs Python bindings for GTK/WebKit2/Cairo — `import gi` and
# `import cairo`, both named explicitly in requirements-core.txt as
# `PyGObject; sys_platform=="linux"` / `pycairo; sys_platform=="linux"` — bound to the EXACT
# libgtk-3/libwebkit2gtk-4.1/libcairo sonames the system linker resolves. Two ways to get there:
#   (a) pip-install PyGObject/pycairo into the isolated venv, the way pyobjc/pythonnet are
#       pip-installed on macOS/Windows. REJECTED for PyGObject: verified against pywebview==6.2.1's
#       own pyproject.toml — PyGObject is NOT a base dependency on Linux at all, it sits behind an
#       opt-in `gtk` extra that requirements-core.txt's bare `pywebview==6.2.1` line does not
#       request. REJECTED for pycairo too, and MEASURED rather than assumed: with no system
#       `python3-cairo` installed, `pip install pycairo` inside this very venv tried to BUILD it from
#       source via meson and failed outright — `Unknown compiler(s): [['cc'], ['gcc'], ...]` — because
#       no C compiler exists in DEBIAN/control's Depends. Building either from source would need
#       libgirepository-dev/gobject-introspection/libcairo2-dev/pkg-config/a C compiler as BUILD-time
#       packages (on top of the runtime ones below) for bindings that have to match whatever
#       GTK/WebKit/Cairo the target distro shipped — precisely the "bundling compiled wheels for
#       every distro is a portability nightmare" reasoning the whole venv-bootstrap model exists to
#       avoid, aimed at the two packages where pip is the wrong tool for the job.
#   (b) let apt install the prebuilt system bindings (`python3-gi`, `python3-cairo`,
#       `python3-gi-cairo`, no compiler ever invoked, exactly matched to the
#       `libgtk-3-0t64`/`gir1.2-webkit2-4.1` apt already installs alongside them) and give THIS venv
#       visibility into system dist-packages. CHOSEN.
# `--system-site-packages` is what makes (b) actually work: without it, a venv's sys.path excludes
# the system dist-packages directory entirely and `python -c "import gi"` fails with
# ModuleNotFoundError even though `python3 -c "import gi"` (the SYSTEM interpreter) succeeds right
# next to it — that split personality is exactly what a plain `python3.12 -m venv` would produce
# here. With it, `pip install -r requirements-core.txt` reports both
# "Requirement already satisfied: PyGObject in /usr/lib/python3/dist-packages" AND the pycairo
# equivalent, and pip's dependency resolver never touches either package's build backend at all.
# Every other package in requirements-core.txt is still a normal isolated pip install into the
# venv's own site-packages (which always shadows the system copy first), so this changes nothing for
# spaCy/thinc/wiktra/etc. — only `gi`/`cairo` ride on the system install.
set -e
set -o pipefail

RES="$(cd "$(dirname "$0")" && pwd)"
# Matches app/paths.py's APP_DATA exactly (same env var, same fallback, same "SUD Workbench" leaf
# name) — one venv, one model cache, one state.json, all under the directory the app itself already
# reads and writes, so nothing here invents a second notion of "where this app's data lives".
APPSUP="${XDG_DATA_HOME:-$HOME/.local/share}/SUD Workbench"
VENV="$APPSUP/venv"
mkdir -p "$APPSUP"

. "$RES/find_py.sh"

echo "──────────────────────────────────────────────"
echo "  SUD Workbench — first-launch setup"
echo "──────────────────────────────────────────────"

PY="$(find_py || true)"
if [ -z "$PY" ]; then
  # Should be unreachable — see find_py.sh's own header on why this is a defensive check rather
  # than the expected path, unlike the identical-looking test on macOS/Windows.
  echo "error: no python3.12 found, despite this package depending on python3 (>= 3.12)." >&2
  echo "Try: sudo apt install --reinstall python3.12 python3-venv" >&2
  exit 1
fi
echo "• Using Python: $PY  ($("$PY" --version 2>&1))"

if [ ! -x "$VENV/bin/python" ]; then
  echo "• Creating the environment at: $VENV"
  "$PY" -m venv --system-site-packages "$VENV"   # --system-site-packages: see header — this is what lets the venv "import gi"
fi

echo "• Upgrading pip…"
"$VENV/bin/python" -m pip install --upgrade pip

echo "• Installing core dependencies (this can take a few minutes on first run)…"
"$VENV/bin/python" -m pip install -r "$RES/requirements-core.txt"

# Sentinel: a completed core install. The launcher checks this (not just the venv python) so a
# half-built venv from an interrupted run is never mistaken for a ready one — same convention as
# macOS's setup_venv.sh and Windows' setup_venv.ps1.
touch "$VENV/.sud-core-ready"

echo "• Setup complete."
echo "──────────────────────────────────────────────"
