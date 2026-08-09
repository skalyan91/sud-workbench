//@module js/bridge.js
/* ─── Python bridge (pywebview) ──────────────────────────────────────────────
   The frontend owns the live document; window.pywebview.api handles the
   file-touching operations. With no bridge (opened in a plain browser for
   design work) the sample document above is kept and Import/Save no-op with a
   hint, so the whole UI still exercises. */
// hasBridge / DIRTY / DOCNAME / DOCPATH are declared earlier (just before the init/wiring section) so the titlebar init IIFE isn't in their TDZ
/* ── the ONE way this app opens a URL outside itself (guideline links, dictionary source links, a sentence's
   source URL). `window.open` is INERT inside a WKWebView: nothing sets a window-open policy (WKUIDelegate's
   createWebViewWithConfiguration:), so WebKit silently drops the request and the click does nothing — which is
   exactly why every context-menu link was dead while the Help WINDOW's links worked; the Help window's HTML
   embeds its own `_ext` that already called the bridge (see buildHelpHTML in js/ui/sheets.js). Nine call sites
   each rolled their own `window.open` and that is how they drifted apart, so they now all come here.
   No bridge (the page opened directly in a browser for design work) → fall back to `window.open`, which a real
   browser does honour. Returns false so it can also be used as an inline `onclick="return openExternal(…)"`. */
function openExternal(url){
  if(!url) return false;
  if(hasBridge()){ try{ window.pywebview.api.open_external(String(url)); return false; }catch(e){} }   // a bridge that THREW (api not yet injected) falls through rather than swallowing the click
  try{ window.open(url,"_blank","noopener"); }catch(e){}
  return false; }
window.openExternal=openExternal;   // the native menu/child windows reach the frontend through window.* helpers; keep this one reachable the same way
// ── titlebar filename block (left): filename + "language · translit · scheme", and the macOS proxy folder-path menu ──
// swap the fallback document glyph for the real native macOS .conllu file icon once the shell injects it
function applyFileIcon(){
  const uri=window.__fileIcon, img=document.getElementById("tbFileIcon"), gl=document.getElementById("tbFileGlyph");
  if(uri&&img){ if(img.getAttribute("src")!==uri)img.src=uri; img.hidden=false; if(gl)gl.style.display="none"; }
}
window.__setFileIcon=function(uri){ window.__fileIcon=uri; applyFileIcon(); };
// real SF-Symbol PNG masks (from app/__main__.py) → the titlebar Add-Text / Manage glyphs become pixel-for-pixel
// the menu's symbols; recolour via the mask alpha like the other --sf-* masks. Falls back to the hand-drawn
// masks in the browser mockup (no bridge → __setSfSymbol never called).
window.__sfSyms={};
function applySfSymbol(which){ const uri=window.__sfSyms[which]; if(!uri)return;
  const sel={addtext:"#btnParse .sfi",manage:"#btnModels .sfi"}[which]; if(!sel)return;
  const el=document.querySelector(sel); if(el) el.style.setProperty("--m",'url("'+uri+'")'); }
window.__setSfSymbol=function(which,uri){ if(!uri)return; window.__sfSyms[which]=uri; applySfSymbol(which); };
// the native shell reports window focus (NSWindow becomeKey/resignKey) → dim the toolbar when unfocused
window.__setWindowActive=function(active){ const tb=document.querySelector(".titlebar"); if(tb)tb.classList.toggle("win-inactive",!active);
  document.documentElement.classList.toggle("win-inactive",!active); };   // …and on the ROOT, so components outside the title bar can answer to window focus too (the grid's selected row greys out — see app.css). The titlebar's own copy stays: every rule in macos-kit/mac-chrome.css is written `.titlebar.win-inactive …`, and the kit is meant to stand alone, so it keeps the hook it was written against rather than being rewritten to depend on an ancestor this app happens to mark
/* Item 6 — THE DOCUMENT'S OWN NAME, WHERE THE FILE HAS ONE. A `# newdoc id = …` on the first sentence names the
   document; where that is the ONLY newdoc in the file, the file holds exactly one named document and that name is
   a better title than the filename — so it takes the title line and the filename is downgraded to the subtitle.
   "Only" is read as "no OTHER sentence carries a newdoc AT ALL", not merely "no other carries an id": a bare
   `# newdoc` further down still starts a second document, and titling the window after the first one would then
   be a claim about the file that isn't true. Returns "" whenever the condition doesn't hold, and every caller
   falls back to DOCNAME. */
function loneDocId(){ if(typeof DOC==="undefined"||!DOC||!DOC.length) return "";
  const id=(typeof boundId==="function")?boundId(DOC[0],"newdoc"):"";
  if(!id) return "";
  for(let i=1;i<DOC.length;i++) if(hasNewdoc(DOC[i])) return "";
  return id; }
function updateFileBlock(){
  const nameEl=document.getElementById("tbFileName"), metaEl=document.getElementById("tbFileMeta"), box=document.getElementById("tbFile");
  if(!nameEl) return;
  applyFileIcon();
  const docId=loneDocId();
  nameEl.textContent=docId||DOCNAME||"Untitled";
  if(box){ box.classList.toggle("is-dirty",!!DIRTY); box.title=DOCPATH||(DOCNAME||""); }
  let meta="";
  if(docId) meta=DOCNAME||"";   // the document is named, so the FILENAME becomes the subtitle — and "Sentence X of Y" goes with it, being redundant against the status bar's own sentence count and the numbers on the blocks themselves
  else{
    // subtitle = "Sentence X of Y" (the sentence being READ — the current block, which scrolling moves without
    // disturbing the token selection; see the CURBLOCK note in js/core/prefs.js); language/translit/scheme live in
    // the status bar
    try{ const n=(typeof DOC!=="undefined"&&DOC)?DOC.length:0, i=(typeof curBlock==="function")?curBlock():((typeof sel!=="undefined"&&sel)?sel.s:-1);
      if(n>0 && i>=0 && i<n) meta="Sentence "+(i+1)+" of "+n;
      else if(n>0) meta=n+" sentence"+(n>1?"s":"");
    }catch(e){}
  }
  if(DIRTY) meta=meta?meta+" – Edited":"Edited";   // native titlebar convention: mark unsaved changes with a trailing "– Edited"
  if(metaEl) metaEl.textContent=meta;
}
/* PATH SHAPE — the one thing in this file that is not the same on both platforms. The frontend never sees a
   filesystem, only the path strings the backend hands it, so the backend is also what tells it how to take
   them apart: `window.__pathInfo = {sep, rootName}` — the path separator, and the display name of the volume
   the chain bottoms out at ("Macintosh HD" on macOS; "This PC"/the drive on Windows). The native shell
   injects it after load; ABSENT (browser design mode, or a shell that predates the injection) it defaults to
   the macOS pair, so nothing about macOS behaviour depends on the injection happening. */
function pathInfo(){ const p=(typeof window!=="undefined"&&window.__pathInfo)||{};
  return { sep:p.sep||"/", rootName:p.rootName||"Macintosh HD" }; }
// ancestor folders of the open file's directory, nearest first (classic macOS proxy-icon path popup)
function folderChain(path){ if(!path) return [];
  const {sep,rootName}=pathInfo();
  const parts=String(path).split(sep); parts.pop();   // drop the filename → its containing directory
  const chain=[];
  for(let i=parts.length; i>0; i--){ const full=parts.slice(0,i).join(sep)||sep; const nm=parts[i-1]||sep; chain.push({name:nm||sep, path:full}); }
  chain.push({name:rootName, path:sep});   // the volume itself closes the chain. Its `path` is the bare separator — "/" on macOS (unchanged), and on Windows the value the shell's reveal handler should read as "the drive/volume root", since a Windows path has no such spelling of its own
  return chain;
}
let _fpMenu=null;
function closeFolderMenu(){ if(_fpMenu){ _fpMenu.remove(); _fpMenu=null; document.removeEventListener("mousedown",_fpOutside,true); document.removeEventListener("keydown",_fpKey,true); _tbPass(false); } }   // undo the click-through below
function _fpOutside(e){ if(_fpMenu&&!_fpMenu.contains(e.target)) closeFolderMenu(); }
function _fpKey(e){ if(_fpMenu&&e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeFolderMenu(); } }   // Esc dismisses, does nothing else
function openFolderMenu(){ closeFolderMenu();
  if(!DOCPATH) return;
  const anchor=document.getElementById("tbFile"); if(!anchor) return;
  _tbPass(true);   // the native NSView drag overlay covers the empty titlebar background and swallows clicks there before the DOM ever sees them, so _fpOutside's mousedown listener never fired for a click on the titlebar outside this menu — click-through it, same fix already applied to openTbMenu/openTbGroupMenu
  // native macOS proxy menu: the DOCUMENT itself leads, then its ancestor folders below it
  const rows=[{name:DOCNAME||"Document", path:DOCPATH, file:true}].concat(folderChain(DOCPATH));
  const m=document.createElement("div"); m.className="fpmenu"; _fpMenu=m;
  const folderIcon=window.__folderIcon, rootIcon=window.__rootIcon||window.__folderIcon, fileIcon=window.__fileIcon;   // native NSWorkspace icons
  rows.forEach((f,idx)=>{ const it=document.createElement("button"); it.type="button"; it.className="fpitem";
    const uri=f.file?fileIcon:((idx===rows.length-1)?rootIcon:folderIcon);
    if(uri){ const im=document.createElement("img"); im.className="fpimg"; im.src=uri; im.alt=""; it.appendChild(im); }
    else { const ic=document.createElement("span"); ic.className="sfi"; ic.style.setProperty("--m",f.file?"var(--sf-doc)":"var(--sf-open)"); it.appendChild(ic); }
    const t=document.createElement("span"); t.textContent=f.name; it.appendChild(t);
    it.addEventListener("click",()=>{ closeFolderMenu(); if(hasBridge())try{window.pywebview.api.reveal_in_finder(f.path);}catch(e){} });
    m.appendChild(it); });
  document.body.appendChild(m); localiseAccel(m);   // built fresh per open → the boot sweep can't have seen it (a folder NAME is never rewritten: the sweep only touches `title=` and the .kbd/.fpkbd/.ctxkbd shortcut spans)
  // native macOS proxy-icon placement: the menu sits right ON the title, leading (file) item anchored over the filename
  const r=anchor.getBoundingClientRect(), mw=m.offsetWidth, mh=m.offsetHeight;
  const left=Math.max(6,Math.min(r.left, innerWidth-mw-8));
  const top=Math.max(menuTopBound(),Math.min(r.top-4, innerHeight-mh-8));   // the proxy-icon menu opens ON the title, i.e. as high as any menu goes — so it is the one most likely to meet the native tab bar (menuTopBound, js/core/scroll.js)
  m.style.left=left+"px"; m.style.top=top+"px";
  setTimeout(()=>{ document.addEventListener("mousedown",_fpOutside,true); document.addEventListener("keydown",_fpKey,true); },0);
}
function setTitle(name){ if(name)DOCNAME=name;
  updateFileBlock();   // the filename + "…– Edited" state lives ONLY in the titlebar proxy-title block now (no status-bar pill)
  if(hasBridge())try{window.pywebview.api.set_window_title((loneDocId()||DOCNAME)+(DIRTY?" – Edited":"")+" — SUD Workbench");}catch(e){} }   // item 6: the NATIVE title follows the proxy block — a file holding one named document is titled by that document, not by its filename
// item 1: a document is dirty only once something has actually CHANGED since it was opened or saved. Every real
// edit pushes an undo snapshot BEFORE mutating, so an empty undo history is proof that nothing has — opening an
// inline editor and leaving it untouched can no longer light up the titlebar's "– Edited", however many callers
// reach here on the way back out. Undoing all the way back to the opened state clears it again for the same reason.
// DIRTY_BASE is the escape hatch for real changes no undo entry can speak for — an import, an append, a
// stored-transliteration rewrite, a session restored from disk — which stay dirty regardless of the history.
function markDirty(v=true){ if(!v) DIRTY_BASE=false;
  DIRTY=!!v&&(DIRTY_BASE||UNDO.length>0);
  if(hasBridge())try{window.pywebview.api.set_dirty(DIRTY);}catch(e){} setTitle();
  /* …and the SCRIPT renderings that are keyed on more than the form follow the edit that invalidated
     them. Only Latin macronisation is (the model's `la_macronise` reads UPOS + FEATS + lemma — see
     app/macron.py), and this is the one funnel every document edit passes through — so hanging the
     refresh here is what makes it true of ANY attribute of any token rather than of the handful of edit
     sites someone thought to instrument. Debounced and self-gating; a no-op in every other language.
     Guarded because js/lang/translit-load.js loads AFTER this module. */
  if(v && typeof scheduleOrthoMorph==="function") scheduleOrthoMorph(); }
function markDirtyBase(){ DIRTY_BASE=true; markDirty(); }   // an unsaved change with no undo entry to show for it
// Stamp the one scheme a DOCUMENT owns onto its first sentence: the transliteration its MISC Translit/LTranslit
// is written in. The script and the displayed romanisation are the READER's, kept per-language in PREFS, and
// contribute no document metadata at all — see adoptDocSchemes.
/* ── DEPS (enhanced dependencies) is NOT auto-filled ──
   This app once derived DEPS entries at save time from what a SUD tree already states honestly —
   FEATS Shared=Yes for conjunct propagation, MISC Subject for control/raising subjects (UD's
   enhanced-syntax §2/§3/§4) — the same facts already drawn as dashed "ghost" edges in the diagram.
   That auto-fill ("Task E") is gone: DEPS is not part of SUD, and this app does not support it as a
   column an annotator works in. The two facts it used to re-derive from are still fully expressed
   where they always were — FEATS Shared, MISC Subject, the ghost edges — DEPS just no longer
   restates them in UD's own enhanced-graph notation.
   DEPS remains an ordinary CoNLL-U column otherwise: a value already in a file (an import that
   hasn't gone through the UD→SUD Shared/Subject conversion, or one hand-authored before this
   column existed) round-trips byte-for-byte, is shown in the grid, and is kept internally
   consistent by shiftDeps/remapDeps (js/editing/edit-ops.js) under structural edits — none of that
   read/write/re-index machinery is what this removes. Only the derive-and-write-on-save is gone. */
function getDocJSON(){ if(DOC.length){ const s=DOC[0];
  if(TRANSLIT_SCHEMES.length){ s.translit_scheme=STORED_SCHEME||""; s.stored=""; } }   // `# stored` is the older spelling: emptied on save so a file written under it doesn't end up carrying BOTH keys and leaving the reader to guess which wins
  // item 13: persist a sentence's display line breaks as a LITERAL two-char \n in `# text` so a multi-line
  // sentence round-trips through save/load. io_conllu keeps a literal \n verbatim (it only collapses a REAL
  // newline), so this preserves the break without editing the serializer. Converted on a SHALLOW COPY, so the
  // live s.text keeps its real newlines for the .stext (pre-wrap) display and sktLineForms. normSents restores
  // the real \n on load. Newline-free sentences (the existing samples) are returned untouched → byte-stable.
  return DOC.map(s=>{ if(!s) return s;
    const textNL=typeof s.text==="string" && s.text.indexOf("\n")>=0;
    if(!textNL) return s;
    const out={...s};
    out.text=s.text.replace(/\n/g,"\\n");
    return out; }); }
function blankSent(){ return {sid:"s1",text:"",tokens:[tok("","","","","",0,"root")]}; }
// bring backend sentences into the renderer's shape (heads as strings, display sid, no null cells)
/* ONE-SHOT MIGRATION OF THE OLD `Subj` SPELLING, run on every token as a file is read.
   This app once wrote SUD's raising feature as FEATS `Subj`, which was wrong in both the column and the name:
   it belongs in MISC (it describes a relation between two tokens, not a morphological property of one) and the
   guidelines, the validator and the conversion grammars all spell it `Subject`. Rewriting at load means nothing
   downstream ever has to know the old form existed — there is no legacy branch in the accessors (raiseGet /
   raiseSet, js/core/prefs.js), no second spelling in the completion inventory, and no way to author the old form
   again.
   THIS DELIBERATELY BREAKS BYTE-STABILITY for a file that carries `Subj=` — opening and saving such a file
   rewrites that one field. That is the point, and it was explicitly asked for: the mistake should leave no trace
   rather than be preserved for the sake of an invariant. Every other field is untouched, so a file WITHOUT the
   old spelling is byte-stable exactly as before (all seven samples still round-trip).
   An existing MISC Subject wins, on the "already correct" principle — a token carrying both is taken to have
   been migrated already, with the FEATS copy left over. */
function migrateLegacySubj(t){ const old=getFeat(t.feats,"Subj"); if(!old) return;
  t.feats=clearFeat(t.feats,"Subj");
  if(!getFeat(t.misc,"Subject")) t.misc=setMiscKV(t.misc,"Subject",old); }
function normSents(sents,base){ base=base||0; return sents.map((s,i)=>{
  if(s.sid==null) s.sid="s"+(base+i+1);
  if(typeof s.text==="string" && s.text.indexOf("\\n")>=0) s.text=s.text.replace(/\\n/g,"\n");   // item 13: a literal \n in `# text` is a preserved display line break → restore the real newline for the .stext (pre-wrap) display; re-serialised back to a literal \n by getDocJSON (byte-stable)
  (s.tokens||[]).forEach(t=>{ t.head=String(t.head==null?0:t.head);
    if(t.deps==null)t.deps="_"; if(t.misc==null)t.misc="_"; if(t.translit==null)t.translit=""; if(t.translitLemma==null)t.translitLemma="";
    migrateLegacySubj(t); });
  return s; }); }
const isBlankDoc=()=>DOC.length===0||(DOC.length===1&&DOC[0].tokens.length<=1&&!(DOC[0].tokens[0]&&DOC[0].tokens[0].form));

/* WHAT COUNTS AS A FILE-SPECIFIC DISPLAY SETTING, and therefore belongs in the reset below.
   A setting is FILE-SPECIFIC when its value is DERIVED FROM (or adopted from) the document that is open — the
   glossing tiers from the tokens' MISC, the translation languages from the `# text_LANG` comments, the relation
   vocabulary from the relations actually used, the stored-transliteration scheme from a `# translit_scheme`
   metadata comment, the language from the text itself. Carrying such a value into a NEW, empty document is
   carrying a fact about a file that is no longer open.
   It is an APPLICATION preference — and must NOT be reset — when it is a property of the reader rather than of
   the document. The reliable test is PREFS: anything savePrefs()/loadPrefs() persists (js/core/prefs.js) is an
   application preference by construction. That covers the notation, paged/unpaged layout, the Show/Hide toggles
   (colour, labels, POS, arrows, merge-punct, wrap, grids), the grid column pins (PREFS.gridCols), the titlebar
   display mode, the relation colours, and the three PER-LANGUAGE scheme memories (PREFS.ortho/translit/stored) —
   those last are keyed by language precisely so they OUTLIVE the file that first selected them. The document
   zoom (FS) and SETTINGS.scheme/upos (the Settings sheet's own inventories, typed by the user, never read off a
   file) are reader properties too.
   THE OPEN PATH IS THE REFERENCE for what to call and in what order: doOpen/openRecentFile/applyOpenedDoc each
   run this same sequence against a real file, and init.js runs it for the launch document. This function is that
   sequence asked the same questions with nothing loaded — so a new setting only ever has to be added in two
   places, not three, and cannot drift into meaning something different here. */
function resetFileSettings(){
  setFormat("SUD");                    // an empty document is SUD by definition — the detected format of the file just closed says nothing about it
  adoptDocSchemes();                   // DOC[0] is gone → FILE_STORED:=null, so the closed file's `# translit_scheme` cannot be applied to the next language load (and DOCSCHEME_GEN moves, invalidating an in-flight one)
  syncGlossTiersFromDoc();             // item 1: no MISC Gloss/MSeg/MGloss anywhere → both tiers reset to off AND both VISIBILITY flags (GLOSS_VIS/MORPH_VIS) back to true, then syncGlossUI repaints the Glossing drawer + its Show/Hide rows
  syncDeprelVocabFromDoc();            // …and SETTINGS.deprel back to DEPREL_DEFAULT: the extra relations in it were read off the closed file's tokens, so they have no business in the new document's DepRel autocomplete
  detectXposMirrorsUpos(); syncDocFonts();
  refreshTransLangs(); renderTransDrawer();   // item 13: no `# text_LANG` anywhere → no enabled translation languages, and the Translations drawer redrawn empty
  applyLang("en",true);                // DOCLANG is DETECTED from the file (langid/filename/Kyoto — see maybeAutoDetectLang), so it is the file's, not the reader's; an empty document has nothing to detect from and falls back to the documented default (js/core/state.js). `true` re-runs syncModelToLang, so the parser auto-selected for the old language is released too — and setLang re-resolves the Script/Displayed/Stored pills, which is what puts ORTHO_SCHEME/TRANSLIT_SCHEME/STORED_SCHEME and show.translit back onto the per-language preference instead of the closed file's values.
}
/* Open REPLACES the current document (warning first if there are unsaved changes) and adopts the file
   as the save target; Append adds a file's sentences to the current document without changing the target. */
async function doNew(){ if(!(await confirmDiscardUnsaved("Discard them and start a new document?"))) return; pushUndo();
  saveScrollPos(true);   // remember the outgoing file's reading position before we drop it
  DOC.length=0; DOCNAME="untitled.conllu"; DOCPATH=""; markDirty(false);   // a new document starts empty — zero sentences
  if(typeof invalidateColW==="function") invalidateColW();   // drop the outgoing file's column-width cache rather than carry its widths into an empty document
  if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // …and the outgoing file's cached diagrams (js/core/document.js) — every si is about to name a sentence of the NEW (empty) document instead
  if(hasBridge())try{window.pywebview.api.new_document();}catch(e){}
  resetFileSettings();   // every display setting the CLOSED file decided goes back to its no-document state — see the note above for the file-vs-application test, and add new settings there rather than inline here
  sel={s:-1,t:0}; selRange=null; setTitle(); renderDoc(); toast("New document — add a sentence to begin"); }
// Filename `<langcode>_…` prefix → the language: the HIGHEST-priority signal, validated against the embedded ISO
// tables (2-letter ISO 639-1 or 3-letter ISO 639-3) via isoName(); an unknown code falls through. A validated
// code is normalised to the app's canonical form (2-letter where the ISO row has one, e.g. san→sa).
function langFromFilename(name){ const m=(name||"").match(/^([A-Za-z]{2,3})_/); if(!m) return "";
  const code=m[1].toLowerCase(); return isoName(code) ? canonLangCode(code) : ""; }   // isoName resolves EITHER a 2- or 3-letter code → non-empty ⇒ a real language
function canonLangCode(code){ code=(code||"").toLowerCase();
  for(const e of (window.ISO639_3||[])){ if(e[0]===code||e[1]===code) return e[1]||e[0]; }   // rows are [code3, code1||"", name] → prefer the 2-letter code1 (the form the app keys on), else code3
  return code; }
// Language authority, highest first: (1) a filename `<langcode>_…` prefix (below) OVERRIDES every other
// detector; else (2) the Kyoto XPOS ⇒ lzh heuristic; else (3) fastText. This ALWAYS runs on open. The chosen
// language drives the PARSER too — applyLang(lang,true) re-selects an installed parser for that language (or None)
// via syncModelToLang, so parser auto-load is preserved. Best-effort: no bridge or no vendored model ⇒ silently
// skips. The pre/post snapshot preserves any language or model the user EXPLICITLY picks during the async call.
// Literary Chinese refinement: fastText calls Classical Chinese `zh`; docLooksLikeKyoto() inspects the
// tokens' XPOS for the UD_Classical_Chinese-Kyoto tagset and, when it matches, resolves the language to `lzh`.
// EVERY exit path below ends in an applyLang — none of them returns bare. That is load-bearing beyond the
// language itself: applyLang → setLang is also what RESOLVES the Script / Displayed / Stored pills
// (loadOrthoSchemes / loadTranslitSchemes), which is where the open file's stored-transliteration metadata and
// the per-language preferences are consumed. Both only exist once loadPrefs() and adoptDocSchemes() have run —
// i.e. AFTER the init-time setLang(modelLang(model)), which fires at module-load time with PREFS still empty.
// So this call IS the authoritative scheme load, and a document whose language simply isn't detected (no
// tokens, too short a sample, low confidence, no vendored fastText model) used to keep whatever that
// pre-prefs boot load left on the pills, and to leave the file's FILE_STORED unconsumed —
// waiting to be applied to the NEXT document opened, in whatever language that one turned out to be.
async function maybeAutoDetectLang(){
  // (1) filename suffix — the authoritative signal; needs neither the bridge nor tokens, so it runs first.
  const fnl=langFromFilename(DOCNAME);
  if(fnl){ applyLang(fnl,true); return; }
  if(!hasBridge()||!DOC.length){ applyLang(DOCLANG,true); return; }   // nothing to detect FROM → keep the current language, but still run the load
  // Kyoto XPOS ⇒ Literary Chinese: a DETERMINISTIC, tokens-based signal. Apply it FIRST and INDEPENDENTLY of
  // fastText — it must win even when fastText is unavailable, returns null, or is low-confidence on the Han text
  // (previously this was gated behind a non-null fastText result, so a null/low-conf reply skipped the upgrade).
  if(docLooksLikeKyoto()){ applyLang("lzh",true); return; }
  const sample=DOC.slice(0,5).map(s=>(s.text&&s.text.trim())||((s.tokens||[]).map(t=>t.form).join(" "))).join(" ").trim();
  if(sample.length<8){ applyLang(DOCLANG,true); return; }   // too little text to detect from → keep the language, run the load
  const lang0=DOCLANG, model0=model;            // snapshot: detect a user override during the async call
  let r; try{ r=await window.pywebview.api.detect_language(sample); }catch(e){ r=null; }   // model missing ⇒ null/throw ⇒ no detection
  if(DOCLANG!==lang0||model!==model0) return;    // user explicitly chose a language/model mid-await ⇒ don't clobber it (their own pick already ran setLang, and by then the prefs were loaded)
  applyLang((r&&r.lang)||DOCLANG,true); }        // authoritative: set the language and auto-select a matching installed parser (or None). Low confidence (r.lang null) or no detector ⇒ the language stands, but the load still runs — see the note above this function.
// Literary Chinese detector: the UD_Classical_Chinese-Kyoto treebank carries a distinctive XPOS tagset —
// "<coarse-POS letter>,<CJK category>,<subcat>,<subcat>", e.g. n,名詞,可搬,伝達 · v,動詞,行為,動作 · p,助詞,提示,* ·
// s,記号,句点,*. The signature is a single ASCII letter, a comma, then a Han/kana category. Modern-Chinese
// treebanks leave XPOS empty ("_"), so they never match. True when a good fraction of the tokens carry it.
function docLooksLikeKyoto(){
  const KY=/^[a-z],[　-鿿豈-﫿]/;   // Kyoto XPOS: coarse-POS letter, comma, CJK/kana category name
  let total=0, hit=0;
  for(const s of (DOC||[])) for(const t of (s.tokens||[])){
    const x=(t.xpos||"").trim(); if(!x||x==="_") continue; total++; if(KY.test(x)) hit++; }
  return total>=2 && hit/total>=0.5; }

/* item 9 — WHAT A LOAD SELECTS: NOTHING. Opening a file, restoring the launch document and re-parsing a sentence
   all used to end in `sel={s:…,t:1}; pick(…,1,…)`, i.e. they selected the first token of the first (or the
   re-parsed) sentence. A selection is a statement about what the user is working on, and none of those three
   gestures makes one — so they now leave the selection EMPTY and set only the READING FOCUS, which is a different
   thing and always was (CURBLOCK; see the note in js/core/prefs.js). That focus is what keeps the titlebar's
   "Sentence X of Y", the whole-sentence commands (⌘R, insert/duplicate/move/delete/export — every one of them
   reads curBlock(), not sel) and preserveScroll's anchor working with nothing selected; it is also exactly the
   value the scroll spy would compute for a document resting at its top (maybeShiftFocus's scrollTop<=1 branch), so
   this is a state the app already renders rather than a new one. Call AFTER renderDoc — setCurBlock toggles
   .sel-block on the blocks that are in the DOM, and renderDoc itself paints it from curBlock() as it builds.
   syncMenu() stands in for the one pick() used to make: the Edit menu has to hear that nothing is selected. */
function clearSelToBlock(i,scroll){ sel={s:-1,t:0}; selRange=null;
  // …and take the previous selection OFF the DOM. Every caller here runs after its own renderDoc, and that render
  // painted the classes from whatever `sel` still held when it ran (grid `tr.sel` at build time; the diagram
  // classes likewise) — so clearing the variable alone left the old accent, and its subtree dimming, sitting on a
  // freshly rendered document. applySel is the live class-toggle pass and does the whole job against the now-empty
  // selection (selEmphasis returns null → every .dim-peri/.dim-out comes off, no data-s can equal -1 → every .sel
  // and .rng does too); the grid's row class is the one it doesn't own, so it goes here. Order-independent by
  // construction: call this before or after a render and the result is the same.
  document.querySelectorAll("#doc tr.sel").forEach(tr=>tr.classList.remove("sel"));
  applySel();
  if(conv==="brackets") preserveScroll(renderDoc);   // …except in BRACKETS, whose selection wash is a rect/.bwwash computed only on a full render (no live-toggle path at all) — exactly the case pick() re-renders for, and for the same reason: without it the outgoing selection's wash stays painted over the new document
  if(i>=0&&i<DOC.length) setCurBlock(i);
  syncMenu();
  if(scroll&&i>=0){ const el=document.querySelector(`.sblock[data-i="${i}"]`); if(el)el.scrollIntoView({block:"center",behavior:"smooth"}); } }   // no token row to scroll to any more, so the BLOCK is the target — a menu-invoked re-parse still brings its sentence into view

async function doOpen(){ if(!hasBridge())return toast("Open is available in the desktop app");
  if(!(await confirmDiscardUnsaved("Open a different file and discard them?"))) return;
  saveScrollPos(true);   // flush the current file's reading position before switching
  let r; try{ r=await window.pywebview.api.open(); }catch(e){ return toast("Open failed: "+e); }
  if(!r||r.cancelled) return; if(r.error) return toast("Open failed: "+r.error);
  if(!r.sentences||!r.sentences.length) return toast("No sentences in that file");
  DOC.length=0; resetUndo(); normSents(r.sentences).forEach(s=>DOC.push(s));   // item 3: a fresh file — clear the previous file's undo/redo history
  if(r.path&&hasBridge())try{window.pywebview.api.adopt_path(r.path);}catch(e){}
  DOCNAME=r.name||DOCNAME; DOCPATH=r.path||""; markDirty(false);
  setFormat(r.format||"SUD"); syncGlossTiersFromDoc(); syncDeprelVocabFromDoc(); detectXposMirrorsUpos(); syncDocFonts();   // item 1: derive the glossing tiers from THIS file, not the previous one
  refreshTransLangs(); renderTransDrawer();   // item 6: seed enabled translation languages from the opened file's # text_LANG (doOpen / openRecentFile skipped this → translations never showed on open)
  setTitle(); renderDoc(); clearSelToBlock(0,false); settleAlign();   // item 9: nothing selected; the reading focus starts on the first sentence and restoreScrollPos below owns where the viewport lands   // settleAlign: re-fit column widths against the settled layout
  adoptDocSchemes();   // pick up THIS file's own stored-transliteration scheme, and where it carries none clear the previous file's (the boot and append paths already did this; Open… did not, so a stale value could survive into the newly-opened document)
  maybeAutoDetectLang();   // fastText decides the language (authoritative) and drives the matching parser — and, whatever it decides, performs the scheme load that consumes the metadata adopted just above
  restoreScrollPos(r.scroll);   // restore the reading position remembered for this file
  toast(`Opened ${r.name} · ${r.sentences.length} sentence${r.sentences.length>1?"s":""}`);
  if(r.format==="UD") toast("This file looks like UD — use the Format pill → Import UD… to convert it to SUD for editing"); }

/* Open Recent (native File-menu submenu) — mirrors doOpen but opens a known path via open_path. */
async function openRecentFile(path){ if(!hasBridge())return toast("Open is available in the desktop app");
  if(!(await confirmDiscardUnsaved("Open a different file and discard them?"))) return;
  saveScrollPos(true);   // flush the current file's reading position before switching
  let r; try{ r=await window.pywebview.api.open_path(path); }catch(e){ return toast("Open failed: "+e); }
  if(!r||r.cancelled) return; if(r.error) return toast("Open failed: "+r.error);
  if(!r.sentences||!r.sentences.length) return toast("No sentences in that file");
  DOC.length=0; resetUndo(); normSents(r.sentences).forEach(s=>DOC.push(s));   // item 3: a fresh file — clear the previous file's undo/redo history
  if(r.path&&hasBridge())try{window.pywebview.api.adopt_path(r.path);}catch(e){}
  DOCNAME=r.name||DOCNAME; DOCPATH=r.path||""; markDirty(false);
  setFormat(r.format||"SUD"); syncGlossTiersFromDoc(); syncDeprelVocabFromDoc(); detectXposMirrorsUpos(); syncDocFonts();   // item 1: derive the glossing tiers from THIS file, not the previous one
  refreshTransLangs(); renderTransDrawer();   // item 6: seed enabled translation languages from the opened file's # text_LANG (doOpen / openRecentFile skipped this → translations never showed on open)
  setTitle(); renderDoc(); clearSelToBlock(0,false); settleAlign();   // item 9: as in doOpen — nothing selected, reading focus on the first sentence
  adoptDocSchemes();   // as in doOpen: this file's own stored-transliteration scheme, and where it carries none the previous file's is cleared
  maybeAutoDetectLang();   // fastText decides the language (authoritative) and drives the matching parser
  restoreScrollPos(r.scroll);   // restore the reading position remembered for this file
  toast(`Opened ${r.name} · ${r.sentences.length} sentence${r.sentences.length>1?"s":""}`);
  if(r.format==="UD") toast("This file looks like UD — use the Format pill → Import UD… to convert it to SUD for editing"); }
