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
function snap(){ return {doc:JSON.parse(JSON.stringify(DOC)), s:sel.s, t:sel.t, caret:captureCaret(), glossOn:GLOSS_ON, morphOn:MORPH_ON, stored:STORED_SCHEME}; }   // glossOn/morphOn → undo/redo restore the tier visibility (add-then-Undo removes the tier); stored → likewise the STORED transliteration scheme, whose change IS the doc-wide MISC Translit rewrite it triggers (see storedPick), so undoing that rewrite has to put the scheme back with it or the next annotation pass would just redo it
function commitSnap(pre){ if(!pre)return; UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); }   // push a snapshot taken BEFORE an operation that turned out to change something (the pattern for anything that can only tell afterwards whether it did)
function pushUndo(){ UNDO.push(snap()); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); }
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
  if(x.stored!==undefined && x.stored!==STORED_SCHEME){ STORED_SCHEME=x.stored; if(typeof updateStoredPill==="function")updateStoredPill(); }   // …and the stored transliteration scheme (undefined on a snapshot taken before this was captured — leave it alone then)
  preserveScroll(()=>{ DOC.length=0; x.doc.forEach(d=>DOC.push(d));
    DOC.forEach(d=>(d.mwt||[]).forEach(m=>{ m._kept=1; }));   // the snapshot restored each MWT's surface form along with its components — that form is AUTHORITATIVE, not a value to re-derive. _kept tells the opportunistic sandhi re-fuse (see the ortho fill in translit-load.js) to leave it alone, so undoing a re-fuse lands on exactly the form the document had before the edit instead of immediately recomputing it — and marking the file dirty again on its way out. A later component edit clears the tag and re-fuses normally (sandhiMwtForms).
    sel={s:x.s,t:x.t}; markDirty(); renderDoc(); if(sel.s>=0&&sel.s<DOC.length)pick(sel.s,sel.t,false); });   // keep the viewport steady across undo/redo
  if(x.caret) restoreCaret(x.caret); }   // …and put the FEATS/MISC pill caret back where it was (after the re-render + preserveScroll's own focus restore have run)
function undo(){ if(!UNDO.length)return toast("Nothing to undo"); REDO.push(snap()); applySnap(UNDO.pop()); updateUndoUI(); }
function redo(){ if(!REDO.length)return toast("Nothing to redo"); UNDO.push(snap()); applySnap(REDO.pop()); updateUndoUI(); }
function updateUndoUI(){ const u=document.getElementById("btnUndo"),r=document.getElementById("btnRedo"); if(u)u.disabled=!UNDO.length; if(r)r.disabled=!REDO.length;
  const g=u&&u.closest(".tbgroup"); if(g) g.classList.toggle("both-disabled", !UNDO.length&&!REDO.length); }   // item 16: mute the Edit group's label when BOTH Undo and Redo are inert (live-toggled as history changes)
function resetUndo(){ UNDO.length=0; REDO.length=0; pendingSnap=null; updateUndoUI(); }   // item 3: opening a NEW file drops the previous file's history so you can't undo across the open (and syncs the toolbar Undo/Redo enabled state)
document.getElementById("btnUndo").onclick=undo; document.getElementById("btnRedo").onclick=redo; updateUndoUI();
function deselectAll(){ sel={s:-1,t:0}; selRange=null; applySel(); document.querySelectorAll("#doc .sblock.sel-block").forEach(b=>b.classList.remove("sel-block")); syncMenu(); }
document.getElementById("doc").addEventListener("click",e=>{ if(e.target===e.currentTarget||e.target.classList.contains("addsent")) deselectAll(); });   // click below the last block → clear the block selection
// context-aware insert/delete: a token when a token is selected, else the whole sentence block
function insertAboveSel(){ if(sel.s<0)return; if(sel.t>0) insertToken(sel.s,sel.t-1); else insertAt(sel.s); }
function insertBelowSel(){ if(sel.s<0)return; if(sel.t>0) insertToken(sel.s,sel.t); else insertAt(sel.s+1); }
function deleteSel(){ if(sel.s<0)return; if(sel.t>0) deleteToken(sel.s,sel.t-1); else delSent(sel.s); }

