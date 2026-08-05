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

⚠ **A MULTI-SENTENCE INSERT IS A BATCH, and the per-DOCUMENT work must not be paid per sentence.**
`__insertPastedText` raises `RENDER_HOLD` around its loop, which `inInsertBatch()` (js/io/bridge.js)
reads as "we are part way through a paste". `doInsert` then skips what is not per-sentence work —
`paintTr` (fillTranslit + fillOrtho) walks the WHOLE DOC and awaits a bridge round-trip, so run once per
inserted sentence it is O(sentences × document) for an answer only correct at the end — along with the
per-sentence toast, scroll and eager pick. All of it runs once, after the hold unwinds. Measured, 40
sentences into a 300-sentence document: **1.31× faster**, transliteration bridge calls **81 → 1**. The
**parse is batched too**: `Api.parse_texts` → `parse.parse_many` answers for the WHOLE paste in one
bridge call, with the engine's own batching underneath — spaCy through `nlp.pipe`, and Stanza with a
SINGLE grew UD→SUD conversion across the list, which its worker pool runs in parallel (a call per
sentence pays the dispatch serially and leaves every worker but one idle). Measured: backend alone, 40
English sentences **86 ms → 42 ms (2.05×)**, byte-identical output; the whole insert path **3.94×**,
bridge calls **162 → 3**. `insertParsed` splices one batched answer in — doInsert's parsed branch with
every bridge call and every per-sentence render/pick/toast removed. The per-sentence path stays the
fallback, unchanged, and is taken with no bridge, no model, a single sentence, or a call that throws or
returns a mismatched length: doInsert's two-phase reveal (tokens first, tree after) earns its keep when
the reader is waiting on ONE sentence and has nothing to offer a batch. The viewport then lands on the FIRST inserted sentence (`alignBlockTop(start)`), not the last —
the loop walks `index` forward, so the reader used to be shown the end of what they had just added.
NB `pick(i,0,true)` cannot do that scroll: it aims at the token's GRID ROW, which does not exist with
the grids hidden, and silently no-ops.

⚠ **The zoom is CSS `zoom`, and it splits the measurement APIs in two.** `.sblock{zoom:var(--fs)}` is
how ⌘+/⌘− scales the document — a real scale on the used values, so a block laid out 714px wide paints
1142px at FS=1.6. `getBoundingClientRect`/`clientX`/`deltaY` report **viewport px** (zoom applied);
`offsetTop`/`clientHeight`/`scrollTop`/`getComputedStyle` lengths/canvas `measureText` report the
element's **own px** (unzoomed) — probed and identical in headless Chrome and in the shipping
WKWebView, which also both expose `element.currentCSSZoom`. Any expression mixing the two families
must convert, and `cssZoomOf(el)` (`js/core/document.js`) is the factor: `currentCSSZoom`, with an
ancestor walk as the fallback. **Not `FS`** — that is right only inside `.sblock`, and these callers
walk ancestor chains that leave it (`#doc` is never zoomed). Two paths were silently multiplying by
it: `scrollNearest` nudged inner scrollers by a rect-derived delta (at FS=0.6 it under-shot the last
grid row by 34px and left it off screen) and `caretAtPoint` matched a viewport-px click against
unzoomed `measureText` widths (at FS=1.6 a click on boundary 5 of a ten-character field landed at 9).
`--cap-dia`/`--cap-grid` and `AVAILW` were already divided by FS and are unchanged. The block snap and
the wheel chain/native decision were re-measured at 0.6/1.0/1.6 and are zoom-correct as they stand.

