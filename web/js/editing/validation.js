//@module js/validation.js
/* validation */
// keep the root invariant coupled: a token has head 0  ⟺  its deprel is "root"
function afterHeadEdit(t,s,defer){ if(parseInt(t.head,10)===0) t.deprel=withDepBase(t.deprel,"root"); else if(depBase(t.deprel)==="root") t.deprel=withDepBase(t.deprel,"udep");   // (keeps any @deep tail)
  if(s) syncSharedFeat(t,s);   // `s` = the token's sentence — pass it whenever the caller has it, so a rehead away from a conj head drops a stale Shared=Yes
  if(s) syncSubjectFeat(t,s);   // …and likewise a rehead of a Subject-raising predicate whose crawl (subjRaiseTargetFor) no longer resolves drops the now-stale Subject value
  normGoesWith(t,s);   // …and a token that is ALREADY a goeswith continuation, dragged onto a new head, is a continuation of THAT word now
  /* …AND THE RELATION IS RE-ASKED OF THE PARSER, because a relation describes an EDGE and the edge has
     just moved: a `subj` dragged under a noun is no longer a statement about anything. The two rules
     above are what follows from the head with CERTAINTY; this is the part that needs evidence, and it
     is deliberately here rather than at the call sites — this function is already the documented one
     funnel every head change passes through (the diagram drag, the grid's Head cell, Find & Replace
     over Head, setAsRoot/stepHead), so a new path gets it for free and none can forget.
     headSyncDeprel (js/io/bridge.js) adopts the parser's relation ONLY where the parser independently
     chose the same head — see its own note. Async, best-effort, no undo entry of its own; guarded
     because js/io/bridge.js loads after this module.

     ⚠ AND A COMMAND THAT MOVES SEVERAL HEADS AT ONCE PASSES A `defer` ARRAY, which collects the token
     ids instead of firing one call per token. Two reasons, and neither is mere batching. (1) ORDER: a
     re-root (setAsRoot, js/editing/edit-ops.js) rewrites three or more heads in sequence, so a call
     fired from the FIRST of them would ask about a tree that is still half-mutated — the new root's
     own `head` has not been zeroed yet — and headSyncDeprel's own "has the document moved?" re-read
     would then discard the answer it just paid for. (2) ONE RENDER: each call ends in
     renderUnlessEditing(), and renderDoc is the expensive thing in this app. The caller runs the list
     through `headSyncDeprels` once the whole structural edit has landed and been drawn. */
  if(s && typeof headSyncDeprel==="function"){ const si=DOC.indexOf(s), tokId=s.tokens.indexOf(t)+1;
    if(si>=0&&tokId>0){ if(defer) defer.push(tokId); else headSyncDeprel(si,tokId); } } }   // …and a token that is ALREADY a goeswith continuation, dragged onto a new head, is a continuation of THAT word now: its dependents follow it there (see normGoesWith). Not a no-op even though the relation didn't change — the head did, and every consequence below hangs off the head
function afterDeprelEdit(t,s){ if(depBase(t.deprel)==="root"){ t.head="0"; if(s){ syncSharedFeat(t,s); syncSubjectFeat(t,s); } } else if(parseInt(t.head,10)===0) t.deprel=withDepBase(t.deprel,"root");
  normGoesWith(t,s); }
/* ── ASSIGNING `goeswith` NORMALISES THE DEPENDENT ─────────────────────────────────────────────────────────────
   `goeswith` is not a relabelling of one edge like `mod` or `comp:obj`. It is a claim about the ORTHOGRAPHY — that
   this token is the tail half of the word before it, which a stray space broke in two — and the UD guidelines
   (universaldependencies.org/u/dep/goeswith.html) spell out what follows for the token that receives it:
     · "the later parts of the word are given the POS X" → UPOS := X.
     · "only the first part can have a lemma and morphological features" → LEMMA and FEATS cleared. The word's
       annotation lives on its first part, which is also where every renderer already draws it (the continuation is
       folded onto the head and shows no stack of its own — see the goeswith block in js/diagram/diagram-core.js).
     · A CONTINUATION CAN HEAD NOTHING. It is half a word, not a node: the fold removes it from the token list
       entirely, so foldGoesWith already has to redirect any head pointing into it up to the unit's head just to
       have something to draw. Doing it here makes the DOCUMENT say what the display was silently correcting.
   So the three run together, as ONE step of whatever undo entry the caller pushed before its own edit — they are
   consequences of that edit, not a second one, and an undo that put the relation back but left the lemma gone
   would be a worse lie than not offering it. Every path that can set a relation goes through afterDeprelEdit
   (the relation context menu and its deep-feature submenu, the grid's DepRel cell, Find & Replace over DepRel) or
   through afterHeadEdit (dragging an arc to a new head, Find & Replace over Head), so both call this.
   IT FIRES ONLY WHEN THE RELATION *IS* goeswith. Changing a relation AWAY from goeswith restores nothing: the
   lemma and features this cleared are not recoverable from the file, and inventing a UPOS for a token that is
   suddenly a word again would be a guess. Undo is what reverses it, which is exactly why this shares the caller's
   undo entry. */
