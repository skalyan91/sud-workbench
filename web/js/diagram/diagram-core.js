//@module js/diagram-core.js
/* item 1 — ExtPos ("external part of speech") tags a MULTI-TOKEN expression with the word class the whole
   expression behaves as. UD stores it on the expression's HEAD; this app draws it as an MWT-style bracket under
   the span that head's subtree covers, with the value underneath (see tieRows/mwtTie). */
function extPosOf(t){ return getFeat(t&&t.feats,"ExtPos")||""; }
// The HEAD of a token RANGE — the "highest-ranking node of the selection": the one token in [from,to] whose own
// head lies OUTSIDE the range (or is the root / unattached). A range that happens to hold several sibling
// subtrees has more than one such token; the FIRST in reading order wins, the same leftmost rule addMWT already
// assumes when it concatenates a range into one surface form.
function rangeHead(sent,from,to){ const t=sent&&sent.tokens; if(!t) return from;
  for(let i=from;i<=to;i++){ const tk=t[i-1]; if(!tk) continue; const h=parseInt(tk.head,10);
    if(!(h>=from&&h<=to)) return i; }
  return from; }   // every token's head inside the range → a cycle; fall back to the first token rather than report nothing
// The contiguous token span a node's subtree covers, as {from,to} (1-based, inclusive) — a HULL, not the subtree:
// it is what the two features that must draw over one literal RANGE need (an ExtPos bracket, and the range the
// context menu / edit-ops operate on). NEVER use it to answer "does this token belong to that subtree?" — see
// subtreeMembers below, which is the membership test.
function subtreeSpan(sent,tokId){ const {children}=structure(sent); let lo=tokId,hi=tokId;
  const seen=new Set();
  (function walk(i){ if(seen.has(i))return; seen.add(i);
    children[i].forEach(c=>{ lo=Math.min(lo,c+1); hi=Math.max(hi,c+1); walk(c); }); })(tokId-1);
  return {from:lo,to:hi}; }
// A subtree IS its MEMBERSHIP: every token its transitive descendant walk reaches (the node itself included), as a
// Set of 1-based ids. Emphatically not subtreeSpan's hull — in a NON-PROJECTIVE tree a subtree is not a contiguous
// stretch of the sentence, so the hull sweeps in tokens that belong to some other branch entirely
// (samples/brihat_jataka.conllu sentence 1 is widely non-projective and is the case to check any of this against;
// the fixture's "I saw a man yesterday who was tall" is the small version — `man`'s hull is [a … tall] but
// `yesterday` hangs off `saw`, not `man`). Reading membership off the hull there emphasises the interloper and
// misses nothing else, which is the wrong answer in the one place it matters. This is the same walk
// bracketsWrapped's own selDesc already does ("TREE descendants → an interrupter displayed within isn't part of
// the constituent"); `children` may be passed in to reuse one structure() pass across several calls.
function subtreeMembers(sent,tokId,children){ const out=new Set(), t=sent&&sent.tokens;
  if(!t||!(tokId>=1&&tokId<=t.length)) return out;
  const kids=children||structure(sent).children;
  (function walk(i){ if(out.has(i+1))return; out.add(i+1); kids[i].forEach(walk); })(tokId-1);   // the has() guard is also what makes a head CYCLE terminate rather than recur forever
  return out; }
// CORE vs PERIPHERY around one token, in the SUD sense: a head's CORE ARGUMENTS are exactly its subj and comp
// dependents (subj, subj@expl, comp:obj, comp:obl, comp:pred, comp:aux, comp:cleft, the mSUD comp/m …). Matched
// through famOf, which strips the :subtype, the @deep feature and the /m suffix in one go — so a deep feature can
// never defeat the match. An argument is a PHRASE, not a word, so a core dependent contributes its WHOLE subtree,
// determiners and modifiers included: with "gave" selected in "the old man gave Mary a book yesterday",
// core = {the, old, man, Mary, a, book} and periphery = {yesterday}. Every OTHER direct dependent contributes its
// whole subtree to the periphery. Accumulates into the caller's Sets so a range selection can union several
// tokens' splits in one pass.
function coreSplit(sent,tokId,core,peri){ const t=sent&&sent.tokens; if(!t||!(tokId>=1&&tokId<=t.length)) return;
  const {children}=structure(sent); core.add(tokId);
  children[tokId-1].forEach(c=>{ const fam=famOf(t[c].deprel);
    subtreeMembers(sent,c+1,children).forEach(x=>((fam==="subj"||fam==="comp")?core:peri).add(x)); }); }
// the "@" in a deprel introduces deep(-syntactic) features (subj@expl, comp:obj@agent…); split them off for their own column
function depBase(d){ const i=(d||"").indexOf("@"); return i<0?(d||""):d.slice(0,i); }
function depDeep(d){ const i=(d||"").indexOf("@"); return i<0?"":d.slice(i+1); }
function withDepBase(d,base){ const dp=depDeep(d); return dp?base+"@"+dp:base; }   // replace the relation, keep the deep features
function withDepDeep(d,deep){ const b=depBase(d); return deep?b+"@"+deep:b; }        // replace the deep features, keep the relation
// the official deep-syntactic features (https://guidelines.surfacesyntacticud.org/docs/general_guideline/Deep/)
const DEEP_OFFICIAL=["agent","caus","emb","expl","foreign","lvc","name","pass","relcl","scrap","tense","fixed","x"];
// short glosses for the official deep features (shown right-aligned in the deep-feature menu, like the deprel menu's expansion column). User-added features have no gloss.
const DEEP_INFO={agent:"agent",caus:"causative",emb:"embedded",expl:"expletive",foreign:"foreign",lvc:"light-verb constr.",name:"name",pass:"passive",relcl:"relative clause",scrap:"discarded",tense:"tense aux.",fixed:"fixed expr.",x:"unspecified"};
const isMorphRel=r=>/\/m$/.test(r||"");   // mSUD morph-internal relation, marked by the /m suffix
const MORPH_DEPRELS=["comp/m","comp:obj/m","comp:aux/m","mod/m","subj/m","conj/m","det/m","unk/m","punct/m"];   // mSUD morph-level relations from Guillaume et al. (2024, LREC 2024.836): SUD-style relations suffixed "/m"; dep/m & mark/m are mUD (UD-style), not mSUD, so excluded
function deprelVocab(){ return DOCFORMAT==="mSUD" ? SETTINGS.deprel.concat(MORPH_DEPRELS) : SETTINGS.deprel; }   // offer /m relations in the grid dropdown for mSUD docs
function deepVocab(){ const seen=new Set(DEEP_OFFICIAL), extra=[];   // official deep features first, then any others already used in this document
  DOC.forEach(s=>s.tokens.forEach(t=>{ const d=depDeep(t.deprel); if(d&&!seen.has(d)){ seen.add(d); extra.push(d); } }));
  return [...DEEP_OFFICIAL, ...extra]; }
const GUIDE="https://guidelines.surfacesyntacticud.org/docs/general_guideline/";
const UD_GUIDE="https://universaldependencies.org/";
const UD_ONLY_RELS=new Set(["clf","list","goeswith","orphan","root","det","cc","punct"]);   // UD relations SUD doesn't document with its own page → link to the UD relation guidelines instead (root/det/cc/punct confirmed 2026-07 — no page anywhere under guidelines.surfacesyntacticud.org, but a real one at universaldependencies.org/u/dep/*.html)
const MACROSYNTAXE_RELS=new Set(["parataxis","vocative","discourse","dislocated"]);   // these live under a "macrosyntaxe/" subfolder on the real site, not directly under Syntactic_relations/ — confirmed 2026-07 against the site's own sitemap (its 404 page conveniently lists the whole tree)
const NO_GUIDE_RELS=new Set(["unk"]);   // valid SUD vocabulary with no dedicated guidelines page anywhere — relGuideUrl returns null so callers hide the link instead of linking nowhere
function relGuideUrl(rel){ const base=depBase(rel), fam=famOf(base);   // ignore any @deep suffix → link to the BASE relation's guidelines (mod@relcl → mod, comp:obj@relcl → comp/comp_obj)
  if(NO_GUIDE_RELS.has(base)) return null;
  if(UD_ONLY_RELS.has(base)) return UD_GUIDE+"u/dep/"+encodeURIComponent(base)+".html";   // no SUD guidelines for this relation → UD
  const seg="Syntactic_relations/"+(MACROSYNTAXE_RELS.has(fam)?"macrosyntaxe/":"")+(fam||base||"");
  if(base && base.includes(":")) return GUIDE+seg+"/"+base.replace(/:/g,"_")+"/";
  return GUIDE+seg+"/"; }
function posGuideUrl(pos){ return GUIDE+"Upos/"+encodeURIComponent((pos||"").trim())+"/"; }
function deepGuideUrl(feat){ return GUIDE+"Deep/"+encodeURIComponent((feat||"").trim())+"/"; }   // each deep feature has its own subpage (…/Deep/relcl/)
function cat(r){const f=famOf(r); return (f==="subj"||f==="comp"||f==="mod"||f==="udep")?f:(f==="root"?"root":"other");}   // udep gets its own --c-udep (comp/mod linear-RGB midpoint, see relColMidLinear) instead of falling into "other"
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function relColor(r){ if(!show.colour) return css("--ink"); return css("--c-"+cat(r)); }
function arcInk(col){ return `color-mix(in srgb, ${col}, var(--content-bg) var(--edge-mix))`; }   // arc/edge STROKE ink. LIGHT: --edge-mix=40% → the stroke recedes toward the white bg, lighter than its full-colour label (unchanged). DARK: --edge-mix=0% → no mix, the stroke stays the FULL relation colour, i.e. IDENTICAL to its relation label (labels keep the full relColor in both modes). Not opacity, which would also dim the casing/occlusion halo (that stays on --block-occlude).
// SEMANTIC DEPENDENCE, one relation at a time — what the "Semantic arrows" option draws. (The seam mark's
// placement used to run on this same test; it no longer does — seamOwner in js/core/prefs.js now decides from word
// class, nounhood and whether the relation is asymmetric, "which of the two leans on the other" having been a
// different question from "which of the two does this boundary belong to".) The arrowhead points AT the element
// depended ON, so it leaves the semantically DEPENDENT end:
//  · "head" (arrow at the syntactic head) → the syntactic DEPENDENT is the semantically dependent one. Not only
//    modifiers: a determiner and a classifier lean on what they attach to in the same way, so det and clf join
//    mod here rather than drawing no arrow at all.
//  · "dep" (arrow at the syntactic dependent) → the syntactic HEAD is the semantically dependent one: an
//    auxiliary leans on its lexical verb, an adposition on its object.
//  · null → the relation says nothing either way (punct, conj, flat, …) and draws no arrow.
// famOf, not cat(): cat() folds det/clf into "other" for COLOUR purposes, which is a different question. A "/m"
// morph relation carries its base's semantics (famOf strips the suffix), as it should.
const SEM_DEP_FAM=new Set(["mod","det","clf"]);
function arrowDir(r){ const f=famOf(r); if(f==="subj"||f==="comp")return "dep"; if(SEM_DEP_FAM.has(f))return "head"; return null; }
const CATRANK={subj:3,comp:2,mod:1};   // higher = drawn later = in front
function catRank(rel){ return CATRANK[cat(rel)]||0; }

function tok(form,lemma,upos,xpos,feats,head,deprel,translit,tlemma){return {form,lemma,upos,xpos,feats,head:String(head),deprel,deps:"_",misc:"_",translit:translit||"",translitLemma:tlemma||translit||""};}
// The live document: one entry per sentence. Starts EMPTY — bootBridge() fills it at launch from
// the opened file (or leaves it empty when there is none). js/dev-fixture.js seeds it with a few
// sentences for browser design mode only, and is not part of the shipped bundle.
let DOC=[];

/* Width measurement for layout. Used to be canvas measureText — fast, and fine for Latin — but stemma/arc
   (SVG) paint through CSS `font-family:var(--token-font)` while canvas resolves the same stack string via a
   DIFFERENT font matcher. On WKWebView that mismatch is acute for Indic scripts after a Script switch
   (Devanagari→Grantha): canvas kept returning the previous script's advances, so token centres / seam marks /
   folded punctuation stayed put while the glyphs grew over them. Wrapped brackets never saw it — their seams
   hang off the real DOM box (`htmlSeamMark` → `inset-inline-start:100%`). Measuring with a detached SVG
   `<text>` uses the same shaping path the diagrams paint with, so the two stay in step. Off-document
   (left:-99999) so it never paints; getComputedTextLength() still works. */
const _msvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
_msvg.setAttribute("aria-hidden","true");
_msvg.style.cssText="position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
const _mtxt=document.createElementNS("http://www.w3.org/2000/svg","text");
/* PRESERVE WHITESPACE, or `meas(" ")` measures ZERO. SVG text collapses and then TRIMS leading/trailing
   whitespace by default, so a string that is nothing but a space has no content left and
   getComputedTextLength() returns 0 — silently, and only for the one string nobody thinks to check. Seventeen
   call sites ask for exactly that string: it is the word-space this app lays out with (the gap between tokens in
   the arc/linear view, the stemma and wrapped-layout column gaps, the goeswith gap, and the space between a
   folded punctuation mark and its host). All of them were getting 0, which is why merged punctuation sat flush
   against its word even where the file plainly had a space — most visible in Sanskrit, whose daṇḍa are always
   space-separated, and invisible in English, where a comma or full stop usually carries SpaceAfter=No and the
   gap was meant to be zero anyway. The measuring element only ever holds one string at a time and is off-screen,
   so preserving whitespace costs nothing elsewhere: no measured string has leading or trailing spaces to widen.
   Both spellings, deliberately — `xml:space` is the SVG 1.1 attribute browsers still honour, `white-space` the
   SVG 2 / CSS replacement; the attribute also survives the style.cssText rewrite meas() does on every call. */
_mtxt.setAttribute("xml:space","preserve");
_msvg.appendChild(_mtxt);
function _measMount(){ const h=document.documentElement||document.body; if(h&&!_msvg.isConnected) h.appendChild(_msvg); }
// gwTieBox/descent/xHeight (below) stayed on canvas measureText rather than moving to the SVG path above: all
// three measure a FIXED, script-independent reference glyph (U+203F undertie; Latin "gjpqy"/"x" for vertical
// metrics) that resolves to the same Latin-covering face — usually the stack's plain "Noto Sans" — no matter
// which Indic script is currently displayed, so the stale-advances bug the comment above describes (a face
// swap on the SAME measured text) can't occur here; only meas()'s real, script-varying token text needed the
// SVG rework. actualBoundingBoxAscent/Descent also has no SVG getBBox equivalent worth the coordinate-system
// risk for a reserve this narrow.
const _cv=document.createElement("canvas").getContext("2d");
_measMount(); if(!_msvg.isConnected) document.addEventListener("DOMContentLoaded",_measMount);
/* TOKEN_STACK / MONO_STACK — the BASE family lists (~150 Noto script faces + the CJK/system tail). They are
   NOT written out here any more: the identical two lists are the KIT's own --token-font/--mono-font
   (macos-kit/mac-tokens.css, redeclared by the Fluent kit), a second hand-maintained copy in JS could only
   drift from the CSS the glyphs actually render in — and measuring against a stack the page doesn't use is a
   silent, invisible wrongness (every slot width slightly off, no error anywhere).
   LAZY on purpose — read on FIRST USE and cached, never at module-load time. Two reasons: a stylesheet that
   has not applied yet (or a kit that 404'd) would otherwise cache "" forever, and this file loads long before
   anything measures. Accessor properties on `window` rather than a tokenStack() call, so every existing
   `TOKEN_STACK` reference — translit.js's Ranjana override, fontload.js's coverage probe — keeps reading a
   plain string with no call sites to chase.
   ORDERING NOTE, and it matters: translit.js's syncSchemeAttr sets an INLINE --token-font override on <html>
   for the Ranjana scheme, string-built as '"Nithya Ranjana", '+TOKEN_STACK. That read happens (as an argument)
   BEFORE its own setProperty, so the cache is always filled from the un-overridden kit value and a second
   scheme switch cannot double-prepend. Don't add a reader that could fire while that override is live and the
   cache is still empty — and don't make this re-read per call, which would reintroduce exactly that bug. */
let _tokBase=null, _monoBase=null;
function _rootFontVar(prop){ try{ return getComputedStyle(document.documentElement).getPropertyValue(prop).trim(); }catch(e){ return ""; } }
Object.defineProperty(window,"TOKEN_STACK",{configurable:true,
  get(){ return _tokBase || (_tokBase=_rootFontVar("--token-font")) || '"Noto Sans", -apple-system, system-ui, sans-serif'; }});   // the literal is a floor for a missing kit only (never cached, so a later call still finds the real list) — NOT a second copy of the stack
Object.defineProperty(window,"MONO_STACK",{configurable:true,
  get(){ return _monoBase || (_monoBase=_rootFontVar("--mono-font")) || '"Noto Sans Mono", ui-monospace, Menlo, monospace'; }});
// LIVE_TOKEN_STACK/LIVE_MONO_STACK: the family list actually in force RIGHT NOW, refreshed off the DOM by
// refreshFontStacks() — as opposed to TOKEN_STACK/MONO_STACK above, which stay the static BASE list forever (
// translit.js's syncSchemeAttr string-builds a scheme override FROM that base, e.g. Ranjana's
// '"Nithya Ranjana", '+TOKEN_STACK — and needs the unchanging base to build from, not today's already-overridden
// value, or a second scheme switch would double-prepend). #doc's CSS custom property --token-font/--mono-font is
// the base by default but can carry a scheme-scoped inline override (currently only Ranjana; see syncSchemeAttr) —
// LIVE_TOKEN_STACK is how the canvas measurement machinery below finds out about that override without a second
// hand-maintained condition. Falls back to the base until the first refresh, so measurement still works in a
// harness that has no #doc yet.
/* All of these — the two LIVE_ stacks and every measurement font string derived from them — are declared as
   LAZY accessor properties rather than plain `let`s, for one reason: a plain initialiser would force
   TOKEN_STACK's --token-font read at THIS MODULE'S LOAD TIME, which is the very thing the getter above exists
   to avoid. `derive` runs on the first read that actually needs the value (the first render, in practice) and
   its result is cached; refreshFontStacks()'s assignments below go through the setter and replace it, exactly
   as they replaced the `let` before. Behaviour is unchanged — the same strings, computed later. */
function _lazyFont(name,derive){ let v; Object.defineProperty(window,name,{configurable:true,
  get(){ return v!==undefined?v:(v=derive()); }, set(x){ v=x; } }); }
