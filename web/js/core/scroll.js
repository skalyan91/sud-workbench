//@module js/scroll.js
/* when the focused block scrolls mostly out of view, hand focus to the block now dominating the viewport.
   This moves the CURRENT BLOCK only (setCurBlock — the focused-block tint, the "Sentence X of Y" subtitle, the
   re-render anchor, the sentence a whole-sentence command acts on). It used to call pick(blockIndex, 0), which
   also blanked sel.t: scrolling threw the selected token away, and with it the three-level subtree dimming the
   selection projects over its sentence — so a reader could not look up the page without losing their place in the
   tree. A viewport moving is not a selection changing; see the CURBLOCK note in js/core/prefs.js. */
function vis(rect,vp){ return Math.max(0,Math.min(rect.bottom,vp.bottom)-Math.max(rect.top,vp.top)); }
let topAbove={};   // block index → was its top edge above the viewport last tick
function maybeShiftFocus(up){ const docEl=document.getElementById("doc"), vp=docEl.getBoundingClientRect();
  const blocks=[...docEl.querySelectorAll(".sblock")];
  const entered=[]; blocks.forEach(b=>{ const rt=b.getBoundingClientRect().top, was=topAbove[b.dataset.i];
    if(up && was && rt>=vp.top-1 && rt<=vp.bottom) entered.push({b,rt});   // its top edge just crossed in from above
    topAbove[b.dataset.i]=rt<vp.top-1; });
  const cb=curBlock();
  if(blocks.length){                                   // at the very top/bottom, focus the first/last block
    if(docEl.scrollTop<=1){ const f=blocks[0]; if(+f.dataset.i!==cb) setCurBlock(+f.dataset.i); return; }
    if(docEl.scrollTop+docEl.clientHeight>=docEl.scrollHeight-1){ const l=blocks[blocks.length-1]; if(+l.dataset.i!==cb) setCurBlock(+l.dataset.i); return; } }
  if(up && entered.length){   // focus only on a genuine top-edge entry (no per-tick re-picking → no flicker)
    entered.sort((a,b)=>a.rt-b.rt); const cand=entered[0];   // the topmost block that just entered
    if(+cand.b.dataset.i!==cb){ setCurBlock(+cand.b.dataset.i); return; } }
  const cur=docEl.querySelector(`.sblock[data-i="${cb}"]`); if(!cur) return;
  const r=cur.getBoundingClientRect(), v=vis(r,vp);
  if(v/r.height>=0.5 || v/vp.height>=0.5) return;   // still ≥50% of itself OR ≥50% of the viewport → keep focus
  let best=null,bestV=0; blocks.forEach(b=>{ const bv=vis(b.getBoundingClientRect(),vp); if(bv>bestV){bestV=bv;best=b;} });
  if(best && +best.dataset.i!==cb) setCurBlock(+best.dataset.i); }
let rzT,_docW=0,_docH=0;   // re-render when the document viewport changes size — live window resizes AND the post-load titlebar/window reflow that would otherwise leave the first paint's alignment stale (a window "resize" event doesn't always fire for the reflow, so observe the element directly)
function _reflow(){ clearTimeout(rzT); rzT=setTimeout(()=>{ const s=sel.s,t=sel.t; preserveScroll(renderDoc); if(s>=0&&s<DOC.length)pick(s,t,false); },140); }
if(typeof ResizeObserver!=="undefined"){
  new ResizeObserver(es=>{ const r=es[0].contentRect, w=Math.round(r.width), h=Math.round(r.height); if(w===_docW&&h===_docH)return; _docW=w; _docH=h; _reflow(); }).observe(document.getElementById("doc"));
} else addEventListener("resize",_reflow);   // fallback for environments without ResizeObserver
// Inner scrollers use `overscroll-behavior:none` (native scroll, no bounce, no native chaining). The wheel handler
// adds back ONLY the useful chaining: an inner scroller scrolls natively within its range, but once it's already at
// its bound the next scroll in that direction chains to the document. The +1px tolerance also means a phantom-1px
// scroller counts as fully scrolled → it never traps the wheel. Scrolling down toward a block whose top is still
// below the viewport pulls the page to it first.
function scrollableUnder(target){ if(!target||!target.closest) return null;
  const tb=target.closest(".wp-toks"); if(tb && tb.scrollHeight>tb.clientHeight+1) return tb;   // a wrapped stemma scrolls via its token strip
  const sc=target.closest(".gwrap,.diagram,.text-conv");
  if(sc && !sc.classList.contains("wrapproj") && sc.scrollHeight>sc.clientHeight+1) return sc;
  return null; }