function normGoesWith(t,s){ if(!s||!s.tokens||!isGoesWith(t.deprel)) return false;
  const id=s.tokens.indexOf(t)+1; if(!id) return false;   // the token has to be findable to re-point its dependents; a token not in `s` is a caller error, not a case to guess at
  const h=parseInt(t.head,10); let hit=false;
  if(t.upos!=="X"){ t.upos="X"; hit=true; }   // XPOS deliberately untouched: the guideline speaks of the UPOS, and XPOS is a corpus-specific tagset this app has no licence to invent a value in (the grid's UPOS-mirroring is a per-document convenience the user turned on for tags they chose, not a rule about goeswith)
  if(t.lemma){ t.lemma=""; hit=true; }        // "" is this model's empty; io_conllu writes it back as "_"
  if(t.feats){ t.feats=""; hit=true; }        // …including Typo=Yes, which the guidelines put on the goeswith HEAD, never on a continuation
  if(h>=1&&h<=s.tokens.length&&h!==id) s.tokens.forEach((x,i)=>{ if(i+1!==id&&parseInt(x.head,10)===id){ x.head=String(h); hit=true; } });   // every dependent moves up to the unit's head, keeping its own relation — it modified the whole word all along, and the word is the head
  /* …AND THE HEAD TAKES Typo=Yes + CorrectForm, which is the other half of the same guideline and was missing.
     A goeswith unit says a stray SPACE broke one word in two, and a stray space is a typo — so UD records it on
     the FIRST part, with MISC CorrectForm giving the word as it should have been written, i.e. the unit's forms
     joined with nothing between them. The continuation carries neither (it is not a misspelling of anything; it
     is half a word), which is what the `t.feats=""` above is already careful to say.
     THE USUAL TYPO RENDERING IS SUPPRESSED HERE, and by machinery that already exists rather than anything new:
     every renderer that draws a strike or an above-the-line correction tests "is this a goeswith head" first
     (see the gwHead sets in stxUnitDeco/paintStext and formDeco's own note). A goeswith unit already SHOWS its
     claim — the two halves are folded into one word under a slur — so striking it as well would be the same
     statement twice, in a notation that means something else. The FEATS are for the file and for export; the
     diagram keeps saying it in its own way. */
  const head=(h>=1&&h<=s.tokens.length&&h!==id)?s.tokens[h-1]:null;
  if(head){
    const parts=[head.form||""];
    for(let k=h+1;k<=s.tokens.length;k++){ const x=s.tokens[k-1];
      if(isGoesWith(x.deprel)&&parseInt(x.head,10)===h) parts.push(x.form||""); else break; }   // contiguous continuations only: goeswith is by definition the NEXT token(s), so a gap ends the unit
    const joined=parts.join("");
    if(!hasFeat(head.feats,"Typo","Yes")){ head.feats=setFeat(head.feats,"Typo","Yes"); hit=true; }
    if(miscKV(head.misc,"CorrectForm")!==joined){ head.misc=setMiscKV(head.misc,"CorrectForm",joined); hit=true; } }
  if(hit&&typeof markDirty==="function") markDirty();   // the caller marks its own edit dirty; this one is the app's, and a normalisation the user can see must show in the title bar even where the caller's own write turned out to be a no-op
  return hit; }
