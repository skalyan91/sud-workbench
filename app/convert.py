"""UD ↔ SUD ↔ mSUD conversion, isolating all use of grew (via the grewpy client).

Every conversion goes through one code path — serialize the sentence-dict list to
CoNLL-U (:func:`app.io_conllu.serialize`), rewrite it with a vendored ``.grs`` graph
grammar under :data:`GRAMMARS_DIR`, then parse the result back
(:func:`app.io_conllu.parse`).  grew's ``to_conll`` renormalises FEATS/MISC, so a
converted document is deliberately *not* byte-stable against its source — conversion
is an explicit transform, not the passthrough that I/O guarantees.

grewpy is imported lazily: importing it eagerly spawns the OCaml ``grewpy_backend``
process, which may be absent.  All entry points raise :class:`ConversionUnavailable`
(grewpy / backend / grammar missing) or :class:`ConversionError` (rewrite failed) so
the caller can degrade gracefully.  Probe :func:`available` up front to disable UI.

Every public conversion also takes an optional ``lang`` (the document's detected/declared
language, e.g. frontend ``DOCLANG``): when a vendored language-specific grammar covers that
(language, direction) pair, it is preferred over the universal one — see :data:`_LANG_GRAMMARS`.
Most languages have no dedicated grammar for most directions, which is expected (the source
project covers only where a generic rewrite isn't good enough); :func:`_convert` falls back to
the universal grammar whenever the pair is absent from the table.
"""

from __future__ import annotations

import glob
import itertools
import os
import shutil
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

from . import io_conllu

GRAMMARS_DIR = Path(__file__).resolve().parent.parent / "grammars"

# grammar file → grew strategy name (see grammars/README.md for provenance)
_GRAMMARS = {
    "ud_to_sud": ("UD_to_SUD.grs", "main"),
    "sud_to_ud": ("SUD_to_UD.grs", "main"),
    "msud_to_sud": ("mSUD_to_SUD.grs", "mSUD_to_SUD_main"),
    "msud_to_ud": ("mSUD_to_UD.grs", "mSUD_to_UD_main"),
}

# (language, direction key) → (grammar file, grew strategy).  Filenames follow
# "{lang}_{Direction}.grs", but the strategy names inside do NOT follow one convention (each
# grammar author picked their own — grammars/README.md's "{lang}_{Direction}_main" rule is only
# true for some of these), so they're enumerated by hand rather than derived, confirmed against
# each file's own `strat` declaration. A (lang, key) absent here means the source project ships
# no dedicated grammar for that pair — not every language covers every direction, and up-conversion
# to mSUD is never covered (see sud_to_msud) — so _convert falls back to the universal grammar.
#
# THE mSUD DIRECTIONS ARE DELIBERATELY NOT LISTED HERE, and the vendored language-specific
# mSUD grammars (arh/bej/gya/pay/yrk/zh, all still on disk) are therefore never loaded: mSUD → SUD
# and mSUD → UD always run the universal grammar, whatever the document's language. The reason is
# that a "/m" fusion is where the language-specific grammars disagree with the universal one about
# the SPELLING of the merged word rather than about its syntax — `zh_`/`gya_` pass grew an explicit
# "_" separator when they concatenate the pieces' Translit and Tone and `pay_` a " " for MGloss, so
# one fused word came out of the converter spelled as several (`Translit=wèn_tí`, `Tone=4_2`) while
# its FORM and LEMMA, which take no separator, came out fused. The universal grammar passes no
# separator (grew's default is the empty string — measured, not assumed), so every field agrees.
# Keep it this way rather than editing the vendored grammars, which are verbatim upstream copies a
# re-vendor would silently revert. The non-mSUD language-specific entries below are untouched.
_LANG_GRAMMARS = {
    ("arh", "sud_to_ud"): ("arh_SUD_to_UD.grs", "arh_SUD_to_UD_main"),
    ("bej", "sud_to_ud"): ("bej_SUD_to_UD.grs", "bej_SUD_to_UD_main"),
    ("br", "ud_to_sud"): ("br_UD_to_SUD.grs", "br_main"),
    ("de", "ud_to_sud"): ("de_UD_to_SUD.grs", "de_main"),
    ("fr", "ud_to_sud"): ("fr_UD_to_SUD.grs", "fr_main"),
    ("fr", "sud_to_ud"): ("fr_SUD_to_UD.grs", "FR_main_UDplus"),
    ("gya", "sud_to_ud"): ("gya_SUD_to_UD.grs", "gya_SUD_to_UD_main"),
    ("ha", "sud_to_ud"): ("ha_SUD_to_UD.grs", "ha_main"),
    ("ht", "sud_to_ud"): ("ht_SUD_to_UD.grs", "ht_SUD_to_UD_main"),
    ("pay", "sud_to_ud"): ("pay_SUD_to_UD.grs", "pay_SUD_to_UD_main"),
    ("pcm", "sud_to_ud"): ("pcm_SUD_to_UD.grs", "pcm_main"),
    ("sab", "sud_to_ud"): ("sab_SUD_to_UD.grs", "sab_SUD_to_UD_main"),
    ("say", "sud_to_ud"): ("say_SUD_to_UD.grs", "say_main"),
    ("wo", "ud_to_sud"): ("wo_UD_to_SUD.grs", "wo_main"),
    ("yrk", "sud_to_ud"): ("yrk_SUD_to_UD.grs", "yrk_SUD_to_UD_main"),
    ("zh", "sud_to_ud"): ("zh_SUD_to_UD.grs", "zh_SUD_to_UD_main"),
}


