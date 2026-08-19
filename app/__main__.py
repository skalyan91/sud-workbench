"""pywebview bootstrap for SUD Workbench.

Creates the native window, builds the application menu, loads the web frontend, and wires the
platform's open-file events.  The menu actions call into the frontend's bridge-aware JS helpers so
there is a single code path for open/save/add-text whether they are triggered from the toolbar, the
menu bar, or a keyboard shortcut.

WHAT LIVES WHERE.  This file is the PORTABLE bootstrap and nothing else: the window, the
declarative menu (built from ``app/menu_spec.py``), the crash/exit tracing, the unsaved-close veto,
and a ``sys.platform`` dispatch to one of two shells.  ``app/mac/shell.py`` holds the ~900 lines of
AppKit/PyObjC that give macOS its native feel; ``app/win/shell.py`` + ``app/win/dwm.py`` hold the
much smaller Windows equivalent.  The import is INSIDE the branch, so PyObjC is never imported on
Windows and pythonnet never on macOS.
"""

from __future__ import annotations

import faulthandler
import json
import os
import sys
import threading
import warnings

# Silence threadpoolctl's "Found Intel OpenMP ('libiomp') and LLVM OpenMP ('libomp')" RuntimeWarning.
# It fires when two OpenMP runtimes end up loaded in the one process — e.g. torch/sklearn ship LLVM
# 'libomp' while a NEW dependency (or the packaged .app's bundled libs) drags in Intel 'libiomp'. On a
# plain dev launch only 'libomp' is present, so it stays quiet; with a parser model / the packaged app
# both load and threadpoolctl (pulled in transitively by numpy/thinc/sklearn) grumbles. The advice is
# irrelevant to us (we never mix the two deliberately) and only alarms the user, so filter THIS message
# specifically — matched from the start of the dedented text, hence the leading \s* — and nothing else.
# Must run before any heavy import triggers threadpoolctl's probe, so it sits at the top of the entry point.
warnings.filterwarnings(
    "ignore",
    message=r"\s*Found Intel OpenMP",
    category=RuntimeWarning,
)

import webview
from webview.menu import Menu, MenuAction, MenuSeparator

from . import appearance, menu_spec
from .api import Api
from .paths import APP_DATA

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
INDEX = os.path.join(WEB_DIR, "index.html")

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"
IS_LINUX = sys.platform.startswith("linux")

# Arm a crash dumper + exit tracer. faulthandler catches hard SIGNALS (native-lib segfault /
# SIGABRT). But a "window vanished" can also be a CLEAN exit (window closed / run-loop ended)
# or an uncaught Python exception on a bridge thread — none of which faulthandler sees. So we
# ALSO log uncaught exceptions (main + threads), window close/loop-exit, and atexit to crash.log,
# so the next occurrence tells us EXACTLY how the process ended. Best-effort; never break startup.
_CRASH_LOG = None


def _clog(msg: str) -> None:
    try:
        if _CRASH_LOG is not None:
            print(msg, file=_CRASH_LOG, flush=True)
    except Exception:  # noqa: BLE001
        pass


try:
    import atexit
    import datetime
    import traceback as _traceback
    os.makedirs(APP_DATA, exist_ok=True)
    _CRASH_LOG = open(os.path.join(APP_DATA, "crash.log"), "a", buffering=1)  # line-buffered, appended
    print(f"\n=== session start (pid {os.getpid()}) {datetime.datetime.now():%H:%M:%S} ===", file=_CRASH_LOG, flush=True)
    faulthandler.enable(file=_CRASH_LOG, all_threads=True)

    def _hook_main(t, v, tb):
        _clog("=== UNCAUGHT EXCEPTION (main thread) ===\n" + "".join(_traceback.format_exception(t, v, tb)))
        sys.__excepthook__(t, v, tb)
    sys.excepthook = _hook_main

    def _hook_thread(args):
        _clog(f"=== UNCAUGHT EXCEPTION (thread {args.thread!r}) ===\n"
              + "".join(_traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)))
    threading.excepthook = _hook_thread

    atexit.register(lambda: _clog("=== atexit: Python process exiting (normal termination) ==="))

    # Catch TERMINATING signals at the C level (faulthandler.register dumps the stack even while the
    # main thread is inside native Cocoa code — a Python signal handler CANNOT run there). chain=True
    # then re-raises the default action, so the process still exits. This captures a SIGTERM/SIGINT/
    # SIGHUP/SIGQUIT kill (e.g. the launcher reaping the job) WITH a stack. SIGKILL (9) is uncatchable
    # by anything — if the log ends with none of these, it was SIGKILL (or the OS force-terminating a
    # hung window; the periodic watchdog below then shows whether the main thread was stuck).
    import signal as _signal
    for _s in (_signal.SIGTERM, _signal.SIGINT, _signal.SIGHUP, _signal.SIGQUIT):
        try:
            faulthandler.register(_s, file=_CRASH_LOG, all_threads=True, chain=True)
        except Exception:  # noqa: BLE001
            pass

    # (The 12s hang-watchdog was removed once the "crash" was pinned down: every dump showed the main
    # thread healthy in the Cocoa run loop (BrowserView.app.run) right up to an abrupt, trace-less end —
    # i.e. an uncatchable external SIGKILL from the background-job manager launching the app, NOT an
    # in-process fault or hang. faulthandler.enable + register below still catch any real native fault or
    # terminating signal, silently, if one ever does occur.)
