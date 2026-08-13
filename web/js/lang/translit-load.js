//@module js/translit-load.js
/* ── transliteration (wiktra, language-driven) ───────────────────────────── */
// Read a Translit= value out of a CoNLL-U MISC field (|-delimited Key=Value pairs); "" when absent.
function miscTranslit(misc){ if(!misc||misc==="_")return""; const m=/(?:^|\|)Translit=([^|]*)/.exec(misc); return m?m[1]:""; }
// token glosses live in MISC Gloss (a standard UD MISC attribute); they round-trip through io_conllu with the rest of MISC.
function miscKV(misc,key){ if(!misc||misc==="_")return""; const m=new RegExp("(?:^|\\|)"+key+"=([^|]*)").exec(misc); return m?m[1]:""; }   // read any MISC Key=Value ("" if absent)
function miscGloss(misc){ return miscKV(misc,"Gloss"); }
// Whether a token carries the hand-placed "reported speech" mark (MISC Reported=Yes — see
// toggleReported/edit-ops.js). Called from document.js/edit-ops.js/context-menu.js/diagram-wrap.js,
// all of which load BEFORE this file in index.html — safe regardless, since every call site only
// runs from a later user interaction (menu build, diagram render, command dispatch), never at each
// script's own top-level execution, so what matters is that isReported exists by the time a user can
// actually trigger one of those, not which <script> tag declares it.
function isReported(t){ return miscKV(t&&t.misc,"Reported")==="Yes"; }
const INVISIBLE_RE=/[​‌‍﻿­]/g;   // zero-width space/joiners, BOM, soft hyphen — invisible Unicode "format" characters that survive both Python's and JS's \s (they're category Cf, not Zs), so they slip past every whitespace-collapse/trim untouched. Wiktionary's scraped HTML sometimes trails one at the end of a definition (e.g. a wrap hint around a citation link) — left in place, it lands right at the gloss's dot-join seam and shows up as an invisible "gap" between the lexical and grammatical parts of a morphemic gloss.
const GLOSS_WS_RE=/[\r\n\t]/g;   // stray literal CR/LF/tab characters found in an ALREADY-STORED gloss tier (unlike INVISIBLE_RE's zero-width Cf characters, these DO have visible advance — they render as a stray gap hugging a dot-join seam, e.g. around the "." between a lexical stem and a Leipzig abbreviation). Stripped at the same read accessors as INVISIBLE_RE, below.
function glossEnc(v){ return (v||"").replace(INVISIBLE_RE,"").replace(/[|\t\n]+/g," ").trim(); }   // keep MISC well-formed: no bar (the field delimiter), tab or newline, or invisible junk — a real tab/newline COLLAPSES to a space here (word-separator semantics for freshly-typed/committed text), unlike GLOSS_WS_RE's outright strip for already-stored data at the read accessors
function tokGloss(o){ return o?miscGloss(o.misc):""; }
// ── the POS hint that travels with a form to the romanisation engines ─────────────────────────────
// A Han character is heteronymic by PART OF SPEECH as much as by anything else — 行 reads háng as a
// NOUN ("row, line") and xíng as a VERB ("to walk") — so every form handed to app/translit.py now
// travels with the tag of the token it came from, and the backend REORDERS that form's candidate
// readings by it. "" = no opinion, which is exactly the POS-blind answer the app gave before the hint
// existed, so an untagged token is unaffected. CoNLL-U spells an absent value "_"; that is the
// column's placeholder, not a part of speech, and it must not be sent as one.
function trUpos(t){ const u=(t&&t.upos)||""; return (u==="_")?"":u; }
// …and the key EVERY de-duplicating pass below is rebuilt around. Those passes batch one bridge entry
// per DISTINCT string, and the answer now depends on the tag as well — so 行 the NOUN and 行 the VERB
// have to be two entries. Keyed on the form alone, whichever token was reached first would decide the
// reading for every other token spelt the same way, and the hint would silently do nothing at all —
// which is the same collapse the READINGS_CACHE key in js/lang/readings.js had to be widened against.
// NUL joins the two halves because neither a surface form nor a UPOS tag can contain one.
function trKey(text,upos){ return text+"\u0000"+(upos||""); }
// ── the STORED transliteration drives the DISPLAYED one (item: click-editable Stored) ────────────
// A hand-corrected stored value (MISC Translit, in STORED_SCHEME — marked _trPick) is authoritative, and
// the transliteration ROW is DERIVED FROM IT rather than romanised from the surface form again: correcting
// 行's stored Pinyin to háng makes the Zhuyin row read ㄏㄤˊ and the Gwoyeu Romatzyh row harng, not the
// default xíng reading of either. Runs between fillTranslit's fromMisc pass (which leaves a _trPick token
// alone) and its automatic pass — whose from-the-form romanisation is exactly the fallback for a scheme
// pair that cannot be related at all (translit.derive_scheme returns "" there; General Chinese is keyed by
// character, not by reading, so no correction to a Mandarin reading can move it).
async function deriveTrPicks(){ const items=[];
  DOC.forEach(s=>s.tokens.forEach(t=>{ if(t._trPick&&!t.translit){ const st=miscTranslit(t.misc); if(st) items.push([t,st]); } }));
  if(!items.length) return false;
  let any=false;
  if(!STORED_SCHEME||!TRANSLIT_SCHEME||STORED_SCHEME===TRANSLIT_SCHEME){ items.forEach(([t,st])=>{ t.translit=st; any=true; }); return any; }   // Displayed IS Stored — every abjad has one scheme, and Displayed defaults TO the stored scheme elsewhere — so the stored string IS the displayed one; no round-trip
  let d=[]; try{ const r=await window.pywebview.api.translit_derive(items.map(x=>x[0].form),items.map(x=>x[1]),DOCLANG,STORED_SCHEME,TRANSLIT_SCHEME); d=(r&&r.translit)||[]; }catch(e){ d=[]; }
  items.forEach(([t],i)=>{ if(d[i]){ t.translit=d[i]; any=true; } });   // "" ⇒ not derivable → leave the row empty for the automatic pass to romanise the form
  return any; }
// A correction saved to MISC and reopened is indistinguishable from an automatic value IN THE FILE — CoNLL-U
// has no "corrected by hand" flag and this app will not invent a column for one — so it is recovered by
// COMPARISON: for a language whose romanisation is non-deterministic, a stored value that differs from what
// the stored scheme's own engine produces for that form can only have been put there by hand, so it is taken
// as a correction and drives the displayed row from then on. Restricted to those languages: everywhere else
// the romanisation is deterministic and a differing MISC Translit is far likelier to be another tool's
// romanisation system than a correction of this one. Checked once per token per scheme (_trChk).
async function adoptStoredPicks(){ if(!TRANSLIT_AMBIG||!STORED_SCHEME) return false;
  const items=[], need=new Map();   // (form, upos) → [form, upos]: the comparison this pass makes is against what THIS token's tag would have produced, so the batch is keyed on the pair (see trKey)
  DOC.forEach(s=>s.tokens.forEach(t=>{ if(t._trPick||t._trChk||!t.form) return; const st=miscTranslit(t.misc); if(!st) return; const u=trUpos(t); items.push([t,st,u]); if(!need.has(trKey(t.form,u))) need.set(trKey(t.form,u),[t.form,u]); }));
  if(!items.length) return false;
  const batch=[...need.values()]; let r;
  try{ r=await window.pywebview.api.transliterate(batch.map(x=>x[0]),DOCLANG,STORED_SCHEME,batch.map(x=>x[1])); }catch(e){ return false; }   // the STORED scheme's own rendering of each form — what an automatic pass would have written
  const map={}; batch.forEach((x,i)=>{ map[trKey(x[0],x[1])]=(r&&r.translit&&r.translit[i])||""; });
  let any=false;
  items.forEach(([t,st,u])=>{ t._trChk=1; const auto=map[trKey(t.form,u)]||"";   // no rendering at all (an engine whose extras tier is missing) ⇒ nothing to compare against, so nothing is adopted
    if(auto&&st!==auto){ t._trPick=true; t._trMisc=true; t.translit=""; any=true; } });
  return any; }
