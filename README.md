# SUD Workbench

A native-feeling macOS desktop app for viewing and editing dependency treebanks
in CoNLL-U, speaking **SUD** (Surface-syntactic Universal
Dependencies) relation set. Import (or type-and-parse) sentences, see them as
dependency diagrams, edit the underlying CoNLL-U rows in a spreadsheet grid,
watch the diagram update instantly, and save back to a `.conllu` file.

All-Python **pywebview** shell wrapping a framework-free SVG + CSS frontend — no
bundler, no npm, no build step.

## Run

The app runs on **Python 3.12** (spaCy/stanza/torch wheels are unreliable on 3.14):

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app                 # or: .venv/bin/python -m app samples/english.conllu
```

Set `SUD_DEBUG=1` to open the web inspector.

`requirements.txt` is the full development set. The shipped app installs only
`requirements-core.txt` (the torch-free set) and pulls the heavy optional
stacks — Stanza/torch, Japanese romaji dictionaries, Arabic morphology — on
demand at runtime, into `~/Library/Application Support/SUD Workbench/site-packages`.

### grew (UD ↔ SUD ↔ mSUD conversion) — external prerequisite

Format conversion and UD import/export use [grew](https://grew.fr) via `grewpy`,
whose backend is an OCaml binary installed with opam:

```sh
brew install opam && opam init -y
opam remote add grew https://opam.grew.fr
opam install -y grewpy_backend
```

The app finds `grewpy_backend` under `~/.opam/*/bin` automatically, or uses a
bundled copy at `vendor/grew/bin/` if `tools/bundle_grew.sh` has built one (which
is how a packaged app runs conversions on a machine with no opam). Without either,
the app still runs and edits SUD/mSUD; only UD import/export and format conversion
are disabled (surfaced as a toast). The conversion grammars are vendored from
[surfacesyntacticud/tools](https://github.com/surfacesyntacticud/tools) under
`grammars/` — see `grammars/README.md`.

## What works now

### Document and I/O

- **CoNLL-U I/O** — `app/io_conllu.py` reads/writes by hand, preserving all ten
  columns, comments, multi-word-token ranges (`3-4`) and empty nodes (`1.1`).
  **Open → save with no edits is byte-stable** (see the round-trip test below).
- **File menu** — New, New Window (a detached second process), Open, Open Recent,
  **Append** (adds the sentences in a file without changing the save target), Insert
  Text, Save, Save As, Rename. Unsaved changes show as "– Edited" in the title bar,
  and closing asks first.
- **Import UD** (converted to SUD on the way in), **Export as UD**, and **Import
  Toolbox** — SIL FieldWorks/Toolbox interlinear text, with a dialog for mapping
  each marker to a CoNLL-U field.
- **Session state** — recent files, per-file reading position, and display
  preferences persist in `~/Library/Application Support/SUD Workbench`.

### Annotation

- **All notations** — stemma (token/category nodes, projection lines), hierarchy,
  arcs (with wide-diagram line wrapping), brackets (with wrapping, interrupter arcs
  and MWT ties), outline — with relation colouring, the Show/Hide drawer, Merge
  punctuation, semantic arrows, extended (ghost) relations, RTL.
- **Diagram editing** — drag a node to reorder tokens, drag an edge onto a node to
  re-attach it; an attachment the SUD validator rejects outright won't stick. Dropping
  onto an **edge** rather than a node annotates instead of rewiring: onto a `conj` edge
  attaches as a shared dependent of the coordination (`Shared=Yes`), and a predicate and
  one of its arguments dropped onto each other — in **either direction**, the argument
  onto the predicate's edge or the predicate onto the argument's `subj`/`comp:obj`/
  `comp:obl` edge — records subject raising (FEATS `Subj`) on the predicate. Both draw a
  dashed ghost edge and leave the real tree alone.
- **Per-sentence grids** — shared column widths, dropdowns for UPOS/Head/DepRel,
  `Key=Value` chip editing for FEATS/MISC, Excel-style edit expansion,
  token/sentence insert-delete-reorder with id renumber and head fix-up, MWT
  group/ungroup/split/flatten, live validation.
- **Undo/redo** across the whole document, **Find** (⌘F) over sentence ids, text and
  transliterations, and **Export Diagram as SVG** for the selected sentence — always in
  light-mode colours and self-contained, so the file reads the same wherever it's opened.
- A freshly parsed sentence draws its diagram **incrementally**, deepening the tree one
  level at a time, so the row fills in as the layout runs instead of staying blank.
- **Relation colours** are customisable (five categories, light and dark
  independently) and otherwise follow the macOS system accent colour.

### Formats

- **UD · SUD · mSUD** — the status-bar **Format** pill shows the detected format and
  opens a menu to import/export UD and convert between editable formats. Detection
  is automatic from the relation inventory; UD is import/export only, SUD and mSUD
  are editable.
- **mSUD** (morphological SUD) — morph-internal `/m` relations render dashed and
  italicised across all notations, the grid and relation menus offer the `/m`
  relation set, and an mSUD document down-converts to SUD/UD (mSUD → SUD → UD).
- There is no automatic SUD → mSUD conversion — up-conversion to the morph level
  isn't mechanical, and no universal grammar exists. The Format menu instead offers
  **Annotate as mSUD**, which relabels the live document into morph-annotation mode
  so the `/m` relations become available, rewriting nothing and calling no grammar.
  Convert to SUD reverses a bare relabel locally; a document carrying real morph
  annotation takes the grew route. The mode isn't stored in the file, so it becomes
  permanent once the first `/m` relation is annotated.

### Parsing

- **Insert Text** (⌘T, or the toolbar +) takes a block of text and adds one sentence per
  sentence it finds. On an empty document it offers a **language** to parse as, listing
  the languages a parser is installed for first and picking the best model for the one
  chosen; on a document that already has sentences the language is the file's. Any number
  of **parallel texts** in other languages can be entered alongside: each is sentencised
  in its own language and the n-th sentence lands as the n-th block's translation. The
  main field can also be switched off, so a submitted text supplies **translations only**,
  continuing after the last sentence already translated in one of those languages.
- Pick a model in the toolbar; Insert Text then parses in-process:
  - **SUD spaCy** models (`en_sud_ewt`, `zh_sud_gsdboth`, …) from Sunflower AI.
  - **Stanza UD** models via `spacy-stanza`, post-processed UD → SUD with grew;
    multi-word tokens (e.g. French *du* = de + le) are preserved.
  - No model → whitespace tokenisation.
- The **English SUD parser (`en_sud_ewt`) ships with the app** — every other model
  is a download. Beyond parsing English text, it is what condenses each Wiktionary
  definition into a glossable phrase, whatever language the document is in.
- **Manage Models** dialog (toolbar cube button, or Format → Manage Models…) —
  lists SUD models from the GitHub release repo and a curated set of Stanza UD
  languages, with training-set sizes, background downloading with a progress bar,
  and removal (the bundled parser shows as "Bundled" and isn't removable).
- **Automatic language identification** on open (fastText `lid.176`, vendored, so it
  works offline) sets the document language and picks the matching parser.

### Language layers

- **Transliteration** — a trio of status-bar pills selects the script the tokens are
  rendered in (**Script**), the romanisation shown in the transliteration row
  (**Displayed**), and the scheme written to MISC `Translit`/`LTranslit` (**Stored**).
  Backends are routed per language: wiktra by default, with dedicated engines for the
  context-dependent scripts (Arabic and Persian DIN 31635, Hebrew ISO 259, Pīnyīn,
  Jyutping, Japanese kana → Hepburn, Korean) and uroman as a fallback. Sanskrit can
  be converted into Indic scripts per token.
- **Correcting a stored transliteration** — where the romanisation is genuinely
  non-deterministic (Han heteronyms, Japanese kanji readings, and the unvocalised
  scripts such as Arabic and Hebrew, whose short vowels are not written), clicking the
  transliteration row edits the **stored** value — what MISC `Translit` keeps — and the
  displayed row is then re-rendered from the correction: correct 行 to `háng` and the
  Zhuyin row reads ㄏㄤˊ, the Gwoyeu Romatzyh row `harng`. The CJK readings flyout writes
  the same value, and a correction survives a re-parse, a change of displayed scheme,
  and a save-and-reopen.
- **Glossing** — lexical (MISC `Gloss`) and morphemic (`MSeg`/`MGloss`) tiers render
  under the tokens, with an editor for the Feature=Value → Leipzig-abbreviation
  mapping. The two morphemic rows are one sequence read twice, and they stay in step:
  correcting a lemma re-derives `MSeg` and carries `MGloss` across with it, and typing a
  hyphen into `MSeg` splits a gloss that divides cleanly into a lexical and a grammatical
  part (`walk.PST` over `walk-ed` becomes `walk-PST`). The right-click menu on a token can look the word up — on Wiktionary, or,
  for Sanskrit, in Apte's *Practical Sanskrit-English Dictionary* (revised ed. 1957,
  vendored from the Cologne digitisation, so it works offline) — and pre-fill the
  morphemic gloss from a chosen definition.
- **Translations** — `# text_LANG` comments round-trip, and a drawer chooses which
  languages to show.

### Shell

- Unified Liquid-Glass title bar with the traffic lights placed in-content, a
  macOS-style proxy-title block (filename plus language · transliteration · scheme,
  right-click for the folder path), grouped toolbar pills with three display modes,
  real SF Symbols rendered natively, full-screen and system-accent awareness.
- Native secondary windows for Help, About and Manage Models.
- Packaged as **SUD Workbench.app** with a `.conllu`/`.conll` file association, so
  it can be the default viewer for treebank files (see Packaging below).

## Next iteration (☆)

- **mSUD editing** — a dedicated "split a word into morphs" affordance and word-band
  reconstruction in the diagrams. Annotate as mSUD now provides the way in, and mSUD
  is detected, rendered, cell-edited and down-converted; deeper structural editing is
  still deferred.
- **Code signing / notarisation** — the bundles are currently unsigned, so a first
  launch needs the Gatekeeper right-click-Open dance.

## Layout

```
app/  __main__.py       pywebview bootstrap, application menu, and the AppKit/PyObjC
                        work behind the native chrome (unified title bar, drag regions,
                        SF Symbols, accent/full-screen/focus observers, Dock icon)
      api.py            js_api bridge: open/append/save/rename, parse/tokenize/sentencize,
                        import/export UD, Toolbox import, convert_format, models, extras,
                        transliteration, Wiktionary lookup, validate, prefs, recent files
      io_conllu.py      byte-stable CoNLL-U read/write
      model.py          id renumber + head/cycle/root validation
      detect.py         auto-detect UD / SUD / mSUD from the relation inventory
      convert.py        grew (grewpy) conversion: ud↔sud, msud→sud, msud→ud
      sud_rules.py      relation↔POS constraints, read from the vendored grew validator
      parse.py          parser engines: SUD spaCy + Stanza UD→SUD (+ MWT), sentence split
      parse_sud.py      backwards-compat shim over app.parse
      models_registry.py  available/installed models, GitHub-release + Stanza download
      extras.py         on-demand install of the heavy optional stacks (Stanza/JP/Arabic)
      translit.py       Latin transliteration, routed to a backend per language
      langid.py         offline language identification (vendored fastText lid.176)
      wiktionary.py     Wiktionary definition lookup (MediaWiki REST API)
      apte.py           Apte Sanskrit-English dictionary lookup (vendored index; C-SALT fallback)
      toolbox_import.py SIL Toolbox/FieldWorks interlinear → CoNLL-U
      paths.py          Application Support locations (models, caches, extras)
      data/             vendored data: lid.176.ftz, apte1957.tsv.xz, FEATS inventories,
                        romanisation tables
tools/                  build-time helpers (grew bundling, Apte index generation)
grammars/               vendored surfacesyntacticud .grs conversion grammars + validator
web/  index.html        DOM skeleton; loads the modules below as ordered classic scripts
      js/core/          state, prefs, document render, undo, scroll, init (loads last)
      js/diagram/       the SVG renderers: core, render, wrapping, drag-editing
      js/grid/          the CoNLL-U grid and its column sizing
      js/editing/       token/sentence operations, context menus, validation
      js/io/            the pywebview bridge, format conversion, model manager
      js/lang/          transliteration and glossing
      js/ui/            sheets, wiring, find, colours
      macos-kit/        reusable macOS chrome (tokens, title bar/pills/menus CSS, toast)
      styles/           app.css, fonts.css        fonts/  bundled Noto script fonts
packaging/              .app bundle builders + icon pipeline
tools/bundle_grew.sh    bundle grewpy_backend + its dylib closure into vendor/grew/
samples/                example SUD / mSUD .conllu — REPO ONLY, never bundled into the app
```

The web frontend can also be opened directly in a browser for design work: with
no `pywebview` bridge `web/js/dev-fixture.js` seeds a handful of sentences to draw
with, and Import/Save simply hint that they need the desktop app. That fixture is
**stripped from the app bundle** by the packaging scripts — both the file and its
`<script>` tag — so the shipped app carries no sample sentences.

The modules in `web/js/` are ordered **classic scripts** sharing one global scope,
not ES modules, so there are no imports to maintain — but eager top-level code must
not call a function defined in a later-loaded module. Cross-module boot work goes in
`js/core/init.js`, which loads last.

## Packaging

```sh
packaging/make_bootstrap_app.sh    # → dist/SUD Workbench.app   (the usual build)
```

`make_bootstrap_app.sh` ships the app source plus a launcher; on first launch it
builds a per-user venv from the user's own Python 3.12, because a Python linked
against the current macOS SDK is what gets the native Tahoe chrome. Core deps only.

`make_portable.sh` instead bundles a relocatable standalone CPython 3.12 (~300–450 MB,
nothing to install, at the cost of some native chrome), and `make_app.sh` builds a thin
launcher around this project's own `.venv` for development. `build_icons.sh`
regenerates the icon assets from `packaging/AppIcon.icon`.

## Checks

There is no test suite; three checks stand in for one.

**Byte-stable round-trip** — the hard I/O requirement:

```sh
for f in samples/*.conllu; do
  .venv/bin/python -c "from app import io_conllu
o=open('$f',encoding='utf-8').read()
print('$f', 'STABLE' if io_conllu.serialize(io_conllu.parse(o))==o else 'DIFF')"
done
```

**Render smoke test** — load `web/index.html` in headless Chrome and collect runtime
exceptions while cycling through every notation. `node --check` validates syntax only;
it does not catch the load-time `ReferenceError` that the ordered-script layout invites,
and which blanks the whole app.

**Boot** — `timeout 8 .venv/bin/python -m app samples/english.conllu` should exit 124
(i.e. it was still running), serving every `web/js` module.

### Normalisation policy

The only ways a save may differ from the input: token/MWT/empty-node columns are
re-joined with a single TAB; an empty grid cell is written as `_`; an edited
`sent_id`/`text` (or one of the managed `# key = value` metadata comments) updates
or is appended; a sentence that had no `sent_id` gets a generated one; a trailing
newline is ensured. Canonical CoNLL-U is unaffected.