except Exception as exc:  # noqa: BLE001
    print(f"[crashlog] could not arm crash log: {exc}", file=sys.stderr)


# ── SEVERAL DOCUMENT WINDOWS, ONE PROCESS ────────────────────────────────────────────────────────
# "New Window" used to launch a whole second `python -m app` PROCESS, on the reading that pywebview is
# single-window. It isn't: create_window may be called again after start (from a NON-main thread —
# webview/__init__.py creates the window inline only for a non-MainThread caller), which is already how
# every secondary window in this app is made (api.py's _open_window: Help / About / Model Manager / …).
# One process buys what the process-per-window design could not have at any price:
#   · ONE Dock icon and ONE menu bar with one wiring pass, rather than N processes each drawing their
#     own and re-wiring their own — this is the whole reason multiple documents read as one app rather
#     than N unrelated ones;
#   · a shared model/parse cache and a single state.json writer instead of N racing ones.
# ⚠ THIS APP DELIBERATELY DOES NOT OFFER macOS WINDOW TABBING. It did, briefly — every document window
# shared a tabbingIdentifier and New Window's menu row had a New Tab twin — and it was removed on
# request: multiple open documents should read as multiple ordinary windows (sharing the one Dock icon
# and menu bar above), never merged into one window's tab strip. The removal also closes a real
# investigation: there turned out to be NO way to keep the native tab bar's real grouping mechanics
# (Merge All Windows, ⌃⇥, the Window menu's tab list) while suppressing its own visual, which a DOM
# replacement would have needed — toggleTabBar_ called directly is a silent no-op with 2+ tabs open,
# routing the same command through the responder chain (sendAction:to:from:) isn't even validated, and
# hiding the private view AppKit lays the accessory into (found by walking NSThemeFrame →
# NSTitlebarContainerView → NSTitlebarView to a bare 36px NSView at exactly the bar's own height) has
# zero effect on what's actually painted — confirmed live, via real window-server screenshots, not the
# WKWebView-only snapshot that can't see native chrome at all. Whatever draws the pills isn't
# reachable through any NSView this process can see. So the tabbing setup (it lived in app/mac/
# shell.py's _mutate) is gone with the feature, not merely hidden — see setTabbingMode_ there, now
# explicitly NSWindowTabbingModeDisallowed rather than .automatic, so a system-wide "prefer tabs"
# preference can't silently re-group two windows opened in quick succession either.
# What it costs is that the menu bar is now app-global while the commands are per-document, so nothing
# may close over "the" window any more: _key_pair() resolves the KEY window at click time, and the same
# provider is handed to mac/shell.py for the native items it owns (Open Recent, About, the delegate).
_WINDOWS: list = []                     # live document windows, oldest first: [(window, api), …]
_WIN_LOCK = threading.Lock()
_WIN_URL = ""                           # the index URL every document window loads (with ?platform= under SUD_CHROME)
_FORCED_CHROME = ""                     # SUD_CHROME=win|mac preview, if any


