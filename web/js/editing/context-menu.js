//@module js/context-menu.js
/* context menus */
const ctx=document.getElementById("ctx");
const ctx2=document.createElement("div"); ctx2.className="ctx ctx-sub"; document.body.appendChild(ctx2);   // one nested flyout for "Other ▸"
// item forms accepted: null → separator; [label,kbd,fn,danger] tuple; {header} → section label; {label,expand,kbd,fn,danger,sub,disabled}
function normItem(it){ return (it==null||Array.isArray(it)) ? (it&&{label:it[0],kbd:it[1],fn:it[2],danger:it[3]}) : it; }
function makeCtxButton(it,isSub){ const b=document.createElement("button"); if(it.danger)b.className="danger"; if(it.opt)b.classList.add("opt");
  if(it.optval!=null) b.dataset.optval=it.optval;   // the row's own VALUE (a relation, a UPOS) — how weightMenuRows finds it again once the pipeline's ranking arrives
  if(it.disabled) b.disabled=true;   // a row that is SHOWN but inert — the column chooser's obligatory ID/Form rows, which still carry their checkmark. A real `disabled` attribute rather than a class, so it also can't be reached by keyboard or by a synthesised click; the kits dim it and drop its hover (.ctx button:disabled)
  if(it.footLink)b.classList.add("ctx-footlink");   // item 1: openSub lifts this row into the flyout's FIXED footer (an ordinary .ctx button, not a full-bleed sticky bar). This replaced an earlier `sticky:true` form (a position:sticky full-bleed bar, .ctx-sticky) that rode at the bottom of the SCROLLING list rather than sitting below it — the footer is what both callers actually wanted, so the sticky form has no users left and both it and its rule are gone
  let inner="";
  if(it.expand) inner+=`<span class="expand">${it.expand}</span>`;
  else if(it.kbd && !it.sub && !it.subRight) inner+=`<span class="kbd">${it.kbd}</span>`;
  if(it.sub) inner+=`<span class="subarr"></span>`;                               // only the left-click flyout (Wiktionary) shows a chevron.right mask glyph; the right-click deep-feature submenus carry no indicator
  const right = inner ? `<span class="rightgrp">${inner}</span>` : "";
  b.innerHTML=`${it.check?'<span class="ck">✓</span>':""}<span class="mlbl">${it.label}</span>${right}`;   // mlbl, not lbl → avoid the diagram .lbl rule (monospace/bold)
  if(it.sub){ const raise=()=>{ if(ctx2.classList.contains("show")&&ctx2._owner===b) return;   // already this row's flyout → leave it alone rather than rebuild it under the pointer
      openSub(b,it.sub,it.subFit); };                                              // subFit → shrink the flyout to its content width instead of the shared 224px floor
    b.onclick=e=>{ e.stopPropagation(); clearTimeout(b._subHov); raise(); };       // clicking is just the impatient path to the same thing
    /* item 7 — A FLYOUT OPENS ON HOVER, which is what a native menu does; a click was never meant to be the only
       way in. The delay is what makes that bearable: without it, a pointer travelling down the menu towards some
       other row raises and tears down a flyout for every sub-row it crosses on the way. 140 ms is long enough to
       ignore a pass-through and short enough not to feel like a wait.
       RIGHT-CLICK FLYOUTS ARE EXCLUDED, deliberately (the `subRight` branch below has no hover of its own): those
       are the deep-feature submenus, a deliberate second gesture on a row that already does something on left
       click, and opening them merely by passing over would fire them constantly while choosing a relation. */
    b.onmouseenter=()=>{ clearTimeout(b._subHov); b._subHov=setTimeout(raise,140); };
    b.onmouseleave=()=>{ clearTimeout(b._subHov); };   // cancels only a PENDING open — an already-raised flyout survives the pointer leaving, per the note below
  }
  else { b.onclick=()=>{ closeCtx(); it.fn&&it.fn(); };                            // left-click → the row's own action (for a relation, selecting it clears any deep feature)
    // item 3: mousing away from a flyout must NOT dismiss it — a flyout closes only on an explicit action (a click
    // elsewhere, Escape, a selection, or reopening it). (Previously hovering a sibling top-level row closed it.)
    if(it.subRight) b.oncontextmenu=e=>{ e.preventDefault(); e.stopPropagation();   // right-click the row → its deep-feature submenu; a second right-click on the SAME row dismisses it
      if(ctx2.classList.contains("show") && ctx2._owner===b){ closeSub(); return; }
      openSub(b,it.subRight,false,it.subColSize); };   // item 3: subColSize → size to one parent column, parent height
  }
  return b; }
// headers open a .catgrp wrapper so a category never splits across columns; two-col picks the split that best balances the two column heights (rtl → first column on the right)
function renderMenu(host,items,twoCol,rtl,isSub){ host.innerHTML="";
  const head=[], groups=[], tail=[]; let grp=null, gr=0;   // head: full-width note rows pinned ABOVE the (possibly two-column) group area
  const closeGrp=()=>{ if(grp){ groups.push({el:grp,rows:gr}); grp=null; gr=0; } };
  items.forEach(it=>{
    if(it==null){ closeGrp(); tail.push(document.createElement("hr")); return; }
    if(it.note!=null){ closeGrp(); const n=document.createElement("div"); n.className="note"; n.textContent=it.note; head.push(n); head.push(Object.assign(document.createElement("hr"),{className:"note-rule"})); return; }   // e.g. the deprel menu's "right-click for deep features" hint. item 1: every hint gets a horizontal rule below it, separating it from the rows
    if(it.header!=null){ closeGrp(); grp=document.createElement("div"); grp.className="catgrp"; const h=document.createElement("div"); h.className="hdr"; h.textContent=it.header; grp.appendChild(h); gr=1; return; }
    if(it.input){ closeGrp(); const row=document.createElement("div"); row.className="ctxinput"; const inp=document.createElement("input");
      inp.className="cin"; inp.spellcheck=false; inp.placeholder=it.placeholder||""; inp.value=it.value||""; inp.dir="ltr"; inp.size=1;   // size=1 → the field's intrinsic width can't force a content-fitted (deep) menu wider; width:100% still fills the row
      const stop=ev=>ev.stopPropagation(); inp.addEventListener("mousedown",stop); inp.addEventListener("click",stop);   // clicking the field must not trip the document-level closeCtx
      inp.addEventListener("keydown",ev=>{ ev.stopPropagation(); if(ev.key==="Enter"){ ev.preventDefault(); it.commit(inp.value.trim()); } });   // Enter commits; keep keys off the global shortcut handlers
      row.appendChild(inp); tail.push(row); return; }
    const b=makeCtxButton(it,isSub); if(grp){ grp.appendChild(b); gr++; } else tail.push(b); });
  closeGrp();
  head.forEach(h=>host.appendChild(h));
  if(twoCol && groups.length>1){ const wrap=document.createElement("div"); wrap.className="twocolwrap";
    const c1=document.createElement("div"), c2=document.createElement("div"); c1.className=c2.className="mcol";
    const total=groups.reduce((a,g)=>a+g.rows,0); let split=1,bd=Infinity,cum=0;
    for(let k=1;k<groups.length;k++){ cum+=groups[k-1].rows; const diff=Math.abs(cum-(total-cum)); if(diff<=bd){ bd=diff; split=k; } }   // <= → tie-break toward a taller first column
    groups.forEach((g,i)=>(i<split?c1:c2).appendChild(g.el));
    wrap.appendChild(c1); wrap.appendChild(c2);   // dir=rtl on the menu reverses the visual order (c1 stays the reading-first column)
    host.appendChild(wrap);
    const cw=Math.max(c1.offsetWidth,c2.offsetWidth); c1.style.width=c2.style.width=cw+"px"; }   // each column is otherwise sized to its OWN widest row — force both to the wider column's width so they never look lopsided
  else groups.forEach(g=>host.appendChild(g.el));
  tail.forEach(t=>host.appendChild(t));   // "Guidelines" (and its separator) span full width below both columns
  localiseAccel(host); }   // Windows: rewrite this menu's .kbd shortcut column (⌃⌘↑ → Ctrl+Alt+Up). Here rather than in makeCtxButton, so EVERY menu — token, sentence, MWT, bracket, flyout — is covered by one call, whatever builds it; a no-op on macOS
// Trim a flyout's height so it ends on a ROW BOUNDARY — a whole number of definitions, never a sense sliced
// through the middle, which reads as a rendering fault rather than as "there is more below".
// It cannot be a fixed multiple of a row height: a sense WRAPS (see .ctx-sub.defctx's width cap), so rows differ
// in height within one flyout. So the rows are walked and the height set to the bottom of the last one that fits
// entirely inside the cap already computed above.
//   · The scroll port is .ctx-sub-scroll once the footer link has been lifted out, else the flyout itself; the
//     footer never scrolls, so its height is not the row area's to spend (hence the two branches below).
//   · A `.hdr` gender heading counts as a row and is never left as the last visible thing — a heading alone at
//     the bottom promises rows that aren't shown. It is `position:sticky`, so it also can't be measured by
//     offsetTop while pinned; every measurement here is a live rect read against the port's own top, which is
//     immune to that.
//   · If even the FIRST row is taller than the cap (a long wrapped sense in a short flyout), keep that one row
//     and let it scroll: showing nothing would be worse than showing one clipped sense, and the alternative —
//     growing past the cap — would run the flyout off the screen the cap exists to keep it on.
// Deliberately measured rather than derived from CSS: the row height depends on the wrap, which depends on the
// width, which is only final at this point in render().
function fitWholeRows(host){
  const foot=host.querySelector(".ctx-sub-footer");
  const port=host.querySelector(".ctx-sub-scroll")||host;
  const cap=parseFloat(getComputedStyle(host).maxHeight); if(!isFinite(cap)) return;
  const cs=getComputedStyle(port), padB=parseFloat(cs.paddingBottom)||0, padT=parseFloat(cs.paddingTop)||0;
  // `cap` is a max-height on the FLYOUT, but the rows are measured inside the PORT. Where the footer lift has
  // made the port a child (.ctx-sub-scroll carries padding-inline only), the flyout's own block padding sits
  // OUTSIDE the port and is not the rows' to spend — miss it and the budget runs 2×5px long, which is exactly
  // enough for the last accepted row to overflow the box and be clipped. Where port===host the same two values
  // are already `padT`/`padB` below, so this contributes nothing and must not be double-counted.
  const hcs=(port===host)?null:getComputedStyle(host);
  const hostPad=hcs?((parseFloat(hcs.paddingTop)||0)+(parseFloat(hcs.paddingBottom)||0)):0;
  const avail=cap-(foot?foot.getBoundingClientRect().height:0)-padT-padB-hostPad;
  if(!(avail>0)) return;
  const rows=[...port.querySelectorAll("button,.hdr,hr,.note,.ctxinput")];
  if(!rows.length) return;
  const top=port.getBoundingClientRect().top+padT-port.scrollTop;   // the row area's own origin, scroll-independent
  let fitH=0;
  for(const r of rows){ const b=r.getBoundingClientRect().bottom-top;
    if(b>avail+0.5) break;                                          // +0.5: sub-pixel rects must not drop a row that visually fits
    if(!r.classList.contains("hdr")) fitH=b; }                      // a heading only counts once a row UNDER it also fits
  if(!fitH) fitH=rows[0].getBoundingClientRect().bottom-top;        // nothing fits whole → keep one row and scroll
  const h=Math.ceil(fitH+padT+padB);
  if(foot) port.style.maxHeight=h+"px"; else host.style.maxHeight=h+"px"; }
let _subLoadToken=0;   // invalidates a still-pending async sub (item.sub as a function) once the flyout is reopened/closed
function openSub(btn,items,fit,colSize){ _subLoadToken++; const myToken=_subLoadToken; ctx2._owner=btn;   // remember which row opened this flyout → a second right-click on it toggles it shut
  if(!ctx2.isConnected) document.body.appendChild(ctx2);   // closeSub() removes ctx2 from the DOM entirely (see its own comment) — put it back before showing it again
  ctx2.classList.toggle("defctx",!!fit);   // fit → shrink-to-content (e.g. Wiktionary "Definitions of …", whose rows are often much narrower than the shared 224px floor); reset for every other flyout (the deep-feature subRight menus keep the floor)
  // item 3 — the POS-subtype flyout matches ONE column of the (two-column) POS menu in width, and the whole POS
  // menu in height. Measure them off the live parent menu now, before rendering the flyout.
  const colEl=colSize?ctx.querySelector(".mcol"):null, colW=colEl?colEl.getBoundingClientRect().width:0, parentH=colSize?ctx.offsetHeight:0;
  // item 3 — …and the shrink-to-fit ("Definitions of …"/"Readings of …") flyout is capped at the WHOLE parent
  // menu's width, the same measure-off-the-live-parent trick one line up. Same reason a flyout is already capped
  // at the parent's HEIGHT (render() below): a panel hinged off a menu shouldn't outgrow the menu it hangs from.
  // This replaces the fixed 320px reading measure in `.ctx-sub.defctx`, which survives as the fallback below.
  // Floored at 224px — the shared `.ctx{min-width:224px}` every ordinary menu already sits at — so a pathologically
  // narrow parent (only a `.defctx` menu can be, `min-width:0`; none of those has a sub row today) can't squeeze
  // the flyout below one normal menu's width, and can't drag the min-width floor clamp in render() down with it.
  const parentW=Math.max(ctx.offsetWidth,224);
  const positionSub=()=>{ const r=btn.getBoundingClientRect(); let left=r.right-2; if(left+ctx2.offsetWidth>innerWidth-8) left=r.left-ctx2.offsetWidth+2;
    ctx2.style.left=Math.max(8,left)+"px"; ctx2.style.top=Math.max(menuTopBound(),Math.min(r.top-5,innerHeight-ctx2.offsetHeight-8))+"px"; };   // item 6: clamp the TOP too (matches showCtx's own Math.max(8,...) on both axes) — a TALL colSize flyout (as tall as the whole POS menu) anchored near a LOW row could otherwise compute a negative top and render mostly off the top of the screen, making it look unresponsive to clicks/Escape that land on the (invisible) area instead
  // item 1 — lift the footer link out of the scrolling content into a FIXED footer: the rows above scroll, the
  // link (and its separator) stay put at the bottom, always visible.  Called from BOTH flyout shapes — the
  // colSize POS-subtype menu ("Guidelines for …") and the shrink-to-fit "Definitions of …" list ("Open …") —
  // which is why it lives out here rather than inside the colSize branch it was first written in.
  const liftFootLink=()=>{ const guide=ctx2.querySelector(".ctx-footlink"); if(!guide) return;
    const prevHr=(guide.previousElementSibling&&guide.previousElementSibling.tagName==="HR")?guide.previousElementSibling:null;   // the caller precedes the row with a `null` separator; that <hr> belongs with the link in the footer, not at the end of the scrolling rows
    const foot=document.createElement("div"); foot.className="ctx-sub-footer"; if(prevHr)foot.appendChild(prevHr); foot.appendChild(guide);   // moves prevHr+guide OUT of ctx2 into foot
    const scroll=document.createElement("div"); scroll.className="ctx-sub-scroll"; while(ctx2.firstChild) scroll.appendChild(ctx2.firstChild);   // everything remaining scrolls
    ctx2.appendChild(scroll); ctx2.appendChild(foot); ctx2.classList.add("ctx-sub-foot"); };
  const render=arr=>{ ctx2.classList.remove("ctx-sub-foot"); ctx2.dir=ctx.dir; renderMenu(ctx2,(arr||[]).map(normItem),false,undefined,true); ctx2.classList.add("show");
    ctx2.style.maxWidth=fit?parentW+"px":"";   // item 3: the parent menu's width is the shrink-to-fit flyout's ceiling (see .ctx-sub.defctx in app.css). Cleared for every other flyout — the property is inline, so a previous .defctx call's ceiling would otherwise stick to the next (non-fit) one. Set BEFORE the layout reads below: both the header floor's clamp (which re-reads it off getComputedStyle, so it needs no separate wiring) and positionSub's offsetWidth depend on it
    if(colSize&&colW){ ctx2.style.width=Math.round(colW)+"px"; ctx2.style.minWidth=""; ctx2.style.height=""; ctx2.style.maxHeight=parentH+"px";   // item 2: ONE parent column wide, content-height but NO TALLER than the POS menu (maxHeight, not a fixed height)
      liftFootLink();
      return void positionSub(); }
    ctx2.style.width=""; ctx2.style.height="";
    ctx2.style.maxHeight=Math.max(60,Math.min(420,innerHeight*.7,ctx.offsetHeight))+"px";   // never taller than the parent menu it flies out from, on top of the existing 420px/70vh caps — but never SHORTER than one row needs either: a short parent menu (few items) could otherwise cap this below even the single-row "Loading…"/"Nothing found"/"Couldn't load" placeholder's own height, clipping it before any real content arrives to grow the flyout naturally
    ctx2.style.minWidth="";   // clear any previous call's floor before re-measuring — a later render (e.g. "Loading…" → real senses) must never be held to an EARLIER row's width
    liftFootLink();   // BEFORE the header measurement below, which reads ctx2.offsetWidth — the lift restructures the flyout into a flex column, so measuring first would size the floor against the pre-lift box
    const hdrs=[...ctx2.querySelectorAll(".hdr")].map(h=>h.textContent);   // .hdr rows (gender groupings, "Loading…"/"Nothing found"/"Couldn't load") are position:sticky with a negative margin for their full-bleed background (see .ctx-sub.defctx .hdr) — some engines under-count that combination's contribution to a shrink-to-fit ancestor's width, clipping the header TEXT even though the identical string in a plain (non-sticky) row would fit fine. Sidestep it with a direct floor from the SAME canvas measurement technique acPos() already uses for the autocomplete menu, rather than fight the engine-dependent shrink-to-fit interaction itself.
    if(hdrs.length){ const need=Math.max(0,...hdrs.map(t=>meas(t,'700 10px '+uiFont())))+26;   // uiFont() (js/core/platform.js) resolves --ui-font to a plain family list — a measurement font string cannot carry a var(), and the hard-coded SF Pro stack this replaced measured the macOS face on Windows, where .hdr actually renders in Segoe   // +26: the container's 12px×2 padding, plus a couple px slack
      const cap=parseFloat(getComputedStyle(ctx2).maxWidth);   // the .defctx ceiling — now the parent menu's own width, set inline a few lines up (the 320px reading measure in .ctx-sub.defctx is only the fallback); NaN here for any flyout that isn't .defctx, since maxWidth computes to "none"
      if(need>ctx2.offsetWidth) ctx2.style.minWidth=Math.min(need,cap||Infinity)+"px"; }   // CLAMP the floor to that ceiling: min-width beats max-width in CSS, so a header long enough to demand more than the cap would silently win and the flyout would grow past the measure the senses themselves are held to. Today's headers (gender names, "Loading…") are ~110px at 700 10px and nowhere near it — the clamp is here so the two can never fight if either number moves
    fitWholeRows(ctx2);   // …then pull the height back to a ROW BOUNDARY (see below). LAST, so it measures the final layout: after the width ceiling, the header floor and the footer lift, all of which change where the rows wrap and therefore how tall they are
    positionSub(); };
  if(typeof items==="function"){   // a submenu built on demand: a SYNC result (a relation's deep features) renders at once; a PROMISE (e.g. Wiktionary) shows a placeholder, then swaps in the fetched rows
    let res; try{ res=items(); }catch(e){ res=null; }
    if(res && typeof res.then==="function"){ render([{header:"Loading…"}]);
      res.then(arr=>{ if(myToken===_subLoadToken) render(arr&&arr.length?arr:[{header:"Nothing found"}]); })
        .catch(()=>{ if(myToken===_subLoadToken) render([{header:"Couldn't load"}]); }); }
    else render(res||[]);
    return; }
  render(items); }
function closeSub(){ _subLoadToken++; ctx2.classList.remove("show"); ctx2._owner=null;   // clear ownership too — a stale _owner surviving a close is otherwise the one thing that could make a LATER right-click on some unrelated row misread as "the same row, toggle it shut" instead of opening fresh
  if(ctx2.isConnected) ctx2.remove(); }   // WKWebView/backdrop-filter compositing bug: display:none from removing "show" can leave a stale GPU layer painted on screen even though the DOM/computed style are already correct (confirmed via inspector — no amount of Escape/click/scroll/resize/forced-reflow repaints it away). An actual DOM removal is the one thing guaranteed to tear the layer down, since a detached node can't stay painted — openSub() re-appends ctx2 before showing it again
// `fit` → shrink the menu to its widest row instead of the shared 224px floor (.ctx.defctx), for a short menu of
// short labels that the floor would leave visibly empty — the status-bar Format menu. Toggled (never just added) so
// it resets for every caller that doesn't ask for it; the class must land BEFORE the offsetWidth read below, which
// is what the placement clamp measures. Same treatment the Wiktionary flyout gets on ctx2 (see openSub's `fit`).
function showCtx(x,y,items,twoCol,rtlArg,fit){ const norm=items.map(normItem);
  const rtl = rtlArg!=null ? rtlArg : !!(sel && sel.s>=0 && sel.s<DOC.length && sentRTL(DOC[sel.s]));   // callers that don't pre-select (POS/deprel label menus) pass their sentence's direction explicitly
  ctx.dir=rtl?"rtl":"ltr";   // RTL sentence → mirror the whole menu (text, checkmarks, headings, the two-column rule)
  ctx.classList.toggle("defctx",!!fit);
  ctx.classList.remove("colmenu");   // cleared on EVERY open; columnMenu re-adds it for itself, so the class can never leak onto the next menu to use this shared #ctx
  renderMenu(ctx,norm,!!twoCol && norm.filter(it=>it&&!it.header&&!it.sub).length>12, rtl); closeSub();
  ctx.classList.add("show"); ctx._openedAt=Date.now();   // stamp open time: a menu opened right after a pick()/renderDoc must ignore that re-render's ASYNC scroll event (else it self-closes → the long-standing "right-click a bracket token does nothing")
  // item 1 — now the menu is laid out, cap any hint (.note) to the two-column group width so a longer note WRAPS
  // within the columns instead of forcing the whole menu wider than them. (Widths are 0 during renderMenu, when
  // the menu is still hidden, so this must run AFTER .show.)
  const cols=[...ctx.querySelectorAll(".twocolwrap .mcol")];
  if(cols.length===2){ const ww=cols[0].offsetWidth+cols[1].offsetWidth+13; ctx.querySelectorAll(".note").forEach(nn=>nn.style.maxWidth=ww+"px"); }   // the INTRINSIC two-column width (each .mcol is content-sized, not stretched to the note-widened host) + the 12px inter-column rule/padding
  const w=ctx.offsetWidth, h=ctx.offsetHeight;
  let left = rtl ? x-w : x;   // RTL → the menu opens to the bottom-left of the cursor
  ctx.style.left=Math.max(8,Math.min(left,innerWidth-w-8))+"px"; ctx.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-h-8))+"px"; }   // menuTopBound (js/core/scroll.js): the NATIVE window-tab bar is the one thing a menu cannot be drawn over, so it is not drawn under it either
function closeCtx(){ ctx.classList.remove("show"); closeSub(); void ctx.offsetHeight;   // same forced-reflow fix as closeSub, for ctx's own backdrop-filter layer
  if(typeof setPillMenuOpen==="function") setPillMenuOpen("fmtPill",false); }   // the Format pill borrows this shared #ctx for its own menu (fmtMenu, js/io/formats.js) and its chevron has to point back UP however the menu was dismissed — Escape, a pick, a click outside, or another menu stealing #ctx. Unconditional and idempotent: for every OTHER #ctx menu the pill is already un-flagged, so clearing it again costs a no-op class toggle. typeof-guarded because this file loads before js/ui/wiring.js, which defines the helper — harmless at runtime (closeCtx only ever runs from a handler, long after both are defined), but the guard is what the codebase's forward-reference rule asks for
addEventListener("click",closeCtx); addEventListener("scroll",e=>{ if(e.target===ctx||ctx.contains(e.target)||e.target===ctx2||ctx2.contains(e.target)) return;   // a scroll INSIDE the menu itself (e.g. the Wiktionary "Definitions of …" flyout's own overflow-y:auto list) must not dismiss it — only a scroll of whatever's BEHIND the menu should
  if(ctx.classList.contains("show") && Date.now()-(ctx._openedAt||0)<250) return; closeCtx(); },true);   // ignore the programmatic scroll from the pick()/re-render that immediately precedes a menu open; a genuine later user-scroll still closes it
addEventListener("keydown",e=>{ if(e.key!=="Escape")return;   // item 3: Escape dismisses an open flyout (e.g. a POS-subtype submenu) FIRST, keeping the parent menu; a second Escape closes the parent
  if(ctx2.classList.contains("show")){ closeSub(); e.preventDefault(); e.stopPropagation(); return; }
  if(ctx.classList.contains("show")){ closeCtx(); e.preventDefault(); e.stopPropagation(); } },true);
// item 4: Escape closes an open options-bar drawer or a status-bar button-menu (Script/Displayed/Stored) and STOPS
// (the language menu + URL popover own their Escape via their focused inputs; don't double-handle them here).
addEventListener("keydown",e=>{ if(e.key!=="Escape")return;
  const drawer=document.querySelector("#toggles .drawer.open");
  const menu=(typeof _trMenu!=="undefined"&&_trMenu&&_trMenu.classList.contains("show"))||(typeof _stMenu!=="undefined"&&_stMenu&&_stMenu.classList.contains("show"))||(typeof _orMenu!=="undefined"&&_orMenu&&_orMenu.classList.contains("show"));
  if(drawer||menu){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if(drawer)drawer.classList.remove("open"); if(typeof trClose==="function")trClose(); if(typeof stClose==="function")stClose(); if(typeof orClose==="function")orClose(); }
},true);
/* right-click a relation label or POS tag → link to its guidelines page */
// map a right-clicked diagram label (SVG group or outline row) to its token
function tokFromEl(el){ const g=el.closest&&el.closest("[data-s]"); if(!g)return null;
  const si=+g.getAttribute("data-s"); let t=g.getAttribute("data-tok"); if(t==null)t=g.getAttribute("data-dep");
  return t==null?null:{si,tokId:+t}; }
// UPOS full names + categories (for menu expansions and grouping)
const UPOS_INFO={ADJ:"adjective",ADP:"adposition",ADV:"adverb",AUX:"auxiliary",CCONJ:"coordinating",DET:"determiner",INTJ:"interjection",NOUN:"noun",NUM:"numeral",PART:"particle",PRON:"pronoun",PROPN:"proper noun",PUNCT:"punctuation",SCONJ:"subordinating",SYM:"symbol",VERB:"verb",X:"other"};
const UPOS_CATS=[["Open class",["NOUN","PROPN","VERB","ADJ","ADV","INTJ"]],["Nominals",["DET","NUM","PRON"]],["Obliques",["ADP","CCONJ","SCONJ"]],["Miscellaneous",["AUX","PART"]],["Other",["PUNCT","SYM","X"]]];
// SUD relation glosses + categories
const DEPREL_INFO={root:"root",subj:"subject",udep:"unspecified","comp:obj":"object","comp:obl":"oblique","comp:pred":"predicative","comp:aux":"auxiliary","comp:cleft":"cleft",comp:"complement",mod:"modifier","mod@relcl":"rel. clause",det:"determiner",clf:"classifier",cc:"coordinator",conj:"conjunct","conj:coord":"coordination","conj:appos":"apposition","conj:dicto":"disfluency",flat:"flat",compound:"compound",list:"list",goeswith:"goes with",orphan:"orphan",parataxis:"parataxis","parataxis:parenth":"⁓etical","parataxis:insert":"insertion",dislocated:"dislocated",discourse:"discourse",vocative:"vocative",punct:"punctuation",unk:"unknown"};   // short glosses so the menu expansions don't cross the two-column midline
const DEPREL_CATS=(()=>{   // each mSUD "/m" relation is interleaved right after its non-"/m" counterpart, within its category (the /m entries only surface for mSUD docs — the vocabulary passed to the menu/grid gates them)
  const base=[["Arguments",["subj","comp","comp:obj","comp:obl","comp:pred","comp:aux","comp:cleft"]],["Modifiers & specifiers",["mod","det","clf"]],["Coordination",["cc","conj","conj:coord","conj:appos","conj:dicto"]],["Macrosyntax",["parataxis","parataxis:parenth","parataxis:insert","dislocated","discourse","vocative"]],["Special",["compound","orphan","goeswith"]],["Other",["flat","list","punct","root","udep","unk"]]];
  const used=new Set();
  const cats=base.map(([name,members])=>{ const out=[]; members.forEach(m=>{ out.push(m); const mm=m+"/m"; if(MORPH_DEPRELS.includes(mm)){ out.push(mm); used.add(mm); } }); return [name,out]; });
  const rest=MORPH_DEPRELS.filter(m=>!used.has(m));   // any /m relation with no non-/m counterpart above (e.g. a bare "/m")
  if(rest.length){ const other=cats.find(c=>c[0]==="Other"); if(other) other[1]=other[1].concat(rest); else cats.push(["Other",rest]); }   // fold leftover (bare "/m") into the existing "Other" group — no separate "Morphological" heading; /m reads as Other
  return cats; })();
