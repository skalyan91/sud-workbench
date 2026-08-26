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
`en_sud_ewt_gum` (pinned as a hard dependency rather than bundled the way every other model is), and
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

**SF Symbols are Apple's, and are macOS-only on purpose.** Eight masks in `mac-tokens.css`
(`--sf-undo/-redo/-zoomin/-zoomout/-actualsize/-help/-grid/-open`) are real SF Symbols, and the
native shell renders a further handful (the model-manager and titlebar-proxy glyphs) fresh at every
launch via the same API. Neither is committed as artwork any more: `app/mac/sf_symbols.py` renders
the first group to a git-ignored, packaging-time-generated file (`mac-tokens.css` only `@import`s
it), and `app/mac/shell.py`'s `_compute_symbol_icon` renders the second group at runtime on the
user's own machine — both call `NSImage.imageWithSystemSymbolName_accessibilityDescription_`, never
redistribute a rendered copy, and neither leaves a base64 payload in this repository or its history
(the base64 PNGs earlier commits used to bake straight into `mac-tokens.css`, and one that predated
this project's own history entirely, were purged; see `git log` on `web/macos-kit/mac-tokens.css`
for the packaging-time-render migration).

Apple licenses SF Symbols for use in apps **on Apple platforms**; reproducing the artwork inside a
Windows or Linux build is not covered. So `packaging/windows/make_win_app.py` **excludes
`web/macos-kit/` from the Windows payload**, and `packaging/linux/make_deb.sh`/`make_rpm.sh` do the
same for Linux — both fail the build if it survives. The Fluent kit supplies all 41 masks from
MIT-licensed sources for Windows, so nothing is lost there. Linux's `adwaita-kit/` needs the same 41
mask *names* without depending on `macos-kit/` (which it can't reach once that directory is
stripped) — `web/chrome-shared/` is the fix: it carries everything `macos-kit/mac-tokens.css`/
`mac-chrome.css` used to declare directly except the eight real SF Symbols, which it replaces with
Fluent equivalents (same MIT source as `win11-kit/`), and no platform's build strips it. See
`web/chrome-shared/README.md`.
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
| `scripts/aligned_vectors.py` (reader for the aligned vector assets) | `_aligned_vectors_vendor.py` | [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers), beside the `vectors-v0.1.0` release | MIT, Copyright (c) 2026 Sunflower AI |

Each file states its own provenance and the exact edits made in its module docstring — one import
redirected to `collections.abc` in the first, nothing at all in the second (it imports nothing and is
copied verbatim), and the `argparse` CLI dropped off the foot of the third. The third is the reader
for the vector assets in the section below, and it is vendored precisely so that this app cannot
develop a second opinion about how one of them is keyed: three things about an asset (lowercasing,
form-vs-lemma keying, the Latin orthography fold) are recorded in its own `meta` and read back by
that file, never re-derived on this side.

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

## grew conversion backend — FETCHED AT RUNTIME (via opam), never shipped

Nothing about the grew backend is vendored here any more, on any platform this app builds for. The
Python side, `grewpy` (the client `app/convert.py` imports), is CeCILL v2.1 and is an ordinary
`requirements-core.txt` pip dependency — see the "Bundled pip dependencies" table below. What used to
be vendored, and no longer is, is `grewpy_backend`: the compiled **OCaml** process `grewpy` spawns to
actually run a `.grs` rewrite — also CeCILL v2.1, a GPL-family copyleft licence.

`grewpy_backend` has no PyPI wheel and no plain downloadable binary anywhere — opam, OCaml's own
package manager, is the only distribution channel upstream offers (`opam remote add grew
https://opam.grew.fr && opam install grewpy_backend`). `app/grew_backend.py` drives exactly that, on
demand, onto the **end user's own machine** — bootstrapping `opam init` first if this machine has no
opam root yet — wired into Manage Models as the "grew conversion backend" tier (`app/extras.py`), the
same `module`-shaped on-demand extras tier `app/grammars.py`/`app/macron.py` already use for their
own fetched content. `app/convert.py` finds the result under `~/.opam/*/bin`, same as it always could
for a developer's own manual opam install; the only change is that the *app itself* can now drive
that install, rather than requiring one already done by hand.

