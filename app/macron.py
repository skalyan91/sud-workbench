"""Latin vowel-length macronisation — ``divisa`` → ``dīvīsa``, ``partes`` → ``partēs``.

Restoring vowel length is a *display* question, not an annotation one: the treebanks spell Latin
without macrons, a macron is never part of the FORM as written, and a file must round-trip
byte-identically. So this feeds the **Script** layer (`translit._SCRIPT_SCHEMES["la"]`, scheme id
``macron``) exactly as the Indic scripts do for Sanskrit — the running sentence and the diagram
glyphs re-render, while the grid, the input fields and the file itself keep the bare form. Nothing
here is ever written to MISC.

WHERE THE VOWEL LENGTHS COME FROM, and why they are FETCHED rather than shipped
------------------------------------------------------------------------------
The data is **Morpheus**'s (Perseus Project, CC BY-SA 3.0 US), reached through the copy Johan Winge
commits in **latin-macronizer** (GPL-3.0) as ``latin_macronizer/macrons.txt``: 33 MB of
``wordform ⇥ tag ⇥ lemma ⇥ accented``, about 4 MB on the wire, fetched on demand into
``paths.APP_DATA`` and compiled to a compact table there.

Downloading is not redistributing, and that distinction is the whole design. GPL-3.0 restricts
DISTRIBUTION, not USE: a file the user's own machine fetches from the upstream host, and that never
enters a build of this app, is the same arrangement `app/convert.py` has with the grew backend and
`app/extras.py` has with the torch tiers. Bundling it would be a licensing question; fetching it is
not one.

⚠ **Do not "simplify" this by committing the built table.** It has been the standing temptation and
it is the one thing that turns a use into a distribution.

WHY NOT THE TREEBANK-HARVESTED TABLE
------------------------------------
SUD-spaCy builds its own lookup by macronising the Latin treebank and harvesting (form, upos, feats)
→ pattern pairs from the result, and `app/_la_macron_vendor.py` is the reader for it. That table is
still supported (see `_LEGACY_NAME` below) but is no longer what this asks for, on three counts,
each measured rather than assumed:

* **Vocabulary.** Morpheus has 249,659 distinct wordforms; the harvested table has 42,817 entries.
  Upstream's own error analysis says the binding constraint is vocabulary and not morphology — the
  out-of-vocabulary levels are 71 % of all errors from 8 % of tokens, and perfect morphology would
  buy +0.23 — so a 5.8× larger lexicon attacks the thing that is actually wrong.
* **Licence.** The harvest is keyed against SUD_Latin-ITTB / PROIEL / Perseus, all CC BY-NC-SA, so
  the table mixes NonCommercial keys with share-alike data and cannot be distributed by anyone.
  ``macrons.txt`` contains no treebank at all.
* **Second-handedness.** The harvest reads Alatius's RFTagger's opinion of the treebank rather than
  Morpheus itself, which is why `_la_macron_vendor._PARADIGM` exists at all: its comment records
  that the harvested data is WRONG on the a-stem and o-stem cells (nominative singular ``-a`` marked
  long 12.9 % of the time) because a tagger disagreed with the gold morphology. Reading Morpheus
  direct removes the intermediary. The paradigm override is kept anyway — it is a statement about
  Latin, not a patch for a bad harvest.

Building also drops the whole offline apparatus the harvest needs: Docker, a compiled Morpheus, and
RFTagger (itself non-commercial-only).

THE PARADIGM RULES THIS MODULE ADDS ON TOP
------------------------------------------
A lookup memorises (form, morphology) pairs and cannot express a rule, so any cell it has never seen
falls through to something morphology-blind.  `_la_macron_vendor._PARADIGM` covers three such cells
(a-stem nominative/vocative/ablative singular, o-stem dative/ablative singular, e-stem ablative
singular) and is upstream's, kept verbatim; :data:`_EXTRA` below is this app's own extension and
lives here rather than in the vendored file precisely because a re-vendor would revert an edit made
there — the same arrangement `translit._POS_OVERRIDE` has with the Baxter–Sagart TSV.

⚠ **Every rule below was MEASURED against ``macrons.txt`` itself** (724,191 usable rows) before being
written, and the figure is quoted beside each rule — that is what makes "this is a statement about
Latin" checkable rather than asserted.

**THE RULES COME IN TWO TIERS, and `oov` separates them** (see :func:`_extra_fixes`):

* ``fix()`` — a cell measured **exceptionless** (100.00 %). Applied always, because a paradigm cell is
  a fact the lexicon may never have been shown, and contradicting its morphology-blind fallback is the
  whole point (nominative ``Gallia`` against ablative ``Galliā``).
* ``dflt()`` — a cell with any measured residue at all. Applied **only where the lookup had no entry
  for this very word**. The residue words are almost by definition ones the lexicon KNOWS —
  ``senectūs``, ``virtūs``, ``bene``, ``ante``, ``occepso``, the Greek ``-ēm`` accusatives — so gating
  on ignorance puts them out of reach while losing nothing.

That split was forced by the nominative ``-us`` rule, which is 99.89 % and, applied unconditionally,
shortened ``senectūs``/``virtūs``/``servitūs`` — the third-declension ``-tūs`` abstracts. **Gender does
not separate those**, measured: feminine ``-tus`` nominatives are only 14.3 % long, the rest being
Greek feminine names. Ignorance does.

**A CELL THAT FAILS THE BAR IS USUALLY UNDER-SPECIFIED, NOT UNSTATABLE**, and the conditioner it wants
is most often the SPELLING or the LEMMA — neither of which UPOS+FEATS carries:

===========================  ========  ==========================================  ========
cell                          whole    once conditioned on                          then
===========================  ========  ==========================================  ========
2sg future passive ``-ēre``    91.6 %  not spelt ``-bere`` (the 1st/2nd b-future)   100.00 %
2sg imperative                 30.0 %  ending ``-ā``/``-ī`` (1st/4th conjugation)   100.00 %
  …and its remaining ``-e``    25.0 %  ``lemma == form + "o"`` (2nd conjugation)     99.56 %
accusative plural ``-ās``      98.6 %  an a-stem lemma                              100.00 %
vocative singular ``-e``       90.9 %  an o-stem lemma                               99.98 %
nominative singular ``-us``    99.68 % excluding monosyllables                       99.89 %
positive adverb ``-ē``         96.4 %  the ADJECTIVE existing in the lexicon         99.64 %
===========================  ========  ==========================================  ========

That last one is worth its own line. The contrast is DERIVATIONAL — ``longē`` is long because it comes
from ``longus``, and the ~105 short adverbs come from nothing — so the rule has to know the adjective.
An earlier attempt keyed it on the LEMMA being the adjective, which is Morpheus's convention and **not
UD's**: UD lemmatises an adverb to itself, so that gate could never fire on this app's own parses and
the rule was dead code wearing a measurement. It now asks the loaded table whether ``stem + "us"`` is a
form — one set membership test, true whatever the lemma says.

What is still OUT, with its figure, so it is not re-proposed:

* **fifth-declension ablative ``-ē``** (35.6 % on a lemma-in-``-es`` proxy, which also catches every
  third-declension ``-ēs`` nominative). Already the vendored ``_PARADIGM``'s, keyed on ``InflClass``.
* **"an enclitic ``-que``/``-ne``/``-ve`` is short"** — 95.2 % / 82.5 % / 70.6 %, sunk by ``aequē``,
  ``antīquē``, ``plēnē``, ``suāve``, which merely END in those letters.
* **a final vowel before ``-r``/``-l``/``-d``** (99.89 % / 91.8 % / 83.3 % — ``pār``, ``compār``,
  ``aer``, then the Hebrew names). Re-tried under the ``dflt`` gate on the reasoning that the whole
  residue is in-vocabulary: it changed **0 words either way**. The suffix table already answers those
  endings, so there is nothing to win.

WHAT THE RESIDUE ACTUALLY IS, and why more rules will not move it far
--------------------------------------------------------------------
Bucketed over the held-out out-of-vocabulary split, by the position of each wrong vowel:

    stem   12,428 of 31,277   ·   penult   269 of 6,972   ·   final   173 of 3,883

**96.6 % of the remaining wrong vowels are STEM vowels, and 98 % of all errors are "too short"** — we
fail to restore a macron rather than invent one (``scrīpulāris``, ``volāticum``, ``verbēnae``,
``dēscīverim``). Stem length is LEXICAL: no morphological rule can supply it, which is exactly what
`_la_macron_vendor`'s own note says — "endings are a function of the paradigm, which we predict; stems
are lexical, and covering them for arbitrary vocabulary needs Morpheus itself". The endings, which are
this table's business, are now 95.5 % right at the final vowel and 96.1 % at the penult.

Don't re-add a rejected rule without re-running the measurement; the script is a dozen lines over
`build_table`'s own row filter.

HOW THE MORPHOLOGY IS MATCHED
-----------------------------
``macrons.txt`` keys morphology as the Perseus/LDT **nine-position tag** (``n-s---mn-``); this app's
parser emits UPOS + UD FEATS. :func:`_ud_key` and :func:`_ldt_key` render both into the SAME
nine-slot string, so the two can meet. Lookup then walks a LADDER of progressively blanker keys
rather than demanding one exact match, and that is deliberate: the tagger is imperfect (measured on
a sample: ``virumque`` came back ADV, ``cano`` ADJ, ``fortes`` VERB), and a single exact key turns
every mis-tag into a total miss instead of a coarser hit. Each rung is precomputed at BUILD time,
and only where the analyses agreeing on that rung also agree on the vowel lengths — so a rung never
answers a question it cannot settle.
"""

