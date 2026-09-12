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

⚠ **A MENU IS DISMISSED ON `pointerdown`, NOT ON `click` — BECAUSE A CLICK IS NOT GUARANTEED TO EXIST.**
The outside-click dismissal has been fixed twice and the first fix (capture phase, so an element that
stops propagation cannot swallow it) was only half of it. A `click` is dispatched only where the press
and the release share a target, so any field that RE-RENDERS ITSELF on the press dispatches none at
all, and a listener waiting for one waits for ever. Measured over CDP with real mouse events, a token
menu open, clicking each target:

| target | `click` dispatched | menu dismissed |
| --- | --- | --- |
| `.tg-text` (a translation) | **no** | **left open** |
| `.sid-in` (the sentence id) | **no** | **left open** |
| `.stext`, a toolbar button, a status-bar pill, the page background | yes | dismissed |

Perfectly correlated — and it is why the earlier fix looked complete, since every target tried by hand
happened to be one that dispatches a click. `ctxDismissOutside` is now bound to **both**
`pointerdown` and `click` in capture (js/editing/context-menu.js): the first always fires and is the
gesture's first event, the second covers a keyboard activation that has no pointer event at all.
⚠ **`closeDrawers` (js/ui/wiring.js) IS THE SAME LISTENER PAIR** and already carried this fix, written
after the same measurement, while the menus never got it. The two must not drift — one press has to
dismiss both.

⚠ **AND A `.ctxtrigger` EXCLUDES ITSELF FROM THAT DISMISSAL, WHICH IS WHAT LETS A TRIGGER TOGGLE.**
The Format pill did not shut on a second click: `fmtMenu` decides "already mine, so close" from
`ctx.classList.contains("show")` (js/io/formats.js), and the dismissal above had already closed the
menu, so the second click read it as absent and reopened. Verified to predate the `pointerdown`
listener — removing that listener at runtime and re-running gave the identical failure — so the
capture-phase dismissal had been eating the toggle since it landed.

**The fix is the idiom the other pills already use, not a new one.** `#translitPill` and `#orthoPill`
exclude their own trigger from their outside-close (`!e.target.closest("#translitPill")`,
js/lang/translit.js) and toggle correctly BECAUSE they do; they were never affected because their
menus are their own elements rather than the shared `#ctx`. `ctxDismissOutside` now skips a press on
anything inside a `.ctxtrigger`, and `#fmtPill` wears that class — a class rather than an id list, so
context-menu.js goes on knowing nothing about which pills exist and a future trigger opts in by
wearing it. Clicking the pill while ANOTHER menu is open is unaffected: nothing is dismissed, `fmtMenu`
finds a stamp that is not its own, and `showCtx` replaces the menu outright (measured: a token menu
becomes the Format menu on one click, rather than being left standing under it).

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

## Which features (and which of their values) a word class may take

⚠ **THE FEATURE WAS SCOPED PER CLASS; THE VALUES NEVER WERE.** Reported as "why does the NOUN submenu
contain POS subtypes that are clearly verbal?" — and it was never only NOUN. `subtypeFeatsFor` asks
which features a class may carry (`UPOS_SUBTYPE_ON`), but the values then came off `attestedFeatVals(f)`,
which scans the whole DOCUMENT regardless of word class and falls back to UD's entire list when nothing
is attested. So every class was offered whatever values the document happened to use *anywhere*.
Measured on the dev fixture, before and after:

| class | before | after |
| --- | --- | --- |
| NOUN | `VerbForm[Fin/Inf]` | `VerbForm[Part/Vnoun]` |
| ADJ | `VerbForm[Fin/Inf]` `PronType[Art/Rel]` `NumType[all 7]` | `VerbForm[Part]` `PronType[Int]` `NumType[Ord/Mult/Frac/Sets/Dist]` |
| DET | `NumType[all 7]` | `NumType[Card/Sets]` |
| ADV | `PronType[Art/Rel]` `NumType[all 7]` | `PronType[Int/Rel/Exc/Dem/Tot/Neg/Ind]` `NumType[Card/Ord/Mult/Dist]` |
| VERB | `VerbForm[Fin/Inf]` | `VerbForm[Fin/Inf/Sup/Part/Conv/Ger/Gdv/Vnoun]` |
| PRON | `PronType[Art/Rel]` | `PronType[` all 11 `]` |

⚠️ **NOTE THE LAST TWO ROWS: THE SAME BUG WAS ALSO HIDING LEGITIMATE OPTIONS.** Document-wide
attestation is not merely too loose, it is the wrong question in both directions — VERB could not be
given `Conv` or `Part`, and PRON could not be given `Dem`, because the little fixture document had
never used them, while NOUN was offered `Fin` because a VERB somewhere had.

**The tables are derived, not written by hand** (`FEAT_UPOS` and `SUBTYPE_VALS`, js/grid/grid.js): from
the UD validator's own permitted-features data — `data/feats.json` in `UniversalDependencies/tools`,
what `validate.py` checks a treebank against — over its 286 languages, universal features only. A bare
union across 286 languages is useless (some language permits VerbForm on PUNCT), so one stated rule
does the cutting; the value-level table needs **two clauses**, because the question has two directions
and either alone gets a real pair wrong: 20 % of the value's most-permitting class ("is this class a
normal home for this value?") **or** 80 % of that class's own most-permitted value ("is this value a
normal choice for this class?"). The first alone drops `DET.Card` — 28 languages, but `Card` lives
overwhelmingly on NUM — while it is the only NumType most of those 28 give a DET; the second alone
keeps `NOUN.Fin`, the reported fault. Both together keep DET.Card and drop NOUN.Fin.

⚠ **AND THE TABLE IS A DEFAULT, NEVER A VETO.** `subtypeValsFor` unions the ceiling with
`strictAttestedVals(f,U)` — this document's own tokens of that class, plus the model's own labels for
it. Verified: in a document that really does annotate a NOUN with `VerbForm=Fin`, NOUN's flyout offers
`Fin/Part/Vnoun` again. A corpus that annotates something unusual is evidence, and is believed.

⚠ **AND THE ESCAPE HATCH IS THE UD INVENTORY FOR THE CLASS, MINUS WHAT THE MAIN LIST ALREADY OFFERS.**
It took three readings to settle, and both rejected ones are kept because each looks right until it is
used:

1. *Per feature* — carrying only features with NO attestation at all for the class. The narrowing it
   escapes is per VALUE, so a feature the document used in PART was unreachable in the rest of itself.
   Reported as "why am I only seeing `1` under the Person options?"; measured on
   `samples/english.conllu`, an AUX offered `Person=3` alone — the only person any AUX in that file
   carries — with `Person` nowhere in the flyout.
2. *The whole inventory, overlapping the main list* — "it should show the whole UD inventory! The main
   menu already shows the subset that's attested in the document" — corrected again to the rule above:
   "the UD list MINUS what's already attested".