/* THE DOCUMENT'S OWN MISC Translit IS THE SOURCE — the file already holds a romanisation for every
   token that has one, so opening it must not re-derive what it can read. This used to discard MISC
   the moment a display scheme was selected (`TRANSLIT_SCHEME ? "" : miscTranslit(misc)`) and hand
   EVERY unique form to the engines instead, which on a large document is two full passes over the
   bridge — adoptStoredPicks' comparison pass and the automatic pass below — plus the re-render each
   triggers, all to arrive at strings the file already contained.
   Now: the stored value is taken always, and only CONVERTED when the displayed scheme differs from
   the stored one (translit_derive, one deduplicated batch — "held in Pinyin, shown in Zhuyin").
   Where a pair cannot be related at all it comes back "" and the automatic pass romanises the form,
   exactly as before, so nothing that used to be filled is left blank.
   The same-scheme case now costs NOTHING: no engine call, no bridge round-trip, no waiting render. */
/* CSL takes the whole sentence, so it takes its own path and returns before any of the machinery
   below runs. That machinery is built on one assumption this scheme breaks: that a token's
   romanisation is a function of its surface, so identical surfaces share one answer and the batch
   can be deduplicated on (form, upos). A CSL mark is a fact about the JUNCTION — the same `vartmā`
   is `vartm"` before a vowel and `vartmā` before a pause — so deduplicating by surface would let
   whichever one was reached first answer for all of them, which is exactly the bug the (form, upos)
   key was introduced to fix for Han heteronyms. Nothing here touches MISC: CSL is display-only and
   is not offered as a Stored scheme (see app/sa_notation.py). */
async function fillTranslitCSL(){
  const sents=[], refs=[];
  DOC.forEach(s=>{ const T=s.tokens||[]; if(!T.length) return;
    sents.push({forms:T.map(t=>t.form||""), unsandhied:T.map(t=>miscKV(t.misc,"Unsandhied")||""),
                feats:T.map(t=>t.feats||""), lemmas:T.map(t=>(t.lemma&&t.lemma!=="_")?t.lemma:""),
                mwt:(s.mwt||[]).map(m=>[m.from,m.to])});
    refs.push(s); });
  if(!sents.length) return false;
  let r; try{ r=await window.pywebview.api.sanskrit_csl(sents); }catch(e){ return false; }
  const rows=r&&r.csl; if(!rows||rows.length!==refs.length) return false;
  let any=false;
  refs.forEach((s,i)=>{ const got=rows[i]||[];
    s.tokens.forEach((t,j)=>{ const v=got[j]||"";
      if(t.translit!==v){ t.translit=v; any=true; }
      // the lemma has no junction to stand in, so it keeps its ordinary romanisation
      if(!t.translitLemma&&t.lemma&&t.lemma!=="_"&&t.lemma===t.form) t.translitLemma=v; });
    /* …AND THE MWT RANGES. Every row that draws a sentence shows an MWT ONCE, by its range, not as its
       component tokens — so with `m.translit` unset the line fell back to `m.form`, the plain sandhied
       word, and the markers the scheme exists for were nowhere on it.
       ⚠ THE SEPARATOR IS PER JUNCTION, NOT PER RANGE, and `Compound=Yes` on the LEFT member is what
       chooses it. An MWT is one written word, but its members need not all belong to one GRAMMATICAL
       word: DCS groups `vartma | a | punarjanmanām` into `vartmāpunarjanmanām` because the text writes
       it solid, and only the first junction there is external sandhi between two words — the second is
       inside a compound. CSL distinguishes them, which is the whole reason it marks junctions:
         · left member has Compound=Yes → a compound seam  → `-`   (`mūrti-tve`, `ātma-vidām`)
         · it does not                  → external sandhi  → a space (`vartm' â-…`, `ātm" êty`)
       Read off this repository's own pre-DCS CSL text (`git show 7c60890:samples/brihat_jataka.conllu`),
       which spells exactly those four: `vartm" â-punar-janmanām`, `ātm" êty`, `ātma-vidāṃ`. Joining the
       range with one separator throughout got `vartm'-â-punarjanmanām`, which asserts a compound that
       is not there. See saCslSep in js/lang/translit.js on why the seam is `-`.
       `isCompoundFeat` is js/io/bridge.js's, which loads before this file. */
    const seam=(sc)=>(typeof saCslSep==="function")?saCslSep(sc):"-";
    (s.mwt||[]).forEach(m=>{ const hi=Math.min(m.to,s.tokens.length); let v="";
      for(let k=m.from;k<=hi;k++){ const t=s.tokens[k-1]; const piece=got[k-1]||t.form||"";
        if(k>m.from) v+=((typeof isCompoundFeat==="function"&&isCompoundFeat(s.tokens[k-2].feats))?seam(m):" ");
        v+=piece; }
      if(v && m.translit!==v){ m.translit=v; any=true; } }); });
  if(any){ if(typeof invalidateDiaCache==="function") invalidateDiaCache(); preserveScroll(renderDoc); }
  return any; }
