# Third-party notices

SUD Workbench is MIT-licensed (see `LICENSE`). That covers the code and assets original to
this project. The components below are **vendored into this repository** — redistributed with
it rather than fetched at install time — and each keeps the terms of its own upstream. Bundling
them alongside MIT code is aggregation, not relicensing: none of them becomes MIT, and the MIT
grant does not extend to them.

Runtime dependencies installed by `pip` (`requirements.txt`, `requirements-core.txt`) are **not**
vendored and are not listed here; they are obtained under their own licences at install time. Four
exceptions are worth naming up front, because `packaging/make_portable.sh` pip-installs them
**straight into the shipped `.app`** rather than leaving them to an end-user install step —
`en_sud_ewt` (pinned as a hard dependency rather than bundled the way every other model is), and
three copyleft libraries, `wiktra`, `grewpy`, and `aksharamukha`. See "Bundled pip dependencies —
the exceptions to 'pip deps aren't listed'" below for what each is, what it's used for, and under
what licence.

---

## Resolved: `grammars/` — no longer vendored

**The grew UD↔SUD conversion grammars have no declared licence.** The whole `converter/grs/`
subtree (plus `validator/modules/`) from
[surfacesyntacticud/tools](https://github.com/surfacesyntacticud/tools), pinned to commit
`03c3bbd88e33a0f6331b58d0669edf1031aa9efb`, and neither that repository nor its files state any
licence — so this content **cannot be safely republished**: absent a licence there is no grant of
redistribution rights.

This used to be vendored straight into this repository (a committed `grammars/` directory), which
was the one thing standing between this repo and being made public. It no longer is: `app/
grammars.py` fetches it **on demand, onto the end user's own machine**, the same on-demand shape
`app/macron.py` already used for the Latin macron data (see that module and `app/extras.py` for
the mechanism — one of the three ways out this section used to list, "replace the vendored copy
with a fetch step that pulls the grammars at install time"). Nix builds fetch it hermetically at
the user's own `nix build`/`nix-build` time instead (`default.nix`'s `grammarsSrc`), which is the
same idea applied Nix's own way. Neither this repository nor any package built from it carries a
copy any more — fetching directly from upstream onto a user's own machine is not redistribution.

Everything else below is properly licensed.

---

## Fonts — `web/fonts/`

| Component | Files | Upstream | Licence |
|---|---|---|---|
| Noto Sans family | 172 `.ttf` | [notofonts](https://github.com/notofonts) | SIL OFL 1.1 |
| Nithya Ranjana DU | `nithyaranjana.otf` | [EkType/NithyaRanjana](https://github.com/EkType/NithyaRanjana) | SIL OFL 1.1 |

- Noto Sans: Copyright The Noto Project Authors. <https://openfontlicense.org>
- Nithya Ranjana DU: Copyright 2024 The Nithya Ranjana Project Authors. <https://scripts.sil.org/OFL>

Both declare OFL 1.1 in their own `name` tables (IDs 13/14) — confirmed against each font's own
upstream `OFL.txt` (`notofonts`'s and `EkType/NithyaRanjana`'s), which are byte-identical outside
their one differing copyright line, so a single bundled copy correctly covers both. The licence
text itself is fetched from upstream and shipped alongside the fonts at `web/fonts/OFL.txt`, since
OFL's own condition 2 expects "each copy" of the redistributed font to be accompanied by "the above
copyright notice and this license" (rather than just a link to it). The OFL permits bundling and
redistribution with software; it forbids selling the fonts on their own, and it requires that any
**modified** version be renamed. Neither font is modified here.

## Chrome kits — `web/macos-kit/`, `web/win11-kit/`

The app ships two chrome kits and loads exactly one, chosen at page load from `<html
data-platform>`. Their icon sets are unrelated in provenance.

| Component | Where | Upstream | Licence |
|---|---|---|---|
| Fluent UI System Icons | `win11-kit/fluent-tokens.css` — 38 of 40 `--sf-*` masks | [microsoft/fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons) @ `a9e7f2d7bd8a` | MIT |
| WinUI 3 theme resources | `win11-kit/*.css` — colours, radii, metrics, timings | [microsoft/microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml) | MIT |
| Lucide | `macos-kit/mac-tokens.css` and `win11-kit/fluent-tokens.css` — the hand-drawn `--sf-*` masks | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | ISC |
| SF Symbols | `macos-kit/mac-tokens.css` — 12 `--sf-*` masks, base64 PNG | Apple | see below |

- Fluent UI System Icons and the WinUI theme resources are both Copyright (c) Microsoft
  Corporation, MIT. From `microsoft-ui-xaml` **no code is copied — values only**, read out of
  `Common_themeresources_any.xaml`, `CornerRadius_themeresources.xaml`,
  `MenuFlyout_themeresources.xaml`, `ScrollBar_themeresources.xaml`,
  `TextBlock_themeresources.xaml`, `TitleBar/TitleBar_themeresources.xaml` and
  `Materials/Acrylic/AcrylicBrush.{h,_themeresources.xaml}`.
- Lucide glyphs are inlined as SVG path data, each named in a trailing comment at its own token.
  `--sf-narcs` and `--sf-nbrackets` are Lucide in **both** kits: they draw a notation, not an OS
  affordance, so Fluent has no counterpart to swap in.

**SF Symbols are Apple's, and are macOS-only on purpose.** Twelve masks in `mac-tokens.css` are
real SF Symbols rendered to base64 PNG, and on macOS the native shell replaces several of them with
symbols it renders at runtime. Apple licenses SF Symbols for use in apps **on Apple platforms**;
reproducing the artwork inside a Windows application is not covered. So `packaging/windows/
make_win_app.py` **excludes `web/macos-kit/` from the Windows payload** and fails the build if it
survives — the Fluent kit supplies all 40 masks from MIT-licensed sources, so nothing is lost.
`packaging/make_bootstrap_app.sh` drops `web/win11-kit/` from the macOS bundle symmetrically,
though that one is for size alone: MIT would have travelled fine.

## Data — `app/data/`

| Component | File | Upstream | Licence |
|---|---|---|---|
| Apte, *The Practical Sanskrit-English Dictionary*, rev. ed. 1957 | `apte1957.tsv.xz` | [sanskrit-lexicon/csl-orig](https://github.com/sanskrit-lexicon/csl-orig), `v02/ap` | **CC BY-SA 4.0** |
| Unihan `kHangul` readings | `hanja_hangul.tsv` | Unicode Character Database, UAX #38 | Unicode Licence |
| fastText `lid.176` language ID model | `lid.176.ftz` | [facebookresearch/fastText](https://github.com/facebookresearch/fastText) | **CC BY-SA 3.0** (the model; the library itself is MIT) |

**The two CC BY-SA components are share-alike**, which has a consequence worth stating plainly:
`apte1957.tsv.xz` is a *derivative* of the CDSL source text (built by `tools/build_apte_index.py`),
so that file and any further adaptation of it remain CC BY-SA 4.0 and must carry attribution. The
attribution rides in the file's own first line, and the build script reproduces it. The MIT grant
above does not cover these files.

Digitisation of Apte is by the Cologne Digital Sanskrit Dictionaries project.

## Vendored source modules — `app/`

| Component | File | Upstream | Licence |
|---|---|---|---|
| `toolbox.py` (SIL Toolbox/FLEx reader) | `_toolbox_vendor.py` | [acoli-repo/toolbox_py](https://github.com/acoli-repo/toolbox_py) @ `27bdaa3` | MIT |
| `scripts/external_sandhi.py` (forward Sanskrit sandhi, CSL notation) | `_sa_sandhi_vendor.py` | [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers) @ `6997ed73` | MIT, Copyright (c) 2026 Sunflower AI |

Each file states its own provenance and the exact edits made in its module docstring — one import
redirected to `collections.abc` in the first, and nothing at all in the second — it imports nothing
and is copied verbatim.

(`_sa_csl_vendor.py`, `scripts/sa_tokenizer.py`'s Sanskrit CSL de-sandhi, was vendored here until
`sa_sud_vedic_ufal_dcs` replaced the CSL Sanskrit model. That notation is now internal to the model
and never reaches a file, so nothing in this app has to REVERSE it — the third file above generates
it FORWARD, for display only.)

## JS libraries — `web/js/vendor/`

| Component | Files | Upstream | Licence |
|---|---|---|---|
| HarfBuzz (WASM build) + harfbuzzjs | `harfbuzz/hb.js`, `harfbuzz/hbjs.js`, `harfbuzz/hb-wasm-data.js` (hb.wasm, base64-embedded) | [harfbuzz/harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) @ `0.4.6`, wrapping [harfbuzz/harfbuzz](https://github.com/harfbuzz/harfbuzz) | "Old MIT" (core) + MIT/Apache (wrapper) — see `harfbuzz/COPYING` and `harfbuzz/LICENSE-harfbuzzjs.txt` |

Two separate licences are bundled here, and neither substitutes for the other. `harfbuzz/COPYING`
is HarfBuzz **core**'s own licence, naming its real copyright holders (Google, Facebook, Mozilla,
Nokia, Red Hat, Adobe, SIL International, and others, back to 1998) under the "Old MIT" terms — this
is the text that actually governs the shaping engine `hb.wasm` compiles. `harfbuzz/
LICENSE-harfbuzzjs.txt` is the **wrapper**'s own licence — Ebrahim Byagowi's `harfbuzzjs` glue code
(`hb.js`/`hbjs.js`), MIT with a small Apache-licensed subcomponent (Zephyr's `zephyr-string.c`,
emscripten's `emmalloc.cpp`) — and covers only that glue, not the engine it wraps. Both texts are
fetched from each project's own current upstream (`harfbuzz/harfbuzz`'s `COPYING`, unmodified).

Used by `js/lang/smp-shape.js` (item 25) to shape the SMP Brahmic scripts (Kawi, Grantha, Siddhaṃ,
Soyombo, Sharada, Newa, Bhaiksuki, Modi, Tirhuta, Zanabazar Square) as native SVG `<path>` geometry,
replacing an HTML/`<foreignObject>` fallback that existed because WebKit's own SVG `<text>` renderer
fails to shape these scripts (see that module's own note for the measured evidence). `hb.wasm` is
embedded as base64 rather than fetched as a sibling file — the same "hand the WebView a `data:`
payload, don't trust a same-directory `fetch()`" reasoning `app/fonts.py` already documents for the
script webfonts. The actual font bytes HarfBuzz shapes against are never vendored here: they come
from the same on-demand Google Fonts fetch `app/fonts.py`/`fontload.js` already make for `@font-face`
(a separate raw-`.ttf` request, `fonts.fetch_raw`, since this WASM build cannot decompress WOFF).

## Latin vowel lengths — FETCHED AT RUNTIME, never shipped

Nothing about Latin macronisation is vendored here any more. The lookup *code* is the
`la_macronise` component inside the `la_sud_ittb_proiel_perseus` model wheel (Sunflower AI's own),
and `app/macron.py` is a façade that calls it. The vowel lengths themselves come from **Morpheus**
(Perseus Project, **CC BY-SA 3.0 US**) by way of the copy Johan Winge commits in **latin-macronizer**
(**GPL-3.0**) as `latin_macronizer/macrons.txt`. That component downloads the file on demand into its
own cache (`~/.cache/sud-spacy/`, or `$LA_MORPHEUS_TABLE`) and compiles it there — it is not in this
repository, not in the model wheel, not in any build, and must not be added to any of them.

That distinction is doing real work, not being pedantic: **GPL-3.0 restricts distribution, not
use.** A file the user's own machine fetches from the upstream host, which never enters a build of
this app, is the same arrangement `app/convert.py` has with the grew backend and `app/extras.py`
has with the PyTorch tiers. Bundling it would raise a licence question; fetching it does not.

(SUD-spaCy's own `build_la_macron.sh` produces a DIFFERENT table, harvested by macronising three
CC BY-**NC**-SA treebanks. That one mixes NonCommercial keys with share-alike data and cannot be
redistributed by anyone — upstream says so itself, and ships the component with `--no-lut` for
exactly that reason. The component still reads one if the user has built it into their own model,
cascading it ahead of Morpheus for the words it covers, but it is never required.)

| Data behind that feature | Origin | Licence |
|---|---|---|
| Morpheus vowel-length data | [PerseusDL/morpheus](https://github.com/PerseusDL/morpheus) | CC BY-SA 3.0 US |
| latin-macronizer (the route to it) | [Alatius/latin-macronizer](https://github.com/Alatius/latin-macronizer) | GPL-3.0 |
| SUD_Latin-ITTB / PROIEL / Perseus (the harvest keys, if built) | Universal Dependencies | CC BY-NC-SA |

## Bundled pip dependencies — the exceptions to "pip deps aren't listed"

Four `pip` dependencies break the "not vendored, not listed" rule stated at the top of this file.
`packaging/make_portable.sh` pip-installs `requirements-core.txt` directly into the shipped `.app`
(`pip install --target "$RES/applib" -r requirements-core.txt`) rather than leaving the install to
the end user — that is genuine redistribution, not an install-time fetch, so each of these keeps
its own upstream licence and is named here individually.

(`packaging/make_bootstrap_app.sh` takes the other shape instead: it copies `requirements-core.txt`
and a `setup_venv.sh` step into the bundle, and the actual `pip install` runs on the **end user's
own machine** at first launch — closer to "fetch, don't redistribute," the same distinction this
file already draws for the grew backend below. A future Homebrew formula is likely to follow that
second shape too, installing into a user-writable venv at `brew install` time rather than shipping
these packages as part of the formula's own bottle.)

| Component | Licence | Real usage |
|---|---|---|
| `en_sud_ewt` | **CC BY-SA 4.0** | English SUD parser model wheel; `app/wiktionary.py` SUD-parses each Wiktionary definition to condense it into a glossable phrase |
| `wiktra` | **GPL-2.0** | `app/translit.py`'s default Latin-transliteration backend — a Python port of Wiktionary's own Lua translit modules |
| `grewpy` | **CeCILL v2.1** | `app/convert.py`'s UD↔SUD↔mSUD conversion — the Python client that talks to the separately-vendored `grewpy_backend` OCaml binary |
| `aksharamukha` | **AGPL-3.0** | Sanskrit/Indic-script conversion in `app/translit.py`, `app/apte.py` (Apte dictionary lookup), and `app/itrans.py` (ITRANS input) |

- **`en_sud_ewt`** is a derivative of **SUD_English-EWT**, a Surface-Syntactic Universal
  Dependencies treebank itself derived from Universal Dependencies English-EWT. Per
  [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers)'s own
  `NOTICE.md`: "The relabelled treebanks committed here (…), the per-language gold sets, and the
  **released model wheels** are derivative works of [SUD] treebanks … distributed under Creative
  Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)." CC BY-SA's own attribution
  requirement runs to the treebank, not just to Sunflower AI: that same `NOTICE.md` instructs
  readers to "cite the individual UD/SUD treebanks when using these models; their authors are
  credited in each treebank's own `LICENSE.txt`" — here, SUD_English-EWT's.
- **`wiktra`** ([twardoch/wiktra2](https://github.com/twardoch/wiktra2), GPL-2.0) is instantiated as
  `wiktra.Transliterator()` and is the general-purpose romanizer for any language/script not routed
  to a dedicated backend (Cyrillic, Greek, Devanagari, and others) — `translit.py`'s
  `_pre_scheme_translit` runs it first and falls back to `uroman` only where wiktra leaves the text
  unchanged.
- **`grewpy`** (the pip package on [PyPI](https://pypi.org/project/grewpy/), CeCILL v2.1) is
  distinct from `grewpy_backend`, the OCaml binary vendored under `vendor/grew/bin/` by
  `tools/bundle_grew.sh` (see below) — `grewpy` is an ordinary `requirements-core.txt` entry,
  imported as a normal Python module (`from grewpy import GRS, Graph, set_config`), that talks to
  that binary to actually run the `.grs` UD↔SUD grammars.
- **`aksharamukha`** ([virtualvinodh/aksharamukha-python](https://github.com/virtualvinodh/aksharamukha-python),
  AGPL-3.0) converts between IAST/Sanskrit transliteration and Indic scripts (Devanagari, Grantha,
  Siddhaṃ, and more); `app/apte.py` also uses it to turn a lemma into the SLP1 the Apte dictionary
  index is keyed on. It is explicitly **not** used for the Sanskrit parser's own Devanagari→IAST
  front end — that is `indic-transliteration` (MIT) instead, because upstream found aksharamukha
  renders "।" as "." and that breaks the model's danda-based sentence splitting (see
  `requirements.txt`'s own comment on the two packages).

## Not vendored, but worth naming

- **grew** — the OCaml backend (`grewpy_backend`) is an optional external prerequisite, built by
  `tools/bundle_grew.sh` or taken from `~/.opam`. `vendor/` is git-ignored, so no grew binary is
  redistributed here.
- **Stanza / spaCy models** — downloaded at runtime into the user's own application-support
  directory, under their own licences.
- **pykakasi** (GPL-3.0) — kana → Hepburn romaji conversion for the on-demand Japanese extras tier
  (`app/extras.py`'s `"japanese"` tier: `janome`, `pykakasi`, `cutlet`, `fugashi`, `unidic-lite`,
  ~0.45 GB). Never in `requirements-core.txt`; fetched into the user's own extras directory
  (`~/Library/Application Support/SUD Workbench/site-packages`) only when that tier is installed
  from Manage Models, the same shape as the Stanza/spaCy models above.