from __future__ import annotations

import gzip
import json
import os
import unicodedata

from . import paths

MORPHEUS_URL = ("https://raw.githubusercontent.com/Alatius/latin-macronizer/"
                "master/latin_macronizer/macrons.txt")
MORPHEUS_CREDIT = ("Vowel lengths from Morpheus (Perseus Project, CC BY-SA 3.0 US) via "
                   "latin-macronizer by Johan Winge (GPL-3.0). Fetched, not redistributed.")
_TABLE_NAME = "la_macron_morpheus.json.gz"   # what `install()` builds, in APP_DATA
_LEGACY_NAME = "la_macron_lut.json.gz"       # a SUD-spaCy-harvested LUT, if the user has one
_FORMAT = 2                                  # bump when the built table's shape changes

_APP_DATA_TABLE = os.path.join(paths.APP_DATA, _TABLE_NAME)
_BUNDLED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

_CACHE: dict = {}    # path → loaded table (or a LaMacronise), so the load happens once


# ── the nine-slot morphology key ────────────────────────────────────────────────────────────────
# Slot order is the LDT tag's own: pos, person, number, tense, mood, voice, gender, case, degree.
# "-" means "not stated", which is what every rung below the first is made of. Single letters, and
# the LDT's own letters wherever the two schemes agree, so `_ldt_key` is mostly a pass-through and
# there is one alphabet to read rather than two.
_LDT_POS = {"n": "N", "v": "V", "t": "V", "a": "A", "d": "D", "p": "P",
            "m": "M", "c": "C", "r": "R", "i": "I", "e": "I", "g": "G", "u": "U"}
_UD_POS = {"NOUN": "N", "PROPN": "N", "VERB": "V", "AUX": "V", "ADJ": "A", "DET": "A",
           "ADV": "D", "PRON": "P", "NUM": "M", "CCONJ": "C", "SCONJ": "C", "ADP": "R",
           "INTJ": "I", "PART": "G", "PUNCT": "U"}
_UD_CASE = {"Nom": "n", "Gen": "g", "Dat": "d", "Acc": "a", "Abl": "b", "Voc": "v", "Loc": "l"}
_UD_NUM = {"Sing": "s", "Plur": "p"}
_UD_GEN = {"Masc": "m", "Fem": "f", "Neut": "n"}
_UD_MOOD = {"Ind": "i", "Sub": "s", "Imp": "m"}
_UD_VFORM = {"Inf": "n", "Part": "p", "Ger": "d", "Gdv": "g", "Sup": "u"}
_UD_VOICE = {"Act": "a", "Pass": "p"}
_UD_DEG = {"Cmp": "c", "Sup": "s"}
# UD splits what the LDT packs into one tense slot across Tense and Aspect, so the pair is read
# together: a Latin "past" is the imperfect or the perfect depending on aspect, and they take
# different endings. Keyed (Tense, Aspect) with Aspect defaulted, since ITTB states it and PROIEL
# often does not.
_UD_TENSE = {("Pres", ""): "p", ("Pres", "Imp"): "p", ("Past", "Imp"): "i", ("Past", ""): "r",
             ("Past", "Perf"): "r", ("Pqp", ""): "l", ("Pqp", "Perf"): "l",
             ("Fut", ""): "f", ("Fut", "Imp"): "f", ("Fut", "Perf"): "t"}

