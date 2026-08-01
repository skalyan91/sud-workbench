"""macOS shell: the AppKit/PyObjC half of the native window, moved out of ``app/__main__.py``.

Everything here is Cocoa — the unified transparent title bar with the traffic lights placed
in-content, the transparent drag view above the WKWebView, real SF Symbols rendered natively and
pushed to CSS ``--sf-*`` masks, the accent/full-screen/focus observers, the Dock icon, the
live-rebuilt Open Recent submenu, and the NSMenu wiring that gives the declarative menu its key
equivalents and icons.  It is imported ONLY from the ``sys.platform == "darwin"`` branch in
``__main__``, so no PyObjC import happens on any other platform.

The code below was moved UNCHANGED (only the menu-wiring table was lifted out to
``app/menu_spec.py``, which the Windows menu bar reads too).  Its comments are load-bearing —
several are the only surviving record of a subtle bug's diagnosis; the traffic-light IDEMPOTENCE
note inside ``_place_lights`` and the drag-view justification above ``_drag_view_class`` in
particular.  Preserve them verbatim when touching this file.
"""

from __future__ import annotations

import json
import os
import sys
import threading

from .. import menu_spec


def _fs_always_toolbar_state() -> bool:
    """Back-compat alias — the state itself now lives in menu_spec (both platforms read it)."""
    return menu_spec.fs_always_toolbar_state()


# ── live-updating Open Recent submenu ────────────────────────────────────────
# pywebview builds the menu once at start with no rebuild API, so to keep "Open
# Recent" current within a session we reach into the running NSMenu and rebuild the
# submenu in place whenever the recent list changes.  A single shared PyObjC target
# handles the item actions; the tapped item carries its path in representedObject.
_recent_ctx: dict = {}          # {"window":…, "api":…} — the FIRST document window, filled in main(); a fallback for _ctx_* below
_recent_target = None           # cached NSObject target (defined once)
_recent_target_tried = False

# ── which window a native menu command acts on ───────────────────────────────
# THE MENU BAR IS THE APP'S, THE DOCUMENT IS A WINDOW'S. With several document windows in the one
# process there is still exactly one NSMenu, so every native item here (Open Recent, Clear Recent,
# About, and the delegate's conditional show/hide) has to resolve its target at CLICK time rather
# than close over the window that happened to build it — otherwise the second window you open is
# driven by the first one's menu, which is the whole failure mode this indirection exists to avoid.
# __main__ installs the provider (its _key_pair reads NSApp.keyWindow); with none installed — the
# single-window case, and every unit-level import of this module — the _recent_ctx pair stands in.
_key_provider: dict = {"fn": None}
_reserve: dict = {}   # id(window) → the NSTitlebarAccessoryViewController holding the options bar's space
_last_tb_js: dict = {"js": None}   # the most recent titlebar metrics JS — every window's numbers are the same, so a new one can start from them (see apply() in _unify_titlebar_on_show)
_titlebar_apply: dict = {}   # id(pywebview window) → (window, its own titlebar re-measure) — see remeasure below
_new_tab_handler: dict = {"fn": None}   # set by __main__: what the tab bar's + button and ⌘T do


def set_key_provider(fn) -> None:
    """Register ``fn() -> (window, api)`` naming the window native menu commands should act on."""
    _key_provider["fn"] = fn


def _ctx_pair():
    fn = _key_provider.get("fn")
    if fn is not None:
        try:
            win, api = fn()
            if win is not None:
                return win, api
        except Exception as exc:  # noqa: BLE001 — a resolver hiccup must never disable the menu
            print(f"[menu] key window: {exc}", file=sys.stderr)
    return _recent_ctx.get("window"), _recent_ctx.get("api")


def _ctx_window():
    return _ctx_pair()[0]


def _ctx_api():
    return _ctx_pair()[1]


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
                    win = _ctx_window()
                    if win is not None and path:
                        js = "window.openRecentFile && openRecentFile(%s)" % json.dumps(str(path))
                        # evaluate_js does callAfter + semaphore.acquire() → self-deadlocks if called on the
                        # main thread (this selector). Run it off-thread so the run loop can service it.
                        threading.Thread(target=lambda: win.evaluate_js(js), daemon=True).start()
                except Exception as exc:  # noqa: BLE001
                    print(f"[menu] open recent: {exc}", file=sys.stderr)

            def clearRecent_(self, sender):         # ObjC selector: clearRecent: (invoked on the MAIN thread)
                try:
                    api, win = _ctx_api(), _ctx_window()
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
                    win = _ctx_window()
                    if win is not None:
                        threading.Thread(target=lambda: win.evaluate_js("window.openAbout && openAbout()"), daemon=True).start()
                except Exception as exc:  # noqa: BLE001
                    print(f"[menu] about: {exc}", file=sys.stderr)

        _about_target = _AboutMenuTarget.alloc().init()
    except Exception as exc:  # noqa: BLE001
        print(f"[menu] about target: {exc}", file=sys.stderr)
        _about_target = None
    return _about_target


