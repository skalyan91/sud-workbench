//@module js/models.js
/* ── parser model registry (dropdown + Manage Models sheet) ──────────────── */
// The dropdown is built from `installed` ALONE — never from `available`, which is a network listing
// and is empty of SUD models on an offline first launch. That is also why nothing here special-cases
// the bundled English parser: models_registry guarantees it in `installed` (it is pinned in
// requirements-core.txt, and _installed_sud_packages falls back to find_spec for a BUNDLED_SUD
// package the metadata scan misses), so the menu always offers English however the fetch went.
async function populateModels(){ if(!hasBridge())return;
  let r; try{ r=await window.pywebview.api.list_models(); }catch(e){ return; }
  // `r.available` (post models_registry.merge_installed, not the raw r.installed scan) — the merge is
  // where update_available/installed_version actually get computed, and it still carries every
  // installed row (merged into an offered one, or synthesised when offline/rate-limited — see that
  // function's own note), so filtering it down to the installed ones loses nothing this dropdown
  // used to show. On report ("this should be indicated somehow in the models dropdown").
  const inst=((r&&r.available)||[]).filter(e=>e.installed); MODELINFO={}; MODELLANG={};
  const selEl=document.getElementById("modelSel"), cur=model;
  selEl.innerHTML='<option value="">None (manual)</option>';
  const groups={sud:[],stanza:[]};
  inst.forEach(e=>{ MODELINFO[e.id]=e.label||e.id; (groups[e.engine]||(groups[e.engine]=[])).push(e); });
  [...inst].sort((a,b)=>(a.engine==="sud"?0:1)-(b.engine==="sud"?0:1)).forEach(e=>{ if(e.lang&&!(e.lang in MODELLANG))MODELLANG[e.lang]=e.id; });   // prefer a SUD parser per language
  const addGroup=(label,arr)=>{ if(!arr||!arr.length)return; const og=document.createElement("optgroup"); og.label=label;
    arr.forEach(e=>{ const o=document.createElement("option"); o.value=e.id;
      // A plain text marker, not just a colour: three different native <select> popups render this
      // (WKWebView/macOS, WebView2/Windows, WebKitGTK/Linux) and <option> style support is not
      // guaranteed identical across them — the glyph is the part guaranteed to survive everywhere;
      // the colour (matching the Manage Models "Update" button's own --good) is a bonus where it renders.
      o.textContent=(e.update_available?"↑ ":"")+(e.label||e.id);
      if(e.update_available){ o.style.color="var(--good)"; o.title=`Update available: v${e.installed_version} installed, v${e.version} available — Manage Models to update`; }
      og.appendChild(o); }); selEl.appendChild(og); };
  addGroup("SUD · spaCy",groups.sud); addGroup("UD · Stanza",groups.stanza);
  if([...selEl.options].some(o=>o.value===cur)) selEl.value=cur; else { model=""; selEl.value=""; } }
/* `focus` names an extras tier to scroll to and flash on arrival — how the Script and transliteration
   menus' "install" link on an unavailable scheme leads to the row that answers it rather than to the
   top of a list with every model in it. Optional: the menu-bar command passes nothing. */
function manageModels(focus){ if(hasBridge()){ try{ window.pywebview.api.open_models_window(focus||""); return; }catch(e){} }
  openSheet(sheetModels()); if(focus) revealExtraRow(focus); }   // item 23: real window in the desktop app; in-page sheet is the headless fallback
// The sheet fallback's own reveal. It runs after openSheet because drawModels fills the list
// synchronously for the rows already known and asynchronously for the rest — so try now, and once
// more on the next frame for the pass that populated EXTRAS_LIST.
function revealExtraRow(tier){ const hit=()=>{ const el=document.querySelector(`#mlist .modelrow[data-tier="${CSS.escape(tier)}"]`);
    if(!el) return false; try{ el.scrollIntoView({block:"nearest"}); }catch(_){ el.scrollIntoView(); }
    el.classList.add("flash"); return true; };
  if(!hit()) requestAnimationFrame(()=>{ hit(); }); }