window.openRecentFile=openRecentFile;
async function clearRecentFiles(){ if(!hasBridge())return; try{await window.pywebview.api.clear_recent();}catch(e){}
  toast("Cleared recent files"); }
window.clearRecentFiles=clearRecentFiles;

async function doAppend(){ if(!hasBridge())return toast("Append is available in the desktop app");
  let r; try{ r=await window.pywebview.api.open(); }catch(e){ return toast("Append failed: "+e); }
  if(!r||r.cancelled) return; if(r.error) return toast("Append failed: "+r.error);
  applyOpenedDoc(r.sentences,r.path,r.name); }
function applyOpenedDoc(sentences,path,name){
  if(!sentences||!sentences.length) return toast("No sentences in that file");
  const replace=isBlankDoc();
  if(!replace) pushUndo();   // an APPEND is an ordinary edit to the document already open — snapshot it BEFORE the new sentences land, so it undoes like any other (a REPLACE isn't: it drops the previous file's history outright, below)
  const start=replace?0:DOC.length;
  normSents(sentences,DOC.length).forEach(s=>DOC.push(s));
  if(replace){ DOC.splice(0,DOC.length-sentences.length);   // drop the blank starter, keep the appended tail
    resetUndo();   // item 3: replacing a blank doc with an opened file — clear the undo/redo history so you can't undo across the open
    if(path&&hasBridge())try{window.pywebview.api.adopt_path(path);}catch(e){}
    if(name)DOCNAME=name; if(path)DOCPATH=path; }
  markDirty(!replace);   // a REPLACE is a freshly opened file → clean; an APPEND is dirty off its own undo entry, pushed above
  if(replace)adoptDocSchemes();   // opening a file → its own scheme metadata wins over the per-language prefs
  refreshTransLangs(); renderTransDrawer();   // item 13: refresh enabled translation languages after append/open
  if(replace)maybeAutoDetectLang();   // opening into a blank doc → fastText decides the language (authoritative) and drives the parser
  if(replace) syncGlossTiersFromDoc(); syncDeprelVocabFromDoc(); detectXposMirrorsUpos(); syncDocFonts();   // item 10/1: the Glossing checkboxes reflect THIS file's tiers (its MISC Gloss / MSeg / MGloss), never the previous file's — document-derived, not carried across opens. syncDeprelVocabFromDoc runs on BOTH append and replace — new tokens either way can carry non-standard relations to integrate
  setTitle(); renderDoc(); clearSelToBlock(replace?0:start,!replace); settleAlign();   // item 9: nothing selected either way. An APPEND still SCROLLS to the first sentence it added — that is the only feedback the gesture has, and it is a viewport move, not a selection; a REPLACE doesn't, because restoreScrollPos/the top of the file owns that.
  toast(`Appended ${sentences.length} sentence${sentences.length>1?"s":""}`); }

async function doRename(){ if(!hasBridge())return toast("Rename is available in the desktop app");
  if(!DOCPATH) return toast("Save the document before renaming it");
  const folder=DOCPATH.slice(0,DOCPATH.lastIndexOf("/"))||"/";
  const r=await sheetChooseSaveLocation({title:"Rename",desc:"Choose a new name and location for this file.",
    defaultName:(DOCNAME||"").replace(/\.conllu?$/i,""),saveLabel:"Rename",preferFolder:folder});
  if(r.action!=="save") return;
  let res; try{ res=await window.pywebview.api.rename_to(r.folder,r.filename); }catch(e){ return toast("Rename failed: "+e); }
  if(!res||res.cancelled) return; if(res.error) return toast(res.error);
  DOCNAME=res.name; if(res.path)DOCPATH=res.path; setTitle(); toast("Renamed · "+res.name); }

// item 3: pre-populate a new/Save-As filename with the `<langcode>_` prefix (matching langFromFilename's OWN
// convention, so re-opening the saved file detects the same language) — skip if the current name already
// carries the right prefix (a file opened FROM a properly-prefixed name shouldn't get it doubled).
function suggestedSaveName(){ const base=(DOCNAME||"untitled.conllu").replace(/\.conllu?$/i,""), lang=(DOCLANG||"").toLowerCase();
  if(!lang || new RegExp("^"+lang+"_","i").test(base)) return base;
  return lang+"_"+base; }
async function doSave(){ if(!hasBridge())return toast("Save is available in the desktop app");
  if(!DOCPATH) return doSaveAs();   // no path yet → the Save-As sheet decides the name/location, not a native panel
  // A CLEAN document is already on disk exactly as it stands, so Save has nothing to do — and doing it anyway is
  // not free: it rewrites the file (a new mtime for anything watching it) and toasts "Saved ·" for a save that
  // changed nothing. Silent, deliberately: this is what TextEdit and every other native document app does with ⌘S
  // on an unmodified document, and a toast on every press would be noise for the one case where nothing happened.
  // AFTER the DOCPATH check, never before it: with no path the file does not exist yet, so writing it is a real
  // effect however clean the document is, and Save-As must still be offered. DIRTY is the honest test — markDirty
  // derives it from the undo history PLUS DIRTY_BASE, so an import/append/scheme rewrite with no undo entry to
  // show for it still saves (see markDirty above).
  if(!DIRTY) return;
  handleSaveResult(await window.pywebview.api.save(getDocJSON())); }
async function doSaveAs(){ if(!hasBridge())return toast("Save is available in the desktop app");
  const r=await sheetChooseSaveLocation({title:"Save As",desc:"Choose a name and location for this file.",
    defaultName:suggestedSaveName(),saveLabel:"Save"});
  if(r.action!=="save") return;
  let res; try{ res=await window.pywebview.api.save_to(getDocJSON(),r.folder,r.filename); }catch(e){ return toast("Save failed: "+e); }
  handleSaveResult(res); }
function handleSaveResult(r){ if(!r||r.cancelled) return;
  if(r.error) return toast("Save failed: "+r.error);
  markDirty(false); if(r.path)DOCPATH=r.path; setTitle(r.name); toast("Saved · "+r.name); }

/* item 7 — what the Insert-text dialog needs to know about the LIVE document, which only this side owns:
   whether there are any sentences yet (an empty document gets to CHOOSE its language; one with sentences
   is pinned to the language it already has), and which translation tiers are enabled — the only languages
   a parallel text may be written in, since any other would invent a `# text_LANG` the translations drawer
   never offered. Read at open time, so a tier added a moment ago is already in the menu. */
function insertCtx(){ const codes=[...TRANS_LANGS].sort((a,b)=>(langName(a)||a).localeCompare(langName(b)||b));
  return {hasSentences:DOC.length>0, count:DOC.length, lang:DOCLANG||"", langName:langName(DOCLANG)||"",
          transLangs:codes.map(c=>({code:c,name:langName(c)||c}))}; }
function addTextSheet(){ openSheet(sheetInsert(null)); }   // items 23/24: the "Insert text" dialog, appending — null index ⇒ append at apply time. ONE dialog on every path now (it was a native child window here, with the sheet as a headless-only fallback); see sheetInsert in js/ui/sheets.js

// status-bar activity: a spinner while a parser runs, a sliding bar during document conversions (ref-counted so
// overlapping async work doesn't hide it early)
let _busyN=0;
function showBusy(text,bar){ const el=document.getElementById("statusBusy"); if(!el)return; _busyN++;
  document.getElementById("busyText").textContent=text||""; el.classList.toggle("bar",!!bar); el.hidden=false; }
function hideBusy(){ const el=document.getElementById("statusBusy"); if(!el)return; _busyN=Math.max(0,_busyN-1); if(_busyN===0)el.hidden=true; }

/* route insert/re-enter through the backend parser when a model is set (else the
   local whitespace/heuristic tokeniser in the mockup stays in charge) */
// Interactive parses run in the sequence TOKENISE → TRANSLITERATE → PARSE (responsiveness): the tokeniser's
// tokens and their transliteration paint FIRST (a fast bridge call), THEN the heavy syntactic parse fills in
// heads/relations/POS. The parse re-runs on the SAME text — every engine tokenises deterministically, so it
// reproduces exactly the preview tokens (and, unlike a Doc rebuilt from bare words, keeps the tokeniser's own
// norm/tag exceptions). Editing a single token takes a different path (regenTok) — it doesn't re-tokenise.
async function paintTr(){ if(show.translit) await fillTranslit(); if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) await fillOrtho(); }
/* ── ARE WE INSIDE A MULTI-SENTENCE INSERT? ────────────────────────────────────────────────────────
   RENDER_HOLD (js/core/document.js) is raised by exactly one caller — __insertPastedText, around the
   loop that inserts a paste sentence by sentence — so "the render is being held" and "we are part way
   through a batch" are the same fact, and this reads it under the name the callers below actually
   mean. It is what lets doInsert skip the work that is per-DOCUMENT rather than per-sentence.
   Guarded for a harness that loads this module without document.js. */
function inInsertBatch(){ return typeof RENDER_HOLD==="number" && RENDER_HOLD>0; }
/* ONE SENTENCE OF A BATCHED PARSE, spliced in. This is doInsert's parsed branch with every bridge
   call removed — the answer is already in hand — and with the per-sentence renders, picks, scrolls and
   toasts removed too, which inInsertBatch was suppressing there anyway. What it keeps is everything
   that is about the DOCUMENT rather than about the parser: the sid, the splice, the cascade and the
   morphemic tiers, all inside the caller's one undo entry and one render hold.
   Deliberately NOT folded into doInsert as an optional argument: doInsert's shape is "go and find out
   what this sentence is", and it earns its two-phase reveal (tokens first, tree after) precisely
   because the reader is waiting on one sentence. A batch has already found out, and has nothing to
   reveal progressively. */
function insertParsed(index,text,res){
  const toks=((res&&res.tokens)||[]).map(t=>({...t,head:String(t.head)}));
  const sid=autoInsertSid(index);
  const b={sid,text:(text||"").trim(),tokens:toks.length?toks:buildTokens(text)};
  const mwt=(res&&res.mwt)||[]; if(mwt.length) b.mwt=mwt;
  DOC.splice(index,0,b); cascadeSids(index); sel={s:index,t:0};
  morphAfterReparse(b);   // seed MSeg/MGloss from the FEATS this parse produced, as doInsert does
  markDirty(); }
const _doInsert=doInsert;
doInsert=async function(index,text){
  if(hasBridge()&&model){
    showBusy("Tokenising…"); let tk;
    try{ tk=await window.pywebview.api.tokenize(text,model); }catch(e){ hideBusy(); return toast("Parse failed: "+e); }
    pushUndo();
    const sid=autoInsertSid(index);
    DOC.splice(index,0,{sid,text:(text||"").trim(),tokens:tk.tokens.map(t=>({...t,head:String(t.head)})),mwt:tk.mwt||[]});
    /* THE BLOCK, NOT ITS FIRST TOKEN. A sentence that has just appeared is not a token the reader chose —
       selecting one for them puts the subtree dimming over a tree nobody has looked at yet, and points every
       sentence-level command (insert, move, delete, the boundary toggles) at a token instead of at the block
       they just made. `t:0` is the state a block is in when it is merely being read (see the CURBLOCK note in
       js/core/prefs.js), which is exactly what a fresh parse leaves behind. */
    cascadeSids(index); sel={s:index,t:0}; markDirty(); renderDoc(); pick(index,0,!inInsertBatch());   // …and no SCROLL inside a batch: the run is walked forward one sentence at a time, so scrolling to each in turn drags the viewport down the whole paste and lands on the last. __insertPastedText scrolls once, to the FIRST
    /* THE WHOLE-DOCUMENT PASSES ARE NOT PER-SENTENCE WORK, and inside a batch they were being paid for
       as though they were. paintTr (fillTranslit + fillOrtho) walks the ENTIRE DOC on every call and
       awaits a bridge round-trip; run once per inserted sentence it is O(sentences × document), for an
       answer that is only correct at the end anyway. Held to the end of the batch, where
       __insertPastedText runs it once. Outside a batch this is the same await it always was. */
    if(!inInsertBatch()) await paintTr();                                            // transliterate the tokeniser's tokens BEFORE the parse
    const bt=document.getElementById("busyText"); if(bt)bt.textContent="Parsing…"; let r;
    try{ r=await window.pywebview.api.parse_text(text,model); }catch(e){ hideBusy(); return toast("Parse failed: "+e); }finally{ hideBusy(); }
    const b=DOC[index]; b.tokens=r.tokens.map(t=>({...t,head:String(t.head)})); b.mwt=r.mwt||[]; if(!b.mwt.length)delete b.mwt;
    morphAfterReparse(b);   // an inserted sentence's tokens carry no MSeg/MGloss either — seed both tiers from the FEATS this parse produced, so a new block doesn't sit tierless among sentences that all have them (same undo entry as the insert)
    renderDiagramIncremental(index);   // as in applySentText's parsed branch — the freshly parsed block converges on its tree instead of sitting blank
    markDirty(); renderDoc(); pick(index,0,!inInsertBatch());   // …and again once the parse lands: the block stays the selection (see above)
    if(!inInsertBatch()) toast(r.parsed?`Parsed · ${MODELINFO[model]||model}`:(r.reason?`Whitespace tokeniser (no parse: ${r.reason})`:"Whitespace tokeniser"));   // a batch says "Inserted N sentences" once; N per-sentence toasts would queue behind each other and outlive the insert
    // ⚠ THE MWT PASS RUNS FIRST, AND IS AWAITED. Both it and fillOrtho re-fuse every range through
    // Api.sanskrit_mwt, and firing them together raced: fillOrtho set m.ortho from its own answer while
    // sandhiMwtForms was clearing m.ortho to force a re-render, so whichever landed second decided what
    // was drawn. The visible symptom was a re-parse leaving the OLD surface form in place while the very
    // same edit applied by hand updated it — the edit path calls sandhiMwtForms alone, with nothing to
    // race. Settling the forms before anything renders from them removes the race rather than ordering it.
    if(isSanskritLang())await autoGroupSanskritMWTs(index,!!(r.mwt&&r.mwt.length));   // keep the TOKENISER's ranges (r.mwt); Compound=Yes only when the parse published none
    if(!inInsertBatch()){   // …the same whole-document passes again, and held for the same reason
      if(show.translit)fillTranslit(); if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang())fillOrtho();   // item 2: re-apply the SCRIPT now the parse's tokens (and its MWT forms) are in
      annotateTranslitMisc(index).then(ch=>{ if(ch)preserveScroll(renderDoc); });   // parse pass → write MISC Translit/LTranslit
      const el=document.querySelector(`.sblock[data-i="${index}"]`); if(el)el.scrollIntoView({block:"center",behavior:"smooth"}); }
    return;
  }
  _doInsert(index,text); markDirty(); };

/* item 24: the "Insert text" flow takes pasted text, runs the parser's SENTENCISER (backend spaCy/stanza when a
   model is loaded, else a script-aware rule-based split — Latin .?!… + Indic daṇḍa ।॥), and adds ONE BLOCK PER
   SENTENCE. The rule splitter here is what runs with no bridge — including for the Insert sheet's parallel
   texts, which the Python worker would otherwise sentencise in each field's own language. */
function localSentSplit(text){ const ENDERS=".?!…।॥", CLOSERS="\"'”’)]}》」』›»", out=[];
  (text||"").replace(/\r\n?/g,"\n").split("\n").forEach(line=>{ line=line.trim(); if(!line)return;
    let last=0,i=0; const n=line.length;
    while(i<n){ if(ENDERS.indexOf(line[i])>=0){ let j=i+1; while(j<n&&ENDERS.indexOf(line[j])>=0)j++; while(j<n&&CLOSERS.indexOf(line[j])>=0)j++;
        if(j>=n||/\s/.test(line[j])){ const seg=line.slice(last,j).trim(); if(seg)out.push(seg); last=i=j; continue; } i=j; }
      else i++; }
    const tail=line.slice(last).trim(); if(tail)out.push(tail); });
  return out; }
/* item 11: a BLANK LINE in the pasted text is a PARAGRAPH break, and the insert records it as UD `# newpar`.
   Split on a run of two or more newlines — one newline is an ordinary line wrap inside a paragraph (which is what
   localSentSplit has always treated it as), two or more is the typographic paragraph break every text editor and
   every plain-text corpus writes. \r\n / \r are normalised to \n FIRST, so the run test only has to know about one
   line-terminator; the blank lines themselves may carry horizontal whitespace (a stray space or tab on an
   "empty" line is invisible to whoever typed it, so it must not defeat the break).
   THIS HAS TO HAPPEN IN JS, BEFORE the bridge call: Api.sentencize → parse.sentencize strips its input and returns
   whitespace-stripped slices, so a paragraph structure handed to it whole would come back with every blank line
   already gone. Each paragraph is therefore sentencised on its own — which is also what a sentenciser wants, since
   a paragraph break is a hard sentence boundary no model should be free to cross. */
function splitParagraphs(text){ return (text||"").replace(/\r\n?/g,"\n")
  .split(/\n[ \t]*(?:\n[ \t]*)+/)   // ≥2 newlines, each optionally followed by horizontal whitespace ⇒ one paragraph break however many blank lines it spans
  .map(p=>p.trim()).filter(Boolean); }   // …and a leading/trailing blank run leaves an empty piece, which is not a paragraph
/* A PARALLEL text split the way Api._sentencize_parallel splits it — paragraphs first (the same blank-line
   rule the main field uses), then sentences within each — for the no-bridge path, where the rule splitter is
   all there is. The two sides must produce the SAME SHAPE (paragraphs of sentences), because the alignment
   below is written once and consumes both; they differ only in who splits, which is the invariant the Insert
   dialog has always kept. A paragraph the splitter can make nothing of is one sentence, not none — exactly
   what the Python side's `segs or [para]` says. */
function localParaSplit(text){ return splitParagraphs(text).map(p=>{ const s=localSentSplit(p); return s.length?s:[p]; }); }
/* MARKDOWN HEADINGS NAME THE BOUNDARIES. A `# …` line is the id of the document that starts there, a `## …` line
   the id of the paragraph — so a pasted text that is already structured as prose arrives with its own divisions
   named, instead of a run of anonymous `# newpar`s the user then has to label by hand.
   ATX only (`#`/`##` at the start of a line), because that is the form a heading takes in a text someone pasted;
   Setext underlining would need a two-line lookahead over content that is otherwise handled a line at a time, and
   `#` is also CoNLL-U's own comment sigil, so keeping the rule to line-initial hashes keeps it legible.
   Trailing hashes (`## Title ##`) are closing delimiters in ATX and are dropped. Levels 3+ are NOT read: there is
   no third division in UD to put them in, and silently promoting an `###` to a paragraph would invent structure.
   A heading is consumed off the FRONT of its paragraph. Heading-only paragraphs (the usual case — a heading with
   a blank line under it) leave no body, so they are not paragraphs at all: their ids CARRY FORWARD to the next
   paragraph that does have one. That is why the ids are resolved in a first pass, before anything is inserted. */
