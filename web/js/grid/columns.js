//@module js/columns.js
/* adjustable grid columns: drag a header border to resize (all grids share widths), double-click to auto-size */
let COLDRAG=null;
document.addEventListener("mousedown",e=>{ const h=e.target.closest(".colresize"); if(!h)return; e.preventDefault();
  const key=h.dataset.col, cur=key==="id"?(colOverride.id||idW):(colOverride[key]||colW[key]||60);
  const rtl=getComputedStyle(h).direction==="rtl";   // grip sits on the column's inline-end (left in RTL) → drag direction flips
  COLDRAG={key,startX:e.clientX,startW:cur,h,nw:cur,rtl}; h.classList.add("dragging"); document.body.style.cursor="col-resize"; });
document.addEventListener("mousemove",e=>{ if(!COLDRAG)return;
  const dx=(e.clientX-COLDRAG.startX)*(COLDRAG.rtl?-1:1);
  COLDRAG.nw=Math.max(28,Math.round(COLDRAG.startW+dx/FS));
  if(Math.abs(COLDRAG.nw-COLDRAG.startW)>2) COLDRAG.moved=true;   // real drag, not a click of a double-click
  document.querySelectorAll(`col[data-col="${COLDRAG.key}"]`).forEach(c=>c.style.width=COLDRAG.nw+"px"); });
document.addEventListener("mouseup",()=>{ if(!COLDRAG)return; const {key,nw,h,moved}=COLDRAG; h.classList.remove("dragging"); document.body.style.cursor=""; COLDRAG=null;
  if(moved){ colOverride[key]=nw; preserveScroll(renderDoc); } });   // only commit/re-render on a real drag → a double-click's clicks don't rebuild the DOM, so dblclick fires
document.addEventListener("dblclick",e=>{ const h=e.target.closest(".colresize"); if(!h)return; e.preventDefault(); delete colOverride[h.dataset.col]; preserveScroll(renderDoc); });

// next selectable token id (1-based) from `from` moving by dir (±1) in reading order. Folded punctuation is now a
// separate, selectable satellite (not skipped over), so every token — punctuation included — participates in
// keyboard navigation. Returns `from` unchanged at a sentence edge.
function adjTok(si,from,dir){ const n=DOC[si].tokens.length, t=from+dir; return (t<1||t>n)?from:t; }
/* item 6 — A KEYBOARD MOVE REVEALS THE TOKEN IN BOTH VIEWS. pick() reveals only the GRID row, and only
   vertically (its scrollNearest); the DIAGRAM has a scroller of its own (`.diagram` is overflow:auto,
   capped at --cap-dia) and an unwrapped one is routinely wider than its port, so arrow/Tab navigation
   used to walk the selection straight off the diagram's visible edge with nothing following it.
   revealTok (js/editing/context-menu.js) corrects both axes there, via revealEl (js/grid/grid.js).
   Used at every keyboard site below that MOVES the selected token; the two Shift-extend branches call
   revealTok on their own because they move the focus without going through pick() at all. */