_lazyFont("LIVE_TOKEN_STACK",()=>TOKEN_STACK); _lazyFont("LIVE_MONO_STACK",()=>MONO_STACK);
_lazyFont("WORD_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("NODE_F",()=>'14px '+LIVE_TOKEN_STACK);
_lazyFont("WORD_F_BOLD",()=>'640 '+WORD_F); _lazyFont("NODE_F_BOLD",()=>'640 '+NODE_F);   // the weight .sel USED to bold a selected token's form to — stemma/tree/arcs reserve width to the WIDER of the two so a token's hit/wash box never needs to change size on selection (no reflow-on-select trigger exists for these views, unlike brackets). Selection no longer changes weight at all (see the "selected token text" note in app.css beside .node.sel .node-lbl: the wrapped/HTML views had no such reserve, so the bump shifted and clipped their layout). The reserves are kept rather than removed — they cost a couple of px of slot width and dropping them would re-space every diagram — so this pair now buys headroom, not a bold state
_lazyFont("POS_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("GRID_F",()=>'462 13px '+LIVE_MONO_STACK); _lazyFont("HEAD_F",()=>'640 9.5px '+LIVE_TOKEN_STACK);   // POS tags: same size + weight (normal, i.e. no weight token here) as the transliteration (TRANS_F) — upright rather than italic; c2sc small-caps do the visual "tag" styling now, not a bumped weight/shrunk size. GRID_F: weight curve @12.65px (matches table.grid's own CSS weight — was unweighted/400, measuring narrower than the grid actually renders)
_lazyFont("TRANS_F",()=>'italic 15px '+LIVE_TOKEN_STACK); _lazyFont("TRANS_UP_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("MWT_F",()=>WORD_F);   /* the MWT surface form measures/renders exactly like a normal token form (WORD_F, 15px). TRANS_UP_F: the same row set UPRIGHT — what a Foreign=Yes token's transliteration renders in (see trFont/.frn-up) */
_lazyFont("GRID_ITAL_F",()=>'italic 462 13px '+LIVE_MONO_STACK);   // GRID_F's own italic: what a Foreign=Yes token's Form cell renders in (see .tok-ital / gridFormFont), so its width is measured correctly (esp. RTL). Weight curve @12.65px, matching GRID_F
// weightCurve(px) is the canonical formula behind every curve-weighted rule's font-weight (see the :root
// "weight curve" comment) — those rules are now LITERAL numbers computed from this SAME formula (a CSS
// custom-property version was tried and abandoned; see :root), so keep any new size's literal in sync by hand.
// A canvas `font` string can't read a CSS var() either way, so any measurement that needs to match a
// curve-weighted rule's ACTUAL rendered width still has to compute its own weight token here.
const TOK_REF_SIZE=15;
function weightCurve(px){ return Math.round(Math.max(400,Math.min(900,400*TOK_REF_SIZE/px))); }   // weight ∝ 1/size (see the :root comment) — every steeper exponent tried (1/size², 1/size^1.5, 1/size^(4/3), 1/size^(5/4)) read too heavy in turn; plain linear is what it settled on
// tracking curve: the SAME "one canonical formula, literal numbers at each consumer" approach as weightCurve()
// above (a live calc()/var() version isn't reliable in this app's WebKit — see the :root weight-curve comment),
// now for letter-spacing. 0 at TOK_REF_SIZE (15px, the diagram token size) — text set AT the reference size gets
// no extra tracking — and increases (in em, i.e. proportionally to the text's OWN size) as size shrinks below
// that, since smaller text otherwise reads visually tighter next to the 15px token forms. TRACK_K=.08 is a
// deliberately gentle constant (small-label sizes land around .01-.04em); keep any new consumer's literal in
// sync by hand: 9.5px→.0365em 10.5px→.0285em 11px→.0248em 13px→.0114em 13.2px→.0102em 13.5px→.0084em
// 14px→.0055em 15px→0 (reference) 16px→-.0052em (larger than reference → slightly NEGATIVE/tighter, per the
// same formula run the other direction)
const TRACK_K=.08;
function trackCurve(px){ return +(TRACK_K*-Math.log(px/TOK_REF_SIZE)).toFixed(4); }
// gloss-tier measurement fonts — must match the CSS at .gloss / .gloss[data-tier=…]: lexical gloss now shares
// MGloss's own upright 13.2px (matches --stext-fs, the block-initial sentence size); MSeg is 15px italic (word-like).
// Used to size token/node slots so a wide gloss can't crowd its neighbour (item 13).
_lazyFont("GLOSS_F",()=>weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK); _lazyFont("MSEG_F",()=>'italic 15px '+LIVE_TOKEN_STACK); _lazyFont("MSEG_UP_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("MGLOSS_F",()=>weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK);   // item 5: MSeg measures at the TOKEN size (15px = WORD_F), not 14px, and at token WEIGHT (no curve bump — see .gloss[data-tier="mseg"]'s literal 400, its size being the reference size itself). MGloss measures at the block-initial sentence size (13.2px = --stext-fs), weighted via weightCurve() so glossSlotW's measured width matches what .gloss/.gloss[data-tier="mgloss"] actually render at
function tierFont(tier,tk){ return tier==="mseg"?(isForeign(tk)?MSEG_UP_F:MSEG_F):(tier==="mgloss"?MGLOSS_F:GLOSS_F); }   // the MSeg tier is the only italic one, so it's the only one a Foreign=Yes token flips upright (see frnUp)
// widest below-token gloss row for a token, in its real font (0 when no gloss tier is on). An empty tier draws "…"
// (gl-empty) so it contributes that narrow placeholder width — a real gloss dominates. Folded into every slot-width max.
function glossSlotW(t){ let w=0; belowTiers().forEach(tier=>{ w=Math.max(w,meas(tierText(t,tier)||"…",tierFont(tier,t))); }); return w; }
function meas(s,f){
  // Mirror CSS letter-spacing for sizes that carry the tracking curve (.node-lbl/.baseword at 14px → .0055em,
  // etc.). Canvas measureText ignored it; SVG getComputedTextLength honours style.letterSpacing. Sizes at the
  // 15px reference (WORD_F/POS_F/…) keep 0 — trackCurve(15)===0 — so this is a no-op for those.
  const px=parseFloat(f)||TOK_REF_SIZE, track=trackCurve(px);
  _mtxt.style.cssText="white-space:pre;font:"+f+(track?(";letter-spacing:"+track+"em"):"");   // white-space FIRST so the font shorthand can't reset it; pairs with the xml:space attribute set above — see that note for why a bare " " otherwise measures 0
  _mtxt.textContent=s||"";
  try{ return _mtxt.getComputedTextLength(); }catch(_){ return 0; } }
// Re-reads #doc's LIVE --token-font/--mono-font (getComputedStyle resolves the var() to a plain string canvas CAN
// use — confirmed empirically; a canvas `font` string handed a literal `var(--token-font)` token is a DIFFERENT,
// silent failure: the browser rejects the whole assignment and `.font` reverts to its default, exactly the
// "canvas can't read a CSS var()" trap the weightCurve comment above warns about for calc()/var() self-reference —
// so the var() must be resolved through the CSSOM FIRST, never handed to canvas raw) and rebuilds every
// measurement font string from it, so wrap/layout maths always matches what the glyphs actually render in —
// currently only the Ranjana scheme override (see translit.js's syncSchemeAttr) diverges from the base stack, but
// this needs no per-scheme condition of its own: whatever #doc's cascade resolves --token-font/--mono-font to is
// what gets measured against, automatically, for that override and any future one. Called ONCE per renderDoc()
// (js/core/document.js), not per meas() call — meas() runs many times a render (every token/label/gloss tier) and
// getComputedStyle is not free, whereas the family list can only change between renders (a scheme switch always
// re-renders — see orPick/loadOrthoSchemes). Every font string below is a cheap string concat off the cached
// LIVE_TOKEN_STACK/LIVE_MONO_STACK, not a fresh DOM read.
function refreshFontStacks(){
  const d=document.getElementById("doc");
  if(d){ const cs=getComputedStyle(d);
    const t=cs.getPropertyValue("--token-font").trim(), m=cs.getPropertyValue("--mono-font").trim();
    if(t) LIVE_TOKEN_STACK=t; if(m) LIVE_MONO_STACK=m; }   // empty (no #doc, or the property somehow unset) → keep whatever was last live, which starts as the static base
  WORD_F='15px '+LIVE_TOKEN_STACK; NODE_F='14px '+LIVE_TOKEN_STACK; WORD_F_BOLD='640 '+WORD_F; NODE_F_BOLD='640 '+NODE_F;
  POS_F='15px '+LIVE_TOKEN_STACK; GRID_F='462 13px '+LIVE_MONO_STACK; HEAD_F='640 9.5px '+LIVE_TOKEN_STACK;
  TRANS_F='italic 15px '+LIVE_TOKEN_STACK; TRANS_UP_F='15px '+LIVE_TOKEN_STACK; MWT_F=WORD_F;
  GRID_ITAL_F='italic 462 13px '+LIVE_MONO_STACK;
  GLOSS_F=weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK; MSEG_F='italic 15px '+LIVE_TOKEN_STACK; MSEG_UP_F='15px '+LIVE_TOKEN_STACK; MGLOSS_F=weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK;
  GW_TIE_F='26px '+LIVE_TOKEN_STACK;
}
// THE SEAM MARK (seamMark — "=" at a multi-word-token seam, "-" at an mSUD "/m" morpheme seam; see prefs.js) as
// drawn. Two rules hold at every site, in SVG and HTML alike:
//  · It never enters the layout box of the row it sits beside — an SVG sibling of that row, an out-of-flow
//    (absolutely positioned) child in HTML. So the row's own box stays exactly what it would be with no mark at
//    all, which is what keeps a marked row centred on the token's true centreline, and what keeps the inline
//    editor (makeEditable places its field over el.getBoundingClientRect()) opening flush over the text it edits
//    rather than half a mark-width off it.
//  · It takes ZERO layout width — it hangs into the gap past the row's inline end, like a hyphenation mark rather
//    than an ordinary glyph, so a seam never pushes its token apart from the neighbour it continues into.
// A token can carry a mark on either side (seamPost after it, seamPre before it — seamOwner decides which of a
// seam's two tokens takes it), and the middle piece of a three-part word can carry both. A THIRD placement,
// seamMid, is the seam whose mark belongs to NEITHER token: it is drawn here exactly like a post mark, flush off
// this row's inline end, and then slid to the middle of the gap by positionSeamMarks once the layout is final.
// `halfEnd` is half the row's own width toward the inline END, `halfStart` toward the inline START (they differ
// only where satellites hang off one side); `font` is the face that row measures in; `row` names which row this
// is ("form" / "translit" / "mseg"), the one thing the centring pass can't work out for itself and what the
// stylesheet colours by. The mark always renders upright (.seam-mark) — it belongs to the seam rather than to
// either side of it — but takes its own row's foreground colour, so it reads at the strength that row is written in.
function svgSeamMark(parent,tk,cx,y,halfEnd,font,boxes,halfStart,row){ if(!parent) return;
  const f=font.replace(/^italic\s+/,"");
  [[seamPost(tk),1,halfEnd,"",seamPostToks(tk)],[seamPre(tk),-1,halfStart!=null?halfStart:halfEnd,"",seamPreToks(tk)],[seamMid(tk),1,halfEnd," seam-mid",seamMidToks(tk)]].forEach(([m,side,half,extra,toks])=>{
    if(!m) return;
    const w=meas(m,f), x=cx+(RTL?-side:side)*(half+w/2);
    const e=E("text",{class:"seam-mark"+extra,x:x,y:y,"text-anchor":"middle"});   // anchored on its own CENTRE, never start/end: those two are relative to the inline base direction, so under RTL they'd flip and hang the mark back over the very text it sits beside
    e.style.font=f; e.textContent=m; e.dataset.seamRow=row||"form"; if(toks)e.dataset.seamToks=toks; parent.appendChild(e);   // the row is what the centring pass measures BY (mid marks) and what the stylesheet colours by (all of them), so every mark carries it; data-seam-toks names the two tokens the seam joins, which is what applySel gives the accent from
    boxes&&boxes.push({x:x,y:y-4,hx:w/2,hy:7}); }); }   // the mark reserves no SLOT width, but fitTight still has to see it, or a line-final one would crop off the diagram's own edge
// the seam marks on a token's FORM row: past the form's REAL DRAWN width AND that side's satellites (item 6's
// correct form + the folded punctuation trailing it, the right-merging leads before it), so neither can land on
// top of one of them.
// The half-width used to be max(fmeas(f), fmeas('640 '+f)) — clearance reserved against the bold weight .sel once
// gave a selected form. Nothing bolds on selection any more (see the "SELECTED TOKEN TEXT IS ACCENT-COLOURED,
// NEVER BOLDER" note in styles/app.css), so that max() had become DEAD clearance: it hung every seam mark ~0.4-0.9px
// (Noto Sans 15px, 400→640) further out than the glyph it continues from, on EVERY token, for a state that can no
// longer occur — visible as a mark floating in the gap rather than reading as part of the word. Measured at the
// drawn weight now. The SLOT reserves (WORD_F_BOLD/NODE_F_BOLD in linear/stemmaLayout/wordW) deliberately stay:
// they size a COLUMN, not a mark, and dropping them would re-space every diagram — see WORD_F_BOLD's own note.
function svgFormSeamMark(parent,tk,cx,y,f,boxes){ const half=fmeas(tk,f)/2;
  svgSeamMark(parent,tk,cx,y,half+tailW(tk,f),f,boxes,half+leadW(tk,f),"form");
  // …and, on the same inline-START edge, the mid-sentence paragraph break (MISC NewPar=Yes). Past the seam PRE
  // mark's own width where there is one, so the two satellites queue outward instead of landing on each other:
  // the pilcrow is a break BEFORE the word and the seam mark is part of the word, so the pilcrow goes further out.
  svgNewParMark(parent,tk,cx,y,half+leadW(tk,f)+meas(seamPre(tk)||"",f.replace(/^italic\s+/,"")),f,boxes); }
// MISC NewPar=Yes — a paragraph that starts in the MIDDLE of a sentence, which is the one document-structure fact
// the `# newpar` comment cannot express (universaldependencies.org/format.html). Drawn as a pilcrow hung off the
// token's inline START in exactly the register the seam marks use: its own element, upright, reserving no slot
// width, never part of the form's own text — so no notation had to change to gain it, every one of them calling
// svgFormSeamMark for its form row already. A word space is folded into the offset so the mark reads as standing
// OFF the word rather than glued to it (a pilcrow abutting the first letter reads as a prefix).
function svgNewParMark(parent,tk,cx,y,halfStart,font,boxes){ if(!parent||!isNewParTok(tk)) return;
  const f=font.replace(/^italic\s+/,""), w=meas(NEWPAR_MARK,f), gap=meas(" ",f);
  const x=cx+(RTL?1:-1)*(halfStart+gap+w/2);   // inline START = left under LTR, right under RTL
  const e=E("text",{class:"newpar-mark",x:x,y:y,"text-anchor":"middle"});   // centre-anchored for the same reason svgSeamMark is: start/end flip with the base direction and would hang the mark back over the word
  e.style.font=f; e.textContent=NEWPAR_MARK; parent.appendChild(e);
  boxes&&boxes.push({x:x,y:y-4,hx:w/2,hy:7}); }   // fitTight still has to see it, or a line-initial one crops off the diagram's edge
// HTML rows (wrapped brackets / outline): the same marks as ABSOLUTELY-positioned children — out of flow, so they
// add nothing to the row's own width (the .bwund flex column still centres the row on its real text) and hang past
// its inline-end / inline-start edge exactly as the SVG satellites do. .has-seam gives them their containing block.
function htmlSeamMark(host,tk,row){ if(!host) return;
  [[seamPost(tk),"seam-post",seamPostToks(tk)],[seamPre(tk),"seam-pre",seamPreToks(tk)],[seamMid(tk),"seam-post seam-mid",seamMidToks(tk)]].forEach(([m,cls,toks])=>{ if(!m) return;
    const s=document.createElement("span"); s.className="seam-mark "+cls; s.textContent=m;
    s.dataset.seamRow=row||"form";   // as in svgSeamMark: every mark names its row — the centring pass reads it on mid marks, the stylesheet's per-tier colour on all of them
    if(toks)s.dataset.seamToks=toks;   // …and the two tokens it joins, for applySel's accent (see svgSeamMark)
    host.classList.add("has-seam"); host.appendChild(s); });
  if(row==="form"&&isNewParTok(tk)){ const p=document.createElement("span"); p.className="newpar-mark np-html"; p.textContent=NEWPAR_MARK+" ";   // the HTML half of svgNewParMark above — same satellite, same inline-START edge, and the trailing space is the same standing-off gap the SVG one folds into its offset
    host.classList.add("has-seam"); host.appendChild(p); } }
// A seam mark that belongs to NEITHER token sits SQUARELY BETWEEN them. Each is drawn flush off the first token's
// row (above) and moved here, once the layout is final — measured, not computed, because every notation lays its
// tokens out differently (uniform slots, a tidy tree, bracket runs, an HTML flex column) and the rendered geometry
// is the one thing they all agree on.
// One x for the WHOLE SEAM, not one per row: the marks on a token's form, transliteration and segmentation rows
// line up in a column, the way every other tier of a token does. So each row first measures its own clear span —
// from its own inline end to the start of the same row of the next token along — and then the seam takes the
// INTERSECTION of those spans, the strip of gap that is free of ink on every row at once, and centres every one of
// its marks on the middle of that. Rows whose own gap is wider (a short form under a long gloss) simply don't
// narrow it. Runs with the other measured overlays at the end of renderDoc, and is idempotent: every mark goes
// back flush before anything is measured, so a second pass lands where the first did.
// ONLY the middle marks move. A post/pre mark stays flush against the row it hangs off, ragged edge and all: it
// belongs to ONE token, as that word's own suffix/prefix, and hanging it out at a column shared with the other
// rows reads as a boundary standing apart from the word rather than as part of it.
const SEAM_ROW_SEL={form:".tok-word,.baseword,.node-lbl,.bwform,.oform", translit:".translit,.otrans", mseg:'.gloss[data-tier="mseg"]'};
// …and, in the BRACKETS notations ONLY, a bracket glyph counts as the far wall of the gap too. "Squarely between
// the two tokens" is the right centre wherever the gap really is empty — every other notation puts nothing between
// two words but whitespace. Brackets do: the seam between two tokens of one word almost always has a "]" and/or a
// "[" standing in it (each dependent subtree is bracketed, so a child opens its own "[" right before its word), and
// centring on the TOKEN midpoint therefore drops the mark straight onto a bracket glyph. Measuring the clear span
// to the nearest BRACKET instead centres the mark halfway between the head token and that bracket — the gap that
// is actually free. Only the FORM row can ever meet one (both bracket renderers sit their brackets on the form
// baseline), and the same-line ink-overlap test below filters them off the translit/MSeg rows for nothing.
const SEAM_BRK_SEL=".brk,.bwbr";
function positionSeamMarks(){ const marks=[...document.querySelectorAll("#doc .seam-mid")];
  marks.forEach(m=>{ if(m.ownerSVGElement){ if(m._x0==null)m._x0=+m.getAttribute("x")||0; m.setAttribute("x",m._x0); } else m.style.transform=""; });   // back to flush first
  const seams=new Map();   // the token cell/group a mark hangs off → every row's measurement for that one seam
  marks.forEach(m=>{
    const sel=SEAM_ROW_SEL[m.dataset.seamRow]; if(!sel) return;
    const rowSel=(conv==="brackets")?(sel+","+SEAM_BRK_SEL):sel;   // brackets (flat AND wrapped): the nearest bracket bounds the gap — see SEAM_BRK_SEL
    const svg=m.ownerSVGElement, box=svg||m.closest(".text-conv,.diagram"); if(!box) return;
    const mr=m.getBoundingClientRect(); if(!mr.width) return;
    const rtl=(svg?svg.closest("[dir]"):box.closest("[dir]"));
    const isRTL=!!rtl && rtl.getAttribute("dir")==="rtl";
    // Distances are measured from the mark's ANCHOR — the row's own inline END, which is where the mark is flush
    // against right now (its inline-START edge; its inline-END edge is one mark-width further out) — and NOT from
    // the mark's far edge. The two give the identical centre whenever the gap is wide enough to hold the mark, but
    // they differ on exactly the case this pass exists for: in BRACKETS the "[" opening the next token's own
    // constituent stands about 5px past the head token's ink, narrower than the "꞊" (≈6.7px) hanging there, so a
    // flush mark ALREADY overlaps that bracket by a fraction of a pixel. Measured from the mark's far edge the
    // bracket scored d≈−0.6 … −1.7, failed the ≥−0.5 test, and was skipped — leaving the NEXT TOKEN'S FORM as the
    // far wall, i.e. the very token-midpoint centring SEAM_BRK_SEL was added to avoid, which dropped the mark
    // squarely on top of the bracket glyph (measured: amara꞊jyotiṣām in samples/brihat_jataka.conllu, ~8px off in
    // flat brackets, ~8.6px in wrapped). From the anchor the bracket scores its true clear gap and wins, and where
    // that gap is narrower than the mark the mark simply centres in it and overhangs symmetrically.
    let best=null;   // the nearest same-row ink ON THIS LINE past the anchor, in reading order
    const anchor=isRTL?mr.right:mr.left;
    box.querySelectorAll(rowSel).forEach(el=>{ const r=el.getBoundingClientRect(); if(!r.width) return;
      if(Math.min(r.bottom,mr.bottom)-Math.max(r.top,mr.top)<=1) return;   // same line iff the two INK boxes overlap vertically. Not a top-to-top comparison: a "꞊" or "-" sits mid-x-height, so its ink top is several px below a letter's on the very same baseline, while the next row down clears it entirely
      const d=isRTL?(anchor-r.right):(r.left-anchor);
      if(d>=-0.5 && (best==null||d<best)) best=d; });   // `best==null`, not `!best`: a bracket flush against the row's edge scores exactly 0, and the old truthiness test let any later, FARTHER candidate replace it
    if(best==null) return;   // nothing follows it on this line (the word broke across a wrap) → leave the mark flush
    // this row's clear span, in screen coords: from the anchor to the nearest ink past it, in reading order
    const lo=isRTL?(anchor-best):anchor, hi=isRTL?anchor:(anchor+best);
    const key=m.closest("[data-tok]")||m.parentElement;   // one key per token cell = one seam; a stemma's node and its baseline word are separate cells, and rightly get their own column each
    if(!seams.has(key)) seams.set(key,[]);
    seams.get(key).push({m,mr,svg,lo,hi}); });
  seams.forEach(rows=>{
    let lo=-Infinity, hi=Infinity;
    rows.forEach(r=>{ if(r.lo>lo)lo=r.lo; if(r.hi<hi)hi=r.hi; });   // the gap they ALL share
    rows.forEach(r=>{
      const centre=(hi>lo)?(lo+hi)/2:(r.lo+r.hi)/2;   // no strip clear on every row (rows of wildly different widths) → that row centres in its own gap rather than landing on top of something
      const shift=centre-r.mr.width/2-r.mr.left, m=r.m, svg=r.svg;
      if(svg){ const ctm=svg.getScreenCTM(); const sc=ctm&&ctm.a?ctm.a:1; m.setAttribute("x",m._x0+shift/sc); }
      else { const fs=(typeof FS==="number"&&FS)?FS:1; m.style.transform="translateX("+(shift/fs)+"px)"; } }); }); }
// merge-punctuation folds each punct mark OFF its host as a SATELLITE: `mform` keeps the host-only form (=== form
// now) so the host node stays centred for arc endpoints, while each mark is drawn as its own selectable, real-width
// element beside the host. `hangs` carries {form, sp, orig} per mark (glyph, SpaceAfter-driven leading space, original id).
function origForm(o){ return o ? (o.mform!=null ? o.mform : o.form) : ""; }   // the ORIGINAL-script host form, never orthography-swapped
// Three kinds of orthography:
//  · TRANSFORM (Simplified/Traditional): SAME-SCRIPT glyph swap — no displacement, no top-line swap.
//  · NON-LATIN SCRIPT (Zhuyin, the Indic scripts): glyph swap + the ORIGINAL is pushed to the translit row
//    + the top sentence line becomes the script. This is the "displacement" path (orthoScript()).
//  · LATIN-OUTPUT (Gwoyeu Romatzyh, Chao's General Chinese, Jyutping-as-orthography): a PLAIN extra row in
//    the translit-row position — the original glyph AND the top line are left untouched (orthoLatin()).
const TRANSFORM_ORTHO=new Set(["simplified","traditional","latin","cyrillic"]);   // same-language script swaps (Han simp/trad, Serbian Cyrillic↔Latin): glyph-swap only, no displacement
const LATIN_ORTHO=new Set(["gr","generalchinese","generalchinese_yue","jyutping"]);
function orthoLatin(){ return !!ORTHO_SCHEME && LATIN_ORTHO.has(ORTHO_SCHEME); }
function orthoScript(){ return !!ORTHO_SCHEME && ORTHO_SCHEME!=="none" && !TRANSFORM_ORTHO.has(ORTHO_SCHEME) && !LATIN_ORTHO.has(ORTHO_SCHEME); }   // "none" is not a script (no top-line displacement)
function iastFormEdit(){ return isSanskritLang() && orthoScript(); }   // Item 10: Sanskrit with a real script displayed → the script glyph is a DERIVED, display-only rendering of the stored IAST form, so the IAST transliteration ROW beneath is the editable field that writes back to the token FORM (never the script glyph directly)
// BCP-47 tag for the rendered content, from the document language + the selected same-language script swap.
// Han unification (zh-Hans vs zh-Hant vs ja) and locale Cyrillic (Bulgarian, Serbian) render correct
// regional glyphs only when the element carries this tag → it drives the OpenType `locl` feature and the
// system CJK font's region. ORTHO_SCHEME's script swaps (simplified/traditional/cyrillic/latin) pick the
// script subtag; otherwise the plain language code (e.g. bg→"bg", ja→"ja", ko→"ko").
function bcp47Tag(){
  let base=(DOCLANG||"en").toLowerCase();
  const alias={zho:"zh",cmn:"zh",jpn:"ja",kor:"ko",srp:"sr",bul:"bg"};   // normalise common 639-3 → the BCP-47 primary subtag
  if(alias[base]) base=alias[base];
  let script="";
  switch(ORTHO_SCHEME){
    case "simplified":  script="Hans"; break;
    case "traditional": script="Hant"; break;
    case "cyrillic":    script="Cyrl"; break;
    case "latin":       script="Latn"; break;
  }
  return script ? base+"-"+script : base;
}
const SUP={"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
function superTones(s){ return String(s).replace(/[0-9]/g,d=>SUP[d]||d); }   // Jyutping tone digits → Unicode superscripts (display only)
// Display-only per-scheme transforms; the value written to MISC keeps the plain/full form:
//  · Jyutping tone numbers → Unicode superscripts (hok6 → hok⁶)
//  · Baxter–Sagart Old Chinese → strip the leading "*" and any (parenthetical) comments
function dispScheme(text,scheme){ if(!text) return text||"";
  if(scheme==="jyutping") return superTones(text);
  if(scheme==="oc") return String(text).replace(/\*/g,"").replace(/\s*\([^)]*\)/g,"").trim();
  return text; }
// item 17: per-script daṇḍa / double-daṇḍa glyphs (mirrors translit._DANDA). A daṇḍa is written into
// romanised Sanskrit as "|"/"/" and a double daṇḍa as "||"/"//"; most Brahmic scripts share the
// Devanagari daṇḍa ।/॥, but a few have their own. When a real Indic SCRIPT is selected, a punctuation
// TOKEN that is a daṇḍa marker shows the script's native glyph instead of the ASCII pipe/slash.
const SCRIPT_DANDA={Tibetan:["།","༎"],Sharada:["𑇅","𑇆"],Siddham:["𑗂","𑗃"]}, DANDA_DEFAULT=["।","॥"];
function dandaGlyph(form){   // → the script daṇḍa for a "|"/"||"/"/"/"//" marker under an active Indic script, else null
  if(!isSanskritLang()||!orthoScript()) return null;
  const d=SCRIPT_DANDA[ORTHO_SCHEME]||DANDA_DEFAULT;
  if(form==="||"||form==="//"||form==="‖") return d[1];   // feature 17: "‖" (U+2016) is the double-daṇḍa DISPLAY glyph the store folds "||"/"//" into (the token FORM in the sample IS "‖"); match it so the double daṇḍa converts to the script glyph like the single one — the diagram folds daṇḍa PUNCT into hanging satellites drawn via hangForm=dandaGlyph||p.form (never t.ortho), so without this a "‖" showed raw instead of ॥/༎
  if(form==="|"||form==="/") return d[0];
  return null; }
// item 11: the SCRIPT drives the MAIN GLYPH. "Original" (default, ORTHO_SCHEME="") → the stored form;
// "None" (ORTHO_SCHEME="none") → the DISPLAYED transliteration becomes the main glyph; a script id → that script.
function bform(t){ const f=(t&&t.mform!=null)?t.mform:(t?t.form:"");
  const scriptOn=!!ORTHO_SCHEME && ORTHO_SCHEME!=="none";
  if(scriptOn){ const dg=dandaGlyph(f); if(dg) return dg;   // item 17: an un-folded daṇḍa PUNCT token → the script's native daṇḍa
    return (t && t.ortho) ? dispScheme(t.ortho,ORTHO_SCHEME) : f; }
  if(isSanskritLang() && t && t.ortho) return t.ortho;   // item 18: Sanskrit MWT sandhi-fused IAST is the surface form even with NO script (None/Original)
  if(ORTHO_SCHEME==="none") return (show.translit && t && t.translit) ? dispScheme(t.translit,TRANSLIT_SCHEME) : f;
  return f; }
// item 3 — the class suffix a token's FORM element carries for its marker FEATS: Typo=Yes → a strikethrough (see
// the .tok-typo rule). Returned as a suffix so each renderer appends it to whatever form class it already builds,
// in SVG and HTML alike. Foreign=Yes is NOT here: it renders as italics alone (italDeco, below) — no underline.
function formDeco(tk,gwHead){ const gw=(gwHead===undefined)?!!gwOf(tk).length:!!gwHead;   // gwHead: an EXPLICIT override for callers that hold raw tokens. t._gw is set by the DISPLAY transform (foldGoesWith) and is simply absent in the grid, so the default test silently answered "not a goeswith head" there and the strike came back — see the grid's own call
  return (hasFeat(tk&&tk.feats,"Typo","Yes") && !gw) ? " tok-typo" : ""; }   // …EXCEPT on a goeswith head, where the UD guidelines REQUIRE Typo=Yes ("Typo=Yes must be used with the goeswith head") for the split itself, not for a misspelling of that form: striking the first part through would say the word is mistyped and leave the second part clean, when what is wrong is the space between them — which the slur already says. A goeswith head with a real CorrectForm still shows it (correctFormOf reads the feature directly, not this)
// item 2 — Foreign=Yes sets the token's form in ITALICS, the ordinary typographic mark for a foreign word, and
// that is its whole rendering (an italic form is unmistakable on its own; the underline it used to also draw just
// crowded the descenders). Wherever a row is ALREADY italic — the diagrams' transliteration and MSeg
// (segmentation) tiers — a foreign token flips the other way and renders UPRIGHT, keeping the same contrast
// against its neighbours. Three helpers, used in step at every render AND measurement site: italDeco() is the
// class suffix the FORM element takes, frnUp() the one the italic rows take, and fmeas()/trFont()/tierFont() the
// matching canvas fonts. The layout measures every one of these strings on a canvas, and an italic face is not
// the width of its upright, so a face swap that skipped the measurement would misplace the slot, the MWT tie and
// the hit box. The GRID applies the same italics on its Form cell (measuring with GRID_ITAL_F).
// `_gwFrn` — set by foldGoesWith on BOTH halves of a goeswith unit when EITHER half carries the flag (see the note
// there). Foreignness is a property of the WORD, and a goeswith unit is one word split by a stray space: there is no
// such thing as half a foreign word, so both parts render italic or neither does. Read here rather than at each
// render site so every measurement (fmeas1/trFont/gridFormFont) and every draw agrees, which is the whole point of
// funnelling the italics through these three helpers.
function isForeign(tk){ return !!(tk&&tk._gwFrn) || hasFeat(tk&&tk.feats,"Foreign","Yes"); }
function italDeco(tk){ return isForeign(tk)?" tok-ital":""; }
function frnUp(tk){ return isForeign(tk)?" frn-up":""; }
function fmeas1(tk,f){ return meas(bform(tk), isForeign(tk)?"italic "+f:f); }   // ONE token's form width in the face it ACTUALLY renders in
function fmeas(tk,f){ let w=fmeas1(tk,f); const g=(tk&&tk._gw)||[];   // …and the WHOLE WORD's, which for a goeswith unit is the head plus every continuation folded onto it (see the goeswith block below)
  for(let i=0;i<g.length;i++) w+=gwGap(f)+fmeas1(g[i].tok,f); return w; }
/* ── GOESWITH — ONE WORD THAT A STRAY SPACE SPLIT IN THE SOURCE ─────────────────────────────────────────────
   What the UD guidelines actually specify (universaldependencies.org/u/dep/goeswith.html): "the head is always
   the FIRST part, the other parts are attached to it with the goeswith relation"; "the first part of the word is
   given the part of speech that the word would have been given if written together"; "only the first part can
   have a lemma and morphological features"; and "the later parts of the word are given the POS X" (with
   Typo=Yes on the head where the treebank has features, and SpaceAfter=No permitted only on the LAST part).
   So the continuation carries no annotation of its own — by the guideline, not by our choice. Drawing the pair
   with ONE shared annotation stack is therefore not a special case: the shared stack simply IS the first
   token's, and the continuation has nothing else to show.
   HOW IT IS RENDERED. The continuation is DISPLAY-FOLDED off the token list in displaySent — exactly the move
   merge-punctuation already makes for a folded punctuation mark — and rides on the head as `_gw`. That single
   decision buys the whole feature in every notation at once: with the continuation absent from D.tokens no
   renderer can draw an edge, an arc, a deprel label or a second below-stack for it, and the head's own stack
   (transliteration, gloss tiers, POS, deprel) is automatically the pair's ONE shared stack, centred across the
   unit because fmeas() above reports the unit's full width and every layout centres a token on its form.
   The relation itself is marked ONLY by a grey SLUR under the pair (gwSlurSVG) — no seam mark (see
   msegFlagSent in js/io/bridge.js), no bracket, no label.
   NOT AN MWT, and the two must never be confused: an MWT is one orthographic token split into several syntactic
   words (its tie carries the FUSED surface form as a label), whereas goeswith is the exact reverse — several
   orthographic tokens that should have been one. Hence a curve and no label, against the MWT tie's square
   bracket with end-pins and its surface-form label. They share only the tie LAYER (tieRows/tieLayout/mwtDepth),
   which is what keeps a slur and a bracket over overlapping spans from ever colliding. */
/* THE GAP BETWEEN TWO PARTS IS A THIN SPACE — and specifically the width the FONT gives U+2009 THIN SPACE, measured
   in the face and at the size the forms are actually drawn in. The parts must not butt flush (they ARE two
   separately editable fields, and the source really did split them) and must not sit a word space apart (they are
   one word, and a word space would say the opposite of what the undertie says). A thin space is the typographic
   answer to exactly that: the mark for "these belong together more closely than two words do".
   WHY THE CHARACTER'S OWN ADVANCE, AND NOT THE CHARACTER ITSELF. A literal U+2009 cannot be typed into the text,
   because there is no single string for it to live in: each part is its own element (an SVG <text> seated by
   gwSeats, an HTML <span> in the outline/brackets) precisely so that each half stays separately clickable and
   editable. The gap can therefore only exist as a WIDTH — and this layout reserves every width from meas(), so the
   width has to come from the same measurement the reservation does or the slot and the ink disagree. gwGap() below
   is that number — the designer's own thin space in the row's own face, not a ratio we invented.
   WHY NOT A FRACTION OF THE WORD SPACE. It would be a made-up constant, and the font already ships the answer —
   which is NOT a fixed fraction: in Noto Sans U+2009 is 166/1000 em against the word space's 260/1000 (0.64×),
   while in Noto Sans Mono both are 600/1000 (1.0×), because in a monospaced face every advance is one cell and a
   thin space correctly IS a full one there. Deriving it from the space would have got the second case wrong.
   All three faces the packaging scripts ship (CORE_FONTS: notosans, notosans-italic, notosansmono) carry U+2009 —
   checked in their cmaps, the same check U+203F and U+A78A got — so the measurement never falls back to a
   substituted face. This replaces a hard-coded 2.5px, which was that very width at the 15px WORD_F and nothing
   else: it did not follow the smaller node/wrapped faces, and it was a number with no reason attached. */
const GW_SP=" ";                                     // U+2009 THIN SPACE — measured, never drawn (see above)
function gwGap(f){ const w=meas(GW_SP,f); return w>0?w:meas(" ",f)*0.64; }   // the gap for the row's OWN face. Measured upright even between two italic (Foreign) parts: the gap is space between two pieces of ink, not ink of either. The fallback is Noto Sans's own thin-space/word-space ratio, and can only be reached by a face that maps U+2009 to a zero advance — none of the shipped ones does, but a zero would butt the parts flush and undo the whole point
function gwGapEm(){ return meas(GW_SP,"100px "+LIVE_TOKEN_STACK)/100; }   // …the same measure as an em RATIO, for the HTML notations, whose parts are laid out by the browser and take it as a margin in `em` — one measurement, so the two paths can't drift
/* THE TIE IS A REAL CHARACTER: U+203F ‿ UNDERTIE, set in the same Noto stack as everything else in the view.
   Weighed against the other candidates, on three tests:
     · BELOW the pair, which is where this tie is seated (the tie layer, under the shared below-stack). U+203F is
       the below-the-line member of its pair; U+2040 ⁀ CHARACTER TIE is the identical mark ABOVE the line, and is
       simply the wrong side.
     · A SPACING character, not a combining mark. U+035C ◌͜ COMBINING DOUBLE BREVE BELOW and U+0361 ◌͡ COMBINING
       DOUBLE INVERTED BREVE are the marks a phonetician would type between two letters, but they are
       General_Category Mn: they have no advance of their own and attach to a preceding base glyph, so they
       cannot be positioned or scaled as a free-standing mark, which is exactly what this tie has to be (it is
       drawn in the tie layer, not inside the word). U+203F is Pc (connector punctuation) with a real advance.
     · THE TIE, not an arc that looks like one. "Undertie" is Unicode's own name for it, and it is the IPA /
       Americanist mark for "these two symbols are one unit" — the very statement goeswith makes. U+2054 ⁀'s
       inverted twin, U+2323 SMILE and U+2312 ARC are lookalikes with no such meaning, so none was taken.
   FONT COVERAGE, checked the way the seam mark's own U+A78A was: against the PRUNED core set the packaging
   scripts actually ship (CORE_FONTS in packaging/make_bootstrap_app.sh + make_portable.sh) — notosans.ttf,
   notosans-italic.ttf and notosansmono.ttf — by reading each file's cmap. All three carry U+203F, so the mark
   can never come out as a tofu box on the very row it exists to tie together. (They carry U+2040, U+035C and
   U+0361 too, so coverage did not decide this; the three tests above did.) */
const GW_TIE="‿";        // U+203F UNDERTIE
/* SIZE. The tie's font size fixes its DEPTH and its stroke weight; its width is set separately, by stretching
   it across the word (gwSlurSVG). 26px is where those two pull into balance, measured in Noto Sans against the
   fixture's own units (56.6px for "with out", 90.9px for "none the less"):
     · it puts the glyph's ink height at 5.46px, so gwDepth() returns exactly the 7px the tie layer reserved for
       the mark this replaced — the whole vertical layout above it is unchanged and stays verified;
     · it takes the horizontal stretch from 6.2×/10.0× (at the form's own 15px) down to 3.6×/5.7×. Stretch is the
       one thing that degrades this glyph — the end hooks flatten out — so halving it is most of the quality;
     · at 26px the tie's stroke is ~1.7× the form's, which is what makes it read as a deliberate tie under the
       word rather than as a hairline someone left there.
   It is deliberately NOT tied to WORD_F: this is a mark's size, not a text size, and it must stay put while the
   width varies. */
_lazyFont("GW_TIE_F",()=>'26px '+LIVE_TOKEN_STACK);   // reassigned by refreshFontStacks() alongside every other measurement font, so this stays in step with a live scheme override too
// The glyph's own ink box at GW_TIE_F, measured rather than assumed — the mark is seated and the tie layer's
// depth reserved from these, so a font substitution can't leave the reserve and the drawing disagreeing.
// `asc` is the ink's rise above the baseline (NEGATIVE for U+203F, whose ink lies wholly below it).
function gwTieBox(){ _cv.font=GW_TIE_F; const m=_cv.measureText(GW_TIE);
  return {w:m.width||6, asc:m.actualBoundingBoxAscent||0, desc:m.actualBoundingBoxDescent||0}; }
function gwDepth(){ const b=gwTieBox(); return Math.ceil(b.asc+b.desc)+1; }   // total ink height + 1px slack. What tieLayout reserves for a tie row, in place of the PIN+label reserve an MWT/ExtPos row takes
function isGoesWith(d){ return /^goeswith(?:[:@\/]|$)/.test(d||""); }   // the base relation, whatever subtype (":"), deep feature ("@") or mSUD "/m" suffix rides on it
function gwOf(t){ return (t&&t._gw)||[]; }
/* "Is token `id` the head of a goeswith unit?", asked of RAW tokens. gwOf reads t._gw, which only the display
   transform sets, so anything working off DOC's own tokens — the grid, most obviously — needs this instead.
   A scan rather than a cached Set: it is O(sentence) with no allocation, called once per Form cell, and a Set
   built per cell would allocate far more than it saved. */
function isGwHeadId(s,id){ const t=(s&&s.tokens)||[];
  for(let k=0;k<t.length;k++) if(isGoesWith(t[k].deprel)&&parseInt(t[k].head,10)===id) return true;
  return false; }
// The parts of a goeswith word, each with its centre offset from the UNIT's centre and its own ink width.
// Reading order, so under RTL part 1 sits on the RIGHT — the offsets are mirrored here rather than by the
// caller, because every renderer hands us a centre that mirror() has already flipped.
function gwSeats(tk,f){ const parts=[{tok:tk,oid:null}].concat(gwOf(tk));
  const gap=gwGap(f), ws=parts.map(p=>fmeas1(p.tok,f)), total=ws.reduce((a,b)=>a+b,0)+gap*(ws.length-1), dir=RTL?-1:1;   // ONE gwGap() for the whole seating, and the same one fmeas() adds up — the reserve and the seats are the same arithmetic on the same measurement
  let x=-total/2; return parts.map((p,i)=>{ const s={tok:p.tok,oid:p.oid,w:ws[i],dx:dir*(x+ws[i]/2)}; x+=ws[i]+gap; return s; }); }
/* STRETCHING ONE GLYPH ACROSS A WHOLE WORD. A character has a fixed advance, and a goeswith word is whatever
   width its parts happen to be, so the mark has to be widened to fit. It is widened with SVG's own
   `textLength` + `lengthAdjust="spacingAndGlyphs"`, which scales the outline horizontally to an exact width —
   declarative, resolution-independent, and the one mechanism that leaves the mark a piece of TEXT (it still
   selects, still takes `fill`, still renders through the font's own hinting) instead of a traced copy of it.
   Scaling in x ALONE is also the right distortion for this particular glyph: the undertie is a long, nearly
   horizontal bottom run whose visible weight is its VERTICAL thickness, and that is exactly what a horizontal
   scale leaves alone. Only the two end hooks change, and they change by becoming longer and shallower, which is
   what a wider tie should look like. A uniform scale would instead have deepened the mark in step with the
   word's width, so a long word's tie would hang further and further below the stack; repeating the glyph would
   have drawn a scalloped run of small ties rather than one tie. Both were tried against the fixture's narrow
   ("with out") and wide ("none the less") units and rejected on that evidence.
   The mark sits in its own group so it can take the selection accent as a unit (applySel toggles .sel on .gw-g
   from data-gw, exactly as it does on .mwt-g from the component range). `ids` = the ORIGINAL token ids of every
   part, which is what makes selecting EITHER half light the tie. */
function gwSlurSVG(parent,x0,x1,y,si,ids,boxes){ if(!parent||!(x1>x0)) return null;
  const g=E("g",{class:"gw-g"}); if(si!=null&&ids){ g.setAttribute("data-s",si); g.setAttribute("data-gw",ids.join(" "));
    const c=tieDimClass(si,ids,si===sel.s&&gwHolds(g,sel.t)); if(c) g.classList.add(c.trim()); }   // the slur recedes with its word, by the same tieDimLevel rule the MWT bracket takes — it spans exactly ONE cell (a goeswith unit is one display slot), so it can never straddle two bands. Selected → full strength, like the tie. In the SVG notations the slur is appended to the diagram root, i.e. OUTSIDE any token cell, so it inherits nothing and takes the level absolutely; the outline's slur is drawn inside the row (gwSlurHTML) and inherits it instead — see applySel
  const b=gwTieBox(), W=x1-x0, by=y+b.asc;   // baseline placed so the ink TOP lands on the y the tie layer handed us (b.asc is negative for U+203F, whose ink is wholly below the baseline)
  const at={x:x0,y:by,textLength:W,lengthAdjust:"spacingAndGlyphs","text-anchor":"start"};   // anchor START: with textLength given, the glyph is laid out from x0 across exactly W
  const cas=E("text",Object.assign({class:"gw-tie-cas"},at)); cas.textContent=GW_TIE; cas.setAttribute("aria-hidden","true"); g.appendChild(cas);   // occlusion halo first, so an arc crossing the tie breaks cleanly — same trick as .mwt-tie-cas, here as a cased copy of the glyph beneath it
  const e=E("text",Object.assign({class:"gw-tie"},at)); e.textContent=GW_TIE; g.appendChild(e);
  svgTip(g,"goeswith — one word split by a space in the source");
  parent.appendChild(g); boxes&&boxes.push({x:(x0+x1)/2,y:y+gwDepth()/2,hx:W/2,hy:gwDepth()}); return g; }
/* Draw the CONTINUATION forms of a goeswith unit beside the head's own form element, and re-seat that element
   onto the unit's first slot. One call per form-drawing site, taking the <text> the site has already built, so
   no site has to know anything about goeswith beyond "also call this".
   Each continuation is its OWN field: `data-gwtok` names the token it edits, which formElOf() resolves directly
   (js/editing/context-menu.js), so both halves open independently while the SHARED rows above/below — the
   transliteration, the gloss tiers, the POS tag, the deprel label — sit in the head's group and edit the head.
   Deliberately NO data-tok: these are not token groups of their own. The unit accents as one (the group carries
   data-gw), so a second selectable cell here would light half a word. */
function gwFormSVG(parent,headEl,tk,cx,y,f,cls,si,boxes){ const g=gwOf(tk); if(!g.length) return;
  const seats=gwSeats(tk,f);
  if(headEl) headEl.setAttribute("x",cx+seats[0].dx);   // the head no longer sits on the token centre: the WORD does, and the head is only its first part
  seats.slice(1).forEach(s=>{ const e=E("text",{class:cls+formDeco(s.tok)+italDeco(s.tok),x:cx+s.dx,y:y,"text-anchor":"middle"});
    e.textContent=bform(s.tok);
    if(si!=null){ e.setAttribute("data-s",si); e.setAttribute("data-gwtok",s.oid); e.style.cursor=formCursor();   // click-to-edit like .tr-edit/.gl-edit/.cform — but a POINTER under a Sanskrit script, where this glyph is derived and the IAST row below is the field (formCursor)
      svgTip(e,"goeswith continuation — click to edit this part; the annotation belongs to the first part"); }
    parent.appendChild(e); boxes&&boxes.push({x:cx+s.dx,y:y-6,hx:s.w/2,hy:9}); }); }
// HTML notations (outline, wrapped brackets): the same two things — the continuation spans, and the slur under
// the pair — as out-of-flow/inline children of a relatively-positioned wrapper, so the row's own box is
// unchanged and the mark hangs below without pushing anything.
function gwFormHTML(container,headEl,tk,si,cls){ const g=gwOf(tk); if(!g.length||!container) return;
  g.forEach(p=>{ const s=document.createElement("span"); s.className=cls+formDeco(p.tok)+italDeco(p.tok)+" gwpart";
    s.textContent=bform(p.tok); s.dataset.s=si; s.dataset.gwtok=p.oid; s.style.cursor=formCursor();   // pointer under a Sanskrit script — the part is a derived glyph there (formCursor)
    s.style.marginInlineStart=gwGapEm().toFixed(4)+"em";   // the SAME measured thin space the SVG notations seat by (gwGap), expressed in `em` because these parts are laid out by the browser at whatever font-size the row inherits (and the block's zoom:var(--fs) on top of it) — a px value would be right at one size only. The .gwpart rule in styles/app.css carries the same number as a static fallback

    s.title="goeswith continuation — click to edit this part; the annotation belongs to the first part";
    s.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,p.oid,false); if(typeof editNodeInline==="function") editNodeInline(si,p.oid,{x:ev.clientX,y:ev.clientY}); });
    container.appendChild(s); }); }
// The outline's tie. An absolutely-positioned inline SVG spanning the wrapper: zero layout width, like the seam
// marks, so the row's own box is exactly what it would be with no tie at all. The glyph inside is drawn at its
// natural size in a viewBox one glyph wide, and `preserveAspectRatio="none"` then stretches THAT to the span —
// the same x-only stretch textLength gives the SVG notations, reached the only way an element whose width isn't
// known until layout can reach it. The viewBox height is the glyph's own ink height and .gw-h's CSS height is
// set to match in px, so the vertical scale stays exactly 1 (and stays 1 under the block's zoom:var(--fs),
// which scales both together).
function gwSlurHTML(container,ids,si){ if(!container) return;
  const b=gwTieBox(), H=b.asc+b.desc, w=document.createElement("span"); w.className="gw-h"; w.style.height=H+"px";
  const svg=document.createElementNS(SVGNS,"svg"); svg.setAttribute("class","gw-g"); svg.setAttribute("preserveAspectRatio","none");
  svg.setAttribute("viewBox",`0 0 ${b.w} ${H}`); if(si!=null&&ids){ svg.setAttribute("data-s",si); svg.setAttribute("data-gw",ids.join(" ")); }
  const e=E("text",{class:"gw-tie",x:0,y:b.asc,"text-anchor":"start"}); e.textContent=GW_TIE; svg.appendChild(e);   // y = b.asc → the ink top sits on the viewBox top edge
  w.appendChild(svg); container.appendChild(w); }
// applySel's membership test for a token cell: an ordinary cell answers for its own data-tok, a goeswith unit
// for EVERY part it draws — selecting either half of one word lights the whole word (and its slur), because
// the two halves are one word and share one annotation stack. Colour only, as everywhere else.
function gwHolds(el,tk){ const u=el.getAttribute("data-gw");
  return u ? u.split(" ").includes(String(tk)) : +el.getAttribute("data-tok")===tk; }
// …and the token any OTHER selection-driven marking should be attributed to. A goeswith continuation has no
// relation of its own to light up — the only edge it carries is the goeswith the renderers suppress — so the
// word's incoming relation is the HEAD's, and the subtree emphasis is the head's too. Selecting either half
// selects the word, so both must read off the head. Returns `tk` unchanged for every other token, and refuses a
// forward/self head so a malformed HEAD column can't send a caller round a loop.
function gwUnitId(si,tk){ const s=DOC[si]; if(!s||!s.tokens) return tk; const t=s.tokens[tk-1];
  if(!t||!isGoesWith(t.deprel)) return tk; const h=parseInt(t.head,10); return (h>=1&&h<tk)?h:tk; }
function gridFormFont(tk){ return isForeign(tk)?GRID_ITAL_F:GRID_F; }   // the grid Form cell's measurement font (column autosize, the wrap/expand thresholds)
function trFont(tk){ return isForeign(tk)?TRANS_UP_F:TRANS_F; }
// item 4 — in the SVG diagrams the Typo strikethrough is drawn as an EXPLICIT line appended to the token group
// AFTER the form text, so it paints IN FRONT of the glyphs (a strikethrough sits over the letters like a real
// strike), with pointer-events:none so it never intercepts a click on the token. Drawn as a line rather than a
// CSS text-decoration, it carries NO separate casing halo (the decoration's paint-order stroke was what read as
// "cased separately") — one clean line, cased together with the text. HTML views (outline/bwform) and inputs keep
// the CSS class. Colour tracks the form via .fmark's selection rules.
function svgMarks(g, cx, baseY, tk, font){ if(!g) return;
  if(!hasFeat(tk&&tk.feats,"Typo","Yes")) return;
  if(gwOf(tk).length) return;   // …but NOT on a goeswith head — for the same reason formDeco skips it there. The Typo=Yes the UD guidelines require on a goeswith head records the STRAY SPACE, and this line, sized by fmeas (now the whole unit's width), struck the entire word through: "with out" and "none the less" came out cancelled, as if the spelling were wrong rather than the spacing. The slur under the word is the mark for that
  const hw=fmeas(tk,font)/2+1, y=baseY-xHeight(font)/2;   // fmeas → the strike spans the ITALIC form's own width when the token is also Foreign. item 3: strikethrough at EXACTLY half the x-height (xHeight() measures the real glyph ascent of "x" at this font, not a guessed fraction of the font size)
  g.appendChild(E("line",{class:"fmark",x1:cx-hw,y1:y,x2:cx+hw,y2:y})); }
// item 2 — the POS tag AS DISPLAYED: the bare UPOS, plus any lexical subtype the token carries, dot-suffixed
// (PRON.Dem, DET.Poss, NOUN.Abbr) — the same dot-tag posSubItems sets. So a subtype set from the POS menu shows
// up on the tag in every diagram, not just in FEATS. UPOS_SUBTYPE_FEATS/subtypeSuffix are declared further down
// but only READ here at render time, long after the whole script has evaluated.
function posDisp(t){ if(!t||!t.upos) return (t&&t.upos)||""; let s=t.upos;
  UPOS_SUBTYPE_FEATS.forEach(f=>{ const v=getFeat(t.feats,f); if(v) s+="."+subtypeSuffix(f,v).toUpperCase(); }); return s; }   // UPPERCASE the suffix so it renders uniformly with the tag's c2sc small caps (the bare UPOS is already all-caps); the menu keeps the title-case value
// the transliteration ROW carries the DISPLAYED transliteration (never the original); active when a display scheme is on
function trLayer(){ return show.translit; }
// …and it is CLICK-EDITABLE (.tr-edit) whenever the click has something honest to bind to: with no script
// the row's own text is the romanisation; for Sanskrit under a script the row IS the stored IAST form
// (iastFormEdit); and where the romanisation is non-deterministic the click edits the STORED transliteration
// whatever the script is showing, because the value in MISC has to stay correctable (editStoredTransInline).
/* The cursor a token FORM takes. Under iastFormEdit() the glyph on screen is a derived, display-only rendering
   of the stored IAST — you cannot type into it, and the field a click opens is the IAST row beneath (see
   editNodeInline / editMWTInline, which route the click there). So it takes the POINTING hand: an I-beam over
   text that is not a text field promises an insertion point the glyph has no way to honour. Everywhere else the
   form IS the editable surface and keeps the I-beam, like .tr-edit / .gl-edit / .cform. Applies to single tokens,
   goeswith continuation parts and MWT surface forms alike — all three are rendered through bform(). */
function formCursor(){ return iastFormEdit()?"pointer":"text"; }
function trRowEdit(){ return !ORTHO_SCHEME || iastFormEdit() || (typeof storedTrEditable==="function" && storedTrEditable()); }
// row content = the selected DISPLAYED transliteration (display-transformed); skipped if it would duplicate the main glyph
function trTxt(o){ if(!o||!show.translit) return "";
  if(isSanskritLang() && orthoScript()){   // feature 7: Sanskrit's stored form IS the IAST — show it as the romanisation ROW beneath the script glyph (bform rendered that glyph FROM this very IAST). fillTranslit leaves o.translit empty here (IAST→IAST is a no-op in _iast()), so read the stored surface form directly.
    if(dandaGlyph((o.mform!=null)?o.mform:o.form)) return "";   // a daṇḍa punct mark: its script glyph needs no "|"/"‖" romanisation beneath it
    const iast=(o.miast!=null&&o.miast!=="")?o.miast:((o.mform!=null)?o.mform:o.form); return (iast && iast!==bform(o)) ? iast : ""; }   // an MWT carries its sandhi-fused IAST in o.miast (fillOrtho ← sanskrit_mwt.iast); prefer it so the romanisation ROW reads the fused form (ahorātra), not the naive concatenation stored in m.form (ahaḥrātra). Single tokens have no miast → fall back to the stored surface form as before.
  const r=dispScheme(o.translit||"",TRANSLIT_SCHEME); return (r && r!==bform(o)) ? r : ""; }
// item 7: the TOP-OF-BLOCK transliteration line is a property of the DISPLAYED transliteration, not the Script.
// Under Script=None the diagram borrows the translit as its main glyph (bform), which would make trTxt() see the
// row as redundant and drop the top line. Compare against the surface FORM instead so Script=None leaves it intact.
function topTransTxt(o){ if(!o||!show.translit) return ""; const r=dispScheme(o.translit||"",TRANSLIT_SCHEME); if(!r) return "";
  const ref=(ORTHO_SCHEME==="none") ? ((o.mform!=null)?o.mform:o.form) : bform(o); return (r!==ref) ? r : ""; }
function spaceAfterNo(tok){ return /(?:^|\|)SpaceAfter=No(?:\||$)/.test((tok&&tok.misc)||""); }   // CoNLL-U MISC SpaceAfter=No → no whitespace follows this token (default: a space follows)
// horizontal room a host's folded punctuation occupies to its inline-end, in font f: each mark's glyph plus one
// word space before it iff SpaceAfter allows one (p.sp). The layout reserves this so the marks take REAL space.
function hangForm(p){ return dandaGlyph(p.form)||p.form; }   // item 17: a daṇḍa punct mark shows the active Indic script's native glyph
function hangW(t,f){ if(!t.hangs||!t.hangs.length) return 0; const SPW=meas(" ",f); let w=0;
  t.hangs.forEach(p=>{ w+=(p.sp?SPW:0)+meas(hangForm(p),f); }); return w; }
/* item 6 — a Typo=Yes token may carry the intended spelling in MISC CorrectForm. It is drawn beside the
   struck-through form as a normal token (upright, undecorated), but it is a DISPLAY COMPANION, not a token of
   its own: no id, no POS/gloss rows, no arc endpoint. It therefore rides the SAME inline-end "tail" mechanism
   the folded-punctuation satellites already use — the node centre stays on the host, so arc geometry is
   untouched and only the reserved slot grows. It leads the tail, so it abuts the form it corrects rather than
   sitting past any punctuation folded onto that form. */
function correctFormOf(t){ return hasFeat(t&&t.feats,"Typo","Yes")?(miscKV(t&&t.misc,"CorrectForm")||""):""; }   // gated on Typo=Yes: a stale CorrectForm left behind by other tooling is not drawn unless the token still claims to be a typo
// CFORM_EDIT: {si,tokId} of a token whose CorrectForm is currently being edited inline (editCorrectFormInline,
// below) — while set, correctFormShown keeps drawing the (possibly momentarily EMPTIED, mid-edit) companion
// element for THAT token, so the floating input field always has a real, positioned DOM node to anchor over.
// Without this, clearing the field to blank would make correctFormOf() fall silent, the element would vanish
// on the next reflow, and the field would jump to (0,0) — the same class of bug the gloss/MSeg tiers avoid by
// always rendering (with a "…" placeholder) regardless of content.
let CFORM_EDIT=null;
/* A GOESWITH HEAD SHOWS NO CORRECT FORM. Its Typo=Yes marks the stray SPACE and its CorrectForm is the two
   halves joined — a statement the diagram ALREADY makes, by folding the halves under one slur. Printing
   "together" beside "to" as well says the same thing twice, in a notation that means something else (a
   misspelling of that one form). Suppressed at the DISPLAY sites only: correctFormOf itself still reads the
   feature, because the file, the exporter and captureMarks all legitimately need the value that is there. */
function correctFormShown(t,si,tokId){ if(gwOf(t).length) return false;
  return hasFeat(t&&t.feats,"Typo","Yes") && (!!miscKV(t&&t.misc,"CorrectForm") || !!(CFORM_EDIT&&CFORM_EDIT.si===si&&CFORM_EDIT.tokId===tokId)); }
// layout-reservation width: unlike correctFormShown (which also keeps the element alive while its text is
// momentarily empty, mid-edit), the SPACE reserved for it can just track correctFormOf(t) directly — an emptied
// value legitimately measures 0 width, matching what drawHangsSVG/appendHangHTML actually draw at that instant.
function cformW(t,f){ const cf=gwOf(t).length?"":correctFormOf(t); return cf?meas(" ",f)+meas(cf,f):0; }   // …and it reserves no width either: the measurement has to agree with correctFormShown above or the slot and the glyph part company
// the full inline-end tail of a token: its correct form (item 6) then its folded-punctuation satellites
function tailW(t,f){ return cformW(t,f)+hangW(t,f); }
// item 2 — the inline-START width: right-merging punctuation that LEADS a token (a word-space on its host side iff p.sp)
function leadW(t,f){ if(!t.leads||!t.leads.length) return 0; const SPW=meas(" ",f); let w=0; t.leads.forEach(p=>{ w+=(p.sp?SPW:0)+meas(hangForm(p),f); }); return w; }
// SVG: draw a host's folded punctuation as separate, selectable, unannotated <text> marks hanging off its inline-end
// (leftwards under RTL). Each mark abuts the previous element, or is one word space from it iff p.sp, and maps back
// to its original token for selection via pick(si, orig+1). Consecutive marks each get their own selectable <g>/<text>.
function satTok(si,oi){ const sn=(si!=null&&si>=0)?DOC[si]:null; return sn?sn.tokens[oi]:null; }   // items 2/3: a folded-punctuation satellite is a token in its OWN right (p.orig is its index in the UNMERGED sentence), so its Foreign/Typo marking comes from that token, never from the host it hangs off
/* data-host, on every satellite below (and on the correct-form companion): the ORIGINAL id of the token the mark
   is folded ONTO. Its own data-tok stays the mark's own id — that is what selects it — but the EMPHASIS LEVEL it
   recedes to is the host's, because a folded mark is drawn glued to the host's form and has no annotation of its
   own to recede independently; keyed by data-tok it took the level of the punctuation token, which under a
   `punct` edge is one step out from its host, so a satellite dimmed while the very word it hangs off was the
   selection. See the satellite block in applySel (js/core/document.js) for the level rule and for why it is
   applied relatively. */
function drawHangsSVG(parent,t,cx,y,f,cls,si,boxes,oid){ const show=correctFormShown(t,si,oid); if(!show&&!(t.hangs&&t.hangs.length)) return;
  const dir=RTL?-1:1, SPW=meas(" ",f); let cur=cx+dir*fmeas(t,f)/2;   // start flush at the host form's REAL inline-end edge. This used to reserve the BOLD half-width (max(f, '640 '+f)) so a selected host's satellites cleared its then-bolded form; selection no longer changes weight anywhere (see app.css's "SELECTED TOKEN TEXT" note), so that reserve only pushed the folded punctuation ~0.4-0.9px off the word it belongs to, on every token, for good
  const host=oid;   // the loop below shadows `oid` with each satellite's own id — keep the host's before it does
  if(show){ const cf=correctFormOf(t), cw=meas(cf,f), cxm=cur+dir*(SPW+cw/2);   // item 6: the correct form leads the tail, one word space from the struck-through form it corrects. cf may be "" mid-edit (correctFormShown keeps the element alive via CFORM_EDIT even then — see its own comment)
    const ce=E("text",{class:cls+" cform",x:cxm,y:y,"text-anchor":"middle","data-s":si,"data-tok":oid,"data-host":host}); ce.textContent=cf; if(cf)svgTip(ce,`correct form of “${bform(t)}”`); parent.appendChild(ce);   // the companion IS the host's own ink (same data-tok), but it is drawn at the diagram root like a satellite, so it needs data-host to be dimmed at all
    boxes&&boxes.push({x:cxm,y:y-8,hx:Math.max(cw/2,4),hy:12}); cur+=dir*(SPW+cw); }
  (t.hangs||[]).forEach(p=>{ if(p.sp) cur+=dir*SPW; const st=satTok(si,p.orig), pf=hangForm(p), mw=meas(pf,isForeign(st)?"italic "+f:f), mx=cur+dir*mw/2, oid=p.orig+1;   // a Foreign satellite renders italic like any other form, so it measures italic too
    const g=E("g",{class:"tok-group punct-sat"+(sel.s===si&&sel.t===oid?" sel":""),"data-s":si,"data-tok":oid,"data-host":host});
    const e=E("text",{class:cls+formDeco(st)+italDeco(st),x:mx,y:y,"text-anchor":"middle"}); e.textContent=pf; g.appendChild(e);
    g.style.cursor="pointer"; g.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,oid); }); parent.appendChild(g);
    boxes&&boxes.push({x:mx,y:y-8,hx:mw/2,hy:12}); cur+=dir*mw; }); }
