//@module js/translit.js
const TRANSLIT_LANGS=new Set([
  "ar","fa","he","ja","ko","zh","cmn","lzh","yue",                                   // explicit backend routes (non-Latin)
  "ur","ps","syr","dv","ckb","sd","ug","yi","arc","aii","prs",                       // RTL — all non-Latin
  "ru","uk","be","bg","sr","mk","mn","kk","ky","tg","tt","ce","cv","ba","sah","os",  // Cyrillic
  "el","grc",                                                                        // Greek
  "hi","bn","pa","gu","or","ta","te","kn","ml","si","ne","mr","as","bo","dz","new",  // Brahmic / Indic (Sanskrit "sa" intentionally omitted — see above)
  "th","lo","km","my","shn",                                                         // SE-Asian
  "hy","ka","am","ti","gez",                                                         // Armenian / Georgian / Ethiopic
]);
function translitNeeded(lang){ return !!lang && TRANSLIT_LANGS.has(lang); }   // non-Latin script ⇒ romanisation is meaningful
// ── the STORED transliteration is CLICK-EDITABLE where the romanisation is non-deterministic ──────
// Han heteronyms (行 = xíng "go" / háng "row"), the several readings of a Japanese kanji, and the
// unvocalised abjads (Arabic, Hebrew, Persian, Urdu, Syriac, …) whose short vowels are simply not
// written: for these the machine's guess is often wrong, and the value that MATTERS is the one that
// reaches MISC. The backend owns the list (translit.ambiguous — the readings languages plus the
// abjads), reported alongside the scheme list rather than mirrored here, so the readings flyout and
// this affordance can never disagree about which languages are ambiguous. False with no bridge, so
// browser design mode simply never offers the edit.
let TRANSLIT_AMBIG=false;
// …and the transliteration ROW is where that edit is raised from — no second row, no extra chrome:
// where Displayed and Stored coincide (every abjad has ONE scheme, and Displayed defaults TO the
// stored scheme everywhere else) the row already IS the stored value, so clicking it edits exactly
// what it shows; where they differ the row is a DERIVED rendering, so the field opens on the stored
// value instead and the row re-derives from the correction on commit (editStoredTransInline).
function storedTrEditable(){ return TRANSLIT_AMBIG && show.translit && !!STORED_SCHEME; }

// ── status-bar transliteration-scheme picker ─────────────────────────────────
// The transliteration layer is driven by this status-bar menu (there is NO Show/Hide checkbox any more):
// "None" turns the display off; picking a scheme turns it on and fetches that scheme's romanisation for the
// doc. The menu appears next to the language pill only when the backend reports schemes for DOCLANG.
let TRANSLIT_SCHEMES=[];   // cached DISPLAYED schemes [{id,label,stored,available}] for DOCLANG (item 1: the superset)
let TRANSLIT_SCHEME="";    // the DISPLAYED transliteration (row) scheme id ("" ⇒ off)
let STORED_SCHEME="";      // the STORED transliteration written to MISC (a stored:true subset member; "" ⇒ none)
let _trLangLoaded=null;    // language TRANSLIT_SCHEMES was fetched for (guards against stale async results)
function clearTranslitCache(){ DOC.forEach(s=>{ s.tokens.forEach(t=>{ t.translit=""; t.translitLemma=""; delete t._trChk; }); (s.mwt||[]).forEach(m=>{ m.translit=""; }); }); }   // scheme/language change invalidates cached per-token transliterations (a MISC Translit= is restored by fillTranslit's fromMisc pass, a hand-corrected one by its derive pass) and the once-per-token adoption check (_trChk), which compared the stored value against the OLD scheme's engine. _trPick now SURVIVES a displayed-scheme change: the correction it marks lives in MISC in the STORED scheme, and every displayed scheme is derived FROM it (fillTranslit's derive pass) rather than pinned to the string the pick was made in — a reading corrected in Pinyin does now say how the token reads in Zhuyin
async function loadTranslitSchemes(lang){ lang=lang||""; _trLangLoaded=lang; TRANSLIT_SCHEMES=[]; TRANSLIT_AMBIG=false; const gen=DOCSCHEME_GEN;   // gen: see schemeGenOK, and the twin capture in loadOrthoSchemes
  // Tell the bridge which language the document is in. Nothing on the MAIN window needs it (every
  // bridge call from here passes DOCLANG itself) — it is for the CHILD windows, which run in their
  // own web views with no access to this global: the Insert-text window's ITRANS conversion
  // (Api.child_insert_text) reads it. Fire-and-forget, and here rather than in setLang because this
  // is already the one function setLang calls on every language change.
  if(hasBridge()){ try{ window.pywebview.api.set_doc_language(lang); }catch(e){} }
  if(hasBridge()&&lang){ try{ const r=await window.pywebview.api.translit_schemes(lang); if(_trLangLoaded!==lang)return; TRANSLIT_SCHEMES=(r&&r.schemes)||[]; TRANSLIT_AMBIG=!!(r&&r.ambiguous); }catch(e){ TRANSLIT_SCHEMES=[]; TRANSLIT_AMBIG=false; } }
  const avail=TRANSLIT_SCHEMES.filter(s=>s.available), stored=TRANSLIT_SCHEMES.filter(s=>s.stored&&s.available);
  const mine=schemeGenOK(gen);   // as in loadOrthoSchemes: a document adopted mid-load is the NEXT load's to read
  // The DISPLAYED romanisation has exactly one source of truth: the per-language preference. Like the Script
  // pill, the open document gets no say — which romanisation you like to READ is a property of the reader, not
  // of the document — so there is no file value to weigh here and none of the schemeGenOK machinery the STORED
  // scheme still needs. null ⇒ the user has never chosen one for this language ⇒ the language default below.
  const want=prefTranslit(lang);
  const wantStored=(mine&&FILE_STORED!=null)?FILE_STORED:prefStored(lang); if(mine)FILE_STORED=null;     // …and the STORED one, through the same accessor shape as prefOrtho/prefTranslit rather than reaching into PREFS here
  if(!TRANSLIT_SCHEMES.length){ TRANSLIT_SCHEME=""; STORED_SCHEME=""; show.translit=false; }   // no schemes → no transliteration menu, display off
  else {   // item 1: the DISPLAYED transliteration is NEVER empty for a language that has one; default Displayed = default (= Stored)
    // Both of these assign on EVERY path (unlike the Script pill's old conditional restore — see orthoResolve),
    // so neither can inherit the previous language's scheme. The remembered id must also still be AVAILABLE:
    // an extra uninstalled since the choice was made would otherwise be restored and romanise nothing.
    TRANSLIT_SCHEME=(want && TRANSLIT_SCHEMES.some(s=>s.id===want&&s.available)) ? want : (avail[0]||TRANSLIT_SCHEMES[0]).id; show.translit=true;
    STORED_SCHEME=(wantStored && stored.some(s=>s.id===wantStored)) ? wantStored : (stored[0]?stored[0].id:TRANSLIT_SCHEME);   // Stored ⊆ Displayed; default = first stored scheme
    if(isSanskritLang(lang)) show.translit=saTransRow();   // item 27(c): the IAST row is shown ONLY where the glyph above it is NOT already romanised — see saTransRow; loadOrthoSchemes re-runs this gate once ORTHO_SCHEME is resolved
    if(want==="") { show.translit=false; TRANSLIT_SCHEME=""; }   // a RECORDED "Displayed: None" — the off-state trPick's own off-row writes, mirrored here so it survives the reopen. LAST, so it also wins over the Sanskrit script-gate above: that gate decides whether the row COULD show, this decides that the user asked it not to. "" only ever reaches this point as a deliberate choice — prefTranslit returns null, not "", when nothing is recorded.
  }
  updateTranslitPill(); updateStoredPill(); clearTranslitCache();
  if(DOC.length) preserveScroll(renderDoc);
  if(show.translit) fillTranslit(); }
