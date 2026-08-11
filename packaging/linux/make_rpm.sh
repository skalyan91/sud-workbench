#!/bin/bash
# Build the sud-workbench RPM — the RPM-based-distro counterpart of make_bootstrap_app.sh (macOS)
# and packaging/windows/make_win_app.py (Windows). Same two-phase shape as those: first STAGE the
# source tree exactly the way the shipped bundle should look (dev-fixture stripped, the OTHER
# platforms' chrome kits dropped, fonts trimmed to the core set), then hand it to the platform's own
# packager — here, `rpmbuild` running INSIDE a Fedora container, since this machine (macOS) has
# neither rpmbuild nor dnf and the whole point of building inside a real target-distro container is
# that the result is exactly what `dnf install` will do on a real machine, not an approximation of it.
#
#   packaging/linux/make_rpm.sh [OUTPUT_DIR] [--image fedora:41]
#     OUTPUT_DIR   default: packaging/linux/build   (gitignored — see packaging/linux/.gitignore)
#     --image      the Fedora/Rocky/Alma image to build inside; default fedora:41 (see
#                  README-rpm.md's "Why Fedora" note for the choice)
#
# Requires Docker (or a Docker-compatible daemon) on the machine RUNNING this script — the container
# is used ONLY to get `rpmbuild` + a matching `dnf`/`rpm` toolchain; nothing about the resulting .rpm
# is container-specific (it's the exact same noarch package a native Fedora `rpmbuild` would produce).
set -euo pipefail

# BUILT ON macOS, WHICH LEAKS ITS OWN METADATA INTO A PLAIN tar. Every directory `cp -R`/`tar` touches
# here was populated by macOS's own filesystem (HFS+/APFS), which carries extended attributes and
# resource forks a POSIX tar can't store inline — BSD tar's answer is to write a SIBLING "AppleDouble"
# file per entry (`._name` next to `name`) holding them. Those sidecar files are real archive members
# like any other, so they extract inside the RPM's BUILDROOT same as everything else — and rpmbuild's
# `%files` list, quite correctly, never claims them, so its "Installed (but unpackaged) file(s) found"
# check fails the build on files nobody asked it to install. `COPYFILE_DISABLE=1` is macOS tar's own
# documented switch to stop writing them at all (rather than writing-then-filtering, which would still
# cost the archive time and space for entries this build never wants); harmless where it's a no-op — a
# future rebuild on an actual Linux machine has no such attributes to carry and ignores the variable.
export COPYFILE_DISABLE=1

PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$PROJECT/packaging/linux"
IMAGE="fedora:41"
OUT_DIR="$HERE/build"

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    *) OUT_DIR="$(cd "$(dirname "$1")" 2>/dev/null && pwd)/$(basename "$1")" || OUT_DIR="$1"; shift ;;
  esac
done

RPMBUILD="$OUT_DIR/rpmbuild"
STAGE="$OUT_DIR/stage"

# ── version cross-check ─────────────────────────────────────────────────────────────────────────
# app/__init__.py's __version__ is the ONE source of truth every platform's build script is supposed
# to track (see make_bootstrap_app.sh / make_win_app.py, which both hard-code VERSION = "0.1.0" and
# rely on a human keeping the three in step). This script goes one step further and actually CHECKS
# the spec's hard-coded %global app_version against app/__init__.py at build time, so a version bump
# in one place can't silently desync from the RPM's own Version: tag the way a purely-hard-coded
# literal could.
APP_VERSION="$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$PROJECT/app/__init__.py")"
SPEC_VERSION="$(sed -n 's/^%global app_version \(.*\)/\1/p' "$HERE/sud-workbench.spec")"
if [ -z "$APP_VERSION" ]; then
  echo "!! could not read __version__ from app/__init__.py" >&2; exit 1
fi
if [ "$APP_VERSION" != "$SPEC_VERSION" ]; then
  echo "!! version mismatch: app/__init__.py says $APP_VERSION, sud-workbench.spec says $SPEC_VERSION" >&2
  echo "   bump %global app_version in sud-workbench.spec to match, then re-run." >&2
  exit 1
fi
VERSION="$APP_VERSION"
echo "▶ building sud-workbench $VERSION for $IMAGE"

rm -rf "$OUT_DIR"
mkdir -p "$RPMBUILD"/{SOURCES,SPECS,BUILD,RPMS,SRPMS,BUILDROOT}
STAGE_ROOT="$STAGE/sud-workbench-$VERSION"
mkdir -p "$STAGE_ROOT"

# ── 1. stage the app source tree, same trims every platform's build applies ────────────────────
echo "▶ staging app/ web/ grammars/ …"
for d in app web grammars; do
  cp -R "$PROJECT/$d" "$STAGE_ROOT/$d"
done
find "$STAGE_ROOT" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Only the Linux chrome kit belongs in a Linux package — same "ship only your own kit" rule
# make_bootstrap_app.sh (drops win11-kit/) and make_win_app.py (drops macos-kit/, for the SF-Symbols
# licensing reason its own comment gives) already follow. index.html picks exactly one kit at load
# from <html data-platform>, so macos-kit/ and win11-kit/ can never be reached from a Linux build —
# dropping macos-kit/ here is the SAME licensing reason as the Windows build (12 of mac-tokens.css's
# --sf-* masks are real SF Symbols Apple licenses for Apple platforms only); dropping win11-kit/ is
# size only, exactly as on macOS.
rm -rf "$STAGE_ROOT/web/macos-kit" "$STAGE_ROOT/web/win11-kit"
[ ! -e "$STAGE_ROOT/web/macos-kit" ] && [ ! -e "$STAGE_ROOT/web/win11-kit" ]   # fail the build if either survived