class ConversionUnavailable(RuntimeError):
    """grewpy, its OCaml backend, or a required grammar file is missing."""


class ConversionError(RuntimeError):
    """The rewrite ran but produced no result for a sentence."""


_GREW = None          # cached (Graph, GRS) after a successful import + set_config
_GRS_CACHE: dict = {}  # grammar filename → loaded GRS


_VENDORED_BACKEND = Path(__file__).resolve().parent.parent / "vendor" / "grew" / "bin" / "grewpy_backend"


def _ensure_backend_on_path() -> None:
    """grewpy spawns the ``grewpy_backend`` binary by name.  Prefer a copy bundled with
    the app under ``vendor/grew/bin`` (see tools/bundle_grew.sh); otherwise fall back to
    the opam install under ``~/.opam/<switch>/bin`` — neither is on the app's PATH by
    default, so prepend whichever we find."""
    if shutil.which("grewpy_backend"):
        return
    if _VENDORED_BACKEND.exists():   # self-contained bundle → no opam needed at runtime
        os.environ["PATH"] = str(_VENDORED_BACKEND.parent) + os.pathsep + os.environ.get("PATH", "")
        return
    for cand in glob.glob(os.path.expanduser("~/.opam/*/bin/grewpy_backend")):
        os.environ["PATH"] = os.path.dirname(cand) + os.pathsep + os.environ.get("PATH", "")
        return


def _ensure_grew():
    """Import grewpy (spawning the backend) and set the SUD config once.  Cached."""
    global _GREW
    if _GREW is not None:
        return _GREW
    _ensure_backend_on_path()
    try:
        from grewpy import GRS, Graph, set_config
    except Exception as exc:  # ImportError, or backend binary not found
        raise ConversionUnavailable(f"grewpy/backend unavailable: {exc}") from exc
    try:
        set_config("sud")   # matches the converter's `-config sud`
    except Exception as exc:  # noqa: BLE001
        raise ConversionUnavailable(f"grew set_config failed: {exc}") from exc
    _GREW = (Graph, GRS)
    return _GREW


def _load_grs(filename: str):
    if filename in _GRS_CACHE:
        return _GRS_CACHE[filename]
    _, GRS = _ensure_grew()
    path = GRAMMARS_DIR / filename
    if not path.exists():
        raise ConversionUnavailable(f"grammar not found: {path}")
    try:
        grs = GRS(str(path))
    except Exception as exc:  # noqa: BLE001
        raise ConversionUnavailable(f"could not load grammar {filename}: {exc}") from exc
    _GRS_CACHE[filename] = grs
    return grs


