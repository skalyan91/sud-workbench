//@module js/diagram-wrap.js
/* if a finished diagram is wider than the scroll port, re-render it as stacked wrapped rows instead */
function wrapDiagram(svg,si){
  if(show.wrap && si!=null && AVAILW>0){ const w=+svg.getAttribute("width");   // compare zoomed width to the port
    if(w*FS>AVAILW-6){ if(conv==="arcs"){ const x=arcsWrapped(si); if(x) return x; }
      if(conv==="brackets"){ const x=bracketsWrapped(si); if(x) return x; }
      if(conv==="stemma"){ const x=projWrapped(si,"stemma"); if(x) return x; }
      if(conv==="tree"){ const x=projWrapped(si,"tree"); if(x) return x; } } }
  return wrap(svg);
}
/* wide brackets view → greedy: a constituent that fits on its line stays flat; one that overflows expands its
   children onto indented lines, recursing into whichever child still overflows (first subconstituent first) */
function bracketsWrapped(si){
  const D=displaySent(DOC[si]); RTL=D.rtl; const t=D.tokens, n=t.length, OID=k=>D.map[k]+1;
  const {children,head,root}=structure({tokens:t});
  // ghost pairs, grouped by ORIGIN (the token whose OWN element carries data-ghostheads, drawn as the ghost's
  // dependent) — Shared=Yes: the token itself; Subj: the raised argument the crawl finds, NOT the predicate.
  const ghostsByOrigin=Array.from({length:n},()=>[]);
  ghostPairsFor(t).forEach(([o,tg,rel])=>{ if(o>=0&&o<n&&tg>=0&&tg<n) ghostsByOrigin[o].push([tg,rel]); });
  // tree spans, then a DISPLAY tree: attach every token to the SMALLEST constituent whose surface span contains
  // it. That display tree is always projective, so it linearises cleanly in surface order and the brackets nest
  // exactly as in the flat view. A token whose display-parent isn't its real head is an INTERRUPTER (it sits, in
  // surface order, inside a constituent it doesn't belong to): it stays in place, bracketed, and is tied to its
  // head by a cross-line arc — exactly as the flat bracket view does.
  const disc=Array(n),fin=Array(n); let _dt=0;
  (function dfs(i){disc[i]=_dt++; children[i].forEach(c=>dfs(c)); fin[i]=_dt++;})(root);
  const isRealDesc=(anc,x)=>disc[anc]<=disc[x]&&disc[x]<=fin[anc];   // x is anc's descendant (or anc itself) in the REAL head tree, via Euler-tour discovery/finish times — UNCONDITIONAL (every real child folds in), independent of the interrupt-aware tlo/thi computed below
  // UNCONDITIONAL full subtree spans (every real child folds in) — used ONLY to find, per constituent, which OTHER
  // tokens sit inside its numeric span (case b below). NOT what brackets nest from (see the corrected tlo/thi
  // further down): folding everything in unconditionally is exactly what let mūrtitve's span reach out to bhṛtaḥ.
  const rtlo=Array(n),rthi=Array(n);
  (function rdfs(i){rtlo[i]=i;rthi[i]=i; children[i].forEach(c=>{rdfs(c); rtlo[i]=Math.min(rtlo[i],rtlo[c]); rthi[i]=Math.max(rthi[i],rthi[c]); });})(root);
  // INTERRUPTER, the SAME two complementary shapes diagram-wrap.js's flat brackets() computes (see its own comment
  // for the full derivation — kept in sync here so the two renderers can't disagree about which token gets the arc):
  //  (b) THE ORDINARY CASE — an UNRELATED token p (no ancestor/descendant relation to C either way) sits inside
  //      constituent C's numeric span: flag p itself (e.g. "yesterday" parked inside "man"'s NP span in the
  //      fixture's "I saw a man yesterday who was tall" → arc yesterday→saw).
  //  (a) BRIHAT_JATAKA S1'S SHAPE — mūrtitve's real subtree spans PAST its own head parikalpitaḥ, out to bhṛtaḥ.
  //      The OLD dparent algorithm tested this the (b)-only way — "is p the smallest constituent some OTHER span
  //      numerically contains?" — which let dparent[mūrtitve]=parikalpitaḥ (its real head, matches — no flag),
  //      dparent[parikalpitaḥ]=vartmā (its real head, since a REAL descendant can never be its own display-parent —
  //      matches, no flag) and ALSO dparent[bhṛtaḥ]=mūrtitve (its real head too, because mūrtitve's UNCONDITIONAL
  //      span still reached out to bhṛtaḥ) — so isInt() was false for all four tokens and dchildren ended up
  //      identical to the REAL (non-projective) tree: rendering it walked mūrtitve's dchild bhṛtaḥ (and bhṛtaḥ's
  //      own child śaśa) BEFORE mūrtitve's own parent parikalpitaḥ, since flatInto/render sort members by `lo[c]`
  //      and bhṛtaḥ's subtree's lo is smaller than parikalpitaḥ's own position — confirmed with a CDP dump of the
  //      rendered .bwtok data-tok sequence: 1,3,4,2,… instead of 1,2,3,4. (a) catches exactly this: for dependent
  //      d, if one of ITS HEAD'S OWN ANCESTORS sits between them in surface order, flag d (not the ancestor), tied
  //      to its real head — matching ātmā/iti/vidām (vidām, not iti) and śrutau/yaḥ/anekadā (anekadā, not yaḥ)
  //      elsewhere in the same sentence, while leaving (b)'s "yesterday" example alone (yesterday is man's
  //      unrelated SIBLING, not man's ancestor, so (a) declines to flag "was" and (b) flags yesterday as it always did).
  const interrupt=new Set();
  for(let C=0;C<n;C++) for(let p=rtlo[C]+1;p<rthi[C];p++)
    if(!isRealDesc(C,p)&&!isRealDesc(p,C)) interrupt.add(p);                 // (b) unrelated interloper
  for(let d=0;d<n;d++){ if(d===root)continue; const h=head[d]-1; if(h<0||h>=n||h===d)continue;
    const a=Math.min(h,d), b=Math.max(h,d);
    for(let p=a+1;p<b;p++) if(isRealDesc(p,h)){ interrupt.add(d); break; } } // (a) an ancestor of h crosses d's own arc
  // corrected spans: fold a child's span into its parent's only when that child is NOT an interrupter — an
  // interrupter's own span is still computed (for ITS OWN bracket) but stops at whatever it can honestly claim,
  // instead of reaching past whatever real token sits, non-projectively, between it and ITS head.
  const tlo=Array(n),thi=Array(n);
  (function dfs2(i){tlo[i]=i;thi[i]=i; children[i].forEach(c=>{dfs2(c); if(interrupt.has(c))return; tlo[i]=Math.min(tlo[i],tlo[c]); thi[i]=Math.max(thi[i],thi[c]); });})(root);
  const dparent=Array(n).fill(-1);
  for(let p=0;p<n;p++){ if(p===root)continue;
    if(!interrupt.has(p)){ dparent[p]=head[p]-1; continue; }   // the ordinary case: nest under the real head, same as the flat view
    // an interrupter can't nest under its own real head (that's what "interrupter" means here) — search EVERY
    // constituent (not just p's own real ancestors: case (b)'s interrupters, like "yesterday", attach to an
    // unrelated SIBLING subtree — "man"'s — that sits nowhere on their own head chain at all) for the SMALLEST
    // (corrected) span that contains p, excluding p's own real descendants (picking one would 2-cycle: p→C→p). This
    // is the same search the ORIGINAL dparent algorithm ran, just over the corrected tlo/thi instead of the
    // unconditional one — an earlier version of this fix walked UP p's real head chain only, which finds
    // brihat_jataka s1's vartmā correctly (it happens to sit on bhṛtaḥ's own ancestor chain) but put "yesterday" at
    // the SENTENCE ROOT instead of nested inside "man"'s bracket where the flat view (and the pre-fix dparent
    // search) both put it — confirmed by a CDP dump showing "yesterday" rendered LAST, after the whole relative
    // clause, instead of in its natural position between "man" and "who".
    let best=-1,bs=Infinity;
    for(let C=0;C<n;C++){ if(C===p||isRealDesc(p,C))continue;
      if(tlo[C]<=p&&p<=thi[C]){ const sp=thi[C]-tlo[C]; if(sp<bs){bs=sp;best=C;} } }
    dparent[p]=best>=0?best:root; }
  const dchildren=Array.from({length:n},()=>[]); for(let p=0;p<n;p++) if(p!==root) dchildren[dparent[p]].push(p);
  const isInt=p=>interrupt.has(p);   // now the directly-verified per-arc set, not re-derived from dparent vs head
  const lo=Array(n); (function dfs(i){lo[i]=i; dchildren[i].forEach(c=>{dfs(c); lo[i]=Math.min(lo[i],lo[c]);});})(root);
  const mwtComp=new Set(); (D.mwt||[]).forEach(m=>{mwtComp.add(m.from-1); mwtComp.add(m.to-1);});
  const BRK='700 15px '+LIVE_TOKEN_STACK, G=6, brW=meas("[",BRK)+6, IND=brW;   // brW: width for fit maths (a bracket plus the gap to what follows). IND: the per-level indent unit — SAME currency as brW/flatW (bracket + G), not the bare glyph. It used to be meas("[",BRK) alone: the bracket glyph with NO trailing gap, which under-priced every level of nesting by G against flatW's own accounting (flatW prices an opened level at brW, and prices every child-to-child step at +G — see below), so `indent`/`cind` (built purely by summing IND) and flatW stopped being apples-to-apples in the `indent+flatW(i)<=AV` fit checks. No longer rounded, and no longer +2 for margins .bwbr does not have; the line() below prints a real (invisible) bracket per level regardless of what IND measures, so THIS number's own job is only to keep the fit maths honest, not the per-level pixels — the one place pixels needed a real fix (a leadhead line dropping straight into content with no bracket of its own to supply the usual bracket→word gap) is patched separately, in line()'s own trailing space (see `bare` below)
  const selTok=(sel.s===si&&sel.t>0)?D.map.indexOf(sel.t-1):-1, selCol=selTok>=0?relColor(t[selTok].deprel):"";   // span highlighting: the selected constituent
  const selDesc=new Set(); if(selTok>=0) (function d(i){selDesc.add(i); children[i].forEach(d);})(selTok);   // TREE descendants → an interrupter displayed within isn't part of the constituent
  const relBelow=i=>show.labels&&i!==root&&!isInt(i);   // an interrupter's relation rides its arc, not the row below
  const wordW=i=>{ let w=fmeas(t[i],WORD_F); if(relBelow(i))w=Math.max(w,meas(t[i].deprel,POS_F)); if(show.pos&&t[i].upos)w=Math.max(w,meas(posDisp(t[i]),POS_F)); {const rt=trTxt(t[i]); if(rt)w=Math.max(w,meas(rt,trFont(t[i])));} w=Math.max(w,glossSlotW(t[i])); return w+8; };   // fold in the gloss-tier row width (glossSlotW → 0 when no gloss tier is shown) so a wide morphemic gloss can't crowd its neighbour — the SAME inclusion the stemma/arc layouts already make (item: gloss crowding, wrapped brackets only)   // the token cell's width = its widest row (host form only; its folded-punctuation satellites are separate inline spans AFTER the cell)
  const hangWpx=i=>tailW(t[i],WORD_F);   // width of the token's folded-punctuation satellites (added to the fit maths so lines account for their real space)
  const fw=Array(n).fill(-1), flatW=i=>{ if(fw[i]>=0)return fw[i]; let w=brW+wordW(i)+hangWpx(i); dchildren[i].forEach(c=>w+=G+flatW(c)); return fw[i]=w+G+brW; };
  const AV=Math.max(160, AVAILW/FS-22-Math.ceil(3*FS)-4);   // item 4: the per-line wrap budget. Reserve the fixed 22px inline-end margin PLUS a zoom-scaled pad (×FS) for the last token's text-shadow casing halo, so a line breaks early enough that the rightmost token's form/POS/relation glyphs never touch the port edge at higher zoom (zoom:var(--fs)). The trailing -4 is a SEPARATE margin against a different hazard: wordW's per-token widths are measured through meas()/fmeas() (an SVG <text> + getComputedTextLength(), see diagram-core.js), but a wrapped-bracket line renders as ordinary HTML <span>s under .bwline2{white-space:nowrap} — a different text-layout engine that can shape a few px wider than the SVG measurement said, and nowrap means the line cannot recover by breaking. A small constant slack here costs one word breaking slightly earlier than it strictly had to; not reserving it costs an occasional line rendering wider than AVAILW with nowrap forbidding any recovery. See the matching overflow-x:hidden on .text-conv.bwrap (app.css) for the case this slack doesn't catch.
  const box=document.createElement("div"); box.className="text-conv bwrap softcase"; box.dir=RTL?"rtl":"ltr";
  /* ⚠ BOTH PADS TAKE +TOK_TR_GAP, the wrapped view's statement of the same two widenings flat brackets
     makes ("the token-transliteration gap in stemmas and brackets should be sized to match" / "in
     brackets, the token-deprel gap should also match"). The mechanism differs because the box model
     does: flat brackets seats every row at a computed y, while here the form is the only IN-FLOW child
     and the relation/below-stack are absolutely positioned into padding reserved above and below it —
     so growing the PADDING is how a gap widens, and the label/rows stay put while the form moves.
     --relpad only where there is a label row (show.labels already gates it); --und-extra rides along
     with --undpad because .bwund is positioned from the form's own bottom edge (top:calc(100% + …),
     app.css) rather than from the padding, so the reserve and the offset have to move together.
     ⚠️ --relpad is also read by positionBracketAnnots (js/core/document.js) to seat the level-bracket
     arcs at the deprel row; growing it therefore keeps those arcs ON that row while the form drops away
     from them — the same outcome flat brackets gets by writing `base=relY`. 0 outside lzh.
     ⚠️ AND THE DEPREL PAD IS 2·TOK_DESC, tracking flat brackets' own second descent ("in brackets, the
     token-deprel gap needs to be increased (probably by descender length)"). The request names the notation,
     not the mode, and this file's standing rule is that the wrapped variant of a notation must not drift from
     the flat one — the two were deliberately brought to one figure when the first descent landed. */
  box.style.setProperty("--relpad",(show.labels?(13.3+descent(WORD_F)+TOK_TR_GAP+2*TOK_DESC):0)+"px");             // reserved space above the form for the relation row. Copies projWrapped's deprel→form offset EXACTLY (20px + the form's descender depth): the HTML box model seats the form baseline ~6.7px lower inside its line box than the label's centre, so the flat "20" nominal maps to ~13.3, and +descent(WORD_F) adds the projWrapped descender fold on top — landing the relation centre the same distance above the form baseline as the wrapped stemma
  box.style.setProperty("--undpad",(belowReserveH(hasTr(t),belowTierN(),show.pos)+TOK_TR_GAP)+"px");            // reserved space below for the transliteration + gloss + POS rows (Item 1/8: EVERY below-row folds in descent(POS_F) — matching belowStack's descender-matched per-row step — via the .otrans/.gloss/.bwpos margin-top set below; the reserve grows to match so the stack bottom stays at the same depth as the flat/arc views) — belowGap() per row, matching the flat renderer's baseline step. hasTr (actual translit presence), NOT show.translit, so an English sentence reserves no phantom translit row — keeping the token's stack bottom at the SAME depth as the arc/flat views, so a cross-line arc's upper endpoint (tokBot + clearance) lands where arcsWrapped puts it (stackBot + clearance)
  box.style.setProperty("--und-extra",TOK_TR_GAP+"px");   // …and the matching shift of .bwund's own top offset, which is measured from the FORM's bottom edge rather than from that padding (app.css)
  if(selTok>=0) box.style.setProperty("--washcol",selCol);
  let anyInt=false; for(let i=0;i<n;i++) if(isInt(i)){anyInt=true;break;}
  if(anyInt) box.classList.add("hasint");            // headroom above the first line for interrupter arcs
  // item 1: the bracket stack under a wrapped line carries BOTH kinds of tie — MWT surface-form ties and ExtPos
  // brackets — tier-assigned by the SAME tieLayout the SVG views use, so the two renderers can't disagree about
  // which bracket sits where. `dy` is that layout's per-tier vertical offset, reused verbatim below.
  box._ties=tieLayout(D).rows.map(r=>({kind:r.kind, tier:r.tier, dy:r.dy, pos:r.pos||"", ids:r.ids||null,   // ids: a goeswith row's parts (its own mark is drawn inside the token cell — see wordSpan — so this row only reserves its depth here)
    form:r.m?r.m.form:"", translit:r.m?(r.m.translit||""):"", ortho:r.m?(r.m.ortho||""):"", miast:r.m?(r.m.miast||""):"",
    fromTok:OID(r.from-1), toTok:OID(r.to-1)}));   // (ortho → the SCRIPT / sandhi-fused surface form)
  if(box._ties.length){ box.classList.add("hasmwt");   // room below the last line for the tie stack
    const deepest=Math.max(...box._ties.map(htmlTieBottom));
    box.style.paddingBottom=Math.max(67,deepest+20)+"px"; }   // the 67px in .bwrap.hasmwt covers exactly ONE tier carrying a form + transliteration row; a deeper stack (a second tier, or an ExtPos annotation under a form) grows it to match, keeping the same 20px of air below the last label
  const brk=(txt,col,owner)=>{ const s=document.createElement("span"); s.className="bwbr"+(owner!=null&&selDesc.has(owner)?" inspan":""); s.style.color=col; s.textContent=txt; if(owner!=null){s.style.cursor="pointer"; s.dataset.s=si; s.dataset.owner=OID(owner); s.addEventListener("click",()=>pick(si,OID(owner)));} return s; };
  const closeHead=i=>{ const s=document.createElement("span"); s.className="bwclose"; s.textContent=bform(t[i])+gwOf(t[i]).map(p=>bform(p.tok)).join(""); return s; };   // the head repeated (muted) beside a closing bracket on its own line (host form only, no folded punctuation). A goeswith word is repeated WHOLE and unslurred: this is a reminder of which constituent just closed, not a second rendering of the word
  const repOff=reportOffsets(D);   // item 7: per-token reported-speech offsets
  const wordSpan=i=>{ const grp=document.createElement("span"); grp.className="bwtok"+(sel.s===si&&sel.t===OID(i)?" sel":""); grp.dataset.s=si; grp.dataset.tok=OID(i); grp.style.cursor="pointer"; grp.style.width=wordW(i)+"px"; grp.addEventListener("click",()=>pick(si,OID(i)));   // reserve the widest-row width (rel/POS/translit are absolute, so JS sizes the box as the flex column did before) — a firm `width` (not `minWidth`): wordW already reserves the BOLD width too, so the box never needs to grow when a token is selected; it bolds in place, centred, exactly like unwrapped brackets
    if(selDesc.has(i)) grp.classList.add("inspan");   // in the selected constituent → covered by the continuous wash (drawn as a per-line overlay after layout)
    if(isInt(i)){ grp.classList.add("bwint"); grp.dataset.inthead=OID(head[i]-1); grp.dataset.intrel=t[i].deprel; grp.dataset.intcol=relColor(t[i].deprel); }
    { const ghosts=ghostsByOrigin[i].map(([tg,rel])=>OID(tg)+":"+rel);   // ghost targets: pairs of (OTHER token, relation label to show on that dashed arc) — Shared=Yes → one per other conjunct, labelled with this token's OWN deprel; Subject-raising → one, always labelled "subj" (positionBracketAnnots draws them)
      if(ghosts.length) grp.dataset.ghostheads=ghosts.join(","); }
    if(mwtComp.has(i)) grp.classList.add("bwmwt");
    if(repOff[i]) grp.style.top=(-repOff[i])+"px";   // item 11: .bwtok is position:relative, so a NEGATIVE `top` steps the whole token cell (form + its below-stack) UP off the line visually; interrupter arcs/ties measured from offsetTop follow it (offsetTop includes `top`), so a reported token's arcs lift with it
    if(relBelow(i)){ const r=document.createElement("span"); r.className="bwrel"+(isMorphRel(t[i].deprel)?" morph-lbl":""); setRelLabel(r,t[i].deprel); r.title=relTitle(t[i].deprel); if(show.colour)r.style.color=relColor(t[i].deprel); grp.appendChild(r); }
    else if(i===root && show.labels){ const r=document.createElement("span"); r.className="bwrel"+(isMorphRel(t[i].deprel)?" morph-lbl":""); setRelLabel(r,t[i].deprel||"root"); r.title=relTitle(t[i].deprel||"root"); if(show.colour)r.style.color=relColor(t[i].deprel); grp.appendChild(r); }   // the root has no incoming arc, but (like every other token, and the wrapped stemma) it still shows its relation label ("root") above its form
    else if(show.labels){ const r=document.createElement("span"); r.className="bwrel"; r.textContent=" "; grp.appendChild(r); }   // root has no relation → reserve the row so its form baseline aligns with the other words
    const wf=document.createElement("span"); wf.className="bwform"+formDeco(t[i])+italDeco(t[i]); wf.textContent=bform(t[i]); htmlSeamMark(wf,t[i],"form");
    if(gwOf(t[i]).length){ const ids=[OID(i)].concat(gwOf(t[i]).map(p=>p.oid));
      wf.classList.add("gwunit"); gwFormHTML(wf,wf,t[i],si,"bwpart"); grp.dataset.gw=ids.join(" "); }   // goeswith: the continuation parts sit inside the SAME .bwform cell, so the .bwund stack nested in it (translit/gloss/POS) stays centred on the WHOLE word rather than on its first part. The SLUR is drawn by positionBracketAnnots into the .bwannot overlay, not here — the below-stack is absolutely positioned, so only a live measurement (undBot) knows where its bottom is, exactly as the MWT tie already found
    grp.appendChild(wf);   // only in-flow child → the token baselines on the form; folded punctuation is appended as separate satellites AFTER the cell (see flatInto/render). The seam mark is an out-of-flow child, so it hangs past the form without widening the cell
    const below=[];
    { const rt=trTxt(t[i]); if(rt){ const tr=document.createElement("span"); tr.className="otrans"+(trRowEdit()?" tr-edit":"")+frnUp(t[i]); tr.textContent=rt; tr.style.marginTop=descent(POS_F)+"px"; htmlSeamMark(tr,t[i],"translit"); below.push(tr); } }   // Item 8: the translit row gains the same descender-matched top gap (+descent(POS_F)) the POS row carries, matching belowStack's per-row step (the .bwund flex column steps 18px per row; this margin folds in the label-font descender)
    belowTiers().forEach(tier=>{ const txt=tierText(t[i],tier); const gs=document.createElement("span"); gs.className="gloss gl-edit"+(txt?"":" gl-empty")+frnUp(t[i]); gs.dataset.tier=tier; gs.tabIndex=0; setGlossText(gs,tier,txt||"…"); gs.style.marginTop=descent(POS_F)+"px"; if(tier==="mseg"||tier==="mgloss")htmlSeamMark(gs,t[i],tier); below.push(gs); });   // Item 8: each gloss / morphemic-gloss tier gains the same +descent(POS_F) top gap as the POS row; between translit and POS. The segmentation AND morphemic-gloss rows both take the seam mark as an out-of-flow child (both per-morpheme, unlike the lexical gloss row), so .bwund's flex column still centres each row on its own real text — drawn even where THIS tier is the "…" placeholder (not gated on txt), so a seam MSeg marks cleanly never silently vanishes from MGloss just because that one morpheme isn't glossed yet (see the note beside the SVG twin of this call in diagram-core.js)
    if(show.pos&&t[i].upos){ const p=document.createElement("span"); p.className="bwpos"; p.textContent=posDisp(t[i]); p.title=posTitle(t[i].upos); p.style.marginTop=descent(POS_F)+"px"; below.push(p); }   // Item 1: descent(POS_F) extra top gap above the POS row (the .bwund flex column steps 18px per row; this margin folds in the label-font descender so wrapped brackets match belowStack's new belowGap() POS step)
    if(below.length){ const und=document.createElement("span"); und.className="bwund"; below.forEach(e=>und.appendChild(e)); wf.appendChild(und); }   // POS/translit nested IN the form → centres under the form, not the wider slot (matters when the form is flush-left on a leadhead line)
    return grp; };
  /* THE INDENT IS PRINTED, NOT COMPUTED. A continuation line has to start exactly where the content just inside
     the parent's "[" starts, and a padding in px can only ever approximate that: the real offset is the bracket
     glyph's advance in THIS font at THIS size, plus whatever margin the element after it contributes, and IND was
     a rounded measurement plus a constant that no longer matched (.bwbr carries margin:0 now, so the "+2 for its
     margins" the constant was named for is not there). Sub-pixel rounding, a font fallback for a script Noto Sans
     doesn't cover, and any future change to .bwbr's box all move the real number and leave the constant behind.
     So each level of indent is a REAL "[" — same element, same class, same font — made invisible. visibility:hidden
     (not opacity or a transparent colour) is what makes it occupy its advance while being unrendered, unselectable
     and absent from a copy of the text; aria-hidden keeps it out of the accessibility tree. The indent is then
     correct BY CONSTRUCTION, whatever the glyph turns out to measure.
     `indent` is still a px value because the FIT maths needs one, and it is always an exact multiple of IND (the
     only recursion is cind = indent + IND), so the level count divides out cleanly. */
  // EVERY pad is the SAME plain "[" glyph, always — real or invisible, they're the identical element/class/font, so
  // any RUN of them (however many) is priced in the SAME currency as a real bracket. That is what makes a leadhead
  // line's extra pad (below) an exact fix rather than a pixel guess: `line()`'s `extra` param prints one MORE
  // invisible "[" than the indent level alone calls for, and because it's the same glyph a real bracket would be,
  // it reserves EXACTLY the width a real bracket reserves — not an approximation of it.
  // Two PRIOR versions of this got the leadhead line wrong in opposite directions, both pixel-"verified" in
  // isolation because neither was ever diffed against a SIBLING line at the same cind:
  //  1. An early version gave the leadhead caller a `bare` flag that printed a real " " after the "[" on the LAST
  //     pad, reasoning that a leadhead line "drops straight into content" and needs the trailing space every OTHER
  //     bracket→word transition gets for free. A space glyph is WIDER than the "[" it followed, so the leadhead
  //     line's content started too far RIGHT of a sibling flatInto'd child's own "[" at the identical indent.
  //  2. The very next version overcorrected: dropped the extra glyph entirely and leaned on `.bwtok.leadhead`'s own
  //     normal padding-inline-start alone to supply "the gap". That gap IS the same 1px margin + 3px padding every
  //     bracket→word transition gets — but a sibling line at the same cind gets that gap AFTER its own real "[",
  //     while a bare `line(cind)` leadhead line has NO bracket before it at all. So its cell started a WHOLE
  //     bracket-glyph-advance (meas("["), not a mere "space" — confirmed by CDP getBoundingClientRect diffing a
  //     leadhead cell against a same-cind sibling child's cell: the delta was exactly meas("[")) too far LEFT.
  // The fix is neither: keep every pad plain (no doctored glyphs, no duplicated pixel constant) AND print one more
  // of them for a leadhead line specifically, so its cell sits exactly where a sibling's cell sits — right after
  // an (invisible, in this case) bracket — by construction.
  const line=(indent,extra)=>{ const ln=document.createElement("div"); ln.className="bwline2"; box.appendChild(ln);
    const lv=Math.max(0,Math.round(indent/IND))+(extra||0);   // extra: a leadhead line (below) has NO real bracket of its own before its cell — every OTHER line at this same indent (a sibling flatInto'd child) DOES, via flatInto's own `ln.appendChild(brk("[",...))` — so without one more pad here the leadhead cell starts exactly one bracket-glyph-advance (meas("["), NOT a "space") to the LEFT of where a sibling's cell starts, the actual bug the user measured. One more invisible "[" (same glyph/class as a real one, so byte-identical width) reserves precisely that missing glyph, restoring the by-construction alignment
    for(let k=0;k<lv;k++){ const pad=document.createElement("span"); pad.className="bwbr bwind"; pad.setAttribute("aria-hidden","true"); pad.textContent="["; ln.appendChild(pad); }
    return ln; };
  /* item 9(b) — A FOLDED PUNCTUATION SATELLITE BELONGS TO THE TOKEN'S FORM, NOT TO ITS ANNOTATION STACK.
     Merge-punctuation folds a mark off its host and draws it as its own selectable element beside the word; in the
     SVG notations that "beside" is measured from the FORM's own ink edge (drawHangsSVG/drawLeadsSVG start at
     cx ± fmeas/2). Wrapped brackets had no equivalent: the satellites are inline spans appended around the .bwtok
     CELL, whose firm width is wordW(i) — the widest of form, deprel, POS, transliteration and gloss. So under any
     token with an annotation wider than its form (an MWT component under a long MGloss is the common case) the
     comma/daṇḍa floated out in the slack, detached from the word it punctuates, further out the longer the gloss.
     `formSlack` is exactly that slack on one side; pulling the first satellite back by it seats the run flush
     against the form, and the matching push on the LAST one leaves the line's total advance byte-for-byte what it
     was — so the following bracket, and every downstream cell (and hence the gloss spacing wordW is there to
     protect), stay exactly where they were. Logical margins → this mirrors correctly under RTL.
     Geometry, per the .bwtok box: 1px margin, border-box width = wordW(i), 3px inline padding, form centred in the
     content box ⇒ the same slack (wordW(i) − formW)/2 + 1 sits on EACH side, between the form's ink edge and the
     cell's margin-box edge. A `.leadhead` cell (a head alone on a wrapped line) is the one exception: it is
     text-align:start, so the form is flush against the content box's own start edge (margin 1px + the SAME 3px
     padding-inline-start every other cell carries — .leadhead no longer zeroes it, see app.css) — all of the slack
     is at the END and none at the START (beyond that fixed 1+3), and pushing its leads inward by a centred cell's
     half would drive them straight over the form. */
  const formSlack=(i,head)=>{ const w=wordW(i)-fmeas(t[i],WORD_F);
    return head ? {start:4, end:Math.max(0,w-2)} : {start:Math.max(0,w/2+1), end:Math.max(0,w/2+1)}; };
  const hangInto=(i,ln,head)=>{ const k=ln.childElementCount; appendHangHTML(ln,t[i],si,"punctsat bwpunct",OID(i));   // the token's folded-punctuation satellites, right after its cell (before any following bracket)
    const add=[...ln.children].slice(k); if(!add.length) return; const sl=formSlack(i,head).end;
    add[0].style.marginInlineStart=((parseFloat(add[0].style.marginInlineStart)||0)-sl)+"px";                     // back onto the form's inline-end edge (keeping any SpaceAfter word space the satellite already carries)
    const last=add[add.length-1]; last.style.marginInlineEnd=((parseFloat(last.style.marginInlineEnd)||0)+sl)+"px"; };   // …and give the space straight back, so nothing after the run moves
  const leadInto=(i,ln,head)=>{ const k=ln.childElementCount; appendLeadHTML(ln,t[i],si,"punctsat bwpunct",OID(i));   // item 2: right-merging leads, BEFORE the token cell
    const add=[...ln.children].slice(k); if(!add.length) return; const sl=formSlack(i,head).start;
    add[0].style.marginInlineStart=((parseFloat(add[0].style.marginInlineStart)||0)+sl)+"px";                     // mirror image: the leads end flush at the form's inline-START edge…
    const last=add[add.length-1]; last.style.marginInlineEnd=((parseFloat(last.style.marginInlineEnd)||0)-sl)+"px"; };   // …and the cell still starts where it did
  const flatInto=(i,ln)=>{ const col=relColor(t[i].deprel); ln.appendChild(brk("[",col,i));   // whole constituent inline, in surface order
    [{pos:i,head:true}].concat(dchildren[i].map(c=>({pos:lo[c],c}))).sort((a,b)=>a.pos-b.pos).forEach(m=>{ m.head?(leadInto(i,ln),ln.appendChild(wordSpan(i)),hangInto(i,ln)):flatInto(m.c,ln); });
    ln.appendChild(brk("]",col,i)); };
  // Lisp-indented, linearised deepest-first: a constituent is flat on one line iff it fits at its indent; else it
  // stays expanded. Within an expanded constituent the members (head + children, in SURFACE order — the head in
  // its proper place, shown once) are linearised INCREMENTALLY left to right, filling each indented line before
  // the next. A child too wide even alone expands recursively.
  (function render(i,indent){ const col=relColor(t[i].deprel);
    if(indent+flatW(i)<=AV || !dchildren[i].length){ flatInto(i,line(indent)); return; }   // whole thing fits (or a leaf) → one flat line
    const members=[{pos:i,head:true}].concat(dchildren[i].map(c=>({pos:lo[c],c}))).sort((a,b)=>a.pos-b.pos);
    const cind=indent+IND;   // members (head + children) indent by exactly one parent-bracket width → they line up with the content just inside this constituent's own "[", not with a deeper sibling bracket
    let cur=line(indent); cur.appendChild(brk("[",col,i)); let curW=indent+brW;
    members.forEach(m=>{ if(m.head){ const w=leadW(t[i],WORD_F)+wordW(i)+hangWpx(i);
        if(cur && curW+G+w<=AV){ leadInto(i,cur); cur.appendChild(wordSpan(i)); hangInto(i,cur); curW+=G+w; } else { cur=line(cind,1); leadInto(i,cur,true); const ws=wordSpan(i); ws.classList.add("leadhead"); cur.appendChild(ws); hangInto(i,cur,true); curW=cind+w; } }   // head alone on a wrapped line → left-align its form to the box start so it lines up with the sibling brackets (item 9(b): the satellites are re-anchored against THAT flush-start geometry, not the centred one — see formSlack). line(cind,1): a sibling flatInto'd child at this SAME cind prints its OWN real "[" before its cell; the leadhead has no such bracket, so without the +1 extra pad its cell lands one bracket-glyph-advance LEFT of that sibling's — pixel-measured via CDP (getBoundingClientRect diff = exactly meas("[")), not assumed. The leadhead cell's OWN normal padding-inline-start (app.css) then supplies the same bracket→word gap a real bracket's follower gets
      else { const cw=flatW(m.c);
        if(cur && curW+G+cw<=AV){ flatInto(m.c,cur); curW+=G+cw; }                     // linearise the child inline
        else if(cind+cw<=AV){ cur=line(cind); flatInto(m.c,cur); curW=cind+cw; }        // …or on the next indented line
        else { render(m.c,cind); cur=null; } } });                                      // too wide alone → expand it
    // close on the last content line so the "]" never sits alone while its "[" hugs content (a bracket is alone only if its match is)
    const lastLn = cur || (box.lastElementChild&&box.lastElementChild.classList.contains("bwline2") ? box.lastElementChild : line(indent));
    lastLn.appendChild(brk("]",col,i));
  })(root,0);
  return box;
}
// Shallow Hobby bump. The take-off angle θ is fixed to the ARROWHEAD's half-angle, atan(AH_RATIO) ≈ 31°, so the
// arrowhead's lower edge comes out exactly horizontal. The control-point height is DERIVED from θ so the bump
// stays a genuine symmetric Hobby spline: a symmetric Hobby handle needs tan(θ/2) = 3·ARC_K/2, i.e.
// ARC_K = (2/3)·tan(θ/2), with horizontal handle offset dx = h·cotθ. ARC_K — and thus every arc's height
// (arcHgt) and apex (0.75·h) — follows automatically. The handles never cross → no dx cap.
const ARC_ANGLE=Math.atan(AH_RATIO);             // = arrowhead half-angle → the arrowhead's lower edge is horizontal
const _AHALF=Math.tan(ARC_ANGLE/2);              // tan(θ/2)
const ARC_K=2*_AHALF/3;                          // control-point height as a fraction of the (fanned) chord
const ARC_COT=(1-_AHALF*_AHALF)/(2*_AHALF);      // = cot(θ); horizontal handle offset dx = ARC_COT·h
const ARC_APEX=0.75;                             // the symmetric Hobby bump's visible PEAK sits 0.75·h above the baseline (a cubic with both handles at height h reaches base−0.75h at t=0.5). Every vertical-clearance reservation is taken to THIS peak, NOT to the handle height h.
// Item 3 — the STANDARD inter-line gap the wrapped ARC view leaves between two lines when an arc sits in that gap,
// measured as the previous line's stack bottom → the next line's word-row top. arcsWrapped advances by its
// ROWGAP(16)+TOP(14)+8 to the (constant) arc crown clearance, then the floor arc's own peak (0.75·24) and the
// word-offset drop the tokens below the crown — a measured 57px for a floor-height arc. The wrapped BRACKET view
// floors every arc-occupied gap (within-line bump OR cross-line edge) to this SAME value so both views space
// arced lines identically; a taller arc/bump then grows only its own gap by the deficit (occupy-then-grow),
// consistent across the two views. Keep in sync with arcsWrapped's ROWGAP/TOP/crown-clearance if those change.
// (60, not 57: the bracket floor measures to a line's content-box bottom, ~3px below the POS glyph bottom the arc
// view's stack bottom uses, so 60 here lands the same ~57px POS-bottom→word-top gap the arc view shows.)
const WRAP_ARC_STDGAP=60;
function arcHgt(width,ROW){ return Math.abs(width)*ARC_K; }
// Fan step for endpoints meeting at one node. Arcs leave at the take-off angle θ = ARC_ANGLE, so a horizontal
// endpoint offset s gives a PERPENDICULAR gap between adjacent arcs of only s·sinθ. To keep one arc's opaque
// casing (half-width = (arc-stroke+3.5)/2) clear of a neighbour's body (half-width = arc-stroke/2, + 1px margin),
// the horizontal step must be that gap divided by sinθ.
function fanStep(){ const st=parseFloat(css("--arc-stroke"))||1.7; return ((st+3.5)/2 + st/2 + 1)/Math.sin(ARC_ANGLE); }
// Fan the endpoints of arcs meeting at a shared node: the incoming (central) edge sits dead-centre, the outgoing
// edges fan outward by a uniform `spread`, the shortest taking the outermost slot. THE one routine every arc/bracket
// view calls, so the fan can't drift between them. Each arc a carries head-key hk, dep-key dk, head-x xh, dep-x xd
// and length len (any monotone-in-width measure); it is mutated with offH / offD, the horizontal endpoint offsets.
function fanArcs(arcs,spread){ const ep={}; const reg=(k,len,side,central,set)=>{(ep[k]=ep[k]||[]).push({len,side,central,set});};
  arcs.forEach(a=>{ reg(a.hkey??a.hk,a.len,Math.sign(a.xd-a.xh)||1,false,o=>a.offH=o);   // this node is the head → outgoing edge fans. a.hkey/a.dkey override only the FAN-BUCKET key (not a.hk/a.dk, which are read downstream) so a cross-line arc's UPPER-line endpoint can bucket with the bottom-of-line endpoints instead of the top-side ones at the same token
                    reg(a.dkey??a.dk,a.len,Math.sign(a.xh-a.xd)||1,true, o=>a.offD=o); }); // this node is the dependent → incoming edge central
  Object.values(ep).forEach(arr=>{ arr.filter(e=>e.central).forEach(e=>e.set(0));
    [-1,1].forEach(side=>{ arr.filter(e=>e.side===side&&!e.central).sort((p,q)=>q.len-p.len).forEach((e,j)=>e.set(side*(j+1)*spread)); }); }); }