async function fillTranslit(){ if(!hasBridge()||!DOCLANG) return;   // transliteration is enabled only when a model sets the language
  if(TRANSLIT_SCHEME==="csl"&&isSanskritLang()) return void await fillTranslitCSL();
  let any=false;
  const same=(!TRANSLIT_SCHEME||!STORED_SCHEME||STORED_SCHEME===TRANSLIT_SCHEME);   // is the row showing the scheme the file stores?
  // …and only THEN is a hand correction worth detecting: adoptStoredPicks exists so a corrected value
  // drives a DERIVED row (see its own note), but when the row shows the stored scheme the stored value
  // is displayed verbatim whether or not it was corrected — so its full comparison pass over every
  // form (a second engine pass, the expensive half of an open) buys nothing and is skipped.
  if(!same && await adoptStoredPicks()) any=true;   // before the passes below: an adopted correction must be treated as one by both of them
  const derive=[];   // [obj, field, surface, storedValue] — a stored romanisation to re-express in the displayed scheme
  const fromMisc=(o,misc)=>{ if(o._trPick) return;   // a reading PICKED by hand from the CJK readings flyout (js/lang/readings.js) is authoritative for as long as the scheme it was picked under is displayed — it is already both in o.translit and in MISC, and re-deriving it here would silently put the automatic (wrong) reading back
    const mt=miscTranslit(misc);
    if(mt){ o._trMisc=true;
      if(same){ if(o.translit!==mt){ o.translit=mt; any=true; } }   // the stored string IS the displayed one
      else if(!o.translit) derive.push([o,"translit",o.form,mt]); }
    else if(o._trMisc){ o.translit=""; o._trMisc=false; any=true; } };   // MISC Translit removed → clear so the automatic pass below refills it
  // …and a token's LEMMA romanisation the same way, from MISC LTranslit — the companion key
  // annotateTranslitMisc writes beside Translit, and the one msegPrefillParts already reads in
  // preference to the cached value. Without this the lemma column alone kept the whole engine pass
  // alive on open (one entry per distinct lemma, i.e. most of the document) even where every FORM was
  // answered from MISC. The identity below covers what LTranslit doesn't: where the lemma IS the form
  // — the ordinary case in Chinese, and common everywhere — its romanisation is by definition the
  // form's, so it needs neither a stored value nor a call.
  const fromMiscLemma=t=>{ if(!t.lemma||t.lemma==="_"||t.translitLemma) return;
    const lt=miscKV(t.misc,"LTranslit");
    if(lt){ if(same){ t.translitLemma=lt; any=true; } else derive.push([t,"translitLemma",t.lemma,lt]); }
    else if(t.lemma===t.form&&t.translit){ t.translitLemma=t.translit; any=true; } };
  DOC.forEach(s=>{ s.tokens.forEach(t=>{ fromMisc(t,t.misc); fromMiscLemma(t); });
    (s.mwt||[]).forEach(m=>fromMisc(m, m._cols?m._cols[9]:m.misc)); });   // an MWT's MISC is column 9 of its raw CoNLL-U row
  if(derive.length){
    // ONE batch, deduplicated by (surface, stored): a document repeats its words, and the conversion
    // depends on nothing else — so a 20,000-token text of 3,000 distinct spellings crosses the bridge
    // 3,000 times, not 20,000. Forms and lemmas share the batch; each entry carries the field to fill.
    const key=x=>x[2]+"\u0000"+x[3], uniq=new Map();
    derive.forEach(it=>{ if(!uniq.has(key(it))) uniq.set(key(it), it); });
    const batch=[...uniq.values()]; let d=[];
    try{ const r=await window.pywebview.api.translit_derive(batch.map(x=>x[2]),batch.map(x=>x[3]),DOCLANG,STORED_SCHEME,TRANSLIT_SCHEME); d=(r&&r.translit)||[]; }catch(e){ d=[]; }
    const got={}; batch.forEach((it,i)=>{ if(d[i]) got[key(it)]=d[i]; });
    derive.forEach(it=>{ const v=got[key(it)]; if(v){ it[0][it[1]]=v; any=true; } });   // "" ⇒ not derivable (a character-keyed scheme, an unrecognised reading) → left for the automatic pass
    DOC.forEach(s=>s.tokens.forEach(t=>{ if(!t.translitLemma&&t.lemma===t.form&&t.translit){ t.translitLemma=t.translit; any=true; } }));   // …and re-apply the identity now the forms are in: a lemma equal to its form takes whatever the form just got
  }
  if(await deriveTrPicks()) any=true;   // a hand-corrected token's row is derived from its STORED value, not from the form
  const need=new Map();   // (surface, upos) → [surface, upos]: the surfaces still missing a transliteration (no MISC Translit, none computed yet), each paired with the tag it is to be romanised AS
  const want=(txt,u)=>{ const k=trKey(txt,u); if(!need.has(k)) need.set(k,[txt,u]); };
  DOC.forEach(s=>{ s.tokens.forEach(t=>{ const u=trUpos(t);
      if(t.form&&!t.translit)want(t.form,u);
      if(t.lemma&&t.lemma!=="_"&&!t.translitLemma&&t.lemma!==t.form)want(t.lemma,u); });   // a lemma is the SAME WORD as the token it belongs to and so carries the same part of speech — the tag that disambiguates 行 the form disambiguates 行 the lemma
    (s.mwt||[]).forEach(m=>{ if(m.form&&!m.translit)want(m.form,""); }); });   // an MWT range spans several tokens and therefore has no ONE part of speech; no opinion is the only honest hint, and it is also exactly what this call sent before   // lemmas ride the same batch so the lemma-translit column stays automatic — minus the ones a MISC LTranslit or the lemma==form identity already answered above
  if(need.size){
    const batch=[...need.values()]; let r;
    try{ r=await window.pywebview.api.transliterate(batch.map(x=>x[0]),DOCLANG,TRANSLIT_SCHEME,batch.map(x=>x[1])); }catch(e){ if(any){ if(typeof invalidateDiaCache==="function")invalidateDiaCache(); renderUnlessEditing(); } return; }   // TRANSLIT_SCHEME = the scheme chosen in the status-bar menu ("" ⇒ the language's default)
    const map={}; batch.forEach((x,i)=>{ const v=(r&&r.translit&&r.translit[i])||""; if(v)map[trKey(x[0],x[1])]=v; });
    DOC.forEach(s=>{ s.tokens.forEach(t=>{ const u=trUpos(t);   // the SAME tag on the way out as on the way in, or the lookup misses its own entry
        if(t.form&&!t.translit&&map[trKey(t.form,u)]){ t.translit=map[trKey(t.form,u)]; any=true; }
        if(t.lemma&&t.lemma!=="_"&&!t.translitLemma&&map[trKey(t.lemma,u)]){ t.translitLemma=map[trKey(t.lemma,u)]; any=true; } });   // the lemma's transliteration comes from the lemma itself, never from a MISC Translit (which only governs the form) — and where lemma===form this reads back the form's own entry, which is why that case is not queued above
      (s.mwt||[]).forEach(m=>{ if(m.form&&!m.translit&&map[trKey(m.form,"")]){ m.translit=map[trKey(m.form,"")]; any=true; } }); });
  }
  // WHOLESALE, not per-touched-sentence: this pass runs over the whole DOC (not one si), has no pushUndo/snapSent
  // of its own (it's a derived re-fill, not a user edit — see this function's own module comment), and can land
  // MOMENTS after a sentence's diagram was already cached with no transliteration row on it (the async bridge call
  // above is exactly the gap a notation-switch cache could otherwise race). Dropping the whole cache here is what
  // makes js/core/document.js's notation-switch cache safe to compose with translit staying properly async.
  if(any){ if(typeof invalidateDiaCache==="function") invalidateDiaCache(); renderUnlessEditing(); } }   // renderUnlessEditing, not preserveScroll(renderDoc): this pass is asynchronous and lands whenever the bridge answers, which may be while the reader is typing in a diagram field — and a full re-render destroys the field they are in. The cache is dropped either way, so the refreshed rows appear on the editor's own commit render (js/ui/wiring.js)

