#!/usr/bin/env python3
"""Build ``app/data/apte1957.tsv.xz`` — the vendored sense index :mod:`app.apte` reads — from the
Cologne Digital Sanskrit Dictionaries' canonical digitisation of

    Vaman Shivram Apte, *The Practical Sanskrit-English Dictionary*, revised and enlarged edition,
    Poona 1957  (CDSL dictionary code **AP**)

whose source text is one 18.1 MB file, ``v02/ap/ap.txt`` in
https://github.com/sanskrit-lexicon/csl-orig, licensed **CC BY-SA 4.0**.

Run it whenever the upstream digitisation is re-pulled; nothing at app runtime calls it::

    tools/build_apte_index.py                         # downloads ap.txt, writes app/data/
    tools/build_apte_index.py --src /path/to/ap.txt   # from a local checkout

**Why parse the raw ``.txt`` and not the TEI the C-SALT REST API serves.**  The API
(``api.c-salt.uni-koeln.de/dicts/ap90/restful``) is a *rendering* of the upstream text, and the
rendering is lossy in exactly the places this app needs: ``<ls>Ms. 12. 117</ls>`` — a literary
source, fenced as an element upstream — arrives as the bare words ``Ms. 12. 117`` inside a sense,
and ``{%<lex>m.</lex>%}`` — a word-class-and-gender statement — arrives as ``<hi rendition="#i">m.
</hi>``, i.e. as italics.  Reading the source text directly gets both back as markup.  (The API
also serves only AP90, Apte's *first* 1890 edition; AP 1957 has no REST endpoint at all — checked:
``/dicts/ap/restful/...`` 404s.)

**The upstream conventions this reads** (``v02/ap/ap-meta2.txt`` documents the brace forms; the
rest are inferred from the file and verified by count):

  ``<L>n<pc>PPPP-C<k1>hw<k2>hw[<h>n][<e>n]`` … ``<LEND>``   one record.  ``k1`` is the SLP1
      headword, ``pc`` the page-column of the printed scan, and ``e`` the entry LEVEL: ``1`` for a
      main entry, ``2`` for a compound filed under it.  The ``L`` number carries the same fact —
      ``17517`` (deva), ``17517.002`` (devaḥ), ``17517.004`` (devam) are three printed sections of
      ONE entry, while ``17517.266`` (devabhū) is a compound with a headword of its own.  That is
      why compounds cost nothing here and cost Monier-Williams everything (see app/apte.py).
      **Neither field can be trusted to tell the two apart** — ``e`` is ``2`` only where the base
      record also prints a ``━Comp.`` list, and ``L`` numbers the compounds of an entry without one
      exactly as it numbers sections (``15403.002`` is janmādhipa, a compound of janman).  See
      :func:`is_variant`, which is what the grouping actually decides on.
  ``{#…#}`` SLP1 Sanskrit · ``{%…%}`` italic · ``{@…@}`` bold — all closed within one line.
  ``<ls>…</ls>``  a literary source (68,273 of them) · ``<ab>…</ab>`` an abbreviation ·
      ``<lex>…</lex>`` a word-class label (30,184; only 22 distinct values) · ``<lang>…</lang>``.
  ``∙²n`` / ``∙³(a)``  a numbered sense / lettered sub-sense (91,503 + 1,186).
  ``━``  a section break: ``━{%<lex>m.</lex>%}`` opens the masculine senses, and
      ``.━{@<ab>Comp.</ab>@}:`` opens the compound list — which upstream is a bare list of SLP1
      headwords, each of which is its own ``<e>2`` record, so it is cut, not parsed.
  ``€n``  a verb root's conjugation class ("€1 <ab>P.</ab>") — the only mark a root entry carries.
  ``[…]``  etymology, and ``[PagePPPP-C]`` a page break.
  ``{{Lbody=X}}``  this record's body is record X's (9,620 of them; all resolve).
  ``{{old->new||date|author|url|}}``  an inline correction layer preserving the original reading —
      the NEW reading is what the dictionary now says, so that is what is kept.

**Output format** — one line per entry, so the loader is a `split`, not a parser::

    key ␟ key ␟ … ⇥ page ⇥ level ⇥ section ␝ section ␝ …
    section = "UPOS,Gender" ␞ sense ␞ sense ␞ …

``level`` is ``1`` for a main entry, ``2`` (or the 21 ``3``s) for a compound or a derivative filed
under another headword.  It starts from the upstream ``<e>`` and is CORRECTED where that is wrong —
see :func:`is_variant`, which is what stops ``janman``'s 35 compounds being merged into ``janman``.
It is written out because the fact is invisible once the record is flattened — a sub-entry's senses
read exactly like an ordinary entry's — and :func:`app.apte._local` needs it to prefer a main entry
over a sub-entry that merely happens to share its headword (299 keys do: ``svalpa`` is both its own
adjective entry and a "see s. v." stub filed under ``su``, and the stub used to be offered as two
senses of the word).  The column count is part of the contract with that loader: change it here and
change it there.

A DERIVATIVE is a sub-entry for the same reason a compound is.  Apte prints a word and the word
built on it under one headword whenever one definition serves both — ``aṭṭālaḥ, -lakaḥ``;
``adhigamaḥ, -manam``; ``kallaḥ`` "deaf" beside ``kallatā`` "deafness" — and this script used to read
a shared definition (``{{Lbody=<base L>}}``) as proof of a shared word and merge the two.  It is not:
the merge hid the derivative's headword inside the base's entry, gave the base senses that were never
its own, and wrote the shared senses into the file twice.  1,321 sub-records are now broken out,
1,024 of them by that channel and 169 by the ``_DERIV`` rule; 959 further entries, 190 keys stop
answering with a sense they had borrowed, and no key is lost.  A record with no senses of its OWN is
still merged, since breaking it out would take its headword out of the index altogether.

Verbs are keyed by the present 3rd singular as well as by the root: see :func:`present_forms` and
:func:`prefixed_forms`.  That is 4,420 further keys for 15 kB, and it is the only thing here that
adds a key rather than moving one.

(␟ = US 0x1f, ␝ = GS 0x1d, ␞ = RS 0x1e — control characters, so no escaping is needed: every
sense has already had control characters collapsed to spaces.)  Keys are folded with the same
homorganic-nasal rule :mod:`app.apte` folds its query with, so "aṅga"/"aṃga" meet on one key.
They are also SOLID and carry no editorial mark: a prefixed verb is keyed saMskaroti / anugacCati,
never saMs-karoti, because the junction sandhi has applied and Sanskrit writes the result as one
word; and no root marker ("√") is prefixed to a headword — the source text uses none either (0 in
its 18.5 MB, counted).  :func:`build` ASSERTS both rather than stripping them; see there for why.
Senses are kept as PROSE, not condensed into gloss units: condensing needs the SUD parser, and
doing it here would both bake a model into the data and cost far more than it saves — the flyout
condenses the handful of senses of the one word actually looked up.

Compressed with **lzma**, not gzip: measured on the real output, xz gives 1.80 MB against gzip's
2.46 MB and still decompresses in 0.08 s (stdlib, no dependency).  Excluding the 42,390 sub-entries
would save a further 0.86 MB and was rejected — it bought exactly 0 extra hits on the 116-lemma
brihat_jataka sweep, but Sanskrit treebanks that leave compounds unsplit lemmatise to precisely
those headwords, and 64,983 keys are reached by nothing else.

The build is byte-reproducible: two runs from the same ``ap.txt`` give the same file, and a rebuild
from the same source is a no-op.  (Verified again when :func:`is_variant` went in — reinstating the
old rule reproduced the previously vendored 1,780,164-byte file to the byte — and again when the
sub-entries were broken out and the verb forms added, at 1,795,672 bytes / 78,499 entries.)"""