// item 2 — SVG: the right-merging punctuation that LEADS a host, drawn flush to its inline-START (leftward LTR,
// rightward RTL). Nearest-to-host first (the last lead in reading order abuts the form), so iterate reversed.
function drawLeadsSVG(parent,t,cx,y,f,cls,si,boxes,host){ if(!t.leads||!t.leads.length) return;   // `host` = the ORIGINAL id of the token these marks lead, for the emphasis level — see drawHangsSVG's data-host note
  const dir=RTL?1:-1, SPW=meas(" ",f); let cur=cx+dir*fmeas(t,f)/2;   // start flush at the host form's REAL inline-start edge — the bold reserve dropped here for the same reason as in drawHangsSVG above
  [...t.leads].reverse().forEach(p=>{ if(p.sp) cur+=dir*SPW; const st=satTok(si,p.orig), pf=hangForm(p), mw=meas(pf,isForeign(st)?"italic "+f:f), mx=cur+dir*mw/2, oid=p.orig+1;   // the mark's own SpaceAfter → a gap on its host side
    const g=E("g",{class:"tok-group punct-sat"+(sel.s===si&&sel.t===oid?" sel":""),"data-s":si,"data-tok":oid,"data-host":host});
    const e=E("text",{class:cls+formDeco(st)+italDeco(st),x:mx,y:y,"text-anchor":"middle"}); e.textContent=pf; g.appendChild(e);
    g.style.cursor="pointer"; g.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,oid); }); parent.appendChild(g);
    boxes&&boxes.push({x:mx,y:y-8,hx:mw/2,hy:12}); cur+=dir*mw; }); }
