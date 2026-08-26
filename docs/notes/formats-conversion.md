# Formats and conversion

`app/detect.py`, `app/convert.py`, `app/grammars.py`, `app/grew_backend.py` — UD/SUD/mSUD detection, the fetched grew grammars, and what DEPS is read for on import.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

Format is **detected** from the relation inventory, per sentence then per document: UD / SUD / mSUD.
SUD and mSUD are editable; UD is import/export only. Conversion runs grew (via `grewpy`) over the
`.grs` grammars — surfacesyntacticud/tools content with no declared licence, so **fetched on demand
onto the user's own machine** (`app/grammars.py`, a `module`-shaped extras tier next to
`app/macron.py`'s identically-motivated Latin-macron fetch — see `THIRD-PARTY-NOTICES.md`'s
"Resolved: `grammars/`") rather than vendored into this repo the way it once was. The direction →
strategy-name table (strategies are *not* uniformly `main`) lives in `app/convert.py`'s
`_GRAMMARS`/`_LANG_GRAMMARS` dicts, the authoritative source now that there is no committed
`grammars/README.md` to check alongside them. There is no universal SUD→mSUD grammar. Every
conversion entry point takes an optional `lang` (the frontend's `DOCLANG`, threaded through
`Api.import_ud`/`export_ud_to`/`convert_format`); `_LANG_GRAMMARS` prefers a language-specific
`.grs` over the universal one when that (language, direction) pair is covered — most
language/direction pairs aren't, and fall back to the universal grammar. **The mSUD directions are
held out of that table on purpose** and always run the universal grammar: the language-specific
mSUD grammars differ from it in how a fused word is SPELLED, not in its syntax (they pass grew an
explicit `"_"`/`" "` separator when concatenating the merged pieces' Translit/Tone/MGloss, so one
fused word came out spelled as several), and the fetched files are verbatim upstream copies a
re-fetch would revert anyway, so the fix lives in the table rather than in them.

