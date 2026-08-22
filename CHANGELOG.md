# Changelog

All notable changes to SUD Workbench are documented in this file.

## [0.3.16] — 2026-08-22

### Added: auto-regeneration can be turned off

- An **Auto-regenerate** checkbox at the right-hand end of the options bar, on by default. It is what
  makes an edit to one field leave the rest of the token describing the same word — retag 行 NOUN→VERB
  and its features stop being the noun's, re-head a token and its relation stops describing an edge it
  no longer has.
- Turned off, nothing you did not type is rewritten: the model is not consulted for a token's lemma,
  XPOS or features after a form or word-class edit, and a re-headed token keeps the relation you gave
  it. The choice **persists between sessions**, since a preference against automatic edits that
  forgot itself overnight would be no preference at all.
- Transliteration, the macron display, and the glosses that follow your own FEATS edit are untouched
  by it — none of those is the parser having an opinion.

## [0.3.15] — 2026-08-22

### Added: the open file follows changes made to it on disk

- A document changed by **another program** — a script, a `git checkout`, a second editor — no longer
  sits on screen disagreeing with the file it names. With **no unsaved changes** the new version is
  simply shown, and the sentence you were reading stays where it was.
- With **unsaved changes** the two versions are yours to choose between: **Reload from Disk** takes
  theirs and discards your edits, **Overwrite** writes yours over the file, and **Cancel** does neither
  — nothing is written, nothing is lost, and the next write asks again.
- The app's own saves are never mistaken for someone else's, and an editor that saves by writing a
  temporary file and renaming it over the target is handled as the single change it is.

### Fixed

- In a Chinese document, a **Latin** word marked `Foreign=Yes` is no longer set as though it were 楷體.
  The face swap brings four corrections with it — 6.4 % larger, lifted, tightened by 0.054–0.064 em and,
  on the running line, bold — every one of them derived from Kai's metrics against the sans's, and each
  serves a whole element while the element is the token. A Latin word contains none of those glyphs: its
  face really is italic, and what an italic wants is the ordinary 0.02 em bump the tightening replaced.
  The five corrections now come off a foreign form the Kai face paints nothing of, in the diagrams, the
  grid's Form cell and the running sentence alike. A form that **mixes** Han and Latin is unchanged.
- The grid's **multi-word-token rows are set upright**. The row rule declared a synthetic italic — the mono
  stack has no real one, and a synthesised slant pushes shaped Arabic past its own box — and then all three
  things the row actually draws took it back off again. The row is a surface form and its MISC, file content
  set the way every other cell's is.
- The **transliteration column machinery is gone**. The grid has drawn the ten CoNLL-U columns for some time;
  what was left was a per-sentence visibility gate with nothing to gate, a "Translit." heading branch, two
  cell branches and their styling. A token's romanisation is a diagram row and the Head column's own
  parenthesis, neither of which is a column here.
