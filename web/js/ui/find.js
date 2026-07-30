//@module js/find.js
/* ── FIND & REPLACE (⌘F) ───────────────────────────────────────────────────────────────────────────
   WHY THIS GREW THE BAR INSTEAD OF BECOMING A SHEET. A sheet (js/ui/sheets.js) drops a scrim over the
   document and owns the keyboard: a search run from one would hide the very highlights it produces,
   and stepping to a match would mean dismissing the thing that found it. Find is the one dialog whose
   whole job is to point AT the document, so it stays the floating overlay it already was (#findBar)
   and GROWS a panel beneath its one-row bar — the shape Xcode and BBEdit use, and the shape the
   existing single-row bar already is a collapsed version of. With the panel shut, ⌘F still opens the
   one-line "Find in document" bar that behaves exactly as it did before this file was rewritten:
   plain substring, case-insensitive, over the sentence id + text + transliteration ("Anywhere").

   WHAT IT ADDS
   · REGEX as an OPTION (the .* toggle) — plain substring stays the default. A pattern that will not
     compile is reported in the panel and dulls the count; it is never thrown (findRe/compileCrits).
   · MATCH CASE (the Aa toggle) — off by default, so the pre-existing behaviour is unchanged.
   · PER-FIELD criteria, each with its OWN term, combining as a CONJUNCTION (see scanFind).
   · REPLACE, restricted to exactly what the criteria selected (see planReplace / runReplaceAll).  */

let FIND={open:false,expanded:false,rx:false,mcase:false,
  crits:[{f:"any",q:""}],   // ordered criteria; crits[0] is the one rendered in the BAR itself, the rest in the panel
  replF:"", replV:"",       // the field a replace targets + the replacement template
  hits:[],                  // [{si, toks:[tokId,…] | null}] — one entry per matching sentence; toks null ⇒ the sentence itself is the match
  matches:[], nTok:0, cur:-1, err:"", _scrolled:null};

/* ── THE SEARCHABLE FIELDS ─────────────────────────────────────────────────────────────────────────
   Enumerated FROM the document model rather than invented, and in the order the model presents them:
     · the sentence-level values a sentence dict carries — sent_id and `# text` (io_conllu._parse_block),
       plus the whole-sentence transliteration line the block header draws;
     · the nine editable CoNLL-U columns (io_conllu._EDIT = COLS minus ID), split at DEPREL exactly as
       the annotation grid splits it (COLS in js/grid/grid.js: "DepRel" is depBase, "Deep" the "@" tail),
       so a field named here means the same thing as the grid column of that name;
     · the layered annotations that ride in MISC — Gloss / MSeg / MGloss (TIER_MISC in js/core/prefs.js)
       and the STORED transliteration, Translit. Those are searchable in their own right AND inside the
       raw "Misc" field above; what differs is what a replace touches (one attribute, or the whole
       "|"-joined string).
   `scope` is what a criterion on the field constrains — a whole sentence, or one token.
   `get` reads the field; `put` writes it. NO put ⇒ the value is DERIVED, not stored, so it can be
   searched but never replaced ("Sentence transliteration" is romanised from the forms; "Anywhere" is
   three fields at once and so names no single place to write).
   `tokGet` is the extra reading a SENTENCE-scoped field has when the same value can also be read off
   ONE token — it is what keeps a mixed query an intersection rather than a union (see scanFind). Only
   the two token-DERIVED sentence fields have one: "Anywhere" (a token's own columns are as much
   "anywhere" as the sentence's are) and "Sentence transliteration" (that line IS the per-token
   transliterations joined). "Sentence ID" and "Sentence text" have none and must not: a sid is not a
   token property, and `# text` is one sandhied string no token is reliably a substring of. */
