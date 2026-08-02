# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A native-feeling desktop app for viewing and editing dependency treebanks in CoNLL-U, speaking
**SUD** relation set (plus **UD** import/export and **mSUD**). All-Python
**pywebview** shell (`app/`) wrapping a framework-free SVG + CSS frontend (`web/`) — **no build
step, no bundler, no npm**. `README.md` has the user-facing feature list; this file covers how to
work on it.

**Two platforms, one document renderer.** macOS is tuned against the macOS 26 "Tahoe" Figma kit and
the HIG; Windows against the official Windows UI Kit and — far more usefully — the **MIT-licensed
WinUI 3 theme resources** (`microsoft/microsoft-ui-xaml`), which state as machine-readable XAML what
Apple only writes in prose. Values in `web/win11-kit/` are *derived from those files*, not
eyeballed: if you change one, cite the dictionary it came from. Anything Microsoft does not publish
(ThemeShadow's blur/offset/alpha, Mica's recipe, the shell caption-button size, the focus-ring
thicknesses) is marked `APPROX` in place — don't quietly promote a guess to a fact.

The macOS build is the one that has actually run. **Everything Windows-specific is written to spec
and untested** — see "Windows: what has never executed" below.

## Commands

```sh
# Run (Python 3.12 — spaCy/stanza/torch wheels are unreliable on 3.14)
.venv/bin/python -m app                        # or: … -m app samples/english.conllu
SUD_DEBUG=1 .venv/bin/python -m app            # opens the WebKit inspector

# Fresh environment
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Build the shipping bundle (also run automatically — see "Automatic rebuild" below)
packaging/make_bootstrap_app.sh                # → dist/SUD Workbench.app
```

**Launching the GUI: always detach it.** A pywebview app started as a Claude Code managed
background job gets SIGKILLed when the harness reaps the job — the window vanishes with no crash
log, which looks exactly like an app crash and has been misdiagnosed as one before. Use:

```sh
.venv/bin/python -c "import os,sys; os.setsid(); os.execv(sys.executable,[sys.executable,'-m','app','samples/english.conllu'])" &
```

### Verification (there is no test suite)

Three checks stand in for one; run all three after non-trivial edits.

1. **Byte-stable round-trip** — the hard I/O requirement: open → save with no edits must be
   byte-identical.
   ```sh
   for f in samples/*.conllu; do
     .venv/bin/python -c "from app import io_conllu
   o=open('$f',encoding='utf-8').read()
   print('$f','STABLE' if io_conllu.serialize(io_conllu.parse(o))==o else 'DIFF')"
   done
   ```
2. **Headless render smoke test — RUN IT IN BOTH SKINS.** `node --check` on the JS only validates *syntax*; it does not
   catch the failure mode this frontend is prone to (a temporal-dead-zone / `ReferenceError` at load
   that blanks the whole app — see "Frontend" below). Open `web/index.html` in headless Chrome over
   CDP, collect `Runtime.exceptionThrown` + console errors, assert `#doc .sblock` count, and cycle
   `conv` through stemma/arcs/tree/brackets/outline. With no bridge the page renders
   `web/js/dev-fixture.js`'s sentences, so every renderer is exercised. Healthy run = one block per
   fixture sentence in every notation (count them in the fixture rather than hard-coding the number —
   it was 5, is 8, and will move again), 0 runtime errors. **The first top-level throw aborts the script and masks later
   ones** — fix, re-run, repeat until clean; capture `.stackTrace.callFrames` to pinpoint the file.

   Do the whole thing **twice — bare and with `?platform=win`** — since the two load different
   stylesheets and different boot paths, and a Fluent-only regression is invisible from the macOS
   run. Assert the *right* kit loaded (read `document.styleSheets`), not merely that something did.
   Watch for **CSS 404s specifically**: several diagram metrics (`--arc-row`, `--arc-node-r`,
   `--arc-shoulder`, `--arrow`) are read with `parseFloat` and **no `||` fallback**, so a kit that
   fails to load doesn't blank the app — it silently fills the SVG with `NaN` geometry. Those four
   tokens are required of any kit, not optional.
3. **Real boot** — `timeout 8 .venv/bin/python -m app samples/english.conllu` should exit 124
   (i.e. it was still running), with every `web/js/**` module served HTTP 200.

### Automatic rebuild

`.claude/settings.json` wires a **Stop hook** (`.claude/hooks/rebuild-on-stop.sh`) that, once per
turn, kicks off `packaging/make_bootstrap_app.sh` in a detached background process whenever anything
under `app/`, `web/`, `packaging/` or `grammars/` is newer than `.claude/.last-build-stamp`. Output
goes to `.claude/last-build.log`; an in-flight build holds `.claude/.build.lock`. Don't run a build
in the foreground just to check your work — read the log.

The build is detached with **`os.setsid()`** (the hook re-executes itself with `--run-build` under a
new session), not `nohup`/`disown` — none of which start a session, so the build stayed in the
session's process group and was SIGKILLed with it when the harness reaped the turn. That is the same
reaping the "Launching the GUI" note above describes, and it failed **silently**: the log kept the
`rebuilding…` line the hook writes itself, no `build exited N` line ever landed, the lock was absent
(the child died before writing it), and `dist/` went stale for days while every turn still reported a
build had started. **Read the log for `build exited`, not just for the kickoff line** — and if you
ever see a kickoff with no exit line, suspect the detach before suspecting the build.

## Architecture

### The two halves and the document model

The **frontend owns the live document**; Python handles everything that touches the filesystem,
models, or the OS. A document is a plain list of *sentence dicts* — the same JSON-friendly shape on
both sides of the bridge, marshalled verbatim:

```
{sid, text, comments, translations, tokens[], mwt[], empties[], translit_scheme, stored, url, …}
  tokens[]  → {id, form, lemma, upos, xpos, feats, head (string), deprel, deps, misc, translit, …}
  mwt[]     → {from, to, form, _cols}       empties[] → {after, id, _cols}
```

`app/io_conllu.py` converts to/from `.conllu` **by hand** — every token line keeps its ten raw
columns as strings and every comment is preserved verbatim, because the `conllu` library
renormalises FEATS/DEPS/MISC and would break byte-stability. The normalisation policy (the only
permitted differences on save) is documented at the top of that module; don't widen it.

Layered annotation rides in existing CoNLL-U slots rather than new columns: glosses in MISC
(`Gloss`/`MSeg`/`MGloss`), transliteration in MISC `Translit`, deep relations in the `deprel`'s `@`
suffix, doc-level scheme choices in `# key = value` comments (`_META_KEYS`).

### Frontend (`web/`) — ordered classic scripts, one global scope

`web/index.html` is a ~190-line skeleton that loads the `iso639-3.js` data table,
`macos-kit/toast.js`, and **26 app modules as ordered classic `<script>` tags** (not ES modules),
plus the dev-only fixture. They share ONE page-global scope, so every top-level `let`/`const`/
`function` is visible across files with no `import`/`export` and no `window.*` threading.

Modules live in `web/js/`: **core/** (state, prefs, document, undo, scroll, init), **diagram/**
(diagram-core, -render, -wrap, -edit), **grid/** (grid, columns), **editing/** (edit-ops,
context-menu, validation), **io/** (bridge, formats, models), **lang/** (translit, translit-load,
readings, fontload),
**ui/** (sheets, wiring, find, colours). The `<script>` load order in `index.html` interleaves the
folders and is **not** derivable from the folder names — read it before moving anything.

**The one real hazard:** classic scripts do not hoist function declarations across files, so *eager
top-level code (an IIFE, a boot `requestAnimationFrame`, a bare call) must never forward-reference a
function defined in a later-loaded module* — it throws `ReferenceError` at load and blanks the app.
Put cross-module boot work in `js/core/init.js` (loads last, after every module is defined), and
guard eager forward calls with `if(typeof fn==="function")fn()`.

**Two chrome kits, one loaded.** `web/macos-kit/` (Liquid-Glass) and `web/win11-kit/` (Fluent) are
self-contained, reusable, and **share 150 token names** — that identity is the whole
design: `app.css` consumes tokens and needs no platform branching. Each has its own README. Keep
app-specific rules out of both; app overrides belong in `web/styles/app.css`, which loads after.

The choice is made by an **inline blocking `<script>` in `<head>`**, above the `app.css` link. It
stamps `<html data-platform>` from `?platform=` (design mode) or the UA, then `document.write`s that
kit's two `<link>`s. `document.write` and not `head.appendChild` **on purpose**: it inserts at the
script's own source position, so the kit stays ahead of `app.css` in the cascade however the file is
later reordered. Python gets no vote — it can only inject after load, far too late for a stylesheet.

`js/core/platform.js` loads **first** and reads that decision back off `data-platform`, so look and
behaviour cannot disagree. It owns `PLATFORM`/`IS_WIN`, `accel()` (macOS glyphs → `Ctrl+Shift+Z`),
`localiseAccel()` (one idempotent DOM sweep over `title=` and `.kbd` — new tooltips are localised
for free, so **don't** rewrite accelerators at call sites), `cmdKey`/`cmdAltKey`/`cmdOptKey`, and
`uiFont()`/`uiMono()` for the two consumers that need a resolved stack rather than a `var()`.

⚠️ **Modifier arithmetic.** macOS has five ⌘-families (⌘, ⇧⌘, ⌃⌘, ⌥⌘, ⌥⇧⌘); Windows has four. One
pair *must* collapse, and ⌃⌘/⌥⌘ do. Where that would make two live commands equal, the fix is a
per-item `win_accel` in `app/menu_spec.py` — **not** a change to `accel()`'s generic mapping. Three
exist (Move Token/Sentence → `Ctrl+Shift+arrow`, Toggle Grids → `Ctrl+Alt+Shift+G`). `menu_spec` has
an audit that reports unresolved clashes; run it after adding any shortcut.

**Which file does a chrome rule go in?** If the Fluent kit would need to restyle it, it is chrome
and belongs in the kits (title bar, pills, `.ctx`, `.sheet`/`.scrim`/`.toast`, `.statusbar`,
drawers). If it draws the treebank, it is shared and stays in `app.css` (`.sblock`, the five
notations, `table.grid`, relation colours). Moving a block between the two can **flip a specificity
tie** — that is not hypothetical, it already bit `.gmrow input.gm-feat` once.

`web/js/dev-fixture.js` seeds a sample `DOC` only when there's no bridge (browser design mode).
`packaging/make_*.sh` delete both the file and its `<script>` tag from the bundle, so the shipped
app carries no sample sentences. `samples/` is likewise repo-only — nothing at runtime reads it.

### Native shell (`app/__main__.py`, `app/api.py`) — pywebview threading invariants

`__main__.py` is the **platform-neutral** pywebview bootstrap (~386 lines): the window, crash
tracing, the close veto, and a `sys.platform` dispatch to `app/mac/` or `app/win/`. Menu actions call
the frontend's bridge-aware JS helpers so toolbar and menu share one code path.

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

`api.py` is `window.pywebview.api`: open/save/save-as/rename, parse/tokenize/sentencize, validate,
format detection + conversion, model list/download/remove, extras install, transliteration,
Wiktionary lookup, prefs and recent files (persisted in `state.json` under `paths.APP_DATA` —
`~/Library/Application Support/SUD Workbench` on macOS, `%LOCALAPPDATA%\SUD Workbench` on Windows).

**Launching with no file reopens the last document.** `Api.record_last_doc` writes `state.json`'s
`last_doc` from each window's `closed` handler — so it is the LAST WINDOW TO CLOSE that decides — and
`main()` adopts it when nothing was named on the command line. A window closed with no file records
`None`, which is how you ask for an empty one next time. `--empty` opts a command line out.

### Several document windows, one process

`_new_document_window` opens another document window **in this process** — `webview.create_window`
called from a non-main thread, the same way `api.py`'s `_open_window` already makes Help / About /
Model Manager. It replaced a `subprocess.Popen([sys.executable, "-m", "app"])` per window, and the
reason is native window tabbing: macOS groups NSWindows **within an application**, so process-per-
window could not have Merge All Windows / ⌃⇥ at any price. One `Api` per window, as before; what is
now shared is the menu bar, the model/parse caches and the single `state.json` writer.

⚠️ **Nothing may close over "the" window.** There is one NSMenu for N documents, so every command
resolves its target when it RUNS: `_key_pair()` reads `NSApp.keyWindow` against the `_WINDOWS`
registry, `build_menu`'s `js()` sends there, and `mac/shell.py` gets the same resolver through
`set_key_provider` for the items it owns natively (Open Recent, Clear Recent, About, and the menu
delegate's conditional show/hide). `Api._apply_menu` refuses to write the shared menu unless its own
window is key — every window's frontend pushes selection state, and a background one would otherwise
hide rows according to a selection nobody can see; the delegate re-applies the key window's cached
state (`force=True`) whenever a menu opens.

`_wire_menu` also injects a **Window menu** and hands it to `NSApp.setWindowsMenu_`, after which
AppKit maintains it: the window list, and the tab commands that the shared `tabbingIdentifier`
(`"sud-document"`, set in `_mutate`) makes available. Verified live: `addTabbedWindow_ordered_` —
the API Merge All Windows itself calls — puts two document windows in one tab group.

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

### Formats and conversion (`app/detect.py`, `app/convert.py`, `grammars/`)

Format is **detected** from the relation inventory, per sentence then per document: UD / SUD / mSUD.
SUD and mSUD are editable; UD is import/export only. Conversion runs grew (via `grewpy`) over the
`.grs` grammars vendored verbatim from surfacesyntacticud/tools under `grammars/` — see
`grammars/README.md` for the direction → strategy-name table (strategies are *not* uniformly
`main`). There is no universal SUD→mSUD grammar. Every conversion entry point takes an optional
`lang` (the frontend's `DOCLANG`, threaded through `Api.import_ud`/`export_ud_to`/`convert_format`);
`app/convert.py`'s `_LANG_GRAMMARS` prefers a vendored language-specific `.grs` over the universal
one when that (language, direction) pair is covered — most language/direction pairs aren't, and
fall back to the universal grammar. **The mSUD directions are held out of that table on purpose**
and always run the universal grammar: the language-specific mSUD grammars differ from it in how a
fused word is SPELLED, not in its syntax (they pass grew an explicit `"_"`/`" "` separator when
concatenating the merged pieces' Translit/Tone/MGloss, so one fused word came out spelled as
several), and the vendored files are verbatim upstream copies that a re-vendor would revert, so the
fix lives in the table rather than in them.

grew's OCaml backend is an **optional external prerequisite**: `app/convert.py` picks up
`vendor/grew/bin/grewpy_backend` if bundled (built by `tools/bundle_grew.sh`), else `~/.opam/*/bin`.
Without it the app still runs and edits SUD/mSUD — only UD import/export and conversion are
disabled, surfaced as a toast. Keep new features degrading that way rather than hard-failing.

### Parsing, models, and on-demand extras

`app/parse.py` runs two engines in-process: **SUD spaCy** packages (`en_sud_ewt`, …) and **Stanza
UD** via `spacy-stanza`, post-converted UD → SUD with grew and with multi-word tokens reconstructed
(`_reconstruct_mwt`). Model ids are engine-qualified — `sud:<package>` / `stanza:<lang>#<package>`.
No model → whitespace tokenisation. `app/parse_sud.py` is only a back-compat shim.