const MD_HEAD=/^(#{1,2})[ \t]+(.+?)[ \t]*#*$/;
function takeHeadings(para){ const lines=para.split("\n"); let doc=null, par=null, i=0;
  for(;i<lines.length;i++){ const m=MD_HEAD.exec(lines[i].trim()); if(!m) break;
    if(m[1].length===1){ doc=m[2]; par=null; }   // a new document restarts the paragraph naming under it: a `##` seen BEFORE its `#` named a paragraph of the document that is now over
    else par=m[2]; }
  return {doc,par,body:lines.slice(i).join("\n").trim()}; }
/* Paragraphs with their ids resolved: heading-only pieces fold into the next piece that has a body, and a run of
   them collapses (the LAST `#` and the last `##` win, which is what a reader of the text would take too). */
function paragraphsWithIds(text){ const out=[]; let doc=null, par=null;
  splitParagraphs(text).forEach(p=>{ const h=takeHeadings(p);
    if(h.doc!=null){ doc=h.doc; par=null; }
    if(h.par!=null) par=h.par;
    if(!h.body) return;                       // heading-only → its ids wait for the next body
    out.push({body:h.body,doc,par}); doc=null; par=null; });   // consumed: the ids belong to THIS paragraph, not to every one after it
  return out; }
/* `opts.quiet` suppresses the "Inserted N sentences" toast when the CALLER is going to report the whole
   operation itself (a parallel-text insert has translations to account for too — see __applyInsertPayload);
   the return value {start,count,paras,paraCounts} is how that caller knows which blocks it just created.
   `paraCounts` is how MANY blocks each paragraph contributed, in order — the main text's paragraph shape as
   BLOCKS rather than as strings, which is the half of the parallel-text alignment this side owns. All of it
   is additive: the two-argument call every earlier path makes behaves exactly as it did. */
window.__insertPastedText=async function(text,index,opts){ opts=opts||{};
  const paras=paragraphsWithIds(text); if(!paras.length)return {start:(index==null?DOC.length:index),count:0,paraCounts:[]};
  if(index==null||index<0||index>DOC.length) index=DOC.length;
  const start=index;   // captured BEFORE the loop, which walks `index` forward one block at a time
  /* The boundary goes on the first sentence of EVERY paragraph INCLUDING THE FIRST — but only when there are two
     or more paragraphs. With a single paragraph there is no structure to record, and marking it would assert a
     paragraph break at the insertion point that the pasted text says nothing about (and, appended after an
     existing paragraph, would split that one). */
  const multi=paras.length>1;
  let n=0;
  const paraCounts=[];   // blocks contributed by each paragraph, in order — see the header comment
  /* THE WHOLE INSERT IS ONE UNDO ENTRY. The loop below calls doInsert once per sentence and doInsert pushes a
     whole-document snapshot of its own, so without this a paste of 80 sentences cost 80 full clones and took 80
     presses of ⌘Z to take back. beginUndoBatch takes ONE snapshot here, before anything lands, and neutralises
     those per-sentence pushes (js/core/undo.js). try/finally because a failed tokenise/parse mid-loop must not
     leave the batch counter raised — every later edit in the session would then push no undo entry at all. */
  beginUndoBatch(); beginRenderHold();   // …and hold the per-sentence re-render with it: doInsert repaints the whole document each time round, which is ~250 ms per sentence on a large file (see beginRenderHold, js/core/document.js)
  try{
  /* ── SENTENCISE EVERY PARAGRAPH FIRST, THEN PARSE THE WHOLE PASTE IN ONE CALL ────────────────
     The loop below used to do both at once, so each sentence cost two awaited bridge round-trips of
     its own (doInsert: tokenize, then parse_text) — 160 of them for an 80-sentence paste, each
     re-entering the pipeline for a single string. Splitting the two phases lets `parse_texts`
     (Api.parse_texts → parse.parse_many) answer for the entire paste at once, with the engine's own
     batching underneath: spaCy through `nlp.pipe`, and Stanza with a SINGLE grew UD→SUD conversion
     that its worker pool runs in parallel. Measured on the backend alone, 40 English sentences:
     86 ms → 42 ms, 2.05×, byte-identical output.
     THE FALLBACK IS THE OLD PATH, UNCHANGED. `parsed` stays null with no bridge, no model, a single
     sentence (nothing to batch) or a call that throws, and the loop then calls doInsert per sentence
     exactly as before — including its own tokenize/parse and its progressive reveal, which is worth
     having when there is only one sentence to wait for. */
  const paraSents=[];
  for(const para of paras){
    let sents=null;
    if(hasBridge()){ try{ const r=await window.pywebview.api.sentencize(para.body, DOCLANG||"", model||""); sents=(r&&r.sentences)||null; }catch(e){ sents=null; } }
    if(!sents||!sents.length) sents=localSentSplit(para.body);
    if(!sents.length) sents=[para.body];
    paraSents.push(sents); }
  const flat=paraSents.flat();
  let parsed=null, pi=0;
  if(hasBridge()&&model&&flat.length>1){
    showBusy(`Parsing ${flat.length} sentences…`);
    try{ const r=await window.pywebview.api.parse_texts(flat,model); parsed=(r&&r.results)||null; }
    catch(e){ parsed=null; }
    finally{ hideBusy(); }
    if(parsed&&parsed.length!==flat.length) parsed=null;   // belt and braces: a per-entry answer that doesn't line up is unusable, and the per-sentence path is right there
  }
  for(let p=0;p<paras.length;p++){
    const para=paras[p], sents=paraSents[p];
    for(let k=0;k<sents.length;k++){
      if(parsed){ insertParsed(index,sents[k],parsed[pi]); }   // …the batched answer, spliced straight in
      else await doInsert(index,sents[k]);   // doInsert (bridge-aware) parses each sentence via the model, or whitespace-tokenises with none
      pi++;
      if(k===0&&DOC[index]){                      // the paragraph's first sentence carries whatever this paragraph opens
        if(para.doc!=null) DOC[index].newdoc=para.doc||true;   // a `# Heading` ⇒ a NAMED document boundary. `||true` because an empty heading is still a boundary, just an unnamed one
        if(para.par!=null) DOC[index].newpar=para.par||true;   // a `## Heading` ⇒ a NAMED paragraph boundary…
        else if(multi) DOC[index].newpar=true; }               // …and with no heading the old rule stands: bare `# newpar` on every paragraph when there is more than one   // `true`, never an id: UD's ids are optional and inventing one would put a name in the file that nothing here can justify (see the _BOUNDARY_KEYS contract in app/io_conllu.py)
      index++; n++; }
    paraCounts.push(sents.length); }   // ≥1 by construction (the two fallbacks above guarantee it), which the aligner relies on: a zero-block paragraph would have no sentence for its translation to land on
  if(multi) renderDoc();   // the ¶ marks were set AFTER doInsert had already drawn each block, so one repaint at the end puts them on screen — INSIDE the hold, so it simply marks the single pending render rather than adding one of its own
  } finally { endRenderHold(); endUndoBatch(); }   // unwind in the reverse order they were opened; endRenderHold is what performs the one real repaint
  /* ── THE PER-DOCUMENT WORK, ONCE, NOW EVERY SENTENCE IS IN ────────────────────────────────────
     doInsert skipped these while the batch ran (inInsertBatch), because each is a pass over the WHOLE
     document and running one per inserted sentence is O(sentences × document) for an answer that is
     only correct once the last sentence has landed. AFTER endRenderHold, so the blocks they re-render
     from exist. Best-effort: an insert that has already succeeded must not be reported as a failure
     because a derived row could not be filled. */
  if(n){ try{ await paintTr(); }catch(e){ console.error("insert: transliteration pass failed",e); }
    try{ await annotateTranslitMisc(); }catch(e){ console.error("insert: MISC Translit pass failed",e); } }   // no `si` → every sentence, which is what one pass at the end means
  /* …AND THE VIEWPORT LANDS ON THE FIRST OF THEM, not the last. The loop walks `index` forward, so the
     selection and the rendered window ended up on the final sentence of the paste — the reader was
     shown the end of what they had just added and had to scroll back to read it from the top. `start`
     was captured before the loop for exactly this kind of question. scrollToSentence (js/core/document.js)
     recentres the virtualization window first, so this works however far the paste ran. */
  if(n){ sel={s:start,t:0}; CURBLOCK=start;
    pick(start,0,false);   // scroll:false — pick aims at the token's GRID ROW, which does not exist with the grids hidden, so it would silently no-op. The block is what we want on screen anyway
    if(typeof alignBlockTop==="function") alignBlockTop(start); }   // js/core/scroll.js — recentres the virtualization window, then puts the block flush under the toolbar
  if(n>1&&!opts.quiet) toast(multi?`Inserted ${n} sentences in ${paras.length} paragraphs`:`Inserted ${n} sentences`);
  return {start,count:n,paras:paras.length,paraCounts}; };

/* ── item 7: the Insert-text dialog's full result — a main text and/or any number of PARALLEL texts ──────
   The sheet (sheetInsert) submits to Api.child_insert_text, which converts each field's ITRANS in its own
   language and sentencises the parallel texts with that language's own installed pipeline (or the rule
   splitter), then calls this — and with no bridge the sheet does that little itself and calls this
   directly, so both paths end here. Payload:
     {index, main:{enabled,lang,text,model}, parallels:[{lang,paras:[[…],…]}], adoptLang, naive:[lang,…]}
   The MAIN text arrives as a STRING, not as sentences, because the paragraph/heading structure inside it
   still has to become `# newpar`/`# newdoc` here (paragraphsWithIds) — a parallel text arrives already
   split, but split into PARAGRAPHS of sentences, because that structure is what it is lined up by. */
window.__applyInsertPayload=async function(p){ p=p||{};
  const pars=(p.parallels||[]).filter(x=>x&&x.lang&&parParas(x).length);
  const main=p.main||{};
  /* THE WHOLE PAYLOAD IS ONE UNDO ENTRY — one press of ⌘Z takes back everything the Insert-text sheet did,
     main text and every parallel translation together, because that is what the user did: one dialog, one
     Insert. This is the OUTER batch; __insertPastedText opens one of its own inside it and applyParallelTexts
     pushes an entry of its own, both of which the depth counter neutralises (js/core/undo.js). */
  beginUndoBatch(); beginRenderHold();
  try{
  /* A BRAHMIC INSERT ALSO SETS THE SCRIPT. The text is STORED as Devanagari — the one script the model
     reads — but somebody who pastes Kannada wants to read Kannada, so the script they typed in becomes
     the display choice. Before the insert, so the first render already draws it and the reader never
     sees their own paste come back in another script. orPick records the choice per language like any
     other, and does nothing when the pill is already on that script. */
  if(p.showScript && typeof orPick==="function" && ORTHO_SCHEME!==p.showScript) orPick(p.showScript);
  if(main.enabled&&(main.text||"").trim()){
    // An empty document adopts the language the dialog chose (and the parser that goes with it) BEFORE the
    // first sentence is inserted — doInsert parses with whatever `model` is set at that moment, so adopting
    // afterwards would parse the whole insert with the outgoing language's model. (The sheet ALSO adopts on
    // the click, so the model menu shows the choice at once rather than after this round trip; re-adopting
    // the same language and model here is a no-op, and it is still the only adopt on a payload that did not
    // come from the sheet — see adoptInsertLang.)
    if(p.adoptLang&&main.lang) adoptInsertLang(main.lang,main.model||"");
    const r=await __insertPastedText(main.text,p.index,{quiet:pars.length>0});
    if(pars.length) applyParallelTexts(pars,r.start,r.count,`Inserted ${r.count} sentence${r.count===1?"":"s"}`,p.naive,r.paraCounts);
    return; }
  // TRANSLATIONS-ONLY (item 7d): no new sentences — the supplied texts land on sentences that are already
  // there, starting just after the last one that already carries a translation in any of these languages.
  // The main text's paragraphs are read off the DOCUMENT here (docParaCounts): the blocks are already in
  // the file, so their `# newpar`/`# newdoc` marks ARE the paragraph structure the translation aligns to.
  const start=transStartIndex(pars.map(x=>x.lang));
  applyParallelTexts(pars,start,DOC.length-start,"",p.naive,docParaCounts(start,DOC.length-start));
  } finally { endRenderHold(); endUndoBatch(); } };

/* ── PARAGRAPH-FIRST ALIGNMENT of a parallel text onto the main text's sentences ─────────────────────────
   The rule, and the only sane one for texts that no sentenciser will ever segment identically in two
   languages: paragraph n of the translation belongs to paragraph n of the main text, and WITHIN a paragraph
   sentence n belongs to sentence n. A translated paragraph with MORE sentences than the main paragraph has
   its excess COLLAPSED onto the last aligned sentence (joined with a single space), so the error stays
   inside the paragraph that caused it instead of shifting every later translation by one — which is exactly
   what the old whole-text positional zip did.
   Fewer sentences simply leaves the tail of the main paragraph untranslated in that tier.
   MISMATCHED PARAGRAPH COUNTS are handled as the honest analogue of the sentence rule: excess translation
   paragraphs collapse onto the LAST aligned paragraph (and thence, by the rule above, onto its last
   sentence), and excess MAIN paragraphs simply go untranslated. Nothing is ever dropped.
   Returns {sents,collapsed}: one entry per main sentence ("" where there is none) and how many translation
   sentences were merged into the sentence before them. */
function alignToParagraphs(paras,sizes){ const out=[]; let collapsed=0;
  const np=(sizes||[]).length; if(!np) return {sents:out,collapsed:0};
  let src=(paras||[]).map(par=>(par||[]).map(s=>(s||"").trim()).filter(Boolean)).filter(par=>par.length);   // an empty paragraph is not a paragraph — it must not consume one of the main text's
  if(src.length>np) src=src.slice(0,np-1).concat([[].concat(...src.slice(np-1))]);   // the excess paragraphs join the last aligned one, which the sentence rule below then collapses onto its final sentence
  for(let i=0;i<np;i++){ const want=sizes[i], got=src[i]||[];
    if(want<=0) continue;   // can't happen (every paragraph yields ≥1 block — see __insertPastedText/docParaCounts) but a 0 would silently swallow a paragraph's whole translation
    for(let k=0;k<want;k++){
      if(k>=got.length){ out.push(""); continue; }                                        // the translation ran out inside this paragraph
      if(k===want-1&&got.length>want){ collapsed+=got.length-want; out.push(got.slice(k).join(" ")); }   // last aligned sentence takes the remainder of the paragraph
      else out.push(got[k]); } }
  return {sents:out,collapsed}; }
/* A parallel text's paragraphs, whichever shape the payload used. `paras` is what both producers now send;
   a flat `sents` (the shape before paragraph alignment existed) is read as ONE paragraph, which degrades to
   the old positional zip rather than to nothing. */
function parParas(par){ return (par&&par.paras)||((par&&par.sents&&par.sents.length)?[par.sents]:[]); }
/* The main text's paragraph sizes for a run of blocks ALREADY IN THE DOCUMENT (the translations-only path):
   a block carrying `# newpar` (or `# newdoc`, which opens a paragraph too) starts one, so the run's paragraph
   shape reads straight off the marks __insertPastedText wrote — or off the ones the file was opened with.
   No marks at all ⇒ one paragraph, which is what an unstructured document is.
   hasNewpar/hasNewdoc, NOT a bare `!=null` test: the four boundary states are documented at _BOUNDARY_KEYS
   (js/core/prefs.js) and `false` means "removed", which a null test would read as "present".
   A mid-sentence paragraph start (MISC NewPar=Yes) is deliberately not read here — it divides a sentence, and
   a sentence is the smallest thing a translation can attach to, so it names no boundary this can align on. */
function docParaCounts(start,room){ const out=[];
  for(let i=0;i<Math.max(0,room);i++){ const s=DOC[start+i];
    if(!out.length||(s&&(hasNewpar(s)||hasNewdoc(s)))) out.push(0);
    out[out.length-1]++; }
  return out; }
/* Paragraph sizes clipped to the blocks this insert may actually use. Only bites when the document runs out
   of sentences mid-way (translations-only, near the end of a file); the remainder, if the marks named fewer
   blocks than there are, is given to the last paragraph rather than dropped. */
function clipCounts(counts,avail){ const out=[]; let n=0;
  for(const c of ((counts&&counts.length)?counts:[avail])){ if(n>=avail) break;
    const k=Math.min(c,avail-n); if(k>0){ out.push(k); n+=k; } }
  if(n<avail){ if(out.length) out[out.length-1]+=avail-n; else out.push(avail); }
  return out; }

/* Where a translations-only insert starts: the block AFTER the last sentence that already has a translation
   in at least one of the submitted languages — i.e. carry on from where the translating stopped. Nothing
   translated yet ⇒ -1 ⇒ start at the first sentence, which is the same rule read on an empty slate. Only a
   NON-EMPTY translation counts: an enabled tier puts an empty {lang,text:""} row on every sentence it is
   shown under (renderBlockTrans), so testing for the row's presence would always answer "the last one". */
function transStartIndex(langs){ let last=-1;
  DOC.forEach((s,i)=>{ if((sentTranslations(s)||[]).some(t=>langs.indexOf(t.lang)>=0&&(t.text||"").trim())) last=i; });
  return last+1; }

/* Write each parallel text onto the blocks from `start`, ALIGNED PARAGRAPH-FIRST (alignToParagraphs above).
   `room` is how many blocks this insert may use (the count just inserted, or the rest of the document) and
   `counts` is how those blocks divide into the main text's paragraphs. Nothing is dropped: a translation
   with too many sentences collapses its excess onto the last sentence of the paragraph it belongs to, which
   is reported rather than left to be discovered later. */
function applyParallelTexts(pars,start,room,lead,naive,counts){ if(!pars||!pars.length)return;
  const avail=Math.max(0,Math.min(room,DOC.length-start));
  if(!avail){ toast(lead?lead+" · no sentences left for the translations":"No sentences left to translate — every sentence already has one"); return; }
  const sizes=clipCounts(counts,avail);
  pushUndo();   // ONE entry for the whole translation pass (the insert path's own per-sentence entries are already behind us)
  let collapsed=0, done=0;
  pars.forEach(par=>{ TRANS_LANGS.add(par.lang);   // an insert in a new language enables its tier, so the field shows up under every block
    const a=alignToParagraphs(parParas(par),sizes); collapsed+=a.collapsed; let got=0;
    a.sents.forEach((txt,k)=>{ if(!txt) return;   // an unaligned slot writes NOTHING — it must not blank a translation this tier already carried, and an empty row is not an absent one (renderBlockTrans shows one under every sentence anyway)
      const s=DOC[start+k]; if(!s)return; got++;
      const rows=sentTranslations(s); let row=rows.find(r=>r.lang===par.lang);
      if(!row){ row={lang:par.lang,text:""}; rows.push(row); }
      row.text=txt; });
    done=Math.max(done,got); });
  markDirty(); renderTransDrawer(); preserveScroll(renderDoc);
  const names=pars.map(x=>langName(x.lang)||x.lang).join(", ");
  const bits=[]; if(lead)bits.push(lead);
  bits.push(`${lead?"translations":"Added translations"} in ${names} on ${done} sentence${done===1?"":"s"}`);
  if(collapsed>0) bits.push(`${collapsed} extra translation sentence${collapsed===1?"":"s"} folded into the last sentence of their paragraph`);   // where a paragraph's translation outran its main text — said plainly, since a fold leaves no trace in the result to notice later
  if(naive&&naive.length) bits.push(`${naive.map(c=>langName(c)||c).join(", ")} split on punctuation (no parser installed)`);   // the optional-dependency degrade, surfaced the way this app surfaces them
  toast(bits.join(" · ")); }

/* An empty document takes the language chosen in the Insert dialog, and the parser the registry ranked best
   for it (Api._model_for_language → models_registry.best_installed_model, which prefers SUD over Stanza).
   applyLang already syncs a model from MODELLANG, but that map keeps only the first installed model per
   language, so the explicit id is applied over it — with a guard, since a model that isn't in the dropdown
   (removed since the listing was built) must leave the picker consistent rather than pointing at nothing. */
function adoptInsertLang(lang,modelId){
  if(typeof applyLang==="function") applyLang(lang,true); else setLang(lang);
  if(!modelId) return;
  const sel=document.getElementById("modelSel");
  if(sel){ sel.value=modelId; if(sel.value!==modelId) return; }   // not in the picker → keep whatever applyLang settled on
  model=modelId; if(typeof syncMenu==="function")syncMenu(); }

/* "Reset parse" / ⌘R — run the sentence through the parser again on its OWN text. Nothing about the text changes,
   so this IS commitSentText's operation with the string held fixed, and it runs applySentText's body rather than a
   second copy of it (which is how the two drifted: the copy here never re-seeded the morphemic tiers). It adds
   exactly two things — it asks first, because a re-parse throws away hand annotation, and it FORCES the work,
   because applySentText skips a text whose tokens are unchanged and a re-parse's text is unchanged by definition. */
async function reparse(i){ const s=DOC[i]; if(!s)return;
  const text=(s.text&&s.text.trim())||s.tokens.map(t=>t.form).join(" ");   // no `# text` (a hand-built sentence) → the forms themselves are the text
  const willParse=hasBridge()&&model;   // …and the question names what will actually run: with no model, or no bridge to run one, this is a re-tokenisation and promising a "parse" would be a lie
  if(s.tokens.some(t=>t.head&&t.head!=="0"&&t.deprel) && !(await askConfirm("Reset this sentence's parse? Its current tokens and annotations will be replaced by a fresh "+(willParse?"parse":"tokenisation")+".",{danger:true,okLabel:"Reset"}))) return;
  await applySentText(i,text,{force:true,scroll:true}); }   // scroll: a re-parse is invoked from the menu/keyboard, so bring its sentence into view (commitSentText's caller is already looking at it)
window.reparse=reparse;

/* ── ONE path from "a sentence's text" to "the sentence's tokens" ────────────────────────────────────────────────
   Item 4 (commit an edited `# text`) and ⌘R (reset the parse) are the same operation — replace a sentence's tokens
   from a string — and they used to carry two copies of it that DRIFTED APART: the re-parse copy never called
   morphAfterReparse, so re-parsing a sentence left MSeg/MGloss empty while re-typing the identical text through
   commitSentText filled them. One body, two entry points:
     · commitSentText(i,newText) — the user edited the text; the edit IS the intent to re-tokenise, so no confirm.
     · reparse(i)                — the user asked for a fresh parse of the text already there; confirms, and forces.
   `force` is the one thing that cannot be inferred from the arguments. This function skips the whole operation when
   the new text's TOKENS are unchanged (only the line breaks differ — the branch below), and a re-parse's text is
   unchanged BY DEFINITION, so without an explicit flag every re-parse would fall into that early-out and silently
   do nothing at all. `scroll` is passed to pick(): a menu/keyboard-invoked re-parse brings its sentence into view;
   a text edit does not, since the caller is already looking at it.
   UNDO: exactly ONE entry for the whole operation, however many awaits it spans — the snapshot is taken before the
   first write and pushed with commitSnap once the document has actually changed, so a tokenise that fails leaves no
   entry at all and a parse that fails rolls its own tokenise back (see `rollback`). */
/* THE HAND-PLACED MARKS, and why a re-tokenise must not eat them. Foreign=Yes, Reported=Yes and Typo=Yes with
   its MISC CorrectForm are the three things on a token that NO tokeniser or parser can reproduce, because a
   person decided them. applySentText replaces every token object wholesale, so editing one word of `# text`
   used to silently un-mark every foreign word, every reported clause and every other typo in the sentence —
   the annotation was simply gone, with nothing said. Captured before the replacement, re-applied after.
   MATCHED BY FORM AND OCCURRENCE, never by index. An edit that inserts or deletes a word shifts every index
   after it, so index-matching would move a mark onto a neighbouring word — worse than losing it, because it
   asserts something false. "The 2nd `je` in this sentence" survives insertion and deletion elsewhere.
   A mark whose word the edit CHANGED still has to survive, and that is what the second pass is for. Editing the
   running sentence edits the SURFACE — retyping `certan` is a correction to how the sentence reads, not a
   statement that the token stopped being a typo, and Typo=Yes with its CorrectForm is meant to be cleared
   deliberately, from the diagram or the grid, where the correct form is the thing on offer. (An earlier version
   dropped such a mark, reasoning that the word it described no longer existed; that treats a re-spelling as a
   deletion, which it is not.)
   So: pass 1 matches by form+occurrence, exact and order-proof; pass 2 gives every mark still unplaced the token
   at its ORIGINAL INDEX, provided that index exists and pass 1 has not already claimed it. Editing one word in
   place leaves every index alone, so the fallback lands exactly where it should — and since it only ever sees
   marks pass 1 could not place, an unchanged word is never at risk from it. */
const _MARK_FEATS=["Foreign","Reported","Typo"];
function captureMarks(s){ const seen=Object.create(null), out=[];
  (s&&s.tokens||[]).forEach((t,i)=>{ const f=t.form||"", n=(seen[f]=(seen[f]||0)+1)-1;
    const feats=_MARK_FEATS.filter(k=>hasFeat(t.feats,k,"Yes"));
    const cf=correctFormOf(t);                                   // itself gated on Typo=Yes, so a stale CorrectForm is not carried
    if(feats.length||cf) out.push({form:f,nth:n,idx:i,feats,cf}); });
  return out; }
function restoreMarks(s,saved){ if(!saved||!saved.length) return 0;
  const toks=(s&&s.tokens)||[];
  const seen=Object.create(null), byKey=Object.create(null);
  toks.forEach(t=>{ const f=t.form||"", n=(seen[f]=(seen[f]||0)+1)-1; byKey[f+"\u0001"+n]=t; });
  const claimed=new Set();
  const apply=(t,m)=>{ claimed.add(t);
    m.feats.forEach(k=>{ t.feats=setFeat(t.feats,k,"Yes"); });
    if(m.cf) t.misc=setMiscKV(t.misc,"CorrectForm",m.cf); };
  let n=0; const left=[];
  saved.forEach(m=>{ const t=byKey[m.form+"\u0001"+m.nth]; if(t){ apply(t,m); n++; } else left.push(m); });   // pass 1 — exact: form + which occurrence of it
  left.forEach(m=>{ const t=toks[m.idx]; if(!t||claimed.has(t)) return; apply(t,m); n++; });                   // pass 2 — same slot, for a word the edit re-spelled
  return n; }
async function applySentText(i,newText,opts){ const s=DOC[i]; if(!s)return; opts=opts||{};
  const force=!!opts.force, scroll=!!opts.scroll;
  const marks=captureMarks(s);   // taken BEFORE any branch writes tokens; every path that replaces them restores from this
  // item 12: PRESERVE the user's line breaks for display (collapse only runs of horizontal whitespace, keep single \n);
  // the tokeniser splits on ALL whitespace incl. newlines, so tokens are unaffected. The stored s.text carries the \n
  // for the .stext / .strans display; the CoNLL-U serializer collapses them so `# text` stays a valid single line.
  const display=(newText||"").replace(/[^\S\n]+/g," ").replace(/[ \t]*\n[ \t]*/g,"\n").replace(/\n{2,}/g,"\n").replace(/^\n+|\n+$/g,"").trim();
  const parseText=display.replace(/\s+/g," ").trim();   // …and the PARSER is handed the single-line form: a raw \n would glue itself to the next word (see the `src_text` gate in app/parse.py)
  const cur=(s.text!=null?s.text:s.tokens.map(t=>t.form).join(" ")).replace(/\s+/g," ").trim();
  if(!parseText){ preserveScroll(renderDoc); return; }
  if(!force && parseText===cur){   // tokens unchanged — only the line breaks differ → update the display text, no re-parse
    if(display!==s.text){ pushUndo(i); s.text=display; markDirty(); }
    preserveScroll(renderDoc); return; }
  if(hasBridge()&&model){
    const pre=snapSent(i);   // BEFORE anything is written, so both failure paths can leave the document exactly as they found it
    showBusy("Tokenising…"); let tk;
    try{ tk=await window.pywebview.api.tokenize(parseText,model); }catch(e){ hideBusy(); toast("Parse failed: "+e); preserveScroll(renderDoc); return; }   // nothing written yet → nothing to undo, nothing to restore
    s.text=display; s.tokens=tk.tokens.map(t=>({...t,head:String(t.head)})); s.mwt=tk.mwt||[]; if(!s.mwt.length)delete s.mwt; s.orthoLine=""; restoreMarks(s,marks);   // the tokeniser's tokens carry no hand-placed marks — put back the ones whose word survived the edit   // item 19: NEW tokens have no cached t.ortho; clear the stale running-line so fillOrtho re-fetches the SCRIPT
    commitSnap(pre);   // the document has changed → its single undo entry goes in NOW, so markDirty (which reads UNDO.length) tells the truth for the seconds the parse takes
    markDirty(); preserveScroll(renderDoc); clearSelToBlock(i,scroll);   // item 9: a re-parse replaces the sentence's tokens, so the old selection is meaningless and a NEW one would be the app's choice, not the user's — leave nothing selected and move only the reading focus (which is what `scroll` was ever for)
    await paintTr();                                                               // transliterate the tokeniser's tokens BEFORE the parse
    const bt=document.getElementById("busyText"); if(bt)bt.textContent="Parsing…"; let r;
    // A parse that THROWS (the model died, the extras tier vanished) must not leave the sentence half-done — its
    // tokens replaced and every annotation gone, with only a toast to say why. Roll the tokenise back to `pre` and
    // drop the undo entry that was speaking for it: the operation failed, so it did nothing. (`r.parsed===false` is
    // a different thing — the backend answering honestly with a whitespace fallback — and that result is kept.)
    const rollback=()=>{ if(UNDO[UNDO.length-1]===pre)UNDO.pop(); applySnap(pre); updateUndoUI(); };   // pop only while it's still on top: an overlapping edit's entry is not ours to remove
    try{ r=await window.pywebview.api.parse_text(parseText,model); }catch(e){ hideBusy(); rollback(); toast("Parse failed: "+e); return; }finally{ hideBusy(); }
    s.tokens=r.tokens.map(t=>({...t,head:String(t.head)})); s.mwt=r.mwt||[]; if(!s.mwt.length)delete s.mwt; s.orthoLine=""; restoreMarks(s,marks);   // …and again after the PARSE, which replaces the tokeniser's tokens in turn (its FEATS come from the model and know nothing of Foreign/Reported/Typo)
    morphAfterReparse(s);   // the new tokens carry no MSeg/MGloss — re-seed both tiers from the FEATS this parse just produced (inside the same undo entry: it is part of the re-parse, not a second edit)
    renderDiagramIncremental(i);   // js/core/document.js: this sentence was just parsed → let the render on the next line draw its tree breadth-first by depth and converge on the real one, rather than leaving the row blank for the whole layout pass. ARMS the sequence; the render below IS its first stage
    markDirty(); preserveScroll(renderDoc); clearSelToBlock(i,scroll);   // item 9, as above: the parse's tokens land with nothing selected
    toast(r.parsed?`Re-parsed · ${MODELINFO[model]||model}`:`Re-tokenised on whitespace${r.reason?" (no parse: "+r.reason+")":""}`);
    if(isSanskritLang())await autoGroupSanskritMWTs(i,!!(r.mwt&&r.mwt.length));   // FIRST, and awaited — see the note at the insert path above on the race this removes
    if(show.translit)fillTranslit(); if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang())fillOrtho();   // item 19: re-apply the SCRIPT now the parse's tokens (and its MWT forms) are in
    annotateTranslitMisc(i).then(ch=>{ if(ch)preserveScroll(renderDoc); }); return;
  }
  pushUndo(i);
  s.text=display; s.tokens=buildTokens(parseText); delete s.mwt; s.orthoLine=""; restoreMarks(s,marks);   // the whitespace path replaces tokens too, so it restores on the same terms   // no model (or no bridge to run one) → whitespace tokenisation with EMPTY annotations; item 19: clear running-line so fillOrtho re-scripts the new tokens
  morphAfterReparse(s);   // no FEATS to compose an MGloss from without a parse, but MSeg still seeds from the new forms
  markDirty(); preserveScroll(renderDoc); clearSelToBlock(i,scroll);   // item 9, as in the parsed branch above: a re-tokenise leaves nothing selected
  if(show.translit)fillTranslit();   // the re-tokenised tokens start with no cached translit/script — re-apply the active transliteration row so a non-Latin display survives
  if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang())fillOrtho();   // item 19: re-apply the selected SCRIPT after a whitespace re-tokenise
  // No parse ran here, so the toast must not name a model. It used to say "Re-parsed · <model> · SUD" whenever one
  // was merely SELECTED, which described the deleted annotate() heuristic's invented tags as that model's analysis.
  toast(model?"Re-tokenised on whitespace · the parser runs in the desktop app":"Re-tokenised on whitespace · no annotation"); }
/* Item 4 — commit an edited sentence text (# text). Thin entry point onto the shared body above; no confirm,
   because typing a new text is itself the explicit intent to re-tokenise.
   Item 13: …and it is where a Sanskrit line typed in ITRANS becomes the IAST this app stores, the same
   conversion the grid's Form/Lemma cells already run on blur (itransCell in js/grid/grid.js). itransFix is a
   no-op for every other language and without a bridge, so this costs nothing for the 99 % of documents it
   cannot touch, and it returns what it was given on any failure — the input is never lost.
   HERE AND NOT IN applySentText, which is the shared body ⌘R also runs: a re-parse hands that body the
   sentence's OWN text, unedited, and running the ITRANS gate over it would rewrite a Sanskrit line nobody
   typed in. That is exactly the hazard itransCell's `_edited` flag exists for — the same rule, applied at the
   entry point that means "the user typed this" rather than to the body both entry points share.
   THE WHOLE LINE GOES IN, unsplit: the per-word and per-compound-member splitting is the conversion's own
   business (see itransFix / Api.itrans_to_iast), and second-guessing it here would give a Sanskrit sentence
   two different word-splitting rules. */
async function commitSentText(i,newText){
  let t=newText;
  if(typeof itransFix==="function"){ try{ t=await itransFix(newText); }catch(e){ t=newText; } }   // …and a throw is not a reason to lose the user's typing
  return applySentText(i,(t==null?newText:t),{}); }
window.commitSentText=commitSentText;

/* Item 6 — per-sentence translations grid. Translations round-trip as `# text_LANG = …` comments (the UD
   convention, universaldependencies.org/format.html). io_conllu parses those lines into `s.translations`
   [{lang,text},…] and re-serialises them from that same list, so edits made here persist to the file. */
let _nameToCode=null;
function langCode(q){ q=(q||"").trim().toLowerCase(); if(!q) return "";   // resolve a typed language NAME to its ISO code (a code the user types is returned unchanged by the caller)
  if(!_nameToCode){ _nameToCode=new Map();
    (window.ISO639_3||[]).forEach(e=>{ if(e[2])_nameToCode.set(String(e[2]).toLowerCase(), e[1]||e[0]); });
    Object.entries(LANGNAMES).forEach(([c,n])=>_nameToCode.set(String(n).toLowerCase(), c)); }
  return _nameToCode.get(q)||""; }
