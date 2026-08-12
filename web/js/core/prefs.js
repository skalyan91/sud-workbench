//@module js/prefs.js
let PREFS={show:{},notation:"",ortho:{},translit:{},stored:{},glossMap:{},gridCols:{}};   // gridCols: the grid columns the user has EXPLICITLY ticked/unticked in the header's column chooser (key → true/false), which pins them out of the automatic width rule's hands (colPin/colShown, js/grid/grid.js). An application preference, not a per-file one — which columns you read a treebank in is a property of the reader, exactly as the notation and the paged layout beside it are. Declared here rather than materialised on first write, so a read never has to guard for the sub-object's existence   // glossMap (item 13): user's custom Feat=Val → Leipzig abbreviation overrides, overlaid on the built-in FEATS_GLOSS. ortho/translit/stored are the three per-language SCHEME memories (language code → chosen id), one per status-bar pill — declared here rather than materialised on first write, so a read never has to guard for the sub-object's existence
let TBMODE="icon";   // titlebar display mode: "icon" (default, Icon Only) | "both" (Icon and Text) | "text" (Text Only)
// The one scheme a DOCUMENT owns: the transliteration its MISC Translit/LTranslit is written in. Which SCRIPT
// and which DISPLAYED romanisation you read a document in are properties of the reader, not of the document
// (Sanskrit is stored as IAST, Chinese simplified/traditional is a glyph swap — in every case the app supports
// the rendering is not the content), so those live per-language in PREFS.ortho / PREFS.translit and no document
// metadata contributes to them at all. Consumed once by the next language load.
let FILE_STORED=null;
// Bumped by every adoptDocSchemes. A scheme load captures it on entry and only consumes FILE_STORED when the
// counter is still the same at the end (schemeGenOK) — because the load is ASYNC and an adopt can land in the
// middle of one. Concretely: js/init.js calls setLang(modelLang(model)) at module-load time, for the DEFAULT
// language, and that load can still be awaiting its bridge call when bootBridge's
// `await loadPrefs(); adoptDocSchemes();` lands. Without this guard that earlier, wrong-language load would
// consume and NULL it — the real document language arrives later still, via
// populateModels().then(maybeAutoDetectLang), and would find nothing left to apply.
let DOCSCHEME_GEN=0;
function schemeGenOK(gen){ return gen===DOCSCHEME_GEN; }   // true ⇒ no adopt happened during this load ⇒ FILE_STORED is this load's to consume
function adoptDocSchemes(){ const s=DOC[0]; DOCSCHEME_GEN++;
  // `# translit_scheme` names the stored scheme; `# stored` is the older spelling of the same thing, still read
  // so files written under it keep loading, never written (see getDocJSON).
  FILE_STORED=(s&&(s.translit_scheme||s.stored))||null; }
// The Script pill has THREE storable choices — a script id, "none", and "" (Original) — so "the user
// deliberately chose Original" has to be distinguishable from "the user never chose", and an empty string
// can't stand for both. The KEY'S PRESENCE carries that distinction: this returns null for "no preference
// recorded" and a (possibly EMPTY) string for a real remembered choice. Reading it as `PREFS.ortho[lang]||""`
// collapsed the two, which is wrong for any language whose default is not Original (Sanskrit defaults to
// None) — and orPick used to DELETE the key on Original, so the two were indistinguishable in storage too.
function prefOrtho(lang){ const o=PREFS.ortho;
  return (lang&&o&&Object.prototype.hasOwnProperty.call(o,lang)) ? String(o[lang]==null?"":o[lang]) : null; }
// The DISPLAYED pill needs exactly the same treatment, for exactly the same reason: Sanskrit's menu carries a
// "None" row (its IAST romanisation row is optional beneath the script glyph), so "" is a REAL choice there —
// "show no transliteration row" — and must outlive the session like any other. It used to be stored by DELETING
// the key, which made a deliberate None identical to "never chose" and quietly forgot it on the next open.
// Same contract as prefOrtho: null for "no preference recorded", a possibly-EMPTY string for a real choice.
function prefTranslit(lang){ const t=PREFS.translit;
  return (lang&&t&&Object.prototype.hasOwnProperty.call(t,lang)) ? String(t[lang]==null?"":t[lang]) : null; }
function prefStored(lang){ return (PREFS.stored&&PREFS.stored[lang])||""; }
let _prefsT=null;
function savePrefs(){ if(!hasBridge())return;
  PREFS.show={colour:show.colour,labels:show.labels,pos:show.pos,arrows:show.arrows,mergePunct:show.mergePunct,wrap:show.wrap,grids:show.grids,avm:show.avm}; PREFS.notation=notation; PREFS.paged=PAGED;
  clearTimeout(_prefsT); _prefsT=setTimeout(()=>{ try{ window.pywebview.api.save_prefs(PREFS); }catch(e){} },300); }   // debounced
async function loadPrefs(){ if(!hasBridge())return; let p; try{ p=await window.pywebview.api.get_prefs(); }catch(e){ return; } if(!p||typeof p!=="object")return;
  PREFS.ortho=(p.ortho&&typeof p.ortho==="object")?p.ortho:{}; PREFS.translit=(p.translit&&typeof p.translit==="object")?p.translit:{}; PREFS.stored=(p.stored&&typeof p.stored==="object")?p.stored:{};
  PREFS.glossMap=(p.glossMap&&typeof p.glossMap==="object")?p.glossMap:{}; if(typeof rebuildGlossMaps==="function")rebuildGlossMaps();   // item 13: restore custom gloss↔FEATS mappings and rebuild the effective + inverse maps
  PREFS.gridCols=(p.gridCols&&typeof p.gridCols==="object")?p.gridCols:{};   // the grid's pinned column choices. No per-key validation: colPin tests `typeof p[k]==="boolean"` at every read, so a junk value from a hand-edited prefs file reads as "never chose" and the width rule simply takes the column back
  if(p.show&&typeof p.show==="object"){ ["colour","labels","pos","arrows","mergePunct","wrap","grids","avm"].forEach(k=>{ if(typeof p.show[k]==="boolean") show[k]=p.show[k]; }); }
  if(typeof p.notation==="string"&&p.notation){ notation=p.notation; }
  if(typeof p.paged==="boolean"){ PAGED=p.paged; }   // only an explicit stored choice moves it off the paged default
  if(typeof applyPageMode==="function") applyPageMode();   // reflect it on #doc + the toolbar pill (the re-render below repaints the sheets)
  if(typeof applyTbMode==="function") applyTbMode(typeof p.tbmode==="string"?p.tbmode:"icon");   // restore the titlebar display mode
  const sel=document.getElementById("convSel"); if(sel)sel.value=notation; syncNotation();
  document.querySelectorAll('#toggles input[type="checkbox"][data-t]').forEach(cb=>{ const k=cb.dataset.t; if(k in show)cb.checked=show[k]; });
  const gc=document.querySelector('[data-t="grids"]'); if(gc)gc.checked=show.grids;
  // item 17: restore the custom relation colours + the light/dark link state, then repaint the override <style>
  PREFS.relColours=(p.relColours&&typeof p.relColours==="object")?p.relColours:undefined;
  PREFS.relColLink=(typeof p.relColLink==="boolean")?p.relColLink:undefined;   // only an explicit stored choice persists; unset → linked (relColLinked() default ON)
  PREFS.fsAlwaysToolbar=(p.fsAlwaysToolbar===true)||undefined;   // item 10: keep the toolbar visible in full screen (default off)
  // `colourBlind` / `colourBlindLevel` used to be restored here and fed the accent-hue derivation. The controls
  // and their machinery are gone (see the note beside relColHexOK in js/ui/colours.js). A prefs file written by an
  // older session still carries the two keys: not reading them IS the handling — they never enter PREFS, so nothing
  // can consult them, no UI is rebuilt for them, and the next savePrefs (which sends PREFS itself) drops them.
  if(typeof fsApplyChrome==="function")fsApplyChrome();   // re-evaluate the full-screen collapse for the restored pref
  if(typeof applyRelColours==="function")applyRelColours();   // repaints the override <style> AND syncs the link checkbox + pickers
  if(typeof deriveRelHuesFromAccent==="function")deriveRelHuesFromAccent(true);   // re-derive the accent hues now that the user's relation-colour overrides (which GATE the derivation, arh_hasOverride) are known
  if(DOC.length)preserveScroll(renderDoc); }