const FIND_FIELDS=(function(){
  // A plain CoNLL-U column. Reading maps the canonical "_" to "" — what io_conllu.parse already does
  // for every column but HEAD, and what the grid shows. Writing follows the grid's own two rules for
  // an EMPTIED cell (see the blur handler's "a lone _ means empty" and the input handler's "empty
  // Deps/Misc round-trips as _" in js/grid/grid.js), so a replace cannot widen io_conllu's
  // normalisation policy: everything it can write, a hand edit in the grid could already write.
  const col=(id,label,k,after)=>({id,label,scope:"tok",
    get:t=>{ const v=t[k]; return (v==null||v==="_")?"":String(v); },
    put:(t,v,s)=>{ if(v.trim()==="_") v="";
      if((k==="deps"||k==="misc") && v==="") v="_";
      t[k]=v; if(after)after(t,s); }});
  // A MISC-borne layer. setMiscKV keeps the other Key=Value pairs and their order, drops the pair when
  // the value goes empty, and yields "_" when nothing is left — the same write every other editor of
  // these tiers already makes.
  const mk=(id,label)=>({id,label,scope:"tok",
    get:t=>miscKV(t.misc,id),
    put:(t,v)=>{ t.misc=setMiscKV(t.misc,id,v); }});
  return [
    {id:"any",label:"Anywhere",scope:"sent",get:s=>sentAnyText(s),tokGet:t=>tokAnyText(t)},  // the pre-rewrite behaviour, kept as the default; tokGet narrows it to the token once a token field is in play
    {id:"sid",label:"Sentence ID",scope:"sent",get:s=>s.sid||"",
     put:(s,v)=>{ const t=v.trim(); if(t) s.sid=t; }},                                     // a sentence may not be left without an id — the same refusal the .sid-in field makes (js/core/document.js)
    {id:"text",label:"Sentence text",scope:"sent",get:s=>s.text||"",                       // the `# text` comment ITSELF, not the form-join fallback "Anywhere" uses: a sentence carrying no `# text` line has no such field to replace in, and a replace must never invent one
     put:(s,v)=>{ s.text=v; }},
    {id:"strans",label:"Sentence transliteration",scope:"sent",get:s=>sentTransLine(s),
     tokGet:t=>t.translit||""},                                                            // derived from the forms → search only; the line is the per-token translits joined, so narrowing to one token is exact
    col("form","Form","form"),
    col("lemma","Lemma","lemma"),
    col("upos","UPOS","upos"),
    col("xpos","XPOS","xpos"),
    col("feats","Feats","feats"),
    col("head","Head","head",(t,s)=>afterHeadEdit(t,s)),                                   // keep head 0 ⟺ deprel "root", as the grid's Head cell does
    {id:"deprel",label:"DepRel",scope:"tok",get:t=>depBase(t.deprel||""),
     put:(t,v,s)=>{ t.deprel=withDepBase(t.deprel,v); afterDeprelEdit(t,s); }},            // …and keep the "@deep" tail, as the grid's DepRel cell does
    {id:"deep",label:"Deep",scope:"tok",get:t=>depDeep(t.deprel||""),
     put:(t,v)=>{ t.deprel=withDepDeep(t.deprel,v); }},                                    // replace only the deep-feature tail
    col("deps","Deps","deps"),
    col("misc","Misc","misc"),
    mk("Gloss","Gloss"),
    mk("MSeg","Morpheme segmentation"),
    mk("MGloss","Morphemic gloss"),
    mk("Translit","Transliteration (stored)"),
  ];
})();
function findField(id){ return FIND_FIELDS.find(f=>f.id===id)||FIND_FIELDS[0]; }
function fieldLabel(id){ return findField(id).label; }

// the whole-sentence transliteration LINE — each multi-word token once, its components never twice
// (the same fold the block header's .strans row makes in js/core/document.js)
function sentTransLine(s){ const out=[]; let k=0;
  while(k<s.tokens.length){ const m=(s.mwt||[]).find(x=>x.from===k+1);
    if(m){ out.push(m.translit||m.form); k=m.to; } else { out.push(s.tokens[k].translit||""); k++; } }
  return out.join(" "); }
// "Anywhere" = sentence id + sentence text + that transliteration line, joined — verbatim the three
// things this bar searched before per-field criteria existed, so the default search is unchanged.
function sentAnyText(s){ return [s.sid||"", s.text||s.tokens.map(t=>t.form).join(" "), sentTransLine(s)].join("  "); }
// "Anywhere" read of ONE TOKEN — every value that token itself stores. MISC goes in whole, so the layers
// riding in it (Gloss / MSeg / MGloss / Translit) are covered without being named a second time. "_" reads
// as empty here exactly as col()'s own get does, so "Anywhere" can never match the canonical placeholder.
function tokAnyText(t){ const v=x=>(x==null||x==="_")?"":String(x);
  return [v(t.form),v(t.lemma),v(t.upos),v(t.xpos),v(t.feats),v(t.head),v(t.deprel),v(t.deps),v(t.misc),v(t.translit)].join("  "); }
function sentSearchText(s){ return sentAnyText(s); }   // the pre-rewrite name, kept as an alias in case anything outside this file reaches for it

/* ── PATTERNS ──────────────────────────────────────────────────────────────────────────────────────
   ONE code path for both modes: plain mode escapes the term and compiles it, so everything below
   (scanning, highlighting, replacing) only ever deals in RegExp. findRe throws on a bad pattern; the
   only caller is compileCrits, which catches and REPORTS. */
function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
function findRe(term){ return new RegExp(FIND.rx?term:reEsc(term), "g"+(FIND.mcase?"":"i")); }
// The active criteria, compiled. Returns [] with FIND.err set when a pattern will not compile — an
// invalid regular expression is surfaced in the panel and by dulling the count, never thrown at the
// console and never left to blank the app.
function compileCrits(){ FIND.err="";
  const out=[];
  for(const c of FIND.crits){ const q=c.q||""; if(!q) continue;   // an empty term is an INACTIVE criterion, not a match-everything one
    let re; try{ re=findRe(q); }
    catch(e){ // the engine's own message repeats the pattern and its flags ("Invalid regular expression:
      // /[a-/gi: Unterminated character class"); the REASON is the useful part, and the field name and the
      // pattern are both already on screen beside it — so keep the tail and say where it came from.
      const why=e.message.replace(/^Invalid regular expression:\s*\/[\s\S]*\/[a-z]*:\s*/,"")||e.message;
      FIND.err=`${fieldLabel(c.f)} — invalid ${FIND.rx?"regular expression":"pattern"}: ${why}`; return []; }
    out.push({f:findField(c.f),q,re}); }
  return out; }