function sentTranslations(s){ if(!Array.isArray(s.translations)){   // derive from raw comments for docs opened without the backend field (e.g. the in-page mockup)
    const out=[]; (s.comments||[]).forEach(c=>{ const m=/^#\s*text_([^\s=]+)\s*=\s*([\s\S]*)$/.exec(c); if(m) out.push({lang:m[1],text:m[2]}); });
    s.translations=out; } return s.translations; }
// ── document-level glossing tiers (item 4): titlebar-invoked add + drawer visibility/removal ──────
// window.addGloss / window.addMorphGloss — TOGGLING-ADD (create + show), UNDOABLE (add-then-Undo removes the
// tier). The titlebar buttons call these. The Show/Hide drawer has a checkbox per tier (visibility) and a ✕
// (remove: clears the tier's MISC data, guarded by a confirm, undoable). snap() captures GLOSS_ON/MORPH_ON +
// DOC (so the MISC data), so undo/redo round-trip the tier's state and its cell contents.
function syncGlossUI(){ const g=document.querySelector('#toggles [data-t2="gloss"]'), m=document.querySelector('#toggles [data-t2="morph"]');
  // The lexical gloss tier is available in EVERY format, mSUD included: a word's lexical meaning and its morphemic
  // analysis are different things, and an mSUD document has as much use for the first as any other. (This used to
  // grey the checkbox out under mSUD on the reasoning that the morphemic gloss superseded it — it doesn't.)
  if(g){ g.checked=GLOSS_ON; g.disabled=false; const lab=g.closest("label"); if(lab){ lab.classList.remove("chk-off"); lab.title=""; } }
  // The morphemic tier is available in every language, Latin included. Its segmentation was always
  // computed from the BARE form (msegSegment never read vowel length — the removed macron overlay
  // only decorated an already-determined boundary for display), so dropping that decoration changes
  // nothing about where the boundary falls; Latin just reads like every other language now.
  if(m){ m.checked=MORPH_ON; m.disabled=false; const lab=m.closest("label"); if(lab){ lab.classList.remove("chk-off"); lab.title=""; } }
  // item 3: the Show/Hide VISIBILITY checkboxes appear only when the tier is present, and reflect GLOSS_VIS / MORPH_VIS
  const gv=document.querySelector('#toggles [data-vis="gloss"]'), mv=document.querySelector('#toggles [data-vis="morph"]');
  if(gv){ gv.checked=GLOSS_VIS; const l=gv.closest("label"); if(l)l.style.display=GLOSS_ON?"":"none"; }
  if(mv){ mv.checked=MORPH_VIS; const l=mv.closest("label"); if(l)l.style.display=MORPH_ON?"":"none"; }
  const gh=document.getElementById("glossVisHead"); if(gh)gh.style.display=(GLOSS_ON||MORPH_ON)?"":"none"; }
// Canonical MORPHEME order for gloss population — deliberately NOT the FEATS column's own order (CoNLL-U
// requires FEATS to stay alphabetical by feature name; MGloss has no such constraint and follows the linguistic
// ordering below instead, so the two are allowed to diverge — see featsToGloss/mglossSyncFeats/featsSyncGloss,
// none of which reorder one to match the other any more).
//
// Built from a UNIVERSAL RELEVANCE HIERARCHY (URH), triangulated across four independent frameworks rather
// than Bybee alone:
//   · Bybee (1985, Morphology): the original Relevance Hierarchy — MOST to LEAST relevant to the verb's own
//     core meaning — Voice(valence) > Aspect > Tense > Mood > Evidentiality > Person/Number (agreement is
//     LEAST relevant: cross-referencing an argument doesn't change what the verb itself MEANS).
//   · Van Valin & LaPolla's RRG (1997): the clause's layered operator projection scopes Aspect over the
//     NUCLEUS (innermost — voice/valence changes are lexical nucleus-formation, deeper still), Modality/
//     directionals over the CORE, then Tense, Evidentials, and Illocutionary Force successively over the
//     wider CLAUSE/SENTENCE — i.e. Voice/Aspect nuclear, Tense/Evidentiality peripheral, agreeing with Bybee.
//   · Dik's Functional Grammar (1997): the same layering by predicate-formation, restated as π1–π4 operators
//     (π1 inner/phasal aspect on the PREDICATE < π2 objective/dynamic modality on the PREDICATION < π3 tense +
//     subjective/epistemic modality on the PROPOSITION < π4 illocution on the CLAUSE) — the same inner-to-outer
//     ladder under different names, and for TERMS (Dik's NPs) a parallel nuclear→core→extended-core→term
//     layering: qualifying/classifying operators (≈ Gender/NounClass) sit closer to the nucleus than
//     quantifying ones (≈ Number), which sit closer than referential operators (≈ Definite/Deixis) — the
//     source of the nominal ordering below.
//   · Systemic Functional Grammar (Halliday): the NP's Deictic^Numerative^Epithet^Classifier^Thing template is
//     a CONSTITUENT-order fact (which whole words precede the head noun), not a claim about morpheme order
//     within one word — not directly portable here — but its outer-to-inner READING (Deictic, discourse-
//     anchoring, outermost; Classifier, inherent sub-typing, innermost/closest to Thing) is the same
//     "referential-grounding outer, inherent-classification inner" shape RRG/Dik's Term layering gives, so it
//     corroborates the PRINCIPLE (used for the Gender/NounClass > Number > Definite/Poss/Deixis ordering
//     below) without being a source for any specific slot.
// Mood vs. Aspect vs. Tense: RRG's own scope-based operator hierarchy would put (root) Modality between Aspect
// and Tense — but the ATTESTED gloss/description convention overrides pure scope here: nobody writes "indicative
// present", always "present indicative" (Tense-word before Mood-word), and the standard abbreviation for this
// whole domain is "TAM(P)" — Tense, Aspect, Mood, (Polarity) — never "MTA"/"MAT". Both point to Mood as the
// LEAST nuclear (most peripheral) of the three, Tense as the MOST nuclear — so the relevance order here is
// Mood > Aspect > Tense, i.e. gloss order (closest-to-stem first) Tense, Aspect, Mood — overriding RRG's scope
// prediction with the community's actual naming/glossing practice.
// Merged: verbal Voice > Polarity > Mood > Aspect > Tense > Evidentiality > Person/Number (Polarity rides just
// after Voice — Bybee's data places negation almost as nuclear as valence; Mood, Aspect, Tense follow in THAT
// relative order per the note above); nominal Gender/Animacy/NounClass (inherent classification, most relevant)
// > Number > Case (encodes the noun's relation to the CLAUSE, not a property of the noun itself, and
// typologically sits further out than Number even where the two co-occur, per Greenberg's Universal 39) >
// Definite/Poss (referential grounding) > the remaining sub-classification features (most peripheral, no theory
// above stakes a claim on their relative order).
//
// The GLOSS order below is the REVERSE of that hierarchy: LEAST-relevant-to-meaning categories sit CLOSEST to
// the stem, MOST-relevant sit FURTHEST — with two deliberate overrides, per instruction: (a) Case is pinned just
// ahead of the Person/Number block so it glosses BEFORE Number (overriding the Number > Case hierarchy above);
// (b) Person and Number are pinned adjacent, in THAT order, never flipped to Number-then-Person by the reversal (they're Bybee's single
// least-relevant "agreement" slot regardless, so this barely disturbs the hierarchy — it just fixes their
// internal order). This also preserves the app's existing "3SG", not "SG3", fused-token convention — see
// featsToGloss's no-dot join. VerbForm (finite/participle/gerund/… — the word's inflectional STATUS, not a
// semantic category Bybee's hierarchy covers at all) keeps its own independent placement: always LAST —
// "past/perfect participle" glosses as PST.PFV.PTCP, not PTCP.PST.PFV.
//
// Not a live citation-perfect ordering for every category (nobody has run a corpus study on, say, Clusivity vs.
// Reflex), but internally consistent and easy to re-order by hand if a specific placement should move.
const MGLOSS_FEAT_ORDER=["Case","Person","Number","Clusivity","PronType","NumType","Poss","Reflex","Abbr","ExtPos","Polite","Deixis","DeixisRef","Degree","Definite","Gender","Animacy","NounClass","Evident","Tense","Aspect","Mood","Polarity","Voice","VerbForm"];   // Case pinned just AHEAD of the Person/Number agreement block, per instruction, so it glosses BEFORE Number (and can't split the fused Person+Number "3SG")   // ⚠ THE POS-SUBTYPE FEATURES (PronType, NumType, Poss, Reflex, Abbr) COME RIGHT AFTER NUMBER, per instruction — "3SG.PERS". They used to sit at the very END of the hierarchy (item 2), on the reasoning that a subtype qualifies the WORD CLASS rather than any morpheme, so it should trail every inflectional category; the instruction supersedes that. Placed after Clusivity rather than between Number and Clusivity, because item 9b pinned Clusivity "directly after Number, GLUED to the Person/Number run it qualifies" — 1PL.INCL is one agreement statement and nothing may split it, so "right after Number" here means "right after the agreement run Number belongs to". With no Clusivity (every language but a handful, and every example in the instruction) the two readings coincide exactly   // item 5: Polite sits with the other participant-oriented categories; DeixisRef immediately follows the Deixis value it anchors; Abbr — a property of the word FORM rather than of any morpheme — trails every inflectional category   // item 9b, per instruction: CLUSIVITY GOES BETWEEN NUMBER AND GENDER — i.e. directly after Number, glued to the Person/Number run it qualifies. A GENERAL rule about where Clusivity sits, applied to this RESTING order as well as inside the moved nominal block below, so the two never disagree. It used to sit after ExtPos, beside Polite (item 5's "participant-oriented" grouping); moving it up leaves Polite where it was rather than dragging it along, so Polite and Clusivity are no longer adjacent — Clusivity's slot is now fixed by a rule of its own and Polite's by item 5's, and only Clusivity was asked to move
const MGLOSS_FEAT_RANK={}; MGLOSS_FEAT_ORDER.forEach((f,i)=>MGLOSS_FEAT_RANK[f]=i);
/* CASE MOVES depending on whether PERSON is in play, which is why this takes a second argument at all.
   With no person marking, Case glosses BEFORE Number — "NOM.SG", the ordinary nominal sequence, which is what
   the table's own position for Case gives.
   With person marked, the Person+Number agreement block leads and Case follows it — "3SG.NOM", not "NOM.3SG".
   Person and Number are conventionally fused into one portmanteau ("3SG", no dot — see featsToGloss), so Case
   cannot sit between them; it either precedes the pair or follows it, and after is what a reader expects when
   agreement is what the form is chiefly marking.
   Implemented as a fractional rank rather than a second table: +0.5 lands Case immediately after the
   Person+Number+Clusivity run and before whatever follows it, without duplicating an ordering that is otherwise
   identical. Keyed off CLUSIVITY's rank, not Number's, since item 9b pinned Clusivity between the two — Case has
   to clear the whole agreement run, and keying off Number would have dropped it in the middle of one. */
/* …AND WHERE CASE IS PRESENT THE WHOLE NOMINAL BLOCK GOES TO THE END (item 14). Case, Person, Number and the
   GENDER GROUP (Gender, Animacy, NounClass — item 9) are one agreement bundle: a case-marked form is a nominal, and
   its person/number/gender are the categories that case agrees with, so splitting them across the gloss with
   tense/mood/voice material in between reads as two unrelated runs. With Case present they all move behind every
   other category, keeping the intra-block order the two earlier rules already fixed:
     no person → Case, Number, Clusivity, Gender, Animacy, NounClass   ("…NOM.SG.M.ANIM")
     person    → Person+Number, Clusivity, Case, Gender, Animacy, NounClass   ("…1PL.INCL.NOM" — Person and Number
                 are fused into a portmanteau with no dot, see featsToGloss, and Clusivity follows the fused pair,
                 so nothing ever needs to sit BETWEEN Person and Number; Case then clears the whole run)
   THE GENDER GROUP TRAVELS WITH GENDER, AT GENDER'S OWN SLOT, IN THE ORDER Gender > Animacy > NounClass — the same
   relative order MGLOSS_FEAT_ORDER already gives them, so the block's internal sequence is the table's sequence with
   Case/Person/Number pulled to the front. They are ONE agreement dimension wherever a language has them: Animacy is a
   sub-distinction OF Gender in Slavic (an animate masculine accusative is syncretic with the genitive — the very form
   the Russian test case exercises), and NounClass is the Bantu-style analogue that REPLACES Gender rather than
   co-occurring with it. So Gender leads (the general category), Animacy follows it (its refinement), and NounClass
   comes last (the alternative to both, never in fact co-present with either).
   With NO Case in the FEATS nothing moves and the table's own positions stand — this is a rule about where a case
   bundle goes, not a general reordering. Ranks in the block are offset past MGLOSS_FEAT_ORDER.length so they sort
   after every named category AND after the unlisted-feature fallback below.
   CLUSIVITY IS IN THE BLOCK, and it has to be (item 9b). The instruction is "Clusivity goes between Number and
   Gender", which the RESTING order takes literally (Number, Clusivity, …, Gender — see MGLOSS_FEAT_ORDER).
   HERE IT NEEDS READING, because the moved block is the one place where CASE already sits between Number and
   Gender, so "between Number and Gender" has two candidate slots. It takes the one BEFORE Case: Clusivity is a
   PERSON distinction and travels with the Person/Number run exactly as Animacy travels with Gender, which is also
   what keeps it glued to the fused portmanteau it qualifies ("1PL.INCL"). Hence Person, Number, Clusivity, Case.
   Membership in this set is a SEPARATE question from the table entry, and leaving it out would NOT have given the
   same answer: the block's ranks are offset past the whole table, so with a Case present Person and Number jump to
   the end while an unlisted Clusivity would keep its low table rank and strand INCL near the FRONT of the gloss,
   cut off from the very Person/Number run it qualifies. So it is the membership set, not the table entry, that
   keeps the run together under a Case.
   Clusivity WITHOUT Person does not arise in real data (UD defines it as a refinement of first person), so there
   is no machinery for it — only the guarantee that the rank is still DETERMINISTIC rather than falling through to
   the unlisted-feature default: it is a named key in the no-person map too, immediately after Number, ahead of the
   gender group. Same rule, same relative position, in both orders and in the resting table.
   NOT in the block, deliberately: Definite (referential grounding, not a category case agrees with — its own slot). */
/* …AND THE POS-SUBTYPE FEATURES TRAVEL WITH THE BLOCK, at their own slot inside it. They are in the
   membership set for one reason: with Case present the whole nominal block moves to the END (item 14),
   so a subtype left behind at its resting rank would gloss BEFORE the very run it was just asked to
   follow — a personal pronoun would come out `PERS.3SG.NOM` instead of `3SG.PERS.NOM`. Being in the
   block, they keep the position the resting order gives them: immediately after the Person/Number/
   Clusivity agreement run, and ahead of Case and the gender group. */
const MGLOSS_NOMINAL={Case:0,Person:0,Number:0,Clusivity:0,Gender:0,Animacy:0,NounClass:0,
                      PronType:0,NumType:0,Poss:0,Reflex:0,Abbr:0};   // membership set; the values are replaced per-call below
const MGLOSS_SUBTYPE_ORDER=["PronType","NumType","Poss","Reflex","Abbr"];   // their order among THEMSELVES, unchanged from the table
function mglossNominalOrder(f,hasPerson){
  const sub=MGLOSS_SUBTYPE_ORDER.indexOf(f);
  const base=hasPerson
    ? ({Person:0,Number:1,Clusivity:2})[f]
    : ({Number:1,Clusivity:2})[f];
  if(base!=null) return base;
  if(sub>=0) return 3+sub;                      // the subtype run, right after the agreement run
  const after=3+MGLOSS_SUBTYPE_ORDER.length;    // …and everything else shifts past it
  return hasPerson
    ? ({Case:after,Gender:after+1,Animacy:after+2,NounClass:after+3})[f]
    : ({Case:-1,Gender:after+1,Animacy:after+2,NounClass:after+3})[f]; }   // no person → Case LEADS the block (…NOM.SG.M), which is what its own -1 says
function mglossFeatRank(f,hasPerson,hasCase){
  if(hasCase&&Object.prototype.hasOwnProperty.call(MGLOSS_NOMINAL,f)){
    const o=mglossNominalOrder(f,hasPerson);
    if(o!=null) return MGLOSS_FEAT_ORDER.length+1+o; }
  if(f==="Case"&&hasPerson) return MGLOSS_FEAT_RANK["Clusivity"]+0.5;   // unreachable while hasCase is passed (Case present ⇒ the block above claimed it), kept for the callers that ask for one feature's rank without a full FEATS string to test. Clusivity+0.5, not Number+0.5 — see the comment above: Case clears the whole Person/Number/Clusivity run
  const r=MGLOSS_FEAT_RANK[f]; return r==null?MGLOSS_FEAT_ORDER.length:r; }   // an unlisted feature name (a custom PREFS.glossMap entry for something outside FEATS_GLOSS) sorts after every named category, in whatever order it already had
const featsHaveCase=featsStr=>/(^|\|)Case=/.test(featsStr||"");
const featsHavePerson=featsStr=>/(^|\|)Person=/.test(featsStr||"");
// item 12b — FORWARD map FEATS → Leipzig morphemic gloss. Split the CoNLL-U feats (alphabetical, per the CoNLL-U
// spec — never reordered), map each Feat=Val via FEATS_GLOSS, drop the unmapped ones, and re-sequence by
// MGLOSS_FEAT_ORDER (NOT feats' own alphabetical order) before joining with "." (the Leipzig category separator).
// e.g. "Case=Nom|Gender=Masc|Number=Sing" → "SG.NOM.M" (Number, then Case, then Gender, per MGLOSS_FEAT_ORDER —
// NOT the feats string's own Case/Gender/Number alphabetical order). A starting point the user refines by hand
// (the stem gloss).
// CLOSED-class UPOS tags with a genuine Leipzig Glossing Rules standard abbreviation (eva.mpg.de/lingua/
// resources/glossing-rules.php, "List of standard abbreviations" — checked against the rules' own list, not
// every UPOS this app also happens to carry an ExtPos=X gloss mapping for). Of the UD tagset's closed-class UPOS
// (universaldependencies.org/u/pos: ADP/AUX/CCONJ/DET/NUM/PART/PRON/SCONJ), only AUX and DET are on the Leipzig
// list — ADJ/ADV ARE on the Leipzig list too but are OPEN-class (adjectives/adverbs carry their own lexical
// content and still need a real gloss, not just a bare category label), so they're deliberately excluded here.
const UPOS_LEIPZIG_ABBR={AUX:"AUX",DET:"DET"};
function featsToGloss(featsStr,upos){ if((!featsStr||featsStr==="_")&&!(upos&&UPOS_LEIPZIG_ABBR[upos])) return "";
  const _hasP=featsHavePerson(featsStr), _hasC=featsHaveCase(featsStr);   // decide where Case sits and whether the whole nominal block moves to the end — see mglossFeatRank
  const items=(featsStr&&featsStr!=="_"?featsStr.split("|"):[]).map(fv=>({fv,ab:EFF_FEATS_GLOSS[fv]})).filter(x=>x.ab)
    .sort((a,b)=>mglossFeatRank(a.fv.slice(0,a.fv.indexOf("=")),_hasP,_hasC)-mglossFeatRank(b.fv.slice(0,b.fv.indexOf("=")),_hasP,_hasC));   // item 13: consult the EFFECTIVE map (built-ins + user overrides). .sort() is stable (spec-guaranteed since ES2019) → two features at the same rank (shouldn't happen — MGLOSS_FEAT_ORDER has no duplicates) would keep their FEATS order as a tiebreak
  let body=""; items.forEach((x,i)=>{ if(i>0){ const prev=items[i-1];
    body+=(prev.fv.startsWith("Person=")&&x.fv.startsWith("Number="))?"":"."; }   // Person immediately followed by Number ("3SG", not "3.SG") — the two are conventionally fused with no separating dot; see glossToFeats's matching split-on-parse
    body+=x.ab; });
  const posAb=upos&&UPOS_LEIPZIG_ABBR[upos];
  return posAb?(body?posAb+"."+body:posAb):body; }   // a closed-class UPOS with its own standard Leipzig abbreviation (AUX/DET) leads the gloss, ahead of every FEATS-derived category
// the LEXICAL (non-abbreviation) content of an MGloss string — every "." / "-"-delimited token that ISN'T a
// recognised Leipzig abbreviation, "-"-joined. Stays UNDERSCORED internally (an underscore inside one surviving
// token means "one morpheme's gloss is several English words" — Leipzig convention, see applyWiktionaryDef);
// callers decide whether to convert that to "-" (moving it into the flat Gloss tier) or leave it (recombining
// into MGloss via composeMGloss below). The inverse of keepGlossAbbrevs (which keeps the abbreviations instead).
function mglossLexicalPart(mg){ if(!mg) return "";
  return mg.split(/[.\-]/).filter(Boolean).filter(tok=>!GLOSS_ABBR_TOK_RE.test(tok)).join("-"); }
// rebuild an MGloss string from a lexical part (already underscored, as mglossLexicalPart/an underscore-joined
// Wiktionary pick would hold it — "" for none) and the token's current FEATS/UPOS — i.e. lexPart, dot-joined,
// ahead of featsToGloss(featsStr,upos)'s freshly-computed grammatical abbreviations (itself already UPOS-first
// per MGLOSS_FEAT_ORDER). Used wherever the grammatical portion needs recomputing while the lexical stem gloss
// (which FEATS says nothing about) is preserved: setTier's cross-tier prefill and a post-reparse/regen refresh.
function composeMGloss(lexPart,featsStr,upos){ const gram=featsToGloss(featsStr,upos);
  return lexPart?(gram?lexPart+"."+gram:lexPart):gram; }
// insert a NEW abbreviation for `featName` into an EXISTING dot/hyphen-joined run of (purely grammatical, no
// lexical stem) abbreviations, at the slot MGLOSS_FEAT_ORDER says it belongs — used the ONE time an abbreviation
// needs a freshly-decided position rather than either (a) a full regeneration via featsToGloss, which would
// discard any abbreviation in `abbrevs` that isn't itself derivable from FEATS, or (b) retargetGlossAbbrev,
// which only ever moves an abbreviation that's ALREADY there. See applyWiktionaryDef: a picked sense's gender
// abbreviation retargets in place if one already existed (keeping whatever position the user's data already
// had), or lands here — its canonical slot — only the FIRST time gender is ever added to this token's MGloss.
function insertGlossAbbrevAtRank(abbrevs,featName,ab){ if(!abbrevs) return ab;
  // A leading/trailing "-" is the Leipzig ATTACHMENT mark (msegSegment's, or a hand-typed one), not a separator
  // between two abbreviations: take it off the ends first and put it back after, or the split below yields an
  // empty leading token and the insert lands beside it ("-PL" + M → "-.M.PL" instead of "-M.PL").
  let lead="",trail="";
  if(abbrevs.startsWith("-")){ lead="-"; abbrevs=abbrevs.slice(1); }
  if(abbrevs.endsWith("-")){ trail="-"; abbrevs=abbrevs.slice(0,-1); }
  if(!abbrevs) return lead+ab+trail;   // the marks were the whole string
  const hasP=/(^|[.\-])[123](SG|PL|DU)?([.\-]|$)/.test(abbrevs);   // person is read off the gloss STRING here, not off FEATS: this helper places an abbreviation into an existing gloss, and that string is the only statement of what is already marked
  const hasC=/(^|[.\-])(NOM|ACC|GEN|DAT|ABL|LOC|INS|VOC|ERG|ABS)([.\-]|$)/.test(abbrevs)||featName==="Case";   // …and whether a CASE is already glossed here, read off the same string for the same reason: this helper places an abbreviation into an existing gloss, and that string is the only statement of what is already marked. The list is the case abbreviations FEATS_GLOSS actually emits
  const rank=mglossFeatRank(featName,hasP,hasC);
  const toks=abbrevs.split(/([.\-])/);   // even indices = tokens; odd = separators, kept as-is
  const featOf=tok=>{ const cands=GLOSS_FEATS[tok]; if(cands&&cands.length===1) return cands[0].slice(0,cands[0].indexOf("="));
    const pn=splitPersonNumber(tok); if(pn){ const c=GLOSS_FEATS[pn[0]]; if(c&&c.length===1) return c[0].slice(0,c[0].indexOf("=")); }   // a fused "3SG" — either half's rank places it relative to an unrelated category correctly enough, since both halves sit at adjacent ranks
    return null; };
  let insertAt=toks.length;   // default: nothing outranks it → append at the very end
  for(let i=0;i<toks.length;i+=2){ const fn=featOf(toks[i]); if(fn==null)continue;
    if(mglossFeatRank(fn,hasP,hasC)>rank){ insertAt=i; break; } }
  /* `toks` ALTERNATES token, separator, token, … so an in-string slot (an even index > 0) is preceded by the
     separator that already stood before the token being displaced — `before` therefore ends with it, and the
     old code's unconditional before+"."+ab added a SECOND one ("PST.ACC.SG." + M → "PST.ACC.SG..M"). Only the
     APPEND slot (insertAt === toks.length, which is odd, so `before` ends with a token) needs a separator added
     on that side. Latent until item 9: mid-string is where a Gender insert lands once Animacy can already be
     there, and until then almost every insert appended. The separator the displaced token carried stays where
     it was — it may be a "-" morpheme boundary, which is not this helper's to reinterpret — and the newly
     created boundary takes ".", the same one the append branch has always used. */
  const before=toks.slice(0,insertAt).join(""), after=toks.slice(insertAt).join("");
  if(insertAt>=toks.length) return lead+(before?before+"."+ab:ab)+trail;   // nothing outranked it
  return lead+(before?before+ab:ab)+"."+after+trail; }                     // …else `after` is non-empty by construction (it starts at the displaced token)
function isCompoundFeat(featsStr){ return /(^|\|)Compound=Yes(\||$)/.test(featsStr||""); }   // FEATS Compound=Yes → this token glues onto the NEXT compound member. Drives sanskritCompoundGroups' MWT auto-grouping (Sanskrit-only — a display/tokenisation choice specific to how this app handles Sanskrit samāsa). It does NOT drive the MSeg marker: that follows MWT membership itself (msegGlued) — which, for a freshly parsed Sanskrit sentence, is exactly what this feature has just produced
// Cache each SEAM's mark on the token that carries it — `_seamPost` (drawn after that token) or `_seamPre` (before
// it), per seamOwner; see the MSEG_MARK/MORPH_MARK note in prefs.js for which mark a seam takes ("-" at an mSUD
// "/m" morpheme seam, else "=" at a multi-word-token seam). Also — in Sanskrit — take the FEATS reading that
// follows from a token being a non-final MWT member. Both are STRUCTURAL, moving with grouping, ungrouping,
// splitting, flattening, a token inserted or deleted, a relation re-attached, a UPOS changed, or an auto-regroup
// after a parse, so this runs from renderDoc (msegFlagDoc) rather than from each of the dozen places that reach
// into s.mwt or the heads. Neither markDirty: the mark is transient decoration, and the Sanskrit feature is
// derived from a grouping the user already made (that grouping is the real, dirty-marking edit).
// Every GOESWITH UNIT in the sentence, as {h, last} in 1-based token ids: the head, and the last of the maximal run
// of tokens immediately after it that are all attached to it by `goeswith`. Deliberately the SAME run foldGoesWith
// draws as one cell (js/diagram/diagram-core.js) — computed here from the sentence rather than shared, because that
// fold runs on a DISPLAY list (merge-punctuation may already have folded it once) while this runs on the sentence's
// own tokens; keeping the shape identical is what makes "the seams the slur spans" and "the seams suppressed here"
// the same set. A goeswith whose head is not the token it directly follows forms no unit, exactly as it draws none.
function goesWithUnits(s){ const t=(s&&s.tokens)||[], out=[];
  for(let i=0;i<t.length;i++){ let j=i+1;
    while(j<t.length && isGoesWith(t[j].deprel) && parseInt(t[j].head,10)===i+1) j++;
    if(j>i+1){ out.push({h:i+1,last:j}); i=j-1; } }   // tokens i+2 … j are the continuations; resume the scan past them
  return out; }
// Is the seam between token k and k+1 INTERNAL to a goeswith word? True for every seam a unit spans — h … last-1 —
// i.e. exactly the seams the slur already spans. A goeswith pair is emphatically NOT an MWT, so this cannot be
// folded into msegGlued: it is a separate reason a seam carries no mark, and the only one that survives the pair
// ALSO happening to sit inside an MWT range or an mSUD morph group.
function goesWithSeam(s,k){ return goesWithUnits(s).some(u=>k>=u.h&&k<u.last); }
function msegFlagSent(s){ if(!s||!s.tokens) return; const skt=isSanskritLang(), mseams=morphSeams(s);
  const gwu=goesWithUnits(s), gwIn=k=>gwu.some(u=>k>=u.h&&k<u.last);   // computed ONCE per sentence; goesWithSeam() is the same test, re-derived per call for callers that have no loop to hoist it out of
  s.tokens.forEach(t=>{ t._seamPost=""; t._seamPre=""; t._seamMid=""; t._seamPostK=0; t._seamPreK=0; t._seamMidK=0; });   // cleared first: a seam that has just moved (or gone) must leave no mark behind on the token that used to hold it
  for(let k=1;k<s.tokens.length;k++){   // seam k = the join between token k and token k+1
    if(gwIn(k)) continue;   // A GOESWITH SEAM TAKES NO MARK AT ALL. The relation says these tokens are one word broken by a stray space, and its rendering marks that with the grey slur and nothing else (see the goeswith block in js/diagram/diagram-core.js) — a "꞊" hung in the same gap would state the same fact a second time, in the vocabulary of a DIFFERENT fact (a word fused into one orthographic token, or split into morphemes), so the pair would read as an MWT or an mSUD morph group. Gated HERE, where the mark is emitted, deliberately in preference to teaching seamOwner about goeswith: seamOwner answers "which of the two tokens does this boundary belong to", and every answer it can give is wrong for a seam that is to carry no mark — adding goeswith to ASYM_FAM, say, would only move the mark onto the head instead of suppressing it. See the note beside those rules in js/core/prefs.js.   // AND IT WINS OVER BOTH KINDS OF MARK, INCLUDING INSIDE AN MWT RANGE OR AN mSUD MORPH GROUP. That is what makes this an override rather than a default: seamOwner's rule 1 ("a '/m' member's mark faces its group head, ALWAYS") is otherwise inviolable, and `continue` here is placed BEFORE the mark is even chosen so neither that rule nor msegGlued ever gets to speak for a seam inside one word. The case is real — a goeswith pair CAN sit inside an MWT range (the range fuses the surrounding orthography; the stray space inside the word is a different fact about the same stretch) and inside a "/m" group (a "/m" edge that spans the pair marks every seam it crosses, this one included). Both would otherwise have hung a "꞊" or a "-" between two halves of one word.
    const mark=mseams.has(k)?MORPH_MARK:(msegGlued(s,k)?MSEG_MARK:"");   // the morpheme boundary wins where both apply: an mSUD word split into morphemes is typically an MWT range too, and what its internal seams ARE is morpheme boundaries
    if(!mark) continue;
    const owner=seamOwner(s,k);
    // …and cache the SEAM INDEX beside the mark. A mark's placement already implies it (a post/mid mark on token k
    // is seam k, a pre mark on token k+1 is seam k too), but the renderers draw from FOLDED DISPLAY arrays and hand
    // svgSeamMark/htmlSeamMark the token OBJECT alone, with no id in reach — so the pair of tokens the mark joins
    // has to ride along on the object, exactly as the mark itself does. It is what the drawn element publishes as
    // data-seam-toks, and what applySel reads to give the mark the selection accent (see its own note there).
    if(owner===k){ s.tokens[k-1]._seamPost=mark; s.tokens[k-1]._seamPostK=k; }
    else if(owner===k+1){ s.tokens[k]._seamPre=mark; s.tokens[k]._seamPreK=k; }
    else { s.tokens[k-1]._seamMid=mark; s.tokens[k-1]._seamMidK=k; } }   // belongs to neither → held by the first, drawn between the two
  // …AND THE OTHER HALF OF "GOESWITH WINS": a mark that belongs to a CONTINUATION is re-hung on the unit's HEAD.
  // The continuation is folded off the display token list, so nothing ever draws from it — a mark left there is
  // simply lost, and the seam between the last part of a goeswith word and the next token (a genuine MWT/morph
  // seam, OUTSIDE the word, which must still be marked) vanished exactly when seamOwner happened to award it to
  // that part or to neither token (owner 0 leaves the mark on the earlier of the two, which is the part). The head
  // is where it belongs anyway: the head's form element is what draws the WHOLE unit — svgFormSeamMark measures its
  // half-width with fmeas(), which reports the unit's full width — so a post/mid mark hung on the head lands past
  // the last part's ink, which is precisely where that seam is. Only post/mid can survive to here: a PRE mark on a
  // part, and a post/mid on any part but the last, name a seam the loop above already suppressed as internal.
  gwu.forEach(u=>{ const head=s.tokens[u.h-1]; if(!head) return;
    for(let p=u.h+1;p<=u.last;p++){ const x=s.tokens[p-1]; if(!x) continue;
      if(x._seamPost){ head._seamPost=x._seamPost; head._seamPostK=x._seamPostK; x._seamPost=""; x._seamPostK=0; }
      if(x._seamMid){ head._seamMid=x._seamMid; head._seamMidK=x._seamMidK; x._seamMid=""; x._seamMidK=0; }
      if(x._seamPre){ x._seamPre=""; x._seamPreK=0; } } });   // (defensive: an internal seam can leave none, and a mark drawn at the START of a continuation would sit inside the word)
  s.tokens.forEach((t,ti)=>{ const glued=msegGlued(s,ti+1);
    // a non-final compound member with no grammatical features of its own is exactly what Compound=Yes describes —
    // an uninflected stem continuing into the next member. The reading follows the evidence BOTH ways: inflection
    // appearing on the token, or the token ceasing to be a non-final member, withdraws it again.
    if(skt){ const want=glued&&!hasInflFeat(t.feats);
      if(want!==isCompoundFeat(t.feats)) t.feats=want?setFeat(t.feats,"Compound","Yes"):clearFeat(t.feats,"Compound"); } }); }
function msegFlagDoc(){ DOC.forEach(msegFlagSent); }
// UD's INFLECTIONAL features (universaldependencies.org/u/feat — its nominal and verbal inflectional groups), as
// against its LEXICAL ones (PronType, NumType, Poss, Reflex, Foreign, Abbr, Typo). Only inflection speaks to
// whether a token is an uninflected compound member: a lexical property, an ExtPos, the SUD gesture features
// (Shared/Subject), Compound itself or a custom key all say nothing either way and don't count against it.
// Deliberately its OWN list rather than FEATS_CAT's: that grouping is for the autocomplete dropdown, and its
// catch-all "Other" bucket holds inflectional categories (Person, Polarity, Degree, Evident, Deixis, Polite,
// Clusivity) and non-inflectional ones (Reflex, Abbr, Typo, Foreign, ExtPos) side by side.
const INFL_FEATS=new Set(["Gender","Animacy","NounClass","Number","Case","Definite","Deixis","DeixisRef","Degree",   // nominal
  "VerbForm","Mood","Tense","Aspect","Voice","Evident","Polarity","Person","Polite","Clusivity"]);                   // verbal
function hasInflFeat(featsStr){ return (featsStr&&featsStr!=="_"?featsStr.split("|"):[])
  .some(fv=>{ const i=fv.indexOf("="); return i>0&&INFL_FEATS.has(fv.slice(0,i)); }); }
// FEATS saying this token's form is NOT an inflected word form but a bound stem or reduced form standing in for
// one: Compound=Yes (a non-final compound member — an uninflected stem, see msegFlagSent) and the construct /
// annexation states (Definite=Cons, and Arabic improper annexation Definite=Com). What such a form does NOT do is
// realise the lexeme's inherent categories, so nothing may record one on it from lexical evidence alone — see
// applyWiktionaryDef, where a picked Wiktionary sense's gender is dropped rather than written to a stem.
const UNINFLECTED_FEATS=[["Compound","Yes"],["Definite","Cons"],["Definite","Com"]];
function isUninflectedForm(featsStr){ return UNINFLECTED_FEATS.some(([f,v])=>hasFeat(featsStr,f,v)); }
// add/update ONE Feat=Val in a "|"-joined FEATS string, keeping it ALPHABETICAL by feature name (the CoNLL-U
// spec's own requirement — see the MGLOSS_FEAT_ORDER comment for why MGloss's order is deliberately independent
// of this). Used by regenSecondaries' gesture-FEATS restore and mglossSyncFeats; general enough for any other
// single-feature set/clear that needs to preserve the alphabetical invariant.
function setFeat(featsStr,name,val){ const cur=(featsStr&&featsStr!=="_")?featsStr.split("|").filter(Boolean):[];
  const idx=cur.findIndex(s=>s.slice(0,s.indexOf("="))===name), fv=name+"="+val;
  if(idx>=0) cur[idx]=fv; else cur.push(fv);
  cur.sort((a,b)=>a.slice(0,a.indexOf("=")).localeCompare(b.slice(0,b.indexOf("="))));
  return cur.join("|")||"_"; }
function clearFeat(featsStr,name){ const cur=(featsStr&&featsStr!=="_")?featsStr.split("|").filter(Boolean):[];
  return cur.filter(s=>s.slice(0,s.indexOf("="))!==name).join("|")||"_"; }
// item 1: Subj only ever lives on a VERB/AUX (it marks a predicate whose subject is raised/shared) — call this
// right after ANY UPOS change so a token retagged away from VERB/AUX can't keep a now-meaningless Subj value.
function clearSubjIfNotVA(t){ if(t.upos!=="VERB"&&t.upos!=="AUX"&&raiseGet(t,"Subject")) raiseSet(t,"Subject",""); }   // Subject lives on a PREDICATE, so a token retagged away from VERB/AUX must not keep it
// a Shared=Yes dependent must stay attached to a conj relation's head to keep the marker meaningful — call
// this right after ANY reparent (t.head just changed) with the token's sentence, so a rehead onto a token whose
// deprel isn't conj-based (or onto no token at all, e.g. head 0) drops the now-stale Shared=Yes.
function syncSharedFeat(t,s){ if(!hasFeat(t.feats,"Shared","Yes"))return;
  const hid=parseInt(t.head,10), head=(s&&hid>=1&&hid<=s.tokens.length)?s.tokens[hid-1]:null;
  if(head&&famOf(head.deprel)==="conj")return;
  t.feats=clearFeat(t.feats,"Shared"); }
// item 13 — EFFECTIVE forward map = built-in FEATS_GLOSS overlaid with the user's custom mappings (PREFS.glossMap; custom
// wins). GLOSS_FEATS is its inverse (abbreviation → list of Feat=Val that produce it). Some abbreviations are AMBIGUOUS
// (reachable from >1 Feat=Val, e.g. INV←Number=Inv/Voice=Inv, NEG←Polarity=Neg/PronType=Neg, EQU←Case=Equ/Degree=Equ,
// DISTR←Case=Dis/NumType=Dist, INDF←Definite=Ind/PronType=Ind, RECP←Voice=Rcp/PronType=Rcp): we keep every candidate but
// treat as auto-applicable ONLY the UNAMBIGUOUS ones (exactly one candidate). rebuildGlossMaps() re-derives BOTH whenever
// the custom mappings change (the mapping editor / boot) so edits take effect immediately.
let EFF_FEATS_GLOSS={}, GLOSS_FEATS={};
/* Task C — the MGloss autocomplete's inventory, derived from GLOSS_FEATS (this module's own effective
   Feat=Val→abbreviation map, EFF_FEATS_GLOSS/GLOSS_FEATS just above) rather than a second, hand-written table —
   there is exactly one source of truth for what a gloss abbreviation MEANS, and it already lives here. Rebuilt
   whenever GLOSS_FEATS changes (a custom PREFS.glossMap edit), from rebuildGlossMaps below. */
let MGLOSS_AC_ITEMS=[];
// item 14 — LEIPZIG-STYLE terse expansion: FEATS_VDESC entries are written for the FEATS pill editor's own dropdown
// (js/grid/grid.js), where a value gets ONE row and room for a full phrase; here every candidate reading of a
// (possibly ambiguous) abbreviation has to fit on one dropdown row, so keep only the FIRST sense — drop everything
// from " / " (alternate wordings, e.g. Case=Acc's "accusative / oblique"), "(", "," or ";" onward — mirroring
// context-menu.js's own shortVDesc (same job, for the POS-subtype flyout's one-column width) but kept as a LOCAL
// copy rather than a cross-file call: mglossAbbrevExpand runs eagerly off rebuildGlossMaps() at the bottom of this
// module, and io/bridge.js has no business depending on editing/context-menu.js for something this small.
function mglossShortDesc(s){ if(!s) return ""; s=s.replace(/^it is (an?|the) /i,"").replace(/^it is /i,"");
  return s.split(/\s*[\/(,;]/)[0].trim(); }
function mglossAbbrevExpand(ab){ const cands=GLOSS_FEATS[ab]; if(!cands||!cands.length) return "";
  const seen=new Set(), parts=[];
  cands.forEach(fv=>{ const eq=fv.indexOf("="), f=fv.slice(0,eq), v=fv.slice(eq+1), raw=(FEATS_VDESC[f]||{})[v];
    const short=raw?mglossShortDesc(raw):"", text=short?(short.charAt(0).toUpperCase()+short.slice(1)):(f+"="+v);
    if(seen.has(text))return; seen.add(text); parts.push(text); });   // an ambiguous abbreviation whose candidates share one short reading (most of them do — NEG, EQU, INDF, RECP, DISTR) shows it ONCE rather than repeating it
  return parts.join("/"); }   // e.g. "PL" → "Plural"; an ambiguous abbreviation (see GLOSS_FEATS' own note) shows every DISTINCT candidate reading, "/"-joined with NO surrounding spaces — never " / " (Leipzig glossing lists such as eva.mpg.de/lingua/resources/glossing-rules.php use bare slashes)
// which category heading (js/grid/grid.js's acShowGrouped) an abbreviation's dropdown row falls under — the Feat
// NAME of its (dis-)ambiguated candidate, exactly as mglossFeatNameFor resolves it elsewhere (ties fall back to the
// first candidate), so grouping and disambiguation never disagree about what an abbreviation "is". "Word class"
// is not a FEATS category at all — it's the two UPOS_LEIPZIG_ABBR prefixes (AUX/DET), which is why they're tagged
// separately below rather than through this function.
function mglossAbbrevCat(ab){ return mglossFeatNameFor(ab)||"Other"; }
// category display order: the two UPOS prefixes lead (they lead the gloss ITSELF too — see featsToGloss), then
// every FEATS category in MGLOSS_FEAT_ORDER — the SAME order the abbreviations are sequenced in inside one MGloss
// string, reused here rather than inventing a second ordering for the same set of names.
const MGLOSS_AC_CATS=["Word class"].concat(MGLOSS_FEAT_ORDER);
// group an MGLOSS_AC_ITEMS-shaped list (ab/expand/cat) into {title,items:[ab,…]} for acShowGrouped — shared by
// both dropdown call sites (the diagram's makeGlossEditableSC and the grid pill editor's openIeAC) so the category
// order and the "leftover" bucket name can't drift between them.
function mglossAcGroups(ms){ const groups=[], seen=new Set();
  MGLOSS_AC_CATS.forEach(cat=>{ const gi=ms.filter(x=>x.cat===cat); gi.forEach(x=>seen.add(x.ab)); if(gi.length)groups.push({title:cat,items:gi.map(x=>x.ab)}); });
  const rest=ms.filter(x=>!seen.has(x.ab)); if(rest.length)groups.push({title:"Other",items:rest.map(x=>x.ab)});   // a custom PREFS.glossMap entry for a Feat outside MGLOSS_FEAT_ORDER — see mglossFeatRank's own matching fallback
  return groups; }
function rebuildMglossAcItems(){ const seen=new Set(), out=[];
  Object.keys(GLOSS_FEATS).sort().forEach(ab=>{ if(seen.has(ab))return;
    if(GLOSS_FEATS[ab].every(fv=>fv.startsWith("ExtPos=")))return;   // item 16: ExtPos names an EXPRESSION's word class (ADJ/ADP/…/AUX/DET/…/SCONJ) for a multi-word functional unit — not an inflectional/grammatical feature, so it doesn't belong in a MORPHEMIC gloss dropdown. (No current abbreviation is ambiguous between ExtPos and a real feature, so "every candidate is ExtPos" and "any candidate is ExtPos" coincide today; the `.every` reads correctly either way if that ever changes.) The two closed-class UPOS prefixes a token's OWN gloss actually leads with, AUX/DET, are still offered — via UPOS_LEIPZIG_ABBR below, which is what previously lost the "AUX"/"DET" abbreviation slots to this very ExtPos entry (seen already had them) and is now free to claim them, landing them in "Word class" instead of here
    seen.add(ab); out.push({ab,expand:mglossAbbrevExpand(ab),cat:mglossAbbrevCat(ab)}); });
  Object.entries(UPOS_LEIPZIG_ABBR).forEach(([upos,ab])=>{ if(seen.has(ab))return; seen.add(ab);   // the two closed-class UPOS prefixes (AUX/DET) are abbreviations a user can type here too, even though they aren't FEATS-derived — see retargetGlossForUposChange
    out.push({ab,expand:(typeof UPOS_INFO==="object"&&UPOS_INFO&&UPOS_INFO[upos])||upos,cat:"Word class"}); });
  MGLOSS_AC_ITEMS=out; }
// which FEATS category (e.g. "Number") an abbreviation's chosen candidate names, for insertGlossAbbrevAtRank's
// rank lookup — mirrors glossToFeats' own resolve() (an ambiguous abbreviation is disambiguated by the token's
// UPOS via AMBIG_UPOS; ties fall back to the first candidate, same as glossToFeats does when UPOS doesn't settle it).
function mglossFeatNameFor(ab,upos){ const cands=GLOSS_FEATS[ab]; if(!cands||!cands.length) return null;
  if(cands.length===1) return cands[0].slice(0,cands[0].indexOf("="));
  if(upos){ const fit=cands.filter(fv=>(AMBIG_UPOS[fv]||[]).includes(upos)); if(fit.length===1) return fit[0].slice(0,fit[0].indexOf("=")); }
  return cands[0].slice(0,cands[0].indexOf("=")); }
// Accept an MGloss autocomplete pick at `caret` within `mg`: drop the PARTIAL abbreviation the user was mid-
// typing (the run of non-separator characters ending at the caret — wherever it is, not just at the string's
// end), then re-insert the CHOSEN, complete abbreviation via insertGlossAbbrevAtRank — its canonical slot per
// MGLOSS_FEAT_ORDER, hyphen/dot-joined correctly with whatever else is already in the field — rather than
// leaving it wherever the raw caret happened to be. Returns {mg, caret} (the caret placed just after the
// inserted abbreviation, at the join with the un-touched tail).
function mglossAcAccept(mg,caret,ab,upos){
  const left=mg.slice(0,caret), right=mg.slice(caret);
  const partial=(/[^.\-]*$/.exec(left)||[""])[0];
  const stem=left.slice(0,left.length-partial.length).replace(/[.\-]$/,"");   // insertGlossAbbrevAtRank re-adds its own separator
  let newStem;
  if(ab==="AUX"||ab==="DET") newStem = stem?ab+"."+stem:ab;   // the closed-class UPOS prefix always leads, never through the rank table (see featsToGloss/retargetGlossForUposChange)
  else { const featName=mglossFeatNameFor(ab,upos);
    newStem = featName ? insertGlossAbbrevAtRank(stem,featName,ab) : (stem?stem+"."+ab:ab); }   // no FEATS category resolved (shouldn't happen for anything MGLOSS_AC_ITEMS offers) → the same append fallback insertGlossAbbrevAtRank itself uses
  const joiner = right && !/^[.\-]/.test(right) ? "." : "";   // reconnect an untouched tail (the caret was mid-string) with a category separator, unless it already starts with one
  return {mg:newStem+joiner+right, caret:newStem.length}; }
/* Replace the abbreviation run at position `idx` — counting ABBREVIATION RUNS ONLY, in reading order —
   with `ab`, leaving every other character of the gloss (its dots, its hyphens, its lexical stem) exactly
   where it was. `idx` is what the renderer already knows: setGlossText (js/core/prefs.js) wraps each run
   in its own .glabbr node, so the nth such node IS the nth run glossAbbrSegments finds, and the caller
   can name the one that was clicked without matching on its text — which two identical abbreviations in
   one gloss ("3SG.M.GEN" beside another GEN) would make ambiguous. Substituting in place rather than
   going through insertGlossAbbrevAtRank, because this is not an insertion: the slot is already the
   reader's, and re-ranking would move a value they had deliberately put somewhere else. */
function mglossReplaceAbbrevIdx(mg,idx,ab){ let n=-1;
  return glossAbbrSegments(mg||"").map(([t,isAb])=>{ if(!isAb) return t; n++; return n===idx?ab:t; }).join(""); }
function rebuildGlossMaps(){ EFF_FEATS_GLOSS=Object.assign({},FEATS_GLOSS,(typeof PREFS==="object"&&PREFS&&PREFS.glossMap)||{});
  GLOSS_FEATS={}; for(const fv in EFF_FEATS_GLOSS){ const ab=EFF_FEATS_GLOSS[fv]; if(!ab)continue; (GLOSS_FEATS[ab]||(GLOSS_FEATS[ab]=[])).push(fv); }
  rebuildMglossAcItems(); }
rebuildGlossMaps();
// item 12: the Gloss Mappings window (a separate native window) pushes its saved custom overrides back here
// via evaluate_js, so editing a mapping there immediately changes gloss pre-fill + back-mapping in the document.
window.__glossMapChanged=function(custom){ try{ PREFS.glossMap=(custom&&typeof custom==="object")?custom:{}; rebuildGlossMaps();
  if(typeof DOC!=="undefined"&&DOC.length&&typeof preserveScroll==="function")preserveScroll(renderDoc); }catch(e){} };
// UPOS sets that disambiguate an otherwise-ambiguous Leipzig abbreviation between its candidate Feat=Val meanings.
// A verb/aux/particle can't BE a pronoun, so NEG on such a token can only be Polarity=Neg; on a PRON/DET it can
// only be PronType=Neg — the two features' real UPOS ranges (per each feature's own page at
// universaldependencies.org/u/feat/*) only genuinely overlap on ADV (French-style "pas" is ADV+Polarity=Neg,
// English "never" is ADV+PronType=Neg — both real), so ADV is deliberately left off BOTH sets below and stays
// unresolved, same as before. Each entry lists the UPOS tags where that SPECIFIC value (not just the feature in
// the abstract) is actually attested — narrower than each feature's full documented range, which usually also
// allows rarer "borderline" UPOS (e.g. Case sometimes marks agreement on a verb) that would otherwise force
// every ambiguous pair back into permanent overlap.
const AMBIG_UPOS={
  "Polarity=Neg":["VERB","AUX","PART"], "PronType=Neg":["PRON","DET"],
  "Definite=Ind":["NOUN","PROPN"], "PronType=Ind":["PRON","ADV"],
  "Voice=Rcp":["VERB","AUX"], "PronType=Rcp":["PRON","DET"],
  "Case=Dis":["NOUN","PROPN","PRON","ADJ"], "NumType=Dist":["NUM","DET"],
  "Case=Equ":["NOUN","PROPN","PRON","DET","NUM"], "Degree=Equ":["ADJ","ADV"],
  "Number=Inv":["NOUN","PROPN","PRON","DET","ADJ","NUM"], "Voice=Inv":["VERB","AUX"],
};
// a Person abbreviation ("1"/"2"/"3"/"4" by default, but derived from GLOSS_FEATS so a custom PREFS.glossMap
// override is honoured too) immediately followed by a Number abbreviation ("SG"/"PL"/…), with NO separating dot
// — "3SG", not "3.SG" — is a single fused token that still names TWO features (see featsToGloss's matching
// no-dot join on generation). Tried only as a FALLBACK, once the whole token has already failed a direct
// GLOSS_FEATS lookup, so it never misfires on some OTHER abbreviation that merely happens to start with a digit.
function splitPersonNumber(tok){
  for(const pab in GLOSS_FEATS){ if(!GLOSS_FEATS[pab].every(fv=>fv.startsWith("Person=")))continue;
    if(tok.length>pab.length && tok.startsWith(pab)){ const rest=tok.slice(pab.length);
      if(GLOSS_FEATS[rest]&&GLOSS_FEATS[rest].every(fv=>fv.startsWith("Number="))) return [pab,rest]; } }
  return null; }
// INVERSE Leipzig gloss → FEATS "to the extent possible": split an MGloss on "." and "-" (category + morpheme
// separators), look each token up in GLOSS_FEATS, and collect the UNAMBIGUOUS Feat=Val pairs — "unambiguous"
// now meaning either a single candidate outright, OR (given the token's own UPOS) exactly one candidate whose
// AMBIG_UPOS set contains that UPOS. Still-ambiguous or unknown gloss tokens are left un-mapped (we can't recover
// which feature the user meant).
function glossToFeats(glossStr,upos){ const out=[]; if(!glossStr) return out;
  const resolve=tok=>{ const cands=GLOSS_FEATS[tok]; if(!cands)return false;
    if(cands.length===1){ out.push(cands[0]); return true; }
    if(!upos)return true; const fit=cands.filter(fv=>(AMBIG_UPOS[fv]||[]).includes(upos)); if(fit.length===1)out.push(fit[0]); return true; };
  glossStr.split(/[.\-]/).forEach(tok=>{ tok=tok.trim(); if(!tok)return;
    if(resolve(tok))return;
    const pn=splitPersonNumber(tok); if(pn) pn.forEach(resolve); }); return out; }
// SYNC a token's FEATS from its MGloss: for every unambiguous glossing abbreviation recognised in the CURRENT
// MGloss text, set that feature to the matching value — updating it if the feature is already present with a
// DIFFERENT value (so re-glossing PST → PRS retargets Tense=Past to Tense=Pres), adding it if absent. A feature
// with no corresponding glossing abbreviation (unmapped, or just not mentioned in this MGloss) is left untouched —
// this never removes or invents a value for anything the gloss text doesn't actually speak to. The token's own
// UPOS (passed through to glossToFeats) resolves most of the otherwise-ambiguous abbreviations (NEG, INDF, RECP,
// CAUS, CMPR, INT, DISTR, EQU, INV) — e.g. a PRON can't be Polarity=Neg, so NEG on one can only mean PronType=Neg.
function mglossSyncFeats(tk){ const adds=glossToFeats(tierText(tk,"mgloss"),tk.upos); if(!adds.length) return false;
  const cur=(tk.feats&&tk.feats!=="_")?tk.feats.split("|").filter(Boolean):[];
  const before=cur.join("|");
  const idx={}; cur.forEach((s,i)=>{ const e=s.indexOf("="); if(e>0)idx[s.slice(0,e)]=i; });   // feature name → its index in cur, for an in-place update
  let changed=false;
  adds.forEach(fv=>{ const f=fv.slice(0,fv.indexOf("="));
    if(f in idx){ if(cur[idx[f]]!==fv){ cur[idx[f]]=fv; changed=true; } }
    else { idx[f]=cur.length; cur.push(fv); changed=true; } });
  // FEATS stays ALPHABETICAL by feature name (the CoNLL-U spec's own requirement) — it no longer follows
  // MGloss's order (that bidirectional order-sync was removed; MGloss has its own canonical order, see
  // MGLOSS_FEAT_ORDER/featsToGloss, entirely independent of however FEATS happens to be sequenced).
  cur.sort((a,b)=>a.slice(0,a.indexOf("=")).localeCompare(b.slice(0,b.indexOf("="))));
  const ordered=cur.join("|");
  if(ordered!==before) changed=true;
  if(changed) tk.feats=ordered; return changed; }
// The OTHER direction of the same VALUE sync: when FEATS changes, retarget the morphemic gloss's EXISTING
// abbreviation for whichever feature category changed (Tense=Past→Tense=Pres retargets an existing "PST" in
// MGloss to "PRS"; removing Tense drops "PST" outright) — mirrors mglossSyncFeats's restraint by never inventing
// a gloss for a feature that wasn't already glossed, it only retargets/drops an abbreviation already present.
// `oldFeatsStr` is the token's FEATS value from just before this edit (the caller already has it — the pre-edit
// value it's diffing against). Only runs once the morphemic tier exists (MORPH_ON); no-ops if the token has no
// MGloss yet. VALUES only — MGloss's own slot ORDER is never touched here (MGLOSS_FEAT_ORDER governs it, not
// FEATS' order, which is alphabetical and carries no ordering information worth propagating).
// pure core of the retarget: given an mg STRING (not a token), which abbreviations change between oldFeatsStr and
// newFeatsStr. Extracted so regenSecondaries (Task B) can reuse the exact same non-destructive retarget for a
// background re-parse's own FEATS changes, without featsSyncGloss's MORPH_ON gate (a reparse must preserve an
// EXISTING MGloss regardless of whether the morph tier happens to be displayed right now — see regenSecondaries'
// own comment).
/* ⚠ AND IT IS SYMMETRIC: a value that CHANGED is retargeted, a feature that was REMOVED is dropped, and a
   feature that was ADDED is inserted. That third case used to be missing on purpose — "never invents an
   abbreviation for a feature that had none before" — on the reasoning that a category absent from the gloss
   was absent by choice. That reasoning does not survive `FEATS_GLOSS` becoming total: 201 of the 205 UD
   feature values carry exactly one abbreviation, and the four that do not (`Typo`, `Foreign`, and SUD's own
   `Shared`) are bookkeeping that is deliberately unglossable. With a one-to-one mapping, an absent
   abbreviation for a feature the token HAS is not a choice, it is a gap — and the asymmetry showed as one:
   setting `Number=Plur` on a token glossed `dog` left `dog`, while changing it to `Number=Sing` afterwards
   would have had nothing to retarget either, so the category could never enter the gloss at all.
   ⚠️ IT REMAINS SCOPED TO WHAT THIS EDIT CHANGED, which is the difference between this and a rebuild. A
   feature whose value did not move is not touched, so a gloss the annotator has trimmed by hand stays
   trimmed until they edit that very feature — and toggling `Foreign` on a token still moves nothing, as
   the comments at its call sites promise, because that feature has no abbreviation to insert. */
function retargetGlossForFeatsChange(mg,oldFeatsStr,newFeatsStr,upos){ if(!mg) return mg;
  const splitFV=s=>{ const m={}; (s&&s!=="_"?s.split("|"):[]).forEach(fv=>{ const e=fv.indexOf("="); if(e>0)m[fv.slice(0,e)]=fv; }); return m; };
  const oldMap=splitFV(oldFeatsStr), newMap=splitFV(newFeatsStr);
  let out=mg;
  for(const feat in oldMap){ if(newMap[feat]===oldMap[feat]) continue;   // this feature is unchanged → its gloss (if any) is still correct
    const oldAb=EFF_FEATS_GLOSS[oldMap[feat]]; if(!oldAb) continue;   // the old value had no gloss abbreviation → nothing to retarget
    const newAb=newMap[feat]?EFF_FEATS_GLOSS[newMap[feat]]:null;   // null → the feature was removed outright, or its new value has no gloss
    out=retargetGlossAbbrev(out,oldAb,newAb); }
  /* Every feature THIS EDIT TOUCHED then ends up glossed, whether the loop above found an abbreviation to
     move or not: a category the token did not carry before has none by definition, and one whose
     abbreviation the annotator had deleted has none either — and "the value you just changed is not in the
     gloss" is the same gap in both cases. `mglossAddFeats` skips whatever is already there, so a feature the
     retarget handled is not touched twice. */
  const touched=Object.keys(newMap).filter(f=>newMap[f]!==oldMap[f]);
  return touched.length?mglossAddFeats(out,newFeatsStr,upos,touched):out; }
/* ── INSERTING THE ABBREVIATION FOR A CATEGORY THE GLOSS DOES NOT YET SPEAK FOR ─────────────────
   Scoped to the `feats` it is handed — the ones the caller's edit actually added — never the whole
   FEATS string, so this stays an edit-driven sync and not a rebuild.

   ⚠ ADDITIVE, AND THAT IS THE WHOLE REASON IT IS NOT `composeMGloss`. Every abbreviation, hyphen and
   dot already in the gloss stays exactly where the annotator (or a prior parse) put it, so a
   hand-placed morpheme boundary and a hand-added abbreviation no FEATS value implies both survive —
   which is precisely what Task B recorded a wholesale rebuild as having destroyed. Measured: on a
   token whose MGloss is the ordinary auto-generated one, the result is byte-identical to a fresh
   `composeMGloss`, so the common case is canonical and only a hand-edited gloss is treated more
   gently than a rebuild would treat it. */
function mglossFeatsPresent(mg,upos){ const out=new Set();
  (mg||"").split(/[.\-]/).filter(Boolean).forEach(tok=>{ if(!GLOSS_ABBR_TOK_RE.test(tok)) return;   // a lexical stem names no category
    const pn=splitPersonNumber(tok);   // a FUSED "3SG" speaks for Person AND Number — neither may be re-inserted beside it
    (pn||[tok]).forEach(part=>{ const f=mglossFeatNameFor(part,upos); if(f) out.add(f); }); });
  return out; }
function mglossAddFeats(mg,featsStr,upos,feats){ const have=mglossFeatsPresent(mg,upos); let out=mg||"";
  const fvs=(featsStr&&featsStr!=="_")?featsStr.split("|"):[];
  const abOf=f=>{ const fv=fvs.find(x=>x.slice(0,x.indexOf("="))===f); return fv?EFF_FEATS_GLOSS[fv]:null; };
  const want=(feats||[]).filter(f=>!have.has(f)&&abOf(f));   // already glossed, or unglossable (Typo/Foreign/Shared) → nothing to do
  if(!want.length) return out;
  /* Person and Number are written FUSED by featsToGloss ("3SG", not "3.SG"), so agreement has to arrive as
     ONE token or this path would spell it in the one shape the rest of the app never produces. Three cases,
     because the half already in the gloss keeps its own slot: both arriving → one fused insert; one arriving
     beside a partner already there → fuse ONTO that partner where it stands, rather than inserting the new
     half beside it, which is what produced `walk-3.SG` from a hand-segmented `walk-SG`. A fuse that does not
     fire (the partner is hand-spelt as something EFF_FEATS_GLOSS does not name) falls through to the
     ordinary insert below. */
  const pAb=abOf("Person"), nAb=abOf("Number"), wantP=want.includes("Person"), wantN=want.includes("Number");
  if(pAb&&nAb&&wantP&&wantN){ out=insertGlossAbbrevAtRank(out,"Person",pAb+nAb); have.add("Person"); have.add("Number"); }
  else if(pAb&&nAb&&wantP&&have.has("Number")){ const f=retargetGlossAbbrev(out,nAb,pAb+nAb); if(f!==out){ out=f; have.add("Person"); } }
  else if(pAb&&nAb&&wantN&&have.has("Person")){ const f=retargetGlossAbbrev(out,pAb,pAb+nAb); if(f!==out){ out=f; have.add("Number"); } }
  want.forEach(f=>{ if(have.has(f)) return; out=insertGlossAbbrevAtRank(out,f,abOf(f)); have.add(f); });
  return out; }
/* …and the LEXICAL half follows the retag too, because whether a token has one at all is a question
   about its word class. Every builder in this file writes the stem gloss into MGloss only for an OPEN
   class — `(GLOSS_ON && !UPOS_LEIPZIG_ABBR[t.upos]) ? Gloss : ""` — since a closed-class tag already
   carries its own Leipzig abbreviation (AUX/DET) and its meaning is that abbreviation, not a
   definition. So a retag ACROSS that boundary has to add or drop the stem, and neither
   `retargetGlossForFeatsChange` nor `retargetGlossForUposChange` can: FEATS says nothing about a stem,
   and the UPOS retarget only ever moves the prefix. Left alone, retagging VERB → AUX left the stem
   stranded behind the newly-prepended prefix (`dog.SG` → `AUX.dog.SG`) and AUX → VERB left the token
   with no stem gloss at all where a fresh parse would have given it one.
   An existing lexical part is never rewritten — only supplied where the class now wants one and there
   is none, so an annotator's own wording survives a retag exactly as their abbreviations do. */
function mglossReglossLexical(tk,mg){
  if(UPOS_LEIPZIG_ABBR[tk.upos]) return keepGlossAbbrevs(mg);   // closed class → the stem belongs to the Gloss tier (rebuildGlossTokens keeps the attachment marks)
  if(mglossLexicalPart(mg)) return mg;
  const lex=GLOSS_ON?miscKV(tk.misc,"Gloss").replace(/-/g,"_"):"";   // the same cross-tier prefill every other builder here uses
  return lex?(mg?lex+"."+mg:lex):mg; }
function featsSyncGloss(tk,oldFeatsStr){ if(!MORPH_ON) return false;
  const mg=tierText(tk,"mgloss"); if(!mg) return false;
  const next=retargetGlossForFeatsChange(mg,oldFeatsStr,tk.feats,tk.upos);   // …and the UPOS, which is only ever read to disambiguate an abbreviation that names more than one category
  if(next===mg) return false;
  tk.misc=setMiscKV(tk.misc,"MGloss",next); return true; }
// Task B — the UPOS analogue of retargetGlossForFeatsChange: UPOS drives exactly ONE piece of MGloss on its
// own, the closed-class prefix abbreviation (AUX/DET — UPOS_LEIPZIG_ABBR, above), which featsToGloss always
// places FIRST, ahead of every FEATS-derived category, never through MGLOSS_FEAT_ORDER's ranking. So a UPOS
// change touches only that leading token — added, dropped, or swapped — and leaves every OTHER abbreviation,
// hyphen and dot exactly where it already was: no wholesale composeMGloss rebuild, which is what would
// reposition a hand-placed segmentation mark or reshuffle an abbreviation order the user (or a prior parse)
// had already settled.
function retargetGlossForUposChange(mg,oldUpos,newUpos){
  const oldAb=UPOS_LEIPZIG_ABBR[oldUpos]||null, newAb=UPOS_LEIPZIG_ABBR[newUpos]||null;
  if(oldAb===newAb) return mg;   // neither UPOS carries a prefix, or both carry the SAME one → nothing to touch
  let lead="",rest=mg||"";
  if(rest.startsWith("-")){ lead="-"; rest=rest.slice(1); }   // a leading segmentation mark (mglossMarks) is not this prefix — keep it outermost, untouched
  let next;
  if(oldAb && (rest===oldAb || rest.startsWith(oldAb+"."))) next = rest===oldAb ? "" : rest.slice(oldAb.length+1);
  else next = rest;   // the string didn't actually open with the old prefix (hand-edited away already) → leave the body alone, just add/not-add below
  if(newAb) next = next ? newAb+"."+next : newAb;
  return lead+next; }
function uposSyncGloss(tk,oldUpos){ if(!MORPH_ON) return false;
  const mg=tierText(tk,"mgloss"); if(!mg && !UPOS_LEIPZIG_ABBR[tk.upos]) return false;
  const next=retargetGlossForUposChange(mg,oldUpos,tk.upos);
  if(next===(mg||"")) return false;
  tk.misc=setMiscKV(tk.misc,"MGloss",next); return true; }
function _tierKeys(kind){ return kind==="gloss"?["Gloss"]:["MSeg","MGloss"]; }
function clearTierData(keys){ let any=false; DOC.forEach(s=>s.tokens.forEach(t=>{ keys.forEach(k=>{ if(miscKV(t.misc,k)){ t.misc=setMiscKV(t.misc,k,""); any=true; } }); })); return any; }   // clear the tier's MISC across the doc
function tierNonEmpty(kind){ const keys=_tierKeys(kind); return DOC.some(s=>s.tokens.some(t=>keys.some(k=>miscKV(t.misc,k)))); }
// item 1: the Glossing-tier checkboxes reflect the CURRENT document's own MISC — a lexical Gloss tier iff any
// token carries MISC Gloss, a morphemic tier iff any carries MSeg/MGloss — never carried across files. Call this
// after any operation that REPLACES the document (open, append-into-blank, format conversion).
function syncGlossTiersFromDoc(){ GLOSS_ON=tierNonEmpty("gloss"); MORPH_ON=tierNonEmpty("morph"); GLOSS_VIS=true; MORPH_VIS=true; if(MORPH_ON)normaliseMsegMarks(); if(typeof syncGlossUI==="function")syncGlossUI(); }
// The word-continuation mark is decoration and never belongs in MISC — but older files carry one in their stored
// MSeg, from back when this app wrote it there (a plain "-" put on every FEATS Compound=Yes token; briefly "⹀").
// Strip it on open so it can't read as a morpheme boundary, or come back out through an edit — the same "integrate
// on open" treatment syncGlossTiersFromDoc gives the tiers themselves. A Compound=Yes token that was never grouped
// into an MWT is included: msegStrip leaves its trailing hyphen alone (nothing about its position says "mark"), so
// the old rule's own condition has to retire it. Deliberately WITHOUT markDirty: opening a file shouldn't hand the
// user unsaved changes they never made — the cleaned value goes to disk with their next real edit.
function normaliseMsegMarks(){ DOC.forEach(s=>s.tokens.forEach((t,ti)=>{ const cur=miscKV(t.misc,"MSeg"); if(!cur) return;
  const glued=msegGlued(s,ti+1), want=msegStrip(cur,glued||isCompoundFeat(t.feats));
  if(want!==cur){ t.misc=setMiscKV(t.misc,"MSeg",want); if(t._msegPre===cur) t._msegPre=want; } })); }
// The relation inventory is REBUILT from the document, not accumulated onto: the standard SUD vocabulary, plus
// every non-standard relation THIS document actually uses. So a newly-loaded/converted document's own relations
// are immediately available (and correctly placed by deprelMenuGroups) in the grid autocomplete and the relation
// context menu without the user re-typing them — the same "derive from this file" treatment syncGlossTiersFromDoc
// gives the glossing tiers — while a relation that came from a file since closed, or was typed into a token and
// then edited away, drops out again instead of cluttering every menu for the rest of the session. Called on both
// append and replace, and it reads the WHOLE of DOC, so an append keeps the relations of both files.
// MORPH_DEPRELS ("/m") are excluded: those are a separate, already-built-in mSUD taxonomy (see deprelVocab), not
// document vocabulary to fold in. The DEFAULT order is kept as authored (root, subj, udep, comp, …) with the
// document's own extras sorted after it, rather than sorting the whole list into one alphabetical run.
function syncDeprelVocabFromDoc(){ const seen=new Set(DEPREL_DEFAULT), morph=new Set(MORPH_DEPRELS), extra=[];
  DOC.forEach(s=>s.tokens.forEach(t=>{ const b=depBase(t.deprel);
    if(b&&b!=="_"&&!seen.has(b)&&!morph.has(b)){ seen.add(b); extra.push(b); } }));
  SETTINGS.deprel=[...DEPREL_DEFAULT,...extra.sort()]; }
// Some treebanks just duplicate UPOS into XPOS (or use a subset of the same tagset) rather than a genuine
// language-specific tagset. Detected once per document load (same call sites as syncGlossTiersFromDoc, so it's
// always re-derived from THIS file, never carried over from the previous one): true when every XPOS value actually
// used anywhere in the doc also occurs as a UPOS value somewhere in the doc, and at least one token has an XPOS
// at all (an all-"_"/absent XPOS document has no evidence either way, so it's left false). When true, editing a
// token's UPOS (grid select or the diagram's right-click menu) mirrors the new value into that token's XPOS too.
let XPOS_MIRRORS_UPOS=false;
function detectXposMirrorsUpos(){
  const uposSet=new Set(); DOC.forEach(s=>s.tokens.forEach(t=>{ if(t.upos)uposSet.add(t.upos); }));
  let anyXpos=false, allSubset=true;
  DOC.forEach(s=>s.tokens.forEach(t=>{ const x=t.xpos; if(x&&x!=="_"){ anyXpos=true; if(!uposSet.has(x))allSubset=false; } }));
  XPOS_MIRRORS_UPOS=anyXpos&&allSubset;
}
// item 7: the Glossing drawer's two checkboxes toggle the tiers. Checking creates+shows (undoable);
// unchecking DELETES the tier, confirming ONLY when it has data. All undoable via snap() (captures the flags + MISC).
async function setTier(kind,on){ const flag=kind==="gloss"?GLOSS_ON:MORPH_ON; if(on===flag){ syncGlossUI(); return; }
  if(on){ pushUndo();   // every tier is available in every format — mSUD adds the morph level alongside the lexical gloss, it doesn't rule it out (see syncGlossUI)
    if(kind==="gloss"){ GLOSS_ON=true;
      // cross-tier prefill: MGloss already exists (enabled first) → seed Gloss from MGloss's own lexical part
      // (the stem gloss the user already typed there), underscores→hyphens for the flat Gloss tier's convention
      if(MORPH_ON) DOC.forEach(s=>s.tokens.forEach(t=>{ if(miscKV(t.misc,"Gloss"))return;
        const lex=mglossLexicalPart(tierText(t,"mgloss")); if(lex) t.misc=setMiscKV(t.misc,"Gloss",lex.replace(/_/g,"-")); })); }
    else { MORPH_ON=true;
      DOC.forEach(morphPrefillSent); }   // item 11b/12b: seed both morphemic tiers wherever they're empty — part of THIS undoable snapshot
    markDirty(); syncGlossUI(); preserveScroll(renderDoc);
    toast(kind==="gloss"?"Lexical gloss on — double-click or Enter on a gloss to edit":"Morphemic gloss on — MSeg seeded; double-click or Enter to edit"); return; }
  const label=kind==="gloss"?"lexical gloss":"morphemic gloss";
  const hasData=(kind==="gloss")?tierNonEmpty("gloss"):morphEdited();   // item 11c: warn on morphemic-tier deletion ONLY once the user has edited (an MSeg differs from its prefill, or any MGloss is set)
  if(hasData && !(await askConfirm(`Delete the ${label}? This removes its data from the document.`,{danger:true,okLabel:"Delete"}))){ syncGlossUI(); return; }   // cancel → restore the checkbox
  pushUndo(); clearTierData(_tierKeys(kind)); if(kind==="gloss")GLOSS_ON=false; else MORPH_ON=false; markDirty(); syncGlossUI(); preserveScroll(renderDoc); toast("Tier removed"); }
// ── MSeg prefill: segment the form against its LEMMA ────────────────────────────────────────────────────────
// The lemma is a statement of which part of the form is the stem, so the shared PREFIX and shared SUFFIX of the
// two are lemma material and whatever sits between them is affixal — that is the whole of the analysis here, and
// it needs no morphology model. Returns {seg, pre, post}: the (possibly hyphenated) MSeg text, plus whether the
// MGloss going with it takes a LEADING / TRAILING hyphen — the Leipzig convention for "this gloss attaches to
// something on that side" (a suffix's gloss is written "-PST", a prefix's "NEG-").
//  · `s` is measured on what is LEFT after the prefix, so prefix and suffix can never claim the same characters
//    twice: "gen"/"gehen" is p=2 ("ge") + s=1 ("n") with an EMPTY stem, not p=2 + s=3 overlapping in the middle.
//  · An empty stem means the form is nothing but lemma material — no cut ("the"/"the", "gen"/"gehen").
//  · The two cuts are INDEPENDENT and both may fire: that is the circumfix case, and it is wanted
//    ("gegangen"/"gehen" → ge-gang-en, its MGloss "-M-").
//  · Only with no shared edge at all (p===s===0) is an INFIX considered: the longest common substring, if it
//    carries more than a third of the form and is flanked on both sides, is the stem ("gemacht"/"machen" →
//    ge-mach-t). The 1/3 floor is what stops a two-letter coincidence from cutting an unrelated word in three.
// Deliberately NOT guarded against a SHORT shared edge, and that is where it goes wrong: "mice"/"mouse" shares
// one character at each end and comes out "m-ic-e", "läuft"/"laufen" comes out "l-äuft", "saw"/"see" comes out
// "s-aw". A minimum-length threshold would be a morphological claim this function is in no position to make
// (English "s-ing" has a real 1-character prefix in other languages), and a wrong segmentation is visible in the
// field and one edit away from right — which is what a prefill is for. Revisit only with a decision from above.
// A VOWEL, for the two rules below: a e i o u y — DIACRITICS AND ALL (á ä ā ê ü are vowels), decided by stripping
// the combining marks off an NFD decomposition rather than by enumerating every precomposed letter. Plus IAST's
// four VOCALIC LIQUIDS ṛ ṝ ḷ ḹ, which decompose to r/l and would otherwise read as consonants: in Sanskrit they
// are syllable nuclei, and this app's Sanskrit is stored in IAST, so a boundary must not treat them as one.
const MSEG_VOCALIC="ṛṝḷḹ";
function msegIsVowel(ch){ if(!ch) return false;
  const base=ch.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
  if(!base) return true;   // a lone combining mark belongs to the letter before it, so it can never itself BE the boundary
  return "aeiouy".indexOf(base)>=0 || MSEG_VOCALIC.indexOf(ch.toLowerCase())>=0; }
/* THE SEGMENTATION RULE (item 2 — this SUPERSEDES the earlier "a shared prefix and a shared suffix may both fire"
   behaviour, which segmented gegangen/gehen as ge-gang-en).
   Three candidate matches are computed against the lemma — a shared PREFIX, a shared SUFFIX, and a shared INFIX
   (a common substring flanked in the form by material on BOTH sides) — and exactly ONE is ever taken: THE LONGEST.
   A tie goes to the prefix match, then the suffix match, then the infix. Preferring the prefix match means
   preferring a stem followed by an affix, which is the commoner morphological shape by a wide margin — and it is
   load-bearing rather than cosmetic: mice/mouse shares one character at EACH end, and taking the prefix candidate
   is what lets the vowel test below decline it instead of producing "mic-e".
   The winner then has to survive three tests. Where it doesn't, the token is left UNSEGMENTED rather than falling
   back to a shorter candidate: a wrong boundary is worse than no boundary, and the shorter candidates are shorter
   precisely because they share less with the lemma.
     · A CUT MAY NOT SPLIT A VOWEL LETTER, and there are two readings of what a vowel letter is.
       ⚠ WHERE THE LANGUAGE'S OWN DIGRAPHS ARE KNOWN, THEY ARE THE RULE (MSEG_DIGRAPHS below). In Latin
       `ae` and `oe` ARE single letters, so the only cut forbidden is one falling between their two
       characters: Troiae/Troia cuts at 4 — "Troi-ae" — and puellae/puella at 5, "puell-ae". The
       whole-run rule below got the second of those right and the first badly wrong, walking the cut back
       through `oiae` to "Tr-oiae", because it is a cruder statement of the same intent: knowing nothing
       about which sequences are one letter, it treated EVERY vowel sequence as indivisible.
       · Elsewhere the whole-run rule stands as the approximation it is: where a cut falls between two
       vowels it moves LEFT, to the start of that run, so the run goes whole to the piece on the right.
       That is also what declines said/say — the cut between "sa" and "id" is vowel|vowel, moves back to
       "s|aid", and a match of "s" then fails the vowel test — and taking it away from every language
       rather than from the one whose letters we actually know would have cost that for nothing.
     · THE MATCH MUST HOLD AT LEAST ONE LETTER, AND AT LEAST ONE VOWEL. Checked on the MATCH — the material shared
       with the lemma — and deliberately NOT on the affix, because cats/cat is the canonical suffixation and its
       affix "s" has no vowel at all. This is what declines saw/see (a shared "s") and mice/mouse (a shared "m").
     · EVERY PIECE MUST BE NONEMPTY once the cuts have been adjusted. A form identical to its lemma segments not
       at all, and a cut that slid to the edge of the form takes its whole candidate down with it.
   `pre`/`post` name the side the MGloss hyphen hangs on, not the side the match is on: a shared PREFIX means the
   affix is a SUFFIX, so its gloss is written "-PST" (pre). See mglossMarks. */
/* Sequences that are ONE LETTER in a given language, so a morpheme boundary may not fall inside one.
   Latin's `ae`/`oe` are the diphthong digraphs; nothing else is claimed for any other language, and a
   language absent from this table keeps the whole-vowel-run approximation (see msegSegment's own note).
   Matched case-insensitively, so `Ae` at the head of a capitalised word counts. */
const MSEG_DIGRAPHS={la:["ae","oe"]};
function msegDigraphs(){ return MSEG_DIGRAPHS[((DOCLANG||"").toLowerCase().split(/[-_]/)[0])]||null; }
function msegSegment(formStr,lemmaStr){
  const F=Array.from(formStr||""), L=Array.from(lemmaStr||"");   // CODE POINTS, not UTF-16 units — a hyphen must never land inside a surrogate pair
  const out={seg:formStr||"",pre:false,post:false,kind:null};   // `kind` ("pre"/"post"/"in"/null=unsegmented) is which CANDIDATE won — composeMGlossPrefill below needs to tell the infix shape apart from a plain prefix/suffix match, and pre&&post alone can't: both are true ONLY for "in" (see the tie-break block above), but a caller has no way to know that without re-deriving it, so it rides along on the result instead
  if(!F.length||!L.length) return out;   // no lemma at all (a "_" lemma, or no transliteration of it to compare like-for-like) → the prefill stays exactly what it was before this feature
  const eq=(a,b)=>a===b||a.toLowerCase()===b.toLowerCase();   // per-CHARACTER case folding, never toLowerCase() over the whole string: a handful of mappings change length ("İ" → "i̇") and would slide every index after them, cutting the form in the wrong place
  let p=0; while(p<F.length&&p<L.length&&eq(F[p],L[p])) p++;
  let s=0; while(s<F.length&&s<L.length&&eq(F[F.length-1-s],L[L.length-1-s])) s++;   // over the WHOLE pair now, not the prefix's remainder: the two are ALTERNATIVES to choose between, no longer a pair of independent conditionals
  // longest common substring, by the usual rolling-row DP (forms are a handful of characters, so the O(|F|·|L|)
  // is free). Ties go to the EARLIEST run in the form — `>` not `>=`, with i as the outer loop.
  let bi=0,bl=0; const dp=new Array(L.length+1).fill(0);
  for(let i=0;i<F.length;i++){ let prev=0;
    for(let j=0;j<L.length;j++){ const tmp=dp[j+1]; dp[j+1]=eq(F[i],L[j])?prev+1:0; prev=tmp;
      if(dp[j+1]>bl){ bl=dp[j+1]; bi=i-bl+1; } } }
  const cands=[];   // ARRAY ORDER IS THE TIE-BREAK ORDER (prefix, then suffix, then infix) — see the note above
  if(p>0&&p<F.length) cands.push({kind:"pre", len:p,  cuts:[p]});
  if(s>0&&s<F.length) cands.push({kind:"post",len:s,  cuts:[F.length-s]});
  if(bl>0&&bi>0&&bi+bl<F.length) cands.push({kind:"in",len:bl,cuts:[bi,bi+bl]});   // flanked on BOTH sides — an unflanked run is a prefix/suffix case the two candidates above already hold.   // THERE IS NO LENGTH THRESHOLD. An earlier rule required the infix to be more than a third of the form, and it was removed on instruction after excluding the commonest Sanskrit shape there is: `dadātu` against the lemma `dā` shares exactly `dā`, 2 of 6 characters — a reduplicated stem is a third of its form by construction — and went unsegmented for want of a single character. What guards the infix now is the same thing that guards the other two candidates, the letter-and-vowel test on the MATCH below, which is what was doing the real work in any case
  let best=null; cands.forEach(c=>{ if(!best||c.len>best.len) best=c; });   // strict >, so the first of equal lengths wins
  if(!best) return out;
  const digs=msegDigraphs();
  const cuts=best.cuts.map(k=>{
    if(digs){ while(k>0 && digs.some(d=>d.length===2 && eq(F[k-1],d[0]) && eq(F[k],d[1]))) k--; return k; }   // never inside a single LETTER written with two characters (Latin ae/oe) — the letter goes whole to the piece on the right
    while(k>0&&msegIsVowel(F[k-1])&&msegIsVowel(F[k])) k--; return k; });   // …and, with no such inventory to consult, never inside a vowel RUN: the crude form of the same rule

  const idx=[0].concat(cuts,[F.length]);
  for(let i=0;i<idx.length-1;i++) if(idx[i+1]<=idx[i]) return out;   // a shifted cut collapsed a piece (or crossed its neighbour, which the infix's two cuts can do)
  const pieces=[]; for(let i=0;i<idx.length-1;i++) pieces.push(F.slice(idx[i],idx[i+1]));
  const match=best.kind==="pre"?pieces[0]:pieces[1];   // the piece SHARED with the lemma: leading for a prefix match, second for a suffix or infix match
  if(!match.some(ch=>/\p{L}/u.test(ch))||!match.some(msegIsVowel)) return out;
  out.seg=pieces.map(a=>a.join("")).join("-");   // sliced out of F itself, so the FORM's own casing survives the folded comparison ("Unhappy"/"happy" → "Un-happy")
  out.pre=best.kind!=="post"; out.post=best.kind!=="pre"; out.kind=best.kind;
  return out; }
// The two strings the segmentation compares, taken LIKE-FOR-LIKE: whatever the MSeg prefill would have written
// for the form, and the lemma's counterpart in the same alphabet. So a transliterated MSeg is compared against
// MISC LTranslit / t.translitLemma, never against the native-script lemma — and where a non-Latin token has no
// transliteration yet (the prefill then falls back to the raw form), the lemma falls back with it.
function msegPrefillParts(t){ if(!t) return {seg:"",pre:false,post:false,kind:null};   // same shape msegSegment itself returns — see its own note on `kind`
  const ftr=translitNeeded(DOCLANG)?(miscTranslit(t.misc)||t.translit||""):"";   // "" ⇒ this document's MSeg is in the native script (Latin-script language, or no romanisation available for this token)
  const lraw=(t.lemma&&t.lemma!=="_")?t.lemma:"";
  const parts=msegSegment(ftr||(t.form||""), ftr?(miscKV(t.misc,"LTranslit")||t.translitLemma||""):lraw);
  return parts; }
// Put the segmentation's attachment hyphens on a composed MGloss — but only on a NONEMPTY one: a token whose
// FEATS compose to nothing writes no MGloss at all (the `if(mg)` at every call site), and a bare "-" would be
// that nothing dressed up as a gloss.
function mglossMarks(mg,seg){ return mg?((seg.pre?"-":"")+mg+(seg.post?"-":"")):mg; }
/* composeMGloss + mglossMarks, together, for every PREFILL/REFILL site (mglossRefill, morphPrefillSent, the
   post-reparse regen below all used to write this exact pair inline — one INFIX bug, three copies to have missed
   it in). For a prefix or suffix match (seg.kind "pre"/"post") — or no match at all (kind null) — nothing here
   changes: composeMGloss's single lex+gram run gets mglossMarks' attachment hyphen on whichever edge msegSegment
   named, exactly as before.
   THE INFIX CASE (seg.kind==="in" — the only shape where seg.pre AND seg.post are both true; see msegSegment's
   own tie-break comment) is NOT a smaller version of the same rule and must not reuse composeMGloss at all.
   msegSegment cut the form into three pieces there — flanking material, the MATCH (the substring shared with the
   lemma), flanking material again — e.g. `dadātu` against lemma `dā` cuts to "da-dā-tu". The MATCH piece is the
   stem — it's what equals the lemma — so a lexical gloss for the word (Wiktionary's "give", say) describes THAT
   piece, the middle one, and nothing else. FEATS says nothing about which piece of the form realises which
   category, so its abbreviations (dadātu's imperative/3rd/singular) don't belong to the match; they describe the
   reduplication-plus-ending working together, and with no second bundle to split them into, this app's
   convention puts the whole of `gram` on the LAST (ending) piece rather than inventing a division FEATS never
   stated — on correction: an earlier cut put it on the FIRST (reduplicating) piece instead, which read the
   grammatical content onto the wrong flank. Gluing lex and gram into one string and bracketing the OUTSIDE —
   composeMGloss+mglossMarks' usual move — puts BOTH on the MIDDLE slot instead ("-give.IMP.3SG-" splits to
   ["","give.IMP.3SG",""]), which is exactly backwards either way: the match/lemma piece would carry the
   grammatical categories that belong to its flanking material, and the flanking material would carry nothing
   at all.
   So for "in", the three MSeg slots are answered directly rather than through composeMGloss: the first (leading)
   piece left empty — unglossed, same as every other slot this file leaves for the annotator to fill in by hand
   — `lex` alone on the second (the match), `gram` on the third (as CONTENT, not as an attachment mark on an
   empty slot — so no trailing "-" the way the pre/post branch would add one). Two hyphens either way keep it
   3-slot-aligned with MSeg's own three pieces ("-lex-gram".split("-") is exactly ["","lex","gram"]), and an
   entirely empty result (no FEATS abbreviations AND no lexical gloss) collapses back to "" rather than the two
   bare hyphens the template would otherwise leave behind — "" is how every call site here already spells
   "nothing to write". */
function composeMGlossPrefill(lex,featsStr,upos,seg){
  if(seg&&seg.kind==="in"){ const gram=featsToGloss(featsStr,upos);
    return (gram||lex)?("-"+lex+"-"+gram):""; }
  return mglossMarks(composeMGloss(lex,featsStr,upos),seg); }
/* Item 3 — RE-DERIVE ONE TOKEN'S SEGMENTATION. MSeg is a function of the form AND the lemma, so it goes stale
   whenever EITHER moves: a hand-edited lemma, a lemma the background re-parse revised after a form edit, or the
   form itself. Every one of those paths funnels through here rather than re-deriving the value itself, so they
   cannot disagree about when a rewrite is allowed.
   IT IS ONLY EVER ALLOWED OVER THE AUTO-PREFILL. `_msegPre` records exactly what the last derivation wrote, so a
   stored MSeg that differs from it is the user's own segmentation and nothing derived may overwrite it — the same
   test morphEdited uses to decide whether the tier has been touched at all. Returns true iff it wrote something,
   so the caller can markDirty() for a real change and stay silent for a no-op. */
function msegRefill(t,force){ if(!MORPH_ON||!t) return false;
  const cur=miscKV(t.misc,"MSeg");
  if(!force && cur && cur!==(t._msegPre||"")) return false;   // hand-edited → the user's, not ours — UNLESS force: a direct lemma edit (afterLemmaEdit's own call) is new evidence about what the word IS, strong enough to supersede a hand correction that was made against the OLD lemma, so it always re-derives; the background-reparse and form-edit callers below stay unforced (weaker evidence: a parser guess, or a form change that hasn't touched the lemma at all)
  const pv=glossEnc(msegPrefillParts(t).seg);
  /* ⚠ THE GLOSS IS REFRESHED EVEN WHERE THE SEGMENTATION DID NOT MOVE, and this call sits above the
     unchanged-value return for that reason. The two rows go stale on overlapping but different evidence:
     MSeg on (form, lemma), MGloss on (FEATS, UPOS) as well — so a re-parse that revises only the FEATS
     leaves `amic-is` correct and `-DAT.PL` wrong, and a refill that gave up as soon as MSeg came back
     identical would never look at the gloss at all. */
  const mgChanged=mglossRefill(t);
  if(!pv||pv===cur) return mgChanged;
  t.misc=setMiscKV(t.misc,"MSeg",pv); t._msegPre=pv;
  /* …and the SEAM goes back on, because a refill cannot derive it: msegSegment segments against the lemma,
     and a clitic boundary is the annotator's assertion. Every refill path ends here — the form edit, the
     forced lemma-edit one, and the background re-parse's, which is what silently dropped a just-mirrored
     seam by refilling over it a second later. */
  msegMirrorSeams(t);
  /* …AND MGLOSS IS RE-DERIVED WITH IT. The two rows are one analysis seen twice — MSeg names the morphemes,
     MGloss names what each of them does — and both are computed from the same (form, lemma, FEATS, UPOS).
     So anything that makes MSeg stale makes MGloss stale in the same breath, and re-slotting alone only ever
     MOVED the old gloss's hyphens: after a re-parse revised the FEATS, the marks lined up while the
     categories underneath them were the previous analysis's.
     Reslot is still the fallback, and does the work the refill declines to: a HAND-WRITTEN MGloss is the
     annotator's and is never re-derived over, but its hyphens must still follow the segmentation that just
     moved beneath it. So — refill what is ours, re-slot what is theirs. */
  if(!mgChanged) mglossReslot(t,cur,pv);   // …refill what is ours, re-slot what is theirs (see above)
  return true; }
/* Item 3's counterpart for the gloss row — MGloss re-derived from FEATS, with the attachment hyphens the
   CURRENT segmentation implies. Same provenance rule as msegRefill and the same marker (`_mglossPre`,
   which morphEdited already reads as "the annotator has not been here"): a value that differs from the one
   we last prefilled is theirs, and is left alone. Unforced from msegRefill even where THAT was forced — a
   lemma edit re-derives the segmentation but says nothing about the grammatical categories, so there is no
   reason for it to overwrite a gloss someone wrote. */
function mglossRefill(t,force){ if(!MORPH_ON||!t) return false;
  const cur=miscKV(t.misc,"MGloss");
  if(!force && cur && cur!==(t._mglossPre||"")) return false;   // hand-written → the annotator's, not ours
  const seg=msegPrefillParts(t);
  const lex=(GLOSS_ON&&!UPOS_LEIPZIG_ABBR[t.upos])?miscKV(t.misc,"Gloss").replace(/-/g,"_"):"";   // the same cross-tier prefill morphPrefillSent applies
  const pv=glossEnc(composeMGlossPrefill(lex,t.feats,t.upos,seg));
  if(!pv||pv===cur) return false;
  t.misc=setMiscKV(t.misc,"MGloss",pv); t._mglossPre=pv; return true; }
/* A SEAM TYPED INTO A FORM IS A SEAM IN ITS SEGMENTATION TOO. `=` marks where a token should divide, and
   openConvertMWT reads it off the FORM to split without asking how many pieces — but the split also divides
   MSeg on `=`, and only when the piece counts agree. So a form that says `śaśa=bhṛto` beside an MSeg that
   says `śaśabhṛ-to` describes ONE boundary in two places and states it in only one of them: the split then
   leaves the whole segmentation on the head, because it has no way to know where to cut it.
   Nothing can DERIVE it either — msegSegment segments the form against the lemma, and a clitic boundary is
   an assertion the annotator makes, not something a lemma implies. So it is carried across rather than
   inferred, and only where the carry is unambiguous: MSeg with its separators removed must equal the form
   with its seams removed, i.e. the two must already be spelling the same string. Where they are not (an MSeg
   in the transliteration of a non-Latin script, a hand-rewritten segmentation) this says nothing at all.
   A seam landing where MSeg already has a morpheme `-` REPLACES it: they mark the same division, and `=-`
   would read as two boundaries where the annotator drew one — the seam being the stronger claim, since it
   says the pieces are separate TOKENS rather than separate morphemes. */
const _SEP_RE=/[-꞊=⹀]/;
function msegMirrorSeams(t){ if(!t) return false;
  const cur=miscKV(t.misc,"MSeg"); if(!cur||cur.indexOf("=")>=0) return false;
  /* WHICH STRING THE SEAM COMES FROM is the same question as which string MSeg is a segmentation OF, and
     msegPrefillParts has already answered it: the TRANSLITERATION in a document whose script needs one, the
     surface form otherwise. So a Devanagari file's seam is read off the IAST — which is where it is typed in
     that file anyway, the transliteration row being the editable one under a script (iastFormEdit) — and
     mapping it off the Devanagari could not work regardless, the two spellings having no character-for-
     character correspondence to count along. A seam typed into the FORM still arrives: the romanisation is
     re-derived from it before this runs (afterFormEdit) and `=` survives that conversion. */
  const tr=(typeof translitNeeded==="function"&&translitNeeded(DOCLANG))?(miscTranslit(t.misc)||t.translit||""):"";
  const src=String(tr||t.form||"");
  if(!src||src.indexOf("=")<0&&!/[꞊⹀]/.test(src)) return false;
  if(cur.replace(/[-꞊=⹀]/g,"")!==src.replace(/[꞊=⹀]/g,"")) return false;   // not the same string → no honest mapping
  const marks=[]; let k=0;
  for(const ch of src){ if(/[꞊=⹀]/.test(ch)) marks.push(k); else k++; }    // how many LETTERS precede each seam
  let out="", seen=0, mi=0;
  for(const ch of cur){ while(mi<marks.length&&marks[mi]===seen){ out+="="; mi++; }
    out+=ch; if(!_SEP_RE.test(ch)) seen++; }
  while(mi<marks.length){ out+="="; mi++; }
  out=out.replace(/-+=/g,"=").replace(/=-+/g,"=");                          // one boundary, written once
  if(out===cur) return false;
  /* ⚠ `_msegPre` IS DELIBERATELY NOT SET. It marks a value as OURS, which licenses a later unforced refill
     to overwrite it — and this value is not ours: the seam in it is the annotator's assertion, carried over
     from a form they typed. Setting it let the background re-parse refill straight over the mirrored seam a
     second later, taking the morpheme hyphens with it. Leaving it alone is what makes msegRefill decline. */
  t.misc=setMiscKV(t.misc,"MSeg",out); return true; }
// Seed one sentence's morphemic tiers wherever they're EMPTY, leaving anything already there untouched:
//  · MSeg  (item 11b) — the TRANSLITERATION for non-Latin-script languages, else the surface form, SEGMENTED
//    against the lemma by msegSegment above (unsegmented where the lemma is missing or says nothing).
//  · MGloss (item 12b) — the grammatical part composed from FEATS (Leipzig abbreviations). Cross-tier prefill: a
//    lexical Gloss already there becomes MGloss's LEXICAL part too (hyphens→underscores), UNLESS this closed-class
//    UPOS has its own standard Leipzig abbreviation (AUX/DET — item 4: those tokens' Wiktionary picks go to Gloss
//    only, so borrowing Gloss's text back would duplicate it; MGloss gets the UPOS abbreviation + FEATS alone).
// Called when the tier is first created (setTier, across the whole document) and again for a single sentence after
// a re-parse hands it a fresh set of tokens — the tiers are FEATS-derived, so new FEATS mean a new MGloss.
function morphPrefillSent(s){ if(!s||!s.tokens) return;
  s.tokens.forEach(t=>{ const seg=msegPrefillParts(t);   // ONE segmentation per token, shared by both rows, so MSeg's boundaries and MGloss's attachment hyphens can never disagree about where the affixes are
    if(!miscKV(t.misc,"MSeg")){ const pv=glossEnc(seg.seg); if(pv){ t.misc=setMiscKV(t.misc,"MSeg",pv); t._msegPre=pv; } }
    if(!miscKV(t.misc,"MGloss")){ const lex=(GLOSS_ON&&!UPOS_LEIPZIG_ABBR[t.upos])?miscKV(t.misc,"Gloss").replace(/-/g,"_"):"";
      const mg=glossEnc(composeMGlossPrefill(lex,t.feats,t.upos,seg)); if(mg){ t.misc=setMiscKV(t.misc,"MGloss",mg); t._mglossPre=mg; } } }); }
// item: a re-parse replaced this sentence's tokens outright, so both morphemic tiers came back empty — re-seed them
// from the FEATS the parse just produced. No-op unless the morphemic tier is on. The caller owns the undo snapshot
// (a re-parse pushes one before it starts), so this rides along inside that single undoable step.
function morphAfterReparse(s){ if(MORPH_ON) morphPrefillSent(s); }
function morphEdited(){ return DOC.some(s=>s.tokens.some(t=>{ const mg=tierText(t,"mgloss"); if(mg && mg!==(t._mglossPre||""))return true; const ms=tierText(t,"mseg"); return !!(ms && ms!==(t._msegPre||"")); })); }   // item 11c/12b: has the user changed any MSeg or MGloss from its auto-prefill? (an untouched FEATS-derived MGloss prefill counts as empty)
window.addGloss=function(){ setTier("gloss",true); };
window.addMorphGloss=function(){ setTier("morph",true); };
// Shared <datalist> of ISO-639 languages for the translations grid's language dropdown (built once; arbitrary values still allowed)
// ── item 13: document-level translation languages (a multi-select drawer + a field per language under each block)
let TRANS_LANGS=new Set();   // enabled translation-language codes (doc-level)
function refreshTransLangs(){ TRANS_LANGS=new Set(); DOC.forEach(s=>{ (sentTranslations(s)||[]).forEach(t=>{ if(t.lang && (t.text||"").trim()) TRANS_LANGS.add(t.lang); }); }); }   // derive from existing # text_LANG on load
function renderTransDrawer(){ const pop=document.getElementById("transPop"); if(!pop)return; pop.innerHTML="";
  const search=document.createElement("input"); search.className="lmsearch"; search.type="search"; search.placeholder="Search a language to add…"; search.spellcheck=false;
  const list=document.createElement("div"); list.className="tdlist";
  pop.appendChild(search); pop.appendChild(list);   // item 13: search field on TOP of the language list
  const fill=q=>{ list.innerHTML=""; q=(q||"").trim().toLowerCase(); let entries;
    if(!q){ entries=[...TRANS_LANGS].sort((a,b)=>(langName(a)||a).localeCompare(langName(b)||b)).map(c=>[c,langName(c)||c]); }
    /* RANKED AND ALPHABETISED, exactly as the status-bar Languages menu does it (lmFilter, js/ui/wiring.js) —
       the two are the same search over the same table and must not answer differently. Matching by word prefix
       was only half of that: this list walked ISO639_3 in FILE order and cut at 60, so "eng" could bury English
       among codes that happen to sort earlier in the table, or push it past the cut entirely. Two tiers, each
       alphabetised by display name: an exact code or a prefix of the WHOLE name leads, then any later word of
       the name. The 60-row cap stays, but it now cuts the tail rather than an arbitrary slice.
       ONE DELIBERATE DIVERGENCE from lmFilter: no lmSub() filtering. That menu hides Glottolog-dialect
       sub-languages because it is choosing what the DOCUMENT is written in, where a dialect code is usually a
       mistake; this one is choosing what a translation tier is written in, and there is no reason a translation
       may not be into one. The request was about how the search matches, not about narrowing what can be added. */
    else { const wp=wordPrefixRe(q), pre=[], sub=[];   // one regex per keystroke, not per row — see lmFilter's own note; this list walks the same ~7,900-row table
      for(const e of (window.ISO639_3||[])){ const nm=(glotName(e[0])||e[2]||"").toLowerCase();
        if(e[0]===q||e[1]===q||nm.startsWith(q)) pre.push(e);
        else if(wp.test(nm)||e[0].startsWith(q)||(e[1]&&e[1].startsWith(q))) sub.push(e); }
      const byName=(a,b)=>(glotName(a[0])||a[2]||"").localeCompare(glotName(b[0])||b[2]||"");
      pre.sort(byName); sub.sort(byName);
      entries=pre.concat(sub).slice(0,60).map(e=>[e[1]||e[0], glotName(e[0])||e[2]]); }   // item 22: prefer Glottolog name
    if(!entries.length){ const d=document.createElement("div"); d.className="lmnote"; d.textContent=q?"No matching language.":"No translation languages yet — search to add one."; list.appendChild(d); return; }
    entries.forEach(([code,name])=>{ const row=document.createElement("label"); row.className="tdrow";
      const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=TRANS_LANGS.has(code);
      cb.addEventListener("change",()=>toggleTransLang(code,cb.checked));
      const nm=document.createElement("span"); nm.className="tdname"; nm.textContent=name||code;
      const cd=document.createElement("span"); cd.className="tdcode"; cd.textContent=code;
      row.appendChild(cb); row.appendChild(nm); row.appendChild(cd); list.appendChild(row); }); };
  search.addEventListener("input",()=>fill(search.value)); search.addEventListener("mousedown",e=>e.stopPropagation()); search.addEventListener("keydown",e=>e.stopPropagation());
  fill(""); }
window.renderTransDrawer=renderTransDrawer;
async function toggleTransLang(code,on){
  if(on){ if(!TRANS_LANGS.has(code)){ pushUndo(); TRANS_LANGS.add(code); markDirty(); preserveScroll(renderDoc); } }
  else if(TRANS_LANGS.has(code)){   // deselect: warn if any block has a non-empty translation in this language
    const nonEmpty=DOC.some(s=>(s.translations||[]).some(t=>t.lang===code && (t.text||"").trim()));
    if(nonEmpty && !(await askConfirm(`Remove ${langName(code)||code} translations? Existing translations in this language will be deleted.`,{danger:true,okLabel:"Remove"}))){ renderTransDrawer(); return; }
    pushUndo(); TRANS_LANGS.delete(code);
    DOC.forEach(s=>{ if(Array.isArray(s.translations)) s.translations=s.translations.filter(t=>t.lang!==code); });   // drop the # text_LANG from every sentence
    markDirty(); preserveScroll(renderDoc); }
  renderTransDrawer(); }
// a field per enabled language under a block, SORTED BY LANGUAGE NAME, labelled with the name (item 13)
// item 11: after layout, cap a block-header line's RIGHT edge to the sentence input's (.stext) right edge, so the
// transliteration line is only as wide as the sentence (its left already matches via the shared idW+8 margin + 3px pad).
/* PULL A BLOCK-HEADER ROW'S RIGHT EDGE IN TO THE SENTENCE TEXT'S. Applied to the translations grid and to the
   script-mode transliteration line, so both share the sentence's right margin rather than running on into the
   gutter where the block controls sit.
   applyTransInset IS SYNCHRONOUS AND THAT MATTERS: narrowing the box REWRAPS its text, so it changes the row's
   HEIGHT — and the per-block height caps (js/core/document.js) measure exactly that height to decide how much
   room the diagram and grid may have. Measured on a two-language block with long translations, the .tgrid is
   1115px/158px tall when it is built and 821px/194px once inset: doing the inset a frame later handed both cap
   passes a row 36px shorter than the one actually drawn, and the block overran the viewport by that much. So the
   sweep below runs inside the render, before anything measures a height.
   The rAF wrapper survives only as a fallback for a row revealed OUTSIDE a render (the Sanskrit script line's
   click-to-reveal), where no sweep is coming; it is idempotent, so a row that the sweep already handled simply
   recomputes the same number. */
function applyTransInset(el){ const blk=el.closest(".sblock"); if(!blk)return; const st=blk.querySelector(".shead .stext"); if(!st)return;
  el.style.marginInlineEnd="0px";   // measure from the UN-inset width every time, or a second pass would inset an already-inset row again
  const inset=el.getBoundingClientRect().right-st.getBoundingClientRect().right;
  el.style.marginInlineEnd=(inset>0?Math.round(inset):0)+"px"; }
// every row in the document that wants that treatment, in one synchronous sweep — called from renderDoc just
// before the height caps are computed. data-capw is set where the row is built, so this needs no class taxonomy.
function applyTransInsets(){ document.querySelectorAll("#doc [data-capw]").forEach(applyTransInset); }
function capTransWidth(el){ requestAnimationFrame(()=>applyTransInset(el)); }
function renderBlockTrans(i){ const s=DOC[i], rows=sentTranslations(s);
  const langs=[...TRANS_LANGS].sort((a,b)=>(langName(a)||a).localeCompare(langName(b)||b));
  const box=document.createElement("div"); box.className="tgrid"; box.dir="ltr"; box.style.marginInlineStart=(idW+8)+"px";   // left edge aligns with the sentence text
  box.addEventListener("mousedown",e=>e.stopPropagation()); box.addEventListener("click",e=>e.stopPropagation());
  langs.forEach(code=>{ const tr=document.createElement("div"); tr.className="tgrid-row";
    const lab=document.createElement("span"); lab.className="tg-lname"; lab.textContent=langName(code)||code; lab.title=code;
    let row=rows.find(r=>r.lang===code); if(!row){ row={lang:code,text:""}; rows.push(row); }
    const text=document.createElement("div"); text.className="tg-text"; text.setAttribute("contenteditable","plaintext-only"); text.setAttribute("role","textbox"); text.spellcheck=false; text.dir="auto"; text.setAttribute("aria-label",(langName(code)||code)+" translation");
    text.textContent=row.text||""; if(!row.text)text.dataset.empty="1";   // data-empty → CSS placeholder (unfocused looks like plain text)
    /* NO CLICK GATE HERE, AND THAT IS THE POINT — recorded because it was got wrong twice and the wrong version
       is the tempting one. The field's BOX is its click target: anywhere inside it focuses and places a caret,
       anywhere outside it does not (and blurs it, since nothing out there is focusable). That is the browser's
       own behaviour for a contenteditable and it is exactly what is wanted; it needs no help.
       WHAT THE TWO FAILED ATTEMPTS WERE, so neither is re-derived: a mousedown handler that preventDefault()ed
       unless the point hit the TEXT's own client rects, and then a variant that measured an empty field's
       placeholder by briefly setting width:max-content. Both were answering a misreading of "clicking to the
       right of the input focuses it". An UNFOCUSED, EMPTY field is fully transparent (.tg-text has no background
       until :hover/:focus), so what reads as "the input" is the grey placeholder word alone and everything right
       of it looks like block background — but it is all still inside the box, and focusing it there is correct.
       The field's real extent is the box you see on hover, which stops at the sentence text's right edge because
       renderBlockTrans insets the whole .tgrid to meet it (below). Gating anything inside that box only made the
       field feel dead across most of its own width. */
    let pre=null,orig=null; text.addEventListener("focus",()=>{ pre=snapSent(i); orig=row.text||""; setCurBlock(i); });   // one undo per edit session; setCurBlock: clicking/tabbing into a translation field is arriving at its block (same as the running-sentence line — document.js's wireStext), and it has to happen here rather than rely on bubbling to .sblock's own click handler because .tgrid stops mousedown/click propagation outright (see box's own listeners above, added so a click inside the grid never falls through to token deselection)
    text.addEventListener("blur",()=>{ if(pre&&(row.text||"")!==orig){ UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); } pre=null; });
    text.addEventListener("input",()=>{ row.text=text.textContent||""; if(row.text)delete text.dataset.empty; else text.dataset.empty="1"; markDirty(); });
    text.addEventListener("keydown",e=>{ e.stopPropagation();   // Enter commits; Shift+Enter newline; keep keys off the doc nav handler
      if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); text.blur(); return; }
      /* ESCAPE LEAVES THE FIELD, on request — and it has to be handled HERE because this listener
         stopPropagation()s every key, so the app's own Escape ladder (js/grid/columns.js) never saw it and the
         key did nothing at all in a translation field. This is the same rung that ladder gives the grid's own
         .cin/.csel inputs: defocus the field, keep the block selected, and let a second Escape fall through to
         the selection itself. preventDefault() is what stops the macOS BEEP — an Escape WebKit hands back
         unhandled becomes AppKit's cancelOperation:, which nothing implements.
         IT COMMITS, like Enter, rather than reverting: the `input` handler above has already written every
         keystroke through to row.text, so there is nothing held back to discard, and the undo snapshot taken on
         focus is what actually restores the pre-edit text (⌘Z), for this field exactly as for every other. */
      if(e.key==="Escape"){ e.preventDefault(); text.blur(); return; } });
    tr.appendChild(lab); tr.appendChild(text); box.appendChild(tr); });
  // item 6: after layout, pull the grid's RIGHT edge in to coincide with the sentence text's (.stext) right edge —
  // so the translation column shares the sentence's right margin (the id / link / block controls sit in the gutter beyond it).
  box.setAttribute("data-capw","1");   // swept synchronously by applyTransInsets during the render — see its note on why this must not wait for a frame
  return box; }

