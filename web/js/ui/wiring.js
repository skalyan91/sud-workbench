//@module js/wiring.js
/* glue */
/* re-render without jumping the scroll: keep the highlighted block at the same viewport position,
   preserve the inner scrollers (grid/diagram) of that block, and restore focus + caret to the cell
   being edited — so editing a grid cell never resets any scroll position */
const INNER_SCROLL=".gwrap,.diagram,.text-conv,.wp-toks";   // every nested scroller whose position must survive a re-render
function preserveScroll(fn){ const doc=document.getElementById("doc");
  const rawTop=doc.scrollTop;   // fallback anchor when no block is selected (e.g. a theme change with nothing picked)
  const CB=curBlock();   // anchor on the block the reader is ON, not the one holding the selection — they are the same until a scroll separates them, and after one it is the visible block whose position must not jump (see the CURBLOCK note in js/core/prefs.js)
  const anchor=doc.querySelector(`.sblock[data-i="${CB}"]`);
  const before=anchor?anchor.getBoundingClientRect().top-doc.getBoundingClientRect().top:null;
  const innerTops=[]; if(anchor) anchor.querySelectorAll(INNER_SCROLL).forEach(el=>innerTops.push([el.scrollTop,el.scrollLeft]));
  /* THE FOCUSED GRID CELL SURVIVES THE RE-RENDER — its caret, and the text being typed into it.
     The caret alone was already carried across; the VALUE was not, and the two cannot be separated.
     A grid cell commits on blur/Enter, not per keystroke, so while the reader is mid-word the model
     still holds the old string — and a background pass re-rendering underneath them (the re-parse a
     form edit kicks off, an MWT re-fuse) rebuilt the cell FROM the model, threw
     their half-typed word away, and then set a caret offset into a string they had never seen. That
     reads as the cursor jumping; it is actually the text vanishing under it.
     `_edited` is the grid's own "this cell has been typed in" flag (set on the first `input` event,
     js/grid/grid.js) and is exactly the condition under which the reader's text is the newer
     statement about the field — the same rule makeEditable's INLINE_EDIT_SYNC applies to the
     floating diagram editor, which is why an UN-edited cell still follows the model here and picks up
     whatever the pass computed. */
  const ae=document.activeElement; let fd=null;
  if(ae&&ae.dataset&&ae.dataset.col!=null) fd={si:ae.dataset.si,ti:ae.dataset.ti,col:ae.dataset.col,
    ss:ae.selectionStart,se:ae.selectionEnd,
    val:(ae._edited&&/INPUT|TEXTAREA/.test(ae.tagName))?ae.value:null,
    // …and the FEATS/MISC pill field, which has no selectionStart to carry: it keeps its place as a
    // chip count plus an offset into the text run (pillCaretGet, js/grid/grid.js). Without this a
    // minted chip re-rendered the cell and `nc.focus()` below dropped the caret at its head — see
    // that function's own note.
    pill:(ae.classList&&ae.classList.contains("pillfield")&&typeof pillCaretGet==="function")?pillCaretGet(ae):null};
  fn();
  if(before!=null){ const a2=doc.querySelector(`.sblock[data-i="${CB}"]`);
    if(a2) doc.scrollTop+=(a2.getBoundingClientRect().top-doc.getBoundingClientRect().top)-before; }
  else doc.scrollTop=rawTop;   // nothing selected → just keep the page where it was
  const a3=doc.querySelector(`.sblock[data-i="${CB}"]`);
  if(a3&&innerTops.length){ const inners=a3.querySelectorAll(INNER_SCROLL);
    innerTops.forEach((p,k)=>{ if(inners[k]){inners[k].scrollTop=p[0]; inners[k].scrollLeft=p[1];} }); }
  if(fd){ const nc=doc.querySelector(`[data-si="${fd.si}"][data-ti="${fd.ti}"][data-col="${fd.col}"]`);
    if(nc){ nc.focus();
      // the typed text goes back FIRST, so the caret offset below indexes the string it was measured
      // against; `_edited` rides with it, or the blur-time ITRANS pass would no longer see a typed cell
      if(fd.val!=null && nc.value!==fd.val){ nc.value=fd.val; nc._edited=true; }
      if(/INPUT|TEXTAREA/.test(nc.tagName)&&fd.ss!=null){ try{nc.setSelectionRange(fd.ss,fd.se);}catch(e){} }
      else if(fd.pill&&typeof pillCaretSet==="function") pillCaretSet(nc,fd.pill); } } }   // …and the pill field's own caret, restored AFTER focus() (which is what collapsed it)
/* A RE-RENDER THAT MUST NOT INTERRUPT TYPING. For the background passes — the re-parse a form edit kicks off,
   which lands seconds after the edit — the render is a nicety, while the caret it would destroy is the reader's
   place in the next field. makeEditable's own field carries none of the attributes preserveScroll restores focus
   by (see INLINE_EDIT_OPEN in js/core/prefs.js), so the only way to keep it is not to render over it. Skipped
   rather than queued: whatever the pass wanted shown, the editor's own commit re-renders on close, and a queued
   render would fire at the one moment the reader has just started typing somewhere else. */
function renderUnlessEditing(){ if(typeof INLINE_EDIT_OPEN!=="undefined"&&INLINE_EDIT_OPEN){
    if(typeof INLINE_EDIT_SYNC==="function") INLINE_EDIT_SYNC();   // …but the field still learns what the skipped render would have shown it (js/core/prefs.js)
    return false; }
  preserveScroll(renderDoc); return true; }
let raf=false; function scheduleDoc(){if(raf)return; raf=true; requestAnimationFrame(()=>{raf=false; preserveScroll(renderDoc);});}
function refresh(){ preserveScroll(renderDoc); if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho(); }   // routine re-renders keep the scroll position; item 17: a newly-added/duplicated block picks up the active SCRIPT (and Sanskrit MWT sandhi) right away — fillOrtho only re-renders if it filled something
function updateViewOptions(){
  syncGlossUI();   // keep the drawer's gloss/morphemic checkboxes + remove affordances in step with the tier state
  const st=notation==="stemma";
  document.querySelectorAll("#toggles .stemma-only").forEach(el=>el.style.display=st?"":"none");   // item 7: the stemma node/projection checkboxes live in the Show/Hide drawer, visible only under Stemma
  const cc=document.getElementById("catNodesChk"); if(cc)cc.checked=stemmaCat;
  const pl=document.getElementById("projLinesChk"); if(pl)pl.checked=stemmaProj;
  const ar=document.querySelector('#toggles [data-t="arrows"]'); ar.closest("label").style.display=arrowsOK()?"":"none"; ar.checked=arrowsOK()&&show.arrows;
  const posOK=conv==="arcs"||conv==="brackets"||(isStemma()&&stemmaProj);   // POS-below option only where there are baseline tokens
  const pc=document.querySelector('#toggles [data-t="pos"]'); pc.closest("label").style.display=posOK?"":"none"; pc.checked=show.pos;
  const gc=document.querySelector('[data-t="grids"]'); if(gc)gc.checked=show.grids;   // keep the "Show grids" checkbox in step with the ⌃⌘G toggle / menu
  syncMenu();   // notation change may flip whether "Wrap Long Lines" is available → refresh the conditional menu item
}

