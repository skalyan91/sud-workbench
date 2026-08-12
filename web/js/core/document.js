//@module js/document.js
/* ═══ RUNNING THE TOKENISER IN REVERSE ════════════════════════════════════════════════════════════
   Which stretch of the sentence's own `# text` does each token occupy? Answering that is what lets
   the annotations the diagram already draws (Foreign, Typo/CorrectForm, Reported speech) also be
   drawn on the RUNNING SENTENCE — the .stext line in each block header.

   THE UNIT OF ALIGNMENT IS THE SURFACE UNIT, NOT THE TOKEN. `# text` contains a multi-word token's
   own surface form ("du", "للمدرسة"), never its component words, so the walk consumes an MWT range
   as ONE unit and hands the resulting span to every component alike. Empty nodes (s.empties) are a
   separate list, not part of s.tokens, and contribute no text at all — so they need no handling
   here beyond not being walked.

   `# text` IS AUTHORITATIVE and is emphatically not guaranteed to equal a naive join of the forms:
   it may be hand-edited, it may spell a Typo=Yes word its corrected way, its tokens may have been
   reordered under it, and in Sanskrit it carries EXTERNAL SANDHI that no component form appears in
   verbatim. So the reconstruction is VERIFIED against the real string rather than assumed, and
   where it does not verify we decorate NOTHING rather than decorate the wrong span.

   THREE STAGES, in this order of trust (measured over samples/: 14 of 20 sentences settle at stage
   1, including every Sanskrit sentence, and 2 at stage 2):
    1. DETERMINISTIC RECONSTRUCTION (alignUnitsToText, below) — match each unit's form literally at
       the next non-whitespace position. Needs no model, no bridge and no network, is exact wherever
       the forms really are substrings of the text, and is self-verifying: a literal match at the
       computed offset cannot be a mis-assignment. SpaceAfter=No is deliberately NOT consulted —
       skipping *optional* whitespace subsumes it and additionally survives a `# text` whose spacing
       the flags don't describe (the Chinese sample's "我 没有 问题。" against six spaceless tokens).
       (There was a stage 2 here: a Sanskrit `# text` used to be written in Clay-Sanskrit-Library
       notation — the sandhied surface with its coalescences MARKED rather than undone, so that
       `śaśa-bhṛto` held `śaśa`+`bhṛtaḥ` and no unit's form appeared in the line at all — and
       reversing that marking with the offsets kept was the only way to align it. The Sanskrit model
       now writes ordinary sandhied text and reports each multi-word token's range as the
       orthographic word it came from, so every unit IS a substring of the line and stage 1 settles
       it, in Devanagari as in IAST. The reversal engine went with the notation.)
    2. THE TOKENISER'S OWN OFFSETS (a bridge call) — the general fallback. The tokeniser produced
       its units FROM this very text, so each carries a real character span (read off token.idx, or
       PUBLISHED as doc._.src_spans by a tokeniser that rewrites what it reads); the file's units are
       ALIGNED TO those, never replaced by them, because the file's tokenisation is the annotation
       and the model's is a second opinion about the same string. Needs an installed model, and the
       character-level alignment inside a divergent run is a best effort rather than a proof.
   Stage 2 needs the bridge and is therefore ASYNC — see requestTokenSpans. */
const _STX_WS=/\s/;   // JS \s already covers NBSP, the U+2000–200A spaces, U+202F/205F and the ideographic space U+3000 — every gap `# text` can hold between two units
/* the sentence's SURFACE units in reading order: {form, ids:[1-based token ids], mwt}
   The FORM is the only surface a unit wears in `# text`. UD defines `# text` as the sentence as it was
   really written — reconstructible from the FORM column — so a Typo=Yes token appears there MISSPELLED,
   and its MISC CorrectForm is emphatically NOT an alternative spelling the walk may accept. A file whose
   `# text` prints the corrected word instead is malformed, and the right answer is to leave it
   unaligned: decorating it would mean trusting offsets the file has already contradicted. (An earlier
   pass did accept the CorrectForm here, on the strength of samples/english.conllu s6 — but that sample
   was simply wrong, and has been fixed rather than accommodated.) */
/* ONE ROW OF THE RUNNING SENTENCE, re-spelt unit by unit and spaced as `# text` spaces it.
   `pick(unit)` says what to draw for an orthographic word — the SCRIPT rendering for the top line, the
   transliteration for the row beneath — and everything else is shared, because the two rows differ only
   in that choice and must not differ in anything else.
   The whitespace is `# text`'s, never invented. Preferred source is the alignment stextSpans already
   computes for the decoration pass: with a span per unit, the gap between two units is a literal slice
   of the text, so a line break, a run of spaces and a SpaceAfter=No seam all come across without any of
   them being reasoned about. Fallback, for a sentence with no spans (no bridge, or a text its tokens
   cannot be aligned to): MISC SpaceAfter=No, as io_conllu rebuilds `# text`. A flat join(" ") — which is
   what both rows used to do — put a space before every full stop, dropped the line breaks of a verse,
   and made an unchanged romanisation LOOK different from the text it romanises, which is what kept the
   duplicate transliteration row on screen (see trLayer's caller).
   The unit walk matches sentUnits' exactly, and has to: stextSpans indexes its answer by that order. */
function runningLine(s,si,pick,fixedGap){
  const units=[]; let k=0; while(k<((s&&s.tokens)||[]).length){ const m=(s.mwt||[]).find(x=>x.from===k+1);
    if(m){ units.push({mwt:m,last:Math.min(m.to,s.tokens.length)-1}); k=m.to; } else { units.push({tok:s.tokens[k],last:k}); k++; } }
  if(!units.length) return "";
  /* `fixedGap` replaces a FUSED junction with one separator, and CSL is why it exists: a scheme that MARKS
     a junction writes the two pieces apart, so its line must not inherit the spacing of a text that shows
     them run together. Taking the gaps verbatim produced `vartm'âpunarjanmanām` — the mark welded to the
     next word, indistinguishable from a letter — where the notation asks for `vartm" â-punar-janmanām`.
     ⚠ IT REPLACES THE GAP, IT DOES NOT FLATTEN IT. A gap carrying a NEWLINE is a verse line break, which
     is a fact about the poem and not about sandhi, so it survives verbatim; only a gap with no line break
     in it becomes the separator. Joining every unit with a plain space collapsed the four pādas of each
     stanza onto one line. */
  const al0=(typeof stextSpans==="function")?stextSpans(s,si,s.text||""):null;
  if(fixedGap!=null){
    /* `fixedGap` may be a FUNCTION of the next unit's rendered text rather than a plain separator, which is
       what a spaceless script needs: a romanisation of Chinese has to be spaced (the source has no gaps to
       inherit, so taking them verbatim ran the whole line together — `yǐnyánwǒzài…`), but pinyin still writes
       its punctuation tight against the word before it. Deciding per junction from the FOLLOWING piece gets
       both: no space before a comma, a space after it. The units' text is picked once here rather than twice
       per junction — pick() can be a script conversion, and this is on the render path. */
    const ok=al0&&al0.spans&&al0.spans.length===units.length&&al0.spans.every(Boolean);
    const txt=units.map(u=>pick(u)||"");
    const sepOf=(next,prev)=>(typeof fixedGap==="function")?(fixedGap(next,prev)||""):fixedGap;
    return txt.map((t,n)=>{ if(n>=units.length-1) return t;
      const raw=ok?(s.text||"").slice(al0.spans[n][1],al0.spans[n+1][0]):"";
      return t+(/\n/.test(raw)?raw:sepOf(txt[n+1],t)); }).join(""); }
  const al=al0;
  const gaps=(al&&al.spans&&al.spans.length===units.length&&al.spans.every(Boolean))
    ? units.map((_u,n)=>n<units.length-1 ? (s.text||"").slice(al.spans[n][1],al.spans[n+1][0]) : "")
    : units.map((u,n)=>n<units.length-1 ? (spaceAfterNo(s.tokens[u.last])?"":" ") : "");
  return units.map((u,n)=>(pick(u)||"")+gaps[n]).join(""); }
function sentUnits(s){ const t=(s&&s.tokens)||[], mwt=(s&&s.mwt)||[], out=[]; let i=0;
  while(i<t.length){ const m=mwt.find(x=>x.from===i+1);
    if(m){ const ids=[]; for(let k=m.from;k<=Math.min(m.to,t.length);k++) ids.push(k); out.push({form:m.form||"",ids,mwt:true}); i=m.to; }   // an MWT is ONE unit: the text holds its surface form, not its components
    else { out.push({form:t[i].form||"",ids:[i+1],mwt:false}); i++; } }
  return out; }
// A unit's COMPONENT forms — its own form for an ordinary token, the MWT's member tokens for a
// range. Stage 2 verifies against these rather than against the MWT's surface form, and that is the
// whole difference between a proof and a guess there: `â-punar-janmanām` reverses to exactly
// a/punaḥ/janmanām, whereas the range's surface form `apunarjanmanām` still carries the sandhi and
// so matches nothing exactly. Sent alongside the forms; every other stage ignores it.
function unitParts(s,units){ const t=(s&&s.tokens)||[]; return units.map(u=>u.ids.map(id=>(t[id-1]&&t[id-1].form)||"")); }
// Stage 1. Returns one [start,end) per unit, or null if the reconstruction does not verify — the
// whole point is that a partial or approximate answer is worse than none, because a decoration on
// the wrong span is a lie about the annotation.
// The optional-whitespace skip, both ways. A literal "\n" in `# text` is a preserved display line break
// (js/io/bridge.js restores it to a real newline on open, but a document that reached DOC by another route
// may still carry the two characters), so both directions step over it as if it were one space. Factored
// out of alignUnitsToText because the BACKWARD walk (alignUnitsAround, below) has to skip exactly the same
// things in reverse — two spellings of "optional whitespace" would be two ways for the two walks to
// disagree about where a unit ends.
function _stxSkipF(text,j){ while(j<text.length){ if(_STX_WS.test(text[j])) j++;
    else if(text[j]==="\\"&&text[j+1]==="n") j+=2;
    else break; } return j; }
function _stxSkipB(text,j){ while(j>0){ if(_STX_WS.test(text[j-1])) j--;
    else if(j>=2&&text[j-2]==="\\"&&text[j-1]==="n") j-=2;
    else break; } return j; }
/* HOW A UNIT'S FORM IS MATCHED AGAINST THE LINE, and the one place the two may legitimately be spelt
   differently: the DAṆḌA. These walks are handed whichever string the caller is painting — the RESTING
   line is dandaDisp(text), where `||` and `//` have each been collapsed to the single character `‖` (and
   `/` to `|`), while the line being EDITED is the raw text. A form column spelling that mark `||` therefore
   matches the raw line and NOT the resting one, so the whole sentence failed stage 1, the bridge was asked,
   and its "no" raised the tokenisation-mismatch badge — on a file that agrees with itself perfectly, and
   which no amount of re-parsing could fix, since the tokeniser reproduces the same two characters.
   ⚠ AND IT RUNS BOTH WAYS, WHICH THE FIRST CUT OF THIS DID NOT. Widening the form only as far as
   dandaDisp(form) covers a form spelt `||` against a resting line, because the display is what the form
   collapses TO — but not a form spelt `‖` against the line being EDITED, because there the form is already
   the collapsed glyph and the LINE holds the two characters. samples/brihat_jataka.conllu carries both
   spellings (its first two verses write `‖` in the form column, its last two `||`), so half its sentences
   raised the badge the moment the caret entered the running-sentence field and the other half never did —
   measured, and exactly the reported "entering the input field gives a divergence warning". So a form is
   tried against EVERY surface the app admits for the mark it spells (dandaSurfaces, beside dandaSpell:
   one statement of which spellings are the same daṇḍa, shared with the write-back that re-spells one).
   Strictly a WIDENING — a unit that matched before still matches first, and by its own spelling — and the
   span is measured in whichever string was matched, so the offsets stay offsets into the line the caller
   handed us. Sanskrit-only (dandaSurfaces answers null elsewhere, dandaDisp is a no-op there), so no other
   language pays for this or can be affected by it. */
function stxFormSurfaces(form){                                           // every admissible spelling of `form`, its OWN first
  const out=[form];
  const d=(typeof dandaDisp==="function")?dandaDisp(form):form;           // kept: dandaDisp also collapses a `/` INSIDE a longer form, which is not a whole-form daṇḍa and so is not in the set below
  if(d!==form) out.push(d);
  const alt=(typeof dandaSurfaces==="function")?dandaSurfaces(form):null;
  if(alt) for(const a of alt) if(out.indexOf(a)<0) out.push(a);
  return out; }
function _stxMatchAt(text,form,j){                                        // → the matched length at j, or 0
  if(text.lastIndexOf(form,j)===j) return form.length;                    // lastIndexOf(…,j)===j is startsWith-at-j without allocating
  const alts=stxFormSurfaces(form);
  for(let i=1;i<alts.length;i++) if(text.lastIndexOf(alts[i],j)===j) return alts[i].length;
  return 0; }
function alignUnitsToText(text,units){ if(!text||!units.length) return null;
  const skip=j=>_stxSkipF(text,j);
  let pos=0; const spans=[];
  for(const u of units){ if(!u.form) return null;                        // a formless unit can't be located → the whole walk is unverified
    const j=skip(pos);
    const w=_stxMatchAt(text,u.form,j);                                  // the FORM, and nothing else — see sentUnits on why a CorrectForm is not an admissible surface here
    if(!w) return null;
    spans.push([j,j+w]); pos=j+w; }
  if(skip(pos)<text.length) return null;                                 // text left over past the last token → the two disagree; say so rather than decorate a prefix
  return spans; }
/* THE WALK AROUND ONE UNIT — the same proof, with a hole in it where the edit is.
   A form edit is written back to `# text` AFTER the model has already changed (afterFormEdit is called
   with the new form in place), so the plain walk above fails at exactly the unit we mean to replace and
   would refuse the whole line. But one keystroke changes ONE unit and leaves every other verbatim: walk
   forward from the start through units 0…k−1, backward from the end through units n−1…k+1, and whatever
   lies between the two walks IS unit k's old span. Nothing is guessed — every other unit is still matched
   literally, and the residue is bounded on both sides by a match — so this is as exact as alignUnitsToText
   and fails the same way (null) the moment any other unit has stopped spelling itself.
   Deliberately NOT used for a hole that is pure whitespace: an old surface of zero length has no located
   position between two units at all (before the space? after it?), and inventing one would put the new
   word on the wrong side of the gap. */
function alignUnitsAround(text,units,k){ if(!text||!units.length||k<0||k>=units.length) return null;
  const spans=new Array(units.length);
  let pos=0;
  for(let i=0;i<k;i++){ const u=units[i]; if(!u.form) return null;
    const j=_stxSkipF(text,pos); const w=_stxMatchAt(text,u.form,j); if(!w) return null;   // daṇḍa-tolerant, exactly as the plain walk above — see _stxMatchAt
    spans[i]=[j,j+w]; pos=j+w; }
  let end=text.length;
  for(let i=units.length-1;i>k;i--){ const u=units[i]; if(!u.form) return null;
    const j=_stxSkipB(text,end);
    /* the BACKWARD walk has to know the length before it knows the start, so it tries each admissible
       spelling's own length rather than assuming the form's — the same widening, read right to left. */
    let st=-1,w=0;
    for(const f of stxFormSurfaces(u.form)){
      const c=j-f.length; if(c>=pos&&text.lastIndexOf(f,c)===c){ st=c; w=f.length; break; } }
    if(st<0) return null;
    spans[i]=[st,st+w]; end=st; }
  const lo=_stxSkipF(text,pos), hi=_stxSkipB(text,end);
  if(hi<=lo) return null;                                                // nothing but whitespace where unit k should be → see above
  spans[k]=[lo,hi];
  return spans; }
// The cache + in-flight guard for the ONE bridge call stages 2 and 3 share. Keyed on the exact
// (text, forms) pair the answer was computed for, so any edit to either invalidates it;
// a `null` entry records a settled failure so a sentence that cannot align is asked about once,
// not on every render.
// A MAP of key → spans, not a single slot, because one sentence is legitimately aligned against TWO
// strings at once: the RESTING line is painted from dandaDisp(text) and the line being EDITED from the
// raw text, and in Sanskrit those differ (// → ‖ collapses two characters into one, so the offsets are
// not interchangeable). With a single slot the two keys evicted each other and every focus/blur spent a
// fresh bridge call. Capped, since each edit to `# text` mints a new key.
const _TSP_INFLIGHT=new Set(), _TSP_MAX=4;
function tspKey(text,units){ return text+"\u0000"+units.map(u=>u.form).join("\u0001"); }
function requestTokenSpans(si,key,text,units,s){
  if(!tspEligible()) return;                                             // see tspEligible: no bridge, or no stage that could answer here
  const tag=si+"\u0000"+key; if(_TSP_INFLIGHT.has(tag)) return; _TSP_INFLIGHT.add(tag);
  /* ⚠ A UNIT'S SPAN NEVER INCLUDES THE WHITESPACE AROUND IT, and stages 2/3 can hand back one that does.
     They locate a unit by its FORM, so a form the line does not spell — the moment the annotator types a
     clitic seam into it, `śaśabhṛto` becoming `śaśa=bhṛto` — comes back one character longer than the word
     it was matched against, and that extra character is the SPACE after it. Everything downstream then
     reads the gap between two units as `text.slice(spans[n][1], spans[n+1][0])` and gets "", so the two
     words are drawn welded: measured on the real sentence, span [22,31] became [22,32] and the CSL row
     lost the separator between `śaśa=bhṛto` and `vartm'` while `# text` stayed perfectly intact — which is
     why the file never showed it and why this took so long to corner.
     Trimmed here, where the bridge's answer ENTERS, so every consumer is covered by one rule rather than
     each having to distrust its own spans. WHITESPACE ONLY: a span that overlaps its neighbour by a LETTER
     is the legitimate vowel-coalescence overlap paintStext's order guard already allows, and must survive
     untouched. A span left empty by the trim becomes a hole, which is already a "we don't know". */
  const trimSpans=sp=>Array.isArray(sp)?sp.map(x=>{ if(!x) return x; let a=x[0], b=x[1];
    while(b>a && /\s/.test(text[b-1])) b--;
    while(a<b && /\s/.test(text[a])) a++;
    return b>a?[a,b]:null; }):sp;
  const done=spans=>{ _TSP_INFLIGHT.delete(tag); const st=DOC[si]; if(!st) return;
    if(!st._tsp||Object.keys(st._tsp).length>=_TSP_MAX) st._tsp={};   // cap: an edited sentence mints a new key each time, and a stale key can never be asked for again
    st._tsp[key]=trimSpans(spans);
    repaintStext(si);
    /* …AND THE ROWS DERIVED FROM THOSE SPANS, which repaintStext does not touch. runningLine takes the
       gap between two units from `# text` when spans exist and falls back to SpaceAfter when they do
       not — and SpaceAfter cannot express a VERSE LINE BREAK. So a sentence whose spans arrive late
       draws its CSL (or script) line with plain spaces and no breaks, and keeps them until some
       unrelated render happens to rebuild the block: the "the linebreaks only appear once I flip to a
       different transliteration" shape, where flipping is simply the first thing that re-renders.
       Only on a real answer — a settled failure leaves those rows exactly as they already are, since
       the fallback is what they are already showing. scheduleDoc is rAF-debounced (js/ui/wiring.js),
       so a document whose sentences all answer at once costs ONE render, not one per sentence. */
    if(spans && typeof scheduleDoc==="function") scheduleDoc(); };                                               // decorate LATE rather than block the first render — the same shape as the readings flyout's late-arriving data. Repaint on FAILURE too (it used to return early): a settled "no" is what raises the tokenisation-mismatch badge, and without this repaint the badge waited for some unrelated render to put it up. Cannot loop — the key is now cached, so the next paint reads the answer instead of asking again
  Promise.resolve(window.pywebview.api.token_spans(text,units.map(u=>u.form),model||"",unitParts(s,units),DOCLANG||""))   // parts + language are stage 2's; stage 3 ignores both
    .then(r=>{ const sp=(r&&Array.isArray(r.spans)&&r.spans.length===units.length&&r.spans.some(Boolean))?r.spans:null; done(sp); })
    .catch(()=>done(null)); }
// Can stages 2/3 answer for this document at all? Stage 3 needs a model, stage 2 is Sanskrit-only, and both
// need the bridge — so in any other language an unaligned sentence stays a local decision, exactly as before,
// and no bridge call is spent finding that out.
function tspEligible(){ return hasBridge() && (!!model || isSanskritLang()); }
/* The alignment STATE of a sentence's running text, and the spans when there are any:
     "ok"      — every unit located; decorate.
     "pending" — an answer may still be coming (a bridge call is out), or there is no bridge at all and we
                 therefore cannot know. Either way: say nothing.
     "bad"     — SETTLED. The text cannot be segmented into this sentence's tokens, and no further stage can
                 change that. This is what raises the tokenisation-mismatch badge.
   The three-way answer exists so the badge can tell "the file disagrees with itself" apart from "the tokeniser
   has not replied yet". Collapsing them would flash a warning on every Sanskrit sentence on first paint, before
   stage 2 has had a chance to align it — and a warning that cries wolf is worse than no warning.
   NO BRIDGE ⇒ "pending", NOT "bad": in a browser/design-mode run stage 1 is all that ever runs, so a Sanskrit
   sentence fails it for a wholly innocent reason (external sandhi). Accusing the file there would be a lie. */
function stextAlign(s,si,text){ const units=sentUnits(s);
  if(!units.length) return {state:"ok"};                                          // no tokens → nothing for the line to disagree with
  const direct=alignUnitsToText(text,units); if(direct){ stxSettled(s,text,units,direct); return {state:"ok",units,spans:direct}; }
  const key=tspKey(text,units);
  if(s._tsp&&Object.prototype.hasOwnProperty.call(s._tsp,key)){
    if(!s._tsp[key]) return {state:"bad"};                                        // the bridge has answered, and the answer was no
    stxSettled(s,text,units,s._tsp[key]); return {state:"ok",units,spans:s._tsp[key]}; }
  if(!hasBridge()) return {state:"pending"};                                      // cannot know (see above)
  if(!tspEligible()) return {state:"bad"};                                        // bridge present, but no stage applies here → stage 1's failure IS the final answer
  requestTokenSpans(si,key,text,units,s); return {state:"pending"}; }
// The spans to decorate with, or null — the same walk, asked only for its result.
function stextSpans(s,si,text){ const a=stextAlign(s,si,text); return a.spans?{units:a.units,spans:a.spans}:null; }

/* ═══ WRITING THE RUNNING SENTENCE BACK ═══════════════════════════════════════════════════════════
   Everything above READS `# text`. This half writes it: editing a token's Form and leaving the running
   sentence spelling the old word is the file disagreeing with itself — precisely the state the
   tokenisation-mismatch badge exists to complain about — so a form edit splices its own stretch of the
   line and the two stay in step.
   THE ALL-OR-NOTHING RULE IS THE SAME, and here it matters more, not less: where the walk cannot locate
   a unit we write NOTHING. A decoration on the wrong span is a lie about the annotation; a SPLICE at the
   wrong offset corrupts the file. So "pending" and "bad" both mean leave `# text` strictly alone.
   WHICH EDITS REACH THE TEXT (the whole rule, in one place — the entry points in js/io/bridge.js only
   route to it):
     · an ordinary token          → always. The text holds its form and nothing else does.
     · a COMPONENT of an MWT      → not outside Sanskrit. `# text` holds the range's contraction ("du",
                                    "للمدرسة"), so a component edit says nothing about what is written there.
     · an MWT's own SURFACE form  → outside Sanskrit, yes: that IS the string the text holds.
     · SANSKRIT INVERTS THOSE TWO. There the surface form is DERIVED — sandhiMwtForms re-fuses it from the
       components on every component edit — so a hand-edited surface form would be overwritten by the next
       re-fusion anyway, and the components are the only authority. The component edit is the real edit and
       is the one that must reach the text. */
/* THE WRITE-BACK MEMO — the alignment as it stood BEFORE the edit.
   Recorded by stextAlign on every walk that SETTLED, and read only by stxWriteSpans. It is what makes a
   Sanskrit line writable at all: there stage 1 never applies (external sandhi means no component form is
   a substring of the text), the spans come from the bridge, and the bridge's cache is keyed on the FORMS —
   so the moment the edit lands the key misses and the answer is "pending" again. The last settled walk
   still describes the string on disk, and that is exactly the answer we need.
   ALWAYS IN RAW `# text` OFFSETS — and getting that wrong is what made the whole Sanskrit half of this
   feature dead on arrival. The resting line is painted from dandaDisp(text), so at rest that is the string
   the walk settles against; this used to refuse to remember anything that was not `s.text` itself, and since
   stage 1 never settles for Sanskrit, the ONLY way a Sanskrit sentence ever got a memo was for the user to
   click INTO the running-sentence line (the editing repaint aligns the raw text). In ordinary use it never
   had one, stxWriteSpans always fell through to null, and every Sanskrit form edit declined in silence.
   The refusal was justified by dandaDisp being a mere `/`→`|` recolouring; it is not. `||` and `//` collapse
   to a single `‖`, so the display is SHORTER than the text — every verse in samples/brihat_jataka.conllu
   ends `||`, so all four of its sentences differ, by one character each. Refusing on inequality therefore
   refused everything, not just the `/` files.
   So a display-string alignment is now ACCEPTED and its spans MAPPED BACK through dandaScan's index map,
   which is exact by construction (one map entry per display code unit, and one past the end so a span's
   exclusive end maps too). Anything else — a string that is neither the text nor its own daṇḍa display — is
   still refused, because then we genuinely do not know what the offsets are offsets into. */
/* WHAT THE MEMO IS COMPARED ON, and why it is emphatically NOT the units' own forms.
   A unit's form is, for an MWT range, the STORED surface form m.form — and in Sanskrit that value is DERIVED:
   every component edit ends with sandhiMwtForms re-fusing it from the components, on a bridge call nobody
   awaits. A memo keyed on unit forms was therefore invalidated by its own side effect. Edit one component and
   the write-back lands; that edit's trailing re-fusion then rewrites m.form; the NEXT edit — to any other
   unit — compares the memo against the sentence, finds the MWT unit "changed" at an index that is not the one
   being edited, and refuses. The symptom is the nastiest kind there is: the first edit works and every one
   after it is declined in silence.
   The signature is the units' COMPONENT forms instead, plus the token ids they cover — exactly the things a
   person edits and a re-tokenisation moves. That is the more honest test on its own terms, too: what
   invalidates a span is the TEXT moving under it (which memo.text already checks) or the sentence being
   re-tokenised, never a derived value that appears nowhere in the line. */
function stxSig(s,units){ const t=(s&&s.tokens)||[];
  return units.map(u=>u.ids.join(",")+"\u0001"+u.ids.map(id=>(t[id-1]&&t[id-1].form)||"").join("\u0001")); }
function stxSettled(s,text,units,spans){ if(!s||typeof s.text!=="string") return;
  let sp=spans;
  if(text!==s.text){ const d=dandaScan(s.text);
    if(!d||d.disp!==text) return;
    sp=spans.map(x=>x?[d.map[x[0]],d.map[x[1]]]:null); }
  s._stxWB={text:s.text,sig:stxSig(s,units),spans:sp};
  learnDanda(s); learnMwtSeps(s,units,sp,s.text); }
function stxRemember(s,units,spans){ if(!s||!spans) return; s._stxWB={text:s.text,sig:stxSig(s,units),spans}; }
// …and carry the memo ACROSS the splice we just made, so the NEXT keystroke can write back too. Without
// this a Sanskrit edit landed exactly once and then went quiet until some later render happened to spend a
// bridge call re-aligning the rewritten line. Spans wholly before the cut keep their offsets, spans wholly
// after it shift by the length delta, and anything overlapping it is dropped (null) for the caller to refill
// from what it actually wrote.
function stxShiftSpans(spans,a,b,replLen){ const d=replLen-(b-a);
  return spans.map(sp=> !sp ? null : (sp[1]<=a ? sp : (sp[0]>=b ? [sp[0]+d,sp[1]+d] : null))); }
/* THE SPANS TO SPLICE AT, or null. Three answers, each a proof rather than a heuristic and tried in this
   order: the plain walk (the text already spells the new form — a second keystroke on a stretch we have
   already rewritten, or a `# text` the user edited to match); the walk AROUND unit k (the ordinary case —
   one unit has moved on, every other still spells itself); and the memo (the only answer where stage 1
   never applied at all). The memo is accepted ONLY when it describes this exact string and differs from the
   sentence as it stands in no unit but k — anything else and it is a description of a different sentence. */
function stxWriteSpans(s,k){ if(!s||typeof s.text!=="string"||!s.text) return null;
  const units=sentUnits(s), text=s.text; if(k<0||k>=units.length) return null;
  let spans=alignUnitsToText(text,units)||alignUnitsAround(text,units,k);
  if(!spans){ const memo=s._stxWB, sig=stxSig(s,units);
    if(!memo||memo.text!==text||!memo.spans||!memo.sig||memo.sig.length!==sig.length) return null;
    for(let i=0;i<sig.length;i++) if(i!==k&&memo.sig[i]!==sig[i]) return null;   // …every unit but the one being edited must still be the unit the memo described (see stxSig)
    spans=memo.spans; }
  if(!spans[k]) return null;                                                      // stage 2/3 can answer with holes; a hole is a "we don't know", and we do not write into one
  learnDanda(s); learnMwtSeps(s,units,spans,text);
  return {units,spans,text}; }
/* WHICH SEPARATOR THIS COMPOUND IS WRITTEN WITH, remembered per MWT.
   An orthographic word is written SOLID — that is what makes it one word, and it is what the parser's own
   ranges are: `vartmāpunarjanmanām`, not `vartmā-punar-janmanām`. So the default is no separator at all.
   But an edition may still spell a samāsa's members apart with a hyphen or a pipe as a reading aid, and
   regenerating a stretch has to give it back in the annotator's own convention rather than in whichever one
   we happen to prefer. So the mark is read off the text the first time the unit is located, and kept.
   COMPOUND-INTERNAL ONLY, which is what tells the two `|`s of a Sanskrit line apart: a bare `|` between two
   words is a verse daṇḍa (and a PUNCT token of its own, hence a unit of its own), so a mark counts only
   INSIDE one MWT's own span with no whitespace on either side of it — `śaśa-bhṛto` yes, `… janmanām |
   ātm" êty …` no.
   NOT ANNOTATION, AND NOT WRITTEN TO THE FILE: io_conllu serialises an MWT from its `_cols`/`form` and
   ignores every other key (as it already does for the cached display forms m.ortho/m.miast), so this rides
   along in memory only and an untouched document still saves byte-identical. It is re-derived from the text
   on the next open, which is why it is only ever read from a FIRST sighting — once the app has rewritten the
   stretch the text spells our own separator back at us, and re-reading it would only confirm itself. */
const MWT_SEPS="-|";
function mwtSepIn(slice){ for(let i=1;i<slice.length-1;i++){ const c=slice[i];
    if(MWT_SEPS.indexOf(c)<0) continue;
    if(_STX_WS.test(slice[i-1])||_STX_WS.test(slice[i+1])) continue;              // whitespace beside it ⇒ a word separator or a daṇḍa, not a compound seam
    return c; }
  return ""; }
function mwtSepOf(m){ return (m&&m.sep)||""; }                                    // no separator unless the line itself showed one: an orthographic word is written solid, which is the whole reason it is ONE multi-word token. (It defaulted to the hyphen while `# text` was in CSL notation, where every compound member carried one.)
function learnMwtSeps(s,units,spans,text){ const mwt=(s&&s.mwt)||[]; if(!mwt.length) return;
  units.forEach((u,i)=>{ if(!u.mwt||!spans[i]) return;
    const m=mwt.find(x=>x.from===u.ids[0]); if(!m||m.sep) return;                 // first sighting only (see above)
    const c=mwtSepIn(text.slice(spans[i][0],spans[i][1])); if(c) m.sep=c; }); }
/* Replace [a,b) of `# text`; true when that actually changed something (a no-op splice must not mark the
   document dirty). The display LINE BREAKS survive by construction: s.text carries them as real newlines
   (normSents restores them on load, getDocJSON re-escapes them on save) and a unit's span covers a surface,
   never the whitespace between two — so a splice inside one cannot reach a break. s.orthoLine is the whole
   sentence fused and scripted FROM s.text (js/lang/translit-load.js), so it is stale the moment the text
   moves; cleared here on the same terms applySentText clears it. */
function spliceStext(s,a,b,repl){ const t=(s&&s.text)||"";
  if(a==null||b==null||a<0||b<a||b>t.length) return false;
  const next=t.slice(0,a)+repl+t.slice(b);
  if(next===t) return false;
  s.text=next; s.orthoLine="";
  return true; }

/* ═══ THE DECORATIONS ═════════════════════════════════════════════════════════════════════════════
   Three annotations the diagram already draws, now on the running sentence too:
   · FOREIGN (Foreign=Yes) — italics, and italics ALONE, matching italDeco's deliberate no-underline.
     The italics SURVIVE FOCUS: see "THE TWO STATES" below.
   · TYPO (Typo=Yes + MISC CorrectForm) — the two spellings SWAP with the editing state, which is the
     whole point of the treatment; see "THE TWO STATES".
   · REPORTED SPEECH (Reported=Yes) — marks a whole SUBTREE, which in a non-projective tree is NOT a
     contiguous stretch of the sentence. We draw a pair of raised CORNER MARKS around each maximal
     CONTIGUOUS RUN of reported units, so a discontiguous report reads as the several stretches it
     actually is rather than sweeping in the interloper that sits between them (the membership/hull
     distinction subtreeMembers is written around — see js/diagram/diagram-core.js): TWO bracketed
     stretches, each closed and reopened, not one bracket with a hole in it. Nesting is cumulative as
     on the diagram — an inner report opens its own pair inside its parent's, so depth is legible as
     ⸢⸢…⸣⸣ rather than as a shade of tint you have to compare against its neighbour.

   ── THE TWO STATES, AND WHY THE RESTING LINE IS NOT LITERALLY `# text` ─────────────────────────────
   `.stext` is contenteditable and what it commits is `el.textContent`, so anything that changes
   textContent changes what the file would be given. Exactly ONE such change is deliberate, and it is
   the typo substitution:
     · AT REST the line shows the CORRECTED spelling (MISC CorrectForm) in place of the typo, dotted-
       underlined in the accent colour, with the FILE'S OWN spelling above it, struck through and
       muted. You read the sentence as it was meant, and can see at a glance what the file records.
     · WHILE EDITING (the element focused) the line shows the file's own spelling — the typo, struck
       through — with the CORRECTION above it in the accent colour. So the two marks simply trade
       places, and the rule "the line holds what a commit would write" is true whenever a commit is
       possible at all: the substitution exists only in the state where no commit can happen, because
       focus repaints before the first keystroke and blur repaints after the last.
     · A commit therefore never sees the correction. commitSentText is reached only from the blur
       handler, and the element it reads was repainted in EDITING mode when it took focus.
   Everything else a paint adds is element wrappers around ordinary text nodes (italics, the strike,
   the reported spans) and out-of-flow pseudo-content (the above-the-line mark, the corner marks) —
   neither shows up in textContent, so both states are safe to leave in place while the caret moves
   through the line, and Foreign italics no longer blink off the moment you click into the sentence.
   The wrappers being ordinary elements around ordinary text nodes is also what find.js's highlighter
   asks for in return (see its markInEl contract). */
