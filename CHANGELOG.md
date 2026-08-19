# Changelog

All notable changes to SUD Workbench are documented in this file.

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
