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
/* ── VIEWPORT VIRTUALIZATION: SHIFT THE RENDERED WINDOW AS THE READER SCROLLS ──────────────────────────────────
   renderDoc() (js/core/document.js) only builds `.sblock`s for [winLo,winHi) and stands in two spacer elements
   for everything outside it — recentred on curBlock() every time an EDIT re-renders, but ordinary scrolling
   never calls renderDoc() at all, so nothing would ever grow the window as the reader scrolls toward its edge.
   This is the other half: once either edge of the rendered range gets within WIN_EDGE_PX of the viewport, shift
   the window to recentre on whatever's now nearest the top (topVisibleBlock — same signal maybeShiftFocus
   above already computes a version of) and re-render. Called from the SAME rAF-coalesced scroll callback below,
   so it costs nothing extra per scroll tick beyond one bounding-rect check on the first/last rendered block. */
const WIN_EDGE_PX=600;   // generous — a fast trackpad fling shouldn't outrun the rebuild and hit bare spacer
function maybeShiftWindow(){
  if(typeof winLo==="undefined"||!DOC.length) return;
  const docEl=document.getElementById("doc"); if(!docEl) return;
  const vp=docEl.getBoundingClientRect(), blocks=docEl.querySelectorAll(".sblock"); if(!blocks.length) return;
  const nearTop=winLo>0 && blocks[0].getBoundingClientRect().top > vp.top-WIN_EDGE_PX;
  const nearBot=winHi<DOC.length && blocks[blocks.length-1].getBoundingClientRect().bottom < vp.bottom+WIN_EDGE_PX;
  if(!nearTop && !nearBot) return;
  const anchor=topVisibleBlock(); if(anchor<0) return;
  computeWindow(anchor); preserveScroll(renderDoc);
}
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
/* …and one thing the wheel handler must ALSO know: is the inner scroller's own block actually on screen? A block that
   is only partly in view must not let its diagram/grid eat the wheel — the reader's gesture belongs to the PAGE until
   the block they're pointing at has been pulled into view. Two measurement decisions here, both load-bearing:
   • the port is the USABLE one, not #doc's raw client rect: the document scrolls UNDER the translucent titlebar and
     options bar (the same inset #doc's own scroll-padding-top encodes), so a block's top sitting behind the toolbar is
     NOT "in view". docTopInset() below is the live figure and already reports 0 while the full-screen chrome is
     collapsed, so this inherits that fix rather than re-deriving it; sticky boundary headings occlude the same way and
     are charged the same way blockSnap()/restoreScrollPos() charge them.
   • "fully in view" is min(block height, port height) of overlap, NOT "top ≥ portTop AND bottom ≤ portBottom". A block
     with both panes open is routinely TALLER than the port (--cap-dia is 60vh and --cap-grid 40vh — 100vh before the
     header, text and translation rows are counted), so the strict two-edge test would be unsatisfiable for the common
     case and would leave every inner scroller permanently dead. The test is therefore "as fully visible as this block
     CAN be": either the block fits inside the port, or the port fits inside the block — and in that second case there
     is nothing left to bring into view, so the page-scroll intent doesn't apply and the inner scroller is the right
     owner. vis() (top of this file) already computes exactly that overlap. The 1px tolerance is the same fractional-
     layout slack the atTop/atBot tests take: a block that IS flush must not be disqualified by device-pixel rounding. */
function blockFullyInView(sc){ const blk=sc.closest?sc.closest(".sblock"):null; if(!blk) return true;   // not inside a block (nothing the page could bring into view) → don't gate
  const docEl=document.getElementById("doc"); if(!docEl) return true;
  const vp=docEl.getBoundingClientRect();
  const port={top:vp.top+docTopInset()+(typeof stickyHeadH==="function"?stickyHeadH(blk):0), bottom:vp.bottom};
  const r=blk.getBoundingClientRect();
  return vis(r,port)>=Math.min(r.height,port.bottom-port.top)-1; }