/* ── THE SCRIPT RENDERINGS THAT ARE KEYED ON MORE THAN THE FORM ────────────────────────────────────
   Every other Script scheme answers about a SPELLING (optionally disambiguated by the word class —
   see trUpos): 编程 is 編程 whatever else the token says. Latin macronisation is the exception, and
   the whole reason `Api.orthography` grew `feats`/`lemmas` beside `upos` at all: `Gallia` nominative
   and `Galliā` ablative are ONE spelling with two answers, separated only by FEATS, and the model's
   `la_macronise` reads the lemma too (it is what tells an a-stem from an o-stem where InflClass is
   absent). See app/macron.py.

   Two consequences follow, and both are load-bearing.
   · The BATCH KEY has to carry them. Keyed on (surface, upos) alone, the de-duplication would hand
     every token sharing a spelling and a tag whichever FEATS the FIRST of them happened to have — so
     one `Gallia` in a document would decide the macrons of all of them, which is exactly the collision
     the extra two arguments are threaded to prevent.
   · A CACHED RENDERING GOES STALE when any of the four change, not only the form. t.ortho is dropped
     on a form edit (afterFormEdit) and on a retag (uposSyncTranslit) and nowhere else, so correcting
     a FEATS or a lemma would leave the macronised line answering the previous analysis — with nothing
     on screen to say so, since the bare form is a legitimate macronisation too.
   Rather than teach each of the dozen-odd FEATS/lemma write sites to invalidate, the rendering
   carries the KEY IT WAS COMPUTED FOR (`t._orthoKey`) and fillOrtho refills whatever no longer
   matches. One mechanism, and a new write site cannot forget to use it. */
// Languages whose Script scheme reads FEATS/lemma beside UPOS, not just the surface + word class —
// Latin `macron` (app/macron.py) and Arabic/Persian `vocalise` (app/vocalise.py). Kept as a name
// check here rather than an `ORTHO_SCHEMES`-derived one: it drives the BATCH KEY and the staleness
// stamp BEFORE either has been fetched, and both schemes are the only entry their language's Script
// menu ever has, so "this language" and "this language's one morph-dependent scheme" coincide.
const MORPH_ORTHO_LANGS=new Set(["la","ar","fa"]);
function orthoLangNeedsMorph(lang){ return MORPH_ORTHO_LANGS.has(((lang!=null?lang:DOCLANG)||"").toLowerCase().split(/[-_]/)[0]); }
function orthoNeedsMorph(){ return orthoLangNeedsMorph() && !!ORTHO_SCHEME && ORTHO_SCHEME!=="none"; }
// The narrower, LATIN-ONLY form of the same question, for the two consumers below that are
// genuinely Latin-specific machinery (fused-clitic composition and the MSeg vowel-length overlay) —
// not just "morph-dependent" in general. Arabic/Persian MWTs and MSeg rows fall through to their
// bare spelling instead (see app/vocalise.py's own note on why neither is covered yet).
function laOrthoNeedsMorph(){ return isLatinLang() && !!ORTHO_SCHEME && ORTHO_SCHEME!=="none"; }
function orthoLemOf(t){ return (t&&t.lemma&&t.lemma!=="_")?t.lemma:""; }
function orthoKeyOf(t){ const base=trKey(t.form,trUpos(t));
  return orthoNeedsMorph() ? base+" "+(t.feats||"")+" "+orthoLemOf(t) : base; }
function orthoStale(t,k){ return !t.ortho || t._orthoKey!==k; }
/* …and the trigger. markDirty (js/io/bridge.js) is the one funnel EVERY document edit passes through,
   so hanging the re-render off it is what makes "any attribute of any token" true rather than a list
   of the attributes someone remembered. Debounced, because a single gesture marks the document dirty
   several times over (a grid commit, its featsSyncGloss, its background re-parse), and skipped while
   an inline field is open — fillOrtho ends in a full re-render, which would take the keyboard out
   from under the reader; the next markDirty (the commit's own) re-arms it. */
let _orthoMorphT=null;
function scheduleOrthoMorph(){ if(!orthoNeedsMorph()) return;   // three languages, one scheme each (MORPH_ORTHO_LANGS): every other document pays a boolean
  clearTimeout(_orthoMorphT);
  _orthoMorphT=setTimeout(()=>{ if(typeof INLINE_EDIT_OPEN!=="undefined"&&INLINE_EDIT_OPEN){ scheduleOrthoMorph(); return; }
    fillOrtho(); },120); }   // fillOrtho is a no-op unless a token's stamp actually moved, and re-renders only if it filled something
// ── orthography (display-only glyph re-rendering; token.ortho, never written to MISC) ──────────
/* ⚠ RESOLVES TO WHETHER IT PAINTED. Every early return and every failed fetch answers false, the tail
   answers `any`. _orPick (js/lang/translit.js) is the caller that needs it: a script pick blanks every
   t.ortho and then hands the RENDER to this function, so a fill that fetches nothing — no bridge, a call
   that throws, an answer with no usable renderings — must be distinguishable from one that painted, or the
   document keeps the previous script's letters for good. Answering the question here rather than letting
   the caller restate this function's own preconditions is what stops the two drifting apart. */
