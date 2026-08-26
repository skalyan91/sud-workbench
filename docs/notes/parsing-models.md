# Parsing, models, and on-demand extras

`app/parse.py`, `app/models_registry.py`, `app/extras.py` — the two engines, where multi-word-token ranges come from, SUD's own MISC layer, and how heavy tiers install themselves.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

`app/parse.py` runs two engines in-process: **SUD spaCy** packages (`en_sud_ewt_gum`, …) and **Stanza
UD** via `spacy-stanza`, post-converted UD → SUD with grew and with multi-word tokens reconstructed
(`_reconstruct_mwt`). Model ids are engine-qualified — `sud:<package>` / `stanza:<lang>#<package>`.
No model → whitespace tokenisation. `app/parse_sud.py` is only a back-compat shim.

**MWT ranges come from FOUR places, in this order of trust.** Stanza *has* a multi-word-token
layer (`Token.words` / `Word.parent`, the expanded words carrying `start_char = None` because they
aren't substrings of the text), so its ranges are read straight off the pipeline. A spaCy model
whose tokeniser is a **custom callable** can publish its own via the `doc.user_data["mwt_ranges"]`
= `[(first, last, surface), …]` convention (+ `["source_text"]`), which `_mwt_from_doc` honours —
`ar_sud_padt`'s CAMeL clitic tokeniser is the first, and `scripts/ar_tokenizer.py` in the
**SUD-spaCy** repo is where it's written, so a change there needs the wheel repackaged. Failing
that, a tokeniser that publishes SOURCE SPANS (`doc._.src_spans`) has its ranges DERIVED from them
by `_src_span_layout` — an orthographic word is a run of tokens whose spans fall in one
whitespace-delimited chunk of the raw input, which is what a multi-word token IS; that is where
`sa_sud_vedic_ufal_dcs`'s ranges come from. Only when
nothing is published does `_reconstruct_mwt` **infer** ranges from spacing + the tagger's PUNCT
labels. That fallback is sound for spaCy's *rule-based* tokeniser and only there: it concatenates
component surfaces to build the range form, which is exact because a `Tokenizer` cannot emit a
non-substring token (`retokenize().split()` raises E117), whereas a custom tokeniser builds its Doc
from a word list and is under no such constraint. Absent key = infer; `[]` = a positive "no MWTs".

That E117 guarantee is about the range **form**, not about whether the run is an MWT at all, and in
a **spaceless script it is not** — there the segmenter's output *is* the word layer, so a run of
tokens with no space between them is a phrase. `_spaceless_script` therefore vetoes any inferred
range whose letters are all CJK/kana/Thai/Lao/Khmer/Myanmar/Tibetan, **per run** rather than per
document, so `我用 Python 编程` still treats its Latin run normally. This replaced a `len(chunks) < 2`
test that meant to do the same job but tested the *whole input* while the rule it guarded ran *per
chunk*: one space anywhere disarmed it and every CJK chunk was swallowed whole (`zh_sud_gsd_simp_trad`
and `lzh_sud_kyoto` reach the fallback — stock spaCy tokenisers publish nothing; the Stanza zh/ja
pipelines have no `mwt` processor and were never affected). Dropping the chunk test also let the
genuine single-chunk case through — a bare `don't` is one orthographic word, and an MWT.

**SUD'S OWN MISC LAYER IS PREDICTED TOO**, by components of the model's own
(`sud_subject`/`sud_subject_rule`, `sud_reported_rule`, `sud_idiom`), and it arrives on ONE spaCy
extension — `Token._.sud_misc`, a **dict**, which is why `_SUD_MISC_KEYS` folds it in `_ext_misc`
separately rather than as another `_TOKEN_MISC_EXT` row. Four keys: `Subject=SubjRaising|ObjRaising`
on the embedded predicate whose subject is raised, `Reported=Yes` on a speech verb's verbatim
complement, `Idiom=Yes` on an idiom's head (which also carries `ExtPos`) and `InIdiom=Yes` on its
other members (which attach by `unk`). **The app already drew all of that** — `subjGhostTarget`'s
dashed edge, `isReported`'s subtree lifted off the line, the `:xsubj` pair `depsAutofill` writes on
save — from annotation the reader had to make by hand; what was missing was the parser's own answer,
which `spacy convert` discards on the way IN (it reads MISC for `SpaceAfter=No` and the NER pattern
only), so upstream had to hoist it through FEATS at training time and publish it on an extension at
inference. MISC and not `token.morph`, deliberately, on both sides: a MISC feature must never
masquerade as a morphological one. Which keys a wheel carries is a per-language empirical choice
recorded in SUD-spaCy's own CLAUDE.md (zh ships no `Subject`; fa/la no `Reported`; the four
treebanks that annotate no idioms no `Idiom`), so **an absent key means "this model says nothing
here", never "no"**.

