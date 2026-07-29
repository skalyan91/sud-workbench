"""ITRANS → IAST for typed Sanskrit input.

This app STORES Sanskrit as IAST (see :mod:`app.sa_csl` and the Sanskrit branches of
:mod:`app.translit`), but IAST needs diacritics no ordinary keyboard carries, so what a user
actually types is **ITRANS** — ``kRiShNa``, ``raamaayaNa``, ``sha~Nkara``.  Every Sanskrit input
field therefore runs what was typed through :func:`convert` before it is stored.

Three things make that safe rather than reckless:

*   **It is per WORD, not per field.**  A pasted paragraph may mix a hand-typed ITRANS word into
    otherwise-IAST text; converting the whole string on one verdict would corrupt the rest.  Runs of
    whitespace are preserved verbatim, so the split is invisible to the caller.

*   **A word is converted only on POSITIVE evidence** (:func:`looks_itrans`).  ``rama`` and ``deva``
    read identically under either notation, so converting them is a no-op at best and, if the
    notation guess is wrong, a silent corruption — they are left exactly as typed.  The evidence
    test is the single shared gate every call site agrees on; see its own docstring for the list.

*   **A missing aksharamukha is "leave the text as typed", never an exception.**  aksharamukha is in
    the CORE requirements today, but the transliteration engines are an on-demand tier
    (:mod:`app.extras`) and a trimmed bundle may not carry it — the house rule (CLAUDE.md) is that
    such a feature degrades, so the import sits behind a ``try`` and a failure returns the input.

WHY AKSHARAMUKHA AND NOT A HAND-WRITTEN TABLE: it is already a dependency of this very tier
(:mod:`app.apte` converts IAST→SLP1 with it, :mod:`app.translit` drives every Indic script through
it), it implements the whole ITRANS scheme rather than the dozen mappings one would think to write
down, and a second table here would be one more thing to keep in step with it.  Two places where its
ITRANS reading and the convention this app's users actually type apart are patched BEFORE it sees
the text (:func:`_prep`), and one where the app's own notation overrides ITRANS outright
(:data:`_CIRC_SPLIT`); each is commented where it stands.
"""

from __future__ import annotations

import re

# ── the circumflex convention ────────────────────────────────────────────────────────────────────
# This repo's Sanskrit text marks a sandhi COALESCENCE with a circumflex vowel — `vartm" â-punar-
# janmanām`, `hor" êty` (see app/sa_csl.py's docstring).  ITRANS has no notation for those at all,
# so the input convention is a leading `^`: ^a → â, ^e → ê, ^i → î, ^o → ô, ^u → û.
#
# `^` is NOT free for us to take, which is why this is handled by SPLITTING the word rather than by
# pre-substituting a sentinel:
#   · aksharamukha's ITRANS reads `^e`/`^o` as the SHORT vowels ĕ/ŏ (measured: "x^ety" → "kṣĕty"),
#     so feeding it a `^` of ours would silently produce a different vowel;
#   · `R^i`/`R^I` (and `L^i`) are the standard ITRANS spelling of vocalic ṛ/ṝ, so a `^` after R or L
#     is ITRANS's and must be left alone — hence the lookbehind;
#   · a private-use sentinel was tried first and is not viable: aksharamukha does not pass U+E000
#     through, it drops it and inserts an inherent vowel ("ety" → "aety").
# Splitting is exact because IAST, unlike a syllabic script, writes each consonant and vowel
# separately: no aksharamukha mapping spans the boundary a coalesced vowel sits on.
_CIRC_SPLIT = re.compile(r"(?<![RL])\^([aeiouAEIOU])")
_CIRC = {"a": "â", "e": "ê", "i": "î", "o": "ô", "u": "û",
         "A": "Â", "E": "Ê", "I": "Î", "O": "Ô", "U": "Û"}

