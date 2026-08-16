#!/bin/bash
# Build the Debian package "sud-workbench_<ver>_all.deb" — the Linux counterpart of
# make_bootstrap_app.sh (macOS) and packaging/windows/make_win_app.py. SAME architecture, for the
# SAME reason stated in both of those: ship the app SOURCE (tiny) plus a first-launch bootstrap that
# builds a PER-USER venv from the user's own Python 3.12 and installs requirements-core.txt. The
# heavy Stanza/Japanese/Arabic tiers still download on demand at runtime via app/extras.py.
#
# WHY THE VENV-BOOTSTRAP MODEL, AGAIN, HERE SPECIFICALLY: a .deb could instead vendor every pip
# dependency as pre-built wheels and let dpkg install them into system site-packages — but "you
# cannot know the target's exact Python/glibc ahead of time" is, if anything, WORSE on Linux than on
# macOS/Windows: this one package would have to satisfy Debian bookworm (Python 3.11), Ubuntu 24.04
# (3.12), Ubuntu 22.04 (3.10), and whatever a rolling/derivative distro ships, each with its own
# glibc ABI — a manylinux wheel matrix no single .deb can carry. A per-user venv, built from
# whatever python3.12 apt installs at DEB-INSTALL time (not build time), sidesteps all of it: the
# same requirements-core.txt every platform already shares, installed fresh against the actual
# target machine, is dpkg's REAL job here reduced to "guarantee a python3.12 and python3-venv exist"
# — which is exactly what DEBIAN/control's Depends: line below does.
#
# TARGET DISTRO: Ubuntu 24.04 LTS ("noble"), verified against a real `apt-get update` inside a
# `docker run ubuntu:24.04` container (not guessed — see packaging/linux/README.md for the actual
# apt-cache output this was checked against). Chosen over Debian 12 "bookworm" for one concrete,
# checkable reason: bookworm's own archive ships Python 3.11 as the default python3 and has no
# python3.12 package at all in main (backports/deadsnakes would be needed), which would make this
# package's single most important Depends — a real python3.12 — NOT satisfiable from a stock
# bookworm install. Ubuntu 24.04 ships python3.12 as ITS default python3, so `Depends: python3
# (>= 3.12)` resolves from the main archive with no extra repository. Nothing here is
# Ubuntu-SPECIFIC beyond that one fact; the resulting .deb is plain Debian policy and installs on
# Debian trixie (13, Python 3.13/3.12) or any other apt-based distro whose default python3 clears
# the same bar.
#
# Usage:  packaging/linux/make_deb.sh [OUTPUT_DIR]   (default ./dist)
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$PROJECT/dist}"
VERSION="0.3.7"                       # kept in step with make_bootstrap_app.sh / make_win_app.py's own VERSION
PKG="sud-workbench"
ARCH="all"                            # no compiled binaries ship on Linux — see "vendor/ is NOT shipped" below
PKGDIR_NAME="${PKG}_${VERSION}_${ARCH}"
LINUX_OUT="$OUT_DIR/linux"
PKGROOT="$LINUX_OUT/$PKGDIR_NAME"
DEBFILE="$LINUX_OUT/${PKGDIR_NAME}.deb"

# The maintainer field is a placeholder — there is no dedicated packaging inbox for this project,
# and no email address is put here on request. A plain name is valid Debian policy (the angle-
# bracket <email> is conventional, not mandatory — dpkg-deb doesn't reject its absence).
MAINTAINER="Siva Kalyan"

