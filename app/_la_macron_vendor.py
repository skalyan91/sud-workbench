"""VENDORED — Latin vowel-length macronisation, the lookup half of the Alatius macroniser.

Source: ``scripts/la_macronise.py`` from Sunflower AI's **SUD-spaCy**
(github.com/SunflowerAI/sud-spacy-parsers), MIT, Copyright (c) 2026 Sunflower AI, at commit
``6997ed73ce1102eb62536004e065932a866f9604`` (md5 of the original ``5bed82d94d5d3786bd1e72da3da00f3d``).

Copied verbatim MINUS the spaCy pieces — the ``Language.factory``, the ``Token``/``Doc`` extension
registration and the ``__call__(doc)`` pipeline entry — because this app calls :meth:`LaMacronise.resolve`
per token straight from its own CoNLL-U columns and never builds a ``Doc``. That is the same treatment
``_toolbox_vendor.py`` gets, and it keeps ``app/macron.py`` importable with no spaCy installed at all.
Everything the lookup depends on — the backoff tables, the paradigm override, the mask arithmetic —
is upstream's, unchanged, so the two cannot drift on the part that decides a vowel's length.

⚠ **The lookup TABLE is not vendored and is not in this repository.** Its vowel-length data comes from
Morpheus (Perseus Project, CC BY-SA 3.0 US) by way of Johan Winge's latin-macronizer (GPL-3.0), and it
is harvested against SUD_Latin-ITTB / PROIEL / Perseus, all three of which are CC BY-**NC**-SA. Upstream
declines to redistribute it for exactly that reason (``NOTICE.md``, ``scripts/build_la_macron.sh``:
"keep it local, do not redistribute it"), and so do we. :mod:`app.macron` therefore looks the table up
at runtime and reports the scheme unavailable when there is none — the same degrade-don't-fail posture
`app/convert.py` takes toward the grew backend. See ``THIRD-PARTY-NOTICES.md``.

Upstream's own docstring follows.

    ``la_macronise`` -- restore vowel-length macrons to parsed Latin.

    This is the "rule + lexicon" half of the Alatius macroniser, re-hosted on top of THIS pipeline's
    own morphology. Alatius works by tagging with RFTagger and then looking each (form, tag) up in a
    Morpheus-derived lexicon of macronised forms. Our released Latin model already predicts UPOS,
    full FEATS and a lemma, so the tagging half is already done -- and done by a tagger trained on the
    same treebank the lexicon is keyed to, rather than by a separate one that sometimes disagrees with
    it. What remains is the lookup, which is what this component is.

    Backoff, most specific first (see build_la_macron_lut.py for how the table is harvested/pruned):

        L1  (form, upos, feats)  the morphologiser disambiguating genuine homographs
        L2  (form, upos)
        L3  (form)               a bare word list
        S4  (form[-4:], upos, feats)   ending-only, generalises to unseen forms
        S3  (form[-3:], upos, feats)
        --  otherwise the form is left bare (no macrons invented)

    MEASURED (agreement with Alatius on the held-out ITTB+PROIEL+Perseus test split, gold morphology):
    whole-token 94.32 %, per-vowel 97.34 %. The residue is overwhelmingly STEM length on words the
    table has never seen: at the suffix levels the ENDING is 94.3 % right from morphology alone but the
    STEM only 75.4 %, and 39.8 % of those tokens really do carry a stem macron. That split is the whole
    story -- endings are a function of the paradigm, which we predict; stems are lexical, and covering
    them for arbitrary vocabulary needs Morpheus itself, not a treebank-harvested table.

    Two caveats worth stating plainly:
      * these numbers are AGREEMENT WITH ALATIUS, not gold vowel length. Alatius is ~98-99 % on vowels,
        so the ceiling here is its accuracy, not ours.
      * with PREDICTED rather than gold morphology, L1 fires on the morphologiser's output
        (``morph_acc`` ~0.83 on la dev), so real-world accuracy is below the figures above.
"""

import gzip
import json
import unicodedata
from pathlib import Path

LONG = {"a": "ā", "e": "ē", "i": "ī", "o": "ō", "u": "ū", "y": "ȳ"}
LONG.update({k.upper(): v.upper() for k, v in list(LONG.items())})


def strip_macron(s):
    n = unicodedata.normalize("NFD", s)
    return unicodedata.normalize("NFC", "".join(c for c in n if c != "̄"))


# --- paradigm override -------------------------------------------------------------------------
# The lookup table memorises (form, morph) -> pattern pairs and CANNOT express a paradigm rule, so
# an unseen (form, morph) combination falls through to the form-only level, which is
# morphology-blind and can flatly contradict correctly-predicted morphology. That is how nominative
# `Gallia` came out `Galliā`: the treebank only ever attests the ablative, so the form-only
# majority is the ablative pattern, and it overrode a correct Case=Nom.
#
# These cells of the Latin paradigm fix the FINAL vowel's length absolutely, whatever the lexicon
# says. Keyed on (InflClass, Case, Number, final letter) -> is that vowel long.
#
# NB the harvested data DISAGREES with these rules on ~1500 training tokens (IndEurA/Nom/Sing/-a is
# marked long 12.9 % of the time; IndEurA/Abl/Sing/-a is marked long only 89.0 %). That is the
# Alatius macroniser's own RFTagger contradicting the treebank's gold morphology -- the rule is
# right and the data is wrong. Applying it therefore LOWERS measured agreement-with-Alatius while
# raising real accuracy; see scripts/eval_la_macronise.py --paradigm.
#
# Deliberately conservative: only cells that are exceptionless in classical Latin and that hinge on
# a final vowel. Third-declension ablative -e (short for consonant stems, -ī for i-stems) is left
# out precisely because it is NOT determined by InflClass alone.
_PARADIGM = {
    # a-stems (1st declension): nominative/vocative singular -a is short, ablative singular -ā long
    ("IndEurA", "Nom", "Sing", "a"): False,
    ("IndEurA", "Voc", "Sing", "a"): False,
    ("IndEurA", "Abl", "Sing", "a"): True,
    # o-stems (2nd declension): dative and ablative singular -ō are long
    ("IndEurO", "Dat", "Sing", "o"): True,
    ("IndEurO", "Abl", "Sing", "o"): True,
    # e-stems (5th declension): ablative singular -ē is long
    ("IndEurE", "Abl", "Sing", "e"): True,
}


