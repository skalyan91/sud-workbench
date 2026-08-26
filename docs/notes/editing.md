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