// Apply a language chosen in the picker (or cleared via the pill ✕). `lang` is the canonical UD code.
// syncModel=true also switches the parser model to match (item 3). REENTRANCY GUARD: we only sync when the
// language actually changed, and syncModelToLang mutates `model`/#modelSel WITHOUT dispatching a change event,
// so the #modelSel onchange handler (which calls setLang) never re-fires → no loop. setLang → loadTranslitSchemes
// resets the transliteration menu + default scheme for the new language (turning display off where meaningless).
function applyLang(lang,syncModel){ lang=lang||""; const changed=lang!==DOCLANG;
  // item 3: sync the parser on an explicit language apply even when the language DIDN'T change, as long as NO parser is
  // currently selected — so opening an English file (DOCLANG already defaults to 'en') still auto-selects the English
  // parser. syncModelToLang keeps a matching model and won't clobber a user's deliberately-chosen one (guarded by !model).
  if(syncModel&&(changed||!model)) syncModelToLang(lang);
  setLang(lang);
  if(DOC.length)preserveScroll(renderDoc); }
// Language → model: keep the current model if it already matches; else an installed model for that language; else None.
function syncModelToLang(lang){ const selEl=document.getElementById("modelSel");
  if(model && modelLang(model)===lang) return;   // current parser already speaks this language → leave it
  const id=lang?(MODELLANG[lang]||""):"";        // an installed model whose language matches (MODELLANG is keyed by the same UD code form), else None
  model=id; if(selEl){ selEl.value=id; if(selEl.value!==id){ model=""; selEl.value=""; } }   // programmatic .value assignment does NOT fire onchange → no reentrancy
  syncMenu(); if(typeof refreshModelFeatsInventory==="function") refreshModelFeatsInventory(); }   // …and since onchange never fires here, this IS the choke point for a programmatic model change (js/io/bridge.js) — #modelSel's own onchange (js/ui/wiring.js) covers the manual pick
let MODELLANG={};   // language code → an installed model id, for auto-selecting a parser when a file is opened
// Language authority order (see maybeAutoDetectLang): (1) a filename `<langcode>_…` prefix pins the
//  language and overrides everything; else (2) the Kyoto XPOS ⇒ lzh heuristic; else (3) fastText. The chosen
//  language drives the parser via applyLang(lang,true)→syncModelToLang.
let show={graphs:true,grids:true,colour:true,labels:true,pos:true,arrows:false,mergePunct:true,translit:false,wrap:true,extRel:true,avm:true};   // translit starts OFF — turned on by the status-bar transliteration menu when a scheme is picked. extRel = Shared=Yes/Subject-raising ghost edges (dashed, decorative), on by default. avm (item 22) starts ON, on request (item 23) — this default is just the FIRST-EVER-LAUNCH value; loadPrefs() below already overwrites it from a returning reader's own saved choice the moment a bridge exists, so this only governs a fresh install/browser-preview session
// Document-level glossing TIERS (item 4). Visibility flags; the data lives in MISC and round-trips there.
//  · GLOSS_ON  → a single Gloss tier (MISC Gloss), one editable row per token.
//  · MORPH_ON  → a morphemic gloss: TWO tiers, morpheme segmentation (MISC MSeg) + morpheme gloss (MISC MGloss),
//    each editable; morphemes are hyphen-separated and position-aligned (Leipzig / UD convention).
let GLOSS_ON=false, MORPH_ON=false;   // tier CREATED (from the Glossing drawer)
let GLOSS_VIS=true, MORPH_VIS=true;   // item 3: tier VISIBLE (Show/Hide drawer) — independent of whether it's created
const TIER_MISC={gloss:"Gloss",mseg:"MSeg",mgloss:"MGloss"};   // tier id → MISC attribute
function belowTiers(){ const t=[]; if(GLOSS_ON&&GLOSS_VIS)t.push("gloss"); if(MORPH_ON&&MORPH_VIS){ t.push("mseg"); t.push("mgloss"); } return t; }   // ordered below-token tiers, gated on CREATED (…_ON) + VISIBLE (…_VIS)
function belowTierN(){ return (GLOSS_ON&&GLOSS_VIS?1:0)+(MORPH_ON&&MORPH_VIS?2:0); }   // how many extra rows the below-stack reserves
/* ── DOCUMENT AND PARAGRAPH BOUNDARIES (universaldependencies.org/format.html) ─────────────────────────────────
   A corpus file is a sequence of DOCUMENTS made of PARAGRAPHS made of sentences, and UD records that structure in
   three places rather than one:
     · `# newdoc` / `# newdoc id = …`  on the first sentence of a document;
     · `# newpar` / `# newpar id = …`  on the first sentence of a paragraph;
     · MISC `NewPar=Yes` on the first TOKEN of a paragraph, for the case the two comments cannot express — a
       paragraph that starts in the MIDDLE of a sentence. (On a multi-word token the guideline puts it on the RANGE
       line, not on the first syntactic word; this app keeps MISC per token, so it reads whichever line carries it.)
   The comments ride on the sentence dict as FOUR states, which is what lets an untouched file stay byte-stable —
   see the _BOUNDARY_KEYS note in app/io_conllu.py, whose contract these accessors are the other half of:
     null/undefined  the sentence says nothing (the file's own comment, if any, passes through verbatim)
     true            present, no id          a string   present with that id          false   removed
   So `false` and `null` mean the same thing to a READER and different things to the WRITER, and every render/menu
   test goes through these rather than truth-testing the field (an id of "" would fail a bare truth test, and
   `false` would pass a bare != null one). */
function boundVal(s,k){ const v=s?s[k]:null; return (v==null||v===false)?null:v; }
function hasBound(s,k){ return boundVal(s,k)!==null; }   // …and NOT `!!boundVal(...)`: an id of "" is a marker that is present but unnamed, and a truth test would call it absent
function hasNewdoc(s){ return hasBound(s,"newdoc"); }
function hasNewpar(s){ return hasBound(s,"newpar"); }
function boundId(s,k){ const v=boundVal(s,k); return (typeof v==="string")?v:""; }   // "" ⇒ present but unnamed (or absent) — the id is optional in UD
function isNewParTok(t){ return miscKV(t&&t.misc,"NewPar")==="Yes"; }               // a paragraph that starts mid-sentence
const NEWPAR_MARK="¶", NEWDOC_MARK="§";   // U+00B6 PILCROW SIGN, U+00A7 SECTION SIGN — written as escapes, like every other non-ASCII literal in this codebase
/* PAGE-LIKE LAYOUT (item 3). Paged (the default) caps the document to a fixed measure on a wide screen and lays it
   on sheets, the way a Jupyter notebook does; unpaged lets the blocks use the full window width, which is what this
   app did before. The choice is a property of the READER, not of the document, so it lives in prefs beside the
   notation — and in paged mode a `# newdoc` ENDS a sheet and starts the next one, which is the one thing the two
   modes genuinely render differently (both mark the boundary itself the same way — with the sticky heading over
   the run of blocks it dominates; see .bmark / .bsec in app.css and the sectioning note in renderDoc). */
