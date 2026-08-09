//@module js/diagram-render.js
/* renderers */
// every conjunct (1-based token id) in the SAME coordination as `x`: x itself, the coordination's head conjunct
// (x's own head if x is itself a conj-family dependent, else x), and every OTHER token that is a conj-family
// dependent of that same head — i.e. the full N-way coordination, not just x's immediate head/dependent side.
// Sorted ascending; always includes x. Drives the Shared=Yes ghost-edge/ghost-row rendering below: a shared
// dependent gets one real edge (to whichever conjunct it's actually attached to) plus a dashed "ghost" to every
// OTHER member this returns.
function conjunctsOf(tokens,x){ const tk=tokens[x-1]; if(!tk) return [x];
  const H=famOf(tk.deprel)==="conj"?parseInt(tk.head,10):x;
  if(!(H>=1&&H<=tokens.length)) return [x];
  const set=new Set([H,x]);
  tokens.forEach((tt,i)=>{ if(famOf(tt.deprel)==="conj"&&parseInt(tt.head,10)===H) set.add(i+1); });
  return [...set].sort((a,b)=>a-b); }
function otherConjuncts(tokens,x){ if(!show.extRel) return []; return conjunctsOf(tokens,x).filter(c=>c!==x); }   // show.extRel ("Extended relations", Show/Hide menu) gates the Shared=Yes ghost edges at the source — every renderer that calls this simply gets nothing to draw
// every ghost pair [originIdx0based, targetIdx0based] for a token array — the SAME enumeration Shared=Yes/Subj-
// raising ghost rendering uses everywhere else, exposed once here so stemma()/tree() can also feed it into
// applyGhostDepth (below) BEFORE they compute any Y-position from depth.
function ghostPairsFor(t){ const n=t.length, pairs=[];   // [originIdx, targetIdx, rel] triples — rel travels WITH the pair so a token that happened to carry BOTH Shared=Yes and a Subj value (unusual, but not disallowed) still labels each of its ghosts correctly, rather than one clobbering the other's label
  for(let i=0;i<n;i++){ if(!hasFeat(t[i].feats,"Shared","Yes")) continue; const hid=parseInt(t[i].head,10); if(!(hid>=1&&hid<=n)) continue;
    otherConjuncts(t,hid).forEach(oc=>{ const oh=oc-1; if(oh===hid-1||oh<0||oh>=n) return; pairs.push([i,oh,t[i].deprel]); }); }
  // Subj lives on the PREDICATE (i, e.g. "go"); the crawl finds the RAISED ARGUMENT (oh, e.g. "he") — which is
  // the ghost's ORIGIN/dependent (it renders as a ghost subj dependent OF the predicate), not the other way round.
  for(let i=0;i<n;i++){ const oh=subjGhostTarget(t,i); if(oh==null||oh<0||oh>=n||oh===i) continue; pairs.push([oh,i,"subj"]); }
  return pairs; }
// item 4 (stemma/tree only): a node's rendered DEPTH is no longer determined purely by its own real ancestry —
// a ghost's ORIGIN (the Shared/Subj token, the dependent end of the ghost edge) is pushed to sit BELOW its
// ghost TARGET, exactly as a real dependent always sits below its real head. Pulling the target shallower instead
// doesn't work: a node's depth is always exactly its real parent's depth + 1, so a "never rise above your own
// real parent" clamp always equals the node's current depth already — there is never any room to rise into.
// Pushing the origin DEEPER has no such ceiling: it only ever moves the origin (and its own real subtree, so its
// internal spacing stays consistent) further from the root, which can never invert the origin's own real
// head→dependent edge. Iterates to a fixed point since one push can change another pair's origin-vs-target
// relationship (bounded to n+1 passes as a generous safety cap against a pathological cycle). Mutates `depth`.
function applyGhostDepth(depth,head,ghostPairs,n){
  const children=Array.from({length:n},()=>[]);
  for(let i=0;i<n;i++){ const h=head[i]; if(h>=1&&h<=n&&h!==i+1) children[h-1].push(i); }
  const shift=(i,delta)=>{ depth[i]+=delta; children[i].forEach(c=>shift(c,delta)); };
  for(let pass=0,changed=true; changed&&pass<n+1; pass++){ changed=false;
    ghostPairs.forEach(([o,tg])=>{ if(o<0||o>=n||tg<0||tg>=n) return;
      const want=depth[tg]+1;
      if(want>depth[o]){ shift(o,want-depth[o]); changed=true; } }); } }
// Ghost-label decollision (stemma/tree — HORIZONTAL-only, matching those views' own real-label convention): only
// the GHOST labels in `ghostLabs` are ever moved; `fixed` (real labels + node/box positions already placed this
// render) is read but never altered. Each ghostLabs entry needs {mx,my,text}; mutates .mx in place, nudging by
// alternating +/- steps of increasing size until clear (or the guard runs out — a rare leftover overlap beats an
// infinite loop). Returns nothing; callers read the mutated .mx back.
function decollideGhostsH(ghostLabs,fixed,labelFont){
  const placed=fixed.slice();
  ghostLabs.forEach(L=>{ const half=meas(L.text,labelFont||POS_F)/2+3, hy=7;
    let x=L.mx, guard=0;
    while(guard<40 && placed.some(p=>Math.abs(p.x-x)<p.hx+half && Math.abs(p.y-L.my)<p.hy+hy)){ guard++; const step=Math.ceil(guard/2)*(2*half+4); x=L.mx+(guard%2?1:-1)*step; }
    L.mx=x; placed.push({x,y:L.my,hx:half,hy}); }); }
// Ghost-arc endpoint fanning (arcs/arcsWrapped/brackets/bracketsWrapped — item 7): a ghost always shares an
// endpoint TOKEN with some real arc/edge (it originates from a token that already has its own real head edge, or
// targets a token that already has its own real edges) — so its endpoint must fan OUTWARD from wherever the reals
// already sit, never the reverse. `realArcs` have already had fanArcs(realArcs,spread) run on them (their offH/
// offD are final and untouched here); `ghostArcs` need the SAME {hk,dk,hkey?,dkey?,xh,xd} shape and get offH/offD
// assigned, continuing past the real occupancy at each bucket+side (including the reals' own central "0" slot).
function fanGhostArcs(realArcs,ghostArcs,spread){
  const maxReal={};
  const bump=(k,off)=>{ const slot=Math.round(Math.abs(off||0)/spread); maxReal[k]=Math.max(maxReal[k]||0,slot); };
  realArcs.forEach(a=>{ bump(a.hkey??a.hk,a.offH); bump(a.dkey??a.dk,a.offD); });
  const ghostSlot={};
  ghostArcs.forEach(a=>{ const hk=a.hkey??a.hk, hSide=Math.sign(a.xd-a.xh)||1, hK=hk+"|"+hSide;
    ghostSlot[hK]=(ghostSlot[hK]!=null?ghostSlot[hK]:(maxReal[hk]||0))+1; a.offH=hSide*ghostSlot[hK]*spread;
    const dk=a.dkey??a.dk, dSide=Math.sign(a.xh-a.xd)||1, dK=dk+"|"+dSide;
    ghostSlot[dK]=(ghostSlot[dK]!=null?ghostSlot[dK]:(maxReal[dk]||0))+1; a.offD=dSide*ghostSlot[dK]*spread; }); }
function renderSentence(si){
  const el=_renderSentence(si);
  /* …and then, where the engine cannot shape this script in SVG at all, swap every affected <text> for
     an HTML one (smpReshape, js/diagram/diagram-core.js). Done HERE, on the finished element, rather
     than at the nine sites that build a form: those sites differ per notation and each sets its own
     data-* / cursor / tooltip afterwards, and a sweep over the result cannot miss one — including any
     added later. A no-op on every engine and every script that shapes normally, which is all of them
     but the supplementary-plane Brahmic ones on WebKit. */
  if(typeof smpReshape==="function") smpReshape(el);
  return el;
}
function _renderSentence(si){
  if(conv==="arcs") return arcs(si);
  if(conv==="tree") return tree(si);
  if(conv==="brackets") return brackets(si);
  if(conv==="outline") return outline(si);
  return stemma(si,{proj:stemmaProj,catNodes:stemmaCat});
}

