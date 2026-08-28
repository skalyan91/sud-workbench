# Editing invariants

`js/editing/` (edit-ops, context-menu, validation), `js/grid/grid.js`, `js/core/undo.js` — what a command may and may not do to the reader's selection, how a retag propagates through FEATS/MGloss, and when a merge is allowed.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

## Selection, and the caret in a contenteditable

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

## Menus, deletion, and ⌘⌫

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

## A drop must await its commit

⚠ **A DROP MUST AWAIT ITS COMMIT BEFORE RESTORING THE SELECTION.** `commitDrop`
(js/diagram/diagram-edit.js) captures the selection and puts it back, so dragging a token onto another
does not light up a token the reader never selected. Three of the four commit functions are **async** —
`setDiagramHead` awaits `depIsError` before writing anything, and its trailing `pick()` of the moved
token therefore runs a microtask later — so a synchronous `finally` restored first and the commit's own
pick put it straight back. It looked fixed and did nothing. `commitDrop` is now `async`, `_commitDrop`
RETURNS each branch's promise rather than discarding it, and the restore is awaited into last place.
⚠ A test with no bridge cannot catch this: `depIsError` returns immediately without one, closing the
very gap the bug lives in. Drive it with a stubbed `valid_deprels` that actually awaits.

## Retag → FEATS → MGloss, and re-heading

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

## Merging tokens (and Sanskrit sandhi fusion)

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

## Clearing a word class or a relation

⚠️ **A PICKER OF A CLOSED VOCABULARY CANNOT SAY "NONE OF THESE" ON ITS OWN.** Every row of the POS menu and the
relation menu SETS a value, and re-picking the current one is a documented no-op in both, so until now the only
routes to an empty word class or relation were the grid's own `(none)` option and its free-text DepRel cell —
and nothing in the diagram at all. `optionMenu` takes a `clearRow` ({label, fn}) which it appends in the same
trailing group as the guidelines link, and both menus pass one. It calls **`choose("")` — the very function
every value row calls** — so clearing goes down the one path that already knows what the edit entails: for a
retag, dropping the dot-suffixed subtypes, re-syncing XPOS where it mirrors, dropping a `Subject` only a
VERB/AUX can carry, retargeting the closed-class gloss prefix and re-asking the parser for the fields that
follow from the class; for a relation, `afterDeprelEdit` and the goeswith normalisation.

⚠️ **THE ROW IS OFFERED ONLY WHERE IT WOULD DO SOMETHING**, which is why the two conditions differ: the POS row
appears when there is a tag *or* a subtype hanging off one; the relation row appears when there is a relation
**and the token is not the root**. `head 0 ⟺ deprel "root"` is an invariant this app maintains at every other
edit site — `afterDeprelEdit` rewrites a head-0 token's relation back to `"root"`, and `afterHeadEdit` does the
same in the other direction — so a Clear row on the root would be a visible no-op.

⚠️ **AND THE HEAD CLEARS TOO — `clearHead`, which also clears the RELATION.** A deprel is a statement about an
EDGE, so keeping `subj` on a token with nothing to be the subject *of* leaves the file asserting something it no
longer has the structure to mean. That is the same reasoning `afterHeadEdit` already applies in the two
directions it knows (head 0 ⟹ `root`; away from head 0 ⟹ `root` demoted to `udep`); "no head at all" is the
third, and it is cleared in `clearHead` rather than inside `afterHeadEdit` because that function is the funnel
for EVERY head change and must not start blanking relations on the ordinary re-attach paths. ⚠️ **THE ORDER
MATTERS**: the deprel goes first, or `afterHeadEdit`'s own `depBase==="root"` branch rewrites a detached root's
relation to `udep` — a value nobody chose — instead of leaving it empty. `afterHeadEdit` still runs (the funnel
rule), and its `headSyncDeprel` already declines to ask the parser for a relation when there is no head to ask
about (`!(want>=1)`), so nothing refills it. Reachable from **Clear head** in the token menu's own head group
(beside the two rows that step through candidate heads — this is the third thing you can do to an attachment)
and from the grid's Head cell, which gained the explicit `(none)` option its UPOS neighbour already had.

