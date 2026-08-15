#!/bin/bash
# Build the BOOTSTRAP "SUD Workbench.app" — a tiny bundle that, on first launch, builds a per-user
# venv from the user's OWN Python 3.12 (installing one via Homebrew if needed). Because that Python
# is linked against the current macOS SDK, the app runs with the native Tahoe window chrome — the
# thing a bundled python-build-standalone (SDK 15.5) can't give. Only the CORE deps are installed;
# the heavy Stanza/Japanese/Arabic tiers download on demand at runtime.
#
# The bundle ships the app SOURCE (tiny) + a launcher + the bootstrap script + the icon. No GitHub
# clone needed. Usage:  packaging/make_bootstrap_app.sh [OUTPUT_DIR]   (default ./dist)
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$PROJECT/dist}"
APP="$OUT_DIR/SUD Workbench.app"
RES="$APP/Contents/Resources"
VERSION="0.3.4"
BUNDLE_ID="io.sunflowerai.sudworkbench"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/appsrc"

# Render the titlebar's real SF-Symbol icons fresh into the SOURCE tree (git-ignored — see
# app/mac/sf_symbols.py's own docstring for why they're never committed) BEFORE the source copy
# below, so that copy picks the generated file up along with everything else in web/. Uses the
# repo's OWN .venv (PyObjC), not the per-user venv this bootstrap app builds for itself on first
# launch — this step runs at BUILD time, on the developer's machine.
echo "▶ rendering SF-Symbol titlebar icons…"
[ -x "$PROJECT/.venv/bin/python" ] || { echo "error: $PROJECT/.venv/bin/python not found — needed to render the titlebar's SF-Symbol icons (packaging/render_sf_symbols.py)" >&2; exit 1; }
"$PROJECT/.venv/bin/python" "$PROJECT/packaging/render_sf_symbols.py"

echo "▶ copying app source…"
# samples/ is deliberately NOT bundled — it is repo-only test data (see README). Nothing in app/ or
# web/ reads from it at runtime, so the shipped app carries no sample datasets.
# `vendor/` IS NO LONGER SHIPPED. It used to carry a self-contained grew backend (tools/bundle_grew.sh:
# the arm64 grewpy_backend plus its rewritten dylib closure, ~12 MB) that app/convert.py looked for at
# <appsrc>/vendor/grew/bin. grewpy_backend is CeCILL v2.1 (GPL-family copyleft) — bundling it into a
# shipped .app was republishing someone else's work without a grant to, the exact problem the old
# vendored grammars/ directory had and was removed for (see THIRD-PARTY-NOTICES.md).
# app/grew_backend.py now fetches it on demand instead — via opam, onto the END USER'S OWN machine —
# the same on-demand shape app/grammars.py already uses below for the conversion grammars. This does
# not relax the warning the previous comment here gave at length: without a grew backend, every Stanza
# model is still inert (Stanza emits UD, this app stores SUD, so `parse._parse_stanza_ud_to_sud` runs
# the conversion grammar on every parse) — the difference is that a reader now installs it themselves
# from Manage Models' "grew conversion backend" row (app/extras.py) rather than the app quietly
# carrying a copy on their behalf. A tree with no opam-installed backend still builds and ships; the
# app degrades exactly as it does for any other not-yet-installed on-demand tier.
# grammars/ is deliberately NOT in this list — it's no longer vendored (unclear upstream licence);
# app/grammars.py fetches it on demand at runtime instead, same on-demand shape as app/macron.py.
for d in app web; do
  [ -e "$PROJECT/$d" ] && cp -R "$PROJECT/$d" "$RES/appsrc/$d"
done
find "$RES/appsrc" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# The OTHER platform's chrome kit is not shipped. index.html picks exactly one kit at load from
# <html data-platform>, so win11-kit/ can never be reached in a macOS bundle. Dropped for size only
# (~140 KB) — its Fluent UI System Icons are MIT and would travel fine. The WINDOWS build excludes
# macos-kit/ for a stronger reason: 12 of mac-tokens.css's --sf-* masks are real SF Symbols rendered
# to base64 PNG, which Apple licenses for apps on Apple platforms, not for redistribution inside a
# Windows application. See packaging/windows/make_win_app.py.
rm -rf "$RES/appsrc/web/win11-kit"
[ ! -e "$RES/appsrc/web/win11-kit" ]   # fail the build if it survived

