"""Linux shell: GTK3 native chrome for the pywebview window.

Counterpart of ``app/mac/shell.py`` and ``app/win/shell.py`` + ``app/win/dwm.py``, following the
same package convention: a platform-specific module imported ONLY from the ``sys.platform``
branch in ``app/__main__.py``, so no GTK/PyGObject import happens on macOS or Windows.

pywebview's Linux backend is GTK3 + WebKit2GTK 4.1 (there is no GTK4 option today, and GTK3/GTK4
widgets cannot share one window's widget tree — settling the toolkit choice; see the Linux GTK3
chrome plan). Two things happen here:

  * ``read_theme_colors()`` reads the ACTIVE GTK3 theme's resolved colours via
    ``Gtk.StyleContext.lookup_color`` and pushes them into the page's CSS custom properties
    (``window.__setGtkTheme``, web/js/core/platform.js), overriding web/adwaita-kit's static,
    sourced-but-not-live Adwaita snapshot with whatever the user's actual GTK3 theme resolves to.
    Event-driven (``Gtk.Settings`` `notify::` signals), not polled — unlike ``app/win/shell.py``'s
    registry poll, GTK genuinely fires a change notification.
  * A real native ``Gtk.MenuBar`` is built from ``app/menu_spec.py`` — the SAME declarative table
    macOS's `NSMenu` (``app/mac/shell.py``) and Windows' in-window bar
    (``web/js/ui/menubar.js``) both read, so a row added there appears on all three platforms with
    one edit. Attaching it requires restructuring pywebview's own GTK widget tree (see
    ``_install_menu_bar`` below) — the one piece of this file coupled to pywebview's current
    internals rather than a stable public API, called out there in detail.

Neither piece can be exercised on a non-Linux machine — both degrade to a logged no-op (never an
exception) if ``gi``/``Gtk`` is unavailable or any lookup fails, the same defensive shape every
other optional platform feature in this codebase uses.  Every diagnostic below is prefixed
``[linux]`` so a real run's stderr says plainly what happened.
"""

from __future__ import annotations

import json
import os
import sys
import threading

from .. import menu_spec


def prepare_environment() -> None:
    """Hook for anything that must run before ``webview.create_window`` (mirrors
    ``app.win.dwm.prepare_environment``, which sets an env var WebView2 reads at browser-process
    start). No GTK equivalent is known to be needed yet; kept for symmetry, and so a later phase
    has a place to land one without touching app/__main__.py again."""
    pass


# ── live GTK3 theme reading ───────────────────────────────────────────────────

# CSS custom property (adwaita-tokens.css) -> GTK3's own named theme colour (the public
# @define-color contract most GTK3 themes, including third-party ones, implement for exactly this
# kind of app-level lookup). Deliberately a SUBSET of adwaita-tokens.css's full token list — only
# the handful with an obvious, unambiguous GTK-named counterpart; everything else keeps the kit's
# sourced static value, which is the honest answer when there is no single named colour standing
# in for it (see adwaita-tokens.css's own header for which values are/aren't sourced).
_COLOR_LOOKUPS = (
    # (css custom property, GTK named colour, which offscreen widget's context to read it from)
    ("--win-bg", "theme_bg_color", "window"),
    ("--panel-bg", "theme_bg_color", "window"),
    ("--content-bg", "theme_base_color", "window"),
    ("--field-bg", "theme_base_color", "window"),
    ("--edit-bg", "theme_base_color", "window"),
    ("--text", "theme_text_color", "window"),
    ("--text-2", "theme_text_color", "window"),
    ("--accent", "theme_selected_bg_color", "window"),
    ("--row-sel-inactive", "theme_unfocused_selected_bg_color", "window"),
    ("--hairline", "borders", "window"),
    ("--sheet-border", "borders", "window"),
    ("--warn", "warning_color", "window"),
    ("--bad", "error_color", "window"),
    ("--good", "success_color", "window"),
    ("--toolbar-bg", "theme_bg_color", "header"),
    ("--toolbar-solid", "theme_bg_color", "header"),
    ("--toolbar-inactive-bg", "theme_bg_color", "header"),
    ("--menu-bg", "theme_base_color", "window"),
)