function stxUnitDeco(s,units,spans,disp){
  const t=s.tokens||[], rd=reportDepths({tokens:t});
  const gwHead=new Set(); t.forEach(x=>{ if(x.deprel==="goeswith"){ const h=parseInt(x.head,10); if(h>=1) gwHead.add(h); } });   // formDeco reads t._gw, which only the DISPLAY transform sets; the running sentence works off raw tokens, so derive the same "is this a goeswith head" test directly
  return units.map((u,i)=>{ const sp=spans[i]; if(!sp) return null;
    const tks=u.ids.map(id=>t[id-1]).filter(Boolean), shown=disp.slice(sp[0],sp[1]);
    // Foreign on ANY component: a surface unit whose parts are foreign is a foreign word, and the
    // unit is one string in the text — there is no way to italicise only part of a clitic cluster.
    const ital=tks.some(isForeign);
    let cf="",strike=false;
    u.ids.forEach(id=>{ const tk=t[id-1]; if(!tk||gwHead.has(id)) return;   // A GOESWITH HEAD IS SKIPPED WHOLE, not just for the strike. Its Typo=Yes marks the stray SPACE and its CorrectForm is the two halves joined — a statement about the SPLIT, which the diagram already makes by folding the halves under one slur. Gating only the strike (as this did) still let the correction float above the word, so the suppression was half-applied and "together" hovered over "to" for no reason a reader could follow
      if(!cf) cf=correctFormOf(tk);
      if(hasFeat(tk.feats,"Typo","Yes")) strike=true; });
    // A correction that corrects nothing says nothing: CorrectForm === the unit's own form leaves every
    // state on screen identical to every other, so drop the whole treatment rather than draw a strike and
    // a mark that agree. (`shown` is the aligned slice of the running text, which the walk has already
    // proved equal to u.form — comparing against it too costs nothing and documents that equality.)
    if(cf&&cf===shown&&cf===u.form){ cf=""; strike=false; }
    const rep=u.ids.reduce((a,id)=>Math.max(a,rd[id-1]||0),0);
    // `one` gates the resting-state SUBSTITUTION. A CorrectForm is the correct spelling of ONE TOKEN,
    // whereas a multi-token unit is an MWT range whose surface form in `# text` is the contraction of
    // all its members ("du" for de+le) — putting one member's correction in place of the whole
    // contraction would be a worse lie than the typo. Such a unit keeps the pre-existing treatment
    // (struck through, correction above) in BOTH states.
    return (ital||cf||strike||rep)?{ital,cf,strike,rep,ids:u.ids}:null; }); }   // `ids` rides along so the painted span can name the tokens it covers — that is what lets a prompt anchor under the WORD in the line (see askCorrectForms)   // `form`/`one` are gone with the substitution they gated: the line now always shows `# text`, so what is struck is whatever the walk matched there
/* WHY AN ABSOLUTELY-POSITIONED ::before AND NOT <ruby>, for the ABOVE-THE-LINE spelling (whichever of
   the two it currently is). Three constraints decide it, and ruby fails all three. (a) The mark must
   NEVER survive into the committed text: .stext is edited in place and commitSentText reads
   el.textContent — an <rt>'s text IS in textContent, so a ruby would commit "certancertain".
   attr()-fed pseudo-element content is not in textContent at all.
   (b) The sentence's own baseline must not move when a typo is present: a ruby annotation is IN
   FLOW and grows the line box, shoving every block's first line down the moment a typo appears; an
   absolutely-positioned box is out of flow and provably cannot (measured — see the verification).
   (c) .stext is contenteditable, and ruby internals are editable content the caret can enter and
   the user can garble; a pseudo-element cannot receive a caret.
   And nothing is lost to find: the mark is the spelling that is NOT on the line, and at rest that is
   the one the file holds — but `# text` is searched from the MODEL (the "Sentence text" field reads
   s.text, which the substitution never touches), so a search for the typo still FINDS the sentence;
   what it cannot do is paint a <mark> over the substituted word, which would be painting over a word
   that is not the match. CorrectForm's own find field is TOKEN-scoped and highlights the token's grid
   row / diagram group (.findtok), never through markInEl. Whichever spelling IS on the line stays an
   ordinary text node inside the span, so the line remains searchable and highlightable, which is what
   find.js's contract with this renderer actually asks for. */
/* THE INVARIANT, AND IT NO LONGER HAS TWO CASES: the line always holds `# text` exactly as the file spells it,
   struck where that spelling is a typo, with the CorrectForm above it. Editing and resting render the SAME.
   There used to be a resting SUBSTITUTION — the correction on the line, the file's spelling struck above — which
   made sense only while `# text` was thought to sometimes carry the corrected word. It does not: UD defines
   `# text` as the sentence as it was really written, typo and all, so the corrected word is the one that is
   never in the string. Substituting it in meant the line silently disagreed with the file it renders, and the
   rendering changed under the cursor on every focus/blur. Both are gone.
     ON THE LINE   → .stx-typo   (line-through)          … the file's own spelling, the one being rejected
     ABOVE IT      → [data-cf]   (muted)                 … the correction */
function stxUnitEl(d,text){ const e=document.createElement("span");   // no `editing` parameter any more: the two states render identically, which is the point
  e.className="stx-tok"+(d.ital?" stx-frn":"")+(d.strike?" stx-typo":"");   // `strike` and not merely `cf`: on a goeswith head Typo=Yes marks the stray SPACE, not a misspelling of this form, so that unit takes no strike
  if(d.ids&&d.ids.length) e.dataset.ids=d.ids.join(" ");   // e.g. data-ids="4" (or "4 5" for an MWT range) → queried with [data-ids~="4"]
  if(d.cf){ e.dataset.cf=d.cf; e.title="correct form of “"+text+"”: "+d.cf; }
  e.textContent=text; return e; }
/* THE TOKENISATION-MISMATCH BADGE. `# text` is by definition the running sentence the tokens were segmented
   FROM, so a line that can no longer be segmented into them means the file disagrees with itself: the grid, the
   diagram and the file all show one tokenisation and this line shows another. Nothing else says so — the line
   simply loses its decorations quietly — which is exactly the kind of silent divergence worth a mark.
   A SIBLING of the line, never a child: .stext is contenteditable and commitSentText reads el.textContent, so
   anything inside it would be committed into `# text` (the same constraint that ruled out <ruby> for the typo
   mark, see below). Find-or-create, because paintStext runs on every repaint and must stay idempotent.
   ⚠ THE VERY FIRST PAINT RUNS BEFORE THE LINE HAS A PARENT, AND THAT USED TO LOSE THE BADGE SILENTLY.
   wireStext's own paintStext call (buildBlock, above) fires while `el` is still a bare, unattached node — the
   surrounding .shead/.sblock/.docsheet chain is only stitched together and appended to #doc by statements
   AFTER it, later in the same function — so insertAdjacentElement had no sibling slot to land in and this
   function's original one-line guard just gave up. Usually invisible: a bridge round-trip (a parse, a model
   answer) triggers repaintStext once the block is live, which finds the badge missing and adds it. But a
   genuine mismatch needs no bridge to be detected — stextAlign answers `bad` synchronously off text already in
   hand — so a non-Sanskrit document with no model loaded got exactly one paint, on a detached node, and never
   raised the badge at all: reachable, not hypothetical, once the daṇḍa false-positive above stopped being the
   thing masking it in Sanskrit specifically. `_stxRetried` bounds the fix to ONE retry rather than an unbounded
   requeue: a microtask fires only once the current synchronous task fully unwinds, which for this call site is
   always after buildBlock has appended the block (proved by the append being a later statement in the very
   function that is still on the stack when the microtask is queued) — so the retry always finds a parent on a
   normal render. The flag exists only to stop a genuinely orphaned node (rendered, then discarded by another
   render before this task drained) from rescheduling itself forever; it fails silently there, exactly as this
   function always has for a detached element. */
function setStextWarn(el,bad){ if(!el) return;
  if(!el.parentElement){
    if(bad && !el._stxRetried){ el._stxRetried=true; queueMicrotask(()=>setStextWarn(el,bad)); }
    return; }
  let w=el.nextElementSibling; if(w&&!w.classList.contains("stx-warn")) w=null;
  if(!bad){ if(w) w.remove(); return; }
  if(w) return;
  w=document.createElement("span"); w.className="stx-warn"; w.setAttribute("role","img"); w.setAttribute("aria-label","tokenisation mismatch");
  w.innerHTML='<span class="sfi" style="--m:var(--sf-warn)"></span>';
  w.title="This line no longer matches the tokenisation in the grid, the diagram and the file — its words cannot be mapped onto this sentence's tokens, so the annotations are not shown on it.";
  el.insertAdjacentElement("afterend",w); }
/* Paint `disp` into `el` — always as correct plain text FIRST, then decoration on top of it, so a
   failure anywhere below can only ever cost the decoration, never the sentence.
   `editing` selects between the two states described at the top of this section; omitted, it is read
   off the focus, which is what every caller but the focus handler itself wants (the focus handler is
   called BEFORE document.activeElement has moved in some paths, so it passes the flag explicitly).
   Note that `disp` differs between the states — dandaDisp(text) at rest, the raw text while editing —
   so every offset below is an offset into whichever string this call was handed. */
function paintStext(el,si,disp,editing){
  if(editing===undefined) editing=(document.activeElement===el);
  el.textContent=disp;
  const s=DOC[si]; if(!s||!disp) return;
  const A=stextAlign(s,si,disp);
  setStextWarn(el,A.state==="bad");   // the badge rides on the SAME walk that decides the decorations — one answer, two consumers, so the two can never disagree about whether this line aligns
  if(!A.spans) return;
  const spans=A.spans.slice();
  /* ORDER GUARD: a decoration drawn over a span that runs BACKWARDS from its neighbour is drawn over the
     wrong words, so drop rather than trust. A span that starts ONE CHARACTER before the previous one ended
     is allowed through, because that is not disorder but a fact about sandhi: a tokeniser that publishes
     source spans reports a vowel COALESCENCE as an overlap, the fused vowel of `vartmā` + `apunar-` being
     genuinely the last character of one word and the first of the next. Refusing it would cost the second
     word its decoration at every coalescence in the text, and the alternative — a hole on one side — is
     less true than letting both claim the character they share. Anything further back is still dropped. */
  for(let i=0,last=0;i<spans.length;i++){ const sp=spans[i];
    if(!sp||!(sp[0]>=last-1)||!(sp[1]>sp[0])||sp[1]>disp.length){ spans[i]=null; continue; } last=sp[1]; }
  /* A GOESWITH SEAM IS SET THIN. The unit is ONE word a stray space broke in two, so at rest the running
     sentence draws that space as U+2009 THIN SPACE: the halves read as the word they are, the slur in the
     diagram gets a typographic echo in the line, and the character is still a character — it can be selected
     and deleted like any other.
     TWO PROPERTIES MAKE THIS SAFE, and it would be unsafe without either. It is LENGTH-PRESERVING (one space
     for one space), so every span computed above stays valid and nothing has to be re-aligned. And it applies
     only AT REST: focusing the line repaints it from the raw text (see "THE TWO STATES"), so the string
     commitSentText reads back is never the substituted one and `# text` cannot pick up a thin space. */
  if(!editing){ let sub=null;
    for(let i=1;i<spans.length;i++){ const a=spans[i-1], b=spans[i]; if(!a||!b||b[0]-a[1]!==1) continue;
      const ids=A.units[i].ids, tk=(ids&&ids.length===1)?s.tokens[ids[0]-1]:null;   // a goeswith CONTINUATION is one token, never an MWT range
      if(!tk||!isGoesWith(tk.deprel)) continue;
      if(disp[a[1]]!==" ") continue;                    // already thin, or something other than a plain space sits there → leave it alone
      (sub||(sub=[])).push(a[1]); }
    if(sub){ const ch=disp.split(""); sub.forEach(k=>{ ch[k]="\u2009"; /* U+2009 THIN SPACE, written as an ESCAPE: a literal one in the source is indistinguishable from an ordinary space at a glance */ }); disp=ch.join(""); el.textContent=disp; } }
  const deco=stxUnitDeco(s,A.units,spans,disp);
  if(!deco.some(Boolean)) return;                      // nothing annotated in this sentence → leave the plain text node alone (fewer elements for find.js to walk)
  // per-character reported depth, with the gap BETWEEN two same-depth units filled in so one run
  // takes ONE pair of corner marks rather than a pair per word
  const dep=new Array(disp.length).fill(0);
  spans.forEach((sp,i)=>{ const d=deco[i]; if(!sp||!d||!d.rep) return; for(let c=sp[0];c<sp[1];c++) dep[c]=d.rep; });
  for(let i=1;i<spans.length;i++){ const p=spans[i-1],q=spans[i],a=deco[i-1],b=deco[i];
    if(!p||!q||!a||!b||!a.rep||!b.rep) continue; const m=Math.min(a.rep,b.rep);   // the MIN of the two depths, not "the two are equal": the space between a depth-1 word and the depth-2 word that opens a report inside it is still inside the OUTER report, and giving it depth 0 closed and reopened that outer wrapper — which drew the nested case as two sibling runs (⸢she knew⸣ ⸢⸢that it rained today⸣⸣) instead of one nesting inside the other. Equal depths are the m===a.rep===b.rep case and behave exactly as before
    for(let c=p[1];c<q[0];c++) dep[c]=m; }
  // Emit, opening/closing a .stx-rep wrapper as the depth rises and falls (a depth stack, so a report
  // inside a report nests rather than replacing its parent). ONE .stx-rep per maximal contiguous run
  // per level is exactly what carries the corner marks: app.css hangs the opening mark on its ::before
  // and the closing one on its ::after, so a discontiguous report — which reaches depth 0 between its
  // stretches and therefore closes and reopens the wrapper — draws a CLOSED PAIR around each stretch,
  // and a nested report draws its own pair inside its parent's.
  const out=document.createDocumentFragment(), stack=[out], depths=[0]; let buf="";
  const top=()=>stack[stack.length-1];
  const flush=()=>{ if(buf){ top().appendChild(document.createTextNode(buf)); buf=""; } };
  const setDepth=d=>{ if(d===depths[depths.length-1]) return; flush();
    while(depths.length>1&&depths[depths.length-1]>d){ depths.pop(); stack.pop(); }
    while(depths[depths.length-1]<d){ const sp=document.createElement("span"); sp.className="stx-rep"; sp.dataset.depth=String(Math.min(depths.length,3));
      top().appendChild(sp); stack.push(sp); depths.push(depths[depths.length-1]+1); } };
  const startAt=new Map(); spans.forEach((sp,i)=>{ if(sp&&deco[i]) startAt.set(sp[0],i); });
  for(let c=0;c<disp.length;){ const ui=startAt.get(c);
    setDepth(dep[c]);
    if(ui!=null){ const d=deco[ui], txt=disp.slice(spans[ui][0],spans[ui][1]);
      if(d.ital||d.strike||d.cf){ flush(); top().appendChild(stxUnitEl(d,txt)); } else buf+=txt;
      c=spans[ui][1]; continue; }
    buf+=disp[c]; c++; }
  flush();
  el.textContent=""; el.appendChild(out);
  if(el.isConnected) stxWrapRoom(el); }   // the above-the-line mark needs room only where the word it hangs off has a LINE above it inside this very line box — measurable only once the paint is in the document, which it is on every repaint but NOT during renderDoc's first pass (the block is still detached there; renderDoc runs the same pass over the whole document after layout)
/* ROOM FOR AN ABOVE-THE-LINE MARK ON A WRAPPED LINE — PER VISUAL LINE, NOT PER BLOCK.
   The mark hangs at bottom:100% of its word. On the FIRST visual line of a sentence that is the gap above
   the sentence, which the block layout already leaves clear — and where the whole point (see the ::before
   note above) is that a typo must not move the baseline the sentence number and ID are aligned to. On the
   SECOND or later visual line of a WRAPPED sentence the mark hangs into the previous line of the SAME
   paragraph, and lands on its descenders. So the room is added exactly there and nowhere else, by class.
   HOW IT GROWS THE LINE, given that CSS has no per-line leading: a zero-width inline-block inside the word
   (app.css's .stx-wrapline::after) is an atomic inline whose baseline — having no in-flow line box of its
   own — is its bottom margin edge, so its whole height stands ABOVE the baseline. The line box it sits in
   grows upward by however much it exceeds the strut's ascent, and downward not at all: the space is added
   over that one line, not around it, and the other lines of the same sentence are untouched.
   Measured with the class OFF, so the pass is idempotent and a line that stops wrapping loses the room. */
function stxWrapRoom(root){ const host=(root&&root.querySelectorAll)?root:document;
  host.querySelectorAll(".stx-tok[data-cf]").forEach(e=>{
    e.classList.remove("stx-wrapline");
    const line=e.closest(".stext,.strans-orig"); if(!line) return;
    const lr=line.getClientRects(), er=e.getClientRects(); if(!lr.length||!er.length) return;   // detached / display:none → nothing to measure, and no class either way
    if(er[0].top>lr[0].top+1) e.classList.add("stx-wrapline"); });   // the word starts below the sentence's FIRST visual line ⇒ it has a line of its own paragraph above it
}
// Stage 2 landed for this sentence → repaint its running-sentence line(s) in place. Not a renderDoc:
// nothing else changed, and a full render mid-edit would be both wasteful and disruptive.
function repaintStext(si){ const b=document.querySelector(`.sblock[data-i="${si}"]`); if(!b) return;
  b.querySelectorAll(".stext[contenteditable],.strans-orig").forEach(el=>{
    const raw=el.dataset.orig; if(raw==null) return;
    if(document.activeElement===el){   // the line being edited is repainted too — an alignment that lands mid-edit is exactly when the Foreign italics would otherwise be missing from the line you are typing in — but in EDITING state (raw text, no substitution) and with the caret put back where it was
      const off=stextSelOffsets(el); paintStext(el,si,raw,true); if(off) setStextSel(el,off.a,off.b); return; }
    paintStext(el,si,dandaDisp(raw)); });
  if(typeof FIND!=="undefined"&&FIND.open) highlightFind(); }   // the repaint replaced the nodes the highlighter had marked
/* item 30: Sanskrit sentence-text field DISPLAY transform (display-only; never rewrites the stored
   s.text). Defocused → // , || → ‖ (U+2016) and a single / → | ; focusing restores the raw editable
   characters. Module-level so the async repaint above can reproduce exactly what the render drew.
   IT IS NOT LENGTH-PRESERVING, and that had to be learned the hard way: `||` and `//` are TWO characters
   collapsing into ONE, so an offset into the display string is not an offset into `# text` — every verse in
   samples/brihat_jataka.conllu ends `||`, so the 240-character `# text` of its first sentence paints as 239.
   The alignment at rest therefore settles against a string the write-back cannot splice into. Hence the
   SCANNER: one pass that emits the display string AND a map from each display code-unit index to the raw
   index it came from (with map[disp.length] = raw.length, so the map reads as an exclusive END offset too).
   dandaDisp is that scanner asked only for its string, and produces byte-for-byte what the two chained
   .replace() calls used to — leftmost-longest at each position, `||`/`//` before a lone `/`. */
function dandaScan(txt){ if(!isSanskritLang()) return null;   // null, not an identity map: outside Sanskrit there IS no transform, and callers use the null to mean "this display string is the raw one"
  const t=String(txt); let disp=""; const map=[];
  for(let i=0;i<t.length;){
    const two=t.substr(i,2);
    if(two==="//"||two==="||"){ map.push(i); disp+="‖"; i+=2; continue; }
    if(t[i]==="/"){ map.push(i); disp+="|"; i++; continue; }
    map.push(i); disp+=t[i]; i++; }
  map.push(t.length);
  return {disp,map}; }
function dandaDisp(txt){ const d=dandaScan(txt); return d?d.disp:String(txt); }
/* WHICH DAṆḌA THIS SENTENCE IS WRITTEN WITH — slashes or pipes — remembered per sentence, exactly as the
   compound separator is remembered per MWT, and for the same reason: the app reads the two as the same mark
   (dandaScan renders either as `|`/`‖`) and so cannot tell you which one the annotator typed.
   READ FROM `# text`, NOT FROM THE TOKENS. The two need not agree and in the sample they do not:
   samples/brihat_jataka.conllu spells its verse-final daṇḍa `‖` in the FORM column while `# text` writes it
   `||`. It is the line's own spelling we have to reproduce when we write back into the line.
   A `|` WEDGED BETWEEN TWO LETTERS IS NOT A DAṆḌA — it is a compound seam (see mwtSepIn), so `ātma|vidām`
   contributes nothing and the free-standing `|` after it decides. `/` needs no such test: it is never a
   compound seam in this notation, so any `/` at all settles it.
   Transient, like m.sep: io_conllu writes an MWT/sentence from its named keys and ignores the rest, so this
   never reaches the file and is re-derived on the next open. */
const DANDA_MARKS="/|";
function dandaSpellIn(text){ const t=String(text||"");
  for(let i=0;i<t.length;i++){ const c=t[i];
    if(DANDA_MARKS.indexOf(c)<0) continue;
    if(c==="/") return "/";
    const prev=i>0?t[i-1]:"", next=i+1<t.length?t[i+1]:"";
    if(!prev||!next||_STX_WS.test(prev)||_STX_WS.test(next)||prev==="|"||next==="|") return "|"; }   // free-standing, doubled, or at an edge ⇒ a verse daṇḍa
  return ""; }
function learnDanda(s){ if(!s||s.danda||!isSanskritLang()||typeof s.text!=="string") return;   // Sanskrit-only: a `|` in an English `# text` is a pipe, not a daṇḍa
  const c=dandaSpellIn(s.text); if(c) s.danda=c; }
/* WHICH SPELLINGS ARE THE SAME MARK — the one place that fact is stated, and both consumers read it here.
   The app already conflates these notations everywhere else (dandaScan renders `//` and `||` alike as `‖`,
   and `/` as `|`), so the set is not a new judgement; it is the existing one, named. Deliberately blind to
   the Devanagari daṇḍa `।`/`॥`: those are what a Devanagari document actually writes, in the text AND in
   the form column, so there is nothing to reconcile there (samples/brihat_jataka_devanagari.conllu agrees
   with itself in both) and admitting them would let a `।` line match a `|` form, which is a real difference. */
const _DANDA2=/^(?:\|\||\/\/|‖)$/, _DANDA1=/^(?:\||\/)$/;   // the two ASCII/CSL notations plus the collapsed display glyph
function dandaSurfaces(form){ if(!isSanskritLang()) return null;   // outside Sanskrit a `|` is a pipe and a `/` a slash — see learnDanda
  if(_DANDA2.test(form)) return ["||","//","‖"];
  if(_DANDA1.test(form)) return ["|","/"];
  return null; }                                                   // not a daṇḍa at all ⇒ it has exactly one spelling
/* …and a daṇḍa token written the way THIS sentence writes them. Inert until the spelling has actually been
   read off the line (no `s.danda` ⇒ the form goes back in exactly as it stands), and deliberately blind to
   the Devanagari daṇḍa `।` for the reason just above. */
function dandaSpell(form,s){ const d=s&&s.danda; if(!d) return form;
  if(_DANDA2.test(form)) return d+d;
  if(_DANDA1.test(form)) return d;
  return form; }

/* ═══ ⌘I OVER A SELECTION IN THE RUNNING SENTENCE ═════════════════════════════════════════════════
   ⌘I already means "mark the selected TOKEN(S) Foreign=Yes" (toggleMarkFeat, js/editing/edit-ops.js).
   Selecting words IN THE SENTENCE LINE is the other way a user points at those tokens, and the
   token↔text alignment above is precisely the machinery that turns one into the other — so the same
   keystroke does the same thing from there, on the tokens the selection covers.

   THE DECISIONS, each of which had a defensible alternative:
   · A PARTIALLY COVERED WORD IS COVERED. The token is the unit the feature lives on; there is no such
     thing as half a Foreign token, and a drag that stops a letter short of a word end is a slip, not
     a statement. So any overlap at all with a unit's span takes that unit — and an MWT range takes
     ALL its component tokens, for the same reason the italics do: `# text` holds the contraction, and
     you cannot mark half of "du".
   · A SELECTION ALREADY WHOLLY FOREIGN CLEARS; ANYTHING ELSE SETS. Verbatim the rule ⌘I already
     follows on a token selection (see toggleMarkFeat's own note): a mixed selection SETS on every
     token, so the keystroke always has one visible, predictable effect and a second press undoes it.
     Deciding it per token instead would leave a mixed selection exactly as mixed as it started.
   · NO ALIGNMENT → NOTHING HAPPENS, AND IT SAYS SO. Without spans no token can be named at all, and
     guessing (nearest word, whole sentence, the selected token) would write the feature somewhere the
     user did not point. The same for a line with uncommitted edits: the spans describe `# text`, not
     the string on screen, so they cannot be trusted to locate anything until Enter has committed.
   · ONE UNDO ENTRY for the whole selection, taken before the first write — as every other bulk marker
     in this app does.
   · IT CLAIMS THE KEYSTROKE ONLY WITH A REAL SELECTION IN A RUNNING-SENTENCE LINE. `# text` is the
     one field where ⌘I would otherwise be swallowed (the doc-level handler in js/grid/columns.js bails
     on contenteditable), and the native Edit-menu item — whose ⌘I key equivalent runs BEFORE the web
     view ever sees the keydown — routes through toggleForeign, which asks us first. A bare caret or a
     focus anywhere else is left alone, so "Mark as Foreign" from a token's context menu still means
     the token. */
// The focused running-sentence line, or null. Both wired lines qualify: the plain `# text` line and,
// in SCRIPT mode, the editable original that moves down into the transliteration slot (.strans-orig).
function stextEditEl(){ const el=document.activeElement;
  if(!el||!el.classList||!el.isContentEditable) return null;
  if(!el.classList.contains("stext")&&!el.classList.contains("strans-orig")) return null;
  const b=el.closest&&el.closest(".sblock"); if(!b) return null;
  const si=+b.dataset.i; return DOC[si]?{el,si}:null; }
// The window selection as [a,b) character offsets into `el`'s own flattened text — computed by
// RANGE ARITHMETIC rather than by adding up node lengths, so it is correct whatever element structure
// the paint happens to have left inside (italic spans, .stx-rep wrappers, a find <mark>).
function stextSelOffsets(el){ const s=window.getSelection(); if(!s||!s.rangeCount) return null;
  const r=s.getRangeAt(0); if(!el.contains(r.startContainer)||!el.contains(r.endContainer)) return null;
  const pre=r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer,r.startOffset);
  const a=pre.toString().length; return {a,b:a+r.toString().length}; }
// …and back: put the selection at [a,b) after a repaint replaced every node it referred to.
function _stextPoint(el,off){ const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let n,last=null,acc=0;
  while((n=w.nextNode())){ if(off<=acc+n.data.length) return {node:n,off:off-acc}; acc+=n.data.length; last=n; }
  return last?{node:last,off:last.data.length}:{node:el,off:0}; }   // past the end (the paint can shorten the line) → clamp to the last character rather than throw
function setStextSel(el,a,b){ try{ const p=_stextPoint(el,a),q=_stextPoint(el,b),r=document.createRange();
    r.setStart(p.node,p.off); r.setEnd(q.node,q.off);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); }catch(_){} }   // a caret is a nicety, never a reason to lose the edit that just landed
/* PUT THE CARET WHERE THE CLICK LANDED, AFTER the focus repaint has replaced every node in the line.
   Clicking a running sentence FOCUSES it, and focus repaints it in the editing state (paintStext's
   `editing` flag) — the resting typo substitution comes off, the file's own spelling comes back, and both
   are new text nodes. The browser's own mousedown caret refers to the nodes that existed a moment before
   and does not survive that, so the caret arrived at the start of the line however far into it you
   clicked. Re-hit-testing the SAME SCREEN POINT against the REBUILT text is what puts it back: it needs
   no offset mapping between the two strings (which differ in length exactly at the substituted word) and
   it answers the question the user actually asked, which was about a place on screen.
   document.caretRangeFromPoint is the hit test — deprecated on paper, and still the only one WebKit and
   Chromium implement; the inline field editor (js/editing/context-menu.js) reaches for it the same way,
   with the same feature guard and the same "no answer → leave the caret alone" fallback. */
/* PUT THE CARET AT A SCREEN POINT — the one implementation, for both kinds of editable this app has.
   It existed three times over in different shapes (the running sentence's own re-hit-test after a repaint, the
   grid's click-into-a-cell, the diagram's field), which is what this collapses.
     · contenteditable / text nodes → document.caretRangeFromPoint, clamped into the element's box.
     · <input>/<textarea>          → caretRangeFromPoint cannot see inside a form control's shadow text at all,
       so the offset is MEASURED: the control's own computed font is laid on a canvas and the click's x is
       matched against successive prefix widths, picking the boundary the point is NEAREST to (not the one it is
       past, which is off by half a character on every click). Horizontal only, which is right for the
       single-line fields this is used on; a wrapped textarea falls back to the end.
   Returns true when it placed a caret, false when it could not — a caret is a nicety, never a reason to throw. */
/* ── THE APP'S ZOOM IS `zoom`, AND THAT SPLITS THE MEASUREMENT APIs IN TWO ─────────────────────────
   `.sblock{zoom:var(--fs)}` (app.css) is how ⌘+/⌘− scales the document, and it is a real scale on the
   USED values, not a transform: a block laid out 714px wide paints 1142px wide at FS=1.6. Which means
   the two families of measurement no longer agree, and mixing them silently multiplies by the zoom:

     · getBoundingClientRect / clientX / deltaY   →  VIEWPORT px (the zoom already applied)
     · offsetTop/Height, clientHeight, scrollTop, getComputedStyle lengths, canvas measureText
                                                  →  the element's OWN px (unzoomed)

   Probed on this Chrome AND on the WKWebView the app actually ships in, which agree: at zoom 1.5 a
   300px-tall box reports rect.height 480 and offsetHeight 320, and getComputedStyle still reports the
   AUTHORED font-size. So an expression that subtracts one family from the other has to convert, and
   this is the conversion factor — `currentCSSZoom` is the resolved product of every ancestor's zoom
   (Chrome 128+/Safari 18+, present in both engines probed), with an ancestor walk as the fallback so
   an older engine degrades to the same number rather than to 1.
   NOT simply `FS`: that is right only for a node inside `.sblock`, and callers here walk arbitrary
   ancestor chains that leave it (#doc itself is never zoomed). */
function cssZoomOf(el){ if(!el||el.nodeType!==1) return 1;
  const z=el.currentCSSZoom; if(typeof z==="number"&&z>0) return z;
  let f=1; for(let n=el;n&&n.nodeType===1;n=n.parentElement){ const v=parseFloat(getComputedStyle(n).zoom); if(v>0&&v!==1) f*=v; }
  return f||1; }
/* ⚠ …AND THE TWO ENGINES DO NOT AGREE ABOUT WHAT `getComputedStyle` REPORTS INSIDE ONE.
   For ordinary HTML the two match and both report the AUTHORED length (probed: a 20px input with
   11px padding inside `zoom:1.6` reads back 20/11 in Chrome and in WebKit alike). For SVG TEXT they
   diverge — the diagram's own glyphs — where WebKit reports the authored size DIVIDED by the zoom
   and Chrome reports it plain: a 14px form row inside FS=1.6 reads 8.75px in the shipping WKWebView
   and 14px in Chrome; at FS=0.6 it reads 23.33px. Multiplying that by FS, as the inline editors did,
   therefore lands exactly back on the AUTHORED size in WebKit — the field opened at 100 % over a
   diagram drawn at 160 %, which is the reported "input fields still show at the original size".

   So the factor is PROBED, not branched on the engine or on the SVG namespace: a hidden element with
   an inline `font-size:100px` is put in the SAME zoom context as `el`, and what comes back says how
   this engine reports a length there. Chrome answers 100 (factor 1); WebKit answers 100/z on SVG
   (factor z). A future engine that does something else in some third context is measured, not
   guessed at. Cached on (namespace, zoom) — every token in a document shares both — and short-
   circuited at zoom 1, which is every document nobody has zoomed. */
function cssLenScale(el){ if(!el||el.nodeType!==1) return 1;
  const z=cssZoomOf(el); if(!(z>0)||Math.abs(z-1)<1e-6) return 1;
  const svg=el.namespaceURI===SVGNS, key=(svg?"s":"h")+z;
  if(cssLenScale._k===key) return cssLenScale._v;
  const host=el.parentNode; let v=1;
  if(host&&host.appendChild){
    const p=svg?document.createElementNS(SVGNS,"text"):document.createElement("span");
    p.setAttribute("style","font-size:100px;position:absolute;visibility:hidden;pointer-events:none");
    try{ host.appendChild(p); const got=parseFloat(getComputedStyle(p).fontSize); if(got>0) v=100/got; }
    catch(_){}
    finally{ if(p.parentNode) p.parentNode.removeChild(p); } }
  cssLenScale._k=key; cssLenScale._v=v; return v; }
// …and the one thing every caller actually wants: the size to draw a floating (un-zoomed, body-level)
// overlay at so it matches the text it covers. authored = computed × cssLenScale; visual = authored × zoom.
function visualFontPx(el){ const cs=getComputedStyle(el);
  return (parseFloat(cs.fontSize)||0)*cssLenScale(el)*cssZoomOf(el); }
function caretAtPoint(el,x,y){ if(!el) return false;
  const tag=el.tagName;
  if(tag==="INPUT"||tag==="TEXTAREA"){
    const v=el.value||""; if(!v){ try{ el.setSelectionRange(0,0); }catch(_){} return true; }
    try{
      const cs=getComputedStyle(el), r=el.getBoundingClientRect();
      const padL=parseFloat(cs.paddingLeft)||0, bordL=parseFloat(cs.borderLeftWidth)||0;
      const rtl=cs.direction==="rtl";
      if(rtl||(tag==="TEXTAREA"&&v.indexOf("\n")>=0)){ el.setSelectionRange(v.length,v.length); return true; }   // RTL and multi-line need a 2-D solve this does not attempt — end of text is the honest fallback
      const cv=caretAtPoint._cv||(caretAtPoint._cv=document.createElement("canvas"));
      const cx=cv.getContext("2d"); cx.font=cs.font||(cs.fontStyle+" "+cs.fontWeight+" "+cs.fontSize+" "+cs.fontFamily);
      /* …CONVERTED INTO THE FIELD'S OWN px before it meets measureText's. `x` and `r.left` are viewport
         px; the padding, the border, scrollLeft and every width `cx.measureText` is about to return are
         the field's own. Left mixed, the click point ran `FS`× too far along the string: measured at
         FS=1.6 a click on boundary 5 of "abcdefghij" placed the caret at 9, and at FS=0.6 at 3. Every
         grid cell control lives inside `.sblock` and so is zoomed; the diagram's floating .nodeedit is
         appended to <body> and is not, where cssZoomOf reports 1 and this is the old expression. */
      const z=cssZoomOf(el);
      const dx=(x-r.left)/z-bordL-padL+(el.scrollLeft||0);
      let best=0, bestD=Math.abs(dx);
      for(let i=1;i<=v.length;i++){ const d=Math.abs(cx.measureText(v.slice(0,i)).width-dx);
        if(d<bestD){ bestD=d; best=i; } }                                   // NEAREST boundary, so a click in the left half of a glyph lands before it
      el.setSelectionRange(best,best); return true;
    }catch(_){ try{ const n=(el.value||"").length; el.setSelectionRange(n,n); }catch(__){} return true; } }
  return stextCaretAtPoint(el,x,y); }
function stextCaretAtPoint(el,x,y){ if(!document.caretRangeFromPoint) return false;
  try{ let rg=document.caretRangeFromPoint(x,y);
    if(!rg||!el.contains(rg.startContainer)){                       // the repaint can SHORTEN the line (the correction is longer than the typo it stood in for), so a click near its end can now be past it → clamp the point into the box and ask again, which lands on the nearest character rather than nowhere
      const r=el.getBoundingClientRect();
      rg=document.caretRangeFromPoint(Math.min(Math.max(x,r.left+1),r.right-1),Math.min(Math.max(y,r.top+1),r.bottom-1));
      if(!rg||!el.contains(rg.startContainer)) return false; }
    rg.collapse(true); const s=window.getSelection(); s.removeAllRanges(); s.addRange(rg); return true;
  }catch(_){ return false; } }   // as everywhere else in this file: a caret is a nicety, never a reason to throw out of a paint
/* MARK, FROM A SELECTION OF WORDS IN THE RUNNING SENTENCE. `apply(tokens, sentence, ids)` does the marking and
   returns the toast to show; everything around it — deciding whether this route claims the keystroke at all,
   turning a character range into token ids, and surviving the re-render — is the same whichever feature is being
   marked, so it lives here once. Returns TRUE when it claimed the keystroke: the caller must not then fall
   through to the token-selection toggle.
   ONE GENERIC ROUTINE AND NOT THREE: this used to exist only for Foreign, so ⌘I worked on a selection of words
   while the Typo and Reported shortcuts silently ignored it and marked whatever token happened to be selected in
   the diagram — the same keystroke meaning two different things depending on which feature it was. */