def _convert_one(block: str, filename: str, strat: str) -> str:
    """Rewrite ONE sentence block under ``strat``. The unit of work both the sequential path
    and each pool worker call — same body either way, so there is exactly one place the actual
    grew rewrite happens."""
    Graph, _ = _ensure_grew()
    grs = _load_grs(filename)
    try:
        graph = Graph(block)
        results = grs.run(graph, strat=strat)
    except Exception as exc:  # noqa: BLE001
        raise ConversionError(f"grew rewrite failed: {exc}") from exc
    if not results:
        raise ConversionError("grew produced no graph for a sentence")
    return results[0].to_conll()


# ── parallel conversion ───────────────────────────────────────────────────────
# grewpy talks to its OCaml backend over a socket to ONE subprocess it spawns on first use
# (grewpy/network.py's module-level `init()`, run at import time) — there is no way to hand a
# second, independent grew session to another THREAD in this same process; every thread would
# share (and serialise through) that one backend connection. A separate PROCESS, on the other
# hand, gets its own fresh Python interpreter and therefore its own `import grewpy` → its own
# `grewpy_backend` subprocess — genuinely independent, no shared state to race on. That is why
# this is a ProcessPoolExecutor and not a ThreadPoolExecutor: converting a 12,000-sentence
# document one grew call at a time (the pre-parallel behaviour) paid for every sentence
# serially even though each is a wholly independent rewrite of one graph.
# Workers are started with the platform default (`spawn` on macOS) rather than `fork` — a forked
# child would inherit the PARENT's already-open backend socket/subprocess handle, which is
# exactly the kind of shared state a second grew session must not have; `spawn` gives each
# worker a clean interpreter that lazily spins up its OWN backend the first time it actually
# converts something, through the same `_ensure_grew`/`_load_grs` caches this module already
# has — no new caching mechanism, just one instance of the existing one per worker.
_POOL: ProcessPoolExecutor | None = None
_POOL_WORKERS = min(os.cpu_count() or 4, 8)   # capped: each worker's OWN grewpy_backend is a whole OCaml process — no reason to spawn more than a handful
_PARALLEL_MIN_BLOCKS = 8   # below this, dispatching to the pool (pickling the block, waiting on a worker, pickling the result back) costs more than just running it here — e.g. a single live re-parse's ud_to_sud([sentence]) call, the commonest caller of this module


def _get_pool() -> ProcessPoolExecutor:
    global _POOL
    if _POOL is None:
        _POOL = ProcessPoolExecutor(max_workers=_POOL_WORKERS)
    return _POOL


def _convert_conllu(conllu_text: str, filename: str, strat: str) -> str:
    """Rewrite each sentence block of ``conllu_text`` under ``strat`` and rejoin."""
    blocks = [b for b in conllu_text.split("\n\n") if b.strip()]
    if len(blocks) < _PARALLEL_MIN_BLOCKS:
        out = [_convert_one(b, filename, strat) for b in blocks]
    else:
        pool = _get_pool()
        # map (not submit-in-a-loop) keeps output order = input order, which the zip in
        # _restore_meta below depends on; a worker's exception surfaces here on iteration,
        # same fail-fast contract the sequential path has (still-running siblings are simply
        # abandoned rather than awaited, since the whole conversion is about to be reported failed)
        out = list(pool.map(_convert_one, blocks,
                            itertools.repeat(filename), itertools.repeat(strat)))
    return "\n\n".join(b.rstrip("\n") for b in out) + "\n"


def _restore_meta(source: list[dict], converted: list[dict]) -> list[dict]:
    """grew keeps ``# sent_id``/``# text`` but may drop other comment lines — re-attach
    them from the source when sentence count and order are preserved (they are: one
    graph in, one graph out)."""
    if len(source) == len(converted):
        for src, dst in zip(source, converted):
            if not dst.get("sid"):
                dst["sid"] = src.get("sid")
            if not dst.get("text"):
                dst["text"] = src.get("text")
            if src.get("comments") and not dst.get("comments"):
                dst["comments"] = list(src["comments"])
    return converted