So **the two lists partition the inventory** and neither repeats the other: the main list is what this
document uses for this class, the flyout is everything else UD defines for it. A feature appears in
both only where each has a value the other has not — `Person` on an AUX is `3` above and `1/2/4/0`
here, on a PRON `1,3` above and `2/4/0` here, on a NOUN nothing above and all five here — and one with
nothing left over is omitted entirely.

⚠ **THE ESCAPE HATCH IS "OTHER FEATURE…", AND IT IS A TOP-LEVEL ROW ONLY.** Asked for with the AVM
placeholder menu: the main list answers from evidence and stops there for a tagged token, which leaves
a feature the class plainly takes — in a document that has not used it, under a model that never emits
it — unreachable. `otherFeatureItems` (js/editing/context-menu.js) offers exactly those, filtered by
`FEAT_UPOS`, so it is not the old unfiltered fallback under a new name: a PUNCT gets Deixis/DeixisRef,
not Tense.

⚠️ **AND IT IS REACHED FROM THE FLYOUT TOO, BY DRILLING** — superseding this note's own earlier record
that it "hangs off `avmAddMenu` rather than `addFeatureItems`". The constraint that forced that stands
and always will: there is exactly **one** flyout layer (`ctx2`), so a row carrying `sub:` inside a
flyout would have to rebuild the element it lives in, and the token menu's own "Add Feature…" already
IS a flyout. What changed is the request — "the Add Feature flyout should itself have a flyout that
shows the full POS-relevant UD inventory (minus the features already attested in the document)" — and
the answer is the one the POS menu settled on for the identical problem: **"Other Feature…" REPLACES
the flyout** (`reopenFeatSub` re-opens `ctx2` off its own `_owner` at its own `_colSize`, carrying the
`subFit`/`subNoWrap` literals the element does not remember), and **"‹ Attested Features" comes back**.
Deliberately the same gesture, and the same two labels one noun apart, as "Other Subtype…" /
"‹ Attested Subtypes": a reader who has learnt one has learnt the other.

⚠️ **AND THE SAME ESCAPE HATCH EXISTS ONE LEVEL DOWN, PER FEATURE, NOT ONLY FOR THE WHOLE LIST.** On
request: "the context menu should have 'Other' flyouts for the individual categories as well as for
features more broadly, just like when right-clicking an existing feature." `avmValueMenu` (an EXISTING
feature's own menu) had always offered both — an "Other `feat`…" row beside each already-set feature's
values, AND (via `addFeatureRow`, appended last) the whole-list escape hatch — but `addFeatureItems`
(a feature NOT yet set) only ever had the second half: a feature this list offers from evidence, with
only SOME of its UD values attested, had no way back to the REST of that one feature's own inventory
short of leaving this list and hunting the combined "Other Feature…" flyout for its header. `build`'s
own per-feature block (js/editing/context-menu.js) now closes exactly as `avmValueMenu`'s does —
`otherCands = UD_FEATS[f] minus the values just shown`, and a row for it when that is non-empty.
⚠️ **IT SINKS TO THE TAIL, on the SAME terms `avmValueMenu`'s own copy already does, not a new rule
invented here**: a `null` closes the header group the row would otherwise sit in (`renderMenu`'s own
`closeGrp`), so it renders below every group rather than under its own feature's column — measured
against `avmValueMenu`, which has stood this way, accepted, all along.
⚠️ **AND IT FORKS ON THE VERY SAME `drill` FLAG THE WHOLE-LIST ROW ALREADY FORKS ON**, because it is
the identical question asked one level down: is THIS rendering of `addFeatureItems`'s list living
top-level (`avmAddMenu`, `drill` unset — ctx2 is free, so the row owns a real `sub:`, exactly as
`avmValueMenu`'s copy does) or already inside `ctx2` (`addFeatureRow`'s own "Add Feature…", `drill`
true — nowhere further to nest, so it `reopenFeatSub`s instead, with its own "‹ Attested Features"
way back to this very list, precisely as the whole-list row already does). One flag answers both,
because `build` is a closure inside `addFeatureItems` and so already has it in scope. Verified live
(headless-Chrome CDP, `samples/english.conllu`, si 7 "board" NOUN `Number=Sing`): the "+" placeholder
(top-level) and the token menu's "Add Feature…" flyout (nested) both list `Gender[Masc]` and
`Definite[Def]` with an "Other Gender…"/"Other Definite…" row apiece; clicking "Other Gender…" from
the placeholder opens a dismissable `ctx2` flyout of `Fem/Neut/Com` with no way back (a real `sub:`,
`#ctx` still standing behind it); clicking the identical row from inside "Add Feature…" reopens the
SAME `ctx2` with the same three values plus "‹ Attested Features", which restores the list it came
from. Zero runtime errors in either skin.

⚠️ **NOTHING ATTESTED → THE FLYOUT *IS* THE OTHER LIST**, `posSubItems`' rule, and adopting it here
re-opened a door the attested-only rule had quietly closed: a tagged token whose class this document
attests nothing for used to get **no "Add Feature…" row at all**, so the features UD plainly gives that
class were unreachable from the token menu. The honest-blank rule that empty list was justified by is
about not INVENTING an inventory; the UD inventory for a word class is not invented. The two lists
still partition — verified live on `samples/english.conllu`, a plural NOUN: 2 attested (feature,value)
pairs, 113 in the other list, **0 in both**.

⚠️ **THE DRILL IS WHY THE STALE-FLYOUT-CLASS BUG HAD TO GO FIRST.** Drilling walks a 3-row list → a
114-row one (which earns the search band, `ctx-sub-srch`) → back to the 3-row one, all in the one
element. Until `openSub`'s `render` learnt to drop that class, the trip back landed on a flyout with
`padding-inline:0` and no `.ctx-sub-scroll` to carry the inset — rows flush against the glass. Measured
after: 12px / 0px-with-a-12px-port / 12px across the three steps.

⚠️ **AND IT IS THE FIRST SUB ROW ON A FITTED MENU, WHICH MOVED `openSub`'s WIDTH CAP TWICE.** That cap
is `max(parent, 224)`, and its own note said the 224 floor was safe because "only a `.defctx` menu can
be narrower, and none of those has a sub row today" — true when written, and false the moment this row
existed. The flyout came out at 224px hanging off a 148px menu, against 128px for the SAME shape of
list in "Add feature…", so a `.defctx` parent now caps at its own width (floor 120px): the rule the cap
already states one line up, that a panel hinged off a menu shouldn't outgrow the menu it hangs from.