function trSchemeLabel(id){ const s=TRANSLIT_SCHEMES.find(x=>x.id===id); return s?s.label:""; }
// item 8: give each status-bar menu trigger a STABLE width = its widest possible value, so switching
// the selection (e.g. Script Devanagari→Grantha) doesn't reflow the pill and everything after it.
let _pillGauge=null;
function sizePill(p, strings){ if(!_pillGauge){ _pillGauge=document.createElement("span");
    _pillGauge.style.cssText="position:absolute; visibility:hidden; white-space:nowrap; left:-9999px; top:-9999px"; document.body.appendChild(_pillGauge); }
  const cs=getComputedStyle(p);   // measure in the pill's own font (WebKit returns "" for the `font` shorthand, so copy longhands)
  ["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing"].forEach(k=>{ _pillGauge.style[k]=cs[k]; });
  let w=0; strings.forEach(s=>{ _pillGauge.textContent=s; w=Math.max(w,_pillGauge.offsetWidth); });
  // the gauge measures TEXT only, but the pill is box-sizing:border-box with horizontal padding/border, so
  // min-width (a border-box floor) must include that chrome — otherwise a near-widest label's content+padding
  // exceeds the padding-less floor and the pill still reflows. Add the pill's own horizontal padding + border,
  // AND (since item 8 predates it) the trailing .pillchev disclosure glyph + the flex gap before it — the pill
  // is `display:inline-flex; gap:5px` over [label, chevron], so the chevron's own box is real layout width the
  // text-only gauge above never sees.
  const chev=p.querySelector(".pillchev"), chevW=chev?chev.getBoundingClientRect().width+(parseFloat(cs.gap)||0):0;
  const chrome=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0)+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.borderRightWidth)||0)+chevW;
  p.style.minWidth=Math.ceil(w+chrome)+"px"; }   // pill content is left-aligned → the value grows into the reserved width without shifting neighbours
/* ONE PILL FOR BOTH CHOICES. "Displayed" is the transliteration ROW; "Stored" is what goes into Misc
   Translit/LTranslit. They were two pills side by side, each opening its own menu over the same scheme list —
   twice the chrome for two settings that are read against each other ("am I showing what I'm storing?"). The
   label states both, in that order, so the answer is on the status bar without opening anything. */
function updateTranslitPill(){ const p=document.getElementById("translitPill"); if(!p)return;
  if(!TRANSLIT_SCHEMES.length){ p.hidden=true; return; }   // no transliteration schemes at all → no pill
  /* ⚠ THE PILL IS NEVER DISABLED while there are schemes to pick. It used to go dead whenever the ROW
     could not be drawn (`isSanskritLang() && !saTransRow()`), which was defensible when IAST was
     Sanskrit's only displayed scheme: no row, nothing to choose. CSL made that false — and worse,
     self-locking, since Script=Latin + Displayed=IAST hides the row, disables the pill, and leaves no
     way back to the menu that offers CSL. The Stored column is a live choice in that state too, and it
     has nothing to do with whether the row is drawn.
     Whether the row APPEARS stays saTransRow()'s business; whether a CHOICE EXISTS is this pill's, and
     the answer is yes as long as TRANSLIT_SCHEMES is non-empty — which line 89 has already established. */
  const noRow=isSanskritLang() && !saTransRow();
  p.hidden=false; p.classList.remove("disabled"); p.classList.add("pickable");
  p.title=noRow?"Transliteration — the row is hidden here (it would repeat the line above); pick CSL to show one"
               :"Transliteration — displayed row and stored Misc value";
  /* …and the label names the scheme that is CHOSEN, not the one that is DRAWN. Reading it off
     show.translit made the pill say "None" for a scheme the user had just picked, because the row
     happened to be redundant — which reads as the choice not having taken. TRANSLIT_SCHEME==="" is the
     real off-state (trPick's own off-row writes both, as do loadTranslitSchemes' two paths), so it is
     the honest thing to test. */
  const d=TRANSLIT_SCHEME?trSchemeLabel(TRANSLIT_SCHEME):"None",
        st=(typeof STORED_SCHEME!=="undefined"&&STORED_SCHEME)?storedLabel(STORED_SCHEME):"None",
        lbl=p.querySelector("#translitPillLabel");
  if(lbl)lbl.textContent = d===st ? "Translit: "+d : "Translit: "+d+" · "+st;   // displayed · stored, the same order as the menu's two columns — but when they name the SAME scheme (the common case: Displayed defaults TO Stored — see the "Displayed IS Stored" note in translit-load.js), say it once rather than "X · X". The label span only — the trailing chevron svg is a persistent sibling.
  sizePill(p, translitPillCandidates()); }
/* Every label the pill above can ACTUALLY show, for sizePill's gauge. The two slots draw on DIFFERENT sets —
   the Display column offers every available scheme, the Store column only the `stored` ones (plus "None",
   which is always a stored choice) — so pairing each label with ITSELF, as this used to, reserves width for a
   string that can never render: it is both the wrong second slot and, since d===st collapses to the one-slot
   form, an impossible combination. Mandarin is the case in point — Gwoyeu Romatzyh and General Chinese are
   display-only, Pinyin is the only stored scheme, so the widest reachable label is
   "Translit: Gwoyeu Romatzyh · Pinyin", not "… · Gwoyeu Romatzyh".
   `available:false` schemes are excluded: trRender offers them in neither column. The fallback to the
   unfiltered list covers the one case where an unavailable label still reaches the pill — loadTranslitSchemes
   falls back to TRANSLIT_SCHEMES[0] when NOTHING is available. */