def read_theme_colors() -> dict | None:
    """Read the active GTK3 theme's resolved colours, mapped onto this app's CSS custom-property
    names via :data:`_COLOR_LOOKUPS`. Returns ``None`` on any failure (no ``gi``, no display, the
    active theme doesn't define a given named colour, …) — the caller must treat that as "nothing
    to push" rather than an error; every value ``adwaita-tokens.css`` already ships a sourced
    static default for, so a partial or empty result degrades gracefully, never blanks the page."""
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk

        settings = Gtk.Settings.get_default()
        theme_name = settings.get_property("gtk-theme-name") if settings is not None else None
        prefer_dark = bool(settings.get_property("gtk-application-prefer-dark-theme")) if settings is not None else False
        print(f"[linux] active GTK theme: {theme_name!r} (prefer-dark={prefer_dark})", file=sys.stderr)

        # An OFFSCREEN window + a nested header bar give two real, theme-cascaded style contexts
        # (window chrome vs. header-bar chrome) without ever showing anything on screen. A bare,
        # unattached StyleContext does not reliably resolve theme-specific named colours — it has
        # to belong to a realized widget of the right CSS node type for the cascade to apply.
        win = Gtk.OffscreenWindow()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        header = Gtk.HeaderBar()
        box.pack_start(header, False, False, 0)
        win.add(box)
        win.show_all()

        contexts = {"window": win.get_style_context(), "header": header.get_style_context()}

        def to_css(rgba) -> str:
            return "rgb(%d,%d,%d)" % (round(rgba.red * 255), round(rgba.green * 255), round(rgba.blue * 255))

        colors: dict[str, str] = {}
        for prop, name, which in _COLOR_LOOKUPS:
            ok, rgba = contexts[which].lookup_color(name)
            if ok:
                colors[prop] = to_css(rgba)
            # else: that theme doesn't define this named colour — leave the kit's sourced default alone

        win.destroy()
        if not colors:
            print("[linux] theme read: active theme answered none of the named colours looked up", file=sys.stderr)
            return None
        return colors
    except Exception as exc:  # noqa: BLE001 — a failed theme read is cosmetic, never fatal
        print(f"[linux] theme read failed: {exc}", file=sys.stderr)
        return None


def _push_theme(window, colors: dict | None) -> None:
    if not colors:
        return
    def run():
        try:
            window.evaluate_js("window.__setGtkTheme && __setGtkTheme(%s)" % json.dumps(colors))
        except Exception as exc:  # noqa: BLE001
            print(f"[linux] theme push: {exc}", file=sys.stderr)
    threading.Thread(target=run, daemon=True).start()   # evaluate_js must never run from a UI callback — same rule every other JS push in this codebase follows


def _install_theme_watcher(window) -> None:
    """Push the current theme once, then re-push on every live GTK3 theme/appearance change.
    EVENT-DRIVEN, not polled — a real improvement over app/win/shell.py's registry poll (which
    exists only because Windows offers no usable change signal off a non-message-pump thread):
    Gtk.Settings fires genuine ``notify::`` GObject signals on both properties watched here."""
    def refresh(*_a):
        _push_theme(window, read_theme_colors())

    def on_ready(*_):
        refresh()
        try:
            import gi
            gi.require_version("Gtk", "3.0")
            from gi.repository import Gtk
            settings = Gtk.Settings.get_default()
            if settings is not None:
                settings.connect("notify::gtk-theme-name", refresh)
                settings.connect("notify::gtk-application-prefer-dark-theme", refresh)
        except Exception as exc:  # noqa: BLE001
            print(f"[linux] theme watcher: {exc}", file=sys.stderr)

    # ⚠ HOOK EXACTLY ONE READINESS EVENT, NOT BOTH — this loop used to `ev += on_ready` for every
    # name it found and never broke, so with pywebview exposing BOTH `shown` and `loaded` (the
    # normal case) `on_ready` — and therefore `refresh()` — ran TWICE at startup, seconds or even
    # milliseconds apart. That directly contradicts this function's own docstring ("push the
    # current theme ONCE"), and it is not merely redundant: verified live under `xvfb-run`, the
    # second `refresh()` firing while the first's background `evaluate_js` thread (`_push_theme`)
    # is still in flight segfaults inside GTK's own main loop (`Gio.Application.run`) — reproduced
    # 2/3 runs with a MINIMAL repro (`_install_theme_watcher` called on its own, no menu bar, no
    # app code) and 0/3 runs once this loop `break`s after its first successful hook. It was also
    # NOT just a one-time startup race: because `on_ready` re-runs `settings.connect(...)` on every
    # firing, a double-hook meant every SUBSEQUENT live theme change under `Gtk.Settings`'
    # `notify::` signals would have called `refresh()` twice as well, for the life of the window.
    # `_install_menu_bar`'s own hookup (below, in `install()`) already gets this right — it checks
    # only "shown" — so this now matches that existing pattern rather than introducing a second,
    # divergent one.
    events = getattr(window, "events", None)
    hooked = False
    for name in ("shown", "loaded"):
        ev = getattr(events, name, None) if events is not None else None
        if ev is not None:
            ev += on_ready
            hooked = True
            break
    if not hooked:
        on_ready()