def _convert(sentences: list[dict], key: str, lang: str | None = None) -> list[dict]:
    filename, strat = (_LANG_GRAMMARS.get((lang, key)) if lang else None) or _GRAMMARS[key]
    text = io_conllu.serialize(sentences)
    converted = io_conllu.parse(_convert_conllu(text, filename, strat))
    return _restore_meta(sentences, converted)


# ── public conversions ───────────────────────────────────────────────────────
def ud_to_sud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "ud_to_sud", lang)


def sud_to_ud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "sud_to_ud", lang)


def msud_to_sud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "msud_to_sud", lang)


def msud_to_ud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "msud_to_ud", lang)


def sud_to_msud(sentences: list[dict]) -> list[dict]:
    """Always unavailable — kept as the guard on this direction, not as a code path.

    mSUD is the richest format; up-conversion to the morph level is not automatic
    (Guillaume et al. 2024) and no universal grammar exists.  Nothing in the UI reaches
    here any more: the Format menu's mSUD entry is *Annotate as mSUD*, a frontend-only
    relabel into morph-annotation mode (``js/io/formats.js``), so the user is never
    offered a conversion that cannot happen.  This stays so that a caller asking for the
    conversion itself gets a clear answer rather than silently wrong output.
    """
    raise ConversionUnavailable("SUD → mSUD is not an automatic conversion")


# ── UD enhanced dependencies (DEPS) → SUD's own Shared / Subject ─────────────
# DEPS is not part of SUD, and this app does not support it as a column an annotator works in:
# the save-time auto-fill that used to WRITE it back out ("Task E", js/io/bridge.js) is gone, and
# the import path below CLEARS it.  Clearing is not the same as discarding, though — two of UD's
# enhanced-syntax constructs (universaldependencies.org/u/overview/enhanced-syntax.html) state
# exactly what two SUD annotations this app already models and already draws (as the dashed
# "ghost" edges), so they are read off DEPS on the way in and re-expressed in SUD's own terms:
#   · §2/§3 CONJUNCT PROPAGATION → FEATS ``Shared=Yes``.  UD gives a dependent shared across a
#     coordination one extra enhanced arc per conjunct; SUD marks the dependent itself and lets
#     conjunctsOf (js/diagram/diagram-render.js) enumerate the coordination.
#   · §4 the ``:xsubj`` extension → MISC ``Subject=SubjRaising|ObjRaising|OblRaising``.  UD gives
#     the raised argument an extra arc back to the controlled predicate; SUD marks the PREDICATE
#     and lets subjRaiseTarget (js/diagram/diagram-edit.js) re-derive which argument is raised.
# Everything else in DEPS goes with the column, which is what "wherever possible" costs — and the
# three big ones are refused for exactly the reasons the deleted encoder refused to WRITE them:
# gapping/empty-node references (this app never INFERS a gap, it only preserves one already in the
# file — see the note on ``empties`` in _deps_to_shared_subject); case-marking-in-deprel
# (``nmod:on``, ``obl:auf:dat``) assumes UD's shape, where the adposition is a DEPENDENT of the
# nominal whose lemma is folded into the label, while SUD has the adposition HEAD the nominal, so
# there is no case dependent to read a lemma off; and relative-clause ``ref``/coreference, which
# SUD marks on the CLAUSE (``mod@relcl``) rather than on the pronoun.
#
# The two ports below are deliberately line-for-line with their JS originals rather than
# "improved": the crawl and the coordination enumeration are what the RENDERER will use to draw
# the ghost edge these annotations imply, so a derivation that disagreed with them by even one
# tie-break would write an annotation the diagram then draws pointing somewhere else.
def _fam_of(rel: str) -> str:
    """base FAMILY of a relation — comp:obj / subj@expl / comp:obj/m → comp / subj / comp.
    famOf (js/core/prefs.js)."""
    rel = rel or ""
    for i, ch in enumerate(rel):
        if ch in ":@/":
            return rel[:i]
    return rel


def _dep_base(rel: str) -> str:
    """a relation without its ``@deep`` tail — comp:obj@agent → comp:obj.  depBase
    (js/diagram/diagram-core.js).  NOT _fam_of: the crawl matches whole relations
    (``comp:obj``), and folding those to ``comp`` would make an object and an oblique the
    same target type."""
    rel = rel or ""
    i = rel.find("@")
    return rel if i < 0 else rel[:i]