const hasBridge=()=>!!(window.pywebview&&window.pywebview.api);
let DIRTY=false, DIRTY_BASE=false, DOCNAME="untitled.conllu", DOCPATH="";   // DIRTY_BASE: unsaved for a reason the undo history can't show — see markDirty/markDirtyBase.   // DOCPATH = absolute path of the open file ("" = unsaved/new → no proxy-path menu). Declared here (before the titlebar init IIFE below) so it isn't in the TDZ when that init runs.
// File actions (New/Open/Append/Save/Rename) live in the native File menu now; the titlebar holds only
// content-creation + edit + model + search controls.
document.getElementById("btnParse").onclick=()=>addTextSheet();           // single "+" → add text (parsers split into sentences)
document.getElementById("btnGuide").onclick=()=>openHelp();               // toolbar Help button → in-app Help dialog (no longer a deep-link to the guidelines site)
// notation pill: five round buttons drive the hidden #convSel (reusing its onchange) and show the active one
function updateNotationPill(){ let activeIcon=null;
  document.querySelectorAll('#notationPill [data-notation]').forEach(b=>{ const on=b.dataset.notation===notation;
    b.classList.toggle("active", on); b.setAttribute("aria-pressed", on?"true":"false");
    if(on){ const s=b.querySelector(".sfi"); if(s) activeIcon=s.style.getPropertyValue("--m"); } });
  // item 13: #notationBtn's own glyph tracks the current notation — read straight off whichever hidden
  // button is active (same "one source of truth" the dropdown's items themselves already read from,
  // _tbGroupItems) rather than a second Feat=>icon table kept in sync by hand.
  const trigger=document.getElementById("notationBtn"); const ts=trigger&&trigger.querySelector(".sfi");
  if(ts&&activeIcon) ts.style.setProperty("--m",activeIcon); }
// item 12: single switch point for the five notations — drives the hidden #convSel (reusing its onchange, which
// sets `notation`, re-renders, saves prefs). Used by the pill buttons, the ⌘1–⌘5 keys, and the native View menu.
function setNotation(v){ if(!v||v===notation)return; const sel=document.getElementById("convSel"); if(sel){ sel.value=v; sel.dispatchEvent(new Event("change")); } }
window.setNotation=setNotation;
document.querySelectorAll('#notationPill [data-notation]').forEach(b=>{ b.onclick=()=>setNotation(b.dataset.notation); });
// item 13: the VISIBLE trigger is #notationBtn (a single Finder-"view options"-style icon button) — the five
// buttons above stay in the DOM, hidden, purely as _tbGroupItems' own source of truth (label/icon/checked all
// read straight off them, so there is nothing to keep in sync by hand). openTbGroupMenu is the SAME popup
// Text-Only mode already opens for this exact pill (see the .pilllabel click handler further down) — reused
// here as this button's ONLY behaviour, in every display mode, not just Text-Only.
document.getElementById("notationBtn").addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation();
  const pill=document.getElementById("notationPill"), r=e.currentTarget.getBoundingClientRect();
  openTbGroupMenu(_tbGroupItems(pill), r.left, r.bottom+4); });
// item 3: page-layout pill — the same shape as the notation pill (two segments, the active one pressed). The
// class goes on #doc rather than on each block, so the sheets, the page ground and the measure cap are all one
// stylesheet switch; renderDoc reads PAGED itself to decide where a sheet ENDS (a `# newdoc`).
function applyPageMode(){ const doc=document.getElementById("doc"); if(doc) doc.classList.toggle("paged",PAGED);
  document.querySelectorAll('#pagePill [data-paged]').forEach(b=>{ const on=(b.dataset.paged==="1")===PAGED;
    b.classList.toggle("active",on); b.setAttribute("aria-pressed",on?"true":"false"); }); }
function setPageMode(v){ v=!!v; if(v===PAGED){ applyPageMode(); return; } PAGED=v; applyPageMode(); preserveScroll(renderDoc); savePrefs(); if(typeof syncMenu==="function")syncMenu(); }   // syncMenu: the View menu's "Paged Layout" row is checkable, and nothing else in this path pushes menu state
function togglePageMode(){ setPageMode(!PAGED); toast(PAGED?"Paged layout":"Unpaged layout"); }
window.setPageMode=setPageMode; window.togglePageMode=togglePageMode;
document.querySelectorAll('#pagePill [data-paged]').forEach(b=>{ b.onclick=()=>setPageMode(b.dataset.paged==="1"); });
applyPageMode();   // initial state (before prefs land — loadPrefs re-applies once the stored choice arrives)
// model: the visible #modelSel popup IS the picker; its onchange is wired below. Manage-Models is a separate button.
// right-click the filename → macOS proxy-icon path popup (ancestor folders → reveal in Finder)
(function(){ const f=document.getElementById("tbFile"); if(!f) return;
  f.addEventListener("contextmenu",e=>{ e.preventDefault(); e.stopPropagation(); if(DOCPATH) openFolderMenu(); });
  // keep the AppKit drag overlays aligned with the live layout: the titlebar reflows when the filename
  // or a control (model dropdown, search) changes width, without firing a native window "resized" event.
  function poke(){ if(!hasBridge())return; clearTimeout(poke._t); poke._t=setTimeout(()=>{ try{window.pywebview.api.remeasure_titlebar();}catch(e){} },60); }
  if(window.ResizeObserver){ const ro=new ResizeObserver(poke); ro.observe(f); const rt=document.querySelector(".tbright"); if(rt)ro.observe(rt); }
  const sb=document.querySelector(".statusbar");   // language / translit / format changes surface in the status bar → refresh the meta line
  if(sb&&window.MutationObserver){ new MutationObserver(()=>updateFileBlock()).observe(sb,{childList:true,subtree:true,characterData:true}); }
  if(typeof updateFileBlock==="function")updateFileBlock();   // updateFileBlock lives in js/bridge.js (loaded later); js/init.js runs the boot call once every module is defined
})();
// titlebar display mode (right-click the bar → Icon and Text / Icon Only / Text Only), persisted in prefs
const TB_MODES={icon:"tb-icononly",both:"tb-labels",text:"tb-textonly"};
function applyTbMode(mode){ const tb=document.querySelector(".titlebar"); if(!tb)return;
  if(!TB_MODES[mode])mode="icon"; TBMODE=mode;
  tb.classList.remove("tb-icononly","tb-labels","tb-textonly"); tb.classList.add(TB_MODES[mode]);
  // fix 15b: remeasure the native titlebar AFTER the new label row has laid out. Measuring synchronously here
  // read a stale (pre-reflow) height, so "Icon and Text" appeared to do nothing until another mode (Text Only)
  // had already grown the bar and cached a taller height. A double rAF defers to post-layout.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ try{ syncChrome(); }catch(_){} }));   // fix 3: resync the doc offset + options-bar top after the label row relays out
  if(hasBridge()){ requestAnimationFrame(()=>requestAnimationFrame(()=>{ try{ window.pywebview.api.remeasure_titlebar(); }catch(e){} })); } }