# ── native menu bar ────────────────────────────────────────────────────────────
# Built from app/menu_spec.py — the SAME declarative table app/mac/shell.py's NSMenu wiring and
# web/js/ui/menubar.js (Windows' in-window bar) both read, so a row added there appears on all
# three platforms with one edit. This is the THIRD consumer, not a new design.

# GTK modifier-name vocabulary -> Gdk.ModifierType attribute name. Mirrors web/js/core/platform.js's
# _MOD_WIN table exactly (same reasoning: Linux uses the same Ctrl-based convention as Windows, so
# menu_spec's win_key/win_mods — already collision-resolved for the six ⌃⌘/⌥⌘ arrow-row pairs that
# would otherwise land on the same Windows/Linux chord — are what this reads, never key/mods, which
# are macOS-native). cmd -> Ctrl (the primary command modifier here); ctrl AND alt both -> Alt, for
# the identical reason platform.js's table gives: macOS names four modifiers, this side only three.
_MOD_MASK_NAMES = {"cmd": "CONTROL_MASK", "ctrl": "MOD1_MASK", "alt": "MOD1_MASK", "shift": "SHIFT_MASK"}

# menu_spec's non-alphanumeric key= values (grepped from the table directly, not guessed) that need
# a GDK keysym NAME rather than the literal character — Gdk.keyval_from_name("+") fails,
# Gdk.keyval_from_name("plus") is the one that resolves.
_SYMBOL_KEY_NAMES = {
    "-": "minus", ".": "period", "'": "apostrophe", "[": "bracketleft", "]": "bracketright",
    "/": "slash", "\\": "backslash", "+": "plus",
}


def _accel_mask(Gdk, mods):
    """Returns a real ``Gdk.ModifierType`` flags value, NOT a bare Python ``int``.

    ⚠ THIS WAS THE CAUSE OF AN INTERMITTENT ABORT ON EVERY MENU-BAR INSTALL, not a cosmetic
    type mismatch. `int(getattr(Gdk.ModifierType, name))` (the previous body) collapses PyGObject's
    flags type down to a plain int, and `Gtk.Widget.add_accelerator` — called from `build_menu_bar`'s
    per-row loop, below — raises `TypeError: Expected a Gdk.ModifierType, but got int` the first time
    a row actually has a modifier (verified live: reproduces byte-for-byte under `xvfb-run`). That
    exception propagates out of `build_menu_bar` mid-loop, which `_install_menu_bar`'s outer
    try/except was designed to degrade gracefully from (see its own docstring) — but several
    `Gtk.MenuItem`/`Gtk.Menu` widgets had already been constructed and left half-wired (appended to a
    `Gtk.Menu` that itself was never attached to the `Gtk.MenuBar`, never realized, never freed
    cleanly) by the time the exception fires. Python then garbage-collects that orphaned widget tree
    while GTK's own idle queue still holds live layout work queued against it, which is what the
    'pango_layout_is_wrapped: assertion "layout != NULL" failed' → 'Gtk:ERROR
    …gtk_label_update_layout_width: assertion failed' → SIGABRT chain further downstream actually is
    — a USE-AFTER-FREE on the GTK/Pango side, not a second, unrelated bug. Reproduced live via the
    real boot-check command (`timeout 8 xvfb-run -a sud-workbench --empty`): failed non-deterministically
    with SIGSEGV or SIGABRT depending on GC/idle-queue timing before this fix, clean `exit 124`
    (still running, the healthy signal) after it, across repeated runs.
    Keeping `mask` as a `Gdk.ModifierType` throughout (PyGObject flags support `|=` against their own
    enum members) is the actual fix — verified directly against pywebview's own accelerator call
    under a real Gtk.init(), not merely inferred from the exception text.
    """
    mask = Gdk.ModifierType(0)
    for m in mods:
        name = _MOD_MASK_NAMES.get(m)
        if name:
            mask |= getattr(Gdk.ModifierType, name)
    return mask