function stextMarkSel(apply){ const F=stextEditEl(); if(!F) return false;
  const {el,si}=F, s=DOC[si], raw=el.dataset.orig||"";
  const off=stextSelOffsets(el); if(!off||off.b<=off.a) return false;   // a bare caret is not a selection: leave the key to whatever else claims it
  if((el.textContent||"")!==raw){ toast(accel("Press ⏎ to commit the sentence text first — this marks tokens, and the line has uncommitted edits")); return true; }   // accel(): a TOAST is neither a title= nor a .kbd, so the localiseAccel sweep can't reach it
  const A=stextSpans(s,si,raw);   // the line is showing `raw` (it is focused, so it was painted in EDITING state) → align against raw, not against the daṇḍa display
  if(!A){ toast("This sentence's words are not aligned to its text — no token can be identified from a selection here"); return true; }
  const ids=[]; A.spans.forEach((sp,i)=>{ if(!sp||sp[0]>=off.b||sp[1]<=off.a) return;   // half-open overlap: touching at all takes the whole unit
    A.units[i].ids.forEach(id=>{ if(ids.indexOf(id)<0) ids.push(id); }); });
  const toks=ids.map(id=>s.tokens[id-1]).filter(Boolean);
  if(!toks.length){ toast("That selection covers no word of the sentence"); return true; }   // a drag across the space between two words, say
  pushUndo(si);                                                                        // ONE entry, before the first write → undo restores the whole selection at once
  const undoRef=UNDO[UNDO.length-1];   // …and a handle on it, so a follow-up the user CANCELS can take the whole command back out (see revertEdit)
  const r=apply(toks,s,ids,si)||{}, msg=(typeof r==="string")?r:r.msg;                 // apply may return a bare message, or {msg, then} when it has follow-up work that must wait for the re-render
  markDirty();
  // The diagram and the grid draw these features too, so it is a full render — but the line the user is
  // typing in must survive it. Blur FIRST (the text is unchanged, so the blur handler repaints and
  // cannot reach commitSentText), render, then re-focus the rebuilt line and put the selection back.
  const wasTrans=el.classList.contains("strans-orig");
  el.blur(); preserveScroll(renderDoc); if(typeof syncMenu==="function") syncMenu(true);
  const b2=document.querySelector(`.sblock[data-i="${si}"]`),
        el2=b2&&b2.querySelector(wasTrans?".strans-orig":".stext[contenteditable]");
  if(el2){ el2.focus(); setStextSel(el2,off.a,off.b); }
  if(msg) toast(msg);
  if(typeof r==="object"&&typeof r.then==="function") r.then(el2||null,undoRef);   // the REBUILT line is passed through: the follow-up needs an anchor inside it, and this is the only place that knows which element survived the re-render   // …the follow-up runs LAST, once the document has re-rendered and the line has its selection back — a prompt raised before that would be torn down by the render it was waiting on
  return true; }
// …and the three features that ride it. Each is only the part that differs: which FEATS/MISC key to write.
function stextMarkFeat(name,label){ return stextMarkSel(toks=>{
  const on=!toks.every(t=>hasFeat(t.feats,name,"Yes"));
  toks.forEach(t=>{ const before=t.feats; t.feats=on?setFeat(t.feats,name,"Yes"):clearFeat(t.feats,name); featsSyncGloss(t,before); });   // routed through featsSyncGloss for the same reason toggleMarkFeat does — a no-op for these keys, and the invariant stays in one place
  return `${label} ${on?"marked":"cleared"} on ${toks.length===1?"1 token":toks.length+" tokens"}`; }); }
function stextMarkForeign(){ return stextMarkFeat("Foreign","Foreign"); }
/* Typo from the running sentence has to do everything the TOKEN route does, and one thing it did not: offer the
   CorrectForm box. Marking Typo=Yes and stopping there was the regression — the mark appeared but the prompt that
   makes it useful never did, so from the line the command looked like it had not run. askCorrectForms is deferred
   to `then` because it raises a popover anchored to a token's box, and that box does not exist until the render
   this marking triggers has finished. */
function stextMarkTypo(){ return stextMarkSel((toks,s,ids,si)=>{
  const on=!toks.every(t=>hasFeat(t.feats,"Typo","Yes"));
  toks.forEach(t=>{ const before=t.feats; t.feats=on?setFeat(t.feats,"Typo","Yes"):clearFeat(t.feats,"Typo"); featsSyncGloss(t,before); });
  if(!on){ ids.forEach(id=>{ const t=s.tokens[id-1]; if(t&&miscKV(t.misc,"CorrectForm")) t.misc=setMiscKV(t.misc,"CorrectForm",""); }); return "Typo cleared on "+(toks.length===1?"1 token":toks.length+" tokens"); }   // clearing Typo drops the CorrectForm with it, exactly as the token route does
  return {msg:"Typo marked on "+(toks.length===1?"1 token":toks.length+" tokens"),
          then:(line,undoRef)=>{ if(typeof askCorrectForms!=="function") return;
            // Hand over an ANCHOR RESOLVER rather than a flag. askCorrectForms used to re-query the document for
            // the word, which meant reproducing a selector across two modules and hoping the element it found was
            // laid out — it was not always, and the prompt then fell back to the diagram silently.
            askCorrectForms(si,ids.slice(), id=>line&&line.querySelector('.stx-tok[data-ids~="'+id+'"]'), undoRef); }}; }); }   // …the THIRD argument is the point: the marking came from the line, so the prompt anchors to the word THERE (see askCorrectForms)
/* Reported speech is NOT per-token: it marks the head of the reported clause and the displacement is derived
   from the tree (see toggleReported). So the selection is reduced to its own head by exactly the rule the token
   route uses — rangeHead over the covered span — rather than written onto every word the drag touched. */
function stextMarkReported(){ return stextMarkSel((toks,s,ids)=>{
  const target=ids.length>1?rangeHead(s,ids[0],ids[ids.length-1]):ids[0];
  const t=s.tokens[target-1]; if(!t) return "";
  const on=!isReported(t); t.misc=setMiscKV(t.misc,"Reported",on?"Yes":"");
  const sp=subtreeSpan(s,target);
  return on?`Reported speech: tokens ${sp.from}–${sp.to} (marked on token ${target})`:`Reported speech cleared from token ${target}`; }); }

/* ── Item 10: THE PAGE GAP BELONGS TO THE BLOCK AT THE EDGE OF ITS SHEET ────────────────────────────────────────
   In paged view a sheet is separated from the next by a band of page ground, and that band is part of what the
   reader sees above the first block of a sheet and below the last. So it is charged to those blocks:
     · their height CAP is reduced by it, so the block and its gap TOGETHER fill exactly one viewport. Uncharged,
       the pair overflowed by the height of the gap and the bottom of the block sat under the status bar.
     · and the SNAP target for the first block in a sheet is the top of the gap, not the block's own top — a sheet
       arriving at the viewport top with its rounded corner already cut off does not read as a new page.
   MEASURED off the computed style, never hardcoded to the 14/22px the stylesheet happens to use, so changing
   .docsheet's margins cannot silently desynchronise the cap from the layout. Adjacent sheets' margins COLLAPSE,
   hence the max() against the previous sheet's bottom margin. Both return 0 unpaged, where there are no sheets
   and every block's cap is the plain viewport height. */
function sheetOf(b){ const p=b&&b.parentElement; return (p&&p.classList&&p.classList.contains("docsheet"))?p:null; }
function sheetGapAbove(b){ const sh=sheetOf(b); if(!sh||b!==sh.querySelector(".sblock")) return 0;
  const cs=getComputedStyle(sh), prev=sh.previousElementSibling;
  const mt=parseFloat(cs.marginTop)||0, pmb=prev?(parseFloat(getComputedStyle(prev).marginBottom)||0):0;
  return Math.max(mt,pmb)+(parseFloat(cs.borderTopWidth)||0); }
function sheetGapBelow(b){ const sh=sheetOf(b); if(!sh) return 0;
  const bs=sh.querySelectorAll(".sblock"); if(!bs.length||b!==bs[bs.length-1]) return 0;   // the LAST BLOCK, not the last child — the trailing sheet also holds the "Add sentence" button
  const cs=getComputedStyle(sh);
  return (parseFloat(cs.marginBottom)||0)+(parseFloat(cs.borderBottomWidth)||0); }
/* ── THE STICKY BOUNDARY HEADINGS OVER A BLOCK, and what they cost it ───────────────────────────────────────────
   Exactly the same argument the page gap above makes (see item 10 immediately above), for the same two consumers:
   a heading that is PINNED under the toolbar occupies the top of the viewport for as long as any block of its
   section is on screen, so
     · the block's height CAP is reduced by it, or block + gaps + headings overflow the viewport by the headings
       and the bottom of the block sits under the status bar;
     · and the SNAP target is that much further down (js/core/scroll.js's blockSnap), or a snapped block lands
       UNDERNEATH its own document/paragraph heading with its first line hidden.
   The two headings a block can be under (its document's and its paragraph's) are exactly its .bsec ancestors'
   first children, so this walks the section chain rather than recomputing dominance from DOC.
   REAL px, like the sheet gaps and unlike the cap: the heading carries its own zoom:var(--fs), and
   getBoundingClientRect reports the zoomed box — so callers subtract it from `dh` BEFORE dividing by FS.
   The heading's bottom gap is its own PADDING (see .bmark in app.css), so the border box measured here is the
   whole of what a pinned heading covers; nothing has to be added for a margin. */
/* (paintHeadFocus was here — it hit-tested the block under each PINNED heading and copied its focus state onto
   the heading's own background, plus a second pass so a document heading matched the paragraph heading stacked
   under it. Both are unnecessary now that a heading lives INSIDE the block it names: it is painted on that
   block's ground, so the focused-block accent wash reaches it with no JS at all.) */
/* THE BOUNDARY HEADINGS NO LONGER PIN (see the .bmark rule in app.css for why), so nothing overlays a block and
   there is no overlay to pay for. Kept as a named zero rather than deleted, because it is called from three places
   that each have their own reason to ask — the block height cap, the scroll snap and scrollNearest's inset — and
   one honest answer here is clearer than three call sites separately learning the question has gone away. It also
   leaves one place to change if the pinning ever comes back. Its old body walked the .bsec ancestors, which are
   exactly the headings that dominated a block, and summed their measured heights. */
function stickyHeadH(b){ return 0; }
/* ── HOW MUCH OF THE TOOLBAR INSET MUST A STICKY HEADING ASK FOR ITSELF? ────────────────────────────────────────
   The document scrolls UNDER the overlaid titlebar + options bar, and `.doc` clears them TWICE over: with a
   `padding-top` of `--tbH + --vbH` (so the first block starts below them) and with an equal `scroll-padding-top`
   (so scrollIntoView does too). A boundary heading has to pin at exactly that height — and how much of it the
   heading's own `top` has to supply depends on which of the two the engine has already counted, which engines
   genuinely disagree about. Measured in this very Chrome, on a probe scroller with a known padding and
   scroll-padding and a `top:0` sticky child:
       padding 0,  scroll-padding 0   → pins at 0     padding 0,  scroll-padding 50 → pins at 0
       padding 50, scroll-padding 0   → pins at 50    padding 50, scroll-padding 50 → pins at 50
   i.e. Chromium's sticky view rectangle is the scroller's CONTENT box (the padding counts) and scroll-padding
   does not enter into it — so under #doc, `top:0` already lands a heading precisely at the toolbar's bottom
   edge, and asking for the inset again put it a titlebar's height too low (88px measured against a wanted 44).
   css-position-3 says the rectangle is the scrollport reduced by scroll-padding, which is a third answer again.
   The app ships against whatever WebKit the user's own Python is linked to, so none of this may be ASSUMED.
   This reproduces #doc's exact situation once — the same length used as padding AND as scroll-padding — and
   returns the FRACTION of that length the heading still has to add: 0 where the engine already covers it, 1
   where it covers none of it. Clamped to [0,1]: an engine that counted BOTH would ask for a negative top, and a
   heading a titlebar too HIGH is hidden behind the bar, which is the one outcome worth ruling out.
   Failing to measure at all resolves to 1 — visible in the wrong place beats invisible in the right one. */
const _STICK_PROBE=50;
let _stickF=null;
function stickyTopFactor(){ if(_stickF!=null) return _stickF;
  _stickF=1;
  try{ const sc=document.createElement("div");
    sc.style.cssText="position:absolute;left:-9999px;top:0;width:100px;height:100px;overflow:auto;padding-top:"+_STICK_PROBE+"px;scroll-padding-top:"+_STICK_PROBE+"px";
    const inner=document.createElement("div"); inner.style.cssText="height:400px";
    const st=document.createElement("div"); st.style.cssText="position:sticky;top:0;height:10px";
    inner.appendChild(st); sc.appendChild(inner); document.body.appendChild(sc);
    sc.scrollTop=200;                                                      // well past the sticky child's own start → it is pinned, and where it pins IS the answer
    const d=st.getBoundingClientRect().top-sc.getBoundingClientRect().top;
    document.body.removeChild(sc);
    _stickF=Math.min(1,Math.max(0,1-d/_STICK_PROBE)); }
  catch(_){}
  return _stickF; }
/* ── NUMBERING THE BOUNDARY MARKS ───────────────────────────────────────────────────────────────────────────────
   Recomputed from DOC on every render — never stored — so inserting, deleting or moving a boundary renumbers
   everything after it with no bookkeeping to go stale.
   THE SECTION MARK IS NUMBERED ONLY WHERE THERE IS SOMETHING TO TELL APART: a file with ONE document has one
   `§`, and a "§1" over it would be counting to one. From two documents up they are `§1`, `§2`, … in file order.
   A PARAGRAPH IS ALWAYS NUMBERED, because a paragraph is never the whole file — the number is the only thing
   that distinguishes one `¶` from the next.
   PARAGRAPH NUMBERING RESTARTS AT EACH DOCUMENT, and the document number is prefixed (`¶1.2`) exactly when the
   document numbers are being SHOWN. That is the choice worth stating: the prefix is a cross-reference to a mark
   the reader can actually see, so in a single-document file — where no `§n` is drawn — it would name a number
   that appears nowhere, and the paragraph reads as a bare `¶2`. The same applies to a paragraph that precedes
   the file's FIRST `# newdoc` (a perfectly legal UD file may open with loose paragraphs): it belongs to no
   numbered document, so it takes a bare `¶n` too rather than a fictitious `¶0.n`. */
function boundNumbers(){ const ndocs=DOC.reduce((a,s)=>a+(hasNewdoc(s)?1:0),0), showDoc=ndocs>1;
  const out=new Array(DOC.length); let dn=0, pn=0;
  DOC.forEach((s,i)=>{ const o={};
    // THE HEADING IS ALWAYS DRAWN; what these three values decide is the MARK in front of the title.
    //   "n"  ⇒ `§ n` — two or more documents, so the number is telling them apart.
    //   ""   ⇒ a bare `§` — one document, where a "§ 1" would be counting to one.
    //   null ⇒ NO MARK, just the title. The file's ONLY `# newdoc`, sitting on its FIRST sentence, divides the
    //          file from nothing: every sentence is inside it either way, so the § marks a division the reader
    //          cannot be on the wrong side of. The TITLE still has something to say and stays — it names what
    //          the file holds, which the filename may not. The mark box keeps its width so the title stays on
    //          the same column as every numbered heading below it.
    // The lone UNNAMED marker keeps its bare § (the "" case): with no title beside it and no glyph, the row
    // would be invisible, and the id field is the only place to type a name.
    if(hasNewdoc(s)){ dn++; pn=0; o.newdoc=showDoc?String(dn):((i===0&&boundId(s,"newdoc"))?null:""); }
    if(hasNewpar(s)){ pn++; o.newpar=(showDoc&&dn>0)?(dn+"."+pn):String(pn); }
    out[i]=o; });
  return out; }
/* ── THE SENTENCE NUMBER IN THE LEFT MARGIN ─────────────────────────────────────────────────────────────────────
   Numbered WITHIN ITS PARAGRAPH, failing that within its DOCUMENT, failing that globally — which is one rule, not
   three: the counter restarts at every boundary, so each sentence carries its position in the INNERMOST section
   enclosing it. A file with no boundaries at all therefore still numbers 1…N exactly as before, and the three
   cases named are the three things this one counter does at three densities of markup.
   SUB-NUMBERED under the section it belongs to, on exactly the marks' own numbering: a sentence in `¶1.2` is
   `1.2.1`, `1.2.2`, … and one under a bare `§2` with no paragraphs is `2.1`, `2.2`. So a number read off the
   margin locates the sentence on its own, and reads back against the heading above it without the reader having
   to hold the section in mind. (An earlier version numbered them bare — 1, 2, 3 within the section — to keep the
   column narrow. That made the margin say `1` under a heading that said `¶1.2`, i.e. two different numbering
   schemes one line apart, and the column now widens to fit anyway; see marginNumWidth.)
   The prefix is whatever the INNERMOST section's mark shows, which is where the suppressions come out right for
   free: a paragraph's own number already carries its document's where documents are numbered, and the lone `§`
   carries no number to prefix WITH (it draws bare, or not at all), so a single-document file with no paragraphs
   still numbers 1, 2, 3 exactly as a file with no boundaries does. */
function sentNumbers(){ const NUM=boundNumbers(), out=new Array(DOC.length); let pre="", n=0;
  DOC.forEach((s,i)=>{ const o=NUM[i]||{};
    if(hasNewdoc(s)||hasNewpar(s)){ n=0;   // ONE reset where a sentence opens both a document and a paragraph
      pre=(o.newpar!=null)?o.newpar:(o.newdoc!=null?o.newdoc:""); }   // innermost wins; "" for a boundary whose own number is suppressed
    out[i]=(pre?pre+".":"")+(++n); });
  return out; }
const SNUM_FS=13, DOCMARK_FS=15, PARMARK_FS=14;   // kept in lockstep with .snum (--stext-fs), .bmark.bm-doc and .bmark.bm-par in app.css — a canvas measurement cannot read a stylesheet, so these three are the one place the two files must agree by hand
/* The left margin (and with it the grid's ID column) must FIT the widest ink drawn in it, not merely the widest
   token id computeColW() sizes it from. Three inks share that box — the sentence number, the `§n` mark and the
   `¶n.m` mark — at three different sizes, so each is measured in ITS OWN font rather than the grid's.
   This REVERSES the earlier rule that an over-wide mark overflows left into the gutter. Widening the column keeps
   every row's id on one column, which is what the overflow was protecting, and does it without letting a mark
   stray under the block above. Returns 0 when there is nothing to add. */
function marginNumWidth(){ if(typeof meas!=="function"||typeof LIVE_TOKEN_STACK!=="string") return 0;   // called from computeColW (grid.js), which runs on documents built before the diagram module's font stacks exist in some harnesses. LIVE_TOKEN_STACK (not the static TOKEN_STACK base) — see diagram-core.js's refreshFontStacks(), which renderDoc() calls before computeColW() runs, so this already reflects any scheme-scoped font override (e.g. Ranjana) by the time it's read here
  const NUM=boundNumbers(), SN=sentNumbers(); let w=0;
  const eat=(str,font)=>{ if(str) w=Math.max(w, Math.ceil(meas(str,font))+idPadTotal()); };   // idPadTotal() (js/grid/grid.js) = the ID cell's own padding — --grid-row-pad on the inline-start + a flat 6px on the inline-end, styles/app.css td.col-id — the slack computeColW adds to the token-id measurement. Was a bare literal +12 (6+6) until the inline-start half was tied to --grid-row-pad; sharing the one function with scanColW's identical need is what keeps the two from disagreeing again
  SN.forEach(n=>eat(n,"700 "+SNUM_FS+"px "+LIVE_TOKEN_STACK));
  NUM.forEach(o=>{ if(o.newdoc!=null) eat(o.newdoc?NEWDOC_MARK+"\u2009"+o.newdoc:NEWDOC_MARK,"700 "+DOCMARK_FS+"px "+LIVE_TOKEN_STACK);   // the SAME string the heading draws, thin space included — measuring the glyph alone would under-size the column by exactly the space, and measuring the space on a BARE § (o.newdoc==="") would over-size it by the same amount
    if(o.newpar!=null) eat(NEWPAR_MARK+"\u2009"+o.newpar,"700 "+PARMARK_FS+"px "+LIVE_TOKEN_STACK); });
  return w; }
/* ── WHERE A BLOCK'S TEXT COLUMN REALLY STARTS ──────────────────────────────────────────────────────────────────
   The x of the FORM FIELD'S TEXT — the column every text row in the block is aligned to (the diagram's leftmost
   ink already is; see the alignment pass in renderDoc). MEASURED, and it has to be: `table.grid` is
   `table-layout:fixed` with `width:100%`, so a table narrower than its port has the slack distributed over its
   columns and the ID column comes out WIDER than the idW the header's own .snum box is sized from — by 4.2px in
   the sample at a 1400px window, and by a different amount at every other width. Nothing derived from idW can
   therefore be right, which is why the fallback (grids hidden, no cell to measure) is the only place idW appears.
   Returns a viewport x in REAL px; RTL returns the column's own start edge, i.e. its RIGHT. */
function formTextTarget(b,rtl){ const cell=b.querySelector("td.w-form .cin");
  if(cell){ const cs=getComputedStyle(cell), r=cell.getBoundingClientRect();
    return rtl ? r.right-(parseFloat(cs.paddingRight||0)+parseFloat(cs.borderRightWidth||0))*FS
               : r.left +(parseFloat(cs.paddingLeft ||0)+parseFloat(cs.borderLeftWidth ||0))*FS; }
  const br=b.getBoundingClientRect();                                          // grids hidden → the block's own left gutter + the id column, as the diagram alignment has always fallen back to
  return rtl ? br.right-(18+idW+9)*FS : br.left+(18+idW+9)*FS; }
/* ── ONE BOUNDARY HEADING ───────────────────────────────────────────────────────────────────────────────────────
   The sticky `§`/`¶` row that opens a .bsec section: the mark in the sentence-number column, then the optional
   UD id, edited in place beside it. Factored out of renderDoc because the two ranks are now built at two
   different points of the loop (a document heading opens a document section, a paragraph heading a paragraph
   section nested inside it) and building them from one routine is what keeps the two rows identical in
   everything but rank.
   `num` is the string boundNumbers() computed — "" for the single-document `§`. */
function boundHeading(s,k,glyph,what,num){
  const bm=document.createElement("div"); bm.className="bmark bm-"+(k==="newdoc"?"doc":"par");
  bm.dir=sentRTL(s)?"rtl":"ltr";   // the heading mirrors its sentence exactly as the block does (see `b.dir` below): the mark belongs in the same margin as the sentence number and the id runs the same way as the sentence. Without this the row stayed LTR over an RTL block — mark on the left, id running away from the text it names — and the measured inline-start alignment below, which resolves `margin-inline-start` in the ELEMENT's own direction, then pushed the id the wrong way
  const row=document.createElement("div"); row.className="bmrow"; bm.appendChild(row);
  const g=document.createElement("span"); g.className="bm-"+k; g.textContent=(num==null)?"":(num?glyph+"\u2009"+num:glyph);   // "" ⇒ a BARE glyph, no number: the only document in the file, where a "§ 1" would be counting to one. null ⇒ NO MARK, the title standing alone — a lone NAMED newdoc on the first sentence, which divides the file from nothing (see boundNumbers). The box keeps its width either way, so the title stays on the same column as every other heading
  g.style.width=idW+"px";   // the same box the sentence NUMBER occupies, so the mark is RIGHT-aligned with it — measured from the same idW the grid's ID column and .snum use, never a guessed constant. idW itself is now sized to fit the widest MARK as well as the widest token id (marginNumWidth, above), so a wide number widens the column rather than overflowing it — see .bmrow > .bm-newdoc in app.css
  g.title=(num==null)?"":("Start of a new "+what+(num?" ("+what+" "+num+")":""));   // no glyph ⇒ nothing to hover, and a tooltip on an invisible box is a trap
  row.appendChild(g);
  /* item 6: the id is editable IN PLACE, beside its mark. Rendered even when EMPTY — the id is optional in
     UD, so a bare `# newpar` is a perfectly good marker, and without a slot there would be nothing to click
     to give it one. It shows NOTHING when empty: a faint "id" placeholder sat here (a data-empty ::before, the
     affordance the translations grid uses), and it read as though the marker were missing a required field
     when an unnamed `# newdoc` is a complete, valid marker — the placeholder named an absence that isn't one.
     The mark itself is what advertises the row now; the field is found by the hover wash and its tooltip.
     Blanking the field does NOT remove the marker: "" means "present, unnamed", and removing it is the
     menu's job (⇧⌘D / ⇧⌘P) — two different edits that must not share one gesture. */
  const idEl=document.createElement("span"); idEl.className="bm-id"; idEl.dataset.k=k;
  const cur=boundId(s,k); idEl.textContent=cur;
  idEl.setAttribute("contenteditable","plaintext-only"); idEl.setAttribute("role","textbox"); idEl.spellcheck=false;
  idEl.setAttribute("aria-label",what+" id"); idEl.title="`"+k+" id = …` — optional; leave blank for a bare “# "+k+"”";
  idEl.addEventListener("mousedown",e=>e.stopPropagation()); idEl.addEventListener("click",e=>e.stopPropagation());   // the block's own click handler deselects on empty space; this field is not empty space. Still needed now the heading sits OUTSIDE the block: pinned, it lies over some other block, and .bm-id is the one part of the heading that takes pointer events at all
  let pre=null, orig=cur;
  idEl.addEventListener("focus",()=>{ pre=snap(); orig=boundId(s,k); });   // one undo per editing session, exactly as the translation fields do it
  idEl.addEventListener("keydown",e=>{ e.stopPropagation();   // a contenteditable isn't INPUT/SELECT/TEXTAREA → keep the doc nav handler off it
    if(e.key==="Enter"){ e.preventDefault(); idEl.blur(); }
    else if(e.key==="Escape"){ e.preventDefault(); idEl.textContent=orig; idEl.blur(); } });
  idEl.addEventListener("blur",()=>{ const v=(idEl.textContent||"").replace(/\s+/g," ").trim();   // a UD id is one token on one comment line — collapse any pasted whitespace rather than writing a comment that won't re-read
    if(v!==orig){ if(pre){ UNDO.push(pre); if(UNDO.length>80)UNDO.shift(); REDO.length=0; updateUndoUI(); }
      s[k]=v||true; markDirty(); setTitle(); }   // setTitle, not updateFileBlock: a lone `newdoc` id becomes the WINDOW title, so editing it has to reach the native title too
    idEl.textContent=v; pre=null; orig=v; });
  row.appendChild(idEl);
  return bm; }
/* …and the caret that lands in one. CREATING a boundary is half of naming it — `# newdoc` is the marker, `# newdoc
   id = …` the name — so ⇧⌘D / ⇧⌘P (and the block control, and the block menu) put the cursor straight in the new
   marker's id field instead of leaving the user to hunt for a 2-character placeholder at the top of the block.
   Called from toggleBound (js/editing/edit-ops.js) on the CREATE half of the toggle only; there is nothing to focus
   when a boundary is removed.
   THE ELEMENT IS LOOKED UP FRESH, by block index + rank, and never held across the toggle: setBound re-renders
   through preserveScroll(renderDoc), which rebuilds #doc wholesale, so any .bm-id that existed before the call is
   detached by the time this runs. That render is SYNCHRONOUS and — measured over 1.3s with renderDoc wrapped in a
   counter — is the ONLY one the gesture causes: settleAlign's extra passes run on the load paths alone, and the
   ResizeObserver reflow in js/core/scroll.js fires on a change to #doc's OWN box, which opening a heading inside a
   block is not. So no requestAnimationFrame is needed here, and using one would only widen the window in which
   something else could take the focus first.
   focus() alone would not put a CARET in it: this is a contenteditable, so the selection has to be placed by hand.
   An id already there is SELECTED rather than appended to — the field is being opened by a command that has just
   (re-)created the marker, so whatever it holds is a leftover the typing is replacing, and Escape still restores it
   (see the keydown handler above). A newly created marker's id is empty (setBound writes `true`, not a string), so
   in practice this collapses the caret into an empty field; the select-all branch is what a marker re-created with
   its name intact would get.
   preventScroll + revealEl, not the browser's own focus scroll: revealEl corrects BOTH axes and knows about the
   overlaid toolbar (via scrollNearest), where the default scroll-into-view would happily park the row under it. */
function focusBoundId(si,k){
  const el=document.querySelector(`#doc .sblock[data-i="${si}"] .bmarks .bm-id[data-k="${k}"]`);
  if(!el) return false;
  try{ el.focus({preventScroll:true}); }catch(e){ el.focus(); }   // the focus handler takes it from here: it snapshots for undo (one undo per editing session — untouched)
  const sl=window.getSelection();
  if(sl){ const r=document.createRange(); r.selectNodeContents(el);
    if(!(el.textContent||"")) r.collapse(true);   // empty field → a caret, not an empty selection
    sl.removeAllRanges(); sl.addRange(r); }
  if(typeof revealEl==="function") revealEl(el); else scrollNearest(el);   // revealEl (js/grid/grid.js) = scrollNearest + the horizontal axis; the fallback is the vertical-only one, which is still better than leaving the field off screen
  return true; }
/* …and the correction that puts one text row's own first glyph on that column. Measured on the row as it stands
   and applied to whatever inline-start margin it already carries, so the pass is idempotent (renderDoc rebuilds
   the DOM every time, so `cur` is always the stylesheet's own value) and works the same for a row that starts at
   a negative margin (.stext), at an inline one (.strans, .tgrid) or at neither.
   DIRECTION IS READ OFF THE ROW, NOT OFF ITS BLOCK, and that is not a nicety: `margin-inline-start` resolves in
   the ELEMENT's own direction, and the translations grid is deliberately `dir="ltr"` (renderBlockTrans) even
   inside an RTL block — it is an LTR grid of language names against translations. Aligning it by the BLOCK's
   direction computed a right-edge correction and then handed it to what the engine read as a left margin, moving
   the grid the wrong way by twice the error. So each row is aligned on the edge IT starts at, against the Form
   column's matching edge.
   The DELTA is divided by FS because the margin is set in LOCAL px inside a `zoom:var(--fs)` box while the rects
   are the zoomed, real ones — the same units split the height caps make. */
function alignInlineStart(el,b){ if(!el) return;
  const cs=getComputedStyle(el), rtl=cs.direction==="rtl", target=formTextTarget(b,rtl), r=el.getBoundingClientRect();
  const cur=rtl ? r.right-(parseFloat(cs.paddingRight)||0)*FS : r.left+(parseFloat(cs.paddingLeft)||0)*FS;   // the row's own TEXT edge: these rows are plain text with padding, so box + padding IS where the first glyph sits
  const d=((rtl?cur-target:target-cur))/FS;
  if(Math.abs(d)<0.02) return;                                                 // already there → don't write a style that only re-states the stylesheet
  el.style.marginInlineStart=((parseFloat(cs.marginInlineStart)||0)+d)+"px"; }

/* document */
/* ── VIEWPORT VIRTUALIZATION ──────────────────────────────────────────────────────────────────────────────────
   renderDoc() used to build a `.sblock` (full SVG diagram + grid table) for EVERY sentence, unconditionally, on
   every open AND every single edit — at 20,000 sentences that's ~20,000 live DOM subtrees rebuilt from scratch
   per keystroke (every edit-ops.js mutator ends in refresh()→renderDoc()). Windowed instead: only sentences in
   [winLo,winHi) actually get a `.sblock`; two spacer elements stand in for the estimated height of everything
   outside that range, sized from AVG_BLOCK_H (the average REAL — already-zoomed, i.e. directly comparable to a
   plain sibling div's height — height of the blocks actually built, remeasured every render).
   curBlock() is always inside the window (computeWindow clamps the anchor in, and renderDoc always calls it
   WITH curBlock() — see below), so preserveScroll's own before/after anchor lookup (js/ui/wiring.js) never has
   to fall back to a raw scrollTop restore. The window only shifts on a genuine reason to: an edit re-centres on
   the sentence being edited (curBlock(), since renderDoc recomputes the window every call); scrolling near
   either edge re-centres on whatever's now nearest the viewport top (js/core/scroll.js's maybeShiftWindow, using
   the same topVisibleBlock() signal maybeShiftFocus already computes a version of).
   Everything downstream that already worked off whatever's in the LIVE DOM rather than iterating DOC itself
   needed NO change at all: js/core/scroll.js's block-position math (querySelectorAll(".sblock") already means
   "whatever's rendered", never "every sentence"), the settle-alignment sweep at the end of this file, and
   validateAll's DOM paint (js/editing/validation.js) were already windowed — just to "all 20,000" — and are now
   windowed to whatever's actually built. The few places that assumed a `.sblock` always exists for ANY sentence
   (restoreScrollPos, find's scrollToMatch, the Issues sheet's row click) now go through scrollToSentence below. */
let winLo=0, winHi=0, AVG_BLOCK_H=220;   // AVG_BLOCK_H seeds the very first jump into an unmeasured region (e.g. restoring a saved scroll position deep in a large file before anything has been measured); self-corrects every render
const WIN_BUFFER=15;   // sentences kept rendered above/below the anchor — generous overscan so ordinary scrolling and arrow-key navigation between adjacent blocks never has to wait on a rebuild
function computeWindow(anchor){
  if(!DOC.length){ winLo=0; winHi=0; return; }
  if(anchor==null||anchor<0) anchor=winLo;   // no valid anchor (nothing selected/focused yet) → keep whatever range was already showing
  anchor=Math.max(0,Math.min(anchor,DOC.length-1));
  winLo=Math.max(0,anchor-WIN_BUFFER); winHi=Math.min(DOC.length,anchor+WIN_BUFFER+1);
}
// Bring sentence i into the rendered window — recentring + a synchronous re-render if it isn't already there —
// and return its (now-existing) .sblock. The shared primitive every "jump to a sentence that might be anywhere
// in the document, not just near whatever's currently on screen" caller needs.
function scrollToSentence(i){
  if(i==null||i<0||i>=DOC.length) return null;
  const host=document.getElementById("doc"); if(!host) return null;
  let b=host.querySelector(`.sblock[data-i="${i}"]`);
  if(!b){ computeWindow(i); renderDoc(); b=host.querySelector(`.sblock[data-i="${i}"]`); }
  return b;
}
/* ── NOTATION-SWITCH DIAGRAM CACHE ────────────────────────────────────────────────────────────────────────────
   renderSentence(si) (js/diagram/diagram-render.js) used to be called fresh on EVERY buildBlock, for EVERY
   notation switch: stemma/tree/arcs/brackets/outline each re-run their own font-measurement + layout algorithm
   over every token, even when re-visiting a notation that was already built for this exact sentence with
   nothing about it or the view changed since. Measured on a 42-token non-projective Sanskrit sentence
   (samples/brihat_jataka.conllu s1, windowed alongside its 3 siblings × 4 repeats = 16 sentences in view): a
   full renderDoc() of that window costs ~2–3.6s in EVERY notation, and re-switching arcs→tree→arcs→tree… paid
   that same cost on EVERY leg, including the ones returning to a notation already seen seconds earlier (a CDP
   profiling harness, run headless against this exact window, is what produced those numbers — see the
   before/after figures wherever this change is written up). This is the SAME shape of problem the
   COLUMN-WIDTH CACHE above (js/grid/grid.js) already solves for computeColW(), and follows its structure: a
   cache of already-built values, a single per-sentence "this one's dirty now" signal, and wholesale invalidation
   on the handful of events that can invalidate everything at once.
   KEYED ON (si, conv, and every OTHER global the five renderers read that can change their OUTPUT without
   touching the sentence itself) — diaFlagsSig() below is the exhaustive list, gathered by grepping every
   `show.*`/global read in diagram-render.js/diagram-wrap.js/diagram-core.js's displaySent/bform/mirror/wrap
   path. Missing one here would mean "toggle a view flag, switch notations, see the OLD flag's rendering" — a
   correctness bug, not a slow one, so the list errs generous rather than clever: every entry is read ONCE per
   renderDoc() (diaFlagsSig is computed once into ctx.diaSig, not once per sentence), so a few unused reads cost
   nothing measurable next to the layout work they guard.
   KEYED ON THE SENTENCE'S OWN CONTENT TOO (csig — diaContentSig below), not only on the per-sentence
   invalidation hook further down. That hook — snapSent(si), which fires when a mutator ANNOUNCES itself — is
   necessary but not sufficient: it fires BEFORE the edit, and nothing re-fires after any work the edit DEFERS
   past the render it scheduled. A LEMMA EDIT is exactly that shape, and was the bug this closes. Committing a
   Lemma cell (commitCell in js/grid/grid.js) writes the lemma and calls afterLemmaEdit (js/io/bridge.js), which
   AWAITS the new lemma's transliteration before msegRefill can re-derive MSeg from it — while the render that
   same commit scheduled runs in between, builds the diagram from the OLD MSeg/MGloss, and caches it under a
   signature nothing has touched since. When msegRefill finally writes the new MSeg and re-renders, that entry is
   a hit, so the diagram kept serving the pre-edit morphemic rows until the NEXT edit's snapSent happened to drop
   it: "the grid updates now, the diagram updates one edit late". Every other pass that lands after its own edit's
   render (a background re-parse revising lemma/feats, an async romanisation fill) had the same hole. One content
   signature closes all of them, by asking the question the cache actually cares about — "is this still the
   sentence I drew?" — instead of trusting every mutator to remember to answer it.
   STORAGE: si → {csig, m:Map(conv → {sig,node})}. A nested map, not one flat `si+conv+sig` string key, because the outer
   level is exactly what per-sentence invalidation needs to drop in O(1) (see invalidateDiaSentence) and what
   window-pruning needs to iterate (pruneDiaCache) — neither wants to filter-scan every (si,conv) pair. The
   inner level caps itself at 5 entries (one per notation) with no LRU needed: there are only 5 notations, so
   "cache every notation this sentence has been shown in, for as long as the sentence is on screen" is already
   a hard, small bound — the memory question (CLAUDE.md's virtualization note) is answered by the OUTER level
   instead, pruned to the current [winLo,winHi) below.
   NEVER GOES STALE UNDER SELECTION: the returned node's .sel/.rng/.dim-* classes are NOT baked in here — they
   are re-derived from data-s/data-tok attributes by applySel() (below in this file), which renderDoc() already
   calls unconditionally after every buildBlock loop, cache hit or miss alike. That is what makes "bake selection
   in at build time, drop the cache entry on every selection change" (the simple-but-defeats-the-cache option)
   unnecessary — applySel's live class-toggle pass already treats a reused node exactly like a fresh one, since
   both carry the same data-* attributes and applySel never assumes it is looking at just-built DOM. */