**Then the cap had to learn to give way** — "don't cap the width if it would lead to line wrapping".
At 148px the flyout wrapped **38 of its 122 rows** (`Grpa` / `greater paucal` over two lines), because
capping a shrink-to-fit panel is exactly the same instruction as "wrap". A cap is a tidiness and a
wrapped label is not tidy, so `subNoWrap` on the row lets the cap rise to the flyout's max-content
width — 280px here, 0 rows wrapped, while "Add feature…" stays at the 128px it already fitted in.
⚠ **OPT-IN, BECAUSE THE WIKTIONARY FLYOUT IS THE OPPOSITE CASE** and always was: its rows are SENSES,
whole clauses in `.mlbl` that `.ctx-sub.defctx` wraps deliberately, and uncapping it would make a menu
as wide as the longest definition in the dictionary. That is also why the existing header/label floor
CLAMPS itself to the cap — the clamp is right for that flyout and wrong for these.
⚠ **AND THE HEIGHT CAP HAD THE SAME FAULT, one line below the width one** — "why does the flyout have
such a ridiculously small height cap?!". `maxHeight` was `min(420, 70vh, parentHeight)`, on the rule
that a panel shouldn't outgrow the menu it hangs from — a statement about ORDINARY menus. A `.defctx`
menu fits its own content and can be two rows, so a 122-row flyout hanging off a 200px placeholder menu
was squeezed into 154px of scrolling viewport. A fitted parent no longer bounds it: 393px now, the
420px cap rounded down to whole rows. Both caps therefore read the same way — **a fitted menu is not a
length to measure anything against.**

⚠ **AND IT MEASURES BY LAYOUT, NOT BY FONT STRING**: clearing the cap lets the panel shrink-to-fit to
its max-content width, which is by definition the width at which nothing wraps. The floor beside it
reconstructs row widths from font strings, which is the class of measurement this repo's notes warn
about (the two engines disagree); asking the engine avoids the question. Bounded at half the window,
since a flyout running off the screen is a worse answer to a long row than a wrapped one.

⚠ **AND THE SUBTYPE FLYOUT SPLITS THE SAME WAY THE FEATURE MENU DOES** — "the UPOS submenus should
likewise be limited to POS-relevant attested options, with a flyout listing the full POS-relevant UD
inventory with a search bar". So the flyout is now what this document attests FOR THAT CLASS
(`subtypeValsAttested` — its own tokens plus the model's own labels for it), and "Other subtype…" opens
the rest of what UD gives the class (`subtypeValsOther` = `SUBTYPE_VALS` less the attested). Measured on
the fixture: VERB attests `Fin/Inf` and its other list is `Sup/Part/Conv/Ger/Gdv/Vnoun/Abbr`; DET
attests `Art` with fourteen behind it — which is over `SUB_SEARCH_MIN`, so that one opens with a search
field.
⚠ **AND A CLASS THAT ATTESTS NOTHING OPENS STRAIGHT INTO THE OTHER LIST** — "if there are no attested
subtypes for a given UPOS, the submenu should directly show the Other state". A flyout whose only row
is "Other subtype…" asks the reader to confirm that an empty list is empty; the drill-down earns its
gesture only where there is something above it to drill down FROM. No way-back row there either: there
is no attested list to return to, and offering one would land on the very row that would have to send
them here again. Measured: NOUN opens on `Part/Vnoun/Abbr` (badge 3), ADJ on its nine, ADP on `Abbr`
alone — and the badge counts what the flyout actually holds in either shape.
⚠ **IT REPLACES THE FLYOUT RATHER THAN NESTING, AND THAT IS FORCED.** There is exactly one flyout layer
(`ctx2`), so a `sub:` row inside a flyout would have to rebuild the element it lives in. The row reopens
`ctx2` off the SAME owner — the POS row in the parent menu, kept as `ctx2._owner`, at the size kept as
`ctx2._colSize` — so the new list lands exactly where the old one was with the POS menu still standing.
A new `keepOpen` item flag is what stops the row's own click closing that menu first, and a
"‹ Attested subtypes" row returns, so the drill-down is not a one-way door.
⚠ **BOTH THE DRILL-DOWN ROW AND THE WAY BACK RENDER LAST WHATEVER THE LIST SAYS**: `renderMenu` collects
every row that precedes the first `header` into a TAIL and appends it after the groups. Pushed at the
front, the back row still came out at the bottom — with its separator BELOW it, which is the only part
of that a reader would have noticed. Both are now written where they land.

⚠ **THE GRID'S FEATS KEY LIST TAKES THE SAME TABLE** (`acKeyItems(col,upos)`), so the two pickers for
one column cannot answer differently — and `FEAT_UPOS` is unioned with the curated `UPOS_SUBTYPE_ON`
to guarantee that. **Its doc-only half had to be scoped too**: `docPairKeys` scans every token of any
class, which put Tense and PronType straight back on a NOUN and ten features back on a PUNCT after the
table had just removed them. `docPairKeysForUpos` is the analogue of `docPairValsForUpos` one level up.
Measured: a PUNCT's list went from 17 of 28 features to 6, a NOUN's from 27 to 20, an untagged token
keeps all 28 — there is no class to scope by, and the whole inventory is the honest answer.

## A flyout long enough to scroll gets a search field

⚠ **BUILT IN `openSub`, NOT BY THE CALLERS** — "the flyout should have a search bar (as should the
equivalent flyout anywhere else)", and one implementation is how "anywhere else" comes for free.
`liftSearch` is `liftFootLink`'s twin: a fixed band, a scrolling rest, reusing that pair's own CSS
shape in both kits. It appears at **14 rows** (`SUB_SEARCH_MIN`) — a little over a capped flyout's
screenful — so "Other feature…" (122 rows) and a DET's subtype flyout (15) get one while "Mark as…"
(3) and a VERB's subtypes (9) do not.

- **The match is a word prefix, not a substring**, and it is `wordPrefixRe` (js/core/state.js) — the
  very function the Languages menu and the translation drawer search with, so all three answer a query
  the same way. Both halves of a row are searched, because half of them say what the other half means:
  `Ptan` is findable as "plurale tantum", `Dat` as "dative". **A header carries its whole group**:
  typing a feature name asks for that feature's values. Measured — "per" → the Person group entire,
  plus `Case=Per` (perlative) and DeixisRef's two rows; "dative" → `Case=Dat` alone; "zzz" → nothing,
  and a "No match" note.
- ⚠ **THE WALK IS OVER DESCENDANTS, NOT `children`.** `renderMenu` nests rows in a column element, so
  the first version filtered nothing at all while still showing "No match" beneath 122 visible rows —
  the one state that cannot be true, and the tell that the walk was looking at the wrong depth.
- ⚠ **IT FOCUSES ONLY WHEN THE FLYOUT WAS OPENED DELIBERATELY.** These flyouts also open on HOVER,
  after 140ms, for a pointer merely travelling down the menu; a field grabbing the keyboard as the
  pointer passes would swallow the next thing typed anywhere in the app. `raise(byClick)` carries that
  distinction through `openSub` to `liftSearch`, so a click (or the right-click that opens a subtype
  flyout) focuses and a hover does not. Verified both ways.