// cubic control points for an arc bump from (x1,base) to (x2,base) of height h: each control sits at height h
// above its endpoint and cot(θ)·h inward, so the take-off tangent makes θ with the baseline. Apex is 0.75·h.
function arcCtrl(x1,x2,base,h){ const sgn=Math.sign(x2-x1)||1, dx=ARC_COT*h;
  return [[x1,base],[x1+sgn*dx,base-h],[x2-sgn*dx,base-h],[x2,base]]; }
// item 7/11 — like arcCtrl, but each endpoint keeps its OWN baseline y (so a reported-speech token whose arc
// endpoint is lifted, and its unlifted partner, join a crown h above the HIGHER of the two). With y1===y2 it
// reduces exactly to arcCtrl (crown at y1-h, handle insets ARC_COT·h), so unshifted arcs draw byte-identically.
function arcCtrl2(x1,y1,x2,y2,h){ const sgn=Math.sign(x2-x1)||1, top=Math.min(y1,y2)-h;
  return [[x1,y1],[x1+sgn*ARC_COT*(y1-top),top],[x2-sgn*ARC_COT*(y2-top),top],[x2,y2]]; }
// like arcCtrl, but the START endpoint (x1) is LIFTED to startY (above its deprel label — Item 5); the crown clears
// both endpoints and each endpoint keeps its take-off angle θ (handle inset = cotθ · its own rise to the crown), so
// the DEP endpoint (x2) and its arrowhead are unchanged. With startY===base this reduces byte-exactly to arcCtrl
// (for the h≥6 the bracket bumps always use), so callers that pass no raised start draw identically.
function arcCtrlRaised(x1,x2,base,h,startY,endY){ endY=endY??base; const sgn=Math.sign(x2-x1)||1;
  const topY=Math.min(base-h, startY-6, endY-6);   // crown clears BOTH raised ends by ≥6px, and is ≥h above base
  return [[x1,startY],[x1+sgn*ARC_COT*(startY-topY),topY],[x2-sgn*ARC_COT*(endY-topY),topY],[x2,endY]]; }
// vertical extent [minY,maxY] of a cubic Bézier's actual curve (endpoints + interior extrema where dy/dt=0)
function bezYExtent(P){ const y0=P[0][1],y1=P[1][1],y2=P[2][1],y3=P[3][1];
  let lo=Math.min(y0,y3), hi=Math.max(y0,y3);
  const A=y3-3*y2+3*y1-y0, B=2*(y2-2*y1+y0), C=y1-y0;   // dy/dt ∝ A t² + B t + C
  const roots=[]; if(Math.abs(A)>1e-9){ const d=B*B-4*A*C; if(d>=0){ const s=Math.sqrt(d); roots.push((-B+s)/(2*A),(-B-s)/(2*A)); } }
  else if(Math.abs(B)>1e-9) roots.push(-C/B);
  roots.forEach(t=>{ if(t>1e-4&&t<1-1e-4){ const m=1-t, y=m*m*m*y0+3*m*m*t*y1+3*m*t*t*y2+t*t*t*y3; lo=Math.min(lo,y); hi=Math.max(hi,y); } });
  return [lo,hi]; }
// horizontal extent [minX,maxX] of a cubic Bézier's actual curve (endpoints + interior extrema where dx/dt=0)
function bezXExtent(P){ const x0=P[0][0],x1=P[1][0],x2=P[2][0],x3=P[3][0];
  let lo=Math.min(x0,x3), hi=Math.max(x0,x3);
  const A=x3-3*x2+3*x1-x0, B=2*(x2-2*x1+x0), C=x1-x0;   // dx/dt ∝ A t² + B t + C
  const roots=[]; if(Math.abs(A)>1e-9){ const d=B*B-4*A*C; if(d>=0){ const s=Math.sqrt(d); roots.push((-B+s)/(2*A),(-B-s)/(2*A)); } }
  else if(Math.abs(B)>1e-9) roots.push(-C/B);
  roots.forEach(t=>{ if(t>1e-4&&t<1-1e-4){ const m=1-t, x=m*m*m*x0+3*m*m*t*x1+3*m*t*t*x2+t*t*t*x3; lo=Math.min(lo,x); hi=Math.max(hi,x); } });
  return [lo,hi]; }
function bezPt(P,t){ const m=1-t; return [m*m*m*P[0][0]+3*m*m*t*P[1][0]+3*m*t*t*P[2][0]+t*t*t*P[3][0],
                                          m*m*m*P[0][1]+3*m*m*t*P[1][1]+3*m*t*t*P[2][1]+t*t*t*P[3][1]]; }
// A point ~`back` px up-curve from the tip P[3], so an arrowhead aimed tip-ward follows the curve's REAL incoming
// direction — the endpoint tangent for a genuinely bowed arc, but the CHORD for a near-straight one. (Aiming from the
// bare last control point P[2] uses the INFINITESIMAL end tangent, which for an S scaled toward s→0 still points off
// at the take-off angle θ even though the drawn curve is visibly straight → a wrongly-rotated arrowhead, Item 10.)
function bezInDir(P,back){ const tip=P[3]; let p=P[2];
  for(let k=1;k<=24;k++){ p=bezPt(P,1-k/24); if(Math.hypot(p[0]-tip[0],p[1]-tip[1])>=back) return p; }
  return p; }
/* ── a drawn edge as a de-collision obstacle (item 6, second clause: ghost LABEL vs REAL EDGE) ────────────────
   A ghost is built to read as sitting BEHIND the real annotation — dashed, dimmed, and drawing no .arc-casing of
   its own precisely so it never occludes what it crosses (see drawBump's caller and the .arc-ghost note in
   app.css). Its LABEL contradicts that on its own: drawLabel gives every .lbl the opaque 3px paint-order casing,
   so wherever a ghost label lands it ERASES a label-sized bite out of whatever is behind it — and when that is a
   real arc, the ghost has occluded the very thing it is meant to defer to. Hence the ghost-label lift also has to
   clear the real EDGES, not only the real labels.
   The test must be against the edge's STROKE, not its bounding box: the bbox of a bump is mostly the empty room
   UNDER the arch, which is exactly where the labels of the arcs nested inside it belong. So an edge becomes a
   polyline flattened from the very cubic it was drawn from, and the test is segment-vs-box. A straight edge (root
   stub, un-bowed cross-line arc) is passed as the degenerate cubic [A,A,B,B], which bezPt traces as that exact
   segment — so there is ONE obstacle shape here, not two. */
const EDGE_FLAT=14;                              // chords per cubic. These are shallow arcs (crown 0.75·h over a chord ≥ 2·cotθ·h wide), so 14 chords stay a fraction of a pixel off the curve at any size drawn here; and the sagitta error can only make the test slightly PERMISSIVE (chord inside the arch), never invent a collision that isn't there.
function edgeObstacle(P){ const pts=[]; for(let k=0;k<=EDGE_FLAT;k++) pts.push(bezPt(P,k/EDGE_FLAT));
  const [y0,y1]=bezYExtent(P), [x0,x1]=bezXExtent(P); return {pts,x0,x1,y0,y1}; }   // bbox from the curve's TRUE extents (the same extrema solve arcCtrlChord fits its S with), for the cheap reject below
// One segment vs one axis-aligned box: Liang–Barsky parametric clip — no allocation and no trig, because this runs
// per candidate label position per edge. p===0 is the segment running parallel to that pair of box edges: it is
// inside iff it starts inside (q>=0), which is what makes a vertical root stub test correctly.
function segHitsBox(ax,ay,bx,by,L,R,T,B){ let t0=0,t1=1; const dx=bx-ax, dy=by-ay;
  const clip=(p,q)=>{ if(p===0) return q>=0;
    const r=q/p; if(p<0){ if(r>t1) return false; if(r>t0) t0=r; } else { if(r<t0) return false; if(r<t1) t1=r; } return true; };
  return clip(-dx,ax-L)&&clip(dx,R-ax)&&clip(-dy,ay-T)&&clip(dy,B-ay); }
function boxHitsEdges(edges,cx,cy,hx,hy){ const L=cx-hx,R=cx+hx,T=cy-hy,B=cy+hy;
  return edges.some(e=>{ if(e.x1<L||e.x0>R||e.y1<T||e.y0>B) return false;   // most edges are nowhere near a given label — reject on the precomputed bbox before touching a single chord
    for(let k=1;k<e.pts.length;k++) if(segHitsBox(e.pts[k-1][0],e.pts[k-1][1],e.pts[k][0],e.pts[k][1],L,R,T,B)) return true;
    return false; }); }
// How far a label box must stay off an edge's CENTRELINE: the two are drawn as HALOES, not hairlines, and it is
// the haloes that must not meet — the edge's opaque casing half-width (the same (stroke+3.5)/2 fanStep keeps
// between two fanned arcs) plus half the label's own 3px .lbl casing stroke.
function edgePad(){ const st=parseFloat(css("--arc-stroke"))||1.7; return (st+3.5)/2+1.5; }
// same take-off angle θ, measured from HORIZONTAL — matching arcCtrl/arcCtrlRaised (their handles are
// horizontal/vertical-decomposed, so a horizontal chord trivially reads θ off horizontal too) — for an
// ARBITRARY chord A→B, used by the cross-line arcs so they curve with the identical endpoint angles as
// within-line arcs. BUG FIXED: this used to decompose the handle onto the CHORD's own direction (h·cotθ along
// the chord, h perpendicular to it), which gives θ relative to the CHORD — for anything but a horizontal chord
// that overshoots θ-from-horizontal by the chord's own slope (confirmed: a 14.3°-sloped chord rendered a 45.2°
// take-off, exactly θ+14.3°). Decomposing onto the horizontal/vertical AXES instead (dxa horizontal, h
// vertical — literally arcCtrl's own dx/h pair) fixes it: the take-off is θ off horizontal regardless of slope.
// `side` (±1) = which vertical direction the S bows at A (the bow at B is the antisymmetric mirror).
function arcCtrlChord(A,B,side,gap,openTop){ const cx=B[0]-A[0], cy=B[1]-A[1], L=Math.hypot(cx,cy)||1;
  const h=ARC_K*L, dxa=ARC_COT*h, sgn=Math.sign(cx)||1;   // dxa/h: h from the chord's overall span (unchanged), but laid out on the horizontal/vertical axes — sgn keeps the handle pointing horizontally TOWARD B, matching arcCtrl's own sgn=Math.sign(x2-x1)
  const v1x=sgn*dxa, v1y=-side*h, v2x=-v1x, v2y=-v1y;   // antisymmetric S: the two handles lift to OPPOSITE vertical sides → the drawn curve S-bends
  const build=s=>[[A[0],A[1]],[A[0]+v1x*s,A[1]+v1y*s],[B[0]+v2x*s,B[1]+v2y*s],[B[0],B[1]]];   // scaling BOTH handle vectors by one factor s keeps their direction — hence the take-off angle θ — fixed; it only shrinks the bow
  // Fit the DRAWN S inside the inter-line GAP (the vertical band between the two token rows the arc lives in) — NOT the
  // thin [min(A.y),max(A.y)] endpoint span the original scaled to (that left no room and flattened the S). Binary-search
  // the LARGEST angle-preserving scale whose curve stays in the gap: an arc that already fits keeps its full lobes; only
  // one whose natural ARC_K·L bow would overshoot the gap shrinks to a smaller — but same-angle — S that just fits.
  // Item 3: the drawn S must fit BOTH the inter-line gap band AND the endpoints' own bounding box — in y AND in x.
  // The endpoint y-range is a subset of the gap band, so intersecting them clamps the vertical lobes to the endpoints;
  // the x-range clamp stops a lobe bowing sideways past the two endpoints' x-span. At s→0 the curve is the straight
  // chord (control points collapse to A,B), which always fits the box, so the binary search always converges.
  const xLo=Math.min(A[0],B[0])-0.01, xHi=Math.max(A[0],B[0])+0.01;
  const yLo=(openTop?(gap?gap[0]:-Infinity):Math.max(gap?gap[0]:-Infinity,Math.min(A[1],B[1])))-0.01, yHi=Math.min(gap?gap[1]:Infinity,Math.max(A[1],B[1]))+0.01;   // Item 4: openTop drops the endpoint-bbox TOP clamp so a recomputed cross-line arc may rise above its top endpoint to a lifted label (band top = gap[0])
  const fits=P=>{ const [ylo,yhi]=bezYExtent(P), [xlo,xhi]=bezXExtent(P); return ylo>=yLo && yhi<=yHi && xlo>=xLo && xhi<=xHi; };
  let s=1; if(!fits(build(1))){ let a=0,b=1; for(let k=0;k<24;k++){ const m=(a+b)/2; if(fits(build(m)))a=m; else b=m; } s=a; }
  return build(s); }
// `side` (±1) = which perpendicular the S lobes lift to. BOTH take-offs must head INTO the inter-line
// band the arc lives in: DOWN off the upper endpoint, UP off the lower one — anything else sends the
// curve straight back over the row it just left. arcCtrlChord's first handle has vertical component
// −side·h, so leaving an upper A needs side=−1 and leaving a lower A needs side=+1: the VERTICAL ORDER
// of the endpoints decides it, and nothing else does. Swapping A and B flips `side` AND `sgn`, which
// reproduces the very same two control points — so the drawn S is traversal-independent, i.e. a
// bottom-to-top arc (dependent on the upper line) and a top-to-bottom one are mirror images, as they
// should be. (This replaces a dX·dY chord-SLOPE test, which flips with traversal and so got the sign
// backwards for every rightward chord; the endpoint-bounding-box clamp then flattened those to a
// near-straight hairline instead of bowing them, which is why the error stayed invisible.)
function chordSide(A,B){ return A[1]<B[1]?-1:1; }
// vertical de-collision of arc labels with leader lines — identical passes to the flat arcs() view: a lifted label
// is tied back to its crown (the root by GROWING its stub, a non-root bump by a leader inside its OWN arc group so
// it draws behind that arc), and label TEXTS are drawn last so they sit in front of every arc. labs carry: dep, mx,
// apex, text, col, level (= arc height, shortest first); a non-root also carries g (its arc group); the root carries
// root:true + rootPath (+ optional rootCasing) + rootBottomY.
// measure-only label de-collision: lift each label (shortest arc first) until it clears the taller ones already
// placed, recording fy/hh/y0. No drawing, no boxes. Used by decollide() (which then draws) AND by the wrapped views'
// pre-pass that grows the inter-line gaps to fit the de-collided CROSS-line labels before the rows/lines are placed.
function placeLabels(labs,seed){ const placed=seed?seed.map(o=>({x:o.x,y:o.y,hx:o.hx,hy:o.hy})):[];   // seed = fixed obstacle boxes (e.g. the NEXT line's within-line labels) the labels must ALSO avoid, without being emitted (Item 13)
  labs.slice().sort((p,q)=>p.level-q.level || p.mx-q.mx).forEach(L=>{ const half=meas(L.text,POS_F)/2+3, hh=7, y0=L.apex-(L.root?9:8);   // shortest arc first
    let y=y0, guard=0;
    while(guard++<40 && placed.some(p=>Math.abs(p.x-L.mx)<p.hx+half && Math.abs(p.y-y)<p.hy+hh)) y-=hh*2+3;   // lift until clear of all placed (shorter) labels
    L.fy=y; L.hh=hh; L.y0=y0; placed.push({x:L.mx,y,hx:half,hy:hh,level:L.level}); }); }
