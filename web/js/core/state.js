//@module js/state.js
"use strict";
document.documentElement.lang=document.documentElement.lang||"en";   // enable WebKit's native hyphenation (hyphens:auto) for message prose
const APP_VERSION="0.1.0";   // shown in the About dialog (window.openAbout)
const UPOS_DEFAULT=["ADJ","ADP","ADV","AUX","CCONJ","DET","INTJ","NOUN","NUM","PART","PRON","PROPN","PUNCT","SCONJ","SYM","VERB","X"];
const DEPREL_DEFAULT=["root","subj","udep","comp","comp:obj","comp:obl","comp:pred","comp:aux","comp:cleft","mod","det","clf","cc","conj","conj:coord","conj:appos","conj:dicto","flat","compound","list","goeswith","orphan","punct","unk","parataxis","parataxis:parenth","parataxis:insert","dislocated","discourse","vocative"];   // SUD relations + subtypes (":"); deep features ("@", e.g. mod@relcl, subj@expl) live in the Deep column. compound = shared_ud nominal/verbal compounding relation. clf/list/goeswith/orphan/root/det/cc/punct are UD relations SUD doesn't redefine (so they link to the UD guidelines — see relGuideUrl). "conj:redup" was dropped (2026-07): confirmed against the real guidelines site that it has no guidelines page anywhere — corpus-specific/placeholder, not official vocabulary. unk IS valid SUD (used for unanalysable relations) despite having no dedicated guidelines page — see NO_GUIDE_RELS/relGuideUrl.
let SETTINGS={scheme:"SUD",upos:[...UPOS_DEFAULT],deprel:[...DEPREL_DEFAULT]};
let model="", notation="stemma", stemmaCat=false, stemmaProj=true, conv="stemma", FS=1;
let DOCFORMAT="SUD";   // detected format of the live doc: SUD/mSUD are editable, UD is import/export only
let MODELINFO={};      // qualified model id → its display label, from the backend registry
let DOCLANG="en";      // item 21: default language English (never unset); drives the status pill, RTL, transliteration
const RTL_LANGS=new Set(["ar","fa","he","ur","ps","syr","dv","ckb","sd","ug","yi","arc"]);
/* Languages written WITHOUT word-separating spaces. Only these offer "Merge tokens": merging is the repair for
   a word the TOKENISER split where no boundary exists, and that is a mistake only a segmenter can make. Where
   words are space-delimited the tokeniser is not guessing where they end — a split there means the FILE has a
   stray space, which UD represents with `goeswith` (non-destructive, both tokens kept) rather than by fusing
   them. Offering a destructive merge in those languages invites the wrong repair for the wrong problem.
   Korean is deliberately absent: it is written in Hangul but spaced. Kept as language codes rather than the
   character-range test app/parse.py uses (_spaceless_script): that one judges each RUN of an arbitrary parsed
   sentence and must cope with mixed script, whereas this decides whether a COMMAND exists, and a menu row that
   appears and vanishes with the selection is worse than one whose availability the document settles. */
