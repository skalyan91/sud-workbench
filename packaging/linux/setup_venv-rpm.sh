#!/bin/bash
# First-launch setup for the RPM build of SUD Workbench — the Linux counterpart of
# packaging/setup_venv.sh (macOS) and packaging/windows/setup_venv.ps1. Builds a per-user venv from
# the system's OWN Python 3.12 (the RPM's `Requires: python3.12` guarantees one exists; see
# find_py.sh) and installs the CORE (torch-free) deps. The heavy Stanza/Japanese/Arabic tiers still
# install on demand at runtime, exactly as on the other two platforms.
#
# TWO THINGS DIFFER FROM THE macOS SCRIPT, each because Linux's own facts differ:
#
#   1. NO Homebrew-vs-python.org SDK question — python3.12 is a single system package here, already
#      guaranteed present by the RPM's own dependency (see sud-workbench.spec's Requires:), so this
#      script never installs Python itself the way bootstrap.sh's Homebrew fallback does.
#
#   2. PyGObject/pycairo BUILD FROM SOURCE, INSIDE THE VENV, AGAINST PYTHON 3.12 SPECIFICALLY — and
#      that "specifically" is the whole story. An earlier version of this script instead created the
#      venv with `--system-site-packages` and relied on Fedora's own prebuilt `python3-gobject`/
#      `python3-cairo`, on the reasoning that PyGObject is a meson/Autotools sdist needing a C
#      toolchain plus GTK/GObject-Introspection *development* headers, and Fedora's own bindings would
#      let this package skip all of that. MEASURED WRONG, live, in a real Fedora 41 container:
#      `python3-gobject`'s files land under `/usr/lib64/python3.13/site-packages/gi/`, because Fedora
#      41's DEFAULT `python3` is 3.13 — and Fedora ships no `python3.12`-targeted PyGObject build at
#      all (`dnf list available 'python3.12*'` lists the interpreter and its -devel/-libs/-tkinter
#      siblings, nothing GObject-related). A `python3.12 -m venv --system-site-packages` venv's system
#      site-packages path is `.../python3.12/site-packages` — which is empty of `gi` — so `import gi`
#      failed with `ModuleNotFoundError` regardless of the flag; confirmed directly with
#      `python3.12 -c "import gi"` outside any venv too, same failure. This project pins 3.12
#      everywhere (spaCy/thinc/blis wheel availability — see the root CLAUDE.md's Commands section),
#      and retargeting the venv at Fedora's default 3.13 to dodge this would be a bigger, unverified
#      architectural change for a packaging script to make unilaterally. So: build for real, against
#      the real pinned interpreter. `gcc`, `gobject-introspection-devel`, `cairo-gobject-devel`,
#      `pkgconf-pkg-config` and `python3.12-devel` are declared in the spec's `Requires:` specifically
#      for this (a first launch pays a real compile — a few minutes, not the "few seconds" a wheel
#      install would be — but it is CORRECT, where the system-site shortcut was not). `gtk3` and
#      `webkit2gtk4.1` stay Requires: as system LIBRARIES (the .so's PyGObject's own compiled
#      extension links against at import time) — only the Python-level bindings needed replacing.
#
# Marker protocol: NONE. macOS's setup_venv.sh speaks MSG/PROGRESS/DONE on stdout for a native Swift
# progress window (packaging/Progress.swift); there is no Linux counterpart to that window yet, so
# this script just prints plain, readable lines to stdout (a future GTK/zenity progress dialog could
# still parse a marker protocol reusing the same three verbs — nothing here forecloses that, there is
# simply no consumer to build one for today). All pip chatter still goes to a log file, not the
# terminal, so a normal launch stays quiet; see rpm-launcher.sh for how the two streams are split.
set -e
set -o pipefail

RES="$(cd "$(dirname "$0")" && pwd)"
APPSUP="${XDG_DATA_HOME:-$HOME/.local/share}/SUD Workbench"
VENV="$APPSUP/venv"
mkdir -p "$APPSUP"

# Shared python-detection helper (defines find_py) — packaging/linux/find_py.sh, staged alongside
# this script by make_rpm.sh into /opt/sud-workbench/.
. "$RES/find_py.sh"

say() { printf '%s\n' "$1"; }

say "Locating Python 3.12…"
PY="$(find_py || true)"
if [ -z "$PY" ]; then
  # The RPM's own Requires: python3.12 should make this unreachable on a `dnf install`; a from-source
  # or --nodeps install is the only way to land here, so fail loudly rather than guess at another
  # interpreter that might not have the right ABI.
  echo "setup_venv: no python3.12 found (expected at /usr/bin/python3.12 — is the python3.12 package installed?)" 1>&2
  exit 1
fi
echo "Using Python: $PY ($("$PY" --version 2>&1))" 1>&2

say "Creating the environment…"
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV" 1>&2
fi

say "Upgrading pip…"
"$VENV/bin/python" -m pip install --upgrade pip 1>&2

say "Installing dependencies (this can take a few minutes — PyGObject compiles from source; see the header note above)…"
# requirements-core.txt, UNFILTERED: PyGObject/pycairo install like every other line now, and pip's
# build backend (meson-python for PyGObject) reaches the dev headers the spec's Requires: guarantee.
"$VENV/bin/python" -m pip install -r "$RES/requirements-core.txt" 1>&2

say "Finishing up…"
# Sentinel: a completed core install, same name and meaning as the macOS/Windows scripts' — the
# launcher checks this (not just the venv python) so a half-built venv from an interrupted run is
# never mistaken for a ready one.
touch "$VENV/.sud-core-ready"

say "Setup complete."