def _key_pair():
    """The ``(window, api)`` a menu command should act on: the key (frontmost) document window, or
    the most recently opened one when AppKit names something else — a secondary window such as the
    Model Manager, or nothing at all. ``(None, None)`` only once every document window has closed."""
    with _WIN_LOCK:
        pairs = list(_WINDOWS)
    if not pairs:
        return (None, None)
    if IS_MAC:
        try:
            import AppKit
            app = AppKit.NSApp
            key = (app.keyWindow() if app is not None else None) or (app.mainWindow() if app is not None else None)
            if key is not None:
                num = int(key.windowNumber())
                for win, api in pairs:
                    native = getattr(win, "native", None)
                    if native is not None and int(native.windowNumber()) == num:   # windowNumber, not object identity: PyObjC hands back a fresh proxy per call
                        return (win, api)
        except Exception as exc:  # noqa: BLE001 — never let a menu command die over window resolution
            print(f"[window] key window: {exc}", file=sys.stderr)
    return pairs[-1]


def _forget_window(window) -> None:
    with _WIN_LOCK:
        for i, (win, _api) in enumerate(_WINDOWS):
            if win is window:
                del _WINDOWS[i]
                break


def _new_document_window(path: str | None = None) -> None:
    """Open another document window in THIS process (File ▸ New Window, and the bridge's own
    ``api._new_window``).  Empty unless a path is handed in.  An ordinary window from the first
    frame — see the module-level note above for why there is no tabbed twin of this any more.

    Threaded, always: pywebview creates a post-start window only when create_window is called off the
    MainThread (it otherwise just registers it and waits for a start that has already happened), and
    both callers here — a pywebview MenuAction, which runs on its own thread, and a JS bridge call —
    could in principle arrive on either. api.py's _open_window threads for the same reason."""
    def make():
        try:
            api = Api()
            if path and os.path.exists(path):
                api.path = os.path.abspath(path)
            win = webview.create_window(
                "SUD Workbench",
                url=_WIN_URL,
                js_api=api,
                width=1240,
                height=820,
                min_size=(1200, 560),
                **({"vibrancy": False} if IS_MAC else {}),
                background_color=appearance.window_bg(),   # the colour the window IS until its page paints — light mode must not open black (see app/appearance.py)
                text_select=True,
            )
            if win is None:
                print("[window] new window: create_window returned None", file=sys.stderr)
                return
            _setup_window(win, api)
        except Exception as exc:  # noqa: BLE001 — never crash the running window over a failed second one
            print(f"[window] new window: {exc}", file=sys.stderr)
    threading.Thread(target=make, daemon=True).start()


def _setup_window(window, api) -> None:
    """Everything a document window needs beyond existing — the per-window half of what main() used to
    do inline, now shared by the first window and every later one so the two cannot drift."""
    api.set_window(window)
    api._new_window = _new_document_window   # the bridge's "New Window", same call the menu makes
    api._broadcast = lambda code, api_self=api: _broadcast_js(code, exclude=api_self.window)   # app-wide UI state → every OTHER window
    # …and the same call with NOTHING excluded, for a fact about the INSTALL rather than about a
    # window's UI state: a tier that has just appeared on disk changes what every document window may
    # offer, this one included.  The Model Manager shares its opener's `Api`, so `api.window` is the
    # very document window that must hear about it — the exclusion above is exactly wrong there.
    api._broadcast_all = lambda code: _broadcast_js(code)
    _warn_on_unsaved_close(window, api)
    _inject_path_info(window, api)           # window.__pathInfo — portable, both platforms

    if IS_MAC:
        from .mac import shell as mac_shell
        mac_shell._set_dock_icon_on_show(window)   # show the app's own Dock icon at runtime
        # The native Open Recent / About items resolve their target through the key-window provider
        # installed in main(); this pair is only the fallback for before one exists.
        mac_shell._recent_ctx.setdefault("window", window)
        mac_shell._recent_ctx.setdefault("api", api)
        api._recent_menu_refresh = lambda: mac_shell.refresh_recent_menu(*_recent_target_pair(window, api))
        # Under SUD_CHROME=win this ONE piece is suppressed, and it has to be: it places the real
        # traffic lights in-content and publishes --lights-cy/--lights-right, which the Fluent kit
        # neither reads nor leaves room for. Leaving it on puts three macOS window buttons on top of a
        # Windows title bar that draws its own caption buttons on the right — a chimera that
        # misrepresents both platforms, which is worse than not offering the preview at all.
        if _FORCED_CHROME != "win":
            mac_shell._unify_titlebar_on_show(window, api)
        mac_shell._enable_first_mouse()
    elif IS_WIN:
        from .win import shell as win_shell
        win_shell.install(window, api)
        # The in-window menu bar rebuilds its Open Recent flyout from api.recent_files() each time it
        # opens (js/ui/menubar.js), so there is nothing to retain and nothing to refresh here — the
        # native-NSMenu bookkeeping mac/shell.py needs exists only because pywebview has no rebuild API.
    elif IS_LINUX:
        from .linux import shell as linux_shell
        linux_shell.install(window, api)   # live GTK3 theme watcher + a native Gtk.MenuBar built from menu_spec.MENUS, one per window — see app/linux/shell.py

    with _WIN_LOCK:
        _WINDOWS.append((window, api))
    ev = getattr(getattr(window, "events", None), "closed", None)
    if ev is not None:
        try:
            ev += (lambda *_a, _w=window: _forget_window(_w))   # …so a closed window stops being a candidate for _key_pair
        except Exception:  # noqa: BLE001
            pass