function translitPillCandidates(){
  const av=TRANSLIT_SCHEMES.filter(x=>x.available), pool=av.length?av:TRANSLIT_SCHEMES;
  const disp=[...pool.map(x=>x.label),"None"],                        // "None" is Sanskrit-only in the Display column, but it is the shortest label either way — no width is reserved for it
        stor=[...pool.filter(x=>x.stored).map(x=>x.label),"None"];
  const out=disp.map(d=>"Translit: "+d);                              // the collapsed single-slot form (d===st)
  disp.forEach(d=>stor.forEach(s=>{ if(d!==s) out.push("Translit: "+d+" · "+s); }));
  return out; }
let _trMenu=null;
function trEl(){ if(_trMenu)return _trMenu; const m=document.createElement("div"); m.className="trmenu"; document.body.appendChild(m);
  m.addEventListener("mousedown",e=>e.preventDefault());   // clicking a row must not dismiss the menu (via the document mousedown) before its click fires
  _trMenu=m; return m; }
function trClose(){ setPillMenuOpen("translitPill",false); if(_trMenu)_trMenu.classList.remove("show"); }
function trMenuSep(m){ const d=document.createElement("div"); d.className="trsep"; m.appendChild(d); }   // a hairline between the .trmenu's logical groups
/* TWO COLUMNS OF RADIO BUTTONS over one shared list of schemes. The two settings do not offer the same options,
   and the grid says so by leaving a cell EMPTY rather than by disabling a control:
     · "None" is a DISPLAYED choice only in Sanskrit, whose IAST row is optional beneath the script glyph
       (feature 7); every other language's displayed transliteration is never empty.
     · "None" is always a STORED choice — storing nothing is a real state.
     · a scheme is a stored choice only if it is `stored` (the subset io_conllu can write back).
     · an `available:false` scheme (engine not installed) is a choice in neither, and says so ONCE in the name
       column rather than once per column.
   Real <input type="radio"> in two named groups, so the columns are independently exclusive and the keyboard and
   accessibility behaviour is the platform's rather than something re-implemented over ✓ marks. */
function trCell(kind,sc,offered){
  const cell=document.createElement("span"); cell.className="trcell";
  if(!offered) return cell;   // deliberately empty: not a choice in this column at all
  const r=document.createElement("input"); r.type="radio"; r.name="tr-"+kind; r.className="trradio";
  r.checked = kind==="d" ? (sc.id ? !!(show.translit&&TRANSLIT_SCHEME===sc.id) : !(show.translit&&TRANSLIT_SCHEME))
                         : ((typeof STORED_SCHEME!=="undefined"?STORED_SCHEME:"")||"")===sc.id;
  r.setAttribute("aria-label",(kind==="d"?"Displayed":"Stored")+": "+sc.label);   // the ACCESSIBLE name stays unabbreviated — the visual header is short for layout, which is no reason for a screen reader to hear "Disp."
  r.addEventListener("change",()=>{ if(kind==="d") trPick(sc.id); else storedPick(sc.id); });
  cell.appendChild(r); return cell; }
/* The tag on an unavailable scheme, shared by BOTH menus (the transliteration grid below and the
   Script list in orRender). `needs` — from app/translit.py's _scheme_needs — names the extras tier
   that would supply the missing engine or table, and where there is one the tag becomes a LINK to
   that tier's row in Manage Models. A scheme the user can have is a different thing from one nobody
   can have, and a flat "unavailable" said both. Where `needs` is empty the tag stays inert text, and
   that is right: Mongolian (traditional) is off because no correct converter exists, so a link
   offering to install one would be a lie. Python decides which is which; this only draws it.
   A <button>, not a styled span: it is a control, and the keyboard has to be able to reach it. */
function naTag(sc){ if(!sc.needs){ const s=document.createElement("span"); s.className="trna"; s.textContent="unavailable"; return s; }
  const b=document.createElement("button"); b.type="button"; b.className="trna trna-link"; b.textContent="install";
  b.title="Install the support this needs — opens Manage Models";
  b.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); trClose(); orClose();
    if(typeof manageModels==="function") manageModels(sc.needs); });
  return b; }
function trRender(){ const m=trEl(); m.innerHTML="";
  const grid=document.createElement("div"); grid.className="trgrid";
  const head=t=>{ const h=document.createElement("span"); h.className="trghead"; h.textContent=t; grid.appendChild(h); };
  head(""); head("Display"); head("Store");   // VERBS, not participles: the column heads the action a radio in it performs, and both fit the radio-width column   // abbreviated: the column is only as wide as a radio button, and "Displayed" set the whole grid's first column width from a header rather than from the scheme names below it
  const rows=[{id:"",label:"None",available:true,stored:true}].concat(TRANSLIT_SCHEMES);
  /* NO GROUP HAIRLINES. They divided the list into off-row / stored-capable / display-only, which the two radio
     COLUMNS now say directly: a scheme with no Stored radio is display-only, and "None" is the row whose radios
     mean "off". A rule drawn across a table that already answers the question is one more thing to read. */
  rows.forEach(sc=>{
    const nm=document.createElement("span"); nm.className="trname"; nm.textContent=sc.label;
    if(sc.id&&!sc.available){ nm.classList.add("trdim"); nm.appendChild(naTag(sc)); }
    grid.appendChild(nm);
    const ok=!sc.id||sc.available;
    grid.appendChild(trCell("d",sc, ok && (sc.id ? true : isSanskritLang())));
    grid.appendChild(trCell("s",sc, ok && (sc.id ? !!sc.stored : true))); });
  m.appendChild(grid); }
// item 24b: the Displayed menu ONLY changes the transliteration ROW (never MISC) → no confirm. MISC is the Stored pill's job.
function trPick(id){ trClose();
  if(!id){ if(show.translit||TRANSLIT_SCHEME){ show.translit=false; TRANSLIT_SCHEME=""; updateTranslitPill(); if(DOC.length)preserveScroll(renderDoc); } if(DOCLANG)PREFS.translit[DOCLANG]=""; savePrefs(); toast("Displayed transliteration off"); return; }   // RECORD the off-state as "", don't delete the key: turning the row off is a deliberate choice (this row is Sanskrit-only — see trRender), and deleting made it indistinguishable from "never chose", so the next open silently turned the row back on. prefTranslit reads key-presence for exactly this distinction.
  if(show.translit&&TRANSLIT_SCHEME===id) return;   // no change → no-op
  TRANSLIT_SCHEME=id;
  /* …and whether the ROW is drawn is saTransRow's call for Sanskrit, not an unconditional yes. Forcing
     it on here is what put a second line under an IAST-stored sentence whose glyph is already Latin —
     the same words twice, which is precisely what saTransRow exists to prevent and what every OTHER
     entry point (loadTranslitSchemes, setLang, orPick) already asks it. Picking a plain romanisation
     under a Latin glyph therefore draws no row, by design; picking CSL does, because CSL respells the
     sentence rather than repeating it. */
  show.translit=isSanskritLang()?saTransRow():true;
  updateTranslitPill(); clearTranslitCache(); fillTranslit(); if(DOC.length)preserveScroll(renderDoc);
  if(DOCLANG){ PREFS.translit[DOCLANG]=id; savePrefs(); }
  toast("Displayed transliteration: "+trSchemeLabel(id)); }
