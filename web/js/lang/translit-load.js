//@module js/translit-load.js
/* ── transliteration (wiktra, language-driven) ───────────────────────────── */
// Read a Translit= value out of a CoNLL-U MISC field (|-delimited Key=Value pairs); "" when absent.
function miscTranslit(misc){ if(!misc||misc==="_")return""; const m=/(?:^|\|)Translit=([^|]*)/.exec(misc); return m?m[1]:""; }
// token glosses live in MISC Gloss (a standard UD MISC attribute); they round-trip through io_conllu with the rest of MISC.
function miscKV(misc,key){ if(!misc||misc==="_")return""; const m=new RegExp("(?:^|\\|)"+key+"=([^|]*)").exec(misc); return m?m[1]:""; }   // read any MISC Key=Value ("" if absent)
function miscGloss(misc){ return miscKV(misc,"Gloss"); }
const INVISIBLE_RE=/[​‌‍﻿­]/g;   // zero-width space/joiners, BOM, soft hyphen — invisible Unicode "format" characters that survive both Python's and JS's \s (they're category Cf, not Zs), so they slip past every whitespace-collapse/trim untouched. Wiktionary's scraped HTML sometimes trails one at the end of a definition (e.g. a wrap hint around a citation link) — left in place, it lands right at the gloss's dot-join seam and shows up as an invisible "gap" between the lexical and grammatical parts of a morphemic gloss.
const GLOSS_WS_RE=/[\r\n\t]/g;   // stray literal CR/LF/tab characters found in an ALREADY-STORED gloss tier (unlike INVISIBLE_RE's zero-width Cf characters, these DO have visible advance — they render as a stray gap hugging a dot-join seam, e.g. around the "." between a lexical stem and a Leipzig abbreviation). Stripped at the same read accessors as INVISIBLE_RE, below.
function glossEnc(v){ return (v||"").replace(INVISIBLE_RE,"").replace(/[|\t\n]+/g," ").trim(); }   // keep MISC well-formed: no bar (the field delimiter), tab or newline, or invisible junk — a real tab/newline COLLAPSES to a space here (word-separator semantics for freshly-typed/committed text), unlike GLOSS_WS_RE's outright strip for already-stored data at the read accessors
function tokGloss(o){ return o?miscGloss(o.misc):""; }
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
  const items=[], need=new Set();
  DOC.forEach(s=>s.tokens.forEach(t=>{ if(t._trPick||t._trChk||!t.form) return; const st=miscTranslit(t.misc); if(!st) return; items.push([t,st]); need.add(t.form); }));
  if(!items.length) return false;
  const forms=[...need]; let r;
  try{ r=await window.pywebview.api.transliterate(forms,DOCLANG,STORED_SCHEME); }catch(e){ return false; }   // the STORED scheme's own rendering of each form — what an automatic pass would have written
  const map={}; forms.forEach((f,i)=>{ map[f]=(r&&r.translit&&r.translit[i])||""; });
  let any=false;
  items.forEach(([t,st])=>{ t._trChk=1; const auto=map[t.form]||"";   // no rendering at all (an engine whose extras tier is missing) ⇒ nothing to compare against, so nothing is adopted
    if(auto&&st!==auto){ t._trPick=true; t._trMisc=true; t.translit=""; any=true; } });
  return any; }