This used to be genuinely vendored: `tools/bundle_grew.sh` built a self-contained, dylib-rewritten
copy of `grewpy_backend` under a git-ignored `vendor/grew/`, and `packaging/make_portable.sh` /
`packaging/make_bootstrap_app.sh` copied that tree straight into every macOS `.app` they built — at
BUILD time, on the packager's own machine, which is genuine redistribution regardless of `vendor/`
being git-ignored in the *repository*. That script and both copy steps are gone; a shipped `.app`
from either build path now contains no `vendor/` directory and no grew binary at all, matching the
Homebrew tap's own long-standing behaviour (its own install instructions already told a user to
install grew themselves) and what the Windows/Linux builds already did (neither ever had a
`grewpy_backend` of its own to bundle).

**GPL-family copyleft (CeCILL is one) restricts distribution, not use.** A binary opam builds and
installs on the user's own machine, which never enters a build of this app, is the same arrangement
this file already documents for the Latin macron data above and the surfacesyntacticud/tools
grammars — fetching is not redistribution, only shipping a copy would be.

| Component | Origin | Licence |
|---|---|---|
| `grewpy_backend` | [grew.fr](https://grew.fr) / [opam.grew.fr](https://opam.grew.fr) | CeCILL v2.1 |

## Sanskrit lexicon (vidyut) — FETCHED AT RUNTIME, never shipped

The Sanskrit model, `sa_sud_vedic_ufal_dcs` 0.2.0, carries no morphological lexicon of its own. Its
tok2vec embedding layer, `sud.AnalyserFeatsEmbed.v1`, runs in `runtime = true` mode in the shipped
config — meaning it asks **vidyut**'s `kosha` per token for the SET of analyses a form can have,
rather than reading a frozen extract baked into the wheel at training time. So the wheel declares
`vidyut>=0.4.0` (and `indic-transliteration>=2.3.0`) in its `Requires-Dist`, and the lexicon has to
be present on whichever machine actually parses.

Two separate things have to arrive, and only one of them is a package. `vidyut` itself is on PyPI as
prebuilt abi3 wheels (macOS x86_64/arm64, manylinux, musllinux, win32/win_amd64 — so no Rust
toolchain is needed on the user's machine), **MIT**, © 2022 ambuda.org. It is in neither
`requirements-core.txt` nor `requirements.txt`: it installs on demand into the user's own extras
directory, either as the model wheel's own declared requirement (which
`models_registry._unsatisfied_requirements` honours when that model is downloaded) or as the
`vidyut` tier in `app/extras.py`. The linguistic DATA the `kosha` reads is **on PyPI in no form at
all** — upstream publishes it only as a GitHub release asset of ambuda-org/vidyut,
`data-<version>.zip` (v0.4.0: 31,752,769 bytes compressed, ~81 MB unpacked, of which the `kosha/`
subtree is ~78.6 MB — `kosha/padas.fst` 46.3 MB plus `kosha/registry.msgpack` 32.3 MB).
`app/vidyut_data.py` fetches that archive on demand onto the **end user's own machine**, into
`~/Library/Application Support/SUD Workbench/vidyut-data/`, deriving the URL from the installed
`vidyut.__version__` and falling back to upstream's own `vidyut.download_data(path)`.

**Here the reason for fetching rather than shipping is not a licence restriction, and it would be
misleading to read this section as though it were another of the two above.** vidyut is MIT
throughout — no copyleft, no NonCommercial term, no unlicensed content — so this project could
redistribute both the package and the data bundle if it chose to. It does not, for two plainly
practical reasons: upstream does not publish that data as a package at all (a release asset is not a
PyPI artefact, and the wheel deliberately carries none of it), and the bundle is ~81 MB on disk in
service of one language, which is larger than everything else this app ships put together. The
*mechanism* is the same on-demand arrangement this file already documents for the Latin macron data
and the grew backend above, and that `app/grammars.py` and `app/fa_vocab.py` also use — it is only
the reason for reaching for it that differs.

Attribution still runs to the sources vidyut itself built that bundle from, per the READMEs inside
the archive: the `prakriya/` data was sourced from **ashtadhyayi.com**, whose author "graciously
agreed to share these files with us under an MIT license", and `chandas/meters.tsv` came from
Shreevatsa Rajagopalan's **Sanskrit metres** project, itself working from a transcription of the
*Vṛttaratnākara* prepared by Dr Dhaval Patel. This app reads neither of those subtrees — only
`kosha/`, which is vidyut's own build — but both arrive in the same archive on the user's disk, so
both are named here.

| Component | Origin | Licence |
|---|---|---|
| `vidyut` (the pip package) | [ambuda-org/vidyut](https://github.com/ambuda-org/vidyut) / [PyPI](https://pypi.org/project/vidyut/) | MIT (© 2022 ambuda.org) |
| `data-<version>.zip` — the `kosha/` FST + registry this app reads | ambuda-org/vidyut release assets | MIT |
| `prakriya/` data, in that same archive (unused here) | [ashtadhyayi.com](https://ashtadhyayi.com) | MIT, by that author's own grant to vidyut |
| `chandas/meters.tsv`, in that same archive (unused here) | Shreevatsa Rajagopalan's Sanskrit metres, from Dr Dhaval Patel's *Vṛttaratnākara* transcription | MIT, as redistributed by vidyut |

## Cross-lingual alignment vectors — FETCHED AT RUNTIME, never shipped

`app/gloss_align.py` glosses a sentence from its English translation by aligning the two dependency
trees, and from this release it also weighs **what the two words mean**. That evidence comes from
thirteen aligned vector tables — `sud_vec_<lang>_128d.npz`, one per language, all in one shared
128-dimensional space so that a dot product between any two of them is a cosine — published as side
assets of the **`vectors-v0.1.0`** release of
[SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers). `app/vectors.py`
fetches them onto the end user's own machine, into
`~/Library/Application Support/SUD Workbench/vectors/`, beside whichever parser made them useful
(24–32 MB each; the English hub is fetched with every other language, since a table is only useful
held two at a time).

**Here the reason for fetching rather than shipping IS partly a licence restriction**, unlike the
vidyut section above. Eleven of the thirteen derive from **fastText** (Facebook AI Research), **CC
BY-SA 3.0**, redistributed by upstream as CC BY-SA 4.0 under 3.0 §4(b)'s later-version clause — a
ShareAlike term that could not sit inside the CC BY-NC-SA `la`/`ta`/`te` model wheels, which is why
upstream ships them as side assets rather than inside the wheels at all. The practical reason
applies too: thirteen tables is ~340 MB, and no single wheel can use more than its own.

⚠ **Two of the thirteen have unresolved upstream provenance, and this app takes upstream's word for
the status rather than restating it.** `sa` is trained over the Digital Corpus of Sanskrit
(`OliverHellwig/sanskrit`) and `lzh` over the `kanripo/KR*` repositories; **neither carries a LICENSE
file**, and the kanripo text headers carry no rights metadata. Upstream releases those two as
*derived models* rather than as redistributions of the corpora, records the status in each asset's
own `meta`, and says to treat their provenance as unresolved — so this app, which only ever
downloads them onto the user's machine and never redistributes them, says the same.

No dictionary content is redistributed by any asset. Apte (via CDSL), the MUSE bilingual
dictionaries and Wiktionary/kaikki.org were used only to **fit a rotation**; what ships in an asset
is a matrix of floats. Each asset's `meta` carries its own `licence` and `attribution` strings, which
is the authoritative statement for that file.

| Component | Origin | Licence |
|---|---|---|
| `sud_vec_{ar,en,fa,id,ja,ko,la,ta,te,yue,zh}_128d.npz` | fastText word vectors, Facebook AI Research, as rotated and truncated by [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers) `vectors-v0.1.0` | CC BY-SA 3.0, redistributed CC BY-SA 4.0 under 3.0 §4(b) |
| `sud_vec_sa_128d.npz` | floret over the Digital Corpus of Sanskrit's lemmas ([OliverHellwig/sanskrit](https://github.com/OliverHellwig/sanskrit)) | ⚠ upstream corpus declares none — released as a derived model |
| `sud_vec_lzh_128d.npz` | floret over the [kanripo](https://github.com/kanripo) `KR*` corpora | ⚠ upstream corpus declares none — released as a derived model |
| rotation anchors (used to fit, never redistributed) | Apte via [CDSL](https://www.sanskrit-lexicon.uni-koeln.de/), [MUSE](https://github.com/facebookresearch/MUSE) dictionaries, Wiktionary via [kaikki.org](https://kaikki.org) | CC BY-SA (Apte, Wiktionary); the fitted output is a matrix of floats |

## Generic parser (`xx_sud_generic`) — FETCHED AT RUNTIME, never shipped

The pipeline every **custom model** in this app is one embedding row of (`app/generic_models.py`):
a morphologiser that predicts FEATS from UPOS feeding a dependency parser that reads UPOS, decomposed
FEATS and a trainable per-language embedding, trained on **80 SUD 2.18 treebanks** and published as
`xx_sud_generic-0.1.0-py3-none-any.whl` under the **`generic-v0.1.0`** release of
[SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers). The app fetches it
onto the end user's own machine (31 MB), into
`~/Library/Application Support/SUD Workbench/site-packages/`, the first time a custom model is made.

**The reason for fetching rather than shipping is a licence restriction, and it is the whole reason.**
The wheel is **CC BY-NC-SA 4.0**: 24 of its 80 training treebanks are NonCommercial — 276 891 of
880 919 training tokens, 31 % — so the union of the corpus licences carries a NonCommercial term, and
relabelling the wheel does not change what the training data permits. `packaging/make_portable.sh`
pip-installs the model wheels it distributes *straight into the app it ships*, so that term would
attach to the whole bundle. It is exactly the term the bundled English parser was selected to avoid
(see `en_sud_ewt_gum` below: CC BY-SA only because GUM's five NonCommercial genres are excluded from
it upstream). Nothing in `packaging/` references this wheel, and `models_registry.GENERIC_SUD` keeps
it out of every listing that could offer it as an ordinary language model.

What a custom model itself stores is **128 floats per embedding table**, fitted on the user's own
annotated sentences with every other parameter of the wheel frozen. No part of the wheel is copied,
redistributed or modified on disk; nothing leaves the machine.

| Component | Origin | Licence |
|---|---|---|
| `xx_sud_generic` 0.1.0 | [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers) `generic-v0.1.0`, trained over 80 [SUD 2.18](https://surfacesyntacticud.org/data) treebanks | **CC BY-NC-SA 4.0** (union: 24 of the 80 treebanks are NonCommercial) |

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
| `en_sud_ewt_gum` | **CC BY-SA 4.0** | English SUD parser model wheel; `app/wiktionary.py` SUD-parses each Wiktionary definition to condense it into a glossable phrase |
| `wiktra` | **GPL-2.0** | `app/translit.py`'s default Latin-transliteration backend — a Python port of Wiktionary's own Lua translit modules |
| `grewpy` | **CeCILL v2.1** | `app/convert.py`'s UD↔SUD↔mSUD conversion — the Python client that talks to the separately-fetched `grewpy_backend` OCaml binary (see "grew conversion backend" above) |
| `aksharamukha` | **AGPL-3.0** | Sanskrit/Indic-script conversion in `app/translit.py`, `app/apte.py` (Apte dictionary lookup), and `app/itrans.py` (ITRANS input) |

- **`en_sud_ewt_gum`** is a derivative of **SUD_English-EWT** and of **GUM**, the Georgetown
  University Multilayer Corpus — the first a Surface-Syntactic Universal Dependencies treebank itself
  derived from Universal Dependencies English-EWT, the second contributing ten of its genres
  (academic, bio, conversation, court, interview, news, speech, textbook, vlog, voyage). Per
  [SunflowerAI/sud-spacy-parsers](https://github.com/SunflowerAI/sud-spacy-parsers)'s own
  `NOTICE.md`: "The relabelled treebanks committed here (…), the per-language gold sets, and the
  **released model wheels** are derivative works of [SUD] treebanks … distributed under Creative
  Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)." CC BY-SA's own attribution
  requirement runs to the treebanks, not just to Sunflower AI: that same `NOTICE.md` instructs
  readers to "cite the individual UD/SUD treebanks when using these models; their authors are
  credited in each treebank's own `LICENSE.txt`" — here, SUD_English-EWT's — and the wheel's own
  `meta.json` asks the same of GUM: "Georgetown University Multilayer Corpus, Amir Zeldes and 300+
  student annotators, who are listed per document at https://gucorpling.org/gum/ — please cite the
  corpus and that site."
  **The GUM half carries no NonCommercial term, which is why this wheel is bundled at all.** GUM's
  five NonCommercial genres (essay, fiction, letter, podcast, whow) are **excluded** from it
  upstream; the ten it does train on are, per the wheel's own `meta.json`, "annotations CC BY 4.0;
  texts CC BY 4.0 / CC BY-SA 3.0 / CC BY 2.5 / public domain per source". So the merged wheel is
  **CC BY-SA 4.0**, exactly as its `METADATA` and `meta.json` both declare and as the retired
  `en_sud_ewt` was before it — a ShareAlike obligation and an attribution one, and no restriction on
  commercial use. That is what makes it shippable: `packaging/make_portable.sh` pip-installs this
  file straight into the app it distributes, so a NonCommercial term would have attached to the
  whole bundle.
  (It replaced **`en_sud_ewt`** — EWT alone — which this project no longer ships or offers; see
  `app/models_registry.py`'s `RETIRED_SUD`.)
- **`wiktra`** ([twardoch/wiktra2](https://github.com/twardoch/wiktra2), GPL-2.0) is instantiated as
  `wiktra.Transliterator()` and is the general-purpose romanizer for any language/script not routed
  to a dedicated backend (Cyrillic, Greek, Devanagari, and others) — `translit.py`'s
  `_pre_scheme_translit` runs it first and falls back to `uroman` only where wiktra leaves the text
  unchanged.
- **`grewpy`** (the pip package on [PyPI](https://pypi.org/project/grewpy/), CeCILL v2.1) is
  distinct from `grewpy_backend`, the OCaml binary fetched on demand via opam (see "grew conversion
  backend" above) — `grewpy` is an ordinary `requirements-core.txt` entry, imported as a normal
  Python module (`from grewpy import GRS, Graph, set_config`), that talks to that binary to actually
  run the `.grs` UD↔SUD grammars.
- **`aksharamukha`** ([virtualvinodh/aksharamukha-python](https://github.com/virtualvinodh/aksharamukha-python),
  AGPL-3.0) converts between IAST/Sanskrit transliteration and Indic scripts (Devanagari, Grantha,
  Siddhaṃ, and more); `app/apte.py` also uses it to turn a lemma into the SLP1 the Apte dictionary
  index is keyed on. It is explicitly **not** used for the Sanskrit parser's own Devanagari→IAST
  front end — that is `indic-transliteration` (MIT) instead, because upstream found aksharamukha
  renders "।" as "." and that breaks the model's danda-based sentence splitting (see
  `requirements.txt`'s own comment on the two packages).

## Not vendored, but worth naming

- **Stanza / spaCy models** — downloaded at runtime into the user's own application-support
  directory, under their own licences.
- **pykakasi** (GPL-3.0) — kana → Hepburn romaji conversion for the on-demand Japanese extras tier
  (`app/extras.py`'s `"japanese"` tier: `janome`, `pykakasi`, `cutlet`, `fugashi`, `unidic-lite`,
  ~0.45 GB). Never in `requirements-core.txt`; fetched into the user's own extras directory
  (`~/Library/Application Support/SUD Workbench/site-packages`) only when that tier is installed
  from Manage Models, the same shape as the Stanza/spaCy models above.