function openTranslitMenu(x,y){ const m=trEl(); trRender(); m.classList.add("show"); setPillMenuOpen("translitPill",true);
  const w=m.offsetWidth,h=m.offsetHeight;   // opens upward, above the status-bar pill (like the language picker)
  m.style.left=Math.max(8,Math.min(x,innerWidth-w-8))+"px";
  if(y-h-6>=8){ m.style.top=""; m.style.bottom=(innerHeight-(y-6))+"px"; }
  else { m.style.bottom=""; m.style.top=Math.min(y+6,innerHeight-h-8)+"px"; } }
document.getElementById("translitPill").addEventListener("click",e=>{ e.stopPropagation(); if(e.currentTarget.classList.contains("disabled"))return;
  if(_trMenu&&_trMenu.classList.contains("show")){ trClose(); return; }   // item 9: the TRIGGER toggles — a click on the pill while its own menu is open closes it (the mousedown closer below deliberately exempts the pill, so the menu is still "show" by the time this click runs; without this the pill would just re-render the menu open and look inert)
  const r=e.currentTarget.getBoundingClientRect(); openTranslitMenu(r.left,r.top); });   // item 6: the disabled pill is inert
addEventListener("mousedown",e=>{ if(_trMenu&&_trMenu.classList.contains("show")&&!_trMenu.contains(e.target)&&!(e.target.closest&&e.target.closest("#translitPill"))) trClose(); },true);
addEventListener("resize",trClose);

// ── item 24b: separate STORED transliteration pill/menu (the subset written to Misc; changing it rewrites Misc, confirmed) ──
function storedSchemes(){ return TRANSLIT_SCHEMES.filter(s=>s.stored); }
function storedLabel(id){ const s=TRANSLIT_SCHEMES.find(x=>x.id===id); return s?s.label:""; }
function updateStoredPill(){ updateTranslitPill(); }   // the stored value is a slot in the ONE pill's label now; kept under this name because several callers ask for it by it
function stClose(){ trClose(); }   // ONE menu now — storedPick still closes it by this name
/* (storedRender built the second menu's rows; the Stored column of trRender above is what draws them now.) */
// item: per-token HAND CORRECTIONS (_trPick — a stored value edited on the row, or a reading picked from
// the flyout) are the one thing in the document the doc-wide rewrite below can't simply regenerate, so it
// neither keeps them verbatim in a scheme they aren't written in nor drops them silently. Each is CONVERTED
// into the new stored scheme through the same scheme→scheme derivation the displayed row uses; where the two
// schemes can't be related at all (translit.derive_scheme returns "" — a character-keyed scheme, or two
// schemes transcribing different languages) the correction is dropped and the token goes back to the
// automatic reading. storedPick's confirmation says which, before any of it happens.
function countTrPicks(){ let n=0; DOC.forEach(s=>s.tokens.forEach(t=>{ if(t._trPick&&miscTranslit(t.misc)) n++; })); return n; }
async function convertTrPicks(from,to){ const items=[];
  DOC.forEach(s=>s.tokens.forEach(t=>{ if(!t._trPick) return; const st=miscTranslit(t.misc); if(st) items.push([t,st]); else delete t._trPick; }));   // a _trPick with nothing in MISC is no longer a correction
  if(!items.length) return false;
  const cross=!!(from&&to&&from!==to);   // same scheme (or an unknown one) → the stored strings still read correctly; only a real scheme change needs converting
  let d=[];
  if(cross&&hasBridge()&&DOCLANG){ try{ const r=await window.pywebview.api.translit_derive(items.map(x=>x[0].form),items.map(x=>x[1]),DOCLANG,from,to); d=(r&&r.translit)||[]; }catch(e){ d=[]; } }
  let any=false;
  items.forEach(([t,st],i)=>{ const v=cross?(d[i]||""):st;
    if(v){ if(v!==st){ t.misc=setMiscKV(t.misc,"Translit",v); any=true; } }
    else { delete t._trPick; t.misc=setMiscKV(t.misc,"Translit",""); any=true; }   // not derivable → annotateTranslitMisc (next) refills it with the automatic reading
    t.translit=""; });   // the displayed row is derived from the stored value either way → re-derive it (fillTranslit)
  return any; }
async function storedPick(id){ stClose(); id=id||""; if(id===STORED_SCHEME) return;
  const hasDoc=DOC.some(s=>s.tokens&&s.tokens.length);   // changing the stored scheme rewrites Misc Translit/LTranslit doc-wide → confirm
  const np=countTrPicks(), plural=np>1?"s":"";   // …and say what becomes of the hand-corrected tokens, rather than quietly rewriting them
  const msg=id ? `Change stored transliteration to ${storedLabel(id)}? This regenerates Misc Translit/LTranslit for the whole document.`+(np?` The ${np} hand-corrected token${plural} will be converted where the two schemes allow it, and reset to the automatic reading where they do not.`:"")
               : "Store no transliteration? This removes Misc Translit/LTranslit from the whole document."+(np?` The ${np} hand-corrected token${plural} will be removed with it.`:"");
  if(hasDoc && !(await askConfirm(msg,{okLabel:id?"Change":"Remove",danger:!id}))) return;
  const pre=snap();   // taken BEFORE the scheme changes, so undo restores the scheme AND the MISC it rewrote; committed only if the rewrite actually touched anything
  const from=STORED_SCHEME;
  STORED_SCHEME=id; updateStoredPill();
  if(id){ convertTrPicks(from,id).then(async cv=>{ const ch=await annotateTranslitMisc(null); if(ch||cv){ commitSnap(pre); markDirty(); } if(show.translit) await fillTranslit(); preserveScroll(renderDoc); }); }
  else { let any=false; DOC.forEach(s=>s.tokens.forEach(t=>{ if(t._trPick){ delete t._trPick; t.translit=""; }   // the corrections go with the stored transliteration (as the confirmation said) — the row falls back to the automatic romanisation of the form
      const nm=setMiscKV(setMiscKV(t.misc,"Translit",""),"LTranslit",""); if(nm!==t.misc){ t.misc=nm; any=true; } })); if(any){ commitSnap(pre); markDirty(); } if(show.translit)fillTranslit(); preserveScroll(renderDoc); }   // None → strip MISC Translit/LTranslit
  if(DOCLANG){ PREFS.stored=PREFS.stored||{}; if(id)PREFS.stored[DOCLANG]=id; else delete PREFS.stored[DOCLANG]; savePrefs(); }
  toast(id?("Stored transliteration: "+storedLabel(id)):"Stored transliteration: None"); }