from __future__ import annotations

import argparse
import collections
import lzma
import os
import re
import sys
import urllib.request

SRC_URL = "https://raw.githubusercontent.com/sanskrit-lexicon/csl-orig/master/v02/ap/ap.txt"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "app", "data", "apte1957.tsv.xz")

# The provenance line written at the top of the output.  CC BY-SA 4.0 requires the attribution to
# travel WITH the material, so it lives in the data file itself, not only in a README that a copy
# of the file could be separated from.  app.apte skips any line starting with "#" — safe, because
# every SLP1 headword is ASCII letters.
HEADER = ("#\tApte, The Practical Sanskrit-English Dictionary, revised ed. 1957 (Poona)."
          "\tDigitisation: Cologne Digital Sanskrit Dictionaries, sanskrit-lexicon/csl-orig v02/ap."
          "\tLicence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)."
          "\tBuilt by tools/build_apte_index.py — same licence.\n")

# ── the record envelope ───────────────────────────────────────────────────────────────────────
# <k2> is the headword AS PRINTED and may contain commas and spaces ("acApala, -lya"), so the
# fields are read as "everything up to the next tag", not as \S+.
_HDR = re.compile(r"^<L>(?P<L>[^<]*)<pc>(?P<pc>[^<]*)<k1>(?P<k1>[^<]*)<k2>(?P<k2>[^<]*)"
                  r"(?:<h>(?P<hom>[^<]*))?(?:<e>(?P<e>[^<]*))?$")

