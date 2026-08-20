//@module js/scores.js
/* ── THE PIPELINE'S RUNNERS-UP ─────────────────────────────────────────────────────────────────────
   Every model in the pipeline scores a whole INVENTORY and the editor has only ever drawn the winner:
   one head per token, one relation per edge, one word class per token. The ranking underneath is
   computed on the way and thrown away. This module is the frontend's access to it — one bridge call
   per sentence (`Api.token_scores` → app/parse.py's `analysis_scores`), cached, feeding four places:

     · the drag highlight — every head the parser weighed for the dragged token, lit in proportion
       (js/diagram/diagram-edit.js)
     · the relation that follows a re-heading (`headSyncDeprel`, js/io/bridge.js)
     · the opacity of the rows in the relation and POS menus (js/editing/context-menu.js)

   ⚠ THE CACHE IS KEYED ON THE QUESTION, NOT ON THE SENTENCE INDEX, and that is what makes
   invalidation a non-problem rather than a list of edit sites to remember. What the pipeline is being
   asked is "given these FORMS and these WORD CLASSES, what did you rank" — so the key is exactly
   those, and any edit that could change the answer changes the key by construction, while an edit
   that cannot (re-heading a token, relabelling an edge, typing a gloss) keeps the entry warm. That
   matters: re-heading is precisely when the answer is consulted, and a cache keyed on `si` would
   have thrown it away on the edit that needed it.

   Every entry point resolves to `null` rather than throwing or rejecting, and every caller degrades
   to its pre-existing behaviour on `null`. There are three ordinary ways to get one — no bridge, no
   model, and a Stanza document (whose UD tree is rewritten into SUD by grew, so its own distribution
   describes a tree nobody is looking at; see `analysis_scores`) — and none of them is a failure. */
const SCORES_MAX = 24;                       // sentences; an entry measured 580–814 bytes
const SCORES = new Map();                    // key → payload | Promise<payload>
const ARC_SCORES = new Map();                // key + child + head → labels | Promise<labels>

// The question, verbatim: the model, the forms, and the reader's own tags (which `analysis_scores`
// threads to `_force_upos` exactly as `parse_tokens` does, so the two agree about the sentence).
function scoresKey(s){ if(!s||!s.tokens||!s.tokens.length) return "";
  return (model||"")+"\u0000"+s.tokens.map(t=>(t.form||"")+"\u0002"+(trUpos(t)||"")).join("\u0001"); }
function scoresPut(map,k,v){ map.set(k,v); while(map.size>SCORES_MAX) map.delete(map.keys().next().value); }
function scoresUsable(){ return !!(hasBridge()&&model&&typeof trUpos==="function"); }

/* The whole ranking for one sentence, or null. Concurrent callers share one in-flight promise —
   a drag start and a menu open land within a few ms of each other and must not both cross the bridge. */
async function tokenScores(si){
  const s=DOC[si]; if(!s||!scoresUsable()) return null;
  const k=scoresKey(s); if(!k) return null;
  const hit=SCORES.get(k); if(hit) return (hit&&typeof hit.then==="function")?await hit:hit;
  const p=(async()=>{
    let r; try{ r=await window.pywebview.api.token_scores(s.tokens.map(t=>t.form||""),model,s.tokens.map(t=>trUpos(t))); }
    catch(e){ r=null; }
    const out=(r&&r.scored)?r:null;
    scoresPut(SCORES,k,out);                 // …including a null: a model that cannot answer must not be re-asked per keystroke
    return out; })();
  scoresPut(SCORES,k,p);
  return await p;
}
// Already answered? (sync — for a caller that must decide now and can live without it.)
function peekTokenScores(si){ const s=DOC[si]; if(!s||!scoresUsable()) return null;
  const hit=SCORES.get(scoresKey(s)); return (hit&&typeof hit.then==="function")?null:(hit||null); }

/* "If this token hung off THAT one, what would you call the edge?" — for an arc the parser never
   weighed, which is most arcs a reader makes by hand. Counterfactual by construction (the state is
   synthesised); `arc_label_scores` says what that does and does not license. */
async function arcLabelScores(si,child,head){
  const s=DOC[si]; if(!s||!scoresUsable()) return null;
  if(!(child>=1&&head>=1&&child<=s.tokens.length&&head<=s.tokens.length&&child!==head)) return null;
  const k=scoresKey(s)+"\u0003"+child+"\u0003"+head; if(!k) return null;
  const hit=ARC_SCORES.get(k); if(hit) return (hit&&typeof hit.then==="function")?await hit:hit;
  const p=(async()=>{
    let r; try{ r=await window.pywebview.api.arc_scores(s.tokens.map(t=>t.form||""),model,child,head); }
    catch(e){ r=null; }
    const out=(r&&r.scored&&r.labels)?r.labels:null;
    scoresPut(ARC_SCORES,k,out); return out; })();
  scoresPut(ARC_SCORES,k,p);
  return await p;
}

/* ⚠ A `||` LABEL IS NOT A RELATION. The models carry a few composite classes from their training data
   (`comp:obj||comp:aux`, `mod||mod`) — an artefact of how a multi-label arc was encoded, not something
   the editor can write into a deprel column. They stay in the HEAD marginal, because the parser really
   did weigh those arcs, but nothing may ever adopt one as a label. */
function scoreRealRel(r){ return !!r && r.indexOf("||")<0; }
// the best relation in a {label: p} map that the editor can actually express, or ""
function bestScoredRel(map){ let best="", bp=0;
  Object.keys(map||{}).forEach(r=>{ if(scoreRealRel(r)&&map[r]>bp){ bp=map[r]; best=r; } });
  return best; }
/* …and the WHOLE ranking, best first, for the one caller that cannot simply take the argmax: a re-heading
   drop must not write a relation the validator calls an error on the new head (`relForNewHead`,
   js/io/bridge.js), and "the top-ranked one is refused" is a reason to look at the runner-up rather than to
   give up. Same `scoreRealRel` filter bestScoredRel applies — a `||` composite is never a relation the
   editor may adopt, however the caller walks the list — so `bestScoredRel(m)` is exactly
   `rankedScoredRels(m)[0]||""` and the two cannot disagree about what is expressible. */
function rankedScoredRels(map){ return Object.keys(map||{}).filter(r=>scoreRealRel(r)&&map[r]>0).sort((a,b)=>map[b]-map[a]); }
/* P(relation) for one token under ONE head, pooled to the BASE relation — which is the same pooling
   the relation menu's submenus do (a row's deep-feature flyout holds `mod@relcl` under `mod`), so the
   menu and this agree by construction rather than by coincidence. */
function relWeightsFor(map){ const out={};
  Object.keys(map||{}).forEach(r=>{ if(!scoreRealRel(r))return; const b=depBase(r);
    out[b]=(out[b]||0)+map[r]; });
  return out; }

/* p → ink. A plain linear ramp makes everything below about a fifth indistinguishable from nothing,
   and "the parser gave this 8 %" and "the parser never considered this" must not look alike — that is
   the entire point of showing the ranking. The gamma lifts the low end perceptually (0.05 → 0.24,
   0.22 → 0.46, 0.78 → 0.88) while leaving a true zero at zero. */
function scoreShade(p){ p=+p; if(!(p>0)) return 0; return Math.pow(Math.min(1,p),0.55); }
