"""Apte's Practical Sanskrit-English Dictionary lookup, for the diagram's "Definitions of …"
context-menu item on SANSKRIT documents — the same morphemic-gloss pre-fill :mod:`app.wiktionary`
serves for every other language, from a source that actually covers classical Sanskrit.

Two paths, in this order:

1. **the vendored index, ``app/data/apte1957.tsv.xz`` (1.80 MB)** — Apte's *revised and enlarged*
   1957 edition, as digitised by the Cologne Digital Sanskrit Dictionaries (CDSL dictionary code
   **AP**), preprocessed by ``tools/build_apte_index.py`` from the canonical 18.5 MB source text
   ``v02/ap/ap.txt`` of https://github.com/sanskrit-lexicon/csl-orig.  Offline, instant, and this
   is what wins when the file is present.
2. **the live C-SALT REST API**, ``https://api.c-salt.uni-koeln.de/dicts/ap90/restful`` — Apte's
   *first* 1890 edition (**AP90**), the only Apte on that API.  Used only when the vendored file is
   unusable — absent from a hand-trimmed bundle, unreadable, or on a Python built without ``lzma`` —
   so a stripped app still answers rather than showing "no definitions".  It is strictly the weaker source — see the measurements below — so
   nothing prefers it while the file is there.

Both paths produce the same ``{"candidates":[{"text","entry_upos","head_upos","gender"}, …],
"page_url","error"}``, so :func:`lookup` filters, condenses and returns identically either way.
``head_upos`` is the ENTRY's own primary classification (the word class Apte's headword itself is
filed under — a verb root's "1 P." header, a cited nominative's gender ending, the first labelled
section of a multi-sense entry) as opposed to ``entry_upos``, which is that one SENSE's own label
and can differ within a single entry (an adjective entry with one "--vaH"-marked nominal derivative,
a compound sub-entry whose individual sense happens to carry a different label than the entry it's
filed under). :func:`lookup` requires BOTH to match the wanted UPOS — a token's word class should
select entries that ARE that word class, not merely entries that happen to CONTAIN a same-labelled
aside.

**Why the raw CDSL source text and not the API's TEI.**  The API is a *rendering* of the same
upstream digitisation, and it is lossy in exactly the two places this flyout needs.  Compare, for
``deva``, what the API hands back —

    <hi rendition="#i">a.</hi> (<hi rendition="#b">vI</hi> <hi rendition="#i">f.</hi>) [<hi
    rendition="#b">div-ac</hi>] <hi rendition="#b">1</hi><lb/>Divine, celestial; Bg. 11. 11; Ms.
    <lb/>12. 117. <hi rendition="#b">--2</hi> Shining; …

— with what csl-orig actually says:

    {#deva#}¦ {%<lex>a.</lex>%} ({#-vI#} {%<lex>f.</lex>%}) [{#div-ac#}]
    ∙²1 Divine, celestial; <ls>Bg. 11. 11</ls>; <ls>Ms. 12. 117</ls>.
    ∙²2 Shining; {#yajYasya devamftvijam#} <ls>Rv. 1. 1. 1</ls>.

Every citation is an ``<ls>`` element (68,273 of them in AP), every word-class label a ``<lex>``
(30,184), every sense an ``∙²`` marker (91,503), every Sanskrit run a ``{#…#}`` — all of which the
TEI flattens into bold/italic/plain runs and bare words.  The 1890 source text carries ``<ls>``
too; the API drops it there as well.  So the citation residue that used to disfigure 7.7 % of these
glosses was an **artefact of the API layer, not of Apte** — measured over the 116 distinct lemmas of
``samples/brihat_jataka.conllu`` (both columns with this module's current parser, so they differ
from the 7.7 % / 52.3 % recorded before ``_is_reference`` was fixed):

                                            AP90 via the API      AP 1957 vendored
      glosses returned                            2,565                 2,483
      …carrying citation residue (a digit)          7.0 %                 0.3 %
      …carrying a gender                           55.9 %                53.1 %
      NOUN lemmas answered WITH a gender          49 / 54               53 / 56
      lemmas resolving to no senses               28 / 116              24 / 116
      whole sweep                              226 s, 116 requests    0.1 s, none

The per-gloss gender rate is flat because AP 1957 returns proportionally MORE adjective and verb
senses, which correctly carry no gender at all; the number that answers "does a noun get a gender"
is the fourth row, over the noun lemmas that got an answer at all, and it goes 90.7 % → 94.6 %.  The
24 remaining empty lemmas are mostly inflected forms rather than lemmas ("śrutau", "lopāt",
"rāśayo") and two dandas, and they miss in AP90 and in MW alike.  The sweep row is index work only:
the file loads in ~0.2 s and 116 lookups then cost 0.1 s.  A COLD sweep measures ~15 s, essentially
all of it the one-time English-model load inside :func:`app.wiktionary._condense` (``en_sud_ewt``
when this was measured, ``en_sud_ewt_gum`` since — which model that is, is
:func:`app.wiktionary._sud_en`'s answer and not a fact to restate here), which is the same cost on
either column and is not what this row is comparing.

(The vendored column has been re-measured several times as the shared condensation changed, and the
history is worth keeping because it says which numbers a change can and cannot move.  It began at
2,348 glosses / 0.5 % residue / 25 empty; decapitalisation and the deletion of indirect modifier
phrases took it to 2,380 glosses of mean length 2.06 → 1.85 words with the empty count UNCHANGED —
no condensation change can add or remove a HEADWORD, which is the only thing that count is about.
Three more moved it to 2,493 / 1.71 words / still 25 empty: the compound leak below closing, −35;
the modifier rule tightening from "directly attached" to "directly attached AND immediately
adjacent", −1 and 1.84 → 1.81; and a coordination once more starting a gloss candidate of its own,
+149 and 1.81 → 1.71.  That 2,493 re-measures at 2,458 today — the parser moved under it again —
which is the figure the 2,483 above is the after of, both taken in one session so the comparison is
like for like.  The reorganisation below — sub-entries broken out, verbs keyed by their present as
well as their root — is the first change since that moves the empty count at all, 25 → 24, and the
first that moves the gloss total by taking senses AWAY from a headword that never owned them: 190
keys lose a borrowed sense, and one more lemma answers.)

**A verb answers to its root and to its present, and so does a prefixed one.**  Apte heads a verb
article with the root (``gam``, ``kṛ``, ``sthā``) and prints the present 3rd singular only inside the
parenthesised principal parts, ``{#gacCati, jagAma, …#}`` — which the build script deletes with every
other Sanskrit run, since an SLP1 citation is no use as an English gloss.  A Sanskrit treebank
lemmatises a verb to the root under one convention and to the present under another, and a lemma
written the way Apte did not print it missed outright.  The build script now reads that run BEFORE
deleting it and keys the entry under both (``tools/build_apte_index.py``'s :func:`present_forms`);
4,420 present forms enter the index this way, and this reorganisation costs 15 kB in all — 1.780 MB
to 1.796 MB.  Prefixed verbs need no breaking out — Apte
already files ``anugam``, ``saṃskṛ``, ``upasthā`` as records of their own — but they print no parts,
so their present is built by putting the root's into the prefixed HEADWORD in place of the root's own
spelling (:func:`prefixed_forms`), which is what gets the junction sandhi right: saṃskaroti,
pratitiṣṭhati, uttiṣṭhati.  Those are written SOLID, here and in the build script and in the index
itself, because that is what a prefixed verb IS in Sanskrit once the junction sandhi has applied —
there is no boundary left to mark, and a hyphen after the preverb would name a string Apte never
prints and no treebank ever lemmatises to (checked: 0 of the index's ~130 k keys carries one, and
neither does any of the 18.5 MB of source text).  1,608 of the 2,037 such records resolve.  This is what makes
``parikalpate`` — a prefixed verb cited in its 3rd singular, and one of the 116 lemmas measured
above — answer at all.

**Why Apte and not Monier-Williams** (C-SALT serves MW too, at ``/dicts/mw/restful``, and CDSL has
its source text as ``v02/mw``).  MW's TEI is genuinely BETTER MARKUP than AP90's TEI — one
``<sense>`` per sense, ``<gramGrp>`` stating word class and gender structurally, ``<cit>`` fencing
citations.  It still loses on what this flyout needs, measured head to head on
deva/gaja/gam/nara/mahat/sarva and over all 116 lemmas:

  * **Payload.** MW files every compound as an ``<re>`` INSIDE its base entry and the API has no
    sub-entry endpoint, so one lookup downloads the lot: deva 690 kB, sarva 848 kB, mah 1.77 MB.
    The 116-lemma sweep pulled 10.5 MB in 235 s.  (AP has the same compounds and they cost nothing:
    each is its own record with its own headword — see the build script.)
  * **Bare-lemma coverage.** Only 61/116 lemmas hit MW's headword index; 33 more are reachable only
    through ``re_headwords_slp1``, i.e. buried in someone else's giant entry; 22 miss outright.
    (AP 1957 answers 91/116 with no sub-entry indirection at all.)
  * **Stub entries.** MW's ``mahat`` headword is a 625-byte cross-reference ("mah/an &c, see p.794")
    with no glosses at all; the substance is inside the 1.77 MB ``mah`` entry.  Apte answers
    "Great, big, large, huge, vast" directly.
  * **Gloss length**, the thing MGloss pre-fill lives on: for ``nara``, MW averages 4.0 words a gloss
    (max 8, "class of beings allied to Gandharvas Kim2 naras") against Apte's 2.3 (max 4).
  * **Proper names come out in Cologne's ASCII "CSDL" scheme** — ``S3iva``, ``Vis3va1mitra`` — where
    Apte prints ``Śiva``, ``Viṣṇu``, ``Brāhmaṇa``.  A picked sense goes verbatim into MGloss, so MW
    would need a whole CSDL → IAST layer just to draw level.
  * **No source link.** Both Apte editions have a per-entry page scan; MW entries carry no URL field
    at all, only a ``<ref type="facs">`` page number inside a note.

None of that changes with the source text in hand: MW's own ``v02/mw`` is 22 MB of the same
compound-inside-entry structure and the same CSDL proper names.

**Licence.**  The CDSL digitisations are **CC BY-SA 4.0** (``LICENSE`` in sanskrit-lexicon/csl-orig
and in the per-dictionary AP repository), which permits redistribution inside a shipped app given
attribution and share-alike on the data.  The attribution rides in the first line of the data file
itself, so a copy of the file separated from this repository still carries it.  Same footing as
``app/data/lid.176.ftz`` (fastText, CC BY-SA 3.0), already vendored for the same reason.

Everything is wrapped so a failure yields an empty definitions list plus an ``error`` string and
never raises: a missing or corrupt data file, no network on the fallback, a 404, an entry whose
senses all prune away, or aksharamukha missing (the transliteration extras tier is installed on
demand — see :mod:`app.extras`) all degrade the same way.  Results are cached per headword,
independent of the UPOS filter (applied on read)."""

