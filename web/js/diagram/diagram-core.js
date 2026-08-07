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
/* CSS-VARIABLE READS ARE CACHED PER RENDER. relColor() calls this for every label, edge, arrowhead and
   bracket, and each call is a getComputedStyle on documentElement: 941 of them in one load (measured by
   wrapping the layout-flushing DOM APIs), against a handful of distinct variables. They can only change
   when the theme or the accent does, and both already have a single choke point — js/ui/colours.js's
   deriveRelHuesFromAccent / applyRelColours, which write the --c-* and --accent family — so those clear
   it (clearCssVarCache below). Anything that changes a variable WITHOUT going through them must clear it
   too, or a stale colour survives until the next clear. */
const _CSSVAR=new Map();
function clearCssVarCache(){ _CSSVAR.clear(); }
function css(v){ let hit=_CSSVAR.get(v);
  if(hit===undefined){ hit=getComputedStyle(document.documentElement).getPropertyValue(v).trim(); _CSSVAR.set(v,hit); }
  return hit; }
function relColor(r){ if(!show.colour) return css("--ink"); return css("--c-"+cat(r)); }
function arcInk(col){ return `color-mix(in srgb, ${col}, var(--content-bg) var(--edge-mix))`; }   // arc/edge STROKE ink: the relation colour mixed toward the page ground so the stroke recedes just slightly from its full-colour label (labels keep the full relColor). Not opacity, which would also dim the casing/occlusion halo (that stays on --block-occlude). --edge-mix is now ONE value for BOTH appearances (33%, macos-kit/mac-tokens.css) — light lifts toward white, dark recedes toward #1e1e1e, and the token is deliberately NOT redeclared in the dark block. THIS COMMENT USED TO DOCUMENT A 40%/0% LIGHT/DARK SPLIT; that split was collapsed in the stylesheet and the note went stale, which matters beyond tidiness — exportSVG (js/editing/context-menu.js) has to know exactly which tokens are theme-dependent, and --edge-mix is not one of them.
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
/* ⚠ IT MUST HAVE A REAL SIZE. It was 0×0 — off-screen and harmless-looking — and WebKit does not fully
   SHAPE text in a zero-sized SVG viewport: measured in the shipping app, a Kawi form whose glyphs paint
   86.54px measured 99.88px here, every delta an exact multiple of one mark's advance (2.67px at 15px) and
   exactly 0 for the strings with no combining marks. So each mark was being counted at its own width
   instead of composing into its akṣara, and every slot in every notation came out ~15 % too wide for any
   script whose letters combine — a Brahmic conjunct, an Arabic join, a Devanagari matra. Chrome shapes it
   either way, which is why the headless smoke test reports 0.00 and could never have caught this: it is
   the same "not sufficient for anything measuring text" rule the zoom note states, in a new place.
   Kept off-screen by the offset and overflow, not by having no area. */
_msvg.style.cssText="position:absolute;left:-99999px;top:0;width:3000px;height:200px;overflow:hidden;pointer-events:none";
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
/* ⚠ CANVAS measureText() IS NOT A RELIABLE STAND-IN FOR WHAT foreignObject ACTUALLY PAINTS — it is a
   SEPARATE font-resolution step, and the two can genuinely disagree about which underlying font file an
   ambiguous family name resolves to. Measured on a real machine: fontCovers() (fontload.js) correctly
   found LOCAL system coverage for "Noto Sans Grantha" and skipped downloading the app's own copy — the
   right call, avoiding a redundant fetch — but canvas's `font` resolution and the DOM/SVG text-layout
   engine's resolution picked DIFFERENT underlying faces for that family name on this system, with
   materially different Grantha advance widths. smpReshape used to size every foreignObject from
   _measCanvas(), baking in canvas's number permanently — which is what actually gets painted only when
   canvas and DOM agree, and did not here: columns reserved 40+px more than the glyph actually needed,
   and (worse) a seam mark measured against the SAME wrong number sat far from the neighbour whose real,
   DOM-painted position never matched canvas's guess. Only reachable for the SMP/foreignObject path (the
   ONE case where a canvas number gets used for something the DOM will independently paint) — regular SVG
   <text> measurement (_measRaw, above) has no such second opinion to disagree with, because SVG paints
   the very string it measured.
   The fix: measure through the SAME mechanism that will actually paint the glyph — a live, attached HTML
   element, not canvas — so there is no second font-resolution step left to disagree with the first.
   Needs a REAL, connected box for the same reason _msvg does (see its own note): an unconnected element
   may not fully lay out text either. */
const _mdiv=document.createElement("div");
_mdiv.setAttribute("aria-hidden","true");
_mdiv.style.cssText="position:absolute;left:-99999px;top:0;white-space:pre;visibility:hidden;pointer-events:none";
function _measMountHTML(){ const h=document.documentElement||document.body; if(h&&!_mdiv.isConnected) h.appendChild(_mdiv); }
function _measDOM(s,f){ _measMountHTML(); _mdiv.style.font=f; _mdiv.textContent=s||""; return _mdiv.getBoundingClientRect().width; }
/* A HIDDEN PARKING SPOT FOR AN ELEMENT THAT ISN'T ATTACHED YET BUT NEEDS getComputedStyle() TO ANSWER
   FOR REAL — see smpReshape's own note for exactly which caller needs this and why: renderSentence()
   calls smpReshape on the freshly-built diagram BEFORE its own caller (document.js) inserts it into
   #doc, so every class-based CSS rule (the --token-font cascade every token's font actually comes from)
   has nothing to match against yet, and getComputedStyle() reports empty strings rather than the real
   values. Reused across calls, like every other _m* measuring element in this file.
   ⚠ MUST BE A DESCENDANT OF #doc SPECIFICALLY, NOT JUST "connected to some document" — reported live as
   "SMP scripts are no longer 1.5×" after the first cut of this mount (parented under documentElement/
   body). `.tok-word{font-size:calc(15px * var(--script-mag,1)); font-family:var(--token-font)}`
   (app.css) — the ENTIRE magnified/script font is CSS custom-property driven, and both properties are
   set on #doc itself (syncSchemeAttr, js/lang/translit.js), not :root — a mount point OUTSIDE #doc
   inherits neither, so var(--script-mag,1) silently resolves to its 1 fallback instead of the real 1.5.
   `document.getElementById("doc")` is re-checked on every call rather than cached once, because the
   very first calls (before #doc's own markup has necessarily been reached, or in any harness that
   builds it later) have nothing to find yet and must fall through to a plain top-level mount for that
   one call — re-parenting into #doc the moment it exists corrects every call after. */
const _mmount=document.createElement("div");
_mmount.setAttribute("aria-hidden","true");
_mmount.style.cssText="position:absolute;left:-99999px;top:0;pointer-events:none;visibility:hidden";
function _measMountRoot(){ const doc=document.getElementById("doc"), h=doc||document.documentElement||document.body;
  if(h&&_mmount.parentNode!==h) h.appendChild(_mmount); }
/* THE HTML BASELINE, MEASURED THE ONLY WAY THAT CANNOT DISAGREE WITH WHAT smpReshape PAINTS: an actual
   inline baseline-aligned marker, in an actual live DOM layout, read back with getBoundingClientRect().
   ⚠ smpReshape used to ask CANVAS for this (measureText(s).actualBoundingBoxAscent) on the reasoning
   that canvas is "the control" for these scripts — true for WIDTH (it composes the conjuncts SVG
   cannot, verified against SVG's own unshaped width), which is a DIFFERENT claim from "canvas's
   ascent/descent for this cluster matches what the HTML div will lay out", and nothing had verified
   THAT one. Reported live: Grantha/Kawi tokens still jiggled after every token was moved onto the
   foreignObject/HTML path (verifying the earlier detection fixes had worked) — so the remaining
   inconsistency has to be in the ONE canvas-measured number smpReshape still uses to seat that div,
   not in which tokens take the HTML path. The technique: a zero-size `<span>` with
   `vertical-align:baseline` sits INLINE beside the real text, so the BROWSER's own line layout — not a
   canvas guess about it — plants that span's own box exactly on the text's baseline; its top edge
   relative to the container's is the ascent, for whatever this specific string/font pair actually laid
   out to, shaping included. */
const _mbase=document.createElement("div");
_mbase.setAttribute("aria-hidden","true");
_mbase.style.cssText="position:absolute;left:-99999px;top:0;white-space:pre;visibility:hidden;pointer-events:none;line-height:normal";
const _mbaseText=document.createElement("span"), _mbaseMark=document.createElement("span");
_mbaseMark.style.cssText="display:inline-block;width:0;height:0;vertical-align:baseline";
_mbase.appendChild(_mbaseText); _mbase.appendChild(_mbaseMark);
function _measMountBase(){ const h=document.documentElement||document.body; if(h&&!_mbase.isConnected) h.appendChild(_mbase); }
// {asc, height}: the DOM's own answer to both numbers smpReshape used to ask canvas for — the ascent
// (see the note above) AND the container's real laid-out height, so overflow:visible is the only thing
// standing between a still-canvas-derived box and the ink, not just the vertical POSITION.
function domBaseline(s,f){ _measMountBase(); _mbase.style.font=f; _mbaseText.textContent=s||"";
  const c=_mbase.getBoundingClientRect(), m=_mbaseMark.getBoundingClientRect();
  const px=parseFloat(f)||15, a=m.top-c.top;
  /* ⚠ `c.height` ALONE UNDER-MEASURES A DEEP CONJUNCT, ON REPORT — it is the CONTAINER's own box, sized
     by `line-height:normal` (see _mbase's own style above), and line-height:normal is exactly the
     quantity this file has already found disagreeing between engines for these faces (the align-items
     saga two commits back was the same root cause, one layer up). A real subjoined-consonant stack's
     ink can extend BELOW whatever a "normal" line box reserves — the glyph outline doesn't consult
     line-height at all — and where an engine's own line-height:normal for this font is SHORTER (Safari,
     per live report, against Chrome for the same string), `c.height` is short by exactly that much, so
     the box smpReshape sizes from it (Math.ceil(h+2)) comes back too short too: correctly filled
     (confirmed live — the previous two commits' fixes hold), but too short to contain the real ink,
     which then visibly overflows below it — "the conjunct sticks out further than in Chrome", the box
     itself never being the wrong SIZE for what smpReshape asked of it, only for what the glyph actually
     needed. Measuring the REAL ink bottom (a Range over _mbaseText, immune to line-height the same way
     the ascent marker already is) and taking whichever of it or the container's own height reaches
     further is what makes this the actual floor a deep stack needs, in either engine, rather than
     trusting either one's notion of "normal" to already be tall enough. */
  const range=document.createRange(); range.selectNodeContents(_mbaseText);
  const inkBottom=range.getBoundingClientRect().bottom-c.top;   // ink's own bottom edge, relative to the SAME origin `a` is measured from
  /* ⚠ A CANVAS FLOOR WAS TRIED, REVERTED, AND HAD TO BE RESTORED — round-trip confirmed live, so the
     reasoning behind the revert is recorded here as the dead end it turned out to be, not as guidance.
     `inkBottom` (this Range) DOES come back identical for a shallow probe and the deep conjunct (41
     either way), while canvas's own actualBoundingBoxDescent is genuinely content-sensitive on the same
     two strings (7.21875 vs 15.96875) — that part holds. The revert's argument was that this shouldn't
     matter anyway, because `foreignObject.tok-word,…{overflow:visible}` (app.css) means nothing this
     box's declared height ever clips what paints inside it — so a too-short box looked like it could only
     be a cosmetic mismatch against Chrome's own (smaller) 41/43, never the cause of a real collision.
     Reverting to `Math.max(c.height,inkBottom)` alone (dropping the canvas floor) restored EXACTLY that
     41/43 box — and reopened the original bug: reported live, "the baseline has again collapsed to the
     floor" the moment the box went back to matching Chrome's number. So `overflow:visible` was the wrong
     reason to trust: it keeps the GLYPH from being clipped, but says nothing about where WITHIN the box
     `align-items:flex-start` seats it, and Chrome's own `line-height:normal` for this font reserves real
     descent room around the glyph independent of any div height at all — Safari's reserves far less
     (the same asymmetry this whole investigation started from). A 41/43 box that is "enough" in Chrome is
     therefore NOT the same 41/43 box in Safari, and matching Chrome's px NUMBER was never actually the
     bar — visual correctness in each engine is, and the two numbers legitimately differing is what that
     looks like here. The floor is canvas's descent again, `a` (ascent, independently verified reliable)
     plus canvas's actualBoundingBoxDescent for this exact string, family-prefixed the same way every other
     canvas measurement in this file already is. */
  /* ⚠ SIZE THEN FAMILY, NOT THE OTHER WAY ROUND — a CSS font shorthand is invalid with the family first,
     and an invalid assignment to canvas's own `.font` is SILENTLY REJECTED, leaving whatever font a
     PREVIOUS caller last set successfully still in effect (this file's own capHeightPx()/xHeightPx() note
     the identical trap for the identical reason). `f` arrives here as an opaque, already-built string
     (`SIZEpx family-list`, optionally weight/style-prefixed), so the prefix has to be SPLICED IN right
     after the size token rather than simply prepended — prepending it was tried first and left canvas
     silently measuring against a stale font, which is why the very first cut of this floor measured no
     different for the shallow and deep strings either. */
  let canvasFloor=0;
  try{
    const prefix=(typeof scriptFamilyPrefix==="function")?scriptFamilyPrefix():"";
    const pf=prefix?f.replace(/(\d+(?:\.\d+)?px\s+)/,"$1"+prefix):f;
    _cv.font=pf; canvasFloor=a+(_cv.measureText(s||"").actualBoundingBoxDescent||0);
  }catch(_){}
  const h=Math.max(c.height,inkBottom,canvasFloor);
  /* ⚠ TOUCHING `asc` AT ALL WAS THE WRONG MOVE — TWO ROUNDS OF IT, IN BOTH DIRECTIONS, CONFIRM THE SAME
     THING: `asc` is the ONLY quantity here that moves the REAL, PAINTED position of the glyph (verified:
     shortening it pushed the ink down, on report; lengthening it pulled the ink up, but "too high" and a
     NEW clipping report followed just as fast). `height`, by contrast, was verified live to change
     NOTHING about where the ink paints — three foreignObjects built with the SAME asc (29, unmodified)
     and heights of 45, 100 and 20 all painted the reader's own reported conjunct at the IDENTICAL
     absolute position, because `foreignObject.tok-word,…{overflow:visible}` (app.css) means the box's
     own declared bounds never constrain anything drawn inside it. That reframes every round of this
     investigation: the "box too short" reports were never about real collision with whatever sits below
     the row — the glyph's actual paint position never moved during any of the height-only fixes — they
     were about whether THIS element's own declared bounding box, as DevTools shows it, visually encloses
     its own content. `asc` was never the right lever for that question, because it's the one thing here
     that DOES move the real glyph — anything asked of it necessarily also moves the glyph relative to
     `origY`, and hence relative to whatever else in the row is anchored there without it, which is
     exactly the "too high" / misalignment this asc-adjustment round produced. Reverted: `asc` is once
     again exactly `a`, unadjusted, for every script alike; only `height` (still floored by canvasFloor
     for a deep DIAGRAM_STACKING_SCRIPTS conjunct, unaffected by any of this) grows to make the box's own
     declared bounds match its content, with zero effect on where anything actually paints. */
  return { asc: a>0?a:px, height: h>0?h:px*2 }; }   // a<=0/h<=0 (measurement failed, or an empty string) falls back to the font's own nominal size, the same floor smpReshape's own defaults already used
/* X-HEIGHT, THE CSS WAY — CSS's `ex` unit (ancient — CSS1 — unlike the L4 `cap` unit this replaced)
   resolves to "the font's own x-height" through the SAME font-matching DOM/SVG text painting already
   goes through, so unlike every canvas-measured metric above and below, this one CANNOT disagree with
   what actually paints: there is no second resolution step to diverge. Replaces the seam-mark centring
   math's earlier attempts in order: first ink-centroid (measure some sample character's actual ink
   extent), noisy per glyph — an Indic akshara with a deep subjoined consonant reads its "middle" far
   lower than one without, so the answer swung with whichever token happened to be sampled, Grantha too
   high and Javanese too low on the SAME formula; then cap-height (`cap`), reported wrong on sight — a
   seam mark is a small mid-register glyph ("-"/"꞊"), and what a reader expects it centred against is the
   x-height band ordinary lowercase/akshara-body text occupies, not the taller reference a capital
   letter (or the equivalent full-height akshara) sets. `width:1ex` (not height — the box's OWN block
   axis holds font-size, and a percentage/unit width against an ancestor with no % context would be
   meaningless; the INLINE axis has no such ambiguity) resolves against the element's own font-size/
   font-family, read back via getComputedStyle — an ordinary DOM measurement, not a canvas one. Probed
   live in the shipping WKWebView (CSS.supports("width","1ex") → true) before relying on it, same as
   `cap` was. */