# The rungs, most specific first: which slots survive at each. Tense goes first because the
# Tense/Aspect pairing above is the least reliable half of the mapping; part of speech next, because
# it is what the tagger gets wrong; then gender, which is the feature a Latin ending most often
# leaves ambiguous ("Gender=Fem,Masc" is itself unstatable — see `_ud_key`).
_RUNGS = ("012345678", "01245678", "1245678", "124567", "1247", "27")


def _slots(*vals) -> str:
    return "".join(v or "-" for v in vals)


def _rung(key: str, keep: str) -> str:
    """`key` with every slot outside `keep` blanked — the stored form of one ladder rung."""
    return "".join(key[i] if str(i) in keep else "-" for i in range(9))


def _ldt_key(tag: str) -> str:
    """A Perseus/LDT nine-position tag → the shared key. Positional, with "-" already meaning
    "unspecified" in the source, so only the part of speech needs translating."""
    t = (tag or "").ljust(9, "-")[:9]
    return _slots(_LDT_POS.get(t[0], "-" if t[0] == "-" else "?"),
                  t[1] if t[1].isdigit() else "-", t[2] if t[2] in "sp" else "-",
                  t[3] if t[3] in "pirltf" else "-", t[4] if t[4] in "isnmpdgu" else "-",
                  t[5] if t[5] in "ap" else "-", t[6] if t[6] in "mfn" else "-",
                  t[7] if t[7] in "ngdabvl" else "-", t[8] if t[8] in "cs" else "-")


def _feat(feats: str, key: str) -> str:
    for part in str(feats or "").split("|"):
        if part.startswith(key + "="):
            return part.split("=", 1)[1]
    return ""


def _ud_key(upos: str, feats: str) -> str:
    """UPOS + UD FEATS → the shared key.

    A MULTI-VALUED feature is read as UNSTATED, not as its first value: the morphologiser writes
    ``Gender=Fem,Masc`` when the form genuinely does not distinguish them, and picking one would
    assert something the tagger explicitly declined to. Blanking the slot drops the lookup to a
    coarser rung instead, which is the honest answer to an ambiguity."""
    def one(val, table):
        return table.get(val, "") if val and "," not in val else ""
    mood = one(_feat(feats, "Mood"), _UD_MOOD) or _UD_VFORM.get(_feat(feats, "VerbForm"), "")
    tense = _UD_TENSE.get((_feat(feats, "Tense"), _feat(feats, "Aspect")), "")
    person = _feat(feats, "Person")
    return _slots(_UD_POS.get(upos or "", ""), person if person in "123" else "",
                  one(_feat(feats, "Number"), _UD_NUM), tense, mood,
                  one(_feat(feats, "Voice"), _UD_VOICE), one(_feat(feats, "Gender"), _UD_GEN),
                  one(_feat(feats, "Case"), _UD_CASE), one(_feat(feats, "Degree"), _UD_DEG))


# ── building the table from macrons.txt ─────────────────────────────────────────────────────────
def _split_accented(acc: str) -> tuple[str, int]:
    """Morpheus's ``a^ba_ctor`` → ("abactor", bitmask of the LONG vowels).

    ``_`` after a character marks it long and ``^`` marks it short; the mask is indexed from the
    LEFT of the plain form, which is what `_la_macron_vendor.apply_mask` expects."""
    plain, mask, i = [], 0, 0
    for ch in acc:
        if ch == "_":
            if i:
                mask |= 1 << (i - 1)
        elif ch == "^":
            pass
        else:
            plain.append(ch)
            i += 1
    return "".join(plain), mask


def _suffix_mask(mask: int, n: int, k: int) -> int:
    """`mask` over an n-character form, re-indexed over its last `k` characters."""
    return sum(1 << j for j in range(k) if (mask >> (n - k + j)) & 1)


def build_table(lines, progress=None) -> dict:
    """Compile ``macrons.txt`` into the lookup this module reads. Pure; takes any line iterable."""
    forms: dict[str, dict[str, set]] = {}
    seen = 0
    for line in lines:
        if not line or line.startswith("#"):
            continue
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 4:
            continue
        wf, tag, _lemma, acc = parts[0], parts[1], parts[2], parts[3]
        plain, mask = _split_accented(acc)
        # Only rows whose accented column really spells the wordform: Morpheus also emits entries
        # whose accented form differs (u/v and i/j normalisation), and a mask indexed against a
        # different string would lengthen the wrong vowel.
        if not wf or plain.lower() != wf.lower():
            continue
        key = _ldt_key(tag)
        if "?" in key:
            continue
        by = forms.setdefault(wf.lower(), {})
        by.setdefault(key, set()).add(mask)
        seen += 1
        if progress and seen % 200000 == 0:
            progress(None, f"Reading Morpheus… {seen:,} forms")

    F: dict[str, int] = {}          # form → mask, where every analysis agrees (the common case)
    K: dict[str, int] = {}          # form \t rung-key → mask, only where that rung settles it
    for wf, by in forms.items():
        masks = set()
        for s in by.values():
            masks |= s
        if len(masks) == 1:
            F[wf] = next(iter(masks))
            continue
        # ambiguous: keep the majority as the form-only answer, then every rung that IS decisive
        tally: dict[int, int] = {}
        for k, s in by.items():
            for m in s:
                tally[m] = tally.get(m, 0) + 1
        F[wf] = max(tally.items(), key=lambda kv: (kv[1], -kv[0]))[0]
        for keep in _RUNGS:
            agg: dict[str, set] = {}
            for k, s in by.items():
                agg.setdefault(_rung(k, keep), set()).update(s)
            for rk, s in agg.items():
                if len(s) == 1:
                    K[wf + "\t" + rk] = next(iter(s))

    # SUFFIX levels, for a word Morpheus has never seen — the ending is a function of the paradigm
    # and generalises; the stem is lexical and does not, so only the last few characters are kept.
    S: dict[str, int] = {}
    for k in (4, 3):
        agg2: dict[str, dict[int, int]] = {}
        for wf, m in F.items():
            if len(wf) <= k:
                continue
            sm = _suffix_mask(m, len(wf), k)
            agg2.setdefault(f"{k}\t{wf[-k:]}", {}).setdefault(sm, 0)
            agg2[f"{k}\t{wf[-k:]}"][sm] += 1
        for sk, t in agg2.items():
            tot = sum(t.values())
            best, n = max(t.items(), key=lambda kv: (kv[1], -kv[0]))
            if n / tot >= 0.9:      # only where the ending is near-unanimous; a coin toss invents macrons
                S[sk] = best
    if progress:
        progress(None, f"Compiled {len(F):,} forms")
    return {"format": _FORMAT, "source": "morpheus", "credit": MORPHEUS_CREDIT,
            "F": F, "K": K, "S": S}