from __future__ import annotations

import os
import re

_CACHE: dict[str, dict] = {}   # folded SLP1 headword → {"candidates":[…],"page_url","error"}
_SOURCE = "Apte"               # what the frontend names as the source of these senses
_PAGE_LABEL = "Open the Apte page scan"   # …and what its "open the source" row says: the only per-entry URL either edition exposes is a scan of the printed page — CDSL's own entry view (getword.php) returns an AJAX fragment, not a page, and C-SALT publishes no entry browser at all (checked: c-salt.uni-koeln.de and kosh.uni-koeln.de are project sites)

_DATA = os.path.join(os.path.dirname(__file__), "data", "apte1957.tsv.xz")
_INDEX: dict[str, list[str]] | None = None   # None = not loaded yet; {} = loaded and unusable (file absent/corrupt), which is what routes to the live fallback

# Apte's grammatical abbreviation → the UD/SUD UPOS tag it corresponds to.  "_IND" is a pseudo-tag:
# Apte's "ind." (indeclinable) is one printed label covering what UD splits across
# ADV/PART/CCONJ/SCONJ/ADP/INTJ, so it can't map to a single tag and is matched against the whole
# set instead (see _pos_matches) rather than guessing one of them.  The vendored index stores the
# RESULT of this table (tools/build_apte_index.py keeps its own copy in step); the live AP90 path
# below still applies it at read time, because there the label is only italic text.
_APTE_POS = {
    "a.": ("ADJ", None), "adj.": ("ADJ", None),
    "m.": ("NOUN", "Masc"), "f.": ("NOUN", "Fem"), "n.": ("NOUN", "Neut"),
    "ind.": ("_IND", None), "indec.": ("_IND", None),
    "pron.": ("PRON", None), "pron. a.": ("PRON", None),
    "num.": ("NUM", None), "num. a.": ("NUM", None),
    "interj.": ("INTJ", None), "prep.": ("ADP", None),
    "adv.": ("ADV", None), "conj.": ("CCONJ", None), "part.": ("PART", None),
}
_IND_UPOS = frozenset({"ADV", "PART", "CCONJ", "SCONJ", "ADP", "INTJ"})
_UD_GENDER_TO_LEIPZIG = {"Masc": "M", "Fem": "F", "Neut": "N", "Com": "CG"}   # this app's own Leipzig set, same table app.wiktionary uses