// Re-derive lemma/xpos/feats/deps/misc for one or more tokens by re-running the selected parser on the
// sentence, called automatically after the specific edit that makes those fields stale (a Form edit —
// afterFormEdit — or a UPOS edit — regenTok — or a raised-subject reattach — diagram-edit.js's
// attachAsRaisedSubj); never called as a standalone "regenerate everything" action. Form/upos/deprel and the
// head/tree are always left untouched (this function only ever re-derives the fields listed in PARSE_FIELDS).
// Returns false (no change) when there's no model, no real parse, or the re-tokenisation no longer aligns 1:1.
const PARSE_FIELDS=["lemma","xpos","feats","deps","misc"];
/* ── A RE-HEADED TOKEN'S RELATION IS RE-ASKED OF THE PARSER ────────────────────────────────────────
   A relation is a statement about an EDGE, so moving the edge's other end can leave it describing a
   configuration that no longer exists — a `subj` dragged under a noun, a `comp:obj` under a
   determiner. `afterHeadEdit` (js/editing/validation.js) already keeps the two invariants that follow
   with certainty (head 0 ⟺ `root`, and the goeswith/Shared consequences); this supplies the part that
   needs evidence rather than a rule.

   ⚠ AND IT ADOPTS THE PARSER'S RELATION ONLY WHERE THE PARSER CHOSE THE SAME HEAD. That gate is the
   whole design. `parse_tokens` re-analyses the sentence over its EXISTING tokens and hands back a
   complete tree — its own heads included — and its relation for this token describes ITS attachment,
   not the one the reader has just made. Taking that relation regardless would answer a question
   nobody asked, and taking its HEAD too would silently undo the very edit that triggered this. Where
   the two agree, the parser is describing exactly the edge now in the document and its label is the
   best available answer; where they disagree it has nothing to say about this edge, so the existing
   relation stands and the reader can set it themselves. In practice they agree in the common case,
   which is a reader moving a token to the attachment the parser would have chosen.

   Fire-and-forget and best-effort throughout: the head edit has already landed and been rendered, and
   a relation that could not be refreshed must never make a completed edit look like a failure. No
   undo entry of its own — this is a consequence of the edit that called it, so it belongs to that
   edit's snapshot. It is a NO-OP with no model, which is the same degradation every parser-driven
   refresh in this file takes. */
