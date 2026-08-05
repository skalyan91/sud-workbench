//@module js/diagram-edit.js
/* ── diagram editing: drag a node to reorder tokens; drag an edge/arc onto a node to set its head ──
   Stemma + arcs only for now (other notations get their own patterns later). Tokens and edges already carry
   data-s / data-tok / data-dep / data-head, so one delegated pointer handler on #doc covers every block. */
let DDRAG=null, DSUPPRESS=false, DGHOST=null, DCARET=null;
/* The lemma editor is reached by ⌘L (Edit Lemma, app/menu_spec.py → editLemmaShortcut) and by the token
   context menu's own row. It was ALSO reachable by two double-click gestures — a double-tap on the token
   and a native dblclick inside the open form editor — which are gone: between them they needed a 450 ms
   timer, a suppression flag and a note explaining why one could not see the tap the other could, all to
   support a gesture nothing on screen announced. openLemmaEditor went with them; editLemmaPrompt is the
   entry point, and the two remaining callers pick their own token first. */
const ddNode=el=>el&&el.closest?el.closest("#doc .node, #doc .tok-group, #doc .bwtok"):null;   // brackets draw each word as a .bwtok — draggable like a stemma node
const ddEdge=el=>el&&el.closest?el.closest("#doc .edge-g, #doc .arc"):null;
const DNODE_Q=`.node[data-s="{s}"], .tok-group[data-s="{s}"], .bwtok[data-s="{s}"]`;   // every drawn token in a sentence, across the draggable notations
async function setDiagramHead(si,depId,headId){ const s=DOC[si]; if(!s||depId<1||depId>s.tokens.length)return;
  const dep=s.tokens[depId-1], head=(headId>=1&&headId<=s.tokens.length)?s.tokens[headId-1]:null;
  if(head && await depIsError(head.upos,dep.upos,dep.deprel)){ toast(`Can't attach: “${dep.deprel}” isn't valid on ${head.upos||"?"}`); return; }   // error-level invalid → don't let the drag stick
  pushUndo(si); dep.head=String(headId); afterHeadEdit(dep,s);
  // Task B: NO regenTok here — re-heading a token by drag is purely structural and must never trigger a
  // gloss/MGloss recompute (the one thing regenTok's regenSecondaries call does besides re-derive lemma/feats/
  // deps, none of which a head edit needs either). Every other head/deprel edit site dropped this same call —
  // see setAsRoot/stepHead (js/editing/edit-ops.js) and the deprel context-menu choosers (js/editing/context-menu.js).
  markDirty(); preserveScroll(renderDoc); pick(si,depId,false); toast(`Head of token ${depId} → ${headId}`); }
// is (headPOS ⟵deprel⟶ depPOS) an error-level violation? (only hard constraints — warnings are allowed)
async function depIsError(headUpos,depUpos,deprel){ if(!hasBridge()||!deprel||depBase(deprel)==="root")return false;
  try{ const r=await window.pywebview.api.valid_deprels(headUpos||"",depUpos||"",[deprel]); return !!(r&&r.deprels&&!r.deprels.includes(deprel)); }catch(e){ return false; } }
// is `tokId` the DEPENDENT of a conj relation (conj / conj:and / conj:appos / …)? — gates dropping a token
// onto that conj edge (see attachAsSharedConjunct/commitDrop below)
function isConjDep(si,tokId){ const s=DOC[si], t=s&&s.tokens[tokId-1]; return !!(t && famOf(t.deprel)==="conj"); }
// Subj (subject-raising) feature: dropping a token onto a subj/comp:obj/comp:obl/root edge marks it as notionally
// raised to that argument slot WITHOUT rewiring its own structural head/deprel — purely a FEATS annotation plus a
// dashed "subj" ghost edge to the derived target (subjRaiseTarget below), exactly like Shared=Yes leaves the real
// tree alone and only adds a decorative edge. RAISE_TYPES maps the ARGUMENT's own (base) relation — whichever of
// the drop's two tokens that is, see raiseMirror; the code reads it off that token's deprel (attachAsRaisedSubj's
// `depBase(dragged.deprel)`), NOT off the relation of the edge dropped onto, which this comment used to claim —
// to the Subject feature value used in the general case; NOT used (see attachAsRaisedSubj) when the embedded predicate being
// dropped onto is itself a MODIFIER (mod family — mod/mod:relcl/mod:advcl/…) of the dragged argument's OWN head —
// that configuration is a free adjunct with a coreferential-but-not-raised subject, i.e. "Instantiated", regardless
// of which type the dragged argument's own deprel would otherwise imply. Per the SUD guidelines page
// (Features/Subject.md) the canonical Instantiated example is exactly this: "Condamné à dix ans, il passe le reste
// de sa vie en prison" — the participle "Condamné" is a mod(:advcl) of "passe", the very verb that governs "il" —
// whereas all three typed examples (SubjRaising/ObjRaising/OblRaising) have the embedded predicate as a genuine
// COMPLEMENT (comp family) of the matrix predicate. This is NOT about linear order — an earlier version of this
// code picked the typed value only when the argument preceded the predicate, which was an unrelated (and wrong,
// SVO-specific) heuristic; word order plays no role in the actual rule.
// item 2: Generic is NOT one of these — it isn't reached by dragging an argument onto a predicate's edge at all
// (there's no real argument to drag; the subject is understood/arbitrary, with nothing to point to). It's set by
// a SEPARATE gesture entirely — dragging the predicate itself onto the caret just before it (see attachGenericSubj).
const RAISE_TYPES={subj:"SubjRaising","comp:obj":"ObjRaising","comp:obl":"OblRaising"};
// item 1: Subject lives on the embedded PREDICATE (e.g. "go" in "he wants to go"), not on the raised
// argument, so what this tests is simply "is this token a VERB/AUX" — its own deprel family plays no part.
// NO LONGER A DROP GATE OF ITS OWN. It used to admit the opposite direction (the ARGUMENT dropped onto the
// PREDICATE's edge); that direction was withdrawn on request, leaving raiseMirror — the predicate dropped onto
// the argument's edge — as the one raising gesture. This survives as the VERB/AUX test raiseMirror runs on the
// DRAGGED token.
function isRaiseTargetDep(si,tokId){ const s=DOC[si], t=s&&s.tokens[tokId-1]; return !!(t && (t.upos==="VERB"||t.upos==="AUX")); }
/* THE SAME GESTURE THE OTHER WAY ROUND — drag the PREDICATE onto the ARGUMENT's own edge. Everything above
   describes dropping the argument onto the embedded predicate's edge ("he" → the comp edge pointing at "go"),
   and that is what isRaiseTargetDep gates: the edge's DEPENDENT has to be the VERB/AUX. Read from the other end
   the gesture is just as natural, and arguably more so — grab the verb, drop it on the subj edge whose dependent
   is to be its subject — but under that gate it could never fire, because a subj edge's dependent is the subject,
   a noun, so the drop fell through to "reorder to that x" and nothing happened at all. Not a broken feature: an
   unimplemented direction, and one this returns.
   THIS IS NOW THE ONLY DIRECTION. Dropping the argument onto the predicate's edge was withdrawn on request, so
   there is no longer an ambiguous case to resolve and no precedence rule to keep. Which of the two RAISING
   FEATURES the drop sets is chosen at the drop site instead, by the zone the pointer is released in — see
   showRaiseZones/raiseZoneAt. The annotation itself is unchanged: it lives on the predicate, and its value still
   comes from the argument's own deprel via attachAsRaisedSubj's crawl-and-validate. */
