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
says what the file says. ⚠️ **THE STEMMA'S POS-AS-NODE LABEL IS THE ONE DELIBERATE EXCEPTION**: an untagged node
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

## Right-clicking an AVM

The AVM tier answers the same right-click (and double-click) gesture everywhere, through one resolver,
`avmMenuAt`:

- **On a row of an existing matrix** → `avmValueMenu`, that feature's own values. It now ends with the
  **Add feature…** flyout as well, on request — the identical row the token menu offers (`addFeatureRow`,
  reused rather than rebuilt, so the two gestures can only ever offer the same candidates through the same
  `avmSetFeat` write). One flyout deep, which is all `openSub`'s singleton `ctx2` supports.
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
being measured off the relation itself (0 when there is none).

⚠️ **THE PLACEHOLDER'S TARGET IS A TRANSPARENT RECT, AND IT NEEDS `data-s`/`data-tok` OF ITS OWN.** The glyph is
~6px of ink at 10.5px, too small to aim at, so `drawAVM` wraps it in a `<g class="avm-add">` over an `.avm-hit`
rect — the same rect-under-the-row trick every real AVM row already uses. And, exactly like a real row, it
carries `data-s`/`data-tok` when the caller has them: in **wrapped brackets** the AVM is drawn into the
`.bwannot` overlay `<svg>`, which is appended to the block rather than nested in the token, so `tokFromEl` has
no token ancestor to walk up to. That overlay is `pointer-events:none` wholesale, so `.bwannot .avm-add` takes
the same explicit exemption `.bwannot .avm-row` does, or the right-click never reaches it.

