"""ITRANS → IAST (or Devanagari) for typed Sanskrit input.

A Sanskrit file stores its text in one of two scripts — IAST or Devanagari, whichever the parser was
fed — and NEITHER is typeable on an ordinary keyboard: IAST needs diacritics the keyboard has no
keys for, and Devanagari needs an IME the user may not have installed.  What a user actually types
is **ITRANS** — ``kRiShNa``, ``raamaayaNa``, ``sha~Nkara`` — so every Sanskrit input field runs what
was typed through :func:`convert` before it is stored, with the DOCUMENT'S OWN script as the target.

The target is what makes this work for both storage modes from one gate: ``kRiShNa`` becomes
``kṛṣṇa`` in an IAST file and ``कृष्ण`` in a Devanagari one, and the user types the same thing either
way.  A Devanagari file also accepts plain IAST (``kṛṣṇa`` → ``कृष्ण``), which an IAST file cannot
sensibly do — see :func:`_convertible` for why that asymmetry is safe rather than arbitrary.

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
down, and a second table here would be one more thing to keep in step with it.  The places where its
ITRANS reading and the convention this app's users actually type disagree are patched BEFORE it sees
the text (:func:`_prep`), each commented where it stands.
"""

from __future__ import annotations

import re

# ── the evidence test ────────────────────────────────────────────────────────────────────────────
# Any ONE of these makes a word ITRANS.  Each is a spelling that IAST cannot produce, so a match is
# proof the user was typing ITRANS rather than a guess about which notation they had in mind.
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
      aa | ii | uu
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
#   -            the compound hyphen — a samāsa written with its members separated
#   |            a WORD-INTERNAL pipe, the same join.  A bare "|" BETWEEN words is a verse daṇḍa,
#                not a separator — but it is surrounded by whitespace, so the whitespace split has
#                already made it a piece of its own and this pass never sees it (asserted in the
#                harness rather than assumed).
#   ' "          the avagraha and the quotation marks (`ko 'nasūyakaḥ` — the DCS representation
#                writes an elided initial a as an avagraha attached to its word).  A seam where two
#                words are WRITTEN as one, so the parts on either side of it were typed
#                independently and must be judged independently.  The curly forms are included for
#                the same reason translit._APOS_QUOTES lists them: a keyboard or an OS substitution
#                produces them in place of the straight ones.
# Every separator is kept verbatim in the output (the split captures them), so re-joining reproduces
# the input exactly — the same guarantee the whitespace split gives.
# NOTHING ELSE is a split point.  In particular a "." is not: it is part of ITRANS's own .h/.n/.m
# digraphs, and cutting there would destroy the very spelling the evidence test reads.
_UNIT_SPLIT = re.compile("([-|'\"‘’“”])")


def _prep(chunk: str) -> str:
    """Rewrite the spellings where aksharamukha's ITRANS and the convention users actually type
    disagree.  Runs on one unit, immediately before the transliterator, and only for ITRANS input —
    every rewrite here reads an ASCII letter as an ITRANS digraph, which would corrupt IAST."""
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


def _one_word(word: str, target: str = "IAST") -> str:
    """Convert a single unit into ``target``.  Never raises: aksharamukha missing (or refusing the
    input) leaves the word exactly as it came in, per the module docstring.

    The SOURCE notation is decided per unit by :func:`looks_itrans` — ITRANS where there is positive
    evidence, IAST otherwise — so a Devanagari document takes ``kRiShNa`` and ``kṛṣṇa`` alike and
    stores both as ``कृष्ण``.  `_prep` runs only on the ITRANS branch: its rewrites read bare ASCII
    letters as ITRANS digraphs (``R`` → ``RRi``, ``S`` → ``Sh``) and would mangle IAST."""
    if not word:
        return word
    try:
        from aksharamukha import transliterate as ak
    except Exception:  # noqa: BLE001 — the transliteration tier isn't installed
        return word
    src = "ITRANS" if looks_itrans(word) else "IAST"
    if src == target:
        return word
    try:
        return ak.process(src, target, _prep(word) if src == "ITRANS" else word) or word
    except Exception:  # noqa: BLE001 — an input aksharamukha can't read: keep it verbatim
        return word


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