⚠️ **AN UNATTACHED TOKEN WAS A LATENT CRASH IN TWO RENDERERS, and a half-annotated FILE could always produce
one** — `HEAD` is `_` there long before anyone clears a head from the UI. `bracketsWrapped` computed
`dparent[p]=head[p]-1`, which is `NaN` for an unattached token, and `dchildren[NaN].push(p)` threw at the top
level — blanking the whole app on any wrapped bracket view of such a sentence. And the OUTLINE walks from the
root, so anything the root cannot reach was simply not listed: in every other notation an unattached token still
draws in reading order and merely loses its arc, but there it vanished, along with everything hanging off it.
Both now take the view `structure()` itself takes of a headless token (its own `isNaN(h)||h<1||h>n` branch makes
it top-level): the bracket nests it under `root`, and the outline sweeps up whatever its root-first descent
missed — the same fallback `structure` applies to any token its own first pass never visits, which also covers
the far side of a head CYCLE.

⚠️ **CLEARING IS AN ✕ ON THE CHOSEN ROW, NOT A ROW OF ITS OWN.** It reads as what it is — the one value the
menu has actually SET, with the means to unset it attached to it — where a trailing "Clear …" row read as one
more option to pick. `optionMenu` hands it to whichever row carries the checkmark; the guidelines link goes back
to the full-width row it always was. ⚠️ **IT IS A RING, NOT A BARE GLYPH**, on report ("the ✕ needs to be circled, so it's actually visible"): at
this size a lone mark beside a label reads as a stray character, where the ring says "control".

⚠️ **AND IT SITS ON THE BASELINE, STRUCTURALLY.** `.rowclear` is a ZERO-WIDTH anchor that stays IN FLOW as the
last item of the `.lblgrp` — which is `align-items:baseline`, so the anchor's own bottom edge lands exactly on
the label's baseline with no magic number to keep in step with a font; `.rcx`, the ring, is absolutely
positioned against it, so `bottom:0` IS the baseline. Zero width is what keeps the other promise ("make sure the
✕ won't force the menu to be any wider" — a column is sized to its widest row). The ring is 9px, the label's own
cap height, so it occupies the band the capitals do.

⚠️ **THREE ROUNDS OF "IT SITS TOO HIGH" WERE ALL MEASURED AGAINST THE WRONG THING, and the fix was to look at
the pixels.** Box geometry said it was centred; canvas ink metrics in the shipping engine said it was centred to
0.08px. What finally showed the fault was a screen capture of a real WKWebView window — markers pinning the
viewport→screen mapping, the ✕ isolated by an A/B diff, printed one character per CSS px: a 10px ring centred on
the label's ink ran rows 7–17 where `DET`'s ink ran 7–16 and **the badge beside it ran 9–16**. The eye was
comparing it to its NEIGHBOUR, not to the label — 2px proud at the top, 1px under the baseline. ⚠️ **HEADLESS
CHROME CANNOT SEE ANY OF THIS**: it substitutes a face for `-apple-system` and put the same ring 0.75px BELOW
the label's ink where WebKit puts it 0.5px above. Measure this affordance in a WKWebView capture, never in the
CDP harness.

⚠️ **AND THE MARK INSIDE IT IS DRAWN, NOT SET** — two rotated bars in `::before`/`::after`. A `✕` GLYPH centred
by `align-items:center` is centred by its LINE BOX, and that box reserves descent space the character does not
use: measured with canvas ink metrics, U+2715's ink runs 5.4px above the baseline to 0.2px below, putting its
ink centre 2.6px above the ring's. Bars have no baseline to be asymmetric about — they are centred by
construction, at any size, in any font, including a fallback face substituted for a missing ✕. The element's own
text is empty as a result; the name lives on `aria-label`/`title`.

⚠️ **AND THE CURRENT VALUE ALWAYS HAS A ROW TO PUT THE ✕ ON**, even when it is outside the inventory the menu
offers — a tag or relation a FILE carries that `SETTINGS.upos`/`SETTINGS.deprel` doesn't list, or one the reader
has since removed from it. `optionMenu` appends `current` to its own option list when it is missing, and it
falls through the categorisation like any other unplaced option into "Other"/"Custom" — where the grid's
out-of-inventory values already appear. This replaced a first attempt that dropped the ✕ on such a row and fell
back to a trailing Clear row instead, which had it exactly backwards: an unfamiliar tag is MORE likely to want
clearing, not less, and the menu was also showing no tick at all for a value the token demonstrably had. The
trailing row survives for the one genuinely rowless case: no current value, yet something to clear — a token
with no word class that still carries a lexical SUBTYPE feature, which "Clear word class" drops with it.

⚠️ **AN EDGE NEEDS A FAT INVISIBLE HIT STROKE TO BE RIGHT-CLICKABLE AT ALL.** The stemma's and the hierarchy's
visible line is `--edge-stroke` (1.4–1.7px) and its casing halo is hoisted OUT of the `.edge-g` group into
`edge-casing-group` for z-order — so the only thing inside the group that hit-tests is that hairline, and the
menu below was reachable only by landing on it exactly. `.edge-hit` is the same `d` at 9px of transparent stroke
with `pointer-events:stroke`, appended FIRST so it paints over nothing; measured, ±6px off the line now resolves
to the edge's own group. The ARC views need none — `drawBump` keeps their `.arc-casing` (`pointer-events:stroke`,
+3.5px) inside the `.arc` group itself, so an arc already had a ~5px target that resolved correctly.