⚠ **AND THE WHOLE OF IT IS GATED ON `AUTOREGEN`** (js/core/prefs.js), the options bar's own
**Auto-regenerate** checkbox — on by default, persisted in PREFS. It gates the two funnels that consult
the MODEL and nothing else: `reparseTokenFields` and `headSyncDeprel`, each answering the same `false`
they already answer with no model installed, so every caller's degradation path is one the app has
always had. NOT gated: transliteration, `app/macron.py`'s display layer, `retargetGlossForFeatsChange`,
`msegRefill` — none of those is the parser having an opinion, all of them run with no model, and
stopping them would leave the annotation rows disagreeing with the fields beside them. The head-0 ⟺
`root` rule is likewise ungated: it is an invariant of the annotation, applied by `afterHeadEdit`
itself before `headSyncDeprel` is ever reached.

⚠ **A RE-PARSE OF ONE TOKEN'S FIELDS MUST NOT TAKE THEM.** All four are read off the tree the model
itself produced, and `reparseTokenFields` (`SUD_TREE_MISC`, js/io/bridge.js) adopts none of the
parser's heads or relations — it re-derives the model-derived FIELDS on the reader's own tokens. So
those four answers describe a tree discarded a line later, and a fresh `Subject=SubjRaising` drawn
as a ghost edge across an attachment the reader made themselves is not a weaker annotation but a
claim about a different sentence. They are cleared from the parser's MISC there and the reader's own
restored by the `keep` list; only a FULL parse (`doInsert`/`insertParsed`/`reparse`/`commitSentText`,
which replace `s.tokens` wholesale together with the tree they belong to) takes them verbatim.