# ── system runtime deps, verified against real Ubuntu 24.04 (noble) package metadata — NOT guessed ──
# See packaging/linux/README.md for the actual apt-cache/packages.ubuntu.com transcript this was
# checked against, and app/linux/shell.py's own header for what pywebview's GTK backend imports.
#   python3 (>= 3.12), python3-venv  — the one hard guarantee the whole venv-bootstrap model rests
#     on (see the file header above): a real python3.12 with a working `-m venv`, present BEFORE
#     this package's own postinst/launcher ever runs.
#   python3-gi, python3-gi-cairo, python3-cairo, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-soup-3.0,
#     libgtk-3-0t64 — pywebview's GTK backend (webview/platforms/gtk.py) does
#     `gi.require_version('Gtk','3.0')` / `gi.require_version('WebKit2','4.1')` (falls back to 4.0) /
#     `gi.require_version('Soup','3.0')` (falls back to 2.4) and imports `Gdk`, `Gio`, `GLib`, `Gtk`,
#     `WebKit2` from gi.repository — i.e. it needs GTK3 itself, the Python GObject-Introspection
#     binding (python3-gi), and the GIR typelibs for GTK3, WebKit2GTK 4.1 AND the libsoup3 binding
#     the 4.1 WebKit API pairs with, all at RUNTIME. NOT pip-installed — see setup_venv.sh's own
#     header on why PyGObject/pycairo ride the system copy via --system-site-packages rather than
#     being pip-installed into the venv. `python3-cairo` is `pycairo` itself (requirements-core.txt
#     lists both `PyGObject; sys_platform=="linux"` and `pycairo; sys_platform=="linux"` — pywebview's
#     own `gtk` extra pins both together); `python3-gi-cairo` is the small GObject-Introspection↔Cairo
#     override module GTK's own drawing calls go through. MEASURED, not assumed: with only
#     `python3-gi` installed, `pip install pycairo` inside the `--system-site-packages` venv tries to
#     BUILD pycairo from source via meson — and fails outright, because no C compiler is in this
#     Depends line (`Unknown compiler(s): [['cc'], ['gcc'], ...]`) — exactly the "portability
#     nightmare" of compiling a GTK-adjacent binding this whole model exists to avoid. Adding
#     `python3-cairo` fixes it the same way `python3-gi` already fixes PyGObject: pip's own
#     "Requirement already satisfied" check finds the apt-installed distribution in system
#     dist-packages and never touches its build backend at all.
#     ⚠ `libgtk-3-0t64`, NOT `libgtk-3-0` — checked directly rather than assumed from memory:
#     packages.ubuntu.com has NO `libgtk-3-0` entry for noble at all ("Package not available in this
#     suite"), because Ubuntu 24.04 did an archive-wide rebuild for the 64-bit time_t transition and
#     renamed the runtime library package with a `t64` suffix; `gir1.2-gtk-3.0` itself now lists
#     `libgtk-3-0t64 (>= 3.24.30)` as its own Depends, not the old name. Listed explicitly anyway
#     (rather than relying on that transitive pull) per ordinary Debian practice: state what you
#     directly need, don't lean on another package's dependency graph to keep supplying it.
#   git — requirements-core.txt installs `wiktra` from a `git+https://...` URL; pip shells out to a
#     real `git` binary to resolve that, exactly the reason packaging/windows/find_git.ps1 exists on
#     Windows. Unlike Windows (no reliable package manager to lean on), apt makes this a one-line
#     Depends instead of a whole detection-and-install ladder.
DEPENDS="python3 (>= 3.12), python3-venv, python3-gi, python3-gi-cairo, python3-cairo, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-soup-3.0, libgtk-3-0t64, git"
# Desktop-integration niceties: the package works with none of these (postinst/postrm guard every
# call with `command -v`), but a normal desktop install should have them so the .desktop entry,
# .conllu file association and hicolor icon actually show up without a manual `update-*-database`.
# x-terminal-emulator is a real Debian virtual package (xterm/gnome-terminal/konsole/… all Provide
# it) — see sud-workbench.launcher's own note on why a terminal matters for the first-run install.
RECOMMENDS="desktop-file-utils, shared-mime-info, hicolor-icon-theme, x-terminal-emulator"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "▶ SUD Workbench $VERSION — Debian package build"
echo "  project : $PROJECT"
echo "  output  : $LINUX_OUT"

# ── 0. validate sources before touching anything ────────────────────────────────────────────────
echo "▶ checking sources…"
REQUIRED=(
  "$PROJECT/app" "$PROJECT/web"
  "$PROJECT/requirements-core.txt" "$PROJECT/LICENSE" "$PROJECT/THIRD-PARTY-NOTICES.md"
  "$PROJECT/packaging/icon-flat/appicon-flat-1024.png" "$PROJECT/packaging/icon-flat/appicon-flat.svg"
  "$HERE/find_py.sh" "$HERE/setup_venv.sh" "$HERE/sud-workbench.launcher"
  "$HERE/sud-workbench.desktop" "$HERE/sud-workbench-mime.xml"
  "$HERE/postinst" "$HERE/postrm" "$HERE/copyright"
)
missing=0
for p in "${REQUIRED[@]}"; do
  [ -e "$p" ] || { echo "!! missing: $p" >&2; missing=1; }