function decollide(labs,boxes,svg,si,seed){ placeLabels(labs,seed);
  labs.forEach(L=>boxes.push({x:L.mx,y:L.fy,hx:meas(L.text,POS_F)/2+3,hy:L.hh}));
  labs.forEach(L=>{ if(L.fy>=L.y0-0.5) return;
    if(L.root){ if(L.rootPath){ const dd=`M ${L.mx} ${L.fy+L.hh} L ${L.mx} ${L.rootBottomY}`; L.rootPath.setAttribute("d",dd); if(L.rootCasing)L.rootCasing.setAttribute("d",dd); } return; }   // grow the root stub up to its lifted label
    const g=L.g; if(!g) return; const y1=L.fy+L.hh, y2=L.apex;
    g.insertBefore(E("line",{class:"leader",x1:L.mx,y1,x2:L.mx,y2,stroke:L.col}),g.firstChild);
    g.insertBefore(E("line",{class:"leader-casing",x1:L.mx,y1,x2:L.mx,y2}),g.firstChild); });   // leader in the arc's OWN group (behind that arc, in its z-layer)
  labs.forEach(L=>{ const lg=E("g",{class:"arc","data-s":si,"data-dep":L.dep}); lg.style.cursor="pointer"; lg.addEventListener("click",()=>pick(si,L.dep));
    drawLabel(lg,L.mx,L.fy,L.text,L.col); svg.appendChild(lg); L.lg=lg; }); }   // stash the drawn label group so growCrossArcs can remove-and-redraw it when re-solving a widened band
/* one arc bump between two x-centres, matching the main renderer (60° entry/exit, no node circle, + arrowhead) */
// `morph` (last arg, here and in drawCrossLine below): the relation this arc draws is an mSUD "/m" one, so its
// STROKE takes the same dashing the stemma/hierarchy edges give a morph-internal relation (.morph-edge). Only the
// stroke — the casing halo behind it and the arrowhead stay solid, exactly as they do on a dashed tree edge.
// `ends` (last arg, item 11): {y1,y2} — the two endpoints' OWN baselines, as the shared repArcEnds
// (js/diagram/diagram-core.js) computed them, so a reported-speech token's arc endpoint lifts off the line with
// its word exactly as it does in the flat arc view. Routed through arcCtrl2, which for y1===y2 reduces to
// arcCtrl byte-exactly — so passing `ends` unconditionally costs nothing when nothing is reported, and there is
// no second, un-lifted code path here to drift from the lifted one.
function drawBump(g,x1,x2,arcZone,top,NR,AH,col,arrow,startY,morph,ends){
  const h=arcZone-top, P=ends?arcCtrl2(x1,ends.y1,x2,ends.y2,h):(startY!=null)?arcCtrlRaised(x1,x2,arcZone,h,startY):arcCtrl(x1,x2,arcZone,h);   // startY (Item 5) lifts the START endpoint above the token's deprel label
  const te=arrow?trimT(P,1,AH-AEXT):1, sl=(arrow&&te>0.001&&te<0.999)?subCurve(P,0,te):P;   // stop the line at the arrowhead base
  const dstr=`M ${sl[0][0]} ${sl[0][1]} C ${sl[1][0]} ${sl[1][1]}, ${sl[2][0]} ${sl[2][1]}, ${sl[3][0]} ${sl[3][1]}`;
  const ink=arcInk(col);   // stroke/arrowhead recede toward bg; drawBump's caller keeps col for the label
  g.__edgeP=P;   // the UNTRIMMED control points, parked on the group for the ghost-label de-collision (edgeObstacle above). Untrimmed because `sl` stops at the arrowhead BASE while the head itself fills on to P[3] — the obstacle is the whole drawn edge, head included. Recorded rather than re-derived at the reading end, and rather than parsed back out of `d`, because an edge may be REDRAWN after this (growCrossArcs re-solves a whole band; decollide grows a root stub) and the reader must see the final geometry, not the first attempt.
  g.appendChild(E("path",{class:"arc-casing",d:dstr}));
  if(arrow) g.appendChild(E("path",{class:"ah-casing",d:arrowPath(P[2],P[3],AH,AH_OUTSET)}));
  g.appendChild(E("path",{class:"arc-path"+(morph?" morph-edge":""),d:dstr,stroke:ink}));
  if(arrow) g.appendChild(E("path",{class:"ah",d:arrowPath(P[2],P[3],AH),fill:ink}));
  return ends?Math.min(ends.y1,ends.y2)-ARC_APEX*h:startY!=null?bezYExtent(P)[0]:arcZone-0.75*h;   // visible crown y (label sits above it); with per-endpoint baselines the bump is still symmetric ABOUT ITS OWN crown, which arcCtrl2 puts h above the higher end — the same min(y1,y2)−0.75h the flat view's apexY uses: the raised (asymmetric) bump's TRUE peak from bezYExtent — NOT the control-point height P[1][1], which floats above the curve and would leave a lifted label + its leader hanging above the arc (matches the flat-brackets raised-bump crown at drawLabel, bezYExtent(P)[0]). The symmetric bump's peak is exactly arcZone-0.75h.
}
/* ONE cross-line edge from frm→tip (arrowhead at the dependent = tip), used by BOTH the wrapped arc view and the
   wrapped bracket view so their cross-line edges can't diverge: a straight arrow when the chord already meets its
   endpoints at ≥ the take-off angle θ (ARC_ANGLE), else a Hobby spline (arcCtrlChord) lifting the endpoints to θ.
   The curve is warranted SOLELY by the chord's own angle being shallower than θ — nothing else forces it (fan
   offsets, the sibling within-line bumps' own always-curved look, etc. don't enter into it: a chord that already
   meets its endpoints at ≥ θ needs no lift, however it got that angle). `casing` adds the opaque halo (arc-casing
   / ah-casing) behind the stroke. Given identical frm/tip the emitted arc-path `d` is byte-identical between the
   two views. */
function drawCrossLine(g,frm,tip,col,AH,casing,gap,openTop,morph){
  const ink=arcInk(col);   // stroke/arrowhead recede toward bg (no label drawn here)
  if(Math.atan2(Math.abs(tip[1]-frm[1]),Math.abs(tip[0]-frm[0]))>=ARC_ANGLE){
    const b=backoff(tip,frm,AH), d=`M ${frm[0]} ${frm[1]} L ${b[0]} ${b[1]}`;
    g.__edgeP=[frm,frm,tip,tip];   // same obstacle record drawBump keeps (see there): the straight branch as the degenerate cubic edgeObstacle traces as a segment — frm→TIP, not frm→b, so the arrowhead's own reach counts as edge
    if(casing){ g.appendChild(E("path",{class:"arc-casing",d})); g.appendChild(E("path",{class:"ah-casing",d:arrowPath(frm,tip,AH,AH_OUTSET)})); }
    g.appendChild(E("path",{class:"arc-path"+(morph?" morph-edge":""),d,stroke:ink}));
    g.appendChild(E("path",{class:"ah",d:arrowPath(frm,tip,AH),fill:ink}));
  } else {
    const P=arcCtrlChord(frm,tip,chordSide(frm,tip),gap,openTop);   // S-curve, angle-preservingly scaled to fit the inter-line gap; drawn to the tip so the arrowhead stays attached
    const d=`M ${P[0][0]} ${P[0][1]} C ${P[1][0]} ${P[1][1]}, ${P[2][0]} ${P[2][1]}, ${P[3][0]} ${P[3][1]}`;
    g.__edgeP=P;   // as above — and it MATTERS that this is written on every redraw: growCrossArcs re-runs this very call on the same <g> with a raised endpoint and a widened band, so a copy taken at the first draw would describe an arc that is no longer there
    const aFrm=bezInDir(P,AH+2);   // Item 10: aim the arrowhead along the curve's REAL incoming direction near the tip — the true tangent for a bowed arc, the chord for a near-straight one — NOT the bare P[2]→P[3] end tangent, which for a nearly-straight S points off at the take-off angle θ and rotates the head wrongly
    if(casing){ g.appendChild(E("path",{class:"arc-casing",d})); g.appendChild(E("path",{class:"ah-casing",d:arrowPath(aFrm,P[3],AH,AH_OUTSET)})); }
    g.appendChild(E("path",{class:"arc-path"+(morph?" morph-edge":""),d,stroke:ink}));
    g.appendChild(E("path",{class:"ah",d:arrowPath(aFrm,P[3],AH),fill:ink}));
  }
}
/* SECOND pass over cross-line arc labels — band-expansion refinement. When decollide() lifted an arc's label ABOVE
   that arc's top (upper-line) endpoint, the gap-band arc was left floating below its own label with a dangling leader.
   Fixing ONE arc in isolation is not enough: raising an endpoint makes the inter-line band taller, and every OTHER
   cross-line arc (and its label) sharing that band was fit to the OLD, narrower band and is now stale. So we work per
   BAND (all cross arcs between the same line pair share a gap):
     1. Collect the arcs whose label cleared their top endpoint and RAISE each such top endpoint to the SAME height as
        its label's top (newTopY = L.fy − L.hh — no extra lift above the label).
     2. WIDEN the band up to the HIGHEST raised endpoint (bandTop = min over the band of the raised y and the original
        gap top), and push that widened top into `boxes` so fitTight reserves the risen room in the block height.
     3. RE-FIT every cross arc in the band to the widened band — a raised one grows up (open-topped) to enclose its
        label; the rest are re-solved against the new band so none is left stale — then RE-RUN their label de-collision
        together (remove the old label groups + leaders first, re-draw via decollide, then strip the now-obsolete
        leaders from the arcs that grew up to meet their labels).
   (Merely widening the band without moving an endpoint does NOT raise a non-firing arc: its near-top lobe bows DOWN
   into the gap and the endpoint-x clamp pins its crown at the top endpoint — so re-fitting the neighbours is a no-op in
   geometry unless their own endpoints were raised, but it keeps every arc consistently solved against the live band.)
   Each clab carries frm/tip/gap (original geometry) + arcEls (the paths to replace); fy/hh/lg come from decollide.
   Shared by BOTH the wrapped arc view and the wrapped bracket view (they build clabs identically). */
function growCrossArcs(clabs,AH,boxes,si,seed){
  if(!clabs||!clabs.length) return;
  const bands=new Map();   // group the cross-line labels by their inter-line band (its original gap boundaries)
  clabs.forEach(L=>{ if(!L.frm||L.arcEls==null||L.fy==null) return;
    const key=Math.round(L.gap[0])+":"+Math.round(L.gap[1]);
    (bands.get(key)||bands.set(key,[]).get(key)).push(L); });
  bands.forEach(group=>{
    let bandTop=group[0].gap[0], rose=false;   // (1) which arcs' labels cleared their top endpoint → raise those endpoints
    group.forEach(L=>{ L._top=Math.min(L.frm[1],L.tip[1]);
      L._rise=(L.fy-L.hh < L._top-0.5) ? (L.fy-L.hh) : null;   // raise to the SAME height as the label top (no −4)
      if(L._rise!=null){ rose=true; bandTop=Math.min(bandTop,L._rise); } });   // (2) band grows up to the highest rise
    if(!rose) return;                                          // nothing rose in this band → every arc stays as drawn
    const wideGap=[bandTop, group[0].gap[1]];
    group.forEach(L=>{                                         // (3) re-fit EVERY arc in the widened band
      L.arcEls.forEach(el=>el.remove());
      L.g.querySelectorAll(".leader,.leader-casing").forEach(el=>el.remove());
      if(L.lg){ L.lg.remove(); L.lg=null; }                    // drop the label group so decollide can redraw it
      let frm=L.frm, tip=L.tip, openTop=false;
      if(L._rise!=null){ const frmTop=L.frm[1]<=L.tip[1];      // relocate ONLY this arc's top endpoint's y
        frm=frmTop?[L.frm[0],L._rise]:L.frm; tip=frmTop?L.tip:[L.tip[0],L._rise]; openTop=true; }
      drawCrossLine(L.g,frm,tip,L.col,AH,true,wideGap,openTop,isMorphRel(L.text));   // L.text is this arc's own relation → a redrawn "/m" arc keeps its dashing
      L.arcEls=[...L.g.childNodes];
      if(boxes) boxes.push({x:(frm[0]+tip[0])/2,y:bandTop,hx:1,hy:1}); });   // reserve the widened band top for fitTight
    decollide(group,boxes||[],group[0].g.ownerSVGElement,si,seed);   // re-run label de-collision across the whole band (seed = the next line's within-line labels, Item 13)
    // a risen arc reaches its label, but KEEP its de-collide leader so EVERY lifted cross-line label shows one — left in the original BEHIND-the-arc z-order where decollide inserted it (insertBefore g.firstChild). The risen arc may overlap part of the dash; that is preferred over ever drawing a leader in front of its arc.
  });
}
/* wrap a too-wide arc diagram into stacked rows; cuts fall on the fewest-crossing boundary, and any arc
   crossing a cut is shown as a stub to the row edge with a continuation chevron */