⚠ **AND "RESET PARSE" (⌘R, and the block's own control) RE-ANALYSES THE TOKENS THAT ARE THERE — IT DOES
NOT RE-TOKENISE.** It used to run `applySentText`, i.e. `commitSentText`'s body with the string held
fixed, so it re-segmented `# text` from scratch and took the tokeniser's own MWT ranges with it. That
is the wrong operation: SEGMENTATION IS THE ANNOTATOR'S, and asking for a fresh parse is not asking to
revisit it — a reader who had split a compound, merged a clitic or grouped a multi-word token by hand
had all of it silently reverted by the one control that says it is about the *parse*. `reparse` now
holds the forms, `s.mwt`, `s.empties` and `# text` fixed and goes through `parse_pretokenized`
(`Api.parse_tokens`) instead, alignment 1-to-1 by construction. **Only an edit to the running sentence
or to the grid re-tokenises**, because those are the two gestures that change what the words are.
Three consequences worth knowing. It sends **no `upos`** (unlike `reparseTokenFields`, which constrains
the model to the reader's tags because it is refreshing the fields around an edit they just made — a
RESET must not keep the classes it is being asked to reconsider). It **restores the spacing MISC
verbatim** — `SPACING_MISC` = SpaceAfter/SpacesAfter/SpacesBefore/NewPar — because a Doc built from a
word list has no running text to read spacing off and simply says nothing, and taking that answer would
drop every `SpaceAfter=No` in the sentence, which in a spaceless script is the whole of the spacing and
is also what an MWT range's re-fusion reads. And **with no model it says so and does nothing**, where
the old body degraded to a whitespace re-tokenisation — precisely the thing this command may no longer
do. `applySentText` lost its `force`/`scroll` options with their only caller.

⚠ **THE WHEELS GAINED THIS WITHOUT A VERSION BUMP**, so an environment built before them never
refreshes: `requirements-core.txt` pins the English wheel by release URL at one version, pip sees
that version installed and skips it, and the per-user venv is built once and gated behind `.sud-core-ready`
anyway. A downloaded model has the same problem through Manage Models, which reports it installed.
Symptom: a parse that marks nothing, on a build that plainly contains this code. The resets are in
README's "Resetting an install" table — remove-and-redownload for a downloaded model, `rm -rf …/venv`
for the bundled one. **Check the pipeline, not the version**, when diagnosing:
`nlp.pipe_names` either lists the `sud_*` components or it does not.

## Custom models: one wheel, one embedding row each

`app/generic_models.py`. A **custom model** in this app is not another wheel — it is one ROW of
`xx_sud_generic`'s embedding table, fitted for a language of the reader's choosing and stored as 128
floats in `APP_DATA/custom_models/index.json`. That is what makes "as many as they like" honest: the
wheel's own `adapt_lang_embed` writes a whole 45 MB `nlp.to_disk` per adapted language, and this
module deliberately reuses its **freeze** (the optimizer wrapper that zeroes every non-embedding
gradient, plus the drift assertion — if any frozen parameter moved, this is fine-tuning and the row is
refused) while throwing away its `main()`. Model id `custom:<slug>`; `parse._resolve_model` turns it
into `(sud, xx_sud_generic, tb_lang)` so every `engine == "sud"` branch downstream works unchanged.

⚠ **ONE SHARED PIPELINE, NOT ONE PER MODEL.** `parse._load_spacy_locked` calls
`generic_models.apply_to(nlp)` as the generic wheel loads, writing every stored row into the table and
every key into `ls_slots`; a parse then selects its model by stamping `Doc._.tb_lang` before the first
component runs (`parse._tb`). Three custom models cost three rows, not three 45 MB pipelines. Two
consequences worth knowing: the slot key is namespaced `custom:<slug>` so a custom model can never
overwrite one of the 80 built-in rows other models are reading, and `analysis_scores`'s cache key
carries `tb_lang` — every custom model shares one package name, so keying on the package alone handed
the second custom model of a session the first one's ranking.

⚠ **THERE ARE TWO EMBEDDING TABLES, NOT ONE.** `package_generic_v2.sh` inlines a copy of the encoder
into the morphologiser (`replace_listeners`, because two listeners in one pipeline both resolve to
whichever tok2vec is present), so the morphologiser and the parser carry separate tables that are
trained together but are not identical. A row is read from and written to BOTH — `adapt_lang_embed`
allows both node ids in its optimizer for exactly this reason — which is why a stored model keeps a
LIST of vectors, one per `find_nodes(nlp, "embed")` result, zipped back on by index.

⚠️ **THE WHEEL IS FETCHED, AND THAT IS A LICENCE RULE.** CC BY-NC-SA 4.0: 24 of its 80 training
treebanks are NonCommercial. `make_portable.sh` pip-installs the wheels it distributes straight into
the bundle, so bundling this one would attach a NonCommercial term to the whole app — which is
precisely why the bundled English parser is the CC BY-SA `en_sud_ewt_gum`. `models_registry.GENERIC_SUD`
is a FOURTH listing set beside DEPRECATED/SUPERSEDED/RETIRED, and unlike those three it re-labels the
row's `engine` at `parse_asset` rather than filtering it: every engine-keyed reader downstream (the
toolbar dropdown, the two group headings, `installed_by_language`, `resolve_default_package`) then
passes over a "language" called `xx` without being edited, and the Custom section draws it
deliberately. Its `id` stays `sud:xx_sud_generic` — `download()`/`remove()` treat it as the ordinary
spaCy wheel it is. `_ensure_tokenizer_deps` is the one place that had to be told: its probe is a
PARSE, and this model raises "no embedding slot for None" on a blind one, which was reported to the
reader as a tokeniser dependency failing to install on a wheel that had just installed perfectly.

⚠ **THE SCORE IN THE ROW IS HELD OUT, OR IT SAYS SO — AND THE FLOOR GATES THE SCORE, NOT THE FILE.**
`MIN_SCORE_SENTS` (30 = 20 to fit + 10 to score) is the point below which there is nothing to hold
back, not the point below which a file is any use: ten sentences is upstream's own headline result
(Thai +12.18 LAS, Georgian +6.62), so a small file is worth a great deal to the MODEL and worth
nothing to the SCORE. It used to be REFUSED, which had that trade backwards. Below the floor the row
is fitted on everything and reports no measurement (`basis: "fitted"`); at or above it the split is
deterministic and interleaved (every k-th sentence), because a CoNLL-U file is usually in document
order and its last fifth is one text's worth of one genre. **What is never done is scoring a model on
the sentences it was fitted on** — 128 free parameters over a few thousand tokens make a training-set
score read far too high, and it would sit in the same column as every other model's genuinely
held-out figure.

Where there is no measurement the row falls back to the generic parser's own held-out macro over its
20 genus-disjoint test languages — **UAS 62.85 / LAS 54.24**, from SUD-spaCy's `eval_g2_base_s0.log` —
and NOT to the UAS 80.25 / LAS 74.12 the wheel's own `meta.json` publishes, which is the IN-SAMPLE dev
score over the 80 training languages, twenty points higher. `generic_models.caveat()` is the one place
that says which of the four bases (`file` / `fitted` / `builtin` / `unfitted`) a row's figures came
from; three surfaces show it.