def _int(v: Any) -> int:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return 0


def _kv_get(col: str | None, key: str):
    """the value of ``key`` in a ``|``-joined ``Key=Val`` column (FEATS *or* MISC — they share the
    syntax, which is why getFeat, js/core/prefs.js, is used for both), or None if absent.  None and
    "" are different answers here: ``Shared=`` is a statement, an absent Shared is not."""
    if not col or col == "_":
        return None
    for kv in col.split("|"):
        k, sep, val = kv.partition("=")
        if sep and k == key:
            return val
    return None


def _feats_set(col: str | None, name: str, val: str) -> str:
    """add/replace one ``Feat=Val`` in FEATS, keeping it ALPHABETICAL by feature name — the
    CoNLL-U spec's own requirement, and what setFeat (js/io/bridge.js) does on the other side of
    the bridge.  Case-insensitive on the key, as the spec's ordering is."""
    cur = [p for p in (col or "").split("|") if p and p != "_"]
    for i, p in enumerate(cur):
        if p.partition("=")[0] == name:
            cur[i] = f"{name}={val}"
            break
    else:
        cur.append(f"{name}={val}")
    cur.sort(key=lambda s: s.partition("=")[0].lower())
    return "|".join(cur) or "_"


def _misc_set(col: str | None, key: str, val: str) -> str:
    """add/replace one ``Key=Val`` in MISC, IN PLACE if the key is already there and appended
    otherwise — setMiscKV (js/lang/translit-load.js).  Deliberately unsorted, unlike FEATS: MISC
    has no ordering requirement, and re-sorting an imported token's MISC would rewrite lines this
    pass has nothing to say about."""
    cur = [p for p in (col or "").split("|") if p and p != "_"]
    for i, p in enumerate(cur):
        if p.partition("=")[0] == key:
            cur[i] = f"{key}={val}"
            break
    else:
        cur.append(f"{key}={val}")
    return "|".join(cur) or "_"


def _deps_pairs(raw: str | None, n: int) -> list[tuple[int, str]]:
    """a DEPS cell (``3:conj|5:nsubj:xsubj``) as (head id, relation) pairs.

    Anything whose head is not a plain token id in ``[1, n]`` is dropped, which is the one place
    empty nodes are excluded: a gapping reference reads ``5.1:nsubj`` and ``"5.1".isdigit()`` is
    False.  ``0:root`` goes the same way — the enhanced graph's root pointer is not an arc between
    two tokens and neither construct here has anything to say about it."""
    out: list[tuple[int, str]] = []
    if not raw or raw == "_":
        return out
    for entry in raw.split("|"):
        head, sep, rel = entry.partition(":")
        if not sep or not head.isdigit():
            continue
        hid = int(head)
        if 1 <= hid <= n:
            out.append((hid, rel))
    return out


def _conjuncts_of(tokens: list[dict], x: int) -> list[int]:
    """every conjunct (1-based id) in the SAME coordination as ``x``, x included.  conjunctsOf
    (js/diagram/diagram-render.js), ported verbatim — it is what the renderer will enumerate when
    it draws the ghost edges a ``Shared=Yes`` written here implies."""
    if not (1 <= x <= len(tokens)):
        return [x]
    tk = tokens[x - 1]
    h = _int(tk.get("head")) if _fam_of(tk.get("deprel") or "") == "conj" else x
    if not (1 <= h <= len(tokens)):
        return [x]
    found = {h, x}
    for i, tt in enumerate(tokens):
        if _fam_of(tt.get("deprel") or "") == "conj" and _int(tt.get("head")) == h:
            found.add(i + 1)
    return sorted(found)