# ── the evidence test ────────────────────────────────────────────────────────────────────────────
# Any ONE of these makes a word ITRANS.  Each is a spelling that IAST cannot produce, so a match is
# proof the user was typing ITRANS rather than a guess about which notation they had in mind.
#   ^V          the circumflex convention above — ours, and written nowhere else
#   aa ii uu    the digraph long vowels (IAST writes ā ī ū, one character each)
#   sh Sh shh   the sibilants ś / ṣ (IAST has no bare "h" after a sibilant letter)
#   ~n ~N       the palatal / velar nasals ñ / ṅ
#   .h .n .m    the dot digraphs — virama, anusvāra;  .a is the avagraha
#   .N
#   a NON-INITIAL capital from T D N S R M H A I U E O — ITRANS writes with a capital both the
#   retroflex/nasal consonants (ṭ ḍ ṇ ṣ, vocalic ṛ, anusvāra ṃ, visarga ḥ) AND the long or diphthong
#   VOWELS (A=ā, I=ī, U=ū, E=e, O=o).  The vowels were missing from this class at first and that was
#   a real bug: "anEkadA" carries no other ITRANS-only spelling at all, so it produced no evidence
#   and was left as typed instead of becoming "anekadā".  The two halves are one convention — the
#   same hand that writes "kRiShNa" writes "kAla" — so the class has to cover both or it covers
#   neither reliably.
#   Non-initial is the whole point of the restriction: a word-initial capital is far more likely to
#   be ordinary capitalisation ("Rama", "Deva", "Agni") than an ITRANS retroflex or long vowel, and
#   reading it as one would turn Rāma into ṛama and Agni into āgni.  Capitalisation mid-word is not
#   something IAST text does, so there it IS the ITRANS signal.  The cost is a miss on a genuinely
#   retroflex- or long-initial word with no other cue, which leaves the text as typed — the safe
#   direction.
_EVIDENCE = re.compile(r"""
      \^[aeiouAEIOU]
    | aa | ii | uu
    | sh | Sh
    | ~[nN]
    | \.[hnmaN]
    | (?<=[A-Za-z]) [TDNSRMHAIUEO]
""", re.X)

# ── where one written unit ends and the next begins ──────────────────────────────────────────────
# The whitespace split alone is too coarse. A Sanskrit compound is written as ONE whitespace-word
# ("śaśa-bhṛto"), so the moment a single member is already IAST the pure-ASCII condition fails for
# the whole run and a freshly typed ITRANS member beside it goes unconverted — which is exactly the
# case a user hits when correcting one item of a compound rather than retyping the sentence.
# So each of these delimits a unit that is gated and converted on its OWN:
#   -            the compound hyphen — this repo's Sanskrit writes every compound member with one
#   |            a WORD-INTERNAL pipe, the same join (app.api.sanskrit_running strips "apostrophes/
#                hyphens/word-internal pipes" for exactly this reason).  A bare "|" BETWEEN words is
#                a verse daṇḍa, not a separator — but it is surrounded by whitespace, so the
#                whitespace split has already made it a piece of its own and this pass never sees it
#                (asserted in the harness rather than assumed).
#   ' "          the elision / sandhi-coalescence marks (`pralay'-ôdbhava`, `vartm" â-`, `c' ânekadā`)
#                — a seam where two words are WRITTEN as one, so the parts on either side of it were
#                typed independently and must be judged independently.  The curly forms are included
#                for the same reason translit._APOS_QUOTES lists them: a keyboard or an OS
#                substitution produces them in place of the straight ones.
# Every separator is kept verbatim in the output (the split captures them), so re-joining reproduces
# the input exactly — the same guarantee the whitespace split gives.
# NOTHING ELSE is a split point.  In particular a "." is not: it is part of ITRANS's own .h/.n/.m
# digraphs, and cutting there would destroy the very spelling the evidence test reads.
_UNIT_SPLIT = re.compile("([-|'\"‘’“”])")


def _prep(chunk: str) -> str:
    """Rewrite the two spellings where aksharamukha's ITRANS and the convention users actually type
    disagree.  Runs on one circumflex-free chunk, immediately before the transliterator."""
    # `R` alone is Dravidian ṟ to aksharamukha ("pitR" → "pitṟ"); vocalic ṛ is spelt `RRi` or `R^i`.
    # Sanskrit typists write plain `R` for ṛ (the task's own example is `kRiShNa`), and ṟ does not
    # occur in Sanskrit at all, so every `R` that is not already part of `RR…`/`R^…` is vocalic:
    #   · `R` before i/I → `R^` , making `Ri` the `R^i` it was meant to be (and `RI` → `R^I` = ṝ);
    #   · any other lone `R` → `RRi`, so `pitR` reaches `pitṛ`.
    # The (?<!R) guards keep `RRi`/`RRI` — already correct — from being rewritten into nonsense.
    chunk = re.sub(r"(?<!R)R(?=[iI])", "R^", chunk)
    chunk = re.sub(r"(?<!R)R(?![RiI^])", "RRi", chunk)
    # Bare `S` is undefined in ITRANS and aksharamukha passes it through unchanged, but the user who
    # typed a capital in the T/D/N series meant the retroflex — read it as `Sh` (ṣ), matching the
    # evidence test above, which counts `S` among the capital retroflexes for exactly this reason.
    chunk = re.sub(r"S(?!h)", "Sh", chunk)
    # Capital `E`/`O` are ITRANS's SHORT (Dravidian) vowels ĕ/ŏ, not e/o — measured: "anEkadA" comes
    # out of aksharamukha as "anĕkadā".  Sanskrit has no short e or o at all: both are always long
    # there, so a capital E/O in a Sanskrit word can only be the ordinary vowel, typed in caps by the
    # same hand that writes A/I/U for ā/ī/ū.  Same shape of fix as the bare `R` above, and the same
    # justification — the alternative reading names a sound the language does not have.
    return chunk.replace("E", "e").replace("O", "o")