let PAGED=true;
// SEAM MARKS — where one WORD is spread over several tokens, the seam between two of them carries a mark, in the
// Leipzig register:
//  · "꞊" (MSEG_MARK) at a MULTI-WORD-TOKEN seam — the clitic boundary, which is what an MWT seam usually is. Not a
//    plain hyphen, because the plain hyphen is already spent on the MORPHEME boundaries inside a word (see the
//    MORPH_ON note above), so the seam between MWT components needs a character of its own. U+A78A MODIFIER LETTER
//    SHORT EQUALS SIGN, not the ASCII "=": this is a letter-register clitic boundary sitting between two words, not
//    the arithmetic operator, and it draws at the smaller, letter-height size the Leipzig rules intend. Every core
//    Noto face the app ships (notosans, notosans-italic, notosansmono) carries a glyph for it — checked, since an
//    uncovered codepoint would render as a tofu box on the very rows this mark exists to tie together.
//  · "-" (MORPH_MARK) at an mSUD MORPH seam — two tokens joined by a "/m" relation ARE morphemes of one word, so
//    their seam is a morpheme boundary and takes the plain hyphen. It wins over "=" where both apply, since an mSUD
//    word split into morphemes is typically ALSO an MWT range, and a morpheme boundary is what its seams are.
// The mark is PURELY DECORATIVE and belongs to the SEAM, not to either token: derived from the sentence's own MWT
// ranges / "/m" edges, drawn as its own element like a folded punctuation satellite (never inside the text it sits
// beside), hung outside the token's slot at zero layout width so it can't shift the alignment, and never written to
// MISC. What the file stores is the segmentation the user typed and nothing else; regrouping the tokens, or
// re-attaching them, is what moves the mark.
// Every WORD-LIKE row shows it — the form/glyph row, the transliteration row and the MSeg segmentation row alike
// (the lexical/morphemic GLOSS rows don't: a gloss is a meaning, not a piece of the word). The one exception is the
// OUTLINE, whose rows run those tiers inline rather than stacked, where it goes on the form alone — see that call
// site.
const MSEG_MARK="꞊", MORPH_MARK="-";   // U+A78A, U+002D
// THE MWT RANGE A SEAM IS INSIDE — the range holding BOTH token `k` and token k+1, i.e. the orthographic word the
// seam between them is internal to; null where the seam lies in no range at all. `k>=m.from && k<m.to` says exactly
// that: k is a NON-FINAL member, so k+1 is a member too and the two are in ONE range (a marked MWT seam can
// therefore never straddle two different ranges). msegGlued is the same test asked as a yes/no, and is written in
// terms of this one so the two cannot drift — "is this token's word continued into the next" and "which word is it"
// are one fact. Rule 2 of seamOwner is the other caller; see its note below.
function seamMwt(s,k){ return ((s&&s.mwt)||[]).find(m=>k>=m.from&&k<m.to)||null; }
function msegGlued(s,tokId){ return !!seamMwt(s,tokId); }   // token `tokId` (1-based) is a NON-FINAL member of some MWT range, i.e. its word continues into the next token
// mSUD: a "/m" relation says its two ends are morphemes of ONE word, so a seam is word-internal exactly when some
// "/m" edge SPANS it (the relation is what makes the word, so nothing here assumes a word's morpheme tokens are
// contiguous — a spanning edge is the evidence either way). Returns the set of seam ids the sentence's "/m" edges
// cover, seam `k` being the join between token k and token k+1.
function morphSeams(s){ const seams=new Set();
  ((s&&s.tokens)||[]).forEach((t,ti)=>{ if(!/\/m$/.test(t.deprel||"")) return; const h=parseInt(t.head,10); if(!h) return;
    for(let k=Math.min(ti+1,h); k<Math.max(ti+1,h); k++) seams.add(k); });
  return seams; }