**MWT ranges come from FOUR places, in this order of trust.** Stanza *has* a multi-word-token
layer (`Token.words` / `Word.parent`, the expanded words carrying `start_char = None` because they
aren't substrings of the text), so its ranges are read straight off the pipeline. A spaCy model
whose tokeniser is a **custom callable** can publish its own via the `doc.user_data["mwt_ranges"]`
= `[(first, last, surface), …]` convention (+ `["source_text"]`), which `_mwt_from_doc` honours —
`ar_sud_padt`'s CAMeL clitic tokeniser is the first, and `scripts/ar_tokenizer.py` in the
**SUD-spaCy** repo is where it's written, so a change there needs the wheel repackaged. Failing
that, a tokeniser that publishes SOURCE SPANS (`doc._.src_spans`) has its ranges DERIVED from them
by `_src_span_layout` — an orthographic word is a run of tokens whose spans fall in one
whitespace-delimited chunk of the raw input, which is what a multi-word token IS; that is where
`sa_sud_vedic_ufal_dcs`'s ranges come from. Only when
nothing is published does `_reconstruct_mwt` **infer** ranges from spacing + the tagger's PUNCT
labels. That fallback is sound for spaCy's *rule-based* tokeniser and only there: it concatenates
component surfaces to build the range form, which is exact because a `Tokenizer` cannot emit a
non-substring token (`retokenize().split()` raises E117), whereas a custom tokeniser builds its Doc
from a word list and is under no such constraint. Absent key = infer; `[]` = a positive "no MWTs".

That E117 guarantee is about the range **form**, not about whether the run is an MWT at all, and in
a **spaceless script it is not** — there the segmenter's output *is* the word layer, so a run of
tokens with no space between them is a phrase. `_spaceless_script` therefore vetoes any inferred
range whose letters are all CJK/kana/Thai/Lao/Khmer/Myanmar/Tibetan, **per run** rather than per
document, so `我用 Python 编程` still treats its Latin run normally. This replaced a `len(chunks) < 2`
test that meant to do the same job but tested the *whole input* while the rule it guarded ran *per
chunk*: one space anywhere disarmed it and every CJK chunk was swallowed whole (`zh_sud_gsd_simp_trad`
and `lzh_sud_kyoto` reach the fallback — stock spaCy tokenisers publish nothing; the Stanza zh/ja
pipelines have no `mwt` processor and were never affected). Dropping the chunk test also let the
genuine single-chunk case through — a bare `don't` is one orthographic word, and an MWT.

`app/models_registry.py` lists/downloads models: SUD wheels from GitHub Release assets on
`SUD_REPO` (`SunflowerAI/sud-spacy-parsers`, overridable via `$SUD_MODELS_REPO`) pip-installed into
the running venv, and Stanza models into `paths.STANZA_DIR`.

**One model is not a download: `en_sud_ewt`.** It is pinned in `requirements-core.txt` (and
`requirements.txt`), so every environment that can run the app already has it — the app itself
depends on it, since `app/wiktionary.py` parses English definition prose no matter what language the
document is in. `models_registry.BUNDLED_SUD` names it; such a model still lists as installed but
can't be removed (`remove()` refuses, and the Model Manager row shows a "Bundled" pill in place of
its Remove button). Adding another bundled model means editing both requirements files AND that set.

