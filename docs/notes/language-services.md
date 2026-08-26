# Language services

`app/translit.py`, `app/macron.py`, `app/apte.py`, `app/wiktionary.py`, `app/vidyut_data.py`, `app/langid.py` and the vendored data tables — transliteration, dictionaries, and Sanskrit's digraphic storage.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

- `app/translit.py` — Latin transliteration routed per language: wiktra by default, dedicated
  backends for the context-dependent scripts (Arabic/Persian DIN 31635, Hebrew ISO 259, pypinyin,
  ToJyutping, Janome+pykakasi, hangul-romanize), uroman as fallback. Failures yield `""`, never
  raise; results are cached. Korean runs Hanja through the **vendored Unihan `kHangul` table**
  (`app/data/hanja_hangul.tsv`) into their Sino-Korean Hangul reading first — hangul-romanize maps
  syllables only, so mixed-script text would otherwise keep bare 漢字 — with 두음법칙 applied
  positionally rather than stored (`_dueum`). The `hanja` PyPI package was rejected: its metadata
  pins `pyyaml==6.0.1` and hard-requires pytest/coveralls, and its table is single-valued.
  `readings()` is the same engines asked for the CJK *alternatives* —
  ordered candidates in the scheme on display, `readings[0]` being what the app already shows, `[]`
  when the engine offers only one. It backs the token context menu's readings flyout, whose pick is
  authoritative (marked `_trPick`, so no later auto-fill pass overwrites it).
  `ambiguous()` names the languages whose romanisation is non-deterministic (those readings languages
  plus the unvocalised abjads). For those, the frontend makes the **Stored** transliteration
  click-editable on the transliteration row (`editStoredTransInline` in `js/lang/translit-load.js`), and
  `derive_scheme()` re-renders every Displayed scheme FROM that correction — by matching the stored
  string against the enumerated candidate readings and re-joining the matching one through the target
  engine, never by parsing a romanisation. It returns `""` where no derivation is honest (a
  character-keyed scheme such as General Chinese), and the row then falls back to romanising the form.
  A correction reopened from a file is recovered by comparison (`adoptStoredPicks`), since CoNLL-U has
  no "corrected by hand" flag.
  **A token's UPOS reaches the romanisers**, because a Han graph is heteronymic BY WORD CLASS as often
  as by anything else (行 = háng as a NOUN, xíng as a VERB; 數 = shù/shǔ/shuò as NOUN/VERB/ADV). It is an
  optional trailing argument on `readings`/`transliterate(_many)`/`orthography(_many)`, threaded from
  `Api.transliterate`/`token_readings`/`orthography` and sent by `js/lang/translit-load.js` and
  `js/lang/readings.js`. The rule is **reorder, never filter**, on **single-Han-graph tokens only** (past
  one graph the phrase dictionary is the authority and per-character POS is a guess) — so an absent,
  unknown or wrong tag costs ordering and never an option. `derive_scheme` is deliberately POS-BLIND: it
  recognises a value the user already typed, which is a different question. ⚠️ Everything on this path
  caches, and every one of those keys had to gain the tag — `_render_one`'s `(lang, scheme, text)`,
  `readings.js`'s `READINGS_CACHE`, and the four per-batch de-duplication maps in `translit-load.js`
  (keyed on the surface alone, they let whichever 行 was reached first decide the reading for all of
  them — the tag was sent and then silently discarded). Retagging a token runs `uposSyncTranslit`, which
  drops the automatic caches AND blanks MISC `Translit` so `annotateTranslitMisc` rewrites it — clearing
  `t.translit` alone does nothing, since `fromMisc` restores the old tag's string. It preserves `_trPick`,
  the opposite of `afterFormEdit`, which drops it: a hand-picked reading is a statement about the FORM,
  and a retag does not change the form. `regenTok` cannot stand in for any of this — it is a no-op with
  no parser model, and romanisation runs without one.