- The grid now **paints the letter-spacing its columns have always been sized for**. Every measurement of
  a cell — the column autosize, the wrap test, the expand-on-focus width — runs the tracking curve at the
  cell's own size, but the stylesheet stated the curve's literal for the weight and never for the tracking,
  so the text was set about 0.15 px per character tighter than its column reserved. Four cells were affected
  and all four now agree with their reserve: the ordinary cell, the heading band at its own 11 px, a
  `Foreign=Yes` form (which was taking the 15 px reference's literal on a 13 px field), and that same form
  in a Chinese or an underlining document, where the field was measured in a face it does not paint. No
  column moves — the space was already reserved.
- Clicking into a foreign token's form in a diagram no longer **re-spaces its letters**. The editor
  matched the row's tracking by testing whether its font string ends in the foreign stack — but it builds
  that string from the element's own `getComputedStyle().fontFamily`, which the engine spells with a space
  after every comma where the stylesheet writes none. One space was all it took: the field opened at
  +0.02 em where the diagram painted −0.0544 em. The field's width and its caret hit-testing rode on the
  same number.

## [0.3.14] — 2026-08-22

### Added: glossing from a translation weighs what the words *mean*

- The alignment between a sentence and its English translation now weighs the two words' **meaning**
  alongside their position in the two trees, using thirteen cross-lingually aligned vector tables that
  are **downloaded with the parser** — one per language, in one shared space, plus the English hub.
  Failure to fetch them is a warning: a model still installs and parses.
- Each word is looked up by **both its form and its lemma** and the two averaged, which is what keeps
  the feature alive on inflected languages — on Sanskrit it takes tokens carrying a vector from 22 of
  78 to 75 of 78.
- **Proper nouns are matched on position alone.** A name's neighbours in that space are the other names
  of its region and period, not its own translation.
- An **adposition that introduces an oblique** makes its relation transparent, so a role a case
  language marks with an ending and English marks with a preposition can still be paired — six of the
  nineteen unmatched tokens on the Virgil sample were exactly this.
- Word classes may differ **inside a supercategory** (nominal / predicate / modifier) or where the
  meaning vouches for the crossing; `dep`, UD's "no relation could be determined", is now treated as
  uninformative rather than contradictory.
- What the tree cannot place is glossed by **retrieval** from the sentence's own translation, with a
  lower threshold where **Apte** independently confirms the word; a matched English node may expand to
  its **subtree**, giving a multi-word gloss; and every matched pair anchors a **re-alignment inside
  its own subtree**, recovering pairs the global no-crossing rule refuses.
- A sentence with **no translation at all** is glossed from the vectors alone, with the dictionary
  supplying the candidates — Sanskrit only, since Apte is offline where Wiktionary is a network call.
  Open-vocabulary retrieval was measured and refused: it is ~14 % accurate with no usable threshold.
- Glosses are lowercased except proper nouns and `I`. An unmatched **proper noun takes its own lemma**,
  capitalised, romanised where the lemma is not written in Latin.

### Added: a foreign word is underlined in scripts that have no italic

- Italic is a Latin device that Cyrillic and Greek also have; a Brahmic script, an abjad, Han/kana/
  Hangul have none, so what a browser drew there was a **synthesised oblique**. Those documents now
  mark `Foreign=Yes` with an **underline** instead. Chinese is unaffected — it already marks a foreign
  word by a change of face to 楷體.
- The displayed script decides, so the same file read in IAST is italicised and read in Devanagari is
  underlined.

### Fixed

- A click outside a context menu now dismisses it **however the click's target handles the event**.
  The dismissal was bubble-phase, so any element that stops click propagation swallowed it — most
  visibly the translations grid, which meant opening a context menu and then clicking into a
  translation field left the menu standing.
- `c2sc` small caps no longer apply to the **lexical** gloss tier, where a capital is the word's own —
  a name, an acronym, or the English first-person `I`, which rendered as a small-cap. The morphemic
  tier keeps them. This also settled a paint/measurement disagreement in the lexical row's own
  geometry (26.81 px against 30.69 px on `PST.I`).

## [0.3.13] — 2026-08-20

### Fixed: a cross-line arc's label sat above a point on the arc rather than on it

- A within-line bump has a **crown**, so a label 8 px above it stands beside the arc, clear of the ink.
  A cross-line arc has no crown — the point the label hangs from is the **midpoint of its chord**,
  which is exactly the point the drawn curve passes through half-way along — so putting the label above
  it left it floating beside the arc's middle, attached to nothing in particular. It now sits **on** the
  arc, interrupting its own edge the way the hierarchy and tree views already label every edge, with the
  label's opaque casing clearing the stroke behind the text.
- De-collision is unchanged: a label that has to rise to clear a shorter one still rises, and still
  grows a dashed leader back down to its arc.

### Fixed: a cross-line arc fanned outside arcs it encloses

- Where several arcs meet one token they fan apart, the longest-reaching taking the centre slot so no arc
  has to cross a longer one to reach its node. The measure of "longest" is the arc's own chord, which is
  the right proxy **inside one line and the wrong one across a wrap**: a cross-line arc's endpoints are on
  different lines, so its chord can be nearly vertical — a few pixels — while the arc genuinely spans
  further than every ordinary bump at that token.
- A cross-line arc is now ranked innermost outright, which is what its being cross-line already says. On
  the sample document, 77 shared endpoints were affected; under the old ranking the cross-line arc was
  fanned outside an ordinary one at **40 of 70** of them.

### Changed: dragging a token to a new head re-labels the edge for that head

- The relation was tested against the head being dropped on and the **whole gesture rejected** when it did
  not fit — `subj` dragged under a noun. But the gesture is about the head and is unambiguous; the
  relation is the part that needed an answer, and the app already had one. The same ranking that follows
  every other head change is now asked *before* the drop, and the best relation the validator accepts on
  the new head is written in the same undo step as the head itself.
- A refusal now means only what its message always claimed: nothing the parser ranks is valid on that
  head. A relation that still fits is left alone, and any `@deep` tail the annotator set survives.

### Changed: Reset Parse re-analyses the tokens that are there

- ⌘R re-segmented the sentence from `# text` and adopted the tokeniser's own multi-word tokens, so a
  compound split by hand, a clitic merged by hand or a corrected segmentation was **silently reverted by
  the one control that says it is about the parse**. Segmentation is the annotator's: only editing the
  running sentence or the grid re-tokenises now.
- The forms, the multi-word tokens and `# text` are held fixed and the sentence goes through the
  pre-tokenised parser instead. Spacing (`SpaceAfter=No` and its neighbours) survives verbatim, since a
  parser handed a word list has no running text to read spacing off — and in a spaceless script that
  spacing is the whole of it. With no model loaded it says so instead of quietly re-splitting the
  sentence on spaces.

### Changed: a feature's values are listed in their own conventional order

- The feature tables had been alphabetised, and that table **is** the order every menu prints — the FEATS
  cell, the value pills, the AVM rows, the glossing-abbreviation menu. A paradigm was being presented the
  way a list of strings is: Com, Fem, Masc, Neut; Coll … Plur … Sing; Fut … Past … Pres.
- Now masculine, feminine, neuter; singular, dual, plural; present, past, future; positive, comparative,
  superlative — and Case in the traditional sequence: nominative, accusative, instrumental, dative,
  ablative, genitive, locative, vocative, then the ergative pair, then the remaining non-core cases, then
  the local ones. No value is dropped or added.

### Fixed: the avagraha's spacing, in both scripts

- Romanised Sanskrit writes the elided initial *a* as an apostrophe attached to the word it **opens** and
  detached from the word before it — `tato 'ṅghridvayam` — while Devanagari writes ऽ flush against the
  preceding syllable, ततोऽङ्घ्रिद्वयम्, the elision being inside one akṣara run. The space is a fact
  about the script, exactly as its absence before a virāma-joined word already is, and neither side was
  getting the one it uses: both errors were live on this project's own two Bṛhajjātaka samples.
- The sandhi generator agrees with them now. It withheld the space after `-aḥ + a → -o'` on the grounds
  that an avagraha is a genuine merge — phonologically true, orthographically not — so one sandhi had two
  spellings depending on which rule reached it. A multi-word token is untouched: its components make one
  orthographic word, the one place the mark has no boundary to sit at.

### Fixed: a Kai run's two edges had the wrong gap

- Tightening a foreign Chinese run equalises the gap **between two Kai characters** with the surrounding
  sans, and says nothing about the gap between a Kai character and the non-Kai one beside it — which it
  then gets wrong in both directions at once, too wide before the run and too tight after it. Both edges
  are corrected by half the tightening, which is derived rather than tuned. Two adjacent foreign tokens —
  般若波羅蜜多 — keep their own spacing exactly, by construction.

### Changed: the Literary Chinese sample is now the Heart Sūtra

- Twenty-four sentences of 玄奘's 般若波羅蜜多心經 in place of a single seven-token maxim, with real
  `Foreign=Yes` tokens sitting among ordinary Han and sentences long enough to exercise the wrapped
  notations.

## [0.3.12] — 2026-08-20

### Added: a foreign token is marked by FACE in Chinese, not by a slant

- Han has no italic, so `Foreign=Yes` on a Chinese token was drawing a **synthesised oblique** — a
  sheared 行, which is not a mark Chinese typography makes. What it makes is a change of face, 楷體
  against the body face, the way a Latin text sets a foreign word in italics. The Kai face is declared
  in the **italic slot** of its own family, so nothing at the point of use needs to know the token is
  Chinese — and any Latin in the same token still falls through to Noto Sans Italic and is still
  italicised, which no single font-family swap could have done.
- The face is **not fetched and not bundled**: every Kai named is one macOS or Windows already ships,
  and a machine with none falls back to exactly what was drawn before. Simplified and traditional get
  their own family, because the two genuinely differ — 9 of 14 sampled graphs paint different outlines.
- Three corrections ride with it, each measured over 20 dense glyphs rather than eyeballed. A Kai
  **字面 is smaller** than a Hei's (ink 83.85 against PingFang's 90.28), so the run is scaled up and
  their half-cap-height lines aligned. Every Han ideograph is **one em wide in every face** — `palt`
  and `pwid` move none of them, those features being for punctuation and Latin — so the Kai's narrower
  ink is the same box with more air around it, and the run is tightened to give back the sans's own
  gap. A brush hand is **lighter** (ink coverage 0.2426 against 0.4198), so it is set Bold in the
  running sentence, where the word sits in a row of sans text; the diagram keeps Regular, where an
  isolated token among light-grey annotations reads as shouting at Bold.

