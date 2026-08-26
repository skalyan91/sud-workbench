# Native shell: pywebview threading, menus, windows

`app/__main__.py`, `app/api.py`, `app/mac/shell.py`, `app/win/` — the deadlock invariants, the menu-wiring retry, several document windows in one process, and why this app offers no window tabbing.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

## This app does not offer macOS window tabbing

⚠ **THIS APP DOES NOT OFFER macOS WINDOW TABBING, ON REQUEST, AND EVERYTHING BELOW THAT USED TO SAY
OTHERWISE IS HISTORY.** A long-running section here used to document a real, working native window-tab
bar and the considerable CSS/JS machinery (`--tabH`/`--tabTop`, `.body::after`'s merged-band paint,
`clampDrawerPop`, `set_titlebar_reserve`, `menuTopBound()`'s tab-bar clamp) that reconciled it with this
app's own web-drawn chrome — most pointedly, "a z-index cannot beat a native AppKit view", which is why
the options bar had to duck below the tab bar rather than simply layer over it. All of that is gone: the
request was "no tabs — multiple open documents should be multiple ordinary windows, sharing a Dock icon
and menu bar", and a real investigation (three independent attempts: calling `toggleTabBar_` directly,
routing the same command through the responder chain, and hiding the private view AppKit lays the
accessory into) found no way to suppress the native bar's own rendering while keeping
`NSWindowTabGroup`'s real grouping mechanics (Merge All Windows, ⌃⇥, the Window menu's tab list) alive —
so a DOM-painted replacement wasn't viable either, and the feature was removed outright rather than
faked. The full investigation record lives in the module-level note near the top of `app/__main__.py`;
`app/mac/shell.py`'s own former `_tab_bar_height` research (how macOS 26 actually paints that bar — the
closest anyone got to reverse-engineering it) is preserved there in a comment for whoever revisits this.
Every window now sets `NSWindow.tabbingMode` to **`.disallowed`**, explicitly, not merely unset — a bare
default still lets the system's own "Prefer tabs when opening documents" setting silently re-group two
windows opened in quick succession, and disallowed refuses that regardless of the user's system-wide
setting. `.viewbar`'s `top` is back to the plain `var(--tbH,44px)` it would have had if a tab bar had
never existed, `menuTopBound()` is a bare `8`, and `--top-chrome` is a plain sum again.

## pywebview threading and the menu wiring

`__main__.py` is the **platform-neutral** pywebview bootstrap (~386 lines): the window, crash
tracing, the close veto, and a `sys.platform` dispatch to `app/mac/` or `app/win/`. Menu actions call
the frontend's bridge-aware JS helpers so toolbar and menu share one code path.

⚠️ **THE MENU WIRING RETRIES UNTIL THERE IS A MENU TO WIRE, and that closes the one path in `app/mac/shell.py`
that failed silently.** `_wire_menu` and `_install_menu_delegate` both opened `if mainmenu is None: return`.
pywebview installs the main menu inside `webview.start()` while `_mutate` is marshalled off the window's `shown`
handler, so which happens first is a RACE — and losing it made both bail with no log line, producing exactly one
recognisable bug report: no key equivalents, no SF Symbol icons, the standard About panel instead of ours, and an
application menu still named after the interpreter (the rename lives in `_wire_menu` too). Worse, the
self-healing went with them: `_install_menu_delegate` is what re-runs the wiring on every menu open, and it was
skipped by the same condition, so a race lost at launch stayed lost for the process's life. It now retries on the
main thread (~120ms, bounded) and `_menu_reapply` re-asserts the delegate on every pass, since NSMenu holds it
weakly and pywebview swaps submenus in underneath us. A successful wiring writes ONE line to `crash.log`
(`[menu] wired: …`) — so a recurrence has evidence attached even from a LaunchServices launch, which is what the
last two reports of this did not.

`app/mac/shell.py` holds the AppKit/PyObjC work for the native feel — unified transparent title bar
with the traffic lights placed in-content, a transparent drag view above the WKWebView, real SF
Symbols rendered natively and pushed to CSS `--sf-*` masks, accent/fullscreen/focus observers, Dock
icon. `app/win/` is `dwm.py` (DWM attributes by `ctypes`, no pywin32) + `shell.py` (registry accent/
theme watcher, 2 s poll). **No PyObjC module may be imported when `sys.platform == "win32"`** —
there is a check for this; keep it passing.

`app/menu_spec.py` is the **single source of truth** for the ~78-item menu: titles, JS calls,
accelerators, SF Symbol *and* Fluent icon names, and the visibility/checkable flags. `build_menu()`
and macOS's `_wire_menu` read it; `Api.menu_spec()` serves the same table as JSON to
`web/js/ui/menubar.js`, which draws the in-window bar Windows needs (macOS uses the real `NSMenu`,
so that module is inert there). Add a command **once**, in the spec.

⚠️ Windows needs **no** analogue of the macOS drag view: setting WebView2's
`IsNonClientRegionSupportEnabled` enables the standard `app-region: drag`, which brings Snap
Layouts, the right-click system menu and double-click-to-maximise with it. pywebview does not set
that property itself — `app/win/` does.