# ── the rows only AppKit can supply (Cut/Copy/Paste/Select All, Enter Full Screen) ───────────
def _inject_native_items(AppKit, menus_by_title: dict) -> None:
    """Put ``menu_spec.NATIVE_MAC``'s first-responder rows into OUR Edit and View menus.

    These used to arrive in pywebview's OWN default View and Edit menus, which is precisely why the
    menu bar showed two Edits and two Views — the backend inserts them on top of whatever menu it is
    handed.  ``SHOW_DEFAULT_MENUS`` is off now (see ``__main__.py``), so we own the only copy and
    have to supply what it provided.

    They cannot be ordinary table rows with a ``js`` string.  What makes Cut/Copy/Paste/Select All
    work inside the WKWebView's own text fields is a **nil target**: the selector then travels the
    responder chain to whatever is first responder, which is the text field being edited.  So no
    ``setTarget_`` call below, deliberately — an item pointed at some object of ours would be dead
    everywhere the web view is focused, i.e. everywhere it matters.

    IDEMPOTENT, and it has to be: ``_wire_menu`` re-runs on every menu open because pywebview
    rebuilds these items underneath us.  A group whose selectors are already present is skipped
    whole; one that a rebuild has wiped is re-inserted whole.  All-or-nothing per group so a half
    state can't leave a second separator behind."""
    flag = {"cmd": AppKit.NSEventModifierFlagCommand, "shift": AppKit.NSEventModifierFlagShift,
            "ctrl": AppKit.NSEventModifierFlagControl, "alt": AppKit.NSEventModifierFlagOption}
    for group in menu_spec.NATIVE_MAC:
        sub = menus_by_title.get(group["menu"])
        if sub is None:
            continue
        present = set()
        for j in range(sub.numberOfItems()):
            act = sub.itemAtIndex_(j).action()
            if act is not None:
                present.add(str(act))
        if any(row["sel"] in present for row in group["items"]):
            continue                       # already installed this pass — nothing to do
        # `after` names the row to sit below (Redo, so Cut..Select All land in the HIG's own slot
        # between Redo and Find); None appends at the end (Enter Full Screen, bottom of View).
        anchor = sub.indexOfItemWithTitle_(group["after"]) if group["after"] else -1
        at = anchor + 1 if anchor >= 0 else sub.numberOfItems()
        sub.insertItem_atIndex_(AppKit.NSMenuItem.separatorItem(), at)
        at += 1
        for row in group["items"]:
            it = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                row["title"], row["sel"], row["key"])
            mask = 0
            for m in row["mods"]:
                mask |= flag[m]
            it.setKeyEquivalentModifierMask_(mask)   # explicit: the initialiser's default is ⌘ alone, which is wrong for ⌃⌘F
            sub.insertItem_atIndex_(it, at)
            at += 1


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

_chrome_base: dict = {"h": None}   # native top chrome (title bar + toolbar) with NO tab bar — one value for all document windows, which share a style


def _tab_bar_height(nswin) -> float:
    """WHERE A VISIBLE TAB BAR ENDS, in page coordinates — 0 when there is none.

    Returned as the window's whole native top chrome (``frame.height - contentLayoutRect.height``)
    rather than as the bar's own height, because the bar sits at the BOTTOM of that chrome and what
    the page has to clear is its lower edge. The page's own toolbar is 54px of web content drawn
    inside a 66px transparent band, so "toolbar height + bar height" (54+36=90) lands 12px INSIDE the
    bar; the chrome figure (102) is the edge itself, and --tabH is consumed as a floor, not a sum.

    MEASURED, and measured this way, on evidence. The first attempt read the two rects in the same
    turn as the merge and always got 0 — AppKit lays the bar out a pass later. The second walked the
    view tree for a *TabBar* class, never found one, and returned its 28.0 fallback — 8px short, which
    is exactly the clipping it produced. The live numbers: chrome 66 untabbed, 102 tabbed, with the
    NSToolbarView moved to y=36 INSIDE a 102-tall NSTitlebarContainerView — i.e. the bar takes 36 and
    takes it ABOVE the toolbar band, which is why the page's own toolbar (--tabH on .titlebar's top)
    moves down by it as well as the document.
    0 when the baseline hasn't been seen yet: every window records it on its first tab-bar-less
    measurement, and a window born INTO a tab group inherits the one another window recorded."""
    try:
        chrome = float(nswin.frame().size.height - nswin.contentLayoutRect().size.height)
        grp = nswin.tabGroup() if hasattr(nswin, "tabGroup") else None
        if not (grp is not None and grp.isTabBarVisible()):
            _chrome_base["h"] = chrome
            return 0.0
        return chrome   # …the bar's BOTTOM EDGE in page coordinates, which is what the page needs to clear
    except Exception as exc:  # noqa: BLE001
        print(f"[titlebar] tab bar height: {exc}", file=sys.stderr)
        return 0.0



def _tab_css(tab_h: float, tab_top: float) -> str:
    """The JS that hands the page a tab bar's geometry: its bottom edge (--tabH, taken as a floor by
    .doc's padding), its top edge (--tabTop, which is what lets the page put the SAME air under the
    bar as there is above it), and the `tabbed` class the chrome branches on — the title bar drops its
    scroll-edge ramp for a flat merged surface when a bar is under it, exactly as it does when the
    options bar is open."""
    # …wrapped in withTopChrome (js/core/scroll.js), which pins the block the reader is on where it is:
    # this shortens the port FROM THE TOP, and the scroller does not move itself, so without it the tab
    # bar appears ON TOP of the line being read. The fallback runs the body plainly on any page old
    # enough not to have the helper. The recap inside is what re-sizes each block's diagram and grid to
    # the new viewport (js/core/document.js) — the anchor is restored a frame later, from its result.
    return ("(window.withTopChrome||function(f){f()})(function(){"
            "document.documentElement.style.setProperty('--tabH','%.1fpx');"
            "document.documentElement.style.setProperty('--tabTop','%.1fpx');"
            "document.documentElement.classList.toggle('tabbed',%s);"
            "window.recapBlocks && recapBlocks();"
            "});" % (tab_h, tab_top, "true" if tab_h else "false"))


def publish_tab_height(window) -> None:
    """Re-publish --tabH for one window, and NOTHING ELSE.

    ⚠️ NOT remeasure()/apply(): joining a tab group changes only how much of the title-bar band is
    left to the page, but apply() re-runs the whole titlebar mutation — style mask, toolbar, traffic
    lights, subview surgery — and doing that around a window pywebview is still showing CRASHES the
    process (see _measurable). This reads one number on the main thread and pushes one CSS variable,
    which is all a tab bar's appearance or disappearance actually changes.

    Safe to call as often as you like: the last published pair is remembered ON THE WINDOW (so it is
    collected with it — no id()-keyed table to go stale), and an unchanged pair skips the bridge call
    entirely. That is what makes it cheap enough to run on every become-key, which is how a window
    that MISSED a broadcast repairs itself (see _install_activity_observer)."""
    def work():
        try:
            import threading as _t
            from PyObjCTools import AppHelper
            done, res = _t.Event(), {"h": 0.0}

            def read():
                try:
                    nswin = getattr(window, "native", None)
                    if nswin is not None:
                        res["h"] = _tab_bar_height(nswin)
                        res["top"] = float(_chrome_base["h"] or 0.0) if res["h"] else 0.0
                except Exception as exc:  # noqa: BLE001
                    print(f"[titlebar] tab height read: {exc}", file=sys.stderr)
                finally:
                    done.set()
            AppHelper.callAfter(read)
            done.wait(4)
            pair = (res["h"], res.get("top", 0.0))
            if getattr(window, "_sud_tabpub", None) == pair:
                return                      # same geometry as last time → nothing for the page to redo
            window._sud_tabpub = pair
            window.evaluate_js(_tab_css(*pair))
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] tab height publish: {exc}", file=sys.stderr)
    threading.Thread(target=work, daemon=True).start()


