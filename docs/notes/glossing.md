# Glossing from the English translation

`app/gloss_align.py`, `app/vectors.py`, `js/io/bridge.js` — the UD-space tree alignment, the semantic term and its calibration, the retrieval fallbacks, and what triggers a re-gloss.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

A sentence's `# text_en` is parsed with the bundled English model and its tree aligned with the
sentence's own, so each word is glossed by the English word standing in its structural position. The
matched **form** fills MISC `Gloss`; its **lemma** fills the lexical part of `MGloss`.

⚠ **THE MATCH IS MADE IN UD, AND THAT IS WHY THE CONVERSION IS NOT OPTIONAL.** SUD promotes function
words over their hosts and promotes *different* ones per language. Measured, on
`samples/chinese_msud.conllu` and the bundled English wheel: `This puppy is really cute!` gets a SUD
tree rooted on the AUXILIARY `is`, while 小狗真可爱 is rooted on 可 AUX — so aligning roots in SUD space
pairs two function words and strands the content words. After conversion both sides root on the
predicate (`cute` / 可爱) and the trees pair token for token. There is deliberately **no fallback to
aligning the un-converted SUD trees**: that answers a different question, and a silently worse answer
written into an annotator's document is worse than "install the grammars".

⚠ **THE GRAMMATICAL HALF OF MGloss IS STILL THE SOURCE TOKEN'S OWN.** Only the *stem* is English:
`composeMGlossPrefill(englishLemma, t.feats, t.upos, msegPrefillParts(t))`. That is what lets this
reuse the whole existing MGloss apparatus — `MGLOSS_FEAT_ORDER`, the fused `3SG`, the infix case —
without restating any of it. A closed class (`UPOS_LEIPZIG_ABBR`) takes the English word in `Gloss`
alone, exactly as `applyWiktionaryDef` already does.