const SPACELESS_LANGS=new Set(["zh","lzh","yue","wuu","nan","hak","gan","hsn","cdo","ja","th","lo","km","my","bo","dz"]);
function isSpacelessLang(lang){ const b=((lang!=null?lang:DOCLANG)||"").toLowerCase().split(/[-_]/)[0]; return SPACELESS_LANGS.has(b); }
const LANGNAMES={ar:"Arabic",de:"German",en:"English",es:"Spanish",fa:"Persian",fr:"French",he:"Hebrew",id:"Indonesian",it:"Italian",ja:"Japanese",ko:"Korean",la:"Latin",lzh:"Literary Chinese",nl:"Dutch",pt:"Portuguese",ru:"Russian",sa:"Sanskrit",ur:"Urdu",yue:"Cantonese",zh:"Chinese"};
let _isoName=null;   // lazy code→reference-name map over the embedded ISO 639-3 table (window.ISO639_3 = [[code3, code1||"", name], …])
// item 22: Glottolog name overrides (iso3 → Glottolog name) for the ~1160 codes where Glottolog differs from the ISO
// 639-3 reference name (e.g. mlv → "Mwotlap" not "Motlav"). Vendored compactly in iso639-3.js as a TAB/`=` string.
let _glotName=null;
function glotName(c){ if(_glotName===null){ _glotName=new Map(); (window.GLOTTOLOG_NAME||"").split("\t").forEach(e=>{ const i=e.indexOf("="); if(i>0)_glotName.set(e.slice(0,i),e.slice(i+1)); }); } return _glotName.get(c)||""; }
function isoName(c){ if(!_isoName){ _isoName=new Map(); (window.ISO639_3||[]).forEach(e=>{ const nm=glotName(e[0])||e[2]; _isoName.set(e[0],nm); if(e[1])_isoName.set(e[1],nm); }); } return _isoName.get(c)||""; }   // reachable by either the 3-letter or the 2-letter code; prefers the Glottolog name
function langName(l){ return LANGNAMES[l]||isoName(l)||l||""; }   // built-in two-letter names first, then the ISO 639-1 or ISO 639-3 reference name
/* ── HOW A TYPED QUERY MATCHES A LANGUAGE NAME, everywhere a language is searched for ─────────────────────────
   WORD PREFIX, on request: "eng" matches all and only the languages one of whose NAME WORDS begins with "eng" —
   English, Engenni, Middle English — and no longer Bemba-Engo… by way of a bare substring hit in the middle of a
   word. The old test was `name.includes(q)`, which at two or three letters pulled in a long tail of languages
   with the letters buried inside them; those swamped the rows anyone was actually looking for, since the list
   renders only its first LM_MAX rows.
   A "word" starts at the beginning of the name or after any character that is not a letter or a digit — which is
   what makes it right for the names actually in the table: spaces ("Ancient Greek"), hyphens ("Serbo-Croatian"),
   apostrophes ("K'iche'"), slashes and parentheses ("Kalaallisut (Greenlandic)"). \p{L}/\p{N} with the `u` flag
   rather than [A-Za-z0-9], because the names are not all Latin-script and a byte-class test would find a word
   boundary in the middle of one that is not.
   The query is REGEX-ESCAPED before it is spliced in: it is arbitrary text the user typed, and a stray "(" would
   otherwise throw a SyntaxError out of the keystroke handler and freeze the menu on that character. */
function wordPrefixRe(q){ return new RegExp("(?:^|[^\\p{L}\\p{N}])"+String(q).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"u"); }
function wordPrefix(name,q){ return !!name && !!q && wordPrefixRe(q).test(name); }   // `name` is expected already lowercased by the caller (every call site lowercases both sides once, rather than per-row)
// 2-letter ISO 639-1 ↔ 3-letter ISO 639-3 bridge: each ISO639_3 row carries [code3, code1||"", name]. The
// canonical UD code of a row is code1||code3 (used at pick time); isoName above resolves EITHER code to a name.
function modelLang(id){ if(!id)return ""; const i=id.indexOf(":"); if(i<0)return ""; const eng=id.slice(0,i),name=id.slice(i+1);
  if(eng==="sud")return name.split("_")[0]||""; if(eng==="stanza")return name.split("#")[0]||""; return ""; }
function setLang(l){ DOCLANG=l||"en"; const p=document.getElementById("tokInfo"); if(!p)return;   // item 21: default to English when none is detected/selected; the language can no longer be UNSET
  p.classList.add("pickable");   // the pill always opens the ISO 639-3 language picker
  p.title="Click to set the document language (any ISO 639-3 language)";
  const lbl=document.getElementById("tokInfoLabel"); if(lbl)lbl.textContent="Language: "+langName(DOCLANG);   // the label span only — the trailing chevron svg is a persistent sibling
  loadTranslitSchemes(DOCLANG); loadOrthoSchemes(DOCLANG); loadDocScript(); }   // refresh the status-bar transliteration + orthography menus for the new language — and re-read which script the DOCUMENT stores its text in (DOCSCRIPT), which the two menus' Sanskrit gates and every ITRANS conversion read
// "Transliteration necessary" = the language's primary script is NON-Latin, so romanising is meaningful.
// Signal: a set of non-Latin languages by canonical UD code, mirroring app/translit.py's routing — its
// explicit non-Latin backends (Arabic/CJK/Persian/Hebrew), every RTL language, and the wiktra-romanisable
// non-Latin scripts (Cyrillic, Greek, Brahmic/Indic, SE-Asian, Armenian, Georgian, Ethiopic). A Latin-script
// language is ABSENT here → transliterate() returns the input unchanged (identity), so display is unnecessary.
// SPECIAL CASE: Sanskrit ("sa"/"san") is treated as Latin-script (IAST) — deliberately NOT in this set — so
// switching TO it turns the display off by default; transliteration into Devanagari stays AVAILABLE on demand.
// Limits: a binary Latin/non-Latin split over UD codes, anchored on the app's supported languages + major
// world scripts; an obscure non-Latin language outside this set is read as "unnecessary" (the backend can't
// romanise it anyway) — the display is only auto-hidden, never disabled, so it's one click to restore.