async function fillTranslit(){ if(!hasBridge()||!DOCLANG) return;   // transliteration is enabled only when a model sets the language
  let any=false;
  if(await adoptStoredPicks()) any=true;   // before the passes below: an adopted correction must be treated as one by both of them
  // An authored MISC Translit= wins over the automatic pass ONLY when no display scheme is actively
  // selected. When the user has picked a transliteration scheme, that scheme drives the diagram display
  // (fetched fresh below), so a stale MISC value from an earlier parse/scheme doesn't override it.
  const fromMisc=(o,misc)=>{ if(o._trPick) return;   // a reading PICKED by hand from the CJK readings flyout (js/lang/readings.js) is authoritative for as long as the scheme it was picked under is displayed — it is already both in o.translit and in MISC, and re-deriving it here would silently put the automatic (wrong) reading back
    const mt=TRANSLIT_SCHEME?"":miscTranslit(misc);
    if(mt){ if(o.translit!==mt){ o.translit=mt; any=true; } o._trMisc=true; }
    else if(o._trMisc){ o.translit=""; o._trMisc=false; any=true; } };   // MISC Translit removed / scheme selected → clear so the automatic pass below refills it
  DOC.forEach(s=>{ s.tokens.forEach(t=>fromMisc(t,t.misc));
    (s.mwt||[]).forEach(m=>fromMisc(m, m._cols?m._cols[9]:m.misc)); });   // an MWT's MISC is column 9 of its raw CoNLL-U row
  if(await deriveTrPicks()) any=true;   // a hand-corrected token's row is derived from its STORED value, not from the form
  const need=new Set();   // unique surface forms still missing a transliteration (no MISC Translit, none computed yet)
  DOC.forEach(s=>{ s.tokens.forEach(t=>{ if(t.form&&!t.translit)need.add(t.form); if(t.lemma&&t.lemma!=="_"&&!t.translitLemma)need.add(t.lemma); }); (s.mwt||[]).forEach(m=>{ if(m.form&&!m.translit)need.add(m.form); }); });   // lemmas ride the same batch so the lemma-translit column stays automatic even when a MISC Translit supplies the form's translit
  if(need.size){
    const forms=[...need]; let r;
    try{ r=await window.pywebview.api.transliterate(forms,DOCLANG,TRANSLIT_SCHEME); }catch(e){ if(any){ if(typeof invalidateDiaCache==="function")invalidateDiaCache(); preserveScroll(renderDoc); } return; }   // TRANSLIT_SCHEME = the scheme chosen in the status-bar menu ("" ⇒ the language's default)
    const map={}; forms.forEach((f,i)=>{ const v=(r&&r.translit&&r.translit[i])||""; if(v)map[f]=v; });
    DOC.forEach(s=>{ s.tokens.forEach(t=>{ if(t.form&&!t.translit&&map[t.form]){ t.translit=map[t.form]; any=true; } if(t.lemma&&t.lemma!=="_"&&!t.translitLemma&&map[t.lemma]){ t.translitLemma=map[t.lemma]; any=true; } });   // the lemma's transliteration comes from the lemma itself, never from a MISC Translit (which only governs the form)
      (s.mwt||[]).forEach(m=>{ if(m.form&&!m.translit&&map[m.form]){ m.translit=map[m.form]; any=true; } }); });
  }
  // WHOLESALE, not per-touched-sentence: this pass runs over the whole DOC (not one si), has no pushUndo/snapSent
  // of its own (it's a derived re-fill, not a user edit — see this function's own module comment), and can land
  // MOMENTS after a sentence's diagram was already cached with no transliteration row on it (the async bridge call
  // above is exactly the gap a notation-switch cache could otherwise race). Dropping the whole cache here is what
  // makes js/core/document.js's notation-switch cache safe to compose with translit staying properly async.
  if(any){ if(typeof invalidateDiaCache==="function") invalidateDiaCache(); preserveScroll(renderDoc); } }