let DIA_CACHE=new Map();   // si → {csig, m:Map(conv → {sig,node})}
// every global that changes a rendered diagram's OUTPUT without changing the SENTENCE (which invalidateDiaSentence
// covers instead) — read once per render into ctx.diaSig, not once per sentence. FS/AVAILW/idW: zoom + wrap budget
// + the margin column a wrapped view indents past (js/diagram/diagram-wrap.js). DOCLANG: isSanskritLang() gates
// MWT sandhi-fusion display and the script daṇḍa glyph. TRANSLIT_SCHEME/ORTHO_SCHEME/STORED_SCHEME: the romanised/
// scripted form a token renders (bform/trTxt/topTransTxt). stemmaProj/stemmaCat: renderSentence's own stemma-only
// options, included unconditionally rather than only when conv==="stemma" — simpler than a per-conv-conditional
// signature, and a toggle of either is rare enough that invalidating a tree/arcs/brackets/outline entry it can't
// possibly affect costs nothing worth avoiding. show.*: pos/labels/colour/arrows/extRel/wrap/translit/mergePunct,
// every `show.` this app's 3 diagram files read (grepped, not guessed). GLOSS_ON/_VIS, MORPH_ON/_VIS: belowTiers().
function diaFlagsSig(){
  // "|", not "" — a bare join() concatenates adjacent NUMBERS (FS/AVAILW/idW) with no boundary between them, so
  // e.g. FS=1,AVAILW=23 and FS=12,AVAILW=3 both join to "123": two genuinely different view-states producing the
  // SAME signature, i.e. a false cache hit — a stale diagram silently surviving a real zoom/wrap-width change.
  // "|" can't appear in any of these values (plain numbers, BCP-47-ish language/scheme names, 0/1 flags), so it's
  // an unambiguous field separator.
  return [FS,AVAILW,idW,DOCLANG,TRANSLIT_SCHEME,ORTHO_SCHEME,STORED_SCHEME,
    stemmaProj?1:0,stemmaCat?1:0,
    show.pos?1:0,show.labels?1:0,show.colour?1:0,show.arrows?1:0,show.extRel?1:0,show.wrap?1:0,show.translit?1:0,show.mergePunct?1:0,show.avm?1:0,
    GLOSS_ON?1:0,GLOSS_VIS?1:0,MORPH_ON?1:0,MORPH_VIS?1:0
  ].join("|");
}
// The cached/fresh diagram for sentence i, under the CURRENT conv + ctx.diaSig — renderSentence(i) itself is
// unchanged (still the single source of truth for what a notation looks like); this only decides whether that
// call is needed. A stale entry for a DIFFERENT conv or an outdated sig is simply overwritten, never patched —
// the two situations where per-conv reuse would pay off (switching straight back, or nothing having changed at
// all) are exactly the ones this returns early for.
/* THE SENTENCE HALF of the key: everything a renderer reads OFF THE SENTENCE, in one string. Deliberately the
   WHOLE sentence object rather than an enumerated field list — the flags half above can afford to enumerate
   (those globals are few and change one at a time), but the sentence half cannot: the renderers reach tokens'
   form/lemma/upos/feats/head/deprel/MISC (Gloss/MSeg/MGloss/Translit/SpaceAfter/Typo/Foreign/NewPar/…), the MWT
   ranges, the empty nodes, s.text and the per-token romanisation caches, and a field left out of a hand-written
   list is a diagram that silently stops updating — the very failure documented above, one field at a time.
   JSON.stringify is what snapSent(si) (js/core/undo.js) already runs on one sentence per keystroke, so its cost
   is known to be affordable at this scale; here it runs once per WINDOWED sentence per render (≈31 of them), and
   it guards a per-sentence layout pass measured in tens of milliseconds. Extra fields it covers that no renderer
   reads (comments, translations, the URL) can only cost a needless rebuild, never a wrong diagram — the safe
   direction, and the same "errs generous rather than clever" the flags list above takes. */
let _DIA_NOSIG=0;
function diaContentSig(s){ try{ return JSON.stringify(s); }catch(_){ return "\u0000nosig"+(++_DIA_NOSIG); } }   // unstringifiable (it never is — see snapSent) → a value that can never repeat, i.e. this sentence simply doesn't cache, rather than a constant that would collide with the next one
function diaSentence(i,ctx){
  const stage=incStageFor(i);   // ≥0 while an incremental post-parse sequence is converging on THIS sentence (see the INCREMENTAL note below); -1 otherwise, and any render the sequence did not start cancels it there
  if(stage>=0){ const node=incStaged(i,stage); if(node) return node; }   // a STAGE IS NEVER CACHED: it is a deliberate approximation of this sentence, not a rendering of it, and an entry for it could be served back to an ordinary render
  const csig=diaContentSig(DOC[i]);
  let e=DIA_CACHE.get(i);
  if(e&&e.csig!==csig){ DIA_CACHE.delete(i); e=null; }   // the SENTENCE moved since these were built → every notation's entry for it is stale, not just the one on screen
  if(e){ const hit=e.m.get(conv); if(hit&&hit.sig===ctx.diaSig) return hit.node; }
  const node=renderSentence(i);
  if(!e){ e={csig,m:new Map()}; DIA_CACHE.set(i,e); }
  e.m.set(conv,{sig:ctx.diaSig,node});
  return node;
}
// Per-sentence invalidation. Called from js/core/undo.js's snapSent(si) — the ONE choke point every
// single-sentence mutator already passes through before it writes (pushUndo(si) calls it directly; grid.js's
// cell-edit sessions call it themselves via `pendingSnap=snapSent(si)` on focus, ahead of committing anything).
// touchColW(si,si+1) (js/grid/grid.js) was considered and REJECTED as this hook: it is called at fewer sites
// than snapSent — e.g. dragging an arc to a new head (js/diagram/diagram-edit.js's setDiagramHead) calls
// pushUndo(si) but not touchColW, because a stale COLUMN WIDTH after a re-head is cosmetic slop (grid.js's own
// term) the grid tolerates on purpose, whereas a stale DIAGRAM after a re-head is the wrong tree drawn as if it
// were current — not a tolerable degree of staleness. snapSent is the strictly more complete signal: every
// call site touchColW has, snapSent already covers (grid.js's pendingSnap dance IS a snapSent(si) call), plus
// every structural/relation edit that changes a rendered tree without widening any cell. Fires on FOCUS (grid.js)
// or before the first write (everywhere else), i.e. slightly early — an edit session that focuses a cell and
// blurs it unchanged drops a cache entry that was still valid — which only ever costs one extra rebuild, never
// a wrong one, so erring early is the safe direction.
function invalidateDiaSentence(si){ DIA_CACHE.delete(si); }
// Wholesale clear — added at every existing invalidateColW() call site (document replace/undo/redo/new-file,
// a whole-document conversion, Find & Replace's Replace All, a font-stack change) PLUS the structural edit-ops.js
// sites (insert/delete/move/re-boundary a SENTENCE): those shift every FOLLOWING sentence's OWN INDEX, and this
// cache is keyed on si, so "sentence 5" after a splice is a different sentence than the node cached under that
// key — reusing it would draw sentence 6's old tree under sentence 5's number. colW tolerates exactly the same
// hazard by re-scanning wholesale for the same reason (see its own note in js/grid/grid.js); this does too.
// ALSO added in js/lang/translit-load.js's fillTranslit/fillOrtho, which are not si-scoped edits at all but
// cross-document DERIVED passes (a scheme switch, a fresh parse's romanisation) that mutate t.translit/t.ortho/
// s.orthoLine across arbitrarily many sentences with no pushUndo/snapSent of their own (deliberately — they are
// not user edits, see those functions' own comments) and so would otherwise race a cache built moments earlier,
// before the async fill landed, permanently serving the pre-fill rendering back on every later notation switch.
function invalidateDiaCache(){ DIA_CACHE.clear(); cancelIncremental(); }   // …and any in-flight incremental sequence with it: it is keyed on si, and every caller of this is replacing what si NAMES
// Drop every cached sentence OUTSIDE the current render window. Composes with the virtualization above rather
// than fighting it: a sentence that has scrolled out of [winLo,winHi) is already gone from the DOM (its .sblock
// was never rebuilt, or was replaced by a spacer), so a cache entry for it is pure memory with nothing to show
// for it — on a 20,000-sentence document, cycling every notation while scrolling through the whole file would
// otherwise grow DIA_CACHE to 20,000 × 5 entries and never shrink. Called every renderDoc(), right after
// computeWindow() has decided the range — cheap (one Map iteration bounded by however many sentences have EVER
// been cached, which window-pruning itself keeps close to WIN_BUFFER*2+1 in steady state).
function pruneDiaCache(lo,hi){ for(const si of DIA_CACHE.keys()) if(si<lo||si>=hi) DIA_CACHE.delete(si); }
/* ── INCREMENTAL POST-PARSE DIAGRAM (breadth-first by tree depth) ─────────────────────────────────────────────
   A parse hands the grid its tokens in one go, but the DIAGRAM for a long sentence costs a whole layout pass
   (stemmaLayout's per-token measurement, spreadForLabels' iterative widening, the label de-collision passes,
   fitTight) before a single glyph reaches the screen — so the sentence's row sat blank for as long as that took.
   This draws the tree AS IT IS BEING WORKED OUT instead: stage 0 hangs every token straight off its own root
   (a flat, one-level shape — cheap, because a flat tree has no crossing edges and almost nothing for the
   de-collision passes to do), the next stage attaches the root's real immediate dependents, the next theirs, and
   so on until the LAST stage draws the true tree through the ordinary path above. Each stage is one
   requestAnimationFrame apart, so the browser paints between them and the diagram visibly converges.
   THE LAST STAGE IS NOT AN APPROXIMATION OF ANYTHING: it is a plain renderDoc() with this whole mechanism
   switched off (incStageFor returns -1 once the ladder runs out), so the finished diagram is bit-for-bit what the
   non-incremental path draws, post-passes and all. That is also why every stage is a full renderDoc rather than a
   surgical swap of the one `.diagram` node: the alignment/height-cap/wrapproj/seam-mark passes at the tail of
   renderDoc all measure a block against its diagram, and a staged diagram that skipped them would settle by
   jumping rather than by converging. The other ~30 sentences in the window cost nothing extra per stage — they
   are cache hits (see above), and their csig hasn't moved.
   IT COSTS MORE WORK IN TOTAL, not less, and is therefore armed ONLY for a sentence that was just parsed
   (renderDiagramIncremental, called from the parse paths in js/io/bridge.js) and only when the shape has enough
   depth and enough tokens to be worth watching converge. Every ordinary render — an edit, a scroll, a notation
   switch — takes the one-shot path exactly as before.
   NOTATIONS: stemma / hierarchy / arcs only (their wrapped variants come along, since wrapDiagram re-renders
   from the same truncated tree). BRACKETS AND OUTLINE FALL THROUGH to the one-shot render deliberately: both are
   NESTING notations, so a truncated tree doesn't read as "still working" but as a genuinely different (flat)
   analysis — and their cost is dominated by the browser's own text layout of the rows, which the truncation
   doesn't reduce, so there would be nothing to win by it either.
   THE DOCUMENT IS NEVER MUTATED — see incStaged for how a truncated tree is drawn without touching DOC. */
const INC_CONV={stemma:1,tree:1,arcs:1};   // where a truncated tree means something — see the note above
const INC_MIN_TOK=10, INC_MAX_STAGES=5;    // below ~10 tokens the one-shot layout is already imperceptible; and never more than 5 intermediate stages, however deep the tree, so a 20-level chain doesn't buy its convergence with 20 full renders (the ladder then steps by more than one level at a time — see incLadder)
let INC=null;   // {si, ladder:[depth,…], i, armed, own, raf} — at most ONE sequence at a time: a parse is a per-sentence operation, and a second one supersedes the first
// Every token's depth below its own root, plus its parent index — computed on the REAL token list (before
// displaySent's merge-punct/goeswith folds), because that is the list the truncation has to rewrite.
// Malformed heads are handled the way the renderers already handle them: a head outside 1…n (or pointing at the
// token itself) is a root, and a cycle is broken by the chain-length guard, leaving its members at finite,
// arbitrary depths rather than looping forever.
function incDepths(tokens){ const n=tokens.length, par=new Array(n), d=new Array(n).fill(-1);
  for(let i=0;i<n;i++){ const h=parseInt(tokens[i].head,10); par[i]=(h>=1&&h<=n&&h!==i+1)?h-1:-1; }
  for(let i=0;i<n;i++){ if(d[i]>=0) continue;
    const chain=[]; let j=i;
    while(j>=0 && d[j]<0 && chain.length<=n){ chain.push(j); j=par[j]; }   // walk up to the first node whose depth is already known (or to a root, or until the guard trips on a cycle)
    let base=(j>=0&&d[j]>=0)?d[j]:-1;                                      // -1 ⇒ the top of the chain is itself a root (or a cycle member) → depth 0
    for(let k=chain.length-1;k>=0;k--) d[chain[k]]=++base; }
  return {par,d}; }
// The depths the sequence draws before the true tree. Empty ⇒ nothing to converge from: a tree that is already
// one level deep IS the flat shape stage 0 would draw, so staging it would show the same picture twice.
function incLadder(maxD){ if(maxD<2) return [];
  const step=Math.ceil(maxD/INC_MAX_STAGES), out=[];
  for(let d=0;d<maxD;d+=step) out.push(d);   // always starts at 0 (the flat shape) and always stops short of maxD (which is the true tree, drawn by the ordinary path)
  return out; }
/* One stage's TOKEN LIST: every token at depth ≤ k keeps its real head (and its own object, untouched); anything
   deeper is re-attached to its nearest ancestor within the drawn depth, on a SHALLOW COPY of that token alone.
   The deprel is deliberately kept as it is: the labels are the ones the finished diagram will carry, so they
   don't flicker through the stages, and the arc a stage draws is honestly "this token belongs somewhere under
   there" — which is exactly what the reader is being shown while the rest is worked out. */
function incTruncTokens(tokens,k){ const {par,d}=incDepths(tokens), n=tokens.length;
  return tokens.map((t,i)=>{ if(d[i]<=k) return t;
    let j=i, guard=0; while(j>=0 && d[j]>k && guard++<=n) j=par[j];
    if(j<0||j===i) return t;   // no ancestor inside the drawn depth (only reachable through a malformed chain) → leave the token exactly as the document has it
    return Object.assign({},t,{head:String(j+1)}); }); }
/* Draw sentence si as of stage-depth k. renderSentence(si) reads DOC[si] itself (through displaySent), and it
   lives in js/diagram/diagram-render.js with no seam for an override, so the truncated sentence is put in the
   array slot for the duration of that ONE SYNCHRONOUS CALL and taken straight back out in a finally.
   THAT IS NOT A DOCUMENT MUTATION and must never become one: the sentence OBJECT is not touched (the truncated
   tokens are a fresh array of untouched originals plus shallow copies), the slot holds the substitute only while
   a single synchronous, non-dispatching call runs — no event, no await, no observer can see it — and the same
   object reference is restored on every path out, exception included. Nothing calls markDirty, pushUndo or any
   serializer here, so dirty-marking, undo and save cannot see this at all.
   Any throw from a staged render abandons the sequence and falls back to the true one-shot render rather than
   propagating: a stage is an optimisation, and an optimisation must never be able to blank the document. */
function incStaged(si,k){ const real=DOC[si]; if(!real||!real.tokens) return null;
  try{ DOC[si]=Object.assign({},real,{tokens:incTruncTokens(real.tokens,k)});
    try{ return renderSentence(si); } finally { DOC[si]=real; }
  }catch(e){ cancelIncremental(); return null; } }
// diaSentence's hook. Returns the stage-depth to draw for sentence i, or -1 for "draw the real thing". Consuming
// `armed` here is what lets the caller's own post-parse render BE stage 0, whichever side of it the sequence was
// armed on; after that, only the sequence's own renders (own) may draw a stage, so ANY other render — a user
// edit, a notation switch, a scroll re-render, a second document — cancels the sequence and draws the true tree
// in that same pass. That is also why no cancellation ever leaves a stage on screen as the last word.
function incStageFor(i){ const seq=INC; if(!seq||seq.si!==i) return -1;
  if(!(seq.armed||seq.own)){ cancelIncremental(); return -1; }
  seq.armed=false;
  return seq.i<seq.ladder.length?seq.ladder[seq.i]:-1; }
function incTick(){ const seq=INC; if(!seq) return; seq.raf=0;
  if(seq.armed) seq.armed=false;   // nobody rendered stage 0 on our behalf (the caller rendered before arming, or not at all) → this tick draws it
  else seq.i++;
  if(!show.graphs || seq.si<winLo || seq.si>=winHi){ INC=null; return; }   // diagrams switched off, or the sentence has scrolled out of the rendered window — there is nothing on screen to converge
  const last=seq.i>=seq.ladder.length;
  seq.own=true;
  try{ if(typeof preserveScroll==="function") preserveScroll(renderDoc); else renderDoc(); }
  finally { seq.own=false; }
  if(INC!==seq) return;            // that render cancelled us (or a second parse replaced the sequence outright)
  if(last){ INC=null; return; }    // …and that render drew the TRUE tree, so the sequence is finished
  seq.raf=requestAnimationFrame(incTick); }
// NO CANCELLATION EVER LEAVES A STAGE AS THE LAST THING DRAWN, and that is a property of the call sites rather
// than of anything done here: incStageFor cancels from INSIDE a render that then draws the true tree in the same
// pass; incStaged's catch does the same by returning null and falling through; invalidateDiaCache's callers
// (document replace / undo / redo / conversion) all re-render immediately after; and renderDiagramIncremental
// hands over to a fresh sequence. A future caller that fits none of those must render the sentence itself.
function cancelIncremental(){ const seq=INC; if(!seq) return; if(seq.raf) cancelAnimationFrame(seq.raf); INC=null; }
/* THE ENTRY POINT — "this sentence was just parsed; converge on its diagram instead of making the reader wait".
   Call it from the parse paths in js/io/bridge.js, immediately BEFORE the preserveScroll(renderDoc) that shows
   the parse (that render then costs stage 0 instead of the full layout). Calling it AFTER that render still
   works — the first tick draws stage 0 itself — it just pays for the full layout first and so wins nothing. */
function renderDiagramIncremental(si){
  cancelIncremental();   // a second parse supersedes whatever was still converging
  if(si==null||si<0||si>=DOC.length) return;
  if(!show.graphs||!INC_CONV[conv]) return;
  const s=DOC[si], toks=s&&s.tokens;
  if(!toks||toks.length<INC_MIN_TOK) return;
  const ladder=incLadder(incDepths(toks).d.reduce((a,x)=>x>a?x:a,0));   // reduce, not Math.max(...d): a spread that long is an argument list, and a long sentence would blow the call stack rather than report a depth
  if(!ladder.length) return;
  DIA_CACHE.delete(si);   // whatever is cached for si describes the PRE-parse tokens; drop it here rather than leave the first staged render racing it
  INC={si,ladder,i:0,armed:true,own:false,raf:0};
  INC.raf=requestAnimationFrame(incTick);
}
window.renderDiagramIncremental=renderDiagramIncremental;   // also reachable from the native menu / bridge glue, which addresses the frontend through window.*
/* the per-sentence body renderDoc()'s main loop used to run inline — pulled out so a future windowed/
   incremental render (only the sentences near the viewport) can build ONE block without re-running the
   once-per-render setup above it. ctx carries the few things that are per-render state rather than true
   globals: NUM/SNUM (boundNumbers()/sentNumbers(), computed once per render) and sheet/newSheet (the PAGED
   .docsheet a block gets appended into, which can change mid-loop when a `# newdoc` opens a new one — see
   the reassignment below). Everything else this body reads (idW, show, PAGED, DOC itself, …) is already
   true module-level state, unaffected by which sentence is being built. Zero behaviour change from the
   original inline loop — same statements, same order, just addressed through ctx instead of a closure. */