async function fillOrtho(){ if(!hasBridge()||!DOCLANG) return false;
  const skt=isSanskritLang();   // Sanskrit MWT surface forms are RECONSTRUCTED from components with external sandhi (below), not converted from the stored m.form
  const scriptOn=!!ORTHO_SCHEME && ORTHO_SCHEME!=="none";   // a real script chosen (not Original / None)
  if(!scriptOn && !skt) return false;   // Original / None for a non-Sanskrit language → stored form, nothing to fetch
  /* ⚠ AN ANSWER FOR THE SCRIPT THAT WAS ASKED ABOUT, NOT FOR WHICHEVER ONE IS CURRENT WHEN IT ARRIVES.
     Every fetch below awaits the bridge, and the reader can pick another script (or another language)
     while it is in flight — there is no in-flight guard, and two picks in quick succession really do run
     two fills at once. `orthoKeyOf` cannot catch it: its key is (surface, UPOS) and says nothing about the
     scheme, so the older answer passes the staleness test and writes the PREVIOUS script's letters over
     the newer ones. Measured (Grantha then Siddhaṃ 30 ms later, 120 ms stub bridge): the document settled
     with ORTHO_SCHEME "Siddham" and Siddhaṃ's 2× magnification over Grantha glyphs — the same glyph/size
     disagreement the reordering in syncSchemeAttr and refreshFontStacks exists to close, arriving through
     a different door. `_orLangLoaded` in loadOrthoSchemes (js/lang/translit.js) is the same guard for the
     same reason; this is that pattern applied per fetch. A superseded fill answers false and paints
     nothing, which is right: the fill that superseded it is still coming and will. */
  const askedScheme=ORTHO_SCHEME, askedLang=DOCLANG;
  const superseded=()=>ORTHO_SCHEME!==askedScheme||DOCLANG!==askedLang;
  let any=false;
  if(scriptOn){   // fetch the SCRIPT rendering for single tokens (and MWTs for non-Sanskrit)
    const need=new Map();   // orthoKeyOf: (surface, upos) as the transliteration passes use — plus FEATS + lemma where the scheme reads them (see the note above fillOrtho). A script rendering can be reading-dependent, so it must not be shared between two tokens spelt alike but analysed differently
    const want=(k,txt,u,fe,le)=>{ if(!need.has(k)) need.set(k,[txt,u,fe||"",le||"",k]); };
    DOC.forEach(s=>{ s.tokens.forEach(t=>{ const k=orthoKeyOf(t); if(t.form&&orthoStale(t,k))want(k,t.form,trUpos(t),t.feats,orthoLemOf(t)); }); if(!skt)(s.mwt||[]).forEach(m=>{ if(m.form&&!m.ortho)want(trKey(m.form,""),m.form,""); }); });   // an MWT range has no one UPOS (see fillTranslit) → no opinion, and no FEATS or lemma either
    if(need.size){ const batch=[...need.values()]; let r;
      // feats/lemma ride along beside upos for the Latin `macron` scheme, which is keyed on the whole
      // morphological analysis rather than on the class: the form alone reaches only the
      // morphology-blind level of the lookup, where nominative `Gallia` picks up an ablative macron.
      try{ r=await window.pywebview.api.orthography(batch.map(x=>x[0]),DOCLANG,ORTHO_SCHEME,batch.map(x=>x[1]),
                                                    batch.map(x=>x[2]||""),batch.map(x=>x[3]||"")); }catch(e){ return false; }
      if(superseded()) return false;   // another script was picked while this was in flight — see the note above
      const map={}; batch.forEach((x,i)=>{ const v=(r&&r.ortho&&r.ortho[i])||""; if(v)map[x[4]]=v; });   // x[4] = the key the entry was queued under, so the answer comes back to exactly the tokens that asked
      DOC.forEach(s=>{ s.tokens.forEach(t=>{ const k=orthoKeyOf(t), v=(t.form&&orthoStale(t,k))?map[k]:""; if(v){ t.ortho=v; t._orthoKey=k; } }); if(!skt)(s.mwt||[]).forEach(m=>{ const v=m.form&&!m.ortho?map[trKey(m.form,"")]:""; if(v) m.ortho=v; }); });   // the stamp rides WITH the value: a rendering and the analysis it was computed for can never be separated
      any=true; }
    if(laOrthoNeedsMorph() && laMwtCompose()) any=true; }   // …and the multi-word tokens, whose surface no lexicon lists — see laMwtCompose. Latin only: Arabic/Persian MWTs fall through to their bare spelling (app/vocalise.py)
  if(skt){   // items 9/18: fuse each Sanskrit MWT's component forms by external sandhi — scheme="" gives the fused IAST
    const scheme=scriptOn?ORTHO_SCHEME:"";   // item 18: sandhi applies even with NO script (None/Original) → fused IAST as the surface form
    const lemOf=t=>((t.lemma&&t.lemma!=="_")?t.lemma:"");   // the CoNLL-U lemma is an r-stem signal for visarga sandhi (punar, antar, …)
    const groups=[], lgroups=[], refs=[], naive=[], prevs=[], nexts=[], pauses=[];
    /* THE NEIGHBOURS GO WITH IT — the same `saMwtContext` (js/lang/translit.js) sandhiMwtForms uses.
       Without them this pass fused a range's own components and nothing else, so it produced the PAUSA
       spelling of both edges while the stored FORM (which sandhiMwtForms had built WITH the context)
       carried the real ones. The glyph over a multi-word token therefore disagreed with the form under
       it — `…bhṛtaḥ` drawn above `…bhṛto` — and no edit could ever reconcile them, because each pass
       was answering a different question. One helper, one answer. */
    DOC.forEach(s=>(s.mwt||[]).forEach(m=>{ if(!m.ortho){ const cts=s.tokens.slice(m.from-1,m.to).filter(t=>t.form); if(cts.length){
      const cx=saMwtContext(s,m);
      groups.push(cts.map(t=>t.form)); lgroups.push(cts.map(lemOf)); refs.push(m); naive.push(cts.map(t=>t.form).join(""));
      prevs.push(cx.prev); nexts.push(cx.next); pauses.push(cx.pause); } } }));
    if(groups.length){ let r; let dirtyForm=false;
      try{ r=await window.pywebview.api.sanskrit_mwt(groups,DOCLANG,scheme,lgroups,"",prevs,nexts,pauses); }catch(e){ r=null; }
      if(superseded()) return false;   // …and the fusion is scripted too (`scheme`), so a superseded answer is as wrong here as above; the fill that superseded this one re-collects every m.ortho, which clearOrthoCache has just blanked
      if(r&&r.ortho){ refs.forEach((m,i)=>{ if(r.ortho[i]){ m.ortho=r.ortho[i]; any=true; }
        if(r.form&&r.form[i]){ m.miast=r.form[i];
          // item 3: the STORED surface form (grid + file) should BE the sandhi-fused word, not the naive
          // concatenation. Rewrite it only where m.form is still the raw component glue (never clobber a
          // user-customised form), and flag the doc dirty so the correction is offered for saving.
          if(!m._kept && m.form===naive[i] && r.form[i]!==m.form){ m.form=r.form[i]; dirtyForm=true; } } }); }   // _kept: a form restored by undo/redo is the document's own, never re-derived (see applySnap)
      if(dirtyForm) markDirty(); }   // NO undo entry of its own: this correction is a consequence of the component edit that triggered the re-fuse, so it belongs to THAT edit's snapshot (undoing the edit restores the components, and the fused form recomputes from them). At load time there is no such edit, and no history — the correction then counts as normalisation and leaves the document clean, like the other derived passes   // stash the fused form alongside the scripted one so the MWT romanisation row (trTxt) reads it
    if(scriptOn){
      /* The block-initial running line: the sentence's own `# text`, re-rendered in the chosen script.
         It used to be GLUED first — the `# text` was in Clay-Sanskrit-Library notation, whose marked
         sandhi (`vartm" â-punar-`) is not a readable sentence, so a whole reconstruction pass
         (translit._glue_running_iast) stood between the file and the line. `sa_sud_vedic_ufal_dcs`
         writes ordinary sandhied text, so there is nothing to reconstruct: the line IS the text, and
         the only question left is which script to draw it in. That is `Api.orthography`, the same
         call every other language's script rendering goes through — one code path instead of a
         Sanskrit-only endpoint. Newlines and daṇḍas ride through it (translit._sanskrit splits on
         them), so multi-line verse stays multi-line. */
      const texts=[], srefs=[];
      DOC.forEach(s=>{ if(!s.orthoLine && (s.text||"").trim()){ texts.push(s.text); srefs.push(s); } });   // s.text keeps its real \n hard breaks (multi-line verse)
      if(texts.length){ let r2;
        try{ r2=await window.pywebview.api.orthography(texts,DOCLANG,ORTHO_SCHEME); }catch(e){ r2=null; }
        if(superseded()) return false;   // the running line, same rule — clearOrthoCache blanks s.orthoLine, so the newer fill re-asks for it
        if(r2&&r2.ortho){ srefs.forEach((s,i)=>{ if(r2.ortho[i]){ s.orthoLine=r2.ortho[i]; any=true; } }); } } } }
  if(any){
    /* ⚠ THE FACE FIRST, THEN THE RENDER THAT MEASURES AGAINST IT. This line used to be
       `renderUnlessEditing(); syncDocFonts();` — measure, and only afterwards go and see whether the
       script's font is even present, which is the ordering the whole of fontload.js's backstop machinery
       exists to clean up after. `schemeFaceReady` (js/lang/fontload.js) names the two families that can
       actually paint the scheme just chosen and waits for them; it costs a microtask when the face is
       already there or has no @font-face of its own, and it is the ONLY thing that waits at all for the
       faces web/styles/fonts.css declares locally (Nithya Ranjana, Grantha, Javanese, Balinese, Kawi,
       Zanabazar Square, Tibetan) — syncDocFonts skips those by design (FONT_CORE_SCRIPTS), so nothing
       used to, and an @font-face does not begin loading until layout asks for a glyph from it. Every
       measured term of the render below (scriptAscentEm's fontBoundingBoxAscent, scriptMidEm's ex,
       scriptLiftEm's ink depth, and every meas() width) reads the face, so this is the difference between
       measuring the script and measuring whatever the stack fell through to.
       syncDocFonts stays AFTER, and is still not awaited: it is the DOWNLOAD path (a face this machine has
       no copy of), which must not hold the glyphs back — it re-renders when it lands, as it always has. */
    if(typeof invalidateDiaCache==="function") invalidateDiaCache();
    if(typeof schemeFaceReady==="function") await schemeFaceReady();
    renderUnlessEditing(); syncDocFonts(); }
  return any; }   // renderUnlessEditing for the same reason fillTranslit uses it: an async refill must not pull the keyboard out of an open inline field   // wholesale, same reasoning as fillTranslit's own invalidateDiaCache call above: t.ortho/m.ortho/s.orthoLine feed bform()'s glyph directly, and this pass runs over the whole DOC asynchronously with no si of its own — BUG FIX: switching the Script picker (orPick) or loading a language whose remembered Script preference is a real script (loadOrthoSchemes) populates t.ortho/m.ortho/s.orthoLine with a script this document never used before — but until now nothing then asked fontload.js to fetch that script's face. syncDocFonts() is normally only called from the document-load paths (bridge.js/formats.js/init.js), all of which run BEFORE a script is ever picked, so docScripts()'s scan (which reads t.ortho, among other fields) saw no non-Latin text yet and the newly-chosen script's Noto face was NEVER requested this session. The page just fell through the CSS font stack to whatever the browser could resolve for those codepoints — on a machine with no native coverage for the script (the common case for anything rarer than Devanagari), that is either a patchwork of per-glyph system substitutes or the missing-glyph box, and canvas measureText() (meas(), used for every diagram width) does NOT do the same per-glyph fallback substitution DOM/SVG text painting does, so the measured slot and the painted glyphs disagree → clipped token forms. Calling syncDocFonts() here (AFTER t.ortho/m.ortho/s.orthoLine are populated, so the scan actually sees the new script) fetches the face if needed; ensureScriptFont() already re-renders via preserveScroll(renderDoc) once the face lands (see fontload.js), so this self-corrects without a special-cased second render pass here.

