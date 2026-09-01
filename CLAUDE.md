# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

**This file is the map and the rules. The measurements, the rejected alternatives and the
bug diagnoses live in `docs/notes/`** — one note per subsystem, indexed below. Before
changing code in a subsystem, read its note; it is usually the only surviving record of why
the code is shaped the way it is.

## What this is

A native-feeling desktop app for viewing and editing dependency treebanks in CoNLL-U, speaking
**SUD** — Gerdes/Guillaume/Kahane/Perrier's Surface-syntactic Universal Dependencies relation set
(surfacesyntacticud.org; NOT this project's or Sunflower AI's own — a claim to that effect was
committed here in error and corrected, don't reintroduce it) — plus **UD** import/export and
**mSUD**. All-Python **pywebview** shell (`app/`) wrapping a framework-free SVG + CSS frontend
(`web/`) — **no build step, no bundler, no npm**. `README.md` has the user-facing feature list;
this file covers how to work on it.

**Two platforms, one document renderer.** macOS is tuned against the macOS 26 "Tahoe" Figma kit
and the HIG; Windows against the official Windows UI Kit and — far more usefully — the
**MIT-licensed WinUI 3 theme resources** (`microsoft/microsoft-ui-xaml`), which state as
machine-readable XAML what Apple only writes in prose. Values in `web/win11-kit/` are *derived
from those files*, not eyeballed: if you change one, cite the dictionary it came from. Anything
Microsoft does not publish (ThemeShadow's blur/offset/alpha, Mica's recipe, the shell
caption-button size, the focus-ring thicknesses) is marked `APPROX` in place — **don't quietly
promote a guess to a fact.**

The macOS build is the one that has actually run. **Everything Windows-specific is written to
spec and untested** — see `docs/notes/packaging.md`.

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
2. **Headless render smoke test — run it in both skins.** `node --check` validates *syntax* only;
   it does not catch the failure mode this frontend is prone to (a temporal-dead-zone
   `ReferenceError` at load that blanks the whole app). Open `web/index.html` in headless Chrome
   over CDP, collect `Runtime.exceptionThrown` + console errors, assert the `#doc .sblock` count,
   and cycle `conv` through stemma/arcs/tree/brackets/outline. With no bridge the page renders
   `web/js/dev-fixture.js`'s sentences, so every renderer is exercised. Healthy run = one block per
   fixture sentence in every notation (count them in the fixture rather than hard-coding the
   number — it was 5, is 8, and will move again), 0 runtime errors. **The first top-level throw
   aborts the script and masks later ones** — fix, re-run, repeat until clean; capture
   `.stackTrace.callFrames` to pinpoint the file.

   Do the whole thing **twice — bare and with `?platform=win`** — since the two load different
   stylesheets and different boot paths, and a Fluent-only regression is invisible from the macOS
   run. Assert the *right* kit loaded (read `document.styleSheets`), not merely that something did.
   Watch for **CSS 404s specifically**: several diagram metrics (`--arc-row`, `--arc-node-r`,
   `--arc-shoulder`, `--arrow`) are read with `parseFloat` and **no `||` fallback**, so a kit that
   fails to load doesn't blank the app — it silently fills the SVG with `NaN` geometry. Those four
   tokens are required of any kit, not optional.
3. **Real boot** — `timeout 8 .venv/bin/python -m app samples/english.conllu` should exit 124
   (i.e. it was still running), with every `web/js/**` module served HTTP 200.

⚠️ **Chrome is not sufficient on its own for anything measuring text.** The two engines disagree
about `getComputedStyle` inside a zoomed SVG subtree, and WebKit does not shape supplementary-plane
complex text in SVG `<text>` at all. Add a WKWebView probe (`webview.create_window(hidden=True)` +
`evaluate_js`, ~15 lines) — and note that **`requestAnimationFrame` never fires in that hidden
window**, so conclude nothing from the resting geometry of a rAF-sized element. See
`docs/notes/frontend.md` and `docs/notes/diagram-rendering.md`.

### Automatic rebuild

`.claude/settings.json` wires a **Stop hook** (`.claude/hooks/rebuild-on-stop.sh`) that, once per
turn, kicks off `packaging/make_bootstrap_app.sh` in a detached background process whenever
anything under `app/`, `web/` or `packaging/` is newer than `.claude/.last-build-stamp`
(`grammars/` is deliberately not watched — it's fetched on demand into `APP_DATA`, not part of the
source tree). Output goes to `.claude/last-build.log`; an in-flight build holds
`.claude/.build.lock`. Don't run a build in the foreground just to check your work — read the log.

The build is detached with **`os.setsid()`** (the hook re-executes itself with `--run-build` under
a new session), not `nohup`/`disown` — neither of which starts a session, so the build stayed in
the session's process group and was SIGKILLed with it when the harness reaped the turn. That is
the same reaping the "Launching the GUI" note above describes, and it failed **silently**: the log
kept the `rebuilding…` line the hook writes itself, no `build exited N` line ever landed, the lock
was absent (the child died before writing it), and `dist/` went stale for days while every turn
still reported that a build had started. **Read the log for
`build exited`, not just for the kickoff line** — and if you ever see a kickoff with no exit line,
suspect the detach before suspecting the build.

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
permitted differences on save) is documented at the top of that module; **don't widen it.**

