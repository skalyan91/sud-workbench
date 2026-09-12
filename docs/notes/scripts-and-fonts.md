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

## The Lemma row's `smcp` gap is inside Noto Sans itself, not a missing feature

⚠ **CONFIRMED LIVE, PER CODEPOINT: NOTO SANS'S OWN `smcp` TABLE IS INCONSISTENT ACROSS ONE NARROW
RANGE, AND THAT — NOT A MISSING FEATURE OR A WRONG FALLBACK FACE — IS WHY ṭ/ṇ/ṛ/ḥ DON'T SMALL-CAP IN
THE LEMMA ROW.** Reported as "ṣ, ṭ, ṇ don't show up in small caps"; checked with `hb-shape
--features=+smcp` and `hb-view` (real HarfBuzz, the shaping engine behind both Chrome and WebKit)
against the actual bundled `web/fonts/notosans.ttf` — the literal file `--token-font` names first.
Per CSS font-matching, the first family in a stack with a cmap entry for a codepoint wins
regardless of THAT family's own feature coverage (item 29's comment above already states this
principle for the synthesis question; it applies here too), so Noto Sans is unconditionally the
face painting every one of these codepoints in every notation and in every skin — no fallback
further down `--token-font`, in any order, is ever reached for them, because Noto Sans's cmap
already has a glyph for all five. Per codepoint:
- ṣ (U+1E63) and ṃ (U+1E43) DO small-cap correctly. Noto Sans's own GSUB decomposes the precomposed
  glyph into base letter + combining dot-below (`s.sc`/`m.sc` + `dotbelowcomb`, the mark landing at
  its OWN small-cap-specific attachment offset, not the plain glyph's one — confirmed in the raw
  `hb-shape` output, `s.sc=0+453|dotbelowcomb=0@72,0+0` against the plain glyph's `s=0+479|
  dotbelowcomb=0@59,0+0`) before `smcp` fires, so the base letter takes its designed small-cap form
  and the mark rides correctly positioned under it. This is why the user's own report, read closely,
  doesn't actually include ṣ misbehaving — it (and ṃ) already render right.
- ṭ, ṇ, ṛ, ḥ (U+1E6D, U+1E47, U+1E5B, U+1E25) do NOT. Each stays a single precomposed glyph
  (`uni1E6D` etc.) with no decomposition path and no dedicated small-cap glyph of its own in the
  `smcp` lookup, so the plain lowercase form paints — exactly the "honest fallback" LEM_FEAT's own
  comment already argues for a face with NO smcp table at all. Except this isn't that case: the
  face HAS smcp, broadly (336 glyphs, covering the macrons ā/ī/ū and Extended-A diacritics like
  ś/ñ the user did NOT report a problem with) — it simply never had small-cap forms engineered for
  this one sub-block of Latin Extended Additional, the retroflex/vocalic-r/visarga marks IAST needs
  and evidently not a block Noto Sans's own small-caps pass prioritised.
⚠ **NOT FIXABLE FROM THIS SIDE OF THE FONT, CODE-ONLY.** Tried feeding the NFD-decomposed sequence
(base letter + U+0323 combining dot-below) directly, hoping to land on the SAME decomposed-then-smcp
path that already saves ṣ/ṃ — with the `ccmp` feature explicitly turned off too, in case that lookup
was what recomposed it. `hb-shape` recomposes `t`+U+0323 straight back to the single `uni1E6D` glyph
either way. This is Unicode NFC normalisation happening inside the shaping engine itself — a step
every correct text shaper performs, on the bundled HarfBuzz here and inside the browser alike — not
a GSUB feature the app can toggle off, so there is no character sequence the app could hand the
DOM/canvas that dodges it.
⚠ **NOT FIXABLE BY REORDERING THE EXISTING STACK.** Checked every already-bundled file under
`web/fonts/`: the ~170 script-specific Noto Sans faces have no Latin cmap entries at all (never
reached for these codepoints regardless of stack order); `notosans-italic.ttf` and
`notosansmono.ttf` share the identical `smcp` table and the identical gap. `notosansdisplay.ttf`
sits in the directory unwired — no `@font-face` names it (dead weight, or a leftover from
generating the 171-family `--token-font` list, which folds "Noto Sans Display" in among the script
names though it names an optical-size cut, not a script) — and, checked anyway, carries the exact
same unfixed gap, so wiring it up would not have helped either.
⚠ **A GENUINE FIX EXISTS BUT NEEDS A NEW FILE, SO THIS STOPS AT A RECOMMENDATION, NOT A CHANGE** —
per this task's own instruction not to vendor a font unilaterally. Two candidates, both verified
live rather than taken on reputation:
  - **SIL's Andika** (OFL — the same licence family already vendored here for Nithya Ranjana and the
    core Noto set; a sans serif built specifically for broad-Unicode linguistic transcription work,
    unlike Google Fonts' own stripped builds of Cardo/Gentium Plus/Old Standard TT/EB Garamond and
    eight other classicist-reputation faces checked the same way, EVERY one of which ships with NO
    `smcp` feature at all in its Google Fonts build). Andika's `smcp` table fully covers the entire
    IAST retroflex/vocalic-r/visarga set — verified with the same `hb-view` render. Visually close to
    Noto Sans at a glance (same test word rendered in both, comparable x-height and weight) but not
    identical, so mixing it in — even scoped to only the four failing glyphs via a
    `unicode-range`-restricted `@font-face`, the same mechanism `SUD Kai SC`/`SUD Kai TC` already use
    for the Chinese italic swap, subsetted to the handful of codepoints actually needed rather than
    the ~800 KB Regular file, and wired into a font stack DEDICATED to the lemma row rather than the
    global `--token-font` (this row is the only place the gap is visible; every other row's
    rendering of these same characters is already correct today and has no reason to move) — still
    draws a visible seam at exactly those four glyphs.
  - **macOS's own San Francisco** (`-apple-system`, already the stack's tail fallback) ALSO fully
    covers this block — checked directly against every SF cut installed on this machine (SF Pro, SF
    Compact, SF Compact Rounded, New York, in every weight). This would need no vendoring at all, but
    reaching it needs the identical `unicode-range` trick pointed at `local()` instead of a bundled
    file, is macOS-only (no Windows verification is possible from here, and per this project's own
    Windows caveats a Segoe UI equivalent is unconfirmed), and WebKit's `local()` matching against
    Apple's system-UI family names is known to be restricted in some contexts for privacy reasons —
    a real risk this note doesn't resolve.
  Either path is a genuine visual design decision (whose retroflex-consonant letterforms sit beside
  Noto's own, whether the seam is worth it) that this research pass is deliberately leaving to the
  maintainer rather than making unilaterally.
⚠ **SO THE HONEST ANSWER TODAY IS THE ONE THE CODE ALREADY ARGUES, WITH ONE CORRECTION.** LEM_FEAT's
own comment ("a face without smcp simply paints the plain letters, which is the honest fallback")
describes a face with NO smcp table; this is a face WITH one that simply never had these four
glyphs added to it. The fallback is still honest — no synthesis, no invented shape — but its visual
result is a genuinely MIXED register within one word (most letters small-capped, four glyphs left
at plain height) rather than the clean "whole word either way" the comment's argument pictures.
No code was changed by this investigation.

⚠ **FIXED, ON REQUEST TO VENDOR A PATCHED FONT — BY EXTENDING THE FONT'S OWN EXISTING `ccmp`
LOOKUP, NOT BY DRAWING NEW GLYPHS.** The investigation above already named the mechanism (Noto Sans
decomposes ṣ/ṃ before `smcp` fires); the fix is to give ṭ/ṇ/ṛ/ḥ the identical treatment inside the
SAME font, using fontTools (`.venv` already had it — `pip install fonttools` was not needed; it is
pulled in as a dependency of something else already in `requirements.txt`, confirmed by `import
fontTools` succeeding unmodified). `web/fonts/notosans.ttf`'s `GSUB` table, feature `ccmp`, lookup
index 6 (a `MultipleSubst`, i.e. GSUB type 2 — a single input glyph rewritten to a sequence of
output glyphs), already carried exactly ten entries decomposing precomposed dot-below letters —
`uni1E43→[m,dotbelowcomb]` and `uni1E63→[s,dotbelowcomb]` among them (the two working cases), plus
four Vietnamese ones (e/i/o/u-with-dot-below) and one dotless-i case — and was simply missing the
four this task asked about. Added, verbatim, following the exact shape of the existing entries:
`uni1E6D→[t,dotbelowcomb]`, `uni1E47→[n,dotbelowcomb]`, `uni1E5B→[r,dotbelowcomb]`,
`uni1E25→[h,dotbelowcomb]` (`t`/`n`/`r`/`h` + U+0323, the correct Unicode canonical decomposition
of each of ṭ/ṇ/ṛ/ḥ). Nothing else in the lookup, and no other lookup, table, or glyph, was touched.
⚠ **THIS SIDESTEPS THE NFC-RECOMPOSITION PROBLEM THE EARLIER ATTEMPT HIT, AND THAT WAS VERIFIED
LIVE, NOT ASSUMED.** The rejected app-side attempt fed HarfBuzz an NFD character sequence (base +
U+0323) and got it recomposed back to the single precomposed glyph before shaping — Unicode
normalisation acting on the INPUT CHARACTER STREAM, upstream of any GSUB feature, so no GSUB toggle
could dodge it. `ccmp` is a different mechanism at a different stage: the app still sends the
single precomposed codepoint (ṭ, U+1E6D), `cmap` maps it to the single glyph `uni1E6D` exactly as
before, and ONLY THEN does the `ccmp` feature rewrite that GLYPH into the two-glyph sequence — by
which point Unicode normalisation has already happened and does not run again. This is precisely
how ṣ/ṃ were already working, so making the four broken codepoints go through the same table
predicts they will succeed by the same mechanism, and `hb-shape` confirms it: `hb-shape
--features=+smcp` against the PATCHED file now answers `t.sc=0+448|dotbelowcomb=0@74,0+0` for ṭ
(was `uni1E6D=0+361`, a single unsplit glyph), and the analogous correct decomposition+small-cap
substitution for ṇ/ṛ/ḥ — matching ṣ/ṃ's own already-working shape exactly, glyph-class for
glyph-class. No GPOS edit was needed at all: `t.sc`/`n.sc`/`r.sc`/`h.sc` already carry their OWN
mark-attachment anchor for `dotbelowcomb` distinct from plain `t`/`n`/`r`/`h`'s anchor (confirmed in
the `hb-shape` output — e.g. ṭ's mark lands at `@74,0` under `t.sc` vs `@151,0` under plain `t`),
because Noto Sans's small-caps pass had already engineered those anchors for OTHER purposes (they
sit on the same small-cap base letters `ccmp` already decomposes OTHER dot-below and dot-above
letters onto). The fix therefore needed exactly one table edit and zero new glyphs.
⚠ **VERIFIED AS A DIFF, NOT JUST A SUCCESS CASE**: a `ttx` dump of every other table
(`glyf`/`hmtx`/`cmap`/`GDEF`/`GPOS`/`maxp`/`post`) between the original and patched files is
byte-for-byte identical; `head` differs only in `checkSumAdjustment` and `modified` (both expected
of any re-save). `hb-shape` on ordinary Latin text, on ṣ/ṃ (unchanged), and on every other
Extended-A diacritic (macrons, ś, ñ, ḍ, ḷ) with `smcp` on is IDENTICAL before/after except at
exactly the four targeted codepoints. **ḍ (U+1E0D) and ḷ (U+1E37) — d and l with dot below — carry
the identical bug** (single precomposed glyph, no `ccmp` entry) and were left unpatched: they were
never named in the report this task answers, and fixing them was out of this task's stated scope,
but the fix is the same one line each (`uni1E0D→[d,dotbelowcomb]`, `uni1E37→[l,dotbelowcomb]`) if a
future report names them.
⚠ **LICENSING: NOTO SANS'S OWN `OFL.txt` DECLARES NO RESERVED FONT NAME, SO THE FAMILY NAME DID NOT
NEED TO CHANGE** — checked directly (fetched `notofonts/latin-greek-cyrillic`'s own `OFL.txt`)
rather than assumed from the OFL's general Reserved-Font-Name reputation; nameID 7's "Noto is a
trademark of Google LLC." is a trademark notice, a different mechanism from an OFL RFN clause, and
does not gate condition 3 either. `name` IDs 1/4 ("Noto Sans"/"Noto Sans Regular") are therefore
unchanged, so `web/styles/fonts.css`'s `@font-face{font-family:"Noto Sans";…}` and every
`--token-font`/`--mono-font` stack's leading `"Noto Sans"` string keep matching the patched file
with no CSS edit anywhere. `name` IDs 3/5 (unique identifier / version string) were extended to say
"SUD Workbench smcp patch" so the modified binary doesn't pass as a pristine upstream build if
extracted on its own — not required by the licence, done anyway for honesty. Full reasoning and the
exact OFL clauses checked are in `THIRD-PARTY-NOTICES.md`'s Fonts section, which this change also
updated (the "Neither font is modified here" line there was true when written and is no longer).
⚠ **FILES CHANGED: `web/fonts/notosans.ttf` (2,049,096 → 2,059,580 bytes — the fontTools
recompile of an unrelated table's layout accounts for the difference, not new glyph data; no glyph
outline was added), `THIRD-PARTY-NOTICES.md`, this note.** No CSS file changed (family name kept).
Verified clean: `node --check` on the touched-adjacent JS (none actually touched), the headless-
Chrome CDP smoke test bare AND `?platform=win` (0 runtime exceptions, 0 console errors, 8/8 fixture
blocks in every notation, correct kit's stylesheet loaded each time), `timeout 8
.venv/bin/python -m app samples/english.conllu` exiting 124, and a live injected sentence
(`DOC`/`renderDoc()`, no bridge) whose LEMMA column carried all six codepoints — the rendered
`.tok-lemma` nodes carry the correct text and `font-feature-settings:"smcp"` computed style, in the
real app pipeline, not a standalone test page. A Chrome screenshot capture was attempted for a
pixel-level app-level visual (beyond `hb-view`'s already-authoritative one, reproduced above) and
could not be completed in this sandbox — `Page.captureScreenshot` returned no response even
against a blank page, independent of anything this change touched, so this is an environment
limitation, not a fix regression; the DOM/CSS-level and `hb-view` checks stand in for it.