def _broadcast_js(code: str, exclude=None) -> None:
    """Run ``code`` in every document window except ``exclude``.

    For the state that belongs to the APP rather than to one document — the options bar being open is
    the first of them. Each window is its own page with its own frontend, so "shown in all tabs" has
    to be said to each; there is no shared DOM. Off-thread per window, the shape every JS push in this
    file uses (evaluate_js blocks on a completion the UI thread delivers)."""
    for w, _a in list(_WINDOWS):
        if w is exclude:
            continue
        threading.Thread(target=lambda _w=w: _eval_quiet(_w, code), daemon=True).start()


def _eval_quiet(window, code: str) -> None:
    try:
        window.evaluate_js(code)
    except Exception as exc:  # noqa: BLE001 — a window mid-teardown is not an error worth raising
        print(f"[window] broadcast: {exc}", file=sys.stderr)


def _recent_target_pair(window, api):
    """(window, api) for an Open Recent rebuild — the key window, falling back to the caller's own."""
    win, a = _key_pair()
    return (win, a) if win is not None else (window, api)


def build_menu(api=None) -> list[Menu]:
    """Turn app/menu_spec.py's table into pywebview's declarative Menu tree.

    PORTABLE ON PURPOSE — this touches no AppKit at all: pywebview builds the NSMenu from these
    objects, and app/mac/shell.py's _wire_menu then decorates the live items with key equivalents
    and SF Symbols from the SAME table.  A row's `js` string is what the Windows in-window menu bar
    invokes too, so neither platform owns a command.

    NO WINDOW IS CAPTURED HERE. There is one menu bar and now several document windows, so each
    command resolves _key_pair() when it RUNS; the menu built at startup would otherwise drive the
    first window forever. `api` is used only to read the recent-files list, which is app-wide state."""
    def js(code: str):
        def action():
            win, _api = _key_pair()
            if win is None:
                return
            try:
                win.evaluate_js(code)   # pywebview dispatches a MenuAction on its own thread (cocoa.py's handleMenuAction_), so this can't self-deadlock on the main run loop
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] {code!r} failed: {exc}", file=sys.stderr)
        return action

    def _toggle_fs_toolbar():
        """item 10: flip the 'always show toolbar in full screen' pref. The frontend owns + persists it;
        we flip the Python mirror (drives the checkmark) and let the JS toggle apply + save it."""
        menu_spec.toggle_fs_toolbar_mirror()
        def run():
            win, _api = _key_pair()
            if win is None:
                return
            try:
                win.evaluate_js("window.__toggleFsAlwaysToolbar && __toggleFsAlwaysToolbar()")
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] fs toolbar toggle failed: {exc}", file=sys.stderr)
        threading.Thread(target=run, daemon=True).start()   # off-thread → evaluate_js can't self-deadlock on the main thread

    # The two rows the web layer cannot do alone: opening another document window, and flipping the
    # Python-side mirror that draws the full-screen-toolbar checkmark.  Named in the table as
    # `action=`, resolved to a callable here.
    natives = {"new_window": lambda: _new_document_window(),
               "toggle_fs_toolbar": _toggle_fs_toolbar}

    def _open_recent_items() -> list:
        """Build the Open Recent submenu from the persisted recent-files list.
        Populated once at menu-build time (see the dynamic-rebuild note below)."""
        recent = []
        try:
            recent = api.recent_files() if api is not None else []
        except Exception as exc:  # noqa: BLE001
            print(f"[menu] recent_files failed: {exc}", file=sys.stderr)
        items: list = []
        for path in recent:
            name = os.path.basename(path)
            items.append(MenuAction(name, js(f"window.openRecentFile && openRecentFile({json.dumps(path)})")))
        if recent:
            items.append(MenuSeparator())
        items.append(MenuAction("Clear Recent", js("window.clearRecentFiles && clearRecentFiles()")))
        return items

    submenus = {"recent": _open_recent_items}

    out: list[Menu] = []
    for spec in menu_spec.MENUS:
        rows: list = []
        for it in spec["items"]:
            if it.get("sep"):
                rows.append(MenuSeparator())
            elif it.get("submenu"):
                rows.append(Menu(it["title"], submenus[it["submenu"]]()))
            elif it.get("action"):
                rows.append(MenuAction(it["title"], natives[it["action"]]))
            else:
                rows.append(MenuAction(it["title"], js(it["js"])))
        out.append(Menu(spec["title"], rows))
    return out