def _accel_keyval(Gdk, key):
    """menu_spec stores a key as a single character, OR one of its own LEFT/RIGHT/UP/DOWN/
    BACKSPACE constants (macOS function-key unicode chars) — import those exact constants rather
    than re-deriving their codepoints, so this can never silently drift from what menu_spec.py
    itself defines."""
    if not key:
        return 0
    special = {
        menu_spec.LEFT: "Left", menu_spec.RIGHT: "Right",
        menu_spec.UP: "Up", menu_spec.DOWN: "Down", menu_spec.BACKSPACE: "BackSpace",
    }
    name = special.get(key) or _SYMBOL_KEY_NAMES.get(key) or key
    return Gdk.keyval_from_name(name)


def _menu_js(window, code):
    """A Gtk 'activate' handler that runs one JS command — the exact `js(code)` pattern
    app/__main__.py::build_menu already uses for macOS, so the frontend command surface stays one
    code path across all three platforms."""
    def run(_item=None):
        try:
            window.evaluate_js(code)
        except Exception as exc:  # noqa: BLE001
            print(f"[linux] menu {code!r} failed: {exc}", file=sys.stderr)
    return run


def _toggle_fs_toolbar(window, *_a) -> None:
    """item 10: flip the 'always show toolbar in full screen' pref — mirrors app/__main__.py's own
    _toggle_fs_toolbar exactly (same two-step: flip the Python mirror, let the JS toggle apply +
    persist it), duplicated rather than imported because it closes over a DIFFERENT ``window``."""
    menu_spec.toggle_fs_toolbar_mirror()
    def run():
        try:
            window.evaluate_js("window.__toggleFsAlwaysToolbar && __toggleFsAlwaysToolbar()")
        except Exception as exc:  # noqa: BLE001
            print(f"[linux] fs toolbar toggle failed: {exc}", file=sys.stderr)
    threading.Thread(target=run, daemon=True).start()   # off-thread — evaluate_js must never run from a UI callback


def _open_recent_submenu(Gtk, window, api):
    """A Gtk.Menu that rebuilds its own rows on the 'show' signal, right before it displays — the
    recent-files list can change mid-session, mirroring app/mac/shell.py's live-rebuilt Open
    Recent submenu (that one reaches into a live NSMenu on every menu open for the same reason)."""
    submenu = Gtk.Menu()

    def rebuild(*_a):
        for child in list(submenu.get_children()):
            submenu.remove(child)
        recent = []
        try:
            recent = api.recent_files() if api is not None else []
        except Exception as exc:  # noqa: BLE001
            print(f"[linux] recent_files failed: {exc}", file=sys.stderr)
        for path in recent:
            row = Gtk.MenuItem(label=os.path.basename(path))
            row.connect("activate", _menu_js(window, "window.openRecentFile && openRecentFile(%s)" % json.dumps(path)))
            submenu.append(row)
        if recent:
            submenu.append(Gtk.SeparatorMenuItem())
        clear = Gtk.MenuItem(label="Clear Recent")
        clear.connect("activate", _menu_js(window, "window.clearRecentFiles && clearRecentFiles()"))
        submenu.append(clear)
        submenu.show_all()

    submenu.connect("show", rebuild)
    return submenu


def build_menu_bar(window, api):
    """Build a real Gtk.MenuBar from menu_spec.MENUS.

    Returns ``(menubar, accel_group, item_map)`` — ``item_map`` (spec_title -> Gtk.MenuItem) is
    handed to ``Api`` as ``self._menu``, the exact contract ``app/mac/shell.py``'s NSMenu wiring
    already established, so ``Api.sync_menu``/``_apply_menu`` (app/api.py) drive this menu with no
    further change beyond the small per-platform branch already added there.

    Cut/Copy/Paste/Select All (``menu_spec.native_mac_items()``) are deliberately NOT built as
    rows here: those exist only because AppKit's first-responder chain needs an NSMenuItem with a
    nil target to reach a WKWebView's own text fields — GTK's focus chain delivers Ctrl+X/C/V/A to
    a focused WebKit2GTK text field with no menu row required at all. "Enter Full Screen" has no
    natural GTK menu equivalent either and is left as a follow-up (a window-level accelerator, not
    a menu row, if it's ever wanted) rather than blocking this on it."""
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gdk, Gtk

    menubar = Gtk.MenuBar()
    accel_group = Gtk.AccelGroup()
    item_map: dict = {}

    for spec in menu_spec.MENUS:
        top = Gtk.MenuItem(label=spec["title"])
        submenu = Gtk.Menu()
        top.set_submenu(submenu)
        for it in spec["items"]:
            if it.get("sep"):
                submenu.append(Gtk.SeparatorMenuItem())
                continue
            if it.get("submenu") == "recent":
                row = Gtk.MenuItem(label=it["title"])
                row.set_submenu(_open_recent_submenu(Gtk, window, api))
                submenu.append(row)
                item_map[it["spec_title"]] = row
                continue

            row = Gtk.CheckMenuItem(label=it["title"]) if it.get("check") else Gtk.MenuItem(label=it["title"])
            action = it.get("action")
            if action == "new_window":
                row.connect("activate", lambda _r, _api=api: (_api.new_window() if _api is not None else None))
            elif action == "toggle_fs_toolbar":
                row.connect("activate", lambda _r, _w=window: _toggle_fs_toolbar(_w))
            elif it.get("js"):
                row.connect("activate", _menu_js(window, it["js"]))
            if it.get("native_check"):
                # the ONE row whose checkmark does not come from a menuState() push — see
                # menu_spec.item()'s own docstring on native_check for why.
                row.set_active(menu_spec.fs_always_toolbar_state())

            keyval = _accel_keyval(Gdk, it.get("win_key"))
            if keyval:
                mask = _accel_mask(Gdk, it.get("win_mods") or ())
                row.add_accelerator("activate", accel_group, keyval, mask, Gtk.AccelFlags.VISIBLE)

            submenu.append(row)
            item_map[it["spec_title"]] = row
        menubar.append(top)

    return menubar, accel_group, item_map