⚠ **AND SO Gloss AND MGloss DELIBERATELY HOLD DIFFERENT ENGLISH WORDS** — `doubts` against `doubt`.
Every builder used to derive MGloss's stem *from the Gloss tier* inline, in three places; that is now
the one accessor `mglossLexFor(t)`, which prefers the aligner's recorded lemma (`t._glossLex`). Without
it the next unforced `mglossRefill` — fired by any form or FEATS edit — silently put `doubts.` back.
⚠️ `_glossLex` is in-memory, so `glossAdoptLexFromDoc` recovers it on open **by comparison** (a stored
MGloss stem that is not the Gloss underscored was somebody's), the `adoptStoredPicks` idiom. **That
recovery also closes a bug older than this feature**: a hand-written MGloss stem was, after a
save-and-reopen, replaced by the Gloss on the next form edit.

⚠ **THE ATTACHMENT MARK IS A SEPARATOR ONCE A STEM EXISTS, NOT A WRAPPER** (`composeMGlossPrefill`),
and this was a bug OLDER than the aligner that the aligner made ordinary. `mglossMarks` brackets the
whole string, which is right while the gloss is grammatical only — the suffix of `vir-um` glosses
`-ACC.SG.M`, the leading hyphen meaning "attaches to my left". Put a lexical part beside it and the
bracketing says something false twice: `-man.ACC.SG.M` marks the STEM as attaching leftward and joins
stem to suffix-gloss with the dot that separates two categories of ONE morpheme. Leipzig writes
`man-ACC.SG.M`. It survived because a lexical Gloss and a segmented form together used to require a
hand-typed gloss or a picked dictionary sense; the aligner fills a Gloss on every matched token, so the
pairing is now the common case and it was reported immediately. Every no-stem case is byte-identical,
which is what makes the change safe under `morphPrefillSent`/`mglossRefill`.
⚠️ **AND `mglossLexFor` MUST NOT REQUIRE `GLOSS_ON`.** The gate was inherited from the expression it
replaced, where the stem was BORROWED from the Gloss tier so no tier meant nothing to borrow. The
aligner's lemma is a second source and is on the token regardless — gating it meant the morphemic tier
alone produced no stems at all, and (with the wrapper bug above) a bare `-ACC.SG.M` that read as a
misplaced hyphen rather than as the missing word it was. Only the FALLBACK to the Gloss tier is gated.

⚠ **THREE THINGS TRIGGER IT: A TRANSLATION COMMIT, A TIER TOGGLE, AND ANY EDIT THAT MOVES THE
ANALYSIS** — the last one on instruction, and it reverses an earlier decision recorded here. The
alignment is computed against the source tree (each token's UPOS, FEATS, head and relation), so a
retag or a re-headed arc genuinely changes the answer and a gloss left standing describes a tree the
reader has replaced. It hangs off `markDirty`, the one funnel every edit passes through, which is what
makes that true of ANY attribute rather than of the edit sites someone remembered — the same reasoning
`scheduleOrthoMorph` rests on.
⚠️ **IT IS AFFORDABLE ONLY BECAUSE THE KEY IS PER SENTENCE AND SIGNS THE ANALYSIS ITSELF.** An edit
anywhere costs one string build and one comparison per sentence; the bridge is asked only about
sentences whose own answer could have moved. Measured: an edit that moves nothing the key signs makes
no bridge call at all, while a retag and a re-heading each make exactly one. Without that, a pass
costing ~9s cold and 0.26s warm, hung off every keystroke, would be unusable — which is precisely why
this was NOT hung off `markDirty` when it was first built.
⚠️ **AND IT CANNOT LOOP**, which is the obvious hazard of a pass that writes into the funnel that
triggers it: the pass calls `markDirty` when it writes, re-arming the schedule — but it has by then
stored the key it just answered, so the next run finds no work and returns without marking anything.
One idle re-check per write, verified, not a cycle.
⚠️ Debounce 500 ms, not `scheduleOrthoMorph`'s 120. `TRANS_EDIT` (raised on `.tg-text` focus),
`INLINE_EDIT_OPEN` and `inInsertBatch()` all RE-ARM rather than running: a translation is prose being
typed and every intermediate state is a different English sentence.
⚠️ `setTier`'s "on" branch is what glosses a whole document (there is no menu command; asking for a
gloss row on a translated file *is* that request).

⚠ **`glossKeyOf` IS THE QUESTION, AND IT MEANS "WHAT ARE THIS SENTENCE'S GLOSSES THE ANSWER TO".**
`glossSeedKeysFromDoc` therefore seeds it **only where the sentence already carries a gloss** — seeding
every sentence made `setTier`'s call a silent no-op (every key matched, so the pass found no work and
the tier came up empty), and seeding none re-glossed a whole file on the first translation edit
anywhere in it. Empty tier filled, written one left to its own evidence — **within a session's ordinary
editing**. Toggling a tier is the exception and overrides it (below): the rule that emerges is "editing
one translation re-derives that sentence; changing which tiers exist re-derives everything". The key signs the tree and
FEATS but **never MISC** — the pass writes MISC, so signing it would invalidate the key with the pass's
own output and re-run for ever.
⚠️ **AND REMOVING A TIER FORGETS THE KEY** (`glossForgetKeys`, in `setTier`'s off branch), or the tier
cannot be put back: `clearTierData` has just deleted the glosses the key describes, so a key left
standing claims data that no longer exists, `fillAutoGloss` finds the question unchanged, and the
re-enabled tier comes up EMPTY — reported exactly that way. Cleared for every sentence and BOTH tiers,
not just the one removed, because one pass fills whichever of Gloss and MGloss is on and so answers the
same question either way. Deliberately **not** `glossSeedKeysFromDoc()`, which re-derives keys from
whatever MISC still holds: removing only the lexical tier would leave it looking at the morphemic data,
keeping the keys, and reproducing the bug.

⚠ **A PROPER NOUN NOTHING ELSE COULD GLOSS TAKES ITS OWN LEMMA** (`_fill_propn`, on instruction). A name
is TRANSFERRED, not translated, and this module already knows more about names than about any other
class — all of it pointing the same way: `_SEM_SKIP_UPOS` excludes PROPN from the semantic term because
a name's distribution is its region and period, and `_POS_GROUP` puts it in no supercategory because a
name against a common noun is two kinds of word. The consequence is that a name the translation happens
not to contain has nothing left to match on. Writing `nārada` there says what the word IS, which is all
a gloss of a name can say.
⚠️ **LAST RESORT AND ONLY THAT**: anything that actually matched — an English name the alignment paired
it with, a dictionary sense, a vector — is better evidence than the token's own spelling and is already
in `pairs` when this runs, so it fills a gap and never competes. ⚠️ **And it is the LEMMA'S ROMANISATION
where the lemma is not Latin**: a gloss is read as English, and pasting देव or 東京 into the gloss row
states the word twice in one script rather than glossing it. MISC `LTranslit` is the lemma's own
romanisation (written by `parse._ext_misc` for a file whose FORM/LEMMA hold the native script, the UD
convention this app follows), with `Translit` — the FORM's — as the fallback for a token carrying no
lemma at all. Verified: `nārada`→`nārada`, `देव`+LTranslit→`deva`, `東京`+Translit only→`tōkyō`,
lemma `_`+Translit→`rāma`.
⚠️ **IT RAISES THE MISMATCH CONTROL, AND THAT IS NOT A REGRESSION.** A lemma gloss is
TRANSLATION-INDEPENDENT — it is the token's own spelling — so it appears whatever translation is
attached, and a sentence handed the WRONG one produces MORE of them (la 18 → 21) precisely because
fewer names align. Every one of those is still correct. The control measures "pairs produced from an
unrelated translation" as a proxy for spurious MATCHING, and this pass does not match at all; read it
here as coverage rather than as noise. Real effect: sa 45 → 47, la 38 → 39.

⚠ **A SENTENCE WITH NO TRANSLATION IS GLOSSED FROM THE VECTORS ALONE** (`_gloss_without_translation`,
on instruction) — and needs neither grew nor an English parse, so it is the one part of this feature
reachable on an install that never fetched the conversion grammars. ⚠️ `glossKeyOf` (js/io/bridge.js)
had to change with it: it returned `""` for an untranslated sentence, and `fillAutoGloss` only queues
a non-empty key, so such a document was never sent at all. The key now signs the FORMS and LEMMAS in
that case — the dictionary is keyed by lemma and the vectors by both, and neither is in `tree`.
⚠⚠ **OPEN-VOCABULARY RETRIEVAL DOES NOT WORK, AND THAT IS WHY A DICTIONARY SUPPLIES THE CANDIDATES.**
Taking the nearest English word outright fails on two counts at once. There is **no threshold**: over
52,664 candidates the tail is reached every time, so a RANDOM source word's best English cosine is
median 0.42–0.47 and p90 0.52–0.55 (la .418/.516, sa .450/.544, zh .471/.547, ar .449/.532) — and
correct glosses score in that same band (`Arma`/*arms* 0.521, `fato`/*fate* 0.421, `muni`/*sages*
0.541). And it is **~14 % right** (top-1 agrees with the aligner 6/38 Latin, 5/45 Sanskrit), with
confident plausible misses — `virum`/*cleric*, `ab`/*territories*, `kaś`/*surely*. That matches the
release's own held-out numbers; these tables were fitted to align parallel trees, not to be a
bilingual dictionary. Letting Apte supply the candidates collapses the set from 52,664 to one
headword's 2–66 senses, which is what makes a cosine mean something again: `tapaḥ` → *penance*,
`svādhyāya` → *recitation*, `vāc` → *speech*, `dharma` → *morality*, `muni` → *sages* — sentence 1 of
the Ramayana comes out **8/8 correct**, and ~80 % overall.
⚠️ **SO IT RUNS ONLY WHERE AN OFFLINE DICTIONARY EXISTS** (`_DICT_LANGS`, Sanskrit). `app/wiktionary.py`
covers everything else and is a NETWORK lookup — hundreds of round-trips in a pass that already costs
seconds. A language without one is left **unglossed on purpose**: silence is this module's preferred
failure, and a 14 %-accurate gloss in an annotator's document is worse than a blank column. Verified:
Latin with its translations stripped produces 0.
⚠️ **PRON is skipped here though the aligned pass glosses it happily** — there a pronoun takes the
TRANSLATION's pronoun, which is reliable; here it would take a dictionary sense chosen by a deictic
vector. It costs 2 good glosses to remove 11 bad ones, ten of which are the single lemma `ka` ("who")
coming back as *sense* on every one of its occurrences.
⚠️ Cost: **~5.9 s cold, 2 ms warm** on a 5-sentence file — the Apte lookups dominate and are cached by
lemma, so a long document amortises but a first pass over many distinct lemmas is genuinely slow.

⚠ **A MATCHED PAIR IS AN ANCHOR, AND THE PROBLEM IS RE-ALIGNED INSIDE IT** (`_decompose`, on
instruction). Zhang-Shasha's mapping must be ancestor-preserving and non-crossing GLOBALLY, which
refuses pairs that are perfectly good locally — `qui`/*who* scores **0.936** with both endpoints free
and is rejected only because Latin hangs `profugus` under `qui` where English hangs *exile* under
*shores*. Once (a, b) is matched, a's unmatched descendants and b's unmatched descendants are a small
problem of their own, and pairing them inside it commits to nothing about the rest of the sentence.
Iterated up to `_DECOMP_ROUNDS`, since a pair it adds is itself an anchor.
⚠⚠ **AN ANCHOR MUST BE A PROPER SUBTREE ON BOTH SIDES, AND THE ROOT IS NOT** — this is the whole
guard, and without it the pass is the global leftover sweep wearing a different name. Measured on
`samples/la_virgil.conllu` s2, the root pair `jactatus` ~ *tossed* has a source subtree of **14 of 14**
live nodes and an English one of **26 of 26**: decomposing there is the entire sentence, and it is what
paired `Multum` (which modifies the VERB) with *mindful* (which modifies *anger*). With the guard, the
wrong pair goes and all three right ones stay — `qui`/*who* 0.936, `moenia`/*walls*, `et`/*and*.
⚠️ **AND IT IS WHAT MAKES THIS PASS FREE.** Shipped first without it, this was the one pass in the file
with the mismatch control against it (Latin 18 → 21, Sanskrit 27 → 28), and that cost was reported as
the price of the feature. It was not the feature; it was the missing guard. With it, BOTH controls sit
exactly where they did before this pass existed — **Latin 18, Sanskrit 27** — for Latin 34 → 37.
⚠️ **TWO WEAKER VARIANTS WERE MEASURED AND ARE WORSE.** Gating on the TOTAL score instead of the
meaning gives **+7 real against +9 spurious** — the relation term dominates the total, so a spurious
pair with a matching relation scores 0.81 whatever it means. And simply re-running the whole edit
script with the anchors forced to cost 0 is a **FIXED POINT**: verified on all 8 sentences with the
anchors confirmed applied (11 lookups hit, 11 pairs back), because ancestor-preservation is a
CONSTRAINT — forcing a pair can only shrink the feasible set, never enlarge it.
⚠️ **The gate is the 99th percentile of chance** (`_sem_score` 0.30 = cosine 0.276, against p99 la
0.261, sa 0.278, zh 0.292, ar 0.243, fa 0.257), not the maximum `_FALLBACK_COS` clears. The weaker bar
is earned the way `_FALLBACK_COS_DICT`'s is: a candidate here has already passed the relation gate,
`_upos_compatible` and θ, and must live inside a CORRESPONDING SUBTREE, so the cosine is not carrying
the specificity alone. ⚠️ With no vector table `_sem_score` is 0.0 and the whole pass is a no-op —
measured, la stays at 34 and its mismatch control at 18 — so the relaxation reaches only the languages
that can pay for it.

⚠ **A MATCHED ENGLISH NODE MAY BE EXPANDED TO ITS SUBTREE, GIVING A MULTI-WORD GLOSS**
(`_expand_spans`). A source word often corresponds to an English PHRASE rather than a word, and a
one-to-one mapping can only hand back the phrase's head — Sanskrit is where this bites, a compound
member being a morpheme whose translation is a whole noun phrase. The frontend already takes it:
`applyAutoGloss` writes spaces as `-` into `Gloss` and as `_` into MGloss's stem, which IS the Leipzig
convention for several words glossing one morpheme, so nothing there changed. The MGloss stem stays
the HEAD's lemma — that tier wants a stem, not a phrase.
⚠️ **EXPANSION, NOT A NEW CANDIDATE, and that was measured rather than assumed.** Built first as an
extra candidate for the retrieval fallback — a phrase that could fill an UNGLOSSED token — it fired
**zero** times on both files: by then the earlier passes have glossed most of what has a vector, and
the free subtrees no longer match anything left. Widening a match that already exists is where the
value turned out to be.
⚠️ **THREE GUARDS, EACH OF WHICH WAS A WRONG EXPANSION BEFORE IT WAS A GUARD.** Nothing already used
(or two source tokens get overlapping text); never cross a `conj`/`cc`, because a coordination is TWO
things — measured, `roṣasya` expanded to *brilliance and free*; and nothing another source token wants
at cosine ≥ 0.50 — measured, `ko` expanded to *Who in this world*, swallowing the *world* that `loke`
wants. A leading determiner or possessive is trimmed (`his gods`, `his vows` were the measured cases).
⚠️ Measured yield: **2 expansions, both better than the head alone** — `cāritreṇa` → *good conduct*,
`vidvān` → *learned in the lore* — with every pair count unchanged (sa 40, la 35) and nothing else
firing. It adds no pairs and removes none; it only widens what an existing pair glosses.

⚠ **AND WHAT THE TREE CANNOT PLACE IS GLOSSED BY RETRIEVAL** (`_gloss_by_meaning`). The tables share
one space, so for a leftover token the nearest UNUSED English word in that same sentence is a gloss —
which reaches what an edit distance cannot: a Sanskrit compound member (`muni`, `jita`) is a bound
morpheme with no independent structural counterpart, but it means something and the translation says
it. ⚠️ **NO ROTATION IS FITTED, and that was measured rather than assumed.** Fitting a per-document
orthogonal Procrustes from the pairs the alignment DID make — the release's own technique — is
catastrophic under leave-one-out: top-1 goes 5/23 → **1/23** on Sanskrit and 19/31 → **4/31** on Latin,
because 23 anchors span ~23 of 128 dimensions and the rest come out arbitrary. The regularised form's
optimum is λ→∞, which *is* "do not rotate". Upstream fitted its rotations on 5,597–83,367 anchors, and
records the same lesson from the other end: a per-language PCA takes retrieval 63.8 % → 0.0 %.
⚠️ **The bar clears the chance MAXIMUM (0.50), not a percentile**, because retrieval asks ~20
candidates per token and hundreds per document, so the tail is reached routinely. Largest chance
cosine over 4,000 draws: la 0.397, sa 0.398, zh 0.435, ar 0.430, fa 0.421. At 0.40 the Sanskrit file
gains 12 glosses and its mismatch control gains 6; at 0.50 it gains 5, all correct, and the mismatch
control gains nothing.
⚠️ **AND A DICTIONARY CONFIRMATION EARNS A LOWER BAR (`_FALLBACK_COS_DICT` 0.28), because it supplies
the specificity the cosine lacks.** Where Apte independently lists the candidate English word under
the source word's own headword, the cosine need only clear the ordinary 99th percentile of chance
(sa 0.278). Measured: of 123 candidates above 0.25, Apte confirms **11**, all at 0.281–0.475 — every
one BELOW the plain bar, so it reaches none of them (`tapasvī`/*Ascetic*, `vidvān`/*learned*,
`cāritreṇa`/*conduct*, `kautūhalaṃ`/*curiosity*) — while the dangerous near-misses the plain bar only
just excludes (`ko`/*things* 0.491, `samartho`/*Indeed* 0.469) are rejected outright. Sanskrit only,
and that is about which dictionary is ON DISK: `app/apte.py` is vendored and offline, `app/wiktionary.py`
is a network lookup and cannot be asked per token. Costs ~83 ms a lookup, cached, asked lazily and
only for a source token that already has a candidate in the tier's reach.

⚠ **AN ADPOSITION THAT INTRODUCES AN OBLIQUE MAKES ITS RELATION TRANSPARENT** (`_rel_score_pair`), and
this is the single biggest cause of a missed gloss between a CASE language and a PREPOSITIONAL one. A
language marks a nominal's role with a case ending or with an adposition, and UD labels the arc by
what the nominal hangs off rather than by the role — `obj` under a verb, `obl` under a verb with
oblique marking, `nmod` under a nominal — so the same correspondence comes back under two labels and
the relation gate refuses it. Measured on `samples/la_virgil.conllu`, **six of the nineteen unmatched
tokens were exactly this**, every one a correct pair: `Arma` obj/*arms* obl:arg (0.381, just under θ),
`Italiam` obj/*Italy* obl:mod, and `oris`/`fato`/`Junonis`/`Romae` nmod↔obl:arg, which were ineligible
OUTRIGHT (MOD against COMP). The rule lifts such a pair to CLASS level, never higher — the labels
genuinely differ — and only where one side actually carries a case-marking adposition.
⚠️ **CONDITIONED ON THE ADPOSITION, NOT APPLIED TO THE TAXONOMY.** Simply putting `nmod` in `obl`'s
class was measured first and reaches the same six, but it moves `nmod` out of MOD, so `nmod` against
`amod` — two ways of modifying a noun — would stop being comparable at all. With the scoped rule in,
the blanket one adds **nothing** on top (34 pairs either way), so it is strictly subsumed.
⚠️ **AND THE ADPOSITION ITSELF STAYS IN THE POOL.** The other reading of "let it pass through" —
dropping a `case` adposition the way PUNCT is dropped — was built and measured and is WORSE: **26
pairs against 27**, because it loses `ab`/*from* (a gloss a reader wants) and recovers nothing, a
`case` marker being a leaf whose removal changes no structure. Glossing it from its host's match
instead does not rescue it either, the host being precisely what was unmatched.
⚠️ **Measured end to end on the Latin sample: 27 → 31 pairs from three UPOS corrections in the sample
itself, then 31 → 34 from this rule.** Three pairs are rescued directly (`Arma`/*arms*, `fato`/*fate*,
`Romae`/*Rome*); three more follow from the re-optimisation those enable (`profugus`/*exile*,
`atque`/*and*, `moenia`/*walls*); and three correct pairs are LOST to the same re-optimisation
(`qui`/*who*, `dum`/*until*, `urbem`/*city*), which is the ordered TED trading a locally-good pair for
a cheaper whole script. Net +3, and 32 of the 34 are correct by hand. zh and ar are untouched, and the
MISMATCH control went 18 → 17 — it invents nothing.

⚠ **AND THE STRUCTURE IS NO LONGER THE ONLY EVIDENCE — WHAT THE TWO WORDS MEAN IS WEIGHED BESIDE IT.**
`app/vectors.py` holds thirteen cross-lingually aligned tables (`sud_vec_<lang>_128d.npz`, the
`vectors-v0.1.0` side assets of `sud-spacy-parsers`) in ONE shared 128-dimensional space with
unit-length rows, so a dot product between any two of them IS a cosine; `_sem_score` is the fourth
term of `_pair_score`. ⚠️ **The tables are fetched WITH THE PARSER, not on their own** —
`models_registry._ensure_vectors`, beside `_ensure_side_data`'s vidyut branch — because "download the
Chinese model" and "be able to gloss Chinese from its translation" ought to mean the same thing. The
ENGLISH HUB is fetched alongside every other language: every table is placed in en's space by an
orthogonal Procrustes rotation, and a table with nothing to compare it to is useless (upstream's own
"only useful two at a time" is why they are side assets rather than wheel contents; the fastText ones
are also CC BY-SA where the la/ta/te wheels are CC BY-NC-SA). A failure is a WARNING, never an error:
the model parses exactly as well without them.

⚠ **BOTH THE FORM AND THE LEMMA ARE LOOKED UP, ON BOTH SIDES, AND THE TWO ROWS ARE AVERAGED**
(`vectors.token_vector`). `key_attr` says what an asset was BUILT from, not what to ask it for — a
form-keyed table of an inflected language holds plenty of lemmas too, because lemmas are words — and
reading it as an instruction threw half the evidence away. Measured over the 37 pairs the aligner
produces on the three samples, form-only against the mean: **median cosine 0.288 → 0.321**, and the
10th percentile 0.019 → 0.050, which is the point — a form-keyed table's weakest answers are exactly
the heavily inflected tokens whose lemma it does hold (`venit`/*came* 0.455 → **0.610**,
`passus`/*suffered* 0.430 → 0.549, `لمدرسة`/*school* 0.535 → 0.691). A few lose (`الولد`/*boy*
0.551 → 0.487), which is what an average is for. ⚠️ **AVERAGED, NEVER MAXIMISED: a max over k draws is
a noise generator.** Best-of-the-four-combinations moves the MEDIAN of pure chance 0.008 → **0.105**
and its 90th percentile 0.142 → 0.224, costing more margin than the better gold score wins back —
gold-minus-chance is 0.146 for one key, 0.101 for the max of four, 0.141 for best-of-like-with-like,
**0.166 for the mean**. The mean is also a SINGLE draw, so the calibration below keeps meaning what it
says.

⚠ **THE COSINE IS NOT THE SCORE; A RAMP BETWEEN TWO MEASURED CUTS IS.** Random (source, English) TOKEN
pairs under the rule actually in use — 4 000 per language, two random keys each, top-20 000 rows —
have median cosine 0.004–0.051, 90th percentile 0.136–0.180 and 99.9th 0.314–0.372, while real
translation pairs from the samples sit at 0.44–0.69 and the wrong pairings in the same sentences at
0.08–0.29. So `_SEM_LO` (0.18) is the **highest per-language** 90th percentile of CHANCE — the highest
rather than the pooled figure, so the cut is honest for zh, whose floor is the highest of the four —
and `_SEM_HI` (0.50) is above every 99.9th; the term ramps linearly between. Reading the raw cosine
would spend the whole budget on a band the signal never uses: it leaves a correct pair and a chance
one 0.17 apart where the ramp puts them 0.50 apart. ⚠️ `_SEM_LO` went 0.15 → 0.18 when the lemma
joined the lookup, which is the calibration doing its job rather than a tuning: averaging in a second
key lifts chance along with everything else (zh 0.157 → 0.180), and a cut left at 0.15 would have sat
below the noise for one of the four languages. It costs a typical correct pair almost nothing (the
gold median maps to S = 0.44 rather than 0.47), and isolating the two changes shows the threshold move
is inert on this data while the lemma is what alters any answer.

⚠ **A PROPER NOUN IS NOT SCORED ON MEANING, AND THAT IS MEASURED RATHER THAN ASSUMED.** A name's
distribution is its REGION AND PERIOD, not its identity, so the table hands back the other names that
keep it company. Gold rank of the correct English name among the 50 nearest, `la`→`en`: `troiae`/Troy
**>50** (peloponnese .46, laconia .45, aeneas .44), `italiam`/Italy **>50** (normans, lombards,
morea), `lavinia`/Lavinian **>50**, `latio`/Latium **>50** — against rank **1** for `litora`/shores,
`arma`/arms and `bello`/war. A common word's wrong neighbour is a near-synonym and still points the
right way; a name's is a different place, confidently. Consequence, measured: over the 20 source nodes
with more than one eligible English candidate on the three translated samples, lifting the exclusion
moves the argmax once — `Lavinia` from *Lavinian* to *Troy* — and that one is wrong; with it, none.
⚠️ **AND THE LEMMA DOES NOT RESCUE A NAME, which was the obvious thing that might have**: under the
mean of form and lemma, `Troiae`/Troy is still >50 (aeneas .51, theseus .51), `Latio`/Latium still
>50, `Teucrorum`/Trojans still >50, and `Lavinia` has no lemma row at all — only `Italiam`/Italy moves,
>50 → 18. The exclusion is about the word CLASS, not about the inflection.

⚠ **WITH NO TABLE, EVERY PAIR SCORES WHAT IT WOULD IF THE TERM DID NOT EXIST, AND `_weight_invariants`
ASSERTS THE CONDITION FOR IT.** The term is additive with a zero default, so that holds only while
`W_FEAT`, `W_ORD` and `THETA` keep the exact values they had before it existed — a document with no
table would otherwise be re-scored against a threshold calibrated for a sum it no longer produces.
Verified against HEAD's own copy of the module when the term landed (**4 of 4 translated samples
identical**) and guarded since by that assertion, which is now the standing check: the module has
deliberately changed elsewhere (`_rel_score_pair`), so a diff against an older copy no longer isolates
this property. That is what makes this safe to ship for the languages the release does not cover,
which is most of them; the same reasoning makes ABSENCE NEUTRAL rather than a penalty, since the three weakest tables
(sa 11.5 %, lzh 6.8 %, yue 10.7 % held-out P@1) are exactly the languages this app cares most about
and there a silent word is far more often absent than wrong.

⚠ **IT RANKS; IT DOES NOT OVERRULE.** A fourth invariant bounds the whole non-relational half of the
sum below one relation-CLASS rung (`W_SEM + W_FEAT + W_ORD < W_REL*(R_BASE − R_CLASS)`), so two words
may mean exactly the same thing and still not be each other's gloss if one is a subject and the other
a complement. The rung it MAY cross, with agreeing features, is the relation SUBTYPE — deliberately:
`obl` against `obl:tmod` is a language-particular refinement, and which word a word actually MEANS is
better evidence than which of the two trees happened to write the refinement. On the samples that
branch has never fired: of the 44 pairs produced, 37 sit on the `exact` relation rung, 4 on `base` and
3 are rescued by the adposition transparency above — none on the supertype rung. Note which mechanism
does the work that looks like this one: `Arma`/*arms* is made class-level by the adposition rule, which
is evidence-conditioned where the supertype widening is not.
⚠️ **Measured, it decides two competitions the structure cannot and is right both times**: over the 27
source nodes with more than one eligible English candidate it moves the argmax twice — `fato` from
*exile* (0.492) to **fate** (0.559), and `saevae` from *mindful* (0.810) to **cruel** (0.899). `saevae`
is the textbook shape: two English ADJ `amod`s in one sentence, structurally indistinguishable, told
apart only by what the words mean. Counts are 34 / 6 / 4 either way, zh and ar unchanged word for
word, and the Latin membership moves by two (gains `fato`/*fate* and `profugus`/*exile*, loses
`qui`/*who* and `oris`/*shores*, all four correct) — so the COUNT is a wash and those two argmax
corrections are the real gain. The English identity control is unmoved at 48 pairs / 44 to themselves
with mean score rising 0.827 → 0.911, and a MISMATCH control gives 17 / 1 pairs either way — it
manufactures nothing. Cost 89 ms against 87 ms warm, i.e. below noise, plus 136 ms once to load a
table. Do not expect the pair COUNT to move much and do not read that as "the term does nothing":
no-crossing settles most sibling competitions before a score is consulted, so what a better score buys
is mostly WHICH gloss wins.

⚠ **THE LOOKUP IS OF THE CONVERTED UD TOKEN, WHICH IS THE OPPOSITE OF THE RULE THE GLOSS ITSELF
FOLLOWS.** The FORM and LEMMA written into MISC are read off the UNCONVERTED parse (the conversion has
no business rewriting a spelling); a vector lookup wants a WORD, and mSUD→UD is precisely the
direction that fuses morphemes back into words. Measured on `samples/chinese_msud.conllu`: the source
tokens are 问 and 题 separately, scoring 0.30 and nothing at all against English *questions*, while the
fused UD node 问题 scores 0.42. SUD→UD fuses nothing, so for every other document the two readings are
the same string. ⚠️ And the vector is looked up ONCE PER NODE, in `_tree`, not inside `_pair_score`
which the DP asks O(n·m) times over; `ren` is memoised on (i, j) for the same reason.

⚠ **THREE THINGS ABOUT AN ASSET CANNOT BE GUESSED** and are read off its own `meta` by the vendored
reader (`app/_aligned_vectors_vendor.py`), never re-derived here: whether keys are lowercased (worth
31 points of English type coverage), whether the table is keyed by FORM or by LEMMA (`sa` is the one
keyed by lemma — Apte is keyed by stems, and Sanskrit inflection makes a form-keyed table mostly
hapax), and whether a `key_norm` orthography fold applies (`la` is the one that has one: its treebanks
are u-dominant while every Latin corpus spells with `v` and `j`). `vectors.lookup` is the one place
this app asks a table which of form and lemma it wants.

⚠⚠ **THE EXACT-UPOS GATE IS NOW A THREE-WAY COMPATIBILITY TEST, ON INSTRUCTION — the paragraph below
records the strict rule it replaced.** `_upos_compatible` admits a pair when the classes are equal,
when they sit in one SUPERCATEGORY (`_POS_GROUP`: NOMINAL = NOUN/PRON, PREDICATE = VERB/AUX,
MODIFIER = ADJ/ADV/NUM), or when `_sem_score` clears `_CROSS_POS_SEM` (0.55) and vouches for the
crossing. What a word class is FOR cross-linguistically is telling nominals from predicates from
modifiers; the distinctions inside a group are where two treebanks' conventions differ over one word
(Latin `primus` ADJ against English *first* ADV — the same word modifying the same verb). Function
words are in no group deliberately: their tagging is stable and their vectors are the weakest in any
table, so they keep the strict rule. ⚠️ **With no vector table `_sem_score` is 0.0**, so the rule falls
back to "same group or nothing" — a language the release does not cover keeps something at least as
strict as before, which is what makes this safe to ship.
⚠️ **PROPN IS IN NO GROUP, though it is as "nouny" as a noun gets, and that was measured against this
table's own first draft.** A NAME against a COMMON NOUN is two kinds of word, not two conventions for
one — and PROPN is precisely the class `_SEM_SKIP_UPOS` excludes from the semantic term, so leakage
there is the one kind nothing can check. With PROPN inside NOMINAL, sentence 1 of a Ramayana file has
its names ROTATE (`tapasvī`→*Valmiki*, `vāc`→*Narada*, `nāradaṃ`→*practice*), 1 correct of 9; with it
outside, the same sentence gives ~5 of 7. It also takes the MISMATCH controls back down — **Latin 21 →
18, i.e. the strict gate's own level** — for a cost of 3 Sanskrit pairs and nothing elsewhere.
⚠️ **Measured, against the strict gate and against dropping it entirely** (sa / la / zh / ar, then the
two mismatch controls): strict **29 / 34 / 6 / 4, MIS 20 / 18**; no constraint at all
**45 / 37 / 7 / 4, MIS 38 / 25**; this rule **40 / 35 / 7 / 4, MIS 27 / 18**. It recovers
`primus`/*first* by leakage; `căno`/*sing* and `memorem`/*mindful* need a full crossing the meaning
does not vouch for at 0.55, and stay unglossed.
Reinstating UPOS as a graded TERM was also measured and recovers nothing: at every weight from 0.20 to
0.50 the mismatch control stays at 34–37, because θ sits far below what an exact-relation pair scores,
so the term never excludes anything. The gate was doing the excluding. ⚠️ **Measured, it is a clear win on Latin and a
material precision LOSS on Sanskrit, and both halves matter.** `samples/la_virgil.conllu` goes 34 → 37
and all three gains are correct — `căno`/*sing*, `memorem`/*mindful*, `primus`/*first*, exactly the
tokens the gate refused over a TAGGING disagreement rather than a real one. But the MISMATCH control
(every sentence handed a different sentence's translation, so every pair is spurious by construction)
roughly doubles: Sanskrit **20 → 40**, Latin 18 → 25. On a Ramayana file the Sanskrit output goes 24 →
49 pairs while hand-checked precision falls **~50 % → ~41 %**, and previously-correct glosses are
corrupted (`tapaḥ`/*austerities* → *Ascetic*, `ahaṃ`/*I* → *great*): with relation and order the only
structural evidence left, a free translation whose tree is not parallel gets scrambled.
⚠️ **THE PRECISION-SAFE ALTERNATIVE IS ONE `if` AWAY AND IS MEASURED**: make the gate CONDITIONAL —
classes may differ only where `_sem_score` clears 0.55 — which gives sa 29 → 32, zh 6 → 7, Latin
unchanged, and **both mismatch controls unchanged**. It does not reach the three Latin gains, so it
answers a different request; it is recorded in `_pair_score`'s own comment for whoever revisits this.
⚠️ Reinstating UPOS as a graded TERM was also measured and recovers nothing: at every weight from 0.20
to 0.50 the mismatch control stays at 34–37, because θ sits far below what an exact-relation pair
scores, so the term never excludes anything. The gate was doing the excluding.

⚠ **THE WORD CLASSES MUST MATCH EXACTLY, ON INSTRUCTION, AND THAT MAKES UPOS A GATE RATHER THAN A
SCORE.** It used to be graded — exact, then a NEAR-POS table of pairs where two languages routinely
realise one meaning under different classes (`{ADJ,VERB}` for Chinese stative verbs against English
adjectives, `{ADV,PART}` for 没 against *n't*), then bare open/closed agreement. The table and the
grading are both gone: a class disagreement is now ineligible at any relation with any features.
⚠️ **WHAT IT COSTS IS MEASURED**: over the three translated samples, **43 mapped pairs → 37**. The
losses are real words — 没/*n't*, and Latin `căno`/*sing* because the English model tags "sing" as a
NOUN in that verb-initial line. Nothing is glossed WRONGLY by the change; the answer is silence, which
is this module's preferred failure everywhere else, and the rule is far more predictable.
⚠️ **`nsubj` STILL DOES NOT SHARE A CLASS OR A SUPERTYPE WITH `obj`**, though UD files both as "core
arguments": measured on `samples/la_virgil.conllu`, that conflation put Latin `Arma` (the OBJECT of
`căno`) under English *I*. The two gates are now "same word class outright" and "relations relatable";
neither is a score, and an ineligible pair is not a low-ranked one but no candidate at all.

⚠ **THE WEIGHTS ARE FOUR INEQUALITIES, ASSERTED AT IMPORT** (`_weight_invariants`), not literals. The
first — an exact-relation pair must beat a base-relation one however good its features and position —
**failed by a hundredth twice**: once under the original two-signal weights (0.80 against 0.81), and
again when UPOS became a gate and the relation inherited its share (0.80 against 0.815). Neither would
have been found by reading the table. With one structural signal left, the threshold now states one
thing only: the relations must agree at least at CLASS level, since features and order can no longer
be weighed against a second structural term. ⚠️ **The fourth was added with the semantic term and is
what bounds it** — `W_SEM + W_FEAT + W_ORD < W_REL*(R_BASE − R_CLASS)` — and a fifth assertion pins
`W_FEAT`/`W_ORD`/`THETA` to the exact values they had before that term existed, because "with no
vector table the answer is the old answer" is a property of those three numbers and nothing else.

⚠ **THE ALIGNMENT IS A TREE EDIT DISTANCE (Zhang–Shasha), NOT A ROOT-DOWN DESCENT**, and the change was
a simplification as much as a change of answer. The descent walked the two trees in step, solving an
optimal assignment over each pair of sibling sets — but because it only ever compared children of an
*already-matched* pair, one unmatched intervening node (an English auxiliary the source realises as a
suffix) severed the whole subtree below it. That needed a bounded one-level "lift" to rescue, and a
uniqueness sweep to rescue what the lift could not reach: two special cases with their own thresholds,
patching one structural blind spot. An edit distance has no such blind spot — an intervening node the
other tree lacks is simply a DELETION, and its children stay free to map at any depth. The lift, the
sweep, `_THETA_LIFT` and the hand-written Hungarian solver they were built around are all gone.
⚠️ **The threshold is enforced INSIDE the DP, not as a filter over its output**: a pair below θ (or
failing the two-signal gate) is priced at `_BIG`, above delete+insert, so the optimisation cannot buy
structure with a match this module would refuse to report.
⚠️ **CHILDREN ARE SORTED CANONICALLY, NOT BY WORD ORDER, and that is what makes an ORDERED TED usable
across languages.** Zhang–Shasha's mapping may not cross, so two siblings map only if they appear in
the same relative order on both sides — and surface order is precisely what differs between languages
(Latin puts its object first, English does not), so ordering by token index would forbid the very
matches this exists to make. Children are ordered by relation class, then relation, then UPOS, with the
token index only as a last resort to keep the order total: the no-crossing constraint then says
something language-neutral (a subject may not take a complement's slot). Unordered TED is the obvious
alternative and is NP-hard, so it was never on the table.
⚠️ **Measured against the descent it replaced**, over the three translated samples: 43 mapped pairs
against 45, i.e. slightly lower recall for better precision — TED corrects `ab`→*from*, `vi`→*power*
and `superum`→*gods*, all three of which the descent got wrong, while losing `Italiam`, `urbem` and
`dum`. Identity (a sentence aligned against itself) stays exact: 67/67 tokens, every one to itself.

⚠ **mSUD→UD MERGES TOKENS, SO THE MAP BACK IS NOT POSITIONAL.** `convert.py` records that a grew rewrite
never inserts or deletes a token, and that is true of SUD→UD and **false for mSUD**: measured,
`samples/chinese_msud.conllu` goes 6 tokens in, 5 nodes out (问+题 → 问题). A MISC `SrcTok` stamp is the
primary strategy — measured through a real conversion before being relied on, it survives intact, and a
FUSED node comes back carrying exactly ONE stamp, its head morpheme's, which is precisely the
representative wanted. Positional identity is the fallback; where neither answers, nothing is written.
The stamp rides a **deep copy** and is never stripped, because it never reaches the document.

⚠ **THE FIRST CALL OF A SESSION COSTS ~9 SECONDS, AND ALL OF IT IS DEPENDENCY LOADING.** Profiled on
`samples/la_virgil.conllu`: loading the English spaCy model **8.44s**, spawning grew's OCaml backend
**0.65s**, the whole pass once both are warm **0.26s**. `app/__main__.py` therefore **warms the English
model in a daemon thread at launch** — unconditional, because which of the two English-model features a
reader reaches for (this one, or `wiktionary`'s definition flyout) is not knowable then, and a
conditional warm-up just moves the wait to whichever case the condition missed. grew is deliberately
NOT warmed with it: 0.65s does not justify spawning an OCaml process at every launch. `parse.warm()`
is silent by design and `_load_spacy` gained a lock, since that warm-up is the first thing in this app
to load a model concurrently with a real parse. The busy label still hedges on the first run — a bare spinner for ten seconds and no other sign is indistinguishable from a
broken feature, and was reported as exactly that ("I see 'Glossing from translation…' and then nothing
happens"). ⚠️ **And the bridge call is raced against a clock**: `hideBusy()` lives in a `finally`, so a
promise that never settles leaves the indicator up for the life of the session. Measured once on a
loaded machine: no answer after 60s, and a `setTimeout` armed for 60s did not fire for **152s** — the
whole web view starved, not just this call. On the timeout the pass gives up, says so, and leaves the
sentence's key UNSET so the next trigger retries.

⚠ **CONVERSIONS ARE SERIALISED BEHIND A MODULE LOCK.** pywebview dispatches every JS→Python call on its
own thread without serialising them, while grewpy talks to ONE backend over ONE socket — two windows
glossing at once would race on that connection. Same reasoning as `Api._dialog_lock`.

⚠ **A HIDDEN-WINDOW WKWebView PROBE DEADLOCKS ON THIS PATH** and is not the way to test it: the pass
holds the GIL inside grew for seconds while the probe thread needs the main run loop to service
`evaluate_js`, so the poll starves. Drive the real frontend in headless Chrome against a **stubbed
bridge serving the real `gloss_align` answers** (captured from a live run) — that keeps every frontend
line under test and pairs with a Python-side end-to-end run.