function stripQuantity(s){ return (s||"").normalize("NFD").replace(/[̄̆]/g,"").normalize("NFC"); }   // combining macron + breve, off the DECOMPOSED string so precomposed ā and a+U+0304 go alike
/* ⚠ A MULTI-WORD TOKEN'S MACRONS COME FROM ITS COMPONENTS, because no lexicon holds its surface.
   Morpheus lists WORDS and never host+clitic, so `armaque` is simply absent from it and the whole
   fused form comes back bare — which is what puts an unmacronised word in the middle of an otherwise
   macronised diagram and running line. The components are words: `arma` and `que` each answer, each with
   its own UPOS/FEATS/lemma behind the answer (which the fused surface could never have had — the range
   has no one analysis, see the `want` call above), and concatenating them is exact.
   THE JOIN IS CHECKED BEFORE IT IS TRUSTED. An MWT's surface is not always its components glued together
   — French `du` is `de`+`le` — so the composed string is accepted only where stripping the quantities off
   it reproduces the stored form. Where it doesn't, m.ortho keeps whatever the blind whole-surface request
   gave it and the word shows bare, which is the honest answer.
   Keyed on the components' own renderings, so a component whose analysis (and therefore whose vowel
   length) has just changed carries the range with it. */
function laMwtCompose(){ let any=false;
  DOC.forEach(s=>(s.mwt||[]).forEach(m=>{ if(!m.form) return;
    const cts=s.tokens.slice(m.from-1,m.to); if(!cts.length) return;
    const parts=cts.map(t=>t.ortho||t.form||""), key=parts.join(" ");
    if(m._orthoKey===key) return;                       // nothing beneath it moved
    m._orthoKey=key;
    const joined=parts.join("");
    if(stripQuantity(joined).toLowerCase()!==stripQuantity(m.form).toLowerCase()) return;   // not a plain concatenation → this is not the composed form of that word
    if(joined!==m.ortho){ m.ortho=joined; any=true; } }));
  return any; }

/* ⚠ THE SEGMENTATION ROW SHOWS THE MACRONS TOO, AND IT IS AN OVERLAY ON `t.ortho` RATHER THAN A SECOND
   LOOKUP. Under the Latin `macron` Script scheme every word-like row in the block already carries the
   vowel lengths — the running sentence, the diagram glyph, the MWT surface — and the one row that
   spells the word out morpheme by morpheme did not, which reads as the feature not covering it rather
   than as a decision. It is a DISPLAY overlay in exactly the sense the rest of that feature is: MISC
   MSeg stays the bare segmentation of the bare form, as FORM and `# text` do, because a macron is a
   spelling and never annotation (see app/macron.py's own note on why nothing is written to MISC).
   THERE IS ONE MACRONISATION IN THIS APP AND THIS IS NOT A SECOND ONE. `t.ortho` is the answer
   `Api.orthography` has ALREADY given for this token's whole (form, upos, feats, lemma) — see the note
   above fillOrtho — so the row rides that one lookup, its batch, its `_orthoKey` staleness stamp and
   its Script toggle. Asking `macron.macronise` a second way here would be a second answer to one
   question, and the two would drift the moment a FEATS edit moved one of them.
   THE BOUNDARY IS NOT RE-COMPUTED EITHER, and does not need to be: `la_macronise` returns
   `apply_mask(strip_macron(form))`, a per-CHARACTER substitution (`a`→`ā`, precomposed, `LONG` in
   SUD-spaCy's scripts/la_macronise.py) that inserts no character and merges none, so the cut
   msegSegment found in the bare string falls between the very same two letters here. Measured over the
   Latin sample's own tokens: every macronisation is NFC and the same length as its input.
   ⚠️ THAT IS ASSERTED, NOT ASSUMED. Each character is checked against its counterpart with the quantity
   taken off — `stripQuantity`, the same test laMwtCompose trusts its join on — and ANY disagreement at
   all returns the STORED text untouched: a hand-rewritten segmentation that no longer spells the form,
   a token whose rendering has not landed yet, an engine that one day answers with different letters.
   Bare is always a legitimate spelling of the word; a macron on the wrong vowel is not. */
