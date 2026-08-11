//@module js/init.js
/* init */
/* One sweep over the STATIC chrome (index.html's ~11 accelerator `title=` tooltips), rewriting the macOS
   glyphs to Windows spelling. Here rather than at the ~200 call sites: see localiseAccel in
   js/core/platform.js. A no-op on macOS, and idempotent — every surface built LATER (context menus, the
   titlebar popups, sheets, the proxy-path menu) re-runs it on its own subtree as it is built, because a
   sweep run once at boot cannot reach DOM that does not exist yet. */
localiseAccel();
document.getElementById("convSel").value=notation;
setFormat(DOCFORMAT);
setLang(modelLang(model));
syncNotation();
function settleAlign(){   // the first paint measures against a not-yet-final window/titlebar layout → re-align diagrams once it settles, so the first user re-render doesn't visibly nudge them
  const go=()=>{ if(DDRAG)return; const s=sel.s,t=sel.t; preserveScroll(renderDoc); if(s>=0&&s<DOC.length)pick(s,t,false); };   // never rebuild the DOM under an in-progress drag (a first-load re-align could otherwise swallow it)
  requestAnimationFrame(()=>requestAnimationFrame(go));
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(go);
  setTimeout(go,450); }   // the native titlebar unification reflows the content a few hundred ms after load (on shown/loaded) — re-align after it lands
refreshTransLangs(); renderTransDrawer();   // item 13: seed the enabled translation languages from the doc + populate the drawer
renderDoc(); if(DOC.length)setCurBlock(0); settleAlign();   // item 9: the first paint selects NOTHING (it used to pick(0,2) — sentence 1's second token, the sample selection). Only the reading focus is placed, on the first sentence; in the desktop app DOC is still empty here anyway and bootBridge below does the same after the real document lands.
setTitle();

/* Deferred to here because init runs last, after every module is parsed. Both reach functions
   declared in later-loaded modules, so running them at their own module's load time throws
   (function hoisting hid this while everything lived in one <script>):
     · updateFileBlock  → js/bridge.js   (called eagerly from the js/wiring.js title-block IIFE)
     · deriveRelHuesFromAccent's boot render → renderDoc's grid path → miscTranslit in
       js/translit-load.js  (was an eager requestAnimationFrame in js/colours.js). */
if(typeof updateFileBlock==="function")updateFileBlock();
requestAnimationFrame(()=>deriveRelHuesFromAccent(true));   // (a) once at boot, after the sync scripts (RELCOL_DEFAULTS + all renderers exist); self-corrects on the next poll tick once loadPrefs has restored any saved override
setInterval(()=>deriveRelHuesFromAccent(false),1000);       // (b) macOS emits no accent-change event → poll the resolved AccentColor; recomputes only on a real change (also picks up a late-loaded override within ≤1s)

/* THE LAST VIEW OF THIS DOCUMENT, hung on the boot cover while the real one is rebuilt. Python hands
   it over only for provably the same view — same file, unmodified, same window size, same scroll
   anchor (Api.launch_snapshot) — so this side only has to hang it: the whole web view, scaled to the
   window's width and pulled up by the chrome height it was taken at, which puts the document in the
   picture exactly where the document is about to be. */