def _one_word(word: str) -> str:
    """Convert a single evidence-bearing word.  Never raises: aksharamukha missing (or refusing the
    input) leaves the word exactly as it came in, per the module docstring."""
    try:
        from aksharamukha import transliterate as ak
    except Exception:  # noqa: BLE001 — the transliteration tier isn't installed
        return word
    parts = _CIRC_SPLIT.split(word)   # [text, vowel, text, vowel, …]: odd indices are the captures
    out = []
    for i, part in enumerate(parts):
        if i % 2:
            out.append(_CIRC[part])
            continue
        if not part:
            out.append(part)
            continue
        try:
            out.append(ak.process("ITRANS", "IAST", _prep(part)))
        except Exception:  # noqa: BLE001 — an input aksharamukha can't read: keep it verbatim
            out.append(part)
    # Any `^` still standing was not part of a recognised circumflex or a vocalic ṛ, and aksharamukha
    # consumes the ones that were — so a survivor is a stray the user does not want in stored text.
    return "".join(out).replace("^", "")


def looks_itrans(word: str) -> bool:
    """Is this word ITRANS?  The single gate every call site shares.

    Two conditions, and both must hold:

    1.  **The word is pure ASCII.**  ITRANS exists precisely so that Sanskrit can be written in
        ASCII, so anything else — an IAST diacritic (ā ī ū ṛ ṃ ḥ ś ṣ ñ ṅ ṭ ḍ ṇ …), one of this
        repo's circumflexes, Devanagari, a smart quote — proves the word is already in some other
        notation.  Testing the codepoint rather than enumerating the diacritics is deliberate: the
        enumeration would have to be kept complete, and a single character missed from it is a word
        silently mangled.
    2.  **It is not written entirely in capitals.**  ALL-CAPS is emphasis or an abbreviation far more
        often than it is ITRANS, and every capital in it would be read as a different phoneme — "RAMA"
        would come back "ṛāṃā".  The rule costs nothing real: an ITRANS typist capitalises the
        individual letters that need it, never the whole word.
    3.  **It carries at least one ITRANS-only spelling** (:data:`_EVIDENCE`).  Absent that the word
        reads the same either way, and conversion would be a no-op at best — so it is not attempted.
    """
    if not word or not word.isascii():
        return False
    letters = [c for c in word if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return False
    return bool(_EVIDENCE.search(word))


def to_iast(text: str) -> str:
    """Convert every ITRANS unit in ``text``, leaving the rest verbatim.

    TWO levels of splitting, each with its separators captured so that re-joining reproduces the
    input byte for byte: whitespace runs first (a pasted paragraph keeps its line breaks and its
    spacing), then, within each whitespace-word, the written-unit delimiters of
    :data:`_UNIT_SPLIT` — so a compound member is gated and converted on its own and a user can
    correct one item of ``śaśa-bhRto`` without retyping the rest of the sentence.
    """
    if not text:
        return text
    out = []
    for i, part in enumerate(re.split(r"(\s+)", text)):
        if i % 2 or not part:            # a whitespace run (odd index), or an empty edge piece
            out.append(part)
            continue
        for j, unit in enumerate(_UNIT_SPLIT.split(part)):
            out.append(unit if (j % 2 or not looks_itrans(unit)) else _one_word(unit))
    return "".join(out)


def is_sanskrit(lang: str) -> bool:
    """The same base-code test the frontend's ``isSanskritLang`` applies (js/lang/translit.js)."""
    return (lang or "").lower().split("-")[0].split("_")[0] in ("sa", "san")


def convert(text: str, lang: str = "sa") -> dict:
    """The one entry point the bridge exposes.  A non-Sanskrit language (or a missing engine, which
    :func:`_one_word` absorbs) is a no-op returning the input unchanged, so a call site never has to
    ask whether conversion applies — it just calls and uses what comes back."""
    if lang and not is_sanskrit(lang):
        return {"converted": text, "changed": False}
    out = to_iast(text or "")
    return {"converted": out, "changed": out != (text or "")}


def available() -> bool:
    """Whether the conversion can actually run — aksharamukha rides the on-demand transliteration
    tier.  False simply means every :func:`convert` will pass its input straight through."""
    try:
        from aksharamukha import transliterate  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True