`app/extras.py` is the reason `requirements-core.txt` exists alongside `requirements.txt`: the
portable bundle ships only the torch-free CORE set, and the heavy tiers (`stanza` ≈1.1 GB,
`japanese` ≈0.45 GB, `arabic` ≈0.3 GB) are pip-installed **on demand at runtime** into
`paths.EXTRAS_DIR`, which is added to `sys.path` at
startup. Every heavy import therefore sits behind a lazy `try: import` in `translit`/`parse` — a
missing tier must surface as an offer to install, never an exception.

### Language services

- `app/translit.py` — Latin transliteration routed per language: wiktra by default, dedicated
  backends for the context-dependent scripts (Arabic/Persian DIN 31635, Hebrew ISO 259, pypinyin,
  ToJyutping, Janome+pykakasi, hangul-romanize), uroman as fallback. Failures yield `""`, never
  raise; results are cached. Korean runs Hanja through the **vendored Unihan `kHangul` table**
  (`app/data/hanja_hangul.tsv`) into their Sino-Korean Hangul reading first — hangul-romanize maps
  syllables only, so mixed-script text would otherwise keep bare 漢字 — with 두음법칙 applied
  positionally rather than stored (`_dueum`). The `hanja` PyPI package was rejected: its metadata
  pins `pyyaml==6.0.1` and hard-requires pytest/coveralls, and its table is single-valued.
  `readings()` is the same engines asked for the CJK *alternatives* —
  ordered candidates in the scheme on display, `readings[0]` being what the app already shows, `[]`
  when the engine offers only one. It backs the token context menu's readings flyout, whose pick is
  authoritative (marked `_trPick`, so no later auto-fill pass overwrites it).
  `ambiguous()` names the languages whose romanisation is non-deterministic (those readings languages
  plus the unvocalised abjads). For those, the frontend makes the **Stored** transliteration
  click-editable on the transliteration row (`editStoredTransInline` in `js/lang/translit-load.js`), and
  `derive_scheme()` re-renders every Displayed scheme FROM that correction — by matching the stored
  string against the enumerated candidate readings and re-joining the matching one through the target
  engine, never by parsing a romanisation. It returns `""` where no derivation is honest (a
  character-keyed scheme such as General Chinese), and the row then falls back to romanising the form.
  A correction reopened from a file is recovered by comparison (`adoptStoredPicks`), since CoNLL-U has
  no "corrected by hand" flag.
  **A token's UPOS reaches the romanisers**, because a Han graph is heteronymic BY WORD CLASS as often
  as by anything else (行 = háng as a NOUN, xíng as a VERB; 數 = shù/shǔ/shuò as NOUN/VERB/ADV). It is an
  optional trailing argument on `readings`/`transliterate(_many)`/`orthography(_many)`, threaded from
  `Api.transliterate`/`token_readings`/`orthography` and sent by `js/lang/translit-load.js` and
  `js/lang/readings.js`. The rule is **reorder, never filter**, on **single-Han-graph tokens only** (past
  one graph the phrase dictionary is the authority and per-character POS is a guess) — so an absent,
  unknown or wrong tag costs ordering and never an option. `derive_scheme` is deliberately POS-BLIND: it
  recognises a value the user already typed, which is a different question. ⚠️ Everything on this path
  caches, and every one of those keys had to gain the tag — `_render_one`'s `(lang, scheme, text)`,
  `readings.js`'s `READINGS_CACHE`, and the four per-batch de-duplication maps in `translit-load.js`
  (keyed on the surface alone, they let whichever 行 was reached first decide the reading for all of
  them — the tag was sent and then silently discarded). Retagging a token runs `uposSyncTranslit`, which
  drops the automatic caches AND blanks MISC `Translit` so `annotateTranslitMisc` rewrites it — clearing
  `t.translit` alone does nothing, since `fromMisc` restores the old tag's string. It preserves `_trPick`,
  the opposite of `afterFormEdit`, which drops it: a hand-picked reading is a statement about the FORM,
  and a retag does not change the form. `regenTok` cannot stand in for any of this — it is a no-op with
  no parser model, and romanisation runs without one.