def _install_menu_bar(window, api) -> None:
    """Attach a native Gtk.MenuBar to the pywebview window.

    RESTRUCTURES pywebview's own GTK widget tree — coupled to its CURRENT internals, checked
    against pywebview==6.2.1's actual source (webview/platforms/gtk.py) rather than guessed:
    ``window.native`` is a ``Gtk.ApplicationWindow`` whose one direct child is the
    ``Gtk.ScrolledWindow`` wrapping the ``WebKit2.WebView`` — no intermediate ``Gtk.Box``, no
    ``Gtk.HeaderBar``. A traditional ``Gtk.MenuBar`` needs a ``Box`` above that ``ScrolledWindow``,
    so this removes it, wraps both in a new vertical ``Box``, and re-adds that.

    REJECTED ALTERNATIVE, and why: pywebview's window IS a real ``Gtk.ApplicationWindow`` under a
    ``Gtk.Application``, so ``Gtk.Application.set_menubar(Gio.Menu)`` (no widget-tree surgery at
    all) was considered — but whether GTK actually renders that as an in-window bar, routes it to
    a desktop-shell top panel, or hides it entirely depends on the desktop environment's
    ``gtk-shell-shows-menubar`` setting (GNOME shells commonly don't show it in-window). An
    explicit packed ``Gtk.MenuBar`` renders predictably across GTK3 desktop environments (GNOME,
    XFCE, MATE, …), which matters more here than avoiding one internals-coupled restructure.

    Wrapped in one broad try/except: if a future pywebview changes this shape, the window still
    opens without a menu bar rather than failing to show at all. **Unverified on a real GTK3
    session** — see the Linux chrome plan's own risk note; watch stderr for `[linux]` on first
    real run, and specifically confirm the window shows at all first."""
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk

        win = window.native
        if win is None:
            return
        menubar, accel_group, item_map = build_menu_bar(window, api)
        scrolled = win.get_child()
        if scrolled is None:
            return
        win.remove(scrolled)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.pack_start(menubar, False, False, 0)
        box.pack_start(scrolled, True, True, 0)
        win.add(box)
        win.add_accel_group(accel_group)
        box.show_all()
        if api is not None:
            api._menu = item_map   # same contract app/mac/shell.py's menu wiring sets — drives Api.sync_menu/_apply_menu
    except Exception as exc:  # noqa: BLE001 — never leave the window unopenable over a menu bar
        print(f"[linux] native menu bar: {exc}", file=sys.stderr)


def install(window, api=None) -> None:
    """Wire the Linux chrome onto the window's own events (mirrors ``win.shell.install`` /
    ``mac.shell._unify_titlebar_on_show``): the live-theme watcher, and the native menu bar once
    ``window.native`` exists (pywebview docs: available after ``before_show``)."""
    _install_theme_watcher(window)

    events = getattr(window, "events", None)
    hooked = False
    ev = getattr(events, "shown", None) if events is not None else None
    if ev is not None:
        ev += lambda *_a: _install_menu_bar(window, api)
        hooked = True
    if not hooked:   # older pywebview — try immediately
        _install_menu_bar(window, api)