let wheelIdle=null, wheelMode=null, wheelSc=null;   // per-gesture decision: null=undecided, "chain"=drive the page, "native"=leave to the browser; wheelSc = the inner scroller it was decided for
document.getElementById("doc").addEventListener("wheel",e=>{ const docEl=document.getElementById("doc");
  clearTimeout(wheelIdle); wheelIdle=setTimeout(()=>{wheelMode=null; wheelSc=null;},120);   // a pause ends the gesture; the owner is re-decided next time
  if(wheelMode===null){   // decide ONCE, at the gesture's first event
    const sc=wheelSc=scrollableUnder(e.target);
    if(!sc) wheelMode="native";
    // A VERTICAL gesture over a block that isn't fully on screen drives the page, whatever the inner scroller's own
    // position: the block scrolls into view first, and only then (the 120ms pause below re-decides the owner) can its
    // diagram/grid be scrolled. This QUALIFIES item 5 below — that note was about not tying the decision to the
    // block's position relative to the TOOLBAR, and it still holds for a block that's on screen; a block that is half
    // off screen is a different case, where "the pointer happens to rest on a diagram" would otherwise silently steal
    // a plain page scroll. Gated on the gesture being vertical-dominant (|dY|>|dX|, not dY≠0 — a trackpad fling is
    // never axis-pure) because the chain branch can only drive docEl.scrollTop by e.deltaY: a horizontal delta has
    // nowhere to chain TO, so gating it would merely deaden a wide diagram's horizontal pan and buy nothing. A wide
    // diagram therefore still pans sideways even while its block is half off screen.
    else if(Math.abs(e.deltaY)>Math.abs(e.deltaX) && !blockFullyInView(sc)) wheelMode="chain";
    else { const atTop=sc.scrollTop<=0, atBot=sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1;
      // item 5: chain to the page ONLY once the inner scroller is ALREADY at its bound in this direction — NO dependency on
      // where the block sits relative to the toolbar. The inner scroller (a wide diagram's horizontal scroll, or a wrapped
      // stemma's token-row/baseline scroll) is therefore ALWAYS scrollable, regardless of the block's scroll position.
      wheelMode=((e.deltaY>0&&atBot)||(e.deltaY<0&&atTop))?"chain":"native"; } }
  /* …AND THE "block isn't fully on screen" VETO IS RE-CHECKED ON EVERY EVENT, not just the first.
     It is a fact about where the block is NOW, and the block moves DURING the gesture — so deciding
     it once leaked exactly one way: start a gesture over a diagram or grid while the page is still
     gliding (momentum from a previous fling, or this app's own smooth scroll), and the block was
     fully in view at that first instant, so the pane won ownership and kept it while the block slid
     half out of the viewport under the pointer. Re-testing costs one getBoundingClientRect per event.
     ONE-WAY, native → chain and never back: once the page owns the gesture it keeps it until the
     120ms pause above re-decides, which is the same "the block scrolls into view first, and only
     then can its diagram/grid be scrolled" rule the first-event branch states. */
  else if(wheelMode==="native" && wheelSc && Math.abs(e.deltaY)>Math.abs(e.deltaX) && !blockFullyInView(wheelSc)) wheelMode="chain";
  if(wheelMode==="chain"){ e.preventDefault(); docEl.scrollTop+=e.deltaY; } }, {passive:false});   // "native" → the browser scrolls the element under the cursor; overscroll-behavior:none stops any leak, even if it hits its bound mid-gesture
let scrollRaf=false, lastST=null;
// JS-driven block snapping: once scrolling settles, if the nearest block top is within a small threshold of the
// viewport top, ease it to the top. Threshold-based (not a CSS scroll-snap) so you can still rest inside a block
// taller than the viewport, and it never fights an active drag or its own smooth-scroll animation.
let snapTimer=null, snapping=false, snapST=null; const SNAP_THRESH=30, SNAP_SPEED=6;   // snap when the scroll has slowed to ≤SNAP_SPEED px/tick; band within which a boundary is pulled to the top — halved from 120→60→30 on request
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
  if(document.body.classList.contains("fs-chrome-hidden")) return 0;   // …and a full-screen window shows no window-tab bar either, so --tabH cannot apply here
  const tb=document.querySelector(".titlebar"), vb=document.querySelector(".viewbar");
  const bars=(tb?tb.offsetHeight:0) + (vb && !vb.classList.contains("hidden") ? vb.offsetHeight : 0);
  /* …AND THE NATIVE WINDOW-TAB BAR, exactly as .doc's padding takes it (app.css): a FLOOR, max() and not
     a sum, because --tabH is the bar's bottom EDGE in page coordinates and the web toolbar is drawn
     inside the same band. Missing it here was worth 48px: the padding moved the document down but every
     manual scroll target (blockSnap, restoreScrollPos, the find bar) and blockFullyInView kept aiming at
     the untabbed inset, so opening a tab left the block the reader was on sliced by the bar.
     Read off the INLINE style, which is where app/mac/shell.py's publish writes it — a getComputedStyle
     here would run on every wheel event through blockFullyInView. */
  const tabH=parseFloat(document.documentElement.style.getPropertyValue("--tabH"))||0;
  return Math.max(bars, tabH); }