⚠ **THE OPEN FILE IS WATCHED ON DISK, AND WHAT THE READER IS TOLD DEPENDS ON WHETHER THEY HAVE EDITS.**
`Api._watch_loop` stats the current path every 1.5 s (a **poll**, deliberately — the three platforms'
event APIs are three different non-stdlib things, and this app already takes that view for the Windows
accent watcher) and calls `window.__fileChangedOnDisk` when the signature moves off the one this window
last **read or wrote**. `_rearm_watch` is what makes that "somebody else's write": it is called from the
`path` setter, `get_state`, `save`, `save_as`/`save_to`/`rename_to` and `reload`, so the app's own writes
are never announced back to it. A CLEAN document simply reloads and keeps the block being read
(`reloadFromDisk`, js/io/bridge.js — `Api.reload`, not `open_path`, since re-reading the open document
must not push it onto the recent list); a DIRTY one gets the three-button sheet — Reload from Disk
(destructive, the reader's edits go), Cancel, Overwrite (primary, `doSave` writes theirs over the disk's).
⚠️ A signature of `None` is **not** an event: an editor saving by atomic replace leaves a few ms in which
the path does not resolve, and the rename lands a moment later with a real signature. Verified in the
shipping WKWebView against a real `os.replace`. ⚠️ The new signature is adopted **as it is announced**, so
one external write asks once rather than every 1.5 s behind the sheet; Cancel therefore leaves the
conflict standing until the next write, a save, or a reload. `evaluate_js` runs on the watcher's own
daemon thread — never the AppKit main thread, per `_dialog_lock`'s note — and each pywebview call carries
its own semaphore, so it cannot race the other push threads.

`api.py` is `window.pywebview.api`: open/save/save-as/rename, parse/tokenize/sentencize, validate,
format detection + conversion, model list/download/remove, extras install, transliteration,
Wiktionary lookup, prefs and recent files (persisted in `state.json` under `paths.APP_DATA` —
`~/Library/Application Support/SUD Workbench` on macOS, `%LOCALAPPDATA%\SUD Workbench` on Windows).

**Launching with no file reopens the last document.** `Api.record_last_doc` writes `state.json`'s
`last_doc` from each window's `closed` handler — so it is the LAST WINDOW TO CLOSE that decides — and
`main()` adopts it when nothing was named on the command line. A window closed with no file records
`None`, which is how you ask for an empty one next time. `--empty` opts a command line out.

## Several document windows, one process

`_new_document_window` opens another document window **in this process** — `webview.create_window`
called from a non-main thread, the same way `api.py`'s `_open_window` already makes Help / About /
Model Manager. It replaced a `subprocess.Popen([sys.executable, "-m", "app"])` per window, so that
multiple open documents share ONE Dock icon and ONE menu bar rather than reading as unrelated apps.
One `Api` per window, as before; what is now shared is the menu bar, the model/parse caches and the
single `state.json` writer.
⚠️ **This is NOT for native window tabbing** — the app doesn't offer that (see the ⚠ "THIS APP DOES NOT
OFFER macOS WINDOW TABBING" above, and the fuller investigation in `app/__main__.py`'s own module-level
comment). Every additional window is an ordinary window, not a tab.

⚠️ **Nothing may close over "the" window.** There is one NSMenu for N documents, so every command
resolves its target when it RUNS: `_key_pair()` reads `NSApp.keyWindow` against the `_WINDOWS`
registry, `build_menu`'s `js()` sends there, and `mac/shell.py` gets the same resolver through
`set_key_provider` for the items it owns natively (Open Recent, Clear Recent, About, and the menu
delegate's conditional show/hide). `Api._apply_menu` refuses to write the shared menu unless its own
window is key — every window's frontend pushes selection state, and a background one would otherwise
hide rows according to a selection nobody can see; the delegate re-applies the key window's cached
state (`force=True`) whenever a menu opens.

`_wire_menu` also injects a **Window menu** and hands it to `NSApp.setWindowsMenu_`, after which AppKit
maintains the window list at the bottom of it for free. No tab commands live there any more — every
window's `tabbingMode` is explicitly `.disallowed` (see the ⚠ above), so there is nothing to merge.

**Two hard-won invariants — violating either produces an intermittent, hard-to-diagnose hang:**

- pywebview dispatches every JS→Python call on its **own new thread** (calls are *not* serialised),
  and each native file dialog shares one `_file_name` + semaphore per window. So all
  `create_file_dialog` callers go through `Api._modal_dialog`, which serialises them behind
  `_dialog_lock`.
- `_dialog_lock` is **bridge-thread-only**. More generally: any pywebview `create_*_dialog` or
  `evaluate_js` reached from a main-thread AppKit callback must **not** be called directly — it does
  `callAfter(...) + semaphore.acquire()`, so parking the main thread deadlocks the very run loop that
  would service it. Use an inline `runModal()` (as the unsaved-close confirmation does) or a
  short-lived daemon thread (as Open Recent does).