function stemma(si,{proj,catNodes}){
  const D=displaySent(DOC[si]), t=D.tokens, n=t.length, OID=k=>D.map[k]+1, sent={tokens:t}; RTL=D.rtl;
  const {c,lw,ldw}=stemmaLayout(sent,catNodes,proj&&show.pos),{head,depth}=structure(sent);   // ldw: the per-node inline-START reserve (leads / Subject=Generic band) — spreadForLabels needs it, with lw, to re-seat the figure on its leftmost node's real slot edge rather than on that node's centre (see its own note)
  const ghostPairs=ghostPairsFor(t);   // [originIdx,targetIdx], 0-based — computed once, before ANY Y-position is derived from depth
  applyGhostDepth(depth,head,ghostPairs,n);   // item 4: a ghost's TARGET is pulled above its shallowest ghost dependent, cascading to its own real subtree — replaces the earlier per-edge "swap which end draws where" hack (which never touched real node positions)
  const LV=48,TOP=18,A=16,B=7,realMaxD=Math.max(0,...depth),ny=d=>TOP+d*LV;   // shorter edges; A above clears ascenders; TOP is small so the root (no incoming edge) gets no extra headroom. ⚠ Raising TOP alone to "lower the diagram tokens" was tried and reverted — fitTight(svg,boxes) crops tight to whatever `boxes` says regardless of where TOP puts it, so the whole figure just gets re-cropped around its new position with the SAME margin: no visible headroom gained, confirmed by measurement. See TOK_Y_LOWER (js/diagram/diagram-core.js) for the fix that actually works — the asymmetry applied PER TOKEN (glyph drawn at ny+TOK_Y_LOWER, its crop box still recorded at ny) rather than to TOP, so the root gains real headroom while every edge laid out from this ny stays exactly where it is
  /* THE ROOT NODE'S OWN CROP RESERVE MUST GROW WITH IT, on request ("lzh diagram tokens need more space on
     top, to account for their increased size"). TOP itself deliberately stays a small constant (see the note
     above) because the ACTUAL top margin comes from fitTight(svg,boxes) cropping to the union of `boxes` — and
     every node's box (below, `boxes.push({…hy:9})`) reserved a flat 9px tuned for NODE_F at TOK_MAG 1. A
     magnified node — any INDIC_SCRIPTS/ORNAMENTAL_SCRIPTS script, or lzh (scriptMag(), js/lang/translit.js) —
     draws its glyph at up to 2× that size, and the ROOT sits at depth 0, i.e. literally the topmost thing this
     function draws: the flat 9px under-reserved the magnified glyph's real ink, cropping the root's own
     ascenders off the top of the SVG (a big enough word or a stacked-mark script's letters read as clipped/
     crowded against the very top of the block). Same closed-form term WORD_OFF/belowGap() already use for "how much
     MORE ascent a magnified face reaches than an unmagnified one would" — ascent(NODE_F) is already the
     MAGNIFIED font's own ascent (NODE_F=magFont(14)), so subtracting the unmagnified ascent it implies
     (÷TOK_MAG) isolates just the extra. Exactly 0 at TOK_MAG 1, so an unmagnified document's crop is
     byte-identical to before. */
  const NODE_ASC_EXTRA=TOK_MAG>1?ascent(NODE_F)*(1-1/TOK_MAG):0;
  /* ⚠ AND THE SAME TERM ON THE DESCENDER SIDE, FOR THE EDGE THAT LEAVES A NODE'S UNDERSIDE. B is a flat 7px
     below the LAYOUT baseline, tuned when a node was an unmagnified 15px face; a magnified one (lzh, any
     INDIC_SCRIPTS/ORNAMENTAL_SCRIPTS member) descends further and was ALREADY grazing that endpoint before
     this file lowered anything — measured on a synthetic all-descender head ("gyppy") at TOK_MAG 1 / 1.5 / 2:
     3.64px / 1.96px / 0.28px of real ink clearance, i.e. the flat 7 was degrading toward a touch on its own.
     TOK_Y_LOWER then spends 2.5 of whatever is left (1.14 / −0.54 / −2.22 — an actual OVERLAP at both
     magnifications), so the magnification's own extra descent is added back here. Restores ~1.1px at every
     magnification, which is what TOK_MAG 1 has.
     ⚠ EXACTLY 0 AT TOK_MAG 1, which is the point: "the edges do not move" (see TOK_Y_LOWER,
     js/diagram/diagram-core.js) holds byte-for-byte in every unmagnified document — every document but the
     magnified-script ones — and the one place an endpoint DOES move is the one place the alternative was a
     glyph drawn through a line. Same closed form NODE_ASC_EXTRA above and belowGap() already use. */
  const NODE_DESC_EXTRA=TOK_MAG>1?descent(NODE_F)*(1-1/TOK_MAG):0, BB=B+NODE_DESC_EXTRA;
  // Subject=Generic: the ∅ sits one level BELOW its predicate (ny(depth[i]+1), like any dependent) — if the predicate
  // is already at the deepest REAL level, that lands exactly where baseY/the bottom margin was sized for, with no
  // room of its own. Raise the whole figure's reserved depth by one extra level so the ∅ gets genuine space.
  const maxD=[...Array(n).keys()].some(i=>hasGenericSubj(t,i)&&depth[i]===realMaxD)?realMaxD+1:realMaxD;
  const SPW=meas(" ",WORD_F);
  const edges=[];
  for(let i=0;i<n;i++){const h=head[i]; if(h<1||h>n||h===i+1) continue;
    const y1=ny(depth[i])-A, y2=ny(depth[h-1])+BB, midY=(y1+y2)/2;
    edges.push({d:i,h:h-1,rel:t[i].deprel,y1,y2,midY,band:Math.round(midY/12),w:show.labels?meas(t[i].deprel,POS_F)+SPW:0});}
  if(show.labels){ spreadForLabels(c,edges,lw,ldw); }   // widen node gaps until labels fit (in natural order). lw/ldw are for its CLOSING re-seat only (it never widens by them — that is ensureNodeGaps' job below): without them it pulls the leftmost node's CENTRE to x=2 and leaves that node's own slot at negative x, where fitTight's left clamp refuses to grow the viewBox and the SVG clips it — see spreadForLabels' own note
  ensureNodeGaps(c,lw);   // …then re-guarantee each node's OWN below-stack width — spreading for edge labels alone can leave that narrower than stemmaLayout reserved (see ensureNodeGaps' own note)
  edges.sort((p,q)=>catRank(p.rel)-catRank(q.rel));         // subj in front, then comp, mod, other
  // Shared=Yes: a coordination-shared dependent draws its REAL edge normally (straight to whichever conjunct
  // it's actually attached to, like any other edge) PLUS a dashed "ghost" edge — same deprel/label/direction —
  // to every OTHER conjunct in the same coordination (conjunctsOf), so it visibly belongs to the whole
  // coordination rather than reading as attached to just one conjunct. Purely decorative: no data-dep/data-s,
  // no click handler (see .ghost-g{pointer-events:none}).
  // item 4: depth[] (adjusted above) already keeps every ghost target above its dependents, so the dependent
  // (origin) always draws at the "d" role and the target always at "h" — no per-edge swap needed any more; a
  // defensive fallback (draw whichever is geometrically deeper as "d") only matters if the parent-floor clamp
  // in applyGhostDepth couldn't fully resolve a pathological case.
  const orientGhost=(origin,target)=>depth[origin]<depth[target]?{d:target,h:origin}:{d:origin,h:target};
  const ghostEdges=ghostPairs.map(([o,tg,rel])=>{ const {d,h}=orientGhost(o,tg);
    return {d,h,rel,origin:o,y1:ny(depth[d])-A,y2:ny(depth[h])+BB}; });
  const total=Math.max(2,...c.map((cx,i)=>cx+lw[i]/2))+2;
  mirror(c,total);                                          // NOW flip for RTL, after label spacing is settled
  const belowH=proj?belowReserveH(trLayer(),belowTierN(),show.pos):0, tieH=proj?mwtDepth(D):0;   // Item 1/8: every below-row (translit, each gloss, POS) folds in descent(POS_F), matching belowStack's descender-matched per-row step
  const rep=reportOffsets(D);   // item 7/11: the BASELINE word row is the stemma's "line", so that is what a reported subtree steps UP off; the depth-positioned nodes above stay put (their y ENCODES depth — nudging it would read as a layout error, not as a plane)
  const maxRep=Math.max(0,...rep);   // #3: the deepest reported raising (highest step off the line). The baseline drops by this — see baseY — so the gap is sized to the deepest reporting level
  const baseY=TOP+maxD*LV+(proj?LV+maxRep:0), lowest=proj?baseY:ny(maxD), H=lowest+16+belowH+tieH;   // baseline sits one level (LV) below the lowest node; #3: dropped a further maxRep so a token raised by its reported-speech step (by=baseY−rep[i]) STILL clears the lowest tier by the full LV — the most-raised token lands exactly one level below, the rest hang beneath it
  const svg=E("svg",{class:"tree",width:total,height:H,viewBox:`0 0 ${total} ${H}`}); const boxes=[];
  let baseBot=baseY;
  // Subject=Generic: the ∅ virtual token — computed HERE (declaration + positions) so the proj baseline block below,
  // the ghost-label decollision pass, and the node-band draw can all reference it (was declared far below its
  // first use in the proj block → a temporal-dead-zone ReferenceError that blanked the whole diagram).
  const genericEntries=[]; for(let i=0;i<n;i++) if(hasGenericSubj(t,i)) genericEntries.push({i});
  genericEntries.forEach(ge=>{ const i=ge.i, gapAmt=genericSubjGapW(t,i,catNodes?POS_F:NODE_F);
    ge.emptyX=c[i]-lw[i]/2-gapAmt/2; ge.gy=ny(depth[i]+1); ge.y1=ge.gy-A; ge.y2=ny(depth[i])+BB; });
  if(proj){ const bformW=t.map(tk=>fmeas(tk,NODE_F));   // the baseline word's own ink-width alone — the tie hugs THIS, not `lw` (which is padded to fit the hierarchy NODE label/POS-below and shouldn't stretch a tie meant to visually group surface-form parts)
    for(let i=0;i<n;i++){ const by=baseY-rep[i], byD=by+TOK_Y_LOWER+NODE_Y_EXTRA, loB=loBoxes(boxes);   // …+NODE_Y_EXTRA, the extra 1.5 asked of "stemma nodes" — read as every token glyph this notation draws, node and baseline word alike, since a caveat about the TRANSLITERATION gap can only be about the row that has one (see the constant's own note)   // by = the LAYOUT baseline (what every `boxes` entry below records, and what the projection line above ends its clearance from); byD = the DRAW baseline the word and its whole stack actually render on — see TOK_Y_LOWER (js/diagram/diagram-core.js)
    svg.appendChild(E("line",{class:"proj",x1:c[i],y1:by-16,x2:c[i],y2:ny(depth[i])+BB}));   // the projection line follows its word down, so node and word stay tied together. Drawn baseline→node (bottom to top) so the dash pattern anchors at the baseline — a dot sits cleanly on the word end and any partial dash lands at the node, matching the icon   // an EDGE: both ends stay on the LAYOUT baselines, so the lowered word simply hangs 2.5px further below the line's foot
    const bg=E("g",{class:"tok-group"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});   // baseline words are clickable too
    const bwidth=Math.max(24,bformW[i]+8);
    const hitW=Math.max(bwidth, trTxt(t[i])?meas(trTxt(t[i]),trFont(t[i]))+10:0, show.pos&&t[i].upos?meas(posDisp(t[i]),POS_F)+10:0);   // widen to the transliteration/POS below (a short word can romanise to a wider string)
    bg.appendChild(E("rect",{class:"tok-hit tok-wash",x:c[i]-hitW/2,y:byD-14,width:hitW,height:24+belowH+TOK_Y_LOWER+TOK_TR_GAP}));   // baseline hit already spans just the word+POS band → doubles as the drag-target wash   // seated on the DRAW baseline so the wash stays centred on the glyph it highlights, and grown by the same 2.5 so the (lowered) POS row is still inside it
    const bw=E("text",{class:"baseword"+italDeco(t[i]),x:c[i],y:byD}); bw.textContent=bform(t[i]); boxes.push({x:c[i],y:by-6,hx:bwidth/2,hy:9});   // host form only, centred on c[i]
    /* ⚠ +TOK_TR_GAP, the SAME 2.5px the arc view's own below-stack takes (js/diagram/diagram-core.js), on
       request once that landed: "arcs view is perfect; the token-transliteration gap in stemmas and
       brackets should be sized to match". Seeded here rather than in belowGap() for the reason that
       constant's note gives — the hierarchy wants this same step tighter. Only the ROWS move; the
       baseline word's own <text> stays on byD. Stemma's NON-proj mode needs nothing: its nodes carry no
       below-stack at all, the transliteration existing only on this baseline row. */
    baseBot=Math.max(baseBot, belowStack(bg,c[i],byD+TOK_TR_GAP,t[i],loB,hasTr(t)));
    bg.appendChild(bw); gwFormSVG(bg,bw,t[i],c[i],byD,NODE_F,"baseword",si,loB); svgMarks(bg,c[i],byD,t[i],NODE_F); svgFormSeamMark(bg,t[i],c[i],byD,NODE_F,loB);   // Item 11: baseline form appended LAST → paints on TOP of the POS/translit stack; item 4: marks in front of it. The seam mark rides beside the form, like the below-stack rows carry their own   // goeswith: the continuation parts join the head on this row (and re-seat it), so the ONE below-stack drawn above spans the whole word. The slur itself comes from the tie layer below (mwtTie)
    if(gwOf(t[i]).length) bg.setAttribute("data-gw",[OID(i)].concat(gwOf(t[i]).map(p=>p.oid)).join(" "));   // selecting EITHER half lights the whole word — see gwHolds/applySel
    bg.style.cursor="pointer"; bg.addEventListener("click",()=>pick(si,OID(i))); svg.appendChild(bg);
    drawHangsSVG(svg,t[i],c[i],byD,NODE_F,"baseword",si,loB,OID(i)); drawLeadsSVG(svg,t[i],c[i],byD,NODE_F,"baseword",si,loB,OID(i)); }   // folded punctuation (and item 6's correct form) beside the baseline word
    // Subject=Generic: give the ∅ the SAME node→baseline pairing every real token gets in proj mode — a projection
    // line down from its node height (ge.gy, already used by the diagonal ghost edge above) to a baseline glyph
    // of its own, rather than leaving it floating at node height with no baseline presence at all.
    genericEntries.forEach(ge=>{ const i=ge.i, by=baseY-rep[i];
      svg.appendChild(E("line",{class:"proj proj-ghost",x1:ge.emptyX,y1:by-16,x2:ge.emptyX,y2:ge.gy+BB}));
      const g=E("g",{class:"ghost-g","data-s":si});   // NEVER highlighted via the predicate's own selection — see the diagonal ghost edge below for why (same relation, same direction mistake to avoid)
      const glbl=E("text",{class:"node-lbl",x:ge.emptyX,y:by+TOK_Y_LOWER+NODE_Y_EXTRA}); glbl.textContent="∅"; g.appendChild(glbl);   // the ∅ is a virtual TOKEN, so it lowers with every real one; its box stays on the layout baseline like theirs
      svg.appendChild(g); boxes.push({x:ge.emptyX,y:by-6,hx:8,hy:9}); });
    mwtTie(svg,c,bformW,D,baseBot+5,loBoxes(boxes),si); }   // baseBot already came back from the lowered belowStack, so the tie hangs the same distance under the (lowered) word — and loBoxes puts its crop back on the layout baseline
  // edges as ONE cased unit: pre-compute each stroke path + arrowhead, then draw ALL their casings first (a single
  // layer behind every edge → the edge-set occludes the tokens/proj-lines behind it cleanly, but edges DON'T case
  // against each OTHER), then the strokes + arrowheads on top (per-edge groups keep click/selection). Item 21.
  edges.forEach(e=>{ e._ink=arcInk(relColor(e.rel)); let a1=[c[e.d],e.y1], a2=[c[e.h],e.y2];
    if(show.arrows){const dir=arrowDir(e.rel); if(dir){const tip=dir==="dep"?a1:a2,frm=dir==="dep"?a2:a1;
      e._ah=arrowPath(frm,tip,5.25); e._ahc=arrowPath(frm,tip,5.25,AH_OUTSET); if(dir==="dep") a1=backoff(tip,frm,5.25); else a2=backoff(tip,frm,5.25);}}   // the casing head is the SAME head (same s, same tip) uniformly OUTSET by AH_OUTSET, not a longer one: passing a bigger s (this was 6.375) left the apex and both leading edges sitting on the stroke head's own, so the halo showed only behind the head
    e._d=`M ${a1[0]} ${a1[1]} L ${a2[0]} ${a2[1]}`; });
  { const cg=E("g",{class:"edge-cases"}); cg.setAttribute("aria-hidden","true");   // combined casing behind all edges + arrowheads
    edges.forEach(e=>{ cg.appendChild(E("path",{class:"arc-casing",d:e._d})); if(e._ahc) cg.appendChild(E("path",{class:"ah-casing",d:e._ahc})); }); svg.appendChild(cg); }
  edges.forEach(e=>{ const g=E("g",{class:"edge-g","data-s":si,"data-dep":OID(e.d),"data-head":OID(e.h)});
    if(e._ah) g.appendChild(E("path",{class:"ah",d:e._ah,fill:e._ink}));
    g.appendChild(E("path",{class:"edge"+(isMorphRel(e.rel)?" morph-edge":""),d:e._d,stroke:e._ink}));
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(e.d))); svg.appendChild(g);});
  if(show.labels){   // pass 2: all labels in front of all edges (so their casing occludes crossing edges)
    // HORIZONTAL-ONLY de-collision: every stemma label sits at its NATURAL edge-midpoint y — no vertical lift, no
    // dashed leaders. Overlaps are resolved solely by spreadForLabels (run above), which widens node gaps so
    // converging labels separate horizontally while staying on their own edge baselines. (The flat ARC view keeps
    // its vertical lift + leaders; stemma/hierarchy do not.)
    edges.forEach(e=>{ const mx=(c[e.d]+c[e.h])/2, my=e.midY, lg=E("g",{class:"edge-g","data-s":si,"data-dep":OID(e.d),"data-head":OID(e.h)});
      drawLabel(lg,mx,my,e.rel,relColor(e.rel));
      lg.style.cursor="pointer"; lg.addEventListener("click",()=>pick(si,OID(e.d))); svg.appendChild(lg); boxes.push({x:mx,y:my,hx:meas(e.rel,POS_F)/2+2,hy:7}); }); }
  // Subject=Generic positions (genericEntries) are computed near the top of stemma() now, so they're available to the
  // proj baseline block above and to this decollision pass below (both need ge.emptyX/gy/y1/y2).
  // ghost label positions, decollided (HORIZONTAL-only, matching stemma's own real-label convention): ONLY ghost
  // labels move — `boxes` (every real edge/node/label already placed this render) is read but never altered.
  const ghostLabs=show.labels?[...ghostEdges.map(e=>({mx:(c[e.d]+c[e.h])/2,my:(e.y1+e.y2)/2,text:e.rel,e})),
    ...genericEntries.map(ge=>({mx:(ge.emptyX+c[ge.i])/2,my:(ge.y1+ge.y2)/2,text:"subj",e:ge}))]:[];
  if(show.labels) decollideGhostsH(ghostLabs,boxes);
  const ghostLabAt=new Map(ghostLabs.map(L=>[L.e,L]));
  ghostEdges.forEach(e=>{ const ink=arcInk(relColor(e.rel)); let a1=[c[e.d],e.y1], a2=[c[e.h],e.y2], ah=null;
    if(show.arrows){ const dir=arrowDir(e.rel); if(dir){ const tip=dir==="dep"?a1:a2,frm=dir==="dep"?a2:a1;
      ah=arrowPath(frm,tip,5.25); if(dir==="dep") a1=backoff(tip,frm,5.25); else a2=backoff(tip,frm,5.25); } }
    const g=E("g",{class:"ghost-g"+(sel.s===si&&sel.t===OID(e.d)?" sel":""),"data-s":si,"data-dep":OID(e.d)});   // item 3: highlighted when its DEPENDENT is selected, like a real edge
    if(ah) g.appendChild(E("path",{class:"ah ah-ghost",d:ah,fill:ink}));
    g.appendChild(E("path",{class:"edge edge-ghost",d:`M ${a1[0]} ${a1[1]} L ${a2[0]} ${a2[1]}`,stroke:ink}));
    boxes.push({x:(a1[0]+a2[0])/2,y:(a1[1]+a2[1])/2,hx:Math.abs(a2[0]-a1[0])/2,hy:Math.abs(a2[1]-a1[1])/2+2});   // item 2: the ghost's own line extent counts toward fitTight's crop
    if(show.labels){ const L=ghostLabAt.get(e); drawLabel(g,L.mx,L.my,e.rel,relColor(e.rel)); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:L.mx,y:L.my,hx:meas(e.rel,POS_F)/2+2,hy:7}); }
    svg.appendChild(g); });
  // item 2 (redesign): Subject=Generic — the ∅ is a virtual TOKEN, drawn in the real reserved band just before the
  // predicate (stemmaLayout already left the space) at the SAME depth a real dependent would sit — not
  // editable/interactable/grid-visible, but positioned exactly like any other token would be.
  genericEntries.forEach(ge=>{ const i=ge.i, col=relColor("subj"), ink=arcInk(col);
    const g=E("g",{class:"ghost-g","data-s":si});   // NEVER highlighted via the predicate's own selection: the predicate is this relation's HEAD, not its dependent — a real edge highlights on the DEPENDENT's selection, and the ∅ dependent has no real token of its own to select, so this stays purely decorative (no data-dep, no .sel) instead of wrongly keying off the predicate
    g.appendChild(E("path",{class:"edge edge-ghost",d:`M ${ge.emptyX} ${ge.y1} L ${c[i]} ${ge.y2}`,stroke:ink}));   // an EDGE: untouched, both ends on the layout baselines
    const glbl=E("text",{class:"node-lbl",x:ge.emptyX,y:ge.gy+TOK_Y_LOWER+NODE_Y_EXTRA}); glbl.textContent="∅"; g.appendChild(glbl);   // …but the ∅ NODE lowers with every other node glyph (its box below stays on ge.gy)
    if(show.labels){ const L=ghostLabAt.get(ge); drawLabel(g,L.mx,L.my,"subj",col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:L.mx,y:L.my,hx:meas("subj",POS_F)/2+2,hy:7}); }
    boxes.push({x:ge.emptyX,y:ge.gy,hx:8,hy:9+NODE_ASC_EXTRA});   // "∅" is drawn .node-lbl too, so it magnifies with every other node glyph — see NODE_ASC_EXTRA's own note
    svg.appendChild(g); });
  for(let i=0;i<n;i++){const g=E("g",{class:"node"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});
    const txt=catNodes?(posDisp(t[i])||"X"):bform(t[i]), tw=catNodes?meas(txt,POS_F):fmeas(t[i],NODE_F);   // item 11: stemma word-node label uses bform → the SCRIPT glyph-swap applies to stemma nodes too
    const nyL=ny(depth[i]), nyD=nyL+TOK_Y_LOWER+NODE_Y_EXTRA, loB=loBoxes(boxes);   // nyL = the LAYOUT level (every edge endpoint and every box below is stated in it); nyD = where this node's own glyph and satellites actually draw — see TOK_Y_LOWER (js/diagram/diagram-core.js)
    const lbl=E("text",{class:(catNodes?"node-cat":"node-lbl"+italDeco(t[i])),x:c[i],y:nyD}); lbl.textContent=txt; if(catNodes) svgTip(lbl,posTitle(t[i].upos));   // stemma POS-as-node → POS hover tooltip (Item 2)
    const hit=E("rect",{class:"tok-hit tok-wash",x:c[i]-Math.max(26,tw/2+4),y:nyD-A,width:Math.max(52,tw+8),height:A+B});   // node box = its own wash region (no arcs above a node)   // seated on the DRAW level: the wash exists to backlight the GLYPH, so it tracks it rather than the edge endpoints, and A+B is far wider than the glyph either way
    g.appendChild(hit); g.appendChild(lbl); if(!catNodes){ gwFormSVG(g,lbl,t[i],c[i],nyD,NODE_F,"node-lbl",si,loB); svgMarks(g,c[i],nyD,t[i],NODE_F); svgFormSeamMark(g,t[i],c[i],nyD,NODE_F,loB); } g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i))); svg.appendChild(g);   // item 4: marks in front of the node label. A POS-as-node label is a TAG, not the word, so it takes no seam mark   // goeswith: a word node shows the whole word, so both parts are drawn here too (a POS-as-node label is not the word and takes none)
    if(gwOf(t[i]).length){ g.setAttribute("data-gw",[OID(i)].concat(gwOf(t[i]).map(p=>p.oid)).join(" "));
      if(!proj&&!catNodes) gwSlurSVG(svg,c[i]-tw/2,c[i]+tw/2,nyD+descent(NODE_F)+tieLead(),si,[OID(i)].concat(gwOf(t[i]).map(p=>p.oid)),loB); }   // …and, with NO baseline row (proj off), the slur belongs to the node — seated by the SAME tieLead() rule the tie layer uses, just measured from the node's own descender line instead of a below-stack bottom. With proj ON the baseline row's tie layer draws it (mwtTie below), so exactly one slur is drawn per word either way
    if(!catNodes){ drawHangsSVG(svg,t[i],c[i],nyD,NODE_F,"node-lbl",si,loB,OID(i)); drawLeadsSVG(svg,t[i],c[i],nyD,NODE_F,"node-lbl",si,loB,OID(i)); }   // folded-punctuation satellites beside the word node (POS-as-node has no word to host them)
    boxes.push({x:c[i],y:nyL-5,hx:tw/2+2,hy:9+(catNodes?0:NODE_ASC_EXTRA)});}   // …on the LAYOUT level, deliberately: the glyph is drawn TOK_Y_LOWER below this, and holding the crop here is what turns the drop into headroom above the root instead of a re-hung figure   // catNodes draws POS_F (unmagnified) here, not the word glyph — see NODE_ASC_EXTRA's own note; gating on it keeps a POS-as-node stemma byte-identical
  fitTight(svg,boxes);   // crop tight so proj/non-proj get the same (minimal) top padding
  return wrapDiagram(svg,si);
}

