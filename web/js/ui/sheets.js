//@module js/sheets.js
/* sheets */
const scrim=document.getElementById("scrim"),scrimHost=document.getElementById("scrimHost");
function openSheet(node){scrimHost.innerHTML=""; scrimHost.appendChild(node); scrim.classList.add("show"); const f=node.querySelector("textarea,input"); if(f)setTimeout(()=>f.focus(),30);}
function closeSheet(){scrim.classList.remove("show");}
scrim.addEventListener("click",e=>{if(e.target===scrim)closeSheet();});
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && scrim.classList.contains("show") && !confirmScrim.classList.contains("show")){ e.preventDefault(); e.stopPropagation(); closeSheet(); } },true);   // Escape dismisses the open dialog/sheet (capture phase so it wins over field-level handlers inside the sheet) — skipped while a confirm alert is stacked on top; ITS OWN handler (below) owns Escape then
// a small confirm/alert ("Remove this model?", "Discard unsaved changes?") — a SEPARATE scrim/host pair (never #scrimHost)
// so it can stack above an already-open sheet (e.g. Manage Models) without blowing it away. Replaces window.confirm()
// (an ugly, unstyled native browser dialog) with the same Tahoe glass/shadow/radius look as every other dialog.
// Async: `if(!(await askConfirm(...))) return;` in place of `if(!confirm(...)) return;`.
const confirmScrim=document.getElementById("confirmScrim"),confirmHost=document.getElementById("confirmHost");
let _confirmResolve=null;
function closeConfirmSheet(result){ confirmScrim.classList.remove("show"); confirmHost.innerHTML="";
  if(_confirmResolve){ const r=_confirmResolve; _confirmResolve=null; r(!!result); } }
confirmScrim.addEventListener("click",e=>{ if(e.target===confirmScrim) closeConfirmSheet(false); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && confirmScrim.classList.contains("show")){ e.preventDefault(); e.stopPropagation(); closeConfirmSheet(false); } },true);
// An alert is 260px wide (the macOS 26 kit's own alert width), and two buttons sharing that give ~109px each —
// enough for "Cancel"/"Save", not for "Close Without Saving" (121px). macOS's answer is not to widen the alert
// or shrink the type: it STACKS the buttons full-width, which is why the kit ships both an Alert/Side-by-side
// (260×154) and an Alert/Stacked (260×218). This picks between them the only way that can be right for a label
// nobody measured in advance — by asking the browser whether the text actually fits.
// column-REVERSE because the DOM order is [Cancel, …, default] (so the default is the last child, focused and
// rightmost when side by side); stacked, macOS puts the default on TOP and Cancel at the bottom, which is what
// reversing the column gives without touching the markup or the focus order.
function stackActionsIfTight(act){ if(!act) return;
  act.classList.remove("stacked");                                     // measure the side-by-side layout, never a stale stacked one
  const tight=[...act.querySelectorAll(".tbtn")].some(b=>b.scrollWidth>b.clientWidth+0.5);
  if(tight) act.classList.add("stacked"); }
function askConfirm(message,opts){ opts=opts||{};
  return new Promise(resolve=>{ _confirmResolve=resolve;
    const s=shell(opts.title||"SUD Workbench",esc(message),"sm");
    const act=s.querySelector(".actions");
    act.innerHTML=`<button class="tbtn" data-cancel>${esc(opts.cancelLabel||"Cancel")}</button><button class="tbtn ${opts.danger?"destructive":"primary"}" data-ok>${esc(opts.okLabel||"OK")}</button>`;
    act.querySelector("[data-cancel]").onclick=()=>closeConfirmSheet(false);
    act.querySelector("[data-ok]").onclick=()=>closeConfirmSheet(true);
    confirmHost.innerHTML=""; confirmHost.appendChild(s); confirmScrim.classList.add("show");
    stackActionsIfTight(act);   // side-by-side unless a label won't fit — see below
    setTimeout(()=>act.querySelector(opts.danger?"[data-cancel]":"[data-ok]").focus(),30); }); }   // default focus lands on Cancel for a destructive action (never arm the risky button by default), OK otherwise