_XREF   = re.compile(r"\A\s*\{\{Lbody=(\S+?)\}\}\s*\Z")
_CORR   = re.compile(r"\{\{[^{}]*?->(?P<new>[^{}]*?)\|\|[^{}]*?\}\}")
_SLP    = re.compile(r"\{#.*?#\}", re.S)
_SLPRUN = re.compile(r"\{#(.*?)#\}", re.S)                   # …the same run, capturing (for the verb principal parts — see present_forms)
_CITE   = re.compile(r"<ls\b[^>]*>.*?</ls>", re.S)
_PAGE   = re.compile(r"\[Page[^\]]*\]")
_TAG    = re.compile(r"</?(?:ab|lang|ns|Poem|HS)\b[^>]*>")   # unwrapped, not dropped: "N. of Viṣṇu" and "(In gram.)" are gloss text
_LEXRUN = re.compile(r"\{%((?:\s*<lex>[^<]*</lex>\s*,?)+)%\}")   # "{%<lex>m.</lex>, <lex>f.</lex>%}" is one label, two genders
_LEX    = re.compile(r"<lex>([^<]*)</lex>")
_WRAP   = re.compile(r"\{[@%](.*?)[@%]\}", re.S)             # any surviving bold/italic run → its text
_BRACK  = re.compile(r"\[[^\[\]]*\]")
_COMP   = re.compile(r"\.?━\s*\{@\s*<ab>Comp\.</ab>\s*@\}")
# A record that ENDS by opening a section and printing nothing in it ("∙²2 Liberal. ━{%<lex>m.</lex>%}"
# — dātṛ, L 17157): the senses of that section are in the NEXT record, whatever headword upstream
# gave it.  21 records do this and 187 sub-records continue them; see build().
_OPENEND = re.compile(r"━\s*\{%[^%]*%\}\s*\Z")
# A verb root's header: its conjugation class ("€1", or "€1. €5." where the root takes two) plus
# the pada it is conjugated in ("P." parasmaipada / "Ā." ātmanepada / "U." both — 4,168 of the
# 4,175).  The whole header is the word-class label and none of it is a gloss, so the pada goes with
# the class marker; left behind, "P." became the first pickable "sense" of every root entry.
_VERBC  = re.compile(r"(?:€\s*\d+\.?\s*)+(?:<ab>\s*(?P<pada>P|Ā|U|Ātm|Par|cl|Den)\.\s*</ab>\s*)?")
# A present 3rd-singular: at least a syllable of stem plus "-ti"/"-te" (SLP1 writes the retroflex
# stop "w", so "dvezwi" and "Awe" end in "wi"/"we" and must count too).  It is the shape, not a
# lexicon, that identifies one — Apte prints the principal parts as a bare SLP1 run.
_FINITE = re.compile(r"[A-Za-z']{2,}[tw][ie]\Z")
_SENSE  = re.compile(r"∙[²³]")
_EMPTY  = re.compile(r"\(\s*[-−—–;:,.&]*\s*\)")   # "(  )" — what a parenthesised Sanskrit citation leaves behind
# …and what an UNparenthesised one leaves.  Apte introduces his Sanskrit examples with a connective
# ("A divine man, Brāhmaṇa, as in {#BUdeva#}."; "as {#saptANgam rAjyam#} see the words"), so
# removing the SLP1 run strands the connective as a clause of its own — and since app.apte._split
# starts a new gloss candidate at every semicolon and comma, each stranded one would be offered as
# a sense.  A clause is dropped when it OPENS with one of those connectives and contains nothing
# but connective/function words after it; requiring the opener is what keeps a genuine one-word
# gloss ("A word.", "Above.") — which would otherwise be all-stoplist — out of the net.
# Measured: 3,261 of 170,420 senses end in a bare one, before the mid-sense cases.
_OPENERS = r"as|see|cf|so|e\.\s?g|i\.\s?e|viz|&c|and"
_DANGLING = re.compile(r"(?i)\A(?:%s)\b[\s.]*"
                       r"(?:(?:%s|in|on|the|a|an|to|of|for|with|from|below|above|under|following|"
                       r"words?|this|that|these|those|it|them|there|here)\b[\s.]*)*\Z"
                       % (_OPENERS, _OPENERS))

# Apte's word-class labels → the UD/SUD UPOS tag, exactly the table app.apte uses on the live AP90
# path (kept in step deliberately: both paths feed one _pos_matches).  "_IND" is the pseudo-tag for
# "indeclinable", which UD splits across ADV/PART/CCONJ/SCONJ/ADP/INTJ.
_APTE_POS = {
    "a.": ("ADJ", None), "adj.": ("ADJ", None),
    "m.": ("NOUN", "Masc"), "masc.": ("NOUN", "Masc"),
    "f.": ("NOUN", "Fem"), "fem.": ("NOUN", "Fem"),
    "n.": ("NOUN", "Neut"), "s.": ("NOUN", None), "subst.": ("NOUN", None),
    "ind.": ("_IND", None), "indec.": ("_IND", None),
    "pron.": ("PRON", None), "pron. a.": ("PRON", None),
    "num.": ("NUM", None), "num. a.": ("NUM", None),
    "interj.": ("INTJ", None), "prep.": ("ADP", None),
    "adv.": ("ADV", None), "conj.": ("CCONJ", None), "part.": ("PART", None),
}
_END_GENDER = {"H": "Masc", "M": "Neut", "m": "Neut", "A": "Fem", "I": "Fem"}
_ANUSVARA = re.compile(r"N(?=[kKgG])|Y(?=[cCjJ])|R(?=[wWqQ])|n(?=[tTdD])|m(?=[pPbB])")

# What a sub-record's headword can add to its base's and still be the SAME word (see is_variant).
# _INFL is a citation ending — the nominative singular Apte cites a noun by, or the feminine stem he
# prints beside an adjective; _DERIV is a derivational suffix, which makes a NEW word.  Both sets are
# closed and taken from the file: these are the tails that actually occur on a dotted <e>1 record,
# counted (the top of the list runs -m 3,559 · -H 2,922 · -A 1,190 · -I 1,104 · nothing 281 · -ya 82
# · -in 74 · -ka 64).  Only a _DERIV tail ON TOP OF an _INFL one splits — a tail beside anything else
# is decided by the length test below, which is what keeps a feminine like aDirohin/aDirohiRI (base
# tail "n", not an inflectional ending) with its masculine.
_INFL  = frozenset({"", "H", "M", "m", "a", "A", "I", "am", "aH", "aM"})
_DERIV = frozenset({"ka", "kA", "kam", "aka", "ika", "ikA", "in", "ya", "yA",
                    "na", "nam", "ana", "la", "lu", "tA", "tva", "tvam", "va", "vam"})

# The Sanskrit preverbs, with the sandhi allomorphs a prefixed root's headword actually shows —
# "ud" appears as ut/un/uc/uj/ur/ul, "sam" as saM/saMs (saMskf) and "sa", "nis" as nir/niz/niH,
# and any of the i-final ones loses its vowel before another (aBy + A is written aByA, vy + A vyA,
# prati + i praty…).  Every prefixed form named in this file is written SOLID, comments included,
# because that is the only spelling that exists anywhere downstream: the preverb and the root have
# already undergone junction sandhi, the headwords upstream prints carry no hyphen (0 of the file's
# <k1> fields does), and neither do the keys emitted below — so a hyphenated spelling in a comment
# would describe a string that is nowhere in the data.  This set is not decoration: it is the filter that
# stops prefixed_forms splitting a headword at the wrong place.  Matching only "ends in a known
# root" would take Akram as Ak + ram; requiring the remainder to BE a preverb sequence rejects "Ak"
# and lets the longer root kram win.
_PREVERBS = frozenset("""ati aty atI aDi aDy anu anv anU antar antaH antas apa ap apA api apy
    aBi aBy aBI ava av avA A ud ut un uc uj ur ul upa up upA upo ni ny nI nis nir niz niH niS
    parA pari pary parI pariz pra pr prA pro prati praty pratI pratiz vi vy vI
    sam saM saMs saMz sa su sU sv dus dur duz duH dU""".split())
