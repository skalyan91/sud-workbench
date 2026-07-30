//@module js/formats.js
/* ── document format: pill, conversion, UD import/export ─────────────────── */
function setFormat(fmt){ DOCFORMAT=fmt||"SUD";
  const p=document.getElementById("fmtPillLabel"); if(p)p.textContent="Format: "+DOCFORMAT;   // the trailing chevron is now a persistent sibling <svg class="pillchev">, not part of this text
  const doc=document.getElementById("doc"); if(doc)doc.classList.toggle("fmt-ud",DOCFORMAT==="UD");
  if(typeof syncGlossUI==="function")syncGlossUI();   // item 2: re-evaluate the "Lexical gloss" disabled state when the format changes
  if(hasBridge())try{window.pywebview.api.set_format(DOCFORMAT);}catch(e){} }
// item 9: the Format pill TOGGLES its menu. The pill's own click handler stops propagation (so the window-level
// `click`→closeCtx listener in context-menu.js never sees it), which meant a second click on the pill just
// re-rendered the same menu open and read as a dead control. Ownership is decided by showCtx's own `_openedAt`
// stamp rather than a flag on #ctx: the SAME #ctx element serves every context menu in the app, so "is a menu
// open" is not the question — "is the open menu the one I opened" is, and the stamp answers it without needing
// a change in context-menu.js (each showCtx call re-stamps, so a token menu opened in between makes ours stale).
let _fmtStamp=0;
function fmtMenu(x,y){ if(ctx.classList.contains("show")&&ctx._openedAt===_fmtStamp){ closeCtx(); return; }
  showCtx(x,y,[
  ["Convert to SUD",null,()=>convertTo("SUD")],
  ["Annotate as mSUD",null,()=>annotateAsMSUD()],   // a relabel, not a conversion — see annotateAsMSUD
  null,
  ["Import UD…",null,()=>doImportUD()],
  ["Export as UD…",null,()=>doExportUD()],
],false,false,true);   // false rtlArg → the status-bar menu is always LTR, regardless of the selected sentence's direction. true fit → shrink to the widest row (four short labels don't fill the 224px floor)
  _fmtStamp=ctx._openedAt; }   // remember WHICH open this was, so the next click on the pill can tell "still mine" from "someone else's menu"
async function doImportUD(){ if(!hasBridge())return toast("Import is available in the desktop app");
  if(!(await confirmDiscardUnsaved("Import a file and discard them?"))) return;
  showBusy("Importing UD…",true); let r;
  try{ r=await window.pywebview.api.import_ud(DOCLANG); }catch(e){ return toast("Import failed: "+e); }finally{ hideBusy(); }
  if(!r||r.cancelled) return;
  if(r.unavailable) return toast("UD import needs grew (grewpy + opam backend): "+r.error);
  if(r.error) return toast("Import failed: "+r.error);
  if(!r.sentences||!r.sentences.length) return toast("No sentences in that file");
  applyOpenedDoc(r.sentences,r.path,r.name); setFormat(r.format||"SUD");
  toast(r.source_format&&r.source_format!=="SUD"?`Imported ${r.name} · ${r.source_format} → SUD`:`Imported ${r.name}`); }
/* ── Import Toolbox (SIL FieldWorks/Toolbox interlinear → CoNLL-U) ──────────────────
   doImportToolbox opens the native file picker + probes the file (api.import_toolbox),
   then sheetToolboxMap lets the user map each detected marker to a CoNLL-U field before
   api.toolbox_build produces the document. Unique names so this block stays independent
   of any other edit to this file. Entry point: window.doImportToolbox (native menu). */
const TB_SENT_TARGETS=[["sent_id","Sentence ID"],["text","Text"],["translation","Translation…"],["ignore","Ignore"]];
const TB_TOKEN_TARGETS=[["form","Form"],["lemma","Lemma"],["upos","UPOS"],["xpos","XPOS"],["gloss","Gloss"],["ignore","Ignore"]];
// Sensible default target guessed from a marker's name (backslash stripped, lower-cased).
function tbGuessSentence(mkr){ const n=mkr.replace(/^\\/,"").toLowerCase();
  if(["ref","id","seg","lref","segnum"].includes(n)) return "sent_id";
  if(["tx","t","text","utt","or","ph"].includes(n)) return "text";
  if(["ft","fte","fr","f","gn","e","tf","nt"].includes(n)) return "translation";
  return "ignore"; }
