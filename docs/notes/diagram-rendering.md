# Diagram rendering: arcs, SVG text, and the SMP shaping fault

`js/diagram/` — arc fanning across a wrap, the row-clearance expression, WebKit's refusal to shape supplementary-plane text in SVG `<text>`, and the `foreignObject` swap that works around it.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

## Arc fanning across a wrap

⚠ **A CROSS-LINE ARC IS ALWAYS THE INNERMOST MEMBER OF ITS FAN BUCKET.** `fanArcs`
(js/diagram/diagram-wrap.js) ranks the arcs meeting one node by `len` and gives the longest the centre slot,
so an arc never has to cross a longer one to reach its own node — `len` stands in for RANGE. That proxy holds
inside one line and **breaks across a wrap**: a cross-line arc's `len` measures its chord in the WRAPPED
FRAME, and with its endpoints on different lines that chord can be almost vertical — a few pixels — while the
arc genuinely spans further than every within-line bump at the same token. Ranked as the shortest, it was
fanned OUTSIDE arcs it encloses. Being cross-line is the strongest range claim available at a node, so
`a.cross` is declared and the sort puts those first; among several cross-line arcs `len` still decides, and
the within-line ones rank among themselves exactly as before. Cross-line GHOSTS take the flag too — a ghost is
ranked into the same pool by length like any other member, so the one rule that overrides length has to reach
it, or a ghost would fan outside the real arc it duplicates. Declared at all three pools that hold cross-line
arcs: `arcsWrapped`, and BOTH of the wrapped-bracket passes (`positionBracketAnnots` and the
gap-reservation prediction beside it — that pass exists to predict this very fan, so a flag on one and not the
other would grow the wrong gap). The flat arc and flat bracket views have no cross-line arcs and are
untouched. ⚠️ Measured on the fixture in a 560px port, wrapped arcs: 77 buckets hold both kinds of endpoint,
and the cross-line one is innermost in all 77 — against **40 of 70 fanned outside a within-line arc** under
the old length-only ranking, driven through the same instrumented `fanArcs` as a control.

## Row clearance, and WebKit's SMP shaping fault

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

## The punctuation satellite (daṇḍa)

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

## Seam marks and the MWT form lead

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

## The empty-value placeholder