def _convertible(unit: str, target: str) -> bool:
    """Should this unit be rewritten at all?

    ITRANS evidence always qualifies it — that is the original gate, and it is the only one when the
    target is IAST, because a unit with no evidence reads the same under either notation and
    rewriting it could only corrupt it.

    A NATIVE-SCRIPT target takes one more class: a Latin-script unit with no ITRANS evidence, read
    as IAST.  The asymmetry is not arbitrary.  With an IAST target the question "ITRANS or IAST?" is
    unanswerable for ``rama`` AND the answer does not matter, since both readings give ``rama``.
    With a Devanagari target the question still does not matter — both readings give ``रम`` — but
    the ANSWER does: leaving it alone puts a Latin word in a Devanagari file, which is the one
    outcome that is certainly wrong.  ALL-CAPS is excluded here as it is in :func:`looks_itrans`,
    for the same reason: it is an abbreviation far more often than a word."""
    if looks_itrans(unit):
        return True
    if not target or target == "IAST" or not unit:
        return False
    letters = [c for c in unit if c.isalpha()]
    if not letters or all(c.isupper() for c in letters):
        return False
    return all(("A" <= c <= "Z" or "a" <= c <= "z" or ord(c) > 0x7F) for c in letters) \
        and not _is_native(unit)


def _is_native(text: str) -> bool:
    """Already written in a Brahmic script — nothing for this module to do."""
    return any("ऀ" <= c <= "෿" or "ༀ" <= c <= "࿿" for c in text)


def to_script(text: str, target: str = "IAST") -> str:
    """Convert every convertible unit in ``text`` into ``target``, leaving the rest verbatim.

    TWO levels of splitting, each with its separators captured so that re-joining reproduces the
    input byte for byte: whitespace runs first (a pasted paragraph keeps its line breaks and its
    spacing), then, within each whitespace-word, the written-unit delimiters of
    :data:`_UNIT_SPLIT` — so a compound member is gated and converted on its own and a user can
    correct one item of ``śaśa-bhRto`` without retyping the rest of the sentence.
    """
    if not text:
        return text
    target = target or "IAST"
    out = []
    for i, part in enumerate(re.split(r"(\s+)", text)):
        if i % 2 or not part:            # a whitespace run (odd index), or an empty edge piece
            out.append(part)
            continue
        for j, unit in enumerate(_UNIT_SPLIT.split(part)):
            if j % 2:
                out.append(_sep_in(unit, target))
            else:
                out.append(_one_word(unit, target) if _convertible(unit, target) else unit)
    return "".join(out)


_AVAGRAHA = ("'", "’", "‘")


def _sep_in(sep: str, target: str) -> str:
    """A unit separator in the target script.  Only the avagraha moves: romanised Sanskrit writes an
    elided initial ``a`` as an apostrophe and Devanagari writes it ``ऽ`` (U+093D), which is how the
    parser itself spells it (``नमोऽस्तु`` ⇄ ``namo 'stu``).  Leaving the ASCII apostrophe standing in
    a Devanagari file would be the one thing a reader of that file could not read.  The hyphen and
    the quotation marks are the same character in both and pass straight through."""
    if target and target != "IAST" and sep in _AVAGRAHA:
        try:
            from aksharamukha import transliterate as ak
            return ak.process("IAST", target, "'") or sep
        except Exception:  # noqa: BLE001
            return sep
    return sep


def to_iast(text: str) -> str:
    """:func:`to_script` with the IAST target — the shape every pre-Devanagari caller used."""
    return to_script(text, "IAST")


def is_sanskrit(lang: str) -> bool:
    """The same base-code test the frontend's ``isSanskritLang`` applies (js/lang/translit.js)."""
    return (lang or "").lower().split("-")[0].split("_")[0] in ("sa", "san")


def convert(text: str, lang: str = "sa", script: str = "") -> dict:
    """The one entry point the bridge exposes.  A non-Sanskrit language (or a missing engine, which
    :func:`_one_word` absorbs) is a no-op returning the input unchanged, so a call site never has to
    ask whether conversion applies — it just calls and uses what comes back.

    ``script`` is the DOCUMENT'S storage script as an aksharamukha target name ("Devanagari"), or ""
    for an IAST document.  The caller reads it off the document rather than off a preference: which
    script a file is written in is a fact about the file, and typing into it must not depend on what
    the reader happens to be displaying."""
    if lang and not is_sanskrit(lang):
        return {"converted": text, "changed": False}
    out = to_script(text or "", script or "IAST")
    return {"converted": out, "changed": out != (text or "")}


def available() -> bool:
    """Whether the conversion can actually run — aksharamukha rides the on-demand transliteration
    tier.  False simply means every :func:`convert` will pass its input straight through."""
    try:
        from aksharamukha import transliterate  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True