done
[ "$missing" = 0 ] || exit 1
command -v magick >/dev/null 2>&1 || { echo "!! ImageMagick (magick) is required to build the hicolor icon set" >&2; exit 1; }
echo "  ✓ all sources present"

# ── 1. package tree skeleton ─────────────────────────────────────────────────────────────────────
echo "▶ package tree…"
rm -rf "$PKGROOT"
mkdir -p "$PKGROOT/DEBIAN" \
         "$PKGROOT/opt/sud-workbench/setup" \
         "$PKGROOT/usr/bin" \
         "$PKGROOT/usr/share/applications" \
         "$PKGROOT/usr/share/mime/packages" \
         "$PKGROOT/usr/share/doc/sud-workbench"

# ── 2. app source ─────────────────────────────────────────────────────────────────────────────────
# samples/ and vendor/ are deliberately NOT shipped.
#   samples/  — repo-only test data on every platform; nothing under app/ or web/ reads it at
#               runtime (see make_bootstrap_app.sh's identical note).
#   vendor/   — no longer exists on ANY platform's build, including macOS's. It used to hold a
#               self-contained grewpy_backend (arm64 Mach-O, tools/bundle_grew.sh) that only the
#               macOS build shipped, but grewpy_backend is CeCILL v2.1 (GPL-family copyleft), so
#               bundling it into any shipped build was republishing someone else's work without a
#               grant to. app/grew_backend.py now fetches it on demand instead — via opam, onto the
#               end user's own machine — same on-demand shape app/grammars.py uses for the conversion
#               grammars. A Linux user installs opam themselves (their own distro's package manager,
#               same self-install story README.md already documents) and then installs the "grew
#               conversion backend" row from Manage Models; without it, UD import/export and format
#               conversion degrade cleanly to a toast, and every Stanza model is inert too, since
#               Stanza emits UD and this app stores SUD — see CLAUDE.md's own note on this.
echo "▶ copying app source…"
APPSRC="$PKGROOT/opt/sud-workbench/appsrc"
mkdir -p "$APPSRC"
# grammars/ is NOT one of these two — it isn't committed to the repo at all any more (unclear
# upstream licence; see app/grammars.py's own header), so there's nothing here to copy. It's
# fetched on demand from inside the running app instead, same shape as app/macron.py's tier.
for d in app web; do
  cp -R "$PROJECT/$d" "$APPSRC/$d"
done
find "$APPSRC" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# The OTHER two platforms' chrome kits are not shipped. index.html picks exactly one kit at load
# from <html data-platform>, and "linux" always resolves to adwaita-kit (see web/index.html's own
# platform-detection script) — win11-kit/ and macos-kit/ can never be reached from this bundle.
# macos-kit/ is excluded for the SAME licensing reason the Windows build excludes it: 12 of
# mac-tokens.css's --sf-* masks are real SF Symbols rendered to base64 PNG, licensed by Apple for
# apps on Apple platforms, not for redistribution inside a Linux package. win11-kit/ is dropped for
# size only (its Fluent UI System Icons are MIT and would travel fine).
rm -rf "$APPSRC/web/macos-kit" "$APPSRC/web/win11-kit"
[ ! -e "$APPSRC/web/macos-kit" ] && [ ! -e "$APPSRC/web/win11-kit" ]   # fail the build if either survived

# Drop the browser design-mode fixture — identical sed to make_bootstrap_app.sh's strip_dev_fixture
# (same build host, same BSD sed; this script runs on the maintainer's Mac, same as the other two
# platform builds — the ACTUAL .deb archive gets produced by dpkg-deb inside Docker, see step 6).
rm -f "$APPSRC/web/js/dev-fixture.js"
sed -i '' -e '/browser design mode only: seeds DOC/,+1d' -e '\|js/dev-fixture\.js|d' "$APPSRC/web/index.html"
! grep -q "dev-fixture" "$APPSRC/web/index.html"   # fail the build if either survived