// WHICH OF THE TWO TOKENS CARRIES THE MARK — or NEITHER. A mark that belongs to one of them is drawn against it,
// as a SUFFIX on the first ("de=") or a PREFIX on the second ("=le"); a mark that belongs to neither sits SQUARELY
// BETWEEN the two ("de = le", centred in the gap by positionSeamMarks), which is the honest rendering when nothing
// says the boundary is part of either word.
// FOUR rules decide, in order; the FIRST one that applies settles the seam, and rule 4 is the fallback.
//  1. MORPHOLOGICAL SEAM PLACEMENT IS INVIOLABLE, whatever the two tokens' own relation to each other: a token
//     attached by a chain of "/m" relations ALWAYS carries a mark, ON THE SIDE ITS FIRST NON-"/m" ANCESTOR LIES —
//     the head of its morphological group (morphGroupHead). Put the other way round: only the head of a morph
//     group goes unmarked, and every other member marks the side facing that head, so a "/m" token FURTHER from
//     the non-"/m" head owns the seam between it and one nearer. So this rule asks of each of the two tokens
//     whether the mark it always carries faces INTO this seam (token k's does when its group head is to its
//     right; token k+1's when its group head is to its left) — the answer being yes for exactly one of them is
//     what settles the seam. Where BOTH face in (two morphemes of two different groups meeting at this seam) it
//     settles nothing, and the rules below take over.
//     Deliberately FIRST: "always" means what it says, so a "/m" member takes its mark even where its group head
//     is some ancestor the token on the other side of the seam has nothing to do with.
//  2. AN ANCESTOR TIE INSIDE THE WORD: if one of the two is an IMMEDIATE head or dependent of an ANCESTOR of the
//     other, AND THAT ANCESTOR IS ITSELF PART OF THE MWT THE SEAM SITS IN, it owns the seam — it is tied into the
//     other's line of descent above the other, which makes it the member of the pair the boundary hangs from.
//     IMMEDIATE qualifies the LINK, not the ancestor: the ancestor may sit at ANY depth on the other token's head
//     chain — its head, its grandparent, higher still — but the tie to that ancestor has to be a DIRECT edge (the
//     token is that ancestor's own head, or its own dependent). A tie mediated by some further token in between is
//     not a tie at all for this purpose. The commonest shapes are SIBLINGS (both hang off one head) and
//     GRANDPARENT/GRANDCHILD (one is the head of the other's head), but a direct edge to an ancestor further up
//     qualifies just the same. Where NEITHER side is tied that way, rule 2 says nothing and the seam falls through
//     to rule 4 and is centred.
//     ⚠ THE ANCESTOR MUST LIE INSIDE THE SEAM'S OWN MWT, and that restriction is the whole of rule 2's reach. The
//     question rule 2 answers is which of two pieces of ONE WORD an internal boundary hangs from, so only the
//     word's OWN internal structure can answer it: a tie to something OUTSIDE the word is a fact about how the
//     whole word attaches to the rest of the sentence, and says nothing about where the boundary inside it
//     belongs. Read without the restriction the rule fired on exactly that — French `du` = `de`+`le` (samples/
//     french_mwt.conllu), where `le`'s head is `chat` and `chat`'s own head is `de`, so `de` is the direct HEAD of
//     an ancestor of `le`… and `chat` is the word AFTER the MWT entirely: the seam was awarded to `de` ("de꞊le")
//     on the strength of a token outside the pair's own word. With the restriction that
//     tie is not a tie, and the seam falls through to rule 4 and is centred, which is the honest rendering when
//     nothing INSIDE the word claims the boundary. In-word ties are untouched and still decide: a four-component
//     Sanskrit compound whose members hang off its last component is settled by rule 2 exactly as before.
//     "THE SEAM'S OWN MWT" (seamMwt) is the range containing BOTH tokens — the only reading that is well defined,
//     and the only one the data can produce: msegFlagSent reaches seamOwner only for a seam that carries a mark,
//     and an MWT mark's two tokens are always members of ONE range (see seamMwt). Where the seam is in no range at
//     all — an mSUD "/m" morpheme seam in a document with no MWT ranges — there is no such word to test an
//     ancestor against and rule 2 says nothing, the same answer it gives for a tie it cannot honour. That costs
//     nothing in practice: rule 1 settles a "/m" seam before rule 2 is ever consulted (measured over every marked
//     seam in every sample — samples/chinese_msud.conllu's two "/m" seams are both rule-1 decisions), and the two
//     readings can only differ where rule 1 leaves the seam open: a "/m" edge SPANNING a seam neither of whose
//     tokens is a "/m" member itself, or two different morph groups meeting at one seam, in a document that also
//     has no MWT range there. The alternative — leave rule 2 unrestricted where the seam has no MWT — was rejected as an unstated
//     exception to a rule that reads better without one; flipping to it is one clause in ancTieDepth.
//     TWO readings had to be pinned down here, both of them load-bearing:
//     · AGAINST RULE 3. Read literally, rule 2 would swallow every directly-linked pair and leave rule 3 dead:
//       where k+1's head IS k, k is (in the ordinary case) also a dependent of ITS own head, which is an ancestor
//       of k+1 — so rule 2 would fire on the strength of a tie that is nothing but the pair's own link seen one
//       step further up. Rule 2 is about a token tied to the OTHER's ancestor RATHER THAN to the other token
//       itself, so it is skipped entirely for a directly-linked pair: `linked` below gates it, and rule 3 owns
//       that case. The two rules' antecedents are therefore mutually exclusive, which is also why a rule-2 tie
//       (below) can never fall through to rule 3.
//     · WHEN BOTH SATISFY IT — both of them under the in-word restriction above, since a tie that restriction
//       rejects is not a tie at all and must not reach this tie-break either. One side rejected leaves the OTHER
//       side's single tie to answer on its own; both rejected leaves rule 4. That falls out of applying the
//       restriction INSIDE ancTieDepth, where each side's depth is computed, rather than filtering afterwards.
//       Two tokens sharing one head are each a direct dependent of an ancestor of the other,
//       and rule 2 as written would hand the seam to both. The tie-break is RULE 1'S OWN PRINCIPLE, applied to the
//       shared head instead of to a morphological group head: THE TOKEN FURTHER FROM THAT HEAD OWNS THE SEAM —
//       measured, exactly as rule 1 measures it, in SURFACE ORDER (rule 1 asks nothing but which SIDE the group
//       head lies on: token k's mark faces right into the seam when its head is to its right, token k+1's faces
//       left when its head is to its left, i.e. linear token distance). One notion of "further from a head", used
//       identically in both rules — not a second, tree-depth one for the same idea.
//       THE SHARED HEAD is the pair's NEAREST COMMON ANCESTOR (sharedHead). In the tie case that is always their
//       literal common head, and the two tokens are always plain siblings under it — which is worth showing, since
//       it is what makes "the shared head" well defined rather than a choice between two different tie nodes:
//       whenever both sides fire, neither can dominate the other (a token below another cannot be the head of, or
//       a dependent of, anything strictly above it), so each side's tie must be of the form "head(x) is an ancestor
//       of the other" — making head(k) and head(k+1) both common ancestors, and each of them therefore equal to the
//       nearest one. sharedHead is still computed rather than assumed, so a malformed tree degrades to rule 4
//       instead of trusting an identity it may not satisfy.
//       AND IT NEEDS NO in-word restriction OF ITS OWN, which is why sharedHead is left as it was: by that same
//       derivation the shared head IS each side's tie ancestor, and both of those have already had to be inside
//       the seam's MWT for the two sides to fire at all. Restricting it a second time would state the same
//       constraint twice, and would differ from this only on a tree where the derivation fails — exactly the case
//       the computed sharedHead already routes to rule 4.
//       Since the shared head is neither of the two (if it were, the pair would be directly linked, which rule 2 is
//       gated off), it lies strictly to one side of both, and the tie-break ALWAYS resolves: the token on the far
//       side from it takes the mark. Two siblings under a head to their left → the LATER one; under a head to their
//       right → the EARLIER one.
//  2½. WORD CLASS, where rules 1 and 2 found NOTHING inside the word to decide from — no in-word ancestor tie on
//      either side, and (this rule only runs where rule 3 below is skipped, i.e.) no direct link between the two
//      either. This is rule 3's own open-vs-closed branch, RE-RUN rather than restated: that branch reads only the
//      two tokens' UPOSes, never their relation, so `linked` was never actually a precondition of it — it is a
//      precondition of the branches AFTER it (both-closed, both-open), which read arrowDir/nounhood off a relation
//      that has to exist between the two for those questions to mean anything. An open/closed pair has no such
//      requirement, so asking it again here, once rules 1–2 have had first refusal, costs nothing and is checked
//      (over every MWT-internal seam in every sample this app ships) to never disagree with what rule 3 alone
//      would already have said wherever a pair happens to satisfy both.
//      WHY THIS IS NEEDED: SUD attaches an enclitic like Latin "-que" (CCONJ) as `cc` to the HEAD OF THE
//      COORDINATION it introduces — which is not always the word "-que" is orthographically fused onto. In
//      "Laviniaque" (samples/la_virgil.conllu) "que" is `cc` on "litora", three tokens later, while its fused
//      host "Lavinia" is merely a `mod` sibling of that same "litora"; the two components of ONE ORTHOGRAPHIC WORD
//      share no direct link and no ancestor inside their own MWT range, so rules 1–2 are silent and — without this
//      branch — the seam CENTRES on a word that is not remotely in question orthographically: CCONJ is closed,
//      PROPN is open, a closed-class conjunction fused onto an open-class stem is exactly what rule 3 already
//      calls "the bound member of the pair", and the syntactic detour "-que" took to reach its OWN head three
//      tokens away says nothing about where the boundary inside "Laviniaque" belongs.
//  3. A DIRECT LINK between the two themselves — one is the head of the other — decides by what the two tokens ARE:
//     · one OPEN class against one CLOSED class → the CLOSED-class token, that being the bound member of the pair.
//     · both CLOSED → THE SEMANTICALLY DEPENDENT ONE, which is the one test in these four rules that asks what the
//       relation MEANS rather than what the two tokens are. Two closed-class words are alike in class, so class has
//       nothing left to say and nounhood cannot apply (neither is a noun); what remains is which of the two leans on
//       the other. arrowDir (js/diagram/diagram-core.js) is that judgement, already made once for the "Semantic
//       arrows" option, and it is reused rather than restated: subj/comp leave the arrow at the syntactic HEAD (an
//       auxiliary leans on its lexical verb, an adposition on its object) → the HEAD takes the seam; mod/det/clf
//       leave it at the syntactic DEPENDENT → the DEPENDENT takes it. Any other relation says nothing either way and
//       falls to rule 4, centred — the same treatment a symmetric relation gets between two alike OPEN words below,
//       and for the same reason. THIS REPLACES a flat "both closed → the HEAD", which named the head even under a
//       coordination or a punct and even where the dependent is the bound member (a determiner beside its noun-less
//       pronoun, a classifier beside its numeral).
//     · both OPEN → the one that is NOT a noun, where exactly one of them is NOUN/PROPN: the OTHER takes it, and
//       the relation is not consulted at all. Where the two are ALIKE in nounhood — both nouns, or neither — the
//       relation is all there is to go on, and the branch reads as ONE rule rather than two:
//         AN ASYMMETRIC RELATION IS WHAT LICENSES AN OWNER AT ALL, AND NOUNHOOD DECIDES WHICH END OF IT TAKES THE
//         SEAM — the HEAD when both are nouns, the DEPENDENT when neither is.
//       So two NOUN/PROPN under an argument or modifier relation (see ASYM_FAM) mark at the head; an ADV beside a
//       VERB, or an ADJ beside an ADJ, under the same kind of relation mark at the dependent. A SYMMETRIC relation
//       (coordination, apposition, flat/compound/list, parataxis, udep…) says nothing about which of two alike
//       words the boundary belongs to, and the seam is centred — in BOTH cases alike, which is the point of
//       stating it this way round: the two used to be written as separate cases and the second of them wrongly
//       named an owner for every relation, symmetric ones included.
//     UD's open classes are ADJ ADV INTJ NOUN PROPN VERB and its closed ones ADP AUX CCONJ DET NUM PART PRON
//     SCONJ. PUNCT/SYM/X and a missing UPOS are in NEITHER set, so a pair involving one of them is not an
//     open-against-closed pair, not a both-closed pair and not a both-open pair — no branch of rule 3 applies and
//     it falls through to rule 4, exactly as an unclassifiable token should.
//  4. IN ANY OTHER CASE the seam is centred (owner 0) — two tokens whose trees never meet at all and are alike in
//     word class too (rule 2½ found nothing either), a pair rule 3 can't tell apart, a symmetric relation between
//     two nouns. (Not two tokens under a common head: that is a rule-2 tie, and the tie-break there always names
//     an owner.)
// This supersedes the older three-test order (morph group, then a dominance gate, then word class, then
// arrowDir's semantic dependence). "Which of the two leans on the other" answered a different question from
// "which of the two does this boundary belong to", and these rules answer the second one directly — so arrowDir
// is consulted at exactly ONE point now, rule 3's both-closed branch, where the two tokens are alike in class and
// in (non-)nounhood and semantic dependence is the only thing left that can tell them apart. It is not a partial
// return of the old order: it decides that one branch, below rules 1 and 2 and after word class, never above them.
// RULE 0 — `goeswith` OUTRANKS ALL FOUR, RULE 1 INCLUDED: a seam INSIDE a `goeswith` word carries NO MARK, and no
// rule below is consulted for it. Rule 1 calls itself inviolable, and against every other relation it is; this is
// the one exception above it, and it is an exception of a different kind. Rules 1–4 answer "WHICH of these two
// tokens does this boundary belong to", and every answer they can give — the head, the dependent, or the middle —
// is wrong here, because the boundary is to be marked on NEITHER: `goeswith` says the two tokens are one word that
// a stray space split, and that fact is drawn as two adjacent forms under one shared annotation stack joined by a
// grey undertie and by nothing else. A "꞊"/"-" hung in the same gap would state it a second time, in the vocabulary
// of a DIFFERENT fact — a word fused into one orthographic token, or a word split into morphemes — so the pair
// would read as an MWT or as an mSUD morph group.
// IT WINS EVEN WHERE THE PAIR ALSO SITS INSIDE AN MWT RANGE OR A "/m" MORPH GROUP, which is the case that makes
// this a real override rather than a tidy default. Both configurations occur: an MWT range can span a goeswith
// pair (the range fuses the surrounding orthography, while the stray space inside the word is a different fact
// about the same stretch), and a "/m" edge that spans the pair marks every seam it crosses, this one among them.
// Rule 1 would then hand the seam to a morph-group member on the strength of its group head lying across it, and
// msegGlued would hand it a "꞊" — for a gap inside one word. Neither gets the chance.
// SUPPRESSED WHERE THE MARK IS EMITTED, not here: goesWithUnits/goesWithSeam gate msegFlagSent in js/io/bridge.js,
// BEFORE the mark is even chosen. Adding goeswith to ASYM_FAM below would be the wrong fix in the same way rule 1
// is the wrong owner — it would move the mark onto the head, not remove it. (The same gate's other half re-hangs a
// mark that a CONTINUATION won onto the unit's head, since the continuation is folded off the display list and
// would otherwise take a genuine, outside-the-word seam down with it.) See the goeswith block in
// js/diagram/diagram-core.js for what is drawn instead.
const UPOS_OPEN=new Set(["ADJ","ADV","INTJ","NOUN","PROPN","VERB"]);
const UPOS_CLOSED=new Set(["ADP","AUX","CCONJ","DET","NUM","PART","PRON","SCONJ"]);
const UPOS_NOUNY=new Set(["NOUN","PROPN"]);   // rule 3's "is it a noun" test — UD's two nominal open classes, common and proper
// ASYMMETRIC RELATIONS — rule 3's last branch. "Asymmetric" = the relation itself makes one end subordinate to the
// other, which in SUD is exactly the ARGUMENT relations (subj, comp and all its subtypes — comp:obj, comp:obl,
// comp:pred, comp:aux, comp:cleft) and the MODIFIER relations (mod, plus det and clf, which SUD groups with mod
// under "Modifiers & specifiers" — a determiner and a classifier subordinate themselves to what they attach to
// exactly as a modifier does; see DEPREL_CATS in js/editing/context-menu.js). Checked against the whole SUD
// vocabulary in DEPREL_DEFAULT: everything else is SYMMETRIC or says nothing about subordination — conj (incl.
// conj:coord/conj:appos/conj:dicto), cc, flat, compound, list, parataxis (+ its subtypes), goeswith, orphan,
// dislocated, discourse, vocative, punct, udep, unk, root — and none of those gives the head a claim on the seam.
// Held as a set of RELATION FAMILIES and tested through famOf, so a subtype ("comp:obj"), a deep feature
// ("mod@relcl") and an mSUD morph relation ("comp:obj/m") all reduce to the family that decides.
const ASYM_FAM=new Set(["subj","comp","mod","det","clf"]);
function relAsym(r){ return ASYM_FAM.has(famOf(r)); }
// a token's word class, from its UPOS alone → "closed", "open", or "" where the UPOS settles neither
function wordClass(t){ const u=(t&&t.upos)||""; return UPOS_CLOSED.has(u)?"closed":(UPOS_OPEN.has(u)?"open":""); }
function headChain(s,id){ const out=[],seen=new Set(); let k=id;   // [self, head, head's head, …, top] — `seen` stops a cyclic HEAD column dead rather than hanging the render
  while(k>0 && !seen.has(k) && s.tokens[k-1]){ out.push(k); seen.add(k); k=parseInt(s.tokens[k-1].head,10)||0; }
  return out; }