function reHit(re,text){ re.lastIndex=0; return re.test(text||""); }   // the /g flag makes .test stateful → reset every time

/* ── SCANNING ──────────────────────────────────────────────────────────────────────────────────────
   THE CONJUNCTION, and what a "match" IS.
   Criteria on TOKEN fields are conjoined ON ONE TOKEN: a token matches only if EVERY token criterion
   matches it. Criteria on SENTENCE fields are conjoined on the sentence, and filter the sentence that
   CONTAINS those tokens. So "UPOS = NOUN" together with "DepRel = mod" selects the tokens that are
   both, not the sentences that happen to hold one of each — the only reading under which "replace,
   conditional on the search criteria" means anything.
   The UNIT OF A MATCH is therefore the TOKEN whenever any token field carries a term, and the SENTENCE
   when only sentence fields do. Navigation (⏎ / ⇧⏎) still steps sentence to sentence either way, as it
   always has.

   WHERE THE UNION USED TO CREEP IN — and it was never in the two `every` calls below, which have always
   been conjunctions (verified exhaustively: over ~100 000 field-term pairs drawn from a real document,
   the token result was always exactly A ∩ B). It crept in at the SENTENCE GATE, for the one field that
   is BOTH the bar's default AND satisfiable by a token: "Anywhere". Its sentence text is the sid + the
   `# text` + the transliteration line, i.e. it contains every form; so the overwhelmingly common gesture
   — type a word in the bar, open the panel, add "UPOS = NOUN" — passed the gate on the WORD and then
   returned every NOUN in that sentence, the word's own token among them but in no way privileged. What
   the user sees is one set of tokens matching term A beside another matching term B: a union, in every
   sense that matters, and strictly LARGER than either term's own token set.
   The narrowing below is the fix: a sentence criterion whose field can also be read off one token
   (f.tokGet — "Anywhere" and "Sentence transliteration") must be satisfied BY THE MATCHING TOKEN too,
   not merely somewhere in its sentence. It applies ONLY when a token criterion is present, so a
   sentence field on its own still selects whole sentences exactly as it always did — a single-field
   search, the bar's plain ⌘F included, is untouched.
   A sentence field with NO tokGet ("Sentence ID", "Sentence text") keeps filtering the SENTENCE, and
   that is the honest reading rather than a loose end: a sid is not a property of a token, and `# text`
   is a single sandhied string no token is reliably a substring of (see app/sa_csl.py on why). So a
   mixed query of that kind returns the tokens the token criteria select, inside the sentences the
   sentence criteria match — an intersection of the two, each at the level where it means something. */
function scanFind(){ const crits=compileCrits();
  FIND.hits=[]; FIND.matches=[]; FIND.nTok=0;
  if(!crits.length) return;
  const sentC=crits.filter(c=>c.f.scope==="sent"), tokC=crits.filter(c=>c.f.scope==="tok");
  const narrowC=tokC.length?sentC.filter(c=>c.f.tokGet):[];   // …and only when there IS a token criterion: alone, these still select sentences
  DOC.forEach((s,si)=>{
    if(!sentC.every(c=>reHit(c.re,c.f.get(s)))) return;
    if(!tokC.length){ FIND.hits.push({si,toks:null}); FIND.matches.push(si); return; }
    const toks=[];
    s.tokens.forEach((t,i)=>{ if(tokC.every(c=>reHit(c.re,c.f.get(t))) && narrowC.every(c=>reHit(c.re,c.f.tokGet(t)))) toks.push(i+1); });
    if(toks.length){ FIND.hits.push({si,toks}); FIND.matches.push(si); FIND.nTok+=toks.length; } }); }

/* ── HIGHLIGHTING ──────────────────────────────────────────────────────────────────────────────────
   THE CONTRACT WITH THE RENDERERS. The running sentence line (.stext) and the transliteration line
   (.strans) are owned by whoever renders them, and are free to hold element structure inside (typo /
   foreign / reported-speech decoration, say). This highlighter therefore never FLATTENS them, as the
   previous innerHTML rewrite did: it walks the TEXT NODES under the element, wraps matched runs in
   <mark class="findhit">, and on the way out unwraps exactly those marks and calls normalize() to
   re-fuse the split text nodes — so the element returns to the node shape its renderer built, with
   every other element, attribute and listener untouched.
   What it relies on in return is only this: the visible text of .stext/.strans lives in ordinary text
   nodes, and nothing holds a reference to one of those text nodes ACROSS a search (a text node may be
   split at a match boundary and re-fused afterwards). Element references are safe — a mark only ever
   nests inside the element that held the text, never around it. */
