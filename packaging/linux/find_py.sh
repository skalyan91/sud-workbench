#!/bin/bash
# Shared Python 3.12 detection for SUD Workbench's Debian/apt launcher and first-launch setup
# script — the Linux counterpart of packaging/find_py.sh (macOS) and packaging/windows/find_py.ps1.
#
# UNLIKE those two, this one is almost never load-bearing. DEBIAN/control's `Depends: python3
# (>= 3.12), python3-venv` is an INSTALL-TIME GUARANTEE that dpkg enforces before this package's
# files can land on disk at all — there is no "Python might not be here" branch to write, the way
# macOS's find_py.sh has to search Homebrew/python.org locations because nothing forced a Python
# onto that machine first. This file exists anyway, for two reasons: (1) parity — every other
# platform's setup script sources a find_py that ECHOES a path rather than assuming one, so a reader
# who knows one of them recognises this one; (2) a real defensive gap — `apt install --force-depends`
# or a since-removed interpreter can leave a system that satisfied Depends at install time and does
# not now, and failing loud with an actionable message (setup_venv.sh's caller) beats a bare
# "/usr/bin/python3.12: No such file" traceback.
#
# This file is SOURCED, not executed — it only defines find_py(), which echoes the path of a
# suitable python3.12 and returns 0, or returns 1.
find_py() {
  for p in /usr/bin/python3.12 /usr/local/bin/python3.12 \
           "$(command -v python3.12 2>/dev/null)"; do
    [ -n "$p" ] && [ -x "$p" ] && { echo "$p"; return 0; }
  done
  # Fallback: a system where `python3` itself resolves to 3.12.x but carries no `python3.12` symlink
  # (unusual on Debian/Ubuntu, whose python3.X packages always ship the versioned name, but cheap to
  # cover and keeps this exactly as generous as the macOS/Windows finders).
  local p3
  p3="$(command -v python3 2>/dev/null)"
  if [ -n "$p3" ] && "$p3" -c 'import sys; raise SystemExit(0 if sys.version_info[:2]==(3,12) else 1)' 2>/dev/null; then
    echo "$p3"; return 0
  fi
  return 1
}