// The head of token `x`'s morphological group: its FIRST NON-"/m" ANCESTOR, found by walking up "/m" edges only —
// the first ordinary relation on the way up IS the group's own head, and the walk stops there. 0 when `x` is not a
// "/m" member at all (so it heads whatever group it may have, and carries no mark of its own).
function morphGroupHead(s,x){ const own=s.tokens[x-1]; if(!own||!/\/m$/.test(own.deprel||"")) return 0;
  let k=parseInt(own.head,10)||0, guard=0;
  while(k>0 && guard++<500){ const t=s.tokens[k-1]; if(!t||!/\/m$/.test(t.deprel||"")) return k; k=parseInt(t.head,10)||0; }
  return 0; }   // ran off the top (or a cyclic HEAD column) → treat it as no group head rather than guessing one
// Rule 2's measure: how far up `y`'s head chain the nearest STRICT ancestor of `y` lies that `x` is DIRECTLY
// attached to — as that ancestor's head or as its dependent — AND THAT LIES INSIDE `rng`, the MWT range the seam
// between the two sits in (seamMwt). 1 = y's own head (so x and y are siblings), 2 = y's grandparent (x is y's
// grandparent, or a dependent of it), …; 0 = no such ancestor, i.e. rule 2 does not fire for `x`. Every depth is
// walked, because "immediate" in rule 2 qualifies the LINK to the ancestor, not the ancestor's distance from `y`
// (see the rule-2 note above) — the depth is returned only so a caller could rank two ties, not to gate them. `x`
// itself is skipped (a token is neither its own head nor its own dependent), and headChain's own cycle guard is
// what keeps a malformed HEAD column from hanging the walk.
// ⚠ `rng` IS REQUIRED, AND A NULL ONE ANSWERS 0 FOR EVERY x. A tie to an ancestor outside the word says nothing
// about a boundary inside it (the rule-2 note gives the case that forced this), and a seam that is in no MWT range
// at all has no word to test an ancestor against — so both come back as "no tie", which is exactly the answer
// seamOwner's own no-tie branches already handle. It is a parameter rather than something derived in here so the
// two sides of one seam cannot be measured against two different ranges, and so an unrestricted call is not
// something a caller can write by accident.
// ⚠ `continue`, not `break`, on an out-of-range ancestor: the restriction is on each ancestor SEPARATELY, and a
// head chain may leave the range and come back into it (a component headed by a token outside the MWT whose own
// head is back inside it — non-projective, but nothing forbids it in the columns).
function ancTieDepth(s,x,y,rng){ if(!rng) return 0;
  const chain=headChain(s,y), hx=parseInt((s.tokens[x-1]||{}).head,10)||0;
  for(let j=1;j<chain.length;j++){ const c=chain[j]; if(c===x) continue;
    if(c<rng.from||c>rng.to) continue;                                     // …outside the seam's own MWT: a tie to it is not the word's own structure and does not count
    if(hx===c) return j;                                                   // x is a direct DEPENDENT of that ancestor
    if((parseInt((s.tokens[c-1]||{}).head,10)||0)===x) return j; }         // …or its direct HEAD
  return 0; }
// Rule 2's tie-break needs THE SHARED HEAD: the pair's nearest common ancestor — the lowest token that dominates
// both — found by walking `a`'s head chain upward and taking the first entry that also lies on `b`'s. Starts one
// step ABOVE `a` (index 1), so `a` itself never answers; 0 when the two chains never meet (a forest, or a cyclic
// HEAD column headChain's own guard cut short). Where both sides of rule 2 fire this is always the two tokens'
// literal common head — see the derivation in the rule-2 note above.
function sharedHead(s,a,b){ const A=headChain(s,a), B=new Set(headChain(s,b));
  for(let j=1;j<A.length;j++) if(B.has(A[j])) return A[j];
  return 0; }