# The ruki/retroflex fold used ONLY to find the root inside a prefixed headword: a preverb ending in
# i/u retroflexes the root's initial s and the dental that follows it (sTA is written pratizWA under
# prati, while upasTA keeps its dentals), so the two spellings have to meet.  The 3sg is not folded
# back — tizWati already carries
# the retroflexion of its own reduplication, and pratitizWati / upatizWati are what Apte prints.
_RUKI = str.maketrans("zWwqQR", "sTtdDn")


def fold(headword: str) -> str:
    """The index key: a homorganic nasal before its stop collapsed to anusvāra.  AP 1957 spells
    these correctly ("aNga", "tantram") where AP90 always wrote anusvāra ("aMga", "taMtraM"), and a
    treebank lemma may be written either way — folding both sides makes the difference invisible.
    Lossless in practice: the nasal is fully predictable from the following stop, so no two
    distinct headwords can collide under it."""
    return _ANUSVARA.sub("M", headword)


def is_variant(base: str, sub: str) -> bool:
    """Whether the dotted record headed by ``sub`` is another printed SECTION of the entry headed by
    ``base`` — the neuter beside the masculine, an alternative spelling, a derived stem — as opposed
    to a COMPOUND filed under it.  Only sections may be merged into the base entry's sense list; a
    compound is a word of its own and its senses are not senses of the base.

    Upstream ``<e>`` is supposed to say this (``1`` = main entry, ``2`` = compound) and cannot be
    trusted to: it is right wherever the base record also prints a ``━Comp.`` list (4,454 of the
    4,461 groups holding an ``<e>2``) and wrong wherever that list is missing — ``janman`` (L 15403)
    has no ``━Comp.`` line and files all 35 of its compounds, ``janmADipaH`` "an epithet of Śiva"
    included, as ``<e>1`` sub-records of L 15403.  Merging by L number alone therefore poured those
    35 compounds into ``janman``'s own entry, and keyed the merge under every one of their
    headwords: a lookup of ``janman`` answered with 61 senses instead of 26, and a lookup of
    ``janmādhipa`` answered with the same 61.

    The test is on the two headwords, and it is what the printed convention already means.  Both
    kinds are written the same way in the source (``{#janman#} + .{@{#-aDipaH#}@}``,
    ``{#deva#} + .{@{#-vaH#}@}``), but a SECTION re-spells the base's own tail — ``deva`` → ``devaH``,
    ``aMSakaH`` → ``aMSakam``, ``aMSumat`` → ``aMSumAn`` — so past the two headwords' common prefix
    the two remainders are about the same length, whereas a COMPOUND appends a whole second member
    and its remainder is materially longer: ``janman``/``janmADipaH`` share only ``janm`` and then
    run ``an`` against ``ADipaH``.  Hence: a variant iff the sub's remainder is at most two
    characters (an inflectional ending: ``-H``, ``-m``, ``-I``) or is no more than one character
    longer than the base's.  :func:`build` checks three cheaper, certain things first, so this decides
    only what they leave: of the 12,864 dotted ``<e>1`` records, 247 are sections because the base
    prints no senses to leak into, 21 because the base breaks off having opened a section it prints
    nothing in, and 37 because the sub-record prints no senses of its own; this test then keeps
    11,238 as sections (every one of ``deva``'s, ``aMSumat``'s, ``arcanIya``'s) and splits 1,321 off
    (all 35 of ``janman``'s compounds, ``aMhas``/``aMhomuc``, ``agada``/``agadarAjaH``,
    ``agnIzomIya``/``agnIzomIyapaSuH``, and the derivatives — ``awwAlaH``/``awwAlakaH``,
    ``aDigamaH``/``aDigamanam``, ``kalla``/``kallatA``).  The pairs it splits that gloss identically
    (``navatA``/``navatvam``, ``anukarzaH``/``anukarzaRam``) are distinct headwords all the same, and
    each still answers under its own key, so nothing readable is lost.  Over the whole file the split
    now costs 0 keys, measured against merging every dotted ``<e>1`` record: it used to cost 5
    (``janmeSa``, ``ajYAnaparIkzA``, ``atyarTakrudDa`` …), all of them bare cross-references ("= 2
    {#janmADipa#}", "See {#ajYAtavastuSAstra#}", "&c.") that produced an empty group once split off
    and were dropped, and the "no senses of its own" guard in :func:`build` now keeps them merged.

    A DERIVATIVE is split off for the same reason a compound is, and needs a test of its own: it is
    short enough to slip through the length rule (``atandra``/``atandrin``, ``acApala``/``acApalya``,
    ``aDidevaH``/``aDidevatA``, ``anavalamba``/``anavalambana`` all differ by two characters or
    fewer) but ``-in``/``-ya``/``-tA``/``-ana`` build a NEW word, whose senses are not the base's.
    Hence the ``_DERIV``-on-top-of-``_INFL`` check, which fires only where the base's own tail is a
    citation ending, so a feminine formed on a consonant stem (``aDirohin``/``aDirohiRI``, base tail
    "n") is not mistaken for one.  Measured: it splits 169 records the length rule alone kept."""
    n = 0
    while n < len(base) and n < len(sub) and base[n] == sub[n]:
        n += 1
    b_tail, s_tail = base[n:], sub[n:]
    if s_tail in _DERIV and b_tail in _INFL:
        return False
    return len(s_tail) <= 2 or len(s_tail) - len(b_tail) <= 1


