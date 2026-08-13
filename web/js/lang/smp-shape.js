//@module js/lang/smp-shape.js
/* ITEM 25 — REAL GLYPH SHAPING FOR THE SMP BRAHMIC SCRIPTS, replacing smpReshape's HTML-fallback swap.

   THE BUG THIS REPLACES (see smpUnshaped's own note, js/diagram/diagram-core.js): WebKit's SVG <text>
   renderer fails to shape supplementary-plane Brahmic text (Kawi, Siddhaṃ, Soyombo, Sharada, Newa,
   Bhaiksuki, Modi, Tirhuta, Zanabazar Square, Grantha — anything past U+FFFF) into composed conjuncts; it
   paints loose, unshaped codepoints. WebKit's HTML text renderer shapes the SAME text correctly — the
   fact smpReshape exploited by swapping the SVG <text> for an HTML <div> inside a <foreignObject>. That
   fix works, but it moves the glyph into a DIFFERENT box model than the rest of the diagram (HTML flow vs
   SVG coordinates), which is what every one of foBaselineDrop / the ornamental bracket-lift term /
   arcShift / the wrapped-strip clearance exists to bridge back — hand-calibrated corrections for two
   rendering pipelines disagreeing about where a box's baseline and edges actually sit.

   This module sidesteps BOTH engines' native text shaping for these strings entirely: HarfBuzz (via the
   harfbuzzjs WASM build vendored in js/vendor/harfbuzz/) shapes the text into glyph IDs + positions
   itself, and hbjs's own glyphToPath (HarfBuzz's hb_font_draw_glyph) hands back each glyph's outline as
   an SVG path string. What gets painted is a plain SVG <path> — real diagram-coordinate geometry, no
   foreignObject, no HTML box model, no engine-shaping ambiguity, and none of the correction terms above
   have anything left to correct: the path IS the glyph, positioned exactly where this module computed it.

   THE FONT BYTES COME FROM THE SAME BRIDGE CALL fontload.js ALREADY USES (window.pywebview.api.font_face)
   — not a second vendored copy. That call already fetches-and-caches the real font file for @font-face;
   this module decodes the SAME base64 payload for HarfBuzz to shape against, so the shaped/painted glyphs
   are guaranteed to come from the identical font @font-face would otherwise have painted, had WebKit's
   SVG text path been able to shape it.

   ASYNC SHAPING INTO A SYNCHRONOUS RENDER LOOP: shaping is real work (WASM calls, glyph outline
   extraction) and the font bytes may not even be on disk yet, so it cannot happen inline inside belowStack
   /mwtTie/etc, which build a render's SVG synchronously start to finish. This follows the SAME pattern
   ensureScriptFont (fontload.js) already established for the identical problem (a font not being ready
   yet): smpShapeSync() is a synchronous, read-only cache lookup for the render loop — returns null if the
   shape isn't ready, in which case a caller falls back to the existing smpReshape path for THIS render;
   smpShapeEnsure() is the async preparer, called ahead of a render for every SMP run the document
   contains, which populates that cache and then (like ensureScriptFont) triggers exactly one re-render
   once everything it started resolves. */

/* hb.js / hbjs.js (js/vendor/harfbuzz/) are the harfbuzzjs 0.4.6 npm package's own files, loaded as plain
   classic scripts (see THIRD-PARTY-NOTICES.md) — createHarfBuzz (from hb.js) and hbjs (from hbjs.js) are
   both plain top-level function/var declarations, so they land in the same shared global scope as
   everything else in this app, exactly like drawAVM/avmLayout/etc already do (js/diagram/diagram-core.js).
   hb-wasm-data.js is hb.wasm itself, base64-embedded — the SAME "hand the WebView a data: payload rather
   than trust a same-directory static-file fetch" move app/fonts.py already makes for the script fonts
   (see that module's own docstring), for the identical reason: this app does not trust file://-vs-however-
   WKWebView-ends-up-serving-web/ to agree on whether a plain fetch() of a sibling asset even works. */

function _b64ToBytes(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }

// item 25: the HarfBuzz WASM instance, wrapped by hbjs — one instantiation for the whole app's lifetime,
// memoized as a Promise so every caller before AND after it resolves gets the same instance.
let _hbReady=null;
function _loadHB(){ if(_hbReady) return _hbReady;
  _hbReady=new Promise((resolve,reject)=>{
    if(typeof createHarfBuzz!=="function"||typeof hbjs!=="function"||typeof HB_WASM_B64!=="string"){
      reject(new Error("harfbuzzjs not loaded")); return; }
    createHarfBuzz({wasmBinary:_b64ToBytes(HB_WASM_B64)}).then(
      Module=>{ try{ resolve(hbjs(Module)); }catch(e){ reject(e); } }, reject); });
  return _hbReady; }

// item 25: a SIBLING bridge call to the one fontload.js's ensureScriptFont uses (font_face, which answers
// in woff2 — @font-face's own preferred, smaller format). font_face_raw (app/api.py → fonts.fetch_raw)
// answers in a RAW, uncompressed .ttf instead: measured directly, the harfbuzzjs WASM build this module
// vendors cannot decompress WOFF at all — every glyph shaped to gid0 (.notdef) with real advances but
// empty outlines against font_face's own cached woff2, and shaped correctly (subjoined conjuncts and all)
// against the identical text once fed the raw .ttf. Decoded here into raw bytes for HarfBuzz to shape
// against, never into an @font-face src. Cached per family (a Promise, so concurrent callers share one
// in-flight fetch rather than issuing the bridge call twice for the same font).
const _fontBytesCache=new Map();
function _fetchFontBytes(family){
  if(_fontBytesCache.has(family)) return _fontBytesCache.get(family);
  const p=(async()=>{
    if(!(window.pywebview&&window.pywebview.api&&window.pywebview.api.font_face_raw)) throw new Error("no bridge");
    const r=await window.pywebview.api.font_face_raw(family);
    if(!r||r.error||!r.uri) throw new Error((r&&r.error)||"no font uri");
    const m=/^data:[^;]+;base64,(.*)$/.exec(r.uri);
    if(!m) throw new Error("unexpected font uri shape");
    return _b64ToBytes(m[1]); })();
  _fontBytesCache.set(family,p); return p; }

// item 25: one HarfBuzz face+font per family, built once from the bytes above and reused across every
// shaping call for that family — hb_face_create/hb_font_create are real parses, not worth repeating per string.
const _hbFontCache=new Map();
function _getHBFont(family){
  if(_hbFontCache.has(family)) return _hbFontCache.get(family);
  const p=(async()=>{ const hb=await _loadHB(), bytes=await _fetchFontBytes(family);
    const blob=hb.createBlob(bytes), face=hb.createFace(blob,0), font=hb.createFont(face);
    return {hb,font}; })();
  _hbFontCache.set(family,p); return p; }

// item 25: ONE shaped glyph's outline, repositioned from the glyph's own local origin to (gx,gy) in this
// run's coordinate space. font.glyphToJson (hbjs) already parses hb_font_draw_glyph's M/L/Q/C/Z path into
// {type,values} segments — values are flat (x,y) pairs regardless of command (a C segment is 3 pairs, a Q
// segment 2, M/L one), so striding by 2 and treating even/odd as x/y handles every command alike.
// FLIPS Y: HarfBuzz glyph outlines are y-UP from the baseline (font convention), SVG is y-DOWN — svgY =
// gy − origY is the one sign flip that makes a glyph's ascenders point up on screen instead of down.
function _glyphSVGPath(font,gid,gx,gy){ const segs=font.glyphToJson(gid); if(!segs||!segs.length) return "";
  let d=""; for(const seg of segs){ const v=seg.values, out=[];
    for(let i=0;i<v.length;i+=2) out.push((gx+v[i]).toFixed(2),(gy-v[i+1]).toFixed(2));
    d+=seg.type+out.join(","); }
  return d; }