function seamOwner(s,k){ const ta=s.tokens[k-1], tb=s.tokens[k]; if(!ta||!tb) return 0;   // → the 1-based id of the token the seam between `k` and `k+1` marks, or 0 for "between the two"
  // 1. a "/m" member's mark faces its group head, always. It lands on THIS seam when that head lies across it.
  const ga=morphGroupHead(s,k), gb=morphGroupHead(s,k+1);
  const fa=ga>k, fb=gb>0&&gb<k+1;   // token k's mark faces right into the seam / token k+1's faces left into it
  if(fa!==fb) return fa?k:k+1;      // exactly one of them marks this seam → it takes it, whatever the rules below would have said
  const ha=parseInt(ta.head,10)||0, hb=parseInt(tb.head,10)||0;
  const linked=(ha===k+1)||(hb===k);   // the two are DIRECTLY linked — rule 3's case, and the one rule 2 is gated off (see its note above)
  // 2. a direct tie to an ancestor of the other, at any depth, PROVIDED THAT ANCESTOR IS ITSELF INSIDE THE MWT THIS
  //    SEAM SITS IN (an ancestor outside the word says nothing about a boundary inside it — see the rule-2 note
  //    above; a seam in no MWT range answers no tie on either side and falls straight through); where BOTH sides
  //    are tied, the one FURTHER from the shared head takes it — rule 1's own measure of "further from a head",
  //    i.e. which SIDE that head lies on in surface order
  if(!linked){ const rng=seamMwt(s,k);   // the pair's own orthographic word, or null; measured ONCE so both sides are judged against the same range
    const da=ancTieDepth(s,k,k+1,rng), db=ancTieDepth(s,k+1,k,rng);
    if(da&&db){ const H=sharedHead(s,k,k+1);
      return (H>k+1)?k:((H>0&&H<k)?k+1:0); }   // head to the RIGHT of the pair → the earlier token is further from it; to the LEFT → the later one. H can only be one of the two, or 0, on a malformed tree → rule 4
    if(da) return k;
    if(db) return k+1;
    // 2½. NEITHER TOKEN'S TREE POSITION CLAIMS THE BOUNDARY — no direct link, no ancestor tie inside the word
    // either — but the word can still answer on the one test rule 3 asks of the tokens THEMSELVES rather than of
    // a relation between them: word class. Re-running rule 3's own open-vs-closed branch here, not restating it:
    // that branch never actually depended on `linked` — it reads the two UPOSes and nothing else — so it costs
    // nothing to ask again where rules 1–2 found nothing, and it is checked (over every MWT-internal seam in
    // every sample this app ships) to never once disagree with a linked pair's own rule-3 answer where both
    // apply, which is what makes re-running it here safe rather than a second, competing standard. Real case:
    // SUD attaches Latin "-que" (CCONJ) as `cc` to the HEAD OF THE COORDINATION it introduces, not to the word
    // it is orthographically fused onto — "Laviniaque" (samples/la_virgil.conllu) has "que" attached three
    // tokens later, to "litora", with its fused host "Lavinia" merely a sibling `mod` of that same "litora" — so
    // neither rule-2 test above finds a tie INSIDE the word "Laviniaque" at all, and without this branch the
    // seam centred ("Lavinia = que") for a word whose two halves are, orthographically, not remotely in
    // question: a closed-class enclitic fused onto an open-class stem, exactly rule 3's "bound member" case.
    // NOTHING ELSE of rule 3 belongs here — no nounhood test, no arrowDir: both read the pair's RELATION, and
    // there is no established relation between the two at this point, which is the whole reason execution
    // reached this line rather than rule 3 itself.
    const wa=wordClass(ta), wb=wordClass(tb);
    if(wa==="closed"&&wb==="open") return k;
    if(wa==="open"&&wb==="closed") return k+1;
    return 0; }   // neither tree position nor word class settles it → rule 4
  // 3. directly linked → word class first, then nounhood, then the relation
  const wa=wordClass(ta), wb=wordClass(tb), hd=(hb===k)?k:k+1;   // hd = whichever of the two heads the other (a HEAD-cycle between them resolves to k; the tree is malformed either way)
  if(wa==="closed"&&wb==="open") return k;     // one open against one closed → the closed one, that being the bound member of the pair
  if(wa==="open"&&wb==="closed") return k+1;
  if(wa==="closed"&&wb==="closed"){ const dp=(hd===k)?k+1:k, d=arrowDir(s.tokens[dp-1].deprel);   // both closed → SEMANTIC dependence decides (see the rule-3 note above). The relation of the pair is the DEPENDENT's own deprel, as in the both-open branch below
    return d==="dep"?hd:(d==="head"?dp:0); }   // arrowDir("dep") = the arrow leaves the syntactic HEAD, i.e. the head is the semantically dependent end (subj/comp) → the head takes the seam; arrowDir("head") = the syntactic DEPENDENT is (mod/det/clf) → the dependent takes it; null (the relation says nothing either way) → rule 4, centred   /* calling into js/diagram/diagram-core.js, which loads AFTER this file, is safe HERE and only here: seamOwner runs at render time, long after every module is defined — it is EAGER top-level code that may not forward-reference (see CLAUDE.md) */
  if(wa==="open"&&wb==="open"){
    const na=UPOS_NOUNY.has(ta.upos), nb=UPOS_NOUNY.has(tb.upos), dp=(hd===k)?k+1:k;   // dp = the DEPENDENT of the pair
    if(na!==nb) return na?k+1:k;               // exactly one noun → the OTHER, non-noun token, whatever the relation says
    // the two are alike in nounhood → the relation licenses an owner, nounhood picks the end (see the note above)
    if(!relAsym(s.tokens[dp-1].deprel)) return 0;   // symmetric → neither end has a claim on the boundary. The relation of the pair is the DEPENDENT's own deprel
    return na?hd:dp; }                         // asymmetric → both nouns: the HEAD; neither a noun: the DEPENDENT
  return 0; }   // one of the two is neither open nor closed (PUNCT/SYM/X, or no UPOS at all) → rule 4
// `_seamPost` / `_seamPre` / `_seamMid` — the mark itself ("", "=" or "-"), cached on the token by renderDoc
// (msegFlagSent): _seamPost hangs off the token's inline END, _seamPre off its inline START, and _seamMid — held
// by the FIRST of the two tokens, that being where it is drawn before the centring pass moves it — sits between
// this token and the next. A token can carry one of each side (the middle piece of a three-part word that wins the
// seam on both sides). The diagrams draw from folded DISPLAY token arrays whose indices no longer line up with the
// sentence's own numbering, but the objects in them ARE the sentence's tokens, so the marks ride along where an
// (s,tokId) pair can't reach.
function seamPost(o){ return (o&&o._seamPost)||""; }
function seamPre(o){ return (o&&o._seamPre)||""; }
function seamMid(o){ return (o&&o._seamMid)||""; }
// …and the SEAM each of those three marks belongs to, as "k k+1" — the pair of token ids it joins, cached beside the
// mark by msegFlagSent and published on the drawn element as data-seam-toks. Empty where there is no such mark.
function seamToks(k){ return k?(k+" "+(k+1)):""; }
function seamPostToks(o){ return seamToks(o&&o._seamPostK); }
function seamPreToks(o){ return seamToks(o&&o._seamPreK); }
function seamMidToks(o){ return seamToks(o&&o._seamMidK); }
// MSeg as STORED: never carrying the decorative mark. Strips a trailing "꞊" (this app's MWT mark — a hand-typed
// clitic boundary would need something after it to attach to), along with the ASCII "=" that served as it until the
// switch to U+A78A and the "⹀" before that. So none of the three can reach MISC through an edit, and a file that
// already carries one is cleaned on open (normaliseMsegMarks). A trailing "-" only counts as a mark on a token whose seam already
// DRAWS one after it, where the oldest convention put one automatically (the shipped samples carry those);
// anywhere else it's the user's own morpheme boundary and survives exactly as typed. `pre` does the same at the
// FRONT, for a token whose seam mark is drawn as a prefix.
function msegStrip(txt,post,pre){ let v=(txt||"").replace(/[꞊=⹀]+$/,"");
  if(post) v=v.replace(/-+$/,"");
  if(pre) v=v.replace(/^[꞊=⹀-]+/,"");
  return v; }
/* TWO ADJACENT MORPHEME BOUNDARIES ARE ONE BOUNDARY. `-` separates morphemes in MSeg and MGloss, so `--`
   states the same division twice and lines the two tiers up one slot apart from the form they gloss. It is
   generated rather than typed — a flatten whose left piece already ended in `-` met a joiner that adds one
   (`x-` + `y` → `x--y`), and the abbreviation reassignment on a split can put a `-GEN` beside a piece that
   carries its own trailing mark — so the fix belongs where every consumer reads, and is applied at the WRITE
   sites too so the file does not keep a doubled mark the display has quietly stopped showing.
   ⚠ NOT for `gloss`. That tier is free-running translation prose, where `--` is a perfectly ordinary way to
   type a dash and merging it would silently edit the user's words. The morphemic tiers are the ones in which
   `-` is a piece of notation rather than a character. */
// Takes the tier id ("mgloss") or the MISC key ("MGloss") — the write sites have one, the read accessor the
// other, and a normaliser that only recognised one of them would have covered only half of them.
function tierDashFix(v,tier){ return /^gloss$/i.test(tier||"")?String(v||""):String(v||"").replace(/-{2,}/g,"-"); }
function tierText(o,tier){ return o?tierDashFix(miscKV(o.misc,TIER_MISC[tier]).replace(INVISIBLE_RE,"").replace(GLOSS_WS_RE,""),tier):""; }   // strip invisible/stray-whitespace chars at the shared read accessor, not just at render/encode time — every direct miscKV(...,"MGloss"/"MSeg") read used to bypass glossEnc/glossAbbrSegments' stripping (e.g. retargetGlossAbbrev reading+rewriting raw MISC on a FEATS-driven sync), letting a stray invisible/CR-LF-tab char from old data persist across edits that never touch the field itself
/* WHAT A TIER ROW PAINTS, as against what its MISC attribute stores. The two are the same string
   everywhere except the MSeg tier under Latin's `macron` Script scheme, where the segmentation is
   DERIVED from the bare form, STORED bare, and DISPLAYED with the vowel lengths every other row in the
   block already shows — see laMsegMacron (js/lang/translit-load.js) for why that is an overlay on the
   rendering the token already has rather than a lookup of its own.
   ⚠ ONLY THE DRAWING SITES READ THIS. Every other reader is asking about the STORED value and must go
   on asking tierText: the inline editors (editTier's proxy, js/editing/context-menu.js), the provenance
   tests that decide whether a tier has been hand-edited (morphEdited, msegRefill's `_msegPre` guard)
   and every write path. A field that OPENED on the macronised text would write a macron into MISC — and
   from there, de-hyphenated, into FORM and `# text` — on its very first commit, which is exactly what
   the form row's own editor declines to do under a script.
   The typeof guard is the usual one for a cross-module call from a file that loads this early; it is
   answered by the time anything renders. */
