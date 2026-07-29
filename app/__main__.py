"""pywebview bootstrap for SUD Workbench.

Creates the native macOS window (with vibrancy), builds the application menu,
loads the web frontend, and wires macOS open-file events.  The menu actions call
into the frontend's bridge-aware JS helpers so there is a single code path for
open/save/add-text whether they are triggered from the toolbar or the menu.
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

from .api import Api
from .paths import APP_DATA

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
INDEX = os.path.join(WEB_DIR, "index.html")

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
def _spawn_new_window() -> None:
    try:
        import subprocess
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        subprocess.Popen(
            [sys.executable, "-m", "app"],
            cwd=repo_root,                      # so the `app` package is importable
            start_new_session=True,             # os.setsid() → own session, not a reaped child
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:  # noqa: BLE001 — never crash the running window over a spawn failure
        print(f"[menu] new window spawn: {exc}", file=sys.stderr)


# ── item 10: "Always Show Toolbar in Full Screen" checkable pref ─────────────────────────────────
# The pref itself is owned + persisted by the frontend (PREFS.fsAlwaysToolbar in state.json); Python only
# mirrors it to drive the native menu item's checkmark. The mirror wins once the user toggles (the debounced
# JS save may not have hit disk yet); before any toggle we read the persisted value straight from state.json.
_fs_toolbar_mirror = {"on": None}


def _fs_always_toolbar_state() -> bool:
    if _fs_toolbar_mirror["on"] is not None:
        return bool(_fs_toolbar_mirror["on"])
    try:
        state_file = os.path.join(APP_DATA, "state.json")
        with open(state_file, encoding="utf-8") as fh:
            prefs = (json.load(fh) or {}).get("prefs") or {}
        return bool(prefs.get("fsAlwaysToolbar"))
    except Exception:  # noqa: BLE001 — no state yet / unreadable → default off
        return False


def build_menu(window, api=None) -> list[Menu]:
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
        _fs_toolbar_mirror["on"] = not _fs_always_toolbar_state()
        def run():
            try:
                window.evaluate_js("window.__toggleFsAlwaysToolbar && __toggleFsAlwaysToolbar()")
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] fs toolbar toggle failed: {exc}", file=sys.stderr)
        threading.Thread(target=run, daemon=True).start()   # off-thread → evaluate_js can't self-deadlock on the main thread

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

    return [
        Menu("File", [
            MenuAction("New", js("window.doNew && doNew()")),
            MenuAction("New Window", _spawn_new_window),   # item 14: fresh window + empty doc (detached process)
            MenuAction("Open…", js("window.doOpen && doOpen()")),
            Menu("Open Recent", _open_recent_items()),
            MenuAction("Append…", js("window.doAppend && doAppend()")),
            MenuAction("Insert Text…", js("window.addTextSheet && addTextSheet()")),
            MenuSeparator(),
            MenuAction("Import UD…", js("window.doImportUD && doImportUD()")),
            MenuAction("Import Toolbox…", js("window.doImportToolbox && doImportToolbox()")),
            MenuAction("Export as UD…", js("window.doExportUD && doExportUD()")),
            MenuSeparator(),
            MenuAction("Save", js("window.doSave && doSave()")),
            MenuAction("Save As…", js("window.doSaveAs && doSaveAs()")),
            MenuAction("Rename…", js("window.doRename && doRename()")),
        ]),
        Menu("Format", [
            MenuAction("Convert to SUD", js("window.convertTo && convertTo('SUD')")),
            # A RELABEL, not a conversion (there is no automatic SUD → mSUD grammar): it puts the live document
            # into mSUD annotation mode so the "/m" relations become available. See js/io/formats.js.
            MenuAction("Annotate as mSUD", js("window.annotateAsMSUD && annotateAsMSUD()")),
            MenuSeparator(),
            MenuAction("Manage Models…", js("window.manageModels && manageModels()")),
        ]),
        Menu("Edit", [
            MenuAction("Undo", js("window.undo && undo()")),
            MenuAction("Redo", js("window.redo && redo()")),
            MenuSeparator(),
            MenuAction("Find…", js("window.openFind && openFind()")),
            # Same bar, panel already down (js/ui/find.js openFindReplace) — so the toolbar, ⌘F and this
            # item all run one code path. Deliberately NOT in `conditional`: it opens the panel whatever
            # the document holds, so an always-enabled item is an honest one.
            MenuAction("Find and Replace…", js("window.openFindReplace && openFindReplace()")),
            # token actions — shown/hidden per selection + focused pane by Api.sync_menu (this separator too)
            MenuSeparator(),
            MenuAction("Group as Multi-word Token", js("window.groupMWTShortcut && groupMWTShortcut()")),
            # …and the destructive counterpart of it: Group lays a surface form OVER several tokens, Merge
            # replaces them with one. Adjacent in the menu because they take the same selection.
            MenuAction("Merge Tokens", js("window.mergeTokensShortcut && mergeTokensShortcut()")),
            MenuAction("Ungroup Multi-word Token", js("window.ungroupMWTShortcut && ungroupMWTShortcut()")),
            MenuAction("Split into Multi-word Token…", js("window.convertTokenMWT && convertTokenMWT()")),
            MenuAction("Flatten Multi-word Token", js("window.flattenTokenMWT && flattenTokenMWT()")),
            MenuAction("Move Token Left", js("window.moveTokenLeft && moveTokenLeft()")),
            MenuAction("Move Token Right", js("window.moveTokenRight && moveTokenRight()")),
            MenuAction("Move Token Up", js("window.moveTokenUp && moveTokenUp()")),
            MenuAction("Move Token Down", js("window.moveTokenDown && moveTokenDown()")),
            MenuAction("Insert Token Left", js("window.insertTokenLeft && insertTokenLeft()")),
            MenuAction("Insert Token Right", js("window.insertTokenRight && insertTokenRight()")),
            MenuAction("Insert Token Above", js("window.insertTokenAbove && insertTokenAbove()")),
            MenuAction("Insert Token Below", js("window.insertTokenBelow && insertTokenBelow()")),
            MenuAction("Select Previous Head", js("window.selectPrevHead && selectPrevHead()")),
            MenuAction("Select Next Head", js("window.selectNextHead && selectNextHead()")),
            MenuAction("Set as Root", js("window.setTokenAsRoot && setTokenAsRoot()")),
            # opens the same lemma popover a double-click on a token's form opens (js/editing/context-menu.js
            # editLemmaPrompt) — token-conditional like the rest of this group, shown/hidden by Api._apply_menu
            MenuAction("Edit Lemma…", js("window.editLemmaShortcut && editLemmaShortcut()")),
            # items 2/3 — marker FEATS on the selected token(s): checkable, state pushed by Api._apply_menu
            MenuAction("Mark as Foreign", js("window.toggleForeign && toggleForeign()")),
            MenuAction("Mark as Typo", js("window.toggleTypo && toggleTypo()")),
            MenuAction("Mark as Reported Speech", js("window.toggleReported && toggleReported()")),   # item 7 — MISC Reported=Yes on the head of the selection
            # sentence actions (folded in from the old Sentence menu) — insert/move/delete share the token
            # shortcuts and are shown only when a block is selected without a token; the rest are always available
            # item 2 — document/paragraph structure (universaldependencies.org/format.html). The first two act on
            # the sentence being read (`# newdoc` / `# newpar`) and are always available; the third writes MISC
            # NewPar=Yes on the selected TOKEN, for a paragraph that starts mid-sentence, so it is token-conditional.
            MenuSeparator(),
            MenuAction("Document Boundary", js("window.toggleDocBoundary && toggleDocBoundary()")),
            MenuAction("Paragraph Boundary", js("window.toggleParBoundary && toggleParBoundary()")),
            MenuAction("Paragraph Starts at Token", js("window.toggleTokenNewPar && toggleTokenNewPar()")),
            MenuSeparator(),
            MenuAction("Insert Sentence Before", js("window.insertSentBefore && insertSentBefore()")),
            MenuAction("Insert Sentence After", js("window.insertSentAfter && insertSentAfter()")),
            MenuAction("Move Sentence Up", js("window.moveSentUp && moveSentUp()")),
            MenuAction("Move Sentence Down", js("window.moveSentDown && moveSentDown()")),
            MenuAction("Delete Sentence", js("window.deleteSent && deleteSent()")),
            MenuSeparator(),
            MenuAction("Reset Parse", js("window.resetParse && resetParse()")),
            MenuAction("Export Diagram as SVG…", js("window.exportSentSVG && exportSentSVG()")),
        ]),
        Menu("View", [
            MenuAction("Zoom In", js("window.zoomIn && zoomIn()")),
            MenuAction("Zoom Out", js("window.zoomOut && zoomOut()")),
            MenuAction("Actual Size", js("window.zoomReset && zoomReset()")),
            MenuSeparator(),
            MenuAction("Toggle Grids", js("window.toggleGrids && toggleGrids()")),
            MenuAction("Merge Punctuation", js("window.toggleMergePunct && toggleMergePunct()")),
            MenuAction("Wrap Long Lines", js("window.toggleWrap && toggleWrap()")),
            MenuSeparator(),
            # item 12: the five diagram notations, bound to ⌘1–⌘5 (key-equivalents wired in _wire_menu; NO icons)
            MenuAction("Stemma", js("window.setNotation && setNotation('stemma')")),
            MenuAction("Hierarchy", js("window.setNotation && setNotation('tree')")),
            MenuAction("Arcs", js("window.setNotation && setNotation('arcs')")),
            MenuAction("Brackets", js("window.setNotation && setNotation('brackets')")),
            MenuAction("Outline", js("window.setNotation && setNotation('outline')")),
            MenuAction("Paged Layout", js("window.togglePageMode && togglePageMode()")),   # item 3 — checkable; state pushed by Api._apply_menu
            MenuSeparator(),
            MenuAction("Toggle Options Bar", js("window.toggleOptionsBar && toggleOptionsBar()")),
            # item 10: checkable — keep the toolbar visible in full screen (checkmark state set in _wire_menu)
            MenuAction("Always Show Toolbar in Full Screen", _toggle_fs_toolbar),
            MenuSeparator(),
            MenuAction("Switch Focus", js("window.switchFocusZone && switchFocusZone()")),
        ]),
        Menu("Help", [
            MenuAction("Help", js("window.openHelp && openHelp()")),
        ]),
    ]


# ── live-updating Open Recent submenu ────────────────────────────────────────
# pywebview builds the menu once at start with no rebuild API, so to keep "Open
# Recent" current within a session we reach into the running NSMenu and rebuild the
# submenu in place whenever the recent list changes.  A single shared PyObjC target
# handles the item actions; the tapped item carries its path in representedObject.
_recent_ctx: dict = {}          # {"window":…, "api":…} — filled in main()
_recent_target = None           # cached NSObject target (defined once)
_recent_target_tried = False


def _recent_menu_target():
    """Lazily create (once) the shared PyObjC target for rebuilt Open Recent items.
    Defining the ObjC subclass only once avoids duplicate-registration errors."""
    global _recent_target, _recent_target_tried
    if _recent_target is not None or _recent_target_tried:
        return _recent_target
    _recent_target_tried = True
    try:
        from Foundation import NSObject

        class _RecentMenuTarget(NSObject):
            def openRecent_(self, sender):          # ObjC selector: openRecent: (invoked on the MAIN thread)
                try:
                    path = sender.representedObject()
                    win = _recent_ctx.get("window")
                    if win is not None and path:
                        js = "window.openRecentFile && openRecentFile(%s)" % json.dumps(str(path))
                        # evaluate_js does callAfter + semaphore.acquire() → self-deadlocks if called on the
                        # main thread (this selector). Run it off-thread so the run loop can service it.
                        threading.Thread(target=lambda: win.evaluate_js(js), daemon=True).start()
                except Exception as exc:  # noqa: BLE001
                    print(f"[menu] open recent: {exc}", file=sys.stderr)

            def clearRecent_(self, sender):         # ObjC selector: clearRecent: (invoked on the MAIN thread)
                try:
                    api = _recent_ctx.get("api")
                    win = _recent_ctx.get("window")
                    if api is not None:
                        api.clear_recent()          # persists + triggers a live rebuild
                    if win is not None:
                        # off the main thread → evaluate_js's callAfter+acquire can't self-deadlock
                        threading.Thread(target=lambda: win.evaluate_js("window.toast && toast('Cleared recent files')"), daemon=True).start()
                except Exception as exc:  # noqa: BLE001
                    print(f"[menu] clear recent: {exc}", file=sys.stderr)

        _recent_target = _RecentMenuTarget.alloc().init()
    except Exception as exc:  # noqa: BLE001
        print(f"[menu] recent target: {exc}", file=sys.stderr)
        _recent_target = None
    return _recent_target


# ── About item in the application (program) menu ─────────────────────────────
# pywebview's declarative menu can't reach the app-name menu, so the About item is
# injected natively (in _wire_menu, which re-runs on every menu open). A single shared
# PyObjC target evaluates the frontend's openAbout() off the main thread (evaluate_js
# self-deadlocks if run on the main-thread selector — same caveat as the recent target).
_about_target = None
_about_target_tried = False


def _about_menu_target():
    global _about_target, _about_target_tried
    if _about_target is not None or _about_target_tried:
        return _about_target
    _about_target_tried = True
    try:
        from Foundation import NSObject

        class _AboutMenuTarget(NSObject):
            def showAbout_(self, sender):          # ObjC selector: showAbout: (invoked on the MAIN thread)
                try:
                    win = _recent_ctx.get("window")
                    if win is not None:
                        threading.Thread(target=lambda: win.evaluate_js("window.openAbout && openAbout()"), daemon=True).start()
                except Exception as exc:  # noqa: BLE001
                    print(f"[menu] about: {exc}", file=sys.stderr)

        _about_target = _AboutMenuTarget.alloc().init()
    except Exception as exc:  # noqa: BLE001
        print(f"[menu] about target: {exc}", file=sys.stderr)
        _about_target = None
    return _about_target


def _rebuild_recent_menu_main(window, api):
    """Rebuild the Open Recent submenu in place. MUST run on the AppKit main thread."""
    try:
        import AppKit
        app = AppKit.NSApp
        mainmenu = app.mainMenu() if app is not None else None
        if mainmenu is None:
            return
        submenu = None
        for i in range(mainmenu.numberOfItems()):          # File, Format, Edit, … → find "Open Recent"
            sub = mainmenu.itemAtIndex_(i).submenu()
            if sub is None:
                continue
            for j in range(sub.numberOfItems()):
                it = sub.itemAtIndex_(j)
                if it.title() == "Open Recent" and it.submenu() is not None:
                    submenu = it.submenu()
                    break
            if submenu is not None:
                break
        if submenu is None:
            return
        target = _recent_menu_target()
        try:
            recent = api.recent_files() if api is not None else []
        except Exception:  # noqa: BLE001
            recent = []
        submenu.removeAllItems()
        for path in recent:
            item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                os.path.basename(path), "openRecent:", "")
            item.setRepresentedObject_(path)
            if target is not None:
                item.setTarget_(target)
            submenu.addItem_(item)
        if recent:
            submenu.addItem_(AppKit.NSMenuItem.separatorItem())
        clear = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Clear Recent", "clearRecent:", "")
        if target is not None:
            clear.setTarget_(target)
        submenu.addItem_(clear)
    except Exception as exc:  # noqa: BLE001 — a menu-API hiccup must never break the app
        print(f"[menu] recent rebuild: {exc}", file=sys.stderr)


def refresh_recent_menu(window, api):
    """Marshal an Open Recent rebuild onto the AppKit main thread (callable from the bridge thread)."""
    def work():
        _rebuild_recent_menu_main(window, api)
    try:
        from PyObjCTools import AppHelper
        AppHelper.callAfter(work)   # NSMenu edits belong on the main thread
    except Exception:  # noqa: BLE001
        try:
            work()
        except Exception:  # noqa: BLE001
            pass


def _enable_first_mouse():
    """By default a WKWebView ignores the click that activates its window (acceptsFirstMouse → NO), so when the app
    is launched from the terminal (window opens behind the shell), the first click-drag on the diagram is swallowed
    by the activation. Override the class so that first click is delivered to the content."""
    try:
        import objc
        from WebKit import WKWebView

        class WKWebView(objc.Category(WKWebView)):   # pyobjc: a category's class name must match the class it extends
            def acceptsFirstMouse_(self, event):     # noqa: N802 — ObjC selector name
                return True
    except Exception as exc:  # noqa: BLE001 — non-fatal; drag still works once the window is active
        print(f"[firstmouse] could not enable: {exc}", file=sys.stderr)


# ── titlebar drag overlay ────────────────────────────────────────────────────
# WKWebView is WebKit, not Chromium: `-webkit-app-region:drag` does nothing, and the webview
# hit-tests and consumes every mouse-down in the transparent titlebar strip (the web content spans
# the full window because of fullSizeContentView), so setMovableByWindowBackground_ never gets the
# chance to move the window. The fix is a transparent AppKit view sitting ABOVE the webview whose
# -mouseDownCanMoveWindow returns YES; AppKit then moves the window when that view is dragged, with
# no need for movableByWindowBackground. The strip is full of interactive web controls (New/Open/…/
# Save/Undo/Redo on the left, a Model picker + guidelines link + search field on the right), so a
# full-width overlay would kill every button. We instead cover only the empty flexible gap
# (.titlebar .spring) between the two clusters — the same "drag by the empty toolbar space"
# affordance every macOS toolbar app has — measured from the live web layout and pinned in place
# with an autoresizing mask. The spring sits in the middle, far from the traffic lights, so the
# lights are never covered.
_titlebar_drag = {}   # window id -> overlay NSView (created once, repositioned as the window resizes)


def _drag_view_class():
    """Return (and cache) an NSView subclass that lets AppKit move the window when it is dragged."""
    cls = _titlebar_drag.get("__cls__")
    if cls is not None:
        return cls
    from AppKit import NSView

    class _SUDTitlebarDragView(NSView):   # pyobjc registers the ObjC subclass on first definition
        # The PASSIVE mouseDownCanMoveWindow path does NOT reliably move the window when the app hosts an
        # out-of-process WKWebView (WebKitHost) — the window server routes titlebar clicks past AppKit's
        # drag-region machinery. So we return NO there (let the mouseDown reach us) and EXPLICITLY start the
        # window drag with -[NSWindow performWindowDragWithEvent:] — the modern, reliable drag API. hitTest
        # already routes clicks in the empty titlebar gaps to this view, so mouseDown_ fires here.
        def mouseDownCanMoveWindow(self):        # noqa: N802 — ObjC selector
            return False

        def acceptsFirstMouse_(self, event):     # noqa: N802 — allow the drag even when the window isn't key
            return True

        def hitTest_(self, point):               # noqa: N802 — ObjC selector
            # item 3: while a titlebar context menu is open the frontend flips "__passthrough__" on, so this
            # overlay goes CLICK-THROUGH (return None) — a menu row opened AT the cursor over the drag region
            # then reaches the webview and stays clickable. Otherwise behave normally (win the titlebar-gap
            # hit-test so the empty space still drags the window).
            if _titlebar_drag.get("__passthrough__"):
                return None
            import objc
            return objc.super(_SUDTitlebarDragView, self).hitTest_(point)

        def mouseDown_(self, event):             # noqa: N802 — ObjC selector
            win = self.window()
            if win is not None and hasattr(win, "performWindowDragWithEvent_"):
                win.performWindowDragWithEvent_(event)
            else:
                try:
                    import objc
                    objc.super(_SUDTitlebarDragView, self).mouseDown_(event)
                except Exception:  # noqa: BLE001
                    pass

        def rightMouseDown_(self, event):        # noqa: N802 — right-click the empty titlebar → display-mode menu
            pywin = _titlebar_drag.get("__pywin__")
            nswin = self.window()
            if pywin is None or nswin is None or nswin.contentView() is None:
                return
            loc = event.locationInWindow()   # window coords (bottom-left origin)
            ch = nswin.contentView().bounds().size.height
            x, y = float(loc.x), float(ch - loc.y)   # → web coords (top-left origin)
            threading.Thread(
                target=lambda: pywin.evaluate_js("window.__tbContextMenu && __tbContextMenu(%.0f,%.0f)" % (x, y)),
                daemon=True).start()

    _titlebar_drag["__cls__"] = _SUDTitlebarDragView
    return _SUDTitlebarDragView


_file_icon = {}   # cache: "done" -> bool, "uri" -> file icon, "folder" -> generic folder icon, "root" -> volume icon


def _nsimage_to_datauri(AppKit, img):
    """Render an NSImage to a 40px PNG data-URI (or None)."""
    if img is None:
        return None
    try:
        img.setSize_((40.0, 40.0))
        tiff = img.TIFFRepresentation()
        if tiff is None:
            return None
        rep = AppKit.NSBitmapImageRep.imageRepWithData_(tiff)
        if rep is None:
            return None
        png_type = getattr(AppKit, "NSBitmapImageFileTypePNG", 4)   # NSBitmapImageFileTypePNG
        png = rep.representationUsingType_properties_(png_type, {})
        if png is None:
            return None
        return "data:image/png;base64," + str(png.base64EncodedStringWithOptions_(0))
    except Exception:  # noqa: BLE001
        return None


def _compute_file_icon(AppKit):
    """Ask macOS for the real Finder icon of the .conllu file type as a PNG data-URI (native proxy icon)."""
    try:
        ws = AppKit.NSWorkspace.sharedWorkspace()
        img = None
        try:  # modern API: NSWorkspace.iconForContentType: with a UTType for the extension
            import UniformTypeIdentifiers as UT
            ut = UT.UTType.typeWithFilenameExtension_("conllu")
            if ut is not None and hasattr(ws, "iconForContentType_"):
                img = ws.iconForContentType_(ut)
        except Exception:  # noqa: BLE001
            img = None
        if img is None and hasattr(ws, "iconForFileType_"):   # fallback for older macOS
            img = ws.iconForFileType_("conllu")
        return _nsimage_to_datauri(AppKit, img)
    except Exception as exc:  # noqa: BLE001 — never crash over a cosmetic icon
        print(f"[titlebar] file icon: {exc}", file=sys.stderr)
        return None


def _compute_folder_icons(AppKit):
    """Native NSWorkspace icons for the proxy folder-path menu: a generic folder icon and the boot-volume
    icon. Returns (folder_datauri, root_datauri)."""
    try:
        ws = AppKit.NSWorkspace.sharedWorkspace()
        folder = None
        try:
            import UniformTypeIdentifiers as UT
            ut = UT.UTType.typeWithIdentifier_("public.folder")
            if ut is not None and hasattr(ws, "iconForContentType_"):
                folder = ws.iconForContentType_(ut)
        except Exception:  # noqa: BLE001
            folder = None
        if folder is None:
            folder = ws.iconForFile_("/Library")   # any real folder → the generic folder icon
        root = ws.iconForFile_("/")                # boot volume (Macintosh HD) icon
        return _nsimage_to_datauri(AppKit, folder), _nsimage_to_datauri(AppKit, root)
    except Exception as exc:  # noqa: BLE001
        print(f"[titlebar] folder icons: {exc}", file=sys.stderr)
        return None, None


def _compute_symbol_icon(AppKit, name):
    """Render a real SF Symbol (``name``) to a thin, black-on-transparent PNG data-URI, for use as a CSS
    -webkit-mask so the titlebar glyph is pixel-for-pixel the SAME symbol the native menu uses (recolours
    via the mask's alpha). A Light symbol weight matches the harmonised ~1.7-stroke of the other titlebar icons."""
    try:
        NSImage = AppKit.NSImage
        if not hasattr(NSImage, "imageWithSystemSymbolName_accessibilityDescription_"):
            return None
        base = NSImage.imageWithSystemSymbolName_accessibilityDescription_(name, None)
        if base is None:
            return None
        img = base
        try:   # thin weight + a generous point size for a crisp mask
            weight = getattr(AppKit, "NSFontWeightLight", -0.4)   # fix 2: Light (was Thin) → the real Add Text / Manage symbols now match the harmonised 1.7-stroke CSS glyphs beside them (Thin read too thin)
            SymCfg = AppKit.NSImageSymbolConfiguration
            cfg = None
            if hasattr(SymCfg, "configurationWithPointSize_weight_scale_"):
                cfg = SymCfg.configurationWithPointSize_weight_scale_(64.0, weight, 2)   # scale = medium
            elif hasattr(SymCfg, "configurationWithPointSize_weight_"):
                cfg = SymCfg.configurationWithPointSize_weight_(64.0, weight)
            if cfg is not None:
                c2 = base.imageWithSymbolConfiguration_(cfg)
                if c2 is not None:
                    img = c2
        except Exception:  # noqa: BLE001
            img = base
        size = img.size()
        w = max(1, int(round(size.width)))
        h = max(1, int(round(size.height)))
        out = NSImage.alloc().initWithSize_((w, h))
        out.lockFocus()
        try:
            rect = ((0.0, 0.0), (float(w), float(h)))
            img.drawInRect_fromRect_operation_fraction_respectFlipped_hints_(
                rect, ((0.0, 0.0), (0.0, 0.0)), AppKit.NSCompositingOperationSourceOver, 1.0, True, None)
            AppKit.NSColor.blackColor().set()   # tint the drawn glyph solid black (SourceAtop) → clean mask alpha
            AppKit.NSRectFillUsingOperation(rect, AppKit.NSCompositingOperationSourceAtop)
        finally:
            out.unlockFocus()
        tiff = out.TIFFRepresentation()
        if tiff is None:
            return None
        rep = AppKit.NSBitmapImageRep.imageRepWithData_(tiff)
        if rep is None:
            return None
        png_type = getattr(AppKit, "NSBitmapImageFileTypePNG", 4)
        png = rep.representationUsingType_properties_(png_type, {})
        if png is None:
            return None
        return "data:image/png;base64," + str(png.base64EncodedStringWithOptions_(0))
    except Exception as exc:  # noqa: BLE001
        print(f"[titlebar] sf symbol {name!r}: {exc}", file=sys.stderr)
        return None


# NSMenuDelegate that re-applies our key-equivalents / SF Symbol images / conditional show-hide every time
# a submenu is about to open. pywebview periodically REBUILDS the NSMenu items underneath us (wiping key
# equivalents, images, and the api._menu references), so a one-shot wire at launch doesn't stick. The
# callback + delegate instance are stashed in this module-level dict so they survive GC — NSMenu holds its
# delegate weakly, so we must retain it ourselves.
_menu_delegate = {}   # "__cls__" -> class, "obj" -> retained delegate instance, "cb" -> Python re-wire callback

_win_activity = {}   # "__cls__" -> class, "obj" -> retained observer, "pywin" -> pywebview window

_win_fullscreen = {}   # "__cls__" -> class, "obj" -> retained observer, "pywin" -> pywebview window
_win_accent = {}   # item 9: "__cls__" -> class, "obj" -> retained observer, "pywin" -> pywebview window


def _install_fullscreen_observer(AppKit, nswin, pywin):
    """item 10: forward native macOS full-screen enter/exit to JS (window.__setFullscreen) so the web layer
    can auto-collapse the toolbar + options bar in full screen. Mirrors _install_activity_observer."""
    try:
        if _win_fullscreen.get("obj") is not None:
            return
        from Foundation import NSObject, NSNotificationCenter

        def _push(fs):
            threading.Thread(
                target=lambda: pywin.evaluate_js(
                    "window.__setFullscreen && __setFullscreen(%s)" % ("true" if fs else "false")),
                daemon=True).start()

        def _native_chrome(fs):
            # bug 9: in full screen the web layer draws AND auto-reveals its own titlebar/toolbar, so hide the empty
            # native unified NSToolbar while full screen. Left visible, macOS reveals a native titlebar/toolbar band
            # at the top edge that paints over the web titlebar's reveal AND swallows the pointer, so the web layer
            # never sees the mouse reach the top and its reveal never fires. Restore it on exit so the unified
            # titlebar + traffic lights come back. The full-screen notifications post on the Cocoa main thread, so
            # this runs there — where NSWindow/NSToolbar geometry may safely be touched.
            try:
                tb = nswin.toolbar()
                if tb is not None:
                    tb.setVisible_(not fs)
                # item 5: on EXIT, force the restored unified toolbar to lay out at once so the traffic lights
                # settle back to their windowed centre before the web titlebar re-measures — leaving it to the
                # next stray resize could re-read the still-collapsed metrics and keep the titlebar cramped. (The
                # JS side re-asserts its last good windowed --lights-cy/--lights-right as the primary guard.)
                if not fs and hasattr(nswin, "layoutIfNeeded"):
                    nswin.layoutIfNeeded()
            except Exception as exc:  # noqa: BLE001 — never crash over the full-screen bridge
                print(f"[titlebar] fullscreen native toolbar: {exc}", file=sys.stderr)

        cls = _win_fullscreen.get("__cls__")
        if cls is None:
            class _SUDFullscreenObserver(NSObject):
                def enteredFullScreen_(self, note):    # noqa: N802 — ObjC selector enteredFullScreen:
                    _native_chrome(True); _push(True)

                def exitedFullScreen_(self, note):     # noqa: N802 — ObjC selector exitedFullScreen:
                    _native_chrome(False); _push(False)
            cls = _SUDFullscreenObserver
            _win_fullscreen["__cls__"] = cls
        obs = cls.alloc().init()
        _win_fullscreen["obj"] = obs           # retain (NSNotificationCenter holds observers weakly-ish)
        _win_fullscreen["pywin"] = pywin
        nc = NSNotificationCenter.defaultCenter()
        nc.addObserver_selector_name_object_(obs, "enteredFullScreen:", AppKit.NSWindowDidEnterFullScreenNotification, nswin)
        nc.addObserver_selector_name_object_(obs, "exitedFullScreen:", AppKit.NSWindowDidExitFullScreenNotification, nswin)
        # seed the current state (in case the window is already full screen when this wires up)
        try:
            if nswin.styleMask() & AppKit.NSWindowStyleMaskFullScreen:
                _native_chrome(True); _push(True)
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001 — never crash over the full-screen bridge
        print(f"[titlebar] fullscreen observer: {exc}", file=sys.stderr)


def _install_accent_observer(AppKit, nswin, pywin):
    """item 9: recolour the relation categories when the SYSTEM ACCENT changes. WKWebView doesn't refresh
    the CSS ``AccentColor`` keyword live, so the web layer's poll can't see the change — observe
    NSSystemColorsDidChangeNotification, read the fresh ``NSColor.controlAccentColor`` (in sRGB) and push
    its RGB to ``window.__accentChanged``, which re-derives subj/comp/mod. Mirrors the other observers."""
    try:
        if _win_accent.get("obj") is not None:
            return
        from Foundation import NSObject, NSNotificationCenter

        def _push():
            try:
                col = AppKit.NSColor.controlAccentColor().colorUsingColorSpace_(
                    AppKit.NSColorSpace.sRGBColorSpace())
                r = int(round(col.redComponent() * 255))
                g = int(round(col.greenComponent() * 255))
                b = int(round(col.blueComponent() * 255))
            except Exception:  # noqa: BLE001 — accent unreadable (older macOS) → skip
                return
            threading.Thread(
                target=lambda: pywin.evaluate_js(
                    "window.__accentChanged && __accentChanged(%d,%d,%d)" % (r, g, b)),
                daemon=True).start()

        cls = _win_accent.get("__cls__")
        if cls is None:
            class _SUDAccentObserver(NSObject):
                def accentChanged_(self, note):    # noqa: N802 — ObjC selector accentChanged:
                    _push()
            cls = _SUDAccentObserver
            _win_accent["__cls__"] = cls
        obs = cls.alloc().init()
        _win_accent["obj"] = obs           # retain (NSNotificationCenter holds observers weakly-ish)
        _win_accent["pywin"] = pywin
        nc = NSNotificationCenter.defaultCenter()
        # system-wide (object=None): NSColor posts this when the accent/highlight preference changes
        nc.addObserver_selector_name_object_(obs, "accentChanged:", AppKit.NSSystemColorsDidChangeNotification, None)
    except Exception as exc:  # noqa: BLE001 — never crash over the accent bridge
        print(f"[titlebar] accent observer: {exc}", file=sys.stderr)


def _install_activity_observer(AppKit, nswin, pywin):
    """Dim the web toolbar when the window loses key focus (macOS inactive style). WKWebView has no
    :window-inactive, so we watch NSWindow become/resign-key and toggle .win-inactive over the bridge."""
    try:
        if _win_activity.get("obj") is not None:
            return
        from Foundation import NSObject, NSNotificationCenter

        def _push(active):
            threading.Thread(
                target=lambda: pywin.evaluate_js(
                    "window.__setWindowActive && __setWindowActive(%s)" % ("true" if active else "false")),
                daemon=True).start()

        cls = _win_activity.get("__cls__")
        if cls is None:
            class _SUDActivityObserver(NSObject):
                def windowBecameKey_(self, note):    # noqa: N802 — ObjC selector windowBecameKey:
                    _push(True)

                def windowResignedKey_(self, note):  # noqa: N802 — ObjC selector windowResignedKey:
                    _push(False)
            cls = _SUDActivityObserver
            _win_activity["__cls__"] = cls
        obs = cls.alloc().init()
        _win_activity["obj"] = obs           # retain (NSNotificationCenter holds observers weakly-ish)
        _win_activity["pywin"] = pywin
        nc = NSNotificationCenter.defaultCenter()
        nc.addObserver_selector_name_object_(obs, "windowBecameKey:", AppKit.NSWindowDidBecomeKeyNotification, nswin)
        nc.addObserver_selector_name_object_(obs, "windowResignedKey:", AppKit.NSWindowDidResignKeyNotification, nswin)
        # Seed the state, but NEVER dim at launch. A freshly-shown window may not be key YET (its
        # NSWindowDidBecomeKey can fire before this observer is registered, and a background-launched
        # process may not become frontmost at all), so seeding false here made the app OPEN looking
        # unfocused. Seed ACTIVE only; a genuine resign-key later dims it via the observer.
        if nswin.isKeyWindow():
            _push(True)
    except Exception as exc:  # noqa: BLE001 — never crash over a cosmetic dim
        print(f"[titlebar] activity observer: {exc}", file=sys.stderr)


def _menu_delegate_class():
    """Return (and cache) an NSMenuDelegate subclass that forwards menuNeedsUpdate: to a Python callback."""
    cls = _menu_delegate.get("__cls__")
    if cls is not None:
        return cls
    from AppKit import NSObject

    class _SUDMenuDelegate(NSObject):   # pyobjc registers the ObjC subclass on first definition
        def menuNeedsUpdate_(self, menu):        # noqa: N802 — ObjC selector; fires right before the submenu displays
            cb = _menu_delegate.get("cb")
            if cb is not None:
                try:
                    cb(menu)
                except Exception as exc:  # noqa: BLE001 — never break menu tracking over a cosmetic re-wire
                    print(f"[menu] delegate re-wire: {exc}", file=sys.stderr)

    _menu_delegate["__cls__"] = _SUDMenuDelegate
    return _SUDMenuDelegate


# Measure EVERY draggable empty region of the titlebar in CSS px (== window points, the webview is
# 1:1 with the window). The interactive controls (filename block, pills, model group, search) are
# excluded; the complement — the big flexible gap between the filename block and the controls, the
# small gaps between control clusters, and the trailing padding — is returned as a list of full-height
# [x, top, w, h] rects. The traffic-light zone (left of --lights-right) is never included so the OS
# window buttons stay live. Returns a list of rects (or null if the titlebar isn't laid out yet).
_DRAG_MEASURE_JS = r"""
(function(){
  try{
    var tb=document.querySelector('.titlebar'); if(!tb) return null;
    var tr=tb.getBoundingClientRect(); if(tr.width<=0) return null;
    var cs=getComputedStyle(document.documentElement);
    var lr=parseFloat(cs.getPropertyValue('--lights-right'))||82;
    var left=tr.left+lr, right=tr.right;
    // horizontal spans occupied by interactive controls (clamped to the draggable band)
    var occ=[];
    tb.querySelectorAll('.tbfile,.tbgroup,.tbpill,.tgroup,.tbsearch').forEach(function(el){
      if(el.getClientRects().length===0) return;
      var r=el.getBoundingClientRect(); if(r.width<=0) return;
      var a=Math.max(left,r.left), b=Math.min(right,r.right);
      if(b>a) occ.push([a,b]);
    });
    occ.sort(function(p,q){return p[0]-q[0];});
    var merged=[]; occ.forEach(function(r){
      if(merged.length && r[0]<=merged[merged.length-1][1]+0.5) merged[merged.length-1][1]=Math.max(merged[merged.length-1][1],r[1]);
      else merged.push([r[0],r[1]]);
    });
    // gaps = the complement of the occupied spans within [left,right]
    var gaps=[], cur=left;
    merged.forEach(function(m){ if(m[0]-cur>=8) gaps.push([cur,m[0]]); cur=Math.max(cur,m[1]); });
    if(right-cur>=8) gaps.push([cur,right]);
    if(!gaps.length) return null;
    return gaps.map(function(g){ return [g[0], tr.top, g[1]-g[0], tr.height]; });
  }catch(e){ return null; }
})()
"""


def _apply_titlebar_drag(window, rects):
    """Create/position the drag overlays from measured rects (main-thread work). ``rects`` is a list of
    [x, top, w, h] gap rects (a bare 4-number rect is accepted too, for backward compatibility)."""
    if not rects:
        return
    if len(rects) == 4 and all(isinstance(v, (int, float)) for v in rects):
        rects = [rects]
    rects = [r for r in rects if r and len(r) == 4]
    if not rects:
        return
    _titlebar_drag["__pywin__"] = window   # so the overlay's right-click can call back into the web layer

    def work():
        try:
            import AppKit
            nswin = window.native
            if nswin is None:
                return
            frame = nswin.contentView().superview()   # NSThemeFrame: spans the full window, bottom-left origin
            if frame is None:
                return
            fh = frame.bounds().size.height
            key = id(window)
            pool = _titlebar_drag.get(key)
            if not isinstance(pool, list):
                pool = []
                _titlebar_drag[key] = pool
            cls = _drag_view_class()
            for i, rc in enumerate(rects):
                x, top, w, h = (float(v) for v in rc)
                y = fh - (top + h)   # web coords are top-down; convert to AppKit's bottom-up origin
                if i < len(pool):
                    view = pool[i]
                    if view.superview() is None:
                        frame.addSubview_positioned_relativeTo_(view, AppKit.NSWindowAbove, None)
                else:
                    view = cls.alloc().initWithFrame_(((x, y), (w, h)))
                    # top edge fixed → NSViewMinYMargin keeps each overlay pinned to the titlebar; the exact
                    # widths are re-measured on resize / reflow, so no width autoresizing is needed.
                    view.setAutoresizingMask_(AppKit.NSViewMinYMargin)
                    frame.addSubview_positioned_relativeTo_(view, AppKit.NSWindowAbove, None)  # win the hit-test
                    pool.append(view)
                view.setFrame_(((x, y), (w, h)))
                view.setHidden_(False)
            for j in range(len(rects), len(pool)):   # park any surplus overlays from a busier previous layout
                pool[j].setHidden_(True)
                pool[j].setFrame_(((0, 0), (0, 0)))
        except Exception as exc:  # noqa: BLE001 — never crash over a cosmetic overlay
            print(f"[titlebar] drag overlay: {exc}", file=sys.stderr)

    try:
        from PyObjCTools import AppHelper
        AppHelper.callAfter(work)   # NSView geometry belongs on the Cocoa main thread
    except Exception:  # noqa: BLE001
        work()


_APP_ICONS: dict = {}       # {"light"|"dark": NSImage|False} — cached per appearance
_THEME_OBSERVER = None      # distributed-notification token; kept alive so the observation persists


def _appearance_is_dark() -> bool:
    """True when the app's effective appearance is Dark Aqua (so the Dock/alert icon should use the
    dark artwork). Safe before NSApp exists (returns False)."""
    try:
        import AppKit
        app = AppKit.NSApp
        appr = app.effectiveAppearance() if app is not None else None
        if appr is None:
            return False
        best = appr.bestMatchFromAppearancesWithNames_(
            [AppKit.NSAppearanceNameAqua, AppKit.NSAppearanceNameDarkAqua])
        return best == AppKit.NSAppearanceNameDarkAqua
    except Exception:  # noqa: BLE001
        return False


def _app_icon(dark=None):
    """The app icon as an NSImage (cached), loaded from the bundled PNG for the current (or given)
    appearance. Needed explicitly because the bundle isn't recognised as NSBundle.mainBundle() —
    the launcher execs a Python living in Contents/Resources, so alerts have NO bundle icon to fall
    back to. Used for both the Dock icon and each NSAlert's icon."""
    if dark is None:
        dark = _appearance_is_dark()
    key = "dark" if dark else "light"
    if key not in _APP_ICONS:
        try:
            import AppKit
            base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
            path = os.path.join(base, "appicon-dark.png" if dark else "appicon.png")
            if not os.path.exists(path):                # no dark variant shipped -> fall back to light
                path = os.path.join(base, "appicon.png")
            _APP_ICONS[key] = AppKit.NSImage.alloc().initWithContentsOfFile_(path) or False
        except Exception as exc:  # noqa: BLE001
            print(f"[icon] {exc}", file=sys.stderr)
            _APP_ICONS[key] = False
    return _APP_ICONS[key] or None


def _set_dock_icon_on_show(window):
    """Set the Dock / app icon at runtime from the bundled PNG, so the app shows its own icon
    regardless of how it was launched (the thin `.app` launcher, or `python -m app`) — picking the
    Light or Dark artwork by system appearance and re-applying when the user toggles the theme.
    NSApp only exists once the run loop starts, so this runs on the window's shown/loaded event."""
    def apply(*_):
        try:
            import AppKit
            app = AppKit.NSApp
            img = _app_icon(dark=_appearance_is_dark())
            if img is not None and app is not None:
                app.setApplicationIconImage_(img)   # Dock + the default icon for pywebview's NSAlert dialogs
        except Exception as exc:  # noqa: BLE001
            print(f"[icon] {exc}", file=sys.stderr)

    def first(*_):
        apply()
        global _THEME_OBSERVER
        if _THEME_OBSERVER is None:
            try:
                import AppKit
                # macOS posts this on every Light/Dark switch; re-pick the matching icon each time.
                _THEME_OBSERVER = AppKit.NSDistributedNotificationCenter.defaultCenter() \
                    .addObserverForName_object_queue_usingBlock_(
                        "AppleInterfaceThemeChangedNotification", None,
                        AppKit.NSOperationQueue.mainQueue(), lambda _note: apply())
            except Exception as exc:  # noqa: BLE001
                print(f"[icon] {exc}", file=sys.stderr)

    events = getattr(window, "events", None)
    hooked = False
    for name in ("shown", "loaded"):
        ev = getattr(events, name, None) if events is not None else None
        if ev is not None:
            ev += first
            hooked = True
    if not hooked:
        first()


def main(argv: list[str] | None = None):
    argv = sys.argv[1:] if argv is None else argv
    # Put the on-demand extras dir on sys.path FIRST, so any heavy stack (Stanza/torch, Japanese,
    # Arabic) the user installed after shipping imports before its first lazy use.
    try:
        from . import extras
        extras.activate()
    except Exception:  # noqa: BLE001
        pass
    # Name the process so the menu-bar app name reads "SUD Workbench" (not "Python") when launched
    # outside a code-signed bundle — must happen before the NSApplication menu is built.
    try:
        import Foundation
        Foundation.NSProcessInfo.processInfo().setProcessName_("SUD Workbench")
    except Exception:  # noqa: BLE001
        pass
    api = Api()

    # a file path passed on the command line (or by a macOS open-file event)
    # becomes the initial document
    for arg in argv:
        if arg.lower().endswith((".conllu", ".conll")) and os.path.exists(arg):
            api.path = os.path.abspath(arg)
            break

    window = webview.create_window(
        "SUD Workbench",
        url=INDEX,
        js_api=api,
        width=1240,
        height=820,
        min_size=(1200, 560),   # keep the unified toolbar on one line (incl. traffic-light inset + search bar)
        vibrancy=True,
        background_color="#1e1e1e",
        text_select=True,
    )
    api.set_window(window)
    _set_dock_icon_on_show(window)   # show the app's own Dock icon at runtime
    # let the api's recent-file recording live-rebuild the native Open Recent submenu
    _recent_ctx["window"] = window
    _recent_ctx["api"] = api
    api._recent_menu_refresh = lambda: refresh_recent_menu(window, api)
    _warn_on_unsaved_close(window, api)
    _unify_titlebar_on_show(window, api)
    _enable_first_mouse()

    menu = build_menu(window, api)
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


def _unify_titlebar_on_show(window, api=None):
    """Merge the app's toolbar into the macOS title bar: make the title bar
    transparent, hide its text, let the web content fill up under it (so the
    toolbar sits in the same bar as the traffic lights), and allow the window to
    be dragged by its background. Runs once the native NSWindow exists."""
    NS_TITLE_HIDDEN = 1
    NS_FULL_SIZE_CONTENT = 1 << 15

    state = {"toolbar": False}

    _LIGHT_TOP = 20.0   # px of air above the traffic lights. The title bar height follows from it (2 × the resulting centre-y) — see the note inside _place_lights.

    def _place_lights(nswin, AppKit):
        """Give the window an empty unified NSToolbar — macOS grows the title bar and
        centres the traffic lights within it, while fullSizeContentView keeps the web
        content full-bleed underneath. Then measure where the lights actually landed
        and return the JS handing that to the web toolbar."""
        try:
            if not state["toolbar"]:
                try:
                    tb = AppKit.NSToolbar.alloc().initWithIdentifier_("sud-unified")
                    tb.setShowsBaselineSeparator_(False)
                    nswin.setToolbar_(tb)
                    if hasattr(nswin, "setToolbarStyle_"):
                        nswin.setToolbarStyle_(3)   # NSWindowToolbarStyleUnified — the STANDARD (Windows/Toolbar) taller ~44px unified titlebar; lights re-centre, --lights-cy re-measures
                    state["toolbar"] = True
                    if hasattr(nswin, "layoutIfNeeded"):
                        nswin.layoutIfNeeded()
                except Exception as exc:  # noqa: BLE001
                    print(f"[titlebar] toolbar: {exc}", file=sys.stderr)
            cv = nswin.contentView()
            close = nswin.standardWindowButton_(0)
            zoom = nswin.standardWindowButton_(2)
            if cv is None or close is None:
                return None
            # THE LIGHTS SIT LOWER THAN THE OS PUTS THEM, and that is also what makes the title bar taller: the web
            # bar's min-height is calc(--lights-cy * 2) (macos-kit/mac-chrome.css), so the centre published below is
            # the ONE number that sets both.  The spec is _LIGHT_TOP px of air ABOVE the buttons; the bar that falls
            # out of it is 2 x (top + height/2), i.e. 52px for macOS's 12px buttons.
            #
            # STATED AS AN ABSOLUTE TARGET, NOT AS A DROP, and that is the whole reason the lights stay put.  This
            # routine re-runs on every resize (macOS re-places the buttons itself each time the toolbar lays out),
            # so a RELATIVE nudge — "4px lower than wherever they are" — compounds: the lights march down the window
            # one step per resize, and after a few they are off the bar entirely.  Setting the top to a fixed 20px
            # is idempotent: run it once or fifty times and the buttons land in the same place, whether macOS has
            # reset them in between or not.
            # The frames are moved in the buttons' OWN superview (the window's theme frame), whose flippedness is
            # ASKED FOR rather than assumed — an unflipped view counts y upward from the bottom, so a top-anchored
            # target has to be converted before it means anything, and guessing wrong puts the lights off-window.
            win_h = cv.frame().size.height
            try:
                sup = close.superview()
                sup_h = sup.frame().size.height if sup is not None else win_h
                flipped = bool(sup is not None and sup.isFlipped())
                for _i in (0, 1, 2):
                    _b = nswin.standardWindowButton_(_i)
                    if _b is None:
                        continue
                    _f = _b.frame()
                    # y that puts the button's TOP edge exactly _LIGHT_TOP below the superview's top edge
                    _y = _LIGHT_TOP if flipped else (sup_h - _LIGHT_TOP - _f.size.height)
                    _b.setFrameOrigin_(AppKit.NSMakePoint(_f.origin.x, _y))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] light place: {exc}", file=sys.stderr)   # a failed placement is cosmetic: the bar keeps the OS height, nothing breaks
            r = close.convertRect_toView_(close.bounds(), cv)
            cy = r.origin.y + r.size.height / 2.0
            if cy > win_h / 2:            # content view not flipped → convert to top-down
                cy = win_h - cy
            right = 78.0
            if zoom is not None:
                rz = zoom.convertRect_toView_(zoom.bounds(), cv)
                right = rz.origin.x + rz.size.width
            return (
                "document.documentElement.style.setProperty('--lights-cy','%.1fpx');"
                "document.documentElement.style.setProperty('--lights-right','%.1fpx');"
                % (cy, right + 14)
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] light place: {exc}", file=sys.stderr)
            return None

    def _wire_menu(AppKit):
        """Give the menu items native key-equivalents and SF Symbol icons."""
        try:
            app = AppKit.NSApp
            mainmenu = app.mainMenu() if app is not None else None
            if mainmenu is None:
                return
            cmd, shift = AppKit.NSEventModifierFlagCommand, AppKit.NSEventModifierFlagShift
            ctrl = AppKit.NSEventModifierFlagControl
            alt = AppKit.NSEventModifierFlagOption
            larrow, rarrow = chr(0xF702), chr(0xF703)   # NSLeft/RightArrowFunctionKey
            uarrow, darrow = chr(0xF700), chr(0xF701)   # NSUp/DownArrowFunctionKey
            specs = {
                "New": ("n", cmd | shift, "square.and.pencil"),   # ⇧⌘N — ⌘N is now New Window (item 14)
                "New Window": ("n", cmd, "macwindow.badge.plus"),   # item 14: ⌘N opens a fresh window + empty doc
                "Open": ("o", cmd, "folder"),
                "Open Recent": (None, 0, "clock.arrow.circlepath"),   # submenu parent (no key-equivalent)
                "Append": ("o", cmd | shift, "plus.rectangle.on.folder"),
                "Insert Text": ("t", cmd, "text.badge.plus"),
                "Save": ("s", cmd, "square.and.arrow.down"),
                "Save As": ("s", cmd | shift, "square.and.arrow.down.on.square"),
                "Rename": ("r", cmd | shift, "pencil"),
                "Import UD": ("i", cmd | shift, "square.and.arrow.down.on.square"),   # ⇧⌘I — ⌘I is now Mark as Foreign
                "Export as UD": ("e", cmd | shift, "square.and.arrow.up.on.square"),
                "Manage Models": ("m", cmd | shift, "cube.box"),
                "Convert to SUD": (None, 0, "arrow.triangle.2.circlepath"),
                "Convert to mSUD": (None, 0, "arrow.triangle.2.circlepath"),
                "Undo": ("z", cmd, "arrow.uturn.backward"),
                "Redo": ("z", cmd | shift, "arrow.uturn.forward"),
                "Zoom In": ("+", cmd, "plus.magnifyingglass"),
                "Zoom Out": ("-", cmd, "minus.magnifyingglass"),
                "Actual Size": ("0", cmd, "1.magnifyingglass"),
                "Toggle Grids": ("g", ctrl | cmd, "tablecells"),
                "Merge Punctuation": (".", cmd, "arrow.triangle.merge"),
                "Wrap Long Lines": ("l", ctrl | cmd, "text.append"),
                "Toggle Options Bar": ("o", ctrl | cmd, "slider.horizontal.3"),   # same glyph as the toolbar's #btnOptions button
                # item 3 — ⌃⌘P joins the View menu's own ⌃⌘ family (⌃⌘G grids, ⌃⌘L wrap, ⌃⌘O options bar)
                "Paged Layout": ("p", ctrl | cmd, "rectangle.portrait.center.inset.filled"),   # item 7: the SAME symbol the toolbar's Paged segment now wears — doc.text drew a page of prose, which is what the document IS in both modes, not what this command chooses
                # item 2 — the boundary commands take ⇧⌘D / ⇧⌘P, both free (the ⌘D and ⌘R families are already
                # spent on Duplicate Sentence and Reset Parse), and the mid-sentence one adds ⌥ to its own pair
                "Document Boundary": ("d", cmd | shift, "text.book.closed"),
                "Paragraph Boundary": ("p", cmd | shift, "paragraphsign"),
                "Paragraph Starts at Token": ("p", cmd | shift | alt, "paragraphsign"),
                "Switch Focus": ("\\", cmd, "arrow.up.arrow.down"),
                # item 12: the five notations on ⌘1–⌘5 — NO SF Symbol (user asked for no icons)
                "Stemma": ("1", cmd, None),
                "Hierarchy": ("2", cmd, None),
                "Arcs": ("3", cmd, None),
                "Brackets": ("4", cmd, None),
                "Outline": ("5", cmd, None),
                "Find": ("f", cmd, "magnifyingglass"),
                "Find and Replace": ("f", cmd | alt, "text.magnifyingglass"),   # ⌥⌘F — the macOS standard (TextEdit, Pages, Xcode all bind Find and Replace there)
                "Group as Multi-word Token": ("g", cmd, "arrow.right.and.line.vertical.and.arrow.left"),
                "Ungroup Multi-word Token": ("g", cmd | shift, "arrow.left.and.line.vertical.and.arrow.right"),
                "Split into Multi-word Token": ("s", cmd | alt, "square.split.2x1"),   # ⌥⌘S — "split"
                # MOVED off ⌥⌘F, which Find and Replace above now holds. The collision was not survivable:
                # AppKit matches a key equivalent against the FIRST eligible item in menu order, and Find and
                # Replace sits above this one in the Edit menu — so ⌥⌘F would have flattened nothing and this
                # item's shortcut would have been dead exactly when an MWT was selected and it became visible
                # (a hidden item is skipped, which is what would have masked the clash in casual testing).
                # ⌥⌘G puts it beside its own family instead — ⌘G group, ⇧⌘G ungroup, ⌥⌘G flatten.
                "Flatten Multi-word Token": ("g", cmd | alt, "square.split.1x2"),
                # ⌃⌘M, checked against every other binding in this dict (⌘M is the system Minimize; ⌥⌘M and
                # ⇧⌘M are free too, but ⌃⌘ is already this app's modifier for the token-STRUCTURAL commands —
                # ⌃⌘←→↑↓ move, ⌃⌘[ ] re-head, ⌃⌘R set as root — and a merge is one of those, not an MWT command.
                "Merge Tokens": ("m", ctrl | cmd, "arrow.trianglehead.merge"),
                "Move Token Left": (larrow, ctrl | cmd, "arrow.left"),
                "Move Token Right": (rarrow, ctrl | cmd, "arrow.right"),
                "Move Token Up": (uarrow, ctrl | cmd, "arrow.up"),
                "Move Token Down": (darrow, ctrl | cmd, "arrow.down"),
                "Insert Token Left": (larrow, cmd | alt, "arrow.left.to.line"),
                "Insert Token Right": (rarrow, cmd | alt, "arrow.right.to.line"),
                "Insert Token Above": (uarrow, cmd | alt, "arrow.up.to.line"),
                "Insert Token Below": (darrow, cmd | alt, "arrow.down.to.line"),
                "Select Previous Head": ("[", ctrl | cmd, "chevron.left.2"),   # RTL-flipped in Api._apply_menu
                "Select Next Head": ("]", ctrl | cmd, "chevron.right.2"),
                "Set as Root": ("r", ctrl | cmd, "asterisk.circle"),
                "Edit Lemma": ("l", cmd, "character.book.closed"),   # ⌘L — free: "Wrap Long Lines" already spent ⌃⌘L, plain ⌘L is unused (no browser-style "location bar" in this app)
                "Mark as Foreign": ("i", cmd, "globe"),          # ⌘I — FEATS Foreign=Yes, drawn as an italic form (Import UD moved to ⇧⌘I)
                "Mark as Typo": ("/", cmd, "exclamationmark.bubble"),   # ⌘/ — FEATS Typo=Yes, drawn as a struck-through form
                "Mark as Reported Speech": ("'", cmd | shift, "quote.bubble"),   # ⇧⌘' — item 7
                "Insert Sentence Before": (uarrow, alt | cmd, "arrow.up.to.line"),   # ⌥⌘↑ — same as Insert Token Above (mutually exclusive by selection)
                "Insert Sentence After": (darrow, alt | cmd, "arrow.down.to.line"),   # ⌥⌘↓
                "Move Sentence Up": (uarrow, ctrl | cmd, "arrow.up"),   # ⌃⌘↑ — same as Move Token Up
                "Move Sentence Down": (darrow, ctrl | cmd, "arrow.down"),   # ⌃⌘↓
                "Delete Sentence": (chr(0x08), cmd, "trash"),   # ⌘⌫ — same context-delete as tokens
                "Duplicate Sentence": ("d", cmd, "plus.square.on.square"),   # ⌘D
                "Reset Parse": ("r", cmd, "arrow.clockwise"),   # ⌘R (always enabled → intercepts before the web view's reload)
                "Regenerate Annotations": ("r", cmd | alt, "sparkles"),   # ⌥⌘R — only with a parser model selected
                "Export Diagram as SVG": ("e", cmd | alt, "square.and.arrow.up"),   # ⌥⌘E
                "Import Toolbox": (None, 0, "list.bullet.rectangle"),   # interlinear Toolbox import (no key equivalent)
                "Help": (None, 0, "questionmark.circle"),   # Help menu item + symbol, but NO explicit key-equivalent (item 26)
            }
            # Items that are ALWAYS shown but carry a checkmark Api._apply_menu keeps in step. They need a
            # menu_map entry for the same reason the conditional ones do (that dict is how api.py reaches an
            # NSMenuItem at all) — but must never be hidden, so they take their own branch below.
            checkable = {"Document Boundary", "Paragraph Boundary", "Paged Layout"}
            has_sym = hasattr(AppKit.NSImage, "imageWithSystemSymbolName_accessibilityDescription_")
            # the token-action items are shown/hidden per selection (Api.sync_menu); collect them + their leading separator
            conditional = {
                "Group as Multi-word Token", "Ungroup Multi-word Token", "Merge Tokens",
                "Split into Multi-word Token", "Flatten Multi-word Token",
                "Move Token Left", "Move Token Right", "Move Token Up", "Move Token Down",
                "Insert Token Left", "Insert Token Right", "Insert Token Above", "Insert Token Below",
                "Select Previous Head", "Select Next Head", "Set as Root", "Edit Lemma",
                "Mark as Foreign", "Mark as Typo", "Mark as Reported Speech",   # items 2/3/7: token-only, like the rest of this group
                "Insert Sentence Before", "Insert Sentence After",   # block-only: shown when a block is selected without a token
                "Move Sentence Up", "Move Sentence Down", "Delete Sentence",
                "Regenerate Annotations",   # only when a parser model is selected
                "Wrap Long Lines",   # View-menu item shown only in arc/bracket notations
                "Paragraph Starts at Token",   # item 2: MISC NewPar=Yes is token-scoped, so it needs a token
            }
            menu_map: dict = {}
            for i in range(mainmenu.numberOfItems()):
                sub = mainmenu.itemAtIndex_(i).submenu()
                if sub is None:
                    continue
                prev_sep = None
                for j in range(sub.numberOfItems()):
                    it = sub.itemAtIndex_(j)
                    if it.isSeparatorItem():
                        prev_sep = it
                        continue
                    title = it.title().replace("…", "").strip()
                    if title in conditional:
                        menu_map[title] = it
                        it.setHidden_(True)                    # start hidden (nothing selected yet)
                        if title == "Group as Multi-word Token" and prev_sep is not None:
                            menu_map["__sep_tokens__"] = prev_sep
                            prev_sep.setHidden_(True)
                    elif title in checkable:
                        menu_map[title] = it
                    if title == "Always Show Toolbar in Full Screen":
                        it.setState_(1 if _fs_always_toolbar_state() else 0)   # item 10: reflect the persisted pref as a checkmark
                    spec = specs.get(title)
                    if not spec:
                        continue
                    key, mask, symbol = spec
                    if key:
                        it.setKeyEquivalent_(key)
                        it.setKeyEquivalentModifierMask_(mask)
                    if symbol and has_sym:
                        img = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_(symbol, None)
                        if img is not None:
                            it.setImage_(img)
            # inject "About SUD Workbench" at the top of the application (program) menu, idempotently
            # (this whole function re-runs on every menu open, so guard against a duplicate insert)
            try:
                appmenu = mainmenu.itemAtIndex_(0).submenu() if mainmenu.numberOfItems() > 0 else None
                if appmenu is not None:
                    # The bold application menu (top-left) and its "About …"/"Hide …"/"Quit …" items are
                    # derived by AppKit from the host bundle's CFBundleName — which, running unbundled under a
                    # Homebrew Python, is "Python", so setProcessName_ alone doesn't reach them. Rename them
                    # here (this runs on every menu open AND once at startup via _mutate, so it re-asserts if
                    # pywebview rebuilds the menu). We set the first item's title (the bold menu-bar name) and
                    # the app submenu's title, then swap "Python" → "SUD Workbench" in the About/Hide/Quit items.
                    mainmenu.itemAtIndex_(0).setTitle_("SUD Workbench")
                    appmenu.setTitle_("SUD Workbench")
                    for _k in range(appmenu.numberOfItems()):
                        _mi = appmenu.itemAtIndex_(_k)
                        _t = _mi.title()
                        if _t and "Python" in _t:
                            _mi.setTitle_(_t.replace("Python", "SUD Workbench"))
                # Point the About item at OUR panel. Keyed on the item's ACTION, never on its title: the rename
                # loop just above turns AppKit's default "About Python" into "About SUD Workbench", so a
                # title-based guard (`indexOfItemWithTitle_("About SUD Workbench") < 0`) matched the DEFAULT item
                # and concluded ours was already installed — it never was. The menu then showed the right title
                # over orderFrontStandardAboutPanel:, i.e. Python's own About panel.
                # Retarget the existing item rather than inserting a second one: the default About is already in
                # the right place with the right separator after it, and _wire_menu re-runs on EVERY menu open
                # (pywebview rebuilds these items underneath us), so this must be idempotent — which it is, since
                # an item already carrying showAbout: is left alone.
                if appmenu is not None:
                    tgt = _about_menu_target()
                    if tgt is not None:
                        for _k in range(appmenu.numberOfItems()):
                            _mi = appmenu.itemAtIndex_(_k)
                            _act = _mi.action()
                            if _act is None or str(_act) != "orderFrontStandardAboutPanel:":
                                continue
                            _mi.setTitle_("About SUD Workbench")
                            _mi.setAction_("showAbout:")
                            _mi.setTarget_(tgt)
                            if has_sym:
                                aimg = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_("info.circle", None)
                                if aimg is not None:
                                    _mi.setImage_(aimg)
                            break
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] about inject: {exc}", file=sys.stderr)
            if api is not None:
                api._menu = menu_map
        except Exception as exc:  # noqa: BLE001
            print(f"[menu] wiring: {exc}", file=sys.stderr)

    # Cache the frontend's last-reported selection state so the menu delegate can re-apply conditional
    # show/hide synchronously when a menu opens (without a round-trip to JS). We wrap the api's own
    # _apply_menu at runtime: sync_menu() calls self._apply_menu(st), which resolves this instance
    # attribute, so every state push flows through here and is remembered.
    if api is not None and not getattr(api, "_apply_menu_wrapped", False):
        _orig_apply_menu = api._apply_menu

        def _apply_menu_caching(st, _orig=_orig_apply_menu):
            try:
                api._last_menu_state = dict(st or {})
            except Exception:  # noqa: BLE001
                pass
            return _orig(st)

        api._apply_menu = _apply_menu_caching
        api._apply_menu_wrapped = True

    def _menu_reapply(menu):
        """menuNeedsUpdate callback (main thread): re-wire key-equivalents + SF Symbol images across the
        menu bar and re-assert the conditional show/hide from the last-known selection state. Runs on every
        submenu open, so it beats whatever pywebview did to the items underneath us."""
        import AppKit
        _wire_menu(AppKit)   # re-applies key equivalents + images and rebuilds api._menu from the live items
        if api is not None:
            st = getattr(api, "_last_menu_state", None) or {}
            try:
                api._apply_menu(st)   # synchronous, same thread → correct visibility before the menu paints
            except Exception as exc:  # noqa: BLE001
                print(f"[menu] delegate apply-state: {exc}", file=sys.stderr)

    def _install_menu_delegate(AppKit):
        """Set our retained NSMenuDelegate on every submenu (idempotent; re-assert on each pass in case
        pywebview swapped a submenu object out from under us)."""
        try:
            app = AppKit.NSApp
            mainmenu = app.mainMenu() if app is not None else None
            if mainmenu is None:
                return
            _menu_delegate["cb"] = _menu_reapply   # closure over api / _wire_menu — refreshed each pass
            deleg = _menu_delegate.get("obj")
            if deleg is None:
                deleg = _menu_delegate_class().alloc().init()
                _menu_delegate["obj"] = deleg   # retain (NSMenu holds its delegate weakly)
            for i in range(mainmenu.numberOfItems()):
                sub = mainmenu.itemAtIndex_(i).submenu()
                if sub is not None and sub.delegate() is not deleg:
                    sub.setDelegate_(deleg)
        except Exception as exc:  # noqa: BLE001
            print(f"[menu] delegate install: {exc}", file=sys.stderr)

    def _mutate(holder):  # runs on the Cocoa main thread — NSWindow geometry may only be touched there
        try:
            import AppKit
            nswin = window.native
            if nswin is not None:
                nswin.setTitlebarAppearsTransparent_(True)
                nswin.setTitleVisibility_(NS_TITLE_HIDDEN)
                nswin.setStyleMask_(nswin.styleMask() | NS_FULL_SIZE_CONTENT)
                nswin.setMovableByWindowBackground_(True)
                # pywebview paints the title-bar view opaque (windowBackgroundColor); that opaque bar is what
                # covers the toolbar. Clear it so the unified toolbar (web content) shows through. Pick the
                # topmost sibling that ISN'T our drag overlay (which we add on top of the same frame view and
                # which has no background colour) so re-runs on loaded/resized still clear the real bar.
                try:
                    drag_cls = _titlebar_drag.get("__cls__")
                    subs = nswin.contentView().superview().subviews()
                    titlebar = None
                    for i in range(subs.count() - 1, -1, -1):
                        v = subs.objectAtIndex_(i)
                        if drag_cls is not None and isinstance(v, drag_cls):
                            continue
                        titlebar = v
                        break
                    if titlebar is not None and hasattr(titlebar, "setBackgroundColor_"):
                        titlebar.setBackgroundColor_(AppKit.NSColor.clearColor())
                except Exception:  # noqa: BLE001
                    pass
                if hasattr(nswin, "setTitlebarSeparatorStyle_"):
                    nswin.setTitlebarSeparatorStyle_(1)   # NSTitlebarSeparatorStyleNone
                holder["js"] = _place_lights(nswin, AppKit)
                _install_activity_observer(AppKit, nswin, window)   # dim the toolbar when the window is unfocused
                _install_fullscreen_observer(AppKit, nswin, window)   # item 10: forward full-screen enter/exit to JS
                _install_accent_observer(AppKit, nswin, window)   # item 9: recolour relations when the system accent changes
            _wire_menu(AppKit)
            _install_menu_delegate(AppKit)   # keep the wiring alive across pywebview's menu rebuilds
            if not _file_icon.get("done"):   # fetch the native icons once (main thread)
                _file_icon["done"] = True
                _file_icon["uri"] = _compute_file_icon(AppKit)
                _file_icon["folder"], _file_icon["root"] = _compute_folder_icons(AppKit)
                # the EXACT SF Symbols the File menu uses, as thin black-on-transparent mask PNGs
                _file_icon["sf_addtext"] = _compute_symbol_icon(AppKit, "text.badge.plus")
                _file_icon["sf_manage"] = _compute_symbol_icon(AppKit, "cube.box")
                # item 7: the Layout pill's two segments. rectangle.portrait.center.inset.filled /
                # rectangle.portrait.inset.filled are ONE SF family drawn on ONE frame — same rounded frame, same
                # "inset filled" content region — so the only difference between them is how much of that frame the
                # content takes, which is exactly what the pill chooses. PORTRAIT rather than the landscape pair of
                # the same family: what the paged mode lays out is a PAGE, and a page is portrait, so the portrait
                # frame states the choice in the shape as well as in the fill. (Checked against the alternatives on
                # this machine: text.page / doc.plaintext are a page of prose, true in BOTH modes;
                # distribute.horizontal.center and arrow.left.and.right.text.vertical are alignment/spacing verbs,
                # not a width; and there is no outline-only variant of this pair — `rectangle.portrait.center.inset`
                # / `rectangle.portrait.inset` both resolve to nil — so the filled pair it is.)
                _file_icon["sf_paged"] = _compute_symbol_icon(AppKit, "rectangle.portrait.center.inset.filled")
                _file_icon["sf_unpaged"] = _compute_symbol_icon(AppKit, "rectangle.portrait.inset.filled")
            if api is not None:   # already on the main thread → rebuild Open Recent with live-action native items
                _rebuild_recent_menu_main(window, api)
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] could not unify: {exc}", file=sys.stderr)
        finally:
            holder["done"].set()

    def apply(*_):
        holder = {"done": threading.Event(), "js": None}
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(_mutate, holder)   # NSWindow work on the main thread
            holder["done"].wait(6)
        except Exception:  # noqa: BLE001
            _mutate(holder)
        js = holder.get("js")
        if js:
            try:
                window.evaluate_js(js)   # off the main thread → safe to block until the JS bridge is ready
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] inject: {exc}", file=sys.stderr)
        icon = _file_icon.get("uri")
        if icon:   # hand the native .conllu file icon to the titlebar filename block
            try:
                window.evaluate_js("window.__setFileIcon && window.__setFileIcon(%s)" % json.dumps(icon))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] file icon inject: {exc}", file=sys.stderr)
        folder, root = _file_icon.get("folder"), _file_icon.get("root")
        if folder:   # native folder icons for the proxy-path menu
            try:
                window.evaluate_js("window.__folderIcon=%s; window.__rootIcon=%s" % (json.dumps(folder), json.dumps(root or folder)))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] folder icon inject: {exc}", file=sys.stderr)
        sf_add, sf_manage = _file_icon.get("sf_addtext"), _file_icon.get("sf_manage")
        if sf_add or sf_manage:   # the real menu SF Symbols as titlebar mask glyphs
            try:
                window.evaluate_js("window.__setSfSymbol && (%s,%s)" % (
                    "__setSfSymbol('addtext',%s)" % json.dumps(sf_add) if sf_add else "0",
                    "__setSfSymbol('manage',%s)" % json.dumps(sf_manage) if sf_manage else "0"))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] sf symbol inject: {exc}", file=sys.stderr)
        # item 7: the Layout pill, upgraded the same way but through the CSS VARIABLE rather than __setSfSymbol —
        # that helper carries a hard-coded {which → one selector} map (js/io/bridge.js), so a second element wearing
        # the same glyph would need a second entry, whereas both pill segments already read `--m:var(--sf-paged|
        # unpaged)`. Overriding those two vars on documentElement (inline style beats the :root rule in app.css)
        # upgrades every element that reads them, and leaves the hand-drawn masks in app.css as the browser-design-mode
        # fallback exactly as before — same fall-through as __setSfSymbol's, one level up.
        sf_paged, sf_unpaged = _file_icon.get("sf_paged"), _file_icon.get("sf_unpaged")
        if sf_paged or sf_unpaged:
            try:
                setvar = "document.documentElement.style.setProperty('--sf-%s','url(\"'+%s+'\")')"   # string-concat the URI in JS, as bridge.js's own applySfSymbol does, so no quoting of the base64 payload is needed
                window.evaluate_js(";".join(
                    setvar % (k, json.dumps(uri)) for k, uri in (("paged", sf_paged), ("unpaged", sf_unpaged)) if uri))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] layout symbol inject: {exc}", file=sys.stderr)
        # Size/position the titlebar drag overlay from the live web layout. Runs on shown/loaded/
        # resized; on 'shown' the page may not be up yet → the measurement returns None (guarded)
        # and 'loaded' retries. On 'resized' it re-measures so the overlay tracks the spring exactly.
        try:
            rect = window.evaluate_js(_DRAG_MEASURE_JS)
            _apply_titlebar_drag(window, rect)
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] drag measure: {exc}", file=sys.stderr)
        if api is not None and getattr(api, "_menu", None):
            try:
                window.evaluate_js("window.syncMenu && window.syncMenu(true)")   # menu items now exist → re-push selection state
            except Exception:  # noqa: BLE001
                pass

    # Run on BOTH shown (native window exists) and loaded (web page + JS bridge ready). The light
    # measurement calls evaluate_js, which only works once the page has loaded; the NSWindow tweaks are
    # idempotent, so running twice is harmless.
    events = getattr(window, "events", None)
    hooked = False
    # shown/loaded → set it up; resized → macOS resets the traffic-light positions on resize, so re-place them
    for name in ("shown", "loaded", "resized"):
        ev = getattr(events, name, None) if events is not None else None
        if ev is not None:
            ev += apply
            hooked = True
    if not hooked:  # older pywebview — try immediately
        apply()

    # Let the frontend request a drag-overlay re-measure when the titlebar reflows without a native
    # window resize (e.g. a longer filename, or the model dropdown changing width). Runs off the main
    # thread so it never blocks the JS→Python bridge call that triggered it.
    def _remeasure_drag(*_):
        def run():
            try:
                rects = window.evaluate_js(_DRAG_MEASURE_JS)
                _apply_titlebar_drag(window, rects)
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] drag remeasure: {exc}", file=sys.stderr)
        threading.Thread(target=run, daemon=True).start()

    # item 3: let the frontend flip the drag overlay click-through while a titlebar context menu is open, so a
    # menu row opened at the cursor over the drag region still receives clicks. Just a flag the view's hitTest_
    # consults; no geometry work, so it can run inline on the bridge thread.
    def _set_titlebar_passthrough(on):
        _titlebar_drag["__passthrough__"] = bool(on)

    if api is not None:
        api._remeasure_titlebar = _remeasure_drag
        api._titlebar_passthrough = _set_titlebar_passthrough


if __name__ == "__main__":
    main()