- **Enter takes the first row still standing**, which is what makes the field worth typing into rather
  than a filter you then have to aim at. Verified: "dative" + Enter sets `Case=Dat` and closes.
- `fitWholeRows` pays for the band exactly as it already pays for the footer, or the last row it
  accepts overflows the box and is clipped.

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

⚠ **AND IT DROPS THE FEATURES THE NEW CLASS CANNOT CARRY.** On report ("retagging should remove
incompatible features, in general"). `clearFeatsForUpos` (js/io/bridge.js) is the generalisation of the
`clearSubjIfNotVA` this app had for `Subject` alone — same funnel, same four retag sites (the POS menu, both
subtype flyouts, the grid cell) — and it now also clears every feature `featOnUpos` says the new class does not
take, so retagging a VERB carrying `Mood=Ind|Number=Sing|Tense=Past` to NOUN keeps the number and drops the mood
and the tense rather than asserting either of a noun.

What each class refuses is the table's answer, not a hand-written rule, and it is worth knowing that the answer is
not the obvious one: **`Case` survives a retag to VERB** (converbs and verbal nouns inflect for it), while
`PronType`, `NumType`, `Poss` and `NounClass` do not.

| retagged to | drops |
|---|---|
| `VERB` | NounClass, NumType, Poss, PronType |
| `NOUN` | Aspect, Evident, Mood, NumType, PronType, Reflex, Tense, Voice |
| `ADJ` | Aspect, Clusivity, Evident, Mood, Person, Polite, Reflex, Tense, Voice |
| `PRON` | Aspect, Degree, Evident, Mood, NumType, Tense, VerbForm, Voice |
| `X` | everything the table scopes at all — an unanalysable token asserts nothing. `Foreign=Yes` and `Typo=Yes` survive it, being absent from the table |

**This is the only place in the app that deletes a feature the reader typed, and the narrowness is the point.**
A feature is a statement ABOUT A WORD CLASS, so a retag does not preserve `Case=Erg` on a token that has stopped
being a noun — it contradicts it. The parser may never delete one at all (`prior_feats`, `parsing-models.md`);
the difference is whose gesture it was, and nobody but the reader gets to draw this conclusion. Three restraints
keep it there:

* **The table answers only where it has an opinion.** A feature ABSENT from `FEAT_UPOS` is unrestricted, never
  "no classes" — which is what keeps `Typo`, `Foreign`, `Shared`, `Deixis` and `ExtPos` (all hand-placed, or
  SUD's own, or simply not the validator's to answer) clear of this altogether.
* **An untagged token loses nothing.** `featOnUpos(f, "")` is true by construction: *Clear word class* says
  nothing about the word, so there is nothing for a feature to contradict.
* **It says what it dropped**, in a toast naming the pairs. Deleting hand-typed annotation silently is the fault
  the `prior_feats` work has just removed from the parser; doing it in the retag path instead would only move it.

⚠ **…AND THE SAME GESTURE FILLS WHAT THIS WORD WAS LAST GIVEN UNDER THAT CLASS.** On request: under a
generic or custom model — or none — a token that GAINS a UPOS takes the FEATS and the glosses of the
nearest earlier token with the same `form` and the same new `upos`, verbatim.
`inheritAnnotationForUpos` (js/io/bridge.js) is a **SIBLING of `clearFeatsForUpos`, never a line
inside it**: that function returns the pairs it dropped and has callers that need it to stay a pure
question about the FEATS column, and the two are opposites worth keeping legible as a pair — the
retag DELETES what the new class contradicts and FILLS what the annotator has already said about this
very word under this very class.
⚠️ **THE TWO ARE AT THE SAME FOUR SITES**, and it has to stay that way: the POS menu, both subtype
flyouts and **the grid's own UPOS cell commit** (`commitCell`'s `key === "upos"` branch,
js/grid/grid.js). A retag is one gesture whatever route it is made by, so a site that clears without
filling would make the same click mean two different things depending on where the reader made it.
The grid's line sits right after `uposSyncGloss(t, oldUpos)` — inside that cell's own undo snapshot,
and ahead of the `regenTok` two lines below, exactly as the other three sit inside their `pushUndo`
and ahead of theirs. (Superseded: this note recorded for one turn that the grid site was unwired,
because that file was owned by another work stream while the rest landed. It is wired now.)

* **The gate is the model, and it is decided in Python.** `PIPE_FEATS_ADDITIVE` is
  `parse._feats_additive` reported over the bridge (`parsing-models.md`); the frontend gate is "no
  model at all, OR that flag". Under a MONOLINGUAL wheel the pass is off, because there the parser's
  own FEATS are a second opinion worth having and it will produce one for this token unasked —
  carrying another token's column in over the top of that is the app arguing with the model on the
  annotator's behalf. With no model it is on for the stronger reason: nothing else will ever fill
  those cells.
* **Nearest, not first**, searching backwards — this sentence's own earlier tokens, then whole
  sentences to the top of the document. An annotator's answer about a word moves over a long
  document (a sense split, a corrected convention) and the most recent one is the one they are
  working to. The form is matched EXACTLY, case included: case is the one thing a sentence-initial
  position changes without the word changing, and guessing which it was is the inference this pass
  has no business making. Not the lemma either — it fires at the moment a class is set, when the
  lemma column may be empty or may still be the previous class's.