function setTbMode(mode){ applyTbMode(mode); PREFS.tbmode=TBMODE; savePrefs(); }
let _tbMenu=null;
// item 3: the native titlebar drag overlay (an NSView above the webview) swallows left-clicks over the toolbar,
// so a menu row opened under it couldn't be clicked. While a titlebar menu is open we ask the shell to make that
// overlay click-through (bridge → __main__ toggles the drag view's hit-testing), so the menu can open AT the
// cursor and still receive clicks; it's restored on close.
function _tbPass(on){ try{ if(hasBridge()) window.pywebview.api.titlebar_passthrough(!!on); }catch(e){} }
function closeTbMenu(){ if(_tbMenu){ _tbMenu.remove(); _tbMenu=null; document.removeEventListener("mousedown",_tbOutside,true); document.removeEventListener("keydown",_tbKey,true); _tbPass(false); } }
function _tbOutside(e){ if(_tbMenu&&!_tbMenu.contains(e.target)) closeTbMenu(); }
function _tbKey(e){ if(e.key==="Escape"&&_tbMenu){ e.preventDefault(); e.stopPropagation(); closeTbMenu(); } }   // item 13: Esc dismisses the open Text-Only menu (like an outside-click)
function openTbMenu(x,y){ closeTbMenu(); _tbPass(true);   // item 3: make the native drag overlay click-through so the menu can open AT the cursor and still receive clicks
  const m=document.createElement("div"); m.className="fpmenu tbmodemenu"; _tbMenu=m;
  [["both","Icon and Text"],["icon","Icon Only"],["text","Text Only"]].forEach(([mode,label])=>{
    const it=document.createElement("button"); it.type="button"; it.className="fpitem";
    const ck=document.createElement("span"); ck.className="fpcheck"; ck.textContent=(TBMODE===mode)?"✓":""; it.appendChild(ck);
    const t=document.createElement("span"); t.textContent=label; it.appendChild(t);
    it.onclick=()=>{ closeTbMenu(); setTbMode(mode); };
    m.appendChild(it); });
  document.body.appendChild(m); localiseAccel(m);   // Windows: this popup is built fresh on every open, so the boot sweep never saw it (no accelerators today; the sweep is here so a row that grows one is localised for free)
  const mw=m.offsetWidth, mh=m.offsetHeight;
  m.style.left=Math.max(6,Math.min(x,innerWidth-mw-8))+"px"; m.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-mh-8))+"px";   /* item 3: open AT the cursor (only clamped to the viewport) — the drag overlay is click-through while the menu is open, so a row under the titlebar is still clickable. The floor is menuTopBound, not 6: the app's own titlebar is web content a menu paints over, but the NATIVE tab bar is not (js/core/scroll.js) */
  setTimeout(()=>document.addEventListener("mousedown",_tbOutside,true),0);
  document.addEventListener("keydown",_tbKey,true);
}
(function(){ const tb=document.querySelector(".titlebar"); if(!tb)return;
  tb.addEventListener("contextmenu",e=>{ if(e.target.closest("#tbFile")||e.target.closest("button,select,a,input"))return;   // let the filename + controls keep their own menus
    e.preventDefault(); openTbMenu(e.clientX,e.clientY); });
})();
window.__tbContextMenu=openTbMenu;   // the native drag overlay forwards its right-clicks here (empty titlebar gaps)
/* fix 9: Text-Only titlebar — each group's single label opens a menu listing that pill's options (or, for a
   single-button group, acts directly). Reuses the .fpmenu popup machinery (closeTbMenu / _tbOutside / _tbMenu). */
function _tbGroupIsMenu(pill){ if(pill.classList.contains("tbmodel")||pill.classList.contains("tbzoom")) return true;
  return pill.querySelectorAll(".tbtn").length>1; }
function _sfMask(el){ const s=el&&el.querySelector(".sfi"); return s?s.style.getPropertyValue("--m"):""; }   // item 2: the toolbar button's own SF-Symbol / Lucide-view mask (e.g. var(--sf-undo), var(--sf-nstemma)), reused as the menu row's leading icon
// item 14: the five notations' keyboard shortcuts, exactly as bound in the native View menu (app/menu_spec.py,
// "the five diagram notations, bound to ⌘1–⌘5") — hardcoded here rather than read off the menu spec because
// nothing currently pipes that Python table into the web layer; a literal five-entry map is the whole surface
// there is to keep in sync if a binding ever moves. Plain macOS glyphs: openTbGroupMenu's own localiseAccel(m)
// call already sweeps .fpkbd spans for Windows, so this map never has to know about Ctrl+ notation itself.
const NOTATION_ACCEL={stemma:"⌘1", tree:"⌘2", arcs:"⌘3", brackets:"⌘4", outline:"⌘5"};
function _tbGroupItems(pill){
  if(pill.classList.contains("tbmodel")){ const sel=pill.querySelector("#modelSel"), items=[];
    if(sel) Array.from(sel.options).forEach(o=>items.push({label:o.textContent, checked:o.value===sel.value, action:()=>{ sel.value=o.value; sel.dispatchEvent(new Event("change")); }}));
    const mng=pill.querySelector("#btnModels"); if(mng){ items.push({sep:true}); items.push({label:"Manage Parser Models…", icon:_sfMask(mng), action:()=>mng.click()}); }
    return items; }
  if(pill.classList.contains("tbzoom")){ const zb=id=>document.getElementById(id); return [   // order matches the physical pill's left-to-right layout (− / actual-size / +): Zoom Out, Actual Size, Zoom In
    {label:"Zoom Out", icon:_sfMask(zb("fsDown")), action:()=>zb("fsDown").click()},
    {label:"Actual Size", icon:_sfMask(zb("fsReset")), action:()=>zb("fsReset").click()},
    {label:"Zoom In", icon:_sfMask(zb("fsUp")), action:()=>zb("fsUp").click()} ]; }
  return Array.from(pill.querySelectorAll(".tbtn")).map(btn=>({
    label:((btn.querySelector(".tblabel")||{}).textContent)||btn.getAttribute("title")||"", icon:_sfMask(btn),
    checked:btn.classList.contains("active"), disabled:btn.disabled, kbd:NOTATION_ACCEL[btn.dataset.notation]||"",
    action:()=>btn.click() })); }   // kbd is "" for every non-notation pill (no dataset.notation → the lookup misses), so this is a no-op there
function openTbGroupMenu(items,x,y){ closeTbMenu(); _tbPass(true);   // item 3: click-through drag overlay so the menu opens at the label and its rows stay clickable
  const m=document.createElement("div"); m.className="fpmenu tbmodemenu tbgroupmenu"; _tbMenu=m;
  if(!items.some(it=>it&&it.checked)) m.classList.add("tb-nochk");   // item 4: no checked row → collapse the leading checkmark gutter (no dead left margin)
  items.forEach(it=>{ if(it.sep){ const s=document.createElement("div"); s.className="fpsep"; m.appendChild(s); return; }
    const b=document.createElement("button"); b.type="button"; b.className="fpitem";
    const ck=document.createElement("span"); ck.className="fpcheck"; ck.textContent=it.checked?"✓":""; b.appendChild(ck);
    if(it.icon){ const ic=document.createElement("span"); ic.className="sfi"; ic.style.setProperty("--m",it.icon); b.appendChild(ic); }   // item 2: leading icon = the source toolbar button's mask (SF Symbol, or the Lucide view glyph for stemma/arcs/tree/brackets/outline)
    const t=document.createElement("span"); t.className="fplabel"; t.textContent=it.label; b.appendChild(t);   // item 14: .fplabel (not a bare span) so it flex-grows and pushes a trailing .fpkbd to the row's far edge, like a real NSMenu shortcut column
    if(it.kbd){ const k=document.createElement("span"); k.className="fpkbd"; k.textContent=it.kbd; b.appendChild(k); }
    if(it.disabled){ b.disabled=true; b.style.opacity=".4"; } else b.onclick=()=>{ closeTbMenu(); it.action(); };
    m.appendChild(b); });
  document.body.appendChild(m); localiseAccel(m);   // Windows: _tbGroupItems falls back to a button's `title=` for its label ("Zoom out (⌘−)") — already swept at boot, but a row's own tooltip is built here, so sweep the finished menu too
  const mw=m.offsetWidth, mh=m.offsetHeight;
  m.style.left=Math.max(6,Math.min(x,innerWidth-mw-8))+"px"; m.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-mh-8))+"px";   /* item 3: open at the label anchor (only clamped to the viewport) — the drag overlay is click-through while the menu is open, so rows under the titlebar stay clickable; the native tab bar is the exception, see menuTopBound */
  setTimeout(()=>document.addEventListener("mousedown",_tbOutside,true),0);
  document.addEventListener("keydown",_tbKey,true); }
