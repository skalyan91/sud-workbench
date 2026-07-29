"""Auto-detect the annotation format of a CoNLL-U document: UD, SUD, or mSUD.

Format is *not* stored in the file — it is derived from the annotation content,
so a document can be classified on load without touching the byte-stable I/O path
(:mod:`app.io_conllu`).  The signal is the DEPREL relation inventory (plus, for
mSUD, morph-level ``/m`` relations and the ``TokenType``/``DerPos``/``CpdPos``
morph features).

Public API:
    detect_format(sentences) -> "UD" | "SUD" | "mSUD"
    detect_format_text(text) -> same, parsing ``text`` first
    detect_formats_per_sentence(sentences) -> list[str]   (diagnostics)
"""

from __future__ import annotations

UD = "UD"
SUD = "SUD"
MSUD = "mSUD"

# Base relations that discriminate SUD from UD.  Shared labels (det, dep, conj,
# cc, punct, root, case-less core) are deliberately excluded — they carry no
# signal.  A relation's "base" is its first component after splitting on : @ /.
_SUD_MARKERS = frozenset({"subj", "comp", "mod", "udep", "unk"})
_UD_MARKERS = frozenset({
    "nsubj", "csubj", "obj", "iobj", "obl", "aux", "amod", "advmod",
    "case", "mark", "cop", "nmod", "acl", "advcl", "nummod", "discourse",
})

_MORPH_FEATS = ("TokenType=", "DerPos=", "CpdPos=")


def _base(deprel: str) -> str:
    """First component of a relation, e.g. ``comp:obj/m`` or ``mod@relcl`` -> ``comp`` / ``mod``."""
    d = deprel or ""
    for sep in (":", "@", "/"):
        d = d.split(sep, 1)[0]
    return d


def _is_morph_rel(deprel: str) -> bool:
    """True for a morph-internal relation, marked by the ``/m`` suffix (e.g. ``comp/m``)."""
    return "/m" in (deprel or "")


def _iter_tokens(sent: dict):
    return sent.get("tokens") or []


def _sentence_format(sent: dict) -> str:
    sud = ud = 0
    for tok in _iter_tokens(sent):
        dep = tok.get("deprel") or ""
        if _is_morph_rel(dep):
            return MSUD
        if any(m in (tok.get("feats") or "") or m in (tok.get("misc") or "") for m in _MORPH_FEATS):
            return MSUD
        base = _base(dep)
        if base in _SUD_MARKERS:
            sud += 1
        elif base in _UD_MARKERS:
            ud += 1
    if ud > sud:
        return UD
    return SUD  # tie or empty → the app's native format


def detect_formats_per_sentence(sentences: list[dict]) -> list[str]:
    return [_sentence_format(s) for s in (sentences or [])]


def detect_format(sentences: list[dict]) -> str:
    """Document-level verdict.  mSUD wins if *any* sentence is mSUD (it is a strict
    superset marker); otherwise a majority vote between UD and SUD, defaulting to SUD."""
    per = detect_formats_per_sentence(sentences)
    if not per:
        return SUD
    if MSUD in per:
        return MSUD
    ud = per.count(UD)
    sud = per.count(SUD)
    return UD if ud > sud else SUD


def detect_format_text(text: str) -> str:
    from . import io_conllu
    return detect_format(io_conllu.parse(text))
