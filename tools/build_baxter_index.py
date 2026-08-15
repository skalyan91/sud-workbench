#!/usr/bin/env python3
"""Build ``app/data/baxter_sagart.tsv`` — the vendored Middle Chinese / Old Chinese table
:mod:`app.translit` reads — from the wikitext of

    Wiktionary, *Appendix:Baxter-Sagart Old Chinese reconstruction*
    https://en.wiktionary.org/wiki/Appendix:Baxter-Sagart_Old_Chinese_reconstruction

which tabulates Baxter, W. and L. Sagart (n.d.), *Baxter-Sagart Old Chinese reconstruction*
(Version 1.00), together with data from the Unicode Unihan Database.  Wiktionary text is
**CC BY-SA 4.0**; the attribution rides in the output file's own header, because a copy of that
file can be separated from this repository and the licence travels with the material.

Run it whenever the appendix is re-pulled; nothing at app runtime calls it::

    tools/build_baxter_index.py --retrieved 2026-08-01               # downloads the wikitext
    tools/build_baxter_index.py --retrieved 2026-08-01 --src bs_raw.txt   # from a saved copy

``--retrieved`` is REQUIRED and is not defaulted from the clock: the date goes into the output
header, so reading it off ``date.today()`` would make two builds of the same input differ.  With
that supplied the build is byte-reproducible — verified by running it twice and diffing.

**Why this script exists.**  The table it replaces was vendored by hand and had no build script,
and the hand vendoring COLLAPSED A WORD LIST INTO A CHARACTER LIST: the appendix is one row per
*word* — 4,082 of them — and the vendored file kept one row per *graph*, 4,330 of them, by taking
each graph's first-listed entry and discarding the rest.  What that threw away is exactly the
information a treebank needs, because Old Chinese derivation is largely by tone and voicing and
the discarded rows are the DERIVED WORDS: 547 graphs have more than one Middle Chinese reading,
312 more than one Mandarin reading, 783 more than one entry.  數 is *s-roʔ-s* "number (n.)",
*s-roʔ* "count (v.)" and *s-rok* "frequently"; the vendored file knew only the first.  It also
dropped the gloss, which is the only thing in the source that says WHICH reading is which — hence
the ``pos`` column below.

**The source's shape.**  The page is one ``{| class="wikitable sortable"`` table whose rows are
separated by ``|-`` and whose every entry is exactly NINE cell lines, in order::

    TC · SC · PY · MC · MCI · MCF · MCT · OC · Gloss

MCI/MCF/MCT are Baxter's Middle Chinese initial, final and tone, each recoverable from MC itself,
so they are read and dropped.  Every cell opens with a HIDDEN ASCII SORT KEY —
``<span style=display:none>ai1 </span>[[āi#Mandarin|āi]]`` — which is *not* the reading and must
come off; leaving it in would key the table under "ai1āi".  The OC cell additionally arrives with
its braces and brackets as NUMERIC HTML ENTITIES (``&#123;``/``&#91;``), because they would
otherwise be read as wiki template and link syntax.

**The OC field is written out VERBATIM** (entity-decoded, nothing else).  ``*rˁawk {*[rˁ]awk}``
keeps its ``{…}`` annex, ``*p.rəŋ (dial. › *prəŋ)`` its editorial note, ``*dzˁen ~ *m-dzˁen`` both
of its variants: all three are Baxter–Sagart's own notation for how certain a reconstruction is
and which parts of it are, and a data file is the wrong place to decide they are noise.  What to
SHOW of that is the consumer's decision and is made in :mod:`app.translit` (see
``_baxter_display``, which drops the ``{…}`` annex for the one-form-wide transliteration cell, and
``_baxter_variants``, which splits the ``~``).  Cross-checked against the file this replaces: with
the annex off, 4,228 of its 4,330 rows reproduce byte-for-byte, and the 102 that do not are ones
where the hand vendoring silently dropped a parenthesised note or a second ``~`` variant.

**The ``pos`` column** is a UD UPOS tag INFERRED FROM THE GLOSS, or EMPTY.  Empty means "this
gloss licenses no tag", not "untagged by oversight", and it is the answer wherever the inference
would be a guess — see :func:`infer_pos`, which is deliberately made of explicit source markers
and English grammatical frames and holds no lexicon of English content words.  The consumer
REORDERS by this column and never filters on it (``app.translit._pos_render``), so a tag that is
wrong costs an ordering and a tag that is missing costs nothing.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
import urllib.request

SRC_URL = ("https://en.wiktionary.org/wiki/"
           "Appendix:Baxter-Sagart_Old_Chinese_reconstruction?action=raw")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "app", "data", "baxter_sagart.tsv")

# Wikimedia rejects the stdlib default UA outright, so a real one is required for the fetch.
_UA = "sud-workbench build_baxter_index.py (https://github.com/skalyan91/sud-workbench)"

_CELLS = 9   # TC SC PY MC MCI MCF MCT OC Gloss — a run of any other length is not an entry

# One cell's wiki markup → its DISPLAY text.
_ATTR = re.compile(r"^(?:lang=[\w-]+|class=IPA)\|")          # the cell attribute the generator emits
_SORT = re.compile(r"<span style=display:none>.*?</span>")   # the hidden ASCII sort key — NOT the reading
_PIPED = re.compile(r"\[\[[^\]|]*\|([^\]]*)\]\]")            # [[āi#Mandarin|āi]] → āi
_LINK = re.compile(r"\[\[([^\]]*)\]\]")                      # [[埃]] → 埃
_TAG = re.compile(r"<[^>]+>")


def clean(cell: str) -> str:
    """One ``|``-prefixed wikitext cell → the string the page displays.

    ``html.unescape`` LAST and unconditionally: the OC column encodes its braces and brackets as
    ``&#123;``/``&#91;`` (they are wiki syntax otherwise), and the PY column's own links carry
    ``&#39;`` for the apostrophe of a syllable like ``ān'ér``.  Unescaping before the link and tag
    passes would turn an encoded bracket back into ``[[``-looking text for them to eat."""
    c = cell[1:]
    c = _ATTR.sub("", c)
    c = _SORT.sub("", c)
    c = _PIPED.sub(r"\1", c)
    c = _LINK.sub(r"\1", c)
    c = _TAG.sub("", c)
    return html.unescape(c).strip()


def entries(raw: str) -> list[tuple[str, ...]]:
    """``(TC, SC, PY, MC, OC, gloss)`` per table row, in source order.

    A row is accumulated between ``|-`` separators and accepted only when it holds exactly
    :data:`_CELLS` cell lines, which is what tells an entry from the ``!``-prefixed header row and
    from the page's prose.  A run that OVERRUNS nine lines is discarded as it overruns rather than
    at the next separator, so a malformed row cannot absorb the one after it."""
    rows: list[list[str]] = []
    cur: list[str] = []
    for line in raw.splitlines():
        if line.startswith("|-"):
            if len(cur) == _CELLS:
                rows.append(cur)
            cur = []
        elif line.startswith("|"):
            cur.append(line)
        if len(cur) > _CELLS:
            cur = []
    if len(cur) == _CELLS:       # the last row of the table is closed by |} , not by |-
        rows.append(cur)
    out = []
    for r in rows:
        tc, sc, py, mc, _mci, _mcf, _mct, oc, gloss = (clean(x) for x in r)
        if tc:
            out.append((tc, sc, py, mc, oc, gloss))
    return out


# ── the gloss → UPOS inference ────────────────────────────────────────────────────────────────
# TIER 1: an explicit word-class marker the source itself prints, parenthesised.  These are the
# abbreviations that actually occur, counted over the 4,082 glosses: (v.) 227, (n.) 96, (v.t.) 15,
# (adj.) 14, (v.i.) 6, and single-figure counts of the rest.  Matched on the LEADING token of a
# parenthesised run, so "(v., of a mountain)" and "(adv. suffix)" are read as the class they name.
_MARKERS: dict[str, str] = {
    "v": "VERB", "vt": "VERB", "vi": "VERB", "v.t": "VERB", "v.i": "VERB",
    "tr": "VERB", "intr": "VERB", "transitive": "VERB", "intransitive": "VERB",
    "n": "NOUN", "subst": "NOUN",
    "adj": "ADJ", "a": "ADJ",
    "adv": "ADV", "adverb": "ADV",
    "particle": "PART", "part": "PART",
    "num": "NUM", "pron": "PRON", "prep": "ADP", "conj": "CCONJ", "interj": "INTJ",
}
# The leading token of a paren run: letters and the internal dots of "v.t." / "v.i.", up to the
# first space or comma.  "adj., v." therefore yields BOTH classes and is caught by the
# disagreement test in infer_pos rather than silently resolving to whichever came first.
_MARK_TOKEN = re.compile(r"[a-z]+(?:\.[a-z]+)*\.?")
_PARENS = re.compile(r"\(([^()]*)\)")

# TIER 2: English grammatical FRAMES.  Each is a frame and not a lexical judgement — it reads a
# closed-class English word (an infinitive marker, a determiner, the copula) or a noun-forming
# derivational suffix, never a decision about what part of speech an English content word is.
# Applied to the FIRST CLAUSE of the gloss (up to the first ";"), which is the primary sense:
# "to pity; sad" is glossing a verb that is also used statively, and the verb is what it leads with.
_NAME = re.compile(r"""(?ix) ^ (?: name \s+ (?:of|for) \b
                                 | (?:a \s+)? (?: place | personal | family | clan | country
                                                | state | river | dynasty | tribe ) [-\s]? name \b
                                 | (?:a \s+)? sur ?name \b ) """)
_TO = re.compile(r"(?i)^to\s+\w")           # the English infinitive marker: 126 glosses
_BE = re.compile(r"(?i)^be\s+\w")           # a copular predicate — "be king", "be present": 16
_DET = re.compile(r"(?i)^(?:a|an|the)\s+\w")   # an English determiner can only open a noun phrase
_KIND = re.compile(r"(?i)^(?:a\s+)?(?:kind|sort|type|species|variety)\s+of\b")
# An English FREE RELATIVE ("what has been transmitted", 傳 zhuàn) is a noun phrase.  Bare "what"
# is not — that is the interrogative pronoun, and the closed lexicon below takes it.
_FREEREL = re.compile(r"(?i)^what\s+\w")
# Noun-forming derivational suffixes that are UNAMBIGUOUS in English — a word in -tion/-ment/-ness/
# -ity/-hood/-ship is a noun and nothing else.  Deliberately NOT -ing (a gerund is also a verb
# form), NOT -er (a comparative adjective takes it too) and NOT -al ("final", "royal").  Applied
# only to a ONE-WORD clause, so the suffix is on the clause's own head and not on a modifier.
_NOMINAL = re.compile(r"(?i)^\w+(?:tion|sion|ment|ness|ity|hood|ship)$")
# …and the adverb-forming -ly, on the same one-word condition.  The English exceptions are
# ADJECTIVES in -ly formed on a NOUN ("friendly", "cowardly", "heavenly"); those are excluded by
# name rather than by rule, since the list is closed and short and no rule distinguishes them.
_ADVERBIAL = re.compile(r"(?i)^\w+ly$")
_LY_ADJ = frozenset("""friendly cowardly heavenly earthly kingly manly womanly lonely lively
    lovely ugly holy silly early likely deadly costly orderly worldly timely burly surly
    only jolly ally rally folly bully""".split())

# TIER 3: a closed lexicon of FUNCTION-WORD glosses, matched on the WHOLE first clause.  This is a
# lexicon and is kept to the cases where it cannot be anything else: a gloss that IS a pronoun, a
# numeral or a preposition is glossing a word of that class, because a function word is the whole
# of what it means and there is no content left for it to be a noun or a verb of.  Every string
# here was read off the source, not invented.
_FUNCTION: dict[str, str] = {
    **{w: "NUM" for w in ("one", "two", "three", "four", "five", "six", "seven", "eight",
                          "nine", "ten", "hundred", "thousand", "myriad", "ten thousand")},
    **{w: "PRON" for w in ("i", "you", "he", "she", "it", "we", "they", "this", "that",
                           "who", "what", "which", "thou", "3p possessive")},
    # 為 wèi "for, because" and 於 yú "in, at" are the two adpositions the appendix glosses this
    # way, and both are ADP in UD Chinese.  The comma is the source's own listing of the two
    # English prepositions one Chinese word covers, not a second sense.
    **{w: "ADP" for w in ("for, because", "in, at", "at", "in", "from")},
}


def _clause(gloss: str) -> str:
    """The gloss's FIRST clause, stripped of the brackets a whole-gloss note is wrapped in
    ("[place name]") and of trailing punctuation."""
    first = gloss.split(";", 1)[0]
    return first.strip().strip("[]").strip().rstrip(".,;:").strip()


def infer_pos(gloss: str) -> str:
    """A UD UPOS tag for the word this gloss glosses, or ``""`` for NO OPINION.

    ``""`` is a first-class answer and is what every case not covered by the three tiers above
    gets.  The alternative — falling back on "an English word that looks like a noun means the
    Chinese word is a noun" — would need a lexicon of English content words, and the words this
    table glosses are precisely the ones English is ambiguous about: "cut", "turn", "look",
    "measure", "cover", "shine" open 70 glosses between them and are noun and verb alike.  A wrong
    tag here is not inert — the consumer promotes the reading it names to the top of the list a
    user picks from — so a gap is the cheaper error by a wide margin.

    Measured over the 4,082 entries: TIER 1 tags 391, TIER 2 a further 271, TIER 3 a further 26 —
    688 in all, 16.9 %.  The number that matters is smaller and better: of the 547 graphs the
    appendix gives more than one Middle Chinese reading, 124 carry a tag on a NON-FIRST entry, so a
    tag that can actually move something; of the 312 with more than one Mandarin reading, 73 do.
    """
    cl = _clause(gloss)
    if not cl:
        return ""
    # EVERY tier reads the FIRST CLAUSE and not the whole gloss, the explicit markers included.
    # The source marks a sense, not a word: "garment; wear (v.)" carries "(v.)" because its SECOND
    # sense is the verbal one, and reading the marker off the whole gloss tagged that entry VERB
    # against a first sense that is plainly a noun.  Where the two senses differ in class the entry
    # is genuinely both, and no single tag is right — so the marker is honoured only where it
    # qualifies the sense the gloss leads with.
    #
    # TIER 1 — an explicit marker, and only where it names ONE class.  "(adj., v.)" and "(n., v.)"
    # are the source declining to choose between two, and this declines with it.
    found: list[str] = []
    for run in _PARENS.findall(cl):
        for tok in _MARK_TOKEN.findall(run.lower()):
            hit = _MARKERS.get(tok.rstrip("."))
            if hit and hit not in found:
                found.append(hit)
        if found:
            break     # the FIRST parenthesised run that names a class settles it; a later "(of water)" is a usage note, not a second opinion
    if len(found) == 1:
        return found[0]
    if found:
        return ""     # two classes named in one breath — no opinion, deliberately

    # TIER 2 — grammatical frames.  Name frames come first: "a place name" and "a surname" are
    # noun phrases by the determiner test below and would be mis-tagged NOUN by it.
    if _NAME.match(cl):
        return "PROPN"
    if _TO.match(cl) or _BE.match(cl):
        return "VERB"
    if _KIND.match(cl) or _DET.match(cl) or _FREEREL.match(cl):
        return "NOUN"
    low = cl.lower()
    if " " not in low:
        if _NOMINAL.match(low):
            return "NOUN"
        if _ADVERBIAL.match(low) and low not in _LY_ADJ:
            return "ADV"
    # TIER 3 — the closed function-word lexicon.
    return _FUNCTION.get(low, "")


# ── output ────────────────────────────────────────────────────────────────────────────────────

def header(retrieved: str) -> str:
    """The provenance block.  CC BY-SA 4.0 requires the attribution to travel WITH the material,
    so it lives in the data file rather than only in a README the file could be separated from.
    :mod:`app.translit` skips any line starting with ``#`` — safe, because every key is a Han
    character."""
    return (
        "# Middle Chinese (Baxter) + Old Chinese (Baxter–Sagart) reconstructions, with the\n"
        "# Mandarin reading and the gloss of each WORD — one row per (graph, source entry).\n"
        "# Source: Wiktionary, 'Appendix:Baxter-Sagart Old Chinese reconstruction'\n"
        f"#   {SRC_URL.split('?')[0]}\n"
        f"#   Retrieved {retrieved}.  Wiktionary text: CC BY-SA 4.0\n"
        "#   (https://creativecommons.org/licenses/by-sa/4.0/).\n"
        "# Tabulating: Baxter, W. and L. Sagart (n.d.), Baxter-Sagart Old Chinese reconstruction\n"
        "#   (Version 1.00), http://crlao.ehess.fr/document.php?id=1217 ; and the Unicode Unihan\n"
        "#   Database (http://www.unicode.org/Public/UNIDATA/).\n"
        "# Built by tools/build_baxter_index.py — same licence.  Do not hand-edit: rebuild.\n"
        "# Columns: graph <TAB> pinyin <TAB> middle_chinese <TAB> old_chinese <TAB> pos <TAB> gloss\n"
        "#   A graph's rows are in source order; the traditional and the simplified form of one\n"
        "#   entry each get a row, so 樂 and 乐 both resolve.  MC is Baxter's Middle Chinese\n"
        "#   transcription (X/H tone letters); OC is Baxter-Sagart Old Chinese, VERBATIM — the\n"
        "#   {…} annex, the […] ‹…› (…) uncertainty and editorial marks and the ' ~ ' between two\n"
        "#   competing reconstructions are the source's own and are kept.  pos is a UD UPOS tag\n"
        "#   INFERRED FROM THE GLOSS by that script, and is EMPTY wherever the gloss licenses\n"
        "#   none — an empty cell is 'no opinion', never 'not looked at'.\n")


def build(raw: str, dst: str, retrieved: str) -> None:
    ents = entries(raw)
    if len(ents) < 4000:   # the appendix has held ~4,082 entries since 2012; a collapse to a
        raise SystemExit(  # handful means the page's markup changed and the cell run no longer matches
            f"only {len(ents)} entries parsed — the source's table markup has changed; "
            f"re-read entries() before trusting the output")

    # graph → its entries, in source order.  Both the traditional and the simplified form key the
    # same entry (they are one word written two ways, not two words), and where the two spellings
    # coincide the entry is filed once.
    graphs: dict[str, list[tuple[str, str, str, str, str]]] = {}
    n_pos = 0
    for tc, sc, py, mc, oc, gloss in ents:
        pos = infer_pos(gloss)
        n_pos += bool(pos)
        row = (py, mc, oc, pos, gloss)
        for g in ([tc] + ([sc] if sc and sc != tc else [])):
            graphs.setdefault(g, []).append(row)

    # No field may hold the output's own separators.  Both are impossible in practice — every cell
    # is one wikitext line and clean() strips it — so this is a GUARD that fails the build and
    # names the row, not a strip that would quietly absorb a change in the source's conventions.
    for g, rows in graphs.items():
        for row in rows:
            if any(("\t" in f) or ("\n" in f) for f in row):
                raise SystemExit(f"{g}: a field holds a tab or newline: {row!r}")

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n_rows = 0
    # Sorted by code point, which is the order the file being replaced was already in, so a diff
    # between the two reads as content and not as a reshuffle.  A graph's own rows stay in SOURCE
    # order, because that order is the appendix's and the first entry is the one the collapsed
    # table used to carry — it stays the default reading.
    with open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(header(retrieved))
        for g in sorted(graphs):
            for py, mc, oc, pos, gloss in graphs[g]:
                fh.write(f"{g}\t{py}\t{mc}\t{oc}\t{pos}\t{gloss}\n")
                n_rows += 1
    multi = sum(1 for v in graphs.values() if len(v) > 1)
    print(f"{dst}: {n_rows:,} rows over {len(graphs):,} graphs from {len(ents):,} source entries "
          f"({multi:,} graphs with more than one entry); "
          f"pos inferred for {n_pos:,}/{len(ents):,} entries ({100 * n_pos / len(ents):.1f} %)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--retrieved", required=True, metavar="YYYY-MM-DD",
                    help="the date the wikitext was fetched — written into the output header. "
                         "Required, and deliberately NOT defaulted from the clock: the build must "
                         "be byte-reproducible from the same input.")
    ap.add_argument("--src", help=f"local copy of the raw wikitext (default: download {SRC_URL})")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.retrieved):
        raise SystemExit("--retrieved must be an ISO date, YYYY-MM-DD")
    if args.src:
        with open(args.src, encoding="utf-8") as fh:
            raw = fh.read()
    else:
        print(f"downloading {SRC_URL} …", file=sys.stderr)
        req = urllib.request.Request(SRC_URL, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req) as resp:   # noqa: S310 — a fixed https URL
            raw = resp.read().decode("utf-8")
    build(raw, args.out, args.retrieved)


if __name__ == "__main__":
    main()
