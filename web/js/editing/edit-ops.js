//@module js/edit-ops.js
/* THE LOCAL, MODEL-FREE TOKENISER: whitespace, and NO annotation whatsoever. Every real analysis comes from the
   parser (js/io/bridge.js's applySentText → api.tokenize + api.parse_text); this runs only where there is no model
   to ask, or no bridge to run one. It deliberately guesses NOTHING, because a guessed annotation written into the
   document is indistinguishable from a real one: an untouched token has to LOOK untouched.
   It used to call an `annotate()` that read DET off /^(the|a|an)$/, AUX off /^(is|are|was|…)$/, PROPN off an
   initial capital and NOUN off everything else, then fabricated a head + deprel around a guessed root — an ENGLISH
   function-word lexicon applied to Sanskrit, Literary Chinese, Arabic, Japanese and Korean treebanks, and reached
   only when a model WAS set, i.e. precisely when a real parse was available. Deleted; don't reintroduce anything
   of the kind. (Its `punctSplit` companion went with it: splitting on `[.,;:!?]` is a Latin-punctuation rule that
   says nothing about a daṇḍa or 。、！, and with no model there is nothing to feed pre-split tokens to anyway.)
   The one structural thing kept is the flat skeleton — token 1 head 0 `root`, the rest head 1 with an EMPTY deprel
   — and it is NOT this file's invention: it is the shared contract for an unparsed sentence, app/parse.py's
   `whitespace_tokens`, which is what the bridge itself puts in the document whenever a parse is unavailable, so
   the two halves have to agree. It is also the only form the app can work with. io_conllu writes an empty HEAD as
   `_`; validation.js reads that back as an INVALID head on every token plus "No root", so a headless table would
   report a file the user simply hasn't annotated yet as broken — and a token with no head has no arc to grab and
   drag onto one. UPOS, LEMMA, FEATS and every non-root DEPREL stay empty, which validation flags as merely
   missing: the honest description of a token nothing has analysed. */
function wsTok(text){return text.trim().split(/\s+/).filter(Boolean);}
function buildTokens(text){ const s=text.trim(); if(!s) return [tok("","","","","",0,"root")];
  return wsTok(text).map((f,j)=>tok(f,"","","","",j===0?0:1,j===0?"root":"")); }

/* sentence ops */
// auto-numbering: continue the preceding sentence's trailing number (keeping its zero-padding);
// if the new ID collides with the following sentence, ripple-bump that one (and onwards) as needed
function _trailingNum(sid){ const m=/^([\s\S]*?)(\d+)$/.exec(sid||""); return m?{prefix:m[1],digits:m[2]}:null; }
function bumpSid(sid){ const t=_trailingNum(sid); if(!t)return null; return t.prefix+String(parseInt(t.digits,10)+1).padStart(t.digits.length,"0"); }
function autoInsertSid(index){ if(!AUTONUM) return "s"+(DOC.length+1);   // auto-numbering off → a plain fresh id
  const prev=index>0?DOC[index-1]:null, p=prev&&bumpSid(prev.sid); return p || ("s"+(DOC.length+1)); }   // continue from the sentence above; fall back to a fresh sN
function cascadeSids(from){ if(!AUTONUM) return; for(let i=from;i<DOC.length-1;i++){ if(DOC[i].sid!==DOC[i+1].sid) break; const b=bumpSid(DOC[i+1].sid); DOC[i+1].sid=b||(DOC[i+1].sid+"-1"); } }   // only touches genuine duplicates, rippling forward
// after deleting the sentence with id `delSid` (the sentence at `i` has now shifted up into its place): if the run
// below continued its numbering, shift that run down by one so the sequence stays continuous (no gap where it was)
function renumberAfterDelete(i,delSid){ let target=delSid, expected=bumpSid(delSid);
  for(let j=i; j<DOC.length && expected!=null; j++){ if(DOC[j].sid!==expected) break;
    DOC[j].sid=target; target=expected; expected=bumpSid(expected); } }
function insertAt(index){ if(hasBridge()){ try{ window.pywebview.api.open_insert_window(index, model?(MODELINFO[model]||model):""); return; }catch(e){} } openSheet(sheetInsert(index)); }   // item 23/24: Insert-text native window; sheet is the headless fallback
function doInsert(index,text){ pushUndo(); const sid=autoInsertSid(index), tokens=buildTokens(text);
  DOC.splice(index,0,{sid,text:text.trim(),tokens}); cascadeSids(index); sel={s:index,t:1};
  morphAfterReparse(DOC[index]);   // the new tokens carry no MSeg/MGloss — seed the morphemic tiers the same way every other sentence got them (no FEATS here, so MSeg seeds from the forms and MGloss stays empty), inside this same undo step
  refresh();
  // …and the toast says what actually ran. This branch is reached ONLY with no model or no bridge, so nothing was
  // parsed: it used to claim "Parsed locally · <model> · SUD" whenever a model was merely selected, which was the
  // deleted annotate() heuristic's output being passed off as that model's analysis.
  toast(model?"Inserted · whitespace tokeniser (the parser runs in the desktop app)":"Inserted · whitespace tokeniser, no annotation");
  const b=document.querySelector(`.sblock[data-i="${index}"]`); if(b)b.scrollIntoView({block:"center",behavior:"smooth"}); }
/* dupSent() was here — "Duplicate" (⌘D), removed along with its block control, its native menu item and its
   window binding. Recorded rather than silently dropped: it cloned a sentence wholesale, appended "-copy" to the
   sid and cleared the two boundary markers (copying those would have opened a document or paragraph in the middle
   of the one being copied from). ⌘D is now free; ⇧⌘D toggles a document boundary, which is what the slot went to. */