function arcsWrapped(si){
  const D=displaySent(DOC[si]); RTL=D.rtl; const t=D.tokens, n=t.length, OID=k=>D.map[k]+1;
  const ROW=parseFloat(css("--arc-row")),NR=parseFloat(css("--arc-node-r")),AH=parseFloat(css("--arrow"));
  /* Item 1 (revert of item 15): POSGAP back to its ORIGINAL 16 (item 15 had bumped it 16→20 so the
     arc-endpoint clearance WORD_OFF/XGAP/PGAP matched the deprel-label-baseline height). The arc view
     returns to its natural endpoint height; brackets/wrapped-stemma keep the item-15 offset.
     ⚠ THE EXISTING +descent(WORD_F) TERM ONLY PARTIALLY COMPENSATES FOR MAGNIFICATION — it grows with
     WORD_F's own size (so it isn't the flat-16 problem flat arcs() had), but descent is the wrong half
     of the glyph: what eats into the arc's clearance from above is the extra ASCENT a magnified glyph
     gains, not its descent. Measured on a real lzh sentence, this row's gap still fell from 12.0px
     unmagnified to 9.6px at 1.5× — smaller than flat arcs()'s pre-fix 50% collapse, but still shrinking.
     The same extra term belowGap() and flat arcs()'s WORD_OFF use closes it: exactly the old formula
     whenever TOK_MAG is 1. */
  const POSGAP=16, WORD_OFF=POSGAP+descent(WORD_F)+(TOK_MAG>1?ascent(WORD_F)*(1-1/TOK_MAG):0), TOP=14, gap=8, SP=meas(" ",WORD_F), ROWGAP=16, ASC=11, DESC=descent(WORD_F);
  const {w}=linear({tokens:t}), heads=t.map(x=>parseInt(x.head,10)), budget=Math.max(140,AVAILW/FS-16-24*TOK_MAG);   // unzoomed px (block is zoomed by FS); margin so a wide POS at a row end never overflows the port
  /* ⚠ AND A SECOND MARGIN, FOR WHAT THE ROW-PACKING CANNOT SEE. `budget` is fit against `w[]` — token/POS/
     translit SLOT widths only. `fitTight(svg,boxes)` (diagram-core.js, called once this function's arcs and
     their DE-COLLIDED labels are actually drawn) then resizes the finished SVG to the true bounding box of
     everything on it, with NO reference back to `budget` — a label pushed outward to clear its neighbour, or
     a tall arc's endpoint fan, can extend past a row's own token-based width, and fitTight EXPANDS rather
     than clips to avoid cutting off content nothing budgeted room for. Measured on a real 12-token Javanese
     row (mag 1.5): packed to 1130 against a budget of 1129 — the row-fit itself was barely over — but
     fitTight's own final width was 1157, 27px more, from arc/label geometry the packing step never priced
     in at all. That geometry scales with the MAGNIFIED token spacing arcs span, which is why this reads as
     a Javanese-specific "badly" rather than the few px every other wrapped notation can be out by — so the
     margin scales with TOK_MAG rather than being the flat constant every other wrap budget uses. 20×TOK_MAG
     is a working margin, not a proof: unlike bracketsWrapped's `white-space:nowrap` (where ANY overrun is
     unrecoverable), a row still THIS wide after the margin has `.diagram.wrapped{overflow-x:hidden}` (below)
     as a hard backstop, so an under-tuned margin costs a clipped edge, never a broken layout.
     ⚠ 20×TOK_MAG WAS STILL UNDER-TUNED — reported live: a wrapped Javanese row's own LAST token's MGloss
     ("-PRS.PTCP.GEN.PL.M") clipped by 4.9px, confirmed via the container's own getBoundingClientRect against
     the clipped <text>'s — not the negative-x MWT case fitTight's own left-clamp/margin exists for (that
     token had no left-side involvement at all: overLeft was -1045, nowhere near the container's edge). Bumped
     20→24: at TOK_MAG=1.5 that is +6px more slack (46→52), comfortably covering the observed 4.9px with a
     little room, without being so much larger it forces rows a whole token shorter than necessary in the
     common case. Still "a working margin, not a proof" — the packing/fitTight split this note describes is
     unchanged, just re-tuned against a second measured data point. */
  const cross=k=>{let cc=0; for(let i=0;i<n;i++){const h=heads[i]-1; if(h<0)continue; const lo=Math.min(i,h),hi=Math.max(i,h); if(lo<k&&hi>=k)cc++;} return cc;};
  // greedy break by each UNIT's full slot width (word, POS tag AND transliteration right edges are all in w[i]); an MWT
  // group is ATOMIC — it never splits across a line and its fused surface form is reserved against the budget
  const MWTS=(D.mwt||[]).filter(m=>m.from-1>=0&&m.to-1<n);
  const unitEnd=i=>{ let e=i; MWTS.forEach(m=>{ if(m.from-1<=i&&i<=m.to-1)e=Math.max(e,m.to-1); }); return e; };
  const unitW=(i,ue,lead)=>{ let uw=0; for(let k=i;k<=ue;k++) uw+=leadW(t[k],WORD_F)+w[k]+tailW(t[k],WORD_F)+(k>i?SP+gap:0);   // fold each host's folded-punctuation satellite width into the fit (linear()'s row total counts it, so the greedy budget must too, else comma-heavy rows silently overrun)
    const m=MWTS.find(x=>x.from-1===i&&x.to-1===ue); if(m) uw=Math.max(uw, meas(bform(m),MWT_F)+4); return uw+(lead?SP+gap:0); };
  const cutOk=k=>!MWTS.some(m=>m.from-1<k&&k<=m.to-1);   // a break between k-1,k must not fall inside an MWT
  const ranges=[]; let s0=0;
  while(s0<n){ let e=s0,wsum=0,i=s0;
    while(i<n){ const ue=unitEnd(i), add=unitW(i,ue,i>s0); if(wsum+add>budget&&i>s0)break; wsum+=add; e=ue; i=ue+1; }
    if(e>=n-1){ranges.push([s0,n-1]);break;}
    let bestK=e+1,bc=cross(e+1); for(let k=e+1;k>Math.max(s0+1,e-3);k--){ if(!cutOk(k))continue; const cc=cross(k); if(cc<=bc){bc=cc;bestK=k;}}   // nudge the cut to a low-crossing boundary, skipping any inside an MWT
    if(!cutOk(bestK)){ let k=bestK; while(k>s0+1&&!cutOk(k))k--; bestK=k; }   // never leave the cut inside an MWT group
    ranges.push([s0,bestK-1]); s0=bestK; }
  // per-row layout: local x (mirrored under RTL), arc heights (proportional to arc WIDTH), vertical offset
  const rows=ranges.map(([s,e],ord)=>{ const idx=[]; for(let i=s;i<=e;i++) idx.push(i);
    const {c,w:lw,wform,total}=linear({tokens:idx.map(i=>t[i])}); mirror(c,total); return {s,e,ord,idx,c,lw,wform,total}; });
  const svgW=Math.max(2,...rows.map(r=>r.total));
  const SPREAD=fanStep();
  const XGAP=POSGAP+DESC, PGAP=Math.max(8,XGAP-ASC);   // clearance an arc leaves above a token
  // per-row X-layout + arc geometry (all yCur-independent). The VERTICAL stacking is deferred to placeRows() below,
  // because the inter-row gaps must first be GROWN to fit the cross-line arcs + their de-collided labels.
  const rep=reportOffsets(D);   // item 7: per-token reported-speech offsets, shared by every wrapped row
  rows.forEach(r=>{ r.offX = RTL ? (svgW-r.total) : 0; r.LX=i=>r.c[i-r.s]+r.offX;
    r.maxLift=Math.max(0,...r.idx.map(i=>rep[i]||0));   // item 11: the deepest reported step taken by any token in this row — how far this row's content (glyph tops, arc endpoints) reaches ABOVE its nominal line
    r.arcsIn=[]; for(let i=r.s;i<=r.e;i++){ const h=heads[i]-1; if(h>=r.s&&h<=r.e) r.arcsIn.push({dep:i,head:h}); } });
  // NTOP: clear the lower token's top by the arc gap. NBOT: clear the UPPER token's POS/annotation stack by that same gap.
  // item 11: both go through the SHARED repBase (js/diagram/diagram-core.js) first — a reported token's whole cell
  // (its word row AND the below-stack under it) steps up off the line, so the cross-line endpoints hanging above and
  // below that cell must step up with it, or the arc lands in the gap the token has just vacated.
  const rowOf=i=>rows.find(r=>i>=r.s&&i<=r.e), NX=i=>rowOf(i).LX(i), NTOP=i=>repBase(rep,rowOf(i).wordY,i)-XGAP, NBOT=i=>repBase(rep,rowOf(i).stackBot,i)+PGAP;   // top endpoint clears the upper token's stack by the same gap within-line arcs leave below their endpoints
  // Cross-line arcs (head + dependent on DIFFERENT wrapped rows, so the arc spans the inter-row gap).
  const crossArcs=[];
  for(let i=0;i<n;i++){ const h=heads[i]-1; if(h<0)continue; if(rowOf(i)===rowOf(h))continue;
    crossArcs.push({dk:i,hk:h,len:Math.abs(i-h)}); }
  // Item 16: ONE combined endpoint fan per token across BOTH within-line and cross-line arcs. A token where a
  // cross-line arc lands (on line N+1) is ALSO shared by that line's within-line arcs; folding every arc — within-line
  // (from ALL rows) AND cross-line — into a SINGLE fanArcs pass keyed by GLOBAL token index means the shared token
  // gets ONE combined fan, so its cross-line and within-line endpoints don't overlap and their take-off angles stay
  // consistent. Uses each token's absolute x (NX); offsets are horizontal → placement-independent, computed once here.
  const fanAll=[];
  rows.forEach(r=>r.arcsIn.forEach(a=>{ a.hk=a.head; a.dk=a.dep; a.xh=NX(a.head); a.xd=NX(a.dep); a.len=Math.abs(a.dep-a.head); fanAll.push(a); }));
  crossArcs.forEach(a=>{ a.xh=NX(a.hk); a.xd=NX(a.dk);
    const iUp=rowOf(a.dk).ord<rowOf(a.hk).ord;   // is the DEPENDENT the upper-line token?
    if(iUp) a.dkey="B"+a.dk; else a.hkey="B"+a.hk;   // Item 1: the cross-line arc's UPPER-line endpoint sits at the BOTTOM of that line (NBOT); give it a bottom-side fan bucket ("B"+token) so it fans ONLY against other cross-line bottom-endpoints there — never the within-line TOP-side endpoints sharing that token (Item 16's single combined fan wrongly spread it against them). The LOWER end keeps its plain token key → still fans with that line's within-line arcs (same, top side).
    fanAll.push(a); });
  fanArcs(fanAll,SPREAD);   // sets offH/offD on every within-line AND cross-line arc from the same per-token fan
  rows.forEach(r=>{ r.arcsIn.forEach(a=>{ a.h=arcHgt(Math.abs((r.LX(a.dep)+(a.offD||0))-(r.LX(a.head)+(a.offH||0))),ROW); });   // arc height (→ Hobby handle length) from the FANNED endpoints
    r.maxH=Math.max(24,...r.arcsIn.map(a=>a.h)); });
  const cOff={}; crossArcs.forEach(a=>{ cOff[a.dk]={offH:a.offH||0,offD:a.offD||0}; });
  const crossEnds=i=>{ const h=heads[i]-1, iUp=rowOf(i).ord<rowOf(h).ord, up=iUp?i:h, lo=iUp?h:i, o=cOff[i]||{offH:0,offD:0},
      xUp=(up===i)?NX(i)+o.offD:NX(h)+o.offH, xLo=(lo===i)?NX(i)+o.offD:NX(h)+o.offH;   // fan offset applied at BOTH the head- and dependent-token ends
    return {h,iUp,up,lo,upP:[xUp,NBOT(up)],loP:[xLo,NTOP(lo)]}; };
  // how far the tallest within-line arc's crown AND its de-collided label(s) reach above a given arcZone — replays
  // the exact stacking decollide() will run, so the reserved top room can be grown to fit
  const rowLabelTop=(r,arcZone)=>{ let top=arcZone-0.75*r.maxH;   // the tallest arc's own visible crown
    r.arcsIn.forEach(a=>{ top=Math.min(top, repArcEnds(rep,arcZone,a.head,a.dep,a.h).apexY); });   // item 11: …and any arc whose report-lifted crown reaches HIGHER than that, so the top room grown below covers the lift too
    if(!show.labels) return top;
    const rlabs=[];
    r.arcsIn.forEach(a=>rlabs.push({mx:(r.LX(a.head)+(a.offH||0)+r.LX(a.dep)+(a.offD||0))/2, apex:repArcEnds(rep,arcZone,a.head,a.dep,a.h).apexY, text:t[a.dep].deprel||"", level:a.h}));
    for(let i=r.s;i<=r.e;i++){ if(heads[i]-1>=0) continue; rlabs.push({mx:r.LX(i), apex:arcZone-0.75*r.maxH, text:t[i].deprel||"root", level:r.maxH+100, root:true}); }
    const placed=[];
    rlabs.sort((p,q)=>p.level-q.level||p.mx-q.mx).forEach(L=>{ const half=meas(L.text,POS_F)/2+3, hh=7; let y=L.apex-(L.root?9:8),guard=0;
      while(guard++<40 && placed.some(pp=>Math.abs(pp.x-L.mx)<pp.hx+half && Math.abs(pp.y-y)<pp.hy+hh)) y-=hh*2+3;
      placed.push({x:L.mx,y,hx:half,hy:hh}); top=Math.min(top,y-hh); });
    return top; };
  // Item 13: the de-collided WITHIN-line label boxes of a row, at its CURRENT arcZone — replays the same placement so a
  // cross-line arc's label (which lives in the gap just above the NEXT line) can be de-collided against them too, not
  // only against its own band. Returned as obstacle boxes; the actual within-line labels are drawn later, identically.
  const rowInlineLabelBoxes=r=>{ if(!show.labels) return [];
    const rlabs=[];
    r.arcsIn.forEach(a=>rlabs.push({mx:(r.LX(a.head)+(a.offH||0)+r.LX(a.dep)+(a.offD||0))/2, apex:repArcEnds(rep,r.arcZone,a.head,a.dep,a.h).apexY, text:t[a.dep].deprel||"", level:a.h}));   // item 11: the SAME lifted crown the drawing pass below hangs the real label from, so the obstacle boxes stay in sync with it
    for(let i=r.s;i<=r.e;i++){ if(heads[i]-1>=0) continue; rlabs.push({mx:r.LX(i), apex:r.rTop, text:t[i].deprel||"root", level:r.maxH+100, root:true}); }
    const placed=[];
    rlabs.sort((p,q)=>p.level-q.level||p.mx-q.mx).forEach(L=>{ const half=meas(L.text,POS_F)/2+3, hh=7; let y=L.apex-(L.root?9:8),guard=0;
      while(guard++<40 && placed.some(pp=>Math.abs(pp.x-L.mx)<pp.hx+half && Math.abs(pp.y-y)<pp.hy+hh)) y-=hh*2+3;
      placed.push({x:L.mx,y,hx:half,hy:hh}); });
    return placed; };
  const inlineObstacles=()=>{ let o=[]; if(show.labels) rows.forEach(r=>{ o=o.concat(rowInlineLabelBoxes(r)); }); return o; };   // every row's within-line labels as cross-line de-collision obstacles (a cross label only ever meets the NEXT line's, so the rest never match in y)
  // VERTICAL stacking: place every row top→bottom. extraGap[k] injects ADDITIONAL space above row k (k≥1) — the room
  // the cross-line arcs in that inter-row gap need (from crossGapNeed below). Physically moving a line down here (not
  // just enlarging the block) is what separates the lines. Re-runnable; returns the total diagram height.
  const placeRows=extraGap=>{ let yCur=0, prevBot=0;
    rows.forEach(r=>{ if(r.ord>0) yCur+=extraGap[r.ord]||0;   // move this line (and every line below it) down by the reserved cross-arc room
      r.arcZone=yCur+TOP+ARC_APEX*r.maxH+8;   // reserve to the tallest arc's visible PEAK (0.75·h), not its handle — so the crown clears the line above by a constant TOP+8
      // DYNAMIC top room: a tall within-line arc's de-collided label (or the root stub's) can rise past TOP+8 and
      // collide with the line above; grow arcZone by however far the highest such label intrudes past prevBot+8.
      { const floor=(r.ord===0?TOP:prevBot+8), top=rowLabelTop(r,r.arcZone); if(top<floor) r.arcZone+=floor-top; }
      // MINIMUM INTER-LINE BAND. A cross-line arc has to cross the band between two lines — but so do the
      // LOWER line's own within-line bumps, which arch up into it from below to their visible peak
      // (ARC_APEX·maxH). Reserved to that peak alone the band is exactly as tall as the bumps, so a
      // cross-line arc has nowhere to run but along their crowns, grazing them the whole way across.
      // Require instead   2 · (tallest bump's peak + SPREAD·sinθ):
      //   · SPREAD·sinθ is the PERPENDICULAR clearance the FAN itself keeps between neighbouring arcs —
      //     fanStep() is precisely that clearance divided by sinθ — so a cross-line arc clears the bumps
      //     by the same margin any two fanned arcs keep from each other, casings included;
      //   · doubling leaves that much room again ABOVE the bumps for the arc to actually run in.
      // Measured against the arcs' own band — the upper line's bottom (prevBot, MWT ties included) down to
      // the lower line's glyph tops — and only ever grows it.
      if(r.ord>0){ const band=(r.arcZone+WORD_OFF-ASC-r.maxLift)-prevBot, need=2*(ARC_APEX*r.maxH+SPREAD*Math.sin(ARC_ANGLE));   // item 11: measure the band down to the HIGHEST glyph top in this row — a report-lifted token's glyphs (and the arc endpoints riding above them) reach r.maxLift further up into the band than the nominal line does
        if(band<need) r.arcZone+=need-band; }
      r.wordY=r.arcZone+WORD_OFF;
      r.rTop=r.arcZone-0.75*r.maxH;   // root stub rises to the VISIBLE apex of the tallest arc IN THIS ROW (post-wrap)
      r.stackBot=r.wordY+belowReserveH(hasTr(t),belowTierN(),show.pos);   // reserve the transliteration + gloss + POS rows below the word (Item 1/8: every below-row folds in descent(POS_F), matching belowStack's descender-matched step)
      const rt=rowTies(D,r.s,r.e), hasMwt=rt.mwt.length||rt.xpos.length; r.tieBot=r.stackBot+(hasMwt?mwtDepth(D):0);   // item 1: an ExtPos bracket reserves the same row depth an MWT tie does
      prevBot=r.tieBot; yCur=r.tieBot+ROWGAP; });
    return yCur; };
  // How much EXTRA room each inter-row gap needs: build the cross-line arcs at the CURRENT row positions, de-collide
  // their labels (measure-only), and for any label that would rise into the row above, require the gap to grow. A
  // label lifts toward the UPPER row; pushing the LOWER row (and everything below) down by Δ lowers the chord midpoint
  // — and thus the label — by Δ/2, so 2·shortfall closes the intrusion. Charge it to the gap just below the arc's
  // upper row (extra[Uord+1]); growing that gap lowers every row from there down (incl. the arc's lower endpoint).
  const CLEARX=8;
  const crossGapNeed=()=>{ const extra=new Array(rows.length).fill(0);
    if(!show.labels) return extra;
    const cl=[];
    for(let i=0;i<n;i++){ const h=heads[i]-1; if(h<0)continue; const ri=rowOf(i),rh=rowOf(h); if(ri===rh)continue;
      const {upP,loP,up}=crossEnds(i), U=rowOf(up);   // fanned endpoints (the exact geometry the arcs are drawn with) → label placement stays in sync with the fan
      cl.push({mx:(upP[0]+loP[0])/2, apex:(upP[1]+loP[1])/2, text:t[i].deprel||"", level:Math.hypot(upP[0]-loP[0],upP[1]-loP[1]), Uord:U.ord, Ubot:U.tieBot}); }
    if(cl.length){ placeLabels(cl,inlineObstacles());   // Item 13: also avoid the next line's within-line labels, so the reserved gap accounts for the extra lift
      cl.forEach(L=>{ const short=(L.Ubot+CLEARX)-(L.fy-L.hh); if(short>0.5){ const k=L.Uord+1; if(k<extra.length) extra[k]=Math.max(extra[k],2*short); } }); }
    return extra; };
  // grow the gaps until every cross-line arc's label clears the row above (monotone: gaps only widen → converges fast)
  const extraGap=new Array(rows.length).fill(0); placeRows(extraGap);
  for(let it=0;it<6;it++){ const need=crossGapNeed(); let grew=false;
    need.forEach((d,k)=>{ if(d>0.5){ extraGap[k]+=d; grew=true; } });
    if(!grew) break; placeRows(extraGap); }
  const svgH=placeRows(extraGap);
  const svg=E("svg",{class:"tree",width:svgW,height:svgH}); const boxes=[];
  // the drawn geometry of one cross-line arc, by DEPENDENT token index
  const crossGeom=i=>{ const {up,lo,upP,loP}=crossEnds(i);
    return {up,lo,upP,loP, tip:(i===up)?upP:loP, frm:(i===up)?loP:upP,   // arrowhead at the dependent
            gap:[repBase(rep,rowOf(up).stackBot,up), repBase(rep,rowOf(lo).wordY,lo)-ASC]}; };           // the arc may bow within the inter-line gap: up to the upper row's stack bottom, down to the lower row's word top. item 11: BOTH bounds follow their own token's report lift — the band has to keep containing the (lifted) endpoints, or arcCtrlChord's clamp would flatten the arc against a boundary it already sits above
  // cross-line arcs FIRST (so they sit behind the POS tags / transliterations): straight line from the bottom
  // of the node on the upper line to the top of the node on the lower line, arrowhead at the dependent
  const clabs=[];   // cross-line labels folded into the SAME de-collision pass as within-line arc labels (Item 1)
  for(let i=0;i<n;i++){ const h=heads[i]-1; if(h<0)continue; const ri=rowOf(i), rh=rowOf(h); if(ri===rh)continue;
    const col=relColor(t[i].deprel), {upP,loP,tip,frm,gap}=crossGeom(i);   // fanned endpoints at BOTH the head- and dependent-token ends (multiple cross-line arcs at one token no longer overlap)
    const g=E("g",{class:"arc","data-s":si,"data-dep":OID(i),"data-head":OID(h)});
    drawCrossLine(g,frm,tip,col,AH,true,gap,undefined,isMorphRel(t[i].deprel));   // straight when the chord already meets ≥ the take-off angle θ, else the angle-enforcing Hobby spline (arcCtrlChord) — see drawCrossLine's own comment. Shared cross-line edge WITH its casing halo (Item 3): the arc-casing/ah-casing opaque background so a crossing cross-line arc occludes cleanly, exactly like the within-line bumps (drawBump) and the flat arc view. Its LABEL gets the .lbl paint-order casing via the same decollide→drawLabel path below.
    if(show.labels){const mx=(upP[0]+loP[0])/2, my=(upP[1]+loP[1])/2; clabs.push({dep:OID(i),mx,apex:my,text:t[i].deprel,col,level:Math.hypot(upP[0]-loP[0],upP[1]-loP[1]),g,frm,tip,gap,arcEls:[...g.childNodes]});}   // lift-until-clear + leader, exactly like a within-line arc's label (frm/tip/gap/arcEls: Item 4 lets a lifted label grow the arc up to it)
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i))); svg.appendChild(g); }
  if(show.labels){ const inl=inlineObstacles(); decollide(clabs,boxes,svg,si,inl); growCrossArcs(clabs,AH,boxes,si,inl); }   // de-collide cross-line labels (Item 13: also against the next line's within-line labels); then grow/widen: raise any arc whose label cleared its top endpoint, widen the band, re-solve the band
  rows.forEach(r=>{
    // within-row arcs (shorter in front)
    const rlabs=[];
    // root stub FIRST (if the root token lives in this row) → drawn BEFORE the row's arcs so it sits at a LOWER z-index.
    // The root is the tallest edge; keeping it behind means it never occludes the shorter arcs it spans over. Matches the
    // flat arc view (which also draws the root stub first). Drawn WITH its casing; its label folds into the same
    // de-collision pass so, if lifted, the stub grows to reach it.
    for(let i=r.s;i<=r.e;i++){ if(heads[i]-1>=0)continue; const X=r.LX(i), top=r.rTop, col=relColor("root"), ink=arcInk(col),
      tip=[X,repBase(rep,r.arcZone,i)],frm=[X,top],b=backoff(tip,frm,AH), g=E("g",{class:"arc","data-s":si,"data-dep":OID(i)});   // item 11: a reported root lifts its stub's FOOT too, exactly as the flat view's rootY does (shared repBase)
      g.appendChild(E("path",{class:"arc-casing",d:`M ${X} ${top} L ${b[0]} ${b[1]}`}));
      g.appendChild(E("path",{class:"ah-casing",d:arrowPath(frm,tip,AH,AH_OUTSET)}));
      const rp=E("path",{class:"arc-path",d:`M ${X} ${top} L ${b[0]} ${b[1]}`,stroke:ink}); g.appendChild(rp);
      g.appendChild(E("path",{class:"ah",d:arrowPath(frm,tip,AH),fill:ink}));
      g.__edgeP=[frm,frm,tip,tip];   // the stub as an obstacle for the ghost labels, in drawBump's own record shape (degenerate cubic = the segment); down to TIP, so the arrowhead counts. Re-stated after decollide below, which may grow this very stub up to a lifted root label
      g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i))); svg.appendChild(g);
      if(show.labels) rlabs.push({dep:OID(i),mx:X,apex:top,text:t[i].deprel||"root",col,level:r.maxH+100,root:true,rootPath:rp,rootBottomY:b[1],tip}); }
    r.arcsIn.slice().sort((a,b)=>b.h-a.h||catRank(t[a.dep].deprel)-catRank(t[b.dep].deprel)).forEach(a=>{
      const top=r.arcZone-a.h, g=E("g",{class:"arc","data-s":si,"data-dep":OID(a.dep),"data-head":OID(a.head)});
      const apex=drawBump(g,r.LX(a.head)+(a.offH||0),r.LX(a.dep)+(a.offD||0),r.arcZone,top,NR,AH,relColor(t[a.dep].deprel),true,null,isMorphRel(t[a.dep].deprel),repArcEnds(rep,r.arcZone,a.head,a.dep,a.h));   // item 11: per-endpoint baselines from the SHARED repArcEnds — the same call arcs() makes in the flat view, so a reported subtree's arcs lift with its words here too
      g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(a.dep))); svg.appendChild(g);
      const mx=(r.LX(a.head)+(a.offH||0)+r.LX(a.dep)+(a.offD||0))/2;   // centre on the fanned-endpoint midpoint (the arc's crown), not the node centres
      if(show.labels){ rlabs.push({dep:OID(a.dep),mx,apex,text:t[a.dep].deprel,col:relColor(t[a.dep].deprel),level:a.h,g}); }   // carry the arc group so a lifted label's leader draws in its z-layer
      boxes.push({x:mx,y:apex,hx:2,hy:2}); });
    if(show.labels) decollide(rlabs,boxes,svg,si);   // de-collide the whole row's labels together (matches the flat view)
    // …and a root stub that just GREW to reach its lifted label is a taller obstacle than the one recorded at draw
    // time. Re-state it from decollide's own condition (L.fy<L.y0 → the stub was rewritten to start at the label's
    // bottom edge), so the ghost labels below meet the stub that is actually on screen.
    if(show.labels) rlabs.forEach(L=>{ if(!L.root||!L.rootPath) return; const g=L.rootPath.parentNode, ty=(L.fy<L.y0-0.5)?L.fy+L.hh:L.apex;
      if(g) g.__edgeP=[[L.mx,ty],[L.mx,ty],L.tip,L.tip]; });
    // tokens + below stack (drawn last → on top of the cross-line edges)
    r.idx.forEach(i=>{ const tk=t[i], X=r.LX(i), lw=r.lw[i-r.s], g=E("g",{class:"tok-group"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});
      const wy=repBase(rep,r.wordY,i);   // item 11: reported-speech step UP off the line — the same shared repBase the arc endpoints above went through, so word and arc leave the line together
      const wyD=wy+TOK_Y_LOWER, loB=loBoxes(boxes);   // …and then the DRAW baseline, TOK_Y_LOWER below it (js/diagram/diagram-core.js). `r.wordY`/`r.arcZone`/`r.stackBot` stay the LAYOUT row geometry — the within-row bumps, the cross-line arcs' band bounds and every box here are all stated in it, so only the token's own ink moves
      const hy=Math.min(r.arcZone-NR, wyD-14);
      g.appendChild(E("rect",{class:"tok-hit",x:X-lw/2-3,y:hy,width:lw+6,height:r.stackBot+6+TOK_Y_LOWER+TOK_TR_GAP-hy}));
      g.appendChild(E("rect",{class:"tok-wash",x:X-lw/2-3,y:wyD-14,width:lw+6,height:r.stackBot+6+TOK_Y_LOWER+TOK_TR_GAP-(wyD-14)}));   // wash only the word+POS band, not the arcs above   // both reaches grow by the same 2.5 the stack dropped, so the (lowered) POS row stays inside them
      const f=E("text",{class:"tok-word"+italDeco(tk),x:X,y:wyD,"text-anchor":"middle"}); f.textContent=bform(tk);   // host form only
      belowStack(g,X,wyD+TOK_TR_GAP,tk,loB,hasTr(t));   // the flat arc view's own +2.5 (TOK_TR_GAP, js/diagram/diagram-core.js) — the wrapped variant of a notation must not drift from the flat one, and the row-layout `r.stackBot` (which the cross-line arcs' band bounds are measured from) stays untouched so no edge moves
      g.appendChild(f); gwFormSVG(g,f,tk,X,wyD,WORD_F,"tok-word",si,loB);   // goeswith: continuation parts beside the head (see gwFormSVG); the slur comes from this row's own tie layer (mwtTie below)
      if(gwOf(tk).length) g.setAttribute("data-gw",[OID(i)].concat(gwOf(tk).map(p=>p.oid)).join(" "));
      svgMarks(g,X,wyD,tk,WORD_F); svgFormSeamMark(g,tk,X,wyD,WORD_F,loB);   // Item 11: form appended LAST → paints on TOP of the POS/translit stack; item 4: marks in front, then the seam mark off the form's inline end
      g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i)));
      g.addEventListener("mouseenter",()=>dim(si,OID(i))); g.addEventListener("mouseleave",()=>dim(si,null)); svg.appendChild(g);
      boxes.push({x:X,y:wy-8,hx:lw/2+((i===r.s||i===r.e)?Math.ceil(4*FS):0),hy:12});   // Item 10 / item 4: reserve casing/Noto fudge for the row's END slots (LTR rightmost = r.e, RTL rightmost = r.s), SCALED by the block zoom (×FS), so the widest row's last token — form, POS, relation label and casing halo — never clips at the fitTight viewBox edge even magnified by zoom:var(--fs)
      drawHangsSVG(svg,tk,X,wyD,WORD_F,"tok-word",si,loB,OID(i)); drawLeadsSVG(svg,tk,X,wyD,WORD_F,"tok-word",si,loB,OID(i)); });   // folded punctuation (and item 6's correct form) beside the word
    mwtTie(svg, r.c.map(x=>x+r.offX), r.wform, rowTies(D,r.s,r.e), r.stackBot+TOK_Y_LOWER+TOK_TR_GAP+5, loBoxes(boxes), si);   // the tie hangs off the DRAWN stack bottom, so it keeps its distance under the lowered word
  });
  // Ghost edges (Shared=Yes AND Subject-raising): dashed, dimmed — decorative, not a diagram element of their own,
  // but still: (item 7) fan-shared with the real arcs at any token they land on (never the reverse), (item 2)
  // counted toward fitTight's boxes, (item 3) highlighted when their dependent is selected, (item 6) their
  // labels decollided against the real ones — only ghost labels ever move.
  // ghostPairsFor gives [originIdx,targetIdx,rel] — here `i` is the ORIGIN (drawn as the ghost's dependent,
  // matching data-dep below) and `oh` is the target (Shared: the other conjunct; Subj: the predicate).
  const ghostPairs=ghostPairsFor(t).map(([o,tg,rel])=>({i:o,oh:tg,rel}));
  const ghostFan=ghostPairs.map(p=>{ const a={hk:p.oh,dk:p.i,xh:NX(p.oh),xd:NX(p.i)};
    if(rowOf(p.oh)!==rowOf(p.i)){ const iUp=rowOf(p.i).ord<rowOf(p.oh).ord; if(iUp) a.dkey="B"+a.dk; else a.hkey="B"+a.hk; }   // item 1's own cross-line bucket split, applied to ghosts too
    return a; });
  fanGhostArcs(fanAll,ghostFan,SPREAD);
  const ghostG=[];
  ghostPairs.forEach((p,gi)=>{ const {i,oh,rel}=p, col=relColor(rel), fan=ghostFan[gi], rDep=rowOf(i), rOth=rowOf(oh);
    if(rDep===rOth){ const x1=NX(oh)+(fan.offH||0), x2=NX(i)+(fan.offD||0), h=Math.min(arcHgt(Math.abs(x2-x1),ROW),rDep.arcZone-8), top=rDep.arcZone-h;
      const g=E("g",{class:"ghost-g"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-dep":OID(i)});
      const apex=drawBump(g,x1,x2,rDep.arcZone,top,NR,AH,col,true,null,false,repArcEnds(rep,rDep.arcZone,oh,i,h));   // item 11: a ghost duplicates a real attachment, so it lifts by exactly the same shared rule the real bump above uses
      g.querySelectorAll(".arc-path").forEach(pp=>pp.classList.add("arc-ghost")); g.querySelectorAll(".ah").forEach(pp=>pp.classList.add("ah-ghost"));
      svg.appendChild(g); ghostG.push({g,mx:(x1+x2)/2,apex,rel,col});
    } else { const iUp=rDep.ord<rOth.ord, up=iUp?i:oh, lo=iUp?oh:i, upX=NX(up)+(up===i?(fan.offD||0):(fan.offH||0)), loX=NX(lo)+(lo===i?(fan.offD||0):(fan.offH||0));
      const upP=[upX,NBOT(up)], loP=[loX,NTOP(lo)], tip=(i===up)?upP:loP, frm=(i===up)?loP:upP;
      const g=E("g",{class:"ghost-g"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-dep":OID(i)});
      drawCrossLine(g,frm,tip,col,AH,false,[repBase(rep,rowOf(up).stackBot,up),repBase(rep,rowOf(lo).wordY,lo)-ASC]);   // item 11: same report-lifted band bounds crossGeom() gives the real cross-line arcs
      g.querySelectorAll(".arc-path").forEach(pp=>pp.classList.add("arc-ghost")); g.querySelectorAll(".ah").forEach(pp=>pp.classList.add("ah-ghost"));
      svg.appendChild(g); ghostG.push({g,mx:(upP[0]+loP[0])/2,apex:(upP[1]+loP[1])/2,rel,col}); } });
  // Every REAL edge in this diagram, as the flattened obstacles the ghost-label pass below lifts off. Read off the
  // groups themselves — the control points drawBump/drawCrossLine/the root stub recorded as they drew — and read
  // HERE, at the end, because that is the only point at which they are all final: growCrossArcs may have re-solved
  // a whole band of cross-line arcs and decollide may have grown a root stub, both AFTER their first draw.
  // `g.arc` also settles which edges count, structurally: the ghosts are `.ghost-g` and so are not in this list at
  // all, which is the intended asymmetry — a ghost label may still sit on a ghost edge, its own included. Ghosts
  // are what defer to the real annotation; they need not defer to each other.
  const realEdges=(show.labels&&ghostG.length)?[...svg.querySelectorAll("g.arc")].map(g=>g.__edgeP).filter(Boolean).map(edgeObstacle):[], EPAD=edgePad();   // built only where there is a ghost to place — a sentence with none (the overwhelming majority) pays nothing for this
  // ghost labels: vertical-lift decollision against `boxes` (every real label is already final by this point —
  // read, never altered) — only the ghost labels themselves move (item 6). Each ghost's OWN crown box is pushed
  // to `boxes` only AFTER its label is placed (not during the drawing loop above) — pushing it first made every
  // ghost's own initial position (only 8px from its own crown) collide with itself, lifting labels needlessly high.
  if(show.labels) ghostG.forEach(({g,mx,apex,rel,col})=>{ const half=meas(rel,POS_F)/2+3, hh=7, y0=apex-8;
    let y=y0, guard=0;
    while(guard++<40 && boxes.some(b=>Math.abs(b.x-mx)<b.hx+half && Math.abs(b.y-y)<b.hy+hh)) y-=hh*2+3;
    // …then keep lifting off any REAL EDGE the label would land on top of (see edgeObstacle): a ghost label carries
    // drawLabel's opaque casing, so parked on a real arc it erases a bite out of it, which is precisely the
    // occlusion a ghost is built never to commit. Same step, and the label-box test comes along for the ride so a
    // higher slot can't land back on a real label. Bounded SEPARATELY from the pass above and FALLING BACK to its
    // answer: the label pass always terminates (above every label there is open sky), but an edge pass need not —
    // a stub or a tall bump can run the whole height of the diagram beside the label's x — and a ghost label
    // parked a hundred pixels up on a leader reads far worse than one grazing an arc.
    for(let k=0,ya=y;k<10;k++){ if(!(boxes.some(b=>Math.abs(b.x-mx)<b.hx+half && Math.abs(b.y-ya)<b.hy+hh) || boxHitsEdges(realEdges,mx,ya,half+EPAD,hh+EPAD))){ y=ya; break; } ya-=hh*2+3; }
    if(y<y0-0.5) g.insertBefore(E("line",{class:"leader leader-ghost",x1:mx,y1:y+hh,x2:mx,y2:apex,stroke:arcInk(col)}),g.firstChild);   // item 6   /* the drained ink, NOT the full relation colour: the ghost EDGE is stroked with arcInk(col) while this leader took `col` raw, so at the same .72 opacity the leader read as the strongest part of a ghost — the one thing it is least meant to be. arcInk is what every other ghost stroke already passes through. */
    drawLabel(g,mx,y,rel,col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:mx,y,hx:half,hy:hh}); boxes.push({x:mx,y:apex,hx:2,hy:2}); });
  fitTight(svg,boxes);
  /* ⚠ fitTight (just above) can still widen past `budget` — see its own note on `budget` for why this is
     accepted rather than chased to zero — so this notation gets the SAME hard backstop bracketsWrapped's
     `white-space:nowrap` needed: `.wrapped` (app.css) clips this .diagram's horizontal overflow silently
     instead of pushing the page wider or leaving a horizontal scrollbar on a view whose whole point is not
     needing one. Its own `max-height:none` is load-bearing, not incidental — see its comment; dropping it
     re-introduces a real regression (a tall wrapped diagram rendering squashed to a sliver), not a cosmetic
     one. `wrap()` is shared with wrapDiagram's own plain (unwrapped) fallback, which must NOT get this
     treatment — genuinely wide unwrapped content is supposed to scroll — so the class is added here, after
     wrap() returns, not inside it. */
  const d=wrap(svg); d.classList.add("wrapped");
  if(svg._leftOverflow>0) d.style.marginLeft="-"+svg._leftOverflow+"px";   // give the CONTAINER'S own clip box the room fitTight's left clamp excluded from the viewBox — see fitTight's own note
  return d;
}

/* ---- wrapped (projection) layout for stemma / hierarchy ----
   When the flat diagram is wider than the port, redraw it as: the whole tree stretched to fill its box (width
   fits the token strip, height fills the rest of the diagram area — NON-uniformly), sitting above the tokens
   laid out as in the wrapped arc view, one line at a time. Nodes carry no labels; edge labels keep a constant
   size and are shown only if the whole set fits. A projection line drops from each node to its word, but only
   for whichever token row currently sits at the top of the scrolled token box. */
// stemma geometry, label-less: node positions + edges, sized (with label spreading only when labels are kept)
function stemmaGeomW(t,n,withLabels){
  const {head,depth}=structure({tokens:t});
  const {c,lw,ldw}=stemmaLayout({tokens:t},false,false);   // ldw: the per-node inline-START reserve — see the same destructure in stemma() (js/diagram/diagram-render.js) and spreadForLabels' own note
  const LV=48,TOP=18,B=7,SPW=meas(" ",WORD_F);   // TOP matches stemma()'s own (js/diagram/diagram-render.js) — raising it to "lower the tokens" was tried and reverted there, see its note; TOK_Y_LOWER (applied per token, at the draw site, never to this geometry) is the fix that actually works
  const edges=[];
  for(let i=0;i<n;i++){const h=head[i]; if(h<1||h>n||h===i+1) continue;
    edges.push({d:i,h:h-1,rel:t[i].deprel,w:withLabels?meas(t[i].deprel,POS_F)+SPW:0});}
  if(withLabels) spreadForLabels(c,edges,lw,ldw);   // lw/ldw drive its closing re-seat, so the wrapped stemma's own natW starts from the same honest left edge the flat one does — see spreadForLabels' note in diagram-core.js
  ensureNodeGaps(c,lw);   // re-guarantee each node's own below-stack width after label-spreading — see its own note in diagram-core.js
  const maxD=Math.max(0,...depth), ny=d=>TOP+d*LV, natW=Math.max(2,...c.map((cx,i)=>cx+lw[i]/2))+2;
  mirror(c,natW);
  return {pos:c.map((cx,i)=>({x:cx,y:ny(depth[i])})), edges, natW, natH:ny(maxD)+LV};
}
// hierarchy geometry, label-less: the same tidy layout as tree(), returning node positions + parent→child edges
function treeGeomW(t,n,withLabels){
  const {children,root}=structure({tokens:t});
  const LV=48,TOP=18,B=7,SPW=meas(" ",WORD_F),NGAP=SPW+4, lw=i=>Math.max(fmeas(t[i],NODE_F),glossSlotW(t[i])), hgw=i=>tailW(t[i],NODE_F), ldw=i=>leadW(t[i],NODE_F), elw=i=>(withLabels&&i!==root)?meas(t[i].deprel,POS_F):0;   // item 13: node slot also fits the gloss tiers. TOP matches tree()'s own (below) — raising it to "lower the tokens" was tried and reverted there, see stemma()'s note (js/diagram/diagram-render.js); TOK_Y_LOWER (applied per token, at the draw site, never to this geometry) is the fix that actually works
  const x=tidyLayout(n,root,i=>children[i],{lw,hgw,ldw,elw,SPW,NGAP});   // #5: shared with the unwrapped hierarchy tree() → one source of truth, so the wrapped hierarchy can't drift from the flat one
  const depth=new Array(n).fill(0); (function d(i,dd){depth[i]=dd; children[i].forEach(c=>d(c,dd+1));})(root,0);
  const maxD=Math.max(0,...depth), ny=d=>TOP+d*LV, natW=Math.max(2,...x.map((xx,i)=>xx+lw(i)/2+hgw(i)))+6;
  if(RTL) for(let i=0;i<n;i++) x[i]=natW-x[i];
  const edges=[]; for(let i=0;i<n;i++) children[i].forEach(ci=>edges.push({d:ci,h:i,rel:t[ci].deprel}));
  return {pos:x.map((xx,i)=>({x:xx,y:ny(depth[i])})), edges, natW, natH:ny(maxD)+LV};
}
function projWrapped(si,kind){
  const D=displaySent(DOC[si]); RTL=D.rtl; const t=D.tokens, n=t.length, OID=k=>D.map[k]+1;
  if(!n) return null;
  const geomFn = kind==="tree" ? treeGeomW : stemmaGeomW;
  // — wrap the tokens by their full slot width, tokens only (arcs are replaced by the tree above) —
  const gap=8, SP=meas(" ",WORD_F), ASC=11;
  // Item 6 — clip-safe strip width (STRIP px). The wrapproj token strip is HARD-clipped at the diagram's right edge
  // (.wp-toks + .diagram.wrapproj both overflow:hidden), and the post-render alignment pass shifts it right by the
  // Form-column indent (≈ the ID-column width). AVAILW is a CONSTANT rendered width meant for the SCROLLING views, so
  // AVAILW/FS grows PAST the diagram's own (zoom-shrunk: docW − 36·FS) width as FS rises, and it reserves nothing for
  // that indent → the rightmost token clips at higher zoom. Derive the port from the LIVE doc width instead: docW/FS,
  // less the block padding (36) and the indent, so the whole reserved strip fits the clip box at every zoom.
  const docW=AVAILW+52, indent=idW+12, port=Math.max(160, docW/FS-36-indent), budget=port;
  const MWTS=(D.mwt||[]).filter(m=>m.from-1>=0&&m.to-1<n);   // MWT groups are ATOMIC for line-breaking — never split; break BEFORE one that won't fit
  const unitEnd=i=>{ let e=i; MWTS.forEach(m=>{ if(m.from-1<=i&&i<=m.to-1)e=Math.max(e,m.to-1); }); return e; };   // last token of the atomic unit starting at i (a lone token, or a whole MWT group)
  const mwtEdgeW=i=>{ let fw=0; MWTS.forEach(m=>{ if(m.from-1===i||m.to-1===i)fw=Math.max(fw,meas(bform(m),MWT_F)); }); return fw; };   // width of a fused surface form sitting at a unit edge (may exceed its components)
  const layout=depW=>{   // greedy wrap by each UNIT's slot width; an MWT never splits and its (possibly wider) fused form is reserved so it can't overflow the inline-end
    const {w}=linear({tokens:t},depW);
    const unitW=(i,ue,lead)=>{ let uw=0; for(let k=i;k<=ue;k++) uw+=leadW(t[k],WORD_F)+w[k]+tailW(t[k],WORD_F)+(k>i?SP+gap:0);   // linear()'s row total counts each host's folded-punctuation satellite width, so the greedy budget must too — else a comma-heavy row (e.g. Gettysburg) overruns svgW and the .diagram.wrapproj{overflow:hidden} clips its rightmost token
      const m=MWTS.find(x=>x.from-1===i&&x.to-1===ue); if(m) uw=Math.max(uw, meas(bform(m),MWT_F)+4);   // reserve the fused form's real width against the line budget
      return uw+(lead?SP+gap:0); };
    // Inline-end reserve = the row-edge unit's REAL rightmost ink past the slot linear() sized. linear()'s row `total`
    // sizes the last slot to the MAX(form, POS, translit) canvas advance, but the drawn ink runs further: a wide
    // uppercase POS ("CCONJ") centred on a narrower form, the form's 3.5px casing halo, .02em POS letter-spacing, and a
    // fused MWT surface form wider than its components all reach past that advance. Unlike arcsWrapped (which fitTight()s
    // its viewBox to the drawn boxes, incl. the MWT-form box), THIS token strip is HARD-clipped at svgW — the per-row
    // <svg> viewport plus .wp-toks{overflow-x:hidden} — AND the whole .diagram.wrapproj{overflow:hidden}. So svgW, not a
    // fudge, is the clip determinant: measure the overhang past the slot on BOTH inline ends (LTR last token, RTL
    // sentence-first token) and size the reserve to it, floored at the old 8. Unzoomed px, so the block zoom scales it.
    const LSpx=0.22;   // .tok-pos letter-spacing .02em at 11px, per glyph
    const inkHalf=idx=>{ const tk=t[idx]; let h=fmeas(tk,WORD_F)/2+1.9;   // form ink half + 3.5px paint-order halo
      if(show.pos&&tk.upos) h=Math.max(h, meas(tk.upos,POS_F)/2 + tk.upos.length*LSpx + 1.7);   // POS ink half + full letter-spacing run + 3px halo
      if(trLayer()){const rt=trTxt(tk); if(rt) h=Math.max(h, meas(rt,trFont(tk))/2+1.7);}
      if(depW){ const dep=tk.deprel||(parseInt(tk.head,10)===0?"root":""); if(dep) h=Math.max(h, meas(dep,POS_F)/2+1.7); }   // item 4: the above-token relation label (.lbl, 3px paint-order halo). Its INK is folded into the slot width by linear(...,true), but its casing halo is not — so a row-edge deprel wider than the form/POS clips at the hard svg edge unless reserved here
      const fw=mwtEdgeW(idx); if(fw) h=Math.max(h, fw/2+2);   // fused surface form, conservatively treated as centred on this edge token
      return h; };
    const ZPAD=Math.ceil(3*FS);   // item 4: right/left padding that GROWS with the block zoom (--fs). A sub-pixel ink overhang is magnified ×FS by zoom:var(--fs), so a token that just fits at 100% clips at 110% — scale the safety margin so the last token's glyphs never touch the hard-clipped svg edge at any zoom
    // greedy-wrap the tokens at budget `budg`, then measure the reserved strip width. Split out so the budget can be
    // TIGHTENED (below) once the reserve is known — the row breaks depend on it, so it can't be a one-shot subtraction.
    const build=budg=>{ const ranges=[]; let s0=0;
      while(s0<n){ let e=s0,wsum=0,i=s0;
        while(i<n){ const ue=unitEnd(i), add=unitW(i,ue,i>s0); if(wsum+add>budg&&i>s0)break; wsum+=add; e=ue; i=ue+1; }   // e lands on a unit boundary → an MWT is kept whole and pushed to the next line if it wouldn't fit
        ranges.push([s0,e]); s0=e+1; }
      const rows=ranges.map(([s,e])=>{ const idx=[]; for(let i=s;i<=e;i++) idx.push(i);
        const {c,w:lw,wform,total}=linear({tokens:idx.map(i=>t[i])},depW); mirror(c,total); return {s,e,idx,c,lw,wform,total}; });
      let over=0; rows.forEach(r=>{ over=Math.max(over, inkHalf(r.s)-r.lw[0]/2, inkHalf(r.e)-r.lw[r.e-r.s]/2); });
      const CASE=Math.max(8,Math.ceil(over)+2)+ZPAD, maxT=Math.max(2,...rows.map(r=>r.total)), svgW=maxT+2*CASE;
      rows.forEach(r=>{ r.offX=CASE+(RTL?(maxT-r.total):0); r.LX=i=>r.c[i-r.s]+r.offX; });   // CASE clearance on BOTH inline ends → protects the LTR last token and the RTL sentence-first (rightmost) token
      return {rows,svgW,CASE}; };
    // Item 6 (clipping): the reserved strip svgW = maxT + 2·CASE is HARD-clipped (no h-scroll), so it must fit the
    // clip-safe port — else ×FS the row-edge token clips as zoom rises. 2·CASE isn't known until the rows exist, so wrap
    // by the plain budget first; if the reserved strip still overruns the port, re-wrap with the budget dropped to
    // port − 2·CASE (so maxT itself fits) and iterate (monotone → converges; stops if a lone unit exceeds the port).
    let res=build(budget), guard=0;
    while(res.svgW>port+0.5 && guard++<6){ const r2=build(Math.max(120, port-2*res.CASE));
      if(r2.svgW>res.svgW-0.5){ res=r2; break; } res=r2; }   // no further improvement (a lone unit is wider than the port) → accept and stop
    return res; };
  // — tree geometry: labels de-collided ONLY by horizontal displacement (spreadForLabels), exactly as the non-wrapped
  //   stemma. Decide against the tokens at their natural width: if the spread tree fits that strip, the deprels live IN
  //   the tree; otherwise the tree stays tight and the deprels go above the tokens (re-spaced to reserve room for them). —
  let {rows,svgW}=layout(false);
  const Gs=geomFn(t,n,true), labelsInTree=show.labels && Gs.natW<=svgW+1, deprelsAbove=show.labels && !labelsInTree;
  if(deprelsAbove) ({rows,svgW}=layout(true));
  const G=labelsInTree?Gs:geomFn(t,n,false);
  G.edges.sort((p,q)=>catRank(p.rel)-catRank(q.rel));
  // Shared=Yes ghost edges (dashed, dimmed, decorative — see stemma()'s own comment): one per OTHER conjunct in
  // the coordination, alongside the real edge wpDraw already draws to whichever conjunct it's actually attached to.
  // ghostPairsFor gives [originIdx,targetIdx,rel] — `d` (dependent) is the origin, `h` (head) is the target,
  // matching this view's own edge-object convention.
  const ghostEdges=ghostPairsFor(t).map(([o,tg,rel])=>({d:o,h:tg,rel}));
  const proj = kind==="stemma" ? stemmaProj : true;
  const anyMwt=rows.some(r=>{ const rt=rowTies(D,r.s,r.e); return rt.mwt.length||rt.xpos.length; });
  // one uniform row height. With deprels above, the word gets an equal gap above (deprel) and below (POS), and the
  // whole stack sits with equal padding at the top and bottom of the row.
  const PADV=8, belowH=belowReserveH(hasTr(t),belowTierN(),show.pos);   // Item 1/8: every below-row (translit, each gloss, POS) folds in descent(POS_F), matching belowStack's descender-matched step
  const RELDESC=descent(WORD_F);   // fold the token form's descender depth into the deprel→word step (as the arc view / unwrapped stemma do between levels), so descenders clear below the deprel
  /* ⚠ +MAG_DEPREL_GAP (js/diagram/diagram-core.js), the ONE term in this round's set that a magnified
     SANSKRIT document takes as well as a Literary Chinese one ("the parts of the lzh corrections that
     also apply to enlarged Sanskrit scripts are: increased gap between token and deprel (in wrapped
     stemmas and hierarchies …)"). It is the same total flat brackets carries, so the two views state one
     gap rather than two. Added to BOTH `wordY` and the subtraction that yields `yDep`, so the LABEL stays
     at PADV+8 and the WORD drops away from it — the same direction flat brackets moves, and it keeps the
     row's own top clearance untouched. `stackBot`/`oneRowH` follow wordY, so the strip grows by exactly
     the extra and nothing below the word is crowded. 0 at TOK_MAG 1, where this file is unchanged. */
  const wordY = deprelsAbove ? (PADV+8+20+RELDESC+MAG_DEPREL_GAP) : ASC, yDep = wordY-(20+RELDESC+MAG_DEPREL_GAP), stackBot = wordY+belowH;   // deprel 20px + descent(WORD_F) above the word: the extra descender depth is clearance BELOW the label (deprel y stays at PADV+8, word drops by the descent); top clearance unchanged
  const oneRowH=Math.ceil(stackBot+descent(WORD_F)+(anyMwt?mwtDepth(D)+18:0)+(deprelsAbove?PADV:10));
  // — token rows, one <svg> per row (each a scroll-snap target) so exactly one line is visible at a time —
  const toks=document.createElement("div"); toks.className="wp-toks"; toks.style.height=oneRowH+"px"; toks.style.width=svgW+"px";
  const rep=reportOffsets(D);   // item 7: per-token reported-speech offsets, shared by every wrapped row
  rows.forEach(r=>{ const rsvg=E("svg",{class:"tree",width:svgW,height:oneRowH,viewBox:`0 0 ${svgW} ${oneRowH}`});
    r.idx.forEach(i=>{ const tk=t[i], X=r.LX(i), lw=r.lw[i-r.s], g=E("g",{class:"tok-group"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});
      const wy=wordY-rep[i];   // item 11: reported-speech step UP off the line
      g.appendChild(E("rect",{class:"tok-hit",x:X-lw/2-3,y:Math.min(0,wy-14),width:lw+6,height:stackBot+6-Math.min(0,wy-14)}));
      const washTop = deprelsAbove ? (yDep-9) : (wy-14);   // when the deprel rides above the token, the drag-target wash starts above the LABEL so it encompasses the whole token cell (relation + form + POS) — matching the unwrapped stemma, whose node wash spans its full cell; otherwise wash just the word+POS band
      g.appendChild(E("rect",{class:"tok-wash",x:X-lw/2-3,y:washTop,width:lw+6,height:stackBot+6-washTop}));
      const f=E("text",{class:"tok-word"+italDeco(tk),x:X,y:wy,"text-anchor":"middle"}); f.textContent=bform(tk);   // host form only
      belowStack(g,X,wy,tk,null,hasTr(t));
      g.appendChild(f); gwFormSVG(g,f,tk,X,wy,WORD_F,"tok-word",si,null);   // goeswith: continuation parts beside the head; the slur comes from this row's tie layer (mwtTie below)
      if(gwOf(tk).length) g.setAttribute("data-gw",[OID(i)].concat(gwOf(tk).map(p=>p.oid)).join(" "));
      svgMarks(g,X,wy,tk,WORD_F); svgFormSeamMark(g,tk,X,wy,WORD_F,null);   // Item 11: form appended LAST; item 4: marks in front, then the seam mark off the form's inline end
      g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i))); rsvg.appendChild(g);
      drawHangsSVG(rsvg,tk,X,wy,WORD_F,"tok-word",si,null,OID(i)); drawLeadsSVG(rsvg,tk,X,wy,WORD_F,"tok-word",si,null,OID(i)); });   // folded punctuation (and item 6's correct form) beside the word
    if(deprelsAbove) r.idx.forEach(i=>{ const dep=t[i].deprel||(parseInt(t[i].head,10)===0?"root":""); if(!dep)return;   // deprels that couldn't fit in the tree, shown above their token
      const lg=E("g",{class:"edge-g","data-s":si,"data-dep":OID(i)}); drawLabel(lg,r.LX(i),yDep,dep,relColor(dep));
      lg.style.cursor="pointer"; lg.addEventListener("click",()=>pick(si,OID(i))); rsvg.appendChild(lg); });
    mwtTie(rsvg, r.c.map(x=>x+r.offX), r.wform, rowTies(D,r.s,r.e), stackBot+5, null, si);
    const rd=document.createElement("div"); rd.className="wp-row"; rd.style.height=oneRowH+"px"; rd.appendChild(rsvg); toks.appendChild(rd); });
  // — assemble: the tree (drawn to fill its box at layout time) pinned over the one-line scrollable token box —
  const box=document.createElement("div"); box.className="diagram wrapproj"; box.dir=RTL?"rtl":"ltr";
  box.dataset.diaNat=Math.ceil(G.natH+oneRowH+28);   // wanted height = tree at its natural vertical size + one token row (+ block padding)
  const stem=document.createElement("div"); stem.className="wp-stem"; stem.style.width=svgW+"px";
  stem.appendChild(E("svg",{class:"tree wp-tree"}));   // filled by wpDraw() once the box has its final size
  box.appendChild(stem); box.appendChild(toks);
  box._wp={ proj, si, oid:t.map((_,i)=>OID(i)), showLbl:labelsInTree, natW:G.natW, natH:G.natH,
            nodes:G.pos.map(p=>({x:p.x,y:p.y})), edges:G.edges, ghostEdges, oneRowH,
            rows:rows.map(r=>{ const a=[]; for(let i=r.s;i<=r.e;i++) a.push({i,x:r.LX(i)}); return a; }) };
  if(proj){ let pend=false; toks.addEventListener("scroll",()=>{ if(pend)return; pend=true; requestAnimationFrame(()=>{pend=false; wpDrawProj(box);}); }); }
  return box;
}
// Draw the wrapped tree once its box has its final size. Scale is NON-UNIFORM — sx fits the token width, sy fills
// the box height — but edge labels keep a constant size. Rebuilt on (re)layout; only the projection group is
// touched on token scroll. Nodes carry no marker: edges meet directly at the point, which is also the hit target.
function wpDraw(box){ const wp=box._wp; if(!wp) return;
  const stem=box.querySelector(".wp-stem"), svg=box.querySelector(".wp-tree");
  if(!stem||!svg) return; const bw=stem.clientWidth, bh=stem.clientHeight; if(!bw||!bh) return;
  const sx=bw/wp.natW, sy=bh/wp.natH, NX=i=>wp.nodes[i].x*sx, NY=i=>wp.nodes[i].y*sy;
  box._px={sx,sy,bh};
  svg.setAttribute("viewBox",`0 0 ${bw} ${bh}`); svg.textContent="";
  svg.appendChild(E("g",{class:"wp-proj"}));   // projection lines go behind the tree; filled by wpDrawProj
  // edges run node-centre → node-centre, so an incoming and an outgoing edge meet directly at the node (no gap, no dot)
  wp.edges.forEach(e=>{ e._ink=arcInk(relColor(e.rel)); let a1=[NX(e.d),NY(e.d)], a2=[NX(e.h),NY(e.h)];
    if(show.arrows){const dir=arrowDir(e.rel); if(dir){const tip=dir==="dep"?a1:a2,frm=dir==="dep"?a2:a1;
      e._ah=arrowPath(frm,tip,5.25); e._ahc=arrowPath(frm,tip,5.25,AH_OUTSET); if(dir==="dep")a1=backoff(tip,frm,5.25); else a2=backoff(tip,frm,5.25);} else {e._ah=null;e._ahc=null;}} else {e._ah=null;e._ahc=null;}
    e._d=`M ${a1[0]} ${a1[1]} L ${a2[0]} ${a2[1]}`; });
  { const cg=E("g",{class:"edge-cases"}); cg.setAttribute("aria-hidden","true");   // Item 21: edges + arrowheads cased as ONE unit behind the strokes (occludes proj-lines/tokens behind, edges don't case against each other)
    wp.edges.forEach(e=>{ cg.appendChild(E("path",{class:"arc-casing",d:e._d})); if(e._ahc) cg.appendChild(E("path",{class:"ah-casing",d:e._ahc})); }); svg.appendChild(cg); }
  wp.edges.forEach(e=>{ const g=E("g",{class:"edge-g"+(sel.s===wp.si&&sel.t===wp.oid[e.d]?" sel":""),"data-s":wp.si,"data-dep":wp.oid[e.d],"data-head":wp.oid[e.h]});
    if(e._ah) g.appendChild(E("path",{class:"ah",d:e._ah,fill:e._ink}));
    g.appendChild(E("path",{class:"edge"+(isMorphRel(e.rel)?" morph-edge":""),d:e._d,stroke:e._ink}));
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(wp.si,wp.oid[e.d])); svg.appendChild(g); });
  // node hit targets — no visible marker; edges already meet at the point, and selecting highlights the incoming edge.
  // sx=bw/wp.natW squeezes the WHOLE sentence's natural tree width into one row's width, so for anything past a
  // handful of tokens sx<<1 and neighbouring nodes can land closer together than the flat r:10 below reaches —
  // their circles then overlap, and since SVG hit-testing gives the point to whichever shape is PAINTED LAST (this
  // loop, in token order), a click/drag aimed dead-centre at token i instead grabs token i+1 the moment their
  // circles cross. That silently misdirects a Subject-raising or Shared-conjunct drag onto the wrong node — the exact
  // "nothing happens" a user sees, since the SOURCE token is wrong from the first pointerdown, not the drop —
  // confirmed by a synthetic CDP drag landing on tok 18 ("really") when aimed at tok 17's own measured centre
  // ("he") in a 26-token sentence. Clamp each node's own radius to at most half its distance to the NEAREST other
  // node (Euclidean — depth is compressed by sy too, so a diagonal neighbour can be the closest one) rather than
  // dropping the flat 10: the wash shrinks gracefully as the overview densifies instead of ever reaching into a
  // neighbour's own centre.
  const hitR=wp.nodes.map((_,i)=>{ let minD=Infinity;
    for(let j=0;j<wp.nodes.length;j++){ if(j===i)continue; const d=Math.hypot(NX(i)-NX(j),NY(i)-NY(j)); if(d<minD)minD=d; }
    return Math.max(2,Math.min(10,minD/2)); });   // floored at 2px so a pathologically dense run (e.g. same-depth siblings stacked near-coincident) still leaves a real, if tiny, hit target rather than vanishing
  for(let i=0;i<wp.nodes.length;i++){ const g=E("g",{class:"node"+(sel.s===wp.si&&sel.t===wp.oid[i]?" sel":""),"data-s":wp.si,"data-tok":wp.oid[i]});
    g.appendChild(E("circle",{class:"tok-hit tok-wash",cx:NX(i),cy:NY(i),r:hitR[i]}));   // node point = its own wash region
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(wp.si,wp.oid[i])); svg.appendChild(g); }
  // edge labels: horizontal only, centred on each edge (the layout was already spread so they don't overlap)
  if(wp.showLbl) wp.edges.forEach(e=>{ const g=E("g",{class:"edge-g"+(sel.s===wp.si&&sel.t===wp.oid[e.d]?" sel":""),"data-s":wp.si,"data-dep":wp.oid[e.d],"data-head":wp.oid[e.h]});
    drawLabel(g,(NX(e.d)+NX(e.h))/2,(NY(e.d)+NY(e.h))/2,e.rel,relColor(e.rel));
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(wp.si,wp.oid[e.d])); svg.appendChild(g); });
  // Shared=Yes ghost edges: dashed, dimmed, decorative (see stemma()'s own comment) — no data-dep/data-s, no click handler
  (wp.ghostEdges||[]).forEach(e=>{ const ink=arcInk(relColor(e.rel)); let a1=[NX(e.d),NY(e.d)], a2=[NX(e.h),NY(e.h)], ah=null;
    if(show.arrows){ const dir=arrowDir(e.rel); if(dir){ const tip=dir==="dep"?a1:a2,frm=dir==="dep"?a2:a1;
      ah=arrowPath(frm,tip,5.25); if(dir==="dep")a1=backoff(tip,frm,5.25); else a2=backoff(tip,frm,5.25); } }
    const g=E("g",{class:"ghost-g"});
    if(ah) g.appendChild(E("path",{class:"ah ah-ghost",d:ah,fill:ink}));
    g.appendChild(E("path",{class:"edge edge-ghost",d:`M ${a1[0]} ${a1[1]} L ${a2[0]} ${a2[1]}`,stroke:ink}));
    if(wp.showLbl){ drawLabel(g,(NX(e.d)+NX(e.h))/2,(NY(e.d)+NY(e.h))/2,e.rel,relColor(e.rel)); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); }
    svg.appendChild(g); });
  ghostsBehind(svg);   // …and behind the real edges above, as everywhere else. Called HERE and not only from wrap(): this svg is (re)filled by wpDraw long after the box was wrapped — from the post-layout pass in js/core/document.js — so the one call in wrap() never sees these ghosts
  wpDrawProj(box);
}
// projection lines: node → its word, only for whichever row currently sits at the top of the scrolled token box
function wpDrawProj(box){ const wp=box._wp, px=box._px; if(!wp||!px) return;
  const svg=box.querySelector(".wp-tree"), toks=box.querySelector(".wp-toks"), pg=svg&&svg.querySelector(".wp-proj");
  if(!pg) return; pg.textContent=""; if(!wp.proj) return;
  const ri=Math.max(0,Math.min(wp.rows.length-1, Math.round((toks?toks.scrollTop:0)/wp.oneRowH)));
  // each projection is a cubic with VERTICAL endpoints (tangent straight up/down at both the node and the word). To
  // keep it from rising into the tree, cast an imaginary vertical ray up from the word to where it FIRST meets the
  // tree, and cap both handle lengths at half that distance (so the curve stays below the tree). If the ray misses
  // the tree at the word's column, it's nudged sideways to the nearest column that hits.
  const NXp=wp.nodes.map(nd=>nd.x*px.sx), NYp=wp.nodes.map(nd=>nd.y*px.sy),
        segs=wp.edges.map(e=>({xa:NXp[e.d],ya:NYp[e.d],xb:NXp[e.h],yb:NYp[e.h]})),
        txMin=Math.min(...NXp), txMax=Math.max(...NXp);
  const hitY=x=>{ let best=-Infinity; for(const s of segs){ const lo=Math.min(s.xa,s.xb), hi=Math.max(s.xa,s.xb);
      if(x>=lo&&x<=hi){ const t=Math.abs(s.xb-s.xa)<1e-6?0:(x-s.xa)/(s.xb-s.xa); best=Math.max(best, s.ya+t*(s.yb-s.ya)); } } return best; };
  const treeY=x1=>{ const xc=Math.max(txMin,Math.min(txMax,x1)); let y=hitY(xc);   // nudge into the tree's x-range, then out to the nearest hitting column
    for(let d=4; y===-Infinity && d<=(txMax-txMin)+8; d+=4){ y=Math.max(hitY(xc-d),hitY(xc+d)); } return y; };
  // Reach each projection down to its token's TOPMOST drawn content — the deprel LABEL when it rides above the token,
  // else the form — ending the SAME 3px past the glyph top that a bare token gets, so a LABELLED target isn't left
  // with a gap the token-only case doesn't have. getBBox().y is in the visible row's SVG (viewBox = px, 1:1), whose
  // top sits at px.bh (the stem bottom), so a content top at row-y `by` is at stem-y px.bh+by. Falls back to the row
  // top (px.bh, the old endpoint) when unmeasurable; never rises ABOVE it.
  const rowDiv=box.querySelectorAll(".wp-row")[ri], rowSvg=rowDiv?rowDiv.querySelector("svg"):null;
  const capOf=oid=>{ if(!rowSvg) return px.bh;
    const el=rowSvg.querySelector(`.edge-g[data-dep="${oid}"] text.lbl`)||rowSvg.querySelector(`.tok-group[data-tok="${oid}"] .tok-word`);
    if(!el) return px.bh; let by; try{ by=el.getBBox().y; }catch(e){ return px.bh; }
    return Math.max(px.bh, px.bh+by+3); };   // 3px past the glyph top = the same small overlap y1=px.bh gives a bare token
  /* ⚠ EVERY MEASUREMENT FIRST, THEN EVERY APPEND — never interleaved. capOf() calls getBBox(), which forces a
     synchronous layout of everything invalidated since the last one; appending a path invalidates. Done in one
     loop that did both, each token's getBBox re-laid-out the WHOLE document, so the cost was one full layout PER
     TOKEN of the visible row rather than one for the row. MEASURED on a 40-sentence Chinese file (long sentences,
     so every stemma wraps and this path runs for all 16 windowed blocks): getBBox alone was 9.6 s of an 18.9 s
     profile — 51 % of a renderDoc that took 7–9 SECONDS — and every one of those calls came from here. Splitting
     the loop is the whole fix; the arithmetic below is unchanged. */
  const caps=wp.rows[ri].map(({i})=>capOf(wp.oid[i]));
  wp.rows[ri].forEach(({i,x},ci)=>{ const x0=NXp[i], y0=NYp[i], y1=caps[ci], yhit=treeY(x), D=Math.max(2, y1-(yhit>-Infinity?yhit:y0)),
      k=Math.min((y1-y0)/2, D/2);
    pg.appendChild(E("path",{class:"proj",d:`M ${x} ${y1} C ${x} ${y1-k}, ${x0} ${y0+k}, ${x0} ${y0}`})); }); }   // drawn word→node (bottom to top): identical curve, but the dash pattern now anchors at the baseline word so a dot sits cleanly on it (partial dash lands at the node), matching the icon and the unwrapped stemma
