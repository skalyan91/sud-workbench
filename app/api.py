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

from . import (appearance, convert, detect, glosses, io_conllu, itrans, menu_spec, model,
               models_registry, parse, toolbox_import)
from .paths import APP_DATA

_STATE_FILE = os.path.join(APP_DATA, "state.json")   # small persisted app state (recent files, …)
_SNAP_FILE = os.path.join(APP_DATA, "launch_snapshot.jpg")   # the last view of the launch document — a FILE, not a field in state.json, which save_scroll rewrites on every scroll and would otherwise carry a few hundred kB of base64 each time
_MAX_RECENT = 10
_WATCH_POLL = 1.5   # seconds between stat()s of the open document — see Api._watch_loop for why this polls at all

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"
IS_LINUX = sys.platform.startswith("linux")

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


def _english_glosses(pairs) -> list | None:
    """``[[Gloss, MGloss], …]`` from the frontend → one English gloss per token, or None.

    The DECISION lives in `app.glosses`, not here and not in JS: the fitting path asks the same
    question of a CoNLL-U file's MISC and must get the same answer, or a custom model's row is
    fitted under one lexical-channel regime and parsed under another — the mismatch that module's
    own note is about.  This is only the shape adapter for what the bridge happens to send.
    Answers None for "nothing to say", so a document with no glossing at all costs the parse path
    nothing at all.
    """
    if not pairs:
        return None
    out = []
    for pair in pairs:
        if isinstance(pair, (list, tuple)):
            out.append(glosses.english_gloss(*(list(pair) + ["", ""])[:2]))
        else:
            out.append(glosses.english_gloss(str(pair or ""), ""))
    return out if any(out) else None