function tbGuessToken(mkr){ const n=mkr.replace(/^\\/,"").toLowerCase();
  if(["mb","m","mph","morph","tx","wd","w"].includes(n)) return "form";
  if(["ge","g","gl","gls","gloss","eng"].includes(n)) return "gloss";
  if(["ps","p","pos"].includes(n)) return "upos";
  if(["lx","lemma","l","cf","citation"].includes(n)) return "lemma";
  return "ignore"; }
async function doImportToolbox(){ if(!hasBridge())return toast("Import is available in the desktop app");
  if(!(await confirmDiscardUnsaved("Import a file and discard them?"))) return;
  showBusy("Reading Toolbox file…",true); let r;
  try{ r=await window.pywebview.api.import_toolbox(); }catch(e){ return toast("Import failed: "+e); }finally{ hideBusy(); }
  if(!r||r.cancelled) return;
  if(r.error) return toast("Import failed: "+r.error);
  if(!r.markers||!r.markers.length) return toast("No interlinear markers found in that file");
  if(hasBridge()){ try{ window.pywebview.api.open_toolbox_window(r); return; }catch(e){} }   // item 21: SEPARATE native window; the in-page sheet is the headless fallback
  openSheet(sheetToolboxMap(r)); }
window.doImportToolbox=doImportToolbox;
// The Toolbox mapping WINDOW (api.child_toolbox_build) builds the document off-thread, then calls this on
// the main window to load it — mirrors tbDoImport's success branch (item 21).
window.__applyToolboxResult=function(res){ if(!res||!res.sentences||!res.sentences.length) return;
  applyOpenedDoc(res.sentences,"",res.name);   // path "" → a fresh unsaved doc (don't overwrite the source .txt on Save)
  setFormat("SUD");
  markDirtyBase();   // an imported document is unsaved with no undo history to show for it — see markDirty
  toast(`Imported ${res.sentences.length} sentence${res.sentences.length>1?"s":""} from Toolbox`); };

