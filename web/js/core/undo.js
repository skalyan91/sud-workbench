//@module js/undo.js
/* undo / redo — snapshots of the whole document + selection */
let UNDO=[], REDO=[], pendingSnap=null;
/* capture / restore the text caret inside a FEATS/MISC pill field, so undo/redo of a pill edit returns the caret to its
   logical spot — recorded as the number of chips before it, which stays stable across the re-render that rebuilds the field */
function captureCaret(){ const s=window.getSelection(); if(!s||!s.rangeCount) return null;
  const r=s.getRangeAt(0), node=r.startContainer;
  const field=node.nodeType===1?(node.closest&&node.closest(".pillfield")):(node.parentNode&&node.parentNode.closest&&node.parentNode.closest(".pillfield"));
  if(!field||!field.dataset||field.dataset.col==null) return null;
  let chips=0;
  if(node===field){ for(let j=0;j<r.startOffset;j++){ const ch=field.childNodes[j]; if(ch&&ch.nodeType===1&&ch.classList&&ch.classList.contains("fpill")) chips++; } }
  else { let top=node; while(top&&top.parentNode!==field) top=top.parentNode; if(!top) return null;
    for(const ch of field.childNodes){ if(ch===top) break; if(ch.nodeType===1&&ch.classList&&ch.classList.contains("fpill")) chips++; } }
  return {si:field.dataset.si, ti:field.dataset.ti, col:field.dataset.col, chips}; }
function restoreCaret(c){ if(!c) return false;
  const field=document.querySelector(`.pillfield[data-si="${c.si}"][data-ti="${c.ti}"][data-col="${c.col}"]`); if(!field) return false;
  const chips=[...field.childNodes].filter(n=>n.nodeType===1&&n.classList&&n.classList.contains("fpill")), n=Math.max(0,Math.min(c.chips,chips.length));
  let tn=null;
  if(n===0) tn=[...field.childNodes].find(x=>x.nodeType===3);   // before the first chip → the leading anchor
  else { let x=chips[n-1].nextSibling; while(x&&x.nodeType!==3) x=x.nextSibling;   // the anchor just after the nth chip
    if(!x){ x=chips[n-1].previousSibling; while(x&&x.nodeType!==3) x=x.previousSibling; } tn=x; }
  try{ const range=document.createRange();
    if(tn) range.setStart(tn, tn.data.length); else { range.selectNodeContents(field); range.collapse(false); }
    range.collapse(true); const s=window.getSelection(); s.removeAllRanges(); s.addRange(range); field.focus(); }
  catch(_){ try{field.focus();}catch(__){} } return true; }
/* transLangs: the ENABLED TRANSLATION LANGUAGES ride in the snapshot for the same reason glossOn/morphOn do —
   toggling one is an edit to the document, and it is one that can leave NO trace in DOC at all. Enabling a
   language with no text typed writes nothing but empty rows (renderBlockTrans seeds `{lang,text:""}` as it
   draws), so restoring DOC alone put every field back and left the language still switched on: undo appeared to
   do nothing. With the set captured here, undoing an ADD is exactly a REMOVE, and undoing a REMOVE brings the
   language back along with the `# text_LANG` values DOC already carried. The dirty flag needs no special
   handling and deliberately gets none — markDirty() derives DIRTY from UNDO.length (js/io/bridge.js), so popping
   the entry is what returns a document that was clean before the toggle to clean, with no second mechanism to
   keep in step. Captured on the per-sentence snapshot too: a token edit never changes the set, so restoring it
   there is a no-op, but it keeps the two snapshot kinds interchangeable when the two are interleaved. */
function snap(){ const str=JSON.stringify(DOC);   // stringify ONCE and keep its length: the clone has to be built from a string anyway, so the size measure histPush budgets against is free (see UNDO_BUDGET)
  return {doc:JSON.parse(str), bytes:str.length, s:sel.s, t:sel.t, caret:captureCaret(), glossOn:GLOSS_ON, morphOn:MORPH_ON, stored:STORED_SCHEME, transLangs:[...TRANS_LANGS]}; }   // WHOLE-DOCUMENT snapshot — glossOn/morphOn → undo/redo restore the tier visibility (add-then-Undo removes the tier); stored → likewise the STORED transliteration scheme, whose change IS the doc-wide MISC Translit rewrite it triggers (see storedPick), so undoing that rewrite has to put the scheme back with it or the next annotation pass would just redo it.
  // The fallback for anything that changes DOC's own length or order (insert/delete/move a SENTENCE — doInsert/
  // delSent/moveSent in edit-ops.js — plus a whole-document conversion and Find & Replace's Replace All), where a
  // single sentence's worth of undo doesn't cover what changed. Every other mutator (any edit WITHIN one sentence
  // — a field, a token insert/delete/reorder, an MWT regroup, a boundary marker, …) calls snapSent() instead: at
  // 20,000 sentences, JSON-cloning the WHOLE array on every keystroke — which this used to be the only option for
  // — costs a few hundred ms of string allocation per edit, no matter how small the edit; cloning one sentence
  // object is O(that sentence), independent of document size.