⚠ **THE APP NEVER PICKS A CUSTOM MODEL, BUT THE READER MAY ALWAYS CHOOSE ONE**, and those two rules
live in two functions that look alike and must not be merged. `installed_by_language` /
`best_installed_model` answer "which model should parse this language on the reader's behalf" and
skip custom models entirely: a reader may have three for one language and named them by hand, so
choosing between them is not a choice the app can make. `language_choices` — the Insert-text dialog's
own list — is the opposite act, and offers every one of them under **Installed parsers**, named by
the MODEL rather than by a language (two rows both reading "English (en)" would be a coin toss). A
language whose only parser is a custom one is also dropped from "Other languages", where the dialog's
note would otherwise tell the reader no parser is installed for it, three rows below the one they
built.

⚠️ **AND THE DIALOG'S CHOICE TRAVELS WITH THE PAYLOAD.** `child_insert_text` used to recompute the
model from the language (`_model_for_language`) — which cannot name a custom model by construction,
so the note under the field promised one parser and the insert quietly ran another. Both the main
text and each parallel now carry the `model` their own `<option>` held, and the registry pick is only
the fallback for a caller that sent none. That also retires the standing requirement that the two
sides independently agree.

Two smaller consequences. Several options may now share a `value` (the language code), which a
`<select>` handles by `selectedIndex` — `selInfo` reads the model off the option actually selected,
and the code is still what is written as the text's language. And a custom model may name NO language
at all (a register, an author), so its row is kept out of the PARALLEL-text menus, which need a
`# text_LANG`, and `adoptInsertLang` now leaves the document's language alone when handed nothing
rather than defaulting it to English.

⚠ **EDITING ONE KEEPS ITS SLUG AND, USUALLY, ITS ROW.** `generic_models.update` renames, re-points
the language, or re-fits on a new file. The slug never moves: it is the `custom:<slug>` id the
document window's model picker holds AND the `custom:<slug>` key written into `ls_slots`, so
re-deriving it from a corrected name would silently deselect the reader's model and strand a row in
the table under a key nothing points at. The row does not move either — a re-fit writes the model's
OWN slot (which `adapt_lang_embed` supports by design), because taking a fresh one per edit would
leak a spare row per correction and exhaust the table's 32 on a reader who was only fixing their
training data. A model that goes back to a built-in language RELEASES its row instead.

⚠️ **AND A RENAME MUST NOT RE-FIT.** Thirty epochs is a minute, and spending it to correct a typo
would make the edit sheet something to avoid. The row is re-fitted only where the evidence moved: a
different path, or the same path with a different mtime or size (`_stamp`). Comparing paths alone
would have made "I corrected my treebank, learn it again" inexpressible — the sheet pre-fills the
file it already has, so re-picking it yields the identical path.

⚠ **EVERY FIELD OF `update` IS None-MEANS-UNCHANGED AND ""-MEANS-CLEARED**, and the distinction is
not pedantry. With `""` doing both jobs, `update(slug, name="x")` — a pure rename — read as "and the
file is gone and the language is nothing": it zeroed a fitted row, relabelled the model `unfitted`
and threw away a minute of fitting, on a call that had said none of that. Caught by the first test
written against it. The sheet always sends all three fields, so it is unaffected either way; a caller
that names one field is the case this protects.

⚠ **AND AN UNFITTED SPARE ROW IS NOT NEUTRAL** — upstream measured it costing Georgian 4 LAS against
carrying no language channel at all. So a model with no training file whose language IS one of the 80
uses the built-in row (`basis: "builtin"`, `slot` = the plain code, no row of its own to write);
anything else gets a spare row, zeroed, and a caveat that says what that costs.

## Pipeline arms

`parse.ARMS` — eight switchable arms behind the options bar's **Pipeline** drawer, each named after
the COLUMN it fills rather than after a spaCy component, because the column is what the reader can
check afterwards. The frontend has two more (transliteration, glossing) that never reach Python:
neither is the parser having an opinion and both run with no model at all, which is the same line
AUTOREGEN's note above draws for the same reason. `None` means every arm, at every call site.

⚠ **SWITCHING AN ARM OFF MAKES EVERYTHING THAT READS IT INERT TOO** (`_ARM_READS`, `_pipe_plan`), so
a reader never gets an answer computed from a column they just said they did not want. A component is
then skipped outright once every arm it owns is off — which is why unticking "Word classes" on a
custom model takes the morphologiser AND the parser out of the run rather than leaving them to
compute a column that would be thrown away a line later.