# Ship the CORE Noto faces only (same list, same reasoning, as make_bootstrap_app.sh/make_win_app.py
# — every other script's face is fetched on first need at runtime; see web/js/lang/fontload.js and
# app/fonts.py). Kept in lock-step with those two scripts' own CORE_FONTS rather than re-derived, so
# a font added to one and not the others is a diff a reviewer can actually see.
CORE_FONTS=(notosans.ttf notosans-italic.ttf notosansmono.ttf nithyaranjana.otf notosansgrantha.ttf notosansjavanese.ttf notosansbalinese.ttf notosanskawi.ttf notosanszanabazarsquare.ttf notoseriftibetan.ttf)
FONTDIR="$APPSRC/web/fonts"
if [ -d "$FONTDIR" ]; then
  echo "  keeping only the core Noto faces (script faces download on demand)…"
  KEEPDIR="$(mktemp -d)"
  for f in "${CORE_FONTS[@]}"; do
    [ -f "$FONTDIR/$f" ] || { echo "!! core font missing from web/fonts: $f" >&2; exit 1; }
    mv "$FONTDIR/$f" "$KEEPDIR/$f"
  done
  rm -rf "$FONTDIR"/*
  mv "$KEEPDIR"/* "$FONTDIR"/ && rmdir "$KEEPDIR"
fi

# ── 3. first-launch setup half ───────────────────────────────────────────────────────────────────
cp "$PROJECT/requirements-core.txt" "$PKGROOT/opt/sud-workbench/setup/requirements-core.txt"
cp "$HERE/find_py.sh"    "$PKGROOT/opt/sud-workbench/setup/find_py.sh"
cp "$HERE/setup_venv.sh" "$PKGROOT/opt/sud-workbench/setup/setup_venv.sh"
chmod 755 "$PKGROOT/opt/sud-workbench/setup/find_py.sh" "$PKGROOT/opt/sud-workbench/setup/setup_venv.sh"

echo "$VERSION" > "$PKGROOT/opt/sud-workbench/VERSION"
cp "$PROJECT/LICENSE" "$PKGROOT/opt/sud-workbench/LICENSE"
cp "$PROJECT/THIRD-PARTY-NOTICES.md" "$PKGROOT/opt/sud-workbench/THIRD-PARTY-NOTICES.md"

# ── 4. launcher, desktop entry, mime registration ───────────────────────────────────────────────
cp "$HERE/sud-workbench.launcher" "$PKGROOT/usr/bin/sud-workbench"
chmod 755 "$PKGROOT/usr/bin/sud-workbench"
cp "$HERE/sud-workbench.desktop" "$PKGROOT/usr/share/applications/sud-workbench.desktop"
cp "$HERE/sud-workbench-mime.xml" "$PKGROOT/usr/share/mime/packages/sud-workbench.xml"

# ── 5. hicolor icon theme set, derived from the flat master — never hand-drawn ─────────────────────
# packaging/icon-flat/appicon-flat-1024.png is the same non-glass master build_flat_icon.py produces
# and packaging/windows/make_win_app.py already ships as the Windows .ico's source. hicolor's own
# convention (freedesktop icon theme spec) is one PNG per size under
# icons/hicolor/<N>x<N>/apps/<name>.png, plus a scalable/ SVG for anything that can use it (GTK/GNOME
# prefer the SVG when present and only fall back to the raster sizes).
echo "▶ hicolor icon set…"
ICON_SIZES=(16 22 24 32 48 64 128 256 512)
for sz in "${ICON_SIZES[@]}"; do
  d="$PKGROOT/usr/share/icons/hicolor/${sz}x${sz}/apps"
  mkdir -p "$d"
  magick "$PROJECT/packaging/icon-flat/appicon-flat-1024.png" -resize "${sz}x${sz}" "$d/sud-workbench.png"
done
mkdir -p "$PKGROOT/usr/share/icons/hicolor/scalable/apps"
cp "$PROJECT/packaging/icon-flat/appicon-flat.svg" "$PKGROOT/usr/share/icons/hicolor/scalable/apps/sud-workbench.svg"
echo "  ✓ ${#ICON_SIZES[@]} raster sizes + 1 scalable"

# ── 6. doc, control ──────────────────────────────────────────────────────────────────────────────
cp "$HERE/copyright" "$PKGROOT/usr/share/doc/sud-workbench/copyright"
gzip -9 -n -c "$PROJECT/THIRD-PARTY-NOTICES.md" > "$PKGROOT/usr/share/doc/sud-workbench/THIRD-PARTY-NOTICES.md.gz"

cp "$HERE/postinst" "$PKGROOT/DEBIAN/postinst"
cp "$HERE/postrm"   "$PKGROOT/DEBIAN/postrm"
chmod 755 "$PKGROOT/DEBIAN/postinst" "$PKGROOT/DEBIAN/postrm"

# Installed-Size is in KiB: total tree minus DEBIAN/ (the control archive itself is never counted
# — that's Debian policy, since Installed-Size describes what lands on the TARGET filesystem).
# Plain `du -sk` rather than GNU-only `--exclude`, because this script runs on the maintainer's Mac
# (BSD du) — see the file header on why the .deb itself is built inside Docker instead.
_TOTAL_KB="$(du -sk "$PKGROOT" | cut -f1)"
_DEBIAN_KB="$(du -sk "$PKGROOT/DEBIAN" | cut -f1)"
INSTALLED_SIZE=$((_TOTAL_KB - _DEBIAN_KB))

cat > "$PKGROOT/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $VERSION
Section: editors
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_SIZE
Depends: $DEPENDS
Recommends: $RECOMMENDS
Maintainer: $MAINTAINER
Homepage: https://github.com/skalyan91/sud-workbench
Description: Dependency treebank editor for CoNLL-U / SUD
 A native-feeling desktop app for viewing and editing dependency treebanks in
 CoNLL-U, speaking SUD (Surface-syntactic Universal Dependencies) relation
 set, plus UD import/export and mSUD. Import (or type-and-parse) sentences,
 see them as dependency diagrams in five
 notations, edit the underlying CoNLL-U rows in a spreadsheet grid, and save
 back to a byte-stable .conllu file.
 .
 This package ships the application SOURCE plus a first-launch bootstrap: on
 first run it builds a private per-user Python virtual environment (under
 ~/.local/share/SUD Workbench/venv) from the system python3.12 this package
 depends on, and installs the (torch-free) CORE parsing/transliteration
 stack into it. Heavier optional stacks — Stanza/UD parsing, Japanese
 romaji, Arabic morphology — install on demand at runtime, from inside the
 app's own Manage Models dialog.
CONTROL

# Permissions sanity: directories 755, plain files not world-writable. dpkg-deb --root-owner-group
# (step 7) handles OWNERSHIP; this handles MODE, which that flag does not touch.
find "$PKGROOT" -mindepth 1 -type d -exec chmod 755 {} +
find "$PKGROOT" -mindepth 1 -type f -exec chmod go-w {} +
chmod 755 "$PKGROOT/usr/bin/sud-workbench" "$PKGROOT/opt/sud-workbench/setup/setup_venv.sh" "$PKGROOT/opt/sud-workbench/setup/find_py.sh"
chmod 755 "$PKGROOT/DEBIAN/postinst" "$PKGROOT/DEBIAN/postrm"

echo "  ✓ tree assembled: $(du -sh "$PKGROOT" | cut -f1)"

# ── 7. build the .deb ────────────────────────────────────────────────────────────────────────────
# dpkg-deb does not exist on macOS (no Homebrew formula ships it), which is why this step runs
# inside a container rather than on the host directly — the SAME reason make_win_app.py can only
# ASSEMBLE the Windows payload and has to say "now run iscc on a real Windows box". Linux is the one
# platform where the rest of the job — installing and booting the result — can ALSO be verified
# without leaving this Mac, via the same Docker daemon (see packaging/linux/README.md's verification
# transcript), so this step automates all the way through rather than stopping at "assembled".
# `--root-owner-group` (dpkg >= 1.19.0.5, present in every currently-supported Debian/Ubuntu) forces
# every file's ownership to root:root in the ARCHIVE regardless of the uid that ran this script —
# the modern replacement for wrapping the whole build in `fakeroot`, which would be one more tool
# this script would otherwise need on the host.
echo "▶ building .deb…"
rm -f "$DEBFILE"
if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --root-owner-group --build "$PKGROOT" "$DEBFILE"
else
  echo "  (no local dpkg-deb — building inside ubuntu:24.04 via Docker)"
  docker run --rm -v "$LINUX_OUT:/work" -w /work ubuntu:24.04 \
    dpkg-deb --root-owner-group --build "$PKGDIR_NAME" "$(basename "$DEBFILE")"
fi

echo "✓ built: $DEBFILE"
du -sh "$DEBFILE" | sed 's/^/  size: /'
echo
echo "Verify with (see packaging/linux/README.md for the full transcript):"
echo "  docker run --rm -v \"$LINUX_OUT:/work\" -w /work ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y ./$(basename "$DEBFILE")'"