const _mxh=document.createElement("div");
_mxh.setAttribute("aria-hidden","true");
_mxh.style.cssText="position:absolute;left:-99999px;top:0;height:0;overflow:visible;visibility:hidden;pointer-events:none;width:1ex";
function _measMountXH(){ const h=document.documentElement||document.body; if(h&&!_mxh.isConnected) h.appendChild(_mxh); }
function xHeightPx(font){ _measMountXH(); _mxh.style.font=font; return parseFloat(getComputedStyle(_mxh).width)||0; }
// CAP-HEIGHT's own counterpart, `width:1cap` in place of `1ex` — same technique, same probed-supported CSS unit
// (see xHeightPx's own note: `cap` was checked live alongside `ex` before either was relied on). Kept as a
// SEPARATE element/function rather than a font-string-swapped call into _mxh: xHeightPx's own note explains why
// cap-height was the WRONG target for the seam-mark centring this file built _mxh for — a different caller
// wanting the right one for A DIFFERENT question (snumCapHeightLiftEm, below) needs its own probe, not a
// borrowed one with a second meaning bolted onto it.
const _mch=document.createElement("div");
_mch.setAttribute("aria-hidden","true");
_mch.style.cssText="position:absolute;left:-99999px;top:0;height:0;overflow:visible;visibility:hidden;pointer-events:none;width:1cap";
function _measMountCH(){ const h=document.documentElement||document.body; if(h&&!_mch.isConnected) h.appendChild(_mch); }
function capHeightPx(font){ _measMountCH(); _mch.style.font=font; return parseFloat(getComputedStyle(_mch).width)||0; }
// gwTieBox/descent/xHeight (below) stayed on canvas measureText rather than moving to the SVG path above: all
// three measure a FIXED, script-independent reference glyph (U+203F undertie; Latin "gjpqy"/"x" for vertical
// metrics) that resolves to the same Latin-covering face — usually the stack's plain "Noto Sans" — no matter
// which Indic script is currently displayed, so the stale-advances bug the comment above describes (a face
// swap on the SAME measured text) can't occur here; only meas()'s real, script-varying token text needed the
// SVG rework. actualBoundingBoxAscent/Descent also has no SVG getBBox equivalent worth the coordinate-system
// risk for a reserve this narrow.
const _cv=document.createElement("canvas").getContext("2d");
_measMount(); if(!_msvg.isConnected) document.addEventListener("DOMContentLoaded",_measMount);
_measMountHTML(); if(!_mdiv.isConnected) document.addEventListener("DOMContentLoaded",_measMountHTML);
_measMountBase(); if(!_mbase.isConnected) document.addEventListener("DOMContentLoaded",_measMountBase);
_measMountRoot(); if(!_mmount.isConnected) document.addEventListener("DOMContentLoaded",_measMountRoot);
_measMountXH(); if(!_mxh.isConnected) document.addEventListener("DOMContentLoaded",_measMountXH);
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
/* THE GLYPH MAGNIFICATION, mirrored off CSS `--script-mag` by refreshFontStacks (see its own note for
   why a canvas font string cannot read the property itself). 1 everywhere except the ornamental Sanskrit
   scripts. It multiplies the TOKEN-FORM faces only — WORD_F/NODE_F/MWT_F and the goeswith tie — never the
   POS, transliteration or gloss rows, which are Latin annotation drawn at the app's own body size. */
let TOK_MAG=1, TOK_WGHT=400, TOK_TRACK=0, TOK_ASC=1, TOK_MID=0, STACK_DROP=0, TOK_LIFT=0, TOK_OP=1, TOK_OP_RUN=1;
// TOK_WGHT stays 400 for magnified faces now (see magTrack's own note on why the weight curve was dropped for
// them), so this omits a weight token and lets the face render at its own resting weight.
function magFont(px){ const w=TOK_WGHT;
  return (w!==400?w+' ':'')+(px*TOK_MAG)+'px '+LIVE_TOKEN_STACK; }
/* ⚠ OPACITY IS WHAT COMPENSATES FOR WEIGHT NO LONGER DOING SO. magTrack's own note above explains why
   magnified glyphs render at their face's ordinary weight rather than a lightening curve — most of
   INDIC_SCRIPTS is static faces with no lighter weight to ask for, so the earlier weight curve either
   did nothing or resolved to the wrong static weight. That leaves a REAL visual effect unaddressed: a
   script drawn 1.5–2× bigger AND at full, un-lightened weight reads heavier on the page than body text
   at the same weight does, exactly the imbalance the weight curve was trying (and, for these faces,
   failing) to correct. A small opacity reduction is the substitute — it works on every face alike,
   static or variable, unlike weight, and a few percent of transparency reads as "lighter", not as
   "faded", at these sizes. Proportional to the SAME (mag−1) shape every other magnification term in
   this file uses (magTrack, mwtFormLead, the .strans gap fix) — 0 at mag 1 for BOTH curves below
   (byte-identical to a plain document), and each curve DIFFERS by (mag−1) too, not just between the
   two contexts — 1.5× and 2× are never the same number as each other, on request.
   ⚠ TWO CURVES, NOT ONE, ON REQUEST — running-sentence prose and an isolated diagram token are different
   visual contexts and don't obviously want the same offset. A magnified diagram token sits alone amid a
   lot of open space (arcs, POS/gloss rows, whitespace); a magnified running-sentence script sits inside a
   dense run of continuous text the reader is already processing a lot of ink from. The diagram token's
   isolation is what makes its extra weight stand out MORE by contrast, so it gets the stronger offset;
   the running line's already-busy register can afford to keep slightly more of its own ink. Both are
   judgement calls on the exact curve, not measured physical quantities like scriptLiftEm() beside them —
   deliberately kept small ("a bit semitransparent", the report this answers) rather than tuned toward
   some target contrast ratio, and the running/diagram SPLIT is equally a judgement call, not a measured
   distinction — if the direction (diagram lighter than running) turns out backwards on report, that's a
   one-line swap of which coefficient goes where, not a rederivation. */