function deprelExpand(r){ const morph=/\/m$/.test(r), key=r.replace(/\/m$/,""); let e=DEPREL_INFO[key]||DEPREL_INFO[key.split("@")[0]]||""; if(morph)e=e?e+" · morph":"morph"; return e; }   // try the full relation (mod@relcl → "rel. clause") before falling back to its base
// Places every USER-ADDED ("custom") relation in `vocab` into the SAME category structure as DEPREL_CATS, instead
// of a separate catch-all "Custom" heading: a colon-suffixed custom relation (e.g. "conj:redup2", base "conj")
// slots in right after the LAST existing member sharing that base wherever that base already lives (so it reads
// as one more subtype of the family it extends); anything that shares no base with any placed relation sorts
// alphabetically at the end of "Other". Drives the relation context menu, the Help dialog grid, AND the grid's
// deprel-cell autocomplete, so all three place a given custom relation identically.
function deprelMenuGroups(vocab){
  const cats=DEPREL_CATS.map(([name,members])=>[name,members.slice()]);
  let otherCat=cats.find(c=>c[0]==="Other"); if(!otherCat){ otherCat=["Other",[]]; cats.push(otherCat); }
  const officialSet=new Set([...DEPREL_DEFAULT,...MORPH_DEPRELS]);   // MORPH_DEPRELS ("/m") are built-in, not user-added — never treat them as custom
  const custom=(vocab||[]).filter(d=>!officialSet.has(d)).slice().sort((a,b)=>a.localeCompare(b));
  const baseOf=d=>d.includes(":")?d.slice(0,d.indexOf(":")):null;
  const sharesBase=(m,base)=>m===base||(m.includes(":")&&m.slice(0,m.indexOf(":"))===base);
  custom.forEach(d=>{ const base=baseOf(d); let placed=false;
    if(base){ for(const cat of cats){ let insertAt=-1;
        cat[1].forEach((m,idx)=>{ if(sharesBase(m,base)) insertAt=idx; });
        if(insertAt>=0){ cat[1].splice(insertAt+1,0,d); placed=true; break; } } }
    if(!placed) otherCat[1].push(d); });
  return cats;
}
// hover tooltips (Item 2): a relation label → its expansion + the right-click hint; a POS tag → the UPOS full name + the hint. Reuse DEPREL_INFO/UPOS_INFO (the same maps the edit menus show).
function relTitle(r){ const e=deprelExpand(r); return (e||r||"relation")+" — right-click to change (deep features on each relation's submenu)"; }
function posTitle(p){ return (UPOS_INFO[p]||p||"part of speech")+" — right-click to change"; }
// build a categorised menu: every option grouped under headers, with right-aligned expansions and a check on the current one
function optionMenu(x,y,all,cats,expandOf,current,choose,guide,rtl,subFor,customSet,subNote,noteTop,subColSize){
  const placed=new Set(), items=[];
  if(noteTop) items.push({note:noteTop});   // item 2: a leading scope note (e.g. the external-POS menu explaining which span it tags)
  if(subFor) items.push({note:subNote||"Right-click to show available deep features for a relation"});   // the relation menu's deep features and (item 4) the POS menu's UPOS subtypes both hang off a right-click submenu, so each passes its own hint
  const row=r=>{ const o={label:esc(r), expand:expandOf(r), check:r===current, opt:true, optval:r, fn:()=>choose(r)}; if(subFor){ const sm=subFor(r); if(sm){ o.subRight=sm; if(subColSize)o.subColSize=true; } } return o; };   // subFor(r) → a submenu builder for that option (relations: deep features), or null. item 3: subColSize → size that flyout to ONE parent column, parent height
  cats.forEach(([name,members])=>{ const present=members.filter(m=>all.includes(m));
    present.forEach(m=>placed.add(m)); if(present.length){ items.push({header:name}); present.forEach(m=>items.push(row(m))); } });
  const extra=all.filter(r=>!placed.has(r));   // any options not covered by a category
  const other=customSet?extra.filter(r=>!customSet.has(r)):extra, custom=customSet?extra.filter(r=>customSet.has(r)):[];   // customSet (relMenu only) → session-added relations get their OWN "Custom" heading instead of "Other"
  if(other.length){ items.push({header:"Other"}); other.forEach(r=>items.push(row(r))); }
  if(custom.length){ items.push({header:"Custom"}); custom.forEach(r=>items.push(row(r))); }
  if(guide){ items.push(null,guide); }
  showCtx(x,y,items,true,rtl); }   // true → two-column layout (balanced) for tall menus
/* ── HOW LIKELY DOES THE PIPELINE THINK EACH OF THESE IS? ───────────────────────────────────────────
   A menu of 40 relations or 17 word classes shows every option as equally plausible, when the model
   that produced the current one ranked them all and the editor drew only the winner. Fading a row by
   the mass the model gave it turns the list into what it always was underneath — a ranking — without
   removing anything: every option stays present, in place, and clickable, because the reader
   overruling the model is the whole reason the menu exists.

   Applied AFTER the menu is on screen rather than before it opens, so a menu never waits on a bridge
   call; the ranking usually arrives within a frame (the sentence is normally already cached) and the
   rows simply settle. The stamp is what stops a slow answer from painting a menu that has since been
   closed and reopened on another token.

   ⚠ An option the ranking does not mention is dimmed to the floor, NOT left bright. Below the pruning
   threshold means the model gave it ~0, which is the honest reading for all but one case: a relation
   the DOCUMENT uses that the model was never trained on is unknown rather than unlikely, and it will
   dim too. That is the one wrong answer here, it is confined to custom relations, and the alternative
   — leaving every unranked row bright — would misreport the far commoner case as "plausible". */
const OPT_WEIGHT_FLOOR=0.4;   // a dim row must stay readable and hittable: this is a ranking, not a disablement
function weightMenuRows(p){ if(!p) return;
  const stamp=(ctx._wgen=(ctx._wgen||0)+1);
  /* ⚠ AN EMPTY MAP IS "NO RANKING", NOT "EVERYTHING IS UNLIKELY", and `{}` is truthy — so a bare
     null check dimmed every row to the floor on exactly the paths that have nothing to say (no
     model at all, or a token the morphologizer skipped), which is the one case where the menu must
     look untouched. `relWeightsFor` returns `{}` rather than null by construction, so the guard
     belongs here, where every present and future caller gets it. */
  Promise.resolve(p).then(map=>{ if(!map||!Object.keys(map).length||ctx._wgen!==stamp||!ctx.classList.contains("show")) return;
    ctx.querySelectorAll("button[data-optval]").forEach(b=>{
      const w=OPT_WEIGHT_FLOOR+(1-OPT_WEIGHT_FLOOR)*scoreShade(map[b.dataset.optval]||0);
      b.style.setProperty("--pw",w.toFixed(3)); }); }).catch(()=>{}); }
// right-click a relation label → pick a relation (grouped by role). Each relation's DEEP features live on its OWN
// submenu, reached by right-clicking that relation's row (or clicking its ▸) — replacing the old ⇧-right-click menu.
const DEEP_BY_REL={subj:["expl","pass","caus"],comp:["expl","pass"],"comp:aux":["pass","caus","tense"],"comp:obj":["pass","lvc","agent"],"comp:obl":["agent"],mod:["relcl"],"conj:coord":["emb"],flat:["name","foreign"]};   // taxo_2023: the @deep features each surface relation admits
const DEEP_UNIVERSAL=["scrap"];   // admissible on ANY relation (not tied to a specific one, unlike DEEP_BY_REL) — folded in by deepVocabFor/deepSubItems below
// admissible @deep features for ONE base relation: the taxonomy above ∪ DEEP_UNIVERSAL ∪ any @feature already used
// with that SAME relation elsewhere in the document (mirrors relMenu's dfMap, but single-relation — used by the
// grid's Deep-cell autocomplete, which only ever needs one relation's list per keystroke rather than every candidate's).
function deepVocabFor(rel){ const vocab=[...new Set([...(DEEP_BY_REL[rel]||[]),...DEEP_UNIVERSAL])], seen=new Set(vocab);
  DOC.forEach(s=>s.tokens.forEach(t=>{ if(depBase(t.deprel)===rel){ const f=depDeep(t.deprel); if(f&&!seen.has(f)){ seen.add(f); vocab.push(f); } } }));
  return vocab; }
// the deep-feature submenu for relation D on this token: "(none)" (the bare relation) + the admissible features + a free-text add.
function deepSubItems(si,tokId,D,feats){ const s=DOC[si], dep=s&&s.tokens[tokId-1]; if(!dep) return [];
  const isThis=depBase(dep.deprel)===D, cur=isThis?depDeep(dep.deprel):null;   // a checkmark only when this row IS the token's current relation
  const setDF=f=>{ closeCtx(); const nd=f?D+"@"+f:D; if(nd!==dep.deprel){ pushUndo(si); dep.deprel=nd; afterDeprelEdit(dep,s); markDirty(); preserveScroll(renderDoc); } };   // Task B: no regenTok — a deep-feature/relation edit is structural and must never trigger a gloss/MGloss recompute
  const items=[{header:(deprelExpand(D)||D)+" · deep"}];   // no "(none)" row — clicking the relation itself (in the parent menu) is what clears the deep feature
  const allFeats0=[...new Set([...feats,...DEEP_UNIVERSAL])];   // scrap is always offered, on top of whatever taxonomy/file-usage feats already carries
  // standard (DEEP_OFFICIAL) features keep their taxonomy order; non-standard ones (corpus-specific, picked up
  // from the document's own usage) always sort alphabetically AFTER them, never interleaved.
  const isStdDeep=f=>DEEP_OFFICIAL.includes(f);
  const allFeats=[...allFeats0.filter(isStdDeep), ...allFeats0.filter(f=>!isStdDeep(f)).sort((a,b)=>a.localeCompare(b))];
  allFeats.forEach(f=>items.push({label:"@"+esc(f), expand:DEEP_INFO[f]||"", check:cur===f, opt:true, fn:()=>setDF(f)}));
  if(allFeats.length) items.push(null);
  items.push({input:true, value:"", placeholder:"New deep feature…", commit:v=>setDF((v||"").replace(/^@/,"").trim())});   // add a deep feature to THIS relation (Enter commits)
  if(cur) items.push(null,[`Guidelines for “@${esc(cur)}”`,"↗",()=>openExternal(deepGuideUrl(cur))]);   // the token's CURRENTLY-set deep feature (not just any admissible one) gets a direct link
  return items; }
function relMenu(x,y,si,tokId){ const s=DOC[si]; if(!s)return; const dep=s.tokens[tokId-1]; if(!dep)return;
  let cands=(DOCFORMAT==="mSUD"?SETTINGS.deprel.concat(MORPH_DEPRELS):SETTINGS.deprel.slice());   // "root" stays in the list for every token (shown under Other) — choosing it re-roots via setAsRoot below, not just any token can silently BECOME root through the naive path
  const rb=depBase(dep.deprel);   // strip any @deep suffix (mod@relcl → mod) for BOTH the guidelines URL and its label
  const rbGuideUrl=relGuideUrl(rb);   // null for relations with no dedicated guidelines page (e.g. unk) — omit the row entirely rather than link nowhere
  const guide=rbGuideUrl?[`Open the guidelines for the “${esc(rb)}” relation`,"↗",()=>openExternal(rbGuideUrl)]:null;   // openExternal (js/io/bridge.js): window.open is inert in a WKWebView, so every external link goes through the bridge
  // admissible deep features per relation: the taxonomy ∪ any @feature already used with that relation in the document
  const dfMap={}; Object.keys(DEEP_BY_REL).forEach(k=>dfMap[k]=DEEP_BY_REL[k].slice());
  DOC.forEach(s2=>s2.tokens.forEach(t=>{ const b=depBase(t.deprel), f=depDeep(t.deprel); if(f){ (dfMap[b]=dfMap[b]||[]); if(!dfMap[b].includes(f))dfMap[b].push(f); } }));
  const subFor=r=>()=>deepSubItems(si,tokId,r,dfMap[r]||[]);   // EVERY relation gets a right-click deep-feature submenu (its taxonomy ∪ file features, or just an add-field)
  const choose=d=>{ if(d==="root"&&rb!=="root"){ setAsRoot(si,tokId); return; }   // not yet root → the FULL re-attach (migrates the old root's dependents, demotes it to udep), not a naive head=0 flip
    if(d!==dep.deprel){ pushUndo(si); dep.deprel=d; afterDeprelEdit(dep,s); markDirty(); preserveScroll(renderDoc); } };   // left-click sets the BARE relation — so clicking the current relation drops its @feature (= "(none)"); a feature is set via the row's submenu. Task B: no regenTok — structural, must never trigger a gloss/MGloss recompute
  optionMenu(x,y,cands,deprelMenuGroups(cands),deprelExpand,depBase(dep.deprel),choose,guide,sentRTL(s),subFor);   // deprelMenuGroups interleaves any user-added relation into its own family/Other — no separate "Custom" heading needed
  /* …and then fade each row by how likely the parser thinks that relation is FOR THIS EDGE — the arc it
     weighed if this is one it considered, the synthesised state if the reader made the attachment
     themselves. Pooled to the base relation by `relWeightsFor`, which is the same pooling the rows'
     own deep-feature submenus do (`mod@relcl` lives under `mod`), so the two cannot disagree.
     A ROOT has no incoming arc to condition on, so its menu is left unweighted rather than weighted
     against an edge that does not exist. */
  weightMenuRows(typeof tokenScores!=="function"?null:(async()=>{
    const h=parseInt(dep.head,10); if(!(h>=1)) return null;
    const sc=await tokenScores(si);
    const d=sc&&sc.deprels&&sc.deprels[tokId-1]&&sc.deprels[tokId-1][String(h)];
    return relWeightsFor(d||await arcLabelScores(si,tokId,h)); })()); }
// right-click a POS tag → pick a POS (all shown, grouped by class)
/* item 4 — the UD LEXICAL features: the ones that subcategorise the UPOS itself (a SUBTYPE of the tag) rather
   than inflect the word, so a token carrying one is naturally read as a dot-suffixed tag — PRON.Dem, NUM.Ord,
   DET.Poss. universaldependencies.org/u/feat groups exactly these under "Lexical features"; ExtPos, Foreign and
   Typo belong to the same group but get their own commands here (items 1/2/3) and are deliberately left out,
   and SUD's own Shared (FEATS) and Subject/Object (MISC) are bookkeeping, not word classes. Everything else in the FEATS inventory is
   inflectional and belongs on the morphemic-gloss tier, which is where its Leipzig abbreviation already goes. */