⚠️ **A TIER THAT IS VISIBLE BUT HAS NO VALUE FOR THIS TOKEN DRAWS `TIER_EMPTY` (`"_"`, `.tier-empty`,
`.tier-empty`), NOT NOTHING.** One declaration (`js/diagram/diagram-core.js`, beside `glossSlotW`) and two
accessors — `posRowTxt`/`trRowTxt` — feed every renderer, so a row states what it paints in one place. It
replaces the glossing tiers' own `…`, which was already this and only for them; the transliteration row, the
POS row and the AVM slot all drew literally nothing before. `"_"` is CoNLL-U's own empty field, so the diagram
says what the file says. ⚠️ **AND THE LEMMA ROW IS THE SECOND EXCEPTION, of a different shape again** — it keeps its reserved slot and
draws NOTHING in it for a token whose lemma IS its form, because there the lemma is the word printed directly
above and a placeholder would claim a missing annotation that is not missing. That row's own PRESENCE is per
sentence as well (item 31), which is the same predicate under `some`. See "The lemma tier" below, and
CLAUDE.md's own bullet.
⚠️ **THE STEMMA'S POS-AS-NODE LABEL IS THE ONE DELIBERATE EXCEPTION**: an untagged node
there keeps the literal `"X"` it has always shown, on instruction ("don't replace the X UPOS tag with an
underscore"). A stemma of word classes draws its tags AS the tree's nodes, and a node is structure rather than a
row that can be left blank. **Otherwise purely cosmetic**: not `.tr-edit`, no tooltip, nothing written back —
the gloss tiers alone keep their editability, which they always
had. The class is APPENDED to the row's own
(`"translit"+tierEmptyCls(rt)`), never substituted: every selection, dimming and hit rule keyed on
`.translit`/`.tok-pos`/`.node-cat`/`.bwpos`/`.opos` has to keep matching. ⚠️ **AND IT IS FULLY OPAQUE**, on
request — it carried `opacity:.4` for several rounds (the value the gloss tiers' own `…` had always had), and
that was the only thing the rule ever did. The class stays: it is what every renderer marks a placeholder with
and what the render smoke tests count. Setting no colour of its own is what already makes a placeholder read in
whatever register its own row is painted in — muted grey on the transliteration row, `--tie-hue` on the POS row,
the accent of a selected token, `--dim-tie` on a peripheral one.

⚠️ **IT IS ALSO WHAT KEEPS THE ROWS ALIGNED, which is the half that changed layout.** The reserves have always
been per-SENTENCE — `belowReserveH(hasTr(t), belowTierN(), show.pos, …)` asks whether the ROW exists, never
whether this token has a value — but three draw sites gated on the VALUE and so skipped their own step:
`belowStack`'s POS row (`show.pos && tk.upos`), and the hierarchy's `trTxt(t[i])` in both its gloss-row step
and its `nodeBot`. An untagged token's AVM therefore sat one `belowGap()` ABOVE its neighbours', and a node
with no romanisation pulled its glosses up into the row the others were using for theirs. All three are gated
on the row now (`show.pos`, `hasTr(t)`), with the placeholder filling what the reserve had already paid for.
Verified live (CDP, the dev fixture with tags/FEATS blanked on every third token): the `.tok-pos`, `.translit`
and `.avm-empty` baselines within a sentence are identical to 0.01px.

⚠️ **BUT ONLY WHERE THE ROW IS ALREADY THERE — `hasTr(t)`, NOT `trLayer()`.** A transliteration layer switched
on over a document that romanises nothing anywhere reserves no row at all (`bracketsWrapped`'s `--undpad`
carries the reasoning in place: the reserve is `hasTr`, deliberately not `show.translit`), and
filling a row that was never reserved would add a line of underscores under every token in the document — an
English document under a romanisation scheme is exactly that case, since `trTxt` returns "" wherever the
romanisation would merely repeat the glyph. The tiers whose rows ARE unconditional once switched on (POS, the
gloss tiers, the AVM) place a placeholder on every token that lacks a value. Confirmed live: translit on, no
token romanising → zero `.translit` elements, not a row of them.

⚠️ **THE AVM PLACEHOLDER IS DRAWN BARE, AND IT IS NOT `.avm-val`.** No bracket pair: the brackets are the
notation for a feature MATRIX, and an empty pair reads as a matrix whose contents went missing rather than as a
token with no features. `.avm-empty` shares `.avm-val`'s face, colour and casing halo by riding its rule, but
not its CLASS — `.avm-val` is swept unconditionally by the HarfBuzz shape-to-`<path>` swap
(`FFS_SHAPE_CLASSES`) and re-opaqued by the `.sel` rules, neither of which a cosmetic underscore wants. Its
height is `avmEmptyH()` (one box-row's pitch) and it reaches the reserves the only way anything does, through
`avmHeight()` — which is why `document.js`'s two `undBot()` MWT-tie readers now call `avmHeight(t)` rather than
reading `avmLayout(t).h`, and why every `if(avmLayout(t))` draw gate is now `if(show.avm)`: `drawAVM` itself
decides between a matrix, a placeholder and nothing. The outline's inline twin (`avmInline`) returns its own
`.oavm-empty` for the same reason `.oavm`'s bracket pair is `::before`/`::after` on the container.

Verified across all five notations in both kits (headless Chrome, and again in WKWebView via a hidden
`create_window` — the engine the app actually renders in): 8 blocks per notation, 0 runtime errors, 0 `NaN`
in any diagram, placeholders present in the flat AND wrapped paths of every notation that has both.

## An empty inline field, and the caret WebKit will not paint in it

⚠️ **A CONTENTEDITABLE WITH NO CONTENT HAS NO LINE BOX, AND WITH NO LINE BOX WEBKIT PAINTS NO CARET.** The
gloss and morphemic-gloss tiers are edited in `.glabbrbox` (`makeGlossEditableSC`, `js/editing/context-menu.js`)
— a contenteditable `<div>`, not an `<input>`, because a flat input value cannot carry the partial small-caps a
Leipzig abbreviation needs — and `render("")` cleared it to genuinely nothing. Measured in the shipping engine
(the field focused, its own contents selected): an empty box reports **zero client rects** for the selection,
where the same box holding a single `<br>` reports a real **0×18 caret rect at the box's own centre**. So
clicking an un-annotated tier opened a field that accepted typing and showed no cursor. `render` now appends a
`<br>` whenever the text is empty, and re-appends it the moment the reader deletes the last character.

⚠️ **A `<br>`, NOT A ZERO-WIDTH SPACE.** `box.textContent` stays exactly `""` through a `<br>`, so `place()`'s
width measurement, `reflow`'s `caretOffset` and `finish`'s `v=box.textContent.trim()` commit test all read the
field as empty, which is what it is. A U+200B measures, commits, and is then stripped again downstream by
`INVISIBLE_RE` — a value where there is none. ⚠️ **AND CHROME PAINTS A CARET EITHER WAY**, which is why no
headless run could see this and why the fix is verified in a WKWebView probe instead. The `<input>`-based
inline fields (the form, the transliteration row, MSeg, an MWT's own form) are unaffected: a focused empty
`<input>` paints its own caret natively.

⚠️ **AND IT IS NOT ONLY THE DIAGRAM'S FIELD.** Every contenteditable the app RENDERS empty has the same fault,
and a sweep of the live DOM (each one emptied and focused in turn) named three more: `.sid-in` (a sentence with
no `sent_id`), `.tg-text` (an unfilled translation row) and `.bm-id` (a `# newdoc`/`# newpar` name, which shows
nothing when empty by design — the worst of the three, since there is no other ink in the field to tell the
reader anything happened). They share `keepEmptyCaret` (`js/core/document.js`), which holds one `<br>` in the
field for exactly as long as it is empty. **The `<br>` is WebKit's own remedy, not an invention here**: type
into one of these fields and delete back to nothing and the engine leaves a `<br>` behind itself — measured —
so only the app-rendered empty state ever lacked one. The grid's `.pillfield` solved the same problem earlier
with zero-width TEXT nodes (`ZW`/`isZWNode`, `js/grid/grid.js`), which is right for *that* field — it needs an
editable caret anchor between `contentEditable=false` chips and strips them on serialize — and wrong for a
plain text field, where a `<br>` cannot be committed by accident because it never enters `textContent`.

## The lemma tier: present per sentence, painted per token

`.tok-lemma` (SVG: `belowStack` + the hierarchy) / `.bwlemma` (wrapped brackets) / `.olemma` (outline), between
the transliteration and the gloss tiers, in all five notations. On request: *"there should be a lemma tier in the
diagrams, just below the tokens (or their transliterations) and formatted in small caps, but the lemma should only
be shown for tokens that have inflectional features. These should be editable input fields."* Item 31 then made
three corrections to it, all recorded below: *"the lemma should only be shown if it is different from the form"*,
*"clicking on a hidden lemma should still bring up the input field"*, and *"if a sentence has no visible lemmas,
the lemma tier itself should be hidden, unless a token is being edited, in which case it should slide into view."*

⚠️ **ONE PREDICATE ASKED AT TWO SCOPES, WHICH IS WHAT KEEPS THE RESERVE AND THE DRAW IN STEP.** `lemmaShown(t)`
answers it for a TOKEN; `lemmaRow(toks)` (js/core/prefs.js) asks the same predicate of a SENTENCE's display
tokens — `toks.some(lemmaShown)`, exactly `hasTr(toks)`'s shape — and reaches `belowRows()` and so all thirteen
`belowReserveH` sites, as its **fifth argument**. A sentence in which nothing shows a lemma reserves NO row and
every stack in it closes up by one `belowGap()`; a sentence that shows one anywhere reserves the row for every
token in it alike. CLAUDE.md's tier rule holds because a token that PAINTS implies a sentence that RESERVES.
⚠️ **AND `lemmaRow()` USED TO TAKE NO ARGUMENT** — see this note's own earlier record, and prefs.js's, that a
document-wide answer read from a global was the deliberate shape "because there are thirteen call sites and a
reserve one of them forgets to grow is the silent misalignment the tier rule exists to prevent". That warning
still stands and is what the parameter answers rather than ignores: every site already computes `hasTr(t)` from
the array `lemmaRow(t)` needs, and a site that forgot would drop the row (visible in the first render) rather
than misalign it.

⚠️ **WITHIN A SENTENCE THAT HAS THE ROW, THE INK IS STILL GATED PER TOKEN, AND THAT SPLIT IS THE STANDING
EXCEPTION.** `lemmaRowTxt()` (js/diagram/diagram-core.js) returns `""` — draw nothing — wherever `lemmaShown(t)`
is false, so a token whose lemma is its own form keeps its reserved slot and leaves it blank while every row
below it (the gloss tiers, the POS row, the AVM box) stays on one line across the sentence. What is skipped is
the ink.

⚠️ **AND NO `TIER_EMPTY` THERE, WHICH IS THE DEPARTURE.** The placeholder means "this row is visible and this
token has NO VALUE for it". A token whose lemma equals its form has lost nothing — the lemma IS the form, printed
directly above — so `_` would assert an absent annotation that is not absent, and the lemma itself would only
repeat the word one line up. The relation LABEL is the app's other exception and it is a *different* one: that
row has no reserved slot at all (see the note further down). This one keeps its slot and leaves it blank.
⚠️ **AND UNDER THE PRESENT GATE `TIER_EMPTY` IS UNREACHABLE ON THIS ROW AT ALL** — superseding this note's own
earlier "AN INFLECTED TOKEN WITH NO LEMMA STILL DRAWS `TIER_EMPTY`, on the standing rule". That was true while
FEATS could admit a token the lemma column had not answered; with the gate asking about the lemma itself, no
lemma means no ink and (absent another token) no row. The placeholder branch and the `.tier-empty` class it took
at the three draw sites were deleted rather than left standing as unreachable code.

⚠️ **THE GATE IS "THIS TOKEN HAS A LEMMA AND IT IS NOT THE FORM", ASKED DIRECTLY OF THE TWO COLUMNS** — and it
was a FEATURE LIST for one round, which is worth recording because the growth of that list is the finding. It
began as `hasInflFeat` (js/io/bridge.js), was narrowed to `AVM_GROUPS`' AGR+TAM ("by 'inflection' I meant only
agreement and TAM features"), and then grew back one instruction at a time, each naming one more way a form can
differ from its citation form:

| opened the row | why |
| --- | --- |
| `AVM_GROUPS.AGR` — Person, Number, Gender, Clusivity | "only agreement and TAM features" |
| `AVM_GROUPS.TAM` — Tense, Aspect, Mood, Evident | 〃 |
| `Degree` | "I guess degree is also inflection" |
| `Case` | "and case" |
| `Voice` | "some languages have finite passive forms" — a synthetic passive is ONE token differing from its citation form by voice alone |
| `VerbForm` ≠ `Fin` (the one entry gated on its VALUE — a non-finite form often carries `VerbForm` and nothing else) | "and also non-finite forms of verbs" |

That table was an ever longer APPROXIMATION of a question the file can simply be ASKED, so
`lemGateFeats`/`LEM_GATE_EXTRA`/`LEM_GATE_VAL` were deleted rather than left standing beside their replacement.
`hasInflFeat` is STILL not edited to match: it answers a different question for a different caller (is this an
inflected word form or a bound compound member, `msegFlagSent`). `isUninflectedForm`/`UNINFLECTED_FEATS` stays
out for its own old reason — it answers "may a LEXICAL source write a gender onto this token", not "does this
form differ from its lemma".
⚠️ **WHAT THE MOVE BUYS BESIDES NOT NEEDING A NEXT ENTRY**, measured over `samples/` (tokens passing each gate):
literary_chinese 42 → **1**, khc_test 50 → **0**, arabic_rtl 3 → **0**, english 42 → **20**, la_virgil 36 → 28,
brihat_jataka 74 → 71. It reaches languages whose treebanks carry no FEATS at all, and it stops asserting "this
form is not its citation form" of a token whose own file records the two as identical. The same figures by
SENTENCE are what item 31's third change is for: khc_test 19 sentences → **0** with the row, literary_chinese 11
→ **1**, english 8 → 8.
⚠️ **THE COMPARISON IS EXACT AND CASE-SENSITIVE, AND THAT IS REPORTED RATHER THAN DECIDED HERE.** A
sentence-initial `The` differs from `the`, so most sentences show a lemma on their first token: on
`samples/english.conllu`, 20 of 81 tokens differ, **7 of those by case alone, 6 of the 7 the sentence's own first
token**. Folding case would also hide a genuine `US`/`us`; which costs more is the reader's call.
⚠️ **AND IT COMPARES THE STORED COLUMNS, NEVER WHAT IS ON SCREEN** — `t.lemma` against `t.form`, not `bform(t)`.
The row paints the stored lemma (see below), and comparing against the rendered glyph would make the row appear
and disappear with the reader's own script/romanisation choice.

⚠️ **A BLANK SLOT IS STILL A TARGET** ("clicking on a hidden lemma should still bring up the input field"). An
empty SVG `<text>` has no hit area and a zero-width HTML span has no box, so each notation draws a real one: a
transparent `<rect class="lem-edit lem-hit">` in the SVG rows (`svgLemHit`, js/diagram/diagram-core.js — used by
`belowStack` and by the hierarchy) and a min-width cell in the HTML ones. That is the `.avm-hit`/`.avm-add`
idiom, taken for the reason it exists there. `fill:transparent`, **not** `fill:none` — a `none` fill is not
hit-tested at all, which is the whole difference from the empty `<text>`. **Exactly one element per token wears
`.lem-edit`**, or `lemmaElOf`'s `querySelector` would have to choose. The rect's box is the painted row's own
crop box (`y−11`, 14 tall) and its width the token's form width floored at `LEM_HIT_MINW` 24px, so aiming at a
blank slot means aiming exactly where the lemma would be; it is deliberately **not** pushed into `boxes`, which
`fitTight` crops to — those describe ink.
⚠️ **AND `rect.lem-hit` STATES THE ROW'S OWN FACE IN CSS.** `makeEditable`'s `applyFont` copies the family, size,
weight, ink and `font-feature-settings` off the element the field opens over; a bare rect inherits none of
`.tok-lemma`'s 15px/smcp, so the field would open — and caret — in a face the committed value is not painted in.
The HTML cells keep `.bwlemma`/`.olemma` and need only the min-width. Measured in the shipping WKWebView (the
engine that has to answer this, not Chrome): the rect over `dog` reports `font-feature-settings:"smcp"`, 15px,
`"Noto Sans"` — the painted row's own three — with `fill: rgba(0, 0, 0, 0)` and a box of 27.52 × 14 (the form's
own width; the one over lemma-less `ran` falls to the 24px floor), and the field opened on it comes up on the
STORED `dog` with both the feature list and the size matching.

⚠️ **AND THE ROW A LEMMA EDIT BRINGS IN** ("…unless a token is being edited, in which case it should slide into
view"). The row's presence is computed at render time from the sentence's own tokens, so this is a FORCE for one
sentence plus a re-render plus an animation — `lemRowForce` (js/diagram/diagram-core.js), called by
`editLemmaInline` when it can find no element to lay a field over, and undone by that field's commit callback
whatever the edit did.
⚠️ **THE FORCE RIDES ON THE DISPLAY TOKEN ARRAY, NOT ON AN AMBIENT "CURRENT SENTENCE".** `displaySent` stamps
`lemForce` on the array it returns, at both of its exits, and every reserve and draw site in all eight renderings
already holds exactly that array — it is the `t` they hand `hasTr(t)`. So the forced state travels with the very
data the reserve is computed from. (A property on an Array is invisible to `JSON.stringify`, so it reaches
neither `diaContentSig` nor an undo snapshot nor the file — which matters, because with merge-punctuation OFF
and no goeswith to fold, the "display" array IS `sent.tokens` itself. It is rewritten on every render, so it is
never stale either.) Keyed on the SENTENCE OBJECT rather than its index:
an index survives a document replace or an undo that swaps every object, and would force the row onto whatever
sentence inherited the number.
⚠️ **AND THE DIAGRAM CACHE HAS TO BE TOLD** — `invalidateDiaSentence(si)`, since the force is in neither half of
DIA_CACHE's key. Deliberately not added to `diaFlagsSig`: that signature is global, so a per-sentence fact put in
it would drop every other sentence's entry on every lemma edit. This is the same miss `show.lemma` made in that
signature (below), and the same failure it produces: the row appears not to arrive at all.
⚠️ **THE SLIDE ANIMATES LAYOUT, WHICH IS ITS HONEST COST.** The block genuinely gets taller — unlike the AVM's
hover growth, which animates inside space `avmLayout` already reserved — and the row arrives in the MIDDLE of the
below-stack, so the growth lands at the bottom of the `.diagram` box. `lemSlide` holds the following content
where it was (a negative `margin-bottom` of the height just gained, measured across the re-render) and hides the
gained strip (`clip-path` inset from the bottom), then transitions both to zero over 140ms: the stack slides down
out from under the clip while the page closes in behind it. The clip is not decoration — with the negative margin
alone the NEXT block paints over the arriving row for the whole transition, since two in-flow siblings paint in
DOM order. `margin-bottom` is not a compositor property, so every following block in the render window
re-lays-out on each frame; the alternative (a transform on every following sibling) trades that for a stacking
context per block and has to be undone by hand. The way OUT is the mirror **without the clip** — by then the row
has already gone, so there is nothing to reveal, and `none` → `inset(…)` is not an animatable pair, so writing
one there would only add a property the engine declines to transition (probe: `animOut: ["margin-bottom"]`, one
transition, against `animIn: ["clip-path","margin-bottom"]`). The gain is divided
by `cssZoomOf()` (`getBoundingClientRect` is visual px, `margin-bottom` is authored inside `.sblock{zoom}`), and
the cleanup is on a TIMER, not `transitionend`: two properties fire two events and a transition the engine
declines to run fires none, which would leave the clip in place forever.
⚠️ **AND THE COMMIT CALLBACK MUST NOT RENDER TWICE.** `lemRowForce` renders by itself, so the cancel branch of
`editLemmaInline`'s callback (which used to call `preserveScroll(renderDoc)` unconditionally) now renders only
when no force was undone. Measured before that fix: the second render replaced the very element `lemSlide` had
written its from-state onto, so the departure animated for exactly as long as it took the next statement to run
— the probe read `animOut: []` against `animIn: ["clip-path","margin-bottom"]`. Rendering twice was always
wasteful; here it was also visible. ⚠️ **THE ONE RACE THAT REMAINS IS `commitLemmaEdit`'s**: on a commit whose
new lemma is the form (so the row leaves), that function's own post-await re-render can cut the departure slide
short. The end state is right either way, and the alternative — holding the row up until the bridge answers —
would be a longer wrong.

⚠️ **`prefers-reduced-motion` IS ASKED IN JS, not left to app.css's blanket `transition:none!important` under
that query** — that rule would strip the transition but leave `lemSlide` writing a from-state that then never
animates back, i.e. a permanently clipped block. Under reduced motion the row simply appears.

⚠️ **AND MAKING THE ROW A PARAMETER FOUND A LATENT OVER-RESERVE.** `htmlTieBottom` (the MWT tie's OWN below-stack
— surface form, transliteration, ExtPos label) calls `belowRows` too, and while that function read `lemmaRow()`
out of a global it silently reserved a lemma row under every tie in the document whenever the tier was on. A tie
spans a RANGE and has no lemma column at all, so it now passes `false` explicitly, and says so in place.

⚠️ **⌘L AND "Edit lemma…" NOW PREFER THE INLINE FIELD** (`editLemmaAt`), falling back to the `editLemmaPrompt`
popover only where it genuinely cannot open: the tier switched OFF in Show/Hide — a standing choice about every
sentence, which an edit may not overrule — or a block that is not rendered. Both editors write the same column
through the same `afterLemmaEdit`. No `pick()` on that path (CLAUDE.md).
⚠️ **`tierNav`'s `paintsLem` SKIP IS DELIBERATELY LEFT AS IT WAS**: arrow/Tab navigation still steps OVER a
token whose lemma equals its form, even though that token is now clickable. Not an oversight — it is the one
inconsistency item 31 leaves, and it is the conservative direction (a keyboard walk along the row stops only
where there is something to read).

⚠️ **THE SMALL CAPS ARE `smcp`, NOT THE `c2sc` EVERY OTHER SMALL-CAPS REGISTER IN THIS APP USES.** `.tok-pos`,
`.bwpos`, `.opos`, `.node-cat`, `.mwt-pos`, `.avm-attr` and `measGloss`'s Leipzig runs all set `c2sc`, which maps
CAPITALS to small caps — right for a closed inventory of all-caps tags, and a **no-op on lowercase**. A lemma is
ordinarily lowercase, so c2sc would have left this row in plain lower case. Measured in the shipping WKWebView
against the real "Noto Sans" at 60px: `iii` 46.45 plain → **52.39** under smcp (small-cap I is far wider than
lowercase i), `mmm` 168.31 → **132.48**, and `DOG` is **unchanged** by smcp (134.34) while c2sc takes it to
108.38 — the same 108.38 that smcp gives `dog`. Two features, one set of glyphs, each reached from its own side.
⚠️ **AND `font-feature-settings`, NOT `font-variant-caps:small-caps`.** The property matters twice over. First,
`font-variant-caps` lets the engine SYNTHESISE small caps (scaled-down capitals) where the face has no `smcp`
table — most of `--token-font`'s Noto stack — and a faked small cap is worse than none; `font-feature-settings`
has no synthesis path, so a face without the feature simply paints the plain letters, which is also the right
rendering for a caseless script (verified in WKWebView: Devanagari `गज` and Arabic `كتاب` measure identically
with the feature on and off). Second, `font-feature-settings` is the only form the measurement channel speaks:
`_measOne`'s third argument (`LEM_FEAT`) and `makeEditable`'s `applyFont`, which copies
`getComputedStyle(row).fontFeatureSettings` onto the inline field and measures through it. A `font-variant-caps`
row reads back "normal" there, so the field would paint in full lower case over a row set in small caps and its
caret maths would run in a face the glyphs are not drawn in.
⚠️ **THE MEASUREMENT FOLLOWS THE PAINT** at every site — `lemmaSlotW`, the crop boxes, the hit widths and the
field all go through `meas(…, LEM_F, LEM_FEAT)`. Measured in WKWebView: the row's own `meas` 27.09 against the
painted `getBBox()` 27.11, where the unfeatured measurement would have said 27.52. This is the same fault the
word-class field had (measured plain, `NOUN` is 45.48px against 37.13px in c2sc).

⚠️ **`show.lemma` HAD TO JOIN `diaFlagsSig` (js/core/document.js), AND FORGETTING IT WAS CAUGHT BY THE PROBE
RATHER THAN BY READING.** A `show.` flag missing from the diagram cache's view signature does not draw wrong; it
draws NOTHING NEW — the Show/Hide switch flips, `renderDoc` runs, and `diaSentence` hands back the node it built
under the other setting. Measured before the fix: 3 `.lem-edit` elements before AND after unticking the tier, and
`belowGap()` deltas of exactly 0 where they should have been 21.6. Same class of miss as the theme flip's.

⚠️ **AND IN THE WRAPPED-BRACKETS FLEX COLUMN THE BLANK CELL IS STILL APPENDED.** `.bwund` is a flex column, so an
omitted row is a missing flex item and every row under it in THAT token's stack rises one step while its
neighbours' stay put — the very misalignment `--undpad`'s `belowReserveH` has already paid for. An EMPTY flex
item has no line box and measures 0 tall, so `.bwlemma` states `min-height:18px`, which is `.bwund`'s own line
step. Verified live: every `.bwlemma` cell 18px tall, painted or blank, and the `.bwpos` tops under all five
seeded tokens within 0.00px of each other.
⚠️ **AND ITEM 31 REVERSES THE OUTLINE'S OPPOSITE RULE.** That span used to be appended only where it painted —
correct reasoning about ALIGNMENT (the outline's tiers run ALONG the row, so there is no column of rows under
this one for an omitted span to lift, and an empty span with a leading margin merely opens a gap) — and it is
overruled by "clicking on a hidden lemma should still bring up the input field": leaving the span out is the one
thing that makes a hidden lemma unreachable in that notation, since nothing else in the row can be aimed at. The
cost is exactly the gap the old note names (`.olemma`'s 8px inline margin plus `.lem-hit`'s 24px min-width), paid
only in the sentences that have the row at all.

⚠️ **THE HIERARCHY GAINS THE ROW TOO** (unlike the POS row, which that notation draws AS its nodes). Its three
hand-written step expressions — the gloss tiers' `step`, the AVM's `nodeBot` and the goeswith slur's own — each
take one more `belowGap()`, gated on `lemmaRow(t)` and NOT on the token, for the same reason `hasTr(t)` there is
sentence-wide: a node that happened to paint nothing would pull its glosses up into this row's line.

Verified across all eight renderings (stemma projected and POS-as-node, hierarchy, arcs flat and wrapped,
brackets flat and wrapped, outline) in both kits, headless Chrome, and again in WKWebView. Item 31's own checks
ride in the same probe (`lem_probe.py`): the gate per token in all eight; the POS row at one y across a sentence
holding both painted and blank slots; a sentence with NO row whose stack is internally consistent, and the same
sentence one differing lemma later, every stack stepped down by exactly `belowGap()`; a click on a blank slot
opening the field on the STORED lemma over a `rect.lem-hit`, in the row's own face; and an edit in a row-less
sentence bringing the row in (with both CSS transitions live) and taking it away again — plus the reduced-motion
run, where the row arrives with no from-state and no animation at all.

## Right-clicking an AVM

The AVM tier answers the same right-click (and double-click) gesture everywhere, through one resolver,
`avmMenuAt`:

- **On a row of an existing matrix** → `avmValueMenu`, that feature's own values. It now ends with the
  **Add Feature…** flyout as well, on request — the identical row the token menu offers (`addFeatureRow`,
  reused rather than rebuilt, so the two gestures can only ever offer the same candidates through the same
  `avmSetFeat` write). One flyout deep, which is all `openSub`'s singleton `ctx2` supports — the way DOWN
  from there to the rest of the UD inventory is a drill-down inside that one flyout, not a second layer
  (`editing.md`).
- **On the empty-tier placeholder** (`.avm-add` in the SVG notations, `.oavm-empty` in the outline) →
  `avmAddMenu`, which opens that same add-feature picker **directly as the menu**: there is no existing feature
  here to edit, so the list of what could be added *is* the whole menu. It returns false when nothing is
  attested for this token's word class, so the gesture falls through to the ordinary token menu rather than
  opening an empty one. This closes the gap `addFeatureRow`'s own note describes — a token with `feats="_"`
  drew no box, so there was nothing to right-click at all.

⚠️ **THE RELATION LABEL IS DELIBERATELY NOT ONE OF THESE TIERS**, and it was tried the other way first. A
placeholder was put on `drawLabel`/`setRelLabel` for one round, together with the four draw sites and the
gap-reservation predictor that all gate on the relation being non-empty, and then taken back off on instruction:
*"empty relation labels should simply disappear, since they can always be set by right-clicking the dependency
edge."* The reasoning is the difference between a ROW and a LABEL — a below-stack row has a reserved slot whose
emptiness needs explaining, where a label sits on an edge that is already drawn, already says which token
attaches where, and already carries the gesture that sets the relation. An underscore floating over it adds a
word to read and nothing to learn. So an empty relation paints nothing, and the label's reserved width goes on
being measured off the relation itself (0 when there is none). ⚠️ **CONTRAST THE LEMMA ROW**, which is the other
tier that can paint nothing: it is a ROW, so it keeps its reserved slot and every stack stays aligned — only the
ink is gated. The two exceptions differ in exactly that, and the difference is the whole reason both are allowed.

⚠️ **THE PLACEHOLDER'S TARGET IS A TRANSPARENT RECT, AND IT NEEDS `data-s`/`data-tok` OF ITS OWN.** The glyph is
~6px of ink at 10.5px, too small to aim at, so `drawAVM` wraps it in a `<g class="avm-add">` over an `.avm-hit`
rect — the same rect-under-the-row trick every real AVM row already uses. And, exactly like a real row, it
carries `data-s`/`data-tok` when the caller has them: in **wrapped brackets** the AVM is drawn into the
`.bwannot` overlay `<svg>`, which is appended to the block rather than nested in the token, so `tokFromEl` has
no token ancestor to walk up to. That overlay is `pointer-events:none` wholesale, so `.bwannot .avm-add` takes
the same explicit exemption `.bwannot .avm-row` does, or the right-click never reaches it.

## The empty placeholder answers hover and a left click too (item 32)

On request: *"AVMs should unfold to show the '+' whenever the bounding box of the unfolded AVM is hovered.
Also, blank FEATS values should change from '_' to '+' on mouseover and be clickable just like the AVM '+'."*
Before this item the empty-AVM placeholder (`.avm-add`'s bare `TIER_EMPTY` text, `.oavm-empty`'s outline twin)
had none of the populated matrix's hover/focus/click affordance — this brings it to parity.

⚠️ **THE LITERAL READING IS THE RIGHT ONE, because a placeholder has no bracket to unfold.** A populated
matrix "unfolds" by growing a bracket that has no equivalent on a placeholder — there is nothing here to grow
(the note two sections up: "no bracket — an empty pair reads as a matrix whose contents went missing"). So the
natural equivalent of "unfold to show the +" for THIS case is exactly the user's other sentence taken
literally: the same glyph position swaps `"_"` → `"+"`. Two elements at the identical x/y, CSS choosing which
paints (`.avm-add-under`/`.avm-add-plus` in SVG, `.oavm-empty-under`/`.oavm-empty-plus` in the outline,
`styles/app.css`) — the same "both states drawn, CSS toggles opacity" idiom `.avm-grow-spine`/`.avm-grow-rule`
already use for the bracket's own rest/grown pair, chosen over rewriting `textContent` on hover because an SVG
attribute cannot be eased by a CSS transition and two elements' opacity can. Triggers are the identical trio:
`:hover`, `:focus-within` (the placeholder's own group carries the tabindex, and `:focus-within` matches an
element that IS `:focus`, not only one with a focused descendant — no separate `:focus` rule needed), and
`.avm-open` (set/cleared by `setAvmOpen`/`clearAvmOpen`, extended to look for `.avm-add`/`.oavm-empty` too, so
the mark stays up while its own menu is open exactly as the populated mark's does).

⚠️ **NO GROWTH, AND NOTHING FOR THE HOVER REGION TO GET WRONG.** Per the user's own "bounding box of the
*unfolded* AVM" wording — the populated case's own hit-rect is already sized to the GROWN box specifically so
the pointer never falls outside it chasing the revealed mark. The placeholder has no grown state to reserve
for: one line of text at rest, one line of text hovered, identical footprint either way — so the existing
`.avm-hit` rect (already sized to the row's own reserved height, `eh+8`, on the same "hit surface = the row,
not the ink" argument its own note above makes) already covers the only state there is. Confirmed, not assumed
— there is no separate GROWN geometry in this design for a hit-region to under- or over-shoot.

⚠️ **THE OUTLINE'S TWIN NEEDED AN "ADDS NO WIDTH" TECHNIQUE, NOT A NEW ONE.** `avmInline`'s empty span is now a
wrapper (`.oavm-empty`, `position:relative`) holding two children: `.oavm-empty-under` in normal flow (so the
row still sizes to it, unchanged) and `.oavm-empty-plus` (`position:absolute; inset:0`, flex-centred) laid over
it — the same "an absolutely-positioned mark shares a cell without widening the row" idiom `.gw-h`'s own note
already documents in this file, applied to a second case rather than invented for this one.

⚠️ **LEFT CLICK REUSES `.avm-plus`'S OWN NO-`pick()` MACHINERY, EXTENDED RATHER THAN DUPLICATED.**
`diagram-edit.js`'s pointerup tap branch resolves `plEl` as `.avm-plus,.avm-add` now (one lookup, both marks);
`context-menu.js`'s plain "click" listener (the route wrapped-brackets' and the outline's own marks take,
since their overlay/row isn't part of the node drag-tap system) resolves `.avm-plus,.avm-add,.oavm-empty` the
same way. Both still return before any `pick()`/render, exactly as the flicker note by that branch already
requires — the empty placeholder gets the identical guarantee the populated mark has always had, through the
identical code path, not a parallel one.

⚠️ **ITEM 4's OWN QUESTION — "IS THE POPULATED CASE ACTUALLY FINE?" — FOUND A REAL, PRE-EXISTING BUG, IN THE
ONE NOTATION WHOSE AVM OVERLAY SITS OUTSIDE THE NODE IT ANNOTATES.** Verified live over CDP (patched
`pick`/`renderDoc`, `CSS.forcePseudoState` for the hover, real synthetic clicks for the rest): a click on the
EXISTING, shipped `.avm-plus` in **wrapped brackets** opened the add-feature menu correctly AND ALSO called
`pick(i,0,false)` — deselecting and, since `pick()` ends in `preserveScroll(renderDoc)` unconditionally for
`conv==="brackets"`, re-rendering the whole block underneath the just-opened menu, replacing the very node the
pointer was on (measured: pickCalls 1, renderCalls 1, "same node" false). Root cause: `.bwannot` (the AVM's own
overlay `<svg>` in this one notation) is appended straight to the `.sblock`, not nested inside any `.bwtok` —
so a click on an AVM affordance inside it fell through the BLOCK's own "click on empty diagram space →
deselect" listener (`js/core/document.js`, `b.addEventListener("click",...)`), whose exclusion list named
every OTHER selectable class (`.node,.tok-group,.arc,.edge-g,.oline,.brk,.bwtok,.bwbr,.mwt-form`) but no AVM
one. Not something this item's empty-placeholder work introduced — the populated `.avm-plus` has had this gap
since the AVM tier moved into the wrapped-brackets overlay; nothing had clicked it there in a way that
surfaced it before. Fixed by adding `.avm-add,.avm-box,.avm-plus,.avm-row` to that exclusion list, and to the
block's own `contextmenu` listener beside it (the identical gap, one gesture over — right-click already ended
up correct because `avmMenuAt` at `#doc` runs after and wins, but not before this block's own handler had
already built and thrown away a whole SENTENCE menu first, the exact wasted-churn failure mode that listener's
own comment already documents for `.mwt-form`/`.mwt-tr`). After the fix: pickCalls 0, renderCalls 0, same node
true, in both the empty placeholder AND the populated matrix, in wrapped brackets. Every other notation was
already fine — stemma/arcs/tree/flat-brackets nest the AVM inside `.node`/`.tok-group`, which this listener's
existing exclusion already covered, and outline's row carries no such background-deselect listener at all.

Verified live (CDP, `samples/dev-fixture` sentences and cross-checked against a `samples/english.conllu`
FEATS-blank-token count): rest/hover/focus/blur/left-click/right-click behaviour correct in all five
notations, flat AND wrapped brackets, for both an empty placeholder and (as a regression check) a populated
matrix — 66 assertions, 0 failures after the document.js fix above.

## Item 33 — the empty mark becomes the populated mark, and the wash joins the trigger

On request: *"The empty-AVM plus sign should be the same size as the visible-AVM plus sign, and should have
the blue highlight on hover. Also, the empty-AVM placeholder should be invisible."* and *"AVMs should expand
to show the plus sign whenever the token wash is hovered, not just the AVM."* Refines item 32 immediately
above — that note stays in place; this one supersedes only the MECHANISM item 32 built, not the reasoning
about hit-rect sizing, right-click resolution, or the wrapped-brackets `.bwannot` gap it records.

⚠ **THE FIX FOR "SAME SIZE" WAS TO STOP DRAWING A SECOND MARK, NOT TO RESIZE THE FIRST ONE.** Item 32's empty
placeholder drew a 10.5px font glyph `"+"` (`.avm-add-plus`); the populated matrix's own mark
(`AVM_PLUS_R=3.5`, drawn with the bracket's `.mwt-tie`/`.mwt-tie-cas` classes) is a hand-drawn 7×7 cross-hair
stroke path — a different mark by construction, not merely a mis-tuned size. `drawAvmPlus(svg,cx,y,si,tokId)`
(`js/diagram/diagram-core.js`, immediately above `drawAVM`) is now the ONE place this mark is drawn — both
`drawAVM`'s populated branch (`cx,y1`, the bracket's own bottom rule) and its `!L` empty branch (`cx,
y0+ascent(AVM_VAL_F)`, the placeholder's own glyph baseline — there is no bottom rule for a one-line
placeholder to sit on) call it, so a future change to what this mark looks like cannot land on one call site
and not the other. Verified live (CDP, forced `:focus-within`, `prefers-reduced-motion:reduce` emulated — see
below for why): the populated and empty marks' own `path.mwt-tie` report **identical** `strokeWidth` (1.5px),
`stroke` colour, and `getBBox()` (7×7) — not merely "look similar", measured equal.

⚠ **THE OUTLINE'S TWIN DIDN'T NEED A SIZE FIX AT ALL, ONLY A HOVER-COLOUR ONE** — checked live rather than
assumed: `.oavm-empty`'s font-face declarations (10.5px/571/`--tie-hue`) already matched `.oavm-plus`'s own
exactly, because item 32 built the empty case's font-glyph mark by copying the populated mark's own face in
the first place. What the empty case's `.oavm-empty-plus` never had was `.oavm-plus:hover,.oavm-plus:
focus-visible{color:var(--accent)}` — a class name away, not a broken rule. The fix is the SAME "reuse the
class, not the declaration" move as the SVG side: `avmInline`'s empty branch now gives its "+" span
`class="oavm-plus oavm-empty-plus"` — `.oavm-plus` supplies the face AND the hover-accent rule for free,
`.oavm-empty-plus` keeps only the positioning half (`position:absolute;inset:0`, the same "shares a cell
without widening the row" trick `.gw-h` already uses). Only the REVEAL TRIGGER needed restating
(`.oavm-empty:hover .oavm-plus,…{opacity:1}`, app.css) — it is keyed to the ANCESTOR wrapper class, and
`.oavm-empty` is a different class from `.oavm`, so that one rule could not come for free the way the face
and the hover-colour did.

⚠ **"INVISIBLE AT REST" IS A DELIBERATE, EXPLICIT OVERRIDE OF THIS FILE'S OWN TIER_EMPTY CONVENTION, FOR THIS
ONE TIER'S HOVER AFFORDANCE ROW ALONE.** "The empty-value placeholder" section above states the general rule
("a tier that is visible but has no value for this token draws TIER_EMPTY, not nothing") and CLAUDE.md states
it too. This item removes TIER_EMPTY from the AVM's own empty-placeholder mark specifically, ON REQUEST, and
does not touch any other tier's handling — the transliteration row, the POS row, the gloss tiers and every
other reader of `TIER_EMPTY`/`tierEmptyCls` are untouched. With the mark now genuinely `drawAvmPlus`'s own
reused `.avm-plus`/`.oavm-plus` (already `opacity:0` at rest by construction, the same as the populated
mark's own resting state), there is nothing left for the old "_"→"+" crossfade to crossfade FROM, so
`.avm-add-under`/`.avm-add-plus`/`.oavm-empty-under` and their CSS are deleted outright rather than left as
unreachable code. Verified live: the empty placeholder's own `<g class="avm-add">` paints only `rect`/`g`/
`rect`/`path`/`path` — no `<text>` node at all, at any time — and the outer row-sized `.avm-hit` rect (24px
wide, unaffected by this item) still carries the row's own reserved footprint into `boxes` so `fitTight`'s
crop keeps including this row exactly as it did when an underscore occupied it.
⚠ **KEYBOARD FOCUS STILL REVEALS IT** — confirmed live (`:focus-within` on the `.avm-add`/`.oavm-empty`
wrapper, `.avm-plus`/`.oavm-plus`'s own `tabindex="0"`): a tab-focused empty placeholder is not left
invisible and undiscoverable, exactly the concern that motivated checking this.
⚠ **RIGHT-CLICK IS UNCHANGED, CONFIRMED RATHER THAN ASSUMED**: `avmMenuAt` resolves `.avm-add`/`.oavm-empty`
by CLASS, not by what is painted inside them, so nothing here could have broken it — verified live, the
add-feature picker opens identically before and after this item, on both the mark's own resolution path and
the row's wider one.

⚠ **THE `:has()` TRIGGER IS ADDITIVE, KEYED TO `.tok-group`/`.node` — TRACED LIVE, NOT ASSUMED FROM THE
SOURCE.** `.tok-wash` (the per-token hover/drag-target highlight) is a sibling of `.avm-box`/`.avm-add`, not
an ancestor, so `:hover` on the wash alone never reached the AVM's own reveal rules — only hovering the
AVM's own tight row did, even though the wash is already sized to geometrically reach through the whole
below-stack including the AVM row. This file's own `:has()` idiom (`.shead:has(.stext-stacked)`,
`#findBar:has(#findPanel:not([hidden]))`) fits directly: the common ancestor that wraps BOTH the wash and the
AVM turns out to be one of exactly two classes, confirmed against the real rendered DOM (CDP) rather than
inferred from the JS source alone —
`.tok-group` (stemma's projected baseline row, both arc views, flat and wrapped) and `.node` (the hierarchy,
`tree()` in diagram-wrap.js, which is the SAME function for both flat and wrapped). Four new rules
(`.tok-group:has(.tok-wash:hover) .avm-grow-spine`/`…avm-grow-rule`/`…avm-plus`, and `.node:has(…)` twins)
sit ALONGSIDE the existing `.avm-box:hover …`/`.avm-add:hover …` triggers — direct hover on the AVM's own row
keeps working exactly as before, since a hover landing there never actually reaches `.tok-wash` itself (the
AVM's own hit-rect is painted OVER the wash at the rows it occupies, so the two triggers cover disjoint
pointer positions and never double-fire for the same point).
Verified live (CDP, `CSS.forcePseudoState` forcing `:hover` on the wash element specifically — see the
methodology note below): forcing `:hover` on `.tok-wash` reveals `.avm-plus` (`opacity:1; pointer-events:
all`) for BOTH a populated matrix and an empty placeholder, in stemma, arcs AND the hierarchy alike; forcing
`:hover` on an unrelated element (the sentence's own root `<svg>`) leaves it at rest (`opacity:0`); forcing
`:hover` directly on `.avm-box`/`.avm-add` still reveals it too (the regression check).
⚠ **NOT ADDED FOR WRAPPED BRACKETS, NOR FOR FLAT BRACKETS, NOR FOR OUTLINE — CONFIRMED LIVE, NOT ASSUMED.**
`document.querySelectorAll('#doc .tok-wash').length` is **0** in all three (checked live, switching the
document's own live `conv`/`show.wrap`). Wrapped brackets' reason is structural, not merely "no wash exists
today": `.bwannot` (the AVM's overlay `<svg>`) is built ONE PER SENTENCE and appended as a sibling of every
`.bwtok` in that block (`positionBracketAnnots`, js/core/document.js) rather than nested inside any one
token's own element — there is no PER-TOKEN common ancestor for `:has()` to scope to even if a wash existed,
and the only ancestor shared by both at all (`.bwrap`) holds every token in the sentence, which would reveal
every AVM in the block at once rather than just the hovered one. Flat brackets and outline simply have no
wash-shaped hover surface at all (flat brackets draws a `.span-hit` per BRACKET SPAN, not per token; outline
is plain HTML inline flow with no per-token hit-rect) — so, per the same principle this file already applies
to a tier with no analogue, nothing was invented for them. All three keep `.avm-box:hover`/`.avm-add:hover`
(`.oavm:hover`/`.oavm-empty:hover` for outline) as their only trigger, exactly as before.
⚠ **PERFORMANCE, MEASURED RATHER THAN ASSERTED**: the 8-sentence fixture renders 128 `.tok-wash` elements;
a full pass reading `getBoundingClientRect()` + a forced `getComputedStyle()` read across every one of them
(deliberately worse than what one real mouse-move triggers, which recalculates style ONCE per move, not once
per token) measured **0.4 ms total** in the live app (`performance.now()`, CDP). No visible jank at this
document's scale; a much larger document would be the thing to re-measure before trusting this further.

⚠ **METHODOLOGY NOTE, WORTH RECORDING FOR THE NEXT SESSION THAT REACHES FOR CDP HOVER VERIFICATION**: neither
`Input.dispatchMouseEvent("mouseMoved", …)` NOR `CSS.forcePseudoState` reliably produced a visible/computed
change on the FIRST attempt in this Chrome build (152), in headless OR real windowed mode, even on a
trivial, unrelated test page — `element.matches(':hover')` (or `:focus`) could read true while
`getComputedStyle` still reported the resting value. Root-caused to a genuine ANIMATION-CLOCK problem, not a
CSS or JS defect: a property under an active CSS `transition` (this app's `.avm-plus{opacity:0;transition:
opacity .1s ease}` among them) does not visibly resolve unless a real frame is produced, and this exact
class of "no rAF/frame pump" gap is already documented in this file's own WKWebView note above ("
`requestAnimationFrame` never fires in that hidden window") — headless Chrome under CDP-driven synthetic
input turned out to have an analogous gap. `Emulation.setEmulatedMedia({features:[{name:
"prefers-reduced-motion",value:"reduce"}]})` removes the transition (this file's own CSS already drops it
under that query) and made every subsequent `:focus`/`:focus-within`/forced-`:hover` check resolve
immediately and reliably; `CSS.forcePseudoState` also needed a *fast* `DOM.getDocument` → `DOM.querySelector`
→ `CSS.forcePseudoState` sequence, because this app runs an unrelated, pre-existing periodic `renderDoc()`
(measured live: ~6 calls/second with NO interaction at all, unrelated to this item and not investigated
further here) that replaces the very nodes a slower round-trip would still be holding a now-stale id for.

## Item 34 — the wash trigger, reverted

Item 33's `:has(.tok-wash:hover)` broadening (above) is **removed**, on explicit follow-up instruction: "make
the AVMs unfold only upon hovering the bounding box of their unfolded state, not the whole token wash." Item
33 had read the ORIGINAL request's own wording — "whenever the bounding box of the unfolded AVM is hovered" —
as license to widen the trigger to the token's whole wash; this follow-up says plainly that the bounding box
meant is the AVM's OWN unfolded box, not the token's. Nothing else needed to change: `.avm-box:hover`/
`.avm-add:hover` (and their `:focus-within`/`.avm-open` twins) were ALWAYS already sized to that box —
`.avm-box`'s own hit-rect spans `y0..y1`, the GROWN/reserved height, per its own note earlier in this file —
so removing the four `:has()` rules alone restores exactly the behaviour asked for, with no compensating
change anywhere else. Everything ELSE item 33 did — `drawAvmPlus`'s one shared mark definition, the
invisible-at-rest empty placeholder, the accent-on-hover parity between the populated and empty marks —
stands untouched; this reverts ONLY the wash broadening described in item 33's own section above (left in
place as the record of why it was tried and what was found, per this file's own "extend a note, don't
replace what it records" convention).

## Item 35 — only the annotation elements carry a cursor; every whole-token wrapper is a second offender

On request, generalising two earlier steps this same session (`.tok-wash` then `.tok-hit` lost their own
`cursor:pointer`, app.css ~line 550) into a stated principle: *"I only want the actual, individual
annotation elements (token, lemma, POS, AVM) to have special cursors, not the area between or around
them."* The two earlier steps were themselves fine — `.tok-hit`/`.tok-wash` really are "the area
between/around", not an annotation element — but auditing every notation against the STATED principle
found the SAME violation standing in five more places, one of them hiding in a way a stylesheet-only
search cannot see.

⚠ **REMOVING `.tok-hit`/`.tok-wash`'s OWN CSS RULE CHANGED NOTHING OBSERVABLE, AND THE REASON IS WHY THIS
ITEM EXISTS.** Both rects sit INSIDE a `<g class="tok-group">` (stemma's baseline row and node, arcs flat
and wrapped, wrapped-stemma's row and its own mini tree-nodes, the hierarchy, flat brackets — eight
creation sites across `diagram-render.js`/`diagram-wrap.js`) or `<g class="node">`, and every one of those
EIGHT wrapper groups was ALSO carrying `g.style.cursor="pointer"` — set once, inline, in JS, at the same
site that wires the group's own `click→pick()` selection handler. `cursor` is inherited, so once the
rects' own rule was gone the computed value at any point inside the group simply fell through to this
ancestor's inline style — still "pointer", unchanged, at every pixel of the token's bounding box that no
more specific descendant painted over. Confirmed live (CDP, `getComputedStyle` at a point sampled just
inside a token's wash box that overlaps none of `.tok-word`/`.tok-pos`/`.lem-edit`/`.translit`/`.avm-row`):
`pointer`, `rect.tok-hit tok-wash`, in EVERY SVG notation, BEFORE this item's fix — proving the two earlier
steps had not actually changed what the reader saw hovering that space, only which rule supplied the value.
The outline's `.oline` had the identical second life: app.css's own `.oline{cursor:pointer}` was removed as
this session's map predicted, but `row.style.cursor="pointer"` (outline(), `diagram-wrap.js`) — the SAME
whole-row wrapper, set inline at its own `click→pick()` wiring, exactly the `.tok-group` pattern above —
was missed by a search that only grepped the stylesheet, and kept the row reading `pointer` regardless.
Wrapped brackets' `.bwtok` had the same thing (`grp.style.cursor="pointer"` in `wordSpan()`,
`diagram-wrap.js`) and is the one instance this session's own map anticipated checking for live rather than
assuming clean ("Check whether `.bwtok` currently carries ANY cursor rule").

**The fix, everywhere, is the same one-line deletion**: drop the inline `X.style.cursor="pointer";`
assignment on the wrapper group/row itself, leaving its `click`/`addEventListener` wiring untouched — the
token/row is still the click TARGET (selecting it, or the drag surface for reheading), only the CURSOR that
volunteers this ahead of the click is gone, exactly the trade the `.tok-hit`/`.tok-wash` note above already
states. Ten sites in total needed it: the eight `.tok-group`/`.node` creation sites (`diagram-render.js`
lines 205, 310, 585; `diagram-wrap.js` lines 1015, 1251, 1324, 1652, 1883) plus `.bwtok` and `.oline`
(`diagram-wrap.js`, both already noted above). Every genuine annotation-level click target was left alone
BY THE SAME PRINCIPLE that removed the wrappers' own rule — a real, tightly-fitted, individually
selectable mark keeps its pointer exactly as `.avm-row`/`.punctsat`/`.bwbr`(with an owner)/`.edge-g`/
`ghost-g` (`wireGhostClick`) already did: none of those are "the area between or around", they ARE the
thing a reader is aiming at, so none of their cursor rules were touched.

⚠ **AND TWO GENUINE GAPS NEEDED THEIR OWN NEW RULE, NOT JUST A DELETION** — `.oform` (outline's form) and
`.bwform` (wrapped brackets' form) had NEVER been given a cursor rule of their own; they had been reading
`text` (or, under Sanskrit script display, the wrong value entirely) purely by inheriting it from their
now-fixed wrapper. Both join the existing `.baseword,.tok-word,.node-lbl,.mwt-form{cursor:text}` rule
(app.css ~1630) and its `#doc.script-form` pointer override (~1649) explicitly — `SEAM_ROW_SEL`
(`diagram-core.js`) already treats `.oform`/`.bwform` as the same "form" tier as those four, so this
merely gives the two elements their own explicit answer to a question the file was already treating them
as being asked. `.olemma`/`.bwlemma` needed NO new rule: both carry the `lem-edit` class unconditionally in
JS (`ls.className="olemma lem-edit"+…`/`"bwlemma lem-edit"+…`) whether or not the row paints a value, so
`.lem-edit{cursor:text}` was already reaching them regardless of the wrapper. `.otrans`/`.opos` likewise
needed nothing: `.opos` was already in the shared POS list, and `.otrans` only ever carries `.tr-edit` when
genuinely editable (the same rule the SVG `.translit` row follows) — a placeholder translit row has never
had a cursor of its own in any notation, and this item does not add one (no new interactivity, matching
the file's own standing instruction not to invent any).

Verified live (CDP, headless Chrome, bare AND `?platform=win`; a token forced to carry FEATS, a
form-differing lemma, a POS tag, and a transliteration — `samples/`' dev-fixture Arabic sentence, token 2):
in every one of stemma/arcs/tree/brackets-flat/brackets-wrapped/outline, `getComputedStyle` at the form,
lemma, POS (absent by design only in the hierarchy — see below), AVM and translit each read their own
correct value (`text`/`text`/`text`/`pointer`/`text`), and a point sampled inside the token's own wrapper
that lands on none of them reads the AMBIENT `auto` in every case, not `pointer`. `#doc.script-form`
correctly flips `.oform`/`.bwform` (and the pre-existing four) to `pointer` and reverts to `text` the
moment the class is removed. ⚠ **THE HIERARCHY DRAWS NO SEPARATE POS ROW AT ALL, AND THIS PRE-DATES THE
ITEM** — `tree()`'s own `belowReserveH(…,false,…)` hard-codes the POS argument to `false` with the comment
"POS itself gets no explicit slot in this reserve"; a token's word class is simply never painted as its
own row in this one notation, so there is nothing there for a cursor rule to reach, and the probe
correctly finds zero `.node-cat`/`.tok-pos`-family elements for it — not a regression, a structural fact
about the notation confirmed live rather than assumed.

