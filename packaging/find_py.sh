#!/bin/bash
# Shared Python 3.12 detection for SUD Workbench's launcher and first-launch setup scripts.
#
# This file is SOURCED, not executed — it defines find_py(), which echoes the path of a suitable
# python3.12 and returns 0, or returns 1.
#
# ⚠ THE CHOICE OF INTERPRETER DECIDES WHAT THE WINDOW LOOKS LIKE, which is why this is no longer
# simply "the first python3.12 on the machine". The app runs INSIDE this interpreter, so the
# interpreter's own Mach-O header is the app's: AppKit reads its LC_BUILD_VERSION `sdk` field and
# grants the current design language only to a binary linked against the current SDK, holding
# everything older at the previous appearance for compatibility. On macOS 26 that difference shows at
# the window EDGE — an app built against an older SDK keeps the smaller, pre-Tahoe corner radius while
# every native app around it is fully rounded. That is exactly how it was reported ("not seeing
# fully-rounded corners, even though other apps have them"), on a machine where the old order picked a
# python.org build.
#
# Homebrew's python@3.12 tracks the current SDK; python.org's framework builds deliberately target an
# old deployment SDK for portability, and a Command Line Tools python3.12 varies. All of them RUN the
# app perfectly — only the chrome differs — so the SDK is a PREFERENCE and never a requirement:
# candidates are ranked, and the best available one wins even when none is current.
#
# `otool` comes with the Command Line Tools. Where it is missing every candidate scores 0, ties keep
# the earlier one, and the list order below decides — which is precisely what this function did before.

# The major SDK version a python binary was linked against ("26"), or 0 when it cannot be read.
_py_sdk_major() {
  command -v otool >/dev/null 2>&1 || { echo 0; return; }
  # Follow the shim to the real framework binary: /opt/homebrew/bin/python3.12 is a symlink, and
  # otool has to be pointed at the file that actually carries the load commands.
  local real; real="$(cd "$(dirname "$1")" 2>/dev/null && p="$(basename "$1")" \
    && while [ -L "$p" ]; do p="$(readlink "$p")"; cd "$(dirname "$p")" 2>/dev/null || break; p="$(basename "$p")"; done \
    && echo "$PWD/$p")"
  [ -n "$real" ] && [ -e "$real" ] || real="$1"
  local v
  v="$(otool -l "$real" 2>/dev/null | awk '/LC_BUILD_VERSION/{inb=1} inb&&$1=="sdk"{split($2,a,"."); print a[1]; exit}')"
  case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}

find_py() {
  local os_major best="" best_sdk=-1 p sdk
  # An explicit override wins outright and is not SDK-ranked — someone naming an interpreter has
  # already decided. This is the supported way to rebuild an existing install against a different
  # Python: delete the venv and relaunch with SUD_PYTHON set (see "Resetting an install" in README).
  if [ -n "${SUD_PYTHON:-}" ] && [ -x "${SUD_PYTHON}" ]; then echo "$SUD_PYTHON"; return 0; fi
  os_major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
  case "$os_major" in ''|*[!0-9]*) os_major=0 ;; esac
  for p in /opt/homebrew/opt/python@3.12/bin/python3.12 /opt/homebrew/bin/python3.12 \
           /usr/local/opt/python@3.12/bin/python3.12 /usr/local/bin/python3.12 \
           /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
           "$(command -v python3.12 2>/dev/null)"; do
    [ -n "$p" ] && [ -x "$p" ] || continue
    sdk="$(_py_sdk_major "$p")"
    # An SDK at or beyond the running OS is as good as it gets — take it and stop looking, so the
    # common case (Homebrew, first in the list) still costs exactly one otool call.
    if [ "$os_major" -gt 0 ] && [ "$sdk" -ge "$os_major" ]; then echo "$p"; return 0; fi
    # Otherwise remember the newest-SDK candidate; ties keep the EARLIER one, so the list order above
    # remains the tie-break it has always been.
    if [ "$sdk" -gt "$best_sdk" ]; then best_sdk="$sdk"; best="$p"; fi
  done
  [ -n "$best" ] && { echo "$best"; return 0; }
  return 1
}