function buildBlock(i,ctx){ const s=DOC[i];
    if(PAGED && i>0 && hasNewdoc(s)) ctx.sheet=ctx.newSheet();   // a new document gets a sheet of its own (never for i=0, which would leave an empty first sheet)
    /* THE HEADINGS BELONG TO THE BLOCK THEY OPEN, and are built here to be appended INSIDE it below. They spent a
       while as .bsec section wrappers around the run of blocks they named, which is what a sticky heading needs (a
       sticky box pins within its containing block, so the run had to BE a box). The pinning is gone — the
       hierarchical numbering tells a reader where they are from every row's margin — and with it the only reason
       the sections existed, so the extra nesting went too: a boundary is a fact about ONE sentence, the sentence
       that starts the document or paragraph, and it now reads as part of that sentence's block again. */
    const heads=[];
    if(hasNewdoc(s)) heads.push(boundHeading(s,"newdoc",NEWDOC_MARK,"document",ctx.NUM[i].newdoc));   // a `# newdoc` ALWAYS gets its heading; boundNumbers decides only whether a § goes in front of the title
    if(hasNewpar(s)) heads.push(boundHeading(s,"newpar",NEWPAR_MARK,"paragraph",ctx.NUM[i].newpar));   // document first, paragraph under it — the order the two rows stack in
    const _r=(typeof blockRange==="function")?blockRange():null;
    const b=document.createElement("div"); b.className="sblock"+(curBlock()===i?" sel-block":"")+((_r&&i>=_r.lo&&i<=_r.hi)?" rng-block":"")+(show.grids?"":" no-grid")+(hasNewpar(s)?" nd-par":"")+(hasNewdoc(s)?" nd-doc":""); b.dataset.i=i;   // curBlock(), not sel.s: the focused-block tint marks the sentence being READ, which scrolling moves on its own without disturbing the selection (see the CURBLOCK note in js/core/prefs.js)
    b.dir=sentRTL(s)?"rtl":"ltr";   // RTL sentence → mirror the whole block: number, controls, grid columns
    const head=document.createElement("div"); head.className="shead";
    const num=document.createElement("span"); num.className="snum"; num.textContent=ctx.SNUM[i]; num.style.width=idW+"px";   // item 4: numbered within its paragraph / document / the file — see sentNumbers.   // match the grid ID column → diagram aligns with Form
    // a plain contenteditable span, not an <input> — an <input>'s box model is only PART of what
    // WebKit renders: it's a replaced element whose actual text sits in an internal user-agent
    // shadow DOM (its own "text field content" div), which -webkit-appearance:none resets the
    // outer chrome of but not always the inner one, and which was still showing uneven insets for
    // a long value. A contenteditable span has no such hidden layer — what app.css says about its
    // box IS the whole box — and it needs no JS width measurement at all (sizeSid, gone): a flex
    // item with no explicit width simply sizes to its own text, exactly like .bm-id already does
    // (js/core/document.js's boundHeading, the same contenteditable-id pattern this now mirrors).
    const sid=document.createElement("span"); sid.className="sid-in mono"; sid.textContent=s.sid; sid.title="sent_id";
    sid.setAttribute("contenteditable","plaintext-only"); sid.setAttribute("role","textbox"); sid.setAttribute("aria-label","sent_id"); sid.spellcheck=false;
    sid.addEventListener("mousedown",e=>e.stopPropagation()); sid.addEventListener("click",e=>e.stopPropagation());   // the block's own click handler deselects on empty space; this field is not empty space (same reason .bm-id stops these two — js/core/document.js's boundHeading)
    let sidOrig=s.sid;
    sid.addEventListener("focus",()=>{ sidOrig=s.sid; });
    sid.addEventListener("keydown",e=>{ e.stopPropagation();   // a contenteditable isn't INPUT/SELECT/TEXTAREA → keep the doc nav handler off it
      if(e.key==="Enter"){ e.preventDefault(); sid.blur(); }
      else if(e.key==="Escape"){ e.preventDefault(); sid.textContent=sidOrig; sid.blur(); } });
    sid.addEventListener("blur",()=>{ const v=(sid.textContent||"").replace(/\s+/g," ").trim();
      if(v&&v!==s.sid)pushUndo(i); s.sid=v||s.sid; sid.textContent=s.sid; });
    // editable sentence text (# text): commit on blur/Enter re-tokenises or re-parses the sentence (Item 4).
    // Item 3: under a SCRIPT orthography the top line shows the sentence in that script (read-only) and this
    // editable original moves DOWN into the transliteration slot (mirroring the per-token original-in-row rule).
    // …except where that rendering could not change anything — see saScriptNoop (js/lang/translit.js).
    // Then the block renders exactly as under "Original": `# text` stays put and editable, and any
    // transliteration row goes beneath it instead of taking its place.
    const scriptTop=orthoScript() && !(typeof saScriptNoop==="function" && saScriptNoop());
    /* A displayed scheme that RESPELLS the sentence rather than romanising it — CSL marks the junctions
       (`vartm'âpunarjanmanām`), so it says something the glyph above does not, whatever script that glyph
       is in. Under `scriptTop` it takes the visible row and the editable original collapses behind it;
       computed here because both halves of that decision (the click-to-reveal wiring on the script line,
       and the rows themselves) are in different blocks below and must not disagree. */
    // CSL fills the TOP line when the chosen script is Latin (saCslTop) — the two choices name one line.
    // Otherwise, under a real script, it takes a row of its own beneath the glyph.
    const cslTop=(typeof saCslTop==="function") && saCslTop() && show.translit;
    const cslRow=isSanskritLang() && TRANSLIT_SCHEME==="csl" && show.translit && !cslTop;
    let scriptTransLine=null, fieldHost=null;   // fieldHost: the row the sentence field opens on — see the click handler on the script line   // set below, IF scriptTop: the .strans-orig editable line this block's script .stext reveals+focuses when Displayed transliteration is "None" (assigned before either element's listeners can fire — both are wired synchronously within this same DOC.forEach iteration)
    // item 30's daṇḍa DISPLAY transform now lives at module level (dandaDisp, top of this file) so the
    // late stage-2 alignment repaint can reproduce exactly what this render drew.
    const wireStext=el=>{ const raw=s.text||s.tokens.map(t=>t.form).join(" ")||"(empty)";
      el.dataset.orig=raw; paintStext(el,i,dandaDisp(raw));   // item 30: show the daṇḍa display when defocused; paintStext lays the plain text down first and adds the Foreign/Typo/Reported decoration over it only where the token↔text alignment verified
      el.setAttribute("contenteditable","plaintext-only"); el.setAttribute("role","textbox"); el.spellcheck=false;
      el.title="Sentence text — edit and press Enter to re-tokenise / re-parse";
      let clickPt=null;   // the screen point of the mousedown that is ABOUT to focus this line — the focus handler repaints, which discards the browser's own caret, so the point is re-hit-tested against the rebuilt text (see stextCaretAtPoint)
      el.addEventListener("mousedown",e=>{ e.stopPropagation(); clickPt={x:e.clientX,y:e.clientY}; });   // place the caret without selecting/deselecting a TOKEN — block focus still happens, via the focus handler's setCurBlock below
      el.addEventListener("click",e=>e.stopPropagation());
      el.addEventListener("focus",()=>{ const r=el.dataset.orig||"";
        setCurBlock(i);   // clicking (or tabbing) into the running-sentence / editable-original line is arriving at its block, same as selecting a token (pick) or scrolling to it — mousedown/click above stop propagation before .sblock's own click handler (which would otherwise call pick→CURBLOCK) ever sees them, so this is the only remaining path that moved CURBLOCK for these lines
        const pt=clickPt; clickPt=null;   // consumed here whether or not it is used: a KEYBOARD focus (Tab, or a programmatic .focus() after a render) must never inherit the point of some earlier click
        if(el.firstElementChild||el.textContent!==r){ paintStext(el,i,r,true);   // item 30: editing reveals the raw / | characters — and REPAINTS in the editing state, which is what makes textContent exactly `# text` again (the resting typo substitution is dropped, the file's own spelling coming back struck through with its correction above) while KEEPING the Foreign italics and the reported corner marks, none of which are in textContent. The guard skips the rewrite — and so the caret placement the click is about to make — when the line is already plain and already raw
          if(pt) stextCaretAtPoint(el,pt.x,pt.y); } });   // …and when it does rewrite, the caret has to be put back at the place that was clicked. Only after the repaint: a caret set before it points into nodes that no longer exist
      el.addEventListener("blur",()=>{ clickPt=null; });   // (a mousedown on an ALREADY-focused line fires no focus event, so its point would otherwise sit here until the next one)
      el.addEventListener("keydown",e=>{ e.stopPropagation();   // a contenteditable DIV isn't INPUT/SELECT/TEXTAREA → keep the doc nav handler from firing
        /* THE THREE MARK SHORTCUTS, in the line itself. ⌘I had an in-page handler and the other two did not, which
           left them depending entirely on the native Edit menu matching their key equivalent — so in the browser
           they did nothing at all, and in the app anything that stopped ⌘/ or ⇧⌘' reaching the menu (a
           contenteditable claims a fair number of ⌘-combinations as editing commands) took them out with it.
           Foreign was the only one that always had a second route. All three now do, and all three go through the
           same stextMark* pair the menu route uses, so there is one behaviour however the key arrives. */
        const cmd=cmdKey(e);   // ⌘ on macOS, Ctrl on Windows (js/core/platform.js) — the `&&!e.altKey` this replaced lives inside cmdKey now, keeping Ctrl+Alt chords off these three
        if(cmd&&!e.shiftKey&&(e.key==="i"||e.key==="I")){ e.preventDefault();   // ⌘I → Foreign
          if(!stextMarkForeign()) toast("Select the words in the sentence line to mark them Foreign"); return; }   // claimed the key but found no selection → say why rather than silently marking whichever token happens to be selected in the diagram
        if(cmd&&!e.shiftKey&&e.key==="/"){ e.preventDefault();                 // ⌘/ → Typo (and its correct-form prompt)
          if(!stextMarkTypo()) toast("Select the words in the sentence line to mark them a typo"); return; }
        if(cmd&&e.shiftKey&&(e.key==="'"||e.key==='"')){ e.preventDefault();   // ⇧⌘' → Reported speech. Both characters tested: the shifted key reports as `"` on a US layout and as `'` on others, and matching only one of them is why a key equivalent like this quietly misses on some keyboards
          if(!stextMarkReported()) toast("Select the words of a reported clause in the sentence line"); return; }
        if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); el.blur(); }   // item 12: Enter commits/re-tokenises; SHIFT+Enter inserts a line break (preserved in the display)
        else if(e.key==="Escape"){ e.preventDefault(); el.textContent=el.dataset.orig||""; el.blur(); } });
      el.addEventListener("blur",()=>{ const v=(el.textContent||"").replace(/[ \t]+/g," ").replace(/[ \t]*\n[ \t]*/g,"\n").trim(), orig=(el.dataset.orig||"").replace(/[ \t]+/g," ").replace(/[ \t]*\n[ \t]*/g,"\n").trim();   // item 12: keep \n (only collapse horizontal whitespace) so a line-break-only edit still commits
        if(v && v!==orig) commitSentText(i,v); else paintStext(el,i,dandaDisp(el.dataset.orig||"")); }); };   // unchanged (or emptied) → repaint in the RESTING state: the daṇḍa display (item 30) and the corrected spelling in place of the typo, no spurious re-parse. `v` is read from the element the FOCUS handler repainted in editing state, so what commitSentText receives is `# text` as the file spells it — the substitution has never been in this string
    const txt=document.createElement("div"); txt.className="stext";
    // A SCRIPT top line is undecorated by design: it is not `# text` at all but a DERIVED re-rendering
    // (in Sanskrit, the whole sentence fused by external sandhi — s.orthoLine), so no token owns a
    // stretch of it. The editable `# text` moves into the .strans-orig slot below, which goes through
    // wireStext → paintStext and IS decorated (bar the above-the-line correction mark — see app.css).
    if(scriptTop){   // top = the sentence re-rendered in the orthography (read-only)
      let line;
      // cslTop FIRST: s.orthoLine is the whole sentence scripted from `# text` (fillOrtho), which for a
      // Latin script is the text itself — it would win here and the CSL line would never be reached.
      // bform, not topTransTxt: under cslTop the CSL IS the glyph (see bform), so topTransTxt rightly
      // reports it as saying nothing the glyph does not and returns "" — which fell back to the plain
      // form and put the unmarked sentence back on the line. The running line is the glyphs joined,
      // exactly as it is for a Brahmic script; only the gap rule differs (marked junctions go apart).
      if(cslTop) line=runningLine(s,i,u=>bform(u.mwt||u.tok)," ");
      else if(isSanskritLang() && s.orthoLine){ line=s.orthoLine; }   // item 27(b): Sanskrit's running text is the WHOLE sentence fused by external sandhi then scripted (fillOrtho → s.orthoLine), not a naive per-word join
      /* Every other language joins its own tokens, and the WHITESPACE BETWEEN THEM IS `# text`'s, not
         something to invent. Preferred source: the alignment stextSpans already computes for the
         decoration pass — with a span per unit, the gap between two units is a literal slice of
         s.text, so a line break, a run of spaces and a SpaceAfter=No seam all come out right without
         any of them being reasoned about separately. THAT IS WHAT PUTS THE VERSE BACK ON FOUR LINES:
         `# text` carries real newlines (bridge.js restores them from the file's escaped "\n") and
         .stext is white-space:pre-wrap, so the break renders — but a join can only ever emit what it
         is told to, and it was told " ".
         Fallback, when the sentence has no spans (no bridge, or a text its tokens cannot be aligned
         to): MISC `SpaceAfter=No`, exactly as io_conllu rebuilds `# text`. A flat join(" ") put a
         space before every full stop in a script's running line where the file itself has none. The
         gap after an MWT is its LAST component's, the rule edit-ops.js's flattenMWT already states.
         `spaceAfterNo` lives in js/diagram/diagram-core.js, which loads BEFORE this file — and this is
         render-time code besides, so the classic-script forward-reference hazard does not apply. */
      else line=runningLine(s,i,u=>dispScheme((u.mwt?(u.mwt.ortho||u.mwt.form):(u.tok.ortho||u.tok.form))||"",ORTHO_SCHEME));
      txt.textContent=line||s.text||"(empty)";
      txt.title="Sentence in "+(cslTop?trSchemeLabel(TRANSLIT_SCHEME):orSchemeLabel(ORTHO_SCHEME))+" (display)";
      txt.classList.add("stext-script");   // item 20: the script top line's text left edge is aligned to the transliteration input below it (see .stext.stext-script CSS)
      if(typeof STACKING_SCRIPTS!=="undefined" && STACKING_SCRIPTS.has(ORTHO_SCHEME)) txt.classList.add("stext-stacked");   // item 18: Grantha's stacked vowel marks need extra vertical room → double-spaced (see .stext.stext-stacked CSS); Javanese and Balinese share the same stacked-diacritic problem, so they get the same treatment. Kawi joined too (added alongside its _AKSHARA_SCRIPTS reinstatement, briefly pulled and later restored — see js/lang/translit.js's own note on STACKING_SCRIPTS for why). Zanabazar Square joined the set on user report from the real app (a synthetic @font-face CDP test during its own reinstatement read as clean at normal spacing, but the shipping WKWebView face disagreed) — trust the live report over that synthetic result. Burmese joined and Tibetan left, on request (js/lang/translit.js's own note on STACKING_SCRIPTS) — Tibetan had itself rejoined the set once already, on an EARLIER live report of its own stacked/subjoined clusters wanting the room, so this isn't a return to the original "font swap alone is enough" reasoning that report overturned; it's a fresh instruction. ONLY the top script line; the editable translit/original below keeps normal spacing. STACKING_SCRIPTS lives in js/lang/translit.js (which loads before this file), so belowGap() (js/diagram/diagram-core.js) can give the diagram's own below-token spacing the same treatment without a second hardcoded list.
      txt.addEventListener("mousedown",e=>e.stopPropagation());
      /* ⚠ CSL EDITS IN PLACE, on the very line it is drawn on — the same contract a token has, where the
         CSL glyph opens a field carrying the FORM. `.stext` already does exactly this dance in the
         NON-script case: wireStext makes it contenteditable, paints a DISPLAY string at rest (the daṇḍa
         substitution, item 30) and repaints the raw `# text` on focus, so what you edit is the file's own
         string while what you read is the derived one. Wiring it here and then overwriting the resting
         paint with the CSL reuses that whole mechanism — commit, Enter/Escape, undo, the re-tokenise —
         instead of a second editing path beside it. The blur listener restores the CSL after an edit that
         did NOT commit (wireStext's own blur repaints dataset.orig, which is the raw text, not the CSL);
         a commit re-renders the block and recomputes the line anyway, so it needs no restoring. */
      /* WHERE THE FIELD OPENS, in one rule: exactly where the value being edited is already shown.
         `.strans-orig` is the editable `# text`; it is hidden whenever something else has taken the
         slot (Displayed "None", or CSL — see its own `hidden` assignment below). So:
           · row SHOWN  → the transliteration is on screen and the field belongs ON it. Clicking the
                          script line just puts the caret there; the row is contenteditable in place,
                          so nothing new is drawn and nothing appears BETWEEN the two lines.
           · row HIDDEN → there is no transliteration to overlay, so the script line becomes the field
                          itself — wireStext paints the derived line at rest and the raw `# text` on
                          focus, which is the same mechanism the CSL line already uses and the same
                          contract a token has (read the derived string, edit the underlying one).
         One predicate for both halves, so they cannot disagree about which row is live. */
      /* ⚠ `cslRow` does NOT belong in this test, and putting it here was the bug: a CSL row IS a
         transliteration on screen, so the field belongs on IT, not on the script line above it. The
         script line hosts the field only when NOTHING else is displayed to host it. */
      /* ⚠ NOT GATED ON SANSKRIT. The rule above is about which ROW is on screen, not about which language
         this is: a scripted language with a derived running line but no transliteration row (so the
         `.strans-orig` slot below is hidden) still needs somewhere to host the edit field, and the
         click-to-reveal affordance in the `else` branch is Sanskrit-only — assuming one of the two would
         always provide it is what left such a language with neither. Where a transliteration row IS
         shown it stays the host, in every language, because `show.translit` is what the test turns on. */
      const inPlace=cslTop||!show.translit;
      if(inPlace){ const resting=line||s.text||"(empty)";
        wireStext(txt); txt.textContent=resting;
        txt.addEventListener("blur",()=>{ txt.textContent=resting; });   // a COMMIT re-renders the block and recomputes the line; this is the cancelled/unchanged case, which wireStext would otherwise leave showing the raw text
        txt.style.cursor="text"; }
      // Sanskrit-only: Displayed transliteration "None" (trPick("")) collapses the .strans-orig edit line below
      // (see the scriptTransLine.hidden assignment further down) — the row the user asked to hide is also the
      // ONLY inline surface for editing `# text` in script mode (the script line itself is read-only, undecorated
      // re-rendering — the comment above this block). So clicking the visible script line re-reveals + focuses
      // it, the same "click the shown row to reach the value that isn't shown" affordance storedTrEditable's
      // callers already use for ambiguous stored transliterations (js/lang/translit-load.js editStoredTransInline).
      // Gated on the row being HIDDEN, not on the reason it is hidden. "None" was one reason; CSL is now
      // another (it takes the visible slot — see the scriptTransLine assignment below), and without this
      // the original text became uneditable inline for as long as CSL was displayed.
      else if(isSanskritLang()){ txt.style.cursor="text"; txt.title+=" — click to edit the transliteration";
        // …onto whichever row is HOSTING the field — the editable `# text` where it is shown, the CSL row
        // where that has taken its place. `fieldHost` is assigned as each is built, below.
        /* ⚠ ONLY WHEN THE ROW IS HIDDEN. This affordance exists because a collapsed row is the only inline
           surface for editing `# text` in script mode and there is otherwise no way to reach it — "click the
           shown row to get at the value that isn't shown". Once the row IS shown it can be clicked directly,
           and moving the caret out of the line under the pointer and into a different one is not what a click
           on a read-only display line asks for: it steals a click the reader may have meant as a plain
           deselect, and it does so precisely when the thing it would reveal is already in front of them. */
        txt.addEventListener("click",()=>{ const h=fieldHost||scriptTransLine; if(!h||!h.hidden) return;
          h.hidden=false; alignInlineStart(h,b); capTransWidth(h);
          h.focus(); }); } }
    else { wireStext(txt);
      /* Literary Chinese has no "script" to explicitly select — Han IS the stored/original text, so
         scriptTop (orthoScript()) is false here and this line is the ordinary editable `# text`, not a
         derived read-only script line. --script-mag is still 1.5 for it (scriptMag(), js/lang/translit.js
         — scoped to lzh specifically), but nothing reads that variable outside .stext.stext-script, whose
         OTHER rules (margin-inline-start:0, the ascent-lift compensation) are built for the Sanskrit
         read-only-line case this isn't. .stext-mag is the same font-size scaling alone, with none of that
         baggage. */
      if(typeof isLzhLang==="function" && isLzhLang()) txt.classList.add("stext-mag"); }
    const ctrl=document.createElement("div"); ctrl.className="sctrl";
    SCTRL(i).forEach(([g,ti,kbd,fn,d])=>{
      if(g==="url") return;   // item 16: the URL control renders separately, BEFORE the number (below)
      const extra="";   // item 8: Lucide vector glyphs share one 24-box → uniform size/stroke, no per-icon PNG nudges
      const btn=document.createElement("a"); btn.className="lnk"+(d?" del":"");   // block controls are links, not buttons
      btn.setAttribute("role","button"); btn.tabIndex=0; btn.innerHTML=`<span class="sfi${extra}" style="--m:var(--sf-${g})"></span>`; btn.title=accel(ti+(kbd?` (${kbd})`:""));   // accel() here, not the localiseAccel sweep: a block control's tooltip is rebuilt for every sentence on every render, and the sweep runs on subtrees that are built once (a no-op on macOS)
      btn.addEventListener("click",e=>{e.preventDefault(); fn();});
      btn.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fn(); } });
      ctrl.appendChild(btn);});
    // item 16 (corrected): the URL link control sits ABSOLUTELY in the left margin, to the LEFT of the number — so the
    // number keeps its original flow position (aligned with the diagram) and does not shift. Muted at rest, blue when set.
    const urlBtn=document.createElement("a"); urlBtn.className="url-ctl"+(s.url?" url-set":""); urlBtn.setAttribute("role","button"); urlBtn.tabIndex=0;
    urlBtn.innerHTML='<span class="sfi" style="--m:var(--sf-url)"></span>'; urlBtn.title=s.url?accel("URL: "+s.url+"  (⌘-click to open · click to edit)"):"Set a source URL for this sentence";   // accel() at the call site, not the localiseAccel sweep: this title is rebuilt on every render, and sweeping the whole document after each one to catch one tooltip would be absurd (a no-op on macOS)
    urlBtn.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation();
      if(cmdKey(e) && s.url){ openExternal(s.url); return; }   // item 8(c): ⌘-click (Ctrl-click on Windows) opens the source URL externally, through the same bridge-routed openExternal (js/io/bridge.js) as the guideline links — window.open is inert in a WKWebView; no URL set → fall through to the editor
      editURL(i,urlBtn); });
    urlBtn.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); editURL(i,urlBtn); } });
    head.appendChild(num); head.appendChild(txt); head.appendChild(urlBtn); head.appendChild(sid); head.appendChild(ctrl);   // item 6: number stays first (left margin); the URL link sits in flow just BEFORE the sentence ID
    head.addEventListener("contextmenu",e=>{ if(e.target===sid)return; e.preventDefault(); sentMenu(e.clientX,e.clientY,i); });
    /* A CLICK ON BARE BLOCK BACKGROUND MUST NOT PLACE A CARET IN AN EDITABLE THAT ISN'T UNDER IT.
       The reported symptom was that clicking well to the RIGHT of a translation field — out in the gutter under
       the block controls, where elementFromPoint returns this .sblock and nothing else — focused that field
       anyway. It is not the app doing it: a focus trace showed the focusin arriving with no programmatic
       .focus() in the stack. It is the engine's own caret placement, which for a click that lands on a
       non-editable block resolves to the CLOSEST EDITABLE POSITION rather than to nothing — and on the
       translation row's line the closest editable is the .tg-text to its left. Two things made it hard to
       corner: it needs the click to be the FIRST one on the block (once a caret exists elsewhere the engine
       resolves differently), and headless Chrome only reproduces it under exactly that condition, which is why
       two earlier attempts to fix this from inside .tg-text were built on a misreading and had to be reverted
       (see renderBlockTrans, js/io/bridge.js).
       preventDefault() on the MOUSEDOWN is what suppresses that caret placement — the click handler below runs
       too late, focus having already moved. But preventDefault alone would ALSO stop the click from moving focus
       AWAY, leaving a focused field focused when the user clicks off it; so the blur is done explicitly. Scoped
       to `e.target===b`, i.e. the block's own background and nothing inside it: every editable, control, token,
       grid cell and label is a descendant, so none of them is affected, and a click on them still behaves exactly
       as before. */
    b.addEventListener("mousedown",e=>{ if(e.target!==b) return;
      const ae=document.activeElement;
      if(ae&&ae!==document.body&&b.contains(ae)&&(ae.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(ae.tagName))) ae.blur();   // clicking off a field commits it — the field's own blur handler is what pushes its undo entry
      e.preventDefault(); });
    b.addEventListener("click",e=>{ if(e.target.closest(".sctrl")||e.target.closest("input")||e.target.closest("select")||e.target.closest(".gridbox")||e.target.closest(".sid-in"))return;   // .sid-in: a contenteditable span, not an <input> — its own mousedown/click stopPropagation already keeps events from reaching here (see buildBlock), but excluded here too for anything that reaches this handler by another path
      if(e.target.closest(".node,.tok-group,.arc,.edge-g,.oline,.brk,.bwtok,.bwbr,.mwt-form"))return;   // a token/bracket/MWT-tie handles its own selection
      /* SHIFT EXTENDS A SENTENCE RANGE instead of deselecting. It is checked before pick() because pick
         clears the range (an ordinary click starts a new selection, as it does in every list), and because
         a shift-click must not also deselect the token — the range is a selection OF SENTENCES and leaving
         the token selection alone is what lets ⌘⌫ tell the two apart. */
      if(e.shiftKey && typeof extendBlockRange==="function"){ e.preventDefault(); extendBlockRange(i); return; }
      pick(i,0,false); });   // clicked empty diagram space → deselect any node
    b.addEventListener("contextmenu",e=>{ if(e.target.closest(".gridbox")||e.target.closest(".sctrl")||e.target.closest("input")||e.target.closest("select")||e.target.closest(".sid-in"))return;   // grid/controls have their own menus; .sid-in gets the browser's own contenteditable context menu, same as an <input> would have
      if(e.target.closest(".lbl,.orel,.tok-pos,.node-cat,.opos,.node,.tok-group,.oline,.bwtok,.mwt-form,.mwt-tr"))return;   // labels + nodes handled at the doc level   /* .mwt-form/.mwt-tr joined the list: the delegated handler on #doc raises the MWT's own menu for both rows, but THIS listener is on the .sblock and therefore runs FIRST (bubbling reaches the block before the document), so without the exclusion every right-click on a multi-word token built the whole sentence menu and threw it away a moment later — and, while sentMenu was broken, threw a TypeError on the way */
      e.preventDefault(); sentMenu(e.clientX,e.clientY,i); });   // right-click anywhere else in the block → the block menu
    // (the boundary's own heading was built and appended to its section ABOVE this block — see the sectioning
    //  note at the top of this loop. It used to be an absolutely-positioned child of the block; a sticky box
    //  cannot be out of flow, and a heading that lives inside one sentence cannot outlast it.)
    /* the boundary heading(s) FIRST, in flow at the top of the block they open — so they open their own space and
       the block needs no padding rule to make room (see .bmarks in app.css). One box holds both ranks so a document
       heading and a paragraph heading stack in the order they were pushed. */
    if(heads.length){ const box=document.createElement("div"); box.className="bmarks";
      heads.forEach(hd=>box.appendChild(hd)); b.appendChild(box); }
    b.appendChild(head);
    if(scriptTop){   // item 3: translit slot carries the EDITABLE original # text (the top line now holds the script)
      /* ⚠ THE SLOT HOLDS THE EDITABLE ORIGINAL, NOT A TRANSLITERATION, and that is why CSL appeared to do
         nothing under a script: there is no transliteration row on this branch for it to fill. Worse, with
         "Latin" as the script the top line IS a romanisation, so an IAST-stored sentence had the
         very same string twice — the derived line above and its own `# text` below.
         A scheme that RESPELLS the sentence therefore gets a row of its own here (`cslRow`), and the
         editable original goes back to being collapsed-and-click-revealable, which is what it is for. */
      const tl=document.createElement("div"); tl.className="strans strans-orig"; tl.style.marginInlineStart=(idW+8)+"px"; wireStext(tl);
      // Collapsed whenever the visible line above is NOT this row's own value: Displayed "None"
      // (nothing to show), CSL-in-a-row under a real script, and CSL-as-the-line under a Latin one.
      // In that last case the sentence on screen IS the CSL, so a permanently open row beneath it
      // would be the same sentence twice — the editable original belongs one click away, which is
      // exactly what the .stext handler above provides (and what it opens is the IAST `# text`).
      tl.hidden=!show.translit||cslRow||cslTop;
      tl.setAttribute("data-capw","1"); if(!tl.hidden) applyTransInset(tl);   // swept with the translations grid, synchronously, so the height the caps measure is the height that is drawn   // a hidden row is unmeasurable (0-width rect) — the reveal handler re-runs this itself once it's shown
      tl.addEventListener("blur",()=>{ if(!show.translit||cslRow||cslTop) tl.hidden=true; });   // …and re-collapses on blur, still gated on Displayed:"None" — if the user changed the Displayed scheme away from None WHILE this row was open, show.translit is now true and the row stays, exactly as a fresh render would leave it
      scriptTransLine=tl; if(!tl.hidden) fieldHost=tl; b.appendChild(tl);
      if(cslRow){ const cl=document.createElement("div"); cl.className="strans"; cl.style.marginInlineStart=(idW+8)+"px";
        const cslResting=runningLine(s,i,u=>u.mwt?(topTransTxt(u.mwt)||u.mwt.form):(topTransTxt(u.tok)||u.tok.form)," ");
        /* THE CSL ROW IS THE FIELD when it is the transliteration on screen — same contract as everywhere
           else: it reads as CSL and edits the raw `# text` beneath it. Without this the row was inert and
           the field fell back to the script line above, which is what the report was about. */
        wireStext(cl); cl.textContent=cslResting;
        cl.addEventListener("blur",()=>{ cl.textContent=cslResting; });   // a commit re-renders and recomputes; this is the cancelled case
        cl.title="Sentence in "+trSchemeLabel(TRANSLIT_SCHEME)+" (display) — click to edit the text";
        cl.style.cursor="text"; fieldHost=cl;
        capTransWidth(cl); b.appendChild(cl); } }
    else if(trLayer()){   // romanisation OR a Latin-output orthography → a plain whole-sentence line under the text (no displacement)
      /* NO ROW WHERE IT WOULD ONLY REPEAT THE LINE ABOVE IT — an IAST romanisation of an IAST-stored
         Sanskrit file says nothing the running text has not already said, and neither does "Original"
         over a Latin original. That was always the intent of the `line!==base` test; it could not work
         while the two strings were built by different rules, because a join(" ") of the very same words
         differs from `# text` at every full stop and every line break of a verse. Built the same way,
         an unchanged romanisation now compares EQUAL and the row is correctly dropped — while CSL, which
         genuinely respells the sentence (`vartm'âpunarjanmanām`), still differs and still shows. */
      const csl=isSanskritLang()&&TRANSLIT_SCHEME==="csl";
      /* A SPACELESS SCRIPT'S ROMANISATION HAS TO BE SPACED, and the line above it cannot say where. The gaps
         are otherwise taken verbatim from `# text`, which is right for every language that writes word
         breaks — the romanisation then lines up with the sentence above it, break for break — but Chinese,
         Japanese, Thai and the rest have no gaps to inherit, so the pinyin ran together into one unreadable
         string (`yǐnyán` + `wǒ` + … with nothing between them). The SpaceAfter fallback could not have saved
         it either: in those languages nearly every token carries SpaceAfter=No, which is true of the source
         and says nothing about its romanisation.
         isSpacelessLang (js/core/state.js) is a LANGUAGE test, not the per-run character test app/parse.py
         uses, and that is the right one here: this is a document-wide display convention, not a judgement
         about one stretch of text. */
      const spaceless=(typeof isSpacelessLang==="function")&&isSpacelessLang();
      /* …and the separator is decided by BOTH sides, because punctuation takes its space on one side only and
         which side depends on the mark: a comma or a closing bracket hugs the word BEFORE it, an opening
         bracket or quote hugs the word AFTER it. Keying on the following piece alone put the space on the
         wrong side of every opening mark (`túlíng« AI Agent»` for `túlíng «AI Agent»`). Ps/Pi are the opening
         and initial-quote categories, Pe/Pf their closing partners — so an opening mark is the one kind of
         punctuation that still takes a space in front of it. */
      const gap = csl ? " " : (spaceless ? ((next,prev)=>
        /[\p{Ps}\p{Pi}]$/u.test(prev||"") ? ""                                   // just opened a bracket/quote → the next word hugs it
        : (/^[\p{P}\p{S}]/u.test(next||"") && !/^[\p{Ps}\p{Pi}]/u.test(next||"")) ? ""   // a closing or ordinary mark hugs the word before it
        : " ") : null);
      const line=runningLine(s,i,u=>u.mwt?(topTransTxt(u.mwt)||u.mwt.form):(topTransTxt(u.tok)||u.tok.form), gap);
      const base=(s.text||s.tokens.map(t=>t.form).join(" "));
      if(line.trim() && line.trim()!==base.trim()){ const tl=document.createElement("div"); tl.className="strans"; tl.style.marginInlineStart=(idW+8)+"px"; tl.textContent=line; capTransWidth(tl); b.appendChild(tl); } }
    if(TRANS_LANGS.size) b.appendChild(renderBlockTrans(i));   // item 13: a field per enabled translation language, just above the diagram
    if(show.graphs) b.appendChild(diaSentence(i,ctx));   // notation-switch cache: same node reused (and re-highlighted by applySel below) if THIS sentence, under THIS conv + view-state, was already built — see the "NOTATION-SWITCH DIAGRAM CACHE" note above computeWindow
    if(show.grids) b.appendChild(renderGrid(i));
    ctx.sheet.appendChild(b);
  return b; }

/* ── HOLDING THE RE-RENDER FOR THE DURATION OF A BATCH OPERATION ──────────────────────────────────────────────
   renderDoc() rebuilds the whole windowed view, and on a large document that is not cheap: MEASURED at ~250 ms
   on a 2,000-sentence / 24,000-token file. doInsert renders once per sentence, so pasting 80 sentences into that
   document called it 80 times and took 44 SECONDS — the other half of "insert a lot of text and the app slows to
   a crawl" (the first half being the undo stack; see UNDO_BUDGET in js/core/undo.js). Nothing in that loop needs
   the intermediate DOM: each iteration writes to DOC and the next reads DOC, never the page.
   So a batch holds rendering, and every renderDoc() inside it just RECORDS that one is owed; endRenderHold()
   performs exactly one at the end. A DEPTH COUNTER, like the undo batch it is opened beside, so nesting is safe;
   and the pending flag is checked on the way out so an operation that never asked for a render doesn't get one.
   Callers MUST use try/finally — a throw between begin and end would otherwise leave rendering held for the rest
   of the session, i.e. a frozen-looking app. */
let RENDER_HOLD=0, RENDER_PENDING=false;
function beginRenderHold(){ RENDER_HOLD++; }
function endRenderHold(){ if(RENDER_HOLD>0) RENDER_HOLD--;
  if(RENDER_HOLD===0&&RENDER_PENDING){ RENDER_PENDING=false; renderDoc(); } }