// HTML (outline / wrapped brackets): the right-merging leads, APPENDED (in reading order) just before the host's
// own form is appended — so they sit inline-start of it. A word-space on the mark's host side iff p.sp.
function appendLeadHTML(container,t,si,cls,host){ if(!t.leads||!t.leads.length) return; const SPW=meas(" ",WORD_F);   // `host` — see drawHangsSVG's data-host note
  t.leads.forEach(p=>{ const oid=p.orig+1, s=document.createElement("span");
    s.className=(cls||"punctsat")+((sel.s===si&&sel.t===oid)?" sel":"")+formDeco(satTok(si,p.orig))+italDeco(satTok(si,p.orig)); s.textContent=hangForm(p);
    if(p.sp) s.style.marginInlineEnd=SPW+"px";
    s.dataset.s=si; s.dataset.tok=oid; if(host!=null)s.dataset.host=host; s.style.cursor="pointer";
    s.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,oid); }); container.appendChild(s); }); }
// HTML (outline / wrapped brackets): the same folded punctuation as separate, selectable inline spans beside the host.
function appendHangHTML(container,t,si,cls,oid){ const show=correctFormShown(t,si,oid); if(!show&&!(t.hangs&&t.hangs.length)) return; const SPW=meas(" ",WORD_F);
  const host=oid;   // the loop below shadows `oid`, exactly as in drawHangsSVG
  if(show){ const cf=correctFormOf(t), c=document.createElement("span"); c.className=(cls||"punctsat")+" cform"; c.textContent=cf;   // item 6: leads the tail, abutting the struck-through form. cf may be "" mid-edit — see correctFormShown
    c.style.marginInlineStart=SPW+"px"; if(cf)c.title=`correct form of “${bform(t)}”`; c.dataset.s=si; c.dataset.tok=oid; c.dataset.host=host; container.appendChild(c); }
  (t.hangs||[]).forEach(p=>{ const oid=p.orig+1, s=document.createElement("span");
    s.className=(cls||"punctsat")+((sel.s===si&&sel.t===oid)?" sel":"")+formDeco(satTok(si,p.orig))+italDeco(satTok(si,p.orig)); s.textContent=hangForm(p);
    if(p.sp) s.style.marginInlineStart=SPW+"px";
    s.dataset.s=si; s.dataset.tok=oid; s.dataset.host=host; s.style.cursor="pointer";
    s.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,oid); }); container.appendChild(s); }); }