/* ⚠ AND IT NOW ASKS FOR THE RELATION OF *THIS* ARC, rather than for a whole fresh tree it must then
   agree with. The gate described above was the best available answer while the only question the
   bridge could ask was "parse this sentence": `parse_tokens` re-analyses everything and its label for
   this token describes ITS OWN attachment, so adopting it whenever the heads happened to coincide was
   sound, and saying nothing whenever they did not was the honest remainder — but the remainder is
   exactly the interesting case. A reader who drags a token somewhere the parser would not have put it
   is the reader most in need of "well, if it were there, this is what it would be called".

   `analysis_scores` (app/parse.py) can be asked that directly, in two tiers, and the tiers are ordered
   by how much they are worth:
     1. the arc the parser genuinely WEIGHED. In arc-eager the only arc available at a state is between
        the stack top and the buffer front, so the walk records, for each token, the candidate heads it
        was actually put on the scales against and the label distribution for each. Where the reader's
        new head is one of them, this is the model's own deliberation about the very edge now in the
        document — strictly better evidence than the old gate, which threw the same information away
        by insisting the parser also PREFER that head.
     2. `arcLabelScores`, a state synthesised to put the two tokens at the boundary. Counterfactual,
        and marked as such where it is defined; it is what makes an answer available for an attachment
        the parser never entertained, which the old path had no way to reach at all.
   The old whole-tree path survives as the third tier, for the documents the scores cannot serve (a
   Stanza model — see `analysis_scores` on why its distribution describes a tree nobody is looking at).

   ⚠ AND AN INVALID RELATION IS NEVER WRITTEN. `setDiagramHead` already refuses a DROP whose existing
   relation is error-level on the new head; a relation this function chooses must clear the same bar,
   or the automatic step would introduce precisely what the manual one is stopped from doing. Checked
   against the pair actually in the document, after the awaits.
   Everything else is as before: the RELATION only (any `@deep` tail is the reader's and survives),
   fire-and-forget, no undo entry of its own, and a no-op with no model. */