# ── verbs: the forms a treebank lemma may actually be written in ───────────────────────────────

def present_forms(body: str) -> list[tuple[str, list[str]]]:
    """``[(pada, [present 3sg, …]), …]``, one item per conjugation-class section of a verb record.

    Apte states a root's class and pada with the ``€n`` mark and then prints its principal parts as a
    parenthesised SLP1 run whose FIRST comma-group is the present — ``{#gacCati, jagAma, agamat, …#}``
    for ``gam``, ``{#Bavati, baBUva, …#}`` for ``BU``.  That run is the only place the 3rd singular
    appears, and :func:`sections` deletes it (``_SLP``) along with every other Sanskrit run, because
    an SLP1 citation is no use as an English gloss.  It is read here BEFORE that happens, since the
    3sg is what a Sanskrit treebank routinely lemmatises a verb to — 1,509 of the 3,546 verb records
    carry one, and until now not one of them was reachable by it.

    Read to the next sense (``∙``), section break (``━``) or ``€`` header rather than to the closing
    parenthesis: ``BU``'s class-1 header is followed by an aside, ``€1 <ab>P.</ab> (rarely
    <ab>Ā.</ab>) ({#Bavati, …#})``, so the FIRST parenthesis holds no forms at all, and ``sTA``'s
    holds prose before them (``(<ab>Ātm.</ab> also in certain senses; {#tizWatite, …#})``).  Taking
    the first SLP1 run in the section instead gets both, and cannot run into the senses — the senses
    are where an unrelated citation would first appear, and they are one of the three stops.

    Two of Apte's printing conventions are undone here.  ``{#varDayati-te#}`` is an ELLIPSIS — the
    ātmanepada written as its ending alone — so it yields varDayati AND varDayate, never a form
    "te"; a full second form (``{#karoti-kurute#}``) is taken as printed.  And ``{#tizWatite#}``
    (the root sTA) is that same pair with the hyphen dropped in the digitisation, recognised by the
    head still being a finite form once "te" comes off: 15 records spell it that way, and sTA — one of
    the commonest verbs in the language — is one of them."""
    out: list[tuple[str, list[str]]] = []
    heads = list(_VERBC.finditer(body))
    for i, m in enumerate(heads):
        stop = len(body)
        for ch in ("∙", "━"):
            j = body.find(ch, m.end())
            if j >= 0:
                stop = min(stop, j)
        if i + 1 < len(heads):
            stop = min(stop, heads[i + 1].start())
        run = _SLPRUN.search(body, m.end(), stop)
        if not run:
            continue
        parts = [p.strip() for p in run.group(1).replace("\n", " ").split(",")[0].split("-")]
        head = parts[0]
        if not re.fullmatch(r"[A-Za-z']+", head or ""):
            continue
        if head.endswith("te") and _FINITE.match(head[:-2]):   # "tizWatite" — the hyphen of "tizWati-te" lost in the digitisation
            head, parts = head[:-2], [head[:-2], "te"]
        if not _FINITE.match(head):
            continue                                           # …not a present at all: the root i prints only "{#iR#}", its gaṇa label
        forms = [head]
        for p in parts[1:]:
            if not re.fullmatch(r"[A-Za-z']+", p or ""):
                continue
            if p in ("ti", "te"):
                forms.append(head[:-2] + p)                    # the ellipsis: "varDayati-te" is varDayati / varDayate
            elif _FINITE.match(p):
                forms.append(p)                                # a full second form: "karoti-kurute"
        out.append((m.group("pada") or "", forms))
    return out


def _is_preverb_run(s: str) -> bool:
    """Whether ``s`` is a sequence of preverbs — "anu", "saMpra", "aByA" (aBy + A), "vini"."""
    if not s:
        return False
    for n in range(len(s), 0, -1):     # longest first, so "prati" is not read as "pra" + "ti"
        if s[:n] in _PREVERBS and (n == len(s) or _is_preverb_run(s[n:])):
            return True
    return False