function descent(f){_cv.font=f; const m=_cv.measureText("gjpqy"); return m.actualBoundingBoxDescent||3;}   // how far tokens hang below the baseline
function xHeight(f){_cv.font=f; const m=_cv.measureText("x"); return m.actualBoundingBoxAscent||6;}   // the x-height of a (POS) glyph — subtracted from the inter-tier step to seat the MWT bracket (POS tags now render via c2sc small caps, whose visual height sits at x-height, not full cap height)
// item 14: measure at the input's OWN computed font-size (driven by the --stext-fs CSS var) so the field width tracks the sentence-text size instead of a hardcoded px that could drift.
function sizeSid(inp){ const fs=(inp.isConnected&&getComputedStyle(inp).fontSize)||'13.2px'; inp.style.width=Math.ceil(meas(inp.value||inp.placeholder||"s?",fs+" ui-monospace, monospace"))+16+"px"; }
const SVGNS="http://www.w3.org/2000/svg";
function E(n,a){const e=document.createElementNS(SVGNS,n); for(const k in a) e.setAttribute(k,a[k]); return e;}
function svgTip(el,text){ if(text){ const t=document.createElementNS(SVGNS,"title"); t.textContent=text; el.appendChild(t); } return el; }   // SVG hover tooltip = a <title> CHILD (the title ATTRIBUTE doesn't surface a tooltip on SVG)

/* bézier helpers (ported) */
function bez(P,t){const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
  return [a*P[0][0]+b*P[1][0]+c*P[2][0]+d*P[3][0], a*P[0][1]+b*P[1][1]+c*P[2][1]+d*P[3][1]];}
function lerp(A,B,t){return [A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t];}
function splitAt(P,t){const A=lerp(P[0],P[1],t),B=lerp(P[1],P[2],t),C=lerp(P[2],P[3],t),D=lerp(A,B,t),Ee=lerp(B,C,t),F=lerp(D,Ee,t);
  return {left:[P[0],A,D,F], right:[F,Ee,C,P[3]]};}
function subCurve(P,t0,t1){ if(t0<=0&&t1>=1) return P; const r=splitAt(P,t0).right; const tt=t1>=1?1:(t1-t0)/(1-t0); return splitAt(r,tt).left; }
function trimT(P,end,R){const anc=end===0?P[0]:P[3], S=0.004;
  if(end===0){for(let t=0;t<=1;t+=S){const q=bez(P,t); if(Math.hypot(q[0]-anc[0],q[1]-anc[1])>=R) return t;} return 1;}
  for(let t=1;t>=0;t-=S){const q=bez(P,t); if(Math.hypot(q[0]-anc[0],q[1]-anc[1])>=R) return t;} return 0;}
function normv(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1; return [dx/L,dy/L];}
const AEXT=2;   // arrowheads overshoot the endpoint a touch so the visual tip reaches it
const AH_RATIO=0.6;   // arrowhead half-width / length → its half-angle is atan(AH_RATIO); the arc arrives at this angle so the arrowhead's lower edge is horizontal
function arrowPath(from,tip,s){const [ux,uy]=normv(from,tip),T=[tip[0]+ux*AEXT,tip[1]+uy*AEXT],px=-uy,py=ux,base=[T[0]-ux*s,T[1]-uy*s],w=s*AH_RATIO;
  return `M ${T[0]} ${T[1]} L ${base[0]+px*w} ${base[1]+py*w} L ${base[0]-px*w} ${base[1]-py*w} Z`;}
function backoff(tip,frm,d){const [ux,uy]=normv(frm,tip); return [tip[0]-ux*(d-AEXT), tip[1]-uy*(d-AEXT)];}   // stop a line at the (overshot) arrowhead base
function edgeAngle(x1,y1,x2,y2){let a=Math.atan2(y2-y1,x2-x1); if(a>Math.PI/2)a-=Math.PI; if(a<-Math.PI/2)a+=Math.PI; return a;}
function labelAngle(x1,y1,x2,y2){const a=edgeAngle(x1,y1,x2,y2); return Math.abs(a)>Math.PI/4?0:a;}   // steeper than 45° → horizontal label

/* merge-punctuation is a display transform: fold each punctuation mark OFF the adjoining token (drop it from the
   annotation token list so arcs/nodes/columns ignore it) but keep it, per host, as a `hangs` satellite entry
   {form, sp, orig}. Heads are remapped. Returns the display tokens plus map[displayIndex] = original token index
   (for selection sync with the grid); each hang carries its own original index for the satellite's selection. */