// General-purpose "Save As" sheet — filename + a "Where" folder picker — replacing the native SAVE panel
// throughout the app (treebank Save As, SVG export, the "keep this new untitled document?" prompt). The
// folder list is a handful of likely locations (recent files' folders, Desktop, Documents, home); its
// browse ("…") button is the one piece still native (a real NSOpenPanel(FOLDER) — directory-tree browsing
// chrome isn't practically restylable, see the macos-26-design skill's note on native panels).
// opts: {title, desc, defaultName, size, saveLabel, deleteLabel}. deleteLabel omitted → plain Cancel/Save
// (e.g. Save As, SVG export); present → an extra destructive leading button (the untitled-document prompt).
// Resolves {action:"save",folder,filename} | {action:"delete"} | {action:"cancel"}.
async function sheetChooseSaveLocation(opts){ opts=opts||{};
  let folders=[]; try{ const r=await window.pywebview.api.save_location_options(); folders=r.folders||[]; }catch(e){}
  if(opts.preferFolder){ folders=folders.filter(f=>f!==opts.preferFolder); folders.unshift(opts.preferFolder); }   // e.g. Rename defaults to the file's OWN current folder, not just the general recent/Desktop/Documents guesses
  if(!folders.length) folders=[""];
  const s=shell(opts.title||"Save",opts.desc||"",opts.size||"savesm");
  const c=s.querySelector(".content");
  const nameLab=document.createElement("label"); nameLab.className="fld"; nameLab.textContent="Save As:";
  const nameInp=document.createElement("input"); nameInp.type="text"; nameInp.value=opts.defaultName||""; nameInp.spellcheck=false;
  nameInp.setAttribute("autocorrect","off"); nameInp.setAttribute("autocapitalize","off"); nameInp.setAttribute("autocomplete","off");
  nameLab.appendChild(nameInp); c.appendChild(nameLab);
  const whereLab=document.createElement("label"); whereLab.className="fld"; whereLab.textContent="Where:";
  const whereRow=document.createElement("div"); whereRow.className="whererow";
  let currentFolder=folders[0];
  const folderLabel=p=>p?(p.split("/").filter(Boolean).pop()||p):"Choose…";
  const whereBtn=document.createElement("button"); whereBtn.type="button"; whereBtn.className="wherebtn";
  const renderWhereBtn=()=>{ whereBtn.innerHTML="";
    if(window.__folderIcon){ const im=document.createElement("img"); im.className="fpimg"; im.src=window.__folderIcon; im.alt=""; whereBtn.appendChild(im); }   // the SAME native NSWorkspace folder icon the titlebar proxy menu uses
    else { const ic=document.createElement("span"); ic.className="sfi"; ic.style.setProperty("--m","var(--sf-open)"); whereBtn.appendChild(ic); }   // browser/design-mode fallback (no bridge → no native icon yet), matching openFolderMenu's own fallback
    const nm=document.createElement("span"); nm.className="wherename"; nm.textContent=folderLabel(currentFolder); nm.title=currentFolder||""; whereBtn.appendChild(nm);
    const chev=document.createElement("span"); chev.className="wherechev"; chev.textContent="⌄"; whereBtn.appendChild(chev); };
  renderWhereBtn();
  whereBtn.onclick=()=>openWherePop(whereBtn,folders,currentFolder,p=>{ currentFolder=p; renderWhereBtn(); });
  const browseBtn=document.createElement("button"); browseBtn.type="button"; browseBtn.className="wherebrowse"; browseBtn.title="Choose a different folder…"; browseBtn.textContent="…";
  browseBtn.onclick=async()=>{ let r; try{ r=await window.pywebview.api.browse_save_folder(currentFolder||""); }catch(e){ return; }
    if(!r||r.cancelled) return; if(!folders.includes(r.path)) folders.unshift(r.path);
    currentFolder=r.path; renderWhereBtn(); };
  whereRow.appendChild(whereBtn); whereRow.appendChild(browseBtn); whereLab.appendChild(whereRow); c.appendChild(whereLab);
  const act=s.querySelector(".actions");
  act.innerHTML=(opts.deleteLabel?`<button class="tbtn destructive" data-delete style="margin-inline-end:auto">${esc(opts.deleteLabel)}</button>`:"")
    +`<button class="tbtn" data-cancel>Cancel</button><button class="tbtn primary" data-save>${esc(opts.saveLabel||"Save")}</button>`;
  return new Promise(resolve=>{
    act.querySelector("[data-cancel]").onclick=()=>{ closeWherePop(); closeSheet(); resolve({action:"cancel"}); };
    if(opts.deleteLabel) act.querySelector("[data-delete]").onclick=()=>{ closeWherePop(); closeSheet(); resolve({action:"delete"}); };
    act.querySelector("[data-save]").onclick=()=>{ closeWherePop(); closeSheet(); resolve({action:"save",folder:currentFolder,filename:nameInp.value.trim()}); };
    openSheet(s); setTimeout(()=>nameInp.select(),30); }); }
// the Where button's own dropdown — a separate popup from the titlebar's folder-path proxy menu (openFolderMenu),
// but reusing the SAME .fpmenu/.fpitem/.fpimg classes (native folder icon, same row height/hover) for a
// consistent look. Lists the candidate folders with a checkmark on the current one.
let _wherePopEl=null;
function closeWherePop(){ if(_wherePopEl){ _wherePopEl.remove(); _wherePopEl=null;
  document.removeEventListener("mousedown",_wherePopOutside,true); document.removeEventListener("keydown",_wherePopKey,true); } }