// ── orthography (display-only glyph re-rendering; token.ortho, never written to MISC) ──────────
async function fillOrtho(){ if(!hasBridge()||!DOCLANG) return;
  const skt=isSanskritLang();   // Sanskrit MWT surface forms are RECONSTRUCTED from components with external sandhi (below), not converted from the stored m.form
  const scriptOn=!!ORTHO_SCHEME && ORTHO_SCHEME!=="none";   // a real script chosen (not Original / None)
  if(!scriptOn && !skt) return;   // Original / None for a non-Sanskrit language → stored form, nothing to fetch
  let any=false;
  if(scriptOn){   // fetch the SCRIPT rendering for single tokens (and MWTs for non-Sanskrit)
    const need=new Set();
    DOC.forEach(s=>{ s.tokens.forEach(t=>{ if(t.form&&!t.ortho)need.add(t.form); }); if(!skt)(s.mwt||[]).forEach(m=>{ if(m.form&&!m.ortho)need.add(m.form); }); });
    if(need.size){ const forms=[...need]; let r;
      try{ r=await window.pywebview.api.orthography(forms,DOCLANG,ORTHO_SCHEME); }catch(e){ return; }
      const map={}; forms.forEach((f,i)=>{ const v=(r&&r.ortho&&r.ortho[i])||""; if(v)map[f]=v; });
      DOC.forEach(s=>{ s.tokens.forEach(t=>{ if(t.form&&!t.ortho&&map[t.form]) t.ortho=map[t.form]; }); if(!skt)(s.mwt||[]).forEach(m=>{ if(m.form&&!m.ortho&&map[m.form]) m.ortho=map[m.form]; }); });
      any=true; } }
  if(skt){   // items 9/18: fuse each Sanskrit MWT's component forms by external sandhi — scheme="" gives the fused IAST
    const scheme=scriptOn?ORTHO_SCHEME:"";   // item 18: sandhi applies even with NO script (None/Original) → fused IAST as the surface form
    const lemOf=t=>((t.lemma&&t.lemma!=="_")?t.lemma:"");   // the CoNLL-U lemma is an r-stem signal for visarga sandhi (punar, antar, …)
    const groups=[], lgroups=[], refs=[], naive=[];
    DOC.forEach(s=>(s.mwt||[]).forEach(m=>{ if(!m.ortho){ const cts=s.tokens.slice(m.from-1,m.to).filter(t=>t.form); if(cts.length){ groups.push(cts.map(t=>t.form)); lgroups.push(cts.map(lemOf)); refs.push(m); naive.push(cts.map(t=>t.form).join("")); } } }));
    if(groups.length){ let r; let dirtyForm=false;
      try{ r=await window.pywebview.api.sanskrit_mwt(groups,DOCLANG,scheme,lgroups); }catch(e){ r=null; }
      if(r&&r.ortho){ refs.forEach((m,i)=>{ if(r.ortho[i]){ m.ortho=r.ortho[i]; any=true; }
        if(r.iast&&r.iast[i]){ m.miast=r.iast[i];
          // item 3: the STORED surface form (grid + file) should BE the sandhi-fused IAST, not the naive
          // concatenation. Rewrite it only where m.form is still the raw component glue (never clobber a
          // user-customised form), and flag the doc dirty so the correction is offered for saving.
          if(!m._kept && m.form===naive[i] && r.iast[i]!==m.form){ m.form=r.iast[i]; dirtyForm=true; } } }); }   // _kept: a form restored by undo/redo is the document's own, never re-derived (see applySnap)
      if(dirtyForm) markDirty(); }   // NO undo entry of its own: this correction is a consequence of the component edit that triggered the re-fuse, so it belongs to THAT edit's snapshot (undoing the edit restores the components, and the fused form recomputes from them). At load time there is no such edit, and no history — the correction then counts as normalisation and leaves the document clean, like the other derived passes   // stash the sandhi-fused IAST alongside the scripted form so the MWT romanisation row (trTxt) reads the fused form
    if(scriptOn){   // item 6 (rev): the block-initial running text — glue the RAW # text (strip apostrophes/hyphens/word-internal pipes so compound members fuse; glue every consonant-final word onto the next), then render in the script. Built from s.text, NOT the token forms — the tokeniser has already dropped the hyphen/pipe glue markers, so token-based gluing left compound members (e.g. śaśa-bhṛto) spuriously spaced.
      const texts=[], srefs=[];
      DOC.forEach(s=>{ if(!s.orthoLine && (s.text||"").trim()){ texts.push(s.text); srefs.push(s); } });   // s.text keeps its real \n hard breaks (multi-line verse); sanskrit_running preserves them
      if(texts.length){ let r2;
        try{ r2=await window.pywebview.api.sanskrit_running(texts,DOCLANG,ORTHO_SCHEME); }catch(e){ r2=null; }
        if(r2&&r2.ortho){ srefs.forEach((s,i)=>{ if(r2.ortho[i]){ s.orthoLine=r2.ortho[i]; any=true; } }); } } } }
  if(any){ if(typeof invalidateDiaCache==="function") invalidateDiaCache(); preserveScroll(renderDoc); syncDocFonts(); } }   // wholesale, same reasoning as fillTranslit's own invalidateDiaCache call above: t.ortho/m.ortho/s.orthoLine feed bform()'s glyph directly, and this pass runs over the whole DOC asynchronously with no si of its own — BUG FIX: switching the Script picker (orPick) or loading a language whose remembered Script preference is a real script (loadOrthoSchemes) populates t.ortho/m.ortho/s.orthoLine with a script this document never used before — but until now nothing then asked fontload.js to fetch that script's face. syncDocFonts() is normally only called from the document-load paths (bridge.js/formats.js/init.js), all of which run BEFORE a script is ever picked, so docScripts()'s scan (which reads t.ortho, among other fields) saw no non-Latin text yet and the newly-chosen script's Noto face was NEVER requested this session. The page just fell through the CSS font stack to whatever the browser could resolve for those codepoints — on a machine with no native coverage for the script (the common case for anything rarer than Devanagari), that is either a patchwork of per-glyph system substitutes or the missing-glyph box, and canvas measureText() (meas(), used for every diagram width) does NOT do the same per-glyph fallback substitution DOM/SVG text painting does, so the measured slot and the painted glyphs disagree → clipped token forms. Calling syncDocFonts() here (AFTER t.ortho/m.ortho/s.orthoLine are populated, so the scan actually sees the new script) fetches the face if needed; ensureScriptFont() already re-renders via preserveScroll(renderDoc) once the face lands (see fontload.js), so this self-corrects without a special-cased second render pass here.

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
  const need=new Set();
  sents.forEach(s=>{ s.tokens.forEach(t=>{ if(t.form)need.add(t.form); if(t.lemma&&t.lemma!=="_")need.add(t.lemma); }); });
  if(!need.size) return false;
  const forms=[...need]; let r;
  try{ r=await window.pywebview.api.transliterate(forms,DOCLANG,STORED_SCHEME); }catch(e){ return false; }   // item 1: MISC uses the STORED scheme (not the displayed one)
  const map={}; forms.forEach((f,i)=>{ map[f]=(r&&r.translit&&r.translit[i])||""; });
  let any=false;   // write MISC only; the display (t.translit) is the DISPLAYED scheme, filled separately by fillTranslit
  sents.forEach(s=>{ s.tokens.forEach(t=>{ const tr=t._trPick?(miscTranslit(t.misc)||t.translit||""):(t.form?(map[t.form]||""):""), lt=(t.lemma&&t.lemma!=="_")?(map[t.lemma]||""):"";   // _trPick: a hand correction stands (the parse pass re-derives every OTHER token's Translit, and the lemma's LTranslit either way). It is read back from MISC, NOT from t.translit: the two are different layers now — t.translit is the DISPLAYED scheme, in general a rendering DERIVED from the stored value, and writing it here would put the wrong scheme's string into MISC (a Zhuyin row over a Pinyin store). t.translit remains the fallback for a correction made before anything was written to MISC.
    const nm=setMiscKV(setMiscKV(t.misc,"Translit",tr),"LTranslit",lt); if(nm!==t.misc){ t.misc=nm; any=true; } }); });
  return any; }

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
  if(!seed&&!same&&hasBridge()){ try{ const r=await window.pywebview.api.transliterate([t.form],DOCLANG,STORED_SCHEME); seed=(r&&r.translit&&r.translit[0])||""; }catch(e){ seed=""; } }   // nothing stored YET and the row shows a different scheme: open the field on what the stored scheme would hold for this form, so the user corrects a value instead of filling a blank whose scheme the row doesn't show
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