def remeasure(window) -> None:
    """Re-run a window's titlebar measurement and re-publish --lights-cy/--tabH.

    Needed because JOINING OR LEAVING A TAB GROUP resizes the CONTENT without resizing the WINDOW:
    pywebview's `resized` event never fires, so the page would keep a --tabH computed when the tab
    bar wasn't there — the bar would then overlap the app's own toolbar, which is the one thing
    publishing it is meant to prevent. Off-thread: apply() blocks on the main-thread mutation and
    then calls evaluate_js."""
    ent = _titlebar_apply.get(id(window))
    if ent is not None and _measurable(ent[0]):
        threading.Thread(target=ent[1], daemon=True).start()


def remeasure_all() -> None:
    for win, fn in list(_titlebar_apply.values()):
        if _measurable(win):
            threading.Thread(target=fn, daemon=True).start()


def _measurable(window) -> bool:
    """Is this window finished enough to be re-measured?

    ⚠️ A WINDOW STILL BEING CREATED MUST NOT BE TOUCHED. apply() marshals _mutate onto the main
    thread, and _mutate performs real surgery on the NSWindow — style mask, toolbar, traffic-light
    placement, subview walks. Run against a window that pywebview is mid-`first_show` on, that is a
    HARD CRASH of the process, not an exception: confirmed from crash.log, whose dump showed the main
    thread inside cocoa.py's first_show while a worker sat in this module's apply(). It bit as soon as
    a tab merge started calling remeasure_all() for every window, one of which was the tab being
    created. `loaded` is the same readiness signal _attach_as_tab waits for before merging."""
    if getattr(window, "native", None) is None:
        return False
    ev = getattr(getattr(window, "events", None), "loaded", None)
    return bool(ev is None or ev.is_set())


def set_titlebar_reserve(window, height: float) -> None:
    """Reserve ``height`` px INSIDE the window's title-bar band, for the options bar to draw in.

    WHY THE BAND AND NOT THE PAGE: macOS implements the window-tab bar as a titlebar accessory pinned
    to the BOTTOM of that band, so anything the page draws below the band is necessarily below the
    tabs. Reserving the options bar's height as an accessory of our own puts it in the band too — and
    ours lands ABOVE the system's (verified live: with both present the system's clip view sits at
    y=0 and ours at y=36, bottom-up), which is the ordering asked for: toolbar, options bar, tabs,
    document. The accessory is EMPTY and transparent; it exists only to make AppKit reserve the space,
    while the bar itself stays what it always was — web content under a transparent title bar.
    Added when the bar opens and removed when it closes (rather than kept at zero height), because an
    accessory draws its own NSTitlebarSeparatorView and a 0-height one would leave that hairline
    ruling the title bar for a bar that isn't there.
    Height changes are cheap: the view is resized in place, so an options bar that re-wraps to two
    rows just grows its reservation."""
    def work():
        try:
            import AppKit
            from Foundation import NSMakeRect
            nswin = getattr(window, "native", None)
            if nswin is None:
                return
            key = id(window)
            vc = _reserve.get(key)
            h = max(0.0, float(height or 0))
            if h <= 0:
                if vc is not None:
                    try:
                        for i, cur in enumerate(list(nswin.titlebarAccessoryViewControllers() or [])):
                            if cur is vc:
                                nswin.removeTitlebarAccessoryViewControllerAtIndex_(i)
                                break
                    except Exception as exc:  # noqa: BLE001
                        print(f"[titlebar] reserve remove: {exc}", file=sys.stderr)
                    _reserve.pop(key, None)
                threading.Timer(0.25, lambda: publish_tab_height(window)).start()   # …the chrome just SHRANK; the page is still holding the taller figure until this lands (the same re-publish the grow path does below — an early return here was why closing the options bar left the document indented as if it were open)
                return
            if vc is None:
                vc = AppKit.NSTitlebarAccessoryViewController.alloc().init()
                view = AppKit.NSView.alloc().initWithFrame_(NSMakeRect(0, 0, max(1.0, nswin.frame().size.width), h))
                vc.setView_(view)
                vc.setLayoutAttribute_(AppKit.NSLayoutAttributeBottom)   # …the bottom of the band, where AppKit stacks it above its own tab-bar accessory
                if hasattr(vc, "setFullScreenMinHeight_"):
                    vc.setFullScreenMinHeight_(0)   # full screen collapses the app's chrome itself (syncChrome zeroes --tbH/--vbH); no reservation is wanted there
                nswin.addTitlebarAccessoryViewController_(vc)
                _reserve[key] = vc
            v = vc.view()
            if v is not None:
                f = v.frame()
                if abs(f.size.height - h) > 0.5:
                    v.setFrameSize_(AppKit.NSMakeSize(f.size.width or nswin.frame().size.width, h))
            # THE RESERVATION IS PART OF THE CHROME the page has to clear, so its height is now
            # stale in the page: --tabH is published as the whole native chrome, and this just moved
            # it. Re-publish (a beat later, once AppKit has laid the band out) — which also re-caps
            # the blocks, since the viewport they are measured against changed with it.
            threading.Timer(0.25, lambda: publish_tab_height(window)).start()
        except Exception as exc:  # noqa: BLE001 — a missing reservation is a layout loss, never a failure
            print(f"[titlebar] reserve: {exc}", file=sys.stderr)
    try:
        from PyObjCTools import AppHelper
        AppHelper.callAfter(work)   # NSWindow chrome belongs on the Cocoa main thread
    except Exception:  # noqa: BLE001
        work()