function tierDisp(o,tier){ const v=tierText(o,tier);
  return (tier==="mseg"&&typeof laMsegMacron==="function")?laMsegMacron(o,v):v; }
// a Leipzig glossing abbreviation: a run of [A-Z0-9]+ bounded on BOTH sides by a punctuation mark or the edge of
// the string (so "PST" in "run.PST", and "3SG" itself in "PST-3SG", both qualify; "St" or a bare word doesn't).
// Small-capped via c2sc. The SAME pattern (as a whole-token test) also decides which already-split MGloss tokens
// survive a re-definition — see GLOSS_ABBR_TOK_RE / applyWiktionaryDef.
const GLOSS_ABBR_RE=/(?<=^|\p{P})[A-Z0-9]+(?=\p{P}|$)/gu;
const GLOSS_ABBR_TOK_RE=/^[A-Z0-9]+$/;   // whole-token form of GLOSS_ABBR_RE, for tokens already split on "."/"-"
function glossAbbrSegments(text){ text=(text||"").replace(INVISIBLE_RE,"").replace(GLOSS_WS_RE,"");   // strip stray invisible/CR-LF-tab characters from ALREADY-STORED gloss data too (e.g. a doc saved before glossEnc started stripping them at the source) — never displayed, and never fed back into an edit as a hidden extra "character" the user can't see or delete
  const segs=[]; let last=0,m; GLOSS_ABBR_RE.lastIndex=0;
  while((m=GLOSS_ABBR_RE.exec(text))){ if(m.index>last)segs.push([text.slice(last,m.index),false]); segs.push([m[0],true]); last=m.index+m[0].length; }
  if(last<text.length||!segs.length) segs.push([text.slice(last),false]);
  return segs; }
// set a gloss element's displayed text; SVGNS (used below) is declared later in the file, alongside E() — fine,
// since this function's body only reads it when actually CALLED, long after the whole script has finished loading.
// On BOTH gloss tiers — the lexical Gloss and the morphemic MGloss — any Leipzig abbreviation run is wrapped in
// its own inline node (an SVG <tspan> or HTML <span>, whichever `el` is) carrying .glabbr → small caps + old-style
// figures (see .gloss .glabbr). The two tiers are the same kind of thing, a gloss written in the Leipzig
// conventions, so a "1SG" reads the same in either. Only the MSeg tier is exempt: it holds SEGMENTED WORD text,
// not a gloss, and its capitals are just capitals. Nor is the seam mark part of this text — it is drawn beside the
// element as its own satellite (svgSeamMark / htmlSeamMark), so what sits in here is exactly what the file stores
// and the field edits.
function setGlossText(el,tier,txt){ el.textContent="";
  if(tier==="mseg"){ el.textContent=txt; return; }
  const svg=el.namespaceURI===SVGNS;
  glossAbbrSegments(txt).forEach(([t,abbr])=>{
    if(!abbr){ el.appendChild(document.createTextNode(t)); return; }
    const s=svg?document.createElementNS(SVGNS,"tspan"):document.createElement("span");
    s.setAttribute("class","glabbr"); s.textContent=t; el.appendChild(s); }); }