### Added: the hierarchy and the outline show Sanskrit in its pausa form

- Sandhi records the junction with the word that **follows**, so a sandhied surface is only a true
  spelling while the words stand in reading order. The hierarchy and the outline take them out of that
  order — a token sits under its head, beside neither of the neighbours whose junctions its form
  records — so those two views now draw MISC `Unsandhied`, the citation form, where there is one. The
  stemma, arcs and brackets keep the sentence's own sequence and are untouched, as is the running line.
- Under a script the pausa gets its **own** conversion rather than the form's, on the same round trip;
  the transliteration row follows the glyph, so the two never disagree about which word this is.

### Fixed: an italic token reserved more room than it painted

- `Foreign=Yes` sets a form in italics, and every measurement of it already added the italic tracking
  bump — while the rule that draws it declared the slant and nothing else. The form painted about
  0.02em per character narrower than its own slot, and the inline editor opened at a different tracking
  from the row beneath it. The rows that flip the other way (a foreign token on the transliteration or
  segmentation row, and every row under a non-Latin displayed transliteration) had the mirror-image
  fault and are fixed with it.

### Fixed: on WebKit, every tracked row reserved the untracked width

- `getComputedTextLength()` returns the **untracked** advance in WebKit and the tracked one in Chrome —
  measured, `abcd` at italic 15px with .02em comes back 32.685 either way there against Chrome's
  33.891. So the transliteration, both gloss tiers, the outline's form row, the relation labels and the
  AVM columns have all been reserving too little room on the one engine this app ships on. The tracked
  width now comes from a live HTML element, which reproduces Chrome's number exactly, including for a
  Devanagari conjunct where the obvious `getBBox()` shortcut is 0.9px out.

### Fixed: the Grids button was tighter than every other button in the titlebar

- `tablecells` is the one genuinely wide symbol up there, and a wide glyph in a square button has less
  air beside it. Measured against every neighbour's real ink box, it cleared 3.90px each side where the
  rest clear 6.42–7.93; the button is now 36px wide and clears 6.90. Windows is deliberately unchanged:
  its own grid icon is square and already sits inside that kit's band.

### Added: glosses derived from the sentence's English translation

- A sentence's `# text_en` is parsed with the bundled English model and its dependency tree is
  aligned with the sentence's own, so each word is glossed by the English word standing in its
  structural position. The matched **form** fills MISC `Gloss`; its **lemma** fills the lexical part
  of `MGloss`, whose grammatical abbreviations still come from the source token's own FEATS and UPOS
  and whose attachment hyphens still come from its own `MSeg` — so `doubts` in the gloss row and
  `doubt` in the morphemic one, off one alignment.
- **Matching runs on the UD form of both trees.** SUD promotes function words over their hosts and
  promotes different ones in different languages: measured on `samples/chinese_msud.conllu`, the
  English *This puppy is really cute!* is rooted on the auxiliary `is` while 小狗真可爱 is rooted on
  可 AUX, so aligning in SUD space pairs two function words and strands the content words. After
  conversion both sides root on the predicate and the trees pair token for token.
- Two things trigger it, and nothing else: **turning a glossing tier on**, which glosses every
  translated sentence in the document, and **committing a translation**, which re-glosses that sentence
  alone. Opening a file never re-glosses it. Either tier works on its own.
- The two trees are matched by **tree edit distance**: the glosses are the *rename* operations of a
  cheapest edit script turning one tree into the other, so a word one language has and the other does
  not falls out as a deletion or an insertion rather than being forced onto a partner.
- Two words are matched only if their **word classes are identical** and their relations agree at least
  at class level, so a subject can never be glossed by a modifier and a determiner never by a verb. A
  word the alignment cannot place is left unglossed rather than guessed at.
- Glosses are recomputed whenever the analysis moves — **a retag or a re-headed arc**, not only a
  changed translation — since the alignment is computed against the source tree. Only sentences whose
  own answer could have changed are recomputed: an edit that touches nothing the alignment reads costs
  a comparison and no more.
- Children are ordered for the match by **relation, not word order** — word order is exactly what
  differs between two languages, so imposing it would forbid the matches this exists to make.
- Requiring the word classes to agree exactly is stricter than what came before, and it does gloss
  less: over the sample treebanks it drops from 43 matched words to 37. What it loses are words the two
  languages tag differently — Chinese 没 against English *n't* — and what it buys is that a match now
  means the same word class on both sides, with no table of permitted near-misses to reason about.
- Removing a glossing tier and adding it back **re-glosses**, rather than bringing the tier back empty.
- Undo is unchanged and needs no new entry: the pass rides the translation edit's own snapshot, which
  is taken when the field is focused and pushed when it is committed — so one undo puts back the
  translation and the glosses it produced together.
- Needs grew's backend and the UD conversion grammars. Without them the feature says so once, in a
  toast naming Manage Models, and stops asking until that sheet is next opened.
- The English parser is now **loaded in the background at launch**, so the first glossing of a session
  no longer pays for it. It was measured at 8.4 seconds of a 9-second first pass, against a quarter of
  a second once warm — and it is the same load the Wiktionary definition flyout pays on its first use,
  whatever language the document is in, so both features get it. The status bar says a first run may
  take a moment rather than showing a bare spinner, and the pass gives up and reports it rather than
  leaving the indicator running for ever if an answer never comes.

