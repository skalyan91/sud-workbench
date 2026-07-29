#!/bin/bash
# Shared Python 3.12 detection for SUD Workbench's launcher and first-launch setup scripts.
#
# Prefers Homebrew's python@3.12 (it tracks the current macOS SDK, so the app gets the native Tahoe
# window chrome); a python.org framework build also works. This file is SOURCED, not executed — it
# only defines find_py(), which echoes the path of a suitable python3.12 and returns 0, or returns 1.
find_py() {
  for p in /opt/homebrew/opt/python@3.12/bin/python3.12 /opt/homebrew/bin/python3.12 \
           /usr/local/opt/python@3.12/bin/python3.12 /usr/local/bin/python3.12 \
           /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
           "$(command -v python3.12 2>/dev/null)"; do
    [ -n "$p" ] && [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}