/* THE MATCH IS SOUGHT IN THE LINE, NOT IN A TEXT NODE. The running sentence is decorated by paintStext
   (js/core/document.js), which wraps a Foreign word in .stx-frn, a typo in .stx-typo and a reported
   clause in .stx-rep — every one of which SPLITS what used to be a single text node. Matching each node
   on its own therefore lost exactly the matches that straddle a decoration: searching "said that it" over
   "she said ⸢that it rained⸣" found nothing, while the COUNT (which reads the model's own s.text, never
   the DOM — see scanFind) still reported the sentence as a hit, so the bar promised a match it could not
   show. So the nodes are concatenated into ONE string, the patterns run over that, and each run is then
   CUT AT THE NODE BOUNDARIES it crosses. What paintStext emits makes the concatenation exactly the line
   as displayed: its text nodes carry the whole of `disp` and nothing else (the reported-speech corner
   marks are ::before/::after pseudo-elements, and a substituted CorrectForm's rejected spelling lives in
   a data-* attribute), so an offset into `full` is an offset into the visible line.
   A run that crosses a boundary becomes one <mark> PER TEXT NODE it covers, never one <mark> around the
   decoration: a single element cannot wrap a partially-contained one without restructuring the tree, and
   restructuring is precisely what the contract below forbids. The pieces are visually one highlight
   (mark.findhit has no padding and no border) and unwrap independently — unmarkEl + normalize() puts the
   element back in the exact node shape its renderer built, which is what the rest of this app relies on. */
function markInEl(el,res){ if(!el||!res.length) return;
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode(n){
    return (n.parentNode&&n.parentNode.nodeName==="MARK")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT; }});
  const nodes=[]; let n; while((n=walk.nextNode())) nodes.push(n);   // collect first — the walk can't survive the DOM surgery below
  if(!nodes.length) return;
  let full=""; const at=nodes.map(node=>{ const start=full.length; full+=node.data; return {node,start,end:full.length}; });   // the line, plus where each node sits in it
  if(!full) return;
  const spans=[];
  res.forEach(re=>{ re.lastIndex=0; let m;
    while((m=re.exec(full))){ if(m[0]===""){ re.lastIndex++; continue; }   // a pattern that can match nothing ("a*") would otherwise never advance
      spans.push([m.index,m.index+m[0].length]); } });
  if(!spans.length) return;
  spans.sort((a,b)=>a[0]-b[0]);
  const runs=[]; spans.forEach(sp=>{ const last=runs[runs.length-1];   // two criteria can mark overlapping runs (Anywhere + Sentence text) → merge them, or the second <mark> would land inside the first
    if(last&&sp[0]<=last[1]) last[1]=Math.max(last[1],sp[1]); else runs.push(sp.slice()); });
  at.forEach(({node,start,end})=>{ const text=node.data; if(!text) return;
    const local=[];   // this node's share of each run, in the node's OWN offsets — empty for a node no run reaches
    runs.forEach(([a,b])=>{ const x=Math.max(a,start), y=Math.min(b,end); if(y>x) local.push([x-start,y-start]); });
    if(!local.length) return;
    const frag=document.createDocumentFragment(); let i=0;
    local.forEach(([a,b])=>{ if(a>i) frag.appendChild(document.createTextNode(text.slice(i,a)));
      const mk=document.createElement("mark"); mk.className="findhit"; mk.textContent=text.slice(a,b); frag.appendChild(mk); i=b; });
    if(i<text.length) frag.appendChild(document.createTextNode(text.slice(i)));
    node.parentNode.replaceChild(frag,node); }); }   // every other node keeps its own identity and offsets — the map above was taken before any surgery, and replacing one node changes no other's data
function unmarkEl(root){ (root||document).querySelectorAll("mark.findhit").forEach(m=>{ const p=m.parentNode; if(!p) return;
    while(m.firstChild) p.insertBefore(m.firstChild,m);
    p.removeChild(m); p.normalize(); }); }   // normalize() re-fuses the text nodes the mark split, leaving the element in exactly the node shape its renderer built
function clearFindHl(){ document.querySelectorAll(".sblock.findmatch,.sblock.findcur").forEach(b=>b.classList.remove("findmatch","findcur"));
  unmarkEl(document.getElementById("doc"));
  document.querySelectorAll(".sid-in.findsidhit").forEach(s=>s.classList.remove("findsidhit"));
  document.querySelectorAll("#doc .findtok").forEach(e=>e.classList.remove("findtok")); }
function resFor(crits,ids){ return crits.filter(c=>ids.includes(c.f.id)).map(c=>c.re); }   // the compiled patterns that apply to one displayed line — "Anywhere" covers all three
function highlightFind(){ clearFindHl(); const crits=compileCrits(); if(!crits.length) return;
  const textRes=resFor(crits,["any","text"]), trRes=resFor(crits,["any","strans"]), sidRes=resFor(crits,["any","sid"]);
  FIND.hits.forEach((h,k)=>{ const b=document.querySelector(`.sblock[data-i="${h.si}"]`); if(!b) return;
    b.classList.add("findmatch"); if(k===FIND.cur) b.classList.add("findcur");
    markInEl(b.querySelector(".stext"),textRes); markInEl(b.querySelector(".strans"),trRes);
    const sid=b.querySelector(".sid-in"); if(sid && sidRes.some(re=>reHit(re,sid.textContent||""))) sid.classList.add("findsidhit");   // .sid-in is a contenteditable span (js/core/document.js), not an <input> — textContent, not .value
    // A token match can't be drawn as a <mark>: the grid cells are <input>/<textarea> and the diagram is
    // SVG. Mark the whole TOKEN instead — its grid row and its diagram group each take .findtok.
    (h.toks||[]).forEach(id=>{ const tr=b.querySelector(`tr[data-s="${h.si}"][data-tok="${id}"]`); if(tr) tr.classList.add("findtok");
      const g=(typeof tokGroupOf==="function")?tokGroupOf(h.si,id):null; if(g) g.classList.add("findtok"); }); }); }