function renderDoc(){
  if(RENDER_HOLD>0){ RENDER_PENDING=true; return; }   // batched — see the note above
  if(typeof refreshFontStacks==="function") refreshFontStacks();   // diagram-core.js: re-reads #doc's LIVE --token-font/--mono-font (a scheme-scoped override, e.g. Ranjana, may have changed it since the last render) into LIVE_TOKEN_STACK/LIVE_MONO_STACK and every measurement font string derived from them (WORD_F, GLOSS_F, …), ONCE per render rather than per meas() call. Must run before computeColW() (→ marginNumWidth) and before anything below that measures token width, or this render would still lay out against the PREVIOUS scheme's metrics. Guarded (as document.js already guards TOKEN_STACK-dependent reads elsewhere) for any harness that renders before diagram-core.js has loaded
  if(typeof _avmCache!=="undefined") _avmCache.clear();   // item 22: avmLayout's cache is keyed on the FEATS string alone, which stays correct across a FEATS edit for free (a new string ⇒ a new key) but NOT across a zoom/CSS change that alters the AVM box's measured size without touching any token's FEATS — cheapest correct fix is dropping it once per render, the same moment refreshFontStacks above re-reads live metrics for the same reason
  msegFlagDoc();   // what an MWT grouping implies about its members — the MSeg tier's decorative continuation mark, and in Sanskrit a featureless non-final member's Compound=Yes. A dozen scattered operations move those ranges (grouping, ungrouping, splitting, flattening, inserting/deleting a token, an auto-regroup after a parse), so deriving it HERE, once, at the single point they all funnel through, is what keeps it from ever going stale; it's idempotent and cheap, and marks nothing dirty of its own accord — see msegFlagSent
  computeWindow(curBlock());   // recentre the rendered window on whatever sentence the reader is on — see the virtualization note above buildBlock. MUST run before computeColW(): that scans the CURRENT window (js/grid/grid.js), so the window has to be known first
  pruneDiaCache(winLo,winHi);   // drop every cached diagram outside the range this render is about to (re)build — see the "NOTATION-SWITCH DIAGRAM CACHE" note above buildBlock. AFTER computeWindow (winLo/winHi just moved), BEFORE the buildBlock loop below reads the cache
  computeColW();
  const host=document.getElementById("doc"); host.textContent="";
  if(DOC.length) clearBootSkeleton();   // …and the boot skeleton goes the moment there is a real block to put in its place (index.html; a no-op once it has)
  host.lang=bcp47Tag();   // BCP-47 tag → inherits to every token/diagram/grid text so the browser picks locale-correct Cyrillic/Han glyphs (locl + system-font region); re-run on every language/script change
  host.classList.toggle("ortho-script", TRANSLIT_SCHEME==="zhuyin");   // a non-Latin DISPLAYED transliteration (Zhuyin) in the row → drop the romanisation italics
  host.classList.toggle("script-form", typeof iastFormEdit==="function"&&iastFormEdit());   // Sanskrit under a real script → every token FORM on screen is a derived rendering of the stored IAST, not an editable field, so it takes the pointing hand (app.css). The MWT/goeswith glyphs set the same cursor inline via formCursor(), being SVG text with their own click contract
  host.classList.toggle("no-relcolour", !show.colour);   // "Relation colours" off → --tie-hue swaps --c-other for --ink, so POS tags/bracket ties go monochrome too, not just the deprel labels relColor() already gates
  /* Item 3 — PAGED LAYOUT. In paged mode the blocks are grouped into .docsheet containers and a `# newdoc` ENDS one
     and starts the next, which is what makes a document boundary read as a document boundary rather than as a
     slightly bigger gap. Unpaged, `host` IS the container and every block is appended straight to it, exactly as
     before. Nothing downstream had to change: every later pass selects `#doc .sblock` (a descendant selector), so
     the extra level of nesting is invisible to the alignment/cap/selection passes below.
     The first sheet is created HERE, above AVAILW, and not lazily in the loop — see item 9 immediately below. */
  let sheet=host;
  const newSheet=()=>{ if(!PAGED) return host; const d=document.createElement("div"); d.className="docsheet"; host.appendChild(d); return d; };
  if(PAGED) sheet=newSheet();
  /* Item: BOUNDARY SECTIONS. A `# newdoc`/`# newpar` heading is sticky (see .bmark in app.css), and a sticky box
     pins only for as long as its CONTAINING BLOCK is on screen — so the run of sentences a heading dominates has
     to be a real element, not merely an interval the renderer knows about. `docSec`/`parSec` are the two open
     sections: a document boundary closes both and opens a document section, a paragraph boundary closes and
     reopens the paragraph section INSIDE whichever document section is current (or in the sheet, for a file
     whose paragraphs precede its first `# newdoc`), and every block is appended to the innermost open one. That
     IS the dominance rule the headings need — a document heading reaches to the next document, a paragraph
     heading to the next paragraph or document, whichever comes first.
     Nothing downstream had to change, for the same reason paged mode's sheets cost nothing: every later pass
     selects `#doc .sblock`, a DESCENDANT selector. */
  const NUM=boundNumbers(), SNUM=sentNumbers();   // recomputed here, every render — see boundNumbers on why nothing is stored
  // Item 9: the width a diagram row may use is the width of the box it will actually be laid out in — the SHEET in
  // paged view, `#doc` unpaged. Measuring `#doc` in both left every diagram sized to the full window: at 1500px it
  // decided a row fitted unwrapped when the 900px sheet had no room for it, and a wrapped row broke at the wrong
  // column. An EMPTY sheet measures correctly (its width comes from max-width + auto margins, not its content), and
  // renderDoc re-runs on every paged/unpaged switch (setPageMode → preserveScroll(renderDoc)), so the two modes
  // can never disagree about it.
  AVAILW=Math.max(240, sheet.clientWidth-52);
  // Item 1: the cap must equal the VISIBLE viewport height for content — from just below the options bar (or the
  // titlebar when the options bar is hidden) down to just above the status bar. Only the TOP is occluded: the doc
  // scrolls UNDER the overlaid titlebar + options bar, which the doc's top padding (--tbH + --vbH) exactly clears.
  // The status bar is NOT overlaid — it is an in-flow sibling BELOW the doc, so the doc's border-box bottom already
  // coincides with the status-bar top (host.clientHeight already stops there). The doc's 44px bottom padding is only
  // trailing scroll room, NOT an occluded band, so it must NOT be subtracted — doing so left the cap 44px too short
  // (dead space below a tall block). Subtract ONLY the top inset: dh = clientHeight − paddingTop = the exact gap from
  // the options-bar bottom to the status-bar top (= innerHeight − titlebarH − (options bar shown? optionsBarH : 0) −
  // statusbarH). Recomputed every render, so showing/hiding the options bar (which changes --vbH → this top padding,
  // and re-renders) re-tightens the cap.
  const hcs=getComputedStyle(host), padTop=parseFloat(hcs.paddingTop||0);
  const dh=Math.max(160, host.clientHeight-padTop), rs=document.documentElement.style; AVAILH=dh;   // caps are relative to the app's VISIBLE document viewport (options-bar bottom → status-bar top), not the browser and not the occluded top padding
  // #doc isn't zoomed, so dh is REAL px; but .diagram/.gwrap live inside .sblock{zoom:var(--fs)}, which multiplies any max-height by FS. Divide the cap by FS so the VISUAL cap stays a fixed fraction of the viewport at every zoom level (recomputed here on every render → refreshed on each zoom, since setFS re-runs renderDoc). At FS=1 this is a no-op.
  rs.setProperty("--cap-dia",Math.round(dh*0.6/FS)+"px"); rs.setProperty("--cap-grid",Math.round(dh*0.4/FS)+"px");   // the :root pair is the FALLBACK only: it reserves 60/40 of the bare viewport, i.e. of a block with no chrome at all. Each block overrides both with its own share of what is left after its padding + heading + sentence + transliteration + translation rows — see the per-block pass just after the buildBlock loop below.
  /* the --bm-stick engine probe was published here; the headings do not pin any more, so there is no inset to measure or hand to CSS. stickyTopFactor() survives below, unused but documented — it records what each engine counts into a sticky view rectangle, which is not obvious and was expensive to establish. */

  const ctx={sheet,NUM,SNUM,newSheet,diaSig:diaFlagsSig()};   // diaSig computed ONCE per render (not per sentence — every sentence in this render shares the same view-state) and read back by diaSentence() below
  // top spacer FIRST — stands in for [0,winLo), sized below once the window's real blocks have been measured.
  // Inserted ONLY when there's something above the window to stand in for (winLo>0): app.css's
  // `.doc.paged > .docsheet:first-child{margin-top:14px}` (the gap that keeps the very first sheet's rounded
  // corner clear of the toolbar) depends on the first REAL sheet actually being #doc's first child — an
  // unconditional spacer here would sit in front of it and silently break that rule at the true top of the
  // document, which is the one state (winLo===0) where the rule's effect is visible at all.
  const topSpacer=document.createElement("div"); topSpacer.className="winspacer winspacer-before"; topSpacer.setAttribute("aria-hidden","true");
  if(winLo>0) host.insertBefore(topSpacer,host.firstChild);
  for(let i=winLo;i<winHi;i++) buildBlock(i,ctx);   // ONLY the windowed range — see the virtualization note above buildBlock
  /* THE ROW WIDTHS MUST BE FINAL BEFORE ANY HEIGHT IS MEASURED, and this is the first point at which every
     block is in the DOM. The translations grid and the script-mode transliteration line are each pulled in to
     the sentence text's right edge, and narrowing a row REWRAPS it — so its height is not knowable until that
     inset has been applied. It used to be applied a frame LATER, which handed both height-cap passes below a
     translations grid measured at its full pre-inset width (measured on a two-language block: 158px tall at
     1115px wide, 194px once inset to 821px) and so over-granted the diagram and grid by the difference, letting
     the block overrun the viewport it was supposed to fit. One sweep here serves both passes. */
  applyTransInsets();
  const _rendered=host.querySelectorAll(".sblock");
  /* ── THE 60/40 RESERVATION IS OF WHAT THE DIAGRAM AND GRID CAN ACTUALLY HAVE, PER BLOCK ────────────────────
     --cap-dia / --cap-grid were 60 % and 40 % of `dh` — the whole document viewport — which over-reserves by
     everything that stands BETWEEN the two: the block's own vertical padding and border, the boundary heading,
     the running sentence, the script/transliteration rows and the translations grid. A block with three
     translation languages therefore declared a diagram cap it could not honour, and the reservation only came
     right when the authoritative per-block pass further down (search "per-block height caps") replaced these
     caps with measured inline max-heights. Everything measured in BETWEEN those two points — AVG_BLOCK_H
     immediately below, and with it both virtualization spacers — saw the over-large caps.
     So subtract the chrome here, per block, because it differs from sentence to sentence: the CSS vars are
     inline on the .sblock, which beats the :root pair for that block with no change to app.css at all (.diagram,
     .text-conv and .gwrap already read var(--cap-dia)/var(--cap-grid)). The :root pair stays as the fallback for
     anything outside a block, and for the instant before this pass runs.
     ONE ITERATION IS ENOUGH, and that is not an approximation: none of the chrome rows' heights depends on
     --cap-dia/--cap-grid — they are text rows above the two scrollers, sized by their own content — so writing
     the caps cannot change the chrome that was just measured, and there is no fixed point to iterate toward.
     (The heights are read BEFORE stxWrapRoom/alignInlineStart have run, so a wrapped running sentence can still
     grow by a line afterwards. That is why this is a BUDGET and the later pass is the authority: erring here
     costs a few px of cap on the blocks that wrap, never a wrong final layout.)
     .diagram.wrapproj is untouched by construction: its `max-height:none` (app.css) outranks .diagram's
     var(--cap-dia) whatever this writes, and its height is driven explicitly at layout time. */
  /* READ EVERYTHING, THEN WRITE EVERYTHING. The budget below reads computed styles and offsetHeights
     for every block and each of its children, and used to write --cap-dia/--cap-grid at the end of
     each block's own turn — which dirties style and layout for the NEXT block's reads, so the browser
     recalculated once per block instead of once for the pass. Same arithmetic, same values, in two
     phases: the profile put this pass (document.js:1506 + its `outer` helper) at ~360ms of a ~750ms
     script budget after the measurement cache landed. */
  const _budget=[];
  _rendered.forEach(b=>{
    const bcs=getComputedStyle(b);
    let chrome=parseFloat(bcs.paddingTop||0)+parseFloat(bcs.paddingBottom||0)+parseFloat(bcs.borderTopWidth||0)+parseFloat(bcs.borderBottomWidth||0);
    const outer=el=>{ const cs=getComputedStyle(el);
      if(cs.position==="absolute"||cs.position==="fixed") return 0;   // out of flow → opens no space (the grid's .gtiebleed bracket window is the one that matters here)
      return el.offsetHeight+parseFloat(cs.marginTop||0)+parseFloat(cs.marginBottom||0); };   // margins count: they are space the row opens, exactly as the later pass's bmH/tgH charge them
    for(const ch of b.children){
      if(ch.classList.contains("diagram")||ch.classList.contains("text-conv")) continue;   // the diagram scroller — one of the two boxes being capped, so never its own chrome
      if(ch.classList.contains("gridbox")){   // renderGrid returns a .gridbox = [.gwrap, .gtiebleed, button.addtok]; only .gwrap is capped, its siblings are chrome
        const gcs=getComputedStyle(ch); chrome+=parseFloat(gcs.marginTop||0)+parseFloat(gcs.marginBottom||0);
        for(const gk of ch.children) chrome+=gk.classList.contains("gwrap")
          ? parseFloat(getComputedStyle(gk).marginTop||0)+parseFloat(getComputedStyle(gk).marginBottom||0)   // the capped box's own margins ARE chrome — max-height bounds the border box, not the margin box
          : outer(gk);
        continue; }
      chrome+=outer(ch); }
    // dh is REAL px and the chrome above was measured INSIDE .sblock{zoom:var(--fs)}, i.e. in LOCAL px — so bring
    // the viewport into local px FIRST (dh/FS) and subtract there, rather than dividing the finished cap by FS.
    // The 140px floor is the same one the authoritative pass below uses, so a block whose chrome alone overflows
    // the viewport still leaves both scrollers a usable minimum instead of collapsing them.
    const avail=Math.max(140, dh/FS-chrome);
    _budget.push([b,avail]); });
  _budget.forEach(([b,avail])=>{   // …the writes, now that every read is done
    b.style.setProperty("--cap-dia",Math.round(avail*0.6)+"px");
    b.style.setProperty("--cap-grid",Math.round(avail*0.4)+"px"); });
  if(_rendered.length){ let _h=0; _rendered.forEach(b=>_h+=b.getBoundingClientRect().height); AVG_BLOCK_H=_h/_rendered.length; }   // remeasure every render — blocks vary a lot in height (a 3-token sentence vs. a wrapped Sanskrit verse with translations), so this is only ever an estimate (see the virtualization note above)
  topSpacer.style.height=Math.round(winLo*AVG_BLOCK_H)+"px";
  if(winHi===DOC.length){   // the window reaches the true end of the document → the reader can actually add a sentence after the last one
    const addWrap=document.createElement("div"); addWrap.className="addsent";
    const addBtn=document.createElement("button"); addBtn.innerHTML='<span class="sfi" style="--m:var(--sf-add)"></span>Add sentence'; addBtn.onclick=()=>insertAt(DOC.length);
    addWrap.appendChild(addBtn); ctx.sheet.appendChild(addWrap);   // inside the LAST sheet (ctx.sheet, not the outer `sheet` — buildBlock may have reassigned it mid-loop on a `# newdoc`), so the button keeps the measure rather than straying into the page margin — and NOT inside a boundary section, which would hang the button off the last paragraph rather than off the page
  }
  // bottom spacer — stands in for [winHi,DOC.length); a plain sibling of the sheets (not appended inside the
  // last one), so it never has to reproduce a partial sheet's page-margin chrome for content that isn't rendered
  const bottomSpacer=document.createElement("div"); bottomSpacer.className="winspacer winspacer-after"; bottomSpacer.setAttribute("aria-hidden","true");
  bottomSpacer.style.height=Math.round((DOC.length-winHi)*AVG_BLOCK_H)+"px";
  host.appendChild(bottomSpacer);
  // …and the one block per sheet whose bottom hairline the sheet's own edge replaces. Marked here rather than
  // matched in CSS because a block now sits inside its boundary SECTION: `.docsheet > .sblock:last-child` no
  // longer names anything, and the obvious rewrite (`.sblock:last-child`) would fire on the last block of every
  // nested section too. Reproduces the old selector exactly, trailing "Add sentence" sheet included.
  if(PAGED) host.querySelectorAll(":scope > .docsheet").forEach(sh=>{
    if(sh.lastElementChild&&sh.lastElementChild.classList.contains("addsent")) return;   // the button is the sheet's own bottom edge there, exactly as `:last-child` used to decide
    const bs=sh.querySelectorAll(".sblock"); if(bs.length) bs[bs.length-1].classList.add("lastblock"); });
  applySel(); validateAll();
  /* item 4: how many documents and paragraphs the file holds, each shown only if it MARKS any. A `# newdoc` opens
     a document, so n marks = n documents when the first sentence carries one, and n+1 when it does not — the
     sentences before the first mark are a document too, an unnamed one, and leaving them out would report a count
     that does not add up against the sentence count beside it. The same reasoning for paragraphs. With no marks at
     all the pill is hidden rather than showing "1": that 1 is a definition, not a measurement. */
  const _nd=DOC.reduce((a,s)=>a+(hasNewdoc(s)?1:0),0), _np=DOC.reduce((a,s)=>a+(hasNewpar(s)?1:0),0);
  [["docCount",_nd,hasNewdoc,"document"],["parCount",_np,hasNewpar,"paragraph"]].forEach(([id,n,has,word])=>{
    const pill=document.getElementById(id+"Pill"); if(!pill) return;
    const total=n?(n+((DOC.length&&has(DOC[0]))?0:1)):0;   // a leading run before the first mark is one more of them
    pill.hidden=!n;
    if(n){ document.getElementById(id).textContent=total;
      document.getElementById(id+"Lbl").textContent=word+(total===1?"":"s"); } });
  document.getElementById("sentCount").textContent=DOC.length;
  document.getElementById("tokCount").textContent=DOC.reduce((a,s)=>a+s.tokens.length,0);
  if(typeof FIND!=="undefined"&&FIND.open) highlightFind();   // re-apply find highlighting after a re-render
  /* ── THE BLOCK'S TEXT ROWS ARE ALIGNED TO THE FORM FIELD'S TEXT, NOT TO ITS BOX ───────────────────────────────
     The running sentence, the transliteration / editable original, the translations grid and the boundary
     headings' ids all belong to ONE column, and the column the block is built around is the one the diagram is
     already aligned to below: the x at which the grid's Form INPUT starts drawing its text. Those rows used to be
     placed from `idW + 8` — which lines up their BOX with the Form cell's box and therefore leaves their text
     short of the field's by the input's own border + padding, and by whatever slack `table-layout:fixed` has
     handed the ID column on top (see formTextTarget). MEASURED here, per block, so the alignment holds at every
     window width, at every zoom, and after a column drag.
     BEFORE the height caps and before stxWrapRoom, deliberately: a row's inline-start margin changes how wide it
     is and therefore how it wraps, and both of those measure the header AFTER it has settled. */
  document.querySelectorAll("#doc .sblock").forEach(b=>{
    alignInlineStart(b.querySelector(".shead > .stext"),b);   // the running sentence (or, under a SCRIPT orthography, the read-only script line — .stext-script starts at a different margin and the measured correction absorbs the difference)
    b.querySelectorAll(".strans:not([hidden])").forEach(el=>alignInlineStart(el,b));   // the transliteration row, and the editable `# text` that moves into its slot — a hidden (collapsed) .strans-orig has a 0-width rect and gets re-aligned itself when the script line's click handler reveals it
    alignInlineStart(b.querySelector(".tgrid"),b); });                   // the translations grid — its language-name column is what starts on the sentence's own text edge (see .tgrid in app.css)
  // …and each sticky heading's id, on the same column as the sentence of the first block it dominates. Separate
  // …and the boundary ids, onto the same column. The heading is back INSIDE the block it opens, so the block is
  // simply its nearest .sblock ancestor. This lookup still walked from the heading to a .bsec SECTION and took
  // that section's first .sblock — which returns null now that no section exists, so the pass silently stopped
  // running and the ids sat at the .bmrow's default 8px gap instead of on the running sentence's text edge.
  document.querySelectorAll("#doc .bmark").forEach(bm=>{ const b=bm.closest(".sblock"); if(!b) return;
    alignInlineStart(bm.querySelector(".bm-id"),b); });
  // (--bm-docH was published on each document section here — the measured height of its own heading, so the
  // paragraph headings nested inside could pin BELOW it rather than under it. The headings do not pin any more,
  // so two of them simply stack in flow and no measurement is needed to make that happen.)
  /* align each diagram / outline so its leftmost drawn content sits under the text of the Form column
     (measured, so it's exact regardless of each renderer's internal offset) */
  /* THREE PHASES, NOT ONE PER BLOCK. This zeroes a diagram's padding, measures where its leftmost ink
     lands, and writes the padding that pulls it under the Form column — and doing all three per block
     meant every block's measurement flushed layout for the write the previous block had just made.
     Measured by wrapping the layout-flushing DOM APIs: this line alone made 2,223 getBoundingClientRect
     calls in one load, the largest single source in the app, and the Safari timeline for the same load
     showed 4,657 forced layouts totalling 3.9 s. Split, the whole document costs ONE flush: every write
     happens, then every read, then every write. The emphasis dance below is unchanged in meaning (the
     comment it carries still applies) — it just runs across all blocks at once, which is safe for the
     same reason it was safe per block: nothing paints in between. */
  const _align=[];
  document.querySelectorAll("#doc .sblock").forEach(b=>{ const dg=b.querySelector(".diagram, .text-conv"); if(!dg) return;
    dg.style.paddingLeft="0px"; dg.style.paddingRight="0px";   // getBoundingClientRect is in scaled (zoomed) viewport px; padding is set in unscaled CSS px → divide by FS
    const rtl=b.dir==="rtl", els=[...dg.querySelectorAll("svg text, .oline, .bwline2")];
    // What this padding measures must NOT depend on WHICH TOKEN IS SELECTED. A selected token renders its form,
    // its deprel label and its brackets BOLD, so its ink runs a fraction wider and a fraction further out — enough
    // to move minLeft/maxR across a rounding step and change this padding by a pixel or two. Since the padding is
    // only recomputed on a FULL render (a selection alone just toggles the .sel classes), the diagram then lurched
    // sideways at the next render, reading as a shift one selection late. So measure with the selection emphasis
    // off and put it straight back: same synchronous pass, nothing paints in between, and the alignment now
    // depends only on the layout itself. (.sel/.rng are the only classes that change a weight — .inspan tints the
    // casing colour and nothing else. Scoped to `dg`, so the grid's own row classes are untouched.)
    const emph=[...dg.querySelectorAll(".sel,.rng")].map(e=>({e,s:e.classList.contains("sel"),r:e.classList.contains("rng")}));
    emph.forEach(({e})=>e.classList.remove("sel","rng"));
    _align.push({b,dg,rtl,els,emph,prop:null,val:null}); });
  _align.forEach(a=>{   // …every read, with the writes above already flushed exactly once
    const target=formTextTarget(a.b,a.rtl);   // the SAME target the text rows above are aligned to — one measurement, two consumers, so the sentence and its diagram can never disagree about where the column starts (this was written out twice, once here per direction; the fallback for a hidden grid is the same too)
    if(a.rtl){   // align the rightmost drawn content under the Form column's start (right) edge
      let maxR=-Infinity; a.els.forEach(el=>{const r=el.getBoundingClientRect().right; if(r>maxR)maxR=r;});
      if(maxR>-Infinity){ a.prop="paddingRight"; a.val=Math.max(0,Math.round((maxR-target)/FS))+"px"; }
    } else {
      let minLeft=Infinity; a.els.forEach(el=>{const l=el.getBoundingClientRect().left; if(l<minLeft)minLeft=l;});
      if(minLeft<Infinity){ a.prop="paddingLeft"; a.val=Math.max(0,Math.round((target-minLeft)/FS))+"px"; } } });
  _align.forEach(a=>{
    a.emph.forEach(({e,s,r})=>{ if(s)e.classList.add("sel"); if(r)e.classList.add("rng"); });   // emphasis back on before anything can paint
    if(a.prop) a.dg.style[a.prop]=a.val; });
  // Item 6 (safety net): the wrapproj token strip is HARD-clipped at the diagram's right edge, and the alignment above
  // shifts it right by the Form-column indent. projWrapped already bounds the strip width to the clip-safe port, but if
  // an unusually wide indent (a long ID column, RTL, or a very wide row-edge token) would still push the strip past the
  // clip box, pull the padding back just enough to keep every token in view. This only ever REDUCES the padding (never
  // increases it), so ordinary alignment is untouched — it engages solely when a token would otherwise clip.
  document.querySelectorAll("#doc .diagram.wrapproj").forEach(dg=>{ const toks=dg.querySelector(".wp-toks"); if(!toks) return;
    const avail=dg.clientWidth, sw=toks.offsetWidth;   // both in STRIP (unzoomed) px; the child strip clips if padding + sw exceeds the padding box (clientWidth)
    if(dg.dir==="rtl"){ const pr=parseFloat(dg.style.paddingRight)||0; if(pr+sw>avail) dg.style.paddingRight=Math.max(0,avail-sw)+"px"; }
    else { const pl=parseFloat(dg.style.paddingLeft)||0; if(pl+sw>avail) dg.style.paddingLeft=Math.max(0,avail-sw)+"px"; } });
  // grow wrapped-brackets inter-line room (tall within-line interrupter arcs/labels + arc-occupied gaps) BEFORE the
  // height cap below, so a tall wrapped-brackets box is measured at its FULL natural height (diaNat) and gets the
  // same vertical-expansion / scroll budget the other notations get — otherwise the cap is set to the un-grown
  // height and the later-grown content is clipped. (Item 4) The wash/annots overlays are absolute → measured later.
  reserveBracketArcRoom();
  stxWrapRoom();   // running-sentence above-the-line marks: give the room to the WRAPPED lines that need it (see stxWrapRoom). Here rather than in paintStext because the blocks are still detached while that runs — and BEFORE the per-block height caps below, so the extra leading is inside the header height they measure
  // per-block height caps: the block ≤ 100% of the document viewport; the diagram gets 60% and the grid 40% of
  // what remains after the sentence header, block padding, AND the gaps around/between the diagram and grid
  document.querySelectorAll("#doc .sblock").forEach(b=>{ capBlock(b,dh); observeBlockHeader(b); });
  document.querySelectorAll("#doc .diagram.wrapproj").forEach(wpDraw);   // draw the tree (+ projections) now the box has its final size
  positionBracketWash();
  positionBracketAnnots();
  positionSeamMarks();      // slide every "belongs to neither token" seam mark to the middle of its gap, now that the rows it sits between are where they will finally be
  positionOutlineBoxes();   // the outline's selection/subtree/report bands are measured overlays too, sized from each row's own offsetLeft — and applySel() (which normally positions them) ran back at the TOP of this render, BEFORE the Form-column alignment pass above gave every row its final indent. Re-run them here, with the rest of the measured overlays, or a selection that survived into this render (switching notation with a token already selected) draws its band at the pre-alignment indent and only snaps into place on the next click.
  layoutGridTies(true);   // the grid's MWT brackets are measured overlays → draw them last, once every row has its final height (the .gwrap caps above can introduce scrolling, which shifts nothing INSIDE the wrap)
  updateBottomSpacer();   // Item 21: keep enough trailing room that the TOP of the last block can scroll to the TOP of the viewport
}
// Item 21: a trailing spacer under #doc so the last block's TOP can always scroll up to the viewport top. Height =
// max(0, viewportH − heightFromLastBlockTopToBottom): just enough that scrolling to the end lifts the last block's
// top to the port top, and 0 once the document is long enough (last block + its tail already fill a viewport) — so
// no permanent gap. Recomputed after each render, on viewport resize, and whenever #doc itself is resized.
function updateBottomSpacer(){
  const host=document.getElementById("doc"); if(!host) return;
  let sp=host.querySelector(":scope > .docbottompad"); if(sp) sp.style.height="0px";   // zero it BEFORE measuring so scrollHeight reflects the real content
  const blocks=host.querySelectorAll(".sblock"), last=blocks[blocks.length-1], vh=host.clientHeight;
  let need=0;
  if(last && vh>0){
    const lastTop=(last.getBoundingClientRect().top-host.getBoundingClientRect().top)+host.scrollTop;   // last block's top within the scroll content
    need=Math.max(0, Math.ceil(vh-(host.scrollHeight-lastTop)));   // content below that top (spacer now 0) must span a full viewport
  }
  if(!sp){ sp=document.createElement("div"); sp.className="docbottompad"; sp.setAttribute("aria-hidden","true"); host.appendChild(sp); }
  sp.style.height=need+"px";
}
let _bottomSpacerRAF=0;
function scheduleBottomSpacer(){ if(_bottomSpacerRAF) return; _bottomSpacerRAF=requestAnimationFrame(()=>{ _bottomSpacerRAF=0; updateBottomSpacer(); }); }   // rAF-coalesced so a burst of resize events does one recompute
addEventListener("resize",scheduleBottomSpacer);
try{ new ResizeObserver(scheduleBottomSpacer).observe(document.getElementById("doc")); }catch(_){}   // #doc's own box change (its border box, not child content → no feedback loop) also recomputes
// Wrapped brackets, per-gap OCCUPY-THEN-GROW inter-line room for interrupter arcs. An interrupter arc is either a
// WITHIN-LINE bump (head + dependent on the SAME wrapped line, drawn above it, rising ∝ its span) or a CROSS-LINE
// edge (endpoints on different lines, traversing one or more gaps). Rules:
//  • whenever an arc occupies a gap (a within-line bump above the lower line, OR a cross-line edge crossing it),
//    that gap is floored at arcsWrapped's STANDARD inter-line gap (WRAP_ARC_STDGAP) — so wrapped brackets space
//    arced lines exactly like the wrapped arc view (Item 3a). Gaps with no arc across them stay tight;
//  • a wide within-line bump (+ its de-collided labels) can climb past that standard gap and collide with the line
//    above → the gap then grows ONLY by that extra deficit, so one tall bump widens ONLY its own gap;
//  • the FIRST line's bumps have no gap above, so the TOP PADDING is topped up on demand to clear them instead.
// This is the SAME occupy-the-standard-gap-then-grow-the-deficit, per-gap logic the wrapped arc view uses.
function reserveBracketArcRoom(){ document.querySelectorAll("#doc .bwrap").forEach(box=>{
  const ints=[...box.querySelectorAll(".bwint")], ghostToks=[...box.querySelectorAll(".bwtok[data-ghostheads]")];
  // item 2: ghost arcs need the SAME room reservation a real interrupter gets, or a tall one can visually overlap
  // the line above — expand each token's (possibly several) ghost targets into individual {dep,headOid,rel}
  // entries alongside the real interrupters, feeding the exact same within/cross room-growth math below.
  const intPairs=ints.map(dep=>({dep,headOid:dep.dataset.inthead,rel:dep.dataset.intrel||""}));
  ghostToks.forEach(dep=>dep.dataset.ghostheads.split(",").forEach(pair=>{ const [headOid,rel]=pair.split(":"); intPairs.push({dep,headOid,rel}); }));
  if(!intPairs.length && !(box._ties||[]).length) return;   // Item 6: also run when the box has ties (MWT or item 1's ExtPos brackets) but no interrupter/ghost arcs, so the line-growth pass below still fires
  const rectOf=tok=>{ const f=tok.querySelector(".bwform")||tok, ox=(f===tok?0:tok.offsetLeft), oy=(f===tok?0:tok.offsetTop);
    return {t:oy+f.offsetTop, cx:ox+f.offsetLeft+f.offsetWidth/2}; };
  const lines=[...box.querySelectorAll(".bwline2")], lineOf=el=>{ const ln=el&&el.closest(".bwline2"); return ln?lines.indexOf(ln):-1; };
  const relpad=parseFloat(getComputedStyle(box).getPropertyValue("--relpad"))||0;   // reserved deprel-row height above every form → the level bracket arcs attach at (matching the arc view), whether or not the token shows a label
  // classify each interrupter/ghost arc as a within-line bump (per line) or a cross-line edge, and record which
  // gaps an arc occupies (gapHasArc[li] → an arc sits in the gap ABOVE line li)
  const withinByLine=new Map(), gapHasArc=new Array(lines.length).fill(false);
  intPairs.forEach(({dep,headOid,rel})=>{ const head=box.querySelector(`.bwtok[data-tok="${headOid}"]`); if(!head)return;
    const ld=lineOf(dep), lh=lineOf(head); if(ld<0||lh<0)return; const Dr=rectOf(dep), Hr=rectOf(head);
    if(Math.abs(Dr.t-Hr.t)<6){ (withinByLine.get(ld)||withinByLine.set(ld,[]).get(ld)).push({Dr,Hr,rel}); if(ld>0) gapHasArc[ld]=true; }   // within-line bump → occupies the gap above its own line
    else { const lo=Math.min(ld,lh), hi=Math.max(ld,lh); for(let g=lo+1;g<=hi;g++) gapHasArc[g]=true; } });                                                     // cross-line edge → occupies every gap it traverses
  // the HIGHEST point (arc crown + de-collided label stack) of a line's WITHIN-LINE bumps, or null if it has none
  const lineTop=li=>{ const ps=withinByLine.get(li); if(!ps)return null;
    const arcs=ps.map(({Dr,Hr,rel})=>{ const h=arcHgt(Math.abs(Dr.cx-Hr.cx)); return {crown:Math.min(Hr.t,Dr.t)-relpad-0.75*h, mx:(Hr.cx+Dr.cx)/2, rel, h}; });   // bump seats at the reserved deprel-row level (the token box top, relpad above the form), not 2px above it — matching the head's startY, the cross-line endpoints, and the arc view
    let top=Infinity; const placed=[]; arcs.forEach(a=>top=Math.min(top,a.crown));   // arc crowns
    if(show.labels) arcs.slice().sort((p,q)=>p.h-q.h||p.mx-q.mx).forEach(L=>{ if(!L.rel)return; const half=meas(L.rel,POS_F)/2+3, hh=7; let y=L.crown-8,guard=0;
      while(guard++<40 && placed.some(pp=>Math.abs(pp.x-L.mx)<pp.hx+half && Math.abs(pp.y-y)<pp.hy+hh)) y-=hh*2+3;
      placed.push({x:L.mx,y,hx:half,hy:hh}); top=Math.min(top,y-hh); });
    return top; };
  const LINEPAD=7, GAPCLEAR=3, TOPCLEAR=8;   // LINEPAD: the .bwline2 top/bottom padding. GAPCLEAR/TOPCLEAR: min clearance a within-line bump keeps over the previous line's content / the box top.
  const formTopOf=li=>{ let m=Infinity; lines[li].querySelectorAll(".bwtok").forEach(tk=>{ const r=rectOf(tk); if(r.t<m)m=r.t; }); return m===Infinity?(lines[li].offsetTop+LINEPAD):m; };   // the line's word-row top (matches the arc view's word top)
  const grow=(ln,by)=>{ if(by>0.5) ln.style.marginTop=((parseFloat(getComputedStyle(ln).marginTop)||0)+by)+"px"; };   // read live → each grow is reflected in the next line's measurement (cumulative-correct)
  lines.forEach((ln,li)=>{
    const top=lineTop(li);   // this line's within-line bumps
    if(top!=null){
      if(li===0){ const deficit=TOPCLEAR-top;   // first line: no gap above → top up the TOP PADDING to clear the bump
        if(deficit>0.5) box.style.paddingTop=((parseFloat(getComputedStyle(box).paddingTop)||0)+deficit)+"px";
      } else { const prevContentBot=lines[li-1].offsetTop+lines[li-1].offsetHeight-LINEPAD; grow(ln,(prevContentBot+GAPCLEAR)-top); }   // grow THIS gap only by the amount the bump exceeds the standard gap
    }
    // Item 3a — floor every arc-occupied gap at the arc view's standard inter-line gap (read live, i.e. after any
    // bump growth above), measured the SAME way the arc view is: previous line's stack bottom → this line's word top
    if(li>0 && gapHasArc[li]){ const prevStackBot=lines[li-1].offsetTop+lines[li-1].offsetHeight-LINEPAD; grow(ln, WRAP_ARC_STDGAP-(formTopOf(li)-prevStackBot)); }
  });
  // CROSS-LINE arcs: their de-collided relation labels ride the chord midpoint and, once lifted to clear each OTHER,
  // can climb onto the content of the arc's UPPER-endpoint line — or, on a multi-line span, an INTERMEDIATE line —
  // overprinting that line's POS tags / forms. Predict the drawn labels EXACTLY (mirror positionBracketAnnots: the
  // SAME fanArcs → the SAME fanned label midpoints → the SAME placeLabels de-collision; an UN-fanned estimate misses
  // the lift that fanning's shifted midpoints induce and leaves the label sitting on a POS tag). Then grow the LOWER
  // line until each label clears the REAL glyph rows of EVERY line it overlaps — measured against the actual
  // .bwform/.bwpos/.bwrel boxes, because the POS/relation rows are position:absolute and hang PAST the line's
  // offsetHeight (the old line-box-bottom target under-measured them). Pushing the lower line down by 2·shortfall
  // lowers the midpoint label by shortfall (Δ/2 rule); read live and iterate (gaps only widen → converges).
  if(show.labels){ const GAPU=8, GAPL=6, tokBot=tk=>tk.offsetTop+tk.offsetHeight;
    const cRec=[];
    ints.forEach(dep=>{ const head=box.querySelector(`.bwtok[data-tok="${dep.dataset.inthead}"]`); if(!head)return;
      const rel=dep.dataset.intrel||""; if(!rel)return; const ld=lineOf(dep), lh=lineOf(head); if(ld<0||lh<0||ld===lh)return;
      const Dr=rectOf(dep), Hr=rectOf(head); if(Math.abs(Dr.t-Hr.t)<6)return;   // within-line bump, handled above
      const depUp=Dr.t<Hr.t;
      cRec.push({dep,head,Hcx:Hr.cx,Dcx:Dr.cx,Ht:Hr.t,Dt:Dr.t,depUp, upTok:depUp?dep:head, loTok:depUp?head:dep, loIdx:depUp?lh:ld, rel}); });
    if(cRec.length){
      const cArcs=cRec.map(c=>({hk:c.head.dataset.tok, dk:c.dep.dataset.tok, xh:c.Hcx, xd:c.Dcx, len:Math.hypot(c.Dcx-c.Hcx,c.Dt-c.Ht), c}));
      fanArcs(cArcs, fanStep());   // the VERY fan positionBracketAnnots applies → matching fanned midpoints → matching de-collision
      for(let it=0; it<6; it++){
        const B=box.getBoundingClientRect();   // live: line boxes shift down as gaps grow, so re-measure each pass
        const rows=lines.map(ln=>{ const out=[]; ln.querySelectorAll(".bwform,.bwpos,.bwrel").forEach(e=>{ if(!e.textContent.trim())return;
          const r=e.getBoundingClientRect(); out.push({l:r.left-B.left, r:r.right-B.left, b:r.bottom-B.top}); }); return out; });   // real glyph-row boxes (POS/rel are absolute → hang past the line box)
        const cl=cArcs.map(a=>{ const c=a.c, loRel=c.loTok.querySelector(".bwrel"), loRelTop=loRel?(c.loTok.offsetTop+loRel.offsetTop):(rectOf(c.loTok).t-GAPL),
            HX=c.Hcx+(a.offH||0), DX=c.Dcx+(a.offD||0), upP0=c.depUp?DX:HX, loP0=c.depUp?HX:DX, upY=tokBot(c.upTok)+GAPU, loY=loRelTop-3;
          return {c, mx:(upP0+loP0)/2, apex:(upY+loY)/2, text:c.rel, level:Math.hypot(upP0-loP0,upY-loY)}; });
        placeLabels(cl);
        const push=new Map();
        cl.forEach(L=>{ const labTop=L.fy-L.hh, half=meas(L.text,POS_F)/2+3, xl=L.mx-half, xr=L.mx+half; let need=0;
          for(let li=0; li<L.c.loIdx; li++) rows[li].forEach(row=>{ if(row.r>xl && row.l<xr){ const s=(row.b+GAPCLEAR)-labTop; if(s>need)need=s; } });   // clear below every glyph row it rides over on a line above its lower endpoint
          if(need>0.5){ const ln=lines[L.c.loIdx]; push.set(ln, Math.max(push.get(ln)||0, 2*need)); } });
        if(!push.size) break; push.forEach((by,ln)=>grow(ln,by)); } } }
  // Item 6: an MWT surface-form tie (drawn later by positionBracketAnnots, hanging below its line) must be able to
  // EXPAND the gap to the NEXT wrapped line so it can't collide with it. Where both component tokens share a line that
  // is NOT the last, grow the following line's gap so the tie + fused form (+ its transliteration) clear it — mirroring
  // the wrapped-arc view, which already reserves mwtDepth(D) in its per-row tieBot. The last line is covered by
  // .bwrap.hasmwt's bottom padding, and split-across-lines MWTs draw no spanning tie (so need no room).
  // item 25/7: si0/s0 — resolve the SENTENCE model so this pass's own undBot can fold in a component token's AVM
  // height, same as positionBracketAnnots' undBot (below, the DRAW side) already does. This copy of undBot had NO
  // AVM term at all (not even the old stale belowGap() one) — it predates the AVM tier's own MWT-tie fix, which
  // only ever touched positionBracketAnnots' undBot, never noticing this second, independent copy existed here.
  // Report, traced from "space below an MWT tie is smaller [[in brackets] than other views" once the box's-own-
  // bottom-padding half (htmlTieBottom, diagram-core.js) was fixed: "MWT forms/transliterations are crashing
  // into the next line" — the SAME shortfall, on an INTERIOR wrapped line instead of the box's last one. This
  // grow() call is what is supposed to widen the gap to line la+1 so a tall tie+form(+translit) stack clears it;
  // without AVM here, a component token's tall FEATS box pushed the actual tie/form (drawn later, correctly, by
  // positionBracketAnnots) well past what this pass ever asked grow() to make room for.
  const si0r=+(box.closest(".sblock")?.dataset.i??-1), s0r=DOC[si0r];
  (box._ties||[]).forEach(m=>{
    const a=box.querySelector(`.bwtok[data-tok="${m.fromTok}"]`), b=box.querySelector(`.bwtok[data-tok="${m.toTok}"]`); if(!a||!b) return;
    const la=lineOf(a), lb=lineOf(b); if(la<0||la!==lb||la>=lines.length-1) return;   // components split across lines → no tie; last line → the .hasmwt bottom padding already reserves the room
    const undBot=tok=>{ const f=tok.querySelector(".bwform")||tok, u=tok.querySelector(".bwund"), fTop=tok.offsetTop+(f===tok?0:f.offsetTop);
      const base=u?fTop+u.offsetTop+u.offsetHeight:fTop+(f===tok?tok.offsetHeight:f.offsetHeight);
      const tk=s0r&&s0r.tokens&&s0r.tokens[(+tok.dataset.tok)-1], av=tk&&avmLayout(tk);
      return av?base+avmTopGap()+av.h:base; };   // item 6: reserve from the below-stack bottom (POS + any gloss/translit tiers) — AND any AVM below that — NOT the bare form bottom — so the reserved gap accounts for gloss layers (and a tall FEATS box) pushing the POS (and hence the tie) down
    const stackBot=Math.max(undBot(a),undBot(b));
    const tieReach=htmlTieBottom(m)+9;   // htmlTieBottom already folds in the SAME lead (5+tieLead()) positionBracketAnnots' yb seats the tie's top with below, so this is just that reach + a little slack — was "15−capHeight+htmlTieBottom(m)+9", double-counting the lead now that htmlTieBottom carries it too (see htmlTieBottom's own comment)
    grow(lines[la+1], (stackBot+tieReach)-lines[la+1].offsetTop);   // grow() is a no-op when the standard inter-line gap already clears the tie; read live so multiple ties / earlier arc growth stay cumulative-correct
  });
}); }
// interrupter cross-line arcs + MWT surface-form ties for wrapped brackets, laid over the text after layout.
// Both connect DOM cells (measured with offsetLeft/offsetTop against the position:relative .bwrap box), so they
// are drawn once the lines have flowed — like the wash. Arcs mirror the flat view: head→dependent, arrowhead at
// the dependent, relation label near the crown. Ties mirror mwtTie: a rounded bracket under the two component
// words with the surface form (and its transliteration) beneath.
function positionBracketAnnots(){ document.querySelectorAll("#doc .bwrap").forEach(box=>{
  box.querySelectorAll(".bwannot").forEach(s=>s.remove());
  const ints=[...box.querySelectorAll(".bwint")], mwts=box._ties||[], ghostToks=[...box.querySelectorAll(".bwtok[data-ghostheads]")];
  if(!ints.length && !mwts.length && !ghostToks.length) return;
  const W=Math.max(box.clientWidth,box.scrollWidth), H=box.scrollHeight;
  const svg=E("svg",{class:"bwannot",width:W,height:H,viewBox:`0 0 ${W} ${H}`});
  const rectOf=tok=>{ const f=tok.querySelector(".bwform")||tok, ox=(f===tok?0:tok.offsetLeft), oy=(f===tok?0:tok.offsetTop);   // .bwtok is position:relative → the form's offsets are token-relative; add the token's own box-relative offset
    return {l:ox+f.offsetLeft,t:oy+f.offsetTop,w:f.offsetWidth,h:f.offsetHeight,cx:ox+f.offsetLeft+f.offsetWidth/2}; };
  const AH=parseFloat(css("--arrow"))||5.5, GAPU=8, GAPL=6, tokBot=tok=>tok.offsetTop+tok.offsetHeight, si0=+(box.closest(".sblock")?.dataset.i??-1);
  // partition interrupter arcs into within-line bumps and cross-line edges, exactly as the wrapped ARC view does
  const within=[], cross=[];
  ints.forEach(dep=>{ const headTok=box.querySelector(`.bwtok[data-tok="${dep.dataset.inthead}"]`); if(!headTok)return;
    const Dr=rectOf(dep), Hr=rectOf(headTok), col=dep.dataset.intcol||"var(--accent)", rel=dep.dataset.intrel||"";
    (Math.abs(Dr.t-Hr.t)<6?within:cross).push({dep,headTok,Dr,Hr,col,rel}); });
  // WITHIN-LINE bumps: fan the shared-node endpoints (fanArcs), draw the identical Hobby bump (drawBump), then
  // de-collide the labels WITH leaders (decollide) — the very functions the wrapped arc view uses, so they can't drift.
  // The fan itself is computed COMBINED with the cross-line arcs below (Item 16, mirroring the wrapped arc view):
  // a token with both a within-line bump AND a cross-line arc needs ONE consistent fan across both, not two
  // independent ones that don't know about each other and can offset both to the same spot.
  const wArcs=within.map(p=>({hk:p.headTok.dataset.tok,dk:p.dep.dataset.tok,xh:p.Hr.cx,xd:p.Dr.cx,len:Math.abs(p.Dr.cx-p.Hr.cx),p}));
  // CROSS-LINE edges: identical treatment to the wrapped ARC view's cross-line edges (a straight arrow when the chord
  // already meets the tokens at ≥ θ, else a Hobby spline lifting the endpoints to θ). The BOTTOM endpoint terminates
  // just ABOVE the lower token's .bwrel deprel label (Item 2), and the labels run through the SAME de-collision pass
  // (lift-until-clear + leader) as the within-line bumps (Item 1).
  // hk/dk are bucketed with the SAME token id a within-line bump at that token uses — EXCEPT the endpoint that sits
  // on the line ABOVE, which gets its own "B"+id bucket (mirroring arcsWrapped's Item 16) so it never fans with
  // reference to unrelated endpoints belonging to rows further above; only same-row neighbours ever share a bucket.
  const cArcs=cross.map(p=>{ const depUp=p.Dr.t<p.Hr.t, a={hk:p.headTok.dataset.tok,dk:p.dep.dataset.tok,xh:p.Hr.cx,xd:p.Dr.cx,len:Math.hypot(p.Dr.cx-p.Hr.cx,p.Dr.t-p.Hr.t),p};
    if(depUp) a.dkey="B"+a.dk; else a.hkey="B"+a.hk; return a; });
  // FAN the shared-node endpoints for BOTH kinds of arc in ONE combined pass — a token with both a within-line bump
  // AND a cross-line arc needs one consistent offset across both (Item 16), not two independent fans that don't
  // know about each other and can offset both to the same spot. Without this every arc meeting one token would
  // draw at the identical x (offset 0) → overlapping arcs; the offset also gives a near-column-aligned pair's
  // chord real span, so drawCrossLine's own angle test (ARC_ANGLE) can tell straight from Hobby-spline.
  fanArcs([...wArcs,...cArcs],fanStep());   // mutates each with offH (head/outgoing side) / offD (dependent side)
  const wlabs=[], relpad=parseFloat(getComputedStyle(box).getPropertyValue("--relpad"))||0;   // reserved deprel-row height → seat the bump at that level so a no-label dependent attaches as far above the form as the arc view (matching the cross-line endpoints + the head's startY), not 2px above the form
  wArcs.forEach(a=>{ const p=a.p, base=Math.min(p.Hr.t,p.Dr.t)-relpad, h=arcHgt(Math.abs(p.Dr.cx-p.Hr.cx));
    const XH=p.Hr.cx+(a.offH||0), XD=p.Dr.cx+(a.offD||0), g=E("g",{});
    const hRel=p.headTok.querySelector(".bwrel"), startY=hRel?(p.headTok.offsetTop+hRel.offsetTop-3):undefined;   // Item 5: start the bump ~3px ABOVE the head (starting) token's deprel label, not at/below the form
    const apex=drawBump(g,XH,XD,base,base-h,0,AH,p.col,true,startY); svg.appendChild(g);   // shared bump: take-off angle θ (arcCtrl), arrowhead at the dependent, casing halo — returns the visible crown y
    if(show.labels && p.rel) wlabs.push({g,dep:+p.dep.dataset.tok,mx:(XH+XD)/2,apex,text:p.rel,col:p.col,level:h}); });
  if(show.labels) decollide(wlabs,[],svg,si0);   // lift each label above the (shorter) placed ones and tie it back with a leader — the SAME de-collision the arc view runs
  const clabs=[];
  cArcs.forEach(a=>{ const {dep,headTok,Dr,Hr,col,rel}=a.p, g=E("g",{}), depUp=Dr.t<Hr.t;
    const loTok=depUp?headTok:dep, loRel=loTok.querySelector(".bwrel");   // the LOWER token and its deprel label
    const loRelTop=loRel?(loTok.offsetTop+loRel.offsetTop):((depUp?Hr.t:Dr.t)-GAPL);   // measure the .bwrel top the way rectOf measures the form top
    const HX=Hr.cx+(a.offH||0), DX=Dr.cx+(a.offD||0);   // fanned endpoint x's
    const upP=[depUp?DX:HX, tokBot(depUp?dep:headTok)+GAPU], loP=[depUp?HX:DX, loRelTop-3];   // bottom endpoint sits ~3px ABOVE the deprel label, not overlapping/below it
    const tip=depUp?upP:loP, frm=depUp?loP:upP;
    const gap=[tokBot(depUp?dep:headTok), loRelTop];   // the arc may bow within the inter-line gap: up to the upper token's bottom, down to the lower token's deprel-label top
    drawCrossLine(g,frm,tip,col,AH,true,gap);   // SAME helper the wrapped arc view uses → identical curvature/take-off; casing halo added here
    svg.appendChild(g);
    if(show.labels && rel) clabs.push({g,dep:+dep.dataset.tok,mx:(upP[0]+loP[0])/2,apex:(upP[1]+loP[1])/2,text:rel,col,level:Math.hypot(upP[0]-loP[0],upP[1]-loP[1]),frm,tip,gap,arcEls:[...g.childNodes]}); });   // frm/tip/gap/arcEls: Item 4 lets a lifted label grow the arc up to it
  if(show.labels){ decollide(clabs,[],svg,si0); growCrossArcs(clabs,AH,null,si0); }   // fold cross-line labels into the SAME de-collision pass as the within-line bumps; then grow/widen: raise any arc whose label cleared its top endpoint, widen the band, re-solve the band
  const s0=DOC[si0];   // item 25/4: hoisted above mwts.forEach so undBot() can resolve each token's own model object too — was declared just before the AVM loop below, which still reuses this same binding
  mwts.forEach(m=>{ const a=box.querySelector(`.bwtok[data-tok="${m.fromTok}"]`), b=box.querySelector(`.bwtok[data-tok="${m.toTok}"]`); if(!a||!b)return;
    const A=rectOf(a), B=rectOf(b); if(Math.abs(A.t-B.t)>4) return;          // components split across lines → no spanning tie
    // item 25/4: +AVM, on report ("in wrapped brackets, the MWT brackets crash into the AVMs") — .bwund's own
    // LIVE height (u.offsetHeight) never included the AVM box to begin with: it is drawn separately, straight
    // into this SAME svg overlay, not as a DOM child that would grow .bwund's own measured height the way an
    // otrans/gloss/bwpos row does. So the tie's seat (yb, below) was computed as if no AVM existed under
    // either component, even on a token that plainly has one — the tie then drew ABOVE the AVM it should have
    // cleared. avmLayout(t)'s own h, plus avmTopGap() — see that function's own note for why it, not bare
    // belowGap(), is the right clearance above an AVM box (this line originally read +belowGap(), written
    // before avmTopGap() existed, and was never updated when that landed a round later: on report, "more
    // space above a MWT bracket … than in other views" — belowGap() (~21.6px) against avmTopGap() (~9.8px)
    // is exactly the ~12px of extra seating this term was quietly adding only in wrapped brackets) — is
    // folded in here so undBot() states the token's TRUE below-stack bottom, AVM included, on the SAME
    // clearance convention belowStack's own identical call now uses.
    const undBot=tok=>{ const f=tok.querySelector(".bwform")||tok, u=tok.querySelector(".bwund"), fTop=tok.offsetTop+(f===tok?0:f.offsetTop);
      const base=u?fTop+u.offsetTop+u.offsetHeight:fTop+(f===tok?tok.offsetHeight:f.offsetHeight);
      const t=s0&&s0.tokens&&s0.tokens[(+tok.dataset.tok)-1], av=t&&avmLayout(t);
      return av?base+avmTopGap()+av.h:base; };   // item 6: the BOTTOM of the token's below-stack (POS + any gloss/translit tiers), measured live — so the tie clears the POS even when gloss layers sit between the form and the POS
    const mark0=svg.childNodes.length;   // item 8: everything this tie appends from here on is MOVED into one .mwt-g group at the end — recorded rather than re-pointing a dozen appendChild calls, so the drawing order (casing → tie → translit → form last) stays exactly as written. Mirrors the SVG mwtTie
    // yb: the tie's TOP, seated the SAME way the SVG views' shared mwtTie/tieLead seat every OTHER notation's
    // tie — undBot (this HTML view's own name for the below-stack bottom mwtTie calls stackBot) + 5 (the
    // constant every mwtTie CALLER adds before its own `y+=L.lead`) + tieLead() (the shared "one POS-descender
    // below the POS baseline" primitive already reused by the outline/hierarchy goeswith slurs — see tieLead's
    // own comment) + m.dy (this tie's own TIER offset, so one that overlaps an ExtPos bracket steps down out of
    // its way, exactly as in every SVG view). Previously a hand-rolled "+15−capHeight−PIN" that pre-dated
    // tieLead() and had drifted from it (missing tieLead's own +descent(POS_F), and not branching on show.pos at
    // all) — which is why an MWT tie in wrapped brackets sat visibly closer to the POS row than the SAME tie
    // drawn by arcs/stemma/tree/flat-brackets, all of which already go through mwtTie. dp still uses its OWN
    // PIN(6): the end-pin/body thickness is a drawing-weight choice independent of where the tie SEATS, exactly
    // as mwtTie's own PIN(5) never enters its `y`/`ty` computation either.
    const PIN=6, x0=Math.min(A.l,B.l), x1=Math.max(A.l+A.w,B.l+B.w), dp=PIN, yb=Math.max(undBot(a),undBot(b))+5+tieLead()+(m.dy||0), mx=(x0+x1)/2;
    if(m.kind==="gw"){ gwSlurSVG(svg,x0,x1,yb,si0,m.ids,null); return; }   // goeswith: a curve, not a bracket, and no label under it — but seated by the very same yb the MWT tie uses (below-stack bottom + tier offset), so a slur and a bracket in one box can never collide. fromTok===toTok here: a goeswith unit is ONE display cell, and rectOf measures the .bwform, i.e. the whole word's ink
    const tieD=`M ${x0} ${yb} L ${x0} ${yb+dp} L ${x1} ${yb+dp} L ${x1} ${yb}`;
    svg.appendChild(E("path",{class:"mwt-tie-cas",d:tieD}));   // occlusion halo behind the tie (matches the SVG-view mwtTie)
    svg.appendChild(E("path",{class:"mwt-tie",d:`M ${x0} ${yb} L ${x0} ${yb+dp+0.421875} M ${x1} ${yb+dp+0.421875} L ${x1} ${yb}`}));   // end-pins: the full weight — each extends 0.421875px (half the bar's own .75·--arc-stroke width, now 1.125px — item 1) PAST the bar's centreline so its (thicker) stroke fully covers the corner the (thinner) bar's stroke reaches, instead of butting flush and leaving a notch
    svg.appendChild(E("path",{class:"mwt-tie-h",d:`M ${x0} ${yb+dp} L ${x1} ${yb+dp}`}));   // the horizontal bar, drawn thinner — per psychophysics, a horizontal stroke reads heavier than a vertical one of the same width
    const fyb=yb+dp+20, STEP=belowGap();
    if(m.kind==="xpos"){ drawTieLabel(svg,mx,fyb,m.pos,"mwt-pos","mwt-pos-cas",POS_F,null); tagXPosLabel(svg.lastElementChild,si0,m); return; }   // item 1: an ExtPos-only bracket — the value itself is the label, in the POS register
    const mfd=bform(m); let ly=fyb;
    const iastRow=iastFormEdit();   // Sanskrit + a real script → the surface form is edited on the IAST ROW, never on the derived glyph; same contract (and same {data-s, data-mwtfrom} tagging) as the SVG views' mwtTie
    let dropped=false;
    { const mrt=trTxt(m); if(mrt){ ly+=STEP+STACKED_GAP; dropped=true; const tr=E("text",{class:"translit mwt-tr"+(iastRow?" mwt-tr-edit":""),x:mx,y:ly,"text-anchor":"middle"}); tr.textContent=mrt; svg.appendChild(tr);
      if(si0>=0&&m.fromTok!=null){ tr.setAttribute("data-s",si0); tr.setAttribute("data-mwtfrom",m.fromTok); }   /* tagged in EVERY language, so the row's right-click resolves to its MWT rather than falling through to the ordinary token menu — see the fuller note on the same line in js/diagram/diagram-core.js. The .mwt-tr-edit class above stays gated on iastRow, because that is what the click-to-EDIT handler matches. */
      if(iastRow&&si0>=0&&m.fromTok!=null){ tr.style.cursor="text"; svgTip(tr,"multi-word token — click to edit the surface form (the script glyph above is derived from it)"); } } }   // cursor:text matches mwtTie and the other click-to-edit diagram texts (.tr-edit/.gl-edit/.cform): clicking opens a field, not a button   // item 6: the MWT form→translit gap is a full inter-tier step (belowGap()) — matching a NON-MWT token and the SVG mwtTie.   // Item 9: draw the MWT transliteration row FIRST so the MWT form (and its backing) below paints ON TOP where they crowd — consistent with the SVG mwtTie and .stext-over-.strans. +STACKED_GAP once, only on whichever row is FIRST below the tie's own surface-form glyphs (mirrors tieLayout's r.dtr/r.dpos in diagram-core.js) — never on every step
    if(m.pos){ drawTieLabel(svg,mx,ly+STEP+(dropped?0:STACKED_GAP),m.pos,"mwt-pos","mwt-pos-cas",POS_F,null); tagXPosLabel(svg.lastElementChild,si0,m); }   // item 1: the coinciding-span case — the MWT bracket simply gains the ExtPos as a POS annotation instead of a second bracket over the same tokens. STACKED_GAP only if the translit row above didn't already spend it
    const cas=E("text",{class:"mwt-cas",x:mx,y:fyb,"text-anchor":"middle"}); cas.textContent=mfd; cas.setAttribute("aria-hidden","true"); svg.appendChild(cas);   // opaque backing behind the reconstructed word (and over the translit row above)
    const fe=E("text",{class:"mwt-form",x:mx,y:fyb,"text-anchor":"middle"}); fe.textContent=mfd;
    if(si0>=0&&m.fromTok!=null){ fe.setAttribute("data-s",si0); fe.setAttribute("data-mwtfrom",m.fromTok); fe.style.cursor=formCursor(); svgTip(fe,iastRow?"multi-word token — click to edit the surface form (on the IAST row below, which this glyph is derived from)":"multi-word token — click to edit the surface form"); }   // same click-to-edit contract as the SVG views' mwtTie: the delegated #doc click/contextmenu handlers key off data-s + data-mwtfrom. `_ties` already stores fromTok as OID(from−1) — the ORIGINAL token id editMWTInline looks up — so a display fold can't misaddress it. Without these attributes the WRAPPED bracket view was the one tie-drawing notation whose surface form couldn't be edited at all, and its right-click menu resolved si/from to NaN.
    svg.appendChild(fe);   // item 8/9: SCRIPT + sandhi-fused surface form (m.ortho), like single tokens. +20 matches mwtTie's extra top-gap so the 15px MWT form clears the tokens above (see .bwrap.hasmwt padding). Appended LAST → paints on top of the translit row (Item 9)
    // item 8 — gather the tie's whole stack into ONE .mwt-g carrying the COMPONENT RANGE, so a selected MWT accents
    // as a unit and rides applySel()'s live class toggle. box._ties already stores fromTok/toTok as ORIGINAL token
    // ids (OID(from−1)/OID(to−1)), which is the space selRange speaks — so no remapping is needed here.
    const selTie=mwtTieSelected(si0,m.fromTok,m.toTok);
    const tg=E("g",{class:"mwt-g"+(selTie?" sel":"")+tieDimClass(si0,tieIdRange(m.fromTok,m.toTok),selTie)});   // …carrying the three-level emphasis too (tieDimLevel: the dimmest cell the bracket spans). Computed HERE and not left to applySel alone because renderDoc runs positionBracketAnnots AFTER applySel — a tie built on this pass would otherwise stay at full strength until the next selection change, which in the wrapped brackets is the one notation where that is visible on a plain re-layout
    if(si0>=0&&m.fromTok!=null){ tg.setAttribute("data-s",si0); tg.setAttribute("data-mwtfrom",m.fromTok); tg.setAttribute("data-mwtto",m.toTok); }
    while(svg.childNodes.length>mark0) tg.appendChild(svg.childNodes[mark0]);   // index mark0 keeps naming the next node to move → order preserved
    svg.appendChild(tg); });
  // Ghost arcs (Shared=Yes and Subject-raising): dashed, dimmed. Within-line → a plain bump; cross-line → the SAME
  // straight-vs-Hobby-spline logic drawCrossLine gives the real cross-line arcs. data-ghostheads packs "oid:rel"
  // pairs — each ghost target carries its OWN relation label (Shared=Yes ghosts show the dependent's own deprel;
  // Subject-raising always "subj"). Item 7: fanned against the SAME buckets wArcs/cArcs just resolved (never the
  // reverse). Item 6: labels decollided against wlabs/clabs (already finalized above) — only ghost labels move.
  const ghostPairs=[];
  ghostToks.forEach(dep=>dep.dataset.ghostheads.split(",").forEach(pair=>{ const [ghOid,rel,kind]=pair.split(":"); ghostPairs.push({dep,ghOid,rel,kind}); }));
  const ghostFan=ghostPairs.map(({dep,ghOid})=>{ const headTok=box.querySelector(`.bwtok[data-tok="${ghOid}"]`); if(!headTok) return null;
    const Dr=rectOf(dep), Hr=rectOf(headTok), depUp=Dr.t<Hr.t, a={hk:ghOid,dk:dep.dataset.tok,xh:Hr.cx,xd:Dr.cx};
    if(Math.abs(Dr.t-Hr.t)>=6){ if(depUp) a.dkey="B"+a.dk; else a.hkey="B"+a.hk; }
    return a; });
  fanGhostArcs([...wArcs,...cArcs],ghostFan.filter(Boolean),fanStep());
  const ghostLabelObstacles=[...wlabs,...clabs].map(L=>({x:L.mx,y:L.fy!=null?L.fy:L.apex,hx:meas(L.text,POS_F)/2+3,hy:7}));   // every REAL label's FINAL position (post-decollide) — read, never altered
  ghostPairs.forEach(({dep,ghOid,rel,kind},gi)=>{ const headTok=box.querySelector(`.bwtok[data-tok="${ghOid}"]`); if(!headTok)return;
    const Dr=rectOf(dep), Hr=rectOf(headTok), col=relColor(rel), fan=ghostFan[gi]||{};
    const [gtok,gother]=ghostTokOther(kind,+dep.dataset.tok,+ghOid);
    if(Math.abs(Dr.t-Hr.t)<6){ const XH=Hr.cx+(fan.offH||0), XD=Dr.cx+(fan.offD||0), h=arcHgt(Math.abs(XD-XH)), base=Math.min(Hr.t,Dr.t)-relpad;
      const hRel=headTok.querySelector(".bwrel"), startY=hRel?(headTok.offsetTop+hRel.offsetTop-3):undefined;   // item 8: raise the start to clear the head token's OWN deprel label, exactly like a real within-line bump
      const g=E("g",{class:"ghost-g"+(sel.s===si0&&sel.t===+dep.dataset.tok?" sel":""),"data-s":si0,"data-dep":dep.dataset.tok});
      wireGhostClick(g,si0,kind,gtok,gother);
      const apex=drawBump(g,XH,XD,base,base-h,0,AH,col,true,startY);   // item 8: apex is now the TRUE (bezYExtent) crown when raised, matching a real bump — not the flat 0.75h estimate
      g.querySelectorAll(".arc-path").forEach(p=>p.classList.add("arc-ghost")); g.querySelectorAll(".ah").forEach(p=>p.classList.add("ah-ghost"));
      if(show.labels){ const mx=(XH+XD)/2, half=meas(rel,POS_F)/2+3, hh=7, y0=apex-8; let y=y0, guard=0;
        while(guard++<40 && ghostLabelObstacles.some(o=>Math.abs(o.x-mx)<o.hx+half && Math.abs(o.y-y)<o.hy+hh)) y-=hh*2+3;
        if(y<y0-0.5) g.insertBefore(E("line",{class:"leader leader-ghost",x1:mx,y1:y+hh,x2:mx,y2:apex,stroke:arcInk(col)}),g.firstChild);   // item 6   /* the drained ink, NOT the full relation colour: the ghost EDGE is stroked with arcInk(col) while this leader took `col` raw, so at the same .72 opacity the leader read as the strongest part of a ghost — the one thing it is least meant to be. arcInk is what every other ghost stroke already passes through. */
        drawLabel(g,mx,y,rel,col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); ghostLabelObstacles.push({x:mx,y,hx:half,hy:hh}); }
      svg.appendChild(g);
    } else { const depUp=Dr.t<Hr.t;
      const loTok=depUp?headTok:dep, loRel=loTok.querySelector(".bwrel");
      const loRelTop=loRel?(loTok.offsetTop+loRel.offsetTop):((depUp?Hr.t:Dr.t)-GAPL);
      const HX=Hr.cx+(fan.offH||0), DX=Dr.cx+(fan.offD||0);
      const upP=[depUp?DX:HX, tokBot(depUp?dep:headTok)+GAPU], loP=[depUp?HX:DX, loRelTop-3];
      const tip=depUp?upP:loP, frm=depUp?loP:upP, gap=[tokBot(depUp?dep:headTok), loRelTop];
      const g=E("g",{class:"ghost-g"+(sel.s===si0&&sel.t===+dep.dataset.tok?" sel":""),"data-s":si0,"data-dep":dep.dataset.tok});
      wireGhostClick(g,si0,kind,gtok,gother);
      drawCrossLine(g,frm,tip,col,AH,false,gap);
      g.querySelectorAll(".arc-path").forEach(p=>p.classList.add("arc-ghost")); g.querySelectorAll(".ah").forEach(p=>p.classList.add("ah-ghost"));
      if(show.labels){ const mx=(upP[0]+loP[0])/2, my=(upP[1]+loP[1])/2, half=meas(rel,POS_F)/2+3, hh=7; let y=my, guard=0;
        while(guard++<40 && ghostLabelObstacles.some(o=>Math.abs(o.x-mx)<o.hx+half && Math.abs(o.y-y)<o.hy+hh)) y-=hh*2+3;
        if(y<my-0.5) g.insertBefore(E("line",{class:"leader leader-ghost",x1:mx,y1:y+hh,x2:mx,y2:my,stroke:arcInk(col)}),g.firstChild);   // item 6
        drawLabel(g,mx,y,rel,col); const lb=g.lastElementChild; if(lb)lb.classList.add("lbl-ghost"); ghostLabelObstacles.push({x:mx,y,hx:half,hy:hh}); }
      svg.appendChild(g); } });
  // item 22: the AVM tier, in the SAME svg overlay the MWT ties above already use. bracketsWrapped's own
  // `--undpad` (js/diagram/diagram-wrap.js) already reserves avmRowMaxH(t) worth of room below every token's
  // below-stack, but nothing ever painted into it — the `below` array that function builds is otrans/gloss/
  // bwpos only, never avm. Seated off THIS token's own LIVE below-stack bottom (the identical undBot(tok)
  // formula the MWT tie above measures itself against, copied rather than shared — see that block's own note
  // for why it's a live measurement and not the shared padding figure) so a token with a taller-than-usual
  // gloss stack can't collide with its own AVM box.
  {   // s0 hoisted above mwts.forEach now — undBot() there needs it too, see that block's own note
    box.querySelectorAll(".bwtok").forEach(tok=>{ const oid=+tok.dataset.tok, t=s0&&s0.tokens&&s0.tokens[oid-1];
      if(!t||!avmLayout(t)) return;
      const f=tok.querySelector(".bwform")||tok, u=tok.querySelector(".bwund"), fTop=tok.offsetTop+(f===tok?0:f.offsetTop);
      const bot=u?fTop+u.offsetTop+u.offsetHeight:fTop+(f===tok?tok.offsetHeight:f.offsetHeight);
      const ox=(f===tok?0:tok.offsetLeft), cx=ox+f.offsetLeft+f.offsetWidth/2;
      drawAVM(svg,cx,bot+avmTopGap(),t,si0,oid,null); }); }   // item 25/4 round 2: avmTopGap() — see belowStack's own note. `bot` here is a live DOM edge, not a baseline, so this is a slightly looser match to "the space above POS" than the other two call sites (which measure from a real baseline) — but avmTopGap()'s own VALUE is a plain small clearance number either way, and matching the other two sites exactly means one formula to keep in sync rather than a fourth, untested one for this context alone
  box.appendChild(svg); }); }