function snapSent(si){
  if(typeof invalidateDiaSentence==="function") invalidateDiaSentence(si);   // js/core/document.js's notation-switch diagram cache: THE per-sentence "about to change" signal, chosen over touchColW(si,si+1) (js/grid/grid.js) because every caller that has one — pushUndo(si), and grid.js's own pendingSnap=snapSent(si) armed on a cell's focus — reaches THIS function first, whereas touchColW is only called from a subset of them (see the cache's own note in document.js for the specific gap this closes: a drag-to-reparent calls pushUndo(si) but not touchColW, because a stale COLUMN WIDTH afterwards is cosmetic slop and a stale DIAGRAM is not)
  const str=JSON.stringify(DOC[si]);
  return {kind:"sent", si, doc:JSON.parse(str), bytes:str.length, s:sel.s, t:sel.t, caret:captureCaret(), glossOn:GLOSS_ON, morphOn:MORPH_ON, stored:STORED_SCHEME, transLangs:[...TRANS_LANGS]}; }   // transLangs: see snap()'s note — a no-op for a token edit, captured so the two snapshot kinds stay interchangeable
/* ── HOW BIG THE HISTORY IS ALLOWED TO GET, and why it is a byte budget rather than an entry count ─────────────
   MEASURED, on a 2,000-sentence / 24,000-token document: the page sits at 8 MB of JS heap with an empty history,
   and 80 whole-document snapshots take it to 190 MB — about 2.3 MB each, since snap() deep-clones the entire DOC.
   That is the "insert a lot of text and the app slows to a crawl, but reopening the file fixes it" report exactly:
   reopening calls resetUndo(), and the heap went straight back to 8 MB. A plain 80-ENTRY cap cannot bound this,
   because what an entry costs depends entirely on the document it was taken from — 80 is nothing on a 20-sentence
   file and most of a gigabyte on a 20,000-sentence one.
   So the cap is on total retained SIZE. `bytes` is the JSON length snap()/snapSent() already had to compute, and
   it tracks heap closely enough for this purpose (the 2.3 MB/snapshot above is ~the same as that document's JSON
   length). At this budget a small document still keeps a deep history and a huge one keeps a shallow one, which
   is the right way round: the bigger the document, the more each step costs to hold and the less of it fits.
   ONE ENTRY IS ALWAYS KEPT, however big — undo must never become a no-op just because the document is large. */
const UNDO_BUDGET=32*1024*1024;   // chars of snapshot JSON retained per stack (~32 MB of heap, measured as above)
function histBytes(stack){ let n=0; for(const x of stack) n+=x.bytes||0; return n; }
function histPush(stack,x){ stack.push(x);
  while(stack.length>1 && histBytes(stack)>UNDO_BUDGET) stack.shift(); }   // drop the OLDEST first — the far end of the history is the least likely to be wanted
/* ── ONE UNDO ENTRY FOR ONE OPERATION, however many sentences it touches ──────────────────────────────────────
   Inserting a text runs doInsert once PER SENTENCE, and doInsert pushes its own whole-document snapshot — so
   pasting 80 sentences used to cost 80 full clones (≈2 s of JSON work and ~190 MB on the document measured
   above) and left the user pressing ⌘Z once per sentence to take the paste back. A batch takes ONE snapshot up
   front and makes every pushUndo/commitSnap inside it a no-op, so the whole insert undoes in one press and costs
   one clone. Nested with a DEPTH COUNTER, not a boolean, so an outer batch (the Insert-text sheet's whole
   payload: main text + parallel translations) can safely contain an inner one (__insertPastedText's own loop)
   and only the outermost takes the snapshot. Callers MUST use try/finally — an exception between begin and end
   would otherwise leave the counter raised and silently swallow every later edit's undo entry. */