function displaySent(sent){
  const rtl=sentRTL(sent), mwt=sent.mwt||[];
  if(!show.mergePunct){ const D0=foldGoesWith({tokens:sent.tokens, map:sent.tokens.map((_,i)=>i), rtl, mwt}); D0.xpos=extPosSpans(D0); return D0; }   // the goeswith fold runs on BOTH paths — it is the relation's rendering, not an option
  const t=sent.tokens, disp=[], oldToDisp=new Array(t.length).fill(-1);
  /* item 2 — a punctuation token folds onto a neighbour. WHICH neighbour is decided by SPACING FIRST and by the
     dependency edge only when the spacing does not say:
       · the token before it has SpaceAfter=No (nothing between them) → the mark is ATTACHED to the left  → merge LEFT
       · the mark itself has SpaceAfter=No     (nothing after it)     → the mark is ATTACHED to the right → merge RIGHT
       · glued on both sides, or free on both  → no typographic answer → fall back to the head's direction
                                                 (head id > punct id → right, else left)
       · (a sentence-initial punct with no previous host stays a standalone token)
     THE EDGE USED TO DECIDE THIS ON ITS OWN, and that is the bug it caused: this fold is a TYPOGRAPHIC claim —
     "this mark is set solid against that word" — whereas a punctuation token's head is a syntactic choice the
     parser makes on quite different grounds. Type a comma after a word and re-parse, and the parser will
     commonly hang it off a head to its RIGHT (the clause it closes); the comma then flew across the space and
     glued itself to the following word, while SpaceAfter=No on the word before it said plainly that it belonged
     to the left. Spacing is the thing that actually knows where a mark sits, so spacing decides, and the edge —
     which is still the right answer when the marks are free-standing — is the tiebreak rather than the rule.
     The `sp` flag records whether a word-space sits on the host side of the mark: for a lead, the mark's OWN
     SpaceAfter; for a trailing satellite, the SpaceAfter of the token to its left (the gap before it). */
  let pendingLeads=[];   // right-merging puncts buffered until the next host token appears
  t.forEach((tk,i)=>{
    if(isPunct(tk)){
      const h=parseInt(tk.head,10);
      const gluedLeft=i>0&&spaceAfterNo(t[i-1]);            // no gap between the previous token and this mark
      const gluedRight=spaceAfterNo(tk);                    // no gap between this mark and whatever follows
      const right=(gluedLeft!==gluedRight)?gluedRight:(h>i+1);   // attached on exactly one side → that side wins; otherwise the edge
      if(right && i<t.length-1){ pendingLeads.push({form:tk.form, sp:!spaceAfterNo(tk), orig:i}); return; }   // leads the next token; sp = a gap after the mark, toward the host
      if(disp.length>0){ const last=disp[disp.length-1]; last.hangs.push({form:tk.form, sp:!spaceAfterNo(t[i-1]), orig:i}); oldToDisp[i]=disp.length-1; return; }   // edge points left (or 0/invalid) → trails the previous host
      // no previous host → fall through and push as a standalone token
    }
    const leads=pendingLeads; pendingLeads=[]; leads.forEach(p=>oldToDisp[p.orig]=disp.length);   // any buffered right-merging puncts lead this token
    oldToDisp[i]=disp.length; disp.push({tok:Object.assign({},tk),orig:i,hangs:[],leads});
  });
  pendingLeads.forEach(p=>{ oldToDisp[p.orig]=disp.length; disp.push({tok:Object.assign({},t[p.orig]),orig:p.orig,hangs:[],leads:[]}); });   // right-merging puncts with no following host (end of sentence) → their own tokens
  const tokens=disp.map(d=>{ const h=parseInt(d.tok.head,10); let nh=0;
    if(h>=1&&h<=t.length){ const dj=oldToDisp[h-1]; nh=dj>=0?dj+1:0; }
    return Object.assign({},d.tok,{head:String(nh),hangs:d.hangs,leads:d.leads,mform:d.tok.form}); });   // form stays host-only (mform===form); each hang/lead entry carries its glyph + original index for the satellite render + selection
  // remap MWT ranges onto the surviving display indices
  const dmwt=mwt.map(m=>{ const f=oldToDisp[m.from-1], to=oldToDisp[m.to-1]; return (f>=0&&to>=0)?Object.assign({},m,{from:f+1,to:to+1,_from:m.from,_to:m.to}):null; }).filter(Boolean);   // _from/_to = the ORIGINAL token ids (from/to are remapped to display order): _from for the edit lookup, _to so the tie can recognise the COMPONENT RANGE selRange holds — selRange is always in original ids (item 8, mwtTieSelected)
  const D=foldGoesWith({tokens, map:disp.map(d=>d.orig), rtl, mwt:dmwt}); D.xpos=extPosSpans(D); return D;   // item 1: ExtPos brackets are derived from the DISPLAY tokens (whose heads displaySent has just remapped), so a merged-punctuation view brackets exactly the tokens it actually draws. The goeswith fold runs FIRST for the same reason: a bracket must span the tokens actually drawn
}
/* Fold every goeswith CONTINUATION off the display token list onto the word it continues, mirroring the fold
   above (a folded token keeps a place in `map`, pointing at the display index that now draws it, so the grid
   selection sync still resolves it). Sets D.gw = one entry per unit, in display-index space, carrying the
   ORIGINAL ids of all its parts for the slur's selection test.
   A UNIT is a MAXIMAL RUN of tokens immediately after some token h, every one of them attached to h itself by
   `goeswith` — which is precisely the guideline's shape ("the head is always the first part, the OTHER PARTS
   are attached to IT"), so a three-part word is one unit rather than a chain. A goeswith whose head is not the
   token it directly follows is malformed under that rule and is deliberately left alone: it keeps its ordinary
   edge and label, which is the only honest way to show a relation the layout can't express.
   Heads pointing INTO a folded continuation are redirected to the unit's head — a continuation is not a node
   any more, and by the guideline it never carried anything for a dependent to attach to. */
function foldGoesWith(D){ const t=D.tokens, n=t.length, taken=new Array(n).fill(false), units=[];
  for(let i=0;i<n;i++){ if(taken[i]) continue; const parts=[];
    for(let j=i+1;j<n;j++){ if(!isGoesWith(t[j].deprel)||parseInt(t[j].head,10)!==i+1) break; parts.push(j); taken[j]=true; }
    if(parts.length) units.push({h:i,parts}); }
  if(!units.length){ D.gw=[]; return D; }
  const oldToDisp=new Array(n).fill(-1), keep=[];
  for(let i=0;i<n;i++){ if(taken[i]) continue; oldToDisp[i]=keep.length; keep.push(i); }
  units.forEach(u=>u.parts.forEach(p=>{ oldToDisp[p]=oldToDisp[u.h]; }));   // a continuation resolves to the cell that now draws it — the same contract a folded punctuation mark has
  const oid=i=>(D.map?D.map[i]:i)+1;   // the id in the UNMERGED sentence (merge-punctuation may already have folded this list once)
  const byHead={}; units.forEach(u=>byHead[u.h]=u);
  const tokens=keep.map(i=>{ const u=byHead[i], h=parseInt(t[i].head,10);
    const nh=(h>=1&&h<=n&&oldToDisp[h-1]>=0)?oldToDisp[h-1]+1:0;
    const o=Object.assign({},t[i],{head:String(nh)});
    if(u){
      // FOREIGN=YES BELONGS TO THE WORD, NOT TO A PART OF IT. A goeswith unit is one word that a stray space split,
      // so it is foreign or it is not — half a foreign word is not a thing, and a pair rendered with one half
      // italic and the other upright reads as two words of different provenance, which is the one thing the whole
      // rendering exists to deny. The flag is therefore taken from ANY part and applied to EVERY part (`_gwFrn`,
      // which isForeign consults). Two readings of a "half-foreign" pair are settled by that:
      //   · the flag on the HEAD alone — the normal, guideline-conformant case, since "only the first part can
      //     have a lemma and morphological features" and FEATS is where Foreign=Yes lives, so the head is the ONLY
      //     place the flag can honestly sit. It marks the whole word.
      //   · the flag on a CONTINUATION alone — annotation the guideline does not license (and which assigning
      //     goeswith now clears, see normGoesWith in js/editing/validation.js), but a file may already carry it.
      //     Read as the same claim about the same word rather than dropped on the floor: the marking is the user's,
      //     and the alternative would silently un-italicise a word they had flagged.
      // Set on a COPY of each part, never on the sentence's own token — this list is display state (the fold's
      // other output already is), and writing a derived flag into the document would put it in the file.
      const frn=isForeign(t[i])||u.parts.some(p=>isForeign(t[p]));
      if(frn) o._gwFrn=1;
      o._gw=u.parts.map(p=>({tok:frn?Object.assign({},t[p],{_gwFrn:1}):t[p],oid:oid(p)}));
      // MERGED PUNCTUATION, second fold: displaySent has ALREADY hung each punctuation mark off the token it
      // adjoins, and a mark after the last part of a goeswith word therefore hangs off a token this fold is about
      // to remove — the "." at the end of "none the less." simply vanished. The satellites move up to the word,
      // which is also the right answer on its own terms: the mark punctuates the WORD, not its final fragment,
      // and drawHangsSVG seats a trailing satellite at fmeas()'s inline end, i.e. past the whole unit.
      const hangs=(o.hangs||[]).slice(), leads=(o.leads||[]).slice();
      u.parts.forEach(p=>{ (t[p].hangs||[]).forEach(x=>hangs.push(x)); (t[p].leads||[]).forEach(x=>leads.push(x)); });   // reading order: the head's own satellites first, then each part's in turn
      if(hangs.length) o.hangs=hangs; if(leads.length) o.leads=leads; }
    return o; });
  const remap=m=>{ const _f=m._from!=null?m._from:m.from, _t=m._to!=null?m._to:m.to,
    f=oldToDisp[m.from-1], to=oldToDisp[m.to-1];
    return (f>=0&&to>=0)?Object.assign({},m,{from:f+1,to:to+1,_from:_f,_to:_t}):null; };   // an MWT range whose ends land inside a folded unit collapses onto the unit's own cell — the tie then spans the whole word, which is what it means
  return {tokens, map:keep.map(i=>D.map?D.map[i]:i), rtl:D.rtl, mwt:(D.mwt||[]).map(remap).filter(Boolean),
    gw:units.map(u=>({at:oldToDisp[u.h]+1, ids:[oid(u.h)].concat(u.parts.map(oid))}))};
}
// item 1 — one bracket per token carrying ExtPos, spanning that token's own subtree, in DISPLAY-index space.
// Sorted outermost-first at a shared left edge so a nested pair reads in the order the brackets nest.
function extPosSpans(D){ const t=D.tokens||[]; if(!t.some(x=>extPosOf(x))) return [];
  const sent={tokens:t}, out=[];
  t.forEach((tk,i)=>{ const v=extPosOf(tk); if(!v) return; const sp=subtreeSpan(sent,i+1);
    out.push({from:sp.from, to:sp.to, pos:v, tok:i+1, _tok:(D.map?D.map[i]:i)+1}); });   // _tok = the id in the UNMERGED sentence, for click-through / menu targeting
  return out.sort((a,b)=>(a.from-b.from)||(b.to-a.to)); }

/* structure */
function structure(sent){
  const t=sent.tokens,n=t.length,head=t.map(x=>parseInt(x.head,10)),children=t.map(()=>[]); let root=-1;
  for(let i=0;i<n;i++){const h=head[i]; if(h===0||isNaN(h)||h<1||h>n){if(root<0)root=i;} else children[h-1].push(i);}
  const depth=t.map(()=>0),seen=new Set();
  function d(i,dd){if(seen.has(i))return; seen.add(i); depth[i]=dd; children[i].forEach(c=>d(c,dd+1));}
  for(let i=0;i<n;i++){const h=head[i]; if(h===0||isNaN(h)||h<1||h>n) d(i,0);}
  for(let i=0;i<n;i++) if(!seen.has(i)) d(i,1);
  return {head,children,depth,root:root<0?0:root};
}
/* item 7 — MISC Reported=Yes on a node marks its whole subtree as reported speech, drawn on its own slightly
   displaced plane so the quoted stretch reads as stepping off the main line. Nesting is meaningful: a report
   inside a report steps off again, so the displacement is per-token and CUMULATIVE in the number of Reported
   ancestors (itself included), not a flat on/off. The arcs and the constituent line stay where they are — it is
   the tokens that leave the plane, which is what makes the step visible at all. */
function isReported(t){ return miscKV(t&&t.misc,"Reported")==="Yes"; }
// how many Reported=Yes nodes dominate (or ARE) each display token: 0 on the ordinary plane, 1 inside a report,
// 2 inside a report inside a report, …
function reportDepths(D){ const t=D.tokens||[], n=t.length, dep=new Array(n).fill(0);
  if(!t.some(isReported)) return dep;                                  // the overwhelmingly common case — no structure() walk at all
  const {children}=structure({tokens:t}), seen=new Set();
  const walk=(i,acc)=>{ if(seen.has(i))return; seen.add(i);
    const a=acc+(isReported(t[i])?1:0); dep[i]=a; children[i].forEach(c=>walk(c,a)); };
  for(let i=0;i<n;i++){ const h=parseInt(t[i].head,10); if(!(h>=1&&h<=n)) walk(i,0); }   // every root (head 0 / out of range)
  for(let i=0;i<n;i++) if(!seen.has(i)) walk(i,0);                     // anything left over sits in a cycle — treat it as its own root rather than drop it
  return dep; }
function reportStep(){ const v=parseFloat(css("--report-step")); return isFinite(v)?v:5; }
// the vertical offsets, in px, for each display token — what the renderers add to their word baseline
function reportOffsets(D){ const st=reportStep(); return reportDepths(D).map(d=>d*st); }
/* item 11 — THE ONE PLACE THAT DECIDES HOW REPORTED SPEECH MOVES A LINE OF THE DIAGRAM, so the flat arc view
   (arcs(), js/diagram/diagram-render.js) and the wrapped one (arcsWrapped(), js/diagram/diagram-wrap.js) cannot
   disagree about it. They HAD disagreed: the flat view lifted the arc ENDPOINTS with their words, the wrapped one
   lifted only the words and left every arc pinned to the line, so the same tree read as "reported" in one view and
   as a layout error in the other. That is exactly the failure this codebase has been bitten by before — two
   hand-copied bodies of one operation drifting until one silently lost a call — so the decision lives here and
   both renderers call in.
     repBase  — ONE line-relative y (a word baseline, an arc-endpoint baseline, a root stub's foot, a stack
                bottom): token i steps UP off `base` by its own cumulative report depth.
     repArcEnds — an ARC's pair of endpoints plus its crown: each end keeps its OWN lifted baseline, and the crown
                is measured from the HIGHER (more lifted) of the two, so an arc with one end inside a report and
                one outside keeps its full height above the raised end rather than being squashed under it. With
                no reported token anywhere both reduce to the un-lifted values, so unreported documents draw
                byte-identically. */
function repBase(rep,base,i){ return base-((rep&&rep[i])||0); }
function repArcEnds(rep,base,hi,di,h){ const y1=repBase(rep,base,hi), y2=repBase(rep,base,di);
  return {y1,y2,apexY:Math.min(y1,y2)-ARC_APEX*(h||0)}; }   // ARC_APEX (0.75): the symmetric Hobby bump's VISIBLE peak, not its handle height — see the constant's own note in js/diagram/diagram-wrap.js