### Fixed: a rectangle selection no longer highlights text outside the diagram

- Sweeping a selection rectangle out of the diagram left the running sentence, the sentence id or the
  translation behind it highlighted. Those three are editable fields, and an editable region stays
  selectable however emphatically an ancestor is marked unselectable — the `user-select` the drag
  already set could never reach them.
- The selection is now refused outright while a drag is in flight, and anything that formed before the
  gesture was recognised as a drag is dropped when it ends. Clicking or selecting in any of those
  fields is unchanged when no drag is happening.

### Fixed: an attachment hyphen sits between the stem and its grammatical gloss, not in front of both

- A morphemic gloss for a segmented word put the Leipzig attachment mark around the whole string:
  `vir-um` glossed **`-man.ACC.SG.M`**, which says the *stem* attaches leftward and then joins stem to
  suffix-gloss with the separator meant for two categories of one morpheme. It now reads
  **`man-ACC.SG.M`** — the boundary the segmentation found goes between them, on the side the mark named.
- The mark alone is still right when there is no stem to place (`-ACC.SG.M` for the suffix of a word
  whose lexical gloss nobody has written), and a word with no boundary keeps its dot (`arm.ACC.PL.N`).
- This predates automatic glossing: it needed a lexical gloss *and* a segmented form together, which
  before meant hand-typing a gloss or picking a dictionary sense before turning the morphemic tier on.
  Glossing from a translation makes that pairing the ordinary case, which is how it came to light.

### Fixed: the morphemic gloss no longer waits for the lexical tier

- With only the morphemic tier enabled, the stem was left out of every gloss — `vir-um` came back as
  bare grammatical abbreviations and filled in only once the lexical tier was switched on too. The
  stem is the English lemma the alignment recorded, which is on the token whether or not a lexical row
  is drawn; only the older fallback (borrowing the stem from the lexical tier) ever needed that tier.
- Enabling a second glossing tier now also re-glosses, rather than leaving the newly added row to
  whatever could be scraped from the tier that was already on.

### Fixed: a hand-written morphemic stem no longer reverts to the lexical gloss after a reopen

- MGloss's lexical part is normally derived from the `Gloss` tier, and which values were so derived
  was only ever known in memory. After a save and reopen that knowledge was gone, so a stem someone
  had written by hand — anything not simply the Gloss underscored — was treated as derived, and the
  next edit to that token's form silently replaced it with the Gloss.
- On open, a stored MGloss whose lexical part is *not* the Gloss underscored is now recognised as
  somebody's own wording and kept. CoNLL-U has no flag for this, so it is recovered by comparison —
  the same way a hand-corrected transliteration already is.

## [0.3.11] — 2026-08-19

Both fixes in 0.3.10 were aimed at real faults and neither landed; these are the corrected ones.

### Fixed: cross-line arc endpoints take their place in the fan by where they actually reach

- 0.3.10 put a cross-line arc's endpoint at the same **height** as the within-line endpoints beside it,
  which was necessary but not sufficient: which **slot** it takes among them was still decided by how
  many tokens the arc spans in the sentence, not by how far it reaches across the page. Those are the
  same thing within one line and come apart the moment an arc crosses a wrap — an arc can span forty
  tokens and travel almost no distance sideways. Measured, a cross-line arc reaching **35 px** was
  taking the innermost slot from a within-line arc reaching **350 px**.
- Every endpoint is now ordered by the distance it actually covers in the wrapped layout, the same
  frame that already decides which side of a token it leaves from. Within-line arcs are provably
  unaffected — over 53 such groups, the old and new orders never once disagree.

### Fixed: in full screen, the revealed titlebar really does sit under the native one

- The measurement 0.3.10 relied on reports the same value whether the native band is on screen or not,
  so the titlebar never moved. The band is not part of the app's window at all — macOS floats it in a
  window of its own and **fades it in**, resizing nothing.
- That window is now what gets measured, and the app's titlebar follows the fade rather than a
  resize that never happens. Confirmed by driving the whole gesture — full screen, pointer travelling
  up to the top edge — and watching the titlebar settle 32 px down and return.

## [0.3.10] — 2026-08-19

Two placement fixes, both in geometry that is only wrong under a condition the ordinary case never
meets: an enlarged script, and a full-screen window whose native titlebar has just slid back in.

### Fixed: cross-line arc endpoints join the fan of the arcs beside them

- In wrapped arcs, a cross-line arc's lower endpoint sat **a few pixels below** the within-line
  endpoints sharing the same token, so the two read as separate fans rather than one.
- The fan itself was never at fault — the endpoints were already pooled together, and the fan cannot
  place two of them at one offset. They were simply anchored at **two different heights**: a
  within-line arc seats on its row's arc anchor, while the cross-line endpoint was seated a fixed gap
  above the token. Those two expressions are **the same number at ordinary size**, which is why this
  had never appeared in an unmagnified document; above it, only one of them accounts for the taller
  glyph's extra ascent. Measured at 1.5×, the endpoints sat **5.25 px** low; they now land on the
  anchor to within 0.05 px, and every arc in an unmagnified document renders byte-identically.

### Fixed: in full screen, the revealed titlebar sits under the native one

- Mousing to the top of the screen reveals two bars on one gesture — macOS slides the window's own
  titlebar back over the content, and the app slides its titlebar and options bar in. Both wanted the
  top of the screen, so the app's chrome drew **behind the native band**.
- Nothing in the page can see that band: it overlays the content without resizing the viewport. The
  height is now measured on the window itself and pushed to the page, and both revealed bars offset by
  it. Non-macOS builds are unaffected.

## [0.3.9] — 2026-08-19

Two corrections: dragging a token no longer drags a text selection along with it, and the two Middle
Chinese tables now spell the 佳 rhyme the same way.

### Fixed: dragging a token no longer highlights the text around it

- The diagram itself is not selectable, so a drag could never highlight the tokens it was re-heading —
  but a selection that *begins* in an unselectable area can still be **extended into the text around
  it** as the pointer travels, and on the way to a drop target that is the running sentence, the
  transliteration and translation rows, and the grid. Nothing is selectable now for exactly the life
  of a drag, and any highlight that formed in the first few pixels is cleared; ordinary selection is
  back the instant the pointer is released. The marquee — a rectangle dragged over empty diagram
  space — is covered too.