/* ── COUNT, NAVIGATION ─────────────────────────────────────────────────────────────────────────── */
function findCountText(){ if(FIND.err) return "—";
  if(!FIND.matches.length) return FIND.crits.some(c=>c.q)?"0":"";
  return `${FIND.cur+1}/${FIND.matches.length}`; }
function updateFindUI(){ const c=document.getElementById("tbCount");
  if(c){ c.textContent=findCountText(); c.classList.toggle("finderr",!!FIND.err); }
  const inp=document.getElementById("tbSearch"); if(inp) inp.classList.toggle("findbad", !!FIND.err && !!(FIND.crits[0]||{}).q);
  updateFindPanel(); }
function scrollToMatch(smooth){ const idx=FIND.matches[FIND.cur];
  const b=(typeof scrollToSentence==="function")?scrollToSentence(idx):document.querySelector(`.sblock[data-i="${idx}"]`);   // scrollToSentence (js/core/document.js) brings the match into the rendered window first if it isn't already there — a match can be anywhere in the document, not just near whatever's currently on screen
  if(b){ FIND._scrolled=idx; b.scrollIntoView({block:"center",behavior:smooth?"smooth":"auto"}); highlightFind(); } }   // re-highlight: scrollToSentence may have re-rendered the window, which already re-ran highlightFind once — but a smooth scrollIntoView can itself trigger another window shift on the way, so make sure the mark lands on the block we actually end up at
function runFind(){ scanFind();
  FIND.cur=FIND.matches.length?0:-1; updateFindUI(); highlightFind();
  if(FIND.cur>=0 && FIND.matches[FIND.cur]!==FIND._scrolled) scrollToMatch(false); }   // instant, only when the target block changes → no scroll wobble while typing
function gotoMatch(dir){ if(!FIND.matches.length) return; FIND.cur=(FIND.cur+dir+FIND.matches.length)%FIND.matches.length;
  updateFindUI(); highlightFind(); scrollToMatch(true); }

/* ── REPLACE ───────────────────────────────────────────────────────────────────────────────────────
   HOW A REPLACE TARGETS A FIELD. You replace WITHIN ONE NAMED FIELD, on exactly the tokens (or
   sentences) the criteria selected, and what is replaced inside that field is THAT FIELD'S OWN TERM.
   So the replace field must be one of the fields being searched — which is not a restriction in
   practice but the natural workflow: to rewrite "Number=Sing" you type it in the Feats row anyway, and
   every further row you add ("UPOS = NOUN") narrows WHICH tokens it is rewritten in. It also keeps
   "conditional on the search criteria" exact: there is never a second, unstated pattern. Derived
   fields (Anywhere, Sentence transliteration) name no single place to write and are not offered.

   BACKREFERENCES. The user asked for "\1"; String.replace speaks "$1". Both work: the template is
   rewritten once (replTemplate) so "\1"…"\9" become "$1"…"$9" and "\\" becomes one literal backslash,
   while any other "\x" survives verbatim rather than being silently swallowed. "$" keeps its native
   meaning, so "$1", "$&" and "$<name>" work too. In PLAIN (non-regex) mode the replacement is wholly
   literal — what you type is what lands — which is what every plain find/replace does. */
function replTemplate(rep){ let out="",i=0;
  while(i<rep.length){ const c=rep[i];
    if(c!=="\\"){ out+=c; i++; continue; }
    const n=rep[i+1];
    if(n===undefined){ out+="\\"; i++; }                       // a trailing lone backslash is itself
    else if(n>="0"&&n<="9"){ out+="$"+n; i+=2; }               // \1 … \9 → $1 … $9
    else if(n==="\\"){ out+="\\"; i+=2; }                      // \\ → one literal backslash
    else { out+="\\"+n; i+=2; } }                              // anything else survives as typed
  return out; }
function replFor(){ return FIND.rx ? replTemplate(FIND.replV) : FIND.replV.replace(/\$/g,"$$$$"); }   // plain mode: "$" is a literal, so double it for String.replace
function replCandidates(){ const seen=new Set(), out=[];   // the fields a replace may target: those carrying a term AND holding a value that is actually stored
  FIND.crits.forEach(c=>{ if(!c.q) return; const f=findField(c.f); if(!f.put||seen.has(f.id)) return; seen.add(f.id); out.push(f); });
  return out; }
function replTargetField(){ const cands=replCandidates(); if(!cands.length) return null;
  return cands.find(f=>f.id===FIND.replF) || cands[0]; }
/* What a Replace All WOULD do, computed before anything changes: one entry per value that actually
   differs. Nothing here mutates the document — that is what makes the count, the preview and the
   confirmation honest, and what lets the whole rewrite land as ONE undo entry below. */