function arcs(si){
  const D=displaySent(DOC[si]), t=D.tokens, n=t.length, OID=k=>D.map[k]+1, sent={tokens:t}; RTL=D.rtl;
  const rep=reportOffsets(D);   // item 7/11: per-token UPWARD step for reported speech (0 on the main line). Both the word AND its arc endpoint lift by rep[i], so the reported cluster floats OFF the line as one unit — the arc endpoints move with the words (item 11), not just the words under fixed arcs.
  const {c,w,wform,total}=linear(sent); mirror(c,total);
  const ROW=parseFloat(css("--arc-row")),NR=parseFloat(css("--arc-node-r")),SH=parseFloat(css("--arc-shoulder")),AH=parseFloat(css("--arrow"));
  /* small top headroom (matches the stemma's tight top). Item 1 (revert of item 15): the arc endpoints
     clear the tokens by the ORIGINAL flat 16px again — item 15 had raised this to POSGAP(20)+descent(WORD_F)
     to line the arc ends up with the deprel-label baseline in brackets/wrapped-stemma, but the user wants
     the arcs back at their natural height. Only the arc view reverts; brackets/wrapped-stemma keep the
     item-15 offset. ⚠ AND THE FLAT 16 IS WHAT A MAGNIFIED SCRIPT EATS INTO: this gap is measured from the
     arc's own geometry down to the WORD's baseline, so a token's ascent reaching further above that
     baseline (Literary Chinese now magnifies its Han glyphs 1.5× — see scriptMag()) shrinks the arc's real
     clearance by exactly however much extra ascent the glyph gained, the same shape belowGap() already
     accounts for on the other side of the token. Measured on a real lzh sentence: the arc-to-glyph gap
     fell from 8.4px unmagnified to 4.2px at 1.5× — visibly tight, though not yet touching. Exactly the
     old flat 16 whenever TOK_MAG is 1, which is every document but the newly-magnified ones. */
  /* ⚠ AND THE ASCENT HERE IS **NOT** `scriptHeadlinePx`, THOUGH --dia-pad-extra's IS — asked, measured and
     rejected. The two terms look alike (both are "how much more ascent a magnified face reaches") and answer
     different questions: --dia-pad-extra reserves BLANK SPACE between the block's running-sentence header
     and the diagram, where letting a repha or a vowel sign use the sky above the head-line costs nothing;
     WORD_OFF is a CLEARANCE BETWEEN TWO DRAWN THINGS — the arc endpoints above and the glyph's real ink
     below — and the marks that overshoot the head-line are precisely what has to clear them. Measured in the
     shipping WKWebView (samples/brihat_jataka.conllu, flat arcs, arc-path bottom to glyph ink top, min over
     the first six tokens): Rañjanā's tokens' own `actualBoundingBoxAscent` is 24.41px against a measured
     head-line of 19.61, Siddhaṃ's 23.33 against 20.48 — so substituting the head-line would spend 2.4/1.4px
     of a clearance that measures 6.25/3.33 today, taking Siddhaṃ to −0.58, i.e. an overlap. The reported
     "Rañjanā and Siddhaṃ are still too low in arcs" is answered where the dead space actually is, which is
     --dia-pad-extra in this notation (js/diagram/diagram-core.js, refreshFontStacks) — 13.4px of it, against
     the ~2.4px an honest ink-ascent correction could win here at the cost of the clearance.
     ⚠️ NOR IS THE foreignObject SEAT FOLDED IN HERE — but not because the rise is harmless: it is corrected at its own
     source instead (smpReshape's `fo.y`, js/diagram/diagram-core.js). This clause used to read that arcs'
     spacing was "the spacing earlier rounds explicitly measured and approved WITH the seat error present",
     and the measurement retired that: WITH the error, the clearance from the lowest arc ink down to the
     glyph's ink top ran Grantha −8.27, Soyombo −6.92, Kawi −5.31, Zanabazar Square −3.16 (Siddhaṃ +3.33)
     against +3.42 for Devanagari and +6.25 for Rañjanā — i.e. this view was drawing its arcs THROUGH four
     of the five swapped scripts, which no round approved. With the seat corrected they read +1.73, +4.08,
     +0.69, +2.34 and +7.33 — all clear, all inside the band the two controls define — and WORD_OFF itself
     is untouched: the glyph came down to the gap this term already reserves rather than the gap being
     widened to chase it. */
  const TOP=8, WORD_OFF=16+(TOK_MAG>1?ascent(WORD_F)*(1-1/TOK_MAG):0);
  const list=t.map((tk,i)=>({from:parseInt(tk.head,10),to:i+1,dep:tk.deprel}))
    .filter(a=>a.from!==a.to && a.from>=1 && a.from<=n)   // include punctuation edges
    .map(a=>({...a,lo:Math.min(a.from,a.to),hi:Math.max(a.from,a.to)}))
    .sort((a,b)=>(a.hi-a.lo)-(b.hi-b.lo));
  const rootI=t.findIndex((tk)=>{const h=parseInt(tk.head,10); return h===0||isNaN(h)||h<1||h>n;});
  /* spread the endpoints above each node so arcs meeting at one token fan out by a uniform step: the
     edge up to the head (or, at the root, the root stub) sits dead-centre, and the edges down to the
     dependents fan out to either side, the shortest taking the outermost slot. The fan is computed FIRST
     so each arc's height is measured from its FANNED endpoints, not the raw node centres. */
  const SPREAD=fanStep(), epAt={};   // uniform fan step between endpoints meeting at one node
  const regEp=(node,len,side,central,set)=>{(epAt[node]=epAt[node]||[]).push({len,side,central,set});};
  list.forEach(a=>{const len=a.hi-a.lo;
    regEp(a.from,len,Math.sign(c[a.to-1]-c[a.from-1])||1,false,o=>a.off1=o);   // side by actual x (mirrors under RTL) → outgoing edge fans
    regEp(a.to,  len,Math.sign(c[a.from-1]-c[a.to-1])||1,true, o=>a.off2=o);}); // this node is the dependent → incoming edge is central
  let rootOff=0;
  if(rootI>=0) regEp(rootI+1,Infinity,0,true,o=>rootOff=o);
  Object.values(epAt).forEach(arr=>{
    arr.filter(e=>e.central).forEach(e=>e.set(0));                                    // head edge / root stub → centre
    [-1,1].forEach(side=>{ arr.filter(e=>e.side===side && !e.central)
      .sort((p,q)=>q.len-p.len).forEach((e,j)=>e.set(side*(j+1)*SPREAD)); }); });     // dependents fan outward, shortest furthest
  // endpoints sit directly on the fanned targets → measure arc width (and Hobby height) from THEM
  list.forEach(a=>{ a.X1=c[a.from-1]+(a.off1||0); a.X2=c[a.to-1]+(a.off2||0); a.mx=(a.X1+a.X2)/2;
    a.h=arcHgt(Math.abs(a.X2-a.X1),ROW); a.col=relColor(a.dep); });
  // Shared=Yes: the real arc draws normally (to whichever conjunct it's actually attached to, like any other
  // arc — no more "spring from the conj edge's apex" override); a dashed "ghost" arc (same deprel/label) is
  // added to every OTHER conjunct in the coordination (otherConjuncts) — purely decorative, drawn below.
  // Subj (subject-raising): a token dragged onto a subj/comp:obj/comp:obl/root edge gets a dashed "subj" ghost
  // arc to its re-derived target (subjGhostTarget) — same decorative treatment.
  // ghostPairsFor gives [originIdx,targetIdx,rel] 0-based; here "to" is the arc's dependent-side token id (1-based,
  // matching a real arc's own `to`) and "from" is its head-side (the OTHER conjunct, or the Subj predicate).
  const ghostPairs=ghostPairsFor(t).map(([o,tg,rel])=>({from:tg+1,to:o+1,dep:rel}));
  // item 7: fan each ghost's endpoints against the SAME per-token buckets the reals already resolved (epAt/off1/
  // off2, set above) — continuing past whatever slot a real occupies there (including its own central "0" slot),
  // never the reverse. maxRealSlot tracks, per node+side, how far out the reals already reach.
  const maxRealSlot={};
  const bumpRealSlot=(node,off)=>{ const o=off||0;
    if(o===0){ const k1=node+"|1",k2=node+"|-1"; maxRealSlot[k1]=Math.max(maxRealSlot[k1]||0,0); maxRealSlot[k2]=Math.max(maxRealSlot[k2]||0,0); }
    else { const side=Math.sign(o), k=node+"|"+side; maxRealSlot[k]=Math.max(maxRealSlot[k]||0,Math.round(Math.abs(o)/SPREAD)); } };
  list.forEach(a=>{ bumpRealSlot(a.from,a.off1); bumpRealSlot(a.to,a.off2); });
  const genericToks=[]; for(let i=0;i<n;i++) if(hasGenericSubj(t,i)) genericToks.push(i);
  const ghostSlot={};
  const ghostArcs=ghostPairs.map(p=>{
    const hSide=Math.sign(c[p.to-1]-c[p.from-1])||1, hK=p.from+"|"+hSide;
    ghostSlot[hK]=(ghostSlot[hK]!=null?ghostSlot[hK]:(maxRealSlot[hK]||0))+1;
    const dSide=Math.sign(c[p.from-1]-c[p.to-1])||1, dK=p.to+"|"+dSide;
    ghostSlot[dK]=(ghostSlot[dK]!=null?ghostSlot[dK]:(maxRealSlot[dK]||0))+1;
    const X1=c[p.from-1]+hSide*ghostSlot[hK]*SPREAD, X2=c[p.to-1]+dSide*ghostSlot[dK]*SPREAD, h=arcHgt(Math.abs(X2-X1),ROW);
    return {from:p.from,to:p.to,dep:p.dep,X1,X2,mx:(X1+X2)/2,h,col:relColor(p.dep)}; });
  // item 2: Subject=Generic folds into this SAME ghostArcs array — same endpoint-fanning at the predicate's shared
  // bucket, same label-decollision pass below — rather than being computed as a disconnected afterthought (which
  // is what let its label collide with a real label sitting at the same spot). Its "∅" side has no real token to
  // fan/look up, so that endpoint is the pre-reserved gap centre directly; isEmpty flags it for the draw pass.
  genericToks.forEach(i=>{ const gapAmt=genericSubjGapW(t,i), emptyX0=c[i]-w[i]/2-gapAmt/2;
    const dSide=Math.sign(emptyX0-c[i])||1, dK=(i+1)+"|"+dSide;   // shares the SAME "to" bucket any other arc landing on this predicate uses
    ghostSlot[dK]=(ghostSlot[dK]!=null?ghostSlot[dK]:(maxRealSlot[dK]||0))+1;
    const predX=c[i]+dSide*ghostSlot[dK]*SPREAD, h=arcHgt(Math.abs(emptyX0-predX),ROW);   // the predicate is the HEAD of this subj relation, the ∅ is its dependent — X1 (tail) sits at the predicate, X2 (arrowhead) at the ∅, matching a real subj arc's head→dependent direction
    ghostArcs.push({from:i+1,to:i+1,dep:"subj",X1:predX,X2:emptyX0,mx:(emptyX0+predX)/2,h,col:relColor("subj"),isEmpty:true}); });
  const maxHeight=Math.max(12,...list.map(a=>a.h),...ghostArcs.map(a=>a.h));   // ghost heights count too, so a distant ghost target never clips the top padding
  const arcZone=TOP+ARC_APEX*maxHeight+4, wordY=arcZone+WORD_OFF;   // reserve to the tallest arc's visible PEAK (0.75·h), not its handle height — so the top clearance over the crown is constant regardless of arc height (the crown then lands at TOP+4)
  // item 11: the endpoint/crown geometry comes from the SHARED repArcEnds (js/diagram/diagram-core.js) — the same
  // call arcsWrapped() makes, so the flat and wrapped arc views cannot drift on what a report does to an arc
  list.forEach(a=>{ const e=repArcEnds(rep,arcZone,a.from-1,a.to-1,a.h); a.y1=e.y1; a.y2=e.y2; a.apexY=e.apexY; });
  ghostArcs.forEach(a=>{ const e=repArcEnds(rep,arcZone,a.from-1,a.to-1,a.h); a.y1=e.y1; a.y2=e.y2; a.apexY=e.apexY; });   // a ghost duplicates a real attachment, so it lifts by exactly the same rule
  const rootY=rootI>=0?repBase(rep,arcZone,rootI):arcZone;   // item 11: a reported root lifts its stub too
  const rTop=list.length?Math.min(...list.map(a=>a.apexY)):arcZone-26;   // peak of the tallest arc (ignore the Bézier handles)
  const svg=E("svg",{class:"tree",width:total,height:wordY+30,viewBox:`0 0 ${total} ${wordY+30}`}); const boxes=[];
  const labs=[];    // collected for vertical de-collision after all arcs are drawn
  const realEdgeP=[];   // every REAL arc's control points, for the ghost-label pass far below (item 6, second clause — see edgeObstacle in js/diagram/diagram-wrap.js for what it is for). Kept as raw control points and flattened there, once, only if labels are on. The wrapped view has to read this back off the DOM groups because it redraws edges after the fact; here nothing touches an arc once drawn, so the geometry can simply be collected as it is computed — EXCEPT the root stub, which decollide-equivalent code below may grow, and which is therefore added at the reading end
  let rootPath=null,rootCasing=null,rootXc=0,rootBottomY=0,rootG=null,rootCol="";
  if(rootI>=0){const col=relColor("root"),ink=arcInk(col),x=c[rootI]+rootOff,tip=[x,rootY],frm=[x,rTop],b=backoff(tip,frm,AH);   // the stub reaches the node position (no circle); item 11: a reported root's stub foot lifts to rootY
    const g=E("g",{class:"arc","data-s":si,"data-dep":OID(rootI)}); rootG=g; rootCol=col;
    rootCasing=E("path",{class:"arc-casing",d:`M ${x} ${rTop} L ${b[0]} ${b[1]}`}); g.appendChild(rootCasing);
    g.appendChild(E("path",{class:"ah-casing",d:arrowPath(frm,tip,AH,AH_OUTSET)}));   // same head, uniformly outset by the line casing's own halo — NOT a longer head (was AH+1.5, which haloed the back only)
    rootPath=E("path",{class:"arc-path",d:`M ${x} ${rTop} L ${b[0]} ${b[1]}`,stroke:ink}); g.appendChild(rootPath); rootXc=x; rootBottomY=b[1];
    g.appendChild(E("path",{class:"ah",d:arrowPath(frm,tip,AH),fill:ink}));
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(rootI))); svg.appendChild(g);
    // the root stub reaches only rTop (the apex of the tallest non-root arc); if its label lifts to avoid a
    // collision it is tied back with a leader — the stub itself does NOT grow taller
    if(show.labels) labs.push({dep:OID(rootI),mx:x,y0:rTop-9,apex:rTop,text:t[rootI].deprel||"root",col,level:maxHeight+100,root:true});}
  const arcG={};   // dep OID → its arc <g>, so the leader can be drawn in the SAME z-layer as the arc
  list.slice().sort((a,b)=>b.h-a.h || catRank(a.dep)-catRank(b.dep)).forEach(a=>{   // taller (wider) arcs first → shorter (lower) arcs drawn on top (in front)
    const P=arcCtrl2(a.X1,a.y1,a.X2,a.y2,a.h);   // item 11: per-endpoint baseline (reported speech lifts an endpoint); reduces to arcCtrl when both are on the line
    const te=trimT(P,1,AH-AEXT), sl=(te>0.001&&te<0.999)?subCurve(P,0,te):P;   // stop the line at the arrowhead base (dependent end)
    const dstr=`M ${sl[0][0]} ${sl[0][1]} C ${sl[1][0]} ${sl[1][1]}, ${sl[2][0]} ${sl[2][1]}, ${sl[3][0]} ${sl[3][1]}`;
    const g=E("g",{class:"arc","data-s":si,"data-dep":OID(a.to-1),"data-head":OID(a.from-1)}), ink=arcInk(a.col);
    g.appendChild(E("path",{class:"arc-casing",d:dstr}));                       // halo so a crossing front arrow occludes this one
    g.appendChild(E("path",{class:"ah-casing",d:arrowPath(P[2],P[3],AH,AH_OUTSET)}));   // same head, uniformly outset by the line casing's own halo — NOT a longer head (was AH+1.5, which haloed the back only)
    g.appendChild(E("path",{class:"arc-path"+(isMorphRel(a.dep)?" morph-edge":""),d:dstr,stroke:ink}));   // an mSUD "/m" arc dashes like its stemma/hierarchy counterpart — the STROKE only, casing and arrowhead stay solid
    g.appendChild(E("path",{class:"ah",d:arrowPath(P[2],P[3],AH),fill:ink}));
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(a.to-1))); svg.appendChild(g);
    arcG[OID(a.to-1)]=g; boxes.push({x:a.mx,y:a.apexY,hx:2,hy:2});     // arc crown in the bounding box
    realEdgeP.push(P);   // UNTRIMMED (the drawn line stops at the arrowhead base, but the head fills on to P[3])
    if(show.labels) labs.push({dep:OID(a.to-1),mx:a.mx,y0:a.apexY-8,apex:a.apexY,text:a.dep,col:a.col,level:a.h});});
  // Shared=Yes / Subject-raising ghost arcs: dashed, dimmed, drawn at their own natural apex. The LINE draws now
  // (item 2: its crown counts toward fitTight's boxes); its LABEL is deferred until after the real labels'
  // decollision pass below finishes, so it can be lifted (item 6: only ghost labels move — never a real one)
  // clear of every already-placed real label, using the exact same vertical-lift algorithm.
  const ghostG={};
  ghostArcs.forEach((a,gi)=>{ const P=arcCtrl2(a.X1,a.y1,a.X2,a.y2,a.h), ink=arcInk(a.col);
    const te=trimT(P,1,AH-AEXT), sl=(te>0.001&&te<0.999)?subCurve(P,0,te):P;
    const dstr=`M ${sl[0][0]} ${sl[0][1]} C ${sl[1][0]} ${sl[1][1]}, ${sl[2][0]} ${sl[2][1]}, ${sl[3][0]} ${sl[3][1]}`;
    const g=E("g",{class:"ghost-g"+(!a.isEmpty&&sel.s===si&&sel.t===OID(a.to-1)?" sel":""),"data-s":si});   // item 3 (Shared=Yes/Subject-raising — real dependent, highlights correctly). isEmpty (Subject=Generic): NEVER via selection — the predicate is this relation's HEAD, and highlighting a dependency edge on its HEAD's selection has the direction backwards; the ∅ dependent has no real token to select instead, so no data-dep/.sel at all here
    if(!a.isEmpty) g.setAttribute("data-dep",OID(a.to-1));
    g.appendChild(E("path",{class:"arc-path arc-ghost",d:dstr,stroke:ink}));
    g.appendChild(E("path",{class:"ah ah-ghost",d:arrowPath(P[2],P[3],AH),fill:ink}));   // NO outset argument, deliberately: a ghost draws no .arc-casing/.ah-casing at all (it is meant to read as a duplicate, not to occlude what it crosses), so there is no halo for the head to match — same for the stemma ghost head above
    if(a.isEmpty){ const glbl=E("text",{class:"tok-word",x:a.X2,y:repBase(rep,wordY,a.from-1)+TOK_Y_LOWER,"text-anchor":"middle"}); glbl.textContent="∅"; g.appendChild(glbl);   // …and, being a virtual TOKEN on that row, it lowers with every real one (its box below is arc geometry and stays)   // Subject=Generic: the ∅ glyph itself sits on the WORD row, not the arc-attachment height a.y1 uses — and it's now at X2 (the arrowhead end), since the ∅ is the dependent. Its row is the PREDICATE's own (lifted) word baseline, via the shared repBase — a ∅ inside a report steps off the line with the predicate it hangs from
      boxes.push({x:a.X2,y:a.y1-8,hx:8,hy:12}); }
    boxes.push({x:a.mx,y:a.apexY,hx:2,hy:2});   // item 2/11: the ghost's own (possibly lifted) crown, from the shared repArcEnds above, counts toward fitTight's crop
    svg.appendChild(g); ghostG[gi]=g; });
  /* labels hug each arc crown; processed SHORTEST-arc first, each is lifted UP above every (shorter) label
     already placed — so there are no collisions AND a taller arc's label always ends up above a shorter one's */
  const placed=[];
  labs.sort((p,q)=>p.level-q.level || p.mx-q.mx).forEach(L=>{ const half=meas(L.text,POS_F)/2+3, hh=7;
    let y=L.y0, guard=0;
    while(guard++<40 && placed.some(p=>Math.abs(p.x-L.mx)<p.hx+half && Math.abs(p.y-y)<p.hy+hh)) y-=hh*2+3;   // lift until clear of all placed (shorter) labels
    L.fy=y; L.hh=hh; placed.push({x:L.mx,y,hx:half,hy:hh,level:L.level}); boxes.push({x:L.mx,y,hx:half,hy:hh}); });
  // The real EDGES as de-collision obstacles, flattened once (edgeObstacle, js/diagram/diagram-wrap.js — where the
  // reasoning lives: a ghost label carries drawLabel's opaque casing, so parked on a real arc it erases a bite out
  // of it, which is the one occlusion a ghost is built never to commit). The root stub joins them only now, with
  // its FINAL top: `labs` are placed above, so whether the stub grows to a lifted root label (the pass below) is
  // already decided — read from decollide's own condition rather than from the `d` it will be given.
  const realEdges=(show.labels&&ghostArcs.length)?realEdgeP.map(edgeObstacle):[], EPAD=edgePad();   // built only where there is a ghost to place — a sentence with none (the overwhelming majority) pays nothing for this
  if(show.labels&&ghostArcs.length&&rootPath){   // the same guard as above, NOT `realEdges.length` — a sentence whose only real edge IS the root stub would otherwise contribute no obstacle at all
    const RL=labs.find(L=>L.root), ty=(RL&&RL.fy<RL.y0-0.5)?RL.fy+RL.hh:rTop;
    realEdges.push(edgeObstacle([[rootXc,ty],[rootXc,ty],[rootXc,rootY],[rootXc,rootY]])); }   // the stub as the degenerate cubic edgeObstacle traces as a segment; down to the arrowhead TIP (rootY), not the backed-off line end
  // ghost labels: SAME vertical-lift algorithm, run AFTER the real pass above so `placed` already holds every
  // real label's FINAL position (read, never altered) — only the ghost labels themselves ever move (item 6).
  if(show.labels) ghostArcs.forEach((a,gi)=>{ const half=meas(a.dep,POS_F)/2+3, hh=7, y0=a.apexY-8;   // item 11: hug the ghost's own (possibly report-lifted) crown, the same apexY the real labels above hug — not the un-lifted arcZone crown, which left a lifted ghost's label buried under its own arc
    let y=y0, guard=0;
    while(guard++<40 && placed.some(p=>Math.abs(p.x-a.mx)<p.hx+half && Math.abs(p.y-y)<p.hy+hh)) y-=hh*2+3;
    // …then off the real EDGES too — same step, and the label test rides along so a higher slot can't land back on
    // a real label. Bounded separately and falling back to the label-only answer: above every label there is open
    // sky, so THAT pass always terminates, but an edge can run the whole height of the diagram beside this x, and
    // a ghost label parked far up on a long leader reads worse than one grazing an arc. Ghosts are excluded from
    // the obstacles by construction (only `list` arcs and the root stub are collected), which is deliberate: a
    // ghost defers to the real annotation, not to another ghost — its own edge included.
    for(let k=0,ya=y;k<10;k++){ if(!(placed.some(p=>Math.abs(p.x-a.mx)<p.hx+half && Math.abs(p.y-ya)<p.hy+hh) || boxHitsEdges(realEdges,a.mx,ya,half+EPAD,hh+EPAD))){ y=ya; break; } ya-=hh*2+3; }
    placed.push({x:a.mx,y,hx:half,hy:hh});
    const g=ghostG[gi];
    if(y<y0-0.5) g.insertBefore(E("line",{class:"leader leader-ghost",x1:a.mx,y1:y+hh,x2:a.mx,y2:a.apexY,stroke:arcInk(a.col)}),g.firstChild);   // item 6: tie a lifted ghost label back to its crown (item 11: its LIFTED crown, so the leader still lands on the arc)   /* the drained ink, NOT the full relation colour: the ghost EDGE is stroked with arcInk(col) while this leader took `col` raw, so at the same .72 opacity the leader read as the strongest part of a ghost — the one thing it is least meant to be. arcInk is what every other ghost stroke already passes through. */
    drawLabel(g,a.mx,y,a.dep,a.col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost");
    boxes.push({x:a.mx,y,hx:half,hy:hh}); });
  /* a lifted label is tied back to its crown. The root is a straight stub, so when its label lifts the STUB
     itself grows taller to reach it; a non-root bump can't grow, so it gets a leader — inserted as the FIRST
     children of its OWN arc's group, so it draws behind that arc (crown never obscured) yet shares the arc's
     z among the arcs (in front of whatever the arc itself is in front of). */
  labs.forEach(L=>{ if(L.fy>=L.y0-0.5) return;
    if(L.root){ if(rootPath){ const dd=`M ${rootXc} ${L.fy+L.hh} L ${rootXc} ${rootBottomY}`; rootPath.setAttribute("d",dd); if(rootCasing)rootCasing.setAttribute("d",dd); } return; }   // grow the root stub up to its lifted label
    const g=arcG[L.dep]; if(!g) return; const y1=L.fy+L.hh, y2=L.apex;
    g.insertBefore(E("line",{class:"leader",x1:L.mx,y1,x2:L.mx,y2,stroke:L.col}),g.firstChild);
    g.insertBefore(E("line",{class:"leader-casing",x1:L.mx,y1,x2:L.mx,y2}),g.firstChild); });
  /* label TEXTS last → in front of all arcs, their opaque casing occluding crossing edges cleanly */
  labs.forEach(L=>{ const lg=E("g",{class:"arc","data-s":si,"data-dep":L.dep}); lg.style.cursor="pointer"; lg.addEventListener("click",()=>pick(si,L.dep));
    drawLabel(lg,L.mx,L.fy,L.text,L.col); svg.appendChild(lg); });
  const stackH=wordY+TOK_Y_LOWER+TOK_TR_GAP+belowReserveH(trLayer(),belowTierN(),show.pos)+8;   // hit-rect reach: cover the transliteration + gloss + POS rows below the word (Item 1/8: every below-row folds in descent(POS_F), matching belowStack's descender-matched step)   // +TOK_Y_LOWER because the whole stack now DRAWS that much lower (see TOK_Y_LOWER, js/diagram/diagram-core.js) — the reach has to follow the ink, not the layout
  let stackBot=wordY;
  t.forEach((tk,i)=>{const g=E("g",{class:"tok-group"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});
    const wy=repBase(rep,wordY,i);   // item 11: the word, its below-stack, its hit/wash band and its tail all lift by rep[i] — the SAME shared repBase the arc endpoint above went through — so the reported token and its arc float off the line together
    const wyD=wy+TOK_Y_LOWER, loB=loBoxes(boxes);   // wy = the LAYOUT baseline every `boxes` entry here records; wyD = where the word and its stack actually draw. The ARCS above keep arcZone/repArcEnds untouched, so what this opens is the arc-to-glyph clearance
    const hy=Math.min(arcZone-NR, wyD-14);   // hit/wash top follows the (lifted) content so a raised word isn't left above the band
    const f=E("text",{class:"tok-word"+italDeco(tk),x:c[i],y:wyD,"text-anchor":"middle"}); f.textContent=bform(tk);   // host form only; folded punctuation is drawn as separate satellites below
    const hit=E("rect",{class:"tok-hit",x:c[i]-w[i]/2-3,y:hy,width:w[i]+6,height:stackH-hy});
    g.appendChild(hit); g.appendChild(E("rect",{class:"tok-wash",x:c[i]-w[i]/2-3,y:wyD-14,width:w[i]+6,height:stackH-(wyD-14)}));   // wash covers only the word+POS band, not the arcs the tall hit-rect spans
    /* ⚠ THE BELOW-STACK IS SEEDED TOK_TR_GAP LOWER THAN THE WORD IT HANGS FROM, on request ("in arcs, the
       space needs to be increased by 2.5px"), and since the follow-up ("sized to match") also the seed
       stemma and both bracket views use. The seed is the one place this gap is expressible per notation:
       belowGap() is shared with the hierarchy, which wants this same step TIGHTER (TR_TIGHTEN,
       js/diagram/diagram-core.js), so neither number may live in the shared function. Only the ROWS move —
       the word's own <text> stays on wyD — and the boxes move with them (loB subtracts only TOK_Y_LOWER),
       because unlike that lowering this is a real change of position the crop must reserve. 0 outside lzh. */
    stackBot=Math.max(stackBot, belowStack(g,c[i],wyD+TOK_TR_GAP,tk,loB,hasTr(t)));   // transliteration + POS below the word
    g.appendChild(f);   // Item 11: form appended LAST → paints on TOP of the POS/translit stack
    gwFormSVG(g,f,tk,c[i],wyD,WORD_F,"tok-word",si,loB);   // goeswith: the continuation parts join the head on the word row (and re-seat it); the one below-stack drawn above already spans the whole word, and the slur comes from the tie layer (mwtTie below)
    if(gwOf(tk).length) g.setAttribute("data-gw",[OID(i)].concat(gwOf(tk).map(p=>p.oid)).join(" "));   // selecting EITHER half lights the whole word — see gwHolds/applySel
    svgMarks(g,c[i],wyD,tk,WORD_F); svgFormSeamMark(g,tk,c[i],wyD,WORD_F,loB);   // item 4: Typo strikethrough, IN FRONT of the glyphs; then the seam mark hung off the form's inline end
    g.style.cursor="pointer";
    g.addEventListener("click",()=>pick(si,OID(i)));
    g.addEventListener("mouseenter",()=>dim(si,OID(i))); g.addEventListener("mouseleave",()=>dim(si,null)); svg.appendChild(g);
    boxes.push({x:c[i],y:wy-8,hx:w[i]/2,hy:12});
    drawHangsSVG(svg,tk,c[i],wyD,WORD_F,"tok-word",si,loB,OID(i)); drawLeadsSVG(svg,tk,c[i],wyD,WORD_F,"tok-word",si,loB,OID(i));});   // folded punctuation (and item 6's correct form) as separate elements beside the word
  mwtTie(svg,c,wform,D,stackBot+5,loBoxes(boxes),si);   // surface-form ties for multi-word tokens — hug the FORM's own ink width, not the (POS/deprel-widened) slot
  fitTight(svg,boxes);
  return wrapDiagram(svg,si);
}
