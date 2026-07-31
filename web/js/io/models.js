//@module js/models.js
/* ── parser model registry (dropdown + Manage Models sheet) ──────────────── */
// The dropdown is built from `installed` ALONE — never from `available`, which is a network listing
// and is empty of SUD models on an offline first launch. That is also why nothing here special-cases
// the bundled English parser: models_registry guarantees it in `installed` (it is pinned in
// requirements-core.txt, and _installed_sud_packages falls back to find_spec for a BUNDLED_SUD
// package the metadata scan misses), so the menu always offers English however the fetch went.
async function populateModels(){ if(!hasBridge())return;
  let r; try{ r=await window.pywebview.api.list_models(); }catch(e){ return; }
  const inst=(r&&r.installed)||[]; MODELINFO={}; MODELLANG={};
  const selEl=document.getElementById("modelSel"), cur=model;
  selEl.innerHTML='<option value="">None (manual)</option>';
  const groups={sud:[],stanza:[]};
  inst.forEach(e=>{ MODELINFO[e.id]=e.label||e.id; (groups[e.engine]||(groups[e.engine]=[])).push(e); });
  [...inst].sort((a,b)=>(a.engine==="sud"?0:1)-(b.engine==="sud"?0:1)).forEach(e=>{ if(e.lang&&!(e.lang in MODELLANG))MODELLANG[e.lang]=e.id; });   // prefer a SUD parser per language
  const addGroup=(label,arr)=>{ if(!arr||!arr.length)return; const og=document.createElement("optgroup"); og.label=label;
    arr.forEach(e=>{ const o=document.createElement("option"); o.value=e.id; o.textContent=e.label||e.id; og.appendChild(o); }); selEl.appendChild(og); };
  addGroup("SUD · spaCy",groups.sud); addGroup("UD · Stanza",groups.stanza);
  if([...selEl.options].some(o=>o.value===cur)) selEl.value=cur; else { model=""; selEl.value=""; } }
function manageModels(){ if(hasBridge()){ try{ window.pywebview.api.open_models_window(); return; }catch(e){} } openSheet(sheetModels()); }   // item 23: real window in the desktop app; in-page sheet is the headless fallback
let MODELS_AVAIL=[], EXTRAS_LIST=[], MODELS_TRAIN={};   // MODELS_TRAIN: model id → training-set sentences
// The bridge resolves the training-set sizes on a background thread (one UD stats.xml per treebank),
// handing back what it has so far plus `pending`; poll until it settles and patch the rows in place
// (re-rendering would drop the progress bar of any download running at the time).
// The FIGURE carries the emphasis, not its caption. `+MODELS_TRAIN[id]` coerces to a number, so
// nothing but digits and separators ever reaches innerHTML.
function modelTrainHtml(id){ const n=+MODELS_TRAIN[id]; return n?`Trained on <b>${n.toLocaleString()}</b> sentences`:""; }
function applyModelTrain(){ document.querySelectorAll("#mlist .modelrow[data-mid]").forEach(r=>{
  const el=r.querySelector(".mts"); if(el)el.innerHTML=modelTrainHtml(r.dataset.mid); }); }
async function pollModelTrain(refresh){ if(!hasBridge())return;
  let r; try{ r=await window.pywebview.api.model_train_sizes(!!refresh); }catch(e){ return; }
  Object.assign(MODELS_TRAIN,(r&&r.sizes)||{}); applyModelTrain();
  if(r&&r.pending) setTimeout(()=>pollModelTrain(false),1200); }
function sheetModels(){
  const s=shell("Manage Models","Download and remove SUD (spaCy) and UD (Stanza) parser models.","lg");
  const c=s.querySelector(".content");
  c.innerHTML='<input type="text" id="msearch" placeholder="Search language…" spellcheck="false" autocomplete="off"><div id="mlist" style="min-height:90px">Loading…</div>';
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn" data-x>Close</button><button class="tbtn" data-refresh>Refresh</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  act.querySelector("[data-refresh]").onclick=()=>renderModelList(c.querySelector("#mlist"),true);
  c.querySelector("#msearch").addEventListener("input",e=>drawModelList(c.querySelector("#mlist"),e.target.value));
  renderModelList(c.querySelector("#mlist"),false);
  return s; }