⚠️ **AND "READS" IS WHAT EACH COMPONENT'S ENCODER DECLARES, NEVER WHERE IT SITS IN THE PIPELINE.**
`arm_deps()` walks the component's own resolved config for every `attrs` list, every `feats` list and
every `upos_rows`, maps them through `_ATTR_ARM` (`POS`→upos, `MORPH`→feats, `TAG`→xpos,
`LEMMA`→lemma, `DEP`/`HEAD`→syntax) and follows a `Tok2VecListener` to the tok2vec it listens to.
There is no order anywhere in it, and `Api.model_arms` hands the same graph to the options bar, so
what the drawer shows and what the parse does cannot drift.

This replaced a hand-written table filtered by `pipe_names` ORDER, on the reasoning that a component
cannot read what has not run yet. That reasoning is sound — but it is a BOUND on what a component
could be reading, not a statement of what it does, and using it as one got **four edges wrong on the
one wheel this app ships**:

| edge | order said | the config says |
|---|---|---|
| `lemma ← upos` (en) | yes — lemmatiser follows morphologiser | **no.** `trainable_lemmatizer` = `EditTreeLemmatizer` over its own `HashEmbedCNN`, POS-blind by construction — exactly what `_force_upos`'s docstring already said. Unticking Word classes was blanking the lemmas over nothing |
| `xpos ← upos, feats` (en) | nothing | **yes.** the tagger runs on `sud.Tok2VecPlusFeats.v1`, whose `feats_embed` declares `attrs=['POS']` + seven FEATS names |
| `sudmisc ← lemma, upos, feats, syntax` (en) | `← syntax` only | **all four.** `sud_shared` embeds `attrs=[NORM, PREFIX, SUFFIX, SHAPE, LEMMA, POS, DEP, MORPH, IS_QUOTE]` |
| `feats ← upos` (generic) | needed a special case bolted on beside the table | **falls straight out.** its morphologiser embeds `sud.GenericTagEmbed.v1(attrs=[…, POS])` |

Two edges are dropped as saying nothing: a SELF-edge (the generic morphologiser reads POS and also
writes it — how it is conditioned, not a prerequisite it can fail) and an edge onto an arm the
pipeline has no component for (that column is empty whatever anyone ticks, so treating it as a switch
would make its dependants permanently inert on a state nobody can change). A config shaped
differently than expected yields no edges at all, which is the pre-cascade behaviour and the safe
direction to fail in.

⚠️ **AND AN ARM YOU SWITCH OFF IS ONE YOU HAVE TAKEN OVER, SO IT STILL SATISFIES ITS DEPENDANTS.**
The graph runs in two directions and the second one is the useful half. "Syntax is inert because
Features is off" is only true when the FEATS column has no source at all; where the annotator has
switched the arm off, the column is *theirs*, and every component that reads it reads theirs. So
`_pipe_plan` keeps two sets: `eff` — is the MODEL writing this column, which decides what runs and
what is blanked — and `have` — is there a value here for a component to read, which is what the
cascade actually asks. `parse_pretokenized` takes a `given` dict of those columns
(`_GIVEN_SETTER`), `_apply_arms` never blanks one, `_force_upos` never overwrites a supplied FEATS,
and the answer hands each back verbatim beside the form and the UPOS.