(function(){ document.querySelectorAll(".titlebar .tbgroup .pilllabel").forEach(label=>{
  label.addEventListener("click",e=>{ if(TBMODE!=="text")return;   // only interactive in Text Only
    e.preventDefault(); e.stopPropagation();
    const pill=label.parentElement.querySelector(".tbpill"); if(!pill)return;
    if(_tbGroupIsMenu(pill)){ const r=label.getBoundingClientRect(); openTbGroupMenu(_tbGroupItems(pill), r.left, r.bottom+4); }
    else{ const btn=pill.querySelector(".tbtn"); if(btn) btn.click(); } }); }); })();
document.getElementById("modelSel").onchange=e=>{ model=e.target.value; const label=model?(MODELINFO[model]||model):"";
  setLang(modelLang(model));   // language follows the model → updates the status pill and RTL
  toast(model?`Model: ${label} · ${langName(DOCLANG)||"?"}`:"Manual annotation · whitespace tokeniser");
  if(DOC.length) preserveScroll(renderDoc);   // re-lay-out in case the language flipped LTR/RTL
  if(show.translit) fillTranslit(); syncMenu(); refreshModelFeatsInventory(); };   // async, fire-and-forget — the FEATS-value/gloss menus just fall back to the UD-wide table until it resolves
// — status-bar language picker: the language indicator always opens a searchable list of every ISO 639-3
//   language (name + 2-/3-letter codes). Filters by name OR either code; ↑/↓ + Enter, or click. Selecting a
//   language sets DOCLANG (via applyLang) and auto-switches the parser model to match it (or None).
let _langMenu=null,_lmInput=null,_lmList=null,_lmItems=[],_lmIdx=-1;
const LM_MAX=400;   // cap rendered rows over the ~7900-language table; a note invites narrowing the search
function lmEl(){ if(_langMenu)return _langMenu;
  const m=document.createElement("div"); m.className="langmenu";
  const inp=document.createElement("input"); inp.className="lmsearch"; inp.type="search"; inp.spellcheck=false;
  inp.placeholder="Search languages or codes…"; inp.setAttribute("aria-label","Search languages");
  const list=document.createElement("div"); list.className="lmlist";
  m.appendChild(list); m.appendChild(inp); document.body.appendChild(m);   // list, then the search field at the BOTTOM (nearest the pill, since the menu opens upward); clearing is done via the ✕ on the status-bar pill
  m.addEventListener("mousedown",e=>{ if(e.target!==inp)e.preventDefault(); });   // clicking a row must not blur the search field first
  inp.addEventListener("input",()=>lmFilter(inp.value));
  inp.addEventListener("keydown",ev=>{ ev.stopPropagation();   // keep keys off the global shortcut handlers while typing
    if(ev.key==="ArrowDown"){ ev.preventDefault(); lmHi(Math.min(_lmIdx+1,_lmItems.length-1)); }
    else if(ev.key==="ArrowUp"){ ev.preventDefault(); lmHi(Math.max(_lmIdx-1,0)); }
    else if(ev.key==="Enter"){ ev.preventDefault(); const it=_lmItems[_lmIdx<0?0:_lmIdx]; if(it)lmPick(it); }
    else if(ev.key==="Escape"){ ev.preventDefault(); lmClose(); } });
  _langMenu=m; _lmInput=inp; _lmList=list; return m; }
let _lmSub=null;   // hidden-from-picker codes (ISO 639-3 macrolanguage members Glottolog rates a dialect); built once
function lmSub(){ if(!_lmSub)_lmSub=new Set((window.ISO639_3_SUB||"").split(/\s+/).filter(Boolean)); return _lmSub; }
function lmFilter(q){ q=(q||"").trim().toLowerCase(); const SUB=lmSub();
  const all=(window.ISO639_3||[]).filter(e=>!(SUB.has(e[0])&&!e[1]))   // hide a Glottolog-dialect sub-language UNLESS it has its own 2-letter ISO 639-1 code (keeps Serbian/Croatian/Bosnian/Bokmål/Nynorsk/Twi)
    .sort((a,b)=>(langName(a[1]||a[0])||a[1]||a[0]).localeCompare(langName(b[1]||b[0])||b[1]||b[0]));   // item 7: sort the whole table by display name (ascending) so both the no-query list and the prefix/substring groups below come out alphabetised by language name
  let ms;
  if(!q){ ms=all;
    if(DOCLANG){ const ci=all.findIndex(e=>(e[1]||e[0])===DOCLANG); if(ci>0) ms=[all[ci], ...all.slice(0,ci), ...all.slice(ci+1)]; }   // item 16: on open (no query) the current language goes FIRST → it renders at the top (was beyond the LM_MAX render cap, so the old scroll-to-.cur never found a row)
  }
  else { const pre=[],sub=[];   // whole-name prefix / code-exact matches first, then any LATER word of the name — the two are still ranked, the second tier is just no longer a substring sweep
    const wp=wordPrefixRe(q);   // built ONCE per keystroke rather than per row (wordPrefix would recompile it ~7,900 times a keystroke, the length of the ISO 639-3 table)
    for(const e of all){ const name=(glotName(e[0])||e[2]).toLowerCase();   // item 22: search matches the Glottolog name where it overrides the ISO name
      if(e[0]===q||e[1]===q||name.startsWith(q)) pre.push(e);   // exact 3-letter OR 2-letter code, or a prefix of the WHOLE name — the strongest match, so it leads
      else if(wp.test(name)||e[0].startsWith(q)||(e[1]&&e[1].startsWith(q))) sub.push(e); }   // item: WORD PREFIX, not substring (see wordPrefixRe, js/core/state.js) — "eng" finds "Middle English" but no longer every name with "eng" buried inside a word. The two CODE tests move from .includes to .startsWith for the same reason: a code is a single word, so a substring hit in the middle of one ("ng" finding "eng") is the very thing being removed
    ms=pre.concat(sub); }
  lmRender(ms); }
function lmRender(ms){ _lmItems=ms.slice(0,LM_MAX); _lmIdx=-1; const list=_lmList; list.innerHTML="";
  if(!ms.length){ const d=document.createElement("div"); d.className="lmnote"; d.textContent="No matching language."; list.appendChild(d); return; }
  _lmItems.forEach((e,k)=>{ const b=document.createElement("button"); b.type="button"; b.className="lmrow";
    const cur=(e[1]||e[0])===DOCLANG; if(cur)b.classList.add("cur");   // .cur → scroll it to the top on open
    const ck=document.createElement("span"); ck.className="ck"; ck.textContent=cur?"✓":""; b.appendChild(ck);   // item 13: ALWAYS render the fixed-width ✓ gutter (empty when unchecked) so every row's name starts at the same x
    const nm=document.createElement("span"); nm.className="lmname"; nm.textContent=glotName(e[0])||e[2];   // item 22: prefer the Glottolog name; textContent → names with quotes/specials can't inject markup
    const cd=document.createElement("span"); cd.className="lmcode"; cd.textContent=e[1]?e[1]+" · "+e[0]:e[0];   // show the 2-letter code alongside the 3-letter where one exists
    b.appendChild(nm); b.appendChild(cd);
    b.addEventListener("click",()=>lmPick(e)); b.addEventListener("mouseenter",()=>lmHi(k,true)); list.appendChild(b); });   // hover highlights without scrolling (only keyboard nav scrolls) → no jump
  if(ms.length>LM_MAX){ const d=document.createElement("div"); d.className="lmnote"; d.textContent=(ms.length-LM_MAX)+" more — keep typing to narrow the list."; list.appendChild(d); }
  list.scrollTop=0; }