// continuous span wash for wrapped brackets: one rounded rect per line, spanning the selected constituent's
// elements on that line (drawn behind the text)
function positionBracketWash(){ document.querySelectorAll("#doc .bwrap").forEach(box=>{
  box.querySelectorAll(".bwwash").forEach(w=>w.remove());
  const els=[...box.querySelectorAll(".inspan")]; if(!els.length) return;
  const col=box.style.getPropertyValue("--washcol")||"var(--accent)", byLine=new Map();
  els.forEach(e=>{ const ln=e.closest(".bwline2"); if(!ln)return; (byLine.get(ln)||byLine.set(ln,[]).get(ln)).push(e); });   // group by line element
  byLine.forEach(g=>{ let l=Infinity,r=-Infinity,top=Infinity,bot=-Infinity;
    g.forEach(e=>{ l=Math.min(l,e.offsetLeft); r=Math.max(r,e.offsetLeft+e.offsetWidth);
      const isTok=e.classList.contains("bwtok"), fe=isTok?(e.querySelector(".bwform")||e):e;   // vertical band = the form/bracket row ONLY, never the deprel row above or the POS row below
      const fo=(isTok&&fe!==e)?e.offsetTop:0;   // .bwtok is position:relative → its .bwform offsetTop is token-relative; add the token's box-relative top
      top=Math.min(top,fo+fe.offsetTop); bot=Math.max(bot,fo+fe.offsetTop+fe.offsetHeight); });
    const w=document.createElement("div"); w.className="bwwash"; w.style.left=l+"px"; w.style.top=(top-2)+"px"; w.style.width=(r-l)+"px"; w.style.height=(bot-top+4)+"px"; w.style.background=`color-mix(in srgb, ${col} 15%, transparent)`; box.appendChild(w); }); }); }

/* selection */
// Bring `el` into view within EVERY scrollable ancestor between it and the viewport, walking outward one
// container at a time and nudging just enough (never re-centring an already-visible element) — a hand-rolled
// equivalent of `el.scrollIntoView({block:"nearest"})`. WebKit/Safari has a long history of unreliable support
// for scrollIntoView's OPTIONS-OBJECT form (as opposed to the old boolean-only call), especially once more than
// one scrollable ancestor is involved (here: the grid's own .gwrap, THEN the outer #doc) — it can silently no-op
// instead of throwing, which is exactly what "selecting a token no longer scrolls the grid" looks like from the
// user's side. This only uses getBoundingClientRect()/scrollTop, which have been solid across every engine for
// decades, so it can't have that failure mode regardless of which WebKit version renders the packaged app.
/* WHAT IS BROUGHT INTO VIEW IS THE ROW, NOT THE FIELD INSIDE IT. Almost every caller here hands over a grid CELL
   or the <input>/<textarea> in one (pick's own `tr` is the exception), and a field's box is both shorter than its
   row and centred in it — so "the field is fully visible" left the row's own top edge, band and MWT bracket still
   cut off, and the scroll appeared to land on the field's top, bottom or text baseline rather than on the row.
   Snapping the target up to the enclosing <tr> makes the ROW the unit that has to fit, which is the only box the
   user is actually looking at. Rows are short, so this can never make a needed scroll unsatisfiable. */
function scrollRowOf(el){ const tr=el&&el.closest&&el.closest("#doc table.grid tbody tr"); return tr||el; }
/* …and the grid has a STICKY HEADER (table.grid th, position:sticky top:0), which occludes the top of its own
   scrollport exactly as the pinned boundary headings occlude #doc's. Without charging it, a row scrolled up to
   the top of .gwrap lands UNDERNEATH the header — the header covers the row's top edge and leaves the middle of
   the field showing, which is the same symptom from the other direction. Measured off the live <thead> rather
   than assumed, since the header's height follows the font size. */
function gridHeadH(node){ if(!node||!node.classList||!node.classList.contains("gwrap")) return 0;
  const th=node.querySelector("table.grid thead"); return th?th.getBoundingClientRect().height:0; }
/* SCROLL A GRID ROW TO THE TOP of its grid, rather than merely into view. scrollNearest moves as little as it
   can, which is right for stepping through rows; this is for arriving at one from somewhere else — selecting an
   MWT in the diagram — where the rows that follow it (its own components, immediately below) are as much a part
   of what you asked to see as the row itself, and "just barely on screen at the bottom" shows none of them.
   Two scrollers, in this order: the OUTER ones first (scrollNearest, so the block is on screen at all and the
   grid has a visible portion to align within), then the grid's own, set outright rather than nudged. The target
   is the row's top flush with the TOP OF THE VISIBLE PORTION — below the sticky column header, which occupies
   the first gridHeadH pixels of the scrollport and would otherwise cover the row we just scrolled to. Clamped by
   the browser to the scroll range, so a row near the end simply lands as high as the content allows. */
function scrollRowToGridTop(row){ if(!row) return;
  scrollNearest(row);
  const wrap=row.closest&&row.closest(".gwrap"); if(!wrap) return;
  const wr=wrap.getBoundingClientRect(), rr=row.getBoundingClientRect();
  wrap.scrollTop+=(rr.top-(wr.top+gridHeadH(wrap)))/cssZoomOf(wrap);   // rects are SCALED viewport px, scrollTop is unscaled CSS px — cssZoomOf rather than the bare FS this used to divide by, so the two scroll paths (here and scrollNearest) ask the DOM the same question rather than one of them assuming the wrap is inside .sblock
}
function scrollNearest(el){ if(!el) return;
  el=scrollRowOf(el);
  let node=el.parentElement;
  while(node){
    const cs=getComputedStyle(node);
    if(/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight>node.clientHeight){
      const nr=node.getBoundingClientRect(), er=el.getBoundingClientRect();   // re-measured each iteration: a nudge on an INNER container shifts el's rect for the NEXT (outer) one
      const stick=(node.id==="doc"&&typeof stickyHeadH==="function")?stickyHeadH((el.closest&&el.closest(".sblock"))||el):gridHeadH(node);   // the document scroller's top is additionally occluded by whatever boundary headings are PINNED over this element's block — scroll-padding-top only clears the toolbar, so without this a token brought to the top of the page lands underneath its own document/paragraph heading. The grid's own scroller is occluded the same way by its sticky column header
      /* …AND THE NUDGE IS CONVERTED INTO THE SCROLLER'S OWN px (see cssZoomOf above). Every scroller
         this walk meets except `#doc` itself lives inside `.sblock{zoom:var(--fs)}` — the grid's
         .gwrap, a wide diagram, a wrapped stemma's .wp-toks — so the delta measured off two rects is
         `z`× the scrollTop it has to become. Measured on a capped grid: at FS=0.6, scrolling to the
         last row under-shot by 34px and left the row off screen entirely. gridHeadH is already
         viewport px (it is a rect height), so only the computed scroll-padding needs scaling up. */
      const z=cssZoomOf(node);
      const top=nr.top+(parseFloat(cs.scrollPaddingTop)||0)*z+stick, bot=nr.bottom-(parseFloat(cs.scrollPaddingBottom)||0)*z;
      if(er.top<top) node.scrollTop-=(top-er.top)/z;
      else if(er.bottom>bot) node.scrollTop+=(er.bottom-bot)/z;
    }
    node=node.parentElement;
  }
}
function setRange(s,anchor,focus){ selRange={s,anchor,focus,from:Math.min(anchor,focus),to:Math.max(anchor,focus)}; }
function pick(s,t,scroll=true,reflow=true){ sel={s,t}; CURBLOCK=s; selGhost=null;   // selecting a token IS arriving at its block, so the two stay in step here; only the scroll spy moves one without the other (see the CURBLOCK note in js/core/prefs.js). selGhost=null: an ordinary click always wins the reader's most recent choice — see selGhost's own comment, js/core/prefs.js
  if(typeof clearBlockRange==="function") clearBlockRange();   // an ordinary click starts a new selection, so it drops any sentence range — the same rule every list follows
  if(typeof updateFileBlock==="function")updateFileBlock();   // keep the "Sentence X of Y" subtitle in step with the selection
  if(s<0||s>=DOC.length){ sel={s:-1,t:0}; selRange=null; syncMenu(); return; }   // empty document / no selection
  if(selRange && (s!==selRange.s || t<selRange.from || t>selRange.to)) selRange=null;   // a click outside the multi-selection clears it
  syncMenu();   // update the conditional Edit-menu items for the new selection
  if(conv==="brackets"){ preserveScroll(renderDoc); }   // brackets: re-flow so the bolded word gets its width AND the selection wash (a fresh <rect> computed only on full render, unlike every other view's live .sel class-toggle) — ALWAYS, regardless of the caller's own reflow flag: a reflow=false pick (grid focus, Tab navigation, etc.) still changes which token is selected, and brackets has no live-toggle-only path that keeps either of those in step, so skipping this left both lagging one selection behind
  else {
    document.querySelectorAll("#doc tbody tr").forEach(tr=>tr.classList.toggle("sel",+tr.dataset.s===s&&+tr.dataset.tok===t));
    document.querySelectorAll(".sblock").forEach(b=>b.classList.toggle("sel-block",+b.dataset.i===s));
    applySel();
  }
  wpRevealSel();   // if the selected token lives in an off-screen wrapped-stemma row, scroll that row into view
  if(scroll){const r=document.querySelector(`#doc tr[data-s="${s}"][data-tok="${t}"]`); scrollNearest(r);}
}
function applyZone(){ const d=document.getElementById("doc"); if(!d)return; d.classList.toggle("zone-grid",UIZONE==="grid"); d.classList.toggle("zone-diagram",UIZONE!=="grid"); }   // marks which view holds the focus → drives the accent-vs-grey selection styling
// The three-level emphasis the selection projects over its sentence: {core, peri} as Sets of 1-based token ids —
// full strength (the selected token + its core arguments' whole phrases), one step recessed (the PERIPHERY, i.e.
// the rest of its subtree), and — everything the two Sets don't name — two steps recessed (outside the subtree).
// See coreSplit / subtreeMembers in js/diagram/diagram-core.js for what core means and why this is a tree-MEMBERSHIP
// walk and never a span/hull: with a non-projective tree (samples/brihat_jataka.conllu sentence 1) a hull holds
// tokens hanging off some other branch, which would leave interlopers bright and is the whole reason this is a Set.
// A RANGE selection takes the UNION of its tokens' splits, with core winning any overlap: a marquee reads as "these
// constituents", the same reading addMWT/rangeHead already assume for a range. Returns null when nothing is
// selected — then nothing recedes at all.
function selEmphasis(){
  if(sel.s<0||sel.s>=DOC.length) return null;
  const sent=DOC[sel.s]; if(!sent||!sent.tokens||!sent.tokens.length) return null;
  const ids=(selRange&&selRange.s===sel.s)?Array.from({length:selRange.to-selRange.from+1},(_,k)=>selRange.from+k):[gwUnitId(sel.s,sel.t)];   // gwUnitId: a goeswith continuation has no subtree of its own to emphasise (it is a fragment of a word, not a node), so the three-level emphasis is computed for the word — i.e. for its head — whichever half was clicked
  const core=new Set(), peri=new Set();
  if(typeof coreSplit!=="function") return null;
  ids.forEach(id=>coreSplit(sent,id,core,peri));
  if(!core.size) return null;   // sel.t===0 (no token selected yet) → coreSplit's range guard rejects it and nothing dims
  [...peri].forEach(x=>{ if(core.has(x)) peri.delete(x); });   // a token that is core for ONE token of a range and peripheral for another reads as core — the brighter level wins, so a range never dims part of its own argument
  return {core,peri};
}
/* IS THIS MWT THE SELECTION? — what lights every row of an MWT group in the grid, range row and components
   alike. It is mwtTieSelected (js/diagram/diagram-core.js) MINUS that function's one exception: a tie whose
   surface form is being edited draws itself unaccented, because the accent would sit under an open field on the
   very glyph the field covers. No field covers the GRID rows, so they stay lit while the form is edited — which
   is also the only state in which the grid is where you can see what the edit is doing. Everything else about
   the two tests is the same, deliberately: the grid group lights exactly when the diagram's bracket does. */
function mwtGroupSel(si,fromId,toId){ return !!(selRange&&selRange.s===si&&selRange.from===fromId&&selRange.to===toId); }
/* …and the same question asked the other way round: WHICH span, if any, is the selected MWT of the current
   sentence. An MWT is selected as a RANGE (selectMWTRange, and the grid's own range row click), and sel.t can
   only ever name ONE of its components — the first — so a diagram cell pass keyed on sel.t lit the first
   component and left the rest of the same word plain, while the grid showed the whole group filled. The two
   views state one selection, so every component takes the accent. Returns null unless the range matches an MWT
   EXACTLY: an ordinary marquee that happens to cover an MWT is a different selection and keeps the lighter .rng
   marking it already has. */
function selMwtSpan(){ if(!selRange||selRange.s!==sel.s) return null;
  const s=DOC[sel.s]; if(!s) return null;
  const m=(s.mwt||[]).find(x=>mwtGroupSel(sel.s,x.from,x.to));
  return m?{from:m.from,to:m.to}:null; }
// does this diagram cell draw a token of that span? data-gw first, for the same reason gwHolds reads it: a
// goeswith cell draws a whole WORD, and any of its parts falling in the span lights the cell.
function elInSpan(g,span){ if(!span) return false;
  const u=g.getAttribute?g.getAttribute("data-gw"):null;
  const ids=u?u.split(" "):[g.getAttribute?g.getAttribute("data-tok"):null];
  return ids.some(v=>{ const k=+v; return k>=span.from&&k<=span.to; }); }
