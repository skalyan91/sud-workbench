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
from pathlib import Path
from typing import Any

import webview

from . import convert, detect, io_conllu, itrans, model, models_registry, parse, toolbox_import
from .paths import APP_DATA

_STATE_FILE = os.path.join(APP_DATA, "state.json")   # small persisted app state (recent files, …)
_MAX_RECENT = 10


def _esc(s: str) -> str:
    """Minimal HTML-escape for text interpolated into the generated child-window pages."""
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


_DATA_DIR = Path(__file__).parent / "data"


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
    def sync_menu(self, state: dict) -> dict:
        """Frontend reports the selection state (token selected? which pane? RTL? group/ungroup available?);
        show only the relevant items, flip the head-stepping icons under RTL."""
        if not self._menu:
            return {"ok": False}
        st = dict(state or {})
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(self._apply_menu, st)   # NSMenuItem edits on the main thread
        except Exception:  # noqa: BLE001
            self._apply_menu(st)
        return {"ok": True}

    def _apply_menu(self, st: dict):
        m = self._menu or {}
        has, zone = bool(st.get("has")), st.get("zone") or ""
        rtl, group, ungroup = bool(st.get("rtl")), bool(st.get("group")), bool(st.get("ungroup"))
        diagram, grid = has and zone == "diagram", has and zone == "grid"
        convmwt, flatmwt, wrap_ok = bool(st.get("convmwt")), bool(st.get("flatmwt")), bool(st.get("wrapOK"))
        merge = bool(st.get("merge"))   # a fresh multi-token selection that is not already an MWT — the same state Group needs
        block_only = bool(st.get("blockOnly"))
        vis = {
            "Group as Multi-word Token": group, "Merge Tokens": merge, "Ungroup Multi-word Token": ungroup,
            "Split into Multi-word Token": convmwt, "Flatten Multi-word Token": flatmwt,
            "Move Token Left": diagram, "Move Token Right": diagram,
            "Move Token Up": grid, "Move Token Down": grid,
            "Insert Token Left": diagram, "Insert Token Right": diagram,
            "Insert Token Above": grid, "Insert Token Below": grid,
            "Select Previous Head": has, "Select Next Head": has,
            "Set as Root": has, "Edit Lemma": has,
            "Mark as Foreign": has, "Mark as Typo": has,   # items 2/3: marker FEATS act on the selected token (or range)
            "Mark as Reported Speech": has,   # item 7: Reported=Yes lands on the head of the selection
            "Paragraph Starts at Token": has,   # item 2: MISC NewPar=Yes is token-scoped (the two sentence-level boundary rows beside it are always shown)
            "Insert Sentence Before": block_only, "Insert Sentence After": block_only,
            "Move Sentence Up": block_only, "Move Sentence Down": block_only, "Delete Sentence": block_only,
            "__sep_tokens__": has or group or ungroup,
            "Wrap Long Lines": wrap_ok,   # View-menu item: available in every graphical notation
        }
        for title, show in vis.items():
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
        for title, key in (("Mark as Foreign", "foreign"), ("Mark as Typo", "typo"), ("Mark as Reported Speech", "reported"),
                           ("Document Boundary", "newdoc"), ("Paragraph Boundary", "newpar"),
                           ("Paragraph Starts at Token", "tokNewpar"), ("Paged Layout", "paged")):
            it = m.get(title)
            if it is not None:
                try:
                    it.setState_(1 if st.get(key) else 0)
                except Exception:  # noqa: BLE001
                    pass
        # head-stepping icons point toward the earlier/later token — flip them under RTL
        try:
            import AppKit
            def sym(name):
                return AppKit.NSImage.imageWithSystemSymbolName_accessibilityDescription_(name, None)
            prev, nxt = m.get("Select Previous Head"), m.get("Select Next Head")
            if prev is not None:
                img = sym("chevron.right.2" if rtl else "chevron.left.2")
                if img is not None:
                    prev.setImage_(img)
            if nxt is not None:
                img = sym("chevron.left.2" if rtl else "chevron.right.2")
                if img is not None:
                    nxt.setImage_(img)
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
        """Reveal a folder or file in Finder — backs the titlebar proxy-icon folder-path menu.
        A directory opens in place; a file is revealed (selected) in its containing folder."""
        if not path:
            return {"error": "no path"}
        try:
            import subprocess
            if os.path.isdir(path):
                subprocess.run(["open", path], check=False)
            else:
                subprocess.run(["open", "-R", path], check=False)
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

    def transliterate(self, forms: list[str], lang: str, scheme: str = "") -> dict:
        from . import translit
        return {"translit": translit.transliterate_many(forms, lang, scheme), "lang": lang, "scheme": scheme}

    def set_doc_language(self, lang: str = "") -> dict:
        """The frontend reports the document's language whenever it changes (js/lang/translit.js's
        loadTranslitSchemes, which setLang already calls on every change).  Recorded as the FALLBACK
        for a call that names no language — see ``self._doclang``'s own note."""
        self._doclang = str(lang or "")
        return {"ok": True}

    def itrans_to_iast(self, text: str, lang: str = "") -> dict:
        """The ONE entry point for typed-Sanskrit input: ITRANS in, IAST out.  Every input field that
        can receive a Sanskrit word routes through this, so the notation gate is decided in exactly one
        place (app.itrans.looks_itrans) and can never drift between call sites.

        Returns ``{"converted", "changed"}``.  A non-Sanskrit ``lang``, a word with no ITRANS-only
        spelling in it, or a missing aksharamukha all come back unchanged rather than raising — the
        caller can commit the result unconditionally.  ``lang`` empty ⇒ the language the frontend last
        reported (set_doc_language), which is what a caller with no DOCLANG of its own falls back on;
        with neither known the answer is "not Sanskrit" — an unknown language must leave the text as typed, never
        guess Sanskrit and rewrite it."""
        return itrans.convert(text or "", lang or self._doclang or "und")

    def token_readings(self, form: str, lang: str, scheme: str = "") -> dict:
        """The ORDERED candidate romanisations of one token in ``scheme`` — the heteronym choices for
        the CJK languages (Han characters are heteronymic; Japanese kanji carry several on'yomi/
        kun'yomi). ``readings[0]`` is what the app is currently displaying, so the caller can tick it.
        Empty list ⇒ only one possible reading (nothing to choose) or a language/scheme with none."""
        from . import translit
        return {"readings": translit.readings(form, lang, scheme), "lang": lang, "scheme": scheme}

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

    def orthography(self, forms: list[str], lang: str, scheme: str = "") -> dict:
        from . import translit
        return {"ortho": translit.orthography_many(forms, lang, scheme), "lang": lang, "scheme": scheme}

    def sanskrit_mwt(self, groups: list[list[str]], lang: str, scheme: str = "",
                     lemma_groups: list[list[str]] | None = None, word_sep: str = "") -> dict:
        """Reconstruct each Sanskrit multi-word token's surface form from its component words,
        fusing the joins by external sandhi, then render the fused form in ``scheme`` (a script).
        ``groups`` = one component-form list per MWT; ``lemma_groups`` (optional, parallel) supplies
        each component's CoNLL-U lemma as an r-stem signal for visarga sandhi.  ``word_sep`` = the
        separator kept at a NON-fusing junction: "" for a spaceless MWT (the default), " " for the
        block-initial running line so an un-coalescing junction (e.g. ``eke vāñchanti``) stays two
        words.  Returns the scripted forms + the fused IAST."""
        from . import translit
        groups = groups or []
        lg = lemma_groups or []
        iast = [translit.sandhi_join(g, lang, lg[i] if i < len(lg) else None, word_sep) for i, g in enumerate(groups)]
        ortho = [translit.sandhi_to_script(g, lang, scheme, lg[i] if i < len(lg) else None, word_sep) for i, g in enumerate(groups)]
        return {"ortho": ortho, "iast": iast, "lang": lang, "scheme": scheme}

    def sanskrit_running(self, texts: list[str], lang: str, scheme: str = "") -> dict:
        """Item 6 (rev): the block-initial Sanskrit running line, built from each sentence's RAW
        ``# text`` (not the token forms) by the gluing algorithm — strip apostrophes/hyphens/word-
        internal pipes (so hyphen-/pipe-separated compound members fuse), glue every consonant-final
        word onto the next, then render in ``scheme`` (a script).  Operating on the raw text is what
        makes the hyphen/pipe gluing work: the tokeniser has already dropped those markers from the
        forms.  Returns one scripted running line per input text."""
        from . import translit
        ortho = [translit.sanskrit_running_line(t or "", lang, scheme) for t in (texts or [])]
        return {"ortho": ortho, "lang": lang, "scheme": scheme}

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
        inst_ids = {e["id"] for e in installed}
        bundled_ids = {e["id"] for e in installed if e.get("bundled")}   # ships with the app (models_registry.BUNDLED_SUD) → the row offers no Remove
        for e in available:
            e["installed"] = e["id"] in inst_ids
            if e["id"] in bundled_ids:
                e["bundled"] = True
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
                    background_color="#1e1e1e", text_select=True,
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
                        "<body style='font:13px -apple-system,sans-serif;padding:24px'>"
                        "<h2>Help</h2><p>Help content is unavailable.</p></body>")
        # item 11: opened NARROWER (600, was 720) for a more compact window.  Content stays above
        # the help CSS's 520px single-column breakpoint, so the two-column shortcut grid survives
        # (2 cols of ≈280px after the 40px body padding) without horizontal scroll.
        return self._open_window("help", "SUD Workbench Help", page, 600, 640, (460, 420))

    def open_about_window(self, version: str = "") -> dict:
        """Open the About window (item 26): separate native window; created by Siva Kalyan."""
        return self._open_window("about", "About SUD Workbench",
                                 self._about_html(version), 380, 320, (340, 300))

    def open_models_window(self) -> dict:
        """Open the Model Manager as a real window (item 23)."""
        return self._open_window("models", "Manage Models",
                                 self._models_html(), 660, 580, (420, 400))

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
        and that structure has to survive to `# newpar` / `# newdoc`. A PARALLEL text has no such
        structure to keep — its sentences only have to line up one-for-one with the inserted blocks —
        so it is sentencised HERE, where each language's own installed pipeline can be picked (see
        _sentencize_parallel)."""
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
                sents = self._sentencize_parallel(raw, lang, model_id)
                if sents:
                    if not model_id:
                        naive.append(lang)
                    parallels.append({"lang": lang, "sents": sents})
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
    def _sentencize_parallel(text: str, lang: str, model_id: str) -> list[str]:
        """A parallel text → its sentences, in order, using ``lang``'s own installed pipeline when
        there is one and the script-aware rule splitter when there isn't (parse.sentencize already
        degrades that way, so a missing model is never an exception).

        PARAGRAPH-SPLIT FIRST, for the reason js/io/bridge.js records at splitParagraphs: parse.sentencize
        strips its input and returns whitespace-stripped slices, so a text handed to it whole comes back
        with every blank line gone — and a paragraph break is a hard sentence boundary no model should be
        free to cross anyway. The main text is split the same way on the frontend, so a parallel text laid
        out in the same paragraphs stays aligned with it sentence for sentence."""
        out: list[str] = []
        for para in _PARA_SPLIT.split((text or "").replace("\r\n", "\n").replace("\r", "\n")):
            para = para.strip()
            if not para:
                continue
            try:
                segs = parse.sentencize(para, lang, model_id)
            except Exception as exc:  # noqa: BLE001 — never let one paragraph lose the whole translation
                print(f"[insert] sentencize {lang!r}: {exc}", file=sys.stderr)
                segs = []
            out.extend(segs or [para])
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
         font:14px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
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

    def _models_html(self) -> str:
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script>" + self._confirm_js() + "</script><style>" + self._base_css() + """
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
    function match(e,q){return !q||(e.label||'').toLowerCase().indexOf(q)>=0||(e.lang||'').toLowerCase()===q;}
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
      if(!host.children.length) host.textContent=q?'No matches.':'No models found (offline?). Try Refresh.';}
    function row(e){var row=document.createElement('div');row.className='row';row.setAttribute('data-mid',e.id);
      var info=document.createElement('div');info.className='mi';
      var meta=[e.version?('v'+e.version):null,e.size?(Math.round(e.size/1e6)+' MB'):null].filter(Boolean).join(' · ');
      var sc=(e.uas!=null&&e.las!=null)?('<small class="sc">UAS <b>'+(+e.uas)+'</b> · LAS <b>'+(+e.las)+'</b></small>'):'';   // same " · " separator the version/size meta line uses
      info.innerHTML='<span class="nm">'+esc(e.label||e.id)+'</span>'+(meta?'<small>'+esc(meta)+'</small>':'')
        +'<small class="ts">'+trainHtml(e.id)+'</small>'+sc;
      var right=document.createElement('div');right.className='right';
      if(e.installed){var tag=document.createElement('span');tag.className='pill';tag.textContent='Installed ✓';right.appendChild(tag);
        var b=document.createElement('button');b.className='danger sm';b.textContent='Remove';b.onclick=function(){removeModel(e,row);};right.appendChild(b);}
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
    .mk{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:700;min-width:54px;color:var(--fg)}
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
