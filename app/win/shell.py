"""Windows shell: the small native layer the Fluent chrome needs.

Counterpart of ``app/mac/shell.py``, and deliberately about a twentieth its size.  The macOS file
is large because WKWebView refuses to cooperate with the window — it ignores ``app-region``, so the
title bar needs a transparent NSView overlay above the web view; it can't see the system accent, so
that needs an NSNotification observer; it has no idea about full screen, key focus, or the traffic
lights, so each needs its own bridge.  On Windows, ``IsNonClientRegionSupportEnabled`` (see
``dwm.enable_nonclient_regions``) hands the whole title-bar contract to CSS, and the two remaining
jobs are:

  * push the system accent + light/dark choice into the page, through the SAME
    ``window.__accentChanged(r, g, b)`` hook the macOS observer uses, so ``js/ui/colours.js`` works
    unchanged;
  * hang the DWM chrome (Mica, rounded corners, no border) off the window's own events.

Everything degrades: no registry key, no WebView2 setting, no DWM — the app still opens and edits.
"""

from __future__ import annotations

import sys
import threading

from . import dwm

# How often the accent/theme watcher re-reads the registry.  TWO SECONDS, and it is a poll on
# purpose.  The event-driven alternatives were both worse here: WM_DWMCOLORIZATIONCOLORCHANGED /
# WM_SETTINGCHANGE need a WndProc subclass on a Form that pythonnet owns, and .NET's
# SystemEvents.UserPreferenceChanged only fires on a thread with a message pump we don't control.
# The poll is two RegQueryValueEx calls against keys that are opened ONCE and held — microseconds,
# and unmeasurable against a 2 s period.  Two seconds is also below the point where the delay reads
# as a bug: the user changes the accent in Settings and has to look back at this window, which
# takes longer than that.
POLL_SECONDS = 2.0

_ACCENT_KEY = r"Software\Microsoft\Windows\DWM"
_THEME_KEY = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"


def read_accent() -> tuple[int, int, int] | None:
    """The system accent as (r, g, b), or None.

    HKCU\\…\\DWM\\AccentColor is stored **ABGR**, not RGB — 0xFFD77800 is the default blue
    #0078D7, with the byte order reversed and 0xFF alpha on top.  Getting this backwards produces a
    plausible-looking wrong colour (blue ↔ orange), which is exactly the kind of bug that survives
    review, hence the mask-and-shift being written out rather than packed into one expression."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _ACCENT_KEY) as key:
            raw = int(winreg.QueryValueEx(key, "AccentColor")[0]) & 0xFFFFFFFF
    except Exception:  # noqa: BLE001 — key absent on a fresh profile → caller keeps the CSS default
        return None
    b = (raw >> 16) & 0xFF
    g = (raw >> 8) & 0xFF
    r = raw & 0xFF
    return r, g, b


def read_dark() -> bool:
    """True when apps should use the dark theme.  ``AppsUseLightTheme`` is the app-scoped value —
    ``SystemUsesLightTheme`` governs the taskbar and Start, which a user commonly sets the other
    way round, so reading the wrong one gets it backwards for a large minority of machines."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _THEME_KEY) as key:
            return int(winreg.QueryValueEx(key, "AppsUseLightTheme")[0]) == 0
    except Exception:  # noqa: BLE001 — absent → Windows' own default is light
        return False


_watch = {"thread": None}


def install_appearance_watcher(window) -> None:
    """Poll the accent + theme and push every CHANGE into the page (idempotent; starts one thread).

    Pushes through ``window.__accentChanged(r, g, b)`` — the hook ``_install_accent_observer`` in
    app/mac/shell.py already feeds on macOS — so ``js/ui/colours.js`` needs no Windows branch at
    all.  The theme goes to ``window.__setSystemTheme``, guarded the same way, and re-seeds the DWM
    dark-mode attribute so the system menu and the 1px frame follow the page.

    Runs on a daemon thread and calls ``evaluate_js`` from there, never from a UI callback — the
    same rule as every JS push in app/mac/shell.py, for the same reason (evaluate_js blocks on a
    completion the UI thread would have to deliver)."""
    if _watch.get("thread") is not None:
        return

    def push(js: str) -> None:
        try:
            window.evaluate_js(js)
        except Exception as exc:  # noqa: BLE001 — page not up yet / mid-teardown
            print(f"[win] appearance push: {exc}", file=sys.stderr)

    def run() -> None:
        last_accent, last_dark = None, None
        while True:
            try:
                accent, dark = read_accent(), read_dark()
                if accent is not None and accent != last_accent:
                    last_accent = accent
                    push("window.__accentChanged && __accentChanged(%d,%d,%d)" % accent)
                if dark != last_dark:
                    last_dark = dark
                    push("window.__setSystemTheme && __setSystemTheme(%s)" % ("true" if dark else "false"))
                    dwm.set_attribute(dwm.hwnd_of(window), dwm.DWMWA_USE_IMMERSIVE_DARK_MODE, 1 if dark else 0)
            except Exception as exc:  # noqa: BLE001 — a watcher that dies takes the live accent with it
                print(f"[win] appearance watch: {exc}", file=sys.stderr)
            if _stop.wait(POLL_SECONDS):
                return

    _stop = threading.Event()
    t = threading.Thread(target=run, daemon=True, name="sud-appearance")
    _watch["thread"] = t
    _watch["stop"] = _stop
    t.start()


def install(window, api=None) -> None:
    """Wire the Windows chrome onto the window's own events.  The mirror image of
    ``mac.shell._unify_titlebar_on_show`` — same shape, far less to do.

    ``before_show``  — the Form (and so the HWND) exists: DWM attributes go on here, before the
                       first paint, so the window never flashes square-cornered.
    ``shown``/``loaded`` — CoreWebView2 exists by ``loaded``; the non-client-region setting is
                       re-asserted on both because a WebView2 that is still initialising at
                       ``shown`` would otherwise silently miss it (the app-region drag would then
                       be dead for the whole session, which looks like a CSS bug)."""
    def on_before_show(*_):
        report = dwm.apply_chrome(window, dark=read_dark())
        if report and not report.get("mica"):
            # Not a failure worth a toast — say it once on stderr so a "why is there no Mica?"
            # question has an answer in the log rather than a hunt through this file.
            print(f"[win] Mica unavailable (build {report.get('build')}; needs 22621+) — "
                  "opaque themed background instead", file=sys.stderr)

    def on_ready(*_):
        dwm.enable_nonclient_regions(window)
        install_appearance_watcher(window)
        # Seed the page with the current appearance immediately; the watcher only reports CHANGES,
        # so without this the first accent push would wait for the user to alter their theme.
        accent = read_accent()
        if accent is not None:
            try:
                window.evaluate_js("window.__accentChanged && __accentChanged(%d,%d,%d)" % accent)
            except Exception:  # noqa: BLE001
                pass

    events = getattr(window, "events", None)
    hooked = False
    ev = getattr(events, "before_show", None) if events is not None else None
    if ev is not None:
        ev += on_before_show
        hooked = True
    for name in ("shown", "loaded"):
        e2 = getattr(events, name, None) if events is not None else None
        if e2 is not None:
            e2 += on_ready
            hooked = True
    if not hooked:   # very old pywebview — do what we can right now
        on_before_show()
        on_ready()