function _wherePopOutside(e){ if(_wherePopEl && !_wherePopEl.contains(e.target)) closeWherePop(); }
function _wherePopKey(e){ if(_wherePopEl && e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeWherePop(); } }
function openWherePop(anchor,folders,current,onPick){ closeWherePop();
  const m=document.createElement("div"); m.className="fpmenu"; _wherePopEl=m;
  folders.forEach(p=>{ const it=document.createElement("button"); it.type="button"; it.className="fpitem"+(p===current?" cur":"");
    if(window.__folderIcon){ const im=document.createElement("img"); im.className="fpimg"; im.src=window.__folderIcon; im.alt=""; it.appendChild(im); }   // icon-then-text, same as openFolderMenu's own rows — no leading checkmark column (that reserved an extra 14px+8px of x-padding the titlebar proxy menu doesn't have); the Where BUTTON itself already shows the current folder, so a checkmark here would be redundant
    else { const ic=document.createElement("span"); ic.className="sfi"; ic.style.setProperty("--m","var(--sf-open)"); it.appendChild(ic); }
    const t=document.createElement("span"); t.textContent=p?(p.split("/").filter(Boolean).pop()||p):"Choose…"; t.title=p||""; it.appendChild(t);
    it.addEventListener("click",()=>{ closeWherePop(); onPick(p); });
    m.appendChild(it); });
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect(), mw=m.offsetWidth, mh=m.offsetHeight;
  const left=Math.max(6,Math.min(r.left, innerWidth-mw-8));
  const top=Math.max(6,Math.min(r.bottom+4, innerHeight-mh-8));
  m.style.left=left+"px"; m.style.top=top+"px";
  setTimeout(()=>{ document.addEventListener("mousedown",_wherePopOutside,true); document.addEventListener("keydown",_wherePopKey,true); },0); }
// the real macOS "Do you want to keep this new document ‘Untitled’?" prompt — shown (instead of the plain
// Don't-Save/Cancel/Save confirm) whenever the document being discarded/closed has NEVER been saved, so
// there's a real filename+location choice to make. An already-named document's unsaved edits have nowhere
// new to go, so those callers use the simpler askConfirm instead (see confirmDiscardUnsaved below).
async function sheetSaveAsUntitled(){
  const r=await sheetChooseSaveLocation({title:`Do you want to keep this new document "${esc(DOCNAME||"Untitled")}"?`,
    desc:"You can choose to save your changes, or discard this document immediately. You can’t undo this action.",
    defaultName:suggestedSaveName(), deleteLabel:"Delete", saveLabel:"Save"});
  if(r.action==="cancel") return "cancel";
  if(r.action==="delete") return "delete";
  let res; try{ res=await window.pywebview.api.save_to(getDocJSON(),r.folder,r.filename); }catch(e){ toast("Save failed: "+e); return "cancel"; }
  if(res.error){ toast("Save failed: "+res.error); return "cancel"; }
  handleSaveResult(res); return "saved"; }
// shared "you have unsaved changes — proceed?" gate for New/Open/Import: an untitled document gets the
// richer save-location sheet above; a named one gets the plain confirm (nothing new to name/locate).
async function confirmDiscardUnsaved(question){ if(!DIRTY) return true;
  if(!DOCPATH) return (await sheetSaveAsUntitled())!=="cancel";
  return askConfirm(`You have unsaved changes. ${question}`,{danger:true,okLabel:"Discard"}); }
// native window-close veto (see _warn_on_unsaved_close / confirm_close_without_saving in the Python side): the
// native ``closing`` handler always vetoes first when dirty, then fires this off a throwaway thread (never the
// AppKit main thread — see its own comment on why that matters) to show the SAME styled sheet as every other
// "are you sure" prompt, instead of a native NSAlert. Confirming (or saving) calls back into the bridge, which
// force-closes; an untitled document gets the full Save-As sheet, a named one the plain confirm.
window.__onNativeCloseAttempt=async function(){
  if(!DOCPATH){ if((await sheetSaveAsUntitled())==="cancel") return; }
  else if(!(await askConfirm("You have unsaved changes. Close without saving?",{danger:true,okLabel:"Close Without Saving"}))) return;
  try{ await window.pywebview.api.confirm_close_without_saving(); }catch(e){} };
function shell(title,desc,size){const s=document.createElement("div"); s.className="sheet "+(size||"md");   // size: sm | md | lg — kit-scaled dialog widths
  s.innerHTML=`<header><h3>${title}</h3><p>${desc}</p></header><div class="content"></div><div class="actions"></div>`; return s;}