* **It may fill a blank and may never revise an answer.** Every copy is guarded on the target being
  empty. FEATS travels whole or not at all (verbatim, as asked: a merge would compose a column no
  annotator ever wrote, out of two tokens' worth of evidence about one).
* ⚠️ **THE LEMMA JOINED THE PASS, AND IT IS THE ONE FILL THAT RUNS WITH NO SOURCE AT ALL.** On request:
  *"for generic/custom models, lemmas should be auto-filled by copying the form, or by copying an existing
  instance of the same form/UPOS combination from the same document."* The order is the request's own and
  it is the order of diminishing evidence — an earlier token with this form under this class is the
  ANNOTATOR'S answer about this very word, so it outranks the identity default; the form itself is what a
  lemmatiser returns for a word that is its own citation form. Which is why this half runs BEFORE the
  `!src` early return that every other half sits after: FEATS and the gloss tiers can only ever be
  COPIED, so with no source there is nothing for them to do, where the lemma still has its fallback to
  take. Still a fill and never a revision (`bare(t.lemma)`), and NOT gated on `show.lemma` — the tier is a
  view of the column, and the column is filled on the same terms whether or not anyone is looking at it.
* ⚠️ **AND A SECOND ENTRY POINT WAS NEEDED, BECAUSE A PARSE NEVER PASSES THROUGH THIS FUNNEL.** This
  function answers "a token has just GAINED a word class"; a sentence delivered by a parse or an insert
  arrives with its classes already on it and so would never have been reached — which is exactly the
  "starting to annotate something that was previously blank" case the inheritance was asked for.
  `lemmaFillSent(si)` (js/io/bridge.js) is the same fill applied token by token IN READING ORDER (so a
  form repeated inside the newly inserted run inherits from its own first occurrence rather than each copy
  defaulting separately), called from `insertParsed` and from `doInsert`'s parsed branch, inside the
  insert's own `pushUndo` and ahead of `morphAfterReparse` — `msegPrefillParts` derives the segmentation
  FROM the lemma. Deliberately NOT from a re-parse (⌘R is the reader asking for the MODEL's analysis of a
  sentence already in the document) and NOT on open (filling every blank lemma in an opened treebank would
  rewrite a file nobody had touched, and mark it dirty before the first edit).
* ⚠️ **AND THE FORM-COPY IS NOT A GUESS DRESSED UP AS AN ANSWER**, which is the rule it has to answer to
  (CLAUDE.md, "silence is the preferred failure for annotation"). `lemma = form` claims only that this word
  form is its own citation form, which is true of most tokens in most documents — and the diagram's own
  display gate is what keeps it honest on screen: the lemma row paints NOTHING for a token whose lemma IS its
  form, so the identity default is silent on screen wherever it is merely a default.
  ⚠️ **ITEM 31 SHARPENED THAT, AND ALSO TOOK AWAY THE HALF OF IT THIS NOTE USED TO RELY ON.** The gate was an
  inflectional-FEATS one when the paragraph above was written, so an INFLECTED token whose lemma had been
  defaulted to its own form still showed that form in the row, "where it reads as the unfinished annotation it
  is". It no longer does: the gate is now `lemma ≠ form`, so a defaulted lemma is invisible on every token
  rather than on most. What replaces the visible prompt is the blank slot's own transparent target — the row is
  still there and still clickable, and in a sentence with no row at all ⌘L brings one in
  (`docs/notes/diagram-rendering.md`). Silent where it is a default, one click from being corrected.
* **`MSeg` and `MGloss` travel as a PAIR, both ways** — MSeg is the segmentation MGloss is aligned to,
  so an MGloss without it describes a division of the word nothing in the document states. A token
  carrying either already has a morphemic analysis and this pass does not complete somebody else's.
  `_glossLex` rides with the `Gloss`, or the next unforced `mglossRefill` re-derives the stem from
  the Gloss tier's FORM and puts `doubts` where `doubt` belongs (`glossing.md`). `_msegPre`/
  `_mglossPre` are set to what was written, as every derived write sets them, or `morphEdited()`
  reads this pass's own output as the annotator's hand.
* ⚠️ **The gloss half answers to the reader's TICK (`PIPELINE.gloss`), NOT to `pipeOn("gloss")`** —
  superseding this note's own earlier record that it was "gated a SECOND time, on the Glossing arm".
  That gating was reported broken the same day: **"already-seen tokens still aren't having their
  glosses auto-filled"**. `pipeEffective` switches the Glossing arm off BY ITSELF wherever the model
  READS glosses (`modelReads`, js/core/prefs.js), and the model that reads them is `xx_sud_generic`
  0.2.0 — the wheel behind every custom model, which is precisely what `mayInheritAnnotation` gates
  this pass on. So the gloss half was dead code in the only configuration it exists for. Measured in
  the live page, inheriting onto a repeated `dogs`/NOUN:

  | configuration | glossing arm | inherited |
  | --- | --- | --- |
  | no model | on | `FEATS, Gloss, MGloss` |
  | custom model (wheel 0.2.0 reads glosses) | **off** | `FEATS` only |
  | custom model, after the fix | off | `FEATS, Gloss, MGloss` |
  | custom model, reader unticked Glossing | off | `FEATS` only |

  **The automatic off does not apply to this pass, and that is not a hole in it.** The arm goes off
  under such a model to stop the app QUOTING ITSELF — a gloss this app composed or retrieved, handed
  back to a parser that reads glosses as evidence, is the app's own guess returning as the
  annotator's data. An inherited gloss is neither composed nor retrieved: it is the annotator's own
  text, copied verbatim off a token they glossed themselves, under the same form and the same class.
  **The reader's own untick still stops it**, because that says the different thing ("do not fill
  glosses in for me"), which is about the gesture and not about the circularity. The FEATS half
  answers to neither: that arm governs what the PARSER writes, and this is not the parser.
* **It fires only on a genuine GAIN of a class** — never on the same-tag/clear-the-subtype path
  `choose` already distinguishes, and never on *Clear word class* (`choose("")`), where there is no
  class to have been seen under.
* **And it says nothing**, on the same terms as `fillAutoGloss` and `morphPrefillSent`, which have
  always filled these tiers silently: what it writes lands in the rows of the token just clicked, it
  replaces nothing the reader can see, and ⌘Z takes it back with the retag because it runs inside the
  caller's own `pushUndo`. A toast would queue behind `clearFeatsForUpos`' own — the two fire on one
  gesture — and the silent-deletion rule this app has spent a release enforcing is about deleting
  annotation, not about filling a blank.

⚠️ **ORDER MATTERS, AND IT IS ALREADY RIGHT.** The cleanup runs AT the retag, before the background
`regenTok` → `reparseTokenFields` that follows it — so the re-parse is handed the CLEANED column as its
`prior_feats` and never sees the contradicted feature at all. Run the other way round, the additive rule would
faithfully preserve the very value the retag had just decided was wrong.
⚠️ **AND THE INHERITANCE SITS BETWEEN `featsSyncGloss` AND `regenTok`.** After the
sync, because that call retargets the abbreviations of the gloss the token ALREADY has for the FEATS
change just made, and an inherited MGloss is already correct for the inherited FEATS — handing it to
a sync keyed on `before` would retarget a value that had never held those features. Before the
re-parse, because `reparseTokenFields` sends `prior_feats`: under the very models this pass is gated
on, the inherited column then travels to the parser as the annotator's own and survives the re-parse
additively, which is the whole of the FEATS-additive rule in `parsing-models.md`.

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
root's `root` → `udep` demotion) and none of the rest. **Only the old root itself is re-parented onto
the new root** — a token that hung off the old root before this command stays exactly where it was; a
broader rule that also migrated the old root's own dependents onto the new root was tried and retracted
on report ("dependents of the existing root should remain as dependents of that node" — a token's
dependents are never moved just because the token itself was). The old root's own edge is the one
genuine unknown here: it never existed before this command, so its placeholder `udep` is not an analysis
and — per the same report — cannot be left, or later re-settled, as `root`, since that relation now
belongs to the new root alone. It runs `afterHeadEdit`, which asks the same three-tier question and
applies the same error-level validation a hand-dragged arc gets. **Deferred, not fired inline**:
`afterHeadEdit` takes an optional `defer` array that collects the id instead of firing, and
`headSyncDeprels` (js/io/bridge.js) runs it once the whole re-root has landed — a call fired before the
new root's own `head` is zeroed would be asking about a tree that is still half-mutated, and
`headSyncDeprel`'s own staleness re-read would then throw away the answer it had just paid for. The
**new root is not in the list**: head 0 is settled by rule, which is what `headSyncDeprel`'s `want>=1`
guard already says.

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

## Typing a word class into the diagram

⚠️ **THE RETAG NOW HAS TWO GESTURES, SO IT HAS EXACTLY ONE FUNCTION.** On request ("POS tags in diagrams should
be input fields with strict autocompletion") the diagram's POS row became an inline editor as well as a menu
target — and the sequence a retag entails (`pushUndo` → `upos` → `syncXposMirror` → `clearFeatsForUpos` → drop
the `UPOS_SUBTYPE_FEATS` → `featsSyncGloss` → `uposSyncGloss` → `inheritAnnotationForUpos` → `markDirty` →
`preserveScroll(renderDoc)` → `uposSyncTranslit` → `regenTok(regloss)`) is nine passes long, each ordered against
the next for a reason recorded above. Two copies of it would write the same column and mean different things,
invisibly: both set `upos` correctly and only the passes hanging off it would drift. `retagToken`
(js/editing/context-menu.js) is that sequence, lifted verbatim out of `posMenu`'s own `choose`, and `choose` is
now `p=>retagToken(si,tokId,p)` — the menu, the ✕ (`clearPos`, which is `choose("")`) and the typed field are one
call site apart. **The subtype flyouts keep their own `setSub`**, deliberately: they set a FEATURE as well as a
class and skip the re-parse for that reason (their own note says so), so they are not the same operation.

⚠️ **THE GUARD IS PART OF THE FUNNEL, NOT OF THE CALLER.** `retagToken` returns immediately when the tag has not
moved and there is no subtype to drop — no undo entry, no render, no re-parse. That is what makes "re-picking the
current tag is a documented no-op" true of *typing* it as well, and it is the reason the field's proxy only
REMEMBERS: `makeEditable` assigns `obj[key]=orig` back on a cancel, so a proxy that ran the function from its
setter would fire on a cancelled edit and drop a dot-suffixed subtype off a field the reader had merely opened
and shut. The write happens in the commit hook (`after`) instead.

⚠️ **AND THE FIELD RIDES `makeEditable`'s UNDO ENTRY, WHICH IS WHY THE FUNNEL TAKES `snapshot:false`.**
`makeEditable` snapshots the moment the field opens and pushes it on commit; a `pushUndo` inside `retagToken` as
well would leave two entries for one retag and ⌘Z would need two presses. Same division the grid's UPOS cell has
always made (`commitCell` owns its `pendingSnap`). Measured on the fixture: one accepted completion → `UNDO.length`
1.

### The gesture

⚠️ **THE POS ROW OPENS ON THE GESTURE ITS NEIGHBOURS ALREADY ANSWER — A PLAIN CLICK/TAP — AND THAT TAKES NOTHING
AWAY, BECAUSE WHAT IT REPLACES WAS A MIS-ROUTE.** `.tr-edit` opens the transliteration editor on one click and
`.gl-edit` opens a gloss tier's; the POS row carried neither class, so a tap on it fell through to the group's
default branch and opened the token's **FORM** editor — clicking a word CLASS opened a field over the WORD, in
every notation. Two routes, because the diagram has two: the pointerup TAP branch (js/diagram/diagram-edit.js) for
the four draggable notations, which must resolve the tapped element before `pick()` re-renders a brackets block,
and the delegated `#doc` click handler (js/editing/context-menu.js) for the outline. **The selection is
untouched** — the tap's own `pick()` already ran, exactly as it does for the form/translit/gloss rows, so
CLAUDE.md's "only a click or a rectangle selects a node" is satisfied by the same click that opens the field.

⚠️ **THE RIGHT-CLICK MENU IS UNTOUCHED AND THE DOUBLE-CLICK IS PRESERVED BY THE FIELD ITSELF.** `posMenu` carries
three things a text field cannot: the subtype flyouts, the guidelines link and the model-probability row
weighting. Right-clicking the tag still opens it (no field is open then, so nothing intercepts). The
double-click needed a home: once a FIRST click opens the field, the second click lands on the `<input>` — which
lives in `<body>`, so `#doc`'s `dblclick` handler can never see it and the gesture would simply have vanished.
`makeEditable`'s `opts.dbl` answers a `mousedown` with `detail>=2` on the field by closing it and opening the
menu. `detail` is the engine's own count of the click run (time + position, not target), so the second press
reads 2 there exactly as it would have on the tag. **Only while the reader has not typed**: once there is text of
their own in the field a double-click is a word selection, which is what an `<input>` is for.

⚠️ **THE HIERARCHY IS NOT IN THE LIST, AND THAT IS ITS OWN CHOICE.** `tree` draws no per-node POS row at all
(js/diagram/diagram-wrap.js says so in place: "hierarchy has no per-node POS row"), so there is nothing to click.
The other five all draw one and all open the field: `.tok-pos` (arcs, flat brackets, a projected stemma),
`.node-cat` (an UNWRAPPED POS-as-node stemma — with wrapping on, a stemma goes through `projWrapped`, whose
token strip draws an ordinary `.tok-pos` and leaves the pinned tree's nodes bare, so `.node-cat` is the
unwrapped renderer's alone), `.bwpos` (wrapped brackets, inside `.bwund` — NOT the `.bwannot` overlay, so
it needs no `pointer-events` exemption), `.opos` (the outline, ghost rows included). **One selector,
`POS_SEL`**, read by the right-click resolver (`posRelHit`), the tap resolver and the field's own element lookup
(`posElOf`) alike: three gestures that must agree about what counts as "the POS row" or they answer on different
tokens. `.mwt-pos` is deliberately absent — an ExtPos value is a statement about a whole expression and has its
own menu.

⚠️ **AND THE CLICKED ELEMENT IS PASSED THROUGH, NOT RE-LOOKED-UP.** A PROJECTED stemma draws both a `.node-cat`
and a baseline `.tok-pos` for one token, and `tokGroupOf` prefers the content-bearing `.tok-group` — so a
re-lookup would open the field over the baseline row for a click on the node. `editPosInline` takes the element
the resolver actually hit; `posElOf` is the fallback for the keyboard route, which has no click to point at.

⚠️ **THE POS ROW JOINS THE TIER NAVIGATION, LAST, GATED ON `show.pos`** — `navStack()` is
`["form"] + belowTiers() + ["pos"]`, which is the order the diagram draws them in. The transliteration row is
still deliberately absent: it is not always this token's own stored value (see `editTransInline`'s three
branches). While the dropdown is open ↑/↓ belong to it rather than to tier navigation — the same trade the
grid's Deep/DepRel cells and the MGloss editor already make — so Up/Down reach the neighbouring tiers from this
row only after an Escape has closed the list. Tab still navigates whenever no row is highlighted.

### Strict

⚠️ **THE VOCABULARY IS CLOSED, SO THE FIELD REFUSES RATHER THAN INVENTS.** The discipline, and each half of it
has a reason:

* **The dropdown is the app's own** (`acShowGrouped`/`acFill`, js/grid/grid.js — the popup the DepRel and Deep
  cells and the MGloss editor use), grouped by `UPOS_CATS` with each tag's expansion (`UPOS_INFO`) in the dimmed
  right-hand column, exactly as the FEATS value lists carry theirs.