def main(argv: list[str] | None = None):
    argv = sys.argv[1:] if argv is None else argv
    # Put the on-demand extras dir on sys.path FIRST, so any heavy stack (Stanza/torch, Japanese,
    # Arabic) the user installed after shipping imports before its first lazy use.
    try:
        from . import extras
        extras.activate()
    except Exception:  # noqa: BLE001
        pass
    if IS_MAC:
        # Name the process so the menu-bar app name reads "SUD Workbench" (not "Python") when launched
        # outside a code-signed bundle — must happen before the NSApplication menu is built.
        try:
            import Foundation
            Foundation.NSProcessInfo.processInfo().setProcessName_("SUD Workbench")
        except Exception:  # noqa: BLE001
            pass
        # Dev-convenience on-demand render (mirrors app/fonts.py's own cached-fetch shape): a packaged
        # build already carries web/macos-kit/mac-tokens-sf.generated.css (packaging/render_sf_symbols.py
        # ran at build time), but a plain `.venv/bin/python -m app` from source has never triggered that
        # script, so the titlebar's undo/redo/zoom/actual-size/help/grid/open icons would otherwise be
        # blank mask images. Must run BEFORE create_window below — mac-tokens.css's own @import resolves
        # at first paint, and a file written afterward is too late for that load.
        try:
            from .mac import sf_symbols
            sf_symbols.ensure()
        except Exception:  # noqa: BLE001
            pass
    elif IS_WIN:
        # Must run BEFORE create_window: the WebView2 loader reads this at browser-process start, and
        # a transparent default page background is what lets the Mica backdrop show through at all.
        from .win import dwm as _dwm
        _dwm.prepare_environment()
    elif IS_LINUX:
        from .linux import shell as linux_shell
        linux_shell.prepare_environment()   # no-op today — see app/linux/shell.py
    api = Api()

    # a file path passed on the command line (or by a macOS open-file event)
    # becomes the initial document
    for arg in argv:
        if arg.lower().endswith((".conllu", ".conll")) and os.path.exists(arg):
            api.path = os.path.abspath(arg)
            break
    # …and with NO file named, reopen whatever the last window to close had open (Api.record_last_doc,
    # written from the `closed` handler below). Only when nothing was named, so an explicitly opened
    # document — a command-line path, a Finder double-click, a drop on the Dock icon — always wins.
    # A window closed EMPTY records None and so starts the next launch empty, which is the way to ask
    # for one. Nothing else is needed to restore the view: get_state already returns _saved_scroll for
    # whatever path it loads, so the document comes back at the sentence it was left on.
    # `--empty` opts out, for a command line that wants a blank window rather than last session's
    # document. (File ▸ New Window no longer needs it: a second window is now made in-process by
    # _new_document_window, which never runs this function and so is empty unless handed a path.)
    if not api.path and "--empty" not in argv:
        api.path = api.last_doc()

    # SUD_CHROME=win|mac — DEV PREVIEW ONLY: wear the other platform's chrome kit in a real native
    # window, so the Fluent skin can be looked at on a Mac without a Windows machine. The web layer
    # decides its kit from ?platform= (the inline <head> script in index.html), which is the only
    # hook available: the choice must be made before first paint, so nothing Python injects after
    # load can reach it. Mirrors SUD_DEBUG=1 in spirit — an env var, no UI, no persistence.
    # It deliberately does NOT pretend to be the Windows BUILD: the menu, Dock icon and file dialogs
    # stay native. See the _unify_titlebar_on_show skip below for the one thing it has to suppress.
    _chrome = (os.environ.get("SUD_CHROME") or "").strip().lower()
    _forced = _chrome if _chrome in ("win", "mac") else ""
    _url = INDEX + (f"?platform={_forced}" if _forced else "")
    global _WIN_URL, _FORCED_CHROME       # …so every later window opens the same document UI under the same chrome
    _WIN_URL, _FORCED_CHROME = _url, _forced

    window = webview.create_window(
        "SUD Workbench",
        url=_url,
        js_api=api,
        width=1240,
        height=820,
        min_size=(1200, 560),   # keep the unified toolbar on one line (incl. traffic-light inset + search bar)
        # VIBRANCY OFF, DELIBERATELY. It is a Cocoa NSVisualEffectView (macOS-only; pywebview's
        # winforms backend has no such argument, and Windows' equivalent, Mica, is a DWM attribute set
        # in app/win/dwm.py) — and asking for it bought this app nothing but a flicker. The page paints
        # an opaque --content-bg over the whole window, so the material is never visible once a
        # document is up: an A/B of the loaded window with it on and off is PIXEL-IDENTICAL (worst
        # channel delta 0 across 3.9M pixels). What it did do was own the window for the ~85ms between
        # its own layout and the page's first paint, which is the semitransparent dip a loading tab
        # showed — white → glass → white. Off, the window is the appearance-matched colour from
        # app/appearance.py right through to the first paint.
        **({"vibrancy": False} if IS_MAC else {}),
        background_color=appearance.window_bg(),   # …the same for the first window, which is created before webview.start() and so before there is an NSApp to ask
        text_select=True,
    )
    if IS_MAC:
        from .mac import shell as mac_shell
        mac_shell.set_key_provider(_key_pair)   # …so the native Open Recent / About / delegate items act on the KEY window, not on this first one
        if _forced == "win":
            print("[chrome] SUD_CHROME=win — Fluent kit in a native window; macOS titlebar "
                  "unification skipped. The NSMenu is still macOS's, but its AppKit wiring rides "
                  "along with the unification and is skipped too, so this preview has no menu key "
                  "equivalents and no injected Cut/Copy/Paste. Mica/caption buttons are not "
                  "wired here (that is app/win/, and it needs Windows).", file=sys.stderr)
    _setup_window(window, api)   # the same per-window wiring every LATER window gets — see _new_document_window

    # The DECLARATIVE menu is macOS-only. It is the same table either way (app/menu_spec.py), but on
    # Windows the menu is drawn by the web layer INSIDE the title bar, and handing pywebview a menu
    # there would additionally raise a native WinForms MenuStrip band above the page — two menu bars,
    # one of them un-styleable. Api.menu_spec() serves that same table to js/ui/menubar.js instead.
    # NO DEFAULT MENUS. pywebview's cocoa backend builds its own View and Edit menus on top of
    # whatever menu it is handed (_recreate_menus → _add_view_menu / _add_edit_menu, platforms/
    # cocoa.py), gated on this one setting, which defaults to True. app/menu_spec.py declares an Edit
    # and a View of its own, so the bar came up with each of the two TWICE — pywebview's pair
    # (inserted at index 1, i.e. ahead of ours) and ours. Switching the setting off is the supported
    # way to stop it; the alternative, hunting the duplicates down and removing them from the live
    # NSMenu afterwards, would have to re-run on every menu rebuild and races the rebuild itself.
    #
    # What those defaults PROVIDED is not lost: Cut/Copy/Paste/Select All and Enter Full Screen are
    # first-responder AppKit selectors (they work inside the WKWebView's own text fields precisely
    # BECAUSE they have no target), and app/mac/shell.py now injects them as native NSMenuItems into
    # our own Edit and View menus — from menu_spec.NATIVE_MAC, so the chords stay in the one table.
    # The setting is written unconditionally: only the cocoa backend reads it (winforms has no
    # default menus at all), and the answer would be "no" on any backend that later did.
    webview.settings["SHOW_DEFAULT_MENUS"] = False
    menu = build_menu(api) if IS_MAC else []
    # trace window teardown so a "vanished window" is attributed: did a close event fire, or did
    # the run loop just end? (logged to crash.log alongside the faulthandler/exception hooks)
    for _evname in ("closing", "closed"):
        _ev = getattr(getattr(window, "events", None), _evname, None)
        if _ev is not None:
            try:
                _ev += (lambda *_a, _n=_evname: _clog(f"=== window event: {_n} ==="))
            except Exception:  # noqa: BLE001
                pass
    # ── WARM THE ENGLISH PARSER, OFF THE READER'S CLOCK ──────────────────────────────────────
    # ⚠ THE FIRST PARSE OF A SESSION COSTS ~8.4s AND IT IS ALL MODEL LOADING (measured; the parse
    # itself is 0.3s once loaded). Two features pay it on first use, and BOTH are English-model
    # features whatever language the document is in: the translation auto-gloss (app/gloss_align.py)
    # and the Wiktionary definition flyout (app/wiktionary.py condenses English definition prose with
    # a real SUD parse). Reported as a bug, and fairly — ticking a glossing tier showed a spinner for
    # ten seconds with nothing to say why, which is indistinguishable from a feature that does not
    # work. Loading it here moves that cost to where nobody is waiting on it.
    #
    # UNCONDITIONAL, on instruction, rather than gated on the document having translations or on a
    # glossing tier being on: which of the two features a reader reaches for is not knowable at
    # launch, the model is a declared dependency that every environment already has on disk, and a
    # conditional warm-up would simply move the ten-second wait to whichever case the condition
    # missed. The cost of being wrong is resident memory in a session that never glosses or looks a
    # word up; the cost of the alternative is the bug this fixes.
    #
    # DAEMON THREAD, started BEFORE the run loop and outliving nothing: `webview.start()` blocks
    # right below, so a plain call here would delay the window itself by those same seconds. The GIL
    # makes this contend a little with the frontend's first paint, which is why it is not started any
    # earlier — by the time spaCy's import work begins in earnest the window creation above has
    # already been issued. Failure is silent BY DESIGN (see parse.warm): nobody asked for this, so
    # there is nobody to report it to, and every real call site still resolves and reports for itself.
    def _warm_english():
        try:
            from . import parse, wiktionary
            parse.warm(wiktionary.english_model_id())
        except Exception:  # noqa: BLE001 — a warm-up must never be able to take the app down with it
            pass

    threading.Thread(target=_warm_english, name="warm-english", daemon=True).start()

    _clog("=== webview.start(): entering native run loop ===")
    webview.start(http_server=True, menu=menu, debug=bool(os.environ.get("SUD_DEBUG")))
    _clog("=== webview.start(): RETURNED — run loop ended, window closed ===")
    # HANG ON QUIT (diagnosed via faulthandler.register's all-thread dump in crash.log, reproduced by
    # closing with unsaved changes): pywebview's cocoa evaluate_js (platforms/cocoa.py) does
    # AppHelper.callAfter(eval) then blocks FOREVER on a semaphore with NO timeout, waiting for
    # WKWebView's completion handler. Every bridge call this app makes back into JS (the close-veto's
    # "ask the sheet" push, _eval_quiet's child-window pushes, …) runs on its OWN thread specifically so
    # a stuck evaluate_js can't block the CALLER — but it can still leave THAT thread parked forever if
    # the completion handler never fires (e.g. the window/webview it targets is mid-teardown). Python
    # 3.12's Py_FinalizeEx (wait_for_thread_shutdown) then waits for every such thread — including
    # daemon ones — before the interpreter can exit, so ONE stuck evaluate_js call hangs the WHOLE
    # process on quit even though the window has already visibly closed (confirmed: crash.log always
    # shows "window event: closed" / "RETURNED" logged, then the process never reaches "atexit").
    # Fix: once the run loop has genuinely ended there is nothing left to wait for — force-exit
    # immediately rather than let normal interpreter finalization join a thread that will never finish.
    os._exit(0)