let AUTONUM=true;   // continue sentence-ID numbering when sentences are inserted or deleted
// transliteration is a toggleable layer; in the real app each token's `translit` is produced by
// wiktra (github.com/twardoch/wiktra2 — Transliterator().tr(form, to_sc="Latn"), 514 langs / 102 scripts)
// and cached on the token. Here it is pre-filled on the sample tokens.
let RTL=false;   // set per-sentence at the top of each notation → the layout mirrors right-to-left
let AVAILW=0;    // usable width of a diagram scroll-port → wide arc diagrams wrap into stacked rows
let AVAILH=0;    // document viewport height → caps the scaled stemma/hierarchy in the wrapped (projection) layout
const RTL_RE=/[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;   // Hebrew, Arabic (+ presentation forms)
function sentRTL(sent){ if(sent.rtl!==undefined) return sent.rtl;   // explicit per-sentence override wins
  if(DOCLANG && RTL_LANGS.has(DOCLANG)) return true;   // the document language (from the model) drives direction
  return sent.tokens.some(t=>RTL_RE.test(t.form)); }   // else fall back to detecting RTL characters
function flipX(c,total){ return RTL ? c.map(x=>total-x) : c; }   // mirror a set of x-centres when right-to-left
let sel={s:-1,t:0};   // item 9: {s:-1,t:0} IS "nothing selected", and it is the state a document starts in — opening a file (or re-parsing a sentence) no longer jumps the selection to token 1. It used to seed {s:0,t:2}, the sample document's second token, which the boot render then made real before any load path had spoken. Everything that reads a selection already guards for s<0 (selEmphasis returns null → nothing dims, menuState reports has:false, pick() short-circuits), so the empty state renders as a complete document with no accent anywhere; what a LOAD sets instead is the reading focus — see clearSelToBlock in js/io/bridge.js.
let selRange=null;   // {s, from, to} — a continuous token range shift-selected in a grid, for grouping into an MWT
// {s,kind,tok,other} — a directly-clicked ghost/dashed edge (Shared=Yes fan-out / Subject-raising: SubjRaising,
// ObjRaising, OblRaising), set ONLY by a click on the dashed line/row itself (pickGhost, js/diagram/diagram-edit.js)
// and never by any menu or automatic pass, per the same "ONLY A CLICK OR A RECTANGLE SELECTS A NODE" rule `sel`
// itself follows. Kept SEPARATE from `sel` rather than reusing it: ONE annotation can draw SEVERAL ghost lines off
// the SAME token (Shared=Yes fans out to every OTHER conjunct in the coordination), so a bare token id can't tell
// two of a token's own ghosts apart, and piggybacking on `sel`/pick() would also mean an ORDINARY click on the
// token that happens to carry the annotation — nowhere near any dashed line — could be Backspaced into deleting
// it by accident. tok = the ONE token whose FEATS/MISC actually carries the annotation (Shared=Yes → the origin;
// Subject=… → the predicate) — what deleteGhostEdge (js/diagram/diagram-edit.js) clears. other = the ghost's
// other endpoint, carried only so two ghosts sharing one `tok` render as distinct selections; delete never reads
// it. kind is "shared" or "subj". Cleared wherever `sel` is set directly (pick(), deselectAll(), the two marquee-
// commit sites in diagram-edit.js) — a plain click always wins the reader's most recent choice, ghost or token,
// never both at once.
let selGhost=null;
/* IS AN INLINE EDITOR OPEN? makeEditable's field (js/editing/context-menu.js) is a bare `<input class="nodeedit">`
   created over whatever it edits — a diagram node, a transliteration row, an MWT tie — and it carries none of the
   data-si/ti/col attributes preserveScroll uses to put focus back after a render. So any re-render while it is
   open destroys it and drops the caret, and the background re-parse a form edit kicks off lands seconds later,
   typically while the reader has moved on to the next field and is mid-word. Renders that are a CONSEQUENCE of
   the edit (makeEditable's own, on commit) must still run — hence a flag consulted by the background paths
   (renderUnlessEditing, js/ui/wiring.js) rather than a block inside preserveScroll itself. */
let INLINE_EDIT_OPEN=false;
/* …and how to bring that field up to date without redrawing it. A skipped render is the right call for the
   caret and the wrong one for the VALUE: if the pass we just declined to draw is what changed the very field
   under the cursor, the reader is left looking at a stale string in a live editor. This closure re-reads the
   model into the open input, and makeEditable sets it (and the flag) together. */
let INLINE_EDIT_SYNC=null;
/* THE CURRENT BLOCK is not the same thing as the selection, and scrolling moves only the first.
   `sel` answers "what is selected" — the token every edit, menu action and keyboard command operates on, and what
   the three-level subtree dimming is computed from (selEmphasis). CURBLOCK answers "which sentence is the reader
   on" — the block that takes the focused-block tint, that the titlebar's "Sentence X of Y" counts, that
   preserveScroll anchors a re-render to, and that a whole-sentence command (insert/duplicate/move/delete/export)
   acts on when nothing narrower is meant.
   These used to be ONE value: the scroll spy called pick(blockIndex, 0), which moved sel.s AND blanked sel.t —
   so scrolling silently threw the selected token away, taking its subtree dimming with it, and there was no way to
   read one sentence while another stayed selected. Splitting them costs one indirection: pick() keeps the two in
   step (selecting a token is also arriving at its block), the scroll spy now moves CURBLOCK alone, and curBlock()
   falls back to sel.s whenever CURBLOCK is unset or stale (a shorter document after a delete), so nothing that
   reads it can ever land out of range. */
let CURBLOCK=-1;
function curBlock(){ return (CURBLOCK>=0&&typeof DOC!=="undefined"&&CURBLOCK<DOC.length)?CURBLOCK:sel.s; }
/* ── A RANGE OF SENTENCES, for the operations that act on more than one ───────────────────────────────────────
   Anchored, not a free set: shift-click and shift-arrow both extend FROM the block focus TO the one clicked, the
   way a list selection works everywhere else, so the state is two indices and not a collection. `BLOCKANCHOR`
   is where the range started; `curBlock()` is its other end, which means the range follows the focus for free
   and there is no second cursor to keep in step with the first.
   -1 is "no range", and that is a different state from "a range of one": a lone block is selected all the time,
   simply by being read, and the sentence commands must not start acting on several until a range is asked for. */
let BLOCKANCHOR=-1;
function blockRange(){ if(BLOCKANCHOR<0) return null; const b=curBlock(); if(b<0) return null;
  const lo=Math.min(BLOCKANCHOR,b), hi=Math.max(BLOCKANCHOR,b);
  return hi>lo ? {lo,hi} : null; }                      // a range that collapsed onto one block is no range
function clearBlockRange(){ if(BLOCKANCHOR<0) return; BLOCKANCHOR=-1; paintBlockRange(); }
/* Every sentence at once (⌘A at block level). Plants the anchor on the first block OUTRIGHT rather than
   letting extendBlockRange adopt curBlock() as it does for a shift-click — "select all" is not an
   extension of where the reader happens to be, it is a range with both ends named. Note a single-sentence
   document ends with no range: blockRange() calls a span of one no range at all, deliberately, and the
   whole point of that rule is that one sentence is selected all the time simply by being read. */
function selectAllBlocks(){ if(typeof DOC==="undefined"||!DOC.length) return;
  BLOCKANCHOR=0; setCurBlock(DOC.length-1); paintBlockRange();
  if(typeof updateFileBlock==="function") updateFileBlock(); }
/* Extend the range to `i` and make it the focus. The anchor is planted on the FIRST shift-click, so an
   ordinary click (which clears it) followed by a shift-click selects exactly the span between the two. */
function extendBlockRange(i){ if(i<0||typeof DOC==="undefined"||i>=DOC.length) return;
  if(BLOCKANCHOR<0) BLOCKANCHOR=curBlock()>=0?curBlock():i;
  setCurBlock(i); paintBlockRange(); if(typeof updateFileBlock==="function") updateFileBlock(); }
/* Class only, no re-render: the range is a selection, and a selection must not cost a repaint of the document
   (the same reasoning applySel already follows for tokens). */
function paintBlockRange(){ const r=blockRange();
  document.querySelectorAll("#doc .sblock").forEach(b=>{ const i=+b.dataset.i;
    b.classList.toggle("rng-block", !!r && i>=r.lo && i<=r.hi); }); }
/* ── ESCAPE DISMISSES THE NARROWEST OPEN THING ────────────────────────────────────────────────────────────────
   Overlays in this app each wired their own Escape, bound to their own element — which works only while focus is
   INSIDE them. Open the find bar, click into the document, press Escape: nothing had the key. This is the
   fallback that catches those, and it is a fallback rather than a replacement: it listens in the BUBBLE phase on
   `document` and does nothing if the event was already handled (defaultPrevented), so every existing handler
   keeps first refusal and none of them had to change.
   `rank` orders the ladder narrowest-first, so a flyout over a menu over the find bar closes one layer per press
   rather than all three at once. Register with a live `isOpen` predicate — not a boolean — because an overlay's
   openness is state the overlay owns and this must never hold a stale copy of it. */
window.ESC_DISMISS=[];
function registerEscDismiss(isOpen,close,rank){ window.ESC_DISMISS.push({isOpen,close,rank:rank==null?100:rank}); }
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||e.defaultPrevented) return;
  const open=window.ESC_DISMISS.filter(d=>{ try{ return !!d.isOpen(); }catch(_){ return false; } })
                               .sort((a,b)=>a.rank-b.rank);
  if(!open.length) return;
  e.preventDefault(); e.stopPropagation();   // preventDefault is what stops AppKit's cancelOperation beeping on a press that DID do something
  try{ open[0].close(); }catch(_){} });
function setCurBlock(i){ if(i===curBlock()) return; CURBLOCK=i;   // scroll-spy entry point: block focus WITHOUT touching the token selection
  document.querySelectorAll("#doc .sblock").forEach(b=>b.classList.toggle("sel-block",+b.dataset.i===i));
  paintBlockRange();   // the range's far end IS the focus, so moving the focus redraws the range
  if(typeof updateFileBlock==="function") updateFileBlock(); }   // keep the "Sentence X of Y" subtitle on the sentence being read
const isStemma=()=>conv.indexOf("stemma")===0;
const arrowsOK=()=>isStemma()||conv==="tree";   // semantic arrows apply to stemmas and hierarchies
const isPunct=t=>famOf(t.deprel)==="punct"||t.upos==="PUNCT";

function famOf(r){return (r||"").split(/[:@\/]/)[0];}   // base of a relation (comp:obj / subj@expl / comp:obj/m → comp / subj / comp)
// does a "|"-joined FEATS string carry this exact Feat=Val pair? (setFeat/clearFeat below add/remove one; this checks one)
function hasFeat(featsStr,name,val){ if(!featsStr||featsStr==="_")return false;
  return featsStr.split("|").some(kv=>{const i=kv.indexOf("="); return i>=0&&kv.slice(0,i)===name&&kv.slice(i+1)===val;}); }
function getFeat(featsStr,name){ if(!featsStr||featsStr==="_")return null;   // NAME NOTWITHSTANDING, this parses any `|`-joined k=v column — FEATS and MISC share that syntax, so the raising accessors below read MISC through it rather than duplicating the loop
  for(const kv of featsStr.split("|")){ const i=kv.indexOf("="); if(i>=0&&kv.slice(0,i)===name) return kv.slice(i+1); } return null; }
/* ── SUD'S `Subject` FEATURE LIVES IN MISC, NOT FEATS ─────────────────────────────────────────────────────────
   It records how the unexpressed subject of a controlled/raised predicate is instantiated. Despite being written
   up on the guidelines' Features pages it is NOT a morphological feature of the token: it describes a
   relationship between two tokens, which is MISC's business. VERIFIED to survive the move where it actually
   matters — grew reads a CoNLL-U MISC entry as a node feature just as it reads FEATS, so SUD_to_UD.grs's
   `D[Subject=ObjRaising|OblRaising|SubjRaising|Raising]` still fires and a raising complement still converts to
   `xcomp` rather than `ccomp` (tested both ways round through the real grammar; that ccomp/xcomp split IS how UD
   represents subject raising, and is the whole reason this feature exists).
   THE KEY IS `Subject`, SPELLED OUT. This app briefly wrote `Subj` into FEATS, which was wrong in both the
   column and the name — the validator's own obsolete-@x message names the feature `Subject`, the conversion
   grammars match on `Subject`, and grid.js's completion inventory always offered `Subject`. No reader here
   accepts the old spelling: migrateLegacySubj (js/io/bridge.js) rewrites it once at load, so nothing downstream
   ever has to know it existed. */
function raiseGet(t,key){ return t?getFeat(t.misc,key):null; }
function raiseSet(t,key,val){ if(t) t.misc=setMiscKV(t.misc,key,val||""); }   // setMiscKV (js/lang/translit-load.js) treats ""/null as "remove the key"   // …and the legacy FEATS spelling goes with it, whether we are setting or clearing