// item 26 (AVM/gloss small-caps): shape `text` in `family` at `sizePx`, optionally applying an explicit
// OpenType FEATURE LIST (`features` — HarfBuzz's own comma-separated `tag[=value]` syntax, e.g. "c2sc=1" or
// "c2sc=1,onum=1"; see cssFeatToHB(), js/diagram/diagram-core.js, for the CSS-font-feature-settings-syntax
// → this syntax converter) and an explicit per-glyph LETTER-SPACING (`letterSpacingPx` — a plain px amount,
// added after every glyph's own advance, including the last one — see this parameter's own note below).
// Both are entirely orthogonal to the SMP Brahmic case _shapeSMP already served (which calls this with
// neither, so `features` is unset/empty and `letterSpacingPx` is 0 — a script run at its reference size
// carries no tracking-curve letter-spacing at all, trackCurve(15)===0, so omitting the term costs that
// caller nothing): a c2sc/onum-styled ASCII label (AVM's own attribute names, a Leipzig gloss abbreviation)
// is plain Latin text that WebKit's shaper handles fine BY SCRIPT — what it does not reliably do (see
// _measOneUncached's own note, diagram-core.js) is agree with itself, under real render load, about the
// ADVANCE that feature substitution produces. Routing this text through the SAME shape-once-paint-the-
// shape's-own-geometry technique the SMP case already established sidesteps that the identical way: the
// feature list is handed to HarfBuzz directly, so the SUBSTITUTED glyphs (small-cap forms, old-style
// figures) are what gets shaped and painted, with no second, independent browser measurement step left to
// disagree with what the glyph outlines below actually are.
// ⚠ LETTER-SPACING IS APPLIED HERE, NOT LEFT TO THE CALLER, because it has to land in the SAME accumulator
// that produces BOTH the returned advance `w` (what a caller folds into a slot-width reservation) and each
// later glyph's own OWN x position (what the caller ends up painting) — computing it separately in two
// places is exactly the "reservation numbers and paint numbers can drift apart" bug class this whole
// mechanism exists to close off. Added after EVERY glyph, trailing character included: CSS letter-spacing’s
// contribution to an element's own advance (what getComputedTextLength()/getBBox() have always measured,
// and what _measOneUncached's own getBBox() fallback already relied on) counts the trailing gap too in both
// engines this app ships against — verified against a live, freshly-cache-cleared getBBox() reading for
// "DEFINITE" (see PROBE step 0 notes): trailing-included is what reproduces that number.
// font.setScale(sizePx,sizePx): HarfBuzz's own "coordinate units per em" — this is what makes BOTH the
// shape() advance/position numbers AND glyphToPath's outline coordinates come out pre-scaled to sizePx,
// with no separate upem-derived scale factor to apply by hand (the default scale, unset, is the font's own
// upem — raw font units, which is not what any caller here wants).
async function _shapeSMP(text,family,sizePx,features,letterSpacingPx){
  const {hb,font}=await _getHBFont(family);
  font.setScale(sizePx,sizePx);
  const buffer=hb.createBuffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();   // script/direction/language from the text itself — every SMP script this module serves is a single-script run by construction (smpUnshaped gates on content, not on a caller-supplied script tag)
  hb.shape(font,buffer,features||undefined);
  const glyphs=buffer.json();
  buffer.destroy();
  const lsp=letterSpacingPx||0;
  let x=0; const parts=[];
  for(const g of glyphs){ const gx=x+g.dx, gy=-g.dy;   // dx/dy: HarfBuzz's own per-glyph placement adjustment, already in the scaled units font.setScale established
    const p=_glyphSVGPath(font,g.g,gx,gy); if(p) parts.push(p);
    x+=g.ax+lsp; }   // ay (vertical advance) is ignored: every script this module serves is horizontal — see hb.createBuffer's setDirection if that ever changes
  return {d:parts.join(" "),w:x}; }

// item 25/26: the render-loop-facing pair — sync READ (never blocks, never does WASM/bridge work) and async
// PREPARE (does all of it, then caches). Keyed on the QUINTUPLE that actually determines the shaped output —
// two runs with the same text/family/size/features/letter-spacing shape identically, so this is a real
// cache like every other measurement cache in this file, not a one-shot memo. `features`/`letterSpacingPx`
// are item 26's own additions (the AVM/gloss small-caps case) — every item-25 (SMP) call site omits both,
// which folds to the empty string/0 below exactly as it always implicitly did, so their own cache entries
// keep the identical key they had before this pair grew two more parameters.
const _shapeCache=new Map();
function _shapeKey(text,family,sizePx,features,letterSpacingPx){
  return family+"|"+sizePx+"|"+(features||"")+"|"+(letterSpacingPx||0)+"|"+text; }
function smpShapeSync(text,family,sizePx,features,letterSpacingPx){
  const v=_shapeCache.get(_shapeKey(text,family,sizePx,features,letterSpacingPx)); return v===undefined?null:v; }