class Api:
    def __init__(self):
        self.window: Any = None
        self._path: str | None = None   # current document path (for Save)
        self.dirty = False
        # ── the open file, watched on disk (see _watch_loop) ────────────────────────────────────
        # The signature of the current path as THIS window last READ or WROTE it. Anything else on
        # disk is somebody else's write, and the frontend is told so. None = nothing to compare
        # against (no path, or the file does not exist yet).
        self._watch_sig: tuple[int, int] | None = None
        self._watch_thread: threading.Thread | None = None
        self._closed = False           # set from the window's `closed` handler → the watcher below stops with the window
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
        the document that's now current (whichever of open/save-as/rename/adopt set it) — and
        re-baselines the on-disk watch onto the file this window is now looking at."""
        self._path = value
        self._rearm_watch()
        self._notify_recent_changed()

    # ── the open file, watched on disk (see _watch_loop for the whole account) ───────────────
    @staticmethod
    def _file_sig(path: str) -> tuple[int, int] | None:
        """What "this file, as we last saw it" means: modification time and size. ``st_mtime_ns``
        rather than ``st_mtime`` because a float mtime is rounded on some filesystems and two writes
        inside one second are exactly the case this has to catch; size beside it because a write that
        lands in the same nanosecond bucket almost always changes the length. A content hash was the
        alternative and is not worth it — this polls every open document forever, and re-reading a
        20 MB treebank a second to answer a question stat() already answers is a real cost for a
        false-positive rate no user would ever notice."""
        try:
            st = os.stat(path)
        except OSError:      # missing, unreadable, mid-atomic-replace — see _watch_loop
            return None
        return (st.st_mtime_ns, st.st_size)

    def _rearm_watch(self) -> None:
        """Adopt what is on disk NOW as ours. Called wherever this window reads the file or writes
        it — the path setter, get_state, save/save_as/save_to/rename_to, reload — so the app's own
        writes can never be reported back to it as somebody else's."""
        p = self._path
        self._watch_sig = self._file_sig(p) if p else None
        if p and self._watch_thread is None and not self._closed:
            self._watch_thread = threading.Thread(
                target=self._watch_loop, name="doc-watch", daemon=True)
            self._watch_thread.start()

    def _watch_loop(self) -> None:
        """Poll the open document's own path and tell the frontend when someone else writes it.

        ⚠ POLLING, NOT A FILESYSTEM EVENT API, deliberately. The three platforms offer three
        different ones (FSEvents/kqueue, ReadDirectoryChangesW, inotify), none of them in the
        standard library, and this app already takes the same view for the Windows accent/theme
        watcher — a 2 s registry poll. One stat() every 1.5 s against ONE path is far below the
        noise floor of anything else this process does, and it is the same code on every platform.

        ⚠ A SIGNATURE OF None IS NOT AN EVENT. An editor that saves by atomic replace (write a
        temporary file, rename it over the target) leaves a window of a few milliseconds in which
        the path does not resolve — announcing a "change" there would fire on a vanished file the
        frontend cannot reload. The rename lands a moment later with a genuinely new signature and
        is reported then; a file the user really did delete simply stops being watched, which is the
        honest answer for a change this app cannot act on either way.

        ⚠ AND THE NEW SIGNATURE IS ADOPTED AS WE ANNOUNCE IT, so one external write is announced
        ONCE. Without that the next tick would see the same difference and put the warning up again
        every 1.5 s behind whatever the user was reading. If they choose Reload, the read re-arms on
        the same value and nothing further is said; if they choose to keep their own version, the
        next save re-arms it too.

        ⚠ `evaluate_js` FROM THIS THREAD IS THE SUPPORTED SHAPE and the AppKit main thread is not:
        it does callAfter + semaphore.acquire, so calling it from a main-thread callback would park
        the very run loop that has to service it (see _dialog_lock's own note). A daemon thread of
        our own is what Open Recent already uses for the same reason."""
        while not self._closed:
            time.sleep(_WATCH_POLL)
            try:
                p, base = self._path, self._watch_sig
                if not p or base is None:
                    continue
                sig = self._file_sig(p)
                if sig is None or sig == base:
                    continue
                self._watch_sig = sig
                win = self.window
                if win is not None:
                    self._eval_quiet(win, "window.__fileChangedOnDisk && window.__fileChangedOnDisk()")
            except Exception:  # noqa: BLE001 — a watcher must never take the window down with it
                pass

    def reload(self) -> dict:
        """Re-read the CURRENT path — the file changed under us and the frontend is taking the
        disk's version. Deliberately NOT ``open_path``: that one is the Open Recent command and
        pushes the file onto the recent list, which is not what re-reading the document already open
        means. Re-arms the watch on what it just read, so the reload is not itself announced."""
        p = self._path
        if not p:
            return {"error": "No file"}
        try:
            sentences = io_conllu.read_file(p)
        except Exception as exc:  # noqa: BLE001 — a half-written file is the likeliest failure here
            return {"error": str(exc)}
        self.format = detect.detect_format(sentences)
        self.dirty = False
        self._rearm_watch()
        return {"sentences": sentences, "path": p,
                "name": os.path.basename(p), "format": self.format}

    def set_window(self, window):
        self.window = window

    def _modal_dialog(self, *args, window=None, **kwargs):
        """Serialise native file dialogs behind _dialog_lock so two overlapping
        bridge calls can't race on pywebview's shared _file_name/semaphore (the
        intermittent open-file hang).

        Always runs on a JS-bridge thread (every caller is a bridge method), never on
        the AppKit main thread — see the _dialog_lock invariant in __init__. On a bridge
        thread create_file_dialog does callAfter(create_dialog) + semaphore.acquire(),
        which the main run loop is free to service, so the modal always opens.

        ``window`` presents the sheet on a CHILD window instead of the document one — for a dialog
        opened from the Model Manager, where a sheet dropping out of the window behind it reads as
        the app having hung. It falls back to the document window when the child is not there (the
        in-page-sheet path), so no caller has to test for it. The lock is the same one either way:
        pywebview's ``_file_name``/semaphore are process-wide, not per window, which is the whole
        reason this method exists."""
        with self._dialog_lock:
            return (window or self.window).create_file_dialog(*args, **kwargs)

    def get_state(self) -> dict:
        """Initial state for the frontend on load.  ``sentences`` is None when
        there is no document to preload (fresh start → the frontend can keep its
        own sample document for design/browser use)."""
        sentences = None
        if self.path and os.path.exists(self.path):
            sentences = io_conllu.read_file(self.path)
            self.format = detect.detect_format(sentences)
            self._rearm_watch()   # …and THIS is the version the window is showing, so a later write by anyone else is somebody else's
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
        self._closed = True   # …and the on-disk watcher stops with the window: it outlives nothing, and a session that opens and closes many windows would otherwise keep a polling thread per window it no longer has
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
        self._rearm_watch()   # our own write, not somebody else's — the path did not change, so the setter's re-arm never ran
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

        macOS and Linux only in effect: ``self._menu`` is the title → native-menu-item map each
        platform's own shell fills in (``app/mac/shell.py``'s NSMenuItem wiring, ``app/linux/
        shell.py``'s Gtk.MenuItem wiring) — on Windows there is nothing here to drive and the call
        returns early, because the in-window menu bar applies the very same state itself, from the
        very same table (see ``menu_spec.visibility``), so the state never has to cross the bridge
        to reach it."""
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
        tell (Windows, Linux, no NSWindow yet, a PyObjC hiccup): the single-window case must never
        be able to talk itself out of applying its own state.

        Only meaningful on macOS — see ``_apply_menu``'s own note on why Linux never calls this at
        all."""
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
        """Push one selection-state report onto the live native menu items — ``NSMenuItem`` on
        macOS, ``Gtk.MenuItem``/``Gtk.CheckMenuItem`` on Linux (the Windows in-window bar applies
        the same state itself; see ``sync_menu``'s own docstring).

        The RULES are no longer written here — ``menu_spec.visibility`` resolves them, and
        ``menu_spec.CHECK_KEYS`` names the checkmarks, so every native menu applies the identical
        predicates rather than a hand-copied restatement of them.  What stays is the per-platform
        widget call: AppKit hides a row, GTK disables it (`Gio.Menu`/`Gtk.MenuItem` can't cleanly
        hide an individual row at runtime the way AppKit can — "disable, don't hide" is normal GTK
        convention, not a workaround).

        ONE MENU BAR, SEVERAL WINDOWS (macOS only): every window's frontend pushes its own selection
        state (a render, a click, a Tab), and there is a single NSMenu for ALL of them — so a
        BACKGROUND window's push would hide or show rows according to a selection the user cannot
        see. Only the key window may write there. Nothing is lost by the others returning early:
        each caches its state in ``_last_menu_state`` (see the wrapper in mac/shell.py) and the menu
        delegate re-applies whichever window is key at the moment a menu opens — which is also why
        that delegate passes ``force``: it has already resolved the key window and must not be
        second-guessed here. LINUX HAS NO SUCH SHARING TO GUARD AGAINST — ``app/linux/shell.py``
        builds one real ``Gtk.MenuBar`` PER WINDOW (attached to that window's own
        ``Gtk.ApplicationWindow``), so ``self._menu`` there is already scoped to the one window
        asking; gating it on key-window status would be solving a problem Linux doesn't have."""
        if IS_MAC and not force and not self.is_key_window():
            return
        m = self._menu or {}
        rtl = bool(st.get("rtl"))
        for title, show in menu_spec.visibility(st).items():
            it = m.get(title)
            if it is not None:
                try:
                    if IS_LINUX:
                        it.set_sensitive(show)
                    else:
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
                    if IS_LINUX:
                        it.set_active(bool(st.get(key)))
                    else:
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
        open, so "C:\\" would be a lie for a file on D:.  Linux gets the generic "Computer" — there
        is no one universal Linux equivalent of "Macintosh HD" (it varies by distro/file manager),
        and a made-up specific name would be a bigger lie than a deliberately generic one."""
        root = "This PC" if IS_WIN else "Macintosh HD" if IS_MAC else "Computer"
        return {"sep": "\\" if IS_WIN else "/", "rootName": root}

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

    # options_bar_state USED TO LIVE HERE and is gone with the cross-window broadcast it drove: the
    # options bar was app-wide by design (opening it in one window opened it in every other one) until
    # a report asked for the opposite ("enabling the options bar in one window should not enable it in
    # others") — each window's viewbar visibility is now purely its own local UI state
    # (js/ui/wiring.js's toggleOptionsBar, which no longer calls back here). `self._broadcast`
    # (app/__main__.py) is general app-wide-UI-state plumbing, not specific to this feature, and stays
    # in place for whatever else may want it.

    # ⚠ `titlebar_reserve` USED TO LIVE HERE and is gone with the geometry it served — it handed the
    # options bar's measured height to app.mac.shell.set_titlebar_reserve, which parked an empty
    # accessory of that height in the native title-bar band so AppKit would stack the (then-existing)
    # window-tab bar UNDER it. `new_tab`/``_new_tab`` are gone for the same underlying reason, one
    # remove later: this app no longer offers macOS window tabbing at all (see the module-level note
    # near the top of app/__main__.py), so there is neither a tab bar to reconcile the options bar
    # with nor a second document window that could open AS a tab of this one. Every document window is
    # what `new_window` below already gives: an ordinary window, sharing this process's Dock icon and
    # menu bar. This note is here so a reader of the bridge surface finds out why rather than wondering.

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
    # ⚠ EVERY PARSE ENDPOINT TAKES ``arms``, AND EVERY ONE DEFAULTS IT TO None.  It is the options
    # bar's Pipeline drawer — the list of arms the reader has left switched on — and ``None`` means
    # "all of them", so an older frontend, a headless caller or a test that says nothing behaves
    # exactly as it did before the drawer existed.  See `parse.ARMS` for what the eight are and for
    # why only two of them skip a component.  The frontend sends the list on every call rather than
    # setting it once: it is per-window state a reader can change between two parses, and a
    # server-side "current arms" would be one more thing that can drift out of step with the ticks
    # they can see.
    def parse_text(self, text: str, model_id: str = "", arms=None) -> dict:
        """Tokenise ``text`` (+ parse if a model is given).  Returns tokens plus any
        multi-word tokens (``mwt``); falls back to whitespace tokenisation with a
        ``reason`` when the requested model/engine can't run."""
        return parse.parse(text, model_id, arms)

    def parse_texts(self, texts: list, model_id: str = "", arms=None) -> dict:
        """`parse_text` over a LIST, in one bridge call — what a multi-sentence paste needs.

        Inserting a pasted passage used to cost two awaited round-trips per sentence (tokenize, then
        parse_text), so an 80-sentence paste made 160 of them, each re-entering the pipeline for one
        string. `parse.parse_many` resolves the model once and lets the engine batch: spaCy through
        `nlp.pipe`, and Stanza with a SINGLE grew UD→SUD conversion across the whole list, which its
        worker pool then runs in parallel. Entries come back in the order given, each in exactly
        `parse_text`'s shape (including a per-entry `reason` when the engine could not run)."""
        return {"results": parse.parse_many(list(texts or []), model_id, arms)}

    def parse_tokens(self, forms: list[str], model_id: str = "",
                     upos: list[str] | None = None, arms=None, given=None,
                     glosses: list | None = None,
                     prior_feats: list[str] | None = None) -> dict:
        """Re-parse a sentence whose TOKENISATION IS FIXED — one token per entry of ``forms``.

        What the frontend needs after a Form or UPOS edit, where the heads, relations and annotation
        tiers hang off the existing tokens and an answer with a different token count is unusable.
        Asking `parse_text(" ".join(forms))` instead silently produced exactly that in any spaceless
        script — see `parse.parse_pretokenized`, which explains the failure it removes.

        ``upos`` carries the reader's OWN word classes, so a retag re-derives the features for the class
        that was chosen instead of returning the model's unchanged opinion of the same sentence — see
        `parse._force_upos`.

        ``given`` — ``{arm: [column values]}`` — carries the columns the reader has taken over by
        switching the arm off, so every component that READS one reads theirs. Measured worth on ten
        held-out Basque sentences: supplying FEATS alongside UPOS moves LAS 38.32 → 53.27. See
        `parse._GIVEN_SETTER`.

        ``glosses`` carries the two GLOSSING TIERS, raw and per token — ``[[Gloss, MGloss], …]`` — for
        the lexical channel `xx_sud_generic` 0.2.0 added: one aligned vector per token, filled from an
        English gloss where the reader has written one.  The frontend sends the tier values rather
        than a chosen gloss because `app.glosses` is the ONE place that decides between them (prefer
        MGloss's lexical part, strip the Leipzig abbreviations and the morpheme separators), and the
        custom-model FITTING path — which reads the same two tiers out of a training file's MISC,
        where the frontend is not involved at all — has to reach the same answer or the row is fitted
        under one regime and deployed under another.  Ignored by every other model: nothing but that
        wheel registers the extension the values go on.

        ``prior_feats`` carries the FEATS column as it stands, one string per form, and is what makes
        that column ADDITIVE under the generic wheel: a generic or custom model may add a feature to a
        token and may never change or drop one the annotator has. Sent on every pre-tokenised call and
        binding only for that one package — `parse._feats_additive` is where which-models is decided,
        and its note is where the two reasons are. Distinct from ``given["feats"]``, which says the arm
        is OFF and takes the morphologiser out of the run entirely."""
        return parse.parse_pretokenized(forms or [], model_id, upos or None, arms, given,
                                        _english_glosses(glosses), prior_feats or None)

    def model_feats_inventory(self, model_id: str = "") -> dict:
        """``{FeatName: [values...]}`` the given model's own morphologizer can jointly emit — see
        `parse.model_feats_inventory`. The FEATS-value and glossing-abbreviation context menus
        intersect this with the UD-wide reference table and the document's own attested values, so a
        menu never offers a value neither the document nor the active parser has ever produced."""
        return parse.model_feats_inventory(model_id or "")

    def model_feats_by_upos(self, model_id: str = "") -> dict:
        """`model_feats_inventory`, split by word class — see `parse.model_feats_by_upos`.

        What the AVM tier's "add a feature" pickers narrow against: a class the model never emits a
        given feature alongside does not offer it, so a PUNCT is not offered Tense because some verb
        in the document has one."""
        return parse.model_feats_by_upos(model_id or "")

    def token_scores(self, forms: list[str], model_id: str = "",
                     upos: list[str] | None = None, glosses: list | None = None) -> dict:
        """The pipeline's RUNNERS-UP for one sentence — what it ranked second, and by how much.

        Every component scores a whole inventory and the editor has only ever shown the argmax.  This
        hands back the rest: per token, the candidate heads the parser weighed against each other, the
        relation it would use for each of those arcs, and the morphologizer's distribution over word
        classes.  See `parse.analysis_scores` for how a head distribution is recovered from a
        transition-based parser at all, and why Stanza answers ``scored: False``."""
        return parse.analysis_scores(forms or [], model_id, upos or None,
                                     _english_glosses(glosses))

    def arc_scores(self, forms: list[str], model_id: str, child: int, head: int,
                   upos: list[str] | None = None, glosses: list | None = None) -> dict:
        """"If ``child`` hung off ``head``, what would you call that edge?" (both 1-based).

        The counterfactual companion to `token_scores`, for the arc a reader has just made by hand and
        the parser never considered — so there is no recorded deliberation to read.  See
        `parse.arc_label_scores`, which states plainly what a synthesised state can and cannot claim.

        ``glosses`` travels with both scoring calls for the same reason it travels with `parse_tokens`:
        it is an INPUT to the parse being ranked, so a ranking computed without it describes a
        different parse than the one the reader can run. Both caches key on it — see
        `parse.analysis_scores`, and `scoresKey` in js/io/scores.js for the frontend's own half."""
        return parse.arc_label_scores(forms or [], model_id, int(child), int(head), upos or None,
                                      _english_glosses(glosses))

    def tokenize(self, text: str, model_id: str = "", arms=None) -> dict:
        """FAST first step of the interactive parse sequence (tokenise → transliterate → parse):
        tokenise ONLY, so the tokens and their transliterations paint before the heavy parse. The
        follow-up step is the ordinary ``parse_text`` on the same text (which reproduces exactly
        these tokens). Returns ``{"tokens","mwt","parsed":False,…}``."""
        return parse.tokenize(text, model_id, arms)

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

    def sentencize(self, text: str, lang: str = "", model_id: str = "", arms=None) -> dict:
        """Split pasted text into sentences for the "Insert text" flow (item 24).  Uses the
        selected spaCy model's sentence segmentation when one is loaded, else a script-aware
        rule-based splitter (Latin .?!… + Indic daṇḍa ।॥).  Returns ``{"sentences": [...]}``."""
        return {"sentences": parse.sentencize(text or "", lang or "", model_id or "", arms)}

    def model_arms(self, model_id: str = "") -> dict:
        """Which pipeline arms this model implements, and which of them read which others.

        Asked per model rather than derived in the frontend, because both answers are read off the
        loaded pipeline itself (`parse.model_arms`, `parse.arm_deps`): a wheel that gains or loses a
        component says so here without a table anywhere needing to be edited to match.

        ``deps`` is ``{arm: [arms it reads]}`` — the cascade, read off each component's own declared
        input features (`parse.arm_deps`), never off pipeline order. The options bar uses it to show an
        arm as inert when something it reads has been switched off, and `parse._pipe_plan` applies the
        same graph to the answer, so what the drawer shows and what the parse does cannot drift.
        It is model-specific and that is the point: `xx_sud_generic`'s morphologiser embeds the word
        class and its parser embeds both class and features, where `en_sud_ewt_gum`'s parser embeds
        only NORM/PREFIX/SUFFIX/SHAPE and reads neither."""
        mid = model_id or ""
        out = {"arms": parse.model_arms(mid), "all": list(parse.ARMS), "deps": {},
               # …and whether the word classes are this model's INPUT rather than something it
               # simply cannot do. The options bar shows the two differently: a missing component is
               # a feature the model has not got, where this is a request for the annotator.
               "reads_upos": parse._needs_given_upos(mid),
               # …and whether it reads the GLOSSES the annotator wrote (0.2.0's lexical channel).
               # The drawer greys its own Glossing arm on this: a gloss the app generated, handed
               # back to a parser that reads glosses, is the app quoting itself as evidence.
               "reads_glosses": parse.reads_glosses(mid)}
        try:
            engine, name, tb_lang = parse._resolve_model(mid)
            if engine == "sud" and name:
                out["deps"] = parse.arm_deps(parse._load_spacy(name))
        except Exception:  # noqa: BLE001 — no deps is "nothing cascades", which greys nothing
            pass
        return out

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

    def font_face_raw(self, family: str, weight: int = 400) -> dict:
        """item 25: the SAME face, but the RAW .ttf js/lang/smp-shape.js's vendored HarfBuzz build
        needs — see fonts.fetch_raw's own note for why this can't just reuse font_face's woff2.
        `weight` (item 28): threaded straight through to fonts.fetch_raw — a non-core family that
        Google Fonts serves as several STATIC per-weight files (not one variable one) needs the
        RIGHT weight's file fetched in the first place; see that function's own note."""
        from . import fonts
        return fonts.fetch_raw(family, weight)

    def fonts_installed(self) -> dict:
        from . import fonts
        return {"fonts": fonts.installed()}

    def fonts_clear(self) -> dict:
        from . import fonts
        return fonts.clear()

    def transliterate(self, forms: list[str], lang: str, scheme: str = "",
                      upos: list[str] | None = None, feats: list[str] | None = None,
                      lemmas: list[str] | None = None) -> dict:
        """``upos`` is OPTIONAL and PARALLEL to ``forms`` — the CoNLL-U tag each form was seen under, so a
        heteronym is romanised as the part of speech it actually is (行 = háng as a NOUN, xíng as a VERB).
        The frontend keys its own de-duplication on (form, upos) for the same reason — one entry per
        distinct SURFACE would let whichever 行 was reached first decide the reading for all of them; a
        batch that names no tags at all is the call this endpoint has always taken.

        ``feats``/``lemmas`` are the same shape, parallel to ``forms``, and reach Arabic/Persian only:
        the romanisation is now always built from the VOCALISED form (`translit._legacy`), and these are
        what `vocalise.vocalise` disambiguates that lookup with — Arabic's final case-ending vowel
        (FEATS) and Persian's lemma-transfer (LEMMA). Omitted ⇒ the same call this endpoint has always
        taken, still vocalised at whatever the form-only lookup level gives it."""
        from . import translit
        return {"translit": translit.transliterate_many(forms, lang, scheme, upos, feats, lemmas),
                "lang": lang, "scheme": scheme}

    def mandarin_bu_tone(self, next_forms: list[str], scheme: str = "") -> dict:
        """不's OWN tone-sandhi correction (4th tone → 2nd before a following 4th-tone syllable), for a
        standalone 不 token whose neighbour is a SEPARATE CoNLL-U token and so never reaches
        `translit._mandarin_syllables` in the same call as its own rendering. ``next_forms[i]`` is the
        FORM of the token immediately after the i-th 不 (parallel list; "" ⇒ nothing follows it).
        ``scheme`` is one of the three Mandarin schemes numbered-pinyin syllables drive (Hanyu Pinyin/
        Zhuyin Fuhao/Gwoyeu Romatzyh — "" defaults to pinyin); every other scheme has no such rule.
        Language-agnostic on purpose — see `translit.mandarin_bu_tone`'s own note — so the SAME call
        corrects the negator whether the document is `zh` or `lzh`."""
        from . import translit
        return {"translit": translit.mandarin_bu_tone_many(next_forms, scheme or "pinyin")}

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
        records it. "" means Latin, which is also the answer for every non-Sanskrit language,
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

        ``feats``/``lemmas`` are parallel too, and exist for Latin macronisation and Arabic/Persian
        vocalisation, both of which need the whole morphological analysis rather than just the class:
        Latin's lookup is keyed on (form, upos, feats), and the lemma's ending supplies the declension
        wherever FEATS carries no ``InflClass`` — sending the form alone reaches only the
        morphology-blind level of the table, which is how nominative ``Gallia`` acquires an ablative
        macron. Arabic's is keyed on (form, upos, feats) the same way, FEATS supplying the case ending
        that is usually the very vowel being restored; Persian's is keyed on (form, lemma, upos), the
        lemma extending a lexicon hit over an inflected form. Every other language ignores all three."""
        from . import translit
        return {"ortho": translit.orthography_many(forms, lang, scheme, upos, feats, lemmas),
                "lang": lang, "scheme": scheme}

    def sanskrit_mwt(self, groups: list[list[str]], lang: str, scheme: str = "",
                     lemma_groups: list[list[str]] | None = None, word_sep: str = "",
                     prevs: list[str] | None = None, nexts: list[str] | None = None,
                     pauses: list[bool] | None = None,
                     bounds: list[list[bool]] | None = None) -> dict:
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
        # ``prevs``/``nexts`` are the neighbouring ORTHOGRAPHIC words, one per group — what lets the
        # fusion finish the range's outer edges by non-coalescent external sandhi instead of leaving
        # them in pausa (see translit._boundary_sandhi). Absent ⇒ "", i.e. exactly the old behaviour,
        # so an older caller and the running-line path are unaffected.
        pv, nx, pz = prevs or [], nexts or [], pauses or []
        # ``bounds`` (parallel to ``groups``, one flag per COMPONENT) marks the bound compound members —
        # FEATS Compound=Yes — so a junction inside a compound is fused as compound-INTERNAL rather than
        # as one between two words. Absent ⇒ every junction external, i.e. exactly the old behaviour.
        bd = bounds or []
        form = [translit.sandhi_join(g, lang, lg[i] if i < len(lg) else None, word_sep,
                                     pv[i] if i < len(pv) else "", nx[i] if i < len(nx) else "",
                                     bool(pz[i]) if i < len(pz) else False,
                                     bd[i] if i < len(bd) else None)
                for i, g in enumerate(groups)]
        ortho = [translit.sandhi_to_script(g, lang, scheme, lg[i] if i < len(lg) else None, word_sep,
                                           pv[i] if i < len(pv) else "", nx[i] if i < len(nx) else "",
                                           bool(pz[i]) if i < len(pz) else False,
                                           bd[i] if i < len(bd) else None)
                 for i, g in enumerate(groups)]
        return {"ortho": ortho, "form": form, "lang": lang, "scheme": scheme}

    def sanskrit_desandhi(self, form: str, lang: str = "", lemma: str = "",
                          nxt_word: str = "", pause_after: bool = False, upos: str = "") -> dict:
        """The pausa spelling of ``form`` — its non-coalescent external sandhi with ``nxt_word`` undone.

        The mirror image of ``sanskrit_mwt``, and wanted at the opposite moment: that one FUSES a range's
        components into the orthographic word a running text spells, this one gives back the citation form
        one of those components has to be STORED as.  A token that is its own orthographic word keeps its
        sandhied surface in FORM, but a token inside a multi-word token is stored in pausa — so splitting
        one into a range has to hand the LAST component the ending the following word had imposed on it
        (`janmanāṃ` → `janmanām`, `bhṛto` → `bhṛtaḥ`).  Only the last: the interior junctions are
        compound-internal, and the left edge's sandhi is written on the word before this one.

        ``upos`` decides WHICH form that is, and the two answers are different: DCS records an
        INDECLINABLE's pausa column as its citation form (tato → tatas, punar → punar) and an INFLECTED
        word's as its pausa spelling (kratuś → kratuḥ, bastir → bastiḥ).  Both are visible in
        samples/brihat_jataka.conllu, which is where the rule came from.

        Declines rather than guesses — see translit.desandhi_final, which verifies every candidate against
        the forward transform and returns the form untouched where the reversal is ambiguous.  Measured on
        both Sanskrit samples: reverting the ending and re-fusing it reproduces the original surface for
        68 of 68 ranges, 28 of which it actually changes."""
        from . import translit
        return {"form": translit.desandhi_final(form or "", lang or "sa", lemma or None,
                                                nxt_word or "", bool(pause_after), upos or "")}

    def sanskrit_csl(self, sents: list[dict]) -> dict:
        """Each sentence's tokens spelt in Clay-Sanskrit-Library notation → ``{"csl": [[…], …]}``.

        A SENTENCE at a time, unlike every other transliteration call, because a CSL mark records
        what happened BETWEEN two words: ``vartmā`` is only ``vartm"`` because ``apunar`` follows it,
        so no per-form batch can answer it. Each entry is
        ``{forms, unsandhied, feats, lemmas, mwt}`` — see :mod:`app.sa_notation` for why the pausa
        forms rather than the stored ones are the input, and what the lemma is read for."""
        from . import sa_notation
        return {"csl": sa_notation.csl_many(sents or [])}

    def gloss_from_translation(self, sents: list, lang: str = "", src_format: str = "",
                               trans_lang: str = "en") -> dict:
        """Each sentence's English translation aligned to its own tree → the per-token gloss picks.

        ``{"gloss": [{"pairs": [{src, en, form, lemma, upos, score}, …], "sents", "error"}, …]}``
        — one entry per input sentence, parallel and the same length, holding only the tokens that
        matched.  The frontend writes the matched FORM into MISC ``Gloss`` and the matched LEMMA into
        ``MGloss``'s lexical part; a source token absent from ``pairs`` simply keeps no gloss, which is
        the honest answer and a common one (English has articles most languages do not, and vice versa).

        A SENTENCE at a time, like :meth:`sanskrit_csl` and unlike the per-form transliteration calls,
        because the question is about a TREE — the same surface word glosses differently depending on
        what it is attached to, which is the whole content of :mod:`app.gloss_align`.

        ``src_format`` defaults to this window's own detected format, so the caller need not repeat it;
        it decides only whether the document goes through ``sud_to_ud`` or ``msud_to_ud``.

        ⚠ The UD conversion is optional equipment on a fresh install (grew's OCaml backend and the
        fetched ``.grs`` grammars), so ``unavailable`` is an ORDINARY outcome here rather than an error
        condition — the frontend turns it into one toast naming Manage Models and stops asking.  Same
        two-clause handler as :meth:`convert_format`."""
        from . import convert, gloss_align
        try:
            out = gloss_align.gloss_from_translation(list(sents or []), str(lang or ""),
                                                     str(src_format or self.format or "SUD"),
                                                     str(trans_lang or "en"))
        except convert.ConversionUnavailable as exc:
            return {"gloss": [], "error": str(exc), "unavailable": True}
        except convert.ConversionError as exc:
            return {"gloss": [], "error": f"conversion failed: {exc}"}
        except Exception as exc:  # noqa: BLE001 — failure is data over this bridge, never an exception
            return {"gloss": [], "error": str(exc)}
        return {"gloss": out}

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
        from . import apte, wiktionary
        # SANSKRIT IS APTE'S, FIRST AND UNCONDITIONALLY. Apte's 1957 revised edition is a scholarly
        # dictionary of the classical language, vendored, offline, and indexed in SLP1 against the
        # spellings this app stores — by user decision, it always wins for Sanskrit.
        if apte.is_sanskrit(language):
            return apte.lookup(word, language, upos)
        r = wiktionary.lookup(word, language, upos)
        r.setdefault("source", "Wiktionary")
        r.setdefault("page_label", "Open on Wiktionary")
        return r

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

    # ── custom models (instances of the generic parser) ───────────────────────
    def custom_model_status(self) -> dict:
        """What the Add-custom-model sheet needs before it can offer anything: whether the generic
        wheel is here, the 80 languages whose embedding row is already fitted, the sentence floor
        and the held-out figures a model with no training file falls back to."""
        from . import generic_models
        st = generic_models.status()
        if not st["installed"]:
            # The download size, so the sheet can say what a first custom model actually costs
            # rather than starting a 31 MB fetch with no warning. Cache-only: this runs while a
            # sheet is opening, and a cold/offline release listing must not park it behind an HTTP
            # timeout (see models_registry.CACHE_ONLY, which exists for the same reason).
            try:
                for e in models_registry.list_available(models_registry.CACHE_ONLY):
                    if e.get("id") == st["model_id"]:
                        st["size"] = e.get("size")
                        st["version"] = e.get("version")
                        break
            except Exception:  # noqa: BLE001 — a size is decoration; the offer stands without it
                pass
        return st

    def create_custom_model(self, name: str, lang: str = "", conllu: str = "") -> dict:
        """Start making one custom model in the background; returns a ``job_id`` to poll with
        model_job_status, exactly as ``download_model`` does.

        ⚠ IT MAY HAVE TO DOWNLOAD A 31 MB WHEEL FIRST, and that is ONE job rather than two: from the
        reader's side "make me a Wolof parser" is a single act, and splitting it would put a second
        progress bar in front of them for a dependency they did not ask about. The fetch takes the
        first 40 % of the bar and the fit the rest.

        Serialised behind ``_pip_lock`` like every other install: the download half genuinely is a
        pip install, and the fit half loads an 8 s model — two of those at once would double the
        memory for no gain."""
        from . import generic_models
        self._job_seq += 1
        job_id = f"job{self._job_seq}"
        self._jobs[job_id] = {"pct": 0, "note": "Starting…", "done": False, "error": None,
                              "id": f"custom:{name}"}

        def worker():
            def progress(pct, note):
                job = self._jobs.get(job_id)
                if job is not None:
                    if pct is not None:
                        job["pct"] = pct
                    job["note"] = note

            with self._pip_lock:
                result: dict = {}
                # THE BAR IS SPLIT ONLY WHEN THERE ARE TWO THINGS TO DO. On the second and every later
                # custom model the wheel is already here, and a bar that starts at 40 % says a step ran
                # that did not.
                need = not generic_models.installed()
                base, span = (40, 60) if need else (0, 100)
                if need:
                    def dl(pct, note):
                        progress(int((pct or 0) * 0.4), note or "Downloading the generic parser…")
                    result = models_registry.download(generic_models.GENERIC_MODEL_ID, progress=dl)
                    if result.get("error"):
                        result = {"error": "the generic parser could not be installed: "
                                           + str(result["error"])}
                if not result.get("error"):
                    def fit(pct, note):
                        progress(base + int((pct or 0) * span / 100), note)
                    result = generic_models.create(name, lang, conllu, progress=fit)
            job = self._jobs.get(job_id)
            if job is not None:
                job["done"] = True
                if result.get("error"):
                    job["error"] = result["error"]
                else:
                    job["pct"] = 100
                    job["note"] = "Ready"
                    job["entry"] = result.get("entry")
                    job["model"] = result.get("id")

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id}

    def update_custom_model(self, slug: str, name: str = "", lang: str = "",
                            conllu: str = "") -> dict:
        """Edit one custom model in the background; returns a ``job_id`` like create_custom_model.

        ⚠ THE SHEET SENDS ALL THREE FIELDS EVERY TIME, which is why they are plain strings here where
        `generic_models.update` distinguishes None (unchanged) from "" (cleared). It always knows the
        whole intended state — it was pre-filled with the current one — so "" from the sheet genuinely
        means the reader emptied that field.

        A rename is instant: the row is re-fitted only where the evidence it was fitted FROM has
        moved, which is a different file or the same file with a different mtime or size."""
        from . import generic_models
        self._job_seq += 1
        job_id = f"job{self._job_seq}"
        self._jobs[job_id] = {"pct": 0, "note": "Starting…", "done": False, "error": None,
                              "id": f"custom:{slug}"}

        def worker():
            def progress(pct, note):
                job = self._jobs.get(job_id)
                if job is not None:
                    if pct is not None:
                        job["pct"] = pct
                    job["note"] = note

            with self._pip_lock:
                result = generic_models.update(slug, name, lang, conllu, progress=progress)
            job = self._jobs.get(job_id)
            if job is not None:
                job["done"] = True
                if result.get("error"):
                    job["error"] = result["error"]
                else:
                    job["pct"] = 100
                    job["note"] = "Saved"
                    job["entry"] = result.get("entry")
                    job["model"] = result.get("id")

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id}

    def pick_conllu_file(self) -> dict:
        """Native open dialog for the custom model's training file — no reading, just the path.

        Presented on the MODEL MANAGER's own window where there is one, not on the document window
        behind it: a modal sheet that drops out of a window the reader is not looking at reads as the
        app having hung. Falls back to the main window (the in-page sheet path, where the Model
        Manager is not a separate window at all)."""
        result = self._modal_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            file_types=("CoNLL U treebank (*.conllu;*.conll)", "All files (*.*)"),
            window=self._child_windows.get("models"),
        )
        if not result:
            return {"cancelled": True}
        path = result[0]
        return {"path": path, "name": os.path.basename(path)}

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
                    self._notify_extra_installed(feature)

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id}

    def _notify_extra_installed(self, feature: str) -> None:
        """A TIER THAT HAS JUST ARRIVED IS USABLE NOW, not after a relaunch.

        Nothing on THIS side caches its absence — ``extras.available`` re-probes, and the data-tier
        install already drops the parser cache — but the frontend does: each document window loads
        ``orthography_schemes(lang)``/``translit_schemes(lang)`` once per language switch and keeps
        the answer, so a scheme gated on a tier went on reading unavailable in a window that had been
        open the whole time.  That is the reported "I wasn't able to use it until a restart".

        Pushed to EVERY document window (``_broadcast_all``, not ``_broadcast``): the Model Manager
        shares the ``Api`` of the window that opened it, which is precisely the window the ordinary
        broadcast leaves out."""
        cb = getattr(self, "_broadcast_all", None)
        if cb is None:
            return
        try:
            cb("window.__extraInstalled && __extraInstalled(%s)" % json.dumps(feature))
        except Exception as exc:  # noqa: BLE001
            print(f"[extras] notify: {exc}", file=sys.stderr)

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
        # ── WHICH SCRIPT THE TYPED SANSKRIT IS STORED IN ────────────────────────────────────────
        # A Sanskrit file stores its text in ONE script (translit.sa_stored_script reads it off the
        # forms), and text typed into it has to land in that script.  Three inputs, and only one of
        # them is convertible both ways:
        #   a Brahmic script  → storable only as Devanagari, which is the script the model reads.
        #                       The script the user TYPED becomes what the reader sees, since that is
        #                       plainly the script they want the document displayed in.
        #   IAST (diacritics) → storable only as IAST.
        #   plain ASCII       → ITRANS, which `convert` turns into EITHER; never refused.
        # A mismatch is REFUSED rather than silently converted: turning a Devanagari paste into IAST
        # (or the reverse) rewrites the user's text into a notation they did not choose, and doing it
        # to a whole insert is not something a toast afterwards can undo.
        # An EMPTY document has no storage script yet, so it takes whichever the first insert brings.
        raw_main = str(m.get("text") or "")
        stored = str(payload.get("docScript") or "")          # "" ⇒ IAST; the frontend's DOCSCRIPT
        empty = bool(payload.get("docEmpty"))
        target, show_script, refusal = stored, "", ""
        if main_on and raw_main.strip() and itrans.is_sanskrit(main_lang):
            typed = itrans.detect_script(raw_main)
            if typed and typed != "IAST":                     # a Brahmic script
                if not empty and stored != "Devanagari":
                    refusal = ("This document stores its text in IAST, so " + typed + " cannot be "
                               "inserted into it. Type in ITRANS or IAST, or start a new document.")
                target, show_script = "Devanagari", typed
                # …and the text itself is transliterated INTO Devanagari here, because `convert` below
                # only ever converts ITRANS and would pass Kannada or Thai through untouched — leaving
                # storage in the typed script, which is the one thing the model cannot read.
                raw_main = itrans.to_devanagari(raw_main, typed)
            elif typed == "IAST":
                if not empty and stored == "Devanagari":
                    refusal = ("This document stores its text in Devanagari, so IAST cannot be "
                               "inserted into it. Type in ITRANS (it converts) or in a Brahmic script.")
                target = ""
            # plain ASCII (ITRANS) falls through on `target = stored`, convertible either way
        if refusal:
            return {"ok": False, "error": refusal}
        # ITRANS → the document's script BEFORE the text crosses to the main window, which is where it
        # is sentencised, tokenised and parsed: the tokeniser (and any Sanskrit model behind it) must
        # see the notation the document is stored in, and a re-conversion after tokenisation would have
        # to be applied to every token separately and could no longer see the word boundaries the
        # typist wrote.  A no-op for every non-Sanskrit document — see itrans.convert.
        main_text = itrans.convert(raw_main, main_lang or "und", target)["converted"] if main_on else ""

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
                # ⚠ THE DIALOG'S OWN CHOICE WINS, and only falls back to the registry's pick when it
                # sent none. `_model_for_language` cannot name a CUSTOM model — `best_installed_model`
                # refuses to choose between the reader's own, by design — so recomputing here would
                # quietly parse with the language's ordinary wheel after the dialog had promised
                # otherwise. It also removes the standing requirement that the two sides agree.
                model_id = str(p.get("model") or "") or self._model_for_language(lang, groups)
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
                         "model": ((str(m.get("model") or "")
                                    or self._model_for_language(main_lang, groups))
                                   if main_on else "")},
                "parallels": parallels, "adoptLang": adopt, "naive": naive,
                # The script the user TYPED IN, when that was a Brahmic one. The text itself is stored
                # as Devanagari (the only script the model reads), so this is the DISPLAY choice the
                # insert implies: somebody who pastes Kannada wants to read Kannada, not Devanagari.
                # "" for every other case, and the frontend then leaves the Script pill alone.
                "showScript": show_script,
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
    :root{--bg:#fbfbfd;--fg:#1d1d1f;--muted:#68686e;--accent:#0a84ff;--field:#fff;--good:#248a3d;
          --line:rgba(0,0,0,.14);--hover:rgba(0,0,0,.05);--head:rgba(0,0,0,.55);
          --label-secondary:rgba(0,0,0,.50);--label-quinary:rgba(0,0,0,.05)}
    @media (prefers-color-scheme:dark){:root{--bg:rgb(30,30,30);--fg:#e7e7ea;--muted:#9a9aa1;--accent:#3a9bff;--good:#30d158;
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

    _ISO_JS: str | None = None

    @classmethod
    def _iso639_js(cls) -> str:
        """The app's own vendored ISO 639-3 table, verbatim, for a page that loads no app scripts.

        The Model Manager is a self-contained ``html=`` window: nothing it contains is fetched, so a
        ``<script src>`` cannot reach ``web/iso639-3.js`` and the table has to be inlined.  Inlined
        rather than sent over the bridge as JSON — it is ~7 900 rows, and shipping the FILE means the
        name-menu here resolves a code to exactly the name the status-bar language picker resolves it
        to, Glottolog overrides included, with one table on disk and no second parse of it anywhere.
        Read once per process; a missing file leaves the menu free-text-only rather than breaking the
        window, which is the same degradation the picker itself takes."""
        if cls._ISO_JS is None:
            try:
                from .__main__ import WEB_DIR
                with open(os.path.join(WEB_DIR, "iso639-3.js"), encoding="utf-8") as fh:
                    cls._ISO_JS = fh.read()
            except Exception as exc:  # noqa: BLE001
                print(f"[models] ISO 639-3 table unavailable: {exc}", file=sys.stderr)
                cls._ISO_JS = ""
        return cls._ISO_JS

    def _models_html(self, focus: str = "") -> str:
        # `focus` is an extras tier KEY, and it is JSON-encoded into the page rather than
        # interpolated raw: it arrives from the frontend (translit.js's `needs`), and this page is
        # built by string concatenation, so a quote in it would otherwise break out of the literal.
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" + self._confirm_js()
            + "var FOCUS=" + json.dumps(str(focus or "")) + ";"
            + "</script><script>" + self._iso639_js() + "</script>"
            + "<style>" + self._base_css() + """
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
    /* "Update" button (row(), below) — a newer release than what's installed, on report ("the Install
       button should become a green Update button"). Filled, not a subtle wash like .danger above: this
       is a positive call to action (something to click), not a destructive one to keep low-key until
       deliberate — --good is the same green the status-bar valid dot already uses. */
    button.success{background:var(--good);color:#fff;border:none}
    button.success:hover{filter:brightness(1.06)}
    /* Download/Install/Update DOUBLING as its own progress bar (progressButton(), below), on report:
       "the install button should itself become a progress bar... starting out as an outlined button,
       and then filling in from left to right... this way the row won't suddenly become taller" —
       replacing a separate .prog bar that used to grow underneath the label (removed; see that CSS's
       own note). `background` (the actual fill) is set inline per progress tick, not here — inline
       always wins outright, so there is no specificity race against .success's own `background` to
       referee.
       Follow-up on report: "the button text should be white where the progress bar is filled in, and
       button-coloured where it's not — it should always be the CONTRASTING colour." One text colour
       can't do that (the fill boundary moves across the middle of the label, not around it), so a
       SECOND copy of the label is overlaid on top — white, clip-path'd to show only the LEFT pct%
       (the filled portion) — on top of the button's own ORDINARY text (recoloured via `color`, on
       the button itself, not a span: this is what the ORIGINAL "the progress-bar button is absurdly
       narrow" regression traced to — the button had NO in-flow content left to size itself against
       once BOTH copies were position:absolute spans, so it collapsed to its bare padding. The
       button's own text stays exactly as plain, in-flow content as any other button always has been;
       only the white overlay is absolutely positioned, and it never has to size anything, just paint
       over what's already there). */
    button.progress{position:relative}
    button.progress .plabel.fg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      pointer-events:none;white-space:nowrap;overflow:hidden;font:inherit;color:#fff;transition:clip-path .2s linear}
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
    /* .prog/.prog i (a separate progress bar appended under the row's label) removed on report:
       "the install button should itself become a progress bar... this way the row won't suddenly
       become taller" — that appended element was exactly what grew the row. See button.progress
       above and downloadModel/installExtra, below. */
    .foot{display:flex;justify-content:space-between;align-items:center;gap:8px}
    /* The filter row: the search takes the space, the toggle only what its label needs. `.on` is the
       PRESSED state — an accent-tinted fill rather than a second colour of its own, so it reads as the
       same control held down; aria-pressed carries the same fact for assistive tech. */
    .bar input{flex:1;min-width:0}
    .bar #instonly{flex:0 0 auto;white-space:nowrap}
    .bar #instonly.on{background:color-mix(in srgb,var(--accent) 20%,transparent);border-color:color-mix(in srgb,var(--accent) 45%,transparent);color:var(--head)}
    /* a note qualifying a whole GROUP (the Stanza group needs the grew backend to parse at all) — under
       its heading, ahead of the rows it applies to. */
    .gwarn{margin:2px 8px 6px;padding:7px 9px;border-radius:7px;font-size:11.5px;line-height:1.45;
           background:color-mix(in srgb,var(--accent-orange,#d08700) 15%,transparent)}
    /* ── CUSTOM MODELS ─────────────────────────────────────────────────────────────────────────
       The "Add custom model…" row is an ACTION dressed as a row, so it takes the row geometry whole
       and differs only in the accent ink and the leading +: it sits at the top of a list of things
       you HAVE, and it is the one line there that makes another one. */
    .row.addrow{cursor:pointer;color:var(--accent,#0a84ff)}
    .row.addrow .nm{font-weight:600;color:inherit}
    .row.addrow .plus{font-size:15px;line-height:1;width:14px;text-align:center;flex:0 0 auto}
    /* the caveat under a custom model's figures — what the UAS/LAS was actually measured on. Wrapped
       rather than ellipsised (unlike .nm above): the whole point of it is the sentence, and half a
       caveat is worse than none. */
    .mi .cav{font-size:11px;line-height:15px;color:var(--label-secondary,rgba(0,0,0,.5));white-space:normal}
    /* THE NEW-MODEL SHEET. An in-page scrim, not a second native window: it is a modal step OF this
       window (pick a name, pick a file, press Create) and a separate window would leave the reader to
       find which of two windows their answer belongs to — the same reasoning the app's own sheets
       take. z-index above the sticky group headings (2) and the drawer pops. */
    .scrim{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:20px}
    .scrim[hidden]{display:none}
    .sheet{width:min(430px,100%);max-height:100%;overflow:auto;background:var(--bg);border-radius:12px;
           border:.5px solid var(--line);box-shadow:0 12px 44px rgba(0,0,0,.28);padding:16px;display:flex;flex-direction:column;gap:11px}
    .sheet h2{margin:0;font-size:14px;font-weight:600}
    .sheet .fieldh{font-size:11px;font-weight:600;color:var(--head);margin-bottom:3px}
    .sheet .hint{font-size:11.5px;line-height:1.5;color:var(--muted)}
    .fld{position:relative}
    .fld input[type=text]{width:100%;box-sizing:border-box}
    /* the name menu — the same shape as the app's own language picker: a scrolling list of matches
       under the field, arrow-navigable, and NOT a <datalist>. A datalist would have been fewer lines
       and is wrong for two reasons: it renders differently in each of the three shells this app runs
       in, and it cannot show the CODE beside the name, which is the column that tells two similarly
       named languages apart and is the value actually being chosen. */
    .lm{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:10;max-height:190px;overflow:auto;
        background:var(--menu-bg,var(--bg));border:.5px solid var(--line);border-radius:9px;box-shadow:0 8px 26px rgba(0,0,0,.22);padding:4px}
    .lm[hidden]{display:none}
    .lm button{display:flex;width:100%;align-items:baseline;gap:8px;background:none;border:none;text-align:start;
               padding:4px 8px;border-radius:6px;font-size:12.5px;height:auto;min-width:0;color:var(--text)}
    .lm button:hover,.lm button.hi{background:var(--accent,#0a84ff);color:#fff}
    .lm .nm2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lm .cd{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums;flex:0 0 auto}
    .lm .note{padding:5px 8px;font-size:11px;color:var(--muted)}
    .filerow{display:flex;align-items:center;gap:8px}
    .filerow .fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
    .filerow .fname.none{color:var(--muted)}
    .sheet .err{font-size:11.5px;line-height:1.5;color:#ff453a}
    .sheet .acts{display:flex;justify-content:flex-end;gap:8px}
    </style></head><body>
    <div class="sub">Download and remove SUD (spaCy) and UD (Stanza) parser models, and build custom ones from the generic parser.</div>
    <div class="bar"><input id="q" type="search" placeholder="Search language…" spellcheck="false" autocomplete="off"><button class="sec sm" id="instonly" aria-pressed="false" title="Show only the models installed on this machine">Installed only</button></div>
    <div id="list">Loading…</div>
    <div class="foot">
      <button class="sec" id="refresh">Refresh</button>
      <button id="close">Close</button>
    </div>
    <div class="scrim" id="newscrim" hidden>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="newh">
        <h2 id="newh">New custom model</h2>
        <div class="hint" id="newintro"></div>
        <div>
          <div class="fieldh">Name</div>
          <div class="fld">
            <input type="text" id="newname" placeholder="A language, or any name you like" spellcheck="false" autocomplete="off" aria-autocomplete="list">
            <div class="lm" id="newlm" hidden role="listbox"></div>
          </div>
          <div class="hint" id="newlang" style="margin-top:4px"></div>
        </div>
        <div>
          <div class="fieldh">Training data <span style="font-weight:400;color:var(--muted)">— optional</span></div>
          <div class="filerow">
            <button class="sec sm" id="newpick">Choose…</button>
            <span class="fname none" id="newfile">No file</span>
            <button class="sec sm" id="newclear" hidden aria-label="Use no training file">Clear</button>
          </div>
          <div class="hint" id="newfilehint" style="margin-top:5px"></div>
        </div>
        <div class="err" id="newerr" hidden></div>
        <div class="acts">
          <button class="sec" id="newcancel">Cancel</button>
          <button id="newgo">Create</button>
        </div>
      </div>
    </div>
    <script>
    var AVAIL=[];
    var EXTRAS=[];   // optional heavy-dependency tiers (installed on demand)
    var TRAIN={};    // model id → training-set sentences, filled in by pollTrain as the sweep resolves them
    var KEEP_SCROLL=0;   // list scroll offset carried across a re-render (item 17)
    var INST_ONLY=false;   // the "Installed only" filter — a VIEW state of this window, not a stored preference
    var GREW=null;         // grewpy + backend: null until probed, then true/false (see the Stanza note in draw())
    var GENERIC=null;      // the generic parser's status: installed?, download size, licence, the 80 fitted languages, the sentence floor. Null until load() asks — every reader of it tests for that, so the window draws before the answer lands rather than after
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
    // The two filters COMPOSE: "Installed only" narrows the set the language search then searches, so a
    // search made inside it still means what it says.
    function match(e,q){return (!INST_ONLY||e.installed)&&(!q||wpRe(q).test((e.label||'').toLowerCase())||(e.lang||'').toLowerCase()===q);}
    async function load(refresh){var host=document.getElementById('list'); if(!api()){host.textContent='Model management is available in the desktop app.';return;}
      KEEP_SCROLL=host.scrollTop;   // remember scroll before 'Loading…' clears it (item 17)
      host.textContent='Loading…';
      var r; try{r=await api().list_models(!!refresh);}catch(e){host.textContent='Failed to load models: '+e;return;}
      if(r.error){host.textContent='Failed to load models: '+r.error;return;}
      AVAIL=r.available||[];
      AVAIL.forEach(function(e){if(e.train_sents)TRAIN[e.id]=e.train_sents;});   // whatever the disk cache already knew, shown immediately
      try{var ex=await api().list_extras(); EXTRAS=(ex&&ex.extras)||[];}catch(e){EXTRAS=[];}
      // …and whether grew can run, which decides whether the Stanza group is usable at all. Probed here
      // rather than per row: conversion_available spawns the OCaml backend on its first call.
      try{var g=await api().conversion_available(); GREW=!!(g&&g.grewpy&&g.backend);}catch(e){}
      // …and whether the generic parser is here, which decides what the "Add custom model…" row
      // promises. Re-asked on every load rather than cached: the first Create INSTALLS it, and the
      // row's subtitle has to stop offering a 31 MB download the moment it is no longer one.
      try{GENERIC=await api().custom_model_status();}catch(e){GENERIC=null;}
      draw(); pollTrain(!!refresh);}
    function draw(){var host=document.getElementById('list'); var keep=host.scrollTop||KEEP_SCROLL; KEEP_SCROLL=0;
      var q=(document.getElementById('q').value||'').trim().toLowerCase(); host.innerHTML='';
      function grp(title,engine){var rows=AVAIL.filter(function(e){return e.engine===engine&&match(e,q);}); if(!rows.length)return;
        var h=document.createElement('div');h.className='gh';h.textContent=title;host.appendChild(h);
        rows.forEach(function(e){host.appendChild(row(e));});}
      /* ── CUSTOM, AT THE TOP, ALWAYS ────────────────────────────────────────────────────────────
         Its heading and its "Add custom model…" row are drawn whether or not anything matches the
         search, and whether or not any custom model exists — unlike every other group here, which
         appears only when it has rows. Two reasons. It is the only group that is a THING TO DO
         rather than a list to read, and hiding the way in until there is already something to see is
         the shape of a feature nobody finds. And its rows are named by the reader, not by a language
         table, so "Installed only" says nothing about them (they are all installed, by construction)
         and a language search that hides the button would leave a reader who typed one wondering
         where it went. The search DOES still filter the rows themselves, by their names.
         Suppressed under a search only when the reader is plainly looking for something else — i.e.
         a query that matches no custom model at all AND matches something in another group. */
      var customs=AVAIL.filter(function(e){return e.engine==='custom';});
      var cmatch=customs.filter(function(e){return match(e,q);});
      if(!q||cmatch.length||!AVAIL.some(function(e){return e.engine!=='custom'&&match(e,q);})){
        var ch=document.createElement('div');ch.className='gh';ch.textContent='Custom';host.appendChild(ch);
        host.appendChild(addRow());
        cmatch.forEach(function(e){host.appendChild(customRow(e));});
        // …and the shared wheel itself, LAST in its own group and only once it is here. It is the one
        // thing under this heading that is a download rather than a row of a table, so it needs the
        // Update and Remove buttons every other downloaded model has — without a row of its own the
        // 31 MB would have been installable and never removable. Its `engine` keeps it out of the SUD
        // group (models_registry.GENERIC_SUD), which is why it has to be drawn deliberately here.
        var g=AVAIL.filter(function(e){return e.engine==='generic'&&e.installed;})[0];
        if(g)host.appendChild(genericRow(g));}
      grp('SUD · spaCy','sud'); grp('UD · Stanza','stanza');
      /* …AND WHY EVERY STANZA MODEL WOULD BE INERT, said BEFORE a 400 MB download rather than after.
         Stanza emits UD and this app stores SUD, so parse._parse_stanza_ud_to_sud runs the conversion
         grammar on EVERY Stanza parse — which needs grewpy AND its OCaml backend. Without the backend the
         models download perfectly and then do nothing at all, which is exactly how the fault was reported.
         GREW===null means never probed, and says nothing rather than raising a false alarm. */
      if(GREW===false && AVAIL.some(function(e){return e.engine==='stanza'&&match(e,q);})){
        var w=document.createElement('div');w.className='gwarn';
        w.textContent='Stanza models produce UD, which this app converts to SUD with grew — and the grew backend is not available here, so they will parse nothing. Reinstall the app, or install it yourself with: brew install opam && opam init && opam install grewpy_backend';
        var hs=[].slice.call(host.querySelectorAll('.gh')).filter(function(x){return x.textContent==='UD · Stanza';});
        if(hs.length&&hs[0].nextSibling)host.insertBefore(w,hs[0].nextSibling); else host.appendChild(w);}
      if(!q && !INST_ONLY && EXTRAS.length){   // optional heavy-dependency tiers — not filtered by the language search, and out of scope entirely under "Installed only", which is a question about MODELS
        var eh=document.createElement('div');eh.className='gh';eh.textContent='Optional language support';host.appendChild(eh);
        EXTRAS.forEach(function(t){host.appendChild(extraRow(t));});}
      host.scrollTop=keep;   // restore the pre-render scroll offset (item 17)
      // "No matches" under a filter the reader set themselves is a dead end; naming the filter says what to undo.
      if(!host.children.length) host.textContent=INST_ONLY?(q?'No installed models match.':'No models installed yet.'):(q?'No matches.':'No models found (offline?). Try Refresh.');
      revealFocus();}
    // A tier named by open_models_window(focus) — the row a Script/transliteration menu's "install"
    // link was pointing at. Consumed ONCE: this list re-draws after every install and on Refresh, and
    // a flash that fired again each time would be pointing at a row the reader has already dealt with.
    // The scroll is `nearest`, so a row already on screen does not move under the pointer.
    function revealFocus(){if(!FOCUS)return; var el=document.querySelector('#list .row[data-tier="'+FOCUS+'"]');
      FOCUS=''; if(!el)return;
      try{el.scrollIntoView({block:'nearest'});}catch(_){el.scrollIntoView();}
      el.classList.add('flash');}
    /* ── the Custom group's own two row shapes ───────────────────────────────────────────────── */
    function addRow(){var r=document.createElement('div');r.className='row addrow';r.setAttribute('role','button');r.tabIndex=0;
      var p=document.createElement('span');p.className='plus';p.textContent='+';
      var info=document.createElement('div');info.className='mi';
      var nm=document.createElement('span');nm.className='nm';nm.textContent='Add custom model…';
      var sub=document.createElement('small');
      // The two facts a reader needs BEFORE the sheet, not inside it: that this is one parser many
      // languages share, and (until it is here) that saying yes means a 31 MB download.
      sub.textContent=GENERIC&&GENERIC.installed
        ? 'One language of the generic parser, fitted on your own annotated sentences'
        : ('Fetches the generic parser'+(GENERIC&&GENERIC.size?' ('+Math.round(GENERIC.size/1e6)+' MB)':'')+' the first time');
      info.appendChild(nm);info.appendChild(sub);
      r.appendChild(p);r.appendChild(info);
      // …called with NO argument, deliberately: `onclick=openNew` would hand it the MouseEvent where
      // it expects an entry to pre-fill from. It works only because a MouseEvent happens to have no
      // `.slug` or `.label`, which is not a thing to rely on.
      r.onclick=function(){openNew();}; r.onkeydown=function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openNew();}};
      return r;}
    function genericRow(e){var r=document.createElement('div');r.className='row';r.setAttribute('data-mid',e.id);
      var info=document.createElement('div');info.className='mi';
      var meta=[e.version?('v'+e.version):null,e.size?(Math.round(e.size/1e6)+' MB'):null,
                (GENERIC&&GENERIC.licence)||null].filter(Boolean).join(' · ');
      var n=(GENERIC&&GENERIC.count)||0;
      info.innerHTML='<span class="nm">'+esc(e.label||e.id)+'</span><small>'+esc(meta)+'</small>'
        +'<small class="cav">The pipeline every custom model above is one language row of. '
        +(n?('Removing it stops '+n+' custom model'+(n===1?'':'s')+' parsing; their fitted rows are kept and work again if it is reinstalled.')
           :'Custom models are built from it.')+'</small>';
      var right=document.createElement('div');right.className='right';
      var tag=document.createElement('span');tag.className='pill';tag.textContent='Installed ✓';right.appendChild(tag);
      if(e.update_available){var u=document.createElement('button');u.className='success sm';u.textContent='Update';
        u.onclick=function(){downloadModel(e,r,u,'Update');};right.appendChild(u);}
      var b=document.createElement('button');b.className='danger sm';b.textContent='Remove';
      b.onclick=function(){removeModel(e,r);};right.appendChild(b);
      r.appendChild(info);r.appendChild(right);return r;}
    function customRow(e){var r=document.createElement('div');r.className='row';r.setAttribute('data-mid',e.id);
      var info=document.createElement('div');info.className='mi';
      var meta=[e.lang?('Language: '+e.lang):null,
                e.basis==='file'?('Fitted on '+e.train_sents+' sentences'):'Not fitted'].filter(Boolean).join(' · ');
      var sc=(e.uas!=null&&e.las!=null)?('<small class="sc">UAS <b>'+(+e.uas)+'</b> · LAS <b>'+(+e.las)+'</b></small>'):'';
      info.innerHTML='<span class="nm">'+esc(e.label||e.id)+'</span><small>'+esc(meta)+'</small>'+sc
        // ⚠ THE CAVEAT IS NOT OPTIONAL FURNITURE. These figures sit in the same column as every other
        // model's, and for a model with no training file they are the generic parser's HELD-OUT
        // average over twenty languages that are not this one. A number in that column with nothing
        // saying what it measured is the single most misleading thing this window could show.
        + (e.caveat?'<small class="cav">'+esc(e.caveat)+'</small>':'');
      var right=document.createElement('div');right.className='right';
      // Edit before Remove: the ordinary act first, the destructive one last and in its own colour.
      var ed=document.createElement('button');ed.className='sec sm';ed.textContent='Edit';
      ed.onclick=function(){openNew(e);};right.appendChild(ed);
      var b=document.createElement('button');b.className='danger sm';b.textContent='Remove';
      b.onclick=function(){removeModel(e,r);};right.appendChild(b);
      r.appendChild(info);r.appendChild(right);return r;}
    function row(e){var row=document.createElement('div');row.className='row';row.setAttribute('data-mid',e.id);
      var info=document.createElement('div');info.className='mi';
      // On report ("whenever there is a newer version of a parser than what's installed, the Install
      // button should become a green Update button"): update_available/installed_version come from
      // models_registry.merge_installed, which now keeps the on-disk version distinct from `version`
      // (the latest OFFERED one) rather than the latter silently overwriting it. Named both, rather
      // than leaving the button alone to say it: a bare "Update" with no numbers still leaves "update
      // to WHAT, from WHAT" unanswered.
      var meta=(e.installed&&e.update_available&&e.installed_version)
        ? ('v'+e.installed_version+' installed · v'+e.version+' available')
        : [e.version?('v'+e.version):null,e.size?(Math.round(e.size/1e6)+' MB'):null].filter(Boolean).join(' · ');
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
        // Update is NOT gated on !e.bundled though — on report ("I should be able to update the
        // bundled English parser"): a newer release is still worth taking even for a model that
        // ships pinned, and models_registry.download() now handles the one thing that made this
        // actually work rather than silently do nothing (a BUNDLED package's core-venv copy
        // otherwise always wins sys.path resolution over whatever Update installs — see its own
        // note, "…AND CLEAR THE CORE VENV'S OWN SHADOW"). Reuses download_model as-is: it already
        // purges the old EXTRAS_DIR install and force-reinstalls (models_registry.download's own
        // note), so there is no separate "upgrade" endpoint to call.
        if(e.update_available){var u=document.createElement('button');u.className='success sm';u.textContent='Update';u.onclick=function(){downloadModel(e,row,u,'Update');};right.appendChild(u);}
        if(!e.bundled){var b=document.createElement('button');b.className='danger sm';b.textContent='Remove';b.onclick=function(){removeModel(e,row);};right.appendChild(b);}}
      else{var d=document.createElement('button');d.className='sm';d.textContent='Download';d.onclick=function(){downloadModel(e,row,d);};right.appendChild(d);}
      row.appendChild(info);row.appendChild(right);return row;}
    // Turns `btn` into its OWN progress indicator — a left-to-right fill — instead of a separate bar
    // appended under the row's label, which used to grow the row's own height. On report: "the install
    // button should itself become a progress bar... starting out as an outlined button, and then
    // filling in from left to right... this way the row won't suddenly become taller". `background` is
    // set as an INLINE style (not via a CSS custom property some class rule reads) deliberately: inline
    // always wins outright, so filling the button never has to referee a specificity race against
    // .success's own `background`. Returns {setPct(pct), reset()}; reset() restores the button's resting
    // look/label exactly as it was before progress started (this is also the failure path).
    function progressButton(btn,restLabel){
      var color=btn.classList.contains('success')?'var(--good)':'var(--accent,#0a84ff)';
      btn.classList.add('progress'); btn.style.border='1.5px solid '+color;
      // The button's OWN text stays a PLAIN, ORDINARY text node — in normal flow, same as any resting
      // button's label — recoloured via `color` rather than replaced by a span. On report: "the
      // progress-bar button is absurdly narrow — too small to contain its text": the first version
      // made BOTH copies position:absolute spans, so the button had NO in-flow content left to size
      // itself against and collapsed to its bare padding. Only ONE extra layer is actually needed:
      // .fg (white, absolutely positioned, clip-path'd to the filled portion) painted OVER this text
      // — wherever it's clipped away, the button's own (now-coloured) text shows through underneath,
      // so the label always reads as whichever colour actually CONTRASTS with what's directly behind
      // it, on report: "the button text should be white where the progress bar is filled in, and
      // button-coloured where it's not... always the contrasting colour". See button.progress
      // .plabel.fg (above) for the overlay.
      var startText=btn.textContent;
      btn.style.color=color;
      var bgText=document.createTextNode(startText);
      var fg=document.createElement('span'); fg.className='plabel fg'; fg.textContent=startText;
      btn.textContent=''; btn.appendChild(bgText); btn.appendChild(fg);
      var setText=function(t){ bgText.textContent=t; fg.textContent=t; };
      var setPct=function(pct){ btn.style.background='linear-gradient(to right, '+color+' '+pct+'%, transparent '+pct+'%)'; fg.style.clipPath='inset(0 '+(100-pct)+'% 0 0)'; };
      setPct(0);
      return { setPct:setPct, setText:setText, reset:function(){ btn.classList.remove('progress'); btn.style.border=''; btn.style.background=''; btn.style.color=''; btn.disabled=false; btn.textContent=restLabel; } };
    }
    async function downloadModel(e,row,btn,label){label=label||'Download';btn.disabled=true;btn.textContent='Starting…';
      var p=progressButton(btn,label);
      var r; try{r=await api().download_model(e.id);}catch(err){p.reset();return;}
      if(r.error){p.reset();return;}
      var job=r.job_id;
      var tick=async function(){var st; try{st=await api().model_job_status(job);}catch(err){return;}
        if(st.error){p.reset();return;}
        if(st.pct!=null)p.setPct(st.pct); if(st.note)p.setText(st.note);
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
      var p=progressButton(btn,'Install');
      var r; try{r=await api().install_extra(t.id);}catch(err){p.reset();return;}
      if(r.error){p.reset();return;}
      var job=r.job_id;
      var tick=async function(){var st; try{st=await api().model_job_status(job);}catch(err){return;}
        if(st.error){p.reset();return;}
        if(st.pct!=null)p.setPct(st.pct); if(st.note)p.setText(st.note);
        if(st.done){load(false);return;}
        setTimeout(tick,500);};
      tick();}
    /* ══ THE NEW-CUSTOM-MODEL SHEET ═════════════════════════════════════════════════════════════
       Two fields and one button. What makes it more than that is what it has to be honest about:
       whether the 31 MB wheel is here yet, whether the named language is one of the 80 the embedding
       table was already fitted for, and what the figures in the row it creates will actually mean. */
    var EDITING='';      // the slug being edited, "" when the sheet is making a new model
    var NEWLANG='';      // the ISO code the reader PICKED from the menu, "" for a free-text name
    var NEWFILE='';      // the chosen training file's path, "" for none
    var NEWFILENAME='';
    var _lmItems=[],_lmIdx=-1;
    // The same word-prefix rule the list search above uses and the app's own language picker uses:
    // "eng" finds English, Engenni and Middle English, and no longer every name with those letters
    // buried in the middle of a word.
    function isoRows(){return window.ISO639_3||[];}
    var _glot=null;
    function glotName(c){ if(_glot===null){_glot={}; (window.GLOTTOLOG_NAME||'').split('\t').forEach(function(e){var i=e.indexOf('=');if(i>0)_glot[e.slice(0,i)]=e.slice(i+1);});} return _glot[c]||''; }
    function isoLabel(e){return glotName(e[0])||e[2];}
    function isoCode(e){return e[1]||e[0];}   // the canonical code the app keys on: 2-letter where the language has one
    function newIntro(){
      var d=document.getElementById('newintro');
      if(EDITING){   // they have one already; what they need to know is what pressing Save will cost
        d.innerHTML='Renaming is instant. The language embedding is re-fitted only if you point it at a <b>different training file</b> — or at the same one after editing it.';
        return;}
      var base='A custom model is one language of the <b>generic parser</b> — a pipeline trained on 80 SUD treebanks that reads your word classes and supplies the features and the tree. Each one is a single 128-value row fitted for a language of your choosing, so you can make as many as you like.';
      if(GENERIC&&!GENERIC.installed)
        base+=' The parser itself is fetched the first time'+(GENERIC.size?' ('+Math.round(GENERIC.size/1e6)+' MB)':'')+'; it is '+esc(GENERIC.licence||'')+', which is why it is downloaded rather than shipped with the app.';
      d.innerHTML=base;}
    function newFileHint(){
      var h=document.getElementById('newfilehint'), min=(GENERIC&&GENERIC.min_sents)||30,
          few=(GENERIC&&GENERIC.few_sents)||10;
      // WITH A FILE, the thing worth saying is what the FIGURES will mean, since the fitting happens
      // either way: the floor gates the SCORE, not the file. Said before Create rather than in the
      // row afterwards, because it is the one thing the reader could still act on.
      if(NEWFILE){ h.innerHTML='Fitted on these sentences. With <b>'+min+' or more</b> the row is fitted on most of them and scored on the rest, so its UAS/LAS is measured on data the fitting never saw; with fewer, all of them are used for the fitting and no figure is measured — about '+few+' is where the gain starts.'; return; }
      // WHAT HAPPENS WITH NO FILE, said before the reader presses Create rather than in the row
      // afterwards — and the answer is genuinely different for the 80 fitted languages, which is
      // exactly the thing a reader cannot be expected to know.
      if(NEWLANG&&GENERIC&&(GENERIC.fitted_langs||[]).indexOf(NEWLANG)>=0){
        h.innerHTML="Without a file this model uses the row the generic parser already learnt for <b>"+esc(NEWLANG)+"</b>, one of its 80 training languages. It will parse — but the figures in the list will be the parser's held-out average over 20 <i>unseen</i> languages, not a measurement on your data.";
        return;}
      h.innerHTML="Around <b>"+few+" annotated sentences</b> is enough to fit the language row, and "+min+" or more also buys a held-out UAS/LAS. Without any, the row is left unfitted — which upstream measured costing about 4 LAS against carrying no language channel at all, so the model will parse, badly.";}
    function newLangLine(){
      var el=document.getElementById('newlang');
      if(!NEWLANG){ el.textContent=document.getElementById('newname').value.trim()?'Not a language name — that is fine, the model is simply called that.':''; return; }
      var fitted=GENERIC&&(GENERIC.fitted_langs||[]).indexOf(NEWLANG)>=0;
      el.innerHTML="Language code <b>"+esc(NEWLANG)+"</b> — "+(fitted?"already one of the parser's 80 training languages.":"new to the parser, so it needs a training file.");}
    function lmClose(){document.getElementById('newlm').hidden=true;_lmItems=[];_lmIdx=-1;}
    function lmFilter(q){
      q=(q||'').trim().toLowerCase(); var box=document.getElementById('newlm');
      if(!q||!isoRows().length){lmClose();return;}
      var wp=wpRe(q),pre=[],sub=[];
      for(var i=0;i<isoRows().length;i++){var e=isoRows()[i],nm=isoLabel(e).toLowerCase();
        if(e[0]===q||e[1]===q||nm.indexOf(q)===0)pre.push(e);
        else if(wp.test(nm))sub.push(e);
        if(pre.length>=40)break;}
      _lmItems=pre.concat(sub).slice(0,40);_lmIdx=-1;
      box.innerHTML='';
      if(!_lmItems.length){box.innerHTML='<div class="note">No matching language — press Create to use this as a plain name.</div>';box.hidden=false;return;}
      _lmItems.forEach(function(e,k){var b=document.createElement('button');b.type='button';
        b.innerHTML='<span class="nm2">'+esc(isoLabel(e))+'</span><span class="cd">'+esc(e[1]?e[1]+' · '+e[0]:e[0])+'</span>';
        b.onmousedown=function(ev){ev.preventDefault();};   // don't blur the field before the click lands
        b.onclick=function(){lmPick(e);};
        b.onmouseenter=function(){lmHi(k);};
        box.appendChild(b);});
      box.hidden=false;box.scrollTop=0;}
    function lmHi(k){_lmIdx=k;var bs=document.getElementById('newlm').querySelectorAll('button');
      for(var i=0;i<bs.length;i++)bs[i].classList.toggle('hi',i===k);
      if(bs[k])bs[k].scrollIntoView({block:'nearest'});}
    function lmPick(e){document.getElementById('newname').value=isoLabel(e);NEWLANG=isoCode(e);lmClose();newLangLine();newFileHint();}
    /* ONE SHEET FOR BOTH, pre-filled when editing. The two acts ask for exactly the same three
       answers — a name, a language, a training file — so a second sheet would be the same form twice,
       drifting apart at the first change to either. `EDITING` is the slug being edited, "" for a new
       model, and it is the only thing the Save handler branches on. */
    function openNew(e){
      EDITING=(e&&e.slug)||'';
      NEWLANG=(e&&e.lang)||'';NEWFILE=(e&&e.train_file)||'';NEWFILENAME=(e&&e.train_name)||'';
      var n=document.getElementById('newname');n.value=(e&&e.label)||'';
      var f=document.getElementById('newfile');
      f.textContent=NEWFILENAME||'No file'; f.className='fname'+(NEWFILE?'':' none');
      document.getElementById('newclear').hidden=!NEWFILE;
      var err=document.getElementById('newerr');err.hidden=true;err.textContent='';
      var go=document.getElementById('newgo');go.disabled=false;go.textContent=EDITING?'Save':'Create';
      document.getElementById('newh').textContent=EDITING?'Edit custom model':'New custom model';
      newIntro();newLangLine();newFileHint();lmClose();
      document.getElementById('newscrim').hidden=false;
      setTimeout(function(){n.focus();n.select();},0);}
    function closeNew(){document.getElementById('newscrim').hidden=true;lmClose();}
    (function(){
      var n=document.getElementById('newname');
      n.addEventListener('input',function(){
        // TYPING CLEARS THE PICKED CODE. The code is a claim the reader made by CHOOSING a row; once
        // the text no longer is that row's name, the claim is stale, and silently keeping it would
        // fit "Wolof" onto a model the reader has since renamed to something else entirely.
        NEWLANG='';lmFilter(n.value);newLangLine();newFileHint();});
      n.addEventListener('keydown',function(ev){
        var box=document.getElementById('newlm');
        if(ev.key==='ArrowDown'&&!box.hidden){ev.preventDefault();lmHi(Math.min(_lmIdx+1,_lmItems.length-1));}
        else if(ev.key==='ArrowUp'&&!box.hidden){ev.preventDefault();lmHi(Math.max(_lmIdx-1,0));}
        else if(ev.key==='Enter'){ if(!box.hidden&&_lmIdx>=0){ev.preventDefault();lmPick(_lmItems[_lmIdx]);} else {ev.preventDefault();createNew();} }
        else if(ev.key==='Escape'){ if(!box.hidden){ev.stopPropagation();lmClose();} }});
      n.addEventListener('blur',function(){setTimeout(lmClose,120);});
      document.getElementById('newpick').onclick=async function(){
        if(!api())return; var r; try{r=await api().pick_conllu_file();}catch(e){return;}
        if(!r||r.cancelled)return;
        NEWFILE=r.path||'';NEWFILENAME=r.name||'';
        var f=document.getElementById('newfile');f.textContent=NEWFILENAME||'No file';f.className='fname'+(NEWFILE?'':' none');
        document.getElementById('newclear').hidden=!NEWFILE; newFileHint();};
      document.getElementById('newclear').onclick=function(){NEWFILE='';NEWFILENAME='';
        var f=document.getElementById('newfile');f.textContent='No file';f.className='fname none';
        document.getElementById('newclear').hidden=true;newFileHint();};
      document.getElementById('newcancel').onclick=closeNew;
      document.getElementById('newgo').onclick=createNew;
      document.getElementById('newscrim').addEventListener('mousedown',function(ev){if(ev.target===this)closeNew();});
    })();
    async function createNew(){
      var name=document.getElementById('newname').value.trim();
      var err=document.getElementById('newerr'), go=document.getElementById('newgo');
      function fail(msg){err.textContent=msg;err.hidden=false;p.reset();}
      if(!name){err.textContent='Give the model a name.';err.hidden=false;return;}
      err.hidden=true; go.disabled=true;
      var p=progressButton(go,EDITING?'Save':'Create');
      var r; try{r=EDITING?await api().update_custom_model(EDITING,name,NEWLANG,NEWFILE)
                          :await api().create_custom_model(name,NEWLANG,NEWFILE);}
             catch(e){return fail(String(e));}
      if(r.error)return fail(r.error);
      var job=r.job_id;
      var tick=async function(){var st; try{st=await api().model_job_status(job);}catch(e){return;}
        if(st.error)return fail(st.error);
        if(st.pct!=null)p.setPct(st.pct); if(st.note)p.setText(st.note);
        if(st.done){closeNew();
          // The main window's model dropdown gains the new row too — it is immediately selectable,
          // and a model you have to reopen a window to see is one you assume did not get made.
          try{api().child_refresh_models();}catch(_){}
          load(false);return;}
        setTimeout(tick,500);};
      tick();}
    document.getElementById('q').addEventListener('input',draw);
    // The toggle re-filters IN PLACE — the listing is already loaded, so it costs no bridge call.
    (function(){var b=document.getElementById('instonly');
      b.onclick=function(){INST_ONLY=!INST_ONLY;
        b.classList.toggle('on',INST_ONLY); b.setAttribute('aria-pressed',String(INST_ONLY)); draw();};})();
    document.getElementById('refresh').onclick=function(){load(true);};
    document.getElementById('close').onclick=function(){try{api().close_child_window('models');}catch(_){}};
    // ESCAPE CLOSES THE INNERMOST THING THAT IS OPEN. With the new-model sheet up it dismisses the
    // SHEET, not the window behind it: a modal that shares its dismissal key with its own parent
    // throws away a half-typed form and the window it was in, on one keystroke meant for the form.
    // (The name field's own handler takes Escape first when its language menu is open — same rule,
    // one level further in.)
    document.addEventListener('keydown',function(e){if(e.key!=='Escape')return; e.preventDefault();
      if(!document.getElementById('newscrim').hidden){closeNew();return;}
      try{api().close_child_window('models');}catch(_){}});
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