/* (openStoredMenu and the #storedPill click / dismiss / resize listeners were here. One pill, one menu: the
   Stored COLUMN inside it offers exactly what that menu did.) */

// ── status-bar ORTHOGRAPHY picker (display-only: re-renders the token GLYPHS in a script/scheme; ──
// NEVER written to MISC). Separate from transliteration: "Original" leaves the glyphs untouched.
let ORTHO_SCHEMES=[];   // cached [{id,label,available}] for the current DOCLANG (empty ⇒ no menu)
let ORTHO_SCHEME="";    // chosen orthography id ("" ⇒ Original / no re-rendering)
let _orLangLoaded=null;
function clearOrthoCache(){ DOC.forEach(s=>{ s.tokens.forEach(t=>{ t.ortho=""; }); (s.mwt||[]).forEach(m=>{ m.ortho=""; m.miast=""; }); s.orthoLine=""; }); }   // s.orthoLine = the block-initial running text fused by external sandhi then scripted (item 27b); invalidated on a script/language change
function isSanskritLang(lang){ const b=((lang!=null?lang:DOCLANG)||"").toLowerCase().split(/[-_]/)[0]; return b==="sa"||b==="san"; }
/* ── which script the DOCUMENT is stored in ───────────────────────────────────────────────────────
   Sanskrit is DIGRAPHIC IN STORAGE: `sa_sud_vedic_ufal_dcs` takes IAST or Devanagari and puts back
   whichever it was given, so a file's FORM/LEMMA columns are in one script or the other and nothing
   in the file says which. That fact decides four things, so it is worth a global rather than four
   inline sniffs: whether "Original" already shows a script (and so whether the IAST row beneath is
   worth showing), which script a re-fused MWT form has to come back in, what ITRANS input converts
   TO, and whether the diagram's form editor edits the glyph or the row beneath it.

   "" = Latin, which is also the answer for every other language, so a caller may read it
   unconditionally. Read off the FORMS (Api.doc_script), never off a preference or a comment: it is
   a property of the file, and a reader's display choice must not be able to contradict it. */
let DOCSCRIPT="";
const _DEVA_RE=/[ऀ-ॿ]/;
async function loadDocScript(){
  const forms=[];
  for(const s of (DOC||[])){ for(const t of (s.tokens||[])){ if(t.form){ forms.push(t.form); if(forms.length>=40) break; } } if(forms.length>=40) break; }
  if(!isSanskritLang()||!forms.length){ DOCSCRIPT=""; return DOCSCRIPT; }
  // The local test answers the only two scripts the parser emits, and answers them with no round
  // trip; the bridge is asked because a hand-built file could be in any Brahmic script and only
  // Python has the detector. Design mode (no bridge) keeps the local answer rather than none.
  DOCSCRIPT=_DEVA_RE.test(forms.join("")) ? "Devanagari" : "";
  if(hasBridge()&&DOCLANG){ try{ const r=await window.pywebview.api.doc_script(forms, DOCLANG); if(r&&r.script!=null) DOCSCRIPT=r.script; }catch(e){} }
  return DOCSCRIPT; }
/* The script the MAIN GLYPH is currently drawn in, for Sanskrit: the selected Script where one is
   selected, else the document's own. "" means Latin. `saGlyphLatin` is the question every caller
   actually has — "is what the reader is looking at romanised?" — and it is NOT the same as "is a
   script selected": a Devanagari file under "Original" shows a script with none selected, and an
   IAST file under "Latin" shows none with one selected. */
function saGlyphScript(){ if(!isSanskritLang()) return "";
  return (ORTHO_SCHEME&&ORTHO_SCHEME!=="none") ? ORTHO_SCHEME : DOCSCRIPT; }
function saGlyphLatin(){ const g=saGlyphScript(); return !g||g==="iast"; }
/* Is the chosen SCRIPT a no-op on this file? "Latin" over an IAST-STORED document renders each
   token to the spelling it already has, so the derived top line is character-for-character `# text` —
   and drawing it displaces the real text into the row below, where it reads as the same line twice.
   That is the "unnecessary running transliteration" under Script=Latin: not a transliteration at all,
   just the text copied. A DEVANAGARI-stored file is untouched by this — there IAST genuinely romanises,
   so the displacement earns its place. Nothing else is affected: every Brahmic script changes the
   glyphs, and "Original" never displaced anything. */
function saScriptNoop(){ if(!isSanskritLang() || saCslTop()) return false;
  // A rendering into the script the file is ALREADY WRITTEN IN changes nothing, whichever script that is:
  // "Latin" over an IAST-stored file, Devanagari over a Devanagari-stored one. Both drew a derived top
  // line identical to `# text` and pushed the real text into the row beneath, where it read as the same
  // line twice — measured on samples/brihat_jataka_devanagari.conllu, whose row beneath the Devanagari
  // was character-for-character the Devanagari above it. "" storage means IAST, hence the default.
  return ORTHO_SCHEME === (DOCSCRIPT || "iast"); }
/* …unless CSL is what would fill it. Asking for Latin as the SCRIPT and CSL as the transliteration is
   asking for the sentence itself in CSL — the two choices name one Latin line, and drawing plain IAST
   above a CSL row would be the same sentence twice in two spellings. So the derived top line comes back
   for this case, with CSL in it, and the editable `# text` sits beneath as it does under any script.
   Only for a LATIN script: under Devanagari the glyph is Devanagari and CSL takes a row of its own. */
