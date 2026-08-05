# Third-party notices

SUD Workbench is MIT-licensed (see `LICENSE`). That covers the code and assets original to
this project. The components below are **vendored into this repository** — redistributed with
it rather than fetched at install time — and each keeps the terms of its own upstream. Bundling
them alongside MIT code is aggregation, not relicensing: none of them becomes MIT, and the MIT
grant does not extend to them.

Runtime dependencies installed by `pip` (`requirements.txt`, `requirements-core.txt`) are **not**
vendored and are not listed here; they are obtained under their own licences at install time.
The one exception worth naming is `en_sud_ewt`, pinned as a hard dependency rather than bundled.

---

## ⚠ Unresolved: `grammars/`

**The grew conversion grammars have no declared licence.** The whole `grs/` subtree is vendored
verbatim from [surfacesyntacticud/tools](https://github.com/surfacesyntacticud/tools) at commit
`03c3bbd88e33a0f6331b58d0669edf1031aa9efb`, and neither that repository nor the vendored files
state any licence. Absent a licence there is no grant of redistribution rights, so this directory
is the one component here that **cannot be safely republished**, and it is the blocker on making
this repository public as it stands.

Three ways out, in the order worth trying: ask the upstream authors to declare a licence; replace
the vendored copy with a fetch step that pulls the grammars at install time onto the user's own
machine; or drop UD conversion from the shipped build. Until one of those happens, treat
`grammars/` as redistributable only within this private repository.

Everything else below is properly licensed.

---

## Fonts — `web/fonts/`

| Component | Files | Upstream | Licence |
|---|---|---|---|
| Noto Sans family | 172 `.ttf` | [notofonts](https://github.com/notofonts) | SIL OFL 1.1 |
| Nithya Ranjana DU | `nithyaranjana.otf` | [EkType/NithyaRanjana](https://github.com/EkType/NithyaRanjana) | SIL OFL 1.1 |

- Noto Sans: Copyright The Noto Project Authors. <https://openfontlicense.org>
- Nithya Ranjana DU: Copyright 2024 The Nithya Ranjana Project Authors. <https://scripts.sil.org/OFL>

Both declare OFL 1.1 in their own `name` tables (IDs 13/14). The OFL permits bundling and
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
| `scripts/la_macronise.py` (Latin vowel-length lookup) | `_la_macron_vendor.py` | [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers) @ `6997ed73` | MIT, Copyright (c) 2026 Sunflower AI |
| `scripts/external_sandhi.py` (forward Sanskrit sandhi, CSL notation) | `_sa_sandhi_vendor.py` | [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers) @ `6997ed73` | MIT, Copyright (c) 2026 Sunflower AI |

Each file states its own provenance and the exact edits made in its module docstring — one import
redirected to `collections.abc` in the first, the spaCy factory/extensions and the `Doc` entry point
dropped in the second, and nothing at all in the third — it imports nothing and is copied verbatim.

(`_sa_csl_vendor.py`, `scripts/sa_tokenizer.py`'s Sanskrit CSL de-sandhi, was vendored here until
`sa_sud_vedic_ufal_dcs` replaced the CSL Sanskrit model. That notation is now internal to the model
and never reaches a file, so nothing in this app has to REVERSE it — the third file above generates
it FORWARD, for display only.)

⚠ **The Latin macron data is FETCHED AT RUNTIME, never shipped.** `_la_macron_vendor.py` is only
lookup *code*, which is Sunflower AI's own and MIT. The vowel lengths themselves come from
**Morpheus** (Perseus Project, **CC BY-SA 3.0 US**) by way of the copy Johan Winge commits in
**latin-macronizer** (**GPL-3.0**) as `latin_macronizer/macrons.txt`. `app/macron.py` downloads that
file on demand into the user's Application Support directory and compiles it there — it is not in
this repository, not in any build, and must not be added to either.

That distinction is doing real work, not being pedantic: **GPL-3.0 restricts distribution, not
use.** A file the user's own machine fetches from the upstream host, which never enters a build of
this app, is the same arrangement `app/convert.py` has with the grew backend and `app/extras.py`
has with the PyTorch tiers. Bundling it would raise a licence question; fetching it does not.

(SUD-spaCy's own `build_la_macron.sh` produces a DIFFERENT table, harvested by macronising three
CC BY-**NC**-SA treebanks. That one mixes NonCommercial keys with share-alike data and cannot be
redistributed by anyone — upstream says so itself. `app/macron.py` still reads one if the user has
built it, cascading it ahead of Morpheus for the words it covers, but it is never required.)

| Data behind that feature | Origin | Licence |
|---|---|---|
| Morpheus vowel-length data | [PerseusDL/morpheus](https://github.com/PerseusDL/morpheus) | CC BY-SA 3.0 US |
| latin-macronizer (the route to it) | [Alatius/latin-macronizer](https://github.com/Alatius/latin-macronizer) | GPL-3.0 |
| SUD_Latin-ITTB / PROIEL / Perseus (the harvest keys) | Universal Dependencies | CC BY-NC-SA |

## Not vendored, but worth naming

- **grew** — the OCaml backend (`grewpy_backend`) is an optional external prerequisite, built by
  `tools/bundle_grew.sh` or taken from `~/.opam`. `vendor/` is git-ignored, so no grew binary is
  redistributed here.
- **Stanza / spaCy models** — downloaded at runtime into the user's own application-support
  directory, under their own licences.