function linear(sent, depAbove){const gap=8,pad=2,SP=meas(" ",WORD_F),tk=sent.tokens;
  // the word's own ink-width alone — an MWT tie hugs THIS, not the wider annotated slot below (POS/translit/gloss
  // sit in their own independent row and shouldn't stretch a tie meant to visually group surface-form parts)
  const wform=tk.map(t=>Math.max(fmeas(t,WORD_F), fmeas(t,WORD_F_BOLD)));
  // slot = widest of word and (when shown) POS/transliteration/above-token deprel; uniform spacing → same minimum gap as tokens
  const w=tk.map((t,i)=>Math.max(wform[i], show.pos?meas(posDisp(t),POS_F):0, trLayer()?meas(trTxt(t),trFont(t)):0, depAbove?meas(t.deprel||"",POS_F):0, glossSlotW(t), 16));   // item 13: fold in the gloss-tier rows so a wide gloss can't crowd/overlap its neighbour. Bold width (.tok-word.sel) reserved for EVERY token, not just the selected one — the token that's bold can change without a layout re-run (no reflow-on-select path here, unlike brackets), so the slot must already fit either state
  const hg=tk.map(t=>tailW(t,WORD_F));   // real-width room reserved to each host's inline-end for its folded punctuation (node centre c[i] stays on the host, so arc endpoints are unchanged)
  const ld=tk.map(t=>leadW(t,WORD_F));   // item 2: room reserved at the host's inline-START for right-merging punctuation that leads it
  // Subj=Generic: reserve a virtual ∅-token band just BEFORE this token's own slot (not widening the slot itself,
  // so c[i] keeps meaning "this token's own centre" — arc endpoints stay exactly where they belong; the ∅ simply
  // gets real space inserted ahead of it, like inserting a real token would).
  const c=[]; c[0]=pad+genericSubjGapW(tk,0)+ld[0]+w[0]/2;
  for(let i=1;i<tk.length;i++) c[i]=c[i-1]+w[i-1]/2+hg[i-1]+SP+gap+genericSubjGapW(tk,i)+ld[i]+w[i]/2;
  const total=c[tk.length-1]+w[tk.length-1]/2+hg[tk.length-1]+pad;
  return {c,w,wform,total};   // caller mirrors after any label-spacing pass
}
/* stemma columns are sized to the widest of node-label and baseline word, so same-level nodes never collide */
// #5 — shared "tidy" hierarchy layout used by BOTH the unwrapped hierarchy tree() and the wrapped-hierarchy
// geometry treeGeomW(), so the two can never drift (this recursive pack/centre/separate algorithm used to be
// copied verbatim in each): pack leaves left-to-right at NGAP, centre each parent over its children, then push
// adjacent sibling SUBTREES apart only as far as their node boxes (lw/hgw/ldw) OR their incoming edge-labels
// (elw) require. size = node count, root = root index, childrenOf(i) = child indices; the metrics are per-index
// width accessors. Returns the array of node x-centres — the caller derives natural width / depth / RTL mirror.
function tidyLayout(size,root,childrenOf,{lw,hgw,ldw,elw,SPW,NGAP}){
  const x=new Array(size).fill(0); let cur=6;
  function shift(i,dx){ x[i]+=dx; childrenOf(i).forEach(c=>shift(c,dx)); }
  (function place(i){ const ks=childrenOf(i).slice().sort((a,b)=>a-b);
    if(!ks.length){ x[i]=cur+ldw(i)+lw(i)/2; cur+=ldw(i)+lw(i)+hgw(i)+NGAP; return; }   // item 2: leading-satellite room before the node
    ks.forEach(place);
    for(let j=1;j<ks.length;j++){ const a=ks[j-1],b=ks[j],
      need=Math.max(lw(a)/2+hgw(a)+ldw(b)+lw(b)/2+NGAP, elw(a)+elw(b)+4*SPW), have=x[b]-x[a];   // widest of the node-box separation and the sibling edge-label clearance (~2 word spaces)
      if(have<need-0.5){ const dx=need-have; for(let m=j;m<ks.length;m++) shift(ks[m],dx); cur+=dx; } }
    x[i]=(x[ks[0]]+x[ks[ks.length-1]])/2; })(root);
  return x;
}
function stemmaLayout(sent,catNodes,posBelow){const pad=2, SP=meas(" ",WORD_F)+8;   // gap matches arc view; slot also fits the baseline POS tag so they don't crowd
  const lw=sent.tokens.map(t=>Math.max(fmeas(t,WORD_F),fmeas(t,WORD_F_BOLD),catNodes?meas(posDisp(t)||"X",POS_F):fmeas(t,NODE_F),catNodes?0:fmeas(t,NODE_F_BOLD), posBelow?meas(posDisp(t)||"X",POS_F):0, trLayer()?meas(trTxt(t),trFont(t)):0, glossSlotW(t)));   // item 13: include the gloss-tier width so glosses stay spaced. Bold width reserved for the baseline word AND (when the node itself shows the word, not a POS category — catNodes' .node-cat never bolds on single selection) the node label too, for every token — see linear()'s own comment on why
  const c=[]; let x=pad; sent.tokens.forEach((t,i)=>{ x+=genericSubjGapW(sent.tokens,i,catNodes?POS_F:NODE_F)+leadW(t,NODE_F); c.push(x+lw[i]/2); x+=lw[i]+tailW(t,NODE_F)+SP; });   // reserve inline-START room for right-merging leads (item 2) + inline-end room for trailing satellites; node centre stays on the host (arc endpoints unchanged). Subj=Generic: a virtual ∅-token band inserted just before, same idea as linear()
  const total=x-SP+pad;
  return {c,total,lw};   // caller mirrors after any label-spacing pass
}
function mirror(c,total){ if(RTL) for(let i=0;i<c.length;i++) c[i]=total-c[i]; }   // in-place RTL flip of x-centres
/* transliteration + POS stacked below a word baseline; returns the bottom y (pushes hit-boxes) */
function hasTr(toks){ return trLayer() && toks.some(x=>trTxt(x)); }   // the transliteration row is active (romanisation, or originals under an orthography) → reserve it for every token (keeps POS aligned)
function belowStack(g,x,y0,tk,boxes,trRow){ let y=y0;   // trRow: reserve the transliteration row even for a token that has none (so POS stays aligned across the sentence)
  const showTr = trRow!=null ? trRow : (trLayer() && !!trTxt(tk));
  if(showTr){ y+=18+descent(POS_F); const rt=trTxt(tk); if(rt){ const e=E("text",{class:"translit"+frnUp(tk),x:x,y:y,"text-anchor":"middle"}); e.textContent=rt; if(trRowEdit())e.classList.add("tr-edit"); g.appendChild(e); boxes&&boxes.push({x,y:y-4,hx:meas(rt,trFont(tk))/2,hy:7}); svgSeamMark(g,tk,x,y,meas(rt,trFont(tk))/2,trFont(tk),boxes,null,"translit"); } }   // Item 8: the translit row gains the SAME descender-matched top gap the POS row carries (+descent(POS_F), the label-font descender) so the row above's descenders don't crowd it; .tr-edit → click-to-edit the romanisation, or the STORED transliteration behind it (see trRowEdit). The romanisation is a WORD-LIKE row, so it carries the seam mark too — a word broken across tokens reads as broken on every row that spells it out
  belowTiers().forEach(tier=>{ y+=18+descent(POS_F); const txt=tierText(tk,tier); const e=E("text",{class:"gloss gl-edit"+frnUp(tk),x:x,y:y,"text-anchor":"middle","data-tier":tier,tabindex:"0"}); setGlossText(e,tier,txt||"…"); if(!txt)e.classList.add("gl-empty"); g.appendChild(e); boxes&&boxes.push({x,y:y-4,hx:meas(txt||"…",trFont(tk))/2,hy:7});
    if(tier==="mseg"&&txt) svgSeamMark(g,tk,x,y,meas(txt,tierFont(tier,tk))/2,tierFont(tier,tk),boxes,null,"mseg"); });   // Item 8: each gloss / morphemic-gloss tier gains the SAME +descent(POS_F) top gap as the POS row, so all sub-token tiers share the descender-based breathing room; BELOW the transliteration and ABOVE the POS row; double-click or Enter to edit → MISC. Only the SEGMENTATION tier takes a seam mark (and only once it has text to hang it off) — the gloss tiers state a meaning, not a piece of the word
  if(show.pos && tk.upos){ y+=18+descent(POS_F); const pd=posDisp(tk); const e=E("text",{class:"tok-pos",x:x,y:y,"text-anchor":"middle"}); e.textContent=pd; svgTip(e,posTitle(tk.upos)); g.appendChild(e); boxes&&boxes.push({x,y,hx:meas(pd,POS_F)/2,hy:6}); }   // POS hover tooltip (Item 2). Item 1: +descent(POS_F) extra top gap on the POS step — the label font's (POS_F) descender depth, mirroring how the above-token rows fold in descent(WORD_F) — so the POS row isn't crowded by the descenders of the row above it. Every below-reserve that feeds a row height (stackH / belowH / stackBot / --undpad) folds in the SAME descent(POS_F), so POS stays aligned across renderers and nothing clips.
  return y;
}
/* multi-word tokens: a rounded tie under the baseline spanning the fused words, carrying the surface form.
   Item 1 folds the ExtPos brackets into the SAME stack: they are the same graphical element (an MWT-style
   bracket with a label under it), differing only in what the label is, so they share the geometry, the casing
   halo and the vertical tiering rather than being drawn by a parallel routine that could drift out of step. */
// One bracket row per tie to draw, tier-assigned so an ExtPos bracket and an MWT tie can never collide:
//   · SAME span  → ONE bracket. The MWT keeps its surface form and simply gains a POS annotation beneath it
//                  (the ExtPos value) — no second bracket over the identical tokens.
//   · OVERLAPPING → the ExtPos bracket holds the top tier (it is the one the POS tags above it belong to) and
//                  the MWT tie steps down a tier, out of its way.
//   · disjoint   → both sit on the top tier, side by side.
//   · a GOESWITH slur joins the innermost thing there is — the parts of ONE word, which the fold has already
//     collapsed onto ONE display slot — so it holds the top tier unconditionally and anything overlapping it
//     (an MWT bracket or an ExtPos bracket over a span that CONTAINS the word) steps down out of its way. The
//     two marks then read as what they are: the word's own join, with the wider grouping bracketed beneath it.
function tieRows(D){ const gw=(D.gw||[]).map(g=>({from:g.at,to:g.at,ids:g.ids,kind:"gw",pos:"",tier:0}));
  const ovGw=(a,b)=>gw.some(g=>g.from<=b&&g.to>=a);
  const xp=(D.xpos||[]).map(x=>({from:x.from,to:x.to,pos:x.pos,tok:x.tok,_tok:x._tok,kind:"xpos",tier:ovGw(x.from,x.to)?1:0}));
  const rows=gw.concat(xp);
  (D.mwt||[]).forEach(m=>{ const same=xp.find(x=>x.from===m.from&&x.to===m.to);
    if(same){ same.kind="mwt"; same.m=m; return; }                                        // coincides → the ExtPos row BECOMES the MWT row, keeping its pos as the annotation
    const clash=xp.filter(x=>x.from<=m.to&&x.to>=m.from);
    rows.push({from:m.from,to:m.to,kind:"mwt",m,pos:"",tier:Math.max(ovGw(m.from,m.to)?1:0,0,...clash.map(x=>x.tier+1))}); });   // with no goeswith in the sentence every xpos tier is 0, so this is exactly the former `clash?1:0`
  return rows.sort((a,b)=>(a.tier-b.tier)||(a.from-b.from)); }
// Lay the bracket tiers out ONCE — each row gets the y-offsets of its own tie top, label baseline, optional
// transliteration row and optional ExtPos annotation; the block reports the total depth it occupies. mwtTie
// (which draws) and mwtDepth (which reserves the room) both read this, so the two can never drift apart.
// Offsets are measured from the y mwtTie is handed (the below-stack bottom + 5); `lead` is the gap that seats
// the FIRST tie body one POS-descender below the POS baseline (see the seating note on mwtTie below).
// the gap that seats the first tie body one POS-descender below the POS baseline, factored out so the two
// notations with NO tie layer of their own (the hierarchy's tree nodes, the outline's inline rows) can seat a
// goeswith slur by the same rule the ties use rather than inventing a second constant
function tieLead(){ const PIN=5; return show.pos ? 18+descent(POS_F)-xHeight(POS_F)-5-PIN : 8; }
function tieLayout(D){ const rows=tieRows(D); if(!rows.length) return {rows:[],depth:0,lead:0};
  const PIN=5, STEP=18+descent(POS_F), lead=tieLead();
  let top=0, deepest=0;
  for(let tier=0;;tier++){ const inTier=rows.filter(r=>r.tier===tier); if(!inTier.length) break;
    let bot=top;
    inTier.forEach(r=>{ r.dy=top;
      if(r.kind==="gw"){ r.dfy=0; r.dtr=0; r.dpos=0; bot=Math.max(bot,top+gwDepth()); return; }   // a tie carries NO label (the relation is marked by the mark alone), so its row is only as deep as the glyph's own ink
      r.dfy=top+PIN+20;                                                                   // tie body PIN below the top; the label baseline a further 20 below it
      r.dtr=(r.kind==="mwt"&&trTxt(r.m))?r.dfy+STEP:0;                                     // an MWT's own transliteration row
      r.dpos=(r.kind==="mwt"&&r.pos)?((r.dtr||r.dfy)+STEP):0;                              // …and, on a coinciding pair, the ExtPos annotation LAST — form → translit → POS, the same order a plain token's below-stack uses
      bot=Math.max(bot, r.dpos||r.dtr||r.dfy); });
    deepest=bot; top=bot+STEP; }                                                           // the next tier starts one inter-tier step below the deepest label of this one
  return {rows, depth:PIN+lead+deepest+1, lead}; }                                          // depth is measured from the below-stack bottom: +PIN for the y offset mwtTie is handed, +1 slack — for a lone plain MWT tie this reproduces the former fixed 39+descent−xHeight exactly
/* item 8 — A SELECTED MULTI-WORD TOKEN. There is no separate "this MWT is selected" flag to invent: clicking a tie
   row runs selectMWTRange (setRange(si,m.from,m.to) + pick), so the MWT's COMPONENT RANGE being the current range
   selection IS the state, for every route in alike (the tie glyph, the IAST row, the right-click menu). Matching
   BOTH ends keeps an ordinary marquee that merely happens to start at the same token from lighting a tie it doesn't
   cover. selRange always holds ORIGINAL token ids, which is why the display MWT records carry _from/_to.
   The one exception is while the surface form is being EDITED: editMWTInline selects the range and THEN opens a
   field over the tie, and makeEditable copies the edited element's COMPUTED INK into that field — so an accented
   tie would hand the input a blue `color` and the text would sit blue for the whole edit, reading as selection
   rather than as a field. MWT_EDIT names the tie whose editor is open; context-menu.js clears it and re-runs
   applySel() on commit/cancel, so the accent comes straight back. */
let MWT_EDIT=null;   // {si, from} — the MWT whose surface form currently has an inline editor open (original token id)
function mwtTieSelected(si,fromId,toId){ if(!(si>=0)||fromId==null) return false;
  if(MWT_EDIT&&MWT_EDIT.si===si&&MWT_EDIT.from===fromId) return false;   // being edited → not "selected but at rest"
  return !!(selRange&&selRange.s===si&&selRange.from===fromId&&(toId==null||selRange.to===toId)); }
// the ORIGINAL token ids of a tie row's MWT (null for an ExtPos-only bracket, which owns no MWT and never accents)
function tieOrigIds(r){ const m=r&&r.m; if(!m||r.kind!=="mwt") return null;
  return {from:(m._from!=null?m._from:m.from), to:(m._to!=null?m._to:m.to)}; }
/* WHICH EMPHASIS LEVEL A TIE TAKES (the .dim-peri/.dim-out scale — see selEmphasis in js/core/document.js and the
   three-level note in styles/app.css). A tie is not a token: it is a BRACKET OVER A SPAN, and the tokens it spans
   need not all land in the same band — one component can be core while another is only periphery, or outside the
   subtree altogether. The rule is THE DIMMEST CELL THE TIE SPANS, for two reasons:
     · Honesty. The bracket asserts one grouping over its whole span. If part of that span has receded, the
       grouping has not wholly survived into the selection's subtree, and drawing it at the brightness of its
       brightest component would advertise a group as core when half of it is not. A bracket can no more stand
       out from the material it brackets than a seam mark can stand out from the word it is a boundary in — which
       is the same "dimmer of the two" rule the seam marks already follow (see applySel), reached the same way.
     · It cannot invert. max() over the components is monotone, so a tie is never brighter than something it
       covers, in any tree, projective or not.
   Measured over CELLS, not raw ids: a goeswith continuation is not a node of its own (it has no subtree, and its
   emphasis is its head's — gwUnitId), and the renderers draw the whole unit as ONE cell at ONE level, so a tie
   spanning it must read it as its word. That makes this one rule cover both marks: an MWT bracket spans several
   cells and can therefore straddle bands, while a goeswith slur spans exactly one (its own word) and takes that
   cell's level — which is also exactly what it INHERITS in the outline, the one notation that draws the slur
   inside the row rather than into the diagram root (see the .gw-g branch in applySel, js/core/document.js).
   `ids` are ORIGINAL token ids, the space selRange and selEmphasis both speak. */
function tieDimLevel(EM,si,ids){ if(!EM||si!==sel.s||!ids||!ids.length) return 0;
  let lv=0; for(const id of ids){ const u=gwUnitId(si,id);
    lv=Math.max(lv, EM.core.has(u)?0:(EM.peri.has(u)?1:2)); if(lv===2) break; }
  return lv; }
/* …and the class for it, at DRAW time. Every tie also rides applySel()'s live class toggle (which is what tracks a
   marquee drag without a re-render); this is only the initial state, needed for the same reason the .sel class is
   computed here — the wrapped-brackets ties are drawn by positionBracketAnnots, which renderDoc runs AFTER
   applySel, so a tie created then would otherwise sit undimmed until the next selection change.
   `selected` short-circuits it to full strength: an accented tie must never ALSO be dimmed, or the accent would
   read as "selected, and yet outside the selection". Today that guard is provably redundant — a tie accents only
   when selRange is exactly its component range (mwtTieSelected), or, for a slur, when one part of its one word is
   the selection, and selEmphasis puts every selected token in `core` — but it pins the invariant against a future
   loosening of either rule rather than leaving it to be re-derived. */
function tieDimClass(si,ids,selected){ if(selected||typeof selEmphasis!=="function") return "";
  const lv=tieDimLevel(selEmphasis(),si,ids); return lv===1?" dim-peri":lv===2?" dim-out":""; }
function tieIdRange(from,to){ const a=[]; for(let k=from;k<=to;k++) a.push(k); return a; }   // an MWT's components are consecutive ids by CoNLL-U's own definition of a range line
/* WHAT THE BRACKET HUGS: `wform` — the word's OWN ink width — which is what every caller passes and what the
   comment at wform's own definition asks for. Not the wider annotated slot below (POS, gloss, transliteration):
   the tie groups surface-form parts, so it is sized by the forms.
   MEASURED, because it reads as misaligned under a Sanskrit script and the cause is worth recording rather than
   re-investigating. On `rāmaḥ vanaṃ` with Devanagari displayed, the tie spans 10.9…93.3 and the FORM ink
   13.7…90.8 — hugging it to within the ±2 padding, i.e. exactly right. What overhangs it is the transliteration
   row beneath, 2.5…105.2, because Devanagari is markedly narrower than its own romanisation. Nothing is
   mis-computed; the tie simply brackets the forms and the romanisation is wider than the forms.
   (A variant that widened the tie to whichever row is wider under iastFormEdit() was built and measured — tie
   0.5…107.2, enclosing the romanisation — and rejected: hugging the form ink is the intended behaviour.) */
