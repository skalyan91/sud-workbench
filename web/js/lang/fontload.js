//@module js/lang/fontload.js
/* ON-DEMAND SCRIPT FONTS.

   The bundle carries only the core Noto Sans faces (regular, italic, mono) — Latin/Greek/Cyrillic and
   the interface itself. Every other script's face is fetched the first time a document needs it, which
   took ~44 MB out of the app: 92% of its download.

   Two questions decide whether anything is fetched at all, in this order:
     1. WHICH SCRIPTS does the open document actually use? Read off the text itself with Unicode
        property escapes (\p{Script=…}), not off the language code — a language tag can be absent,
        wrong, or say nothing about the script a particular file is written in, whereas the characters
        can't lie. So this also covers a file whose language was never set.
     2. IS ONE ALREADY THERE? Only fetch when the machine can't render the script as it stands. macOS
        ships fonts for a good many (Devanagari Sangam MN, Thonburi, Kailasa, PingFang, Hiragino …),
        and a user may have installed Noto themselves. The test is a TOFU PROBE: draw a character from
        the document, draw a codepoint that is unassigned in Unicode and so has no glyph anywhere, and
        compare the ink. Identical ⇒ the first one drew the missing-glyph box too ⇒ nothing covers it.
        Asking document.fonts.check() instead would answer a different question — whether a face by
        that NAME is loaded — and would send us fetching Noto Devanagari onto a Mac that already draws
        Devanagari perfectly well.

   What comes back is a data: URI, injected as an @font-face under the same family name the font stacks
   already list (TOKEN_STACK/MONO_STACK in diagram-core.js), so nothing else in the app has to know.
   A failure is not worth interrupting anyone over: the stacks end in system-ui and the text still
   renders, so we say so once per script and move on. */

const FONT_TRIED=new Set();    // families asked about this session — success, failure or already-covered alike
const FONT_LOADED=new Set();   // families whose @font-face is now injected
/* THE BACKSTOP: ANY font finishing its load re-lays out the document, once, debounced. ensureScriptFont below
   awaits its own face explicitly and re-renders, which covers the case this app creates deliberately — but a
   face can also come in without us having asked: a system fallback resolving late, a second face pulled in by
   glyphs that only appeared once a Script/transliteration row was switched on, or a download that lands while an
   unrelated render is already in flight. Every one of those changes ADVANCES under a layout that measured the
   old ones, and every diagram position in the app is computed from measured advances (meas, js/diagram/
   diagram-core.js) rather than from the DOM boxes the browser would re-flow by itself. One extra render per
   font-load burst is cheap; a diagram whose seam marks and token centres sit on stale metrics is not, and it
   cannot be noticed by the code that caused it — which is the whole reason this listens globally instead of
   being threaded through the callers. Registered eagerly at load, but it only ever CALLS renderDoc later, from
   the event, so it is not the forward-reference hazard CLAUDE.md warns about; the typeof guard covers a
   font finishing before the later modules have finished defining themselves. */