# ── install ─────────────────────────────────────────────────────────────────────────────────────
def install(progress=None) -> dict:
    """Fetch ``macrons.txt`` and compile it into ``paths.APP_DATA``. ``progress(pct, note)``."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    paths.ensure_dirs()
    os.makedirs(paths.APP_DATA, exist_ok=True)
    note(2, "Downloading Morpheus vowel lengths…")
    try:
        import urllib.request
        req = urllib.request.Request(MORPHEUS_URL, headers={"Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=180) as resp:   # noqa: S310 — a fixed https URL
            raw = resp.read()
            if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                raw = gzip.decompress(raw)
        text = raw.decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 — offline, or the file moved: say so, don't raise
        return {"error": f"could not download the Morpheus table: {exc}"}
    note(45, "Compiling…")
    try:
        table = build_table(text.splitlines(), progress=lambda p, m: note(60, m))
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not compile the Morpheus table: {exc}"}
    if not table["F"]:
        return {"error": "the downloaded table held no usable rows"}
    note(90, "Saving…")
    tmp = _APP_DATA_TABLE + ".part"
    try:
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
            json.dump(table, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, _APP_DATA_TABLE)   # atomic: a half-written table must never be loadable
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
    _CACHE.clear()
    note(100, "Installed")
    return {"ok": True, "forms": len(table["F"]), "path": _APP_DATA_TABLE}


def remove() -> dict:
    """Delete the fetched table. The scheme goes back to `available() is False`."""
    _CACHE.clear()
    try:
        if os.path.isfile(_APP_DATA_TABLE):
            os.remove(_APP_DATA_TABLE)
        return {"ok": True}
    except OSError as exc:
        return {"error": str(exc)}


# ── lookup ──────────────────────────────────────────────────────────────────────────────────────
def _legacy_path() -> str:
    """A SUD-spaCy-harvested LUT, if this machine has one. Kept working because someone who already
    built one should not have to fetch 33 MB to keep what they have."""
    for p in (os.environ.get("SUD_LA_MACRON_LUT") or "",
              os.path.join(paths.APP_DATA, _LEGACY_NAME),
              os.path.join(_BUNDLED_DIR, _LEGACY_NAME)):
        if p and os.path.isfile(p):
            return p
    return ""


def source() -> str:
    """Which table would answer right now: "morpheus", "local" (a harvested LUT), or ""."""
    if os.path.isfile(_APP_DATA_TABLE):
        return "morpheus"
    return "local" if _legacy_path() else ""


def available() -> bool:
    """Can Latin be macronised here?  A FILE TEST, not a load — this is called on every
    ``script_schemes("la")`` (i.e. every language switch) and the table costs real time to parse."""
    return bool(source())


def status() -> dict:
    """One row for the Manage Models UI."""
    src = source()
    return {"id": "la_macron", "label": "Latin macrons",
            "note": "Morpheus vowel lengths, fetched from latin-macronizer (~4 MB download)",
            "installed": bool(src), "source": src, "credit": MORPHEUS_CREDIT}


def _table():
    """The loaded Morpheus table, or None. Cached; a missing/corrupt file is "no macrons"."""
    if not os.path.isfile(_APP_DATA_TABLE):
        return None
    got = _CACHE.get(_APP_DATA_TABLE, ...)
    if got is not ...:
        return got
    try:
        with gzip.open(_APP_DATA_TABLE, "rt", encoding="utf-8") as fh:
            t = json.load(fh)
        if int(t.get("format") or 0) != _FORMAT or not t.get("F"):
            t = None       # built by an older shape → ignore rather than misread it
    except Exception:  # noqa: BLE001
        t = None
    _CACHE[_APP_DATA_TABLE] = t
    return t


def _legacy():
    """The vendored reader over a harvested LUT, or None."""
    p = _legacy_path()
    if not p:
        return None
    got = _CACHE.get(p, ...)
    if got is not ...:
        return got
    try:
        from . import _la_macron_vendor as _V
        eng = _V.LaMacronise(lut=p)
    except Exception:  # noqa: BLE001
        eng = None
    _CACHE[p] = eng
    return eng


def _mask_for(t, form: str, upos: str, feats: str):
    """``(mask, level)`` for `form`, walking the ladder — ``(None, None)`` when nothing answers.

    `level` is ``"form"`` where the lexicon holds THIS WORD (at whatever rung) and ``"suffix"``
    where only its ending was recognised. The two are not interchangeable to `_extra_fixes`, whose
    orthographic rules may correct a guess but must not contradict an entry."""
    lower = form.lower()
    key = _ud_key(upos, feats)
    K, F, S = t["K"], t["F"], t["S"]
    if lower in F:
        for keep in _RUNGS:                      # a rung only exists where it was decisive
            m = K.get(lower + "\t" + _rung(key, keep))
            if m is not None:
                return m, "form"
        return F[lower], "form"                  # unambiguous, or the majority reading
    for k in (4, 3):                             # unseen word: fall back on its ending
        if len(lower) > k:
            m = S.get(f"{k}\t{lower[-k:]}")
            if m is not None:
                n = len(lower)
                return sum(1 << (n - k + j) for j in range(k) if (m >> j) & 1), "suffix"
    return None, None


# ── this app's own paradigm rules (see the module docstring for the measurement) ────────────────
_VOW = "aeiouy"
_NOMINAL = {"NOUN", "PROPN", "ADJ", "DET", "NUM"}   # PRON is deliberately absent: `mihi`/`tibi`/`sibi`
_VERBAL = {"VERB", "AUX"}                           # are dative singulars in SHORT -i (measured 33.8 % long)
# The two deadjectival adverbs with a SHORT -e, listed by every grammar beside each other. See the
# rule in `_extra_fixes` for why a two-entry list is the right shape here and a type-count is not.
_ADV_SHORT_E = {"bene", "male"}


def _last_vowel(form: str, before: int) -> int:
    """Index of the last vowel at or before `before`, or -1. Used by the final-consonant rules,
    where the vowel being fixed is not the last CHARACTER (``amant``, ``caput``, ``deōrum``)."""
    for i in range(min(before, len(form) - 1), -1, -1):
        if form[i] in _VOW:
            return i
    return -1


def _extra_fixes(form: str, upos: str, feats: str, lemma: str, oov: bool, known=None) -> dict:
    """``{index: is-that-vowel-long}`` for the cells this app settles itself. `form` is bare (macrons
    already stripped) and lowercased by the caller; indices are into it. `known` is the lexicon's
    form set, for the one rule that needs to ask whether another word exists.

    TWO TIERS, AND `oov` IS WHAT SEPARATES THEM.
      · ``fix()`` — a cell measured EXCEPTIONLESS (100.00 %) against ``macrons.txt``. Applied always,
        because a paradigm cell is a fact the lexicon may simply never have been shown, and
        contradicting its morphology-blind fallback is the entire point (nominative `Gallia` against
        ablative `Galliā`).
      · ``dflt()`` — a cell with a measured residue, however small. Applied ONLY where the lookup had
        no entry for this very word. The residue words are, almost by definition, ones the lexicon
        KNOWS — `senectūs`, `virtūs`, `bene`, `ante`, `occepso`, the Greek `-ēm` accusatives — so
        gating on ignorance makes them unreachable while losing nothing: a rule that fires where there
        is no evidence can only improve on a suffix guess. Applied unconditionally, the nominative
        `-us` rule shortened `senectūs` to `senectus`, which is what made the line worth drawing.
    The tier of every rule is stated beside it with the figure that decided it."""
    f = form
    n = len(f)
    if not n:
        return {}
    out: dict = {}

    def fix(i, long):                      # exceptionless — a statement about the paradigm
        if 0 <= i < n:
            out[i] = long

    def dflt(i, long):                     # a default — only where the lexicon has nothing to say
        if oov and 0 <= i < n:
            out.setdefault(i, long)

    case, num, vf = _feat(feats, "Case"), _feat(feats, "Number"), _feat(feats, "VerbForm")
    person, mood, voice = _feat(feats, "Person"), _feat(feats, "Mood"), _feat(feats, "Voice")
    lem = strip_macron(str(lemma or "")).lower()   # a lemma may be stored macronised; the tests are on its ENDING
    last = f[-1]

    # ── verbal, where the ending is the whole of what the form says ─────────────────────────────
    if upos in _VERBAL and vf != "Part":
        if vf == "Inf":
            if last == "e":
                fix(n - 1, False)          # amāre, legere, esse — 100.00 % (n=5,726)
            elif last == "i":
                fix(n - 1, True)           # amārī, legī, loquī — 100.00 % (n=2,970)
        elif vf in ("Ger", "Gdv") and case in ("Gen", "Dat", "Abl") and last in "oi":
            fix(n - 1, True)               # amandī / amandō — 100.00 % (n=1,618 / 4,911)
        elif vf == "Sup" and last == "u":
            fix(n - 1, True)               # the -ū supine (mīrābile dictū) — 100.00 % (n=574)
        elif person == "1" and num == "Sing":
            if last == "o":
                dflt(n - 1, True)          # amō, sum, legō — 99.99 % (n=8,051; `occepso` alone)
            elif last == "i":
                dflt(n - 1, True)          # the perfect amāvī — 99.88 % (n=2,409; abstinī-type only)
        elif mood == "Imp" and person == "2" and num == "Sing" and voice != "Pass":
            # THE IMPERATIVE is conjugation-dependent (30.0 % long taken whole), and nothing in
            # UPOS+FEATS states the conjugation — but three of the four endings do.
            if last in "ai":
                fix(n - 1, True)           # -ā and -ī ARE the 1st and 4th — 100.00 % (n=1,439 / 217)
            elif last == "e" and lem == f + "o":
                # `monē` (2nd) against `lege` (3rd): 25.0 % long together, and the LEMMA separates
                # them — a 2nd-conjugation imperative IS its lemma minus the final -o. 99.56 %, and
                # by TYPE 225 distinct forms long against one (`terge`, which the authorities give
                # as `tergē`). A default, not a fix, on the strength of that one.
                dflt(n - 1, True)
        elif person == "2" and num == "Sing" and _feat(feats, "Tense") == "Fut" and voice == "Pass":
            # `abūtēris`/`abūtēre` — the long ē of the 3rd/4th-conjugation future. Excluding the
            # 1st/2nd b-future (`amāberis`, short) takes the cell 91.6 % → 100.00 % (n=313 / 1,381).
            if f.endswith("ris") and not f.endswith("beris") and n > 4 and f[n - 4] in _VOW:
                fix(n - 4, True)
            elif f.endswith("re") and not f.endswith("bere") and n > 3 and f[n - 3] in _VOW:
                fix(n - 3, True)
        if person in ("1", "2") and num == "Plur" and n > 3:
            # the personal endings, which no conjugation varies — 100.00 % (n=5,044 / 3,340). Not an
            # `elif`: these coexist with the tense-vowel rules above and settle a different slot.
            if person == "1" and f.endswith("mus"):
                fix(n - 2, False)
            elif person == "2" and f.endswith("tis"):
                fix(n - 2, False)

    # ── nominal, INCLUDING a participle, which declines as an adjective ─────────────────────────
    if upos in _NOMINAL or (upos in _VERBAL and vf == "Part"):
        if num == "Plur" and case in ("Dat", "Abl") and n >= 3:
            if f.endswith("is"):
                fix(n - 2, True)           # dominīs — 100.00 % (n=35,676)
            elif f.endswith("bus"):
                fix(n - 2, False)          # -ibus / -ēbus / -ubus: that u is short — 100.00 % (n=11,100)
        elif num == "Plur" and case == "Acc" and f.endswith("is") and n >= 3:
            fix(n - 2, True)               # the i-stem accusative plural -īs — 100.00 % (n=7,287)
        elif num == "Plur" and case in ("Nom", "Voc") and last == "i":
            fix(n - 1, True)               # dominī, factī — 100.00 % (n=20,798)
        elif num == "Plur" and case == "Gen" and f.endswith("um") and n > 2:
            fix(n - 2, False)              # -ārum / -ōrum / -uum: that u is short — 100.00 % (n=28,310)
        elif num == "Plur" and case == "Acc" and f.endswith("as") and lem.endswith("a") and n > 2:
            # FIRST-DECLENSION accusative plural -ās. Whole, 98.6 % — a latinised Greek
            # third-declension `Arcadas` is spelt alike and is short; an a-stem lemma (the signal
            # `_la_macron_vendor._LEMMA_CLASS` reads) separates them, and then 100.00 % (n=2,010).
            fix(n - 2, True)
        elif num == "Sing" and case == "Abl" and last == "a":
            # THE ABLATIVE SINGULAR -ā, and it needs NO declension test: only the a-stems have one.
            # 100.00 % (n=13,606). This is the vendored `_PARADIGM`'s own cell reached without
            # `InflClass`, which that table requires and which a tagger routinely omits.
            fix(n - 1, True)
        elif num == "Sing" and case == "Dat" and last == "o":
            fix(n - 1, True)               # the dative singular -ō — 100.00 % (n=18,180)
        elif num == "Sing" and case == "Abl" and last == "o":
            dflt(n - 1, True)              # ablative -ō — 99.99 % (n=18,184; the Greek `chao` alone)
        elif num == "Sing" and case in ("Gen", "Dat") and last == "i":
            dflt(n - 1, True)              # dominī, fortī, diēī — 99.99 % (n=15,664 / 5,964; `senati`)
        elif num == "Sing" and case == "Nom" and f.endswith("us") and n > 2 and sum(
                1 for c in f if c in _VOW) > 2:
            # NOMINATIVE SINGULAR -us, that u short: 99.89 % once monosyllables are out (n=12,660).
            # A DEFAULT, and this is the cell that forced the two-tier split — its residue is the
            # third-declension `-tūs` abstracts (`virtūs`, `senectūs`, `servitūs`, `iuventūs`) and the
            # Greek `-ūs` names, and applied unconditionally it shortened every one of them. Gender
            # does NOT separate them, measured: feminine `-tus` nominatives are only 14.3 % long, the
            # rest being Greek feminine names. They are all common words the lexicon holds, so
            # gating on ignorance is what actually settles it.
            dflt(n - 2, False)
        elif num == "Sing" and case == "Voc" and last == "e" and (lem.endswith("us") or lem.endswith("um")):
            # SECOND-DECLENSION vocative singular -e, short. Whole, 90.9 % — the residue is Greek
            # vocatives in -ē (`Achātē`); on an o-stem lemma, 99.98 % (n=4,379, `androgynē` alone).
            dflt(n - 1, False)

    # ── the DEADJECTIVAL ADVERB in -ē ───────────────────────────────────────────────────────────
    # `longē` is long and `bene` is short, and no FEATURE of the token says which: the difference is
    # DERIVATIONAL — an adverb formed from an o-stem adjective ends in -ē, and the ~105 short ones are
    # the adverbs formed from nothing (`ante`, `inde`, `prope`, `saepe`) plus `bene`/`male`.
    # SO THE RULE ASKS THE LEXICON WHETHER THE ADJECTIVE EXISTS. An earlier attempt keyed on the LEMMA
    # being the adjective, which is Morpheus's convention and NOT UD's — UD lemmatises an adverb to
    # itself, so that gate could never fire on this app's own parses and the rule was dead code
    # wearing a measurement. Looking `stem + "us"` up in the very table already loaded costs one set
    # membership test and works whatever the lemma says: 99.56 %, or 99.64 % with the `-cumque`
    # compounds out. The residue (`inde` ← a real `indus`, `pene` ← `penus`, `bone`, `anne`, `mage`)
    # is coincidence — words that merely happen to have an -us neighbour — and every one of them is a
    # common word the lexicon holds, so `dflt` puts it out of reach. `bene`/`male` are named anyway:
    # they are the two the grammars list, and the two a type-count measurement most under-weights.
    if (upos == "ADV" and last == "e" and n > 3 and f not in _ADV_SHORT_E
            and _feat(feats, "Degree") not in ("Cmp", "Sup")
            and not f.endswith(("cumque", "cunque", "opere", "modum"))
            and known is not None and (f[:-1] + "us") in known):
        dflt(n - 1, True)

    # ── degree, which is not tied to a word class ────────────────────────────────────────────────
    if _feat(feats, "Degree") == "Cmp" and f.endswith("ius") and n > 3:
        fix(n - 3, False)                  # longius, facilius — the comparative -ius — 100.00 % (n=3,718)

    # ── ORTHOGRAPHIC, and defaults for the reason the tier exists ───────────────────────────────
    # A vowel before final -m or -t is short: 99.92 % (n=129,773) and 99.98 % (n=37,053), the same
    # walk reaching the vowel before -nt (100.00 %, n=14,737). The residue is real words the lexicon
    # spells right — latinised Greek accusatives in -ēm, `ēst` "he eats" beside `est` "he is".
    if last == "m" or last == "t":
        i = _last_vowel(f, n - 2)
        if i >= 0:
            dflt(i, False)
    return out


def _mask_of(macronised: str) -> int:
    """The long-vowel mask implied by a spelling that already carries its macrons — the inverse of
    `_la_macron_vendor.apply_mask`. Needed only on the harvested-LUT path, which hands back a
    finished string rather than the mask it built it from."""
    mask, i = 0, 0
    for ch in unicodedata.normalize("NFD", macronised):
        if ch == "̄":
            if i:
                mask |= 1 << (i - 1)
        elif not unicodedata.combining(ch):
            i += 1
    return mask


def _apply_extra(base: str, mask: int, upos: str, feats: str, lemma: str, oov: bool, known=None) -> int:
    """`mask` with :func:`_extra_fixes` written over it. `known` is the lexicon's form set, which the
    deadjectival-adverb rule asks whether the corresponding ADJECTIVE exists."""
    for i, long in _extra_fixes(base.lower(), upos or "", feats or "", lemma or "", oov, known).items():
        if 0 <= i < len(base):
            mask = (mask | (1 << i)) if long else (mask & ~(1 << i))
    return mask


_REAL_LEVELS = ("L1", "L2", "L3")   # a harvested entry for THIS word, as opposed to a suffix guess


# (An `_enclitic_host` helper lived here: it split an UNSPLIT `armaque` into host + clitic and
# macronised the host, because `macrons.txt` lists WORDS and never host+clitic — measured, only 64 of
# its forms end in `-que` with the host also listed, and 14 of those are lexicalised (`dēnique`,
# `quisque`). REMOVED because it was solving the problem in the wrong layer: an enclitic is a separate
# TOKEN, UD tokenises `armaque` as a multi-word token over `arma` + `que`, and the Latin tokeniser is
# what should be splitting it. Once it does, each piece reaches this module as its own word and every
# rule below simply works — no special case, and the MWT is visible in the diagram and the file as
# well, which a fix confined to macronisation could never have given.)


def macronise(form: str, upos: str = "", feats: str = "", lemma: str = "") -> str:
    """The macronised spelling of one Latin word, or ``""`` when it cannot be given.

    ⚠ **A QUANTITY THE AUTHOR WROTE IS KEPT; EVERY OTHER VOWEL IS STILL DERIVED.**

    Everything else in this module is inference — somebody else's lexicon plus rules that are right
    99-point-something per cent of the time — and a macron or breve someone has WRITTEN is not
    inference. So a written mark is authoritative and this module will not revise it. A **breve** is
    the pointed case: an unmarked vowel says nothing (Latin is normally written with no quantities at
    all), so a breve is the ONLY way to say "short, and I mean it", which makes it exactly the mark a
    reader reaches for to contradict this module. It is honoured, and written back AS a breve — a bare
    vowel would lose the statement.

    But a mark exempts only ITS OWN VOWEL, not the whole word. Part-marking is the normal way of
    writing Latin quantities — you mark what is contrastive or unexpected and leave the rest — and
    that cuts the opposite way from how it first looks: precisely BECAUSE part-marking is normal, an
    unmarked vowel is not a claim of shortness, it is simply unmarked, and filling it in adds
    information without contradicting anybody. `dīvisa` therefore comes back `dīvīsa`, keeping the
    author's first macron and supplying the second; `dĭvisa` comes back `dĭvīsa`, the breve intact and
    the machine's own macron beside it.

    (An earlier version returned any marked word verbatim. That treated the silence as deliberate,
    which is the one thing part-marking says it is not.)"""
    if not form:
        return ""
    written = _written_marks(form)
    if not written:
        return _macronise_bare(form, upos, feats, lemma)
    bare = _strip_quantity(form)
    out = _macronise_bare(bare, upos, feats, lemma)
    return _reapply_written(out or bare, written)


def _macronise_bare(form: str, upos: str = "", feats: str = "", lemma: str = "") -> str:
    """The macronised spelling of one Latin word, or ``""`` when it cannot be given.

    ``""`` rather than the form itself, because that is what every `translit` engine returns for
    "nothing to show" and what lets the caller fall back to the stored form with no special case.

    THE TWO TABLES CASCADE, and neither subsumes the other — measured on the held-out
    ITTB+PROIEL test split, agreement with Alatius, gold morphology:

        where the harvest HAS the word (92.1 % of that corpus)   harvest 98.23 %   Morpheus 93.98 %
        where it does not (7.9 %, its suffix + no-entry levels)  harvest 52.46 %   Morpheus 90.42 %

    The harvest is near-perfect on its own vocabulary — it was built from that treebank with exact
    (form, upos, feats) keys — and close to a coin toss off it, which is upstream's own finding
    stated the other way round ("OOV levels are 71 % of all errors from 8 % of tokens"). Morpheus
    covers 249,659 forms against the harvest's 42,817, so it is what answers the rest.

    Taking each where it is strong is worth more than either alone, and the gap widens with the
    distance from the harvest's own corpus. On the Perseus test split (classical poetry, out of the
    harvest's domain, where its OOV share rises from 7.9 % to 23.8 %):

        Morpheus alone 95.75 %    harvest alone 87.02 %    cascaded 97.24 %

    Most users will have only the Morpheus table, since the harvested one cannot be distributed at
    all — so the ordering matters chiefly for the person who has already built one.

    ⚠ **QUANTITIES THE AUTHOR WROTE ARE KEPT AND THE REST ARE STILL FILLED IN** — see the wrapper
    :func:`macronise` above, which is what callers reach; this is the derivation for a BARE word."""
    if not form:
        return ""
    t = _table()
    eng = _legacy()
    if eng is not None:
        try:
            out, lvl = eng.resolve(form, upos or "", feats or "_", lemma or "")
        except Exception:  # noqa: BLE001
            out, lvl = "", None
        real = out and (lvl or "").split("+")[0] in _REAL_LEVELS
        if real or (t is None and out):
            # A harvested entry for this very word is the best answer there is — but it is still a
            # LOOKUP, so this module's paradigm rules apply over it exactly as they do over
            # Morpheus's. Re-derived from the finished string rather than threaded through
            # `eng.resolve`, which is vendored and returns no mask.
            try:
                from . import _la_macron_vendor as _V
                base = _V.strip_macron(out)
                m = _apply_extra(base, _mask_of(out), upos or "", feats or "", lemma or "", not real,
                                 (t or {}).get("F"))
                return _V.apply_mask(base, m) if m else base
            except Exception:  # noqa: BLE001
                return out
        if t is None:
            return out or ""    # no Morpheus table and no harvested answer either
    if t is None:
        return ""
    try:
        from . import _la_macron_vendor as _V
        if not any(c.isalpha() for c in form):
            return form
        base = _V.strip_macron(form)
        got, level = _mask_for(t, base, upos or "", feats or "")
        mask = got or 0
        # The PARADIGM OVERRIDE still applies, and still for its own reason: a lookup memorises
        # pairs and cannot express a rule, so a cell it has never seen falls through to something
        # morphology-blind. It is a statement about Latin (a-stem nominative -a is short, ablative
        # -ā long), not a patch for the harvested table it was written against.
        fixed = _V.paradigm_final(base, feats or "", lemma or "", upos or "")
        if fixed is not None and base:
            bit = 1 << (len(base) - 1)
            mask = (mask | bit) if fixed else (mask & ~bit)
        # …and THIS module's own cells over the top of upstream's three (see `_extra_fixes`). Last,
        # so an overlapping cell is settled by the rule measured here — the two agree wherever both
        # speak (the a-/o-/e-stem finals), and the extension is what covers everything else.
        mask = _apply_extra(base, mask, upos or "", feats or "", lemma or "", level != "form", t["F"])
        return _V.apply_mask(base, mask) if mask else base
    except Exception:  # noqa: BLE001
        return ""


def macronise_many(forms, upos=None, feats=None, lemmas=None) -> list[str]:
    """:func:`macronise` over a batch. ``upos``/``feats``/``lemmas`` are parallel to ``forms``;
    a short or absent list simply leaves that hint empty for the remaining tokens, so a caller with
    only forms still gets the form-only and suffix levels."""
    def _at(seq, i):
        if isinstance(seq, (list, tuple)):
            return str(seq[i]) if i < len(seq) and seq[i] else ""
        return str(seq) if seq else ""

    return [macronise(str(f or ""), _at(upos, i), _at(feats, i), _at(lemmas, i))
            for i, f in enumerate(forms or [])]


def morpheus_table_path() -> str:
    """Where `install()` puts the Morpheus table, whether or not it is there yet.

    Named unconditionally, and deliberately NOT `lut_path()` below, which falls back to a harvested
    SUD-spaCy LUT: this is the path handed to the released Latin model's own `la_macronise` through
    `$LA_MORPHEUS_TABLE` (see `parse._share_macron_table`), and that component reads the Morpheus
    shape only. Pointing it at a harvested LUT would be a silent no-data case rather than an error.
    The two projects write the SAME file — same name, same F/K/S payload — so one download serves
    the app's Script layer and the model's component both."""
    return _APP_DATA_TABLE


def lut_path() -> str:
    """Back-compat: the table this machine would use, or "". Some callers only want to know if
    there IS one and where it came from — `status()` says it better."""
    return _APP_DATA_TABLE if os.path.isfile(_APP_DATA_TABLE) else _legacy_path()


def strip_macron(s: str) -> str:
    """Public alias — the inverse the caller needs to compare a macronised display against a form."""
    return unicodedata.normalize("NFC", "".join(
        c for c in unicodedata.normalize("NFD", s) if c != "̄"))


# U+0304 COMBINING MACRON and U+0306 COMBINING BREVE — the two marks that STATE a vowel's quantity.
# Tested after NFD, so the precomposed spellings decompose into them and are caught alike: `ā` U+0101,
# `ē` U+0113, `ī` U+012B, `ō` U+014D, `ū` U+016B, `ȳ` U+0233, and the breves `ă` U+0103, `ĕ` U+0115,
# `ĭ` U+012D, `ŏ` U+014F, `ŭ` U+016D (`y̆` has no precomposed form and is already decomposed). Nothing
# else counts: a diaeresis or an acute is not a quantity mark and must not trip this.
_QUANTITY_MARKS = ("̄", "̆")


def _written_marks(s: str) -> dict:
    """``{index into the BARE spelling: True for a macron, False for a breve}`` — the quantities this
    spelling actually states. ``{}`` for the ordinary bare word, which is the fast path.

    Indexed by BASE character, so the combining marks themselves do not advance the counter and an
    unrelated combining mark (a diaeresis, an acute) neither counts as a quantity nor shifts the ones
    that follow it. NFD first, so the precomposed spellings decompose into these same marks and
    ``ā``/``ă`` are caught exactly as ``a``+U+0304 / ``a``+U+0306 are."""
    out: dict = {}
    i = 0
    for ch in unicodedata.normalize("NFD", s or ""):
        if ch == "\u0304":
            if i:
                out[i - 1] = True
        elif ch == "\u0306":
            if i:
                out[i - 1] = False
        elif not unicodedata.combining(ch):
            i += 1
    return out


def _strip_quantity(s: str) -> str:
    """`s` with every macron AND breve removed — the spelling the lexicon is keyed on.

    Not `strip_macron`, which drops only the macron: a breve left in place would make `ĭnstar` a
    string no lookup can match, and the derivation would fall to the ending guess for a word the
    table knows perfectly well."""
    return unicodedata.normalize("NFC", "".join(
        c for c in unicodedata.normalize("NFD", s or "") if c not in _QUANTITY_MARKS))


def _reapply_written(out: str, written: dict) -> str:
    """`out` (a derived spelling) with the quantities the author WROTE forced back over it.

    The breves are re-inserted as breves rather than left as bare vowels: `apply_mask` knows only
    long and short and renders a short one plain, which would silently delete the author's statement
    that this vowel is short — the very mark they wrote to disagree with this module."""
    from . import _la_macron_vendor as _V
    bare = _strip_quantity(out)
    mask = _mask_of(out)
    for i, long in written.items():
        if 0 <= i < len(bare):
            mask = (mask | (1 << i)) if long else (mask & ~(1 << i))
    res = _V.apply_mask(bare, mask) if mask else bare
    breves = {i for i, long in written.items() if not long}
    if not breves:
        return res
    chars, i = [], 0
    for ch in unicodedata.normalize("NFD", res):
        chars.append(ch)
        if not unicodedata.combining(ch):
            if i in breves:
                chars.append("\u0306")
            i += 1
    return unicodedata.normalize("NFC", "".join(chars))


def marked(s: str) -> bool:
    """Does this spelling state ANY of its vowel quantities? Public because it is the question a
    caller asks to know whether a form carries the author's own marks; :func:`macronise` keeps each
    one it finds and derives the rest."""
    return bool(_written_marks(s))