- `app/data/baxter_sagart.tsv` — Middle Chinese (Baxter) + Old Chinese (Baxter–Sagart), rebuilt by
  **`tools/build_baxter_index.py`** from the wikitext of Wiktionary's "Appendix:Baxter-Sagart Old Chinese
  reconstruction" (**CC BY-SA 4.0**, attribution in the file's own header). Six columns —
  `graph · pinyin · middle_chinese · old_chinese · pos · gloss`, one row per (graph, source entry).
  The hand vendoring it replaced had **collapsed a 4,082-entry WORD list into 4,330 characters**, keeping
  each graph's first entry and discarding the rest, so the 547 graphs with more than one Middle Chinese
  reading and the 312 with more than one Mandarin reading were unreachable — which is why the file grew
  without a single graph losing a reading (MC default rendering moved for 0 of 4,330). `pos` is a UD tag
  inferred from the English gloss and **left empty wherever the gloss licenses none** (16.9 % carry one);
  the canonical 破音字 whose glosses are bare English words naming no class (行 "rank, row", 樂 "music")
  are covered by `_POS_OVERRIDE`, a small hand-curated editorial dict in `app/translit.py` — kept OUT of
  the TSV precisely because a rebuild would revert a hand edit to it. The build takes `--retrieved
  YYYY-MM-DD` (required: reading the clock would make two builds of one input differ) and an optional
  `--src` for a saved copy, and is byte-reproducible — a rebuild from the same input is a no-op, so
  don't hand-edit the file. Pointed at the old 3-column file the loader yields 0 rows and
  `_scheme_available("lzh","mc")` goes False, i.e. a version mismatch degrades to *no* Middle Chinese
  rather than to a column-shifted wrong one.
  ⚠️ **pypinyin's `PHRASES_DICT` is keyed in SIMPLIFIED ONLY**, so every traditional document was denied
  the phrase-level disambiguation that dictionary exists for: 银行 read yínháng and 銀行 — the same word —
  yínxíng, and the whole-token rule offered five readings of a word that has one. `_t2s_chars` folds
  per CHARACTER (never `_t2s` over the string, whose phrase rules can change the length and shift every
  reading after it) and both the chosen syllable and the CANDIDATE LISTS are re-read through the fold.
  Two guards, because the fold is many-to-one (幹 乾 干 → 干): a folded syllable is accepted only where
  pypinyin lists it among the ORIGINAL graph's own readings, and the fold is skipped entirely for a
  single graph, which has no phrase to gain and is where that hazard bites. The gate is "two or more Han
  characters", NOT "the fold is a dictionary entry" — pypinyin matches phrases as SUBSTRINGS, so 银行卡
  reads yínhángkǎ off the 银行 inside it without being an entry itself.
- `app/langid.py` — fastText `lid.176`, model **vendored** at `app/data/lid.176.ftz` so detection is
  fully offline. Drives the document language on open.
- `app/sud_rules.py` — parses the vendored grew validator patterns
  (`grammars/validator/modules/relations.json`) once and evaluates the handful of error-level
  relation↔POS constraints directly, rather than invoking grew per candidate.
- `app/toolbox_import.py` (+ vendored `app/_toolbox_vendor.py`) — SIL Toolbox/FLEx interlinear →
  raw CoNLL-U, dependencies left unset.
