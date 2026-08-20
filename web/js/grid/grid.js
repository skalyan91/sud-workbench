//@module js/grid.js
/* column alignment: content + cell padding (+ chevron); narrow ID; Misc stretches */
// DEPS (enhanced dependencies) IS a column, and it is one nobody edits by hand: it is not part of SUD, this
// app derives nothing into it any more (getDocJSON, js/io/bridge.js, no longer auto-fills it from Shared=Yes/
// Subject the way an earlier round did — those facts live in FEATS/MISC and the ghost edges, not restated
// here in UD's enhanced-graph notation), and a UD import converts what it can OUT of DEPS into Shared/Subject
// and clears it rather than carrying it forward. What is left is a plain pass-through column for a value a
// file already had before that conversion existed: round-trips and serialises exactly as it always did. It is
// the FIRST column the width rule drops (AUTOHIDE below) rather than being omitted outright, since a file that
// does carry one should still show it whenever the page is wide enough to.
const COLS=[["form","w-form","text","Form"],["lemma","","text","Lemma"],["upos","w-upos","upos","UPOS"],["xpos","","text","XPOS"],
  ["feats","","text","Feats"],["head","w-head","head","Head"],["deprel","w-deprel","deprel","DepRel"],["deep","w-deep","deep","Deep"],["deps","","text","Deps"],["misc","","text","Misc"]];   // CoNLL-U column order, with DEPREL split into its two halves (DepRel = depBase, Deep = the "@" tail) — so DEPS lands where the format puts it, between them and MISC
function sentHasTranslit(s){ return s.tokens.some(t=>t.translit&&t.translit.length) || (s.mwt||[]).some(m=>m.translit); }
/* item 1 — ITRANS → IAST on a committed Form/Lemma cell, for a Sanskrit document (itransFix in
   js/lang/translit.js is a no-op everywhere else). Three deliberate choices:
   · ON BLUR, not on "input": the evidence gate reads the WHOLE word, and half a word ("raa") is not
     yet the word it will be — converting mid-typing would rewrite the field under the caret and then
     have to un-rewrite it on the next keystroke.
   · ONLY IF THIS CELL WAS ACTUALLY EDITED (ctl._edited). Merely tabbing THROUGH a cell must never
     rewrite it: a file may legitimately hold an ASCII spelling this gate would read as ITRANS, and
     silently converting on a focus/blur the user did not mean as an edit would corrupt it.
   · NO pushUndo of its own — the cell's edit session already pushed one snapshot (pendingSnap, on the
     first keystroke), and the conversion is part of that same edit; a second step would make undo
     take two presses to get back to where the typing started.
   The model, not the DOM, is what's re-checked after the await: `t[key]` may have moved on (a
   re-render, an undo, another edit) while the bridge call was in flight, and writing then would
   resurrect a value the user has already left behind. */
/* item 6 — REVEAL THE ELEMENT THE KEYBOARD JUST MOVED TO, on BOTH axes.
   scrollNearest (js/core/document.js) already walks every ancestor scroller and corrects the
   VERTICAL axis, which covers the inner .gwrap (capped at --cap-grid, so it scrolls) and the outer
   #doc. Nothing carried the HORIZONTAL axis with it, and .gwrap is `overflow:auto` with ten columns
   that routinely exceed its width — so Tab (and ←/→ out of a field edge) stepping along a row walked
   the focus straight off the visible edge with no scroll following it. This adds the missing axis
   and is called from every keyboard path, so they all agree with the click path.
   NOT grid-only despite living here (hence the plain name): a `.diagram` is `overflow:auto` capped
   at --cap-dia and an unwrapped stemma/tree/arcs of any length is wider than its port, so the
   diagram's own arrow/Tab navigation has exactly the same missing axis and calls this too — through
   revealTok (js/editing/context-menu.js), which resolves a token id to its drawn cell first.
   The loop is deliberately shaped like scrollNearest's own, including re-measuring the element's
   rect for each scroller (nudging an inner one shifts it for the next) and honouring scroll-padding.
   el.scrollIntoView() is NOT used instead: it scrolls every ancestor to nearest/centre, including
   the page, which yanks the whole document when only the grid needed to move a few pixels — and it
   would fight preserveScroll's restore. Reading the rects (rather than scrollLeft arithmetic) is
   also what makes this correct under RTL, where scrollLeft's origin differs between engines. */
let _gridPicking=false;   // re-entrancy latch for the cell focus handler's pick() — see its own note (a brackets re-render restores focus, which would re-enter it forever)
function revealEl(el){ if(!el) return;
  if(typeof scrollNearest==="function") scrollNearest(el);   // the vertical axis, every ancestor scroller
  let node=el.parentElement;
  while(node){ const cs=getComputedStyle(node);
    if(/(auto|scroll)/.test(cs.overflowX) && node.scrollWidth>node.clientWidth){
      const nr=node.getBoundingClientRect(), er=el.getBoundingClientRect();
      const left=nr.left+(parseFloat(cs.scrollPaddingLeft)||0), right=nr.right-(parseFloat(cs.scrollPaddingRight)||0);
      if(er.left<left) node.scrollLeft-=(left-er.left);
      else if(er.right>right) node.scrollLeft+=(er.right-right);
    }
    node=node.parentElement; } }
/* THE WHOLE OF WHAT A COMMITTED LEMMA SETS OFF, in one place — because two of the three things it sets off are
   ASYNCHRONOUS, and the order they land in is the difference between the diagram showing the edit and showing it
   one edit late.
   afterLemmaEdit (js/io/bridge.js) drops the stale lemma-romanisation, awaits the new one, rewrites MISC
   LTranslit from it, and only THEN re-derives MSeg (forced) — because on a non-Latin document the segmentation is
   computed against LTranslit, which that await is what produces. It ends in its own render. So there is nothing
   for an eager scheduleDoc() to show that isn't already in the cell the user just typed in: no diagram row and no
   grid column draws a lemma, and the rows that DO change (MSeg, MGloss) cannot be right until the await lands.
   An eager render there only bought a second full render per lemma edit — and, before the diagram cache learned
   to notice the sentence's own content (see diaContentSig in js/core/document.js), it was the render that cached
   the diagram from the PRE-edit MSeg and made the whole edit look one step behind.
   The one thing left over is MGloss: msegRefill rewrites MSeg's hyphen slots, and MGloss names those slots one
   for one, so it is re-slotted here (mglossReslot, js/editing/edit-ops.js) inside the SAME undo step — the cell's
   pendingSnap was taken before any of this. That call is a no-op when msegRefill has already made it (its own
   call site, which covers the form-edit and re-parse paths this one doesn't), so the two can both be in place. */
function commitLemmaEdit(si,tokId,t){
  const before=tierText(t,"mseg");
  const done=failed=>{ const moved=mglossReslot(t,before,tierText(t,"mseg"));
    if(moved) markDirty();
    if(moved||failed) preserveScroll(renderDoc); };   // afterLemmaEdit renders for itself; render again only if this re-slot changed something, or if it never got that far
  if(typeof afterLemmaEdit!=="function") return done(true);   // guarded like the context menu's own call: afterLemmaEdit lives in js/io/bridge.js, which loads after this module
  const p=afterLemmaEdit(si,tokId);
  if(p&&typeof p.then==="function") p.then(()=>done(false),()=>done(true)); else done(true); }
async function itransCell(ctl,t,key,si,ti){ const v0=t[key]||""; const v=await itransFix(v0);
  if(v===v0 || t[key]!==v0) return;
  t[key]=v; if(ctl&&ctl.isConnected) ctl.value=v; markDirty(); scheduleDoc();
  if(key==="form") afterFormEdit(si,ti+1,true);                                   // romanisation / script / MSeg all re-derive from the form
  else commitLemmaEdit(si,ti+1,t); }                                              // …and MISC LTranslit + the morpheme segmentation (and the MGloss slots naming it) from the lemma
// Head cell shows the head token's form, plus its transliteration in parentheses when the layer is on
function headText(o){ const st=o?miscTranslit(o.misc):""; return st ? `${o.form} (${st})` : (o?o.form:""); }   // item 1: Head column shows the STORED romanisation (MISC Translit), the canonical transliteration
// transliteration columns (5th flag) show only when the layer is on AND the sentence's script needs it
// ALLCOLS is every column the DOCUMENT admits — the base list AC narrows further by visibility (see below). Kept
// separate because the two have different jobs: scanColW has to measure columns that are currently HIDDEN (else a
// column could never be shown again — see computeAutoHide), and the header's column menu has to LIST them.
const ALLCOLS=si=>COLS.filter(c=>!c[4] || (show.translit && (si==null ? DOC.some(sentHasTranslit) : sentHasTranslit(DOC[si]))));
/* ── WHICH COLUMNS ARE SHOWN ────────────────────────────────────────────────────────────────────────────────────
   Two things decide, in this order:
    · THE USER'S OWN CHOICE, made by ticking or unticking a row in the header's column menu (columnMenu,
      js/editing/context-menu.js). That PINS the column to that state for good — the width rule below stops
      managing it entirely. The pins live in PREFS.gridCols because they are an APPLICATION preference, not a
      property of the file: which columns you read a treebank in is a property of the reader, the same argument
      the notation and the paged/unpaged layout are stored on the same object for.
    · OTHERWISE THE WIDTH RULE (computeAutoHide), which shows every remaining column that fits at its natural
      content width and drops the rest in a fixed order.
   ID and Form are obligatory in both: a row with no id and no form is not a row. They are the two the menu draws
   as disabled, and the two whose headings are drawn Bold at 85 % ink rather than Medium at 50 % (table.grid
   th.th-req, styles/app.css) — which is also why scanColW measures them against HEAD_F_REQ. */
const REQ_COL={id:1,form:1};   // the obligatory columns, named ONCE: read by colShown/toggleCol (neither can be pinned off), by renderGrid (.th-req), and by scanColW (the Bold measuring face). Three call sites used to spell `k==="id"||k==="form"` out separately, which is three places to miss if the set ever changes
const AUTOHIDE=["deps","misc","xpos","feats"];   // the order the width rule DROPS columns in as the page narrows — first to go first. Nothing outside this list is ever auto-dropped: ID/Form are obligatory, and Lemma/Head/DepRel/Deep are what the annotation actually IS
let colAuto=new Set();   // the columns the width rule is currently hiding. Recomputed once per render (computeColW → computeAutoHide), never written anywhere else
function colPin(k){ const p=PREFS&&PREFS.gridCols; return (p&&typeof p==="object"&&typeof p[k]==="boolean")?p[k]:null; }   // true = pinned shown, false = pinned hidden, null = never touched → the width rule decides. A BOOLEAN test, not a truth test: `false` is a real, remembered choice here exactly as it is for prefOrtho/prefTranslit (js/core/prefs.js), and reading it as `!!p[k]` would collapse "the user hid this" into "the user never said"
function colShown(k){ if(REQ_COL[k]) return true; const p=colPin(k); return p==null ? !colAuto.has(k) : p; }
const AC=si=>ALLCOLS(si).filter(c=>colShown(c[0]));
// Toggle one column from the header menu. EVERY grid in the document shares one set of column widths and one
// visibility set (both are document-wide, not per-sentence, exactly as a column drag already is), so this
// re-renders the whole document rather than the one block whose heading was clicked.
function toggleCol(k){ if(REQ_COL[k]) return;   // obligatory — the menu already draws these rows disabled; this is the other half of that, so no caller can pin them off by accident
  if(!PREFS.gridCols||typeof PREFS.gridCols!=="object") PREFS.gridCols={};
  PREFS.gridCols[k]=!colShown(k);   // toggling the EFFECTIVE state, so unticking an auto-shown column hides it and ticking an auto-hidden one shows it — the checkmarks the user is reading are what the click acts on
  if(typeof savePrefs==="function") savePrefs();
  preserveScroll(renderDoc); }
let colW={}, idW=26, colOverride={};   // colOverride: key ('id' or a column key) → user-dragged px width; double-click a border clears it
const MISC_MIN=64;   // floor width for the FEATS/MISC pill columns when they hold no (or only tiny) chips
const PILL_PAD=42;   // a Key=Value chip's chrome (chip padding + the × button + borders + field/cell padding) + the chip's 3px margin-inline-end + rounding slack → a column sized to the widest single chip never clips it, AND leaves room for the trailing caret-anchor text node so it never wraps to an empty line-box (which would inflate the row height and stop it auto-fitting back to a single line)
// FEATS & MISC hold Key=Value chips that must never truncate: size the column to the WIDEST SINGLE chip (chips then wrap onto extra lines), not to the whole |-joined field
/* ── COLUMN-WIDTH CACHE ─────────────────────────────────────────────────────────────────────────────────────────
   computeColW() used to re-measure EVERY token in EVERY sentence, for EVERY column, on every single renderDoc()
   call — meas() forces an SVG getComputedTextLength() layout per call, so at 20,000 sentences x ~15 tokens x
   ~8 columns that was up to ~2,000,000 forced layouts per keystroke (a single-token edit calls refresh() ->
   renderDoc() -> computeColW() same as opening the file does). colWRaw/idWRaw are the REAL (never-shrunk) content
   widths, kept across renders; computeColW() only re-measures the sentence RANGE a mutator reports touched
   (touchColW), merging via Math.max — so a column can only WIDEN from an edit, never shrink, until
   invalidateColW() forces a full rescan. That's an accepted trade-off, not a bug: colW is an advisory layout
   width (a cell narrower than its content still shows the value in full on focus — see the "Excel-style
   edit-expansion" note above ctl's focus handler), so an occasional stale-wide or stale-narrow column is cosmetic
   slop, not incorrect data — and far cheaper than re-measuring 20,000 sentences on every keystroke.
   Invalidated wholesale (full rescan next call) on: first call, a brand-new/reopened/undone document (DOC
   replaced wholesale — see the invalidateColW() call sites in bridge.js/formats.js/init.js/undo.js), and a
   font-stack change (refreshFontStacks, diagram-core.js — the only thing besides content that can change what
   meas() returns). Structural edits that change DOC's length/order (insert/delete/move a SENTENCE) also
   invalidate wholesale rather than tracking a range, since they can shift the margin numbering (marginNumWidth)
   over an arbitrary tail of the document; edits within one sentence's tokens call touchColW(si,si+1) instead. */
let colWRaw={}, idWRaw=0, colWReady=false, colWDirtyFrom=Infinity, colWDirtyTo=-Infinity;
function touchColW(from,to){ colWDirtyFrom=Math.min(colWDirtyFrom,from); colWDirtyTo=Math.max(colWDirtyTo,to); }
function invalidateColW(){ colWReady=false; colWRaw={}; idWRaw=0; colWDirtyFrom=Infinity; colWDirtyTo=-Infinity; }
function pillColW(k,H,from,to){ let m=Math.max(MISC_MIN, meas(H,HEAD_F)+16);   // headings render TITLE CASE in the UI font now (see the table.grid th rule in styles/app.css) → measure the label as written. The old `H.toUpperCase()` + H.length*0.4 pair sized an UPPERCASED run plus its .4px letter-spacing, both of which are gone; leaving them in would have over-sized every column by roughly a character
  const eat=raw=>{ if(!raw||raw==="_")return; String(raw).split("|").forEach(s=>{ s=s.trim(); if(s) m=Math.max(m, meas(s,GRID_F)+PILL_PAD); }); };
  DOC.slice(from,to).forEach(s=>{ s.tokens.forEach(t=>eat(t[k])); if(k==="misc")(s.mwt||[]).forEach(mm=>eat(mm.misc)); });   // include MWT-row MISC chips
  return Math.round(m); }
// the ID column's OWN total inline padding — --grid-row-pad on the inline-start (tied to the row band's own left
// inset, table.grid td.col-id in styles/app.css) + the flat 6px kept on the inline-end. ONE function so idWRaw
// below and marginNumWidth (js/core/document.js) can't drift apart on what "the ID cell's own padding" means —
// both used to spell it as a bare literal 12 (6+6), which went stale the instant the inline-start padding was
// tied to --grid-row-pad instead. css() (diagram-core.js) caches the read, so calling this per scan costs nothing.
function idPadTotal(){ return (parseFloat(css("--grid-row-pad"))||10)+6; }
// re-measures ONLY DOC.slice(from,to), merging into colWRaw/idWRaw via Math.max — see the cache note above
function scanColW(from,to){
  let maxTok=0; DOC.slice(from,to).forEach(s=>maxTok=Math.max(maxTok,s.tokens.length));
  idWRaw=Math.max(idWRaw, Math.ceil(meas(String(Math.max(maxTok,1)),GRID_F))+idPadTotal());   // …and the LEFT MARGIN shares this width: the sentence number and the §/¶ marks are drawn in the same box at their own sizes, and a number too wide for the token ids must widen the column rather than overflow it (js/core/document.js)   // content-fit like the columns below: the widest displayed id string (String(maxTok) is the largest index → longest id) + the cell's own padding (idPadTotal, above). NOT floored to the "ID" header, which used to oversize the column whenever ids are short (single-digit). MWT range rows render no id text (see renderGrid), so they don't widen it
  // EVERY column the document admits, not just the VISIBLE ones (ALLCOLS, not AC). That is what makes the width
  // rule below monotonic: a hidden column still has a live natural width in colWRaw, so widening the page can find
  // it again. Measuring only the visible ones froze a column's width at whatever it was when it went away — and a
  // brand-new column (one that has never been shown) would have had no width at all, so it could never come back.
  ALLCOLS().forEach(([k,cls,ty,H])=>{
    if(k==="feats"||k==="misc"){ colWRaw[k]=Math.max(colWRaw[k]||0, pillColW(k,H,from,to)); return; }   // the pill columns are sized to their widest single CHIP, not to the whole |-joined field — see pillColW. (This call had been dropped at some point and the two columns were left with no colWRaw entry at all, so their <col> width came out "undefinedpx" and the browser auto-sized them; the width rule below needs a real number for Misc, since Misc is the second column it drops.)
    let m=meas(H,REQ_COL[k]?HEAD_F_REQ:HEAD_F)+16;   // headings render TITLE CASE in the UI font (see pillColW's own note) → size to the label as written, so the cell's 8+8px padding isn't eaten. TWO faces: the obligatory columns are drawn Bold and the rest Medium (table.grid th / th.th-req, styles/app.css), so "Form" measured at Medium came out narrower than it renders. pillColW needs no such branch — Feats and Misc are both optional by construction (they are in AUTOHIDE)
    DOC.slice(from,to).forEach(s=>s.tokens.forEach((t,i)=>{ let str=t[k]??"";
      if(k==="deprel")str=depBase(t.deprel); else if(k==="deep")str=depDeep(t.deprel);   // DepRel/Deep are the two halves of the token's deprel field
      if(k==="head"){ const h=parseInt(t.head,10); const o=s.tokens[h-1]; const maxDig=String(s.tokens.length).length, padHead=v=>String(v).padStart(maxDig," ");   // item 4: space-pad the token number (display only, never persisted) so the "·" separators line up down the column
        str=(t.head==="0"?padHead(0)+" · root":(o?`${padHead(t.head)} · ${headText(o)}`:t.head)); }
      const pad=((ty==="upos"||ty==="head")?34:18)+(k==="deep"?16:0);   // input padding (8+8) +2 border; dropdown adds ~22 chevron. DepRel is now a free-text autocomplete <input> like Deep, not a <select> — no chevron reserve. Deep reserves +16px for its fixed "@" prefix decoration (.cin.deepin padding-inline-start)
      m=Math.max(m, meas(str, k==="form"?gridFormFont(t):GRID_F)+pad); }));   // a Foreign=Yes form renders italic in the Form cell → size the column to the italic width
    colWRaw[k]=Math.round(Math.min(320,Math.max(colWRaw[k]||0,m))); });   // columns cap at 320. MWT forms AND transliterations aren't counted — both break out of the column instead (the MWT row's own input sizes itself past td.offsetWidth when needed, see the mwt-row "form" branch below)
}
function computeColW(){
  // Scan the CURRENT RENDER'S WINDOW (js/core/document.js's winLo/winHi — computeWindow() has already run by the
  // time renderDoc() calls this) every time, not just on a touched range: a sentence can only be edited once it's
  // on screen, i.e. inside the window, so this alone already covers every edit — the touchColW/colWDirtyFrom-To
  // tracking below is belt-and-braces for a mutation path that doesn't go through the window, not the primary
  // mechanism. Scanning the WHOLE document on the very first call (as this used to) defeated the point of
  // windowing renderDoc() at all: at 20,000 sentences it cost ~3s per 2,000 sentences of meas() calls alone
  // (measured), i.e. minutes at file-open, regardless of how few `.sblock`s actually got built. Scanning only the
  // window here means a sentence's own grid is ALWAYS measured immediately before it is built (this runs before
  // buildBlock in renderDoc), so nothing ever clips — the tradeoff is purely that a column may not yet be as wide
  // as some sentence further away that hasn't been scrolled to yet (self-corrects the moment that sentence enters
  // the window, for the same reason).
  if(typeof winLo==="number"&&typeof winHi==="number") scanColW(Math.max(0,winLo),Math.min(DOC.length,winHi));
  else scanColW(0,DOC.length);   // no window (e.g. a harness that calls this before document.js has loaded) → fall back to the old full scan
  if(!colWReady){ if(typeof marginNumWidth==="function") idWRaw=Math.max(idWRaw, marginNumWidth()); colWReady=true; }   // marginNumWidth is its own, much cheaper, full-document pass (no per-token meas() — see its own note) and only needs to run once (or after invalidateColW) rather than every render
  if(colWDirtyTo>colWDirtyFrom) scanColW(Math.max(0,colWDirtyFrom),Math.min(DOC.length,colWDirtyTo));   // whatever a mutator explicitly reported (see the note above)
  colWDirtyFrom=Infinity; colWDirtyTo=-Infinity;
  computeAutoHide();   // BEFORE fitColW (and before renderGrid): the width rule decides which columns exist at all, and fitColW's budget is then spent only on the survivors. AFTER the scans above, so it tests against freshly-measured natural widths
  colW=Object.assign({},colWRaw); idW=idWRaw;   // a FRESH copy each render, so fitColW's proportional shrink below never compounds across renders (see its own note)
  fitColW();
  for(const k in colOverride){ if(k==="id") idW=colOverride.id; else if(k in colW) colW[k]=colOverride[k]; }   // user-set widths win over auto-fit
}
/* THE GRID'S WIDTH BUDGET, in unzoomed px — ONE computation shared by the auto-hide rule and by fitColW's
   proportional shrink, so the two can never disagree about how much room there is. Returns null when there is no
   #doc to measure (a harness), which both callers read as "decide nothing".
   Task F — PAGED layout centres every block inside a .docsheet capped at --page-measure (app.css); #doc
   itself stays the full WINDOW width (its own padding-inline:16px is already counted in clientWidth), so
   measuring docEl.clientWidth alone — as the unpaged case always has — overstated the room a paged grid
   actually has, and the fixed-layout columns overflowed the (narrower) sheet instead of shrinking to
   fit it. Clamp to the sheet's real available width instead: #doc's own 16px inline padding on each side
   (already inside clientWidth) isn't available to centre the sheet in, and the sheet itself never exceeds
   --page-measure. Read as a CSS custom property rather than a stale previous-render .docsheet measurement
   (computeColW runs before renderDoc clears #doc, so a queried .docsheet would exist — but not yet on the
   very first paged render, and this is exact in both cases).
   Toggling paged/unpaged therefore moves this number, and setPageMode (js/ui/wiring.js) re-renders — which is
   what recomputes the auto-hide set for the new measure. A live window resize does the same through the
   ResizeObserver on #doc in js/core/scroll.js, so neither needs a listener of its own here. */
