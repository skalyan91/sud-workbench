"""DWM window attributes — the Windows counterpart of the macOS unified-titlebar work.

Plain ``ctypes.WinDLL("dwmapi")``, deliberately: pywin32 is a 20 MB extra dependency for one
exported function, and ``DwmSetWindowAttribute`` takes only integers by reference.  The HWND comes
from ``window.native.Handle.ToInt32()`` — pywebview's Windows backend is WinForms via pythonnet, so
``window.native`` IS a ``System.Windows.Forms.Form`` and its ``Handle`` is the real window handle.
Valid from the ``before_show`` event onward (the Form is constructed by then).

EVERY function here degrades to a no-op.  That is the same posture ``app/convert.py`` takes toward
the grew backend: a missing capability disables a nicety, never the app.  It matters more here than
it looks, because the headline effect — Mica — is not reliably obtainable:

    pywebview ALREADY sets attribute 20 (dark mode) and 38 (backdrop type) itself, in
    ``winforms.py``'s ``update_title_bar_theme``.  So if Mica does not appear, the cause is NOT a
    missing DwmSetWindowAttribute call — it is WebView2 painting an opaque page over it.  The
    working recipe (Tauri's) is Mica + a transparent window + ``html,body{background:transparent}``
    in the page, plus ``WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0`` in the ENVIRONMENT before the window
    is created (the WebView2 loader reads it at browser-process start; setting it later has no
    effect).  A recent WebView2 runtime broke even that for Tauri and Microsoft closed the report
    "not planned".  So Mica is treated here as an enhancement that degrades to an opaque themed
    background — never as something to hard-fail or branch the layout on.
"""

from __future__ import annotations

import ctypes
import os
import sys

# ── DWMWINDOWATTRIBUTE values (dwmapi.h) ─────────────────────────────────────
DWMWA_USE_IMMERSIVE_DARK_MODE = 20     # Win11 22000+ (and Win10 1809+ under the value 19)
DWMWA_WINDOW_CORNER_PREFERENCE = 33    # Win11 22000+
DWMWA_BORDER_COLOR = 34                # Win11 22000+
DWMWA_SYSTEMBACKDROP_TYPE = 38         # Win11 build 22621 MINIMUM — on 22000 it silently does nothing

# DWM_WINDOW_CORNER_PREFERENCE
CORNER_DEFAULT, CORNER_DONOTROUND, CORNER_ROUND, CORNER_ROUNDSMALL = 0, 1, 2, 3
# DWM_SYSTEMBACKDROP_TYPE
BACKDROP_AUTO, BACKDROP_NONE, BACKDROP_MICA, BACKDROP_ACRYLIC, BACKDROP_MICA_ALT = 0, 1, 2, 3, 4
# DWMWA_BORDER_COLOR sentinels
BORDER_NONE = 0xFFFFFFFE     # DWMWA_COLOR_NONE — suppress the border entirely
BORDER_DEFAULT = 0xFFFFFFFF  # DWMWA_COLOR_DEFAULT

# The env var must be set BEFORE the WebView2 browser process starts, i.e. before create_window.
# 0 = fully transparent default background, which is what lets a Mica backdrop show through the
# page.  Exported from here (rather than from the shell) so the one comment above covers both.
WEBVIEW2_TRANSPARENT_ENV = ("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0")


def _dwmapi():
    """The dwmapi handle, or None off Windows / on a machine without DWM (Server Core)."""
    if sys.platform != "win32":
        return None
    try:
        return ctypes.WinDLL("dwmapi")   # type: ignore[attr-defined]  — WinDLL exists only on Windows
    except Exception:  # noqa: BLE001
        return None


def set_attribute(hwnd: int, attr: int, value: int) -> bool:
    """``DwmSetWindowAttribute(hwnd, attr, &value, 4)``.  False on any failure, and never raises.

    An attribute the running build does not know returns E_INVALIDARG rather than crashing, which
    is precisely why an unsupported Windows version needs no version check here — the call is its
    own feature test."""
    dwm = _dwmapi()
    if dwm is None or not hwnd:
        return False
    try:
        fn = dwm.DwmSetWindowAttribute
        # argtypes spelled out (as pywebview's own winforms.py does) so the HWND is widened to a
        # 64-bit pointer rather than truncated to a C int on x64 — a silently wrong handle would
        # simply fail, which is the hardest kind of cosmetic bug to notice.
        fn.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        fn.restype = ctypes.c_long
        val = ctypes.c_int(value)
        return fn(ctypes.c_void_p(hwnd), attr, ctypes.byref(val), ctypes.sizeof(val)) == 0
    except Exception:  # noqa: BLE001 — cosmetic; a failed attribute must never reach the user
        return False