// selecting a token in a wrapped stemma/hierarchy scrolls its (possibly off-screen) token row into view
function wpRevealSel(){ if(sel.s<0||sel.t<=0) return;
  const box=document.querySelector(`#doc .sblock[data-i="${sel.s}"] .diagram.wrapproj`); if(!box) return;
  const wp=box._wp, toks=box.querySelector(".wp-toks"); if(!wp||!toks) return;
  let ri=-1; for(let r=0;r<wp.rows.length;r++){ if(wp.rows[r].some(o=>wp.oid[o.i]===sel.t)){ ri=r; break; } }
  if(ri<0) return; const target=ri*wp.oneRowH;
  if(Math.abs(toks.scrollTop-target)>1) toks.scrollTop=target;   // scroll listener redraws the projections for the new row
  else wpDrawProj(box); }

function tree(si){
  const D=displaySent(DOC[si]), t=D.tokens, n=t.length, OID=k=>D.map[k]+1, sent={tokens:t}; RTL=D.rtl;
  /* ⚠ THE RESERVE BELOW THE STACK IS TR_TIGHTEN SHORTER ("the gap below a transliteration should be
     reduced by the length of the descender (0.5em - 0.5ex)") — the same number the previous round took
     off the gap ABOVE that row, now taken off the one below it, which is why it reuses TR_TIGHTEN rather
     than deriving the formula twice. `belowReserve` is what stands between the last DRAWN row and the
     next level, so shortening it is exactly that gap: the rows themselves are seated off dropYD and do
     not move, and because LV and parentEndY are BOTH built from belowReserve, every edge stays its usual
     LV−belowReserve−A−B = 25px (the invariant the comment below records) while the levels close up by
     TR_TIGHTEN each. Gated on there BEING a transliteration row — with the row off there is no gap below
     it to reduce — and 0 outside lzh, TR_TIGHTEN being LZH_MAG-gated at source.
     ⚠️ With gloss tiers shown the last drawn row is a TIER, not the transliteration, so the reserve this
     shortens then sits below the tier; the request was made against the lzh sample, which shows the
     transliteration alone.
     ⚠ AND THEN BOTH OF THIS LEVEL'S OWN PADDINGS GREW BY THE TRANSLITERATION'S DESCENT ("actually, in
     hierarchies (for lzh), both the space above a token and the space below a transliteration need to be
     increased by transliteration descender length" — TR_ROW_DESC, js/diagram/diagram-core.js). Two changes
     that have to be made as ONE, because the token's below-stack rides with its glyph (dropYD is built from
     nyD):
      · `trDrop` is added to nyD below, which is the space ABOVE the token — the incoming edge ends at
        ny(depth)−A whatever the glyph does, so dropping the glyph is what opens that gap, exactly as
        TOK_Y_LOWER and NODE_Y_EXTRA already do;
      · and it is added to `belowReserve` TWICE: once to carry that drop (the whole drawn stack is now
        trDrop lower, so without it the outgoing edge would start ABOVE the transliteration's descenders
        rather than below them), and once more for the requested widening. Measured, lzh: the
        transliteration's ink bottom to the outgoing edge's tip goes −0.60px → +3.00px, i.e. the descender
        stopped crossing the edge, and the glyph's ink top to the incoming edge's tip 2.78 → 6.38 — both
        exactly +3.60 = TR_ROW_DESC, which is what the sentence asks for each of them.
     ⚠️ THE ROUND-6 `belowTighten` REDUCTION STAYS, i.e. this is read as "increase it by the descent from
     where it is now", not as a full reversal of that round. The sentence names ONE quantity for BOTH
     increases; reverting TR_TIGHTEN as well would make the below-increase 3.60+5.23 while the above-increase
     stayed 3.60, which the sentence does not say. It also lands the geometry where the complaint points: the
     gap it is measured from was −0.60px of OVERLAP, and the descender's own length is exactly what is
     missing. (To read it as a reversal instead, drop `-belowTighten` here — one term, and the two
     applications of trDrop are unaffected either way.)
     ⚠️ GATED ON trLayer(), BOTH HALVES TOGETHER — they must never diverge, or the drawn stack hangs outside
     its own reserve. With the transliteration row off there is no such row to measure a descent from OR to
     open a gap below, and keeping the pair at 0 there also leaves `belowReserve` at exactly 0 for a
     hierarchy with no annotation rows at all, which is the condition NODE_DESC_EXTRA below tests.
     ⚠️ AND belowExtra IS A FURTHER, FLAT 4px ON THE "BELOW" SIDE ALONE ("the transliteration needs another
     4px of space below") — one round after the above. Added only to belowReserve, never to nyD/trDrop: this
     request names "space below" only, and folding it into the term that also drives the glyph's own draw
     position (nyD, below) would move the token again, which nothing here asks for. Same trLayer() gate as
     its neighbours, for the identical reason. */
  const {children,root,head}=structure(sent),belowTighten=trLayer()?TR_TIGHTEN:0,trDrop=trLayer()?TR_ROW_DESC:0,belowExtra=trLayer()?TR_ROW_EXTRA:0,belowReserve=belowReserveH(trLayer(),belowTierN(),false)-belowTighten+2*trDrop+belowExtra,LV=48+belowReserve,TOP=18,A=16,B=7;       // item 2: the level height = a CONSTANT 48 (the stemma's LV) + the below-stack reserve, and the outgoing edge attaches just below that reserve (parentEndY) — so an edge is always LV−belowReserve−A−B = 48−16−7 = 25 tall, EXACTLY the stemma's, no matter how many annotation tiers are shown. belowReserve uses the SAME belowGap() per-row step the tiers are drawn at, so it cancels cleanly (Item 8: each tier row folds in descent(POS_F)). TOP matches stemma()'s own (diagram-render.js) — raising it to "lower the tokens" was tried and reverted there, see its note; TOK_Y_LOWER (applied per token, at the draw site, never to this level math) is the fix that actually works
  // THE ROOT's OWN CROP RESERVE, matching stemma()'s identical fix (diagram-render.js) for the identical reason:
  // the root sits at depth 0 — literally the topmost thing this notation draws — and fitTight(svg,boxes) crops
  // to the union of `boxes`, whose node box below reserved a flat 9px tuned for NODE_F at TOK_MAG 1. A magnified
  // node (any INDIC_SCRIPTS/ORNAMENTAL_SCRIPTS script, or lzh — scriptMag(), js/lang/translit.js) needs the same
  // "how much MORE ascent a magnified face reaches than an unmagnified one would" term WORD_OFF/belowGap() already
  // use elsewhere: ascent(NODE_F) is already the MAGNIFIED font's own ascent, so subtracting the unmagnified
  // ascent it implies (÷TOK_MAG) isolates just the extra. Exactly 0 at TOK_MAG 1 — byte-identical crop then.
  const NODE_ASC_EXTRA=TOK_MAG>1?ascent(NODE_F)*(1-1/TOK_MAG):0;
  const SPW=meas(" ",WORD_F), NGAP=SPW+4;                              // node gap matches the stemma column gap
  // tidy layout: leaves packed with the stemma's node gap; a parent is centred over its children. Adjacent
  // siblings are then pushed apart (whole subtree shifted) only as far as their nodes AND their incoming
  // edge labels require — same word-space collision rule as the stemma, without padding every node.
  const lw=i=>Math.max(fmeas(t[i],NODE_F), trLayer()?meas(trTxt(t[i]),trFont(t[i])):0, glossSlotW(t[i]));    // node slot = its widest row: host form, the transliteration/original row, OR the gloss tiers. Folding the transliteration in (the stemma/arc/bracket layouts already do) is what DE-COLLIDES adjacent transliterations in the hierarchy — sibling separation reserves the full annotation width, and since the gap is driven per-node it spaces each level independently while a sole child stays centred (vertical) under its parent (item 13)
  const hgw=i=>tailW(t[i],NODE_F);                                    // real-width room for the node's folded-punctuation satellites (to its inline-end)
  const ldw=i=>leadW(t[i],NODE_F);                                    // item 2: room for right-merging leads (inline-start)
  const elw=i=>(show.labels&&i!==root)?meas(t[i].deprel,POS_F):0;      // incoming edge-label width
  // Subject=Generic: give each predicate a VIRTUAL LEAF CHILD (index n, n+1, … one per generic-subj token) in a
  // SEPARATE copy of the tree used ONLY for layout (place()/depth) — so it's positioned by the SAME recursive
  // subtree-packing every other dependent uses, exactly like any other token, rather than squeezed into a linear
  // reading-order gap (which "contorted" it relative to its real siblings). Real edges/ghosts/node-drawing stay
  // scoped to 0..n-1 exactly as before; the ∅ is drawn separately afterward, using its own x[]/depth[] entries.
  const genericToks=[]; for(let i=0;i<n;i++) if(hasGenericSubj(t,i)) genericToks.push(i);
  const N=n+genericToks.length;
  const vOf={}; genericToks.forEach((predIdx,k)=>{ vOf[predIdx]=n+k; });
  const children2=Array.from({length:N},(_,i)=>i<n?children[i].slice():[]);
  genericToks.forEach(predIdx=>children2[predIdx].push(vOf[predIdx]));
  const lw2=i=>i<n?lw(i):meas("∅",NODE_F), hgw2=i=>i<n?hgw(i):0, ldw2=i=>i<n?ldw(i):0, elw2=i=>i<n?elw(i):(show.labels?meas("subj",POS_F):0);
  const x=tidyLayout(N,root,i=>children2[i],{lw:lw2,hgw:hgw2,ldw:ldw2,elw:elw2,SPW,NGAP});   // #5: shared with the wrapped-hierarchy treeGeomW() → one source of truth (the ∅ virtual leaves ride the SAME packing as any real child, via children2/lw2/…)
  const nw=i=>lw(i);   // for canvas width below (real nodes only — see the separate lw2 total below)
  const depth=new Array(N).fill(0); (function d(i,dd){depth[i]=dd; children2[i].forEach(c=>d(c,dd+1));})(root,0);
  const ghostPairs=ghostPairsFor(t);   // [originIdx,targetIdx,rel], 0-based — computed once, before any Y-position is derived from depth
  applyGhostDepth(depth,head,ghostPairs,n);   // a ghost's TARGET is pulled above its shallowest ghost dependent, cascading to its own real subtree (see stemma()'s own comment)
  const ny=d=>TOP+d*LV;
  /* ⚠ …plus, where the GLYPH ITSELF is what sits directly above that endpoint, the magnification's own extra
     descent — the exact mirror of NODE_ASC_EXTRA above and of stemma()'s BB (js/diagram/diagram-render.js,
     where the full measurement lives): a magnified node descends past the flat 7px B, and TOK_Y_LOWER spends
     2.5 more of it, which measured as a real overlap at TOK_MAG 1.5 and 2. Gated on `belowReserve` being 0,
     because with any annotation tier shown the thing above the endpoint is that TIER's row — drawn in an
     UNMAGNIFIED face, and already cleared by belowReserveH's own STACKED_GAP/belowGap() terms — so reserving
     the glyph's magnified descent there would lengthen an edge that needs nothing. 0 at TOK_MAG 1 either way,
     so no unmagnified document has an edge endpoint anywhere but where it has always been. */
  const NODE_DESC_EXTRA=(TOK_MAG>1&&!belowReserve)?descent(NODE_F)*(1-1/TOK_MAG):0;
  const parentEndY=i=> ny(depth[i]) + belowReserve + B + NODE_DESC_EXTRA;   // item 7/2: the OUTGOING (parent) edge attaches just below the UNIFORMLY-reserved below-stack (the node's lowest annotation tier — a glossing tier, the transliteration, or, with neither, the form) — so an edge never crosses the annotations AND every edge is the same 25px tall as the stemma (belowReserve is the same for all nodes, so the edge height is tier-count-independent)
  const edges=[]; for(let i=0;i<n;i++) children[i].forEach(ci=>{ const y1=ny(depth[ci])-A, y2=parentEndY(i), midY=(y1+y2)/2;
    edges.push({d:ci,h:i,rel:t[ci].deprel,y1,y2,midY,band:Math.round(midY/12),w:show.labels?meas(t[ci].deprel,POS_F)+SPW:0}); });
  edges.sort((p,q)=>catRank(p.rel)-catRank(q.rel));   // subj in front; no global spread (it would de-centre parents)
  // Shared=Yes / Subj: the real edge draws normally (to whichever conjunct/raising target the token is actually
  // attached to); a dashed "ghost" edge is added to every OTHER conjunct (or the derived raising target) — see
  // stemma()'s own comment. depth[] (adjusted above) already keeps every ghost target above its dependents, so the
  // dependent (origin) always draws at the "d" role and the target at "h" — orientGhost is a defensive fallback only.
  const orientGhost=(origin,target)=>depth[origin]<depth[target]?{d:target,h:origin}:{d:origin,h:target};
  const ghostEdges=ghostPairs.map(([o,tg,rel])=>{ const {d,h}=orientGhost(o,tg);
    return {d,h,rel,origin:o,y1:ny(depth[d])-A,y2:parentEndY(h)}; });
  const maxD=Math.max(0,...depth),total=Math.max(2,...x.map((xx,i)=>xx+lw2(i)/2+hgw2(i)))+6,H=TOP+maxD*LV+16+belowReserveH(trLayer(),belowTierN(),false);   // Item 8: the bottom tier tail folds in descent(POS_F) per row, matching belowStack. lw2/hgw2 (not nw/hgw) so a ∅ pushed to the canvas edge still gets cropped in
  if(RTL) for(let i=0;i<N;i++) x[i]=total-x[i];   // mirror the tidy tree for right-to-left (N, not n — the ∅ mirrors too)
  const svg=E("svg",{class:"tree",width:total,height:H,viewBox:`0 0 ${total} ${H}`}); const boxes=[];
  // edges as ONE cased unit (Item 21): pre-compute stroke path + arrowhead, draw all casings behind, then strokes on top
  edges.forEach(e=>{ e._ink=arcInk(relColor(e.rel)); let dEnd=[x[e.d],e.y1], hEnd=[x[e.h],e.y2];
    if(show.arrows){const dir=arrowDir(e.rel); if(dir){const tip=dir==="dep"?dEnd:hEnd,frm=dir==="dep"?hEnd:dEnd;
      e._ah=arrowPath(frm,tip,5.25); e._ahc=arrowPath(frm,tip,5.25,AH_OUTSET); if(dir==="dep") dEnd=backoff(tip,frm,5.25); else hEnd=backoff(tip,frm,5.25);} else {e._ah=null;e._ahc=null;}} else {e._ah=null;e._ahc=null;}
    e._d=`M ${hEnd[0]} ${hEnd[1]} L ${dEnd[0]} ${dEnd[1]}`; });
  { const cg=E("g",{class:"edge-cases"}); cg.setAttribute("aria-hidden","true");
    edges.forEach(e=>{ cg.appendChild(E("path",{class:"arc-casing",d:e._d})); if(e._ahc) cg.appendChild(E("path",{class:"ah-casing",d:e._ahc})); }); svg.appendChild(cg); }
  edges.forEach(e=>{ const g=E("g",{class:"edge-g","data-s":si,"data-dep":OID(e.d),"data-head":OID(e.h)});
    if(e._ah) g.appendChild(E("path",{class:"ah",d:e._ah,fill:e._ink}));
    g.appendChild(E("path",{class:"edge"+(isMorphRel(e.rel)?" morph-edge":""),d:e._d,stroke:e._ink}));   // an mSUD "/m" edge dashes here exactly as it does in the stemma and the wrapped hierarchy
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(e.d))); svg.appendChild(g);});
  if(show.labels) edges.forEach(e=>{ const mx=(x[e.d]+x[e.h])/2, my=e.midY;   // pass 2: all labels in front of all edges
    const lg=E("g",{class:"edge-g","data-s":si,"data-dep":OID(e.d),"data-head":OID(e.h)}); drawLabel(lg,mx,my,e.rel,relColor(e.rel));
    lg.style.cursor="pointer"; lg.addEventListener("click",()=>pick(si,OID(e.d))); svg.appendChild(lg); boxes.push({x:mx,y:my,hx:meas(e.rel,POS_F)/2+2,hy:7}); });
  // Subject=Generic: computed here (positions only) so it can fold into the SAME horizontal label-decollision pass
  // as the real ghost edges below — a disconnected decollision pass is what let its label collide with a real one.
  const genericEntries=genericToks.map(i=>{ const vi=vOf[i], gx=x[vi], gy=ny(depth[vi]);
    return {i,gx,gy,y1:gy-A,y2:parentEndY(i)}; });
  const ghostLabs=show.labels?[...ghostEdges.map(e=>({mx:(x[e.d]+x[e.h])/2,my:(e.y1+e.y2)/2,text:e.rel,e})),
    ...genericEntries.map(ge=>({mx:(ge.gx+x[ge.i])/2,my:(ge.y1+ge.y2)/2,text:"subj",e:ge}))]:[];   // item 6: HORIZONTAL-only decollision, only ghost labels move (see stemma()'s own comment)
  if(show.labels) decollideGhostsH(ghostLabs,boxes);
  const ghostLabAt=new Map(ghostLabs.map(L=>[L.e,L]));
  ghostEdges.forEach(e=>{ const ink=arcInk(relColor(e.rel)); let dEnd=[x[e.d],e.y1], hEnd=[x[e.h],e.y2], ah=null;
    if(show.arrows){ const dir=arrowDir(e.rel); if(dir){ const tip=dir==="dep"?dEnd:hEnd,frm=dir==="dep"?hEnd:dEnd;
      ah=arrowPath(frm,tip,5.25); if(dir==="dep") dEnd=backoff(tip,frm,5.25); else hEnd=backoff(tip,frm,5.25); } }
    const g=E("g",{class:"ghost-g"+(sel.s===si&&sel.t===OID(e.origin)?" sel":""),"data-s":si,"data-dep":OID(e.origin)});   // item 3
    if(ah) g.appendChild(E("path",{class:"ah ah-ghost",d:ah,fill:ink}));
    g.appendChild(E("path",{class:"edge edge-ghost",d:`M ${hEnd[0]} ${hEnd[1]} L ${dEnd[0]} ${dEnd[1]}`,stroke:ink}));
    boxes.push({x:(dEnd[0]+hEnd[0])/2,y:(dEnd[1]+hEnd[1])/2,hx:Math.abs(hEnd[0]-dEnd[0])/2,hy:Math.abs(hEnd[1]-dEnd[1])/2+2});   // item 2
    if(show.labels){ const L=ghostLabAt.get(e); drawLabel(g,L.mx,L.my,e.rel,relColor(e.rel)); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:L.mx,y:L.my,hx:meas(e.rel,POS_F)/2+2,hy:7}); }
    svg.appendChild(g); });
  // item 2 (redesign): Subject=Generic — the ∅ is a virtual TOKEN, positioned by the SAME recursive subtree-packing
  // as any other dependent (x[vOf[i]]/depth[vOf[i]], computed above via children2) — not editable/interactable/
  // grid-visible, but arranged exactly like a real dependent of its head, never contorted to a linear position.
  genericEntries.forEach(ge=>{ const i=ge.i, col=relColor("subj"), ink=arcInk(col);
    const g=E("g",{class:"ghost-g","data-s":si});   // NEVER highlighted via the predicate's own selection — see stemma()'s identical comment: the predicate is this relation's HEAD, not its dependent
    g.appendChild(E("path",{class:"edge edge-ghost",d:`M ${ge.gx} ${ge.y1} L ${x[i]} ${ge.y2}`,stroke:ink}));
    const glbl=E("text",{class:"node-lbl",x:ge.gx,y:ge.gy+TOK_Y_LOWER+NODE_Y_EXTRA+trDrop}); glbl.textContent="∅"; g.appendChild(glbl);   // a virtual NODE, so it lowers with every real one — trDrop included (see belowReserve's own note above); its edge above and its box below both stay on the layout level
    if(show.labels){ const L=ghostLabAt.get(ge); drawLabel(g,L.mx,L.my,"subj",col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:L.mx,y:L.my,hx:meas("subj",POS_F)/2+2,hy:7}); }
    boxes.push({x:ge.gx,y:ge.gy,hx:8,hy:9+NODE_ASC_EXTRA});   // "∅" is drawn .node-lbl too, so it magnifies with every other node glyph — see NODE_ASC_EXTRA's own note
    svg.appendChild(g); });
  for(let i=0;i<n;i++){const g=E("g",{class:"node"+(sel.s===si&&sel.t===OID(i)?" sel":""),"data-s":si,"data-tok":OID(i)});
    const nyL=ny(depth[i]), nyD=nyL+TOK_Y_LOWER+NODE_Y_EXTRA+trDrop, loB=loBoxes(boxes);   // …+trDrop, THIS round's "the space above a token needs to be increased by transliteration descender length" — a further drop of the glyph, the space above it being what the incoming edge (laid out from nyL, untouched) no longer fills. belowReserve above carries it back so the stack below does not overrun its own reserve; see its note   // …+NODE_Y_EXTRA: "in hierarchies, we need the same extra 1.5px drop". dropYD below is built from nyD, so the whole stack rides with the glyph and the token→transliteration gap is unchanged, exactly as the stemma's own caveat asks   // nyL = the LAYOUT level (every edge endpoint and every box in this block); nyD = where this node's glyph and its whole stack DRAW — see TOK_Y_LOWER (js/diagram/diagram-core.js). The edges above were laid out from nyL and are untouched
    const lbl=E("text",{class:"node-lbl"+italDeco(t[i]),x:x[i],y:nyD}); lbl.textContent=bform(t[i]); const tw=fmeas(t[i],NODE_F);   // host form only
    const hit=E("rect",{class:"tok-hit tok-wash",x:x[i]-Math.max(26,tw/2+4),y:nyD-A,width:Math.max(52,tw+8),height:A+B});   // node box = its own wash region   // on the DRAW level, so the wash stays centred on the glyph it backlights
    g.appendChild(hit);
    const dropY=nyL+STACKED_GAP-TR_TIGHTEN, dropYD=nyD+STACKED_GAP-TR_TIGHTEN;   // seeds the ONE gap from the glyph (node-lbl) row down to whichever row is drawn first below it — STACKED_GAP (diagram-core.js), the flat replacement for the removed STACK_DROP   // dropY stays the LAYOUT seed (the boxes below are stated in it); dropYD is the drawn one, and the two differ by exactly TOK_Y_LOWER so every row keeps its spacing
    /* ⚠ …LESS TR_TIGHTEN (js/diagram/diagram-core.js), the hierarchy's own `0.5em − 0.5ex` reduction of the
       token→transliteration step, on request. Applied to the SEED and not inside belowGap(): that function
       is shared with arcs, stemma and brackets, and arcs wants this gap moved the OTHER way (TOK_TR_GAP),
       so the two adjustments have to be independently addressable. Applied to BOTH baselines, so the crop
       follows rows that genuinely moved — unlike TOK_Y_LOWER, this is not a draw-vs-layout asymmetry but a
       real change of position, and holding the boxes back would over-reserve the space just recovered.
       Every row below inherits the shift, keeping their spacing to each other untouched, and the seed is
       exactly where the comment above says the ONE glyph-to-first-row gap is expressed. `belowReserve` —
       and so LV, and so parentEndY, and so every edge in this figure — is deliberately NOT reduced: the
       recovered space simply becomes slack above the next level, and no edge moves. 0 outside lzh. */
    { const rt=trTxt(t[i]); if(rt){ const ty=dropYD+belowGap(); const e=E("text",{class:"translit"+frnUp(t[i]),x:x[i],y:ty,"text-anchor":"middle"}); e.textContent=rt; if(trRowEdit())e.classList.add("tr-edit"); g.appendChild(e); boxes.push({x:x[i],y:nyL+14,hx:meas(rt,trFont(t[i]))/2,hy:7}); svgSeamMark(g,t[i],x[i],ty,meas(rt,trFont(t[i]))/2,trFont(t[i]),loB,null,"translit"); } }   // Item 8: same descender-matched top gap (belowGap()) the other renderers give the translit row
    belowTiers().forEach((tier,ti)=>{ const step=(trTxt(t[i])?belowGap():0)+(ti+1)*(belowGap()), gy=dropY+step, gyD=dropYD+step, txt=tierText(t[i],tier), dtxt=txt||"…"; const e=E("text",{class:"gloss gl-edit"+(txt?"":" gl-empty")+frnUp(t[i]),x:x[i],y:gyD,"text-anchor":"middle","data-tier":tier,tabindex:"0"}); setGlossText(e,tier,dtxt); g.appendChild(e); boxes.push({x:x[i],y:gy-4,hx:meas(dtxt,trFont(t[i]))/2,hy:7});
      if(tier==="mseg"||tier==="mgloss") svgSeamMark(g,t[i],x[i],gyD,(tier==="mgloss"?measGloss(dtxt,tierFont(tier,t[i])):meas(dtxt,tierFont(tier,t[i])))/2,tierFont(tier,t[i]),loB,null,tier); });   // gloss / morphemic tiers under the node (hierarchy has no per-node POS row) — the segmentation AND morphemic-gloss rows carry the seam mark (both per-morpheme, drawn off the "…" placeholder's own width where this tier isn't annotated for this token — see the note beside diagram-core.js's belowStack); the lexical gloss row doesn't
    g.appendChild(lbl); gwFormSVG(g,lbl,t[i],x[i],nyD,NODE_F,"node-lbl",si,loB);   // goeswith: the continuation parts join the head on the node row, so the ONE translit/gloss stack drawn above spans the whole word
    if(gwOf(t[i]).length){ const ids=[OID(i)].concat(gwOf(t[i]).map(p=>p.oid));
      g.setAttribute("data-gw",ids.join(" "));
      const STEP=belowGap(), nodeBot=dropYD+(trTxt(t[i])?STEP:0)+belowTierN()*STEP;   // this node's OWN below-stack bottom — the hierarchy has no shared word row, so each node stacks its rows itself   // measured off the DRAWN stack, so the slur hangs the same distance under the (lowered) rows
      gwSlurSVG(svg,x[i]-tw/2,x[i]+tw/2,nodeBot+5+tieLead(),si,ids,loB); }   // the hierarchy draws no ties at all (an MWT has no place in a dependency tree), so the slur is seated here directly — by the SAME "+5, then tieLead()" rule mwtTie is handed in every other notation, just measured from this node's own stack bottom
    svgMarks(g,x[i],nyD,t[i],NODE_F); svgFormSeamMark(g,t[i],x[i],nyD,NODE_F,loB);   // Item 11: node form appended LAST → paints on TOP of the translit/gloss stack; item 4: marks in front of it, then the seam mark off its inline end
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(i))); svg.appendChild(g);
    drawHangsSVG(svg,t[i],x[i],nyD,NODE_F,"node-lbl",si,loB,OID(i)); drawLeadsSVG(svg,t[i],x[i],nyD,NODE_F,"node-lbl",si,loB,OID(i));   // folded punctuation as separate selectable satellites beside the node
    boxes.push({x:x[i],y:nyL-5,hx:tw/2+2,hy:9+NODE_ASC_EXTRA});}   // …on the LAYOUT level: holding the root's crop here while its glyph draws lower is what opens the headroom above it   // tree() has no catNodes/POS-as-node mode — every node here is bform(), always at NODE_F — see NODE_ASC_EXTRA's own note
  fitTight(svg,boxes);   // crop tight top, matching the stemma
  return wrapDiagram(svg,si);
}
function brackets(si){
  const D=displaySent(DOC[si]), t=D.tokens, n=t.length, OID=k=>D.map[k]+1, sent={tokens:t}; RTL=D.rtl;
  const AH=parseFloat(css("--arrow"))||5.5;   // interrupter-arc arrowheads, same CSS var every other view's arrowheads track
  const rep=reportOffsets(D);   // item 6/11: reported-speech UPWARD step — the form, its deprel label above, its below-stack, its brackets AND its interrupter-arc endpoints all lift together, so the reported constituent floats off the line as one unit
  const {children,head,root}=structure(sent);
  const isAnc=(C,p)=>{ let x=p,g=0; while(x>=0&&g++<=n){ if(x===C)return true; const hp=head[x]-1; if(hp<0||hp===x)break; x=hp; } return false; };
  // UNCONDITIONAL full subtree spans (every real child folds in, regardless) — used ONLY to find, per constituent,
  // which OTHER tokens sit inside its numeric span. NOT the spans brackets are drawn from (see the corrected lo/hi
  // below): folding everything in unconditionally is exactly what let mūrtitve's span reach out to bhṛtaḥ in the
  // first place (see the interrupt-detection comment right below).
  const rlo=Array(n),rhi=Array(n),seen=Array(n).fill(false);
  (function rdfs(i){seen[i]=true; rlo[i]=i;rhi[i]=i;
    children[i].slice().sort((a,b)=>a-b).forEach(c=>{ if(seen[c])return; rdfs(c); rlo[i]=Math.min(rlo[i],rlo[c]); rhi[i]=Math.max(rhi[i],rhi[c]); });})(root);
  for(let i=0;i<n;i++) if(!seen[i]){rlo[i]=i;rhi[i]=i;}
  // INTERRUPTER, two complementary shapes — a token sitting inside a constituent it does not belong to interrupts
  // it: it stays in place, bracketed, and is tied to its real head by a cross arc instead of nesting normally.
  //  (b) THE ORDINARY CASE — an UNRELATED token p (no ancestor/descendant relation to C either way) sits inside
  //      constituent C's numeric span: flag p itself (e.g. "yesterday" parked inside "man"'s NP span in the
  //      fixture's "I saw a man yesterday who was tall" → arc yesterday→saw; see diagram-core.js's subtreeMembers
  //      for the same example cited as the canonical small-scale non-projective test, brihat_jataka s1 being the
  //      "widely non-projective" large one).
  //  (a) BRIHAT_JATAKA S1'S SHAPE — testing (b) alone against C=mūrtitve mis-fires: mūrtitve's REAL subtree
  //      {mūrtitve, bhṛtaḥ, śaśa} reaches PAST mūrtitve's own head parikalpitaḥ in surface order (mūrtitve 1st,
  //      parikalpitaḥ 2nd, śaśa/bhṛtaḥ 3rd/4th). parikalpitaḥ sits inside mūrtitve's span, but it's mūrtitve's own
  //      ANCESTOR — not "unrelated" — so (b)'s own `!isAnc(p,C)` guard correctly refuses to flag it (flagging an
  //      ancestor as if it needed a cross-arc BACK to its own head, e.g. parikalpitaḥ→vartmā, is nonsensical: it's
  //      an ordinary, correctly-nested token relative to ITS OWN parent). But nothing then looked the OTHER way to
  //      find the token that actually can't nest — bhṛtaḥ, whose own arc to mūrtitve is what's crossed by
  //      parikalpitaḥ sitting in between — so neither token was flagged, and mūrtitve's/parikalpitaḥ's brackets
  //      were left to literally cross (confirmed via a CDP dump of the rendered .brk/.arc elements from an earlier,
  //      (b)-only version of this fix: rendered order was open(mūrtitve) open(parikalpitaḥ) … close(mūrtitve)
  //      close(parikalpitaḥ) instead of one nesting inside the other, and the arc ran parikalpitaḥ→vartmā). (a)
  //      catches exactly this: for dependent d, if one of ITS HEAD'S OWN ANCESTORS sits between them in surface
  //      order, flag d (not the ancestor), tied to its real head — matching the two other instances of this exact
  //      shape elsewhere in the same sentence: ātmā/iti/vidām (vidām, not iti, gets the arc) and śrutau/yaḥ/anekadā
  //      (anekadā, not yaḥ) — while leaving (b)'s "yesterday" example alone: "was" (→man)'s own arc is ALSO
  //      crossed by an intervening token (yesterday), but yesterday is man's unrelated SIBLING, not man's ancestor,
  //      so (a)'s `isAnc(p,h)` test correctly declines to flag "was", leaving (b) to flag yesterday as it always did.
  const interrupt=new Set();
  for(let C=0;C<n;C++) for(let p=rlo[C]+1;p<rhi[C];p++)
    if(!isAnc(C,p)&&!isAnc(p,C)) interrupt.add(p);                          // (b) unrelated interloper
  for(let d=0;d<n;d++){ if(d===root)continue; const h=head[d]-1; if(h<0||h>=n||h===d)continue;
    const a=Math.min(h,d), b=Math.max(h,d);
    for(let p=a+1;p<b;p++) if(isAnc(p,h)){ interrupt.add(d); break; } }      // (a) an ancestor of h crosses d's own arc
  // CORRECTED subtree spans — what brackets are actually drawn from: fold a child's span into its parent's only
  // when that child is NOT an interrupter. An interrupter's own span is still computed (it gets its OWN bracket,
  // over whatever non-interrupting descendants it has) but does NOT fold into its real head's span — folding it in
  // unconditionally (see rlo/rhi above) is exactly what dragged mūrtitve's bracket rightward to swallow parikalpitaḥ.
  const lo=Array(n),hi=Array(n),size=Array(n); seen.fill(false);
  (function dfs(i){seen[i]=true; lo[i]=i;hi[i]=i;size[i]=1;
    children[i].slice().sort((a,b)=>a-b).forEach(c=>{ if(seen[c])return; dfs(c); if(interrupt.has(c))return;
      lo[i]=Math.min(lo[i],lo[c]); hi[i]=Math.max(hi[i],hi[c]); size[i]+=size[c]; });})(root);
  for(let i=0;i<n;i++) if(!seen[i]){lo[i]=i;hi[i]=i;size[i]=1;}
  const opens=Array.from({length:n},()=>[]), closes=Array.from({length:n},()=>[]);
  const addBr=(a,b,col,sz,owner)=>{opens[a].push({sz,col,owner}); closes[b].push({sz,col,owner});};
  for(let i=0;i<n;i++){ if(i===root)continue; addBr(lo[i],hi[i],relColor(t[i].deprel),hi[i]-lo[i],i); }   // every dependent subtree — interrupters bracketed too
  addBr(0,n-1,relColor("root"),n,root);                                                                    // + the whole sentence
  opens.forEach(a=>a.sort((p,q)=>q.sz-p.sz)); closes.forEach(a=>a.sort((p,q)=>p.sz-q.sz));
  // linear glyph sequence: brackets and words in reading order (words never reordered)
  const RF='600 15px '+LIVE_TOKEN_STACK, WBOLD='640 15px '+LIVE_TOKEN_STACK, gap=5, BRK_PAINT='600 16px '+LIVE_TOKEN_STACK;   // BRK_PAINT is .brk's PAINTED font (app.css), kept apart from RF (the 15px string this function measures bracket WIDTHS with, and which the layout below is calibrated against): only the vertical centring cares which of the two it is, and it cares by 0.4px
  const seq=[]; for(let p=0;p<n;p++){
    opens[p].forEach(o=>seq.push({t:"o",glyph:"[",col:o.col,owner:o.owner}));   // the predicate's OWN incoming brackets (from its real head) open first
    if(hasGenericSubj(t,p)){ const col=relColor("subj");   // Subject=Generic: its OWN small bracket pair, nested INSIDE the predicate's own brackets (opened after them, closed before its word) — a real seq entry (not an interrupter-style arc), so it gets uniform inter-item spacing on BOTH sides like any other bracketed unit
      seq.push({t:"o",glyph:"[",col,owner:null,ghost:true}); seq.push({t:"g",i:p}); seq.push({t:"c",glyph:"]",col,owner:null,ghost:true}); }
    seq.push({t:"w",i:p}); closes[p].forEach(o=>seq.push({t:"c",glyph:"]",col:o.col,owner:o.owner})); }
  const relOf=i=>(show.labels && !interrupt.has(i)) ? (i===root ? (t[i].deprel||"root") : t[i].deprel) : null;   // deprel shown above each non-displaced token — INCLUDING the root (shows "root", like wrapped brackets)
  const wx=Array(n),wlo=Array(n),whi=Array(n),wform=Array(n),genericX=Array(n).fill(null); let x=2; seq.forEach(it=>{ let ww, ld=0;
    if(it.t==="w"){   // always size the slot to the UNBOLD form → a selected word bolds in place (centred, symmetric), never reflowing its neighbours
      const fw=fmeas(t[it.i],WORD_F); wform[it.i]=fw;   // the word's own ink width, kept apart from the (possibly deprel-label-widened) slot below — an MWT tie must hug the FORM, not the slot
      ww=Math.max(fw, show.pos?meas(posDisp(t[it.i]),POS_F):0, trLayer()?meas(trTxt(t[it.i]),trFont(t[it.i])):0, glossSlotW(t[it.i])); const r=relOf(it.i); if(r) ww=Math.max(ww,meas(r,POS_F));   // item 3: fold in the gloss/MSeg/MGloss row width (glossSlotW → 0 when no gloss tier is shown) so a long gloss under a SHORT form — typically an MWT component (sat/ādi) with a long MSeg/MGloss — can't crowd its neighbour. The stemma/arc/wrapped-bracket layouts already reserve this; unwrapped brackets was the last one missing it.
      ld=leadW(t[it.i],WORD_F);   // item 2: right-merging leads sit before the word
      it.x=x+ld+ww/2; wx[it.i]=it.x; wlo[it.i]=it.x-ww/2; whi[it.i]=it.x+ww/2; }
    else if(it.t==="g"){ ww=Math.max(meas("∅",WORD_F), show.labels?meas("subj",POS_F):0); it.x=x+ww/2; genericX[it.i]=it.x; }   // Subject=Generic: a real seq slot of its own — same uniform `gap` on both sides any bracketed unit gets, reserved wide enough for its own "subj" label above it
    else { ww=meas("[",RF); it.x=x+ww/2; } it.w=ww; x+=ld+ww+(it.t==="w"?tailW(t[it.i],WORD_F):0)+gap; });   // reserve real-width room after a word for its folded-punctuation satellites (before the following close bracket)
  const total=x+2;
  if(RTL){ seq.forEach(it=>{ it.x=total-it.x; if(it.t==="o")it.t="c"; else if(it.t==="c")it.t="o"; });   // mirror the sequence; swap only the open/close ROLE (for span logic), keeping the original glyph
    for(let i=0;i<n;i++){ const a=wlo[i]; wx[i]=total-wx[i]; wlo[i]=total-whi[i]; whi[i]=total-a; if(genericX[i]!=null) genericX[i]=total-genericX[i]; } }
  const np=[...interrupt].sort((a,b)=>a-b).map(d=>({d,h:head[d]-1,rel:t[d].deprel}));
  np.forEach(a=>{ a.hgt=(a.h>=0&&a.h<n)?arcHgt(Math.abs(wx[a.d]-wx[a.h]),38):12; });   // interrupter-arc height ∝ its width, matching (the now-halved) arc view
  // Shared=Yes ghost arcs (computed here, drawn later once base/relY/svg exist below): bracket nesting can only
  // show ONE parent, so every OTHER conjunct in the coordination gets a dashed, dimmed arc — the SAME raised-bump
  // treatment as a real interrupter arc, purely decorative (no data-dep/data-s, no click, no fan-bucket sharing
  // with the real interrupters — see .ghost-g). Heights count toward maxAH so a tall ghost never clips the top.
  // ghostPairsFor gives [originIdx,targetIdx,rel] — `d` (dependent) is the origin, `h` (head) is the target.
  const ghostArcs=ghostPairsFor(t).map(([o,tg,rel])=>({d:o,h:tg,rel,hgt:arcHgt(Math.abs(wx[o]-wx[tg]),38)}));
  // Subject=Generic no longer folds in here: it's drawn as its own small bracket pair in the seq itself (see the seq
  // construction above), not as an interrupter-style ghost arc — a real dependent's own bracket, not a decorative bump.
  const maxAH=Math.max(12,...np.map(a=>a.hgt),...ghostArcs.map(a=>a.hgt));
  const RELDESC=descent(WORD_F);   // deprel→form gap copies the wrapped stemma (projWrapped) EXACTLY: 20px + the form's descender depth (projWrapped is now the authoritative reference, not the old flat-tuned "20")
  /* ⚠ THE DEPREL→FORM STEP TAKES THE SAME +TOK_TR_GAP AS THE FORM→TRANSLITERATION ONE BELOW IT ("in
     brackets, the token-deprel gap should also match"). Only where there IS a label row: with show.labels
     off `relH` is 0 and RELEXTRA must be too, or the figure would reserve a gap above a row it never draws.
     The arithmetic keeps the LABEL still and moves the FORM down, which is what widening a gap stated as
     "label sits N above the form" means here: relH grows by the extra, yWord (=ARCH+relH+16) grows with
     it, and relY (=yWord−the same total) therefore lands back on ARCH+16, exactly where it was.
     ⚠️ `base` FOLLOWS relY, not yWord — it is written as relY below precisely so the invariant its old
     comment records ("a no-head-label arc attaches exactly at the deprel-row level … keeping arc endpoints
     and deprel baselines aligned across modes") survives a change that moves one and not the other. So the
     interrupter arcs stay where they are and the token drops away from them, matching how every other
     notation in this round treats its edge layer. */
  /* ⚠ …AND THEN A SECOND TOK_DESC, ASKED FOR ONE ROUND AFTER THE FIRST ("in brackets, the token-deprel gap
     needs to be increased (probably by descender length)") — so the total is TOK_TR_GAP + 2·TOK_DESC and the
     gap goes 33.3px → 38.7px for lzh. Written as a literal ×2 rather than folded into TOK_DESC itself: that
     constant is the FONT's descent, one descent, and outline's row padding reads the same measurement and was
     not asked to double. Still lzh-only (TOK_DESC is LZH_MAG-gated at source) — Sanskrit brackets were
     excluded when the first descent landed ("brackets are perfect") and nothing has revisited that, so
     magnified Sanskrit stays at the plain 25.4px this figure has always given it.
     ⚠️ AND THEN 4px LESS, one round after THAT ("in brackets, deprels need 4px *less* of space below") — a
     correction to the two-descent total just above (38.7px for lzh), not a reversion of it: the request
     adjusts where the gap now sits, it does not ask to undo the previous round. Subtracted from both
     RELEXTRA and relH, the same pair TOK_DESC's own second application lives in, so the two can't drift
     apart. lzh-only, matching BRK_DEPREL_LESS's own scope (js/diagram/diagram-core.js). */
  const RELEXTRA=show.labels?(TOK_TR_GAP+2*TOK_DESC-BRK_DEPREL_LESS):0;   // the literal font descent, twice, less the 4px correction — see TOK_DESC's own note on why it is not TR_TIGHTEN's em/ex form
  const relH=show.labels?(20+RELDESC+TOK_TR_GAP+2*TOK_DESC-BRK_DEPREL_LESS):0, ARCH=np.length?(ARC_APEX*maxAH+8):0, posH=show.pos?16:0;   // reserve to the tallest interrupter arc's visible PEAK (0.75·h), not its handle height
  const yWord=ARCH+relH+16, yPos=yWord+posH, H=yWord+posH+8+TOK_TR_GAP, relY=yWord-(20+RELDESC+RELEXTRA);   // deprel centre sits 20px + descent(WORD_F) above the form baseline — the SAME offset projWrapped uses (wordY-(20+RELDESC)), so wrapped stemma, flat brackets and wrapped brackets all match to ~1px
  const svg=E("svg",{class:"tree softcase",width:total,height:H,viewBox:`0 0 ${total} ${H}`}); const boxes=[];
  const NR=parseFloat(css("--arc-node-r"));   // POSGAP (=20) is gone with the line below: it existed only to re-derive `base`, and that is now stated as relY directly — see its note. The 20 itself survives where it belongs, inside relH/relY's own literal
  const base=relY;   // Item 15: the interrupter-arc endpoints clear the token by 20+descent(WORD_F) — which IS relY, the deprel-label baseline.   // …written AS relY now rather than re-derived from yWord: the two were equal by construction until the deprel gap gained RELEXTRA above, and stating the invariant beats restating the arithmetic that used to imply it So a no-head-label arc now attaches exactly at the deprel-row level (as in arc view and the wrapped bracket level arcs), keeping arc endpoints and deprel baselines aligned across modes (was 16)
  // whole-row hit target: clicking anywhere selects the innermost constituent whose brackets enclose that x
  const spanX={}; seq.forEach(it=>{ if(it.owner!=null){ (spanX[it.owner]=spanX[it.owner]||{owner:it.owner}); if(it.t==="o")spanX[it.owner].x0=it.x; if(it.t==="c")spanX[it.owner].x1=it.x; } });
  const spans=Object.values(spanX).filter(s=>s.x0!=null&&s.x1!=null);
  const hit=E("rect",{class:"span-hit",x:0,y:yWord+TOK_Y_LOWER-14,width:total,height:18,fill:"transparent"}); hit.style.cursor="pointer";   // the whole-row target follows the row it targets, which now draws TOK_Y_LOWER lower
  hit.addEventListener("click",ev=>{ ev.stopPropagation();
    const rect=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal, sx=vb.x+(ev.clientX-rect.left)/rect.width*vb.width;   // map click → user x (zoom-safe)
    let best=null; spans.forEach(s=>{ if(sx>=s.x0&&sx<=s.x1 && (!best||(s.x1-s.x0)<(best.x1-best.x0))) best=s; });   // smaller span wins
    if(best) pick(si,OID(best.owner)); }); svg.appendChild(hit);
  // selection: translucent highlight across the selected constituent, covering only the token/bracket row
  // (not the deprel/POS rows), and split around any interrupting token that isn't part of the constituent
  const selI=(()=>{ for(let i=0;i<n;i++) if(sel.s===si&&sel.t===OID(i)) return i; return -1; })();
  if(selI>=0){ const col=relColor(t[selI].deprel), L=lo[selI], Hh=hi[selI], wy=yWord-(rep[selI]||0);   // item 6: the wash rides at the SELECTED constituent's own (possibly reported-speech-lifted) row height, not the fixed base row — otherwise it stays behind on the line while the form/brackets/label it's meant to backlight float off it
    svg.style.setProperty("--washcol",col);   // so the softcase casing matches the wash colour
    const o=seq.find(it=>it.t==="o"&&it.owner===selI), c2=seq.find(it=>it.t==="c"&&it.owner===selI);
    if(o&&c2){ const Eset=new Set(); for(let p=L;p<=Hh;p++) if(!isAnc(selI,p)) Eset.add(p);   // interrupting tokens
      const holes=[...Eset].filter(p=>!Eset.has(head[p]-1))   // top-level interrupting constituents
        .map(p=>{ const oo=seq.find(it=>it.t==="o"&&it.owner===p), cc=seq.find(it=>it.t==="c"&&it.owner===p); return (oo&&cc)?[oo.x-2,cc.x+2]:null; })
        .filter(Boolean).sort((a,b)=>a[0]-b[0]);
      let cur=o.x-4; const segs=[];   // the whole span, minus each interrupting constituent (and its brackets)
      holes.forEach(([hL,hR])=>{ if(hL>cur) segs.push([cur,hL]); cur=Math.max(cur,hR); });
      if(c2.x+4>cur) segs.push([cur,c2.x+4]);
      segs.forEach(([x0,x1])=> svg.appendChild(E("rect",{x:x0,y:wy+TOK_Y_LOWER-13,width:x1-x0,height:16,rx:5,fill:col,"fill-opacity":0.15,"pointer-events":"none"}))); } }   // the wash backlights the FORM/BRACKET row, both of which draw on the lowered baseline (see TOK_Y_LOWER, js/diagram/diagram-core.js), so it rides with them
  // fan the interrupter-arc endpoints with the shared routine (the SAME fan arc view uses): the arc into an
  // interrupter sits central, arcs out of a shared head fan out, shortest outermost, one step
  const npReal=np.filter(a=>a.h>=0&&a.h<n).map(a=>Object.assign(a,{hk:a.h,dk:a.d,xh:wx[a.h],xd:wx[a.d],len:Math.abs(a.d-a.h)}));
  fanArcs(npReal,fanStep());
  // item 7: ghost endpoints fan against the SAME buckets the reals just resolved, never the reverse
  const ghostFan=ghostArcs.map(a=>({hk:a.h,dk:a.d,xh:wx[a.h],xd:wx[a.d]}));
  fanGhostArcs(npReal,ghostFan,fanStep());
  np.forEach(a=>{ if(a.h<0||a.h>=n)return; const col=relColor(a.rel), ink=arcInk(col);
    const XH=wx[a.h]+(a.offH||0), XD=wx[a.d]+(a.offD||0);   // fanned endpoints; crown ∝ arc width
    const lh=rep[a.h]||0, ld=rep[a.d]||0, ml=Math.max(lh,ld);   // item 6: each endpoint lifts by ITS token's reported-speech step
    const hasHRel=relOf(a.h)!=null, startY=(hasHRel?relY-10:base)-lh;   // Item 5: start the bump ~3px ABOVE the head (starting) token's deprel label (relY = its centre, ~7px tall); with no head label it stays at base — item 6: minus the head's lift
    const P=arcCtrlRaised(XH,XD,base-ml,a.hgt,startY,base-ld);        // take-off angle = arrowhead half-angle; raised start (Item 5); item 6: dependent endpoint lifted too, crown clears the higher of the two
    const te=trimT(P,1,AH-AEXT), sl=(te>0.001&&te<0.999)?subCurve(P,0,te):P;   // stop the line exactly at the arrowhead's base
    const dstr=`M ${sl[0][0]} ${sl[0][1]} C ${sl[1][0]} ${sl[1][1]}, ${sl[2][0]} ${sl[2][1]}, ${sl[3][0]} ${sl[3][1]}`;
    const g=E("g",{class:"arc","data-s":si,"data-dep":OID(a.d),"data-head":OID(a.h)});
    g.appendChild(E("path",{class:"arc-casing",d:dstr}));                       // opaque halo so crossing interrupter arcs occlude cleanly
    g.appendChild(E("path",{class:"ah-casing",d:arrowPath(P[2],P[3],AH,AH_OUTSET)}));
    g.appendChild(E("path",{class:"arc-path",d:dstr,stroke:ink}));
    g.appendChild(E("path",{class:"ah",d:arrowPath(P[2],P[3],AH),fill:ink}));
    if(show.labels){const apex=hasHRel?bezYExtent(P)[0]:base-ml-0.75*a.hgt, mx=(XH+XD)/2; drawLabel(g,mx,apex-8,a.rel,col); boxes.push({x:mx,y:apex-8,hx:meas(a.rel,POS_F)/2+2,hy:7});}   // label above the arc's visible peak (the raised bump's true crown when the start is lifted)
    g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(a.d))); svg.appendChild(g); boxes.push({x:(XH+XD)/2,y:base-ml-a.hgt,hx:2,hy:2}); });
  ghostArcs.forEach((a,gi)=>{ const col=relColor(a.rel), ink=arcInk(col), fan=ghostFan[gi];
    // unlike a real interrupter arc — whose dependent side is BY DEFINITION an interrupter with no visible deprel
    // label — a ghost's dependent (a.d, the Shared/Subj origin token) is typically an ordinary token that DOES
    // render its own label at the same row; without raising that end too, the ghost's landing point cuts straight
    // through it. Mirrors the head-side hasHRel/startY treatment above, applied to the OTHER end.
    const XH=wx[a.h]+(fan.offH||0), XD=wx[a.d]+(fan.offD||0), hasHRel=relOf(a.h)!=null, hasDRel=relOf(a.d)!=null,
      lh=rep[a.h]||0, ld=rep[a.d]||0, ml=Math.max(lh,ld),   // item 6: ghost endpoints lift with their reported tokens too
      startY=(hasHRel?relY-10:base)-lh, endY=(hasDRel?relY-10:base)-ld;
    const P=arcCtrlRaised(XH,XD,base-ml,a.hgt,startY,endY);
    const te=trimT(P,1,AH-AEXT), sl=(te>0.001&&te<0.999)?subCurve(P,0,te):P;
    const dstr=`M ${sl[0][0]} ${sl[0][1]} C ${sl[1][0]} ${sl[1][1]}, ${sl[2][0]} ${sl[2][1]}, ${sl[3][0]} ${sl[3][1]}`;
    const g=E("g",{class:"ghost-g"+(sel.s===si&&sel.t===OID(a.d)?" sel":""),"data-s":si,"data-dep":OID(a.d)});   // item 3
    g.appendChild(E("path",{class:"arc-path arc-ghost",d:dstr,stroke:ink}));
    g.appendChild(E("path",{class:"ah ah-ghost",d:arrowPath(P[2],P[3],AH),fill:ink}));
    const apex=(hasHRel||hasDRel)?bezYExtent(P)[0]:base-ml-0.75*a.hgt, mx=(XH+XD)/2;
    if(show.labels){   // item 6: vertical-lift decollision against `boxes` (every real label already final) — only ghost labels move. The crown box below is pushed AFTER this, not before — pushing it first made every ghost's own initial position (only 8px from its own crown) collide with itself, lifting every ghost label needlessly high
      const half=meas(a.rel,POS_F)/2+3, hh=7, y0=apex-8; let y=y0, guard=0;
      while(guard++<40 && boxes.some(b=>Math.abs(b.x-mx)<b.hx+half && Math.abs(b.y-y)<b.hy+hh)) y-=hh*2+3;
      if(y<y0-0.5) g.insertBefore(E("line",{class:"leader leader-ghost",x1:mx,y1:y+hh,x2:mx,y2:apex,stroke:arcInk(col)}),g.firstChild);
      drawLabel(g,mx,y,a.rel,col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:mx,y,hx:half,hy:hh}); }
    boxes.push({x:mx,y:apex,hx:2,hy:2});   // item 2: still counts toward fitTight's crop and later ghosts' decollision
    svg.appendChild(g); });
  let stackBot=yWord;
  seq.forEach(it=>{ if(it.t==="w"){
      const g=E("g",{class:"tok-group"+(sel.s===si&&sel.t===OID(it.i)?" sel":""),"data-s":si,"data-tok":OID(it.i)});
      const wy=yWord-rep[it.i], wyD=wy+TOK_Y_LOWER, loB=loBoxes(boxes);   // wy = the LAYOUT baseline (every box here, and the interrupter arcs' own `base`, are stated in it); wyD = where the form and its stack DRAW — see TOK_Y_LOWER (js/diagram/diagram-core.js)
      const rly=relY-rep[it.i];   // item 6: the deprel label rides above the form → lifts with a reported token, same as the form
      /* ⚠ …AND LOWERS WITH IT TOO — the one relation label in this app that does, and the exception is
         principled rather than convenient. Everywhere else a relation label annotates a drawn EDGE and is
         placed by that edge's own geometry (the stemma/hierarchy midpoint, the arc crown and its de-collision
         pass, the interrupter bump below), so it belongs to the edge layer TOK_Y_LOWER holds still. Flat
         brackets draws no edge for an ordinary token at all: this label is printed in the token's own cell,
         the above-stack twin of the POS row below it, and `relH`/`relY` exist precisely to hold its gap to the
         form at 20+descent(WORD_F) — the value the comment on relY records as matching wrapped stemma and
         wrapped brackets "to ~1px". Leaving it behind would have broken that three-way match by exactly 2.5px
         in the one member of it whose tokens moved. Its BOX stays on the layout baseline like every other, so
         it is also what opens this notation's crop headroom (the label is its topmost ink). */
      const r=relOf(it.i); if(r){ drawLabel(g,it.x,rly+TOK_Y_LOWER,r,relColor(t[it.i].deprel)); boxes.push({x:it.x,y:rly,hx:meas(r,POS_F)/2+2,hy:7}); }
      const f=E("text",{class:"tok-word"+(selI>=0&&isAnc(selI,it.i)?" inspan":"")+italDeco(t[it.i]),x:it.x,y:wyD,"text-anchor":"middle"}); f.textContent=bform(t[it.i]);   // host form only, under the wash; the deprel label + POS siblings in the group stay default
      stackBot=Math.max(stackBot, belowStack(g,it.x,wyD+TOK_TR_GAP,t[it.i],loB,hasTr(t)));   // transliteration + POS below the word   // +TOK_TR_GAP: the same 2.5px arcs takes, on request that stemma and brackets be "sized to match" it (js/diagram/diagram-core.js). Only the rows move; the form stays on wyD
      g.appendChild(f); gwFormSVG(g,f,t[it.i],it.x,wyD,WORD_F,"tok-word",si,loB);   // goeswith: continuation parts beside the head; the slur comes from the tie layer (mwtTie below)
      if(gwOf(t[it.i]).length) g.setAttribute("data-gw",[OID(it.i)].concat(gwOf(t[it.i]).map(p=>p.oid)).join(" "));
      svgMarks(g,it.x,wyD,t[it.i],WORD_F); svgFormSeamMark(g,t[it.i],it.x,wyD,WORD_F,loB);   // Item 11: form appended LAST → paints on TOP of the POS/translit stack; item 4: marks in front, then the seam mark off the form's inline end
      g.style.cursor="pointer"; g.addEventListener("click",()=>pick(si,OID(it.i))); svg.appendChild(g);
      boxes.push({x:it.x,y:wy-8,hx:it.w/2,hy:12});
      drawHangsSVG(svg,t[it.i],it.x,wyD,WORD_F,"tok-word",si,loB,OID(it.i)); drawLeadsSVG(svg,t[it.i],it.x,wyD,WORD_F,"tok-word",si,loB,OID(it.i));   // folded punctuation (and item 6's correct form) beside the word, before the following close bracket
    } else if(it.t==="g"){   // Subject=Generic: the ∅ — a real seq slot, drawn like any bracketed single-token dependent (its own label above, its own glyph on the word row), dimmed via .ghost-g. NEVER highlighted via the predicate's own selection — the predicate is this relation's HEAD, not its dependent, and the ∅ dependent has no real token of its own to select instead
      const i=it.i, col=relColor("subj"), g=E("g",{class:"ghost-g","data-s":si});
      const wy=yWord-rep[i], rly=relY-rep[i];
      if(show.labels){ drawLabel(g,it.x,rly+TOK_Y_LOWER,"subj",col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); boxes.push({x:it.x,y:rly,hx:meas("subj",POS_F)/2+2,hy:7}); }   // the ∅'s own cell, label and all, moves exactly as a real token's does (see the `w` branch above)
      const glbl=E("text",{class:"tok-word",x:it.x,y:wy+TOK_Y_LOWER,"text-anchor":"middle"}); glbl.textContent="∅"; g.appendChild(glbl);   // a virtual TOKEN on the word row → lowers with the real ones; both boxes stay on the layout baseline
      svg.appendChild(g); boxes.push({x:it.x,y:wy-8,hx:it.w/2,hy:12});
    } else { const selBr=it.owner!=null&&sel.s===si&&sel.t===OID(it.owner);
      const by=yWord-(it.owner!=null?rep[it.owner]:0);   // a bracket sits on the plane of the constituent it delimits (its owner is that constituent's head)
      /* ⚠ A BRACKET SHARES THE FORMS' OWN TEXT ROW, so it takes the SAME lowering they do — the one piece of
         non-token furniture in this file that must move. It is not an edge: flat brackets set "[", the word and
         "]" on one baseline precisely so they read as one line of type (see .bwbr's own note in app.css, which
         keeps the wrapped view's brackets on the form's baseline for the identical reason), and leaving them on
         the layout baseline while every form dropped 2.5px would break that line apart. The interrupter ARCS
         above them are the edge layer here, and they stay on `base`/`relY`, untouched. */
      /* ⚠ …AND, ONCE THE TOKEN IS MAGNIFIED, CENTRED ON IT RATHER THAN LEFT ON ITS BASELINE ("in brackets
         and outlines, the Chinese tokens need to be centre-aligned with the brackets"). A shared baseline is
         what makes "[", the word and "]" read as one line of type while all three are one size; at 1.5–2×
         the token's x-height band climbs well above the 16px bracket's and the brackets read as having sunk
         to the word's feet. `centreBracketLift` (js/diagram/diagram-core.js) — deliberately NOT the seam
         mark's `centreOnTokenLift`, which centres two x-height BANDS and so has nothing to say about a
         glyph that spans ascender to descender; its own note carries the measurement that settled it.
         Measured at TOK_MAG 1.5: a 4.05px lift, landing the two ink centres 0.15px apart (they were 3.90px
         apart before). The BRACKET moves, not the token: everything else in the cell (the deprel
         label above, the below-stack, the MWT tie, the wash and hit bands, the interrupter-arc endpoints)
         is seated off the token's baseline, so lifting the two glyphs that are not is the local change.
         Its box moves with it — this is real ink, not a draw-vs-crop asymmetry. 0 at TOK_MAG 1, where
         `.brk` renders exactly as it always has. */
      const brkLift=centreBracketLift(BRK_PAINT,WORD_F);   // BRK_PAINT states .brk's PAINTED face (app.css: 16px/600), not RF — RF is 15px and exists to measure slot WIDTHS, and a 1px size error here is 0.4px of lift, which is a fifth of the whole correction. WORD_F is the token's own magnified face, the one .tok-word paints in
      const battr={class:"brk"+(it.ghost?" brk-ghost":"")+(selBr?" sel":"")+(selI>=0&&it.owner!=null&&isAnc(selI,it.owner)?" inspan":""),x:it.x,y:by+TOK_Y_LOWER-brkLift,fill:it.col}; if(it.owner!=null){ battr["data-s"]=si; battr["data-owner"]=OID(it.owner); }   // brackets of the subtree's constituents get .inspan too; the ∅'s own bracket (it.ghost) is dimmed, not owned/clickable
      const b=E("text",battr); b.textContent=it.glyph; svg.appendChild(b);   // original glyph at the mirrored position (so RTL reads correctly)
      if(it.owner!=null){ b.style.cursor="pointer"; b.addEventListener("click",()=>pick(si,OID(it.owner))); }   // clicking a bracket selects the span it delimits
      boxes.push({x:it.x,y:by-6-brkLift,hx:it.w/2,hy:9}); } });
  mwtTie(svg,wx,wform,D,stackBot+5,loBoxes(boxes),si);   // surface-form ties for multi-word tokens — hug the FORM's own ink width, not the (deprel-label-widened) slot   // stackBot already came back lowered, so the tie keeps its distance under the word
  fitTight(svg,boxes);
  return wrapDiagram(svg,si);}
