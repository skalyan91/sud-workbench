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

from . import menu_spec
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


# ── item 14: "New Window" spawns a SECOND app process (a fresh, empty document) ──────────────────
# pywebview is single-window, so a genuinely-new window = a new `python -m app` process (no file arg →
# empty doc). It MUST be launched DETACHED (start_new_session → os.setsid), otherwise the background-job
# manager treats a child GUI process as part of this job and SIGKILLs it (see MEMORY: app-vanish-is-sigkill).
# Windows has no sessions and no setsid: `start_new_session=True` is silently ignored there, so the
# child would stay in this console's process group and die with a Ctrl-Break / job-object kill.
# DETACHED_PROCESS cuts it loose from the console and CREATE_NEW_PROCESS_GROUP from the group — the
# pair is the Win32 spelling of the same intent, hence one branch and not two code paths.
_DETACHED_PROCESS = 0x00000008
_CREATE_NEW_PROCESS_GROUP = 0x00000200


def _spawn_new_window() -> None:
    try:
        import subprocess
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        kwargs: dict = {}
        if IS_WIN:
            kwargs["creationflags"] = _DETACHED_PROCESS | _CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True   # os.setsid() → own session, not a reaped child
        subprocess.Popen(
            [sys.executable, "-m", "app"],
            cwd=repo_root,                      # so the `app` package is importable
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            **kwargs,
        )
    except Exception as exc:  # noqa: BLE001 — never crash the running window over a spawn failure
        print(f"[menu] new window spawn: {exc}", file=sys.stderr)


def build_menu(window, api=None) -> list[Menu]:
    """Turn app/menu_spec.py's table into pywebview's declarative Menu tree.

    PORTABLE ON PURPOSE — this touches no AppKit at all: pywebview builds the NSMenu from these
    objects, and app/mac/shell.py's _wire_menu then decorates the live items with key equivalents
    and SF Symbols from the SAME table.  A row's `js` string is what the Windows in-window menu bar
    invokes too, so neither platform owns a command."""
    def js(code: str):
        def action():
            try:
                window.evaluate_js(code)
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] {code!r} failed: {exc}", file=sys.stderr)
        return action

    def _toggle_fs_toolbar():
        """item 10: flip the 'always show toolbar in full screen' pref. The frontend owns + persists it;
        we flip the Python mirror (drives the checkmark) and let the JS toggle apply + save it."""
        menu_spec.toggle_fs_toolbar_mirror()
        def run():
            try:
                window.evaluate_js("window.__toggleFsAlwaysToolbar && __toggleFsAlwaysToolbar()")
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] fs toolbar toggle failed: {exc}", file=sys.stderr)
        threading.Thread(target=run, daemon=True).start()   # off-thread → evaluate_js can't self-deadlock on the main thread

    # The two rows the web layer cannot do alone: spawning a second PROCESS, and flipping the
    # Python-side mirror that draws the full-screen-toolbar checkmark.  Named in the table as
    # `action=`, resolved to a callable here.
    natives = {"new_window": _spawn_new_window, "toggle_fs_toolbar": _toggle_fs_toolbar}

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

    window = webview.create_window(
        "SUD Workbench",
        url=_url,
        js_api=api,
        width=1240,
        height=820,
        min_size=(1200, 560),   # keep the unified toolbar on one line (incl. traffic-light inset + search bar)
        # vibrancy is a Cocoa NSVisualEffectView and macOS-only; pywebview's winforms backend has no
        # such argument, and Windows' equivalent (Mica) is a DWM attribute set in app/win/dwm.py.
        **({"vibrancy": True} if IS_MAC else {}),
        background_color="#1e1e1e",
        text_select=True,
    )
    api.set_window(window)
    # "New Window" needs a PROCESS, which only the shell can spawn — handed to the bridge the same
    # way the titlebar re-measure and recent-menu refresh are, so api.py stays free of shell code.
    api._new_window = _spawn_new_window
    _warn_on_unsaved_close(window, api)
    _inject_path_info(window, api)   # window.__pathInfo — portable, both platforms

    if IS_MAC:
        from .mac import shell as mac_shell
        mac_shell._set_dock_icon_on_show(window)   # show the app's own Dock icon at runtime
        # let the api's recent-file recording live-rebuild the native Open Recent submenu
        mac_shell._recent_ctx["window"] = window
        mac_shell._recent_ctx["api"] = api
        api._recent_menu_refresh = lambda: mac_shell.refresh_recent_menu(window, api)
        # Under SUD_CHROME=win this ONE piece is suppressed, and it has to be: it places the real
        # traffic lights in-content and publishes --lights-cy/--lights-right, which the Fluent kit
        # neither reads nor leaves room for. Leaving it on puts three macOS window buttons on top of a
        # Windows title bar that draws its own caption buttons on the right — a chimera that
        # misrepresents both platforms, which is worse than not offering the preview at all.
        if _forced != "win":
            mac_shell._unify_titlebar_on_show(window, api)
        else:
            print("[chrome] SUD_CHROME=win — Fluent kit in a native window; macOS titlebar "
                  "unification skipped. The NSMenu is still macOS's, but its AppKit wiring rides "
                  "along with the unification and is skipped too, so this preview has no menu key "
                  "equivalents and no injected Cut/Copy/Paste. Mica/caption buttons are not "
                  "wired here (that is app/win/, and it needs Windows).", file=sys.stderr)
        mac_shell._enable_first_mouse()
    elif IS_WIN:
        from .win import shell as win_shell
        win_shell.install(window, api)
        # The in-window menu bar rebuilds its Open Recent flyout from api.recent_files() each time it
        # opens (js/ui/menubar.js), so there is nothing to retain and nothing to refresh here — the
        # native-NSMenu bookkeeping mac/shell.py needs exists only because pywebview has no rebuild API.
    elif IS_LINUX:
        from .linux import shell as linux_shell
        linux_shell.install(window, api)   # no-op today — native GTK title bar/menu land in later phases

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
    menu = build_menu(window, api) if IS_MAC else []
    # trace window teardown so a "vanished window" is attributed: did a close event fire, or did
    # the run loop just end? (logged to crash.log alongside the faulthandler/exception hooks)
    for _evname in ("closing", "closed"):
        _ev = getattr(getattr(window, "events", None), _evname, None)
        if _ev is not None:
            try:
                _ev += (lambda *_a, _n=_evname: _clog(f"=== window event: {_n} ==="))
            except Exception:  # noqa: BLE001
                pass
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
            api.close_all_child_windows()
        events.closed += _close_children

if __name__ == "__main__":
    main()