function magOpacityDia(mag){ return mag>0 ? 1-.12*(mag-1) : 1; }    // diagram: ~6% lighter at 1.5×, ~12% at 2×
function magOpacityRun(mag){ return mag>0 ? 1-.06*(mag-1) : 1; }    // running sentence: half the diagram's offset — ~3% at 1.5×, ~6% at 2×
_lazyFont("WORD_F",()=>magFont(15)); _lazyFont("NODE_F",()=>magFont(14));
_lazyFont("POS_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("GRID_F",()=>'462 13px '+LIVE_MONO_STACK); _lazyFont("HEAD_F",()=>'500 11px '+uiFont()); _lazyFont("HEAD_F_REQ",()=>'700 11px '+uiFont());   // TWO heading faces now, because the band is drawn in two weights: HEAD_F is the OPTIONAL columns' SF Pro Medium (500) and HEAD_F_REQ the obligatory ID/Form columns' Bold (700) — see `table.grid th` / `table.grid th.th-req` in styles/app.css. scanColW/pillColW pick per column; measuring every heading with one weight under-sized ID and Form by the Medium→Bold width difference   // HEAD_F is the GRID HEADING face, and its only consumers are scanColW/pillColW (js/grid/grid.js). It must match `table.grid th` in styles/app.css exactly, which is now title case in the UI font at 11px/590 — NOT --token-font, so it is the one string here built off uiFont() (js/core/platform.js, which resolves --ui-font to a plain family list; a canvas font string can't carry a var()) rather than off LIVE_TOKEN_STACK, and refreshFontStacks' token/mono-stack invalidation therefore doesn't apply to it. uiFont() caches its own DOM read, so calling it from a lazy getter costs nothing after the first   // POS tags: same size + weight (normal, i.e. no weight token here) as the transliteration (TRANS_F) — upright rather than italic; c2sc small-caps do the visual "tag" styling now, not a bumped weight/shrunk size. GRID_F: weight curve @12.65px (matches table.grid's own CSS weight — was unweighted/400, measuring narrower than the grid actually renders)
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
/* ITALIC TEXT GETS AN ADDITIONAL, FLAT TRACKING BUMP — oblique letterforms lean into their neighbours at the
   SAME letter-spacing an upright face reads fine at, so every italic consumer (transliteration, the MSeg
   tier, a Foreign=Yes form) carries this on top of whatever trackCurve(px) already gives its own size, at
   every size — unlike trackCurve, ITALIC_TRACK does not vary with px; it is a correction for the SLANT, not
   for the SIZE, so one flat em value applies whatever size the italic text is set at. Kept OUT of trackCurve
   itself (not folded into TRACK_K) because most callers of trackCurve are upright and must not get it. */
const ITALIC_TRACK=.02;
function italicTrackOf(f){ return /(?:^|\s)italic(?:\s|$)/.test(f||"")?ITALIC_TRACK:0; }
/* ── WHAT THE MAGNIFICATION DOES TO WEIGHT AND TRACKING ─────────────────────────────────────────────
   Magnified Indic-script text (up to 1.5×, TOK_MAG) is drawn at its face's ORDINARY weight — no lightening
   curve — which is a REVERSAL of an earlier design, not the original one, so it is worth stating why.

   ⚠ WEIGHT USED TO FOLLOW A CURVE, AND WAS TAKEN OFF IT ON REPORT. The earlier `magWeight(mag)` asked for
   400/mag (a 30px glyph read the same visual weight as 20px body text would if both came off one variable
   axis), floored at 100 rather than the ordinary curve's 400 — reasoning that a magnified glyph is the one
   case in the app past the 15px reference, where the curve is already heading up, so its own floor had to
   drop with it. That reasoning assumed every consumer was a variable face with a full weight axis to draw
   from; it is not. Only the curated six "ornamental" scripts (Rañjanā, Soyombo, Siddhaṃ, Balinese, Javanese,
   Tibetan) were ever tested against this, and INDIC_SCRIPTS (js/lang/translit.js) is now all 27 —
   Devanagari, Bengali, Kannada, Telugu, Thai and the rest, mostly STATIC Noto Sans <Script> families with
   Regular and nothing else. Asking a static face for "267" (400/1.5) is not "the lightest it has" the way
   asking a variable face is — a static face either substitutes its one weight silently (harmless) or, on
   fonts that DO carry a second static weight nearby, resolves to the WRONG one, which is worse than doing
   nothing. Rather than special-case "does this specific script's font have a real weight axis" — data this
   app does not have at the point TOK_WGHT is set — magnified text simply keeps its face's own weight now,
   for every script alike. `magFont`'s own weight-token logic (just above) already treats 400 as "no token
   needed", so this is the natural inert state, not a new branch.

   ⚠ TRACKING IS UNCHANGED, AND STAYS FOLLOWING THE CURVE — this exemption is about WEIGHT specifically,
   not about magnification generally. The CSS glyph rules carry the tracking curve as a literal for their
   UNMAGNIFIED size (.0055em at 14px), while `_measOneUncached` reads the size out of the font string and
   computes `trackCurve` for the MAGNIFIED one. At mag 2 the two disagree by 0.08·ln 2 ≈ .0554em per
   character, and measurement is what sizes the slot: measured on the real diagram, Balinese forms were
   laid out up to 12.5 px wider or 8.3 px narrower than they paint. The delta is expressed in EM so one
   published value serves every rule whatever its own base size, and `trackCurve(base) + magTrack(mag)` is
   identically `trackCurve(base × mag)` — the identity that makes the CSS and meas() agree by construction
   rather than by two hand-kept literals. Letter-spacing has no analogue of "the font doesn't have that
   value" — every face honours whatever spacing it is asked for — so nothing here forced the same retreat. */
function magTrack(mag){ return mag>0&&mag!==1 ? +(TRACK_K*-Math.log(mag)).toFixed(4) : 0; }
/* The ORNAMENTAL FACE'S OWN ascent, in em — measured, not tabulated, because it is the one number here
   that is a property of the font rather than of the arithmetic, and the faces differ enormously (Kawi
   1.10 em, Balinese 1.36 em against a Latin face's ~1.07). Measured through a character of the script
   actually on screen, since `_cv.font` takes a STACK and only the text decides which member of it
   answers. No such character yet (a scheme just picked, orthographies not filled) → 1, i.e. no shift,
   and the next refresh after fillOrtho supplies the real one. */
/* THE EMPTY HEIGHT ABOVE THE LETTERS — the font's own height above the baseline minus the SHIROREKHA
   (the head-line a Brahmic script hangs its letters from) where the script has one, and the cap height
   where it has not. That difference is what has to come off when the line is top-aligned: these faces
   reserve their ascent for stacked vowel signs that most words never use, so aligning the BOX top drops
   the letters far below the number beside them, and lifting by exactly this puts the head-line on the row
   top.
   ⚠ MEASURED AGAINST THE TALLEST TOKEN ON SCREEN, NOT ONE ARBITRARY CHARACTER — a single-character sample
   (the first non-Latin character found, whatever it happened to be) undercounts a REPHA or any other mark
   that only forms once its whole cluster is shaped: a Nithya Ranjana "मूर्तित्वे" measures
   actualBoundingBoxAscent 81.40 (of a 100 fontBoundingBoxAscent) as a WHOLE WORD — the र्त repha reaching
   almost to the font's own top — against 65.40 for "म" measured alone, or for "र्त" measured out of the
   context that triggers the substitution. Lifting by the single-character number (h−65.40) put the repha
   16% of the em ABOVE the row top it was supposed to land ON; lifting by the whole-word number (h−81.40)
   does not, and still lifts a plain, repha-less word most of the way there rather than stranding it at the
   unlifted box top. So every token's `ortho` on screen is measured as its own full string (shaping intact,
   `actualBoundingBoxAscent` still answers both the shirorekha and the cap-height case) and the SHORTEST
   needed lift — the tallest ink — wins: any other token would have to poke above the winner's own
   head-line to need less, and none needs more than what the winner already sets.
   Returned as an em FACTOR, not px, so the CSS can apply it against whatever size the line is set at. */
function scriptLiftEm(){
  if(TOK_MAG===1) return 0;
  try{
    _cv.font="100px "+scriptFamilyPrefix()+LIVE_TOKEN_STACK;
    let h=0, dsc=0, maxInk=-1;
    for(const s of (typeof DOC!=="undefined"?DOC:[])){ for(const t of (s.tokens||[])){
        const o=t.ortho||""; if(!o) continue;
        const m=_cv.measureText(o);
        if(m.fontBoundingBoxAscent>0 && m.actualBoundingBoxAscent>maxInk){ h=m.fontBoundingBoxAscent; dsc=m.fontBoundingBoxDescent; maxInk=m.actualBoundingBoxAscent; } } }
    if(!(h>0&&maxInk>=0&&h>maxInk)) return 0;
    let lift=(h-maxInk)/100;
    /* ⚠ FOR TIBETAN SPECIFICALLY, THE em-BOX LIFT ABOVE ISN'T THE WHOLE STORY — .stext-stacked
       (document.js) ALSO sets line-height:2 on this same row (Tibetan is a STACKING_SCRIPTS member),
       and that line-height has its OWN effect on where the baseline falls that the em-box arithmetic
       above knows nothing about. A CSS line box centres the font's NATURAL height
       (fontBoundingBoxAscent+Descent) inside the SPECIFIED line-height, splitting the difference as
       half-leading above and below; the lift above implicitly assumes that half-leading is ~0, true
       whenever the specified line-height roughly matches the font's natural size. Tibetan's own declared
       ascent+descent is 2.815em (measured via fontTools against the vendored notoseriftibetan.ttf:
       hhea/OS2 ascent 1.466em, descent 1.349em, agreeing across every metrics table the font carries) —
       bigger than line-height:2 itself, which makes the half-leading NEGATIVE (content overflows the box
       on both edges by (2.815−2)/2 ≈ 0.41em) and pulls the baseline UP by that much before the em-box
       lift is even applied. The two stack: measured live (WKWebView, a baseline-marker span + the SAME
       canvas metrics this function uses, against the five real deep clusters in this file's own
       STACKING_SCRIPTS comment), the em-box lift alone (0.392em) put the real ink 7.5px ABOVE the row top
       it was supposed to land ON — "Tibetan sits too high", the reported bug — because line-height:2's
       own −0.41em head start was never subtracted before adding another +0.39em on top of it. Corrected,
       the two terms net to −0.018em (0 after the floor below) — matching the live measurement (which
       required no lift at all, to within 0.14px) almost exactly.
       ⚠ SCOPED TO TIBETAN BY NAME, NOT TO STACKING_SCRIPTS AS A WHOLE, and that is a deliberate narrowing
       from the general form of this correction, not an oversight: the same fontTools measurement run
       against every other STACKING_SCRIPTS member's own vendored file (Grantha 1.29+0.534=1.824em,
       Javanese 1.120+0.916=2.036em, Balinese 1.363+0.838=2.201em, Kawi 1.100+0.900=2.000em, Zanabazar
       Square 1.621+0.821=2.442em) shows Tibetan is the only one whose declared metrics so drastically
       overshoot line-height:2 that the sign of the correction is unambiguous and the live-measured
       target (~0 lift) leaves no doubt. Live-testing the correction against a synthetic Grantha cluster
       showed the SAME class of em-box overshoot already existing independently of this fix (and got
       marginally larger under the general form) — a real question, but a DIFFERENT and unreported one,
       and not this function's to guess an answer for on an untested script from a hand-built test word.
       Applying the correction everywhere STACKING_SCRIPTS applies would have traded one measured fix for
       four unmeasured ones. Ranjana's own hard-won repha calibration (this function's other big comment,
       above) is untouched either way — it is not a STACKING_SCRIPTS member and never took line-height:2. */
    if(ORTHO_SCHEME==="Tibetan" && dsc>0){
      lift=Math.max(0,lift+(200-(h+dsc))/200);
    }
    /* ⚠ GRANTHA GETS A DIFFERENT TARGET ENTIRELY, ON REPORT: "running-sentence Grantha should have its
       cap-height top-aligned with the sentence number" (corrected from an earlier report of this same
       request that said x-height — the reader's own follow-up correction, not a measurement reversal) —
       not "head-line at row top" (the em-box target above), which is a DIFFERENT quantity, and not
       x-height either, which is shorter than cap-height and was the wrong register for a report that
       means the row's NUMERALS: .snum sets ordinary lining figures, which occupy the cap-height band, not
       the x-height one — the same distinction xHeightPx's own note draws for why cap-height was the WRONG
       target for a seam mark's centring but is the RIGHT one for aligning against digits.
       `snumCapHeightLiftEm()` measures the ACTUAL target directly (a synthetic, unlifted .shead row — see
       its own note) rather than approximating it through ink depth, so it replaces the em-box number
       outright for this one script rather than adding to it. Scoped BY NAME, exactly as the Tibetan
       branch above is, and for the same reason: this target was only asked of Grantha, and nothing here
       says another STACKING_SCRIPTS member's own em-box lift is currently wrong — Tibetan's own lift was
       independently calibrated (and verified, live) to a 0.14px ink-to-row-top target two commits ago,
       and blindly generalising cap-height-alignment to it would overwrite that with an unmeasured,
       unrelated number. */
    if(ORTHO_SCHEME==="Grantha"){
      const alt=snumCapHeightLiftEm();
      if(alt!=null) lift=alt;
    }
    return lift;
  }catch(_){ return 0; } }
/* THE ACTUAL ALIGNMENT TARGET FOR A SCRIPT WHOSE RUNNING LINE SHOULD MEET THE SENTENCE NUMBER AT
   cap-height (currently only Grantha — see scriptLiftEm's own note on why this isn't asked of every
   STACKING_SCRIPTS member, and on why cap-height rather than x-height is the right register: .snum sets
   ordinary lining figures, which read at cap-height, not x-height). scriptLiftEm's own em-box arithmetic
   (fontBoundingBoxAscent minus the deepest ink on screen) answers a DIFFERENT question — "where does the
   shirorekha/cap-height line land, as a property of the FONT" — a plausible-sounding proxy, but not
   necessarily the same number as "where does THIS face's cap-height actually sit against a REAL row
   holding .snum's digits", which is what this function measures directly instead of approximating.
   ⚠ WHY A SYNTHETIC ROW, NOT scriptLiftEm's canvas metrics: .snum's real position in the live .shead
   isn't a plain function of its own font's ascent — align-items:baseline resolves the row's shared
   baseline from EVERY item's own line-box (including .stext-script's line-height:2 when the script is
   also a STACKING_SCRIPTS member, the exact half-leading effect the Tibetan branch above exists to
   correct for), and reconstructing that arithmetic by hand for a second script risks the identical class
   of bug. Building one real .shead — the SAME classes, so the SAME rules apply, laid out by the SAME
   engine that lays out the live one — sidesteps re-deriving flex baseline math a second time: the
   browser is asked the question directly instead of being modelled.
   The row is measured with its OWN lift terms forced to 0 (`_msnum`'s inline style beats the class rule
   with no !important needed), so what comes back is the row's natural, UNLIFTED offset — exactly the
   quantity scriptLiftEm() needs to turn into a lift. Mounted inside #doc (not documentElement/body, like
   _mmount above) for the same reason _mmount is: --script-mag and --token-font are set on #doc itself,
   not :root, and a mount outside it would silently measure the unmagnified font. */
const _msnum=document.createElement("div");
_msnum.setAttribute("aria-hidden","true");
_msnum.style.cssText="position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none";
_msnum.className="shead";
const _msnumNum=document.createElement("span"), _msnumScript=document.createElement("span"), _msnumMark=document.createElement("span"), _msnumSid=document.createElement("span");
_msnumNum.className="snum"; _msnumNum.textContent="1";
_msnumScript.className="stext stext-script";
_msnumScript.style.cssText="top:0;margin-bottom:0";   // beats .stext.stext-script's own top/margin-bottom unconditionally — plain inline style, no !important needed
_msnumMark.style.cssText="display:inline-block;width:0;height:0;vertical-align:baseline";
_msnumScript.appendChild(_msnumMark);
_msnumSid.className="sid-in mono"; _msnumSid.textContent="s1";   // .sid-in is a THIRD baseline-aligned flex item in the real .shead (the URL button and block controls are the only two exempted, via their own align-self:flex-start) — its own font (var(--ui-mono), 13px/600) has different metrics from .snum's, and omitting it here measured 3px off the real row: align-items:baseline resolves ONE shared baseline from every participating item, not just the two this measurement cares about, so all of them have to be present for the resolved baseline to match the live row's.
_msnum.appendChild(_msnumNum); _msnum.appendChild(_msnumScript); _msnum.appendChild(_msnumSid);
function _measMountSnum(){ const doc=document.getElementById("doc"); if(doc&&_msnum.parentNode!==doc) doc.appendChild(_msnum); }
function snumCapHeightLiftEm(){
  try{
    _measMountSnum();
    if(typeof STACKING_SCRIPTS!=="undefined"&&STACKING_SCRIPTS.has(ORTHO_SCHEME)) _msnumScript.classList.add("stext-stacked");
    else _msnumScript.classList.remove("stext-stacked");
    // a representative glyph is enough — cap-height is one number per font, unlike scriptLiftEm's own
    // ink-depth measurement, which needs the single deepest cluster on screen
    let ch="";
    outer: for(const s of (typeof DOC!=="undefined"?DOC:[])){ for(const t of (s.tokens||[])){
        const o=t.ortho||""; for(const c of o){ if(c>" "){ ch=c; break outer; } } } }
    _msnumScript.textContent=""; _msnumScript.appendChild(_msnumMark); _msnumScript.appendChild(document.createTextNode(ch||"a"));
    const numRect=_msnumNum.getBoundingClientRect(), markRect=_msnumMark.getBoundingClientRect();
    const fontPx=parseFloat(getComputedStyle(_msnumScript).fontSize)||0;
    if(fontPx<=0) return null;
    // CSS font shorthand is SIZE then FAMILY ("19.5px Foo"), not the reverse — capHeightPx() hands this
    // straight to _mch.style.font, and family-before-size is invalid, silently rejected, leaving _mch at
    // WHATEVER font a previous caller last set successfully (typically a 100px reference string from
    // scriptMidEm() elsewhere in this file) — measured on report (against the earlier xHeightPx()-based
    // version of this function, the same class of bug applies identically here): a stale size reads the
    // cap-height RATIO at the wrong reference size, not this element's real one.
    const capPx=capHeightPx(fontPx+"px "+getComputedStyle(_msnumScript).fontFamily);
    if(capPx<=0) return null;
    const capHeightTopY=markRect.top-capPx;   // baseline (markRect.top) minus the cap-height, i.e. the top of the cap-height band
    return (capHeightTopY-numRect.top)/fontPx;   // positive → cap-height sits below .snum's top → lift by this many em to close it
  }catch(_){ return null; } }
function scriptFamilyPrefix(){ return (typeof fontStackName==="function"&&ORTHO_SCHEME)?("'"+fontStackName(ORTHO_SCHEME)+"', "):""; }
/* STACKING SCRIPTS' subjoined/stacked marks can reach well below what ANY Latin descender does — the
   sample belowGap()'s existing descent(f) measures ("gjpqy") is Latin, and WORD_F never leads with the
   script family (magFont), so descent(WORD_F) answers the SAME small Latin number no matter which script
   is actually on screen. belowGap()'s magnification term only ever compensates for the font being
   BIGGER, never for a subjoined consonant genuinely reaching DEEPER — the same gap .stext-stacked exists
   to close for the running line, here for the diagram's own below-token stack (POS/translit/gloss).
   Scoped to DIAGRAM_STACKING_SCRIPTS (js/lang/translit.js) rather than STACKING_SCRIPTS itself — an
   everyday Indic running hand has no such reach, and adding this to belowGap() for every script would
   just open air nothing needs. DIAGRAM_STACKING_SCRIPTS is STACKING_SCRIPTS minus Tibetan: see its own
   comment for the live + hidden-window measurement showing Tibetan's real subjoined depth, under the
   correctly-stacking Noto Serif Tibetan this app now bundles, needs no reserve beyond what belowGap()'s
   own magnification term already gives every 1.5×-scaled script — Tibetan still belongs in
   STACKING_SCRIPTS itself (.stext-stacked, the running-sentence view, still needs it). Measured against
   the DEEPEST ink actually on screen, not one sample character — same reasoning as scriptLiftEm()'s own
   ascent measurement: a subjoined cluster only reaches its full depth once shaped as a whole word.
   Returns the EXTRA px beyond what descent(WORD_F) already gives, so belowGap() can simply add it; 0
   outside a stacking script or with nothing yet to measure. Cached into STACK_DROP by
   refreshFontStacks(), like TOK_ASC/scriptLiftEm() beside it — belowGap() runs far too often (every
   renderer's draw AND reserve) to re-scan the whole document on each call. */
/* ⚠ SVG-MEASURED, NOT CANVAS — this is exactly the ambiguous-family-name trap the _measDOM comment above
   describes for Grantha: fontCovers() finds LOCAL system coverage and skips the app's own download, and
   canvas's font matcher and the SVG text-layout engine painting the diagram can independently resolve
   that same family NAME to different underlying FILES with different subjoined-mark depths. Measured on
   report: canvas's actualBoundingBoxDescent for a real Grantha word came back shallower than what the
   diagram's own SVG <text> paints, so STACK_DROP computed from it silently undershot — the extra
   below-token space this function exists to reserve just didn't appear, for the one script this bug was
   originally diagnosed on. Unlike scriptAscentEm/scriptMidEm/scriptLiftEm below (which need
   fontBoundingBoxAscent/Descent — the font's own EM-box metrics, with no SVG DOM equivalent), this
   function only ever needed actualBoundingBoxDescent — pure INK depth — which _mtxt.getBBox() gives
   directly, measured through the SAME element (and so the SAME font resolution) meas()/measGloss() paint
   with. No capability lost, unlike those three. */
/* ⚠ CHROME IS THE COMPENSATION TARGET FOR GRANTHA, ON REQUEST — canvas fixed getBBox()'s content-blind
   constant (stackDropExtra's own Kawi/Balinese/Javanese/Grantha branch below), but canvas's OWN
   actualBoundingBoxDescent still disagrees between engines for a genuinely deep Grantha conjunct: measured
   live against samples/brihat_jataka.conllu (a real Chrome-vs-shipping-WKWebView comparison, not a
   synthetic probe), a real triconsonantal stack — Ca+virama+Ka+virama+Ta+vowel-sign+anusvāra — shapes to
   166.100/100em in Chrome (Skia/HarfBuzz) and only 80.891/100em in WKWebView (CoreText) for the IDENTICAL
   string through the SAME canvas API. That is not a measurement artefact (both read via the one API) — it
   is the two engines' own shapers genuinely disagreeing about how deep to draw this conjunct in this
   Google-vendored variable font, and it is what the reported "gap between tokens and arcs, worse in Safari"
   traces to: every wrapped row's height folds in STACK_DROP (belowReserveH, diagram-wrap.js), and each
   row's own start inherits the previous row's bottom, so a per-row shortfall compounds — measured, 22.5px
   apart by the second wrapped row of this same document from a ~9-10px per-row STACK_DROP gap.
   GRANTHA_CALIB_STR/GRANTHA_CALIB_CHROME pin that one conjunct's Chrome-measured depth as a portable
   reference; every engine measures its OWN canvas descent for that fixed string, live, and — ONLY where
   this engine's own reading falls genuinely short of Chrome's — floors the document's own measured max up
   to the reference value (see stackDropExtra's own note beside the floor for why a floor, not a ratio: a
   multiplicative correction was tried first and measured to OVERSHOOT, because the calibration conjunct's
   own shaping shortfall doesn't transfer to whatever different cluster a given document's own scan finds
   deepest). Self-calibrating rather than a hardcoded UA-sniffed constant: an engine that already matches
   or exceeds Chrome on the calibration conjunct is left untouched entirely, and a future WebKit shaping
   change that closes the gap on its own switches this off by itself rather than needing a version-gated
   constant revisited by hand.
   ⚠ NOT EXACT for every document — a floor guarantees at least as much reserve as this one real,
   already-observed conjunct needs, not a precise reconstruction of what Chrome would measure for whatever
   THIS document's own worst cluster happens to be; it is a compensation, not a live Chrome oracle (none
   exists at runtime in the shipped app). Scoped to Grantha alone, by the same by-NAME reasoning every
   other branch here uses — Kawi/Balinese/Javanese's own canvas routing was independently verified with no
   remaining cross-engine gap of this kind, and calibrating them against a Grantha-specific conjunct would
   be unjustified. */
const GRANTHA_CALIB_STR="𑌪𑌙𑍍𑌕𑍍𑌤𑌿𑌂", GRANTHA_CALIB_CHROME=166.10000610351562;
function stackDropExtra(){
  if(!(typeof DIAGRAM_STACKING_SCRIPTS!=="undefined" && DIAGRAM_STACKING_SCRIPTS.has(ORTHO_SCHEME))) return 0;
  try{
    _mtxt.style.cssText="white-space:pre;font:100px "+scriptFamilyPrefix()+LIVE_TOKEN_STACK;
    _cv.font="100px "+scriptFamilyPrefix()+LIVE_TOKEN_STACK;
    let maxInk=-1;
    for(const s of (typeof DOC!=="undefined"?DOC:[])){ for(const t of (s.tokens||[])){
        const o=t.ortho||""; if(!o) continue;
        let d;
        /* ⚠ KAWI, SCOPED BY NAME — the same narrowing DIAGRAM_STACKING_SCRIPTS itself already uses for
           Tibetan, and for the same reason: WebKit does not shape SMP text in SVG <text> at all (see
           SMP_RE/svgShapesSMP's own note below — the same limitation smpReshape swaps the FORM row's own
           glyphs out for, via foreignObject), so THIS element's getBBox() is not real ink for Kawi text —
           measured live, a bare Kawi base consonant and a genuine 3-consonant CONJOINER stack (U+11F42)
           returned the IDENTICAL y/height, digit for digit, the same "font-metric constant, not glyph ink"
           signature Tibetan's own getBBox() quirk had (fa2da8c), just via a different WebKit limitation
           than that one's font-name-ordering bug — confirmed NOT that bug by re-measuring WITHOUT the
           scriptFamilyPrefix() lead too (Tibetan's own fix): still constant for Kawi, so dropping the
           prefix alone does not generalise here. Unlike Tibetan, Kawi's real need is not negligible —
           canvas (the one of this app's three text paths that DOES shape SMP conjuncts, per the same note)
           measures real, content-sensitive descent for the identical strings (~0em for an unstacked base
           consonant → 0.415em for the 3-consonant stack, ~4px of genuine extra reach beyond descent(WORD_F)
           at this size) — so excluding Kawi from DIAGRAM_STACKING_SCRIPTS the way Tibetan was would
           under-reserve it, trading one wrong number for another; measuring THIS text through canvas
           instead is the fix. ⚠ NOT keyed on SMP_RE.test(o) generally, even though Kawi's own bug IS an
           SMP one — Grantha (U+11300–) and ZanabazarSquare (U+11A00–) are ALSO supplementary-plane and
           ALSO members of this same STACKING_SCRIPTS set, and a first cut that switched on content alone
           silently routed THEM onto this same canvas path too, moving their own STACK_DROP numbers
           (measured live: Grantha 6.626→0, ZanabazarSquare 13.084→1.335 for one arbitrary two-character
           probe string) with no live-measured deep-cluster evidence, for either script, that canvas is the
           more correct answer for them the way it demonstrably is for Kawi. Scoping to the script BY NAME
           is what keeps that untouched — exactly the same reasoning scriptLiftEm()'s own Tibetan-only
           branch gives for not applying an unaudited correction to every script the general form would
           technically also reach. */
        /* ⚠ BALINESE AND JAVANESE, SCOPED BY NAME — a THIRD signature behind the SAME "constant regardless
           of content" symptom Tibetan and Kawi had, and neither of those two's root cause: both scripts are
           BMP (Balinese U+1B00–, Javanese U+A980–), so this is not Kawi's "WebKit can't shape SMP in SVG
           <text>" bug, and it survives dropping scriptFamilyPrefix() (Tibetan's own fix), so it isn't a
           font-name-ordering artefact either. Measured live in the shipping WKWebView, real document forms
           of every length from 1 to 10 characters (including forms with genuinely zero descent by canvas's
           own account, e.g. a bare Devanagari daṇḍa "।" reused as these schemes' sentence-final mark):
           getBBox() WITH the script-family prefix returns ONE constant per script regardless of content —
           83.8125/100px-em for every Balinese form tried, 91.609375/100 for every Javanese one, including
           the zero-descent daṇḍa — and WITHOUT the prefix it collapses to a SECOND, shared constant
           (29.3125/100, identical across Balinese/Javanese/Grantha/Zanabazar Square alike, again including
           the zero-descent daṇḍa), i.e. dropping the prefix does not restore real ink here the way it did
           for Tibetan — it just trades one font-metric constant for a different, generic one. Both faces are
           variable (fvar 100–900, fonts.css), like Kawi's and Tibetan's own; canvas measureText's
           actualBoundingBoxDescent is the one of this app's three text paths that answered correctly for
           BOTH — content-sensitive and matching what a genuinely deep stacked cluster needs (0 for the
           daṇḍa and for a bare unstacked consonant, up to ~83/100 for a real multi-mark stack) — so it is
           the fix here too, by the SAME reasoning and the SAME by-NAME scoping Kawi's branch above uses:
           Grantha and Zanabazar Square are NOT added, since routing them was measured (Kawi's own note
           above) to move their numbers with no live evidence either way that canvas is the better answer
           for them specifically. */
        /* ⚠ GRANTHA JOINS THE CANVAS PATH TOO, on report — the "no live evidence either way" caveat the
           note above records for excluding it no longer holds: measured directly against the reader's
           own reported string (a genuine subjoined-conjunct cluster, U+1131C…U+1132E, "janmanām"), THIS
           font's getBBox() ink is the identical 53.40625 constant for that string as for a bare, unstacked
           three-consonant probe — the same signature, same font, same prefixed measurement this whole
           block already treats as proof for Kawi/Balinese/Javanese. Canvas, on the SAME two strings,
           answers 7.21875 and 15.96875 — genuinely content-sensitive, and the deeper of the two is
           exactly the shape a real subjoined "n" (repha/virama stack) needs. Zanabazar Square is
           deliberately NOT added alongside it — this measurement was taken for Grantha specifically, and
           generalising to a script nothing here has tested is exactly the mistake this note's own history
           warns against making twice. */
        if((ORTHO_SCHEME==="Kawi" && SMP_RE.test(o)) || ORTHO_SCHEME==="Balinese" || ORTHO_SCHEME==="Javanese" || ORTHO_SCHEME==="Grantha"){
          const m=_cv.measureText(o); d=m.actualBoundingBoxDescent||0;
        } else {
          _mtxt.textContent=o;
          let bbox; try{ bbox=_mtxt.getBBox(); }catch(_){ continue; }
          d=bbox.y+bbox.height;   // ink bottom, relative to the y=0 baseline — how far the descender actually reaches
        }
        if(d>maxInk) maxInk=d; } }
    if(maxInk<0) return 0;
    /* ⚠ A FLOOR, NOT A RATIO — the multiplicative version tried first (chromeRef/liveCalib, applied to
       maxInk) measured WORSE, not better: live against this same document, WKWebView's OWN worst cluster
       (123.5/100, a DIFFERENT conjunct than the calibration string) scaled by the calibration ratio
       (166.1/80.891≈2.053) landed at 253.5/100 — a document-level STACK_DROP of 51.67, overshooting
       Chrome's own 31.97 by 62%, because the ratio measured on the calibration conjunct's own shaping
       shortfall doesn't transfer to a DIFFERENT cluster's own (unknown, unmeasured) shortfall. A floor
       sidesteps that: it doesn't try to infer how badly THIS document's own worst cluster is under-shaped,
       it simply guarantees at least as much reserve as a real, already-observed Grantha conjunct needs in
       Chrome. Verified live: this document's own Chrome-measured maxInk (166.100) already equals
       GRANTHA_CALIB_CHROME (the calibration string IS this document's Chrome-side worst case), so flooring
       WKWebView's 123.5 up to 166.1 reproduces Chrome's 31.97 exactly, not just closer to it. */
    if(ORTHO_SCHEME==="Grantha"){   // see GRANTHA_CALIB_STR's own note above this function
      const cm=_cv.measureText(GRANTHA_CALIB_STR).actualBoundingBoxDescent||0;
      // only floor where THIS engine demonstrably under-shapes the calibration conjunct relative to Chrome
      // (2% slack for float noise) — an engine already at or above Chrome's own number (Chrome itself, or
      // any future WebKit that closes the gap) is left alone, never pulled DOWN toward the floor either.
      if(cm>0 && cm<GRANTHA_CALIB_CHROME*0.98 && maxInk<GRANTHA_CALIB_CHROME) maxInk=GRANTHA_CALIB_CHROME;
    }
    const px=parseFloat(WORD_F)||TOK_REF_SIZE*TOK_MAG;
    return Math.max(0,(maxInk/100)*px-descent(WORD_F));
  }catch(_){ return 0; } }
function scriptAscentEm(){
  if(TOK_MAG===1) return 1;
  let ch="";
  outer: for(const s of (typeof DOC!=="undefined"?DOC:[])){ for(const t of (s.tokens||[])){
      const o=t.ortho||""; for(const c of o){ if(c>" "&&!/[\u0020-\u024F]/.test(c)){ ch=c; break outer; } } } }
  if(!ch) return 1;
  /* ⚠ THE SCRIPT'S OWN FAMILY HAS TO LEAD THE STACK. Measured: canvas `fontBoundingBoxAscent` reports the
     metrics of the FIRST family in the font list whatever face actually shapes the text — a Kawi character
     measured against the ordinary token stack answers 107 (Noto Sans Latin's ascent) and only answers Kawi's
     own 110 when "Noto Sans Kawi" is named first. So the family is named, with the live stack behind it as
     the fallback; a face that will not resolve falls through and reports the Latin ascent, which is the same
     shift this had before any of it was measured. */
  const fam=(typeof fontStackName==="function"&&ORTHO_SCHEME)?("'"+fontStackName(ORTHO_SCHEME)+"', "):"";
  try{ _cv.font="100px "+fam+LIVE_TOKEN_STACK; const m=_cv.measureText(ch);
    const a=m.fontBoundingBoxAscent; return (a>0&&isFinite(a))?a/100:1; }catch(_){ return 1; } }
/* HALF THE FONT'S OWN X-HEIGHT, above the baseline, as a ratio of size — via the CSS `ex` unit
   (xHeightPx, above), not ink and not cap-height.
   ⚠ THREE CUTS TO GET HERE. Two measured INK, and were wrong in OPPOSITE directions on report (Grantha
   too high, Javanese too low — the same formula, so not a sign bug, a NOISE bug): ink-centroid is a
   property of WHICH GLYPH happens to be sampled, not of the font — an akshara with a deep subjoined
   consonant reads its ink "middle" far lower than a plain one does, so the answer swung with whichever
   token a DOC-scan happened to land on first. The third measured a real FONT metric (cap-height, via
   `cap`) but the WRONG one — reported wrong on sight: a seam mark is a small mid-register glyph
   ("-"/"꞊"), and what reads as "centred" is the x-height band ordinary lowercase/akshara-body text
   occupies, not the taller span a capital letter (or a full-height akshara) sets. `ex` answers the x-
   height question directly, through the same font resolution DOM/SVG painting already uses, so it can't
   disagree with the paint the way canvas could, and it can't be noisy the way ink was — every glyph in
   the font shares one x-height. */
function scriptMidEm(){
  if(TOK_MAG===1) return 0;
  const xh=xHeightPx("100px "+scriptFamilyPrefix()+LIVE_TOKEN_STACK);
  return xh>0?xh/200:0; }
// gloss-tier measurement fonts — must match the CSS at .gloss / .gloss[data-tier=…]: lexical gloss now shares
// MGloss's own upright 13.2px (matches --stext-fs, the block-initial sentence size); MSeg is 15px italic (word-like).
// Used to size token/node slots so a wide gloss can't crowd its neighbour (item 13).
_lazyFont("GLOSS_F",()=>weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK); _lazyFont("MSEG_F",()=>'italic 15px '+LIVE_TOKEN_STACK); _lazyFont("MSEG_UP_F",()=>'15px '+LIVE_TOKEN_STACK); _lazyFont("MGLOSS_F",()=>weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK);   // item 5: MSeg measures at the TOKEN size (15px = WORD_F), not 14px, and at token WEIGHT (no curve bump — see .gloss[data-tier="mseg"]'s literal 400, its size being the reference size itself). MGloss measures at the block-initial sentence size (13.2px = --stext-fs), weighted via weightCurve() so glossSlotW's measured width matches what .gloss/.gloss[data-tier="mgloss"] actually render at
function tierFont(tier,tk){ return tier==="mseg"?(isForeign(tk)?MSEG_UP_F:MSEG_F):(tier==="mgloss"?MGLOSS_F:GLOSS_F); }   // the MSeg tier is the only italic one, so it's the only one a Foreign=Yes token flips upright (see frnUp)
// widest below-token gloss row for a token, in its real font (0 when no gloss tier is on). An empty tier draws "…"
// (gl-empty) so it contributes that narrow placeholder width — a real gloss dominates. Folded into every slot-width max.
function glossSlotW(t){ let w=0; belowTiers().forEach(tier=>{ const dtxt=tierText(t,tier)||"…"; w=Math.max(w,tier==="mseg"?meas(dtxt,tierFont(tier,t)):measGloss(dtxt,tierFont(tier,t))); }); return w; }
/* MEASUREMENTS ARE CACHED, because the same handful of strings is measured over and over: one load of
   the sample document makes 4,985 calls with 183 DISTINCT (text, font, extra-css) triples, and a
   notation switch 6,883 with 325 — 96% repeats. Each miss is a real cost: the body below writes into
   an SVG <text> and calls getComputedTextLength(), which forces style+layout, and the load profile
   attributed 1.36s of a ~2.5s page-load budget to this one function.
   The key is the whole input, so nothing that changes the answer is left out of it. What is NOT in
   the key is the FONT DATA behind the family list — a face that finishes loading, or a switch of the
   token/mono stack, changes what these strings measure — so both are invalidated explicitly:
   refreshFontStacks below (stack change) and the fonts "loadingdone" handler (js/lang/fontload.js),
   which already force a re-render for the same reason. Capped rather than unbounded: a large treebank
   has many distinct forms, and a cleared cache costs one re-measure, not correctness. */
const _MEAS_CACHE=new Map(), _MEAS_CAP=20000;
function clearMeasCache(){ const n=_MEAS_CACHE.size; _MEAS_CACHE.clear(); return n; }
/* …or only the entries a given face could have changed. A landed font invalidates a cached width only
   if the string it measured is DRAWN in that face, and a per-script face (Noto Sans Devanagari, …)
   draws only its own script — so dropping every Latin measurement because a Devanagari face arrived
   re-measures the whole document for nothing. `pred` receives the measured TEXT (the cache key's first
   field); returns how many entries were dropped, so the caller can skip the re-render entirely when a
   face changed nothing on screen. */
function clearMeasCacheWhere(pred){ if(typeof pred!=="function") return clearMeasCache();
  let n=0;
  for(const k of [..._MEAS_CACHE.keys()]){ const i=k.indexOf("\u0000");
    if(pred(i<0?k:k.slice(0,i))){ _MEAS_CACHE.delete(k); n++; } }
  return n; }
function _measOne(s,f,extraCss){
  const _k=(s||"")+"\u0000"+f+"\u0000"+(extraCss||"");
  const _hit=_MEAS_CACHE.get(_k); if(_hit!==undefined) return _hit;
  const _w=_measOneUncached(s,f,extraCss);
  if(_MEAS_CACHE.size>=_MEAS_CAP) _MEAS_CACHE.clear();   // a document big enough to blow the cap re-measures rather than growing without bound
  _MEAS_CACHE.set(_k,_w); return _w; }
/* ── WEBKIT DOES NOT SHAPE SUPPLEMENTARY-PLANE COMPLEX TEXT IN SVG <text> ───────────────────────────
   Measured in the shipping app, one Kawi word at 15px: canvas 39.85, painted SVG 86.54, this measuring
   element 99.88 — and all three agree to 0.01 on the two strings in the same sentence that carry NO
   combining marks. Canvas is the control, not a candidate: it is less than half the painted width
   because it is the only one of the three that forms the conjuncts and zeroes the marks. So the SVG is
   painting Kawi UNSHAPED, roughly one advance per codepoint, and the "horizontal placement is off"
   report is that width — not a centring error, which measures 0.00.
   ⚠ THE DISCRIMINATOR IS THE PLANE, NOT THE SCRIPT. Javanese has as many marks and paints correctly;
   it is BMP. Kawi is U+11F00–, so every character is a surrogate pair. Same breakage is expected for
   every SMP Brahmic script (Siddhaṃ, Soyombo, Sharada, Newa, Bhaiksuki, Modi, Tirhuta, Zanabazar
   Square) and for none of the BMP ones. Chrome shapes SMP in SVG, so NO headless test can see this —
   the same trap the Zanabazar Square note records, and the reason CLAUDE.md's claim that Kawi "comes
   out clean" was wrong: it was verified in a synthetic CDP harness.
   NO LONGER DETECTED AT ALL — see smpUnshaped's own note for the two detection strategies tried and
   abandoned, in order. */
const SMP_RE=/[\uD800-\uDBFF][\uDC00-\uDFFF]/;
/* ⚠ STOPPED TRYING TO DETECT THE FAILURE; JUST ASSUME IT, for any supplementary-plane text. Two
   detection strategies were built and both were reported wrong on real documents:
     1. Per-SCRIPT (svgShapesSMP, since removed): sample the first SMP cluster found anywhere in DOC,
        cache one pass/fail per ORTHO_SCHEME, apply it to every string of that script. Wrong because
        Grantha's verdict leaked onto Kawi across a shared font-stack string (fixed by keying on
        ORTHO_SCHEME) and, separately, because shaping success isn't even a fact about the SCRIPT (fixed
        by #2) — a lucky/unlucky first sample decided every other word's treatment.
     2. Per-STRING (smpUnshaped, an SVG-vs-canvas width comparison run on each element's own text):
        closed the "one sample for the whole script" gap in principle, verified mechanically (mocked
        measurements proved two different strings COULD get two different verdicts) — and STILL reported
        wrong live: Grantha, previously never reported as jiggling, started jiggling too. The comparison
        itself is not trustworthy evidence — a WIDTH match is necessary but not sufficient for "shaped
        correctly" (two renderings can agree on total advance while differing in per-glyph vertical
        placement, which is exactly the "jiggled, inconsistent baseline" symptom, as opposed to the
        horizontal "too far left" one the comparison was built to catch), and there is no cheap DOM
        signal available that answers the real question ("did this paint as one composed cluster or as
        loose codepoints") without literally rendering both ways and eyeballing them.
     Given no available signal reliably answers "will this shape", the correct move is to stop asking:
     supplementary-plane text (any script — the same failure is expected, on the same evidence, for
     every SMP Brahmic script) is ALWAYS routed through the HTML fallback (smpReshape), which is the SAME
     rendering path the running-sentence line already uses correctly. Simpler, and — unlike either
     detection strategy — cannot be wrong about a case detection missed. */
function smpUnshaped(s){ return SMP_RE.test(s||""); }
/* ── …AND THE FORMS THAT CANNOT SHAPE ARE DRAWN AS HTML INSTEAD ─────────────────────────────────────
   A <foreignObject> carrying an ordinary HTML element shapes through the engine's normal text path,
   which handles these scripts correctly — it is the same path the running sentence uses, and the
   reason that line has always looked right while the diagram did not.

   ⚠ WHAT A foreignObject DOES NOT INHERIT is the whole difficulty, and each piece is put back
   deliberately: `text-anchor:middle` does not exist for HTML, so the box is positioned at x − w/2 with
   the width meas() reports (which, for exactly these strings, is already the DOM width — i.e. the
   width this HTML will actually paint); `paint-order:stroke` does not exist either, so the casing halo
   becomes the text-shadow triple the HTML notations already use (.bwform/.oline); and the baseline is
   not a property of the box, so the element is seated by its own font ascent so the glyphs land on the
   same baseline the SVG would have used.
   ⚠ THE SEAT ITSELF USED TO BE A CANVAS GUESS (measureText(s).actualBoundingBoxAscent/Descent), on the
   reasoning that canvas is "the control" for these scripts — true for WIDTH (it composes conjuncts SVG
   cannot, verified against SVG's own unshaped width), which is a DIFFERENT claim from "canvas's ascent/
   descent for this cluster matches what the div THIS FUNCTION ITSELF BUILDS will lay out", and nothing
   had verified that one. Reported live: tokens still jiggled after every one of them was already on
   this HTML path (ruling out "some SVG, some HTML" as the cause) — so the remaining inconsistency was in
   the one still-canvas-derived number seating the div, not in which tokens reached it. domBaseline(s,f)
   (js/diagram/diagram-core.js, beside _measDOM) answers the SAME question through an actual DOM layout
   instead — a zero-size baseline-aligned marker sitting on the SAME line as the real text, so the
   browser's own line layout plants it exactly on the baseline, whatever this string/font pair actually
   shaped to. `line-height:normal` on BOTH the measuring element and the div built below, deliberately —
   a mismatched line-height between the two would reintroduce exactly this bug via the CSS half-leading
   model (extra line-height redistributes around the baseline, so measuring at one value and rendering
   at another moves the very thing being measured).
   ⚠ THE CLASS AND EVERY ATTRIBUTE RIDE ALONG, on both the foreignObject and the inner div. Selection
   (applySel reads .tok-word/data-tok), dimming, the Typo/Foreign decorations and the delegated click
   handlers all match on those, and a swap that dropped them would trade a shaping bug for a dead
   token. `.fo-form` is what the stylesheet uses to restore the ink.
   Unconditional now for any element whose own text contains supplementary-plane characters — see
   smpUnshaped's own note for why detecting the failure instead of assuming it was abandoned. Still a
   no-op (one regex, no more) for every element that carries none.
   ⚠ MUST BE CONNECTED, OR getComputedStyle() BELOW ANSWERS NOTHING. renderSentence() (js/diagram/
   diagram-render.js) calls this on the diagram it just built, BEFORE ITS OWN CALLER (document.js's
   diaSentence/buildBlock) inserts that element into the live #doc tree — so at this point `root`, and
   every descendant, is completely detached. A detached element matches no class-based CSS rule (there
   is nothing for a selector like `#doc .tok-word` to match against a subtree that isn't #doc's
   descendant yet), so getComputedStyle(el).font/fontSize/fontFamily all come back "" — confirmed live,
   not assumed (captured mid-loop against the real diagram: every one of those was empty for a token's
   own form text). Reported live as SMP tokens seated visibly too low: the width/ascent this function
   measures off that blank/garbage font string disagrees with the REAL font the div ends up painting in
   moments later, via ordinary CSS inheritance, once #doc's real insertion actually happens — two
   different fonts, one measured against, one painted in, the same class of bug this whole file has
   spent the session chasing, just from a cause nothing here had considered. Mounting `root` into
   `_mmount` (a hidden, always-present parking element — see its own note) TEMPORARILY, and ONLY if it
   isn't already connected — a re-run on an already-live diagram (e.g. after an edit) must not move
   anything that's already correctly placed — makes every getComputedStyle() below answer for real; the
   `finally` detaches it again exactly as found, since the actual caller still owns where this element
   belongs and inserts it itself moments later. */
function smpReshape(root){
  if(!root||!root.querySelectorAll) return;
  const mounted=!root.isConnected;
  if(mounted){ _measMountRoot(); _mmount.appendChild(root); }
  try{
  const texts=root.querySelectorAll("text");
  /* ⚠ THE FORM IS THE ELEMENT'S OWN TEXT NODES, NOT ITS `textContent`. An SVG hover tooltip is a
     <title> CHILD (svgTip — the title ATTRIBUTE surfaces nothing on SVG), so `textContent` returns the
     form CONCATENATED WITH THE TOOLTIP, and the swap then painted the hint into the diagram beside the
     word. Reading only the direct text nodes is the fix; the <title> is carried over below so the
     tooltip itself survives the swap rather than being traded for the bug. */
  const ownText=e=>{ let o=""; for(const n of e.childNodes) if(n.nodeType===3) o+=n.nodeValue; return o; };
  /* ⚠ A PUNCTUATION SATELLITE SHARES THE ROW WITH THE WORD BESIDE IT, AND SO MUST SHARE ITS RENDERING
     TECHNOLOGY — even where the mark's own glyph is plain BMP and so never trips smpUnshaped() on its
     own account. The daṇḍa is the case that showed this up: most scripts have no entry in SCRIPT_DANDA
     and fall through to the shared Devanagari ।/॥ (BMP), so an SMP word swapped to `foreignObject` above
     still sat beside a daṇḍa left in plain SVG `<text>` — the very SVG/HTML mixture this whole mechanism
     exists to get rid of, just moved from "within one glyph" to "within one row". `hangForm()`
     (dandaGlyph()||p.form) is drawn ONLY by drawHangsSVG/drawLeadsSVG, and ONLY into a `<text>` wrapped in
     a `g.punct-sat` — that class is written NOWHERE else in this codebase (grep-verified) — so matching on
     the parent's class reaches exactly those marks and nothing in the POS/gloss/translit/relation-label
     layers, which never nest inside one. Gated on THIS render call having produced at least one genuine
     (SMP) reshape of its own — never on ORTHO_SCHEME/language in the abstract — so a script with no SMP
     content anywhere in the row (plain Devanagari, Tibetan, Khmer, Burmese, an English document, …) sees
     its daṇḍa exactly as before: plain SVG `<text>`, untouched. */
  const isPunctSat=el=>{ const p=el.parentNode; return !!(p&&p.classList&&p.classList.contains("punct-sat")); };
  let hadSMP=false;
  for(const el of texts){ if(smpUnshaped(ownText(el))){ hadSMP=true; break; } }
  for(const el of texts){ const s=ownText(el);
    if(!smpUnshaped(s) && !(hadSMP && isPunctSat(el))) continue;
    const cs=getComputedStyle(el), f=cs.font||((cs.fontWeight!=="400"?cs.fontWeight+" ":"")+cs.fontSize+" "+cs.fontFamily);
    const w=_measDOM(s,f); if(!(w>0)) continue;
    const x=parseFloat(el.getAttribute("x"))||0, y=parseFloat(el.getAttribute("y"))||0;
    const {asc,height:h}=domBaseline(s,f);
    const fo=document.createElementNS("http://www.w3.org/2000/svg","foreignObject");
    for(const a of el.attributes) if(a.name!=="x"&&a.name!=="y"&&a.name!=="text-anchor") fo.setAttribute(a.name,a.value);
    fo.setAttribute("x",(x-w/2)+""); fo.setAttribute("y",(y-asc)+"");
    /* ⚠ HEIGHT DOESN'T GET WIDTH'S "+2" — on report. The two used to share one flat safety margin, but
       it was never calibrated for height specifically: domBaseline()'s own Math.max already floors `h`
       against three independent measurements (container, ink Range, canvas descent), the last of which
       is a precise bound rather than an estimate that needs slop stacked on top of it. Chrome's own box
       for the SAME token measures 2px SHORTER than domBaseline()'s bare `h` here (43 vs a real ceil(h) of
       45 for the reader's own reported conjunct) — Safari genuinely needs more room than Chrome for this
       glyph (the engine asymmetry this whole investigation started from), so even bare `h` already runs
       a little ahead of Chrome's number, and adding +2 on top of that was pure excess, not a needed
       cushion. Width keeps its own +2 — a different measurement (_measDOM), with its own justification,
       untouched by any of this. */
    fo.setAttribute("width",Math.ceil(w+2)+""); fo.setAttribute("height",Math.ceil(h)+"");
    fo.style.overflow="visible";
    /* ⚠ THE TEXT GOES IN AN INNER SPAN, NOT DIRECTLY IN THE FLEX DIV — on report ("baseline still at the
       floor of the box"), and a mismatch this file should have caught sooner: domBaseline() ITSELF never
       measures loose text against a bare line-height:normal DIV — it measures a <span> (_mbaseText)
       NESTED inside one (_mbase), with a second, zero-size marker span (_mbaseMark) as its sibling, so the
       browser's own inline layout can place that marker "on the baseline" the exact same way it would for
       any other inline content on the line. Rendering the SAME text as a bare text node directly inside a
       `display:flex` div (as this did until now) hands the engine a DIFFERENT box to resolve — an
       anonymous flex item wrapping loose text, not an explicit inline box — and there is no guarantee two
       engines agree on how that anonymous item's line box interacts with `align-items` for a font with
       unusual ascent/descent metrics (exactly what every DIAGRAM_STACKING_SCRIPTS member has). Wrapping
       the text in an explicit <span> makes the render side structurally identical to what domBaseline()
       already measures — same nesting depth, same element types, same line-height:normal context — so an
       engine cannot resolve the two differently by construction. The outer div keeps `line-height:normal`
       and the font (inherited by the span), and gains nothing else: `.fo-form`'s own flex/align/colour
       rules (app.css) reach the span exactly as they reached the bare text before, since align-items
       cross-aligns whatever flex item is there, span or anonymous box alike. */
    const d=document.createElementNS("http://www.w3.org/1999/xhtml","div");
    d.setAttribute("class","fo-form "+(el.getAttribute("class")||""));
    d.style.cssText="font:"+f+";line-height:normal;white-space:pre";
    const inner=document.createElementNS("http://www.w3.org/1999/xhtml","span");
    inner.textContent=s;
    d.appendChild(inner);
    fo.appendChild(d);
    for(const ch of el.children) if(ch.tagName==="title") fo.appendChild(ch.cloneNode(true));   // the hover tooltip belongs to the token, not to the <text> we are discarding
    el.parentNode&&el.parentNode.replaceChild(fo,el); }
  } finally { if(mounted&&root.parentNode===_mmount) _mmount.removeChild(root); } }
function _measOneUncached(s,f,extraCss){
  // Mirror CSS letter-spacing for sizes that carry the tracking curve (.node-lbl/.baseword at 14px → .0055em,
  // etc.). Canvas measureText ignored it; SVG getComputedTextLength honours style.letterSpacing. Sizes at the
  // 15px reference (WORD_F/POS_F/…) keep 0 — trackCurve(15)===0 — so this is a no-op for those.
  /* ⚠ AND THE TRACKING IS COMPUTED AT THE UNMAGNIFIED SIZE, because that is what the CSS states.
     The glyph rules carry the curve as a literal for their resting size (.0055em at 14px, none at 15px)
     and deliberately do NOT re-derive it at the magnified size: letter-spacing suppresses the GSUB substitutions a
     Brahmic conjunct is built from, so a magnified script has to keep the tracking it has at rest or it
     stops shaping. Deriving trackCurve from the MAGNIFIED size here is therefore measuring something the
     paint never does — measured on the real diagram, Balinese forms were laid out up to 12.5px wider or
     8.3px narrower than they paint. Dividing back out is what makes the two agree; only the token faces
     are magnified (15/14/26 × mag), and every other font string reaching this line is unmagnified. */
  const pxm=f.match(/(\d+(?:\.\d+)?)px/); let px=pxm?parseFloat(pxm[1]):TOK_REF_SIZE;
  if(TOK_MAG>1 && [15,14,26].some(b=>Math.abs(px-b*TOK_MAG)<0.01)) px/=TOK_MAG;
  const track=trackCurve(px)+italicTrackOf(f);   // the font SIZE, not just parseFloat(f)'s naive "first leading number in the whole shorthand" — that read the WEIGHT off GLOSS_F/MGLOSS_F ("455 13.2px …", a font-weight number ahead of the size) as if it were the size, feeding trackCurve(455) instead of trackCurve(13.2): a wildly wrong negative letter-spacing (~-0.27em) that compressed every MGloss/Gloss measurement to roughly half its actual rendered width — layout (stemmaLayout's lw, glossSlotW) reserved half the space these tiers actually need, and adjacent tokens' MGloss text visibly overlapped. MSEG_F/MSEG_UP_F/WORD_F-class strings never hit this: "italic 15px …" has no leading digit (parseFloat → NaN → the SAME 15px fallback the size actually is), and a bare "15px …" parses correctly by luck alone — only a WEIGHT-prefixed shorthand exposed the bug   // + italicTrackOf(f): the flat oblique-letterform bump, added on top of the size curve for any font string that opens with "italic " — see ITALIC_TRACK's own note
  _mtxt.style.cssText="white-space:pre;font:"+f+(track?(";letter-spacing:"+track+"em"):"")+(extraCss||"");   // white-space FIRST so the font shorthand can't reset it; pairs with the xml:space attribute set above — see that note for why a bare " " otherwise measures 0
  _mtxt.textContent=s||"";
  let w=0; try{ w=_mtxt.getComputedTextLength(); }catch(_){ w=0; }
  /* …and where the SVG cannot shape this string, its width describes a rendering nobody will see. A live
     DOM element is what the HTML fallback (foreignObject) paints — see _measDOM's own note on why this is
     no longer canvas — so it is the width to lay out against. No track/letter-spacing here: smpReshape
     never applies either to the painted div (`font:`+f alone), so matching that means passing `f` as-is. */
  if(smpUnshaped(s)){ const c=_measDOM(s,f); if(c>0) return c; }
  return w; }
function meas(s,f){ return _measOne(s,f); }
// Gloss/MGloss-aware measurement: setGlossText wraps every Leipzig abbreviation run (glossAbbrSegments) in its own
// .glabbr tspan, which turns on font-feature-settings "c2sc"/"onum" (small caps from capitals + old-style figures)
// — a plain meas() call measures the whole string at the tier's ordinary (non-c2sc) advance widths, which the font's
// actual small-caps glyphs need not match. That drift is invisible for a plain word ("possess") but MGloss text is
// almost always MOSTLY an abbreviation run ("PST.PTCP-GEN.SG.M"), so glossSlotW/stemmaLayout's reserved slot and a
// seam mark's "half this text's own width" placement both measured the wrong number — the mark hung off wherever
// the UN-small-capped width said the text ended, not where the small-capped glyphs actually end. Split exactly as
// setGlossText does and sum each segment's OWN width, measured with the SAME feature-settings its own tspan gets.
function measGloss(s,f){ const segs=glossAbbrSegments(s);
  if(segs.length===1&&!segs[0][1]) return _measOne(s,f);   // no abbreviation run at all → identical to meas()
  return segs.reduce((w,[t,abbr])=>w+_measOne(t,f,abbr?";font-feature-settings:'c2sc' 1,'onum' 1":""),0); }
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
  const d=document.getElementById("doc"), prevT=LIVE_TOKEN_STACK, prevM=LIVE_MONO_STACK, prevG=TOK_MAG;
  if(d){ const cs=getComputedStyle(d);
    const t=cs.getPropertyValue("--token-font").trim(), m=cs.getPropertyValue("--mono-font").trim();
    if(t) LIVE_TOKEN_STACK=t; if(m) LIVE_MONO_STACK=m;
    /* …AND HOW BIG THE GLYPHS ARE. `--script-mag` is the Indic-script magnification (1.5 for every
       script in INDIC_SCRIPTS, js/lang/translit.js — every _AKSHARA_SCRIPTS scheme, app/translit.py), published on #doc
       by syncSchemeAttr. Read back HERE, off the same element and in the same breath as the font stacks,
       because a canvas `font` string cannot carry a var(): every slot width in every notation comes from
       meas() against these strings, so a paint that scaled without the measurement following it would lay
       out 15px boxes and draw 30px letters in them. Read, never assumed — the CSS is the authority and
       this is its mirror. */
    const g=parseFloat(cs.getPropertyValue("--script-mag")); if(g>0) TOK_MAG=g;
    /* …AND WHAT FOLLOWS FROM IT, derived HERE and published back so the CSS and the measurement strings
       cannot disagree about any of them. Each is stated in the units its consumer needs, and each is
       exactly its no-op value at mag 1. TOK_WGHT is NOT one of them any more — see magTrack's own note
       above for why weight stopped following a curve — so it stays at its declared 400 and this publish
       is now always the same value the CSS fallback already gives; kept rather than removed so every
       `var(--script-wght,400)` consumer need not be re-audited for one that IS, in fact, always 400. */
    d.style.setProperty("--script-wght",String(TOK_WGHT));
    TOK_OP=magOpacityDia(TOK_MAG); d.style.setProperty("--script-op",TOK_OP.toFixed(3));   // diagram tokens — see magOpacityDia's own note: the opacity compensation weight stopped providing once most INDIC_SCRIPTS faces turned out static
    TOK_OP_RUN=magOpacityRun(TOK_MAG); d.style.setProperty("--script-op-run",TOK_OP_RUN.toFixed(3));   // the running sentence's OWN, gentler curve — same reasoning, different context, see magOpacityRun's own note
    TOK_ASC=scriptAscentEm(); d.style.setProperty("--script-asc",TOK_ASC.toFixed(3));
    TOK_MID=scriptMidEm();   // svgSeamMark's own vertical re-centring against the magnified word beside it — JS-internal only, no CSS consumer
    TOK_LIFT=scriptLiftEm(); d.style.setProperty("--script-lift",TOK_LIFT.toFixed(4));   // cached into a plain JS global (not re-read back off the CSS var, which is colour-cache-adjacent and cleared on a different trigger)
    /* ⚠ AND THE ALIGNMENT ITSELF IS ONLY THE ORNAMENTAL ONE. `.stext-script` carried
       `align-self:flex-start` unconditionally, which is a no-op ONLY if the lift beside it is
       non-zero: at mag 1 the lift is 0, so an unmagnified script line was top-aligned against a
       baseline-aligned sentence number with nothing to bring it back — and the taller the face's
       ascent, the further its letters sat below the number (Kawi's is 1.10 em, which is why it showed
       there). Baseline is the resting alignment and this restores it for every non-ornamental script. */
    d.style.setProperty("--script-align",TOK_MAG>1?"flex-start":"baseline"); }   // empty (no #doc, or the property somehow unset) → keep whatever was last live, which starts as the static base
  // a font-stack change is the ONE non-content thing that can change what meas() returns (js/grid/grid.js's
  // computeColW/pillColW measure against GRID_F/HEAD_F, both built from LIVE_MONO_STACK/LIVE_TOKEN_STACK below)
  // → the column-width cache's every cached measurement is now stale, so force a full rescan rather than trust
  // the (now wrong) cached widths forward.
  const fchg=(LIVE_TOKEN_STACK!==prevT||LIVE_MONO_STACK!==prevM||TOK_MAG!==prevG);   // a size change invalidates exactly what a family change does, and for the identical reason
  if(fchg){ clearMeasCache(); }   // smpUnshaped is a plain regex test now, nothing of its own to invalidate — clearMeasCache() alone is enough   // …and every cached text width, for the same reason: they were measured in the OLD families
  if(fchg && typeof invalidateColW==="function") invalidateColW();
  // …and every renderer's own cached diagram (js/core/document.js's notation-switch cache): stemma/arcs/tree/
  // brackets/outline all measure through this same meas()/WORD_F/NODE_F/POS_F/… family, so a font-stack change
  // invalidates their output exactly as it invalidates colW's, for the same reason.
  if(fchg && typeof invalidateDiaCache==="function") invalidateDiaCache();
  WORD_F=magFont(15); NODE_F=magFont(14);
  STACK_DROP=stackDropExtra();   // needs WORD_F (just assigned) and descent(), which itself needs no font-stack refresh — see the function's own note; cached because belowGap() runs far too often to re-scan DOC per call
  POS_F='15px '+LIVE_TOKEN_STACK; GRID_F='462 13px '+LIVE_MONO_STACK; HEAD_F='500 11px '+uiFont(); HEAD_F_REQ='700 11px '+uiFont();   // HEAD_F/HEAD_F_REQ ride along on this refresh only for uniformity — it is built off --ui-font, not off either LIVE_ stack (see its lazy definition above), so nothing this function reacts to can actually change it
  TRANS_F='italic 15px '+LIVE_TOKEN_STACK; TRANS_UP_F='15px '+LIVE_TOKEN_STACK; MWT_F=WORD_F;
  GRID_ITAL_F='italic 462 13px '+LIVE_MONO_STACK;
  GLOSS_F=weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK; MSEG_F='italic 15px '+LIVE_TOKEN_STACK; MSEG_UP_F='15px '+LIVE_TOKEN_STACK; MGLOSS_F=weightCurve(13.2)+' 13.2px '+LIVE_TOKEN_STACK;
  GW_TIE_F=magFont(26);
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
// Half the MARK's OWN x-height, in px, at the size it will actually be drawn — its OWN font (never
// script-prefixed: a seam mark is Latin punctuation, not part of the word, and a script font that
// doesn't cover it falls through to whatever LIVE_TOKEN_STACK resolves it to — see svgSeamMark's own
// note for why that fallback face is the one that must be asked, not the word's). A FONT metric, not a
// glyph one (see scriptMidEm's own note on why x-height is what this measures) — so it needs no glyph
// text at all, only its font.
function markMidPx(font){ return xHeightPx(font)/2; }
function svgSeamMark(parent,tk,cx,y,halfEnd,font,boxes,halfStart,row){ if(!parent) return;
  /* ⚠ A SEAM MARK IS NOT PART OF THE WORD, so the ornamental magnification does not reach it. It is
     punctuation ABOUT the word — "this is where the orthographic word breaks" — set in the app's own
     register, and doubling it drew a 30px hyphen beside letters it is meant to annotate rather than
     compete with. Only the FORM row is ever magnified (every other row here is handed TRANS_F/MSEG_F/
     GLOSS_F, all unmagnified), so that is the one row this un-scales; the offset arithmetic below then
     measures the mark in the face it is actually drawn in, or the mark and the gap it is placed in
     would disagree. */
  let f=font.replace(/^italic\s+/,""), wordPx=0, markY=y;
  const markMag=row==="form"&&TOK_MAG!==1;
  if(markMag){
    f=f.replace(/(?:^|\s)(\d+(?:\.\d+)?)px/,(mm,px)=>{ wordPx=parseFloat(px); return " "+(wordPx/TOK_MAG)+"px"; }).replace(/^\s*\d+\s+/,"").trim();
    /* ⚠ AND THE MARK IS RE-CENTRED ON THE WORD IT SITS BESIDE, NOT LEFT ON ITS BASELINE — using EACH
       FONT'S OWN x-height, not one borrowed from the other. A first cut shared TOK_MID (the WORD's own
       script-family ratio) between both terms, reasoning "the mark is measured in the face it is actually
       drawn in" — true of its WIDTH (meas() below), false of this: the mark's face is whatever
       LIVE_TOKEN_STACK falls through to for "-"/"꞊" (almost never the script family a Grantha/Javanese/…
       word renders in), so applying the WORD's centring ratio to the MARK's own size answered a question
       about the wrong font. `markMidPx(f)` asks the MARK's own question in the MARK's own (already-
       unmagnified) font; TOK_MID×wordPx asks the WORD's, at the word's magnified size. A font metric now
       (xHeightPx), computed ONCE here rather than per mark-slot below — see scriptMidEm's own note for
       why neither ink nor cap-height was the right one to replace it with. */
    markY=y-TOK_MID*wordPx+markMidPx(f);
  }
  [[seamPost(tk),1,halfEnd,"",seamPostToks(tk)],[seamPre(tk),-1,halfStart!=null?halfStart:halfEnd,"",seamPreToks(tk)],[seamMid(tk),1,halfEnd," seam-mid",seamMidToks(tk)]].forEach(([m,side,half,extra,toks])=>{
    if(!m) return;
    const w=meas(m,f), x=cx+(RTL?-side:side)*(half+w/2);
    const e=E("text",{class:"seam-mark"+extra,x:x,y:markY,"text-anchor":"middle"});   // anchored on its own CENTRE, never start/end: those two are relative to the inline base direction, so under RTL they'd flip and hang the mark back over the very text it sits beside
    e.style.font=f; e.textContent=m; e.dataset.seamRow=row||"form"; if(toks)e.dataset.seamToks=toks; parent.appendChild(e);   // the row is what the centring pass measures BY (mid marks) and what the stylesheet colours by (all of them), so every mark carries it; data-seam-toks names the two tokens the seam joins, which is what applySel gives the accent from
    boxes&&boxes.push({x:x,y:markY-4,hx:w/2,hy:7}); }); }   // the mark reserves no SLOT width, but fitTight still has to see it, or a line-final one would crop off the diagram's own edge
// the seam marks on a token's FORM row: past the form's REAL DRAWN width AND that side's satellites (item 6's
// correct form + the folded punctuation trailing it, the right-merging leads before it), so neither can land on
// top of one of them.
// The half-width used to be max(fmeas(f), fmeas('640 '+f)) — clearance reserved against the bold weight .sel once
// gave a selected form. Nothing bolds on selection any more (see the "SELECTED TOKEN TEXT IS ACCENT-COLOURED,
// NEVER BOLDER" note in styles/app.css), so that max() had become DEAD clearance: it hung every seam mark ~0.4-0.9px
// (Noto Sans 15px, 400→640) further out than the glyph it continues from, on EVERY token, for a state that can no
// longer occur — visible as a mark floating in the gap rather than reading as part of the word. Measured at the
// drawn weight now. The SLOT reserves (WORD_F_BOLD/NODE_F_BOLD in linear/stemmaLayout/wordW) used to be kept
// anyway, on the theory that they cost only a couple of px — but for a magnified Indic script the bold width was
// never a couple of px: canvas's synthetic bold for a face with no real bold weight is wildly inconsistent, and
// measured on a real Kawi word it inflated the reserved slot by 60% (49.9px → 79.9px at weight 640, against
// Latin's ordinary ~6.6% at the same weight — evidently losing ligation, not just thickening strokes). That
// pushed the NEXT token's slot far past where its glyph actually sits, which is what put a form-row seam mark —
// flush against the word it annotates — tens of px from the word that follows. Since nothing bolds any more,
// there is no state left for the reserve to buy headroom against, so WORD_F_BOLD/NODE_F_BOLD are gone outright
// rather than patched at this one measurement site.
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
const SEAM_ROW_SEL={form:".tok-word,.baseword,.node-lbl,.bwform,.oform", translit:".translit,.otrans", mseg:'.gloss[data-tier="mseg"]', mgloss:'.gloss[data-tier="mgloss"]'};
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
    // The shared strip every row's own clear span agrees on — but ONE tight row (an MGloss phrase that fills
    // most of its slot leaves far less spare room than a short mseg segment or script glyph sitting over the
    // same seam) can single-handedly make the FULL-GROUP intersection empty, which used to drop EVERY row back
    // to centring in its own individual gap — not just the tight one. The other rows' own gaps are usually
    // similar enough in width that their independently-computed centres still land close together, so the mark
    // stack reads as "the wide rows agree, the narrow one sits off to the side" (measured: brihat_jataka s1's
    // pralaya/udbhava/sthiti, MGloss "destruction=…=maintenance" flush against its own neighbours while the
    // script/translit/mseg rows above it centre cleanly) — exactly backwards from what a reader expects, since
    // the narrower mark is the one with the LEAST reason to need its own private clearance. Iteratively drop
    // the row with the tightest own span (the likeliest culprit) and recompute, so 3 rows that agree can still
    // share a centre even when a 4th can't fit the same strip — and give that AGREED centre to every row in the
    // group, including the one dropped, rather than letting it opt out into its own answer. Only once fewer
    // than two rows remain in agreement does a row fall back to its own individual centre, same as before.
    let active=rows.slice(), lo=-Infinity, hi=Infinity;
    while(active.length>1){ lo=-Infinity; hi=Infinity;
      active.forEach(r=>{ if(r.lo>lo)lo=r.lo; if(r.hi<hi)hi=r.hi; });
      if(hi>lo) break;
      active=active.slice().sort((a,b)=>(a.hi-a.lo)-(b.hi-b.lo)).slice(1); }
    const shared=active.length>1&&hi>lo;
    rows.forEach(r=>{
      const centre=shared?(lo+hi)/2:(r.lo+r.hi)/2;   // no 2+ rows could agree on a strip clear on all of them → each centres in its own gap rather than landing on top of something
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
// Item 10: where the glyph on screen is a DERIVED rendering, editing it would be editing the
// rendering, so the editable field moves to the IAST transliteration ROW beneath, which writes back
// to the token FORM. That only works while the stored form IS the IAST — true of every Sanskrit file
// until one could be stored in Devanagari. Two of the four cases have changed:
//   IAST file, script displayed      → row edits the form   (as before)
//   IAST file, Original/Latin → the glyph IS the form, edit it
//   DEVANAGARI file, Original        → the glyph IS the form, edit it            (new)
//   DEVANAGARI file, another script  → the glyph is derived, but so is the IAST row — neither shows
//                                      the stored Devanagari, so the ordinary inline form editor
//                                      opens on it instead. Honest rather than clever: the field
//                                      says what the file says.                  (new)
/* The glyph is a DERIVED rendering, so a click on it must open the field on the IAST row it was rendered
   from. That holds only while such a row is drawn — and under Script=Latin + Displayed=CSL it is not:
   there the CSL IS the glyph (bform) and trTxt therefore suppresses the row as redundant, so this would
   have sent the editor to an element that no longer exists. In that arrangement the field opens on the
   glyph's own slot instead and carries the FORM, exactly as it does under "Original". */
function iastFormEdit(){ return isSanskritLang() && !DOCSCRIPT && orthoScript()
  && !(typeof saCslTop==="function" && saCslTop()); }
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
// This table MIRRORS translit._DANDA and had drifted to three of its entries, so under Newa, Khmer,
// Balinese, Javanese, Burmese, Soyombo, Cham, Kawi, Zanabazar Square or Bhaiksuki a daṇḍa PUNCT
// token drew the shared ।/॥ while the running line above it drew the script's own mark. Completed
// here; add to both when a script with its own daṇḍa is added to either.
// "iast" is in it because romanised Sanskrit is now a SCRIPT choice rather than the absence of one:
// a Devanagari-stored file asked for in Latin has to spell its ।/॥ tokens |/‖, which is what this
// app's own romanised convention writes.
const SCRIPT_DANDA={iast:["|","‖"],Tibetan:["།","༎"],Sharada:["𑇅","𑇆"],Siddham:["𑗂","𑗃"],
  Newa:["𑑋","𑑌"],Bhaiksuki:["𑱁","𑱂"],Cham:["꩝","꩞"],Kawi:["𑽃","𑽄"],Khmer:["។","៕"],
  Balinese:["᭞","᭟"],Javanese:["꧈","꧉"],Burmese:["၊","။"],Soyombo:["𑪛","𑪜"],ZanabazarSquare:["𑩂","𑩃"]},
  DANDA_DEFAULT=["।","॥"];
function dandaGlyph(form){   // → the script daṇḍa for a daṇḍa marker under an active script, else null
  if(!isSanskritLang()||!orthoScript()) return null;
  const d=SCRIPT_DANDA[ORTHO_SCHEME]||DANDA_DEFAULT;
  if(form==="||"||form==="//"||form==="‖"||form==="॥") return d[1];   // feature 17: "‖" (U+2016) is the double-daṇḍa DISPLAY glyph the store folds "||"/"//" into (the token FORM in an IAST sample IS "‖"); match it so the double daṇḍa converts to the script glyph like the single one — the diagram folds daṇḍa PUNCT into hanging satellites drawn via hangForm=dandaGlyph||p.form (never t.ortho), so without this a "‖" showed raw instead of ॥/༎. "॥"/"।" are the same tokens as a DEVANAGARI-stored file spells them.
  if(form==="|"||form==="/"||form==="।") return d[0];
  return null; }
// item 11: the SCRIPT drives the MAIN GLYPH. "Original" (default, ORTHO_SCHEME="") → the stored form;
// "None" (ORTHO_SCHEME="none") → the DISPLAYED transliteration becomes the main glyph; a script id → that script.
function bform(t){ const f=(t&&t.mform!=null)?t.mform:(t?t.form:"");
  /* Script=Latin + Displayed=CSL name ONE Latin line, so CSL is the GLYPH itself — not a second row
     under an IAST one saying the same word in a different notation. This is the substitution
     Script=None already makes for Chinese three lines down, reached from the other side: there the
     romanisation replaces a Han glyph, here a marked romanisation replaces an unmarked one.
     trTxt then drops the transliteration row on its own, since it suppresses a value equal to bform. */
  if(typeof saCslTop==="function" && saCslTop() && show.translit && t && t.translit) return dispScheme(t.translit,TRANSLIT_SCHEME);
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
_lazyFont("GW_TIE_F",()=>magFont(26));   // reassigned by refreshFontStacks() alongside every other measurement font, so this stays in step with a live scheme override too
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
  /* ⚠ The shortcut below is about IAST specifically, so it must not swallow a scheme that says something
     ELSE about the token. CSL respells the form with its junctions marked (`vartm'`, `êty`), and that
     value is in o.translit like any other scheme's — but this branch returned the STORED form instead,
     so under any script the diagram's transliteration slots showed plain IAST and CSL never appeared in
     them at all. Gated on the displayed scheme being the plain romanisation now; anything else falls
     through to the ordinary o.translit path below. */
  if(isSanskritLang() && orthoScript() && TRANSLIT_SCHEME!=="csl"){   // feature 7: Sanskrit's stored form IS the IAST — show it as the romanisation ROW beneath the script glyph (bform rendered that glyph FROM this very IAST). fillTranslit leaves o.translit empty here (IAST→IAST is a no-op in _iast()), so read the stored surface form directly.
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
function ascent(f){_cv.font=f; const m=_cv.measureText("Ábgjyd漢"); return m.actualBoundingBoxAscent||11;}   // how far tokens reach above the baseline — descent()'s counterpart, mixed Latin+Han sample so it answers honestly for either
/* ⚠ THE STEP FROM ONE BELOW-TOKEN ROW TO THE NEXT, WRITTEN ONCE.
   It was the literal expression `belowGap()` in fifteen places — every renderer's draw AND every
   renderer's reserve (stackH / belowH / stackBot / --undpad / tieLead / mwtDepth) — which is exactly the
   arrangement that has to stay in lockstep or a row is drawn where nothing was reserved for it.
   The 18 is a constant calibrated against a 15px form, and it has only ~1.6px of slack: measured on the
   fixture, the form's ink bottom sits at 166.0 and the POS row's top at 167.6. So a form drawn at DOUBLE
   size (the ornamental Sanskrit scripts — see TOK_MAG) eats that slack and overruns the row below by a
   couple of pixels. The magnification's own extra descent is therefore added back here, at the one
   expression every consumer shares, so the draws and the reserves grow together and neither clipping nor
   misalignment is possible. Exactly `belowGap()` whenever TOK_MAG is 1, which is every document
   but those.
   ⚠ STACK_DROP DOES NOT LIVE HERE. It was folded into this function on a first pass, which put it in
   EVERY row-to-row step (translit→gloss, gloss→gloss, gloss→POS) instead of only the step that actually
   needs it — the one from the GLYPH row itself down to the first annotation row, where a stacking
   script's subjoined cluster genuinely reaches deeper than a Latin descender does. Every OTHER gap
   (between two annotation rows, both plain Latin) got the same bump for no reason, inflating the whole
   stack instead of just its top gap. STACK_DROP is now added ONCE, by whichever call reserves/draws the
   first row below the glyphs (belowStack's `y0+STACK_DROP` seed, the hierarchy node's `dropY`, and the
   MWT tie's own `r.dfy`→`r.dtr`/`r.dpos` step) — see stackDropExtra()'s own note for what it measures,
   and belowReserveH() below for the one place the reserve math computes the same one-time addition. */
function belowGap(){ return 18+descent(POS_F)+(TOK_MAG>1?descent(WORD_F)*(1-1/TOK_MAG):0); }
// how many rows sit below the glyph line (translit + gloss/mgloss tiers + POS) — the ANNOTATION rows,
// never the glyph row itself, which is why n can be 0 (a token with translit/glosses/POS all off).
function belowRows(hasTr,tierCount,hasPos){ return (hasTr?1:0)+tierCount+(hasPos?1:0); }
// total vertical reserve those rows need. n·belowGap() for the n row-to-row steps, PLUS STACK_DROP
// exactly once — never per row — because it only ever compensates for the ONE gap between the glyph
// line and the first thing drawn under it; every reserve site that used to fold STACK_DROP into each of
// its belowGap() calls (stackH/belowH/stackBot/--undpad/the stemma's belowReserve+H) now goes through
// this instead, so the reserve and the actual draw (belowStack et al.) can't drift apart.
function belowReserveH(hasTr,tierCount,hasPos){ const n=belowRows(hasTr,tierCount,hasPos); return n*belowGap()+(n>0?STACK_DROP:0); }
function xHeight(f){_cv.font=f; const m=_cv.measureText("x"); return m.actualBoundingBoxAscent||6;}   // the x-height of a (POS) glyph — subtracted from the inter-tier step to seat the MWT bracket (POS tags now render via c2sc small caps, whose visual height sits at x-height, not full cap height)
// sizeSid() — the JS width-measurement this comment described — is GONE: .sid-in is a contenteditable
// span now (js/core/document.js's buildBlock), not an <input>, and a span with no explicit width simply
// sizes to its own text as a flex item, same as .bm-id already does. That JS math (measuring at the
// field's own computed font-size, +14 for its padding/border) was itself a correct fix for the WRONG
// problem: the residual uneven padding a user kept seeing on long ids was WebKit's <input> internal
// shadow DOM, invisible to any amount of outer-box arithmetic — removing the <input> removed the bug.
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
/* CASING OUTSET — how far the casing arrowhead must stand proud of the stroke arrowhead, on ALL THREE sides.
   1.75px, read off the CSS rather than invented: .arc-casing strokes at calc(var(--arc-stroke) + 3.5px) against
   .arc-path/.edge's var(--arc-stroke) (styles/app.css), and a stroke grows symmetrically about its centreline,
   so the halo either side of a cased LINE is 3.5/2 = 1.75px. The head now carries the same halo as the line it
   terminates. */
const AH_OUTSET=1.75;
/* 1/sin(α), the mitre factor for the apex, where α = atan(AH_RATIO) is the head's half-angle at the tip.
   THE HEAD IS AN ISOSCELES TRIANGLE: apex at T, axial length s, half-width s·AH_RATIO — so tan α = AH_RATIO
   and sin α = AH_RATIO/√(1+AH_RATIO²), giving 1/sin α = √(1+AH_RATIO²)/AH_RATIO = 1.9437 at AH_RATIO = 0.6.
   Offsetting the two LEADING edges outward by `out` moves their intersection — the apex — FORWARD along the
   axis by out/sin α (the standard wedge-mitre result: a vertex travels 1/sin of its half-angle per unit of
   edge offset). This is precisely what the old "just pass a bigger s" casing could never do: `s` pins the apex
   at T and only pushes the BASE backwards, so the casing showed behind the head and its tip and both leading
   edges sat exactly on the stroke head's own edges — no halo at the front at all, which is the bug. */
const AH_MITRE=Math.sqrt(1+AH_RATIO*AH_RATIO)/AH_RATIO;
/* `out` inflates the head into the triangle whose three edges each lie `out` further out along their own
   normals — a uniform outset, not a scale:
     · apex:   T' = T + u·(out·AH_MITRE)                   — the mitre above (3.401px at out = 1.75)
     · base:   one further `out` BACKWARDS, so the axial length becomes s + out·AH_MITRE + out
     · flanks: free. Offsetting all three edges of a triangle by the same distance yields a SIMILAR triangle
               (the angles are unchanged), so the half-width is still (axial length)·AH_RATIO — no separate
               widening term, and no need to fudge AH_RATIO.
   Verified numerically (scratch: perpendicular distance from each casing edge to its stroke-head counterpart)
   at 1.7500 on all three edges, for horizontal, diagonal and arbitrary-angle heads alike.
   out = 0 (or omitted) reproduces the original path bit-for-bit, so every un-cased call site is untouched. */
function arrowPath(from,tip,s,out){const o=out||0,ext=AEXT+o*AH_MITRE,L=s+o*(AH_MITRE+1);
  const [ux,uy]=normv(from,tip),T=[tip[0]+ux*ext,tip[1]+uy*ext],px=-uy,py=ux,base=[T[0]-ux*L,T[1]-uy*L],w=L*AH_RATIO;
  return `M ${T[0]} ${T[1]} L ${base[0]+px*w} ${base[1]+py*w} L ${base[0]-px*w} ${base[1]-py*w} Z`;}
/* stop a line at the (overshot) arrowhead base — backoff(tip,frm,s) returns exactly arrowPath(frm,tip,s)'s base
   point. DELIBERATELY BLIND TO AH_OUTSET: the STROKE's stop must not move, and the casing line shares the very
   same `d` as the stroke it haloes (one path, two widths), so there is only one stop point to place. It still
   hides: the casing head's base sits a further AH_OUTSET back along the axis, so the stop lands *inside* the
   casing triangle, where that triangle is (s + AH_OUTSET·AH_MITRE)·AH_RATIO ≈ 5.2px half-wide — comfortably
   over the casing line's own 2.5px half-width (--arc-stroke + 3.5px). */
function backoff(tip,frm,d){const [ux,uy]=normv(frm,tip); return [tip[0]-ux*(d-AEXT), tip[1]-uy*(d-AEXT)];}
function edgeAngle(x1,y1,x2,y2){let a=Math.atan2(y2-y1,x2-x1); if(a>Math.PI/2)a-=Math.PI; if(a<-Math.PI/2)a+=Math.PI; return a;}
function labelAngle(x1,y1,x2,y2){const a=edgeAngle(x1,y1,x2,y2); return Math.abs(a)>Math.PI/4?0:a;}   // steeper than 45° → horizontal label

/* ── CJK PUNCTUATION IS ATTACHED BY ITS OWN GLYPH, and nothing else knows ─────────────────────────────────────
   The SpaceAfter rule displaySent uses below (see its comment) is a TYPOGRAPHIC test, and in a script written
   without word spaces it has nothing to read: every token carries SpaceAfter=No, so `gluedLeft` and `gluedRight`
   are BOTH true for every mark, the "attached on exactly one side" test never fires, and the tiebreak — the
   head's direction — silently becomes the whole rule. That tiebreak is wrong for exactly the marks that matter
   most: a sentence-medial 、/，separates two clauses, and both UD and SUD attach such a mark to the head of the
   material it introduces, i.e. to a token on its RIGHT, so `h>i+1` held and the comma folded onto the FOLLOWING
   word — 我喜欢猫，他喜欢狗 drawn as 我喜欢猫 ，他 喜欢狗. In Chinese and Japanese a sentence-medial mark belongs
   to what precedes it, whatever the parser hung it off.
   THE GLYPH DECIDES, NOT THE DOCUMENT LANGUAGE. These characters are CJK-exclusive and their typographic side is
   fixed by the character itself, so testing the glyph settles a Chinese sentence quoted inside an English or
   Korean document too, and cannot misfire on a language that never writes them — Thai/Lao/Khmer/Tibetan/Burmese
   are all in SPACELESS_LANGS (js/core/state.js) and use NONE of these, so gating on isSpacelessLang() would have
   covered them for no gain while still missing the embedded sentence. DOCLANG is therefore not consulted here.
   Both halves are needed, and they are the same fact seen from two sides: a closing 」）hugs what PRECEDES it,
   an opening 「（《 hugs what FOLLOWS and must never be dragged left. The openers are listed for that reason —
   without them the force-left set would have to be a blocklist, and a parser that hangs 「 off the matrix verb to
   its left (which happens) would still fold the quote mark onto the wrong side.
   DELIBERATELY NOT INCLUDED — three sets of near-misses:
     · ASCII/shared marks in a CJK document (", . ” ’ …). A shared glyph appears in spaced text too, where
       SpaceAfter genuinely carries information, and overriding it there would discard real evidence in favour of
       a guess. "," is not by itself evidence of anything.
     · ・ U+30FB, the katakana middle dot: a separator INSIDE a name (ジョン・スミス), set solid on both sides and
       belonging to neither — no typographic side to assert.
     · 〜 U+301C and the CJK dashes: range/linking marks, set solid on both sides — same reason.
   The sentence-ENDERS 。！？ ARE included even though "sentence-medial" is the case that was broken. They are
   left-attaching on the identical grounds, and at a true sentence end the override changes nothing (a mark with
   no following token cannot merge right — see the `i<t.length-1` guard). What it does fix is the mark that is
   final for a CLAUSE but medial in the token list: 「…。」, or two sentences annotated as one.
   Nothing downstream needs to know: a forced-LEFT mark takes the ordinary TRAILING path (`hangs`), so its `sp`
   still comes from the SpaceAfter of the token to its left — =No throughout a spaceless script, so the mark is
   drawn set solid against its host, which is exactly what CJK typography wants — and a forced-RIGHT one still
   goes through `pendingLeads`. The head remapping, the goeswith re-fold and the MWT remap all read the same two
   lists as before. */
const CJK_PUNCT_LEFT=new Set(Array.from("、。〉》」』】〕〗〙〛〞〟！），．：；？］｝｡｣､"));   // trail the material before them: ideographic comma/full stop, the fullwidth and halfwidth forms, and every CLOSING bracket/quote
const CJK_PUNCT_RIGHT=new Set(Array.from("〈《「『【〔〖〘〚〝（［｛｢"));                       // lead the material after them: every OPENING bracket/quote
// → "left" / "right" / "" (no CJK claim). Tested on the WHOLE form, not per character, so a multi-mark PUNCT
// token (「「 or ！？) still answers, while a token that merely CONTAINS one does not get its side asserted.
function cjkPunctSide(form){ const f=String(form||""); if(!f) return "";
  const chars=Array.from(f);
  if(chars.every(c=>CJK_PUNCT_LEFT.has(c))) return "left";
  if(chars.every(c=>CJK_PUNCT_RIGHT.has(c))) return "right";
  return ""; }
/* merge-punctuation is a display transform: fold each punctuation mark OFF the adjoining token (drop it from the
   annotation token list so arcs/nodes/columns ignore it) but keep it, per host, as a `hangs` satellite entry
   {form, sp, orig}. Heads are remapped. Returns the display tokens plus map[displayIndex] = original token index
   (for selection sync with the grid); each hang carries its own original index for the satellite's selection. */
function displaySent(sent){
  const rtl=sentRTL(sent), mwt=sent.mwt||[];
  if(!show.mergePunct){ const D0=foldGoesWith({tokens:sent.tokens, map:sent.tokens.map((_,i)=>i), rtl, mwt}); D0.xpos=extPosSpans(D0); return D0; }   // the goeswith fold runs on BOTH paths — it is the relation's rendering, not an option
  const t=sent.tokens, disp=[], oldToDisp=new Array(t.length).fill(-1);
  /* item 2 — a punctuation token folds onto a neighbour. WHICH neighbour is decided by the mark's own GLYPH where
     that glyph states a side, then by SPACING, and by the dependency edge only when neither says:
       · a CJK mark (、。！？，「」（） …) → the side the character itself attaches to — see cjkPunctSide above
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
      const cjk=cjkPunctSide(tk.form);                      // a CJK mark states its own side — see CJK_PUNCT_LEFT above; "" for every other glyph
      const right=cjk?(cjk==="right"):((gluedLeft!==gluedRight)?gluedRight:(h>i+1));   // the glyph first (it is the only witness in a spaceless script), then attached-on-exactly-one-side, then the edge
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
  const wform=tk.map(t=>fmeas(t,WORD_F));
  // slot = widest of word and (when shown) POS/transliteration/above-token deprel; uniform spacing → same minimum gap as tokens
  const w=tk.map((t,i)=>Math.max(wform[i], show.pos?meas(posDisp(t),POS_F):0, trLayer()?meas(trTxt(t),trFont(t)):0, depAbove?meas(t.deprel||"",POS_F):0, glossSlotW(t), 16));   // item 13: fold in the gloss-tier rows so a wide gloss can't crowd/overlap its neighbour
  const hg=tk.map(t=>tailW(t,WORD_F));   // real-width room reserved to each host's inline-end for its folded punctuation (node centre c[i] stays on the host, so arc endpoints are unchanged)
  const ld=tk.map(t=>leadW(t,WORD_F));   // item 2: room reserved at the host's inline-START for right-merging punctuation that leads it
  // Subject=Generic: reserve a virtual ∅-token band just BEFORE this token's own slot (not widening the slot itself,
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
//   BOTTOM-TO-TOP, WITH THE WHOLE SUBTREE FANNED OUT AT EVERY STEP UP: place() recurses into every child (and
//   THEIR children, all the way down) before it runs the separation loop over its OWN direct children — so the
//   deepest layer is fully packed and decluttered first, and a parent's own de-collision pass never runs until
//   every layer beneath it has already settled. Whenever that pass has to push a child apart from its sibling,
//   `shift()` moves that child's ENTIRE subtree — every layer below it — by the same dx, rigidly, so the
//   correction a lower layer already has doesn't come undone as we climb back toward the root.
//   lext/rext (added below) are what make that upward walk SEE the lower layers at all: each node tracks its own
//   subtree's actual left/right reach (own box ∪ every descendant's, kept in lockstep through every shift), and
//   the separation loop compares THAT — not just the two nodes' own lw/hgw/ldw — when it decides how far apart
//   two siblings need to be. Comparing bare node widths one layer at a time used to let a subtree's own box be
//   perfectly clear of its immediate sibling while something hanging off it two or three layers down (a long
//   MGloss/gloss stack under an otherwise ordinary-width node is the case this app actually hits) still overlapped
//   an unrelated cousin subtree the level above never re-examined — the fan-out kept the SHAPE of a widened
//   subtree intact on the way up, but nothing propagated its true footprint upward for the NEXT separation to see.
//   A synthetic stress test (2000 random trees, node widths 5–85px) hit that collision in 59% of trees under the
//   bare-width comparison; tracking lext/rext eliminated it in all 2000.
function tidyLayout(size,root,childrenOf,{lw,hgw,ldw,elw,SPW,NGAP}){
  const x=new Array(size).fill(0), lext=new Array(size).fill(0), rext=new Array(size).fill(0);   // lext/rext[i]: node i's own subtree's actual left/right extent (its own box, unioned with every descendant's) — see the block comment above
  let cur=6;
  function shift(i,dx){ x[i]+=dx; lext[i]+=dx; rext[i]+=dx; childrenOf(i).forEach(c=>shift(c,dx)); }   // rigid: x AND its subtree's extent move together, so a lower layer's already-settled shape survives the trip up to the root
  (function place(i){ const ks=childrenOf(i).slice().sort((a,b)=>a-b);
    if(!ks.length){ x[i]=cur+ldw(i)+lw(i)/2; lext[i]=x[i]-lw(i)/2-ldw(i); rext[i]=x[i]+lw(i)/2+hgw(i); cur=rext[i]+NGAP; return; }   // item 2: leading-satellite room before the node
    ks.forEach(place);   // deepest layer first — every child's own subtree (lext/rext included) is fully resolved before this node's separation loop below ever runs
    for(let j=1;j<ks.length;j++){ const a=ks[j-1],b=ks[j],
      need=Math.max((rext[a]-x[a])+(x[b]-lext[b])+NGAP, elw(a)+elw(b)+4*SPW), have=x[b]-x[a];   // widest of the two subtrees' REACH (not just a/b's own node boxes — see block comment) and the sibling edge-label clearance (~2 word spaces)
      if(have<need-0.5){ const dx=need-have; for(let m=j;m<ks.length;m++) shift(ks[m],dx); cur=Math.max(cur, rext[ks[ks.length-1]]+NGAP); } }   // fan the push out to b's (and every later sibling's) WHOLE subtree, every layer below it, in one rigid move
    x[i]=(x[ks[0]]+x[ks[ks.length-1]])/2;
    lext[i]=Math.min(x[i]-lw(i)/2-ldw(i), ...ks.map(c=>lext[c])); rext[i]=Math.max(x[i]+lw(i)/2+hgw(i), ...ks.map(c=>rext[c]));   // this node's own reach is the union of its own box and everything now settled beneath it — what the NEXT layer up compares against
    })(root);
  return x;
}
function stemmaLayout(sent,catNodes,posBelow){const pad=2, SP=meas(" ",WORD_F)+8;   // gap matches arc view; slot also fits the baseline POS tag so they don't crowd
  const lw=sent.tokens.map(t=>Math.max(fmeas(t,WORD_F),catNodes?meas(posDisp(t)||"X",POS_F):fmeas(t,NODE_F), posBelow?meas(posDisp(t)||"X",POS_F):0, trLayer()?meas(trTxt(t),trFont(t)):0, glossSlotW(t)));   // item 13: include the gloss-tier width so glosses stay spaced
  const c=[]; let x=pad; sent.tokens.forEach((t,i)=>{ x+=genericSubjGapW(sent.tokens,i,catNodes?POS_F:NODE_F)+leadW(t,NODE_F); c.push(x+lw[i]/2); x+=lw[i]+tailW(t,NODE_F)+SP; });   // reserve inline-START room for right-merging leads (item 2) + inline-end room for trailing satellites; node centre stays on the host (arc endpoints unchanged). Subject=Generic: a virtual ∅-token band inserted just before, same idea as linear()
  const total=x-SP+pad;
  return {c,total,lw};   // caller mirrors after any label-spacing pass
}
function mirror(c,total){ if(RTL) for(let i=0;i<c.length;i++) c[i]=total-c[i]; }   // in-place RTL flip of x-centres
/* transliteration + POS stacked below a word baseline; returns the bottom y (pushes hit-boxes) */
function hasTr(toks){ return trLayer() && toks.some(x=>trTxt(x)); }   // the transliteration row is active (romanisation, or originals under an orthography) → reserve it for every token (keeps POS aligned)
function belowStack(g,x,y0,tk,boxes,trRow){ let y=y0+STACK_DROP;   // trRow: reserve the transliteration row even for a token that has none (so POS stays aligned across the sentence). +STACK_DROP seeds the gap from the glyph baseline to whichever row is drawn FIRST below it — the one gap a stacking script's subjoined depth actually needs — and every later belowGap() step in this function is the plain, un-bumped one (see belowGap's own note)
  const showTr = trRow!=null ? trRow : (trLayer() && !!trTxt(tk));
  if(showTr){ y+=belowGap(); const rt=trTxt(tk); if(rt){ const e=E("text",{class:"translit"+frnUp(tk),x:x,y:y,"text-anchor":"middle"}); e.textContent=rt; if(trRowEdit())e.classList.add("tr-edit"); g.appendChild(e); boxes&&boxes.push({x,y:y-4,hx:meas(rt,trFont(tk))/2,hy:7}); svgSeamMark(g,tk,x,y,meas(rt,trFont(tk))/2,trFont(tk),boxes,null,"translit"); } }   // Item 8: the translit row gains the SAME descender-matched top gap the POS row carries (+descent(POS_F), the label-font descender) so the row above's descenders don't crowd it; .tr-edit → click-to-edit the romanisation, or the STORED transliteration behind it (see trRowEdit). The romanisation is a WORD-LIKE row, so it carries the seam mark too — a word broken across tokens reads as broken on every row that spells it out
  belowTiers().forEach(tier=>{ y+=belowGap(); const txt=tierText(tk,tier), dtxt=txt||"…"; const e=E("text",{class:"gloss gl-edit"+frnUp(tk),x:x,y:y,"text-anchor":"middle","data-tier":tier,tabindex:"0"}); setGlossText(e,tier,dtxt); if(!txt)e.classList.add("gl-empty"); g.appendChild(e);
    /* ⚠ THE SAME FONT AND THE SAME measGloss() THE SEAM MARK BELOW ALREADY USES — this box feeds fitTight()
       (js/diagram/diagram-core.js), which resizes the wrapped SVG's own viewBox to its drawn content, so a
       box measured wrong here means the SVG can come out narrower than what MGloss actually draws — clipped
       by .diagram.wrapped's overflow-x:hidden, since fitTight is the ONE pass standing between "the row-
       packing budget accounted for glossSlotW" and "the finished SVG is actually wide enough". This used to
       read meas(dtxt,trFont(tk)) — trFont() is the TRANSLITERATION font, not this tier's own, and plain
       meas() ignores the c2sc/onum small-caps width adjustment measGloss() exists for (see measGloss's own
       note: "MGloss text is almost always MOSTLY an abbreviation run"). Wrong font, wrong measurement, and
       the seam mark one line down was already doing this correctly — this box just never matched it. */
    boxes&&boxes.push({x,y:y-4,hx:(tier==="mgloss"?measGloss(dtxt,tierFont(tier,tk)):meas(dtxt,tierFont(tier,tk)))/2,hy:7});
    if(tier==="mseg"||tier==="mgloss") svgSeamMark(g,tk,x,y,(tier==="mgloss"?measGloss(dtxt,tierFont(tier,tk)):meas(dtxt,tierFont(tier,tk)))/2,tierFont(tier,tk),boxes,null,tier); });   // Item 8: each gloss / morphemic-gloss tier gains the SAME +descent(POS_F) top gap as the POS row, so all sub-token tiers share the descender-based breathing room; BELOW the transliteration and ABOVE the POS row; double-click or Enter to edit → MISC. The SEGMENTATION tier (mseg) and the MORPHEMIC GLOSS tier (mgloss) both take a seam mark — a mark drawn regardless of whether THIS tier happens to be annotated for this token (measured off the "…" placeholder's own width when it isn't), because the seam it decorates is a fact about the SEGMENTATION, not about this tier's own annotation coverage. Gating on `txt` used to silently drop the mark wherever MGloss was sparser than MSeg (a common, unremarkable state for hand-glossed data) — the row still shows a "…" cell there, so a boundary that MSeg draws cleanly would vanish from MGloss for that one seam while surviving on the very next one, reading as the mark randomly relocating/centring rather than a coverage gap. Both are PER-MORPHEME rows that a word-break genuinely interrupts; the lexical GLOSS tier (a single whole-word meaning, on request unchanged) does not
  if(show.pos && tk.upos){ y+=belowGap(); const pd=posDisp(tk); const e=E("text",{class:"tok-pos",x:x,y:y,"text-anchor":"middle"}); e.textContent=pd; svgTip(e,posTitle(tk.upos)); g.appendChild(e); boxes&&boxes.push({x,y,hx:meas(pd,POS_F)/2,hy:6}); }   // POS hover tooltip (Item 2). Item 1: +descent(POS_F) extra top gap on the POS step — the label font's (POS_F) descender depth, mirroring how the above-token rows fold in descent(WORD_F) — so the POS row isn't crowded by the descenders of the row above it. Every below-reserve that feeds a row height (stackH / belowH / stackBot / --undpad) folds in the SAME descent(POS_F), so POS stays aligned across renderers and nothing clips.
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
function tieLead(){ const PIN=5; return show.pos ? belowGap()-xHeight(POS_F)-5-PIN : 8; }
/* THE GAP ABOVE THE MULTI-WORD-TOKEN SURFACE FORM, held constant across the magnification. The literal
   20 seats a 15px form "a comfortable ~9px below the tie" — i.e. 20 minus that form's own ascent — so at
   mag 1.5 the enlarged ascent eats into the gap, running the glyphs into the bracket above them. Adding
   the ascent's magnified excess, A × (mag − 1), keeps the INK top exactly where it sits for every
   non-ornamental script, which is what the reserve above it was tuned against. Same shape as
   belowGap()'s own magnification term, and the same reason: a draw and its reserve have to move
   together — `bot` below is computed FROM dfy, so tieLayout's depth follows this for free.
   Exactly 20 at mag 1, i.e. every document but the ornamental scripts. */
function mwtFormLead(){ return 20+(TOK_MAG>1?TOK_ASC*15*(TOK_MAG-1):0); }
function tieLayout(D){ const rows=tieRows(D); if(!rows.length) return {rows:[],depth:0,lead:0};
  const PIN=5, STEP=belowGap(), lead=tieLead();
  let top=0, deepest=0;
  for(let tier=0;;tier++){ const inTier=rows.filter(r=>r.tier===tier); if(!inTier.length) break;
    let bot=top;
    inTier.forEach(r=>{ r.dy=top;
      if(r.kind==="gw"){ r.dfy=0; r.dtr=0; r.dpos=0; bot=Math.max(bot,top+gwDepth()); return; }   // a tie carries NO label (the relation is marked by the mark alone), so its row is only as deep as the glyph's own ink
      r.dfy=top+PIN+mwtFormLead();                                                        // tie body PIN below the top; the label baseline a further mwtFormLead() below it
      r.dtr=(r.kind==="mwt"&&trTxt(r.m))?r.dfy+STEP+STACK_DROP:0;                          // an MWT's own transliteration row — the FIRST row below the tie's own surface-form glyphs, so it's the one that gets STACK_DROP (once), same rule as belowStack's seed
      r.dpos=(r.kind==="mwt"&&r.pos)?(r.dtr?r.dtr+STEP:r.dfy+STEP+STACK_DROP):0;           // …and, on a coinciding pair, the ExtPos annotation LAST — form → translit → POS, the same order a plain token's below-stack uses. STACK_DROP only if dtr didn't already spend it (no double-count when both rows are present)
      bot=Math.max(bot, r.dpos||r.dtr||r.dfy); });
    deepest=bot; top=bot+STEP; }                                                           // the next tier starts one inter-tier step below the deepest label of this one
  return {rows, depth:PIN+lead+deepest+1, lead}; }                                          // depth is measured from the below-stack bottom: +PIN for the y offset mwtTie is handed, +1 slack — for a lone plain MWT tie this reproduces the former fixed 39+descent−xHeight exactly
/* item 8 — A SELECTED MULTI-WORD TOKEN. There is no separate "this MWT is selected" flag to invent: clicking a tie
   row runs selectMWTRange (setRange(si,m.from,m.to) + pick), so the MWT's COMPONENT RANGE being the current range
   selection IS the state, for every route in alike (the tie glyph, the IAST row, the right-click menu). Matching
   BOTH ends keeps an ordinary marquee that merely happens to start at the same token from lighting a tie it doesn't
   cover. selRange always holds ORIGINAL token ids, which is why the display MWT records carry _from/_to.
   THERE USED TO BE AN EXCEPTION HERE, and it is gone: while the surface form was being EDITED this returned
   false, so the tie, the surface form and the transliteration row all sat plain. The reason given was that
   makeEditable copies the edited element's COMPUTED INK into its field, so an accented tie would hand the input
   an accent-coloured `color` for the duration of the edit. But every OTHER token does exactly that — .node.sel /
   .tok-group.sel stay on while a token's form is edited, and their fields carry the accent ink — so the MWT was
   the one thing in the app that went plain at the very moment it was selected, and since clicking a tie IS what
   opens its editor, that was the only state a click could ever produce. An MWT now reads like any other selected
   token. MWT_EDIT is still set and cleared around the edit (context-menu.js) and still names the open editor for
   anything that needs to know; it simply no longer suppresses the selection. */
let MWT_EDIT=null;   // {si, from} — the MWT whose surface form currently has an inline editor open (original token id)
function mwtTieSelected(si,fromId,toId){ if(!(si>=0)||fromId==null) return false;
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
  const mrt=trTxt(m); if(mrt&&r.dtr){ const tr=E("text",{class:"translit mwt-tr"+(iastRow?" mwt-tr-edit":""),x:mx,y:y+r.dtr,"text-anchor":"middle"}); tr.textContent=mrt; svg.appendChild(tr);   // Item 9: draw the MWT transliteration row FIRST, so the MWT form (and its opaque backing) below paints ON TOP where the two rows crowd — mirrors how .stext is raised above .strans
    if(si!=null){ tr.setAttribute("data-s",si); tr.setAttribute("data-mwtfrom",fromId); }   /* THE ROW IS TAGGED FOR THE MENU IN EVERY LANGUAGE, and for the EDITOR only under iastFormEdit(). Right-clicking an MWT's transliteration used to fall through to the ordinary token menu everywhere except Sanskrit, because data-mwtfrom (which is what the delegated contextmenu handler resolves an MWT from) was attached only on the iast row — yet the row belongs to the MWT whichever language it is in, so its menu is the MWT's. The .mwt-tr-edit class stays gated, because THAT is what the click-to-edit handler matches, and outside iastFormEdit this row is a derived romanisation of the surface form that nothing writes back. */
    if(si!=null&&iastRow){ tr.style.cursor="text";   // tagged ONLY under iastFormEdit(): everywhere else this row is a plain romanisation of the surface form (m.translit), nothing writes it back, and the surface form itself is already the editable field.   // cursor:text, not pointer — this row IS a text field you type into, so it takes the same I-beam the other click-to-edit diagram texts carry (.tr-edit / .gl-edit / .cform, all cursor:text in app.css). A pointer would promise a button.
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
function htmlTieBottom(r){ const PIN=6, STEP=belowGap(), lead=5+tieLead();
  if(r.kind==="gw") return lead+r.dy+gwDepth();                            // the tie has no label under it — it reaches only as far as the glyph's own ink
  if(r.kind==="xpos") return lead+r.dy+PIN+20;                             // the ExtPos value IS the label
  const n=belowRows((trLayer()&&trTxt(r)),0,!!r.pos);
  return lead+r.dy+PIN+20+n*STEP+(n>0?STACK_DROP:0); }                     // MWT surface form, then its transliteration row, then any ExtPos annotation — STACK_DROP once (belowReserveH's math), for the same reason belowStack seeds it once rather than per row
function mwtDepth(D){ return tieLayout(D).depth; }   // extra vertical room the bracket stack needs below the below-stack bottom. Item 1 made this tier-aware — one entry per bracket TIER, each as deep as the deepest label that tier carries (an MWT surface form, plus its transliteration row and/or an ExtPos annotation) — so an ExtPos bracket that pushes an overlapping MWT tie down a tier also grows every reserve that folds in mwtDepth (arcsWrapped's per-row tieBot, projWrapped, belowH) in lockstep. With a single plain MWT tie and no ExtPos it returns exactly the former fixed 39+descent(POS_F)−xHeight(POS_F) (39 with no POS row), +belowGap() for a transliteration row — the seating those constants were tuned for is unchanged.

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
  const M=6;
  /* ⚠ A LEFT EDGE PAST THE ROW'S OWN NOMINAL START DOES NOT WIDEN THE VIEWPORT. Every row's own layout
     (linear(), js/diagram/diagram-core.js) starts its first token at x=pad (a small positive number, not
     0) — so under ordinary content `a` never goes negative on its own, and this clamp is a no-op. What
     DOES go negative is an MWT tie/bracket whose surface FORM legitimately reaches left of its first
     component's own nominal position — and letting that stretch the viewBox's left edge grows `w` by
     exactly that much too, which is content this ROW's wrap-budget was never asked about. Reported live:
     an MWT further down a wrapped block pushed the whole SVG's width out to the left, and since the
     container width comes from the wrap budget (unchanged, still ignorant of this element), the SAME
     row's RIGHT-side content — a wide MGloss on its last token — ran out of room and was clipped by
     .diagram.wrapped's overflow-x:hidden. Preferred fix, on request, over reflowing the wrap decision to
     account for it: let the overflow paint into the left margin instead (svg{overflow:visible} — see
     .diagram.wrapped>svg in app.css) by simply not counting it toward the viewBox's own width. `b` (the
     RIGHT edge) is NOT clamped the same way — fitTight expanding rightward for real content (MGloss
     included) is the whole reason this function exists.
     ⚠ AND `overflow:visible` ALONE DOES NOT REACH THE SCREEN — svg{overflow:visible} only stops the SVG's
     OWN viewport from clipping content outside its [0,w] box; `.diagram.wrapped` (the flex container wrap()
     builds around the svg) still clips at ITS OWN edges via overflow-x:hidden, and that box starts flush
     with the svg's left edge, with nothing reserved to its left for content the clamp just excluded. So the
     clamped overflow painted straight into the NEXT clip boundary out — traded a right-edge MGloss clip for
     an invisible-on-the-left MWT, reported live as "the same issue" surviving the first fix. `leftOverflow`
     publishes exactly how far LEFT of the finished viewBox's own `x` the true content reaches, so
     arcsWrapped's caller can give `.diagram.wrapped` a matching negative margin-left — shifting the
     CONTAINER's own box (and so its clip boundary) left by that amount, which is what actually makes room
     rather than merely un-hiding content the next box out clips anyway.
     ⚠ MEASURED AGAINST `x` (the viewBox's OWN left edge, post-margin), NOT `aFit` — a first cut used
     `aFit-a`, which forgets that `x` already sits `M` further left than `aFit` (the same margin every
     unclamped diagram gets for free). That undercounted the shift by exactly `M`: content truly reaching to
     a=-30 with aFit=0, M=6 gives x=-6, so the content sits 24px left of the svg's own box (x-a), not 30 —
     `aFit-a` shifted the container 30px, 6px MORE than needed, which merely relocated the clip 6px left of
     where it needed to be rather than removing it (verified on a synthetic repro: contentScreenX landed 24px
     left of the shifted container's own left edge, still clipped, before this correction). `Math.max(0, …)`
     is still required: for content only slightly negative (−M < a < 0) `x` sits to ITS left already, needing
     no extra margin at all, and the naive `x-a` would otherwise go negative there. */
  const aFit=Math.max(0,a);
  const x=Math.floor(aFit-M),y=Math.floor(c-M),w=Math.ceil(b-aFit+2*M),h=Math.ceil(d-c+2*M);
  svg.setAttribute("viewBox",`${x} ${y} ${w} ${h}`); svg.setAttribute("width",w); svg.setAttribute("height",h);
  svg._leftOverflow=Math.max(0,x-a);}
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
// spreadForLabels only clears EDGE-LABEL width (`e.w`) between siblings sharing a head — a subtree shift made purely
// for that can still leave two SURFACE-ADJACENT nodes closer together than their own below-stack content (word/POS/
// translit/gloss rows, sized by stemmaLayout's `lw`) needs, since a label like "mod" is usually far narrower than a
// phrasal MGloss. That showed up as one token's MGloss text overlapping its neighbour's (brihat_jataka s1's
// śaśa/bhṛtaḥ, ~41px of overlap) even though stemmaLayout's OWN c[]/lw[] had reserved a clean gap before spreading
// moved things. Call this AFTER spreadForLabels: a single left-to-right sweep in SURFACE order (by final x, not
// original index — a non-projective spread can reorder them) that pushes each node only as far as its predecessor's
// and its own half-width require, cascading the push through every later node. Purely additive (only ever widens a
// gap), so it can't re-open an edge-label collision spreadForLabels just closed — that pass only ever guaranteed a
// MINIMUM clearance, and widening further is always safe.
function ensureNodeGaps(x,lw){ const gap=meas(" ",WORD_F)+8, order=x.map((_,i)=>i).sort((a,b)=>x[a]-x[b]);
  for(let k=1;k<order.length;k++){ const a=order[k-1],b=order[k], need=lw[a]/2+lw[b]/2+gap, have=x[b]-x[a];
    if(have<need-0.5){ const dx=need-have; for(let m=k;m<order.length;m++) x[order[m]]+=dx; } } }