function outline(si){const D=displaySent(DOC[si]), t=D.tokens, n=t.length, OID=k=>D.map[k]+1, sent={tokens:t},{children,root}=structure(sent); RTL=D.rtl;
  const kids=children;   // a Shared=Yes token nests under its literal head, same as any other dependent — no redirection
  // Ghost rows: a semi-transparent copy of a token's row under every OTHER conjunct in its coordination
  // (Shared=Yes, labelled with the token's own deprel) or under its re-derived Subject-raising target (labelled
  // "subj", regardless of the token's own actual deprel — the raising relationship, not its real attachment) —
  // alongside its one real (fully-opaque) row under wherever it's actually attached.
  // ghostsAt is indexed by TARGET (the row a ghost nests under); each entry names its ORIGIN (gi, the token
  // actually displayed as the ghost row) — ghostPairsFor gives [originIdx,targetIdx,rel].
  const ghostsAt=Array.from({length:n},()=>[]);
  ghostPairsFor(t).forEach(([o,tg,rel])=>{ if(tg>=0&&tg<n&&o>=0&&o<n) ghostsAt[tg].push({gi:o,rel}); });
  const mwtOf={}; (D.mwt||[]).forEach(m=>mwtOf[m.from-1]=m);   // annotate the first word of each multi-word token
  const box=document.createElement("div"); box.className="text-conv outline"; box.dir=RTL?"rtl":"ltr";
  box.style.paddingBottom=(15-TOK_Y_LOWER+descent(NODE_F))+"px";   // bottom = the same 15px base the top uses + the outline form font's descender depth, so the last row's descenders clear the edge (CSS can't call descent()) — LESS TOK_Y_LOWER, which the top takes
  box.style.paddingTop=(15+TOK_Y_LOWER)+"px";   // the outline's own statement of the token lowering the SVG notations get per token (see TOK_Y_LOWER, js/diagram/diagram-core.js). It needs no draw-vs-crop asymmetry, because it has neither: a row IS the token here — the relation label, the form, the transliteration, the gloss tiers and the POS tag all run INLINE along it — and there is no separate edge layer to hold still. So the 2.5 simply moves from the bottom pad to the top one: total height unchanged, every row 2.5px lower
  // item 3 — shift each row's content DOWN by half the form's descender: less padding above, that much more below,
  // so the x-height band (not the full ascender-to-descender box) reads as vertically centred in the row.
  /* ⚠ …AND, FOR A MAGNIFIED ROW, HALF THE DESCENT MOVES BACK THE OTHER WAY ("in outlines, the top
     padding of each row should be increased by half the length of the descender, and the bottom padding
     should be decreased by the same amount"). Layered ON TOP of the universal `_half` above rather than
     flipping its sign: that term is a real, language-independent centring of the x-height band and every
     other document still needs it. MAG_DESC is 0 at TOK_MAG 1, so those documents keep 5∓_half exactly.
     (At any magnification the two terms then cancel to a flat 5/5 — arithmetic, not intent.)
     ⚠️ MAG_DESC, NOT TOK_DESC — this term shipped lzh-only and was widened to every magnified script one
     round later ("in Sanskrit outline view, the rows need the same vertical padding adjustment we did for
     lzh"). The two constants measure the same descent and differ only in gate; the split exists precisely so
     that widening this one leaves the OTHER reader of that measurement — brackets' token→deprel gap, which
     Sanskrit was explicitly excluded from — lzh-only. See MAG_DESC's note (js/diagram/diagram-core.js). */
  const _half=descent(NODE_F)/2, _magHalf=MAG_DESC/2; box.style.setProperty("--olpt",(5-_half+_magHalf)+"px"); box.style.setProperty("--olpb",(5+_half-_magHalf)+"px");
  const sb=document.createElement("div"); sb.className="osubbox"; box.appendChild(sb);   // subtree box (bottom)
  const hv=document.createElement("div"); hv.className="ohovbox"; box.appendChild(hv);   // hover band (middle) — same span as a row's selection
  const sr=document.createElement("div"); sr.className="oselrow"; box.appendChild(sr);   // selected-row band (top), same width as the box
  const rowAtBand=(x,y)=>{ const rows=[...box.querySelectorAll(".oline")]; if(!rows.length)return null; const rtl=box.dir==="rtl";
    let far=rtl?Infinity:-Infinity; rows.forEach(r=>{ const b=r.getBoundingClientRect(); far=rtl?Math.min(far,b.left):Math.max(far,b.right); });   // far edge of the whole tree (mirrored under RTL)
    for(const r of rows){ const rr=r.getBoundingClientRect(); if(y>=rr.top&&y<=rr.bottom) return (rtl ? (x>=far-4 && x<=rr.right+4) : (x>=rr.left-4 && x<=far+4))?r:null; }
    return null; };
  box.addEventListener("mousemove",e=>{ const hit=rowAtBand(e.clientX,e.clientY); if(hit) positionHoverBox(hit); else hv.style.display="none"; });
  box.addEventListener("mouseleave",()=>{ hv.style.display="none"; });
  box.addEventListener("click",e=>{ if(e.target.closest(".oline"))return; const hit=rowAtBand(e.clientX,e.clientY); if(hit){ e.stopPropagation(); pick(+hit.dataset.s,+hit.dataset.tok); } });
  const inSel=i=>sel.s===si&&sel.t===OID(i);
  (function w(i,d,anc,reps){ const chain=anc.concat(OID(i));   // ancestors-or-self, so a selection can light up the whole subtree
    const insub=chain.includes(sel.t)&&sel.s===si;
    const myReps=isReported(t[i])?reps.concat(OID(i)):reps;   // item 7: the reported roots (outermost→innermost) that dominate this row — one drop-shadow box per root
    const row=document.createElement("div"); row.className="oline"+(inSel(i)?" sel":"")+(insub?" insub":"");
    row.dataset.s=si; row.dataset.tok=OID(i); row.dataset.anc=chain.join(" "); if(myReps.length)row.dataset.reproots=myReps.join(" "); row.style.marginInlineStart=(d*22)+"px";   // indent from the reading side (mirrors under RTL)
    if(show.labels){ const rel=document.createElement("span"); rel.className="orel"+(isMorphRel(t[i].deprel)?" morph-lbl":""); setRelLabel(rel,t[i].deprel); rel.title=relTitle(t[i].deprel);
      if(show.colour) rel.style.color=relColor(t[i].deprel); row.appendChild(rel); }
    appendLeadHTML(row,t[i],si,"punctsat opunct",OID(i));   // item 2: right-merging leads sit before the form (after the relation label)
    const form=document.createElement("span"); form.className="oform"+formDeco(t[i])+italDeco(t[i]); form.textContent=bform(t[i]); htmlSeamMark(form,t[i],"form");
    /* ⚠ AND THE FORM ITSELF DROPS — REVERTED FROM TR_TIGHTEN TO A FLAT 2px ("revert the latest lowering of
       outline tokens, and instead lower by 2px"). The previous round read "tokens need to be lowered by
       0.5em - 0.5ex" as reusing the hierarchy's own em/ex quantity (5.23px); this correction says that
       reading was wrong outright — not merely too big — and replaces it with a literal, un-derived 2px, the
       same flat-px idiom TOK_Y_LOWER/NODE_Y_EXTRA/TR_ROW_EXTRA already use elsewhere in this feature. Still
       a margin-top on the flex ITEM alone (`.oline{display:flex; align-items:var(--script-cross,baseline)}`),
       so the token nudges down without moving its row-mates (deprel/translit/gloss/POS) — that part of the
       previous reasoning stands, only the MAGNITUDE and its DERIVATION were wrong. lzh-only; 0 outside lzh. */
    if(LZH_MAG) form.style.marginTop="2px";
    if(gwOf(t[i]).length){ const ids=[OID(i)].concat(gwOf(t[i]).map(p=>p.oid));
      form.classList.add("gwunit"); gwFormHTML(form,form,t[i],si,"opart"); gwSlurHTML(form,ids,si); row.dataset.gw=ids.join(" "); }   // goeswith: the outline is the one view whose tiers run INLINE along the row, so there is no stack to share — the sharing is simply that the continuation gets NO row of its own (the fold saw to that) and no tiers of its own. The slur hangs out of flow under the pair, the same zero-width trick the seam marks use
    row.appendChild(form);   // host form only. The outline is the ONE view whose tiers run INLINE along a single row rather than stacked under the token, so the seam mark goes on the form alone: repeated after the transliteration and the segmentation too it would read as a separator BETWEEN the fields ("de=de=of") rather than as the word continuing
    appendHangHTML(row,t[i],si,"punctsat opunct",OID(i));   // folded punctuation as separate, selectable inline spans right after the form (before any translit/POS)
    { const rt=trTxt(t[i]); if(rt){ const tr=document.createElement("span"); tr.className="otrans"+(trRowEdit()?" tr-edit":"")+frnUp(t[i]); tr.textContent=rt; row.appendChild(tr); } }   // right next to the form
    belowTiers().forEach(tier=>{ const txt=tierText(t[i],tier); const gs=document.createElement("span"); gs.className="gloss gl-edit"+(txt?"":" gl-empty")+frnUp(t[i]); gs.dataset.tier=tier; gs.tabIndex=0; setGlossText(gs,tier,txt||"…"); row.appendChild(gs); });   // gloss / morphemic tiers, between translit and POS (outline lays these out inline)
    const pos=document.createElement("span"); pos.className="opos"; pos.textContent=posDisp(t[i]); pos.title=posTitle(t[i].upos); row.appendChild(pos);
    row.style.cursor="pointer"; row.addEventListener("click",()=>pick(si,OID(i)));
    box.appendChild(row);   // MWTs are omitted from the outline — no good way to place them in a dependency tree
    kids[i].slice().sort((a,b)=>a-b).forEach(c=>w(c,d+1,chain,myReps));
    ghostsAt[i].forEach(({gi,rel})=>{ const grow=document.createElement("div"); grow.className="oline oline-ghost"+(inSel(gi)?" sel":"");   // item 3: highlighted like a real row when ITS token is the current selection
      grow.dataset.s=si; grow.dataset.tok=OID(gi); if(myReps.length)grow.dataset.reproots=myReps.join(" "); grow.style.marginInlineStart=((d+1)*22)+"px";
      if(show.labels){ const relEl=document.createElement("span"); relEl.className="orel"+(isMorphRel(rel)?" morph-lbl":""); setRelLabel(relEl,rel); relEl.title=relTitle(rel);
        if(show.colour) relEl.style.color=relColor(rel); grow.appendChild(relEl); }
      const gform=document.createElement("span"); gform.className="oform"+formDeco(t[gi])+italDeco(t[gi]); gform.textContent=bform(t[gi]); grow.appendChild(gform);
      const gpos=document.createElement("span"); gpos.className="opos"; gpos.textContent=posDisp(t[gi]); gpos.title=posTitle(t[gi].upos); grow.appendChild(gpos);
      grow.style.cursor="pointer"; grow.addEventListener("click",()=>pick(si,OID(gi)));
      box.appendChild(grow); });
    if(hasGenericSubj(t,i)){ const grow=document.createElement("div"); grow.className="oline oline-ghost";   // item 2: Subject=Generic — a real ROW, like any other token, nested under its head; never selectable/editable (nothing real to click)
      grow.style.marginInlineStart=((d+1)*22)+"px";
      if(show.labels){ const relEl=document.createElement("span"); relEl.className="orel"; setRelLabel(relEl,"subj"); relEl.title=relTitle("subj");
        if(show.colour) relEl.style.color=relColor("subj"); grow.appendChild(relEl); }
      const gform=document.createElement("span"); gform.className="oform"; gform.textContent="∅"; grow.appendChild(gform);
      box.appendChild(grow); }
    })(root,0,[],[]);
  return box;}