- `app/wiktionary.py` — MediaWiki REST *definition* endpoint (not HTML scraping), for the
  right-click "Definitions of …" → MGloss pre-fill. Definition prose becomes gloss units through
  `_condense`, a real SUD parse of the English (which is why `en_sud_ewt` is a hard dependency):
  split at semicolons/commas, then keep the clause head plus its subj/comp/mod/udep/conj members and
  **delete any `mod` subtree that is not both one arc from the head and immediately beside it** —
  "directly modifies" means one `mod` arc, "immediately adjacent" means the phrase's span covers the
  slot just before or just after the head in the definition's own word order, and the phrase goes
  whole so no complement is left stranded. A **coordination starts a candidate of its own** (`conj`
  and `conj:coord` only — `conj:appos` is a second designation of one referent and `conj:dicto` is a
  disfluency, so neither cuts); `flat` deliberately does **not**, and that must stay so.
  Three shared rules live here and are reused verbatim by `app/apte.py`, so a picked Sanskrit sense
  reads like a picked English one: that condensation, `_decap` (a sense is lowercased at its LEADING
  capital only — mid-string capitals are proper names or Leipzig small-caps runs — and not at all for
  a PROPN token), and `_pos_matches` (a PROPN token also takes NOUN entries, since dictionaries file
  a name as a noun; deliberately not symmetric). **Both dictionaries filter in TWO TIERS**, and the
  second runs only where the first left nothing at all — an empty result is far more often a gap in
  the source than a real "this word is never a NOUN". Apte has always widened to every sense it
  holds; Wiktionary (`_pos_plausible`, ordered by `_head_rank`) widens only to what the page does
  not actually rule out: an entry with **no part-of-speech heading** (every Chinese sense) or one
  whose heading names **no UD class** ("Phrase", "Participle", "Contraction", "Han character" —
  `_WIKI_POS_TO_UPOS` maps none of them, so those senses were unreachable from every tagged token in
  every language), plus a condensed phrase whose re-parsed head disagrees, which at that tier only
  sorts. An explicit contrary heading still excludes, so a verb-only page still answers a NOUN token
  with nothing. A lookup that matched anything strictly is untouched by all of this.
  **A headword is queried in the spelling the wiki files it under, not the one the token carries**:
  Sanskrit in Devanagari (which a file may already be stored in, and may not — see the Sanskrit
  section below), Chinese in **TRADITIONAL** characters. en.wiktionary
  keeps every Chinese sense on the traditional page and gives the simplified one only a `{{zh-see}}`
  soft redirect — no senses, no POS heading — so 编程 404s from the definition endpoint while 編程
  answers, and *every* character that simplification changed was silently unglossable. OpenCC
  (already core, via `translit`'s Traditional orthography) folds the query; `_zh_see_target` chases
  the page's own `{{zh-see}}` pointer, read out of Parsoid's `data-mw`, when the fold lands on a
  spelling the wiki doesn't use (a variant pair such as 着/著, which OpenCC leaves alone) — and only
  on a lookup that has already come back empty, so the common case costs no extra request. Chinese
  senses arrive through the **`_definitions_glosses`** HTML path, not the definition endpoint: one
  Chinese section covers Mandarin, Cantonese and the rest, so the wiki files their senses under a
  shared "Definitions" heading and that endpoint, which keys off POS headings, emits nothing.
- `app/apte.py` — the SAME flyout for Sanskrit, from Apte's dictionary instead of Wiktionary.
  Headwords are indexed in **SLP1**, so the IAST this app stores is converted straight to SLP1 via
  aksharamukha (no Devanagari round-trip) and then *folded*, every homorganic nasal to anusvāra, on
  both the query and the index — the two Apte editions spell those differently (`aNga`/`aMga`) and
  a lemma may be written either way. `Api.definition_lookup` picks the source by language;
  `wiktionary_lookup` survives as a back-compat alias. Two paths, in order:
  - **`app/data/apte1957.tsv.xz` (1.8 MB), vendored, and what wins** — Apte's *revised and enlarged*
    1957 edition (CDSL code **AP**), preprocessed by `tools/build_apte_index.py` from the canonical
    18.5 MB source text `v02/ap/ap.txt` of `github.com/sanskrit-lexicon/csl-orig`, **CC BY-SA 4.0**
    (attribution rides in the file's own first line). Offline, and 77.5 k entries / 168 k senses.
    That source text marks structurally what the REST API below only renders as typography:
    citations are `<ls>` elements, word class and gender are `<lex>`, senses are `∙²` markers, a
    verb's class is `€n`, Sanskrit is `{#…#}`, and a compound is a record of its own rather than
    being nested inside its base entry. An entry-level column is written out, because `_local` needs
    it to prefer a main entry over a compound sub-entry that merely shares its headword (300 keys
    do); the column count is a contract between the script and that loader. **Upstream's own `<e>`
    level does not decide it** — upstream marks a compound `<e>2` only where the base entry also
    prints a `━Comp.` list, so `janman`, which prints none, filed all 35 of its compounds as `<e>1`
    sub-records and the build script's L-number merge poured them into `janman` itself. The script's
    `is_variant` decides sectionhood from the two headwords instead.
    Rebuild the file with the script; don't hand-edit it — the build IS byte-reproducible (verified),
    so a rebuild from the same `ap.txt` is a no-op.
  - **the live C-SALT REST API** (`api.c-salt.uni-koeln.de/dicts/ap90/restful`) — Apte's *first*
    1890 edition (**AP90**), the only Apte that API serves, reached ONLY when the vendored file is
    absent or unreadable, so a trimmed bundle still answers. Its TEI carries Apte's typography
    rather than structured fields, which is what the fallback parser reads.
  Measured over the 116 lemmas of `samples/brihat_jataka.conllu`, the switch takes citation residue
  from 7.0 % of glosses to 0.5 %, empty lemmas from 28 to 25, noun lemmas answered with a gender
  from 49/54 to 53/56, and the sweep from 226 s of network to 4.7 s of nothing.
  **Monier-Williams was evaluated and rejected** — C-SALT serves it too (`/dicts/mw/restful`) and
  CDSL has its source text, but one MW lookup downloads the base entry with every compound inside it
  (deva 690 kB, `mah` 1.77 MB), only 61 of those 116 lemmas hit its headword index, `mahat` is a bare
  cross-reference stub, glosses run about twice as long, proper names come out as `S3iva` rather than
  `Śiva`, and there is no per-entry URL for the flyout's "Open …" row. The measurements are in that
  module's docstring — read them before reopening the question.

- **Sanskrit is DIGRAPHIC IN STORAGE**, and that is the whole shape of its support.
  `sa_sud_vedic_ufal_dcs` takes raw **IAST or Devanagari** and puts back whichever it was given: its
  `sa_deva` component writes Devanagari into FORM/LEMMA with the IAST in `Token._.translit`/
  `_.ltranslit` (the UD convention), so a file's columns are in one script or the other and nothing
  in the file says which. `translit.sa_stored_script` reads it off the FORMS — a property of the
  file, which no display preference may contradict — and `Api.doc_script` serves it to the frontend
  as `DOCSCRIPT`. Four things read it: whether "Original" already shows a script (and so whether the
  IAST row beneath is worth drawing — `saTransRow`), which script a re-fused MWT form comes back in
  (`sandhi_join`), what ITRANS input converts TO (`itrans.convert`'s `script`), and whether the
  diagram's form editor edits the glyph or the row under it (`iastFormEdit`).
  The **Script** menu is therefore Original + **Latin (IAST)** + the 33 Brahmic scripts, with no
  "None" row: "Latin (IAST)" says the same thing and says it as a script. `_DANDA_IAST` routes the
  daṇḍa there rather than through aksharamukha, which renders `।` as `.` and would put a full stop
  in the middle of a verse.
  **CSL survives as a DISPLAY scheme and nothing else** (`app/sa_notation.py` + the vendored
  `app/_sa_sandhi_vendor.py`, upstream's own `scripts/external_sandhi.py`). It is a transliteration-ROW
  choice beside IAST: per token, how that token would be spelt with the junctions marked — `vartmā`
  shows `vartm"`, `iti` shows `êty`. Three things make it unlike every other scheme, and each is a
  reason it does NOT go through `_render_one`: it is computed **per SENTENCE**, because a mark records
  what happened BETWEEN two words and the same surface reads differently beside a different
  neighbour (so the (form, upos) deduplication every other pass uses would be actively wrong); its
  input is the **pausa** forms, i.e. MISC `Unsandhied=` where there is one and the FORM otherwise,
  since feeding a sandhied surface back through a sandhi generator applies the rules twice; and it is
  **not `stored`**, because MISC `Translit` is per token and context-free and could not hold it
  honestly. The one thing the vendored generator cannot do alone is the r-stem visarga — `punaḥ` +
  `janmanām` is `punar-`, not `puno-`, and only the LEMMA separates an r-stem from an s-stem — so
  `_rstem_visarga` substitutes the r-form before the junction, deferring to `translit._is_rstem` so
  the app has one answer about which stems those are rather than two. Verified against the sample's
  own former CSL text: identical on all four sentences.
  **What is gone is CSL as a STORAGE format.** The old model read and wrote Clay-Sanskrit-Library text —
  the sandhied surface with its coalescences *marked* (`vartm" â-punar-janmanām`) rather than
  written plainly — so no token form was a substring of `# text` and the frontend's literal match
  could not settle a single Sanskrit sentence. That cost a whole reversal engine (`app/sa_csl.py` +
  a vendored `desandhi_csl`), a bespoke alignment stage in `parse.token_spans` with its own
  verification thresholds, and a running-line gluing pass in `translit`. CSL is now strictly
  internal to the model, `# text` is ordinary sandhied text, and **stage 1 settles every Sanskrit
  sentence in both scripts** — verified over both samples. All of that machinery was deleted rather
  than kept "just in case"; `models_registry.DEPRECATED_SUD` hides `sa_sud_vedic_ufal_csl` so the
  app cannot offer a model whose output it can no longer read.
  ⚠ **The DCS representation is not the CSL one, and the difference is in the columns.** A token
  that is its own orthographic word keeps its **sandhied** surface in FORM, with the padapāṭha in
  MISC `Unsandhied=` (`kratuś` / `Unsandhied=kratuḥ`); only a token INSIDE a multi-word token is
  stored unsandhied. `parse._ext_misc` writes `Translit`/`LTranslit`/`Unsandhied` from the model's
  token extensions, and `samples/brihat_jataka.conllu` was converted into that shape (its MWT ranges
  had to be RE-DERIVED, not carried over — the file's own grouping had drifted from its own text,
  `paṭu-dhiyāṃ` being one word in the text and two ungrouped tokens in the columns).
- **A tokeniser may PUBLISH its own offsets** — `doc._.src_text` (the string it was handed) +
  `doc._.src_spans` (one half-open range per token), the same shape as the
  `doc.user_data["mwt_ranges"]` convention. `parse._published_spans` honours them for any model and
  prefers them to `token.idx`, **gated on `src_text` being the string we passed**: `# text` escapes
  its line breaks as the two characters `\n` and `bridge.js` restores real newlines on load, so
  feeding the escaped form would glue `\n` onto the next word and shift that token and every span
  after it. That gate is what turns the trap into a fall-through instead of a silently wrong
  decoration.
  ⚠ **Published spans may OVERLAP by one character**, and both sides must tolerate it: at a vowel
  coalescence the fused vowel of `vartmā` + `apunar-` genuinely ends one word and begins the next.
  `paintStext`'s order guard therefore allows `sp[0] >= last - 1` rather than `>= last`; refusing it
  would cost the second word its decoration at every coalescence in the text.
  `parse._src_span_layout` reads the same spans for **MWT ranges and SpaceAfter**, sitting between
  the published `mwt_ranges` and `_reconstruct_mwt`'s heuristic. Two things it gets right that the
  heuristic cannot: the range's FORM is the RAW SUBSTRING (the components of `vartmāpunarjanmanām`
  concatenate to `vartmaa`, which is not a word in any script), and SpaceAfter comes from the raw
  text rather than from `doc.text`, which is the tokeniser's own reconstruction and puts spaces
  where the input had none.
- `app/macron.py` (+ vendored `app/_la_macron_vendor.py`) — **Latin vowel length as a Script
  option**, `divisa` → `dīvīsa`. Restoring a macron is a display question, not an annotation one:
  the treebanks spell Latin without them and a file must round-trip byte-identically, so it feeds
  the Script layer exactly as the Indic scripts do — the running sentence and the diagram glyphs
  re-render while the grid, the input fields and the file keep the bare form. Nothing reaches MISC.
  It is why `orthography` grew `feats`/`lemmas` beside the `upos` the Chinese readings already
  threaded: the FORM alone reaches only the morphology-blind level, where nominative `Gallia` picks
  up an ablative macron.
  **The data is FETCHED, not shipped** — Morpheus (CC BY-SA 3.0 US) via the `macrons.txt` Johan
  Winge commits in latin-macronizer (GPL-3.0), ~4 MB on the wire, downloaded on demand into
  `APP_DATA` and compiled there in ~4 s. GPL restricts DISTRIBUTION, not USE, so a file the user's
  machine fetches from upstream and that never enters a build is not ours to license — the same
  posture `convert.py` takes toward the grew backend. ⚠ **Committing the built table is the standing
  temptation and is the one thing that turns a use into a distribution.** It rides `extras.TIERS`
  as a DATA tier (`module` instead of `pip`), so it appears in Manage Models with the torch tiers
  and shares their job/progress plumbing rather than growing a second install path.
  ⚠ **TWO TABLES CASCADE, and neither subsumes the other.** Measured, agreement with Alatius on
  gold morphology — the harvested SUD-spaCy LUT (if the user has built one) against Morpheus:

  | | harvest has the word | it does not |
  |---|---|---|
  | ITTB+PROIEL test | 98.23 % (92.1 % of tokens) | 52.46 % (7.9 %) |
  | Morpheus, same split | 93.98 % | 90.42 % |

  The harvest is near-perfect on its own vocabulary and close to a coin toss off it — upstream's
  own "OOV levels are 71 % of all errors from 8 % of tokens", stated the other way round. Morpheus
  covers 249,659 forms against 42,817. So `macronise` takes the harvest where it has a real entry
  (`L1`/`L2`/`L3`, never its suffix guess) and Morpheus for everything else: **97.61 %** in-domain
  against upstream's published 94.32 %, and on Perseus (classical poetry, where the harvest's OOV
  share goes 7.9 % → 23.8 %) **97.24 %** cascaded against 87.02 % harvest-alone and 95.75 % for
  Morpheus alone — which is what most users get, since the harvested table cannot be distributed.
  Morphology is matched through a nine-slot key (`_ud_key` / `_ldt_key`) that renders UPOS+FEATS and
  the Perseus/LDT nine-position tag into one alphabet, and lookup walks a LADDER of progressively
  blanker keys rather than demanding one exact match — the tagger is imperfect (`cano` came back
  ADJ, `fortes` VERB on a sample), and an exact key turns every mis-tag into a total miss. Each rung
  is precomputed at build time and only where it is decisive, so a rung never answers a question it
  cannot settle. `_PARADIGM` still applies on top: it is a statement about Latin, not a patch for a
  bad harvest.

Optional dependencies are always isolated behind a single module façade in `app/`, as those last
five do — follow that when adding another.

## Packaging (`packaging/`)

- **`make_bootstrap_app.sh`** — the canonical build (and what the Stop hook runs). Ships the app
  *source* plus a launcher; on first launch it builds a per-user venv from the user's **own**
  Python 3.12, because a Python linked against the current macOS SDK is what gets the native Tahoe
  chrome. CORE deps only.
- **`make_portable.sh`** — self-contained bundle with a relocatable standalone CPython 3.12 + CORE
  deps (~300–450 MB). No external venv needed, but the older SDK costs some native chrome.
- **`make_app.sh`** — thin launcher bundle that runs this project's `.venv`; dev convenience only.
- **`build_icons.sh`** — regenerates `AppIcon.icns` + `app/data/appicon.png` from
  `packaging/AppIcon.icon` (Icon Composer). Icon Composer exports full-bleed; the script applies the
  824-in-1024 macOS grid. Also drives `build_flat_icon.py`, whose flat masters feed **both** the
  Windows `.ico` and any future non-Apple platform.
- **`packaging/windows/make_win_app.py`** — the Windows counterpart to `make_bootstrap_app.sh`, same
  architecture (ship source + launcher, per-user venv from the user's own Python 3.12 on first
  launch, CORE deps only, heavy tiers on demand). Written in **Python, not PowerShell**, so it can be
  read and `--dry-run`'d from macOS — which is the only way it can be exercised at all here.
  `find_py.ps1`/`find_git.ps1`/`setup_venv.ps1`/`bootstrap.ps1` are the first-launch scripts;
  `sud-workbench.iss` is the Inno Setup installer (per-user, unsigned).

⚠️ **Each bundle ships only its own chrome kit**, and both builds fail if the other survives. For
macOS dropping `win11-kit/` is a size decision. For Windows dropping `macos-kit/` is a **licensing**
one: 12 of `mac-tokens.css`'s `--sf-*` masks are real SF Symbols rendered to base64 PNG, and Apple
licenses those for apps on *Apple* platforms. The Fluent kit supplies all 40 from MIT sources, so
nothing is lost. See `THIRD-PARTY-NOTICES.md`.

⚠️ **`wiktra` is a `git+` requirement and it is in `requirements-core.txt`** — so a first launch on
a machine without git fails inside pip. macOS almost always has git; Windows never does out of the
box, which is why `find_git.ps1` exists. It derives the need by *parsing* the requirements files, so
rewriting those URLs as archive URLs would switch the check off by itself.

## Windows: what has never executed

The Windows track was written from Microsoft's own MIT-licensed sources and **no part of it has run
on Windows**. Treat every item below as unverified, and say so rather than implying otherwise:

- **`app/win/` entirely** — DWM attributes, and whether Mica survives WebView2 at all (pywebview
  already asks DWM for it, so a failure there is WebView2 painting over it, not a missing call;
  Microsoft closed the equivalent Tauri report "not planned"). Mica is built to **degrade to an
  opaque themed background**, the same posture the codebase takes toward the grew backend — keep it
  that way. Also `IsNonClientRegionSupportEnabled`, `window.native.Handle.ToInt32()`, caption
  buttons, the registry accent (ABGR→RGB) and theme reads, `%LOCALAPPDATA%` resolution,
  `DETACHED_PROCESS`, `explorer /select,`.
- **The menubar against real keystrokes** — it renders and dismisses correctly headless, but Alt
  focus, mnemonics under a real IME, and the accelerator dispatcher have never met Windows.
- **All PowerShell** — no `pwsh` here, so not even a syntax check. `launcher.c` has never been
  compiled (no mingw-w64/zig on this machine; `brew install zig` switches the build from the VBS
  launcher to a real `.exe`). `iscc` has never run.
- **Fonts** — `system-ui` on Windows 11 probably resolves to plain Segoe UI, *not* Segoe UI Variable
  (Mozilla bug 1732404 is WONTFIX on exactly this), which is why the stack names the Variable faces
  explicitly. Unconfirmed in WebView2.

Two things genuinely **cannot** be reproduced in the web layer and should not be attempted there:
**Mica and background Acrylic**, which sample the desktop behind the window while `backdrop-filter`
only ever sees page content. They are the native layer's job.

## Code conventions

Both halves are written with **dense trailing/inline comments that record the *reason* for a
non-obvious line** — a rejected alternative, an OS quirk, a measurement, a guideline citation.
Several of those comments are the only surviving record of a subtle bug's diagnosis. Match that
density when editing, preserve existing rationale comments when moving code, and prefer extending
one to re-deriving it.

`pyrightconfig.json` points type checking at `.venv`.