// `reparse(i)` — "Reset parse" / ⌘R — lives in js/io/bridge.js, because re-parsing a sentence and committing an
// edited `# text` are ONE operation (replace a sentence's tokens from a string) and now share one body there,
// applySentText. It used to be defined here as a local, model-free re-tokenisation that bridge.js then WRAPPED,
// and the two copies drifted: the wrapper never re-seeded the morphemic tiers, so a re-parse left MSeg/MGloss
// empty while re-typing the same text through commitSentText filled them.
function moveSent(from,to){ if(to<0||to>DOC.length)return; pushUndo(); if(from<to)to--; const [m]=DOC.splice(from,1); DOC.splice(to,0,m); sel={s:DOC.indexOf(m),t:sel.t}; refresh(); }
function delSent(i){ pushUndo(); const delSid=DOC[i]&&DOC[i].sid; DOC.splice(i,1);
  if(AUTONUM) renumberAfterDelete(i,delSid);   // keep the numbering continuous across the deletion
  sel=DOC.length?{s:Math.min(i,DOC.length-1),t:1}:{s:-1,t:0}; refresh(); }

/* token ops with id renumber + head fix-up */
function insertToken(si,pos){ pushUndo(); const s=DOC[si], toks=s.tokens;
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); if(!isNaN(h)&&h>=pos+1) t.head=String(h+1);});
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to); });   // component tokens by identity
  toks.splice(pos,0,tok("","","X","","",0,"root"));   // sensible defaults (UPOS X, head 0 = root, so deprel "root" to match)
  remapMWT(s,toks);   // renumber onto the original components → an edge insert stays outside the MWT
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // every token survives an insert, so nothing is dropped — the ids after `pos` simply move up, and DEPS / empty-node anchors move with them
  sel={s:si,t:pos+1}; refresh(); }
/* ── RE-INDEXING WHAT THE HEAD COLUMN ISN'T ────────────────────────────────────────────────────────────────────
   Three things carry token ids besides `head`, and no structural edit used to touch any of them:
     · a token's DEPS — the enhanced graph, "3:nsubj|5.1:comp:obj". Authoritative whenever it came from a file:
       depsAutofill (js/io/bridge.js) only ever fills a "_", and never rewrites a real one.
     · an EMPTY NODE's anchor — `after`, the id of the token it follows.
     · that same anchor spelled inside the empty node TWICE MORE — its own decimal id ("3.1") and column 0 of the
       raw line it was read from, which is what io_conllu re-emits verbatim.
   This is the ONE place any of it is done, so the ops that call it cannot drift apart about the same file.
   `map` is oldId → newId, null meaning the token is gone.
   EMPTY NODE IDS ARE RENUMBERED FROM SCRATCH rather than patched. A merge maps several old anchors onto one
   survivor, so "3.1" and "4.1" would both want to be "3.1"; grouping by the NEW anchor and counting from 1 in
   list order is collision-free by construction, and a sentence with no empty nodes never enters the branch. */
function remapTokenRefs(s,map){
  const es=s.empties||[], eids=new Map();   // old empty id → new empty id, for the DEPS pass below
  if(es.length){ const seen={};
    es.forEach(e=>{ const a=parseInt(e.after,10), a0=isNaN(a)?0:a;
      let na=(a0===0)?0:map.get(a0);
      if(na==null){ na=0; for(let k=a0-1;k>=1;k--){ const m=map.get(k); if(m!=null){ na=m; break; } } }   // the anchor token is gone → re-anchor to the nearest surviving one before it (0 = ahead of the first token, which is a legal anchor)
      e.after=na;
      const nid=na+"."+(seen[na]=(seen[na]||0)+1);
      if(e.id!=null) eids.set(String(e.id),nid);
      e.id=nid; if(e._cols) e._cols[0]=nid; }); }
  const remapOne=ref=>{                                   // one DEPS head: an integer token id, or a decimal empty-node id
    if(/^\d+$/.test(ref)){ const v=parseInt(ref,10); if(v===0) return "0";   // 0 is the root, not a token
      const n=map.get(v); return n==null?null:String(n); }
    if(/^\d+\.\d+$/.test(ref)) return eids.has(ref)?eids.get(ref):null;
    return ref; };                                        // anything else is malformed and passes through rather than being silently dropped
  const remapDeps=deps=>{ if(!deps||deps==="_") return deps;
    const out=deps.split("|").map(p=>{ const i=p.indexOf(":"); if(i<0) return p;   // no relation part → not an id we can read; leave it
      const h=remapOne(p.slice(0,i)); return h==null?null:h+p.slice(i); }).filter(Boolean);   // an enhanced arc FROM a node that no longer exists goes with it
    return out.length?out.join("|"):"_"; };
  s.tokens.forEach(t=>{ t.deps=remapDeps(t.deps); });
  es.forEach(e=>{ if(!e._cols) return;
    if(/^\d+$/.test(e._cols[6]||"")){ const n=remapOne(e._cols[6]); e._cols[6]=(n==null)?"_":n; }   // an empty node normally carries "_" in HEAD (its relations live in DEPS), but remap it where a file put an id there
    e._cols[8]=remapDeps(e._cols[8]); }); }
/* Old id → new id by IDENTITY: snapshot before the mutation, resolve after it, so any splice or reorder is
   covered without arithmetic. `gone` supplies the id that vanished tokens fold INTO — null for a deletion
   (the reference dies with the node), the survivor for a merge (the node is fused, not removed). */
function idMapAfter(oldIds,toks,gone){ const map=new Map();
  oldIds.forEach((id,t)=>{ const j=toks.indexOf(t); map.set(id, j<0?(gone===undefined?null:gone):j+1); });
  return map; }
// re-number MWT ranges onto their surviving components; a range left with fewer than two is no longer one
function remapMWT(s,toks){ if(!s.mwt) return;
  s.mwt=s.mwt.map(m=>{ const ix=[...new Set(m._toks.map(x=>toks.indexOf(x)).filter(i=>i>=0))].sort((a,b)=>a-b); delete m._toks;
    if(ix.length<2) return null; m.from=ix[0]+1; m.to=ix[ix.length-1]+1; return m; }).filter(Boolean);
  if(!s.mwt.length) delete s.mwt; }
