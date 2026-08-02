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
    """The long-vowel mask for `form`, walking the ladder. None when nothing answers."""
    lower = form.lower()
    key = _ud_key(upos, feats)
    K, F, S = t["K"], t["F"], t["S"]
    if lower in F:
        for keep in _RUNGS:                      # a rung only exists where it was decisive
            m = K.get(lower + "\t" + _rung(key, keep))
            if m is not None:
                return m
        return F[lower]                          # unambiguous, or the majority reading
    for k in (4, 3):                             # unseen word: fall back on its ending
        if len(lower) > k:
            m = S.get(f"{k}\t{lower[-k:]}")
            if m is not None:
                n = len(lower)
                return sum(1 << (n - k + j) for j in range(k) if (m >> j) & 1)
    return None


_REAL_LEVELS = ("L1", "L2", "L3")   # a harvested entry for THIS word, as opposed to a suffix guess


def macronise(form: str, upos: str = "", feats: str = "", lemma: str = "") -> str:
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
    all — so the ordering matters chiefly for the person who has already built one."""
    if not form:
        return ""
    t = _table()
    eng = _legacy()
    if eng is not None:
        try:
            out, lvl = eng.resolve(form, upos or "", feats or "_", lemma or "")
        except Exception:  # noqa: BLE001
            out, lvl = "", None
        if out and (lvl or "").split("+")[0] in _REAL_LEVELS:
            return out          # a real harvested entry for this very word — the best answer there is
        if t is None:
            return out or ""    # no Morpheus table: its suffix guess is all there is
    if t is None:
        return ""
    try:
        from . import _la_macron_vendor as _V
        if not any(c.isalpha() for c in form):
            return form
        base = _V.strip_macron(form)
        mask = _mask_for(t, base, upos or "", feats or "") or 0
        # The PARADIGM OVERRIDE still applies, and still for its own reason: a lookup memorises
        # pairs and cannot express a rule, so a cell it has never seen falls through to something
        # morphology-blind. It is a statement about Latin (a-stem nominative -a is short, ablative
        # -ā long), not a patch for the harvested table it was written against.
        fixed = _V.paradigm_final(base, feats or "", lemma or "", upos or "")
        if fixed is not None and base:
            bit = 1 << (len(base) - 1)
            mask = (mask | bit) if fixed else (mask & ~bit)
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