function lmHi(k,noScroll){ _lmIdx=k; const rows=_lmList.querySelectorAll(".lmrow"); rows.forEach((r,j)=>r.classList.toggle("hi",j===k));
  if(!noScroll&&k>=0&&rows[k])rows[k].scrollIntoView({block:"nearest"}); }
function lmPick(e){ lmClose(); const lang=e[1]||e[0];   // canonical UD code: 2-letter where the language has one, else the 3-letter code
  applyLang(lang,true); toast("Language: "+(glotName(e[0])||e[2])+" ("+lang+")"); }   // sets the language and auto-switches the model to match (or None)
/* THE STATUS-BAR CHEVRONS POINT AT WHAT THE CLICK WILL DO. Closed they point UP — the menus all open upward out
   of the bottom bar, so up is where the list is about to appear; open they point DOWN, at the bar the click will
   collapse them back into. The glyph itself never changes: the markup carries one chevron.down <svg> and the
   kits rotate it 180° at rest, un-rotating it on `.menuopen` (see .pillchev there), so there is one path to keep
   in step and the flip animates.
   A CLASS ON THE PILL, set by each menu's own open/close, rather than a CSS relationship: the menus are children
   of <body>, not siblings of their pills, so no selector can reach from one to the other. Called from all four —
   #tokInfo (here), #translitPill and #orthoPill (js/lang/translit.js) and #fmtPill (js/io/formats.js, plus
   closeCtx in js/editing/context-menu.js, which is where its menu can be closed from anywhere else). */
function setPillMenuOpen(pillId,open){ const p=document.getElementById(pillId); if(p)p.classList.toggle("menuopen",!!open); }
function lmClose(){ if(_langMenu)_langMenu.classList.remove("show"); setPillMenuOpen("tokInfo",false); }
function openLangMenu(x,y){ const m=lmEl(); _lmInput.value=""; lmFilter(""); m.classList.add("show"); setPillMenuOpen("tokInfo",true);
  if(typeof snapListRows==="function") snapListRows(_lmList,".lmrow");   // floor the list's height to whole rows before anything below measures the menu off it
  const w=m.offsetWidth,h=m.offsetHeight;   // the pill sits in the bottom status bar → open the menu upward, above it
  const left=Math.max(8,Math.min(x,innerWidth-w-8)); m.style.left=left+"px";
  /* …and the head room is measured from menuTopBound (js/core/scroll.js), not from 8: this menu opens
     UPWARD out of the status bar and is the tallest thing in the app, so in a tabbed window it is the
     one that runs into the native tab bar — which no z-index can put it in front of. Anchored by its
     bottom edge, moving it is not the remedy; capping its height is, and the list inside already
     scrolls. */
  const bound=(typeof menuTopBound==="function")?menuTopBound():8;
  if(y-h-6>=bound){ m.style.top=""; m.style.maxHeight=""; m.style.bottom=(innerHeight-(y-6))+"px"; }   // room above → anchor by the BOTTOM edge (6px over the pill) so the menu collapses toward the pill as results thin out, keeping the search field put
  else if(y-6-bound>=160){ m.style.top=""; m.style.bottom=(innerHeight-(y-6))+"px"; m.style.maxHeight=(y-6-bound)+"px"; }   // not enough for the WHOLE list but a usable band above the pill: keep the upward anchor and let the list scroll inside it
  else { m.style.bottom=""; m.style.maxHeight=""; m.style.top=Math.max(bound,Math.min(y+6,innerHeight-h-8))+"px"; }   // no usable room above → drop below, anchored by the top
  _lmInput.focus();
  // item 16: the current language is rendered FIRST (see lmFilter), so lmRender's list.scrollTop=0 already
  // seats it at the top; a double-rAF re-affirms it after the bottom-anchored menu's geometry settles.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(_lmList) _lmList.scrollTop=0; })); }
document.getElementById("tokInfo").addEventListener("click",e=>{ e.stopPropagation();   // the ✕ inside stops propagation so it clears without opening
  if(_langMenu&&_langMenu.classList.contains("show")){ lmClose(); return; }   // item: the TRIGGER TOGGLES, the same fix #translitPill and #orthoPill already carry (js/lang/translit.js) and for the same reason — the mousedown closer below deliberately exempts this pill, so the menu is still "show" by the time this click runs, and without this branch a second click just re-rendered the menu open and the pill read as dead
  const r=e.currentTarget.getBoundingClientRect(); openLangMenu(r.left,r.top); });
addEventListener("mousedown",e=>{ if(_langMenu&&_langMenu.classList.contains("show")&&!_langMenu.contains(e.target)&&!(e.target.closest&&e.target.closest("#tokInfo"))) lmClose(); },true);
addEventListener("resize",lmClose);

document.getElementById("btnModels").onclick=()=>manageModels();
document.getElementById("fmtPill").onclick=e=>{ e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); fmtMenu(r.left,Math.min(r.bottom+4,innerHeight-160)); };
function syncNotation(){ conv=notation==="stemma"?"stemma":notation; updateViewOptions(); if(typeof updateNotationPill==="function")updateNotationPill(); }
document.getElementById("convSel").onchange=e=>{ notation=e.target.value; syncNotation(); preserveScroll(renderDoc); savePrefs(); };
document.getElementById("toggles").addEventListener("change",e=>{ const cb=e.target.closest('input[type="checkbox"]'); if(!cb)return;
  if(cb.dataset.t2){ setTier(cb.dataset.t2==="gloss"?"gloss":"morph", cb.checked); return; }   // gloss / morphemic tiers: check → create+show; uncheck → delete (confirm only if it has data)
  if(cb.dataset.vis){ if(cb.dataset.vis==="gloss")GLOSS_VIS=cb.checked; else MORPH_VIS=cb.checked; preserveScroll(renderDoc); return; }   // item 3: Show/Hide visibility toggle for a present tier (does NOT delete its data)
  if(cb.id==="catNodesChk"){ stemmaCat=cb.checked; updateViewOptions(); preserveScroll(renderDoc); return; }   // item 7: stemma nodes = categories (checked) vs word forms (unchecked)
  if(cb.id==="projLinesChk"){ stemmaProj=cb.checked; updateViewOptions(); preserveScroll(renderDoc); return; }   // item 7: stemma projection lines
  const k=cb.dataset.t; if(!k)return;
  if(k==="arrows" && !arrowsOK()){cb.checked=false; return;}
  show[k]=cb.checked; updateViewOptions(); preserveScroll(renderDoc); savePrefs(); });   // (transliteration is no longer a checkbox — it is driven by the status-bar transliteration menu)