function planReplace(){ const f=replTargetField(); if(!f) return null;
  const crits=compileCrits(); if(FIND.err||!crits.length) return null;
  const c=crits.find(x=>x.f.id===f.id); if(!c) return null;
  const tmpl=replFor(), plan=[];
  FIND.hits.forEach(h=>{ const s=DOC[h.si];
    const targets = f.scope==="sent" ? [s] : (h.toks||[]).map(id=>s.tokens[id-1]).filter(Boolean);
    targets.forEach(o=>{ const before=f.get(o); c.re.lastIndex=0;
      const after=before.replace(c.re,tmpl);
      if(after===before) return;
      if(f.id==="sid" && !after.trim()) return;   // a sentence may not be left without an id (see that field's own put) — such a match is not a change this can make
      plan.push({si:h.si,o,before,after,sent:s}); }); });
  return {f,plan}; }
async function runReplaceAll(){ const p=planReplace();
  if(!p){ toast(FIND.err?"Fix the search pattern first":"Choose a field to replace in"); return; }
  const {f,plan}=p;
  if(!plan.length){ toast("Nothing to replace — no match differs from its replacement"); return; }
  const sents=new Set(plan.map(x=>x.si)).size;
  const unit = f.scope==="sent" ? `${plan.length} sentence${plan.length===1?"":"s"}`
                                : `${plan.length} token${plan.length===1?"":"s"} across ${sents} sentence${sents===1?"":"s"}`;
  // Name the cost before paying it, as every other bulk rewrite in this app does (see storedPick).
  if(!(await askConfirm(`Replace in ${f.label} on ${unit}? “${plan[0].before}” becomes “${plan[0].after}”. Undo reverses the whole replacement in one step.`,
      {okLabel:"Replace All"}))) return;
  const pre=snap();                                    // taken BEFORE the rewrite and committed ONCE, so the whole operation is a single undo entry
  plan.forEach(({o,after,sent})=>f.put(o,after,sent));
  if(typeof invalidateColW==="function") invalidateColW();   // a bulk rewrite can touch any field across any number of sentences — full rescan rather than tracking every touched sentence individually
  if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // same reasoning for the notation-switch diagram cache (js/core/document.js) — Replace All is exactly the "any of an arbitrary set of sentences" case pruneDiaCache's per-si tracking isn't built for
  commitSnap(pre); markDirty();
  preserveScroll(renderDoc);
  scanFind(); FIND.cur=FIND.matches.length?Math.min(Math.max(FIND.cur,0),FIND.matches.length-1):-1;   // the values changed under the criteria → re-scan rather than leave a stale count behind
  updateFindUI(); if(FIND.open) highlightFind(); else clearFindHl();   // renderDoc above re-highlighted from the PRE-replace hit list (see its FIND.open branch); redo it from the new one — or strip it, if this was reached with the bar closed
  toast(`Replaced ${f.label} in ${unit}`); }

/* ── THE PANEL ─────────────────────────────────────────────────────────────────────────────────── */
// A field chooser built from the same .fpmenu/.fpitem rows the titlebar proxy menu and the Save-As
// "Where" button use, so it reads like every other small menu in the app rather than a bare <select>.
let _ffMenu=null;
function closeFieldMenu(){ if(_ffMenu){ _ffMenu.remove(); _ffMenu=null;
  document.removeEventListener("mousedown",_ffOutside,true); document.removeEventListener("keydown",_ffKey,true); } }
function _ffOutside(e){ if(_ffMenu && !_ffMenu.contains(e.target)) closeFieldMenu(); }
if(typeof registerEscDismiss==="function") registerEscDismiss(()=>!!_ffMenu,()=>closeFieldMenu(),20);   // narrower than the find bar itself
function _ffKey(e){ if(_ffMenu && e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeFieldMenu(); } }   // Escape cancels the NARROWEST open thing first (see the ladder in js/editing/context-menu.js) — this menu, not the find bar behind it
function openFieldMenu(anchor,fields,current,onPick){ closeFieldMenu();
  const m=document.createElement("div"); m.className="fpmenu findfmenu"; _ffMenu=m;
  let lastScope=null;
  fields.forEach(f=>{ if(lastScope!==null && f.scope!==lastScope){ const sep=document.createElement("div"); sep.className="findfsep"; m.appendChild(sep); }   // hairline between the sentence-level fields and the token-level ones
    lastScope=f.scope;
    const it=document.createElement("button"); it.type="button"; it.className="fpitem"+(f.id===current?" cur":"");
    const ck=document.createElement("span"); ck.className="findfck"; ck.textContent=(f.id===current)?"✓":""; it.appendChild(ck);
    const t=document.createElement("span"); t.textContent=f.label; it.appendChild(t);
    it.addEventListener("click",()=>{ closeFieldMenu(); onPick(f.id); });
    m.appendChild(it); });
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect(), mw=m.offsetWidth, mh=m.offsetHeight;
  m.style.left=Math.max(6,Math.min(r.left,innerWidth-mw-8))+"px";
  m.style.top=Math.max(6,Math.min(r.bottom+4,innerHeight-mh-8))+"px";
  setTimeout(()=>{ document.addEventListener("mousedown",_ffOutside,true); document.addEventListener("keydown",_ffKey,true); },0); }