⚠️ **THE EDGE ITSELF OPENS THE RELATION MENU** (`posRelHit`'s third branch, `.edge-g`/`.arc`). It is the only
way in once the label is gone — an empty relation draws no label at all — and it is offered on every edge, not
only the unlabelled ones, since the arc is a far bigger target than its label and means the same thing. Those
groups already carry `data-s`/`data-dep` for the DEPENDENT, which is the token a relation belongs to and exactly
what `tokFromEl` reads. `.ghost-g` is deliberately excluded: a ghost duplicates an attachment drawn elsewhere
and names no edge of its own. Checked LAST, so a click landing on a label or a POS tag inside one of these
groups still resolves to that.

⚠️ **AND ITS TARGET IS THE ROW, NOT THE INK.** The placeholder's ink is one underscore — 4.8×14px measured —
and the rect around it was 16×14, barely more than the glyph: reported as "the hitbox is tiny, covering only
the underscore". It is 24×20 now, reaching UP into the clearance the tier already leaves under the POS baseline
(`avmTopGap`, ~10px of empty space) rather than down past the stack bottom, and the outline's own span takes
the same treatment through padding. Verified by hit-testing a grid of points: the whole 24×20 region resolves
to the placeholder, right-clicks 9px out horizontally and 7px vertically all open its menu, the POS row above
still resolves to `.tok-pos`, neighbouring tokens' targets stay 49px apart, and the outline's row heights are
unchanged (the negative block margin pays for the taller box). ⚠ IT IS DELIBERATELY NOT PUSHED INTO `boxes`:
`fitTight` would then grow the diagram's crop around an invisible rectangle, adding whitespace under every
token that has one.

⚠️ **THE PLACEHOLDER'S MENU IS THE "Add feature…" FLYOUT, OPENED IN PLACE** — same items (both go through
`addFeatureItems`) and now the same SHAPE: one fitted column, `subFit`-style, never the balanced two-column
layout `showCtx` switches to past 12 rows. On report ("right-clicking an AVM placeholder should ONLY bring up
the contents of the Add feature submenu"): the content was already exactly that — verified in all five
notations and in the wrapped-bracket overlay, none of which fell through to the token or sentence menu — so
what read as a different menu was the two columns. Measured after: 12 rows either way, identical row text,
130px against the flyout's own 132px.

⚠️ **THE ADD-FEATURE PICKER IS SCOPED BY WORD CLASS, AND THE MODEL IS WHAT MAKES THAT POSSIBLE.** The rule is
"only features compatible with the UPOS" — and the document's own usage cannot carry it alone: narrowing to what
is attested ON THIS CLASS is right where the class has attestation and silently fatal where it has none
(measured: **0** items for a PUNCT and for a PROPN, so `avmAddMenu` answered false and right-clicking the
placeholder did nothing — reported twice). Dropping the scoping instead was worse: it put Tense in a PUNCT's
picker, because some verb in the document had one.
`MODEL_FEATS_BY_UPOS` (`js/io/bridge.js` ← `app/parse.py`'s `model_feats_by_upos`) is the third source that
resolves it. The morphologizer's labels are JOINT — `POS=NOUN|Number=Sing` — so reading them WITHOUT throwing
the `POS=` half away yields exactly "which features go with which class", **in this language**: the only kind of
authority there is for that question, since it is a per-language fact and no universal table would be right.
`strictAttestedVals` unions it with the document's own class-scoped usage (a corpus may annotate what a model
never predicts), and `addFeatureItems` then stops there for a tagged token, empty or not. Measured against
`en_sud_ewt_gum`: NOUN → Number/Abbr, VERB → Number/Mood/Tense/Voice/Person/Abbr, PRON → +Gender/Case/Reflex,
ADP → Abbr, **PUNCT → nothing**.

⚠️ **AND THE PICKER IS ORDERED THE WAY THE AVM TIER LAYS A TOKEN OUT** — the AGR block first (Person, Number,
Gender, Clusivity, in `AVM_GROUPS`' own order), then TAM (Tense, Aspect, Mood, Evident), then everything else in
GLOSSING order (`MGLOSS_FEAT_RANK` — the sequence the morphemic tier already writes its abbreviations in), and
anything in neither table last, alphabetically, so an unknown feature has a stable place rather than a random
one. ⚠️ **THE SAME RANK NOW ORDERS `avmStruct`'s OWN TAIL**, which used to walk `Object.keys(UD_FEATS)`: one
function both call is what makes "the menu is sorted the way the AVM is" true by construction rather than by
two lists happening to agree. Measured: a VERB offers Person, Number → Tense, Mood → Abbr, Voice; a PRON adds
Gender to the block and then Case, Reflex, Abbr; and a token carrying eight features draws
AGR(Person,Number) · TAM(Tense,Mood) · Case · Degree · Definite · Voice in both places.

⚠️ **AN EMPTY LIST FOR A TAGGED TOKEN IS A REAL ANSWER** — "this class takes no features here" — and the gesture
then falls through to the ordinary token menu rather than opening a picker of things that cannot apply. The
document-wide and whole-inventory fallbacks survive only for a token with NO class, where there is nothing to
scope BY: scoping by `""` asks what other untagged tokens carry, which is nothing, and the inventory itself is
all a fresh document with no model has to offer. Same judgement as the annotation rules in `CLAUDE.md`: an
honest blank beats an invented feature set.

⚠️ **AN EMPTY UPOS OR DEPREL IS A THING THE FILE CAN SAY**, so nothing downstream needs teaching: `_blank`
(`app/io_conllu.py`) writes `_` for either, `depIsError` returns false for an empty relation (so a cleared one
never blocks a re-head drag), and `reparseTokenFields` never writes `upos` back unless a caller asks for it
(`opts.upos`, the split-token path) — which is what stops the background re-parse from refilling a class the
reader has just cleared. What the reader sees afterwards is the tier's own placeholder — see the empty-value
placeholder in `diagram-rendering.md`.