⚠ **AND THAT IS THE ONLY ENSEMBLE HERE WORTH BUILDING.** Measured on ten held-out Basque sentences
through this app's own scorer: UPOS alone → LAS **38.32**; UPOS + the annotator's FEATS → **53.27**
(+14.95), reproducing upstream's own table (Georgian 55.00 → 69.27, Basque 43.48 → 53.42). Ensembling
the generic arm with a monolingual wheel was considered and is not worth it, for three separate
reasons: where both exist the wheel is 20–35 LAS better and the weaker model only drags; where only
the generic arm exists there is nothing to ensemble WITH, and borrowing a related language's tagger
is measurably worse than nothing (32–39 % UPOS on a language it was not trained on, against a cost of
about half a LAS point per 1 % of tag error, with systematic confusions — Basque AUX→VERB 190 times,
and SUD makes the auxiliary the head, so that reverses attachments rather than mislabelling leaves);
and score-level combination has nothing well-formed to combine, since a transition-based parser hands
back the candidate heads it actually WEIGHED rather than a distribution over all of them
(`analysis_scores`' own note). **The annotator is the second model, and a far better one.**

⚠ **AND THE REASON A ROW IS DIM LIVES IN ITS TOOLTIP, NEVER IN THE ROW.** It shipped as a `::after`
appended after the label, which meant unticking one box GREW two other rows and resized the popover
under the pointer, between the reader's click and their next one. The dimming already carries the
signal; the reason is a secondary detail and takes a secondary weight. `paintPipe` captures each
row's base title once (`dataset.tip`) and appends the reason on a NEW LINE — several of those base
titles contain an em dash of their own, so a dash separator ran two sentences into one clause.
Measured after the change: popover and row widths identical either side of an untick.

⚠ **THE DRAWER DESCRIBES THE RE-PARSE, THE BACKEND ANSWERS PER CALL.** `pipeGiven` can only read
columns off tokens that exist, so a raw-text insert supplies nothing and the cascade bites there
exactly as it did before — the arm comes back blank and the result carries a `note`. That asymmetry
is deliberate: the drawer showing an arm as permanently inert because ONE of the two operations
cannot feed it would be pessimistic about the workflow this app is actually for.

⚠ **AN ARM'S EDGES ARE THE UNION OVER EVERY COMPONENT THAT OWNS IT**, which is why `sudmisc` goes
inert when Lemmas does even though only `sud_shared` embeds `LEMMA`. The arm is the whole MISC layer,
and a layer one of whose four keys is being computed from an empty column is compromised as a layer.
`sud_reported_rule`/`sud_idiom` carry no model to read this off, so what they consume is stated in
`_RULE_READS`: they walk the tree, which is what they are.

An arm that survives the cascade but is switched off blanks its column **after** the run rather than
skipping its component, because skipping the morphologiser to turn FEATS off would take UPOS with it
(one joint label). A reader who unticks "Features" alone has asked for an empty FEATS column, not for
a worse parse of the sentence.

⚠ **`tokenise` AND `sentence` ARE NOT IN THE GRAPH.** Both have a defined non-model fallback that
everything downstream consumes identically — a whitespace split and the rule sentence splitter — so
switching one off SUBSTITUTES a segmentation rather than removing one. Parsing a segmentation the
model did not produce is a first-class operation here, not a degraded one: `parse_pretokenized` exists
for exactly that, and "SEGMENTATION IS THE ANNOTATOR'S" is the rule Reset Parse is built on.

⚠ **AN ARM THE MODEL CANNOT DO IS STRUCK IN `parse.py`, NOT ONLY IN THE OPTIONS BAR.**
`_effective_arms` intersects the reader's list with `model_arms(model_id)`, which is read off the
loaded pipeline's own component names — so a wheel that gains or loses a component moves this with no
table anywhere to edit. Without that intersection a model with no UPOS tagger returns whatever its
morphologiser guessed, in a column the app then saves as annotation. `sentence` is the one exemption:
its absence routes to the rule splitter, not to an unsplit paragraph.

⚠ **AND THE GENERIC PARSER READS UPOS AS INPUT, WHICH CHANGES WHAT A RAW-TEXT PARSE MAY CLAIM.**
"You supply UPOS; the wheel supplies everything else" — tagging is lexical and upstream measured that
it does not transfer (32–39 % on held-out languages, no better than a single English tagger).

⚠️ **THE WHEEL USED TO WRITE THAT COLUMN ANYWAY, AND IT NO LONGER DOES.** It shipped with
`overwrite = true`, so spaCy's morphologiser — which predicts a joint `POS=X|Feat=Val` label and
writes BOTH halves — replaced the reader's own word classes with its guess mid-pipeline, and the
parser read the guess. Handed a Doc with no classes at all it invented a full set: measured, on
`The cat sat on the mat.` it returned `DET ADJ DET ADV DET ADV DET`, and the tree parsed, the columns
filled and the whole answer was about a sentence nobody had described. **Upstream has since fixed
both halves** — `overwrite = false`, plus a new first component `sud_require_upos` that REFUSES a Doc
with an untagged token rather than reading it on the absent-feature row. The wheel was re-published
under the SAME version number (`0.1.0`, re-clobbered in place), which is exactly the case
`download()`'s md5-not-version check exists for; verified, it reinstalls rather than reporting
"Already up to date".

Two things in this app follow from the guard:

* **`sud_require_upos` owns no arm.** `_ARM_PIPE`'s `sudmisc` predicate is `startswith("sud_")` and
  would have swallowed it, so unticking "SUD annotations" would have switched off the model's own
  contract check and put a custom model back to parsing untagged text silently. `_GUARD_PIPES` names
  it instead: a component that writes no column and refuses one arm. `_pipe_plan` skips it exactly
  when that arm is already off — i.e. when the app has ALREADY decided not to ask for word classes,
  so the answer it would refuse is one nobody was going to be shown.
* **`model_arms` reads the contract off the pipeline.** A morphologiser normally claims both `upos`
  and `feats`; a wheel shipping this guard is saying the class is its INPUT, so the guard's arm is
  struck from the output set. Keyed on the component, not on a package, so a future wheel declaring
  the same contract is covered with nothing to edit — with `GENERIC_ARMS` kept as the floor, since it
  is a fact about what the arm was TRAINED to do and still holds for a copy installed before this
  component existed.

⚠ **AND THE TAGS GO ON THE DOC BEFORE THE FIRST COMPONENT, NOT AFTER THE MORPHOLOGISER**
(`_given_doc`). `_force_upos` had always applied them at that later point, which was enough while it
was only CONSTRAINING a model that tags for itself. The guard runs FIRST, so a call that set them
three components later got the wheel's own refusal for tags it was in the middle of supplying — and
it is the right moment anyway, since the generic morphologiser embeds `attrs=[…, POS]` and a class
arriving after it has run is one it never conditioned on. `_force_upos` still runs where it did and
still earns its place: it re-derives the FEATS for the chosen class from the model's own joint label,
which setting `pos_` cannot do.

⚠ **`analysis_scores` AND `arc_label_scores` REFUSE RATHER THAN GUESS.** A model that reads the word
classes cannot rank a sentence that has none; disabling its guard to get an answer anyway would rank
the sentence against a reading in which every token is category-unknown. Both return `scored: False`,
which every caller already degrades on. `arc_scores` gained a `upos` argument so the frontend can send
the reader's tags, as `token_scores` already did.

So `_needs_given_upos` drops the ONE arm the model cannot supply — `upos` — and lets the cascade do
the rest: `feats ← upos` and `syntax ← upos, feats` are both edges the model's own config declares,
so the guard, the morphologiser and the parser all go out of the run rather than one of them raising
and the other two computing answers nobody will see. Striking `syntax` and `feats` by hand instead
(the first version of this) left the morphologiser RUNNING and its invented tags feeding the parser,
with both answers thrown away a line later — the columns came back blank either way, which is exactly
why it was worth getting right rather than leaving. A `note` on the result says why. Supply the
classes and everything comes back.

⚠ **A SUPPLIED UPOS SATISFIES THE ARM.** `parse_pretokenized` adds `upos` back when the caller passes
one, because `_effective_arms` strikes it from a model that cannot tag — right for a raw-text parse,
wrong for a call whose whole point is to re-derive the fields AROUND the tags just handed to it.
`reparse` (Reset Parse) therefore SENDS the reader's UPOS for such a model, which is the one exception
to its own "a RESET must not keep the classes it is being asked to reconsider" — for this model the
classes are not an answer being reconsidered, they are the question. Verified: handed gold UPOS the
generic morphologiser reproduces it exactly, and `_force_upos` guarantees it besides.

⚠ **AND `parse_pretokenized` RESTORES A CALLER-SUPPLIED UPOS**, exactly as it already restores the
caller's forms. Same reason, and it is load-bearing: `_apply_arms` empties the UPOS column for a model
with no tagger of its own — correct for a raw-text parse where nobody has said what the classes are,
destructive here, where the reader has just typed them and `reparseTokenFields` is about to merge this
answer back over their tokens.

`app/models_registry.py` lists/downloads models: SUD wheels from GitHub Release assets on
`SUD_REPO` (`SunflowerAI/sud-spacy-parsers`, overridable via `$SUD_MODELS_REPO`) pip-installed into
the running venv, and Stanza models into `paths.STANZA_DIR`.

**One model is not a download: `en_sud_ewt_gum`.** It is pinned in `requirements-core.txt` (and
`requirements.txt`), so every environment that can run the app already has it — the app itself
depends on it, since `app/wiktionary.py` parses English definition prose no matter what language the
document is in. `models_registry.BUNDLED_SUD` names it; such a model still lists as installed but
can't be removed (`remove()` refuses, and the Model Manager row shows a "Bundled" pill in place of
its Remove button). Adding another bundled model means editing both requirements files AND that set.