const UPOS_SUBTYPE_FEATS=["PronType","NumType","Poss","Reflex","Abbr"];
// Where each one is actually attested, per its own page at universaldependencies.org/u/feat/* — so a VERB's POS
// menu doesn't offer VERB.Ord. Abbr is unlisted on purpose: any word class can be abbreviated.
const UPOS_SUBTYPE_ON={PronType:["PRON","DET","ADV","ADJ"],NumType:["NUM","DET","ADJ","ADV"],Poss:["DET","PRON","ADJ"],Reflex:["PRON","DET"]};
function subtypeFeatsFor(upos){ return UPOS_SUBTYPE_FEATS.filter(f=>!UPOS_SUBTYPE_ON[f]||UPOS_SUBTYPE_ON[f].includes(upos)); }
// The suffix a Feat=Val wears in the dot-suffixed tag: the VALUE where it carries the content (PRON.Dem), the
// FEATURE name where the value is a bare "Yes" and so says nothing on its own (DET.Poss, not DET.Yes).
function subtypeSuffix(feat,val){ return val==="Yes"?feat:val; }
// the UD guidelines page for a feature, at the exact VALUE section (its `<a name="Val">` anchor) when one is given
function featGuideUrl(feat,val){ return "https://universaldependencies.org/u/feat/"+encodeURIComponent(feat)+".html"+(val?("#"+encodeURIComponent(val)):""); }
// item 7 — value glosses like Abbr's "it is an abbreviation" read as a full sentence; in the menu's terse
// right-aligned column the leading "it is a/an/the " is noise, so strip it to the bare description.
function cleanVDesc(s){ return (s||"").replace(/^it is (an?|the) /i,"").replace(/^it is /i,""); }
// item 3 — the ONE-column subtype submenu is narrow, so its expansions must not cross the row midline: keep only
// the first sense (drop everything after the first " / ", "(", "," or ";" — the alternative wordings/parentheticals).
function shortVDesc(s){ s=cleanVDesc(s); const m=s.split(/\s*[\/(,;]/)[0]; return m.trim(); }
// item 4 — the dot-suffixed subtype rows for ONE candidate UPOS, as a right-click submenu. Picking "PRON.Dem"
// sets the tag to PRON and PronType=Dem in one step (item 10: a FEATURE edit only, so it never triggers a
// reparse that would wipe hand-edited features). The submenu carries ONLY dot-suffixed rows — never the bare
// tag (item 7: selecting the plain tag is what the PARENT menu row already does, and now clears the subtype).
function posSubItems(si,tokId,U){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return null;
  const feats=subtypeFeatsFor(U); if(!feats.length) return null;
  const curOf=f=>t.upos===U?(getFeat(t.feats,f)||""):"";
  const setSub=(f,v)=>{ closeCtx(); const before=t.feats; pushUndo(si);
    if(t.upos!==U){ t.upos=U; if(XPOS_MIRRORS_UPOS)t.xpos=U; clearSubjIfNotVA(t); }   // item 1: a tag change away from VERB/AUX drops any now-meaningless Subj
    feats.forEach(o=>{ if(o!==f) t.feats=clearFeat(t.feats,o); });   // one subtype at a time — picking PRON.Dem drops a stale PRON.Int rather than leaving the token claiming both
    t.feats=(f&&v)?setFeat(t.feats,f,v):t.feats;
    featsSyncGloss(t,before); markDirty(); preserveScroll(renderDoc); };   // item 10: NO regenTok — this is a feature edit, and reparsing would overwrite the very feature just set (and any other hand-edited ones)
  const items=[];
  feats.forEach(f=>{ const cur=curOf(f), vals=UD_FEATS[f]||[];
    items.push({header:f}); vals.forEach(v=>items.push({label:esc(subtypeSuffix(f,v)), expand:shortVDesc((FEATS_VDESC[f]||{})[v]||""), check:cur===v, opt:true, fn:()=>setSub(f,v)})); });   // item 3: bare subtype value (the "U." prefix is redundant here) + a SHORT expansion that can't cross the one-column midline
  // item 3 — the guidelines link for the subtype the token CURRENTLY carries, pinned STICKY to the flyout bottom (no clear button — a plain-tag pick from the parent menu already clears the subtype)
  let setF=null,setV=""; feats.forEach(f=>{ const v=curOf(f); if(v){ setF=f; setV=v; } });
  if(setF) items.push(null,{label:`Guidelines for “${esc(subtypeSuffix(setF,setV))}”`, kbd:"↗", footLink:true, fn:()=>openExternal(featGuideUrl(setF,setV))});   // item 1: the leading `null` CLOSES the last category group so the link lands at the flyout's TOP LEVEL; footLink → openSub lifts it into a FIXED footer (never scrolls), styled as an ordinary .ctx button exactly like the parent menu's guidelines row
  return items; }
// right-click a POS tag → pick a UPOS (all shown, grouped by class). With opts.ext it is the SAME menu, only
// SCOPED to the external POS of a multi-token expression (item 2): the chosen tag lands in ExtPos on the head
// of the selection, not in UPOS, and NOUN/VERB/… are all offered (ExtPos may be any word class).
function posMenu(x,y,si,tokId,opts){ opts=opts||{}; const s=DOC[si]; if(!s)return; const rtl=sentRTL(s);
  if(opts.ext){
    const target=extPosTarget(si,tokId), t=s.tokens[target-1]; if(!t)return;
    const cur=extPosOf(t), sp=subtreeSpan(s,target);
    const choose=P=>{ const nv=(P===cur)?"":P; const before=t.feats; pushUndo(si);   // re-picking the current tag clears ExtPos (toggle) — the menu's way to remove it
      t.feats=nv?setFeat(t.feats,"ExtPos",nv):clearFeat(t.feats,"ExtPos");
      featsSyncGloss(t,before); markDirty(); preserveScroll(renderDoc); };   // items 3/10: feature edit only, re-renders at once, no reparse
    const guide=[`Open the guidelines for the “ExtPos” feature`,"↗",()=>openExternal(featGuideUrl("ExtPos"))];
    optionMenu(x,y,SETTINGS.upos.slice(),UPOS_CATS,r=>UPOS_INFO[r]||"",cur,choose,guide,rtl,null,null,null,
      `External POS of tokens ${sp.from}–${sp.to} — the whole expression`);   // a single line whose width sits BETWEEN one and two POS columns (like the guidelines link) — never wraps
    return; }
  const tok=s.tokens[tokId-1]; if(!tok)return;
  const guide=[`Open the guidelines for the “${esc(tok.upos)}” part of speech`,"↗",()=>openExternal(posGuideUrl(tok.upos))];
  const subFor=U=>()=>posSubItems(si,tokId,U);   // item 4: every tag gets a right-click submenu of its own dot-suffixed subtypes
  const choose=p=>{ const posChanged=p!==tok.upos, hadSub=UPOS_SUBTYPE_FEATS.some(f=>getFeat(tok.feats,f));
    if(!posChanged&&!hadSub) return;   // same tag, no subtype to drop → nothing to do
    const before=tok.feats, oldUpos=tok.upos; pushUndo(si); tok.upos=p; if(XPOS_MIRRORS_UPOS)tok.xpos=p; clearSubjIfNotVA(tok);   // item 1: a tag change away from VERB/AUX drops any now-meaningless Subj
    UPOS_SUBTYPE_FEATS.forEach(f=>tok.feats=clearFeat(tok.feats,f));   // item 6: selecting a PLAIN tag clears any dot-suffixed subtype
    featsSyncGloss(tok,before);
    if(posChanged) uposSyncGloss(tok,oldUpos);   // Task B: retarget the closed-class gloss prefix IN PLACE, immediately — never a wholesale MGloss rebuild (see uposSyncGloss's own note, js/io/bridge.js)
    markDirty(); preserveScroll(renderDoc);
    if(posChanged) uposSyncTranslit(si,tokId);   // the romanisation and script glyph are asked for a form AS a part of speech, so a retag makes both stale — refreshed HERE rather than left to regenTok below, which reaches its own translit pass on only one of its paths (no model / a misaligned re-parse skip it entirely). BEFORE regenTok so the fast language-driven refresh lands first, exactly as afterFormEdit orders the same two; regenTok's trailing pass then finds every value current and rewrites what is already there
    if(posChanged) regenTok(si,tokId,{regloss:true}); };   // regloss: the re-parse re-derives the FEATS for the chosen class, so the MGloss has to gain the categories that class brought with it and not merely lose the old one's (mglossFillFromFeats, js/io/bridge.js) — uposSyncGloss above has already moved the AUX/DET prefix, which is the one piece UPOS drives on its own.   // only a genuine POS change reparses; a same-tag "clear subtype" must not (item 10). regenSecondaries' OWN gloss-touch is now itself non-destructive in place too (Task B) — see its own note
  optionMenu(x,y,SETTINGS.upos.slice(),UPOS_CATS,r=>UPOS_INFO[r]||"",tok.upos,choose,guide,rtl,subFor,null,
    "Right-click a tag for its subtypes (PRON.Dem, NUM.Ord, …)",null,true);   // subColSize=true → the subtype flyout is one POS column wide and as tall as the POS menu (item 3)
  /* …and then fade each tag by the morphologizer's own probability for it. The pooling this needs is
     already done where the model is read (`_upos_scores`, app/parse.py): it predicts UPOS and FEATS as
     ONE joint label, so the mass of a CLASS is the sum over every analysis carrying it — which is the
     same sum as "this row plus everything in its subtype flyout", PRON.Dem and PRON.Int being two of
     PRON's labels. The parent row is therefore weighted by exactly its own submenu. */
  weightMenuRows(typeof tokenScores!=="function"?null:(async()=>{
    const sc=await tokenScores(si); return sc&&sc.upos?sc.upos[tokId-1]:null; })()); }
/* item 1/2 — the external POS of a multi-token expression, reached three ways, all meaning "tag this WHOLE
   expression with the word class it behaves as": right-clicking the POS tag of a token inside a multi-token
   selection, ⇧-right-clicking a node, and right-clicking an ExtPos bracket's own label. The value lands on the
   highest-ranking node of the selection; the bracket covers that node's whole subtree. It reuses posMenu(ext). */
function extPosTarget(si,tokId){ const s=DOC[si]; if(!s) return tokId;
  const multi=selRange&&selRange.s===si&&selRange.to>selRange.from&&tokId>=selRange.from&&tokId<=selRange.to;
  return multi?rangeHead(s,selRange.from,selRange.to):tokId; }
function extPosMenu(x,y,si,tokId){ posMenu(x,y,si,tokId,{ext:true}); }
// the ExtPos command from the Edit menu / a keyboard route: act on the current selection, anchored at its head
window.setExtPos=function(){ if(sel.s<0||sel.t<=0) return toast("Select the tokens of an expression first");
  const el=selAnchorEl(), b=el?el.getBoundingClientRect():null, rtl=sentRTL(DOC[sel.s]);
  extPosMenu(b?(rtl?b.right:b.left+20):innerWidth/2, b?b.bottom+4:innerHeight/2, sel.s, sel.t); };
// token-menu building blocks (shared by the diagram-node and grid-row menus); ⌃⌘ shortcuts mirror the Edit menu.
// grid → move/insert run vertically (up/down); diagram → horizontally (left/right, RTL-aware)
function moveItems(si,tokId,grid){ return grid
  ? [["Move up","⌃⌘↑",()=>moveTokenIndex(si,tokId,-1)],["Move down","⌃⌘↓",()=>moveTokenIndex(si,tokId,1)]]
  : [["Move left","⌃⌘←",()=>moveTokenSpatial(si,tokId,-1)],["Move right","⌃⌘→",()=>moveTokenSpatial(si,tokId,1)]]; }
function insertItems(si,tokId,grid){ return grid
  ? [["Insert token above","⌥⌘↑",()=>insertToken(si,tokId-1)],["Insert token below","⌥⌘↓",()=>insertToken(si,tokId)]]
  : [["Insert token left","⌥⌘←",()=>insertSpatial(si,tokId,-1)],["Insert token right","⌥⌘→",()=>insertSpatial(si,tokId,1)]]; }
function headItems(si,tokId){ return [["Select previous head","⌃⌘[",()=>stepHead(si,tokId,-1)],["Select next head","⌃⌘]",()=>stepHead(si,tokId,1)]]; }
// right-click a node → edit/move/insert/re-attach/set-root/delete this token (order: Edit, Move, Insert, Select head, Set as root, Delete)
function nodeTokenMenu(x,y,si,tokId){ const s=DOC[si]; if(!s)return; const rtl=sentRTL(s);
  const items=[
    ["Edit token","↩",()=>editNodeInline(si,tokId)],
    ["Edit lemma…","⌘L",()=>editLemmaPrompt(si,tokId)],   // the accelerator is named now that ⌘L is the ONLY gesture besides this row — the double-click that used to open it is gone   // item 4: the same editor a double-click on the token opens — that gesture has nothing on screen to advertise it, so the command needs a menu row of its own. Ellipsis, unlike "Edit token" above: this one opens a popover rather than editing in place, which is what the ellipsis means on macOS
    null, ...moveItems(si,tokId,false),
    null, ...insertItems(si,tokId,false),
    null, ...headItems(si,tokId),
    null, ...mwtTokenItems(si,tokId),
    null, ...markFeatRow(si,tokId),
    null, ["Set as root","⌃⌘R",()=>setAsRoot(si,tokId)],
    null, ["Delete token","⌘⌫",()=>deleteToken(si,tokId-1),true],
  ];
  const rdRow=(typeof readingsMenuItem==="function")?readingsMenuItem(si,tokId,()=>nodeTokenMenu(x,y,si,tokId)):null;   // CJK heteronyms (js/lang/readings.js) — null unless this language has alternative readings AND this token actually has more than one
  if(rdRow){ items.unshift(null); items.unshift(rdRow); }
  if(selRange&&selRange.s===si&&selRange.to>selRange.from&&tokId>=selRange.from&&tokId<=selRange.to&&!rangeIsMWT(si,selRange.from,selRange.to)){
    items.unshift(null);
    if(mergeIsSolid(s,selRange.from,selRange.to)) items.unshift([`Merge ${selRange.from}–${selRange.to} into one token`,"⌃⌘M",()=>mergeTokens(si,selRange.from,selRange.to)]);   // only a run written with no space in it, in any language (see mergeTokens' own note); under Group, and deliberately: grouping keeps the tokens, merging destroys them, so the reversible one is offered first
    items.unshift([`Group ${selRange.from}–${selRange.to} as MWT`,"⌘G",()=>addMWT(si,selRange.from,selRange.to)]); }
  const tok=s.tokens[tokId-1], lemma=tok&&((tok.lemma&&tok.lemma!=="_")?tok.lemma:tok.form);   // EITHER gloss tier can receive a dictionary sense: the lexical tier takes it whole (MISC Gloss), the morphemic one folds it in beside the grammatical abbreviations (MISC MGloss) — see applyWiktionaryDef, which writes whichever tiers are on
  /* THE DICTIONARY IS AVAILABLE WITH NO GLOSSING TIER ENABLED, on request — the tier gate ((GLOSS_ON||MORPH_ON))
     that used to be part of this condition is gone. Looking a word up is worth doing on its own, and requiring a
     tier first meant the only way to READ a definition was to create annotation you might not want. Picking a
     sense still writes to MGloss and so still needs a tier: applyWiktionaryDef returns without doing anything
     when neither is on (see its own note), so the flyout reads as a dictionary and clicking a sense is inert.
     The remaining two conditions stand: a lemma to look up, and not an English document (an English gloss of an
     English lemma says nothing). */
  if(lemma && DOCLANG!=="en"){
    items.unshift(null); items.unshift({label:`Definitions of “${esc(lemma)}”`, sub:()=>wiktionaryDefItems(si,tokId,lemma,tok.upos), subFit:true}); }
  showCtx(x,y,items); }
// dictionary → MGloss (item: "Definitions of …"). Fetches word senses through the Python bridge, which picks the
// dictionary that actually covers the document's language — Apte's Practical Sanskrit-English Dictionary for
// Sanskrit, Wiktionary for everything else (Api.definition_lookup) — grouped under a part-of-speech header per
// sense; picking one prepends it to the token's morphemic gloss (MISC MGloss), Leipzig-style: internal spaces
// become dots (one gloss unit for the one morpheme), and it's hyphen-joined ahead of whatever MGloss already held.
const WIKT_GENDER_LABEL={Masc:"Masculine",Fem:"Feminine",Neut:"Neuter",Com:"Common"};
async function wiktionaryDefItems(si,tokId,lemma,upos){
  let src=isSanskritLang()?"Apte":"Wiktionary";   // which dictionary the bridge WILL consult — needed before the call, so a bridge/network failure can still name the source it failed to reach; the reply's own `source` overrides it below
  if(!hasBridge()) return [{header:"Definitions need the desktop app"}];
  let r; try{ r=await window.pywebview.api.definition_lookup(lemma,DOCLANG||"en",upos||""); }catch(e){ return [{header:`${src} lookup failed`}]; }
  if(r&&r.source) src=r.source;
  const defs=(r&&r.definitions)||[];
  const link=(r&&r.page_url)?[{label:esc((r&&r.page_label)||`Open on ${src}`),kbd:"↗",fn:()=>openExternal(r.page_url),footLink:true}]:[];   // where the senses came from, labelled by the source itself: Wiktionary links the word's own language section (not the filtered POS — see app.wiktionary.lookup), Apte the scan of the printed page the entry is on (the only per-entry URL the C-SALT API exposes — see app.apte). footLink:true → openSub lifts the row (and the separator above it) into the flyout's FIXED footer, so it sits below the (often long, scrolling) sense list and stays put while the senses scroll — it was a position:sticky bar riding at the bottom of the list itself before
  if(!defs.length) return [{header: (r&&r.error)?`${src} lookup failed`:`No definitions found for “${esc(lemma)}”`}, ...(link.length?[null,...link]:[])];
  // already filtered server-side to this token's own UPOS (app.wiktionary.lookup / app.apte.lookup) → no per-POS header needed.
  // Where that filter would have emptied the flyout, both dictionaries fall back to a wider set rather than report the token's
  // own dictionary as silent (see either module's lookup) — and those senses have no heading to print either, since what
  // admits them is precisely that their entry states no word class…
  // …EXCEPT nouns, which group under a gender heading when the dictionary's headword line marked one (grouped by
  // gender_ud, not just split wherever it happens to change between consecutive senses — see app.wiktionary.lookup)
  const hasGender=(upos==="NOUN"||upos==="PROPN") && defs.some(d=>d.gender_ud);   // PROPN too, now that a proper-noun token draws on the dictionary's NOUN entries (dictionaries file a name as a noun — app.apte._pos_matches / app.wiktionary._pos_matches): those senses arrive carrying the same gender, so a PROPN lookup lands the same masculine/feminine/neuter mix a NOUN one does. Grouping is not decoration here — picking a sense WRITES its gender to FEATS, so an ungrouped list would have the user choose one blind
  let rows;
  if(hasGender){
    const buckets=new Map();   // gender_ud ("" = none) → its defs, keyed in FIRST-SEEN order so same-gender senses cluster under one heading regardless of interleaving
    defs.forEach(d=>{ const k=d.gender_ud||""; if(!buckets.has(k))buckets.set(k,[]); buckets.get(k).push(d); });
    rows=[];
    buckets.forEach((group,k)=>{ rows.push({header:k?WIKT_GENDER_LABEL[k]||k:"Unspecified gender"});
      group.forEach(d=>{ const text=(d.text||"").trim(); if(!text)return; const label=text.length>90?text.slice(0,88)+"…":text;
        rows.push({label:esc(label), fn:()=>applyWiktionaryDef(si,tokId,text,d.gender_ud,d.gender_abbr)}); }); });
  } else {
    rows=defs.map(d=>{ const text=(d.text||"").trim(); const label=text.length>90?text.slice(0,88)+"…":text;
      return {label:esc(label), fn:()=>applyWiktionaryDef(si,tokId,text)}; }).filter(it=>it.label);
  }
  return link.length ? [...rows,null,...link] : rows; }
// Rebuild a "."/"-"-delimited MGloss/Gloss string token by token: transform(tok) returns the token to keep in
// its place (unchanged or replaced), or null/"" to drop it. Two surviving tokens that end up adjacent only
// because something BETWEEN them was dropped are joined with "." (no morpheme-boundary meaning implied); two
// that were ALREADY adjacent in the original string keep their original separator.
function rebuildGlossTokens(str,transform){ if(!str) return "";
  str=str.replace(INVISIBLE_RE,"");   // strip stray invisible chars from raw MISC before token-splitting, so a passthrough token (unchanged by `transform`) can't carry one back into the rebuilt string
  // A leading/trailing "-" is the Leipzig ATTACHMENT mark — "this gloss hangs off a stem on that side", written by
  // the MSeg prefill's segmentation (msegSegment in js/io/bridge.js) or by hand — and NOT a separator between two
  // tokens. It has to come off before the split (which would otherwise make it an empty token's separator and drop
  // it) and go back on after, so that retargeting one abbreviation because its FEATS value changed doesn't quietly
  // unmark an affix gloss: "-PST" → Tense=Pres must give "-PRS", not "PRS".
  let lead="",trail="";
  if(str.startsWith("-")){ lead="-"; str=str.slice(1); }
  if(str.endsWith("-")){ trail="-"; str=str.slice(0,-1); }
  const parts=str.split(/([.\-])/), keep=[];   // odd indices are the separators; even indices are the tokens
  for(let i=0;i<parts.length;i+=2){ const out=transform(parts[i]); if(out==null||out==="")continue;
    if(keep.length){ const prevSurvived=i>=2&&!!transform(parts[i-2]); keep.push(prevSurvived?parts[i-1]:"."); }
    keep.push(out); }
  const body=keep.join("");
  return body?lead+body+trail:"";   // nothing survived → "", never a bare attachment mark with no gloss on it
}
// Keep only the GRAMMATICAL (Leipzig, GLOSS_ABBR_TOK_RE) tokens of a MGloss/Gloss string, dropping every other
// (lexical definition-word) token — used when a freshly-picked Wiktionary sense REPLACES whatever definition
// text was already there, without disturbing any grammatical abbreviation.
function keepGlossAbbrevs(str){ return rebuildGlossTokens(str, tok=>GLOSS_ABBR_TOK_RE.test(tok)?tok:null); }
// Retarget one specific abbreviation token to another (or drop it if newAb is falsy) — used by featsSyncGloss
// (below) to keep an MGloss abbreviation in step with the FEATS value it came from, without touching anything
// else in the gloss. Also reaches INSIDE a fused Person+Number pair ("3SG" — see splitPersonNumber/
// featsToGloss's no-dot join) when oldAb matches one half of it: only that half is retargeted (or dropped,
// leaving the other half un-fused — "SG" alone, or "3" alone), the token as a whole is never mistaken for a
// literal match of oldAb the way a dotted "3.SG" already wasn't.
function retargetGlossAbbrev(str,oldAb,newAb){ return rebuildGlossTokens(str, tok=>{
  if(tok===oldAb) return newAb||null;
  const pn=splitPersonNumber(tok); if(!pn) return tok;
  const idx=pn.indexOf(oldAb); if(idx<0) return tok;
  pn[idx]=newAb||""; return pn.join("")||null; }); }
// commit a picked Wiktionary sense to the token's MGloss (never the lexical Gloss tier — item: Definitions of …)
const WIKT_GENDER_ABBRS=["M","F","N","CG"];   // this app's own Leipzig set for Gender=Masc/Fem/Neut/Com (FEATS_GLOSS)
// commit a picked Wiktionary sense to the token's MGloss (never the lexical Gloss tier — item: Definitions of …).
// genderUd/genderAbbr (noun senses only — see wiktionaryDefItems) ALSO set FEATS Gender. The gender abbreviation
// is NOT glued to the lexical stem — per instruction it stays wherever it already sits among the grammatical
// abbreviations (retargeted in place, like any other feature value change) even though it's semantically
// inherent to the lexeme; only the very FIRST time gender is added does it need a fresh position, which it gets
// from MGLOSS_FEAT_ORDER via insertGlossAbbrevAtRank, same as everything else.
function applyWiktionaryDef(si,tokId,text,genderUd,genderAbbr){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t)return;
  /* NO TIER, NO EFFECT — and deliberately no toast either, per the request that clicking a definition simply do
     nothing there. The "Definitions of …" flyout is now offered whether or not a glossing tier exists (see
     nodeTokenMenu), because reading a sense is useful by itself; but a sense is COMMITTED to MISC MGloss, and
     with neither tier created there is nowhere for it to go. Writing it anyway would silently create the very
     annotation the user did not ask for, and is what this guard exists to prevent. */
  if(!GLOSS_ON && !MORPH_ON) return;
  // …EXCEPT onto a form that doesn't inflect. A compound member, a construct-state form or any other bound stem
  // (isUninflectedForm) stands in for the word without realising its categories, so Wiktionary's gender — a fact
  // about the LEXEME, read off a dictionary entry rather than off this token — has nothing to attach to here. The
  // definition still applies; the gender is dropped, and any gender ALREADY on the token is stripped with it (both
  // the MGloss abbreviation and FEATS Gender, below) — a sense pick is a re-statement of what the dictionary knows
  // about this token, so it settles the question either way rather than leaving a stale answer standing.
  const bare=isUninflectedForm(t.feats);   // read BEFORE anything below edits FEATS
  if(bare){ genderUd=""; genderAbbr=""; }
  pushUndo(si); const enc=glossEnc(text);
  if(UPOS_LEIPZIG_ABBR[t.upos]){   // a closed-class UPOS that already carries its OWN standard Leipzig abbreviation (AUX/DET, prepended to MGloss by featsToGloss) — Wiktionary's lexical definition goes to the Gloss tier instead, unconditionally (like the MGloss write below, not gated on GLOSS_ON being toggled on), never into MGloss
    t.misc=setMiscKV(t.misc,"Gloss",enc.replace(/\s+/g,"-"));
    markDirty(); preserveScroll(renderDoc); return; }
  if(GLOSS_ON) t.misc=setMiscKV(t.misc,"Gloss",enc.replace(/\s+/g,"-"));   // the lexical Gloss tier holds ONE hyphenated unit, wholesale replaced — no grammatical abbreviations ever live there
  if(!MORPH_ON){   // LEXICAL TIER ONLY (the menu item now offers itself on either tier — see nodeTokenMenu). There is no
    // MGloss to fold the sense into, so the Gloss write above is the whole of the gloss work. The GENDER still lands:
    // it is a fact about the LEXEME, not a property of the tier that happened to carry its Leipzig abbreviation, so it
    // goes straight to FEATS here — mglossSyncFeats below can't do that job, since it reads the abbreviation back OUT
    // of MGloss, and on this path nothing ever wrote one.
    if(genderUd) t.feats=setFeat(t.feats,"Gender",genderUd);
    else if(bare) t.feats=clearFeat(t.feats,"Gender");   // …and an uninflected form has its stale gender stripped, exactly as on the morphemic path below
    markDirty(); preserveScroll(renderDoc);
    toast(genderUd?"Definition and gender applied":"Definition set as gloss"); return; }
  const dotted=enc.replace(/\s+/g,"_");   // Leipzig convention: an UNDERSCORE joins the several English words that gloss ONE morpheme (a dot is reserved for an actual morpheme boundary — see the "." joins below). Just the lexical stem now — gender no longer rides along with it
  let abbrevs=keepGlossAbbrevs(tierText(t,"mgloss"));   // any PREVIOUS definition word is replaced by the new pick; every grammatical abbreviation survives, IN PLACE
  if(genderAbbr||bare){ const abTokens=abbrevs.split(/[.\-]/), oldAb=WIKT_GENDER_ABBRS.find(ab=>abTokens.includes(ab));
    abbrevs=genderAbbr ? (oldAb?retargetGlossAbbrev(abbrevs,oldAb,genderAbbr):insertGlossAbbrevAtRank(abbrevs,"Gender",genderAbbr))
                       : (oldAb?retargetGlossAbbrev(abbrevs,oldAb,null):abbrevs); }   // an EXISTING gender abbreviation just gets swapped to the new value at its current position; only a token with no gender yet needs one placed fresh, at Gender's canonical rank. On an uninflected form (`bare`) it goes the other way — the abbreviation is removed outright, leaving every other one where it stands
  /* WHICH SIDE THE DEFINITION LANDS ON (item 4). Where the segmentation has already put an ATTACHMENT HYPHEN on
     the gloss (msegSegment → mglossMarks), that hyphen says which side of the word the grammatical material sits
     on, and therefore where the stem is: "-PST" is a suffix, so the stem precedes it; "NEG-" is a prefix, so the
     stem follows. The definition is the stem's gloss, so it goes on the hyphen's own side and the hyphen becomes
     the morpheme boundary joining the two — no extra separator, or the boundary would be stated twice.
     With no hyphen there is no morpheme boundary to speak of, and the two glosses are categories of ONE morpheme:
     they join with a DOT, which is what a dot means in Leipzig (the underscore inside `dotted` is a different
     thing again — it joins the several English words that gloss this one morpheme).
     A hyphen at BOTH ends is a circumfix, where the stem sits between two affixes and nothing in the gloss says
     which is which; it takes the stated default of "else to the left" rather than a guess. */
  const lead=/^-/.test(abbrevs), trail=/-$/.test(abbrevs);
  t.misc=setMiscKV(t.misc,"MGloss", !abbrevs ? dotted
    : lead            ? dotted+abbrevs        // "-PST" → "walk-PST"   (and the circumfix "-M-" → "walk-M-")
    : trail           ? abbrevs+dotted        // "NEG-" → "NEG-happy"
    :                   dotted+"."+abbrevs);  // no attachment hyphen → one morpheme, dot-joined
  mglossSyncFeats(t);   // sets/updates FEATS Gender from the abbreviation just folded into MGloss (glossToFeats resolves M/F/N/CG unambiguously, no UPOS needed)
  if(bare) t.feats=clearFeat(t.feats,"Gender");   // …and on an uninflected form, drops it: mglossSyncFeats only writes the features the gloss NAMES, so a Gender whose abbreviation was just removed above would otherwise sit on in FEATS unmentioned
  markDirty(); preserveScroll(renderDoc);
  toast(genderUd?"Definition, gender, and morphemic gloss applied":(GLOSS_ON?"Definition set as gloss and applied to the morphemic gloss":"Definition applied to the morphemic gloss")); }
// Resolve a right-click inside a BRACKETS diagram (flat SVG or wrapped .bwrap) to a token element.
// DETERMINISTIC: once the click is inside a brackets diagram this NEVER returns null — after the specific
// hits (deprel/POS labels, direct token spans) miss, it always lands on a token. Returns null only when the
// click is OUTSIDE any brackets diagram, so every other view keeps its own behaviour. It resolves, in order:
//   1. a bracket glyph ([ / ]) → its constituent's head token (matches the glyph's own click);
//   2. otherwise, the NEAREST token by cursor — the row band whose vertical range contains (or is nearest to)
//      clientY, then the nearest token in that row by clientX.
// Case 2 covers token ink, the .span-hit row rect, inter-token gaps, empty line ends, the diagram's own
// padding, clicks landing on the .bwund/POS sub-span, and clicks whose target is a pointer-events:none
// wash (.bwwash) / annotation (.bwannot) overlay or a bare container ancestor (.bwrap / .bwline2 / <svg> /
// .diagram) — all of which still sit inside the brackets container, so the container is detected either way.
function bracketTokenEl(e){
  const br=e.target.closest("[data-owner]");                                            // a bracket glyph carries no token id → its constituent's head
  if(br){ const c=br.closest(".bwrap,.diagram")||document, s=br.getAttribute("data-s"), oid=br.getAttribute("data-owner");
    const el=c.querySelector(`.tok-group[data-s="${s}"][data-tok="${oid}"], .bwtok[data-s="${s}"][data-tok="${oid}"]`);
    if(el) return el; }
  // identify the brackets container the click is inside: wrapped (.bwrap), or flat (the <svg> that carries the
  // bracket hit-rect/glyphs — or, for a click in the box padding outside that svg, its .diagram box).
  let cont=e.target.closest(".bwrap"), tokSel=".bwtok[data-tok]";
  if(!cont){ const svg=e.target.closest("svg"), dia=e.target.closest(".diagram");
    const flat=(svg&&svg.querySelector(".span-hit,.brk"))?svg:(dia&&dia.querySelector(".span-hit,.brk"))?dia:null;
    if(flat){ cont=flat; tokSel=".tok-group[data-tok]"; } }                             // .span-hit/.brk exist ONLY in brackets → gates out arcs/stemma/tree
  if(!cont) return null;                                                                // not a brackets diagram → leave other views untouched
  let best=null,bd=Infinity;                                                            // every brackets diagram has ≥1 token → best is always set when cont is set
  cont.querySelectorAll(tokSel).forEach(g=>{ const r=g.getBoundingClientRect();
    const dy=e.clientY<r.top?r.top-e.clientY:e.clientY>r.bottom?e.clientY-r.bottom:0,   // 0 → cursor y is within this token's row band
          dx=e.clientX<r.left?r.left-e.clientX:e.clientX>r.right?e.clientX-r.right:0,
          d=dy*1e5+dx;                                                                   // same-row tokens win first, then nearest by x
    if(d<bd){bd=d;best=g;} });
  return best;
}
// A relation's DEEP features are reached through the relation menu itself: right-click the deprel label → the relation
// menu, then right-click a relation's row (or click its ▸) for that relation's admissible deep features.
/* WHICH LABEL A POS / RELATION MENU BELONGS TO — asked by TWO gestures now (right-click below and
   double-click just after), so the answer lives in one place rather than being written out twice and
   drifting. Returns null when the point is on neither, which is how both callers fall through to the
   ordinary token menu / editor paths. */
function posRelHit(target){ if(!target||!target.closest) return null;
  let relEl=target.closest(".lbl,.orel,.bwrel");
  if(relEl && !(relEl.textContent||"").trim()) relEl=null;   // a reserved (blank " ") .bwrel row — an interrupter's or root-neighbour's placeholder — is NOT a deprel label; fall through to the token menu
  const posEl=relEl?null:target.closest(".tok-pos,.node-cat,.opos,.bwpos");
  return (relEl||posEl)?{relEl,posEl}:null; }
// …and what each of the two gestures then does with it, likewise written once.
function openPosRelMenu(hit,x,y,shift){ const tk=tokFromEl(hit.relEl||hit.posEl); if(!tk) return false;
  if(hit.relEl) relMenu(x,y,tk.si,tk.tokId);   // a deprel → relation menu (deep features live on each relation's submenu)
  else if(shift||inSelRange(tk.si,tk.tokId)) extPosMenu(x,y,tk.si,tk.tokId);   // item 1: a POS tag opened while a RANGE covering it is selected tags the whole EXPRESSION (ExtPos on its head), not that one token; ⇧ asks for the same on a single node
  else posMenu(x,y,tk.si,tk.tokId);
  return true; }
/* ── A GLOSSING ABBREVIATION'S OWN MENU ───────────────────────────────────────────────────────────
   Right-clicking `GEN` in a morphemic gloss offers the other cases; right-clicking `PL` offers the
   other numbers. It is the same gesture the POS tag and the relation label already answer, brought to
   the one remaining label that names a choice from a closed set — and the set is not guessed here but
   read off EFF_FEATS_GLOSS, the app's own Feat=Val → abbreviation map (custom PREFS.glossMap overrides
   included), so a mapping the reader has edited in Gloss Mappings shows up in this menu unprompted.
   WHICH feature the run belongs to is mglossFeatNameFor's answer, UPOS and all, so an ambiguous
   abbreviation lands on the same reading the autocomplete and the FEATS back-sync give it.
   Values are listed in UD's OWN ORDER (UD_FEATS) rather than alphabetically — Sing before Plur, Nom
   before Acc — with anything only the custom map knows trailing after; each row shows the value's gloss
   (FEATS_VDESC) beside its abbreviation, and the current one carries the tick.
   MORPHEMIC TIER ONLY. The lexical Gloss tier renders abbreviation runs the same way, but a Gloss is a
   word's MEANING and its capitals are not a paradigm slot — there is nothing there for a list of
   alternative values to be alternatives to. */
function glossAbbrMenu(x,y,si,tokId,idx,ab){
  const s=DOC[si]; if(!s) return false; const t=s.tokens[tokId-1]; if(!t) return false;
  const feat=(typeof mglossFeatNameFor==="function")?mglossFeatNameFor(ab,t.upos):null; if(!feat) return false;
  const seen=new Set(), rows=[];
  const add=v=>{ if(!v||seen.has(v))return; const a=EFF_FEATS_GLOSS[feat+"="+v]; if(!a)return; seen.add(v); rows.push({v,ab:a}); };
  ((typeof UD_FEATS==="object"&&UD_FEATS&&UD_FEATS[feat])||[]).forEach(add);                       // UD's canonical order first…
  Object.keys(EFF_FEATS_GLOSS).forEach(fv=>{ if(fv.indexOf(feat+"=")===0) add(fv.slice(feat.length+1)); });   // …then any value only the (possibly customised) map knows about
  if(rows.length<2) return false;   // a one-value feature (Poss=Yes, Reflex=Yes) offers no alternative — fall through to the ordinary token menu rather than opening a list of one
  const desc=(typeof FEATS_VDESC==="object"&&FEATS_VDESC&&FEATS_VDESC[feat])||{};
  // opt:true opens the CHECKMARK GUTTER. `.ctx .ck` is absolutely positioned at the menu's 12px inset and
  // only `.ctx button.opt`'s padding-inline-start:25px moves the label clear of it — measured without it,
  // the row's leading padding is 7px and the ✓ paints straight underneath the abbreviation's first letter,
  // i.e. it is drawn and invisible. Every other checkable list in this file passes it for the same reason
  // (POS, deprel, deep features, the Foreign/Typo marks); this menu is one more of them.
  showCtx(x,y,[{header:feat}].concat(rows.map(r=>({label:r.ab, expand:desc[r.v]||r.v, check:r.ab===ab, opt:true,
    fn:()=>setGlossAbbrevAt(si,tokId,idx,r.ab)}))), rows.length>12, sentRTL(s));
  return true; }
/* …and what a pick does. The abbreviation is substituted in place (mglossReplaceAbbrevIdx, js/io/bridge.js)
   and the token's FEATS follow through mglossSyncFeats — the SAME back-sync a hand edit of the field runs
   on commit (see editTier's `after`), so choosing DAT here and typing it there leave the token in exactly
   one state. One undo entry covers both halves, because they are one edit. */
function setGlossAbbrevAt(si,tokId,idx,ab){ const s=DOC[si]; if(!s)return; const t=s.tokens[tokId-1]; if(!t)return;
  const cur=tierText(t,"mgloss"), next=mglossReplaceAbbrevIdx(cur,idx,ab);
  if(!next||next===cur) return;
  pushUndo(si); if(typeof touchColW==="function") touchColW(si,si+1);   // the MISC column's widest chip can change with the value
  t.misc=setMiscKV(t.misc,TIER_MISC.mgloss,glossEnc(next));
  mglossSyncFeats(t);
  markDirty(); preserveScroll(renderDoc); }
document.getElementById("doc").addEventListener("contextmenu",e=>{
  const abEl=e.target.closest&&e.target.closest(".glabbr");   // BEFORE every other resolver: a .glabbr sits inside the gloss row, which sits inside the token group the generic node branch below would otherwise claim
  if(abEl){ const gl=abEl.closest(".gl-edit"), tk=gl&&tokFromEl(gl);
    if(gl&&tk&&(gl.dataset.tier||"gloss")==="mgloss"){
      const idx=[...gl.querySelectorAll(".glabbr")].indexOf(abEl);
      if(idx>=0 && glossAbbrMenu(e.clientX,e.clientY,tk.si,tk.tokId,idx,(abEl.textContent||"").trim())){ e.preventDefault(); e.stopPropagation(); return; } } }
  const hit=posRelHit(e.target);
  if(hit){ if(openPosRelMenu(hit,e.clientX,e.clientY,e.shiftKey)){ e.preventDefault(); e.stopPropagation(); } return; }
  // item 1 — an ExtPos bracket's own label: right-click it to change or clear the value, wherever it was set from
  const xpEl=e.target.closest(".mwt-pos");
  if(xpEl&&xpEl.hasAttribute("data-xpostok")){ e.preventDefault(); e.stopPropagation();
    extPosMenu(e.clientX,e.clientY,+xpEl.getAttribute("data-s"),+xpEl.getAttribute("data-xpostok")); return; }
  const mwtEl=e.target.closest(".mwt-form,.mwt-tr"); if(mwtEl&&mwtEl.hasAttribute("data-mwtfrom")){ e.preventDefault(); e.stopPropagation(); const si=+mwtEl.getAttribute("data-s"), from=+mwtEl.getAttribute("data-mwtfrom");   // `.mwt-tr`, not `.mwt-tr-edit`: the transliteration row belongs to the MWT in EVERY language, so its menu is the MWT's menu — the -edit class is narrower (it marks the row the click-to-edit handler below may open a field on, which is Sanskrit-only)
    // Both rows of a tie open the SAME menu, and "Edit surface form" stays coherent under a Sanskrit script
    // because editMWTInline (not this row) decides which element the field opens over — the IAST row when the
    // glyph is derived, the glyph itself otherwise. So the menu item edits whatever the left-click would.
    /* THE WHOLE MWT FAMILY, ON THE RANGE THAT WAS CLICKED — not on the selection. Ungroup and Flatten
       are in the Edit menu too, where they read `sel`/`selRange` and are hidden unless the selection
       forms an MWT (menuState's `ungroup`/`flatmwt`); reaching them therefore meant selecting the range
       first. A right-click already names its target unambiguously, so these resolve the MWT from
       `data-mwtfrom` and need no selection at all.
       Same labels and accelerators as the Edit menu, so the two cannot read as different commands.
       "Remove MWT" was this menu's own name for Ungroup — one operation under two names, and the ⌫ hint
       and danger styling said "delete", which it never was: dropping a RANGE leaves every token in
       place. Flatten is the one that removes tokens, and it is not styled as a deletion in the Edit
       menu either, because replacing n components with the word they spell is an ordinary edit. */
    // …and they are mwtTokenItems' OWN rows, not a second pair written out here: that helper already
    // supplies Flatten/Ungroup to the component tokens' menu, and two hand-kept copies of one pair is
    // how the labels and the accelerators drift apart (this file already carries a post-mortem on an
    // ⌥⌘F that outlived its binding by exactly that route). It resolves the range with mwtAtSel, so
    // passing the range's FIRST component id asks it about this very MWT.
    showCtx(e.clientX,e.clientY,[
      ["Edit surface form","⏎",()=>editMWTInline(si,from)],
      null,
      ...mwtTokenItems(si,from,true),   // the RANGE's own menu: Flatten and Ungroup, but no Split — see mwtTokenItems
    ]); return; }
  // a goeswith continuation's own form field: it lives INSIDE the head's cell, so the generic resolver below would
  // hand back the head. Its right-click menu is the ordinary token menu, for the token it actually draws.
  const gwEl=e.target.closest("[data-gwtok]");
  if(gwEl&&gwEl.hasAttribute("data-s")){ const gs=+gwEl.getAttribute("data-s"), gt=+gwEl.getAttribute("data-gwtok");
    e.preventDefault(); e.stopPropagation(); nodeTokenMenu(e.clientX,e.clientY,gs,gt); return; }
  // a direct token/node hit wins; otherwise, inside a brackets diagram, the resolver is deterministic (never null).
  const nodeEl=e.target.closest(".node,.tok-group,.oline,.bwtok") || bracketTokenEl(e);
  if(nodeEl){ const tk=tokFromEl(nodeEl); if(tk){ e.preventDefault(); e.stopPropagation();
    if(e.shiftKey){ extPosMenu(e.clientX,e.clientY,tk.si,tk.tokId); return; }   // item 1: ⇧-right-click a node → external POS, on the whole selected expression where the range covers this token (posMenu's own `multi` test) and on this node alone otherwise
    nodeTokenMenu(e.clientX,e.clientY,tk.si,tk.tokId); } }
});
/* ── …AND THE SAME TWO MENUS OPEN ON A DOUBLE-CLICK ────────────────────────────────────────────────
   Retagging and relabelling are the two commonest edits in the app and the only way to reach either
   was the right button, which on a trackpad is a modifier chord or a two-finger gesture. A double-
   click on the very label being changed is the shorter road to the same menu, and it addresses the
   same token by the same resolver (posRelHit/openPosRelMenu above), so the two gestures cannot come
   to different conclusions about what was clicked.

   NO HIGHLIGHT, and that needs a separate handler. A double-click's word selection is made by the
   SECOND mousedown, before `dblclick` is dispatched at all — so cancelling it here would be too late,
   and clearing the selection afterwards would flash it. Cancelling that mousedown's default is what
   prevents it being made; `e.detail>=2` is the browser's own count of the click run, so a single
   click is untouched and keeps whatever it does today. Capture phase, so it lands ahead of the
   diagram's drag/tap handlers — which are on POINTER events and therefore unaffected by a cancelled
   mousedown (the drag system never sees this call). The selection is cleared as well as prevented,
   because a triple-click's third mousedown carries detail 3 and the run may already have selected on
   an earlier engine. */