def _subj_raise_target(tokens: list[dict], tok_id: int, target_type: str):
    """the raised argument of the predicate ``tok_id``, for one raising type.  subjRaiseTarget
    (js/diagram/diagram-edit.js), ported verbatim including its crossing budget: climb tok_id's own
    head chain, stop at the first VERB/AUX ancestor and look among THAT ancestor's dependents for
    one whose base relation is ``target_type``; at most one further VERB/AUX may be crossed without
    a match, and crossing an AUX ends the crawl outright.  1-based id, or None."""
    n = len(tokens)
    cur, crossed, guard = tok_id, 0, 0
    while guard <= n:
        guard += 1
        if not (1 <= cur <= n):
            return None
        hid = _int(tokens[cur - 1].get("head"))
        if not (1 <= hid <= n):
            return None
        anc = tokens[hid - 1]
        is_aux = anc.get("upos") == "AUX"
        if is_aux or anc.get("upos") == "VERB":
            for i, d in enumerate(tokens):
                if i + 1 != tok_id and _int(d.get("head")) == hid \
                        and _dep_base(d.get("deprel") or "") == target_type:
                    return i + 1
            if crossed >= 1:
                return None      # the one permitted crossing without a match is already spent
            if is_aux:
                return None      # crossing an AUX at all ends the crawl, even on the first one
            crossed += 1
        cur = hid
    return None


_SUBJ_VALUE_OF = {"subj": "SubjRaising", "comp:obj": "ObjRaising", "comp:obl": "OblRaising"}


def _still_stated(src_col: str | None, dst_col: str | None, key: str) -> bool:
    """Does the converted token still carry the value the SOURCE FILE stated for ``key``?

    This is the whole no-clobber rule, and it is deliberately not the simpler "is anything there".
    What must never be overwritten is an ANNOTATOR's statement; what may be is a value the
    conversion grammar minted in this same call from the basic tree alone.  The two are told apart
    by comparing the columns, and the third case is why the comparison has to be a comparison:
    ``UD_to_SUD.grs``'s ``del_feat_subject2`` assigns ``V.Subject`` unconditionally, so a file that
    already said ``Subject=Instantiated`` on a controlled predicate comes out of grew saying
    ``SubjRaising``.  Treating "the file said something" as a veto there would protect grew's
    replacement rather than the annotator's value — which is already gone — and would keep a
    better-evidenced answer out.  Verified on exactly that input."""
    stated = _kv_get(src_col, key)
    return stated is not None and _kv_get(dst_col, key) == stated


def _is_descendant(tokens: list[dict], u: int, x: int) -> bool:
    """is ``u`` inside ``x``'s subtree (x itself counts as its own ancestor's side: u == x → True)?"""
    cur, guard = u, 0
    while 1 <= cur <= len(tokens) and guard <= len(tokens):
        if cur == x:
            return True
        cur = _int(tokens[cur - 1].get("head"))
        guard += 1
    return False


def _ud_counterparts(s_toks: list[dict], d_toks: list[dict], x: int) -> list[int]:
    """``x`` plus every UD token whose attachment the SUD edge ABOVE x now carries.

    UD→SUD PROMOTES a function word over its host — UD writes ``1835 -case-> in``, SUD writes
    ``in -comp:obj-> 1835`` — so for a shared PP the enhanced arcs that state the sharing are filed
    on the HOST in UD (``in 1835 they arrived and enslaved …`` puts ``2:obl|4:obl`` on *1835*) while
    the shared dependent in SUD is the PROMOTED word (*in*).  Reading only x's own DEPS would miss
    every one of those, which is not a rare shape.

    The promotion is recognised structurally rather than by a list of function-word relations: walk
    x's own UD head links for as long as they stay INSIDE x's SUD subtree.  A head that is still
    below x in SUD is one x was promoted over; the first head that is *not* is x's own genuine head,
    and the walk stops there.  This also follows a CHAIN (``has been eating``: has → eating in one
    step, since eating is under has in SUD)."""
    out, cur, n = [x], x, len(d_toks)
    for _ in range(n):
        u = _int(s_toks[cur - 1].get("head"))
        if not (1 <= u <= n) or u in out or not _is_descendant(d_toks, u, x):
            break
        out.append(u)
        cur = u
    return out