# Both editions spell a homorganic nasal one of two ways — AP 1957 correctly ("aNga", "tantram"),
# AP90 always as anusvāra ("aMga", "taMtraM"; measured: 0 of 1200 sampled ap90 headwords across six
# initial letters contain a nasal-letter + homorganic-stop cluster, where the SAME sample of MW
# headwords has hundreds) — and a treebank lemma may be written either way.  aksharamukha, correctly,
# gives IAST "aṅga" as "aNga".  Folding every such nasal to anusvāra on BOTH sides makes the
# difference invisible: it costs nothing on a lemma with no such cluster (it is then its own
# normalisation) and can never turn a hit into a miss, since the nasal is fully predictable from the
# stop that follows and so no two distinct headwords can collide under the fold.
_ANUSVARA_RE = re.compile(r"N(?=[kKgG])|Y(?=[cCjJ])|R(?=[wWqQ])|n(?=[tTdD])|m(?=[pPbB])")

# A segment that is only a source reference ("Bg. 11. 11", "Ms. 12. 117.", "3. 5", "v. l.", "&c.")
# rather than a gloss: every word in it is a bare number or a short abbreviation ending in a full
# stop.  The vendored path drops citations as <ls> ELEMENTS and needs this only for the stragglers
# Apte prints outside one ("ibid.", "q. v."); the live AP90 path needs it for every citation, since
# the API's TEI leaves them as plain text among the senses.
_REF_WORD_RE = re.compile(r"^(?:\d+[\d.]*\.?|[A-ZĀŚ][A-Za-zĀ-ſ']{0,4}\.|[a-z]\.|&c\.?)$")
# …but a SINGLE such word is only a reference if it carries a passage number or is one of the few
# Apte prints bare.  Without this, the shape "capitalised word of ≤5 letters + full stop" swallows
# one-word glosses — "Water.", "Great.", "Sport.", "Fire.", "Śiva." are all Apte senses in their
# entirety, and every one of them matched _REF_WORD_RE and was thrown away.
_BARE_REFS = frozenset({"ibid.", "&c.", "&c", "sk.", "tv.", "nm.", "enm.", "l."})


def available() -> bool:
    """Whether a lookup can even be attempted.  aksharamukha is required either way — it is what
    turns this app's IAST lemma into the SLP1 both Apte indexes are keyed on — and it rides the
    on-demand transliteration extras tier, so its absence is an ordinary "no definitions" outcome,
    not an error to raise.  The HTTP/HTML stack is required only for the live AP90 fallback, so it
    is checked only when the vendored index is unusable."""
    try:
        from aksharamukha import transliterate  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    if _load():
        return True
    try:
        import requests  # noqa: F401
        from bs4 import BeautifulSoup  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def is_sanskrit(lang: str) -> bool:
    """The Python twin of the frontend's ``isSanskritLang`` (web/js/lang/translit.js) — base
    subtag only, so "sa", "san", "sa-Latn" and "san_IN" all count."""
    base = (lang or "").lower().split("-")[0].split("_")[0]
    return base in ("sa", "san")