Layered annotation rides in existing CoNLL-U slots rather than new columns: glosses in MISC
(`Gloss`/`MSeg`/`MGloss`), transliteration in MISC `Translit`, deep relations in the `deprel`'s `@`
suffix, doc-level scheme choices in `# key = value` comments (`_META_KEYS`).

### Where the code lives

**Frontend** (`web/`) — `index.html` is a ~190-line skeleton loading **26 app modules as ordered
classic `<script>` tags** (not ES modules) that share ONE page-global scope. Modules sit in
`web/js/`: **core/** (state, prefs, document, undo, scroll, init), **diagram/** (-core, -render,
-wrap, -edit), **grid/**, **editing/** (edit-ops, context-menu, validation), **io/** (bridge,
formats, models, scores), **lang/** (translit, translit-load, readings, fontload), **ui/**. The
load order interleaves the folders and is **not** derivable from the folder names — read it before
moving anything.

**Backend** (`app/`) — `__main__.py` (platform-neutral pywebview bootstrap) dispatching to
`mac/`/`win/`/`linux/`; `api.py` (the bridge); `io_conllu.py`; `menu_spec.py`; `detect.py` +
`convert.py` + `grammars.py` (formats); `parse.py` + `models_registry.py` + `extras.py` +
`generic_models.py` + `glosses.py` (models);
`translit.py`, `macron.py`, `apte.py`, `wiktionary.py`, `vidyut_data.py`, `langid.py` (language
services); `gloss_align.py` + `vectors.py` (glossing).

## Subsystem notes

Read the note before editing the subsystem.

| Note | Covers |
| --- | --- |
| [`frontend.md`](docs/notes/frontend.md) | Module layout hazard, batched multi-sentence insert, CSS `zoom` vs the measurement APIs, wheel ownership, scroll anchoring |
| [`editing.md`](docs/notes/editing.md) | Selection rules, caret in a contenteditable, retag → FEATS → MGloss propagation, re-heading, merge gating, Sanskrit sandhi fusion |
| [`parser-scores.md`](docs/notes/parser-scores.md) | `analysis_scores`: recovering a ranking from a transition-based parser, the three relation tiers, cache keying, menu-row weighting |
| [`diagram-rendering.md`](docs/notes/diagram-rendering.md) | Arc fanning across a wrap, `belowGap()`, WebKit's SMP shaping fault and the `foreignObject` swap, the daṇḍa satellite, seam marks |
| [`scripts-and-fonts.md`](docs/notes/scripts-and-fonts.md) | The foreign-word mark, ornamental scripts at double size, script-switch ordering, hanging scripts, the `--script-*` tokens |
| [`chrome-kits.md`](docs/notes/chrome-kits.md) | The two kits and how one is chosen, `js/core/platform.js`, modifier arithmetic, which file a chrome rule belongs in |
| [`native-shell.md`](docs/notes/native-shell.md) | pywebview threading deadlocks, menu-wiring retry, several windows in one process, on-disk file watching, why there is no window tabbing |
| [`formats-conversion.md`](docs/notes/formats-conversion.md) | UD/SUD/mSUD detection, the fetched grew grammars and backend, what DEPS is read for on import |
| [`parsing-models.md`](docs/notes/parsing-models.md) | The two engines, the four sources of MWT ranges, SUD's own MISC layer, `AUTOREGEN`, Reset Parse, the model registry and extras tiers, **custom models** (one embedding row each) and the **pipeline arms** |
| [`language-services.md`](docs/notes/language-services.md) | Transliteration per language, Latin macrons, the Baxter–Sagart and Tshet-uinh tables, Apte and Wiktionary, Sanskrit's digraphic storage |
| [`glossing.md`](docs/notes/glossing.md) | `gloss_align.py`: the UD-space tree edit distance, the semantic term and its calibration, retrieval fallbacks, what triggers a re-gloss |
| [`packaging.md`](docs/notes/packaging.md) | macOS/Windows/Linux/Nix builds, the Homebrew tap, per-bundle chrome-kit stripping, and what has never run on Windows |

## The rules that outrank convenience

Break one of these and the failure is silent or misdiagnosed. Each is expanded in the note named.

- **Byte-stability is the hard I/O requirement.** Open → save with no edits must be byte-identical.
  Don't widen `io_conllu`'s normalisation policy.
- **Eager top-level code must never forward-reference a later-loaded module** — classic scripts
  don't hoist across files, and the throw blanks the whole app. Put cross-module boot work in
  `js/core/init.js`; guard eager forward calls with `if(typeof fn==="function")fn()`.
  → `frontend.md`
- **Only a click or a rectangle selects a node.** No command may make a selection on the reader's
  behalf — no `pick()` on any menu path. → `editing.md`
- **Every head change goes through `afterHeadEdit`; every edit goes through `markDirty`.** Those
  are the funnels the automatic passes hang off, which is what makes them true of *any* attribute
  rather than of the edit sites someone remembered. → `editing.md`, `glossing.md`
- **The zoom is CSS `zoom`, so `getBoundingClientRect` and `offsetTop` are in different units.**
  Convert with `cssZoomOf(el)` / `visualFontPx(el)` — **not** `FS`. → `frontend.md`
- **A measurement must follow the paint.** Font string, magnification, weight and tracking are
  published together or the slot is measured in a face the glyph is not drawn in. →
  `scripts-and-fonts.md`
- **Add a menu command once, in `app/menu_spec.py`** — titles, JS calls, accelerators, icons and
  visibility flags all live there, and macOS, Windows and the bridge all read it. Run its clash
  audit after adding any shortcut. → `chrome-kits.md`
- **Nothing may close over "the" window**, and no pywebview `create_*_dialog`/`evaluate_js` may be
  called directly from a main-thread AppKit callback. Both produce intermittent hangs. →
  `native-shell.md`
- **Optional dependencies sit behind a single module façade in `app/`**, and a missing tier
  surfaces as an offer to install, never an exception. → `parsing-models.md`
- **Degrade, don't hard-fail.** No grew backend means UD import/export and conversion are disabled
  with a toast — the app still runs and edits SUD/mSUD. Keep new features degrading that way. →
  `formats-conversion.md`
- **Don't vendor what isn't licensed to ship.** The grew backend (CeCILL), the `.grs` grammars (no
  declared licence), Morpheus (CC BY-SA) and the vidyut kosha are all **fetched on demand onto the
  user's own machine**. Each bundle ships only its own chrome kit, and for Windows and Linux that
  is a licensing rule, not a size one (`macos-kit/` carries real SF Symbols). →
  `packaging.md`, `formats-conversion.md`
- **DEPS is not part of SUD**, and this app does not write it. A UD import reads it for the two
  constructs the app already models, then clears it. → `formats-conversion.md`
- **Silence is the preferred failure for annotation.** An honest blank beats an invented feature
  set, a guessed gloss, or a 14 %-accurate retrieval in an annotator's document. →
  `glossing.md`, `parsing-models.md`
- **An absent key means "this model says nothing here", never "no".** → `parsing-models.md`
- **A visible tier with no value draws `TIER_EMPTY`, and every tier row gates on the ROW, never on the
  value.** The reserves have always asked whether the row exists (`belowReserveH(hasTr(t), …, show.pos, …)`);
  a draw site that asks whether THIS token has something skips a step the reserve already paid for and
  silently lifts everything below it out of line with its neighbours. **The relation LABEL is the standing
  exception** — no reserved slot, and the edge under it already carries the gesture that sets it, so an empty
  one draws nothing. Tried both ways; that is the settled one. → `diagram-rendering.md`
- **What the generic parser's lexical channel is fed is decided in `app/glosses.py`, once.** The live parse
  and the custom-model fitting run ask the same question of the same two tiers from opposite sides of the
  bridge; a second copy of the rule in JS would fit a row under one reading of "the gloss" and parse it under
  another. → `parsing-models.md`
- **A custom model is one embedding ROW of one shared generic wheel, never a wheel of its own.** The
  pipeline is loaded once and every stored row written into it; a parse selects its model by stamping
  `Doc._.tb_lang` before the first component runs. Anything keyed on the package name alone (a cache,
  a preference, a listing) will confuse two custom models for each other. → `parsing-models.md`
- **The generic wheel is CC BY-NC-SA, so it is fetched, never bundled** — the same rule that keeps the
  bundled English parser on CC BY-SA. → `parsing-models.md`, `packaging.md`
- **A pipeline arm the model cannot do is struck in `parse.py`, not only greyed in the options bar**,
  and **switching one off makes every arm that READS it inert too**. Otherwise a model with no tagger
  returns its morphologiser's guess in a column the app then saves as annotation. **"Reads" is what
  the component's encoder DECLARES** — the `attrs`/`feats`/`upos_rows` of its own resolved config —
  **never pipeline order**, which is a bound on what a component could read and not a statement of
  what it does: taking it for one got four edges wrong on `en_sud_ewt_gum` alone. →
  `parsing-models.md`
- **An arm you switch off is one the annotator has taken over**, so it still SATISFIES everything
  that reads it — the parse reads theirs. Never blank, overwrite or ignore a column the caller handed
  in. This is the only ensemble here worth building: the annotator's own FEATS are worth +14.95 LAS
  on held-out Basque, where a second parser is worth nothing. → `parsing-models.md`
- **FEATS is an ADDITIVE column under the generic wheel.** A generic or custom model may add a feature
  to a token and may never change or drop one — its morphology is either a cross-lingual guess or a
  lossy re-derivation of the annotator's own file, and neither may have the last word on a cell
  somebody has already answered. A monolingual parser deliberately still may, so the gate is the
  PACKAGE (`_feats_additive`). The frontend sends `prior_feats` on every pre-tokenised call; Python
  alone decides whether it binds. **The RETAG is the one gesture that may delete a feature**, and only
  the ones the new class cannot carry (`clearFeatsForUpos`, saying in a toast what it dropped) — the
  difference is whose gesture it was. **And the wheel may not write a COMMA VALUE** — 7.1 % of its
  labels carry one, every one learned from another of its 80 treebanks (`VerbForm=Fin,Inf` is
  Afrikaans), so `_drop_multivals` drops the feature rather than picking a branch. A monolingual
  wheel's own comma value stays, as does one the reader typed. → `parsing-models.md`, `editing.md`
- **The generic parser reads UPOS as INPUT and refuses a Doc without it** (`sud_require_upos`; it
  used to invent one instead — `DET ADJ DET ADV DET ADV DET` for "The cat sat on the mat."). Set the
  classes on the Doc BEFORE the first component, drop the `upos` arm where there are none and let the
  cascade take the components out of the run. A caller who SUPPLIES the classes satisfies the arm; a
  scorer that cannot get them refuses rather than ranking a category-unknown reading. →
  `parsing-models.md`

## Code conventions

Both halves are written with **dense trailing/inline comments that record the *reason* for a
non-obvious line** — a rejected alternative, an OS quirk, a measurement, a guideline citation.
Several of those comments are the only surviving record of a subtle bug's diagnosis. Match that
density when editing, preserve existing rationale comments when moving code, and prefer extending
one to re-deriving it. The same rule governs `docs/notes/`: **extend a note, don't replace what it
records.** When a note's finding is superseded, say so in place and keep what it supersedes.

`pyrightconfig.json` points type checking at `.venv`.