function gridAvail(){ const docEl=document.getElementById("doc"); if(!docEl) return null;
  let availPx=docEl.clientWidth;   // real (post-zoom) px — #doc itself carries no zoom, only .sblock does
  if(PAGED){ const pm=parseFloat(getComputedStyle(docEl).getPropertyValue("--page-measure"))||Infinity;
    availPx=Math.min(availPx-32, pm); }
  const avail=availPx/FS-42;   // block padding (36) + slack; sblock is zoomed by FS, meas() is unzoomed
  return avail>0?avail:null; }
// the width the auto-hide rule tests a column at: its user-dragged override if it has one, else its NEVER-SHRUNK
// natural content width. Never the post-fitColW colW — see computeAutoHide's monotonicity note.
function natColW(k){ if(k==="id") return (colOverride.id||idWRaw); return (colOverride[k]||colWRaw[k]||0); }
/* THE WIDTH RULE — show every column that fits at its natural (unshrunk) content width, and otherwise drop the
   lowest-priority auto-hideable one, ONE AT A TIME, until the rest fit. AUTOHIDE names the order: Deps, then Misc,
   then XPOS, then Feats. Once even that is exhausted, fitColW's proportional shrink takes over as the last resort
   — which is the OLD behaviour, now demoted from first response to last: a narrow page used to squeeze every
   column and let the cells wrap to several lines (`multiline` in renderGrid), where it now sheds the columns
   nobody edits by hand and keeps the rest legible.
   WHY IT IS MONOTONIC — widening the page can only REVEAL columns, narrowing can only HIDE them. The hidden set is
   a pure step function of `avail`: walk AUTOHIDE, dropping while the running total exceeds the budget. That is
   monotone in `avail` for exactly one reason — THE WIDTHS IT TESTS AGAINST DO NOT DEPEND ON WHICH COLUMNS ARE
   SHOWN. Hence natColW reads colWRaw (the never-shrunk cached content widths, measured for every column whether
   shown or not — see scanColW) and never colW, which fitColW has already shrunk BY the very set this function
   decides. Feeding colW back in would make the rule depend on its own output: hiding a column widens the survivors
   (less shrink), which changes the total, which can hide another — a ratchet that never reverses when the window
   is widened back, and the exact behaviour the user asked us not to have. */
function computeAutoHide(){ const hide=new Set(), avail=gridAvail();
  if(avail==null){ colAuto=hide; return; }   // nothing to measure against → hide nothing, rather than guess a budget
  const cols=ALLCOLS().map(c=>c[0]).filter(k=>colPin(k)!==false);   // a column the user has pinned OFF is already gone and costs the budget nothing
  let total=natColW("id")+cols.reduce((s,k)=>s+natColW(k),0);
  for(const k of AUTOHIDE){ if(total<=avail) break;
    if(!cols.includes(k) || colPin(k)!=null) continue;   // not in play (translit-gated / already pinned off), or PINNED by the user — an explicit choice is not the rule's to overrule
    hide.add(k); total-=natColW(k); }
  colAuto=hide; }
/* if the shared columns would STILL be wider than the grid's port once the width rule above has dropped what it
   can, shrink them proportionally so the grid never overflows (the Excel-style edit-expansion still shows a
   cell's full value on focus). idW is kept; Misc stays auto and takes any slack. */
function fitColW(){ const avail=gridAvail(); if(avail==null) return;
  const pillW=AC().map(c=>c[0]).filter(k=>k==="feats"||k==="misc").reduce((s,k)=>s+(colW[k]||0),0);   // FEATS/MISC keep their full widest-chip width — they'd sooner scroll the grid than clip a pill
  const keys=AC().map(c=>c[0]).filter(k=>k!=="misc"&&k!=="feats");
  const fixed=keys.reduce((s,k)=>s+(colW[k]||0),0), budget=avail-pillW-idW;
  if(fixed>budget && budget>0){ const f=budget/fixed;
    keys.forEach(k=>{ colW[k]=Math.max(30,Math.round(colW[k]*f)); }); }
}
function opt(v,label,seld){const o=document.createElement("option"); o.value=v; o.textContent=label??v; if(seld)o.selected=true; return o;}
// fill a grid <select> with vocab grouped into the same categories the context menus use.
// headers are disabled options (NOT optgroups — the native macOS popup indents optgroup options, which can't be
// removed via CSS); no "_" option — a blank value defaults to defVal.
function fillCatSelect(sel,cats,vocab,current,defVal){
  const vset=new Set(vocab), placed=new Set(); let found=false;
  const cur=(current&&current!=="_")?current:"";   // empty stays empty and selectable (flagged under Issues), rather than coercing to a default
  const header=name=>{ const o=opt("__h__","— "+name+" —"); o.disabled=true; sel.appendChild(o); };
  sel.appendChild(opt("","(none)",cur===""));   // an explicit empty value is allowed
  cats.forEach(([name,members])=>{ const present=members.filter(m=>vset.has(m)); if(!present.length)return;
    header(name); present.forEach(m=>{ placed.add(m); const s=m===cur; if(s)found=true; sel.appendChild(opt(m,undefined,s)); }); });
  const extra=vocab.filter(v=>!placed.has(v));
  if(extra.length){ header("Other"); extra.forEach(v=>{ const s=v===cur; if(s)found=true; sel.appendChild(opt(v,undefined,s)); }); }
  if(!found && cur) sel.appendChild(opt(cur,cur+(vset.has(cur)?"":" ⚠"),true)); }
/* ── the grid's MWT bracket, drawn as a real SVG over the group's rows ─────────────────────────────────────────
   A table can't span one element across several rows, so the bracket can't simply be a child of the group: it is
   an overlay MEASURED over the group's first and last rows. In exchange it is the SAME drawing primitive as the
   diagram's own MWT tie, taking its ink from .mwt-tie so there is one source of truth for the colour.
   The two weights pair the grid's bracket with the diagram's tie part for part BY ROLE, not by orientation: the
   long CONNECTOR takes the .75× (the diagram's connecting bar does), the short END PINS take the full
   var(--arc-stroke) (the diagram's end pins do). Since the grid's bracket is the tie turned on its side, that
   puts the .75× on the vertical spine and the full stroke on the horizontal ticks — the reverse of the
   horizontal-reads-heavier correction .mwt-tie-h encodes, which is why the widths are set in CSS here (.gtie-*)
   rather than inherited from that class.
   This is settled, not provisional: the orientation-based split (full stroke on the spine) was tried both before
   the casing existed and again after, and read too thick either way. The spine runs the whole height of every
   component row — many times the diagram tie's span — so it carries far more ink at the same width, and wants
   the LIGHTER of the two weights, not the heavier. Don't "restore" it to match .mwt-tie/.mwt-tie-h by symmetry.

   The bracket spans its group exactly — flush with the first row's top and the last row's bottom — and its spine
   is CENTRED ON THE GRID'S FRAME: bleed = (spine + frame border)/2 puts the spine's centreline exactly on the
   frame line's centreline, so the bracket reads as a symmetric thickening of the frame where a group runs rather
   than as a second line beside it. Both terms are measured, never assumed, so the centring survives a change to
   either the stroke weight or the frame's own width.
   That bleed reaches outside .gwrap's padding box, and .gwrap is a scroll container, which clips exactly that
   overhang (nothing outside its padding box is reachable, scrolled or not). So the overlays don't live in .gwrap:
   each grid gets a .gtiebleed window, absolutely positioned over the wrap's padding box but widened on the
   inline-start side, with overflow:hidden — the overhang shows while a bracket still can't spill above or below
   the grid frame. Inside it, .gtieshift holds the ties in CONTENT coordinates (origin = the wrap's padding-box
   origin) and is translated by the wrap's scroll offset, so scrolling is one transform, not a re-measure.
   .gtiebleed is a child of the (static) .gridbox, so its containing block resolves to .sblock — deliberately NOT
   .gridbox, which must stay unpositioned or .gwrap's offsetParent changes and renderDoc's gapMid maths shifts.

   Coordinates: getBoundingClientRect() reports SCALED (zoomed) viewport px while style.left/top are unscaled CSS
   px, so every measured distance is divided by FS — the same convention renderDoc's diagram-alignment pass uses.
   Border widths come off the computed style rather than clientLeft/clientTop, which round to an integer, and
   scrollLeft/scrollTop turn the visible offset back into a position in the full scrollable content.
   Re-run: renderDoc (which covers zoom via setFS, window resize, and a column drag — all of them re-render), plus
   a ResizeObserver per table for the one case that changes row heights WITHOUT a re-render — a FEATS/MISC pill
   wrapping onto another line as it's edited. Scrolling needs no re-run (see .gtieshift above). */