function deleteToken(si,idx){ const s=DOC[si]; if(s.tokens.length<=1)return toast("Keep at least one token"); pushUndo();
  const toks=s.tokens, del=idx+1;
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to); });   // ranges by identity — this op alone used to skip the step every other structural edit here takes, so deleting a token before or inside a range left its endpoints pointing at the wrong tokens
  toks.splice(idx,1);
  toks.forEach(t=>{let h=parseInt(t.head,10); if(isNaN(h))return; if(h===del)t.head="0"; else if(h>del)t.head=String(h-1);});
  remapMWT(s,toks);
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // DEPS + empty nodes; the deleted token's own references die with it
  sel={s:si,t:Math.max(1,idx)}; refresh(); }
/* MERGE — the destructive repair for a word the TOKENISER split where no boundary exists. n adjacent tokens
   become ONE whose form is their concatenation, and the seams go away entirely.
   THREE THINGS IN THIS APP ADDRESS THE SAME MISTAKE and none of the others is this one: `goeswith` (validation.js)
   ANNOTATES the split, keeping both tokens and relating them, which is what UD asks for when the file's own text
   contains the stray space; an MWT (addMWT) keeps the components and lays ONE surface form over them, for a split
   that is real but sub-lexical; merge is for a split that has no business being in the file at all, and it is the
   only one of the three that loses data — hence its own command rather than a mode of those.
   The identity dance below is flattenMWT's, in shape verbatim: heads are remembered BY IDENTITY so the splice can
   renumber them positionally afterwards, the survivor inherits the component attached OUTSIDE the range (or to
   root), and every dependent of a consumed component re-points to the survivor.
   DEPS and the empty nodes go through remapTokenRefs above, the same call deleteToken makes — consumed
   components fold INTO the survivor there rather than dying, because a merge fuses nodes and does not remove
   them, so an enhanced arc into one of them still has somewhere to land. */