document.getElementById("doc").addEventListener("mousedown",e=>{
  if(e.detail>=2 && posRelHit(e.target)) e.preventDefault(); },true);
document.getElementById("doc").addEventListener("dblclick",e=>{
  const hit=posRelHit(e.target); if(!hit) return;
  e.preventDefault(); e.stopPropagation();
  try{ const g=getSelection(); if(g&&g.rangeCount&&document.getElementById("doc").contains(g.anchorNode)) g.removeAllRanges(); }catch(_){}
  openPosRelMenu(hit,e.clientX,e.clientY,e.shiftKey); });
/* NO pick() ON ANY OF THOSE PATHS: OPENING A MENU IS NOT SELECTING. Right-clicking a token used to
   select it — collapsing a multi-token range you had just marqueed, if the click landed outside it —
   which is neither what the platform menus do nor what the rest of this app does: the deprel, POS,
   ExtPos-bracket, MWT-tie and grid-row menus above and in js/grid/grid.js have never picked either.
   Nothing is lost by it, because a token menu addresses the token it was opened ON, by id, all the
   way down (nodeTokenMenu/posMenu/relMenu take si+tokId; the few rows that run a SELECTION-based
   command, e.g. markFeatRow's Foreign/Typo toggles, pick() for themselves at the moment they run).
   The range-scoped rows behave the same as before for the same reason they were written: "Group N–M
   as MWT" and ExtPos-over-an-expression are gated on the range actually covering the right-clicked
   token, so a range left standing somewhere else in the sentence can't silently capture the menu. */
// a single click on a token/tier opens its inline editor directly, caret at the click point (Enter on a selected
// token does the same, select-all instead — see makeEditable/makeGlossEditableSC's clickXY param). Node clicks in
// the four DRAGGABLE notations (stemma/tree/arcs/brackets: .node/.tok-group/.bwtok) are handled by the pointerdown/
// pointerup drag-tap logic further down (they need pick() to fire immediately on pointerdown, before a drag can be
// detected, so they can't wait for a plain "click") — only .oline (outline, not part of that drag system) is
// handled here alongside the tier/translit/MWT-form editors, none of which are draggable either.
document.getElementById("doc").addEventListener("click",e=>{
  if(e.target.closest(".node,.tok-group,.bwtok")) return;   // these three classes only ever exist inside a draggable notation (stemma/tree/arcs/brackets) — pointerup above already opens the right editor for whatever was actually clicked (form vs. a nested tier), and DSUPPRESS's timing isn't reliable enough to trust this click won't ALSO fire and reopen a second, wrong editor
  const trEl=e.target.closest(".tr-edit"); if(trEl){ const tk=tokFromEl(trEl); if(tk){ e.preventDefault(); editTransInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY}); return; } }   // edit the romanisation shown under a token — or, where the romanisation is non-deterministic, the STORED transliteration it is derived from (trRowEdit decides when the row carries .tr-edit at all)
  const glEl=e.target.closest(".gl-edit"); if(glEl){ const tk=tokFromEl(glEl); if(tk){ e.preventDefault(); editTier(tk.si,tk.tokId,glEl.dataset.tier||"gloss",{x:e.clientX,y:e.clientY}); return; } }   // edit a gloss / morphemic tier → MISC
  const mwtEl=e.target.closest(".mwt-form,.mwt-tr-edit"); if(mwtEl&&mwtEl.hasAttribute("data-mwtfrom")){ e.preventDefault();
    editMWTInline(+mwtEl.getAttribute("data-s"), +mwtEl.getAttribute("data-mwtfrom"),{x:e.clientX,y:e.clientY}); return; }   // EITHER tie row opens the same editor, and editMWTInline (via mwtElOf) decides which element the field actually opens OVER — under iastFormEdit() the IAST row, else the glyph. That is the same one-way-in shape a single token has: editNodeInline takes every click on a token and routes it onto the transliteration row when the glyph is a derived rendering (see its own iastFormEdit branch), rather than making the caller know which row is editable. An earlier version made the glyph SELECT-ONLY under a Sanskrit script, on the reasoning that a derived glyph must not be edited — true of the glyph, but the user still expects the click to reach the field the glyph was rendered from, exactly as it does on a single token. Selecting the component range is not lost: editMWTInline does it first, for every entry point including the right-click menu.   // This branch was dead until mwtTie stopped attaching its own stopPropagation()-ing click listener to the same element — the tie label never reached this delegated handler at all, so the only way in was the right-click menu. Both rows are plain <text> inside the tie's own .mwt-g group (item 8's per-tie selection wrapper) — never inside .node/.tok-group/.bwtok, which is what the pointerup tap path above keys off, so it can't ALSO open an editor for them (no double-open). The data-mwtfrom guard skips the untagged rows the si==null render path draws.
  const cfEl=e.target.closest(".cform"); if(cfEl){ const tk=tokFromEl(cfEl); if(tk){ e.preventDefault(); editCorrectFormInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY}); return; } }   // item 6: click the correct-form companion → edit MISC CorrectForm in place (data-s/data-tok are set on the element itself, so tokFromEl resolves it directly whether the element is bare-SVG or nested in .oline)
  const nodeEl=e.target.closest(".oline"); if(!nodeEl)return;
  const tk=tokFromEl(nodeEl); if(tk){ e.preventDefault(); editNodeInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY}); } });
// item 3: a gloss tier is also editable by pressing Enter (or Space) on it (glosses are focusable, tabindex=0)
document.getElementById("doc").addEventListener("keydown",e=>{ if(e.key!=="Enter"&&e.key!==" ")return; const glEl=e.target.closest&&e.target.closest(".gl-edit"); if(!glEl)return;
  const tk=tokFromEl(glEl); if(tk){ e.preventDefault(); e.stopPropagation(); editTier(tk.si,tk.tokId,glEl.dataset.tier||"gloss"); } });
// inline-edit a token's transliteration (romanisation) on a diagram; writes back to token.translit AND MISC Translit
// — EXCEPT where the language's romanisation is non-deterministic (CJK readings, the unvocalised abjads), where
// the same click edits the STORED transliteration instead and the row re-derives from it (js/lang/translit-load.js).
function transElOf(si,tokId){ const g=tokGroupOf(si,tokId);
  return g?g.querySelector(".translit, .otrans"):null; }
/* item 1 — WHAT EVERY DIAGRAM FORM EDITOR COMMITS THROUGH. The token FORM is reachable from two
   inline editors that are ONE field to the user: the form glyph itself (editNodeInline) and, once a
   real script is on display, the IAST row beneath it (editTransInline's iastFormEdit branch — the
   glyph there is a display-only rendering, so the row is where the stored form actually lives). Both
   are the same "Form field" the grid's Form cell is, so both convert ITRANS → IAST on commit, exactly
   as the grid cell and textPrompt do; routing them through one function is what keeps the three from
   drifting.
   ORDER MATTERS: the conversion runs BEFORE afterFormEdit, never after. afterFormEdit re-derives the
   romanisation, the script glyph and the morpheme segmentation FROM the form and (with a model) sends
   it back through the parser — all of which must see the IAST that will be stored, not the ITRANS that
   was typed. `changed` is passed on untouched, so the whole cascade behaves exactly as before.
   Only on a real commit (`changed`), the same gate the grid's ctl._edited is: a cancelled or no-op
   edit must not rewrite a form the user never touched. And the model is re-checked after the await —
   `t.form` may have moved on (a later edit, an undo) while the bridge call was in flight. */
async function afterDiagramFormEdit(si,tokId,changed){ pick(si,tokId,false);
  if(changed){ const s=DOC[si], t=s&&s.tokens[tokId-1], v0=t?(t.form||""):"";
    const v=await itransFix(v0);
    if(t && v!==v0 && t.form===v0){ t.form=v; markDirty(); preserveScroll(renderDoc); } }   // makeEditable's finish() already pushed the pre-edit undo snapshot — the conversion rides on that same step, so undo takes one press to get back to where the typing started
  afterFormEdit(si,tokId,changed); }
function editTransInline(si,tokId,clickXY){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return; const el=transElOf(si,tokId); if(!el)return;
  if(iastFormEdit()){   // Item 10: Sanskrit + real script → this IAST row IS the editable form field. Bind the edit to the token FORM (the stored IAST); on commit regenTok re-derives the script glyph above from the new IAST. Mirrors editNodeInline's form binding, and joins the same form-row Tab/arrow navigation.
    makeEditable(el, s.tokens[tokId-1], "form", changed=>afterDiagramFormEdit(si,tokId,changed), sentRTL(s), ()=>transElOf(si,tokId), d=>tierNav(si,tokId,"form",d), false, clickXY);   // item 9: anchor the lemma box under THIS row (the IAST), which is the one being edited   // …including the lemma double-click: this row IS the form field here, so it carries the form field's gesture
    return; }
  if(typeof storedTrEditable==="function" && storedTrEditable()){ editStoredTransInline(si,tokId,clickXY); return; }   // non-deterministic romanisation → this row edits the STORED transliteration (MISC Translit, in the stored scheme), and the displayed row is re-derived from it. Ahead of the ORTHO_SCHEME guard below: a Chinese document displayed in Traditional glyphs still stores a romanisation, so it must still be correctable
  if(ORTHO_SCHEME)return;   // any OTHER re-rendering scheme (a non-Sanskrit script / Latin / transform) → the romanisation row is not editable
  makeEditable(el, s.tokens[tokId-1], "translit",
    changed=>{ if(!changed){ preserveScroll(renderDoc); return; }   // item 1: a cancelled/unchanged edit writes nothing and marks nothing dirty — it only puts the row back
      const t=s.tokens[tokId-1]; t.misc=setMiscKV(t.misc,"Translit",t.translit||""); t._trMisc=!!(t.translit); markDirty(); preserveScroll(renderDoc); },   // persist the edit to MISC Translit (a manual edit is authoritative)
    sentRTL(s), ()=>transElOf(si,tokId), null, false, clickXY); }
// inline-edit a token's gloss / morphemic tier on a diagram → the tier's MISC attribute (a proxy maps the "v" key onto MISC so the live preview reads/writes the same store)
function tierElOf(si,tokId,tier){ const g=tokGroupOf(si,tokId);
  return g?g.querySelector(`.gl-edit[data-tier="${tier}"]`):null; }
// item 4: the navigable vertical stack for arrow/Tab cell navigation — the token FORM row is the TOPMOST tier,
// then the present gloss tiers (gloss / mseg / mgloss). Up/Down step through this stack at one token column.
function navStack(){ return ["form"].concat(belowTiers()); }
function editCell(si,tokId,tier,clickXY){ if(tier==="form") editNodeInline(si,tokId,clickXY); else editTier(si,tokId,tier,clickXY); }   // "form" → the surface-form editor, else the gloss-tier editor
function tierNav(si,tokId,tier,d){ const s=DOC[si]; if(!s)return; const stack=navStack(); const ti=stack.indexOf(tier); if(ti<0)return; let nt=tier, nk=tokId;
  if(d.tier){ const j=ti+d.tier; if(j<0||j>=stack.length)return; nt=stack[j]; }   // Up/Down: across tiers (incl. the form row), same token
  if(d.tok){ const k=tokId+d.tok; if(k<1||k>s.tokens.length)return; nk=k; }        // Left/Right/Tab: token-wise along the tier
  if(nt===tier && nk===tokId)return;
  if(nk!==tokId) pick(si,nk,false,false);   // keep the selection highlight (grid row + diagram token) in step with the editor AS it moves between tokens — editNodeInline/editTier only call pick() from their COMMIT callback (blur/Enter), which doesn't fire again until you leave the field, so without this the highlight lagged one token behind the editor while you kept arrowing/tabbing through
  revealTok(si,nk);   // item 6: …and bring that token into view BEFORE the field opens over it. Order matters: makeEditable's place() measures the element's rect once on open, and its elClippedOut() check HIDES the field outright while the element is scrolled out of its own .diagram — so Tab-ing along a wide unwrapped diagram used to walk the editor off the edge and then make it disappear, rather than scrolling after it
  editCell(si,nk,nt,d.caret!=null?{at:d.caret}:undefined); }   // Up/Down and Left/Right carry a caret hint (column-preserving offset, or the near edge) — Tab has none, so it still selects all, unchanged
function editTier(si,tokId,tier,clickXY){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return; const tk=s.tokens[tokId-1]; const key=TIER_MISC[tier]||"Gloss"; const el=tierElOf(si,tokId,tier); if(!el)return;
  // item: the MSeg tier's word-continuation mark is decoration the renderer hangs BESIDE the row (svgSeamMark /
  // htmlSeamMark) and never part of the value — so the field simply opens on what's stored, over text whose box
  // the mark never entered, and msegStrip keeps a typed one from reaching MISC through the back door. The user
  // can't type it, can't delete it, and can't leave a stale one behind: it follows the seam and only the seam.
  // Every other tier edits its stored text directly.
  const proxy={ get v(){ return tierText(tk,tier); },
    set v(val){ const enc=glossEnc(val), prev=tier==="mseg"?tierText(tk,"mseg"):"";
      tk.misc=setMiscKV(tk.misc,key,tier==="mseg"?msegStrip(enc,!!seamPost(tk),!!seamPre(tk)):enc);
      if(tier==="mseg") mglossSplitTypedHyphen(tk,prev,tierText(tk,"mseg")); } };   // a hyphen TYPED here says where the boundary goes, so a gloss already written as lexical-plus-grammatical divides along it ("walk.PST" over "walk-ed" → "walk-PST"). Narrow on purpose — see mglossSplitTypedHyphen (js/editing/edit-ops.js) for the three conditions and why the machine-driven mglossReslot answers this case differently. Read `prev` from MISC rather than trusting the field's own opening value: the mark msegStrip removes never entered it
  // item 12b: on a committed MGloss edit, sync the token's FEATS from the recognised unambiguous gloss tokens —
  // adds a feature that's missing, UPDATES one whose value the edited gloss now disagrees with, and leaves any
  // feature the gloss text doesn't speak to untouched. This shares the edit's single undo snapshot
  // (makeEditable/makeGlossEditableSC pushed it before calling `after`).
  // MSeg has no such back-sync: its continuation mark is drawn, not stored (see the proxy above), so an MSeg edit
  // speaks only for the segmentation itself and leaves FEATS alone. What a regrouping implies runs from renderDoc
  // instead — see msegFlagSent.
  const after=changed=>{ if(!changed){ preserveScroll(renderDoc); return; }   // item 1: opening a gloss field and leaving it as it was changes nothing, so it dirties nothing
    if(tier==="mgloss") mglossSyncFeats(tk);
    /* AN MSeg EDIT IS ALSO A STATEMENT ABOUT THE WORD, not only about where its morphemes divide: strip
       the boundary hyphens and what is left is the word itself. Writing that back is the inverse of
       msegPrefillParts, which is what DERIVES the segmentation — so the same test decides the target.
       That function segments the TRANSLITERATION where the language has one (translitNeeded) and the FORM
       otherwise, so an edit lands on whichever of the two it was segmenting; anything else would correct
       a string the tier was never describing.
       Writing a FORM goes through afterFormEdit, because a form is not a private field: `# text` spells
       this word and everything derived from it is now stale. No loop — msegRefill declines to re-derive a
       hand-edited MSeg (its `cur!==t._msegPre` guard), and this edit has just made it one.
       "=" is left alone: it is the CLITIC seam, a character the form legitimately carries (openConvertMWT
       reads it), so stripping it would rewrite the word rather than un-segment it. Only "-" goes. */
    /* ⚠ DEFENSIVE: A HAND-TYPED VOWEL-LENGTH MARK COMES OFF BEFORE IT REACHES FORM. Nothing in this app
       writes a macron/breve into the MSeg tier's text any more, but the FORM column must still never
       carry one — the treebanks spell Latin bare and the file must round-trip byte-identically — so if
       a reader types one in by hand while editing MSeg, de-hyphenating it and writing it back verbatim
       would put that mark in the form, in `# text`, and in the saved file. Stripping it first leaves
       exactly the bare word; an edit that only moved the boundary then compares equal and writes
       nothing at all, as it should. */
    if(tier==="mseg"){ let bare=tierText(tk,"mseg").replace(/-/g,"");
      if(bare && (DOCLANG||"").toLowerCase().split(/[-_]/)[0]==="la") bare=bare.normalize("NFD").replace(/[̄̆]/g,"").normalize("NFC");   // combining macron + breve, taken off the DECOMPOSED string so precomposed ā and a+U+0304 are caught alike
      if(bare){
        if(typeof translitNeeded==="function" && translitNeeded(DOCLANG)){
          if((tk.translit||"")!==bare){ tk.translit=bare; tk.misc=setMiscKV(tk.misc,"Translit",bare); tk._trMisc=true; markDirty(); }
        } else if((tk.form||"")!==bare){ tk.form=bare; markDirty();
          if(typeof afterFormEdit==="function") afterFormEdit(si,tokId,true); } } }
    markDirty(); preserveScroll(renderDoc); };
  if(tier!=="mseg") makeGlossEditableSC(el, proxy, "v", after, sentRTL(s), ()=>tierElOf(si,tokId,tier), d=>tierNav(si,tokId,tier,d), clickXY, tier==="mgloss"?tk:null);   // live c2sc small-caps on its Leipzig abbreviations as the user types — on BOTH gloss tiers, matching how both now render (setGlossText); MSeg is word text, not a gloss, so it keeps the plain <input> editor. Task C: the trailing token is the MGloss abbreviation-autocomplete's UPOS context (AMBIG_UPOS) — passed ONLY for "mgloss" (a lexical Gloss definition isn't built from Leipzig abbreviations, so it gets no dropdown)
  else makeEditable(el, proxy, "v", after, sentRTL(s), ()=>tierElOf(si,tokId,tier), d=>tierNav(si,tokId,tier,d), true, clickXY); }   // item 2: allowEmpty → a gloss/MSeg value can be deleted (cleared), unlike a Form
// nearest character boundary, as an index into `text`, to a LOCAL x-offset (0 = the start of the rendered run) —
// walks cumulative substring widths via the same canvas metric (meas) the field itself was sized/centred with, so
// it lines up with what's actually on screen. Used to drop the caret where the field was clicked, not select-all.
function caretIndexForX(text,fontStr,localX){ if(localX<=0) return 0;
  const total=meas(text,fontStr); if(localX>=total) return text.length;
  let prev=0; for(let i=1;i<=text.length;i++){ const w=meas(text.slice(0,i),fontStr); if(w>=localX) return (localX-prev<w-localX)?i-1:i; prev=w; }
  return text.length; }
// a small field positioned exactly over the token's own text element (which is centred), styled to read as the text itself.
// true when `el` is currently scrolled fully out of sight behind SOME clipping ancestor (an .overflow:auto/hidden
// scroller — a per-block .diagram/.gwrap capped at --cap-dia/--cap-grid, or the outer .doc) — as opposed to merely
// scrolled out of the window, which position:fixed already handles for free. Used to HIDE a floating field/menu
// that tracks `el` via getBoundingClientRect() (position:fixed, re-placed on scroll) but isn't itself inside that
// scroller, so it would otherwise keep floating over the block/grid/titlebar instead of clipping away with the
// token underneath it.
/* IS THIS ELEMENT SCROLLED OUT OF ITS CONTAINER? Drives `place()`'s visibility toggle: an inline
   editor is position:fixed and appended to <body>, outside the diagram's own scroller, so it must
   hide itself when the token it covers scrolls away rather than float over unrelated content.
   ⚠ A ZERO-SIZE RECT IS NOT EVIDENCE OF THAT, and treating it as such was a real bug. An EMPTY
   token's form element has no text and therefore no extent — and that is precisely the element an
   INSERTED token's editor has to anchor to. Reporting it clipped hid the field (visibility:hidden),
   and `focus()` on a hidden element is a no-op in every browser, so the editor opened invisible and
   unfocused and a newly inserted token could not be typed into at all. Detachment is already
   covered by `isConnected` above, and an element inside a display:none subtree is still caught by
   the ancestor test below — its container's rect is zero too, so the containment test fails.
   A zero-size rect is therefore INFLATED to a caret-sized box before the containment test rather
   than tested as a point. The containment test is exclusive at the edges (`r.bottom <= nr.top`), so
   a point sitting anywhere on its container's boundary reads as outside it — and an empty token's
   insertion point sits exactly there whenever the diagram is scrolled to it. Measured: the inserted
   token's element came out at y=96 against a `.diagram` scroller starting at y=101, a five-pixel
   miss that hid the editor for a token plainly on screen. A real token's 16px box clears it; a point
   never can, which is why the fix belongs to the rect and not to the caller. */
const _CARET_BOX=9;   // half a line — enough to clear the boundary case above, small enough that a genuinely scrolled-away point still reads as clipped
function elClippedOut(el){ if(!el||!el.isConnected)return true; let r=el.getBoundingClientRect();
  if(!r.width&&!r.height) r={top:r.top-_CARET_BOX, bottom:r.bottom+_CARET_BOX,
                              left:r.left-_CARET_BOX, right:r.right+_CARET_BOX};
  for(let n=el.parentElement;n;n=n.parentElement){ const cs=getComputedStyle(n);
    if(!/(auto|scroll|hidden|clip)/.test(cs.overflowY)&&!/(auto|scroll|hidden|clip)/.test(cs.overflowX))continue;
    const nr=n.getBoundingClientRect();
    if(r.bottom<=nr.top||r.top>=nr.bottom||r.right<=nr.left||r.left>=nr.right)return true; }
  return false; }
// `relocate` re-finds that element after a live re-render, so the field can grow/shrink the diagram to fit as you type.
// `clickXY` ({x,y} in viewport coords, or omitted) — a single click opening the field drops the caret there instead
// of selecting everything; a keyboard-triggered open (Enter, Tab/arrow tier-nav) has no click point, so it still
// selects all, exactly as before.
// caretHint: {x,y} (a click point, mapped to a character offset below) or {at:0|"start"|"end"|<number>} (a
// logical offset — from arrow-key tier/token navigation, which has no click point to reference at all).
// hide the original text while its floating .nodeedit field sits over it. NOT plain opacity:0 — a form element
// (.bwform, the wrapped-bracket view) has the token's OTHER tiers (POS/relation/translit/gloss, in .bwund)
// nested INSIDE it as DOM children, purely so they can use it as a centring anchor (see the render code around
// wf.appendChild(und)); opacity cascades to descendants, so hiding the form that way hid every tier riding along
// with it too. fill/stroke (SVG) or color (HTML) only ever hide the element's OWN glyph, never its children's
// independently-coloured content.
/* The element the pointer last went down on. Recorded in the CAPTURE phase so it is set before any handler
   (or any focus change) can run, and read by the inline editor's blur to tell "clicked elsewhere in this
   sentence" from "clicked out of it entirely" — a blur event carries no such information of its own. */
window.LAST_POINTER_EL=null;   // on `window` rather than a top-level `let`: a classic script's `let` lives in the global LEXICAL environment, which is not the same place a `window.x` lookup reaches — and this value is written by one module and read by another, so the unambiguous slot is worth the verbosity
document.addEventListener("pointerdown",e=>{ window.LAST_POINTER_EL=e.target; window.LAST_POINTER_PT={x:e.clientX,y:e.clientY}; },true);
// Hides the diagram element under a freshly-opened inline field, AND drops that sentence's entry in the
// notation-switch diagram cache (js/core/document.js's DIA_CACHE) — every makeEditable call site (form/lemma/
// translit/gloss-tier/MWT-form/CorrectForm) targets an element that lives INSIDE a cached diagram, and this is
// the one place all of them pass through before the field opens. Without this, committing (or even cancelling)
// the edit calls preserveScroll(renderDoc) → diaSentence() sees the SAME diaFlagsSig() as before (that
// signature tracks view options, not token content) → CACHE HIT → the rebuild reuses this exact DOM node
// instead of a fresh one, fill/stroke:transparent and all — the token silently vanishes and the diagram keeps
// showing its PRE-EDIT text, because nothing ever set el.style.fill back. Bug looked theme-specific when first
// reported ("disappears in dark mode") only because transparent-on-transparent is unconditionally invisible in
// either theme and nobody had tried light mode; reproduced and confirmed via headless-Chrome CDP with no theme
// involved at all — see the fix's own commit for the harness. Eager rather than conditioned on the edit
// actually changing anything: a CANCELLED edit still ran hideOrig, so its cached node is just as stale.
function hideOrig(el){ if(el.namespaceURI===SVGNS){ el.style.fill="transparent"; el.style.stroke="transparent"; } else el.style.color="transparent";
  const blk=el.closest&&el.closest(".sblock[data-i]"); if(blk&&typeof invalidateDiaSentence==="function") invalidateDiaSentence(+blk.getAttribute("data-i")); }