let wheelIdle=null, wheelMode=null;   // per-gesture decision: null=undecided, "chain"=drive the page, "native"=leave to the browser
document.getElementById("doc").addEventListener("wheel",e=>{ const docEl=document.getElementById("doc");
  clearTimeout(wheelIdle); wheelIdle=setTimeout(()=>{wheelMode=null;},120);   // a pause ends the gesture; the owner is re-decided next time
  if(wheelMode===null){   // decide ONCE, at the gesture's first event
    const sc=scrollableUnder(e.target);
    if(!sc) wheelMode="native";
    else { const atTop=sc.scrollTop<=0, atBot=sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1;
      // item 5: chain to the page ONLY once the inner scroller is ALREADY at its bound in this direction — NO dependency on
      // where the block sits relative to the toolbar. The inner scroller (a wide diagram's horizontal scroll, or a wrapped
      // stemma's token-row/baseline scroll) is therefore ALWAYS scrollable, regardless of the block's scroll position.
      wheelMode=((e.deltaY>0&&atBot)||(e.deltaY<0&&atTop))?"chain":"native"; } }
  if(wheelMode==="chain"){ e.preventDefault(); docEl.scrollTop+=e.deltaY; } }, {passive:false});   // "native" → the browser scrolls the element under the cursor; overscroll-behavior:none stops any leak, even if it hits its bound mid-gesture
let scrollRaf=false, lastST=null;
// JS-driven block snapping: once scrolling settles, if the nearest block top is within a small threshold of the
// viewport top, ease it to the top. Threshold-based (not a CSS scroll-snap) so you can still rest inside a block
// taller than the viewport, and it never fights an active drag or its own smooth-scroll animation.
let snapTimer=null, snapping=false, snapST=null; const SNAP_THRESH=120, SNAP_SPEED=6;   // snap when the scroll has slowed to ≤SNAP_SPEED px/tick; band within which a boundary is pulled to the top
// item 1: live top inset a scroll target must clear = the overlaid titlebar + the options bar WHEN shown. These manual
// scrollTo/scrollTop paths compute an absolute target, so #doc's scroll-padding-top never applies here — we subtract
// both bars ourselves. .viewbar.hidden is display:none → its offsetHeight is 0, so a closed options bar contributes 0.
function docTopInset(){
  // bug 9 / item 10: while the full-screen chrome is auto-collapsed the bars are slid out of view and syncChrome()
  // has zeroed --tbH/--vbH, so the doc's top is NOT occluded. But tb.offsetHeight/vb.offsetHeight still report the
  // bars' laid-out heights (a transform + opacity:0 don't change the box), so returning them made blockSnap() and
  // restoreScrollPos() shove the nearest block ~44px back DOWN — the "snap-back", which left an empty (white)
  // window-background band where the titlebar normally sits. Mirror the collapsed state and report 0 here, matching
  // the 0 padding-top the doc actually has, so nothing re-adds the titlebar height.
  if(document.body.classList.contains("fs-chrome-hidden")) return 0;
  const tb=document.querySelector(".titlebar"), vb=document.querySelector(".viewbar");
  return (tb?tb.offsetHeight:0) + (vb && !vb.classList.contains("hidden") ? vb.offsetHeight : 0); }
