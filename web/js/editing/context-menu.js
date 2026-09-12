//@module js/context-menu.js
/* context menus */
const ctx=document.getElementById("ctx");
const ctx2=document.createElement("div"); ctx2.className="ctx ctx-sub"; document.body.appendChild(ctx2);   // one nested flyout for "Other ▸"
// item forms accepted: null → separator (closes the current .catgrp, rule lands in the tail); {rule:true} → separator that
// stays INSIDE the currently-open group instead of closing it (falls back to the plain-null tail behaviour when no group is
// open) — see renderMenu's own comment on why the two cannot be merged; [label,kbd,fn,danger] tuple; {header} → section
// label; {label,expand,kbd,fn,danger,sub,disabled}
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
  /* item 29 — HOW MANY THINGS ARE BEHIND THIS ROW, as a numeric badge. The right-click flyouts (a tag's
     dot-suffixed subtypes, a relation's deep features) carry no chevron by design — see the note on the hover
     rule below for why they are a deliberate second gesture — which also left nothing at all to say that a row
     HAS one. The count says both: that there is a flyout, and how much is in it, without opening it.
     ⚠ IT RIDES WITH THE LABEL, not in the `.rightgrp`, on report: the row is `justify-content:space-between`, so
     anything in that group is pushed to the reading-END, past the expansion — which read as a number belonging
     to the gloss rather than to the label it counts. The pair share a `.lblgrp` (built ONLY when there is a
     badge, so every other row keeps exactly the DOM it had), which stays one flex item against the expansion.
     ⚠️ AND A COUNT OF 1 IS NOT DRAWN: "1" beside a row says no more than the flyout's own existence does, and
     these badges earn their ink by comparison — a column of them is a shape, and a column of 1s is noise. The
     flyout is still there and still opens; only the number is dropped. */
  const badge = it.subCount>1 ? `<span class="subcount">${it.subCount}</span>` : "";
  /* …and the ✕ that UNSETS this row's value, last in the group so it follows the label and any badge.
     ⚠ OUT OF FLOW (absolutely positioned off the group's own end — see .rowclear), because it must not make
     the menu any wider: a column is sized to its widest row, and one row growing by a glyph would push every
     other row's expansion out with it. */
  const clearX = it.clearX ? `<span class="rowclear" role="button" aria-label="${esc(it.clearX.title||"Clear")}" title="${esc(it.clearX.title||"Clear")}"><span class="rcx"></span></span>` : "";   // empty: the ✕ is DRAWN (.rowclear::before/::after) rather than set as a character — see that rule for why
  const lbl = (badge||clearX) ? `<span class="lblgrp"><span class="mlbl">${it.label}</span>${badge}${clearX}</span>`
                              : `<span class="mlbl">${it.label}</span>`;   // mlbl, not lbl → avoid the diagram .lbl rule (monospace/bold)
  b.innerHTML=`${it.check?'<span class="ck">✓</span>':""}${lbl}${right}`;
  if(it.clearX){ const xb=b.querySelector(".rowclear");
    if(xb) xb.addEventListener("click",e=>{ e.stopPropagation(); e.preventDefault(); closeCtx(); it.clearX.fn(); }); }   // stopPropagation, or the click reaches the row's own handler and re-picks the value instead of clearing it
  if(it.sub){ const raise=byClick=>{ if(ctx2.classList.contains("show")&&ctx2._owner===b) return;   // already this row's flyout → leave it alone rather than rebuild it under the pointer
      openSub(b,it.sub,it.subFit,undefined,it.subNoWrap,byClick); };                      // subFit → shrink the flyout to its content width instead of the shared 224px floor; subNoWrap → …and widen past the cap sooner than wrap a row
    b.onclick=e=>{ e.stopPropagation(); clearTimeout(b._subHov); raise(true); };   // clicking is just the impatient path to the same thing — and the one that focuses a search band (liftSearch)
    /* item 7 — A FLYOUT OPENS ON HOVER, which is what a native menu does; a click was never meant to be the only
       way in. The delay is what makes that bearable: without it, a pointer travelling down the menu towards some
       other row raises and tears down a flyout for every sub-row it crosses on the way. 140 ms is long enough to
       ignore a pass-through and short enough not to feel like a wait.
       RIGHT-CLICK FLYOUTS ARE EXCLUDED, deliberately (the `subRight` branch below has no hover of its own): those
       are the deep-feature submenus, a deliberate second gesture on a row that already does something on left
       click, and opening them merely by passing over would fire them constantly while choosing a relation. */
    b.onmouseenter=()=>{ clearTimeout(b._subHov); b._subHov=setTimeout(()=>raise(false),140); };
    b.onmouseleave=()=>{ clearTimeout(b._subHov); };   // cancels only a PENDING open — an already-raised flyout survives the pointer leaving, per the note below
  }
  /* ⚠ THE EVENT REACHES THE ROW'S ACTION, AND `keepOpen` MAY BE A FUNCTION OF IT. Both exist for one caller:
     a FEATS value row commits differently under a modifier (plain click replaces the value, ⌘/Ctrl-click adds
     it to a UD multi-value — see avmValueMenu), and the two want opposite dismissal behaviour, since replacing
     ends the gesture and combining is the middle of one. Additive: every existing row ignores the argument and
     passes a plain boolean. */
  else { b.onclick=e=>{ const keep=(typeof it.keepOpen==="function")?it.keepOpen(e):it.keepOpen;
      if(!keep) closeCtx(); it.fn&&it.fn(e); };            // left-click → the row's own action (for a relation, selecting it clears any deep feature). ⚠ keepOpen: a row that REPLACES this flyout's own contents rather than picking anything (posSubItems' "Other subtype…") — closing first would take the parent menu the reopen positions against with it
    // item 3: mousing away from a flyout must NOT dismiss it — a flyout closes only on an explicit action (a click
    // elsewhere, Escape, a selection, or reopening it). (Previously hovering a sibling top-level row closed it.)
    if(it.subWeights) b._subw=it.subWeights;   // item 29: the ranking THIS row's flyout is to be faded by — read by openSub once the flyout is on screen (weightSubRows)
    if(it.subRight) b.oncontextmenu=e=>{ e.preventDefault(); e.stopPropagation();   // right-click the row → its deep-feature submenu; a second right-click on the SAME row dismisses it
      if(ctx2.classList.contains("show") && ctx2._owner===b){ closeSub(); return; }
      openSub(b,it.subRight,false,it.subColSize,false,true); };   // a right-click IS the deliberate gesture here — focus a search band if one is built   // item 3: subColSize → size to one parent column, parent height
  }
  return b; }
