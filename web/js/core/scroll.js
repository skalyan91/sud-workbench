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
/* ⚠ HAS THE PAGE ANYWHERE TO GO IN THIS DIRECTION? Chaining is only meaningful while it has: without this the
   "the block is not on screen enough, so the page owns the gesture" rules below could hand the wheel to a
   document already at its bound, leaving NOTHING scrolling at all. Measured with trusted wheels on a wrapped
   hierarchy at the very bottom of a document: `#doc.scrollTop` 1945 of a 1945 maximum, its token strip holding
   99px of unscrolled content, `blockFullyInView` false — the pane was ruled out, the chain drove a page that
   could not move, and three further wheels left the strip at 0. The pane gets the wheel back in exactly that
   case; it is the only owner left that can act on it.
   ⚠️ DIRECTIONAL, not "the page is at either end": a document parked at its bottom must still chain UPWARD
   normally, and does — `dy` picks the bound actually in the gesture's way. A zero/horizontal delta answers
   false, leaving those gestures exactly as they were. */
function pageAtBound(docEl,dy){
  if(!(dy>0)&&!(dy<0)) return false;
  return dy>0 ? docEl.scrollTop>=docEl.scrollHeight-docEl.clientHeight-1 : docEl.scrollTop<=0; }
/* …and the SAME question of an inner scroller: has THIS pane run out of room in the direction the gesture is
   going. Written out inline in the first-event branch since this mechanism was built; factored out because the
   per-event re-check needs the identical test and a second copy would be one more thing to keep in step. Same
   directional shape as pageAtBound: a zero/horizontal delta answers false. */
function paneAtBound(sc,dy){
  if(!(dy>0)&&!(dy<0)) return false;
  return dy>0 ? sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1 : sc.scrollTop<=0; }
/* ⚠ AND "NO INNER SCROLLER" DOES NOT MEAN "LET THE BROWSER HANDLE IT" — over these panes it means NOBODY
   HANDLES IT. `.diagram`, `.gwrap` and `.text-conv` all carry `overscroll-behavior:none`
   (web/chrome-shared/base-chrome.css), which is what stops a pane that CAN scroll from bouncing or chaining
   natively — this handler adds the useful chaining back itself. The same declaration on a pane that CANNOT
   scroll has no such counterpart: the box still swallows the gesture and passes nothing to its ancestors, so
   `scrollableUnder` correctly answers null, the mode is "native", and the wheel simply dies.
   Measured in isolation with a TRUSTED wheel (CDP Input.dispatchMouseEvent — a synthetic event cannot drive
   native scrolling at all, so nothing less will do): a `.diagram` with scrollHeight === clientHeight and a
   computed `overscroll-behavior-y: none` took three wheels of 120px and left `#doc.scrollTop` at 0. Reported
   as "still not able to scroll the page if my mouse is over a vertically-overflowing hierarchy… on the first
   sentence of Ramayana": that block's hierarchy measures 410/410 in the real app — it does not overflow at
   all, which is precisely why nothing could scroll. Not engine-specific and not notation-specific either; the
   hierarchy is simply where a reader's pointer tends to rest.
   The page is the only owner left, so it takes the gesture outright rather than being left to a browser that
   will do nothing. This supersedes an earlier, narrower version of this rule scoped to `.diagram.wrapproj`
   outside `.wp-toks` (the tree overview) — that was one instance of exactly this, and is covered here by its
   `.diagram` ancestor. Consulted ONLY where `scrollableUnder` already found nothing to scroll, so a pane with
   room of its own is untouched. */