# Drop the browser design-mode fixture — same sed-based strip as make_bootstrap_app.sh, verbatim, so
# the two builds can never disagree about what they removed.
rm -f "$STAGE_ROOT/web/js/dev-fixture.js"
sed -i.bak -e '/browser design mode only: seeds DOC/,+1d' -e '\|js/dev-fixture\.js|d' "$STAGE_ROOT/web/index.html"
rm -f "$STAGE_ROOT/web/index.html.bak"
if grep -q "dev-fixture" "$STAGE_ROOT/web/index.html"; then
  echo "!! dev-fixture survived the strip in web/index.html — refusing to build" >&2; exit 1
fi

# Ship the CORE Noto faces only — identical list to make_bootstrap_app.sh / make_win_app.py. Every
# other script's face is fetched on first need at runtime (web/js/lang/fontload.js + app/fonts.py).
CORE_FONTS=(notosans.ttf notosans-italic.ttf notosansmono.ttf nithyaranjana.otf)
FONTDIR="$STAGE_ROOT/web/fonts"
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

cp "$PROJECT/requirements-core.txt" "$STAGE_ROOT/requirements-core.txt"
cp "$PROJECT/LICENSE" "$STAGE_ROOT/LICENSE"
cp "$PROJECT/THIRD-PARTY-NOTICES.md" "$STAGE_ROOT/THIRD-PARTY-NOTICES.md"

# ── 2. source tarball ────────────────────────────────────────────────────────────────────────────
echo "▶ tarring Source0…"
tar -C "$STAGE" -czf "$RPMBUILD/SOURCES/sud-workbench-$VERSION.tar.gz" "sud-workbench-$VERSION"

# ── 3. the small scripted sources ───────────────────────────────────────────────────────────────
cp "$HERE/find_py-rpm.sh"       "$RPMBUILD/SOURCES/find_py-rpm.sh"
cp "$HERE/setup_venv-rpm.sh"    "$RPMBUILD/SOURCES/setup_venv-rpm.sh"
cp "$HERE/sud-workbench.sh"    "$RPMBUILD/SOURCES/sud-workbench.sh"
cp "$HERE/sud-workbench.desktop" "$RPMBUILD/SOURCES/sud-workbench.desktop"

# ── 4. hicolor icon set, derived from the flat masters (never hand-drawn) ──────────────────────
# Sizes are the standard hicolor theme convention (freedesktop.org Icon Theme Specification's own
# example set) — 16 through 512, plus a scalable SVG for anything that asks above 512 or renders
# vectorially. Derived from packaging/icon-flat/appicon-flat-1024.png (the LIGHT flat master — same
# one make_win_app.py derives appicon-flat.ico from; GTK/hicolor has no automatic light/dark app-icon
# swap the way macOS does, so there is exactly one icon here, not two) via ImageMagick, exactly as
# packaging/build_icons.sh already uses `magick`/`rsvg-convert` for the other platforms' icons — no
# icon is hand-drawn for this build.
echo "▶ deriving hicolor icons from packaging/icon-flat/ …"
command -v magick >/dev/null 2>&1 || { echo "!! magick (ImageMagick) not found — see packaging/build_icons.sh" >&2; exit 1; }
ICON_SRC="$PROJECT/packaging/icon-flat/appicon-flat-1024.png"
ICON_SVG="$PROJECT/packaging/icon-flat/appicon-flat.svg"
[ -f "$ICON_SRC" ] || { echo "!! missing $ICON_SRC" >&2; exit 1; }
ICONDIR="$STAGE/icons"
rm -rf "$ICONDIR"
for size in 16 22 24 32 48 64 128 256 512; do
  d="$ICONDIR/${size}x${size}/apps"
  mkdir -p "$d"
  magick "$ICON_SRC" -resize "${size}x${size}" "$d/sud-workbench.png"
done
if [ -f "$ICON_SVG" ]; then
  mkdir -p "$ICONDIR/scalable/apps"
  cp "$ICON_SVG" "$ICONDIR/scalable/apps/sud-workbench.svg"
fi
tar -C "$ICONDIR" -czf "$RPMBUILD/SOURCES/icons.tar.gz" .

# ── 5. the spec ──────────────────────────────────────────────────────────────────────────────────
cp "$HERE/sud-workbench.spec" "$RPMBUILD/SPECS/sud-workbench.spec"

echo "▶ staged $(du -sh "$RPMBUILD/SOURCES" | cut -f1) of sources → $RPMBUILD"

# ── 6. rpmbuild, INSIDE a real Fedora container ─────────────────────────────────────────────────
# `dnf install rpm-build` first: the base fedora image doesn't carry the RPM build toolchain (this
# package's own runtime deps — gtk3, webkit2gtk4.1, … — are NOT installed here; they are declared in
# the spec's Requires: and are exactly what the SEPARATE install-and-boot verification (see
# README-rpm.md) checks get pulled by `dnf install ./*.rpm` on a fresh container).
echo "▶ rpmbuild inside $IMAGE …"
docker run --rm \
  -v "$RPMBUILD:/root/rpmbuild" \
  "$IMAGE" \
  bash -c '
    set -e
    dnf -y install rpm-build >/dev/null
    rpmbuild -bb /root/rpmbuild/SPECS/sud-workbench.spec
  '

RPM_OUT=$(find "$RPMBUILD/RPMS" -name '*.rpm' | head -1)
if [ -z "$RPM_OUT" ]; then
  echo "!! rpmbuild did not produce a .rpm — see the docker run output above" >&2
  exit 1
fi
echo "✓ built: $RPM_OUT"
echo "  $(du -h "$RPM_OUT" | cut -f1)"