let MODELS_AVAIL=[], EXTRAS_LIST=[], MODELS_TRAIN={};   // MODELS_TRAIN: model id → training-set sentences
let MODELS_INSTALLED_ONLY=false;   // the "Installed only" toggle in Manage Models; a VIEW state, kept across opens of the sheet and deliberately not persisted to prefs — it answers "what do I have right now", which is a question you ask, not a setting you keep
let GREW_OK;   // grewpy + its OCaml backend, probed once per Manage Models open. UNDEFINED until then, and the Stanza warning below is written to say nothing in that state rather than warn on a question nobody asked
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
  /* The search field and the "Installed only" toggle share one row: they are two filters over the
     same list, and the list is long (every language both engines publish), so the question "what do
     I actually have?" is asked constantly and had no answer short of scrolling for the ✓ pills. A
     TOGGLE rather than a segmented Installed/All control — the unfiltered list is the resting state,
     and pressed/not-pressed says which of the two you are in without spending a second word on it. */
  c.innerHTML='<div class="mfilters"><input type="text" id="msearch" placeholder="Search language…" spellcheck="false" autocomplete="off">'
             +'<button type="button" class="tbtn" id="minst" aria-pressed="false" title="Show only the models installed on this machine">Installed only</button></div>'
             +'<div id="mlist" style="min-height:90px">Loading…</div>';
  const act=s.querySelector(".actions"); act.innerHTML=`<button class="tbtn" data-x>Close</button><button class="tbtn" data-refresh>Refresh</button>`;
  act.querySelector("[data-x]").onclick=closeSheet;
  act.querySelector("[data-refresh]").onclick=()=>renderModelList(c.querySelector("#mlist"),true);
  c.querySelector("#msearch").addEventListener("input",e=>drawModelList(c.querySelector("#mlist"),e.target.value));
  const ib=c.querySelector("#minst");
  ib.addEventListener("click",()=>{ MODELS_INSTALLED_ONLY=!MODELS_INSTALLED_ONLY;
    ib.classList.toggle("active",MODELS_INSTALLED_ONLY); ib.setAttribute("aria-pressed",String(MODELS_INSTALLED_ONLY));
    drawModelList(c.querySelector("#mlist"), c.querySelector("#msearch").value); });   // re-filter in place — the listing is already loaded, so this costs no bridge call
  ib.classList.toggle("active",MODELS_INSTALLED_ONLY); ib.setAttribute("aria-pressed",String(MODELS_INSTALLED_ONLY));   // the choice persists across opens of the sheet
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
  // …and whether grew can run at all, which decides whether the Stanza group is usable (see drawModelList).
  // Probed here rather than per row: `conversion_available` spawns the OCaml backend on its first call.
  try{ const g=await window.pywebview.api.conversion_available(); GREW_OK=!!(g&&g.grewpy&&g.backend); }catch(e){}
  const box=host.closest(".content"), sb=box&&box.querySelector("#msearch");
  drawModelList(host, sb?sb.value:""); pollModelTrain(!!refresh); }
function drawModelList(host,query){ if(!host)return; const q=(query||"").trim().toLowerCase(); host.innerHTML="";
  const wp=q?wordPrefixRe(q):null;   // item: the Manage Models search field is a LANGUAGE search ("Search language…"), so it matches the way the other two language menus do — by word prefix, not substring. Built once here rather than per row, as they do
  const match=e=>(!MODELS_INSTALLED_ONLY||e.installed) && (!q || wp.test((e.label||"").toLowerCase()) || (e.lang||"").toLowerCase()===q);   // the two filters compose: "Installed only" narrows what the language search then searches, so a search inside it still means what it says   // a label reads "English (EWT)" / "Ancient Greek (PROIEL)", so the treebank name in the brackets is a word of it and stays searchable; what goes is the mid-word hit ("ewt" no longer finding a language whose NAME happens to contain those letters)
  const mk=(title,engine)=>{ const rows=MODELS_AVAIL.filter(e=>e.engine===engine && match(e)); if(!rows.length)return;
    const h=document.createElement("div"); h.className="mgroup-h"; h.textContent=title; host.appendChild(h);
    rows.forEach(e=>host.appendChild(modelRow(e))); };
  mk("SUD · spaCy","sud"); mk("UD · Stanza","stanza");
  /* …AND WHY EVERY STANZA MODEL WOULD BE INERT, said BEFORE a 400 MB download rather than after.
     Stanza emits UD and this app stores SUD, so `parse._parse_stanza_ud_to_sud` runs the conversion
     grammar on EVERY Stanza parse — which needs grewpy AND its OCaml backend. Where the backend is
     missing the models install and download perfectly and then do nothing at all, which is exactly
     how the fault was reported. The spaCy group is unaffected (those models ARE SUD) and says
     nothing. `GREW_OK` is filled by renderModelList; undefined (never probed) shows no warning
     rather than a false alarm. */
  if(GREW_OK===false && MODELS_AVAIL.some(e=>e.engine==="stanza"&&match(e))){
    const w=document.createElement("div"); w.className="mnote mwarn";
    w.textContent="Stanza models produce UD, which this app converts to SUD with grew — and the grew backend is not available here, so they will parse nothing. Reinstall the app, or install it yourself with: brew install opam && opam init && opam install grewpy_backend";
    const h=[...host.querySelectorAll(".mgroup-h")].filter(x=>x.textContent==="UD · Stanza")[0];
    if(h&&h.nextSibling) host.insertBefore(w,h.nextSibling); else host.appendChild(w); }
  const hadModels=host.children.length>0;
  if(!q && !MODELS_INSTALLED_ONLY && EXTRAS_LIST.length){   // optional heavy-dependency tiers (downloaded on demand) — not filtered by the language search, and out of scope entirely under "Installed only", which is a question about MODELS
    const h=document.createElement("div"); h.className="mgroup-h"; h.textContent="Optional language support"; host.appendChild(h);
    EXTRAS_LIST.forEach(t=>host.appendChild(extraRow(t))); }
  if(!host.children.length) host.textContent=MODELS_INSTALLED_ONLY?(q?"No installed models match.":"No models installed yet."):(q?"No matches.":"No models found (offline?). Try Refresh.");   // "No matches" under a filter the reader set is a dead end; naming the filter says what to undo
}
function extraRow(t){ const row=document.createElement("div"); row.className="modelrow"; row.dataset.tier=t.id;   // what revealExtraRow looks the focused tier up by
  const info=document.createElement("div"); info.className="mi";
  info.innerHTML=`<span>${esc(t.label||t.id)}</span>${t.note?`<small>${esc(t.note)}</small>`:""}`;
  const right=document.createElement("div"); right.style.display="flex"; right.style.alignItems="center"; right.style.gap="8px";
  if(t.installed){ const tag=document.createElement("span"); tag.className="pill"; tag.textContent="Installed ✓"; right.appendChild(tag); }
  else { const b=document.createElement("button"); b.className="tbtn primary"; b.textContent="Install"; b.onclick=()=>installExtra(t,row,b); right.appendChild(b); }
  row.appendChild(info); row.appendChild(right); return row; }
