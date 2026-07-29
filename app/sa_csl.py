"""Sanskrit CSL notation → token forms, **carrying the character offsets** — the alignment
path for a `# text` that no component form appears in verbatim.

WHY THIS EXISTS. The running-sentence alignment (js/core/document.js) locates each surface
unit inside the sentence's own `# text` by matching the form literally. Sanskrit defeats
that outright: the text is written in **Clay Sanskrit Library** notation, i.e. the sandhied
surface with the coalescences *marked* rather than undone, so ``śaśa-bhṛto`` holds the
tokens ``śaśa`` + ``bhṛtaḥ``, ``vartm" â-punar-janmanām`` holds ``vartmā`` + ``a`` +
``punaḥ`` + ``janmanām``, and ``hor" êty`` holds ``horā`` + ``iti``. Not one of those forms
is a substring of the text.

Nor could the tokeniser rescue it on its own. ``sa_sud_vedic_ufal_csl``'s input front-end
*splits* the sandhi, so it builds its ``Doc`` from a word list and ``doc.text != text`` —
exactly the case ``parse._tokenizer_spans`` refuses, and rightly: ``token.idx`` no longer
indexes the string the caller handed in. The fix is not to trust those offsets but to
**redo the transform with the offsets attached**, which is possible because the CSL
conventions are a deterministic, lexicon-free rewriting (see ``sa_csl_prep.py``'s docstring
upstream): a compound-internal boundary is a hyphen, an external-sandhi boundary is a
space, and a vowel coalescence is marked with ``'``/``"`` on the left element and a
circumflex/macron on the right. So the mapping is derivable, not guessable.

(The re-released wheel now *publishes* its offsets as ``doc._.src_spans``, which
``parse._published_spans`` honours — but that needs the wheel, and this module is what makes
Sanskrit align on an install that has no model at all. The two agree; where they differ it is
that this one is unit-granular and therefore exact at an MWT boundary, where the published
per-token spans have to be reassembled by a diff. See ``parse.token_spans``.)

THE STRUCTURAL FACT THAT MAKES UNIT ALIGNMENT EXACT. Upstream's corpus transform joins the
members of ONE multi-word-token range with hyphens and re-segments every *external*-sandhi
boundary into separate space-joined tokens ("the MWT range is dropped across such a
boundary"). So in CSL notation a maximal hyphen-joined word run **is** one MWT range, and
a space **is** a unit boundary — which is precisely the surface-unit granularity the
caller aligns at. The correspondence is therefore 1-to-1 and positional, not a search.

AND IT IS VERIFIED, NOT ASSUMED. Reversing the sandhi (``_sa_csl_vendor.desandhi_csl``,
upstream's own routine, the very one that built the model's training data) recovers each
element's *token* form, which is then compared against the forms the caller actually has.
That comparison is the proof: ``êty`` → ``iti`` matches token 11 exactly, where the raw
strings share one character. Below ``_MIN_UNIT``/``_MIN_MEAN`` we return nothing at all
rather than decorate a span we cannot stand behind.

Optional-dependency contract, as ``app/toolbox_import.py`` and ``app/apte.py`` keep theirs:
this module is the SINGLE façade over ``app/_sa_csl_vendor.py``. If that file is missing
(a trimmed bundle) every entry point here returns the empty answer and callers fall through
to the next stage — never an exception. Nothing here needs spaCy, a model, or the network;
the transform is pure text manipulation, so Sanskrit aligns on a bare install.
"""
import re
from difflib import SequenceMatcher

try:                                    # the vendored CSL transform — absent in a trimmed bundle
    from . import _sa_csl_vendor as _V
except Exception:                       # noqa: BLE001 — a missing/broken vendor file must degrade
    _V = None