⚠ **IT REPLACED `en_sud_ewt`, AND THE OLD WHEEL IS RETIRED RATHER THAN DELETED FROM THE APP'S WORLD.**
`RETIRED_SUD` is a THIRD listing set beside `DEPRECATED_SUD`/`SUPERSEDED_SUD`, and what distinguishes
it is which listing each one leaves alone: a retired package is filtered out of `list_available()`
(nothing new installs it) but is deliberately still shown by `list_installed()` — the venv is built
ONCE behind `.sud-core-ready`, so every pre-switch machine still has `en_sud_ewt` sitting in its core
site-packages, and hiding the row would strand a wheel on disk with nothing in the UI to say it is
there or to remove it. It still PARSES (`_installed_sud_packages()` is untouched, exactly as for the
other two sets) so nobody loses English to a requirements change that cannot reach them. What it does
lose is every pick the app makes on the reader's behalf: `resolve_default_package` prefers a BUNDLED
package and then any non-retired one (alphabetical order is the last word, not the first — `en_sud_ewt`
sorts BEFORE `en_sud_ewt_gum` and would otherwise have gone on answering for English), and
`_preference_key` ranks retired last within its engine, because its clause "prefer the SMALLER model"
reads backwards across a retirement: the retired wheel is smaller precisely because it was trained on
less. `app/wiktionary.py` asks `resolve_default_package("en")` rather than naming a package, so the
definition lookup follows the same rule and does not drop to its unparsed fallback on a pre-switch
machine.
⚠️ **IT IS CC BY-SA 4.0, AND THAT IS WHAT MAKES IT SHIPPABLE.** GUM's five NonCommercial genres
(essay, fiction, letter, podcast, whow) are excluded from the wheel upstream, so the merged model
carries no NonCommercial term — ShareAlike and attribution only, exactly as the retired `en_sud_ewt`
did. `make_portable.sh` pip-installs this file straight into the app it distributes, so an NC term
here would attach to the whole bundle; `THIRD-PARTY-NOTICES.md` states the licence and the two
attributions it obliges (SUD_English-EWT's own `LICENSE.txt`, and GUM's per-document credits at
gucorpling.org/gum). Read the wheel's `meta.json` for the per-genre source terms.

