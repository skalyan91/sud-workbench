"""THE menu table — one declarative source of truth for every platform's menus.

macOS puts the menu in the system menu bar (an ``NSMenu`` built by ``build_menu`` in
``app/__main__.py`` and re-wired by ``app/mac/shell.py``); Windows draws it *inside* the window
(``web/js/ui/menubar.js``, fed this same table as JSON by :meth:`app.api.Api.menu_spec`).  Before
this module existed the two would have been a hand-kept copy of each other — the titles lived in
``build_menu``, the key equivalents / SF Symbols / conditional + checkable sets in a 78-entry
``specs`` dict inside ``_wire_menu``, and a THIRD copy of the visibility rules in
``Api._apply_menu``.  Three copies of one fact drift; this file is the fact.

Every entry carries, in one place:
  ``title``      what the menu row says (with its trailing "…" where it opens something)
  ``spec_title`` the same title with "…" stripped — what the AppKit wiring keys on, because
                 ``NSMenuItem.title()`` is compared after the ellipsis is removed
  ``js``         the frontend helper the row invokes.  BOTH platforms call the same one, which is
                 what keeps the command logic single-sourced: the menus are two skins over one API.
  ``action``     a NATIVE action name instead, for the two rows the web layer cannot do alone
                 (spawning a second process; flipping the Python-side full-screen-toolbar mirror)
  ``key``/``mods``  the accelerator, stored portably (``"n"`` + ``["cmd", "shift"]``) rather than as
                 AppKit flags, so the Windows side can render it without importing AppKit
  ``sf``         SF Symbol name (macOS menu icon); ``sf_rtl`` where the glyph mirrors under RTL
  ``fluent``     the Fluent (Segoe Fluent Icons) counterpart, for the in-window menu bar
  ``vis``        the name of the conditional-visibility rule (see :func:`visibility`), or None for
                 an always-shown row
  ``check``      the ``menuState()`` key whose truth draws the row's checkmark

Rationale comments lifted from the two original sites are preserved verbatim beside their entries —
several of them are the only surviving record of why a particular key is bound where it is.
"""

from __future__ import annotations

import json
import os

from .paths import APP_DATA

# ── accelerator vocabulary ───────────────────────────────────────────────────
# Modifiers are named, never encoded: AppKit wants NSEventModifierFlag* ints, the web layer wants
# "⇧⌘" glyphs (which js/core/platform.js then localises to "Ctrl+Shift+…"), and neither
# representation can be the stored one without dragging that platform's headers into this file.
MODS = ("cmd", "shift", "ctrl", "alt")

# Non-alphanumeric keys, stored as the macOS function-key characters AppKit expects
# (NSLeftArrowFunctionKey &c.) so the mac side needs no translation at all.
LEFT, RIGHT = chr(0xF702), chr(0xF703)      # NSLeft/RightArrowFunctionKey
UP, DOWN = chr(0xF700), chr(0xF701)         # NSUp/DownArrowFunctionKey
BACKSPACE = chr(0x08)

# …and the glyphs the web layer prints for them.  ⌫ rather than ⌦: ⌘⌫ is macOS's *backward* delete.
_KEY_GLYPH = {LEFT: "←", RIGHT: "→", UP: "↑", DOWN: "↓", BACKSPACE: "⌫"}
_MOD_GLYPH = [("ctrl", "⌃"), ("alt", "⌥"), ("shift", "⇧"), ("cmd", "⌘")]   # macOS prints them in THIS order, always


def accel_label(key: str | None, mods=()) -> str:
    """The macOS-glyph spelling of one accelerator ("⇧⌘N", "⌃⌘←", "⌘⌫"), or "".

    Deliberately produced in macOS notation even for the Windows menu bar: ``accel()`` in
    ``js/core/platform.js`` already rewrites glyph runs into "Ctrl+Shift+N" for the ~200 tooltips
    the app writes that way, so emitting the same notation here means the menu bar's labels go
    through the ONE translator rather than a second, divergent one."""
    if not key:
        return ""
    out = "".join(g for name, g in _MOD_GLYPH if name in mods)
    return out + _KEY_GLYPH.get(key, key.upper())


