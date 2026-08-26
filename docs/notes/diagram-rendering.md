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