function mwtTie(svg,c,w,D,y,boxes,si){ const PIN=5, L=tieLayout(D); if(!L.rows.length) return; y+=L.lead;
  L.rows.forEach(r=>{ const a=r.from-1,b=r.to-1; if(a<0||b>=c.length||a>b)return;
  const mark0=svg.childNodes.length;   // item 8: everything this row appends from here on is MOVED into one .mwt-g group at the end (below) — recorded rather than re-pointing a dozen appendChild calls at a group, so the drawing order (casing → tie → rows → form last) stays exactly as written
  const x0=Math.min(c[a]-w[a]/2,c[b]-w[b]/2)-2, x1=Math.max(c[a]+w[a]/2,c[b]+w[b]/2)+2, mx=(x0+x1)/2, dp=PIN, ty=y+r.dy;
  if(r.kind==="gw"){ gwSlurSVG(svg,x0+2,x1-2,ty,si,r.ids,boxes); return; }   // the goeswith slur ends ON the word's ink (w[] is the FORM width, and the unit's whole form at that), not on the ±2 the bracket pads itself by — a slur hugs its notes
  const tieD=`M ${x0} ${ty} L ${x0} ${ty+dp} L ${x1} ${ty+dp} L ${x1} ${ty}`;
  svg.appendChild(E("path",{class:"mwt-tie-cas",d:tieD}));   // occlusion halo first, so a cross-line arc crossing the tie is cleanly broken
  svg.appendChild(E("path",{class:"mwt-tie",d:`M ${x0} ${ty} L ${x0} ${ty+dp+0.5625} M ${x1} ${ty+dp+0.5625} L ${x1} ${ty}`}));   // end-pins: the full weight — each extends 0.5625px (half the bar's own .75·--arc-stroke width, --arc-stroke now 1.5px → bar 1.125px — item 1) PAST the bar's centreline so its (thicker) stroke fully covers the corner the (thinner) bar's stroke reaches, instead of butting flush and leaving a notch
  svg.appendChild(E("path",{class:"mwt-tie-h",d:`M ${x0} ${ty+dp} L ${x1} ${ty+dp}`}));   // the horizontal bar, drawn thinner — per psychophysics, a horizontal stroke reads heavier than a vertical one of the same width
  // item 1 — an ExtPos-only bracket: the value itself IS the label, drawn in the POS register (.mwt-pos matches
  // .tok-pos), over the same opaque backing the MWT form gets so a crossing line is occluded cleanly.
  if(r.kind==="xpos"){ const fy=y+r.dfy;
    drawTieLabel(svg,mx,fy,r.pos,"mwt-pos","mwt-pos-cas",POS_F,boxes);
    if(si!=null) tagXPosLabel(svg.lastElementChild,si,r); return; }   // returns BEFORE the .mwt-g wrap below on purpose: an ExtPos-only bracket owns no multi-word token, so there is no component range for it to be "selected" by (item 8) — its own label is already click-selectable via tagXPosLabel
  const m=r.m, mfd=bform(m);   // item 8/9: honour the selected SCRIPT (and, for Sanskrit, the sandhi-fused reconstruction) — via m.ortho, exactly like single tokens
  const fy=y+r.dfy;
  const fromId=m._from!=null?m._from:m.from;   // the ORIGINAL token id — m._from when a display fold (merge-punctuation) has remapped from/to into DISPLAY order — because editMWTInline and the tie's menus both look the MWT up in s.mwt by that original id
  // Under iastFormEdit() (Sanskrit + a real script) the tie's glyph is a DERIVED, display-only rendering of the
  // stored IAST, exactly as a single token's is — so the SAME rule applies here: the romanisation ROW below is
  // the editable field and the glyph above is select-only. Both rows carry the {data-s, data-mwtfrom} pair, so
  // the delegated click/contextmenu handlers resolve the MWT from either one and decide which may open an editor.
  const iastRow=iastFormEdit();
  const mrt=trTxt(m); if(mrt&&r.dtr){ const tr=E("text",{class:"translit"+(iastRow?" mwt-tr-edit":""),x:mx,y:y+r.dtr,"text-anchor":"middle"}); tr.textContent=mrt; svg.appendChild(tr);   // Item 9: draw the MWT transliteration row FIRST, so the MWT form (and its opaque backing) below paints ON TOP where the two rows crowd — mirrors how .stext is raised above .strans
    if(si!=null&&iastRow){ tr.setAttribute("data-s",si); tr.setAttribute("data-mwtfrom",fromId); tr.style.cursor="text";   // tagged ONLY under iastFormEdit(): everywhere else this row is a plain romanisation of the surface form (m.translit), nothing writes it back, and the surface form itself is already the editable field.   // cursor:text, not pointer — this row IS a text field you type into, so it takes the same I-beam the other click-to-edit diagram texts carry (.tr-edit / .gl-edit / .cform, all cursor:text in app.css). A pointer would promise a button.
      svgTip(tr,"multi-word token — click to edit the surface form (the script glyph above is derived from it)"); }
    boxes&&boxes.push({x:mx,y:y+r.dtr-4,hx:meas(mrt,TRANS_F)/2,hy:7}); }
  if(r.pos&&r.dpos){ drawTieLabel(svg,mx,y+r.dpos,r.pos,"mwt-pos","mwt-pos-cas",POS_F,boxes);   // item 1: the coinciding-span case — the MWT bracket simply gains the ExtPos as a POS annotation instead of a second bracket being drawn over the same tokens
    if(si!=null) tagXPosLabel(svg.lastElementChild,si,r); }
  const cas=E("text",{class:"mwt-cas",x:mx,y:fy,"text-anchor":"middle"}); cas.textContent=mfd; cas.setAttribute("aria-hidden","true"); svg.appendChild(cas);   // opaque backing behind the form → a line (or the translit row above) passing behind the reconstructed word is occluded
  const e=E("text",{class:"mwt-form",x:mx,y:fy,"text-anchor":"middle"}); e.textContent=mfd;   // +20: the MWT form is full 15px (matches tokens), so 20px seats it a comfortable ~9px below the tie
  if(si!=null){ e.setAttribute("data-s",si); e.setAttribute("data-mwtfrom",fromId); e.style.cursor=formCursor();   // data-mwtfrom is the ORIGINAL token id (see fromId above); cursor:text for the same reason the row above carries it — clicking here opens a field, under a Sanskrit script the one on the IAST row this glyph was derived from
    svgTip(e,iastRow?"multi-word token — click to edit the surface form (on the IAST row below, which this glyph is derived from)":"multi-word token — click to edit the surface form"); }   // deliberately NO per-element click listener: the one that used to live here called stopPropagation() and merely selected the component tokens, which killed the bubble that the delegated #doc click handler (editing/context-menu.js) needs to open the inline editor — so the "double-click to edit" its comment promised never existed (no dblclick handler was ever written) and a left-click could not edit the surface form at all. The delegated handler now owns this click and does BOTH: editMWTInline selects the component range (setRange+pick) first, then opens the editor — nothing the old listener did is lost, the right-click menu still works, and the MWT form now behaves like every other clickable diagram text (token form, .tr-edit, .gl-edit): one click, caret at the click point. Under iastFormEdit() the click still opens the editor — over the IAST ROW below, which is where the stored form actually lives (mwtElOf picks the element; the glyph is only its rendering), matching how editNodeInline routes a single token's glyph onto its own transliteration row.
  svg.appendChild(e);   // Item 9: MWT form appended LAST → paints on top of the translit row above
  boxes&&boxes.push({x:mx,y:fy,hx:meas(mfd,MWT_F)/2+2,hy:7});
  // item 8 — gather this tie's whole stack (bracket, surface form + its backing, transliteration row, ExtPos
  // annotation) into ONE <g> carrying the component range, so a selected MWT accents as a UNIT and — the point of
  // the group — rides applySel()'s live class toggle like every other selection class, instead of only appearing
  // on a full re-render. A <g> adds no geometry, and appendChild MOVES the nodes, so paint order is preserved.
  const ids=tieOrigIds(r);
  const selTie=!!(ids&&mwtTieSelected(si,ids.from,ids.to));
  const tg=E("g",{class:"mwt-g"+(selTie?" sel":"")+(ids?tieDimClass(si,tieIdRange(ids.from,ids.to),selTie):"")});   // …and the emphasis level the tie recedes to, by the dimmest cell it spans (tieDimLevel) — the group is the right carrier for BOTH: one opacity/saturation for the bracket, the surface form, the transliteration row and the ExtPos annotation together, exactly as the accent already covers them as a unit
  if(si!=null&&ids){ tg.setAttribute("data-s",si); tg.setAttribute("data-mwtfrom",ids.from); tg.setAttribute("data-mwtto",ids.to); }
  while(svg.childNodes.length>mark0) tg.appendChild(svg.childNodes[mark0]);   // index mark0 keeps naming the next node to move → order preserved
  svg.appendChild(tg); }); }
// one centred label under a tie: an opaque backing blob first, then the text, so a line passing behind it breaks cleanly
function drawTieLabel(svg,mx,fy,text,cls,casCls,font,boxes){
  const cas=E("text",{class:casCls,x:mx,y:fy,"text-anchor":"middle"}); cas.textContent=text; cas.setAttribute("aria-hidden","true"); svg.appendChild(cas);
  const e=E("text",{class:cls,x:mx,y:fy,"text-anchor":"middle"}); e.textContent=text; svg.appendChild(e);
  boxes&&boxes.push({x:mx,y:fy,hx:meas(text,font)/2+2,hy:7}); return e; }
// item 1 — make an ExtPos label click-to-select / right-click-to-edit, pointing at the token that CARRIES the feature
function tagXPosLabel(el,si,r){ if(!el)return; const oid=r._tok!=null?r._tok:r.tok; if(oid==null)return;
  el.setAttribute("data-s",si); el.setAttribute("data-xpostok",oid); el.style.cursor="pointer";
  svgTip(el,`external POS “${r.pos}” — right-click to change`);
  el.addEventListener("click",ev=>{ ev.stopPropagation(); pick(si,oid); }); }
// the ties (MWTs + item 1's ExtPos brackets) wholly contained in ONE wrapped row [s..e], re-based onto that
// row's own token indices — the shape mwtTie expects. A tie straddling a wrap is dropped: there is no single
// row to span it, exactly as the MWT ties already behaved.
function rowTies(D,s0,e0){ const reb=o=>({...o,from:o.from-s0,to:o.to-s0});
  return {gw:(D.gw||[]).filter(g=>g.at-1>=s0&&g.at-1<=e0).map(g=>({...g,at:g.at-s0})),   // a goeswith unit is ONE display slot, so it can never straddle a wrap — it is either wholly in this row or not in it
          mwt:(D.mwt||[]).filter(m=>m.from-1>=s0&&m.to-1<=e0).map(m=>({...reb(m),_from:m._from!=null?m._from:m.from,_to:m._to!=null?m._to:m.to})),   // _from/_to must be pinned to the ORIGINAL ids BEFORE reb() rebases from/to onto this row, or the tie could no longer match the component range selRange holds (item 8)
          xpos:(D.xpos||[]).filter(x=>x.from-1>=s0&&x.to-1<=e0).map(reb)}; }
// item 1 — how far ONE wrapped-bracket tie reaches below its own tie TOP, down to the baseline of its deepest
// label. Mirrors positionBracketAnnots' drawing offsets (PIN 6, form +20, each further row a full inter-tier
// step) and is what reserveBracketArcRoom / the .hasmwt bottom padding both reserve against.
// `lead`: the SAME gap tieLead()/mwtTie seat every SVG tie's body with (below-stack bottom → tie top), so an
// HTML tie's reserved depth stays in step with wherever positionBracketAnnots (js/core/document.js) actually
// draws it — see the `yb` there, which computes the tie's top the identical way: undBot + 5 + tieLead() + r.dy.
// Folded in HERE (not just at the draw site) because htmlTieBottom also backs the room-RESERVATION side of the
// same tie — .bwrap.hasmwt's bottom padding (diagram-wrap.js) and the inter-line growth that keeps a wrapped
// tie from colliding with the next line (reserveBracketArcRoom, document.js) — and both would under-reserve if
// they didn't count the same lead the draw site spends.
function htmlTieBottom(r){ const PIN=6, STEP=18+descent(POS_F), lead=5+tieLead();
  if(r.kind==="gw") return lead+r.dy+gwDepth();                            // the tie has no label under it — it reaches only as far as the glyph's own ink
  if(r.kind==="xpos") return lead+r.dy+PIN+20;                             // the ExtPos value IS the label
  return lead+r.dy+PIN+20+((trLayer()&&trTxt(r))?STEP:0)+(r.pos?STEP:0); } // MWT surface form, then its transliteration row, then any ExtPos annotation
function mwtDepth(D){ return tieLayout(D).depth; }   // extra vertical room the bracket stack needs below the below-stack bottom. Item 1 made this tier-aware — one entry per bracket TIER, each as deep as the deepest label that tier carries (an MWT surface form, plus its transliteration row and/or an ExtPos annotation) — so an ExtPos bracket that pushes an overlapping MWT tie down a tier also grows every reserve that folds in mwtDepth (arcsWrapped's per-row tieBot, projWrapped, belowH) in lockstep. With a single plain MWT tie and no ExtPos it returns exactly the former fixed 39+descent(POS_F)−xHeight(POS_F) (39 with no POS row), +18+descent(POS_F) for a transliteration row — the seating those constants were tuned for is unchanged.

/* labels are always horizontal and centred on their edge (x-height middle); collision avoidance is
   done ONLY by widening horizontal gaps between nodes so every label fits without overlap. */
function drawLabel(g,x,y,text,color){const t=E("text",{class:"lbl"+(isMorphRel(text)?" morph-lbl":""),x:x,y:y,fill:color,"text-anchor":"middle","dominant-baseline":"middle"});
  const deep=depDeep(text);
  if(deep){ const b=E("tspan",{"dominant-baseline":"middle"}); b.textContent=depBase(text); t.appendChild(b); const d=E("tspan",{class:"deep-lbl","dominant-baseline":"middle"}); d.textContent="@"+deep; t.appendChild(d); }   // deep features in a contrasting weight; set the middle baseline on the tspans explicitly — WebKit does NOT propagate the <text> dominant-baseline to tspans, so without this a deep label rides high (alphabetic baseline) while a simple (plain-text) label centres
  else t.textContent=text;
  svgTip(t,relTitle(text));   // hover tooltip: relation expansion + right-click hint (Item 2)
  g.appendChild(t);}
// same, for the HTML relation labels (brackets / outline notations)
function setRelLabel(el,rel){ const deep=depDeep(rel);
  if(deep){ el.textContent=""; const b=document.createElement("span"); b.textContent=depBase(rel); el.appendChild(b); const d=document.createElement("span"); d.className="deep-lbl"; d.textContent="@"+deep; el.appendChild(d); }
  else el.textContent=rel; }
function fitViewBox(svg,boxes){const W0=+svg.getAttribute("width"),H0=+svg.getAttribute("height"); let a=0,b=W0,c=0,d=H0;
  boxes.forEach(B=>{a=Math.min(a,B.x-B.hx);b=Math.max(b,B.x+B.hx);c=Math.min(c,B.y-B.hy);d=Math.max(d,B.y+B.hy);});
  const M=6; if(a<0||b>W0||c<0||d>H0){const x=Math.floor(a-M),y=Math.floor(c-M),w=Math.ceil(b-a+2*M),h=Math.ceil(d-c+2*M);
    svg.setAttribute("viewBox",`${x} ${y} ${w} ${h}`); svg.setAttribute("width",w); svg.setAttribute("height",h);}}
/* tight fit: crop AND expand the viewBox to the exact content extent (unlike fitViewBox, which only grows) */
function fitTight(svg,boxes){ if(!boxes.length) return;
  let a=Infinity,b=-Infinity,c=Infinity,d=-Infinity;
  boxes.forEach(B=>{a=Math.min(a,B.x-B.hx);b=Math.max(b,B.x+B.hx);c=Math.min(c,B.y-B.hy);d=Math.max(d,B.y+B.hy);});
  const M=6,x=Math.floor(a-M),y=Math.floor(c-M),w=Math.ceil(b-a+2*M),h=Math.ceil(d-c+2*M);
  svg.setAttribute("viewBox",`${x} ${y} ${w} ${h}`); svg.setAttribute("width",w); svg.setAttribute("height",h);}
// De-collide edge labels by HORIZONTAL spreading, symmetric around each head: for a head's children, the
// nearest child on each side (rightmost of the left group, leftmost of the right group) stays fixed, and the
// outer children spread away from the head (their whole subtrees shift outward) by the minimum needed. Heads
// and inner children never move → converges. A horizontal label may cross the projection lines.
function spreadForLabels(x,edges){ const live=edges.filter(e=>e.w); if(!live.length) return;
  const SPW=meas(" ",WORD_F), n=x.length;
  const kids=Array.from({length:n},()=>[]), hasIn=new Array(n).fill(false);   // reconstruct the tree for subtree spans
  edges.forEach(e=>{ if(e.h>=0&&e.h<n){ kids[e.h].push(e.d); hasIn[e.d]=true; } });
  const lo=new Array(n),hi=new Array(n),seen=new Array(n).fill(false);
  const span=i=>{ if(seen[i])return; seen[i]=true; lo[i]=i;hi[i]=i; kids[i].forEach(c=>{ span(c); lo[i]=Math.min(lo[i],lo[c]); hi[i]=Math.max(hi[i],hi[c]); }); };
  for(let i=0;i<n;i++) if(!hasIn[i]) span(i);
  for(let i=0;i<n;i++) if(!seen[i]) span(i);
  const byHead={}; live.forEach(e=>{ (byHead[e.h]=byHead[e.h]||[]).push(e); });
  for(let it=0;it<80;it++){ let moved=false;
    Object.keys(byHead).forEach(hk=>{ const h=+hk;
      const left=byHead[h].filter(e=>e.d<h).sort((a,b)=>b.d-a.d);   // nearest the head first
      const right=byHead[h].filter(e=>e.d>h).sort((a,b)=>a.d-b.d);
      if(left.length && right.length){ const l0=left[0], r0=right[0], ml=(x[l0.d]+x[h])/2, mr=(x[r0.d]+x[h])/2, need=l0.w/2+r0.w/2+SPW;   // FIRST: the innermost pair across the head — spread them apart symmetrically if their labels clash
        if(mr-ml < need-0.5){ const dx=(need-(mr-ml)); for(let k=lo[r0.d];k<n;k++) x[k]+=dx; for(let k=0;k<=hi[l0.d];k++) x[k]-=dx; moved=true; } }
      for(let i=1;i<left.length;i++){ const inr=left[i-1], c=left[i], mi=(x[inr.d]+x[h])/2, mc=(x[c.d]+x[h])/2, need=inr.w/2+c.w/2+SPW;
        if(mi-mc < need-0.5){ const dx=(need-(mi-mc))*2; for(let k=0;k<=hi[c.d];k++) x[k]-=dx; moved=true; } }   // shift the outer left child's subtree (and all further left) leftward
      for(let i=1;i<right.length;i++){ const inr=right[i-1], c=right[i], mi=(x[inr.d]+x[h])/2, mc=(x[c.d]+x[h])/2, need=inr.w/2+c.w/2+SPW;
        if(mc-mi < need-0.5){ const dx=(need-(mc-mi))*2; for(let k=lo[c.d];k<n;k++) x[k]+=dx; moved=true; } } });   // outer right child's subtree rightward
    if(!moved) break; }
  // Corrective HORIZONTAL de-collision (subtree-SET based). The block shifts above split a head's children by
  // dependent INDEX (d<h vs d>h) and move contiguous index RANGES — which assumes each subtree sits as a packed
  // left/right block. In a widely non-projective display (e.g. brihat_jataka s1, where a left child's subtree fans
  // out to the RIGHT past its head) that range spans the shared head too, so the "spread" shifts the head along and
  // the two sibling labels never separate. This pass instead sorts each head's children by their live x and moves a
  // dependent's ACTUAL descendant SET relative to its (fixed) head, so same-head sibling labels always separate on
  // their own baseline — horizontal-only, no vertical lift. Monotone-outward ⇒ converges. (Runs only when a residual
  // overlap remains; samples already clear leave `moved` false and are untouched.)
  const kidset=i=>{ const s=[i], seen=new Set([i]); for(let q=0;q<s.length;q++) kids[s[q]].forEach(ci=>{ if(!seen.has(ci)){ seen.add(ci); s.push(ci); } }); return s; };
  const shiftSet=(i,dx)=>kidset(i).forEach(k=>x[k]+=dx);
  for(let it=0;it<200;it++){ let moved=false;
    Object.keys(byHead).forEach(hk=>{ const h=+hk, sib=byHead[h].slice().sort((a,b)=>x[a.d]-x[b.d]);   // children in visual (x) order
      for(let i=1;i<sib.length;i++){ const a=sib[i-1], b=sib[i], ma=(x[a.d]+x[h])/2, mb=(x[b.d]+x[h])/2, need=a.w/2+b.w/2+SPW, gap=mb-ma;
        if(gap<need-0.5){ const push=need-gap;                          // move child x by 2·(midpoint change)
          if(mb<=x[h]) shiftSet(a.d,-2*push);                           // both labels left of the head → outer (left) child's subtree further left
          else if(ma>=x[h]) shiftSet(b.d,2*push);                       // both right of the head → outer (right) child's subtree further right
          else { shiftSet(a.d,-push); shiftSet(b.d,push); }             // straddling the head → split the push outward
          moved=true; } } });
    if(!moved) break; }
  const mn=Math.min(...x); if(mn<2) for(let k=0;k<n;k++) x[k]+=(2-mn); }   // keep the leftmost node non-negative