document.getElementById("gridsChk").addEventListener("change",e=>{ show.grids=e.target.checked; updateViewOptions(); preserveScroll(renderDoc); savePrefs(); });   // "Show grids" now lives outside #toggles (before the zoom controls)
document.getElementById("autonumChk").addEventListener("change",e=>{ AUTONUM=e.target.checked; });
/* ⚠ AN OPTIONS-BAR DROPDOWN NEEDS NO CLAMP OF ITS OWN, AND THE ONE IT BRIEFLY HAD IS THE REASON THE BAR
   MOVED. `.drawer-pop` is placed by CSS alone — `position:absolute; top:calc(100% + 6px)` in
   mac-chrome.css, `+ 4px` in fluent-chrome.css — so it is the one popup in the app that never went
   through menuTopBound (js/core/scroll.js). While the options bar sat ABOVE the native tab bar (an empty
   `set_titlebar_reserve` accessory of the bar's own height, with AppKit stacking its tab-bar accessory
   under ours) every pop hung DOWN from the bar straight through the tabs — invisible and unclickable
   rows, since an AppKit view in the theme frame is above the WKWebView entirely. `clampDrawerPop` pushed
   each pop's top past --tabH and did close that, but the CURE was reported worse than the disease:
   measured at a real tabbed geometry, all four pops then opened 57px below the button that opened them
   (6px untabbed), which reads as a menu belonging to nothing — "dropdowns open on the opposite side of
   the tab bar".
   So the bar itself moved below the tabs instead (macos-kit/mac-chrome.css's `.viewbar` top, which
   carries the full note), and with it there is nothing left to clamp: a pop opens from a bar that is
   already past every native view, so its own `calc(100% + 6px)` clears --tabH by construction — the pop's
   top is at least --tabH + the bar's height + 6, and menuTopBound() is exactly --tabH. Measured after:
   6px under the button in all four states (untabbed/tabbed × bar shown/hidden), inline `top` never set.
   The clamp is DELETED rather than left in as a guard, since a guard nothing can trigger is a claim about
   the geometry that no test can keep honest.
   ⚠ AND NOW EVEN THE TAB BAR ITSELF IS GONE (see the module-level note near the top of app/__main__.py),
   so the whole "clears --tabH by construction" argument above is moot rather than merely satisfied —
   there is no native view left for a pop to need clearing of at all. menuTopBound() is a bare 8 now, not
   --tabH; left as history rather than rewritten, since the geometry argument (a bar positioned past every
   native view needs no clamp) is still the right shape of reasoning for whatever comes next. */
document.getElementById("toggles").addEventListener("click",e=>{
  if(e.target.closest(".drawer-pop")&&!e.target.closest(".drawer-btn")) return;   // clicks inside an open pop (checkboxes, the translations list/search) don't toggle the drawer
  const btn=e.target.closest(".drawer-btn"); if(!btn)return;   // open/close a drawer
  const d=btn.parentElement, wasOpen=d.classList.contains("open");
  document.querySelectorAll("#toggles .drawer.open").forEach(x=>x.classList.remove("open"));
  if(!wasOpen){ d.classList.add("open"); syncGlossUI();
    /* A DRAWER THAT OPENS WITH A SEARCH FIELD PUTS THE CARET IN IT, on request for Translations — which is the
       only drawer that has one today, but written generically because the reason is generic: a drawer whose
       first control is a search box is a drawer you opened in order to search, and the status-bar language menu
       (openLangMenu) has always focused its own field on open for exactly that reason. The two are the same
       gesture and should not disagree. Guarded on there BEING such a field, so Show/Hide, Glossing and Colours —
       whose first control is a checkbox — are untouched and keep focus where it was. */
    const q=d.querySelector(".drawer-pop input.lmsearch");
    if(q) requestAnimationFrame(()=>q.focus()); } });   // NEXT FRAME, not this one: .drawer-pop is display:none until the `.open` class above takes effect, and focus() on a still-unrendered element is silently dropped — the class was added microseconds ago and the style recalc it needs has not necessarily run
/* An open drawer closes on any press outside it — including on a diagram token, which is the case that was
   missing, and which is missing for a reason worth recording because it is not obvious:
   A CLICK ON A DIAGRAM TOKEN OFTEN FIRES NO `click` EVENT AT ALL. The token's pointerdown selects it, which
   re-renders #doc; the element the press landed on is then detached, the release lands on its freshly-built
   replacement, and the browser emits no click because press and release had no common target. (This is the same
   rebuild that stops a native dblclick from firing on a token — see the double-tap note in js/diagram/diagram-edit.js.)
   So the close has to hang off POINTERDOWN, which is dispatched before any of that. Measured: with a click-based
   listener, a CDP press/release on a token produced zero capture-phase click events.
   CAPTURE phase, because several things inside #doc stop the event bubbling (the running sentence line, the grid
   cells, the inline editors) and a bubble-phase listener on window is starved by exactly the presses a reader
   makes most often. The `click` listener stays alongside it for presses that never happen — a keyboard-activated
   button emits a click with no pointerdown at all. Both are idempotent and inert for everything else: neither
   preventDefaults nor stops propagation, so the gesture still does whatever it was going to do. */
const closeDrawers=e=>{ if(e.target&&e.target.closest&&e.target.closest("#toggles"))return;
  document.querySelectorAll("#toggles .drawer.open").forEach(x=>x.classList.remove("open")); };
addEventListener("pointerdown",closeDrawers,true);
addEventListener("click",closeDrawers,true);
// item 12/13: "Edit mappings…" in the Glossing pop → close the drawer and open the mapping editor.
// Prefer the SEPARATE NATIVE WINDOW (open_glossmap_window) — matching Manage Models / Help; fall back to
// the in-page sheet only when there is no bridge (headless/browser design use).
document.getElementById("glossMapBtn").addEventListener("click",()=>{ document.querySelectorAll("#toggles .drawer.open").forEach(x=>x.classList.remove("open"));
  if(hasBridge()){ try{ window.pywebview.api.open_glossmap_window(); return; }catch(e){} }
  openSheet(sheetGlossMap()); });
/* ZOOMING KEEPS THE READING POSITION, and preserveScroll alone cannot give it.
   preserveScroll anchors on `curBlock()` — the FOCUSED block — and holds its offset from #doc's raw
   top. Both halves are wrong for a zoom. The focused block is deliberately not always the one on
   screen (a scroll moves the viewport without moving the selection — see the CURBLOCK note in
   js/core/prefs.js), and the raw top is not the usable top: the document scrolls UNDER the titlebar
   and options bar. So changing the zoom pinned whichever block happened to hold the focus and let
   everything else slide by however much its height had changed — measured on a block snapped flush
   to the top of the port: 502px below it at FS 1.4, and 349px ABOVE it at FS 0.8.
   withTopChrome (js/core/scroll.js) is exactly the right instrument and already exists for the
   neighbouring problem (the chrome getting taller under a reader): it captures the block nearest the
   USABLE port top and its offset from it, and puts that back afterwards. A snapped block has offset 0
   and stays at 0; a reader resting mid-block keeps their line.
   NO blockSnap() AFTERWARDS, though it looks like the obvious finish. It would be a no-op in the case
   it is meant for — the restore already lands the block within half a pixel, well inside the 1px floor
   blockSnap declines to act on — and actively wrong in the other one, newly snapping a reader who was
   resting mid-block and had not asked to move. What it does contribute is a SMOOTH scroll: an async
   glide that outlives the call and fights the next zoom press, which is how a run of ⌘+ presses ended
   up drifting during the fix's own measurement. The anchor restore is the whole remedy. */
function setFS(v){ const nv=Math.max(0.6,Math.min(2,Math.round(v*20)/20));
  /* ⚠ THE `--fs` WRITE IS INSIDE THE CAPTURE, and that is not a stylistic choice. `zoom` is a style
     change like any other, so the moment the property is set the next layout read reflows to the new
     scale — and captureTopAnchor reads rects. Setting FS first and capturing afterwards therefore
     measures the ALREADY-ZOOMED positions and restores the state it just captured: a perfect no-op,
     which is exactly what an earlier version of this fix did, silently, while looking correct. */
  const apply=()=>{ FS=nv; document.documentElement.style.setProperty("--fs",FS);
    updateZoomBtns();   // item 17: keep the zoom buttons' disabled state in sync
    preserveScroll(renderDoc); };   // fix 8: the "100%" readout was replaced by the actual-size icon button, so there is no text to update
  if(typeof withTopChrome==="function") withTopChrome(apply); else apply(); }