⚠⚠ **AND THE TWO ENGINES DISAGREE ABOUT `getComputedStyle` INSIDE A ZOOMED SUBTREE — on SVG only.**
For HTML they match and both report the AUTHORED length (probed: a 20px input with 11px padding
inside `zoom:1.6` reads back 20/11 in each). For **SVG text** — the diagram's own glyphs — WebKit
reports the authored size **divided by the zoom** and Chrome reports it plain: a 14px form row at
FS=1.6 reads 8.75px in the shipping WKWebView and 14px in Chrome, and 23.33px at FS=0.6. The inline
editors multiplied by FS, which is right in Chrome and lands exactly back on the *unzoomed* size in
WebKit — the reported "token input fields still show at the original size" while the diagram under
them was drawn at 160 %. `cssLenScale(el)` **probes** the factor (a hidden `font-size:100px` element
placed in the element's own zoom context; Chrome answers 100, WebKit answers 100/z) rather than
branching on engine or namespace, and `visualFontPx(el)` is what the two `applyFont`s now call. **This
is why the headless-Chrome smoke test is not sufficient on its own for anything measuring text**: run
the WKWebView probe too (a `webview.create_window(hidden=True)` + `evaluate_js`, ~15 lines).

⚠ **ONLY A CLICK OR A RECTANGLE SELECTS A NODE.** No command may make a selection on the reader's behalf, and
`setAsRoot` (js/editing/edit-ops.js) was the one that did: reached from the right-click menu — or from the
relation chooser's `root` row, which delegates to it — it moved `sel` onto whatever token was under the cursor,
so a menu invoked on one token silently deselected another. Re-rooting is structural and says nothing about what
the reader is looking at; only the re-render remains. This is the same rule the menus themselves already follow
("NO pick() ON ANY OF THOSE PATHS", js/editing/context-menu.js).

⚠ **A CONTENTEDITABLE HAS NO `selectionStart`, WHICH IS WHY MINTING A CHIP THREW THE CARET TO THE HEAD OF THE
CELL.** Committing a FEATS/MISC segment calls `serialize()`, which writes the token and re-renders — and
`preserveScroll` puts focus back with a bare `nc.focus()` and then `setSelectionRange`, which exists on
INPUT/TEXTAREA and nothing else. Focusing a contenteditable DIV collapses the caret to its first position. The
caret cannot be carried as a character offset either (the field is a mixed run of atomic `.fpill` chips and
zero-width anchors, all rebuilt from the model), so `pillCaretGet`/`pillCaretSet` (js/grid/grid.js) carry the
CHIP COUNT before the caret plus the offset within its text run — both facts about the serialised value, which
is exactly what the re-render reproduces — and the un-minted text rides along on the same terms as
`preserveScroll`'s `fd.val` for a plain cell.

⚠ **A DELETION RE-FILTERS THE MGloss DROPDOWN; IT DOES NOT DISMISS IT.** Backspace is how a reader corrects a
mistyped abbreviation, and closing the list on the keystroke that narrows the typo made the feature unusable for
the case it is for. `mglossOpenAC` is re-run on any `delete*` inputType while the menu is open on that field; it
closes itself when the run empties or nothing matches, which is the only dismissal a deletion should cause.
**Right-clicking an abbreviation** opens the other values of ITS feature (`glossAbbrMenu`,
js/editing/context-menu.js) — read off `EFF_FEATS_GLOSS` so a custom Gloss Mapping shows up unprompted, ordered
by `UD_FEATS` (Sing before Plur, Nom before Acc), and the pick runs `mglossSyncFeats` so the gloss and the FEATS
move together exactly as a hand edit's commit does. Morphemic tier only: a lexical Gloss's capitals are not a
paradigm slot. Which run was clicked is its INDEX among the `.glabbr` nodes, not its text — two identical
abbreviations in one gloss would otherwise be ambiguous. ⚠️ Its rows pass `opt:true`, and every checkable list in
this file must: `.ctx .ck` is absolutely positioned at the menu's 12px inset and ONLY `.ctx button.opt`'s
`padding-inline-start:25px` moves the label clear of it. Without it the row's leading padding is 7px and the tick
paints straight under the first letter — drawn, and invisible, which is how it was first reported.

⚠ **⌘⌫ AND THE MENU ARE ONE COMMAND.** `window.deleteSent` (js/io/bridge.js) is the range-aware one:
it reads `blockRange()`, confirms "Delete N sentences?" and falls back to `delSent(curBlock())`. The
keyboard path in `js/grid/columns.js` went through `deleteSel` (js/core/undo.js), which called
`delSent(sel.s)` — one sentence, and not even the focused one, since `extendBlockRange` moves CURBLOCK
and leaves the token selection where the range STARTED. Selecting five blocks and pressing ⌘⌫ therefore
deleted the FIRST of them. `deleteSel` now keeps the token half (genuinely its own) and delegates the
sentence half. Two copies of one command drift, and these had.

⚠ **A DROP MUST AWAIT ITS COMMIT BEFORE RESTORING THE SELECTION.** `commitDrop`
(js/diagram/diagram-edit.js) captures the selection and puts it back, so dragging a token onto another
does not light up a token the reader never selected. Three of the four commit functions are **async** —
`setDiagramHead` awaits `depIsError` before writing anything, and its trailing `pick()` of the moved
token therefore runs a microtask later — so a synchronous `finally` restored first and the commit's own
pick put it straight back. It looked fixed and did nothing. `commitDrop` is now `async`, `_commitDrop`
RETURNS each branch's promise rather than discarding it, and the restore is awaited into last place.
⚠ A test with no bridge cannot catch this: `depIsError` returns immediately without one, closing the
very gap the bug lives in. Drive it with a stubbed `valid_deprels` that actually awaits.

⚠ **A RETAG RE-DERIVES THE FEATURES FOR THE CLASS THAT WAS CHOSEN.** `parse_pretokenized` used to be handed
the FORMS and nothing else, so the model re-analysed a sentence it had already analysed and returned the same
answer: after retagging 行 NOUN→VERB the FEATS and lemma that came back were still the noun's, and the re-parse
was a no-op wearing the look of a refresh. `reparseTokenFields` now sends the reader's own UPOS list, and
`_force_upos` CONSTRAINS the model's answer rather than replacing it — spaCy's `Morphologizer` predicts UPOS and
FEATS as one joint label (`POS=NOUN|Case=Nom|…`), so the best-scoring label whose `POS=` is the reader's is the
model's own account of that word AS a verb. Measured: `show` NOUN→VERB moves `Number=Sing` → `VerbForm=Inf`. A
class the model knows no label for leaves the token exactly as tagged — an honest silence, never an invented
feature set. It runs BETWEEN the morphologizer and the lemmatiser so everything downstream sees the chosen class.
⚠️ **The LEMMA will not move on the released wheels**, and that is a property of them, not of this code: all of
them ship an `EditTreeLemmatizer`, whose model predicts an edit tree from the token vector and never reads
`token.pos_`. A wheel with a rule-based `Lemmatizer` gets it for free. `opts.upos` (the split-token path) is the
one caller that wants the parser's own class instead, and it says so by asking for it.

⚠ **AND THE MGloss FOLLOWS, BECAUSE `retargetGlossForFeatsChange` IS NOW SYMMETRIC.** It retargets a value that
CHANGED and drops a feature that was REMOVED; the third case, inserting one that was ADDED, used to be left out on
purpose — "never invent an abbreviation for a feature that had none before", on the reasoning that a category
absent from the gloss was absent by choice. **That reasoning does not survive `FEATS_GLOSS` becoming total**:
measured, **201 of the 205 UD feature values carry exactly one abbreviation**, and the four that do not (`Typo`,
`Foreign`, and SUD's own `Shared=Yes`/`No`) are bookkeeping that is deliberately unglossable. With a one-to-one
mapping an absent abbreviation for a feature the token HAS is a gap, not a choice — and the asymmetry showed as
one: a retag from NOUN to VERB dropped `SG` with `Number` and put no `INF` in its place, and setting `Number=Plur`
on a token glossed `dog` left `dog`, with no later edit able to introduce the category either.

⚠️ **SCOPED TO WHAT THE EDIT TOUCHED, which is the difference between this and a rebuild.** Every feature whose
value moved ends up glossed — added, or changed-but-missing, which are the same gap — while a feature the edit did
not touch is left alone, so a gloss the annotator has trimmed stays trimmed until they edit that very feature.
Measured: with `Tense=Past` present but `PST` deleted by hand, a Number edit gives `walk.PL` and leaves it deleted;
editing Tense itself gives `walk.SG.PRS`, which is what a fresh compose gives. Toggling `Foreign` still moves
nothing, exactly as the comments at its call sites promise, because that feature has no abbreviation to insert.

⚠️ **ADDITIVE, NOT `composeMGloss`.** A wholesale rebuild is what Task B recorded as reshuffling a settled
abbreviation order and losing a hand-placed morpheme boundary; `mglossAddFeats` inserts at the `MGLOSS_FEAT_ORDER`
slot and touches nothing else, so `walk-SG` → `walk-3SG.PRS.IND.FIN` keeps its hyphen and `walk.SG.EMPH` keeps an
EMPH no FEATS implies. **Measured byte-identical to a fresh `composeMGloss` — 0 mismatches over 8 real retags**
(VERB↔NOUN, ADJ→NOUN, DET→PRON, AUX→VERB, VERB→ADJ, FEATS pairs taken from the model itself) and over 9 value
edits. Idempotent. `regenTok(si,tok,{regloss:true})` now adds only `mglossReglossLexical` on top, since the word
class is the one thing a FEATS change can never move.

⚠️ **Person and Number are written FUSED** (`3SG`, not `3.SG`), so agreement must arrive as ONE token — three
cases, because the half already in the gloss keeps its own slot: neither present → one fused insert; one present →
fuse ONTO it where it stands. Inserting the missing half beside its partner is what produced `walk-3.SG` from a
hand-segmented `walk-SG`, i.e. the one shape the rest of the app never writes.

⚠️ **The LEXICAL half follows too, because whether a token has one is a question about its word class.** Every
builder writes a stem gloss into MGloss only for an OPEN class (`GLOSS_ON && !UPOS_LEIPZIG_ABBR[upos]`) — a
closed-class tag already carries its own Leipzig abbreviation and its meaning IS that abbreviation. Neither
retarget can cross that line (FEATS says nothing about a stem; the UPOS retarget only moves the prefix), so
VERB→AUX left the stem stranded behind the newly-prepended prefix (`dog.SG` → `AUX.dog.SG`) and AUX→VERB left the
token with no stem where a fresh parse gives one. Now `AUX.3SG.PRS.IND.FIN` and `have.3SG.PRS.IND.FIN`. An
EXISTING lexical part is never rewritten — only supplied where the class now wants one and there is none.

⚠ **A RE-HEADED TOKEN'S RELATION IS RE-ASKED OF THE PARSER**, in `afterHeadEdit`
(js/editing/validation.js) — already the one funnel every head change passes through, so a new path
gets it for free. A relation describes an EDGE, and moving the edge's other end can leave it describing
nothing (a `subj` dragged under a noun). The head-0 ⟺ `root` rule is what follows with certainty;
`headSyncDeprel` supplies what needs evidence — and **adopts the parser's relation only where the
parser independently chose the same head**. `parse_tokens` returns a whole tree, its own heads
included, so its label describes ITS attachment: taking it regardless would answer a question nobody
asked, and taking its head too would undo the very edit that triggered the call. Only the relation is
taken; an `@deep` tail the reader set survives. Async, best-effort, no undo entry of its own, no-op
with no model. ⚠️ **That same-head gate is now the THIRD tier, not the rule** — see the ranking block
below: the relation is asked of the ARC, so a head the parser would not have chosen gets an answer too.

## The pipeline's runners-up (`analysis_scores`, `js/io/scores.js`)

Every component scores a whole INVENTORY and the editor drew only the argmax: one head per token, one
relation per edge, one class per token. `app/parse.py`'s `analysis_scores` hands the ranking back —
one bridge call per sentence, cached, feeding the drag highlight, `headSyncDeprel`, and the opacity of
the relation and POS menu rows.

⚠ **THE PARSER IS TRANSITION-BASED, SO THERE IS NO HEAD DISTRIBUTION TO READ OFF**, and the two obvious
routes were measured and rejected before the one in the tree. **`beam_parse` + `moves.get_beam_parses`**
is the documented API and is nearly useless here: a greedily-trained model's action scores are so peaked
that a width-64 beam returns 64 state sequences collapsing onto 2–3 distinct TREES, and across three
ordinary sentences exactly **2 tokens** got more than one candidate head. Widening does not help (16/32/64
all gave 2) — the alternatives are not being pruned, they are being scored ~0 — and every other head then
reads as exactly 0.0, which is "never enumerated" wearing the look of "unlikely". **Scoring every (child,
head) pair from a synthesised state** covers everything but answers a counterfactual, so it is confined to
the one caller that wants exactly that (below). What is used is the parser's OWN deliberation: in arc-eager
the only arc available at a state is between the stack top and the buffer front, so walking the greedy path
and softmaxing the valid actions at each step yields, per token, the candidate heads it was actually weighed
against. Measured — `with` in "I saw the man with the telescope" comes back **saw .78 / man .22**, `that` in
"the plan that the board had rejected" **plan .54 / had .46**, and a determiner 1.0 on its one noun. The
walk is verified to reproduce the shipped parse exactly, so the winner in the table is always the tree on
screen. 24 ms for a 41-token sentence (12 of whose tokens have more than one candidate), ~800 bytes.

⚠ **THE ROOT FALLS OUT OF THE WALK RATHER THAN NEEDING A RULE.** A token's offers are near-exclusive — once
attached it never reaches the boundary again — so they are used RAW, with the shortfall below 1 credited to
"no head". The sentence's actual root is offered arcs worth ~0.000 in total and lands on root ≈ 1.0; a PP
weighed twice totals 1.28 and simply normalises. ⚠️ An earlier cut normalised each token's offers to sum to
1 unconditionally, which turned the root's noise into a confident-looking head list (`saw` ← `.` at 0.47).
The same trap one level down is why **the label table is emitted only for heads that survived the head
prune**: normalising labels WITHIN an arc hides how little the arc was worth, and reported `parataxis` at
0.46 under an attachment nothing ever considered.

⚠ **A `||` LABEL IS NOT A RELATION.** The wheels carry a few composite training classes (`comp:obj||comp:aux`,
`mod||mod`). They stay in the HEAD marginal — the parser really did weigh those arcs — but `scoreRealRel`
keeps them out of every label the editor might adopt.

⚠ **STANZA ANSWERS `scored: False`, AND THAT IS NOT A GAP TO FILL.** Its depparse is biaffine and so has the
complete head distribution this whole block works to approximate — but Stanza emits UD and `convert.ud_to_sud`
REWRITES HEADS, so its distribution describes a tree that is not the one on screen. Every caller degrades to
its pre-existing behaviour; a weaker version of this would be worse than none.

⚠ **THE CACHE IS KEYED ON THE QUESTION, NOT ON THE SENTENCE INDEX** (`scoresKey`), which is what makes
invalidation a non-problem instead of a list of edit sites to remember. The question is "given these FORMS
and these WORD CLASSES, what did you rank", so any edit that could change the answer changes the key, while
re-heading, relabelling and glossing keep the entry warm. That ordering matters: **re-heading is precisely
when the answer is consulted**, and a cache keyed on `si` would have dropped it on the edit that needed it.

⚠ **THE MORPHOLOGIZER RETURNS LOGITS, NOT PROBABILITIES** — measured, a row sums to −147.3 over −16.4 … +21.0.
`_force_upos` is unaffected (an argmax over a subset is scale-free) which is exactly why this went unnoticed;
a RANKING has to be softmaxed, and reading them as weights gave every class an empty distribution. Classes are
pooled from the joint `POS=…|Feat=Val` label, which is also the pooling the POS menu's dot-suffixed submenu
needs — a parent row is weighted by exactly its own flyout.

⚠ **THE RELATION FOLLOWS THE HEAD IN THREE TIERS**, ordered by what each is worth (`headSyncDeprel`): the arc
the parser genuinely weighed; else `arcLabelScores`, a state SYNTHESISED to put the pair at the boundary
(counterfactual, and labelled as such — measured against a real state it ranks the same two relations first
and second and moves the split, .785/.214 → .576/.416); else the old whole-tree agreement rule, for the
documents the scores cannot serve. ⚠️ **And the chosen relation is validated before it is written**:
`setDiagramHead` already refuses a DROP whose relation is error-level on the new head, and an automatic step
must not introduce what the manual one is stopped from doing. Verified: dragging `who` under `saw` — an arc the
walk never weighed — takes `comp:obj` from the synthesised state, and a relation the validator rejects leaves
the token untouched.

⚠ **EXPECT ONE LIT NODE MOST OF THE TIME during a drag, and that is the honest answer rather than a thin
feature.** A trained parser is genuinely certain about a determiner's noun; the spread appears exactly where a
reader is deciding something (a PP's two sites, a relativiser's, a coordination's). Lighting every token to
look busier would mean inventing mass for attachments the model never entertained. `.pcand` uses the same
accent ink as `.dtarget` and is deliberately weaker — candidates against the choice — which is also why its
rules come FIRST in `app.css`: the two match at equal specificity and the drop target must win outright.
⚠️ **`color-mix()` with a `calc()` percentage was probed in both engines** before being relied on (Chrome, both
kits, and the shipping WKWebView all resolve it, and `--phl:0` lands exactly on the untouched ink) — a dropped
declaration here would be invisible, not an error. A root candidate is not drawn: there is no node to light.

⚠ **MENU ROWS ARE WEIGHTED AFTER THE MENU IS UP**, never before it opens (`weightMenuRows`), so a menu never
waits on a bridge call — it opens unweighted and settles a frame later, which is what the opacity transition is
for. An option the ranking does not mention is dimmed to the floor rather than left bright: below the prune
threshold means ~0, which is right for everything except a custom relation the model was never trained on, and
leaving every unranked row bright would misreport the far commoner case as plausible. A ROOT's relation menu is
left unweighted — there is no incoming arc to condition on. Floor 0.4, restored in full on hover: this is a
ranking, not a disablement.

⚠ **MERGE IS GATED ON "NO INTERVENING SPACE", NOT ON THE LANGUAGE.** `mergeTokens` (js/editing/edit-ops.js)
used to refuse outside `SPACELESS_LANGS`, which is a proxy for the real condition and wrong in both
directions: it forbade merging `do`+`n't` in English, where the two are written solid and a merge takes
nothing away, and it would have allowed one across a real space in Chinese. Every file states the condition
itself, per token — MISC `SpaceAfter=No` — so `mergeIsSolid` tests that per ADJACENT PAIR and consults no
language list. Two pieces of one multi-word token are solid by construction (the line spells the range,
never the pieces), and a pair STRADDLING a range's edge is asked about the RANGE's own `SpaceAfter`, which
lives in its `_cols[9]` and not on its last component.
⚠️ **WHAT THE GATE BUYS is the invariant the old restriction bought by accident**: a merge changes no
CHARACTER of the sentence, so `# text` is never respliced and cannot come to disagree with the tokens. That
is what makes the plain concatenation safe. (It rests on the file's own `SpaceAfter` being truthful, which
is exactly what the tokenisation-mismatch badge already reports on.) Across a space it would not hold —
and there `goeswith` annotates the split without destroying anything, which is what UD asks for anyway.
The gate lives in four places, not one: both menu rows, `mergeTokens` itself (the funnel every caller
shares), and `menuState().merge`, which drives the native item's `vis`.
⚠️ **AND INSIDE A SANSKRIT RANGE THE MERGE IS A SANDHI FUSION** (`sandhiMergeForm`, js/io/bridge.js):
`sat`+`ādi` is written `sadādi`, `ahaḥ`+`rātra` `ahorātra`, so gluing the strings is right only where the
junction is inert. **Inside a multi-word token ONLY** — the one place the app DERIVES a Sanskrit spelling
rather than reading it. The DCS convention this file follows stores a component in PAUSA and lets the
RANGE's surface carry the sandhi, so re-deriving a component answers the question the file already poses;
a STANDALONE token's form is what `# text` says it is (which is why concatenating there is safe), and
re-deriving that by sandhi would put a spelling in the file the running line contradicts.
**The input is the PAUSA forms** — MISC `Unsandhied` where there is one, the form otherwise, since feeding
a sandhied surface back through a sandhi generator applies the rules twice (the rule
`sa_notation.csl_forms` follows for the same reason) — **and the edges stay in pausa**: no neighbouring
words are supplied, because external sandhi belongs to the range's surface, which `sandhiMwtForms` re-fuses
here once the survivor has settled one member shorter. The survivor's `Unsandhied` is CLEARED, not
rewritten: a component's form IS its pausa, and the head's old value described one piece while now sitting
on the merged whole — the stale `-tve` trap. Fire-and-forget off the bridge, exactly as `sandhiMwtForms`
is; the concatenation stands in until it lands, and is the answer if it never does.

⚠ **WHO OWNS THE WHEEL, and the axis test that leaked.** An inner scroller (`.gwrap`/`.diagram`/
`.wp-toks`) may only take the wheel while its whole block is on screen; otherwise the gesture belongs to
the page (`blockFullyInView`, `js/core/scroll.js`). The first-event decision gates that on the gesture
being vertical-dominant, and rightly — a horizontal delta cannot drive the page, so gating it would
merely deaden a wide diagram's sideways pan. **The RE-check must not**, and copying the guard down there
was the bug: it asks the wrong question (not "can this delta scroll the page" but "has the block left
view, so should the pane lose the wheel"), and a trackpad momentum tail is never axis-pure. Measured on
the repro — block dragged half off the top by a page glide, deltas (6,9) and (4,7) both stayed `native`
and unprevented; ownership only moved when a vertical (3,0) arrived. That is the reported "panes scroll
in partially-visible blocks, but only while a page scroll is in progress": the page scroll is what takes
the block out of view mid-gesture. ⚠ **AND A PAGE SCROLL IN FLIGHT TAKES THE WHEEL OUTRIGHT — without consulting `blockFullyInView`.**
That last part is the fix, and omitting it is why a first attempt at this changed nothing:
`blockFullyInView` reports TRUE for a block TALLER than the port whenever the block covers it
(deliberately — "either the block fits inside the port, or the port fits inside the block", or a block
with both panes open, routinely taller than the viewport, could never scroll its panes at all). Such a
block satisfies "fully in view" for as long as the page glides THROUGH it, so its diagram and grid went
on eating the wheel the whole way down, and the `!blockFullyInView` precondition on every other rule
meant none of them fired. Measured: block twice the port height, page moved 120 px between events, both
wheels `native` and unprevented. `pageInFlight` uses two signals — `pageScrollAt` (stamped by #doc's own
scroll listener, so it covers momentum, a chained wheel, blockSnap's glide and alignBlockTop alike) for
a glide already running when the gesture started, and the doc scrollTop captured AT gesture start for
one that begins or continues under an in-flight gesture. A pane scrolling natively moves no page and
fires no #doc scroll event, so neither trips for it and the pane keeps the wheel at rest exactly as
before.

⚠ **THE READING POSITION SURVIVES A CHROME OR ZOOM CHANGE**, and `withTopChrome` is the one instrument
for it — `preserveScroll` cannot do this job, since it anchors on the FOCUSED block's offset from #doc's
RAW top, and both of those are wrong here (the focused block need not be on screen; the raw top is not
the usable top). The zoom (`setFS`) and the options bar (`toggleOptionsBar`) both put their whole
mutation INSIDE the capture, because `--fs`/`--vbH` reflow on the next layout read and capturing
afterwards measures the state it is about to restore — a perfect no-op, which is what an earlier version
of the zoom fix silently was. `captureTopAnchor` records the block's INDEX as well as its node, so the
anchor survives a caller whose `fn` re-renders (it did not, and bailed on `isConnected`, for exactly the
callers that most need it). `alignBlockTop(i)` is the related primitive — recentre the virtualization
window, then put that block flush under the toolbar — shared by the saved-position restore and by a
multi-sentence insert.
⚠ **AND THE ANCHOR MEASURES THE PORT TOP OFF #doc's OWN PADDING, NOT `docTopInset()`** (`docPadTop`). The two
normally agree — `.doc{padding:var(--top-chrome) …}` IS that expression, resolved — but they come apart for
exactly the caller the pair exists for. `docTopInset()` reads the options bar's `.hidden` CLASS; the padding
reads `--vbH`, which `syncChrome` writes a few statements later. In that window the inset has already moved by
the bar's height while nothing on screen has, so an anchor captured there records the NEW inset against the OLD
geometry and the restore lands the block one bar-height too high — behind the bar. Measured at the torn instant:
padding 52, `docTopInset()` 91, i.e. **39px** of shift, which is the reported "enabling the options bar doesn't
lower the focused block". It is the rAF'd restore inside `syncChrome` that decides, since it runs after
`recapBlocks` and overrides `withTopChrome`'s synchronous one — so the torn capture is what the reader is left
looking at. Driving the real command now measures **0px** of drift.

⚠ **THE ORNAMENTAL SANSKRIT SCRIPTS ARE DRAWN AT DOUBLE SIZE, AND THE MEASUREMENT HAS TO FOLLOW THE PAINT.**
Rañjanā, Soyombo and Zanabazar Square were made for titles, seals and inscriptions; their ornament is not
resolvable at a 15px body size, while every other script in the list is a running hand that reads fine there
(`ORNAMENTAL_SCRIPTS`, js/lang/translit.js — a judgement, so it is a list rather than something derived).
⚠️ **Zanabazar Square is NOT one of them** — it was corrected out of the list on report: it is a practical
script for Mongolian, Tibetan and Sanskrit, and its square construction is a letterform rather than ornament.
Siddhaṃ and Balinese are in, surviving as bīja/mantra calligraphy and as ornamented palm-leaf lettering.
`syncSchemeAttr` publishes `--script-mag` on #doc; `refreshFontStacks` reads it back into `TOK_MAG` in the same
breath as the font stacks, because **a canvas `font` string cannot carry a `var()`** and every slot width in
every notation comes from `meas()` against those strings — scaling the paint alone would lay out 15px boxes and
draw 30px letters in them. ONLY the glyph faces scale (`WORD_F`/`NODE_F`/`MWT_F`/`GW_TIE_F` and their CSS
twins, plus `.stext-script`); the POS, transliteration and gloss rows are Latin annotation, and doubling those
would be a zoom, which ⌘+ already is. ⚠ **`belowGap()` is why the rows still clear.** The step below a token was
the literal `18+descent(POS_F)` in **fifteen** places — every renderer's draw AND every renderer's reserve
(`stackH`/`belowH`/`stackBot`/`--undpad`/`tieLead`/`mwtDepth`) — and that 18 is calibrated against a 15px form
with about **1.6px** of slack (measured: ink bottom 166.0, POS row top 167.6). A doubled form eats it. The one
expression now adds the magnification's own extra descent, so draws and reserves grow together; measured across
all five notations at 2×, every row clears and nothing clips. Identical to the old expression at `TOK_MAG === 1`.
⚠ **WEBKIT DOES NOT SHAPE SUPPLEMENTARY-PLANE COMPLEX TEXT IN SVG `<text>`, AND THAT SUPERSEDES THE CLAIM
BELOW THAT KAWI "COMES OUT CLEAN".** Measured in the shipping app, one Kawi word at 15px: **canvas 39.85,
painted SVG 86.54, the `meas()` element 99.88** — and all three agree to 0.01 on the strings in the same
sentence carrying NO combining marks. Canvas is the CONTROL, not a candidate: it is less than half the painted
width because it is the only one of the three that forms the conjuncts and zeroes the marks. So the SVG paints
these scripts UNSHAPED, about one advance per codepoint, and the "horizontal placement is off" report is that
width — not a centring error, which measures 0.00 px. ⚠️ **WHAT DISTINGUISHES THE AFFECTED SCRIPTS IS NOT KNOWN.**
It is NOT the plane, which was the first theory and is disproved: Siddhaṃ (U+11580–) and Soyombo (U+11A50–) are
supplementary-plane too and have never shown it. One untested difference is how the face ARRIVES — Siddhaṃ and
Soyombo come from `web/fonts` as `@font-face` webfonts, Kawi resolved to one installed in `~/Library/Fonts` — but
that is a hypothesis, not a finding. **This is why `svgShapesSMP()` PROBES the condition rather than keying off a
script list**: it compares what the engine will actually paint against what canvas shapes, so it stays right
whatever the real cause turns out to be, and a script list built on a wrong theory would not have.
⚠️ **Chrome shapes this correctly, so no headless test can see any of it** — every wrong turn here came from
reasoning against Chrome. The Kawi note further down was verified in a synthetic CDP harness and is wrong for
exactly the reason the Zanabazar Square note beside it gives: trust the live report.
`svgShapesSMP()` PROBES it (canvas vs the measuring element, 2 % threshold — shaped and unshaped differ by
50–120 %, so it cannot fire on rounding), memoised and re-probed on a font-stack change, so an engine that gains
this simply reports agreement and nothing changes. Where it fails, `meas()` returns the CANVAS width (what the
fallback actually paints) and `smpReshape` swaps each affected `<text>` for a `<foreignObject>` holding an HTML
element — the same text path the running sentence uses, which is why that line always looked right while the
diagram did not. Run from `renderSentence`, the one choke point every notation passes through, rather than at the
nine sites that build a form: those differ per notation and each sets its own `data-*`/cursor/tooltip afterwards,
and a sweep over the finished element cannot miss one.
⚠️ **What a `foreignObject` does NOT inherit is the whole difficulty**: `text-anchor:middle` (the box is placed at
x − w/2), `paint-order:stroke` (the casing becomes the text-shadow triple the HTML notations already use), the
baseline (the element is seated by its own font ascent) and `fill` (`.fo-form` restores `color`, including the
selected and dimmed states). The class list and every attribute ride along onto both nodes, or selection, dimming
and the delegated click handlers stop matching.
⚠️ **THE PROBE MUST BE CONSULTED BEFORE THE MEASUREMENT CACHE IS READ**, and putting it inside
`_measOneUncached` — which a cache HIT skips — meant it never ran at all. `t.ortho` is filled ASYNCHRONOUSLY by
fillOrtho, so at first layout there is no SMP string to probe, the width is taken optimistically as the unshaped
81 px and CACHED; every later render hit that entry, `_measOneUncached` never ran, and the probe's own one-shot
`clearMeasCache()` had nothing to trigger it. Measured symptom: `svgShapesSMP()` reporting false while `meas()`
still returned 81 — an 83 px box holding 39.85 px of text, i.e. the form sitting **20 px left** of its own POS
tag, and only ever on first load. It is consulted in `_measOne` now, on the way in.
⚠️ **AND `.fo-form` IS CENTRED**, because an HTML block left-aligns and `text-anchor:middle` means nothing to it.
With a correctly sized box that is invisible; it is what turned a stale width into a 20 px DISPLACEMENT rather
than 20 px of slack around correctly-placed glyphs, so it stays as the structural guard.
⚠️ **AND THE FORM IS THE ELEMENT'S OWN TEXT NODES, NOT ITS `textContent`.** An SVG tooltip is a `<title>` CHILD
(`svgTip` — the title ATTRIBUTE surfaces nothing on SVG), so `textContent` returns the form concatenated with the
hint, and the first cut painted the tooltip into the diagram beside the word. The `<title>` is carried onto the
`foreignObject` so the tooltip survives the swap rather than being traded for the bug.

⚠ **THE MAGNIFICATION CARRIES THE WEIGHT AND TRACKING CURVES WITH IT, AND NOT DOING SO WAS A REAL LAYOUT BUG.**
`refreshFontStacks` now derives three terms from `--script-mag` and publishes them back on #doc, so the CSS and the
canvas/SVG measurement strings cannot disagree about any of them: `--script-wght` (`magWeight`, the weight curve
with its 400 floor dropped to 100 — a 30px glyph is the first thing in this app on the far side of the reference
size, and a STATIC face simply renders its Regular, which is what "follow the curve as far as possible" means),
`--script-track-d` (`magTrack`, the tracking curve's own term for the magnification, in em so one value serves
every rule whatever its base size) and `--script-asc`. ⚠️ **The tracking half is a fix, not a refinement**: the
glyph rules stated the curve as a literal for their UNMAGNIFIED size — and the 15px/26px faces stated none at all,
15px being the curve's zero — while `_measOneUncached` reads the size out of the font string and computes
`trackCurve` for the MAGNIFIED one. At 2× the two differed by 0.08·ln 2 ≈ .0554em per character, and measurement
is what sizes the slot: **measured on the real diagram, Balinese forms were laid out up to 12.5px wider or 8.3px
narrower than they paint; both now match to 0.00px.** `trackCurve(base) + magTrack(mag)` is identically
`trackCurve(base × mag)`, which is the identity that keeps them in step by construction. The weight likewise has
to ride the FONT STRINGS (`magFont`), or the slot is measured at Regular while a variable face paints at 200 —
and `WORD_F_BOLD`/`NODE_F_BOLD` take an explicit override, since a shorthand cannot carry two weight tokens.

⚠️ **A SEAM MARK IS NOT PART OF THE WORD**, so it does not magnify (`svgSeamMark` un-scales the FORM row only —
every other row is handed an unmagnified face already). It is punctuation ABOUT the word, set in the app's own
register; at 2× it drew a 30px hyphen beside the letters it annotates. Verified: 15px at mag 2 while the forms
are 30px. ⚠️ **And the MWT surface form keeps its top margin** (`mwtFormLead`): the literal 20 seats a 15px form
~9px below the tie, i.e. 20 minus that form's ascent, so at 2× the doubled ascent ate the gap. Adding
`A × (mag − 1)` holds the ink top where every non-ornamental script puts it — the same shape as `belowGap()`'s
magnification term, and `bot` is computed from `dfy`, so the reserve follows for free.

⚠️ **`--script-asc` IS MEASURED, AND THE STACK ORDER DECIDES WHETHER THE MEASUREMENT IS TRUE.** Canvas
`fontBoundingBoxAscent` reports the metrics of the FIRST family in the font list whatever face actually shapes the
text: a Kawi character measured against the ordinary token stack answers **107** (Noto Sans Latin's ascent) and
only answers Kawi's own **110** when `Noto Sans Kawi` is named first. `scriptAscentEm` therefore names the
script's family ahead of the live stack; a face that will not resolve falls through to the Latin ascent, which is
the shift this had before it was measured at all. The faces differ by a third of an em (Kawi 1.10, Javanese 1.12,
Devanagari 0.90), which is why this is measured rather than tabulated.

⚠ **AND THE RUNNING LINE IS TOP-ALIGNED, THEN PULLED UP BY ITS OWN ASCENDER** (superseding the cap-height rule
this block used to describe). `.shead` is baseline-aligned, which is right while everything in it is one size; a
script at double size then hangs its extra height ABOVE the row. `align-self:flex-start` puts the tall box's top at
the row top — but these faces reserve enormous ascents for their stacked marks, most of it empty, so top-aligning
the BOX alone drops the letters well below the number. The line is shifted back up by that ascent's magnified
excess, `--script-asc` × `--stext-fs` × (mag − 1), and the empty ascent overflows into the gap above the block
where nothing is drawn; a matching `margin-bottom` gives the shift back to the flow so the line cannot lean into
the transliteration row. Every term is 0 at mag 1.

⚠ **A z-index cannot beat the native window-tab bar.** Every floating popup clamps its top to
`menuTopBound()` (`js/core/scroll.js`) rather than to a bare `8`: the app's own titlebar is web content
a menu paints over happily, but the tab bar is an AppKit view in the window's theme frame, above the
WKWebView entirely, so a menu positioned under it is unreachable rather than merely behind something.
`--tabH` is that bar's bottom edge, published by `app/mac/shell.py` and 0 when the window is not in a
tab group (and on Windows), so this is the old constant everywhere else. The status-bar language menu
opens *upward* and is the tallest thing in the app, so it is capped by `max-height` instead of moved —
its list already scrolls.

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

⚠ **The backend is not optional to the STANZA ENGINE, and that is the consequence everyone misses.**
Stanza emits UD and this app stores SUD, so `parse._parse_stanza_ud_to_sud` runs the conversion
grammar on *every* Stanza parse — no backend, no Stanza parsing at all, however cleanly the model
downloaded. Both macOS builds therefore **ship `vendor/`** (`for d in app web grammars vendor`);
before that they copied only `app web grammars`, so no user who had not built the app themselves had
a grew backend and every Stanza model was inert — reported as "the Stanza models do nothing". The
binary is arch-specific and `[ -e ]`-guarded, so a tree without `vendor/` still builds and still
degrades. The **Windows** build deliberately does NOT copy it (a Mach-O on `PATH` would be found and
fail to spawn — worse than finding nothing); it has no grew until something in this repo produces a
Windows `grewpy_backend`. Manage Models states the consequence at the top of the Stanza group
whenever `conversion_available()` reports no backend (`js/io/models.js`), so a user is told *before*
a 400 MB download rather than by a silent no-op after it.

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

⚠ **A BREVE IS TAKEN OFF BEFORE THE PARSER SEES LATIN, AND PUT BACK AFTERWARDS.** A reader pastes Latin as
a textbook prints it (`pŭella`, `ĭnstar`), and the treebanks spell Latin with no quantities at all — so every
marked word arrives out of vocabulary and comes back mis-tagged and mis-lemmatised. `_debreve` strips the
marks from the string handed to the pipeline and returns an INDEX MAP; `_reform` slices each token's FORM back
out of the ORIGINAL text, so what the parser sees is bare and what is stored is what the reader wrote. Both
halves are load-bearing: a written breve is a quantity the author WROTE, which `macron.py` honours as the one
thing it never revises, so stripping it into the file would delete a statement. Gated on the LANGUAGE, not on
the character — Turkish `ğ` is g-with-breve, and stripping it there would rewrite the language. Applied on the
four spaCy entry points (`_parse_spacy_sud`, `_parse_spacy_sud_many`, `_spacy_tokenize`, `parse_pretokenized`);
**Stanza is deliberately left alone** rather than half-done, since an MWT-expanded Stanza word carries
`start_char = None` and the same restore is not available there.

**SUD'S OWN MISC LAYER IS PREDICTED TOO**, by components of the model's own
(`sud_subject`/`sud_subject_rule`, `sud_reported_rule`, `sud_idiom`), and it arrives on ONE spaCy
extension — `Token._.sud_misc`, a **dict**, which is why `_SUD_MISC_KEYS` folds it in `_ext_misc`
separately rather than as another `_TOKEN_MISC_EXT` row. Four keys: `Subject=SubjRaising|ObjRaising`
on the embedded predicate whose subject is raised, `Reported=Yes` on a speech verb's verbatim
complement, `Idiom=Yes` on an idiom's head (which also carries `ExtPos`) and `InIdiom=Yes` on its
other members (which attach by `unk`). **The app already drew all of that** — `subjGhostTarget`'s
dashed edge, `isReported`'s subtree lifted off the line, the `:xsubj` pair `depsAutofill` writes on
save — from annotation the reader had to make by hand; what was missing was the parser's own answer,
which `spacy convert` discards on the way IN (it reads MISC for `SpaceAfter=No` and the NER pattern
only), so upstream had to hoist it through FEATS at training time and publish it on an extension at
inference. MISC and not `token.morph`, deliberately, on both sides: a MISC feature must never
masquerade as a morphological one. Which keys a wheel carries is a per-language empirical choice
recorded in SUD-spaCy's own CLAUDE.md (zh ships no `Subject`; fa/la no `Reported`; the four
treebanks that annotate no idioms no `Idiom`), so **an absent key means "this model says nothing
here", never "no"**.

⚠ **A RE-PARSE OF ONE TOKEN'S FIELDS MUST NOT TAKE THEM.** All four are read off the tree the model
itself produced, and `reparseTokenFields` (`SUD_TREE_MISC`, js/io/bridge.js) adopts none of the
parser's heads or relations — it re-derives the model-derived FIELDS on the reader's own tokens. So
those four answers describe a tree discarded a line later, and a fresh `Subject=SubjRaising` drawn
as a ghost edge across an attachment the reader made themselves is not a weaker annotation but a
claim about a different sentence. They are cleared from the parser's MISC there and the reader's own
restored by the `keep` list; only a FULL parse (`doInsert`/`insertParsed`/`reparse`/`commitSentText`,
which replace `s.tokens` wholesale together with the tree they belong to) takes them verbatim.

⚠ **THE WHEELS GAINED THIS WITHOUT A VERSION BUMP**, so an environment built before them never
refreshes: `requirements-core.txt` pins `en_sud_ewt` by release URL at `0.1.0`, pip sees `0.1.0`
installed and skips it, and the per-user venv is built once and gated behind `.sud-core-ready`
anyway. A downloaded model has the same problem through Manage Models, which reports it installed.
Symptom: a parse that marks nothing, on a build that plainly contains this code. The resets are in
README's "Resetting an install" table — remove-and-redownload for a downloaded model, `rm -rf …/venv`
for the bundled one. **Check the pipeline, not the version**, when diagnosing:
`nlp.pipe_names` either lists the `sud_*` components or it does not.

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
- `app/data/tshet_uinh_mc.tsv` — **Middle Chinese for the ~16,000 graphs Baxter–Sagart never listed**, built by
  **`tools/build_tshet_uinh_baxter.py`** from the 廣韻's own 音韻地位 (nk2028/tshet-uinh-data, **CC0**) through a
  Python port of nk2028/tshet-uinh-examples' `baxter.js` (**MIT**). The appendix beside it is a list of 4,082
  WORDS chosen for what they say about *Old* Chinese; it covers 4,330 graphs, so most ordinary Buddhist-text
  vocabulary (菩薩, 涅槃, 般若) had no Middle Chinese in this app at all. A Qieyun position is recorded for every
  graph the rhyme book lists and Baxter's transcription is a NOTATION for that position, so 19,492 graphs answer
  here. ⚠️ **It is a fallback, not a replacement**: `_baxter_table`/`_baxter_all` consult it only where the
  appendix has no Middle Chinese for the graph — measured, **0 of 4,330** existing renderings move — and it
  supplies **no Old Chinese**, because a Qieyun position says nothing about the reconstruction. ⚠️ **Built in
  Baxter's 1992 notation, not 2014**, because that is what `baxter_sagart.tsv` is written in (`ʔ æ ɛ ɨ`, not
  `' ae ea +`) and the two answer the same row; the port validates at **94.3 %** agreement with the appendix's
  own first reading over the 3,364 graphs both hold, the residue being the appendix choosing a different 小韻.
  Byte-reproducible, `--retrieved` required — don't hand-edit it, re-run the script.
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
  The **Script** menu is therefore Original + **Latin** + the 33 Brahmic scripts, with no "None" row:
  "Latin" says the same thing and says it as a script. It names the SCRIPT and not the notation — the
  id is still `iast`, but which Latin notation that line is drawn in belongs to the Displayed
  transliteration, and the two menus disagreed the moment CSL could fill it (Script Latin + Displayed
  CSL puts CSL on that line — `saCslTop`, below). `_DANDA_IAST` routes the daṇḍa there rather than
  through aksharamukha, which renders `।` as `.` and would put a full stop in the middle of a verse.
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
  ⚠ **A CONSONANT-FINAL WORD JOINS THE NEXT ONE IN THE SCRIPT LINE, AND ONLY THERE.** A Brahmic script writes a
  word-final consonant with a virāma, and Devanagari does not leave a virāma standing before a space: `tad api` is
  written तदपि, `vāk iti` वागिति, the two words sharing one akṣara run. Romanisation is under no such constraint,
  so the IAST original keeps its space and the script line loses it — the two lines then disagree about word
  division, which is correct rather than a defect, because word division is a fact about the script here.
  ⚠ **Done on the INPUT, not on the output** (`_sa_join_final_consonant`): deleting the space after conversion
  leaves the virāma where it was — तद्अपि, a dead consonant beside an independent vowel, which is not how the word
  is written — whereas deleting it first hands aksharamukha `tadapi` and the real akṣara forms. The rule is
  therefore stated in IAST, the one alphabet in which "ends in a consonant" is a question about a single
  character; anusvāra and visarga are excluded, since neither leaves a consonant hanging. A file already stored in
  Devanagari passes through untouched, and should: `_ak` returns it unchanged, so the author's own spelling is
  what is drawn. It is ORTHOGRAPHY, not sandhi — `vāk iti` comes out वाकिति, not वागिति.
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
  ⚠ **It is therefore the ONE Script scheme whose cached rendering is keyed on more than the form**,
  and both halves of that used to be missing. `fillOrtho` batches on `orthoKeyOf(t)` — (surface, upos)
  as every other scheme does, **plus FEATS and the lemma where the scheme reads them** — so two tokens
  spelt and tagged alike but analysed differently stop sharing whichever one was reached first. And
  each rendering carries the key it was computed for (`t._orthoKey`), so `fillOrtho` refills whatever
  no longer matches instead of only what is empty. That stamp is what makes "a macron follows any edit
  to the token" true: the trigger is `markDirty` — the one funnel every document edit passes through —
  debounced, gated on `orthoNeedsMorph()`, and skipped while an inline field is open. Teaching the
  dozen-odd FEATS/lemma write sites to invalidate was the alternative, and a new one would forget.
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
  **`macron._extra_fixes` is this app's own extension of that paradigm override**, kept in `macron.py`
  rather than in the vendored file for the reason `translit._POS_OVERRIDE` is kept out of the
  Baxter–Sagart TSV: a re-vendor would revert an edit there. Every cell was **measured against
  `macrons.txt` itself** (724,191 rows) and admitted only at **≥ 99.8 %** agreement — the infinitive
  in `-e`/`-ī`, the gerund/gerundive in `-ō`/`-ī`, the supine `-ū`, first-singular `-ō`/`-ī`, the
  2sg future passive `-ēris`/`-ēre`, the imperative `-ā`/`-ī`, `-mus`/`-tis`, the dative/ablative
  plural `-īs` and `-ibus`, genitive/dative singular `-ī`, first-declension accusative plural `-ās`,
  second-declension vocative `-e`, the comparative `-ius`. `PRON` is excluded (`mihi`, `tibi` measure
  33.8 % long).
  ⚠ **THE MSeg TIER CARRIES MACRONS, AND IS THEREFORE GATED ON THE MACRONISER.** Everything else about vowel
  length is a Script scheme, i.e. a DISPLAY preference; a morpheme segmentation is annotation, it is stored in
  MISC MSeg, and `dī-vīsa` is a different claim from `di-visa`. So the tier carries the marks whatever the Script
  pill says (`fillLaMacron`/`scheduleLaMacron`, js/lang/translit-load.js, debounced off `markDirty` exactly as
  `scheduleOrthoMorph` is), and for Latin the tier cannot be switched on at all without the table — the checkbox
  is disabled (`syncGlossUI`), `setTier` refuses again at the command, and the Script menu's own "With macrons"
  row is one click from installing it. ⚠ **The macrons are OVERLAID on the segmentation, never segmented from**:
  quantity alternates across a paradigm, so `dīvīsa` against `dīvidō` shares only `dīv` where the bare pair shares
  `divi` — feeding marked strings to `msegSegment` makes the shared match SHORTER and moves the boundary. Letters
  decide the cut, marks are written onto the letters that survived it, which is sound because macronisation is
  length-preserving (precomposed ā ē ī ō ū). ⚠ And `editTier`'s MSeg back-write **strips the quantities first** —
  the FORM column never carries them and the file must round-trip byte-identically.
  ⚠ **AN MWT's MACRONS COME FROM ITS COMPONENTS** (`laMwtCompose`), because `macrons.txt` lists WORDS and never
  host+clitic: `armaque` is simply absent from it, so the fused surface came back bare in the middle of an
  otherwise macronised diagram and running line. `arma` and `que` each answer, each with its own UPOS/FEATS/lemma
  — which the range could never have had. The join is CHECKED before it is trusted (stripping the quantities off
  it must reproduce the stored form), so French `du` = `de`+`le` is left alone rather than mis-composed.
  ⚠ **`ae`/`oe` ARE SINGLE LETTERS IN LATIN**, and that supersedes the older "a cut may not split a vowel
  SEQUENCE" rule *for Latin only* (`MSEG_DIGRAPHS`, js/io/bridge.js). The old rule was a crude statement of the
  same intent — knowing no language's letters, it treated every vowel run as indivisible — and it walked
  `Troiae`/`Troia`'s cut back through `oiae` to `Tr-oiae`. With the digraph inventory the only forbidden cut is
  one falling inside `ae`/`oe`: `Troi-ae`, `puell-ae`, `poen-ae`. Every language NOT in that table keeps the
  whole-run approximation, deliberately — it is what declines `said`/`say` (the cut moves to `s|aid` and a match
  of `s` then fails the vowel test), and dropping it everywhere would have cost that for nothing.
  ⚠ **The MGloss ordering puts the POS-SUBTYPE features right after Number** (`3SG.PERS`) — they used to
  trail every inflectional category. Placed after Clusivity, not between Number and Clusivity, because
  `1PL.INCL` is one agreement statement nothing may split; with no Clusivity the two readings coincide.
  They are also members of `MGLOSS_NOMINAL`, so they travel with the nominal block when Case moves it to
  the end — otherwise a case-marked pronoun glosses `PERS.3SG.NOM` instead of `3SG.PERS.NOM`.

  ⚠ **A QUANTITY THE AUTHOR WROTE IS KEPT; EVERY OTHER VOWEL IS STILL DERIVED.** Everything else in the
  module is inference — somebody else's lexicon plus rules right 99-point-something per cent of the time
  — and a macron or breve someone has WRITTEN is not inference, so it is never revised. A **breve** is
  the pointed case: an unmarked vowel says nothing (Latin is normally written with no quantities), so a
  breve is the only way to say "short, and I mean it" — exactly the mark a reader reaches for to
  contradict this module. It is honoured, and written back AS a breve; a bare vowel would delete the
  statement. But a mark exempts only ITS OWN VOWEL. Part-marking is the normal way of writing Latin
  quantities, and that cuts the opposite way from how it first looks: precisely BECAUSE part-marking is
  normal, an unmarked vowel is not a claim of shortness but simply unmarked, so filling it in adds
  information without contradicting anyone. `dīvisa` → `dīvīsa`; `dĭvisa` → `dĭvīsa`. (`_written_marks`
  reads the marks by BASE-character index after NFD, so precomposed `ā`/`ĭ` and their decomposed
  spellings are caught alike and an unrelated combining mark — a diaeresis — neither counts nor shifts
  the ones after it; `_strip_quantity` removes both marks for the lookup, since a breve left in place
  would make `ĭnstar` a string no lexicon can match.)
  ⚠ **THE RULES COME IN TWO TIERS.** A cell measured **exceptionless** (100.00 %) applies always — a
  paradigm cell is a fact the lexicon may never have been shown, and contradicting its morphology-blind
  fallback is the point. A cell with *any* measured residue applies **only where the lookup had no entry
  for that word**, because the residue words are almost by definition ones the lexicon knows. That split
  was forced by the nominative `-us` rule (99.89 %), which applied unconditionally shortened `senectūs`,
  `virtūs`, `servitūs` — the third-declension `-tūs` abstracts. **Gender does not separate those**,
  measured: feminine `-tus` nominatives are only 14.3 % long, the rest being Greek feminine names.
  ⚠ **A cell that fails the bar is usually UNDER-SPECIFIED, not unstatable**, and the conditioner is
  most often the SPELLING or the LEMMA, neither of which UPOS+FEATS carries: the 2sg future passive goes
  91.6 % → 100 % excluding `-bere` (the 1st/2nd b-future); the imperative 30.0 % → 100 % on `-ā`/`-ī`,
  and its remaining `-e` 25.0 % → 99.56 % when `lemma == form + "o"` marks the 2nd conjugation;
  accusative plural `-ās` 98.6 % → 100 % on an a-stem lemma; the vocative 90.9 % → 99.98 % on an o-stem
  one. The **positive adverb in `-ē`** deserves its own line: the contrast is DERIVATIONAL (`longē` ←
  `longus`), so the rule must know the adjective — an earlier attempt keyed it on the LEMMA being the
  adjective, which is Morpheus's convention and **not UD's** (UD lemmatises an adverb to itself), so it
  could never fire on this app's own parses and was dead code wearing a measurement. It now asks the
  loaded table whether `stem + "us"` is a form. Still out, with figures: the fifth-declension ablative
  (already `_PARADIGM`'s, keyed on `InflClass`), "an enclitic is short" (95.2 / 82.5 / 70.6 % — sunk by
  `aequē`, `plēnē`), and `-r`/`-l`/`-d`, which under the same gate changed **0 words either way**.
  ⚠ **NO ENCLITIC SPECIAL CASE, deliberately.** An `_enclitic_host` helper briefly split an unsplit
  `armaque` and macronised the host, on the (correct) observation that `macrons.txt` lists WORDS and
  never host+clitic. It was removed: an enclitic is a separate TOKEN, UD tokenises `armaque` as a
  multi-word token over `arma` + `que`, and **the Latin tokeniser is the layer that should split it**.
  Once it does, each piece arrives here as its own word and every rule works with no special case — and
  the MWT shows up in the diagram and the file too, which a macronisation-only fix could never give.
  Measured on a held-out 5 % of the forms: whole-token 44.45 % → **48.62 %**, per-vowel 81.18 % →
  **83.61 %**, 432 words newly right against 1 newly wrong, and in-vocabulary now *improves* rather than
  merely holding (99.01 % → 99.04 %) — which is what the two-tier gate bought.
  **What remains is not addressable by rules.** Bucketed over the held-out OOV split by the position of
  each wrong vowel: stem 12,428 of 31,277 · penult 269 of 6,972 · final 173 of 3,883. **96.6 % of wrong
  vowels are STEM vowels and 98 % of errors are "too short"** — we fail to restore a macron rather than
  invent one. Stem length is lexical; the endings, which are this table's business, are now 95.5 % right
  at the final vowel and 96.1 % at the penult.

Optional dependencies are always isolated behind a single module façade in `app/`, as those last
five do — follow that when adding another.

## Packaging (`packaging/`)

- **`make_bootstrap_app.sh`** — the canonical build (and what the Stop hook runs). Ships the app
  *source* plus a launcher; on first launch it builds a per-user venv from the user's **own**
  Python 3.12, because a Python linked against the current macOS SDK is what gets the native Tahoe
  chrome. CORE deps only.
  ⚠ **`find_py.sh` RANKS candidates by that SDK; it no longer takes the first one that runs.** The app
  runs *inside* the chosen interpreter, so AppKit reads the interpreter's own `LC_BUILD_VERSION` and
  holds an older-SDK binary at the previous appearance — visibly, at the window edge, where a
  pre-Tahoe corner radius sits beside fully-rounded native windows. That is the "not seeing
  fully-rounded corners" report: the old order preferred Homebrew (SDK-current) but fell through to a
  python.org framework build, which targets a deliberately old SDK. `_py_sdk_major` reads it with
  `otool`; the first candidate at or beyond the running OS wins immediately (so the Homebrew case
  still costs one `otool` call), otherwise the newest-SDK candidate does. A preference, never a
  requirement — every candidate runs the app, and with no `otool` all score 0 and the list order
  decides exactly as before.
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