def set_new_tab_handler(fn) -> None:
    """Register what ``⌘T`` / the tab bar's + button should do (``__main__`` hands over its own
    new-document-window-as-tab call)."""
    _new_tab_handler["fn"] = fn
    _enable_tab_plus_button()


_tab_plus_done = {"v": False}


def _enable_tab_plus_button():
    """THE + AT THE RIGHT END OF THE TAB BAR. AppKit draws it only for an app that answers
    ``newWindowForTab:``, and sends that action up the responder chain — so implementing it on
    NSApplication (the chain's last link) covers every window without touching pywebview's own
    delegate. Same category mechanism _enable_first_mouse uses on WKWebView, and idempotent for the
    same reason: a duplicate category registration raises."""
    if _tab_plus_done["v"]:
        return
    _tab_plus_done["v"] = True
    try:
        import objc
        import AppKit

        class NSApplication(objc.Category(AppKit.NSApplication)):   # pyobjc: a category's class name must match the class it extends
            def newWindowForTab_(self, sender):   # noqa: N802 — ObjC selector name
                fn = _new_tab_handler.get("fn")
                if fn is not None:
                    try:
                        fn()
                    except Exception as exc:  # noqa: BLE001
                        print(f"[menu] new tab: {exc}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 — no + button is a loss, not a failure
        print(f"[menu] tab + button: {exc}", file=sys.stderr)


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

_win_activity: dict = {}          # "__cls__" -> class, "obj" -> the ONE retained observer
_win_active: list = []            # [(nswin, pywin), …] — every document window the observer dispatches to

_win_fullscreen = {}   # "__cls__" -> class, "obj" -> retained observer, "pywin" -> pywebview window
_win_accent = {}   # item 9: "__cls__" -> class, "obj" -> retained observer, "pywin" -> pywebview window


def _web_view(nswin):
    """The WKWebView inside a document window, or None. pywebview keeps its own reference in
    BrowserView, but this module is handed the NSWindow — so walk down from the content view, which
    is where the web view sits (the vibrancy NSVisualEffectView is ITS subview, not a sibling)."""
    try:
        from WebKit import WKWebView as _WK
        stack = [nswin.contentView()]
        while stack:
            v = stack.pop()
            if v is None:
                continue
            if isinstance(v, _WK):
                return v
            subs = v.subviews()
            for i in range(subs.count()):
                stack.append(subs.objectAtIndex_(i))
    except Exception:  # noqa: BLE001
        pass
    return None


def _bg_nscolor(AppKit):
    """app/appearance.py's pre-paint colour as an NSColor — the same value pywebview was handed for
    the window itself, so the web view's base and the window's background cannot disagree."""
    from .. import appearance
    hexv = appearance.window_bg().lstrip("#")
    r, g, b = (int(hexv[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return AppKit.NSColor.colorWithSRGBRed_green_blue_alpha_(r, g, b, 1.0)


def snapshot_webview(window, timeout: float = 2.5):
    """This window's web view as JPEG bytes, or None — the picture a later launch shows while the
    document it belongs to is being read back in (api.capture_snapshot → Api.get_state).

    WKWebView's OWN snapshot API, not a screen capture: CGWindowListCreateImage needs the Screen
    Recording permission (and would catch anything overlapping the window), while
    takeSnapshotWithConfiguration: renders the view's own content and needs nothing. JPEG, not the
    PNG _nsimage_to_datauri makes: this is a full window of anti-aliased text, where PNG runs to
    megabytes and rides back through the bridge on the launch path — quality 0.6 puts it in the low
    hundreds of kB, and it is a placeholder that gets covered by the real thing a moment later.
    Snapshot width is the view's POINT width, i.e. 1x rather than the backing store's 2x: half the
    pixels, and it is scaled back up to the same size it was taken at.

    ⚠️ NOT FROM THE MAIN THREAD. It marshals the WebKit call there and waits for the completion
    handler, so calling it from a main-thread callback parks the run loop that would deliver it —
    the same deadlock _dialog_lock's bridge-thread-only rule exists for."""
    try:
        import AppKit
        import threading as _t
        from PyObjCTools import AppHelper
        from WebKit import WKSnapshotConfiguration
        nswin = getattr(window, "native", None)
        wk = _web_view(nswin) if nswin is not None else None
        if wk is None:
            return None
        done, out = _t.Event(), {"data": None}

        def take():
            try:
                cfg = WKSnapshotConfiguration.alloc().init()
                if hasattr(cfg, "setSnapshotWidth_"):
                    cfg.setSnapshotWidth_(int(wk.bounds().size.width))

                def finished(img, err):
                    try:
                        if img is not None:
                            tiff = img.TIFFRepresentation()
                            rep = AppKit.NSBitmapImageRep.imageRepWithData_(tiff) if tiff is not None else None
                            if rep is not None:
                                jpeg_type = getattr(AppKit, "NSBitmapImageFileTypeJPEG", 3)
                                key = getattr(AppKit, "NSImageCompressionFactor", "NSImageCompressionFactor")
                                data = rep.representationUsingType_properties_(jpeg_type, {key: 0.6})
                                if data is not None:
                                    out["data"] = bytes(data)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[snapshot] encode: {exc}", file=sys.stderr)
                    finally:
                        done.set()
                wk.takeSnapshotWithConfiguration_completionHandler_(cfg, finished)
            except Exception as exc:  # noqa: BLE001
                print(f"[snapshot] take: {exc}", file=sys.stderr)
                done.set()
        AppHelper.callAfter(take)
        done.wait(timeout)
        return out["data"]
    except Exception as exc:  # noqa: BLE001 — a launch without a picture is a launch, not a failure
        print(f"[snapshot] {exc}", file=sys.stderr)
        return None


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


def _activity_target(note):
    """The pywebview window a become/resign-key notification is about, or None if it isn't ours."""
    try:
        obj = note.object()
    except Exception:  # noqa: BLE001
        return None
    for nswin, pywin in list(_win_active):
        if nswin == obj:                     # PyObjC == on NSWindow is isEqual: → pointer identity
            return pywin
    return None


def _install_activity_observer(AppKit, nswin, pywin):
    """Dim the web toolbar when the window loses key focus (macOS inactive style). WKWebView has no
    :window-inactive, so we watch NSWindow become/resign-key and toggle .win-inactive over the bridge.

    ONE observer for the whole app, registered for ALL windows (object=None) and dispatching on the
    notification's own object, rather than one per window: the observer class is cached across calls,
    so a class whose methods closed over `pywin` would have frozen the FIRST window's — which is what
    the previous "already installed → return" guard was papering over, at the cost of every window
    after the first never dimming at all. The registry below is the closure, and it is per window."""
    try:
        from Foundation import NSObject, NSNotificationCenter
        if not any(n == nswin for n, _p in _win_active):
            _win_active.append((nswin, pywin))

        def _push(pw, active):
            threading.Thread(
                target=lambda: pw.evaluate_js(
                    "window.__setWindowActive && __setWindowActive(%s)" % ("true" if active else "false")),
                daemon=True).start()

        cls = _win_activity.get("__cls__")
        if cls is None:
            class _SUDActivityObserver(NSObject):
                def windowBecameKey_(self, note):    # noqa: N802 — ObjC selector windowBecameKey:
                    pw = _activity_target(note)
                    if pw is None:
                        return
                    _push(pw, True)
                    # …AND RE-READ THE TAB BAR. Selecting a tab makes that window key, so this is the
                    # moment a window whose --tabH is stale becomes the one the user is looking at —
                    # and the only moment a stale value can be seen at all. The post-merge broadcast
                    # is a timer racing AppKit's own tab-bar layout pass; this needs no race, and
                    # publish_tab_height skips the bridge entirely when the geometry hasn't moved.
                    publish_tab_height(pw)

                def windowResignedKey_(self, note):  # noqa: N802 — ObjC selector windowResignedKey:
                    pw = _activity_target(note)
                    if pw is not None:
                        _push(pw, False)
            cls = _SUDActivityObserver
            _win_activity["__cls__"] = cls
        nc = NSNotificationCenter.defaultCenter()
        if _win_activity.get("obj") is None:
            obs = cls.alloc().init()
            _win_activity["obj"] = obs       # retain (NSNotificationCenter holds observers weakly-ish)
            nc.addObserver_selector_name_object_(obs, "windowBecameKey:", AppKit.NSWindowDidBecomeKeyNotification, None)
            nc.addObserver_selector_name_object_(obs, "windowResignedKey:", AppKit.NSWindowDidResignKeyNotification, None)
        # Seed the state, but NEVER dim at launch. A freshly-shown window may not be key YET (its
        # NSWindowDidBecomeKey can fire before this observer is registered, and a background-launched
        # process may not become frontmost at all), so seeding false here made the app OPEN looking
        # unfocused. Seed ACTIVE only; a genuine resign-key later dims it via the observer.
        if nswin.isKeyWindow():
            _push(pywin, True)
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
            # …/app/data — TWO dirnames up from this file, because this file is app/mac/shell.py.
            # It was ONE (…/app/mac/data, a directory that has never existed), left behind when
            # app/shell.py moved into app/mac/ in "Add a Windows (Fluent/WinUI) chrome track": at the
            # old location one dirname WAS the package root. Every load therefore missed, _app_icon
            # returned None for both appearances, and setApplicationIconImage_ was never called — so
            # the runtime icon never appeared and the Light/Dark switch this function exists to serve
            # (see _set_dock_icon_on_show's theme observer) could not fire either. From a bundle that
            # reads as "the dark-mode icon isn't showing": LaunchServices' static bundle icon is all
            # there ever was. It also cost every NSAlert its icon, per this function's own docstring.
            # os.path.dirname twice rather than `..`-joining, matching the app/langid.py and app/translit.py
            # idiom for the same directory (one dirname there — those modules sit in the package root).
            base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
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

    _titlebar_apply[id(window)] = (window, apply)   # …so remeasure() above can re-run this window's measurement when a tab bar appears or goes
    events = getattr(window, "events", None)
    hooked = False
    for name in ("shown", "loaded"):
        ev = getattr(events, name, None) if events is not None else None
        if ev is not None:
            ev += first
            hooked = True
    if not hooked:
        first()

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
            # ── the TAB BAR's height, published like the options bar's ──────────────────────────
            # A native tab bar is a real AppKit view in the title-bar band, while this app's own
            # toolbar is web content painted UNDER a transparent title bar (fullSizeContentView) — so
            # the bar lands ON TOP of the web toolbar unless the page moves down by its height, and
            # --tabH is what moves it (.doc's padding + both bars' `top`, exactly as --vbH does for
            # the options bar, which is what makes the viewport SHRINK rather than be overlapped).
            # NOT measured as a growth of the window's top inset, which was the first attempt and read
            # zero every time: contentLayoutRect is IDENTICAL tabbed and untabbed (66px both ways,
            # measured on a live pair), because with an empty unified NSToolbar AppKit puts the tab bar
            # in the band the toolbar already had. So the bar's own view is what gets measured.
            tab_h = _tab_bar_height(nswin)   # 0 with no tab bar, and records the baseline the tabbed measurement is taken against
            tab_top = float(_chrome_base["h"] or 0.0) if tab_h else 0.0   # the bar's TOP edge = the chrome height without it
            return (
                "document.documentElement.style.setProperty('--lights-cy','%.1fpx');"
                "document.documentElement.style.setProperty('--lights-right','%.1fpx');"
                + _tab_css(tab_h, tab_top)
            ) % (cy, right + 14)
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] light place: {exc}", file=sys.stderr)
            return None

    def _wire_menu(AppKit):
        """Give the menu items native key-equivalents and SF Symbol icons.

        THE TABLE IS NO LONGER HERE.  Titles, accelerators, SF Symbols and the conditional /
        checkable sets all come from ``app/menu_spec.py``, which the Windows in-window menu bar
        reads too — a 78-entry ``specs`` dict living in this closure was a copy the other platform
        could only duplicate, and two copies of one fact drift.  What stays here is the AppKit half:
        turning the table's portable ``("cmd", "shift")`` into NSEventModifierFlag bits, and
        pushing the results onto the live NSMenuItems (which pywebview REBUILDS underneath us, hence
        the re-run on every menu open — see the delegate below)."""
        try:
            app = AppKit.NSApp
            mainmenu = app.mainMenu() if app is not None else None
            if mainmenu is None:
                return
            # the ONE place the table's portable modifier names become AppKit bits
            flag = {
                "cmd": AppKit.NSEventModifierFlagCommand,
                "shift": AppKit.NSEventModifierFlagShift,
                "ctrl": AppKit.NSEventModifierFlagControl,
                "alt": AppKit.NSEventModifierFlagOption,
            }
            specs = menu_spec.by_title()
            checkable = menu_spec.CHECKABLE
            conditional = menu_spec.CONDITIONAL
            has_sym = hasattr(AppKit.NSImage, "imageWithSystemSymbolName_accessibilityDescription_")
            menu_map: dict = {}
            menus_by_title: dict = {}   # top-level title → submenu, for the native injection below
            for i in range(mainmenu.numberOfItems()):
                sub = mainmenu.itemAtIndex_(i).submenu()
                if sub is None:
                    continue
                # Keyed on the SUBMENU's title, not the item's: AppKit displays the submenu's title
                # for a top-level menu, and pywebview sets the item's only in _add_custom_menu (its
                # own default menus left it as the literal "NSMenuItem" — which is how a bar that
                # visibly read Edit/View/File/Format/Edit/View reported six differently-named items).
                menus_by_title[str(sub.title() or mainmenu.itemAtIndex_(i).title())] = sub
                prev_sep = None
                for j in range(sub.numberOfItems()):
                    it = sub.itemAtIndex_(j)
                    if it.isSeparatorItem():
                        prev_sep = it
                        continue
                    title = it.title().replace("\u2026", "").strip()
                    if title in conditional:
                        menu_map[title] = it
                        it.setHidden_(True)                    # start hidden (nothing selected yet)
                        if title == menu_spec.SEP_TOKENS_AFTER and prev_sep is not None:
                            menu_map[menu_spec.SEP_TOKENS_KEY] = prev_sep
                            prev_sep.setHidden_(True)
                    elif title in checkable:
                        menu_map[title] = it
                    if title == "Always Show Toolbar in Full Screen":
                        it.setState_(1 if _fs_always_toolbar_state() else 0)   # item 10: reflect the persisted pref as a checkmark
                    spec = specs.get(title)
                    if not spec:
                        continue
                    key, symbol = spec["key"], spec["sf"]
                    if key:
                        mask = 0
                        for m in spec["mods"]:
                            mask |= flag[m]
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
            # ── the WINDOW menu, injected natively and handed to AppKit ──────────────────────────
            # Every multi-window Mac app has one, and it is not decoration: once NSApp.windowsMenu is
            # set, AppKit MAINTAINS it — the list of open windows at the bottom, and (because the
            # windows carry a shared tabbingIdentifier, see _mutate) the whole tabbing group: Merge
            # All Windows, Move Tab to New Window, Show Previous/Next Tab. Those commands exist
            # nowhere else, so without this menu the tabbing that one-process windows just bought is
            # unreachable. The three rows we add ourselves are first-responder selectors, like the
            # Cut/Copy/Paste block below — no target, so they act on the key window by definition.
            # It is NOT in menu_spec.py: that table drives BOTH platforms, and every row in it is a
            # command this app implements, whereas these are AppKit's own and the menu's contents are
            # mostly written by AppKit at runtime. Windows draws its own window list in the shell.
            # Idempotent, like everything else in _wire_menu (which re-runs on every menu open).
            try:
                if "Window" not in menus_by_title:
                    winmenu = AppKit.NSMenu.alloc().initWithTitle_("Window")
                    holder = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Window", None, "")
                    holder.setSubmenu_(winmenu)
                    # …before Help, which the HIG puts last; appended if there is no Help menu.
                    idx = mainmenu.numberOfItems()
                    for _k in range(mainmenu.numberOfItems()):
                        _sub = mainmenu.itemAtIndex_(_k).submenu()
                        if _sub is not None and str(_sub.title() or "") == "Help":
                            idx = _k
                            break
                    mainmenu.insertItem_atIndex_(holder, idx)
                    winmenu.addItemWithTitle_action_keyEquivalent_("Minimise", "performMiniaturize:", "m")
                    winmenu.addItemWithTitle_action_keyEquivalent_("Zoom", "performZoom:", "")
                    winmenu.addItem_(AppKit.NSMenuItem.separatorItem())
                    winmenu.addItemWithTitle_action_keyEquivalent_("Bring All to Front", "arrangeInFront:", "")
                    winmenu.addItem_(AppKit.NSMenuItem.separatorItem())
                    # MERGE ALL WINDOWS, stated explicitly. AppKit adds the tab commands to a windows
                    # menu by itself on earlier systems, but macOS 26's Window menu did not show one
                    # (verified live: Fill / Centre / Move & Resize / Full-Screen Tile / Remove Window
                    # from Set and the window list, no merge row) — and the capability is certainly
                    # there, since mergeAllWindows: is exactly what addTabbedWindow:ordered: drives.
                    # First-responder selector, so it acts on the key window and greys itself out when
                    # there is nothing to merge.
                    winmenu.addItemWithTitle_action_keyEquivalent_("Merge All Windows", "mergeAllWindows:", "")
                    AppKit.NSApp.setWindowsMenu_(winmenu)   # …from here on AppKit owns it: window list + the tab commands
                    menus_by_title["Window"] = winmenu
            except Exception as exc:  # noqa: BLE001 — a missing Window menu is a loss, not a failure
                print(f"[menu] window menu: {exc}", file=sys.stderr)
            # …and the Edit/View rows AppKit alone can serve, now that pywebview's duplicate default
            # menus are switched off (SHOW_DEFAULT_MENUS in __main__.py).  After the loop above, so
            # the injected items are never fed to the spec lookup, and idempotent for the same
            # reason the About retarget is: this whole function re-runs on every menu open.
            try:
                _inject_native_items(AppKit, menus_by_title)
            except Exception as exc:  # noqa: BLE001 — a missing Cut item must never break the menu
                print(f"[menu] native items: {exc}", file=sys.stderr)
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

        def _apply_menu_caching(st, _orig=_orig_apply_menu, **kw):
            # **kw, not a fixed signature: _apply_menu grew a `force` flag (api.py — the delegate has
            # already resolved the key window and must not be second-guessed by the not-key guard),
            # and this wrapper sits between the two. Swallowing the argument would silently disable
            # the flag; refusing it threw "unexpected keyword argument 'force'" on every menu open,
            # which is the delegate's whole conditional-item pass lost.
            try:
                api._last_menu_state = dict(st or {})
            except Exception:  # noqa: BLE001
                pass
            return _orig(st, **kw)

        api._apply_menu = _apply_menu_caching
        api._apply_menu_wrapped = True

    def _menu_reapply(menu):
        """menuNeedsUpdate callback (main thread): re-wire key-equivalents + SF Symbol images across the
        menu bar and re-assert the conditional show/hide from the last-known selection state. Runs on every
        submenu open, so it beats whatever pywebview did to the items underneath us."""
        import AppKit
        _wire_menu(AppKit)   # re-applies key equivalents + images and rebuilds api._menu from the live items
        # …and the conditional items follow the KEY window, not the window that installed this
        # delegate: every document window installs one, so with two windows open the last-installed
        # closure would otherwise decide what a menu opened over the OTHER window is allowed to show.
        target = _ctx_api() or api
        if target is not None:
            st = getattr(target, "_last_menu_state", None) or {}
            try:
                target._apply_menu(st, force=True)   # synchronous, same thread → correct visibility before the menu paints. force: this IS the key window's state, so the not-key guard in _apply_menu must not second-guess it
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
                # THE WEB VIEW'S OWN BASE COLOUR, matching the window's. Belt and braces rather
                # than the fix: the flicker a loading tab used to show — white → (233,233,233) →
                # white, an ~85ms DIP measured by sampling the window's pixels every 20ms through a
                # ⌘T — came from the NSVisualEffectView that `vibrancy=True` parked inside the web
                # view, and that view is a SIBLING ABOVE this colour, so setting this alone left the
                # dip at ~72ms. What removed it was dropping the vibrancy view altogether (see
                # app/__main__.py's create_window). This stays because it is simply true: the colour
                # WKWebView paints behind the page should be the colour the window is.
                # TWO REJECTED ALTERNATIVES, both measured, so neither gets tried again:
                #  · setOpaque_(False) + clearColor, i.e. "make the initial background transparent" —
                #    that makes the pre-paint window a HOLE rather than a material, and the launch
                #    showed ~240ms of raw un-blurred desktop: black on a dark wallpaper, which is the
                #    "the window starts black" complaint in a new hat.
                #  · pywebview's own `transparent=True`, which reaches that same place AND calls
                #    setHasShadow_(False); a macOS window without its shadow reads as a picture of a
                #    window rather than a window.
                try:
                    wk = _web_view(nswin)
                    if wk is not None and hasattr(wk, "setUnderPageBackgroundColor_"):
                        wk.setUnderPageBackgroundColor_(_bg_nscolor(AppKit))
                except Exception as exc:  # noqa: BLE001 — cosmetic; a window that flickers still works
                    print(f"[titlebar] under-page background: {exc}", file=sys.stderr)
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
                # NATIVE WINDOW TABBING. One identifier shared by every document window is what lets
                # macOS group them — "Merge All Windows", ⌃⇥ between tabs, and the + in the tab bar —
                # and it is only reachable now that the windows live in ONE process: tabbing groups
                # NSWindows within an application, so the old process-per-window design could not
                # have it at any price. Mode 0 (NSWindowTabbingModeAutomatic) leaves the choice to
                # the user's "Prefer tabs when opening documents" setting rather than forcing tabs.
                try:
                    if hasattr(nswin, "setTabbingIdentifier_"):
                        nswin.setTabbingIdentifier_("sud-document")
                    if hasattr(nswin, "setTabbingMode_"):
                        nswin.setTabbingMode_(0)
                except Exception as exc:  # noqa: BLE001 — tabbing is a nicety; never hold up the window for it
                    print(f"[titlebar] tabbing: {exc}", file=sys.stderr)
                # …AND A TAB KEEPS ITS GROUP'S FRAME. Everything above resizes the window — the style
                # mask and, most of all, installing the unified toolbar — and a window that is already
                # a TAB must not carry that resize alone: tabs in a group share one frame, so the odd
                # one out simply hangs 68px short (measured), which reads as the title bar dropping.
                # It is corrected HERE, in the same main-thread turn as the resize that caused it, so
                # there is one redraw and no visible jump; doing it from a later timer fixed the size
                # but showed the drop first, then the snap back.
                try:
                    grp = nswin.tabGroup() if hasattr(nswin, "tabGroup") else None
                    peers = [w for w in ((grp.windows() if grp else None) or []) if w is not nswin]
                    if peers:
                        want = peers[0].frame()
                        cur = nswin.frame()
                        if abs(want.size.height - cur.size.height) > 0.5 or abs(want.size.width - cur.size.width) > 0.5:
                            nswin.setFrame_display_(want, False)
                except Exception as exc:  # noqa: BLE001
                    print(f"[titlebar] tab frame: {exc}", file=sys.stderr)
                holder["js"] = _place_lights(nswin, AppKit)
                # THE THREE OBSERVERS CANNOT COST THE MENU ITS WIRING. They are decorations of the
                # window (dimming, full-screen forwarding, accent recolouring); the menu below is the
                # app's key equivalents and icons. Both used to sit inside the ONE outer try, so a
                # throw from any observer jumped straight to the "[titlebar] could not unify" handler
                # and skipped _wire_menu + _install_menu_delegate — leaving a window whose title bar
                # was already unified (the lights are placed on the line above) beside a menu bar with
                # no shortcuts and no icons, and one stderr line to say so, which a LaunchServices
                # launch discards. That is exactly the shape of a reported "the built app has no menu
                # icons or shortcuts, but the window looks right", so each observer now fails alone.
                for _obs, _what in ((_install_activity_observer, "activity"),      # dim the toolbar when the window is unfocused
                                    (_install_fullscreen_observer, "fullscreen"),  # item 10: forward full-screen enter/exit to JS
                                    (_install_accent_observer, "accent")):         # item 9: recolour relations when the system accent changes
                    try:
                        _obs(AppKit, nswin, window)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[titlebar] {_what} observer: {exc}", file=sys.stderr)
            _wire_menu(AppKit)
            _install_menu_delegate(AppKit)   # keep the wiring alive across pywebview's menu rebuilds
            # (the native icons USED to be rasterised here, holding the main thread before the page
            #  could start loading — see _rasterise_icons, which now does it a run-loop turn later)
            if api is not None:   # already on the main thread → rebuild Open Recent with live-action native items
                _rebuild_recent_menu_main(window, api)
        except Exception as exc:  # noqa: BLE001
            print(f"[titlebar] could not unify: {exc}", file=sys.stderr)
        finally:
            holder["done"].set()

    def _rasterise_icons():
        """The native icons, as base64 PNG data URIs — ON THE MAIN THREAD BUT OFF THE CRITICAL PATH.

        This is AppKit drawing (NSWorkspace icons, SF Symbols rendered to bitmaps), so it has to be
        on the main thread; what it must NOT be is INSIDE _mutate, which the `shown` handler blocks
        on. Sampling the main thread every 15ms through three launches put 210-285ms of every launch
        right here, held ahead of pywebview's own load() call — i.e. the WKWebView could not even
        begin navigating until the app had finished drawing icons for a page that did not exist yet.
        Queued with callAfter instead, it lands a run-loop turn later, behind the load.
        Nothing downstream waits on it: _push_icons runs when this finishes, so whether it beats the
        page's `loaded` event or not, the icons arrive."""
        try:
            import AppKit
            if _file_icon.get("done"):
                return
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
        except Exception as exc:  # noqa: BLE001 — an app with no native icons is still a working app
            print(f"[titlebar] icons: {exc}", file=sys.stderr)
        # …and hand them to the page from a WORKER thread: evaluate_js parks on a completion the main
        # thread has to deliver, so calling it from this main-thread callback would deadlock the very
        # run loop that would service it (the same invariant _dialog_lock is bridge-thread-only for).
        threading.Thread(target=_push_icons, daemon=True).start()

    def _push_icons():
        """Hand whatever icons have been rasterised to the page. Guarded item by item, so it is a
        no-op when called before _rasterise_icons has run and complete once it has — which is what
        lets the rasteriser be queued behind the page load instead of ahead of it."""
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
        # unpaged)`. Overriding those two vars on documentElement (inline style beats the :root rule in macos-kit/mac-tokens.css)
        # upgrades every element that reads them, and leaves the hand-drawn masks in mac-tokens.css as the browser-design-mode
        # fallback exactly as before — same fall-through as __setSfSymbol's, one level up.
        sf_paged, sf_unpaged = _file_icon.get("sf_paged"), _file_icon.get("sf_unpaged")
        if sf_paged or sf_unpaged:
            try:
                setvar = "document.documentElement.style.setProperty('--sf-%s','url(\"'+%s+'\")')"   # string-concat the URI in JS, as bridge.js's own applySfSymbol does, so no quoting of the base64 payload is needed
                window.evaluate_js(";".join(
                    setvar % (k, json.dumps(uri)) for k, uri in (("paged", sf_paged), ("unpaged", sf_unpaged)) if uri))
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] layout symbol inject: {exc}", file=sys.stderr)


    def apply(*_):
        # SEED FROM THE LAST WINDOW'S NUMBERS FIRST. The traffic-light metrics and the tab-bar
        # geometry are properties of the app's window STYLE, not of any one window, so a window that
        # has just opened can be handed the previous window's values immediately instead of laying
        # out against the stylesheet's fallbacks (--tbH 44 vs the real 54) until its own measurement
        # lands. That is what a new tab's visible titlebar "redraw" was: not the native bar being
        # rebuilt, but the page reflowing once its own numbers arrived. The measurement below still
        # runs and still wins; this only removes the intermediate state.
        seed = _last_tb_js.get("js")
        if seed and not state.get("seeded"):
            state["seeded"] = True
            try:
                window.evaluate_js(seed)
            except Exception:  # noqa: BLE001 — the measurement below is the authority; a failed seed costs nothing
                pass
        holder = {"done": threading.Event(), "js": None}
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(_mutate, holder)   # NSWindow work on the main thread
            holder["done"].wait(6)
        except Exception:  # noqa: BLE001
            _mutate(holder)
        js = holder.get("js")
        if js:
            _last_tb_js["js"] = js   # …for the next window to start from
            try:
                window.evaluate_js(js)   # off the main thread → safe to block until the JS bridge is ready
            except Exception as exc:  # noqa: BLE001
                print(f"[titlebar] inject: {exc}", file=sys.stderr)
        if _file_icon.get("done"):
            _push_icons()   # already rasterised (an earlier window, or an earlier event on this one)
        else:
            # …and if not, queue it for a LATER run-loop turn rather than doing it here: this runs on
            # the `shown` handler, ahead of pywebview's own load(), and used to hold the main thread for
            # 210-285ms of every launch before the WKWebView could begin navigating (measured by
            # sampling the main thread at 15ms through three launches).
            try:
                from PyObjCTools import AppHelper
                AppHelper.callAfter(_rasterise_icons)
            except Exception:  # noqa: BLE001 — no run loop to defer into: do it inline, as before
                _rasterise_icons()
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