* **It opens on the WHOLE inventory the moment the field does.** 17 rows of a closed vocabulary, and the reader
  who clicked the tag came to change it. The grid's DepRel cell shows nothing on focus for an already-set cell —
  its vocabulary is open and long, and it is answering a different question. Typing then filters:
  case-insensitive PREFIX, falling back to SUBSTRING when the prefix matches nothing, minus the exact text
  already typed — the two-stage match `acOpen`/`deprelAcOpen`/`openIeAC` all use.
* **Enter or Tab on a highlighted row accepts AND commits** (Task A's rule one field over: accepting a suggestion
  IS an accept-this-edit gesture). **Escape closes the list first and keeps the edit**; a second Escape reverts.
* **A commit whose text is not an exact (case-insensitive) member is REFUSED.** Enter and Tab leave the field
  open with the text intact and toast why; **a blur reverts** instead. That asymmetry is the point: holding the
  keyboard hostage to make the reader fix a field they have already clicked out of is not a validation, it is a
  trap, and it would fight this editor's own "what was clicked becomes the selection" contract. Measured: Enter
  on `NOUNISH` leaves `upos` `NOUN`, the field open and focused, its text unchanged, and the toast up; blurring
  from the same state leaves `upos` `NOUN` and closes.
* **Case is the one mercy.** `verb` commits as `VERB` — the canonical spelling is the inventory's to supply,
  which is the same courtesy every autocomplete here already extends by matching case-insensitively. The
  keystrokes are NOT up-cased live: there is no precedent for it in this app, and rewriting `value` under the
  caret fights a paste and an IME composition for no gain the guard does not already give.