async function renderModelList(host,refresh){ if(!host)return;
  if(!hasBridge()){ host.textContent="Model management is available in the desktop app."; return; }
  host.textContent="Loading…";
  let r; try{ r=await window.pywebview.api.list_models(refresh); }catch(e){ host.textContent="Failed to load models: "+e; return; }
  if(r.error){ host.textContent="Failed to load models: "+r.error; return; }
  MODELS_AVAIL=r.available||[];
  MODELS_AVAIL.forEach(e=>{ if(e.train_sents)MODELS_TRAIN[e.id]=e.train_sents; });   // whatever the disk cache already knew, shown immediately
  try{ const ex=await window.pywebview.api.list_extras(); EXTRAS_LIST=(ex&&ex.extras)||[]; }catch(e){ EXTRAS_LIST=[]; }   // optional heavy-dependency tiers
  const box=host.closest(".content"), sb=box&&box.querySelector("#msearch");
  drawModelList(host, sb?sb.value:""); pollModelTrain(!!refresh); }
function drawModelList(host,query){ if(!host)return; const q=(query||"").trim().toLowerCase(); host.innerHTML="";
  const wp=q?wordPrefixRe(q):null;   // item: the Manage Models search field is a LANGUAGE search ("Search language…"), so it matches the way the other two language menus do — by word prefix, not substring. Built once here rather than per row, as they do
  const match=e=>!q || wp.test((e.label||"").toLowerCase()) || (e.lang||"").toLowerCase()===q;   // a label reads "English (EWT)" / "Ancient Greek (PROIEL)", so the treebank name in the brackets is a word of it and stays searchable; what goes is the mid-word hit ("ewt" no longer finding a language whose NAME happens to contain those letters)
  const mk=(title,engine)=>{ const rows=MODELS_AVAIL.filter(e=>e.engine===engine && match(e)); if(!rows.length)return;
    const h=document.createElement("div"); h.className="mgroup-h"; h.textContent=title; host.appendChild(h);
    rows.forEach(e=>host.appendChild(modelRow(e))); };
  mk("SUD · spaCy","sud"); mk("UD · Stanza","stanza");
  const hadModels=host.children.length>0;
  if(!q && EXTRAS_LIST.length){   // optional heavy-dependency tiers (downloaded on demand) — not filtered by the language search
    const h=document.createElement("div"); h.className="mgroup-h"; h.textContent="Optional language support"; host.appendChild(h);
    EXTRAS_LIST.forEach(t=>host.appendChild(extraRow(t))); }
  if(!host.children.length) host.textContent=q?"No matches.":"No models found (offline?). Try Refresh."; }
function extraRow(t){ const row=document.createElement("div"); row.className="modelrow";
  const info=document.createElement("div"); info.className="mi";
  info.innerHTML=`<span>${esc(t.label||t.id)}</span>${t.note?`<small>${esc(t.note)}</small>`:""}`;
  const right=document.createElement("div"); right.style.display="flex"; right.style.alignItems="center"; right.style.gap="8px";
  if(t.installed){ const tag=document.createElement("span"); tag.className="pill"; tag.textContent="Installed ✓"; right.appendChild(tag); }
  else { const b=document.createElement("button"); b.className="tbtn primary"; b.textContent="Install"; b.onclick=()=>installExtra(t,row,b); right.appendChild(b); }
  row.appendChild(info); row.appendChild(right); return row; }