function makeEditable(el,obj,key,after,rtl,relocate,nav,allowEmpty,caretHint){ if(!el)return; let orig=obj[key]||""; const pre=snap();
  INLINE_EDIT_OPEN=true;   // …and cleared in `finish` below, so a background re-render cannot pull the caret out of this field (see the flag in js/core/prefs.js)
  /* THE FIELD UPDATES UNDER THE CARET when the value beneath it moves — a background pass changing the very
     thing being edited (the re-parse revising a lemma, a Sanskrit re-fuse respelling a form) would otherwise
     leave a live editor showing a string the document no longer holds, and committing it would write the
     stale one back.
     ⚠ ONLY WHILE THE READER HAS NOT TYPED. `base` is the last value WE put in the field; once inp.value has
     moved away from it the reader is mid-word, and their text is the newer statement about this field — a
     background pass must not take the keyboard out from under them. `orig` follows too, or the commit's
     changed-test would compare against a value that has not been on screen since the field opened. */
  let base=orig;
  INLINE_EDIT_SYNC=()=>{ const v=obj[key]||""; if(inp.value!==base||v===base) return false;
    /* …and the caret stays put. Writing .value drops it to the end, which would be a visible jump in a field
       the reader has not touched — the one state this branch runs in. Clamped, since the new value may be
       shorter than where they were sitting. */
    const ss=inp.selectionStart, se=inp.selectionEnd;
    inp.value=base=orig=v;
    if(ss!=null){ try{ inp.setSelectionRange(Math.min(ss,v.length),Math.min(se==null?ss:se,v.length)); }catch(e){} }
    if(typeof reflow==="function") reflow(); return true; };
  const inp=document.createElement("input"); inp.className="nodeedit"+(key==="form"?formDeco(obj):""); inp.value=orig;   // item 4: while editing a token FORM, keep its Typo strikethrough on the edit field so the marker doesn't blink off mid-edit (the Foreign italics come across via applyFont, which copies the form's computed font-style)
  let fontStr; const applyFont=e=>{ const cs=getComputedStyle(e);   // `e` lives inside .sblock{zoom:var(--fs)} but `inp` is appended to <body>, OUTSIDE that zoomed context — so the size has to be converted by hand, or the field renders at a different size from the diagram text it is covering
    const sizePx=visualFontPx(e)+"px";   // js/core/document.js — computed × cssLenScale × zoom, the last two PROBED because Chrome and WebKit report an SVG length inside a zoomed subtree differently. This used to be a bare `×FS`, which is right in Chrome and lands back on the UNZOOMED size in WebKit (see cssLenScale's note): the field opened at 100 % over a diagram drawn at 160 %
    inp.style.fontFamily=cs.fontFamily; inp.style.fontSize=sizePx; inp.style.fontWeight=cs.fontWeight; inp.style.fontStyle=cs.fontStyle; fontStr=cs.fontStyle+" "+cs.fontWeight+" "+sizePx+" "+cs.fontFamily;
    // …and the row's INK, which .nodeedit's own `color:var(--text)` would otherwise override. Without this the
    // transliteration row (.translit/.otrans — italic, --dia-muted) visibly jumped to full-strength body text the
    // moment it was clicked into, on single tokens and on an MWT's IAST row alike. Read off the edited element
    // rather than re-listing the per-row values here: those rows already carry four different inks (--text,
    // --dia-muted, and the .sel/.rng accent overrides on top of both), and a second copy of that table in JS would
    // be one more thing to keep in step with the stylesheet every time a row's colour changes. Same reason the
    // family/size/weight/style above are copied rather than named. SVG text paints through `fill`, HTML through
    // `color`; "none"/transparent means the element is mid-edit-hidden already (hideOrig) and must not be copied.
    const ink=(e.namespaceURI===SVGNS)?cs.fill:cs.color;
    if(ink && ink!=="none" && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(ink)) inp.style.color=ink; };
  applyFont(el);   // letter-spacing is deliberately NOT copied: caretIndexForX hit-tests the click point with meas(), a canvas metric that carries no tracking, so a tracked field would drop the caret progressively further from the character actually clicked
  const w0=Math.max(30,el.getBoundingClientRect().width+16);   // never shrink the field below the initial content width
  const place=()=>{ const r=el.getBoundingClientRect(), h=Math.max(16,r.height+2), cx=r.left+r.width/2, w=Math.max(w0, meas(inp.value,fontStr)+18);
    inp.style.width=w+"px"; inp.style.height=h+"px"; inp.style.left=(cx-w/2)+"px"; inp.style.top=(r.top+r.height/2-h/2)+"px";
    inp.style.padding=inp.value?"0":"0 2px";   // zero horizontal padding once there's real text to align flush with the diagram — an EMPTY field has no text to align, so it keeps a little breathing room around the bare caret instead of collapsing the click target right down to it
    inp.style.visibility=elClippedOut(el)?"hidden":""; };   // the token being edited can scroll out of view behind a capped .diagram/.gwrap or the outer .doc without losing focus (browsers don't blur on scroll-out) — hide the field rather than let it float over content it no longer sits above
  document.addEventListener("scroll",place,{capture:true,passive:true});   // the field is position:fixed, appended OUTSIDE the diagram's own scroller (.doc, an inner overflow:auto) — without this it stayed glued to the viewport while the token underneath scrolled away. Capture phase: "scroll" doesn't bubble, so a listener on the (non-bubbling) target only sees its OWN scroller — capture on document sees every scroller, including .doc and any nested .diagram
  place();
  inp.dir=rtl?"rtl":"ltr"; hideOrig(el); document.body.appendChild(inp); inp.focus();
  if(caretHint){
    let idx;
    if(caretHint.at==="start") idx=0;
    else if(caretHint.at==="end") idx=inp.value.length;
    else if(typeof caretHint.at==="number") idx=Math.max(0,Math.min(inp.value.length,caretHint.at));   // clamp: the field you're arriving at may be shorter than the one you left
    else { const r=inp.getBoundingClientRect(), tw=meas(inp.value,fontStr);   // the field is centred and often wider than its own text (room to grow while typing) — locate the actual text run within it first
      const textLeft=r.left+(r.width-tw)/2, textRight=textLeft+tw;
      const localX=rtl?(textRight-caretHint.x):(caretHint.x-textLeft);   // RTL: index 0 sits at the visual RIGHT edge
      idx=caretIndexForX(inp.value,fontStr,localX); }
    try{ inp.setSelectionRange(idx,idx); }catch(_){ inp.select(); } }
  else inp.select();
  /* Task A — LOCAL only, until commit. This used to write obj[key]=inp.value and preserveScroll(renderDoc) — a
     FULL #doc rebuild — on every single keystroke, "so the diagram accommodates the entry (grows as it
     lengthens, shrinks as it shortens)". That's also exactly what made typing a Form/Lemma/translit field in
     the diagram retype the GRID cell underneath it in real time, and made every keystroke here as expensive as
     a full re-render. place() alone already grows/shrinks the FIELD itself to fit what's typed (it measures
     inp.value directly) — the diagram reflowing everything else around it is a nice-to-have this app can no
     longer afford per keystroke, so it now waits for commit, same as the model write. relocate() is dropped
     too: it existed to re-find `el` after a renderDoc rebuilt it out from under the field, which no longer
     happens mid-edit — see finish() below, which still does both the write and the render, exactly once. */
  const reflow=()=>{ place(); };
  const finish=save=>{ if(inp._closed)return; inp._closed=true; const v=inp.value.trim(), changed=save&&(v||allowEmpty)&&v!==orig;   // item 2: gloss/morphemic tiers pass allowEmpty → an emptied value COMMITS (clears the tier) instead of reverting; the Form editor keeps allowEmpty falsy, so a form can't be blanked
    obj[key]=changed?v:orig;   // commit the trimmed value, or revert the live edits on cancel/no-op
    if(changed){ UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); markDirty(); }   // one undo step for the whole edit (the snapshot from before it began)
    INLINE_EDIT_OPEN=false; INLINE_EDIT_SYNC=null;   // BEFORE the render below: that one is this edit's own consequence and must run
    document.removeEventListener("scroll",place,{capture:true}); inp.remove(); preserveScroll(renderDoc); if(after)after(changed); };   // pass `changed` so a commit-only hook (e.g. MGloss→FEATS back-fill) can distinguish a real commit from a cancel/no-op
  inp.addEventListener("input",reflow);
  inp.addEventListener("keydown",ev=>{
    if(nav){   // item 4: gloss-tier cell navigation — commit the current cell, then focus the target cell
      const collapsed=inp.selectionStart===inp.selectionEnd;   // item 4: a real caret, NOT the whole-item selection a double-click opens with
      const atStart=collapsed && inp.selectionStart===0;         // only step to the previous token when the caret is genuinely collapsed at the left edge — from a full selection, ArrowLeft first collapses to that edge (the browser default), it doesn't jump tokens
      const atEnd=collapsed && inp.selectionStart===inp.value.length;   // likewise ArrowRight from a full selection collapses to the right edge first, then a second press steps to the next token
      // item 1: Shift+←/→ at the field edge extends a multi-token selection into the adjacent token (reading-order,
      // RTL-aware) instead of navigating into its editor — commit this edit, then grow the range from the doc's
      // own Shift+arrow logic. The caret must be collapsed at the matching edge, exactly like the nav case below.
      if(ev.shiftKey && (ev.key==="ArrowRight"||ev.key==="ArrowLeft")){
        const fwd=(ev.key==="ArrowRight")!==!!rtl, atEdge=fwd?atEnd:atStart;
        if(atEdge && sel.s>=0 && sel.t>0){ ev.preventDefault(); ev.stopPropagation(); finish(true); extendSelToward(fwd?1:-1); return; } }
      let d=null;   // arrow-triggered nav carries a caret hint (Tab intentionally doesn't — it still selects all on arrival, unchanged)
      if(ev.key==="Tab") d={tok:ev.shiftKey?-1:1};
      else if(ev.key==="ArrowUp") d={tier:-1, caret:inp.selectionStart};   // vertical: preserve the column (character offset), like a text editor
      else if(ev.key==="ArrowDown") d={tier:1, caret:inp.selectionStart};
      else if(ev.key==="ArrowRight" && atEnd) d={tok:1, caret:"start"};   // horizontal: land at the near edge of the field you're entering
      else if(ev.key==="ArrowLeft" && atStart) d={tok:-1, caret:"end"};
      if(d){ ev.preventDefault(); ev.stopPropagation(); finish(true); nav(d); return; }
    }
    if(ev.key==="Enter"){ev.preventDefault(); finish(true);} else if(ev.key==="Escape"){ev.preventDefault(); finish(false);} ev.stopPropagation(); });
  /* item 5 — A BLUR THAT NOTHING ELSE ACCOUNTED FOR IS A CLICK AWAY, and a click away from the diagram's
     editing is a click away from the token: the selection goes with it. Every DELIBERATE exit closes the field
     itself first (Enter and Escape call finish() in the keydown handler, Tab/arrow navigation calls it before
     moving on, the context menu calls it before opening), so by the time their blur arrives `_closed` is already
     set and this sees nothing left to do. What reaches here still open is precisely the pointer landing
     somewhere else — and if that somewhere is another token, the click handler that follows picks it, so the
     net effect is the new selection rather than none.
     ESCAPE IS THE EXCEPTION ON PURPOSE, and the reason it is worth stating: it is the one exit that means "undo
     my reaching for this field", so it puts the field away and leaves the token exactly as selected as it was. */
  inp.addEventListener("blur",()=>{ const wasOpen=!inp._closed, si0=sel.s;
    /* WHERE THE POINTER LANDED IS READ BEFORE finish(), not after: finish() calls preserveScroll(renderDoc),
       which rebuilds #doc, and the recorded element is then a detached node whose closest() can no longer reach
       a .sblock at all — it would answer "outside the block" for every click, including the ones inside it. */
    const tgt=window.LAST_POINTER_EL||null;
    /* WHAT WAS CLICKED BECOMES THE SELECTION. A click that ends an edit is not merely an exit from the field —
       it is the user pointing at something, and the selection should follow the pointer rather than be thrown
       away and left for some other handler to maybe restore. Three cases, narrowest first:
         a TOKEN (diagram group or grid row, both carry data-s/data-tok) → select that token;
         anywhere else INSIDE a sentence block                          → keep the block, drop the token;
         outside the document entirely                                  → clear the selection.
       Escape never reaches here (it closes the field itself), so it still leaves the selection exactly alone. */
    let want=null;
    if(wasOpen && tgt && tgt.closest){
      const tokEl=tgt.closest("[data-tok][data-s]"), blk=tgt.closest(".sblock[data-i]");
      if(tokEl) want={s:+tokEl.getAttribute("data-s"), t:+tokEl.getAttribute("data-tok")};
      else if(blk) want={s:+blk.getAttribute("data-i")};
      else if(si0>=0 && tgt.closest("#doc")) want={s:si0}; }   // inside the document but not resolvable to a block → keep the sentence we were editing
    // …and remember whether the click landed on an editable SENTENCE LINE, so the caret can be restored into it
    const lineTag=(wasOpen&&tgt&&tgt.closest)?(tgt.closest(".stext[contenteditable]")?".stext[contenteditable]":(tgt.closest(".strans-orig")?".strans-orig":null)):null;
    finish(true);
    if(!wasOpen) return;
    if(want&&want.t>0&&typeof pick==="function") pick(want.s,want.t,false,false);
    else if(want&&typeof clearSelToBlock==="function") clearSelToBlock(want.s,false);
    /* …and a click that landed OUTSIDE #doc — the options drawers, the toolbar, the status bar, a sheet — leaves
       the selection exactly where it was. It used to deselectAll() here, on the reading that leaving the document
       means leaving the selection behind; but reaching for an option is not a statement about the token you are
       working on, and having the selection (with its subtree dimming) evaporate every time you opened a drawer
       made the drawers unusable mid-edit. Clearing the selection still has its own gestures — clicking empty
       space inside a block, or below the last block (see the #doc click handler in js/core/undo.js). */
    /* item 2 — CLICKING THE RUNNING SENTENCE PUTS THE CARET THERE. The click did reach the line, but finish()
       rebuilt #doc underneath it, so the element the browser had just focused no longer existed and the caret
       went nowhere. Re-find the line in the REBUILT document and place the caret at the point that was clicked,
       which is the same move the line's own focus handler makes after its repaint. */
    /* DEFERRED, and that is the whole fix. This blur is fired from #doc's own pointerdown handler, BEFORE the
       browser has done its native focus shift — so focusing the line here only to have the native click land on
       the freshly rebuilt line a moment later put us back where we started: that line's focus handler repaints
       and re-places the caret from a click point its own (new) closure never recorded, and the caret went to the
       start. Running after the current task lets the native sequence finish first, so this is the LAST word. */
    if(wasOpen && lineTag) setTimeout(()=>{ const si2=(want&&want.s>=0)?want.s:si0;
      const b2=si2>=0&&document.querySelector('.sblock[data-i="'+si2+'"]');
      const el2=b2&&b2.querySelector(lineTag);
      if(!el2) return;
      if(document.activeElement!==el2) el2.focus();
      const pt=window.LAST_POINTER_PT;
      if(pt&&typeof caretAtPoint==="function") caretAtPoint(el2,pt.x,pt.y); },0); });
  // item 6: right-clicking the active inline editor opens the TOKEN menu (not the browser's native field menu) —
  // commit the edit first, then open it for the token being edited (the current selection).
  inp.addEventListener("contextmenu",ev=>{ ev.preventDefault(); ev.stopPropagation(); const cs=sel.s, ct=sel.t; finish(true);
    if(cs>=0&&ct>0) nodeTokenMenu(ev.clientX,ev.clientY,cs,ct); });
  return inp; }   // the field itself, for a caller that wants to reach it after openingblclick
/* bindLemmaDblclick WAS HERE — a native dblclick inside an open form field opened the lemma editor,
   the counterpart to a double-tap on the token itself. Both gestures are gone: ⌘L reaches the same
   editor from the keyboard and the token context menu names it, neither of which needs the reader to
   discover that double-clicking a word means something other than selecting it. */
// caret position, as a plain character count into `el`'s textContent (ignoring the internal .glabbr span
// boundaries) — how far to walk back in after a rebuild that just replaced those spans.
function caretOffset(el){ const sel=window.getSelection(); if(!sel||!sel.rangeCount) return el.textContent.length;
  const r=sel.getRangeAt(0), pre=r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.endContainer,r.endOffset);
  return pre.toString().length; }
function setCaretOffset(el,offset){ const sel=window.getSelection(); if(!sel)return; const range=document.createRange();
  let remaining=offset, found=false;
  (function walk(n){ if(found)return;
    if(n.nodeType===3){ if(remaining<=n.length){ range.setStart(n,remaining); range.setEnd(n,remaining); found=true; } else remaining-=n.length; }
    else for(const c of n.childNodes){ walk(c); if(found)return; } })(el);
  if(!found){ range.selectNodeContents(el); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range); }
// nodeOffsetToCharOffset: the inverse building block behind caretOffset above, generalised to ANY (node,offset)
// pair within `el` — not just the current selection's end. Used by the glabbrbox arrow-key handler below to
// convert Selection.anchorNode/focusNode (which, unlike a Range's start/end, correctly track a SHIFT-extended
// selection's true anchor/focus regardless of which direction it was extended in) into plain character counts.
function nodeOffsetToCharOffset(el,node,offset){ const r=document.createRange(); r.selectNodeContents(el); r.setEnd(node,offset); return r.toString().length; }
// place a selection spanning [anchorOff,focusOff) by CHARACTER offset (anchor = where a shift-select started,
// focus = the end currently under keyboard control — setBaseAndExtent keeps them independent of DOM order, so
// this works correctly whether the selection was extended forward or backward).
function setCaretRange(el,anchorOff,focusOff){ const sel=window.getSelection(); if(!sel)return;
  const locate=off=>{ let remaining=off,found=null;
    (function walk(n){ if(found)return;
      if(n.nodeType===3){ if(remaining<=n.length){ found=[n,remaining]; } else remaining-=n.length; }
      else for(const c of n.childNodes){ walk(c); if(found)return; } })(el);
    return found||[el,el.childNodes.length]; };
  const [an,ao]=locate(anchorOff), [fn,fo]=locate(focusOff);
  sel.setBaseAndExtent(an,ao,fn,fo); }
// the MGloss inline editor: a contenteditable box (NOT an <input> — a flat input value can't carry the PARTIAL
// small-caps styling a Leipzig abbreviation needs), re-splitting into text/.glabbr nodes on every keystroke —
// "dynamically as the user types" — while preserving the caret across the rebuild. Otherwise mirrors makeEditable
// (positioning, live reflow, Tab/arrow tier navigation, undo snapshot); mgloss always allows an empty commit.
// caretHint: {x,y} (a click point, hit-tested below) or {at:0|"start"|"end"|<number>} (a logical offset, from
// arrow-key tier/token navigation — see makeEditable's own caretHint doc).
function makeGlossEditableSC(el,obj,key,after,rtl,relocate,nav,caretHint,mglossTok){ if(!el)return; const orig=obj[key]||"", pre=snap();
  const box=document.createElement("div"); box.className="nodeedit glabbrbox"; box.contentEditable="plaintext-only";
  let fontStr; const applyFont=e=>{ const cs=getComputedStyle(e); const sizePx=visualFontPx(e)+"px";   // see makeEditable's applyFont: the size is CONVERTED, not multiplied by FS — the two engines report an SVG length inside a zoomed subtree differently (cssLenScale, js/core/document.js)
    box.style.fontFamily=cs.fontFamily; box.style.fontSize=sizePx; box.style.fontWeight=cs.fontWeight; box.style.fontStyle=cs.fontStyle; fontStr=cs.fontStyle+" "+cs.fontWeight+" "+sizePx+" "+cs.fontFamily; };
  applyFont(el);
  const render=text=>{ box.innerHTML=""; glossAbbrSegments(text).forEach(([t,abbr])=>{
    if(!abbr){ box.appendChild(document.createTextNode(t)); return; }
    const s=document.createElement("span"); s.className="glabbr"; s.textContent=t; box.appendChild(s); }); };
  render(orig);
  const w0=Math.max(30,el.getBoundingClientRect().width+16);
  const place=()=>{ const r=el.getBoundingClientRect(), h=Math.max(16,r.height+2), cx=r.left+r.width/2, w=Math.max(w0, meas(box.textContent,fontStr)+18);
    box.style.width=w+"px"; box.style.height=h+"px"; box.style.left=(cx-w/2)+"px"; box.style.top=(r.top+r.height/2-h/2)+"px";
    box.style.padding=box.textContent?"0":"0 2px";   // see makeEditable's place() for why — zero once there's real text, a little breathing room around the bare caret when empty
    box.style.visibility=elClippedOut(el)?"hidden":""; };   // see makeEditable's place() for why
  document.addEventListener("scroll",place,{capture:true,passive:true});   // see makeEditable's place() for why: position:fixed appended outside the diagram's own inner-scrolling .doc needs re-placing on every ancestor scroll, caught via capture (scroll doesn't bubble)
  place();
  box.dir=rtl?"rtl":"ltr"; hideOrig(el); document.body.appendChild(box); box.focus();   // hideOrig, NOT the plain el.style.opacity="0" this used to set. Two separate faults, and the second is the one that bit: (a) opacity CASCADES, so on a wrapped .bwform whose other tiers are nested inside it as centring children the whole stack faded, which is the very reason hideOrig exists; (b) — the disappearing gloss — opacity:0 skipped hideOrig's OTHER half, the DIA_CACHE invalidation, so committing (or cancelling) an edit on either gloss tier re-rendered into a CACHE HIT that reused this exact node with opacity:0 still on it: the gloss text vanished from the diagram and the cached row kept its pre-edit content. Identical in kind to the token-form case hideOrig's own note describes; makeGlossEditableSC was simply the one editor that never passed through it
  let _placedAtClick=false;
  if(caretHint){
    if(caretHint.at==="start"||caretHint.at==="end"||typeof caretHint.at==="number"){
      const idx=caretHint.at==="start"?0:caretHint.at==="end"?box.textContent.length:Math.max(0,Math.min(box.textContent.length,caretHint.at));   // clamp: the field you're arriving at may be shorter than the one you left
      setCaretOffset(box,idx); _placedAtClick=true;
    } else if(document.caretRangeFromPoint){ const rg=document.caretRangeFromPoint(caretHint.x,caretHint.y);   // WebKit/Chromium hit-test straight into the box's live text/.glabbr nodes — exact, no manual measuring needed
      if(rg && box.contains(rg.startContainer)){ const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(rg); _placedAtClick=true; } }
  }
  if(!_placedAtClick){ const range=document.createRange(); range.selectNodeContents(box); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }   // select-all on open, like inp.select() — keyboard-triggered opens with no hint at all, or caretRangeFromPoint missing/out of bounds
  /* Task A — LOCAL only, until commit: this used to write obj[key]=text and preserveScroll(renderDoc) — a FULL
     #doc rebuild — on every single keystroke, which is exactly what made typing an MGloss in the diagram also
     retype the grid cell underneath it in real time (and, since preserveScroll(renderDoc) touches the WHOLE
     document, made every keystroke here as expensive as a full re-render). The abbreviation-run re-splitting
     ("dynamically as the user types") still has to happen live — that's what the small-caps styling IS — but
     it's a purely LOCAL rebuild of this box's own child nodes, not a model write or a cross-pane re-render.
     obj[key] is now only ever written in finish() (commit: blur/Enter/Tab/nav), same as makeEditable's own
     reflow — see that function's matching note. relocate() is dropped too: it existed to re-find `el` after a
     renderDoc rebuilt it out from under the field, which no longer happens mid-edit. */
  const reflow=()=>{ const text=box.textContent, off=caretOffset(box); render(text); setCaretOffset(box,off); place(); };
  const finish=save=>{ if(box._closed)return; box._closed=true; const v=box.textContent.trim(), changed=save&&v!==orig;
    obj[key]=changed?v:orig;
    if(changed){ UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); markDirty(); }
    document.removeEventListener("scroll",place,{capture:true}); box.remove(); preserveScroll(renderDoc); if(after)after(changed); };
  /* Task C — MGloss abbreviation autocomplete. Typing a capital letter or a digit 1-4 (every Leipzig
     abbreviation is uppercase; 1-4 are how Person is abbreviated — FEATS_GLOSS's own "Person=1":"1" etc., see
     bridge.js) opens the shared floating dropdown (acEl/acShowGrouped, js/grid/grid.js — the SAME popup the
     grid's Deep/DepRel cells use, in its grouped-headings mode) listing every abbreviation in MGLOSS_AC_ITEMS
     (js/io/bridge.js, built from GLOSS_FEATS — the one source of truth for what an abbreviation MEANS, never a
     second hand-written table) that starts with the run of characters just typed, sectioned under a heading per
     grammatical category (mglossAcGroups, bridge.js — Case/Number/Gender/… per MGLOSS_FEAT_ORDER, "Word class"
     for the AUX/DET prefixes). Accepting a row inserts it via mglossAcAccept
     (bridge.js), which drops the partial run and re-inserts the CHOSEN abbreviation through
     insertGlossAbbrevAtRank — its canonical slot per MGLOSS_FEAT_ORDER — rather than leaving raw typed text at
     the caret. Gated on `mglossTok`: editTier only passes a token for the "mgloss" tier (a lexical Gloss
     definition isn't built from Leipzig abbreviations, so it never opens this). Still purely LOCAL, same as
     ordinary typing (Task A) — no model write, no cross-pane render, until this field commits. */
  const mglossOpenAC=()=>{ if(!mglossTok) return;
    const off=caretOffset(box), text=box.textContent, partial=(/[^.\-]*$/.exec(text.slice(0,off))||[""])[0];
    if(!partial){ if(_acInput===box) acCloseSoon(); return; }
    const ms=MGLOSS_AC_ITEMS.filter(x=>x.ab.startsWith(partial));
    if(!ms.length){ if(_acInput===box) acCloseSoon(); return; }
    acShowGrouped(box, mglossAcGroups(ms), ab=>{   // grouped by grammatical category (bridge.js's mglossAcGroups) — same categories/order as the grid pill editor's own MGloss dropdown
      const at=caretOffset(box), r=mglossAcAccept(box.textContent,at,ab,mglossTok.upos);
      render(r.mg); setCaretOffset(box,r.caret); place(); },
      ab=>{ const it=ms.find(x=>x.ab===ab); return it?it.expand:""; }); };
  box.addEventListener("input",e=>{ if(e.isComposing) return; reflow();
    if(e.inputType==="insertText" && e.data && /^[A-Z1-4]$/.test(e.data)) mglossOpenAC();
    /* ⚠ A DELETION RE-FILTERS THE DROPDOWN; IT DOES NOT DISMISS IT. Backspace is how a reader
       corrects a mistyped abbreviation — "GNE" back to "GN" — and closing the list on the very
       keystroke that narrows the typo made the feature unusable for exactly the case it is for:
       the list vanished and only re-appeared once another capital was typed, by which time the
       reader has finished guessing. Re-opening rather than merely leaving it alone, because the
       run under the caret has changed and the offered set must change with it; mglossOpenAC
       closes it itself when the run empties or nothing matches, which is the only dismissal a
       deletion should ever cause. Gated on the menu being open ON THIS FIELD — backspacing in a
       field with no dropdown is not a request for one. */
    else if(_acInput===box){ if(/^delete/i.test(e.inputType||"")) mglossOpenAC(); else acCloseSoon(); } });   // defer the abbreviation-run rebuild until any dead-key/IME composition finishes — rebuilding mid-composition (innerHTML wipe + a manually-reset caret) would cancel the OS composition before it completes
  box.addEventListener("compositionend",reflow);   // now that the composed character has landed, apply the deferred rebuild
  box.addEventListener("keydown",ev=>{
    if(mglossTok && _acMenu && _acMenu.classList.contains("show") && _acInput===box){   // Task C: dropdown open on THIS field → its own ↑/↓/Enter/Tab/Esc, exactly like the grid's Deep/DepRel cells (js/grid/grid.js) — takes priority over the tier-nav/Enter/Escape handling below
      if(ev.key==="ArrowDown"){ ev.preventDefault(); ev.stopPropagation(); acHi((_acIdx+1)%_acItems.length); return; }
      if(ev.key==="ArrowUp"){ ev.preventDefault(); ev.stopPropagation(); acHi((_acIdx-1+_acItems.length)%_acItems.length); return; }
      if((ev.key==="Enter"||ev.key==="Tab")&&_acIdx>=0){ ev.preventDefault(); ev.stopPropagation(); acFill(_acItems[_acIdx]); return; }
      if(ev.key==="Escape"){ ev.preventDefault(); ev.stopPropagation(); acClose(); return; } }
    if(ev.key==="Enter"){ ev.preventDefault(); ev.stopPropagation(); finish(true); return; }   // item 15: MUST stopPropagation — without it this bubbles to columns.js's document-level "Enter on a selected token → editNodeInline" shortcut, which by the time it runs sees box already removed (finish() → box.remove(), synchronous) and no field focused, so it fires anyway and pops the (unrelated) token FORM editor over the token this box just committed
    if(ev.key==="Escape"){ ev.preventDefault(); ev.stopPropagation(); finish(false); return; }   // same leak, same fix — belt and braces alongside Enter's
    if(nav){ const collapsed=window.getSelection().isCollapsed, off=caretOffset(box);
      const atStart=collapsed&&off===0, atEnd=collapsed&&off===box.textContent.length;
      let d=null;   // arrow-triggered nav carries a caret hint (Tab intentionally doesn't — it still selects all on arrival, unchanged)
      if(ev.key==="Tab") d={tok:ev.shiftKey?-1:1};
      else if(ev.shiftKey){ /* item 15: Shift+Arrow is ALWAYS a text-selection gesture here, never token/tier navigation — leave `d` unset so it falls through, unhandled, to the character-selection block below (which does know how to extend a selection). Before this guard, Shift+ArrowUp/Down/Left/Right at a tier/field boundary was indistinguishable from a bare arrow press and jumped a tier or a token instead of ever starting a selection */ }
      else if(ev.key==="ArrowUp") d={tier:-1, caret:off};   // vertical: preserve the column (character offset), like a text editor
      else if(ev.key==="ArrowDown") d={tier:1, caret:off};
      else if(ev.key==="ArrowRight"&&atEnd) d={tok:1, caret:"start"};   // horizontal: land at the near edge of the field you're entering
      else if(ev.key==="ArrowLeft"&&atStart) d={tok:-1, caret:"end"};
      if(d){ ev.preventDefault(); ev.stopPropagation(); finish(true); nav(d); return; } }
    if((ev.key==="ArrowLeft"||ev.key==="ArrowRight")&&!ev.altKey&&!ev.metaKey&&!ev.ctrlKey){
      // a WITHIN-field step (not caught by the atStart/atEnd cross-token nav above): move by exactly one
      // character via the flat textContent instead of letting the browser's native caret movement handle it.
      // WebKit/Chromium can insert an extra "phantom" stop at a text-node/<span class="glabbr"> boundary — the
      // SAME underlying multi-run quirk the copy-event fix (above, document-level) works around for clipboard
      // serialization — so a plain arrow key can require two presses to cross one real character there.
      // Task D — every return below MUST stopPropagation() too, not just preventDefault(): preventDefault only
      // cancels the browser's OWN caret-move default, it does nothing to stop the keydown BUBBLING UP past this
      // field to the document-level ←/→ token-navigation handler (js/grid/columns.js) — which doesn't check
      // isContentEditable (only INPUT/SELECT/TEXTAREA), so an arrow key typed here used to ALSO move the token
      // selection underneath the very field it was moving the caret in. This was the one arrow-key path in this
      // box that didn't already end in the shared ev.stopPropagation() at the bottom of the handler.
      const s=window.getSelection(); if(!s||!s.rangeCount){ ev.stopPropagation(); return; }
      const len=box.textContent.length, dir=ev.key==="ArrowRight"?1:-1;
      const focusOff=nodeOffsetToCharOffset(box,s.focusNode,s.focusOffset);
      // item 15: this used to check s.isCollapsed ALONE — true on the very FIRST Shift+Arrow press too (nothing is
      // selected yet), so it collapsed-moved the caret instead of starting a selection and Shift+Arrow silently
      // never selected anything. anchorOff, computed either way, is exactly focusOff when collapsed (anchor===focus
      // with nothing selected), so it's always safe to read up front and only the BRANCH taken needs to change.
      if(s.isCollapsed&&!ev.shiftKey){ ev.preventDefault(); ev.stopPropagation(); setCaretOffset(box,Math.max(0,Math.min(len,focusOff+dir))); return; }
      const anchorOff=nodeOffsetToCharOffset(box,s.anchorNode,s.anchorOffset);
      if(ev.shiftKey){ ev.preventDefault(); ev.stopPropagation(); setCaretRange(box,anchorOff,Math.max(0,Math.min(len,focusOff+dir))); return; }   // extend the FOCUS edge only, anchor stays put — matches native shift+arrow (also handles the very first press, since anchorOff===focusOff then)
      ev.preventDefault(); ev.stopPropagation(); setCaretOffset(box,dir>0?Math.max(anchorOff,focusOff):Math.min(anchorOff,focusOff)); return; }   // plain arrow with an active selection → collapse to its near edge, matching native behaviour
    ev.stopPropagation(); });
  box.addEventListener("blur",()=>{ if(_acInput===box) acClose(); finish(true); }); }   // Task C: leaving the field drops any open abbreviation dropdown too (a menu row's own mousedown preventDefault keeps focus on box while picking, so this only fires on a genuine blur elsewhere)