async function headSyncDeprel(si,tokId){ if(!(hasBridge()&&model)) return false;
  const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return false;
  const want=parseInt(t.head,10); if(!(want>=1)) return false;   // a new ROOT is settled by afterHeadEdit's own invariant — there is nothing to ask
  const forms=s.tokens.map(x=>x.form||""); if(!forms.some(f=>f)) return false;
  let rel="";
  if(typeof tokenScores==="function"){
    const sc=await tokenScores(si);
    if(sc&&sc.deprels&&sc.deprels[tokId-1]) rel=bestScoredRel(sc.deprels[tokId-1][String(want)]);
    if(!rel) rel=bestScoredRel(await arcLabelScores(si,tokId,want));
  }
  if(!rel){                                                      // no scores at all (Stanza) → the whole-tree agreement rule
    let r; try{ r=await window.pywebview.api.parse_tokens(forms,model); }catch(e){ return false; }
    if(!r||!r.parsed||!r.tokens||r.tokens.length!==s.tokens.length) return false;
    const p=r.tokens[tokId-1]; if(!p) return false;
    if(parseInt(p.head,10)!==want) return false;                 // the parser is talking about a different edge
    rel=p.deprel||""; }
  const now=DOC[si]&&DOC[si].tokens[tokId-1];                    // re-read: the document may have moved while the call was out
  if(!now||now!==t||parseInt(now.head,10)!==want) return false;
  const nd=withDepBase(now.deprel,depBase(rel));                 // the RELATION only — any `@deep` tail the reader set is theirs and survives
  if(!rel||nd===now.deprel) return false;
  const hd=DOC[si]&&DOC[si].tokens[want-1];                      // …and never a relation the validator calls an error on this pair
  if(hd&&typeof depIsError==="function"&&await depIsError(hd.upos,now.upos,nd)) return false;
  const again=DOC[si]&&DOC[si].tokens[tokId-1];                  // depIsError is a bridge round-trip of its own — re-check before writing
  if(again!==now||parseInt(now.head,10)!==want) return false;
  now.deprel=nd; markDirty(); renderUnlessEditing();             // …and not over an open inline field, as every other background refresh here
  return true; }
const GESTURE_FEATS=["Shared"];   // FEATS keys settable only via a drag gesture or keyboard shortcut — a token re-parse must preserve them, same as Gloss/MSeg/MGloss. (Subject was here too until it moved to MISC; it is preserved by the `keep` list below instead — see raiseGet/raiseSet, js/core/prefs.js.)
/* ⚠ SUD'S OWN MISC LAYER IS DERIVED FROM A TREE — AND THIS FUNCTION THROWS THE PARSER'S TREE AWAY.
   The released SUD parsers now predict Idiom/InIdiom/Subject/Reported (app/parse.py's _SUD_MISC_KEYS), and every
   one of the four is read off the analysis the model itself produced: Idiom is "has ExtPos AND has an `unk`
   dependent", InIdiom is "attaches by `unk` under such a head", Subject names an embedded predicate's raised
   argument, Reported a speech verb's verbatim complement. reparseTokenFields asks the parser to refill the
   MODEL-DERIVED FIELDS on the reader's own tokens and adopts none of its heads or relations, so those four
   answers describe a tree that is discarded a line later — a fresh Subject=SubjRaising drawn as a ghost edge
   across an attachment the reader made themselves is not a weaker annotation, it is a claim about a sentence
   nobody is looking at. They are therefore CLEARED from the parser's MISC here and the reader's own restored by
   `keep` below; a FULL parse (doInsert/insertParsed/reparse/commitSentText, which replace s.tokens wholesale
   together with the tree they belong to) takes all four exactly as the model wrote them. */
const SUD_TREE_MISC=["Idiom","InIdiom","Reported","Subject"];
async function reparseTokenFields(si,tokIds,opts){
  opts=opts||{};
  if(!(hasBridge()&&model)) return false;
  const s=DOC[si]; if(!s)return false;
  /* PRE-TOKENISED, and that is the whole point of this call. The tokens are the annotation — the
     heads, the relations and every tier hang off these exact ones — so the parser is asked to fill
     the fields ON them, not to have its own opinion about where they are. This used to send
     `forms.join(" ")` to the ordinary parse endpoint and check the count afterwards, which is a
     detector rather than a fix, and in a SPACELESS SCRIPT it fired constantly: the tokeniser is a
     segmenter there and a space is not evidence it must respect, so editing 苹果 to 苹果汁 came back
     as 苹果 + 汁, the count check failed, and the token's lemma/XPOS/FEATS were never refreshed at
     all — silently, with no way to ask again. Bypassing the tokeniser makes the alignment 1-to-1 by
     construction (app/parse.py's parse_pretokenized). */
  const forms=s.tokens.map(t=>t.form||"");
  if(!forms.some(f=>f)) return false;
  /* ⚠ AND THE READER'S OWN WORD CLASSES GO WITH THEM, which is what makes a RETAG mean anything.
     Sending the forms alone asks the model to re-analyse a sentence it has already analysed, so it
     answers exactly as before: after retagging 行 from NOUN to VERB the FEATS and the lemma that came
     back were still the noun's, and the re-parse was a no-op wearing the look of a refresh. With the
     tags attached, `parse._force_upos` takes the model's own best analysis OF THAT CLASS — a
     constraint on its answer, not a replacement for it. Sent on every call, not only after a retag:
     `opts.upos` (the split-token path) is the one caller that wants the parser's own class instead, and
     it says so by asking for it. */
  const uposIn=opts.upos?null:s.tokens.map(t=>trUpos(t));
  showBusy("Parsing…"); let r;
  try{ r=await window.pywebview.api.parse_tokens(forms,model,uposIn); }catch(e){ return false; }finally{ hideBusy(); }
  if(!r||!r.parsed||!r.tokens||r.tokens.length!==s.tokens.length) return false;   // belt and braces: a pipeline that rebuilt the Doc anyway must not be aligned against
  const targets=tokIds?new Set(tokIds):null;
  s.tokens.forEach((t,i)=>{ if(targets && !targets.has(i+1)) return; const p=r.tokens[i]; if(!p)return;
    const oldFeatsStr=t.feats;   // captured BEFORE PARSE_FIELDS overwrites it below — Task B needs the pre-regen value to retarget MGloss in place, same shape featsSyncGloss's caller already supplies for a live FEATS-cell edit
    /* `Unsandhied` joined this list for the reason SpaceAfter below is restored separately: this function
       re-parses the sentence's forms JOINED WITH SPACES and never re-tokenises, so the parser is answering
       about each form as a FREE-STANDING word. That is the wrong question for a component inside a
       multi-word token, which is stored in pausa and whose neighbours are inside the same orthographic
       word — and the right answer was computed moments earlier, with the real neighbour reading
       (saSyncUnsandhied, called from afterFormEdit). Without this the parser's MISC overwrote the column
       wholesale and the pausa spelling simply vanished on every form edit; `if(vv)` means a token that had
       none still takes whatever the parser offers. */
    const keep={}; ["Gloss","MSeg","MGloss","Reported","CorrectForm","NewPar","Subject","Idiom","InIdiom","Unsandhied"].forEach(kk=>{ const vv=miscKV(t.misc,kk); if(vv) keep[kk]=vv; });   /* Subject joined this list when the raising feature moved out of FEATS: `misc` is in PARSE_FIELDS, so the parser's own MISC overwrites the column wholesale, and a drag-set raising annotation would be silently lost by the next background re-parse — exactly what GESTURE_FEATS protects on the FEATS side. */   // item 3: the parser's MISC doesn't carry the annotation tiers, so writing it raw would wipe them — preserve the user's lexical gloss + morphemic segmentation/gloss, reported-speech marker, typo correction and mid-sentence paragraph break across a re-parse (e.g. after a Form edit); only a full re-parse may clear these
    if(t._trPick){ const tv=miscKV(t.misc,"Translit"); if(tv) keep.Translit=tv; }   // …and a HAND-CORRECTED stored transliteration is the user's in exactly the same way (a Han heteronym, a kanji reading, an unwritten short vowel): it belongs to the annotator, not to the parser. Only conditional because every OTHER token's Translit is derived and SHOULD be regenerated — annotateTranslitMisc, at the end of this function, does that. It also reads a _trPick token's value back FROM MISC, so without this line the correction would be lost here and then replaced by whatever the displayed row happens to hold (a different scheme in general)
    const spAfter=miscKV(t.misc,"SpaceAfter");   // SpaceAfter survives a re-parse VERBATIM — its absence as much as its value (hence the restore below, not a `keep` entry). This function re-parses the sentence's forms JOINED WITH SPACES and never re-tokenises, so the parser has nothing to say about spacing here: taking its answer would silently drop every SpaceAfter=No in the sentence. Only a full re-parse (doInsert/reparse/commitSentText — they replace s.tokens wholesale, from the real text) may regenerate it
    const keepFeats={}; GESTURE_FEATS.forEach(kk=>{ const vv=getFeat(t.feats,kk); if(vv) keepFeats[kk]=vv; });   // Shared/Subj are set by drag gestures, not the parser — a per-token regen must not silently clear them; only a full re-parse (doInsert/reparse/commitSentText, which replace s.tokens wholesale) may do that
    /* `opts.upos` — TAKE THE PARSER'S WORD CLASS TOO. Off by default, and that default is load-bearing:
       this function also runs right after a UPOS edit (regenTok), where overwriting UPOS would undo the
       very edit that called it. A freshly SPLIT token is the case where there is no choice to protect —
       the head carries the analysis of the whole word it used to be, the other pieces carry a placeholder,
       and neither was ever chosen for the piece it now sits on. */
    (opts.upos?PARSE_FIELDS.concat("upos"):PARSE_FIELDS).forEach(k=>{ if(k==="xpos"&&XPOS_MIRRORS_UPOS){ t.xpos=t.upos; return; }   // this doc's XPOS just mirrors UPOS → the parser's own xpos guess must never win; keep it downstream of (this token's current) UPOS on every regen, not just at the moment UPOS was edited
      if(p[k]!=null){ const v=p[k]; t[k]=(v===""&&(k==="deps"||k==="misc"))?"_":v; } });
    Object.keys(keepFeats).forEach(kk=>{ t.feats=setFeat(t.feats,kk,keepFeats[kk]); });
    SUD_TREE_MISC.forEach(kk=>{ t.misc=setMiscKV(t.misc,kk,""); });   // …the tree-derived layer the parser just wrote about a tree we discarded (see SUD_TREE_MISC) — dropped BEFORE the restore below, so the reader's own value is what survives
    Object.keys(keep).forEach(kk=>{ t.misc=setMiscKV(t.misc,kk,keep[kk]); });
    t.misc=setMiscKV(t.misc,"SpaceAfter",spAfter);   // …and put the token's OWN spacing back over whatever the parser wrote ("" removes the key, so a token that had no SpaceAfter keeps none)
    const seg=msegPrefillParts(t);   // the re-parse may have handed this token a NEW lemma, so re-derive the segmentation once here and let both morphemic rows below read the same answer (as morphPrefillSent does)
    // Task B — an EXISTING MGloss survives a re-parse via IN-PLACE RETARGETING ONLY (the same restraint
    // featsSyncGloss/uposSyncGloss use for a live edit), never a wholesale composeMGloss rebuild: the old code
    // recomposed the WHOLE grammatical run from FEATS_ORDER on every Form/UPOS-triggered background reparse,
    // which silently reshuffled any abbreviation order the user had already settled and could lose a hand-
    // placed segmentation hyphen. opts.skipGloss (set by a caller whose edit is purely structural — a head/
    // deprel reattach, e.g. attachAsSharedConjunct — is never allowed to touch MGloss/Gloss at all, Task B)
    // skips this whole block outright, leaving the tier exactly as `keep` already restored it above.
    if(!opts.skipGloss){
      if(keep.MGloss){ let mg=retargetGlossForFeatsChange(keep.MGloss,oldFeatsStr,t.feats,t.upos);   // symmetric: the categories this re-parse dropped go, the ones it introduced arrive
        if(opts.regloss) mg=mglossReglossLexical(t,mg);   // …and only a RETAG can move the token across the open/closed-class line that decides whether it carries a stem gloss at all — set by the two UPOS-edit call sites, since a form edit's background re-parse never changes the word class
        if(mg!==keep.MGloss) t.misc=setMiscKV(t.misc,"MGloss",mg); }
      else if(MORPH_ON){ const lex=(GLOSS_ON&&!UPOS_LEIPZIG_ABBR[t.upos])?miscKV(t.misc,"Gloss").replace(/-/g,"_"):"";   // nothing to preserve → compose one fresh, exactly as before (a token that had NO MGloss yet gets one, the same way morphPrefillSent would)
        const mg=glossEnc(composeMGlossPrefill(lex,t.feats,t.upos,seg));
        if(mg) t.misc=setMiscKV(t.misc,"MGloss",mg); } }
    msegRefill(t); });   // …and the segmentation tier alongside it, so the two morphemic rows never come back half-filled. Item 3: a REFILL, not a fill-if-empty — this is the path a form edit's background re-parse takes to revise the token's LEMMA, and the segmentation is computed from that lemma, so an MSeg still holding its previous auto-prefill has to follow it. msegRefill is what refuses to touch one the user has since typed over
  await annotateTranslitMisc(si); if(show.translit)fillTranslit();   // item 5: a secondary pass (re)writes MISC Translit/LTranslit + refills the display row
  return true; }
// re-run the parser for one token after any change to its Form/UPOS — from the grid OR the diagram (no-op
// without a model). Task B: no longer called for a head/deprel edit at all (purely structural, and this is the
// one path that reparses lemma/feats/deps) — see setAsRoot/stepHead (js/editing/edit-ops.js), setDiagramHead
// (js/diagram/diagram-edit.js) and the grid's own commitCell, all of which used to route a head/deprel commit
// through here too. `opts` (e.g. {skipGloss:true}) passes straight through to regenSecondaries.
function regenTok(si,tokId,opts){ if(hasBridge()&&model) reparseTokenFields(si,[tokId],opts).then(ok=>{ if(ok)preserveScroll(renderDoc); });
  if(isSanskritLang()){ const m=(DOC[si]&&DOC[si].mwt||[]).find(x=>tokId>=x.from&&tokId<=x.to); if(m) sandhiMwtForms(si,[m.from]); } }   // item 8: a component-form edit re-fuses the containing MWT's stored surface form by external sandhi
// After a token's FORM changes, its cached romanisation / script glyph / MISC Translit are stale for the new form.
// Clear them and recompute — transliteration is LANGUAGE-driven, so it refreshes even with NO parser model — and
// re-prefill the morphemic segmentation (MSeg) from the new form where it was still the auto-derived value.
async function afterFormEdit(si,tokId,changed){ const s=DOC[si], t=s&&s.tokens[tokId-1];
  if(!t) return;
  if(!changed) return;   // no net change (a cancelled edit, or a keystroke that nets out to the original form) → nothing is stale, so no re-parse either
  await stextAfterFormEdit(si,tokId);   // …and `# text` follows the form: the running sentence spells this word, so leaving it on the OLD spelling is the file disagreeing with itself. FIRST, before any of the refreshes below — fillOrtho rebuilds the Sanskrit running line FROM s.text (s.orthoLine), so a splice after it would leave that line a version behind
  t.translit=""; t.translitLemma=""; t.ortho=""; t._trMisc=false; t._trPick=false;     // drop the stale caches so the fills recompute — including a hand-picked CJK reading (js/lang/readings.js), which was a statement about the OLD form and says nothing about the new one
  t.misc=setMiscKV(setMiscKV(t.misc,"Translit",""),"LTranslit","");                     // stale MISC Translit for the old form (rewritten below)
  // item A: refresh the LANGUAGE-driven secondaries IMMEDIATELY — a single-token form edit doesn't change the
  // token count, so no re-tokenisation is needed; the transliteration / script / MSeg update at once instead of
  // after the (slower) parser round-trip.
  /* ⚠ THE RE-RENDER IS IN A `finally`, and that is the whole point of the block. Six awaited bridge
     calls stand between the edit and the redraw, every one of which can fail for a reason that has
     nothing to do with the edit — an engine whose extras tier is not installed, a model that is not
     there, a Sanskrit path that throws on one odd token. Any of them throwing used to skip the
     `preserveScroll(renderDoc)` below, and then the MODEL held the new form while the GRID still
     showed the old one: the reported symptom exactly, an IAST correction that reaches the diagram
     (where the editor wrote it in place) and never reaches the Form column.
     The redraw is not part of the refresh — it is how the user sees the edit they already made, so it
     has to survive the refresh failing. Each derived field is separately best-effort inside; what is
     NOT optional is drawing the document as it now stands. */
  try{
    if(show.translit) await fillTranslit();                                             // romanisation of the new form
    await annotateTranslitMisc(si);                                                     // rewrite MISC Translit/LTranslit
    if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho();            // re-render the script glyph from the new form
    if(msegRefill(t)|msegMirrorSeams(t)) markDirty();   // …and a seam typed into the form is carried into MSeg (msegMirrorSeams), AFTER the refill, which segments against the lemma and cannot know about a clitic boundary   // MSeg re-seeds from the NEW form (its transliteration for non-Latin scripts), re-segmented against the lemma — which the background re-parse below may then revise again once it hands this token a lemma of its own (item 3)
    if(isSanskritLang()){ await saSyncUnsandhied(si,tokId);   // …and the pausa spelling, which is a spelling OF the form and so cannot outlive it (see saSyncUnsandhied). BEFORE the re-fuse below: a range's CSL is built from its components' Unsandhied values, so fusing first would rebuild it from the one this edit just invalidated
      const m=(s.mwt||[]).find(x=>tokId>=x.from&&tokId<=x.to); if(m) sandhiMwtForms(si,[m.from]); }   // item 8: re-fuse a containing MWT
  }catch(err){ console.error("afterFormEdit: a derived field failed to refresh",err); }
  /* …and the redraw itself steps aside for an OPEN EDITOR. Six awaited bridge calls stand between the commit
     and here, which is ample time for the reader to have clicked into the next field — and this render would
     then destroy the field they are typing in, to show refreshes of the token they have already left. The
     edit itself is on screen regardless: makeEditable's own `finish` rendered before calling this. */
  finally{ renderUnlessEditing(); }
  // item A: THEN re-run the parser in the BACKGROUND for the model-derived fields (lemma/feats/deps); the
  // transliteration is already on screen, so it never waits on the parse.
  if(hasBridge()&&model) reparseTokenFields(si,[tokId]).then(ok=>{ if(ok)renderUnlessEditing(); }); }   // …and NOT over an open inline editor: this lands seconds later, by which time the reader is usually typing in the next field (renderUnlessEditing, js/ui/wiring.js)
// After a token's LEMMA changes, its cached lemma-romanisation (translitLemma) / MISC LTranslit are stale, and so
// is the morpheme segmentation, which is computed FROM the lemma. Mirrors afterFormEdit's Translit refresh, scoped
// to the lemma-derived half — the form's own Translit and ortho are untouched, and there's no re-parse (the lemma
// is itself the field the user just hand-edited, so the parser has nothing to add).
async function afterLemmaEdit(si,tokId){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return;
  t.translitLemma="";                                     // drop the stale cached lemma-translit (displayed scheme)
  t.misc=setMiscKV(t.misc,"LTranslit","");                 // stale MISC LTranslit for the old lemma (rewritten below)
  if(show.translit) await fillTranslit();                  // romanisation of the new lemma
  await annotateTranslitMisc(si);                          // rewrite MISC Translit/LTranslit
  if(msegRefill(t,true)) markDirty();                      // item 17: FORCED — a direct lemma edit always re-derives MSeg from it, even over a hand correction (unlike the form-edit/background-reparse callers of msegRefill, which still defer to one). AFTER annotateTranslitMisc, never before: on a non-Latin document the comparison runs on MISC Translit/LTranslit, and LTranslit is what that call has just rewritten
  preserveScroll(renderDoc); }
// item 8: for Sanskrit, an MWT's STORED surface form (grid Form cell + the file) is its component forms fused by external
// sandhi (ahaḥ+rātra → ahorātra, sat+ādi → sadādi), NOT a naive concatenation. Recompute it via the backend and write it
// to m.form. scheme="" asks for the fusion in the DOCUMENT'S OWN script — Devanagari for a Devanagari file, IAST for an
// IAST one — which is what belongs in a FORM column; `r.ortho` (the scripted display form) is fillOrtho's business, not
// this function's. `froms` limits the recompute to specific MWTs (null ⇒ all).
async function sandhiMwtForms(si,froms){ if(!isSanskritLang()||!hasBridge()||!DOCLANG) return false;
  const s=DOC[si]; if(!s||!s.mwt) return false;
  const lemOf=t=>((t.lemma&&t.lemma!=="_")?t.lemma:"");   // the CoNLL-U lemma is an r-stem signal for visarga sandhi
  /* THE NEIGHBOURING ORTHOGRAPHIC WORDS, so the fusion can finish the range's OUTER edges. A word's
     first and last segments are shaped by the words either side of it, not only by its own components:
     `…bhṛtaḥ` is written `…bhṛto` before a voiced consonant, `aṅghri…` opens `'ṅghri…` after an -o,
     `caraṇāḥ` → `caraṇāś` before c-, `iti` → `ity` before a vowel. Fusing the components alone spells
     both ends in pausa, which is the one place a running text never spells them that way.
     A neighbour is an ORTHOGRAPHIC word — the containing MWT's surface form where the adjacent token is
     inside one, its own form otherwise — because that is the unit sandhi applies between.
     ⚠ A DAṆḌA IS SKIPPED, NOT TREATED AS A STOP. It is punctuation, not a word, and in this data the
     junction fires straight across it (and across the line break that follows): the sample writes
     `…uro hṛtkroḍavāsobhṛto |⏎bastir…`, where `bhṛtaḥ` became `bhṛto` because `bastir` — the next real
     word, one daṇḍa and one newline away — begins with a voiced consonant. Stopping at the daṇḍa left
     that edge in pausa and was the one junction this pass still got wrong. */
  /* …and WHICH SANDHI each inner junction takes, which is not uniform across a range: FEATS
     `Compound=Yes` marks a BOUND member, so the junction after it is compound-INTERNAL rather than one
     between two words. Only the -n gemination tells the two apart (`asmin`+`eva` → `asminneva` between
     words; `an`+`anta` → `ananta`, not `annanta`, inside a compound) — see app/translit.py's
     _sandhi_preprocess. An MWT formed by coalescent external sandhi has the flag on none of its members
     and is fused exactly as before. */
  const compOf=t=>/(?:^|\|)Compound=Yes(?:\||$)/.test(t.feats||"");
  const groups=[],lgroups=[],refs=[],prevs=[],nexts=[],pauses=[],bounds=[];
  s.mwt.forEach(m=>{ if(froms&&froms.indexOf(m.from)<0) return; const cts=s.tokens.slice(m.from-1,m.to).filter(t=>t.form); if(cts.length){
    const cx=saMwtContext(s,m);   // js/lang/translit.js — shared with fillOrtho so the FORM and its GLYPH agree
    groups.push(cts.map(t=>t.form)); lgroups.push(cts.map(lemOf)); refs.push(m); bounds.push(cts.map(compOf));
    prevs.push(cx.prev); nexts.push(cx.next); pauses.push(cx.pause); } });
  if(!groups.length) return false;
  let r; try{ r=await window.pywebview.api.sanskrit_mwt(groups,DOCLANG,"",lgroups,"",prevs,nexts,pauses,bounds); }catch(e){ return false; }
  let any=false; refs.forEach((m,i)=>{ delete m._kept;   // an EDIT (or a parse) asked for this re-fuse, which is new evidence — it overrides an undo-restored form (see applySnap)
    const f=r&&r.form&&r.form[i]; if(f&&f!==m.form){ m.form=f; m.ortho=""; m.miast=""; any=true; } });   // clear the cached display forms so fillOrtho re-renders them from the new fused form
  if(any){ markDirty(); if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho(); else preserveScroll(renderDoc); }
  return any; }

/* ── A MERGE INSIDE A SANSKRIT RANGE IS A SANDHI FUSION, NOT A CONCATENATION ─────────────────────────
   Merging asserts that two pieces are written as one, and in Sanskrit that is exactly the environment
   the sandhi rules describe: `sat`+`ādi` is written `sadādi`, `ahaḥ`+`rātra` `ahorātra`. Gluing the
   strings gives the right answer only where the junction happens to be inert.

   ⚠ INSIDE A MULTI-WORD TOKEN ONLY, which is the one place the app DERIVES a Sanskrit spelling rather
   than reading it. The convention this file follows (DCS) stores a component in PAUSA and lets the
   RANGE's surface carry the sandhi, so re-deriving a component is answering the question the file
   already poses. A STANDALONE token's form is what `# text` says it is — that is precisely why
   `mergeTokens` can concatenate there without respliceing the line — and re-deriving it by sandhi would
   put a spelling in the file that the running sentence contradicts.

   ⚠ THE INPUT IS THE PAUSA FORMS, and the edges stay in pausa. `mergeTokens` reads MISC `Unsandhied`
   where there is one and the form otherwise (feeding a sandhied surface back through a sandhi generator
   applies the rules twice — the same rule app/sa_notation.py's `csl_forms` follows). No neighbouring
   words are supplied: external sandhi belongs to the range's own surface, which `sandhiMwtForms`
   re-fuses here once the survivor has settled, one member shorter than before.

   Fire-and-forget, no undo entry of its own (it belongs to the merge's snapshot, pushed before it), and
   a no-op with no bridge — the plain concatenation `mergeTokens` already wrote then stands. */
async function sandhiMergeForm(si,tokId,forms,lemmas){
  if(!isSanskritLang()||!hasBridge()||!DOCLANG) return false;
  const s=DOC[si], t=s&&s.tokens[tokId-1];
  if(!t||!forms||forms.length<2||!forms.every(f=>f)) return false;
  const inM=(s.mwt||[]).find(x=>tokId>=x.from&&tokId<=x.to); if(!inM) return false;
  const lg=lemmas||forms.map(()=>"");
  let r; try{ r=await window.pywebview.api.sanskrit_mwt([forms],DOCLANG,"",[lg],"",[""],[""],[false],[null]); }
  catch(e){ return false; }
  if(DOC[si]!==s||s.tokens[tokId-1]!==t) return false;   // an undo, an open, another edit landed while the call was out
  const fused=r&&r.form&&r.form[0];
  if(!fused) return false;
  if(fused!==t.form){ t.form=fused;
    t.translit=""; t.translitLemma=""; t.ortho=""; t._trMisc=false; t._trPick=false;   // a romanisation of the unfused string says nothing about the fused piece (afterFormEdit drops these for the same reason)
    t.misc=setMiscKV(setMiscKV(t.misc,"Translit",""),"LTranslit",""); }
  t.misc=setMiscKV(t.misc,"Unsandhied","");   // a component is STORED in pausa, so its form is its pausa: the head's old Unsandhied described one piece and would now describe the merged whole — the stale `-tve` trap documented below
  markDirty();
  await sandhiMwtForms(si,[inM.from]);   // …and the orthographic word ABOVE the survivor is one member shorter, so its own surface has to be re-fused from what is left
  if((ORTHO_SCHEME&&ORTHO_SCHEME!=="none")||isSanskritLang()) fillOrtho(); else preserveScroll(renderDoc);
  return true; }
/* MISC `Unsandhied` FOLLOWS THE FORM, because it is a spelling OF the form — the padapāṭha, the word as
   it stands in citation. Edit the form and the old pausa describes a word that is no longer there, which
   is not a harmless staleness: app/sa_notation.py's csl_forms PREFERS Unsandhied over the form (feeding
   a sandhied surface back through a sandhi generator would apply the rules twice), so every CSL rendering
   goes on believing the value the edit invalidated. That is the same trap the flatten had, where a
   left-behind `Unsandhied=-tve` made a whole `mūrtitve` read as `tve`.
   WHICH VALUE depends on where the token sits, and the two cases are the DCS convention read straight off:
     · inside a multi-word token — the component is ALREADY stored unsandhied, so its pausa is its form;
     · on its own — the form carries the external sandhi of the word after it, so the pausa is that undone
       (sanskrit_desandhi, which declines wherever the reversal is ambiguous and hands the form back).
   Punctuation is written as an EMPTY value rather than as itself, which is what the shipped samples do
   (`8 | | PUNCT … Unsandhied=`): a daṇḍa has no citation form to give. */