function applyLaunchSnapshot(){
  if(!hasBridge()) return Promise.resolve();
  let p; try{ p=window.pywebview.api.launch_snapshot(); }catch(e){ return Promise.resolve(); }
  return Promise.resolve(p).then(sn=>{
    const sk=sn&&sn.uri?document.querySelector(".bootskel"):null; if(!sk) return;
    sk.style.backgroundImage="url("+sn.uri+")"; sk.style.backgroundSize="100% auto";
    sk.style.backgroundRepeat="no-repeat"; sk.style.backgroundPosition="0 "+(-(sn.chrome||0))+"px";
    // …and name the file in the title bar while the picture is up: get_state will set exactly this a
    // moment later, and until it does the alternative is a full document under "untitled.conllu".
    if(sn.name){ DOCNAME=sn.name; DOCPATH=sn.path||DOCPATH; if(typeof setTitle==="function")setTitle(); }
  }).catch(()=>{});
}
function bootBridge(){
  if(!hasBridge()) return;   // browser design mode → keep the sample document
  /* THE PICTURE FIRST, AND THE DOCUMENT ONLY AFTER IT — a chain, not two calls in flight.
     Issued side by side they race, and the picture loses often enough to be useless: both round trips
     take ~7ms, but get_state's continuation runs renderDoc, which is a ~1s SYNCHRONOUS block, so
     whichever promise settles first owns the main thread until it is done. Losing means the picture is
     applied to a cover clearBootSkeleton has already taken away (measured: shown on one launch,
     missing on the next, same build). Chaining costs the document those ~7ms and makes it certain. */
  applyLaunchSnapshot().then(bootState, bootState);
}
function bootState(){
  window.pywebview.api.get_state().then(async st=>{
    if(typeof invalidateColW==="function") invalidateColW();   // a fresh document at boot — the column-width cache from any previous DOC (there shouldn't be one, but see the other invalidateColW call sites) is meaningless against this one
    if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // …and so is the notation-switch diagram cache (js/core/document.js)
    if(st&&st.sentences&&st.sentences.length){ DOC.length=0; normSents(st.sentences).forEach(s=>DOC.push(s)); }
    else { DOC.length=0; }   // no file → start empty (zero sentences)
    if(st&&st.name)DOCNAME=st.name; if(st&&st.path)DOCPATH=st.path;
    if(st&&st.dirty) markDirtyBase(); else markDirty(false);   // a session restored mid-edit is genuinely unsaved, and its undo history didn't survive the restart — base-dirty
    if(st&&st.format)setFormat(st.format);
    syncGlossTiersFromDoc(); syncDeprelVocabFromDoc(); detectXposMirrorsUpos(); syncDocFonts();   // item 1: derive the glossing tiers from THIS file's own MISC Gloss/MSeg/MGloss — every OTHER load path (doOpen/openRecentFile/applyOpenedDoc/format conversion) already does this; the launch-time boot (a path opened via the command line or a macOS open-file event) was the one path that skipped it, so those tiers silently stayed off even when the file plainly carried the data
    sel={s:-1,t:0};   // item 9: the launch document loads with NOTHING selected, empty or not (it used to select token 1 of sentence 1); clearSelToBlock below places the reading focus once the render is up
    await loadPrefs();   // restore app-level display prefs (show.* / notation) before the first parser/language load
    adoptDocSchemes();   // pick up the open file's own `# translit_scheme` (its STORED transliteration scheme)
    refreshTransLangs(); renderTransDrawer();   // item 13: enabled translation languages from the loaded doc
    clearBootSkeleton();   // the launch document has arrived — empty or not, the boot skeleton has said all it can (index.html)
    setTitle(); renderDoc(); clearSelToBlock(0,false); settleAlign();   // item 9: nothing selected; the reading focus starts on the first sentence (a no-op on an empty document — clearSelToBlock range-checks the index) and restoreScrollPos below owns the viewport
    if(DOC.length&&st)restoreScrollPos(st.scroll);   // restore the launch file's remembered reading position
    setTimeout(captureViewSnapshot,4000);   // …and remember THIS view for the next launch, once the render, the fonts and the transliteration passes have all settled
    Promise.resolve(populateModels()).then(()=>{ maybeAutoDetectLang(); refreshModelFeatsInventory(); });   // fill the dropdown, then let fastText decide the language (authoritative) and drive the matching parser; refreshModelFeatsInventory covers a model already restored from the launch state (js/io/bridge.js), not just a later manual pick (js/ui/wiring.js's own call)
  }).catch(e=>console.error("get_state failed",e));
  try{ window.pywebview.api.list_models(true); }catch(e){}   // refresh the available-models list freshly at launch
}
/* (a rAF-coalesced scroll/resize listener lived here, repainting the pinned headings' focus tint. The headings
   are no longer pinned and no longer paint a tint of their own — see the note by stickyHeadH in js/core/document.js
   — so there is nothing for it to keep up to date.) */
if(hasBridge()) bootBridge();
else window.addEventListener("pywebviewready",bootBridge);
/* The Windows menu bar. BOTH calls are deliberate, and it is not the same pattern as bootBridge above:
   the bar is drawn from the menu table Python serves (Api.menu_spec), so the eager call gives it its
   shape immediately — which is all browser design mode will ever get — and the `pywebviewready` one
   re-runs it once there is a bridge to fetch the real table from. Idempotent, and an immediate no-op
   on macOS, where a real NSMenu owns this. */
bootMenubar();
window.addEventListener("pywebviewready",bootMenubar);