function raiseMirror(si,draggedId,edgeDepId){ const s=DOC[si]; if(!s) return false;
  const onEdge=s.tokens[edgeDepId-1];
  return !!(onEdge && isRaiseTargetDep(si,draggedId) && RAISE_TYPES[depBase(onEdge.deprel)]); }
// The raising target for `tokId`, of the given `targetType` ("subj"/"comp:obj"/"comp:obl"): crawl UP tokId's own
// (unchanged) head chain, skipping any non-VERB/AUX ancestor freely; the FIRST VERB/AUX ancestor is the stopping
// point, and the target is THAT ancestor's own dependent whose base relation equals targetType. If the first
// VERB/AUX ancestor has no such dependent, the crawl may cross ONE further VERB/AUX and try again there — but no
// more than one VERB/AUX may ever be crossed without success, and an AUX specifically ends the crawl outright the
// moment it's crossed without a match (both rules share the same one-crossing budget; the AUX case is called out
// explicitly by spec but changes nothing beyond it). Returns the target's 1-based token id, or null if no
// reachable target exists. These are the SAME constraints used both when the drag is first accepted
// (attachAsRaisedSubj) and on every later render (so the dotted edge never has to be separately persisted — it's
// re-derived identically every time).
function subjRaiseTarget(tokens,tokId,targetType){
  let cur=tokId, crossed=0, guard=0;
  while(guard++<=tokens.length){
    const tk=tokens[cur-1]; if(!tk) return null;
    const hid=parseInt(tk.head,10); if(!(hid>=1&&hid<=tokens.length)) return null;
    const anc=tokens[hid-1], isAux=anc.upos==="AUX", isVA=anc.upos==="VERB"||isAux;
    if(isVA){
      const di=tokens.findIndex((d,i)=>i+1!==tokId&&parseInt(d.head,10)===hid&&depBase(d.deprel)===targetType);
      if(di>=0) return di+1;
      if(crossed>=1) return null;   // this is already the one permitted crossing without a match — no further crossing allowed
      if(isAux) return null;        // crossing an AUX at all ends the crawl outright, even on the first one
      crossed++;
    }
    cur=hid;
  }
  return null;
}
// MISC Subject values don't all name a type: SubjRaising/ObjRaising/OblRaising/Generic each imply exactly one
// (subj/comp:obj/comp:obl/root), but "Instantiated" (a rightwards target) collapses all four into one value —
// nothing else is persisted (see attachAsRaisedSubj's own comment), so re-deriving an Instantiated token's ghost
// target means trying each type in turn and taking the first that resolves. In a well-formed tree at most one
// should ever match at a given ancestor, so the fixed try-order (subj, then comp:obj, comp:obl, root) is only a
// tie-break for the rare case more than one does.
const SUBJ_TYPE_OF={SubjRaising:"subj",ObjRaising:"comp:obj",OblRaising:"comp:obl"};
// Generic isn't in here — it has no real crawl target at all (see attachGenericSubj); subjRaiseTargetFor
// correctly falls through to null for it, same as any other value it doesn't recognise.
/* THE UNTYPED VALUES — `Instantiated` and `Raising` — name no particular controller slot, so the crawl has to
   TRY all three and take whichever resolves.
   `Raising` is not in the guidelines' own value list and must never be OFFERED for authoring: it is what the
   vendored say_SUD_to_UD.grs emits when it migrates a deprecated `@x` deep edge ("M.Subject=Raising"), and `@x`
   recorded only THAT there was control/raising, never whether the controller was the subject, object or oblique
   — so the migration cannot produce a typed value and neither can we recover one. It is read, drawn and exported
   like any other raising value (SUD_to_UD.grs matches it alongside the three typed ones, so such a document
   still converts to xcomp); it is simply never suggested. A document that already contains it still gets it in
   the completion dropdown, because acValItems appends the values actually present in the file. */
const UNTYPED_RAISING={Instantiated:1,Raising:1};
function subjRaiseTargetFor(tokens,tokId,subjVal){
  const type=SUBJ_TYPE_OF[subjVal];
  if(type) return subjRaiseTarget(tokens,tokId,type);
  if(!UNTYPED_RAISING[subjVal]) return null;
  for(const t of ["subj","comp:obj","comp:obl"]){ const r=subjRaiseTarget(tokens,tokId,t); if(r) return r; }
  return null;
}
// rendering helper (stemma/tree/arcs/brackets, flat + wrapped): the Subject-raising ghost target for token i
// (0-based), or null. Reads i's MISC Subject value and re-derives the target the SAME way attachAsRaisedSubj did —
// nothing about the ghost edge is separately persisted. Returns null for Generic — that ghost has no real target
// at all (see hasGenericSubj / the synthetic ∅ node each renderer draws instead).
function raiseGhostTarget(t,i,key){ if(!show.extRel) return null; const val=raiseGet(t[i],key); if(!val) return null;
  const tid=subjRaiseTargetFor(t,i+1,val); return (tid!=null)?tid-1:null; }
function subjGhostTarget(t,i){ return raiseGhostTarget(t,i,"Subject"); }
// Subject=Generic: an arbitrary/understood subject with no real filler — token i (0-based) has one, or not.
function hasGenericSubj(t,i){ return show.extRel && raiseGet(t[i],"Subject")==="Generic"; }
// item 2 (redesign): the ∅ isn't a floating decoration — it's a virtual TOKEN, reserved as real space just
// before its head in the SAME linear sequence real tokens occupy (so it participates in spacing exactly like a
// real token would), just never editable/interactable/grid-visible. This is the width of that reserved band —
// the ∅ glyph itself plus clearance — inserted immediately before token i's own slot when i has Subject=Generic.
function genericSubjGapW(t,i,font){ return hasGenericSubj(t,i) ? (meas("∅",font||WORD_F)+10) : 0; }
// dropping a token (`tokId`, the raised argument — e.g. "he") onto a VERB/AUX's edge (`edgeDepId`, the embedded
// PREDICATE — e.g. "go"): MISC Subject is set on the PREDICATE, not on the dragged token, matching the corpus
// convention (Subject marks the predicate whose subject is raised/shared). `type` is the DRAGGED token's own deprel
// family (e.g. "subj") — that's what the crawl, run from the PREDICATE upward, searches the crossed VERB/AUX
// ancestor's dependents for. The crawl must land back on EXACTLY the dragged token, or the drop is rejected
// rather than silently accepted and then failing to redraw (a drop the crawl can't itself reach — e.g. more than
// one VERB/AUX away — is invalid).
async function attachAsRaisedSubj(si,tokId,edgeDepId){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return;
  const dragged=s.tokens[tokId-1], predicate=s.tokens[edgeDepId-1]; if(!dragged||!predicate)return;
  if(predicate.upos!=="VERB"&&predicate.upos!=="AUX")return;   // item 1: Subject only ever lives on a VERB/AUX
  const type=depBase(dragged.deprel); if(!RAISE_TYPES[type])return;
  const foundId=subjRaiseTarget(s.tokens,edgeDepId,type);
  if(foundId!==tokId){ toast(`This token isn't reachable as a ${type} from “${predicate.form}” (crosses more than one VERB/AUX, or lands elsewhere)`); return; }
  // Instantiated vs typed: NOT linear order (see RAISE_TYPES' own comment) — it's whether the embedded predicate
  // we just dropped onto (`predicate`) is itself a MODIFIER of the dragged argument's OWN head, i.e. a free adjunct
  // (participial/etc.) attached to the same governor as `dragged`, rather than a genuine complement of it.
  const draggedHeadId=parseInt(dragged.head,10);
  const isModOfDraggedHead=draggedHeadId>=1&&parseInt(predicate.head,10)===draggedHeadId&&famOf(predicate.deprel)==="mod";
  const value=isModOfDraggedHead?"Instantiated":RAISE_TYPES[type];
  pushUndo(si); raiseSet(predicate,"Subject",value); markDirty(); preserveScroll(renderDoc); pick(si,edgeDepId,false);
  toast(`Token ${edgeDepId} marked Subject=${value}`); }   // the feature is named in the toast so the value is not read as a bare relation name
