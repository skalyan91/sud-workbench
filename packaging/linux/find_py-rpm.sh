#!/bin/bash
# Shared Python 3.12 detection for the RPM build's first-launch bootstrap, on the same lines as
# packaging/find_py.sh (macOS) and packaging/windows/find_py.ps1 — this is the Linux third of that
# trio, adapted rather than re-derived (see that file for the ranking rationale this one skips: on
# Fedora/RHEL-family distros there is exactly ONE python3.12, installed as the `python3.12` package
# and never SDK-linked the way macOS's Homebrew-vs-python.org choice is, so there is nothing to rank).
#
# SOURCED, not executed — defines find_py(), which echoes a suitable interpreter's path and returns
# 0, or returns 1. The RPM's own `Requires: python3.12` (see sud-workbench.spec) means `dnf install`
# already guarantees one of these exists on any machine the package installs on; this function is
# still needed because the launcher has no other reliable way to learn the exact path across distro
# naming conventions (Fedora: /usr/bin/python3.12; a from-source build: whatever `command -v` finds).
find_py() {
  for p in /usr/bin/python3.12 /usr/local/bin/python3.12 \
           "$(command -v python3.12 2>/dev/null)"; do
    [ -n "$p" ] && [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}