/* A GHOST DRAWS BEHIND EVERY REAL EDGE — one z-order pass here rather than reordered appends in five
   renderers. A ghost duplicates an attachment the diagram already draws for real (Shared=Yes
   coordination, Subject-raising, the Subject=Generic ∅), so wherever a ghost and a real edge cross,
   the real one has to be the one that reads as continuous — and a real edge carries a casing whose
   whole job is to occlude what it passes over, which it could not do while the ghost was painted
   after it. Every renderer appends its ghosts AFTER its real edges, because a ghost label is placed
   by decolliding against the real labels' FINAL positions, and that ordering is what put them in
   front: SVG has no z-index, paint order IS document order.
   Moving the `.ghost-g` GROUP carries the ghost's label and its leader line with it — both are its
   own children (see the drawLabel/insertBefore pairs in each renderer) — so the three move as the
   one object they read as.
   Only ghosts that sit AFTER the first real edge move, and they keep their order among themselves,
   so nothing else in the stack shifts: the projection lines and baseline words a ghost already
   draws over stay behind it, and the token/node layer every renderer appends last stays in front. */
const GHOST_LAYER=".ghost-g,.proj-ghost";
const REAL_EDGE_LAYER=".arc,.edge-g,.edge-cases";   // every notation's real dependency layer, and GROUPS only — an .arc/.edge-g <g> holds its own stroke, arrowhead, casing, label and leader, so this one selector covers all four things a ghost has to go behind. (The paths inside are .arc-path/.arc-casing/…, which `.arc` does not match: class selectors match whole tokens.)
function ghostsBehind(svg){
  if(!svg||!svg.children) return;
  const kids=[...svg.children], ai=kids.findIndex(el=>el.matches(REAL_EDGE_LAYER));
  if(ai<0) return;   // nothing real to sit behind — a single-token sentence, or the bracket/outline notations, which draw no edges at all
  for(let i=ai+1;i<kids.length;i++) if(kids[i].matches(GHOST_LAYER)) svg.insertBefore(kids[i],kids[ai]);
}
function wrap(svg){ghostsBehind(svg); const d=document.createElement("div"); d.className="diagram"; d.appendChild(svg); return d;}
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

