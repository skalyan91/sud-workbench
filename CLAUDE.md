# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A native-feeling desktop app for viewing and editing dependency treebanks in CoNLL-U, speaking
**SUD** — Gerdes/Guillaume/Kahane/Perrier's Surface-syntactic Universal Dependencies relation set
(surfacesyntacticud.org; NOT this project's or Sunflower AI's own — a claim to that effect was
committed here in error and corrected, don't reintroduce it) — plus **UD** import/export and
**mSUD**. All-Python
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
under `app/`, `web/` or `packaging/` is newer than `.claude/.last-build-stamp` (`grammars/` is
deliberately not watched — it's fetched on demand into `APP_DATA`, not part of the source tree).
Output goes to `.claude/last-build.log`; an in-flight build holds `.claude/.build.lock`. Don't run a
build in the foreground just to check your work — read the log.

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

⚠ **The MGloss ordering puts the POS-SUBTYPE features right after Number** (`3SG.PERS`) — they used to
trail every inflectional category. Placed after Clusivity, not between Number and Clusivity, because
`1PL.INCL` is one agreement statement nothing may split; with no Clusivity the two readings coincide.
They are also members of `MGLOSS_NOMINAL`, so they travel with the nominal block when Case moves it to
the end — otherwise a case-marked pronoun glosses `PERS.3SG.NOM` instead of `3SG.PERS.NOM`.

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

⚠️ **AND `setAsRoot` WAS THE ONE PATH IN THAT LIST THAT DID NOT ACTUALLY GO THROUGH THE FUNNEL** — the
paragraph above named it, and it open-coded the two invariants it could see (`syncSharedFeat`, the old
root's `root` → `udep` demotion) and none of the rest. A re-root moves **more edges than the one node
the reader clicked**: the old root and every token that hung off it are re-parented onto the new root,
each still labelled for the head it no longer has, the old root's placeholder `udep` most starkly. All
of them now run `afterHeadEdit`, which asks the same three-tier question and applies the same
error-level validation a hand-dragged arc gets. **Deferred, not fired per token**: `afterHeadEdit`
takes an optional `defer` array that collects the ids instead of firing, and `headSyncDeprels`
(js/io/bridge.js) runs them once the whole re-root has landed — a call fired from the first branch
would be asking about a tree whose new root still has a head, and `headSyncDeprel`'s own staleness
re-read would then throw away the answer it had just paid for. Sequential, so the first call warms
`tokenScores`' cache for the rest, and **one render for the batch** rather than one per token. The
**new root is not in the list**: head 0 is settled by rule, which is what `headSyncDeprel`'s `want>=1`
guard already says. ⚠️ The changed set is NOT the classic root-to-node path reversal — this command
leaves the intervening chain alone, so it is read off the mutation itself (`resync` is appended where
each head is written) rather than re-derived by a diff that a later change to the re-rooting rule
could desynchronise.

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
`refreshFontStacks` publishes `--script-mag` on #doc and reads it straight back into `TOK_MAG` in the same
breath as the font stacks, because **a canvas `font` string cannot carry a `var()`** and every slot width in
every notation comes from `meas()` against those strings — scaling the paint alone would lay out 15px boxes and
draw 30px letters in them. ONLY the glyph faces scale (`WORD_F`/`NODE_F`/`MWT_F`/`GW_TIE_F` and their CSS
twins, plus `.stext-script`); the POS, transliteration and gloss rows are Latin annotation, and doubling those
would be a zoom, which ⌘+ already is.

⚠ **A SCRIPT SWITCH IS FONT, THEN SIZE, THEN SPACING — AND IT USED TO BE SIZE FIRST, ALONE.** `syncSchemeAttr`
published `--script-mag` the instant the reader picked a script, while everything DERIVED from it
(`--script-asc`/`--script-lift`/`--script-align`/`--script-op(-run)`/`--script-cross`/`--script-brk-lift`/
`--dia-pad-extra`, `TOK_MAG` and every canvas font string built on it) is published by `refreshFontStacks`, i.e.
only on the next render — and a script pick does not render, it fires `fillOrtho` and waits for the bridge.
Measured (headless Chrome, 150 ms stub bridge, Devanagari→Siddhaṃ): the size moved at t=957 ms and its own
derived terms did not follow until t=1270 — **313 ms** of new magnification against old spacing, of which the
first **178 ms** also had the PREVIOUS script's letters on screen (`clearOrthoCache` has blanked every
`t.ortho`, the new renderings have not landed). Not merely stale but wrong: `.stext-script`'s
`calc(--stext-fs * --script-mag)` and the px terms are MULTIPLIED, so a 2× size met a lift and a padding
calibrated for 1.5×. The publish now lives at the top of `refreshFontStacks`, so size, everything derived from
it, and the render that draws the new glyphs are one atomic step; between the pick and that render the previous
script simply stays at its own size. Setting the FONT early (`data-scheme`, the Rañjanā `--token-font`
override) is kept and is the point — that statement is what starts a webfont's load (Nithya Ranjana measurably
goes `unloaded`→`loading` on it). ⚠️ **So `fillOrtho` now OWNS the render for a script pick**: it resolves to
whether it painted, and `_orPick` renders itself if it did not (no bridge, a throwing bridge, an answer with no
renderings — all of which used to leave the previous script's letters on screen for good) and replays a
`captureTopAnchor` afterwards, since the height change `withTopChrome` used to wrap has moved into the
deferred render.
⚠️ **AND `--script-align` IS PUBLISHED BEFORE THE MEASUREMENTS, NOT AFTER THEM.** It was the last line of that
block, three statements below `TOK_LIFT=scriptLiftEm()` — and `snumCapHeightLiftEm` measures a synthetic
`.shead` holding a real `.stext.stext-script`, whose `align-self` IS `var(--script-align,baseline)`. Measured
on a real switch into Grantha: the same call answers **0.0040 em** with the alignment still `baseline` from the
previous scheme and **0.0657 em** once `flex-start` is published — published as `--script-lift` and corrected
only because a second render happened to follow. (`--script-lift` currently has no CSS consumer, so the value
error is inert today; the ordering is not.)
⚠️ **AND THE FACE IS AWAITED BEFORE THE RENDER MEASURES IT** (`schemeFaceReady`, js/lang/fontload.js).
`fillOrtho` ended `renderUnlessEditing(); syncDocFonts();` — measure, then go and see whether the script's font
is even present. `syncDocFonts` answers the DOWNLOAD question and deliberately skips the faces `fonts.css`
declares locally (Nithya Ranjana + the six `FONT_CORE_SCRIPTS`), so **nothing awaited those at all**, and an
`@font-face` does not begin loading until layout asks for a glyph from it. `schemeFaceReady` names just two
families — `fontStackName(ORTHO_SCHEME)` and the first family of the live `--token-font` (never the whole
stack, which would fetch every declared face and defeat the on-demand design) — and waits. Measured: a
declared-but-never-painted face goes `unloaded`→`loaded` in **21 ms**; two warm calls cost **0.2 ms**.
`syncDocFonts` stays after the render and stays un-awaited — it is the download path and must not hold the
glyphs back.
⚠️ **AND A FILL ANSWERS FOR THE SCRIPT IT ASKED ABOUT.** There is no in-flight guard, and two picks in quick
succession run two fills; `orthoKeyOf` is (surface, UPOS) and says nothing about the scheme, so the older
answer passed the staleness test and overwrote the newer letters. Measured (Grantha, then Siddhaṃ 30 ms later):
the document settled on `ORTHO_SCHEME="Siddham"` at 2× over **Grantha** glyphs. `fillOrtho` captures
`ORTHO_SCHEME`/`DOCLANG` up front and bails after each await if either moved — `loadOrthoSchemes`'s own
`_orLangLoaded` guard, applied per fetch.

⚠ **`belowGap()` is why the rows still clear.** The step below a token was
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

⚠️ **A PUNCTUATION SATELLITE (the daṇḍa) SHARES THE ROW WITH THE WORD BESIDE IT, AND MUST SHARE ITS
RENDERING TECHNOLOGY TOO — round six, after five rounds that measured the SVG/`foreignObject` baseline
alignment to be geometrically exact (sub-thousandth-pixel) in every case tried and never found the report's
actual cause.** Rather than keep chasing a discrepancy geometry cannot see, the mixture itself was removed:
most scripts have no entry in `SCRIPT_DANDA` and fall through to the shared Devanagari `।`/`॥`, which is
plain BMP and so never trips `smpUnshaped()` on its own account — an SMP word (Grantha, Kawi, …) swapped to
`foreignObject` therefore still sat beside a daṇḍa left in plain SVG `<text>`, two rendering engines in one
row where `smpReshape` was meant to leave exactly one. `hangForm()` (`dandaGlyph()||p.form`) is drawn ONLY
by `drawHangsSVG`/`drawLeadsSVG`, and ONLY into a `<text>` wrapped in a `g.punct-sat` — that class is written
NOWHERE else in this file — so `smpReshape` now also swaps any `punct-sat` `<text>` it finds, but ONLY when
THIS render call already produced at least one genuine (SMP) reshape of its own (`hadSMP`, a first pass over
the same `texts` list). Gated on the row's own content, never on `ORTHO_SCHEME`/language in the abstract, so
a script with no SMP content anywhere in the sentence (plain Devanagari, Tibetan, Khmer, Burmese, Balinese/
Javanese — BMP scripts per `stackDropExtra`'s own note above — an English document, …) sees its daṇḍa exactly
as before: plain SVG `<text>`, untouched. Verified live (`samples/brihat_jataka.conllu`, wrapped arcs):
Grantha (SMP) — every daṇḍa now a `foreignObject`/`.fo-form`; the SAME sentence under Tibetan (BMP) or
Original (no script) — every daṇḍa still plain SVG `<text>`; POS/gloss/translit rows untouched in all three
(`.punct-sat` reaches nothing else); no `NaN` geometry; seam-mark placement is untouched by construction —
`svgFormSeamMark`'s offset comes from `tailW()`/`hangW()`, which measure the daṇḍa's ADVANCE WIDTH via the
ordinary (non-`smpUnshaped`) `meas()` path regardless of which technology paints it, so only the daṇḍa's own
paint changed, never any layout math a neighbour depends on.

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
register; at mag 1.5 it drew a ~22.5px hyphen beside the letters it annotates. Verified: 15px unscaled while the
forms are 22.5px.
⚠️ **AND RE-CENTRED ON THE WORD, NOT LEFT ON ITS BASELINE.** Sharing `y` (the word's baseline) is right when
mark and word are the same size, but at DIFFERENT sizes the same font has a DIFFERENT baseline-to-visual-centre
distance for each — `(fontBoundingBoxAscent−fontBoundingBoxDescent)/2`, which scales exactly with size. So the
22.5px word's own centre sits further above baseline than the 15px mark's does, and leaving the mark on the
shared baseline reads as sitting low against the enlarged letters beside it. `scriptMidEm()` measures that
ratio ONCE (any character — it is a property of the face, not the glyph) as `TOK_MID`, and `svgSeamMark` shifts
the mark up by `TOK_MID × wordPx × (1 − 1/mag)`: closed form, no second per-token measurement, and exactly 0 at
mag 1. Measured against Nithya Ranjana (TOK_MID 0.400, a 22.5px word): 3.00px — matches the word/mark centre
gap computed directly from both fonts' own ascent/descent to the same two decimal places.
⚠️ **And the MWT surface form keeps its top margin** (`mwtFormLead`): the literal 20 seats a
15px form ~9px below the tie, i.e. 20 minus that form's ascent, so at mag 1.5 the enlarged ascent ate the gap. Adding
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
script at magnified size then hangs its extra height ABOVE the row. `align-self:flex-start` puts the tall box's top at
the row top — but these faces reserve enormous ascents for their stacked marks, most of it empty, so top-aligning
the BOX alone drops the letters well below the number.
⚠ **SUPERSEDED AGAIN, by a smaller and more accurate lift.** The line is now shifted up only as far as
`scriptLiftEm()` (js/diagram/diagram-core.js) measures the SHIROREKHA to be — a token's
`actualBoundingBoxAscent` (its own ink top) subtracted from `fontBoundingBoxAscent` (the font's full,
mark-reserving ascent) — published as `--script-lift`, not the older `--script-asc` × (mag − 1) this
paragraph used to describe (that shifted by the FULL magnified ascent, past the shirorekha, into the
space reserved for stacked marks nothing on screen was using). `top:calc(-1 * --script-lift * --stext-fs
* --script-mag)` puts the head-line — not the box top — at the row top; the empty ascent above it
overflows into the gap above the block, where nothing is drawn.
⚠ **MEASURED AGAINST THE TALLEST TOKEN ON SCREEN, NOT ONE ARBITRARY SAMPLE CHARACTER.** The first cut of
`scriptLiftEm()` picked the first non-Latin character anywhere in `DOC` and measured only it — cheap, but
wrong the moment that character's own cluster wasn't the tallest thing the line actually draws. A REPHA
(र् before a consonant) only forms once its whole cluster is shaped: a Nithya Ranjana "मूर्तित्वे" measures
`actualBoundingBoxAscent` 81.40 of a 100 `fontBoundingBoxAscent` as a WHOLE WORD — the र्त repha reaching
almost to the font's own top — against 65.40 for "म" measured alone, or for "र्त" measured out of the
context that triggers the substitution. Lifting by the single-character number (h−65.40) put the repha
16% of the em ABOVE the row top it was supposed to land ON — the exact "shirorekha too high" this was
built to fix, reappearing because the sample it measured against wasn't the one actually drawn. Every
token's `ortho` on screen is now measured as its own full string (shaping intact) and the SHORTEST needed
lift — the tallest ink — wins: any other token would have to poke above the winner's own head-line to
need less, and a repha-free word simply lands a little below row-top rather than exactly on it, which is
the safe side of the trade-off. Scanning every token costs ~30ms cold (three sentences' worth of Noto Sans
Javanese tokens, once, when the scheme or magnification actually changes) and ~0.5ms warm on a
subsequently-measured 3,000-token document — negligible next to renderDoc() itself.
⚠ **AND `margin-bottom` MUST CARRY THE SAME SIGN AS `top`, NOT ITS OPPOSITE.** `position:relative` moves
the PAINT without moving the box the FLOW reserves, so `top:-N` alone leaves flow still ending where the
box's UNSHIFTED bottom was — an N-tall gap of dead space, not an overlap. A NEGATIVE `margin-bottom` of
the same N pulls the flow's own "row ends here" back up by that same N, closing the gap; a POSITIVE one
(the bug this read as `+`, until measured) adds to it, doubling it instead of closing it. Measured in
isolation: `top:-N` alone → an N-tall gap where flow expected none; `top:-N` with `margin-bottom:+N` →
2N; `top:-N` with `margin-bottom:-N` → 0, matching the unshifted layout. Every term is 0 at mag 1.
⚠ **THEN THE WHOLE `top` WAS REMOVED ON REQUEST — AND IS BACK FOR THE HANGING SCRIPTS ONLY.** The
`.stext-script` lift above was dropped for every enlarged Sanskrit script (the number and the block
controls were pushed DOWN by `calc(2em − 2ex)`/`calc(1.5em − 1.5ex)` instead, and then rescoped to
`:has(.stext-stacked)`), which left `--script-lift` published and read by nothing at all — including the
Grantha `snumCapHeightLiftEm` retarget, which has therefore never been on screen. It is back under a
SECOND name and a narrower gate, on the report "hanging status should also determine the alignment of the
running sentence": `--script-hang-lift` is `scriptLiftEm()`'s answer **published only for a
`HANGING_SCRIPTS` member** and a literal 0 for everything else, so Grantha/Javanese/Balinese/Kawi/Burmese/
Brahmi keep the un-shifted line the removal gave them (verified: their `.shead` screenshots are
byte-identical before and after) and only a script with a head-line to align BY moves. `--script-lift`
itself is still published and still consumed by nothing.
⚠ **AND FOR THOSE SCRIPTS THE em-BOX APPROXIMATION IS GONE, REPLACED BY THE BRACKETS' OWN MEASUREMENT.**
`scriptLiftEm()` now answers a `HANGING_SCRIPTS` member from `snumHeadlineLiftEm()` — the synthetic
`.shead` row `snumCapHeightLiftEm` already builds, but reading back how far the face's real head-line
(`scriptHeadlinePx`, the median ink ascent of the base letters) sits below the top of `.snum`'s DIGITS
(its baseline less `capHeightPx`, **not** its box top, which is ~4.6px higher at 13px). `scriptHeadlinePx`
is asked at `magFont(TOK_REF_SIZE)` — the identical string `centreBracketLift` passes — so the bracket and
the sentence number align to ONE measured line and share one memo entry; the em ratio is scale-free, so it
rescales to the running line's smaller size. Measured, head-line vs digit top, every hanging script:
**0.00–0.01px** (Devanagari lift 0.1104em, Gujarati 0.1294, Nandinagari 0.1104, Tibetan 0.0544, Rañjanā
0.1345, Siddhaṃ 0.1355, Soyombo 0.1045, Zanabazar Square **−0.1403** — negative, i.e. pushed DOWN, because
its `.snum` is already displaced by the `:has(.stext-stacked)` margin). The gap from the line to the row
below is unchanged to 0.01px in every case, and the block height to ≤0.5px. **The Tibetan line-height:2
half-leading correction is subsumed, not bypassed** — the synthetic row is laid out with `.stext-stacked`
on it, so the engine reports the half-leading rather than the arithmetic having to model it; the em-box
path and its Tibetan term stay below as the fallback for when the measurement returns null (no #doc, no
orthography yet, a face that will not measure). Grantha is not a member and is untouched.
⚠ **Gujarati and Nandinagari joined `HANGING_SCRIPTS` in the same report, overruling the round that had
excluded them** ("defined by dropping the shirorekha", "the head-strokes do NOT join"). Those readings are
true and were the wrong test: the list is consulted for an ALIGNMENT, and a rule need not be continuous to
be a line. Re-rendered against the app's own bundled faces at 64px, Noto Sans Nandinagari draws every base
consonant's head-stroke at ONE height (a dashed shirorekha) and Noto Sans Gujarati tops every letter flat
at one height. Both consumers move for them: the running line by the numbers above, and the brackets by
+1.01px (Gujarati) / +1.43px (Nandinagari), the same register as Devanagari's own documented +0.99px.

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

### Formats and conversion (`app/detect.py`, `app/convert.py`, `grammars/`)

Format is **detected** from the relation inventory, per sentence then per document: UD / SUD / mSUD.
SUD and mSUD are editable; UD is import/export only. Conversion runs grew (via `grewpy`) over the
`.grs` grammars — surfacesyntacticud/tools content with no declared licence, so **fetched on demand
onto the user's own machine** (`app/grammars.py`, a `module`-shaped extras tier next to
`app/macron.py`'s identically-motivated Latin-macron fetch — see `THIRD-PARTY-NOTICES.md`'s
"Resolved: `grammars/`") rather than vendored into this repo the way it once was. The direction →
strategy-name table (strategies are *not* uniformly `main`) lives in `app/convert.py`'s
`_GRAMMARS`/`_LANG_GRAMMARS` dicts, the authoritative source now that there is no committed
`grammars/README.md` to check alongside them. There is no universal SUD→mSUD grammar. Every
conversion entry point takes an optional `lang` (the frontend's `DOCLANG`, threaded through
`Api.import_ud`/`export_ud_to`/`convert_format`); `_LANG_GRAMMARS` prefers a language-specific
`.grs` over the universal one when that (language, direction) pair is covered — most
language/direction pairs aren't, and fall back to the universal grammar. **The mSUD directions are
held out of that table on purpose** and always run the universal grammar: the language-specific
mSUD grammars differ from it in how a fused word is SPELLED, not in its syntax (they pass grew an
explicit `"_"`/`" "` separator when concatenating the merged pieces' Translit/Tone/MGloss, so one
fused word came out spelled as several), and the fetched files are verbatim upstream copies a
re-fetch would revert anyway, so the fix lives in the table rather than in them.

grew's OCaml backend is an **optional external prerequisite, fetched on demand**: `app/convert.py`
picks up `~/.opam/*/bin/grewpy_backend` if opam has installed one — never a copy bundled inside the
app itself (`grewpy_backend` is CeCILL v2.1, GPL-family copyleft; bundling it would republish someone
else's work without a grant to, same problem the old vendored `grammars/` had). `app/grew_backend.py`
is the fetch: it drives `opam install grewpy_backend` (bootstrapping `opam init` first if this
machine has no opam root, and adding grew's own opam remote), the same `module`-shaped on-demand
extras tier `app/grammars.py`/`app/macron.py` use, wired into Manage Models as the "grew conversion
backend" row (`app/extras.py`'s `TIERS["grew"]`). It needs `opam` itself already on the machine
(`brew install opam` on macOS) — nothing here installs opam. Without a backend the app still runs
and edits SUD/mSUD — only UD import/export and conversion are disabled, surfaced as a toast. Keep new
features degrading that way rather than hard-failing.

⚠ **The backend is not optional to the STANZA ENGINE, and that is the consequence everyone misses.**
Stanza emits UD and this app stores SUD, so `parse._parse_stanza_ud_to_sud` runs the conversion
grammar on *every* Stanza parse — no backend, no grammar fetched (or both), no Stanza parsing at
all, however cleanly the model downloaded. **No build ships `vendor/` any more** (macOS used to,
copying `app web vendor`; that line is gone from both `make_portable.sh` and
`make_bootstrap_app.sh` now) — every platform's first launch has no grew backend until a reader
installs one, themselves, from Manage Models' "grew conversion backend" row (or the equivalent
`opam install` commands by hand — see README.md). Before this, macOS quietly carried the backend on
the user's behalf and every OTHER platform's user who had not built the app themselves had none and
found every Stanza model inert — reported as "the Stanza models do nothing"; that symptom is now the
same, and diagnosed the same way, on every platform, rather than macOS-only. The **Windows** build
has an extra wrinkle worth remembering: opam is a Unix-first tool with no first-class Windows story,
so a Windows user's own path to a working backend is less well trodden than macOS/Linux's. Manage
Models states the Stanza consequence at the top of that group whenever `conversion_available()`
reports no backend (`js/io/models.js`), so a user is told *before* a 400 MB download rather than by a
silent no-op after it.

**DEPS (enhanced dependencies) is not part of SUD and this app does not support it as a column an
annotator works in.** A save-time auto-fill that used to derive it from FEATS `Shared=Yes`/MISC
`Subject=...` ("Task E", `js/io/bridge.js`) is gone — those two annotations stay exactly where they
were (FEATS, MISC, the diagram's dashed "ghost" edges); they simply no longer get echoed into a
column outside SUD. A UD import runs the reverse direction instead (`app/convert.py`'s
`_deps_to_shared_subject`, called from `to_sud`'s `"UD"` branch): it reads the source file's DEPS for
the two enhanced-syntax constructs (universaldependencies.org/u/overview/enhanced-syntax.html) this
app already models as first-class SUD annotations — §2/§3 conjunct propagation → `Shared=Yes`, §4's
`:xsubj` control/raising extension → `Subject=SubjRaising|ObjRaising|OblRaising` — against the
CONVERTED SUD tree (grew drops DEPS outright; nothing survives conversion to read it off there), then
clears DEPS unconditionally. Everything else in DEPS (gapping/empty-node references, case-marking-
in-deprel, relative-clause `ref`+coreference) has no clean SUD-side representation this app already
draws and is simply dropped with the rest of the column — the deleted encoder refused to *write*
these for the same reasons this refuses to *read* them. `mwt`/`empties` DEPS cells are left exactly
as imported (an empty node exists only in the enhanced graph; blanking it would state nothing at all).

⚠ **UD→SUD PROMOTES a function word over its host, and the shared-PP evidence is filed on the wrong
side of that promotion.** UD writes `1835 -case-> in` / `in 1835 they arrived and enslaved …`; SUD
promotes the adposition (`in -comp:obj-> 1835`). A shared oblique's enhanced arcs are filed on the UD
HOST (the nominal, `1835`) — reading only the SUD dependent's (`in`'s) own DEPS would silently miss
every one of these. `_ud_counterparts` walks the SUD-promoted token's own UD head chain for as long
as it stays inside that token's SUD subtree (recognised structurally, not from a function-word
relation list, so it also follows a chain — `has been eating`: `has → eating` in one hop, since
`eating` sits under `has` in SUD) and reads DEPS off whichever UD token turns out to be the real
host. Verified live: `In 1835 settlers arrived and enslaved the Moriori` gives `In` (not `1835`)
`Shared=Yes`, matching the promoted SUD dependent that actually carries the relation.

⚠ **THE NO-CLOBBER RULE COMPARES VALUES, NOT PRESENCE — because grew's own vendored grammar already
WRITES Shared/Subject from the basic tree alone, guessing, before this pass ever runs.** Testing
merely "is something already there" would protect grew's own guess as if it were the file's word.
`_still_stated(src, dst, key)` asks instead: does the CONVERTED value still equal what the SOURCE
FILE stated for `key`? Only then is it authoritative and left alone. Measured, and not a
hypothetical: `She persuaded him to leave`, hand-annotated `Subject=Instantiated` on `leave` and
`3:obj|5:nsubj:xsubj` (a real enhanced arc naming `him`, not `she`, as the controller) on `him` in
DEPS — `UD_to_SUD.grs`'s `comp-obl_xcomp` rule fires on any marked xcomp and writes `SubjRaising`
**unconditionally**, so the file's own `Instantiated` is already gone by the time this pass sees the
tokens, *whether or not this pass runs at all* (confirmed: `ud_to_sud` alone, no DEPS layer, already
returns `SubjRaising` on `leave`). This pass cannot rescue what grew already overwrote, but it CAN
correct the wrong guess with the file's own enhanced-graph evidence — `SubjRaising` names `she`
(subject-control) where the DEPS arc names `him` (object-control), and `_subj_raise_target`'s crawl
against the converted tree resolves the `comp:obj` type to exactly `him`, giving the corrected
`Subject=ObjRaising`. Net effect: real evidence beats a shallow structural guess, even though neither
this pass nor grew's own conversion can preserve an annotator's value that carried no supporting
DEPS arc at all — that gap is `UD_to_SUD.grs` unconditionally overwriting `Subject`, a pre-existing
vendored-grammar behaviour this pass mitigates when DEPS backs a better answer and cannot fix when it
doesn't.

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

⚠ **NOT EVERY TIER IS A PIP INSTALL**, and `la_macron` (≈4 MB) is the one that is not: it fetches a
DATA file the Latin model cannot ship for licensing reasons and that is on PyPI in no form. A tier
therefore declares EITHER `pip` + `probe` OR `module` — the name of a module supplying its own
`available()`/`install(progress)`/`status()` — and `install()` dispatches on which. That `module`
shape sat unused for a while and is the extension point for exactly this; use it rather than bolting a
second install/progress/UI path beside the first. See `app/macron.py` under Language services.

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
- `app/macron.py` — **LATIN VOWEL LENGTH IS A SCRIPT SCHEME, AND THIS FILE CALLS THE MODEL RATHER THAN
  BEING ONE.** `_SCRIPT_SCHEMES["la"] = [("macron", "With macrons")]` (app/translit.py) puts `divisa` →
  `dīvīsa` on the Script pill beside Sanskrit's Brahmic scripts: display only, so the running sentence
  and the diagram glyphs re-render while the FORM column, the grid, the editors and the file keep the
  bare spelling. Nothing is ever written to MISC. The frontend names the off-row "Without macrons" and
  suppresses "None" (`orthoOffLabel`/`isLatinLang`, js/lang/translit.js), because Latin's one entry is
  not a writing system but a second SPELLING of the one it has — a two-state choice, and "Original"
  names it after the absence of a script it never had.
  ⚠ **The whole engine is the model's**, `la_macronise`, which `la_sud_ittb_proiel_perseus` 0.2.0 ships
  IN ITS DEFAULT PIPELINE (`token._.macron`/`doc._.macron`; SUD-spaCy `scripts/la_macronise.py`). This
  module is the one-module façade — availability, the fetch, and `resolve(form, upos, feats, lemma)`.
  ⚠️ **An earlier `app/macron.py` reimplemented all of it** — 912 lines, plus `_la_macron_vendor.py`
  (215) and the macOS-only `appledict.py` (599) — and 2cd6b14 deleted all three, correctly. Do not bring
  any of it back. The component is measured at 97.63 % whole-token against Alatius (98.23 % in
  vocabulary / 90.42 % out of it, cascading a harvested table into Morpheus), separates `malus` from
  `mālus` on UPOS alone through its `MP` rungs, honours a typed breve as a veto (`intĕllectam` →
  `intĕllēctam`) and keeps the caller's orthography (`jussit` stays `j`, `cælum` stays ligated). A
  lookup rung, a paradigm rule or a per-word correction written HERE is a duplicate of one already
  there.
  ⚠ **ALL FOUR ARGUMENTS, or the answer is wrong rather than absent.** `Gallia` Nom and `Galliā` Abl are
  one spelling separated only by FEATS, and the lemma supplies the declension where FEATS carries no
  `InflClass` — which is why `Api.orthography`/`orthography(_many)`/`_render_one` carry `feats`/`lemmas`
  beside `upos` and why all three are in `translit._CACHE`'s key. It is also why `orthoKeyOf`
  (js/lang/translit-load.js) appends them under `orthoNeedsMorph()`: the batch de-duplicates on that key,
  so keyed on (surface, UPOS) alone one `Gallia` in a document would decide the macrons of all of them.
  Verified live in both skins — 33 distinct keys in ONE bridge call, the two `Gallia` PROPN tokens
  answered `Gallia` and `Galliā`.
  ⚠️ **A MULTI-WORD TOKEN IS COMPOSED FROM ITS COMPONENTS** (`laMwtCompose`), because Morpheus lists
  WORDS and never host+clitic: the fused surface simply misses, and `multosque` came back bare in the
  middle of an otherwise macronised line. `multōs` + `que` → `multōsque`, accepted only where stripping
  the quantities off the join reproduces the stored form (French `du` = `de`+`le` is why that check is
  there). And the refresh hangs off `markDirty` (`scheduleOrthoMorph`), the one funnel every edit passes
  through, so ANY attribute moving re-renders the token rather than a list of write sites someone
  remembered — verified: a hand FEATS edit Abl→Nom takes `Galliā` back to `Gallia` and touches nothing else.
  ⚠️ **AND THE MSeg ROW SHOWS THE MACRONS TOO, AS AN OVERLAY ON `t.ortho` RATHER THAN A SECOND LOOKUP**
  (`laMsegMacron`, js/lang/translit-load.js; reached through `tierDisp`, js/core/prefs.js). Every other
  word-like row in the block already carried the lengths and the morphemic segmentation did not, which
  read as the feature not covering that row. `msegSegment` still derives the boundary from the BARE form
  against the BARE lemma and MISC `MSeg` still STORES it bare — same rule as FORM — so only the painted
  text moves: `Troi-ae` on file, `Trōi-ae` on screen, `o-ris` → `ō-rīs`. **Nothing recomputes the cut**:
  `la_macronise` returns `apply_mask(strip_macron(form))`, a per-CHARACTER substitution that inserts and
  merges nothing, so the bare string's cut indices are the macronised string's. That is asserted rather
  than assumed — every character is checked against its counterpart quantity-folded (`stripQuantity`, the
  fold `laMwtCompose` already trusts its join on) and ANY disagreement returns the stored text: a
  hand-rewritten MSeg that no longer spells its form (`zzz-qqq`, `Troi-a`, `Troi-aex`) shows exactly as
  typed, and so does a token whose rendering has not landed yet. Verified live over `samples/la_virgil.conllu`
  in all five notations with the model's own macronisations behind the bridge: MISC and FORM bare
  throughout, "Without macrons" reverts the row, a hand re-cut / a `=` seam / two cuts all overlay at the
  right positions. **⚠ Only the DRAWING sites read `tierDisp`** — the inline editor's proxy, `morphEdited`
  and `msegRefill`'s `_msegPre` guard all still read `tierText`, so the field opens on the bare
  segmentation (exactly as the form editor opens on the bare form under a script) and committing it
  unedited writes nothing and pushes no undo entry.
  ⚠️ **AND THE MSeg WRITE-BACK'S QUANTITY STRIP WAS DELETING THE MARKS IT EXISTS TO KEEP OUT.** An MSeg
  edit de-hyphenates its text and writes the word back to FORM; the Latin guard beside it strips macron
  and breve first so a hand-typed one cannot reach the file. But Latin treebanks DO spell some forms with
  a length mark — `samples/la_virgil.conllu` writes Virgil's `căno` with its metrical breve — and the
  stripped `cano` compared literally against the stored `căno` read as a changed word: measured, moving
  the boundary to `că-no`, an edit that touches no letter, rewrote FORM to `cano` and respliced `# text`.
  The comparison is quantity-folded where the strip ran (`moved()`, js/editing/context-menu.js), which is
  what the guard's own comment already promised. Verified: a boundary-only edit leaves FORM and `# text`
  byte-identical, a hand-typed `cā-no` still never reaches either, and a real letter change still writes.
  ⚠ **THE DATA IS FETCHED, NOT SHIPPED, AND IT LIVES IN THE COMPONENT'S OWN CACHE.** Morpheus is
  CC BY-SA 3.0 and the Latin wheel CC BY-NC-SA, so the wheel ships the pipe with no table (`--no-lut`);
  `install()` runs the component's own `fetch_morpheus()` (~4 MB → ~2.2 MB in `~/.cache/sud-spacy/`, or
  `$LA_MORPHEUS_TABLE`) as the `la_macron` extras tier — the `module` shape in `app/extras.py`, which
  until now had no user. **Its cache, not ours**: the deleted version fetched a table of its own into
  `paths.APP_DATA` and pointed the component at it through the environment (`parse._share_macron_table`),
  so one download served two places that could get out of step. One file, one owner, and the in-pipeline
  component macronises from the same data this display path does.
  ⚠️ **THE ENGINE AND THE DATA ARE TWO ABSENCES AND `available()` REPORTS ONE ANSWER.** There is no second
  copy of `la_macronise` in this app, so with no Latin model there is nothing to macronise with and
  nothing to fetch with either (`fetch_morpheus` is that component's function) — `install()` says which
  is missing rather than the UI reconciling two questions. Neither miss is memoised: the model can arrive
  through the Model Manager, and the table through another window or the SUD-spaCy CLI, mid-session.
  ⚠️ **NOT `_ext_misc`, and that is a decision, not an omission.** `Subject`/`Reported`/`Idiom` go to MISC
  because they are ANNOTATION the model predicts; a macron is a spelling the reader is shown. Writing
  `Macron=` would change the bytes of every Latin file this app parses AND would leave the Script menu
  dead on a file loaded from disk, which has no such key — the display path answers for both.
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
- `app/sud_rules.py` — parses the fetched grew validator patterns
  (`grammars/validator/modules/relations.json`, under `GRAMMARS_DIR` — see `app/grammars.py`) once
  and evaluates the handful of error-level relation↔POS constraints directly, rather than invoking
  grew per candidate.
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
  section below), Chinese in **TRADITIONAL** characters, and **Latin with its vowel-length marks
  taken off** (`_is_latin`/`_strip_quantity`). The wiki titles a Latin entry with the bare classical
  spelling and prints the lengths in the headword LINE, so `cano` answers while `căno`, `cānō` and
  `dīvīsa` all 404 — probed live. This is NOT the macron DISPLAY layer leaking (`app/macron.py`
  writes to no stored field, which is why the query is otherwise already bare): the mark comes from
  the FILE, `samples/la_virgil.conllu` spelling Virgil's `căno` with its metrical breve in FORM *and*
  LEMMA, and the flyout looking a token up by `tok.lemma || tok.form`. That one token's dictionary
  was simply unreachable. Macron and breve both, off the NFD string — the same pair, expressed the
  same way, as the frontend's `stripQuantity`. ⚠️ **Latin only**: everywhere else a diacritic is part
  of the spelling the wiki files the word under, and in the IAST this app stores Sanskrit in the
  macron is a different phoneme AND what the Devanagari conversion on the next line reads.
  `_strip_quantity` returns its argument UNTOUCHED when it holds no length mark, so a word that has
  none cannot be silently recomposed by the NFD/NFC round-trip. en.wiktionary
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
  read and `--dry-run`'d from macOS. **A real, non-`--dry-run` build has now been run from this
  machine** — `python3 packaging/windows/make_win_app.py dist` against the tree at `8aa18f5`, no
  drift found (all 14 required sources + 4 core fonts present, the dev-fixture-strip assertion still
  holds): 20–21 file operations, a 166-file/20.7 MB payload staged at `dist/win/SUD Workbench/`, and
  — see "Windows: what has never executed" below — a genuinely cross-compiled `.exe` rather than the
  `.vbs` fallback. That exercises every line in the script except the two things only a Windows
  machine can supply: winget/python.org actually installing something, and `iscc` actually compiling
  the installer (still open). `find_py.ps1`/`find_git.ps1`/`setup_venv.ps1`/`bootstrap.ps1` are the
  first-launch scripts, now parse-checked (not run) with a real `pwsh` — see below;
  `sud-workbench.iss` is the Inno Setup installer (per-user, unsigned), still never compiled.

⚠️ **Each bundle ships only its own chrome kit**, and every build fails if another platform's
survives. For macOS dropping `win11-kit/` is a size decision. For Windows *and Linux* dropping
`macos-kit/` is a **licensing** one: eight of `mac-tokens.css`'s `--sf-*` masks are real SF Symbols
(rendered at packaging time now, not committed — see `app/mac/sf_symbols.py`), and Apple licenses
those for apps on *Apple* platforms. The Fluent kit supplies all 41 masks from MIT sources on
Windows, so nothing is lost there. See `THIRD-PARTY-NOTICES.md`.

⚠️ **RESOLVED: `web/adwaita-kit/`'s two stylesheets used to `@import url("../macos-kit/…")` wholesale**
— which is exactly the directory `make_deb.sh`/`make_rpm.sh` strip for the licensing reason above.
Confirmed by extracting a real built `.deb` (found during this session, before the fix): `macos-kit/`
was genuinely absent, and `adwaita-kit/adwaita-tokens.css`/`adwaita-chrome.css` still contained
those two `@import` lines unchanged. A failed CSS `@import` degrades silently (no thrown error, just
zero rules contributed) — the 5/5 `xvfb-run` boot-checks below only confirm the *process* launches
without crashing, not that the page renders styled, so this gap went uncaught until an actual
extracted-`.deb` file check found it. **Fix:** `web/chrome-shared/` — everything `macos-kit/mac-
tokens.css`/`mac-chrome.css` used to declare directly, minus the eight real SF Symbols (which get
Fluent equivalents there instead, same MIT source `win11-kit/` uses), living somewhere no platform's
build strips. `macos-kit/` itself now just `@import`s that shared base then layers the real SF
Symbols on top; `adwaita-kit/` imports the same shared base directly. See `web/chrome-shared/
README.md` for the full account.

⚠️ **`wiktra` is a `git+` requirement and it is in `requirements-core.txt`** — so a first launch on
a machine without git fails inside pip. macOS almost always has git; Windows never does out of the
box, which is why `find_git.ps1` exists. It derives the need by *parsing* the requirements files, so
rewriting those URLs as archive URLs would switch the check off by itself.

### Linux (`.deb`, `.rpm`) and Nix — all three real, built and verified via Docker on this machine

Same architecture as macOS/Windows for the two distro packages — ship source, bootstrap a per-user
venv from the target machine's own `python3.12` on first launch, CORE deps only — deliberately
**not** used for the Nix flake, whose whole point is a hermetic build with every dependency, Python
included, resolved by Nix itself.

- **`packaging/linux/make_deb.sh`** + **`README.md`** — built and verified with real `dpkg-deb`/
  `apt install` inside fresh `ubuntu:24.04` containers. Found and fixed two real crash bugs in
  `app/linux/shell.py` (a double-hooked GTK theme-watcher event, a `Gdk.ModifierType` collapsed to a
  bare `int`) and the documented WebKitGTK ≥2.42 headless-rendering fix
  (`WEBKIT_DISABLE_DMABUF_RENDERER=1`). See that README for the full account, including the one
  known-and-not-fixed issue (an intermittent `app/api.py` `_apply_menu` GTK thread-safety crash,
  shared with macOS, out of packaging's remit).
- **`packaging/linux/make_rpm.sh`** + **`sud-workbench.spec`** + **`README-rpm.md`** — built and
  verified with real `rpmbuild`/`dnf install` inside fresh `fedora:41` containers, 5/5 clean
  `timeout 8 xvfb-run -a sud-workbench --empty` boot-checks. Reuses the `.deb` worktree's two
  `shell.py` fixes; its own distinct finding is that Fedora 41's default `python3` is 3.13 with no
  `python3.12`-targeted PyGObject build at all, so `--system-site-packages` cannot see `gi` — the
  spec instead declares the C-toolchain `Requires:` (`python3.12-devel`, `gcc`,
  `gobject-introspection-devel`, `cairo-gobject-devel`, `pkgconf-pkg-config`) and lets PyGObject/
  pycairo compile from source against the pinned interpreter at first launch. See that README for
  the full four-bug account and the file-naming reconciliation against the `.deb` build (three
  filenames collided with genuinely different content; the RPM's own copies are `find_py-rpm.sh`/
  `setup_venv-rpm.sh` at the repo level, installed at the ordinary runtime paths).
- **`flake.nix`** — a hermetic `python312Packages.buildPythonApplication`, Linux/NixOS-only,
  CORE-only, with nixpkgs pinned to a revision matching `spacy==3.8.14` and 14 PyPI wheels
  hand-packaged as Nix derivations (`wiktra` via `fetchgit`). `nix build .#default -L` verified to
  exit 0 for real inside the official `nixos/nix` container. Unlike the two distro packages this
  does **not** use the venv-bootstrap model — everything is resolved and built by Nix at
  package-build time, which is the point of packaging it this way at all.

## Windows: what has never executed

The Windows track was written from Microsoft's own MIT-licensed sources, and **no part of it has run
ON WINDOWS** — that header claim still stands and is the one that matters. What one verification
session changed is two of the sub-claims this section used to make about the macOS build box itself
("no mingw-w64/zig on this machine", "no `pwsh` here, so not even a syntax check") — both corrected
below, in place, with the measurement that supersedes each. Everything else is exactly as unverified
as it reads, and stays that way:

- **`app/win/` entirely** — DWM attributes, and whether Mica survives WebView2 at all (pywebview
  already asks DWM for it, so a failure there is WebView2 painting over it, not a missing call;
  Microsoft closed the equivalent Tauri report "not planned"). Mica is built to **degrade to an
  opaque themed background**, the same posture the codebase takes toward the grew backend — keep it
  that way. Also `IsNonClientRegionSupportEnabled`, `window.native.Handle.ToInt32()`, caption
  buttons, the registry accent (ABGR→RGB) and theme reads, `%LOCALAPPDATA%` resolution,
  `DETACHED_PROCESS`, `explorer /select,`.
- **The menubar against real keystrokes** — it renders and dismisses correctly headless, but Alt
  focus, mnemonics under a real IME, and the accelerator dispatcher have never met Windows. **Actual
  first-launch behaviour of the setup scripts on a real machine — `winget` installs, the WinForms
  progress window under WebView2's message pump, the registry accent/theme watcher — is likewise
  still entirely unverified**; see the parse-only check below, which deliberately proves none of this.
- ⚠️ **`launcher.c` HAS now been compiled — a real cross-compile from this machine — reversing the
  specific claim this section used to make ("no mingw-w64/zig on this machine").** `brew install
  mingw-w64` put `x86_64-w64-mingw32-gcc` (14.0.0_3, with its `isl` 0.28 dependency, ~1.4 GB) on
  `PATH`, and `make_win_app.py`'s existing toolchain probe (`find_win_cc`) picked it up with **no
  code change to either file**: `x86_64-w64-mingw32-gcc launcher.c -o "SUD Workbench.exe" -mwindows
  -Os -municode -lshell32 -lshlwapi` produced a 158,511-byte binary, twice, byte-identical both times.
  `file` reports it as `PE32+ executable (GUI) x86-64, for MS Windows`;
  `x86_64-w64-mingw32-objdump -f` confirms file format `pei-x86-64`, architecture `i386:x86-64`. **What
  this does NOT verify**: whether the `.exe` actually RUNS correctly on Windows — `wWinMain` spawning
  `setup_venv.ps1`/`bootstrap.ps1` with the right quoting, `SHGetFolderPathW` resolving
  `%LOCALAPPDATA%`, the `-mwindows` no-console guarantee holding in practice, the
  `GetCommandLineW`/`CommandLineToArgvW` round-trip on a real `.conllu` path with spaces. A
  cross-compile proves the toolchain and the source compile cleanly against real `<windows.h>`
  headers; it cannot execute the binary it produces.
- ⚠️ **All four `.ps1` scripts now PARSE clean, checked with a real `pwsh` — reversing "no `pwsh`
  here, so not even a syntax check."** The plan was a `mcr.microsoft.com/powershell` Docker container;
  Docker itself turned out to be unusable this session (see the `iscc` item below), so `brew install
  powershell` was used instead — 7.6.4, pulling in `dotnet` 10.0.302 as a dependency, no Docker
  involved. `[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens,
  [ref]$errors)` against each of `bootstrap.ps1` / `find_git.ps1` / `find_py.ps1` / `setup_venv.ps1`
  returns **zero** parse errors — 696/415/303/939 tokens, 35/5/2/18 top-level statements
  respectively. This is a SYNTAX check and nothing more, **deliberately not a run**: `Find-Py`/
  `Find-Git` call `Get-Command`/registry-adjacent APIs that behave differently on a real Windows box,
  `Start-Gui`'s `System.Windows.Forms` calls have never met WebView2's message pump, and no `winget`
  exists here to actually install anything. The marker vocabulary the launcher's fast path reads
  (`MSG`/`PROGRESS`/`DONE`) is confirmed to be well-formed PowerShell; whether it is ever actually
  *emitted* by a live run is untested.
- **`iscc` (Inno Setup) still has never run — the one artifact this session could not produce.** A
  Docker-based attempt was made as planned (`amake/innosetup`, which does publish an `arm64` image
  alongside `amd64` — confirmed via the Docker Hub API before pulling) and abandoned after it would
  not complete: `docker pull hello-world` (a few kilobytes) timed out at 60 s, and `docker system df`
  — a purely LOCAL metadata query, no network involved — timed out at 20 s. `docker ps`/`docker
  images` (no daemon I/O beyond reading local state) answered instantly throughout, which narrows the
  failure to the daemon's pull/build I/O path specifically, not the CLI, the socket, or this
  repository. That shape — trivial local queries fast, anything touching the Docker Desktop VM's own
  I/O hanging indefinitely — points at host resource contention (half a dozen other concurrent agent
  worktrees were active on this same machine at the time, per `git worktree list`) rather than at
  anything wrong with the `amake/innosetup` image, the network, or `sud-workbench.iss` itself, so the
  door stays open on a quieter machine or after a Docker Desktop restart. In its place,
  `sud-workbench.iss` was read in full against documented Inno Setup 6.3+ syntax — the
  `[Setup]`/`[Languages]`/`[Tasks]`/`[Files]`/`[Icons]`/`[Registry]`/`[Run]`/`[Code]` section shape,
  the `ArchitecturesAllowed=x64compatible` spelling 6.3 requires over the deprecated `x64`, the `#if
  LauncherKind == "exe" #else #endif` ISPP conditionals inside the `[Code]` Pascal Script functions —
  and found consistent with it. **That is inspection, not compilation**, and this session's own
  `.ps1` result is the reason not to overstate what a read-through is worth: those four scripts also
  "looked right" under inspection, and inspection is exactly what the parse-check above replaced with
  a real answer. `sud-workbench.iss` has had no equivalent replacement.
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