const MSEG_SEP_RE=/[-꞊=⹀]/;   // what MSeg's own text may carry between pieces: the morpheme boundary, and the three spellings this app has given the clitic seam (see _SEP_RE, js/io/bridge.js)
// A base character plus whatever combining marks follow it, as ONE unit. `strip_macron` NFC-normalises
// the component's answer while MSeg is sliced out of the FILE's own form, which nothing normalises, so
// the two can legitimately arrive in different normalisations and a bare code-point walk would fall out
// of step over the first decomposed mark. Latin does carry marked forms — `samples/la_virgil.conllu`
// writes Virgil's `căno` with a breve (precomposed there, and a+U+0306 in a file written otherwise) —
// so this is the one place the two spellings of one letter have to count as one.
function laLetters(s){ const out=[]; for(const c of Array.from(s||"")){ if(out.length&&/\p{M}/u.test(c)) out[out.length-1]+=c; else out.push(c); } return out; }
function laMsegMacron(t,txt){
  if(!txt||!laOrthoNeedsMorph()) return txt;   // Latin only, exactly as laMwtCompose's own call site — Arabic/Persian MSeg rows stay bare (app/vocalise.py)
  const o=(t&&t.ortho)||""; if(!o) return txt;   // the fill is asynchronous — no rendering yet means the bare text, which is what was on screen a moment ago in any case
  const O=laLetters(o), S=laLetters(txt);
  let k=0, out="";
  for(const g of S){
    if(MSEG_SEP_RE.test(g)){ out+=g; continue; }   // a separator belongs to the SEGMENTATION, not to the word — it has no counterpart in the rendering and consumes nothing from it
    if(k>=O.length||stripQuantity(O[k]).toLowerCase()!==stripQuantity(g).toLowerCase()) return txt;
    out+=O[k++]; }
  return k===O.length?out:txt; }   // …and MSeg must have spelt the WHOLE word, not a prefix of it

// ── MISC Translit/LTranslit (romanisation), written ONLY on a parse / secondary-annotation pass ──
// Set/replace/remove a Key=Value in a CoNLL-U MISC string, preserving the other pairs and their order.
function setMiscKV(misc,key,val){ const empty=(!misc||misc==="_"); let parts=empty?[]:misc.split("|"); let done=false;
  parts=parts.map(p=>{ if(p.split("=",1)[0]===key){ done=true; return (val===""||val==null)?null:key+"="+val; } return p; }).filter(p=>p!==null&&p!=="");
  if(!done && val!==""&&val!=null) parts.push(key+"="+val);
  return parts.length?parts.join("|"):"_"; }
// Compute the selected TRANSLITERATION (romanisation — never the orthography) for a sentence's tokens
// and write it to MISC Translit (form) / LTranslit (lemma). Gated on a parse pass by its callers.
async function annotateTranslitMisc(si){ if(!hasBridge()||!DOCLANG||!STORED_SCHEME) return false;
  const sents = si==null ? DOC : (DOC[si]?[DOC[si]]:[]);
  const need=new Map();   // (surface, upos) — the value WRITTEN TO THE FILE is the one that most needs the POS hint, since it is what a later open reads back
  const want=(txt,u)=>{ const k=trKey(txt,u); if(!need.has(k)) need.set(k,[txt,u]); };
  sents.forEach(s=>{ s.tokens.forEach(t=>{ const u=trUpos(t); if(t.form)want(t.form,u); if(t.lemma&&t.lemma!=="_")want(t.lemma,u); }); });
  if(!need.size) return false;
  const batch=[...need.values()]; let r;
  try{ r=await window.pywebview.api.transliterate(batch.map(x=>x[0]),DOCLANG,STORED_SCHEME,batch.map(x=>x[1])); }catch(e){ return false; }   // item 1: MISC uses the STORED scheme (not the displayed one)
  const map={}; batch.forEach((x,i)=>{ map[trKey(x[0],x[1])]=(r&&r.translit&&r.translit[i])||""; });
  let any=false;   // write MISC only; the display (t.translit) is the DISPLAYED scheme, filled separately by fillTranslit
  sents.forEach(s=>{ s.tokens.forEach(t=>{ const u=trUpos(t);
    const tr=t._trPick?(miscTranslit(t.misc)||t.translit||""):(t.form?(map[trKey(t.form,u)]||""):""), lt=(t.lemma&&t.lemma!=="_")?(map[trKey(t.lemma,u)]||""):"";   // _trPick: a hand correction stands (the parse pass re-derives every OTHER token's Translit, and the lemma's LTranslit either way). It is read back from MISC, NOT from t.translit: the two are different layers now — t.translit is the DISPLAYED scheme, in general a rendering DERIVED from the stored value, and writing it here would put the wrong scheme's string into MISC (a Zhuyin row over a Pinyin store). t.translit remains the fallback for a correction made before anything was written to MISC.
    const nm=setMiscKV(setMiscKV(t.misc,"Translit",tr),"LTranslit",lt); if(nm!==t.misc){ t.misc=nm; any=true; } }); });
  return any; }

/* ── after a token is RETAGGED (its UPOS changed) ─────────────────────────────────────────────────
   The engines are now asked to romanise a form AS a part of speech (see trUpos), so a retag leaves this
   token's cached romanisation and script glyph answering a question no longer being asked: 行 tagged
   VERB romanises xíng, and once the tag becomes NOUN the row goes on saying xíng until something drops
   it. Called from the two retag sites beside uposSyncGloss — js/editing/context-menu.js's posMenu
   `choose` and js/grid/grid.js's commitCell — the same pairing, for the same kind of reason.

   WHY THIS IS NEEDED WHEN regenTok ALREADY RUNS AT BOTH SITES. regenTok's re-parse does end in
   annotateTranslitMisc + fillTranslit, but it reaches them on only one of its paths. It is a plain
   no-op with no parser model — and romanisation is LANGUAGE-driven, so it works with none —
   and reparseTokenFields returns early when the parse fails or its token count no longer aligns 1:1,
   which for a spaceless script is an ordinary outcome rather than an edge case, since it re-parses the
   sentence's forms JOINED WITH SPACES. Even on the path that does get there, fillTranslit refills only
   a token whose t.translit is EMPTY, so the stale string survives the very pass meant to replace it.
   What regenTok does NOT do is fight the user: `upos` is absent from PARSE_FIELDS (js/io/bridge.js), so
   the parser's own tag is never written back, and XPOS_MIRRORS_UPOS re-derives xpos from the tag the
   user just chose. Nothing here needs to defend the new tag — only to refresh what it invalidates.

   SHAPE AND ORDER ARE afterFormEdit's (js/io/bridge.js), deliberately: blank MISC Translit/LTranslit,
   drop the caches, fill, write MISC back. The blanking is the load-bearing step — clearing t.translit
   alone would let fillTranslit's own fromMisc pass restore the OLD tag's string straight out of MISC,
   where the previous automatic pass put it, and the refresh would undo itself.

   _trPick IS PRESERVED, and that is the exact OPPOSITE of afterFormEdit, which clears it. A hand-picked
   reading or hand-corrected stored value is a statement about THIS FORM, and a retag does not change the
   form — 行 corrected to háng is still háng whether it is tagged NOUN or VERB. A form edit does make the
   word a different word, which is why the correction cannot survive one. Only the automatic layers move
   here; annotateTranslitMisc already draws that same line per token, so it is simply called as it is.

   _trChk IS NOT CLEARED — same as afterFormEdit, and worth one line on why, because re-arming it looks
   harmless. It gates adoptStoredPicks, whose rule is "a stored value differing from what the engine
   produces was put there by hand". Re-armed while MISC still held the OLD tag's automatic string, that
   comparison would find a difference and mark the token _trPick: a phantom hand correction, over a value
   the app wrote itself. It cannot bite on this path (the blanking below leaves nothing to compare), but
   it is exactly what a future "just clear every flag" tidy-up would reintroduce. */
