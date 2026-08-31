#!/bin/bash
# Build "SUD Workbench.app" — a thin macOS launcher bundle.
#
# The app's dependencies (pywebview/pyobjc + torch/spaCy/stanza/grewpy, ~1.8 GB) live in the
# project virtualenv (.venv); a fully self-contained py2app bundle of that stack would be huge
# and fragile. So the bundle is a small launcher that runs `<project>/.venv/bin/python -m app`,
# with a proper Info.plist + icon and runtime Dock-icon / process-name setting (see app/__main__.py)
# so it presents as a first-class app. The bundle records the project path at build time.
#
# Usage:  packaging/make_app.sh [OUTPUT_DIR]     (default OUTPUT_DIR = ./dist)
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$PROJECT/dist}"
APP="$OUT_DIR/SUD Workbench.app"
VERSION="0.3.18"
BUNDLE_ID="io.sunflowerai.sudworkbench"

if [ ! -x "$PROJECT/.venv/bin/python" ]; then
  echo "error: $PROJECT/.venv/bin/python not found — create the venv first." >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ── icon ──
cp "$PROJECT/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
if [ -f "$PROJECT/packaging/Assets.car" ]; then cp "$PROJECT/packaging/Assets.car" "$APP/Contents/Resources/Assets.car"; fi   # macOS 26 Light/Dark/Tinted icon

# ── Info.plist ──
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
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>CoNLL-U treebank</string>
      <key>CFBundleTypeExtensions</key><array><string>conllu</string><string>conll</string></array>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Owner</string>
    </dict>
  </array>
</dict>
</plist>
PLIST

# ── launcher ──
cat > "$APP/Contents/MacOS/SUD Workbench" <<LAUNCHER
#!/bin/bash
# Run SUD Workbench from its project virtualenv.
PROJECT="$PROJECT"
# Finder gives GUI apps a minimal PATH; add the usual spots so optional shell-outs
# (Homebrew tools, opam/grewpy backend) resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:\$HOME/.opam/default/bin:\$PATH"
cd "\$PROJECT" || { osascript -e 'display alert "SUD Workbench" message "Project folder not found: $PROJECT"'; exit 1; }
if [ ! -x "\$PROJECT/.venv/bin/python" ]; then
  osascript -e 'display alert "SUD Workbench" message "The Python environment (.venv) is missing. Recreate it in the project folder."'
  exit 1
fi
exec "\$PROJECT/.venv/bin/python" -m app "\$@"
LAUNCHER
chmod +x "$APP/Contents/MacOS/SUD Workbench"

# refresh Finder/LaunchServices so the icon shows immediately
touch "$APP"
echo "Built: $APP"