// Turns `btn` into its OWN progress indicator — a left-to-right fill — instead of a separate bar
// appended under the row's label, which used to grow the row's own height. On report: "the install
// button should itself become a progress bar... starting out as an outlined button, and then filling
// in from left to right... this way the row won't suddenly become taller". `background` is set as an
// INLINE style (not via a CSS custom property some class rule reads) deliberately: inline always wins
// outright, so filling the button never has to referee a specificity race against .primary/.success's
// own `background`. Returns {setPct(pct), reset()}; reset() restores the button's resting look/label
// exactly as it was before progress started (this is also the failure path — a stalled/errored
// install leaves the button looking like it never left its resting state, not stuck mid-fill).
function progressButton(btn,restLabel){
  const color=btn.classList.contains("success")?"var(--good)":"var(--accent-blue,#0088ff)";
  btn.classList.add("progress"); btn.style.border="1.5px solid "+color;
  // The button's OWN text stays a PLAIN, ORDINARY text node — in normal flow, same as any resting
  // button's label — recoloured via `color` rather than replaced by a span. On report: "the
  // progress-bar button is absurdly narrow — too small to contain its text": the first version made
  // BOTH copies position:absolute spans, so the button had NO in-flow content left to size itself
  // against and collapsed to its bare padding. Only ONE extra layer is actually needed: .fg (white,
  // absolutely positioned, clip-path'd to the filled portion) painted OVER this text — wherever it's
  // clipped away, the button's own (now-coloured) text shows through underneath, so the label always
  // reads as whichever colour actually CONTRASTS with what's directly behind it, on report: "the
  // button text should be white where the progress bar is filled in, and button-coloured where it's
  // not... always the contrasting colour". See .tbtn.progress .plabel.fg (app.css) for the overlay.
  const startText=btn.textContent;
  btn.style.color=color;
  const bgText=document.createTextNode(startText);
  const fg=document.createElement("span"); fg.className="plabel fg"; fg.textContent=startText;
  btn.textContent=""; btn.append(bgText,fg);
  const setText=t=>{ bgText.textContent=t; fg.textContent=t; };
  const setPct=pct=>{ btn.style.background=`linear-gradient(to right, ${color} ${pct}%, transparent ${pct}%)`; fg.style.clipPath=`inset(0 ${100-pct}% 0 0)`; };
  setPct(0);
  return { setPct, setText, reset(){ btn.classList.remove("progress"); btn.style.border=""; btn.style.background=""; btn.style.color=""; btn.disabled=false; btn.textContent=restLabel; } };
}
async function installExtra(t,row,btn){ btn.disabled=true; btn.textContent="Starting…";
  const p=progressButton(btn,"Install");
  let r; try{ r=await window.pywebview.api.install_extra(t.id); }catch(err){ p.reset(); return toast("Install failed: "+err); }
  if(r.error){ p.reset(); return toast(r.error); }
  const job=r.job_id;
  const tick=async()=>{ let st; try{ st=await window.pywebview.api.model_job_status(job); }catch(err){ return; }
    if(st.error){ p.reset(); return toast("Install failed: "+st.error); }
    if(st.pct!=null) p.setPct(st.pct); if(st.note) p.setText(st.note);
    if(st.done){ toast(st.warning||(esc(t.label||t.id)+" installed")); const h=row.parentElement; if(h)renderModelList(h,false); return; }
    setTimeout(tick,500); };
  tick(); }