/* ── THE READING POSITION SURVIVES A CHANGE IN THE TOP CHROME ────────────────────────────────────
   A tab bar appearing (or the options bar opening) makes the port shorter from the TOP. The blocks
   re-cap themselves to the new height, but the scroller does not move: the content point that was at
   the top of the port ends up that many px above it — behind the bar. So capture what the reader is
   looking at BEFORE the chrome moves and put it back after: the block nearest the port top, and its
   offset from it, which is what keeps a reader mid-block where they were instead of jumping them to a
   block boundary. Restoring is one scrollTop write, after a frame, so the recap has been laid out. */
function captureTopAnchor(){
  const docEl=document.getElementById("doc"); if(!docEl) return null;
  const portTop=docEl.getBoundingClientRect().top+docTopInset();
  let best=null, bestD=Infinity;
  docEl.querySelectorAll(".sblock").forEach(b=>{ const r=b.getBoundingClientRect();
    if(r.bottom<=portTop+1) return;                       // wholly scrolled past → not what is being read
    const d=r.top-portTop; if(Math.abs(d)<Math.abs(bestD)){ bestD=d; best=b; } });
  return best?{blk:best, off:bestD}:null; }
function restoreTopAnchor(a){
  if(!a||!a.blk||!a.blk.isConnected) return;
  const docEl=document.getElementById("doc"); if(!docEl) return;
  const d=(a.blk.getBoundingClientRect().top-(docEl.getBoundingClientRect().top+docTopInset()))-a.off;
  if(Math.abs(d)>0.5) docEl.scrollTop+=d; }
/* …and the two together, for a caller that changes the chrome in one go — including the JS
   app/mac/shell.py sends when a window joins or leaves a tab group.
   SYNCHRONOUS, NOT requestAnimationFrame. The window this arrives at is usually a BACKGROUND TAB (the
   new tab is frontmost the moment it merges), and a background tab is served no frames at all: measured
   at 10.7s between the rAF being queued and running — by which time a re-render had replaced the
   captured block, `isConnected` was false, and the restore silently did nothing. That is precisely the
   window whose reading position the user finds wrong when they switch back to it. fn()'s recap writes
   are synchronous and getBoundingClientRect below forces the layout, so a frame buys nothing here. */
function withTopChrome(fn){
  const a=captureTopAnchor();
  try{ fn(); } finally{ restoreTopAnchor(a); } }
function blockSnap(){ if(snapping || document.body.classList.contains("dg-drag")) return;
  const docEl=document.getElementById("doc"); if(!docEl) return;
  if(docEl.scrollTop<=1 || docEl.scrollTop+docEl.clientHeight>=docEl.scrollHeight-1) return;   // resting at the very top/bottom → leave it
  const vpTop=docEl.getBoundingClientRect().top+docTopInset(); let bestD=Infinity;   // snap the block top to just BELOW both overlaid bars, not under them
  docEl.querySelectorAll(".sblock").forEach(b=>{ const d=b.getBoundingClientRect().top-(typeof sheetGapAbove==="function"?sheetGapAbove(b):0)-(typeof stickyHeadH==="function"?stickyHeadH(b):0)-vpTop; if(Math.abs(d)<Math.abs(bestD)) bestD=d; });   // item 10: the FIRST block of a sheet snaps to the top of the page-ground gap ABOVE the sheet, not to its own top — landing a sheet flush against the toolbar with its rounded corner cut off doesn't read as a new page. sheetGapAbove returns 0 for every other block and in unpaged view, so this is the old expression everywhere else   // …and the block lands BELOW its sticky boundary headings (stickyHeadH), not underneath them: pinned, they occupy the top of the port, so snapping a block's own top to the port top would hide its first line behind its own document/paragraph heading. Charged the same way and by the same argument as the sheet gap — and 0 for a block under no heading, so this too is the old expression everywhere else
  if(Math.abs(bestD)>1 && Math.abs(bestD)<=SNAP_THRESH){ snapping=true;   // more than ~1px off a boundary → glide the block top to the top
    docEl.scrollTo({top:Math.round(docEl.scrollTop+bestD), behavior:"smooth"}); setTimeout(()=>{snapping=false; blockSnap();},450); } }   // re-check once the snap window closes: a tiny nudge can fire blockSnap mid-gesture and have its smooth-scroll cancelled by residual wheel/native scroll, after which NO further scroll event arrives to re-arm the settle timer — this landing re-check finishes the snap (and no-ops once bestD≤1, so no feedback loop)