// The chevron is the SAME inline SVG every other pull-down in the app draws (.drawer-btn's, verbatim) —
// not the "⌄" text glyph this used to carry. Measured, at this button's 12px label: that glyph's INK is
// 6.0 × 3.4 px and sits with its centre 3.3 px BELOW the label's cap-height centre, because U+2304 is
// drawn low in its em box and `align-items:center` centres the LINE BOX, not the ink. The SVG's box IS
// its ink, so centring the box centres the mark. See the sizing note in app.css's FIND & REPLACE block.
function fieldBtn(id,fields,onPick){ const b=document.createElement("button"); b.type="button"; b.className="findfield";
  b.innerHTML=`<span class="findfname"></span><svg class="findfchev" viewBox="0 0 10 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>`;
  b.querySelector(".findfname").textContent=fieldLabel(id); b.title="Field to search";
  b.addEventListener("click",e=>{ e.preventDefault(); openFieldMenu(b,fields,id,onPick); });
  return b; }
function renderCrits(){ const host=document.getElementById("findCrits"); if(!host) return; host.textContent="";   // the EXTRA criteria rows (crits[1…]); crits[0] lives in the bar itself
  FIND.crits.forEach((c,i)=>{ if(!i) return;
    const row=document.createElement("div"); row.className="findcrit";
    row.appendChild(fieldBtn(c.f,FIND_FIELDS,id=>{ c.f=id; renderCrits(); runFind(); }));
    const inp=document.createElement("input"); inp.type="text"; inp.className="findterm"; inp.value=c.q; inp.spellcheck=false;
    inp.placeholder="Term"; inp.setAttribute("autocorrect","off"); inp.setAttribute("autocapitalize","off"); inp.setAttribute("autocomplete","off");
    inp.addEventListener("input",()=>{ c.q=inp.value; runFind(); });
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); gotoMatch(e.shiftKey?-1:1); }
      else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeFind(); } });
    row.appendChild(inp);
    const rm=document.createElement("button"); rm.type="button"; rm.className="findrm"; rm.textContent="✕"; rm.title="Remove this field";
    rm.addEventListener("click",()=>{ FIND.crits.splice(i,1); renderCrits(); runFind(); });
    row.appendChild(rm); host.appendChild(row); }); }
// The live "what will change" report: how much the criteria select and — once a replacement is
// entered — what the first change actually looks like. A preview costs one planReplace() over an
// already-scanned hit list, so it is cheap enough to keep current on every keystroke.
function updateFindPanel(){ const st=document.getElementById("findStat"); if(!st) return;
  const btn=document.getElementById("findReplAll"), rf=document.getElementById("findReplField");
  const cands=replCandidates(), target=replTargetField();
  if(rf){ rf.querySelector(".findfname").textContent=target?target.label:"—"; rf.disabled=!cands.length;
    rf.title=cands.length?"Field to replace in — one of the fields you are searching":"Give a field a search term first"; }
  if(FIND.err){ st.textContent=FIND.err; st.className="findstat finderr"; if(btn)btn.disabled=true; return; }
  st.className="findstat";
  if(!FIND.crits.some(c=>c.q)){ st.textContent=""; if(btn)btn.disabled=true; return; }
  const sents=FIND.matches.length;
  let msg = FIND.nTok ? `${FIND.nTok} token${FIND.nTok===1?"":"s"} in ${sents} sentence${sents===1?"":"s"}`
                      : `${sents} sentence${sents===1?"":"s"}`;
  const p=(target&&FIND.replV!=="")?planReplace():null;
  if(p&&p.plan.length) msg+=` · ${p.plan.length} to change, e.g. “${p.plan[0].before}” → “${p.plan[0].after}”`;
  else if(p) msg+=" · nothing to change";
  st.textContent=msg;
  if(btn) btn.disabled=!(p&&p.plan.length); }
function setExpanded(on){ FIND.expanded=!!on;
  const p=document.getElementById("findPanel"), b=document.getElementById("findMore");
  if(p) p.hidden=!FIND.expanded;
  if(b){ b.setAttribute("aria-expanded",FIND.expanded?"true":"false");
    b.title=(FIND.expanded?"Hide":"Show")+" the field and replace options"; }
  if(FIND.expanded){ renderCrits(); updateFindPanel(); } }

/* ── OPEN / CLOSE ──────────────────────────────────────────────────────────────────────────────────
   Find is a floating pop-up overlay (#findBar) — ⌘F / the View menu open it; Esc / the ✕ close it. */
function openFind(){ FIND.open=true; const bar=document.getElementById("findBar"), inp=document.getElementById("tbSearch");
  if(bar){ const doc=document.getElementById("doc"); if(doc){ const r=doc.getBoundingClientRect(); bar.style.top=Math.round(r.top+docTopInset()+8)+"px"; }   // sit just below the overlaid titlebar + options bar (docTopInset = live combined bar height; tracks the options bar being toggled on/off)
    bar.classList.add("show"); }
  setExpanded(FIND.expanded);
  if(inp){ inp.focus(); inp.select(); FIND.crits[0].q=inp.value; runFind(); } }
