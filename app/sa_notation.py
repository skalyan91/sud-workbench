"""Clay Sanskrit Library notation as a DISPLAY layer.

CSL writes a sandhied Sanskrit text with its junctions *marked* rather than merged: where two words
coalesce, the left one gives up its final vowel and takes ``'`` (short) or ``"`` (long), and the
right one opens with the fused vowel written as a circumflex — ``vartmā`` + ``apunar-`` is
``vartm" âpunar-``, ``ātmā`` + ``iti`` is ``ātm" êti``. It is the convention the Clay Sanskrit
Library editions use, and its point is that a reader can see the word boundary the sandhi hid.

**It is a display of the file, never a storage format for it.** The app used to READ CSL — the old
`sa_sud_vedic_ufal_csl` model wrote a `# text` in it — and that cost a whole reversal engine plus a
bespoke alignment stage, because with the junctions marked no token form is a substring of the
running sentence. `sa_sud_vedic_ufal_dcs` stores ordinary sandhied text instead. What is left of CSL
is this: a transliteration-row scheme that shows, per token, how that token would be spelt if the
junctions were marked. Nothing here is written to MISC, to a FORM, or to a file.

WHY A SENTENCE-LEVEL CALL AND NOT AN `_ENGINES` ENTRY. Every other scheme in :mod:`app.translit`
romanises ONE string; this one cannot, because a CSL mark records what happened BETWEEN two words.
``vartmā`` in isolation is ``vartmā``; it is only ``vartm"`` because ``apunar`` follows it. So this
takes a whole sentence and returns one string per token, and `translit._render_one` — which is keyed
on (text, scheme) alone — is deliberately not on the path.

THE INPUT MUST BE PAUSA FORMS, which is why `unsandhied` matters. Under the DCS representation a
token that is its own orthographic word keeps its SANDHIED surface in FORM (``kratuś``) and records
the pausa form in MISC ``Unsandhied=`` (``kratuḥ``); only a token inside a multi-word token is stored
unsandhied. Feeding the sandhied surface back through a sandhi generator would apply the rules
twice. So every token is read as its ``Unsandhied`` value where it has one, and as its FORM where it
does not — which is exactly right for an MWT component, whose FORM already is the pausa form.
"""

from __future__ import annotations

try:                                    # the vendored forward generator — absent in a trimmed bundle
    from . import _sa_sandhi_vendor as _V
except Exception:                       # noqa: BLE001 — a missing/broken vendor file must degrade
    _V = None


def available() -> bool:
    """CSL needs no external package at all — only the vendored generator, which is pure Python."""
    return _V is not None


def _is_word(s: str) -> bool:
    """A token sandhi can apply across. A daṇḍa is a PAUSE (avasāna): the words either side of it
    already stand in their pausa form, so no junction is marked over one."""
    return bool(s) and any(ch.isalnum() for ch in s)


_VOICED = set("gjḍdbṅñṇnmyrlvh")


def _rstem_visarga(word: str, lemma: str, nxt: str) -> str:
    """``punaḥ`` → ``punar`` before a voiced onset, where the LEMMA says the stem is an r-stem.

    The vendored generator resolves ``-aḥ`` before a voiced sound to ``-o`` (``namaḥ`` → ``namo``),
    which is right for an s-stem and wrong for an r-stem: ``punaḥ`` + ``janmanām`` is ``punar-``, not
    ``puno-``, and the two are indistinguishable from the SURFACE — ``punaḥ`` is what both look like
    in pausa. Only the lemma separates them, and `join_pair` is not given one. Rather than fork the
    vendored file over it, the r-form is substituted here BEFORE the junction: a word already ending
    in ``r`` matches none of that function's branches, so it passes through untouched.

    :func:`translit._is_rstem` is the same test `sandhi_join` uses for the same distinction — one
    answer about which stems these are, not two.
    """
    if len(word) < 2 or word[-1] != "ḥ" or word[-2] not in ("a", "ā"):
        return word
    if not nxt or not (nxt[0] in _VOICED or nxt[0] in "aāiīuūṛṝḷeo"):
        return word                    # before a voiceless onset or a pause the visarga simply stays
    try:
        from .translit import _is_rstem
    except Exception:  # noqa: BLE001
        return word
    return (word[:-1] + "r") if _is_rstem(word[:-1], lemma or "") else word


def csl_forms(forms, unsandhied=None, feats=None, mwt=None, lemmas=None) -> list[str]:
    """One sentence's tokens, spelt in CSL. Same length as ``forms``; "" only for an empty input.

    ``lemmas`` (optional, parallel) is read for one thing only — see :func:`_rstem_visarga`.

    ``mwt`` is a list of ``[from, to]`` 1-based inclusive ranges. A junction INSIDE one is a bound
    (compound / preverb / privative) junction, which suppresses the external-only rules — the
    ``-n`` → ``-nn`` gemination in particular, which a bound prefix does not take.

    The walk is sequential and left to right, carrying each word's evolving surface into the next
    junction rather than computing the junctions independently. That is upstream's own order and it
    matters for single-character words: the emphatic particle ``u`` in ``atha u āhuḥ`` comes out
    ``ath' u āhuḥ`` — the ``u`` left uncoalesced — if the junctions are computed apart, and the
    correct ``ath' ô āhuḥ`` if they are chained.
    """
    n = len(forms or [])
    if not n or _V is None:
        return [""] * n
    # pausa in, per the module docstring
    out = [str((unsandhied[i] if unsandhied and i < len(unsandhied) and unsandhied[i] else forms[i]) or "")
           for i in range(n)]
    same = {}                          # token id → the range it belongs to, for the `internal` flag
    for a, b in (mwt or []):
        for t in range(int(a), int(b) + 1):
            same[t] = (a, b)
    for i in range(n - 1):
        if not _is_word(out[i]) or not _is_word(out[i + 1]):
            continue                   # a daṇḍa on either side: a pause, and no junction to mark
        internal = same.get(i + 1) is not None and same.get(i + 1) == same.get(i + 2)
        fl = str((feats[i] if feats and i < len(feats) else "") or "")
        lm = str((lemmas[i] if lemmas and i < len(lemmas) else "") or "")
        out[i] = _rstem_visarga(out[i], lm, out[i + 1])
        try:
            left, right = _V.join_pair(out[i], out[i + 1], fl, internal)
        except Exception:              # noqa: BLE001 — one odd junction must not sink the sentence
            continue
        out[i], out[i + 1] = left, right
    return out


def csl_many(sents) -> list[list[str]]:
    """:func:`csl_forms` over a batch of sentences, each ``{forms, unsandhied, feats, mwt}``."""
    res = []
    for s in (sents or []):
        s = s or {}
        res.append(csl_forms(s.get("forms") or [], s.get("unsandhied"), s.get("feats"),
                             s.get("mwt"), s.get("lemmas")))
    return res