// resolves once this ONE run is cached (hit or miss) — never rejects, so a caller can Promise.all a whole
// document's worth without one failed font ruining the rest; a failure caches `null`, exactly like a miss.
// ⚠ EXCEPT ONE FAILURE, DELIBERATELY LEFT UNCACHED: the bridge (window.pywebview.api) not being up YET.
// item 25's own SMP trigger (a codepoint test) rarely if ever races this — Brahmic SMP text only reaches
// this function once a document that actually HAS some is rendered, by which point a real session has
// been up for a while. Item 26's trigger (a font-feature-settings override, e.g. avmLayout's c2sc label)
// fires on literally the FIRST render, at page load, which routinely wins the race against pywebview's own
// bridge injection — confirmed live: `_fetchFontBytes` threw "no bridge" on that first attempt every time.
// Before this guard, THAT failure got cached exactly like any other — permanently, under this exact
// (text,family,size,features,letterSpacing) key — so a document was doomed to the getBBox() fallback for
// that string for the rest of the session, bridge or no bridge, because _shapeCache.has(key) is checked
// BEFORE ever asking whether the bridge is up now. Checked here, once, rather than inside _fetchFontBytes
// (which every SMP call also funnels through): returning early, UNCACHED, means the next render's own
// smpShapeEnsure call (smpReshape/_measOneUncached both re-attempt every render that still lacks a cached
// shape) gets a genuine fresh attempt instead of replaying a stale verdict — self-healing once the bridge
// comes up, at the cost of one more skipped attempt per render until then, which is cheap: this guard
// returns before any WASM call or bridge round-trip is even made.
async function smpShapeEnsure(text,family,sizePx,features,letterSpacingPx){
  const key=_shapeKey(text,family,sizePx,features,letterSpacingPx);
  if(_shapeCache.has(key)) return _shapeCache.get(key);
  if(!(window.pywebview&&window.pywebview.api&&window.pywebview.api.font_face_raw)) return null;
  let shape=null;
  try{ shape=await _shapeSMP(text,family,sizePx,features,letterSpacingPx); }catch(e){ shape=null; }
  _shapeCache.set(key,shape);
  return shape; }

// item 25: coalesced re-render once a BURST of newly-kicked-off shapes all resolve — the SAME
// _fontSettle/_fontPending pattern fontload.js's own document.fonts "loadingdone" listener already uses,
// for the identical reason: smpReshape (diagram-core.js) runs once PER SENTENCE, so a document with
// several SMP sentences would otherwise fire one re-render per sentence as each shape lands — each one
// re-measuring/re-laying-out a diagram that is about to be thrown away and rebuilt again moments later.
// smpReshape calls this every time IT kicks off a smpShapeEnsure that wasn't already cached; once no more
// arrive for 80ms (the same settle window fontload.js uses, for the same "several faces/shapes of one
// document land in a burst" reason), the whole batch is awaited and exactly one re-render follows.
let _smpPending=[], _smpSettle=null;
function smpNotePending(promise){
  _smpPending.push(promise);
  clearTimeout(_smpSettle);
  _smpSettle=setTimeout(async()=>{
    const batch=_smpPending; _smpPending=[];
    try{ await Promise.all(batch); }catch(e){ /* individual failures already cached as null by smpShapeEnsure — nothing to do here */ }
    /* item 26 — MUST drop _MEAS_CACHE (js/diagram/diagram-core.js) here too, not just avmLayout's own
       _avmCache (already cleared unconditionally every renderDoc()). The SMP (Brahmic) case never needed
       this: its own _measOneUncached branch measures via _measDOM, which doesn't care whether a native
       shape is ready — shaping only ever changed what smpReshape PAINTS for that case, never what a
       measurement call returns, so a stale _MEAS_CACHE entry was never possible for it. Item 26's own
       c2sc/onum case is different — _measOneUncached now returns the SHAPE's own width once one is ready,
       a DIFFERENT number from the getBBox() fallback it returned before the shape landed — so the fallback
       value a pre-shape render already cached under the exact same (text,font,extraCss) key would sit in
       _MEAS_CACHE forever otherwise, permanently shadowing _measOneUncached (and so the shape) on every
       later call, the same way this cache already requires an explicit drop on a landed FONT (see its own
       note) for the identical reason: a cache keyed on inputs that don't change (text/font string) cannot
       know that something EXTERNAL it depends on (a face landing; now, a shape landing) just did. */
    if(typeof clearMeasCache==="function") clearMeasCache();
    if(typeof DOC!=="undefined"&&DOC.length&&typeof preserveScroll==="function"&&typeof renderDoc==="function") preserveScroll(renderDoc);
  },80); }
