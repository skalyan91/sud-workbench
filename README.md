# SUD Workbench

A native-feeling desktop app (macOS, Windows, Linux) for viewing and editing dependency
treebanks in CoNLL-U, speaking **SUD** — Surface-syntactic Universal Dependencies, the
relation set introduced by [Gerdes, Guillaume, Kahane and
Perrier](https://surfacesyntacticud.org). Import (or type-and-parse) sentences,
see them as dependency diagrams, edit the underlying CoNLL-U rows in a
spreadsheet grid, watch the diagram update instantly, and save back to a
`.conllu` file.

All-Python **pywebview** shell wrapping a framework-free SVG + CSS frontend — no
bundler, no npm, no build step.

See [CHANGELOG.md](CHANGELOG.md) for what's new in each release.

## Install

**macOS, via Homebrew** (recommended — builds from source on your own machine, so nothing
gets Gatekeeper-quarantined):

```sh
brew tap skalyan91/sud-workbench
brew install --build-from-source sud-workbench
```

Launch it with `sud-workbench`, or `ln -s "$(brew --prefix)/opt/sud-workbench/dist/SUD Workbench.app" /Applications/`
to make it feel like a normal app — see [the tap's own
README](https://github.com/skalyan91/homebrew-sud-workbench) for why that one step has to
be manual. Requires `python@3.12`, installed automatically as a dependency.

**macOS, Windows, or Linux, without Homebrew:** grab the platform build from the [latest
release](https://github.com/skalyan91/sud-workbench/releases/latest) — a source-plus-
first-launch-bootstrap bundle for each platform, the same shape `packaging/` (below)
builds locally. Windows ships a payload directory rather than a signed installer (Inno
Setup output isn't produced yet); Linux ships a `.deb` and a Fedora `.rpm`.

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
whose backend is an OCaml binary installed with opam. The app fetches it itself,
on demand: Manage Models → "grew conversion backend" drives

```sh
opam remote add grew https://opam.grew.fr
opam install -y grewpy_backend
```

for you (bootstrapping `opam init` first if this machine has no opam root yet) —
see `app/grew_backend.py`. That needs `opam` itself already present (`brew install
opam` on macOS); nothing in this app installs opam for you. You can also run the
commands above yourself ahead of time. Either way the app finds `grewpy_backend`
under `~/.opam/*/bin` automatically. Without it, the app still runs and edits
SUD/mSUD; only UD import/export and format conversion are disabled (surfaced as a
toast) — and, since Stanza emits UD and this app stores SUD, every Stanza parser
is inert too until the backend is installed. The conversion grammars themselves
come from [surfacesyntacticud/tools](https://github.com/surfacesyntacticud/tools),
fetched on demand from inside the app (Manage Models → "UD conversion grammars")
rather than vendored — see `app/grammars.py`.

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
- **Attribute-Value Matrix (AVM)** — an HPSG-style bracketed matrix of a token's
  morphological features (FEATS), drawn below its POS tag, on by default in every
  notation. Composite features (agreement, TAM) group into their own sub-matrix;
  right-click a matrix or a single value to edit it, with an "Other…" flyout for
  values valid for the token's POS but not yet used in the file.
- **Diagram editing** — drag a node to reorder tokens, drag an edge onto a node to
  re-attach it; an attachment the SUD validator rejects outright won't stick. Dropping
  onto an **edge** rather than a node annotates instead of rewiring: onto a `conj` edge
  attaches as a shared dependent of the coordination (`Shared=Yes`), and a predicate and
  one of its arguments dropped onto each other — in **either direction**, the argument
  onto the predicate's edge or the predicate onto the argument's `subj`/`comp:obj`/
  `comp:obl` edge — records subject raising (MISC `Subject`) on the predicate. Both draw a
  dashed ghost edge and leave the real tree alone.
- **Per-sentence grids** — shared column widths, dropdowns for UPOS/Head/DepRel,
  `Key=Value` chip editing for FEATS/MISC, Excel-style edit expansion,
  token/sentence insert-delete-reorder with id renumber and head fix-up, MWT
  group/ungroup/split/flatten, live validation.
- **Merging tokens** (⌃⌘M) turns a run the tokeniser wrongly split into one. It is offered
  wherever the sentence writes those tokens **with no space between them** — in any
  language, so English `do` + `n't` merges just as a Chinese run does, and inside a
  multi-word token always. Across a space it is declined: there the split is a stray space
  in the file, which a `goeswith` relation annotates without destroying anything. The
  running sentence is therefore never rewritten by a merge. Grouping as a multi-word token
  is offered first and is the reversible choice; merging destroys the seam.
  **Inside a Sanskrit multi-word token the merge applies sandhi** — `sat` + `ādi` becomes
  `sadādi` — fused from the components' *unsandhied* forms, after which the word above them
  is re-fused from what is left.
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
- A SUD parse fills in **SUD's own MISC layer** as well as the ten columns, so the
  analyses the app already draws arrive with the parse instead of having to be added
  by hand: `Subject=SubjRaising`/`ObjRaising` on a raised predicate (the dashed ghost
  edge, and a `:xsubj` pair in DEPS on save), `Reported=Yes` on a verbatim-speech
  complement (the subtree steps off the line), and `Idiom=Yes`/`InIdiom=Yes` on the
  head and members of a SUD idiom. Which keys a model predicts is a per-language
  choice made upstream, and an absent key means *this model says nothing here* rather
  than *no*. Only a **full** parse takes them: a background re-parse of one token's
  fields keeps your own, because all four describe a tree that call doesn't adopt.
- **Retagging a token re-derives its features.** The word class is a choice the reader makes,
  so the parser is asked what this word's features are *as* that class — it holds a score for
  every analysis it knows, and the best-scoring one of the chosen class is taken. Tag `show`
  as a verb and `Number=Sing` becomes `VerbForm=Inf`. Where a model knows no analysis of that
  class the token is left as it was, rather than given invented features; and the lemma follows
  only for a model whose lemmatiser reads the word class, which none of the released SUD wheels'
  does (they predict the lemma from the word alone).
- **The morphemic gloss follows any change to the features**, whether you retag the word or edit a
  feature directly. Retag `man` as a verb and `man.SG` becomes `man.PST.PASS.PTCP`; set `Number=Plur`
  on a token glossed `dog` and it becomes `dog.PL`. Every UD feature value has exactly one glossing
  abbreviation, so a category the token carries but the gloss doesn't mention is a gap rather than a
  choice — the categories that go, go, and the ones that arrive are written at their proper slot.
  Only what you actually changed is touched: a gloss you have trimmed by hand stays trimmed until you
  edit that feature, and a morpheme boundary or an extra abbreviation of your own stays where you put
  it. A token that crosses between an open and a closed word class gains or loses its stem gloss too.
- **The parser's second and third choices are shown, not just its first.** Every model in the
  pipeline ranks a whole inventory and the editor used to draw only the winner; four places now
  show the rest of the ranking, for a SUD spaCy model:
  - **Start dragging a token** and every head the parser weighed for it lights up, in proportion
    to how likely it thought each one. Usually that is a single node — a parser really is certain
    which noun a determiner belongs to — and the spread appears exactly where you are deciding
    something: *with* in "I saw the man with the telescope" comes up **saw .78 / man .22**.
  - **Re-head a token and its relation follows**, chosen for the arc you just made rather than for
    the tree the parser would have built. A relation the validator calls an error on that pair of
    tags is never written; your own `@deep` feature survives.
  - **Retag a token and its features follow**, as above.
  - **Rows in the relation and POS menus fade by how likely each option is**, so the list reads as
    the ranking it always was underneath. Everything stays listed and clickable — overruling the
    model is the point of the menu — and a parent row is weighted by the whole of its submenu.

  A Stanza document is left alone: Stanza parses in UD and the app converts to SUD with grew, which
  moves heads, so its rankings describe a tree you are not looking at.
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
  Jyutping, Japanese kana → Hepburn, Korean) and uroman as a fallback. Sanskrit can be
  read in either of the two scripts a file may be stored in — IAST or Devanagari — and
  displayed in any of 33 Brahmic scripts or romanised, whichever it is stored in. Latin
  adds a **macronised** Script option, which restores the vowel lengths classical
  orthography leaves unwritten (`divisa` → `dīvīsa`) in the running sentence and the
  diagrams while the grid, the editors and the file keep the bare spelling. It reads the
  whole analysis, not just the word, so `Gallia` and `Galliā` come out right where only the
  case tells them apart, as do `malus` "bad" and `mālus` "mast". Multi-word tokens are
  macronised from their **components** (`multōs` + `que` → `multōsque`), since no lexicon
  lists a host with its clitic attached, and a breve you type is honoured rather than
  overruled (`intĕllectam` → `intĕllēctam`). The lengths come from the Latin model's own
  macroniser plus Morpheus data downloaded on first use (~4 MB) rather than bundled; the
  Script menu's own row takes you to Manage Models when it isn't there yet, and the option
  becomes usable the moment the download finishes.
  The four **ornamental** scripts — Rañjanā, Soyombo, Bhaiksuki and Siddhaṃ — are drawn at 2×
  size (every other Brahmic script gets a uniform 1.5×), since their decoration is denser again
  and isn't resolvable at the size an everyday script reads at, and the running line then meets
  the sentence number at the top of the letters rather than at the baseline. A script line also
  joins a consonant-final word to the next one, as a Brahmic script does: `tad api` is drawn
  तदपि even though the romanisation beneath it keeps the space.
- **Correcting a stored transliteration** — where the romanisation is genuinely
  non-deterministic (Han heteronyms, Japanese kanji readings, and the unvocalised
  scripts such as Arabic and Hebrew, whose short vowels are not written), clicking the
  transliteration row edits the **stored** value — what MISC `Translit` keeps — and the
  displayed row is then re-rendered from the correction: correct 行 to `háng` and the
  Zhuyin row reads ㄏㄤˊ, the Gwoyeu Romatzyh row `harng`. **Middle Chinese** is derived from the
  廣韻's own phonological categories where Baxter and Sagart's word list has nothing to say, so
  菩薩 reads `bu sat` rather than nothing — about 19,500 characters answer instead of 4,300. The CJK readings flyout writes
  the same value, and a correction survives a re-parse, a change of displayed scheme,
  and a save-and-reopen.
- **Arabic/Persian vocalisation** works the same way as Latin macronisation: a dedicated
  transliteration row shows the vocalised (diacritic-marked) form — sourced from KaamelDict
  for Persian — and is click-to-edit when the automatic vocaliser gets it wrong. Multi-word
  tokens vocalise from their components, the same way Latin multi-word tokens macronise.
- **Glossing** — lexical (MISC `Gloss`) and morphemic (`MSeg`/`MGloss`) tiers render
  under the tokens, with an editor for the Feature=Value → Leipzig-abbreviation
  mapping. The two morphemic rows are one sequence read twice, and they stay in step:
  correcting a lemma re-derives `MSeg` and carries `MGloss` across with it, and typing a
  hyphen into `MSeg` splits a gloss that divides cleanly into a lexical and a grammatical
  part (`walk.PST` over `walk-ed` becomes `walk-PST`). Right-click a glossing abbreviation for the
  other values of its feature — pick `DAT` over `GEN` and the token's FEATS follow. In Latin,
  `ae` and `oe` count as single letters when the segmentation picks a boundary (`Troi-ae`, not
  `Tr-oiae`). The right-click menu on a token can look the word up — on Wiktionary, or,
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
      grew_backend.py   fetches the grewpy_backend OCaml binary on demand (drives opam)
      sud_rules.py      relation↔POS constraints, read from the fetched grew validator
      grammars.py       fetches the UD↔SUD conversion grammars on demand (surfacesyntacticud/tools)
      parse.py          parser engines: SUD spaCy + Stanza UD→SUD (+ MWT), sentence split
      parse_sud.py      backwards-compat shim over app.parse
      models_registry.py  available/installed models, GitHub-release + Stanza download
      extras.py         on-demand install of the optional tiers (Stanza/JP/Arabic/Latin macrons)
      translit.py       Latin transliteration, routed to a backend per language
      macron.py         Latin vowel lengths (display only) — a façade over the Latin model's own
                        la_macronise component; fetches the Morpheus data on demand
      langid.py         offline language identification (vendored fastText lid.176)
      wiktionary.py     Wiktionary definition lookup (MediaWiki REST API)
      apte.py           Apte Sanskrit-English dictionary lookup (vendored index; C-SALT fallback)
      toolbox_import.py SIL Toolbox/FieldWorks interlinear → CoNLL-U
      paths.py          Application Support locations (models, caches, extras, grammars)
      data/             vendored data: lid.176.ftz, apte1957.tsv.xz, FEATS inventories,
                        romanisation tables
tools/                  build-time helpers (Apte index generation)
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

### Resetting an install

Everything the installed app keeps per user lives in one directory:

```
~/Library/Application Support/SUD Workbench/
├── venv/               the per-user environment, built once on first launch
├── site-packages/      the heavy on-demand tiers (stanza/torch, japanese, arabic)
├── stanza_resources/   downloaded Stanza models
├── cache/              release listings and similar
└── state.json          recent files, preferences, the last document
```

Nothing here is precious — every part is rebuilt or re-downloaded on demand — so the reset for
almost anything is to delete the relevant subdirectory and relaunch. Quit the app first.

| symptom | reset |
|---|---|
| **Stanza models parse nothing.** Stanza emits UD and this app stores SUD, so every Stanza parse runs the grew conversion grammar. A build from before `vendor/` was shipped has no grew backend, and the models are inert however cleanly they downloaded. Manage Models now says so at the top of the Stanza group. | Replace the app itself — the backend rides inside the bundle, not in the venv: `rm -rf "/Applications/SUD Workbench.app" && cp -R "dist/SUD Workbench.app" /Applications/`. Then relaunch (parser pipelines are cached for the life of the process). |
| **a parse never marks subject raising, reported speech or idioms.** Those come from components the SUD parsers only gained later, and the wheels kept their version number — so pip sees the one already installed as satisfying the pin and an environment built before them never refreshes. | For a downloaded model: **Remove** it in Manage Models, then download it again. For the bundled `en_sud_ewt` (which Manage Models won't remove): `rm -rf ~/Library/Application\ Support/SUD\ Workbench/venv` and relaunch. |
| the Stanza tier itself looks broken | `rm -rf ~/Library/Application\ Support/SUD\ Workbench/site-packages` → reinstall the tier from Manage Models |
| **Stanza fails with `RuntimeError: Numpy is not available!` (or the model just does nothing), on an Intel Mac.** PyTorch's last macOS x86_64 build (2.2.2) predates the NumPy 2.0 ABI; a venv built before `requirements-core.txt` pinned `numpy<2` on Intel resolved a current, incompatible numpy instead — and reinstalling only the Stanza tier can't fix it, because that numpy is CORE's, loaded on every document open (`app/langid.py`'s language auto-detect), well before Stanza is ever touched. | `rm -rf ~/Library/Application\ Support/SUD\ Workbench/venv ~/Library/Application\ Support/SUD\ Workbench/site-packages` and relaunch, then reinstall the Stanza tier from Manage Models. (On Apple Silicon this pin is a no-op — current torch there is numpy-2-safe, so this specific failure shouldn't occur; a NumPy report on Apple Silicon has a different cause.) |
| a Stanza model is corrupt | `rm -rf ~/Library/Application\ Support/SUD\ Workbench/stanza_resources` |
| **the Latin “With macrons” row stays unavailable, or macronises nothing.** Two separate things have to be present: the Latin model (which *is* the macroniser) and the Morpheus vowel lengths it reads. The lengths live in the model's own cache, outside Application Support, so a clean slate there does not touch them. | Download `la_sud_ittb_proiel_perseus` in Manage Models, then install the **Latin macrons** tier in the same window. To force the data to be re-fetched: `rm -rf ~/.cache/sud-spacy` (or `$LA_MORPHEUS_TABLE`, if you set one). |
| **the window's corners are not fully rounded** (and other native chrome looks a version behind). AppKit reads the `LC_BUILD_VERSION` of the binary the app runs *inside* — the interpreter — and holds an older-SDK app at the previous appearance. | Check what the venv was built from: `otool -l "$(readlink ~/Library/Application\ Support/SUD\ Workbench/venv/bin/python)" \| awk '/LC_BUILD_VERSION/{f=1} f&&$1=="sdk"{print "sdk",$2;exit}'`. If it is behind your macOS major version, `brew install python@3.12`, then force a rebuild (below). |
| **forcing a different Python 3.12** | `rm -rf ~/Library/Application\ Support/SUD\ Workbench/venv` and relaunch. The first-launch setup runs again, and `find_py()` picks the newest-SDK interpreter it can find. To name one instead, run the bundle's own launcher from a terminal so the variable reaches it (`open -a` does not pass the environment): <br>`SUD_PYTHON=/opt/homebrew/bin/python3.12 "/Applications/SUD Workbench.app/Contents/MacOS/SUD Workbench"` |
| a completely clean slate | `rm -rf ~/Library/Application\ Support/SUD\ Workbench` (this also forgets recent files and preferences) |

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