function saCslTop(){ return isSanskritLang() && TRANSLIT_SCHEME==="csl" && ORTHO_SCHEME==="iast"; }
/* Does the Sanskrit transliteration row belong under the glyph?  Only where it would SAY SOMETHING
   the glyph does not already say. For IAST that means a non-Latin glyph above it, or the row merely
   repeats the word — the test this replaced was "is a script selected", right only while every
   Sanskrit file was stored in IAST.
   ⚠ CSL IS THE EXCEPTION, and leaving it out is what made picking CSL appear to do nothing at all.
   CSL is not a romanisation of the glyph, it is the SAME text with its junctions written: `vartma`
   shows `vartm"`, `iti` shows `êty`, and a compound's seams come apart. Under a Latin glyph that is
   a different string, not a repetition — so on an IAST-stored file (where the glyph IS Latin and the
   gate below is false) the row was hidden, the scheme was filled into a row nobody could see, and
   the only visible effect of choosing CSL was the toast. Ask what the ROW would show, not what
   script the glyph is in. */
function saTransRow(){ return isSanskritLang() && (TRANSLIT_SCHEME==="csl" || !saGlyphLatin()); }
/* ── A SANSKRIT MWT'S NEIGHBOURS ────────────────────────────────────────────────────────────────
   An orthographic word's first and last segments are shaped by the words either side of it, so
   fusing a range's own components spells both ends in pausa — the one way a running text never
   spells them. Every caller that re-fuses a range needs the same three facts, and they must agree:
   sandhiMwtForms (js/io/bridge.js) rewrites the stored FORM, fillOrtho (js/lang/translit-load.js)
   the SCRIPT rendering of the same word, and the two disagreeing is visible as a glyph that does
   not match the form under it. Hence one helper, here, in the module both load after.
   A neighbour is an ORTHOGRAPHIC word — the containing MWT's form where the adjacent token is
   inside one — since that is the unit sandhi applies between. A daṇḍa is stepped OVER rather than
   stopping the search, because visarga sandhi crosses it (`…hṛtkroḍavāsobhṛto |⏎bastir…` takes its
   -o from `bastir`); `pause` reports that one stood in the way, which is what -m → -ṃ needs, since
   that assimilation does NOT cross a pause (`…arajyotiṣām |` keeps its -m). See app/translit.py's
   _boundary_sandhi for the rules the two flags feed. */
const SA_DANDA=["|","||","।","॥","‖","।।"];
/* ── CSL JOINS ITS PIECES DIFFERENTLY FROM EVERY OTHER SCHEME ──────────────────────────────────
   CSL exists to write the junctions rather than the fusion, and once a junction is MARKED the pieces
   either side of it are written apart — that is the whole point of the marks. So a CSL line does not
   take its spacing from `# text` (which shows the fusion) the way the script line and every ordinary
   romanisation do. Read straight off this repository's own pre-DCS CSL text, which is what the sample
   used to carry (`git show 7c60890:samples/brihat_jataka.conllu`):
       mūrtitve parikalpitaḥ śaśa-bhṛto vartm" â-punar-janmanām |
       lokānāṃ pralay'-ôdbhava-sthiti-vibhuś c' ânekadā yaḥ śrutau |
   · between two WORDS — a space, even where the text fused them: `vartm" â-punar-…`, `c' ânekadā`,
     `ātm" êty`. Written solid (`vartm'âpunar…`) the mark cannot be told from a letter.
   · between COMPOUND MEMBERS of one word — a hyphen: `śaśa-bhṛto`, `ātma-vidāṃ`, `aneka-kiraṇas`,
     and `pralay'-ôdbhava-sthiti-vibhuś`, which shows both marks meeting.
   `mwtSepOf` is preferred where the file itself showed a separator; DCS text writes its orthographic
   words solid, so it usually has none and this default supplies CSL's own. `-` NOT `|`, on that
   evidence — and `|` is this text's daṇḍa besides, so a compound seam spelt with one would read as a
   verse break. `_STX_PH` in js/io/bridge.js treats both as separators, so switching is one character. */
const SA_CSL_SEP="-";
function saCslSep(m){ return (typeof mwtSepOf==="function"?mwtSepOf(m):(m&&m.sep))||SA_CSL_SEP; }
function saMwtContext(s,m){
  const mwtAt=k=>(s.mwt||[]).find(x=>k>=x.from&&k<=x.to);
  const walk=(k,step)=>{ let pause=false;
    for(let n=0;n<8;n++){ if(k<1||k>s.tokens.length) return ["",pause];
      const g=mwtAt(k), w=g?(g.form||""):((s.tokens[k-1]||{}).form||"");
      if(!w) return ["",pause];
      if(SA_DANDA.indexOf(w)<0) return [w,pause];
      pause=true; k=(g?(step>0?g.to:g.from):k)+step; }
    return ["",pause]; };
  const nx=walk(m.to+1,+1);
  return {prev:walk(m.from-1,-1)[0], next:nx[0], pause:nx[1]}; }
/* ── ITRANS → the document's script, for typed Sanskrit (item 1) ──────────────────────────────────
   Neither storage script is typeable on an ordinary keyboard — IAST needs diacritics with no keys,
   Devanagari needs an IME — so what gets typed is ITRANS: kRiShNa, raamaayaNa, sha~Nkara. Every
   Sanskrit input field runs its value through here on commit, and it lands in DOCSCRIPT, so the
   same keystrokes give `kṛṣṇa` in an IAST file and `कृष्ण` in a Devanagari one.
   ONE gate, in Python (app/itrans.py's looks_itrans), so no two call sites can disagree about what
   counts as ITRANS: a word must be pure ASCII (an IAST diacritic proves it is already IAST) AND
   carry an ITRANS-only spelling (aa/ii/uu, sh/Sh, ~n/~N, a .-digraph, or a NON-INITIAL capital from
   T D N S R M H A I U E O). A word that reads the same either way — "rama", "deva" — is left
   exactly as typed for an IAST document, because converting it could only be a no-op or a
   corruption; for a Devanagari one it is still converted, since there the two readings agree and
   leaving it alone would put a Latin word in a Devanagari file.
   The whole thing is a no-op for any other language and with no bridge, so a caller never has to
   ask whether it applies: `v = await itransFix(v)` and commit whatever comes back. */
async function itransFix(text){
  if(!text || !isSanskritLang() || !hasBridge()) return text;   // gate here as well as in Python: no round-trip at all for the 99 % of documents this can't touch
  try{ const r=await window.pywebview.api.itrans_to_iast(text, DOCLANG||"", DOCSCRIPT||""); return (r&&r.converted!=null)?r.converted:text; }
  catch(e){ return text; } }   // bridge/engine failure ⇒ keep what was typed, never lose the input