def _derive_one(src: dict, dst: dict) -> None:
    """Read one sentence's UD DEPS into the converted sentence's FEATS/MISC.  Mutates ``dst``."""
    s_toks, d_toks = src.get("tokens") or [], dst.get("tokens") or []
    n = len(d_toks)
    # A grew rewrite reattaches and relabels but never inserts or deletes a token, so token i of the
    # converted sentence IS token i of the source and a DEPS id means the same thing on both sides
    # (verified form-by-form on a real conversion).  It is still CHECKED rather than assumed: a
    # grammar that did move tokens would silently make every id below point at the wrong word, and
    # an annotation on the wrong word is worse than no annotation.  DEPS is cleared either way.
    if n != len(s_toks) or any((a.get("form") or "") != (b.get("form") or "")
                               for a, b in zip(s_toks, d_toks)):
        return

    # ── §2/§3 conjunct propagation → FEATS Shared=Yes ─────────────────────────
    for i, x in enumerate(d_toks):
        h = _int(x.get("head"))
        if not (1 <= h <= n):
            continue
        partners = set(_conjuncts_of(d_toks, h)) - {h}
        if not partners:
            continue          # x's head is in no coordination → nothing could be propagated to it
        # An extra arc to a conjunct-partner of x's own head IS the propagation.  The enhanced
        # relation's LABEL is not required to match the basic one: UD subtypes the propagated arc
        # freely (``obl:in`` beside ``obl``) and SUD has relabelled the basic edge anyway, so a
        # label test would reject the very entries this is looking for.
        if not any(hid in partners
                   for u in _ud_counterparts(s_toks, d_toks, i + 1)
                   for hid, _rel in _deps_pairs(s_toks[u - 1].get("deps"), n)):
            continue
        if _still_stated(s_toks[i].get("feats"), x.get("feats"), "Shared"):
            continue          # the FILE states a value (either way) and it survived → authoritative
        if _kv_get(x.get("feats"), "Shared") == "Yes":
            continue
        # Anything else here was minted by the grammar seconds ago, from the basic tree alone —
        # UD_to_SUD.grs's `shared_left_conj-dep` package guesses Shared from word order and word
        # class (its `gen` rule marks an ADP/SCONJ mod and skips every other one), and its
        # `unshared_left_conj-dep` package writes Shared=No.  The enhanced graph is the treebank's
        # own statement about the same question, so it wins over a guess made in this same call.
        x["feats"] = _feats_set(x.get("feats"), "Shared", "Yes")

    # ── §4 the `:xsubj` extension → MISC Subject ──────────────────────────────
    decided: set[int] = set()   # a predicate is answered once: two arcs naming it would otherwise fight
    for i, _a in enumerate(d_toks):
        for p, rel in _deps_pairs(s_toks[i].get("deps"), n):
            if not rel.endswith(":xsubj") or p == i + 1 or p in decided:
                continue
            # The base relation is spelled in UD's vocabulary (`nsubj:xsubj`), which says nothing
            # about which SUD slot the controller fills, so the TYPE is not read off the label —
            # it is whichever of the three crawls actually reaches this argument in the SUD tree.
            pred = d_toks[p - 1]
            if pred.get("upos") not in ("VERB", "AUX"):
                continue      # Subject only ever lives on a VERB/AUX (clearSubjIfNotVA, js/io/bridge.js) — writing it elsewhere writes a value the app's own next UPOS edit deletes
            hits = [ty for ty in ("subj", "comp:obj", "comp:obl")
                    if _subj_raise_target(d_toks, p, ty) == i + 1]
            if not hits:
                continue      # the crawl cannot reach this argument → not a structure SUD can state; leave it un-derived rather than invent one
            # More than one type reaching the SAME argument shouldn't happen in a well-formed tree
            # (subjRaiseTargetFor's own comment says so), and when it does the evidence does not
            # single out a slot — so record the raising WITHOUT claiming one.  `Instantiated` is the
            # value that exists for exactly this (UNTYPED_RAISING, js/diagram/diagram-edit.js), and
            # the ghost edge still lands on this argument: subjRaiseTargetFor tries the three types
            # in the same order and takes the first that resolves, which is hits[0].
            value = _SUBJ_VALUE_OF[hits[0]] if len(hits) == 1 else "Instantiated"
            decided.add(p)
            if _still_stated(s_toks[p - 1].get("misc"), pred.get("misc"), "Subject"):
                continue      # the FILE states one and it survived the rewrite → authoritative
            cur = _kv_get(pred.get("misc"), "Subject")
            if cur == value or (cur is not None and value == "Instantiated"):
                continue      # never trade a typed value for the untyped one — Instantiated says strictly less
            # Same rule as Shared: a value the grammar minted in this call is a guess from the basic
            # tree and the enhanced graph outranks it.  This is not a hypothetical — UD_to_SUD.grs's
            # `comp-obl_xcomp` fires on any marked xcomp and writes SubjRaising unconditionally (the
            # ObjRaising rule beside it is guarded `without{D -[mark]-> *}`), so *She persuaded him
            # to leave* comes out of the grammar as SubjRaising, i.e. controlled by *She*.  The
            # `3:obj|5:nsubj:xsubj` on *him* says otherwise, and says it as the treebank.
            pred["misc"] = _misc_set(pred.get("misc"), "Subject", value)


