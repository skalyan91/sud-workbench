//@module js/readings.js
/* ── heteronym readings (Chinese, Japanese, Korean) — the token-menu "Readings of …" flyout ───────
   Han characters are heteronymic (行 = xíng "go" / háng "row"), Japanese kanji carry several
   on'yomi/kun'yomi, and a Hanja in Korean text carries several Sino-Korean readings (樂 = 락 "pleasure"
   / 악 "music" / 요 "to like"), so the ONE romanisation the backend picks is sometimes the wrong one
   for a given token. This flyout offers the alternatives — in the transliteration scheme CURRENTLY on display,
   never always Pinyin (app/translit.py renders each candidate through that scheme's own engine) —
   and a pick is committed exactly as a hand-typed romanisation is (see editTransInline): token
   .translit + MISC Translit, under one undo entry.
   Scoped to the same languages app.translit.readings is scoped to; every other language has nothing
   to choose between, so no row is ever built for one. */
const READING_LANGS=new Set(["zh","cmn","yue","lzh","ja","jpn","ko","kor"]);   // Mandarin / Cantonese / Literary Chinese / Japanese / Korean, with the ISO 639-3 aliases translit._canon_lang folds (cmn→zh, jpn→ja, kor→ko)
const READING_SCRIPT_RE=/[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ\ud840-\ud884]/;   // Han (incl. ext-A + compatibility, plus the plane-2/3 extensions matched by their LEAD SURROGATE — 60 of the vendored Sino-Korean graphs live there) or kana — a token with none of these has no reading to choose, so it never costs a bridge round-trip
// KOREAN deliberately does NOT add Hangul (가-힣) to that class. A Korean token's alternatives come from the HANJA in
// it — 樂 is 락 "pleasure" / 악 "music" / 요 "to like" — while a pure-Hangul token maps syllable-by-syllable and has
// exactly one romanisation. Hanja ARE Han characters, so the ranges above already admit every Korean token that has
// anything to choose; admitting Hangul as well would spend a bridge round-trip on every ordinary Korean token just to
// be told there are no alternatives, which is the one thing this test exists to prevent.
function readingLang(lang){ return READING_LANGS.has((lang||"").split(/[-_]/)[0].toLowerCase()); }
// Candidates are cached per (language, displayed scheme, form): the flyout is opened repeatedly on the
// same token, and the answer only changes when one of those three does — the key carries all three, so
// a scheme switch simply misses instead of needing an invalidation pass.
const READINGS_CACHE=new Map();
function readingsKey(form){ return DOCLANG+"|"+TRANSLIT_SCHEME+"|"+form; }
async function loadReadings(form){ const k=readingsKey(form); if(READINGS_CACHE.has(k)) return READINGS_CACHE.get(k);
  let r; try{ r=await window.pywebview.api.token_readings(form,DOCLANG,TRANSLIT_SCHEME); }catch(e){ r=null; }
  const list=(r&&r.readings)||[];   // a failed lookup caches [] too: no row, and no retry storm on every right-click
  READINGS_CACHE.set(k,list); return list; }
// The menu row, or null when there is nothing to offer. Returned SYNCHRONOUSLY so the token menu opens
// without waiting on the bridge: an uncached form fetches in the background and, only if it turns out to
// have alternatives AND the same menu is still on screen for the same token, reopens it with the row in
// place (`reopen`). Every later right-click on that form is a cache hit and builds the row outright.
function readingsMenuItem(si,tokId,reopen){
  if(!hasBridge()) return null;                        // browser design mode: no bridge, no readings — the row simply never appears
  if(!readingLang(DOCLANG)) return null;               // outside the CJK set the automatic romanisation is the only one there is
  if(!show.translit||!TRANSLIT_SCHEME) return null;    // no romanisation on display ⇒ nothing on screen for a pick to override
  const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t||!t.form||!READING_SCRIPT_RE.test(t.form)) return null;
  const have=READINGS_CACHE.get(readingsKey(t.form));
  if(have===undefined){ loadReadings(t.form).then(list=>{ if(!list||list.length<2) return;
      if(!ctx.classList.contains("show")||sel.s!==si||sel.t!==tokId) return;   // the user has clicked on / moved elsewhere — never yank a menu out from under them
      if(typeof reopen==="function") reopen(); });
    return null; }
  if(have.length<2) return null;                       // one possible reading ⇒ nothing to choose ⇒ no row at all
  return {label:`Readings of “${esc(t.form)}”`, sub:()=>readingItems(si,tokId,have), subFit:true}; }
// one row per candidate, best guess first (the backend orders them), the one in effect ticked — same ✓
// gutter the status-bar scheme menus use
function readingItems(si,tokId,list){ const t=DOC[si]&&DOC[si].tokens[tokId-1], cur=t?(t.translit||""):"";
  return list.map(r=>({label:esc(r), check:(r===cur), opt:true, fn:()=>applyReading(si,tokId,r)})); }   // opt:true OPENS that gutter — .ctx .ck is position:absolute at the menu's own 12px inset, and only .ctx button.opt's padding-inline-start:25px moves the label clear of it. Without the flag the ✓ was painted straight ON TOP of the first letter of the checked row ("xíng" → a stray tick struck through the "xí"), which is what read as an extra chevron inside the flyout; every other checkable context-menu list (POS, deprel, deep features) passes opt:true for exactly this reason
// Commit a picked reading: token.translit for the display, MISC Translit so it survives a save/reopen —
// the same two writes the click-editable STORED transliteration makes (editStoredTransInline). _trPick marks
// it as the USER's choice rather than a derived value, which is what keeps the automatic passes off it
// (fillTranslit's fromMisc and annotateTranslitMisc both skip a _trPick token; afterFormEdit clears the
// marker, because a reading picked for the OLD form says nothing about the new one).
// The two writes are in DIFFERENT schemes, and that is the whole point: the candidates above are rendered in
// the DISPLAYED scheme, while MISC holds the STORED one, so the pick goes through the same scheme→scheme
// derivation the row uses in the other direction (storeDisplayedPick — identity when the two coincide). The
// flyout and the editable stored value are two routes to one correction, and this is what makes them agree.
function applyReading(si,tokId,val){ const s=DOC[si], t=s&&s.tokens[tokId-1]; if(!t) return;
  if((t.translit||"")===val && t._trPick) return;   // already in effect and already the user's own → nothing to record, no undo entry
  pushUndo();
  t.translit=val;
  t._trMisc=true; t._trPick=true; t._trChk=1;
  markDirty(); preserveScroll(renderDoc);
  const stored=!!STORED_SCHEME;
  storeDisplayedPick(t,val).then(ok=>{ if(ok) preserveScroll(renderDoc);   // the MISC write lands one bridge round-trip later, inside the undo entry pushUndo already opened
    toast((!stored||ok) ? ("Reading set to "+val)
                        : (`Reading set to ${val} — that reading cannot be expressed in the stored ${storedLabel(STORED_SCHEME)} transliteration, which is left as it was`)); }); }