async function installExtra(t,row,btn){ btn.disabled=true; btn.textContent="Starting…";
  const prog=document.createElement("div"); prog.className="mprog"; const bar=document.createElement("i"); prog.appendChild(bar); row.querySelector(".mi").appendChild(prog);
  let r; try{ r=await window.pywebview.api.install_extra(t.id); }catch(err){ btn.disabled=false; btn.textContent="Install"; prog.remove(); return toast("Install failed: "+err); }
  if(r.error){ btn.disabled=false; btn.textContent="Install"; prog.remove(); return toast(r.error); }
  const job=r.job_id;
  const tick=async()=>{ let st; try{ st=await window.pywebview.api.model_job_status(job); }catch(err){ return; }
    if(st.error){ btn.disabled=false; btn.textContent="Install"; prog.remove(); return toast("Install failed: "+st.error); }
    if(st.pct!=null) bar.style.width=st.pct+"%"; if(st.note)btn.textContent=st.note;
    if(st.done){ toast(st.warning||(esc(t.label||t.id)+" installed")); const h=row.parentElement; if(h)renderModelList(h,false); return; }
    setTimeout(tick,500); };
  tick(); }
function modelRow(e){ const row=document.createElement("div"); row.className="modelrow"; row.dataset.mid=e.id;
  const info=document.createElement("div"); info.className="mi";
  const meta=[e.version?("v"+e.version):null, e.size?(Math.round(e.size/1e6)+" MB"):null].filter(Boolean).join(" · ");
  info.innerHTML=`<span>${esc(e.label||e.id)}</span>${meta?`<small>${esc(meta)}</small>`:""}<small class="mts">${modelTrainHtml(e.id)}</small>`;
  const right=document.createElement("div"); right.style.display="flex"; right.style.alignItems="center"; right.style.gap="8px";
  if(e.installed){ const tag=document.createElement("span"); tag.className="pill"; tag.textContent=e.bundled?"Bundled ✓":"Installed ✓"; right.appendChild(tag);
    // A bundled model (models_registry.BUNDLED_SUD — the English parser the Wiktionary definition
    // lookup itself runs on) gets no Remove button: it came with the app, so it isn't the user's to
    // manage, and the bridge refuses the removal anyway.
    if(!e.bundled){ const b=document.createElement("button"); b.className="tbtn"; b.textContent="Remove"; b.onclick=()=>removeModel(e,row); right.appendChild(b); } }
  else { const b=document.createElement("button"); b.className="tbtn primary"; b.textContent="Download"; b.onclick=()=>downloadModel(e,row,b); right.appendChild(b); }
  row.appendChild(info); row.appendChild(right); return row; }
async function downloadModel(e,row,btn){ btn.disabled=true; btn.textContent="Starting…";
  const prog=document.createElement("div"); prog.className="mprog"; const bar=document.createElement("i"); prog.appendChild(bar); row.querySelector(".mi").appendChild(prog);
  let r; try{ r=await window.pywebview.api.download_model(e.id); }catch(err){ btn.disabled=false; btn.textContent="Download"; prog.remove(); return toast("Download failed: "+err); }
  if(r.error){ btn.disabled=false; btn.textContent="Download"; prog.remove(); return toast(r.error); }
  const job=r.job_id;
  const tick=async()=>{ let st; try{ st=await window.pywebview.api.model_job_status(job); }catch(err){ return; }
    if(st.error){ btn.disabled=false; btn.textContent="Download"; prog.remove(); return toast("Download failed: "+st.error); }
    if(st.pct!=null) bar.style.width=st.pct+"%"; if(st.note)btn.textContent=st.note;
    if(st.done){ toast(st.warning||(esc(e.label||e.id)+" installed")); populateModels(); const h=row.parentElement; if(h)renderModelList(h,false); return; }
    setTimeout(tick,500); };
  tick(); }
async function removeModel(e,row){ if(!(await askConfirm(`Remove ${e.label||e.id}?`,{danger:true,okLabel:"Remove"}))) return;
  let r; try{ r=await window.pywebview.api.remove_model(e.id); }catch(err){ return toast("Remove failed: "+err); }
  if(r.error) return toast(r.error);
  toast((e.label||e.id)+" removed"); populateModels(); const h=row.parentElement; if(h)renderModelList(h,false); }