function applySel(){
  applyZone();
  const mwtSpan=selMwtSpan();   // a selected MULTI-WORD TOKEN lights ALL of its components, not just the one sel.t names — see selMwtSpan. Declared at the TOP of this function, not beside its first heavy use: several passes below read it, and the earliest of them (.punctsat) runs before that point — a `const` read above its own declaration is a temporal-dead-zone ReferenceError, and one thrown in here would abort the whole selection pass
  document.querySelectorAll("#doc tbody tr[data-mwtfrom]").forEach(tr=>tr.classList.toggle("mwtsel",mwtGroupSel(+tr.dataset.s,+tr.dataset.mwtfrom,+tr.dataset.mwtto)));   // live, like every other toggle here: a reflow=false pick (a grid click, Tab navigation) changes the selection without re-rendering, and the group's highlight has to follow it in that same pass
  document.querySelectorAll("#doc .node,#doc .tok-group,#doc .bwtok").forEach(g=>g.classList.toggle("sel",+g.getAttribute("data-s")===sel.s&&(gwHolds(g,sel.t)||elInSpan(g,mwtSpan))));   // gwHolds, not a bare data-tok test: a goeswith cell draws a whole WORD (two or more tokens sharing one annotation stack), so selecting EITHER half lights the whole word — see the goeswith block in js/diagram/diagram-core.js. For every other cell it IS the bare data-tok test.   // .bwtok (wrapped brackets) was missing here — a selection change via a reflow=false path (e.g. grid-cell focus) left its bold highlight stuck on the PREVIOUS token until an unrelated full render happened
  const selDep=gwUnitId(sel.s,sel.t);   // a goeswith continuation's word wears the HEAD's incoming relation — see gwUnitId. Without this, selecting the second half of a word accented its two forms, its shared POS and its slur but left the very relation label above them plain, which is exactly the "a form whose annotations stayed behind" the rule below exists to prevent
  document.querySelectorAll("#doc .arc,#doc .edge-g,#doc .ghost-g").forEach(g=>g.classList.toggle("sel",g.hasAttribute("data-dep")&&+g.getAttribute("data-s")===sel.s&&+g.getAttribute("data-dep")===selDep));   // ghost edges carry the SAME data-s/data-dep contract as a real edge — without this they only picked up .sel on a full re-render, lagging behind every OTHER selection highlight (which this live class-toggle pass already updates instantly). hasAttribute guard: a ghost-g with NO data-dep at all (e.g. the Subject=Generic ∅, which has no real token of its own) must never match — +null coerces to 0, which used to false-match whenever sel.s===0 (sentence 1) && sel.t===0 (nothing selected), the common initial state
  // A DIRECTLY-CLICKED ghost (pickGhost/selGhost, js/diagram/diagram-edit.js) — SEPARATE from the .sel pass just
  // above: that one lights every ghost sharing a dependent with the current TOKEN selection (the existing "item 3"
  // rule, kept as-is); .gsel lights only the ONE ghost the reader actually clicked (data-gkind/data-gtok/
  // data-gother identify it — see wireGhostClick), which is what Delete/Backspace (js/grid/columns.js) acts on.
  // Covers both the SVG ghost-g elements and the outline's HTML .oline-ghost rows — wireGhostClick tags both alike.
  document.querySelectorAll("#doc .ghost-g[data-gkind],#doc .oline-ghost[data-gkind]").forEach(g=>{
    const other=g.hasAttribute("data-gother")?+g.getAttribute("data-gother"):null;
    g.classList.toggle("gsel", !!selGhost && selGhost.s===+g.getAttribute("data-gs") && selGhost.kind===g.getAttribute("data-gkind")
      && selGhost.tok===+g.getAttribute("data-gtok") && selGhost.other===other); });
  document.querySelectorAll("#doc .oline").forEach(g=>{ g.classList.toggle("sel",+g.dataset.s===sel.s&&(gwHolds(g,sel.t)||elInSpan(g,mwtSpan)));   // …and the MWT span for the same reason the cell pass above takes it: an outline ROW is that notation's token cell, so every component of a selected MWT lights there too.   // gwHolds for the same reason as the cell pass above: an outline row that draws a whole goeswith word lights for EITHER of its parts
    g.classList.toggle("insub", +g.dataset.s===sel.s && (g.dataset.anc||"").split(" ").includes(String(sel.t))); });
  document.querySelectorAll("#doc .punctsat").forEach(g=>g.classList.toggle("sel",+g.dataset.s===sel.s&&(+g.dataset.tok===sel.t||elInSpan(g,mwtSpan))));   // HTML folded-punctuation satellites (outline / wrapped brackets) — a satellite is drawn AS PART OF its token's cell, so it follows that token into an MWT selection rather than staying plain beside a lit form
  // item 8: a multi-word token's tie. Keyed off the COMPONENT RANGE it carries rather than off sel.t — clicking a
  // tie selects that range (selectMWTRange), which is the only thing that means "this MWT is selected"; see
  // mwtTieSelected in js/diagram/diagram-core.js, which also holds the tie plain while its editor is open.
  document.querySelectorAll("#doc .mwt-g").forEach(g=>g.classList.toggle("sel",g.hasAttribute("data-mwtfrom")&&mwtTieSelected(+g.dataset.s,+g.dataset.mwtfrom,+g.dataset.mwtto)));
  // …and the goeswith SLUR, on the same live pass. It names its word's parts in data-gw and accents when ANY of
  // them is the selection — the same "it belongs to the join, not to either side" rule the seam marks follow
  // below. Colour only: .gw-g.sel swaps the fill, never the geometry (a slur that thickened on selection would
  // be a second, geometric selection cue, which nothing in the diagrams is allowed to have).
  document.querySelectorAll("#doc .gw-g[data-gw]").forEach(g=>g.classList.toggle("sel",+g.getAttribute("data-s")===sel.s&&gwHolds(g,sel.t)));
  // multi-selection: highlight every selected token and its relation edge in the diagram + grid
  const inR=(s,tk)=>selRange&&s===selRange.s&&tk>=selRange.from&&tk<=selRange.to;
  document.querySelectorAll("#doc .tok-group,#doc .node,#doc .oline,#doc .bwtok,#doc .punctsat").forEach(g=>g.classList.toggle("rng",inR(+g.dataset.s,+g.dataset.tok)));
  document.querySelectorAll("#doc .arc,#doc .edge-g,#doc .ghost-g").forEach(g=>g.classList.toggle("rng",g.hasAttribute("data-dep")&&inR(+g.getAttribute("data-s"),+g.getAttribute("data-dep"))));   // item 3: .ghost-g joins the RANGE pass for the same reason it already joins the .sel pass above — a ghost now takes the selection accent, and a range is the selection generalised, so a ghost whose dependent falls inside a marquee must light with it. hasAttribute guard, exactly as the .sel pass documents: a ghost with NO data-dep (the Subject=Generic ∅) must never match, and +null coerces to 0.
  document.querySelectorAll("#doc tbody tr").forEach(tr=>tr.classList.toggle("rangesel",inR(+tr.dataset.s,+tr.dataset.tok)));
  // Three-level emphasis (see selEmphasis above and the .dim-peri/.dim-out note in styles/app.css): the periphery
  // of the selected token's subtree recedes one step, everything outside that subtree two. Deliberately toggled
  // HERE, on the same live class-toggle pass as .sel/.rng rather than at render time, so it tracks a drag-marquee
  // (diagram-edit.js's MARQ handler calls applySel per pointermove) instead of only appearing on a full re-render.
  // Each element is keyed by the token the level BELONGS to: a token group by its own data-tok, an arc/edge group
  // (curve AND its relation label) by its data-dep — a dependency edge is the DEPENDENT's, which is also why the
  // selected token's own incoming label is the one that takes the accent — and a bracket by the data-owner whose
  // constituent it delimits. hasAttribute guards both attributes for the reason the .ghost-g line above documents:
  // +missingAttr coerces to 0 and would false-match sentence 0 / token 0, the common initial state.
  const EM=selEmphasis();
  const mark=(el,tokAttr)=>{ let lv=0;
    if(EM && el.hasAttribute("data-s") && el.hasAttribute(tokAttr) && +el.getAttribute("data-s")===sel.s){   // data-s scopes this to the selected block: a selection never dims the sentences around it
      const id=+el.getAttribute(tokAttr); lv=EM.core.has(id)?0:(EM.peri.has(id)?1:2); }
    el.classList.toggle("dim-peri",lv===1); el.classList.toggle("dim-out",lv===2); };
  document.querySelectorAll("#doc .node,#doc .tok-group:not(.punct-sat),#doc .oline,#doc .bwtok").forEach(g=>mark(g,"data-tok"));   // …EXCEPT the folded-punctuation satellites (SVG .punct-sat is a .tok-group; HTML .punctsat was in this list) — they are keyed by their HOST, in their own pass below
  document.querySelectorAll("#doc .arc,#doc .edge-g").forEach(g=>mark(g,"data-dep"));
  document.querySelectorAll("#doc .brk,#doc .bwbr").forEach(b=>mark(b,"data-owner"));   // a constituent's bracket pair recedes with the constituent's own head
  // …AND THE TIES — a multi-word token's bracket (with its surface form, transliteration row and ExtPos
  // annotation, all inside the one .mwt-g) and a goeswith slur. Neither is keyed by a single token: a tie spans a
  // RANGE of them, so its level is the dimmest cell it spans — see tieDimLevel in js/diagram/diagram-core.js for
  // that rule and why it is max() and not min(). Without this an MWT stayed at full ink while the very tokens it
  // brackets receded around it, which read as the reconstructed word being part of the selection when it wasn't.
  // The ACCENT WINS over the level: a tie that is itself the selection (its component range, or either half of a
  // goeswith word) is never dimmed — see tieDimClass. The two states are on independent registers everywhere
  // else, but "accented AND outside the selection" is the one combination that would contradict itself.
  const tieMark=(g,ids,si)=>{ const lv=g.classList.contains("sel")?0:tieDimLevel(EM,si,ids);
    g.classList.toggle("dim-peri",lv===1); g.classList.toggle("dim-out",lv===2); };
  document.querySelectorAll("#doc .mwt-g[data-mwtfrom]").forEach(g=>tieMark(g,tieIdRange(+g.dataset.mwtfrom,+g.dataset.mwtto),+g.dataset.s));
  document.querySelectorAll("#doc .gw-g[data-gw]").forEach(g=>{
    if(g.parentElement&&g.parentElement.closest("[data-tok]")){ g.classList.remove("dim-peri","dim-out"); return; }   // the OUTLINE's slur is drawn inside its row (gwSlurHTML → .oform inside the .oline), so it already INHERITS that row's level — and the row's level is the word's, which is exactly what the slur wants. An absolute class on top of it would multiply the two opacities, the very thing the seam-mark block below applies its level RELATIVELY to avoid. Every other notation appends the slur to the diagram root, outside any cell, where it inherits nothing.
    tieMark(g,g.getAttribute("data-gw").split(" ").map(Number),+g.getAttribute("data-s")); });
  // THE SEAM MARK takes the accent too. It belongs to a SEAM rather than to either token (see the seamOwner note in
  // js/core/prefs.js), so it names BOTH of them in data-seam-toks and lights up when EITHER is selected — which is
  // exactly "inside a token selection, or immediately beside one": a mark always hangs in the gap between its two
  // tokens, so it is inside one of them or hard against it precisely when one of the two is the selection. Which of
  // the pair happens to OWN the mark makes no difference: the "de꞊" suffix belongs to the word "le" continues just
  // as much as to "de". A range selection counts the same way as a single token.
  // The accent is COLOUR ONLY, like every other selection state in the diagrams — no weight, no size, no thickening
  // (the renderers measure at the resting weight; see the "SELECTED TOKEN TEXT" note in styles/app.css).
  // Dimming: a mark ends up at the DIMMER of its two tokens' levels — a boundary can't stand out from the word it
  // is a boundary in (the same reading tieDimLevel gives an MWT bracket over its span). The level it carries is
  // ABSOLUTE, and item 8 is what made it so: while the outside level was an opacity, a class on the mark
  // MULTIPLIED with the one its cell already contributed (the mark is drawn INSIDE the cell of the token that
  // holds it — an SVG child of that .tok-group/.node, an HTML child of its .bwform/.oform), so the level had to
  // be applied as the DIFFERENCE to the cell's, and the "no difference" case had to emit nothing at all. Ink does
  // not compound: it is one colour per element, the last rule that matches wins, and a mark that restates the
  // level its cell already carries simply lands on the identical ink. So the mark now names its own level
  // outright, which is both simpler and one fewer thing to keep in step with what the cell happens to do.
  // (The stylesheet's own guard mirrors this: a seam-mark carrying a dim class is served by the same-element
  // rule at ITS fade and excluded from the cell-level descendant rule — see styles/app.css.)
  // A mark can never come out BRIGHTER than its host cell: `need` is the max over its two tokens, one of which is
  // the cell's own. It skips only an ACCENTED mark, and only in the stylesheet (:not(.sel)) — an ink override
  // would erase the accent, and the accent has to stay the one unmistakable state on the page.
  document.querySelectorAll("#doc .seam-mark[data-seam-toks]").forEach(m=>{
    const cell=m.closest("[data-tok]"), si=(cell&&cell.hasAttribute("data-s"))?+cell.getAttribute("data-s"):-1;
    const p=m.dataset.seamToks.split(" "), a=+p[0], b2=+p[1];
    const own=cell?+cell.getAttribute("data-tok"):-1;   // the cell a mark is DRAWN in is the token that owns it (see seamOwner in js/core/prefs.js)
    m.classList.toggle("sel", si===sel.s && (sel.t===own||inR(si,own)));   // OWNED, not merely adjacent: lighting on either of the two tokens a seam joins meant selecting one word lit the marks on both of its sides, so a mark belonging to the NEXT word accented along with it. A mark is part of exactly one token's rendering, and that is the token whose selection it follows
    let cls=""; if(EM && si===sel.s){ const L=id=>EM.core.has(id)?0:(EM.peri.has(id)?1:2);
      const need=Math.max(L(a),L(b2));                                                            // the level the mark should end up at — the dimmer of the two tokens it joins
      cls = need===1?"dim-peri":(need===2?"dim-out":""); }
    m.classList.toggle("dim-peri",cls==="dim-peri"); m.classList.toggle("dim-out",cls==="dim-out"); });
  // FOLDED PUNCTUATION (item 5) — a satellite takes its HOST's level, not its own token's. `show.mergePunct` folds
  // a punctuation mark off the token list and draws it glued to a neighbouring host (drawHangs/LeadsSVG →
  // .punct-sat, appendHang/LeadHTML → .punctsat); it keeps no annotation of its own, so there is nothing about it
  // left to recede independently, and its level is simply the level of the word it now belongs to. Keyed by its
  // own data-tok — which is what it WAS, since a satellite is a .tok-group/.punctsat like any other cell — the
  // mark took the PUNCTUATION token's level, and a punct edge puts that one step out from its host: a mark
  // dimmed while the very word it hangs off was the selection, which is the reported bug. data-host carries the
  // host's original id for exactly this. The ACCENT WINS, as it does for a tie (tieDimClass): a satellite that is
  // itself the selection, or inside the selected range, is never dimmed — otherwise a selected mark whose host
  // lies outside its own (leaf) subtree would come out accented AND receded.
  // ABSOLUTE, like the seam marks above and for the same reason (item 8): in the OUTLINE the satellite is
  // appended to its host's own .oline (which already carries that host's level), while in the wrapped brackets it
  // sits in the line and in the SVG notations at the diagram root, where it inherits nothing. With the levels
  // spent as INK rather than opacity, restating the level the row already carries costs nothing — the two land
  // on the identical colour — so the mark names its own level in all three cases instead of the pass having to
  // subtract whatever the cell contributed. That also RETIRES the one case the relative rule could never reach:
  // in the outline, clicking the satellite ITSELF makes it the whole selection, so its host's row is (correctly)
  // outside its subtree and dimmed — and while dimming was an opacity on that row, no rule on a child could undo
  // it, leaving the mark accent-coloured at .5. An ink on the ancestor is answerable: the accent rule on the mark
  // simply wins, and a selected satellite now reads at full accent inside a receded row.
  // ITEM 10 — the SAME pass carries the CorrectForm companion (.cform, the intended spelling drawn beside a
  // Typo=Yes token; see correctFormOf in js/diagram/diagram-core.js). It is not a token of its own — it has no
  // id, no POS, no arc endpoint — and it IS its host's own ink, but in every SVG notation it is drawn at the
  // diagram root beside the satellites, outside any token cell, so like them it inherits no level and needs the
  // class on the element itself. data-host (set at draw time) names the token it corrects.
  document.querySelectorAll("#doc .punct-sat[data-host],#doc .punctsat[data-host],#doc .cform[data-host]").forEach(g=>{
    let need=0;
    if(EM && +g.getAttribute("data-s")===sel.s && !g.classList.contains("sel") && !g.classList.contains("rng")){
      const h=+g.getAttribute("data-host"); need=EM.core.has(h)?0:(EM.peri.has(h)?1:2); }
    const cls = need===1?"dim-peri":(need===2?"dim-out":"");
    g.classList.toggle("dim-peri",cls==="dim-peri"); g.classList.toggle("dim-out",cls==="dim-out"); });
  restackEmphasis();
  positionOutlineBoxes();
}
/* RE-STACK BY EMPHASIS. SVG has no z-index — paint order IS document order — so a dimmed arc that happens to be
   later in the markup draws straight over an accented one, and the two levels stop meaning anything where the
   diagram is busiest, which is exactly where they are needed. After the class pass, reorder so that within any
   one kind the order is: outside → periphery → normal → accented. Nothing dimmed can then sit in front of
   anything undimmed, and nothing accented behind anything unaccented.
   THE ONE THING THIS MUST NOT DO is disturb the diagram's KIND LAYERING. The svg's children are a flat list in a
   deliberate order — token groups, then arc casings, then edge paths, then the labels over them — and a naive
   sort of all children would hoist an accented token above the arcs that are supposed to cross it. So each kind
   is sorted into ITS OWN EXISTING SLOTS: the set of positions a kind occupies is left exactly as the renderer
   laid it out, and only which member sits in which of those positions changes. Layer order is therefore
   invariant by construction rather than by care.
   TOKENS ARE DELIBERATELY EXEMPT. They are laid out side by side and do not overlap one another, so restacking
   them buys nothing and would only risk the draw-order decisions the renderer makes among a token's own parts
   (see the MWT transliteration-row note in the diagram code). Only the kinds that genuinely cross each other —
   arcs, edges, ghosts, brackets and ties — take part. */
const _RESTACK_KINDS=/^(arc|edge-g|ghost-g|brk|mwt-g|gw-g)$/;
const _EMPH_CLASSES=["sel","rng","dim-peri","dim-out"];
function restackEmphasis(){
  const rank=el=>(el.classList.contains("sel")||el.classList.contains("rng"))?3
    :el.classList.contains("dim-out")?0:el.classList.contains("dim-peri")?1:2;
  // kind = the element's identity with the EMPHASIS classes stripped, so the same arc sorts against its peers
  // whether or not it is currently dimmed — with them left in, a dimmed arc would be a "different kind" from an
  // undimmed one and the two would never be compared, which is the whole point of the pass.
  const kindOf=el=>{ const c=[...el.classList].filter(x=>_EMPH_CLASSES.indexOf(x)<0);
    if(!c.some(x=>_RESTACK_KINDS.test(x))) return null;
    return el.tagName+"|"+c.sort().join("."); };
  document.querySelectorAll("#doc .sblock svg").forEach(svg=>{
    const kids=[...svg.children], slots=new Map();
    kids.forEach((el,i)=>{ const k=kindOf(el); if(!k) return;
      if(!slots.has(k)) slots.set(k,[]); slots.get(k).push(i); });
    // THE RESTACK MUST NOT OUTLIVE THE SELECTION. A stable sort with every rank equal preserves the order it is
    // GIVEN, not the order the renderer produced — so once a selection had permuted an svg, clearing the
    // selection left the permutation in place until the next full render. Remember the renderer's own order the
    // first time this svg is touched, and put it back the moment nothing in it is emphasised any more.
    if((!svg.__stackOrder||!svg.__stackOrder.length)&&kids.length) svg.__stackOrder=kids.slice();   // `!svg.__stackOrder` ALONE was the bug: the first call can land on an svg the renderer has not filled yet, and the empty array it then stored is TRUTHY, so the guard never fired again and the remembered order stayed [] for the life of the element — which silently disabled the restore below (its length check could never match). Re-capture until there is something to capture
    const emphasised=kids.some(el=>kindOf(el)&&rank(el)!==2);
    if(!emphasised){
      const o=svg.__stackOrder;   // may be undefined on an svg the renderer has not filled yet — nothing remembered, nothing to restore
      if(o && o.length===kids.length && o.every(el=>el.parentNode===svg) && o.some((el,i)=>el!==kids[i])){
        const frag=document.createDocumentFragment(); o.forEach(el=>frag.appendChild(el)); svg.appendChild(frag); }
      return; }   // …and with nothing emphasised there is nothing to sort either, so this is also the early-out
    const out=kids.slice(); let changed=false;
    slots.forEach(idxs=>{ if(idxs.length<2) return;
      const members=idxs.map(i=>kids[i]);
      const sorted=members.map((el,n)=>[el,n])                       // decorate-sort-undecorate: a STABLE sort, so
        .sort((a,b)=>(rank(a[0])-rank(b[0]))||(a[1]-b[1]))           // elements at the same level keep the order the
        .map(x=>x[0]);                                               // renderer chose for them
      idxs.forEach((slot,n)=>{ if(out[slot]!==sorted[n]) changed=true; out[slot]=sorted[n]; }); });
    /* …AND THE ACCENTED ONES COME ALL THE WAY FORWARD, across kinds. Sorting within a kind's own slots is what
       keeps the layering safe, but it also means an accented element can only ever reach the front of its OWN
       kind — a selected GHOST would still sit behind every real edge, because the renderer emits the whole ghost
       pass before them. So rank-3 members are lifted out and appended last, in their existing relative order.
       Safe for the same reason the exclusion list is: only arcs, edges, ghosts, brackets and ties take part, and
       those are exactly the things that cross one another and have no layering duty toward each other. Token
       groups never move, so nothing can be hoisted over the marks that are meant to cross it. And an element's
       own label rides with it, since both carry .sel and both keep their relative order. */
    const front=out.filter(el=>kindOf(el)&&rank(el)===3);
    if(front.length){ const rest=out.filter(el=>front.indexOf(el)<0);
      const merged=rest.concat(front);
      if(merged.some((el,i)=>el!==out[i])) changed=true;
      out.length=0; merged.forEach(el=>out.push(el)); }
    if(!changed) return;                                             // the common case: don't touch the DOM at all
    const frag=document.createDocumentFragment();
    out.forEach(el=>frag.appendChild(el));                           // every child moves into the fragment…
    svg.appendChild(frag); });                                       // …so appending it re-lays the whole list in `out` order
}
/* size the subtree box to the selected node's indentation (left) and the subtree's widest content (right) */
function treeFar(box){ let l=Infinity,r=-Infinity; box.querySelectorAll(".oline").forEach(row=>{ l=Math.min(l,row.offsetLeft); r=Math.max(r,row.offsetLeft+row.offsetWidth); }); return {l,r}; }
// a band hugs the row's start edge (the indentation) and stretches to the tree's far edge — mirrored under RTL
function bandLW(box,row){ const rtl=getComputedStyle(box).direction==="rtl", tree=treeFar(box);
  return rtl ? {L:tree.l-4, W:(row.offsetLeft+row.offsetWidth)-tree.l+8}
             : {L:row.offsetLeft-4, W:tree.r-row.offsetLeft+8}; }
// item 7 — one boxed, drop-shadowed frame per reported-speech subtree in the outline. Positioned absolutely
// BEHIND the rows (z-index:0, like the selection boxes), so it never shifts a row's horizontal alignment; sized
// to the subtree's own row band. Nested reports draw an inner box within the outer one.
function positionReportBoxes(){ document.querySelectorAll("#doc .outline").forEach(box=>{
  box.querySelectorAll(".oreportbox").forEach(b=>b.remove());
  const rows=[...box.querySelectorAll(".oline[data-reproots]")]; if(!rows.length) return;
  const groups=new Map();   // reported-root OID → {rows, depth} (depth = nesting level, 1 = outermost)
  rows.forEach(r=>{ (r.dataset.reproots||"").split(" ").filter(Boolean).forEach((rt,idx)=>{
    if(!groups.has(rt)) groups.set(rt,{rows:[],depth:idx+1}); groups.get(rt).rows.push(r); }); });
  const firstRow=box.querySelector(".oline");
  [...groups.values()].sort((a,b)=>a.depth-b.depth).forEach(g=>{   // outermost first → nested boxes layer on top
    let top=Infinity,bot=-Infinity,l=Infinity,r=-Infinity;
    g.rows.forEach(row=>{ top=Math.min(top,row.offsetTop); bot=Math.max(bot,row.offsetTop+row.offsetHeight);
      l=Math.min(l,row.offsetLeft); r=Math.max(r,row.offsetLeft+row.offsetWidth); });
    const padX=3, bx=document.createElement("div"); bx.className="oreportbox";   // item 6: horizontal padding only — the box hugs the rows' top/bottom with ZERO y padding
    bx.style.left=(l-padX)+"px"; bx.style.top=top+"px"; bx.style.width=(r-l+2*padX)+"px"; bx.style.height=(bot-top)+"px";
    box.insertBefore(bx,firstRow); }); }); }   // before the first row → behind every row (z-index:0 < the rows' z-index:1)
/* ⚠ HOW FAR AN OUTLINE ROW'S OWN TOKEN GLYPH PAINTS OUTSIDE THE ROW'S BOX, in the row's own (unzoomed)
   px — and the reason the SELECTION BAND has to know. `.oline{line-height:1}` sizes a row off the font
   SIZE while a Brahmic akshara's ink runs to 1.8–2.2em (Grantha 1.824, Javanese 2.036, Balinese 2.201),
   so a deep subjoined stack reaches past the row box even after `--olpb` has taken STACKED_GAP. That
   overhang is harmless everywhere except on the SELECTED row, which is the one place the ink is inverted
   to #fff over an opaque band: the part below the band's edge is then white on the page, invisible, and
   reads as the glyph being CLIPPED. Measured over both sample sentences (Chrome and the shipping
   WKWebView agree to 0.01px): Siddhaṃ overhangs the band by 8.37px, Grantha 4.68, Bhaiksuki 2.27,
   Soyombo 1.31 — and Javanese/Devanagari/Rañjanā not at all, which is why the report named the stacked
   scripts specifically.
   ⚠ IT IS NOT THE `opacity` THE REPORT GUESSED AT, and that was worth ruling out rather than assuming,
   since the identical-sounding SVG bug two rounds ago WAS one (`opacity<1` forcing a WebKit compositing
   layer sized off getBBox() — see .tok-word's own note in app.css, fixed with fill-opacity). `.oform`
   carries `opacity:var(--script-op)` too, so the same mechanism was the obvious suspect. Probed in the
   shipping engine, offscreen WKWebView, same row and same glyph, lowest painted pixel of the descending
   tail: opacity 1 → 385.25px, opacity 0.999 (a transparency layer, no visible alpha) → 385.25, opacity
   0.5 → 385.25, and the row-level `.oline{opacity}` variant → 385.25. HTML sizes its transparency layer
   off visual overflow, not off a glyph-bounds estimate, so nothing is clipped by it at all. The band's
   own edge is the whole of it.
   ⚠ BOTH DIRECTIONS, though only the bottom has ever overflowed: measured across all seven schemes the
   worst ink TOP still sits 4.61px INSIDE the band (Grantha; Siddhaṃ 6.94, Bhaiksuki 7.61), so the `up`
   term is 0 today in every document this app can produce. It is written because it is the same
   measurement read the other way and costs nothing, not because anything asked for it. */
function olineInkSpill(row){
  const f=row&&row.querySelector(".oform"); if(!f) return {up:0,down:0};
  let txt=""; for(const n of f.childNodes) if(n.nodeType===3) txt+=n.nodeValue;   // the FORM's own text nodes — a seam mark and the goeswith slur are CHILD ELEMENTS, out of flow, and are not the word
  if(!txt.trim()) return {up:0,down:0};
  try{
    const cs=getComputedStyle(f);
    _cv.font=(cs.fontStyle&&cs.fontStyle!=="normal"?cs.fontStyle+" ":"")+(cs.fontWeight&&cs.fontWeight!=="400"?cs.fontWeight+" ":"")+cs.fontSize+" "+cs.fontFamily;
    const m=_cv.measureText(txt);
    /* the baseline, read back rather than reconstructed: a zero-size inline-block's bottom margin edge IS
       the line's baseline (the same trick foBaselineDrop uses), which needs no half-leading arithmetic over a
       face whose natural height overflows its own `line-height:1` box. */
    const probe=document.createElement("span");
    probe.style.cssText="display:inline-block;width:0;height:0;vertical-align:baseline";
    f.appendChild(probe); const base=probe.getBoundingClientRect().bottom; f.removeChild(probe);
    const rr=row.getBoundingClientRect(), z=cssZoomOf(row)||1;   // rects are VIEWPORT px (zoom applied); canvas ink metrics and offsetTop/offsetHeight are the element's OWN px — see cssZoomOf's note
    return {up:Math.max(0,(rr.top-base)/z+m.actualBoundingBoxAscent),
            down:Math.max(0,(base-rr.bottom)/z+m.actualBoundingBoxDescent)};
  }catch(_){ return {up:0,down:0}; } }
function positionOutlineBoxes(){ positionReportBoxes();
  document.querySelectorAll("#doc .outline").forEach(box=>{
  const sb=box.querySelector(".osubbox"), srb=box.querySelector(".oselrow"); if(!sb)return;
  const sub=[...box.querySelectorAll(".oline.insub")], selRow=box.querySelector(".oline.sel");
  if(!sub.length||!selRow){ sb.style.display="none"; if(srb)srb.style.display="none"; return; }
  let top=Infinity,bottom=-Infinity;   // offset* are local CSS px → correct under the block's zoom
  sub.forEach(r=>{ top=Math.min(top,r.offsetTop); bottom=Math.max(bottom,r.offsetTop+r.offsetHeight); });
  const {L,W}=bandLW(box,selRow);
  sb.style.display="block"; sb.style.left=L+"px"; sb.style.top=(top-2)+"px"; sb.style.width=W+"px"; sb.style.height=(bottom-top+4)+"px";
  const sp=olineInkSpill(selRow);   // …and the band covers whatever the row's own glyph paints outside its box — see olineInkSpill's note. 0/0 for every unmagnified document, so an ordinary row's band is byte-identical to before
  srb.style.display="block"; srb.style.left=L+"px"; srb.style.top=(selRow.offsetTop-2-sp.up)+"px"; srb.style.width=W+"px"; srb.style.height=(selRow.offsetHeight+4+sp.up+sp.down)+"px"; }); }
function positionHoverBox(row){ const box=row.closest(".outline"), hb=box&&box.querySelector(".ohovbox"); if(!hb)return;   // hover band spans to the whole tree's far edge
  const {L,W}=bandLW(box,row);
  hb.style.display="block"; hb.style.left=L+"px"; hb.style.top=(row.offsetTop-2)+"px"; hb.style.width=W+"px"; hb.style.height=(row.offsetHeight+4)+"px"; }
function dim(){}   /* hover dimming removed */
/* ONE BLOCK'S SHARE OF THE VIEWPORT — split out of the render pass so it can be re-run for a single
   block when its HEADER changes height, which happens without a re-render: the running sentence is
   edited (and wraps), its transliteration wraps with it, a translation field grows a line. Whatever
   the header takes comes off what the diagram and grid may have, so a header that grows after the
   render left the two of them still sized for the old one — overflowing the block's own cap.
   observeBlockHeader below watches exactly those three rows and calls this again. */
function capBlock(b,dh){
    const shead=b.querySelector(".shead"), dg=b.querySelector(".diagram,.text-conv"), gw=b.querySelector(".gwrap");
    const cs=getComputedStyle(b), pad=parseFloat(cs.paddingTop||0)+parseFloat(cs.paddingBottom||0),
          bord=parseFloat(cs.borderTopWidth||0)+parseFloat(cs.borderBottomWidth||0), cap=(dh-sheetGapAbove(b)-sheetGapBelow(b)-stickyHeadH(b))/FS;   // item 10: a block at the edge of a sheet is charged the page-ground gap beside it, so block+gap fill the viewport rather than overflowing it by the gap. The gaps are OUTSIDE .sblock{zoom:FS} → real px, so they come off dh before the ÷FS. Both 0 unpaged.   // …and the same charge for the STICKY boundary headings that dominate this block (stickyHeadH): pinned, they own the top of the viewport for as long as the block is in it, so block + gaps + headings must fill exactly one viewport between them. Real px too, for the same reason — the heading carries its own zoom:FS.   // a full block's border-box exactly fills the viewport. dh is REAL px; the block is inside .sblock{zoom:FS}, whose offset*/scroll* measurements below are LOCAL (unzoomed) px, so express the cap in LOCAL px too (÷FS) — then heights set here render ×FS to exactly the viewport. Recomputed each render → correct at every zoom (no-op at FS=1).
    const shH=shead?shead.offsetHeight:0;
    /* …and the boundary heading, which is now IN FLOW at the top of the block (see .bmarks in app.css) and so
       takes real height off what the diagram and grid have to share. Missing this is invisible until a block that
       opens a document sits at the viewport's height cap: the heading pushes the grid's last rows past the bottom
       edge, and only that one block in the file is wrong. Its margins count too — they are the space it opens. */
    const bm=b.querySelector(".bmarks"), bmCS=bm?getComputedStyle(bm):null,
          bmH=bm?bm.offsetHeight+(parseFloat(bmCS.marginTop||0)+parseFloat(bmCS.marginBottom||0)):0;
    const tg=b.querySelector(".tgrid"), tgH=tg?tg.offsetHeight+parseFloat(getComputedStyle(tg).marginTop||0):0;   // the translations grid sits just above the diagram → reserve its height so it (and the diagram) stay in view (Item 6)
    const gapHead=(dg&&shead)?Math.max(0,dg.offsetTop-(shead.offsetTop+shH)-tgH):0;   // whitespace gap above the diagram; the trans grid (if present) sits in this span → subtract its height so it isn't double-counted (it's charged once via tgH below)
    const gapMid=(dg&&gw)?Math.max(0,gw.offsetTop-(dg.offsetTop+dg.offsetHeight)):0;   // the diagram↔grid gap, excluded
    const addBtn=b.querySelector(".addtok"), addH=addBtn?addBtn.offsetHeight+parseFloat(getComputedStyle(addBtn).marginTop||0):0;   // the "Add token" button sits below the scrollable grid frame → reserve its height so it (and the block's bottom padding) stay in view
    /* ⚠ AND WHERE THE HEADER LEAVES TOO LITTLE, THE BLOCK GROWS — it is not capped at one viewport and
       the panes squeezed to fit inside it. A running sentence set in a magnified ornamental script is the
       case that forced this: `.stext-stacked` gives it line-height 2 so stacked conjuncts clear, the
       magnification enlarges the font too, and the two compound — measured on a four-line verse, a 216px
       header, and 61px more for the boundary heading a `newdoc`/`newpar` block carries. Against a 438px
       viewport that drove `avail` onto its floor and left the diagram 93px and the grid 47px, both
       scrolling inside a block that had room for neither. The arithmetic was right; the input was simply
       a header half a viewport tall.
       So the floor is honoured by making the BLOCK taller rather than by taking the room out of the
       panes. `chrome + avail` is exactly `cap` whenever the header leaves the floor or more, so every
       block that fits today is untouched — only one that could not fit grows, and the page scrolls
       through it as it already does for any block with both panes open. */
    const chrome=shH+bmH+pad+bord+gapHead+gapMid+addH+tgH;   // subtract the border ONCE so content fills to exactly the viewport, no more, no less
    const avail=Math.max(140, cap-chrome);
    b.style.maxHeight=(chrome+avail)+"px";
    // allocate by natural content height: the diagram gets up to 2/3 and the grid up to 1/3, but if one needs
    // less than its share the other may expand into the leftover (so neither scrolls while there's room).
    // A wrapped stemma/hierarchy reports its wanted height (scaled tree + one token row) via data-dia-nat.
    const wrapproj=dg&&dg.classList.contains("wrapproj");
    // natural heights as BORDER-box (scrollHeight is padding-box): add each element's border so a cap set to the
    // natural fully contains the content — otherwise a .5px+.5px grid border leaves it 1px scrollable (phantom)
    const diaNat=dg?(wrapproj?(+dg.dataset.diaNat||dg.scrollHeight):(dg.scrollHeight+dg.offsetHeight-dg.clientHeight)):0, gridNat=gw?(gw.scrollHeight+gw.offsetHeight-gw.clientHeight):0;
    const g=Math.min(gridNat, Math.max(avail/3, avail-diaNat)), d=Math.min(diaNat, avail-g);
    if(wrapproj){ const stem=dg.querySelector(".wp-stem"), toksEl=dg.querySelector(".wp-toks"), wp=dg._wp,
        dcs=getComputedStyle(dg), dpad=parseFloat(dcs.paddingTop||0)+parseFloat(dcs.paddingBottom||0), one=(wp&&wp.oneRowH)?wp.oneRowH:(toksEl?toksEl.offsetHeight:0),   // the true one-row height (not offsetHeight, which can't be trusted mid-layout) → the token strip is always kept to exactly one row so it stays a scroller
        dd=Math.round(d), content=dd-dpad;                       // the diagram's content box (consistent rounding, so nothing spills)
      const treeRoom=Math.max(24, content-one);                  // reserve the ONE token row first → its POS line never clips (grid or no grid)
      dg.style.height=dd+"px";
      if(stem) stem.style.height=treeRoom+"px";                  // tree fills all the room above the tokens (its own bottom level already leaves a gap over the token line); no extra "air" below the tokens → the space under the single visible token line is just the diagram's normal bottom padding, not a reserved inter-row gap
      if(toksEl){ toksEl.style.marginBottom="0px"; toksEl.style.height=one+"px"; }   // pin the strip to one row so its N rows overflow and it scrolls, grids on or off
    } else if(dg) dg.style.maxHeight=Math.round(d)+"px";
    if(gw) gw.style.maxHeight=Math.round(g)+"px"; }

/* THE BOOT SKELETON, DISMISSED (its markup and the reasoning are in index.html). Called from
   renderDoc once a render has sentences in it, and unconditionally from bootBridge
   (js/core/init.js) once the launch document has arrived — because "the document is empty"
   is also an answer, and the skeleton must not outlive it. Idempotent: after the first call
   there is no element and every later call is one failed lookup. */
let BOOTSKEL_GONE=false;
function clearBootSkeleton(){ if(BOOTSKEL_GONE) return; BOOTSKEL_GONE=true;
  const sk=document.querySelector(".bootskel"); if(!sk) return;
  sk.classList.add("gone"); setTimeout(()=>sk.remove(),200); }   // a fade, not a cut: when the cover is showing the LAST view of this document (the launch snapshot), the real one lands within a pixel or two of it, and a hard swap makes that near-match read as a flicker
/* THE VIEWPORT A BLOCK IS CAPPED AGAINST, re-applied. `blocks` is the set to re-cap, or every block
   when omitted — which is what a change in the CHROME's height needs: opening the options bar (or
   collapsing the chrome in full screen) moves .doc's top padding, so every block's share of the
   viewport changes at once, with no re-render to recompute it. Called from syncChrome (js/ui/wiring.js)
   as well as from the per-block observer below. */
function recapBlocks(blocks){
  const host=document.querySelector(".doc"); if(!host) return;
  const padTop=parseFloat(getComputedStyle(host).paddingTop||0);
  const dh=Math.max(160, host.clientHeight-padTop);   // the same viewport the render pass measures (see AVAILH)
  AVAILH=dh;   // …and keep the shared figure in step, since it is what the next render starts from
  (blocks||document.querySelectorAll("#doc .sblock")).forEach(blk=>{ if(blk.isConnected) capBlock(blk,dh); });
}
/* …and the watch itself: ONE ResizeObserver for the whole document, observing each block's header
   rows (.shead — the running sentence and its own wrap marks — .strans, and .tgrid). Re-capping is
   cheap and touches only maxHeight on the diagram/grid, neither of which is observed, so this cannot
   feed itself. Coalesced into one rAF so a burst (a field growing while its neighbour reflows) costs
   one pass, and the whole thing is a no-op where ResizeObserver is missing. */
let BLOCK_RO=null, BLOCK_RO_PEND=null;
function observeBlockHeader(b){
  if(typeof ResizeObserver!=="function") return;
  if(!BLOCK_RO) BLOCK_RO=new ResizeObserver(ents=>{
    const blocks=new Set();
    ents.forEach(e=>{ const blk=e.target.closest&&e.target.closest(".sblock"); if(blk&&blk.isConnected)blocks.add(blk); });
    if(!blocks.size||BLOCK_RO_PEND) return;
    BLOCK_RO_PEND=requestAnimationFrame(()=>{ BLOCK_RO_PEND=null; recapBlocks(blocks); });
  });
  b.querySelectorAll(":scope > .shead, :scope > .strans, :scope > .tgrid").forEach(el=>{ try{ BLOCK_RO.observe(el); }catch(_){} });
}