def _slp1(word: str) -> str:
    """The headword's SLP1 spelling, "" if it can't be produced.  Source script is auto-detected
    and falls back to IAST — the same belt-and-braces app.translit._sanskrit uses, so a lemma that
    was left in Devanagari (or already in SLP1) converts just as well as the usual IAST one."""
    try:
        from aksharamukha import transliterate as ak
        src = ak.auto_detect(word) if hasattr(ak, "auto_detect") else "autodetect"
        if not src or src == "Zyyy":   # Zyyy = "common" (punctuation only) — nothing to detect from
            src = "IAST"
        if src == "SLP1":
            return word
        return (ak.process(src, "SLP1", word) or "").strip()
    except Exception:  # noqa: BLE001 — aksharamukha absent, or an input it can't detect
        return ""


# ── the vendored AP 1957 index (preferred) ────────────────────────────────────────────────────

_AP_SCAN = "https://www.sanskrit-lexicon.uni-koeln.de/scans/APScan/2020/web/webtc/servepdf.php?dict=ap&page={}"

# A whole sense that is only a pointer to another entry ("See s. v.", "&c. See s. v.", "cf. …",
# "see under … separately").  Anchored at the START and deliberately not at the end: what follows
# the pointer is the entry pointed AT, never a gloss of this one.  Distinct from _REF_WORD_RE, which
# recognises a literary CITATION ("Bg. 11. 11") — a different kind of non-gloss.
_XREF_ONLY_RE = re.compile(r"(?i)\A[\s.,;]*(?:see|cf\.?|q\.\s*v\.|&c\.?)\b")


def _senses(entry: str) -> list[str]:
    """The raw sense strings of one index line, label sections flattened away — see the output
    format at the top of tools/build_apte_index.py.  Used to judge a whole entry before any of it is
    condensed, which is why it reads the stored prose rather than :func:`_split`'s output."""
    body = entry.partition("\t")[2].partition("\t")[2]
    return [s for section in body.split("\x1d") for s in section.partition("\x1e")[2].split("\x1e") if s]