# A literal backslash-n in `# text` is a preserved display line break (js/io/bridge.js restores it
# to a real newline on open, but a document that reached the bridge another way may still carry the
# two characters). Blanked to two spaces — same length, so every offset below still indexes the
# ORIGINAL string — and BEFORE `_PIPE` runs, because `_PIPE`'s lookahead would otherwise read the
# backslash as a word character and rewrite the daṇḍa in `janmanām |\nātm"` as a compound hyphen.
_LIT_NL = "\\n"
# Below these the alignment is not asserted: per-unit, the unit gets no span (a hole the caller
# leaves undecorated); on the mean, the whole sentence is refused outright. Measured over the 88
# units of samples/brihat_jataka.conllu the worst unit scores 0.769 and the worst sentence mean
# 0.981 with component forms (0.769 / 0.954 with only the MWT surface forms), whereas those same
# Sanskrit tokens scored against an English `# text` average 0.090. The gap either side of these
# numbers is wide, which is the point: they are set to catch a text that does not correspond to
# its tokens AT ALL, not to grade the quality of a sandhi reversal.
_MIN_UNIT, _MIN_MEAN = 0.62, 0.80


def available() -> bool:
    """Is the vendored CSL transform present?  False → every entry point returns nothing."""
    return _V is not None


def is_sanskrit(lang: str = "", model_id: str = "") -> bool:
    """Should the CSL path be tried at all?  The document LANGUAGE decides when the caller knows
    it (the frontend always does — langid sets it on open and the user can override it); a
    Sanskrit model id is the fallback cue for a caller that only has that. Deliberately NOT a
    content sniff: an apostrophe-and-hyphen test would fire on French (``l'homme``), and while the
    verification below would then refuse the result, running a Sanskrit sandhi engine over French
    to find that out is not something to do on every unaligned sentence."""
    base = (lang or "").lower().replace("_", "-").split("-")[0]
    if base:
        return base in ("sa", "san")
    return (model_id or "").partition(":")[2].startswith("sa_")


def _segment(text: str):
    """The CSL surface units of ``text`` as ``[[(start, end, raw), …], …]`` — one inner list per
    unit, one entry per element inside it.

    Upstream's ``SanskritInputTokenizer.__call__`` in three steps, kept offset-safe: both pre-passes
    are one-character-for-one-character (``_STRAIGHTEN`` is a ``str.translate``; ``_PIPE``'s
    lookahead is zero-width), so a position in the working copy is the same position in ``text``.
    Upstream's remaining normalisation — Devanagari → IAST and Vedic accent stripping — is NOT
    length-preserving and is therefore applied per element afterwards, where it can only change a
    form, never an offset.

    Grouping is at the ``_SPLIT`` level rather than the whitespace level: a punctuation run is its
    own unit even when it is written tight against the preceding word (``raviḥ||``), while a word
    run keeps its hyphen-separated members together because those members ARE one MWT range."""
    if _V is None:
        return []
    work = text.replace(_LIT_NL, "  ").translate(_V._STRAIGHTEN)
    work = _V._PIPE.sub("-", work)      # CSL compound divider | → hyphen (never the daṇḍa |)
    units = []
    for cm in re.finditer(r"\S+", work):
        base, chunk = cm.start(), cm.group(0)
        for m in _V._SPLIT.finditer(chunk):
            a = base + m.start()
            if m.group(1) is not None:                     # a punctuation run (||, |, , ? …)
                units.append([(a, a + len(m.group(0)), m.group(0))])
            else:                                          # a word run: split internal hyphens
                units.append([(a + h.start(), a + h.end(), h.group(0))
                              for h in _V._HYPH.finditer(m.group(0))])
    return units


def _analyse(text: str):
    """``(groups, forms)`` — the segmentation of ``text`` and, parallel to its FLATTENED elements,
    each element's token form with the sandhi reversed.

    ``desandhi_csl`` needs the WHOLE token sequence in one go (every junction is a two-token affair,
    and the external-sandhi rules read across editorial punctuation), so it is run once over the
    flattened element list; it preserves the token count, which is why the offsets survive it
    untouched."""
    groups = _segment(text)
    if not groups:
        return [], []
    flat = [e for g in groups for e in g]
    forms = _V.desandhi_csl([_V.normalise(e[2]) for e in flat])
    # Drop the compound-join marker, exactly as upstream's tokeniser does, so a member is a clean
    # wordform (śuka- → śuka); a lone dash (the '-' PUNCT, length 1) is a genuine dash, left as is.
    return groups, [w[:-1] if len(w) > 1 and w.endswith("-") else w for w in forms]