function sheetInsert(index){
  // …plus the ITRANS note the native Insert window carries (Api._insert_html), for the same reason: an
  // unannounced rewrite of a whole pasted paragraph is alarming, and this is the one field committed in a single gesture
  const itr=isSanskritLang()?` Sanskrit typed in <b>ITRANS</b> (kRiShNa, raamaayaNa, ^a for â) becomes IAST; text already in IAST is left as it is.`:"";
  const s=shell("Insert text", (model?`Model <b>${MODELINFO[model]||model}</b> is selected; its own tokeniser splits each sentence and the parse is filled in.`:`No model selected; each sentence is split on <b>whitespace</b> for manual annotation.`)+itr);
  const c=s.querySelector(".content"); const lab=document.createElement("label"); lab.className="fld"; lab.textContent="Text (one block per sentence; a blank line starts a new paragraph)";   // item 11: the blank-line rule is worth stating, since the paragraph boundaries it produces are recorded in the file as `# newpar` — see __insertPastedText, which does the split (the textarea's value reaches it untouched)
  const ta=document.createElement("textarea"); ta.placeholder="The committee approved the proposal after a long debate. It will take effect next week.";
  ta.spellcheck=false; ta.setAttribute("autocorrect","off"); ta.setAttribute("autocapitalize","off"); ta.setAttribute("autocomplete","off");   // no OS smart-quote/dash substitution: WKWebView ties smart punctuation to autocorrect, so autocorrect=off keeps typed "x" - y straight (no curly quotes / em-dash)
  ta.style.webkitTextReplacement="none";   // belt-and-braces: opt out of the WebKit text-replacement service where honoured
  lab.appendChild(ta); c.appendChild(lab);
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn" data-x>Cancel</button><button class="tbtn primary" data-go>Insert</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  // item 1: ITRANS → IAST before the text is sentencised/tokenised, matching what the native Insert
  // window does on the Python side (Api.child_insert_text) — the tokeniser must see the notation the
  // document is stored in. The value is read BEFORE closeSheet(), which tears the textarea down.
  const submit=async()=>{const raw=ta.value; closeSheet(); __insertPastedText(await itransFix(raw),index);};
  act.querySelector("[data-go]").onclick=submit;
  ta.addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){ e.preventDefault(); submit(); } });   // ⌘Enter submits — plain Enter still inserts a newline (the field is multi-sentence, one block per line)
  return s;
}
function sheetSettings(){
  const s=shell("Settings","Option lists that feed the grid dropdowns.");
  const c=s.querySelector(".content");
  const sc=document.createElement("label"); sc.className="fld"; sc.textContent="Relation scheme name";
  const sci=document.createElement("input"); sci.type="text"; sci.value=SETTINGS.scheme; sc.appendChild(sci); c.appendChild(sc);
  const mk=(t,v)=>{const l=document.createElement("label"); l.className="fld"; l.textContent=t; const ta=document.createElement("textarea"); ta.value=v; l.appendChild(ta); c.appendChild(l); return ta;};
  const up=mk("UPOS tags (one per line)",SETTINGS.upos.join("\n"));
  const dr=mk("Dependency relations (one per line)",SETTINGS.deprel.join("\n"));
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn" data-x>Cancel</button><button class="tbtn" data-reset>Restore defaults</button><button class="tbtn primary" data-go>Save</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  act.querySelector("[data-reset]").onclick=()=>{up.value=UPOS_DEFAULT.join("\n"); dr.value=DEPREL_DEFAULT.join("\n"); sci.value="SUD";};
  act.querySelector("[data-go]").onclick=()=>{ SETTINGS.scheme=sci.value.trim()||"SUD";
    SETTINGS.upos=up.value.split(/\n+/).map(x=>x.trim()).filter(Boolean); SETTINGS.deprel=dr.value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    closeSheet(); refresh(); toast("Settings saved"); };
  return s;
}
/* item 13 — drive the SHARED FEATS autocomplete (acShowGrouped/acShowCustom/acKeyItems/acValItems/acFill/…) on a plain
   <input> that holds a single Feature=Value pair, so the mapping editor's Feat cell offers the SAME grouped, inventory-
   limited completion as the annotation grid's FEATS pill. We only READ the shared functions here — none are modified. */