def _load() -> dict[str, list[str]]:
    """The index, loaded once on first use and kept.  ~1.8 MB of xz decompresses and indexes in
    ~0.2 s into 130 k keys (0.08 s of that the decompression), so it is done lazily rather than at
    import — an app that never opens a Sanskrit document never pays for it.  An absent or corrupt
    file yields ``{}``, which is what makes :func:`_fetch` fall through to the live AP90 API rather
    than fail; the empty dict is cached too, so a missing file is not re-stat'ed per lookup."""
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    _INDEX = {}
    try:
        import lzma
        with lzma.open(_DATA, "rt", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#"):   # the provenance/licence line — see tools/build_apte_index.py
                    continue
                keys, _, rest = line.rstrip("\n").partition("\t")
                if not rest:
                    continue
                for key in keys.split("\x1f"):
                    _INDEX.setdefault(key, []).append(rest)   # a list, not one entry: Apte files homonyms as separate records ("aṅga" the particle and "aṅgam" the body are two), and both should answer
    except Exception:  # noqa: BLE001 — file absent (a trimmed bundle), unreadable, or a Python built without lzma
        _INDEX = {}
    return _INDEX


def _local(slp1: str) -> dict | None:
    """Candidates from the vendored index, or None if this headword isn't in it — which is NOT the
    same as "the index is unusable", and is why the two cases are distinguished: a genuine miss
    must not silently fall through to the weaker 1890 edition and answer from that instead.

    Sub-entries (the ``level`` column the build script writes) are suppressed whenever the SAME key
    also reaches a main entry, and kept when it reaches nothing else.  That is what the level column
    is for.  The 42,390 sub-entry records are in the file on purpose — a compound-unsplit treebank
    lemmatises to exactly those headwords, so ``devālaya``/``rājaputra``/``janmādhipa`` must still
    answer, and they do: 64,983 keys are reached by nothing else.  But 299 keys reach both, a word
    with an entry of its own that is ALSO printed under somebody else's headword, and there the
    sub-entry is somebody else's word: looking up ``devara`` "husband's brother" listed ``devaram``
    "a temple" (a compound of ``deva``, keyed here because a citation form's stem is indexed too),
    ``svalpa`` led with "see s." and "v." from the stub under ``su``, ``alaṃkāra`` with "c." and "see
    separately below" from the one under ``alam``.

    "Sub-entry" now covers the DERIVATIVES as well as the compounds, and that is a change in what
    this level column marks rather than in how it is read.  Apte prints a word and its derivative
    under one headword whenever one definition serves both — ``aṭṭālaḥ, -lakaḥ``; ``adhigamaḥ,
    -manam``; ``kallaḥ`` "deaf" with ``kallatā`` "deafness"; ``upaviṣṭa`` "seated" with
    ``upaviṣṭaka``, which Apte defines only as "firmly settled (of a foetus)" — and the build script
    used to read a shared definition as proof of a shared word, so it merged them.  It does not: the
    two are separate words, and the merge both hid each derivative's headword inside the base's entry
    and gave the base senses that are not its own.  Broken out (959 further entries, 190 keys losing
    a sense they had borrowed), each still carries the shared definition, because the record still
    resolves its ``{{Lbody=…}}`` wherever it lands.

    A main entry that is itself nothing but a cross-reference does NOT outrank a sub-entry — the
    same judgement :func:`_is_reference` and the build script's ``_DANGLING`` already make, that a
    pointer is not a gloss.  Three of the 299 keys need it, and two are one common word: ``udadhi``'s
    main entry reads "See under 2." entire, while the sub-entry under ``uda`` carries "ocean", "a
    cloud", "a lake".

    A simple headword listing its OWN compounds is the failure this level column has to prevent, and
    getting there took two goes.  The base entry's printed ``━Comp.`` list is not the channel: it is
    a bare list of SLP1 headwords and the build script cuts it before any sense is read (verified:
    all 4,454 of them match the cut, and ``deva``'s 190-compound list is one).  The channel was the
    RECORD MERGE.  Upstream files each compound as a record of its own — but marks it ``<e>2`` only
    where the base record also prints that ``━Comp.`` list, and ``janman`` (L 15403) prints none, so
    all 35 of its compounds arrived as ``<e>1`` sub-records of L 15403 and the build script's
    "``<e>1`` records sharing a base L number are one printed entry" merge poured them into
    ``janman`` itself — 61 senses instead of 26, ``janmādhipa``'s "an epithet of Śiva" among them,
    and every one of those compound headwords keyed onto the same swollen entry, so ``janmādhipa``
    answered with the identical 61.  The build script now decides sectionhood from the two headwords
    rather than trusting ``<e>`` (``tools/build_apte_index.py``'s ``is_variant``), which is also why
    the level column here can no longer be described as simply upstream's."""
    entries = _load().get(slp1)
    if not entries:
        return None
    main = [e for e in entries if e.partition("\t")[2].partition("\t")[0] == "1"]
    if main and all(_XREF_ONLY_RE.match(s) for e in main for s in _senses(e)):
        main = []               # …a "See under 2." stub, which is no reason to hide real senses
    entries = main or entries   # …or, when nothing is main, this IS a direct lookup of a compound headword — use the sub-entries
    candidates: list[dict] = []
    page = ""
    for entry in entries:
        page_no, _, rest = entry.partition("\t")
        _level, _, body = rest.partition("\t")
        page = page or page_no
        head_upos = None
        for section in body.split("\x1d"):
            label, _, senses = section.partition("\x1e")
            pos, _, gender = label.partition(",")
            if head_upos is None:
                head_upos = pos   # the entry's OWN classification is its first section's label — every later section in this same entry is compared against it, not just against the wanted UPOS
            for sense in senses.split("\x1e"):
                for sub in _split(sense):
                    candidates.append({"text": sub["text"], "entry_upos": pos, "head_upos": head_upos, "gender": gender or None})
    return {"candidates": candidates, "error": None,
            "page_url": _AP_SCAN.format(page) if page else None}


# ── the live C-SALT AP90 API (fallback when the vendored index is absent) ──────────────────────

_API = "https://api.c-salt.uni-koeln.de/dicts/ap90/restful/entries"
_UA = "SUD-Workbench/1.0 (https://github.com/; contact via the app repository) requests"

# The final letter of an Apte citation form → the gender it marks.  Apte cites a noun by its
# nominative singular (SLP1 "H" = visarga, "M" = anusvāra), so "vfkzaH" is masculine and "PalaM"
# neuter without any italic label being printed at all; likewise the "--vaH"/"--vaM" markers that
# open a gender section mid-entry.  Only the unambiguous a-/ā-/ī-stem endings are mapped —
# consonant stems ("mahat", "--Bid") carry no gender in their ending and are left unmarked.
_END_GENDER = {"H": "Masc", "M": "Neut", "m": "Neut", "A": "Fem", "I": "Fem"}
_CITE_ENDINGS = ("H", "M", "m", "A", "I")   # tried after a bare stem misses — see _entries

_VERB_HEAD_RE = re.compile(r"^\s*\d{1,2}\s*(?:P|A|U|Ā|Par|Ātm)\.")   # a root entry opens with its conjugation class + pada ("1 P.", "2 P.", "10 U.") — AP90 prints no "v." label, this header IS the label (AP 1957 marks it structurally, with "€1", which the build script reads instead)
_SENSE_NUM_RE = re.compile(r"^-{0,2}\s*\d+\.?$")                     # a bold sense number: "1", "--2", "3."
_MARKER_RE = re.compile(r"^-{2,}\s*([A-Za-zĀ-ſ]{1,10})\.?$")         # a bold "--vaH"/"--Comp." — the "--" is Apte's device for a form built on the headword, never used on a citation
_BRACKET_RE = re.compile(r"\[[^\[\]]*\]")                            # etymologies ("[vraSc-ksa Uṇ. 3. 66]") and the scan's page markers ("[Page0578-b+ 57]") — both noise, both bracketed


def _get(query: str, query_type: str, size: int) -> list[dict]:
    """One /entries call.  Raises on a transport/HTTP failure so :func:`_fetch` can report it;
    an empty result set is a normal, non-exceptional answer."""
    import requests
    resp = requests.get(_API, params={"field": "headword_slp1", "query": query,
                                      "query_type": query_type, "size": size},
                        headers={"User-Agent": _UA}, timeout=10)
    resp.raise_for_status()
    return ((resp.json() or {}).get("data") or {}).get("entries") or []


def _entries(slp1: str) -> list[dict]:
    """Every AP90 entry for this headword, resolving Apte's citation-form convention: adjectives,
    pronouns and verb roots are printed under the BARE STEM ("deva", "sarva", "gam"), but nouns
    under their nominative singular ("vfkzaH", "PalaM", "senA") — so a treebank lemma, which is the
    stem, misses an exact match on exactly the words most likely to be looked up.  Hence, in order:
      1. exact term on the lemma as given (hits stems, and hits a lemma that already carries its
         ending, e.g. "vṛkṣaḥ");
      2. exact term on the lemma minus a final visarga/anusvāra, for the reverse mismatch;
      3. one prefix sweep, keeping only headwords that are the stem plus a citation ending — the
         prefix alone would also return every unrelated word starting with it ("nara" → "narakaH").
    At most three requests, and the common case (a stem Apte prints as a stem) costs one.  (The
    vendored path needs none of this: the build script merges the printed sections of one entry by
    their shared record number and keys the merge under the stem as well.)"""
    seen: set[str] = set()
    out: list[dict] = []
    stem = slp1[:-1] if slp1[-1:] in ("H", "M") else slp1
    for form in (slp1, stem):
        if form and form not in seen:
            seen.add(form)
            out.extend(_get(form, "term", 5))
    if out:
        return out
    wanted = {stem + e for e in _CITE_ENDINGS}
    return [e for e in _get(stem, "prefix", 60) if (e.get("headword_slp1") or "") in wanted]


def _stream(xml: str):
    """The entry's <sense> content as ``(kind, text)`` in document order, ``kind`` ∈ "b" (bold),
    "i" (italic), "" (plain).  Only <sense> is read — the sibling <note><ref> is the facsimile
    link, not lexical content.  <lb/> (the printed column's line break) becomes a "\\n" plain
    token: it is where Apte hyphenates a word across lines ("Chew- ing"), which :func:`_text`
    re-joins, so the break has to survive the flattening to be undone."""
    from bs4 import BeautifulSoup, NavigableString
    soup = BeautifulSoup(xml or "", "html.parser")   # html.parser, not lxml-xml: it is what app.wiktionary already requires, and TEI's flat inline markup needs no namespace handling
    out: list[tuple[str, str]] = []

    def walk(node, kind: str) -> None:
        for child in node.children:
            if isinstance(child, NavigableString):
                out.append((kind, str(child)))
                continue
            name = (child.name or "").lower()
            if name == "lb":
                out.append(("", "\n"))
                continue
            rend = (child.get("rendition") or "").strip() if name == "hi" else ""
            walk(child, "b" if rend == "#b" else "i" if rend == "#i" else kind)

    for sense in soup.find_all("sense"):
        walk(sense, "")
    return out


def _text(chunks: list[str]) -> str:
    """One sense's prose, from the plain/italic chunks collected for it: undo the printed column's
    end-of-line hyphenation across the "\\n" that stood for an <lb/>, drop bracketed etymology and
    page markers, then collapse whitespace.  Parentheticals are left for :func:`_condense` to
    strip, which it does before it splits — it has the nesting-aware scanner for that."""
    raw = "".join(chunks)
    raw = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", raw)   # "non-con-\njugational" → "non-conjugational"; a hyphen NOT at a line break is a real one and is left alone
    raw = raw.replace("\n", " ")
    raw = _BRACKET_RE.sub(" ", raw)
    return re.sub(r"\s+", " ", raw).lstrip(" ;:,.").rstrip(" ;:,")   # a trailing full stop stays for the same reason _split keeps one: it is the mark that identifies an abbreviation run ("… Bh. 2. 45 v. l.") as a source reference


def _label(tok: str) -> tuple[str, str | None] | None:
    """An italic chunk read as a grammatical label — ("UPOS", gender or None), or None if it is
    ordinary italicised prose (a cognate, a plant name).  Apte prints these singly ("m.") and in
    runs ("m. f."); a run keeps the first label's word class and only keeps a gender if every
    member agrees, so "m. f." lands as a NOUN of unstated gender rather than an invented one."""
    norm = tok.strip().lstrip("-").strip().lower()
    if norm in _APTE_POS:
        return _APTE_POS[norm]
    pieces = norm.split()
    if len(pieces) > 1 and all(p in _APTE_POS for p in pieces):
        genders = {_APTE_POS[p][1] for p in pieces}
        return _APTE_POS[pieces[0]][0], (genders.pop() if len(genders) == 1 else None)
    return None


def _candidates(entry: dict) -> list[dict]:
    """One AP90 entry → ``[{"text","entry_upos","gender"}, …]``, reading Apte's TYPOGRAPHIC
    conventions, which is all the API's TEI preserves: senses are numbered by a bold "1"/"--2"/…,
    the part of speech and gender are italic abbreviations ("a.", "m.", "ind."), a gender section
    can instead be opened by a bold inflected ending built on the headword ("--vaH" = devaḥ,
    masculine), bold text is always SLP1 Sanskrit (citations — unreadable as a gloss), and
    "--Comp." opens the compounds list, which is other words, not senses of this one.
    The scan carries a running (word class, gender) that starts from whatever the headword's own
    ending says and is reset by each label or "--" marker it meets; senses printed before any label
    keep an empty word class, which :func:`_pos_matches` treats as "unknown, so keep" rather than
    filtering them away on a guess."""
    stream = _stream(entry.get("xml") or "")
    head = entry.get("headword_slp1") or ""
    gender = _END_GENDER.get(head[-1:]) if head else None
    pos = "NOUN" if gender else ""   # a headword cited WITH its nominative ending ("vfkzaH", "PalaM") is a noun, and that ending IS its gender — Apte prints no italic label in that case
    if _VERB_HEAD_RE.match("".join(t for k, t in stream if k == "")[:40]):
        pos, gender = "VERB", None
    head_upos = pos   # the entry's OWN classification, fixed before any in-entry label/marker below can reassign `pos` for a later section — see the head_upos note in the module docstring
    out: list[dict] = []
    chunk: list[str] = []
    depth = 0   # open parentheses in the text kept so far — a label or "--" marker inside a parenthetical is an ASIDE about a related form, not a heading for what follows ("deva a. (vī f.)" gives the adjective's FEMININE stem; read as a heading it would file every following sense as a feminine noun). Bold runs are dropped whole, so their own brackets ("(= icCase ced)") never reach this count and can't unbalance it.

    def flush() -> None:
        text = _text(chunk)
        chunk.clear()
        if not text:
            return
        for sub in _split(text):
            out.append({"text": sub["text"], "entry_upos": pos, "head_upos": head_upos, "gender": gender})

    for kind, tok in stream:
        if kind == "b":
            stripped = tok.strip()
            if _SENSE_NUM_RE.match(stripped):      # a new numbered sense begins
                flush()
                continue
            m = _MARKER_RE.match(stripped) if depth == 0 else None
            if m:
                word = m.group(1)
                if word.lower().startswith("comp"):
                    flush()
                    break                          # "--Comp." opens the compounds list: those are other headwords, not senses of this one
                flush()
                g = _END_GENDER.get(word[-1:])
                pos, gender = ("NOUN", g) if g else ("", None)   # an ending that names no gender ("--Bid", "--ASrayin") still ends the previous section, but says nothing about the new one
                continue
            continue                               # any other bold run is an SLP1 Sanskrit citation — untranslated, so it is no use as an English gloss
        if kind == "i" and depth == 0:
            lab = _label(tok)
            if lab:
                flush()
                pos, gender = lab
                continue
        chunk.append(tok)
        depth = max(0, depth + tok.count("(") - tok.count(")"))
    flush()
    return out


def _remote(slp1: str) -> dict:
    entries = _entries(slp1)
    candidates: list[dict] = []
    for entry in entries:
        candidates.extend(_candidates(entry))
    page_url = (entries[0].get("pageUri") or None) if entries else None   # the scanned page the entry is printed on — the only per-entry URL the API exposes
    return {"candidates": candidates, "error": None, "page_url": page_url}


# ── shared: sense prose → pickable glosses, filtering, and the public entry point ──────────────

def _is_reference(seg: str) -> bool:
    words = seg.split()
    if not words or not all(_REF_WORD_RE.match(w) for w in words):
        return False
    if len(words) > 1 or any(ch.isdigit() for ch in seg):
        return True   # "Bh. 2. 45", "v. l.", "3. 5" — a run of abbreviations, or one carrying a passage number
    return words[0].casefold() in _BARE_REFS


def _split(text: str) -> list[dict]:
    """One Apte sense → the short, pickable gloss candidates the flyout shows, via
    :func:`app.wiktionary._condense` — the same "definition prose → gloss units" machinery the
    Wiktionary path uses (strip parentheticals, split at semicolons/commas, SUD-parse and prune
    each clause), so a picked Sanskrit sense reads in MGloss exactly like a picked English one.
    Source references are dropped BEFORE condensing, not after: "Divine, celestial; Bg. 11. 11"
    splits at the same punctuation the references sit behind, so left in they would each be parsed
    and offered as a sense of their own.  (On the vendored path they are already gone as elements —
    what this still catches there is the handful Apte prints loose, "ibid.", "q. v.", "&c.")

    No second-level "head of the condensed subtree" check here, unlike app.wiktionary.lookup: that
    guard exists because a long Wiktionary clause can condense down to a subtree headed by a
    different word class than the entry claims.  Apte's senses are already one or two words inside a
    section whose label states the word class for all of them, so re-parsing them adds only noise —
    and it costs real senses, since Apte capitalises the first word of every sense ("Divine") and
    the parser then reads it as a proper noun."""
    from . import wiktionary
    cleaned = re.sub(r"\s+", " ", wiktionary._strip_parentheticals(text))
    kept = [s.lstrip(" :;.,·—–").rstrip(" :;,·—–") for s in re.split(r"[;,]", cleaned)]   # …and strip the punctuation each segment inherits from its neighbours (Apte introduces a citation with a colon), so _is_reference sees "Māl. 1. 31" rather than ": Māl. 1. 31" and still recognises it. A trailing FULL STOP is deliberately kept: it is what tells an abbreviation ("G. M.", "1 P.") apart from an ordinary capitalised gloss word ("Great"), and _condense drops it as punctuation anyway
    kept = [s for s in kept if s and not _is_reference(s)]
    out: list[dict] = []
    for seg in kept:
        out.extend(wiktionary._condense(seg))
    # A multi-rooted parse hands back the stranded punctuation as a candidate of its own ("of Śiva."
    # condenses to "of Śiva" AND "."), which would show as a blank, pickable row.
    return [c for c in out if any(ch.isalnum() for ch in c["text"])]


def _pos_matches(entry_upos: str, wanted: str) -> bool:
    if not wanted or not entry_upos:
        return True   # nothing asked, or Apte printed no label for this run of senses — show them rather than drop them on a guess
    if entry_upos == "_IND":
        return wanted in _IND_UPOS
    if entry_upos == "NOUN":
        return wanted in ("NOUN", "PROPN")   # Apte files proper names ("N. of a king", "N. of Arjuna") under the ordinary gender labels, with no PROPN of its own — so a PROPN token has to accept NOUN entries or it gets nothing at all. Not symmetric: a NOUN token is not offered anything Apte labelled otherwise, and Apte never labels anything PROPN, so there is nothing to make symmetric with
    return entry_upos == wanted


def _fetch(word: str) -> dict:
    """Every candidate for this headword, UNFILTERED — cached per headword so re-looking it up
    under a different UPOS re-filters cheaply instead of re-fetching and re-parsing.
    The vendored 1957 index wins whenever it has the word; the live 1890 API is reached only when
    the index is unusable or silent, never to "top up" a hit (mixing the two editions' senses under
    one page-scan link would misattribute both)."""
    slp1 = _ANUSVARA_RE.sub("M", _slp1(word))   # …folded (see _ANUSVARA_RE) — which also makes the cache key below collapse "aṅga" and "aṃga" onto one entry
    if not slp1:
        return {"candidates": [], "error": "Sanskrit transliteration is not installed", "page_url": None}   # NOT cached: installing the extras tier should make the next lookup work
    cached = _CACHE.get(slp1)
    if cached is not None:
        return cached
    local = _local(slp1)
    if local is not None:
        _CACHE[slp1] = local
        return local
    if _load():
        result = {"candidates": [], "error": None, "page_url": None}   # the index loaded and simply has no such headword — a real answer, cacheable, and not a reason to go to the weaker edition
        _CACHE[slp1] = result
        return result
    try:
        result = _remote(slp1)
    except Exception as exc:  # noqa: BLE001 — offline, timeout, a schema change, …
        return {"candidates": [], "error": str(exc), "page_url": None}   # NOT cached — a transient failure shouldn't stick forever
    _CACHE[slp1] = result
    return result


def lookup(word: str, lang: str = "sa", upos: str = "") -> dict:
    """Definitions for the Sanskrit headword ``word`` (IAST, as this app stores Sanskrit — but
    Devanagari or SLP1 is accepted too), restricted to those matching ``upos`` where Apte's own
    labelling supports it (:func:`_pos_matches`, where a PROPN token takes Apte's noun entries — it
    has no others to take).  Each surviving sense is decapitalised unless the token is a PROPN
    (:func:`app.wiktionary._decap`).  Returns the shape :func:`app.wiktionary.lookup` returns, so the
    frontend consumes both identically: ``{"definitions":[{"text","gender_ud","gender_abbr"},…],
    "page_url","source","page_label"}``, or ``{"definitions":[],"error":"…"}`` on failure.
    ``lang`` is accepted and ignored — Apte is Sanskrit-only; the parameter is there so this and
    app.wiktionary.lookup stay call-compatible for Api.definition_lookup's dispatch."""
    word = (word or "").strip()
    wanted = (upos or "").strip().upper()
    if not word:
        return {"definitions": []}
    if not available():
        return {"definitions": [], "error": "aksharamukha is not installed"}
    fetched = _fetch(word)
    if fetched.get("error"):
        return {"definitions": [], "error": fetched["error"]}
    matched = [c for c in fetched["candidates"]
               if _pos_matches(c["entry_upos"], wanted) and _pos_matches(c.get("head_upos"), wanted)]
    if wanted and not matched:
        matched = fetched["candidates"]   # Apte labels a word class far less consistently than Wiktionary states one (whole entries carry no label at all), so an empty filtered result is much more often a gap in the source than a genuine "this word is never a NOUN" — fall back to every sense rather than showing the token's own dictionary as having nothing to say about it
    out = []
    seen: set[tuple[str, str]] = set()
    from . import wiktionary   # …for _decap: one casing rule for both dictionaries, so a picked Sanskrit sense reads in MGloss exactly like a picked English one (same reason _split borrows _condense)
    for c in matched:
        d = {"text": wiktionary._decap(c["text"], wanted)}   # Apte capitalises the first word of EVERY sense — it opens a printed line — so this is where that typography comes off; see _decap for why only position 0 is touched and what is exempt (this entry's own "N. of a king" glosses above all)
        gender_ud = c.get("gender") or ""
        if gender_ud:
            d["gender_ud"] = gender_ud
            d["gender_abbr"] = _UD_GENDER_TO_LEIPZIG[gender_ud]
        # Deduplicate on (text, gender), keeping the FIRST — Apte repeats a one-word gloss across
        # senses and across its own homonym sections, and condensing collapses more of them still.
        # Same rule (and same reason) as app.wiktionary.lookup: an identical gloss under a
        # different gender is a genuinely different pick, since choosing it writes that Gender.
        key = (" ".join(d["text"].split()).casefold(), gender_ud)
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return {"definitions": out, "page_url": fetched.get("page_url"),
            "source": _SOURCE, "page_label": _PAGE_LABEL}