// The Script pill's DEFAULT for a language, i.e. what it shows when nothing is remembered: "" — Original,
// the stored glyphs untouched. Sanskrit used to default to "none" instead, because its stored form was
// Latin by definition and "Original" would have named a romanisation rather than a script. It can now be
// stored in Devanagari, so "Original" is a real answer there too — and the right one, since a file opens
// showing what it says.
function orthoDefault(lang){ return ""; }
// Resolve the Script pill for a language load. `want` is the remembered choice — the per-language
// preference — or null for "nothing remembered at all" (prefOrtho's key-absent case).
// EVERY branch returns a value, deliberately: ORTHO_SCHEME is a page-global, and the older conditional form
// left it UNTOUCHED whenever `want` didn't match, so a script chosen for one language survived into the next
// document in any language that happened to accept it (and into a language with no Script menu at all).
function orthoResolve(lang,want){
  if(want==null) return orthoDefault(lang);            // never chose → the language default
  if(want==="none") return isSanskritLang(lang)?"":"none";   // "None" is a SYNTHETIC menu row (never present in ORTHO_SCHEMES), so it has to be matched HERE — testing it against the scheme list is what made a remembered None fall through and never come back. Sanskrit no longer OFFERS the row (its "Latin" scheme says the same thing and says it as a script), so a None remembered from before that change resolves to Original rather than to a row the menu can't tick.
  if(want==="") return "";                             // a deliberate "Original"
  return ORTHO_SCHEMES.some(s=>s.id===want&&s.available) ? want : orthoDefault(lang); }   // a real script id, honoured only while it is actually available — an uninstalled extra falls back for THIS load without forgetting the preference (only orPick ever rewrites it), so the script returns once the extra is back
async function loadOrthoSchemes(lang){ lang=lang||""; _orLangLoaded=lang; ORTHO_SCHEMES=[];
  if(hasBridge()&&lang){ try{ const r=await window.pywebview.api.orthography_schemes(lang); if(_orLangLoaded!==lang)return; ORTHO_SCHEMES=(r&&r.schemes)||[]; }catch(e){ ORTHO_SCHEMES=[]; } }
  // The Script pill has ONE source of truth: the per-language preference. The open document gets no say (see
  // adoptDocSchemes for why the script is the reader's property and not the document's), so there is no file
  // value to weigh here, and none of the DOCSCHEME_GEN/schemeGenOK
  // machinery the Stored pill needs (it still consumes one-shot file metadata, and an async load
  // can straddle an adopt). `want` is therefore simply what the user last chose, or null if they never have.
  const want=prefOrtho(lang);
  ORTHO_SCHEME=orthoResolve(lang,want); syncSchemeAttr();   // an UNCONDITIONAL assignment — see orthoResolve
  if(isSanskritLang(lang)) show.translit=saTransRow();   // item 27(c): the IAST transliteration row/pill is gated on the glyph being non-Latin, not on a script being SELECTED — a Devanagari-stored file wants the row under "Original"
  updateOrthoPill(); updateTranslitPill(); clearOrthoCache();
  if(DOC.length) preserveScroll(renderDoc);
  if(ORTHO_SCHEME) fillOrtho();
  if(isSanskritLang(lang)&&show.translit) fillTranslit(); }
// Mirrors ORTHO_SCHEME onto #doc as a data attribute (general hook, currently informational/for
// devtools — mirrors the ORTHO_SCHEME==="Grantha"/"Javanese"/"Balinese"/"Kawi"/"ZanabazarSquare" → .stext-stacked JS-added-CLASS
// pattern document.js uses for stacked-diacritic line-height) AND, for the one scheme that actually
// needs it, an inline --token-font override on #doc: Nithya Ranjana's cmap reuses plain Devanagari
// codepoints (see fonts.css's @font-face comment), so the ordinary "first stack family with a glyph"
// resolution can never distinguish Ranjana-scheme text from Devanagari-scheme text by codepoint alone
// — only ORTHO_SCHEME (a reader preference, not something in the text) knows which is meant, so this is
// the one place to intervene. A CSS rule doing this via a self-referencing var(--token-font) was tried
// FIRST and is NOT used — verified cyclic (invalid-at-computed-value-time) under headless Chrome
// regardless of which element it's declared on, so fonts.css doesn't have a [data-scheme] rule for
// this; the override is computed here instead and set as an inline style, which needs no self-reference
// and always wins the cascade for #doc. TOKEN_STACK (diagram-core.js) is the SAME family list as
// mac-tokens.css's --token-font — string-built here rather than duplicated by hand in a CSS rule, so it
// can't silently drift from the base stack as that list is edited. Called from both places ORTHO_SCHEME
// is assigned (loadOrthoSchemes, orPick) so it can never go stale.
function syncSchemeAttr(){ const d=document.getElementById("doc"); if(!d) return;
  d.dataset.scheme=ORTHO_SCHEME||"";
  /* The --token-font override goes on <html> (document.documentElement), NOT on #doc: #doc is where the
     DIAGRAM lives, but it isn't the only place token-font text renders — the "Definitions of …"/"Readings
     of …" flyout (.ctx-sub.defctx) and the lemma/correct-form prompt's title (.countpop.textpop .cp-title)
     both quote a token's CURRENT-script form too, and both are popups appended straight to <body> (see
     context-menu.js's ctx2/countpop), OUTSIDE #doc's subtree entirely. A custom property set on #doc only
     reaches #doc's own descendants; setting it on <html> instead reaches BOTH #doc and every body-level
     popup, since both hang off <html>. #doc keeps resolving the identical value either way (nothing
     between <html> and #doc declares --token-font of its own, so #doc simply inherits it same as before)
     — this is a strict superset of the old scoping, not a behaviour change for the diagram itself. */
  const root=document.documentElement;
  if(ORTHO_SCHEME==="Ranjana" && typeof TOKEN_STACK==="string") root.style.setProperty("--token-font",'"Nithya Ranjana", '+TOKEN_STACK);
  else root.style.removeProperty("--token-font"); }
function orSchemeLabel(id){ const s=ORTHO_SCHEMES.find(x=>x.id===id); return s?s.label:""; }
/* WHAT THE "no scheme" ROW IS CALLED, which is not the same question in every language. Everywhere else the
   Script menu picks a WRITING SYSTEM, and declining to pick one is "Original" — the stored glyphs. Latin's
   only entry is not a writing system at all but a second SPELLING of the one it has (vowel length, see
   _SCRIPT_SCHEMES["la"] in app/translit.py), so the menu is a two-state choice about macrons and naming
   its off-state after the absence of a script says nothing a reader of Latin would recognise.
   `isLatinLang` and not a check for "does this language's only scheme happen to be `macron`": the naming is
   a fact about Latin, and a second Latin scheme later must not silently rename the row back. */