function bindFeatInput(inp){
  const openAC=()=>{ if(document.activeElement!==inp||scrim&&!scrim.classList.contains("show")){ if(_acInput===inp)acCloseSoon(); return; }
    const caret=(inp.selectionStart!=null)?inp.selectionStart:inp.value.length;
    const seg=inp.value.slice(0,caret), eq=seg.indexOf("="); let items,kind,q,keyName=null;
    if(eq<0){ if(!seg){ if(_acInput===inp)acCloseSoon(); return; } kind="key"; q=seg; items=acKeyItems("feats"); }   // before "=" → feature names
    else { kind="value"; keyName=seg.slice(0,eq); q=seg.slice(eq+1); items=acValItems("feats",keyName); }            // after "=" → that feature's official values
    const ql=q.toLowerCase();
    let ms=!ql?items.slice():items.filter(v=>v.toLowerCase().startsWith(ql));
    if(ql&&!ms.length)ms=items.filter(v=>v.toLowerCase().includes(ql));
    ms=ms.filter(v=>v.toLowerCase()!==ql);
    if(!ms.length){ if(_acInput===inp)acCloseSoon(); return; }
    const pick=v=>{ inp.focus();
      if(kind==="key"){ inp.value=v+"="; try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(_){} setTimeout(openAC,0); }   // feature chosen → immediately offer its values
      else { inp.value=keyName+"="+v; try{inp.setSelectionRange(inp.value.length,inp.value.length);}catch(_){} } };
    if(kind==="key"){ const groups=[], seen=new Set();   // group feature names under the UD categories, exactly like the grid's FEATS pill
      FEATS_CATS.forEach(cat=>{ const gi=ms.filter(v=>FEATS_CAT[v]===cat); gi.forEach(v=>seen.add(v)); if(gi.length)groups.push({title:cat,items:gi}); });
      const rest=ms.filter(v=>!seen.has(v)); if(rest.length)groups.push({title:"Other (in document)",items:rest});
      acShowGrouped(inp,groups,pick); }
    else { const descFn=(keyName&&UD_FEATS[keyName])?(v=>(FEATS_VDESC[keyName]||{})[v]||""):null; acShowCustom(inp,ms,pick,descFn); } };
  inp.addEventListener("input",openAC);
  inp.addEventListener("focus",openAC);
  inp.addEventListener("blur",()=>{ if(_acInput===inp)acCloseSoon(); });
  inp.addEventListener("keydown",e=>{
    if(_acMenu&&_acMenu.classList.contains("show")&&_acInput===inp){   // dropdown open on THIS field → own ↑/↓/Enter/Tab/Esc
      if(e.key==="ArrowDown"){ e.preventDefault(); acHi((_acIdx+1)%_acItems.length); return; }
      if(e.key==="ArrowUp"){ e.preventDefault(); acHi((_acIdx-1+_acItems.length)%_acItems.length); return; }
      if((e.key==="Enter"||e.key==="Tab")&&_acIdx>=0){ e.preventDefault(); acFill(_acItems[_acIdx]); return; }
      if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); acClose(); return; } } });   // close the menu without dismissing the sheet
}
/* item 13 — the gloss↔FEATS mapping editor. A grid of custom mappings: each row is a Leipzig ABBREVIATION input + a
   Feature=Value input (shared FEATS autocomplete via bindFeatInput) + a remove button, plus "Add mapping". Rows show the
   user's CUSTOM overrides (the 114 built-in defaults always apply underneath). Save commits to PREFS.glossMap → savePrefs
   → rebuildGlossMaps(), so morphemic-gloss pre-fill (featsToGloss) and back-mapping (glossToFeats) update immediately. */
function sheetGlossMap(){
  const builtinN=Object.keys(FEATS_GLOSS).length;
  const s=shell("Gloss mappings",`Map Leipzig abbreviations to morphological features. Your custom mappings override the ${builtinN} built-in defaults and drive morphemic-gloss pre-fill and back-mapping.`,"lg");
  const c=s.querySelector(".content");
  const grid=document.createElement("div"); grid.className="gmgrid";
  const head=document.createElement("div"); head.className="gmhead"; head.innerHTML="<span>Abbreviation</span><span>Feature=Value</span><span></span>"; grid.appendChild(head);
  const addRow=(abbr,feat)=>{ const row=document.createElement("div"); row.className="gmrow";
    const a=document.createElement("input"); a.type="text"; a.className="gm-abbr"; a.placeholder="e.g. ERG"; a.value=abbr||""; a.spellcheck=false; a.setAttribute("autocapitalize","off"); a.setAttribute("autocomplete","off");
    const f=document.createElement("input"); f.type="text"; f.className="gm-feat"; f.placeholder="e.g. Case=Erg"; f.value=feat||""; f.spellcheck=false; f.setAttribute("autocapitalize","off"); f.setAttribute("autocomplete","off"); bindFeatInput(f);
    const rm=document.createElement("button"); rm.type="button"; rm.className="gm-rm"; rm.textContent="✕"; rm.title="Remove this mapping"; rm.addEventListener("click",()=>{ if(_acInput===f)acClose(); row.remove(); });
    row.append(a,f,rm); grid.appendChild(row); return row; };
  const cur=(PREFS.glossMap&&typeof PREFS.glossMap==="object")?PREFS.glossMap:{};
  const entries=Object.entries(cur);
  if(entries.length) entries.forEach(([feat,abbr])=>addRow(abbr,feat)); else addRow("","");   // seed one blank row when there are no custom mappings yet
  c.appendChild(grid);
  const addBtn=document.createElement("button"); addBtn.type="button"; addBtn.className="gm-add"; addBtn.textContent="+ Add mapping";
  addBtn.addEventListener("click",()=>{ const r=addRow("",""); const i=r.querySelector(".gm-abbr"); if(i)i.focus(); }); c.appendChild(addBtn);
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn" data-x>Cancel</button><button class="tbtn primary" data-go>Save</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  act.querySelector("[data-go]").onclick=()=>{ acClose();
    const map={}; let skipped=0;
    grid.querySelectorAll(".gmrow").forEach(row=>{ const abbr=(row.querySelector(".gm-abbr").value||"").trim(), feat=(row.querySelector(".gm-feat").value||"").trim();
      if(!abbr&&!feat) return;                                   // wholly blank row → ignore
      if(!abbr||!/^[^=|\s]+=[^=|\s]+$/.test(feat)){ skipped++; return; }   // need a non-empty abbreviation AND a Feature=Value pair
      map[feat]=abbr; });                                        // FEATS_GLOSS orientation: key = Feat=Val, value = abbreviation (custom wins)
    PREFS.glossMap=map; rebuildGlossMaps(); savePrefs();
    closeSheet();
    if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc);   // re-render so open glosses reflect the new maps
    const n=Object.keys(map).length;
    toast(skipped?`Saved ${n} mapping${n===1?"":"s"} · ${skipped} incomplete row${skipped===1?"":"s"} skipped`:`Saved ${n} custom mapping${n===1?"":"s"}`); };
  return s;
}
window.sheetGlossMap=sheetGlossMap;