def _inject_path_info(window, api):
    """Hand the frontend the platform's path separator + the name of the row above the topmost
    folder, as ``window.__pathInfo``.

    ``folderChain()`` in js/io/bridge.js splits a path and labels its root; it used to split on "/"
    and hard-code "Macintosh HD", which is a macOS fact stated in the one file that is meant to be
    portable.  PORTABLE, not Windows-specific: macOS gets exactly the values it had, from the same
    call, so there is no branch in the frontend at all — it reads two strings.  ``Api.path_info``
    holds the values and the reasoning behind "This PC".

    Pushed on ``loaded`` (the JS bridge is up) off a daemon thread, the same fire-and-forget shape
    every other JS push in this app uses — evaluate_js blocks on a completion the UI thread has to
    deliver, so it must never be called from a UI callback."""
    def push(*_):
        def run():
            try:
                window.evaluate_js("window.__pathInfo=%s" % json.dumps(api.path_info()))
            except Exception as exc:  # noqa: BLE001 — cosmetic path labels; never break startup
                print(f"[shell] path info: {exc}", file=sys.stderr)
        threading.Thread(target=run, daemon=True).start()

    ev = getattr(getattr(window, "events", None), "loaded", None)
    if ev is not None:
        ev += push
    else:
        push()


def _warn_on_unsaved_close(window, api):
    """Prompt before closing when the document has unsaved changes.  A ``closing``
    handler that returns False vetoes the close; we only let it through once the
    in-page sheet has confirmed (or there was nothing unsaved to begin with).
    ``api.dirty`` is kept in sync by the frontend's set_dirty.

    THREADING (this is what was hanging on close, back when this showed a native NSAlert
    inline): pywebview's ``closing`` event is ``Event(self, True)`` (should_lock=True), so
    its handlers run *synchronously on the thread that fires it* — and Cocoa fires it from
    ``windowShouldClose_`` / ``applicationShouldTerminate_`` on the **AppKit main thread**.
    Anything here that blocks waiting for a result (a modal NSAlert, or pywebview's
    ``create_confirmation_dialog``/``evaluate_js``, both of which queue onto the main run
    loop via callAfter and then block on a semaphore) deadlocks when called FROM the main
    thread: the queued callAfter can only run once the main run loop spins again, but the
    main thread is the one parked waiting for it.

    Fix: never block here at all. Always veto synchronously (return False) when dirty,
    and — off a throwaway thread, the same pattern every other fire-and-forget JS push in
    this file uses (see the recent-menu/about/toast callers above) — ask the WEB CONTENT to
    show its own Figma-styled "unsaved changes" sheet (askConfirm, matching every other
    dialog in the app; replaces the old native NSAlert). If the user picks Close Without
    Saving, the frontend calls back into ``confirm_close_without_saving`` (api.py), which
    sets ``api._force_close`` and re-issues the close — that second ``closing`` event then
    short-circuits below instead of showing the sheet again."""
    def _confirm_close():
        if not getattr(api, "dirty", False):
            return True   # nothing unsaved → allow the close
        if getattr(api, "_force_close", False):
            return True   # already confirmed via the in-page sheet — let this close through
        threading.Thread(target=lambda: window.evaluate_js(
            "window.__onNativeCloseAttempt && window.__onNativeCloseAttempt()"), daemon=True).start()
        return False   # always veto here; the in-page sheet decides, then force-closes via the bridge
    events = getattr(window, "events", None)
    if events is not None and getattr(events, "closing", None) is not None:
        events.closing += _confirm_close
    # The document window is the app: when it goes, so must every secondary window it opened
    # (Help / About / Models / Insert / Toolbox / Gloss Mappings).  Hung off ``closed`` rather than
    # ``closing`` so a VETOED close (unsaved changes) doesn't tear them down, and so it can't run
    # twice for the one close.  api.close_all_child_windows does the destroying off this thread.
    if events is not None and getattr(events, "closed", None) is not None:
        def _close_children(*_a):
            # MUST return None: pywebview collects every handler's return value into a SET
            # (webview/event.py, ``return_values.add(value)``), so handing back
            # close_all_child_windows' {"ok": …} dict raises "unhashable type: 'dict'" and dumps a
            # traceback on every close.  The teardown itself still ran — the add() is what blew up —
            # but the noise is real, so swallow the result here.
            try:
                api.record_last_doc()   # …and remember this window's document (or that it had none) for the next launch — see main()'s startup fallback
            except Exception as exc:  # noqa: BLE001 — a state-write hiccup must never hold up a close
                print(f"[state] last document: {exc}", file=sys.stderr)
            api.close_all_child_windows()
        events.closed += _close_children

if __name__ == "__main__":
    main()