function isLatinLang(lang){ return ((lang!=null?lang:DOCLANG)||"").toLowerCase().split(/[-_]/)[0]==="la"; }
function orthoOffLabel(){ return isLatinLang()?"Without macrons":"Original"; }
function updateOrthoPill(){ const p=document.getElementById("orthoPill"); if(!p)return;
  if(!ORTHO_SCHEMES.length){ p.hidden=true; return; }
  p.hidden=false; p.classList.add("pickable");
  const lbl=document.getElementById("orthoPillLabel");   // the label span only — the trailing chevron svg is a persistent sibling
  if(lbl)lbl.textContent="Script: "+(ORTHO_SCHEME==="none"?"None":(ORTHO_SCHEME?orSchemeLabel(ORTHO_SCHEME):orthoOffLabel()));
  sizePill(p, ["Script: None", "Script: "+orthoOffLabel(), ...ORTHO_SCHEMES.map(s=>"Script: "+s.label)]); }
let _orMenu=null;
function orEl(){ if(_orMenu)return _orMenu; const m=document.createElement("div"); m.className="trmenu"; document.body.appendChild(m);
  m.addEventListener("mousedown",e=>e.preventDefault()); _orMenu=m; return m; }
function orClose(){ setPillMenuOpen("orthoPill",false); if(_orMenu)_orMenu.classList.remove("show"); }
function orRender(){ const m=orEl(); m.innerHTML="";
  // item 11: "Original" (default, stored form) + "None" (→ displayed transliteration becomes the main glyph) + the scripts.
  // Sanskrit is stored in Latin (IAST) so "Original" would just be a romanisation, not a script → list scripts only.
  // Sanskrit gets "Original" like everyone else — its stored script is now a real question, not a
  // constant — but NOT the "None" row. "None" means "show the displayed transliteration as the main
  // glyph", and Sanskrit's only displayed transliteration is IAST, which the schemes list already
  // offers by name as "Latin". Two rows doing one thing, one of them naming it after the
  // absence of a script when it IS one, is worse than one.
  /* …and Latin gets no "None" row either, for the same reason Sanskrit doesn't: "None" means "promote the
     displayed transliteration to the main glyph", and Latin has no displayed transliteration to promote —
     the row would name a state it cannot reach. That leaves exactly the two-state choice the macron scheme
     is: "Without macrons" (orthoOffLabel) and "With macrons". */
  const off=(isSanskritLang()||isLatinLang())?[{id:"",label:orthoOffLabel(),available:true}]
                            :[{id:"",label:"Original",available:true},{id:"none",label:"None",available:true}];
  const rows=off.concat(ORTHO_SCHEMES);
  let pg=null;
  rows.forEach(s=>{ const grp=(s.id===""||s.id==="none"); if(pg!==null&&grp!==pg)trMenuSep(m); pg=grp;   // hairline between the Original/None off-rows and the actual scripts
    const b=document.createElement("button"); b.type="button"; b.className="trrow";
    const ck=document.createElement("span"); ck.className="ck"; ck.textContent=(s.id===ORTHO_SCHEME)?"✓":""; b.appendChild(ck);
    const nm=document.createElement("span"); nm.className="trname"; nm.textContent=s.label; b.appendChild(nm);
    /* An unavailable row that an install WOULD fix stays enabled, so its "install" tag can be clicked
       and reached by keyboard — the row itself does nothing (picking a scheme with no engine behind it
       would show the bare forms and say nothing about why), the tag inside it is the only live target.
       One with no `needs` is disabled as before: there is nothing to click. */
    if(s.id&&!s.available){ b.classList.add("trdim"); b.appendChild(naTag(s)); if(!s.needs) b.disabled=true; }
    else b.addEventListener("click",()=>orPick(s.id));
    m.appendChild(b); }); }
function orPick(id){ orClose(); id=id||""; if(id===ORTHO_SCHEME) return;
  ORTHO_SCHEME=id; syncSchemeAttr();
  if(isSanskritLang()) show.translit=saTransRow();   // item 27(c): the IAST transliteration row/pill follows the GLYPH (non-Latin ⇒ show IAST beneath; Latin/an IAST-stored Original ⇒ hide)
  updateTranslitPill(); updateOrthoPill(); clearOrthoCache();
  if((ORTHO_SCHEME && ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho();   // a script fetches its rendering; Sanskrit also fuses MWT sandhi under None (item 18)
  if((!ORTHO_SCHEME||ORTHO_SCHEME==="none") && DOC.length) preserveScroll(renderDoc);   // None/Original: re-render NOW to revert the glyphs (the cache was just cleared). fillOrtho only re-renders when it FETCHED something, so a script→None switch on a sentence with no MWTs would otherwise leave the stale script glyphs on screen.
  if(isSanskritLang()&&show.translit) fillTranslit();   // fill the IAST row now that a script is active
  if(DOCLANG){ PREFS.ortho[DOCLANG]=ORTHO_SCHEME; savePrefs(); }   // store ALL THREE kinds of choice verbatim — a script id, "none", and "" (Original). Deleting the key on Original (what this did before) left a deliberate Original indistinguishable from "never chose", so it could not be restored for a language whose default is not Original — see prefOrtho.
  toast(ORTHO_SCHEME==="none"?"Script: None (transliteration as main)"
        :(ORTHO_SCHEME?("Script: "+orSchemeLabel(ORTHO_SCHEME))
        :(isLatinLang()?orthoOffLabel():"Original script"))); }   // …and the toast says what the row the user just picked said (see orthoOffLabel)
function openOrthoMenu(x,y){ const m=orEl(); orRender(); m.classList.add("show"); setPillMenuOpen("orthoPill",true);
  const w=m.offsetWidth,h=m.offsetHeight;
  m.style.left=Math.max(8,Math.min(x,innerWidth-w-8))+"px";
  if(y-h-6>=8){ m.style.top=""; m.style.bottom=(innerHeight-(y-6))+"px"; }
  else { m.style.bottom=""; m.style.top=Math.min(y+6,innerHeight-h-8)+"px"; } }
document.getElementById("orthoPill").addEventListener("click",e=>{ e.stopPropagation();
  if(_orMenu&&_orMenu.classList.contains("show")){ orClose(); return; }   // item 9: click-to-close on the trigger, exactly as #translitPill above
  const r=e.currentTarget.getBoundingClientRect(); openOrthoMenu(r.left,r.top); });
addEventListener("mousedown",e=>{ if(_orMenu&&_orMenu.classList.contains("show")&&!_orMenu.contains(e.target)&&!(e.target.closest&&e.target.closest("#orthoPill"))) orClose(); },true);
addEventListener("resize",orClose);

// ── app-level user preferences (persist ACROSS files in state.json; separate from the per-file ──
// `# translit_scheme` document metadata, which names the STORED scheme only). Precedence when a
// language loads: the per-language preference; else the language default.