function mergeTokens(si,from,to){ const s=DOC[si]; if(!s)return; const toks=s.tokens;
  if(!(to>from)||from<1||to>toks.length) return toast("Select two or more adjacent tokens to merge");
  if(!isSpacelessLang()) return toast("Merging is for languages written without spaces — use a goeswith relation instead");   // guarded HERE too, not just on the menu rows: this is the one entry point every caller shares
  pushUndo();
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});   // heads by identity
  const comps=toks.slice(from-1,to), compSet=new Set(comps);
  const head=comps.find(t=>t._ht===0||!compSet.has(t._ht))||comps[0];   // the component attached OUTSIDE the range (or to root) — the same "which one survives" rule flattenMWT applies
  const survivor={...head, form:comps.map(t=>t.form).join("")};   // concatenation, as addMWT builds an MWT's surface form. No separator: a merge asserts there was no boundary
  survivor._ht=head._ht;
  if(head.lemma===head.form) survivor.lemma=survivor.form;   // the lemmatiser had nothing to say about the fragment, so it has nothing to say about the whole — carry the new form across rather than leave "e" lemmatising "e-mail". A lemma that DIFFERED from its form is real analysis: it stays, for the annotator to check
  survivor.misc=setMiscKV(head.misc,"SpaceAfter", spaceAfterNo(comps[comps.length-1])?"No":"");   // SpaceAfter is a fact about the gap AFTER the token → it comes from the LAST component; the seams' own SpaceAfter=No vanish with the seams they described
  survivor.misc=setMiscKV(setMiscKV(survivor.misc,"Translit",""),"LTranslit","");   // a romanisation of the FRAGMENT says nothing about the whole word (afterFormEdit drops these on a form edit for exactly this reason)
  survivor.translit=""; survivor.translitLemma=""; survivor.ortho=""; survivor._trMisc=false; survivor._trPick=false;
  toks.forEach(t=>{ if(compSet.has(t._ht)) t._ht=survivor; });   // dependents of any consumed component re-point to the survivor
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to).map(x=>compSet.has(x)?survivor:x); });   // …and so does an MWT that CONTAINED them, so a surrounding range survives the merge rather than being dropped for having lost its members
  toks.splice(from-1,to-from+1,survivor);
  toks.forEach(t=>{ t.head=t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  remapMWT(s,toks);   // a range the merge collapsed onto ONE token is not a multi-word token any more, and remapMWT drops it
  remapTokenRefs(s,idMapAfter(oldIds,toks,from));   // `from` is the survivor's id: every consumed component's DEPS references and empty-node anchors fold onto it
  if(survivor.deps&&survivor.deps!=="_"){ const kept=survivor.deps.split("|").filter(p=>{ const i=p.indexOf(":"); return i<0||p.slice(0,i)!==String(from); });
    survivor.deps=kept.length?kept.join("|"):"_"; }   // …which can leave a SELF-LOOP where one consumed component had an enhanced arc to another. It described a relation inside a word that no longer has an inside
  /* `# text` is deliberately NOT respliced, though afterFormEdit would on an ordinary form edit: the tokeniser
     split a string the file spells correctly, so the running sentence still says exactly what it said. And
     afterFormEdit's other half — a background re-parse of the edited token — is the one operation guaranteed to
     split the survivor straight back apart. The transliteration caches cleared above refill on the render below. */
  const n=to-from+1;
  markDirty(); selRange=null; sel={s:si,t:from}; preserveScroll(renderDoc);
  if(typeof pick==="function") pick(si,from,false);
  if(show.translit&&typeof fillTranslit==="function") fillTranslit();
  toast(`${n} tokens merged into one — check its lemma and features`); }
window.mergeTokensShortcut=function(){ if(sel.s<0) return;
  if(!isSpacelessLang()) return toast("Merging is for languages written without spaces — use a goeswith relation instead");
  if(selRange&&selRange.s===sel.s&&selRange.to>selRange.from) mergeTokens(sel.s,selRange.from,selRange.to);
  else toast("Select two or more tokens (shift-click their id cells) to merge"); };
function reorderToken(si,from,to){ const s=DOC[si],toks=s.tokens; if(from===to||from===to-1)return; pushUndo();
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});
  (s.mwt||[]).forEach(mm=>{ mm._toks=toks.slice(mm.from-1,mm.to); });   // remember each MWT's component tokens by identity
  const [m]=toks.splice(from,1); let t2=to>from?to-1:to; toks.splice(t2,0,m);
  toks.forEach(t=>{ t.head = t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  remapMWT(s,toks);   // re-number endpoints onto the displaced components
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // a move drops nothing, so an empty node simply travels with the token it was anchored to
  sel={s:si,t:t2+1}; refresh(); toast("Reordered tokens"); }
// move a contiguous block [gfrom..gto] (0-based) — an MWT and its component tokens — to drop index `to`
function reorderTokenGroup(si,gfrom,gto,to){ const s=DOC[si],toks=s.tokens; if(to>=gfrom && to<=gto+1)return; pushUndo();
  const oldIds=new Map(); toks.forEach((t,i)=>oldIds.set(t,i+1));
  toks.forEach(t=>{const h=parseInt(t.head,10); t._ht=(h>=1&&h<=toks.length)?toks[h-1]:0;});   // heads by identity
  (s.mwt||[]).forEach(m=>{ m._toks=toks.slice(m.from-1,m.to); });                               // MWT ranges by identity
  const block=toks.splice(gfrom,gto-gfrom+1), ins=to>gto?to-block.length:to; toks.splice(ins,0,...block);
  toks.forEach(t=>{ t.head=t._ht===0?"0":String(toks.indexOf(t._ht)+1); delete t._ht; });
  remapMWT(s,toks);
  remapTokenRefs(s,idMapAfter(oldIds,toks));   // as reorderToken: the whole block moves, nothing is dropped
  sel={s:si,t:ins+1}; preserveScroll(renderDoc); toast("Moved multi-word token"); }
// the set of token ids in `tokId`'s subtree (following heads downward) — candidate heads exclude these to avoid cycles
function descendantsOf(toks,tokId){ const kids={}; toks.forEach((t,i)=>{ const h=parseInt(t.head,10); (kids[h]=kids[h]||[]).push(i+1); });
  const out=new Set(); (function go(x){ (kids[x]||[]).forEach(c=>{ if(!out.has(c)){ out.add(c); go(c); } }); })(tokId); return out; }
// move a token one slot toward the left/right of the diagram (dir<0 = left) — reading-order- and RTL-aware
function moveTokenSpatial(si,tokId,dir){ const s=DOC[si]; if(!s)return; const idx=tokId-1, n=s.tokens.length, earlier=(dir<0)!==sentRTL(s);
  if(earlier){ if(idx<=0)return toast("Already at the edge"); reorderToken(si,idx,idx-1); }
  else { if(idx>=n-1)return toast("Already at the edge"); reorderToken(si,idx,idx+2); } }
// move a token one slot earlier/later in token order (delta<0 = up in the grid) — no RTL flip, since grid rows run in id order
function moveTokenIndex(si,tokId,delta){ const s=DOC[si]; if(!s)return; const idx=tokId-1, n=s.tokens.length;
  if(delta<0){ if(idx<=0)return toast("Already at the edge"); reorderToken(si,idx,idx-1); }
  else { if(idx>=n-1)return toast("Already at the edge"); reorderToken(si,idx,idx+2); } }
// make `tokId` the root: the old root and everything that hung off it re-attach to the new root, which then anchors the sentence
function setAsRoot(si,tokId){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return; const toks=s.tokens, xt=toks[tokId-1];
  if(parseInt(xt.head,10)===0 && depBase(xt.deprel)==="root")return toast("Already the root");
  const oldRoot=toks.findIndex(t=>parseInt(t.head,10)===0)+1;   // 1-based (0 = none)
  pushUndo();
  toks.forEach((t,i)=>{ const id=i+1; if(id===tokId)return; if(parseInt(t.head,10)===oldRoot){ t.head=String(tokId); syncSharedFeat(t,s); } });   // migrate the old root's dependents onto the new root
  if(oldRoot && oldRoot!==tokId){ const or=toks[oldRoot-1]; or.head=String(tokId); syncSharedFeat(or,s); if(depBase(or.deprel)==="root")or.deprel=withDepBase(or.deprel,"udep"); }   // the old root now hangs off the new one
  xt.head="0"; syncSharedFeat(xt,s); xt.deprel=withDepBase(xt.deprel,"root");
  // Task B: no regenTok — re-rooting is purely structural and must never trigger a gloss/MGloss recompute (see
  // the matching note on setDiagramHead, js/diagram/diagram-edit.js).
  markDirty(); sel={s:si,t:tokId}; preserveScroll(renderDoc); pick(si,tokId,false); toast(`Token ${tokId} is now the root`); }
// re-attach `tokId` to the previous/next valid head in token order (dir<0 = previous) — skips itself and its own subtree
function stepHead(si,tokId,dir){ const s=DOC[si]; if(!s||tokId<1||tokId>s.tokens.length)return; const toks=s.tokens, dep=toks[tokId-1];
  if(depBase(dep.deprel)==="root")return toast("The root has no head");
  const desc=descendantsOf(toks,tokId), cands=[]; for(let id=1;id<=toks.length;id++){ if(id===tokId||desc.has(id))continue; cands.push(id); }
  if(!cands.length)return toast("No other token to attach to");
  const h=parseInt(dep.head,10); let i=cands.indexOf(h), ni;
  if(i<0) ni=dir>0?0:cands.length-1;   // currently rootless/self → step in from the near end
  else { ni=i+dir; if(ni<0||ni>=cands.length)return toast(dir>0?"Already the last candidate head":"Already the first candidate head"); }
  pushUndo(); dep.head=String(cands[ni]); afterHeadEdit(dep,s);   // Task B: no regenTok — same as setAsRoot above
  markDirty(); sel={s:si,t:tokId}; preserveScroll(renderDoc); pick(si,tokId,false); toast(`Head of token ${tokId} → ${cands[ni]}`); }
// selection-driven wrappers for the keyboard shortcuts / Edit menu
window.moveTokenLeft=()=>{ if(sel.s>=0&&sel.t>0)moveTokenSpatial(sel.s,sel.t,-1); };
window.moveTokenRight=()=>{ if(sel.s>=0&&sel.t>0)moveTokenSpatial(sel.s,sel.t,1); };
window.moveTokenUp=()=>{ if(sel.s>=0&&sel.t>0)moveTokenIndex(sel.s,sel.t,-1); };
window.moveTokenDown=()=>{ if(sel.s>=0&&sel.t>0)moveTokenIndex(sel.s,sel.t,1); };
// insert on the left/right of a token (diagram, RTL-aware); above/below run in token order (grid)
function insertSpatial(si,tokId,dir){ const rtl=sentRTL(DOC[si]), after=(dir>0)!==rtl; insertToken(si, after?tokId:tokId-1); }
window.insertTokenLeft=()=>{ if(sel.s>=0&&sel.t>0)insertSpatial(sel.s,sel.t,-1); };
window.insertTokenRight=()=>{ if(sel.s>=0&&sel.t>0)insertSpatial(sel.s,sel.t,1); };
window.insertTokenAbove=()=>{ if(sel.s>=0&&sel.t>0)insertToken(sel.s,sel.t-1); };
window.insertTokenBelow=()=>{ if(sel.s>=0&&sel.t>0)insertToken(sel.s,sel.t); };
window.setTokenAsRoot=()=>{ if(sel.s>=0&&sel.t>0)setAsRoot(sel.s,sel.t); };
window.selectPrevHead=()=>{ if(sel.s>=0&&sel.t>0)stepHead(sel.s,sel.t,-1); };
window.selectNextHead=()=>{ if(sel.s>=0&&sel.t>0)stepHead(sel.s,sel.t,1); };
// items 2/3 — the token ids the marker commands act on: a multi-token range if one is selected, else the single
// selected token. (Same "range if there is one, else the token" rule ⌘G and the MWT menu items already follow.)
function selTokIds(){ if(sel.s<0||sel.t<=0) return [];
  return (selRange&&selRange.s===sel.s&&selRange.to>selRange.from)
    ? Array.from({length:selRange.to-selRange.from+1},(_,k)=>selRange.from+k) : [sel.t]; }
function selHasFeat(name){ const s=DOC[sel.s]; if(!s)return false; const ids=selTokIds();
  return ids.length>0 && ids.every(id=>s.tokens[id-1]&&hasFeat(s.tokens[id-1].feats,name,"Yes")); }   // "the selection carries it" = EVERY selected token does, so the toggle below has one unambiguous next state
// Toggle a marker FEAT (Foreign=Yes / Typo=Yes) across the selection. A mixed range SETS the feature on every
// token (a second press then clears it), so the keystroke always has a visible, predictable effect rather than
// flipping each token independently and leaving the range as mixed as it started.
function toggleMarkFeat(name,label){ if(sel.s<0||sel.t<=0) return toast("Select a token first");
  const s=DOC[sel.s], toks=selTokIds().map(id=>s.tokens[id-1]).filter(Boolean); if(!toks.length) return;
  const on=!toks.every(t=>hasFeat(t.feats,name,"Yes"));
  pushUndo();
  toks.forEach(t=>{ const before=t.feats; t.feats=on?setFeat(t.feats,name,"Yes"):clearFeat(t.feats,name); featsSyncGloss(t,before); });   // featsSyncGloss is a no-op for these two (neither has a Leipzig abbreviation — see FEATS_GLOSS's item-5 note), but routing every FEATS write through it keeps the invariant in one place
  markDirty(); preserveScroll(renderDoc); syncMenu(true);
  toast(`${label} ${on?"marked":"cleared"} on ${toks.length===1?"1 token":toks.length+" tokens"}`); }
/* item 7 — ⇧⌘' marks the selection's own head as reported speech (MISC Reported=Yes), which puts its whole
   subtree on a slightly displaced plane. The feature lands on ONE node — the highest-ranking one in the
   selection, the same "head of the range" rule ExtPos uses — because it is a property of the reported CLAUSE,
   not of each of its words; the displacement is then derived from the tree, which is what lets reports nest. */
function toggleReported(){ if(typeof stextMarkReported==="function" && stextMarkReported()) return;   // item 8: a selection of WORDS in the running sentence points at tokens just as well as a token selection does — see stextMarkSel
  if(sel.s<0||sel.t<=0) return toast("Select the tokens of a reported clause first");
  const s=DOC[sel.s], ids=selTokIds(), target=ids.length>1?rangeHead(s,ids[0],ids[ids.length-1]):sel.t;
  const t=s.tokens[target-1]; if(!t) return;
  const on=!isReported(t);
  pushUndo(); t.misc=setMiscKV(t.misc,"Reported",on?"Yes":"");
  markDirty(); preserveScroll(renderDoc); syncMenu(true);
  const sp=subtreeSpan(s,target);
  toast(on?`Reported speech: tokens ${sp.from}–${sp.to} (marked on token ${target})`:`Reported speech cleared from token ${target}`); }
window.toggleReported=toggleReported;
/* ⌘I has TWO ways of pointing at the tokens to mark: the token selection this file's toggleMarkFeat
   reads, and a SELECTION OF WORDS IN THE RUNNING SENTENCE, which the token↔text alignment turns into
   the same list (stextMarkForeign, js/core/document.js). The sentence line asks first — and claims the
   command only when it really is focused AND holds a non-empty selection, so "Mark as Foreign" from a
   token's context menu still means that token. This is also the ONLY route the native Edit-menu item
   has: its ⌘I key equivalent is matched by AppKit before the web view is offered the keydown, so the
   in-page handler on the line itself never runs in the shipping app. */
function toggleForeign(){ if(typeof stextMarkForeign==="function" && stextMarkForeign()) return;
  toggleMarkFeat("Foreign","Foreign"); }
/* item 6 — marking a token Typo=Yes offers to record what it SHOULD have said, in MISC CorrectForm (the UD key
   for exactly this), which then renders beside the struck-through form. Supplying one is optional. Clearing
   Typo also drops the CorrectForm: a correction with nothing left to correct is stale data, and the renderer
   would stop drawing it anyway (see correctFormOf). */
function toggleTypo(){ if(typeof stextMarkTypo==="function" && stextMarkTypo()) return;   // item 8: …and the same for Typo, which used to ignore a running-sentence selection entirely
  const s=DOC[sel.s], ids=selTokIds();
  const wasOn=selHasFeat("Typo");
  toggleMarkFeat("Typo","Typo");
  if(!s) return;
  if(wasOn){ let any=false; ids.forEach(id=>{ const t=s.tokens[id-1]; if(t&&miscKV(t.misc,"CorrectForm")){ t.misc=setMiscKV(t.misc,"CorrectForm",""); any=true; } });
    if(any) preserveScroll(renderDoc); return; }
  askCorrectForms(sel.s,ids.slice(),null,UNDO[UNDO.length-1]); }   // …and the snapshot toggleMarkFeat just pushed, so cancelling can revert the whole command
// Ask for each newly-marked token's correct form in turn. Enter/OK commits (blank = none) and moves on;
// Escape abandons the REST of the queue too, so marking a range never traps the user in a chain of prompts.
/* `fromLine` — the marking came from a selection of words in the RUNNING SENTENCE, so the prompt belongs under
   THAT word, not under the diagram's copy of it. Anchoring to the diagram meant the box opened somewhere the
   user was not looking, often a fair way down the block from the line they had just been reading. The painted
   span carries the token ids of the unit it covers (see stxUnitEl), which is what makes it findable by id; if
   it cannot be found — no decoration on that word, a line that failed to align — the diagram anchor is still
   the right fallback rather than no prompt at all. */
function askCorrectForms(si,queue,anchorFor,undoRef){ const s=DOC[si]; if(!s||!queue.length) return;
  const id=queue.shift(), t=s.tokens[id-1]; if(!t) return askCorrectForms(si,queue,anchorFor,undoRef);
  const inLine=(typeof anchorFor==="function")?anchorFor(id):null;   // supplied by the caller that knows where the marking came from; null → the diagram/grid anchors below
  const el=inLine||tokGroupOf(si,id)||document.querySelector(`#doc tr[data-s="${si}"][data-tok="${id}"]`);
  const b=el?el.getBoundingClientRect():null, rtl=sentRTL(s);
  textPrompt(b?(rtl?b.right:b.left):innerWidth/2-140, b?b.bottom+6:innerHeight/2-60,
    {rtl, title:`Correct form of “${bform(t)}”`, value:miscKV(t.misc,"CorrectForm"),
     hint:"Optional — leave blank for none.",
     ok:v=>{ const cur=miscKV(t.misc,"CorrectForm");
       if(v!==cur){ t.misc=setMiscKV(t.misc,"CorrectForm",v); markDirty(); preserveScroll(renderDoc); }
       askCorrectForms(si,queue,anchorFor,undoRef); },
     /* item 2 — ESCAPE CANCELS THE MARKING, not merely the prompt. Typo=Yes and its CorrectForm are one gesture:
        the box opens as part of marking, so backing out of the box means backing out of the mark. Leaving the
        token struck through with no correction was the app deciding the user had meant half of what they typed.
        It undoes the tokens still OUTSTANDING — this one and everything left in the queue — and not the ones
        already answered: those were committed by an Enter of their own, and Escape has never reached backwards
        over a confirmed step. Undo still covers the whole command, since the marking pushed one entry before its
        first write and nothing here pushes another. */
     cancel:()=>{ queue.length=0;
       /* A CANCELLED COMMAND SHOULD LEAVE NO TRACE, and that includes the title bar. This used to clear the
          marks back by hand, which restored the document but left the marking's own undo entry standing — and
          markDirty derives DIRTY from UNDO.length, so the file stayed dirty over a change the user had just
          refused, and anything that consults that state went on to act as though something had happened.
          Reverting the entry itself takes the document, the undo stack and the dirty flag back together. */
       if(typeof revertEdit==="function" && revertEdit(undoRef)){ toast("Typo marking cancelled"); return; }
       const drop=[id]; let any=false;   // no snapshot to revert (the entry has been shifted off the 80-deep cap, say) → clear by hand, as before
       drop.forEach(k=>{ const tk=s.tokens[k-1]; if(!tk) return;
         if(hasFeat(tk.feats,"Typo","Yes")){ const before=tk.feats; tk.feats=clearFeat(tk.feats,"Typo"); featsSyncGloss(tk,before); any=true; }
         if(miscKV(tk.misc,"CorrectForm")){ tk.misc=setMiscKV(tk.misc,"CorrectForm",""); any=true; } });
       if(any){ markDirty(); preserveScroll(renderDoc); if(typeof syncMenu==="function") syncMenu(true); }
       toast("Typo marking cancelled"); }}); }
window.toggleForeign=toggleForeign; window.toggleTypo=toggleTypo;
function toggleMergePunct(){ show.mergePunct=!show.mergePunct; const cb=document.querySelector('#toggles [data-t="mergePunct"]'); if(cb)cb.checked=show.mergePunct;
  updateViewOptions(); preserveScroll(renderDoc); toast(show.mergePunct?"Punctuation merged":"Punctuation unmerged"); }
window.toggleMergePunct=toggleMergePunct;
function toggleWrap(){ if(!(conv==="arcs"||conv==="brackets")) return toast("Line wrapping applies to the Arcs and Brackets views");
  show.wrap=!show.wrap; const cb=document.querySelector('#toggles [data-t="wrap"]'); if(cb)cb.checked=show.wrap;
  updateViewOptions(); preserveScroll(renderDoc); toast(show.wrap?"Long lines wrap":"Long lines run to full width"); }
window.toggleWrap=toggleWrap;
/* ── DOCUMENT AND PARAGRAPH BOUNDARIES (item 2) ──────────────────────────────────────────────────────────────
   Three commands, one for each of the three places UD records the corpus structure (see the boundary block in
   js/core/prefs.js): `# newdoc` and `# newpar` on a SENTENCE, and MISC NewPar=Yes on a TOKEN, for the paragraph
   that starts in the MIDDLE of a sentence.
   Each is a TOGGLE, because removing a boundary is the same gesture as creating one — and removal is exactly why
   the cleared value is `false` and not null: null tells the serialiser to leave the file's own comment alone,
   which is the one thing a removal must not do (see the _BOUNDARY_KEYS contract in app/io_conllu.py).
   Creating one never invents an id. `# newdoc id = …` is optional in UD and a manufactured id would be a claim
   about the corpus this app has no basis for making; an id a FILE supplied is shown in the mark's tooltip and is
   lost when the marker is removed, which is honest — the name belonged to the marker.
   All three act on curBlock() rather than sel.s, matching every other whole-sentence command: a boundary is a
   property of the sentence being read, and scrolling moves that without disturbing the token selection. */
function setBound(si,key,on){ const s=DOC[si]; if(!s) return false;
  if(hasBound(s,key)===!!on) return false;
  pushUndo(); s[key]=on?true:false; markDirty(); preserveScroll(renderDoc); syncMenu(); return true; }   // syncMenu: both rows are checkable and this is the only path that moves their state
function toggleBound(si,key){ const s=DOC[si]; if(!s) return toast("Select a sentence first");
  const on=!hasBound(s,key); setBound(si,key,on);
  if(on && typeof focusBoundId==="function") focusBoundId(si,key);   // creating a boundary opens its id for typing (js/core/document.js) — the marker and its optional name are one gesture. ONLY on creation: a removed boundary has no field left to focus, and setBound has just re-rendered without it
  toast((key==="newdoc"?"Document":"Paragraph")+" boundary "+(on?"added at":"removed from")+" sentence "+(si+1)); }
window.toggleDocBoundary=()=>{ const i=curBlock(); if(i>=0&&i<DOC.length) toggleBound(i,"newdoc"); else toast("Select a sentence first"); };
window.toggleParBoundary=()=>{ const i=curBlock(); if(i>=0&&i<DOC.length) toggleBound(i,"newpar"); else toast("Select a sentence first"); };
function toggleTokNewPar(si,tokId){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return;
  const on=!isNewParTok(t); pushUndo(); t.misc=setMiscKV(t.misc,"NewPar",on?"Yes":""); markDirty(); preserveScroll(renderDoc); syncMenu();
  toast(on?("Paragraph starts at token "+tokId):("Paragraph break cleared from token "+tokId)); }
window.toggleTokenNewPar=()=>{ if(sel.s>=0&&sel.t>0) toggleTokNewPar(sel.s,sel.t); else toast("Select a token first"); };
window.toggleTokNewPar=toggleTokNewPar;   // the block/token context menus call it with explicit coordinates
// state that drives the conditional Edit-menu items: which pane, whether a token is selected, RTL, group/ungroup availability
let UIZONE="diagram", _lastMenu=null;
function mwtAtSel(s,t){ return s&&(s.mwt||[]).find(m=>t>=m.from&&t<=m.to); }   // the MWT whose range covers token t (if any)
function inSelRange(si,tokId){ return !!(selRange&&selRange.s===si&&selRange.to>selRange.from&&tokId>=selRange.from&&tokId<=selRange.to); }   // item 1: does the current MULTI-token selection cover this token?
// item 1 — grow the multi-token selection by one token in reading order (dir ±1), anchored where it started —
// the shared body of every Shift+arrow path (the doc handler, the grid cells, and the inline-editor edges).
function extendSelToward(dir){ if(sel.s<0||sel.t<=0) return; const s=DOC[sel.s]; if(!s) return;
  if(!selRange||selRange.s!==sel.s) setRange(sel.s,sel.t,sel.t);
  const focus=adjTok(sel.s, selRange.focus, dir); setRange(sel.s, selRange.anchor, focus); sel.t=focus; preserveScroll(renderDoc); }
function rangeIsMWT(si,from,to){ return (DOC[si]&&DOC[si].mwt||[]).some(m=>m.from===from&&m.to===to); }   // do exactly these tokens already form an MWT?
// the MWT the current selection *is*: an exact-range match for a multi-token selection, else the MWT containing the single selected token
function selMWTof(s){ if(!s)return null; const multi=selRange&&selRange.s===sel.s&&selRange.to>selRange.from;
  return multi ? (s.mwt||[]).find(m=>m.from===selRange.from&&m.to===selRange.to) : mwtAtSel(s,sel.t); }
function menuState(){ const has=sel.s>=0&&sel.t>0, s=has?DOC[sel.s]:null;
  const multi=!!(selRange&&selRange.s===sel.s&&selRange.to>selRange.from);
  const formsMWT=!!selMWTof(s);            // the selected tokens already form / sit inside an MWT
  const inmwt=has&&!!mwtAtSel(s,sel.t);
  return {has, zone:has?UIZONE:"", rtl:!!(s&&sentRTL(s)),
          group:multi&&!formsMWT,          // Group: only a fresh multi-token selection that isn't already an MWT
          merge:multi&&!formsMWT&&isSpacelessLang(),   // Merge: Group's selection, narrowed to the languages a segmenter can mis-split (SPACELESS_LANGS in js/core/state.js) — elsewhere a wrongly split word is a stray space in the file, which `goeswith` annotates rather than destroys. A selection that already forms an MWT has Flatten instead, the same collapse with the range's own surface form
          ungroup:formsMWT, flatmwt:formsMWT,   // Ungroup / Flatten: only when the selection forms (or sits in) an MWT
          convmwt:has&&!multi&&!inmwt,      // Split: only a single, un-grouped token
          foreign:has&&selHasFeat("Foreign"), typo:has&&selHasFeat("Typo"),
          reported:has&&isReported(s.tokens[(selRange&&selRange.s===sel.s&&selRange.to>selRange.from?rangeHead(s,selRange.from,selRange.to):sel.t)-1]),   // item 7: the checkmark reflects the node the command would actually write to — the head of the selection
   // items 2/3: the native Edit-menu rows are checkable — the checkmark mirrors the selection's current marker FEATS
          blockOnly:sel.s>=0&&sel.t<=0,     // a block is selected without a token → sentence insert/move/delete take the token shortcuts
   // item 2: the two sentence-level boundary rows are toggles too, and their checkmarks reflect the sentence being
   // READ (curBlock), which is what the commands act on — so the menu can state the boundary even with no token picked
          newdoc:hasNewdoc(curSent()), newpar:hasNewpar(curSent()),
          tokNewpar:has&&isNewParTok(s.tokens[sel.t-1]),   // …and the mid-sentence one, which IS token-scoped
          paged:PAGED,
          wrapOK:(conv==="arcs"||conv==="brackets"||conv==="stemma"||conv==="tree")}; }
function curSent(){ const i=curBlock(); return (i>=0&&i<DOC.length)?DOC[i]:null; }
function syncMenu(force){ if(force)_lastMenu=null; if(!hasBridge())return; const st=menuState(), key=JSON.stringify(st);
  if(key===_lastMenu)return; _lastMenu=key; try{ window.pywebview.api.sync_menu(st); }catch(e){} }
window.syncMenu=syncMenu;   // the native menu wiring calls this (force=true) once its item references exist
(function(){ const d=document.getElementById("doc"); if(!d)return;
  d.addEventListener("pointerdown",e=>{ const z=e.target.closest(".gridbox")?"grid":(e.target.closest(".diagram,.text-conv")?"diagram":null);
    if(z&&z!==UIZONE){ UIZONE=z; applyZone(); syncMenu(); } }, true); })();
// A run of text split into alternating plain-text-node / <tspan class="glabbr">…</tspan> (or, in HTML, <span
// class="glabbr">) segments — e.g. "path.<…>NOM</…>.<…>PL</…>" for a token's POS/gloss/MGloss/deprel-label rows
// — copies to the clipboard with a SPURIOUS newline inserted at every segment boundary. Confirmed in FOUR
// places: the unwrapped/hierarchy SVG diagrams (<tspan>, inside an <svg>), the wrapped-bracket/outline HTML
// views (<span>, inside a plain .gloss element), AND the live MGloss inline editor (.glabbrbox, a contentEditable
// div built the same way — see makeGlossEditableSC's render()). A real, known browser quirk in the plain-text
// clipboard serializer (adjacent inline runs with no source whitespace between them still get joined with a
// line break) that has nothing to do with the underlying data, which never contains one (see tierText/
// glossAbbrSegments' GLOSS_WS_RE strip — that guards against a genuinely stray character in STORED data; THIS
// guards against the browser inventing one purely for the copy, whether from stored data or a live edit).
// Override the clipboard's plain-text payload with a plain concatenation of the selected text nodes' own data
// (no separator, matching how they visually read as one continuous run) whenever the copy touches one of these.
document.addEventListener("copy",e=>{
  const sel=window.getSelection(); if(!sel||!sel.rangeCount||sel.isCollapsed) return;
  const range=sel.getRangeAt(0), root=range.commonAncestorContainer;
  const rootEl=root.nodeType===1?root:root.parentNode;
  const scoped=rootEl&&rootEl.closest&&rootEl.closest("svg, .glabbrbox, .gloss");
  if(!scoped) return;   // other HTML content (grid, plain prose fields, dialogs, …) copies natively without this quirk — leave it alone
  const walker=document.createTreeWalker(root.nodeType===3?root.parentNode:root,NodeFilter.SHOW_TEXT);
  let text=""; let node;
  while((node=walker.nextNode())){ if(!range.intersectsNode(node)) continue;
    const s=node===range.startContainer?range.startOffset:0, en=node===range.endContainer?range.endOffset:node.data.length;
    text+=node.data.slice(s,en); }
  if(text){ e.clipboardData.setData("text/plain",text); e.preventDefault(); } });
// ⌘\ — bounce the focus between the diagram and the grid (drives the accent-vs-grey selection cue; also moves the caret into a grid cell so you can type)
function switchFocusZone(){ if(sel.s<0)return;
  UIZONE = UIZONE==="grid" ? "diagram" : "grid"; applyZone(); syncMenu();
  if(UIZONE==="grid"){ const r=document.querySelector(`#doc tr[data-s="${sel.s}"][data-tok="${sel.t}"]`);
    if(r){ scrollNearest(r); const inp=r.querySelector(".cin,.csel"); if(inp)inp.focus(); } }
  else { const ae=document.activeElement; if(ae&&/INPUT|SELECT/.test(ae.tagName))ae.blur();
    const g=tokGroupOf(sel.s,sel.t);
    revealEl(g); } }   // item 6: revealEl, not scrollNearest — ⌘\ into the diagram is a focus MOVE like every arrow/Tab path, and an unwrapped diagram scrolls horizontally inside its own scroller, which scrollNearest never corrects (see its comment). The grid branch above keeps scrollNearest + its own reveal: a grid cell's horizontal correction comes from the .cin focus handler it triggers
window.switchFocusZone=switchFocusZone;