/* ── Help dialog (large): essential shortcuts + the SUD annotation vocabulary, every tag linked to its
   guidelines page. Exposed as window.openHelp (the toolbar Help button and the native Help menu open it). */
const HELP_SHORTCUTS=[
  ["New window","⌘N"],["Open","⌘O"],
  ["Append","⇧⌘O"],["Insert text","⌘T"],
  ["Save","⌘S"],["Save As","⇧⌘S"],
  ["Find","⌘F"],["Undo / Redo","⌘Z / ⇧⌘Z"],
  ["Zoom In","⌘+"],["Zoom Out","⌘−"],
  ["Actual Size","⌘0"],["Edit token inline","⏎"],
  ["Move token","⌃⌘↑ / ↓"],["Insert token","⌥⌘↑ / ↓"],
  ["Previous / next head","⌃⌘[ / ]"],["Set as root","⌃⌘R"],
  ["Group / ungroup MWT","⌘G / ⇧⌘G"],["Delete token","⌘⌫"],
  ["Switch diagram ↔ grid","⌘\\"],
  // items 2/3/7 — annotation markers on the selected token (or, for reported speech, on the head of the selection)
  ["Foreign (italics)","⌘I"],["Typo (strikethrough)","⌘/"],
  ["Reported speech","⇧⌘'"],
  // item 12: the five diagram notations on ⌘1–⌘5
  ["Stemma notation","⌘1"],["Hierarchy notation","⌘2"],
  ["Arcs notation","⌘3"],["Brackets notation","⌘4"],
  ["Outline notation","⌘5"],
];
// item 10: group a vocabulary universe into the SAME subcategories as its context menu (UPOS_CATS / DEPREL_CATS).
// Mirrors optionMenu(): category members present in `all` are placed under their heading in category order; any
// leftover falls into a trailing "Other". Returns [[categoryName, [[tag,gloss],…]],…].
function helpGroups(all, cats, expandOf){
  const placed=new Set(), groups=[];
  cats.forEach(([name,members])=>{ const present=members.filter(m=>all.includes(m));
    present.forEach(m=>placed.add(m));
    if(present.length) groups.push([name, present.map(m=>[m, expandOf(m)||m])]); });
  const extra=all.filter(m=>!placed.has(m));
  if(extra.length) groups.push(["Other", extra.map(m=>[m, expandOf(m)||m])]);
  return groups;
}
function sheetHelp(){
  const s=shell("Help","Essential shortcuts and the SUD annotation vocabulary; every tag links to its guidelines page.","lg");
  const c=s.querySelector(".content"); c.classList.add("helpdlg");
  const openExt=url=>openExternal(url);   // the shared bridge-routed opener (openExternal in js/io/bridge.js) — the same one every context-menu guideline link now uses. It was window.open here, which a WKWebView silently drops, so the in-page Help sheet's tag links were dead while the Help WINDOW's (bridge-routed `_ext`) worked.
  const h=t=>{ const el=document.createElement("h4"); el.textContent=t; c.appendChild(el); };
  // Essential shortcuts
  h("Essential shortcuts");
  const kb=document.createElement("div"); kb.className="kbgrid";
  HELP_SHORTCUTS.forEach(([a,k])=>{ const row=document.createElement("div"); row.className="kbrow";
    const an=document.createElement("span"); an.className="kbact"; an.textContent=a;
    const kn=document.createElement("span"); kn.className="kbd"; kn.textContent=k;
    row.appendChild(an); row.appendChild(kn); kb.appendChild(row); });
  c.appendChild(kb);
  // a grid of linked [tag, expansion] pairs (returns the grid element; caller appends it)
  const tagGrid=(pairs,urlFn,noun)=>{ const g=document.createElement("div"); g.className="taggrid";
    pairs.forEach(([tag,gloss])=>{ const url=urlFn(tag);   // null → valid vocabulary with no dedicated guidelines page (e.g. unk): render plain text, not a dead link
      const link=document.createElement(url?"a":"span"); link.className="taglink"+(url?"":" taglink-noguide");
      if(url) link.href="#";
      link.innerHTML=`<span class="tagname">${esc(tag)}</span><span class="taggloss">${esc(gloss||"")}</span>`;
      link.title=url?`Open the guidelines for the “${tag}” ${noun}`:`No dedicated guidelines page for “${tag}”`;
      if(url) link.onclick=e=>{ e.preventDefault(); openExt(url); };
      g.appendChild(link); });
    return g; };
  // item 7: lay the category subsections out COLUMN-MAJOR — a CSS multicolumn container (.catcols) fills the
  // first column top-to-bottom, then the next. Each category (heading + its grid) is a .catblock kept whole.
  // Returns the built container (does NOT append it) so a caller can rebuild/replace it in place.
  const groupedGridsEl=(groups,urlFn,noun)=>{ const cols=document.createElement("div"); cols.className="catcols";
    groups.forEach(([cat,pairs])=>{ const blk=document.createElement("div"); blk.className="catblock";
      const el=document.createElement("h5"); el.className="catsub"; el.textContent=cat; blk.appendChild(el);
      blk.appendChild(tagGrid(pairs,urlFn,noun)); cols.appendChild(blk); });
    return cols; };
  const groupedGrids=(groups,urlFn,noun)=>{ c.appendChild(groupedGridsEl(groups,urlFn,noun)); };
  // Parts of speech — grouped into the same subcategories as the POS context menu (UPOS_CATS)
  h("Parts of speech (UPOS)");
  groupedGrids(helpGroups(UPOS_DEFAULT, UPOS_CATS, p=>UPOS_INFO[p]||p), posGuideUrl, "part of speech");
  // Syntactic relations — grouped into the same subcategories as the relation context menu, sourced from the LIVE
  // SETTINGS.deprel (not the fixed DEPREL_DEFAULT) so a relation typed into the grid's DepRel autocomplete shows up
  // here immediately; deprelMenuGroups interleaves any such addition into its own family (or alphabetically at the
  // end of "Other") instead of a separate catch-all "Custom" heading — relations are added in the grid now, not here.
  h("Syntactic relations (SUD)");
  groupedGrids(helpGroups(SETTINGS.deprel, deprelMenuGroups(SETTINGS.deprel), deprelExpand), relGuideUrl, "relation");
  // Deep features
  h("Deep features");
  c.appendChild(tagGrid(DEEP_OFFICIAL.map(f=>[f,DEEP_INFO[f]||f]), deepGuideUrl, "feature"));
  // External links
  h("Learn more");
  const links=document.createElement("div"); links.className="helplinks";
  [["SUD homepage","https://surfacesyntacticud.github.io/"],
   ["SUD guidelines","https://guidelines.surfacesyntacticud.org"],
   ["UD guidelines","https://universaldependencies.org/guidelines.html"]].forEach(([label,url])=>{
    const a=document.createElement("a"); a.className="helplink"; a.href="#"; a.textContent=label;
    a.title=label; a.onclick=e=>{ e.preventDefault(); openExt(url); }; links.appendChild(a); });
  c.appendChild(links);
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn primary" data-x>Close</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  return s;
}
/* item 23/25: the Help dialog is a SEPARATE NATIVE WINDOW in the desktop app. The frontend builds the
   self-contained page (it owns the shortcut list + SUD vocabulary) and hands it to the bridge, which loads
   it via create_window(html=…). Shortcuts and tag names use the proportional UI font — never monospace (item 25). */