* ⚠️ **THE EMPTY STRING IS THE ONE NON-MEMBER THAT COMMITS.** An untagged token is a state this app deliberately
  supports — *Clear word class* in the menu, `_` in the file, `TIER_EMPTY` in the diagram — so clearing the field
  is how the reader untags, and `allowEmpty` is passed for exactly that. Measured: emptying the field leaves
  `upos` `""` with FEATS and the glosses standing, which is what `choose("")` does.
* ⚠️ **AND THE INVENTORY IS `SETTINGS.upos` PLUS THIS TOKEN'S OWN TAG** — the widening `optionMenu` states one
  function up and for the same reason: a tag the FILE carries that the inventory does not list must still be
  something this editor can put back. Closing a field on a value that has not moved never consults the guard at
  all (`passesGuard`'s `v===orig` short-circuit), so an unfamiliar tag can never trap the reader either.

⚠️ **THE THREE HOOKS LIVE IN `makeEditable`, NOT AT THE CALL SITE, AND THAT IS FORCED.** `opts.guard`,
`opts.ac` and `opts.dbl` all have to sit inside that function's own listeners: a keydown listener added to the
returned `<input>` afterwards runs AFTER the editor's own (at-target listeners fire in registration order,
capture flag or not), so it would arrive to find Enter had already committed. The ↑/↓/Enter/Tab/Esc block is
therefore the FIFTH copy of that pattern in the app and the first one any future constrained field gets for
free.

### What the probe found on the way — two races, both now fixed

⚠️ **A RENDER ON A TIMER EATS ANY OPEN INLINE EDITOR.** Every inline editor in this app (the token form,
the transliteration row, both gloss tiers, and now a typed word class) is an element placed over a node
`renderDoc` replaces, so a rebuild blurs it — **and blur COMMITS** (`finish`). Two callers re-rendered on
their own schedule rather than in response to an edit, and both are now guarded with `renderUnlessEditing`
(js/ui/wiring.js), which the app already had for exactly this and which also hands the open field what the
skipped render would have shown it (`INLINE_EDIT_SYNC`):

* `js/lang/smp-shape.js`'s **HarfBuzz settle**, `preserveScroll(renderDoc)` on an 80 ms debounce. Diagnosed
  over CDP by patching `renderDoc` and reading the stack:
  `renderDoc ← preserveScroll (js/ui/wiring.js:34) ← js/lang/smp-shape.js`. It ate the form, transliteration
  and gloss editors identically — not new, merely newly easy to hit.
* `js/core/scroll.js`'s **ResizeObserver `_reflow`**, `preserveScroll(renderDoc)` on a 140 ms timer. This one
  is **FLUENT-ONLY in practice** and is why both skins have to be run: with the POS field driven over CDP it
  fired **20 times inside one typing sequence** on `?platform=win` and took five checks down with it (the
  dropdown filter, the accepted completion, the inheritance, the undo count, the refusal staying open),
  while the macOS run never tripped it once. The two kits give `#doc` different metrics, so a field or its
  dropdown changes that box in one and not the other. `pick` is skipped with the render, since it exists to
  restore a selection a re-render dropped and nothing was re-rendered.

⚠️ **SKIPPING IS SUPERSEDED, NOT LOST, WHICH IS WHY IT IS SAFE HERE.** The worry against guarding the settle
was that a skipped render would strand glyphs on the `foreignObject` fallback. It cannot: every editor's
`finish` ends in `preserveScroll(renderDoc)` on **both** paths, commit and cancel, and the settle's
`invalidateDiaCache()` has already run — so the very next render, which the closing field guarantees,
rebuilds with the shapes warm. The same argument covers the reflow: the layout it wanted is rebuilt at the
current size the moment the field closes. **Measured after both guards, with the probe's own external
workaround removed: 22/22 on macOS and 22/22 on Fluent, and zero renders recorded while a field was open.**

⚠️ **AND A LOAD-ORDER RACE — `msegFlagDoc is not defined`, THE VERY FAILURE MODE `CLAUDE.md` WARNS ABOUT.**
Caught once in the Fluent half of the render smoke test and not reproduced on the next two runs, so it is
timing-dependent: `renderDoc` (js/core/document.js) calls `msegFlagDoc`, declared in **js/io/bridge.js**
(script 25 of the load order), while **js/core/scroll.js** (script 24) arms the `ResizeObserver` above whose
`_reflow` fires a render on a 140 ms timer. On a slow enough load that timer wins, the render reaches a
function whose file has not been evaluated yet, and the throw blanks the app. It is exactly the
classic-script hazard the top-level rule names, reached by a TIMER rather than by a bare top-level call —
which is why the "no eager forward-reference" reading of that rule does not catch it.