async function saSyncUnsandhied(si,tokId){
  if(!isSanskritLang()||!DOCLANG) return false;
  const s=DOC[si], t=s&&s.tokens&&s.tokens[tokId-1]; if(!t||!t.form) return false;
  let un;
  if(!/\p{L}/u.test(t.form)) un="";                                      // a daṇḍa or other mark — no citation form
  else if((s.mwt||[]).some(x=>tokId>=x.from&&tokId<=x.to)) un=t.form;    // a component is stored in pausa already
  else if(!hasBridge()) return false;                                    // only the backend can undo sandhi — leave the old value rather than write a wrong one
  else { const cx=saMwtContext(s,{from:tokId,to:tokId});                 // …the same neighbour/pause reading a range gets, with the token standing as its own range
    let r=null; try{ r=await window.pywebview.api.sanskrit_desandhi(t.form,DOCLANG,(t.lemma&&t.lemma!=="_")?t.lemma:"",cx.next,cx.pause,t.upos||""); }catch(e){ return false; }
    un=(r&&r.form)||t.form; }
  if(miscKV(t.misc,"Unsandhied")===un) return false;
  t.misc=setMiscKV(t.misc,"Unsandhied",un); markDirty(); return true; }

/* THE COMPONENTS OF A FRESHLY SPLIT SANSKRIT RANGE, PUT BACK INTO PAUSA.
   A token that is its own orthographic word carries its SANDHIED surface in FORM; a token inside a
   multi-word token is stored UNSANDHIED (the DCS convention — CLAUDE.md). So the moment a split turns one
   into the other, the piece holding the end of the word is still spelt as the FOLLOWING word made it spell
   itself, and only that piece is: the interior junctions are compound-internal, and whatever the preceding
   word did is written on the preceding word. `janmanāṃ` becomes `janmanām`, `bhṛto` becomes `bhṛtaḥ`.
   Nothing is lost by it — the range's own form still spells what the text spells, because sandhiMwtForms
   re-fuses it from the components and the reversal is exactly what that fusion undoes (measured: 68 of 68
   ranges in both samples reproduce their original surface after a revert-and-re-fuse).
   The neighbour and the pause come from saMwtContext, the same reading sandhiMwtForms fuses against, so the
   two cannot disagree about which word follows this one or whether a daṇḍa stands between them. */
async function sandhiSplitPausa(si,from){
  if(!isSanskritLang()||!hasBridge()||!DOCLANG) return false;
  const s=DOC[si]; if(!s) return false;
  const m=(s.mwt||[]).find(x=>x.from===from); if(!m) return false;
  const comps=s.tokens.slice(m.from-1,m.to).filter(t=>t.form); if(comps.length<2) return false;
  const cx=saMwtContext(s,m);
  /* EVERY COMPONENT, not just the last. A component is stored in pausa, and a form's ending is shaped by
     whatever FOLLOWS it — which for the last component is the next orthographic word, and for every other
     is the next COMPONENT. So `manoratha` divided as `mano=ratha` wants `manaḥ` + `ratha`, and reverting
     only the outer edge would have left the interior junction spelt as the compound spells it.
     Each is asked against its own right-hand neighbour, and `pause_after` is the range's only at the outer
     edge — a pause can only follow the WORD, never sit between two pieces of one.
     Right to left, so a component is measured against the neighbour as it will finally be stored rather
     than against a spelling that is itself about to change. Each answer is independent (desandhi_final
     verifies a candidate against the forward transform for THAT junction), but the order costs nothing and
     removes the question. */
  let any=false;
  for(let i=comps.length-1;i>=0;i--){ const c=comps[i], lastOne=(i===comps.length-1);
    const nxt=lastOne?cx.next:(comps[i+1].form||""), pause=lastOne?cx.pause:false;
    let r=null;
    try{ r=await window.pywebview.api.sanskrit_desandhi(c.form,DOCLANG,(c.lemma&&c.lemma!=="_")?c.lemma:"",nxt,pause,c.upos||""); }catch(e){ continue; }   // …and the UPOS, which decides whether the pausa column takes the citation form or the inflected one (Api.sanskrit_desandhi)
    const p=r&&r.form;
    /* THE PAUSA SPELLING IS RECORDED EITHER WAY, because after this pass a component's form IS its pausa —
       that is the whole point of the pass — and a token the reversal had nothing to do to is no less
       entitled to the column than one it changed. One that already HAS a value keeps it: the split divides
       the head's own Unsandhied where it carries seams, and that is the annotator's. Punctuation is skipped
       rather than given its own glyph, matching saSyncUnsandhied — a daṇḍa has no citation form. */
    if(/\p{L}/u.test(c.form) && !miscKV(c.misc,"Unsandhied"))
      c.misc=setMiscKV(c.misc,"Unsandhied",p||c.form);
    if(!p||p===c.form) continue;                        // ambiguous, or nothing to undo — desandhi_final declines rather than guesses
    c.form=p; any=true;
    c.translit=""; c.translitLemma=""; c.ortho=""; c._trMisc=false; c._trPick=false;   // every derived field spelt the sandhied form
    c.misc=setMiscKV(setMiscKV(c.misc,"Translit",""),"LTranslit","");
    /* …and MSeg, which SEGMENTS the form and so cannot outlive it: this just respelt `bhṛto` as `bhṛtaḥ`, and a
       segmentation of the old spelling now names morphemes the token no longer has. Unforced, exactly as a form
       edit refills it — a hand-typed segmentation is the annotator's and is left alone; the split's own
       division marks itself as ours (see convertTokenToMWT) so that this can replace it. */
    if(typeof msegRefill==="function") msegRefill(c);
  }
  /* …AND THE RANGE IS RE-FUSED WHETHER OR NOT ANY COMPONENT MOVED. Returning early when nothing needed
     reverting left the range holding `origForm` — which convertTokenToMWT sets from the form as TYPED,
     seam and all — so a split whose pieces were already in pausa published `punar=janmanām` as the
     orthographic word. The fusion is what takes the seam out (translit._sandhi_preclean) and it must run
     on every split, not only on the ones that happened to change something. */
  if(any) markDirty();
  await sandhiMwtForms(si,[from]);                      // re-fuse: the range's surface must still be what the text spells
  if(typeof fillTranslit==="function") await fillTranslit();
  if(typeof fillOrtho==="function") await fillOrtho(); else preserveScroll(renderDoc);
  return true; }

/* THE LEMMA OF A FLATTENED SANSKRIT MULTI-WORD TOKEN — its components' lemmas FUSED BY SANDHI.
   Flatten makes one word out of n, so its lemma is the n lemmas made one word, and in Sanskrit that is a
   sandhi question rather than a concatenation: `ātman`+`vid` is `ātmavid`, `manas`+`ratha` is
   `manoratha`. `bound` carries FEATS Compound=Yes per component, which is what tells sandhi_join that
   the junction after that member is compound-internal (see flattenMWT's note, and _sandhi_preprocess).
   ⚠ NO NEIGHBOUR CONTEXT and `pause_after` TRUE, unlike sandhiMwtForms: a lemma is a citation form, not
   a word standing in a running line, so its two edges are spelt in PAUSA — finishing them against the
   words either side would put this token's sentence position into a dictionary form.
   The fused string comes back in the document's own script (sandhi_join romanises in and renders out),
   so it can go straight into the LEMMA column beside a Devanagari form. */
async function sandhiFlattenLemma(si,tokId,fu){
  if(!isSanskritLang()||!hasBridge()||!DOCLANG||!fu) return false;
  const s=DOC[si], t=s&&s.tokens&&s.tokens[tokId-1]; if(!t) return false;
  let changed=false;
  const lems=(fu.lemmas||[]).filter(Boolean);
  if(lems.length>=2){   // one lemma (or none) is already the answer the placeholder gave — nothing to fuse
    let r=null; try{ r=await window.pywebview.api.sanskrit_mwt([fu.lemmas],DOCLANG,"",[fu.lemmas],"",[""],[""],[true],[fu.bound]); }catch(e){}
    const fused=r&&r.form&&r.form[0];
    if(fused&&fused!==t.lemma){ t.lemma=fused; t.translitLemma=""; changed=true; } }
  /* …and THE DERIVED ROWS, WHICH RUN WHETHER OR NOT THE LEMMA MOVED. flattenMWT blanked translit/ortho
     precisely so they would be re-derived from the fused form, and this is the only thing that re-derives
     them — an early return on an unchanged lemma left the transliteration row EMPTY, which is worse than
     the wrong value it replaced (measured on the Devanagari sample: every one of its 35 ranges). */
  if(typeof fillTranslit==="function") await fillTranslit();
  if(typeof fillOrtho==="function") await fillOrtho();
  if(changed) markDirty();
  return changed; }

/* ── A FORM EDIT REACHES THE RUNNING SENTENCE ───────────────────────────────────────────────────────────
   The rule about WHICH edits reach `# text`, and why, is written out once over stxWriteSpans in
   js/core/document.js — read it there. This is the half that needs the bridge: locating the stretch is a
   local walk, but rewriting a SANSKRIT one is not, because there the string in the text is the components
   fused by sandhi and only the backend knows how to fuse them.
   UNDO AND DIRTY: the caller owns the pushUndo — every path that reaches here (the grid cell's pendingSnap,
   the inline field editor's) has already snapshotted the document before mutating the form, and the text
   change belongs to that same edit, so one undo takes both back. markDirty fires only on a splice that
   actually changed the string. A no-op edit never gets here at all (afterFormEdit's `changed` guard). */
// Sanskrit compound separators, carried through the fusion as placeholders. Api.sanskrit_mwt's `word_sep`
// is what a NON-fusing junction keeps, so the inner join can be asked for "-" or "|" directly — but the
// OUTER join (the junctions with the neighbouring words) re-preprocesses its inputs, and that preprocessing
// STRIPS hyphens and pipes ("circumflex/apostrophe/hyphen/pipe cleanup", app/translit.py's sandhi_join), so
// an already-hyphenated compound handed to it comes back with its members welded together. A control
// character survives that untouched — measured: sandhi_join(["parikalpitaḥ","śaśa\u0001bhṛtaḥ","vartmā"]," ")
// → "parikalpitaḥ śaśa\u0001bhṛto vartmā", i.e. the junction fused and the seam was left alone — and no form
// can contain one, so the two are restored at the very end. One placeholder PER SEPARATOR (not per unit):
// after the fusion there is no telling which unit a mark came from, and a stretch may legitimately hold one
// hyphenated compound beside a piped one. Written as ESCAPES, as the U+2009 substitution in
// js/core/document.js is: a literal control character in the source is invisible at a glance.
const _STX_PH={"-":"\u0001","|":"\u0002"};
const _STX_UNPH=/[\u0001\u0002]/g, _STX_PH_BACK={"\u0001":"-","\u0002":"|"};
const _STX_CTRL=/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;   // …and what a stretch must never contain once those are restored. TAB/CR/LF are left out deliberately: a real newline in s.text is a display line break the sentence legitimately carries (getDocJSON re-escapes it on save)
const _STX_BUSY=new Set();   // one write-back per sentence at a time: afterFormEdit runs on EVERY keystroke and the Sanskrit path awaits the bridge, so two in flight would splice out of order. A dropped one costs nothing — the next keystroke rewrites the whole unit from the forms as they then stand
/* SANSKRIT: the string that goes into the text, and the stretch it replaces.
   The unit itself is its component forms fused by sandhi and joined by the MWT's remembered separator
   (mwtSepOf) — Api.sanskrit_mwt with that separator as `word_sep`, which is the same call sandhiMwtForms
   makes for the STORED surface form, only with the compound seams kept instead of glued.
   THEN THE JUNCTIONS WITH THE NEIGHBOURING WORDS, which is the part that has to be held on a leash. External
   sandhi is not a property of one word: re-fusing a junction rewrites BOTH sides, so the stretch has to grow
   to cover the neighbour — and only the neighbour whose junction this edit can actually have moved (the one
   before the unit if its FIRST component changed, the one after if its LAST did; an interior component
   touches neither). It never crosses a line break (sandhi does not fire across one) and never absorbs a
   PUNCT unit (a daṇḍa is not a word to fuse with).
   AND IT IS REFUSED WHEN IT WOULD WELD WORDS TOGETHER. app/translit.py's fuser glues every consonant-final
   word onto the next, which is right for the block-initial RUNNING LINE it was written for and wrong for
   `# text`: regenerating samples/brihat_jataka.conllu's first sentence that way turns
   "ātma-vidāṃ kratuś ca yajatāṃ" into "ātmavidāmkratuścayajatām" — after which no unit's form is a substring
   of the line any more, the literal alignment refuses the whole sentence, the decorations go with it, the
   badge goes up and no further write-back is possible. The word count of the fused stretch is exactly
   the test for that: equal to the number of units in it ⇒ sandhi changed spellings at the junctions and
   nothing else, which is what we want; fewer ⇒ it welded, and we fall back to rewriting the unit alone. */
async function sanskritStretch(s,units,spans,text,k,tokId,kind){
  if(!hasBridge()||!DOCLANG) return null;
  const tokOf=id=>s.tokens[id-1]||{};
  const u=units[k];
  const ordinary=!u.mwt;
  const punct=u.ids.some(id=>tokOf(id).upos==="PUNCT");   // …and the unit being EDITED is punctuation just as often as a neighbour is (a verse daṇḍa is its own token). Fusing `yaḥ` + `|` + `vācaṃ` is not sandhi, it is nonsense — so a punctuation unit never grows a stretch either, and what goes back is the mark itself
  const touchesL=!punct&&(ordinary||kind==="mwt"||tokId===u.ids[0]);
  const touchesR=!punct&&(ordinary||kind==="mwt"||tokId===u.ids[u.ids.length-1]);
  const usable=i=>{ if(i<0||i>=units.length||!spans[i]) return false;
    if(units[i].ids.some(id=>tokOf(id).upos==="PUNCT")) return false;                       // a daṇḍa (or any punctuation) is not a word external sandhi applies to
    const g=text.slice(Math.min(spans[i][1],spans[k][1]),Math.max(spans[i][0],spans[k][0]));
    return g.length>0 && /^\s+$/.test(g) && g.indexOf("\n")<0; };                            // adjacent, whitespace only, and not across a display line break
  let lo=k, hi=k;
  if(touchesL&&usable(k-1)) lo=k-1;
  if(touchesR&&usable(k+1)) hi=k+1;
  const elems=[];
  for(let i=lo;i<=hi;i++){ const uu=units[i];
    const forms=uu.ids.map(id=>tokOf(id).form||"");
    if(forms.some(f=>!f)) return null;                                                       // an empty form in the stretch → nothing honest to write
    elems.push({i,forms,lemmas:uu.ids.map(id=>{ const t=tokOf(id); return (t.lemma&&t.lemma!=="_")?t.lemma:""; }),
                m:uu.mwt?((s.mwt||[]).find(x=>x.from===uu.ids[0])||null):null}); }
  // the INNER fusion, one bridge call per distinct separator present in the stretch (at most two)
  const bySep={};
  elems.forEach(e=>{ if(e.forms.length<2){ e.inner=dandaSpell(e.forms[0],s); return; }   // item 10: a daṇḍa goes back in the spelling THIS line uses (`|` or `/`), which the form column need not agree with — brihat_jataka writes `‖` in the form and `||` in the text. dandaSpell is inert on everything else, and on a sentence whose daṇḍa spelling was never read off the line
    const sep=mwtSepOf(e.m); (bySep[sep]||(bySep[sep]=[])).push(e); });
  /* ⚠ AN INNER FUSION IS IN PAUSA AT ITS EDGES, because it is asked without neighbours. That is right while
     an OUTER fusion is still to come — that pass is what reconciles the two ends against the words either
     side. It is wrong when this unit is the whole stretch, because then nothing reconciles anything and the
     pausa spelling is what gets spliced into a running line: `paṭudhiyāṃ`, whose -ṃ the following
     `horāphalajñāptaye` puts there, went into `# text` as `paṭudhiyām`. So the single-element case is given
     the same neighbour reading sandhiMwtForms fuses the range's own form against — one answer about what
     word follows this one, not two. */
  const solo=(()=>{ if(elems.length!==1) return null; const ids=units[elems[0].i].ids;   // token ids, not the unit index — saMwtContext walks the token list
    return saMwtContext(s,{from:ids[0],to:ids[ids.length-1]}); })();
  for(const sep of Object.keys(bySep)){ const g=bySep[sep];
    const cx=solo&&g.length===1;
    let r; try{ r=await window.pywebview.api.sanskrit_mwt(g.map(e=>e.forms),DOCLANG,"",g.map(e=>e.lemmas),_STX_PH[sep]||sep,
      cx?[solo.prev]:null, cx?[solo.next]:null, cx?[solo.pause]:null); }catch(_){ return null; }
    const ia=r&&r.form; if(!ia||ia.length!==g.length) return null;
    g.forEach((e,n)=>{ e.inner=ia[n]; }); }
  if(elems.some(e=>!e.inner)) return null;
  let out=elems.find(e=>e.i===k).inner, parts=null;
  if(elems.length>1){
    let r; try{ r=await window.pywebview.api.sanskrit_mwt([elems.map(e=>e.inner)],DOCLANG,"",
      [elems.map(e=>e.lemmas[e.lemmas.length-1])]," "); }catch(_){ r=null; }                 // each element's lemma is its LAST word's — that is the one contributing the trailing visarga sandhi_join reads it for
    const fused=r&&r.form&&r.form[0];
    const words=fused?fused.split(/\s+/).filter(Boolean):[];
    if(fused&&words.length===elems.length){                                                  // the guard: junctions re-spelled, nothing welded
      /* ⚠ THE WORDS COME FROM THE FUSION, THE WHITESPACE FROM `# text`. The stretch being replaced spans
         two or three units AND the gaps between them, so whatever this writes decides that whitespace —
         and the fusion is asked with a plain " " as its separator, so taking its output verbatim would
         re-spell the gaps as single spaces. A gap is a fact about the line (its width, and whether it is a
         space at all), not something a sandhi generator has any view on; the same rule runningLine follows
         when it takes its gaps as literal slices of `# text` rather than joining with " ". Splicing them
         back verbatim also means this path CANNOT lose a space however the fusion comes out, which is
         worth having on a rewrite that reaches into the running text. */
      /* …and a gap that does not read as whitespace is not usable AS a gap. `usable()` proved each junction
         in this stretch was whitespace-only when it grew it, so this can only differ if the spans it read
         and the spans here disagree — published Sanskrit spans may legitimately ABUT or overlap by one
         character at a vowel coalescence (see paintStext's order guard) — and taking such a "gap" verbatim
         would weld two orthographic words into one. A single space is the honest fallback: the stretch
         treated them as two words, so two words is what goes back. */
      const gaps=[]; for(let i=lo;i<hi;i++){ const g=text.slice(spans[i][1],spans[i+1][0]);
        gaps.push(/^\s+$/.test(g)?g:" "); }
      out=words.map((w,n)=>n?gaps[n-1]+w:w).join("");
      parts=[]; let at=0;
      words.forEach((w,n)=>{ if(n) at+=gaps[n-1].length; parts.push([at,at+w.length]); at+=w.length; });
      if(parts.length!==elems.length) parts=null; }
    /* ⚠ IT IS NOT SAFE TO REWRITE THE UNIT ALONE HERE, and this used to. A stretch was grown precisely
       BECAUSE this unit has a neighbour its spelling depends on, so the unit's own form is its PAUSA form —
       and splicing that into a running line writes a word the sentence does not contain: `śaśabhṛto`, whose
       -o the following `vartmā` puts there, came back as `śaśabhṛtaḥ`. That is the reported corruption's
       content exactly, and it fires when the fusion is unavailable or comes back welded, which is when
       nobody is watching. Where a fusion was ATTEMPTED and did not come back usable, the honest answer is
       to leave `# text` alone: the file then disagrees with itself visibly, which is what the
       tokenisation-mismatch badge is for, rather than invisibly in the running text.
       A unit with NO usable neighbour never gets here — elems.length is 1, no fusion is attempted, and its
       own form is the whole truth about its stretch. That case still writes, as it always did. */
    else return null;
  }
  out=out.replace(_STX_UNPH,c=>_STX_PH_BACK[c]);
  /* ⚠ THE CLITIC SEAM NEVER REACHES `# text`, on ANY path out of here. It is a note to the splitter and not
     a letter of the word (b354a8b), and the backend takes it out of everything it fuses —
     translit._sandhi_preclean — so the fused paths were already safe. The SINGLE-UNIT path is not fused at
     all: `e.inner` for a one-token unit is that token's raw form, so the moment a seam was typed into a form
     the write-back spliced it straight into the running sentence (`śaśabhṛto` → `śaśa=bhṛtaḥ` in `# text`,
     reproduced). That path is reached whenever the multi-unit fusion is unavailable or comes back welded,
     which is exactly when nobody is watching. Stripped HERE rather than at each `inner`, so no future branch
     can route around it — and Sanskrit-only, this whole function being on the `skt` side. */
  out=out.replace(/[꞊=⹀]/g,"");
  if(!out.trim()) return null;                                                               // a form that was NOTHING BUT seams leaves no word to write — say nothing rather than blank the stretch
  /* ⚠ THE LAST WORD ON WELDING, and it is a count rather than a rule: this replaces a stretch of `hi-lo+1`
     ORTHOGRAPHIC WORDS, so whatever goes back must be that many words. Anything fewer has run two of them
     together and taken the space between them out of the running text — the reported fault, and the one
     thing this operation must never do, since a lost space cannot be recovered from the file afterwards.
     Checked HERE, past every branch, so it holds however `out` was arrived at — the fused path, the gap
     reassembly above, the single-unit path, and any future one. Failing it, `# text` is left alone: the
     tokenisation-mismatch badge then says the file disagrees with itself, which is recoverable, and a
     welded line is not. Deliberately NOT counting a stretch that legitimately coalesces into one word —
     that case never reaches here, the words.length guard above having already sent it to `return null`. */
  if(out.split(/\s+/).filter(Boolean).length !== (hi-lo+1)) return null;
  if(_STX_CTRL.test(out)) return null;                                                       // belt and braces on the placeholder scheme: whatever the backend hands back, a control character must never be spliced into `# text` — it would be invisible on screen, survive the save, and make the file's own alignment unreproducible
  return {out,a:spans[lo][0],b:spans[hi][1],lo,hi,parts}; }
/* Splice one unit's stretch of `# text`. Returns true when the string actually changed. */
async function stextApplyUnitEdit(si,k,kind,tokId){
  const s=DOC[si]; if(!s||_STX_BUSY.has(si)) return false;
  const W=stxWriteSpans(s,k); if(!W) return false;                                           // pending / bad / never aligned → leave `# text` strictly alone (this is the state the mismatch badge already warns about)
  const {units,spans,text}=W, u=units[k], skt=isSanskritLang();
  if(skt ? (kind==="mwt") : (kind!=="mwt"&&u.mwt)) return false;                             // the ownership rule; see stxWriteSpans in js/core/document.js
  let repl=u.form, a=spans[k][0], b=spans[k][1], lo=k, hi=k, parts=null;
  if(skt){ _STX_BUSY.add(si); let R=null;
    try{ R=await sanskritStretch(s,units,spans,text,k,tokId,kind); }finally{ _STX_BUSY.delete(si); }
    if(!R||DOC[si]!==s||s.text!==text) return false;                                         // the spans were computed before the await: a document replaced under us (an open, an undo) or a `# text` that moved on meanwhile makes every offset in them a fiction
    ({a,b,lo,hi,parts}=R); repl=R.out; }
  if(!repl) return false;                                                                    // an empty form is a half-typed edit, not a statement that the word left the sentence — leave the old surface standing until there is something to put in its place
  if(!spliceStext(s,a,b,repl)) return false;
  const sp2=stxShiftSpans(spans,a,b,repl.length);
  if(parts) parts.forEach((p,i)=>{ sp2[lo+i]=p?[a+p[0],a+p[1]]:null; });                     // a multi-unit rewrite: the guard above proved the stretch came back as that many whitespace-separated words, so each one's span is read straight off the string we wrote
  else if(lo===hi) sp2[k]=[a,a+repl.length];
  else for(let i=lo;i<=hi;i++) sp2[i]=null;                                                  // …and if we ever could not tell the units apart in what we wrote, say so: a hole makes the next edit ask the bridge again, where a guessed span would splice at the wrong offset
  stxRemember(s,units,sp2);                                                                  // the next keystroke aligns off this instead of spending another bridge call
  markDirty();
  return true; }
// A token's FORM edit → the unit that token belongs to.
async function stextAfterFormEdit(si,tokId){ const s=DOC[si]; if(!s) return false;
  const k=sentUnits(s).findIndex(u=>u.ids.indexOf(tokId)>=0); if(k<0) return false;
  return stextApplyUnitEdit(si,k,"token",tokId); }
// …and an MWT RANGE's own surface form → the range's unit.
async function stextAfterMwtFormEdit(si,from){ const s=DOC[si]; if(!s) return false;
  const k=sentUnits(s).findIndex(u=>u.mwt&&u.ids[0]===from); if(k<0) return false;
  return stextApplyUnitEdit(si,k,"mwt",from); }
// The MWT-row counterpart of afterFormEdit. Nothing else is stale on a range-form edit — the range carries
// no lemma, no MSeg and no parse of its own — so `# text` is the whole of it.
async function afterMwtFormEdit(si,from,changed){ if(!changed) return;
  if(await stextAfterMwtFormEdit(si,from)) preserveScroll(renderDoc); }
window.afterMwtFormEdit=afterMwtFormEdit;
// Called DIRECTLY from the MWT range row's Form field (renderGrid's "mwt-row" branch in js/grid/grid.js), which
// now takes an undo snapshot and commits on `change`, exactly as an ordinary token's Form cell routes through
// afterFormEdit. That replaced a delegated document-level `input` listener living here, which had to re-derive
// the sentence and the range from the DOM (an MWT row is emitted immediately before its first component's token
// row, so the next sibling named both) — correct, but it put the wiring for a field in a different file from the
// field, and it fired per keystroke rather than on commit.
// maximal runs of consecutive compound members (FEATS Compound=Yes) → MWT ranges (0-based inclusive, size >= 2).
// A run extends while the current member glues to the next (Compound=Yes on the member); the head (last token) need
// not carry it.
// ⚠ THIS IS THE FALLBACK NOW, not the rule — see autoGroupSanskritMWTs. Compound=Yes describes samāsa and nothing
// else, so it can only ever find the MWTs that are compounds; an orthographic word made by COALESCENT EXTERNAL
// SANDHI (vartmā́punarjanmanām — three words whose vowels merged) carries the feature on none of its members and
// was invisible to it.
function sanskritCompoundGroups(tokens){ const comp=tokens.map(t=>isCompoundFeat(t.feats)), out=[]; const n=tokens.length; let i=0;
  while(i<n){ let j=i; while(j<n-1&&comp[j]) j++; if(j>i) out.push([i,j]); i=j+1; } return out; }
/* After a Sanskrit PARSE: settle the MWT ranges and fuse each one's surface form by sandhi.
   THE TOKENISER'S OWN RANGES WIN. `sa_sud_vedic_ufal_dcs` publishes source spans, and app/parse.py's
   _src_span_layout turns them into MWT ranges — an orthographic word is a run of tokens whose spans fall in one
   whitespace-delimited chunk of the raw input, which is exactly what a multi-word token IS in this language.
   That answer is the segmenter's own and covers BOTH ways a Sanskrit orthographic word is built: internal sandhi
   across a compound's members, and external sandhi coalescing separate words. Re-deriving the grouping from
   FEATS Compound=Yes threw that away and kept only the compounds, which is the bug this fixes — the parse handed
   back correct ranges and they were overwritten a few lines later.
   THE FORMS ARE ALWAYS REGENERATED, the tokeniser's ranges included. Now that sandhiMwtForms passes each range
   its NEIGHBOURING words, the fusion can finish the outer edges too, and what it produces is the DCS spelling —
   verified against the sample's own `# text`, which is the authentic sandhied running line: 29 of 32 ranges
   regenerate to a string that occurs in it verbatim. The three that do not are not failures of the rules:
   `apunarjanmanām`'s left edge COALESCED with the word before it (the text reads `vartmāpunarjanmanām`), which
   belongs to neither word alone and is deliberately refused; and `karmārjitam` is one of five -m junctions in
   the same environment that this text spells four ways with -ṃ and once without.
   Regenerating is what the ranges' forms are FOR. The sample's stored forms had drifted from its own text in 8
   of 32 ranges (`ātmavidām` for `ātmavidāṃ`, `…vibhuḥ` for `…vibhuś`, `anekakiraṇaḥ` for `anekakiraṇas`), so
   keeping them would have preserved a file's disagreement with itself rather than a convention.
   `parsed` therefore now selects only the RANGES, not the forms: with it the tokeniser's grouping stands, and
   without it — an older model, the whitespace tokeniser, no bridge — the Compound=Yes fallback derives one. */
async function autoGroupSanskritMWTs(si,parsed){ if(!isSanskritLang()||!DOCLANG) return;
  const s=DOC[si]; if(!s||!s.tokens||s.tokens.length<2){ if(s&&s.mwt){ delete s.mwt; markDirty(); } return; }
  if(!(parsed&&s.mwt&&s.mwt.length)){
    const groups=sanskritCompoundGroups(s.tokens);
    if(groups.length){ s.mwt=groups.map(([a,b])=>({from:a+1,to:b+1,form:s.tokens.slice(a,b+1).map(t=>t.form).join("")})); markDirty(); }
    else if(s.mwt){ delete s.mwt; markDirty(); } }
  if(s.mwt&&s.mwt.length&&hasBridge()) await sandhiMwtForms(si,null);
  else preserveScroll(renderDoc); }
// (item 12) the per-column-header "Regenerate this column" right-click affordance was removed; regenColumn()/REGEN_COLS
// went with it. The whole-sentence manual "Regenerate Annotations" control (and with it the blanket primary/
// secondary-fields categorization it needed) was removed too — every field now updates via its own targeted
// rule instead (reparseTokenFields below, afterFormEdit, uposSyncGloss, featsSyncGloss, the raised-subject
// reattach in diagram-edit.js, …), each triggered by the specific edit that should cause it, not by one
// undifferentiated "regenerate everything downstream" button.
// Sentence-scoped block-control actions for the Sentence menu + keyboard shortcuts. They operate on the CURRENT
// BLOCK, not on sel.s: those two are the same thing whenever a token was clicked, and differ only after the reader
// has scrolled to another sentence — where "Delete Sentence" plainly means the one on screen, not the one a
// selection was left in pages back. curBlock() falls back to sel.s, so nothing changes when no scrolling happened.
window.insertSentBefore=()=>{ const i=curBlock(); insertAt(i>=0?i:DOC.length); };
window.insertSentAfter=()=>{ const i=curBlock(); insertAt(i>=0?i+1:DOC.length); };
window.resetParse=()=>{ const i=curBlock(); if(i>=0)reparse(i); };
window.moveSentUp=()=>{ const i=curBlock(); if(i>=0)moveSent(i,i-1); };
window.moveSentDown=()=>{ const i=curBlock(); if(i>=0)moveSent(i,i+2); };
window.exportSentSVG=()=>{ const i=curBlock(); if(i>=0)exportSVG(i); };
/* RANGE-AWARE, so ⌘⌫ needs no twin. With several sentences shift-selected it deletes all of them; with
   none it deletes the one being read, exactly as before. The confirmation is only raised for the range
   case — deleting one sentence has always been a plain undoable edit, and asking every time would be a
   new friction on an old command. */
window.deleteSent=async()=>{ const r=(typeof blockRange==="function")?blockRange():null;
  if(r){ const n=r.hi-r.lo+1;
    if(typeof askConfirm==="function" && !(await askConfirm(`Delete ${n} sentences?`,{okLabel:"Delete",danger:true}))) return;
    delSents(r.lo,r.hi); return; }
  const i=curBlock(); if(i>=0)delSent(i); };
window.mergeSents=async()=>{ const r=(typeof blockRange==="function")?blockRange():null;
  if(!r) return toast("Shift-click a second sentence to choose a range to merge");
  const n=r.hi-r.lo+1;
  if(typeof askConfirm==="function" && !(await askConfirm(
      `Merge ${n} sentences into one? The later sentences' roots become parataxis dependents of the first, and their sentence ids and comments are dropped.`,
      {okLabel:"Merge"}))) return;
  mergeSentRange(r.lo,r.hi); };
window.editSentUrl=()=>{ const i=curBlock(); if(i>=0 && typeof editURL==="function") editURL(i); };

// any real edit marks the document dirty (view-only toggles call renderDoc directly, so they don't)
const _refresh=refresh;
refresh=function(){ markDirty(); preserveScroll(_refresh); };