### Changed: Middle Chinese follows the 2014 readings, in 1992's characters

- Baxter (1992) and Baxter & Sagart (2014) differ in **one reading rather than a spelling**: 1992
  writes the 佳 rhyme `-ɛɨ`/`-wɛɨ`, and 2014 replaces those with `-ea`/`-wea` — the ordinary `ɛ`
  vowel — so the rhyme stops having a notation of its own. Everything else between the editions is
  ASCII encoding of the same sounds (`' ae ea +` for `ʔ æ ɛ ɨ`).
- The Wiktionary-derived table is on the 2014 side of that; the Qieyun-derived one was built strictly
  1992, so the two disagreed on **185 readings across 173 graphs** and a reader comparing 佳 with any
  appendix-sourced graph saw two conventions in one column. The Qieyun table now follows the same
  convention: 佳 `kɛ`, 蟹 `hɛX`. Nothing else moved — same graphs, same positions — and agreement
  between the two tables rose from 94.3 % to 94.9 %.
- The **checked tone is not affected**, and is not one of the differences between the editions: both
  leave 入聲 unmarked and carry it on the `-p`/`-t`/`-k` coda alone.
- `tools/build_tshet_uinh_baxter.py` can still emit either edition — `--version 1992` for that
  edition's own `-ɛɨ`, `--version 2014` for the plain ASCII transcription — with the new
  `2014-ipa` (2014 readings, 1992 characters) as the default.

## [0.3.8] — 2026-08-19

A rendering and scrolling fix release: complex scripts shape reliably, diagrams line up with the
sentence above them, and the wheel always has somewhere to go.

### Fixed: complex scripts shape on the first try

- Picking a script the session had not used before left every glyph on the old HTML fallback until
  you switched to another script and back. The re-render that follows a batch of freshly shaped
  glyphs dropped the measurement cache but not the **diagram cache**, so the already-drawn sentence
  was handed straight back, unchanged, on every later render.
- **Rañjanā drew as Devanagari** in the arcs view. Rañjanā is written in Devanagari code points, so
  asking what script a word is in gives the right answer and the wrong face; the shaping now follows
  the same font override the rest of the app does. Two bugs sat on top of each other here — once the
  right family was asked for, no font bytes arrived for it either, because Nithya Ranjana is not on
  Google Fonts at all. It and the six bundled script faces are read straight off disk now.
- **Punctuation beside a magnified script** — the daṇḍa in particular — was drawn by a different
  rendering path than the words it stands with, and sat visibly higher than them. Both are seated on
  one baseline again.

### Fixed: diagrams line up with the running sentence

- **Hierarchies** sat at a different left edge in almost every block: a node backlight was sized from
  the word alone while the feature matrix under it is wider, so the bracket hung outside its own
  node and outside the alignment with it. Measured across one document, the visible left edge varied
  by 28 px block to block; it now varies by less than a pixel.
- **Wrapped brackets** hung their opening bracket clear of the sentence, because the alignment bound
  on the first token rather than on the bracket that opens the row.
- A wrapped block whose content starts inside its own box could not be pulled left at all, and sat
  up to 29 px right of the sentence while its neighbours sat on it.

### Fixed: enlarged scripts (Sanskrit, Literary Chinese)

- A hierarchy edge **ran down into the letters** of the node it arrives at — measured just under 4 px
  of overlap at 1.5×, against a pixel of clearance at ordinary size.
- **Multi-word tokens were drawn larger than the tokens they span** in stemmas and hierarchies, where
  the node glyphs were a step smaller than every measurement about them assumed.
- Hierarchy levels now grow with the glyphs, so an edge keeps its full height rather than being eaten
  from both ends by a magnified face.

### Fixed: stemmas

- A stemma spread wide enough by its own label spacing now **wraps** instead of running off the right
  edge — the wrap budget was measured against the window without allowing for the block indent.
- Two labels on **crossing edges with different heads** were drawn on top of each other. They are now
  lifted clear and tied back to their edge with a leader, the way the arcs view already does. Labels
  on one shared head keep separating horizontally, as before.

### Fixed: Sanskrit sandhi

- The CSL transliteration row writes `vāg-vidāṃ`, not `vāc-vidāṃ`: a word-final palatal voices before
  a voiced sound, which the display path was not doing even though the multi-word-token fusion beside
  it already did.
- A multi-word token that opens after a daṇḍa is no longer fused with the word on the other side of
  it. `manobhuvā |` followed by `aṅkastha…` was losing that word's own initial vowel to a coalescence
  across the verse break.

### Fixed: scrolling

- **The page would not scroll while the pointer rested on a diagram** that had no room to scroll of
  its own — which is most diagrams, most of the time. Those panes suppress the browser's own scroll
  chaining so the app can supply a better one, and a pane with nothing to scroll simply swallowed the
  gesture instead.
- Chaining now works with a **trackpad**, not only with a mouse: a pane that ran out of room part way
  through one continuous gesture kept the wheel for the rest of it.
- A pane can be scrolled even when the **page itself is at its end**, and the fixed tree overview of a
  wrapped block drives the page rather than absorbing the gesture.

### Also

- Seam markers are no longer drawn on stemma or hierarchy nodes, or in the outline: they mark where a
  word continues into the token beside it, which is a claim about a line of text, not about a node
  placed by depth. The stemma keeps them on its baseline word row.
- A seam marker stands off its word by one letter-space, and the inline editors carry the letter
  spacing of the row they open over, instead of re-spacing the text the moment it is clicked into.

## [0.3.7] — 2026-08-17

### Added: the Sanskrit parser's lexicon is installed for you

- The Sanskrit model reads **vidyut's morphological lexicon** at parse time — its embedding layer
  asks that lexicon, per token, for the set of analyses a form can have, rather than carrying a
  frozen extract of one. Both halves of that now arrive with the model: the `vidyut` package comes
  in as the wheel's own declared dependency, and Manage Models fetches the lexicon data (~32 MB
  download, ~81 MB on disk) as part of the same install.
