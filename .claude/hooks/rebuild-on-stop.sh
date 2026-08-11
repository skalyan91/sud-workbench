#!/bin/bash
# Rebuild the packaged app after a turn that changed the app's sources.
#
# Wired as a Stop hook (see .claude/settings.json), so it fires ONCE when the assistant finishes a
# turn — not on every individual edit (a ~5-min build after each keystroke-edit would be intolerable).
# It rebuilds only when something under app/, web/ or packaging/ has actually changed since the
# last build (this isn't a git repo, so the check is by file mtime, not `git diff`), and it runs
# the build detached in the BACKGROUND so it never stalls the session. Build output → .claude/last-build.log.
set -u

DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$DIR" || exit 0
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"   # absolute, so the re-exec below finds us whatever path the hook was invoked by

# THE BUILD ITSELF — this script re-executed under its own session (see the kickoff at the bottom).
# Deliberately BEFORE the stdin read: in this mode stdin is not the hook payload pipe, and `cat` on it
# would block forever.
if [ "${1:-}" = "--run-build" ]; then
  echo "$$" >".claude/.build.lock"
  bash packaging/make_bootstrap_app.sh >>".claude/last-build.log" 2>&1
  echo "[$(date '+%H:%M:%S')] build exited $?" >>".claude/last-build.log"
  rm -f ".claude/.build.lock"
  exit 0
fi

# Stop hooks re-fire while a previous Stop hook is still "active" — bail out of that re-entry so we
# don't loop (the payload carries stop_hook_active:true on the re-evaluation).
INPUT=$(cat 2>/dev/null || true)
case "$INPUT" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac

STAMP=".claude/.last-build-stamp"   # touched when a build is kicked off; sources newer than it ⇒ rebuild
LOG=".claude/last-build.log"
LOCK=".claude/.build.lock"          # holds the PID of an in-flight build

# A build is already running → let it finish; don't stack a second one on the same dist/ output.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then exit 0; fi

# Nothing changed since the last kickoff → nothing to do. (First run: no stamp ⇒ build.) grammars/
# is deliberately NOT watched here any more — it's fetched on demand into APP_DATA (app/grammars.py),
# not part of the source tree a rebuild needs to pick up.
if [ -f "$STAMP" ] && [ -z "$(find app web packaging -type f -newer "$STAMP" 2>/dev/null | head -1)" ]; then
  exit 0
fi

touch "$STAMP"
echo "[$(date '+%H:%M:%S')] rebuilding (sources changed)…" >"$LOG"
# Detached background build, in a SESSION OF ITS OWN.
#
# `nohup … & disown` was here before and did NOT work: none of the three starts a new session, so the
# build stayed in the session's process group and was killed with it the moment the harness reaped the
# turn — the very same reaping that SIGKILLs a GUI launched as a managed background job (see the
# "Launching the GUI" note in CLAUDE.md). The symptom was silent and easy to misread: the log held the
# "rebuilding…" line the hook itself writes, no "build exited N" line ever appeared, the lock file was
# gone (the child died before writing it), and dist/ quietly went stale for days while every turn
# reported a build had been kicked off.
#
# macOS ships no setsid(1), but Python's os.setsid() is the same call, and this project already leans on
# it for exactly this reason. The child re-executes THIS script with --run-build (the branch at the top),
# which keeps the lock file and the exit line in one place instead of duplicating them into a quoted
# one-liner. $SELF is passed as an argv element, so no path ever has to survive shell quoting.
PYBIN=".venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3 2>/dev/null || true)"
if [ -n "$PYBIN" ]; then
  "$PYBIN" -c "import os,sys; os.setsid(); os.execv('/bin/bash',['/bin/bash',sys.argv[1],'--run-build'])" "$SELF" >/dev/null 2>&1 &
else   # no Python at all → the old best-effort detach, which at least survives a plain hangup
  ( nohup bash "$SELF" --run-build >/dev/null 2>&1 ) &
  disown 2>/dev/null || true
fi
exit 0