def item(title, js=None, *, key=None, mods=(), win_key=None, win_mods=None, sf=None, sf_rtl=None,
         fluent=None, vis=None, check=None, native_check=False, action=None, submenu=None,
         spec_title=None) -> dict:
    """One menu row.  ``title`` keeps its "…"; ``spec_title`` (what the AppKit wiring matches on)
    is derived by stripping it, exactly as ``_wire_menu`` has always done.

    ``native_check`` marks the one row whose checkmark does NOT come from a ``menuState()`` push:
    the full-screen-toolbar pref is read from disk / the Python mirror, so the selection-state pass
    must leave it alone (driving it from an absent state key would clear it on every selection).

    ``win_key``/``win_mods`` REBIND the row on Windows only, and exist for one reason: macOS names
    four modifiers and Windows three, so ⌃⌘ and ⌥⌘ both have to land on Ctrl+Alt (see the mapping
    note in js/core/platform.js).  Six of the arrow rows below are one half of a ⌃⌘/⌥⌘ PAIR, and
    without an override the pair would arrive at the same Windows chord and both fire.  The override
    is per-item on purpose — the generic ⌃→Alt mapping stays exactly as it is for the five ⌃⌘ letter
    shortcuts, which collide with nothing.  ``win_accel`` is written in the same macOS glyph
    notation as ``accel``, because it overrides the CHORD, not the notation: js/ui/menubar.js prints
    it through the one translator (``accel()``) and matches keystrokes against the same string, so
    the label and the handler cannot disagree."""
    wk = win_key if win_key is not None else key
    wm = list(win_mods) if win_mods is not None else list(mods)
    return {
        "title": title,
        "spec_title": spec_title or title.replace("…", "").strip(),
        "js": js, "action": action, "submenu": submenu,
        "key": key, "mods": list(mods),
        "accel": accel_label(key, mods),
        # Emitted only where it DIFFERS, so a reader of the JSON can tell an override from a copy.
        "win_accel": (accel_label(wk, wm) if (win_key is not None or win_mods is not None) else None),
        "sf": sf, "sf_rtl": sf_rtl, "fluent": fluent,
        "vis": vis, "check": check, "native_check": bool(native_check),
    }


SEP = {"sep": True}