function sheetToolboxMap(info){
  const n=info.n_records||0;
  const s=shell("Import Toolbox",`Map the Toolbox markers to CoNLL-U fields. Record marker <b>${esc(info.record_marker||"")}</b> · ${n} record${n===1?"":"s"}.`,"lg");
  const c=s.querySelector(".content");
  c.style.gap="4px";   // item 14: the shared .content 12px gap spaces every row far apart — tighten it for the dense marker table
  const rows=[];   // {marker, level, sel, lang}
  // A single marker → target row: marker name, sample value, a target <select>, and (for a
  // Translation target) a language-code input revealed alongside it.
  const mkRow=(marker,level,targets,defTgt)=>{
    const row=document.createElement("div");
    row.className="tbrow";
    row.style.cssText="display:flex; align-items:center; gap:8px; padding:8px 10px; min-height:42px; box-sizing:border-box";   // the kit's Form Row, the same shape the Toolbox window's own rows now take (10px inset, 42 tall, tiling contiguously). Supersedes "item 14: tighter rows" and the 8px inset that existed only to make a zebra stripe read as a table row — the stripe is gone (see .tbrow's divider in app.css)
    const nm=document.createElement("span");
    nm.style.cssText="font-family:var(--ui-mono); font-size:14px; font-weight:700; min-width:52px; color:var(--text)";   // the kit's mono token (macos-kit/mac-tokens.css, redeclared by the Fluent kit) — a hard-coded SF Mono stack here would keep the Apple face on Windows, where the rest of the row is Segoe

    nm.textContent=marker; row.appendChild(nm);
    const smp=document.createElement("span");
    smp.style.cssText="flex:1 1 auto; min-width:0; font-size:13px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis";
    row.appendChild(smp);   // sample text is filled in by the caller after the row is built
    const sel=document.createElement("select"); sel.className="sel"; sel.style.flex="0 0 auto"; sel.style.fontSize="14px";
    targets.forEach(([v,lbl])=>{ const o=document.createElement("option"); o.value=v; o.textContent=lbl; sel.appendChild(o); });
    sel.value=defTgt;
    const lang=document.createElement("input"); lang.type="text"; lang.value="en"; lang.maxLength=8;
    lang.placeholder="lang"; lang.title="Language code for this translation (e.g. en, fr)";
    lang.style.cssText="width:56px; height:30px; border-radius:8px; border:.5px solid var(--pill-border); background:var(--field-bg); color:var(--text); font:inherit; font-size:14px; padding:0 8px; flex:0 0 auto";
    const syncLang=()=>{ lang.style.display=(sel.value==="translation")?"block":"none"; };
    sel.addEventListener("change",syncLang); syncLang();
    row.appendChild(sel); row.appendChild(lang);
    rows.push({marker,level,sel,lang});
    return row;
  };
  const section=(title,hint)=>{ const h=document.createElement("h4"); h.textContent=title;
    h.style.cssText="margin:11px 0 1px; font-size:13.5px; font-weight:700; color:var(--text)"; c.appendChild(h);   // item 14: larger heading, tighter margins
    if(hint){ const p=document.createElement("div"); p.textContent=hint;
      p.style.cssText="font-size:12.5px; color:var(--muted); margin-bottom:2px"; c.appendChild(p); } };

  // Sentence-level section — the record marker leads (defaults to Sentence ID), then the
  // markers the probe classified as one-value-per-record.
  section("Sentence-level fields","One value per record (id, text line, free translation).");
  const recRow=mkRow(info.record_marker,"sentence",TB_SENT_TARGETS,"sent_id");
  recRow.querySelector("span:nth-child(2)").textContent="record marker";
  c.appendChild(recRow);
  const sentMarkers=info.markers.filter(m=>m.level==="sentence");
  sentMarkers.forEach(m=>{ const row=mkRow(m.marker,"sentence",TB_SENT_TARGETS,tbGuessSentence(m.marker));
    row.querySelector("span:nth-child(2)").textContent=m.sample||""; c.appendChild(row); });

  // Token-level section — the interlinear rows, one token per aligned column.
  section("Token-level fields","Interlinear rows; one aligned token per column (morphemes, glosses, POS).");
  const tokMarkers=info.markers.filter(m=>m.level==="token");
  if(!tokMarkers.length){ const p=document.createElement("div"); p.textContent="No token-level (interlinear) markers were detected.";
    p.style.cssText="font-size:13px; color:var(--muted); padding:2px 0"; c.appendChild(p); }
  tokMarkers.forEach(m=>{ const row=mkRow(m.marker,"token",TB_TOKEN_TARGETS,tbGuessToken(m.marker));
    row.querySelector("span:nth-child(2)").textContent=m.sample||""; c.appendChild(row); });

  const act=s.querySelector(".actions");
  act.innerHTML=`<button class="tbtn" data-x>Cancel</button><button class="tbtn primary" data-go>Import</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  act.querySelector("[data-go]").onclick=()=>tbDoImport(info,rows);
  return s;
}
async function tbDoImport(info,rows){
  const mapping={record_marker:info.record_marker,sentence:{},token:{}};
  rows.forEach(r=>{ const tgt=r.sel.value; if(tgt==="ignore") return;
    if(r.level==="sentence"){
      if(tgt==="translation"){ const lang=(r.lang.value||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"")||"x";
        mapping.sentence[r.marker]="translation:"+lang; }
      else mapping.sentence[r.marker]=tgt;
    } else { mapping.token[r.marker]=tgt; }
  });
  if(!Object.keys(mapping.token).length) return toast("Map at least one token-level field (e.g. Form)");
  showBusy("Building CoNLL-U…",true); let r;
  try{ r=await window.pywebview.api.toolbox_build(info.path,mapping); }catch(e){ return toast("Import failed: "+e); }finally{ hideBusy(); }
  if(!r) return; if(r.error) return toast("Import failed: "+r.error);
  if(!r.sentences||!r.sentences.length) return toast("That mapping produced no sentences");
  closeSheet();
  applyOpenedDoc(r.sentences,"",r.name);   // path "" → a fresh unsaved doc (don't overwrite the source .txt on Save)
  setFormat("SUD");
  markDirtyBase();   // imported interlinear is unsaved and unparsed → dirty, with no undo history to show for it (see markDirty)
  toast(`Imported ${r.sentences.length} sentence${r.sentences.length>1?"s":""} from Toolbox`); }

async function doExportUD(){ if(!hasBridge())return toast("Export is available in the desktop app");
  let defaultName="treebank_UD"; try{ const d=await window.pywebview.api.export_ud_default_name(); defaultName=d.name||defaultName; }catch(e){}
  const pick=await sheetChooseSaveLocation({title:"Export as UD",desc:"Choose a name and location for the converted file.",defaultName,saveLabel:"Export"});
  if(pick.action!=="save") return;
  showBusy("Exporting UD…",true); let r;
  try{ r=await window.pywebview.api.export_ud_to(getDocJSON(),pick.folder,pick.filename,DOCLANG); }catch(e){ return toast("Export failed: "+e); }finally{ hideBusy(); }
  if(!r||r.cancelled) return;
  if(r.unavailable) return toast("UD export needs grew (grewpy + opam backend): "+r.error);
  if(r.error) return toast("Export failed: "+r.error);
  toast("Exported UD · "+r.name); }
// Does the document carry actual morph-level annotation? Mirrors app/detect.py's mSUD test (_is_morph_rel +
// _MORPH_FEATS) so both sides agree on what makes a document mSUD: a "/m" relation, or one of the morph-level
// FEATS/MISC markers. False for a document that is only *labelled* mSUD by annotateAsMSUD below — which is
// what lets the two directions stay grew-free until there is something for grew to convert.
const MORPH_FEAT_MARKS=["TokenType=","DerPos=","CpdPos="];
// The relation test is detect.py's substring one, NOT diagram-core's suffix-only isMorphRel: a relation carrying
// a deep feature too ("mod/m@relcl") is morph annotation to the backend, and the two sides must not disagree about
// that. Erring inclusive is also the safe direction here — it routes a real mSUD document through grew rather than
// relabelling it away locally.
function docHasMorphAnnotation(){ return DOC.some(s=>s.tokens.some(t=>
  (t.deprel||"").includes("/m") || MORPH_FEAT_MARKS.some(m=>(t.feats||"").includes(m)||(t.misc||"").includes(m)))); }
/* Put the document into mSUD annotation mode. There is NO automatic SUD → mSUD conversion (up-conversion to the
   morph level isn't mechanical and no universal grammar exists — see convert.sud_to_msud), so this is a RELABEL,
   not a conversion: nothing is rewritten and no grew call is made. What it buys is the way IN to morph-level
   annotation, which detection alone can't give: the "/m" relations are gated on DOCFORMAT==="mSUD" (deprelVocab),
   so a SUD document could otherwise never be offered one — and without one, detection would never call it mSUD.
   Writes nothing to the file, so it doesn't mark the document dirty; the mode becomes self-sustaining (and
   survives a reopen) as soon as the first "/m" relation is annotated. */
async function annotateAsMSUD(){
  if(DOCFORMAT==="mSUD") return toast("Already mSUD");
  if(DOCFORMAT==="UD") return toast("Convert to SUD first — UD is import/export only");
  setFormat("mSUD");   // also tells the backend, so a later Export as UD takes the mSUD → UD route. Nothing to warn about: every tier the document already has, the lexical gloss included, stays exactly as editable as it was — mSUD adds the morph level, it doesn't displace the lexical one
  toast("mSUD annotation on — the /m relations are now offered in the relation menus"); }
async function convertTo(target){
  if(target===DOCFORMAT) return toast("Already "+target);
  // Undo a bare annotateAsMSUD relabel the same way it was made — locally, and BEFORE the hasBridge gate below:
  // the document holds no morph annotation, so there is nothing for mSUD → SUD to rewrite, no reason to risk grew
  // being unavailable over a no-op, and no reason for the relabel to be reversible only in the desktop app when
  // annotateAsMSUD itself isn't gated that way.
  if(target==="SUD" && DOCFORMAT==="mSUD" && !docHasMorphAnnotation()){ setFormat("SUD"); return toast("Back to SUD"); }
  if(!hasBridge())return toast("Conversion is available in the desktop app");
  showBusy("Converting to "+target+"…",true); let r;
  try{ r=await window.pywebview.api.convert_format(getDocJSON(),target,DOCLANG); }catch(e){ return toast("Convert failed: "+e); }finally{ hideBusy(); }
  if(!r) return; if(r.unavailable) return toast(r.error);
  if(r.error) return toast("Convert failed: "+r.error);
  pushUndo(); DOC.length=0; normSents(r.sentences).forEach(s=>DOC.push(s));
  if(typeof invalidateColW==="function") invalidateColW();   // every token was just replaced — the column-width cache from before the conversion is meaningless against it
  if(typeof invalidateDiaCache==="function") invalidateDiaCache();   // …and every cached diagram (js/core/document.js) — same reasoning, plus a format conversion can change the very relation SET a tree is drawn from (SUD ↔ mSUD)
  setFormat(r.format); syncGlossTiersFromDoc(); syncDeprelVocabFromDoc(); detectXposMirrorsUpos(); syncDocFonts();   // item 1: mSUD gains MSeg/MGloss (morphemic tier on), SUD drops them (off) — reflect the converted doc
  markDirty(); renderDoc(); clearSelToBlock(0,false);   // item 9: a whole-document conversion replaces every token, so the old selection is meaningless and a new one would be the app's choice — the same reading as the re-parse and open paths (see clearSelToBlock, js/io/bridge.js): nothing selected, reading focus at the top
  if(show.translit) fillTranslit();   // conversion drops the (non-CoNLL-U) transliteration column → re-derive it
  toast("Converted to "+target); }