def _feat(feats, key):
    """Read one feature out of a CoNLL-U FEATS string (also what str(token.morph) yields)."""
    for part in str(feats).split("|"):
        if part.startswith(key + "="):
            return part.split("=", 1)[1]
    return ""


# When InflClass is absent -- routinely so for PROPN in ITTB/PROIEL -- the declension is still
# recoverable from the LEMMA's ending, which is how a Latinist reads it: a lemma in -a is an
# a-stem, one in -us/-um an o-stem. Restricted to nominals, and only used as a fallback.
_LEMMA_CLASS = (("a", "IndEurA"), ("us", "IndEurO"), ("um", "IndEurO"))


def _infl_class(feats, lemma, upos):
    ic = _feat(feats, "InflClass")
    if ic or upos not in ("NOUN", "PROPN", "ADJ"):
        return ic
    lem = strip_macron(str(lemma or "")).lower()
    for suf, cls in _LEMMA_CLASS:
        if lem.endswith(suf) and len(lem) > len(suf):
            return cls
    return ""


def paradigm_final(form, feats, lemma=None, upos=None):
    """Return True/False if the paradigm fixes the FINAL vowel's length, else None.

    Returns None whenever the cell is not covered -- including when InflClass is ABSENT, which is
    the common case for PROPN in ITTB/PROIEL. That is why nominative `Gallia` is still not fixed by
    this rule: it carries Case=Nom|Gender=Fem|Number=Sing and no InflClass at all, so there is
    nothing to key on. Inferring the declension from the lemma would be the next step, and is not
    attempted here.
    """
    if not form or form[-1] not in "aeiouyAEIOUY":
        return None
    return _PARADIGM.get((_infl_class(feats, lemma, upos), _feat(feats, "Case"),
                          _feat(feats, "Number"), form[-1].lower()))


def apply_mask(form, mask):
    """Lengthen the vowels whose bit is set, preserving the form's own case."""
    out = []
    for i, ch in enumerate(form):
        out.append(LONG.get(ch, ch) if (mask >> i) & 1 else ch)
    return "".join(out)


class LaMacronise:
    def __init__(self, lut=None, paradigm=True):
        self.paradigm = paradigm
        self.l1 = self.l2 = self.l3 = self.s4 = self.s3 = {}
        # `lut` is a BUILD-time convenience only. In a packaged model the table travels inside the
        # model directory and is restored by from_disk(), which runs after __init__ -- so a config
        # that still names a build-time path (or none at all) must not be fatal here, or the wheel
        # fails to load with FileNotFoundError before from_disk ever gets a chance.
        if lut and Path(lut).exists():
            self._load_blob(json.loads(gzip.open(lut, "rb").read().decode("utf-8")))

    def _load_blob(self, b):
        self.l1 = {(f, u, x): m for f, u, x, m in b["L1"]}
        self.l2 = {(f, u): m for f, u, m in b["L2"]}
        self.l3 = {f: m for f, m in b["L3"]}
        self.s4 = {(f, u, x): m for f, u, x, m in b["S4"]}
        self.s3 = {(f, u, x): m for f, u, x, m in b["S3"]}

    def _lookup(self, form, upos, feats):
        """Return (mask, level) for the lowercased form, or (None, None)."""
        n = len(form)
        m = self.l1.get((form, upos, feats))
        if m is not None:
            return m, "L1"
        m = self.l2.get((form, upos))
        if m is not None:
            return m, "L2"
        m = self.l3.get(form)
        if m is not None:
            return m, "L3"
        for k, tab, lvl in ((4, self.s4, "S4"), (3, self.s3, "S3")):
            m = tab.get((form[-k:], upos, feats))
            if m is not None:
                # the stored mask is indexed from the right; shift it back onto the form
                return sum(1 << (i + n - k) for i in range(k)
                           if (m >> i) & 1 and 0 <= i + n - k < n), lvl
        return None, None

    def resolve(self, form, upos, feats, lemma=None):
        """(macronised form, level) for one token -- the single path used by __call__ AND the
        evaluator, so a measurement can never silently miss the paradigm override."""
        if not any(c.isalpha() for c in form):
            return form, None
        mask, level = self._lookup(strip_macron(form).lower(), upos, feats)
        mask = mask or 0
        if self.paradigm:
            fixed = paradigm_final(form, feats, lemma, upos)
            if fixed is not None:
                bit = 1 << (len(form) - 1)
                new = (mask | bit) if fixed else (mask & ~bit)
                if new != mask:
                    level = f"{level or 'none'}+P"
                mask = new
        base = strip_macron(form)
        return (apply_mask(base, mask) if mask else base), level

    # -- serialisation: the table travels inside the model directory ------------------
    def from_disk(self, path, exclude=tuple()):
        p = Path(path) / "lut.json.gz"
        if p.exists():
            self._load_blob(json.loads(gzip.open(p, "rb").read().decode("utf-8")))
        return self

    def from_bytes(self, data, exclude=tuple()):
        self._load_blob(json.loads(gzip.decompress(data).decode("utf-8")))
        return self