function blockSnap(){ if(snapping || document.body.classList.contains("dg-drag")) return;
  const docEl=document.getElementById("doc"); if(!docEl) return;
  if(docEl.scrollTop<=1 || docEl.scrollTop+docEl.clientHeight>=docEl.scrollHeight-1) return;   // resting at the very top/bottom → leave it
  const vpTop=docEl.getBoundingClientRect().top+docTopInset(); let bestD=Infinity;   // snap the block top to just BELOW both overlaid bars, not under them
  docEl.querySelectorAll(".sblock").forEach(b=>{ const d=b.getBoundingClientRect().top-(typeof sheetGapAbove==="function"?sheetGapAbove(b):0)-(typeof stickyHeadH==="function"?stickyHeadH(b):0)-vpTop; if(Math.abs(d)<Math.abs(bestD)) bestD=d; });   // item 10: the FIRST block of a sheet snaps to the top of the page-ground gap ABOVE the sheet, not to its own top — landing a sheet flush against the toolbar with its rounded corner cut off doesn't read as a new page. sheetGapAbove returns 0 for every other block and in unpaged view, so this is the old expression everywhere else   // …and the block lands BELOW its sticky boundary headings (stickyHeadH), not underneath them: pinned, they occupy the top of the port, so snapping a block's own top to the port top would hide its first line behind its own document/paragraph heading. Charged the same way and by the same argument as the sheet gap — and 0 for a block under no heading, so this too is the old expression everywhere else
  if(Math.abs(bestD)>1 && Math.abs(bestD)<=SNAP_THRESH){ snapping=true;   // more than ~1px off a boundary → glide the block top to the top
    docEl.scrollTo({top:Math.round(docEl.scrollTop+bestD), behavior:"smooth"}); setTimeout(()=>{snapping=false; blockSnap();},450); } }   // re-check once the snap window closes: a tiny nudge can fire blockSnap mid-gesture and have its smooth-scroll cancelled by residual wheel/native scroll, after which NO further scroll event arrives to re-arm the settle timer — this landing re-check finishes the snap (and no-ops once bestD≤1, so no feedback loop)
/* ─── per-file scroll memory (item 11) ────────────────────────────────────────
   Remember, per file in the recent-files history, WHERE the reader was — as the
   index of the top-most visible sentence block (robust across window sizes: on
   reopen we scroll that block back to the top). Captured debounced on scroll and
   flushed on close/switch; persisted by the Python bridge (Api.save_scroll). */
function topVisibleBlock(){ const docEl=document.getElementById("doc"); if(!docEl) return -1;
  const vpTop=docEl.getBoundingClientRect().top; let best=-1,bestD=Infinity;
  docEl.querySelectorAll(".sblock").forEach(b=>{ const d=Math.abs(b.getBoundingClientRect().top-vpTop); if(d<bestD){bestD=d; best=+(b.dataset.i);} });   // block whose top is nearest the viewport top
  return best; }
let scrollSaveTimer=null;
function saveScrollPos(now){ if(!hasBridge()) return; clearTimeout(scrollSaveTimer);
  const flush=()=>{ const idx=topVisibleBlock(); if(idx<0) return; try{window.pywebview.api.save_scroll(idx);}catch(e){} };
  if(now) flush(); else scrollSaveTimer=setTimeout(flush,400); }   // debounce while scrolling; flush immediately on close/switch/unload
function restoreScrollPos(idx){ if(idx==null||idx<0) return;   // no saved anchor → leave at the top
  const apply=()=>{ const docEl=document.getElementById("doc"); if(!docEl) return;
    const blk=docEl.querySelector(`.sblock[data-i="${idx}"]`); if(!blk) return;
    docEl.scrollTop+=blk.getBoundingClientRect().top-docEl.getBoundingClientRect().top-docTopInset()-(typeof stickyHeadH==="function"?stickyHeadH(blk):0); };   // item 1: align the saved block's top with just BELOW both overlaid bars (subtract the live titlebar + options-bar height), not under them — same technique as blockSnap, sticky boundary headings included (a restored position that puts the block under its own heading hides the very line the reader left off at)
  requestAnimationFrame(()=>requestAnimationFrame(apply)); setTimeout(apply,480); }   // re-apply after settleAlign's ~450ms re-layout lands
addEventListener("beforeunload",()=>saveScrollPos(true));
document.getElementById("doc").addEventListener("scroll",()=>{ const st=document.getElementById("doc").scrollTop;
  const v=snapST==null?Infinity:Math.abs(st-snapST); snapST=st;   // per-tick scroll speed
  clearTimeout(snapTimer); snapTimer=setTimeout(blockSnap,240);   // ALWAYS re-arm a settle timer: it fires ~240ms after the LAST scroll event (however tiny), so a scroll that stops near a boundary always gets re-checked
  if(!snapping && v<=SNAP_SPEED) blockSnap();   // and snap right away once the scroll has decelerated to a crawl (blockSnap self-guards against its own smooth-scroll animation)
  saveScrollPos();   // remember the reading position for this file (debounced)
  if(scrollRaf)return; scrollRaf=true; requestAnimationFrame(()=>{scrollRaf=false;
  const st2=document.getElementById("doc").scrollTop, up=lastST!=null&&st2<lastST-0.5; lastST=st2; maybeShiftFocus(up); }); });