**Fixed with the idiom the rule already prescribes, and AUDITED rather than patched where it was seen to
throw.** `renderDoc`'s body was swept for every bare call into a later-loaded module; there were three, all
now `typeof`-guarded: `msegFlagDoc` and `applyTransInsets` (js/io/bridge.js, script 25) and `validateAll`
(js/editing/validation.js, script 15). `highlightFind` was already behind its own `typeof FIND` test, and
`insertAt` sits inside a click handler, which cannot run that early. All three are cheap, idempotent derived
passes, so a boot-time render that skips them is followed by a real one that does not.

## Typing a lemma into the diagram

⚠️ **THE LEMMA ROW IS AN INLINE FIELD LIKE ITS NEIGHBOURS, AND IT COMMITS THROUGH `commitLemmaEdit`, NOT
THROUGH A SECOND PATH.** `editLemmaInline` (js/editing/context-menu.js) is `makeEditable` over the row the
reader clicked, with `allowEmpty` and no `opts.guard`/`opts.ac`: the strictness the word-class field documents
at length is about a CLOSED inventory, and a lemma has none. What it must not do is re-implement what a new
lemma sets off — `afterLemmaEdit` (js/io/bridge.js) drops the stale lemma-romanisation, awaits the new one,
rewrites MISC LTranslit and only THEN re-derives MSeg from it, and `mglossReslot` re-slots MGloss against the
segmentation that produced. `commitLemmaEdit` (js/grid/grid.js) is where that sequence already lives, for the
grid's own Lemma cell, and it deliberately does NOT render eagerly (its own note: nothing on screen can be
right until the await lands). Both are true of this field too, and `makeEditable`'s `finish` has already
rendered once and pushed the undo entry, so the whole edit is one ⌘Z.

⚠️ **A PROXY, NOT `t` WITH KEY "lemma".** The stored column is `"_"` for an empty lemma; the field must show
that as blank and a committed blank must go back as `"_"`. Same unwrapping the grid cell and
`editLemmaPrompt` do at their own edges — and the same "open on what is STORED, never on what the row PAINTS"
rule the MSeg and word-class editors state: a blank slot opens the field on whatever the lemma column holds,
and an empty column opens an EMPTY field, because committing `_` as a lemma would put CoNLL-U's own empty
marker in the column as if it were a word.

⚠️ **`editLemmaPrompt` IS NOW A FALLBACK, AND ITS OWN NOTE IS SUPERSEDED IN STAGES.** That popover exists
because "the lemma is drawn in no notation at all", so there was nothing to lay an inline field over. Item 29
made that false for some tokens; item 31 made it false for nearly all of them — a blank slot carries a
transparent target of its own, and a sentence with no row grows one for the duration of an edit
(`lemRowForce`, `docs/notes/diagram-rendering.md`). So ⌘L and the token menu's "Edit lemma…" both go through
`editLemmaAt`, which tries `editLemmaInline` first and falls back to this popover only where the inline field
genuinely cannot open: **the tier switched off in Show/Hide** — a standing choice about every sentence, which
an edit may not overrule — or a block that is not rendered at all. Both editors write the same column through
the same `afterLemmaEdit`, so the fallback changes the surface and not the behaviour. It is also still what a
selection made in the GRID reaches when the diagram cannot answer.

⚠️ **AND THE LEMMA IS THE ONE TIER `tierNav` HAS TO STEP OVER.** Every other row of the below-stack is drawn
for every token alike — that is the placeholder rule — so navigation could always assume a target existed.
This one is reserved for every token in a sentence that has the row and painted only for some, so arrowing
onto a blank slot would open a field over ink nobody can see. Both axes skip in the direction of travel
(Up/Down past the row, Left/Right along it to the next token that paints one), and running out of stack or out
of tokens returns exactly as before. `navStack(s)` takes the SENTENCE now (item 31 made the row's presence a
per-sentence fact) and places the row between the form row and the gloss tiers, which is where every renderer
draws it. ⚠️ **THE SKIP WAS LEFT AS IT WAS**, though item 31 has made a blank slot clickable: the two gestures
now differ deliberately — a click aims at a specific slot, a keyboard walk along the row stops only where
there is something to read. Recorded as the one inconsistency the change leaves, not as an oversight.

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

⚠️ **THE PLACEHOLDER'S MENU IS THE "Add Feature…" FLYOUT, OPENED IN PLACE** — same items (both go through
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

⚠️ **CHECKED AND DELIBERATELY NOT MADE TO MATCH `otherFeatureItems`'S OWN `featOnUpos` GUARD.** On report
("make sure the context menu shows all POS-appropriate feature values that are attested in the document, not
just POS subtypes") — read as "should `addFeatureItems`'s own `cands` gain the identical `FEAT_UPOS` filter
`otherFeatureItems`'s `cands` already carries, for consistency between the two menus reading the same
POS-appropriateness question." Traced rather than assumed: `model_feats_by_upos("sud:en_sud_ewt_gum")`, the
bundled English wheel's own morphologizer labels, DOES disagree with the static table — `NumType` on
`PROPN`/`NOUN` (moot: `NumType` is in `AVM_EXCLUDE`, so it never reaches either `cands` list at all) and,
live, `Number=Sing/Plur` and `Abbr=Yes` on `SYM`, a class `FEAT_UPOS` gives neither. `samples/english.conllu`
carries no `SYM` token to click, so the two lists cannot be caught actually disagreeing on screen from this
one file — but the model's own inventory is exactly the kind of "document/model usage" evidence this whole
section already tells `strictAttestedVals` to trust, and gating `addFeatureItems`'s `cands` by the static
table would silently veto that evidence for any `SYM` token a reader annotates.
**That is precisely what this same file already settled, one section up, as the wrong shape for the value
question** ("AND THE TABLE IS A DEFAULT, NEVER A VETO" — a corpus or a model that attests something unusual
is evidence, and is believed) — and there is no reason the identical principle stops at the value level and
starts vetoing at the whole-FEATURE level. So the asymmetry between the two `cands` lists is not a bug to
close: `addFeatureItems` answers "what does this document/model actually say", which a static table may
narrow **only where the evidence itself is silent** (the untagged-token fallback, `build(f=>UD_FEATS[f]||[])`,
where there is nothing to trust yet); `otherFeatureItems` answers a different question — "what does UD's own
inventory offer beyond that" — and IS rightly table-scoped, because that escape hatch has no evidence of its
own to defer to in the first place. Adding `featOnUpos` to `addFeatureItems`'s `cands` would make the two
menus agree by making the evidence-scoped one lie.

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