/* Find and Replace (⌥⌘F) is not a second dialog — it is this same bar with its panel already down and
   the caret where the work is. Menu item and key equivalent are ONE NSMenuItem (app/__main__.py), so
   the two cannot drift and the item's always-enabled state is honest: it opens the panel whatever the
   document holds. Focus follows what there is to do — a replacement with no search term can do nothing,
   so until some criterion carries one the caret belongs in the TERM field, not the replacement. */
function openFindReplace(){ openFind(); setExpanded(true);
  const rv=document.getElementById("findRepl"), inp=document.getElementById("tbSearch");
  const tgt=FIND.crits.some(c=>c.q)?rv:inp;
  if(tgt){ tgt.focus(); if(tgt.select) tgt.select(); } }
// …and on the shared ladder, so Escape dismisses the bar even when focus has left it entirely (see
// registerEscDismiss in js/core/prefs.js). Rank 50: wider than the field menu that opens on top of it (which
// registers narrower), so one press closes that menu and a second closes the bar.
if(typeof registerEscDismiss==="function") registerEscDismiss(()=>!!(typeof FIND!=="undefined"&&FIND.open),()=>closeFind(),50);
function closeFind(){ FIND.open=false; closeFieldMenu();
  const bar=document.getElementById("findBar"), inp=document.getElementById("tbSearch");
  if(bar) bar.classList.remove("show");
  if(inp){ inp.value=""; inp.blur(); }
  FIND.crits=[{f:(FIND.crits[0]||{}).f||"any",q:""}];   // the extra criteria rows go with the bar; the FIELD chosen in the bar is remembered, as the regex/case toggles are
  FIND.replV=""; const rv=document.getElementById("findRepl"); if(rv) rv.value="";
  FIND.hits=[]; FIND.matches=[]; FIND.nTok=0; FIND.cur=-1; FIND.err="";
  renderCrits(); updateFindUI(); clearFindHl(); }

/* ── WIRING ────────────────────────────────────────────────────────────────────────────────────────
   Eager top-level code, so it may only touch the DOM and this file's own functions — every module that
   loads AFTER this one (undo, bridge, translit-load…) is reached from inside a handler, never from
   here. See the classic-script hazard note in CLAUDE.md. */
(function(){ const inp=document.getElementById("tbSearch"); if(!inp) return;
  const $=id=>document.getElementById(id);
  const escKey=e=>{ if(e.key!=="Escape") return false; e.preventDefault(); e.stopPropagation(); closeFind(); return true; };   // preventDefault is what stops AppKit's cancelOperation: beep on a gesture that DID do something
  inp.addEventListener("input",()=>{ FIND.open=true; FIND.crits[0].q=inp.value; runFind(); });
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); gotoMatch(e.shiftKey?-1:1); } else escKey(e); });
  const p=$("findPrev"), n=$("findNext"), c=$("findClose");
  if(p) p.onclick=()=>{ gotoMatch(-1); inp.focus(); };
  if(n) n.onclick=()=>{ gotoMatch(1); inp.focus(); };
  if(c) c.onclick=()=>closeFind();
  const more=$("findMore"); if(more) more.onclick=()=>setExpanded(!FIND.expanded);
  const f0=$("findField0");   // the bar's own field chooser drives crits[0]
  if(f0) f0.onclick=e=>{ e.preventDefault(); openFieldMenu(f0,FIND_FIELDS,FIND.crits[0].f,id=>{ FIND.crits[0].f=id;
    f0.querySelector(".findfname").textContent=fieldLabel(id);
    inp.placeholder = id==="any" ? "Find in document" : "Find in "+fieldLabel(id).toLowerCase();
    runFind(); }); };
  const toggle=(el,get,set)=>{ if(!el) return; el.setAttribute("aria-pressed",get()?"true":"false");
    el.onclick=()=>{ set(!get()); el.setAttribute("aria-pressed",get()?"true":"false"); runFind(); inp.focus(); }; };
  toggle($("findRegex"),()=>FIND.rx,v=>{FIND.rx=v;});
  toggle($("findCase"),()=>FIND.mcase,v=>{FIND.mcase=v;});
  const add=$("findAddField"); if(add) add.onclick=()=>{ FIND.crits.push({f:"form",q:""}); renderCrits(); updateFindPanel();
    const rows=document.querySelectorAll("#findCrits .findterm"); if(rows.length) rows[rows.length-1].focus(); };
  const rf=$("findReplField");
  if(rf) rf.onclick=e=>{ e.preventDefault(); const cands=replCandidates(); if(!cands.length) return;
    openFieldMenu(rf,cands,(replTargetField()||{}).id,id=>{ FIND.replF=id; updateFindPanel(); }); };
  const rv=$("findRepl");
  if(rv){ rv.addEventListener("input",()=>{ FIND.replV=rv.value; updateFindPanel(); });
    rv.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); runReplaceAll(); } else escKey(e); }); }   // Enter here means "do it" — it still goes through the confirmation, so it can never fire a bulk rewrite on its own
  const go=$("findReplAll"); if(go){ go.disabled=true; go.onclick=()=>runReplaceAll(); }
})();
