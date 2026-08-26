# Scripts, fonts, and magnification

`js/lang/translit.js`, `js/lang/fontload.js`, `js/diagram/diagram-core.js` — the foreign-word mark, why the ornamental Sanskrit scripts draw at double size, and the ordering rules that keep the paint and the measurement in step.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

## The foreign-word mark, and the ornamental scripts

⚠ **A SCRIPT WITH NO ITALIC MARKS A FOREIGN WORD BY UNDERLINE** (`frnUnderline`, js/lang/translit.js;
`#doc[data-frnul]`, app.css). Italic is a Latin device that Cyrillic and Greek also have; a Brahmic
script, an abjad, Han/kana/Hangul have none, so `font-style:italic` there is a **synthesised oblique** —
a mechanical shear of the upright, which in a script of horizontal head-strokes and stacked marks reads
as damage rather than emphasis. ⚠️ **CHINESE IS ASKED FIRST AND NEVER TAKES THIS PATH**: it already has
its own answer (`hanFrnFace`, a change of FACE to 楷體), that answer is carried BY `.tok-ital`, and
underlining there would both duplicate the mark and undo the face swap. ja/ko fall through to the
underline, which is right — neither has an italic either, and Japanese uses katakana for this job.
⚠️ **THE DISPLAYED SCRIPT OUTRANKS THE FILE'S OWN**, exactly as in `hanFrnFace`: a Sanskrit document READ
in Devanagari has Devanagari on the main line whatever its FORM column holds, so `orthoScript()`'s answer
is taken whole. With no such scheme the file's own FORMS decide, by a capped scan — **never `t.ortho`,
which `fillOrtho` fills ASYNCHRONOUSLY**, so reading it would answer one way before a bridge round-trip
and another after it, flipping the mark under the reader mid-render.
⚠️ **THE MEASUREMENT FOLLOWS THE PAINT, WHICH IS THE WHOLE HAZARD HERE.** `frnFontStr` stops prepending
`"italic "`, and `italicTrackOf` keys off exactly that token — so the canvas string loses the 0.02 em
`ITALIC_TRACK` bump in the same breath the stylesheet does, and the slot cannot be measured in a face
the glyph is not painted in. The class stays `.tok-ital` even where the mark is an underline: every
consumer asks only "is this token carrying the foreign mark", and only the stylesheet needs to know
which mark that is. ⚠️ Greek is counted as HAVING an italic — a small widening of "Latin and Cyrillic",
on the grounds that Greek italic is a real face with a long tradition and underlining a Greek word would
look as wrong as slanting a Devanagari one. Verified in headless Chrome across all five notations: en
and Sanskrit-in-IAST italic, Sanskrit-in-Devanagari and an Arabic file underlined, Chinese on its Kai
path, the running line marked and the transliteration row (a Latin romanisation whatever the main line
is) left italic.

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

## A script switch is font, then size, then spacing

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

## Magnification carries the weight and tracking curves

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

## `--script-asc` is measured

⚠️ **`--script-asc` IS MEASURED, AND THE STACK ORDER DECIDES WHETHER THE MEASUREMENT IS TRUE.** Canvas
`fontBoundingBoxAscent` reports the metrics of the FIRST family in the font list whatever face actually shapes the
text: a Kawi character measured against the ordinary token stack answers **107** (Noto Sans Latin's ascent) and
only answers Kawi's own **110** when `Noto Sans Kawi` is named first. `scriptAscentEm` therefore names the
script's family ahead of the live stack; a face that will not resolve falls through to the Latin ascent, which is
the shift this had before it was measured at all. The faces differ by a third of an em (Kawi 1.10, Javanese 1.12,
Devanagari 0.90), which is why this is measured rather than tabulated.

## The running line, and the hanging scripts

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
