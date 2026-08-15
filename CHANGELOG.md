# Changelog

All notable changes to SUD Workbench are documented in this file.

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