/* A PICTURE OF THIS VIEW, for the next launch to show while the document is read back in
   (Api.capture_snapshot → the boot cover in index.html). Fire-and-forget and throttled in
   Python, so callers need not care how often they call it; a no-op without a bridge. */
function captureViewSnapshot(){ if(!hasBridge()) return;
  try{ const d=document.getElementById("doc");
    // …the chrome height as the USED value, off .doc's padding-top — NOT --top-chrome itself, which is
    // declared as a max(calc(…)) and comes back from getPropertyValue as that expression's TEXT, so
    // parseFloat gives NaN and every snapshot was filed as chrome:0 (and would have hung a pixel-perfect
    // picture 54px too low). .doc's padding IS that property, resolved.
    const chrome=d?parseFloat(getComputedStyle(d).paddingTop)||0:0;
    window.pywebview.api.capture_snapshot(chrome); }catch(e){} }
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
  const flush=()=>{ const idx=topVisibleBlock(); if(idx<0) return; try{window.pywebview.api.save_scroll(idx);}catch(e){}
    captureViewSnapshot(); };   // …and the picture the next launch shows must be of the anchor just saved, or Api._launch_snapshot will refuse it (it is throttled to once per 8s on the Python side)

  if(now) flush(); else scrollSaveTimer=setTimeout(flush,400); }   // debounce while scrolling; flush immediately on close/switch/unload
function restoreScrollPos(idx){ if(idx==null||idx<0) return;   // no saved anchor → leave at the top
  const apply=()=>{ const docEl=document.getElementById("doc"); if(!docEl) return;
    const blk=(typeof scrollToSentence==="function")?scrollToSentence(idx):docEl.querySelector(`.sblock[data-i="${idx}"]`); if(!blk) return;   // scrollToSentence (js/core/document.js) re-centres the rendered window on idx first — the render this fires after may have windowed the DOM to start at sentence 0, nowhere near a saved position deep in a large file
    docEl.scrollTop+=blk.getBoundingClientRect().top-docEl.getBoundingClientRect().top-docTopInset()-(typeof stickyHeadH==="function"?stickyHeadH(blk):0); };   // item 1: align the saved block's top with just BELOW both overlaid bars (subtract the live titlebar + options-bar height), not under them — same technique as blockSnap, sticky boundary headings included (a restored position that puts the block under its own heading hides the very line the reader left off at)
  requestAnimationFrame(()=>requestAnimationFrame(apply)); setTimeout(apply,480); }   // re-apply after settleAlign's ~450ms re-layout lands
addEventListener("beforeunload",()=>saveScrollPos(true));
document.getElementById("doc").addEventListener("scroll",()=>{ const st=document.getElementById("doc").scrollTop;
  const v=snapST==null?Infinity:Math.abs(st-snapST); snapST=st;   // per-tick scroll speed
  clearTimeout(snapTimer); snapTimer=setTimeout(blockSnap,240);   // ALWAYS re-arm a settle timer: it fires ~240ms after the LAST scroll event (however tiny), so a scroll that stops near a boundary always gets re-checked
  if(!snapping && v<=SNAP_SPEED) blockSnap();   // and snap right away once the scroll has decelerated to a crawl (blockSnap self-guards against its own smooth-scroll animation)
  saveScrollPos();   // remember the reading position for this file (debounced)
  if(scrollRaf)return; scrollRaf=true; requestAnimationFrame(()=>{scrollRaf=false;
  const st2=document.getElementById("doc").scrollTop, up=lastST!=null&&st2<lastST-0.5; lastST=st2; maybeShiftFocus(up); maybeShiftWindow(); }); });