function modelRow(e){ const row=document.createElement("div"); row.className="modelrow"; row.dataset.mid=e.id;
  const info=document.createElement("div"); info.className="mi";
  // On report ("whenever there is a newer version of a parser than what's installed, the Install
  // button should become a green Update button"): update_available/installed_version come from
  // models_registry.merge_installed, which now keeps the on-disk version distinct from `version`
  // (the latest OFFERED one) rather than the latter silently overwriting it. Named both, rather than
  // leaving the button alone to say it: a bare "Update" with no numbers still leaves "update to WHAT,
  // from WHAT" unanswered.
  const meta=(e.installed&&e.update_available&&e.installed_version)
    ? ("v"+e.installed_version+" installed · v"+e.version+" available")
    : [e.version?("v"+e.version):null, e.size?(Math.round(e.size/1e6)+" MB"):null].filter(Boolean).join(" · ");
  info.innerHTML=`<span>${esc(e.label||e.id)}</span>${meta?`<small>${esc(meta)}</small>`:""}<small class="mts">${modelTrainHtml(e.id)}</small>`;
  const right=document.createElement("div"); right.style.display="flex"; right.style.alignItems="center"; right.style.gap="8px";
  if(e.installed){ const tag=document.createElement("span"); tag.className="pill"; tag.textContent=e.bundled?"Bundled ✓":"Installed ✓"; right.appendChild(tag);
    // A bundled model (models_registry.BUNDLED_SUD — the English parser the Wiktionary definition
    // lookup itself runs on) gets no Remove button: it came with the app, so it isn't the user's to
    // manage, and the bridge refuses the removal anyway. Update is NOT gated on !e.bundled though —
    // on report ("I should be able to update the bundled English parser"): a newer release is still
    // worth taking even for a model that ships pinned, and models_registry.download() now handles the
    // one thing that made this actually work rather than silently do nothing (a BUNDLED package's
    // core-venv copy otherwise always wins sys.path resolution over whatever Update installs — see
    // its own note, "…AND CLEAR THE CORE VENV'S OWN SHADOW").
    // Update reuses downloadModel as-is: the bridge's download_model already purges the old install
    // and force-reinstalls (models_registry.download's own note), so there is no separate "upgrade"
    // call to make — only which button and label got the reader here differs.
    if(e.update_available){ const u=document.createElement("button"); u.className="tbtn success"; u.textContent="Update"; u.onclick=()=>downloadModel(e,row,u,"Update"); right.appendChild(u); }
    if(!e.bundled){ const b=document.createElement("button"); b.className="tbtn"; b.textContent="Remove"; b.onclick=()=>removeModel(e,row); right.appendChild(b); } }
  else { const b=document.createElement("button"); b.className="tbtn primary"; b.textContent="Download"; b.onclick=()=>downloadModel(e,row,b); right.appendChild(b); }
  row.appendChild(info); row.appendChild(right); return row; }
async function downloadModel(e,row,btn,label){ label=label||"Download"; btn.disabled=true; btn.textContent="Starting…";
  const p=progressButton(btn,label);
  let r; try{ r=await window.pywebview.api.download_model(e.id); }catch(err){ p.reset(); return toast(label+" failed: "+err); }
  if(r.error){ p.reset(); return toast(r.error); }
  const job=r.job_id;
  const tick=async()=>{ let st; try{ st=await window.pywebview.api.model_job_status(job); }catch(err){ return; }
    if(st.error){ p.reset(); return toast(label+" failed: "+st.error); }
    if(st.pct!=null) p.setPct(st.pct); if(st.note) p.setText(st.note);
    if(st.done){ toast(st.warning||(esc(e.label||e.id)+(label==="Update"?" updated":" installed"))); populateModels(); const h=row.parentElement; if(h)renderModelList(h,false); return; }
    setTimeout(tick,500); };
  tick(); }
async function removeModel(e,row){ if(!(await askConfirm(`Remove ${e.label||e.id}?`,{danger:true,okLabel:"Remove"}))) return;
  let r; try{ r=await window.pywebview.api.remove_model(e.id); }catch(err){ return toast("Remove failed: "+err); }
  if(r.error) return toast(r.error);
  toast((e.label||e.id)+" removed"); populateModels(); const h=row.parentElement; if(h)renderModelList(h,false); }