function updateZoomBtns(){   // item 17: disable a zoom button whenever pressing it would be idempotent — Zoom In at the 2.0 ceiling, Zoom Out at the 0.6 floor, Actual Size when already at 100%
  const u=document.getElementById("fsUp"),d=document.getElementById("fsDown"),r=document.getElementById("fsReset");
  if(u)u.disabled=FS>=2; if(d)d.disabled=FS<=0.6; if(r)r.disabled=Math.abs(FS-1)<1e-9; }
document.getElementById("fsDown").onclick=()=>setFS(FS-0.1);
document.getElementById("fsUp").onclick=()=>setFS(FS+0.1);
document.getElementById("fsReset").onclick=()=>setFS(1);   // fix 8: centre button = "Display at actual size" (⌘0)
updateZoomBtns();   // item 17: initial state (FS starts at 1 → Actual Size disabled)
function zoomIn(){ setFS(FS+0.1); } function zoomOut(){ setFS(FS-0.1); } function zoomReset(){ setFS(1); }   // View menu drives the same per-block font size
// fix 5/14: Preview-style toolbar button that shows/hides the options bar (.viewbar). Default = HIDDEN → button UNSELECTED.
function toggleOptionsBar(){ const vb=document.querySelector(".viewbar"), btn=document.getElementById("btnOptions"); if(!vb)return;
  /* THE READING POSITION SURVIVES THE BAR, and withTopChrome (js/core/scroll.js) is the instrument
     written for precisely this: the bar makes the port shorter FROM THE TOP, so the content point the
     reader was looking at ends up that many pixels above it — behind the bar — while preserveScroll,
     which anchors on the FOCUSED block's offset from #doc's raw top, cannot see the difference. The
     whole mutation goes inside the capture, `--vbH` write and re-render together: the capture has to
     read the port as it was BEFORE syncChrome moves it, exactly as the zoom path has to capture before
     `--fs` reflows. Same helper, same reason, and it now re-finds its block by index, so it survives
     the renderDoc in the middle (it did not, and silently did nothing, until that was fixed). */
  const apply=()=>{
    const hidden=vb.classList.toggle("hidden");
    if(btn){ btn.classList.toggle("active",!hidden); btn.setAttribute("aria-pressed",String(!hidden)); btn.title=hidden?"Show the options bar":"Hide the options bar"; }
    syncChrome();   // fix 3: recompute the doc top-padding for the now shown/hidden options bar
    if(hasBridge()){ try{ window.pywebview.api.options_bar_state(!hidden); }catch(e){} }   // …and every other tab follows: the options bar is app-wide (Api.options_bar_state)
    // Item 1: showing/hiding the options bar changed --vbH → the doc's top padding → the VISIBLE viewport height. The
    // per-block height cap is computed only inside renderDoc from that visible height, so re-render to re-tighten it —
    // otherwise a block sized to the taller/shorter old viewport overflows (bar shown) or wastes room (bar hidden).
    preserveScroll(renderDoc); };
  if(typeof withTopChrome==="function") withTopChrome(apply); else apply(); }
document.getElementById("btnOptions").addEventListener("click",toggleOptionsBar);
// …the same change arriving FROM another window. Everything toggleOptionsBar does except the
// broadcast — which is what stops two windows from telling each other about it forever — and a no-op
// when this window already agrees, so a round of broadcasts settles immediately.
window.__setOptionsBar=function(on){ const vb=document.querySelector(".viewbar"), btn=document.getElementById("btnOptions"); if(!vb)return;
  if(vb.classList.contains("hidden")!==!!on) return;   // already in the asked-for state
  vb.classList.toggle("hidden",!on);
  if(btn){ btn.classList.toggle("active",!!on); btn.setAttribute("aria-pressed",String(!!on)); btn.title=on?"Hide the options bar":"Show the options bar"; }
  syncChrome();
  if(typeof preserveScroll==="function"&&typeof renderDoc==="function") preserveScroll(renderDoc); };
// fix 3: keep the doc's top inset (--vbH/--tbH → .doc padding-top) and the options-bar's top edge synced to the
// DYNAMIC titlebar + options-bar heights, so the document scrolls UNDER the translucent bars and their
// backdrop-filter blurs the content through (previously the bars sat in flow over an opaque background → no blur).
let CHROME_H={tb:-1,vb:-1};   // last reported bar heights, so a no-op sync neither crosses the bridge nor re-caps
/* ⚠ AND NOTHING IS RESERVED IN THE NATIVE TITLE-BAR BAND ANY MORE. `reserveTitlebar(vbH)` used to sit at
   the end of this function and hand the options bar's height to Api.titlebar_reserve →
   set_titlebar_reserve, which put an empty accessory of that height into the band so AppKit would stack
   the window-tab bar UNDER it — the old order, toolbar / options bar / tabs / document. The bar now sits
   below the tabs (macos-kit/mac-chrome.css's `.viewbar` top), so the reservation had nothing left to buy
   and would have cost the bar's height twice: once as an empty native band above the tabs and again as
   the bar's real box below them. Deleted end to end — this call, the TB_RESERVED memo it was gated on,
   Api.titlebar_reserve and app/mac/shell.py's set_titlebar_reserve/_reserve.
   ⚠️ WHAT WENT WITH IT AND DID NOT NEED REPLACING: the reservation changed the native chrome's own
   height, so set_titlebar_reserve re-published --tabH (and re-capped the blocks) a beat later on every
   open and close. With no accessory the chrome does not move when the bar is toggled — --tabH is the same
   number open or closed — and this function already captures the anchor, writes --vbH and re-caps for
   exactly that toggle. One less bridge call per open, and one less 0.25s timer racing the reader.
   ⚠️ SUPERSEDED AGAIN, and further simplified rather than merely still true: window tabbing itself is gone
   now (see the module-level note near the top of app/__main__.py), so "the bar now sits below the tabs"
   is stale — it sits directly below the title bar, and --tabH does not exist to be the same number open
   or closed. */