def prefixed_forms(head: str, pada: str, roots: dict[str, list[str]]) -> list[str]:
    """The present 3sg of a PREFIXED verb whose own record prints no principal parts.  Apte files
    ``anugam``, ``Agam``, ``saMskf``, ``upasTA`` as records of their own — they are already separate
    entries here, which is why nothing has to be broken out for them — but repeats the parts only in
    the root's article: ``anugam`` reads "€1 <ab>P.</ab>" and then goes straight to its senses.
    1,608 of the 2,037 such records resolve; the residue is roots that print no present anywhere
    (aj, aṭṭ) and the vowel-sandhi prefixings (``aDI`` = adhi + i, ``apekz`` = apa + īkṣ), whose
    root has no present to lend either.

    Built by SUBSTITUTION INTO THE HEADWORD, not by prefix + root: the headword already carries the
    junction sandhi, so cutting the root's spelling off the end of it and putting the root's present
    in its place gives saMskaroti (saMskf, less its final kf, plus karoti), pratitizWati (pratizWA
    less zWA plus tizWati) and uttizWati (utTA less TA plus tizWati) — solid, which is both how
    Sanskrit writes a prefixed verb and how it is keyed below; the cut is named in prose here rather
    than drawn with a hyphen precisely because no hyphenated form exists in the index to point at.
    Concatenating the preverb with the root instead would give saMkaroti and
    pratisTizWati.  The cut tolerates the retroflexion (``_RUKI``) and the loss of the root's initial
    s that the junction imposes, and takes the LONGEST root that leaves a valid preverb run behind.

    The pada the prefixed record declares is respected, since it is often not the root's: ``saMgam``
    is Ātmanepada where ``gam`` is Parasmaipada, and saṃgacchate is the form.  Where the root printed
    only the other voice the ending is swapped — but only on a THEMATIC form ("-ati"/"-ate"), where
    the swap is regular; gacCati → gacCate is right, bravIti → brUte is not, and an athematic root
    that really takes both voices prints both (karoti-kurute), so nothing needs inventing."""
    folded = head.translate(_RUKI)
    for cut in range(1, len(folded)):                     # ascending cut = descending root length: the longest root first
        tail, pre = folded[cut:], folded[:cut]
        for root in (tail, "s" + tail):                   # "s" + tail: ud + sTA is printed utTA, the root's initial s gone
            if root in roots and _is_preverb_run(pre):
                want = "te" if pada in ("Ā", "Ātm") else "ti" if pada in ("P", "Par") else ""
                out = []
                for form in roots[root]:
                    if want and form.endswith(("ati", "ate")) and not form.endswith(want):
                        form = form[:-2] + want
                    out.append(head[:cut] + form)
                return out
    return []


def verb_keys(head: str, body: str, roots: dict[str, list[str]]) -> list[str]:
    """The extra index keys a verb record earns: its own present 3sg forms where it prints them, and
    the ones derived from its root where it does not.  The root spelling stays a key — it is the
    headword — so both reach the entry, which is the point: a Sanskrit treebank lemmatises a verb to
    the root under one convention and to the present 3rd singular under another, and until now only
    whichever of the two Apte happened to print as the headword answered."""
    own = present_forms(body)
    if own:
        return [f for _, forms in own for f in forms]
    m = _VERBC.search(body[:200])
    return prefixed_forms(head, m.group("pada") or "", roots) if m else []


def records(path: str):
    """``(header dict, body text)`` per ``<L>…<LEND>`` record, in file order."""
    cur: list[str] | None = None
    hdr: dict | None = None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("<L>"):
                m = _HDR.match(line)
                if not m:
                    print(f"skipped unparseable header: {line}", file=sys.stderr)
                    hdr = cur = None
                    continue
                hdr = m.groupdict()
                hdr["e"] = hdr["e"] or "1"
                cur = []
            elif line.startswith("<LEND>"):
                if cur is not None and hdr:
                    yield hdr, "\n".join(cur)
                hdr = cur = None
            elif cur is not None:
                cur.append(line)


def _lex_to_pos(run: str):
    """A ``<lex>`` run → ``(UPOS, gender or None)``, or None if none of it is a known label.
    A run keeps the FIRST label's word class and only keeps a gender if every member agrees, so
    "m., f." lands as a NOUN of unstated gender rather than an invented one."""
    labels = [p.strip().lower() for p in _LEX.findall(run) if p.strip()]
    known = [_APTE_POS[p] for p in labels if p in _APTE_POS]
    if not known:
        return None
    genders = {g for _, g in known}
    return known[0][0], (genders.pop() if len(genders) == 1 else None)


def _tidy(seg: str) -> str:
    """One sense's prose after the markup has been taken out.  Removing an ``<ls>`` or a ``{#…#}``
    leaves its punctuation stranded ("Divine, celestial; ; ."), so the leftovers are swept up here
    rather than being left for the flyout to show as empty senses."""
    seg = _EMPTY.sub(" ", seg)
    seg = re.sub(r"[\x00-\x1f]", " ", seg)      # the output format's own separators are control characters — nothing else may be one
    seg = re.sub(r"\s+", " ", seg)
    seg = re.sub(r"(?:\s*[;:,]\s*){2,}", "; ", seg)
    seg = re.sub(r"\s+([;:,.])", r"\1", seg)
    seg = re.sub(r"([;:,])(?=\S)", r"\1 ", seg)
    seg = re.sub(r"(?:\s*[;:,]\s*)+\.", ".", seg)
    seg = re.sub(r"\.\s*(?:\.\s*)+", ". ", seg)   # "An organ of sense.." — the sense's own stop plus the one the citation carried
    # Split on the same punctuation app.apte._split will, drop the clauses that are now nothing but
    # a stranded connective, and put the rest back with the separator each clause was followed by.
    parts = re.split(r"([;,])", seg)
    kept: list[str] = []
    for i in range(0, len(parts), 2):
        clause = parts[i].strip(" .")
        if clause and not _DANGLING.match(clause):
            kept.append(parts[i].strip() + (parts[i + 1] if i + 1 < len(parts) else ""))
    seg = re.sub(r"\s+", " ", " ".join(kept))
    # The same stranding one sentence later ("A name for the position of stars. See."): a full stop
    # is not a clause boundary above, because Apte's abbreviations are full of them.
    seg = re.sub(r"(?i)[\s.]*\b(?:see|cf\.|also see|and see)\s*\.?\s*\Z", ".", seg)
    return seg.strip(" ;:,·—–−")