async function uposSyncTranslit(si,tokId){ if(!hasBridge()||!DOCLANG) return;   // nothing could recompute → dropping the caches would BLANK the row instead of refreshing it
  const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return;
  if(!t._trPick){ t.translit=""; t._trMisc=false;                                 // the automatic displayed row, and the flag that says MISC held it
    t.misc=setMiscKV(t.misc,"Translit","");   }                                   // …and the stale stored string itself, or fromMisc restores it below (rewritten by annotateTranslitMisc at the end)
  t.translitLemma=""; t.misc=setMiscKV(t.misc,"LTranslit","");                    // the LEMMA romanisation is automatic on EVERY token: _trPick marks a corrected FORM romanisation (MISC Translit) and says nothing about LTranslit
  t.ortho="";                                                                     // …nor about the SCRIPT glyph, which is tag-conditioned too and which nothing on the retag path refreshed before — regenTok's re-parse never calls fillOrtho at all
  if(show.translit) await fillTranslit();                                         // romanise under the NEW tag
  await annotateTranslitMisc(si);                                                 // write the result back to MISC Translit/LTranslit (a no-op with Stored: None, which is right — there is nothing stored to regenerate)
  if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) await fillOrtho();   // re-render the script glyph under the new tag
  preserveScroll(renderDoc); }                                                     // no markDirty of its own: the retag that called this already marked the document, and these are its consequences

// ── the click-editable STORED transliteration (raised from the transliteration ROW) ───────────────
// WHERE the edit is raised from: the very click on the very row the displayed romanisation already
// used — js/editing/context-menu.js's .tr-edit handler delegates here whenever the language's
// romanisation is non-deterministic (storedTrEditable). WHAT it edits: MISC Translit, in the STORED
// scheme — the value that reaches the file — never the displayed rendering, which is derived from it.
// The alternative considered was a second, permanently visible Stored row beneath each token. It was
// rejected for adding chrome that says nothing most of the time: every abjad has ONE scheme, and
// Displayed defaults TO the stored scheme for the CJK languages, so on most screens that row would
// simply repeat the one above it — in a below-token stack (transliteration / gloss / segmentation /
// morphemic gloss / POS) that is already five rows deep. Where the two schemes DO differ the field
// opens on the stored value and says so (the row behind it keeps showing the derived rendering).
function storedTranslitVal(t){ return t?miscTranslit(t.misc):""; }
async function editStoredTransInline(si,tokId,clickXY){ const s=DOC[si]; if(!s)return; const t=s.tokens[tokId-1]; if(!t)return;
  const same=(!TRANSLIT_SCHEME||STORED_SCHEME===TRANSLIT_SCHEME), had=storedTranslitVal(t);
  let seed=had;
  if(!seed&&!same&&hasBridge()){ try{ const r=await window.pywebview.api.transliterate([t.form],DOCLANG,STORED_SCHEME,[trUpos(t)]); seed=(r&&r.translit&&r.translit[0])||""; }catch(e){ seed=""; } }   // …under THIS token's own tag, so the value the field opens on is the one the automatic pass would have stored for it, not a homograph's reading   // nothing stored YET and the row shows a different scheme: open the field on what the stored scheme would hold for this form, so the user corrects a value instead of filling a blank whose scheme the row doesn't show
  const el=transElOf(si,tokId); if(!el)return;   // re-found AFTER that await — a re-render in between would have replaced the element the field must sit over
  // the field edits MISC Translit through a proxy (as the gloss tiers edit their own MISC attribute), and
  // mirrors each keystroke into t.translit as well, so the diagram grows and shrinks with the entry.
  const proxy={ get v(){ const st=storedTranslitVal(t); return st||(same?(t.translit||""):seed); },   // nothing stored yet: the row's own text where the row IS the stored scheme, else the seed fetched above
    set v(val){ t.misc=setMiscKV(t.misc,"Translit",val); t.translit=val; } };
  if(!same) toast("Editing the stored transliteration ("+storedLabel(STORED_SCHEME)+")");   // the field shows the STORED value while the row behind it shows a value derived from it — say which, rather than let the substitution read as a glitch
  makeEditable(el, proxy, "v", async changed=>{
      if(changed){ const st=storedTranslitVal(t); t._trMisc=!!st; t._trPick=!!st; t._trChk=1; markDirty(); }   // a corrected stored value is the USER's: the automatic passes leave it alone (fillTranslit's fromMisc, annotateTranslitMisc). An emptied field drops the correction instead, and the token goes back to the automatic reading.
      else if(storedTranslitVal(t)!==had) t.misc=setMiscKV(t.misc,"Translit",had);   // a cancelled edit puts MISC back EXACTLY as it was — makeEditable reverts the proxy to the value the field opened on, which for an unstored token is the row's own automatic romanisation, and writing that to MISC would change the document behind a cancel
      t.translit="";                                    // the row is DERIVED from the stored value → drop it and let fillTranslit re-render it (from the correction where the schemes allow it, from the form where they do not)
      if(show.translit) await fillTranslit();
      preserveScroll(renderDoc); },
    sentRTL(s), ()=>transElOf(si,tokId), null, true, clickXY); }   // allowEmpty: clearing the field is how a correction is withdrawn (a Form, by contrast, can never be blanked)
// A reading picked from the CJK flyout and a stored value corrected on the row are two routes to ONE
// correction, so they land in the same place. The flyout renders its candidates in the DISPLAYED scheme
// (js/lang/readings.js), so what goes to MISC is that same reading re-expressed in the STORED scheme.
async function storeDisplayedPick(t,val){ if(!t||!STORED_SCHEME) return false;   // "Stored: None" → there is nothing to write, and nothing was promised
  if(!TRANSLIT_SCHEME||STORED_SCHEME===TRANSLIT_SCHEME){ t.misc=setMiscKV(t.misc,"Translit",val); return true; }
  let d=""; try{ const r=await window.pywebview.api.translit_derive([t.form],[val],DOCLANG,TRANSLIT_SCHEME,STORED_SCHEME); d=(r&&r.translit&&r.translit[0])||""; }catch(e){ d=""; }
  if(d){ t.misc=setMiscKV(t.misc,"Translit",d); return true; }
  return false; }   // the pick cannot be expressed in the stored scheme (an Old Chinese reconstruction picked over a Pinyin store, say) → MISC is left exactly as it was rather than filled with the wrong scheme's string, and applyReading says so