function wheelSwallowed(target){
  return !!(target&&target.closest&&target.closest(".diagram,.gwrap,.text-conv")); }
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
     layout slack the atTop/atBot tests take: a block that IS flush must not be disqualified by device-pixel rounding.
   ⚠ • AND THE PAGE-GROUND GAP ABOVE A SHEET IS PART OF THAT SHEET'S FIRST BLOCK, so the block is not asked to
     cover the strip of port its own gap is standing in. This is the same charge item 10 already makes in two
     other places (capBlock's height cap and blockSnap's target, js/core/document.js + below) arriving at the
     third consumer, and without it the two of them CONTRADICT each other: blockSnap deliberately parks the first
     block of a sheet with the gap flush under the toolbar — the sheet has to arrive looking like a new page —
     so `gap` px of the port are page ground by construction, and a block TALLER than the port can then never
     reach `min(height, portH)` of overlap at the very position the snap put it in. Measured on the fixture at a
     420px window (paged, sheet 2's first block, 289px against a 249px port): overlap 227 vs. a required 248, so
     `false`, and both panes — genuinely scrollable, scrollHeight over clientHeight — sat dead under the wheel
     until the reader chained the page far enough to bury the gap. Charged as a REDUCTION OF WHAT THE BLOCK MUST
     COVER and not by moving port.top, because the gap is an in-flow band and not an occluder like the toolbar:
     port.top is what the reader can see, and only the block's own share of it has moved.
     Only the part of the gap band actually INSIDE the port counts (vis of [r.top-gap, r.top]) — scrolled past,
     the gap costs the block nothing and this is the old expression exactly, which is what keeps a first block
     that the reader HAS scrolled flush to the toolbar (gap off screen above) still fully in view. 0 for every
     block that is not the first of a sheet, and unpaged, so everywhere else this is the old expression too.
     ⚠️ This runs on EVERY wheel event (the re-check below, not only the first-event decision), which is the
     budget docTopInset() below (offsetHeight reads, not getComputedStyle) is written to protect. sheetGapAbove settles the two
     cheap DOM questions — is the parent a .docsheet, is this its first .sblock — BEFORE it reads any computed
     style, so a block that is not the first of a sheet never reaches one, and the block that does asks after
     getBoundingClientRect has already flushed layout, so it forces no second reflow. Benchmarked in this very
     Chrome, 2000 iterations: 0.20 µs for an ordinary block and 1.05 µs for a sheet's first, taking
     blockFullyInView itself from 2.5 µs to 4.0 µs on that one block — against a 16,600 µs frame.
   ⚠ THIS BAR IS DIAGRAM-SPECIFIC, ON REPORT. A grid pane (.gwrap) now asks blockHalfInView instead (below) —
     "must be fully in view" was too strict for a grid, which a reader wants scrollable as soon as roughly half
     their block has arrived, not only once every last row of it has. blockFullyInView itself is unchanged and
     stays the diagram (and .wp-toks/.text-conv) rule verbatim; paneVisibleEnough (below) is the one place that
     decides which test a given inner scroller gets, so the two rules cannot drift apart per call site the way
     the axis-test guard once did (see the re-check's own note further down). */
function blockFullyInView(sc){ const blk=sc.closest?sc.closest(".sblock"):null; if(!blk) return true;   // not inside a block (nothing the page could bring into view) → don't gate
  const docEl=document.getElementById("doc"); if(!docEl) return true;
  const vp=docEl.getBoundingClientRect();
  const port={top:vp.top+docTopInset()+(typeof stickyHeadH==="function"?stickyHeadH(blk):0), bottom:vp.bottom};
  const r=blk.getBoundingClientRect();
  const gap=(typeof sheetGapAbove==="function")?sheetGapAbove(blk):0;   // real px, like the rects — sheetGapAbove measures the sheet's own margin, which is OUTSIDE .sblock{zoom:FS}
  const gapOn=gap?vis({top:r.top-gap,bottom:r.top},port):0;             // …and only what of it the reader is actually looking at
  return vis(r,port)>=Math.min(r.height,(port.bottom-port.top)-gapOn)-1; }
/* GRIDS GET A LOOSER BAR THAN DIAGRAMS: a .gwrap may take the wheel once at least HALF its block's own height is
   in view, not only once the whole block is. blockHalfInView is a SEPARATE test rather than a shared frac param
   on blockFullyInView, on purpose — the two are asked different questions. blockFullyInView's min(r.height,
   portHeight-gapOn) is there so a block TALLER than the port (both panes open) can still satisfy "as fully
   visible as this block CAN be"; a straight 50%-of-r.height test does not need that rescue nearly as often (a
   block has to be MORE than 2× the port's height before full port coverage alone can't reach half of it), and
   CLAUDE.md is explicit that the tall-block special case is a past false start not to be copied to a second
   call site — so this states the plain reading of "half the block is in view" (half of the BLOCK's own height,
   not half of what the port can show of it) and leaves that rescue out. Both rects come from
   getBoundingClientRect, like blockFullyInView's — the block's own zoom (`.sblock{zoom:var(--fs)}`) is baked
   into both sides of the ratio the same way, so no separate cssZoomOf() conversion is needed here either. */
function blockHalfInView(sc){ const blk=sc.closest?sc.closest(".sblock"):null; if(!blk) return true;
  const docEl=document.getElementById("doc"); if(!docEl) return true;
  const vp=docEl.getBoundingClientRect();
  const port={top:vp.top+docTopInset()+(typeof stickyHeadH==="function"?stickyHeadH(blk):0), bottom:vp.bottom};
  const r=blk.getBoundingClientRect(); if(!(r.height>0)) return true;
  return vis(r,port)/r.height>=0.5-0.001; }   // -0.001 tolerance mirrors blockFullyInView's own -1px slack, scaled for a ratio test
/* ONE DISPATCHER, consulted by BOTH the first-event decision and the per-event re-check below, so which rule a
   pane type gets is stated ONCE — the re-check duplicating a decision the first-event branch already made is
   exactly how the axis-test guard leaked (see the note on the re-check below); this is the same call site risk,
   guarded against by sharing one function instead of inlining the classList test twice. */
function paneVisibleEnough(sc){ return sc.classList.contains("gwrap")?blockHalfInView(sc):blockFullyInView(sc); }
let wheelIdle=null, wheelMode=null, wheelSc=null;   // per-gesture decision: null=undecided, "chain"=drive the page, "native"=leave to the browser; wheelSc = the inner scroller it was decided for
/* ── IS THE PAGE ITSELF MOVING RIGHT NOW? ──────────────────────────────────────────────────────────
   Stamped by #doc's own scroll listener below, so it covers every way the page moves: a chained wheel,
   trackpad momentum, blockSnap's smooth glide, alignBlockTop after an insert. The window is short —
   this is meant to mean "a scroll is in flight", not "a scroll happened recently". */
let pageScrollAt=0, wheelDocTop=null;
const PAGE_GLIDE_MS=180;
/* IS A PAGE SCROLL IN FLIGHT? Two signals, because neither alone covers both cases.
   · `pageScrollAt` — the page moved a moment ago. Catches a glide that was ALREADY running when this
     gesture started (momentum from a previous fling, blockSnap easing, alignBlockTop after an insert),
     which is the case the reader meets by putting the pointer down on a pane mid-glide.
   · `wheelDocTop` — the page has moved SINCE this gesture began. Catches a glide that starts or
     continues under an in-flight gesture, and is exact rather than time-boxed.
   A pane scrolling natively moves no page and fires no #doc scroll event, so neither signal trips for
   it: at rest the pane keeps the wheel exactly as before. */
function pageMoving(){ return performance.now()-pageScrollAt<PAGE_GLIDE_MS; }
function pageInFlight(docEl){ return pageMoving()
  || (wheelDocTop!=null && Math.abs(docEl.scrollTop-wheelDocTop)>1); }
document.getElementById("doc").addEventListener("wheel",e=>{ const docEl=document.getElementById("doc");
  clearTimeout(wheelIdle); wheelIdle=setTimeout(()=>{wheelMode=null; wheelSc=null; wheelDocTop=null;},120);   // a pause ends the gesture; the owner is re-decided next time
  if(wheelMode===null){   // decide ONCE, at the gesture's first event
    const sc=wheelSc=scrollableUnder(e.target);
    wheelDocTop=docEl.scrollTop;   // the page position this gesture starts from — see pageInFlight
    // …and where the browser would do nothing at all, the page takes it instead — see wheelSwallowed's own note.
    // Vertical-dominant only, for the same reason the axis test below gives: the chain branch drives the page by
    // e.deltaY alone, so a horizontal gesture has nowhere to chain to and is better left exactly as it was.
    if(!sc) wheelMode=(wheelSwallowed(e.target)&&Math.abs(e.deltaY)>=Math.abs(e.deltaX))?"chain":"native";
    /* ⚠ A PAGE SCROLL IN FLIGHT TAKES THE WHEEL OUTRIGHT, ahead of every other test and WITHOUT
       consulting blockFullyInView. That last part is the point, and is why an earlier attempt at this
       fixed nothing: `blockFullyInView` reports TRUE for a block TALLER than the port whenever the
       block covers it (deliberately — "either the block fits inside the port, or the port fits inside
       the block", since otherwise a block with both panes open, routinely taller than the viewport,
       could never scroll its panes at all). A tall block therefore satisfies the "fully in view" rule
       for as long as the page glides THROUGH it, and its diagram and grid went on eating the wheel the
       whole way down. Measured on the repro: block twice the port height, page moved 120px between
       events, and both wheels stayed `native` and unprevented.
       Two things scrolling at once is the fault; while the page is moving it is the owner. */
    else if(pageInFlight(docEl) && !pageAtBound(docEl,e.deltaY)) wheelMode="chain";
    // A VERTICAL gesture over a block that isn't fully on screen drives the page, whatever the inner scroller's own
    // position: the block scrolls into view first, and only then (the 120ms pause below re-decides the owner) can its
    // diagram/grid be scrolled. This QUALIFIES item 5 below — that note was about not tying the decision to the
    // block's position relative to the TOOLBAR, and it still holds for a block that's on screen; a block that is half
    // off screen is a different case, where "the pointer happens to rest on a diagram" would otherwise silently steal
    // a plain page scroll. Gated on the gesture being vertical-dominant (|dY|>|dX|, not dY≠0 — a trackpad fling is
    // never axis-pure) because the chain branch can only drive docEl.scrollTop by e.deltaY: a horizontal delta has
    // nowhere to chain TO, so gating it would merely deaden a wide diagram's horizontal pan and buy nothing. A wide
    // diagram therefore still pans sideways even while its block is half off screen.
    // …and the axis test is WAIVED WHILE THE PAGE IS ALREADY MOVING. Its job is to keep a wide
    // diagram pannable sideways when the page is at rest, since a horizontal delta has nowhere to
    // chain to. Mid-glide that reasoning does not apply: two things scrolling at once is the fault
    // being fixed, and the block is on its way somewhere, so the pane is not the owner of anything.
    else if((Math.abs(e.deltaY)>Math.abs(e.deltaX)||pageMoving()) && !paneVisibleEnough(sc) && !pageAtBound(docEl,e.deltaY)) wheelMode="chain";
    else { 
      // item 5: chain to the page ONLY once the inner scroller is ALREADY at its bound in this direction — NO dependency on
      // where the block sits relative to the toolbar. The inner scroller (a wide diagram's horizontal scroll, or a wrapped
      // stemma's token-row/baseline scroll) is therefore ALWAYS scrollable, regardless of the block's scroll position.
      wheelMode=paneAtBound(sc,e.deltaY)?"chain":"native"; } }
  /* …AND THE "block isn't fully on screen" VETO IS RE-CHECKED ON EVERY EVENT, not just the first.
     It is a fact about where the block is NOW, and the block moves DURING the gesture — so deciding
     it once leaked exactly one way: start a gesture over a diagram or grid while the page is still
     gliding (momentum from a previous fling, or this app's own smooth scroll), and the block was
     fully in view at that first instant, so the pane won ownership and kept it while the block slid
     half out of the viewport under the pointer. Re-testing costs one getBoundingClientRect per event.
     ONE-WAY, native → chain and never back: once the page owns the gesture it keeps it until the
     120ms pause above re-decides, which is the same "the block scrolls into view first, and only
     then can its diagram/grid be scrolled" rule the first-event branch states.

     ⚠ AND NO AXIS TEST HERE, which is where this leaked. The guard was copied down from the
     first-event branch, where it earns its place (a horizontal delta cannot drive the page, so
     gating on it would merely deaden a wide diagram's sideways pan). On the RE-check it asks the
     wrong question: not "can this delta scroll the page" but "has the block left view, so should the
     pane lose the wheel" — and the answer to that has nothing to do with the axis. A trackpad
     momentum tail is never axis-pure, so every event whose |dX| happened to exceed its |dY| slipped
     through and the browser went on scrolling the pane while the page glided the block out from
     under it. Measured on the repro: with the block half off the top, deltas (6,9) and (4,7) both
     stayed `native` and unprevented, and ownership only moved when a vertical-dominant (3,0)
     arrived. That is exactly "they scroll in partially-visible blocks, but only while a page scroll
     is in progress" — the page scroll is what takes the block out of view mid-gesture. */
  /* ⚠ …AND THE PANE'S OWN BOUND IS RE-CHECKED HERE TOO, which is the difference between chaining that works
     with a trackpad and chaining that only works with a mouse. The first-event branch above already asks it —
     a gesture that STARTS with the pane at its bound chains — but a gesture that starts mid-pane was decided
     "native" once and nothing asked again, so when the pane ran out of room part way through, the rest of the
     gesture had no owner at all: `.diagram`/`.gwrap`/`.text-conv` carry `overscroll-behavior:none`
     (web/chrome-shared/base-chrome.css), so the browser will not chain either, by design — this handler is the
     only thing that can. Measured with trusted wheels over a vertically-overflowing flat hierarchy: 14 wheels
     40ms apart (ONE continuous gesture — the events a trackpad actually produces) scrolled the pane its full
     33px and then left `#doc.scrollTop` at 0, while the identical 14 wheels 200ms apart (separate gestures, a
     mouse's discrete clicks) chained 777px. That is the reported "I'm still not able to scroll the page if my
     mouse is over a vertically-overflowing hierarchy" — the hierarchy being the notation whose deep trees
     overflow vertically most readily. The pane keeps the one event that takes it TO its bound (the browser
     applies that scroll after this handler returns) and the next one hands over, which is exactly how native
     chaining paces itself. One-way as before: once the page owns the gesture it keeps it until the 120ms pause. */
  else if(wheelMode==="native" && wheelSc && !pageAtBound(docEl,e.deltaY)
          && (pageInFlight(docEl)||!paneVisibleEnough(wheelSc)||paneAtBound(wheelSc,e.deltaY))) wheelMode="chain";
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
  if(document.body.classList.contains("fs-chrome-hidden")) return 0;
  const tb=document.querySelector(".titlebar"), vb=document.querySelector(".viewbar");
  const tbH=tb?tb.offsetHeight:0, vbH=(vb && !vb.classList.contains("hidden")) ? vb.offsetHeight : 0;
  // This is `--top-chrome` restated in JS and the two must not drift: docPadTop() below prefers the
  // used value precisely because they can be read at a torn instant, not because they may disagree.
  // ⚠ THIS USED TO ALSO FLOOR AGAINST --tabH, a native window-tab bar's bottom edge — deleted with
  // window tabbing itself (see the module-level note near the top of app/__main__.py). Plain sum again.
  return tbH + vbH; }
/* ── HOW FAR DOWN A FLOATING MENU MAY START ────────────────────────────────────────────────────────
   Every popup in this app clamps its top to a bare `8`, on the reasoning that the chrome above it is
   the app's OWN titlebar — web content, which a menu's z-index sits over perfectly well.
   ⚠ THIS USED TO ALSO FLOOR AGAINST --tabH: a native window-TAB BAR was the one exception no z-index
   could help, an AppKit view in the window's theme frame drawn above the WKWebView entirely, so a menu
   positioned under it was unreachable rather than merely behind something. Gone with window tabbing
   itself (see the module-level note near the top of app/__main__.py) — there is no such view left to
   be unreachable behind, so this is the bare constant every popup already clamps to. */
function menuTopBound(){ return 8; }
/* A status-bar pull-down's max-height is a viewport-relative CSS cap (min(Npx,70vh) — see menuTopBound's
   own kind of concern, "never overflow the top of the document viewport"), which on a short window can
   land partway through a row: CSS has no way to floor a vh-derived length to a whole multiple of a row's
   own height. Reads the list's ACTUAL RENDERED height, not getComputedStyle's max-height property — the
   two disagree exactly in the case this exists for, a flex child (.lmlist inside .langmenu) compressed
   below its own CSS cap by an outer viewport-relative constraint, where the property still reports its
   unshrunk cap while the box itself is shorter.
   ⚠ ROWS ARE NOT UNIFORM HEIGHT, so a single measured row times a floored count is the wrong shape — the
   Script menu's rows carry an "unavailable" tier badge on some rows and not others (naTag), so the first
   row's height is not every row's height, and floor(budget/firstRowHeight) could cut mid-row exactly as
   often as it fixed it. This instead walks each row's own cumulative bottom edge and keeps the LAST one
   that still fits the budget — correct for uniform rows (.lmlist) and heterogeneous ones (.trmenu) alike,
   since it never assumes a repeating unit. scrollTop is reset first so "the budget" and "the rows" are
   measured from the same top, not wherever a previous open happened to leave the scroll position. Call
   after the list is populated and shown (so the real height reflects the current viewport) and before a
   caller reads offsetHeight for positioning off it.
   ⚠ THE CONTAINER'S OWN BOTTOM PADDING HAS TO BE RESERVED, NOT JUST THE LAST ROW's BOTTOM EDGE — box-sizing
   is border-box here, so `budget` (the border-box height) already includes padding-top AND padding-bottom,
   but a row-fit test against the raw budget lets a row's bottom land right at the padding-bottom's own
   inner edge, leaving nothing after it: measured, a 6px top padding against a 0.5px (border-only) bottom
   gap. Rows are tested against budget MINUS the bottom padding/border, and that same amount is added back
   onto the final cut, so the visible gap below the last row matches the one above the first.
   ⚠ OPTIONAL THIRD ARG — a BUDGET IN PX TO FLOOR AGAINST, in place of the container's own rendered height.
   Every existing caller omits it and gets the old behaviour verbatim (measure `list` itself, post-CSS-cap).
   It exists for a caller that already knows a SMALLER ceiling than the CSS max-height/70vh cap would give —
   openOrthoMenu's constrained-band branch, which has `y-6-bound` px of actual screen room above the pill,
   less than what the unconstrained menu would render at. Setting `m.style.maxHeight` to that raw figure
   without re-flooring (the bug this parameter fixes) can still land mid-row, exactly as the un-floored CSS
   cap could; passing the same figure here re-runs the same whole-row walk against IT instead of against the
   element's natural height, so the smaller band gets the same whole-row/even-padding treatment the
   full-room case already had. Same units as the no-arg path (border-box px) since both feed the identical
   walk below. */
function snapListRows(list,rowSel,budgetPx){ if(!list) return;
  list.style.maxHeight="";   // clear a previous call's snap first — these elements are cached/reused across opens, and measuring on top of a stale inline cap would only ever shrink further, never grow back when there's more room
  list.scrollTop=0;
  const rows=list.querySelectorAll(rowSel); if(!rows.length) return;
  const cs=getComputedStyle(list), padBot=(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.borderBottomWidth)||0);
  // an explicit budget is a screen-space constraint, not a measurement of `list` — using it in place of the
  // rendered height is the whole point (see the param's own note above), so it bypasses getBoundingClientRect
  const budget=(budgetPx!=null)?budgetPx:list.getBoundingClientRect().height; if(!(budget>0)) return;
  const ceil=budget-padBot;
  const top=list.getBoundingClientRect().top;
  let cut=0;
  for(const r of rows){ const b=r.getBoundingClientRect().bottom-top; if(b>ceil+0.5) break; cut=b; }
  if(cut>0) list.style.maxHeight=Math.ceil(cut+padBot)+"px"; }
/* ── THE READING POSITION SURVIVES A CHANGE IN THE TOP CHROME ────────────────────────────────────
   A tab bar appearing (or the options bar opening) makes the port shorter from the TOP. The blocks
   re-cap themselves to the new height, but the scroller does not move: the content point that was at
   the top of the port ends up that many px above it — behind the bar. So capture what the reader is
   looking at BEFORE the chrome moves and put it back after: the block nearest the port top, and its
   offset from it, which is what keeps a reader mid-block where they were instead of jumping them to a
   block boundary. Restoring is one scrollTop write, after a frame, so the recap has been laid out. */
/* ⚠ THE ANCHOR MEASURES THE PORT TOP OFF #doc's OWN PADDING, NOT docTopInset().
   The two normally agree — `.doc{padding:var(--top-chrome) …}` IS that expression, resolved (app.css)
   — but they come apart for exactly one caller, and it is the caller this pair exists for.
   docTopInset() reads the options bar's `.hidden` CLASS; the padding reads `--vbH`, which syncChrome
   writes a few statements LATER. So between the class toggle and that write, docTopInset() has already
   moved by the bar's height while nothing on screen has: an anchor captured in that window records the
   NEW inset against the OLD geometry, and the restore then lands the block one bar-height too high —
   behind the bar, which is the very thing being avoided. (The restore is the one that counts: the
   rAF'd one syncChrome fires after recapBlocks runs LAST and overrides the synchronous one
   withTopChrome does, so the torn capture is what the reader is left looking at.) The used padding
   cannot tear: it and the content it displaces are the same layout. */
function docPadTop(docEl){ const p=parseFloat(getComputedStyle(docEl).paddingTop); return isFinite(p)?p:docTopInset(); }
function captureTopAnchor(){
  const docEl=document.getElementById("doc"); if(!docEl) return null;
  const portTop=docEl.getBoundingClientRect().top+docPadTop(docEl);
  let best=null, bestD=Infinity;
  docEl.querySelectorAll(".sblock").forEach(b=>{ const r=b.getBoundingClientRect();
    if(r.bottom<=portTop+1) return;                       // wholly scrolled past → not what is being read
    const d=r.top-portTop; if(Math.abs(d)<Math.abs(bestD)){ bestD=d; best=b; } });
  // …and its INDEX as well as the node. The node is the fast path (a chrome change moves the element,
  // it does not replace it); the index is what makes this survive a caller whose `fn` RE-RENDERS, which
  // detaches every .sblock and left the restore below silently bailing on `isConnected` — the whole
  // anchor doing nothing at all for exactly the caller that most needs it (a zoom change, which is a
  // full rebuild). Same block, re-found by identity rather than by object.
  return best?{blk:best, i:best.getAttribute("data-i"), off:bestD}:null; }
function restoreTopAnchor(a){
  if(!a) return;
  const docEl=document.getElementById("doc"); if(!docEl) return;
  let blk=(a.blk&&a.blk.isConnected)?a.blk:(a.i!=null?docEl.querySelector(`.sblock[data-i="${a.i}"]`):null);
  if(!blk) return;   // re-rendered out of the virtualization window → there is nothing to align to
  const d=(blk.getBoundingClientRect().top-(docEl.getBoundingClientRect().top+docPadTop(docEl)))-a.off;   // the SAME measure the capture used (see docPadTop) — an offset restored against a different port top is not the offset that was captured
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
/* PUT SENTENCE `idx` AT THE TOP OF THE USABLE PORT. The one implementation of "take me to that
   sentence", shared by the saved-reading-position restore below and by a multi-sentence insert, which
   lands the reader on the FIRST of what it just added (js/io/bridge.js). Two things it must do that a
   bare scrollIntoView cannot: recentre the VIRTUALIZATION WINDOW first (scrollToSentence — the block
   may not be built at all, and after a big paste routinely is not), and align to just BELOW the
   overlaid titlebar + options bar rather than under them, sticky boundary headings included. Returns
   the block, or null when there is none to align to. */
function alignBlockTop(idx){
  const docEl=document.getElementById("doc"); if(!docEl||idx==null||idx<0) return null;
  const blk=(typeof scrollToSentence==="function")?scrollToSentence(idx):docEl.querySelector(`.sblock[data-i="${idx}"]`);
  if(!blk) return null;
  // item 10, on report: this used to land a sheet's FIRST block flush against the toolbar, gap and all
  // scrolled off above it — the one thing blockSnap (above) exists to prevent, since it's what makes a new
  // sheet read as a fresh page rather than one clipped at the top. Same charge, same guard (0 for every
  // other block, and in unpaged view, so this is the old expression everywhere else): a saved-position
  // restore or a multi-sentence insert landing on a sheet's first block now leaves the gap visible instead
  // of requiring a follow-up wheel nudge to reveal it via blockSnap's own re-park.
  docEl.scrollTop+=blk.getBoundingClientRect().top-docEl.getBoundingClientRect().top-docTopInset()-(typeof stickyHeadH==="function"?stickyHeadH(blk):0)-(typeof sheetGapAbove==="function"?sheetGapAbove(blk):0);
  return blk; }
function restoreScrollPos(idx){ if(idx==null||idx<0) return;   // no saved anchor → leave at the top
  const apply=()=>{ alignBlockTop(idx); };   // item 1: align the saved block's top with just BELOW both overlaid bars, not under them — same technique as blockSnap, sticky boundary headings included (a restored position that puts the block under its own heading hides the very line the reader left off at)
  requestAnimationFrame(()=>requestAnimationFrame(apply)); setTimeout(apply,480); }   // re-apply after settleAlign's ~450ms re-layout lands
addEventListener("beforeunload",()=>saveScrollPos(true));
document.getElementById("doc").addEventListener("scroll",()=>{ const st=document.getElementById("doc").scrollTop;
  pageScrollAt=performance.now();   // the page is moving — see pageMoving() above, which the wheel owner test consults
  const v=snapST==null?Infinity:Math.abs(st-snapST); snapST=st;   // per-tick scroll speed
  clearTimeout(snapTimer); snapTimer=setTimeout(blockSnap,240);   // ALWAYS re-arm a settle timer: it fires ~240ms after the LAST scroll event (however tiny), so a scroll that stops near a boundary always gets re-checked
  if(!snapping && v<=SNAP_SPEED) blockSnap();   // and snap right away once the scroll has decelerated to a crawl (blockSnap self-guards against its own smooth-scroll animation)
  saveScrollPos();   // remember the reading position for this file (debounced)
  if(scrollRaf)return; scrollRaf=true; requestAnimationFrame(()=>{scrollRaf=false;
  const st2=document.getElementById("doc").scrollTop, up=lastST!=null&&st2<lastST-0.5; lastST=st2; maybeShiftFocus(up); maybeShiftWindow(); }); });