def sections(hdr: dict, body: str, xrefs: dict[str, str]) -> list[tuple[str, str, str]]:
    """One record → ``[(upos, gender, sense prose), …]`` in printed order."""
    m = _XREF.match(body)
    if m:
        body = xrefs.get(m.group(1), "")
    body = _CORR.sub(lambda mm: mm.group("new"), body)
    body = _COMP.split(body)[0]          # everything from "━Comp.:" on is a list of OTHER headwords
    cut = body.find("¦")                 # the headword itself, repeated before the broken bar
    if cut >= 0:
        body = body[cut + 1:]
    body = _CITE.sub(" ", body)          # ← the win over the REST API: citations leave as ELEMENTS
    body = _SLP.sub(" ", body)           # SLP1 Sanskrit: unreadable as an English gloss
    body = _PAGE.sub(" ", body)

    head = hdr["k1"]
    gender = _END_GENDER.get(head[-1:]) if head else None
    # A headword cited WITH its nominative ending ("gajaH", "tantram", "senA") is a noun, and that
    # ending IS its gender — Apte prints no <lex> in that case, which is why gender coverage does
    # not collapse to the 33 % of records that carry one.
    pos = "NOUN" if gender else ""
    if _VERBC.search(body[:200]):
        pos, gender = "VERB", None
    body = _VERBC.sub(" ", body)

    out: list[tuple[str, str, str]] = []
    for chunk in re.split("━", body):
        lab = _LEXRUN.search(chunk[:80])   # a <lex> run OPENS a section; one buried mid-sense is an aside about a related form, not a heading
        if lab:
            got = _lex_to_pos(lab.group(1))
            if got:
                pos, gender = got
            chunk = chunk[:lab.start()] + " " + chunk[lab.end():]
        for seg in _SENSE.split(chunk):
            seg = _LEXRUN.sub(" ", seg)
            seg = _TAG.sub(" ", seg)
            seg = _WRAP.sub(r"\1", seg)
            seg = _BRACK.sub(" ", seg)
            seg = re.sub(r"\A\s*(?:\d+|\([a-z]\))\s*", " ", seg)   # the number/letter the ∙²/∙³ marker introduced
            seg = _tidy(seg)
            if seg and re.search(r"[A-Za-z]", seg):
                out.append((pos, gender or "", seg))
    return out


def _runs(secs):
    """Consecutive senses sharing one (upos, gender) → one output section, so the label is written
    once per run rather than once per sense."""
    out: list[tuple[tuple[str, str], list[str]]] = []
    for pos, gender, sense in secs:
        if out and out[-1][0] == (pos, gender):
            out[-1][1].append(sense)
        else:
            out.append(((pos, gender), [sense]))
    return out


