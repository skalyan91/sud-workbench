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
| `scripts/sa_tokenizer.py` (Sanskrit CSL de-sandhi) | `_sa_csl_vendor.py` | Sunflower AI, **SUD-spaCy** | MIT, Copyright (c) 2026 Sunflower AI |

Each file states its own provenance and the exact edits made in its module docstring — one import
redirected to `collections.abc` in the first, the spaCy class and imports dropped in the second.

The SUD-spaCy repository is not publicly reachable, so its MIT licence is recorded here on the
strength of the vendored header and `CLAUDE.md` rather than verified against a public `LICENSE`
file. It shares an owner with this project, so the vendoring is a convenience rather than a
licensing question — but if this repository is ever published, confirm the terms first.

## Not vendored, but worth naming

- **grew** — the OCaml backend (`grewpy_backend`) is an optional external prerequisite, built by
  `tools/bundle_grew.sh` or taken from `~/.opam`. `vendor/` is git-ignored, so no grew binary is
  redistributed here.
- **Stanza / spaCy models** — downloaded at runtime into the user's own application-support
  directory, under their own licences.