# ── the table ────────────────────────────────────────────────────────────────
# Order here IS the macOS menu order (File, Format, Edit, View, Help) — build_menu walks this list
# straight through.  The Windows menu bar reorders the top level to the Windows convention (see
# WIN_ORDER below); the ROWS inside each menu are identical on both platforms.
MENUS: list[dict] = [
    {"title": "File", "items": [
        item("New", "window.doNew && doNew()",
             key="n", mods=("cmd", "shift"), sf="square.and.pencil", fluent="Add"),   # ⇧⌘N — ⌘N is now New Window (item 14)
        # item 14: fresh window + empty doc (a DETACHED second process — pywebview is single-window)
        item("New Window", "window.__newWindow && __newWindow()", action="new_window",
             key="n", mods=("cmd",), sf="macwindow.badge.plus", fluent="NewWindow"),
        item("Open…", "window.doOpen && doOpen()", key="o", mods=("cmd",), sf="folder", fluent="OpenFolderHorizontal"),
        item("Open Recent", submenu="recent", sf="clock.arrow.circlepath", fluent="Recent"),   # submenu parent (no key-equivalent)
        item("Append…", "window.doAppend && doAppend()",
             key="o", mods=("cmd", "shift"), sf="plus.rectangle.on.folder", fluent="FolderAdd"),
        item("Insert Text…", "window.addTextSheet && addTextSheet()",
             key="t", mods=("cmd",), sf="text.badge.plus", fluent="InsertTextBox"),
        SEP,
        item("Import UD…", "window.doImportUD && doImportUD()",
             key="i", mods=("cmd", "shift"), sf="square.and.arrow.down.on.square", fluent="Import"),   # ⇧⌘I — ⌘I is now Mark as Foreign
        item("Import Toolbox…", "window.doImportToolbox && doImportToolbox()",
             sf="list.bullet.rectangle", fluent="BulletedListText"),   # interlinear Toolbox import (no key equivalent)
        item("Export as UD…", "window.doExportUD && doExportUD()",
             key="e", mods=("cmd", "shift"), sf="square.and.arrow.up.on.square", fluent="Export"),
        SEP,
        item("Save", "window.doSave && doSave()", key="s", mods=("cmd",), sf="square.and.arrow.down", fluent="Save"),
        item("Save As…", "window.doSaveAs && doSaveAs()",
             key="s", mods=("cmd", "shift"), sf="square.and.arrow.down.on.square", fluent="SaveAs"),
        item("Rename…", "window.doRename && doRename()", key="r", mods=("cmd", "shift"), sf="pencil", fluent="Rename"),
    ]},
    {"title": "Format", "items": [
        item("Convert to SUD", "window.convertTo && convertTo('SUD')",
             sf="arrow.triangle.2.circlepath", fluent="ArrowSync"),
        # A RELABEL, not a conversion (there is no automatic SUD → mSUD grammar): it puts the live document
        # into mSUD annotation mode so the "/m" relations become available. See js/io/formats.js.
        item("Annotate as mSUD", "window.annotateAsMSUD && annotateAsMSUD()", fluent="TextBulletListSquareEdit"),
        SEP,
        item("Manage Models…", "window.manageModels && manageModels()",
             key="m", mods=("cmd", "shift"), sf="cube.box", fluent="Box"),
    ]},
    {"title": "Edit", "items": [
        item("Undo", "window.undo && undo()", key="z", mods=("cmd",), sf="arrow.uturn.backward", fluent="ArrowUndo"),
        item("Redo", "window.redo && redo()", key="z", mods=("cmd", "shift"), sf="arrow.uturn.forward", fluent="ArrowRedo"),
        SEP,
        item("Find…", "window.openFind && openFind()", key="f", mods=("cmd",), sf="magnifyingglass", fluent="Search"),
        # Same bar, panel already down (js/ui/find.js openFindReplace) — so the toolbar, ⌘F and this
        # item all run one code path. Deliberately NOT in `conditional`: it opens the panel whatever
        # the document holds, so an always-enabled item is an honest one.
        item("Find and Replace…", "window.openFindReplace && openFindReplace()",
             key="f", mods=("cmd", "alt"), sf="text.magnifyingglass", fluent="DocumentSearch"),   # ⌥⌘F — the macOS standard (TextEdit, Pages, Xcode all bind Find and Replace there)
        # token actions — shown/hidden per selection + focused pane by Api.sync_menu (this separator too)
        SEP,
        item("Group as Multi-word Token", "window.groupMWTShortcut && groupMWTShortcut()",
             key="g", mods=("cmd",), sf="arrow.right.and.line.vertical.and.arrow.left",
             fluent="ArrowMinimize", vis="group"),
        # …and the destructive counterpart of it: Group lays a surface form OVER several tokens, Merge
        # replaces them with one. Adjacent in the menu because they take the same selection.
        # ⌃⌘M, checked against every other binding in this table (⌘M is the system Minimize; ⌥⌘M and
        # ⇧⌘M are free too, but ⌃⌘ is already this app's modifier for the token-STRUCTURAL commands —
        # ⌃⌘←→↑↓ move, ⌃⌘[ ] re-head, ⌃⌘R set as root — and a merge is one of those, not an MWT command.
        item("Merge Tokens", "window.mergeTokensShortcut && mergeTokensShortcut()",
             key="m", mods=("ctrl", "cmd"), sf="arrow.trianglehead.merge", fluent="Merge", vis="merge"),
        item("Ungroup Multi-word Token", "window.ungroupMWTShortcut && ungroupMWTShortcut()",
             key="g", mods=("cmd", "shift"), sf="arrow.left.and.line.vertical.and.arrow.right",
             fluent="ArrowMaximize", vis="ungroup"),
        item("Split into Multi-word Token…", "window.convertTokenMWT && convertTokenMWT()",
             key="s", mods=("cmd", "alt"), sf="square.split.2x1", fluent="SplitHorizontal", vis="convmwt"),   # ⌥⌘S — "split"
        # MOVED off ⌥⌘F, which Find and Replace above now holds. The collision was not survivable:
        # AppKit matches a key equivalent against the FIRST eligible item in menu order, and Find and
        # Replace sits above this one in the Edit menu — so ⌥⌘F would have flattened nothing and this
        # item's shortcut would have been dead exactly when an MWT was selected and it became visible
        # (a hidden item is skipped, which is what would have masked the clash in casual testing).
        # ⌥⌘G puts it beside its own family instead — ⌘G group, ⇧⌘G ungroup, ⌥⌘G flatten.
        item("Flatten Multi-word Token", "window.flattenTokenMWT && flattenTokenMWT()",
             key="g", mods=("cmd", "alt"), sf="square.split.1x2", fluent="SplitVertical", vis="flatmwt"),
        # THE ⌃⌘/⌥⌘ ARROW PAIRS, and the one place this app's shortcuts are not the same on both
        # platforms.  MOVE takes ⌃⌘+arrow and INSERT takes ⌥⌘+arrow — two distinct chords on macOS,
        # one chord (Ctrl+Alt+arrow) once ⌃ and ⌥ have both been mapped to Alt.  Move is the half
        # that moves: ⇧⌘+arrow on Windows, verified unused anywhere in the codebase (the grid's own
        # Shift+arrow range-extension takes NO Ctrl, so it does not collide).  Insert keeps the
        # generic mapping and needs no override, now that nothing shares it.
        item("Move Token Left", "window.moveTokenLeft && moveTokenLeft()",
             key=LEFT, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.left", fluent="ArrowLeft", vis="diagram"),
        item("Move Token Right", "window.moveTokenRight && moveTokenRight()",
             key=RIGHT, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.right", fluent="ArrowRight", vis="diagram"),
        item("Move Token Up", "window.moveTokenUp && moveTokenUp()",
             key=UP, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.up", fluent="ArrowUp", vis="grid"),
        item("Move Token Down", "window.moveTokenDown && moveTokenDown()",
             key=DOWN, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.down", fluent="ArrowDown", vis="grid"),
        item("Insert Token Left", "window.insertTokenLeft && insertTokenLeft()",
             key=LEFT, mods=("cmd", "alt"), sf="arrow.left.to.line", fluent="ArrowExportLtr", vis="diagram"),
        item("Insert Token Right", "window.insertTokenRight && insertTokenRight()",
             key=RIGHT, mods=("cmd", "alt"), sf="arrow.right.to.line", fluent="ArrowExportRtl", vis="diagram"),
        item("Insert Token Above", "window.insertTokenAbove && insertTokenAbove()",
             key=UP, mods=("cmd", "alt"), sf="arrow.up.to.line", fluent="ArrowExportUp", vis="grid"),
        item("Insert Token Below", "window.insertTokenBelow && insertTokenBelow()",
             key=DOWN, mods=("cmd", "alt"), sf="arrow.down.to.line", fluent="ArrowExport", vis="grid"),
        # the head-stepping icons point toward the earlier/later token, so they MIRROR under RTL — hence sf_rtl
        item("Select Previous Head", "window.selectPrevHead && selectPrevHead()",
             key="[", mods=("ctrl", "cmd"), sf="chevron.left.2", sf_rtl="chevron.right.2",
             fluent="ChevronLeft", vis="has"),
        item("Select Next Head", "window.selectNextHead && selectNextHead()",
             key="]", mods=("ctrl", "cmd"), sf="chevron.right.2", sf_rtl="chevron.left.2",
             fluent="ChevronRight", vis="has"),
        item("Set as Root", "window.setTokenAsRoot && setTokenAsRoot()",
             key="r", mods=("ctrl", "cmd"), sf="asterisk.circle", fluent="Star", vis="has"),
        # opens the same lemma popover a double-click on a token's form opens (js/editing/context-menu.js
        # editLemmaPrompt) — token-conditional like the rest of this group, shown/hidden by Api._apply_menu
        item("Edit Lemma…", "window.editLemmaShortcut && editLemmaShortcut()",
             key="l", mods=("cmd",), sf="character.book.closed", fluent="BookLetter", vis="has"),   # ⌘L — free: "Wrap Long Lines" already spent ⌃⌘L, plain ⌘L is unused (no browser-style "location bar" in this app)
        # items 2/3 — marker FEATS on the selected token(s): checkable, state pushed by Api._apply_menu
        item("Mark as Foreign", "window.toggleForeign && toggleForeign()",
             key="i", mods=("cmd",), sf="globe", fluent="Globe", vis="has", check="foreign"),   # ⌘I — FEATS Foreign=Yes, drawn as an italic form (Import UD moved to ⇧⌘I)
        item("Mark as Typo", "window.toggleTypo && toggleTypo()",
             key="/", mods=("cmd",), sf="exclamationmark.bubble", fluent="ErrorCircle", vis="has", check="typo"),   # ⌘/ — FEATS Typo=Yes, drawn as a struck-through form
        item("Mark as Reported Speech", "window.toggleReported && toggleReported()",
             key="'", mods=("cmd", "shift"), sf="quote.bubble", fluent="CommentQuote",
             vis="has", check="reported"),   # ⇧⌘' — item 7: MISC Reported=Yes on the head of the selection
        # sentence actions (folded in from the old Sentence menu) — insert/move/delete share the token
        # shortcuts and are shown only when a block is selected without a token; the rest are always available
        # item 2 — document/paragraph structure (universaldependencies.org/format.html). The first two act on
        # the sentence being read (`# newdoc` / `# newpar`) and are always available; the third writes MISC
        # NewPar=Yes on the selected TOKEN, for a paragraph that starts mid-sentence, so it is token-conditional.
        SEP,
        # item 2 — the boundary commands take ⇧⌘D / ⇧⌘P, both free (the ⌘D and ⌘R families are already
        # spent on Duplicate Sentence and Reset Parse), and the mid-sentence one adds ⌥ to its own pair
        item("Document Boundary", "window.toggleDocBoundary && toggleDocBoundary()",
             key="d", mods=("cmd", "shift"), sf="text.book.closed", fluent="BookOpen", check="newdoc"),
        item("Paragraph Boundary", "window.toggleParBoundary && toggleParBoundary()",
             key="p", mods=("cmd", "shift"), sf="paragraphsign", fluent="TextParagraph", check="newpar"),
        item("Paragraph Starts at Token", "window.toggleTokenNewPar && toggleTokenNewPar()",
             key="p", mods=("cmd", "shift", "alt"), sf="paragraphsign", fluent="TextParagraph",
             vis="has", check="tokNewpar"),   # item 2: MISC NewPar=Yes is token-scoped, so it needs a token
        SEP,
        item("Insert Sentence Before", "window.insertSentBefore && insertSentBefore()",
             key=UP, mods=("alt", "cmd"), sf="arrow.up.to.line", fluent="ArrowExportUp", vis="blockOnly"),   # ⌥⌘↑ — same as Insert Token Above (mutually exclusive by selection)
        item("Insert Sentence After", "window.insertSentAfter && insertSentAfter()",
             key=DOWN, mods=("alt", "cmd"), sf="arrow.down.to.line", fluent="ArrowExport", vis="blockOnly"),   # ⌥⌘↓
        item("Move Sentence Up", "window.moveSentUp && moveSentUp()",
             key=UP, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.up", fluent="ArrowUp", vis="blockOnly"),   # ⌃⌘↑ — same as Move Token Up (mutually exclusive by selection); ⇧⌘↑ on Windows, with it
        item("Move Sentence Down", "window.moveSentDown && moveSentDown()",
             key=DOWN, mods=("ctrl", "cmd"), win_mods=("shift", "cmd"),
             sf="arrow.down", fluent="ArrowDown", vis="blockOnly"),   # ⌃⌘↓
        item("Delete Sentence", "window.deleteSent && deleteSent()",
             key=BACKSPACE, mods=("cmd",), sf="trash", fluent="Delete", vis="blockOnly"),   # ⌘⌫ — same context-delete as tokens
        SEP,
        item("Reset Parse", "window.resetParse && resetParse()",
             key="r", mods=("cmd",), sf="arrow.clockwise", fluent="ArrowClockwise"),   # ⌘R (always enabled → intercepts before the web view's reload)
        item("Export Diagram as SVG…", "window.exportSentSVG && exportSentSVG()",
             key="e", mods=("cmd", "alt"), sf="square.and.arrow.up", fluent="Share"),   # ⌥⌘E
    ]},
    {"title": "View", "items": [
        item("Zoom In", "window.zoomIn && zoomIn()", key="+", mods=("cmd",), sf="plus.magnifyingglass", fluent="ZoomIn"),
        item("Zoom Out", "window.zoomOut && zoomOut()", key="-", mods=("cmd",), sf="minus.magnifyingglass", fluent="ZoomOut"),
        item("Actual Size", "window.zoomReset && zoomReset()", key="0", mods=("cmd",), sf="1.magnifyingglass", fluent="ZoomFit"),
        SEP,
        # THE OTHER ⌃⌘/⌥⌘ COLLISION, and the only one among the LETTER shortcuts. ⌃⌘G (this row) and
        # ⌥⌘G (Flatten Multi-word Token) are distinct on macOS and both become Ctrl+Alt+G once ⌃ and
        # ⌥ have been mapped to Alt. This row is the one that moves, for the reason the ⌥⌘F note on
        # Flatten records about the LAST such clash: the first eligible item in menu order wins,
        # Edit sits above View, and Flatten is conditional — so leaving them equal would have made
        # THIS row silently dead exactly when an MWT was selected, and working the rest of the time,
        # which is the hardest possible bug to notice. Moving Flatten instead was rejected: ⌘G /
        # ⇧⌘G / ⌥⌘G is a deliberate three-member family over one selection (group / ungroup /
        # flatten), whereas the View menu's ⌃⌘ set are unrelated toggles that merely share a
        # modifier. ⌃⇧⌘G keeps the letter and the family and adds the one free modifier — the same
        # shape "Paragraph Starts at Token" already uses to sit beside its own pair.
        item("Toggle Grids", "window.toggleGrids && toggleGrids()",
             key="g", mods=("ctrl", "cmd"), win_mods=("ctrl", "shift", "cmd"),
             sf="tablecells", fluent="Table"),
        item("Merge Punctuation", "window.toggleMergePunct && toggleMergePunct()",
             key=".", mods=("cmd",), sf="arrow.triangle.merge", fluent="Merge"),
        item("Wrap Long Lines", "window.toggleWrap && toggleWrap()",
             key="l", mods=("ctrl", "cmd"), sf="text.append", fluent="TextWrap", vis="wrapOK"),   # View-menu item shown only in arc/bracket notations
        SEP,
        # item 12: the five diagram notations, bound to ⌘1–⌘5 — NO SF Symbol (user asked for no icons)
        item("Stemma", "window.setNotation && setNotation('stemma')", key="1", mods=("cmd",)),
        item("Hierarchy", "window.setNotation && setNotation('tree')", key="2", mods=("cmd",)),
        item("Arcs", "window.setNotation && setNotation('arcs')", key="3", mods=("cmd",)),
        item("Brackets", "window.setNotation && setNotation('brackets')", key="4", mods=("cmd",)),
        item("Outline", "window.setNotation && setNotation('outline')", key="5", mods=("cmd",)),
        # item 3 — ⌃⌘P joins the View menu's own ⌃⌘ family (⌃⌘G grids, ⌃⌘L wrap, ⌃⌘O options bar)
        item("Paged Layout", "window.togglePageMode && togglePageMode()",
             key="p", mods=("ctrl", "cmd"), sf="rectangle.portrait.center.inset.filled",
             fluent="Document", check="paged"),   # item 7: the SAME symbol the toolbar's Paged segment now wears — doc.text drew a page of prose, which is what the document IS in both modes, not what this command chooses
        SEP,
        item("Toggle Options Bar", "window.toggleOptionsBar && toggleOptionsBar()",
             key="o", mods=("ctrl", "cmd"), sf="slider.horizontal.3", fluent="Options"),   # same glyph as the toolbar's #btnOptions button
        # item 10: checkable — keep the toolbar visible in full screen. The pref itself is owned + persisted
        # by the FRONTEND (PREFS.fsAlwaysToolbar); Python only mirrors it to drive the checkmark.
        item("Always Show Toolbar in Full Screen",
             "window.__toggleFsAlwaysToolbar && __toggleFsAlwaysToolbar()", action="toggle_fs_toolbar",
             fluent="FullScreenMaximize", check="fsAlwaysToolbar", native_check=True),
        SEP,
        item("Switch Focus", "window.switchFocusZone && switchFocusZone()",
             key="\\", mods=("cmd",), sf="arrow.up.arrow.down", fluent="ArrowSort"),
    ]},
    {"title": "Help", "items": [
        item("Help", "window.openHelp && openHelp()", sf="questionmark.circle", fluent="QuestionCircle"),   # Help menu item + symbol, but NO explicit key-equivalent (item 26)
    ]},
]

# Windows draws the menu inside the window and puts Edit second — the convention every Win32/WinUI
# app follows (File, Edit, View, …).  The macOS bar keeps its own order above; only the top-level
# SEQUENCE differs, never the rows, so the two can't drift in content.
WIN_ORDER = ["File", "Edit", "Format", "View", "Help"]

# ── entries with no menu row (yet) ───────────────────────────────────────────
# Carried over verbatim from the old `specs` dict, where they were likewise inert: no MenuAction
# with these titles is built, so the wiring loop never matched them.  Kept because their comments
# are the record of which shortcuts are SPENT — "⌘D is already spent on Duplicate Sentence" is the
# reason ⇧⌘D was free for Document Boundary, and deleting the entry would delete the reason.
RESERVED: list[dict] = [
    item("Convert to mSUD", sf="arrow.triangle.2.circlepath"),
    item("Duplicate Sentence", key="d", mods=("cmd",), sf="plus.square.on.square"),   # ⌘D
    item("Regenerate Annotations", key="r", mods=("cmd", "alt"), sf="sparkles", vis="model"),   # ⌥⌘R — only with a parser model selected
]


def all_items(include_reserved: bool = True):
    """Every row in the table, flat (separators dropped).  Menu order preserved."""
    out = []
    for menu in MENUS:
        for it in menu["items"]:
            if not it.get("sep"):
                out.append(it)
    if include_reserved:
        out.extend(RESERVED)
    return out


_BY_TITLE = {it["spec_title"]: it for it in all_items()}
# Only the two head-stepping rows mirror under RTL. Precomputed because Api._apply_menu runs on
# every selection change and would otherwise re-scan all 68 rows to rediscover the same two.
MIRRORED = [it for it in all_items() if it.get("sf_rtl")]


def by_title() -> dict[str, dict]:
    """spec_title → entry, for the AppKit wiring loop (which sees "…"-stripped NSMenuItem titles).
    The table is static, so the map is built once at import and shared."""
    return _BY_TITLE


# Items that are shown/hidden per selection (Api.sync_menu), and items that are ALWAYS shown but
# carry a checkmark Api._apply_menu keeps in step.  Both sets are DERIVED from the table rather
# than restated, so adding `vis=`/`check=` to a row is the whole change.
CONDITIONAL = {it["spec_title"] for it in all_items() if it.get("vis")}
CHECKABLE = {it["spec_title"] for it in all_items()
             if it.get("check") and not it.get("vis") and not it.get("native_check")}
# spec_title → the menuState() key that draws its checkmark, for EVERY checkable row (conditional
# ones included — a token-conditional row can be both hidden and ticked).  native_check rows are
# excluded: theirs is set once from the persisted pref, not from a selection push.
CHECK_KEYS = {it["spec_title"]: it["check"] for it in all_items()
              if it.get("check") and not it.get("native_check")}

# The separator that leads the token-action group — hidden with the group it introduces.  Named
# here (rather than in the wiring loop) so both platforms agree on which row it follows.
SEP_TOKENS_AFTER = "Group as Multi-word Token"
SEP_TOKENS_KEY = "__sep_tokens__"


def visibility(st: dict) -> dict[str, bool]:
    """Resolve every conditional row's ``vis`` rule against one ``menuState()`` push.

    The rule names are the state keys themselves wherever the frontend already computes the
    predicate (group / merge / ungroup / convmwt / flatmwt / blockOnly / wrapOK); only ``has``,
    ``diagram`` and ``grid`` are derived here, because "a token is selected AND the focused pane is
    the diagram" is a fact about two keys at once."""
    has, zone = bool(st.get("has")), st.get("zone") or ""
    rules = {
        "has": has,
        "diagram": has and zone == "diagram",
        "grid": has and zone == "grid",
        "group": bool(st.get("group")),
        "merge": bool(st.get("merge")),       # a fresh multi-token selection that is not already an MWT — the same state Group needs
        "ungroup": bool(st.get("ungroup")),
        "convmwt": bool(st.get("convmwt")),
        "flatmwt": bool(st.get("flatmwt")),
        "blockOnly": bool(st.get("blockOnly")),
        "wrapOK": bool(st.get("wrapOK")),     # available in every graphical notation
        "model": bool(st.get("model")),       # RESERVED only — no row carries it yet
    }
    vis = {it["spec_title"]: rules.get(it["vis"], False)
           for it in all_items() if it.get("vis")}
    vis[SEP_TOKENS_KEY] = has or bool(st.get("group")) or bool(st.get("ungroup"))
    return vis


# ── the one pref Python mirrors for a checkmark ──────────────────────────────
# item 10: "Always Show Toolbar in Full Screen". The pref is owned + persisted by the frontend
# (PREFS.fsAlwaysToolbar in state.json); Python only mirrors it to drive the native menu item's
# checkmark. The mirror wins once the user toggles (the debounced JS save may not have hit disk
# yet); before any toggle we read the persisted value straight from state.json.
# Lives here rather than in __main__ because BOTH the portable menu builder and the macOS wiring
# (app/mac/shell.py) read it, and a shell module importing __main__ would be a cycle.
_fs_toolbar_mirror: dict[str, bool | None] = {"on": None}   # None = "not yet read from prefs", distinct from False


def fs_always_toolbar_state() -> bool:
    if _fs_toolbar_mirror["on"] is not None:
        return bool(_fs_toolbar_mirror["on"])
    try:
        state_file = os.path.join(APP_DATA, "state.json")
        with open(state_file, encoding="utf-8") as fh:
            prefs = (json.load(fh) or {}).get("prefs") or {}
        return bool(prefs.get("fsAlwaysToolbar"))
    except Exception:  # noqa: BLE001 — no state yet / unreadable → default off
        return False


def toggle_fs_toolbar_mirror() -> bool:
    """Flip the Python-side mirror and return the new value (the JS toggle applies + saves it)."""
    _fs_toolbar_mirror["on"] = not fs_always_toolbar_state()
    return bool(_fs_toolbar_mirror["on"])


# ── JSON for the frontend ────────────────────────────────────────────────────
def as_json(order: list[str] | None = None) -> list[dict]:
    """The table as plain JSON for ``web/js/ui/menubar.js`` (served by ``Api.menu_spec``).

    Only the fields the web layer can act on are sent — the SF Symbol names would be dead weight in
    a window that has no AppKit to render them."""
    want = order or WIN_ORDER
    index = {m["title"]: m for m in MENUS}
    out = []
    for title in want:
        menu = index.get(title)
        if menu is None:
            continue
        rows = []
        for it in menu["items"]:
            if it.get("sep"):
                rows.append({"sep": True})
                continue
            rows.append({k: it[k] for k in
                         ("title", "spec_title", "js", "action", "submenu", "accel", "win_accel",
                          "fluent", "vis", "check")})
        out.append({"title": title, "items": rows})
    return out