const MWT_TIE_PIN=5;   // the ticks' reach, matching the diagram tie's own PIN=5 (mwtTie)
const MWT_TIE_CAS=5*0.75;   // the casing halo's width: .75× the 5px .mwt-tie-cas gives the diagram's tie — the halo only has to clear the grid's own hairlines (the frame, the row rules), not the 15px forms and arcs the diagram tie sits among. Kept here as a number only because the bleed window has to be sized to clear it; keep in step with the .gtie-cas rule
function tieStroke(){ const S=parseFloat(css("--arc-stroke"))||1.5; return {spine:S*0.75, tick:S}; }   // long connector at .75×, end pins at full weight — the diagram tie's own split, mapped by role (see the block comment). MUST stay in step with the .gtie-spine / .gtie-pin widths in the stylesheet
function tieBleed(frameW){ return (tieStroke().spine+frameW)/2; }   // centres the spine on the frame line: spine spans [−b, −b+V], frame spans [−frameW, 0] → equal centres at −frameW/2 gives b = (V+frameW)/2
function drawGridTie(host,wrap,r0,r1,rtl){
  const cell=r0.querySelector("td.col-id"); if(!cell) return;
  const wr=wrap.getBoundingClientRect(), a=r0.getBoundingClientRect(), b=r1.getBoundingClientRect(), c=cell.getBoundingClientRect();
  const {spine:V,tick:K}=tieStroke();
  const h=(b.bottom-a.top)/FS; if(!(h>0)) return;   // the group's full span. A detached/hidden grid measures 0 — nothing to draw (the next pass picks it up)
  const wcs=getComputedStyle(wrap);
  const bl=parseFloat(wcs.borderLeftWidth)||0, bt=parseFloat(wcs.borderTopWidth)||0;   // getBoundingClientRect is the BORDER box; content coordinates start at the PADDING box
  const edge=rtl?c.right:c.left;   // the ID column's inline-START edge…
  /* …and the bracket sits FLUSH INSIDE the row band's own inline-start edge, --grid-row-pad in from there — not
     on the grid FRAME, which is where it used to sit (bled outward by B, spine centre at −frameW/2). The rows are
     drawn as inset pills (see table.grid tbody td::before in styles/app.css) and the MWT range row now joins them,
     so a bracket still hugging the frame stood a whole 10px clear of the group it brackets. FLUSH, not centred on
     that edge: the spine's own inline-start edge is what lands on the band's, so the two abut with no seam and no
     overlap — hence +V/2 (LTR) rather than −V/2 from the band edge. That is also why .mwtgrp squares its
     inline-start corners in the stylesheet: against a rounded corner "flush" is only true down the middle of the
     group. Measured off the custom property rather than hard-coded, so bracket and band move together.
     B and the .gtiebleed window it sizes are LEFT ALONE: nothing bleeds outward any more — the whole bracket,
     casing included (half of 3.75px), now sits inside a 10px inset — so that window is slack rather than a
     requirement, but it still does the other job its comment gives it, clipping a bracket to the frame's top and
     bottom while the grid scrolls. */
  const P=parseFloat(css("--grid-row-pad"))||0;
  const x=(edge-wr.left)/FS-bl+wrap.scrollLeft+(rtl?-P:P);   // the box origin IS the band edge: the spine is drawn at sx=V/2 inside it (ex=PIN away in RTL), so its own inline-START edge lands exactly on P — flush, no half-stroke of overhang either way
  const sx=rtl?MWT_TIE_PIN-V/2:V/2, ex=rtl?0:MWT_TIE_PIN;   // spine x within the box, and the x the ticks reach to
  const spine=`M ${sx} 0 V ${h}`, ticks=`M ${sx} ${K/2} H ${ex} M ${sx} ${h-K/2} H ${ex}`;   // ticks inset by half their own width so each sits fully inside the bracket, flush with its top/bottom edge
  const svg=E("svg",{class:"mwt-grid-tie",width:MWT_TIE_PIN,height:h,viewBox:`0 0 ${MWT_TIE_PIN} ${h}`});
  svg.style.left=(rtl?x-MWT_TIE_PIN:x)+"px"; svg.style.top=((a.top-wr.top)/FS-bt+wrap.scrollTop)+"px";
  svg.appendChild(E("path",{class:"mwt-tie-cas gtie-cas",d:spine+" "+ticks}));   // casing FIRST → paints behind the ink. The whole bracket in one path, so the halo is continuous through the corners rather than two overlapping stubs
  svg.appendChild(E("path",{class:"mwt-tie gtie-spine",d:spine}));   // .mwt-tie for the ink; .gtie-* overrides the weight (see the block comment on the role-based split)
  svg.appendChild(E("path",{class:"mwt-tie gtie-pin",d:ticks}));
  host.appendChild(svg);
}
function syncTieScroll(wrap,shift){ shift.style.transform=`translate(${-wrap.scrollLeft}px,${-wrap.scrollTop}px)`; }
function layoutGridTies(rebind){
  document.querySelectorAll("#doc .gridbox").forEach(box=>{
    const wrap=box.querySelector(".gwrap"), bleed=box.querySelector(".gtiebleed"); if(!wrap||!bleed) return;
    const shift=bleed.firstElementChild; shift.textContent="";   // rebuilt from scratch → idempotent, so any trigger can just call this
    const tb=wrap.querySelector("table.grid tbody"); if(!tb) return;
    // the bleed window, positioned against its own containing block — .gridbox is static, so that resolves up to
    // .sblock, NOT to .gridbox itself (measuring against .gridbox silently puts the whole layer in the wrong place)
    const cb=bleed.offsetParent; if(!cb) return;   // display:none → nothing to place (the next pass picks it up)
    const cr=cb.getBoundingClientRect(), ccs=getComputedStyle(cb);
    const cL=parseFloat(ccs.borderLeftWidth)||0, cT=parseFloat(ccs.borderTopWidth)||0;   // an abspos child is placed against the containing block's PADDING box too
    const wr=wrap.getBoundingClientRect(), wcs=getComputedStyle(wrap), rtl=wcs.direction==="rtl";
    const bL=parseFloat(wcs.borderLeftWidth)||0, bR=parseFloat(wcs.borderRightWidth)||0,
          bT=parseFloat(wcs.borderTopWidth)||0, bB=parseFloat(wcs.borderBottomWidth)||0;
    const B=tieBleed(rtl?bR:bL);              // the outward reach the window still allows for. It is no longer where the spine GOES (drawGridTie centres it on the row band, --grid-row-pad inside the frame — see its own note); kept as the window's measure so the clip boundary can't land on the bracket if that inset is ever narrowed
    const pad=B+MWT_TIE_CAS/2+1;              // …and the window reaches far enough past it to clear the casing halo (half its width outward from the spine's centreline), plus 1px so nothing sits on the clip boundary itself
    const pw=wr.width/FS-bL-bR, ph=wr.height/FS-bT-bB;
    if(!(pw>0&&ph>0)) return;
    bleed.style.left=((wr.left-cr.left)/FS-cL+bL-(rtl?0:pad))+"px"; bleed.style.top=((wr.top-cr.top)/FS-cT+bT)+"px";
    bleed.style.width=(pw+pad)+"px"; bleed.style.height=ph+"px";
    shift.style.left=(rtl?0:pad)+"px";   // .gtieshift's origin === the wrap's padding-box origin, so the ties below are placed in plain content coordinates
    syncTieScroll(wrap,shift);
    let first=null;
    [...tb.rows].forEach(r=>{ if(r.classList.contains("mwtgrp-first")) first=r;
      if(first && r.classList.contains("mwtgrp-last")){ drawGridTie(shift,wrap,first,r,rtl); first=null; } });
  });
  if(rebind) bindTieObserver();   // only renderDoc passes this — see bindTieObserver on why the observer's own callback must NOT
}
let _tieRO=null, _tieRAF=0;
function bindTieObserver(){   // a FEATS/MISC pill wrapping onto another line changes a row's height with NO re-render → re-measure on the table's own resize
  if(typeof ResizeObserver==="undefined") return;
  if(!_tieRO) _tieRO=new ResizeObserver(()=>{ cancelAnimationFrame(_tieRAF); _tieRAF=requestAnimationFrame(()=>layoutGridTies()); });   // coalesce a burst of row-height changes into one pass. NO rebind from in here: observe() fires an immediate callback, so re-binding from the callback would loop. Redrawing can't resize the table back either (the overlays are absolute), so the pass itself is loop-free
  _tieRO.disconnect();   // renderDoc replaces every table → drop the previous render's detached ones, which the observer would otherwise hold alive
  document.querySelectorAll("#doc table.grid").forEach(t=>_tieRO.observe(t));
}
function renderGrid(si){
  const sent=DOC[si];
  const wrapEl=document.createElement("div"); wrapEl.className="gwrap";
  const table=document.createElement("table"); table.className="grid";
  const cg=document.createElement("colgroup");
  const idcol=document.createElement("col"); idcol.style.width=idW+"px"; idcol.dataset.col="id"; cg.appendChild(idcol);
  AC(si).forEach(([k])=>{const col=document.createElement("col"); col.dataset.col=k; col.style.width=colW[k]+"px"; cg.appendChild(col);});  // every column (incl. MISC) gets an explicit width so MISC pills never collapse/clip; any slack still distributes across the fixed-layout columns
  table.appendChild(cg);
  const grip=(key,fixed)=>{const g=document.createElement("div"); g.className="colresize"+(fixed?" fixed":""); g.dataset.col=key; if(!fixed)g.title="Drag to resize · double-click to auto-size"; return g;};
  const FIXEDW={id:1,upos:1,deprel:1};   // fixed-option columns (ID + the dropdown vocabularies) aren't user-resizable — the divider stays, dragging is off
  const thead=document.createElement("thead"); const htr=document.createElement("tr");
  const idth=Object.assign(document.createElement("th"),{className:"col-id th-req",textContent:"ID"}); idth.appendChild(grip("id",true)); htr.appendChild(idth);   // .th-req: ID and Form are the two OBLIGATORY columns, and their headings say so by taking the full --text ink instead of the muted heading colour (styles/app.css) — the same distinction the column menu draws by greying their rows out
  AC(si).forEach(([k,cls,ty,H])=>{const th=document.createElement("th"); th.dataset.col=k;
    if(ty==="rotext"){ th.className="th-tr"; const sp=document.createElement("span"); sp.dir="ltr"; sp.textContent=H; th.appendChild(sp); }   // LTR span → "Translit." keeps its dot on the right even under RTL
    else th.textContent=H;
    if(k==="form") th.classList.add("th-req");   // …the other obligatory heading (classList.add, not className=, so the rotext branch's own class survives)
    if(k!=="misc") th.appendChild(grip(k, !!FIXEDW[k]));   // Misc stretches to fill, so it isn't resizable
    htr.appendChild(th);});
  /* Right-click ANY heading → the Finder-style column chooser (columnMenu). Bound to the header ROW rather than
     to each <th>, so the gaps between cells answer too and one listener serves however many columns are drawn.
     The resize grip straddles the column border and owns its own gestures, so it is excluded; stopPropagation
     keeps the event off the block/sentence menus that would otherwise also see it bubble past.
     columnMenu lives in js/editing/context-menu.js, which loads AFTER this module — safe because this closure
     runs at RENDER time, long after every module is defined (see CLAUDE.md's forward-reference hazard), and
     guarded anyway for a harness that doesn't load that file. */
  htr.addEventListener("contextmenu",ev=>{ if(ev.target.closest(".colresize")) return;
    ev.preventDefault(); ev.stopPropagation();
    if(typeof columnMenu==="function") columnMenu(ev.clientX,ev.clientY,si); });
  const idth2=htr.querySelector(".col-id"); if(idth2)idth2.dataset.col="id";
  thead.appendChild(htr); table.appendChild(thead);
  const tb=document.createElement("tbody");
  const mwtStart={}, mwtComp=new Set(), mwtEnd=new Set(), mwtOf={}; (sent.mwt||[]).forEach(m=>{mwtStart[m.from]=m; mwtEnd.add(m.to); for(let k=m.from;k<=m.to;k++){mwtComp.add(k); mwtOf[k]=m;}});   // range rows precede their component words   // mwtOf: component token id → its range, so each component row can name the group it belongs to
  sent.tokens.forEach((t,i)=>{
    const ms=mwtStart[i+1];
    if(ms){ const mr=document.createElement("tr"); mr.className="mwt-row mwtgrp mwtgrp-first"; mr.title="multi-word token";
      mr.dataset.s=si; mr.dataset.mwtfrom=ms.from; mr.dataset.mwtto=ms.to;   // the range row is now ADDRESSABLE, which two things need: applySel's .mwtsel pass (js/core/document.js) lights the whole group, and selectMWTRange (js/editing/context-menu.js) scrolls the grid to THIS row when the MWT is clicked in the diagram. Deliberately no data-tok — the row is a range, not a token, and pick()'s own `+tr.dataset.tok===t` pass must never match it (NaN never does)
      if(mwtGroupSel(si,ms.from,ms.to)) mr.classList.add("mwtsel");
      const mid=document.createElement("td"); mid.className="col-id"; mid.draggable=true; mid.style.cursor="grab"; mid.title="Drag to move the whole multi-word token"; mr.appendChild(mid);   // no range text — the left border marks the group
      mid.addEventListener("dragstart",e=>{ DRAG={si,group:{gf:ms.from-1,gt:ms.to-1}}; mr.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain","mwt"); });
      mid.addEventListener("dragend",()=>{ mr.classList.remove("dragging"); clearDZ(); });
      AC(si).forEach(([key,cls,type])=>{ const td=document.createElement("td"); if(cls)td.className=cls;
        if(key==="form"){ td.style.overflow="visible"; const inp=document.createElement("input"); inp.className="cin mwtform"; inp.value=ms.form; inp.spellcheck=false; inp.title="surface form"; inp.dir=sentRTL(sent)?"rtl":"ltr"; inp.style.fontStyle="normal";   // upright (inline wins over .cin{font:inherit}, which otherwise re-inherits the row's italic and slants shaped Arabic past the box); dir set so RTL forms align/measure correctly
          const size=()=>{ inp.style.width="30px"; inp.style.width=Math.max(td.offsetWidth||0, inp.scrollWidth+14)+"px"; };   // scrollWidth = the input's real content width (shaped Arabic, zoom-consistent) → never clips
          // The MWT range row's own Form funnel, matching the token rows': ONE undo snapshot per editing session
          // (taken on focus, pushed on the first keystroke that actually changes the value — the same shape the
          // .cin cells use), and a commit that routes through afterMwtFormEdit so the edit reaches `# text`.
          // Without the snapshot a range-form edit was silently un-undoable and never lit "– Edited", the range
          // carrying no pendingSnap of its own; without the commit call it reached the model and stopped there.
          let mwtSnap=null, mwtOrig=ms.form;
          inp.addEventListener("focus",()=>{ mwtSnap=snapSent(si); mwtOrig=ms.form; });
          inp.addEventListener("input",()=>{ if(mwtSnap&&inp.value!==mwtOrig){ UNDO.push(mwtSnap); if(UNDO.length>80)UNDO.shift(); REDO.length=0; mwtSnap=null; updateUndoUI(); }
            ms.form=inp.value; markDirty(); size(); });
          inp.addEventListener("blur",()=>{ mwtSnap=null; });
          inp.addEventListener("change",()=>{ afterMwtFormEdit(si,ms.from,inp.value!==mwtOrig); scheduleDoc(); });
          td.appendChild(inp); requestAnimationFrame(size); }
        else if(key==="translit"){ td.className=(cls?cls+" ":"")+"rocell"; td.textContent=ms.translit||""; }
        else if(key==="misc"){ if(!Array.isArray(ms._cols))ms._cols=["_","_","_","_","_","_","_","_","_","_"]; while(ms._cols.length<10)ms._cols.push("_");   // an MWT's MISC is raw column 9 (0-indexed); create the raw row on demand so an edit round-trips byte-stably
          const proxy={get misc(){return ms._cols[9];}, set misc(v){ms._cols[9]=v;}};   // buildFeatEditor reads/writes t.misc → route it to the MWT's MISC column
          buildFeatEditor(td,sent,proxy,si,i,"misc");   // same Gmail-style pill editor as ordinary tokens
          const pin=td.querySelector(".pillfield"); if(pin)pin.dataset.ti="mwt"+i; }   // distinct data-ti → ↑/↓ row-nav between token rows never lands on the MWT row's pill cell
        mr.appendChild(td); });
      mr.style.cursor="pointer";
      mr.addEventListener("click",ev=>{ if(ev.target.tagName==="INPUT")return; setRange(si,ms.from,ms.to); pick(si,ms.from,false,false); });   // highlight the component tokens
      mr.addEventListener("contextmenu",ev=>{ if(ev.target.tagName==="INPUT")return; ev.preventDefault(); showCtx(ev.clientX,ev.clientY,[["Remove MWT","⌫",()=>{ sent.mwt=(sent.mwt||[]).filter(x=>x!==ms); preserveScroll(renderDoc); },true]]); });
      tb.appendChild(mr); }
    const tr=document.createElement("tr"); tr.dataset.s=si; tr.dataset.tok=i+1; if(i%2)tr.classList.add("striperow");   // zebra: every other token row (indexed by token, so MWT range rows don't skew the alternation)
    if(sel.s===si&&sel.t===i+1)tr.classList.add("sel");
    if(mwtComp.has(i+1)){ tr.classList.add("mwtgrp");   // component of an MWT → part of the square-bracket group
      const g=mwtOf[i+1]; if(g){ tr.dataset.mwtfrom=g.from; tr.dataset.mwtto=g.to;   // …and it names its group, so the whole group can light as one (applySel's .mwtsel pass)
        if(mwtGroupSel(si,g.from,g.to)) tr.classList.add("mwtsel"); } }
    if(mwtEnd.has(i+1))tr.classList.add("mwtgrp-last");   // last component → carries the bottom tick of the bracket
    if(selRange&&selRange.s===si&&i+1>=selRange.from&&i+1<=selRange.to)tr.classList.add("rangesel");
    const idTd=document.createElement("td"); idTd.className="col-id"; idTd.textContent=i+1; idTd.draggable=true; idTd.title="Drag to reorder · Shift-click to select a range";
    idTd.addEventListener("click",e=>{ if(e.shiftKey&&sel.s===si&&sel.t>0){ setRange(si,sel.t,i+1); preserveScroll(renderDoc); }   // extend a continuous range from the anchor
      else pick(si,i+1); });
    idTd.addEventListener("dragstart",e=>{ DRAG={si,from:i}; tr.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",String(i)); e.stopPropagation(); });
    idTd.addEventListener("dragend",()=>{ tr.classList.remove("dragging"); clearDZ(); });
    tr.appendChild(idTd);
    tr.draggable=true;   // drag from anywhere in the row to reorder it
    tr.addEventListener("dragstart",e=>{   // a FEATS/MISC pill chip owns its own pointer-driven drag (reorder the chips, not the row) — draggable=false on .fpill (mkPill) isn't reliably honoured by every engine when an ANCESTOR is draggable=true, so cancel the row's native dragstart outright whenever the gesture began inside the pill column, letting the chip's pointerdown/pointermove handlers (wirePill) see the gesture instead. NOTE: a native "dragstart" fired on `tr` (the draggable element itself) has e.target===tr, NOT whatever was under the cursor — closest(".pillcol") on e.target would never match a td that's a CHILD of tr. Use elementFromPoint at the event's own coordinates to find what's actually under the pointer where the drag began.
      const under=document.elementFromPoint(e.clientX,e.clientY);
      if(under&&under.closest(".pillcol")){ e.preventDefault(); return; }
      if(DRAG)return; DRAG={si,from:i}; tr.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",String(i)); });
    tr.addEventListener("dragend",()=>{ tr.classList.remove("dragging"); clearDZ(); });
    tr.addEventListener("contextmenu",e=>{ if(e.target.closest(".colresize"))return; e.preventDefault(); e.stopPropagation(); tokenMenu(e.clientX,e.clientY,si,i,e.target); });   // right-click ANY cell → the row menu
    AC(si).forEach(([key,cls,type])=>{
      const td=document.createElement("td"); if(cls)td.className=cls;
      if(type==="rotext"){ td.className=(cls?cls+" ":"")+"rocell"; td.textContent=t[key]||""; tr.appendChild(td); return; }   // transliteration: muted, non-editable
      if(key==="feats"||key==="misc"){ buildFeatEditor(td,sent,t,si,i,key); tr.appendChild(td); return; }   // FEATS/MISC → Key=Value pill chips (Gmail-style)
      let ctl;
      /* Task A/B — grid-cell edits reach the diagram (and the undo stack) ONLY ON COMMIT: blur, Enter, Tab-away,
         a <select>'s own "change", or accepting an autocomplete suggestion — never on every keystroke. Typing
         itself stays live (the browser already updates ctl.value; expand()/_edited below are purely local/
         visual), but the MODEL WRITE + re-render + any parser regen used to run on the raw "input"/"change"
         event directly — which is what made typing in a grid cell retype the DIAGRAM on every keystroke (Task
         A), and ran regenTok (a gloss/MGloss recompute among other things) on every keystroke of a deprel/head
         edit too (Task B: a structural edit must never touch MGloss/Gloss — see the deprel/head/upos split
         below). commitCell is now the ONE place that does the write, and every "accept this edit" gesture
         funnels into it exactly once: the plain blur handler, and the deprel/deep autocomplete's own Enter/Tab
         branch (below), which used to rely on acFill's dispatched "input" event reaching the old handler.
         `ctl` is captured by reference (assigned below, after this closure is created) — safe because
         commitCell is only ever CALLED once the assignment below has completed, never during it.
         Not idempotent by accident but BY DESIGN: it always re-reads ctl.value against the model's current
         value, so a second call for an already-committed value (blur firing right after an autocomplete pick
         already committed it, say) is simply a no-op. */
      const commitCell=()=>{
        const curVal=key==="deprel"?depBase(t.deprel):key==="deep"?depDeep(t.deprel):t[key];
        if(ctl.value===curVal) return;   // nothing actually changed since the field was focused/last committed → no snapshot, no write, no render
        touchColW(si,si+1);   // widen the column-width cache for this sentence — see the cache note above computeColW
        if(pendingSnap){ UNDO.push(pendingSnap); if(UNDO.length>80)UNDO.shift(); REDO.length=0; pendingSnap=null; updateUndoUI(); }   // one undo per cell-edit session
        const oldUpos=t.upos;
        if(key==="deprel"){ t.deprel=withDepBase(t.deprel,ctl.value); afterDeprelEdit(t,sent); }   // keep the "@deep" tail when the relation changes
        else if(key==="deep"){ t.deprel=withDepDeep(t.deprel,ctl.value); }                     // replace only the deep-feature tail
        else if(key==="upos"){ t.upos=ctl.value; syncXposMirror(t); clearSubjIfNotVA(t); uposSyncGloss(t,oldUpos); }   // item 1: a tag change away from VERB/AUX drops any now-meaningless Subj; Task B: retarget the closed-class gloss prefix IN PLACE, immediately — never a wholesale MGloss rebuild
        else { t[key]=ctl.value; if(key==="head")afterHeadEdit(t,sent); }   // keep head 0 ⟺ deprel "root"
        if((key==="deps"||key==="misc")&&t[key]==="")t[key]="_";   // empty Deps/Misc round-trips as "_"
        if(key==="form"){ scheduleDoc(); afterFormEdit(si,i+1,true); }
        else if(key==="lemma"){ commitLemmaEdit(si,i+1,t); }   // NO eager scheduleDoc: nothing on screen shows a lemma, and everything that changes BECAUSE of it (MSeg, and the MGloss slots that name it) has to wait on the same await afterLemmaEdit does — see commitLemmaEdit
        else if(key==="upos"){ scheduleDoc(); uposSyncTranslit(si,i+1); regenTok(si,i+1,{regloss:true}); }   // regloss: the same full MGloss refresh the diagram's POS menu asks for — the re-parse re-derives the FEATS for the chosen class, so the gloss must gain that class's categories and not only lose the old one's (mglossFillFromFeats, js/io/bridge.js).   // uposSyncTranslit: the romanisation/script glyph are tag-conditioned and a retag makes them stale — the same call the diagram's POS menu makes (js/editing/context-menu.js), and for the same reason it cannot be left to regenTok. Task B: ONLY upos still reparses (lemma/feats/deps) — head/deprel are purely structural and must not trigger any gloss-touching regen at all
        else if(key==="head"||key==="deprel"||key==="deep"){ scheduleDoc(); }   // re-render only — no regenTok
      };
      if(type==="upos"){ ctl=document.createElement("select"); ctl.className="csel";
        fillCatSelect(ctl, UPOS_CATS, SETTINGS.upos, t[key], "X");
      } else if(type==="deprel"){ ctl=document.createElement("input"); ctl.className="cin deprelin"; ctl.spellcheck=false; ctl.autocomplete="off"; ctl.value=depBase(t.deprel);   // free-text + autocomplete (was a strict <select>) — matches the Deep cell's UX so a nonstandard relation can be typed straight in, not just picked from the fixed taxonomy
        const ac=ctl;   // deprelAcOpen filters deprelVocab() (SETTINGS.deprel, +MORPH_DEPRELS for mSUD) and groups matches via deprelMenuGroups — same categorisation as the relation context menu / Help dialog
        ac.addEventListener("focus",()=>deprelAcOpen(ac));
        ac.addEventListener("input",()=>deprelAcOpen(ac));
        ac.addEventListener("blur",()=>{ acCloseSoon();   // deferred close, same reason as the Deep cell (see below)
          const v=ac.value.trim(); if(v&&v!=="_"&&!SETTINGS.deprel.includes(v)){ SETTINGS.deprel.push(v); SETTINGS.deprel.sort(); } });   // a genuinely NEW relation joins the persistent inventory once typing is done (on blur, not per-keystroke, so a half-typed value never lands in it) — same "add on commit" the old Help-dialog form did, just inline in the grid
        ac.addEventListener("keydown",ev=>{ if(!_acMenu||!_acMenu.classList.contains("show")||_acInput!==ac)return;
          if(ev.key==="ArrowDown"){ ev.preventDefault(); ev.stopImmediatePropagation(); acHi((_acIdx+1)%_acItems.length); }
          else if(ev.key==="ArrowUp"){ ev.preventDefault(); ev.stopImmediatePropagation(); acHi((_acIdx-1+_acItems.length)%_acItems.length); }
          else if((ev.key==="Enter"||ev.key==="Tab")&&_acIdx>=0){ ev.preventDefault(); ev.stopImmediatePropagation(); acFill(_acItems[_acIdx]); commitCell(); }   // Task A: accepting a suggestion IS an "accept this edit" gesture — commit now rather than waiting on acFill's dispatched "input" event, which no longer commits by itself
          else if(ev.key==="Escape"){ ev.preventDefault(); ev.stopImmediatePropagation(); acClose(); } });
      } else if(type==="head"){ ctl=document.createElement("select"); ctl.className="csel";
        const maxDig=String(sent.tokens.length).length, padHead=v=>String(v).padStart(maxDig," ");   // item 4: space-pad the token number (NBSP so it isn't collapsed) so the "·" separators line up down the column — display only, never persisted (the option's own value stays the plain number)
        ctl.appendChild(opt("0",padHead(0)+" · root",t[key]==="0"));
        sent.tokens.forEach((o,j)=>{ if(j===i)return; ctl.appendChild(opt(String(j+1),`${padHead(j+1)} · ${headText(o)}`,t[key]===String(j+1))); });
        if(!["0",...sent.tokens.map((_,j)=>String(j+1))].includes(t[key])) ctl.appendChild(opt(t[key],t[key]+" ⚠",true));
      } else if(type==="deep"){ ctl=document.createElement("input"); ctl.className="cin deepin"; ctl.spellcheck=false; ctl.autocomplete="off"; ctl.value=depDeep(t.deprel);   // deep features = the free-text part after "@"
        const ac=ctl;   // custom wide autocomplete (replaces the native <datalist>, whose dropdown truncated): filters this token's admissible deep features (deepVocabFor(t.deprel's base), constrained by DEEP_BY_REL) and completes on click/Enter
        const atPrefix=document.createElement("span"); atPrefix.className="deepat"; atPrefix.textContent="@"; atPrefix.setAttribute("aria-hidden","true");   // fixed "@" decoration: NOT part of ctl.value (so it can't be backspaced/select-all-deleted); the stored deep still goes through withDepDeep(t.deprel, ctl.value)
        const syncAt=()=>atPrefix.classList.toggle("on", ac.value.trim()!=="");   // invisible when empty/whitespace-only; visible as soon as there's non-whitespace text after it
        ac.addEventListener("input",syncAt); syncAt(); td.appendChild(atPrefix);
        ac.addEventListener("focus",()=>acOpen(ac));
        ac.addEventListener("input",()=>acOpen(ac));
        ac.addEventListener("blur",()=>acCloseSoon());   // deferred: a grid re-render blurs then refocuses this cell → acOpen cancels the close, so the dropdown stays put instead of flickering
        ac.addEventListener("keydown",ev=>{ if(!_acMenu||!_acMenu.classList.contains("show")||_acInput!==ac)return;   // dropdown closed → let the shared ↑/↓ row-nav handler run
          if(ev.key==="ArrowDown"){ ev.preventDefault(); ev.stopImmediatePropagation(); acHi((_acIdx+1)%_acItems.length); }
          else if(ev.key==="ArrowUp"){ ev.preventDefault(); ev.stopImmediatePropagation(); acHi((_acIdx-1+_acItems.length)%_acItems.length); }
          else if((ev.key==="Enter"||ev.key==="Tab")&&_acIdx>=0){ ev.preventDefault(); ev.stopImmediatePropagation(); acFill(_acItems[_acIdx]); commitCell(); }   // Task A: same as the deprel cell above — accepting the suggestion commits now
          else if(ev.key==="Escape"){ ev.preventDefault(); ev.stopImmediatePropagation(); acClose(); } }); }
      else { const blank=key==="deps"||key==="misc";   // show these empty rather than as "_"
        const val0=(blank&&(t[key]==null||t[key]==="_"))?"":(t[key]??"_");
        const cw=colW[key]||0, multiline=cw>0 && meas(val0, key==="form"?gridFormFont(t):GRID_F)+18 > cw+1;   // content overflows the column's assigned (capped/shrunk) width AND the column can't widen → wrap to several lines instead of clipping/scrolling one line
        if(multiline){ ctl=document.createElement("textarea"); ctl.className="cin cinwrap"; ctl.rows=1; ctl.wrap="soft"; ctl.spellcheck=false; ctl.value=val0;
          const grow=()=>{ ctl.style.height="auto"; ctl.style.height=ctl.scrollHeight+"px"; };   // auto-grow to fit the wrapped content
          ctl.addEventListener("input",()=>{ if(ctl.value.indexOf("\n")>=0){ const p=ctl.selectionStart; ctl.value=ctl.value.replace(/\n/g,""); try{ctl.setSelectionRange(Math.max(0,p-1),Math.max(0,p-1));}catch(_){} } grow(); });   // soft-wrap only: strip any pasted hard newline so the field stays a single byte-stable value
          requestAnimationFrame(grow); }
        else { ctl=document.createElement("input"); ctl.className="cin"; ctl.spellcheck=false; ctl.value=val0; } }
      if(key==="form") ctl.className+=formDeco(t,isGwHeadId(sent,i+1))+italDeco(t);   // items 2/3: the Form cell carries the same Foreign italics / Typo strikethrough the diagrams draw, so the marking is visible in the grid too. The goeswith-head flag is passed EXPLICITLY: formDeco's default test reads t._gw, which only the display transform sets, so in the grid it always answered "not a head" and struck a form whose Typo=Yes is about the stray space, not about that form
      ctl.dataset.si=si; ctl.dataset.ti=i; ctl.dataset.col=key; ctl.draggable=false;   // so a re-render can restore focus; draggable=false → dragging a cell reorders the row
      /* THE PICK IS RE-ENTRANCY-GUARDED, and that is not a nicety — without it the pair below is an
         unbounded synchronous recursion that hangs the app (RangeError: Maximum call stack size
         exceeded), reproducible by focusing any grid cell and then switching the notation to
         BRACKETS:
             this focus handler → pick() → (conv==="brackets") preserveScroll(renderDoc)
             → renderDoc rebuilds #doc → preserveScroll restores focus with nc.focus() on the NEW
             cell → focus fires synchronously → this focus handler → pick() → …
         Only brackets closes the loop, because it is the one notation whose pick() re-renders
         unconditionally (see pick's own comment in js/core/document.js) — every other notation
         toggles classes and returns.
         Skipping the nested pick costs nothing: the OUTER pick has already set sel/CURBLOCK to this
         very cell, so the inner one could only set them to the same values. The guard lives here
         rather than in pick() because pick() is legitimately re-entrant from other callers, and
         because this handler is the only edge that re-enters it. revealEl and the rest stay
         OUTSIDE the guard — the restored cell still has to be brought back into view. */
      ctl.addEventListener("focus",()=>{
        if(!_gridPicking){ _gridPicking=true; try{ pick(si,i+1,false,false); } finally { _gridPicking=false; } }
        revealEl(ctl); if(ctl.tagName!=="TEXTAREA")expand(ctl,td); pendingSnap=snapSent(si);});   // pick()'s own scroll is off here (a cell you can already see and clicked into shouldn't jump), but a NATIVE Tab out of another cell (the browser's own focus traversal, not any of our keydown handlers) can land focus on an off-screen one with no scroll of its own — scrollNearest no-ops when the cell's already visible, so this is safe for the plain-click case too, not just Tab's
      ctl.addEventListener("blur",()=>{collapse(ctl);
        // item 3: a lone "_" (with only whitespace around it) means "empty" — clear the field on blur. Skips the
        // SELECT cells and the deprel/deep cells (where "_" isn't an empty-marker). Empty then serialises as "_"
        // (io_conllu._blank), so the round-trip is byte-stable either way. Left exactly as its own write (rather
        // than folded into commitCell below) because it applies to EVERY plain-text key, not just the ones
        // commitCell's own if/elseif chain re-renders for — commitCell then sees ctl.value already equal to the
        // model's new value and no-ops, which is what makes running it right after this safe.
        if(ctl.tagName!=="SELECT" && key!=="deep" && key!=="deprel" && ctl.value.trim()==="_"){
          ctl.value=""; const empty=(key==="deps"||key==="misc")?"_":""; if(t[key]!==empty){ t[key]=empty; markDirty(); } scheduleDoc(); }
        commitCell(); pendingSnap=null;
        if(ctl._edited){ ctl._edited=false; if(key==="form"||key==="lemma") itransCell(ctl,t,key,si,i); }   // item 1: a Sanskrit form/lemma typed in ITRANS becomes the IAST this app stores — see itransCell
      });
      ctl.addEventListener(ctl.tagName==="SELECT"?"change":"input",e=>{
        ctl._edited=true;   // this cell was TYPED IN, not merely tabbed through — the blur-time ITRANS conversion above acts on nothing else
        if(ctl.tagName==="INPUT") expand(ctl,td);   // local/visual only — the field growing as you type costs nothing and touches no model state
        if(ctl.tagName==="SELECT") commitCell();   // a <select> only ever fires "change" on a genuine pick — that IS the commit gesture, no keystroke-by-keystroke phase to defer (and no IME composition to wait out either)
      });   // deep-feature edit → just re-render the diagram label
      ctl.addEventListener("keydown",e=>{   // spreadsheet-style: ↑/↓ move to the same column in the prev/next row (Alt+↓ still opens a dropdown; type-ahead still edits a select)
        if(e.key==="Enter"){ e.preventDefault(); ctl.blur(); return; }   // commit and hand focus back to the row (never inserts a hard newline in a soft-wrap textarea cell either)
        if((e.key==="ArrowDown"||e.key==="ArrowUp")&&!e.altKey){
          if(e.shiftKey){ e.preventDefault(); const nTok=DOC[si].tokens.length;   // Shift+↑/↓ → extend the row selection from this row
            if(!selRange||selRange.s!==si) setRange(si,i+1,i+1);
            const focus=Math.max(1,Math.min(nTok, selRange.focus+(e.key==="ArrowDown"?1:-1)));
            setRange(si,selRange.anchor,focus); sel={s:si,t:focus}; preserveScroll(renderDoc); return; }
          if(ctl.tagName==="TEXTAREA"){ const edge=taCaretEdge(ctl);   // multiline: step through the field's visual lines first; only cross rows from the first (↑) / last (↓) line
            if(e.key==="ArrowUp"?!edge.first:!edge.last) return; }
          const ni=i+(e.key==="ArrowDown"?1:-1);
          const nc=document.querySelector(`[data-si="${si}"][data-ti="${ni}"][data-col="${key}"]`);
          if(nc){ e.preventDefault(); nc.focus(); revealEl(nc);   // item 6: revealEl, not scrollNearest — the grid scrolls horizontally too (see its own note). focus() alone relies on the browser's OWN native scroll-into-view, which (unlike pick()'s scrollNearest) isn't reliable across engines for a nested-scroll target — see scrollNearest's own comment
            if(nc.tagName==="INPUT"){ try{nc.setSelectionRange(nc.value.length,nc.value.length);}catch(x){} }
            else if(nc.tagName==="TEXTAREA"){ const p=e.key==="ArrowDown"?0:nc.value.length; try{nc.setSelectionRange(p,p);}catch(x){} } } } });   // enter the neighbour on its first (↓) / last (↑) line
      /* A GRID CELL HAS NO DOUBLE-CLICK OF ITS OWN, deliberately: a dblclick listener here once opened
         the lemma editor, and it was wrong twice over. It cost the cell the browser's native
         "select the word under the pointer" — the one gesture a text field owes the user — and the
         lemma editor was never meant for the grid at all, which already shows the lemma in a column
         you can simply type in. Both diagram double-click routes to that editor have since gone the
         same way, for the second reason: the gesture was never announced anywhere. ⌘L (Edit Lemma)
         reaches it from the keyboard and the token context menu names it. Don't re-add it here. */
      /* item 7 — THE WHOLE CELL IS THE FIELD. A grid cell is padded, and its control does not fill it, so a click
         a few pixels off the text landed on the <td> and did nothing at all — the user had to aim at the glyphs.
         A click anywhere in the cell now puts the caret in the control, at the END for a text field (clicking
         the empty area past the text means "carry on typing here", not "select all"). Only when the click was
         NOT already on the control, so a click ON the text keeps the caret the browser placed at that point. */
      td.addEventListener("mousedown",e=>{ if(e.button!==0) return;
        if(e.target===ctl||ctl.contains(e.target)) return;               // the control handles its own hit
        if(e.target.closest&&e.target.closest(".fpill,.colresize")) return;   // pill chips and the column-resize grip own their gestures
        e.preventDefault();                                              // …so the <td> does not steal focus back off the control
        ctl.focus();
        // item 5: the caret lands at the point CLOSEST to the click, not at the end — clicking mid-cell means
        // "put me here". caretAtPoint (js/core/document.js) is the one implementation of that for both a form
        // control and a contenteditable; a <select> has no caret to place and simply keeps the focus.
        if(typeof caretAtPoint==="function") caretAtPoint(ctl,e.clientX,e.clientY); });
      td.appendChild(ctl);
      // MISC NewPar=Yes — a paragraph that starts mid-sentence, at this token. The grid shows it exactly where the
      // diagrams do (js/diagram/diagram-core.js svgNewParMark): a pilcrow hung off the Form cell's inline START,
      // absolutely positioned so it costs the column no width and the field keeps its own hit area.
      if(key==="form"&&isNewParTok(t)){ td.classList.add("has-seam");
        const p=document.createElement("span"); p.className="newpar-mark np-grid"; p.textContent=NEWPAR_MARK;
        p.title="Start of a new paragraph (Misc NewPar=Yes)"; td.appendChild(p); }
      tr.appendChild(td);
    });
    // item 6: the row-level contextmenu handler above (right after dragend) already opens the token menu for ANY
    // cell, inputs INCLUDED — so no second, input-skipping handler here (it would double-fire on non-input cells).
    tr.addEventListener("dragover",e=>{ if(!DRAG||DRAG.si!==si)return; e.preventDefault(); const r=tr.getBoundingClientRect(); const below=e.clientY>r.top+r.height/2; clearDZ(); tr.classList.add(below?"dz-bot":"dz-top"); });
    tr.addEventListener("drop",e=>{ if(!DRAG||DRAG.si!==si)return; e.preventDefault(); const r=tr.getBoundingClientRect(); const below=e.clientY>r.top+r.height/2, to=i+(below?1:0);
      if(DRAG.group) reorderTokenGroup(si,DRAG.group.gf,DRAG.group.gt,to); else reorderToken(si,DRAG.from,to); DRAG=null; });
    tb.appendChild(tr);
  });
  table.appendChild(tb); wrapEl.appendChild(table);
  const box=document.createElement("div"); box.className="gridbox"; box.appendChild(wrapEl);   // the outlined grid + the add-token button, which sits outside the frame
  const bleed=document.createElement("div"); bleed.className="gtiebleed";   // the MWT brackets' own window — see the drawGridTie block above; layoutGridTies sizes it and fills it once the grid is in the document
  bleed.appendChild(document.createElement("div")).className="gtieshift";
  box.appendChild(bleed);
  wrapEl.addEventListener("scroll",()=>syncTieScroll(wrapEl,bleed.firstElementChild),{passive:true});   // scrolling just re-translates the layer — no re-measure
  const add=document.createElement("button"); add.className="addtok"; add.innerHTML='<span class="sfi" style="--m:var(--sf-add)"></span>Add token';
  add.addEventListener("click",()=>insertToken(si,sent.tokens.length)); box.appendChild(add);
  box.addEventListener("click",e=>{ if(e.target===box) pick(si,0,false); });   // empty space beside Add token → clear the selection
  return box;
}
/* grid "Deep" cell autocomplete: ONE shared floating dropdown (like the ctx menu) that filters the cell's
   token's admissible deep features (deepVocabFor — DEEP_BY_REL taxonomy ∪ any @feature already used with that
   same relation in the doc; deepVocab() as a fallback if the token can't be resolved) as you type and completes
   the value on click / Enter. Sized to the longest option so nothing truncates; commit
   always flows through the cell's own "input" handler → withDepDeep, so the round-trip stays byte-stable. */
let _acMenu=null, _acItems=[], _acIdx=-1, _acInput=null, _acCloseT=null, _acOnPick=null, _acWiden=null;   // _acOnPick: custom completion callback (pill fields); null → default <input>.value behaviour (Deep cell). _acWiden: optional display-width source (value+gloss) so acPos widens for the gloss column
function acEl(){ if(_acMenu)return _acMenu; _acMenu=document.createElement("div"); _acMenu.className="acmenu";
  _acMenu.addEventListener("mousedown",e=>e.preventDefault());   // clicking a row must not blur the cell before its own mousedown fires
  // On scroll/resize keep the dropdown pinned UNDER its cell rather than tearing it down. A deep keystroke re-renders the
  // whole grid (scheduleDoc → renderDoc), which momentarily blurs+refocuses the cell AND restores scroll positions; the old
  // code's scroll/blur→acClose then re-open flickered the dropdown every keystroke. Now, while the cell is still focused
  // (including across that re-render), we just reposition; only once focus has truly left the cell do we close.
  const follow=()=>{ if(!_acMenu||!_acMenu.classList.contains("show"))return;
    if(_acInput&&_acInput.isConnected&&document.activeElement===_acInput) acPos(); else acCloseSoon(); };
  window.addEventListener("scroll",follow,true); window.addEventListener("resize",follow);
  document.body.appendChild(_acMenu); return _acMenu; }
function acClose(){ if(_acCloseT){clearTimeout(_acCloseT);_acCloseT=null;} if(_acMenu)_acMenu.classList.remove("show"); _acItems=[]; _acIdx=-1; _acInput=null; _acOnPick=null; _acWiden=null; }
function acCloseSoon(){ if(_acCloseT)return; _acCloseT=setTimeout(()=>{_acCloseT=null; acClose();},0); }   // deferred: a re-render blurs the cell then immediately refocuses it (→acOpen), which cancels this pending close
function acPos(){ if(!_acMenu||!_acInput)return; const r=_acInput.getBoundingClientRect(), wsrc=_acWiden||_acItems,
    maxw=Math.max(0,...wsrc.map(v=>meas(v,GRID_F)))+30;   // widen to the longest option (incl. any value gloss) so it never truncates
  _acMenu.style.left=r.left+"px"; _acMenu.style.top=(r.bottom+2)+"px"; _acMenu.style.minWidth=Math.max(r.width,maxw)+"px";
  _acMenu.style.visibility=elClippedOut(_acInput)?"hidden":""; }   // the anchor cell can scroll out of its own .gwrap (or the outer .doc) without losing focus — see makeEditable's place() for the same fix
function acHi(k){ _acIdx=k; if(!_acMenu)return; const rows=_acMenu.querySelectorAll(".acrow");   // index over SELECTABLE rows only → grouped-FEATS heading rows (no .acrow class) are skipped by keyboard nav
  rows.forEach((c,j)=>c.classList.toggle("hi",j===k)); if(k>=0&&rows[k])rows[k].scrollIntoView({block:"nearest"}); }
function acFill(v){ const inp=_acInput, cb=_acOnPick; acClose();   // a custom pick callback (pill fields) owns its own completion; otherwise set + fire input → the Deep cell commits via withDepDeep
  if(cb){ if(inp&&inp.focus)inp.focus(); cb(v); return; }
  if(!inp)return; inp.value=v; inp.dispatchEvent(new Event("input",{bubbles:true})); }
function acOpen(inp){ if(_acCloseT){clearTimeout(_acCloseT);_acCloseT=null;} _acOnPick=null;   // supersede any pending (re-render) close — this refresh keeps the SAME element alive; Deep cell uses the default fill path
  const tok=DOC[+inp.dataset.si]?.tokens[+inp.dataset.ti];   // constrain suggestions to what THIS token's relation admits (DEEP_BY_REL), rather than every deep feature in the taxonomy
  const q=inp.value.trim().toLowerCase(), vocab=tok?deepVocabFor(depBase(tok.deprel)):deepVocab();
  let ms = !q ? vocab.slice() : vocab.filter(v=>v.toLowerCase().startsWith(q));
  if(q && !ms.length) ms=vocab.filter(v=>v.toLowerCase().includes(q));   // fall back to substring matches
  ms=ms.filter(v=>v!==inp.value);   // nothing to complete to the value already typed
  if(!ms.length){acClose();return;}   // no deep-vocab matches → close rather than show an empty menu
  const rows=ms;
  _acInput=inp; _acItems=rows; _acIdx=-1; _acWiden=null;
  const m=acEl(); m.innerHTML="";   // refresh rows IN PLACE — the element persists and stays shown, so it never blanks/rebuilds-flickers as you type
  rows.forEach((v,k)=>{ const b=document.createElement("button"); b.type="button"; b.className="acrow"; b.textContent=v;
    b.addEventListener("mousedown",()=>acFill(v)); b.addEventListener("mouseenter",()=>acHi(k)); m.appendChild(b); });
  acPos(); m.classList.add("show"); }
/* grid "DepRel" cell autocomplete: replaces the old strict <select> with a free-text field (like the Deep cell)
   so a nonstandard relation can be typed directly. Matches against the SAME live vocabulary the old dropdown
   offered (deprelVocab — SETTINGS.deprel, plus MORPH_DEPRELS for mSUD docs), using the identical prefix-then-
   substring matching as the Deep cell's acOpen; the matched set is then partitioned into deprelMenuGroups'
   categories (dropping empty ones) so the dropdown reads with the SAME group headings as the relation context
   menu and Help dialog — a user-added relation shows up already correctly filed under its family, not a flat list. */
function deprelAcOpen(inp){ if(_acCloseT){clearTimeout(_acCloseT);_acCloseT=null;}
  const vocab=deprelVocab(), q=inp.value.trim().toLowerCase();
  let ms = !q ? vocab.slice() : vocab.filter(v=>v.toLowerCase().startsWith(q));
  if(q && !ms.length) ms=vocab.filter(v=>v.toLowerCase().includes(q));
  ms=ms.filter(v=>v!==inp.value);
  if(!ms.length){acClose();return;}
  const matchSet=new Set(ms), groups=[];
  deprelMenuGroups(vocab).forEach(([name,members])=>{ const items=members.filter(m=>matchSet.has(m));
    if(items.length) groups.push({title:name,items}); });
  acShowGrouped(inp,groups,null); }   // onPick=null → the default fill path (inp.value=v + input event), same as the Deep cell
function expand(ctl,td){ if(ctl.tagName==="INPUT"){ const need=meas(ctl.value, ctl.classList.contains("tok-ital")?GRID_ITAL_F:GRID_F)+20; if(need>td.offsetWidth){ctl.style.width=need+"px"; ctl.classList.add("editing");} else collapse(ctl); }   // a Foreign form's field renders italic → measure the expansion in that face
  else { const txt=ctl.options[ctl.selectedIndex]?.textContent||""; const need=meas(txt,GRID_F)+34; if(need>td.offsetWidth){ctl.style.width=need+"px"; ctl.classList.add("editing");} } }
function collapse(ctl){ ctl.classList.remove("editing"); ctl.style.width=""; }
/* caret line-position probes for line-aware ↑/↓ nav — move within a multiline field first, cross rows only from its top/bottom visual line */
function taCaretEdge(ta){ const cs=getComputedStyle(ta), div=document.createElement("div");   // mirror a textarea's wrapping in a hidden div to find the caret's visual line
  ["paddingTop","paddingRight","paddingBottom","paddingLeft","fontFamily","fontSize","fontWeight","fontStyle","fontVariant","letterSpacing","wordSpacing","textTransform","lineHeight","textIndent","direction","textAlign"].forEach(p=>div.style[p]=cs[p]);
  Object.assign(div.style,{position:"absolute",top:"-9999px",left:"-9999px",height:"auto",boxSizing:"border-box",borderWidth:"0",whiteSpace:"pre-wrap",overflowWrap:"break-word"});
  div.style.width=ta.clientWidth+"px"; div.style.wordBreak=cs.wordBreak;
  const pos=ta.selectionStart, v=ta.value;
  div.appendChild(document.createTextNode(v.slice(0,pos))); const mk=document.createElement("span"); mk.textContent="​"; div.appendChild(mk); div.appendChild(document.createTextNode(v.slice(pos)));
  document.body.appendChild(div); const mr=mk.getBoundingClientRect(), dr=div.getBoundingClientRect(); document.body.removeChild(div);
  const lh=parseFloat(cs.lineHeight)||16, pt=parseFloat(cs.paddingTop)||0, pb=parseFloat(cs.paddingBottom)||0;
  return { first:(mr.top-dr.top)<=pt+lh*0.6+1, last:(dr.bottom-mr.bottom)<=pb+lh*0.6+1 }; }
function ceCaretEdge(box){ const s=window.getSelection(); if(!s||!s.rangeCount) return {first:true,last:true};   // a contenteditable pill field: compare the caret rect to the field's top/bottom
  const rect=s.getRangeAt(0).getBoundingClientRect(); if(!rect||(!rect.height&&!rect.top&&!rect.bottom)) return {first:true,last:true};
  const b=box.getBoundingClientRect(), cs=getComputedStyle(box), lh=parseFloat(cs.lineHeight)||19, pt=parseFloat(cs.paddingTop)||0, pb=parseFloat(cs.paddingBottom)||0;
  return { first:(rect.top-b.top)<=pt+lh*0.6+1, last:(b.bottom-rect.bottom)<=pb+lh*0.6+1 }; }
/* — FEATS autocomplete inventory (item 12) — the COMPLETE, official feature/value set crawled from
   universaldependencies.org/u/feat (UD universal features) + guidelines.surfacesyntacticud.org (SUD),
   so the FEATS column only ever suggests canonical features and values. Features are grouped into UD's
   own categories (FEATS_CAT / FEATS_CATS) for a sorted dropdown; FEATS_VDESC holds each value's gloss;
   FEATS_GLOSS maps a Feat=Val to its Leipzig abbreviation for morphemic-gloss pre-population (item 12).
   ⚠ EACH FEATURE'S VALUES ARE IN THE CONVENTIONAL ORDER OF ITS OWN CATEGORY, NOT IN ALPHABETICAL ORDER,
   because this array IS the order every menu that offers a value prints it in — the FEATS-cell dropdown,
   featPillMenu, avmValueMenu, addFeatureItems and glossAbbrMenu, all of which read it through
   attestedFeatVals (below), which filters and so PRESERVES this order. Alphabetising a paradigm is what a
   list of strings does, not what a grammar does: masculine before feminine before neuter, singular before
   dual before plural, present before past before future, positive before comparative before superlative.
   Case follows the traditional (Sanskrit/Indo-European) sequence — nominative, accusative, instrumental,
   dative, ablative, genitive, locative, vocative — then the ergative pair, then the remaining non-core
   cases, then the local ones. Everything else is UD's own documentation-page order, which is already the
   linguistic one; only this file's transcription of it had been sorted. Nothing is dropped: a value not
   named in the conventional sequence keeps its old relative position at the end of its feature's list.
   ⚠️ Two claims elsewhere in the app depended on this and were FALSE until now — glossAbbrMenu's own note
   ("Sing before Plur, Nom before Acc", js/editing/context-menu.js) described an order the table did not
   have: Number ran Coll…Plur…Sing and Case ran Abs, Acc, Erg, Nom. */
const FEATS_CATS=["Lexical features","Nominal","Verbal","Other","SUD-specific"];
const UD_FEATS={"PronType":["Prs","Rcp","Art","Int","Rel","Exc","Dem","Emp","Tot","Neg","Ind"],"NumType":["Card","Ord","Mult","Frac","Sets","Dist","Range"],"Poss":["Yes"],"Gender":["Masc","Fem","Neut","Com"],"Animacy":["Anim","Hum","Nhum","Inan"],"NounClass":["Bantu1","Bantu2","Bantu3","Bantu4","Bantu5","Bantu6","Bantu7","Bantu8","Bantu9","Bantu10","Bantu11","Bantu12","Bantu13","Bantu14","Bantu15","Bantu16","Bantu17","Bantu18","Bantu19","Bantu20","Bantu21","Bantu22","Bantu23","Wol1","Wol2","Wol3","Wol4","Wol5","Wol6","Wol7","Wol8","Wol9","Wol10","Wol11","Wol12"],"Number":["Sing","Dual","Tri","Pauc","Plur","Grpa","Grpl","Inv","Coll","Count","Ptan"],"Case":["Nom","Acc","Ins","Dat","Abl","Gen","Loc","Voc","Erg","Abs","Par","Ben","Cau","Cmp","Cns","Com","Dis","Equ","Tem","Tra","Abe","Add","Ade","All","Del","Ela","Ess","Ill","Ine","Lat","Per","Sbe","Sbl","Spl","Sub","Sup","Ter"],"Definite":["Def","Ind","Spec","Cons","Com"],"VerbForm":["Fin","Inf","Sup","Part","Conv","Ger","Gdv","Vnoun"],"Mood":["Ind","Imp","Cnd","Pot","Sub","Jus","Prp","Qot","Opt","Des","Nec","Adm","Irr","Int"],"Tense":["Pres","Past","Fut","Imp","Pqp"],"Aspect":["Imp","Perf","Prosp","Prog","Hab","Iter"],"Voice":["Act","Mid","Pass","Antip","Rcp","Cau","Dir","Inv","Lfoc","Bfoc"],"Reflex":["Yes"],"Abbr":["Yes"],"Evident":["Fh","Nfh"],"Typo":["Yes"],"Deixis":["Prox","Med","Remt","Nvis","Abv","Bel","Even"],"Polarity":["Pos","Neg"],"Foreign":["Yes"],"DeixisRef":["1","2"],"Person":["1","2","3","4","0"],"ExtPos":["ADJ","ADP","ADV","AUX","CCONJ","DET","INTJ","PRON","PROPN","SCONJ"],"Degree":["Pos","Cmp","Sup","Abs","Equ","Aug","Dim"],"Polite":["Infm","Form","Elev","Humb"],"Clusivity":["In","Ex"],"Shared":["Yes","No"]};
const FEATS_CAT={"PronType":"Lexical features","NumType":"Lexical features","Poss":"Lexical features","Gender":"Nominal","Animacy":"Nominal","NounClass":"Nominal","Number":"Nominal","Case":"Nominal","Definite":"Nominal","VerbForm":"Verbal","Mood":"Verbal","Tense":"Verbal","Aspect":"Verbal","Voice":"Verbal","Reflex":"Other","Abbr":"Other","Evident":"Other","Typo":"Other","Deixis":"Other","Polarity":"Other","Foreign":"Other","DeixisRef":"Other","Person":"Other","ExtPos":"Other","Degree":"Other","Polite":"Other","Clusivity":"Other","Shared":"SUD-specific","Subject":"SUD-specific"};
const FEATS_VDESC={"PronType":{"Art":"article","Dem":"demonstrative","Emp":"emphatic","Exc":"exclamative","Ind":"indefinite","Int":"interrogative","Neg":"negative","Prs":"personal / possessive personal","Rcp":"reciprocal","Rel":"relative","Tot":"total / collective"},"NumType":{"Card":"cardinal","Dist":"distributive","Frac":"fraction","Mult":"multiplicative","Ord":"ordinal","Range":"range of values","Sets":"collective / sets"},"Poss":{"Yes":"possessive"},"Gender":{"Com":"common (non-neuter)","Fem":"feminine","Masc":"masculine","Neut":"neuter"},"Animacy":{"Anim":"animate","Hum":"human","Inan":"inanimate","Nhum":"non-human (animate)"},"NounClass":{"Bantu1":"Bantu class 1 (singular: persons)","Bantu2":"Bantu class 2 (plural: persons)","Bantu3":"Bantu class 3 (singular: plants, thin objects)","Bantu4":"Bantu class 4 (plural: plants, thin objects)","Bantu5":"Bantu class 5 (singular: fruits, round/paired objects)","Bantu6":"Bantu class 6 (plural: fruits, round/paired objects)","Bantu7":"Bantu class 7 (singular: things, diminutives)","Bantu8":"Bantu class 8 (plural: things, diminutives)","Bantu9":"Bantu class 9 (singular: animals, things)","Bantu10":"Bantu class 10 (plural: animals, things)","Bantu11":"Bantu class 11 (long thin objects, abstracts)","Bantu12":"Bantu class 12 (singular: small things, diminutives)","Bantu13":"Bantu class 13 (plural/mass: small amount)","Bantu14":"Bantu class 14 (plural: diminutives)","Bantu15":"Bantu class 15 (verbal nouns, infinitives)","Bantu16":"Bantu class 16 (definite location, close)","Bantu17":"Bantu class 17 (indefinite location, direction)","Bantu18":"Bantu class 18 (definite location, inside)","Bantu19":"Bantu class 19 (little bit of, pejorative plural)","Bantu20":"Bantu class 20 (singular: augmentatives)","Bantu21":"Bantu class 21 (singular: augmentatives, derogatives)","Bantu22":"Bantu class 22 (plural: augmentatives)","Bantu23":"Bantu class 23 (location with place names)","Wol1":"Wolof class 1 (singular human)","Wol2":"Wolof class 2 (plural human)","Wol3":"Wolof class 3 (singular)","Wol4":"Wolof class 4 (singular)","Wol5":"Wolof class 5 (singular)","Wol6":"Wolof class 6 (singular)","Wol7":"Wolof class 7 (singular)","Wol8":"Wolof class 8 (plural non-human)","Wol9":"Wolof class 9 (singular)","Wol10":"Wolof class 10 (singular)","Wol11":"Wolof class 11 (location)","Wol12":"Wolof class 12 (manner)"},"Number":{"Coll":"collective / mass / singulare tantum","Count":"count plural (with numerals)","Dual":"dual","Grpa":"greater paucal","Grpl":"greater plural","Inv":"inverse number","Pauc":"paucal","Plur":"plural","Ptan":"plurale tantum","Sing":"singular","Tri":"trial"},"Case":{"Abs":"absolutive","Acc":"accusative / oblique","Erg":"ergative","Nom":"nominative / direct","Abe":"abessive / caritive / privative","Ben":"benefactive / destinative","Cau":"causative / motivative / purposive","Cmp":"comparative","Cns":"considerative","Com":"comitative / associative","Dat":"dative","Dis":"distributive","Equ":"equative","Gen":"genitive","Ins":"instrumental / instructive","Par":"partitive","Tem":"temporal","Tra":"translative / factive","Voc":"vocative","Abl":"ablative / adelative","Add":"additive","Ade":"adessive","All":"allative / adlative","Del":"delative / superelative","Ela":"elative / inelative","Ess":"essive / prolative","Ill":"illative / inlative","Ine":"inessive","Lat":"lative / directional allative","Loc":"locative","Per":"perlative","Sbe":"subelative","Sbl":"sublative","Spl":"superlative (local)","Sub":"subessive","Sup":"superessive","Ter":"terminative / terminal allative"},"Definite":{"Com":"complex (improper annexation, Arabic)","Cons":"construct state / reduced definiteness","Def":"definite","Ind":"indefinite","Spec":"specific indefinite"},"VerbForm":{"Conv":"converb / transgressive / adverbial participle","Fin":"finite","Gdv":"gerundive","Ger":"gerund","Inf":"infinitive","Part":"participle / verbal adjective","Sup":"supine","Vnoun":"verbal noun / masdar"},"Mood":{"Adm":"admirative","Cnd":"conditional","Des":"desiderative","Imp":"imperative","Ind":"indicative","Int":"interrogative","Irr":"irrealis","Jus":"jussive","Nec":"necessitative","Opt":"optative","Pot":"potential","Prp":"purposive","Qot":"quotative","Sub":"subjunctive / conjunctive"},"Tense":{"Fut":"future","Imp":"imperfect","Past":"past","Pqp":"pluperfect","Pres":"present"},"Aspect":{"Hab":"habitual","Imp":"imperfect","Iter":"iterative / frequentative","Perf":"perfect","Prog":"progressive","Prosp":"prospective"},"Voice":{"Act":"active","Antip":"antipassive","Bfoc":"beneficiary-focus","Cau":"causative","Dir":"direct","Inv":"inverse","Lfoc":"location-focus","Mid":"middle","Pass":"passive","Rcp":"reciprocal"},"Reflex":{"Yes":"reflexive"},"Abbr":{"Yes":"it is an abbreviation"},"Evident":{"Fh":"firsthand","Nfh":"non-firsthand"},"Typo":{"Yes":"the token contains a typographic error (SUD also expects a companion CorrectForm feature)"},"Deixis":{"Abv":"above the reference point","Bel":"below the reference point","Even":"at the same level as the reference point","Med":"medial (neither close nor far)","Nvis":"remote, not visible","Prox":"proximate (close to reference point)","Remt":"remote (far from reference point)"},"Polarity":{"Neg":"negative","Pos":"positive / affirmative"},"Foreign":{"Yes":"foreign word"},"DeixisRef":{"1":"deixis relative to the first person (speaker)","2":"deixis relative to the second person (hearer)"},"Person":{"0":"zero (impersonal)","1":"first person","2":"second person","3":"third person","4":"fourth person / obviative"},"ExtPos":{"ADJ":"adjective-like expression","ADP":"adposition-like expression","ADV":"adverb-like expression","AUX":"auxiliary-like expression","CCONJ":"coordinating-conjunction-like expression","DET":"determiner-like expression","INTJ":"interjection-like expression","PRON":"pronoun-like expression","PROPN":"proper-noun-like expression","SCONJ":"subordinator-like expression"},"Degree":{"Abs":"absolute superlative / elative","Aug":"augmentative","Cmp":"comparative","Dim":"diminutive","Equ":"equative","Pos":"positive / first degree","Sup":"superlative"},"Polite":{"Elev":"referent-elevating","Form":"formal register","Humb":"speaker-humbling","Infm":"informal register"},"Clusivity":{"Ex":"exclusive (we = I + they, excluding addressee)","In":"inclusive (we = I + you)"},"Shared":{"Yes":"the dependent attaches to the coordination head and is shared across the conjuncts","No":"the dependent belongs to an individual conjunct only"},"Subject":{"SubjRaising":"subject-control raising (controller is the subject of the governor)","ObjRaising":"object-control raising (controller is the object of the governor)","OblRaising":"oblique-control raising (controller is an oblique of the governor)","Generic":"generic / non-specific unexpressed subject","Instantiated":"instantiated / specific unexpressed subject","NoRaising":"unspecified (deprecated; covers Generic or Instantiated)","Raising":"untyped raising \u2014 what a deprecated @x edge migrates to; prefer Subj/Obj/OblRaising"}};
const FEATS_GLOSS={"Case=Nom":"NOM","Case=Acc":"ACC","Case=Gen":"GEN","Case=Dat":"DAT","Case=Abl":"ABL","Case=Abs":"ABS","Case=Erg":"ERG","Case=Ins":"INS","Case=Loc":"LOC","Case=Voc":"VOC","Case=Com":"COM","Case=All":"ALL","Case=Ben":"BEN","Case=Dis":"DISTR","Number=Sing":"SG","Number=Plur":"PL","Number=Dual":"DU","Gender=Masc":"M","Gender=Fem":"F","Gender=Neut":"N","Person=1":"1","Person=2":"2","Person=3":"3","Clusivity=In":"INCL","Clusivity=Ex":"EXCL","Tense=Past":"PST","Tense=Pres":"PRS","Tense=Fut":"FUT","Aspect=Imp":"IPFV","Aspect=Perf":"PFV","Aspect=Prog":"PROG","Mood=Ind":"IND","Mood=Imp":"IMP","Mood=Cnd":"COND","Mood=Sub":"SBJV","Mood=Irr":"IRR","Mood=Prp":"PURP","Mood=Qot":"QUOT","Voice=Pass":"PASS","Voice=Antip":"ANTIP","Voice=Cau":"CAUS","Voice=Rcp":"RECP","Definite=Def":"DEF","Definite=Ind":"INDF","Polarity=Neg":"NEG","VerbForm=Inf":"INF","VerbForm=Part":"PTCP","VerbForm=Conv":"CVB","VerbForm=Vnoun":"NMLZ","PronType=Art":"ART","PronType=Dem":"DEM","PronType=Rel":"REL","PronType=Ind":"INDF","PronType=Neg":"NEG","PronType=Rcp":"RECP","NumType=Dist":"DISTR","Poss=Yes":"POSS","Reflex=Yes":"REFL","Deixis=Prox":"PROX","Deixis=Remt":"DIST","ExtPos=ADJ":"ADJ","ExtPos=ADV":"ADV","ExtPos=AUX":"AUX","ExtPos=DET":"DET"};   /* item 21: PRUNED BACK TO STANDARD LEIPZIG ONLY, on request — every entry here is now a Feat=Val pair whose
     abbreviation is verbatim from the Leipzig Glossing Rules' own "List of Standard Abbreviations"
     (eva.mpg.de/lingua/resources/glossing-rules.php), cross-checked mechanically against that list rather than
     by eye (a script filtered the table's ~200 entries against it, kept only the ~64 matches — same count this
     comment now claims, so a future edit that drifts from the list is easy to catch by re-running the same
     check). REMOVED: the whole "item 5" custom-coined layer this comment used to document — Hungarian-style
     local cases (SUPESS/SUPLAT/SUBL/SUBEL/CAU/CMP), Corbett's number typology (GPAUC/GPL/PTAN/CNT), Philippine
     focus terms (BFOC/LFOC), Semitic CSTR/CPLX, Romance/Arabic ELAT/POS, Japanese/Korean honorifics
     (HON/HBL/FORM/INFM), IMPF/INTERR/EXCLAM/AFF, CG, DX1/DX2, the Bantu/Wolof noun-class numbering, and every
     other value this table used to fill in from descriptive literature rather than the Leipzig list itself —
     all of it, not just the values named above. A Feat=Val with no entry here simply doesn't offer or draw a
     morphemic-gloss abbreviation any more (every reader of this table already treats a miss as "no gloss for
     that value", never an error — see attestedFeatVals/glossAbbrMenu's own `if(!a)return` guards) — going
     forward it is the AVM tier (isomorphic to FEATS directly, not to this table) that carries full coverage;
     MGloss stays a genuine Leipzig-style interlinear gloss and nothing wider.
     Shared=Yes/No and every Subject value is still deliberately absent: they are SUD-internal bookkeeping, not
     morphological categories a gloss line would ever carry (and Subject is not even in FEATS any more — see
     UD_MISC_KEYS below). So are Foreign=Yes and Typo=Yes, which get their own rendering (underline /
     strikethrough) instead of a gloss abbreviation.
     NOTE: a handful of entries still reuse one abbreviation across two Feat=Val pairs — DISTR: Case=Dis/
     NumType=Dist; RECP: Voice=Rcp/PronType=Rcp; INDF: Definite=Ind/PronType=Ind; NEG: Polarity=Neg/
     PronType=Neg — AMBIG_UPOS (js/io/bridge.js) resolves each from the token's own UPOS wherever the two
     candidates' realistic UPOS ranges don't overlap. The EQU (Case=Equ/Degree=Equ) and INV (Number=Inv/
     Voice=Inv) pairs this note used to list are gone along with the entries themselves — see AMBIG_UPOS's own
     note for the matching removal there. */
const UD_MISC_KEYS=["SpaceAfter","SpacesAfter","SpacesBefore","Translit","LTranslit","Gloss","MSeg","MGloss","Lang","CorrectForm","CorrectSpaceAfter","Entity","NER","Cxn","Idiom","InIdiom","Reported","Subject","ToDo"];   /* Subject/Object MOVED HERE FROM UD_FEATS: they are SUD raising annotation, not morphology, and belong in MISC (see raiseGet/raiseSet, js/core/prefs.js, which is where that decision is recorded). They were the only two SUD-specific entries in the UD feature inventory above. */   // item 7: Reported joins the offered keys so the MISC cell autocompletes it like any other. Idiom/InIdiom joined them when the SUD parsers began PREDICTING the whole SUD MISC layer (app/parse.py's _SUD_MISC_KEYS): SUD marks an idiom with features rather than a `fixed` relation — the head takes Idiom=Yes alongside its ExtPos, every other member InIdiom=Yes, and the unanalysable members attach by `unk`
const UD_MISC_VALS={SpaceAfter:["No"],CorrectSpaceAfter:["Yes","No"],Reported:["Yes"],Idiom:["Yes"],InIdiom:["Yes"],
  Subject:["SubjRaising","ObjRaising","OblRaising","Generic","Instantiated","NoRaising"]};   // most MISC keys are free-text → doc-mined values carry the rest
function docPairKeys(col){ const set=new Set(); try{ DOC.forEach(s=>s.tokens.forEach(t=>{ const raw=t[col]; if(!raw||raw==="_")return;
    raw.split("|").forEach(seg=>{ const eq=seg.indexOf("="); if(eq>0)set.add(seg.slice(0,eq)); }); })); }catch(_){} return set; }   // attribute names already used anywhere in the doc
function docPairVals(col,keyName){ const set=new Set(); try{ DOC.forEach(s=>s.tokens.forEach(t=>{ const raw=t[col]; if(!raw||raw==="_")return;
    raw.split("|").forEach(seg=>{ const eq=seg.indexOf("="); if(eq>0&&seg.slice(0,eq)===keyName)set.add(seg.slice(eq+1)); }); })); }catch(_){} return set; }   // values already paired with this key in the doc
function acKeyItems(col){ const base=col==="feats"?Object.keys(UD_FEATS):UD_MISC_KEYS.slice();
  const out=base.slice(); docPairKeys(col).forEach(k=>{ if(!out.includes(k))out.push(k); }); return out; }   // UD inventory first, then any doc-only keys
// UD_FEATS[feat] narrowed to what's actually ATTESTED — either already used somewhere in this
// document (docPairVals above), or in the ACTIVE model's own emitted-label inventory
// (MODEL_FEATS_INVENTORY, js/io/bridge.js, refreshed on every model change — see app/parse.py's
// model_feats_inventory for what it reads and why it's per-model rather than this UD-wide table).
// The two menus this feeds — featPillMenu below and glossAbbrMenu, js/editing/context-menu.js —
// used to offer the FULL UD list for a known feature regardless of relevance (Ergative on an English
// document, say); this is the "only show attested values, and ideally what the model can emit" ask.
// Falls back to the full list whenever nothing is attested yet (a brand-new/empty document, or no
// model loaded and no prior use of this feature) — an empty menu would be worse than an unfiltered
// one, and this only ever NARROWS, never invents a value neither UD nor the model recognises.
function attestedFeatVals(feat){ const full=UD_FEATS[feat]||[]; if(!full.length) return full;
  const attested=new Set(docPairVals("feats",feat)); (MODEL_FEATS_INVENTORY[feat]||[]).forEach(v=>attested.add(v));
  if(!attested.size) return full;
  const out=full.filter(v=>attested.has(v));
  return out.length?out:full; }
/* ── item 22/23: the AVM tier — an HPSG-style attribute-value matrix of a token's FEATS, isomorphic to it (a
   VIEW, not a second store: every row reads straight off t.feats and every edit writes straight back — see
   avmSetFeat below). Two conventional groupings, named the way the request itself named them:
     AGR (the HPSG "index"/agreement bundle — a nominal's own referential φ-features, or a verb's agreement
     target; the same four whichever role the token plays, which is the HPSG point of having one bundle at
     all): Person, Number, Gender, Clusivity (the inclusive/exclusive split IS a person distinction, so it
     belongs beside Person, not standing alone).
     TAM (Tense-Aspect-Mood, the standard typological bundle for a predicate's temporal/modal marking):
     Tense, Aspect, Mood, Evident (evidentiality is conventionally discussed alongside mood/modality in the
     TAM literature, not filed as a fourth unrelated category).
   Voice and Case are deliberately NOT folded into either group — Voice is argument-structure/diathesis, not
   TAM proper, and Case is a HEAD feature in most frameworks' own AVMs, not agreement.
   item 23: each group is now ONE row with a COMBINED value (Person.Number.Gender.Clusivity, dot-joined in that
   fixed order, whichever of the four are actually set) — the same "several categories, one fused cell" shape
   Leipzig-style interlinear glosses already use throughout this app (mglossReslot/setGlossText's own dot-joins),
   not a nested sub-bracket per feature. */
const AVM_GROUPS={AGR:["Person","Number","Gender","Clusivity"], TAM:["Tense","Aspect","Mood","Evident"]};
// item 23: NumType/PronType/VerbForm move to the POS tag's own dot-suffix instead (UPOS_SUBTYPE_FEATS,
// js/editing/context-menu.js, which posDisp — diagram-core.js — already reads to grow e.g. "PRON.DEM"/
// "VERB.INF" on the tag itself) — never shown here, so a reader isn't told the same fact in two places.
// item 25/2: ExtPos and Shared are excluded for the SAME reason, on request — each already has its OWN
// notation elsewhere in the diagram rather than needing a second one here: ExtPos draws as the bracket's
// own label wherever an MWT/ExtPos tie exists (mwtTie/positionBracketAnnots — "an ExtPos-only bracket:
// the value itself IS the label"), and Shared drives the ghost-arc mechanism (drawBump/drawCrossLine's
// ghost branch — "Shared=Yes ghosts show the dependent's own deprel"). The AVM is meant to carry
// morphological content the diagram states NOWHERE else; these two are syntactic/discourse facts that
// already have a dedicated mark, so listing them again here would be the same "told twice" problem
// NumType/PronType/VerbForm were excluded for, just via a different second notation instead of the POS tag.
// item 25/3: Foreign and Typo, same reasoning again — Foreign already renders the form itself in italics
// (isForeign/italDeco/frnUp, diagram-core.js — the token's OWN glyph carries the mark), and Typo already
// draws a strikethrough over the form (svgMarks). Reported is listed too, on request, though it's inert
// here by construction: isReported reads t.misc, never t.feats (miscKV(t.misc,"Reported")), and avmStruct
// only ever looks at t.feats — Reported was never going to reach an AVM row regardless of this Set, but
// naming it keeps this list matching the mark-already-exists reasoning it's part of, in full.
const AVM_EXCLUDE=new Set(["NumType","PronType","Poss","VerbForm","ExtPos","Shared","Foreign","Typo","Reported"]);   // Poss joins NumType/PronType on report — same "Lexical features" category (FEATS_CAT), already folded into the POS tag itself, so an AVM row for it is a second, redundant place the same fact is shown
/* The token's FEATS as an ordered, FLAT AVM row list — no nesting any more (item 23): [{group:"AGR",
   members:[...set ones...], combined:"3.Sing.Fem", vals:[{feat:"Person",val:"3"},{feat:"Number",val:"Sing"},
   {feat:"Gender",val:"Fem"}]}, {group:"TAM",...} (either omitted outright if the token sets NONE of that
   group's features — an empty bracket is worse than no bracket), then every remaining set, non-excluded
   feature as {feat,val}, in UD_FEATS' own declared order]. Attribute names and values are UD's OWN spellings
   verbatim (Person, not PERS; Sing, not SG) — on request, this tier stays isomorphic to FEATS, not a second
   Leipzig-style gloss; FEATS_GLOSS/MGloss is the tier that abbreviates.
   `vals` (per-member {feat,val} pairs, same order as `members`/`combined`'s own dot-join) is item 2's own
   addition — a per-value right-click needs to know which UD feature EACH piece of "3.Sing.Fem" names, not just
   the group's, and only avmStruct has `set` in scope to answer that; `combined` stays exactly as it was (every
   pre-existing reader of it — avmLayout's WIDTH measurement in particular — is unaffected) rather than being
   derived FROM `vals` at the two render sites, which would be the same fact stated twice. */
function avmStruct(t){ const feats=(t&&t.feats)||""; if(!feats||feats==="_") return [];
  const set={}; feats.split("|").forEach(seg=>{ const eq=seg.indexOf("="); if(eq>0) set[seg.slice(0,eq)]=seg.slice(eq+1); });
  const used=new Set(), out=[];
  for(const g of ["AGR","TAM"]){ const members=AVM_GROUPS[g].filter(f=>set[f]!=null);
    if(members.length){ members.forEach(f=>used.add(f)); out.push({group:g, members, combined:members.map(f=>set[f]).join("."), vals:members.map(f=>({feat:f,val:set[f]}))}); } }
  Object.keys(UD_FEATS).forEach(f=>{ if(set[f]!=null&&!used.has(f)&&!AVM_EXCLUDE.has(f)) out.push({feat:f,val:set[f]}); });
  return out; }
// item 22: an AVM row's right-click edit — same mechanism glossAbbrMenu/acValItems already use (attested-value-
// narrowed UD_FEATS list, UD's canonical order), but writing UD Feat=Val straight to FEATS instead of a Leipzig
// abbreviation into MGloss: this tier IS FEATS, so an edit here is exactly the FEATS-column edit a hand-typed
// one would be, sharing its single undo entry the same way.
function avmSetFeat(si,tokId,feat,val){ const s=DOC[si]; if(!s)return; const t=s.tokens[tokId-1]; if(!t)return;
  const next=val?setFeat(t.feats,feat,val):clearFeat(t.feats,feat);
  if(next===t.feats) return;
  pushUndo(si); t.feats=next;
  if(typeof syncXposMirror==="function") syncXposMirror(t);
  markDirty(); preserveScroll(renderDoc); }
function acValItems(col,keyName){ if(col==="feats"&&UD_FEATS[keyName]) return attestedFeatVals(keyName);   // item 12: a KNOWN feature → LIMIT to the official inventory, narrowed further to what's attested (see attestedFeatVals) — never append EXTRA doc-mined values beyond that inventory
  const inv=col==="feats"?[]:(UD_MISC_VALS[keyName]||[]);   // unknown FEATS key → no inventory; MISC → its small inventory
  const out=inv.slice(); docPairVals(col,keyName).forEach(v=>{ if(!out.includes(v))out.push(v); }); return out; }   // then doc-only values (the fallback for an unknown feature / free-text MISC key)
/* Reuse the shared floating dropdown (_acMenu / acEl / acPos / acHi / acFill) for a caller-owned completion:
   the pill field supplies its own item list + pick callback so the Deep cell's styling & keyboard-nav are shared. */
function acShowCustom(inp,items,onPick,descFn){ _acInput=inp; _acItems=items; _acIdx=-1; _acOnPick=onPick;
  _acWiden=descFn?items.map(v=>{ const d=descFn(v); return d?v+"   "+d:v; }):null;   // item 12: when rows carry a gloss column, widen acPos to fit "value   gloss"
  const m=acEl(); m.innerHTML="";
  items.forEach((v,k)=>{ const b=document.createElement("button"); b.type="button"; b.className="acrow";
    const d=descFn&&descFn(v);
    if(d){ b.classList.add("has-exp"); const l=document.createElement("span"); l.className="aclbl"; l.textContent=v;   // item 12: value + dimmed right-aligned gloss (acFill still uses the pure value)
      const e=document.createElement("span"); e.className="acexp"; e.textContent=d; b.append(l,e); }
    else b.textContent=v;
    b.addEventListener("mousedown",()=>acFill(v)); b.addEventListener("mouseenter",()=>acHi(k)); m.appendChild(b); });
  acPos(); m.classList.add("show"); }
/* item 12: grouped variant — emits a non-selectable .ac-grouph heading before each group's rows. groups=[{title,items:[…]}].
   _acItems stays the FLAT sequence of selectable values (heading DIVs carry no .acrow class), so acHi / _acIdx / arrow-nav
   step over the headings automatically. descFn (item 14, optional): same "value + dimmed right-aligned gloss" row
   acShowCustom draws (.has-exp/.aclbl/.acexp) — lets a grouped list (the MGloss abbreviation dropdown, grouped by
   grammatical category via bridge.js's mglossAcGroups) ALSO carry each row's expansion, without a third near-duplicate
   popup-building function. */
function acShowGrouped(inp,groups,onPick,descFn){ _acInput=inp; _acIdx=-1; _acOnPick=onPick;
  const flat=[]; groups.forEach(g=>g.items.forEach(v=>flat.push(v))); _acItems=flat;   // flat selectable order = visual order
  _acWiden=descFn?flat.map(v=>{ const d=descFn(v); return d?v+"   "+d:v; }):null;   // item 12: widen acPos to fit "value   gloss" when rows carry one
  const m=acEl(); m.innerHTML=""; let idx=0;
  groups.forEach(g=>{ const h=document.createElement("div"); h.className="ac-grouph"; h.textContent=g.title; m.appendChild(h);
    g.items.forEach(v=>{ const k=idx++; const b=document.createElement("button"); b.type="button"; b.className="acrow";
      const d=descFn&&descFn(v);
      if(d){ b.classList.add("has-exp"); const l=document.createElement("span"); l.className="aclbl"; l.textContent=v;
        const e=document.createElement("span"); e.className="acexp"; e.textContent=d; b.append(l,e); }
      else b.textContent=v;
      b.addEventListener("mousedown",()=>acFill(v)); b.addEventListener("mouseenter",()=>acHi(k)); m.appendChild(b); }); });
  acPos(); m.classList.add("show"); }

/* ⚠ A CONTENTEDITABLE HAS NO selectionStart, AND THAT IS WHY MINTING A CHIP THREW THE CARET TO THE
   START OF THE CELL. Committing a segment (`|`, comma, space, Enter, or an accepted autocomplete
   row followed by any of them) calls serialize(), which writes t.feats/t.misc and re-renders — and
   preserveScroll (js/ui/wiring.js) puts the focus back with a bare `nc.focus()`, then restores the
   caret with setSelectionRange, which exists on INPUT/TEXTAREA and on nothing else. Focusing a
   contenteditable DIV collapses the caret to its first position, so every chip the reader minted
   mid-field dumped them back at the head of the cell to type the next one.
   The caret cannot be carried as a character offset either: the field is a mixed run of atomic
   `.fpill` chips and zero-width anchors, and the chips are rebuilt from the model. What survives a
   rebuild is the CHIP COUNT before the caret plus the offset within the text run it sits in — both
   facts about the serialised value, which is exactly what the re-render reproduces. Any un-minted
   text is carried too, on the same terms as preserveScroll's `fd.val` for a plain cell: the model
   does not hold it yet, so a render underneath a half-typed segment would otherwise eat it. */
const PILL_ZW="​";
function pillCaretGet(box){ try{
    const s=window.getSelection(); if(!s||!s.rangeCount) return null;
    const r=s.getRangeAt(0); if(!box.contains(r.startContainer)) return null;
    let chips=0;
    box.querySelectorAll(".fpill").forEach(p=>{ const rr=document.createRange(); rr.selectNode(p);
      if(rr.compareBoundaryPoints(Range.START_TO_START,r)<0) chips++; });   // chips whose own start precedes the caret — a count, so it survives the rebuild that replaces every one of them
    const nd=r.startContainer;
    if(nd.nodeType!==3) return {chips,off:0,txt:""};   // caret between two chips (an element-level position) → the chip count alone places it
    const before=nd.data.slice(0,r.startOffset).split(PILL_ZW).join("");
    return {chips, off:before.length, txt:nd.data.split(PILL_ZW).join("")};
  }catch(e){ return null; } }
function pillCaretSet(box,c){ try{
    if(!c) return;
    const pills=[...box.querySelectorAll(".fpill")];
    let node=null;
    if(c.chips>0){ const p=pills[Math.min(c.chips,pills.length)-1]; if(p&&p.nextSibling&&p.nextSibling.nodeType===3) node=p.nextSibling; }
    if(!node) node=[...box.childNodes].find(n=>n.nodeType===3)||null;
    if(!node) return;
    if(c.txt && node.data.split(PILL_ZW).join("")!==c.txt) node.data=PILL_ZW+c.txt;   // the pending segment the model does not hold — put it back BEFORE indexing into it, or the offset below counts a string the reader never saw
    let dom=node.data.length, seen=0;   // character offset → DOM offset, the zero-width anchors passed over as the skeleton they are
    for(let i=0;i<node.data.length;i++){ if(node.data[i]===PILL_ZW) continue; if(seen===c.off){ dom=i; break; } seen++; }
    const r=document.createRange(); r.setStart(node,dom); r.collapse(true);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }catch(e){} }
/* FEATS / MISC pill editor: ONE editable, wrapping `contenteditable` field that holds the `Key=Value` chips
   INLINE with the text caret (Gmail "To"-style) and serialises them back to the token's `|`-joined field on
   every mutation, using the same undo/round-trip path as a `.cin` cell. New chips are minted on the fly, at
   the caret, as the user types a segment and hits a delimiter (| , Enter, Tab, comma or space); Backspace at
   the start of a segment (caret just after a chip) pops that preceding chip. */
function buildFeatEditor(td,sent,t,si,i,key){
  td.classList.add("pillcol");
  const box=document.createElement("div"); box.className="pillfield"; box.contentEditable="true"; box.spellcheck=false;
  box.dataset.si=si; box.dataset.ti=i; box.dataset.col=key;   // data-* so ↑/↓ row-nav finds this cell like any other (a contenteditable DIV is focusable)
  box.title=(key==="feats"?"Morphological features":"Misc features")+" — type Key=Value then | (or Enter/Tab/comma/space)";
  const ZW="​", stripZW=s=>s.replace(/​/g,"");   // chips are contentEditable=false atoms → keep a zero-width text node as an editable caret anchor around/between them (never leaks: serialize() reads only .fpill, and mkPill strips ZW)
  const isZWNode=n=>!!n&&n.nodeType===3&&n.data.length>0&&stripZW(n.data)==="";   // a bare caret-anchor text node (only zero-widths) → skeleton, not content: skip it when navigating, never delete it as a char
  const anchors=()=>{ if(box.querySelector("input.pilledit")) return;   // don't reshuffle text nodes while a .pilledit input is live
    const pills=[...box.querySelectorAll(".fpill")];
    if(!pills.length){ if(![...box.childNodes].some(n=>n.nodeType===3)) box.appendChild(document.createTextNode(ZW)); return; }   // empty / chips-only → one anchor so the field shows & accepts a caret
    pills.forEach(p=>{ if(!p.previousSibling||p.previousSibling.nodeType!==3) box.insertBefore(document.createTextNode(ZW),p);   // ensure a caret position before…
      if(!p.nextSibling||p.nextSibling.nodeType!==3) box.insertBefore(document.createTextNode(ZW),p.nextSibling); }); };   // …and after every chip, so clicking between two chips lands an editable caret
  const serialize=()=>{ let next=[...box.querySelectorAll(".fpill")].map(p=>p.dataset.val).join("|");   // chips in VISUAL (DOM) order → byte-stable Key=Value|Key=Value
    if(key==="misc"&&next==="") next="_";   // empty MISC round-trips as "_" (as before); empty FEATS stays "" (matches the plain-input path)
    const cur=t[key];
    if(pendingSnap&&next!==cur){ UNDO.push(pendingSnap); if(UNDO.length>80)UNDO.shift(); REDO.length=0; pendingSnap=null; updateUndoUI(); }   // one undo per cell-edit session
    t[key]=next;
    if(next!==cur){ box._edited=true; touchColW(si,si+1); }   // widen the column-width cache for this sentence — see the cache note above computeColW   // a REAL change, not just a re-serialisation — gates the MSeg ITRANS conversion on blur (see msegFix), for the same reason the plain cells gate theirs on ctl._edited
    if(key==="feats"&&next!==cur){ featsSyncGloss(t,cur);   // the OTHER half of the bidirectional MGloss↔FEATS sync — retarget an existing gloss abbreviation to match the FEATS value that just changed (a no-op when no morphemic tier is on)
      syncXposMirror(t);
      markDirty(); preserveScroll(renderDoc); }   // ANY feats change re-renders — not just ones that happened to touch the gloss sync — so Shared=Yes/Subj=… edits made here show up in the diagram (ghost edges, "shared" pill, …) immediately, not just on the next unrelated render
    else if(key==="misc"&&next!==cur){   // item 4: a MISC change (SpaceAfter → punctuation merge/spacing, CorrectForm, Reported, …) affects the diagram, so re-render at once
      // on report (grid/diagram parity audit): every diagram-side MGloss edit calls mglossSyncFeats+syncXposMirror
      // (context-menu.js), and every diagram-side Translit edit's OWN row is kept live by fillTranslit() being
      // called from ~15 other edit/reload hooks — but this MISC-pill commit, the grid's own MGloss/Translit edit
      // path, called neither. A grid MGloss edit therefore silently stopped back-deriving FEATS from the typed
      // Leipzig abbreviations (correct in the diagram, wrong here), and a grid Translit edit correctly updated
      // the saved value but left the diagram's cached, on-screen romanisation stale until an UNRELATED edit
      // happened to trigger fillTranslit(). Scoped to the SPECIFIC key that changed (miscKV before/after), not
      // fired on every unrelated MISC pill edit — matching the diagram's own precision.
      if(miscKV(next,"MGloss")!==miscKV(cur,"MGloss")){ mglossSyncFeats(t); syncXposMirror(t); }
      if(miscKV(next,"Translit")!==miscKV(cur,"Translit") && show.translit) fillTranslit();   // gated on show.translit, matching every other fillTranslit() call site in the codebase — no point refreshing a hidden row
      markDirty(); preserveScroll(renderDoc); } };
  // — pill interaction (click=edit immediately · drag=reorder · right-click a FEATS key/value=alternatives menu) —
  // A plain click USED to only select the chip (outline + cursor:grab), requiring a second, undiscoverable
  // dbl-click to actually open it for editing — editPill (below) was reachable from nowhere else. Selection
  // bought nothing on its own: Backspace/Delete already act on the chip ADJACENT to the caret (see the box's own
  // keydown handler, below), never on `.sel`, and dragging re-selects the pill itself the instant a real drag
  // starts (onMove's own `selectPill(pill)`) — so `.sel` from a plain click was pure decoration nothing else in
  // this file ever read. editPill is the same input-swap a dbl-click always opened; a click now takes that
  // shortest path instead of a redundant "select, then a second gesture to actually edit" step. The dblclick
  // listener stays (harmless — the pill is already gone, replaced by the .pilledit input, by the time a second
  // click could register one).
  const arm=()=>{ if(!box._armed){ box._armed=true; pendingSnap=snapSent(si); } };   // pills aren't focusable → arm the undo snapshot ourselves before a mouse-driven mutation
  const clearSel=()=>box.querySelectorAll(".fpill.sel").forEach(p=>p.classList.remove("sel"));
  const selectPill=p=>{ clearSel(); p.classList.add("sel"); };
  const setCaret=(node,off)=>{ const r=document.createRange(); r.setStart(node,off); r.collapse(true);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); };
  let marker=null;
  // group candidate pills (drop target excluded) into visual ROWS — consecutive-in-DOM-order runs whose vertical
  // bands overlap. DOM order already walks the wrapped inline flow left-to-right/top-to-bottom (mirrored in RTL,
  // but still DOM-order top-to-bottom), so a new row starts wherever a pill's band stops overlapping the row
  // being built.
  const pillRows=drag=>{ const cands=[...box.querySelectorAll(".fpill")].filter(p=>p!==drag).map(p=>({p,r:p.getBoundingClientRect()}));
    const rows=[]; let cur=[];
    cands.forEach(c=>{ if(cur.length){ const last=cur[cur.length-1].r;
        if(!(c.r.top<last.bottom && c.r.bottom>last.top)){ rows.push(cur); cur=[]; } }
      cur.push(c); });
    if(cur.length) rows.push(cur);
    return rows; };
  const placeMarker=(x,y,drag)=>{ if(!marker){ marker=document.createElement("span"); marker.className="pdrop"; marker.contentEditable="false"; }
    const rows=pillRows(drag);
    let ref=null;   // default: drop at the very end
    if(rows.length){
      let bestRow=0,bestD=Infinity;   // the row whose vertical band the pointer is in (0 if genuinely inside it), or nearest by edge distance if it's sitting in the gap between two rows — so a drop anywhere between a row and its neighbour resolves to whichever is closer, not just "the row above"
      rows.forEach((row,ri)=>{ const top=Math.min(...row.map(c=>c.r.top)), bot=Math.max(...row.map(c=>c.r.bottom));
        const d=y<top?top-y:(y>bot?y-bot:0); if(d<bestD){ bestD=d; bestRow=ri; } });
      const rtl=getComputedStyle(box).direction==="rtl";
      const before=r=>rtl?x>r.left+r.width/2:x<r.left+r.width/2;   // "insert before this pill" in the READING direction, not raw physical left/right — a drop mirrors correctly under RTL
      const hit=rows[bestRow].find(c=>before(c.r));
      // past every pill on the nearest row (i.e. dropped at/after its reading-end) → the same insertion point as
      // "before the NEXT row's first pill" — so a pill can be dropped between two wrapped lines from EITHER side
      // (right of the last pill on one line, or left of the first pill on the next) and land in the same place
      ref = hit ? hit.p : (rows[bestRow+1] ? rows[bestRow+1][0].p : null);
    }
    if(marker.parentNode!==box || marker.nextSibling!==ref) box.insertBefore(marker,ref); };   // marker.parentNode!==box catches the marker's FIRST placement of a drag: before it's ever been inserted, marker.nextSibling is trivially null, which coincidentally equals ref whenever the very first computed drop point is "insert at the end" (ref=null, e.g. dragging the one early pill toward the last slot) — a bare nextSibling check reads that as "already there" and skips the insert, so the marker (and the reorder it drives) silently never appears for that whole gesture shape
  const editPill=(pill,pt)=>{ arm(); const cur=pill.dataset.val;   // turn the pill back into editable Key=Value text
    // pt (optional) — the {x,y} VIEWPORT point (clientX/clientY) of the click that opened this edit.
    // Given one, the caret lands at the character nearest that point (caretAtPoint, js/core/document.js
    // — the SAME canvas-measureText walk the plain grid cells use at item 5/7 above, so the zoom trap it
    // already accounts for — cssZoomOf, since a .pilledit lives inside the zoomed .sblock — is handled once,
    // not reimplemented here). With no pt (dblclick, or any future programmatic opener that wants the whole
    // value up for replacement rather than a point to click INTO) the field selects everything, as before.
    const pw=pill.getBoundingClientRect().width;   // the chip's exact rendered footprint → open the input at precisely this width (the ring is an inset box-shadow, so it adds no width and the input never overshoots the chip)
    const ie=document.createElement("input"); ie.className="pilledit"; ie.value=cur; ie.spellcheck=false; ie.draggable=false; ie.contentEditable="false";
    const fit=()=>{ const cs=getComputedStyle(ie); ie.style.width=Math.max(pw+2.5,Math.ceil(meas(ie.value||" ",`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`))+27.5)+"px"; };   // the inset ring sits 1px inside each edge → border-box pw+2.5 lands the visible ring a touch past the chip edge (user's preferred). Height already matches the chip (18px); only width is set here
    box.insertBefore(ie,pill); pill.remove(); fit(); ie.addEventListener("input",fit); ie.focus();
    if(pt&&typeof caretAtPoint==="function") caretAtPoint(ie,pt.x,pt.y); else ie.select();
    const restore=v=>{ const np=mkPill(v); if(np) box.insertBefore(np,ie); ie.remove(); anchors(); };
    const commit=()=>{ if(ie._done) return; ie._done=true; if(_acInput===ie)acClose(); restore(ie.value); serialize(); };
    // item 12/13: drive the SAME constrained, categorised FEATS (and MISC) autocomplete on an EXISTING pill being edited
    // as the free-typing box path and the gloss-map sheet do — reusing the shared inventory/menu functions (acKeyItems /
    // acValItems / acShowGrouped / acShowCustom / acFill), so an edited chip is completed from the official UD + SUD set
    // exactly like a newly typed one. No inventory logic is duplicated; only the pending Key=Value segment is parsed here.
    const openIeAC=force=>{ if(document.activeElement!==ie){ if(_acInput===ie)acCloseSoon(); return; }
      const caret=(ie.selectionStart!=null)?ie.selectionStart:ie.value.length;
      const seg=ie.value.slice(0,caret), eq=seg.indexOf("="); let items,kind,q,keyName=null;
      if(eq<0){ if(!seg&&!force){ if(_acInput===ie)acCloseSoon(); return; } kind="key"; q=seg; items=acKeyItems(key); }   // before "=" → attribute names (FEATS/MISC inventory); item 9: force-open browses the whole set on an empty segment
      else { kind="value"; keyName=seg.slice(0,eq); q=seg.slice(eq+1); items=acValItems(key,keyName); }            // after "=" → that key's official value set (doc-mined fallback for an unknown key)
      /* Task C — the MGloss VALUE segment gets its OWN completion instead: every glossing abbreviation
         (MGLOSS_AC_ITEMS, js/io/bridge.js — the SAME GLOSS_FEATS-derived inventory the diagram's MGloss editor
         offers, never a second hand-written table) starting with the abbreviation run just typed, not the
         generic doc-mined MGloss-STRING list acValItems would otherwise offer (which completes to a whole
         previous value wholesale, not to one abbreviation slotted into the current one). Gated the same way as
         the diagram editor — a capital letter or digit 1-4 just typed (Leipzig abbreviations are uppercase;
         1-4 are how Person is abbreviated), or a forced Ctrl+Space browse — so merely focusing/tabbing into the
         chip doesn't pop it. Accepting a row inserts it via mglossAcAccept at its canonical rank
         (insertGlossAbbrevAtRank), exactly like the diagram's own editor — never a raw caret insert. */
      if(key==="misc" && kind==="value" && keyName==="MGloss"){
        const capDigit = force===true || (force && force.inputType==="insertText" && force.data && /^[A-Z1-4]$/.test(force.data));
        if(!capDigit){ if(_acInput===ie)acCloseSoon(); return; }
        const partial=(/[^.\-]*$/.exec(q)||[""])[0];
        if(!partial){ if(_acInput===ie)acCloseSoon(); return; }
        const ms=MGLOSS_AC_ITEMS.filter(x=>x.ab.startsWith(partial));
        if(!ms.length){ if(_acInput===ie)acCloseSoon(); return; }
        acShowGrouped(ie, mglossAcGroups(ms), ab=>{   // grouped by grammatical category (bridge.js's mglossAcGroups), same as the diagram's own MGloss editor
          const at=(ie.selectionStart!=null)?ie.selectionStart:ie.value.length, valStart=keyName.length+1;
          const r=mglossAcAccept(ie.value.slice(valStart), Math.max(0,at-valStart), ab, t.upos);
          ie.value=keyName+"="+r.mg; try{ie.setSelectionRange(valStart+r.caret,valStart+r.caret);}catch(_){} fit(); },
          ab=>{ const it=ms.find(x=>x.ab===ab); return it?it.expand:""; });
        return; }
      const ql=q.toLowerCase();
      let ms=!ql?items.slice():items.filter(v=>v.toLowerCase().startsWith(ql));
      if(ql&&!ms.length)ms=items.filter(v=>v.toLowerCase().includes(ql));   // fall back to substring matches
      ms=ms.filter(v=>v.toLowerCase()!==ql);   // nothing to complete to the exact text already present
      if(!ms.length){ if(_acInput===ie)acCloseSoon(); return; }
      const pick=v=>{ ie.focus();
        if(kind==="key"){ ie.value=v+"="; try{ie.setSelectionRange(ie.value.length,ie.value.length);}catch(_){} fit(); setTimeout(openIeAC,0); }   // feature/key chosen → immediately offer its values
        else { ie.value=keyName+"="+v; try{ie.setSelectionRange(ie.value.length,ie.value.length);}catch(_){} fit(); } };
      if(kind==="key"&&key==="feats"){ const groups=[], seen=new Set();   // FEATS feature names grouped under the UD categories, exactly like the free-typing box path
        FEATS_CATS.forEach(cat=>{ const gi=ms.filter(v=>FEATS_CAT[v]===cat); gi.forEach(v=>seen.add(v)); if(gi.length)groups.push({title:cat,items:gi}); });
        const rest=ms.filter(v=>!seen.has(v)); if(rest.length)groups.push({title:"Other (in document)",items:rest});
        acShowGrouped(ie,groups,pick); }
      else { const descFn=(keyName&&(UD_FEATS[keyName]||UD_MISC_VALS[keyName]))?(v=>(FEATS_VDESC[keyName]||{})[v]||""):null; acShowCustom(ie,ms,pick,descFn); } };   // official value glosses, dimmed & right-aligned (FEATS only)
    ie.addEventListener("input",openIeAC); ie.addEventListener("focus",openIeAC);
    ie.addEventListener("keydown",e=>{ e.stopPropagation(); const k=e.key;
      if(e.ctrlKey&&(k===" "||e.code==="Space")){ e.preventDefault(); openIeAC(true); return; }   // item 9: Ctrl+Space force-opens the autocomplete while editing an existing pill too
      if(_acMenu&&_acMenu.classList.contains("show")&&_acInput===ie){   // dropdown open on THIS pill-edit input → own ↑/↓/Enter/Tab/Esc (mirrors the free-typing box path)
        if(k==="ArrowDown"){ e.preventDefault(); acHi((_acIdx+1)%_acItems.length); return; }
        if(k==="ArrowUp"){ e.preventDefault(); acHi((_acIdx-1+_acItems.length)%_acItems.length); return; }
        if((k==="Enter"||k==="Tab")&&_acIdx>=0){ e.preventDefault(); acFill(_acItems[_acIdx]); return; }   // accept the highlighted suggestion instead of committing the chip
        if(k==="Escape"){ e.preventDefault(); acClose(); return; }   // first Esc just closes the menu, keeping the edit open
      }
      if(k==="Enter"||k==="Tab"){ e.preventDefault(); commit(); box.focus(); }
      else if(k==="Escape"){ e.preventDefault(); ie._done=true; if(_acInput===ie)acClose(); restore(cur); box.focus(); } });
    ie.addEventListener("blur",commit); };
  /* A FEATS CHIP'S OWN MENU — the same idea glossAbbrMenu (js/editing/context-menu.js) gives a morphemic gloss
     abbreviation, brought to the grid's own FEATS pills: right-click the VALUE half for the feature's other
     values (read off UD_FEATS/FEATS_VDESC via acValItems, in UD's own order — never alphabetised, never a
     bespoke list), right-click the KEY half for other feature names to switch this pill to (acKeyItems,
     grouped by FEATS_CATS/FEATS_CAT exactly as the free-typing autocomplete groups them). Both write through
     the SAME chip machinery a hand edit uses — mkPill + box.insertBefore/remove + anchors() + serialize() —
     not a parallel model write, so a menu pick round-trips (undo, touchColW, featsSyncGloss, markDirty,
     re-render) exactly like retyping the chip would.
     MISC-only, this is not: MISC's few keys with a value inventory at all (SpaceAfter, Reported, …) are
     bookkeeping, not a paradigm, so there is nothing here worth offering "the other values of" — gated on
     key==="feats" and a MISC pill's right-click falls through to the ordinary token menu untouched.
     ⚠ box.focus() alone (a first cut) was wrong on report: "the caret ends up at the head of the cell" and "a
     caret appears where there wasn't one before". Both are the SAME contenteditable gotcha CLAUDE.md documents
     for minting a chip — focusing a contenteditable DIV that ISN'T already focused collapses the caret to
     position 0 — and it bites HARDER here than there: `showCtx`'s rows are real `<button>`s with a bare
     `onclick`, so picking a row has already moved `document.activeElement` off `box` by the time `applyVal`
     runs, meaning `box.focus()` is *always* a fresh-focus event, never a same-element no-op. Worse,
     `serialize()`'s own `preserveScroll(renderDoc)` (in the onChange below) captures `pillCaretGet` off
     whatever `box.focus()` just left behind — so it faithfully "preserves" the corrupted position-0 caret
     across the re-render, and conjures one even when `box` was never focused at all (the reader merely
     right-clicked a pill in a field they hadn't touched). Fixed by capturing the caret UP FRONT, before the
     menu (and its focus-stealing rows) ever opens — `pillCaretGet` returns null when `box` had no live
     selection, which is exactly "no caret to begin with" and is left alone. `arm()` (not box.focus()) is what
     the × button's own handler really needed from focusing — arming pendingSnap for undo — and doesn't touch
     focus or the caret at all. Only when a caret genuinely existed does `applyVal` re-focus and re-seat it,
     and only on the FRESH cell serialize()'s render produced — the closure's own `box` is a detached node by
     then (renderDoc rebuilds grid cells; preserveScroll's own restore re-queries by data-si/data-ti/data-col
     for the same reason), so the re-seat re-queries too, exactly as preserveScroll does. */
  const featPillMenu=(pill,e)=>{ if(key!=="feats") return false;
    const val=pill.dataset.val, eq=val.indexOf("="); if(eq<0) return false;   // a bare (no "=") segment has no key/value halves to alternate
    const onVal=e.target.closest&&e.target.closest(".pv"), onKey=e.target.closest&&e.target.closest(".pk");
    if(!onVal&&!onKey) return false;   // "=", the × button, or the chip's own padding — no menu opinion there
    const feat=val.slice(0,eq), curVal=val.slice(eq+1);
    const savedCaret=pillCaretGet(box);   // captured NOW, before showCtx's own rows steal focus — null if box had no live caret, which is exactly when none should reappear
    const applyVal=next=>{ if(next===val) return; arm(); const np=mkPill(next); if(np) box.insertBefore(np,pill); pill.remove(); anchors(); serialize();
      if(savedCaret){ const nc=document.querySelector(`[data-si="${si}"][data-ti="${i}"][data-col="${key}"]`); if(nc){ nc.focus(); pillCaretSet(nc,savedCaret); } } };   // NOT named `pick` — that would shadow the global token-selection pick()
    if(onVal){ const vals=acValItems("feats",feat);
      if(vals.length<2) return false;   // a one-value feature (Poss=Yes, Reflex=Yes, …) offers no alternative — same rule glossAbbrMenu uses
      const desc=FEATS_VDESC[feat]||{};
      showCtx(e.clientX,e.clientY,[{header:feat}].concat(vals.map(v=>({label:v, expand:desc[v]||"", check:v===curVal, opt:true,   // opt:true — see the checkmark-gutter note in CLAUDE.md/glossAbbrMenu
        fn:()=>applyVal(feat+"="+v)}))), vals.length>12, sentRTL(sent));
      return true; }
    const used=new Set([...box.querySelectorAll(".fpill")].map(p=>{ const v2=p.dataset.val, e2=v2.indexOf("="); return e2>0?v2.slice(0,e2):null; }).filter(Boolean));
    const items=acKeyItems("feats").filter(k=>k===feat||!used.has(k));   // exclude a feature already present elsewhere on this token (a second Case chip serialises fine but is never something the reader wants) — except this pill's OWN key, which must stay selectable so its row can carry the tick
    if(items.length<2) return false;   // every other feature is already on this token — nothing to switch to
    const groups=[], seen=new Set();
    FEATS_CATS.forEach(cat=>{ const gi=items.filter(k=>FEATS_CAT[k]===cat); gi.forEach(k=>seen.add(k)); if(gi.length)groups.push([cat,gi]); });
    const rest=items.filter(k=>!seen.has(k)); if(rest.length)groups.push(["Other (in document)",rest]);
    const rows=[]; groups.forEach(([title,keys])=>{ rows.push({header:title});
      keys.forEach(k=>rows.push({label:k, check:k===feat, opt:true, fn:()=>applyVal(k+"="+curVal)})); });
    showCtx(e.clientX,e.clientY,rows, rows.length>18, sentRTL(sent));
    return true; };
  const wirePill=pill=>{
    pill.addEventListener("dblclick",e=>{ e.preventDefault(); e.stopPropagation(); editPill(pill); });
    pill.addEventListener("contextmenu",e=>{ if(featPillMenu(pill,e)){ e.preventDefault(); e.stopPropagation(); } });   // no menu opinion (MISC, a bare chip, a one-value feature, the × button) → falls through to the row's own contextmenu handler (tokenMenu)
    pill.addEventListener("pointerdown",e=>{ if(e.button!==0||e.target.closest(".px")) return;
      e.preventDefault();   // `box` is contenteditable, so a plain mousedown's DEFAULT action is to start/extend a native text selection — left unchecked, dragging a pill also drags a text selection across the field (the reported "triggers text selection"), and the resulting selection-drag fights our own geometry: mid-gesture the field can auto-scroll or reflow under a live selection, which was very plausibly why a drop always seemed to resolve to "the end" (placeMarker's rects were read against a shifting layout). preventDefault cancels that default action outright; box.focus() below replaces the (now-cancelled) default focusing behaviour explicitly, so a pill click still focuses an unfocused field.
      if(document.activeElement!==box) box.focus();
      try{pill.setPointerCapture(e.pointerId);}catch(_){}   // capture IMMEDIATELY, not after the 4px threshold trips inside onMove: a real (or Playwright-driven) drag gesture can easily jump straight from the pointerdown point to well past the neighbouring pill in its very first pointermove, landing that event's TARGET on a sibling pill (or the field) instead of this one — a plain (non-capturing) pointermove listener on `pill` would then just never fire, silently killing the drag before it starts. Capturing from pointerdown retargets every subsequent pointermove/pointerup for this pointer to `pill` regardless of where the cursor physically is, so onMove always sees them.
      const sx=e.clientX, sy=e.clientY; let dragging=false;   // wasSel (the pre-click .sel state) no longer read — a plain click opens the chip for editing rather than toggling selection, so there is nothing left to restore
      const onMove=ev=>{ if(!dragging){ if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)<4) return;   // 4px threshold → a plain click never starts a drag
          dragging=true; arm(); selectPill(pill); pill.classList.add("dragging"); box.classList.add("pdragging"); }   // .pdragging on the FIELD (not just the pill) drives the grabbing cursor for the whole gesture — the pill itself never visually follows the pointer (only the drop marker does), so relying on :hover/the pill's own cursor would show the wrong glyph the instant the pointer left the pill's original footprint
        placeMarker(ev.clientX,ev.clientY,pill); };
      const onUp=()=>{ pill.removeEventListener("pointermove",onMove); pill.removeEventListener("pointerup",onUp); pill.removeEventListener("pointercancel",onUp);
        if(dragging){ pill.classList.remove("dragging"); box.classList.remove("pdragging"); if(marker&&marker.parentNode){ box.insertBefore(pill,marker); marker.remove(); } anchors(); serialize(); box.focus(); }
        else editPill(pill,{x:sx,y:sy}); };   // no drag → a plain click opens the chip for editing, immediately (see the block comment above wirePill), caret at the click point (sx/sy from pointerdown — !dragging means pointerup is within the 4px threshold of it, so it's the click position)
      pill.addEventListener("pointermove",onMove); pill.addEventListener("pointerup",onUp); pill.addEventListener("pointercancel",onUp); });
  };
  const mkPill=raw=>{ const v=stripZW(raw).trim(); if(!v) return null;   // strip any caret-anchor ZW so it never enters a chip's serialised value
    const pill=document.createElement("span"); pill.className="fpill"; pill.dataset.val=v; pill.contentEditable="false"; pill.draggable=false;   // atomic chip (caret can't enter it); keep the exact segment for byte-stable serialisation
    const eq=v.indexOf("=");
    if(eq>0){ const k=document.createElement("span"); k.className="pk"; k.textContent=v.slice(0,eq);
      const s=document.createElement("span"); s.className="peq"; s.textContent="=";
      const val=document.createElement("span"); val.className="pv"; val.textContent=v.slice(eq+1); pill.append(k,s,val); }
    else { const s=document.createElement("span"); s.className="pv"; s.textContent=v; pill.appendChild(s); }
    const x=document.createElement("button"); x.type="button"; x.className="px"; x.textContent="×"; x.tabIndex=-1; x.title="Remove";
    x.addEventListener("mousedown",e=>e.preventDefault());   // don't blur the cell when clicking ×
    x.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); box.focus();   // focus first → arms the undo snapshot (focusin sets pendingSnap)
      const idx=[...box.querySelectorAll(".fpill")].indexOf(pill);
      if(pendingSnap) pendingSnap.caret={si:box.dataset.si,ti:box.dataset.ti,col:box.dataset.col,chips:idx+1};   // UNDO restores the caret just after the reappearing pill
      pill.remove(); anchors(); serialize(); });
    pill.appendChild(x); wirePill(pill); return pill; };
  // — mint the text typed just before the caret into a pill, in place (Gmail-style, at any caret position) —
  const commitCaret=()=>{ const s=window.getSelection(); if(!s.rangeCount) return false;
    const r=s.getRangeAt(0); if(!r.collapsed || !box.contains(r.startContainer)) return false;
    const node=r.startContainer; if(node.nodeType!==3) return false;   // caret not in a text run → nothing pending
    const off=r.startOffset, seg=stripZW(node.data.slice(0,off)).trim(); if(!seg) return false;   // ignore the ZW anchor when deciding whether a segment is pending
    const pill=mkPill(seg); if(!pill) return false;
    const after=node.data.slice(off); box.insertBefore(pill,node);   // chip goes in at the caret; the tail text stays after it
    node.data=after||ZW; setCaret(node,0);   // keep a text node (with an anchor if empty) right after the new chip so the caret lands there
    anchors(); serialize(); return true; };
  // — commit every remaining un-minted text run (on leave / paste fallback) —
  const commitAll=()=>{ let added=false;
    [...box.childNodes].forEach(n=>{ if(n.nodeType!==3) return;
      n.data.split("|").forEach(seg=>{ const p=mkPill(seg); if(p){ box.insertBefore(p,n); added=true; } });
      n.remove(); });
    if(added) serialize(); return added; };
  /* item 1 — MSeg is a MORPHEME SEGMENTATION of the surface form ("raama-aayaNa"), so it is written in
     whatever notation the form is — IAST for Sanskrit — and a user typing it reaches for ITRANS exactly
     as they do in the Form cell. Converted on the FIELD's blur rather than on each chip's commit: a
     segmentation is typed as one string and the chip is minted mid-word by the delimiter keys, so a
     per-chip conversion would fire on fragments. Same two guards the plain cells use: only after a real
     edit (box._edited), and only if the model still holds the value that was sent to the bridge.
     Written through t.misc, not through the pill DOM: serialize() re-renders, so by the time the await
     lands the chip that was on screen may be a detached node — the grid rebuilds its pills from t.misc
     anyway, so going through the model is both simpler and correct. */
  const msegFix=async()=>{ const v0=miscKV(t.misc,"MSeg"); if(!v0) return;
    const v=await itransFix(v0); if(v===v0 || miscKV(t.misc,"MSeg")!==v0) return;
    t.misc=setMiscKV(t.misc,"MSeg",v); markDirty(); preserveScroll(renderDoc); };
  const raw0=t[key]; if(raw0&&raw0!=="_") raw0.split("|").forEach(seg=>{ const p=mkPill(seg); if(p) box.appendChild(p); });
  anchors();   // seed caret anchors so clicking between chips (or into an empty field) works on first interaction
  // — autocomplete: complete the pending Key=Value segment via the shared dropdown (never rewrites existing chips) —
  const pillPick=(kind,val)=>{ const s=window.getSelection(); if(!s.rangeCount)return;
    const r=s.getRangeAt(0); if(!box.contains(r.startContainer)||r.startContainer.nodeType!==3)return;
    const node=r.startContainer, off=r.startOffset, before=node.data.slice(0,off), after=node.data.slice(off);
    const lead=(before.match(/^​+/)||[""])[0], typed=stripZW(before);   // preserve any leading ZW caret-anchor
    let repl; if(kind==="key")repl=val+"="; else { const eq=typed.indexOf("="); repl=typed.slice(0,eq+1)+val; }
    node.data=lead+repl+after; setCaret(node,lead.length+repl.length); anchors();   // completed text stays PENDING — no chip minted; the user commits with |/Enter/Tab/space exactly as before
    if(kind==="key")setTimeout(openPillAC,0); };   // key chosen → immediately offer that key's values
  const openPillAC=force=>{ if(document.activeElement!==box||box.querySelector("input.pilledit")){ if(_acInput===box)acCloseSoon(); return; }   // not the free-typing caret (e.g. a live chip-edit input) → nothing to complete
    const s=window.getSelection(); if(!s.rangeCount){ if(_acInput===box)acCloseSoon(); return; }
    const r=s.getRangeAt(0); if(!r.collapsed||!box.contains(r.startContainer)||r.startContainer.nodeType!==3){ if(_acInput===box)acCloseSoon(); return; }
    const seg=stripZW(r.startContainer.data.slice(0,r.startOffset)), eq=seg.indexOf("="); let items,kind,q,keyName=null;
    if(eq<0){ if(!seg&&!force){ if(_acInput===box)acCloseSoon(); return; } kind="key"; q=seg; items=acKeyItems(key); }   // before "=" → attribute names; stay silent on an empty segment UNLESS force-opened (item 9: Ctrl+Space browses the whole feature inventory from an empty cell / a caret just outside a pill)
    else { kind="value"; keyName=seg.slice(0,eq); q=seg.slice(eq+1); items=acValItems(key,keyName); }   // after "=" → that key's values (official set for a known feature; doc-mined fallback otherwise)
    const ql=q.toLowerCase();
    let ms=!ql?items.slice():items.filter(v=>v.toLowerCase().startsWith(ql));
    if(ql&&!ms.length)ms=items.filter(v=>v.toLowerCase().includes(ql));   // fall back to substring matches
    ms=ms.filter(v=>v.toLowerCase()!==ql);   // nothing to complete to the exact text already typed
    if(!ms.length){ if(_acInput===box)acCloseSoon(); return; }
    if(kind==="key"&&key==="feats"){   // item 12: FEATS feature-NAME suggestions → grouped under UD categories (FEATS_CATS order); doc-only custom keys trail under "Other (in document)"
      const groups=[], seen=new Set();
      FEATS_CATS.forEach(cat=>{ const gi=ms.filter(v=>FEATS_CAT[v]===cat); gi.forEach(v=>seen.add(v)); if(gi.length)groups.push({title:cat,items:gi}); });
      const rest=ms.filter(v=>!seen.has(v)); if(rest.length)groups.push({title:"Other (in document)",items:rest});   // custom / uncategorised keys stay reachable but clearly separated
      acShowGrouped(box,groups,v=>pillPick(kind,v)); }
    else { const descFn=(keyName&&(UD_FEATS[keyName]||UD_MISC_VALS[keyName]))?(v=>(FEATS_VDESC[keyName]||{})[v]||""):null;   // item 12 (opt): each official value's gloss, dimmed & right-aligned. MISC & value lists otherwise stay flat
      acShowCustom(box,ms,v=>pillPick(kind,v),descFn); } };
  box.addEventListener("keydown",e=>{ e.stopPropagation();   // CRITICAL: a contenteditable DIV is NOT INPUT/SELECT/TEXTAREA, so the document keydown nav handler would otherwise fire on Tab/arrows/Enter while editing here
    const k=e.key;
    if(e.ctrlKey&&(k===" "||e.code==="Space")){ e.preventDefault(); openPillAC(true); return; }   // item 9: Ctrl+Space (or Fn+Ctrl+Space) force-opens the FEATS/MISC autocomplete even on an empty segment, so the user can browse the available features/values
    if(_acMenu&&_acMenu.classList.contains("show")&&_acInput===box){   // dropdown open on THIS field → own ↑/↓/Enter/Tab/Esc (mirrors the Deep cell)
      if(k==="ArrowDown"){ e.preventDefault(); acHi((_acIdx+1)%_acItems.length); return; }
      if(k==="ArrowUp"){ e.preventDefault(); acHi((_acIdx-1+_acItems.length)%_acItems.length); return; }
      if((k==="Enter"||k==="Tab")&&_acIdx>=0){ e.preventDefault(); acFill(_acItems[_acIdx]); return; }
      if(k==="Escape"){ e.preventDefault(); acClose(); return; }   // close the menu without blurring the field or disturbing the caret
    }
    if(k==="Enter"){ e.preventDefault(); commitCaret(); if(_acInput===box)acClose(); box.blur(); return; }   // item 5: Enter commits the pending chip AND leaves the field (matching the plain .cin cells), rather than sitting in the pill field
    if(k==="|"||k===","){ e.preventDefault(); commitCaret(); if(_acInput===box)acClose(); return; }   // never insert a lone delimiter char
    if(k==="Tab"){ const did=commitCaret(); if(did)e.preventDefault(); if(_acInput===box)acClose(); return; }   // commit the pending segment (and keep Tab from navigating tokens)
    if(k===" "){ const did=commitCaret(); if(did)e.preventDefault(); if(_acInput===box)acClose(); return; }     // space mints; if nothing pending it types through
    if((k==="ArrowRight"||k==="ArrowLeft")&&!e.shiftKey&&!e.altKey&&!e.metaKey&&!e.ctrlKey){   // caret must never rest ON a bare ZW anchor — hop the whole chip in one press
      const s=window.getSelection(); if(!s.rangeCount) return; const r=s.getRangeAt(0);
      if(!r.collapsed||!isZWNode(r.startContainer)) return;   // only intervene when the caret sits inside a bare zero-width anchor
      const fwd=(k==="ArrowRight")!==(getComputedStyle(box).direction==="rtl");   // logical travel direction (RTL mirrors the arrow keys)
      let sib=fwd?r.startContainer.nextSibling:r.startContainer.previousSibling;
      while(isZWNode(sib)) sib=fwd?sib.nextSibling:sib.previousSibling;   // treat any stacked anchors as transparent skeleton
      if(sib&&sib.classList&&sib.classList.contains("fpill")){ e.preventDefault();   // land in the gap on the chip's far side, skipping the redundant ZW offset
        const gap=fwd?sib.nextSibling:sib.previousSibling;
        if(gap&&gap.nodeType===3) setCaret(gap,0);
        else { const rng=document.createRange(); fwd?rng.setStartAfter(sib):rng.setStartBefore(sib); rng.collapse(true); s.removeAllRanges(); s.addRange(rng); } }
      return; }   // neighbour is real text or a field edge → let the browser move natively
    if(k==="Backspace"||k==="Delete"){ const s=window.getSelection(); if(!s.rangeCount||!s.getRangeAt(0).collapsed) return;
      const r=s.getRangeAt(0), nd=r.startContainer, off=r.startOffset, back=(k==="Backspace"); let victim=null;
      if(nd.nodeType===3){ const side=back?nd.data.slice(0,off):nd.data.slice(off);
        if(stripZW(side)!=="") return;   // a real character lies that way → let the browser delete it
        victim=back?nd.previousSibling:nd.nextSibling; }   // logically at the node's edge → reach past the ZW anchor
      else victim=back?(nd.childNodes[off-1]||null):(nd.childNodes[off]||null);
      while(isZWNode(victim)) victim=back?victim.previousSibling:victim.nextSibling;   // ZW anchors are skeleton, not content → never delete one as a char
      if(victim&&victim.classList&&victim.classList.contains("fpill")){ e.preventDefault(); arm();
        const idx=[...box.querySelectorAll(".fpill")].indexOf(victim);   // victim's position among the chips (BEFORE removal)
        if(pendingSnap) pendingSnap.caret={si:box.dataset.si,ti:box.dataset.ti,col:box.dataset.col,chips:idx+1};   // overwrite the focusin caret: on UNDO the doc is restored WITH this chip, so put the caret just after it (chips=idx+1 → adjacent to the reappearing pill). REDO's caret is captured live by undo()'s snap() from the post-delete field.
        victim.remove(); anchors(); serialize(); if(_acInput===box)acClose(); }   // act on the adjacent CHIP instead (matches backspace-pops-preceding-chip); drop any stale suggestions
      else e.preventDefault();   // nothing real to delete this way → block the browser from eating a bare anchor (input listener re-seeds if one ever slips through)
      return; }
    if((k==="ArrowDown"||k==="ArrowUp")&&e.shiftKey&&!e.altKey){   // item 1: Shift+↑/↓ extends the multi-token selection from this row (matching the plain .cin cells), even though the pill field isn't a plain input
      e.preventDefault(); const nTok=DOC[si].tokens.length;
      if(!selRange||selRange.s!==si) setRange(si,i+1,i+1);
      const focus=Math.max(1,Math.min(nTok, selRange.focus+(k==="ArrowDown"?1:-1)));
      setRange(si,selRange.anchor,focus); sel={s:si,t:focus}; preserveScroll(renderDoc); return; }
    if((k==="ArrowDown"||k==="ArrowUp")&&!e.altKey&&!e.shiftKey){   // multiline pill field: step through its wrapped chip-lines first, cross to the adjacent row only from the first (↑) / last (↓) line
      const edge=ceCaretEdge(box);
      if(k==="ArrowUp"?!edge.first:!edge.last) return;   // not yet at the boundary line → let the browser move the caret within the field
      const ni=i+(k==="ArrowDown"?1:-1);
      const nc=document.querySelector(`[data-si="${si}"][data-ti="${ni}"][data-col="${key}"]`);
      if(nc){ e.preventDefault(); nc.focus(); revealEl(nc); if(nc.tagName==="INPUT"){ try{nc.setSelectionRange(nc.value.length,nc.value.length);}catch(x){} } } return; }
    if(k==="Escape"){ e.preventDefault(); box.blur(); return; }   // leave the field (keeping the row selected); focusout commits any trailing text
  });
  box.addEventListener("paste",e=>{ if(e.target&&e.target.tagName==="INPUT") return;   // pasting inside an in-place pill edit (.pilledit, from editPill) → let the native paste insert plain TEXT into that chip, don't hijack it into a new pill appended elsewhere
    const txt=(e.clipboardData||window.clipboardData).getData("text"); if(!txt) return; e.preventDefault();
    let added=false; txt.replace(/[\t\n]+/g,"|").split(/[|,]/).forEach(seg=>{ const p=mkPill(seg); if(!p) return; added=true;
      const s=window.getSelection();
      if(s.rangeCount&&box.contains(s.getRangeAt(0).startContainer)){ const r=s.getRangeAt(0); r.insertNode(p); r.setStartAfter(p); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
      else box.appendChild(p); });
    if(added){ anchors(); serialize(); } });
  box.addEventListener("input",()=>{ anchors(); openPillAC(); });   // self-heal ZW anchors, then refresh the autocomplete for the segment being typed
  box.addEventListener("mousedown",e=>{ if(!e.target.closest(".fpill")) clearSel(); });   // click blank space → drop any pill selection (the browser places the caret natively)
  box.addEventListener("focusin",()=>{ anchors(); pick(si,i+1,false,false); revealEl(box); if(!box._armed){ box._armed=true; pendingSnap=snapSent(si); } });   // ensure a caret anchor (empty field / between chips) + snapshot once per editing session. scrollNearest: same reasoning as the plain .cin/.csel focus handler — a NATIVE Tab into this field doesn't otherwise get any scroll of its own, and it's a no-op when the field's already visible
  box.addEventListener("focusout",e=>{ if(_acInput===box)acCloseSoon();   // leaving the field closes the dropdown (clicking a menu row keeps focus via its mousedown-preventDefault, so no focusout there)
    if(!box.contains(e.relatedTarget)){ commitAll(); anchors(); box._armed=false; pendingSnap=null;
      if(key==="misc"&&box._edited) msegFix(); box._edited=false; } });   // item 1: …and a hand-typed MSeg in ITRANS becomes the IAST this app stores (Sanskrit only — see msegFix). commit any trailing text on leave, then RE-SEED the ZW caret anchors: commitAll() strips every text node, and without one the field loses its inline line-height strut, so its line box collapses a hair shorter than when focused (which always has anchors from focusin) → the field shrank vertically on blur. Restoring the anchors keeps the unfocused DOM structurally identical to the focused DOM, so the box height matches exactly. ZW anchors never leak: serialize() reads only .fpill and mkPill strips ZW → round-trip byte-stable.
  td.appendChild(box);
}
let DRAG=null; function clearDZ(){document.querySelectorAll(".grid tr").forEach(tr=>tr.classList.remove("dz-top","dz-bot"));}