let UNDO_BATCH=0;
function beginUndoBatch(si){ if(UNDO_BATCH===0) pushUndo(si); UNDO_BATCH++; }
function endUndoBatch(){ if(UNDO_BATCH>0) UNDO_BATCH--; }
function commitSnap(pre){ if(!pre)return; if(UNDO_BATCH>0)return;   // inside a batch the single opening snapshot already covers this
  histPush(UNDO,pre); REDO.length=0; updateUndoUI(); }   // push a snapshot taken BEFORE an operation that turned out to change something (the pattern for anything that can only tell afterwards whether it did)
// si given (and a real sentence) → scope the snapshot to just that sentence (snapSent); omitted → the old
// whole-document snap(), for a caller that changes DOC's length/order or otherwise touches more than one
// sentence. Every edit-ops.js/grid.js mutator that only ever writes into ONE sentence passes its own si here.
function pushUndo(si){ if(UNDO_BATCH>0) return;   // inside a batch: the entry taken at beginUndoBatch covers the whole operation (see its note)
  const x=(si!=null && DOC[si]!==undefined) ? snapSent(si) : snap();
  histPush(UNDO,x); REDO.length=0; updateUndoUI(); }
/* REVERT AN OPERATION BY ITS OWN SNAPSHOT — for a command the user CANCELS partway through.
   Restoring the document by hand (clearing back whatever was written) leaves two marks behind: the undo entry
   the command pushed, which now describes a change that never stood, and the DIRTY flag, which markDirty derives
   from UNDO.length and so stays set on a document nobody changed. Both go if the entry itself is removed.
   Identified by IDENTITY, not position: an overlapping edit may have pushed on top, and popping blindly would
   throw away that edit instead. Not found (already undone, or shifted off the 80-entry cap) → do nothing. */
function revertEdit(ref){ if(!ref) return false;
  const i=UNDO.lastIndexOf(ref); if(i<0) return false;
  UNDO.splice(i,1); applySnap(ref); updateUndoUI(); markDirty(); return true; }
function applySnap(x){ GLOSS_ON=!!x.glossOn; MORPH_ON=!!x.morphOn; syncGlossUI();   // restore the glossing tiers before re-render
  /* …and the enabled translation languages, BEFORE the re-render below, since it is what decides how many
     translation fields each block draws. Guarded on the key being present so a snapshot taken before this was
     captured is left alone (same treatment as x.stored above), and the drawer is redrawn so its checkboxes
     agree with the set that is actually in force. */
  if(Array.isArray(x.transLangs)){ const now=[...TRANS_LANGS].sort().join(" "), then=[...x.transLangs].sort().join(" ");
    if(now!==then){ TRANS_LANGS=new Set(x.transLangs); if(typeof renderTransDrawer==="function") renderTransDrawer(); } }
  if(x.stored!==undefined && x.stored!==STORED_SCHEME){ STORED_SCHEME=x.stored; if(typeof updateStoredPill==="function")updateStoredPill(); }   // …and the stored transliteration scheme (undefined on a snapshot taken before this was captured — leave it alone then)
  const keepMwt=d=>(d.mwt||[]).forEach(m=>{ m._kept=1; });   // the snapshot restored each MWT's surface form along with its components — that form is AUTHORITATIVE, not a value to re-derive. _kept tells the opportunistic sandhi re-fuse (see the ortho fill in translit-load.js) to leave it alone, so undoing a re-fuse lands on exactly the form the document had before the edit instead of immediately recomputing it — and marking the file dirty again on its way out. A later component edit clears the tag and re-fuses normally (sandhiMwtForms).
  preserveScroll(()=>{
    if(x.kind==="sent"){   // scoped snapshot — restore ONLY the one sentence it cloned, by reference-swap; DOC's own length/order (and every OTHER sentence) is untouched, so nothing about this needs invalidateColW()'s full rescan either (js/grid/grid.js's window-scoped scan already re-measures whatever sentence is on screen, this one included, on the very next render)
      if(typeof invalidateDiaSentence==="function") invalidateDiaSentence(x.si);   // the reference swap below replaces DOC[x.si] wholesale — snapSent(si) already dropped the cache entry that stood at the moment of the ORIGINAL edit, but redo (or a second undo past it) reaches this swap with no snapSent of its own, so it must invalidate itself
      if(x.si>=0 && x.si<DOC.length){ DOC[x.si]=x.doc; keepMwt(DOC[x.si]); }
    } else {   // whole-document snapshot — see snap()'s own note on when this is the one taken
      if(typeof invalidateColW==="function") invalidateColW();   // replaces the WHOLE document below → the column-width cache can't be trusted to still describe it
      if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // same reasoning, for the notation-switch diagram cache (js/core/document.js) — every si below is about to name a possibly different sentence
      DOC.length=0; x.doc.forEach(d=>DOC.push(d));
      DOC.forEach(keepMwt);
    }
    sel={s:x.s,t:x.t}; markDirty(); renderDoc(); if(sel.s>=0&&sel.s<DOC.length)pick(sel.s,sel.t,false); });   // keep the viewport steady across undo/redo
  if(x.caret) restoreCaret(x.caret); }   // …and put the FEATS/MISC pill caret back where it was (after the re-render + preserveScroll's own focus restore have run)