const FORM_SEL=".tok-word,.baseword,.node-lbl,.bwform,.oform";   // the surface-form text element within a token, across the notations
// the token's rendered group, across every notation. NOT a single combined selector — the wrapped stemma/
// hierarchy view (projWrapped) renders TWO elements carrying the SAME data-s/data-tok for one token: the
// pinned tree's <g class="node"> (wpDraw — a bare hit-circle, no form/tier content at all) and the scrollable
// token strip's <g class="tok-group"> (the one with the actual form/POS/gloss content). A single querySelector
// with both selectors comma-joined returns whichever comes FIRST IN DOM ORDER — the tree group, since .wp-stem
// is appended before .wp-toks — regardless of which one actually has the content callers want, so every caller
// that used to run that combined query got the tree's empty node for wrapped stemma/hierarchy (an inline-edit
// field positioned at that tiny hit-circle instead of the clicked token: "wildly displaced"). Try the
// content-bearing selectors first; only fall back to a bare .node when nothing else matched (the UNWRAPPED
// stemma, whose .node genuinely IS the token's only rendered group, with a real .node-lbl/.node-cat child).
function tokGroupOf(si,tokId){
  return document.querySelector(`#doc .tok-group[data-s="${si}"][data-tok="${tokId}"], #doc .oline[data-s="${si}"][data-tok="${tokId}"], #doc .bwtok[data-s="${si}"][data-tok="${tokId}"]`)
    || document.querySelector(`#doc .node[data-s="${si}"][data-tok="${tokId}"]`); }
/* item 6 — SCROLL A TOKEN'S DRAWN CELL INTO VIEW, the diagram's half of the same correction the grid got.
   pick() already reveals the token's GRID ROW (scrollNearest, vertical only, from js/core/document.js);
   nothing revealed the token in the DIAGRAM, and a `.diagram` is `overflow:auto` capped at --cap-dia, so
   an unwrapped stemma/tree/arcs wider or taller than its port left keyboard navigation walking the
   selection clean off the visible edge — measured: 12 × ArrowRight put the selected token's left edge at
   x=989 in a port ending at x=785, with scrollLeft still 0. revealEl (js/grid/grid.js) carries BOTH axes.
   Called from the keyboard paths only (js/grid/columns.js's arrow/Tab navigation and tierNav below), never
   from pick() itself: a click path already has the token under the pointer, and scrolling the diagram out
   from under a click would move the very thing that was just aimed at.
   RUN IT AFTER pick(), never before. Both walk the outer .doc, so in a block tall enough that its diagram
   and its grid can't be on screen together the second call decides what you end up looking at — and on a
   keystroke that moved the selection in the DIAGRAM, that should be the diagram's cell. In every ordinary
   block both are visible already and neither call moves anything.
   THE WRAPPED PROJECTION IS DELIBERATELY EXCLUDED. Its token strip (.wp-toks) is `scroll-snap-type:y
   mandatory` and wpRevealSel already scrolls it — to an exact row multiple, which is what the snap
   expects. A second, minimal nudge from scrollNearest would land it between snap positions and leave the
   browser to re-snap on top of us. One owner per scroller. */
function revealTok(si,tokId){ if(si<0||tokId<=0||typeof revealEl!=="function") return;
  /* THE GRID ROW TOO, and FIRST. Navigating with no field open goes through pick(), which reveals the grid row
     (scrollNearest) — so with a field open the grid used to sit still while the diagram scrolled, and the two
     halves of the block disagreed about which token was being edited. The grid's own horizontal scroller is
     corrected by this call and nothing else corrects it.
     ORDER: grid first, diagram second, for the reason the note above gives — both walk the outer .doc, and the
     LAST call decides what a too-tall block ends up showing, which on a diagram keystroke must be the diagram.
     Not gated on a field being open: with no field open this is what pick() has already done, so it is a no-op. */
  const row=document.querySelector(`#doc tr[data-s="${si}"][data-tok="${tokId}"]`);
  if(row) revealEl(row);
  const el=tokGroupOf(si,tokId); if(!el||el.closest(".wrapproj")) return;
  revealEl(el); }
// FORM editing always targets the BASELINE projection row (tokGroupOf already prefers it) — a tree NODE is
// select-only, never an edit target, even in unwrapped stemma/hierarchy with proj on where both exist for the
// same token.
function formElOf(si,tokId){
  const gw=document.querySelector(`#doc [data-s="${si}"][data-gwtok="${tokId}"]`);
  if(gw) return gw;   // a goeswith CONTINUATION has no token group of its own (the display fold removed it), but it does have its own form field, drawn inside the head's cell and tagged data-gwtok. Resolving it here is what makes both halves of one word separately editable in EVERY notation at once — by click, by the "Edit token" menu, and by the Tab/arrow tier navigation — while the shared rows around it stay bound to the head, whose group data-tok is the one tokGroupOf finds
  const node=tokGroupOf(si,tokId);
  return node ? (node.matches(FORM_SEL)?node:(node.querySelector(FORM_SEL)||node)) : null; }
function editNodeInline(si,tokId,clickXY){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return;
  if(iastFormEdit() && transElOf(si,tokId)){ editTransInline(si,tokId,clickXY); return; }   // Item 10: the script glyph is display-only — route form editing onto the IAST transliteration row (which is bound to the token form). Only when that row is actually present; otherwise fall through to the plain form editor below.
  const el=formElOf(si,tokId);
  if(!el){ const c=document.querySelector(`[data-si="${si}"][data-ti="${tokId-1}"][data-col="form"]`); if(c)c.focus(); return; }   // no visible node → fall back to the grid cell
  makeEditable(el, s.tokens[tokId-1], "form", changed=>afterDiagramFormEdit(si,tokId,changed), sentRTL(s), ()=>formElOf(si,tokId), d=>tierNav(si,tokId,"form",d), false, clickXY); }   // item 4: the form row joins the gloss-tier arrow/Tab navigation. afterDiagramFormEdit = pick + the ITRANS→IAST pass + afterFormEdit, shared with the IAST-row route above
// ── inline-editing a multi-word token's surface form on a diagram ───────────────────────────────────────────
// Reached by a plain left-click on a drawn tie row (the delegated handler above) or by the tie's right-click
// menu. `fromId` is always the ORIGINAL token id, which is what data-mwtfrom carries even in a display-folded
// view (see mwtTie's m._from note), so the lookup is unambiguous.
// Select an MWT's component token range and return the MWT record — precisely what mwtTie's own (now removed)
// click listener used to do. It lives here, called by editMWTInline itself, so EVERY route in selects the same
// way: a click on the tie glyph, a click on the IAST row, and the right-click menu alike.
function selectMWTRange(si,fromId){ const s=DOC[si]; if(!s)return null; const m=(s.mwt||[]).find(x=>x.from===fromId); if(!m)return null;
  setRange(si,m.from,m.to); pick(si,m.from,false,false);
  // …and bring the MWT's own row to the TOP of the grid. pick() is called with scroll=false on purpose (its
  // scroll targets the token row, which for an MWT is the first COMPONENT — one row below the range row that was
  // just clicked, and the one row of the group that isn't the thing selected), so the reveal is done here against
  // the range row itself, and to the top rather than merely into view: the group's component rows follow it
  // immediately below, and they are part of what selecting an MWT is asking to look at.
  const row=document.querySelector(`#doc tr.mwt-row[data-s="${si}"][data-mwtfrom="${fromId}"]`);
  if(row&&typeof scrollRowToGridTop==="function") scrollRowToGridTop(row);
  return m; }
// The element the MWT's surface form is edited OVER. Under iastFormEdit() that is the IAST ROW beneath the tie,
// not the tie's own glyph, which is only a display rendering derived from that IAST — the same routing
// editNodeInline applies to single tokens, and guarded the same way: only when the row is actually on screen
// (the IAST row can be switched off), otherwise fall back to the glyph so the form stays reachable at all.
function mwtElOf(si,fromId){ const q=k=>document.querySelector(`#doc .${k}[data-s="${si}"][data-mwtfrom="${fromId}"]`);
  return (iastFormEdit()&&q("mwt-tr-edit")) || q("mwt-form"); }
// After a committed Sanskrit MWT form edit. WHICH FIELD THE EDIT WRITES: `m.form` — the STORED surface form, the
// only one of the three that round-trips to the file (io_conllu writes it as the MWT range's FORM column) and the
// one sandhiMwtForms itself rewrites. `m.miast` (the sandhi-fused IAST the row renders) and `m.ortho` (the script
// glyph) are display CACHES that fillOrtho re-derives from the COMPONENT tokens, never from m.form, so an edit
// written there would simply be recomputed away and never reach the file. Committing therefore drops both caches:
// clearing m.miast makes trTxt fall straight through to m.form, so the row shows exactly what was stored, and
// re-deriving m.ortho from the new IAST (the same form→script conversion fillOrtho runs for single tokens) makes
// the glyph above follow the edit. With no bridge both simply stay cleared and fillOrtho re-derives them later.
async function afterMWTFormEdit(si,m,changed){ if(!changed) return;   // makeEditable already pushed the undo snapshot and marked the document dirty
  m.miast=""; m.ortho="";
  if(hasBridge()&&DOCLANG&&orthoScript()&&m.form){ let r; try{ r=await window.pywebview.api.orthography([m.form],DOCLANG,ORTHO_SCHEME); }catch(e){ r=null; }
    const v=r&&r.ortho&&r.ortho[0]; if(v) m.ortho=v; }
  preserveScroll(renderDoc); }
function editMWTInline(si,fromId,clickXY){
  MWT_EDIT={si,from:fromId};   // item 8: names the tie whose editor is open, cleared in `done` below. It no longer SUPPRESSES the tie's accent — see the note above mwtTieSelected (js/diagram/diagram-core.js) for why that exception went: the field taking accent ink from the element under it is what every other token's field already does, and holding this one tie plain made an MWT go grey at the very moment it was selected. Still set BEFORE selectMWTRange, which is the call that selects the component range (and, in brackets, re-renders the block on the spot).
  const m=selectMWTRange(si,fromId); if(!m){ MWT_EDIT=null; return; } const s=DOC[si];   // the selection must happen BEFORE the element is resolved: in brackets, pick() re-renders the whole block unconditionally (see its conv==="brackets" branch), so an element resolved first would already be detached by the time makeEditable measured it. It also lives HERE, not in the click handler, so the right-click "Edit surface form" selects identically.
  const iast=iastFormEdit();
  if(iast) m.miast="";   // the row RENDERS m.miast in preference to m.form (trTxt), so leaving the cache in place would freeze the row on the stale fused value while the field grew under the typing; dropping it now makes the live reflow track every keystroke, and afterMWTFormEdit keeps it dropped on commit
  const el=mwtElOf(si,fromId); if(!el){ MWT_EDIT=null; return; }
  const done=async changed=>{ MWT_EDIT=null; applySel();   // applySel still runs here: the tie is accented throughout the edit now, but `done` is also where the range may have moved (a re-tokenised MWT), and the live class toggle is what keeps every carrier of that accent — tie, form, transliteration row, component cells, grid rows — in step with it
    // item 1: an MWT's stored surface form is a Form field like any other — ITRANS in, IAST stored. Here
    // rather than inside afterMWTFormEdit so it also covers a Sanskrit document with NO script selected,
    // where the tie's own glyph is edited and that call never runs; and BEFORE it, since it re-derives the
    // script glyph (m.ortho) from exactly this string.
    if(changed){ const v0=m.form||"", v=await itransFix(v0);
      if(v!==v0 && m.form===v0){ m.form=v; markDirty(); preserveScroll(renderDoc); } }
    if(iast) afterMWTFormEdit(si,m,changed); };
  makeEditable(el, m, "form", done, sentRTL(s), ()=>mwtElOf(si,fromId), null, false, clickXY); }
// inline-edit a token's correct form (item 6's diagram companion) on a click → writes MISC CorrectForm directly.
// `.cform` only exists in the DOM when correctFormShown() says so, which — for the DURATION of this edit — is
// pinned true by CFORM_EDIT even if the field is emptied mid-typing, so relocate() always has a real, positioned
// node to re-anchor the floating input over (see correctFormShown's own comment for why that matters).
function correctFormElOf(si,tokId){ return document.querySelector(`#doc .cform[data-s="${si}"][data-tok="${tokId}"]`); }
function editCorrectFormInline(si,tokId,clickXY){ const s=DOC[si]; const t=s&&s.tokens[tokId-1]; if(!t)return;
  const el=correctFormElOf(si,tokId); if(!el)return;
  CFORM_EDIT={si,tokId};
  const proxy={get correctForm(){ return miscKV(t.misc,"CorrectForm")||""; }, set correctForm(v){ t.misc=setMiscKV(t.misc,"CorrectForm",v); }};   // live-writes MISC CorrectForm on every keystroke, same as the FEATS/MISC pill editor's serialize()
  makeEditable(el, proxy, "correctForm", ()=>{ CFORM_EDIT=null; preserveScroll(renderDoc); }, sentRTL(s), ()=>correctFormElOf(si,tokId), null, true, clickXY); }   // allowEmpty:true — clearing the field removes CorrectForm outright, matching the "leave blank for none" convention askCorrectForms already uses
/* ── item 4: the LEMMA editor, opened by double-clicking a token in a diagram ─────────────────────
   WHY textPrompt AND NOT makeEditable's .nodeedit: an inline editor is a field laid OVER the element
   that draws the value, with that element hidden underneath for the duration — the form, the
   transliteration row, a gloss tier. The lemma is drawn in no notation at all, so there is nothing to
   lay it over and nothing to hide; anchoring it to the form instead would mean a field that displays
   one thing while editing another, and would have to fight the form editor for the same pixels (a
   single click already opens that one there — see the double-tap route in js/diagram/diagram-edit.js).
   textPrompt is the shape this app already uses to ask for a value ABOUT a token that isn't on screen
   — the correct-form prompt — and its title names the token, which an unanchored field must.
   The commit is the standard editor contract: pushUndo() before mutating, markDirty() after, and
   afterLemmaEdit(si,tokId) so MISC LTranslit and the morpheme segmentation are refreshed from the new
   lemma. ITRANS→IAST comes free — textPrompt converts every value it commits (see its own note). */
function editLemmaPrompt(si,tokId,clickXY,anchor){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t)return;
  const grp=tokGroupOf(si,tokId)||document.querySelector(`#doc tr[data-s="${si}"][data-tok="${tokId}"]`);
  /* ANCHOR UNDER THE FORM, NOT UNDER THE TOKEN GROUP. A group's box encloses the whole annotation stack —
     transliteration, both gloss tiers, the POS tag — so its `bottom` put the lemma box a stack's height below the
     word it is asking about, with the token's own annotation stranded between the two. The form is the thing the
     lemma belongs to, so the box hangs off the form's own bottom edge and the stack simply sits behind it.
     The FORM ELEMENT is whichever of the notations drew it (SVG text in the stemma/arc/tree renderers, an inline
     span in the brackets and the outline); the group is kept as the fallback for a grid row, which has no
     separate form ink to measure, and the click point as the fallback for neither. */
  const el=anchor || (grp&&grp.querySelector&&grp.querySelector(".tok-word, .node-lbl, .baseword, .bwform, .oform")) || grp;   // an explicit anchor (the row the double-click came from) wins over the form row
  /* A DEGENERATE RECT MEANS THE ANCHOR IS NOT LAID OUT, and must not be used: an element that is detached, in a
     `display:none` subtree, or in a notation whose host was rebuilt under the double-click reports 0×0 at 0,0,
     and the box then opens in the very top-left corner of the window instead of under the word. Fall through to
     the click point, which is where the gesture actually happened and is always a real coordinate. */
  let b=el?el.getBoundingClientRect():null, rtl=sentRTL(s);
  if(b && b.width===0 && b.height===0) b=null;
  const x=b?(rtl?b.right:b.left):(clickXY?clickXY.x:innerWidth/2-140);
  const y=b?b.bottom+6:(clickXY?clickXY.y+6:innerHeight/2-60);
  const cur=(t.lemma&&t.lemma!=="_")?t.lemma:"";
  textPrompt(x,y,{rtl, title:`Lemma of “${bform(t)}”`, value:cur,
    hint:"Leave blank for none.",   // an empty lemma is "_" in CoNLL-U, not a blank column — see the commit below
    ok:v=>{ const next=v||"_"; if(next===(t.lemma||"_")) return;   // unchanged (including blank↔"_") ⇒ no undo step, no dirty flag, no refresh
      pushUndo(si); t.lemma=next; markDirty(); preserveScroll(renderDoc);
      if(typeof afterLemmaEdit==="function") afterLemmaEdit(si,tokId); }}); }   // guarded: afterLemmaEdit lives in js/io/bridge.js, which loads AFTER this module
// selection-driven wrapper for the Edit-menu "Edit Lemma…" item / its ⌘L key-equivalent — same "no anchor,
// no click point" call editLemmaPrompt already falls back to gracefully (centred popover), matching how
// convertTokenMWT below drives openConvertMWT from the menu with neither
window.editLemmaShortcut=()=>{ if(sel.s>=0&&sel.t>0)editLemmaPrompt(sel.s,sel.t); };
// shared block-control definitions [iconKey, label, shortcut, action, danger] — used by both the per-block buttons and the block context menu
function SCTRL(i){ return [
  // grouped thematically (Jupyter cell-toolbar order): insertion, movement, duplication, annotation/parse, output, deletion last
  ["insbefore","Insert sentence before","⌥⌘↑",()=>insertAt(i)],   // same as Insert Token Above — active when a block is selected without a token
  ["insafter","Insert sentence after","⌥⌘↓",()=>insertAt(i+1)],
  ["moveup","Move up","⌃⌘↑",()=>moveSent(i,i-1)],   // same as Move Token Up — active when a block is selected without a token
  ["movedown","Move down","⌃⌘↓",()=>moveSent(i,i+2)],
  ["newdoc","Document boundary","⇧⌘D",()=>toggleBound(i,"newdoc")],   // replaced Duplicate (⌘D), which is gone: a treebank is edited by inserting and re-parsing, not by cloning a sentence with its whole annotation and a "-copy" id
  ["newpar","Paragraph boundary","⇧⌘P",()=>toggleBound(i,"newpar")],   // both TOGGLE — the same gesture removes the boundary it added, which is why the pair sits in the block controls rather than only in the menu
  ["url","Sentence URL","⌘U",()=>editURL(i)],   // item 14: a link icon → set/edit a source URL for the sentence (blue when set)
  ["reenter","Reset parse","⌘R",()=>reparse(i)],
  ["export","Export diagram as SVG","⌥⌘E",()=>exportSVG(i)],
  ["delete","Delete sentence","⌘⌫",()=>delSent(i),true],
]; }
function sentMenu(x,y,i){ const by={}; SCTRL(i).forEach(e=>by[e[0]]=e); const mk=e=>[e[1],e[2],e[3],e[4]];
  /* `by.duplicate` USED TO BE HERE AND IS GONE. SCTRL's Duplicate entry was replaced by "Document boundary" (see
     its own comment: "replaced Duplicate (⌘D), which is gone"), but this line kept dereferencing it — and mk()
     reads e[1] off whatever it is handed, so `mk(undefined)` threw a TypeError out of sentMenu. The whole
     SENTENCE CONTEXT MENU therefore never opened at all: right-clicking bare block background did nothing,
     silently, because the throw happened inside the contextmenu listener. Nothing else references by.duplicate.
     mk() is left as-is rather than made undefined-tolerant: a missing key is a bug in this list, and a tolerant
     mk would have hidden this one instead of announcing it. */
  const items=[mk(by.insbefore),mk(by.insafter),null,mk(by.url),mk(by.reenter)];
  items.push(null,mk(by.moveup),mk(by.movedown),mk(by.export));
  // item 2: the document/paragraph boundaries this sentence STARTS. Checkable, because each is a toggle and the
  // checkmark is the only thing in the menu that says whether the sentence already carries one.
  const bs=DOC[i]||null;
  items.push(null,
    {label:"Document boundary", kbd:"⇧⌘D", check:hasNewdoc(bs), fn:()=>toggleBound(i,"newdoc")},
    {label:"Paragraph boundary", kbd:"⇧⌘P", check:hasNewpar(bs), fn:()=>toggleBound(i,"newpar")});
  /* A shift-selected RANGE that covers this block retitles the two commands that act on the range and adds the
     one that only exists for it. The count goes in the label rather than being left to the painted wash: the
     wash says WHICH sentences, and a number is what makes an accidental extension obvious before ⌘⌫ takes six.
     Both rows delegate to the bridge-level commands (js/io/bridge.js) rather than calling delSents/mergeSentRange
     directly, so the confirmation the keyboard path raises is the same one the menu path raises. */
  const rng=(typeof blockRange==="function")?blockRange():null;
  const nsel=(rng&&i>=rng.lo&&i<=rng.hi)?rng.hi-rng.lo+1:0;
  if(nsel>1) items.push(null,["Merge "+nsel+" sentences","⌥⌘M",()=>window.mergeSents&&window.mergeSents()]);
  items.push(null, nsel>1
    ? ["Delete "+nsel+" sentences","⌘⌫",()=>window.deleteSent&&window.deleteSent(),true]
    : mk(by.delete));
  showCtx(x,y,items); }
// items 14/5: set/edit/clear a sentence's source URL via a LOCAL popover anchored to the link icon → the
// `# url = …` comment (round-trips via io_conllu). Enter commits, Esc cancels; blank clears; icon blue when set.
let _urlPop=null;
function closeURLPopup(){ if(_urlPop){ _urlPop.remove(); _urlPop=null; } }
function editURL(i,anchor){ const s=DOC[i]; if(!s)return; closeURLPopup();
  anchor=anchor||document.querySelector(`.sblock[data-i="${i}"] .url-ctl`);
  const pop=document.createElement("div"); pop.className="urlpop"; _urlPop=pop;
  const inp=document.createElement("input"); inp.type="url"; inp.className="urlpop-in"; inp.value=s.url||"";
  inp.placeholder="https://…"; inp.spellcheck=false; inp.title="Enter to save · Esc to cancel · blank to clear"; inp.setAttribute("aria-label","Sentence URL");   // item 8(b): keep the placeholder minimal; the key hints live in the tooltip
  pop.appendChild(inp); document.body.appendChild(pop); pop.addEventListener("mousedown",e=>e.stopPropagation());
  const r=(anchor||document.body).getBoundingClientRect();
  pop.style.left=Math.max(8, Math.min(r.right-pop.offsetWidth, innerWidth-pop.offsetWidth-8))+"px";   // item 8(a): open to the LEFT — align the popover's right edge to the icon and grow leftward (clamped to 8px so it never clips the left window edge)
  pop.style.top=Math.max(menuTopBound(),Math.min((r.bottom||0)+5, innerHeight-pop.offsetHeight-8))+"px";
  inp.focus(); inp.select();
  const done=save=>{ if(pop._done)return; pop._done=true;
    if(save){ const nv=(inp.value||"").trim(); if(nv!==(s.url||"")){ pushUndo(i); s.url=nv; markDirty(); preserveScroll(renderDoc); toast(nv?"URL set":"URL cleared"); } }
    closeURLPopup(); };
  inp.addEventListener("keydown",e=>{ e.stopPropagation(); if(e.key==="Enter"){ e.preventDefault(); done(true); } else if(e.key==="Escape"){ e.preventDefault(); done(false); } });
  inp.addEventListener("blur",()=>done(true)); }
addEventListener("mousedown",e=>{ if(_urlPop && !_urlPop.contains(e.target)) closeURLPopup(); },true);   // click outside → the input blurs (commits) and the popover closes
window.editURL=editURL;
/* ══ EXPORT ONE BLOCK'S DIAGRAM AS A SELF-CONTAINED, ALWAYS-LIGHT-MODE SVG ═══════════════════════════
   Two requirements that turn out to be one: an exported file carries no stylesheet and no appearance, so
   every colour in it has to be resolved (a) to a literal and (b) to the LIGHT literal, whatever the app
   itself is currently wearing.

   WHY IT CANNOT SIMPLY BE READ OFF THE SCREEN. The app themes purely through
   @media (prefers-color-scheme:dark) — there is deliberately no data-theme attribute (js/ui/colours.js) —
   and prefers-color-scheme cannot be forced per element, per subtree or per same-document iframe. So there
   is no way to RENDER a light copy of the diagram while the OS is dark. What there IS a way to do is put
   the CASCADE into light mode for the duration of one synchronous read: svgxForceLight() re-declares, at
   the same selector and with !important, every CUSTOM PROPERTY that a dark @media block redeclares, using
   that property's light value; computed styles are read; the override is torn down. All of it happens
   inside ONE task, and a browser paints only between tasks, so nothing flashes on screen.
   !important is load-bearing twice over: it beats the dark @media rules (same origin, same specificity,
   later in source), and it beats the normal-priority inline custom properties js/ui/colours.js writes
   straight onto :root for the accent-derived palette.

   THE RELATION COLOURS ARE A SEPARATE PROBLEM, and the reason a token override alone is not enough:
   relColor() reads --c-* through css() at RENDER time and BAKES the resulting hex into the `stroke`/`fill`
   presentation attribute — on its own for a label, and inside arcInk()'s color-mix() for a stroke. Those
   literals are frozen dark ink that no later cascade change can reach, so svgxRelight() rewrites them,
   dark literal → light literal, both sides read from css() on either side of the override so the strings
   are guaranteed to be exactly the ones the renderer baked.

   THE CLONE IS THEN MEASURED IN CONTEXT: parked off-screen inside the same .sblock, so it keeps every
   ancestor that carries a custom property (.sblock.sel-block's tinted --occlude/--casing, #doc.no-relcolour's
   --tie-hue swap, #doc.zone-grid's dimmed accent) and every class rule still beats a presentation attribute
   exactly as it does on screen. Reading the CLONE rather than the live SVG is also what lets the rewritten
   relation literals flow through color-mix() for free, instead of being string-substituted after the fact.

   Theme-dependent tokens the diagram reaches, all covered by the sweep: --content-bg (→ --occlude,
   --block-occlude, --casing, and arcInk's own mix), --casing-lift, --text (→ --ink), --muted (→ --accent-dim),
   --dia-muted, --dotline, --accent, --warn, --block-sel, --c-subj/comp/mod/other/root/udep (→ --tie-hue) and
   .dim-out/.dim-peri's --dim-fade/--dim-fade-hue/--dim-fade-2 (→ --dim-text/-muted/-tie/-hue/-edge).
   --edge-mix is NOT one of them — one value for both appearances; see arcInk()'s note in diagram-core.js. */