- The lexicon is not optional in the way the Latin macrons are — the model **raises rather than
  degrading** without it, so a Sanskrit model installed on its own parses nothing at all. Pressing
  Install or Update on a Sanskrit model that is *already up to date* therefore fetches a missing
  lexicon rather than reporting "Already up to date" and leaving it absent, which is the state every
  machine whose Sanskrit model predates this is in.
- It is also a row of its own in Manage Models — **Sanskrit lexicon (vidyut)** — beside the Latin
  macrons, Persian vocalisation and grew backend rows, and it lands in `vidyut-data/` under
  Application Support. A `VIDYUT_DATA` you have set yourself is respected and never overwritten.

### Fixed: Nix installs can download parser models

- A Nix build could list models and offer an Install button that could never work: nixpkgs builds
  CPython `--without-ensurepip`, and the app installs every model wheel with
  `sys.executable -m pip`, so the only parser a Nix install could ever use was the English one in
  its own closure. `pip` is now part of the package, and downloaded models — and the on-demand
  tiers — install exactly as they do on every other platform.
- The one exception is the **bundled** English model, whose copy lives in the read-only Nix store
  and keeps taking precedence over any download. Updating it now says so, and says to update the
  package instead, rather than reporting a permission error about a store path. The same message
  covers a read-only app bundle or a root-owned site-packages.

### Changed: the bundled English parser

- The English model that ships with the app is now **`en_sud_ewt_gum`**, trained on SUD_English-EWT
  plus the ten GUM genres (+66 % training tokens, 81.3 → 81.9 LAS on EWT's own test set). It is what
  parses English text and what condenses each Wiktionary definition into a glossable phrase, whatever
  language the document is in.
- **`en_sud_ewt` is retired**: Manage Models no longer offers it. An environment built before this
  change keeps the older wheel — the per-user venv is created once, so a changed requirements file
  never reaches it — and keeps parsing English with it rather than losing English altogether. Such an
  install can now **Remove** it in Manage Models (it used to show as un-removable "Bundled"), and the
  new model is one Install away there; README's "Resetting an install" table has both routes. Nothing
  picks the retired wheel over the bundled one any more, in the Insert-text language picker or in the
  definition lookup, on a machine that has both.

### Fixes

- A token can no longer end up with the "punct" dependency relation unless its UPOS is PUNCT —
  strictly forbidden now, not just flagged. This previously depended on an optional, on-demand
  grammars download; it's now enforced unconditionally, and blocks the drag-to-reattach gesture
  (with a toast) in addition to the automatic relation the app computes for a re-headed token.
- (Homebrew only) A bare launch could briefly flash an unrelated English sample sentence before
  the real last-opened document appeared. The Homebrew Formula's own build step never stripped the
  browser dev-mode fixture the way every other distribution channel already does; fixed in the tap
  (`skalyan91/homebrew-sud-workbench`), no change needed in this repo.

## [0.3.6] — 2026-08-16

### Fixes

- Japanese running transliteration no longer puts a space after an opening quotation mark (「/『)
  or before a closing one (」/』) — the romaniser was collapsing all four to the same plain ASCII
  `"`, which lost the open/close distinction the line's own spacing rule depends on.
- The validity checker now flags a token whose dependency relation is "punct" but whose UPOS isn't
  PUNCT, however that combination arose — a manual edit or an automatically-computed relation alike.

### Renamed

- The Japanese "Modified Hepburn" transliteration scheme is now just "Hepburn" in the
  transliteration menu.

## [0.3.5] — 2026-08-16

### New: parser update indicators

- The Manage Models install button turns into a green "Update" button, and the models dropdown
  marks an entry with an up arrow, whenever a newer version of a parser is available than what's
  installed.
- Installing or updating a model now shows progress directly on the button itself — it fills in
  left to right as an outlined bar, rather than growing the row with a separate progress element.

### Fixes

- The bundled English parser could not be updated: an update installed correctly, but the app's
  own core copy of the package always shadowed it on Python's import path, so the old version kept
  running. The shadowing core copy is now removed once an update to a bundled model succeeds.
- Updating the Sanskrit parser appeared to have no effect: the newly-installed package was
  re-imported under its old, already-cached module, and the "Update" button could keep reappearing
  afterwards if the installed wheel's own internal version metadata didn't match its filename. Both
  are now tracked correctly.
- The install/update progress bar's text is now always the contrasting colour against the filled
  portion, and the button no longer collapses to a sliver too narrow for its own label.
- Wrapped stemma and hierarchy-tree diagrams' edge casing (the halo that lets one edge cleanly
  cross in front of another) is back to one shared pass per diagram, reverting a change that had
  split it per node — flat stemma and tree diagrams are unaffected and keep the per-node casing.
- A document's last block could cap shorter than the viewport even with room to spare, forcing an
  unnecessary internal scroll — it was reserving space for a next page that, being the true end of
  the document, doesn't exist. Fixed; only a block genuinely followed by another page reserves that
  space now.
- The "Add sentence" button at the end of a document is now labelled "Add text".

## [0.3.4] — 2026-08-16

### Fixes

- The Show/Hide menu's "Feature matrices" (AVM) toggle now actually hides AVMs in outline view —
  it never had the same `show.avm` gate every other notation's AVM box already respected.
- Fixed a real bug in Sanskrit script handling: typing Devanagari into an otherwise-empty document
  correctly stored it as Devanagari, but the app's own bookkeeping of which script the document is
  stored in never learned about it — so every sentence after the first was wrongly refused with
  "this document stores its text in IAST". Re-derived from the document's own forms after every
  insert, matching the app's own "read off the forms, never off a preference" design.
- Inserting a sentence now scrolls to it, instead of silently staying at the top of the document —
  a scroll call was running before the render it depended on had actually happened.
- Turning on Feature matrices (AVM) could push a diagram wider than its view without wrapping to
  fit. Fully fixed in outline view (real horizontal overflow up to 247px, with a visible scrollbar,
  is now zero); the wrapped stemma/tree views' own AVM-driven gap is closed too, along with a
  second, unrelated overflow traced to a node's own hover-highlight circle exceeding its row.
