#!/usr/bin/env python3
"""Packaging-time entry point for app/mac/sf_symbols.py -- see that module's own docstring for the
full story (which SF Symbols, why they moved out of mac-tokens.css, and the render technique).

Run this BEFORE copying web/ into a bundle (make_bootstrap_app.sh / make_portable.sh both do,
right at the top) so the copy picks up a freshly-generated web/macos-kit/mac-tokens-sf.generated.css
along with everything else. Also safe to run by hand after touching app/mac/sf_symbols.py's own
SYMBOLS table, or just to refresh the dev-tree copy.

Usage:  .venv/bin/python packaging/render_sf_symbols.py
"""
from __future__ import annotations

import os
import sys

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)   # so `import app.mac.sf_symbols` resolves when run as a bare script

from app.mac import sf_symbols  # noqa: E402  (after the sys.path fix-up above)

if __name__ == "__main__":
    ok = sf_symbols.generate()
    if ok:
        print(f"wrote {sf_symbols.OUT_PATH} ({len(sf_symbols.SYMBOLS)} SF Symbols rendered)")
    else:
        print(
            f"!! wrote an EMPTY {sf_symbols.OUT_PATH} -- AppKit/SF Symbols unavailable on this "
            "machine (not macOS, or PyObjC missing). The titlebar icons this file covers "
            "(undo/redo/zoom/actual-size/help/grid) will be blank until this runs on a real Mac.",
            file=sys.stderr,
        )
    sys.exit(0 if ok else 1)