const SVGX_PROPS=["fill","fill-opacity","stroke","stroke-opacity","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","opacity","paint-order","vector-effect","font-size","font-family","font-weight","font-style","font-feature-settings","text-anchor","dominant-baseline","letter-spacing"];   // font-feature-settings carries .tok-pos/.mwt-pos's "c2sc" small caps — without it every POS tag in an exported diagram silently loses them; vector-effect is .gw-tie-cas's non-scaling stroke; the *-opacity pair and stroke-dashoffset are here so the style attribute states each property unconditionally (see inlineStyles)
const SVGX_INK=["--c-subj","--c-comp","--c-mod","--c-other","--c-root","--c-udep","--ink"];   // every token relColor() can return — i.e. every colour a renderer BAKES into an attribute. Audited: all other css() reads in js/diagram/** are lengths (--arc-row/--arrow/--arc-stroke/--report-step/…), so this list is the complete set of frozen colour literals
// Flatten a resolved colour to a legacy sRGB literal. getComputedStyle has already substituted every var()
// and (in current engines) resolved color-mix(), but the result can be a modern colour function —
// color(srgb …), oklab(…) — that Illustrator and older SVG renderers don't parse. A canvas 2D fillStyle is a
// CSS-colour parser whose OUTPUT is always #rrggbb / rgba(), so one round-trip normalises anything.
let _svgxCv=null;
function svgxColour(v){ const s=(v||"").trim();
  if(!s||s.indexOf("(")<0||/^rgba?\(/i.test(s)) return v;   // a keyword, a #hex, `none`, or already legacy rgb()/rgba() → nothing to flatten
  if(!_svgxCv) _svgxCv=document.createElement("canvas").getContext("2d");
  _svgxCv.fillStyle="#000"; _svgxCv.fillStyle=s; const a=_svgxCv.fillStyle;
  _svgxCv.fillStyle="#fff"; _svgxCv.fillStyle=s; const b=_svgxCv.fillStyle;
  return a===b?a:v; }   // canvas SILENTLY IGNORES a value it cannot parse, leaving fillStyle at whatever it held — so probe from two different grounds and trust only an answer both agree on, rather than emitting a spurious black
/* Put the cascade into light mode. Returns the teardown. Scanned from the live CSSOM rather than hard-coded,
   so a token added to a dark block later needs no edit here. */
function svgxForceLight(){
  const isDark=t=>/prefers-color-scheme\s*:\s*dark/i.test(t||"");
  const base=new Map(), darkAt=new Map();   // "selector|--prop" → light value  /  selector → Set(--prop redeclared under dark)
  const walk=(rules,dark)=>{ for(let n=0;n<rules.length;n++){ const r=rules[n];
      if(r.cssRules){ walk(r.cssRules, dark||isDark(r.conditionText||(r.media&&r.media.mediaText)||"")); continue; }   // @media/@supports/@layer → recurse. A (prefers-color-scheme:light) block is treated as UNCONDITIONAL: for this export it is the active branch, so its declarations belong in `base`
      if(!r.style||!r.selectorText) continue;   // @font-face and a @keyframes step have .style but no selectorText
      for(let k=0;k<r.style.length;k++){ const p=r.style[k]; if(p.slice(0,2)!=="--") continue;   // CUSTOM PROPERTIES ONLY. Audited: no dark @media block in this app repaints a diagram element directly (mac-chrome.css's are titlebar chrome; app.css's are .stx-warn/.oselrow/the grid/.scrim), and restricting the override to tokens is also what guarantees it can move no geometry — nothing here holds a length
        if(dark){ let s=darkAt.get(r.selectorText); if(!s){ s=new Set(); darkAt.set(r.selectorText,s); } s.add(p); }
        else base.set(r.selectorText+"|"+p, r.style.getPropertyValue(p)); } } };   // last declaration wins, which is the cascade's own answer at equal specificity — and it is how a user's own colour override (the live #relColOverride <style>) beats the kit's defaults here too
  for(let s=0;s<document.styleSheets.length;s++){ try{ walk(document.styleSheets[s].cssRules,false); }catch(e){} }   // a cross-origin sheet throws on .cssRules; this app serves its own, so a throw only ever means "nothing to learn here"
  const root=document.documentElement; let out="";
  darkAt.forEach((props,sel)=>{ const decls=[];
    props.forEach(p=>{ if(sel===":root"&&root.style.getPropertyValue(p)) return;   // an INLINE value on :root is the LIVE system accent (arh_applyAccentVars, js/ui/colours.js) — theme-independent, and it has to survive into the export rather than snapping back to the stylesheet's #007aff. The --c-* triad is the one inline family that IS theme-dependent, and it is re-emitted explicitly below
      const v=base.get(sel+"|"+p);
      decls.push(p+":"+(v||"unset")+" !important"); });   // no light counterpart at all (--grid-head-fg is declared ONLY in the dark block) → `unset`. A custom property is inherited, so on the root that resolves to the guaranteed-invalid value — exactly "as if never declared", and each var() falls back the way it does in light
    if(decls.length) out+=sel+"{"+decls.join(";")+"}"; });
  if(typeof relColLight==="function"&&typeof relColMidLinear==="function"){   // the light relation palette AS THE USER WOULD SEE IT: relColLight() is the same chain the Colours drawer and deriveRelHuesFromAccent resolve through (explicit override → live accent-derived LIGHT triad → static default), so an accent-rotated document exports its own hues instead of snapping to RELCOL_DEFAULTS
    const L=c=>relColLight(c);
    out+=":root{"+["subj","comp","mod","other","root"].map(c=>"--c-"+c+":"+L(c)+" !important").join(";")
       +";--c-udep:"+relColMidLinear(L("comp"),L("mod"))+" !important}"; }   // udep is never user-overridable — the comp/mod LINEAR-sRGB midpoint, exactly as applyRelColours computes it
  const st=document.createElement("style"); st.id="svgxLight"; st.textContent=out; document.head.appendChild(st);
  return ()=>st.remove(); }
// Rewrite the render-time-baked relation literals in a cloned subtree: dark hex → light hex. Whole-string
// split/join on values css() itself produced, so there is no colour PARSING here and no near-miss matching.
function svgxRelight(root,map){ if(!map.length) return;
  const fix=v=>{ let s=v; for(let j=0;j<map.length;j++) if(s.indexOf(map[j][0])>=0) s=s.split(map[j][0]).join(map[j][1]); return s; };
  (function walk(el){ ["fill","stroke","style"].forEach(a=>{ const v=el.getAttribute(a); if(v==null) return; const nv=fix(v); if(nv!==v) el.setAttribute(a,nv); });
    for(let k=0;k<el.children.length;k++) walk(el.children[k]); })(root); }
/* Bake computed style onto the (attached, light-mode) clone, IN PLACE. */
function inlineStyles(el){ const cs=getComputedStyle(el), vals=[];
  SVGX_PROPS.forEach(p=>{ let v=cs.getPropertyValue(p); if(!v) return;   // an engine that doesn't know the property → leave whatever attribute is already there alone rather than deleting it below
    if(p==="fill"||p==="stroke") v=svgxColour(v); vals.push([p,v]); });
  el.setAttribute("style",vals.map(pv=>pv[0]+":"+pv[1]).join(";"));   // read EVERY value before writing anything — getComputedStyle returns a LIVE object, so writing mid-loop would be seen by the reads still to come on this same element
  vals.forEach(pv=>el.removeAttribute(pv[0]));   // …then DROP the presentation attribute the value came from. It still holds the render-time `color-mix(…, var(--content-bg) var(--edge-mix))` string, which resolves against nothing in a standalone file, and a viewer that prefers attributes to `style` (Illustrator) would paint from it. Safe only because the style attribute above states each property UNCONDITIONALLY — the old version skipped "normal"/"none" values to save bytes, which is exactly what made deleting the attribute impossible then
  for(let k=0;k<el.children.length;k++) inlineStyles(el.children[k]); }   // top-down is fine: each child is read before it is written, and its parent was written with the parent's OWN computed values, so every inherited property is unchanged
async function exportSVG(i){ const b=document.querySelector(`.sblock[data-i="${i}"]`), svg=b&&b.querySelector(".diagram svg.tree");
  if(!svg) return toast("Switch to a diagram view (stemma, hierarchy, arcs, brackets) to export SVG");
  const inkDark=SVGX_INK.map(css);   // the baked literals as the renderer wrote them — read BEFORE the override
  const restore=svgxForceLight();
  let src;
  try{
    const map=SVGX_INK.map((k,j)=>[inkDark[j],css(k)]).filter(p=>p[0]&&p[1]&&p[0]!==p[1]);   // …and the same tokens after it
    const clone=svg.cloneNode(true); svgxRelight(clone,map);
    const stage=document.createElement("div"); stage.setAttribute("aria-hidden","true");
    stage.style.cssText="position:absolute; left:-99999px; top:0; width:0; height:0; overflow:hidden; pointer-events:none";   // OUT OF FLOW inside the same .sblock: identical ancestor context (see the block comment), and the live layout cannot move. Negative left creates no scrollable overflow, and it is gone before the task ends anyway
    stage.appendChild(clone); b.appendChild(stage);
    try{
      inlineStyles(clone);
      /* AN EXPLICIT GROUND. The casings and occlusion blobs ARE the page background colour (--casing /
         --occlude / --block-occlude), so a transparent export reads as a scatter of pale shapes over
         whatever the viewer happens to sit on, and every occlusion the diagram depends on stops meaning
         anything. Painted from the LIGHT --content-bg at the viewBox's OWN origin — not 0,0, which
         fitTight has usually moved off. Inserted after inlineStyles so the walk never sees it. */
      const vb=(clone.getAttribute("viewBox")||"").trim().split(/[\s,]+/).map(Number);
      if(vb.length===4&&vb.every(v=>isFinite(v))) clone.insertBefore(E("rect",{x:vb[0],y:vb[1],width:vb[2],height:vb[3],fill:svgxColour(css("--content-bg"))}),clone.firstChild);
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      src='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
    } finally{ stage.remove(); }
  } finally{ restore(); }   // the override lives for this ONE synchronous stretch: no await before here, so the page never paints in the wrong appearance
  const stem=(DOC[i].sid||("s"+(i+1))).replace(/[^\w.-]/g,"_");
  if(!hasBridge()){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([src],{type:"image/svg+xml"})); a.download=stem+".svg"; a.click(); URL.revokeObjectURL(a.href); toast("Exported "+stem+".svg"); return; }
  const r=await sheetChooseSaveLocation({title:"Export Diagram",desc:"Choose a name and location for the SVG file.",defaultName:stem,saveLabel:"Export"});
  if(r.action!=="save") return;
  let filename=r.filename||stem; if(!filename.toLowerCase().endsWith(".svg")) filename+=".svg";
  let res; try{ res=await window.pywebview.api.save_svg_to(r.folder,filename,src); }catch(e){ return toast("Export failed: "+e); }
  res.error?toast("Export failed: "+res.error):toast("Exported "+res.name); }
/* THE GRID'S COLUMN CHOOSER — right-click any column heading (renderGrid binds it on the header row).
   Modelled on Finder's list-view header menu, which is a PLAIN CHECKLIST and nothing else: one row per column,
   a leading checkmark on the ones being shown, and the columns that can't be turned off drawn as disabled rows
   that still carry their tick. No headings, no separators, no "Show All" — Finder has none of those and the
   list is short enough not to want them.
   `fit` (the last argument) shrinks the menu to its widest row instead of the shared 224px floor: these labels
   are one short word each and the floor would leave most of the menu empty — the same call the status-bar
   Format menu makes, for the same reason.
   The checkmark shows the EFFECTIVE visibility, so a column the width rule has auto-hidden reads as unchecked —
   it is, after all, not on screen. Clicking it then pins it ON (toggleCol toggles that same effective state), which
   is what makes the menu's own display and its behaviour agree without the user having to know the rule exists.
   `si` names the sentence whose header was clicked: the column SET is document-wide, but which columns a document
   admits at all is not (ALLCOLS's transliteration gate is per-sentence), so the list is built for that sentence. */
function columnMenu(x,y,si){
  /* ID AND FORM ARE NOT LISTED AT ALL. They were shown as ticked-but-disabled rows, on the reasoning that a
     chooser should account for every column; but a row that cannot be changed is not a choice, and two inert
     rows at the top of a short menu are mostly what the reader has to look past to reach the ones that work.
     REQ_COL (js/grid/grid.js) stays the single definition of which those are — this filters by it rather than
     naming them again, so a change there reaches here for free. */
  const rows=ALLCOLS(si).map(c=>[c[0],c[3]]).filter(([k])=>!REQ_COL[k]);
  showCtx(x,y,rows.map(([k,H])=>({label:H, opt:true, check:colShown(k), fn:()=>toggleCol(k)})),
    false,undefined,true);
  ctx.classList.add("colmenu");   // styling hook: a smaller type size and a trailing padding that matches the checkmark gutter (see .ctx.colmenu in the kits). Added AFTER showCtx, which clears it on every open
}
function tokenMenu(x,y,si,idx,target){ const rng=(selRange&&selRange.s===si&&selRange.to>selRange.from&&idx+1>=selRange.from&&idx+1<=selRange.to)?selRange:null;
  pick(si,idx+1,false); const tokId=idx+1;
  const items=[
    ...moveItems(si,tokId,true),
    null, ...insertItems(si,tokId,true),
    null, ...headItems(si,tokId),
    null, ...mwtTokenItems(si,tokId),
    null, ...markFeatRow(si,tokId),
    null, ["Set as root","⌃⌘R",()=>setAsRoot(si,tokId)],
    // item 2: MISC NewPar=Yes — the paragraph that starts in the MIDDLE of a sentence, which is the one
    // document-structure fact the `# newpar` comment on the sentence cannot express. Token-scoped, so it belongs
    // here rather than in the block menu (whose own two boundary rows are the sentence-level pair).
    {label:"Paragraph starts here", kbd:"⌥⇧⌘P", check:isNewParTok((DOC[si]||{tokens:[]}).tokens[idx]), fn:()=>toggleTokNewPar(si,tokId)},
    null, ["Delete token","⌘⌫",()=>deleteToken(si,idx),true],
  ];
  const rdRow=(typeof readingsMenuItem==="function")?readingsMenuItem(si,tokId,()=>tokenMenu(x,y,si,idx,target)):null;   // the same CJK heteronym flyout the diagram node menu carries (js/lang/readings.js)
  if(rdRow){ items.unshift(null); items.unshift(rdRow); }
  if(rng && !rangeIsMWT(si,rng.from,rng.to)){ items.unshift(null);
    if(mergeIsSolid(s,rng.from,rng.to)) items.unshift([`Merge ${rng.from}–${rng.to} into one token`,"⌃⌘M",()=>mergeTokens(si,rng.from,rng.to)]);   // the same pair the diagram's node menu offers, in the same order — Group (keeps the tokens) above Merge (does not), and Merge only across a seam the line writes solid
    items.unshift([`Group ${rng.from}–${rng.to} as MWT`,"⌘G",()=>addMWT(si,rng.from,rng.to)]); }
  const gc=target&&target.closest("td.w-deprel, td.w-upos");   // right-clicked a DepRel/UPOS cell → offer its guidelines page
  if(gc){ const sc=gc.querySelector("select,input"), val=sc?sc.value:""; if(val&&val!=="_"){ const rel=gc.classList.contains("w-deprel");
    const url=rel?relGuideUrl(val):posGuideUrl(val);   // relGuideUrl can be null (e.g. unk) — no dedicated page, so omit the row
    if(url){ items.unshift(null); items.unshift([`Guidelines for “${esc(val)}” ${rel?"relation":"POS tag"}`,"↗",()=>openExternal(url)]); } } }
  showCtx(x,y,items); }
function addMWT(si,from,to){ const s=DOC[si]; pushUndo(si); s.mwt=(s.mwt||[]).filter(m=>!(m.from<=to&&m.to>=from));   // replace any overlapping range
  s.mwt.push({from,to,form:s.tokens.slice(from-1,to).map(t=>t.form).join("")}); s.mwt.sort((a,b)=>a.from-b.from);   // default surface = concatenation (editable in the range row)
  if(isSanskritLang()) sandhiMwtForms(si,[from]);   // item 8: Sanskrit → replace the naive concatenation with the sandhi-fused surface form
  selRange=null; preserveScroll(renderDoc); toast(`Multi-word token ${from}–${to} added — edit its surface form in the range row`); }
// ⌘G / ⇧⌘G: group the current token range into an MWT, or remove the MWT at the selection
function groupMWTShortcut(){ if(sel.s<0) return;
  if(selRange && selRange.s===sel.s && selRange.to>selRange.from){ addMWT(sel.s,selRange.from,selRange.to); }
  else toast("Select two or more tokens (shift-click their id cells) to group"); }
function ungroupMWTShortcut(){ const s=DOC[sel.s]; if(!s||!s.mwt||!s.mwt.length) return toast("No multi-word token to remove"); pushUndo(sel.s);
  const t=sel.t, cover=m=>selRange?(selRange.s===sel.s&&m.from<=selRange.to&&m.to>=selRange.from):(t>=m.from&&t<=m.to);
  const before=s.mwt.length; s.mwt=s.mwt.filter(m=>!cover(m));
  if(s.mwt.length<before){ preserveScroll(renderDoc); toast("Multi-word token removed"); } else toast("No multi-word token at the selection"); }

// ── convert a single token into a multi-word token (split into n component words) ────────────────
// the original token stays as the head component (keeps its POS/deprel/head/feats); the extra
// components are inserted after it as blank words hanging off it; the MWT's surface form = the
// original form. Flatten (below) is the exact inverse.
/* `parts`, when given, are the component FORMS — the split is already known and the components are born
   spelt rather than blank. That is the "=" path (see openConvertMWT): a form written `pra=kāśa` states its
   own division, so asking how many pieces it has and then leaving them empty asks twice for what the token
   already says. Without `parts` this is the count-prompt path exactly as before: n blank components. */