def build(src: str, dst: str) -> None:
    rs = list(records(src))
    xrefs = {h["L"]: b for h, b in rs}
    own = {h["L"]: sections(h, b, xrefs) for h, b in rs}   # each record's OWN senses, computed once: the grouping below needs them before it can decide anything, and they are what every group is then assembled from

    # The root → present-3sg table prefixed_forms() reads.  Built in a pass of its own because a
    # prefixed record may precede its root in the file (the prefixings of aj are filed under the
    # letter a and the root itself under j), so it cannot be filled in as the grouping goes.  First
    # writer wins, which is the verb record: the root gam has a noun homonym ("gam, a song",
    # L 13731.006) that prints no €n at all.
    roots: dict[str, list[str]] = {}
    for hdr, body in rs:
        forms = [f for _, fs in present_forms(body) for f in fs]
        if forms:
            roots.setdefault(hdr["k1"], forms)

    groups: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
    for hdr, body in rs:
        # <e>1 records sharing a base L number are ONE printed entry split by gender ("deva" the
        # adjective, "devaH" the masculine, "devam" the neuter); <e>2 records are compounds and
        # each stands alone.  Merging the first kind is what makes a bare stem lemma answer with
        # the noun senses too, without the live path's three-request prefix sweep.
        # …but only where the sub-record really IS another section of the same word: upstream marks
        # a compound <e>2 only when the base record also prints a ━Comp. list, so entries without one
        # (janman, L 15403) file their compounds as <e>1 sub-records and merging by L number alone
        # swallowed them whole.  is_variant() is the test; see its docstring for the measurement.
        level = hdr["e"]
        gid = hdr["L"].split(".")[0] if level == "1" else hdr["L"]
        if level == "1" and gid != hdr["L"]:
            base = groups.get(gid)
            # A "{{Lbody=<the base record's own L>}}" sub-record — this one's body IS the base
            # entry's — used to skip the headword test outright, on the reasoning that a shared gloss
            # means a shared word.  It does not: Apte prints ONE definition for a word and the word
            # built on it wherever both mean the same thing, so the bypass carried awwAlaH/awwAlakaH,
            # aDigamaH/aDigamanam, aDikAritA/aDikAritvam, aNgulIyam/aNgulIyakam.  4,077 records took
            # it; 1,024 of them fail the headword test and are now broken out, each still carrying
            # the shared body because sections() resolves the xref wherever the record lands — so
            # nothing is lost, the pair answers as two words, and 1,634 senses stop being written
            # into the file twice.  (A body shared with a SIBLING record, Lbody=29.004, never
            # qualified anyway: two compounds can share one gloss, "aMhuBeda"/"aMhuBedI", and neither
            # is the base.)
            #
            # Three cheaper, certain things are checked before the headword test.  `base["secs"]`
            # empty means the base record prints NO senses of its own, so the entry is nothing but
            # its sections and splitting them off would leave the headword answering nothing at all
            # ("trEvarRa", "AmaraRAnta", whose only gloss sits in the feminine section); such a base
            # has nothing to leak INTO, so this cannot let a janman back in.  `own[…]` empty is the
            # mirror of it: a sub-record with no senses of its own is a bare pointer to the base, and
            # breaking it out would take its headword out of the index altogether.  And
            # `base["openend"]` means the base breaks off mid-entry, having opened a gender section
            # and printed nothing in it: this record IS that section, and its headword is no guide.
            # dātṛ ends "∙²2 Liberal. ━{%<lex>m.</lex>%}" and the masculine senses ("A giver", "A
            # donor", "A lender", "A teacher") arrive under the headword dAtftA — a -tA abstract noun
            # by its spelling, so both the length rule and the _DERIV rule would split them off and
            # leave dātṛ answering with the adjective alone.  21 bases print this way (aDikArin,
            # aDizWAtf, arus, arcin, avayavin, Amodin …), all of them agent or possessive stems whose
            # masculine is filed separately, and 187 sub-records continue one.
            # Of the 12,864 dotted <e>1 records the three take 247 / 37 / 21, and is_variant() then
            # keeps 11,238 as sections and splits 1,321 off.
            if base is not None and not base["openend"] and base["secs"] and own[hdr["L"]] \
                    and not is_variant(base["keys"][0], hdr["k1"]):   # keys[0] is the undotted record's own headword — it always precedes its sub-records in file order (checked: 0 of the 12,864 dotted records has no undotted base)
                gid, level = hdr["L"], "2"
        g = groups.setdefault(gid,{"keys": [], "pc": hdr["pc"], "e": level, "secs": [], "verb": [], "openend": False})   # `e` is the group's own level; a group never mixes levels (checked: 0 of the 90,845 records lands in a group of another level), precisely because the gid rule above splits on it
        if hdr["k1"] not in g["keys"]:
            g["keys"].append(hdr["k1"])
        g["verb"].extend(verb_keys(hdr["k1"], body, roots))
        g["secs"].extend(own[hdr["L"]])
        g["openend"] = bool(_OPENEND.search(body.rstrip()))   # …carried from the LAST record in the group, so a run of continuations (a base that opens a section, a sub-record that opens another) stays together while an ordinary record closes the run

    # A key is a WORD, never a segmentation of one: a prefixed verb is keyed solid (saMskaroti,
    # anugacCati, uttizWati — see prefixed_forms), and no headword carries the root marker "√" a
    # grammar prefixes to a citation root.  Both hold today by construction and by source — the
    # emitting paths concatenate (prefixed_forms) or split ON the hyphen (present_forms), and of
    # ap.txt's 18.5 MB not one <k1> field holds a hyphen and not one byte is that marker (counted) —
    # so this is a GUARD, not a strip.  Stripping would be dead code quietly absorbing a change in upstream's
    # conventions; this fails the build and names the key, and it runs before the output file is
    # opened, so a failure leaves the vendored index untouched rather than truncated.  Deliberately
    # narrower than "SLP1 letters only": one key, "arI|a", carries a stray "|" from a {{…||…}}
    # correction the _CORR regex does not reach (38 senses keep a bare "->" from the same gap) — a
    # separate upstream artefact, not an editorial mark on a headword, and not what this is about.
    marked = sorted({k for g in groups.values() for k in g["keys"] + g["verb"] if "-" in k or "√" in k})
    if marked:
        raise SystemExit(f"{len(marked)} key(s) carry an editorial mark and are unreachable as "
                         f"written: {marked[:10]}")

    n_entries = n_senses = 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with lzma.open(dst, "wt", encoding="utf-8", preset=6) as fh:
        fh.write(HEADER)
        for g in groups.values():
            if not g["secs"]:
                continue
            keys = list(g["keys"])
            for k in list(keys):
                # …plus the bare stem of any citation form, since a treebank lemma is the stem:
                # "gajaH" also answers to "gaja".  Only H/M/m are stripped — the ā-/ī-stem endings
                # ARE the lemma ("senā", "devī"), so stripping those would break the direct hit.
                if k[-1:] in ("H", "M", "m") and k[:-1] and k[:-1] not in keys:
                    keys.append(k[:-1])
            keys += [k for k in g["verb"] if k not in keys]   # …and, for a verb, its present 3rd singular beside its root (see verb_keys). Appended AFTER the stems, so a verb form is never itself stem-stripped: it ends in -ti/-te, which the loop above does not touch, but the order also keeps the file's key column stable if that ever changes
            seen: set[str] = set()
            keys = [k for k in (fold(k) for k in keys) if not (k in seen or seen.add(k))]
            body = "\x1d".join(f"{pos},{gender}\x1e" + "\x1e".join(senses)
                               for (pos, gender), senses in _runs(g["secs"]))
            fh.write("\x1f".join(keys) + "\t" + g["pc"].split("-")[0] + "\t" + g["e"] + "\t" + body + "\n")
            n_entries += 1
            n_senses += len(g["secs"])
    print(f"{dst}: {n_entries:,} entries, {n_senses:,} senses, "
          f"{os.path.getsize(dst) / 1e6:.2f} MB from {os.path.getsize(src) / 1e6:.1f} MB of source")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", help=f"local ap.txt (default: download {SRC_URL})")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    src = args.src
    tmp = None
    if not src:
        # Downloaded to a temp dir, never next to the output: app/data/ is copied wholesale into the
        # bundle by packaging/make_*.sh, so an interrupted run there would ship an 18 MB stray file.
        import tempfile
        tmp = os.path.join(tempfile.mkdtemp(prefix="apte-"), "ap.txt")
        print(f"downloading {SRC_URL} …")
        urllib.request.urlretrieve(SRC_URL, tmp)
        src = tmp
    try:
        build(src, args.out)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
            os.rmdir(os.path.dirname(tmp))


if __name__ == "__main__":
    main()