// item 2: dragging a VERB/AUX predicate onto the caret just before its OWN current position (a drop the reorder
// gesture would otherwise treat as a no-op — it's already there) toggles Subject=Generic: an arbitrary/understood
// subject with no real filler to point to, rendered as a ghost ∅ node rather than a ghost edge to a real token.
async function attachGenericSubj(si,tokId){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return;
  const tok=s.tokens[tokId-1]; if(!tok||(tok.upos!=="VERB"&&tok.upos!=="AUX"))return;
  const next=raiseGet(tok,"Subject")==="Generic"?null:"Generic";   // drop again to clear (toggle) — a no-op reorder made reversible instead of dead
  pushUndo(si); raiseSet(tok,"Subject",next); markDirty(); preserveScroll(renderDoc); pick(si,tokId,false);
  toast(next?`Token ${tokId} marked Generic`:`Token ${tokId}'s Generic subject cleared`); }
// dropping a token (or its incoming edge) ONTO a conj edge: `depId` becomes a dependent of WHICHEVER of the
// conj edge's two conjuncts sits on the SAME SIDE of it in linear order — the head conjunct if depId is
// leftwards, the dependent conjunct (`conjDepId`, the later conjunct — the exact node the conj edge's own
// arrowhead attaches to) if rightwards — so the new edge never has to cross the coordination it attaches to.
// Marked Shared=Yes so it's understood to belong to the whole coordination, not just that one conjunct. Every
// notation then draws the real edge normally (to whichever conjunct it's actually attached to) plus a dashed
// "ghost" edge to every OTHER conjunct in the coordination (conjunctsOf/otherConjuncts).
async function attachAsSharedConjunct(si,depId,conjDepId){ const s=DOC[si]; if(!s||depId<1||depId>s.tokens.length)return;
  const conjDep=s.tokens[conjDepId-1]; if(!conjDep)return;
  const conjHeadId=parseInt(conjDep.head,10);
  const targetId=(conjHeadId>=1 && conjHeadId<=s.tokens.length && Math.abs(depId-conjHeadId)<Math.abs(depId-conjDepId)) ? conjHeadId : conjDepId;
  const dep=s.tokens[depId-1], head=s.tokens[targetId-1];
  if(head && await depIsError(head.upos,dep.upos,dep.deprel)){ toast(`Can't attach: “${dep.deprel}” isn't valid on ${head.upos||"?"}`); return; }
  pushUndo(si); dep.head=String(targetId); afterHeadEdit(dep,s);
  // regenTok's own parser pass rewrites FEATS from scratch (reparseTokenFields → PARSE_FIELDS includes "feats") — awaiting
  // it here (instead of the usual fire-and-forget regenTok) and stamping Shared=Yes AFTER means the parser's guess can
  // never race past this point and silently clobber the marker we're about to set.
  // Task B: {skipGloss:true} — this reattach is structural (a head edit), so even though the FEATS refresh above is
  // still wanted, the recompute must never touch MGloss/Gloss at all; reparseTokenFields' own gloss-retargeting logic
  // is skipped outright rather than merely made non-destructive (contrast the grid's UPOS path, which DOES want it).
  if(hasBridge()&&model) await reparseTokenFields(si,[depId],{skipGloss:true});
  dep.feats=setFeat(dep.feats,"Shared","Yes");
  if(isSanskritLang()){ const m=(s.mwt||[]).find(x=>depId>=x.from&&depId<=x.to); if(m) sandhiMwtForms(si,[m.from]); }   // same MWT-refusion side effect regenTok itself would have applied
  markDirty(); preserveScroll(renderDoc); pick(si,depId,false); toast(`Token ${depId} attached as a shared dependent of the coordination`); }