const HELP_WIN_CSS=`
  :root{--bg:#fbfbfd;--fg:#1d1d1f;--muted:#68686e;--accent:#0a84ff;--line:rgba(0,0,0,.12);--hover:rgba(0,0,0,.05);--head:rgba(0,0,0,.6);--bad:#e0393e;--field-bg:#fff}
  @media(prefers-color-scheme:dark){:root{--bg:rgb(30,30,30);--fg:#e7e7ea;--muted:#9a9aa1;--accent:#3a9bff;--line:rgba(255,255,255,.13);--hover:rgba(255,255,255,.06);--head:rgba(255,255,255,.62);--bad:#ff6b6f;--field-bg:rgba(255,255,255,.06)}}
  *{box-sizing:border-box} html,body{margin:0}
  body{background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:18px 20px 22px}
  h4{margin:16px 0 4px;font-size:13px;font-weight:700;color:var(--head)} h4.first{margin-top:0}
  h5.catsub{margin:9px 0 2px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}   /* item 10: subcategory heading — mirrors the context-menu group headers (DEPREL_CATS / UPOS_CATS) */
  .kbgrid{columns:2;column-gap:22px}   /* item 11: shortcuts flow COLUMN-MAJOR (down column 1, then column 2), matching the .catcols categories */
  .kbrow{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:3px 5px;border-radius:6px;break-inside:avoid;-webkit-column-break-inside:avoid} .kbrow:hover{background:var(--hover)}
  .kbact{font-size:13px}
  .kbd{font-size:12.5px;color:var(--muted);flex:0 0 auto;direction:ltr;unicode-bidi:isolate}
  .taggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:1px 12px}
  .catcols{columns:2;column-gap:24px}   /* item 7: category subsections flow column-major (down column 1, then column 2) */
  .catblock{break-inside:avoid;-webkit-column-break-inside:avoid}
  .catblock .catsub{margin-top:0}   /* the block provides the inter-block gap → no double top margin at a column top */
  .catblock+.catblock{margin-top:9px}
  .taglink{display:flex;align-items:baseline;justify-content:space-between;gap:7px;padding:3px 6px;border-radius:6px;text-decoration:none;color:var(--fg);cursor:pointer}   /* item 8: no underline; tag left, gloss pushed to the right edge (space-between), like the context menus */
  a.taglink:hover{background:var(--hover)}
  .taglink .tagname{font-size:13px;font-weight:600;color:var(--accent);flex:0 0 auto}
  .taglink .taggloss{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;text-align:end;direction:ltr;unicode-bidi:isolate}   /* item 8/10: right-aligned expansion, matching .ctx .expand (11px, nowrap, LTR) */
  .taglink-noguide{cursor:default}   /* no guidelines page (e.g. unk) → plain <span>, not a dead link */
  .helplinks{display:flex;gap:18px;flex-wrap:wrap;margin-top:3px}
  a.helplink{font-size:13px;color:var(--accent);text-decoration:none} a.helplink:hover{text-decoration:underline}
  @media(max-width:520px){.kbgrid{columns:1}.catcols{columns:1}}`;
