#!/bin/bash
# Build a PORTABLE, self-contained "SUD Workbench.app" — no external .venv needed.
#
# It bundles a relocatable standalone CPython 3.12 + only the CORE (torch-free) deps
# (requirements-core.txt). The heavy optional stacks — Stanza/torch, Japanese, Arabic —
# are NOT bundled: app/extras.py installs them on demand into the user extras dir
# (~/Library/Application Support/SUD Workbench/site-packages) when a feature is first used.
#
# Result: a ~300–450 MB bundle that runs viewing/editing + SUD spaCy parsing out of the box.
#
# Usage:  packaging/make_portable.sh [OUTPUT_DIR]     (default ./dist)
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$PROJECT/dist}"
APP="$OUT_DIR/SUD Workbench.app"
RES="$APP/Contents/Resources"
WORK="$(mktemp -d)"
VERSION="0.1.0"
BUNDLE_ID="io.sunflowerai.sudworkbench"
PYVER="3.12"
trap 'rm -rf "$WORK"' EXIT

echo "▶ locating a relocatable CPython $PYVER (python-build-standalone)…"
# newest release asset for arm64 macOS, install_only variant
ASSET_URL="$(curl -fsSL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest \
  | python3 -c "import json,sys,re
data=json.load(sys.stdin)
cands=[a['browser_download_url'] for a in data['assets']
       if re.search(r'cpython-3\.12\.\d+\+.*aarch64-apple-darwin-install_only\.tar\.gz\$', a['name'])]
print(cands[0] if cands else '')")"
[ -n "$ASSET_URL" ] || { echo 'error: could not find a 3.12 aarch64-apple-darwin install_only asset' >&2; exit 1; }
echo "  $ASSET_URL"
curl -fsSL "$ASSET_URL" -o "$WORK/python.tar.gz"
mkdir -p "$WORK/py" && tar -xzf "$WORK/python.tar.gz" -C "$WORK/py"   # extracts a top-level ./python/
PYBIN="$WORK/py/python/bin/python$PYVER"
[ -x "$PYBIN" ] || PYBIN="$WORK/py/python/bin/python3"
"$PYBIN" --version

echo "▶ assembling bundle skeleton…"
rm -rf "$APP"; mkdir -p "$RES/appsrc" "$RES/applib"
cp -R "$WORK/py/python" "$RES/python"

echo "▶ installing CORE deps into the bundle (torch-free)…"
"$RES/python/bin/python$PYVER" -m pip install --no-input --upgrade pip >/dev/null
"$RES/python/bin/python$PYVER" -m pip install --no-input --target "$RES/applib" -r "$PROJECT/requirements-core.txt"

echo "▶ copying app source…"
# samples/ is deliberately NOT bundled — it is repo-only test data (see README). Nothing in app/ or
# web/ reads from it at runtime, so the shipped app carries no sample datasets.
# `vendor/` rides along for the reason make_bootstrap_app.sh states at length: it carries the
# self-contained grew backend, and without one every Stanza model is inert (Stanza emits UD, this app
# stores SUD, so the conversion grammar runs on every Stanza parse). It matters MORE here than in the
# bootstrap bundle — this build exists to need nothing from the user's machine, and an opam install is
# the largest thing it was still quietly assuming.
for d in app web grammars vendor; do
  [ -e "$PROJECT/$d" ] && cp -R "$PROJECT/$d" "$RES/appsrc/$d"
done
# don't ship the caches
find "$RES/appsrc" "$RES/applib" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

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

# Ship the CORE Noto faces only — Noto Sans regular + italic and Noto Sans Mono, the ones the
# interface itself renders in (Latin/Greek/Cyrillic), ~5 MB. Every other script's face is fetched on
# first need at runtime, onto machines that can't already draw the script: see web/js/lang/fontload.js
# and app/fonts.py. That is what takes this bundle from 48 MB to ~7.5 MB (23.4 MB → 4.1 MB zipped) —
# the script fonts were over nine tenths of the download, for scripts most users never open.
# The SOURCE tree's web/fonts/ is left untouched; only the built bundle drops these files.
CORE_FONTS=(notosans.ttf notosans-italic.ttf notosansmono.ttf nithyaranjana.otf)   # nithyaranjana.otf: NOT a Noto face — bundled unconditionally because it isn't on Google Fonts (app/fonts.py's on-demand fetch has nothing to ask for), see web/styles/fonts.css
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

echo "▶ trimming cruft (tests, dist-info stubs, headers)…"
find "$RES/applib" -type d \( -name tests -o -name test -o -name 'PyObjCTest' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$RES/applib" -name '*.pyi' -delete 2>/dev/null || true
rm -rf "$RES/python/lib/python$PYVER/test" "$RES/python/lib/python$PYVER/idlelib" \
       "$RES/python/lib/python$PYVER/tkinter" 2>/dev/null || true

echo "▶ thinning universal2 → arm64…"
# many wheels ship fat (x86_64+arm64) binaries; keep only arm64 on an Apple-Silicon build.
find "$RES/applib" "$RES/python" \( -name '*.so' -o -name '*.dylib' \) -print0 2>/dev/null | while IFS= read -r -d '' f; do
  if lipo -info "$f" 2>/dev/null | grep -q 'x86_64'; then lipo -thin arm64 "$f" -output "$f" 2>/dev/null || true; fi
done

echo "▶ icon + Info.plist + launcher…"
cp "$PROJECT/packaging/AppIcon.icns" "$RES/AppIcon.icns"
if [ -f "$PROJECT/packaging/Assets.car" ]; then cp "$PROJECT/packaging/Assets.car" "$RES/Assets.car"; fi   # macOS 26 Light/Dark/Tinted icon
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

mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/MacOS/SUD Workbench" <<'LAUNCHER'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export PYTHONPATH="$RES/appsrc:$RES/applib"
# Finder gives GUI apps a minimal PATH; add the usual spots so optional shell-outs resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.opam/default/bin:$PATH"
cd "$RES/appsrc"
exec "$RES/python/bin/python3.12" -m app "$@"
LAUNCHER
chmod +x "$APP/Contents/MacOS/SUD Workbench"

touch "$APP"
echo "✓ Built: $APP"
du -sh "$APP" | sed 's/^/  size: /'