(function(){ const docEl=document.getElementById("doc"); if(!docEl)return;
  const draggable=()=>conv==="stemma"||conv==="tree"||conv==="arcs"||conv==="brackets";
  let DLAST=null;   // last grabbed token, kept across a tap/cancel so a drag-lock ("double-tap to drag") gesture can be resurrected — see pointermove
  // item 1 — marquee (drag-area) selection: a drag that STARTS on empty diagram space sweeps out a rectangle and
  // selects every token whose box it touches, as the contiguous min–max range (token ids ARE reading order).
  let MARQ=null;
  const marqueeHits=(si,r)=>{ const blk=document.querySelector(`.sblock[data-i="${si}"]`); if(!blk) return null;
    let mn=Infinity,mx=-Infinity;
    blk.querySelectorAll('.tok-group[data-tok],.node[data-tok],.bwtok[data-tok]').forEach(g=>{ if(+g.getAttribute('data-s')!==si) return;
      const b=g.getBoundingClientRect(); if(b.right<r.l||b.left>r.r||b.bottom<r.t||b.top>r.b) return;   // no overlap with the marquee
      const id=+g.getAttribute('data-tok'); if(id<mn)mn=id; if(id>mx)mx=id; });
    return mx<0?null:{min:mn,max:mx}; };
  const updateMarquee=e=>{ const L=Math.min(MARQ.x0,e.clientX),T=Math.min(MARQ.y0,e.clientY),W=Math.abs(e.clientX-MARQ.x0),H=Math.abs(e.clientY-MARQ.y0);
    MARQ.div.style.left=L+"px"; MARQ.div.style.top=T+"px"; MARQ.div.style.width=W+"px"; MARQ.div.style.height=H+"px";
    const hits=marqueeHits(MARQ.si,{l:L,t:T,r:L+W,b:T+H}); MARQ.hits=hits;
    if(hits){ setRange(MARQ.si,hits.min,hits.max); sel={s:MARQ.si,t:hits.max}; applySel(); }   // live range highlight WITHOUT a full re-render (applySel just toggles the .rng/.rangesel classes)
    else { selRange=null; applySel(); } };
  const endMarquee=()=>{ if(MARQ&&MARQ.div)MARQ.div.remove(); MARQ=null; };
  docEl.addEventListener("pointerdown",e=>{ if(e.button!==0||!draggable())return;
    // an inline editor (makeEditable's floating .nodeedit input, appended to <body> — never inside #doc, so
    // clicking a DIFFERENT token always reaches here) is still focused from a PRIOR click: force its blur→
    // commit NOW, at the START of the gesture. Otherwise it races this gesture's own selection: the old
    // input's blur (fired as part of the SAME native click shifting focus) commits and re-asserts pick(OLD
    // token) via its own after-callback — leaving sel stuck on the token you just clicked AWAY from ("focus
    // keeps sticking to the first token"). Forcing the blur here puts it before the pointerup that selects,
    // so the tap's own pick() is unambiguously the LAST word.
    const activeEditor=document.activeElement, hadEditor=activeEditor&&activeEditor.classList&&activeEditor.classList.contains("nodeedit");
    if(hadEditor) activeEditor.blur();   // finish()'s own commit path unconditionally calls preserveScroll(renderDoc) — a FULL #doc rebuild — so `e.target` (resolved by the browser against the OLD tree before this handler ran) may now be a detached node whose closest("#doc …") can never match (its ancestor chain no longer reaches #doc at all); re-resolve the click target fresh against the rebuilt DOM instead of trusting e.target
    const target=hadEditor?document.elementFromPoint(e.clientX,e.clientY):e.target;
    const edge=ddEdge(target), node=ddNode(target);
    /* NO pick() ON EITHER GRAB: PRESSING IS NOT SELECTING. A press here is still ambiguous — it becomes a
       tap or a drag only once the pointer moves (or doesn't) — and selecting up front resolved it as a tap
       immediately, so dragging a token to re-head or reorder it lit the token up on the way past, and a drag
       that started from a different token silently threw away whatever was selected before. The selection now
       happens in the pointerup below, and ONLY on the branch that has confirmed the gesture was a tap.
       Nothing in the drag itself needs it: DDRAG carries the grabbed si/tok/dep, and every drop path
       (commitDrop → setDiagramHead / attachAsSharedConjunct / attachAsRaisedSubj / reorderByX) is addressed
       by those ids. A drop that COMMITS still selects what it edited — that is the edit's own result, not the
       gesture's, and each of those functions does it for itself. */
    if(edge && edge.getAttribute("data-dep")!=null){   // drag an edge/arc/label → re-head its dependent
      DDRAG={kind:"head",si:+edge.getAttribute("data-s"),dep:+edge.getAttribute("data-dep"),x0:e.clientX,y0:e.clientY,moved:false};
    } else if(node){                                    // drag a node onto another node → make that node its head
      DDRAG={kind:"node",si:+node.getAttribute("data-s"),tok:+node.getAttribute("data-tok"),x0:e.clientX,y0:e.clientY,moved:false};
    } else { const dia=target&&target.closest&&target.closest(".diagram"), blk=dia&&dia.closest(".sblock");   // empty diagram space → arm a marquee (committed on move, so a plain click still falls through to deselect)
      if(dia&&blk) MARQ={si:+blk.dataset.i,x0:e.clientX,y0:e.clientY,moved:false};
      return; }
    DLAST={kind:DDRAG.kind,si:DDRAG.si,tok:DDRAG.tok,dep:DDRAG.dep,x0:e.clientX,y0:e.clientY,t:Date.now()}; });   // snapshot the grab so a drag-lock second tap (whose own pointerdown WebKit may swallow) can still start a drag from a bare pointermove.  NB: no setPointerCapture here — capturing on pointerdown would retarget the follow-up click to #doc (WebKit), so plain clicks would stop selecting.  Capture on first move instead.
  docEl.addEventListener("pointermove",e=>{
    if(MARQ){ if(!(e.buttons&1)){ endMarquee(); return; }   // button released outside → abandon
      if(!MARQ.moved && Math.hypot(e.clientX-MARQ.x0,e.clientY-MARQ.y0)>4){ MARQ.moved=true; try{docEl.setPointerCapture(e.pointerId);}catch(_){}
        MARQ.div=document.createElement("div"); MARQ.div.className="marquee"; document.body.appendChild(MARQ.div); }
      if(MARQ.moved){ e.preventDefault(); updateMarquee(e); } return; }
    // Drag-lock ("double-tap to drag"): the held second tap moves the pointer, but WebKit often delivers no fresh
    // pointerdown for it (the first tap's pointerup already cleared DDRAG) — so resurrect the drag from the last grab
    // while the primary button is held (e.buttons&1 rules out plain hover-after-tap).  Harmless when pointerdown did fire.
    if(!DDRAG && (e.buttons&1) && draggable()){
      if(DLAST && Date.now()-DLAST.t<1500){
        DDRAG={kind:DLAST.kind,si:DLAST.si,tok:DLAST.tok,dep:DLAST.dep,x0:DLAST.x0,y0:DLAST.y0,moved:false}; }
      else {   // FIRST-LOAD: WebKit swallows the very first pointerdown after a fresh load, so the grab's pointerdown never ran and DLAST is still null — reconstruct the grab from the node/edge under the pointer so the first double-tap-drag reorders too
        const el=document.elementFromPoint(e.clientX,e.clientY), edge=ddEdge(el), node=ddNode(el);
        if(edge && edge.getAttribute("data-dep")!=null){ DDRAG={kind:"head",si:+edge.getAttribute("data-s"),dep:+edge.getAttribute("data-dep"),x0:e.clientX,y0:e.clientY,moved:false}; }
        else if(node){ DDRAG={kind:"node",si:+node.getAttribute("data-s"),tok:+node.getAttribute("data-tok"),x0:e.clientX,y0:e.clientY,moved:false}; }   // …and no pick() here either, for the stronger version of the reason above: this branch only ever runs from a pointermove with the button held, i.e. a gesture already known to be a DRAG
        if(DDRAG) DLAST={kind:DDRAG.kind,si:DDRAG.si,tok:DDRAG.tok,dep:DDRAG.dep,x0:e.clientX,y0:e.clientY,t:Date.now()}; } }
    if(!DDRAG)return;
    if(!DDRAG.moved && Math.hypot(e.clientX-DDRAG.x0,e.clientY-DDRAG.y0)>4){ DDRAG.moved=true; document.body.classList.add("dg-drag"); try{docEl.setPointerCapture(e.pointerId);}catch(_){} dragGhost(DDRAG,e); paintHeadCandidates(DDRAG); }
    if(DDRAG.moved){ e.preventDefault(); DDRAG.lastX=e.clientX; DDRAG.lastY=e.clientY; moveGhost(e); document.querySelectorAll("#doc .dtarget").forEach(n=>n.classList.remove("dtarget"));   // remember the live drop point → a pointercancel can still commit there
      const t=ddNode(document.elementFromPoint(e.clientX,e.clientY)), self=DDRAG.kind==="node"&&t&&+t.getAttribute("data-tok")===DDRAG.tok, overNode=t&&+t.getAttribute("data-s")===DDRAG.si&&!self;
      if(overNode){ const tid=+t.getAttribute("data-tok");   // a stemma draws a token as an upper node + a baseline word group — highlight both, so the transliteration under the baseline is covered too
        document.querySelectorAll(`#doc .node[data-s="${DDRAG.si}"][data-tok="${tid}"], #doc .tok-group[data-s="${DDRAG.si}"][data-tok="${tid}"], #doc .bwtok[data-s="${DDRAG.si}"][data-tok="${tid}"]`).forEach(n=>n.classList.add("dtarget")); }
      let overEdge=false;   // not over a node — hovering a conj edge (attach as shared conjunct) OR a subj/comp:obj/comp:obl/root edge (Subject-raising)? → highlight it as a valid drop target
      if(!overNode){ const fromId=DDRAG.kind==="head"?DDRAG.dep:DDRAG.tok, edgeEl=ddEdge(document.elementFromPoint(e.clientX,e.clientY));
        if(edgeEl && edgeEl.getAttribute("data-dep")!=null && +edgeEl.getAttribute("data-s")===DDRAG.si){
          const cd=+edgeEl.getAttribute("data-dep");
          if(cd!==fromId && (isConjDep(DDRAG.si,cd)||raiseMirror(DDRAG.si,fromId,cd))){ overEdge=true; edgeEl.classList.add("dtarget"); } } }   // isRaiseTargetDep is deliberately NOT a gate here — see raiseMirror's own note: the argument-onto-predicate direction was withdrawn, leaving the predicate-onto-argument one as the only raising drop   // …raiseMirror: dragging the PREDICATE onto an argument's edge highlights too, or the mirror gesture would give no sign it was going to work right up until the drop
      if(DDRAG.kind==="node"){ if(overNode||overEdge) clearCaret();   // hovering another node/conj edge → it becomes the head (no drop caret)
        else { const blk=document.querySelector(`.sblock[data-i="${DDRAG.si}"]`); if(blk)dropCaret(DDRAG.si,e.clientX,e.clientY,blk,DDRAG.tok); } } } });   // empty space → reorder: show where it would land
  function endDrag(e){ document.body.classList.remove("dg-drag"); clearGhost(); clearCaret();
    document.querySelectorAll("#doc .dtarget").forEach(n=>n.classList.remove("dtarget"));
    clearHeadCandidates();
    try{docEl.releasePointerCapture(e.pointerId);}catch(_){} }
  /* ── EVERY HEAD THE PARSER WEIGHED, LIT IN PROPORTION ───────────────────────────────────────────
     Starting to drag a token asks a question the pipeline has already answered and discarded: where
     could this attach? `tokenScores` (js/io/scores.js) hands back the candidate heads the parser
     actually put on the scales for this token and the mass it gave each, and they are washed with the
     accent at that strength — the same ink `.dtarget` uses for the node under the pointer, so the
     reader sees one visual language: "the parser's candidates" and, brighter, "the one you are on".

     ⚠ EXPECT ONE LIT NODE MOST OF THE TIME, and that is the honest answer rather than a thin feature.
     A trained parser is genuinely certain about a determiner's noun; the spread appears exactly where
     the ambiguity is (a PP's two attachment sites, a relativiser's two, a coordination's), which is
     where a reader is deciding something. Lighting every token in the sentence to make the feature
     look busier would mean inventing mass for attachments the model never entertained — see
     `analysis_scores` for why the alternatives really are zero and not merely pruned.

     Fire-and-forget: the fetch is one bridge call, usually already cached, and the drag is fully
     usable before it lands. The paint is dropped if the gesture ended first, or moved to another
     token, so a slow answer can never decorate the wrong drag. A root candidate is deliberately not
     drawn — there is no node to light, and the ghost already says what dropping in empty space does. */
  function clearHeadCandidates(){ document.querySelectorAll("#doc .pcand").forEach(n=>{ n.classList.remove("pcand"); n.style.removeProperty("--phl"); }); }
  function paintHeadCandidates(d){
    if(!d||typeof tokenScores!=="function") return;
    const si=d.si, child=d.kind==="head"?d.dep:d.tok; if(!(child>=1)) return;
    tokenScores(si).then(sc=>{
      if(!sc||!DDRAG||DDRAG!==d||!DDRAG.moved) return;   // the drag ended, or is now a different one
      const hs=sc.heads&&sc.heads[child-1]; if(!hs) return;
      Object.keys(hs).forEach(k=>{ const h=+k, p=scoreShade(hs[k]);
        if(!(h>=1)||!(p>0)) return;                      // "0" is root: no node to light
        document.querySelectorAll(`#doc .node[data-s="${si}"][data-tok="${h}"], #doc .tok-group[data-s="${si}"][data-tok="${h}"], #doc .bwtok[data-s="${si}"][data-tok="${h}"]`)
          .forEach(n=>{ n.classList.add("pcand"); n.style.setProperty("--phl",p.toFixed(3)); }); });
    }).catch(()=>{});
  }
  // Commit a finished node/edge drag at (clientX,clientY): drop onto a node → that node becomes the head; drop into
  // empty space → reorder to that x. Shared by pointerup AND pointercancel: with macOS "double-tap to drag" (drag-
  // lock) enabled, WebKit reclaims the gesture and fires pointercancel INSTEAD OF the committing pointerup, so the
  // reorder must still land from the cancel path (the caret already showed where) — otherwise the drop silently no-ops.
  /* ── A DROP DOES NOT SELECT ─────────────────────────────────────────────────────────────────────
     The commit functions below each end in a `pick()` of the token they moved, which is right when
     they are reached from a MENU or a keystroke — the reader named that token, so leaving it selected
     is the answer to what they asked. Reached from a DRAG it is not: pressing is not selecting (see
     the pointerdown above, which stopped picking for exactly this reason), and a drag that ends in a
     drop is still a press. Dropping a token onto another therefore lit up a token the reader had
     never selected, and with it the three-level subtree dimming the selection projects over its
     sentence — a whole sentence re-shaded as a side effect of moving one word.
     So the selection is captured here and put back afterwards, UNLESS the dragged token was already
     the selected one, in which case it stays selected and nothing has changed. Restored with
     reflow=false: the tree was just re-rendered by the commit itself, and this only has to re-assert
     which token wears the highlight. The `pick()`s inside the commit functions are left alone —
     they are correct for their other callers, and this is the one caller that differs. */
  async function commitDrop(d,clientX,clientY){
    DLAST=null;   // this grab is spent — don't let a later stray pointermove resurrect it
    DSUPPRESS=true; setTimeout(()=>DSUPPRESS=false,0);   // swallow the click that follows a drag
    const dragged=d.kind==="head"?d.dep:d.tok;
    const keepSel=(sel.s===d.si&&sel.t===dragged)?null:{s:sel.s,t:sel.t,rng:selRange};   // null ⇒ it WAS the selection; leave the commit's own pick standing
    const restore=()=>{ if(!keepSel)return;
      selRange=keepSel.rng;
      if(keepSel.s>=0&&keepSel.s<DOC.length) pick(keepSel.s,keepSel.t,false,false); else { sel={s:keepSel.s,t:keepSel.t}; applySel(); } };
    /* ⚠ AWAITED, and that `async` is the whole fix. Three of the four commit functions are async —
       `setDiagramHead` awaits `depIsError` before it writes anything, and its trailing `pick()` of the
       moved token therefore runs a microtask LATER. A synchronous `finally` restored the selection
       first and the commit's own pick then put it straight back, so the dragged token lit up exactly
       as before and this looked fixed while doing nothing. The restore has to be the last thing to
       run, which means waiting for the commit to finish. Nothing awaits `commitDrop` itself (the
       pointerup/pointercancel handlers are fire-and-forget) and nothing needs to: the restore is
       inside the chain. */
    try{ await _commitDrop(d,clientX,clientY); } finally { restore(); } }
  async function _commitDrop(d,clientX,clientY){
    const el=document.elementFromPoint(clientX,clientY), tgt=ddNode(el), onNode=tgt&&+tgt.getAttribute("data-s")===d.si;
    const fromId=d.kind==="head"?d.dep:d.tok;
    if(onNode){ const toId=+tgt.getAttribute("data-tok"); if(toId!==fromId) return setDiagramHead(d.si,fromId,toId); return; }   // edge/node dropped onto a node → that node becomes the head
    const edge=ddEdge(el);   // not onto a node — a conj edge dropped onto? → attach as a SHARED dependent of its later conjunct (item: drag onto a conj edge). A subj/comp:obj/comp:obl/root edge → Subject-raising instead.
    if(edge && edge.getAttribute("data-dep")!=null && +edge.getAttribute("data-s")===d.si){
      const edgeDepId=+edge.getAttribute("data-dep");
      if(edgeDepId!==fromId){
        if(isConjDep(d.si,edgeDepId)){ return attachAsSharedConjunct(d.si,fromId,edgeDepId); }
        /* THE PREDICATE dropped onto the ARGUMENT's own edge — the only raising direction there is. `fromId` is
           the predicate, `edgeDepId` the argument, which is why they go to attachAsRaisedSubj in that order
           (its first parameter is the ARGUMENT). Which feature is set comes from the zone released in; a release
           outside both zones is not a raising drop at all and falls through to the ordinary reorder below. */
        if(raiseMirror(d.si,fromId,edgeDepId)){ return attachAsRaisedSubj(d.si,edgeDepId,fromId); } } }   // …and the mirror: the PREDICATE dropped onto the argument's own edge. Same call, the two ids swapped — attachAsRaisedSubj's parameters are (argument, predicate) and the annotation it writes is identical either way. Second, so a drop that satisfies BOTH keeps the meaning it has today
    if(d.kind==="head") return;   // an edge drag that misses both a node and a valid attach target → no-op
    const blk=el&&el.closest&&el.closest(`.sblock[data-i="${d.si}"]`); if(blk) return reorderByX(d.si,d.tok,clientX,clientY,blk); }   // node into empty space → reorder to that x
  docEl.addEventListener("pointerup",e=>{ if(!DDRAG)return; const d=DDRAG; DDRAG=null; endDrag(e);
    // e.target is the actual element tapped (no pointer capture happened — that only kicks in once a drag starts
    // moving), which may be a .tr-edit/.gl-edit/goeswith part NESTED inside the node's group rather than the node
    // itself. Resolved HERE, before the pick() below: in brackets, pick() re-renders the whole block (see its own
    // conv==="brackets" branch), and these three must be read off the tree the user actually tapped.
    const trEl=e.target.closest?e.target.closest(".tr-edit"):null, glEl=e.target.closest?e.target.closest(".gl-edit"):null,
          gwEl=e.target.closest?e.target.closest("[data-gwtok]"):null;
    if(!d.moved){   // A PLAIN TAP — and the gesture is only NOW known to be one, which is why this is where the token gets selected (the grab itself no longer does it; see the pointerdown above). scroll=false still: the grid row is revealed by scrollNearest immediately below instead, which is the same reveal pick()'s scroll=true path would do
      const tapId=d.kind==="head"?d.dep:(gwEl?+gwEl.getAttribute("data-gwtok"):d.tok);   // a goeswith CONTINUATION selects ITSELF, not the head whose group it is drawn inside
      pick(d.si,tapId,false,false);
      scrollNearest(document.querySelector(`#doc tr[data-s="${d.si}"][data-tok="${tapId}"]`));
      if(d.kind==="node"){ DSUPPRESS=true; setTimeout(()=>DSUPPRESS=false,0);
        /* THE DOUBLE-TAP-FOR-LEMMA GESTURE WAS REMOVED. It opened the lemma editor on a second tap
           within 450 ms, which meant every ordinary re-click on a token you were already editing had to
           be told apart from it by a timer — and a gesture nothing on screen announces is one nobody
           discovers and everybody triggers by accident. ⌘L (Edit Lemma, app/menu_spec.py) does the
           same thing, says so in the menu, and needs no timer. */
        if(gwEl){ editNodeInline(d.si,tapTok,{x:e.clientX,y:e.clientY}); }   // a goeswith CONTINUATION's own form field, drawn inside the head's group — so d.tok (the group's data-tok) names the head, not the part actually tapped. Same shape as the .tr-edit/.gl-edit routing above: the group owns the drag, the tapped element decides which editor opens. The shared rows (translit/gloss/POS) carry no data-gwtok and so still edit the head, which is where the guideline puts every annotation anyway   (its own pick() is gone — the tap-branch pick above already resolved this id)
        else if(trEl) editTransInline(d.si,d.tok,{x:e.clientX,y:e.clientY});
        else if(glEl) editTier(d.si,d.tok,glEl.dataset.tier||"gloss",{x:e.clientX,y:e.clientY});
        else editNodeInline(d.si,d.tok,{x:e.clientX,y:e.clientY}); }
      return; }
    commitDrop(d,e.clientX,e.clientY); },true);
  docEl.addEventListener("pointerup",e=>{ if(!MARQ)return; const m=MARQ; endMarquee();   // item 1: finalise a marquee (its own listener so it never contends with the node/edge drag pointerup above)
    try{docEl.releasePointerCapture(e.pointerId);}catch(_){}
    if(m.moved){ DSUPPRESS=true; setTimeout(()=>DSUPPRESS=false,0);   // swallow the click that would otherwise deselect
      if(m.hits){ setRange(m.si,m.hits.min,m.hits.max); sel={s:m.si,t:m.hits.max}; UIZONE="diagram"; applyZone(); syncMenu(true); preserveScroll(renderDoc); }
      else { selRange=null; pick(m.si,0,false,false); } } },true);
  docEl.addEventListener("pointercancel",e=>{ if(MARQ){ endMarquee(); return; }
    if(!DDRAG)return; const d=DDRAG; DDRAG=null; endDrag(e);
    // A gesture the browser reclaimed. If it was a real drag (moved), still commit its drop at the last live point —
    // WebKit's drag-lock double-tap sends pointercancel in place of pointerup, and losing the reorder here is exactly
    // the "caret shows but the drop does nothing" bug. A cancelled plain tap (not moved) is dropped cleanly as before.
    if(d.moved) commitDrop(d, d.lastX!=null?d.lastX:e.clientX, d.lastY!=null?d.lastY:e.clientY); });
  // stemma/arcs/tree: nearest insertion slot, minus the slot just AFTER the dragged token (redundant with the one
  // just before it). Returns {to} (the reorder target index), {cx} (caret x) and {lTop,lBot} (the cursor's row band,
  // used to size the caret) — all derived from the SAME chosen slot, so the caret and the reorder stay in sync.
  function reorderGap(si,clientX,clientY,blk,dragTok){
    // WRAPPED stemma/hierarchy (projWrapped): the reorder targets are the baseline word groups in the scrollable
    // .wp-toks strip — NOT the tree .node points above (which sit at varied depths and span the whole, unwrapped
    // width, and would win the id-dedup because they come first in the DOM). Aim at that strip and treat it
    // line-aware, exactly like wrapped arcs.
    const wrapProj = !!blk.querySelector(".wrapproj");
    const lineAware = conv==="arcs" || wrapProj;
    const q = wrapProj ? `.wp-toks .tok-group[data-s="${si}"]` : DNODE_Q.replace(/\{s\}/g,si);
    const seen={}, nodes=[]; blk.querySelectorAll(q).forEach(nd=>{ const id=+nd.getAttribute("data-tok"); if(seen[id])return; seen[id]=1; const r=nd.getBoundingClientRect(); nodes.push({id,cx:r.left+r.width/2,cy:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bot:r.bottom}); });
    const N=nodes.length; if(!N)return null; const rtl=blk.dir==="rtl";
    // LINE-AWARE for WRAPPED views (arcs + projected stemma/hierarchy): the tokens spread over several rows, so a
    // plain x-sort scrambles reading order. Pick the row nearest the cursor (token boxes never overlap between rows →
    // cluster by centre-y), find the gap WITHIN it, and count whole rows above as reading-order-before. A single-row
    // view (flat stemma/tree, flat arcs) → line=all nodes, above=0 → identical to the old global left-to-right sort.
    let line, above=0;
    if(lineAware){ line=nodes.filter(nd=>clientY>=nd.top && clientY<=nd.bot);
      if(!line.length){ let nd=nodes[0]; nodes.forEach(g=>{ if(Math.abs(g.cy-clientY)<Math.abs(nd.cy-clientY))nd=g; }); line=nodes.filter(g=>g.cy>=nd.top && g.cy<=nd.bot); if(!line.length)line=[nd]; } }
    else line=nodes;
    const lTop=Math.min(...line.map(g=>g.top)), lBot=Math.max(...line.map(g=>g.bot));
    if(lineAware) above=nodes.filter(g=>g.cy<lTop).length;   // whole rows above the cursor's row → all earlier in reading order
    const row=line.slice().sort((a,b)=>a.cx-b.cx), m=row.length;
    const k=row.findIndex(nd=>nd.id===dragTok), skip=k<0?-1:(rtl?k:k+1);   // reading-after slot index (redundant with the one before)
    const gx=g=> g===0?row[0].left-5 : g===m?row[m-1].right+5 : (row[g-1].right+row[g].left)/2;
    let bg=-1,bd=Infinity; for(let g=0;g<=m;g++){ if(g===skip)continue; const d=Math.abs(gx(g)-clientX); if(d<bd){bd=d; bg=g;} }
    if(bg<0)return null;
    // reorder target index = number of tokens before the gap in reading order. Token ids ARE contiguous reading order,
    // so read it straight off the token flanking the gap (LTR: the one to the reading-left = row[bg-1]; RTL: reading-left = row[bg]).
    // This is immune to the dragged token's node being present or absent in the DOM query — the old above+bg count went
    // one short (token landed one slot early) whenever the dragged node was missing from a wrapped row above the cursor.
    const to = rtl ? (bg===m?0:row[bg].id) : (bg===0?0:row[bg-1].id);
    return {cx:gx(bg), to, lTop, lBot}; }
  // brackets: nearest gap BETWEEN two adjacent glyphs (bracket or token), inside the outermost brackets, minus the
  // gap just after the dragged token
  function bracketDropSlot(si,clientX,clientY,blk,dragTok){
    let all=[], brs=[], toks=[]; const seen={};
    blk.querySelectorAll(`.brk[data-s="${si}"], .bwbr[data-s="${si}"], .tok-group[data-s="${si}"], .bwtok[data-s="${si}"]`).forEach(el=>{
      const r=el.getBoundingClientRect(), br=el.classList.contains("brk")||el.classList.contains("bwbr"), id=br?null:+el.getAttribute("data-tok");
      if(!br){ if(seen[id])return; seen[id]=1; }
      const g={cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,left:r.left,right:r.right,top:r.top,bot:r.bottom,br,close:br&&/[\])}⟩>]/.test((el.textContent||"").trim()),tok:id}; all.push(g); if(br)brs.push(g); else toks.push(g); });
    if(all.length<2||!brs.length||!toks.length)return null;
    // LINE = the token ROW nearest the cursor. A token box spans deprel→form→POS (tall) and never overlaps between
    // rows, so the tokens — not the small, high bracket glyphs — define a row's vertical band. The caret x, the caret
    // height AND the before-count are all decided against THIS band, so they can never disagree across wrapped rows.
    let line=toks.filter(g=>clientY>=g.top && clientY<=g.bot);
    if(!line.length){ let nd=toks[0]; toks.forEach(g=>{ if(Math.abs(g.cy-clientY)<Math.abs(nd.cy-clientY))nd=g; }); line=toks.filter(g=>g.cy>=nd.top && g.cy<=nd.bot); if(!line.length)line=[nd]; }
    const lTop=Math.min(...line.map(g=>g.top)), lBot=Math.max(...line.map(g=>g.bot)), onLine=g=>g.cy>=lTop&&g.cy<=lBot;   // a glyph is on this row if its centre sits in the token band
    let glyphs=all.filter(onLine); if(glyphs.length<2)glyphs=all.slice();
    glyphs.sort((a,b)=>a.cx-b.cx);
    const rtl=blk.dir==="rtl", k=glyphs.findIndex(g=>g.tok===dragTok), skip=new Set();   // gaps that must NOT accept the caret: the one just after the dragged token, PLUS the one after each closing bracket that immediately follows it (dropping there is the same reading position as after the token)
    if(k>=0){ if(rtl){ skip.add(k-1); if(glyphs[k-1]&&glyphs[k-1].close) skip.add(k-2); if(glyphs[k+1]&&glyphs[k+1].br&&!glyphs[k+1].close) skip.add(k); }
              else { skip.add(k); if(glyphs[k+1]&&glyphs[k+1].close) skip.add(k+1); if(glyphs[k-1]&&glyphs[k-1].br&&!glyphs[k-1].close) skip.add(k-1); } }   // bar: the gap just after the dragged token, the gap after the ONE closing bracket immediately following it, AND the gap after an open bracket immediately PRECEDING it — all the same reading position as the token's own slot
    let cx=null,bd=Infinity;
    for(let i=0;i<glyphs.length-1;i++){ if(skip.has(i))continue; const g=(glyphs[i].right+glyphs[i+1].left)/2, d=Math.abs(g-clientX); if(d<bd){bd=d; cx=g;} }   // gap = between the glyphs' facing EDGES (a long word's centre is far from its edge)
    if(cx==null)return null;
    // tokens BEFORE the drop in reading order = the reorder target index: whole rows above, then, within this row,
    // those on the reading-before side of the caret. Reading order = surface order = token-id order (DOM order too).
    // tokens before the caret in reading order = the reorder target index. Read it from token IDS (contiguous reading
    // order), not by counting DOM token nodes: the reading-latest token still before the caret has id = that count, and
    // whole rows above are covered by (min id on this row − 1). Immune to a dragged/absent node shifting it by one.
    const lineTk=toks.filter(onLine), beforeSide=lineTk.filter(g=> rtl?g.cx>cx:g.cx<cx);
    let before = beforeSide.length ? Math.max(...beforeSide.map(g=>g.tok)) : (lineTk.length ? Math.min(...lineTk.map(g=>g.tok))-1 : 0);
    const lineBrs=brs.filter(onLine), pool=lineBrs.length?lineBrs:brs;
    let ref=pool[0],rbd=Infinity; pool.forEach(b=>{ const d=Math.abs(b.cx-cx); if(d<rbd){rbd=d; ref=b;} });   // hug the nearest bracket on this row → the caret takes just its height
    return {cx, top:ref.top, bot:ref.bot, before}; }
  // item 2: dropping a token onto the caret JUST BEFORE its own current position is otherwise a dead no-op (the
  // reorder would leave it exactly where it already is) — repurposed as the Generic-subject toggle gesture for a
  // VERB/AUX predicate (attachGenericSubj checks the UPOS itself; any other token still just no-ops, as before).
  function reorderByX(si,tok,clientX,clientY,blk){
    if(conv==="brackets"){ const slot=bracketDropSlot(si,clientX,clientY,blk,tok); if(!slot||slot.top==null)return;
      if(slot.before===tok-1){ attachGenericSubj(si,tok); return; }
      reorderToken(si, tok-1, slot.before); return; }   // slot.before = tokens before the drop in reading order (line-aware) = the reorder target index
    const r=reorderGap(si,clientX,clientY,blk,tok); if(!r)return;
    if(r.to===tok-1){ attachGenericSubj(si,tok); return; }
    reorderToken(si, tok-1, r.to); }
  // a floating clone of the dragged word that follows the cursor, plus a caret at the prospective drop slot
  function dragGhost(d,e){ let txt, rel=null; if(d.kind==="head"){ const dep=DOC[d.si]&&DOC[d.si].tokens[d.dep-1]; txt=(dep&&dep.deprel)||"dep"; rel=dep&&dep.deprel; }   // dragging a relation → show its label
      else { const src=DOC[d.si]&&DOC[d.si].tokens[d.tok-1]; txt=(src&&src.form)||"•"; }
    const g=document.createElement("div"); g.className="dg-ghost"+(d.kind==="head"?" dg-ghost-rel":""); g.textContent=txt;
    if(rel!=null) g.style.color=relColor(rel);   // same colour as the relation's diagram label
    document.body.appendChild(g); DGHOST=g; moveGhost(e); }
  function moveGhost(e){ if(DGHOST){ DGHOST.style.left=e.clientX+"px"; DGHOST.style.top=e.clientY+"px"; } }
  function clearGhost(){ if(DGHOST){ DGHOST.remove(); DGHOST=null; } }
  function clearCaret(){ if(DCARET){ DCARET.remove(); DCARET=null; } }
  function dropCaret(si,clientX,clientY,blk,dragTok){
    let cx,top,bot;
    if(conv==="brackets"){ const slot=bracketDropSlot(si,clientX,clientY,blk,dragTok); if(!slot||slot.top==null){ clearCaret(); return; } cx=slot.cx; top=slot.top; bot=slot.bot; }
    else { const wrapProj=!!blk.querySelector(".wrapproj"), lineAware=conv==="arcs"||wrapProj;
      const gap=reorderGap(si,clientX,clientY,blk,dragTok); if(!gap){ clearCaret(); return; } cx=gap.cx;
      // vertical extent = the token row ONLY (word glyphs → POS tags), never the arcs/tree above or the tall hit rect.
      // For WRAPPED views (arcs + projected stemma/hierarchy), constrain to the SINGLE row nearest the cursor
      // (gap.lTop/lBot) — matching the unwrapped one-row case — so the caret hugs the visible token row only.
      const inRow=el=>{ if(!lineAware)return true; const r=el.getBoundingClientRect(), c=(r.top+r.bottom)/2; return c>=gap.lTop && c<=gap.lBot; };
      const words=[...blk.querySelectorAll(".diagram .tok-word, .diagram .baseword")].filter(inRow);
      if(words.length){ const lows=[...blk.querySelectorAll(".diagram .tok-pos, .diagram .translit")].filter(inRow);
        top=Math.min(...words.map(w=>w.getBoundingClientRect().top));
        bot=Math.max(...(lows.length?lows:words).map(e=>e.getBoundingClientRect().bottom));
        if(wrapProj){ const labs=[...blk.querySelectorAll(".wp-toks .lbl")].filter(inRow);   // wrapped stemma/hierarchy: the deprel labels sit ABOVE the tokens in this row — reach the caret up to them (measured live, so it stays right as the renderer tunes the label spacing) so it connects to the labelled row instead of stubbing at the word
          if(labs.length) top=Math.min(top, ...labs.map(l=>l.getBoundingClientRect().top)); } }
      else { const seen={}, rs=[]; blk.querySelectorAll(DNODE_Q.replace(/\{s\}/g,si)).forEach(nd=>{ const id=+nd.getAttribute("data-tok"); if(seen[id])return; seen[id]=1; rs.push(nd.getBoundingClientRect()); });
        if(!rs.length){ clearCaret(); return; } top=Math.min(...rs.map(r=>r.top)); bot=Math.max(...rs.map(r=>r.bottom)); }
      if(clientY < top-8 || clientY > bot+8){ clearCaret(); return; } }   // only show while the cursor is in the token row
    if(!DCARET){ DCARET=document.createElement("div"); DCARET.className="dg-caret"; document.body.appendChild(DCARET); }
    DCARET.style.left=cx+"px"; DCARET.style.top=top+"px"; DCARET.style.height=Math.max(12,bot-top)+"px"; }
  docEl.addEventListener("click",e=>{ if(DSUPPRESS){ e.stopPropagation(); e.preventDefault(); DSUPPRESS=false; } },true);
})();