if(typeof document!=="undefined"&&document.fonts&&document.fonts.addEventListener){
  let _fontSettle=null,_fontPending=false;   // _fontPending: a CORE face landed somewhere in this burst → the coalesced clear must be the wide one
  /* WHICH cached measurements a landed face actually invalidates. A CORE face (Noto Sans, Noto Sans
     Mono) draws essentially every string in the document, so its arrival drops the lot — that is what
     corrects the first render's fallback-metric widths. A per-script face draws only its own script,
     so it drops only the strings that CONTAIN that script: a Devanagari face landing must not re-measure
     every Latin label in the document, which is exactly what a blanket clear did. And when nothing was
     dropped, nothing on screen changed — no diagram invalidation, no re-render.
     NOT a cache-efficiency fix, and measured as such before writing it: with one clear per load the
     cache already runs at 100% (440 misses against 440 distinct strings — misses == distinct == cache
     size), so the measurements themselves are irreducible. What this saves is the WORK AFTER a clear:
     a document in a non-Latin script fetches its face mid-session, and that used to throw away every
     Latin measurement and re-render the lot. */
  const _NON_CORE=/[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u;
  document.fonts.addEventListener("loadingdone",ev=>{ clearTimeout(_fontSettle);
    const fams=[...new Set(((ev&&ev.fontfaces)||[]).map(f=>String(f.family||"").replace(/^["']|["']$/g,"")))];
    const core=!fams.length||fams.some(f=>/^Noto Sans( Mono)?$/i.test(f));   // no family list (an engine that doesn't populate it) ⇒ assume the worst and clear everything
    _fontPending=_fontPending||core;
    _fontSettle=setTimeout(()=>{ const wide=_fontPending; _fontPending=false;
      const dropped=(typeof clearMeasCacheWhere==="function")
        ? clearMeasCacheWhere(wide?null:(t=>_NON_CORE.test(t)))
        : (typeof clearMeasCache==="function"?clearMeasCache():0);
      if(!dropped) return;   // the face changed nothing that has been measured — leave the rendered diagrams alone
      if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // …the RENDERED diagrams too: the notation-switch cache (js/core/document.js) hands back an SVG laid out with the metrics of whatever face was in force when it was built, so a re-render alone would redraw nothing. Measured: token WIDTHS were identical across a font change while every token's x moved 4-5px, which is exactly a stale cropped diagram being reused
      if(typeof DOC!=="undefined"&&DOC.length&&typeof preserveScroll==="function"&&typeof renderDoc==="function") preserveScroll(renderDoc); },80); }); }   // 80ms: several faces of one document land in a burst (one per script), and each fires its own event — coalesce them into a single re-layout   // 80ms: several faces of one document land in a burst (one per script), and each fires its own event — coalesce them into a single re-layout
// Scripts the CORE faces already cover, plus the ones with no Noto Sans family of their own.
// ⚠ THE FIVE STACKING SCRIPTS (Grantha/Javanese/Balinese/Kawi/Zanabazar_Square) JOINED THIS LIST, and
// that is a DIFFERENT reason than the rest of it: those five don't lack an on-demand path — they were
// ON it, and fontCovers() (below) kept skipping the app's own copy for them, silently, because its tofu
// probe only asks "does anything render this", never "is it the SAME font this app was measured
// against". A same-named-but-different local font (a different vendor's Grantha, an older subset, …)
// passes the probe and wins by DOM's own ordinary specificity rules over whatever fontCovers() decided
// — except it can't disagree with a face THIS PAGE explicitly declares, which is what web/styles/
// fonts.css now does for these five (see that file's own note — under 1 MB combined, and the files were
// already vendored and tracked, just never wired up). Being here means docScripts() never calls
// ensureScriptFont for them, exactly like Latin/Greek/Cyrillic: the font is simply always present and
// always wins, so there is no "should we fetch" question left to ask, and no ambiguous system font left
// to lose to. Tibetan (the sixth STACKING_SCRIPTS member, js/lang/translit.js) has no local file to
// vendor and stays on the ordinary on-demand path below.
const FONT_CORE_SCRIPTS=new Set(["Latin","Greek","Cyrillic","Common","Inherited","Unknown","Braille",
  "Grantha","Javanese","Balinese","Kawi","Zanabazar_Square"]);
// Unicode script name → the family name the font stacks use, where squashing the name doesn't give it.
// (Everything else derives: "Canadian_Aboriginal" → "Noto Sans Canadianaboriginal", matching the
// vendored faces; the Google Fonts side wants the spaced form, "Noto Sans Canadian Aboriginal".)
const FONT_NAME_FIX={Nko:"NKo"};
// CJK has no Noto Sans family in the stacks at all — the system faces (PingFang, Hiragino, Apple SD
// Gothic Neo) cover it, steered to the right regional glyphs by the lang attribute renderDoc sets.
const FONT_SKIP_SCRIPTS=new Set(["Han","Hiragana","Katakana","Hangul","Bopomofo"]);

function fontStackName(script){ const s=script.replace(/_/g,"");
  const n=FONT_NAME_FIX[s]||(s.charAt(0).toUpperCase()+s.slice(1).toLowerCase());
  return "Noto Sans "+n; }
/* ⚠ TIBETAN FETCHES THE SERIF FACE, UNDER THE SANS NAME. Noto Sans Tibetan has a decade-old, still-open
   upstream bug (notofonts/nototools#38, filed 2015) in exactly the subjoined-consonant stacks Sanskrit
   transliteration needs (GHA/DDHA/DHA/BHA/DZHA/KSSA and their sequences) — independently reproduced and
   reported live here too ("a Tibetan font that actually supports the full range of Sanskrit conjuncts").
   Noto SERIF Tibetan handles the same sequences correctly (independently verified: "accepts most input
   from EWTS correctly", renders the ཨོྂ་ stack Sans cannot) and is on Google Fonts under its own name, so
   the existing on-demand fetch (app/fonts.py → Google's CSS API) reaches it with no new infrastructure.
   FONT_REMOTE_FIX changes ONLY what family is ASKED FOR; ensureScriptFont still declares the answer
   under fontStackName's "Noto Sans Tibetan" (unchanged — the name every stack, this app's own and the
   kit CSS's, already lists), so nothing downstream has to know or care that the glyphs are technically
   from the Serif family. A real trade-off is being made here — Serif Tibetan does not visually match the
   Sans register the rest of the token stack renders in — accepted deliberately because the alternative is
   glyphs that mis-stack outright, and correctness of the text takes priority over house style for a
   script this document-critical. */
const FONT_REMOTE_FIX={Tibetan:"Noto Serif Tibetan"};
function fontRemoteName(script){ return FONT_REMOTE_FIX[script]||("Noto Sans "+script.replace(/_/g," ")); }

// The scripts we can fetch a face for: every Noto Sans <Script> family the font stacks name, under its
// CANONICAL Unicode script name — the only spelling \p{Script=…} accepts (Old_Italic, not the squashed
// Olditalic the family name uses). Derived once from the vendored font set; the 11 that resolve to no
// script value are style variants of one already here (Lao Looped, Syriac Eastern, N'Ko Unjoined …) or
// families that aren't a script at all (SignWriting, Mayan Numerals), and are left out deliberately.
const FONT_SCRIPTS=[
  "Adlam","Anatolian_Hieroglyphs","Arabic","Armenian","Avestan","Balinese","Bamum","Bassa_Vah","Batak","Bengali","Bhaiksuki","Brahmi","Buginese","Buhid","Canadian_Aboriginal","Carian","Caucasian_Albanian","Chakma","Cham","Cherokee","Chorasmian","Coptic","Cuneiform","Cypriot","Cypro_Minoan","Deseret","Devanagari","Duployan","Egyptian_Hieroglyphs","Elbasan","Elymaic","Ethiopic","Georgian","Glagolitic","Gothic","Grantha","Gujarati","Gunjala_Gondi","Gurmukhi","Hanifi_Rohingya","Hanunoo","Hatran","Hebrew","Imperial_Aramaic","Inscriptional_Pahlavi","Inscriptional_Parthian","Javanese","Kaithi","Kannada","Kawi","Kayah_Li","Kharoshthi","Khmer","Khojki","Khudawadi","Lao","Lepcha","Limbu","Linear_A","Linear_B","Lisu","Lycian","Lydian","Mahajani","Malayalam","Mandaic","Manichaean","Marchen","Masaram_Gondi","Medefaidrin","Meetei_Mayek","Miao","Modi","Mongolian","Mro","Multani","Myanmar","Nabataean","Nag_Mundari","Nandinagari","New_Tai_Lue","Newa","Nko","Nushu","Ogham","Ol_Chiki","Old_Hungarian","Old_Italic","Old_North_Arabian","Old_Permic","Old_Persian","Old_Sogdian","Old_South_Arabian","Old_Turkic","Oriya","Osage","Osmanya","Pahawh_Hmong","Palmyrene","Pau_Cin_Hau","Phags_Pa","Phoenician","Psalter_Pahlavi","Rejang","Runic","Samaritan","Saurashtra","Sharada","Shavian","Siddham","Sinhala","Sogdian","Sora_Sompeng","Soyombo","Sundanese","Sunuwar","Syloti_Nagri","Syriac","Tagalog","Tagbanwa","Tai_Le","Tai_Tham","Tai_Viet","Takri","Tamil","Tangsa","Telugu","Thaana","Thai","Tibetan","Tifinagh","Tirhuta","Ugaritic","Vai","Vithkuqi","Wancho","Warang_Citi","Yi","Zanabazar_Square"];
let _fontRes=null;
function fontScriptRes(){ return _fontRes||(_fontRes=FONT_SCRIPTS.map(n=>{
  try{ return [n,new RegExp("\\p{Script="+n+"}","u")]; }catch(_){ return null; } }).filter(Boolean)); }

// Which Unicode scripts does the open document use? → Map of script name → a sample character of it.
// One pass over the forms (and their lemmas/orthographies/transliterations), memoised per CHARACTER —
// a document runs to thousands of characters but only a few hundred distinct ones, and each distinct
// one costs a walk down the script list until it matches.
function docScripts(){ const out=new Map(), seen=new Set(), RES=fontScriptRes(); let n=0;
  const SCRIPT_RE=/[^\p{Script=Common}\p{Script=Inherited}\s]/gu;
  for(const s of DOC){ for(const t of (s.tokens||[])){
      const txt=(t.form||"")+(t.lemma||"")+(t.ortho||"")+(t.translit||"");   // ortho too: picking a script orthography is exactly a case where glyphs the file never contained come on screen
      let m; SCRIPT_RE.lastIndex=0;
      while((m=SCRIPT_RE.exec(txt))){ const ch=m[0]; if(seen.has(ch)) continue; seen.add(ch);
        for(const [name,re] of RES){ if(re.test(ch)){ if(!out.has(name)) out.set(name,ch); break; } } }
      if(++n>4000) return out; } }
  return out; }

// TOFU PROBE — does anything on this machine draw `ch`? Compares its ink against a codepoint that is
// unassigned in Unicode (U+10FFFF, a permanent noncharacter), which every font stack draws as the
// missing-glyph box. Canvas, not the DOM: no layout, no reflow, and it works before the row is drawn.
const _fcv=document.createElement("canvas");
function fontCovers(ch){ const cx=_fcv.getContext("2d",{willReadFrequently:true});
  const W=_fcv.width=48, H=_fcv.height=48, font='32px '+(typeof TOKEN_STACK==="string"?TOKEN_STACK:"sans-serif");
  const ink=s=>{ cx.clearRect(0,0,W,H); cx.font=font; cx.fillStyle="#000"; cx.textBaseline="middle"; cx.fillText(s,4,H/2);
    return cx.getImageData(0,0,W,H).data.join(""); };
  const tofu=ink("\u{10FFFF}"), got=ink(ch);
  return got!==tofu && /[^0]/.test(got.replace(/0+/g,"0")); }   // different from tofu AND not blank

// Fetch and register one script's face. Idempotent, and safe to call whenever the document changes.
async function ensureScriptFont(script,sample){
  const family=fontStackName(script);
  if(FONT_TRIED.has(family)) return; FONT_TRIED.add(family);
  if(fontCovers(sample)) return;                    // already renders — nothing to download (the common case on macOS)
  if(!hasBridge()){ toast("No font for "+script+" — the desktop app downloads one automatically"); return; }
  let r; try{ r=await window.pywebview.api.font_face(fontRemoteName(script)); }catch(e){ r={error:String(e)}; }
  if(!r||r.error){ FONT_TRIED.delete(family);   // a FAILURE is not remembered: the usual reason is no connection at that moment, and the next document load should try again rather than make the user relaunch after reconnecting. A success or an already-covered script stays remembered — neither can change under us.
    toast("No font available for "+script+" — showing it in the system fallback"); return; }
  const st=document.createElement("style"); st.dataset.font=family;
  st.textContent='@font-face{font-family:"'+family+'";font-style:normal;font-weight:100 900;font-display:swap;src:url("'+r.uri+'")}';
  document.head.appendChild(st); FONT_LOADED.add(family);
  /* START THE LOAD AND WAIT FOR IT, rather than trusting `document.fonts.ready` on its own. A face declared by
     an injected @font-face does not begin loading when it is DECLARED — it loads lazily, the first time layout
     asks for a glyph from it — and `fonts.ready` reports "no font loading is currently outstanding", which in
     this same microtask is still true, because nothing has asked yet. So the await could fall straight through
     and the re-render below would measure the FALLBACK face, after which `font-display:swap` quietly swapped the
     real one in underneath positions already computed. That is precisely the failure the SVG-measurement rework
     was meant to end (see the note above `meas` in js/diagram/diagram-core.js): token centres, seam marks and
     folded punctuation land on advances the glyphs no longer have. It shows up ONLY on a script that is actually
     downloaded — every script macOS already draws skips this path entirely — and never in the wrapped-bracket
     notation, whose seams hang off the real DOM box and re-flow themselves when the face swaps.
     `document.fonts.load(font, text)` is the idiom that both kicks the load off and resolves when the face is
     usable; the sample character is passed so the request names glyphs this face really has. fonts.ready still
     follows it, to cover any OTHER face the same swap set going. */
  try{ await document.fonts.load('15px "'+family+'"', sample||"A"); }catch(_){ }
  try{ await document.fonts.ready; }catch(_){ }
  preserveScroll(renderDoc);   // the metrics change under it — re-measure with the face actually present
  if(!r.cached) toast("Downloaded "+family+" ("+Math.round(r.bytes/1024)+" KB)"); }

// Called after anything that can change what the document is written in — an open, an append, a
// conversion, a language change. Serial, not parallel: a document mixing scripts should not fire five
// downloads at once, and each one re-renders when it lands.
let _fontRun=null;
function syncDocFonts(){ if(_fontRun) return _fontRun;
  _fontRun=(async()=>{ try{
    for(const [script,ch] of docScripts()){
      if(FONT_CORE_SCRIPTS.has(script)||FONT_SKIP_SCRIPTS.has(script)) continue;
      await ensureScriptFont(script,ch); }
    // Settle pass: even when every script was already "covered" (no download → ensureScriptFont never
    // re-renders), freshly injected ortho glyphs can still re-resolve through the font stack after the first
    // paint. Waiting on fonts.ready and re-laying out once is what keeps stemma/arc seam marks and folded
    // punctuation on the new ink edge after a Devanagari→Grantha switch — wrapped brackets already self-correct
    // because their satellites hang off the DOM box. Skip when there's nothing scripted on screen (no DOC, or
    // Script is Original/None), so ordinary Latin loads don't pay an extra render.
    try{ await document.fonts.ready; }catch(_){}
    if(DOC.length && typeof ORTHO_SCHEME==="string" && ORTHO_SCHEME && ORTHO_SCHEME!=="none"
       && typeof preserveScroll==="function" && typeof renderDoc==="function"){
      preserveScroll(renderDoc); }
  } finally { _fontRun=null; } })();
  return _fontRun; }
