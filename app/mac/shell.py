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