let ISSUES=[], BAD=new Map();   // BAD: "si:tok" → {head,upos,deprel} — the per-token DOM-free verdict paintValidationDom() paints onto whatever grid rows currently exist. Keeping the verdict as data (not DOM writes) is what lets computeIssues() stay a plain O(tokens) pass with no document.querySelector calls, which used to run up to 3 PER TOKEN here and dominated render time on a large document — see the module note above validateAll
/* computeIssues() is validateAll's old body, MINUS every DOM touch: the algorithm (invalid heads, empty
   UPOS/deprel, root-count, dependency cycles) is unchanged, it just records verdicts into BAD instead of
   toggling classes on cells that, once renderDoc is windowed, mostly don't exist yet. paintValidationDom()
   is the separate, cheap DOM pass — O(rendered rows), not O(DOC) — that applies BAD to whatever's on screen. */
function computeIssues(){ ISSUES=[]; BAD=new Map();
  const flag=(si,tok,key)=>{ const k=si+":"+tok; let o=BAD.get(k); if(!o){ o={}; BAD.set(k,o); } o[key]=true; };
  DOC.forEach((s,si)=>{const t=s.tokens,n=t.length,heads=t.map(x=>parseInt(x.head,10)); let roots=0;
    heads.forEach((h,i)=>{ const inv=isNaN(h)||h<0||h>n||h===i+1;
      if(inv){ flag(si,i+1,"head"); ISSUES.push({si,tok:i+1,msg:`Token ${i+1} (“${t[i].form||"?"}”) has an invalid head (${t[i].head})`}); }
      const draw=depBase(t[i].deprel), dbase=draw.replace(/\/m$/,""); const uposEmpty=!t[i].upos||t[i].upos==="_", deprelEmpty=(!dbase||dbase==="_");   // empty UPOS / deprel (the part before "@", ignoring any mSUD "/m" suffix) are allowed but flagged; a "/m" relation validates as its base does
      if(uposEmpty){ flag(si,i+1,"upos"); ISSUES.push({si,tok:i+1,msg:`Token ${i+1} (“${t[i].form||"?"}”) has no UPOS tag`}); }
      if(deprelEmpty&&h!==0){ flag(si,i+1,"deprel"); ISSUES.push({si,tok:i+1,msg:`Token ${i+1} (“${t[i].form||"?"}”) has no dependency relation`}); }   // a head-0 token's empty deprel is covered by the root-agreement check below
      if(h===0)roots++;
      if((dbase==="root")!==(h===0))   // deprel "root" and head 0 must agree (compare the relation, ignoring any @deep tail)
        ISSUES.push({si,tok:i+1,msg:h===0?`Token ${i+1} has head 0 but deprel “${t[i].deprel}” (a root must be “root”)`:`Token ${i+1} has deprel “root” but head ${t[i].head} (a root must have head 0)`});
      // deprel "punct" and UPOS PUNCT must agree the same way root/head-0 do — on request ("a token
      // should not be allowed to have the punct deprel unless its UPOS is PUNCT. This applies even if
      // its deprel is computed automatically"). Checked here rather than gated behind any particular
      // edit path (the grid's DepRel cell, Find & Replace, headSyncDeprel adopting the parser's own
      // suggestion, …) precisely BECAUSE computeIssues re-walks the whole live document on every
      // render regardless of how a deprel got there, so an automatically-assigned "punct" is caught
      // exactly as a manually-typed one is — no separate guard needed at each assignment site. Empty
      // UPOS is its own, already-flagged issue above and not re-flagged here.
      if(dbase==="punct"&&!uposEmpty&&t[i].upos!=="PUNCT")
        ISSUES.push({si,tok:i+1,msg:`Token ${i+1} (“${t[i].form||"?"}”) has deprel “punct” but UPOS “${t[i].upos}” (must be PUNCT)`}); });
    if(roots!==1)ISSUES.push({si,tok:roots>1?(heads.indexOf(0)+1):0,msg:roots===0?"No root — exactly one token must have head 0":`${roots} roots — exactly one token may have head 0`});
    // dependency cycles: a head chain that loops back instead of reaching the root (head 0). Each cycle is
    // reported once (anchored at its lowest token id) with every member's head cell flagged.
    const cst=new Array(n).fill(0);   // 0 unvisited · 1 on the active walk · 2 done
    for(let st=0; st<n; st++){ if(cst[st]) continue;
      const path=[], at=new Map(); let cur=st;
      while(cur>=0 && cur<n && cst[cur]===0){ cst[cur]=1; at.set(cur,path.length); path.push(cur);
        const hh=heads[cur]; cur=(hh>=1&&hh<=n)?hh-1:-1; }   // head 0 (root) / NaN / out-of-range ends the walk
      if(cur>=0 && cur<n && cst[cur]===1){ const cyc=path.slice(at.get(cur)).map(x=>x+1).sort((a,b)=>a-b);
        if(cyc.length>1){   // a 1-token self-loop is already reported as "token is its own head"
          cyc.forEach(id=>flag(si,id,"head"));
          ISSUES.push({si,tok:cyc[0],msg:`Dependency cycle: tokens ${cyc.join(", ")} form a loop with no path to the root`}); } }
      path.forEach(x=>cst[x]=2); } });
  const issues=ISSUES.length;
  document.getElementById("valDot").className="dotmark "+(issues?"dot-bad":"dot-good");
  document.getElementById("valText").textContent=issues?`${issues} issue${issues>1?"s":""}`:"valid";
}
// paints BAD onto whatever token rows currently exist in the DOM — one querySelectorAll, not 3×tokens of
// individual querySelector calls. Safe to call on a partial (windowed) render: a row not yet built simply
// isn't visited, and gets painted correctly whenever it IS built, since renderGrid's row-building always
// runs before this (see renderDoc's call order).
function paintValidationDom(){
  document.querySelectorAll("#doc tr[data-tok]").forEach(row=>{
    const o=BAD.get(row.dataset.s+":"+row.dataset.tok)||{};
    const hc=row.querySelector("td.w-head .csel"); if(hc)hc.classList.toggle("bad",!!o.head);
    const uc=row.querySelector("td.w-upos .csel"); if(uc)uc.classList.toggle("bad",!!o.upos);
    const dc=row.querySelector("td.w-deprel .cin"); if(dc)dc.classList.toggle("bad",!!o.deprel);
  });
}
function validateAll(){ computeIssues(); paintValidationDom(); }
// click the status-bar indicator → list the issues; each row jumps to the offending token/sentence
function sheetIssues(){ const s=shell("Issues", ISSUES.length?`${ISSUES.length} issue${ISSUES.length>1?"s":""} to resolve.`:"No issues in the document.","sm");   // a plain informational alert (per Figma: translucent glass, pill button), not a content sheet
  const c=s.querySelector(".content");
  if(!ISSUES.length){ const p=document.createElement("p"); p.style.margin="0"; p.textContent="Every sentence has exactly one root and valid heads."; c.appendChild(p); }
  else { const list=document.createElement("div"); list.className="issuelist";
    ISSUES.forEach(iss=>{ const row=document.createElement("button"); row.className="issuerow";
      const sid=(DOC[iss.si]&&DOC[iss.si].sid)||("sentence "+(iss.si+1));
      row.innerHTML=`<span class="issloc">${esc(sid).replace(/([.\-_/:])/g,"$1<wbr>")}</span><span class="issmsg">${esc(iss.msg).replace(/ (\S+)\s*$/," $1")}</span>`;   // <wbr> after punctuation → long ids break there first; nbsp before the last word → it never orphans alone
      row.onclick=()=>{ closeSheet(); if(iss.tok>0)pick(iss.si,iss.tok); else pick(iss.si,0,false,false);
        const b=(typeof scrollToSentence==="function")?scrollToSentence(iss.si):document.querySelector(`.sblock[data-i="${iss.si}"]`);   // an issue can be anywhere in the document — bring it into the rendered window first (js/core/document.js)
        if(b)b.scrollIntoView({block:"center",behavior:"smooth"}); };
      list.appendChild(row); });
    c.appendChild(list); }
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn primary" data-x>Close</button>`; act.querySelector("[data-x]").onclick=closeSheet;
  return s; }
// the status-bar Issues indicator opens the in-page sheet (Figma-styled, like every other dialog) —
// no longer a native macOS alert (show_issues/create_confirmation_dialog), which looked and behaved
// inconsistently with the rest of the app's UI.
document.getElementById("valPill").addEventListener("click",()=>openSheet(sheetIssues()));