`app/extras.py` is the reason `requirements-core.txt` exists alongside `requirements.txt`: the
portable bundle ships only the torch-free CORE set, and the heavy tiers (`stanza` ≈1.1 GB,
`japanese` ≈0.45 GB, `arabic` ≈0.3 GB) are pip-installed **on demand at runtime** into
`paths.EXTRAS_DIR`, which is added to `sys.path` at
startup. Every heavy import therefore sits behind a lazy `try: import` in `translit`/`parse` — a
missing tier must surface as an offer to install, never an exception.

⚠ **NOT EVERY TIER IS A PIP INSTALL**, and `la_macron` (≈4 MB) is the one that is not: it fetches a
DATA file the Latin model cannot ship for licensing reasons and that is on PyPI in no form. The
`vectors` tier (≈25 MB per parser language) is another — see `app/vectors.py` and the glossing
section above; it is the only tier that is normally installed by a MODEL download rather than by its
own row, which exists so that a machine whose models predate the feature can catch up. A tier
therefore declares EITHER `pip` + `probe` OR `module` — the name of a module supplying its own
`available()`/`install(progress)`/`status()` — and `install()` dispatches on which. That `module`
shape sat unused for a while and is the extension point for exactly this; use it rather than bolting a
second install/progress/UI path beside the first. See `app/macron.py` under Language services.

⚠ **AND A MODEL'S OWN DEPENDENCIES ARE INSTALLED FROM ITS OWN DECLARATION, NEVER FROM A LIST HERE.**
Two mechanisms, and they answer different halves of one question. The PIP half is
`_unsatisfied_requirements` (app/models_registry.py): a model wheel is installed `--no-deps` — or pip
re-resolves spaCy into `EXTRAS_DIR`, where the copy would shadow the core venv's — so its own
`Requires-Dist` is read back out of the wheel and whatever this environment does not already satisfy
is installed deliberately. `sa_sud_vedic_ufal_dcs` 0.2.0 declares `vidyut>=0.4.0` beside
`indic-transliteration>=2.3.0`, and gets both for free that way. The DATA half is
`_ensure_side_data`, which asks the INSTALLED package what it declares (`_declares`, EXTRAS_DIR
scanned explicitly first — an older copy of the same model in the core venv wins an ambient lookup
and would answer for the wheel that was just replaced) and installs the matching extras tier. Neither
is keyed on a language prefix: the wheel is what knows what it needs, so a second Sanskrit model — or
a non-Sanskrit one that gains the same embedding layer — is covered without editing anything here.
⚠️ **AND THE "ALREADY UP TO DATE" SHORT-CIRCUIT ANSWERS FOR THE SIDE DATA TOO.** `download`'s md5
skip says "the model files here are already the ones this download would write" and says nothing
about an 81 MB lexicon sitting outside the wheel — which is EXACTLY the state of a machine whose
Sanskrit model was installed before this app fetched one. Returning "Already up to date" without
looking sends the reader away with the one thing they came for still missing.