function buildHelpHTML(){ const g=s=>esc(s);
  const kb=HELP_SHORTCUTS.map(([a,k])=>`<div class="kbrow"><span class="kbact">${g(a)}</span><span class="kbd">${g(k)}</span></div>`).join("");
  const grid=(pairs,urlFn,noun)=>pairs.map(([tag,gloss])=>{ const url=urlFn(tag);   // null → no dedicated guidelines page (e.g. unk): plain span, not a dead link
    return url?`<a class="taglink" href="${g(url)}" title="Open the guidelines for the “${g(tag)}” ${g(noun)}" onclick="return _ext(this.href)"><span class="tagname">${g(tag)}</span><span class="taggloss">${g(gloss||"")}</span></a>`
      :`<span class="taglink taglink-noguide" title="No dedicated guidelines page for “${g(tag)}”"><span class="tagname">${g(tag)}</span><span class="taggloss">${g(gloss||"")}</span></span>`; }).join("");
  // item 7: category subsections laid out COLUMN-MAJOR via a CSS multicolumn container (.catcols); each
  // category (heading + grid) is a .catblock kept whole (break-inside:avoid).
  const subgrid=(groups,urlFn,noun)=>`<div class="catcols">`+groups.map(([cat,pairs])=>`<div class="catblock"><h5 class="catsub">${g(cat)}</h5><div class="taggrid">${grid(pairs,urlFn,noun)}</div></div>`).join("")+`</div>`;
  const pos=subgrid(helpGroups(UPOS_DEFAULT,UPOS_CATS,p=>UPOS_INFO[p]||p),posGuideUrl,"part of speech");
  const rel=subgrid(helpGroups(SETTINGS.deprel,deprelMenuGroups(SETTINGS.deprel),deprelExpand),relGuideUrl,"relation");
  const deep=grid(DEEP_OFFICIAL.map(f=>[f,DEEP_INFO[f]||f]),deepGuideUrl,"feature");
  const links=[["SUD homepage","https://surfacesyntacticud.github.io/"],["SUD guidelines","https://guidelines.surfacesyntacticud.org"],["UD guidelines","https://universaldependencies.org/guidelines.html"]].map(([l,u])=>`<a class="helplink" href="${g(u)}" onclick="return _ext(this.href)">${g(l)}</a>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${HELP_WIN_CSS}</style></head><body>`+
    `<h4 class="first">Essential shortcuts</h4><div class="kbgrid">${kb}</div>`+
    `<h4>Parts of speech (UPOS)</h4>${pos}`+
    `<h4>Syntactic relations (SUD)</h4><div id="relCols">${rel}</div>`+
    `<h4>Deep features</h4><div class="taggrid">${deep}</div>`+
    `<h4>Learn more</h4><div class="helplinks">${links}</div>`+
    `<script>function _ext(u){try{window.pywebview.api.open_external(u);}catch(e){}return false;}`+
    `document.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();try{window.pywebview.api.close_child_window('help');}catch(_){}}});`+
    `<\/script></body></html>`;
}
window.openHelp=function(){ if(hasBridge()){ try{ window.pywebview.api.open_help_window(buildHelpHTML()); return; }catch(e){} } openSheet(sheetHelp()); };

/* ── About dialog (small): app identity + version. Exposed as window.openAbout (the native program-menu
   About item opens it). */
function sheetAbout(){
  const s=shell("SUD Workbench",`A viewer and editor for SUD, UD and mSUD <span style="white-space:nowrap">CoNLL&#8209;U</span> dependency treebanks.`,"aboutsm");
  const c=s.querySelector(".content"); c.classList.add("aboutdlg");
  c.innerHTML=`<div class="aboutorg">Created by Siva Kalyan</div><div class="aboutver">Version ${esc(APP_VERSION)}</div>`;
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn primary" data-x>Close</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  return s;
}
window.openAbout=function(){ if(hasBridge()){ try{ window.pywebview.api.open_about_window(APP_VERSION); return; }catch(e){} } openSheet(sheetAbout()); };