# Drop the browser design-mode fixture: the file itself, plus its <script> tag and the HTML comment
# above it, so the bundled index.html doesn't 404 on a script that is no longer there. Source tree
# untouched; only the built bundle loses them. (In the app the fixture is inert anyway — bootBridge()
# replaces DOC at launch — but the shipped bundle should carry no sample sentences at all.)
strip_dev_fixture() {
  rm -f "$1/web/js/dev-fixture.js"
  [ -f "$1/web/index.html" ] || return 0
  sed -i '' -e '/browser design mode only: seeds DOC/,+1d' -e '\|js/dev-fixture\.js|d' "$1/web/index.html"
  ! grep -q "dev-fixture" "$1/web/index.html"   # fail the build if either survived
}
strip_dev_fixture "$RES/appsrc"

# Ship the CORE Noto faces — Noto Sans regular + italic and Noto Sans Mono, the ones the interface
# itself renders in (Latin/Greek/Cyrillic), ~5 MB — PLUS five STACKING_SCRIPTS faces (Grantha/Javanese/
# Balinese/Kawi/Zanabazar Square, under 1 MB combined) that must never be left to the on-demand path's
# own system-font check: see web/styles/fonts.css's note on why. Every OTHER script's face is fetched on
# first need at runtime, onto machines that can't already draw the script: see web/js/lang/fontload.js
# and app/fonts.py. Stripping down to this set is what takes this bundle from 48 MB to roughly ~8 MB —
# the script fonts were over nine tenths of the download, for scripts most users never open.
# The SOURCE tree's web/fonts/ is left untouched; only the built bundle drops these files.
CORE_FONTS=(notosans.ttf notosans-italic.ttf notosansmono.ttf nithyaranjana.otf notosansgrantha.ttf notosansjavanese.ttf notosansbalinese.ttf notosanskawi.ttf notosanszanabazarsquare.ttf notoseriftibetan.ttf)   # nithyaranjana.otf: NOT a Noto face — bundled unconditionally because it isn't on Google Fonts (app/fonts.py's on-demand fetch has nothing to ask for). The six notosans<script>.ttf/notoseriftibetan.ttf files: bundled unconditionally so fontCovers()'s system-font tofu-probe can never shadow them with an ambiguous same-named local font (Tibetan's own case is macOS's Kailasa substituting silently, not a same-named rival — see web/styles/fonts.css's own note) and FONT_CORE_SCRIPTS in web/js/lang/fontload.js
FONTDIR="$RES/appsrc/web/fonts"
if [ -d "$FONTDIR" ]; then
  echo "▶ keeping only the core Noto faces (script faces download on demand)…"
  KEEPDIR="$(mktemp -d)"
  for f in "${CORE_FONTS[@]}"; do
    [ -f "$FONTDIR/$f" ] || { echo "!! core font missing from web/fonts: $f" >&2; exit 1; }
    mv "$FONTDIR/$f" "$KEEPDIR/$f"
  done
  rm -rf "$FONTDIR"/*
  mv "$KEEPDIR"/* "$FONTDIR"/ && rmdir "$KEEPDIR"
fi

cp "$PROJECT/requirements-core.txt" "$RES/requirements-core.txt"
cp "$PROJECT/packaging/bootstrap.sh"  "$RES/bootstrap.sh";  chmod +x "$RES/bootstrap.sh"
cp "$PROJECT/packaging/setup_venv.sh" "$RES/setup_venv.sh"; chmod +x "$RES/setup_venv.sh"
cp "$PROJECT/packaging/find_py.sh"    "$RES/find_py.sh";    chmod +x "$RES/find_py.sh"
cp "$PROJECT/packaging/AppIcon.icns" "$RES/AppIcon.icns"
if [ -f "$PROJECT/packaging/Assets.car" ]; then cp "$PROJECT/packaging/Assets.car" "$RES/Assets.car"; fi   # macOS 26 Light/Dark/Tinted icon

# ── native progress helper (Swift/AppKit) ──
# Compiled to a universal binary at Contents/Resources/progress so the fast first-launch path can
# show a friendly window instead of a Terminal. If swiftc is missing (or the build fails), we bundle
# nothing and the launcher degrades gracefully to the visible Terminal path.
echo "▶ compiling progress helper (Swift/AppKit)…"
if command -v swiftc >/dev/null 2>&1; then
  ok=1
  swiftc -O -target arm64-apple-macos11  "$PROJECT/packaging/Progress.swift" -o "$WORK/progress.arm64"  2>"$WORK/sc.arm64.log"  || ok=0
  swiftc -O -target x86_64-apple-macos11 "$PROJECT/packaging/Progress.swift" -o "$WORK/progress.x86_64" 2>"$WORK/sc.x86_64.log" || ok=0
  if [ "$ok" = 1 ] && lipo -create "$WORK/progress.arm64" "$WORK/progress.x86_64" -output "$RES/progress" 2>/dev/null; then
    chmod +x "$RES/progress"; echo "  ✓ universal Resources/progress (arm64 + x86_64)"
  elif swiftc -O "$PROJECT/packaging/Progress.swift" -o "$RES/progress" 2>"$WORK/sc.host.log"; then
    chmod +x "$RES/progress"; echo "  ✓ host-arch Resources/progress (universal build unavailable)"
  else
    echo "  ⚠ swiftc present but Progress.swift failed to build — GUI progress disabled; launcher uses the Terminal path."
    echo "    (last error follows)"; tail -n 20 "$WORK/sc.host.log" "$WORK/sc.arm64.log" 2>/dev/null | sed 's/^/    /' || true
  fi
else
  echo "  ⚠ swiftc not found — GUI progress disabled; launcher uses the Terminal path."
fi

echo "▶ Info.plist…"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SUD Workbench</string>
  <key>CFBundleDisplayName</key><string>SUD Workbench</string>
  <key>CFBundleExecutable</key><string>SUD Workbench</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>CFBundleDocumentTypes</key>
  <array><dict>
    <key>CFBundleTypeName</key><string>CoNLL-U treebank</string>
    <key>CFBundleTypeExtensions</key><array><string>conllu</string><string>conll</string></array>
    <key>CFBundleTypeRole</key><string>Editor</string>
    <key>LSHandlerRank</key><string>Owner</string>
  </dict></array>
</dict>
</plist>
PLIST

echo "▶ launcher…"
cat > "$APP/Contents/MacOS/SUD Workbench" <<'LAUNCHER'
#!/bin/bash
# Launch decision:
#   1. venv already set up (sentinel present) → run the app.
#   2. first launch, a suitable python3.12 exists → FAST PATH: build the venv silently behind a
#      native progress window (no sudo, core deps only); real pip output goes to setup.log.
#   3. first launch, no python3.12 (or the GUI helper is missing/failed) → SLOW PATH: run bootstrap.sh
#      in a Terminal (visible brew/pip output + any sudo prompt), which installs python then launches.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
APPSUP="$HOME/Library/Application Support/SUD Workbench"
VENV="$APPSUP/venv"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.opam/default/bin:$PATH"

run_app() {
  export PYTHONPATH="$RES/appsrc"; cd "$RES/appsrc"
  # ── de-hijack the process's own bundle identity ("Python" in the Dock/⌘-Tab/menu bar) ──────────
  # A Homebrew/python.org macOS FRAMEWORK build's bin/pythonX.Y does not run our code directly: it
  # unconditionally re-execs ITSELF into <Framework>/Versions/X.Y/Resources/Python.app/Contents/
  # MacOS/Python before a single line of app/__main__.py runs (confirmed live — even `python3 -c
  # pass` does this; there is no env var that suppresses it). That relaunch target is a REAL,
  # separate, already-installed .app bundle (org.python.python, CFBundleName "Python"), and macOS
  # gives our WHOLE running process that bundle's identity: NSRunningApplication.bundleIdentifier
  # reads "org.python.python" for the rest of the session, so the Dock, ⌘-Tab switcher, and Force
  # Quit all read "Python" — no matter what app/mac/shell.py's setProcessName_ call and menu-title
  # patch set, since those touch the process name string and OUR OWN NSMenu items, not the rival
  # bundle LaunchServices actually associated with this PID at relaunch time.
  #
  # The fix does not fight the relaunch — it defuses it. The relaunch TARGET binary, copied
  # elsewhere and run DIRECTLY, does not relaunch again (only the thin bin/pythonX.Y stub carries
  # the trigger; Resources/Python.app/Contents/MacOS/Python is the real interpreter and has no
  # further relaunch logic), and it still finds this venv correctly via ordinary pyvenv.cfg
  # discovery relative to ITS OWN path (confirmed: sys.prefix, pyobjc, spacy all resolve fine from
  # a copy sitting in $VENV/bin). Run that copy instead and the process stays genuinely UNBUNDLED —
  # exactly the case app/__main__.py's setProcessName_ and app/mac/shell.py's Dock-icon/menu-title
  # patches were always written to cover, before this relaunch quietly swapped it for a worse one.
  #
  # Built lazily HERE (not in setup_venv.sh) so an existing install self-heals on its very next
  # launch with no re-install needed. A non-framework python3.12 (no such Resources/Python.app)
  # leaves GUI_SRC empty and this falls straight back to today's plain exec — never a regression.
  local GUI_SRC GUI_BIN
  GUI_BIN="$VENV/bin/.python-gui"
  if [ ! -x "$GUI_BIN" ]; then
    GUI_SRC="$("$VENV/bin/python3.12" -c '
import os, sys
real = os.path.realpath(sys.executable)                 # …/Versions/X.Y/bin/pythonX.Y
d = os.path.dirname(real)
cand = os.path.realpath(os.path.join(d, "..", "Resources", "Python.app", "Contents", "MacOS", "Python"))
print(cand if os.path.isfile(cand) and cand != real else "")
' 2>/dev/null)"
    if [ -n "$GUI_SRC" ]; then
      cp "$GUI_SRC" "$GUI_BIN" 2>/dev/null && chmod +x "$GUI_BIN" 2>/dev/null
    fi
  fi
  if [ -x "$GUI_BIN" ]; then
    exec "$GUI_BIN" -m app "$@"
  fi
  exec "$VENV/bin/python" -m app "$@"
}

open_terminal_path() {
  osascript >/dev/null 2>&1 <<OSA
tell application "Terminal"
  activate
  do script "bash " & quoted form of "$RES/bootstrap.sh"
end tell
OSA
}

# 1) Ready venv → run. The sentinel (.sud-core-ready) means the core install actually finished, so a
#    half-built venv from an interrupted setup is never mistaken for a ready one.
if [ -x "$VENV/bin/python" ] && [ -f "$VENV/.sud-core-ready" ]; then
  run_app "$@"
fi

# 2) Fast path: a suitable python3.12 is already present and the GUI helper is available.
. "$RES/find_py.sh"
PY="$(find_py || true)"
if [ -n "$PY" ] && [ -x "$RES/progress" ] && [ -x "$RES/setup_venv.sh" ]; then
  mkdir -p "$APPSUP"
  # setup_venv emits MSG/PROGRESS/DONE on stdout for the window; its stderr (verbose pip) → setup.log.
  "$RES/setup_venv.sh" 2>"$APPSUP/setup.log" | "$RES/progress" "$RES/AppIcon.icns" || true
  if [ -x "$VENV/bin/python" ] && [ -f "$VENV/.sud-core-ready" ]; then
    run_app "$@"
  fi
  # Fell through → the quiet setup didn't finish; drop to the Terminal path so the failure is visible.
fi

# 3) Slow path (unchanged behaviour): Homebrew/python may need installing → visible Terminal.
open_terminal_path
LAUNCHER
chmod +x "$APP/Contents/MacOS/SUD Workbench"

touch "$APP"
echo "✓ Built (bootstrap): $APP"
du -sh "$APP" | sed 's/^/  size: /'