def surface_units(text: str):
    """``[(start, end, [component form, …]), …]`` — the CSL surface units of ``text``, each one
    spanning a whole MWT range where the notation spells one, and each carrying the tokens the
    Sanskrit tokeniser would emit inside it.

    This is what ``parse._tokenizer_spans`` hands back for a Sanskrit model: the sandhi-splitting
    tokeniser can now report honest offsets instead of the empty list its ``doc.text != text``
    check (correctly) forces on it."""
    groups, forms = _analyse(text)
    out, k = [], 0
    for g in groups:
        n = len(g)
        out.append((g[0][0], g[-1][1], forms[k:k + n]))
        k += n
    return out


def _score(got: list[str], want: list[str]) -> float:
    """How well the CSL analysis of one unit matches the forms the file has for it, 0…1.

    Element-wise when the two agree on how many components the unit has — the strong case, and
    what the caller's ``parts`` buys: ``â-punar-janmanām`` → ``a``/``punaḥ``/``janmanām`` against
    the file's own three tokens is an exact match, whereas the same unit's MWT *surface* form
    (``apunarjanmanām``, carrying the sandhi) never can be. Otherwise the concatenations are
    compared, which is the best available answer when only the surface form was passed."""
    if got == want:
        return 1.0
    if len(got) == len(want) and len(got) > 1:
        return sum(SequenceMatcher(None, a, b).ratio() for a, b in zip(got, want)) / len(got)
    return SequenceMatcher(None, "".join(got), "".join(want)).ratio()


def align(text: str, forms: list[str], parts: list[list[str]] | None = None) -> list | None:
    """``[[start, end] | None, …]``, one per entry of ``forms``, or ``None`` if the CSL reading of
    ``text`` does not verify against them.

    ``forms[i]`` is the caller's i-th SURFACE unit (a multi-word token's own form, not its
    components); ``parts[i]``, when given, is that unit's component forms, which is what makes the
    verification exact — see ``_score``.

    The correspondence is positional, because in CSL notation a hyphen-joined word run is one MWT
    range and a space is a unit boundary (see the module docstring), so a count match is a strong
    structural signal and every pair is then checked on its own. Where the counts differ the two
    sequences are diffed instead and only the runs they AGREE on are given spans — a partial answer
    with holes, which the caller tolerates, rather than a shifted one, which it cannot detect."""
    if _V is None or not text or not forms:
        return None
    try:
        units = surface_units(text)
    except Exception:                   # noqa: BLE001 — a degenerate string must not raise at the bridge
        return None
    if not units:
        return None
    parts = parts or []
    want = [list(parts[i]) if i < len(parts) and parts[i] else [forms[i]] for i in range(len(forms))]
    spans: list = [None] * len(forms)
    scores: list[float] = []
    if len(units) == len(forms):
        pairs = [(i, i) for i in range(len(units))]
    else:
        # Counts disagree (an edited `# text`, a unit the notation does not spell separately).
        # Fall back to a diff of the two form sequences and keep only the runs that match outright.
        joined = ["".join(u[2]) for u in units]
        sm = SequenceMatcher(None, forms, joined, autojunk=False)
        pairs = [(i1 + k, j1 + k)
                 for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag == "equal"
                 for k in range(i2 - i1)]
        if not pairs:
            return None
    for i, j in pairs:
        sc = _score(units[j][2], want[i])
        scores.append(sc)
        if sc >= _MIN_UNIT:
            spans[i] = [units[j][0], units[j][1]]
    if not scores or sum(scores) / len(scores) < _MIN_MEAN:
        return None                     # the text does not correspond to these tokens — say nothing
    return spans if any(spans) else None
