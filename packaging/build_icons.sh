#!/usr/bin/env bash
# Regenerate the app-icon assets from the flat master PNG.
#
# Source of truth is packaging/AppIcon.icon (open in Icon Composer). To update
# the icon: edit that document, then File > Export a 1024x1024 PNG over
# packaging/icon-flat/appicon-1024.png, and run this script.
#
# Icon Composer's flat export is FULL-BLEED (the rounded body fills the whole
# 1024 canvas). Native macOS app icons instead sit on an 824-in-1024 grid
# (100 px margin, centred), so a full-bleed icon looks oversized in the Dock.
# This script applies that padding (no shadow — Icon Composer owns the shadow via
# the .icon's layer settings), then builds:
#   - packaging/AppIcon.icns             (copied into the .app bundle by make_*.sh)
#   - app/data/appicon.png               (the Dock / window icon pywebview loads)
#   - packaging/icon-flat/appicon-flat*  (a flat, non-glass version for other
#                                         platforms, regenerated in lock-step via
#                                         build_flat_icon.py)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$HERE/.." && pwd)"
SRC="$HERE/icon-flat/appicon-1024.png"
[ -f "$SRC" ] || { echo "missing master PNG: $SRC" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick (magick) is required" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# 0) Native macOS grid: body 824 centred in 1024, transparent margin, no shadow
magick "$SRC" -resize 824x824 -background none -gravity center -extent 1024x1024 "$TMP/appicon.png"
PADDED="$TMP/appicon.png"
echo "padded body: $(magick "$PADDED" -alpha extract -threshold 50% -format '%@' info:) (native = 824x824+100+100)"

# 1) macOS .icns for the bundle (10-size iconset -> iconutil)
ISET="$TMP/AppIcon.iconset"; mkdir -p "$ISET"
for p in 16:icon_16x16.png 32:icon_16x16@2x.png 32:icon_32x32.png 64:icon_32x32@2x.png \
         128:icon_128x128.png 256:icon_128x128@2x.png 256:icon_256x256.png \
         512:icon_256x256@2x.png 512:icon_512x512.png 1024:icon_512x512@2x.png; do
  sips -z "${p%%:*}" "${p%%:*}" "$PADDED" --out "$ISET/${p##*:}" >/dev/null
done
iconutil -c icns "$ISET" -o "$HERE/AppIcon.icns"
echo "wrote $HERE/AppIcon.icns"

# 2) Dock / window icon
cp "$PADDED" "$PROJECT/app/data/appicon.png"
echo "wrote $PROJECT/app/data/appicon.png"

# 3) Flat (non-glass) icon for other platforms — regenerated from THIS export so
#    it stays locked to the glass icon (scale, position, background all derived).
python3 "$HERE/build_flat_icon.py"

# 4) Appearance-aware asset catalog (macOS 26 Tahoe): compile the .icon with actool into
#    Assets.car, which carries the Light/Dark/Tinted appearances and lets the OS switch the
#    icon automatically. The .icns above stays the pre-Tahoe fallback. actool also emits its
#    own (lower-res) .icns, which we ignore in favour of ours. Needs Xcode 26+.
if command -v xcrun >/dev/null 2>&1; then
  ACT="$TMP/actool"; mkdir -p "$ACT"
  if xcrun actool "$HERE/AppIcon.icon" --app-icon AppIcon --compile "$ACT" \
        --output-partial-info-plist "$ACT/partial.plist" \
        --minimum-deployment-target 11.0 --platform macosx --target-device mac >/dev/null 2>&1 \
     && [ -f "$ACT/Assets.car" ]; then
    cp "$ACT/Assets.car" "$HERE/Assets.car"
    echo "wrote $HERE/Assets.car (Light + Dark + Tinted)"
  else
    echo "⚠ actool did not produce Assets.car — light/dark switching unavailable (needs Xcode 26+)" >&2
  fi
fi

# 5) Dark appearance: padded Dock/window PNG + dark flat, from the dark glass export. The runtime
#    Dock icon picks appicon.png vs appicon-dark.png by system appearance (see app/__main__.py).
DARKSRC="$HERE/icon-flat/appicon-dark-1024.png"
if [ -f "$DARKSRC" ]; then
  magick "$DARKSRC" -resize 824x824 -background none -gravity center -extent 1024x1024 "$PROJECT/app/data/appicon-dark.png"
  echo "wrote $PROJECT/app/data/appicon-dark.png"
  python3 "$HERE/build_flat_icon.py" dark
else
  echo "⚠ no dark glass export ($DARKSRC) — dark Dock PNG / flat skipped" >&2
fi

# 6) Small variants for the About window. Its HTML is a STRING handed to a child webview with no base
#    URL and no file server, so an <img src> can only be a data URI — and the full 1024 PNGs are ~2 MB
#    each, which is absurd to base64 into a 380x320 dialog. 256 px covers the 128 pt box at 2x.
for pair in "$PROJECT/app/data/appicon.png:appicon-256.png" \
            "$PROJECT/app/data/appicon-dark.png:appicon-dark-256.png"; do
  s="${pair%%:*}"; o="$PROJECT/app/data/${pair##*:}"
  [ -f "$s" ] || continue
  sips -z 256 256 "$s" --out "$o" >/dev/null && echo "wrote $o"
done

# 7) Windows .ico, packed from the LIGHT flat master built in step 3 — so it tracks the same Icon
#    Composer export as everything above and can't drift. Light only: a Win32 .ico has no
#    appearance variants, the shell reads one icon. Consumed by packaging/windows/make_win_app.py.
python3 "$HERE/build_flat_icon.py" ico
