"""The js_api bridge exposed to the web frontend as ``window.pywebview.api``.

The frontend owns the live document (as a list of sentence dicts); this bridge
handles the file-touching operations — open (append), save / save-as via native
dialogs, and text → tokens — plus validation.  Methods return plain
dicts/lists, which pywebview marshals to JS as resolved Promise values.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

import webview

from . import appearance, convert, detect, io_conllu, itrans, menu_spec, model, models_registry, parse, toolbox_import
from .paths import APP_DATA

_STATE_FILE = os.path.join(APP_DATA, "state.json")   # small persisted app state (recent files, …)
_SNAP_FILE = os.path.join(APP_DATA, "launch_snapshot.jpg")   # the last view of the launch document — a FILE, not a field in state.json, which save_scroll rewrites on every scroll and would otherwise carry a few hundred kB of base64 each time
_MAX_RECENT = 10

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"

# The UI font stack for the CHILD windows (Help / About / Models / Gloss Mappings / Insert /
# Toolbox). Those windows are generated HTML with no stylesheet of their own — they never load
# web/macos-kit or web/win11-kit — so the stack has to be chosen here, in Python, from the platform
# the process is running on rather than from a CSS media query. `system-ui` alone was rejected: it
# resolves to the right face on both, but the explicit fallbacks are what keep an older WebView2 /
# WKWebView from dropping to Times.
UI_FONT_STACK = ('"Segoe UI Variable Text","Segoe UI",system-ui,"Segoe UI Emoji",sans-serif'
                 if IS_WIN else
                 '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif')
MONO_FONT_STACK = ('ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,monospace'
                   if IS_WIN else
                   'ui-monospace,SFMono-Regular,Menlo,monospace')


def _esc(s: str) -> str:
    """Minimal HTML-escape for text interpolated into the generated child-window pages."""
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


_DATA_DIR = Path(__file__).parent / "data"


# ── the POS hint carried into the romanisation engines ────────────────────────────────────────────
# A Han character is heteronymic BY PART OF SPEECH as often as by anything else — 行 reads háng as a
# NOUN ("row, line") and xíng as a VERB ("to walk") — so the frontend now sends each token's own UPOS
# alongside its form. The hint REORDERS/selects among the readings an engine already has; it never
# filters, so an unknown or absent tag must land on exactly the answer the app gave before it existed.
# Passed straight through to app.translit, which treats an absent/empty tag as "no opinion" and returns
# exactly the POS-blind answer — so no guard is needed here for a caller that names none. (There WAS one
# while the two halves of this feature were landing separately: it inspected translit's signature and
# dropped the argument against a build that predated it. Deliberately removed once both landed in the same
# commit, because it would have gone on silently degrading to POS-blind if `upos` were ever dropped from
# translit again — turning a regression into a behaviour nobody would think to report.)


# a well-formed gloss-map key is a single "Feature=Value" pair (no separators/whitespace either side of "=")
_FEAT_KEY_RE = re.compile(r"^[^=\s|]+=[^=\s|]+$")

# A PARAGRAPH break: two or more newlines, each optionally trailed by horizontal whitespace (an invisible
# stray space on an "empty" line must not defeat the break). The exact rule js/io/bridge.js's
# splitParagraphs applies to the main text — restated here because the parallel texts are split on THIS
# side (see Api._sentencize_parallel), and the two have to agree or the two texts stop lining up.
_PARA_SPLIT = re.compile(r"\n[ \t]*(?:\n[ \t]*)+")


def _load_json_file(name: str) -> dict:
    """Read one of the bundled ``app/data`` JSON files; {} on any error."""
    try:
        with open(_DATA_DIR / name, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 — missing/corrupt data → empty
        return {}


def _load_state() -> dict:
    try:
        with open(_STATE_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 — missing/corrupt state → start fresh
        return {}


def _save_state(state: dict) -> None:
    try:
        os.makedirs(APP_DATA, exist_ok=True)
        with open(_STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
    except Exception:  # noqa: BLE001 — persistence is best-effort
        pass


class Api:
    def __init__(self):
        self.window: Any = None
        self._path: str | None = None   # current document path (for Save)
        self.dirty = False
        self._force_close = False      # set by confirm_close_without_saving() → lets the NEXT native close-veto through
        self.format = "SUD"            # detected format of the live doc (app-state, never persisted)
        self._jobs: dict[str, dict] = {}   # background download jobs, by id
        self._job_seq = 0
        self._pip_lock = threading.Lock()  # pip isn't safe to run concurrently in one venv
        # Model Manager: model id → training-set sentences, filled by a background sweep over the UD
        # treebank stats (see model_train_sizes).  Kept off the bridge thread so a slow/offline fetch
        # never blocks the window, and cached on disk between runs by models_registry.
        self._train_sizes: dict[str, int] = {}
        self._train_lock = threading.Lock()
        self._train_busy = False
        self._train_done = False
        # pywebview runs each JS-bridge call on its OWN thread (util.js_bridge_call → Thread(_call)),
        # and every native file dialog shares ONE _file_name + _file_name_semaphore per window
        # (cocoa.BrowserView). Two overlapping create_file_dialog calls therefore race on that shared
        # slot and can return each other's result / drift the semaphore. Serialise so at most one native
        # file modal is in flight per window.
        # INVARIANT: this lock is only ever taken on BRIDGE threads (all six create_file_dialog callers
        # go through _modal_dialog below). It must NEVER be acquired on the AppKit main thread: a bridge
        # thread that holds it is parked in _file_name_semaphore.acquire() waiting for the main run loop to
        # service its dialog's callAfter — so blocking the main thread on this lock starves that callAfter
        # and wedges both threads (that was the intermittent hang). The close-confirmation path in
        # __main__ deliberately does NOT take this lock for exactly that reason.
        self._dialog_lock = threading.Lock()
        self._menu: dict | None = None     # title → NSMenuItem, for the conditional token-action items (set at menu wiring)
        self._recent_menu_refresh = None   # callable set by __main__ to live-rebuild the Open Recent submenu
        # secondary NATIVE windows (Help / About / Model Manager / Toolbox / Gloss Mappings), keyed by name.
        # Kept referenced so pywebview's Window objects aren't garbage-collected while open (item 23).
        # Created off the bridge thread.  Insert Text is NOT among them any more — it is an in-page sheet
        # (sheetInsert in web/js/ui/sheets.js), so its index travels in child_insert_text's own payload
        # instead of being parked on self between "open the window" and "the window submitted".
        self._child_windows: dict[str, Any] = {}
        # The document's language, as the frontend last reported it (set_doc_language).  A FALLBACK only:
        # every caller in the main window passes its own DOCLANG in the call (the Insert sheet included),
        # but a child window is its own web view with no access to that global, and itrans_to_iast is
        # reachable from one — so the last-reported language stands in when a call names none.
        self._doclang: str = ""

    # ── lifecycle ────────────────────────────────────────────────────────────
    @property
    def path(self) -> str | None:
        return self._path

    @path.setter
    def path(self, value: str | None) -> None:
        """Every assignment live-refreshes the Open Recent submenu — it must never list
        the document that's now current (whichever of open/save-as/rename/adopt set it)."""
        self._path = value
        self._notify_recent_changed()

    def set_window(self, window):
        self.window = window

    def _modal_dialog(self, *args, **kwargs):
        """Serialise native file dialogs behind _dialog_lock so two overlapping
        bridge calls can't race on pywebview's shared _file_name/semaphore (the
        intermittent open-file hang).

        Always runs on a JS-bridge thread (every caller is a bridge method), never on
        the AppKit main thread — see the _dialog_lock invariant in __init__. On a bridge
        thread create_file_dialog does callAfter(create_dialog) + semaphore.acquire(),
        which the main run loop is free to service, so the modal always opens."""
        with self._dialog_lock:
            return self.window.create_file_dialog(*args, **kwargs)

    def get_state(self) -> dict:
        """Initial state for the frontend on load.  ``sentences`` is None when
        there is no document to preload (fresh start → the frontend can keep its
        own sample document for design/browser use)."""
        sentences = None
        if self.path and os.path.exists(self.path):
            sentences = io_conllu.read_file(self.path)
            self.format = detect.detect_format(sentences)
            self._record_recent(self.path)   # a command-line / open-file-event document counts as recently opened
        return {
            "path": self.path,
            "name": os.path.basename(self.path) if self.path else None,
            "dirty": self.dirty,
            "sentences": sentences,
            "format": self.format,
            "scroll": self._saved_scroll(self.path),
        }

    # ── open (append) ────────────────────────────────────────────────────────
    def open(self) -> dict:
        """Native open dialog → parse → return sentences for the frontend to
        append.  Adopts the opened file as the current path when the document
        was empty."""
        result = self._modal_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            file_types=("CoNLL U treebank (*.conllu;*.conll)", "All files (*.*)"),
        )
        if not result:
            return {"cancelled": True}
        path = result[0]
        try:
            sentences = io_conllu.read_file(path)
        except Exception as exc:  # noqa: BLE001 — surface any read/parse error
            return {"error": str(exc)}
        self.format = detect.detect_format(sentences)
        self._record_recent(path)
        return {
            "sentences": sentences,
            "path": path,
            "name": os.path.basename(path),
            "format": self.format,
            "scroll": self._saved_scroll(path),
        }

    # ── open by path (recent files) ──────────────────────────────────────────
    def open_path(self, path: str) -> dict:
        """Read + parse ``path`` exactly like :meth:`open`, but without a dialog —
        used by the Open Recent menu.  Returns the same shape and records the file
        as recently opened."""
        if not path or not os.path.exists(path):
            return {"error": "File not found"}
        try:
            sentences = io_conllu.read_file(path)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        self.format = detect.detect_format(sentences)
        self._record_recent(path)
        return {
            "sentences": sentences,
            "path": path,
            "name": os.path.basename(path),
            "format": self.format,
            "scroll": self._saved_scroll(path),
        }

    # ── recent files (persisted in _STATE_FILE) ──────────────────────────────
    def _record_recent(self, path: str) -> None:
        """Push ``path`` (absolute) to the front of the recent list, de-duplicated
        and capped, then persist."""
        if not path:
            return
        ap = os.path.abspath(path)
        state = _load_state()
        recent = [p for p in state.get("recent_files", []) if p != ap]
        recent.insert(0, ap)
        state["recent_files"] = recent[:_MAX_RECENT]
        _save_state(state)
        self._notify_recent_changed()

    # ── the document to reopen on next launch (persisted in _STATE_FILE) ─────
    def record_last_doc(self) -> None:
        """Remember what this window had open, so the next launch reopens it (see
        :func:`app.__main__.main`'s startup fallback).  Called from the window's ``closed``
        handler, which is what makes "the LAST CLOSED window" the thing recorded: every window has a
        handler of its own and writes as it goes, so the last to close is the last to write.  That
        holds however many windows the app has open — they share one process now (see
        ``_new_document_window``), but they never shared one Api, and this reads `self.path`.

        Writes ``None`` for a window that had no file open, so closing an empty window is how you
        ask for an empty one next time — that is the "unless the last closed window was empty"
        half of the rule, and it is why this records on CLOSE rather than tracking `path` as it
        changes: a second, empty window opening would otherwise erase what the first has open.
        An UNTITLED window with unsaved content also records ``None``, because there is no file to
        reopen — the recovery story for that is Save, not this."""
        state = _load_state()
        state["last_doc"] = os.path.abspath(self.path) if self.path else None
        _save_state(state)

    @staticmethod
    def last_doc() -> str | None:
        """The remembered document from the last window to close, or None — filtered to one that
        is still on disk, so a file moved or deleted between sessions just starts empty."""
        p = _load_state().get("last_doc")
        return p if isinstance(p, str) and p and os.path.exists(p) else None

    def _notify_recent_changed(self) -> None:
        """Ask __main__ to live-rebuild the native Open Recent submenu (best-effort)."""
        cb = getattr(self, "_recent_menu_refresh", None)
        if cb is not None:
            try:
                cb()
            except Exception:  # noqa: BLE001 — a menu hiccup must never break open/clear
                pass

    def recent_files(self) -> list:
        """Recently-opened files, most-recent-first, filtered to ones still on disk and excluding the current document."""
        state = _load_state()
        cur = os.path.abspath(self.path) if self.path else None
        return [p for p in state.get("recent_files", []) if os.path.exists(p) and p != cur]

    def clear_recent(self) -> dict:
        state = _load_state()
        state["recent_files"] = []
        _save_state(state)
        self._notify_recent_changed()
        return {"ok": True}

    # ── per-file scroll position (persisted in _STATE_FILE) ───────────────────
    def _saved_scroll(self, path: str | None):
        """The remembered scroll anchor (top-visible sentence-block index) for
        ``path``, or None if none is stored."""
        if not path:
            return None
        fp = _load_state().get("file_pos")
        if not isinstance(fp, dict):
            return None
        return fp.get(os.path.abspath(path))

    def capture_snapshot(self, chrome=0) -> dict:
        """Remember what this document LOOKS like, for the next launch to show while it reloads.

        The picture is only ever shown again for the very same view (see get_state): same file,
        unmodified, same window size, same scroll anchor. Anything else and it is ignored rather than
        stretched or shown against the wrong document — a placeholder that lies is worse than a blank.
        Throttled hard: it is called on scroll-settle, and a WebKit snapshot of a full window is not
        free. macOS only (it is WKWebView's API); a no-op elsewhere, where the cover stays plain."""
        if sys.platform != "darwin" or self.window is None or not self.path:
            return {"ok": False}
        now = time.time()
        if now - getattr(self, "_snap_t", 0.0) < 8.0:
            return {"ok": False, "throttled": True}
        self._snap_t = now
        try:
            from .mac import shell as mac_shell
            data = mac_shell.snapshot_webview(self.window)
            if not data:
                return {"ok": False}
            ap = os.path.abspath(self.path)
            st = os.stat(ap)
            os.makedirs(APP_DATA, exist_ok=True)
            # ATOMIC: temp file + rename. Written in place, a process that dies mid-write (a crash, a
            # kill, a logout) leaves a TRUNCATED jpeg — which passes every check here, is handed to the
            # page, and decodes to nothing, so the next launch shows a blank cover for no visible
            # reason and logs no refusal. os.replace is atomic within a filesystem.
            tmp = _SNAP_FILE + ".part"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, _SNAP_FILE)
            state = _load_state()
            state["launch_snap"] = {
                "path": ap, "mtime": int(st.st_mtime), "size": st.st_size,
                "chrome": float(chrome or 0),          # …so the picture is hung from the same place the cover starts
                "w": int(self.window.width or 0), "h": int(self.window.height or 0),
                "scroll": self._saved_scroll(ap),      # the anchor restoreScrollPos will put the reader back at
            }
            _save_state(state)
            return {"ok": True, "bytes": len(data)}
        except Exception as exc:  # noqa: BLE001 — cosmetic; never break a scroll
            print(f"[snapshot] capture: {exc}", file=sys.stderr)
            return {"ok": False}

    def launch_snapshot(self) -> Any:
        """The picture of this document's last view, as a data URI, or None.

        ITS OWN BRIDGE CALL, deliberately not a field in get_state: get_state returns the DOCUMENT,
        and by the time it resolves the frontend HAS the real thing and is about to render it — a
        picture handed over then is applied and cleared in the same turn, which is exactly what the
        first version of this did (and why it never appeared). Asked for separately at the top of
        bootBridge, it lands while get_state is still in flight and covers the render that follows.

        Handed over ONLY for provably the same view: this file, unmodified (mtime + size), the same
        window size, and the same scroll anchor the reader will be restored to. Any mismatch returns
        None and the boot cover stays plain — a placeholder that lies is worse than a blank one.
        """
        path = self.path
        if sys.platform != "darwin" or not path:
            return None
        try:
            snap = _load_state().get("launch_snap")
            if not isinstance(snap, dict):
                return None
            ap = os.path.abspath(path)
            def _no(why):    # a refusal is normal, but a SILENT one is undiagnosable — this is the
                print(f"[snapshot] not shown: {why}", file=sys.stderr)   # only record of which test failed
                return None
            if snap.get("path") != ap:
                return _no(f"stored for {snap.get('path')!r}, opening {ap!r}")
            if not os.path.exists(_SNAP_FILE):
                return _no("no image file")
            st = os.stat(ap)
            if snap.get("mtime") != int(st.st_mtime) or snap.get("size") != st.st_size:
                return _no("the document changed under it")   # the picture is of something else now
            if self.window is not None and (snap.get("w") != int(self.window.width or 0)
                                            or snap.get("h") != int(self.window.height or 0)):
                # a differently-sized window would scale it, and a scaled screenshot of text looks broken
                return _no(f"window is {self.window.width}x{self.window.height}, picture is {snap.get('w')}x{snap.get('h')}")
            if snap.get("scroll") != self._saved_scroll(ap):
                # the reader will land somewhere else; showing this one would jump
                return _no(f"scroll anchor {snap.get('scroll')} vs {self._saved_scroll(ap)}")
            import base64
            with open(_SNAP_FILE, "rb") as fh:
                uri = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode("ascii")
            # …and the document's NAME rides along. Without it the picture of a full document sits
            # under a title bar still reading "untitled.conllu", which is the one thing that gives
            # the trick away. Naming the file this early is not a guess: it is the file being opened.
            return {"uri": uri, "chrome": snap.get("chrome") or 0, "name": os.path.basename(ap), "path": ap}
        except Exception as exc:  # noqa: BLE001
            print(f"[snapshot] restore: {exc}", file=sys.stderr)
            return None

    def save_scroll(self, pos) -> dict:
        """Persist the last scroll anchor (top-visible sentence-block index) for
        the current document, so reopening it restores the view.  ``pos`` None
        forgets it."""
        if not self.path:
            return {"ok": False}
        ap = os.path.abspath(self.path)
        state = _load_state()
        fp = state.get("file_pos")
        if not isinstance(fp, dict):
            fp = {}
        if pos is None:
            fp.pop(ap, None)
        else:
            try:
                fp[ap] = int(pos)
            except (TypeError, ValueError):
                return {"ok": False}
        state["file_pos"] = fp
        _save_state(state)
        return {"ok": True}

    # ── app-level user preferences (across files; distinct from per-file doc metadata) ──────────
    def get_prefs(self) -> dict:
        """The user's persisted app-level preferences (display toggles, notation, and the
        per-language preferred orthography/transliteration scheme). Empty dict if none saved."""
        prefs = _load_state().get("prefs")
        return prefs if isinstance(prefs, dict) else {}

    def save_prefs(self, prefs: dict) -> dict:
        """Persist app-level preferences. The frontend sends the whole prefs object; it is stored
        verbatim under ``prefs`` in the shared state.json (alongside recent_files / file_pos)."""
        if not isinstance(prefs, dict):
            return {"ok": False}
        state = _load_state()
        state["prefs"] = prefs
        _save_state(state)
        return {"ok": True}

    def new_document(self):
        """Forget the current file — a fresh, untitled document."""
        self.path = None
        self.dirty = False
        return {"ok": True}

    def adopt_path(self, path: str):
        """Frontend tells us which opened file to treat as the save target
        (used when an import lands in a previously-empty document)."""
        self.path = path
        return {"ok": True}

    # ── save ─────────────────────────────────────────────────────────────────
    def save(self, sentences: list[dict]) -> dict:
        """Write to the current path, prompting Save As if there is none yet."""
        if not self.path:
            return self.save_as(sentences)
        try:
            io_conllu.write_file(self.path, sentences)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        self.dirty = False
        return {"ok": True, "path": self.path, "name": os.path.basename(self.path)}

    def save_as(self, sentences: list[dict]) -> dict:
        result = self._modal_dialog(
            webview.FileDialog.SAVE,
            save_filename=os.path.basename(self.path) if self.path else "treebank.conllu",
            file_types=("CoNLL U treebank (*.conllu;*.conll)", "All files (*.*)"),
        )
        if not result:
            return {"cancelled": True}
        path = result if isinstance(result, str) else result[0]
        try:
            io_conllu.write_file(path, sentences)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        self.path = path
        self.dirty = False
        return {"ok": True, "path": path, "name": os.path.basename(path)}

    def save_location_options(self) -> dict:
        """Candidate folders for the in-page Save-As sheet's "Where" dropdown: the folders of
        recently-used files (best guess at where the user is working), then Desktop/Documents/home
        — deduped, existing dirs only. Anything not listed here is reachable via the dropdown's
        chevron (browse_save_folder), a real native folder picker."""
        state = _load_state()
        home = os.path.expanduser("~")
        candidates: list[str] = []
        for p in state.get("recent_files", []):
            d = os.path.dirname(p)
            if d:
                candidates.append(d)
        candidates += [os.path.join(home, "Desktop"), os.path.join(home, "Documents"), home]
        seen: set[str] = set()
        folders = []
        for d in candidates:
            if d not in seen and os.path.isdir(d):
                seen.add(d)
                folders.append(d)
        return {"folders": folders[:6]}

    def browse_save_folder(self, start: str = "") -> dict:
        """Native folder picker for the Where dropdown's chevron — the one piece of the Save-As
        sheet AppKit still owns (NSOpenPanel's directory-browsing chrome isn't practically
        restylable; see the macos-26-design skill's note on native panels)."""
        result = self._modal_dialog(webview.FileDialog.FOLDER, directory=start or os.path.expanduser("~"))
        if not result:
            return {"cancelled": True}
        path = result if isinstance(result, str) else result[0]
        return {"path": path}

    def save_to(self, sentences: list[dict], folder: str, filename: str) -> dict:
        """Write directly to folder/filename — no native dialog. Backs the in-page Save-As sheet
        once a location has been picked (from the Where dropdown or its folder-picker chevron)."""
        filename = (filename or "treebank").strip() or "treebank"
        if not filename.lower().endswith((".conllu", ".conll")):
            filename += ".conllu"
        path = os.path.join(folder or os.path.expanduser("~"), filename)
        try:
            io_conllu.write_file(path, sentences)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        self.path = path
        self.dirty = False
        return {"ok": True, "path": path, "name": os.path.basename(path)}

    def save_svg_to(self, folder: str, filename: str, svg_text: str) -> dict:
        """Export a diagram to an .svg file — no native dialog; backs the in-page Export Diagram
        sheet (folder/filename chosen there, same Save-As sheet as the treebank Save As)."""
        filename = (filename or "diagram.svg").strip() or "diagram.svg"
        if not filename.lower().endswith(".svg"):
            filename += ".svg"
        path = os.path.join(folder or os.path.expanduser("~"), filename)
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(svg_text)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        return {"ok": True, "path": path, "name": os.path.basename(path)}

    def set_dirty(self, dirty: bool):
        self.dirty = bool(dirty)
        return {"ok": True}

    def confirm_close_without_saving(self) -> dict:
        """The in-page 'unsaved changes' sheet (Figma-styled, replacing the old native NSAlert)
        calls this when the user picks Close Without Saving. Sets a flag so the NEXT native
        close-veto check (_confirm_close in __main__.py) lets the close through, then re-issues
        the actual close — that second attempt fires the ``closing`` handler again, which now
        short-circuits on the flag instead of re-showing the sheet."""
        self._force_close = True
        try:
            if self.window is not None:
                self.window.destroy()
        except Exception as exc:  # noqa: BLE001 — never trap the user on a failed programmatic close
            print(f"[close] force-close: {exc}", file=sys.stderr)
            return {"error": str(exc)}
        return {"ok": True}

    # ── conditional Edit-menu items ──────────────────────────────────────────
    def menu_spec(self) -> dict:
        """The menu table as JSON, for the Windows in-window menu bar (web/js/ui/menubar.js).

        The SAME table app/__main__.py's build_menu turns into an NSMenu and app/mac/shell.py wires
        with key equivalents — so a row added in app/menu_spec.py appears on both platforms with one
        edit, and a row that exists on only one of them is not expressible."""
        return {"menus": menu_spec.as_json(), "platform": sys.platform}

    def sync_menu(self, state: dict) -> dict:
        """Frontend reports the selection state (token selected? which pane? RTL? group/ungroup available?);
        show only the relevant items, flip the head-stepping icons under RTL.

        macOS only in effect: ``self._menu`` is the title → NSMenuItem map app/mac/shell.py's menu
        wiring fills in, so on Windows there is nothing here to drive and the call returns early —
        the in-window menu bar applies the very same state itself, from the very same table (see
        ``menu_spec.visibility``), because the state never has to cross the bridge to reach it."""
        if not self._menu:
            return {"ok": False}
        st = dict(state or {})
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(self._apply_menu, st)   # NSMenuItem edits on the main thread
        except Exception:  # noqa: BLE001
            self._apply_menu(st)
        return {"ok": True}

    def is_key_window(self) -> bool:
        """Is THIS window the one the menu bar currently belongs to?  True when there is no way to
        tell (Windows, no NSWindow yet, a PyObjC hiccup): the single-window case must never be able
        to talk itself out of applying its own state."""
        win = getattr(self.window, "native", None)
        if win is None:
            return True
        try:
            import AppKit
            app = AppKit.NSApp
            key = (app.keyWindow() if app is not None else None) or (app.mainWindow() if app is not None else None)
            if key is None:
                return True
            return int(key.windowNumber()) == int(win.windowNumber())
        except Exception:  # noqa: BLE001
            return True

    def _apply_menu(self, st: dict, force: bool = False):
        """Push one selection-state report onto the live NSMenuItems.

        The RULES are no longer written here — ``menu_spec.visibility`` resolves them, and
        ``menu_spec.CHECK_KEYS`` names the checkmarks, so the Windows menu bar applies the identical
        predicates rather than a hand-copied restatement of them.  What stays is the AppKit half.

        ONE MENU BAR, SEVERAL WINDOWS: every window's frontend pushes its own selection state (a
        render, a click, a Tab), and there is a single NSMenu for all of them — so a BACKGROUND
        window's push would hide or show rows according to a selection the user cannot see. Only the
        key window may write. Nothing is lost by the others returning early: each caches its state in
        ``_last_menu_state`` (see the wrapper in mac/shell.py) and the menu delegate re-applies
        whichever window is key at the moment a menu opens — which is also why that delegate passes
        ``force``: it has already resolved the key window and must not be second-guessed here."""
        if not force and not self.is_key_window():
            return
        m = self._menu or {}
        rtl = bool(st.get("rtl"))
        for title, show in menu_spec.visibility(st).items():
            it = m.get(title)
            if it is not None:
                try:
                    it.setHidden_(not show)
                except Exception:  # noqa: BLE001
                    pass
        # items 2/3 — Foreign/Typo are TOGGLES, so their rows carry a checkmark reflecting the selection's own
        # FEATS (set on every selected token → checked). Purely cosmetic; the action itself flips either way.
        # items 2/3 join the same loop: the two sentence-level boundary rows and the mid-sentence one report
        # whether the sentence/token already carries the marker, and "Paged Layout" reports the current layout.
        for title, key in menu_spec.CHECK_KEYS.items():
            it = m.get(title)
            if it is not None:
                try:
                    it.setState_(1 if st.get(key) else 0)
                except Exception:  # noqa: BLE001
                    pass
        # head-stepping icons point toward the earlier/later token — flip them under RTL. Which glyph
        # mirrors, and to what, is the table's `sf_rtl` field — so the Windows menu bar can mirror the
        # same two rows without a second list of exceptions.
        try:
            import AppKit
            for spec in menu_spec.MIRRORED:
                it = m.get(spec["spec_title"])
                if it is None:
                    continue
                img = AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_(
                    spec["sf_rtl"] if rtl else spec["sf"], None)
                if img is not None:
                    it.setImage_(img)
        except Exception:  # noqa: BLE001
            pass

    def set_window_title(self, text: str):
        if self.window is not None:
            try:
                self.window.set_title(text)
            except Exception:  # noqa: BLE001
                pass
        return {"ok": True}

    def reveal_in_finder(self, path: str) -> dict:
        """Reveal a folder or file in the system file manager — backs the titlebar proxy-icon
        folder-path menu.  A directory opens in place; a file is revealed (selected) in its
        containing folder.

        Kept under its macOS name even on Windows: the frontend calls it from one place and
        renaming the bridge method would only mean two names for one operation.  The user-facing
        wording is the frontend's business, and it says "Reveal in File Explorer" there via the
        same platform switch that picks the kit stylesheet."""
        if not path:
            return {"error": "no path"}
        try:
            import subprocess
            if IS_WIN:
                # The chain's LAST row is the volume/drive container, and folderChain() gives it the
                # bare SEPARATOR as its path — "/" on macOS, where that really is the volume root,
                # and therefore "\" on Windows, where it is not a path at all.  Windows has no
                # spelling for "the root of all drives" as a filesystem path; Explorer reaches it as
                # a shell namespace folder, so a bare separator is routed to that moniker rather
                # than handed to `/select,`, which would silently open Documents instead.
                if path.strip() in ("/", "\\", "This PC"):
                    subprocess.run(["explorer.exe", "shell:MyComputerFolder"], check=False)
                elif re.fullmatch(r"[A-Za-z]:", path.strip()):
                    # "C:" is the row above the topmost folder in the chain, and to Win32 it means
                    # "the CURRENT directory on drive C", not its root — so it is completed to "C:\"
                    # before Explorer sees it.
                    subprocess.run(["explorer.exe", path.strip() + "\\"], check=False)
                elif os.path.isdir(path):
                    subprocess.run(["explorer.exe", os.path.normpath(path)], check=False)
                else:
                    # /select, takes the FILE and opens its folder with it highlighted — the exact
                    # counterpart of `open -R`. No space after the comma: explorer parses this as one
                    # argument and a space makes it open Documents instead, silently.
                    subprocess.run(["explorer.exe", "/select," + os.path.normpath(path)], check=False)
            elif os.path.isdir(path):
                subprocess.run(["open", path], check=False)
            else:
                subprocess.run(["open", "-R", path], check=False)
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def path_info(self) -> dict:
        """What the frontend needs to render a filesystem path it never parses itself.

        ``folderChain()`` in js/io/bridge.js used to split on "/" and hard-code "Macintosh HD"; it
        now reads these two values instead.

        ``rootName`` is the row ABOVE the topmost folder in the chain.  On macOS "/" is a volume and
        "Macintosh HD" is its name.  On Windows the topmost *folder* is the drive root (``C:\\``),
        which the split already yields as a chain entry of its own — so the row above it is the
        container of all drives, which Explorer calls **This PC**.  Naming a drive here instead was
        rejected: this is injected once at startup, and the letter belongs to whichever document is
        open, so "C:\\" would be a lie for a file on D:."""
        return {"sep": "\\" if IS_WIN else "/",
                "rootName": "This PC" if IS_WIN else "Macintosh HD"}

    # ── window controls (Windows draws its own caption buttons in the web layer) ──
    def caption(self, what: str) -> dict:
        """minimize / maximize (a toggle: maximise ↔ restore) / close, for the ``.capbtn`` buttons
        the Fluent title bar draws.  macOS needs none of this — the traffic lights are real AppKit
        buttons placed in-content — so the method simply reports unsupported there rather than
        pretending, which keeps the web layer's `if (IS_WIN)` the single place the decision lives."""
        if not IS_WIN:
            return {"ok": False, "error": "caption buttons are Windows-only"}
        from .win import dwm
        return {"ok": bool(dwm.caption_action(self.window, str(what or "")))}

    def options_bar_state(self, shown: bool = False) -> dict:
        """The options bar is APP-WIDE, not per document: opening it in one window opens it in every
        other one. Broadcast rather than persisted-and-read-on-open, so the change is immediate in
        windows that are already up; each receiving page applies it through window.__setOptionsBar,
        which does NOT come back here (that would ping-pong between windows)."""
        cb = getattr(self, "_broadcast", None)
        if cb is None:
            return {"ok": False}
        try:
            cb("window.__setOptionsBar && __setOptionsBar(%s)" % ("true" if shown else "false"))
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def titlebar_reserve(self, height: float = 0) -> dict:
        """The options bar's measured height, so the shell can reserve it INSIDE the native title-bar
        band (macOS) — which is what puts the bar ABOVE a window-tab bar rather than below it; see
        app.mac.shell.set_titlebar_reserve. Reported by syncChrome (js/ui/wiring.js) whenever the
        bar's height changes, 0 when it is closed or the chrome is collapsed in full screen.
        A no-op off macOS: Windows has no titlebar accessories and no window tabbing."""
        if sys.platform != "darwin" or self.window is None:
            return {"ok": False}
        try:
            from .mac import shell as mac_shell
            mac_shell.set_titlebar_reserve(self.window, float(height or 0))
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def new_tab(self) -> dict:
        """Another document window, opened as a TAB of the current one (macOS window tabbing).  Same
        hand-over shape as :meth:`new_window` below; on a platform without tabbing the callable is
        absent and this reports unavailable rather than silently opening a separate window."""
        cb = getattr(self, "_new_tab", None)
        if cb is None:
            return {"error": "unavailable"}
        try:
            cb()
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def new_window(self) -> dict:
        """Open another document window (a fresh, empty document).  The callable is handed over by
        app/__main__.py at startup — the same pattern as _recent_menu_refresh — so api.py carries no
        shell code.  The macOS menu calls that function directly; the Windows menu bar comes here."""
        cb = getattr(self, "_new_window", None)
        if cb is None:
            return {"error": "unavailable"}
        try:
            cb()
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def remeasure_titlebar(self) -> dict:
        """Ask the shell to re-measure + reposition the titlebar drag overlays (the frontend calls this
        when the titlebar reflows without a native window resize). No-op outside the desktop shell."""
        cb = getattr(self, "_remeasure_titlebar", None)
        if cb is not None:
            try:
                cb()
            except Exception:  # noqa: BLE001
                pass
        return {"ok": True}

    def titlebar_passthrough(self, on: bool) -> dict:
        """Toggle the native titlebar drag overlay click-through. The frontend calls this when a titlebar
        context menu opens (True) / closes (False) so a menu row overlapping the drag region still receives
        its click. No-op outside the desktop shell."""
        cb = getattr(self, "_titlebar_passthrough", None)
        if cb is not None:
            try:
                cb(bool(on))
            except Exception:  # noqa: BLE001
                pass
        return {"ok": True}

    # ── rename the current file on disk ──────────────────────────────────────
    def rename_to(self, folder: str, filename: str) -> dict:
        """Rename (or move) the current document's file to folder/filename — no native dialog;
        backs the in-page Rename sheet (the same Save-As sheet as everywhere else). A pure
        on-disk rename — it does not flush unsaved edits."""
        if not self.path or not os.path.exists(self.path):
            return {"error": "Save the document before renaming it"}
        filename = (filename or "").strip()
        if not filename:
            return {"cancelled": True}
        if not filename.lower().endswith((".conllu", ".conll")):
            filename += ".conllu"
        new_path = os.path.join(folder or os.path.dirname(self.path), filename)
        if os.path.abspath(new_path) == os.path.abspath(self.path):
            return {"cancelled": True}
        try:
            os.replace(self.path, new_path)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        self.path = new_path
        return {"ok": True, "path": new_path, "name": os.path.basename(new_path)}

    # ── parse ────────────────────────────────────────────────────────────────
    def parse_text(self, text: str, model_id: str = "") -> dict:
        """Tokenise ``text`` (+ parse if a model is given).  Returns tokens plus any
        multi-word tokens (``mwt``); falls back to whitespace tokenisation with a
        ``reason`` when the requested model/engine can't run."""
        return parse.parse(text, model_id)

    def parse_tokens(self, forms: list[str], model_id: str = "") -> dict:
        """Re-parse a sentence whose TOKENISATION IS FIXED — one token per entry of ``forms``.

        What the frontend needs after a Form or UPOS edit, where the heads, relations and annotation
        tiers hang off the existing tokens and an answer with a different token count is unusable.
        Asking `parse_text(" ".join(forms))` instead silently produced exactly that in any spaceless
        script — see `parse.parse_pretokenized`, which explains the failure it removes."""
        return parse.parse_pretokenized(forms or [], model_id)

    def tokenize(self, text: str, model_id: str = "") -> dict:
        """FAST first step of the interactive parse sequence (tokenise → transliterate → parse):
        tokenise ONLY, so the tokens and their transliterations paint before the heavy parse. The
        follow-up step is the ordinary ``parse_text`` on the same text (which reproduces exactly
        these tokens). Returns ``{"tokens","mwt","parsed":False,…}``."""
        return parse.tokenize(text, model_id)

    def token_spans(self, text: str, forms: list[str], model_id: str = "",
                    parts: list[list[str]] | None = None, lang: str = "") -> dict:
        """Character spans in ``text`` for each surface unit in ``forms`` — the FALLBACK path of
        the running-sentence alignment (js/core/document.js). The frontend settles the ordinary
        case itself by matching the forms against `# text` directly and only asks here when that
        fails, so this is a rare call, made per sentence and cached on the sentence.
        ``parts[i]`` is unit *i*'s component forms (a multi-word token's own tokens) and ``lang``
        the document language — both feed the Sanskrit CSL stage, which needs NO model, so this
        call is worth making for a Sanskrit document even with nothing installed.
        Returns ``{"spans": [[start,end] | null, …]}``; a null is a hole the caller leaves
        undecorated. Never raises — an uninstalled model comes back as an empty list + reason."""
        return parse.token_spans(text or "", forms or [], model_id or "", parts or None, lang or "")

    def sentencize(self, text: str, lang: str = "", model_id: str = "") -> dict:
        """Split pasted text into sentences for the "Insert text" flow (item 24).  Uses the
        selected spaCy model's sentence segmentation when one is loaded, else a script-aware
        rule-based splitter (Latin .?!… + Indic daṇḍa ।॥).  Returns ``{"sentences": [...]}``."""
        return {"sentences": parse.sentencize(text or "", lang or "", model_id or "")}

    # ── validation ───────────────────────────────────────────────────────────
    def validate(self, sentences: list[dict]) -> dict:
        return model.validate_document(sentences)

    def valid_deprels(self, head_upos: str, dep_upos: str, candidates: list[str]) -> dict:
        """Which of ``candidates`` are allowed between a head/dependent with these POS tags,
        per the SUD validator's relation↔POS constraints."""
        from . import sud_rules
        return {"deprels": sud_rules.valid_deprels(head_upos or "", dep_upos or "", candidates or [])}

    def valid_upos(self, head_upos: str, deprel: str, candidates: list[str]) -> dict:
        """Which dependent POS tags in ``candidates`` are allowed for this head-POS + relation."""
        from . import sud_rules
        return {"upos": sud_rules.valid_upos(head_upos or "", deprel or "", candidates or [])}

    # ── transliteration (language-driven, per-scheme) ─────────────────────────
    # ── on-demand script fonts (see app/fonts.py; the web side decides WHEN, in js/lang/fontload.js)
    def font_face(self, family: str) -> dict:
        """Fetch (or read back from the cache) one Noto script face as a data: URI."""
        from . import fonts
        return fonts.fetch(family)

    def fonts_installed(self) -> dict:
        from . import fonts
        return {"fonts": fonts.installed()}

    def fonts_clear(self) -> dict:
        from . import fonts
        return fonts.clear()

    def transliterate(self, forms: list[str], lang: str, scheme: str = "",
                      upos: list[str] | None = None) -> dict:
        """``upos`` is OPTIONAL and PARALLEL to ``forms`` — the CoNLL-U tag each form was seen under, so a
        heteronym is romanised as the part of speech it actually is (行 = háng as a NOUN, xíng as a VERB).
        The frontend keys its own de-duplication on (form, upos) for the same reason — one entry per
        distinct SURFACE would let whichever 行 was reached first decide the reading for all of them; a
        batch that names no tags at all is the call this endpoint has always taken."""
        from . import translit
        return {"translit": translit.transliterate_many(forms, lang, scheme, upos),
                "lang": lang, "scheme": scheme}

    def set_doc_language(self, lang: str = "") -> dict:
        """The frontend reports the document's language whenever it changes (js/lang/translit.js's
        loadTranslitSchemes, which setLang already calls on every change).  Recorded as the FALLBACK
        for a call that names no language — see ``self._doclang``'s own note."""
        self._doclang = str(lang or "")
        return {"ok": True}

    def itrans_to_iast(self, text: str, lang: str = "", script: str = "") -> dict:
        """The ONE entry point for typed-Sanskrit input: ITRANS in, the DOCUMENT'S script out.  Every
        input field that can receive a Sanskrit word routes through this, so the notation gate is
        decided in exactly one place (app.itrans.looks_itrans) and can never drift between call sites.

        Returns ``{"converted", "changed"}``.  A non-Sanskrit ``lang``, a word with no ITRANS-only
        spelling in it, or a missing aksharamukha all come back unchanged rather than raising — the
        caller can commit the result unconditionally.  ``lang`` empty ⇒ the language the frontend last
        reported (set_doc_language), which is what a caller with no DOCLANG of its own falls back on;
        with neither known the answer is "not Sanskrit" — an unknown language must leave the text as typed, never
        guess Sanskrit and rewrite it.

        ``script`` is the document's own storage script ("Devanagari", or "" for an IAST document) —
        see `doc_script` for where the frontend gets it. The method keeps its old name because it is
        the bridge's published surface and every call site passes through it; what it converts TO is
        now the file's business rather than a constant."""
        return itrans.convert(text or "", lang or self._doclang or "und", script or "")

    def doc_script(self, forms: list[str], lang: str = "") -> dict:
        """Which script a Sanskrit document STORES its text in: ``{"script": "Devanagari"|""}``.

        Read off a sample of the document's own forms, because that is where the answer is — a file
        is in whatever script the parser that made it was fed, and no preference, comment or filename
        records it. "" means Latin (IAST), which is also the answer for every non-Sanskrit language,
        so a caller can ask unconditionally. Cheap enough to ask on open and on every parse: it stops
        at the first Brahmic form."""
        from . import translit
        base = (lang or self._doclang or "").lower().split("-")[0].split("_")[0]
        if base not in ("sa", "san"):
            return {"script": ""}
        return {"script": translit.sa_stored_script(forms or [])}

    def token_readings(self, form: str, lang: str, scheme: str = "", upos: str = "") -> dict:
        """The ORDERED candidate romanisations of one token in ``scheme`` — the heteronym choices for
        the CJK languages (Han characters are heteronymic; Japanese kanji carry several on'yomi/
        kun'yomi). ``readings[0]`` is what the app is currently displaying, so the caller can tick it.
        Empty list ⇒ only one possible reading (nothing to choose) or a language/scheme with none.
        ``upos`` (optional) is this token's own tag: it REORDERS the candidates so the one the flyout
        offers first is the one its part of speech calls for (行 as a NOUN leads with háng), and drops
        none of them — the whole point of the flyout is that every reading stays pickable."""
        from . import translit
        return {"readings": translit.readings(form, lang, scheme, upos),
                "lang": lang, "scheme": scheme}

    def translit_derive(self, forms: list[str], stored: list[str], lang: str, src: str = "", dst: str = "") -> dict:
        """Re-express each hand-corrected STORED romanisation (``stored[i]``, of surface form ``forms[i]``,
        in scheme ``src``) in scheme ``dst`` — how the DISPLAYED transliteration row is derived FROM the
        stored value rather than from the surface form again. An entry is "" when that conversion is not
        possible (a character-keyed scheme, or a string no engine recognises as a reading), and the caller
        then falls back to romanising the form. Never raises."""
        from . import translit
        return {"translit": translit.derive_many(forms, stored, lang, src, dst), "lang": lang, "src": src, "dst": dst}

    def translit_schemes(self, lang: str) -> dict:
        """Ordered ROMANISATION schemes for ``lang`` (empty ⇒ no menu). Each is
        ``{"id","label","available"}``; the first is the language's default. ``ambiguous`` marks a language
        whose romanisation is genuinely non-deterministic (CJK readings, the unvocalised abjads) — the
        frontend makes the STORED transliteration click-editable for those, and only for those."""
        from . import translit
        return {"schemes": translit.translit_schemes(lang), "lang": lang, "ambiguous": translit.ambiguous(lang)}

    def script_schemes(self, lang: str) -> dict:
        """NON-LATIN SCRIPT options for ``lang`` (re-render the main glyph; item 1). Empty ⇒ no script menu."""
        from . import translit
        return {"schemes": translit.script_schemes(lang), "lang": lang}

    def orthography_schemes(self, lang: str) -> dict:
        """Back-compat alias → the SCRIPT layer."""
        from . import translit
        return {"schemes": translit.orthography_schemes(lang), "lang": lang}

    def orthography(self, forms: list[str], lang: str, scheme: str = "",
                    upos: list[str] | None = None, feats: list[str] | None = None,
                    lemmas: list[str] | None = None) -> dict:
        """Same optional POS hint as ``transliterate`` above, parallel to ``forms``: a script rendering can
        be reading-dependent too (a Traditional/Simplified variant pair, a kana spell-out), so the layer
        that picks a reading is given the same evidence.  An MWT range sends nothing — its span covers
        several tokens and so has no one part of speech to report.

        ``feats``/``lemmas`` are parallel too, and exist for Latin macronisation, which needs the whole
        morphological analysis rather than just the class: the lookup is keyed on (form, upos, feats),
        and the lemma's ending supplies the declension wherever FEATS carries no ``InflClass``.  Sending
        the form alone reaches only the morphology-blind level of the table, which is how nominative
        ``Gallia`` acquires an ablative macron.  Every other language ignores both."""
        from . import translit
        return {"ortho": translit.orthography_many(forms, lang, scheme, upos, feats, lemmas),
                "lang": lang, "scheme": scheme}

    def sanskrit_mwt(self, groups: list[list[str]], lang: str, scheme: str = "",
                     lemma_groups: list[list[str]] | None = None, word_sep: str = "") -> dict:
        """Reconstruct each Sanskrit multi-word token's surface form from its component words,
        fusing the joins by external sandhi, then render the fused form in ``scheme`` (a script).
        ``groups`` = one component-form list per MWT; ``lemma_groups`` (optional, parallel) supplies
        each component's CoNLL-U lemma as an r-stem signal for visarga sandhi.  ``word_sep`` = the
        separator kept at a NON-fusing junction: "" for a spaceless MWT (the default), " " for a
        running stretch so an un-coalescing junction (e.g. ``eke vāñchanti``) stays two words.

        Returns ``{"form", "ortho"}``: ``form`` is the fused surface IN THE DOCUMENT'S OWN SCRIPT —
        what belongs in the range's FORM column, Devanagari for a Devanagari file and IAST for an
        IAST one — and ``ortho`` is the same fusion rendered in the reader's chosen script.  (It was
        ``iast`` until a file could be stored in Devanagari, at which point the name would have been
        a lie half the time.)  A parse never needs this: the tokeniser reports the range's surface
        as the raw substring it came from.  It is for an EDIT — retyping a component means the
        orthographic word above it has to be re-derived, and only sandhi can say what it becomes."""
        from . import translit
        groups = groups or []
        lg = lemma_groups or []
        form = [translit.sandhi_join(g, lang, lg[i] if i < len(lg) else None, word_sep) for i, g in enumerate(groups)]
        ortho = [translit.sandhi_to_script(g, lang, scheme, lg[i] if i < len(lg) else None, word_sep) for i, g in enumerate(groups)]
        return {"ortho": ortho, "form": form, "lang": lang, "scheme": scheme}

    def sanskrit_csl(self, sents: list[dict]) -> dict:
        """Each sentence's tokens spelt in Clay-Sanskrit-Library notation → ``{"csl": [[…], …]}``.

        A SENTENCE at a time, unlike every other transliteration call, because a CSL mark records
        what happened BETWEEN two words: ``vartmā`` is only ``vartm"`` because ``apunar`` follows it,
        so no per-form batch can answer it. Each entry is
        ``{forms, unsandhied, feats, lemmas, mwt}`` — see :mod:`app.sa_notation` for why the pausa
        forms rather than the stored ones are the input, and what the lemma is read for."""
        from . import sa_notation
        return {"csl": sa_notation.csl_many(sents or [])}

    def translit_available(self) -> dict:
        from . import translit
        return {"ok": translit.available()}

    # ── dictionary definitions (diagram token right-click → "Definitions of …") ────────────
    def definition_lookup(self, word: str, language: str = "", upos: str = "") -> dict:
        """Word senses for the "Definitions of …" flyout, from whichever dictionary actually covers
        the document's language: Apte's Practical Sanskrit-English Dictionary (via the C-SALT API)
        for Sanskrit, Wiktionary for everything else.  Both modules return the same dict — the
        frontend reads `definitions`/`page_url`/`error` identically either way, and names the source
        it is showing from `source`/`page_label` rather than assuming Wiktionary."""
        from . import apte, appledict, wiktionary
        # SANSKRIT IS APTE'S, FIRST AND UNCONDITIONALLY. Apple does ship a Sanskrit–English OUP
        # dictionary, so this is NOT a consequence of the Apple-only restriction in appledict — it is
        # its own rule, by user decision: Apte's 1957 revised edition is a scholarly dictionary of the
        # classical language, vendored, offline, and indexed in SLP1 against the spellings this app
        # stores. Asking macOS first would have quietly displaced it wherever the OUP dictionary
        # happened to have the headword.
        if apte.is_sanskrit(language):
            return apte.lookup(word, language, upos)
        # THEN APPLE'S OWN DICTIONARIES, where macOS has one that indexes this language and defines in
        # English. They are already installed, professionally edited (Oxford, Duden, Sanseido) and need
        # no network, so on the languages they cover they beat Wiktionary below. Nothing is removed
        # behind them: this is macOS-only and Apple has a dictionary for very few of the languages a
        # treebank is written in, so a miss falls through to exactly what answered before.
        try:
            if appledict.available():
                appledict.set_overrides(_load_state().get("apple_dict_langs") or {})
                got = appledict.lookup(word, language)
                if got.get("entry"):
                    return appledict.as_senses(got, word, upos)
        except Exception:  # noqa: BLE001 — an unreadable bundle must never cost the flyout its answer
            pass
        r = wiktionary.lookup(word, language, upos)
        r.setdefault("source", "Wiktionary")
        r.setdefault("page_label", "Open on Wiktionary")
        return r

    def apple_dictionaries(self, lang: str = "") -> dict:
        """Every macOS dictionary this machine has, with what it indexes and what it defines in
        English — for a settings list where the user can label the ones that declare nothing.

        ``needsLanguage`` marks exactly those: a bundle whose Info.plist names no languages and whose
        entry ids carry no direction, which is common for a hand-installed one. There is no honest
        way to infer it (see `appledict._OVERRIDES`), so the UI asks. Empty list off macOS."""
        from . import appledict
        if not appledict.available():
            return {"dictionaries": [], "available": False}
        appledict.set_overrides(_load_state().get("apple_dict_langs") or {})
        return {"dictionaries": appledict.dictionaries(lang), "available": True}

    def set_apple_dictionary_language(self, key: str, lang: str = "") -> dict:
        """Assign (or, with an empty ``lang``, clear) the headword language of one dictionary.
        Keyed on its CFBundleIdentifier, or its name when it has none. Persisted in state.json."""
        from . import appledict
        state = _load_state()
        m = dict(state.get("apple_dict_langs") or {})
        if lang:
            m[str(key)] = str(lang)
        else:
            m.pop(str(key), None)
        state["apple_dict_langs"] = m
        _save_state(state)
        appledict.set_overrides(m)
        return {"ok": True, "languages": m}

    def wiktionary_lookup(self, word: str, language: str = "", upos: str = "") -> dict:
        """Back-compat alias — the flyout is no longer Wiktionary-only (see definition_lookup)."""
        return self.definition_lookup(word, language, upos)

    # ── format detection / conversion ─────────────────────────────────────────
    def detect_format(self, sentences: list[dict]) -> dict:
        return {"format": detect.detect_format(sentences)}

    def detect_language(self, text: str) -> dict | None:
        """Best-effort automatic language ID (fastText lid.176) for a text sample.
        Returns {"lang","conf","name"} or None (too short / low confidence / model
        unavailable).  Thin bridge over :mod:`app.langid`; never raises."""
        from . import langid
        return langid.detect_language(text or "")

    def conversion_available(self) -> dict:
        """Whether grew (grewpy + backend + grammars) can run — lets the UI gate
        Import/Export UD and Convert actions instead of failing on click."""
        return convert.available()

    def import_ud(self, lang: str | None = None) -> dict:
        """Native open → detect format → convert to the app's native SUD.  ``lang`` (the
        frontend's DOCLANG) picks a language-specific grammar over the universal one when
        one is vendored for this (language, direction) pair — see app/convert.py."""
        result = self._modal_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            file_types=("CoNLL U treebank (*.conllu;*.conll)", "All files (*.*)"),
        )
        if not result:
            return {"cancelled": True}
        path = result[0]
        try:
            sentences = io_conllu.read_file(path)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        src = detect.detect_format(sentences)
        try:
            sentences = convert.to_sud(sentences, src, lang)
        except convert.ConversionUnavailable as exc:
            return {"error": str(exc), "unavailable": True}
        except convert.ConversionError as exc:
            return {"error": f"conversion failed: {exc}"}
        self.format = "SUD"
        return {"sentences": sentences, "path": path,
                "name": os.path.basename(path), "source_format": src, "format": "SUD"}

    # ── Toolbox interlinear import ─────────────────────────────────────────────
    def toolbox_available(self) -> bool:
        """Whether the (vendored) Toolbox parser can be imported — lets the UI gate the
        Import Toolbox action."""
        return toolbox_import.available()

    def import_toolbox(self) -> dict:
        """Native open → probe a SIL FieldWorks/Toolbox interlinear file.

        Returns the detected record marker plus a per-marker sentence/token classification
        so the frontend can offer a field-mapping dialog; the actual CoNLL-U is built later
        by :meth:`toolbox_build`.  Mirrors :meth:`import_ud`'s dialog handling exactly."""
        result = self._modal_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            file_types=("Toolbox interlinear text (*.txt;*.sfm;*.tbt)", "All files (*.*)"),
        )
        if not result:
            return {"cancelled": True}
        path = result[0]
        try:
            info = toolbox_import.probe(path)
        except Exception as exc:  # noqa: BLE001 — surface any parse/probe error
            return {"error": str(exc)}
        return {"path": path, **info}

    def toolbox_build(self, path: str, mapping: dict) -> dict:
        """Build CoNLL-U text from a Toolbox file and a marker→field ``mapping`` chosen in
        the dialog.  Returns ``{"conllu": text, "sentences": […], "name": …}`` or
        ``{"error": …}``.

        The ``sentences`` are parsed with the same :mod:`io_conllu` the Open flow uses, so
        the frontend can load the result exactly as it loads an opened file — no separate
        client-side CoNLL-U parser needed."""
        try:
            conllu = toolbox_import.build(path, mapping)
            sentences = io_conllu.parse(conllu)
        except Exception as exc:  # noqa: BLE001 — malformed mapping / read error
            return {"error": str(exc)}
        base = os.path.splitext(os.path.basename(path))[0] if path else "toolbox"
        return {"conllu": conllu, "sentences": sentences, "name": base + ".conllu"}

    def export_ud_default_name(self) -> dict:
        """Suggested filename for the Export as UD sheet — derived from the current path if any."""
        name = os.path.splitext(os.path.basename(self.path))[0] + "_UD" if self.path else "treebank_UD"
        return {"name": name}

    def export_ud_to(self, sentences: list[dict], folder: str, filename: str,
                      lang: str | None = None) -> dict:
        """Convert the live document (SUD or mSUD) to UD and write it to folder/filename — no
        native dialog; backs the in-page Export as UD sheet (the same Save-As sheet as elsewhere).
        ``lang`` picks a language-specific grammar over the universal one, see import_ud."""
        try:
            ud = convert.to_ud(sentences, self.format, lang)
        except convert.ConversionUnavailable as exc:
            return {"error": str(exc), "unavailable": True}
        except convert.ConversionError as exc:
            return {"error": f"conversion failed: {exc}"}
        filename = (filename or "treebank_UD").strip() or "treebank_UD"
        if not filename.lower().endswith((".conllu", ".conll")):
            filename += ".conllu"
        out = os.path.join(folder or os.path.expanduser("~"), filename)
        try:
            io_conllu.write_file(out, ud)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        return {"ok": True, "path": out, "name": os.path.basename(out)}

    def convert_format(self, sentences: list[dict], target: str, lang: str | None = None) -> dict:
        """Convert the live document to an editable target format (SUD or mSUD).  ``lang``
        picks a language-specific grammar over the universal one, see import_ud."""
        try:
            if target == "SUD":
                out = convert.to_sud(sentences, self.format, lang)
            elif target == "mSUD":
                out = convert.sud_to_msud(sentences)
            else:
                return {"error": f"unsupported target {target!r}"}
        except convert.ConversionUnavailable as exc:
            return {"error": str(exc), "unavailable": True}
        except convert.ConversionError as exc:
            return {"error": f"conversion failed: {exc}"}
        self.format = target
        return {"sentences": out, "format": target}

    def set_format(self, fmt: str) -> dict:
        """Frontend tells us the live document's format (e.g. after a local edit)."""
        if fmt in ("UD", "SUD", "mSUD"):
            self.format = fmt
        return {"ok": True, "format": self.format}

    # ── model manager ─────────────────────────────────────────────────────────
    def list_models(self, refresh: bool = False) -> dict:
        """Available (downloadable) and installed models, with installed ones flagged."""
        try:
            available = models_registry.list_available(refresh)
            installed = models_registry.list_installed()
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc), "available": [], "installed": []}
        # The flagging AND the merge both live in models_registry.merge_installed: `available` is a
        # network listing and `installed` a filesystem scan, so an installed model can be missing
        # from the offer list (offline, rate-limited, asset withdrawn) — and the Manage Models sheet
        # draws from `available` alone, so it used to disappear from the sheet. See that function.
        available = models_registry.merge_installed(available, installed)
        return {"available": available, "installed": installed}

    def model_train_sizes(self, refresh: bool = False) -> dict:
        """``{model id: sentences the model was trained on}`` — the sum of the train splits of the
        UD/SUD treebanks behind each model.

        Resolving those sizes means one fetch of the UD treebank index plus one ``stats.xml`` per
        treebank, so it runs on a background thread and this call returns whatever is known SO FAR
        plus ``pending``: the Model Manager polls until ``pending`` is false and patches its rows in
        place.  Everything is disk-cached for a month, so only the first run (or a Refresh) fetches.
        """
        with self._train_lock:
            if refresh and not self._train_busy:
                self._train_done = False
            start = not self._train_done and not self._train_busy
            if start:
                self._train_busy = True

        if start:
            def worker(force=bool(refresh)):
                sizes: dict[str, int] = {}
                try:
                    entries = models_registry.list_available(False)
                    models_registry.annotate_train_sentences(entries, force, fetch=True)
                    sizes = {e["id"]: e["train_sents"] for e in entries if e.get("train_sents")}
                except Exception as exc:  # noqa: BLE001 — a size is decoration; never surface a crash
                    print(f"[models] train sizes: {exc}", file=sys.stderr)
                with self._train_lock:
                    self._train_sizes = sizes or self._train_sizes
                    self._train_busy = False
                    self._train_done = True

            threading.Thread(target=worker, daemon=True).start()

        with self._train_lock:
            return {"sizes": dict(self._train_sizes), "pending": self._train_busy}

    def download_model(self, model_id: str) -> dict:
        """Start a background download; returns a ``job_id`` to poll with model_job_status."""
        self._job_seq += 1
        job_id = f"job{self._job_seq}"
        self._jobs[job_id] = {"pct": 0, "note": "Starting…", "done": False, "error": None,
                              "id": model_id}

        def worker():
            def progress(pct, note):
                job = self._jobs.get(job_id)
                if job is not None:
                    job["pct"] = pct
                    job["note"] = note
            with self._pip_lock:   # serialise installs — pip isn't concurrency-safe
                result = models_registry.download(model_id, progress=progress)
            job = self._jobs.get(job_id)
            if job is not None:
                job["done"] = True
                if result.get("error"):
                    job["error"] = result["error"]
                else:
                    job["pct"] = 100
                    job["note"] = "Installed"
                    if result.get("warning"):
                        job["warning"] = result["warning"]

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id}

    def model_job_status(self, job_id: str) -> dict:
        job = self._jobs.get(job_id)
        if job is None:
            return {"error": "unknown job"}
        return dict(job)

    def remove_model(self, model_id: str) -> dict:
        with self._pip_lock:
            return models_registry.remove(model_id)

    # ── optional heavy-dependency tiers (on-demand: Stanza/torch, Japanese, Arabic) ───────────
    def list_extras(self) -> dict:
        """Installable/installed optional language-support tiers for the Manage Models UI."""
        from . import extras
        return {"extras": extras.status()}

    def install_extra(self, feature: str) -> dict:
        """Start a background pip install of a tier into the user extras dir; poll model_job_status."""
        self._job_seq += 1
        job_id = f"job{self._job_seq}"
        self._jobs[job_id] = {"pct": 0, "note": "Starting…", "done": False, "error": None,
                              "id": feature}

        def worker():
            from . import extras

            def progress(pct, note):
                job = self._jobs.get(job_id)
                if job is not None:
                    job["pct"] = pct
                    job["note"] = note

            with self._pip_lock:   # serialise installs — pip isn't concurrency-safe
                result = extras.install(feature, progress=progress)
            job = self._jobs.get(job_id)
            if job is not None:
                job["done"] = True
                if result.get("error"):
                    job["error"] = result["error"]
                else:
                    job["pct"] = 100
                    job["note"] = "Installed"
                    if result.get("warning"):
                        job["warning"] = result["warning"]

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id}

    # ── secondary native windows (item 23) ────────────────────────────────────
    # Help / About / Model Manager / Toolbox / Gloss Mappings are REAL windows (not in-page scrim sheets).
    # pywebview requires create_window off the AppKit main thread; every bridge call already
    # runs on its own thread, but we still spawn a worker so the caller returns immediately
    # and a prior window of the same key is torn down first.  The shared ``self`` is passed as
    # ``js_api`` so the interactive windows (Models/Toolbox/Gloss Mappings) can call back into the bridge; the
    # returned Window is retained in ``self._child_windows`` so it isn't garbage-collected.
    def _open_window(self, key: str, title: str, html: str,
                     width: int, height: int, min_size: tuple = (360, 260)) -> dict:
        def make():
            old = self._child_windows.pop(key, None)
            if old is not None:
                try:
                    old.destroy()
                except Exception:  # noqa: BLE001 — replacing a stale window; ignore teardown hiccups
                    pass
            try:
                win = webview.create_window(
                    title, html=html, js_api=self,
                    width=width, height=height, min_size=min_size,
                    background_color=appearance.window_bg(), text_select=True,   # Help / About / Model Manager, same as the document windows
                )
                self._child_windows[key] = win
                try:
                    win.events.closed += (lambda *_a, _k=key: self._child_windows.pop(_k, None))
                except Exception:  # noqa: BLE001 — older pywebview may lack the event; reference still held
                    pass
            except Exception as exc:  # noqa: BLE001
                print(f"[window] open {key!r}: {exc}", file=sys.stderr)
        threading.Thread(target=make, daemon=True).start()
        return {"ok": True}

    def _close_child(self, key: str) -> None:
        win = self._child_windows.pop(key, None)
        if win is not None:
            threading.Thread(target=lambda: self._destroy_quiet(win), daemon=True).start()

    def close_all_child_windows(self) -> dict:
        """Tear down every secondary window (Help / About / Models / Toolbox / Gloss Mappings) at once.

        Wired to the MAIN window's ``closed`` event: pywebview's run loop lives as long as ANY
        window is open, so a child left behind after the document window goes keeps the app
        running with no way back to a document — and, on macOS, no visible way to quit it either.

        Destroys OFF the firing thread for the same reason ``_close_child`` does: ``closed``
        arrives on the AppKit main thread, and ``destroy()`` queues onto that same run loop, so
        calling it inline would re-enter the teardown that is already in progress.  The list is
        snapshotted and the registry cleared first, so each window's own ``closed`` handler (which
        pops its key) finds nothing left to do and can't race this."""
        wins = list(self._child_windows.values())
        self._child_windows.clear()
        if wins:
            threading.Thread(target=lambda: [self._destroy_quiet(w) for w in wins],
                             daemon=True).start()
        return {"ok": True, "closed": len(wins)}

    @staticmethod
    def _destroy_quiet(win) -> None:
        try:
            win.destroy()
        except Exception:  # noqa: BLE001
            pass

    def open_help_window(self, html: str = "") -> dict:
        """Open the Help window.  The frontend builds the self-contained HTML (it owns the
        shortcut list + SUD vocabulary), so it is loaded verbatim via ``html=``."""
        page = html or ("<!DOCTYPE html><meta charset='utf-8'>"
                        f"<body style='font:13px {UI_FONT_STACK};padding:24px'>"
                        "<h2>Help</h2><p>Help content is unavailable.</p></body>")
        # item 11: opened NARROWER (600, was 720) for a more compact window.  Content stays above
        # the help CSS's 520px single-column breakpoint, so the two-column shortcut grid survives
        # (2 cols of ≈280px after the 40px body padding) without horizontal scroll.
        return self._open_window("help", "SUD Workbench Help", page, 600, 640, (460, 420))

    def open_about_window(self, version: str = "") -> dict:
        """Open the About window (item 26): separate native window; created by Siva Kalyan."""
        # HEIGHT IS MEASURED, NOT GUESSED. _about_html's column is 366 px tall — 26 top padding,
        # a 128 px icon (+3), 25 name, 39 two-line description, 19 byline, 17 version, 30 button,
        # six 7 px gaps, 22 bottom padding — and it does not change with width anywhere from 312 px
        # up (the description wraps to two lines at every width this window can be given). At the
        # old 320 the block overflowed by 46 px, and because the body is `justify-content:center`
        # the overflow was split BOTH ways: the top of the icon and the bottom of the Close button
        # were each clipped by ~23 px, with no scrollbar to reveal either. 380 fits it with a little
        # slack. The two numbers are not in the same coordinate system, which is why they differ by
        # more than the 28 px title bar: pywebview's cocoa backend passes `height` to
        # initWithContentRect_ (a CONTENT height) but `min_size` to NSWindow.setMinSize_ (a FRAME
        # minimum, title bar included), so the floor is 366 + 28 ≈ 400 — below which the page clips
        # again, and there is nothing here to scroll.
        return self._open_window("about", "About SUD Workbench",
                                 self._about_html(version), 380, 380, (340, 400))

    def open_models_window(self, focus: str = "") -> dict:
        """Open the Model Manager as a real window (item 23).

        ``focus`` names an extras tier to scroll to and flash on arrival.  It is what makes the
        Script/transliteration menus' "install" link on an unavailable scheme lead somewhere: the
        tiers sit under every model in a scrolling list, so opening the window on its own would
        leave the reader to find the row that answers the thing they just clicked."""
        return self._open_window("models", "Manage Models",
                                 self._models_html(focus), 660, 580, (420, 400))

    def open_glossmap_window(self) -> dict:
        """Open the gloss↔FEATS mapping editor as a real window (item 12): mirrors
        open_models_window — a separate native window (not an in-page sheet)."""
        return self._open_window("glossmap", "Gloss Mappings",
                                 self._glossmap_html(), 560, 600, (440, 420))

    def open_toolbox_window(self, probe: dict) -> dict:
        """Open the Toolbox field-mapping window (item 21): a SEPARATE native window (mirrors
        the Model Manager), not an in-page modal.  ``probe`` is the import_toolbox result
        (path, record_marker, markers, …); Import wires the built document back to the main
        window via child_toolbox_build."""
        # item 7: 440 was too short and clipped the "Token-level fields" section; opened taller (540) so a
        # typical field set shows both the "Sentence-level fields" and "Token-level fields" sections plus the
        # action row without clipping — the list still stretches (flex:1) so the buttons stay at the bottom
        return self._open_window("toolbox", "Import Toolbox",
                                 self._toolbox_html(probe or {}), 620, 540, (460, 440))

    # ── callbacks the interactive child windows invoke on the bridge ──────────
    def open_external(self, url: str) -> dict:
        """Open a URL in the system browser — the Help window's guideline links call this."""
        if not url:
            return {"ok": False}
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        return {"ok": True}

    def close_child_window(self, key: str) -> dict:
        """A child window asks to close itself (Cancel/Close buttons, Escape)."""
        self._close_child(str(key or ""))
        return {"ok": True}

    def insert_languages(self, extra=None) -> dict:
        """The Insert sheet's language menu — ``{"installed": [...], "others": [...]}``.

        ``models_registry.language_choices`` made public for the sheet (it was read in-process by
        ``_insert_html`` when the dialog was a Python-generated child window).  ``extra`` is
        ``code → name`` for languages the DOCUMENT uses that no engine has a model for — its enabled
        translation tiers — so those still appear in the menu.

        SLOW (it walks the venv's distribution metadata), which is why the sheet opens first and calls
        this after: on the frontend a bridge call is a promise, so the dialog is on screen and usable
        while the language list is still resolving.  Never raises — an empty menu is a poor dialog, a
        raised one is no dialog."""
        pairs = {str(k): str(v or k) for k, v in extra.items()} if isinstance(extra, dict) else {}
        try:
            return models_registry.language_choices(pairs)
        except Exception as exc:  # noqa: BLE001
            print(f"[insert] language list: {exc}", file=sys.stderr)
            return {"installed": [], "others": []}

    def child_insert_text(self, text) -> dict:
        """The Insert sheet's submit → sentencise the parallel texts here and hand the whole result to
        the MAIN window, which adds one block per sentence (items 23/24 + the parallel texts, item 7).

        Named ``child_…`` because it was the Insert child WINDOW's callback; the dialog is an in-page
        sheet now (sheetInsert in web/js/ui/sheets.js) and this is unchanged apart from where the
        insertion index comes from — the sheet puts it in the payload, where the window relied on the
        ``self._insert_index`` its opener had parked.

        ``text`` is either a plain string (one main text, nothing else — the shape every caller had
        before the dialog grew, still accepted so a one-string call keeps working) or the payload

            {"index", "main": {"enabled", "lang", "text", "adoptLang"}, "parallels": [{"lang", "text"}, …]}

        The MAIN text stays a string all the way to the frontend, because the frontend owns the
        paragraph/heading structure inside it (splitParagraphs / paragraphsWithIds in js/io/bridge.js)
        and that structure has to survive to `# newpar` / `# newdoc`. A PARALLEL text is sentencised
        HERE, where each language's own installed pipeline can be picked (see _sentencize_parallel) —
        but it comes back as PARAGRAPHS of sentences, not as one flat list: its sentences line up with
        the inserted blocks paragraph by paragraph, and the frontend (the only side holding both
        splits) is where that alignment is done."""
        main = self.window
        payload = text if isinstance(text, dict) else {"main": {"enabled": True, "text": text or ""}}
        _main = payload.get("main")   # bound once: two separate .get() calls read as "may be None" to a type checker even behind the isinstance guard, and this is the value four lines below dereference
        m: dict = _main if isinstance(_main, dict) else {}
        main_on = bool(m.get("enabled", True))
        # The language the MAIN text is in: what the dialog's picker chose (an empty document), else the
        # document's own language as the frontend last reported it (set_doc_language). This is also the
        # language the document ADOPTS — see __applyInsertPayload on the other side.
        main_lang = str(m.get("lang") or "").strip() or self._doclang or ""
        # ITRANS → IAST BEFORE the text crosses to the main window, which is where it is sentencised,
        # tokenised and parsed: the tokeniser (and any Sanskrit model behind it) must see the notation
        # the document is stored in, and a re-conversion after tokenisation would have to be applied
        # to every token separately and could no longer see the word boundaries the typist wrote.
        # A no-op for every non-Sanskrit document — see itrans_to_iast.
        main_text = itrans.convert(str(m.get("text") or ""), main_lang or "und")["converted"] if main_on else ""

        raw_pars = [p for p in (payload.get("parallels") or []) if isinstance(p, dict)]
        try:                          # where the new blocks land; None (or unusable) ⇒ append, which is
            _i = payload.get("index")  # what __insertPastedText does with a null index on the other side
            idx = None if _i is None else int(_i)
        except (TypeError, ValueError):
            idx = None
        adopt = bool(m.get("adoptLang"))   # the dialog owned the language choice ⇒ the document takes it

        # Everything past this point is SLOW — resolving what is installed walks the venv's distribution
        # metadata (~1 s), and sentencising a parallel text may load that language's whole pipeline (a
        # cold Stanza load is seconds). Doing it on the bridge thread left the dialog on screen, inert,
        # for the duration; on a worker the sheet closes on the click and the sentences land a moment
        # later. Same shape as the _eval_quiet dispatch it replaces — a short-lived daemon thread that
        # only ever calls evaluate_js on the MAIN window (never the AppKit main thread, per the module's
        # threading invariants), which is still true now that the caller is that main window itself.
        def worker():
            parallels: list[dict] = []
            naive: list[str] = []   # languages split by the rule-based splitter (no pipeline installed)
            seen: set[str] = set()
            # ONE scan of what's installed for the whole submit, shared by every language below.
            groups = self._installed_groups()
            for p in raw_pars:
                lang = str(p.get("lang") or "").strip()
                raw = str(p.get("text") or "")
                if not lang or lang in seen or not raw.strip():
                    continue
                seen.add(lang)
                # Each parallel text is ITRANS-converted in ITS OWN language, not the document's: a
                # Sanskrit translation of an English text is still typed in ITRANS, and an English
                # translation of a Sanskrit text must not be rewritten as if it were Sanskrit.
                raw = itrans.convert(raw, lang)["converted"]
                model_id = self._model_for_language(lang, groups)
                paras = self._sentencize_parallel(raw, lang, model_id)
                if paras:
                    if not model_id:
                        naive.append(lang)
                    # PARAGRAPHS, not a flat sentence list: the frontend aligns paragraph n of the
                    # translation to paragraph n of the main text and only then sentence n to sentence n
                    # (see alignToParagraphs in js/io/bridge.js).  Flattening here would throw away the
                    # only structure that alignment has to work with — which is exactly the bug this
                    # shape fixes: one extra sentence anywhere used to shift every later translation by
                    # one, for the whole rest of the document.
                    parallels.append({"lang": lang, "paras": paras})
            if not ((main_on and main_text.strip()) or parallels):
                return                                    # nothing survived validation — nothing to send
            data = {
                "index": idx,
                "main": {"enabled": bool(main_on and main_text.strip()), "lang": main_lang,
                         "text": main_text,
                         # the parser the main text should be read with — only consulted when the
                         # document was EMPTY and this dialog chose its language (see best_installed_model)
                         "model": self._model_for_language(main_lang, groups) if main_on else ""},
                "parallels": parallels, "adoptLang": adopt, "naive": naive,
            }
            self._eval_quiet(main, "window.__applyInsertPayload && window.__applyInsertPayload(%s)"
                             % json.dumps(data))

        if main is not None:
            threading.Thread(target=worker, daemon=True).start()
        return {"ok": True}   # the sheet has already closed itself on the click — nothing to tear down here

    @staticmethod
    def _installed_groups() -> dict:
        """``{language code: installed models, best first}`` — one scan, shared by every language a
        submit mentions. Cache-only and never raising: an empty map just means "no model anywhere",
        which each caller degrades to the rule-based splitter."""
        try:
            return models_registry.installed_by_language()
        except Exception as exc:  # noqa: BLE001 — a missing model is a degraded feature, not an error
            print(f"[insert] installed models: {exc}", file=sys.stderr)
            return {}

    @staticmethod
    def _model_for_language(lang: str, groups: dict | None = None) -> str:
        """The installed parser this app would use for ``lang`` (``""`` when there is none), per the
        preference order documented at models_registry._preference_key. Never raises."""
        if not lang:
            return ""
        try:
            return models_registry.best_installed_model(lang, groups)
        except Exception as exc:  # noqa: BLE001
            print(f"[insert] model lookup for {lang!r}: {exc}", file=sys.stderr)
            return ""

    @staticmethod
    def _sentencize_parallel(text: str, lang: str, model_id: str) -> list[list[str]]:
        """A parallel text → its PARAGRAPHS, each a list of sentences in order, using ``lang``'s own
        installed pipeline when there is one and the script-aware rule splitter when there isn't
        (parse.sentencize already degrades that way, so a missing model is never an exception).

        PARAGRAPH-SPLIT FIRST, for the reason js/io/bridge.js records at splitParagraphs: parse.sentencize
        strips its input and returns whitespace-stripped slices, so a text handed to it whole comes back
        with every blank line gone — and a paragraph break is a hard sentence boundary no model should be
        free to cross anyway.  A blank line is the paragraph break here for the same reason it is one in
        the MAIN field (the dialog's own copy says so), so both sides of the alignment read the same rule
        off the same typing.

        The paragraph structure is RETURNED rather than flattened away, because it is what the frontend
        aligns on — paragraph n to paragraph n, and only within that sentence n to sentence n.  Flattening
        (what this used to do) made one extra sentence anywhere shift every later translation by one."""
        out: list[list[str]] = []
        for para in _PARA_SPLIT.split((text or "").replace("\r\n", "\n").replace("\r", "\n")):
            para = para.strip()
            if not para:
                continue
            try:
                segs = parse.sentencize(para, lang, model_id)
            except Exception as exc:  # noqa: BLE001 — never let one paragraph lose the whole translation
                print(f"[insert] sentencize {lang!r}: {exc}", file=sys.stderr)
                segs = []
            out.append(list(segs or [para]))   # a paragraph the sentenciser refused is one sentence, not none
        return out

    def child_toolbox_build(self, path: str, mapping: dict) -> dict:
        """Toolbox window → build CoNLL-U from the chosen field mapping, load it into the MAIN
        document, and close the Toolbox window.  Returns {ok} / {error} so the window can show a
        problem inline without closing on failure (item 21)."""
        res = self.toolbox_build(path, mapping)
        if res.get("error"):
            return {"error": res["error"]}
        if not res.get("sentences"):
            return {"error": "That mapping produced no sentences"}
        main = self.window
        if main is not None:
            payload = json.dumps({"sentences": res["sentences"], "name": res.get("name") or "toolbox.conllu"})
            js = "window.__applyToolboxResult && window.__applyToolboxResult(%s)" % payload
            threading.Thread(target=lambda: self._eval_quiet(main, js), daemon=True).start()
        self._close_child("toolbox")
        return {"ok": True}

    def child_refresh_models(self) -> dict:
        """Model Manager window → repopulate the main window's model dropdown after an
        install/remove so the picker reflects what is now available."""
        main = self.window
        if main is not None:
            threading.Thread(
                target=lambda: self._eval_quiet(main, "window.populateModels && window.populateModels()"),
                daemon=True).start()
        return {"ok": True}

    # ── gloss↔FEATS mappings (item 12) ────────────────────────────────────────
    # The editor window shows the DEFAULT Leipzig Feat=Val→abbreviation table
    # (app/data/feats_leipzig.json) merged with the user's saved CUSTOM overrides.
    # Custom overrides live in the SHARED persisted prefs (state.json → prefs.glossMap),
    # the exact store the main window reads into PREFS.glossMap, so both windows agree.
    # A custom entry with an empty abbreviation is a TOMBSTONE: it overlays "" onto a
    # default so featsToGloss/rebuildGlossMaps drop it (a deleted default). Reset simply
    # clears prefs.glossMap so the grid returns to exactly the defaults.
    def gloss_mappings(self) -> dict:
        """Return ``{"defaults": {...}, "custom": {...}}`` for the editor window —
        the built-in Leipzig defaults plus the user's saved custom overrides."""
        data = _load_json_file("feats_leipzig.json")
        defaults = data.get("map")
        defaults = defaults if isinstance(defaults, dict) else {}
        custom = self.get_prefs().get("glossMap")
        custom = custom if isinstance(custom, dict) else {}
        return {"defaults": defaults, "custom": custom}

    def gloss_inventory(self) -> dict:
        """The FEATS inventory (features grouped by category, with each feature's official
        value set) that drives the editor window's Feat autocomplete."""
        inv = _load_json_file("feats_inventory.json")
        feats = inv.get("features")
        feats = feats if isinstance(feats, dict) else {}
        cats = inv.get("categories")
        cats = cats if isinstance(cats, list) else []
        out: dict[str, dict] = {}
        for name, meta in feats.items():
            if not isinstance(meta, dict):
                continue
            vals = meta.get("values")
            out[name] = {"category": meta.get("category") or "Other",
                         "values": vals if isinstance(vals, dict) else {}}
        return {"categories": cats, "features": out}

    def save_gloss_mappings(self, custom: dict) -> dict:
        """Persist the editor's custom overrides (the diff vs defaults, incl. empty-abbr
        tombstones for deleted defaults) into the shared prefs, then push the change to the
        main window so its effective gloss map updates immediately."""
        clean: dict[str, str] = {}
        if isinstance(custom, dict):
            for feat, abbr in custom.items():
                f = str(feat).strip()
                a = "" if abbr is None else str(abbr).strip()
                if _FEAT_KEY_RE.match(f):
                    clean[f] = a
        state = _load_state()
        prefs = state.get("prefs")
        if not isinstance(prefs, dict):
            prefs = {}
        prefs["glossMap"] = clean
        state["prefs"] = prefs
        _save_state(state)
        self._notify_glossmap_changed(clean)
        return {"ok": True, "custom": clean}

    def reset_gloss_mappings(self) -> dict:
        """Clear all custom overrides so the effective map is exactly the defaults."""
        state = _load_state()
        prefs = state.get("prefs")
        if isinstance(prefs, dict) and "glossMap" in prefs:
            prefs.pop("glossMap", None)
            state["prefs"] = prefs
            _save_state(state)
        self._notify_glossmap_changed({})
        return {"ok": True}

    def _notify_glossmap_changed(self, custom: dict) -> None:
        """Tell the MAIN window to adopt the new custom overrides + rebuild its effective
        gloss map (so morphemic-gloss pre-fill + back-mapping change at once)."""
        main = self.window
        if main is not None:
            js = "window.__glossMapChanged && window.__glossMapChanged(%s)" % json.dumps(custom)
            threading.Thread(target=lambda: self._eval_quiet(main, js), daemon=True).start()

    @staticmethod
    def _eval_quiet(win, js: str) -> None:
        try:
            win.evaluate_js(js)
        except Exception as exc:  # noqa: BLE001
            print(f"[window] evaluate_js: {exc}", file=sys.stderr)

    # ── generated HTML for the Python-built windows (About / Models / Toolbox / Gloss Mappings) ──
    @staticmethod
    def _confirm_js() -> str:
        """`askConfirm(msg, okLabel, danger) -> Promise<bool>` for the child windows.

        Stands in for `window.confirm`, which never returns true in this WKWebView (see the CSS note).
        Resolves true only on the action button; Escape, the Cancel button and a click on the scrim all
        resolve false. Escape calls preventDefault so macOS does not beep at a gesture that did something —
        the same rule the main window's Escape ladder follows.
        """
        return """
    function askConfirm(msg,okLabel,danger,okOnly){return new Promise(function(resolve){
      var scrim=document.createElement('div');scrim.className='cfm-scrim';
      var box=document.createElement('div');box.className='cfm-box';
      var m=document.createElement('div');m.className='cfm-msg';m.textContent=msg;box.appendChild(m);
      var acts=document.createElement('div');acts.className='cfm-acts';
      var cancel=document.createElement('button');cancel.className='sec';cancel.textContent='Cancel';
      var ok=document.createElement('button');ok.textContent=okLabel||'OK';if(danger)ok.className='danger';
      if(okOnly)ok.className='';else acts.appendChild(cancel);   // okOnly → a one-button ALERT (an error to acknowledge, nothing to decline); never danger-styled, since acknowledging is not destructive
      acts.appendChild(ok);box.appendChild(acts);scrim.appendChild(box);
      function done(v){document.removeEventListener('keydown',key,true);scrim.remove();resolve(v);}
      function key(e){ if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false);}
                       else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();done(true);} }
      cancel.onclick=function(){done(false);};ok.onclick=function(){done(true);};
      scrim.onclick=function(e){if(e.target===scrim)done(false);};
      document.addEventListener('keydown',key,true);
      document.body.appendChild(scrim);ok.focus();});}
    """

    @staticmethod
    def _base_css() -> str:
        # --bg is the app TITLEBAR colour (light white-tint / dark rgb(30,30,30)) so every dialog
        # window body reads as one continuous surface with the main window's titlebar (item 22).
        return """
    /* --label-* is the macOS 26 kit's Labels ramp (secondary fills a Form Row's Subtitle, quinary strokes its
       divider). Restated here rather than shared: a child window is its OWN document and never loads
       web/macos-kit/mac-tokens.css, so the two copies have to be kept in step by hand — see that file's block
       for the dark-mode reasoning behind the .55 and .10 lifts. */
    :root{--bg:#fbfbfd;--fg:#1d1d1f;--muted:#68686e;--accent:#0a84ff;--field:#fff;
          --line:rgba(0,0,0,.14);--hover:rgba(0,0,0,.05);--head:rgba(0,0,0,.55);
          --label-secondary:rgba(0,0,0,.50);--label-quinary:rgba(0,0,0,.05)}
    @media (prefers-color-scheme:dark){:root{--bg:rgb(30,30,30);--fg:#e7e7ea;--muted:#9a9aa1;--accent:#3a9bff;
          --field:#1c1c1f;--line:rgba(255,255,255,.15);--hover:rgba(255,255,255,.06);--head:rgba(255,255,255,.6);
          --label-secondary:rgba(255,255,255,.55);--label-quinary:rgba(255,255,255,.10)}}
    *{box-sizing:border-box}
    html,body{margin:0;height:100%;overscroll-behavior:none}   /* no rubber-band/swipe-back bounce, matching the main window's every scroller */
    body{background:var(--bg);color:var(--fg);
         font:14px/1.45 """ + UI_FONT_STACK + """;
         -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    h1,h2,h3,h4{margin:0}
    /* one SHARED bottom-action-button style across every dialog window (item 24): same 30px height + 13px font.
       Rounded RECTANGLE, not a capsule — these are all separate-window content dialogs (Manage Models, Gloss
       Mappings, Import Toolbox, About, Help), the same "sheet" kind as the in-page Settings/Save/Insert Text
       As sheets, which use an 8px rect; only a small plain ALERT (a 2-3-button "are you sure?" prompt with no
       other content) gets the fully-rounded pill — see the macos-26-design skill for the alert-vs-sheet split. */
    button{font-family:inherit;font-size:13px;font-weight:590;height:30px;min-width:76px;padding:0 15px;
           border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
    button.sec{background:var(--field);color:var(--fg);border:.5px solid var(--line)}
    button:active{filter:brightness(.93)}
    input,textarea{font-family:inherit;font-size:14px;color:var(--fg);background:var(--field);
           border:.5px solid var(--line);border-radius:8px;padding:7px 9px;width:100%}
    input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 28%,transparent)}
    a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
    .nowrap{white-space:nowrap}
    /* IN-PAGE CONFIRM (see _confirm_js). window.confirm() is UNIMPLEMENTED in this WKWebView — pywebview sets no
       WKUIDelegate, so runJavaScriptConfirmPanel never fires and confirm() returns false without ever showing a
       panel. Every `if(!confirm(...))return;` therefore bailed silently: the Model Manager's Remove button and
       the Gloss Mappings reset both did nothing at all, with no error to show for it. Same shape as window.open
       being inert here (see openExternal in web/js/io/bridge.js). This is the replacement.
       A 2-3-button "are you sure?" with no other content is an ALERT, not a sheet, so per the split documented
       on `button` above it takes the fully-rounded pill; the actions fill the width (halves for two), matching
       the main window's own alerts. */
    .cfm-scrim{position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:rgba(0,0,0,.28);
        -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
    /* Metrics from the macOS 26 kit's Alert (node 682:3933): 260 wide, padding 20/16/16, a 16px gap above the
       buttons, 32px pill buttons 8px apart. The message is the alert's TITLE, so it takes the kit's Headline
       (SF Pro Bold 13/16) — and the text is LEFT-aligned, as the kit draws it; macOS centred alert text in
       earlier releases, which is why this was centred before. */
    .cfm-box{width:260px;max-width:calc(100vw - 40px);background:var(--bg);color:var(--fg);border-radius:14px;
        border:.5px solid var(--line);box-shadow:0 12px 40px rgba(0,0,0,.30);padding:20px 16px 16px;text-align:left}
    .cfm-msg{font-size:13px;line-height:16px;font-weight:700;margin-bottom:16px;overflow-wrap:anywhere}
    .cfm-acts{display:flex;gap:8px}
    .cfm-acts button{flex:1 1 0;min-width:0;height:32px;font-weight:510;border-radius:999px}   /* basis 0 → EQUAL shares, not label-proportional */
    """

    @staticmethod
    def _icon_data_uri(name: str) -> str:
        """`app/data/<name>` as a data URI, or "" if it isn't there.

        A child window's HTML is a STRING handed to the webview with no base URL and no file server, so
        an `<img src>` can only be a data URI — a relative path resolves against nothing. The 256 px
        variants exist for exactly this (packaging/build_icons.sh step 6); the full-size Dock PNGs are
        ~2 MB each and have no business being base64'd into a 380x320 dialog. Missing file → "", and the
        caller drops the <img> rather than showing a broken-image glyph.
        """
        import base64
        p = os.path.join(os.path.dirname(__file__), "data", name)
        try:
            with open(p, "rb") as fh:
                return "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")
        except OSError:
            return ""

    def _about_html(self, version: str) -> str:
        v = _esc(version or "")
        # "CoNLL-U" must never wrap: a non-breaking hyphen (U+2011) inside a white-space:nowrap span.
        conllu = "<span class=\"nowrap\">CoNLL‑U</span>"
        # The app icon, light and dark. Both are embedded and swapped by CSS rather than picked here in
        # Python: a child window follows the SYSTEM appearance live, and this HTML is built once when the
        # window opens — choosing in Python would freeze whichever appearance was current at that moment.
        ic_l, ic_d = self._icon_data_uri("appicon-256.png"), self._icon_data_uri("appicon-dark-256.png")
        icon = ""
        if ic_l:
            icon = '<img class="appicon" src="' + ic_l + '" alt="">'
            if ic_d:
                icon += '<img class="appicon appicon-dark" src="' + ic_d + '" alt="">'
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" + self._base_css() + """
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
         gap:7px;padding:26px 26px 22px}
    /* 128 pt, the size macOS's own About panels use; the 256 px asset covers it at 2x. No border-radius:
       the icon carries its own rounded body and shadow (Icon Composer owns those), and rounding it again
       would clip the corners of a shape that is already correctly inset on the 824-in-1024 grid. */
    .appicon{width:128px;height:128px;margin-bottom:3px}
    .appicon-dark{display:none}
    @media (prefers-color-scheme:dark){.appicon{display:none} .appicon-dark{display:block}}
    .app{font-size:17px;font-weight:700}
    .desc{font-size:13px;color:var(--muted);max-width:300px;line-height:1.5}
    .by{font-size:13px;margin-top:5px}
    .ver{font-size:11.5px;color:var(--muted);margin-top:1px}
    button{margin-top:16px}
    </style></head><body>
    """ + icon + """
    <div class="app">SUD Workbench</div>
    <div class="desc">A viewer and editor for SUD, UD and mSUD """ + conllu + """ dependency treebanks.</div>
    <div class="by">Created by <b>Siva Kalyan</b></div>
    <div class="ver">Version """ + v + """</div>
    <button onclick="window.pywebview.api.close_child_window('about')">Close</button>
    <script>document.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();try{window.pywebview.api.close_child_window('about');}catch(_){}}});</script>
    </body></html>""")

    def _models_html(self, focus: str = "") -> str:
        # `focus` is an extras tier KEY, and it is JSON-encoded into the page rather than
        # interpolated raw: it arrives from the frontend (translit.js's `needs`), and this page is
        # built by string concatenation, so a quote in it would otherwise break out of the literal.
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" + self._confirm_js()
            + "var FOCUS=" + json.dumps(str(focus or "")) + ";"
            + "</script><style>" + self._base_css() + """
    body{display:flex;flex-direction:column;padding:16px;gap:11px}
    .sub{font-size:12.5px;color:var(--muted)}
    .bar{display:flex;gap:8px;align-items:center}
    .bar input{flex:1}
    #list{flex:1;overflow:auto;min-height:120px;border:.5px solid var(--line);border-radius:12px;padding:0 4px 4px}   /* radius 12 == the Form Group's own corner radius in the kit (node 2302:6716); was 10, chosen before the fills/radius were readable */
    /* category headings stick to the top of the scroll area as the list scrolls (item 15a).
       top:0 (the list now has no top padding) + a matching background cover the scroll gap so rows never peek above. */
    /* item 8: BOTH group headings ("SUD · spaCy" and "UD · Stanza") share the same small top
       padding so neither sits with an oversized gap above it — the first still lands flush at the top */
    .gh{position:sticky;top:0;z-index:2;background:var(--bg);
        font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--head);
        padding:6px 8px 5px}
    /* item 11: destructive (Remove) button — macOS systemRed treatment (per the design skill:
       destructive == --accent-red text on a subtle --destructive-fill), tuned for both themes */
    button.danger{background:rgba(255,56,60,.14);color:#ff383c;border:.5px solid rgba(255,56,60,.30)}
    @media (prefers-color-scheme:dark){button.danger{background:rgba(255,69,58,.20);color:#ff453a;border-color:rgba(255,69,58,.36)}}
    /* THE FORM ROW — Figma "Form" frame (file lECo5A8n2No81Jp7ymUbGp, node 2302:6358): a Form Group holds its Rows
       at a 10px inset, tiled contiguously at 42px each, with the Leading Accessories block flexible and vertically
       centred and the Right Accessory flush to the trailing edge, 16px clear of the leading block. A model row is
       exactly that shape (name + subtitle leading, a Download/Remove button or an "Installed" pill trailing) on a
       real content pane, so it takes the spec whole. min-height, not height: these rows carry two or three lines
       and grow past 42, which the kit's own 106px row licenses. */
    .row{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;min-height:42px;border-radius:7px}
    /* Rows are separated by the kit's Form-Row divider — a 1px Labels/Quinary rule in the SEAM between two rows
       (drawn on the later sibling, so the list never ends on a trailing rule), inset by the same 10px the row
       itself is. This REPLACES the zebra striping these lists used to carry: the kit's Form Group separates rows
       with a hairline, not with an alternating fill, and running both read as noise. */
    .row + .row{box-shadow:inset 0 1px 0 0 transparent}
    .row + .row::before{content:"";position:absolute;inset-inline:10px;top:0;height:1px;background:var(--label-quinary);pointer-events:none}
    .row:hover{background:var(--hover)}
    /* The row a Script/transliteration menu sent the reader here to find. A brief accent wash rather
       than a persistent highlight: it answers "which of these?" and then gets out of the way, and
       nothing in this list is selectable, so a lasting mark would claim a state the list has not got.
       Reduced motion gets the same wash held still — the point is WHICH ROW, and a pulse is only one
       way of saying it. */
    @keyframes rowflash{0%{background:transparent}18%{background:color-mix(in srgb,var(--accent) 22%,transparent)}100%{background:transparent}}
    .row.flash{animation:rowflash 1.9s ease-out 1}
    @media (prefers-reduced-motion: reduce){.row.flash{animation:none;background:color-mix(in srgb,var(--accent) 14%,transparent)}}
    .mi{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}   /* Leading Accessory: Title over Subtitle, gap 2 — the kit's own value, confirmed against node 2302:6718 */
    .mi .nm{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* the Row's SUBTITLE, straight off the kit: SF Pro Medium 11 / line-height 14, filled Labels/Secondary.
       Medium (500) rather than the regular weight the muted caption used to carry — at 11px a secondary label
       needs the extra stroke weight to survive being dimmed to 50%, which is exactly why the kit specifies it. */
    .mi small{font-size:11px;font-weight:500;line-height:14px;color:var(--label-secondary,rgba(0,0,0,.5))}
    .mi .sc{font-size:11.5px;color:var(--head);font-variant-numeric:tabular-nums}   /* per-model UAS/LAS accuracy */
    .mi .ts{font-variant-numeric:tabular-nums}   /* training-set size; empty until the background sweep resolves it */
    .mi .ts:empty{display:none}
    .mi .sc b,.mi .ts b{font-weight:600}   /* the FIGURES carry the emphasis, not their captions */
    .right{display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-inline-start:8px}   /* Right Accessory: 8 + the row's own 8px gap = the kit's 16px leading↔accessory gutter */
    .pill{font-size:11.5px;color:var(--muted);border:.5px solid var(--line);border-radius:999px;padding:2px 8px}
    button.sm{height:26px;min-width:0;padding:0 12px;font-size:12px}
    .prog{height:4px;border-radius:2px;background:var(--line);overflow:hidden;margin-top:4px}
    .prog i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s}
    .foot{display:flex;justify-content:space-between;align-items:center;gap:8px}
    </style></head><body>
    <div class="sub">Download and remove SUD (spaCy) and UD (Stanza) parser models.</div>
    <div class="bar"><input id="q" type="search" placeholder="Search language…" spellcheck="false" autocomplete="off"></div>
    <div id="list">Loading…</div>
    <div class="foot">
      <button class="sec" id="refresh">Refresh</button>
      <button id="close">Close</button>
    </div>
    <script>
    var AVAIL=[];
    var EXTRAS=[];   // optional heavy-dependency tiers (installed on demand)
    var TRAIN={};    // model id → training-set sentences, filled in by pollTrain as the sweep resolves them
    var KEEP_SCROLL=0;   // list scroll offset carried across a re-render (item 17)
    function api(){return window.pywebview&&window.pywebview.api;}
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
    function fmtN(n){return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');}
    // The figure is emphasised, not its caption — `+TRAIN[id]` coerces to a number, so nothing but
    // digits and separators ever reaches innerHTML.
    function trainHtml(id){var n=+TRAIN[id];return n?('Trained on <b>'+fmtN(n)+'</b> sentences'):'';}
    // Patch the training-set line into rows already on screen, rather than re-rendering the list —
    // a re-render would drop the progress bar of any download running at the time.
    function applyTrain(){document.querySelectorAll('#list .row[data-mid]').forEach(function(r){
      var el=r.querySelector('.ts'); if(el)el.innerHTML=trainHtml(r.getAttribute('data-mid'));});}
    // Resolving the sizes needs one stats.xml per treebank, so the bridge does it on a background
    // thread and hands back what it has plus `pending`; poll until it settles, then stop.
    async function pollTrain(refresh){if(!api())return;
      var r; try{r=await api().model_train_sizes(!!refresh);}catch(e){return;}
      var s=(r&&r.sizes)||{}; for(var k in s)TRAIN[k]=s[k]; applyTrain();
      if(r&&r.pending)setTimeout(function(){pollTrain(false);},1200);}
    // WORD-PREFIX language matching, the same rule as web/js/core/state.js's wordPrefixRe and the two in-page
    // language menus that read it. Restated inline because this window is a self-contained page: it loads none
    // of the app's scripts, so it cannot call the shared helper and the rule has to be written twice. Keep the
    // two in step — a query matches a name only where some WORD of it starts with the query, a word beginning
    // at the string start or after any non-letter/non-digit. The query is regex-escaped: it is typed text, and
    // a stray '(' would otherwise throw out of the keystroke handler and freeze the field.
    function wpRe(q){return new RegExp('(?:^|[^\\\\p{L}\\\\p{N}])'+String(q).replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&'),'u');}
    function match(e,q){return !q||wpRe(q).test((e.label||'').toLowerCase())||(e.lang||'').toLowerCase()===q;}
    async function load(refresh){var host=document.getElementById('list'); if(!api()){host.textContent='Model management is available in the desktop app.';return;}
      KEEP_SCROLL=host.scrollTop;   // remember scroll before 'Loading…' clears it (item 17)
      host.textContent='Loading…';
      var r; try{r=await api().list_models(!!refresh);}catch(e){host.textContent='Failed to load models: '+e;return;}
      if(r.error){host.textContent='Failed to load models: '+r.error;return;}
      AVAIL=r.available||[];
      AVAIL.forEach(function(e){if(e.train_sents)TRAIN[e.id]=e.train_sents;});   // whatever the disk cache already knew, shown immediately
      try{var ex=await api().list_extras(); EXTRAS=(ex&&ex.extras)||[];}catch(e){EXTRAS=[];}
      draw(); pollTrain(!!refresh);}
    function draw(){var host=document.getElementById('list'); var keep=host.scrollTop||KEEP_SCROLL; KEEP_SCROLL=0;
      var q=(document.getElementById('q').value||'').trim().toLowerCase(); host.innerHTML='';
      function grp(title,engine){var rows=AVAIL.filter(function(e){return e.engine===engine&&match(e,q);}); if(!rows.length)return;
        var h=document.createElement('div');h.className='gh';h.textContent=title;host.appendChild(h);
        rows.forEach(function(e){host.appendChild(row(e));});}
      grp('SUD · spaCy','sud'); grp('UD · Stanza','stanza');
      if(!q && EXTRAS.length){   // optional heavy-dependency tiers — always shown, not filtered by the language search
        var eh=document.createElement('div');eh.className='gh';eh.textContent='Optional language support';host.appendChild(eh);
        EXTRAS.forEach(function(t){host.appendChild(extraRow(t));});}
      host.scrollTop=keep;   // restore the pre-render scroll offset (item 17)
      if(!host.children.length) host.textContent=q?'No matches.':'No models found (offline?). Try Refresh.';
      revealFocus();}
    // A tier named by open_models_window(focus) — the row a Script/transliteration menu's "install"
    // link was pointing at. Consumed ONCE: this list re-draws after every install and on Refresh, and
    // a flash that fired again each time would be pointing at a row the reader has already dealt with.
    // The scroll is `nearest`, so a row already on screen does not move under the pointer.
    function revealFocus(){if(!FOCUS)return; var el=document.querySelector('#list .row[data-tier="'+FOCUS+'"]');
      FOCUS=''; if(!el)return;
      try{el.scrollIntoView({block:'nearest'});}catch(_){el.scrollIntoView();}
      el.classList.add('flash');}
    function row(e){var row=document.createElement('div');row.className='row';row.setAttribute('data-mid',e.id);
      var info=document.createElement('div');info.className='mi';
      var meta=[e.version?('v'+e.version):null,e.size?(Math.round(e.size/1e6)+' MB'):null].filter(Boolean).join(' · ');
      var sc=(e.uas!=null&&e.las!=null)?('<small class="sc">UAS <b>'+(+e.uas)+'</b> · LAS <b>'+(+e.las)+'</b></small>'):'';   // same " · " separator the version/size meta line uses
      info.innerHTML='<span class="nm">'+esc(e.label||e.id)+'</span>'+(meta?'<small>'+esc(meta)+'</small>':'')
        +'<small class="ts">'+trainHtml(e.id)+'</small>'+sc;
      var right=document.createElement('div');right.className='right';
      if(e.installed){var tag=document.createElement('span');tag.className='pill';tag.textContent=e.bundled?'Bundled ✓':'Installed ✓';right.appendChild(tag);
        // A bundled model (models_registry.BUNDLED_SUD — the English parser the definition lookup
        // itself runs on) gets no Remove button: it came with the app, so it isn't the user's to
        // manage, and remove() refuses it anyway. THIS window is the one macOS actually opens
        // (manageModels() → open_models_window), and it was offering the button and then failing on
        // the click; the in-page sheet in js/io/models.js had the pill from the start, which is what
        // made the gap easy to miss.
        if(!e.bundled){var b=document.createElement('button');b.className='danger sm';b.textContent='Remove';b.onclick=function(){removeModel(e,row);};right.appendChild(b);}}
      else{var d=document.createElement('button');d.className='sm';d.textContent='Download';d.onclick=function(){downloadModel(e,row,d);};right.appendChild(d);}
      row.appendChild(info);row.appendChild(right);return row;}
    async function downloadModel(e,row,btn){btn.disabled=true;btn.textContent='Starting…';
      var prog=document.createElement('div');prog.className='prog';var bar=document.createElement('i');prog.appendChild(bar);row.querySelector('.mi').appendChild(prog);
      var r; try{r=await api().download_model(e.id);}catch(err){btn.disabled=false;btn.textContent='Download';prog.remove();return;}
      if(r.error){btn.disabled=false;btn.textContent='Download';prog.remove();return;}
      var job=r.job_id;
      var tick=async function(){var st; try{st=await api().model_job_status(job);}catch(err){return;}
        if(st.error){btn.disabled=false;btn.textContent='Download';prog.remove();return;}
        if(st.pct!=null)bar.style.width=st.pct+'%'; if(st.note)btn.textContent=st.note;
        if(st.done){try{api().child_refresh_models();}catch(_){} load(false);return;}
        setTimeout(tick,500);};
      tick();}
    async function removeModel(e,row){if(!await askConfirm('Remove '+(e.label||e.id)+'?','Remove',true))return;   // askConfirm, NOT window.confirm — confirm() never returns true in this WKWebView, so this handler used to bail before ever reaching the bridge and Remove silently did nothing (see _confirm_js)
      var r; try{r=await api().remove_model(e.id);}catch(err){return;}
      if(r.error)return; try{api().child_refresh_models();}catch(_){} load(false);}
    function extraRow(t){var row=document.createElement('div');row.className='row';
      row.setAttribute('data-tier',t.id);   // what revealFocus() looks the focused tier up by
      var info=document.createElement('div');info.className='mi';
      info.innerHTML='<span class="nm">'+esc(t.label||t.id)+'</span>'+(t.note?'<small>'+esc(t.note)+'</small>':'');
      var right=document.createElement('div');right.className='right';
      if(t.installed){var tag=document.createElement('span');tag.className='pill';tag.textContent='Installed ✓';right.appendChild(tag);}
      else{var b=document.createElement('button');b.className='sm';b.textContent='Install';b.onclick=function(){installExtra(t,row,b);};right.appendChild(b);}
      row.appendChild(info);row.appendChild(right);return row;}
    async function installExtra(t,row,btn){btn.disabled=true;btn.textContent='Starting…';
      var prog=document.createElement('div');prog.className='prog';var bar=document.createElement('i');prog.appendChild(bar);row.querySelector('.mi').appendChild(prog);
      var r; try{r=await api().install_extra(t.id);}catch(err){btn.disabled=false;btn.textContent='Install';prog.remove();return;}
      if(r.error){btn.disabled=false;btn.textContent='Install';prog.remove();return;}
      var job=r.job_id;
      var tick=async function(){var st; try{st=await api().model_job_status(job);}catch(err){return;}
        if(st.error){btn.disabled=false;btn.textContent='Install';prog.remove();return;}
        if(st.pct!=null)bar.style.width=st.pct+'%'; if(st.note)btn.textContent=st.note;
        if(st.done){load(false);return;}
        setTimeout(tick,500);};
      tick();}
    document.getElementById('q').addEventListener('input',draw);
    document.getElementById('refresh').onclick=function(){load(true);};
    document.getElementById('close').onclick=function(){try{api().close_child_window('models');}catch(_){}};
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();try{api().close_child_window('models');}catch(_){}}});
    window.addEventListener('pywebviewready',function(){load(false);});
    if(api())load(false);
    </script>
    </body></html>""")

    def _glossmap_html(self) -> str:
        # embed the DEFAULTS + the user's CUSTOM overrides + the FEATS inventory (for the
        # Feat autocomplete) so the page has everything it needs without an extra round-trip.
        gm = self.gloss_mappings()
        data = json.dumps({
            "defaults": gm.get("defaults", {}),
            "custom": gm.get("custom", {}),
            "inv": self.gloss_inventory(),
        }).replace("</", "<\\/")
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" + self._confirm_js() + "</script><style>" + self._base_css() + """
    body{display:flex;flex-direction:column;padding:16px;gap:11px}
    .sub{font-size:12.5px;color:var(--muted)}
    /* item 6: no padding-top on the scroll container. Sticky elements pin to the scrollport's
       padding edge, so any padding-top here would leave a bare strip ABOVE the sticky header that
       rows peek through as they scroll up. Zero top padding lets the header sit flush at the very
       top; the breathing space it used to give is folded into the header's own top padding below. */
    #list{flex:1;overflow:auto;min-height:120px;border:.5px solid var(--line);border-radius:12px;padding:0 4px 4px}   /* radius 12 == the Form Group's own corner radius in the kit (node 2302:6716); was 10, chosen before the fills/radius were readable */
    /* item 13b: pin the column headers so they stay visible while the mappings list scrolls.
       An opaque --bg fill hides rows sliding underneath; z-index keeps it above the rows.
       item 6: extra padding-top gives the header top breathing room now that #list has none, and
       its opaque --bg extends right up to the scrollport top so nothing shows through above it. */
    /* Form Row (Figma node 2302:6358 — see the note on .row in _models_html): 10px row inset, rows tiled
       contiguously at a 42px minimum, and the trailing accessory 16px clear of the leading block. The 26px remove
       button sits in a 34px track (26 + the 8px it is pushed by, which with the grid's own 8px gap makes 16). */
    .gmhead{position:sticky;top:0;z-index:2;background:var(--bg);
            display:grid;grid-template-columns:120px 1fr 34px;gap:8px;align-items:center;
            padding:8px 10px 6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--head)}
    .gmrow{display:grid;grid-template-columns:120px 1fr 34px;gap:8px;align-items:center;padding:0 10px;min-height:42px;border-radius:7px}
    .gmrow:hover{background:var(--hover)}
    .gmrow input{height:30px;font-size:13.5px}
    .gmrow input.abbr{font-weight:normal;text-transform:none}   /* item 13a: abbreviations at NORMAL weight (was 600) */
    .gmrow input.bad{border-color:#ff3b30;box-shadow:0 0 0 2px rgba(255,59,48,.18)}
    @media (prefers-color-scheme:dark){.gmrow input.bad{border-color:#ff6961}}
    .gmrm{height:26px;min-width:0;width:26px;padding:0;font-size:13px;line-height:1;margin-inline-start:8px;
          background:var(--field);color:var(--muted);border:.5px solid var(--line)}
    .gmrm:hover{color:#ff453a;border-color:rgba(255,69,58,.36)}
    .add{align-self:flex-start;height:28px;font-size:12.5px;min-width:0;padding:0 12px}
    .foot{display:flex;align-items:center;gap:8px}
    .foot .grow{flex:1}
    button.danger{background:rgba(255,56,60,.14);color:#ff383c;border:.5px solid rgba(255,56,60,.30)}
    @media (prefers-color-scheme:dark){button.danger{background:rgba(255,69,58,.20);color:#ff453a;border-color:rgba(255,69,58,.36)}}
    /* self-contained grouped FEATS autocomplete (same behaviour as the annotation grid) */
    .acmenu{position:fixed;z-index:50;max-height:260px;overflow:auto;background:var(--field);
            border:.5px solid var(--line);border-radius:9px;box-shadow:0 8px 28px rgba(0,0,0,.28);padding:4px;min-width:180px}
    .acmenu .ach{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--head);padding:5px 8px 2px}
    .acmenu .aci{display:flex;align-items:baseline;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer}
    .acmenu .aci.hi{background:var(--accent);color:#fff}
    .acmenu .aci .acl{font-size:13px;font-weight:600}
    .acmenu .aci .acd{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .acmenu .aci.hi .acd{color:rgba(255,255,255,.85)}
    </style></head><body>
    <div class="sub" id="sub">Loading…</div>
    <div id="list"></div>
    <button class="sec add" id="add" type="button">+ Add mapping</button>
    <div class="foot">
      <button class="sec danger" id="reset" type="button">Reset to Default</button>
      <span class="grow"></span>
      <button class="sec" id="cancel" type="button">Cancel</button>
      <button id="save" type="button">Save</button>
    </div>
    <script>
    var D=""" + data + """;
    var DEFAULTS=D.defaults||{}, CUSTOM=D.custom||{}, INV=D.inv||{};
    var CATS=INV.categories||[], FEATS={}, FEATCAT={}, VDESC={}, FEATNAMES=[];
    (function(){var fs=INV.features||{}; for(var f in fs){FEATS[f]=Object.keys(fs[f].values||{});FEATCAT[f]=fs[f].category||'Other';VDESC[f]=fs[f].values||{};} FEATNAMES=Object.keys(FEATS);})();
    var KEYRE=/^[^=\\s|]+=[^=\\s|]+$/;
    function api(){return window.pywebview&&window.pywebview.api;}
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
    var listEl=document.getElementById('list');

    // effective map = defaults overlaid with custom, minus tombstones (empty abbreviation)
    function effective(){var e=Object.assign({},DEFAULTS,CUSTOM); for(var k in e){if(!e[k])delete e[k];} return e;}

    function mkRow(feat,abbr){
      var row=document.createElement('div');row.className='gmrow';
      var a=document.createElement('input');a.type='text';a.className='abbr';a.placeholder='e.g. ERG';a.value=abbr||'';a.spellcheck=false;a.setAttribute('autocapitalize','off');a.setAttribute('autocomplete','off');
      var f=document.createElement('input');f.type='text';f.className='feat';f.placeholder='e.g. Case=Erg';f.value=feat||'';f.spellcheck=false;f.setAttribute('autocapitalize','off');f.setAttribute('autocomplete','off');
      bindFeat(f);
      var clr=function(){a.classList.remove('bad');f.classList.remove('bad');};
      a.addEventListener('input',clr);f.addEventListener('input',clr);
      var rm=document.createElement('button');rm.type='button';rm.className='gmrm';rm.textContent='\\u2715';rm.title='Remove this mapping';
      rm.addEventListener('click',function(){if(acInput===f)acClose();row.remove();});
      row.appendChild(a);row.appendChild(f);row.appendChild(rm);
      return row;}

    function render(){
      listEl.innerHTML='';
      var head=document.createElement('div');head.className='gmhead';head.innerHTML='<span>Abbreviation</span><span>Feature=Value</span><span></span>';listEl.appendChild(head);
      var eff=effective(),seen={};
      for(var k in DEFAULTS){if(k in eff){listEl.appendChild(mkRow(k,eff[k]));seen[k]=1;}}
      for(var k2 in eff){if(!seen[k2])listEl.appendChild(mkRow(k2,eff[k2]));}
      var nd=Object.keys(DEFAULTS).length;
      document.getElementById('sub').innerHTML='Map Leipzig abbreviations to morphological features. Editing or deleting a row overrides the '+nd+' built-in defaults; these drive morphemic-gloss pre-fill and back-mapping.';}

    // collect the grid → effective {feat:abbr}, flagging malformed rows
    function collect(){var eff={},bad=0;
      listEl.querySelectorAll('.gmrow').forEach(function(r){
        var ai=r.querySelector('.abbr'),fi=r.querySelector('.feat');
        var a=(ai.value||'').trim(),f=(fi.value||'').trim();
        if(!a&&!f)return;
        if(!a||!KEYRE.test(f)){bad++;if(!a)ai.classList.add('bad');if(!KEYRE.test(f))fi.classList.add('bad');return;}
        eff[f]=a;});
      return {eff:eff,bad:bad};}

    // diff the effective grid against the defaults → the minimal custom store (+ tombstones for deleted defaults)
    function diff(eff){var c={};
      for(var f in eff){if(DEFAULTS[f]!==eff[f])c[f]=eff[f];}
      for(var d in DEFAULTS){if(!(d in eff))c[d]='';}
      return c;}

    function doSave(){var r=collect(); var custom=diff(r.eff);
      try{api().save_gloss_mappings(custom);}catch(e){}
      try{api().close_child_window('glossmap');}catch(_){}}
    async function doReset(){if(!await askConfirm('Reset all mappings to the built-in defaults? This discards your custom changes.','Reset',true))return;   // see removeModel: window.confirm is inert here, so this reset silently did nothing either
      try{api().reset_gloss_mappings();}catch(e){} CUSTOM={}; acClose(); render();}
    function doCancel(){acClose();try{api().close_child_window('glossmap');}catch(_){}}

    // ── self-contained grouped autocomplete for the Feat inputs ──
    var acMenu=null,acItems=[],acIdx=-1,acInput=null,acPick=null;
    function acClose(){if(acMenu){acMenu.remove();acMenu=null;}acItems=[];acIdx=-1;acInput=null;acPick=null;}
    function acHi(i){acItems.forEach(function(it,j){it.el.classList.toggle('hi',j===i);});acIdx=i;
      if(i>=0&&acItems[i])acItems[i].el.scrollIntoView({block:'nearest'});}
    function acOpen(inp){
      var caret=(inp.selectionStart!=null)?inp.selectionStart:inp.value.length;
      var seg=inp.value.slice(0,caret),eq=seg.indexOf('='),groups=[],pick;
      if(eq<0){
        if(!seg){acClose();return;}
        var q=seg.toLowerCase();
        var names=FEATNAMES.filter(function(n){return n.toLowerCase().indexOf(q)===0;});
        if(!names.length)names=FEATNAMES.filter(function(n){return n.toLowerCase().indexOf(q)>=0;});
        names=names.filter(function(n){return n.toLowerCase()!==q;});
        if(!names.length){acClose();return;}
        var placed={};
        CATS.forEach(function(cat){var gi=names.filter(function(n){return FEATCAT[n]===cat;});gi.forEach(function(n){placed[n]=1;});
          if(gi.length)groups.push({title:cat,items:gi.map(function(n){return {label:n,desc:''};})});});
        var rest=names.filter(function(n){return !placed[n];});
        if(rest.length)groups.push({title:'Other',items:rest.map(function(n){return {label:n,desc:''};})});
        pick=function(v){inp.value=v+'=';inp.focus();try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(_){}setTimeout(function(){acOpen(inp);},0);};
      } else {
        var key=seg.slice(0,eq),q2=seg.slice(eq+1).toLowerCase(),vals=FEATS[key]||[];
        var ms=!q2?vals.slice():vals.filter(function(v){return v.toLowerCase().indexOf(q2)===0;});
        if(q2&&!ms.length)ms=vals.filter(function(v){return v.toLowerCase().indexOf(q2)>=0;});
        ms=ms.filter(function(v){return v.toLowerCase()!==q2;});
        if(!ms.length){acClose();return;}
        var vd=VDESC[key]||{};
        groups.push({title:key,items:ms.map(function(v){return {label:v,desc:vd[v]||''};})});
        pick=function(v){inp.value=key+'='+v;inp.focus();try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(_){}inp.classList.remove('bad');acClose();};
      }
      if(acMenu)acMenu.remove();
      acMenu=document.createElement('div');acMenu.className='acmenu';acItems=[];
      groups.forEach(function(g){var h=document.createElement('div');h.className='ach';h.textContent=g.title;acMenu.appendChild(h);
        g.items.forEach(function(it){var d=document.createElement('div');d.className='aci';
          d.innerHTML='<span class="acl">'+esc(it.label)+'</span>'+(it.desc?'<span class="acd">'+esc(it.desc)+'</span>':'');
          var idx=acItems.length;
          d.addEventListener('mousedown',function(e){e.preventDefault();pick(it.label);});
          d.addEventListener('mouseenter',function(){acHi(idx);});
          acMenu.appendChild(d);acItems.push({el:d,val:it.label});});});
      document.body.appendChild(acMenu);
      var rc=inp.getBoundingClientRect();
      acMenu.style.left=rc.left+'px';acMenu.style.top=(rc.bottom+2)+'px';acMenu.style.minWidth=rc.width+'px';
      acInput=inp;acPick=pick;acIdx=-1;}
    function bindFeat(inp){
      inp.addEventListener('input',function(){acOpen(inp);});
      inp.addEventListener('focus',function(){acOpen(inp);});
      inp.addEventListener('blur',function(){setTimeout(acClose,140);});
      inp.addEventListener('keydown',function(e){
        if(!acMenu||acInput!==inp)return;
        if(e.key==='ArrowDown'){e.preventDefault();acHi((acIdx+1)%acItems.length);}
        else if(e.key==='ArrowUp'){e.preventDefault();acHi((acIdx-1+acItems.length)%acItems.length);}
        else if((e.key==='Enter'||e.key==='Tab')&&acIdx>=0){e.preventDefault();acPick(acItems[acIdx].val);}
        else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();acClose();}});}

    document.getElementById('add').onclick=function(){var r=mkRow('','');listEl.appendChild(r);var i=r.querySelector('.abbr');if(i)i.focus();r.scrollIntoView({block:'nearest'});};
    document.getElementById('save').onclick=doSave;
    document.getElementById('reset').onclick=doReset;
    document.getElementById('cancel').onclick=doCancel;
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();doCancel();}
      else if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();doSave();}});
    window.addEventListener('resize',acClose);
    render();
    </script>
    </body></html>""")

    def _toolbox_html(self, probe: dict) -> str:
        # embed the probe safely inside the page's <script> (guard the string against a literal </script>)
        data = json.dumps({
            "path": probe.get("path", ""),
            "record_marker": probe.get("record_marker", ""),
            "n_records": probe.get("n_records", 0),
            "markers": probe.get("markers", []),
        }).replace("</", "<\\/")
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" + self._base_css() + """
    /* item 14: compact rows/margins + larger text so the mapping reads without dead space */
    body{display:flex;flex-direction:column;padding:14px}
    .sub{font-size:13.5px;color:var(--muted);margin:0 0 6px;line-height:1.4}
    .sub b{color:var(--fg);font-weight:600}
    /* item 6: the list grows to fill the window so the action row is pushed to the bottom — no dead
       band below the buttons; min-height:0 lets it shrink within the flex column when content is short */
    #list{flex:1;overflow:auto;min-height:0}
    /* item 8: every heading gets the SAME top margin as the first ("Sentence-level fields")
       heading, so the space above "Token-level fields" matches the space above it */
    h4{font-size:13.5px;font-weight:700;color:var(--head);margin:16px 0 1px}
    /* item 10: extra breathing room BEFORE each field list — the gap after a heading's hint,
       just above its first row.  Held BELOW the 16px that sits above each heading, so the
       space-above-heading always stays ≥ the space-before-list. */
    .shint{font-size:12.5px;color:var(--muted);margin-bottom:10px}
    /* Form Row (macOS 26 kit): 42px tall, tiling contiguously, 10px inset, and a 16px gutter between the
       leading block and the trailing accessory — the same treatment the Model Manager rows take, so the two
       mapping-style lists in this app read as one thing. Supersedes the earlier "compact rows" pass (item 14):
       that bought density by shrinking a row below the kit's own, and the kit's tall-row variant shows the
       right way to spend the height instead. `gap:8` + `.right`'s 8px start margin == the kit's 16 gutter. */
    .row{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;min-height:42px;border-radius:7px}
    .row .right{display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-inline-start:8px}   /* Right Accessory, flush to the row's trailing edge */
    /* Rows are separated by the kit's Form-Row divider — a 1px Labels/Quinary rule in the SEAM between two rows
       (drawn on the later sibling, so the list never ends on a trailing rule), inset by the same 10px the row
       itself is. This REPLACES the zebra striping these lists used to carry: the kit's Form Group separates rows
       with a hairline, not with an alternating fill, and running both read as noise. */
    .row + .row{box-shadow:inset 0 1px 0 0 transparent}
    .row + .row::before{content:"";position:absolute;inset-inline:10px;top:0;height:1px;background:var(--label-quinary);pointer-events:none}
    .row:hover{background:var(--hover)}
    /* The Leading Accessory here is a two-COLUMN block (fixed-width marker key + sample), not the kit's
       Title-over-Subtitle stack — a marker is a key its sample belongs to, and stacking them would read as one
       label with a caption. The sample is still the row's secondary text, so it takes Labels/Secondary; it keeps
       13px rather than the Subtitle's 11, because it is prose the user has to read to choose a mapping, not a
       caption glossing the line above it. */
    .mk{font-family:""" + MONO_FONT_STACK + """;font-size:14px;font-weight:700;min-width:54px;color:var(--fg)}
    .smp{flex:1 1 auto;min-width:0;font-size:13px;color:var(--label-secondary,rgba(0,0,0,.5));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* dropdowns: NO box-shadow, in any state (item 28) */
    select{appearance:none;-webkit-appearance:none;flex:0 0 auto;height:30px;font-family:inherit;font-size:14px;
           color:var(--fg);background:var(--field);border:.5px solid var(--line);border-radius:8px;padding:0 26px 0 9px;cursor:pointer;
           box-shadow:none !important;
           background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
           background-repeat:no-repeat;background-position:right 9px center}
    select:focus{outline:none;border-color:var(--accent);box-shadow:none !important}
    input.lang{width:58px;height:30px;font-size:14px;flex:0 0 auto;padding:0 8px}
    /* item 8: the action row gets the same top margin as the headings, so the space above the
       buttons matches the space above "Sentence-level fields" */
    .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex:0 0 auto}
    .err{color:#ff3b30;font-size:12px;margin-right:auto;align-self:center}
    @media (prefers-color-scheme:dark){.err{color:#ff6961}}
    </style></head><body>
    <div class="sub" id="sub"></div>
    <div id="list"></div>
    <div class="actions">
      <span class="err" id="err"></span>
      <button class="sec" id="cancel">Cancel</button>
      <button id="go">Import</button>
    </div>
    <script>
    var INFO=""" + data + """;
    var SENT=[['sent_id','Sentence ID'],['text','Text'],['translation','Translation…'],['ignore','Ignore']];
    var TOK=[['form','Form'],['lemma','Lemma'],['upos','UPOS'],['xpos','XPOS'],['gloss','Gloss'],['ignore','Ignore']];
    function api(){return window.pywebview&&window.pywebview.api;}
    function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
    function guessSent(m){var n=(m||'').replace(/^\\\\/,'').toLowerCase();
      if(['ref','id','seg','lref','segnum'].indexOf(n)>=0)return 'sent_id';
      if(['tx','t','text','utt','or','ph'].indexOf(n)>=0)return 'text';
      if(['ft','fte','fr','f','gn','e','tf','nt'].indexOf(n)>=0)return 'translation';
      return 'ignore';}
    function guessTok(m){var n=(m||'').replace(/^\\\\/,'').toLowerCase();
      if(['mb','m','mph','morph','tx','wd','w'].indexOf(n)>=0)return 'form';
      if(['ge','g','gl','gls','gloss','eng'].indexOf(n)>=0)return 'gloss';
      if(['ps','p','pos'].indexOf(n)>=0)return 'upos';
      if(['lx','lemma','l','cf','citation'].indexOf(n)>=0)return 'lemma';
      return 'ignore';}
    var ROWS=[];   // {marker, level, sel, lang}
    function mkRow(marker,level,targets,def,sample){
      var row=document.createElement('div');row.className='row';
      var nm=document.createElement('span');nm.className='mk';nm.textContent=marker;row.appendChild(nm);
      var smp=document.createElement('span');smp.className='smp';smp.textContent=sample||'';row.appendChild(smp);
      var sel=document.createElement('select');
      targets.forEach(function(t){var o=document.createElement('option');o.value=t[0];o.textContent=t[1];sel.appendChild(o);});
      sel.value=def;
      var lang=document.createElement('input');lang.type='text';lang.className='lang';lang.value='en';lang.maxLength=8;
      lang.placeholder='lang';lang.title='Language code for this translation (e.g. en, fr)';
      function sync(){lang.style.display=(sel.value==='translation')?'block':'none';}
      sel.addEventListener('change',sync);sync();
      // Form Row shape: the controls go in a Right Accessory so they sit FLUSH to the row's trailing edge
      // with the kit's 16px gutter, while .smp (flex:1) absorbs the slack — the same structure the Model
      // Manager rows use. Loose children would have been spaced by the row's own gap instead, which puts the
      // trailing control wherever the sample text happens to end.
      var right=document.createElement('div');right.className='right';
      right.appendChild(sel);right.appendChild(lang);row.appendChild(right);
      ROWS.push({marker:marker,level:level,sel:sel,lang:lang});
      return row;}
    function sect(title,hint){var h=document.createElement('h4');h.textContent=title;list.appendChild(h);
      if(hint){var p=document.createElement('div');p.className='shint';p.textContent=hint;list.appendChild(p);}}
    var list=document.getElementById('list');
    (function build(){
      var n=INFO.n_records||0;
      document.getElementById('sub').innerHTML='Map the Toolbox markers to CoNLL-U fields. Record marker <b>'+
        esc(INFO.record_marker||'')+'</b>; '+n+' record'+(n===1?'':'s')+'.';
      var marks=INFO.markers||[];
      sect('Sentence-level fields','One value per record (id, text line, free translation).');
      var rec=mkRow(INFO.record_marker,'sentence',SENT,'sent_id','record marker');list.appendChild(rec);
      marks.filter(function(m){return m.level==='sentence';}).forEach(function(m){
        list.appendChild(mkRow(m.marker,'sentence',SENT,guessSent(m.marker),m.sample));});
      sect('Token-level fields','Interlinear rows; one aligned token per column (morphemes, glosses, POS).');
      var tok=marks.filter(function(m){return m.level==='token';});
      if(!tok.length){var p=document.createElement('div');p.className='shint';
        p.textContent='No token-level (interlinear) markers were detected.';list.appendChild(p);}
      tok.forEach(function(m){list.appendChild(mkRow(m.marker,'token',TOK,guessTok(m.marker),m.sample));});
    })();
    function cancel(){try{api().close_child_window('toolbox');}catch(_){}}
    async function go(){
      var err=document.getElementById('err');err.textContent='';
      var mapping={record_marker:INFO.record_marker,sentence:{},token:{}};
      ROWS.forEach(function(r){var t=r.sel.value;if(t==='ignore')return;
        if(r.level==='sentence'){
          if(t==='translation'){var lc=(r.lang.value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')||'x';
            mapping.sentence[r.marker]='translation:'+lc;}
          else mapping.sentence[r.marker]=t;
        } else mapping.token[r.marker]=t;});
      if(!Object.keys(mapping.token).length){err.textContent='Map at least one token-level field (e.g. Form).';return;}
      var btn=document.getElementById('go');btn.disabled=true;btn.textContent='Importing…';
      var r; try{r=await api().child_toolbox_build(INFO.path,mapping);}catch(e){btn.disabled=false;btn.textContent='Import';err.textContent='Import failed: '+e;return;}
      if(r&&r.error){btn.disabled=false;btn.textContent='Import';err.textContent=r.error;return;}
      // on success the bridge loads the document into the main window and closes this one
    }
    document.getElementById('cancel').onclick=cancel;
    document.getElementById('go').onclick=go;
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();cancel();}
      else if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();go();}});
    </script>
    </body></html>""")