grew's OCaml backend is an **optional external prerequisite, fetched on demand**: `app/convert.py`
picks up `~/.opam/*/bin/grewpy_backend` if opam has installed one — never a copy bundled inside the
app itself (`grewpy_backend` is CeCILL v2.1, GPL-family copyleft; bundling it would republish someone
else's work without a grant to, same problem the old vendored `grammars/` had). `app/grew_backend.py`
is the fetch: it drives `opam install grewpy_backend` (bootstrapping `opam init` first if this
machine has no opam root, and adding grew's own opam remote), the same `module`-shaped on-demand
extras tier `app/grammars.py`/`app/macron.py` use, wired into Manage Models as the "grew conversion
backend" row (`app/extras.py`'s `TIERS["grew"]`). It needs `opam` itself already on the machine
(`brew install opam` on macOS) — nothing here installs opam. Without a backend the app still runs
and edits SUD/mSUD — only UD import/export and conversion are disabled, surfaced as a toast. Keep new
features degrading that way rather than hard-failing.

⚠ **The backend is not optional to the STANZA ENGINE, and that is the consequence everyone misses.**
Stanza emits UD and this app stores SUD, so `parse._parse_stanza_ud_to_sud` runs the conversion
grammar on *every* Stanza parse — no backend, no grammar fetched (or both), no Stanza parsing at
all, however cleanly the model downloaded. **No build ships `vendor/` any more** (macOS used to,
copying `app web vendor`; that line is gone from both `make_portable.sh` and
`make_bootstrap_app.sh` now) — every platform's first launch has no grew backend until a reader
installs one, themselves, from Manage Models' "grew conversion backend" row (or the equivalent
`opam install` commands by hand — see README.md). Before this, macOS quietly carried the backend on
the user's behalf and every OTHER platform's user who had not built the app themselves had none and
found every Stanza model inert — reported as "the Stanza models do nothing"; that symptom is now the
same, and diagnosed the same way, on every platform, rather than macOS-only. The **Windows** build
has an extra wrinkle worth remembering: opam is a Unix-first tool with no first-class Windows story,
so a Windows user's own path to a working backend is less well trodden than macOS/Linux's. Manage
Models states the Stanza consequence at the top of that group whenever `conversion_available()`
reports no backend (`js/io/models.js`), so a user is told *before* a 400 MB download rather than by a
silent no-op after it.

**DEPS (enhanced dependencies) is not part of SUD and this app does not support it as a column an
annotator works in.** A save-time auto-fill that used to derive it from FEATS `Shared=Yes`/MISC
`Subject=...` ("Task E", `js/io/bridge.js`) is gone — those two annotations stay exactly where they
were (FEATS, MISC, the diagram's dashed "ghost" edges); they simply no longer get echoed into a
column outside SUD. A UD import runs the reverse direction instead (`app/convert.py`'s
`_deps_to_shared_subject`, called from `to_sud`'s `"UD"` branch): it reads the source file's DEPS for
the two enhanced-syntax constructs (universaldependencies.org/u/overview/enhanced-syntax.html) this
app already models as first-class SUD annotations — §2/§3 conjunct propagation → `Shared=Yes`, §4's
`:xsubj` control/raising extension → `Subject=SubjRaising|ObjRaising|OblRaising` — against the
CONVERTED SUD tree (grew drops DEPS outright; nothing survives conversion to read it off there), then
clears DEPS unconditionally. Everything else in DEPS (gapping/empty-node references, case-marking-
in-deprel, relative-clause `ref`+coreference) has no clean SUD-side representation this app already
draws and is simply dropped with the rest of the column — the deleted encoder refused to *write*
these for the same reasons this refuses to *read* them. `mwt`/`empties` DEPS cells are left exactly
as imported (an empty node exists only in the enhanced graph; blanking it would state nothing at all).

⚠ **UD→SUD PROMOTES a function word over its host, and the shared-PP evidence is filed on the wrong
side of that promotion.** UD writes `1835 -case-> in` / `in 1835 they arrived and enslaved …`; SUD
promotes the adposition (`in -comp:obj-> 1835`). A shared oblique's enhanced arcs are filed on the UD
HOST (the nominal, `1835`) — reading only the SUD dependent's (`in`'s) own DEPS would silently miss
every one of these. `_ud_counterparts` walks the SUD-promoted token's own UD head chain for as long
as it stays inside that token's SUD subtree (recognised structurally, not from a function-word
relation list, so it also follows a chain — `has been eating`: `has → eating` in one hop, since
`eating` sits under `has` in SUD) and reads DEPS off whichever UD token turns out to be the real
host. Verified live: `In 1835 settlers arrived and enslaved the Moriori` gives `In` (not `1835`)
`Shared=Yes`, matching the promoted SUD dependent that actually carries the relation.

⚠ **THE NO-CLOBBER RULE COMPARES VALUES, NOT PRESENCE — because grew's own vendored grammar already
WRITES Shared/Subject from the basic tree alone, guessing, before this pass ever runs.** Testing
merely "is something already there" would protect grew's own guess as if it were the file's word.
`_still_stated(src, dst, key)` asks instead: does the CONVERTED value still equal what the SOURCE
FILE stated for `key`? Only then is it authoritative and left alone. Measured, and not a
hypothetical: `She persuaded him to leave`, hand-annotated `Subject=Instantiated` on `leave` and
`3:obj|5:nsubj:xsubj` (a real enhanced arc naming `him`, not `she`, as the controller) on `him` in
DEPS — `UD_to_SUD.grs`'s `comp-obl_xcomp` rule fires on any marked xcomp and writes `SubjRaising`
**unconditionally**, so the file's own `Instantiated` is already gone by the time this pass sees the
tokens, *whether or not this pass runs at all* (confirmed: `ud_to_sud` alone, no DEPS layer, already
returns `SubjRaising` on `leave`). This pass cannot rescue what grew already overwrote, but it CAN
correct the wrong guess with the file's own enhanced-graph evidence — `SubjRaising` names `she`
(subject-control) where the DEPS arc names `him` (object-control), and `_subj_raise_target`'s crawl
against the converted tree resolves the `comp:obj` type to exactly `him`, giving the corrected
`Subject=ObjRaising`. Net effect: real evidence beats a shallow structural guess, even though neither
this pass nor grew's own conversion can preserve an annotator's value that carried no supporting
DEPS arc at all — that gap is `UD_to_SUD.grs` unconditionally overwriting `Subject`, a pre-existing
vendored-grammar behaviour this pass mitigates when DEPS backs a better answer and cannot fix when it
doesn't.