- `app/macron.py` — **LATIN VOWEL LENGTH IS A SCRIPT SCHEME, AND THIS FILE CALLS THE MODEL RATHER THAN
  BEING ONE.** `_SCRIPT_SCHEMES["la"] = [("macron", "With macrons")]` (app/translit.py) puts `divisa` →
  `dīvīsa` on the Script pill beside Sanskrit's Brahmic scripts: display only, so the running sentence
  and the diagram glyphs re-render while the FORM column, the grid, the editors and the file keep the
  bare spelling. Nothing is ever written to MISC. The frontend names the off-row "Without macrons" and
  suppresses "None" (`orthoOffLabel`/`isLatinLang`, js/lang/translit.js), because Latin's one entry is
  not a writing system but a second SPELLING of the one it has — a two-state choice, and "Original"
  names it after the absence of a script it never had.
  ⚠ **The whole engine is the model's**, `la_macronise`, which `la_sud_ittb_proiel_perseus` 0.2.0 ships
  IN ITS DEFAULT PIPELINE (`token._.macron`/`doc._.macron`; SUD-spaCy `scripts/la_macronise.py`). This
  module is the one-module façade — availability, the fetch, and `resolve(form, upos, feats, lemma)`.
  ⚠️ **An earlier `app/macron.py` reimplemented all of it** — 912 lines, plus `_la_macron_vendor.py`
  (215) and the macOS-only `appledict.py` (599) — and 2cd6b14 deleted all three, correctly. Do not bring
  any of it back. The component is measured at 97.63 % whole-token against Alatius (98.23 % in
  vocabulary / 90.42 % out of it, cascading a harvested table into Morpheus), separates `malus` from
  `mālus` on UPOS alone through its `MP` rungs, honours a typed breve as a veto (`intĕllectam` →
  `intĕllēctam`) and keeps the caller's orthography (`jussit` stays `j`, `cælum` stays ligated). A
  lookup rung, a paradigm rule or a per-word correction written HERE is a duplicate of one already
  there.
  ⚠ **ALL FOUR ARGUMENTS, or the answer is wrong rather than absent.** `Gallia` Nom and `Galliā` Abl are
  one spelling separated only by FEATS, and the lemma supplies the declension where FEATS carries no
  `InflClass` — which is why `Api.orthography`/`orthography(_many)`/`_render_one` carry `feats`/`lemmas`
  beside `upos` and why all three are in `translit._CACHE`'s key. It is also why `orthoKeyOf`
  (js/lang/translit-load.js) appends them under `orthoNeedsMorph()`: the batch de-duplicates on that key,
  so keyed on (surface, UPOS) alone one `Gallia` in a document would decide the macrons of all of them.
  Verified live in both skins — 33 distinct keys in ONE bridge call, the two `Gallia` PROPN tokens
  answered `Gallia` and `Galliā`.
  ⚠️ **A MULTI-WORD TOKEN IS COMPOSED FROM ITS COMPONENTS** (`laMwtCompose`), because Morpheus lists
  WORDS and never host+clitic: the fused surface simply misses, and `multosque` came back bare in the
  middle of an otherwise macronised line. `multōs` + `que` → `multōsque`, accepted only where stripping
  the quantities off the join reproduces the stored form (French `du` = `de`+`le` is why that check is
  there). And the refresh hangs off `markDirty` (`scheduleOrthoMorph`), the one funnel every edit passes
  through, so ANY attribute moving re-renders the token rather than a list of write sites someone
  remembered — verified: a hand FEATS edit Abl→Nom takes `Galliā` back to `Gallia` and touches nothing else.
  ⚠️ **AND THE MSeg ROW SHOWS THE MACRONS TOO, AS AN OVERLAY ON `t.ortho` RATHER THAN A SECOND LOOKUP**
  (`laMsegMacron`, js/lang/translit-load.js; reached through `tierDisp`, js/core/prefs.js). Every other
  word-like row in the block already carried the lengths and the morphemic segmentation did not, which
  read as the feature not covering that row. `msegSegment` still derives the boundary from the BARE form
  against the BARE lemma and MISC `MSeg` still STORES it bare — same rule as FORM — so only the painted
  text moves: `Troi-ae` on file, `Trōi-ae` on screen, `o-ris` → `ō-rīs`. **Nothing recomputes the cut**:
  `la_macronise` returns `apply_mask(strip_macron(form))`, a per-CHARACTER substitution that inserts and
  merges nothing, so the bare string's cut indices are the macronised string's. That is asserted rather
  than assumed — every character is checked against its counterpart quantity-folded (`stripQuantity`, the
  fold `laMwtCompose` already trusts its join on) and ANY disagreement returns the stored text: a
  hand-rewritten MSeg that no longer spells its form (`zzz-qqq`, `Troi-a`, `Troi-aex`) shows exactly as
  typed, and so does a token whose rendering has not landed yet. Verified live over `samples/la_virgil.conllu`
  in all five notations with the model's own macronisations behind the bridge: MISC and FORM bare
  throughout, "Without macrons" reverts the row, a hand re-cut / a `=` seam / two cuts all overlay at the
  right positions. **⚠ Only the DRAWING sites read `tierDisp`** — the inline editor's proxy, `morphEdited`
  and `msegRefill`'s `_msegPre` guard all still read `tierText`, so the field opens on the bare
  segmentation (exactly as the form editor opens on the bare form under a script) and committing it
  unedited writes nothing and pushes no undo entry.
  ⚠️ **AND THE MSeg WRITE-BACK'S QUANTITY STRIP WAS DELETING THE MARKS IT EXISTS TO KEEP OUT.** An MSeg
  edit de-hyphenates its text and writes the word back to FORM; the Latin guard beside it strips macron
  and breve first so a hand-typed one cannot reach the file. But Latin treebanks DO spell some forms with
  a length mark — `samples/la_virgil.conllu` writes Virgil's `căno` with its metrical breve — and the
  stripped `cano` compared literally against the stored `căno` read as a changed word: measured, moving
  the boundary to `că-no`, an edit that touches no letter, rewrote FORM to `cano` and respliced `# text`.
  The comparison is quantity-folded where the strip ran (`moved()`, js/editing/context-menu.js), which is
  what the guard's own comment already promised. Verified: a boundary-only edit leaves FORM and `# text`
  byte-identical, a hand-typed `cā-no` still never reaches either, and a real letter change still writes.
  ⚠ **THE DATA IS FETCHED, NOT SHIPPED, AND IT LIVES IN THE COMPONENT'S OWN CACHE.** Morpheus is
  CC BY-SA 3.0 and the Latin wheel CC BY-NC-SA, so the wheel ships the pipe with no table (`--no-lut`);
  `install()` runs the component's own `fetch_morpheus()` (~4 MB → ~2.2 MB in `~/.cache/sud-spacy/`, or
  `$LA_MORPHEUS_TABLE`) as the `la_macron` extras tier — the `module` shape in `app/extras.py`, which
  until now had no user. **Its cache, not ours**: the deleted version fetched a table of its own into
  `paths.APP_DATA` and pointed the component at it through the environment (`parse._share_macron_table`),
  so one download served two places that could get out of step. One file, one owner, and the in-pipeline
  component macronises from the same data this display path does.
  ⚠️ **THE ENGINE AND THE DATA ARE TWO ABSENCES AND `available()` REPORTS ONE ANSWER.** There is no second
  copy of `la_macronise` in this app, so with no Latin model there is nothing to macronise with and
  nothing to fetch with either (`fetch_morpheus` is that component's function) — `install()` says which
  is missing rather than the UI reconciling two questions. Neither miss is memoised: the model can arrive
  through the Model Manager, and the table through another window or the SUD-spaCy CLI, mid-session.
  ⚠️ **NOT `_ext_misc`, and that is a decision, not an omission.** `Subject`/`Reported`/`Idiom` go to MISC
  because they are ANNOTATION the model predicts; a macron is a spelling the reader is shown. Writing
  `Macron=` would change the bytes of every Latin file this app parses AND would leave the Script menu
  dead on a file loaded from disk, which has no such key — the display path answers for both.
- `app/data/baxter_sagart.tsv` — Middle Chinese (Baxter) + Old Chinese (Baxter–Sagart), rebuilt by
  **`tools/build_baxter_index.py`** from the wikitext of Wiktionary's "Appendix:Baxter-Sagart Old Chinese
  reconstruction" (**CC BY-SA 4.0**, attribution in the file's own header). Six columns —
  `graph · pinyin · middle_chinese · old_chinese · pos · gloss`, one row per (graph, source entry).
  The hand vendoring it replaced had **collapsed a 4,082-entry WORD list into 4,330 characters**, keeping
  each graph's first entry and discarding the rest, so the 547 graphs with more than one Middle Chinese
  reading and the 312 with more than one Mandarin reading were unreachable — which is why the file grew
  without a single graph losing a reading (MC default rendering moved for 0 of 4,330). `pos` is a UD tag
  inferred from the English gloss and **left empty wherever the gloss licenses none** (16.9 % carry one);
  the canonical 破音字 whose glosses are bare English words naming no class (行 "rank, row", 樂 "music")
  are covered by `_POS_OVERRIDE`, a small hand-curated editorial dict in `app/translit.py` — kept OUT of
  the TSV precisely because a rebuild would revert a hand edit to it. The build takes `--retrieved
  YYYY-MM-DD` (required: reading the clock would make two builds of one input differ) and an optional
  `--src` for a saved copy, and is byte-reproducible — a rebuild from the same input is a no-op, so
  don't hand-edit the file. Pointed at the old 3-column file the loader yields 0 rows and
  `_scheme_available("lzh","mc")` goes False, i.e. a version mismatch degrades to *no* Middle Chinese
  rather than to a column-shifted wrong one.
  ⚠️ **pypinyin's `PHRASES_DICT` is keyed in SIMPLIFIED ONLY**, so every traditional document was denied
  the phrase-level disambiguation that dictionary exists for: 银行 read yínháng and 銀行 — the same word —
  yínxíng, and the whole-token rule offered five readings of a word that has one. `_t2s_chars` folds
  per CHARACTER (never `_t2s` over the string, whose phrase rules can change the length and shift every
  reading after it) and both the chosen syllable and the CANDIDATE LISTS are re-read through the fold.
  Two guards, because the fold is many-to-one (幹 乾 干 → 干): a folded syllable is accepted only where
  pypinyin lists it among the ORIGINAL graph's own readings, and the fold is skipped entirely for a
  single graph, which has no phrase to gain and is where that hazard bites. The gate is "two or more Han
  characters", NOT "the fold is a dictionary entry" — pypinyin matches phrases as SUBSTRINGS, so 银行卡
  reads yínhángkǎ off the 银行 inside it without being an entry itself.
- `app/data/tshet_uinh_mc.tsv` — **Middle Chinese for the ~16,000 graphs Baxter–Sagart never listed**, built by
  **`tools/build_tshet_uinh_baxter.py`** from the 廣韻's own 音韻地位 (nk2028/tshet-uinh-data, **CC0**) through a
  Python port of nk2028/tshet-uinh-examples' `baxter.js` (**MIT**). The appendix beside it is a list of 4,082
  WORDS chosen for what they say about *Old* Chinese; it covers 4,330 graphs, so most ordinary Buddhist-text
  vocabulary (菩薩, 涅槃, 般若) had no Middle Chinese in this app at all. A Qieyun position is recorded for every
  graph the rhyme book lists and Baxter's transcription is a NOTATION for that position, so 19,492 graphs answer
  here. ⚠️ **It is a fallback, not a replacement**: `_baxter_table`/`_baxter_all` consult it only where the
  appendix has no Middle Chinese for the graph — measured, **0 of 4,330** existing renderings move — and it
  supplies **no Old Chinese**, because a Qieyun position says nothing about the reconstruction. ⚠️ **"WHICH EDITION" AND
  "WHICH CHARACTERS" ARE TWO QUESTIONS, and this file answers them differently: the 2014 READINGS in 1992's
  CHARACTERS** (`--version 2014-ipa`, the build script's default). Everything separating the two editions is
  pure ASCII encoding of the same sounds — `' ae ea +` for `ʔ æ ɛ ɨ` — with ONE exception, and it is a reading
  rather than a spelling: Baxter (1992) writes the 佳 rhyme `-ɛɨ`/`-wɛɨ`, and Baxter & Sagart (2014) replace
  those with `-ea`/`-wea`, i.e. the ordinary `ɛ` vowel, so the rhyme stops having a notation of its own.
  `baxter_sagart.tsv` — the appendix beside it, answering the same Displayed row — is on the 2014 side of that
  (佳 `kɛ`, 蟹 `hɛX`) while this file was built strictly 1992, so the two disagreed on **185 readings across
  173 graphs** and a reader comparing 佳 with any appendix-sourced graph saw two conventions in one column.
  Folded to the appendix's convention now; measured, exactly those 185 readings moved (`ɛɨ`→`ɛ`) and nothing
  else — same rows, same 音韻地位 — and agreement with the appendix's own first reading over the 3,364 graphs
  both hold went **94.3 % → 94.9 %**, the residue being the appendix choosing a different 小韻. `--version
  1992` still gives that edition's own `-ɛɨ`, and `--version 2014` the plain ASCII transcription.
  ⚠️ THE CHECKED TONE IS NOT ONE OF THE DIFFERENCES, on the question being asked: both editions leave 入聲
  unmarked and carry it on the `-p`/`-t`/`-k` coda alone (level likewise unmarked, `X` rising, `H` departing).
  Verified across both tables — no checked syllable in either also carries an `X` or `H`, and there is no graph
  where one table writes the same segments checked and the other unchecked.
  Byte-reproducible, `--retrieved` required — don't hand-edit it, re-run the script.
- `app/langid.py` — fastText `lid.176`, model **vendored** at `app/data/lid.176.ftz` so detection is
  fully offline. Drives the document language on open.
- `app/sud_rules.py` — parses the fetched grew validator patterns
  (`grammars/validator/modules/relations.json`, under `GRAMMARS_DIR` — see `app/grammars.py`) once
  and evaluates the handful of error-level relation↔POS constraints directly, rather than invoking
  grew per candidate.
- `app/toolbox_import.py` (+ vendored `app/_toolbox_vendor.py`) — SIL Toolbox/FLEx interlinear →
  raw CoNLL-U, dependencies left unset.
- `app/wiktionary.py` — MediaWiki REST *definition* endpoint (not HTML scraping), for the
  right-click "Definitions of …" → MGloss pre-fill. Definition prose becomes gloss units through
  `_condense`, a real SUD parse of the English (which is why an English wheel is a hard dependency):
  split at semicolons/commas, then keep the clause head plus its subj/comp/mod/udep/conj members and
  **delete any `mod` subtree that is not both one arc from the head and immediately beside it** —
  "directly modifies" means one `mod` arc, "immediately adjacent" means the phrase's span covers the
  slot just before or just after the head in the definition's own word order, and the phrase goes
  whole so no complement is left stranded. A **coordination starts a candidate of its own** (`conj`
  and `conj:coord` only — `conj:appos` is a second designation of one referent and `conj:dicto` is a
  disfluency, so neither cuts); `flat` deliberately does **not**, and that must stay so.
  Three shared rules live here and are reused verbatim by `app/apte.py`, so a picked Sanskrit sense
  reads like a picked English one: that condensation, `_decap` (a sense is lowercased at its LEADING
  capital only — mid-string capitals are proper names or Leipzig small-caps runs — and not at all for
  a PROPN token), and `_pos_matches` (a PROPN token also takes NOUN entries, since dictionaries file
  a name as a noun; deliberately not symmetric). **Both dictionaries filter in TWO TIERS**, and the
  second runs only where the first left nothing at all — an empty result is far more often a gap in
  the source than a real "this word is never a NOUN". Apte has always widened to every sense it
  holds; Wiktionary (`_pos_plausible`, ordered by `_head_rank`) widens only to what the page does
  not actually rule out: an entry with **no part-of-speech heading** (every Chinese sense) or one
  whose heading names **no UD class** ("Phrase", "Participle", "Contraction", "Han character" —
  `_WIKI_POS_TO_UPOS` maps none of them, so those senses were unreachable from every tagged token in
  every language), plus a condensed phrase whose re-parsed head disagrees, which at that tier only
  sorts. An explicit contrary heading still excludes, so a verb-only page still answers a NOUN token
  with nothing. A lookup that matched anything strictly is untouched by all of this.
  **A headword is queried in the spelling the wiki files it under, not the one the token carries**:
  Sanskrit in Devanagari (which a file may already be stored in, and may not — see the Sanskrit
  section below), Chinese in **TRADITIONAL** characters, and **Latin with its vowel-length marks
  taken off** (`_is_latin`/`_strip_quantity`). The wiki titles a Latin entry with the bare classical
  spelling and prints the lengths in the headword LINE, so `cano` answers while `căno`, `cānō` and
  `dīvīsa` all 404 — probed live. This is NOT the macron DISPLAY layer leaking (`app/macron.py`
  writes to no stored field, which is why the query is otherwise already bare): the mark comes from
  the FILE, `samples/la_virgil.conllu` spelling Virgil's `căno` with its metrical breve in FORM *and*
  LEMMA, and the flyout looking a token up by `tok.lemma || tok.form`. That one token's dictionary
  was simply unreachable. Macron and breve both, off the NFD string — the same pair, expressed the
  same way, as the frontend's `stripQuantity`. ⚠️ **Latin only**: everywhere else a diacritic is part
  of the spelling the wiki files the word under, and in the IAST this app stores Sanskrit in the
  macron is a different phoneme AND what the Devanagari conversion on the next line reads.
  `_strip_quantity` returns its argument UNTOUCHED when it holds no length mark, so a word that has
  none cannot be silently recomposed by the NFD/NFC round-trip. en.wiktionary
  keeps every Chinese sense on the traditional page and gives the simplified one only a `{{zh-see}}`
  soft redirect — no senses, no POS heading — so 编程 404s from the definition endpoint while 編程
  answers, and *every* character that simplification changed was silently unglossable. OpenCC
  (already core, via `translit`'s Traditional orthography) folds the query; `_zh_see_target` chases
  the page's own `{{zh-see}}` pointer, read out of Parsoid's `data-mw`, when the fold lands on a
  spelling the wiki doesn't use (a variant pair such as 着/著, which OpenCC leaves alone) — and only
  on a lookup that has already come back empty, so the common case costs no extra request. Chinese
  senses arrive through the **`_definitions_glosses`** HTML path, not the definition endpoint: one
  Chinese section covers Mandarin, Cantonese and the rest, so the wiki files their senses under a
  shared "Definitions" heading and that endpoint, which keys off POS headings, emits nothing.
- `app/apte.py` — the SAME flyout for Sanskrit, from Apte's dictionary instead of Wiktionary.
  Headwords are indexed in **SLP1**, so the IAST this app stores is converted straight to SLP1 via
  aksharamukha (no Devanagari round-trip) and then *folded*, every homorganic nasal to anusvāra, on
  both the query and the index — the two Apte editions spell those differently (`aNga`/`aMga`) and
  a lemma may be written either way. `Api.definition_lookup` picks the source by language;
  `wiktionary_lookup` survives as a back-compat alias. Two paths, in order:
  - **`app/data/apte1957.tsv.xz` (1.8 MB), vendored, and what wins** — Apte's *revised and enlarged*
    1957 edition (CDSL code **AP**), preprocessed by `tools/build_apte_index.py` from the canonical
    18.5 MB source text `v02/ap/ap.txt` of `github.com/sanskrit-lexicon/csl-orig`, **CC BY-SA 4.0**
    (attribution rides in the file's own first line). Offline, and 77.5 k entries / 168 k senses.
    That source text marks structurally what the REST API below only renders as typography:
    citations are `<ls>` elements, word class and gender are `<lex>`, senses are `∙²` markers, a
    verb's class is `€n`, Sanskrit is `{#…#}`, and a compound is a record of its own rather than
    being nested inside its base entry. An entry-level column is written out, because `_local` needs
    it to prefer a main entry over a compound sub-entry that merely shares its headword (300 keys
    do); the column count is a contract between the script and that loader. **Upstream's own `<e>`
    level does not decide it** — upstream marks a compound `<e>2` only where the base entry also
    prints a `━Comp.` list, so `janman`, which prints none, filed all 35 of its compounds as `<e>1`
    sub-records and the build script's L-number merge poured them into `janman` itself. The script's
    `is_variant` decides sectionhood from the two headwords instead.
    Rebuild the file with the script; don't hand-edit it — the build IS byte-reproducible (verified),
    so a rebuild from the same `ap.txt` is a no-op.
  - **the live C-SALT REST API** (`api.c-salt.uni-koeln.de/dicts/ap90/restful`) — Apte's *first*
    1890 edition (**AP90**), the only Apte that API serves, reached ONLY when the vendored file is
    absent or unreadable, so a trimmed bundle still answers. Its TEI carries Apte's typography
    rather than structured fields, which is what the fallback parser reads.
  Measured over the 116 lemmas of `samples/brihat_jataka.conllu`, the switch takes citation residue
  from 7.0 % of glosses to 0.5 %, empty lemmas from 28 to 25, noun lemmas answered with a gender
  from 49/54 to 53/56, and the sweep from 226 s of network to 4.7 s of nothing.
  **Monier-Williams was evaluated and rejected** — C-SALT serves it too (`/dicts/mw/restful`) and
  CDSL has its source text, but one MW lookup downloads the base entry with every compound inside it
  (deva 690 kB, `mah` 1.77 MB), only 61 of those 116 lemmas hit its headword index, `mahat` is a bare
  cross-reference stub, glosses run about twice as long, proper names come out as `S3iva` rather than
  `Śiva`, and there is no per-entry URL for the flyout's "Open …" row. The measurements are in that
  module's docstring — read them before reopening the question.

- `app/vidyut_data.py` — **THE SANSKRIT PARSER READS A LEXICON AT INFERENCE, AND IT IS FETCHED, NOT
  SHIPPED.** `sa_sud_vedic_ufal_dcs` 0.2.0's tok2vec embedding layer (`sud.AnalyserFeatsEmbed.v1`)
  runs in `runtime = true` mode in the shipped config: rather than carrying a frozen extract of an
  analyser — whose key set is whatever vocabulary happened to be probed, missing 6.5 % of Vedic
  tokens, a vocabulary MISMATCH that widening the extract does not fix — it asks `vidyut.kosha` per
  token for the SET of morphological analyses a form can have. The `vidyut` PACKAGE is an ordinary
  declared dependency of the wheel (MIT, abi3 wheels on every platform this app builds for, no Rust
  toolchain) and needs nothing from this module. Its DATA does: ~32 MB compressed, ~81 MB on disk,
  published only as a GitHub release asset of ambuda-org/vidyut and deliberately not redistributed
  upstream. So this is a `module`-shaped extras tier beside `la_macron`/`fa_vocab`/`grammars`, and
  `models_registry._ensure_side_data` installs it with the model.
  ⚠ **THE LAYER RAISES RATHER THAN DEGRADING**, in its own words: without the lexicon "every token
  reads 'silent' and the model quietly parses worse instead of failing". So a Sanskrit model with no
  lexicon parses NOTHING — this is not a feature that is merely weaker while the tier is absent, and
  it is why the install is automatic rather than an offer.
  ⚠ **AND `VIDYUT_DATA` MUST BE EXPORTED, OR A CORRECT FETCH IS FOUND ONLY BY ACCIDENT.** The model
  resolves its data as `$VIDYUT_DATA` else the literal `"vidyut-data/kosha"` — relative to the
  process's CWD, which for a LaunchServices/Explorer launch is arbitrary (`/` on macOS). The export
  lives in `extras.activate()`, the one process-wide "make the on-demand things reachable" step every
  entry point already calls before a model loads, rather than at a list of load sites someone has to
  remember. ⚠️ Note the LEVEL: the variable names the `kosha` SUBDIRECTORY, not the bundle root that
  `download_data` extracts into — `vidyut_data.kosha_dir()` is the one place that is spelt out. A
  `VIDYUT_DATA` the reader set themselves is never overwritten; `available()` then reports on THEIR
  copy.
  ⚠️ **The URL is derived from the installed `vidyut.__version__`, not pinned here.** The kosha is an
  FST plus a msgpack registry whose layout is the Rust crate's internal business, and upstream's own
  `download_data` hard-codes its version in both halves of the same URL — pinning one here would be
  inventing a second opinion about which data goes with which engine. Our own fetch is preferred for
  its progress reporting (`download_data` reads 32 MB into memory with no hook at all); upstream's is
  the fallback the moment the asset naming stops matching.
- **Sanskrit is DIGRAPHIC IN STORAGE**, and that is the whole shape of its support.
  `sa_sud_vedic_ufal_dcs` takes raw **IAST or Devanagari** and puts back whichever it was given: its
  `sa_deva` component writes Devanagari into FORM/LEMMA with the IAST in `Token._.translit`/
  `_.ltranslit` (the UD convention), so a file's columns are in one script or the other and nothing
  in the file says which. `translit.sa_stored_script` reads it off the FORMS — a property of the
  file, which no display preference may contradict — and `Api.doc_script` serves it to the frontend
  as `DOCSCRIPT`. Four things read it: whether "Original" already shows a script (and so whether the
  IAST row beneath is worth drawing — `saTransRow`), which script a re-fused MWT form comes back in
  (`sandhi_join`), what ITRANS input converts TO (`itrans.convert`'s `script`), and whether the
  diagram's form editor edits the glyph or the row under it (`iastFormEdit`).
  The **Script** menu is therefore Original + **Latin** + the 33 Brahmic scripts, with no "None" row:
  "Latin" says the same thing and says it as a script. It names the SCRIPT and not the notation — the
  id is still `iast`, but which Latin notation that line is drawn in belongs to the Displayed
  transliteration, and the two menus disagreed the moment CSL could fill it (Script Latin + Displayed
  CSL puts CSL on that line — `saCslTop`, below). `_DANDA_IAST` routes the daṇḍa there rather than
  through aksharamukha, which renders `।` as `.` and would put a full stop in the middle of a verse.
  **CSL survives as a DISPLAY scheme and nothing else** (`app/sa_notation.py` + the vendored
  `app/_sa_sandhi_vendor.py`, upstream's own `scripts/external_sandhi.py`). It is a transliteration-ROW
  choice beside IAST: per token, how that token would be spelt with the junctions marked — `vartmā`
  shows `vartm"`, `iti` shows `êty`. Three things make it unlike every other scheme, and each is a
  reason it does NOT go through `_render_one`: it is computed **per SENTENCE**, because a mark records
  what happened BETWEEN two words and the same surface reads differently beside a different
  neighbour (so the (form, upos) deduplication every other pass uses would be actively wrong); its
  input is the **pausa** forms, i.e. MISC `Unsandhied=` where there is one and the FORM otherwise,
  since feeding a sandhied surface back through a sandhi generator applies the rules twice; and it is
  **not `stored`**, because MISC `Translit` is per token and context-free and could not hold it
  honestly. The one thing the vendored generator cannot do alone is the r-stem visarga — `punaḥ` +
  `janmanām` is `punar-`, not `puno-`, and only the LEMMA separates an r-stem from an s-stem — so
  `_rstem_visarga` substitutes the r-form before the junction, deferring to `translit._is_rstem` so
  the app has one answer about which stems those are rather than two. Verified against the sample's
  own former CSL text: identical on all four sentences.
  **What is gone is CSL as a STORAGE format.** The old model read and wrote Clay-Sanskrit-Library text —
  the sandhied surface with its coalescences *marked* (`vartm" â-punar-janmanām`) rather than
  written plainly — so no token form was a substring of `# text` and the frontend's literal match
  could not settle a single Sanskrit sentence. That cost a whole reversal engine (`app/sa_csl.py` +
  a vendored `desandhi_csl`), a bespoke alignment stage in `parse.token_spans` with its own
  verification thresholds, and a running-line gluing pass in `translit`. CSL is now strictly
  internal to the model, `# text` is ordinary sandhied text, and **stage 1 settles every Sanskrit
  sentence in both scripts** — verified over both samples. All of that machinery was deleted rather
  than kept "just in case"; `models_registry.DEPRECATED_SUD` hides `sa_sud_vedic_ufal_csl` so the
  app cannot offer a model whose output it can no longer read.
  ⚠ **A CONSONANT-FINAL WORD JOINS THE NEXT ONE IN THE SCRIPT LINE, AND ONLY THERE.** A Brahmic script writes a
  word-final consonant with a virāma, and Devanagari does not leave a virāma standing before a space: `tad api` is
  written तदपि, `vāk iti` वागिति, the two words sharing one akṣara run. Romanisation is under no such constraint,
  so the IAST original keeps its space and the script line loses it — the two lines then disagree about word
  division, which is correct rather than a defect, because word division is a fact about the script here.
  ⚠ **Done on the INPUT, not on the output** (`_sa_join_final_consonant`): deleting the space after conversion
  leaves the virāma where it was — तद्अपि, a dead consonant beside an independent vowel, which is not how the word
  is written — whereas deleting it first hands aksharamukha `tadapi` and the real akṣara forms. The rule is
  therefore stated in IAST, the one alphabet in which "ends in a consonant" is a question about a single
  character; anusvāra and visarga are excluded, since neither leaves a consonant hanging. A file already stored in
  Devanagari passes through untouched, and should: `_ak` returns it unchanged, so the author's own spelling is
  what is drawn. It is ORTHOGRAPHY, not sandhi — `vāk iti` comes out वाकिति, not वागिति.
  ⚠ **THE AVAGRAHA IS THE SAME RULE POINTING THE OTHER WAY, AND IT IS SPELT ON BOTH SIDES.** Romanised Sanskrit
  writes the elided initial *a* as an apostrophe belonging to the word it OPENS, detached from the word before
  it — `tato 'ṅghridvayam`, `namo 'stu`, `ko 'nasūyakaḥ` — while Devanagari writes ऽ flush against the preceding
  syllable, ततोऽङ्घ्रिद्वयम्, because there the elision sits inside one akṣara run. So the space is a fact about
  the SCRIPT exactly as its absence before a virāma-joined word is, and neither side had been given the one it
  uses: a Devanagari-stored file rendered in IAST came back `tato'ṅghridvayam`, and an IAST-stored one rendered
  in Devanagari came back `ततो ऽङ्घ्रिद्वयम्` — both live on this repository's own two `brihat_jataka` samples.
  `_sa_avagraha_detach` (on the OUTPUT — the mark only becomes an apostrophe once the conversion has run) and
  `_sa_avagraha_attach` (on the INPUT, for `_sa_join_final_consonant`'s own reason) are the pair, at the same
  seam. A mark that OPENS its string is left alone: `'ṅghridvayam` is exactly how an MWT component is stored.
  ⚠️ **And the SANDHI GENERATOR agrees with them now.** `_visarga_join`'s `-aḥ + a → -o'` branch withheld the
  word separator on the reasoning that an avagraha is "a genuine merge" — phonologically true, orthographically
  not, and `_vowel_join` already inserted it for the SAME rule reached from an e/o-final word. One sandhi had two
  spellings (`rāmo'pi` against `tato 'ṅghridvayam`); it now takes `sep` like every other separable outcome. An
  MWT is untouched, because an MWT passes `sep=""` — its components make one orthographic word, which is the one
  place the mark genuinely has no boundary to sit at, so no range form in any existing file moves.
  ⚠ **The DCS representation is not the CSL one, and the difference is in the columns.** A token
  that is its own orthographic word keeps its **sandhied** surface in FORM, with the padapāṭha in
  MISC `Unsandhied=` (`kratuś` / `Unsandhied=kratuḥ`); only a token INSIDE a multi-word token is
  stored unsandhied. `parse._ext_misc` writes `Translit`/`LTranslit`/`Unsandhied` from the model's
  token extensions, and `samples/brihat_jataka.conllu` was converted into that shape (its MWT ranges
  had to be RE-DERIVED, not carried over — the file's own grouping had drifted from its own text,
  `paṭu-dhiyāṃ` being one word in the text and two ungrouped tokens in the columns).
- **A tokeniser may PUBLISH its own offsets** — `doc._.src_text` (the string it was handed) +
  `doc._.src_spans` (one half-open range per token), the same shape as the
  `doc.user_data["mwt_ranges"]` convention. `parse._published_spans` honours them for any model and
  prefers them to `token.idx`, **gated on `src_text` being the string we passed**: `# text` escapes
  its line breaks as the two characters `\n` and `bridge.js` restores real newlines on load, so
  feeding the escaped form would glue `\n` onto the next word and shift that token and every span
  after it. That gate is what turns the trap into a fall-through instead of a silently wrong
  decoration.
  ⚠ **Published spans may OVERLAP by one character**, and both sides must tolerate it: at a vowel
  coalescence the fused vowel of `vartmā` + `apunar-` genuinely ends one word and begins the next.
  `paintStext`'s order guard therefore allows `sp[0] >= last - 1` rather than `>= last`; refusing it
  would cost the second word its decoration at every coalescence in the text.
  `parse._src_span_layout` reads the same spans for **MWT ranges and SpaceAfter**, sitting between
  the published `mwt_ranges` and `_reconstruct_mwt`'s heuristic. Two things it gets right that the
  heuristic cannot: the range's FORM is the RAW SUBSTRING (the components of `vartmāpunarjanmanām`
  concatenate to `vartmaa`, which is not a word in any script), and SpaceAfter comes from the raw
  text rather than from `doc.text`, which is the tokeniser's own reconstruction and puts spaces
  where the input had none.
Optional dependencies are always isolated behind a single module façade in `app/`, as those last
six do — follow that when adding another.