function convertTokenToMWT(si,idx,n,parts){ const s=DOC[si], toks=s.tokens; const head=toks[idx]; if(!head)return; pushUndo(si);
  const origForm=head.form;   // the MWT's surface form: what the text actually spells, "=" and all
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});   // heads by identity, so the coming splice renumbers cleanly
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to); });                                // existing MWT ranges by identity
  const comps=[]; for(let k=1;k<n;k++){ const c=tok(parts?(parts[k]||""):"","","X","","",0,"udep"); c._ht=head; comps.push(c); }
  if(parts) head.form=parts[0]||head.form;   // blank components attach to the head component
  toks.splice(idx+1,0,...comps);
  toks.forEach(t=>{ t.head=t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  remapMWT(s,toks);
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // the original token survives as the head component and the new ones are blank, so nothing is dropped — this only shifts the ids after it, and DEPS / empty-node anchors with them
  const from=idx+1, to=idx+n;
  /* SPLITTING A TOKEN THAT IS ALREADY A COMPONENT divides it INSIDE its range, rather than carving a new
     range out of the middle of one. The filter below drops every overlapping range, which is right when a
     free-standing token becomes a multi-word token and destructive when the token was already inside one —
     the orthographic word above it would simply vanish, taking its surface form with it.
     The host range only has to GROW: remapMWT above rebuilt it from its members' identities, so it already
     spans the new pieces wherever the token split was not its LAST member (the pieces land between two
     members, and from/to are the min and max). Where it was the last, they land past the end and `to` has
     to take them. Its FORM is deliberately untouched — the word still spells what it spelt; only the
     analysis underneath it has become finer. */
  const host=(s.mwt||[]).find(m=>from>=m.from&&from<=m.to);
  if(host){ if(host.to<to) host.to=to; }
  else { s.mwt=(s.mwt||[]).filter(m=>!(m.from<=to&&m.to>=from));   // drop any overlapping range
    s.mwt.push({from,to,form:origForm}); s.mwt.sort((a,b)=>a.from-b.from); }   // the range spells the ORIGINAL, not the head component
  /* …and the morpheme tiers divide with it, where they mark the SAME division. `=` is this app's clitic
     seam in MSeg (msegStrip strips ꞊/=/⹀), so a form and an MSeg that both carry it are describing one
     boundary and the pieces line up one-for-one. Only then — a tier that splits into a different number of
     pieces is describing something else, and slicing it on a count that does not match would scatter one
     morpheme's gloss across two tokens. It is left whole on the head instead, where it was. */
  if(parts){ const all=[head].concat(comps);
    // THE LEMMA DIVIDES TOO, on the same terms: a lemma written `pra=kāśa` states the same boundary the
    // form does, and leaving it whole on the head would give the first component the whole word's lemma
    // and the rest none. Guarded on the piece count exactly as the tiers are — a lemma that splits into
    // a different number is not describing this division, and stays where it was.
    const lem=(head.lemma&&head.lemma!=="_")?head.lemma:"";
    if(lem.indexOf("=")>=0){ const lb=lem.split("=");
      if(lb.length===all.length && lb.every(x=>x)) all.forEach((c,k)=>{ c.lemma=lb[k]; }); }
    ["MSeg","MGloss","Unsandhied"].forEach(key=>{ const v=miscKV(head.misc,key); if(!v) return;   // Unsandhied divides with the rest: it is a per-token pausa spelling, so a token that has become several needs one each
      /* A GLOSS NEED NOT CARRY THE "=" TO BE PLACED. Splitting `punarjanman-ām` as `punar=janman-ām`
         leaves the MGloss a single undivided `-GEN.PL.M` — and that leading hyphen already says where it
         belongs: it glosses a SUFFIX, so it goes to the component holding the end of the word, not to the
         head it happened to be stored on. A trailing mark says the opposite, prefix categories, so the
         FIRST component. Only for a gloss that is entirely abbreviations: a lexical gloss with no "=" is
         a gloss of the whole word and there is nothing in it to say which part it describes, so it stays
         where it was rather than being guessed at. */
      if(v.indexOf("=")<0){ if(key!=="MGloss"||!mglossAbbrOnly(v)) return;
        const last=all.length-1, to=/^[-.]/.test(v)?last:(/[-.]$/.test(v)?0:-1);
        if(to<=0) return;                                   // no mark, or already on the first component
        all[0].misc=setMiscKV(all[0].misc,key,""); all[to].misc=setMiscKV(all[to].misc,key,tierDashFix(v,key)); return; }
      const bits=v.split("="); if(bits.length!==all.length) return;
      /* AN ABBREVIATION-ONLY PIECE BELONGS TO THE MORPHEME ITS HYPHEN POINTS AT, not to the component it
         happens to sit opposite. `-LOC` is the categories of the word BEFORE it and `DEF-` those of the
         word after, so a positional hand-out would give one component a gloss that is entirely about its
         neighbour — and leave that neighbour's own gloss looking complete when it is not. The piece is
         moved onto the indicated side and its own slot left empty; the merge rule (mglossAbbrOnly in
         tierJoin) reads the same hyphens the other way round, so a split and a re-flatten agree.
         Only MGloss: MSeg holds segmented word text, where a capital is just a capital. */
      if(key==="MGloss"){ for(let k=0;k<bits.length;k++){ const bit=bits[k];
        if(!mglossAbbrOnly(bit)) continue;
        if(/^[-.]/.test(bit) && k>0){ bits[k-1]+=bit; bits[k]=""; }          // leads with its mark → attaches leftward
        else if(/[-.]$/.test(bit) && k<bits.length-1){ bits[k+1]=bit+bits[k+1]; bits[k]=""; } } }   // trails → attaches rightward
      // …and the two marks meeting COLLAPSE: the piece being moved carries the boundary it points across, and
      // the piece it lands on may already carry one (`janman-` taking `-GEN.PL.M` → `janman--GEN.PL.M`). One
      // boundary, written once — see tierDashFix, which also catches whatever reaches MISC by another route.
      /* …and a DIVIDED MSeg is marked as ours (`_msegPre`), not as a hand edit. It is a derivation — this
         function cut it out of the head's own value — and msegRefill declines to touch a segmentation whose
         stored value differs from the one it last prefilled, on the reasoning that the difference is the
         annotator's. Without this the piece would be frozen against a form that is about to change under it
         (sandhiSplitPausa puts the components back into pausa moments later), leaving `MSeg=bhṛ-to`
         segmenting a token now spelt `bhṛtaḥ`. A genuinely typed MSeg still differs and is still left alone. */
      all.forEach((c,k)=>{ const val=tierDashFix(bits[k],key); c.misc=setMiscKV(c.misc,key,val);
        if(key==="MSeg") c._msegPre=val; }); });
    /* …and everything DERIVED FROM A FORM is now stale: the head's script glyph and romanisation render
       the WHOLE `pra=kāśa` it no longer is, and the new components have none at all. Clearing them is
       what makes the fills recompute — the same move afterFormEdit makes when a form changes under it —
       and the range's own cached renderings go with them, being renderings of a surface that has only
       just come into existence. */
    all.forEach(c=>{ c.ortho=""; c.translit=""; c.translitLemma=""; c._trMisc=false; c._trPick=false;
      c.misc=setMiscKV(setMiscKV(c.misc,"Translit",""),"LTranslit",""); });
    const rng=(s.mwt||[]).find(x=>x.from===from); if(rng){ rng.ortho=""; rng.translit=""; rng.miast=""; } }
  markDirty(); selRange=null; sel={s:si,t:from}; preserveScroll(renderDoc); pick(si,from,false);
  if(parts){   // the components are already spelt, so the only thing left to refresh is what is derived from them
    /* …EXCEPT THE LAST ONE'S ENDING. The token being split was its own orthographic word and so carried
       the external sandhi the FOLLOWING word imposed; its components are stored in pausa. Only the last
       piece is affected — the interior junctions are compound-internal — and only the backend can undo it,
       so this goes on the bridge and is deliberately not awaited, exactly as sandhiFlattenLemma is: a split
       is a synchronous editing command and must not hold the selection while a call is out. It re-fuses the
       range afterwards, so the surface the text spells is unchanged either way. */
    /* ⚠ A NESTED SPLIT NEEDS THIS TOO, and skipping it was wrong. The reasoning was that a component is
       already stored in pausa — true of its EDGES, and only of those. Dividing one exposes an INTERIOR
       junction that never was in pausa, because it was inside a fused word: `punarjanmanām` cut as
       `punar=janmanām` leaves `punar` standing before a voiced sound, where the pausa is `punaḥ`. The pass
       walks the whole range and declines wherever there is nothing to undo, so running it over an existing
       range costs the components that did not move nothing at all. */
    /* ⚠ RE-PARSE THE PIECES FIRST, because the reversal READS THEIR TAGS and a fresh split has none worth
       reading. The head keeps the analysis of the WHOLE word it used to be — `punarjanmanām` is an ADJ
       with lemma `punarjanman`, and neither describes the `punar` just cut out of it — while every other
       piece is born bare (upos "X", no lemma). desandhi_final asks the UPOS whether this word's pausa
       column takes a citation form or an inflected one, and the lemma IS the answer for an indeclinable
       (bdc7333), so running it on inherited tags gets `punaḥ` for a word cited `punar`: the right rule
       reading the wrong evidence.
       reparseTokenFields fills lemma/UPOS/FEATS on the tokens that now exist without re-tokenising, so
       the reversal then reads what the pieces ARE. Chained rather than awaited — the split itself stays
       synchronous — and it degrades: with no model the reversal still runs, on whatever tags are there. */
    if(isSanskritLang() && typeof sandhiSplitPausa==="function"){
      const ids=[]; for(let k=from;k<=to;k++) ids.push(k);
      const tagged=(hasBridge()&&model&&typeof reparseTokenFields==="function")
        ? reparseTokenFields(si,ids,{upos:true}).catch(()=>false) : Promise.resolve(false);   // …UPOS included: see the opt in reparseTokenFields — a split piece has no chosen word class to protect, and the reversal's answer turns on it
      tagged.then(()=>sandhiSplitPausa(si,host?host.from:from)); }   // the HOST's id where there is one: that is the range the components belong to
    if(show.translit) fillTranslit();
    if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho();
    toast(`Split into ${n} components at “=”`); }
  else toast(`Token split into a ${n}-part multi-word token — fill in the component words`); }

/* ── SPLITTING A TOKEN INTO SEPARATE WORDS, at its spaces ──────────────────────────────────────────
   The counterpart of the `=` division above, and deliberately its counterpart rather than a variant
   of it: `=` is this app's CLITIC SEAM, so `pra=kāśa` is one orthographic word analysed as two tokens
   and the division produces a multi-word token spanning them. A SPACE is the opposite claim — it says
   these are two orthographic words that a mis-tokenisation ran together — so the division produces
   two free-standing tokens and no range at all. Same gesture, same "the form has already said how it
   divides" convenience, opposite structural answer; `=` wins where a form somehow carries both,
   because it is the explicit mark and a space could be a stray keystroke.

   WHAT EACH PIECE INHERITS. The head piece keeps the token's own analysis and its incoming relation —
   it is the one thing about the old token that is still true of something — and the rest are born
   bare (`X`, no lemma) attached to it as `udep`, exactly as a fresh MWT component is. Then the whole
   run is RE-PARSED with `{upos:true}`: unlike the clitic case, these are genuinely different words,
   so no piece has a word class worth protecting and the head's own (an analysis of the two words
   together) is as wrong as the placeholders. Chained, not awaited, so the command stays synchronous,
   and it degrades to "the pieces keep what they were given" with no model.

   SpaceAfter GOES TO THE LAST PIECE ALONE. It is a statement about what follows the token, and after
   the split what follows the earlier pieces is the space they were divided at — i.e. the default. A
   `SpaceAfter=No` left on the head would have the file assert that `two` and `words` are written
   `twowords`, which is the very thing this split exists to deny.

   ⚠ REFUSED INSIDE A MULTI-WORD TOKEN. An MWT range IS one orthographic word; a space inside one is a
   contradiction, not an annotation, and silently growing the range around the pieces (which is what
   the `=` path rightly does) would record that contradiction in the file. Say so instead. */
function splitTokenAtSpaces(si,idx,parts){ const s=DOC[si], toks=s.tokens; const head=toks[idx]; if(!head)return false;
  if((s.mwt||[]).some(m=>idx+1>=m.from&&idx+1<=m.to)){
    toast("This token is inside a multi-word token — one orthographic word cannot contain a space. Divide it with “=” instead."); return false; }
  pushUndo(si);
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});   // heads by identity, so the coming splice renumbers cleanly
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to); });
  const comps=[]; for(let k=1;k<parts.length;k++){ const c=tok(parts[k],"","X","","",0,"udep"); c._ht=head; comps.push(c); }
  const spAfter=miscKV(head.misc,"SpaceAfter");           // …captured before the head stops being the last piece
  head.form=parts[0];
  head.misc=setMiscKV(head.misc,"SpaceAfter","");         // a space now follows the head — it is where the split was made
  if(spAfter&&comps.length) comps[comps.length-1].misc=setMiscKV(comps[comps.length-1].misc,"SpaceAfter",spAfter);
  toks.splice(idx+1,0,...comps);
  toks.forEach(t=>{ t.head=t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  remapMWT(s,toks);
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // no token is dropped — this only shifts the ids after the insertion, and DEPS / empty-node anchors with them
  /* The tiers that describe the OLD word describe nothing now: a lemma, a segmentation, a gloss and a
     pausa spelling were all statements about `two words` as one word. They are cleared off the head
     rather than divided (the `=` path divides them, because there the pieces really are the morphemes
     the tier enumerated) and the re-parse below fills what it can. Gloss and CorrectForm go with them
     for the same reason; MISC keys the split has nothing to say about are left exactly as they were. */
  const all=[head].concat(comps);
  head.lemma="_";
  ["MSeg","MGloss","Gloss","Unsandhied","CorrectForm"].forEach(k=>{ head.misc=setMiscKV(head.misc,k,""); });
  delete head._msegPre;
  all.forEach(c=>{ c.ortho=""; c.translit=""; c.translitLemma=""; c._trMisc=false; c._trPick=false; c._orthoKey="";
    c.misc=setMiscKV(setMiscKV(c.misc,"Translit",""),"LTranslit",""); });
  const from=idx+1, to=idx+parts.length;
  markDirty(); selRange=null; sel={s:si,t:from}; preserveScroll(renderDoc); pick(si,from,false);
  if(hasBridge()&&model&&typeof reparseTokenFields==="function"){
    const ids=[]; for(let k=from;k<=to;k++) ids.push(k);
    reparseTokenFields(si,ids,{upos:true}).then(ok=>{ if(ok)preserveScroll(renderDoc); }).catch(()=>{}); }
  if(show.translit) fillTranslit();
  if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho();
  toast(`Split into ${parts.length} separate tokens at the spaces`);
  return true; }
// flatten a multi-word token back to a single token: its form = the MWT's surface form, its POS/deprel/
// head/other attributes = those of the MWT's head component (the one whose head lies outside the range)
/* Is this MGloss made ONLY of Leipzig abbreviations — i.e. grammatical categories rather than a gloss of
   its own morpheme? Both the split and the flatten need the same answer, and glossAbbrSegments is already
   the app's ruling on which runs of a gloss are abbreviations, so neither re-decides it. */
function mglossAbbrOnly(v){ if(typeof glossAbbrSegments!=="function") return false; let any=false;
  for(const seg of glossAbbrSegments(v||"")){ const t=String(seg[0]||"").replace(/[-.\s]/g,"");
    if(!t) continue; if(!seg[1]) return false; any=true; }
  return any; }
function flattenMWT(si,m){ const s=DOC[si], toks=s.tokens; if(!m)return; pushUndo(si);
  const from=m.from, to=m.to;
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});   // heads by identity
  const comps=toks.slice(from-1,to), compSet=new Set(comps);
  const head=comps.find(t=>t._ht===0||!compSet.has(t._ht)) || comps[0];   // head component = external attachment (or root)
  /* The MWT's surface form — and everything DERIVED from a form with it. The spread carries the head
     COMPONENT's ortho/translit caches, and bform() renders t.ortho in preference to t.form, so under a script
     orthography the flattened token kept showing the component's glyph while its `form` said otherwise: the
     right data under the wrong rendering. The MWT carries its own m.ortho/m.translit (renderings of m.form, and
     for Sanskrit the sandhi-FUSED ones), so they transfer with it; where it has none, "" makes the fills
     recompute. MISC Translit/LTranslit go, being the component's — annotateTranslitMisc rewrites them. */
  const survivor={...head, form:m.form, ortho:m.ortho||"", translit:m.translit||"", translitLemma:""};
  survivor._ht=head._ht; survivor._trMisc=false; survivor._trPick=false;
  /* ⚠ SANSKRIT FUSES; IT DOES NOT CONCATENATE. Inside a multi-word token the components are stored in
     PAUSA (the DCS convention — see CLAUDE.md), so running them together spells a word that Sanskrit
     never writes: `manaḥ`+`ratha` is `manoratha`, not `manaḥratha`; `ātman`+`vid` is `ātmavid`, not
     `ātmanvid`. Every junction has to go back through sandhi, and WHICH sandhi depends on the junction:
     a member marked FEATS `Compound=Yes` is BOUND, so what follows it is compound-INTERNAL. Almost
     every rule fires at both boundaries; the one that does not is the -n gemination, which is external
     only — `asmin`+`eva` → `asminneva` between words, but `an`+`anta` → `ananta` (NOT `annanta`) inside
     a compound, and a- / an- before a vowel is much the commonest bound member there is. That flag
     rides the fusion as `bounds`; app/translit.py's _sandhi_preprocess is where it is spent.
     The FORM is exempt because it is not being derived at all: `m.form` is the orthographic word as it
     already stands in `# text`, fused when the tokeniser read it or when sandhiMwtForms last re-fused
     it, and re-deriving it here could only contradict the running text. Everything else the flattened
     token carries is derived FROM that fused word rather than assembled from the pieces.
     ⚠ GATED ON THE BRIDGE, because the derived rows below are BLANKED for it to refill and only the
     backend can romanise: with no bridge (a browser design session) blanking them would leave them
     blank for good, so there flatten keeps its naive join — which is the best answer available when
     nothing can transliterate anything anyway. */
  const saFuse=(typeof isSanskritLang==="function" && isSanskritLang()
                && typeof hasBridge==="function" && hasBridge() && DOCLANG) ? {
    lemmas: comps.map(t=>(t.lemma&&t.lemma!=="_")?t.lemma:""),
    bound:  comps.map(t=>/(?:^|\|)Compound=Yes(?:\||$)/.test(t.feats||"")) } : null;
  /* ⚠ EVERY PER-WORD FIELD IS CONCATENATED, not inherited from the head component. Flatten makes one
     word out of n, so the analysis of that word is the analyses of its parts in order — taking only the
     head's silently DISCARDED the rest: `ātma`+`vidām` flattened to lemma `vid`, losing `ātman`, and
     the same for the transliteration and the glossing tiers, which is a whole morpheme's annotation gone.
     ‣ lemma / transliteration are joined SOLID: they are word-shaped, and the word is written solid.
     ‣ the glossing tiers join on "-", because that is already the morpheme separator INSIDE each of
       them (`MSeg=vid-ām`), and the components become morphemes of the flattened word — so
       `ātma` + `vid-ām` reads `ātma-vid-ām` and its MGloss `self-know-GEN.PL`, which is what the tier
       means. Seam marks are stripped first (msegStrip): they marked the MWT boundary that has just
       ceased to exist. A component contributing nothing to a tier is skipped rather than leaving an
       empty slot, so one unglossed part cannot produce a stray "-". */
  /* A gloss made ONLY of Leipzig abbreviations is not a gloss of its own morpheme — it is the categories
     that attach to the one before it, so it keeps its hyphen on the side it attaches to EVEN WHERE THE
     NEIGHBOUR CONTRIBUTES NOTHING: `` + `GEN.PL.M` is `-GEN.PL.M`, not `GEN.PL.M`, because the morpheme it
     qualifies is still there in MSeg and in the form. Dropping empty pieces and joining what was left —
     which is what this did — silently promoted a suffix's categories to a word-level gloss.
     A lexical gloss beside an empty one keeps no hyphen (`` + `shining` → `shining`): there the empty
     piece really is nothing to attach to.
     A value that ALREADY leads with "-" or "." carries its own mark and is joined as-is, so nothing is
     doubled — which also fixes a plain `x` + `-ām` running together as `x--ām`. */
  const tierJoin=k=>{ let out="";
    comps.forEach(t=>{ const v=msegStrip(tierText(t,k)); if(!v) return;
      const lead=/^[-.]/.test(v);
      /* …and no separator where ONE IS ALREADY THERE, on either side. The `lead` test caught a piece that
         brings its own mark; a piece whose PREDECESSOR ends in one was the other half of the same rule and
         was missing, so `x-` + `y` came out `x--y`. tierDashFix normalises what still slips through. */
      if(out) out += (lead||/-$/.test(out)) ? v : "-"+v;
      else out = (!lead && k==="mgloss" && mglossAbbrOnly(v)) ? "-"+v : v; });
    return tierDashFix(out,k); };
  survivor.lemma=comps.map(t=>(t.lemma&&t.lemma!=="_")?t.lemma:"").join("")||survivor.form;
  /* ⚠ THE COMPONENTS' OWN VALUES FIRST, not the RANGE's. `m.translit` is a rendering of a RANGE, and a
     range's rendering marks the seams between its members — under CSL that is literally what it is for
     (`ātma-vidāṃ`, see fillTranslitCSL). Flatten abolishes those seams: what comes out is ONE word, whose
     form is written solid, so a transliteration still carrying a hyphen describes a division the token no
     longer has and disagrees with the form beside it. Joining the components' own transliterations solid
     gives the word's romanisation with no seam in it. `m.translit` survives only as the fallback for a
     range whose components have none, which is where it was doing useful work before. */
  const trJoined=comps.map(t=>t.translit||"").join("");
  /* SANSKRIT TAKES NEITHER OF THOSE. A component's transliteration romanises its PAUSA form, so joining
     them reproduces the unfused spelling one letter for one letter — `ātma`+`vidām` romanised and run
     together is `ātmavidām` only by luck, and `manaḥ`+`ratha` comes out `manaḥratha` beside a form that
     says `manoratha`: the romanisation would contradict the very glyph it sits under. Blanking both
     makes fillTranslit/fillOrtho re-derive them from `survivor.form`, which IS the fused word — so the
     two rows cannot disagree, and no seam can survive into them either (m.translit marks the seams of a
     RANGE; see the note above). The lemma has no such row to fall back on and is fused outright, below. */
  survivor.translit=saFuse?"":(trJoined||m.translit||"");
  survivor.translitLemma=saFuse?"":comps.map(t=>t.translitLemma||"").join("");
  if(saFuse) survivor.ortho="";
  survivor.misc=setMiscKV(setMiscKV(survivor.misc,"Translit",""),"LTranslit","");
  /* ⚠ Unsandhied MERGES TOO, and leaving it on the head's value is what made a flattened `mūrti`+`tve`
     read as `tve`: MISC `Unsandhied` is the token's PAUSA spelling, and app/sa_notation.py's csl_forms
     prefers it over the form (that is the whole point of it — feeding a sandhied surface back through a
     sandhi generator would apply the rules twice). So the survivor said `mūrtitve` in its form and
     `-tve` in its pausa, and every CSL rendering believed the pausa.
     Joined SOLID like the lemma and the transliteration, with each piece's seam marks taken off first:
     a continuation mark records a boundary between components, and flatten has just removed the
     boundary it recorded. */
  { const un=comps.map(c=>String(miscKV(c.misc,"Unsandhied")||"").replace(/^[-꞊=⹀]+|[-꞊=⹀]+$/g,"")).filter(Boolean).join("");
    survivor.misc=setMiscKV(survivor.misc,"Unsandhied",un); }
  ["gloss","mseg","mgloss"].forEach(k=>{ const v=tierJoin(k); survivor.misc=setMiscKV(survivor.misc,TIER_MISC[k],v); });
  if(comps.every(t=>t.lemma===t.form)) survivor.lemma=survivor.form;   // the rule mergeTokens applies: lemmas that merely echoed their forms said nothing, so the result follows the new form rather than gluing the same string twice
  toks.forEach(t=>{ if(compSet.has(t._ht)) t._ht=survivor; });            // dependents of any removed component re-point to the survivor
  (s.mwt||[]).forEach(mm=>{ mm._toks=toks.slice(mm.from-1,mm.to); });
  toks.splice(from-1, to-from+1, survivor);
  toks.forEach(t=>{ t.head=t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  delete m._toks; s.mwt=(s.mwt||[]).filter(mm=>mm!==m); remapMWT(s,toks);   // the flattened range is consumed; the rest re-number onto their surviving components
  remapTokenRefs(s,idMapAfter(oldIds,toks,from));   // `from` is the survivor's id — as in mergeTokens, the components are FUSED rather than removed, so an enhanced arc into one of them still lands
  const sv=toks[from-1];
  if(sv&&sv.deps&&sv.deps!=="_"){ const kept=sv.deps.split("|").filter(p=>{ const i=p.indexOf(":"); return i<0||p.slice(0,i)!==String(from); });
    sv.deps=kept.length?kept.join("|"):"_"; }   // …which can leave a self-loop where one component had an enhanced arc to another
  markDirty(); selRange=null; sel={s:si,t:from}; preserveScroll(renderDoc); pick(si,from,false);
  /* …and THEN the sandhi, because only the backend can fuse: the concatenated lemma above stands as a
     placeholder for the one paint before the bridge answers (and as the whole answer when there is no
     bridge — a browser design session still flattens, it just spells the lemma naively). Deliberately
     not awaited: flatten is a synchronous editing command and must not leave the selection unmoved
     while a call is in flight — sandhiMwtForms is fire-and-forget for the same reason. */
  if(saFuse && typeof sandhiFlattenLemma==="function") sandhiFlattenLemma(si,from,saFuse);
  toast("Multi-word token flattened to a single token"); }

// small floating prompt with a numeric input (used by Convert-to-MWT to ask for the component count)
function countPrompt(x,y,opts){ closeCtx();
  let pop=document.getElementById("countpop");
  if(!pop){ pop=document.createElement("div"); pop.id="countpop"; pop.className="countpop"; document.body.appendChild(pop); }
  pop.classList.remove("textpop");   // the shell is shared with item 6's textPrompt — drop its wide free-text sizing
  const min=opts.min||2;
  pop.innerHTML=`<div class="cp-title"></div><div class="cp-row"><input type="number" min="${min}" step="1" class="cp-in"><button class="cp-ok">OK</button></div><div class="cp-hint"></div>`;
  pop.querySelector(".cp-title").textContent=opts.title||"";
  pop.querySelector(".cp-hint").innerHTML=opts.hint||"";   // hint may carry &nbsp; to keep phrases unbreakable (caller-controlled string, not user input)
  const inp=pop.querySelector(".cp-in"); inp.value=opts.value!=null?opts.value:min;
  const okb=pop.querySelector(".cp-ok");
  function close(){ pop.classList.remove("show"); document.removeEventListener("pointerdown",outside,true); document.removeEventListener("keydown",onkey,true); }
  function done(){ const n=parseInt(inp.value,10); if(!Number.isInteger(n)||n<min){ inp.classList.add("bad"); inp.focus(); inp.select(); return; } close(); opts.ok(n); }
  function outside(e){ if(!pop.contains(e.target)) close(); }
  function onkey(e){ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); } else if(e.key==="Enter"){ e.preventDefault(); done(); } }
  okb.onclick=done; inp.addEventListener("input",()=>inp.classList.remove("bad"));
  pop.classList.add("show");
  const w=pop.offsetWidth, h=pop.offsetHeight;
  const left = opts.rtl ? (x-w) : x;   // RTL → the popover extends leftward so it sits on the reading-start (right) side
  pop.style.left=Math.max(8,Math.min(left,innerWidth-w-8))+"px"; pop.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-h-8))+"px";
  setTimeout(()=>{ inp.focus(); inp.select(); },20);
  setTimeout(()=>{ document.addEventListener("pointerdown",outside,true); document.addEventListener("keydown",onkey,true); },0); }
/* item 6 — the same popover shell as countPrompt, but for a FREE-TEXT value: the correct form of a token just
   marked Typo=Yes. Supplying one is optional — an empty field (or Escape) simply leaves no CorrectForm, and
   Escape additionally cancels the rest of a queued run so marking a range doesn't trap the user in a chain of
   prompts. opts: {rtl,title,hint,value,ok(value),cancel()}. */
function textPrompt(x,y,opts){ closeCtx();
  let pop=document.getElementById("countpop");
  if(!pop){ pop=document.createElement("div"); pop.id="countpop"; pop.className="countpop"; document.body.appendChild(pop); }
  pop.classList.add("textpop");
  pop.innerHTML=`<div class="cp-title"></div><div class="cp-row"><input type="text" class="cp-in" spellcheck="false" autocomplete="off"><button class="cp-ok">OK</button></div><div class="cp-hint"></div>`;
  pop.querySelector(".cp-title").textContent=opts.title||"";
  pop.querySelector(".cp-hint").innerHTML=opts.hint||"";   // caller-controlled string, not user input
  const inp=pop.querySelector(".cp-in"); inp.value=opts.value||""; inp.dir=opts.rtl?"rtl":"ltr";
  const okb=pop.querySelector(".cp-ok");
  let settled=false;
  function close(){ settled=true; pop.classList.remove("show"); pop.classList.remove("textpop"); document.removeEventListener("pointerdown",outside,true); document.removeEventListener("keydown",onkey,true); }
  /* item 1 — ITRANS → IAST on commit, for both of this prompt's users: every value it asks for is a
     WORD OF THE DOCUMENT (a token's correct form, a token's lemma), written in the notation the
     document is stored in, so a Sanskrit one is typed in ITRANS exactly as the Form cell's is. It sits
     here rather than in each caller so the two can't drift, and it is a no-op for every other language
     and with no bridge (itransFix, js/lang/translit.js). `opts.itrans:false` opts a future caller out.
     The field is closed FIRST and the value converted after: the box must not sit on screen for the
     length of a bridge round-trip, and `ok` is the only thing that needs the converted string. */
  async function done(){ if(settled)return; const v=inp.value.trim(); close();
    if(opts.ok) opts.ok(opts.itrans===false?v:await itransFix(v)); }
  function cancel(){ if(settled)return; close(); opts.cancel&&opts.cancel(); }
  function outside(e){ if(!pop.contains(e.target)) done(); }   // clicking away COMMITS whatever was typed (nothing typed → nothing set), matching the inline field editors; only Escape abandons the run
  function onkey(e){ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); cancel(); } else if(e.key==="Enter"){ e.preventDefault(); done(); } }
  okb.onclick=done;
  pop.classList.add("show");
  const w=pop.offsetWidth, h=pop.offsetHeight;
  const left = opts.rtl ? (x-w) : x;
  /* `x` is the left edge of the thing this prompt is about (a word in the running sentence, say) and the popup's
     own left is set from it — but `left` positions the BORDER BOX, so the glass edge lands one border-width
     inside where the word starts. Take that back off and the two line up exactly.
     Only the border: a previous attempt subtracted the popup's whole content inset (border + the 11px padding),
     which over-corrected and pushed the box visibly LEFT of the word. The padding is meant to be there — it is
     the gap between the glass and the field — and it is not part of the alignment. */
  pop.style.left=Math.max(8,Math.min(left,innerWidth-w-8))+"px"; pop.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-h-8))+"px";
  if(!opts.rtl){ const bw=parseFloat(getComputedStyle(pop).borderLeftWidth)||0;
    if(bw) pop.style.left=Math.max(8,Math.min(left-bw,innerWidth-w-8))+"px"; }
  setTimeout(()=>{ inp.focus(); inp.select(); },20);
  setTimeout(()=>{ document.addEventListener("pointerdown",outside,true); document.addEventListener("keydown",onkey,true); },0); }
// the currently selected token's grid row or diagram node — used to anchor the count prompt
function selAnchorEl(){ return document.querySelector(`#doc tr[data-s="${sel.s}"][data-tok="${sel.t}"]`)
    || tokGroupOf(sel.s,sel.t); }
function openConvertMWT(si,idx){ pick(si,idx+1,false); const rtl=sentRTL(DOC[si]), el=selAnchorEl();
  let x,y;
  if(el){ const b=el.getBoundingClientRect(); y=b.bottom+4; x=rtl?b.right:Math.max(12,b.left+20); }   // RTL → anchor at the token's right edge, opening leftward
  else { y=innerHeight/2-60; x=rtl?innerWidth/2+105:innerWidth/2-105; }
  /* A FORM THAT SPELLS ITS OWN DIVISION NEEDS NO PROMPT. `=` is the clitic seam this app already reads in
     the MSeg tier, so `pra=kāśa` has said both how many components it has and what they are — asking for a
     count and then handing back empty fields makes the user type what the token already told us.
     Every piece must be non-empty: a leading, trailing or doubled `=` gives an empty component, which is
     not a division anybody meant, so those fall through to the prompt rather than producing a blank token. */
  const t0=(DOC[si]&&DOC[si].tokens[idx])||null, raw=(t0&&t0.form)||"";
  if(raw.indexOf("=")>=0){ const parts=raw.split("=");
    if(parts.length>1 && parts.every(x=>x)){ convertTokenToMWT(si,idx,parts.length,parts); return; } }   // it announces the split itself
  /* …AND A FORM THAT SPELLS ITS DIVISION WITH SPACES divides into free-standing tokens instead — the
     same "no prompt needed" rule, for the other kind of division (see splitTokenAtSpaces for why the
     two answers differ, and why `=` is tested first). Any run of whitespace counts as one boundary,
     so a form pasted with a double space or a stray tab still yields the words the reader can see.
     A refusal (inside an MWT) falls through to the count prompt, which is still a sensible thing to
     have asked for. */
  if(/\s/.test(raw)){ const words=raw.split(/\s+/).filter(x=>x);
    if(words.length>1 && splitTokenAtSpaces(si,idx,words)) return; }
  countPrompt(x,y,{rtl, title:`Split token ${idx+1}`, min:2, value:2,
    hint:"Component tokens<br>(2 or more).", ok:n=>convertTokenToMWT(si,idx,n)}); }   // explicit <br> → the parenthetical always drops to its own line
// the MWT entries for a token menu (grid or diagram): flatten + ungroup when the token is in an MWT, else split
// items 2/3 — the two marker-FEAT rows shared by the diagram-node and grid-row menus. A checkmark shows the
// CURRENT state of the selection (every selected token carrying it), so the row reads as a toggle, not a setter.
function markFeatItems(si,tokId){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return [];
  const multi=selRange&&selRange.s===si&&selRange.to>selRange.from&&tokId>=selRange.from&&tokId<=selRange.to;
  const on=n=>multi?selHasFeat(n):hasFeat(t.feats,n,"Yes");   // a right-click inside the selected RANGE toggles the whole range (matching what the command itself will do)
  const tgt=extPosTarget(si,tokId);
  // No "External POS" row here — that's reached by ⇧-right-clicking a node or right-clicking a bracket label.
  // The rows drop the "Mark as " prefix that used to repeat on each: the flyout's own row supplies it, so the
  // reading is "Mark as ▸ Foreign" and each row names only what it marks.
  // opt:true opens the checkmark GUTTER (.ctx .ck is absolutely positioned at the menu's 12px inset, and only
  // .ctx button.opt's padding-inline-start:25px moves the label clear of it). Without it the ✓ paints straight
  // on top of the first letter of a ticked row — the same fault the readings flyout had; every other checkable
  // list in this file (POS, deprel, deep features) passes it for exactly this reason.
  return [{label:"Foreign", kbd:"⌘I", opt:true, check:on("Foreign"), fn:()=>{ pick(si,tokId,false,false); toggleForeign(); }},
          {label:"Typo",    kbd:"⌘/", opt:true, check:on("Typo"),    fn:()=>{ pick(si,tokId,false,false); toggleTypo(); }},
          {label:"Reported Speech", kbd:"⇧⌘'", opt:true, check:isReported(s.tokens[tgt-1]), fn:()=>{ pick(si,tokId,false,false); toggleReported(); }}]; }
// …and the single row that carries them, for the token menus. subFit shrinks the flyout to its own content
// rather than the shared 224px floor — three short labels have no business filling a full-width menu.
function markFeatRow(si,tokId){ const items=markFeatItems(si,tokId);
  return items.length ? [{label:"Mark as…", sub:()=>markFeatItems(si,tokId), subFit:true}] : []; }   // rebuilt on open, not captured: the ticks must show the state at the moment the flyout is raised, not when the parent menu was built
// open the ExtPos menu anchored on the token that was right-clicked (the row's own action, so it lands where the menu did)
function extPosMenuAtSel(si,tokId){ const el=tokGroupOf(si,tokId)||document.querySelector(`#doc tr[data-s="${si}"][data-tok="${tokId}"]`);
  const b=el?el.getBoundingClientRect():null, rtl=sentRTL(DOC[si]);
  extPosMenu(b?(rtl?b.right:b.left+20):innerWidth/2, b?b.bottom+4:innerHeight/2, si, tokId); }
/* WHOSE MENU IS THIS — the multi-word token's, or one of its component tokens'? The two get DIFFERENT rows,
   because they are different objects and the operations belong to one or the other:
     · Flatten and Ungroup act on the RANGE. They are the range's own controls, and a component showing them
       offers to dissolve the word it merely belongs to — the same slip as a paragraph's menu offering to
       delete the chapter. `forRange` is what the tie's and the range row's menus pass.
     · Split divides a TOKEN. On a component it divides that component in place and grows the range around it
       (convertTokenToMWT's `host` branch); on the range it has no object at all, and would silently act on
       whichever component happens to be first.
   So neither row set is a subset of the other, and nothing is shared but the resolution of `si`/`tokId`. */
function mwtTokenItems(si,tokId,forRange){
  if(!forRange) return SPLIT_ROW(si,tokId);
  const m=mwtAtSel(DOC[si],tokId); if(!m) return [];
  return [
    ["Flatten MWT","⌥⌘G",()=>flattenMWT(si,m)],   // ⌥⌘G, matching app/menu_spec.py's "Flatten Multi-word Token" — this row still read ⌥⌘F, the binding that item moved OFF when Find and Replace took ⌥⌘F (menu_spec records why: AppKit matches a key equivalent against the first eligible item in menu order, and Find and Replace sits above Flatten in the Edit menu, so ⌥⌘F here would have flattened nothing). The keystroke has been ⌥⌘G since; only this label was left behind
    ["Ungroup MWT","⇧⌘G",()=>{ const s=DOC[si]; pushUndo(si); s.mwt=(s.mwt||[]).filter(x=>x!==m); if(!s.mwt.length)delete s.mwt; markDirty(); preserveScroll(renderDoc); toast("Multi-word token removed"); }],
  ]; }
// The token-level row, for a free token and a component alike — see mwtTokenItems.
/* One command, and the row NAMES WHAT IT WILL ACTUALLY DO to this token — read off the form, which is
   where the division was written. A form carrying `=` (or nothing at all) makes a multi-word token; one
   carrying spaces makes separate words (splitTokenAtSpaces), and calling that "Split into MWT" would
   name the opposite structure. No ellipsis on either: a form that spells its own division needs no
   prompt, so the row does not always lead to one. The Edit menu's row keeps its own fixed wording — a
   native NSMenu item cannot re-title itself per selection. */
function SPLIT_ROW(si,tokId){ const t=(DOC[si]&&DOC[si].tokens[tokId-1])||null, f=(t&&t.form)||"";
  const spaces=/\s/.test(f)&&f.indexOf("=")<0;
  return [[spaces?"Split at Spaces":"Split into MWT","⌥⌘S",()=>openConvertMWT(si,tokId-1)]]; }
window.convertTokenMWT=function(){ if(sel.s<0||sel.t<1)return toast("Select a token to convert");
  /* A COMPONENT IS SPLITTABLE TOO, and this used to refuse it — "already part of a multi-word token" answered a
     question nobody asked. A range asserts that its tokens spell ONE orthographic word; it says nothing about how
     finely that word is analysed underneath, and dividing a component is a statement about the analysis. The split
     grows the host range around the new pieces rather than nesting a second range inside it (convertTokenToMWT). */
  openConvertMWT(sel.s,sel.t-1); };
window.flattenTokenMWT=function(){ if(sel.s<0||sel.t<1)return toast("Select a token inside a multi-word token");
  const m=mwtAtSel(DOC[sel.s],sel.t); if(!m)return toast("The selected token is not part of a multi-word token"); flattenMWT(sel.s,m); };