- Sanskrit MWT sandhi: a word ending in "c" no longer voices to an impossible form before a
  voiced sound (e.g. vāc → vāj) — corrected the general word-final-consonant voicing rule itself
  (c → g, not c → j; Whitney's Sanskrit Grammar §142), rather than special-casing the one reported
  word, so every word ending in "c" is affected, not just vāc.
- The options bar visibility toggle is now per-window — opening it in one window no longer opens
  it in every other open window.
- Stemma and hierarchy-tree diagrams now correctly show one edge crossing cleanly in front of
  another wherever two edges from different nodes actually cross, instead of the two just
  overlapping as bare intersecting lines. Edges from the SAME node share one casing halo, so a
  node with several dependents reads as one clean bundle rather than several separately-outlined
  ones.

## [0.3.3] — 2026-08-15

### Fixes

- Corrected a false attribution: SUD (Surface-syntactic Universal Dependencies) is not
  Sunflower AI's own relation set — it was introduced by Gerdes, Guillaume, Kahane and
  Perrier (surfacesyntacticud.org), an independent academic project. Fixed everywhere this
  was claimed (`README.md`, `CLAUDE.md`, and the Linux packaging descriptions), and purged
  from git history.
- Widened the macOS first-launch setup dialog (440px → 560px) — the longest status message,
  "Installing dependencies (this can take a few minutes)…", was being truncated.

### Documentation

- Added an Install section to `README.md` — the Homebrew tap and the GitHub Releases page
  both existed already but were never actually mentioned anywhere in the main project docs.

### UI

- Relabelled the Show/Hide menu's "Attribute-value matrix" checkbox to "Feature matrices".

## [0.3.2] — 2026-08-15

### Diagram editing and layout

- Re-derived where fanned arc endpoints land when two arcs meet at a shared node (the "head-to-tail"
  case) or when a root edge's stub meets its nearest neighbour. Both are now solved directly from a
  single geometric target — the two endpoints' own casing outlines land exactly tangent — rather than
  matched to a proxy reference gap with a hand-tuned correction on top. The two formulas are now
  shared functions (`diagram-core.js`) called from both the flat and wrapped diagram views, instead
  of being kept in sync by hand across two files.

### Packaging metadata

- Dropped the `sunflowerai.io` email address and the incorrect `SunflowerAI` GitHub-org homepage
  URL from the Debian/RPM/Windows-installer maintainer and homepage fields — this project isn't a
  Sunflower AI product, and no email address is used in these fields at all. Corrected to the
  actual repository location, `github.com/skalyan91/sud-workbench`.

## [0.3.1] — 2026-08-15

A same-day fix for a real bug in v0.3.0's own Linux packages: `adwaita-kit/` (the Linux GTK chrome)
rendered completely unstyled on a real `.deb`/`.rpm` install — no icons, no chrome colours at all.

### Fixes

- `adwaita-kit/adwaita-tokens.css` and `adwaita-chrome.css` `@import`ed `macos-kit/` directly to
  inherit its tokens/chrome wholesale — but `packaging/linux/make_deb.sh`/`make_rpm.sh` deliberately
  strip `macos-kit/` from every Linux build (SF-Symbols licensing, same reason the Windows build
  drops it). The `@import` target was simply absent, and a failed CSS `@import` fails silently, so
  this was never caught by a boot-check (the app still launched — it just rendered bare). New
  `web/chrome-shared/` holds everything `macos-kit/` used to declare directly, minus the eight real
  SF Symbols (which get Fluent UI System Icons equivalents there instead, MIT-licensed, matching
  `win11-kit/`'s own sourcing for the same eight icons) — safe for every platform to import, since
  it carries no Apple-restricted content to strip. `macos-kit/` itself now imports this shared base
  and layers the real SF Symbols on top; `adwaita-kit/` imports it directly. Verified against a real
  extracted `.deb` and a real headless-Chrome render of both platforms' resolved CSS custom
  properties, not just that the packages install.

## [0.3.0] — 2026-08-15

A licensing-and-hardening release: every dependency's licence is now disclosed or
fetched on demand rather than bundled, several rounds of arc-endpoint tuning are
settled on a single trigonometric formula, and a batch of titlebar/editing polish
lands alongside it.

### Licensing and packaging

- **Full dependency licensing audit.** `en_sud_ewt`'s CC BY-SA 4.0 licence, and
  three previously-undisclosed copyleft pip dependencies (`wiktra`, `grewpy`,
  `aksharamukha`), are now stated in `THIRD-PARTY-NOTICES.md`. HarfBuzz's core
  licence text and the OFL font licence are now bundled verbatim rather than
  referenced.
- `grew`'s OCaml conversion backend is now fetched on demand via `opam` at first
  use, instead of being bundled into any build — matching the existing pattern
  for grammars and macronisation data. UD↔SUD/mSUD conversion is unavailable
  until it's fetched, surfaced as a toast rather than failing silently.
- CAMeL Tools is removed entirely: its one import site had had zero real
  callers since the initial commit.
- Titlebar SF Symbol icons are no longer committed to source as base64 PNGs —
  they're rendered at packaging time instead, and every historical payload has
  been purged from git history. A handful of genuinely-unused icon tokens were
  removed, and `--sf-open`'s icon was migrated off an unidentified legacy PNG
  onto a real SF Symbol (`square.and.arrow.down.on.square`).

### Diagram editing and layout

- Arc endpoints — for ordinary arcs, root edges, and cross-line arcs alike —
  now anchor by a single trigonometric formula off the arrowhead's own angle,
  replacing several rounds of ad hoc offset tuning with one consistent rule.
- Fixed the AVM tier's width never fully deflating out of the stemma
  notation's baseline token wash after being hidden.
- Diagrams now carry a negative left margin equal to the token wash's own
  padding, instead of double-counting it.
- Fixed second-level context-menu flyouts (POS subtypes, deep features)
  landing in the window's top-left corner instead of at the cursor.

### Titlebar and window chrome

- Fixed the filetype icon's slide-in animation never actually animating in a
  real WKWebView (it silently no-op'd), and made it snappier once it did.
- Fixed a hover-flicker at the filetype icon's left edge; its hover area now
  matches the title's own extent exactly when the icon is hidden.
- A sentence block's bottom padding is now floored at the running-sentence-to-
  diagram gap, so it never collapses tighter than the gap above it.
- Fixed the bootstrap-packaged app showing "Python" in the Dock and menu bar
  instead of its own name.

### Fixes

- Pressing Escape now cancels an in-progress token drag.

## [0.2.0] — 2026-08-14

A large batch of new features and fixes on top of the initial `0.1.0` release,
centred on a new grammatical-feature notation, real Arabic/Persian vocalisation,
and a native-glyph rendering pipeline that the rest of this release leans on.

### New: Attribute-Value Matrix (AVM) tier

- A new tier draws an HPSG-style attribute-value matrix of a token's morphological
  features (FEATS) as a real bracketed matrix below its POS tag, on by default.
  Composite features (agreement, TAM) group into their own sub-matrix. Right-click
  a whole AVM or a single value for feature-editing menus, including an "Other…"
  flyout for values that are valid for a POS but not yet attested in the file.
- The Outline notation gets matching real brackets (one per matrix, not one per
  pair), and every wrapping notation (brackets, arcs) accounts for the AVM's own
  height when laying out multi-line diagrams.
- Sub-part-of-speech features (e.g. pronoun type) now render on the POS tag
  itself rather than duplicating into the AVM; a handful of features that are
  already notated elsewhere (ExtPos, Shared, Foreign, Typo, Reported, Poss) are
  excluded from the AVM outright.

### New: native glyph shaping (HarfBuzz)

- Every text element the diagram draws — tokens, AVM attributes/values, glosses,
  small caps — is now shaped with a vendored HarfBuzz-WASM engine and drawn as
  native SVG paths, instead of relying on the browser's own text layout.
  This closes a whole class of bugs where a label's *measured* width (used for
  layout) and its *painted* width (what the browser actually rendered, after
  font features like small caps or Brahmic glyph substitution) disagreed —
  previously visible as jittering labels, clipped brackets, and mis-centred
  arcs. It also fixes Devanagari and other Indic-script token rendering in the
  hierarchy notation, which previously used a native-SVG text path that HarfBuzz
  shaping now replaces properly.

### Arabic and Persian

- Arabic and Persian text in every diagram (SVG) and the AVM tier now shapes
  through HarfBuzz for correct joining and RTL layout, instead of the browser's
  own (occasionally inconsistent) Arabic-script text engine.
- **Vocalisation** — Arabic and Persian now get a real, editable vocalised
  (diacritic-marked) form, mirroring the existing Latin macronisation feature:
  a dedicated transliteration row shows the vocalised form, which is
  click-to-edit when the automatic vocaliser gets it wrong. Persian vocalisation
  is sourced from KaamelDict; multi-word tokens are vocalised by concatenating
  their components. The transliteration row always reads the vocalised form
  rather than tracking whatever script is currently selected.
- Fixed the AGR (agreement) label vanishing in right-to-left AVMs, and
  re-verified RTL padding and layout end to end.

### Script and transliteration

- A new, genuinely-ornamental 2× script tier now covers Rañjanā, Soyombo,
  Bhaiksuki and Siddhaṃ — hands whose ornamentation doesn't resolve at the
  regular 1.5× size the other Brahmic scripts get. Balinese moved back to the
  regular 1.5× tier.
- **Brahmi** is now a selectable Script, previously missing entirely.
- The Script menu auto-scrolls the current selection into view on open, and
  sizes itself against the real available space above the pill instead of a
  fixed cap.
- Tibetan is now treated as a stacking script (its leading separator is
  stripped before a daṇḍa, matching the other Brahmic scripts), and Tibetan
  text now renders in Noto Serif Tibetan rather than Noto Sans Tibetan, whose
  Sanskrit-stacking bug is a decade old.
- Sanskrit stored in Devanagari now enlarges correctly, matching the existing
  behaviour for IAST-stored files.
- Chinese/Literary Chinese: 不's tone sandhi (4th → 2nd tone) now applies
  across a token boundary, not just within one.

### Titlebar and window chrome

- Reordered the titlebar controls (Grid / Options / Zoom / Paged) and
  calibrated their translucency — both active and inactive — against real
  screenshots rather than guesswork; pill backgrounds are now 50% opacity with
  a blur.
- Titlebar icons went through three rounds of sizing fixes and are now a
  uniform 20px everywhere, grounded in the actual UI-kit reference rather than
  another model's estimate; the grid icon's own capping bug and a genuinely
  corrupted grid-icon PNG are both fixed.
- Fixed the seam between the titlebar and the view bar to share one backdrop
  filter instead of two independently-tuned ones that drifted apart.
- The notation picker is now a single Finder-style dropdown (was five separate
  buttons), with a real disclosure chevron, ⌘1–⌘5 shown in its menu, and a
  chevron that dims correctly on window blur.
- The Options bar's own padding and the gap between its dropdowns are now
  simple, explicitly-related values instead of derived arithmetic that drifted.

### Diagram editing and layout

- Wrapped brackets and arcs: fixed cross-line arc centring, MWT-bracket height,
  inter-row spacing, and left-edge clipping on lead tokens — all now seated off
  the actual tokens/rows they touch rather than a sentence-wide maximum.
- Hierarchy notation: a parent's own AVM box now correctly re-seats the whole
  subtree when it outgrows the room its descendants reserved, and an edge's
  parent endpoint now rises to the node's own AVM bottom rather than a
  sentence-wide one.
- Ghost (ambiguous/ghost-relation) arcs now fan together with real arcs by
  length, consistently across flat, wrapped and stemma layouts.
- Multi-word tokens can now be drag-reordered as a whole group in the diagram,
  matching the grid's existing reorder gesture.
- Diagram-driven feature editing reaches parity with the grid: adding a FEATS
  value from the diagram, a Clear-button fix, per-value right-click on
  composite features, and a new "Paragraph starts here" (MISC `NewPar`) row.
- Subject raising can now be recorded by dropping a predicate and one of its
  arguments onto each other in either direction, and `CorrectForm` can be set
  independently of `Typo` state.
- New free-text authoring of a relation from the diagram's own relation menu.

### Fixes

- CoNLL-U parse errors now report a line number and a plain-language message.
- The daṇḍa's leading gap is now stripped in diagrams, matching the running
  sentence (previously only the running sentence had the fix).
- A false "delete morphemic gloss?" warning no longer fires when a gloss is
  enabled and immediately disabled again.
- The UD↔SUD conversion grammars are fetched on demand at install time rather
  than vendored.

## [0.1.0] — initial release
