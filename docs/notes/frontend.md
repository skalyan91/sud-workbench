# Frontend: module layout, batching, zoom, scrolling

`web/js/core/`, `js/io/bridge.js` — how the ordered-classic-script frontend is put together, why a multi-sentence insert is one batch, how CSS `zoom` splits the measurement APIs, and who owns the wheel.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

## Modules, load order, and the one real hazard

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

## A multi-sentence insert is a batch

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

## CSS `zoom` splits the measurement APIs

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
⚠️ **`requestAnimationFrame` NEVER FIRES IN THAT HIDDEN WINDOW**, so anything a rAF defers has not run
when the probe measures, and the element reads as though the code were broken. Measured: the grid's MWT
surface-form field, which a `rAF(size)` grows past its column, read exactly column-width and clipped —
misdiagnosed as a WebKit `scrollWidth` fault and "fixed" into a `meas()` call before the probe itself was
suspected. It is not one: driven through its own `input` listener, WebKit answers `scrollWidth` 169
against `clientWidth` 28 for a 30px-wide field, i.e. the overflowing content width exactly as Chrome
does. Drive rAF-deferred code through its own listener (`dispatchEvent(new Event("input"))`) or call it
directly, and conclude nothing from the resting geometry of a rAF-sized element.

## Who owns the wheel

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

## The reading position across a chrome or zoom change

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
