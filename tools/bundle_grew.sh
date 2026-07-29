#!/usr/bin/env bash
# Bundle grewpy_backend + its dynamic-library closure into vendor/grew/ so the packaged
# app can run grew conversions without an opam/OCaml install on the end user's machine.
#
# The binary links Homebrew's cairo / freetype / fontconfig (and their transitive deps),
# so we copy that whole closure and rewrite install names to @loader_path-relative paths.
# The result is architecture-specific (whatever this machine built) — run it on each target
# arch. app/convert.py picks up vendor/grew/bin/grewpy_backend automatically when present.
#
# Prereqs:  opam install grewpy_backend   (source binary)
#           brew install dylibbundler      (does the copy + install_name rewriting)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/grew"

BIN="$(ls "$HOME"/.opam/*/bin/grewpy_backend 2>/dev/null | head -1 || true)"
[ -n "$BIN" ] || { echo "grewpy_backend not found — run: opam install grewpy_backend" >&2; exit 1; }
command -v dylibbundler >/dev/null || { echo "dylibbundler missing — run: brew install dylibbundler" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/lib"
cp "$BIN" "$DEST/bin/grewpy_backend"

# -of overwrite, -b bundle non-system libs, -x the binary, -d libs dir, -p rpath for the copies
dylibbundler -of -b -x "$DEST/bin/grewpy_backend" -d "$DEST/lib" -p '@loader_path/../lib/'

echo "bundled grew backend → $DEST"
echo "verify with: otool -L $DEST/bin/grewpy_backend"