function pickReveal(s,t){ pick(s,t); revealTok(s,t); }
addEventListener("keydown",e=>{
  // Task D — a focused INPUT/SELECT/TEXTAREA was always excluded here, but a contentEditable field (the MGloss
  // inline editor's .glabbrbox, js/editing/context-menu.js's makeGlossEditableSC; the grid's own FEATS/MISC
  // pillfield) is none of those tags, so this used to miss it — arrow keys typed into ONE of those fields also
  // moved the app's token selection underneath it, in addition to moving the text caret. Those fields already
  // stopPropagation() on their own keydowns (belt and braces — see makeGlossEditableSC's own note on the one
  // path that used to be missing it), so this check is defense in depth: whenever ANY field currently has
  // focus, arrow/Tab/Enter navigation here must stay out of it, full stop.
  const ae0=document.activeElement;
  const inField=ae0&&(/INPUT|SELECT|TEXTAREA/.test(ae0.tagName)||ae0.isContentEditable);
  // The ⌥⌘ family goes through cmdOptKey (js/core/platform.js) — Ctrl+Alt on Windows. Read that function's
  // note before adding a ⌃⌘ arrow handler here: the two families share one Windows chord.
  if(cmdOptKey(e)&&e.key==="ArrowUp"){ e.preventDefault(); insertAboveSel(); return; }   // ⌥⌘↑ insert above (token when a token is selected, else the sentence)
  if(cmdOptKey(e)&&e.key==="ArrowDown"){ e.preventDefault(); insertBelowSel(); return; }   // ⌥⌘↓ insert below
  if(cmdOptKey(e)&&(e.key==="ArrowLeft"||e.key==="ArrowRight")){ e.preventDefault();   // ⌥⌘←/→ insert a token before/after (reading-order, RTL-aware)
    if(sel.s<0||sel.t<=0)return; const after=(e.key==="ArrowRight")!==sentRTL(DOC[sel.s]); insertToken(sel.s, after?sel.t:sel.t-1); return; }
  if(cmdKey(e)&&(e.key==="Backspace"||e.key==="Delete")){ if(inField)return; e.preventDefault(); deleteSel(); return; }   // ⌘⌫ delete (token when a token is selected, else the sentence)
  /* ⇧⌘Arrow and ⌘A — EXTEND-TO-END and SELECT-ALL, at whichever level the selection already sits on.
     Shift+Arrow (further down) steps a range by one at BOTH levels — a token range inside a sentence when
     a token is selected, a sentence range when only a block is — so these are those same two levels
     reached in a single press, which is what ⇧⌘Arrow means everywhere else on the platform, and ⌘A is
     the same gesture with no direction: everything at this level. Escape drops a level (the ladder at the
     top of this handler), so ⌘A over a token selects that sentence's tokens and Escape-then-⌘A selects
     every sentence — both levels without a second chord to remember.
     ⌘A IS ALSO A NATIVE MENU ITEM (Select All, the nil-target selectAll: in app/menu_spec.py's
     NATIVE_MAC) and that row stays: it is what makes ⌘A select the text inside an input, which WebKit
     implements and this must not steal — hence the field guard, which is doing real work here rather than
     being defensive boilerplate. The web view gets first refusal on a key equivalent (the reason a web app
     can bind ⌘A at all under Safari's own Select All), so outside a field this branch is reached; and
     preventDefault is wanted there regardless, since WebKit's selectAll: would otherwise drag a text
     highlight across the whole document. */
  if(cmdKey(e)&&e.shiftKey&&!e.altKey&&(e.key==="ArrowUp"||e.key==="ArrowDown"||e.key==="ArrowLeft"||e.key==="ArrowRight")){
    const ae=document.activeElement; if(inField||(ae&&ae.isContentEditable)||sel.s<0) return;
    const vert=(e.key==="ArrowUp"||e.key==="ArrowDown");
    if(sel.t>0){   // token level → extend to the first/last token of THIS sentence, in READING order (⇧⌘→ is the last token of an RTL sentence's line, which is token 1)
      e.preventDefault(); const n=DOC[sel.s].tokens.length;
      const fwd = vert ? (e.key==="ArrowDown") : ((e.key==="ArrowRight")!==sentRTL(DOC[sel.s]));
      if(!selRange||selRange.s!==sel.s) setRange(sel.s,sel.t,sel.t);   // no range yet → the current token is the anchor, exactly as Shift+Arrow starts one
      const focus=fwd?n:1;
      setRange(sel.s,selRange.anchor,focus); sel.t=focus; preserveScroll(renderDoc); revealTok(sel.s,focus); return; }
    if(!vert) return;   // ←/→ have no sentence-level reading: blocks stack vertically, so leave the chord alone rather than inventing a meaning for it
    e.preventDefault();   // block level → extend the sentence range to the top/bottom of the document
    const nb=e.key==="ArrowDown"?DOC.length-1:0;
    extendBlockRange(nb); scrollNearest(document.querySelector(`.sblock[data-i="${nb}"]`)); return; }
  if(cmdKey(e)&&!e.shiftKey&&!e.altKey&&(e.key==="a"||e.key==="A")){
    const ae=document.activeElement; if(inField||(ae&&ae.isContentEditable)||!DOC.length) return;
    e.preventDefault();
    if(sel.s>=0&&sel.t>0){ const n=DOC[sel.s].tokens.length; setRange(sel.s,1,n); sel.t=n; preserveScroll(renderDoc); revealTok(sel.s,n); return; }
    selectAllBlocks(); return; }
  // items 2/3 — ⌘/ marks the selection Typo=Yes (strikethrough), ⌘I marks it Foreign=Yes (italics);
  // both toggle. ⇧⌘I opens "Import UD…". The native menu items carry the same key-equivalents and usually
  // intercept first — this is the in-page fallback (and covers a run with no native menu wired), guarded against typing in a field.
  if(cmdKey(e)&&e.shiftKey&&(e.key==="\""||e.key==="'")){   // item 7 — ⇧⌘' (the key legend is the apostrophe; ⇧ makes e.key a double quote on most layouts, so accept both)
    const ae0=document.activeElement; if(inField||(ae0&&ae0.isContentEditable)) return;
    e.preventDefault(); toggleReported(); return; }
  if(cmdKey(e)&&e.shiftKey&&(e.code==="KeyI"||e.key==="i"||e.key==="I")){   // ⇧⌘I → Import UD… (e.key is "I" once Shift is down, so accept the code and both cases)
    const ae=document.activeElement; if(inField||(ae&&ae.isContentEditable)) return;
    e.preventDefault(); doImportUD(); return; }
  if(cmdKey(e)&&!e.shiftKey&&(e.key==="i"||e.key==="/")){   // ⌘I → Foreign, ⌘/ → Typo
    const ae=document.activeElement; if(inField||(ae&&ae.isContentEditable)) return;
    e.preventDefault(); (e.key==="/"?toggleTypo:toggleForeign)(); return; }
  if(e.key==="Enter" && !inField && sel.t>0){ e.preventDefault(); revealTok(sel.s,sel.t); editNodeInline(sel.s, sel.t); return; }   // Enter on a selected token → edit it inline (falls back to the grid cell). Reveal FIRST: makeEditable measures the element on open and hides the field while it's scrolled out of its own .diagram (elClippedOut), so opening over an off-screen token would put up an invisible editor
  /* Escape = "cancel the narrowest thing that is open", innermost first. This is the LAST rung of that ladder —
     nothing is open, so Escape gives up the selection itself (deselect: the standard macOS reading of Escape in a
     document view, and the inverse of the click that made the selection). The rungs above it all own Escape in
     CAPTURE-phase listeners that stopPropagation() before this bubble-phase one is reached — a context-menu flyout,
     then its parent menu (js/editing/context-menu.js), an options drawer or status-bar menu (same file), a sheet,
     then a confirm alert stacked on it (js/ui/sheets.js), the titlebar/proxy/language menus (js/ui/wiring.js,
     js/io/bridge.js) — and every inline editor stops the event on its own field. So this runs ONLY when Escape is
     otherwise unclaimed; do not promote it to capture.
     preventDefault() is what stops the system BEEP: an Escape WebKit hands back unhandled becomes AppKit's
     cancelOperation:, which no responder implements, so NSBeep fires and the user hears the "invalid gesture"
     knock for a gesture that in fact did something. It is called only on the branches that DID something —
     Escape with nothing selected and nothing open really is a no-op, and macOS beeps at those on purpose. */
  if(e.key==="Escape"){ const ae=document.activeElement;   // ⌘F / ⌘G / ⇧⌘G / ⌘Z live on the native Edit menu
    if(ae&&(ae.classList.contains("cin")||ae.classList.contains("csel")||ae.classList.contains("sid-in"))){ e.preventDefault(); ae.blur(); return; }   // defocus the input but KEEP the row/node selected
    if(typeof blockRange==="function" && blockRange()){ e.preventDefault(); clearBlockRange(); return; }   // a shift-selected sentence range is narrower than the selection under it: give up the RANGE first, and only on a second press the selection itself
    if(selRange||sel.t>0){ e.preventDefault(); selRange=null; pick(sel.s,0,false,false); }   // a token is selected → deselect it (keep the block)
    else if(sel.s>=0){ e.preventDefault(); deselectAll(); }   // only the block is selected → clear the block too
    return; }
  if((e.key==="ArrowUp"||e.key==="ArrowDown") && !e.altKey && !e.metaKey && !e.ctrlKey){
    const ae=document.activeElement; if(ae && (/INPUT|SELECT|TEXTAREA/.test(ae.tagName)||ae.isContentEditable)) return;   // don't hijack while editing — Task D: isContentEditable too, not just the three form-control tags (see the top-of-handler note on inField)
    if(e.shiftKey && sel.t>0){   // Shift+Arrow → extend the grid multi-selection from the anchor
      e.preventDefault(); const nTok=DOC[sel.s].tokens.length;
      if(!selRange || selRange.s!==sel.s) setRange(sel.s, sel.t, sel.t);
      const focus=Math.max(1,Math.min(nTok, selRange.focus + (e.key==="ArrowDown"?1:-1)));
      setRange(sel.s, selRange.anchor, focus); sel.t=focus; preserveScroll(renderDoc);
      scrollNearest(document.querySelector(`#doc tr[data-s="${sel.s}"][data-tok="${focus}"]`)); revealTok(sel.s,focus); return; }   // item 6: …and the diagram's own cell, on both axes (this branch never reaches pick(), so it reveals for itself)
    if(selRange){   // plain Arrow on a multi-row selection → release it and collapse back to a single selection, moved by one
      e.preventDefault(); selRange=null; const nTok=DOC[sel.s].tokens.length;
      const nt=Math.max(1,Math.min(nTok, (sel.t||1) + (e.key==="ArrowDown"?1:-1)));
      pickReveal(sel.s,nt); return; }   // pick() already scrolls (scrollNearest) — the extra explicit scrollIntoView call here was redundant
    if(conv==="outline" && sel.t>0){   // navigate outline nodes
      e.preventDefault();
      const rows=[...document.querySelectorAll("#doc .oline")]; if(!rows.length) return;
      let idx=rows.findIndex(r=>+r.dataset.s===sel.s && +r.dataset.tok===sel.t);
      if(idx<0) idx = e.key==="ArrowDown" ? -1 : rows.length;
      const r=rows[e.key==="ArrowDown" ? Math.min(rows.length-1,idx+1) : Math.max(0,idx-1)];
      pickReveal(+r.dataset.s, +r.dataset.tok); return;
    }
    if(sel.t===0){   // a block (no token) is selected → move to the adjacent block
      e.preventDefault();
      /* SHIFT EXTENDS A SENTENCE RANGE rather than moving the block focus — the sentence-level twin of the
         Shift+Arrow token extension two branches above, and of shift-clicking a block (js/core/document.js).
         It steps from curBlock(), NOT sel.s: extendBlockRange moves the focus and leaves the token selection
         alone (the range's far end IS the focus — see js/core/prefs.js), so sel.s stays where the range
         started and stepping from it would extend to the same block on every press. */
      if(e.shiftKey && typeof extendBlockRange==="function"){
        const b=curBlock()>=0?curBlock():sel.s;
        const nb=e.key==="ArrowDown"?Math.min(DOC.length-1,b+1):Math.max(0,b-1);
        extendBlockRange(nb); scrollNearest(document.querySelector(`.sblock[data-i="${nb}"]`)); return; }
      const ns=e.key==="ArrowDown"?Math.min(DOC.length-1,sel.s+1):Math.max(0,sel.s-1);
      pick(ns,0,false,false); scrollNearest(document.querySelector(`.sblock[data-i="${ns}"]`)); return;
    }
  }
  if((e.key==="ArrowLeft"||e.key==="ArrowRight") && !e.altKey && !e.metaKey && !e.ctrlKey){   // ←/→ move to the adjacent token; Shift+←/→ extend the selection (reading-order, RTL-aware)
    if(inField || sel.s<0 || sel.t<=0) return; e.preventDefault();
    const s=DOC[sel.s], n=s.tokens.length, fwd=(e.key==="ArrowRight")!==sentRTL(s);
    if(e.shiftKey){ if(!selRange||selRange.s!==sel.s) setRange(sel.s,sel.t,sel.t);
      const focus=adjTok(sel.s, selRange.focus, fwd?1:-1); setRange(sel.s,selRange.anchor,focus); sel.t=focus; preserveScroll(renderDoc); revealTok(sel.s,focus); return; }   // item 6: reveal AFTER the re-render — the element the previous DOM held is detached by then, so revealTok has to re-resolve the token id (which it does)
    selRange=null; pickReveal(sel.s, adjTok(sel.s, (sel.t||1), fwd?1:-1)); return; }
  if(e.key==="Tab" && !e.altKey && !e.metaKey && !e.ctrlKey){   // Tab / ⇧Tab → next / previous token in reading order (RTL sentences included, since token ids ARE reading order); skips merged punctuation; hops to the adjacent sentence at an edge
    if(inField || sel.s<0) return;   // inside an input/pill → leave Tab to normal field behaviour
    e.preventDefault(); selRange=null; const dir=e.shiftKey?-1:1, n=DOC[sel.s].tokens.length;
    if(sel.t<=0){ pickReveal(sel.s, dir>0?adjTok(sel.s,0,1):adjTok(sel.s,n+1,-1)); return; }   // a block (no token) is selected → enter its first / last token
    const nt=adjTok(sel.s, sel.t, dir);
    if(nt!==sel.t){ pickReveal(sel.s, nt); return; }
    const ns=sel.s+dir;   // already at the sentence edge → move into the neighbouring sentence
    if(ns>=0 && ns<DOC.length){ const m=DOC[ns].tokens.length; pickReveal(ns, dir>0?adjTok(ns,0,1):adjTok(ns,m+1,-1)); }
    return; }
  if(e.altKey&&e.key==="ArrowUp"){e.preventDefault(); insertAt(sel.s);}
  else if(e.altKey&&e.key==="ArrowDown"){e.preventDefault(); insertAt(sel.s+1);}
});

// item 12: ⌘1–⌘5 switch the five diagram notations (stemma / tree / arcs / brackets / outline). The native
// View-menu items carry the same key-equivalents and usually intercept first; this handler is the in-page
// fallback (and covers the case where the native menu hasn't been wired). Guarded against typing in a field.
addEventListener("keydown",e=>{
  if(!cmdKey(e)) return;   // ⌘1–⌘5 / Ctrl+1–Ctrl+5 (cmdKey already excludes the Alt-bearing chords)
  const name={"1":"stemma","2":"tree","3":"arcs","4":"brackets","5":"outline"}[e.key];
  if(!name) return;
  const ae=document.activeElement;
  if(ae&&(/INPUT|SELECT|TEXTAREA/.test(ae.tagName)||ae.isContentEditable)) return;   // don't hijack while typing
  e.preventDefault(); setNotation(name);
});