def build_number() -> int:
    """The Windows build number (22000 = Win11 21H2, 22621 = 22H2), or 0 if unreadable.

    ``sys.getwindowsversion().build`` is manifest-gated on some hosts and can report 19041 under a
    non-manifested launcher, so the registry's own CurrentBuildNumber is read first — it is the
    value Settings ▸ About shows and is not subject to compatibility shimming."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") as key:
            return int(winreg.QueryValueEx(key, "CurrentBuildNumber")[0])
    except Exception:  # noqa: BLE001
        try:
            return int(sys.getwindowsversion().build)   # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            return 0


def hwnd_of(window) -> int:
    """HWND for a pywebview window, or 0.  Valid from ``before_show`` onward."""
    try:
        native = getattr(window, "native", None)
        return int(native.Handle.ToInt32()) if native is not None else 0
    except Exception:  # noqa: BLE001
        return 0


def apply_chrome(window, dark: bool | None = None) -> dict:
    """Give the window Windows 11 chrome: dark title bar, rounded corners, no border, Mica.

    Returns a small report ({attribute: applied?}) so the caller can log what the machine actually
    accepted rather than assuming.  Nothing here is required for the app to work."""
    hwnd = hwnd_of(window)
    if not hwnd:
        return {}
    build = build_number()
    out: dict[str, bool] = {}
    if dark is not None:
        # pywebview sets this too (and re-sets it on every system theme change), so this is only a
        # seed for the first paint — the title bar we draw ourselves is web content anyway; what
        # attribute 20 still governs is the 1px frame and the system menu.
        out["dark"] = set_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1 if dark else 0)
    out["corners"] = set_attribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, CORNER_ROUND)
    # No 1px accent/contrast border: the web layer draws the whole window surface, and the system
    # border would trace a rectangle just inside the rounded corners.
    out["border"] = set_attribute(hwnd, DWMWA_BORDER_COLOR, BORDER_NONE)
    # Mica needs 22621; on 22000 the call succeeds-ish and does nothing, so gate it and record the
    # reason instead of leaving a mystery.
    out["mica"] = (build >= 22621
                   and set_attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, BACKDROP_MICA))
    out["build"] = build   # type: ignore[assignment] — reported, not a flag
    return out


def prepare_environment() -> None:
    """Set ``WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0`` — MUST run before ``webview.create_window``.

    Without it WebView2 paints an opaque white/black page background before the first frame and the
    Mica backdrop behind the window is never visible, however many DWM attributes are set.  Left
    alone if the user already exported it (an explicit choice beats ours)."""
    if sys.platform != "win32":
        return
    name, value = WEBVIEW2_TRANSPARENT_ENV
    os.environ.setdefault(name, value)


def caption_action(window, what: str) -> bool:
    """minimize / maximize-restore / close, for the caption buttons the WEB layer draws.

    pywebview has ``minimize()``/``restore()``/``maximize()``/``destroy()``, but no "toggle", and
    no way to ask whether the window is currently maximised — so the toggle is resolved with a
    ``ShowWindow``-free WinForms read of ``WindowState`` where that is available, falling back to
    ``IsZoomed``+``ShowWindow`` through user32.  Both paths marshal onto the UI thread themselves
    (pywebview's own maximize/minimize/restore call ``Form.Invoke``), which is what keeps this safe
    to call from a bridge thread."""
    try:
        if what == "minimize":
            window.minimize()
            return True
        if what == "close":
            window.destroy()
            return True
        if what == "maximize":
            native = getattr(window, "native", None)
            zoomed = False
            try:    # WinForms' own state — authoritative, and set by pywebview's own maximize()
                zoomed = str(native.WindowState) == "Maximized"
            except Exception:  # noqa: BLE001 — fall back to the Win32 question
                try:
                    zoomed = bool(ctypes.windll.user32.IsZoomed(hwnd_of(window)))   # type: ignore[attr-defined]
                except Exception:  # noqa: BLE001
                    zoomed = False
            if zoomed:
                window.restore()
            else:
                window.maximize()
            return True
    except Exception as exc:  # noqa: BLE001 — a caption button must never take the app down
        print(f"[win] caption {what}: {exc}", file=sys.stderr)
    return False


def enable_nonclient_regions(window) -> bool:
    """Turn on ``CoreWebView2Settings.IsNonClientRegionSupportEnabled`` — the highest-leverage
    single line in the Windows port.

    It makes WebView2 honour the standard CSS ``app-region: drag`` property, and with it the whole
    system title-bar contract comes for free: dragging the window, Snap Layouts on hover over the
    maximise button, the right-click system menu, and double-click-to-maximise.  That is why
    Windows needs no analogue of the macOS transparent NSView drag overlay (``_drag_view_class`` in
    app/mac/shell.py) — the overlay exists only because WKWebView ignores ``app-region`` entirely.

    pywebview sets a dozen other ``CoreWebView2.Settings`` properties but not this one, and the
    property only exists from WebView2 runtime 1.0.2420.47, so an older runtime raises
    AttributeError — caught, reported False, and the app runs with an undraggable title bar rather
    than not at all.  Must be called once ``CoreWebView2`` exists (the ``loaded`` event), which is
    why the shell retries it there rather than at ``before_show``."""
    try:
        native = getattr(window, "native", None)
        core = native.webview.CoreWebView2 if native is not None else None
        if core is None:
            return False
        core.Settings.IsNonClientRegionSupportEnabled = True
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[win] non-client region support unavailable (old WebView2 runtime?): {exc}", file=sys.stderr)
        return False
