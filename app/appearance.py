"""Which appearance the OS is in, and what colour a window should be BEFORE its page paints.

``background_color`` is what pywebview fills a window with from the moment it is ordered on screen
until the web view's first paint lands — a good half-second on a cold launch, and again for the
blank strip a live resize opens up. It was hardcoded ``#1e1e1e`` at all three create_window calls,
which is dark mode's ``--win-bg``: a light-mode launch therefore opened BLACK and then snapped to
white. The two constants below are exactly the kits' ``--win-bg`` in each appearance (they agree
between macOS and Windows), so the pre-paint window is the same colour the page will be.

⚠️ THIS RUNS BEFORE ``webview.start()``, i.e. before there is an ``NSApp``. mac/shell.py's
``_appearance_is_dark()`` asks NSApp for its effective appearance and answers False when there
isn't one — which is right in light mode and silently wrong in dark, the very bug in a new hat. The
global ``AppleInterfaceStyle`` default needs no application object, so it is what the cold path
reads; NSApp's own answer is preferred once it exists, since that is what the window will adopt.
"""

from __future__ import annotations

import sys

WINDOW_BG_DARK = "#1e1e1e"    # == --win-bg in web/macos-kit/mac-tokens.css's dark block (and Fluent's)
WINDOW_BG_LIGHT = "#ffffff"   # == --win-bg in the light :root of both kits


def is_dark() -> bool:
    """True when the OS is in dark mode. Never raises; unknown → False, matching both platforms'
    own default of light."""
    if sys.platform == "darwin":
        try:
            from .mac import shell as _sh
            if _sh._appearance_is_dark():      # authoritative once NSApp exists (an app-level override wins)
                return True
        except Exception:  # noqa: BLE001 — PyObjC missing or NSApp not up yet: fall through to the default below
            pass
        try:
            from Foundation import NSUserDefaults
            # "Dark" when dark, ABSENT when light — the key is not written with a False value, which
            # is why this is a None check and not a bool read.
            return NSUserDefaults.standardUserDefaults().stringForKey_("AppleInterfaceStyle") == "Dark"
        except Exception:  # noqa: BLE001
            return False
    if sys.platform == "win32":
        try:
            from .win import shell as _wsh
            return _wsh.read_dark()
        except Exception:  # noqa: BLE001
            return False
    return False


def window_bg() -> str:
    """The ``background_color`` a window should be created with, for the appearance in force now."""
    return WINDOW_BG_DARK if is_dark() else WINDOW_BG_LIGHT