function syncChrome(){
  const body=document.querySelector(".body"), tb=document.querySelector(".titlebar"), vb=document.querySelector(".viewbar");
  if(!body||!tb)return;
  // item 10: in full screen with the toolbar auto-collapsed, the bars are slid out of view and overlay the
  // doc when temporarily revealed — so treat them as 0-height here and the document reclaims their space.
  const collapsed=document.body.classList.contains("fs-chrome-hidden");
  const tbH=collapsed?0:(Math.round(tb.getBoundingClientRect().height)||44);
  const vbH=collapsed?0:((vb&&!vb.classList.contains("hidden"))?Math.round(vb.getBoundingClientRect().height):0);
  const moved=(tbH!==CHROME_H.tb||vbH!==CHROME_H.vb); CHROME_H.tb=tbH; CHROME_H.vb=vbH;
  // …captured BEFORE the properties below move .doc's padding, and only when something actually moved:
  // the port is about to change height FROM THE TOP, which slides the block being read up behind the
  // bars unless it is put back (js/core/scroll.js). syncChrome runs on every resize/reflow, so the
  // capture — one rect per block — is charged only to the toggles that really change the chrome.
  const anchor=(moved&&typeof captureTopAnchor==="function")?captureTopAnchor():null;
  body.style.setProperty("--tbH",tbH+"px");
  body.style.setProperty("--vbH",vbH+"px");
  // …and a chrome that changed height changed the VIEWPORT: every block's diagram/grid share is
  // measured against .doc's remaining height, and opening the options bar moves it with no re-render
  // to recompute the caps. rAF so the new padding is laid out before anything is measured.
  if(moved && typeof recapBlocks==="function") requestAnimationFrame(()=>{ recapBlocks();
    if(anchor && typeof restoreTopAnchor==="function") restoreTopAnchor(anchor); });   // …then put the reader back where they were, measured against the NEW inset
  fsCaptureLights();   // item 5: keep a fresh snapshot of the WINDOWED traffic-light metrics for the full-screen titlebar-padding restore (no-op while in full screen)
}
/* ── item 10: full-screen auto-hide of the toolbar (.titlebar) + options bar (.viewbar) ──────────────
   In native macOS full screen (green button) the app forwards enter/exit via window.__setFullscreen. When
   full screen AND the "always show toolbar" pref is OFF, we add body.fs-chrome-hidden — the CSS slides both
   bars up and syncChrome() zeroes --tbH/--vbH so the document uses the full height. Moving the pointer to the
   very top edge reveals them (body.fs-reveal, overlaying the doc); leaving the top zone re-hides them. */
let FS_ON=false;   // native full screen currently active
/* item 5 — full-screen titlebar padding. The titlebar's vertical padding comes from its
   min-height:calc(var(--lights-cy)*2), where --lights-cy/--lights-right are the native traffic-light metrics the
   Python titlebar shell measures and injects onto :root. Entering full screen makes macOS re-measure the (now
   hidden) traffic lights, so the shell writes a COLLAPSED --lights-cy — which is why a titlebar REVEALED in full
   screen looks cramped/flush, and why leaving full screen (the native toolbar is restored WITHOUT another resize,
   so the shrunken value is never re-measured) keeps the windowed titlebar cramped too. We snapshot the good
   WINDOWED metrics (fsCaptureLights, driven from syncChrome) and re-assert them across the full-screen transition
   (fsRestoreLights, immediate + after it settles), so the revealed titlebar keeps its normal vertical padding and
   exiting full screen restores it completely. */
var _fsLightsWin=null;   // {cy,right} last good WINDOWED traffic-light metrics (var → hoisted, no TDZ)
function fsCaptureLights(){
  if(FS_ON) return;   // only trust metrics measured while genuinely windowed — full screen mis-measures the hidden lights
  const rs=document.documentElement.style;
  const cy=rs.getPropertyValue("--lights-cy").trim(), right=rs.getPropertyValue("--lights-right").trim();
  if(cy && parseFloat(cy)>=15) _fsLightsWin={cy,right};   // plausibility floor rejects the collapsed full-screen value (windowed cy is ~22)
}
function fsRestoreLights(){
  if(!_fsLightsWin) return;
  const rs=document.documentElement.style;   // same inline :root properties the shell writes → last write (this one) wins over any mid-transition mis-measure
  if(_fsLightsWin.cy) rs.setProperty("--lights-cy",_fsLightsWin.cy);
  if(_fsLightsWin.right) rs.setProperty("--lights-right",_fsLightsWin.right);
}
function fsAlwaysToolbar(){ return !!PREFS.fsAlwaysToolbar; }
function fsSyncAndRender(){
  fsRestoreLights();   // item 5: re-pin the windowed traffic-light metrics so the titlebar keeps its vertical padding (revealed in full screen, and after exiting)
  syncChrome();   // --tbH/--vbH → 0 while collapsed, or the measured bar heights when visible
  if(typeof DOC!=="undefined" && DOC.length) preserveScroll(renderDoc);   // re-tighten the per-block height cap for the current viewport
}
let _fsChromeSettleT=null;
function fsApplyChrome(){
  // item 10 / bug 2: NEVER collapse while "Always Show Toolbar in Full Screen" is on — BOTH the titlebar and the
  // options bar must stay visible, so gate the whole collapse on the pref. When the pref is on we remove
  // fs-chrome-hidden entirely, so neither .titlebar nor .viewbar is slid out and the titlebar reappears at once.
  const collapse=FS_ON && !fsAlwaysToolbar();
  document.body.classList.toggle("fs-chrome-hidden",collapse);
  if(!collapse) document.body.classList.remove("fs-reveal");   // never leave a stale reveal when not collapsing
  fsSyncAndRender();   // immediate: zero/measure --tbH/--vbH and recompute the block cap now
  // bug 1: entering/leaving the collapse is an animated slide (.2s, see the fs-chrome-hidden transition) and the
  // native full-screen resize is still settling, so the heights/viewport measured above can be stale (the cap stays
  // too short → blocks don't grow to fill the reclaimed height). Recompute once more after the transition + resize
  // have settled so --tbH/--vbH and the block cap are final for the full-screen viewport.
  clearTimeout(_fsChromeSettleT); _fsChromeSettleT=setTimeout(fsSyncAndRender,260);
}
window.__setFullscreen=function(on){ FS_ON=!!on; document.body.classList.toggle("fs-on",!!on); fsApplyChrome(); };   // item 10: fs-on lets the titlebar reclaim the empty traffic-light gutter on the left (see body.fs-on .titlebar)
window.__toggleFsAlwaysToolbar=function(){ PREFS.fsAlwaysToolbar=!PREFS.fsAlwaysToolbar; savePrefs(); fsApplyChrome(); return !!PREFS.fsAlwaysToolbar; };
let _fsRevealT=null;
addEventListener("mousemove",e=>{
  if(!document.body.classList.contains("fs-chrome-hidden")) return;   // only while the bars are auto-hidden
  if(e.clientY<=4){ clearTimeout(_fsRevealT); _fsRevealT=null;
    // while collapsed --tbH is 0, so pin the revealed options bar below the revealed titlebar using its live height
    const tb=document.querySelector(".titlebar"); if(tb) document.body.style.setProperty("--fsRevealTbH",(Math.round(tb.getBoundingClientRect().height)||44)+"px");
    document.body.classList.add("fs-reveal"); }
  else if(e.clientY>72 && document.body.classList.contains("fs-reveal") && _fsRevealT===null){
    _fsRevealT=setTimeout(()=>{ document.body.classList.remove("fs-reveal"); _fsRevealT=null; },350);   // small delay when the pointer leaves the top zone
  }
});
try{
  if(typeof ResizeObserver!=="undefined"){
    const _cro=new ResizeObserver(()=>syncChrome());
    const _tb=document.querySelector(".titlebar"), _vb=document.querySelector(".viewbar");
    if(_tb)_cro.observe(_tb); if(_vb)_cro.observe(_vb);
  }
  addEventListener("resize",syncChrome);
  requestAnimationFrame(syncChrome); syncChrome();
}catch(_){}
// Item 1: a plain window resize changes the document viewport height, so the per-block height cap (computed in
// renderDoc from the visible viewport) goes stale and blocks can overflow. Re-render on resize, debounced, so block
// heights keep tracking the viewport. A SEPARATE listener from the trClose/syncChrome resize handlers above.
let _capRzT; addEventListener("resize",()=>{ clearTimeout(_capRzT); _capRzT=setTimeout(()=>preserveScroll(renderDoc),150); });
function toggleGrids(){ show.grids=!show.grids; updateViewOptions(); preserveScroll(renderDoc); toast(show.grids?"Annotation grids shown":"Annotation grids hidden"); }
window.toggleGrids=toggleGrids;