def _deps_to_shared_subject(source: list[dict], converted: list[dict]) -> list[dict]:
    """Re-express what UD's DEPS says in SUD's own terms, then clear the column.  Mutates and
    returns ``converted``.

    Takes BOTH documents because neither alone can answer: the enhanced arcs are in the source's
    DEPS (grew drops the column outright — measured, every converted token comes back ``_``), while
    the heads and relations the two constructs are read against are the CONVERTED, SUD ones.

    Clearing is unconditional and separate from the derivation: DEPS is gone from the app's working
    model after a UD import, not "gone only where something could be translated".  ``mwt`` ranges
    and ``empties`` are left exactly as they came in — an MWT line's DEPS is ``_`` by the format's
    own rule, and an empty node exists ONLY in the enhanced graph, so blanking its DEPS would leave
    a line stating nothing at all.  An imported gap is preserved verbatim, as it always has been."""
    if len(source) == len(converted):     # _restore_meta's guarantee — one graph in, one graph out
        for src, dst in zip(source, converted):
            _derive_one(src, dst)
    for sent in converted:
        for tok in sent.get("tokens") or []:
            tok["deps"] = "_"
    return converted


def to_sud(sentences: list[dict], src_format: str, lang: str | None = None) -> list[dict]:
    """Bring an imported document into the app's native SUD, from its detected format."""
    if src_format == "UD":
        # The DEPS column is read for the two things SUD can state itself and then cleared — see
        # _deps_to_shared_subject.  This lives at the IMPORT entry point rather than inside
        # ud_to_sud because it is about a FILE's enhanced graph: every other ud_to_sud caller is a
        # parse path (parse.py's Stanza routes), and those build their tokens with parse._tok,
        # whose ``deps`` is hard-coded ``"_"`` — nothing there to read, and nothing to clear.
        return _deps_to_shared_subject(sentences, ud_to_sud(sentences, lang))
    if src_format == "mSUD":
        return msud_to_sud(sentences, lang)
    return sentences  # already SUD


def to_ud(sentences: list[dict], src_format: str, lang: str | None = None) -> list[dict]:
    """Export path: convert a live SUD/mSUD document to UD."""
    if src_format == "mSUD":
        return msud_to_ud(sentences, lang)
    if src_format == "UD":
        return sentences
    return sud_to_ud(sentences, lang)


def available() -> dict:
    """Probe for the UI: is grewpy + backend importable, and which grammars are present.
    Never raises."""
    grammars = {k: (GRAMMARS_DIR / v[0]).exists() for k, v in _GRAMMARS.items()}
    info = {"grewpy": False, "backend": False, "grammars": grammars}
    _ensure_backend_on_path()
    try:
        import grewpy  # noqa: F401
        info["grewpy"] = True
    except ImportError:
        return info
    except Exception:  # noqa: BLE001 — imported but backend spawn failed
        info["grewpy"] = True
        return info
    try:
        _ensure_grew()
        info["backend"] = True
    except ConversionUnavailable:
        pass
    return info