// headers open a .catgrp wrapper so a category never splits across columns; two-col picks the split that best balances the two column heights (rtl → first column on the right)
function renderMenu(host,items,twoCol,rtl,isSub){ host.innerHTML="";
  const head=[], groups=[], tail=[]; let grp=null, gr=0;   // head: full-width note rows pinned ABOVE the (possibly two-column) group area
  const closeGrp=()=>{ if(grp){ groups.push({el:grp,rows:gr}); grp=null; gr=0; } };
  items.forEach(it=>{
    if(it==null){ closeGrp(); tail.push(document.createElement("hr")); return; }
    /* ⚠ {rule:true} — A DIVIDER THAT DOES NOT CLOSE THE GROUP, unlike plain `null` just above. Added for
       avmValueMenu's and addFeatureItems' per-feature "Other <feat>…"/"Clear <feat>" rows: those want a rule
       between a feature's value rows and its own Other/Clear rows, WITHOUT ending that feature's `.catgrp` box
       early — plain `null` was doing double duty (append an <hr>, AND close `grp`) and the second half is what
       sent every feature's Other/Clear down into `tail`, i.e. below every group instead of inside its own. When
       a group is open the rule joins it (and counts toward `gr`, same as any other row, so the two-column
       balance in the twocolwrap branch below still sees this feature's true row count); with no group open it
       degrades to the exact plain-null tail behaviour, so it's harmless to use outside a header block too. */
    if(it.rule){ const hr=document.createElement("hr"); if(grp){ grp.appendChild(hr); gr++; } else tail.push(hr); return; }
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
/* ⚠ A LONG FLYOUT GETS A SEARCH FIELD, and it is built here rather than by each caller so that every
   one of them gets it on the same terms — "the flyout should have a search bar (as should the
   equivalent flyout anywhere else)". A flyout of 122 feature values is a list you read by scrolling,
   which is the only list in this menu system that has ever been long enough to need finding rather
   than choosing; the threshold is what keeps a five-row flyout from growing a control it has no use
   for. Structurally it is `liftFootLink`'s twin — a fixed band, a scrolling rest — and reuses that
   pair's own CSS shape in both kits.
   ⚠ THE MATCH IS A WORD PREFIX, NOT A SUBSTRING, and it is `wordPrefixRe` (js/core/state.js) — the
   very function the Languages menu and the translation drawer search with, so the three answer a
   query the same way. "per" finds Person and (in a value list) Perlative; it does not find Hyper.
   Both halves of a row are searched, because half of them say what the other half means: `Ptan` is
   findable as "plurale tantum" and `Gdv` as "gerundive".
   ⚠ AND A HEADER MATCHES ITS WHOLE GROUP: typing a feature name is how a reader asks for that
   feature's values, not for the one value whose name happens to repeat the feature's. */
const SUB_SEARCH_MIN=14;   // rows before the field earns its own band — a little over one screenful of a capped flyout
function liftSearch(host,autoFocus){
  const rows=host.querySelectorAll("button");
  if(rows.length<SUB_SEARCH_MIN || host.querySelector(".ctx-sub-search")) return;
  let scroll=host.querySelector(".ctx-sub-scroll");
  if(!scroll){ scroll=document.createElement("div"); scroll.className="ctx-sub-scroll";
    while(host.firstChild) scroll.appendChild(host.firstChild); host.appendChild(scroll); }
  const band=document.createElement("div"); band.className="ctx-sub-search";
  const inp=document.createElement("input"); inp.className="lmsearch"; inp.type="search"; inp.spellcheck=false;
  inp.placeholder="Search…"; inp.setAttribute("aria-label","Search this list");
  band.appendChild(inp); host.insertBefore(band,host.firstChild); host.classList.add("ctx-sub-srch");
  const note=document.createElement("div"); note.className="hdr"; note.textContent="No match"; note.style.display="none";
  scroll.appendChild(note);
  const txt=el=>{ const l=el.querySelector(".mlbl"), e=el.querySelector(".expand");
    return ((l?l.textContent:el.textContent)+" "+(e?e.textContent:"")).toLowerCase(); };
  const apply=q=>{ q=(q||"").trim().toLowerCase();
    const re=q?(typeof wordPrefixRe==="function"?wordPrefixRe(q):null):null;
    const hit=t=>!q||(re?re.test(t):t.indexOf(q)>=0);
    let any=false, group=null, groupShown=false;
    const flush=()=>{ if(group) group.style.display=groupShown?"":"none"; };
    // ⚠ A DESCENDANT WALK, NOT `scroll.children`: renderMenu nests its rows in a column element, so a
    // walk over direct children saw no buttons at all — every row stayed visible while the "No match"
    // note appeared beneath them, which is the one state that cannot be true. querySelectorAll is in
    // document order, which is all the header-grouping below needs.
    [...scroll.querySelectorAll("button,.hdr,hr")].forEach(n=>{
      if(n===note) return;
      if(n.tagName==="HR"){ n.style.display=q?"none":""; return; }
      if(n.classList&&n.classList.contains("hdr")){ flush(); group=n; groupShown=false;
        n._hdrHit=hit(n.textContent.toLowerCase()); return; }
      if(n.tagName!=="BUTTON") return;
      const on=!q||(group&&group._hdrHit)||hit(txt(n));   // a matching header carries its whole group
      n.style.display=on?"":"none"; if(on){ any=true; groupShown=true; } });
    flush();
    note.style.display=any?"none":""; };
  inp.addEventListener("input",()=>apply(inp.value));
  inp.addEventListener("keydown",e=>{ if(e.key!=="Enter")return;   // Enter takes the first row still standing
    const first=[...scroll.querySelectorAll("button")].find(b=>b.style.display!=="none");
    if(first){ e.preventDefault(); first.click(); } });
  inp.addEventListener("pointerdown",e=>e.stopPropagation());   // the field is not a row: clicking into it must not reach the row-hover/open logic behind it
  /* ⚠ FOCUSED ONLY WHERE THE READER OPENED THIS DELIBERATELY. A flyout also opens on HOVER, after
     140ms, for a pointer merely travelling down the menu — and a field that grabs the keyboard as the
     pointer passes over a row would swallow the next thing typed anywhere. A click (or a right-click,
     for the subtype flyouts) is the gesture that means "I want this list", and that is the one that
     puts the caret in the field; a hover-opened flyout is searched by clicking into it. */
  if(autoFocus){ try{ inp.focus({preventScroll:true}); }catch(_){ inp.focus(); } }
}
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
  const band=host.querySelector(".ctx-sub-search");   // the search band is fixed like the footer, and its height is not the rows' to spend either
  const avail=cap-(foot?foot.getBoundingClientRect().height:0)-(band?band.getBoundingClientRect().height:0)-padT-padB-hostPad;
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
function openSub(btn,items,fit,colSize,noWrap,focusSearch){ _subLoadToken++; const myToken=_subLoadToken; ctx2._owner=btn; ctx2._colSize=colSize;   // …and HOW it was sized: a drill-down row inside it reopens it off the same owner and must not resize the flyout under itself   // remember which row opened this flyout → a second right-click on it toggles it shut
  const subW=btn&&btn._subw;   // item 29: this row's own ranking for its flyout's rows — applied after each render below (weightSubRows), including the async one
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
  // narrow parent (only a `.defctx` menu can be, `min-width:0`) can't squeeze the flyout below one normal menu's
  // width, and can't drag the min-width floor clamp in render() down with it.
  // ⚠ "NONE OF THOSE HAS A SUB ROW TODAY" WAS TRUE WHEN THAT WAS WRITTEN AND IS NOT ANY MORE: the AVM placeholder
  // menu is a `.defctx` fitted menu, and it now carries "Other feature…". With the flat 224 floor its flyout came
  // out at 224px hanging off a 148px menu, against 128px for the SAME shape of list in the token menu's own "Add
  // feature…" — reported as "don't make the Other Feature flyout so wide; make it as wide as the other feature
  // flyouts". A fitted parent therefore caps at its OWN width, which is the rule this whole measure states in the
  // line above it: a panel hinged off a menu shouldn't outgrow the menu it hangs from. The 224 floor stays for
  // every ordinary menu, where it is what it was written for; a fitted parent keeps a floor of its own (120px, a
  // little under the narrowest such menu this app draws) so the clamp can never collapse a flyout to a sliver.
  const parentW=ctx.classList.contains("defctx")?Math.max(ctx.offsetWidth,120):Math.max(ctx.offsetWidth,224);
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
  /* ⚠ BOTH LIFT CLASSES COME OFF HERE, and the second one is a bug fix: `ctx-sub-srch` was added by
     liftSearch and never removed by anything. Both classes zero the flyout's own `padding-inline` and
     move the 12px inset onto the `.ctx-sub-scroll`/band children the lift builds (base-chrome.css,
     fluent-chrome.css) — so a class surviving the `renderMenu` below, which wipes exactly those
     children, leaves the NEXT flyout's rows flush against the glass with no horizontal padding at all.
     ONE ctx2 serves every flyout in the app, so it only takes one long list (the feature menu's
     "Add feature…", 122 rows, well past SUB_SEARCH_MIN) to strand the class on every shorter flyout
     opened after it — which is why it shows up as "the feature menu's flyouts have no padding" rather
     than as one menu misdrawing. `ctx-sub-foot` was already removed for the same reason. */
  const render=arr=>{ ctx2.classList.remove("ctx-sub-foot","ctx-sub-srch"); ctx2.dir=ctx.dir; renderMenu(ctx2,(arr||[]).map(normItem),false,undefined,true); ctx2.classList.add("show"); weightSubRows(subW);   // item 29: fade the flyout's own rows by this row's ranking, at EVERY render (an async `items` re-renders through here too)
    /* ⚠ …UNLESS THE CAP WOULD MAKE ROWS WRAP, for a flyout whose caller says its rows are LABELS
       (`subNoWrap`). On report — "don't cap the width if it would lead to line wrapping". Measured:
       "Other feature…" wants 280px and was held to its parent's 148px, wrapping 38 of its 122 rows
       ("Grpa / greater paucal" over two lines). A cap is a tidiness; a wrapped label is not tidy, so
       the tidiness gives way. OPT-IN, because the Wiktionary "Definitions of …" flyout is the opposite
       case and always was: its rows are SENSES, whole clauses in `.mlbl`, and `.ctx-sub.defctx` lets
       them wrap deliberately (see base-chrome.css) — uncapping that one would make a menu as wide as
       the longest definition in the dictionary.
       ⚠ MEASURED BY LAYOUT, NOT BY FONT STRING: clearing the cap lets the flyout shrink-to-fit to its
       MAX-CONTENT width, which is by definition the width at which nothing wraps. The floor below does
       reconstruct row widths from font strings, and that is exactly the sort of measurement this app's
       notes warn about — the two engines disagree about it — so this asks the engine instead.
       Still bounded, at half the window: a flyout that ran off the screen would be a worse answer to
       a long row than a wrapped one. */
    ctx2.style.maxWidth=fit?parentW+"px":"";   // item 3: the parent menu's width is the shrink-to-fit flyout's ceiling (see .ctx-sub.defctx in app.css). Cleared for every other flyout — the property is inline, so a previous .defctx call's ceiling would otherwise stick to the next (non-fit) one. Set BEFORE the layout reads below: both the header floor's clamp (which re-reads it off getComputedStyle, so it needs no separate wiring) and positionSub's offsetWidth depend on it
    if(fit&&noWrap){ ctx2.style.maxWidth="none"; const nat=ctx2.offsetWidth;   // …then re-read at MAX-CONTENT, which is the width at which nothing wraps
      ctx2.style.maxWidth=Math.min(Math.max(nat,parentW),Math.round(innerWidth*0.5))+"px"; }
    if(colSize&&colW){ ctx2.style.width=Math.round(colW)+"px"; ctx2.style.minWidth=""; ctx2.style.height=""; ctx2.style.maxHeight=parentH+"px";
      liftSearch(ctx2);   // item 2: ONE parent column wide, content-height but NO TALLER than the POS menu (maxHeight, not a fixed height)
      liftFootLink();
      return void positionSub(); }
    ctx2.style.width=""; ctx2.style.height="";
    /* ⚠ AND THE PARENT'S HEIGHT BOUNDS THIS ONLY WHERE THE PARENT IS AN ORDINARY MENU — the same
       correction the width cap needed, for the same reason and on the same day: "why does the flyout
       have such a ridiculously small height cap?!". A `.defctx` menu is deliberately small (it fits
       its own content, and the AVM placeholder menu can be two rows), so clamping to it squeezed a
       122-row flyout into 154px of scrolling viewport. Measured: parent 200px → cap 200 → 154 after
       fitWholeRows, against the 420px the flyout is entitled to. The rule below is about a panel not
       outgrowing the MENU it hangs from, which is a statement about ordinary menus; a fitted one is
       not a length to measure anything against. The 420px / 70vh caps still apply to both. */
    const parentCapH=ctx.classList.contains("defctx")?Infinity:ctx.offsetHeight;
    ctx2.style.maxHeight=Math.max(60,Math.min(420,innerHeight*.7,parentCapH))+"px";   // never taller than the parent menu it flies out from, on top of the existing 420px/70vh caps — but never SHORTER than one row needs either: a short parent menu (few items) could otherwise cap this below even the single-row "Loading…"/"Nothing found"/"Couldn't load" placeholder's own height, clipping it before any real content arrives to grow the flyout naturally
    ctx2.style.minWidth="";   // clear any previous call's floor before re-measuring — a later render (e.g. "Loading…" → real senses) must never be held to an EARLIER row's width
    liftFootLink(); liftSearch(ctx2,focusSearch);   // BEFORE the header measurement below, which reads ctx2.offsetWidth — the lift restructures the flyout into a flex column, so measuring first would size the floor against the pre-lift box
    const hdrs=[...ctx2.querySelectorAll(".hdr")].map(h=>h.textContent);   // .hdr rows (gender groupings, "Loading…"/"Nothing found"/"Couldn't load") are position:sticky with a negative margin for their full-bleed background (see .ctx-sub.defctx .hdr) — some engines under-count that combination's contribution to a shrink-to-fit ancestor's width, clipping the header TEXT even though the identical string in a plain (non-sticky) row would fit fine. Sidestep it with a direct floor from the SAME canvas measurement technique acPos() already uses for the autocomplete menu, rather than fight the engine-dependent shrink-to-fit interaction itself.
    // on report ("Add features flyout… make sure there is enough space for the labels to not wrap"): the floor
    // below only ever measured .hdr text, never a row's own .mlbl label — fine for every PRIOR subFit flyout
    // (Wiktionary senses, "Mark as…"), whose rows are short fixed strings, but "Add feature…" is the first
    // subFit flyout with many groups' worth of real content values (UD value names run longer than any header
    // here — "SubjRaising", "Bantu12", …), so the floor a .hdr-only measurement computed could sit narrower
    // than the widest LABEL actually rendered, and nothing here stopped that label wrapping inside its own row.
    const lbls=[...ctx2.querySelectorAll(".mlbl")].map(h=>h.textContent);
    if(hdrs.length||lbls.length){
      const hdrNeed=Math.max(0,...hdrs.map(t=>meas(t,'700 10px '+uiFont())))+26;   // uiFont() (js/core/platform.js) resolves --ui-font to a plain family list — a measurement font string cannot carry a var(), and the hard-coded SF Pro stack this replaced measured the macOS face on Windows, where .hdr actually renders in Segoe   // +26: the container's 12px×2 padding, plus a couple px slack
      const lblNeed=Math.max(0,...lbls.map(t=>meas(t,'510 13px '+uiFont())))+40;   // same technique, the row BUTTON's own font (.ctx button, mac-chrome.css) — +40: the container's 12px×2 inset plus the button's own 7px×2 padding plus its 7px past-inset widening (see .ctx button's own comment) plus a couple px slack
      const need=Math.max(hdrNeed,lblNeed);
      const cap=parseFloat(getComputedStyle(ctx2).maxWidth);   // the .defctx ceiling — now the parent menu's own width, set inline a few lines up (the 320px reading measure in .ctx-sub.defctx is only the fallback); NaN here for any flyout that isn't .defctx, since maxWidth computes to "none"
      if(need>ctx2.offsetWidth) ctx2.style.minWidth=Math.min(need,cap||Infinity)+"px"; }   // CLAMP the floor to that ceiling: min-width beats max-width in CSS, so a header/label long enough to demand more than the cap would silently win and the flyout would grow past the measure the senses themselves are held to. Today's headers (gender names, "Loading…") are ~110px at 700 10px and nowhere near it — the clamp is here so the two can never fight if either number moves
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
  ctx.style.left=Math.max(8,Math.min(left,innerWidth-w-8))+"px"; ctx.style.top=Math.max(menuTopBound(),Math.min(y,innerHeight-h-8))+"px"; }   // menuTopBound (js/core/scroll.js): a bare 8 now — this app no longer offers macOS window tabbing, so there is no native tab bar left for a menu to be drawn under
/* ⚠ A MATRIX HOLDS ITS GROWN SHAPE WHILE ITS OWN MENU IS UP. Reported as the "+" flickering on click, and
   this is the half of that a render count cannot see: the add-feature menu opens BELOW the mark, but
   `showCtx` flips it above where there is no room underneath — and a menu covering the matrix takes the
   pointer off it, so `.avm-box:hover` stops matching, the brackets shrink and the mark fades out from under
   the very menu it opened. `.avm-open` is the same idea the Fluent kit already states for a toolbar button
   ("an OPEN menu keeps the hover fill so the button reads as the flyout's anchor"), one control along.
   Cleared HERE because `closeCtx` is the one funnel every dismissal goes through — Escape, a pick, a click
   outside, or another menu taking over #ctx — exactly as the Format pill's own flag beside it is. Swept by
   class rather than remembered in a variable: the flag lives on a node a re-render may replace, so the only
   honest question at dismissal time is "whatever is wearing this now, take it off". */
function clearAvmOpen(){ document.querySelectorAll(".avm-open").forEach(e=>e.classList.remove("avm-open")); }
function setAvmOpen(el){ const bx=el&&el.closest&&el.closest(".avm-box,.oavm,.avm-add,.oavm-empty"); if(bx) bx.classList.add("avm-open"); }   // …the SVG matrix, the outline's own run, or (item 32) either notation's EMPTY placeholder — `.avm-open` is what holds its "+" up (or its grown bracket) while the menu it opened is still on screen; `clearAvmOpen` sweeps by the class rather than by which notation drew it
function closeCtx(){ ctx.classList.remove("show"); closeSub(); void ctx.offsetHeight; clearAvmOpen();   // same forced-reflow fix as closeSub, for ctx's own backdrop-filter layer
  if(typeof setPillMenuOpen==="function") setPillMenuOpen("fmtPill",false); }   // the Format pill borrows this shared #ctx for its own menu (fmtMenu, js/io/formats.js) and its chevron has to point back UP however the menu was dismissed — Escape, a pick, a click outside, or another menu stealing #ctx. Unconditional and idempotent: for every OTHER #ctx menu the pill is already un-flagged, so clearing it again costs a no-op class toggle. typeof-guarded because this file loads before js/ui/wiring.js, which defines the helper — harmless at runtime (closeCtx only ever runs from a handler, long after both are defined), but the guard is what the codebase's forward-reference rule asks for
/* ⚠ CAPTURE PHASE, AND EXCLUDING THE MENU SYSTEM — the same shape (and the same reason) as the
   contextmenu handler just below. This was a bare bubble-phase `addEventListener("click",closeCtx)`,
   which meant any element that stops click propagation swallowed the dismissal and left the menu
   standing. The translations grid is exactly that: `box.addEventListener("click",e=>e.stopPropagation())`
   (js/io/bridge.js), added so a click inside the grid never falls through to token deselection — so
   opening a context menu and then clicking into a translation field left the menu open on screen.
   Capture runs before any of them, so the dismissal no longer depends on what the click's target
   chooses to do with the event.
   ⚠️ THE EXCLUSION IS REQUIRED, NOT TIDINESS. A row that opens a flyout relies on `e.stopPropagation()`
   to keep its own parent menu alive (makeCtxButton's `it.sub` branch), and capture phase runs BEFORE
   the target — so without this guard every submenu would close the menu it was opening. Nothing is
   lost by excluding the menu itself: an ORDINARY row already calls closeCtx() in its own handler, so
   this listener was never what dismissed a menu on a pick. */
/* ⚠ AND ON `pointerdown` AS WELL AS `click`, BECAUSE A CLICK IS NOT GUARANTEED TO EXIST. Reported as
   "clicking outside the token context menu (or any other context menu) should dismiss it", after the
   capture-phase fix above had already landed — and the capture phase was never the remaining problem.
   A `click` is only dispatched when the press and the release share a target, so any field that
   RE-RENDERS ITSELF on the press dispatches none at all, and a listener waiting for one waits for
   ever. Measured over CDP (real mouse events, headless Chrome), menu open, clicking each target:

     .stext (sentence text)  click fires  → dismissed        toolbar button   click fires → dismissed
     .tg-text (translation)  NO CLICK     → LEFT OPEN        status-bar pill  click fires → dismissed
     .sid-in (sentence id)   NO CLICK     → LEFT OPEN        page background  click fires → dismissed

   Perfectly correlated, and it is why the earlier fix looked complete: every target anyone tried by
   hand happened to be one that dispatches a click. `pointerdown` always fires, is the first event of
   the gesture, and covers touch and pen for nothing.
   ⚠ THE SAME FIX THE DRAWERS ALREADY CARRY — `closeDrawers` (js/ui/wiring.js) is this listener pair,
   for the same reason, written after the same measurement ("a CDP press/release on a token produced
   zero capture-phase click events"). The menus simply never got it. Read that note beside this one;
   the two must not drift, since a reader's click has to dismiss both at once. The `click` listener STAYS beside it — a
   keyboard activation (Enter on a focused control, an assistive click) dispatches a click with no
   pointer event before it, and dropping it would trade one gap for another. closeCtx is idempotent,
   so the two firing in sequence for one ordinary mouse click costs a class removal that has already
   happened.
   ⚠ THE SAME EXCLUSION, FOR THE SAME REASON as the click listener's own, and now it matters twice
   over: a submenu row keeps its parent alive with `e.stopPropagation()`, and on pointerdown that
   would otherwise close the very menu the row is opening a flyout off. */
/* ⚠ AND A `.ctxtrigger` EXCLUDES ITSELF, which is what makes a trigger able to TOGGLE its own menu.
   `#fmtPill` opens its menu in this shared #ctx and decides "already mine, so close" from
   `ctx.classList.contains("show")` (fmtMenu, js/io/formats.js) — but this listener runs first and had
   already closed it, so the second click read the menu as absent and reopened it. The pill never shut.
   ⚠ IT IS NOT A NEW IDEA HERE: #translitPill and #orthoPill have always excluded their own trigger
   from their outside-close (`!e.target.closest("#translitPill")`, js/lang/translit.js) and toggle
   correctly BECAUSE they do. This is that rule, written once for the shared menu rather than named
   pill by pill — a class, so a future trigger opts in by wearing it and context-menu.js goes on
   knowing nothing about which pills exist.
   Clicking the pill while SOMEONE ELSE's menu is open is unaffected: nothing is dismissed here, and
   `fmtMenu` finds a stamp that is not its own and calls showCtx, which replaces the menu outright. */
const ctxDismissOutside=e=>{ if(ctx.contains(e.target)||ctx2.contains(e.target)) return;
  if(e.target&&e.target.closest&&e.target.closest(".ctxtrigger")) return;
  closeCtx(); };
addEventListener("pointerdown",ctxDismissOutside,true);
addEventListener("click",ctxDismissOutside,true);
// item 3: a right-click OUTSIDE an open menu (on a target none of #doc's own contextmenu branches will claim —
// blank canvas, a diagram's own margin, another window region) never dismissed #ctx before: nothing downstream
// of a non-match ever calls closeCtx, so the stale menu just sat there behind whatever the browser's native
// menu showed on top of it. Capture phase, so this runs BEFORE #doc's own (bubble-phase) contextmenu listener —
// closeCtx is unconditional and idempotent, so a right-click that DOES land on a new menu trigger still opens
// it correctly: this closes the old one first, then the matching branch below calls showCtx again and reopens
// fresh at the new target. Global (not #doc-scoped), matching the click-outside rule just above it.
// EXCLUDING a right-click that lands INSIDE the menu system itself (ctx or its ctx2 flyout): a `subRight` row
// (posSubItems' POS-subtype flyout, relMenu's deep-feature flyout) has its OWN bubble-phase oncontextmenu
// handler that opens a SECOND-level flyout off that row, without closing the parent menu. Left unfiltered, this
// capture-phase closeCtx ran first on every such click too, hiding #ctx (display:none) before that handler ever
// read the row's position — so openSub's positionSub() measured an already-collapsed (0×0×0×0) rect for the row
// and the flyout landed at the (8,8) top-left clamp fallback instead of beside it, with the parent menu gone
// entirely underneath it. A right-click that reaches an ordinary #doc target is never inside ctx/ctx2, so this
// exclusion changes nothing for the "closes the stale menu, then reopens fresh" path the comment above describes.
addEventListener("contextmenu",e=>{ if(ctx.contains(e.target)||ctx2.contains(e.target)) return; closeCtx(); },true);
addEventListener("scroll",e=>{ if(e.target===ctx||ctx.contains(e.target)||e.target===ctx2||ctx2.contains(e.target)) return;   // a scroll INSIDE the menu itself (e.g. the Wiktionary "Definitions of …" flyout's own overflow-y:auto list) must not dismiss it — only a scroll of whatever's BEHIND the menu should
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
/* THE POS ROW'S DRAWN ELEMENT, ACROSS THE NOTATIONS — the twin of FORM_SEL below. `.tok-pos` is the arc/tree/
   flat-bracket (and projected-stemma) row belowStack draws, `.node-cat` the stemma's POS-as-node label, `.opos`
   the outline's inline span (its ghost rows carry it too), `.bwpos` the wrapped-bracket span inside `.bwund`.
   Deliberately NOT `.mwt-pos`: that is an ExtPos value under a bracket, a statement about a whole expression,
   and it has its own menu (extPosMenu). ONE selector, read by the right-click resolver (posRelHit), the tap
   resolver (js/diagram/diagram-edit.js) and the inline editor's own element lookup (posElOf) alike — three
   gestures that must agree about what counts as "the POS row" or they will answer on different tokens. */
const POS_SEL=".tok-pos,.node-cat,.opos,.bwpos";
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
/* `clearRow` — {label, fn}, appended last (above the guidelines link, below the free-text field), on request
   ("it should be possible to clear a UPOS or deprel, rather than forcing them to be populated"). A picker of a
   closed vocabulary has no way to say "none of these" on its own: every row SETS a value, and re-picking the
   current one is a documented no-op in both menus, so the only routes to an empty word class or relation were
   the grid's own "(none)" option and its free-text DepRel cell. Callers pass one only when there is something
   to clear (see posMenu/relMenu), so the row never appears on a token that has no value already. */
function optionMenu(x,y,all,cats,expandOf,current,choose,guide,rtl,subFor,customSet,subNote,noteTop,subColSize,freeAdd,clearRow){
  /* ⚠ THE CURRENT VALUE ALWAYS GETS A ROW, even when it is outside the inventory this menu offers — a tag or a
     relation a FILE carries that `SETTINGS.upos`/`SETTINGS.deprel` doesn't list, or one the reader has since
     removed from that inventory. Without this the menu showed no tick at all for a value the token demonstrably
     has, and (once clearing moved onto the ticked row) no ✕ either: the affordance vanished exactly where the
     value was unusual, which is backwards — an unfamiliar tag is MORE likely to want clearing, not less. It
     falls through the categorisation below like any other unplaced option and lands under "Other"/"Custom",
     which is where the grid's own out-of-inventory values already appear. */
  if(current && !all.includes(current)) all=all.concat([current]);
  const placed=new Set(), items=[];
  if(noteTop) items.push({note:noteTop});   // item 2: a leading scope note (e.g. the external-POS menu explaining which span it tags)
  if(subFor) items.push({note:subNote||"Right-click to show available deep features for a relation"});   // the relation menu's deep features and (item 4) the POS menu's UPOS subtypes both hang off a right-click submenu, so each passes its own hint
  let usedClear=false;
  const row=r=>{ const o={label:esc(r), expand:expandOf(r), check:r===current, opt:true, optval:r, fn:()=>choose(r)};
    if(clearRow&&r===current){ o.clearX={title:clearRow.label, fn:clearRow.fn}; usedClear=true; }   // item 29: the ✕ rides the row it unsets
    /* item 29: `subFor` may answer a bare function (the old contract) or {fn, count, weights} — the count is the
       row's numeric badge, the weights the ranking its flyout is faded by. A caller that answers NULL for a row
       says that row has no flyout at all, which is how a tag with no subtypes stops offering an empty one. */
    if(subFor){ const sm=subFor(r), fn=(typeof sm==="function")?sm:(sm&&sm.fn);
      if(fn){ o.subRight=fn; if(subColSize)o.subColSize=true;
        if(sm&&sm.count!=null)o.subCount=sm.count; if(sm&&sm.weights)o.subWeights=sm.weights; } }
    return o; };   // subFor(r) → a submenu builder for that option (relations: deep features), or null. item 3: subColSize → size that flyout to ONE parent column, parent height
  cats.forEach(([name,members])=>{ const present=members.filter(m=>all.includes(m));
    present.forEach(m=>placed.add(m)); if(present.length){ items.push({header:name}); present.forEach(m=>items.push(row(m))); } });
  const extra=all.filter(r=>!placed.has(r));   // any options not covered by a category
  const other=customSet?extra.filter(r=>!customSet.has(r)):extra, custom=customSet?extra.filter(r=>customSet.has(r)):[];   // customSet (relMenu only) → session-added relations get their OWN "Custom" heading instead of "Other"
  if(other.length){ items.push({header:"Other"}); other.forEach(r=>items.push(row(r))); }
  if(custom.length){ items.push({header:"Custom"}); custom.forEach(r=>items.push(row(r))); }
  /* item 29 — CLEARING IS AN ✕ ON THE CHOSEN ROW, not a row of its own, on request ("replace the Clear button
     with an ✕ next to the selected label"). It reads as what it is — the one value the menu has actually SET,
     with the means to unset it attached to it — where a trailing row read as one more option to pick, and it
     leaves the guidelines link the full-width row it always was. Placed by `row()` above on whichever row
     carries the checkmark — and there is ALWAYS one now that an out-of-inventory value gets its own row (see
     the note at the top of this function). The fallback below covers the one case that is genuinely rowless:
     no current value at all, yet something to clear — a token with no word class that still carries a lexical
     SUBTYPE feature, which "Clear word class" drops along with the (absent) tag. */
  if(clearRow&&!usedClear) items.push(null,{label:clearRow.label, fn:clearRow.fn});
  if(freeAdd){ items.push(null,{input:true, value:"", placeholder:freeAdd.placeholder||"New…", commit:freeAdd.commit}); }   // relMenu only: free-text authoring of a genuinely new option, mirroring deepSubItems' own free-text row one level down — same {input:true,...} shape (renderMenu never auto-closes an input row; the commit callback must call closeCtx() itself, same as deepSubItems' setDF does)
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
/* item 29 — …AND THE SAME FADE INSIDE A FLYOUT. weightMenuRows above only ever reached `ctx`, so a subtype /
   deep-feature submenu drew every row at full strength while the parent row it hangs off was faded by the very
   ranking those rows are a breakdown OF — the one place in the menu system where "the model gave this ~0" was
   invisible. Same floor, same gamma, same `data-optval` lookup; the map's keys are whatever the flyout's rows
   set as their optval ("PRON|PronType=Dem" for a subtype, "mod@relcl" for a deep feature), so each caller
   picks a key shape and its own rows match it by construction. `ctx2._wgen` stamps the open the way `ctx._wgen`
   does, so a slow answer for a flyout that has since been closed or reopened elsewhere is dropped rather than
   painted over whatever is on screen now. */
function weightSubRows(p){ if(!p) return;
  const stamp=(ctx2._wgen=(ctx2._wgen||0)+1);
  Promise.resolve(p).then(map=>{ if(!map||!Object.keys(map).length||ctx2._wgen!==stamp||!ctx2.classList.contains("show")) return;
    ctx2.querySelectorAll("button[data-optval]").forEach(b=>{
      const w=OPT_WEIGHT_FLOOR+(1-OPT_WEIGHT_FLOOR)*scoreShade(map[b.dataset.optval]||0);
      b.style.setProperty("--pw",w.toFixed(3)); }); }).catch(()=>{}); }
// right-click a relation label → pick a relation (grouped by role). Each relation's DEEP features live on its OWN
// submenu, reached by right-clicking that relation's row (or clicking its ▸) — replacing the old ⇧-right-click menu.
const DEEP_BY_REL={subj:["expl","pass","caus"],comp:["expl","pass"],"comp:aux":["pass","caus","tense"],"comp:obj":["pass","lvc","agent"],"comp:obl":["agent"],mod:["relcl"],"conj:coord":["emb"],flat:["name","foreign"]};   // taxo_2023: the @deep features each surface relation admits
const DEEP_UNIVERSAL=["scrap"];   // admissible on ANY relation (not tied to a specific one, unlike DEEP_BY_REL) — folded in by deepVocabFor/deepSubItems below
// admissible @deep features for ONE base relation: the taxonomy above ∪ DEEP_UNIVERSAL ∪ any @feature already used
// with that SAME relation elsewhere in the document (mirrors relMenu's dfMap, but single-relation — used by the
// grid's Deep-cell autocomplete, which only ever needs one relation's list per keystroke rather than every candidate's).
// item 29: how many deep-feature rows a relation's flyout would hold — the same union deepSubItems takes, for
// the parent row's badge. The free-text "New deep feature…" field is not counted: it is always there, so a
// count of 0 says truthfully "no admissible features yet" while the flyout still opens to offer one.
function deepSubCount(feats){ return new Set([...(feats||[]),...DEEP_UNIVERSAL]).size; }
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
  allFeats.forEach(f=>items.push({label:"@"+esc(f), expand:DEEP_INFO[f]||"", check:cur===f, opt:true, optval:D+"@"+f, fn:()=>setDF(f)}));   // item 29: optval — the FULL relation this row would write, which is exactly how the parser's own (unpooled) label distribution is keyed, so weightSubRows fades these by the same numbers relWeightsFor pools for the parent row
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
  /* item 29 — ONE ranking, read twice: POOLED to the base relation for the menu's own rows (relWeightsFor,
     which is what makes a row's weight the sum of its flyout's), and UNPOOLED for each row's flyout, whose rows
     ARE the individual `mod@relcl` labels the pooling adds up. Computed once here so both reads share the same
     bridge call rather than racing two. Null (and so unweighted) for a ROOT, which has no incoming arc to
     condition on — see the note on weightMenuRows' call below. */
  const relScores=(typeof tokenScores!=="function")?null:(async()=>{
    const h=parseInt(dep.head,10); if(!(h>=1)) return null;
    const sc=await tokenScores(si);
    return (sc&&sc.deprels&&sc.deprels[tokId-1]&&sc.deprels[tokId-1][String(h)])||await arcLabelScores(si,tokId,h); })();
  const subFor=r=>({fn:()=>deepSubItems(si,tokId,r,dfMap[r]||[]), count:deepSubCount(dfMap[r]||[]), weights:relScores});   // EVERY relation gets a right-click deep-feature submenu (its taxonomy ∪ file features, or just an add-field)
  const choose=d=>{ if(d==="root"&&rb!=="root"){ setAsRoot(si,tokId); return; }   // not yet root → the FULL re-attach (migrates the old root's dependents, demotes it to udep), not a naive head=0 flip
    if(d!==dep.deprel){ pushUndo(si); dep.deprel=d; afterDeprelEdit(dep,s); markDirty(); preserveScroll(renderDoc); } };   // left-click sets the BARE relation — so clicking the current relation drops its @feature (= "(none)"); a feature is set via the row's submenu. Task B: no regenTok — structural, must never trigger a gloss/MGloss recompute
  // free-text authoring of a genuinely NEW base relation (parity with the grid's own DepRel cell, which is
  // unrestricted free text — grid.js's deprelin). Mints the typed value into SETTINGS.deprel on commit, same as
  // the grid does on blur (duplicated rather than factored into a shared helper: grid.js is being edited
  // concurrently by another agent on unrelated MGloss/Translit bugs, and this is a 2-line check), then hands the
  // committed string to `choose` — the SAME function every picker row already calls — so there is exactly one
  // place that writes a token's deprel, not two.
  const commitNewRel=v=>{ closeCtx(); const d=(v||"").trim(); if(!d||d==="_") return;
    if(!SETTINGS.deprel.includes(d)){ SETTINGS.deprel.push(d); SETTINGS.deprel.sort(); }
    choose(d); };
  /* CLEAR THE RELATION — `choose("")`, the same one every row calls, so afterDeprelEdit still runs and the
     goeswith normalisation with it. ⚠ NOT OFFERED ON A ROOT: head 0 ⟺ deprel "root" is an invariant this app
     maintains at every other edit site (afterDeprelEdit itself rewrites the relation back to "root" for a
     head-0 token, and afterHeadEdit does the same in the other direction), so the row would be a visible no-op
     there. Clearing the relation of a token that HAS a head is an ordinary partial annotation — the arc keeps
     its shape and the label shows TIER_EMPTY. */
  const clearRel=(dep.deprel && parseInt(dep.head,10)!==0)?{label:"Clear relation", fn:()=>choose(""), }:null;
  optionMenu(x,y,cands,deprelMenuGroups(cands),deprelExpand,depBase(dep.deprel),choose,guide,sentRTL(s),subFor,
    undefined,undefined,undefined,undefined,{placeholder:"New relation…",commit:commitNewRel},clearRel);   // deprelMenuGroups interleaves any user-added relation into its own family/Other — no separate "Custom" heading needed
  /* …and then fade each row by how likely the parser thinks that relation is FOR THIS EDGE — the arc it
     weighed if this is one it considered, the synthesised state if the reader made the attachment
     themselves. Pooled to the base relation by `relWeightsFor`, which is the same pooling the rows'
     own deep-feature submenus do (`mod@relcl` lives under `mod`), so the two cannot disagree.
     A ROOT has no incoming arc to condition on, so its menu is left unweighted rather than weighted
     against an edge that does not exist. */
  weightMenuRows(relScores&&relScores.then(m=>relWeightsFor(m))); }
// right-click a POS tag → pick a POS (all shown, grouped by class)
/* item 4 — the UD LEXICAL features: the ones that subcategorise the UPOS itself (a SUBTYPE of the tag) rather
   than inflect the word, so a token carrying one is naturally read as a dot-suffixed tag — PRON.Dem, NUM.Ord,
   DET.Poss. universaldependencies.org/u/feat groups exactly these under "Lexical features"; ExtPos, Foreign and
   Typo belong to the same group but get their own commands here (items 1/2/3) and are deliberately left out,
   and SUD's own Shared (FEATS) and Subject/Object (MISC) are bookkeeping, not word classes. Everything else in the FEATS inventory is
   inflectional and belongs on the morphemic-gloss tier, which is where its Leipzig abbreviation already goes.
   item 23: VerbForm joins this set BY EXCEPTION to that last rule — UD itself classes it as an inflectional,
   not a lexical, feature, so on that classification alone it would stay off the tag. It's added anyway, on
   request, alongside PronType/NumType being pulled OUT of the AVM tier at the same time (js/grid/grid.js's
   AVM_EXCLUDE) — the two moves are one decision: those three read as properties of the WORD CLASS a reader
   wants at a glance next to the tag, not as part of the fuller morphological picture the AVM/MGloss tiers are
   for, whatever UD's own filing of the feature says. */
const UPOS_SUBTYPE_FEATS=["PronType","NumType","VerbForm","Poss","Reflex","Abbr"];
// Where each one is actually attested, per its own page at universaldependencies.org/u/feat/* — so a VERB's POS
// menu doesn't offer VERB.Ord. Abbr is unlisted on purpose: any word class can be abbreviated. VerbForm's own
// range (per universaldependencies.org/u/feat/VerbForm.html) is wider than the other four — every non-finite
// form crosses word-class lines by design (a participle is VERB.Part or ADJ.Part depending on the treebank, a
// gerund/verbal noun NOUN.Vnoun) — so its own list is the widest of the set.
const UPOS_SUBTYPE_ON={PronType:["PRON","DET","ADV","ADJ"],NumType:["NUM","DET","ADJ","ADV"],VerbForm:["VERB","AUX","ADJ","NOUN"],Poss:["DET","PRON","ADJ"],Reflex:["PRON","DET"]};
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
/* item 29 — how many subtype rows a tag's flyout would hold, for the parent row's numeric badge. Counted the
   same way posSubItems builds them (its own attested-values narrowing included, so the badge cannot promise
   rows the flyout does not draw) but WITHOUT building any DOM or resolving the token — it is called once per
   row of an open POS menu. 0 → posMenu offers no flyout on that row at all. */
/* ⚠ THE VALUES OF A SUBTYPE, SCOPED TO THE CLASS — reported as "why does the NOUN submenu contain POS
   subtypes that are clearly verbal?", and the answer was that only the FEATURE had ever been scoped.
   `subtypeFeatsFor` asks which features a class may carry (UPOS_SUBTYPE_ON, above); the values then
   came off `attestedFeatVals(f)`, which scans the whole DOCUMENT regardless of word class and falls
   back to UD's entire list when nothing is attested. So NOUN was offered whatever VerbForm values the
   document used on its VERBS — measured, on the dev fixture: NOUN.Fin and NOUN.Inf, while `Vnoun`, the
   one value that IS nominal, was not offered at all. It was never only NOUN: ADJ.Fin/ADJ.Inf, ADJ.Card,
   DET.Frac, DET.Range and ADV.Card all came from the same gap.
   TWO SOURCES, UNIONED, and neither is a guess:
     · SUBTYPE_VALS (js/grid/grid.js) — the cross-linguistic ceiling, derived from the UD validator's own
       permitted-features data by one stated rule. NOUN's VerbForm is Inf/Part/Ger/Vnoun there; `Fin`
       reaches 14 of the 159 languages that permit it at all (8.8 %) and falls below the rule's floor.
     · strictAttestedVals(f,U) — the EVIDENCE, this document's own tokens of that class plus the model's
       own labels for it. A corpus that really does annotate NOUN.Fin says so, and is believed: the
       ceiling is a default for the unknown case, never a veto over what is in front of the reader. */
/* ⚠ AND THE TWO LISTS SPLIT THE SAME WAY THE FEATURE MENU'S DO — "the UPOS submenus should likewise be
   limited to POS-relevant attested options, with a flyout listing the full POS-relevant UD inventory
   with a search bar". So the subtype flyout is now what this DOCUMENT attests for that class, and
   `posSubOtherItems` below is the rest of what UD defines for it. Same division, same reasoning, same
   sentence in the note: what is in use here, then everything else this class can take. */
function subtypeValsAttested(f,U){ const full=UD_FEATS[f]||[]; if(!full.length) return full;
  const ev=(typeof strictAttestedVals==="function"?strictAttestedVals(f,U||null):null)||[];
  return full.filter(v=>ev.indexOf(v)>=0); }   // the EVIDENCE alone — this class's own tokens, plus the model's own labels for it
function subtypeValsCeiling(f,U){ const full=UD_FEATS[f]||[]; if(!full.length) return full;
  const perF=(typeof SUBTYPE_VALS==="object"&&SUBTYPE_VALS)?SUBTYPE_VALS[f]:null;
  return perF?full.filter(v=>(perF[U]||[]).indexOf(v)>=0):full; }   // …and what UD defines for the class (a feature with no per-class narrowing — Poss/Reflex/Abbr, one value — keeps its own list)
function subtypeValsOther(f,U){ const ev=subtypeValsAttested(f,U); return subtypeValsCeiling(f,U).filter(v=>ev.indexOf(v)<0); }
/* item 29 — the badge counts the rows the flyout HOLDS, "Other subtype…" included: it is a row of that
   flyout like any other, and a badge that counted only the values would under-promise a list the
   reader can see. A class with nothing attested still gets a flyout wherever UD gives it something. */
function posSubCount(U){ let n=0,other=0;
  subtypeFeatsFor(U).forEach(f=>{ n+=subtypeValsAttested(f,U).length; other+=subtypeValsOther(f,U).length; });
  return n?n+(other?1:0):other; }   // …and where nothing is attested the flyout IS the other list (posSubItems), so the badge counts THOSE rows
function posSubItems(si,tokId,U){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return null;
  const feats=subtypeFeatsFor(U); if(!feats.length) return null;
  /* ⚠ NOTHING ATTESTED → THIS FLYOUT *IS* THE OTHER LIST, on request ("if there are no attested
     subtypes for a given UPOS, the submenu should directly show the Other state"). A flyout whose only
     row is "Other subtype…" asks the reader to confirm that an empty list is empty; the drill-down is
     worth a gesture only where there is something above it to drill down FROM. No "back" row either —
     there is no attested list to go back to, and offering one would return to the very row that would
     have to send them here again. */
  if(!feats.some(f=>subtypeValsAttested(f,U).length)) return posSubOtherItems(si,tokId,U);
  const curOf=f=>t.upos===U?(getFeat(t.feats,f)||""):"";
  const setSub=(f,v)=>{ closeCtx(); retagSubtype(si,tokId,U,f,v); };   // …the one shared commit (above), which the typed field reaches too — see retagSubtype for why it is not `retagToken` plus a feature
  const items=[];
  // item 18: narrowed to ATTESTED values (attestedFeatVals, js/grid/grid.js) — the same call
  // acValItems/glossAbbrMenu already route through, which this submenu had been left reading
  // straight off UD_FEATS instead of. PronType alone carries 11 official values; a document that
  // only ever uses three of them doesn't need the other eight offered here either.
  // ⚠ SUPERSEDED BY subtypeValsFor (above): document-wide attestation was the wrong question here,
  // because it is blind to the word class the flyout is hanging off. What it was FOR — not reciting
  // eleven PronTypes at a document that uses three — still holds and is still done, one level tighter.
  feats.forEach(f=>{ const cur=curOf(f), vals=subtypeValsAttested(f,U); if(!vals.length) return;   // …and no header over an empty group: a class can now attest nothing for a feature it may carry
    items.push({header:f}); vals.forEach(v=>items.push({label:esc(subtypeSuffix(f,v)), expand:shortVDesc((FEATS_VDESC[f]||{})[v]||""), check:cur===v, opt:true, optval:U+"|"+f+"="+v, fn:()=>setSub(f,v)})); });   // item 29: optval — the CLASS+SUBTYPE pair `upos_sub` is keyed by (app/parse.py's _upos_scores), so weightSubRows can fade these rows by the same distribution the parent row is faded by   // item 3: bare subtype value (the "U." prefix is redundant here) + a SHORT expansion that can't cross the one-column midline
  /* ⚠ …AND THE REST OF WHAT UD GIVES THIS CLASS, ONE ROW DOWN. It REPLACES this flyout rather than
     opening inside it, and that is forced rather than chosen: there is exactly ONE flyout layer
     (`ctx2`), so a `sub:` row here would have to rebuild the element it lives in. Reopening off the
     SAME owner — the POS row in the parent menu, remembered as `ctx2._owner`, at the size remembered
     as `ctx2._colSize` — lands the new list exactly where the old one was, with the POS menu still
     standing behind it. `keepOpen` is what stops the row's own click closing that menu first.
     A "Back" row returns, so the drill-down is not a one-way door. */
  const other=posSubOtherItems(si,tokId,U);
  if(other.length){ if(items.length) items.push(null);
    items.push({label:"Other Subtype…", keepOpen:true, fn:()=>{ const owner=ctx2._owner, cs=ctx2._colSize;
      if(owner) openSub(owner,()=>posSubOtherItems(si,tokId,U,true),false,cs,false,true); }}); }
  // item 3 — the guidelines link for the subtype the token CURRENTLY carries, pinned STICKY to the flyout bottom (no clear button — a plain-tag pick from the parent menu already clears the subtype)
  let setF=null,setV=""; feats.forEach(f=>{ const v=curOf(f); if(v){ setF=f; setV=v; } });
  if(setF) items.push(null,{label:`Guidelines for “${esc(subtypeSuffix(setF,setV))}”`, kbd:"↗", footLink:true, fn:()=>openExternal(featGuideUrl(setF,setV))});   // item 1: the leading `null` CLOSES the last category group so the link lands at the flyout's TOP LEVEL; footLink → openSub lifts it into a FIXED footer (never scrolls), styled as an ordinary .ctx button exactly like the parent menu's guidelines row
  return items; }
/* The full POS-relevant UD inventory for one class, less whatever the attested flyout already carries —
   the subtype analogue of `otherFeatureItems`, and the same division of the same inventory: what this
   document uses for the class, then everything else UD defines for it. "POS-relevant" is SUBTYPE_VALS
   (js/grid/grid.js), so this is not a way back to NOUN.Fin — it is the way to NOUN.Vnoun in a document
   that has never used it. `back` adds the row that returns to the attested list. */
function posSubOtherItems(si,tokId,U,back){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return [];
  const feats=subtypeFeatsFor(U); if(!feats.length) return [];
  const setSub=(f,v)=>{ closeCtx(); retagSubtype(si,tokId,U,f,v); };   // …the SAME commit posSubItems makes, and now literally the same function
  const items=[];
  feats.forEach(f=>{ const vals=subtypeValsOther(f,U); if(!vals.length) return;
    const cur=t.upos===U?(getFeat(t.feats,f)||""):"";
    items.push({header:f});
    vals.forEach(v=>items.push({label:esc(subtypeSuffix(f,v)), expand:shortVDesc((FEATS_VDESC[f]||{})[v]||""), check:cur===v, opt:true, optval:U+"|"+f+"="+v, fn:()=>setSub(f,v)})); });
  /* ⚠ THE WAY BACK GOES LAST, because renderMenu puts it there whatever this list says: a row that
     precedes the first `header` belongs to no group, and every groupless row is collected into the
     TAIL and appended after the groups. Pushed at the front it still rendered at the bottom — with its
     own separator below it rather than above, which is the only part a reader would have noticed. So
     it is written where it lands, and the separator reads correctly. */
  if(back&&items.length) items.push(null,{label:"‹ Attested Subtypes", keepOpen:true, fn:()=>{ const owner=ctx2._owner, cs=ctx2._colSize;
    if(owner) openSub(owner,()=>posSubItems(si,tokId,U),false,cs,false,true); }});
  return items; }
/* ── THE RETAG, IN ONE PLACE ───────────────────────────────────────────────────────────────────────
   Every consequence of setting a token's word class from the DIAGRAM, in the order they have to run.
   It was `posMenu`'s own `choose` until the POS row became typeable as well: two gestures that set the
   same column had to stop being two copies of this sequence, or a tag typed into the inline field would
   quietly mean something different from the identical tag picked off the menu — and the difference would
   be invisible, since both write `upos` correctly and only the SIX passes hanging off it would diverge.
   The order is load-bearing and is argued at each step in `docs/notes/editing.md`:
     · the FEATS cleanup runs AT the retag, so the background re-parse below is handed the CLEANED column
       as its `prior_feats` and never sees the feature the new class contradicts;
     · `inheritAnnotationForUpos` sits AFTER `featsSyncGloss` (an inherited MGloss is already correct for
       the inherited FEATS — a sync keyed on `before` would retarget a value that never held them) and
       BEFORE `regenTok` (so the inherited column travels to the parser as the annotator's own);
     · `uposSyncTranslit` goes before `regenTok`, whose own translit pass is reached on only one path.
   The GUARD is part of the funnel too: a commit that neither moves the tag nor drops a subtype does
   NOTHING AT ALL — no undo entry, no re-render, no re-parse — which is what makes re-picking (or
   re-typing) the current tag the documented no-op both gestures promise.
   ⚠ opts.snapshot===false → THE CALLER HAS ALREADY SNAPSHOTTED THIS GESTURE. The inline field
   (editPosInline below) rides makeEditable's own undo entry, taken the moment the field opened; a
   `pushUndo` here as well would leave TWO entries describing one retag and ⌘Z would need two presses to
   get back. Same division the grid's UPOS cell already makes — `commitCell` owns its `pendingSnap` and
   runs these steps inside it. Everything else about the two paths is identical, deliberately.
   Returns true when it actually changed something. */
/* ⚠ SETTING A CLASS **AND** A SUBTYPE IS ITS OWN COMMIT, and this is the one copy of it. Factored out of
   `posSubItems`/`posSubOtherItems`'s own `setSub` when the typed word-class field learnt to accept
   `PRON.Dem` (on request, "the POS input field should also show POS subtypes") — three call sites setting a
   dot-suffixed tag three ways is exactly how the flyout and the field would come to mean different things.
   ⚠ IT IS NOT `retagToken` PLUS A FEATURE, and must not become that: `retagToken` ends in `regenTok`, and a
   re-parse would re-derive FEATS over the very subtype just chosen (item 10's own note on this line). A
   subtype is a FEATURE edit that happens to carry a class with it, so it commits like the feature edits
   around it — no reparse — while a bare tag keeps the full retag cascade.
   `feats` is the whole subtype set for the class, so picking PRON.Dem drops a stale PRON.Int rather than
   leaving the token claiming both. */
function retagSubtype(si,tokId,U,f,v,opts){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return false;
  const feats=subtypeFeatsFor(U), before=t.feats, gained=!!U&&t.upos!==U;
  if(!(opts&&opts.snapshot===false)) pushUndo(si);   // …`snapshot:false` for a caller riding its own undo entry (the typed field, through makeEditable) — the same division `retagToken` makes, and without it one commit cost the reader two ⌘Z
  if(t.upos!==U){ t.upos=U; clearFeatsForUpos(t); }   // a tag change drops what the new class cannot carry
  feats.forEach(o=>{ if(o!==f) t.feats=clearFeat(t.feats,o); });
  t.feats=(f&&v)?setFeat(t.feats,f,v):t.feats;
  syncXposMirror(t);                                  // covers both halves: the class and the subtype FEATS
  featsSyncGloss(t,before);
  if(gained) inheritAnnotationForUpos(si,tokId);      // …AFTER featsSyncGloss — see posSubItems' own note on the order
  markDirty(); preserveScroll(renderDoc); return true; }
/* Every dot-suffixed tag a class can wear, as the field's own vocabulary: `{label:"PRON.Dem", feat, val}`.
   The CEILING (what UD defines for the class), not only what this document attests — the flyout splits those
   two because it is a menu you read, and this is a field you type into, where a completion that refuses a
   real UD tag because nobody has used it yet is just a wrong answer. Title-case values, matching the menu's
   own spelling; the ROW paints them uppercase (posDisp) and the guard folds case anyway. */
function subtypeOptionsFor(U){ const out=[];
  if(!U) return out;
  subtypeFeatsFor(U).forEach(f=>{ (subtypeValsCeiling(f,U)||[]).forEach(v=>{
    out.push({label:U+"."+subtypeSuffix(f,v), feat:f, val:v}); }); });
  return out; }
function retagToken(si,tokId,p,opts){ const s=DOC[si], tok=s&&s.tokens[tokId-1]; if(!tok) return false;
  const posChanged=p!==tok.upos, hadSub=UPOS_SUBTYPE_FEATS.some(f=>getFeat(tok.feats,f));
  if(!posChanged&&!hadSub) return false;   // same tag, no subtype to drop → nothing to do
  const before=tok.feats, oldUpos=tok.upos;
  if(!(opts&&opts.snapshot===false)) pushUndo(si);
  tok.upos=p; syncXposMirror(tok); clearFeatsForUpos(tok);   // item 1: a tag change drops what the new class cannot carry — a now-meaningless Subj, and every feature the UD tables do not put on this class
  UPOS_SUBTYPE_FEATS.forEach(f=>tok.feats=clearFeat(tok.feats,f));   // item 6: setting a PLAIN tag clears any dot-suffixed subtype
  featsSyncGloss(tok,before);
  if(posChanged) uposSyncGloss(tok,oldUpos);   // Task B: retarget the closed-class gloss prefix IN PLACE, immediately — never a wholesale MGloss rebuild (see uposSyncGloss's own note, js/io/bridge.js)
  /* …and a token that has just GAINED a class inherits the FEATS and glosses this word was last
     given under it (inheritAnnotationForUpos, js/io/bridge.js). `posChanged && p` is the gate the
     request names: never on the same-tag/clear-the-subtype path the guard above already distinguishes,
     and never on "Clear word class" — `p===""`, where there is no class to have been seen under
     (the typed field reaches that same state by clearing the input). Inside the caller's undo entry,
     so ⌘Z takes the retag and what it brought with it as ONE step, and BEFORE the regenTok below,
     whose `prior_feats` then carries the inherited column to the parser as the annotator's own. */
  if(posChanged&&p) inheritAnnotationForUpos(si,tokId);
  markDirty(); preserveScroll(renderDoc);
  if(posChanged) uposSyncTranslit(si,tokId);   // the romanisation and script glyph are asked for a form AS a part of speech, so a retag makes both stale — refreshed HERE rather than left to regenTok below, which reaches its own translit pass on only one of its paths (no model / a misaligned re-parse skip it entirely). BEFORE regenTok so the fast language-driven refresh lands first, exactly as afterFormEdit orders the same two; regenTok's trailing pass then finds every value current and rewrites what is already there
  if(posChanged) regenTok(si,tokId,{regloss:true});   // regloss: the re-parse re-derives the FEATS for the chosen class, so the MGloss has to gain the categories that class brought with it and not merely lose the old one's (mglossFillFromFeats, js/io/bridge.js) — uposSyncGloss above has already moved the AUX/DET prefix, which is the one piece UPOS drives on its own.   // only a genuine POS change reparses; a same-tag "clear subtype" must not (item 10)
  return true; }
// right-click a POS tag → pick a UPOS (all shown, grouped by class). With opts.ext it is the SAME menu, only
// SCOPED to the external POS of a multi-token expression (item 2): the chosen tag lands in ExtPos on the head
// of the selection, not in UPOS, and NOUN/VERB/… are all offered (ExtPos may be any word class).
function posMenu(x,y,si,tokId,opts){ opts=opts||{}; const s=DOC[si]; if(!s)return; const rtl=sentRTL(s);
  if(opts.ext){
    const target=extPosTarget(si,tokId), t=s.tokens[target-1]; if(!t)return;
    const cur=extPosOf(t), sp=subtreeSpan(s,target);
    const choose=P=>{ const nv=(P===cur)?"":P; const before=t.feats; pushUndo(si);   // re-picking the current tag clears ExtPos (toggle) — the menu's way to remove it
      t.feats=nv?setFeat(t.feats,"ExtPos",nv):clearFeat(t.feats,"ExtPos");
      syncXposMirror(t);
      featsSyncGloss(t,before); markDirty(); preserveScroll(renderDoc); };   // items 3/10: feature edit only, re-renders at once, no reparse
    const guide=[`Open the guidelines for the “ExtPos” feature`,"↗",()=>openExternal(featGuideUrl("ExtPos"))];
    optionMenu(x,y,SETTINGS.upos.slice(),UPOS_CATS,r=>UPOS_INFO[r]||"",cur,choose,guide,rtl,null,null,null,
      `External POS of tokens ${sp.from}–${sp.to} — the whole expression`);   // a single line whose width sits BETWEEN one and two POS columns (like the guidelines link) — never wraps
    return; }
  const tok=s.tokens[tokId-1]; if(!tok)return;
  const guide=tok.upos?[`Open the guidelines for the “${esc(tok.upos)}” part of speech`,"↗",()=>openExternal(posGuideUrl(tok.upos))]:null;   // item 29: NO LINK FOR AN UNTAGGED TOKEN, on request — there is no page for the empty class, and posGuideUrl("") would send the reader to the guidelines' front door as though it answered their click
  /* item 29 — the joint CLASS+SUBTYPE distribution behind each row's flyout (`upos_sub`, app/parse.py), asked
     for once and shared by every row: the flyout's rows are the very labels this row's own weight is the sum
     of, so fading them by it is the same statement one level down. */
  const posSubW=(typeof tokenScores!=="function")?null:(async()=>{
    const sc=await tokenScores(si); return (sc&&sc.upos_sub&&sc.upos_sub[tokId-1])||null; })();
  const subFor=U=>{ const n=posSubCount(U); return n?{fn:()=>posSubItems(si,tokId,U), count:n, weights:posSubW}:null; };   // item 4: every tag with subtypes gets a right-click submenu of them (item 29: and a badge saying how many; a tag with none no longer offers an empty flyout)
  const choose=p=>retagToken(si,tokId,p);   // …the SHARED funnel above, never a second copy of it: the typed POS field (editPosInline) commits through the very same call, so a retag cannot mean one thing when picked and another when typed
  /* CLEAR THE WORD CLASS — `choose("")`, the very function every tag row calls, so clearing goes down the one
     path that already knows what a retag entails (drop the dot-suffix subtypes, re-sync XPOS where it mirrors,
     drop a Subject that only a VERB/AUX can carry, retarget the closed-class gloss prefix, re-ask the parser for
     the fields that follow from the class). An untagged token is what the diagram now DRAWS — TIER_EMPTY in the
     POS row — rather than something the file cannot say: UPOS is `_` in CoNLL-U like any other column. Offered
     only when there IS a tag (or a subtype hanging off one), so the row never appears with nothing to do. */
  const clearPos=(tok.upos||UPOS_SUBTYPE_FEATS.some(f=>getFeat(tok.feats,f)))?{label:"Clear word class", fn:()=>choose("")}:null;
  optionMenu(x,y,SETTINGS.upos.slice(),UPOS_CATS,r=>UPOS_INFO[r]||"",tok.upos,choose,guide,rtl,subFor,null,
    "Right-click a tag for its subtypes (PRON.Dem, NUM.Ord, …)",null,true,null,clearPos);   // subColSize=true → the subtype flyout is one POS column wide and as tall as the POS menu (item 3)
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
/* …and CLEAR HEAD, in the same group as the two that step through candidate heads — this is the third thing
   you can do to a token's attachment, and it belongs beside them rather than in the relation menu (which is
   opened on the EDGE, and whose own Clear row is about the label). It detaches AND clears the relation, for the
   reason clearHead's own note gives: a relation describes an edge. Offered only when there is a head to clear,
   the root's `0` included — a sentence with no root yet is an ordinary intermediate state, and `_` is what the
   file writes for either column. */
function headItems(si,tokId){ const t=DOC[si]&&DOC[si].tokens[tokId-1];
  return [["Select previous head","⌃⌘[",()=>stepHead(si,tokId,-1)],["Select next head","⌃⌘]",()=>stepHead(si,tokId,1)],
    ...((t&&(t.head||"").length)?[["Clear head",null,()=>clearHead(si,tokId)]]:[])]; }
// right-click a node → edit/split-or-merge/move/insert/re-attach/set-root/delete this token (order:
// Edit, Split/Merge, Move, Insert, Select head, Set as root, Delete)
function nodeTokenMenu(x,y,si,tokId){ const s=DOC[si]; if(!s)return; const rtl=sentRTL(s);
  // SPLITTING AND MERGING ARE ONE BLOCK, RIGHT AFTER EDIT — Split/Flatten/Ungroup (mwtTokenItems) and
  // the conditional Group/Merge pair all answer the same question ("how many tokens does this
  // orthographic word span"), so they sit together immediately below the Edit rows rather than
  // scattered the way Move/Insert/Select-head are (mwtTokenItems used to sit after all three of
  // those, and Group/Merge were unshifted all the way past Edit to the very top — the MWT tie's own
  // menu, a few hundred lines up, already puts "Edit surface form" directly above its Flatten/Ungroup
  // pair; this is the diagram node's menu catching up to that same order).
  const combineItems=[...mwtTokenItems(si,tokId)];
  if(selRange&&selRange.s===si&&selRange.to>selRange.from&&tokId>=selRange.from&&tokId<=selRange.to&&!rangeIsMWT(si,selRange.from,selRange.to)){
    if(mergeIsSolid(s,selRange.from,selRange.to)) combineItems.unshift([`Merge ${selRange.from}–${selRange.to} into one token`,"⌃⌘M",()=>mergeTokens(si,selRange.from,selRange.to)]);   // only a run written with no space in it, in any language (see mergeTokens' own note); under Group, and deliberately: grouping keeps the tokens, merging destroys them, so the reversible one is offered first
    combineItems.unshift([`Group ${selRange.from}–${selRange.to} as MWT`,"⌘G",()=>addMWT(si,selRange.from,selRange.to)]); }
  const items=[
    ["Edit token","↩",()=>editNodeInline(si,tokId)],
    ["Edit lemma…","⌘L",()=>editLemmaAt(si,tokId)],   // the accelerator is named now that ⌘L is the ONLY gesture besides this row — the double-click that used to open it is gone   // item 4: the same editor a double-click on the token opens — that gesture has nothing on screen to advertise it, so the command needs a menu row of its own. Ellipsis, unlike "Edit token" above: this one opens a popover rather than editing in place, which is what the ellipsis means on macOS
    // set/edit MISC CorrectForm independent of Typo (parity fix): omitted on a goeswith head, mirroring
    // correctFormShown's own exclusion there (diagram-core.js) — that token's CorrectForm means something else
    // structurally (the joined halves, already shown by the slur) and is never drawn as a correction.
    // isGwHeadId, NOT gwOf(s.tokens[tokId-1]): gwOf reads t._gw, which only the display-fold transform sets on
    // its OWN copies of the tokens (diagram-core.js's own note on gwOf/isGwHeadId) — s.tokens[tokId-1] here is
    // the RAW DOC token, which never carries _gw, so gwOf on it is always [] and the row would never be hidden.
    // isGwHeadId(s,id) is the raw-token equivalent (the same one the grid's own formDeco call uses for this).
    ...(isGwHeadId(s,tokId)?[]:[["Edit correct form…",null,()=>editCorrectFormPrompt(si,tokId)]]),
    // on request: Mark as…/Set as root/Paragraph starts here moved up to sit right after the Edit rows —
    // properties of the TOKEN ITSELF (its marks, its root-ness, its paragraph boundary), read before the
    // structural commands (Split/Merge, Move, Insert, Select head) below. "Add feature…" is dropped from
    // this menu outright, not moved — the AVM's own "+" placeholder is the entry point for that now.
    null, ...markFeatRow(si,tokId),
    ["Set as root","⌃⌘R",()=>setAsRoot(si,tokId)],
    // item 2 of the parity fix: MISC NewPar=Yes, matching the grid's own tokenMenu row (same label/shortcut/
    // checkmark, same shared toggleTokNewPar) — grouped with Set as root exactly as the grid groups it.
    {label:"Paragraph starts here", kbd:"⌥⇧⌘P", check:isNewParTok(s.tokens[tokId-1]), fn:()=>toggleTokNewPar(si,tokId)},
    null, ...combineItems,
    null, ...moveItems(si,tokId,false),
    null, ...insertItems(si,tokId,false),
    null, ...headItems(si,tokId),
    null, ["Delete token","⌘⌫",()=>deleteToken(si,tokId-1),true],
  ];
  const rdRow=(typeof readingsMenuItem==="function")?readingsMenuItem(si,tokId,()=>nodeTokenMenu(x,y,si,tokId)):null;   // CJK heteronyms (js/lang/readings.js) — null unless this language has alternative readings AND this token actually has more than one
  if(rdRow){ items.unshift(null); items.unshift(rdRow); }
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
    syncXposMirror(t);
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
  syncXposMirror(t);
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
  const posEl=relEl?null:target.closest(POS_SEL);
  /* item 29 — …AND THE EDGE ITSELF, on request ("right-clicking a dependency edge with no relation should bring
     up the deprel context menu"). It is the only way in once the label is gone: an EMPTY relation draws no label
     at all (that is the settled behaviour — see diagram-rendering.md), so there was nothing left to right-click.
     Offered on every edge, not only the unlabelled ones: the arc is a far bigger target than its label, and it
     means the same thing. `.edge-g`/`.arc` are the groups every notation puts an edge in, each already carrying
     `data-s`/`data-dep` for the DEPENDENT — which is the token a relation belongs to, and exactly what
     tokFromEl reads. `.ghost-g` is deliberately not in the list: a ghost duplicates an attachment the diagram
     draws elsewhere and names no edge of its own. Checked last, so a click that lands on a label or a POS tag
     inside one of these groups still resolves to that. */
  const edgeEl=(relEl||posEl)?null:(target.closest(".edge-g,.arc"));
  return (relEl||posEl||edgeEl)?{relEl:relEl||edgeEl,posEl}:null; }
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
   Values are NARROWED TO WHAT'S ATTESTED (attestedFeatVals, js/grid/grid.js) — already used somewhere
   in this document, or in the active model's own emitted-label inventory (MODEL_FEATS_INVENTORY) —
   before being listed in the CONVENTIONAL ORDER of the feature's own category (UD_FEATS, js/grid/grid.js)
   rather than alphabetically — Sing before Plur, Nom before Acc — with anything only the custom map knows trailing after (never narrowed: a mapping the
   reader hand-added in Gloss Mappings is offered unconditionally, the whole point of adding one); each
   row shows the value's gloss (FEATS_VDESC) beside its abbreviation, and the current one carries the tick.
   MORPHEMIC TIER ONLY. The lexical Gloss tier renders abbreviation runs the same way, but a Gloss is a
   word's MEANING and its capitals are not a paradigm slot — there is nothing there for a list of
   alternative values to be alternatives to. */
function glossAbbrMenu(x,y,si,tokId,idx,ab){
  const s=DOC[si]; if(!s) return false; const t=s.tokens[tokId-1]; if(!t) return false;
  const feat=(typeof mglossFeatNameFor==="function")?mglossFeatNameFor(ab,t.upos):null; if(!feat) return false;
  const seen=new Set(), rows=[];
  const add=v=>{ if(!v||seen.has(v))return; const a=EFF_FEATS_GLOSS[feat+"="+v]; if(!a)return; seen.add(v); rows.push({v,ab:a}); };
  ((typeof attestedFeatVals==="function"&&attestedFeatVals(feat))||[]).forEach(add);                // attested-first, UD's canonical order otherwise (see attestedFeatVals, js/grid/grid.js) — never an unfiltered "everything UD defines"…
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
  syncXposMirror(t);
  markDirty(); preserveScroll(renderDoc); }
/* ── item 22/23: AN AVM ROW'S OWN MENU — the SAME gesture as glossAbbrMenu just above, and the same "narrowed
   to attested, UD's own order" source (attestedFeatVals, js/grid/grid.js) — but the AVM IS FEATS (avmStruct),
   so there is no abbreviation-vs-Feat=Val translation step glossAbbrMenu needs: a standalone row already
   names its own feature, and every candidate is UD's own value spelling, not a Leipzig gloss. Picking one
   writes straight to FEATS via avmSetFeat, the same call a hand-typed FEATS-grid edit makes. A one-value
   feature (Poss=Yes) still offers no alternative — same "nothing to be an alternative to" judgement
   glossAbbrMenu makes — but, unlike that menu, IS still worth opening here: an AVM row has no OTHER edit
   gesture (no text field under it to type into), so a single "clear this feature" option is offered instead
   of declining outright.
   item 23: `key` names a REAL feature for a standalone row, but a combined AGR/TAM row's own data-feat is
   its GROUP name instead (avmLayout, js/diagram/diagram-core.js) — AVM_GROUPS[key] (js/grid/grid.js) is exactly how avmStruct itself tells
   the two apart, so the same test here dispatches to whichever this call actually is. A combined row's menu
   is the SAME picker repeated once per feature the token currently has SET within that group (Person's own
   header + values, then Number's, …) — one flat multi-section list, not a second level of submenu — so
   "3.Sing.Fem" stays a single fused DISPLAY value while every one of the features fused into it is still
   independently, fully editable.
   ⚠ EVERY BLOCK BELOW IS BUILT BY avmFeatBlockItems, shared with addFeatureItems' own "+" menu (just past
   strictAttestedVals, further down this file) — see that function's own docstring for why, and for the
   samples/english.conllu trace that confirms the two menus really did diverge before this was one function. */
function avmValueMenu(x,y,si,tokId,key){
  const s=DOC[si]; if(!s) return false; const t=s.tokens[tokId-1]; if(!t) return false;
  const members=(typeof AVM_GROUPS==="object"&&AVM_GROUPS[key])?AVM_GROUPS[key].filter(f=>getFeat(t.feats,f)!=null):[key];
  const items=[];
  /* ⚠ THE MODIFIER IS ANNOUNCED, because a gesture nothing on screen names is one nobody discovers and
     everybody triggers by accident — the same reasoning that removed the double-tap lemma gesture
     (js/diagram/diagram-edit.js). One hint for the whole menu rather than one per feature block: renderMenu
     pins a `note` above the groups, so it reads as a statement about the menu, which is what it is. Added
     only where there are value rows for it to be about.
     ⚠ KEPT SHORT, on report ("the help text stretches the menu horizontally"): `.ctx .note` only gets its
     width CAPPED to the group width in the two-column layout (renderMenu's own note, further down this
     file) — an ordinary single-column feature menu (almost every one of these: a handful of AGR/TAM values)
     has nothing capping it, so a long note simply widened the whole menu to keep itself on one line rather
     than wrapping under `white-space:normal`. The full "(UD writes those Feat=A,B)" aside explained the
     SERIALIZATION, not the gesture, and was the part doing that — dropped rather than kept and wrapped, so
     the fix is the row this note actually needs to be, not a second capping mechanism for one hint.
     addFeatureItems' own "+" menu owns an IDENTICAL closure rather than sharing this one (see its own build())
     — one instance per MENU, not one for the whole file, is the actual requirement ("at most once per menu"),
     and the two menus are never open at the same time to have shared state be worth the coupling. */
  let hinted=false;
  const hintCombine=()=>{ if(hinted) return; hinted=true;
    items.push({note:"⌘-click to combine values"}); };
  // A standalone or group row only ever reaches THIS menu already SET — `members` is built from getFeat!=null
  // for a group, and a standalone row simply has no `.avm-row` to right-click otherwise (avmMenuAt, further
  // down) — so avmFeatBlockItems' `set` branch is the only one this call site ever exercises; `null` for
  // `notSetVals` is never actually invoked, it is there only because the shared signature also has to serve
  // addFeatureItems' unset case. `drill:false` because this menu is always the top-level ctx (see the item
  // 22/23 docstring above) and so can always give "Other <feat>…" a real `sub:` of its own.
  members.forEach(feat=>items.push(...avmFeatBlockItems(si,tokId,t,feat,hintCombine,false,null)));
  /* …and the row menu can also ADD a feature this token doesn't carry yet, on request ("right-clicking in a
     nonempty AVM should also allow for adding features"). Exactly the row the token menu already offers
     (addFeatureRow, just below) — reused rather than rebuilt, so the two gestures can only ever offer the same
     candidates through the same avmSetFeat write. It sits last, after every existing feature's own block, and
     the whole point of the flyout is that it is ONE level deep: this menu is the top-level ctx, so its `sub`
     opens in ctx2 exactly as the token menu's does. Omitted (with its separator) when there is nothing left to
     add, same guard addFeatureRow itself applies. */
  const addRow=addFeatureRow(si,tokId);
  if(addRow.length){ if(items.length) items.push(null); items.push(addRow[0]); }
  if(!items.length) return false;
  showCtx(x,y,items, items.length>12, sentRTL(s), true);   // fit → shrink to the widest row (.ctx.defctx, same mechanism the status-bar Format menu uses): AVM feature/value labels ("Sing"/"Plur"/"Fem"…) are short, and the shared 224px floor left visible empty space on the right of a typical few-row menu. Safe with the twoCol branch too — a >12-item combined AGR/TAM group's two columns are already sized off their own widest row (renderMenu's twocolwrap), so the floor was never doing useful work there either
  return true; }
/* ── ONE PER-FEATURE AVM BLOCK — extracted this session out of avmValueMenu (just above) and addFeatureItems
   (further down, past strictAttestedVals), which had drifted into near-duplicates of exactly this shape: on
   report ("clicking the + on a plural-marked noun should show the same menu that right-clicking the Plural
   value does"), the "+" menu (addFeatureItems' own build()) turned out to EXCLUDE every feature already set
   on the token (`getFeat(t.feats,f)==null` in its `cands` filter, since fixed just below on this same feature),
   so an already-set feature had no block there at all, however the reader reached it. And even where the two
   copies DID cover the same feature, they had already needed the identical fix made twice, independently, in
   this same session — the {rule:true}-belongs-below-Other/Clear placement, marked SUPERSEDED/SUPERSEDED AGAIN
   on addFeatureItems' predecessor code — which is exactly the "a second copy of a rule drifts" failure mode
   this extraction exists to close off: there is now exactly one place that decides what a feature's own block
   looks like, so the two menus cannot show different content for the same feature on the same token again.

   `cur=getFeat(t.feats,feat)` is the one branch point, and it is a fact about the TOKEN, not about which entry
   point is asking — "is this feature set" is the same question whether a right-click landed on an existing
   row or a "+" click walked the candidate list.
     SET (cur!=null): values come from attestedFeatVals(feat) — DOC-WIDE, never UPOS-scoped — exactly what
     this block already used back when it lived inside avmValueMenu alone. "The '+' menu should show the same
     menu right-click shows" is a claim about a SET feature (a right-click only ever lands on a row that
     already exists), so honouring it means the SAME sourcing, not a UPOS-narrowed one. Traced against
     samples/english.conllu to confirm this actually matters here, not just in the abstract: Number is
     Sing/Plur either way on NOUN specifically (both attested for that class, so a NOUN alone wouldn't have
     shown the bug) — but ADJ, AUX and DET each attest ONLY Sing for Number in that same file. An ADJ token
     already carrying Number=Sing, sourced through strictAttestedVals("Number","ADJ") the way addFeatureItems
     used to source every row regardless of whether the feature was set, would offer Sing alone as its
     "alternative" — silently hiding the Plur a right-click on that very AVM row already offers. Rows get a
     checkmark against the current value(s), ⌘/Ctrl-click COMBINES a value in rather than replacing
     (avmToggleFeat — see the note above featValList, js/grid/grid.js, for why UD allows a feature to carry
     several values at once), and "Clear <feat>" is offered. Value rows are only drawn when there's more than
     one candidate (vals.length>1): re-picking a feature's only possible value is a no-op, avmSetFeat returns
     early when next===t.feats.
     NOT SET (cur==null): values come from `notSetVals(feat)` — the caller's own UPOS-scoped
     strictAttestedVals, or its untagged/fresh-document fallbacks — UNCHANGED, because "which features a word
     class could plausibly take at all" is a real, deliberately narrower question this block does not
     relitigate (CLAUDE.md: an honest blank beats an invented feature set; see strictAttestedVals' own note,
     just below). Rows are plain — no checkmark (there is no current value to check against), no ⌘-click
     combine, no Clear (nothing yet to clear) — every row is a first-time avmSetFeat write, and EVERY candidate
     value is shown regardless of count: picking a word class's one attested value is a real state change, not
     the no-op a re-pick would be. That is the one place this function still asks "is this set" beyond `cur`
     itself, and it is a genuine semantic difference (a fresh pick vs. a no-op re-pick), not a leftover
     per-caller branch — verified by reading avmToggleFeat's own definition (js/grid/grid.js): toggling a value
     ON when nothing was set before works fine on its own terms (`have` starts `[]`, `next` becomes `[val]`),
     so nothing WOULD break by letting an unset feature combine too — it is withheld anyway, because "the '+'
     menu should show the same menu right-click shows" is a claim about a feature right-click can reach at
     all (a SET one), and offering more than that for a feature nothing has attested yet is exactly the
     over-offering the silence-is-the-preferred-failure rule warns against, not a gap this task asked to close.
   `hintCombine` is a caller-owned closure — one "⌘-click to combine values" note per MENU, not per feature —
   so avmValueMenu's own multi-feature group (Person then Number, one flat list) and addFeatureItems' own
   multi-feature candidate list can each still show it at most once, in front of whichever feature's block
   first has more than one alternative.
   `drill` decides how "Other <feat>…" opens: a real `sub:` when this block is rendered top-level (avmValueMenu
   always passes false; so does addFeatureItems when avmAddMenu is the one rendering it) or `reopenFeatSub`
   when addFeatureItems is already living inside the token menu's own "Add Feature…" flyout (see
   addFeatureItems' own note, further down, on why one flag answers this at every depth). "Clear <feat>" needs
   no such fork: it is a plain committing row with no `sub:` of its own in either caller, so it drops in
   unmodified wherever this block is used.
   shortVDesc, not the raw FEATS_VDESC entry, for every `expand` here — not only in the nested "Other…"
   flyouts. addFeatureItems' own copy of this block can render either top-level (avmAddMenu) or one flyout
   deep (drill=true), and a long raw description wraps its row character-by-character in the narrower nested
   case (addFeatureItems' historical note on this exact bug, preserved further down); avmValueMenu is always
   top-level and could in principle have kept the untruncated form for its OWN top rows, but sharing one row
   shape between both callers is the entire point of this extraction. */
function avmFeatBlockItems(si,tokId,t,feat,hintCombine,drill,notSetVals){
  const cur=getFeat(t.feats,feat);
  const set=cur!=null;
  const vals=set
    ? ((typeof attestedFeatVals==="function"?attestedFeatVals(feat):null)||UD_FEATS[feat]||[])
    : notSetVals(feat);
  if(!vals.length && !set) return [];   // nothing to pick AND nothing to clear
  const desc=(typeof FEATS_VDESC==="object"&&FEATS_VDESC&&FEATS_VDESC[feat])||{};
  const out=[{header:feat}];
  /* ⚠ ⌘/Ctrl-CLICK COMBINES; A PLAIN CLICK REPLACES. UD writes several values of one feature as a comma
     list — `Voice=Cau,Pass`, `Case=Acc,Dat` — and any feature may take one (see the note above `featValList`,
     js/grid/grid.js). The modifier is what tells the two gestures apart, and it is the modifier rather than a
     toggling menu because replacing a value is the common case and must stay one click. The menu STAYS OPEN
     for a combining click (`keepOpen` reads the same event), since choosing two values is one thought; a
     replacing click closes it as it always has. The tick asks MEMBERSHIP, so a token already carrying
     `Cau,Pass` shows both rows ticked rather than neither. Only reachable when `set` — see the docstring
     above for why an unset feature stays a plain commit. */
  const combine=e=>!!(e&&(e.metaKey||e.ctrlKey));
  const isOn=v=>set&&(typeof featHasVal==="function"?featHasVal(cur,v):v===cur);
  if(set){
    // BUGFIX (parity audit, predates this extraction): alternates are only worth OFFERING when there's more
    // than one candidate to pick between. This used to ALSO gate the Clear row below, conflating "is there an
    // alternative value" with "is this feature genuinely set" — a feature whose attested set has narrowed to
    // exactly one value (permanently true for Reflex=Yes/Abbr=Yes) silently lost its Clear option. The two
    // checks stay separate: `vals.length>1` gates the picker rows, Clear is gated on `cur` alone, below.
    if(vals.length>1){ hintCombine();
      vals.forEach(v=>out.push({label:v, expand:shortVDesc(desc[v]||""), check:isOn(v), opt:true, keepOpen:combine,
        fn:e=>combine(e)?avmToggleFeat(si,tokId,feat,v):avmSetFeat(si,tokId,feat,v)})); }
  } else {
    // NOT gated on vals.length>1 — see the docstring above: a word class's one attested value is a real first
    // pick for an unset feature, not a no-op the way re-picking a set feature's only value would be.
    vals.forEach(v=>out.push({label:v, expand:shortVDesc(desc[v]||""), fn:()=>avmSetFeat(si,tokId,feat,v)}));
  }
  // "Other <feat>…" — UD's own inventory minus whatever `vals` just offered as a row, i.e. genuinely
  // new-to-this-menu values only. Deliberately complementing `vals` itself rather than recomputing "attested"
  // from scratch, so the complement is guaranteed disjoint from what's already listed regardless of which
  // branch built `vals` above (doc-wide attestedFeatVals for a set feature, the caller's notSetVals(feat) for
  // an unset one) — including the edge case where attestedFeatVals falls back to the FULL UD list (nothing
  // attested anywhere yet): every value is already offered above, so otherCands is correctly empty and no
  // "Other" row appears, rather than uselessly re-listing the same values a second time.
  const otherCands=(UD_FEATS[feat]||[]).filter(v=>!vals.includes(v));
  if(otherCands.length){
    const rows=set
      ? ()=>otherCands.map(v=>({label:v, expand:shortVDesc(desc[v]||""), check:isOn(v), opt:true, keepOpen:combine,
          fn:e=>combine(e)?avmToggleFeat(si,tokId,feat,v):avmSetFeat(si,tokId,feat,v)}))   // …and the flyout's rows answer the modifier too: a value being rarer in this document is no reason for it to behave differently from the ones above
      : ()=>otherCands.map(v=>({label:v, expand:shortVDesc(desc[v]||""), fn:()=>avmSetFeat(si,tokId,feat,v)}));
    // TOP-LEVEL VS NESTED — the SAME fork addFeatureItems' own "Other Feature…" row makes a few dozen lines
    // down, read off the SAME `drill` flag: a real `sub:` when this block can own a flyout of its own
    // (avmValueMenu, always; or addFeatureItems rendered straight into #ctx by avmAddMenu), `reopenFeatSub`
    // when addFeatureItems is already the content of the token menu's own one-deep "Add Feature…" flyout and a
    // further `sub:` here would have nowhere to open.
    out.push(drill
      ? {label:"Other "+feat+"…", keepOpen:true,
          fn:()=>reopenFeatSub(()=>rows().concat([null,{label:"‹ Attested Features", keepOpen:true,
            fn:()=>reopenFeatSub(()=>addFeatureItems(si,tokId,true))}]))}
      : {label:"Other "+feat+"…", sub:rows, subFit:true});
  }
  if(cur) out.push({label:"Clear "+feat, fn:()=>avmSetFeat(si,tokId,feat,null)});
  // {rule:true}, NOT plain `null` — a bare null also closes THIS feature's `.catgrp` (renderMenu's closeGrp),
  // which would dump the rule, and whatever the caller pushes next, into the shared tail below every group
  // instead of under this feature's own header. Below Other/Clear, not above: on request ("the Other/Clear
  // blocks should have a separator below them, but not above"), they read as a continuation of this feature's
  // own rows, and the rule marks the end of the WHOLE block, right before the next feature's own header. This
  // exact placement was fixed identically, and independently, in both of this function's two predecessor
  // copies in the same session before this extraction existed — precisely the drift a shared function stops.
  if(otherCands.length||cur) out.push({rule:true});
  return out;
}
/* ── parity audit fix: the AVM tier's missing "create a NEW feature" gesture. avmValueMenu just above only
   ever EDITS a feature already present in FEATS — avmStruct (js/grid/grid.js) only ever emits a row for a
   feature already set, so a token with feats="_" draws no AVM box at all, and there is nothing to right-click.
   This is the token-menu row (wired into nodeTokenMenu below) that closes the other half of that gap: it lets
   a token gain its FIRST value for any standard UD/SUD feature it doesn't carry yet, on a token with or
   without an existing AVM box, by reading t.feats directly rather than going through avmStruct/avmLayout.
   Scoped to the exact same standard feature set the AVM tier itself draws from (UD_FEATS minus AVM_EXCLUDE,
   js/grid/grid.js) — no arbitrary/custom key, on request.
   ⚠ SUPERSEDED — "further narrowed to features NOT already set: an already-set one is edited through its own
   AVM row instead" was true until this same session's parity fix (on report: "clicking the + on a
   plural-marked noun should show the same menu that right-clicking the Plural value does"). An already-set
   feature is EDITED through its own AVM row (`avmValueMenu` above), same as always — but it now ALSO gets a
   block here, so the two paths can never show different content for it (see avmFeatBlockItems' own docstring,
   and addFeatureItems' cands note, both above). Every write, either way, is still the SAME avmSetFeat call, so
   behaviour (FEATS serialization, syncXposMirror, undo, dirty-marking, re-render) stays identical to every
   other FEATS edit path — that half of the original claim was never in question and still holds.
   ONE FLYOUT, header-grouped by feature (mirrors posSubItems' own dot-suffix picker, a few hundred lines up) —
   not a chained "pick the feature, THEN pick the value" pair of flyouts: the context-menu system supports only
   one nested flyout (openSub's singleton ctx2), so a `sub` row rendered INSIDE that flyout has nowhere further
   to open. */
// on report ("only list features and values that exist in the document/morphologiser output"): attestedFeatVals
// (grid.js) is the wrong helper to reuse verbatim here, even though its inputs — docPairVals("feats",feat) ∪
// MODEL_FEATS_INVENTORY[feat], i.e. exactly "document/morphologiser output" — are the right ones. Its own LAST
// line, `return out.length?out:full`, is a deliberate fallback to the FULL UD inventory whenever nothing is
// attested — correct for its own callers (an ALREADY-SET feature's alternate-value picker, where showing
// something beats showing nothing), wrong here: this flyout only ever offers a feature the token DOESN'T have
// yet, so "nothing attested anywhere in the doc or model" is the common case, not the exception, and the
// fallback was quietly handing back the entire untethered UD_FEATS list for most candidates — the opposite of
// what was asked. strictAttestedVals reads the SAME two sources, with no full-list fallback: a feature/value
// with zero attestation is simply not offered.
// on report ("filtered to only those… applicable to that token's UPOS"): docPairVals("feats",feat) scans the
// WHOLE document regardless of word class — Case is "attested" the moment ANY token anywhere uses it, so a
// NOUN's own flyout offered it even in a document where only PRON ever actually takes it. MODEL_FEATS_INVENTORY
// (js/io/bridge.js) can't help narrow this either — its own docstring (app/parse.py:model_feats_inventory)
// states it's "every Feat=Val pair the model's morphologizer can emit alongside ANY word class", i.e.
// deliberately flat/UPOS-unaware — so it's dropped here rather than mixed in wrongly scoped. upos=null keeps
// the original doc-wide behaviour for strictAttestedVals' other, non-UPOS-scoped use.
function docPairValsForUpos(feat,upos){ const set=new Set();
  try{ DOC.forEach(s=>s.tokens.forEach(t=>{ if(upos!=null&&t.upos!==upos) return;
    const raw=t.feats; if(!raw||raw==="_") return;
    raw.split("|").forEach(seg=>{ const eq=seg.indexOf("="); if(eq>0&&seg.slice(0,eq)===feat) set.add(seg.slice(eq+1)); }); })); }catch(_){}
  return set; }
function strictAttestedVals(feat,upos){ const full=UD_FEATS[feat]||[]; if(!full.length) return full;
  const attested=upos!=null?docPairValsForUpos(feat,upos):new Set((typeof docPairVals==="function"?docPairVals("feats",feat):[]));
  /* ⚠ THE MODEL ANSWERS THE UPOS-SCOPED QUESTION TOO, on request ("only features that are compatible with the
     UPOS should be shown"). It used to be consulted ONLY for the doc-wide question, because the flat inventory
     it exposed pooled every word class together (its own docstring: "alongside ANY word class") and so could
     not narrow anything. MODEL_FEATS_BY_UPOS (js/io/bridge.js ← app/parse.py) reads the SAME labels without
     throwing the `POS=` half away, so a class the model never emits a feature alongside simply does not offer
     it. Union, not replacement: the document's own usage is evidence too, and a corpus may annotate what a
     model never predicts. */
  if(upos!=null){ const m=(typeof MODEL_FEATS_BY_UPOS==="object"&&MODEL_FEATS_BY_UPOS&&MODEL_FEATS_BY_UPOS[upos])||null;
    ((m&&m[feat])||[]).forEach(v=>attested.add(v)); }
  else (typeof MODEL_FEATS_INVENTORY==="object"&&MODEL_FEATS_INVENTORY&&MODEL_FEATS_INVENTORY[feat]||[]).forEach(v=>attested.add(v));
  return full.filter(v=>attested.has(v)); }
/* ⚠ THE NARROWING FALLS BACK RATHER THAN COMING BACK EMPTY, in two stages, and this is what makes the gesture
   reliable rather than a coin toss. The rows are narrowed to what is ATTESTED for THIS token's word class,
   which is right whenever the class has attestation — and silently fatal where it has none. The token this menu
   is most often opened on is exactly such a token: the AVM placeholder is drawn for a token with NO FEATS, and
   a token with no feats is usually PUNCT, PROPN or X, classes a document attests no features on at all. The
   list came back empty, `avmAddMenu` returned false, and right-clicking the placeholder did nothing —
   reported twice as "the AVM placeholder still doesn't work". So: UPOS-scoped, else DOCUMENT-WIDE (the same
   question with the class dropped — which is also the only sensible question for an UNTAGGED token, where
   scoping by "" asks what other untagged tokens carry, i.e. nothing), else the standard inventory itself.
   ⚠️ THE LAST STAGE IS NOT A WIDENING OF THE ATTESTED-ONLY RULE, which stands wherever there is anything to be
   narrowed TO: it is the answer for a document that attests NOTHING yet — a fresh annotation, where the whole
   point of "Add feature" is the FIRST one, and where "only what's attested" and "nothing at all" are the same
   list. Each stage is tried whole (the items are rebuilt, not topped up), so the menu never mixes registers. */
/* ⚠ THE PICKER IS ORDERED THE WAY THE AVM TIER LAYS A TOKEN OUT, on request ("features in the menu should be
   sorted the same way as in the AVMs: agreement, then TAM, then the rest, preferably in glossing order"): the
   AGR block first (Person, Number, Gender, Clusivity — AVM_GROUPS' own order, js/grid/grid.js), then TAM
   (Tense, Aspect, Mood, Evident), then everything else in GLOSSING order (MGLOSS_FEAT_RANK, js/io/bridge.js —
   the sequence the morphemic tier already writes its abbreviations in), and anything in neither table last,
   alphabetically, so an unknown feature has a stable place rather than a random one.
   ⚠️ THE SAME RANK ORDERS avmStruct's OWN TAIL (js/grid/grid.js), which used to walk `Object.keys(UD_FEATS)`:
   that is what makes "the same way as in the AVMs" TRUE rather than approximately true, and it is why the rank
   lives in one function both call rather than in two lists that would drift. The two GROUP rows are unaffected
   — they were already first, in this order.
   Read at call time, so the load order (bridge.js comes after this file) does not matter. */
function avmFeatRank(f){
  const G=(typeof AVM_GROUPS==="object"&&AVM_GROUPS)||{};
  const ai=(G.AGR||[]).indexOf(f); if(ai>=0) return [0,ai,f];
  const ti=(G.TAM||[]).indexOf(f); if(ti>=0) return [1,ti,f];
  const R=(typeof MGLOSS_FEAT_RANK==="object"&&MGLOSS_FEAT_RANK)||{};
  const gi=R[f]; return [2, gi==null?1e6:gi, f]; }
function avmFeatCmp(a,b){ const x=avmFeatRank(a), y=avmFeatRank(b);
  return (x[0]-y[0])||(x[1]-y[1])||x[2].localeCompare(y[2]); }
/* Re-open the ONE flyout element off the row that opened it, with a different list in it — the
   drill-down `posSubItems`/`posSubOtherItems` already use, and for the identical reason: there is
   exactly one flyout layer (`ctx2`), so a row INSIDE a flyout cannot own a `sub:` of its own without
   rebuilding the element it lives in. `ctx2._owner` is that row in the parent menu and `ctx2._colSize`
   how it was sized, both remembered by `openSub` for exactly this. `fit`/`noWrap` are passed as the
   literals the feature rows are opened with (`subFit`/`subNoWrap` on the "Add Feature…" row) rather
   than read back off the element, which remembers neither: reopening without them would drop the
   flyout back to the shared 224px floor and wrap the long value labels the noWrap opt-in exists for.
   focusSearch, because a click on a drill row is as deliberate as a click on the row that opened the
   flyout — and both these lists are long enough to earn the search band (SUB_SEARCH_MIN). */
function reopenFeatSub(items){ const owner=ctx2._owner; if(owner) openSub(owner,items,true,ctx2._colSize,true,true); }
/* `drill` — build this list for a FLYOUT rather than for a top-level menu, i.e. give it the way down to
   `otherFeatureItems`. Off for `avmAddMenu`, which is itself a top-level menu and so can (and does) hang
   that list off a real `sub:` row instead. ⚠ THE SAME FLAG ALSO DECIDES HOW EVERY PER-FEATURE "Other <feat>…"
   ROW GETS TO ITS OWN FLYOUT (real `sub:` vs. reopening ctx2) — that per-feature row is now built by
   `avmFeatBlockItems` (just above avmValueMenu, earlier in this file, and shared with avmValueMenu itself —
   see its own docstring), which reads `drill` straight through from here. One signal answers both questions
   because they are the same question asked at two different depths: "is this list, right now, living inside
   the one flyout layer or not." */
function addFeatureItems(si,tokId,drill){
  const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return [];
  /* ⚠ CANDS NOW INCLUDES EVERY SET FEATURE TOO, not only the not-yet-set ones — on report ("clicking the +
     on a plural-marked noun should show the same menu that right-clicking the Plural value does"): this list
     used to filter OUT anything already set (`getFeat(t.feats,f)==null`), so an already-set feature had NO
     block here at all, however the reader reached it — right-clicking the drawn AVM row was the only way in.
     An already-set feature has already had the "does this word class take this feature" question answered —
     by the annotator or a prior parse — so it now earns a block unconditionally, the same way avmValueMenu
     never asks that question at all (a right-click only ever lands on a row that already exists).
     Simply DROPPING the `==null` half of the old filter is what expresses "(every feature already set) ∪
     (every UPOS-appropriate not-yet-set feature, exactly as today)" in one line: avmFeatBlockItems' own
     `cur!=null` branch is what makes a SET feature's block unconditional and an UNSET one still gated on
     strictAttestedVals/its fallbacks below, so the union does not need spelling out twice here. AVM_EXCLUDE
     keeps filtering BOTH halves, unchanged: an excluded feature is never an AVM row regardless of set/unset.
     ⚠ STILL FLAT, ON PURPOSE — AVM_GROUPS (Person/Number/… fused into one combined AVM row, js/grid/grid.js)
     is never consulted here, exactly as before this change: "+" isn't tied to any one drawn row the way a
     right-click is, so there is no natural combined KEY for it to dispatch on — it offers Person and Number
     as two separate headers whether or not either is already set, exactly as it always offered them
     separately when neither was set. Only avmValueMenu's own combined-row right-click (the AVM_GROUPS[key]
     branch) ever shows one fused picker for a whole group. */
  const cands=Object.keys(UD_FEATS).filter(f=>!AVM_EXCLUDE.has(f)).sort(avmFeatCmp);   // …in the AVM tier's own order — see avmFeatRank
  /* One pass over the candidate features, building each one's block through avmFeatBlockItems (shared with
     avmValueMenu) — `vals(f)` is the ONLY thing that differs between the three stages below, and it is
     consulted ONLY for a feature this token does NOT yet carry (avmFeatBlockItems' own `notSetVals`
     parameter): a feature that IS set sources its values from attestedFeatVals, doc-wide, regardless of which
     stage is asking — see avmFeatBlockItems' own docstring for why "the same menu right-click shows" requires
     that. `hintCombine` is local to EACH `build()` call (never shared across the scoped/fallback stages below,
     since only one of the two ever becomes `list`), so the "⌘-click to combine values" note — now reachable
     from THIS menu too, for any set feature with more than one attested value — appears at most once per
     menu, in front of whichever feature's block first has one to show. Exactly avmValueMenu's own rule,
     relevant here for the first time now that a set feature's block (and its combine gesture) can appear in
     this list at all. */
  const build=vals=>{ const out=[]; let hinted=false;
    const hintCombine=()=>{ if(hinted) return; hinted=true; out.push({note:"⌘-click to combine values"}); };
    cands.forEach(f=>out.push(...avmFeatBlockItems(si,tokId,t,f,hintCombine,drill,vals)));
    return out; };
  const scoped=build(f=>strictAttestedVals(f,t.upos||null));
  /* ⚠ A TAGGED TOKEN STOPS HERE, EMPTY OR NOT, on request ("only features that are compatible with the UPOS
     should be shown"). The two fallbacks below drop the word-class scoping, which is exactly what put Tense in
     a PUNCT's picker; they now apply ONLY to a token with NO class, where there is nothing to scope BY and the
     document-wide question is the honest one. An empty list for a tagged token is therefore a real answer —
     "this class takes no features here" — and the gesture falls through to the token menu rather than opening a
     picker of things that cannot apply. That is the same judgement as the annotation rules in CLAUDE.md: an
     honest blank beats an invented feature set.
     ⚠ "EMPTY" NOW MEANS SOMETHING NARROWER THAN IT USED TO: `scoped` can no longer come back empty merely
     because this word class attests nothing worth ADDING — every feature the token already carries still
     contributes its own block regardless of `t.upos` (avmFeatBlockItems' `set` branch ignores `vals(f)`
     entirely), so `scoped` is empty only for a tagged token that is BOTH bare of standard FEATS AND whose
     class attests nothing this document or model has seen. The rule itself is unchanged — a tagged token
     still never falls back to the unscoped inventory below — only what "empty" can mean has narrowed. */
  const list=t.upos?scoped:(scoped.length?scoped:build(f=>UD_FEATS[f]||[]));   // untagged AND nothing attested anywhere (a fresh document, no model): the inventory itself is all there is to offer
  if(!drill) return list;
  /* ⚠ …AND THE REST OF WHAT UD GIVES THIS CLASS, ONE ROW DOWN — on request ("the Add Feature flyout
     should itself have a flyout that shows the full POS-relevant UD inventory, minus the features
     already attested in the document"). It REPLACES this flyout rather than opening inside it, which
     is forced and not chosen (see `reopenFeatSub`); a "‹ Attested Features" row comes back, so the
     drill-down is not a one-way door. Exactly the shape "Other subtype…" already has in the POS
     flyout, deliberately — the two menus ask the same question of two inventories, and a reader who
     has learnt one has learnt the other.
     ⚠ NOTHING ATTESTED → THIS FLYOUT *IS* THE OTHER LIST, the same rule `posSubItems` settled on: a
     flyout whose only row is "Other Feature…" asks the reader to confirm that an empty list is empty,
     and there is nothing to go BACK to, so that list arrives with no back row either. This also
     re-opens a door the attested-only rule had closed: a tagged token whose class this document
     attests nothing for used to get no "Add Feature…" row at all (`addFeatureRow`'s guard), so the
     features UD plainly gives that class were unreachable from the token menu. The honest-blank rule
     that empty list was justified by (CLAUDE.md) is about not INVENTING an inventory; the UD
     inventory for a word class is not invented. */
  const other=otherFeatureItems(si,tokId);
  if(!other.length) return list;
  if(!list.length) return other;
  return list.concat([null,{label:"Other Feature…", keepOpen:true, fn:()=>reopenFeatSub(()=>otherFeatureItems(si,tokId,true))}]);   // keepOpen: the row's own click must not close the menu standing behind this flyout
}
// the nodeTokenMenu row itself — omitted entirely when addFeatureItems has nothing to open at all (same guard
// shape as markFeatRow just above it), so the menu never grows for a token with nothing behind this row.
// ⚠ "NOTHING TO OPEN" NO LONGER MEANS ONLY "nothing left to ADD" — since addFeatureItems' own cands widened to
// include every SET feature too (its own note, above), this flyout now also carries a block for anything the
// token already carries, so it stays offered for a token whose class has nothing further to add but that DOES
// carry standard FEATS: the row still opens to something (edit/Clear an existing feature), which is exactly
// what "nothing to open" should mean here, not "nothing new to add" — the guard formula (`.length`) needed no
// change, only this comment, which used to describe a narrower question than the one the guard now answers.
function addFeatureRow(si,tokId){
  // …and the guard asks the DRILL question, because the drill list is now part of what this row opens:
  // a token whose class attests nothing still has the UD inventory for that class behind this row (see
  // addFeatureItems' own note), and omitting the row would put it back out of reach. TITLE CASE, on
  // request, and with it the three rows of the same family below/above ("Other Feature…", "Other
  // Subtype…" and the two ways back): macOS titles a menu item, and these four are one gesture wearing
  // four labels. Not swept across every other row in the app in the same breath — the ones that read as
  // sentences ("Clear word class", "Insert token above") are a separate question and not this request.
  return addFeatureItems(si,tokId,true).length
    ? [{label:"Add Feature…", sub:()=>addFeatureItems(si,tokId,true), subFit:true, subNoWrap:true}] : []; }   // the same list one menu up, so the same rule about wrapping
// item 3 — shared by BOTH triggers below (right-click and double-click), so the two gestures can't come to
// different conclusions about what was hit. A combined AGR/TAM row's own value carries one [data-subfeat]
// span/tspan per member (drawAVM/avmInline, diagram-core.js). Landing on one of THOSE scopes the menu to that
// ONE UD feature — avmValueMenu's existing standalone-row branch (AVM_GROUPS[key] falsy for a real feature
// name) already does exactly this, so passing the subfeat straight through as `key` needs no new menu logic at
// all. Anywhere else in the row — the ATTR label, the dot separators, the row's own padding — still resolves to
// avmEl.dataset.feat (the GROUP name on a combined row), i.e. the current "whole group" menu: clicking the
// group's own NAME reads as "edit the group", a specific VALUE reads as "edit just that one member". A
// standalone row's avmEl.dataset.feat already IS the one real feature, so this branch is a no-op there —
// .closest("[data-subfeat]") never matches (no such attribute exists on that row at all).
/* item 28 — THE EMPTY AVM PLACEHOLDER'S OWN MENU, on request ("right-clicking an empty AVM placeholder should
   bring up a context menu for adding features"). A token with no FEATS has no `.avm-row` to right-click — that
   is the very gap addFeatureRow was written for, reachable until now only through the token menu — so the
   placeholder the tier now draws in its place (`.avm-add`, drawAVM / `.oavm-empty`, avmInline, both in
   js/diagram/diagram-core.js) answers with the add-feature picker DIRECTLY rather than as a submenu: there is
   no existing feature here to edit, so the list of what could be added is the whole menu. Same items, same
   avmSetFeat write, same one-flyout-deep shape as everywhere else. Returns false when nothing is attested for
   this token's word class, so the gesture falls through to the ordinary token menu rather than opening an empty
   one. */
/* ⚠ THE FEATURES THIS CLASS COULD TAKE BUT NOTHING HERE ATTESTS, as a flyout of their own — asked for
   with the placeholder menu ("in addition to the available relevant features, there should also be an
   'Other Feature…' flyout that shows other POS-relevant features, even if they're not attested in the
   document"). `addFeatureItems` answers from EVIDENCE and stops there for a tagged token, which is
   right for the main list and leaves a real gap: a feature this class plainly takes, in a document
   that has not used it yet and under a model that never emits it, is simply unreachable. This is the
   way back to it, and it is a separate row rather than a widening of the list above precisely so that
   "what is used here" and "what could be" stay distinguishable at a glance.
   POS-RELEVANT is FEAT_UPOS (js/grid/grid.js) — the same UD-validator derivation SUBTYPE_VALS comes
   from, at the feature level — so this is not the old unfiltered fallback under a new name: Tense is
   still not offered on a PUNCT. A feature the table has no opinion about (Abbr, Typo, Foreign) is
   offered on any class, which is what "no opinion" has to mean.
   ⚠ SUPERSEDED — "TOP-LEVEL MENUS ONLY, hence its place here rather than inside addFeatureItems".
   The constraint behind that is unchanged and permanent: there is exactly ONE flyout layer (`ctx2`,
   openSub), so a row carrying `sub:` inside a flyout would have to rebuild the very element it lives
   in, and the token menu's own "Add Feature…" IS such a flyout. What has changed is that this list is
   no longer reachable ONLY from a top-level menu — "the Add Feature flyout should itself have a flyout
   that shows the full POS-relevant UD inventory". A flyout still cannot nest, so it DRILLS instead:
   `addFeatureItems(si,tokId,true)` ends in an "Other Feature…" row that re-opens the one flyout off
   its own owner with this list in it, and this list ends in the way back (`back`). Which of the two
   shapes a caller gets is which question it is in a position to ask: this menu is opened straight into
   #ctx by a right-click on the placeholder, so its rows can still own real flyouts and it keeps them. */
/* ⚠ THE UD INVENTORY FOR THE CLASS, MINUS WHAT THE MAIN LIST IS ALREADY OFFERING. Settled after three
   readings of it, and the two rejected ones are kept here because each looks right until it is used:
     · per FEATURE — carrying only features with NO attestation at all for the class. The narrowing it
       escapes is per VALUE, so a feature the document used in PART was unreachable in the rest of
       itself: measured on samples/english.conllu, an AUX offered `Person=3` alone (the only person any
       AUX in that file carries) with `Person` nowhere in this flyout. "Why am I only seeing 1 under the
       Person options?"
     · the WHOLE inventory, overlapping the main list — "it should show the whole UD inventory! The main
       menu already shows the subset that's attested" — then corrected again to this: "the UD list MINUS
       what's already attested".
   ⚠ SO THE TWO LISTS PARTITION THE INVENTORY, and neither repeats the other: the main list is what this
   document uses for this class, this one is everything else UD defines for it. A feature appears in
   both only where each has a value the other has not (Person on an AUX: `3` above, `1/2/4/0` here); one
   with nothing left over is omitted entirely. The other filters are the word class (`featOnUpos`), the
   AVM's own excluded keys, and a feature already set on this token — which the row above the
   placeholder is what edits. */
function otherFeatureItems(si,tokId,back){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return [];
  const up=t.upos||"";
  const cands=Object.keys(UD_FEATS).filter(f=>!AVM_EXCLUDE.has(f) && getFeat(t.feats,f)==null
      && (typeof featOnUpos!=="function"||featOnUpos(f,up)))
    .sort(avmFeatCmp);
  const out=[];
  cands.forEach(f=>{ const shown=(typeof strictAttestedVals==="function"?strictAttestedVals(f,up||null):null)||[];
    const vv=(UD_FEATS[f]||[]).filter(v=>shown.indexOf(v)<0); if(!vv.length) return;   // …minus the values the main list already carries
    const desc=(typeof FEATS_VDESC==="object"&&FEATS_VDESC&&FEATS_VDESC[f])||{};
    out.push({header:f});
    vv.forEach(v=>out.push({label:v, expand:shortVDesc(desc[v]||""), fn:()=>avmSetFeat(si,tokId,f,v)})); });
  /* ⚠ THE WAY BACK GOES LAST, and it is written last because renderMenu would put it there anyway: a
     row preceding the first `header` belongs to no group, and every groupless row is collected into the
     TAIL and appended after the groups. Pushed at the front it still rendered at the bottom — with its
     separator below it rather than above. (The identical note, and the identical row, sit on
     `posSubOtherItems`; the two drill-downs are deliberately the same gesture.) Only where a caller
     asked for it: the AVM placeholder menu hangs this list off a real `sub:` row, and a flyout that can
     simply be dismissed has nothing to go back TO. */
  if(back&&out.length) out.push(null,{label:"‹ Attested Features", keepOpen:true, fn:()=>reopenFeatSub(()=>addFeatureItems(si,tokId,true))});
  return out; }
function avmAddMenu(x,y,si,tokId){ const s=DOC[si]; if(!s) return false;
  const items=addFeatureItems(si,tokId);
  const other=otherFeatureItems(si,tokId);
  if(other.length){ if(items.length) items.push(null);   // a separator only where there is something above it to separate from
    items.push({label:"Other Feature…", sub:()=>otherFeatureItems(si,tokId), subFit:true, subNoWrap:true}); }
  if(!items.length) return false;
  /* ⚠ ONE COLUMN, FITTED — the SAME shape the "Add feature…" flyout has in the token menu, on request
     ("right-clicking an AVM placeholder should ONLY bring up the contents of the Add feature submenu"). The
     CONTENT was already exactly that (both go through addFeatureItems, verified in all five notations and in
     the wrapped-bracket overlay); what differed was that this one asked for the balanced TWO-COLUMN layout
     once it had more than 12 rows, which reads as a different menu rather than as that submenu opened in
     place. `false` for twoCol, `true` for fit — `subFit:true` is what addFeatureRow passes for the flyout. */
  showCtx(x,y,items, false, sentRTL(s), true); return true; }
function avmMenuAt(e,x,y){
  /* `.avm-plus` joins the two placeholders here rather than getting a resolver of its own: all three ask
     the identical question ("what could this token gain?") and answer it with the identical menu, and the
     one that is NOT a placeholder — the + on a matrix that already has rows — is the reason the row-level
     `.avm-row` branch below must not claim it first (it would offer that FEATURE's values instead). It is
     also why the + is matched BEFORE `.avm-row`: in the SVG notations the two are siblings inside one token
     group, and `closest` would happily find either. */
  const addEl=e.target.closest&&e.target.closest(".avm-add,.oavm-empty,.avm-plus");
  if(addEl){ const atk=tokFromEl(addEl); if(atk) return avmAddMenu(x,y,atk.si,atk.tokId); }
  const avmEl=e.target.closest&&e.target.closest(".avm-row"); if(!avmEl) return false;
  const tk=tokFromEl(avmEl); if(!tk) return false;
  const subEl=e.target.closest&&e.target.closest("[data-subfeat]");
  const key=(subEl && avmEl.contains(subEl)) ? subEl.dataset.subfeat : avmEl.dataset.feat;
  return avmValueMenu(x,y,tk.si,tk.tokId,key); }
document.getElementById("doc").addEventListener("contextmenu",e=>{
  if(avmMenuAt(e,e.clientX,e.clientY)){ e.preventDefault(); e.stopPropagation(); return; }   // item 22: BEFORE every other resolver, same reasoning as .glabbr just below — an AVM row sits inside the token group the generic node branch would otherwise claim
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
  if(e.detail>=2 && (posRelHit(e.target)||e.target.closest&&e.target.closest(".avm-row"))) e.preventDefault(); },true);   // item 3: same word-selection suppression, extended to an AVM row's own double-click trigger below
document.getElementById("doc").addEventListener("dblclick",e=>{
  const hit=posRelHit(e.target); if(!hit) return;
  e.preventDefault(); e.stopPropagation();
  try{ const g=getSelection(); if(g&&g.rangeCount&&document.getElementById("doc").contains(g.anchorNode)) g.removeAllRanges(); }catch(_){}
  openPosRelMenu(hit,e.clientX,e.clientY,e.shiftKey); });
// item 3: an AVM row's menu, ALSO on double-click — the same shorter road this block's own note gives for
// retagging/relabelling, and the same shared resolver (avmMenuAt, above) the right-click trigger uses, so the
// two gestures can't disagree about what was hit.
document.getElementById("doc").addEventListener("dblclick",e=>{
  if(avmMenuAt(e,e.clientX,e.clientY)){ e.preventDefault(); e.stopPropagation(); } });
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
  /* item 30 — the AVM's "+" answers a PLAIN CLICK, which is the whole point of drawing an affordance:
     every other route to the add-feature picker is a right-click. This is the OUTLINE's route (.oavm-plus);
     the four draggable notations reach the same menu from the tap branch in js/diagram/diagram-edit.js,
     which has to resolve the tapped element before pick() re-renders. It goes AHEAD of the `.avm-row`
     return below — in the outline the + is a sibling of the rows inside one `.oavm`, and that return would
     otherwise swallow the click as "an AVM row is menu-only".
     ⚠ item 32 ADDS `.avm-add`/`.oavm-empty` TO THE SAME LOOKUP: the EMPTY placeholder answers the identical
     plain click now too, and this listener is where it has to be resolved for exactly the notations
     diagram-edit.js's own `plEl` doesn't reach — wrapped brackets' `.avm-add` lives in the `.bwannot`
     overlay, appended to the block rather than nested inside `.bwtok`, so it never matches the early
     `.node,.tok-group,.bwtok` return above and falls through to here, same as `.avm-plus` already does in
     that notation; the OUTLINE's `.oavm-empty` was never inside any of those three either. The four
     DRAGGABLE notations' own `.avm-add` (stemma/arcs/tree/flat-brackets, nested inside `.node`/`.tok-group`)
     are excluded by that same early return and reach diagram-edit.js's `plEl` instead — one placeholder,
     resolved exactly once, by whichever listener its notation's markup actually reaches. */
  const apEl=e.target.closest(".avm-plus,.avm-add,.oavm-empty");
  if(apEl){ const tk=tokFromEl(apEl); if(tk){ e.preventDefault(); const b=apEl.getBoundingClientRect();
    if(avmAddMenu(b.left+b.width/2,b.bottom,tk.si,tk.tokId)) setAvmOpen(apEl);   // …and the matrix stays grown, or the "+" (populated or placeholder) stays up, while its own menu is open
    return; } }   // anchored to the mark, not the pointer — a menu hinged off the thing that opened it
  if(e.target.closest(".avm-row")) return;   // item 3: an AVM row (outline's own — the SVG notations already returned above, via .node/.tok-group/.bwtok) is edited through its right-click/double-click MENU only, never inline text entry; with no exclusion here a plain single click fell through to the generic `.oline` branch below and opened the TOKEN's form editor instead — which also broke the double-click trigger just above, since its first click was busy replacing the row with an <input> before the second click could land on the same element
  const trEl=e.target.closest(".tr-edit"); if(trEl){ const tk=tokFromEl(trEl); if(tk){ e.preventDefault(); editTransInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY}); return; } }   // edit the romanisation shown under a token — or, where the romanisation is non-deterministic, the STORED transliteration it is derived from (trRowEdit decides when the row carries .tr-edit at all)
  const glEl=e.target.closest(".gl-edit"); if(glEl){ const tk=tokFromEl(glEl); if(tk){ e.preventDefault(); editTier(tk.si,tk.tokId,glEl.dataset.tier||"gloss",{x:e.clientX,y:e.clientY}); return; } }
  const lmEl=e.target.closest(".lem-edit"); if(lmEl){ const tk=tokFromEl(lmEl); if(tk){ e.preventDefault(); editLemmaInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY},lmEl); return; } }   // item 29: the lemma row answers the same single click its neighbours do. This is the OUTLINE's route (.olemma); the four draggable notations reach the same function from the tap branch in js/diagram/diagram-edit.js, which resolves the tapped element before pick() re-renders — exactly as .tr-edit/.gl-edit/POS_SEL above already do   // edit a gloss / morphemic tier → MISC
  const poEl=e.target.closest(POS_SEL); if(poEl){ const tk=tokFromEl(poEl); if(tk){ e.preventDefault(); editPosInline(tk.si,tk.tokId,{x:e.clientX,y:e.clientY},poEl); return; } }   // …and the POS row, on the same single click its neighbours already answer (editPosInline). This is the OUTLINE's route (.opos) — the four draggable notations reach the same function from the tap branch in js/diagram/diagram-edit.js, which has to resolve the tapped element before pick() re-renders. It goes AHEAD of the generic .oline branch below, which used to claim this click and open the token's FORM editor: clicking a word class opened a field over the WORD
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
/* ── item 29: TYPING A LEMMA ON THE DIAGRAM ────────────────────────────────────────────────────────
   The lemma row is an inline field like every other row of the below-stack: the same gesture (a plain
   click/tap — see the `.lem-edit` routing in the #doc click handler below and in js/diagram/diagram-edit.js's
   tap branch), the same editor (makeEditable), and the same navigation stack (navStack/tierNav).
   ⚠ IT IS FREE TEXT, so there is no `opts.guard` and no `opts.ac` — the discipline editPosInline documents
   at length above is about a CLOSED inventory, and a lemma has none. `allowEmpty` IS passed: an empty lemma
   is a state CoNLL-U spells `_` and this app already supports everywhere else (editLemmaPrompt's own "Leave
   blank for none"), so clearing the field is how a reader withdraws one.
   ⚠ AND IT COMMITS THROUGH `commitLemmaEdit` (js/grid/grid.js) — the SAME funnel the grid's own Lemma cell
   goes through, not a second path. That function is where the whole asynchronous cascade a new lemma sets
   off is sequenced: afterLemmaEdit (js/io/bridge.js) drops the stale lemma-romanisation, awaits the new one,
   rewrites MISC LTranslit and only THEN re-derives MSeg from it, and mglossReslot re-slots MGloss against
   the segmentation that produced — all inside the ONE undo step makeEditable's `finish` has already pushed.
   Note what it deliberately does NOT do: an eager re-render. Its own note explains why (nothing on screen
   can be right until the await lands), and that reasoning survives this row existing — the lemma the reader
   just typed is already on screen in the field they typed it in, and makeEditable's finish() renders once by
   itself before `after` is called.
   ⚠ THE FIELD OPENS ON WHAT IS STORED, never on what the row paints — the same rule editPosInline and the
   MSeg editor state. A blank slot opens the field on whatever the lemma COLUMN holds — the form it equals,
   or nothing at all where the column is empty — never on the ink, because there is none. (Under the item-29
   gate this paragraph named TIER_EMPTY, which that row can no longer paint: see lemmaRowTxt's own note.)
   Committing "_" as a lemma would put CoNLL-U's own empty marker in the column as if it were a word.
   ⚠ item 31 REVERSES THIS NOTE'S OWN "A TOKEN WHOSE ROW IS BLANK HAS NO FIELD AT ALL". It followed from the
   display gate (lemmaRowTxt, js/diagram/diagram-core.js) — no ink to lay a field over, nothing to hide
   underneath it — and it is answered rather than argued with: a blank slot now carries a transparent target of
   its own (`.lem-hit`), so there IS something to lay the field over and something to hide, on instruction
   ("clicking on a hidden lemma should still bring up the input field"). What survives of the old reading is
   the SENTENCE case: a sentence in which nothing shows a lemma has no row at all, and there the field is given
   one — see lemRowForce below/in diagram-core.js. editLemmaPrompt remains the fallback for what neither can
   reach: a hidden tier (the reader's own Show/Hide choice), and a selection whose block is not on screen. */
function lemmaElOf(si,tokId){ const g=tokGroupOf(si,tokId);
  return g?g.querySelector(".lem-edit"):null; }   // one class across all three renderings (.tok-lemma SVG, .bwlemma wrapped brackets, .olemma outline) — and, since item 31, on the transparent `.lem-hit` target a blank slot carries, which is why exactly ONE element per token may wear it
/* Returns whether a field was actually opened, so a caller with a fallback (editLemmaAt below) can tell "the
   row is there and the field is up" from "nothing here could be edited in place".
   ⚠ THE FORCED ROW IS UNDONE BY THE COMMIT CALLBACK, whatever the edit did — including a cancel, and including
   a commit whose new lemma keeps the row alive on its own merits (there the slide measures 0 and does nothing).
   `forced` is captured per call: two lemma edits can never be open at once (makeEditable's own INLINE_EDIT_OPEN
   contract), so the flag needs no stack. */
function editLemmaInline(si,tokId,clickXY,el){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return false; const t=s.tokens[tokId-1];
  if(typeof lemForceHold==="function") lemForceHold();   // …claim the forced row before the release that the blur just armed can take it away (see lemForceRelease)
  el=el||lemmaElOf(si,tokId);
  let forced=false;
  if(!el && typeof lemRowForce==="function"){ forced=lemRowForce(si,true); if(forced) el=lemmaElOf(si,tokId); }   // item 31: no row in this sentence → bring one in (and slide it in), then look again in the DOM the re-render just built
  if(!el){ if(forced&&typeof lemForceRelease==="function") lemForceRelease(); return false; }
  /* A PROXY, not `t` itself with key "lemma": the stored column is "_" for an empty lemma and the field must
     show that as blank, and a committed blank must go back as "_" rather than "". Same unwrapping the grid's
     own cell and editLemmaPrompt do at their own edges. */
  const proxy={ get v(){ return (t.lemma&&t.lemma!=="_")?t.lemma:""; }, set v(val){ t.lemma=val||"_"; } };
  makeEditable(el, proxy, "v",
    /* item 31: the forced row goes back out FIRST — ahead of commitLemmaEdit's own asynchronous cascade, so the
       two are not both rebuilding this block. A no-op when the committed lemma now differs from the form: the
       row stays on its own merits and the slide measures 0.
       ⚠ AND lemRowForce ALREADY RENDERS, so the no-op branch below must not render AGAIN — measured: the second
       preserveScroll(renderDoc) replaced the very element lemSlide had just written its from-state onto, so the
       departure animated in Chrome for exactly as long as it took the next statement to run (probe:
       `animOut: []` against `animIn: ["clip-path","margin-bottom"]`). Rendering twice was always wasteful; here
       it was also visible. */
    /* ⚠ THE RELEASE IS DEFERRED HERE TOO, and for the same reason it is in the form editor: tabbing along
       the row fires THIS commit while the next field is opening, so dropping the force now would collapse
       the row under the field the reader just moved into. `lemForceRelease` asks on the next tick whether
       any field is still open. `willRelease` keeps the original no-double-render care intact: where a
       release is coming, its own re-render is the one that should land — a second one here replaced the
       element `lemSlide` had written its from-state onto and the departure never animated. */
    changed=>{ const willRelease=(typeof LEM_FORCE_SENT!=="undefined"&&LEM_FORCE_SENT===s);
      if(typeof lemForceRelease==="function") lemForceRelease();
      if(!changed){ if(!willRelease) preserveScroll(renderDoc); return; }   // an opened-and-closed field writes nothing and marks nothing dirty — the same no-op contract editTransInline and the gloss tiers keep
      markDirty();
      if(typeof commitLemmaEdit==="function") commitLemmaEdit(si,tokId,t);   // guarded like the other cross-module calls here: commitLemmaEdit lives in js/grid/grid.js
      else preserveScroll(renderDoc); },
    sentRTL(s), ()=>lemmaElOf(si,tokId), d=>tierNav(si,tokId,"lemma",d), true, clickXY);
  return true; }
/* ── item 31: THE ONE WAY IN, and which editor answers ─────────────────────────────────────────────────────
   ⌘L and the token menu's "Edit lemma…" used to go straight to the popover (editLemmaPrompt), because when
   that row was drawn for only some tokens there was often nothing to lay a field over. There nearly always is
   now — every token in a sentence with the row has a target, and a sentence WITHOUT the row grows one for the
   duration of the edit — so both gestures try the inline field first and fall back to the popover only where
   it genuinely cannot open: the tier switched off in Show/Hide (never overruled: that is a standing choice
   about every sentence, and an edit is not permission to ignore it), or a block that is not currently
   rendered. Both editors write the same column through the same afterLemmaEdit, so the fallback is a change of
   surface, not of behaviour. ⚠ NO pick() ON THIS PATH — a menu command may not make a selection on the
   reader's behalf (CLAUDE.md); it edits whatever is already selected. */
function editLemmaAt(si,tokId,clickXY,anchor){ if(editLemmaInline(si,tokId,clickXY)) return; editLemmaPrompt(si,tokId,clickXY,anchor); }
function tierElOf(si,tokId,tier){ const g=tokGroupOf(si,tokId);
  return g?g.querySelector(`.gl-edit[data-tier="${tier}"]`):null; }
// item 4: the navigable vertical stack for arrow/Tab cell navigation — the token FORM row is the TOPMOST tier,
// then the present gloss tiers (gloss / mseg / mgloss). Up/Down step through this stack at one token column.
/* item 31: navStack takes the SENTENCE now, because the lemma row's presence does (lemmaRow, js/core/prefs.js).
   ⚠ IT ASKS THE RAW `s.tokens`, NOT THE DISPLAY TOKENS the renderers stamp and measure — this is arrow/Tab
   navigation over the DOCUMENT's own tokens, and it has no display sentence in hand. The two can disagree only
   where a token that shows a lemma is folded out of the display (a merged punctuation mark, a goeswith
   continuation), which would put "lemma" in the stack for a sentence whose row is not drawn; tierNav's own
   paintsLem test below then steps over every token in it, so the step is skipped rather than opening a field on
   nothing. `lemForced` is OR-ed in for the mirror case: the force is stamped on the display array, so the raw
   one cannot see the row an open edit has just brought in. */
function navStack(s){ return ["form"].concat((lemmaRow(s&&s.tokens)||(typeof lemForced==="function"&&lemForced(s)))?["lemma"]:[]).concat(belowTiers()).concat(show.pos?["pos"]:[]); }   // item 29: …and the LEMMA row between the form and the gloss tiers, which is where every renderer draws it, gated on the same lemmaRow() every reserve reads. A token that paints nothing there is stepped OVER rather than stopped at — see tierNav below   // …and the POS row LAST, which is where the diagram draws it (below the gloss tiers) and only while it is shown — the same `show.pos` gate belowStack and every reserve already ask. The transliteration row is still deliberately absent: it is not always this token's own stored value (see editTransInline's three branches)
function editCell(si,tokId,tier,clickXY){ if(tier==="form") editNodeInline(si,tokId,clickXY); else if(tier==="pos") editPosInline(si,tokId,clickXY); else if(tier==="lemma") editLemmaInline(si,tokId,clickXY); else editTier(si,tokId,tier,clickXY); }   // "form" → the surface-form editor, "pos" → the strict word-class field, else the gloss-tier editor
function tierNav(si,tokId,tier,d){ const s=DOC[si]; if(!s)return; const stack=navStack(s); const ti=stack.indexOf(tier); if(ti<0)return; let nt=tier, nk=tokId;
  /* ⚠ THE LEMMA ROW IS WALKED LIKE ANY OTHER, BLANK SLOTS INCLUDED — superseding this note's own earlier
     record that navigation stepped OVER a token whose lemma is not painted. That skip was written on the
     reading that "a click aims at one slot, a keyboard walk stops only where there is something to read",
     and the reader has corrected it: "tabbing on a lemma input field should navigate to the adjacent lemma
     field even if it is hidden". It is the better rule, and not only by instruction — the blank slot is
     EDITABLE (item 31 gave it a target of its own), so a walk that refuses to stop there cannot reach the
     one state the row exists to let you change: a lemma that is currently the same as its form. Tab was the
     only way to move along the row without aiming, and it skipped exactly the cells with nothing to aim at.
     Nothing else here changes: the row is still reserved for every token of a sentence that HAS it, so a
     stop is always over a real slot, and Up/Down still cannot land on the row in a sentence that has none
     (navStack leaves "lemma" out of the stack entirely there). */
  if(d.tier){ const j=ti+d.tier; if(j<0||j>=stack.length)return; nt=stack[j]; }   // Up/Down: across tiers (incl. the form row), same token
  if(d.tok){ const k=tokId+d.tok; if(k<1||k>s.tokens.length)return; nk=k; }       // Left/Right/Tab: token-wise along the tier, whether or not this one paints
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
      /* ⚠ A HAND-TYPED Gloss RETIRES THE ALIGNER'S LEMMA. `_glossLex` (js/io/bridge.js) is where the
         translation aligner records the English LEMMA it put in MGloss's lexical slot, and mglossLexFor
         prefers it over the Gloss tier for exactly as long as it stands. Typing in this cell is a new
         statement about what the word MEANS, so a lemma derived from the previous gloss must not go on
         outranking it — the next mglossRefill would otherwise restore a stem the reader has just
         overruled. Gloss only: an MGloss or MSeg edit says nothing about which tier the stem came from. */
      if(tier==="gloss") tk._glossLex="";
      // item 19: mglossSplitTypedHyphen is deliberately narrow (see its own note) — it ONLY reads a single newly-
      // typed hyphen that cuts a two-part gloss cleanly, and declines everything else, INCLUDING a hyphen being
      // REMOVED (a merge, its first condition `A.includes("-")` exits on that immediately) or several hyphens
      // changing in one edit. Those were previously left with no fallback at all — the general re-slotter
      // (mglossReslot, the SAME one a lemma-driven segmentation change already goes through, js/grid/grid.js and
      // js/io/bridge.js) now picks up whatever the narrow rule declines, so a typed MSeg edit of ANY shape keeps
      // MGloss in step, not just the one shape the narrow rule was written for.
      if(tier==="mseg"){ const next=tierText(tk,"mseg");
        if(!mglossSplitTypedHyphen(tk,prev,next)) mglossReslot(tk,prev,next); } } };   // a hyphen TYPED here says where the boundary goes, so a gloss already written as lexical-plus-grammatical divides along it ("walk.PST" over "walk-ed" → "walk-PST"). Read `prev` from MISC rather than trusting the field's own opening value: the mark msegStrip removes never entered it
  // item 12b: on a committed MGloss edit, sync the token's FEATS from the recognised unambiguous gloss tokens —
  // adds a feature that's missing, UPDATES one whose value the edited gloss now disagrees with, and leaves any
  // feature the gloss text doesn't speak to untouched. This shares the edit's single undo snapshot
  // (makeEditable/makeGlossEditableSC pushed it before calling `after`).
  // MSeg has no such back-sync: its continuation mark is drawn, not stored (see the proxy above), so an MSeg edit
  // speaks only for the segmentation itself and leaves FEATS alone. What a regrouping implies runs from renderDoc
  // instead — see msegFlagSent.
  const after=changed=>{ if(!changed){ preserveScroll(renderDoc); return; }   // item 1: opening a gloss field and leaving it as it was changes nothing, so it dirties nothing
    if(tier==="mgloss"){ mglossSyncFeats(tk); syncXposMirror(tk); }
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
    /* ⚠ DEFENSIVE: A HAND-TYPED VOWEL-LENGTH MARK COMES OFF BEFORE IT REACHES FORM. The FORM column must
       never carry one — the treebanks spell Latin bare and the file must round-trip byte-identically —
       so if a reader types one in by hand while editing MSeg, de-hyphenating it and writing it back
       verbatim would put that mark in the form, in `# text`, and in the saved file. Stripping it first
       leaves exactly the bare word; an edit that only moved the boundary then compares equal and writes
       nothing at all, as it should.
       ⚠️ AND HAND-TYPED IS STILL THE ONLY WAY ONE GETS HERE, now that the MSeg row DISPLAYS the macrons
       under Latin's `macron` Script scheme (tierDisp, js/core/prefs.js). That is an overlay drawn over
       the row; this field opens on the proxy above, which reads tierText — the STORED, bare
       segmentation — exactly as the form editor opens on the bare form under a script. So a reader who
       clicks in sees the bare letters, and committing without typing writes the same string back and
       changes nothing. This strip is what covers the case where they do type one. */
    if(tier==="mseg"){ let bare=tierText(tk,"mseg").replace(/-/g,"");
      const laQty=!!bare && (DOCLANG||"").toLowerCase().split(/[-_]/)[0]==="la";
      if(laQty) bare=bare.normalize("NFD").replace(/[̄̆]/g,"").normalize("NFC");   // combining macron + breve, taken off the DECOMPOSED string so precomposed ā and a+U+0304 are caught alike
      /* ⚠ AND WHERE THAT STRIP RAN, THE "DID ANYTHING MOVE?" TEST HAS TO BE QUANTITY-BLIND TOO — otherwise
         the guard DELETES the very marks it exists to keep out. Latin treebanks do spell some forms with a
         length mark (`samples/la_virgil.conllu` writes Virgil's `căno` with its metrical breve), so a
         stripped `cano` compared literally against the stored `căno` reads as a changed word and rewrites
         the FORM — and with it `# text` and the saved file. Measured on that very token before this line
         existed: moving the boundary to `că-no`, an edit that touches no letter, turned the form into
         `cano` and respliced the running line. Folding both sides restores what the paragraph above
         promises ("an edit that only moved the boundary then compares equal and writes nothing at all"),
         while a hand-typed mark still cannot reach FORM: it is stripped out of `bare` first, so the two
         compare equal and nothing is written. A real letter change still writes, bare, exactly as before. */
      const moved=v=>laQty?(stripQuantity(v||"")!==bare):((v||"")!==bare);   // stripQuantity: js/lang/translit-load.js, the same fold laMwtCompose trusts its join on. `bare` is already stripped, so only the stored side needs folding
      if(bare){
        if(typeof translitNeeded==="function" && translitNeeded(DOCLANG)){
          if(moved(tk.translit)){ tk.translit=bare; tk.misc=setMiscKV(tk.misc,"Translit",bare); tk._trMisc=true; markDirty(); }
        } else if(moved(tk.form)){ tk.form=bare; markDirty();
          if(typeof afterFormEdit==="function") afterFormEdit(si,tokId,true); } } }
    markDirty(); preserveScroll(renderDoc); };
  if(tier!=="mseg") makeGlossEditableSC(el, proxy, "v", after, sentRTL(s), ()=>tierElOf(si,tokId,tier), d=>tierNav(si,tokId,tier,d), clickXY, tier==="mgloss"?tk:null, glossTierAbbr(tier));   // live c2sc small-caps on its Leipzig abbreviations as the user types — on BOTH gloss tiers, matching how both now render (setGlossText); MSeg is word text, not a gloss, so it keeps the plain <input> editor. Task C: the trailing token is the MGloss abbreviation-autocomplete's UPOS context (AMBIG_UPOS) — passed ONLY for "mgloss" (a lexical Gloss definition isn't built from Leipzig abbreviations, so it gets no dropdown)
  else makeEditable(el, proxy, "v", after, sentRTL(s), ()=>tierElOf(si,tokId,tier), d=>tierNav(si,tokId,tier,d), true, clickXY); }   // item 2: allowEmpty → a gloss/MSeg value can be deleted (cleared), unlike a Form
/* ── TYPING A WORD CLASS ────────────────────────────────────────────────────────────────────────────
   The POS row is an inline field like every other row of the below-stack, opened by the SAME gesture
   (a plain click/tap — see the .tr-edit/.gl-edit routing in the #doc click handler above and in
   js/diagram/diagram-edit.js's tap branch), positioned by the SAME editor (makeEditable), and it commits
   through the SAME funnel the menu does (retagToken). What it adds is a STRICT completion: the word-class
   inventory is closed, so the field completes from it and refuses anything else.

   THE DISCIPLINE, stated once:
     · The dropdown is the app's own (acShowGrouped, js/grid/grid.js), grouped by UPOS_CATS and carrying
       each tag's expansion (UPOS_INFO) in the dimmed right-hand column, exactly as the FEATS value lists do.
     · It opens on the WHOLE inventory the moment the field does — 17 rows of a closed vocabulary, and the
       reader who clicked the tag came to change it. (The grid's DepRel cell shows nothing on focus for an
       already-set cell; its vocabulary is open and long, and it is answering a different question.)
       Typing then filters it: case-insensitive PREFIX, falling back to SUBSTRING when the prefix matches
       nothing — the same two-stage match acOpen/deprelAcOpen/openIeAC all use — minus the exact text
       already typed, since there is nothing there to complete.
     · The field paints in the ROW's own register, small caps and all: every POS rendering in the app sets
       `font-feature-settings:"c2sc" 1`, and `applyFont` now carries that (and measures in it) so the tag
       does not jump to full capitals under the caret and back again on commit.
     · CHOOSING A ROW SUBMITS — by click as well as by ↑/↓ then Enter/Tab. The vocabulary is closed, so a
       chosen row is the answer rather than a starting point, and asking for a second gesture to confirm it
       repeats one the reader has already made. (The grid's DepRel/Deep cells keep the fill-only behaviour:
       their vocabulary is open, and a completion there is genuinely a starting point.)
     · ↑/↓ move the highlight; Enter or Tab on a highlighted row accepts it AND commits (makeEditable's
       opts.ac.commit — the grid's DepRel rule); Escape closes the list, a second Escape reverts the field.
     · A commit whose text is not an exact (case-insensitive) member of the inventory is REFUSED. Enter and
       Tab leave the field open with the text intact and say why; a blur reverts. Case is the one mercy:
       `noun` commits as `NOUN`, because the canonical spelling is the inventory's to supply — the same
       courtesy every autocomplete in this app already extends by matching case-insensitively.
     · ⚠ THE EMPTY STRING IS THE ONE NON-MEMBER THAT COMMITS. An untagged token is a state this app
       deliberately supports — "Clear word class" in the menu, `_` in the file, TIER_EMPTY in the diagram —
       so clearing the field is how the reader untags, and `allowEmpty` is passed for exactly that.
     · ⚠ AND THE INVENTORY IS `SETTINGS.upos` PLUS THIS TOKEN'S OWN CURRENT TAG. The same widening
       `optionMenu` states one function up and for the same reason: a tag the FILE carries that the
       inventory does not list must still be something this editor can put back, or half-deleting it would
       strand the reader on a value they can no longer retype. (Closing the field on an untouched value
       never consults the guard at all — see passesGuard.) */
function posElOf(si,tokId){ const g=tokGroupOf(si,tokId);
  return g?((g.matches&&g.matches(POS_SEL))?g:g.querySelector(POS_SEL)):null; }   // tokGroupOf already prefers the CONTENT-bearing group, which is what keeps a wrapped stemma/hierarchy off the pinned tree's bare hit-circle (see its own note)
function editPosInline(si,tokId,clickXY,el){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return; const tk=s.tokens[tokId-1];
  el=el||posElOf(si,tokId); if(!el)return;   // `el` is passed by the click paths so the field opens over the element that was actually tapped — in a PROJECTED stemma both a `.node-cat` and a `.tok-pos` exist for one token, and posElOf would hand back the baseline row's for a click on the node
  /* The field opens on what is STORED, not on what the row PAINTS — the same rule the MSeg editor follows
     under Latin's macron scheme. An untagged token paints `TIER_EMPTY` in most notations and the literal
     "X" as a stemma NODE (diagram-rendering.md's one deliberate exception), and both open an EMPTY field:
     the placeholder is cosmetic, and committing "X" for a token nobody has classified would put a real UD
     tag in the file that no reader chose. */
  /* ⚠ THE VOCABULARY IS THE CLASSES **AND THEIR SUBTYPES**, on request ("the POS input field should also
     show POS subtypes"). A dot-suffixed tag is what the row already PAINTS (`posDisp` → `PRON.DEM`) and what
     the right-click flyout already sets, so a field that could not type one could not say what the row in
     front of the reader was saying. `subtypeOptionsFor` walks every class, so `PRON.Dem` completes whether or
     not the token is currently a PRON — retagging and subtyping in one gesture, which is exactly what the
     flyout does when you pick a subtype under a different class.
     Order matters for the dropdown: each class is followed by its own subtypes, so the list reads as a class
     with its refinements rather than an alphabet of dotted strings. */
  const subOpts=[]; SETTINGS.upos.forEach(U=>{ (subtypeOptionsFor(U)||[]).forEach(o=>subOpts.push(o)); });
  const subBy={}; subOpts.forEach(o=>{ subBy[o.label.toLowerCase()]=o; });
  const vocab=[]; SETTINGS.upos.forEach(U=>{ vocab.push(U);
    subOpts.forEach(o=>{ if(o.label.slice(0,U.length+1)===U+".") vocab.push(o.label); }); });
  if(tk.upos&&!vocab.includes(tk.upos)) vocab.push(tk.upos);
  /* …opens on the DOTTED form when the token wears one — what the row says and what the reader is editing —
     but in the VOCABULARY's own spelling, not the row's. `posDisp` uppercases the suffix so it sits in the
     tag's small-caps register (`PRON.DEM`); the field is text the reader edits and completes against, and it
     would be odd to open on a spelling its own list does not contain. Falls back to the painted form for a
     subtype this build's tables do not define, which is then pushed into the vocabulary so it stays editable
     rather than being silently refused by the guard. */
  const disp=posDisp(tk)||tk.upos||"";
  const cur=vocab.find(v=>v.toLowerCase()===disp.toLowerCase())||disp;
  if(cur&&!vocab.some(v=>v.toLowerCase()===cur.toLowerCase())) vocab.push(cur);
  const guard=v=>{ if(!v) return "";   // clearing the field untags the token — the one non-member that commits
    const m=vocab.find(u=>u.toLowerCase()===v.toLowerCase());
    if(m) return m;   // canonicalise to the inventory's own spelling
    toast(`“${v}” is not a word class — choose one from the list`); return null; };
  let first=true;
  const acOpen=(inp,pick)=>{ if(document.activeElement!==inp){ if(_acInput===inp) acCloseSoon(); return; }
    const wasFirst=first; first=false;
    /* ⚠ THE INITIAL OPEN IS GATED ON WHETHER THE FIELD ALREADY HOLDS A COMPLETE TAG, on request ("the POS
       input field should only show the autocomplete menu while typing, or if the current value is not a
       complete POS tag (including an empty value)"). This call fires the instant the field is created (and
       again on "focus", both effectively at open time — makeEditable, further down this file) — before that
       fix, THIS was the call that unconditionally browsed the whole vocabulary regardless of what the field
       already held, so opening on an ALREADY-tagged token (the common case) threw a full list up over a
       value the reader had not touched and might not want to change at all. `cur` (this function's own
       normalisation, above — `orig`/`inp.value` opens on it) is ALWAYS a member of `vocab` once non-empty
       (lines above push it in if the build's own tables didn't already have it), so "complete" here reduces
       to "non-empty" in practice — but is asked as real vocabulary membership, not a bare emptiness check,
       so it stays correct if that normalisation ever changes. An incomplete/empty value still opens the
       guided browse immediately, exactly as before; typing afterward re-invokes this with `wasFirst` false,
       taking the normal per-keystroke branch below either way. */
    if(wasFirst && inp.value.trim() && vocab.some(v=>v.toLowerCase()===inp.value.trim().toLowerCase())) return;
    const all=wasFirst;
    const q=all?"":inp.value.trim().toLowerCase();
    let ms=!q?vocab.slice():vocab.filter(v=>v.toLowerCase().startsWith(q));
    if(q&&!ms.length) ms=vocab.filter(v=>v.toLowerCase().includes(q));
    if(q) ms=ms.filter(v=>v.toLowerCase()!==q);   // nothing to complete to the exact text already typed — the FIRST open browses the whole set too (q=="" then), but ONLY when there was nothing complete to gate it on already (see the guard just above)
    if(!ms.length){ if(_acInput===inp) acCloseSoon(); return; }
    const set=new Set(ms), placed=new Set(), groups=[];
    UPOS_CATS.forEach(([name,members])=>{ const items=members.filter(m=>set.has(m)); items.forEach(m=>placed.add(m));
      if(items.length) groups.push({title:name,items}); });
    const rest=ms.filter(v=>!placed.has(v)); if(rest.length) groups.push({title:"Other",items:rest});   // a tag outside UPOS_CATS (this token's own out-of-inventory one) files where the menu files it
    acShowGrouped(inp,groups,pick||null,v=>UPOS_INFO[v]||""); };   // `pick` (makeEditable's own) → choosing a row FILLS AND COMMITS, on request: the word-class vocabulary is closed, so a chosen row is the answer and not a starting point. Falls back to acFill's default path if a caller ever opens this without one
  /* THE FIELD IS BOUND TO A PROXY THAT ONLY REMEMBERS. makeEditable writes obj[key] on the way out and
     pushes its own undo entry; the retag itself has to run in `after`, through retagToken, so the whole
     cascade (FEATS cleanup, gloss retarget, inheritance, translit, re-parse) is the menu's cascade and not a
     second copy. Writing it from the SETTER instead would fire on a CANCEL too — makeEditable assigns `orig`
     back unconditionally when nothing changed — and retagToken's own subtype guard would then quietly drop a
     dot-suffixed subtype on a field the reader had merely opened and closed. */
  let want=null;
  const proxy={ get v(){ return cur; }, set v(val){ want=val; } };
  makeEditable(el, proxy, "v",
    /* ⚠ WHICH COMMIT depends on whether a SUBTYPE was typed, and the two are genuinely different edits:
       a bare tag runs the whole retag cascade (`retagToken`, ending in a re-parse), while a dot-suffixed one
       runs `retagSubtype` — the flyout's own commit, which sets the feature and deliberately does NOT
       reparse, because the parse would re-derive FEATS over the subtype just chosen. Matched case-
       insensitively against the same table the vocabulary was built from, so "pron.dem" lands on PRON.Dem. */
    changed=>{ if(!changed) return;
      const o=subBy[String(want||"").toLowerCase()];
      if(o) retagSubtype(si,tokId,o.label.slice(0,o.label.length-subtypeSuffix(o.feat,o.val).length-1),o.feat,o.val,{snapshot:false});
      else retagToken(si,tokId,want,{snapshot:false}); },   // no render on a no-op: makeEditable's finish() has already run preserveScroll(renderDoc) and there is nothing further to show
    sentRTL(s), ()=>posElOf(si,tokId), d=>tierNav(si,tokId,"pos",d), true, clickXY,
    {guard, ac:{open:acOpen,commit:true}, dbl:(x,y)=>posMenu(x,y,si,tokId), extraFeat:"'smcp' 1"}); }   // both smcp AND c2sc (applyFont's own note above): c2sc alone (the row's computed style) small-caps only the capitals actually on screen, but the reader may still be typing lower/mixed case before autocomplete or commit upper-cases it   // dbl: the row's own double-click still opens the FULL menu — the subtype flyouts, the guidelines link and the model-probability weighting have no text-field equivalent and are not being traded away for one
// nearest character boundary, as an index into `text`, to a LOCAL x-offset (0 = the start of the rendered run) —
// walks cumulative substring widths via the same canvas metric (meas) the field itself was sized/centred with, so
// it lines up with what's actually on screen. Used to drop the caret where the field was clicked, not select-all.
function caretIndexForX(text,fontStr,localX,extraCss){ if(localX<=0) return 0;   // extraCss: the caller's own OpenType feature list, so the walk below measures in the face the run is DRAWN in (see makeEditable's applyFont)
  const total=meas(text,fontStr,extraCss); if(localX>=total) return text.length;
  let prev=0; for(let i=1;i<=text.length;i++){ const w=meas(text.slice(0,i),fontStr,extraCss); if(w>=localX) return (localX-prev<w-localX)?i-1:i; prev=w; }
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
/* `opts` (all optional) — the three hooks a CONSTRAINED field needs, added for the diagram's POS row and
   written here rather than at that one call site because each of them has to sit INSIDE this function's own
   listeners to work at all:
     · opts.guard(v) → the value to commit (canonicalised if it likes), or null to REFUSE the commit. Called
       only when the trimmed text has actually MOVED off `orig` — a value that has not moved is not a commit,
       so a field opened on a value the guard would reject (a tag the FILE carries that is not in the
       inventory) can still be closed unchanged. A refusal on a DELIBERATE commit (Enter, Tab/arrow tier-nav)
       leaves the field OPEN with the text intact so it can be corrected; on a BLUR, a right-click handoff or
       a Shift+arrow selection it REVERTS instead — keeping focus in a field the reader has just clicked out
       of would trap them and would fight this editor's own "what was clicked becomes the selection"
       contract below. The guard says WHY (a toast); this function only obeys.
     · opts.ac → {open(inp), commit} wires the app's shared floating dropdown (acEl/acShowGrouped/acFill,
       js/grid/grid.js) onto this field. `open` is called on the initial focus and on every input; the
       ↑/↓/Enter/Tab/Esc block below is the SAME one the grid's Deep and DepRel cells and the MGloss editor
       already carry, hoisted in here so it is written once for every future field rather than a fifth time.
       `commit:true` → accepting a row also commits the edit, exactly as the grid's DepRel cell does
       ("accepting a suggestion IS an accept-this-edit gesture").
     · opts.dbl(x,y) → what a SECOND click on the open field means. See its own note further down. */
function makeEditable(el,obj,key,after,rtl,relocate,nav,allowEmpty,caretHint,opts){ if(!el)return; let orig=obj[key]||""; const pre=snap();
  opts=opts||{};
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
  let fontStr, featCss=""; const applyFont=e=>{ const cs=getComputedStyle(e);   // `e` lives inside .sblock{zoom:var(--fs)} but `inp` is appended to <body>, OUTSIDE that zoomed context — so the size has to be converted by hand, or the field renders at a different size from the diagram text it is covering
    const sizePx=visualFontPx(e)+"px";   // js/core/document.js — computed × cssLenScale × zoom, the last two PROBED because Chrome and WebKit report an SVG length inside a zoomed subtree differently. This used to be a bare `×FS`, which is right in Chrome and lands back on the UNZOOMED size in WebKit (see cssLenScale's note): the field opened at 100 % over a diagram drawn at 160 %
    inp.style.fontFamily=cs.fontFamily; inp.style.fontSize=sizePx; inp.style.fontWeight=cs.fontWeight; inp.style.fontStyle=cs.fontStyle; fontStr=cs.fontStyle+" "+cs.fontWeight+" "+sizePx+" "+cs.fontFamily;
    /* ⚠ …AND THE ROW'S OWN OPENTYPE FEATURES, for the same reason it takes the row's face, weight and
       tracking: the field must read while typing exactly as the row will once committed. Reported of the
       word-class field — every POS rendering in the app (`.tok-pos`, `.bwpos`, `.opos`, `.node-cat`,
       `.mwt-pos`) paints `font-feature-settings:"c2sc" 1`, so a tag sits in small caps everywhere until you
       click it, at which point it jumped to full capitals under the caret and back again on commit.
       ⚠ AND THE MEASUREMENT GOES WITH IT — CLAUDE.md's "a measurement must follow the paint", which here is
       not a nicety: c2sc substitutes NARROWER glyphs, so measuring the field's width and its click-to-caret
       index in the unfeatured face would size the box for text wider than the text drawn in it and land the
       caret progressively further off across the run. `meas` forwards this to `_measOne`, whose `extraCss`
       is the same channel avmLayout already measures its own c2sc labels through (js/diagram/diagram-core.js).
       A row with no features computes to "normal" and contributes nothing, so every other field is unchanged.
       ⚠ `opts.extraFeat` ADDS TO THAT, rather than replacing it, for the one field that needs a second
       feature the row's own computed style can't supply: the word-class field (`opts.extraFeat:"'smcp' 1"`,
       set at its makeEditable call below). c2sc small-caps CAPITALS — right for the tag once committed,
       which is always upper-case — but says nothing about the letters the reader is mid-typing before
       autocomplete/commit upper-cases them; `smcp`, the LEMMA row's own feature (diagram-core.js's LEM_FEAT
       note on why lower-case needs the other one), covers exactly that gap. Both together read as small
       caps regardless of the case actually on screen at any one keystroke — the same reasoning that already
       combines two features for the Leipzig abbreviation runs (`"c2sc" 1,"onum" 1"`, app.css). */
    const ffs=cs.fontFeatureSettings;
    let ff=(ffs&&ffs!=="normal")?ffs:"";
    if(opts.extraFeat) ff=ff?ff+","+opts.extraFeat:opts.extraFeat;
    if(ff){ inp.style.fontFeatureSettings=ff; featCss=";font-feature-settings:"+ff; }
    else { inp.style.fontFeatureSettings=""; featCss=""; }
    // …and the row's INK, which .nodeedit's own `color:var(--text)` would otherwise override. Without this the
    // transliteration row (.translit/.otrans — italic, --dia-muted) visibly jumped to full-strength body text the
    // moment it was clicked into, on single tokens and on an MWT's IAST row alike. Read off the edited element
    // rather than re-listing the per-row values here: those rows already carry four different inks (--text,
    // --dia-muted, and the .sel/.rng accent overrides on top of both), and a second copy of that table in JS would
    // be one more thing to keep in step with the stylesheet every time a row's colour changes. Same reason the
    // family/size/weight/style above are copied rather than named. SVG text paints through `fill`, HTML through
    // `color`; "none"/transparent means the element is mid-edit-hidden already (hideOrig) and must not be copied.
    const ink=(e.namespaceURI===SVGNS)?cs.fill:cs.color;
    if(ink && ink!=="none" && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(ink)) inp.style.color=ink;
    /* ⚠ …AND THE ROW'S OWN LETTER-SPACING, REVERSING THE DELIBERATE OMISSION THE `applyFont(el)` LINE BELOW
       USED TO DOCUMENT. That note ("letter-spacing is deliberately NOT copied: caretIndexForX hit-tests the
       click point with meas(), a canvas metric that carries no tracking") stopped being true when meas()
       moved off canvas onto an SVG element it sets `letter-spacing` on (see _measOneUncached,
       js/diagram/diagram-core.js): every measurement about this field — its width in place(), the caret
       hit-test in caretIndexForX — has been assuming the tracking all along while the field itself painted
       without it, so a tracked row (the transliteration, an MSeg/MGloss tier, a hierarchy node label)
       visibly re-spaced the moment it was clicked into. Reported together with the seam mark's own version
       of the same omission. Taken from `trackEmOf(fontStr)` — the ONE expression meas() itself uses, applied
       to the very font string the caret maths is driven by — rather than from `cs.letterSpacing`, which
       reads back a px value against the element's AUTHORED size while this field is laid out at the VISUAL
       (zoom-converted) size: those two agree only at zoom 1. In em, so it rides that conversion for free. At
       zoom 1 it is exactly what the stylesheet states for the row (verified for every tracked class — see
       trackEmOf's own note), which is the case that had to match. */
    inp.style.letterSpacing=((typeof trackEmOf==="function")?trackEmOf(fontStr):0)+"em";
    };
  applyFont(el);
  const w0=Math.max(30,el.getBoundingClientRect().width+16);   // never shrink the field below the initial content width
  const place=()=>{ const r=el.getBoundingClientRect(), h=Math.max(16,r.height+2), cx=r.left+r.width/2, w=Math.max(w0, meas(inp.value,fontStr,featCss)+18);
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
    else { const r=inp.getBoundingClientRect(), tw=meas(inp.value,fontStr,featCss);   // the field is centred and often wider than its own text (room to grow while typing) — locate the actual text run within it first
      const textLeft=r.left+(r.width-tw)/2, textRight=textLeft+tw;
      const localX=rtl?(textRight-caretHint.x):(caretHint.x-textLeft);   // RTL: index 0 sits at the visual RIGHT edge
      idx=caretIndexForX(inp.value,fontStr,localX,featCss); }
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
  /* THE STRICT GATE — see opts.guard's own note at the top of this function. Returns true when the field may
     close on a save. `v===orig` short-circuits it: closing a field on the value it opened with commits
     nothing, so a guard has nothing to refuse and must not be given the chance to trap the reader in a field
     they never edited. A refusal is REPORTED BY THE GUARD, not here — this function knows nothing about what
     the field's vocabulary is or what to call it. */
  const passesGuard=()=>{ if(typeof opts.guard!=="function") return true;
    const v=inp.value.trim(); if(v===orig) return true;
    const g=opts.guard(v); if(g==null) return false;
    if(g!==inp.value) inp.value=g;   // the guard may CANONICALISE (case, spacing) — what it hands back is what commits
    return true; };
  const finish=save=>{ if(inp._closed)return; inp._closed=true; if(typeof acClose==="function"&&_acInput===inp) acClose();   // the shared dropdown belongs to this field for exactly as long as the field exists
    const v=inp.value.trim(), changed=save&&(v||allowEmpty)&&v!==orig;   // item 2: gloss/morphemic tiers pass allowEmpty → an emptied value COMMITS (clears the tier) instead of reverting; the Form editor keeps allowEmpty falsy, so a form can't be blanked
    obj[key]=changed?v:orig;   // commit the trimmed value, or revert the live edits on cancel/no-op
    if(changed){ UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); markDirty(); }   // one undo step for the whole edit (the snapshot from before it began)
    INLINE_EDIT_OPEN=false; INLINE_EDIT_SYNC=null;   // BEFORE the render below: that one is this edit's own consequence and must run
    document.removeEventListener("scroll",place,{capture:true}); inp.remove(); preserveScroll(renderDoc); if(after)after(changed); };   // pass `changed` so a commit-only hook (e.g. MGloss→FEATS back-fill) can distinguish a real commit from a cancel/no-op
  inp.addEventListener("input",reflow);
  /* opts.ac — the app's SHARED completion dropdown on this field. Opened on the initial focus (which has
     already happened above, so it is called directly rather than waited for) and re-filtered on every input;
     `focus` is bound as well for a refocus that comes back to a field still standing (acFill's own
     inp.focus(), a menu row's mousedown). Nothing else in here changes: the dropdown is a floating element of
     its own and this field goes on being an ordinary <input> underneath it. */
  /* ⚠ …AND SELECTING A COMPLETION SUBMITS, WHICHEVER WAY IT IS SELECTED. Reported of the word-class
     field: Enter/Tab on a highlighted row committed (the keydown branch below), but CLICKING a row only
     filled the field — `acFill`'s default path sets `inp.value`, fires `input` and stops there, which is
     right for the grid's Deep cell (an open vocabulary, where a completion is a starting point) and wrong
     for a closed one, where choosing the row IS the answer and a second gesture to confirm it is a step
     the reader has already taken. The two paths now end in the same place.
     Handed to the OPENER rather than wired here, because the opener is what calls `acShowGrouped` and
     `onPick` is its third argument; `opts.ac.open` may ignore it, which is what every caller that wants
     the fill-only behaviour does (it is an optional second parameter, so existing openers are unchanged).
     Through `passesGuard()` like every other commit — the row came from the guard's own vocabulary, so
     this can only refuse if a caller offers rows it would not itself accept. */
  const acPick=v=>{ inp.value=v;
    if(opts.ac&&opts.ac.commit&&passesGuard()){ finish(true); return; }
    inp.dispatchEvent(new Event("input",{bubbles:true})); };   // …and with no commit contract, exactly acFill's own default
  if(opts.ac&&typeof opts.ac.open==="function"){
    inp.addEventListener("input",()=>opts.ac.open(inp,acPick));
    inp.addEventListener("focus",()=>opts.ac.open(inp,acPick));
    opts.ac.open(inp,acPick); }
  inp.addEventListener("keydown",ev=>{
    /* …AND THE DROPDOWN OWNS ↑/↓/Enter/Tab/Esc WHILE IT IS OPEN ON THIS FIELD — ahead of the tier-nav and
       Enter/Escape handling below, exactly as the grid's Deep/DepRel cells (js/grid/grid.js) and the MGloss
       editor (makeGlossEditableSC) already order the same two. Written HERE rather than at the call site
       because a listener added afterwards, on the same element, runs after this one and would arrive to find
       Enter had already committed the field (at-target listeners fire in registration order, capture flag or
       not). ESCAPE CLOSES THE LIST FIRST and leaves the edit open — the grid's own rule, and the only
       reading that lets a reader dismiss a list they did not want without losing what they had typed. */
    if(opts.ac&&_acMenu&&_acMenu.classList.contains("show")&&_acInput===inp){
      if(ev.key==="ArrowDown"){ ev.preventDefault(); ev.stopPropagation(); acHi((_acIdx+1)%_acItems.length); return; }
      if(ev.key==="ArrowUp"){ ev.preventDefault(); ev.stopPropagation(); acHi((_acIdx-1+_acItems.length)%_acItems.length); return; }
      if((ev.key==="Enter"||ev.key==="Tab")&&_acIdx>=0){ ev.preventDefault(); ev.stopPropagation(); acFill(_acItems[_acIdx]);
        if(opts.ac.commit&&passesGuard()) finish(true);   // Task A's rule, one field over: accepting a suggestion IS an "accept this edit" gesture. Through the guard like any other commit — the row it filled came from the guard's own vocabulary, so this can only refuse if a caller offers rows it would not accept
        return; }
      if(ev.key==="Escape"){ ev.preventDefault(); ev.stopPropagation(); acClose(); return; } }
    if(nav){   // item 4: gloss-tier cell navigation — commit the current cell, then focus the target cell
      const collapsed=inp.selectionStart===inp.selectionEnd;   // item 4: a real caret, NOT the whole-item selection a double-click opens with
      const atStart=collapsed && inp.selectionStart===0;         // only step to the previous token when the caret is genuinely collapsed at the left edge — from a full selection, ArrowLeft first collapses to that edge (the browser default), it doesn't jump tokens
      const atEnd=collapsed && inp.selectionStart===inp.value.length;   // likewise ArrowRight from a full selection collapses to the right edge first, then a second press steps to the next token
      // item 1: Shift+←/→ at the field edge extends a multi-token selection into the adjacent token (reading-order,
      // RTL-aware) instead of navigating into its editor — commit this edit, then grow the range from the doc's
      // own Shift+arrow logic. The caret must be collapsed at the matching edge, exactly like the nav case below.
      if(ev.shiftKey && (ev.key==="ArrowRight"||ev.key==="ArrowLeft")){
        const fwd=(ev.key==="ArrowRight")!==!!rtl, atEdge=fwd?atEnd:atStart;
        if(atEdge && sel.s>=0 && sel.t>0){ ev.preventDefault(); ev.stopPropagation(); if(!passesGuard()) inp.value=orig;   // a selection gesture is not a commit: a refused value reverts here rather than pinning the reader in the field
          finish(true); extendSelToward(fwd?1:-1); return; } }
      let d=null;   // arrow-triggered nav carries a caret hint (Tab intentionally doesn't — it still selects all on arrival, unchanged)
      if(ev.key==="Tab") d={tok:ev.shiftKey?-1:1};
      else if(ev.key==="ArrowUp") d={tier:-1, caret:inp.selectionStart};   // vertical: preserve the column (character offset), like a text editor
      else if(ev.key==="ArrowDown") d={tier:1, caret:inp.selectionStart};
      else if(ev.key==="ArrowRight" && atEnd) d={tok:1, caret:"start"};   // horizontal: land at the near edge of the field you're entering
      else if(ev.key==="ArrowLeft" && atStart) d={tok:-1, caret:"end"};
      if(d){ ev.preventDefault(); ev.stopPropagation(); if(!passesGuard()) return;   // DELIBERATE: a refused value keeps the field open, with the text left to correct — Tab/arrow away is a commit like any other
        finish(true); nav(d); return; }
    }
    if(ev.key==="Enter"){ev.preventDefault(); if(passesGuard()) finish(true);} else if(ev.key==="Escape"){ev.preventDefault(); finish(false);} ev.stopPropagation(); });   // Escape never consults the guard: reverting is exactly what it is for
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
    if(wasOpen && !passesGuard()) inp.value=orig;   // a REFUSED value REVERTS on a blur (see opts.guard's note): the reader has clicked somewhere else, and holding the keyboard hostage to make them fix a field they have left is not a validation, it is a trap — the guard's own toast is what tells them nothing was written. Gated on wasOpen, or an already-closed field (Enter/Escape/nav/the double-click handoff, all of which finish() first) would re-run the guard on the way out and toast a second time
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
  inp.addEventListener("contextmenu",ev=>{ ev.preventDefault(); ev.stopPropagation(); const cs=sel.s, ct=sel.t;
    if(!passesGuard()) inp.value=orig;   // reaching for a MENU is not a commit either — same reading as the blur above
    finish(true);
    if(cs>=0&&ct>0) nodeTokenMenu(ev.clientX,ev.clientY,cs,ct); });
  /* ⚠ …AND A SECOND CLICK ON THE FIELD IS STILL WHATEVER THE ROW UNDER IT ANSWERS ON A DOUBLE-CLICK.
     The POS row has always opened its menu on a double-click as well as on a right-click (the posRelHit
     trigger further up), and once a FIRST click opens this field the second one lands on the <input> — which
     is appended to <body>, so the #doc dblclick handler can never see it and the gesture would simply have
     disappeared. `detail` is the browser's own count of the click run (time + position, not target), so the
     second press reads 2 here exactly as it would have on the tag.
     ONLY WHILE THE READER HAS NOT TYPED: once there is text of their own in the field, a double-click is a
     word selection, which is what an <input> is for and what they will be reaching for. `finish(false)`
     rather than a commit, because nothing has been typed by construction. */
  if(typeof opts.dbl==="function") inp.addEventListener("mousedown",ev=>{
    if(ev.detail<2||inp.value!==orig) return;
    ev.preventDefault(); ev.stopPropagation(); const x=ev.clientX, y=ev.clientY;
    finish(false); opts.dbl(x,y); });
  return inp; }   // the field itself, for a caller that wants to reach it after opening
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
function makeGlossEditableSC(el,obj,key,after,rtl,relocate,nav,caretHint,mglossTok,abbr){ if(!el)return; const orig=obj[key]||"", pre=snap();
  const box=document.createElement("div"); box.className="nodeedit glabbrbox"; box.contentEditable="plaintext-only";
  let fontStr; const applyFont=e=>{ const cs=getComputedStyle(e); const sizePx=visualFontPx(e)+"px";   // see makeEditable's applyFont: the size is CONVERTED, not multiplied by FS — the two engines report an SVG length inside a zoomed subtree differently (cssLenScale, js/core/document.js)
    box.style.fontFamily=cs.fontFamily; box.style.fontSize=sizePx; box.style.fontWeight=cs.fontWeight; box.style.fontStyle=cs.fontStyle; fontStr=cs.fontStyle+" "+cs.fontWeight+" "+sizePx+" "+cs.fontFamily;
    box.style.letterSpacing=((typeof trackEmOf==="function")?trackEmOf(fontStr):0)+"em"; };   // the row's own tracking, for exactly the reasons makeEditable's own applyFont states just above — this field measures itself with the same meas()/fontStr pair and so has the same obligation to paint what that measurement assumes
  applyFont(el);
  /* …and a tier that does not small-cap edits as plain text — the field must read while typing exactly
     as the row will once committed, which is this editor's whole reason for existing (see its note
     above). `abbr` is glossTierAbbr(tier), passed by the caller rather than re-derived here. */
  /* ⚠ AN EMPTY BOX GETS A `<br>`, OR WEBKIT PAINTS NO CARET IN IT AT ALL. A contenteditable with no content
     has no LINE BOX, and with no line box there is nowhere for the caret to be: measured in the shipping
     engine (a `.glabbrbox` styled exactly as this one, focused, its own contents selected), an empty box
     reports ZERO client rects for the selection, while the same box holding a single `<br>` reports a real
     0×16 caret rect at the box's own centre — the caret the reader is looking for. So clicking an
     un-annotated tier (which is now every tier that shows a TIER_EMPTY placeholder, and was always the
     gloss tiers' own `…`) opened a field that took typing but showed no cursor. Chrome paints one either
     way, which is why no headless run could see this.
     A `<br>` and not a zero-width space: `box.textContent` stays exactly "" through it, so `place()`'s own
     width measurement, `reflow`'s `caretOffset`, and `finish`'s `v=box.textContent.trim()` commit test all
     read the field as empty, which is what it is. A U+200B would be measured, committed and stripped again
     by INVISIBLE_RE downstream — a value where there is none. Re-added on every render (the field returns
     to empty as soon as the reader deletes the last character, and the caret has to survive that too). */
  const render=text=>{ box.innerHTML=""; if(!text){ box.appendChild(document.createElement("br")); return; }
    if(!abbr){ box.appendChild(document.createTextNode(text)); return; }
    glossAbbrSegments(text).forEach(([t,abbr])=>{
    if(!abbr){ box.appendChild(document.createTextNode(t)); return; }
    const s=document.createElement("span"); s.className="glabbr"; s.textContent=t; box.appendChild(s); }); };
  render(orig);
  const w0=Math.max(30,el.getBoundingClientRect().width+16);
  const place=()=>{ const r=el.getBoundingClientRect(), h=Math.max(16,r.height+2), cx=r.left+r.width/2, w=Math.max(w0, meas(box.textContent,fontStr)+18);
    box.style.width=w+"px"; box.style.height=h+"px"; box.style.left=(cx-w/2)+"px"; box.style.top=(r.top+r.height/2-h/2)+"px";
    box.style.padding=box.textContent?"0":"0 2px";   // see makeEditable's place() for why — zero once there's real text, a little breathing room around the bare caret when empty
    /* ⚠ AND AN EMPTY BOX IS NOT A FLEX CONTAINER, WHICH IS THE OTHER HALF OF "no caret in an empty
       gloss field" — reported again after the `<br>` and the collapsed selection had both been fixed.
       `.nodeedit.glabbrbox` is `display:flex` (app.css) to stand in for an input's vertical centring,
       and a flex container BLOCKIFIES EVERY CHILD: confirmed live in WKWebView, the lone `<br>` this
       field adds when empty reports `display:block` — it has become a flex ITEM, not a line break, so
       the container has no inline formatting context and no line box, and a caret placed at (box, 0)
       has nothing to sit on. That is why the `<br>` remedy worked where it was first measured and not
       here: `.sid-in`, `.bm-id` and `.tg-text` (keepEmptyCaret, js/core/document.js) are all plain
       BLOCKS, and this is the one field of the family that centres with flex.
       So the empty state joins that family — block, with the box's own height as the line-height,
       which is the same vertical centring by another route (and `.nodeedit`'s `text-align:center`
       already does the horizontal half that `justify-content` was doing). The flex centring comes
       back the moment there is text to centre, which is the only state it was ever needed for: the
       partial small-caps run this editor exists to paint cannot exist in an empty field.
       ⚠ Re-applied on every `place()`, not once at open: `reflow` calls `place()` on every input, so
       the box switches back and forth as the reader types the first character and deletes it again. */
    const bare=!box.textContent;
    box.style.display=bare?"block":"";
    box.style.lineHeight=bare?h+"px":"";
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
  /* ⚠ …AND AN EMPTY FIELD TAKES A CARET, NOT AN EMPTY SELECTION. Reported: "empty gloss input fields
     don't show a caret". Select-all is right for a field with text in it and is a no-op statement
     about one without: `selectNodeContents` over the bare `<br>` above leaves the selection
     NON-COLLAPSED, and an engine paints a caret only for a collapsed one — a highlight is what it
     paints instead, and this one is 0px wide. Measured on the empty lexical-gloss row: focused,
     `textContent` "", one selection rect 0×18, `isCollapsed` FALSE. So the field took typing and
     showed nothing, which is the same symptom the `<br>` above was added to cure and only half of
     its cause: the missing line box was one half, an uncollapsed selection sitting on it the other.
     `.bm-id` already draws this line (focusBoundId, js/core/document.js: "empty field → a caret, not
     an empty selection") — the same remedy, in the same shape, at the editor that had not had it.
     Collapse to the START, so the caret sits on the box's first line rather than after the `<br>`. */
  if(!_placedAtClick){ const range=document.createRange(); range.selectNodeContents(box);
    if(!box.textContent) range.collapse(true);
    const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }   // select-all on open, like inp.select() — keyboard-triggered opens with no hint at all, or caretRangeFromPoint missing/out of bounds
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
  /* ⚠ THE ROW COMES IN **BEFORE** THE ELEMENT IS RESOLVED, and that order is the whole of a bug this had
     for one round: `lemRowForce` re-renders the block, so a node captured ahead of it is DETACHED by the
     time the field opens over it — the field then measures a stale box and lands away from the form the
     reader clicked. Force first, then ask the freshly-built DOM where the form is. */
  if(typeof lemForceHold==="function") lemForceHold();        // …and claim it, for the same reason the lemma editor does
  if(typeof lemRowForce==="function") lemRowForce(si,true);   // …no-op when the row is already drawn, or when `show.lemma` is off (the reader's own standing choice, which an edit does not overrule)
  const el=formElOf(si,tokId);
  if(!el){ const c=document.querySelector(`[data-si="${si}"][data-ti="${tokId-1}"][data-col="form"]`); if(c)c.focus(); if(typeof lemForceRelease==="function") lemForceRelease(); return; }   // no visible node → fall back to the grid cell (and let go of the row we just brought in)
  /* ⚠ A FORM EDIT BRINGS THE LEMMA ROW IN TOO, on instruction ("when the lemma tier is empty, it should come
     out of hiding when the user is editing token forms"). The row hides for a sentence in which no lemma
     differs from its form — and editing a FORM is precisely the gesture that can make one differ, so the row
     the reader is about to need is the one currently not there. It also puts "lemma" back in `navStack`
     (through `lemForced`), which is what lets Tab/↓ reach the lemma from the form field at all: without the
     force there is no row in the stack to step onto.
     `lemRowForce` answers false when there is nothing to do — the row is already drawn, or `show.lemma` is
     off, which is the reader's own standing choice and not an edit's to overrule — so the common case costs
     one test. Taken back out FIRST in the commit, ahead of `afterDiagramFormEdit`'s own cascade, exactly as
     the lemma editor orders the same pair; if the edit has made the lemma differ, the re-render inside
     `lemRowForce` keeps the row on its own merits and the slide measures 0. */
  makeEditable(el, s.tokens[tokId-1], "form",
    changed=>{ if(typeof lemForceRelease==="function") lemForceRelease();   // …on the NEXT TICK, so tabbing on to another field keeps the row (see lemForceRelease)
      afterDiagramFormEdit(si,tokId,changed); },
    sentRTL(s), ()=>formElOf(si,tokId), d=>tierNav(si,tokId,"form",d), false, clickXY); }   // item 4: the form row joins the gloss-tier arrow/Tab navigation. afterDiagramFormEdit = pick + the ITRANS→IAST pass + afterFormEdit, shared with the IAST-row route above
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
   ⚠ item 29 SUPERSEDES THE PREMISE OF THAT PARAGRAPH FOR SOME TOKENS, AND THIS FUNCTION STAYS FOR THE
   REST. There IS a lemma row in every notation now (belowStack/.bwlemma/.olemma), and where it paints,
   the ordinary inline editor is what opens on it — editLemmaInline above, laid over that row exactly as
   the reasoning here says an inline editor must be. But the row is deliberately BLANK for a token with
   no lemma differing from its form (lemmaRowTxt, js/diagram/diagram-core.js), where nothing is drawn.
   ⚠ AND item 31 NARROWS THIS FUNCTION'S REMIT AGAIN, to a genuine fallback. A blank slot now carries a
   transparent target, and a sentence with no row grows one for the duration of an edit, so "Edit lemma…"/⌘L go
   through editLemmaAt: the inline field first, this popover only where that cannot open — the tier switched
   OFF in Show/Hide (a standing choice an edit may not overrule), or a block that is not rendered at all. Both
   editors write the same column and both go through afterLemmaEdit.
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
window.editLemmaShortcut=()=>{ if(sel.s>=0&&sel.t>0)editLemmaAt(sel.s,sel.t); };   // item 31: …through editLemmaAt, which prefers the inline field over the row (bringing the row in if this sentence has none) and falls back to this popover — see its own note
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
   `si` names the sentence whose header was clicked and is passed on to ALLCOLS. That list is document-wide today —
   the per-sentence gate it once applied went with the transliteration columns (see ALLCOLS, js/grid/grid.js) — and
   the argument is threaded anyway, since the caller has it and a future per-sentence column would want it. */
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
// grid row menu — no "Edit" rows here (a grid cell is already its own editor, click to edit in
// place, so a separate "Edit token" command would be redundant): Split/Merge lead the menu instead,
// where "immediately after Edit" lands when there is no Edit row to follow — see nodeTokenMenu's own
// note on why the two families (split/merge vs. move/insert/select-head) don't mix.
function tokenMenu(x,y,si,idx,target){ const s=DOC[si]; const rng=(selRange&&selRange.s===si&&selRange.to>selRange.from&&idx+1>=selRange.from&&idx+1<=selRange.to)?selRange:null;
  pick(si,idx+1,false); const tokId=idx+1;
  const combineItems=[...mwtTokenItems(si,tokId)];
  if(rng && !rangeIsMWT(si,rng.from,rng.to)){
    if(mergeIsSolid(s,rng.from,rng.to)) combineItems.unshift([`Merge ${rng.from}–${rng.to} into one token`,"⌃⌘M",()=>mergeTokens(si,rng.from,rng.to)]);   // the same pair the diagram's node menu offers, in the same order — Group (keeps the tokens) above Merge (does not), and Merge only across a seam the line writes solid
    combineItems.unshift([`Group ${rng.from}–${rng.to} as MWT`,"⌘G",()=>addMWT(si,rng.from,rng.to)]); }
  const items=[
    ...combineItems,
    null, ...moveItems(si,tokId,true),
    null, ...insertItems(si,tokId,true),
    null, ...headItems(si,tokId),
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