function undo(){ if(!UNDO.length)return toast("Nothing to undo"); histPush(REDO,snap()); applySnap(UNDO.pop()); updateUndoUI(); }   // the REDO stack is budgeted exactly like UNDO — it holds the same whole-document snapshots and grows the same way
function redo(){ if(!REDO.length)return toast("Nothing to redo"); histPush(UNDO,snap()); applySnap(REDO.pop()); updateUndoUI(); }
function updateUndoUI(){ const u=document.getElementById("btnUndo"),r=document.getElementById("btnRedo"); if(u)u.disabled=!UNDO.length; if(r)r.disabled=!REDO.length;
  const g=u&&u.closest(".tbgroup"); if(g) g.classList.toggle("both-disabled", !UNDO.length&&!REDO.length); }   // item 16: mute the Edit group's label when BOTH Undo and Redo are inert (live-toggled as history changes)
function resetUndo(){ UNDO.length=0; REDO.length=0; pendingSnap=null; updateUndoUI();
  if(typeof invalidateColW==="function") invalidateColW();   // item 3: opening a NEW file drops the previous file's history so you can't undo across the open (and syncs the toolbar Undo/Redo enabled state) — and the previous file's column-width cache is equally meaningless against the one being opened (js/grid/grid.js)
  if(typeof invalidateDiaCache==="function") invalidateDiaCache(); }   // …and every si in it now names a sentence from whatever's being opened, not what was on screen a moment ago
document.getElementById("btnUndo").onclick=undo; document.getElementById("btnRedo").onclick=redo; updateUndoUI();
function deselectAll(){ sel={s:-1,t:0}; selRange=null; applySel(); document.querySelectorAll("#doc .sblock.sel-block").forEach(b=>b.classList.remove("sel-block")); syncMenu(); }
document.getElementById("doc").addEventListener("click",e=>{ if(e.target===e.currentTarget||e.target.classList.contains("addsent")) deselectAll(); });   // click below the last block → clear the block selection
// context-aware insert/delete: a token when a token is selected, else the whole sentence block
function insertAboveSel(){ if(sel.s<0)return; if(sel.t>0) insertToken(sel.s,sel.t-1); else insertAt(sel.s); }
function insertBelowSel(){ if(sel.s<0)return; if(sel.t>0) insertToken(sel.s,sel.t); else insertAt(sel.s+1); }
/* ⌘⌫ — and the SENTENCE half delegates rather than re-deciding.
   This used to call `delSent(sel.s)`, which deletes exactly ONE sentence and knows nothing about a
   shift-selected RANGE — so selecting five blocks and pressing the shortcut deleted one, and not even
   the focused one: `sel.s` is where the range STARTED (extendBlockRange moves CURBLOCK and leaves the
   token selection alone), so what went was the FIRST block of the five. That is a second, divergent
   implementation of a command that already exists: `window.deleteSent` (js/io/bridge.js) is what the
   native Delete Sentence menu item runs, and it reads blockRange(), raises the "Delete N sentences?"
   confirmation for a range, and falls back to `delSent(curBlock())` for a lone block. Two copies of
   one command drift, and these had; this keeps the token half (which is genuinely this function's
   own) and hands the sentence half to the one implementation.
   Guarded and looked up late: js/io/bridge.js loads after this module, and this only ever runs from a
   keystroke. `curBlock()` rather than `sel.s` for the single case comes with it, which is also the
   better answer — a viewport move changes the block being read without touching the selection. */
function deleteSel(){ if(sel.s<0)return;
  if(sel.t>0){ deleteToken(sel.s,sel.t-1); return; }
  if(typeof window.deleteSent==="function"){ window.deleteSent(); return; }
  delSent(sel.s); }

