"""Latin transliteration, routed to the right backend per language.

wiktra (a Python port of Wiktionary's Lua translit modules) is the default, but it is
built for *deterministic*, largely 1:1 scripts and — for context-dependent scripts — either
errors or returns the input unchanged.  So the context-dependent / lookup-based cases use
dedicated packages:

* Arabic     → DIN 31635 scholarly transliteration (with diacritics).
* Chinese    → pypinyin (Hànyǔ Pīnyīn, tone marks).
* Cantonese  → ToJyutping (Jyutping).
* Japanese   → Janome (kanji reading) + pykakasi (kana → phonemic Hepburn, long vowels doubled).
* Korean     → hangul-romanize (wiktra's Korean modules don't run on Lua 5.5).
* Persian    → DIN 31635 scholarly transliteration (with diacritics).
* Hebrew     → ISO 259 scholarly transliteration (with diacritics).
* everything else → wiktra, and if wiktra leaves it unchanged → uroman (ISI's Universal Romanizer).

Every call is wrapped so a failure yields ``""`` (blank) rather than raising; results are
cached per (lang, text).
"""

from __future__ import annotations

import os
import re

_TR = None
_AR_MAP = None
_JANOME = None
_KKS = None
_KO = None
_UROMAN = None
_CACHE: dict[tuple[str, str, str, str, str, str], str] = {}   # (lang, scheme, text, upos, feats, lemma) → transliteration ⚠ the three hints are in the key: see _render_one

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")   # vendored, char-keyed datasets (offline)

# CJK / fullwidth punctuation → its Latin equivalent.  Applied to every ROMANISED output (all
# transliteration schemes + Latin-output orthographies such as GR / General Chinese / Jyutping) so a
# romanisation never leaves a 。，、！？「」（）… glyph; skipped for native-script orthographies
# (Zhuyin, the Indic scripts).  Fullwidth ASCII (ＡＢＣ／１２３, U+FF01–FF5E) and the ideographic space
# are folded to plain ASCII algorithmically in _latinize_punct.
_FW_PUNCT = {
    "。": ".", "．": ".", "、": ",", "，": ",", "・": "·", "…": "…", "‥": "..",
    "！": "!", "？": "?", "；": ";", "：": ":", "〜": "~", "～": "~",
    "「": "“", "」": "”", "『": "‘", "』": "’",
    "“": "“", "”": "”", "‘": "‘", "’": "’",
    "（": "(", "）": ")", "【": "[", "】": "]", "〔": "[", "〕": "]", "〖": "[", "〗": "]",
    "《": "«", "》": "»", "〈": "‹", "〉": "›", "｛": "{", "｝": "}",
}


def _latinize_punct(s: str) -> str:
    """Fold CJK/fullwidth punctuation + fullwidth ASCII to their Latin/ASCII equivalents."""
    if not s:
        return s
    out = []
    for ch in s:
        if ch in _FW_PUNCT:
            out.append(_FW_PUNCT[ch])
        elif "！" <= ch <= "～":   # fullwidth ASCII (！？（）ＡＢＣ１２３ …) → ASCII
            out.append(chr(ord(ch) - 0xFEE0))
        elif ch == "　":               # ideographic space → normal space
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out)


def available() -> bool:
    try:
        import wiktra  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def _tr():
    global _TR
    if _TR is None:
        import wiktra
        _TR = wiktra.Transliterator()
        try:   # Lua 5.5 dropped the global `unpack` (now table.unpack); some modules (ar) still use it
            _TR.lua.execute("if not unpack then unpack = table.unpack end")
        except Exception:  # noqa: BLE001
            pass
    return _TR


def _camel_ar(text: str) -> str:
    global _AR_MAP
    try:
        if _AR_MAP is None:
            from camel_tools.utils.charmap import CharMapper
            _AR_MAP = CharMapper.builtin_mapper("ar2hsb")
        return _AR_MAP(text) or ""
    except Exception:  # noqa: BLE001
        return ""


_HAN_RE = re.compile(r"[⺀-⻿㐀-䶿一-鿿豈-﫿]")


def _t2s_chars(text: str) -> str:
    """Traditional → simplified ONE CHARACTER AT A TIME, so the result is the same length as its input
    and position i still describes character i.  `_t2s` runs OpenCC over the whole string, where the
    phrase rules may rewrite a run to a different number of characters (們 → 们 is 1:1, but 甚麼 → 什么
    is a phrase substitution) — and every caller here aligns syllables to characters by index, so a
    length change would silently shift every reading after it.  A character whose own fold is not a
    single character is left alone rather than guessed at."""
    out = []
    for c in text:
        if not _HAN_RE.match(c):
            out.append(c)
            continue
        s = _t2s(c)
        out.append(s if len(s) == 1 else c)
    return "".join(out)


def _phrase_known(text: str) -> bool:
    """Does pypinyin hold a PHRASE entry for this token, in EITHER Chinese orthography?  Its
    PHRASES_DICT is keyed in SIMPLIFIED only (see _mandarin_syllables), so the traditional spelling of
    a word it knows perfectly well answers False to the bare membership test."""
    from pypinyin.constants import PHRASES_DICT
    if text in PHRASES_DICT:
        return True
    simp = _t2s_chars(text)
    return simp != text and simp in PHRASES_DICT


def _fold_phrase_readings(text: str, pairs: list) -> None:
    """Re-read ``text`` through its simplified fold and carry the PHRASE reading back onto ``pairs``
    in place, where doing so is both useful and safe (see _mandarin_syllables' own note).

    Useful ⇒ the token has TWO OR MORE Han characters and at least one of them folds.  Not "the fold is
    a PHRASES_DICT entry", which was the obvious gate and is too narrow by exactly one case: pypinyin
    matches its phrases as SUBSTRINGS, so 银行卡 — not itself an entry — still reads yínhángkǎ off the
    银行 inside it, and gating on whole-token membership left 銀行卡 as yínxíngkǎ.  Asking the engine is
    the only way to find those, so the fold is attempted and its ANSWER judged.
    Safe ⇒ per position, and only onto a Han character whose OWN readings include the folded syllable.
    The two-character floor is part of that safety and not an optimisation: a lone graph has no phrase
    to gain, and is the one place the many-to-one fold could do harm (幹 gàn folding to 干 gān, a reading
    幹 does also carry, so the membership guard alone would let it through)."""
    from pypinyin import Style, pinyin
    from pypinyin.constants import PHRASES_DICT
    if text in PHRASES_DICT:
        return                       # the token IS a known phrase — pypinyin already applied it
    simp = _t2s_chars(text)
    if simp == text or sum(1 for c in text if _HAN_RE.match(c)) < 2:
        return                       # nothing folded, or a single graph — see the note above
    segs = [s[0] for s in pinyin(simp, style=Style.TONE3, neutral_tone_with_five=True)]
    if len(segs) != len(pairs):
        return                       # the two spellings segmented differently → alignment is a guess
    for p, syl in zip(pairs, segs):
        ch = p[0]
        if ch is None or syl == p[1]:
            continue
        if syl in _char_heteronyms(ch):   # …the traditional graph really can be read this way
            p[1] = syl


def _phrase_heteronyms(text: str) -> list[list[str]]:
    """pypinyin's per-position CANDIDATE lists for ``text``, with the same simplified fold
    `_fold_phrase_readings` applies to the single reading — and for the same reason.

    Folding the default reading alone was not enough, and the gap it left was the visible one: a phrase
    entry does not merely pick a syllable, it also COLLAPSES the candidate list to the one reading the
    word actually has, which is how the whole-token rule answers 银行 with "nothing to choose".  Read in
    traditional, 銀行 missed the entry and came back with 行's full heteronym list, so the flyout offered
    five readings of a word that has one — the rule holding for a simplified document and quietly not
    holding for a traditional one.
    The folded candidates are filtered through the ORIGINAL graph's own readings (the many-to-one guard
    of _mandarin_syllables), and a position the filter would empty keeps its unfolded list rather than
    none: a fold may not ADD a reading the traditional graph cannot take, and must not remove the only
    one it has."""
    from pypinyin import Style, pinyin
    from pypinyin.constants import PHRASES_DICT
    het = pinyin(text, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)
    if text in PHRASES_DICT:
        return het
    simp = _t2s_chars(text)
    if simp == text or sum(1 for c in text if _HAN_RE.match(c)) < 2:
        return het   # same two conditions as _fold_phrase_readings, and for the same reasons
    folded = pinyin(simp, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)
    if len(folded) != len(het) or len(folded) != len(text):
        return het   # a length mismatch means position i no longer names character i — see _t2s_chars
    out = []
    for i, cands in enumerate(folded):
        own = _char_heteronyms(text[i]) if _HAN_RE.match(text[i]) else None
        keep = [c for c in cands if c in own] if own else list(cands)
        out.append(keep or list(het[i]))
    return out


def _mandarin_syllables(text: str) -> list[tuple[bool, str]]:
    """Per-character numbered pinyin (Style.TONE3) for every Han character in ``text``, non-Han
    runs passed through verbatim.  不 is corrected to the actual tone-sandhi rule (4th tone → 2nd
    tone before a following 4th-tone syllable) rather than relying on pypinyin's own sandhi, which
    only fires for phrases in its built-in dictionary (e.g. 不是/不對/不要 but not 不去).
    Returns (is_han, numbered_syllable_or_literal_text) pairs, one per pypinyin segment.

    ⚠️ PYPINYIN'S PHRASE DICTIONARY IS SIMPLIFIED-ONLY, so a TRADITIONAL token misses it and falls back
    to per-character citation readings: 银行 came out yínháng and 銀行 — the same word — yínxíng, because
    only the simplified spelling reaches the 银行 entry.  Every traditional document was therefore denied
    the phrase-level disambiguation that is the whole reason the dictionary exists.  So where the fold
    unlocks an entry the original spelling could not reach, the phrase is re-read in simplified and the
    syllables carried back position-by-position.

    THE FOLD IS NOT TRUSTED BLINDLY, because it is MANY-TO-ONE: 幹 乾 干 all fold to 干, and 干's own
    citation reading (gān) is not 幹's (gàn), so a fold can offer a syllable the ORIGINAL graph cannot
    take.  A folded syllable is therefore accepted only where pypinyin itself lists it among the
    traditional character's own readings — the same membership refusal `_POS_OVERRIDE` uses to keep an
    Old-Chinese-only reading out of a Pinyin row.  Where it does not, the character keeps the reading
    its own spelling gave it."""
    from pypinyin import Style, pinyin
    segs = [s[0] for s in pinyin(text, style=Style.TONE3, neutral_tone_with_five=True)]
    pairs = []
    idx = 0
    for seg in segs:
        if idx < len(text) and _HAN_RE.match(text[idx]):
            pairs.append([text[idx], seg])
            idx += 1
        else:
            pairs.append([None, seg])
            idx += len(seg)
    _fold_phrase_readings(text, pairs)
    for i in range(len(pairs) - 1, -1, -1):   # right-to-left so a chained 不不 sees the RESOLVED next tone
        if pairs[i][0] == "不":
            nxt = pairs[i + 1][1] if i + 1 < len(pairs) else ""
            pairs[i][1] = "bu2" if nxt[-1:] == "4" else "bu4"
    return [(ch is not None, syl) for ch, syl in pairs]


def _join_pinyin(pairs) -> str:
    """(is_han, numbered_syllable) pairs → tone-marked Pinyin.  Split out of _pinyin so the heteronym
    candidates (see `readings`) render through the SAME joiner and can never contradict the scheme."""
    from pypinyin.contrib.tone_convert import to_tone
    return "".join(to_tone(syl) if is_han else syl for is_han, syl in pairs)


def _pinyin(text: str) -> str:
    try:
        return _join_pinyin(_mandarin_syllables(text))
    except Exception:  # noqa: BLE001
        return ""


def _jyutping(text: str) -> str:
    try:
        import ToJyutping
        return ToJyutping.get_jyutping_text(text) or ""
    except Exception:  # noqa: BLE001
        return ""


def _join_zhuyin(pairs) -> str:
    """(is_han, numbered_syllable) pairs → Zhuyin (shared with the heteronym candidates — see _join_pinyin)."""
    from pypinyin.style.bopomofo import converter
    return " ".join(converter.to_bopomofo(syl) if is_han else syl for is_han, syl in pairs)


def _zhuyin(text: str) -> str:
    """Mandarin → Zhuyin/Bopomofo (ㄅㄆㄇㄈ), tone marks included."""
    try:
        return _join_zhuyin(_mandarin_syllables(text))
    except Exception:  # noqa: BLE001
        return ""


# ── Gwoyeu Romatzyh (國語羅馬字) ─────────────────────────────────────────────
# Tonal-spelling logic ported from kungming2/Gwoyeu-Romatzyh-Converter (gr_converter.py,
# https://github.com/kungming2/Gwoyeu-Romatzyh-Converter); the toneless pinyin→GR base table
# is vendored in app/data/gwoyeu_romatzyh.tsv from that repo's _database_romanization_chinese.csv.
# GR encodes tone INTO the spelling, so a numbered-pinyin syllable (from pypinyin) is mapped to its
# GR base and then reshaped per tone.
_GR_BASE: dict[str, str] | None = None


def _gr_base_table() -> dict[str, str]:
    global _GR_BASE
    if _GR_BASE is None:
        _GR_BASE = {}
        try:
            with open(os.path.join(_DATA_DIR, "gwoyeu_romatzyh.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    py, gr = line.rstrip("\n").split("\t", 1)
                    _GR_BASE[py] = gr
        except Exception:  # noqa: BLE001
            pass
    return _GR_BASE


def _gr_vowel_neighbor(letter: str, word: str) -> bool:
    for i, ch in enumerate(word):
        if ch == letter and ((i > 0 and word[i - 1] in "aeiouy") or (i < len(word) - 1 and word[i + 1] in "aeiouy")):
            return True
    return False


def _gr_vowel_preceder(letter: str, word: str) -> bool:
    for i, ch in enumerate(word):
        if ch == letter and i > 0 and word[i - 1] in "aeiouy":
            return True
    return False


def _gr_syllable(numbered: str) -> str:
    """One numbered-pinyin syllable (e.g. ``guang1``) → its Gwoyeu Romatzyh tonal spelling.
    Ported verbatim (tone rules) from gr_converter.zh_word_alt_romanization; unknown syllables pass through."""
    table = _gr_base_table()
    if not numbered or not numbered[-1].isdigit():
        return numbered
    tone = int(numbered[-1])
    py = numbered[:-1].lower().replace("v", "u")   # pypinyin writes ü as "v"; the source table has no n/l ü rows → fall back to the u-spelling
    base = table.get(py)
    if base is None:
        return numbered
    if py[0] in ("w", "y"):
        initial, final = None, py[1:]
    elif len(py) > 1 and py[1] == "h":
        initial, final = py[:1], py[2:]
    else:
        initial, final = py[0], py[1:]
    gr = base
    if tone == 1:
        if initial in ("l", "m", "n", "r"):
            gr = f"{base[0]}h{base[1:]}"
    elif tone == 2:
        if initial in ("l", "m", "n", "r"):
            gr = base
        elif "i" in base and final and final[-1] != "i":
            gr = base.replace("i", "y")
        elif "i" in base and final and final[-1] == "i":
            gr = base.replace("i", "y") + "i"
        elif "u" in base and final and final[-1] != "u":
            gr = base.replace("u", "w")
        elif "u" in base and final and final[-1] == "u":
            gr = base.replace("u", "w") + "u"
        else:
            lv = -1
            for i, ch in enumerate(base):
                if ch in "aeiou":
                    lv = i
            gr = base[:lv + 1] + "r" + base[lv + 1:] if lv != -1 else base
    elif tone == 3:
        if base[0] in "iu":
            gr = base.replace("i", "ye", 1) if base.startswith("i") else base.replace("u", "wo", 1)
        elif "i" in base and "u" in base:
            gr = base.replace("i", "e", 1) if base.index("i") < base.index("u") else base.replace("u", "o", 1)
        elif "i" in base and _gr_vowel_neighbor("i", base) and "ei" not in base:
            gr = base.replace("i", "e", 1)
        elif "u" in base and _gr_vowel_neighbor("u", base) and "ou" not in base and "uo" not in base:
            gr = base.replace("u", "o", 1)
        elif "uo" not in base:
            doubled = False
            res = []
            for ch in base:
                if ch in "aeiouy" and not doubled:
                    res.append(ch * 2)
                    doubled = True
                else:
                    res.append(ch)
            gr = "".join(res)
        else:
            gr = base.replace("o", "oo")
    elif tone == 4:
        if "i" in base and _gr_vowel_preceder("i", base):
            gr = base.replace("i", "y", 1)
        elif "u" in base and _gr_vowel_preceder("u", base):
            gr = base.replace("u", "w", 1)
        elif base.endswith("n") or base.endswith("l"):
            gr = base + base[-1]
        elif base.endswith("ng"):
            gr = base.replace("ng", "nq")
        else:
            gr = base + "h"
        if gr.startswith("i"):
            gr = gr.replace("i", "y", 1) if _gr_vowel_neighbor("i", base) else "y" + gr
        elif gr.startswith("u"):
            gr = gr.replace("u", "w", 1) if _gr_vowel_neighbor("u", base) else "w" + gr
        if gr.endswith("iw"):
            gr = gr.replace("iw", "iuh")
    elif tone == 5:
        gr = py[0] if py in ("me", "ge", "zi") else base   # neutral-tone abbreviations for 麼/個/子
    return gr


def _join_gr(pairs) -> str:
    """(is_han, numbered_syllable) pairs → Gwoyeu Romatzyh (shared with the heteronym candidates —
    see _join_pinyin); syllables within a run of Han characters are concatenated."""
    joined = "".join(_gr_syllable(syl) for _, syl in pairs)
    if "luomaa" in joined:   # sole spelling exception preserved from the source: Roma
        joined = joined.replace("luomaa", "roma")
    return joined


def _gwoyeu(text: str) -> str:
    """Mandarin text → Gwoyeu Romatzyh.  Numbered pinyin (with 不-sandhi already corrected, see
    _mandarin_syllables) supplies each syllable, reshaped into its GR tonal spelling."""
    try:
        return _join_gr(_mandarin_syllables(text))
    except Exception:  # noqa: BLE001
        return ""


# ── Chao's General Chinese (通字 tung-dzih), a diaphonemic romanisation ────────
# One dialect-neutral spelling per character, so Mandarin "General Chinese" and the Cantonese
# "General Chinese" reading resolve to the SAME lookup.  Char→keyword table vendored in
# app/data/tungdzih_keywords.tsv (from the RIME zime project's tungdzih-keywords.txt).
_TUNGDZIH: dict[str, str] | None = None


def _tungdzih_table() -> dict[str, str]:
    global _TUNGDZIH
    if _TUNGDZIH is None:
        _TUNGDZIH = {}
        try:
            with open(os.path.join(_DATA_DIR, "tungdzih_keywords.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    ch, kw = line.rstrip("\n").split("\t", 1)
                    _TUNGDZIH[ch] = kw
        except Exception:  # noqa: BLE001
            pass
    return _TUNGDZIH


# OpenCC simplified↔traditional conversion (opencc-python-reimplemented; pure-Python, installs on 3.12).
_OPENCC: dict[str, object] = {}


def _opencc(config: str):
    if config not in _OPENCC:
        try:
            from opencc import OpenCC
            _OPENCC[config] = OpenCC(config)
        except Exception:  # noqa: BLE001
            _OPENCC[config] = None
    return _OPENCC[config]


def _cc(text: str, config: str) -> str:
    cc = _opencc(config)
    if cc is not None:
        try:
            return cc.convert(text) or text
        except Exception:  # noqa: BLE001
            pass
    return text


def _s2t(text: str) -> str:
    return _cc(text, "s2t")   # simplified → traditional


def _t2s(text: str) -> str:
    return _cc(text, "t2s")   # traditional → simplified


# ── Serbian / Serbo-Croatian Cyrillic ↔ Latin (Gajica) ────────────────────────
# A deterministic, well-defined digraph mapping shared by the South-Slavic digraphia (Serbian, Bosnian,
# Serbo-Croatian): the Cyrillic letters њ љ џ ђ ћ ч ш ж correspond to the Latin digraphs/letters nj lj dž
# đ ć č š ž.  Cyrillic→Latin is unambiguous; Latin→Cyrillic treats nj/lj/dž as digraphs (the standard
# transliteration convention — the rare morpheme-boundary exceptions such as "injekcija"/"nadживети" are
# not disambiguated, matching every deterministic converter; this is a DISPLAY orthography, never MISC).
# Source: the Serbian standard alphabet correspondence (Правопис / Gajica), implemented inline (no data file).
_SR_C2L = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "đ", "е": "e", "ж": "ž", "з": "z", "и": "i",
    "ј": "j", "к": "k", "л": "l", "љ": "lj", "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "ћ": "ć", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "č", "џ": "dž", "ш": "š",
}
_SR_C2L_UP = {   # uppercase; the digraph letters title-case (Њ→Nj) — matching normal mixed-case text
    "Њ": "Nj", "Љ": "Lj", "Џ": "Dž",
}
_SR_L2C = {   # single Latin letters → Cyrillic (digraphs handled separately, longest-match first)
    "a": "а", "b": "б", "c": "ц", "č": "ч", "ć": "ћ", "d": "д", "đ": "ђ", "e": "е", "f": "ф", "g": "г",
    "h": "х", "i": "и", "j": "ј", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "r": "р",
    "s": "с", "š": "ш", "t": "т", "u": "у", "v": "в", "z": "з", "ž": "ж",
}
_SR_DIGRAPH = {"dž": "џ", "lj": "љ", "nj": "њ"}


def _sr_cyr2lat(text: str) -> str:
    out = []
    for ch in text:
        if ch in _SR_C2L_UP:
            out.append(_SR_C2L_UP[ch])
        elif ch in _SR_C2L:
            out.append(_SR_C2L[ch])
        else:
            low = ch.lower()
            out.append(_SR_C2L[low].upper() if low in _SR_C2L else ch)   # any other uppercase Cyrillic
    return "".join(out)


def _sr_lat2cyr(text: str) -> str:
    out = []
    i, n = 0, len(text)
    while i < n:
        two = text[i:i + 2]
        low2 = two.lower()
        if low2 in _SR_DIGRAPH:
            cyr = _SR_DIGRAPH[low2]
            out.append(cyr.upper() if two[0].isupper() else cyr)   # Nj/NJ → Њ ; nj → њ
            i += 2
            continue
        ch = text[i]
        low = ch.lower()
        if low in _SR_L2C:
            c = _SR_L2C[low]
            out.append(c.upper() if ch.isupper() else c)
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _has_cyrillic(text: str) -> bool:
    return any("Ѐ" <= c <= "ӿ" for c in text)


def _to_serbian_latin(text: str) -> str:
    return _sr_cyr2lat(text) if _has_cyrillic(text) else text        # already Latin → identity


def _to_serbian_cyrillic(text: str) -> str:
    return _sr_lat2cyr(text) if any(("a" <= c.lower() <= "z") or c in "čćđšžČĆĐŠŽ" for c in text) else text


def _general_chinese(text: str) -> str:
    table = _tungdzih_table()
    trad = _s2t(text)   # the tung-dzih table is TRADITIONAL-keyed → fold simplified input first
    out = [table.get(ch, ch if not _is_han(ch) else "") for ch in trad]
    return " ".join(x for x in out if x)


# ── Middle Chinese (Baxter) + Old Chinese (Baxter–Sagart) ─────────────────────
# Both come from one table vendored in app/data/baxter_sagart.tsv (Wiktionary's
# "Appendix:Baxter-Sagart Old Chinese reconstruction", Baxter & Sagart v1.00, built by
# tools/build_baxter_index.py): the MC field is Baxter's Middle Chinese transcription (with X/H
# tone letters), the OC field the Baxter–Sagart Old Chinese reconstruction (leading *).
# Characters absent from the table are dropped, never guessed.
#
# ⚠ IT IS A WORD LIST, NOT A CHARACTER LIST — one row per (graph, SOURCE ENTRY), six columns:
#     graph · pinyin · middle_chinese · old_chinese · pos · gloss
# The appendix gives 4,082 words over 4,330 graphs, and 783 of those graphs carry more than one
# word: 547 have more than one Middle Chinese reading and 312 more than one Mandarin one, because
# Old Chinese derived words from words by tone and voicing (數 = *s-roʔ-s "number", *s-roʔ "count",
# *s-rok "frequently").  The file this replaced kept each graph's FIRST row and threw the rest
# away, so every derived word in the appendix was invisible; the loaders below keep them all, and
# `pos` — a UD tag the build script infers from the gloss, empty where the gloss licenses none —
# is what lets a tagged token say which row is meant (see `_pos_render`).
_BAXTER_ROWS: dict[str, list[tuple[str, str, str, str, str]]] | None = None
_BAXTER: dict[str, tuple[str, str]] | None = None
_BAXTER_ANNEX = re.compile(r"\s*\{[^{}]*\}")


def _baxter_rows() -> dict[str, list[tuple[str, str, str, str, str]]]:
    """graph → ``[(pinyin, mc, oc, pos, gloss), …]`` in source order — the ONE read of the vendored
    file, which every other Baxter accessor is a view of.  The OC field is kept VERBATIM here (the
    ``{…}`` annex, the ``~`` variants and the parenthesised editorial notes included); the display
    view is `_baxter_display` and the variant split is `_baxter_variants`.

    A row of fewer than six fields is SKIPPED rather than padded, and the reason is the file this
    replaced: it was three columns (graph, MC, OC), so padding would read its MC as this format's
    pinyin and its OC as the MC — every reconstruction on screen would be one column to the left and
    nothing would look broken.  Skipping leaves the table empty instead, `_scheme_available` then
    reports the mc/oc schemes as unavailable, and the app degrades to offering no Middle/Old Chinese
    rather than to offering the wrong one.  (Nothing but tools/build_baxter_index.py writes this
    file; the guard is against a stale copy surviving in an old bundle.)"""
    global _BAXTER_ROWS
    if _BAXTER_ROWS is None:
        _BAXTER_ROWS = {}
        try:
            with open(os.path.join(_DATA_DIR, "baxter_sagart.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#"):
                        continue
                    p = line.rstrip("\n").split("\t")
                    if len(p) < 6 or not p[0]:
                        continue
                    _BAXTER_ROWS.setdefault(p[0], []).append((p[1], p[2], p[3], p[4], p[5]))
        except Exception:  # noqa: BLE001
            pass
    return _BAXTER_ROWS


def _baxter_display(oc: str) -> str:
    """One OC reconstruction as the transliteration ROW should show it: its ``{…}`` annex dropped.

    2,347 of the appendix's 4,082 OC cells read ``*rˁawk {*[rˁ]awk}`` — the reconstruction, and
    then the same reconstruction again with its uncertain segments bracketed.  That is ONE reading
    written twice, so showing both fills a one-form-wide cell with two forms, and offering the
    braced one through `readings` would offer a notational variant as if it were a choice of
    pronunciation.  It stays in the vendored file all the same, because it is Baxter–Sagart's own
    statement of how certain the reconstruction is and a data file is the wrong place to decide
    that is noise (see tools/build_baxter_index.py).  Everything else the source prints — the
    square brackets and ‹…› of a form that has no annex, the parenthesised dialect notes — is left
    alone: it qualifies the form itself rather than restating it.

    Checked against the char-keyed file this replaced: with the annex off, 4,228 of its 4,330 rows
    reproduce byte-for-byte, and the 102 that do not are ones where the hand vendoring had also
    dropped a parenthesised note or a second ``~`` variant.

    ⚠️ A field that is NOTHING BUT an annex is UNWRAPPED, not emptied.  Five rows print only the
    braced form (婶/嬸 "{*mʔ}", 繩/绳 "{*Cə.ləŋ}", 藉 "{*[dz]Ak-s}"), and there the braces are not
    restating a reconstruction printed beside them — they ARE the reconstruction, and stripping them
    took those graphs' Old Chinese away altogether."""
    plain = " ".join(_BAXTER_ANNEX.sub("", oc).split()).strip()
    return plain or " ".join(oc.replace("{", "").replace("}", "").split()).strip()


def _baxter_variants(field: str, mc: str = "") -> list[str]:
    """One table field → its VARIANT RECONSTRUCTIONS, in source order.  ``mc`` is the row's Middle
    Chinese, and is what tells a two-guesses-at-one-word pair from a root-and-derivative pair — see
    `_drop_derivational_s`, which this defers to before returning.

    ⚠️ THE TILDE IS A SECOND AXIS OF POLYPHONY, NOT THE SAME ONE AS THE MULTIPLE ROWS.  A graph's
    several ROWS are several WORDS (數 "number" / "count" / "frequently"); a ` ~ ` INSIDE one row's
    OC field is two competing reconstructions of THAT one word — 前 is "*dzˁen ~ *m-dzˁen", one
    word whose pre-initial Baxter and Sagart could not settle.  Left unsplit, that pair is rendered
    into the Displayed transliteration cell verbatim, which shows two forms where the row is one form
    wide, and `readings` sees a single-valued field and offers nothing to choose between.  Splitting
    here fixes both at once: _baxter_table keeps variant 0 (so the cell shows ONE reconstruction) and
    _baxter_all lists them all (so the flyout offers the rest).

    RE-CHECKED against the rebuilt word-level table, and the count went up because the collapsed
    one had been hiding some of them on rows it discarded: 33 rows carry a tilde where 14 did, and
    31 split where 13 did.  The 2 that do not split are the same two as before (剌, 泥), and for the
    same reason — their tilde is inside a parenthesis.  The MC column still has no tilde in any row.

    ONLY AT PAREN DEPTH 0.  69 OC rows carry a parenthesised editorial note — dialect derivations,
    uncertainty — and one of them, 剌 "*rˁat (~ C.rˁat ?)", puts a tilde INSIDE it as "or perhaps".
    That is a hedge about one reconstruction, not a second one; a naive split on "~" would cut it into
    the two malformed halves "*rˁat (" and "C.rˁat ?)".  Depth-tracking is what tells the 13 real
    separators from that 1 false one, so the note stays attached to the form it qualifies.

    The leading * is re-asserted because the source omits it on the SECOND variant about half the time
    (塘 "*m.rˁaŋ ~ mə.rˁaŋ", 戒 "*kˁrək-s ~ kˁrək", 竞 "*m-kraŋʔ-s ~ C-kraŋʔ-s").  Every OC form in this
    table is a reconstruction and the column's convention is the star; without this the flyout would
    list "*kˁrək-s" beside "kˁrək" and the second would read as an attestation.  MC is passed through
    untouched — its column has no tilde in any row, and no star convention to restore."""
    parts, depth, cur = [], 0, ""
    for c in field:
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth = max(0, depth - 1)
        if c == "~" and depth == 0:
            parts.append(cur)
            cur = ""
            continue
        cur += c
    parts.append(cur)
    out = []
    for p in parts:
        p = " ".join(p.split())   # the separator is spelled " ~ ", "  ~ " (舵) and "~" — collapse what that leaves
        if not p:
            continue
        if len(parts) > 1 and not p.startswith("*"):
            p = "*" + p
        if p not in out:
            out.append(p)
    return _drop_derivational_s(out, mc)


def _drop_derivational_s(variants: list[str], mc: str) -> list[str]:
    """Collapse a ` ~ ` pair that is a ROOT AND ITS DERIVATIVE back to the one word the row records.

    ⚠️ NOT EVERY TILDE PAIR IS TWO RECONSTRUCTIONS OF ONE WORD.  Of the 31 rows that split, 23 differ
    in a PRE-INITIAL (前 "*dzˁen ~ *m-dzˁen") — one word, two guesses at its prefix, which is what the
    split exists for.  The other 8 differ by exactly the ``-s`` SUFFIX (右 "*m-qʷəʔ-s ~ *m-qʷəʔ"), and
    that is a different relation entirely: ``*-s`` is the 去聲別義 derivational suffix, the morpheme
    that derives a noun from a verb or the reverse.  Root and derivative are two WORDS, so listing the
    bare root among a graph's readings offers something that is not a reading of the word this row is
    about — and the row can only be about one of them, because it carries a single Middle Chinese
    transcription.

    THAT TRANSCRIPTION IS WHAT DECIDES, and it must be consulted rather than the order assumed: ``*-s``
    is precisely the source of the MC departing tone, so a row whose MC ends in the tone letter ``H``
    records the DERIVED form and one that does not records the root.  All 8 are ``H`` rows and 7 keep
    their first variant — but 夏 (MC hæH) is written "*ɡˁraʔ ~ *[g]ˁraʔ-s", root first, so "keep the
    one the file lists first" would have kept the wrong member of the only pair where it differs.

    Tested on the DISPLAY form, since the ``{…}`` annex trails the suffix and hides it (戊 "*muʔ-s
    {*m(r)uʔ-s}"), and applied only to a pair — three variants are not this pattern.  With no ``mc`` to
    judge against, nothing is dropped."""
    if len(variants) != 2 or not mc:
        return variants
    a, b = (_baxter_display(v) for v in variants)
    if a.endswith("-s") == b.endswith("-s"):
        return variants           # both suffixed or neither → a prefix pair, genuinely two guesses at one word
    derived = mc.rstrip().endswith("H")   # departing tone ⇒ this row IS the *-s derivative
    return [variants[0] if a.endswith("-s") == derived else variants[1]]


def _baxter_table() -> dict[str, tuple[str, str]]:
    """graph → the ONE ``(mc, oc)`` pair the transliteration row shows: the graph's FIRST row, and
    that row's first ``~`` variant.  The first row is the appendix's own first-listed word for the
    graph, which is also the only one the char-keyed file this replaced ever carried — so the
    default rendering of every graph is unchanged by the rebuild, and what the rebuild adds reaches
    the user through `readings`, `_baxter_all` and the POS conditioning rather than by silently
    moving what is already on screen."""
    global _BAXTER
    if _BAXTER is None:
        _BAXTER = {}
        for ch, rows in _baxter_rows().items():
            mc, oc = rows[0][1], rows[0][2]
            ocv = _baxter_variants(oc, mc)
            _BAXTER[ch] = (mc, _baxter_display(ocv[0]) if ocv else "")   # variant 0 is what the Displayed row shows; the rest reach the user through `readings` (see _baxter_variants)
    return _BAXTER


def _is_han(ch: str) -> bool:
    return "㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿" or "\U00020000" <= ch <= "\U0003ffff"


def _baxter(text: str, idx: int) -> str:
    """idx 0 = Middle Chinese (Baxter), 1 = Old Chinese (Baxter–Sagart)."""
    table = _baxter_table()
    out = []
    for ch in text:
        if _is_han(ch):
            rec = table.get(ch)
            if rec and rec[idx]:
                out.append(rec[idx])   # only genuine, attested reconstructions
        else:
            out.append(ch)
    return " ".join(x for x in out if x).strip()


# ── Japanese: Kunrei / Modified Hepburn via cutlet ────────────────────────────
_CUTLET: dict[str, object] = {}


def _cutlet_obj(system: str):
    """The cached cutlet romaniser for "kunrei" / "hepburn".  Split out of _cutlet so the reading
    candidates (see `readings`) can reach its tagger — the source of the kana cutlet ITSELF chose."""
    k = _CUTLET.get(system)
    if k is None:
        import cutlet
        k = cutlet.Cutlet(system=system)
        k.use_foreign_spelling = False   # phonemic romaji, not English loanword spellings
        _CUTLET[system] = k
    return k


def _cutlet(text: str, system: str) -> str:
    """Japanese → romaji in the given cutlet system ("kunrei" or "hepburn").  cutlet capitalises the
    first letter (sentence/proper-noun casing); per-token output is lower-cased for a consistent
    transliteration column, matching the all-lower-case pinyin/jyutping layers."""
    try:
        k = _cutlet_obj(system)
        out = k.romaji(text) or ""
        return (out[0].lower() + out[1:]) if out else ""
    except Exception:  # noqa: BLE001
        return ""


# ── Sanskrit external sandhi (saṃhitā) at MWT joins ───────────────────────────
# When a Sanskrit multi-word token's surface form is reconstructed from its component words, the
# joins are fused by EXTERNAL SANDHI rather than concatenated naively (deva + indra → devendra).
# This is a DISPLAY transform on the reconstructed word only; it never rewrites the stored tokens.
#
# The rules operate on the stored IAST/romanised representation and cover the well-defined,
# deterministic core of Paninian external sandhi.  Sources:
#   · Pāṇini, Aṣṭādhyāyī 6.1.77 (yaṇ), 6.1.87 (guṇa: ād guṇaḥ), 6.1.88 (vṛddhi: vṛddhir eci),
#     6.1.101 (savarṇa-dīrgha: akaḥ savarṇe dīrghaḥ), 6.1.109 (eṅaḥ padāntād ati → avagraha),
#     8.3.15/8.2.66 & 8.3.17-22 (visarga → o/r before voiced sounds).
#   · W. D. Whitney, Sanskrit Grammar §126-137 (vowel sandhi), §169-176 (visarga sandhi).
#   · learnsanskrit.org "Sandhi" guide (vowel + visarga tables), cross-checked against the above.
# Coverage / deliberate omissions are documented on _iast_join_pair below.
import unicodedata as _ud

_V_SIMPLE = {"a", "ā", "i", "ī", "u", "ū", "ṛ", "ṝ", "ḷ", "ḹ"}   # monophthong (simple) vowels
_V_DIPH = {"e", "ai", "o", "au"}                                  # diphthongs / guṇa-vṛddhi vowels
_VOWELS = _V_SIMPLE | _V_DIPH
# Word-INITIAL letter is voiced?  (all vowels are voiced; h is voiced; ś/ṣ/s are voiceless.)
_VOICED_INIT = set("gṅjñḍṇdnbmyrlvh")
_VOICELESS_INIT = set("kcṭtpśṣs")
_AVAGRAHA = "'"   # IAST avagraha marking an elided initial a; aksharamukha maps "'" → ऽ


def _final_vowel(s: str):
    for d in ("ai", "au"):
        if s.endswith(d):
            return d
    if s and s[-1] in _VOWELS:   # e, o and every single-char simple vowel
        return s[-1]
    return None


def _initial_vowel(s: str):
    for d in ("ai", "au"):
        if s.startswith(d):
            return d
    if s and s[0] in _VOWELS:
        return s[0]
    return None


# savarṇa (like) grouping: which simple vowels count as "the same" for the long-vowel rule
_SAVARNA = {"a": "a", "ā": "a", "i": "i", "ī": "i", "u": "u", "ū": "u",
            "ṛ": "ṛ", "ṝ": "ṛ", "ḷ": "ḷ", "ḹ": "ḷ"}
_LONG = {"a": "ā", "i": "ī", "u": "ū", "ṛ": "ṝ", "ḷ": "ḹ"}
_YAN = {"i": "y", "ī": "y", "u": "v", "ū": "v", "ṛ": "r", "ṝ": "r", "ḷ": "l", "ḹ": "l"}


def _vowel_join(v1: str, v2: str):
    """String that REPLACES the sequence (v1 immediately followed by v2), or None ⇒ leave unfused.
    v1 is word-A's final vowel, v2 is word-B's initial vowel (both already isolated)."""
    # savarṇa-dīrgha: like + like → the long vowel  (a+a→ā, i+ī→ī, …)   [Aṣṭ. 6.1.101]
    if v1 in _SAVARNA and v2 in _SAVARNA and _SAVARNA[v1] == _SAVARNA[v2]:
        return _LONG[_SAVARNA[v1]]
    if v1 in ("a", "ā"):                     # guṇa / vṛddhi  [Aṣṭ. 6.1.87 / 6.1.88]
        if v2 in ("i", "ī"):
            return "e"
        if v2 in ("u", "ū"):
            return "o"
        if v2 in ("ṛ", "ṝ"):
            return "ar"
        if v2 in ("ḷ", "ḹ"):
            return "al"
        if v2 in ("e", "ai"):
            return "ai"
        if v2 in ("o", "au"):
            return "au"
    # ── the SEPARABLE outcomes ──────────────────────────────────────────────────────────────────
    # Everything above merges two vowels into ONE, which belongs to both words and cannot be split, so
    # those are written solid (`vartma` + `apunar…` → `vartmāpunar…`).  The three below do NOT merge:
    # each leaves a segment on word A and a segment on word B, and standard IAST keeps the word space
    # between them.  `_SEP_AFTER` marks the split point — the caller puts `word_sep` there.
    #   yaṇ / ayādi: the semivowel CLOSES word A     → `dadātv anekakiraṇas`, `ātmety ātmavidāṃ`
    #   avagraha:    the mark OPENS word B           → `tato 'ṅghridvayam`
    # Written solid these read as one word (`ātmetyātmavidāṃ`, `dadātvanekakiraṇas`), which is what
    # this used to produce — and, for the running line, exactly the fault the user reported: yaṇ was
    # being spelt inconsistently against a text that spells it apart.  All three appear that way in
    # this repository's own samples, which is the evidence for the convention.
    if v1 in _YAN:                           # yaṇ: i/u/ṛ/ḷ + dissimilar vowel → semivowel + vowel  [6.1.77]
        return (_YAN[v1], v2)                #   (like-vowel cases already handled by savarṇa above)
    if v1 in ("e", "o") and v2 == "a":       # eṅaḥ padāntād ati: e/o + a → e'/o' (a elided)  [6.1.109]
        return (v1, _AVAGRAHA)
    if v1 in _AYADI:                          # ayādi: e→ay, o→av, ai→āy, au→āv before a vowel  [eco'yavāyāvaḥ 6.1.78]
        return (_AYADI[v1], v2)               #   (the optional śākalya y/v-elision, 8.3.19, is NOT applied)
    return None


_AYADI = {"e": "ay", "o": "av", "ai": "āy", "au": "āv"}


# ── historic r-stems ──────────────────────────────────────────────────────────
# A word whose pada-final visarga is a *rutva* of an underlying r (punar, antar, prātar, svar, …)
# RESTORES that r before a voiced sound, instead of following the ordinary -aḥ→-o / -āḥ→-ā visarga
# sandhi: punaḥ + janmanām → punar + janmanām → punarjanmanām.  Detection signals (either suffices):
#   · the CoNLL-U lemma ends in "r" (an r-stem lemma such as "punar", "antar"); or
#   · the reconstructed stem (the form minus its visarga, + "r") is in this small closed exception set
#     of the common adverbial / nominal r-stems that surface with a final visarga.
# Source: Whitney §169-179 (visarga, rutva, and the r-stems); learnsanskrit.org visarga-sandhi table.
_R_STEMS = {
    "punar", "antar", "prātar", "svar", "ahar", "dvār", "gir", "gīr", "pur", "dhur", "vār",
}


def _is_rstem(pre: str, lemma) -> bool:
    """Does the visarga on this word restore to r before a voiced sound?  ``pre`` = the visarga-
    bearing WORD (its own surface form, minus ḥ — not the whole fused run); ``lemma`` = its CoNLL-U
    lemma (or None).  Either signal — an r-final lemma, or the reconstructed stem in _R_STEMS — fires."""
    if lemma:
        lm = _ud.normalize("NFC", str(lemma)).strip().lower()
        if lm.endswith("r"):
            return True
    return (pre + "r") in _R_STEMS


def _visarga_join(a: str, b: str, lemma=None, a_form=None, sep=""):
    """Word-A ends in visarga (ḥ); fuse with word-B, or return None ⇒ leave unfused (keep ḥ).
    ``sep`` is inserted at the boundary for the SEPARABLE outcomes: visarga sandhi transforms A's
    ending (-o / -ā / -r / sibilant) but leaves TWO distinct segments, so the running line keeps a
    WORD SEPARATION (``ahaḥ`` → o, ``bhṛtaḥ + vartmā`` → ``bhṛto vartmā`` — a space), while an MWT
    passes ``sep=""`` and the two segments abut.  The genuine MERGES — the avagraha (``-aḥ + a →
    -o'``) and the r-r coalescence (``-Vḥ + r- → -Vr-``) — never take ``sep`` (the words fuse).
    ``lemma`` = the CoNLL-U lemma of the word contributing A's trailing visarga; ``a_form`` = that
    word's OWN surface form (so the r-stem lookup ignores any prefix already glued onto A, e.g. in
    "a"+"punaḥ" → "apunaḥ" the r-stem test still sees "punaḥ")."""
    pre = a[:-1]                              # the fused run without its ḥ (drives the OUTPUT spelling)
    rpre = (a_form[:-1] if (a_form and a_form.endswith("ḥ")) else pre)   # the visarga-word's own pre (drives r-stem DETECTION)
    fv = _final_vowel(pre)                    # vowel before the visarga
    if not b:
        return None
    biv = _initial_vowel(b)
    b0 = b[0]
    voiced = (biv is not None) or (b0 in _VOICED_INIT)
    if not voiced:                            # ── visarga before a VOICELESS sound  [Whitney §170-172]
        if b0 == "c":                         #   + c/ch → -ś C (palatal sibilant)   e.g. agniḥ + ca → agniś ca
            return pre + "ś" + sep + b
        if b0 == "ṭ":                         #   + ṭ/ṭh → -ṣ C (retroflex sibilant)
            return pre + "ṣ" + sep + b
        if b0 == "t":                         #   + t/th → -s C (dental sibilant)   e.g. rāmaḥ + tu → rāmas tu
            return pre + "s" + sep + b
        return None                           #   + k/kh, p/ph, ś/ṣ/s → ḥ retained (unfused)
    if fv in ("a", "ā") and b0 != "r" and _is_rstem(rpre, lemma):   # r-stem: restore r before a voiced sound OTHER than r-
        return pre + "r" + sep + b            #   punaḥ + janmanām → punar janmanām; dvāḥ → dvār …; punaḥ + api → punar api
        # NB: before r- itself the r-stem restoration is SKIPPED (it would double the r, e.g. ahaḥ+rātra
        # → *aharrātra); the -aḥ/-āḥ visarga rules below instead give -o/-ā (ahaḥ + rātra → aho rātra).
    if fv == "a":                             # -aḥ …  (ordinary a-stem, non-r-stem)
        if biv == "a":                        #   + a → -o' (a elided) — a genuine MERGE (avagraha), no sep   [8.3.17ff + 6.1.109]
            return pre[:-1] + "o" + _AVAGRAHA + b[1:]
        if biv is not None:                   #   + other vowel → hiatus (…a V), ambiguous → unfused
            return None
        return pre[:-1] + "o" + sep + b       #   + voiced consonant → -o C (separable: keeps the word boundary)
    if fv == "ā":                             # -āḥ …  (ordinary ā-stem, non-r-stem)
        if biv is None:                       #   + voiced consonant → -ā C (ḥ dropped, separable)
            return pre + sep + b
        return None                           #   + any vowel → hiatus
    if fv in ("i", "ī", "u", "ū", "e", "o", "ṛ", "ṝ"):   # -iḥ/-uḥ/… (non-a/ā vowel + ḥ)
        if b0 != "r":                         #   + voiced sound (≠ r) → -r + B (rutva, separable)   [8.3.15]
            return pre + "r" + sep + b
        return _lengthen_final_vowel(pre) + b   #   + r- → drop the visarga-r, lengthen X, MERGE (-iḥ r- → -īr-)
    return None


def _iast_join_pair(a: str, b: str, a_lemma=None, a_form=None, word_sep: str = "") -> str:
    """Fuse two IAST words at their boundary by external sandhi.  ``a_lemma`` = word-A's CoNLL-U
    lemma (an r-stem signal for visarga).  Coverage:
      · vowel sandhi — savarṇa-dīrgha, guṇa, vṛddhi, yaṇ, and e/o + a (avagraha);
      · visarga sandhi — -aḥ/-āḥ + voiced → -o/-ā (with r-stem restoration to -ar/-ār), -Vḥ + voiced
        → -Vr (rutva), -aḥ + a → -o', and visarga before a voiceless c/ṭ/t → the matching sibilant.
    When NO sandhi transformation fuses the two words, they stay a naive junction.  ``word_sep`` is
    what goes at that junction: "" glues them (an MWT is a single spaceless token — the default), while
    the block-initial running text passes " " so a genuinely un-coalescing junction keeps a WORD
    SEPARATION (e.g. ``eke vāñchanti`` — a vowel-final word before a consonant — must NOT merge into
    ``ekevāñchanti``).  Only real consonant-gluing (item 18 preprocessing) and the vowel/visarga
    transformations that legitimately fuse remove the boundary; every other junction keeps ``word_sep``.
    These stay a plain junction (never fused): consonant-cluster sandhi (final -m→ṃ, -t assimilation,
    etc.), visarga before k/p/sibilant (ḥ retained), and any hiatus (diphthong/long-vowel + vowel,
    -aḥ + non-a vowel, and a vowel-final word before a consonant).
    A NEWLINE is a hard break: it is never a vowel/visarga at the boundary, so no junction fires
    across it (sandhi joins only words on the SAME line), it is preserved verbatim, and — being the
    separation itself — no ``word_sep`` is inserted on either side of it."""
    a = _ud.normalize("NFC", a or "")
    b = _ud.normalize("NFC", b or "")
    if not a or not b:
        return a + b
    # the separator for a NON-fusing junction: word_sep, except around a hard \n (the newline itself
    # separates the words, so no extra space is added on either side of it).
    sep = "" if (a.endswith("\n") or b.startswith("\n")) else word_sep
    if a.endswith("ḥ"):
        r = _visarga_join(a, b, a_lemma, a_form, sep)   # sep threaded in: separable outcomes keep the word boundary
        return r if r is not None else a + sep + b
    fv, iv = _final_vowel(a), _initial_vowel(b)
    if fv and iv:
        repl = _vowel_join(fv, iv)
        if isinstance(repl, tuple):          # a SEPARABLE outcome — the word boundary survives it
            return a[:-len(fv)] + repl[0] + sep + repl[1] + b[len(iv):]
        if repl is not None:
            return a[:-len(fv)] + repl + b[len(iv):]
    return a + sep + b


# ── item 18: block-initial external-sandhi PREPROCESSING (run before the sandhi fold) ────────────
# Each word is cleaned, then consonant-final words are glued onto the following word, and only THEN
# is external sandhi applied.  In order:
#   (a) strip the avagraha-style apostrophes ' and "/”, the hyphen -, and WORD-INTERNAL pipes | (a bare
#       daṇḍa token "|"/"||" is all-pipes → left intact so it still renders as punctuation);
#   (b) normalise circumflex vowels — â→ā (macron-LONG), but ê→e, ô→o, î→ī, û→ū (drop the circumflex,
#       keep the base vowel);
#   (c) JOIN (concatenate, no sandhi between them) any word ending in a CONSONANT to the FOLLOWING word;
#       a word ending in a VOWEL, ḥ (visarga) or ṃ (anusvāra) is NOT joined.  Never merge across a
#       newline (a hard break).
_CIRCUMFLEX = {"â": "ā", "î": "ī", "û": "ū", "ê": "e", "ô": "o",
               "Â": "Ā", "Î": "Ī", "Û": "Ū", "Ê": "E", "Ô": "O"}
_NON_MERGE_END = ("ḥ", "ṃ", "ṁ")   # visarga / anusvāra → the word is NOT glued to the next


# CSL/CSX encodes avagraha (elided vowel) and sandhi boundaries with apostrophes/quotes — both ASCII
# (' ") and the curly forms (’ ‘ ” “).  All are stripped so the words glue cleanly (aksharamukha would
# otherwise render a stray ’ as an avagraha ऽ).
_APOS_QUOTES = ("'", '"', "’", "‘", "”", "“")   # ' " ’ ‘ ” “  — elision marks, DELETED before gluing (an elided
#   final vowel then surfaces consonant-final and glues onto the next word: vartm” → vartm → vartmāpunar…)


def _sandhi_preclean(w: str) -> str:
    """Item 18 (a)+(b): fold circumflex vowels and strip apostrophes/quotes (ASCII AND curly), hyphens
    and word-internal pipes from one word.  A daṇḍa-only token (all pipes) is returned unchanged."""
    w = _ud.normalize("NFC", w or "")
    w = "".join(_CIRCUMFLEX.get(ch, ch) for ch in w)          # (b) circumflex → base vowel
    for q in _APOS_QUOTES:                                    # (a) single/double apostrophes (elision marks), ASCII + curly —
        w = w.replace(q, "")                                  #     DELETED before gluing, so an elided vowel-final word (vartm”)
    w = w.replace("-", "")                                    #     surfaces consonant-final and glues on (vartm → vartmāpunar…)
    # …and "=", the CLITIC seam, for the same reason the hyphen goes: it marks a boundary INSIDE a word, so
    # it is not a letter of the word and must not reach the fused surface.  It is written into a component's
    # FORM on purpose — openConvertMWT reads it to split the token without asking how many pieces — and while
    # it sits there everything derived from that form used to carry it: the range fused to
    # `vartmāpunar=janmanām`, its Devanagari rendering to `वर्त्मापुनर्=जन्मनाम्`, and `# text` with them.
    # The three marks now come out together, which is what makes typing a seam a note to the SPLITTER rather
    # than an edit to the word.
    w = w.replace("=", "")
    if any(c != "|" for c in w):                             # (a) word-INTERNAL pipes; keep a bare "|"/"||" daṇḍa
        w = w.replace("|", "")
    return w


def _ends_in_consonant(w: str) -> bool:
    """True ⇒ ``w`` ends in a consonant (so item 18 (c) glues it to the next word).  A trailing vowel
    (incl. e/o/ai/au), visarga ḥ, anusvāra ṃ, or a newline / non-letter is NOT a merge trigger."""
    if not w or w[-1] == "\n":
        return False
    if w.endswith(_NON_MERGE_END) or _final_vowel(w) is not None:
        return False
    return w[-1].isalpha()


# IAST word-initial vowels — ai/au begin with "a", so testing the FIRST character alone is enough.
_INITIAL_VOWELS = frozenset("aāiīuūṛṝḷḹeoAĀIĪUŪṚṜḶḸEO")


def _starts_with_consonant(w: str) -> bool:
    """True ⇒ ``w`` begins with a consonant (its first letter is not an IAST initial vowel).  Drives the
    word-final-m → anusvāra rule: -m assimilates to ṃ only when the FOLLOWING word starts with one."""
    if not w:
        return False
    c = _ud.normalize("NFC", w)[0]
    return c.isalpha() and c not in _INITIAL_VOWELS


def _glue_after(raw: str) -> bool:
    """Item 6: True ⇒ the ORIGINAL (uncleaned) form ends in a compound-member marker — a trailing hyphen
    ``-`` or a word-internal trailing pipe ``|`` — so it was hyphen-/pipe-separated from the NEXT word
    and must glue onto it UNCONDITIONALLY (even when vowel-final).  A bare daṇḍa token (all pipes, e.g.
    "|"/"||") is punctuation, not a marker; a trailing newline is a hard break, never a glue marker."""
    if not raw or raw.endswith("\n"):
        return False
    if raw.endswith("-"):
        return True
    return raw.endswith("|") and any(c != "|" for c in raw)


def _glue_before(raw: str) -> bool:
    """Item 6: True ⇒ the ORIGINAL (uncleaned) form begins with a compound-member marker — a leading
    hyphen or word-internal leading pipe — so the PRECEDING word was hyphen-/pipe-separated from it and
    glues onto it unconditionally.  A bare daṇḍa token / a leading newline is not a marker."""
    if not raw or raw.startswith("\n"):
        return False
    if raw.startswith("-"):
        return True
    return raw.startswith("|") and any(c != "|" for c in raw)


def _sandhi_preprocess(pairs):
    """Item 18: clean each (form, lemma) pair, then chain-glue consonant-final words onto the following
    word (never across a newline).  The merged unit keeps the LAST component's lemma (it drives the
    trailing-boundary visarga/r-stem behaviour).  Item 6: a word originally separated from the next by
    a HYPHEN or PIPE (a trailing marker on it, or a leading marker on the next) is ALSO glued on
    unconditionally — even when vowel-final — so a compound member never keeps a word_sep space."""
    # cleaned entries carry the boundary markers read off the ORIGINAL form (before hyphen/pipe stripping)
    cleaned = []
    for f, lm in pairs:
        cw = _sandhi_preclean(f)
        if cw:
            raw = _ud.normalize("NFC", f or "")
            cleaned.append((cw, lm, _glue_after(raw), _glue_before(raw)))
    merged, i, n = [], 0, len(cleaned)
    while i < n:
        w, lm, glue_after, _ = cleaned[i]
        while (i + 1 < n and "\n" not in cleaned[i + 1][0]
               and (_ends_in_consonant(w) or glue_after or cleaned[i + 1][3])):
            nw, lm, glue_after, _ = cleaned[i + 1]   # item 6: adopt the newly-glued component's trailing marker
            if w and w[-1] in _VOICE_FINAL and _starts_voiced(nw):
                w = w[:-1] + _VOICE_FINAL[w[-1]] + nw   # item 15: word-final voiceless stop → voiced before a voiced onset (sat+ādi → sadādi)
            elif w and w[-1] == "n" and _final_vowel(w[:-1]) in ("a", "i", "u", "ṛ", "ḷ") and _initial_vowel(nw) is not None:
                w = w[:-1] + "nn" + nw                  # -n after a SHORT vowel + V → -nn V (asmin + eva → asminn eva)
            else:
                w += nw
            i += 1
        merged.append((w, lm))
        i += 1
    return merged


def _glue_consonant_runs(text: str, sep: str) -> str:
    """THE LAST STEP (running line only): glue any word ending in a TRUE consonant — not visarga ḥ
    or anusvāra ṃ/ṁ — onto the following word, so a word that BECAME consonant-final under the
    vowel/visarga sandhi above (e.g. the r-stem/rutva ``punaḥ`` → ``punar`` → ``punarjanmanām``) also
    glues.  Consonant sandhi at the join: a word-final voiceless stop voices before a voiced onset
    (sat → sad), and a word-final -n after a short vowel doubles before a vowel (-n V → -nn V)."""
    if not sep or sep.strip() != "":
        return text
    parts = text.split(sep)
    if len(parts) < 2:
        return text
    out = parts[0]
    for w in parts[1:]:
        last = out[-1] if out else ""
        cons_final = (out and not out.endswith("\n") and last.isalpha()
                      and last not in ("ḥ", "ṃ", "ṁ") and _final_vowel(out) is None)
        if not (cons_final and w and any(c.isalpha() for c in w)):   # not a true-consonant ender, or w is punctuation/daṇḍa
            out += sep + w
            continue
        if last in _VOICE_FINAL and _starts_voiced(w):
            out = out[:-1] + _VOICE_FINAL[last] + w          # voiceless stop → voiced
        elif last == "n" and _final_vowel(out[:-1]) in ("a", "i", "u", "ṛ", "ḷ") and _initial_vowel(w) is not None:
            out = out[:-1] + "nn" + w                        # -n after a SHORT vowel + V → -nn V
        else:
            out += w                                          # plain consonant gluing
    return out


def sa_stored_script(forms) -> str:
    """The Brahmic script ``forms`` are WRITTEN in, as an aksharamukha target name, or "" for IAST.

    A Sanskrit file stores its FORM/LEMMA columns in one of two scripts — the model romanises
    Devanagari input internally but puts Devanagari back in FORM, per the UD convention — and the
    sandhi engine below is written in IAST and only in IAST.  So the fold has to romanise on the way
    in and write back on the way out, and this is the one place that names the script to write back
    to.  Read off the FORMS themselves rather than passed in: which script a word is written in is
    a property of the word, so no caller can get it wrong and no parameter can go stale."""
    for f in forms or []:
        if f and _is_indic(f):
            try:
                from aksharamukha import transliterate as ak
                src = ak.auto_detect(f) if hasattr(ak, "auto_detect") else ""
                if src and src not in ("IAST", "HK", "Zyyy"):
                    return src
            except Exception:  # noqa: BLE001
                return "Devanagari"   # it IS Indic; Devanagari is the only script the parser emits
            return "Devanagari"
    return ""


def sandhi_join(forms, lang: str = "sa", lemmas=None, word_sep: str = "",
                prev: str = "", nxt_word: str = "", pause_after: bool = False) -> str:
    """Assemble ``forms`` (a multi-word token's component words) into one surface string, fusing the
    joins by external sandhi for Sanskrit.  Non-Sanskrit ⇒ naive concatenation.  Left-folded pairwise.
    ``lemmas`` (optional, parallel to ``forms``) supplies each word's CoNLL-U lemma as an r-stem
    signal for visarga sandhi.  ``word_sep`` is what a NON-fusing junction keeps: "" glues the words
    (an MWT is one spaceless token — the default), while a running line passes " " so
    a genuinely un-coalescing junction (e.g. a vowel-final word before a consonant, ``eke vāñchanti``)
    stays two words rather than merging into one.  A newline in the stream is a hard break (see
    _iast_join_pair): sandhi never fires across it, newlines are kept (so multi-line input stays
    multi-line), and no word_sep is added around it.  Item 18: the words are PREPROCESSED
    (circumflex/apostrophe/hyphen/pipe cleanup + consonant-final gluing) before the sandhi fold.

    The result comes back IN THE SCRIPT THE FORMS WERE GIVEN IN (`sa_stored_script`), because it is
    the multi-word token's own FORM column and must match the rest of the file: fusing a Devanagari
    document's components into IAST would put two scripts in one document.  Devanagari in, sandhi
    reckoned in IAST, Devanagari out."""
    pairs = [(f, (lemmas[i] if lemmas and i < len(lemmas) else None))
             for i, f in enumerate(forms or []) if f]
    if not pairs:
        return ""
    if _canon_lang(_norm(lang)) != "sa":
        return "".join(f for f, _ in pairs)
    script = sa_stored_script([f for f, _ in pairs])
    if script:   # romanise on the way in — the fold below reads IAST letters and nothing else
        pairs = [(_render_one(f, lang, "iast") or f,
                  (_render_one(lm, lang, "iast") or lm) if lm else lm) for f, lm in pairs]
    pairs = _sandhi_preprocess(pairs)   # item 18: clean + glue consonant-final words, then fuse
    if not pairs:
        return ""
    out, out_lemma = pairs[0]
    out_form = pairs[0][0]   # the surface form of the word contributing out's trailing visarga (ignores glued prefixes)
    for nxt, lm in pairs[1:]:
        out = _iast_join_pair(out, nxt, out_lemma, out_form, word_sep)   # out_lemma/out_form = the word contributing out's final visarga
        out_lemma, out_form = lm, nxt
    fused = _ud.normalize("NFC", _glue_consonant_runs(out, word_sep))   # LAST step: glue any (now) consonant-final words
    # The neighbours are reckoned in IAST like everything else in this fold, so a Devanagari document's
    # context words are romanised on the way in exactly as its components were.
    lo = (_render_one(prev, lang, "iast") or prev) if (prev and script) else prev
    ro = (_render_one(nxt_word, lang, "iast") or nxt_word) if (nxt_word and script) else nxt_word
    fused = _boundary_sandhi(fused, lo, ro, out_lemma, out_form, pause_after)
    return (_render_one(fused, lang, script) or fused) if script else fused


def _boundary_sandhi(inner: str, prev: str, nxt: str, last_lemma, last_form,
                     pause_after: bool = False) -> str:
    """Apply the NON-COALESCENT external sandhi at a multi-word token's OUTER edges.

    An MWT is one orthographic word inside a running line, and a word's first and last segments are
    shaped by the words either side of it — not only by its own components.  Fusing the components
    alone therefore spells the two ends in PAUSA, which is the one place they are never spelt that
    way in a real text: measured over `samples/brihat_jataka.conllu`, that is 5 of 32 ranges, and
    every one of them is an edge (`vāsaḥ bhṛtaḥ` ends `…bhṛto` before a voiced consonant, `aṅghri…`
    opens `'ṅghri…` after an -o, `caraṇāḥ` → `caraṇāś` before c-, `bhavanam` → `bhavanaṃ` before a
    consonant, `iti` → `ity` before a vowel).

    ⚠ NON-COALESCENT ONLY, and the test for that is STRUCTURAL rather than a list of rules to keep in
    step with `_iast_join_pair`: run the ordinary pairwise join against the neighbour and accept the
    result only where THE NEIGHBOUR COMES BACK WHOLE — still a substring of the join, at the end (for
    a right neighbour) or the start (for a left one).  That is exactly what "did not coalesce" means:
    the two words are still two, so whatever changed changed on OUR side and is ours to write down.
    Where they merged (a vowel coalescence — `vartma` + `apunar…` → `vartmāpunar…`, in which `apunar`
    no longer occurs) the boundary belongs to neither word alone and there is nothing to put in ONE
    range's form; the components stay as they are and the merge shows in `# text`, which is where a
    fact about two words belongs.  `app/sa_notation.py` draws the same line for CSL from the other side.

    Testing for a surviving word SEPARATOR would not do, and that is the trap here: `_iast_join_pair`
    drops the separator on any junction it transforms, so `horeti`+`ahorātravikalpam` comes back as
    `horetyahorātravikalpam` — one string, but with the neighbour plainly intact inside it.  Keying on
    the separator called that a coalescence and refused precisely the yaṇ and avagraha junctions this
    function exists to apply.
    """
    if not inner:
        return inner
    if nxt:
        rn = _ud.normalize("NFC", nxt)
        joined = _ud.normalize("NFC", _iast_join_pair(inner, nxt, last_lemma, last_form, ""))
        if rn and joined.endswith(rn) and len(joined) > len(rn):
            inner = joined[:-len(rn)]
        # …plus the ONE non-coalescent rule `_iast_join_pair` deliberately leaves out (its own
        # docstring lists final -m→ṃ among the junctions it never fuses, because inside the fold it
        # would fire between an MWT's own components, where the word has not ended).  At the RANGE's
        # outer edge the word HAS ended, and this is the commonest visible junction of the lot:
        # `…bhavanam` is written `…bhavanaṃ` before a following consonant.
        # ⚠ NOT ACROSS A PAUSE, and that is the one place it parts company with the visarga rules
        # above.  A daṇḍa is transparent to visarga sandhi in this data — `…hṛtkroḍavāsobhṛto |⏎bastir`
        # takes its -o from `bastir`, a daṇḍa and a line break away — but -m before a pause simply
        # stays -m: `…arajyotiṣām |`, `…'ṅghridvayam |`.  Assimilation needs the consonant to actually
        # follow; a visarga is being voiced by the phrase, which a written pause does not interrupt.
        if inner.endswith("m") and not pause_after and _starts_with_consonant(rn):
            inner = inner[:-1] + "ṃ"
    if prev:
        lp = _ud.normalize("NFC", prev)
        joined = _ud.normalize("NFC", _iast_join_pair(prev, inner, None, prev, ""))
        if lp and joined.startswith(lp) and len(joined) > len(lp):
            inner = joined[len(lp):]
    return inner


def sandhi_to_script(forms, lang: str, scheme: str = "", lemmas=None, word_sep: str = "",
                     prev: str = "", nxt_word: str = "", pause_after: bool = False) -> str:
    """Sanskrit MWT DISPLAY form: fuse the component forms by sandhi, THEN convert the fused string
    to the chosen script (scheme).  Empty scheme ⇒ the fused form in the document's own script (i.e.
    exactly `sandhi_join`), which is what "Script: Original" asks for.  Newlines in the fused string
    are preserved through the script conversion (multi-line input stays multi-line).
    ``word_sep`` (see sandhi_join) keeps a word separation at non-coalescing junctions for a running
    line ("" for a spaceless MWT); aksharamukha preserves the space through the script conversion."""
    fused = sandhi_join(forms, lang, lemmas, word_sep, prev, nxt_word, pause_after)
    if not fused or not scheme:
        return fused
    return _render_one(fused, lang, scheme) or fused


# Item 15: word-final voiceless stop → its voiced counterpart before a following voiced sound.
# The five IAST voiceless stops and their voiced pairs: k→g, c→j, ṭ→ḍ, t→d, p→b.  A word-final
# member voices before a vowel or a voiced consonant (e.g. ``sat ādi`` → ``sadādi``); before a
# voiceless sound or a pause it stays voiceless.  (Whitney §159; learnsanskrit.org consonant-sandhi.)
_VOICE_FINAL = {"k": "g", "c": "j", "ṭ": "ḍ", "t": "d", "p": "b"}


def _starts_voiced(w: str) -> bool:
    """True ⇒ ``w`` begins with a VOICED sound — a vowel, or a voiced consonant (g ṅ j ñ ḍ ṇ d n b m
    y r l v h).  Drives the item-15 final-stop voicing (voicing fires only before a voiced onset)."""
    if not w:
        return False
    return _initial_vowel(w) is not None or w[0] in _VOICED_INIT


def _lengthen_final_vowel(s: str) -> str:
    """Lengthen a short final simple vowel (a→ā, i→ī, u→ū, ṛ→ṝ, ḷ→ḹ); anything else is returned as-is.
    Used for the visarga-before-r case, where the visarga's r is dropped and the vowel compensates."""
    fv = _final_vowel(s)
    if fv in _LONG:
        return s[:-1] + _LONG[fv]
    return s


_AKSHARA_SCRIPTS = [   # (scheme id = aksharamukha target name, display label); Devanagari first (the
    # default), everything else alphabetical BY DISPLAY LABEL so the list reads the way it's shown.
    ("Devanagari", "Devanagari"),
    # Himalayan/Buddhist-manuscript scripts with a real Sanskrit-writing tradition: Newa (Newar Hindu/
    # Buddhist Skt. manuscripts, Kathmandu Valley), Nandinagari (a Nagari VARIANT devised specifically
    # for Sanskrit śāstra in South India — its whole raison d'être), Tirhuta (Maithili-Brahmin Vedic/
    # Puranic Skt. manuscripts, Mithila), Bhaiksuki ("monastic script", invented expressly for Buddhist
    # Sanskrit manuscripts), Soyombo (designed by the 17th-c. Mongolian polymath Zanabazar explicitly
    # to transcribe Sanskrit, alongside Tibetan/Mongolian). Southeast Asian scripts with genuine
    # Sanskrit(/Pali) epigraphic or manuscript history: Khmer (Angkor-era Sanskrit inscriptions),
    # Balinese (Sanskrit mantras in the Kawi-Balinese literary tradition), Javanese (Old Javanese
    # Kawi-script Sanskrit inscriptions/kakawin), Cham (Champa kingdom Sanskrit inscriptions — Unicode
    # even names Cham's own daṇḍa "CHAM PUNCTUATION DANDA"), Tai Tham/Lanna (Lan Na & Lao Buddhist
    # Pali-Sanskrit palm-leaf tradition), Burmese/Myanmar (Pali canon plus Brahmanical Sanskrit mantra
    # texts), Thai (Thai-script Pali Tipitaka since the Rama V edition, and Sanskrit royal/Brahmin
    # ritual texts — rendered here via the same PHINTHU-below convention Thai Buddhist printing has
    # long used for Skt./Pali clusters, not a hack). Lao was deliberately NOT added: the script
    # historically used there for Pali/Sanskrit sacred texts is the separate Tham (Akson Tham) script
    # — i.e. Tai Tham above, already covered — while everyday Lao script has no real convention for
    # Sanskrit consonant clusters (aksharamukha just approximates them with inserted vowels, unlike
    # Thai's PHINTHU). South Asian, outside the groups above: Sinhala carries a real, if secondary,
    # Sanskrit scholarly tradition (Sanskrit grammar/kāvya study and Brahmanical ritual texts by
    # Sinhala monks and pandits, alongside its primary Pali role) and renders Sanskrit conjuncts
    # cleanly (ZWJ-joined consonant ligatures, e.g. "brahmavidyā" → a proper "br" ligature). All of
    # the above have real, distinct Unicode blocks with a matching Noto Sans font already bundled
    # under web/fonts/, verified by rendering conjunct-heavy Sanskrit ("kṛṣṇa", "dharmakṣetre")
    # through aksharamukha with no errors and legible virama/conjunct forms. Kawi and Zanabazar
    # Square were ORIGINALLY tried and dropped for rendering visibly broken, but for two DIFFERENT
    # reasons that only looked alike at a glance. Kawi's was a shaping/positioning defect (malformed,
    # sometimes-clipped conjuncts) traced to diagram-core.js's meas(): it measured token width with
    # canvas measureText(), which on WebKit kept returning the PREVIOUS script's stale glyph advances
    # for a few renders after a script/font swap, so conjunct clusters got laid out against the wrong
    # width. meas() was rewritten to measure through a detached SVG <text> + getComputedTextLength()
    # — the same shaping/rendering path the diagrams actually paint with — which eliminates that
    # staleness class of bug outright. Kawi was retested after that fix (aksharamukha IAST→Kawi on
    # "kṛṣṇa"/"dharmakṣetre" plus a real sentence from samples/brihat_jataka.conllu, rendered in
    # stemma/arcs/brackets) and now comes out clean: well-formed subjoined/stacked conjuncts, no
    # overlap or clipping, vowel signs correctly placed.
    #
    # Zanabazar Square's failure was tofu (missing-glyph boxes), a completely different symptom with
    # a completely different cause — no face covered the script at all, so the meas() fix could not
    # have touched it and wasn't assumed to. Root cause: Google's CSS2 API (app/fonts.py's fetch())
    # defaults to a VARIABLE weight-axis query (:wght@100..900); "Noto Sans Zanabazar Square" is a
    # static, weight-400-only family (unlike most Noto Sans <Script> faces), so that query 400s with
    # "Font family not found" and — at whatever point this was last tried — nothing rendered at all,
    # just system fallback with no glyphs anywhere on the machine for U+11A00-U+11A47. fonts.py already
    # carries a second, weight-less template (CSS_API_STATIC) it falls back to on exactly this kind of
    # failure; retesting today confirmed that fallback already resolves Zanabazar Square correctly —
    # fonts.fetch("Noto Sans Zanabazar Square") returns a real woff2 (verified with fontTools: all 72
    # assigned codepoints of the block present in its cmap, U+11A00 through U+11A47). Retested the same
    # way as Kawi (aksharamukha IAST->ZanabazarSquare on "kṛṣṇa"/"dharmakṣetre" plus
    # samples/brihat_jataka.conllu s1, rendered in stemma/arcs/brackets with that fetched face injected
    # as the @font-face fontload.js injects at runtime): no tofu, clean subjoined-conjunct stacking with
    # no overlap into the line below even at the DEFAULT line-height (unlike Kawi/Grantha/Javanese/
    # Balinese, it does not need the .stext-stacked treatment). Both are reinstated below.
    ("Balinese", "Balinese"), ("Bengali", "Bengali"), ("Bhaiksuki", "Bhaiksuki"),
    ("Burmese", "Burmese"), ("Cham", "Cham"), ("Grantha", "Grantha"),
    ("Gujarati", "Gujarati"), ("Javanese", "Javanese"), ("Kannada", "Kannada"),
    ("Kawi", "Kawi"),
    ("Khmer", "Khmer"), ("Malayalam", "Malayalam"), ("Nandinagari", "Nandinagari"),
    ("Newa", "Newa"), ("Oriya", "Odia"),
    # Ranjana: a Newar Buddhist-manuscript script (Kathmandu Valley, closely related to Newa/Lantsa)
    # with a genuine, centuries-old Sanskrit-writing tradition — but with NO dedicated Unicode block
    # of its own (unlike its sibling Newa above, which got one in Unicode 9.0). aksharamukha's
    # "Ranjana" target reflects that: it emits ordinary Devanagari codepoints (verified — same output
    # as its Devanagari target, byte for byte), not some Ranjana-specific encoding. That would
    # normally be a reason to leave it out (a generic Devanagari font would draw those codepoints as
    # Devanagari, not Ranjana), but the Nithya Ranjana DU font (github.com/EkType/Nithya-Ranjana, SIL
    # OFL 1.1, vendored at web/fonts/nithyaranjana.otf) is built exactly for this: it reuses Devanagari
    # Unicode codepoints as its cmap but draws genuine Ranjana glyphshapes, with real conjunct-forming
    # OpenType features (akhn/cjct/half/rkrf/blws/abvs/psts/pres — checked via fontTools, not assumed).
    # Selecting it requires a SCHEME-scoped font override, since the codepoints alone can't disambiguate
    # "Devanagari" from "Ranjana" — see web/styles/fonts.css and mac-tokens.css's data-scheme hook.
    ("Ranjana", "Ranjana"),
    ("Sharada", "Sharada"), ("Siddham", "Siddham"),
    ("Sinhala", "Sinhala"), ("Soyombo", "Soyombo"), ("TaiTham", "Tai Tham"),
    ("Telugu", "Telugu"), ("Thai", "Thai"), ("Tibetan", "Tibetan"), ("Tirhuta", "Tirhuta"),
    ("ZanabazarSquare", "Zanabazar"),
]


# Per-script daṇḍa / double-daṇḍa glyphs.  A daṇḍa is written into romanised Sanskrit as "|" or "/",
# a double daṇḍa as "||", "//" or the single "‖" glyph (U+2016, the daṇḍa DISPLAY form the front end
# folds "||"/"//" into).  Most Brahmic scripts share the Devanagari daṇḍa ।/॥ (U+0964/U+0965) — the
# DEFAULT below — but a few have their OWN native daṇḍa in Unicode.  aksharamukha renders the
# shared daṇḍa correctly for the northern scripts yet emits a bare ASCII "."/".." for several southern
# ones (Gujarati, Kannada, Malayalam, Telugu); so we split on the daṇḍa markers, transliterate the
# word-segments, and rejoin with the target script's OWN daṇḍa glyph — never a stray ".".
_DANDA = {
    "Tibetan": ("།", "༎"), "Sharada": ("𑇅", "𑇆"), "Siddham": ("𑗂", "𑗃"),
    # New scripts with their OWN encoded daṇḍa-equivalent punctuation (checked per-script against the
    # Unicode block, not assumed): Newa/Bhaiksuki/Cham/Kawi each have characters literally named
    # "…DANDA"/"…DOUBLE DANDA" (Kawi's are U+11F43/U+11F44, checked when Kawi was reinstated into
    # _AKSHARA_SCRIPTS above — missed in the first pass, since that pass tested rendering, not this
    # dict); Khmer's KHAN/BARIYOOSAN, Balinese's CARIK SIKI/CARIK PAREREN, and
    # Javanese's PADA LINGSA/PADA LUNGSI are that script's conventional single/double sentence-final
    # marks; Burmese's LITTLE SECTION/SECTION marks (၊ ။) are the standard Burmese comma/full-stop,
    # used exactly like danda/double-danda in Burmese Pali-Sanskrit printing; Soyombo has a Tibetan-
    # style single/double SHAD, the same function as a daṇḍa — and Zanabazar Square (Zanabazar himself
    # designed both scripts) has its OWN pair too: U+11A42 ZANABAZAR SQUARE MARK SHAD / U+11A43 …MARK
    # DOUBLE SHAD, checked the same way as Kawi's when Zanabazar Square was reinstated into
    # _AKSHARA_SCRIPTS above (the tofu that excluded it was a font-fetch defect, not a rendering one —
    # see the rationale comment there — so this dict simply never got the pair added before now).
    # Scripts left OUT of this dict (Nandinagari, Tirhuta, Thai, Sinhala) genuinely have no dedicated
    # per-verse daṇḍa-equivalent in Unicode — Nandinagari/Tirhuta manuscripts use the plain Devanagari-
    # style stroke (same as Grantha, already defaulted), Sinhala borrows it too, and Thai's closest
    # marks (ANGKHANKHU/KHOMUT) mean "end of section"/"end of the whole text" rather than "end of this
    # verse" so substituting them would be a mistranslation — the shared default is the honest choice
    # there. Ranjana is ALSO left out, for a different reason than the others: it has no Unicode block
    # at all, so it can't have an "own" daṇḍa codepoint to add here even in principle — its daṇḍa is
    # whatever glyph the Nithya Ranjana font draws at U+0964/U+0965 (verified present in its cmap), the
    # SAME shared default every scriptless-daṇḍa case falls through to below.
    "Newa": ("𑑋", "𑑌"), "Bhaiksuki": ("𑱁", "𑱂"), "Cham": ("꩝", "꩞"), "Kawi": ("𑽃", "𑽄"),
    "Khmer": ("។", "៕"), "Balinese": ("᭞", "᭟"), "Javanese": ("꧈", "꧉"), "Burmese": ("၊", "။"),
    "Soyombo": ("𑪛", "𑪜"), "ZanabazarSquare": ("𑩂", "𑩃"),
}
_DANDA_DEFAULT = ("।", "॥")   # the shared Indic daṇḍa, used by every script without its own
# ROMANISED Sanskrit is a target too, now that a file may be STORED in Devanagari and asked for in
# Latin.  Its "daṇḍa" is the app's own romanised spelling — "|" and the display glyph "‖" (U+2016) —
# and routing IAST through this table rather than through aksharamukha is not cosmetic: aksharamukha
# renders । as "." and ॥ as "..", which would put a sentence-final full stop in the middle of a verse
# and read as a pause the text does not have.  (`sa_sud_vedic_ufal_dcs` refuses aksharamukha for its
# own input normalisation over exactly this difference.)
_DANDA_IAST = ("|", "‖")
_DANDA_SPLIT = re.compile(r"(//|\|\||‖|/|\||॥|।|\n)")   # double markers first so "//"/"||"/"‖"/"॥" aren't split into singles; "‖" (U+2016) is the double-daṇḍa DISPLAY glyph; the native ।/॥ are captured too so a DEVANAGARI-stored text's daṇḍas are re-spelled rather than transliterated; item 20: a newline is captured too so it rides THROUGH the script conversion as a hard break (no sandhi/aksharamukha collapse across it)


def _sanskrit(text: str, target: str) -> str:
    try:
        from aksharamukha import transliterate as ak

        def _ak(seg: str) -> str:
            if not seg:
                return seg
            src = ak.auto_detect(seg) if hasattr(ak, "auto_detect") else "autodetect"
            if src and src == target:
                return seg      # already in the target script — identity, NOT a re-reading.  Re-reading
                                # is what the old `src = "IAST"` here did, and once forms could be stored
                                # in Devanagari it meant asking for Devanagari on a Devanagari file ran
                                # ak.process("IAST", "Devanagari", "मूर्ति") and returned mojibake.
            if not src or src == "Zyyy":   # Zyyy = "common" (punctuation/whitespace only) → treat as IAST
                src = "IAST"   # UD Sanskrit forms are usually IAST romanisation
            return ak.process(src, target, seg) or ""

        d1, d2 = _DANDA_IAST if target == "IAST" else _DANDA.get(target, _DANDA_DEFAULT)
        out = []
        for piece in _DANDA_SPLIT.split(text):   # word-segments interleaved with daṇḍa markers + newlines
            if piece in ("//", "||", "‖", "॥"):   # "‖" (U+2016) = the double-daṇḍa display glyph → script's double daṇḍa
                out.append(d2)
            elif piece in ("/", "|", "।"):
                out.append(d1)
            elif piece == "\n":
                out.append("\n")   # item 20: keep the hard line break verbatim (multi-line verse stays multi-line)
            else:
                out.append(_ak(piece))
        return "".join(out)
    except Exception:  # noqa: BLE001
        return ""


def _is_indic(text: str) -> bool:
    """Any Brahmic-script letter present (Devanagari … Malayalam, Sinhala, Tibetan)?"""
    return any("ऀ" <= c <= "෿" or "ༀ" <= c <= "࿿" for c in text)


def _iast(text: str) -> str:
    """Sanskrit → IAST romanisation.  A no-op ("") when the source is ALREADY romanised (Latin/IAST),
    per the spec: transliteration only fires when the token isn't already in Latin script.

    That "" is what serves BOTH layers this scheme now feeds.  On the transliteration ROW it means
    "nothing to add, the form already reads as IAST"; under the Script pill's Latin row it
    means the caller falls back to the stored form — which, for an IAST-stored file, IS the answer.
    Only a Devanagari-stored file does any work here, and it goes through `_sanskrit` so the daṇḍas
    are re-spelled ``|``/``‖`` instead of coming back as full stops."""
    if not _is_indic(text):
        return ""   # already Latin (IAST/ISO) → nothing to romanise
    try:
        return _sanskrit(text, "IAST")
    except Exception:  # noqa: BLE001
        return ""


def _romaji(text: str) -> str:
    """Japanese → phonemic Hepburn: Janome supplies the kanji reading, and pykakasi converts the
    *phonetic* kana (with the ー long-vowel mark) → romaji, so long vowels double (東京 → ``tookyoo``,
    大阪 → ``oosaka``) instead of being hidden (``Tokyo``)."""
    global _JANOME, _KKS
    try:
        if _JANOME is None:
            from janome.tokenizer import Tokenizer
            _JANOME = Tokenizer()
        if _KKS is None:
            import pykakasi
            _KKS = pykakasi.kakasi()
        kana = "".join((tok.phonetic or tok.reading or tok.surface) for tok in _JANOME.tokenize(text))
        return "".join(x["hepburn"] for x in _KKS.convert(kana))
    except Exception:  # noqa: BLE001
        return ""


# ── Korean: Hanja (漢字) → Sino-Korean Hangul, so mixed-script text romanises WHOLE ─────────────
# hangul-romanize maps Hangul SYLLABLES only, so before this every 漢字 in a Korean document fell
# through its transliterator untouched (韓國의 → "韓國ui").  Korean orthography treats Hanja as an
# alternate spelling of a Sino-Korean word, so the fix is to read them as Hangul first and hand the
# now-uniform string to the same romaniser.
#
# DATA SOURCE — the vendored Unihan kHangul table (app/data/hanja_hangul.tsv), NOT the `hanja` PyPI
# package.  hanja 0.15.1 is otherwise the obvious candidate (pure Python, 124 KB, and it implements
# 두음법칙), but it is unusable here on two counts.  (a) Its metadata lists `pyyaml==6.0.1` — an
# EXACT pin — plus pytest, pytest-cov and coveralls as *install* requirements, so `pip install hanja`
# into this venv resolves to "Would install PyYAML-6.0.1 coverage coveralls hanja iniconfig pluggy
# pytest pytest-cov": it DOWNGRADES the PyYAML aksharamukha (a CORE dep) already pulled in, and
# drags a test stack into the portable bundle that ships requirements-core.txt.  (b) Its table is
# single-valued (one Hangul reading per graph), which cannot serve `readings` below — the Sino-Korean
# heteronyms (樂 락/악/요) are exactly what the flyout exists to offer.  Unihan's kHangul field gives
# both, costs no dependency at all, and follows the precedent already set by baxter_sagart.tsv /
# gwoyeu_romatzyh.tsv / lid.176.ftz: vendor the distilled table, stay offline.
_HANJA_KO: dict[str, list[str]] | None = None


def _hanja_table() -> dict[str, list[str]]:
    """char → ordered Sino-Korean CITATION readings (best guess first).  Parsed once; a missing or
    unreadable file yields {} so Korean simply romanises as it did before, never an exception."""
    global _HANJA_KO
    if _HANJA_KO is None:
        _HANJA_KO = {}
        try:
            with open(os.path.join(_DATA_DIR, "hanja_hangul.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    ch, _, rest = line.rstrip("\n").partition("\t")
                    rs = [r for r in rest.split(" ") if r]
                    if ch and rs:
                        _HANJA_KO[ch] = rs
        except Exception:  # noqa: BLE001
            pass
    return _HANJA_KO


# 두음법칙 (the "initial law"): word-initially ㄹ becomes ㅇ before an i/y vowel and ㄴ otherwise, and
# ㄴ becomes ㅇ before an i/y vowel — 老人 노인 (not 로인), 李 이 (not 리), 樂園 낙원 (not 락원).  It is
# applied here rather than stored in the table because it is positional: the SAME graph keeps its
# citation reading anywhere but the front of the word (男女 남녀).  Unihan lists both forms side by
# side (老 → 노:0 로:0E), which is what corroborates the rule; the table build drops the derived one.
_KO_YV = frozenset({2, 3, 6, 7, 12, 17, 20})   # jamo indices of ㅑㅒㅕㅖㅛㅠㅣ — the i/y-onset nuclei the law is conditioned on
_KO_L_R, _KO_L_N, _KO_L_O = 5, 2, 11           # …and of the initials ㄹ, ㄴ, ㅇ


def _dueum(syl: str) -> str:
    """The word-initial form of one Hangul syllable, or "" when the law doesn't touch it."""
    if len(syl) != 1:
        return ""
    off = ord(syl) - 0xAC00
    if not 0 <= off < 11172:   # not a precomposed Hangul syllable
        return ""
    lead, vowel, tail = off // 588, (off % 588) // 28, off % 28
    if lead == _KO_L_R:
        new = _KO_L_O if vowel in _KO_YV else _KO_L_N
    elif lead == _KO_L_N and vowel in _KO_YV:
        new = _KO_L_O
    else:
        return ""
    return chr(0xAC00 + new * 588 + vowel * 28 + tail)


def _ko_initial(text: str, i: int) -> bool:
    """Is position ``i`` word-initial for 두음법칙 purposes?  True at the start of the string and
    after anything that isn't itself part of a word (space, punctuation) — `_korean` is normally fed
    one token, but `transliterate` will hand it a whole sentence, and both must behave."""
    if i == 0:
        return True
    prev = text[i - 1]
    return not (_is_han(prev) or "가" <= prev <= "힣" or "ᄀ" <= prev <= "ᇿ")


def _hanja_to_hangul(text: str) -> str:
    """Replace every Hanja with its best-guess Sino-Korean reading; everything else passes through."""
    tbl = _hanja_table()
    if not tbl:
        return text
    out = []
    for i, ch in enumerate(text):
        rs = tbl.get(ch) if _is_han(ch) else None
        if rs:
            out.append((_dueum(rs[0]) or rs[0]) if _ko_initial(text, i) else rs[0])
        else:
            out.append(ch)
    return "".join(out)


def _korean(text: str) -> str:
    """Korean is deterministic, but wiktra's Korean Lua modules don't run under lupa's Lua 5.5
    (global ``unpack`` removed, hardcoded ``/usr/local`` require paths, and — the blocker — Lua 5.5
    makes ``for``-loop variables const while ``ko-pron`` reassigns them).  Use a dedicated romaniser."""
    global _KO
    try:
        if _KO is None:
            from hangul_romanize import Transliter
            from hangul_romanize.rule import academic
            _KO = Transliter(academic)
        return _KO.translit(_hanja_to_hangul(text)) or ""   # Hanja first — hangul-romanize passes non-Hangul through verbatim
    except Exception:  # noqa: BLE001
        return ""


# uroman is language-aware — its ISO 639-3 lcode markedly improves results (Persian خانه: khanh → khane)
_UROMAN_LCODE = {"fa": "fas", "he": "heb", "ur": "urd", "ps": "pus", "ckb": "ckb", "sd": "snd",
                 "ug": "uig", "yi": "yid", "ru": "rus", "el": "ell", "hi": "hin", "bn": "ben",
                 "ta": "tam", "th": "tha", "am": "amh", "ka": "kat", "hy": "hye"}


def _uroman(text: str, lang: str = "") -> str:
    """ISI's Universal Romanizer — a vocalisation-aware romaniser for any script; used as the
    fallback for scripts wiktra leaves unchanged (e.g. unvocalised Persian/Hebrew)."""
    global _UROMAN
    try:
        if _UROMAN is None:
            import uroman
            _UROMAN = uroman.Uroman()
        return _UROMAN.romanize_string(text, lcode=_UROMAN_LCODE.get(lang)) or ""
    except Exception:  # noqa: BLE001
        return ""


# Scholarly transliteration with diacritics for the unvocalised Semitic/Iranian scripts.
# These are CONSONANTAL — short vowels the script omits stay absent — but any harakat/niqqud that
# ARE written get transliterated (so a vocalised text shows its vowels).

# Persian, DIN 31635 (خانه → ḵānh, کتاب → ktāb)
_FA_MAP = {
    "ا": "ā", "آ": "ā", "أ": "ʾ", "إ": "ʾ", "ء": "ʾ", "ئ": "ʾ", "ؤ": "ʾ",
    "ب": "b", "پ": "p", "ت": "t", "ث": "s̱", "ج": "j", "چ": "č", "ح": "ḥ", "خ": "ḵ",
    "د": "d", "ذ": "ẕ", "ر": "r", "ز": "z", "ژ": "ž", "س": "s", "ش": "š", "ص": "ṣ", "ض": "ż",
    "ط": "ṭ", "ظ": "ẓ", "ع": "ʿ", "غ": "ġ", "ف": "f", "ق": "q", "ک": "k", "ك": "k", "گ": "g",
    "ل": "l", "م": "m", "ن": "n", "و": "v", "ه": "h", "ة": "h", "ی": "y", "ي": "y",
    "َ": "a", "ُ": "o", "ِ": "e", "ْ": "", "ٰ": "ā",
    "ً": "an", "ٌ": "on", "ٍ": "en", "‌": "",   # tanwin, ZWNJ
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
}
# Hebrew, ISO 259 (שלום → šlwm, ספר → spr).  Final forms fold to their base; begadkefat spirantisation
# isn't marked in unpointed text, so the plosive letters are used.
_HE_MAP = {
    "א": "ʾ", "ב": "b", "ג": "g", "ד": "d", "ה": "h", "ו": "w", "ז": "z", "ח": "ḥ", "ט": "ṭ",
    "י": "y", "כ": "k", "ך": "k", "ל": "l", "מ": "m", "ם": "m", "נ": "n", "ן": "n", "ס": "s",
    "ע": "ʿ", "פ": "p", "ף": "p", "צ": "ṣ", "ץ": "ṣ", "ק": "q", "ר": "r", "ש": "š", "ת": "t",
    "ְ": "ə", "ֱ": "ĕ", "ֲ": "ă", "ֳ": "ŏ", "ִ": "i", "ֵ": "e",
    "ֶ": "e", "ַ": "a", "ָ": "ā", "ֹ": "o", "ֻ": "u", "ּ": "",
    "ׁ": "", "ׂ": "",   # dagesh, shin/sin dots
}


def _char_map(text: str, mapping: dict) -> str:
    out = []
    for ch in text:
        if ch in mapping:
            out.append(mapping[ch])
        elif ch.isascii() or ch.isspace() or ch in "-–—.,;:!?()[]«»\"'":
            out.append(ch)
        # else: drop stray combining marks / unmapped characters
    return "".join(out)


# Arabic, DIN 31635 (the standard scholarly transliteration)
_AR_DIN = {
    "ا": "ā", "آ": "ʾā", "أ": "ʾ", "إ": "ʾ", "ء": "ʾ", "ئ": "ʾ", "ؤ": "ʾ", "ٱ": "",
    "ب": "b", "ت": "t", "ث": "ṯ", "ج": "ǧ", "ح": "ḥ", "خ": "ḫ", "د": "d", "ذ": "ḏ", "ر": "r", "ز": "z",
    "س": "s", "ش": "š", "ص": "ṣ", "ض": "ḍ", "ط": "ṭ", "ظ": "ẓ", "ع": "ʿ", "غ": "ġ", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "w", "ي": "y", "ى": "ā",
    "َ": "a", "ُ": "u", "ِ": "i", "ّ": "", "ْ": "", "ً": "an", "ٌ": "un", "ٍ": "in", "ٰ": "ā",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
}


def _arabic_din(text: str) -> str:
    out = []
    for tok in re.split(r"(\s+)", text):
        if tok.startswith("ال") and len(tok) > 2:   # definite article ال → al-
            out.append("al-" + _char_map(tok[2:], _AR_DIN))
        else:
            out.append(_char_map(tok, _AR_DIN))
    return "".join(out)


# ── scheme registries: TRANSLITERATION (romanisation) vs ORTHOGRAPHY (display-only glyphs) ────
# TRANSLITERATION = a canonical romanisation.  It is written to MISC Translit/LTranslit on a parse
# pass, shown in the grid Head column, and (editably) in diagrams.  ORTHOGRAPHY = a display-only
# re-rendering of the token glyphs (never written to MISC).  Both share the same engine functions;
# only which menu offers which scheme differs.  Ordered [(scheme_id, label)]; FIRST = default.
# Languages absent from _TRANSLIT_SCHEMES but still transliterable (Semitic/Cyrillic/Greek/Indic/…
# via the legacy single-romanisation backends) get a lone "default" scheme (_SINGLE_LABEL); genuinely
# Latin-script languages get an empty list (⇒ no menu).  See app/data/ for the vendored CJK datasets.
_TRANSLIT_SCHEMES: dict[str, list[tuple[str, str]]] = {
    "ja": [("kunrei", "Kunrei"), ("hepburn", "Modified Hepburn")],
    "zh": [("pinyin", "Pinyin")],
    "yue": [("jyutping", "Jyutping")],
    "lzh": [("pinyin", "Pinyin"), ("mc", "Baxter Middle Chinese"), ("oc", "Baxter–Sagart Old Chinese")],
    "sa": [("iast", "IAST")],
}
# Simplified/Traditional head every Han-script orthography list: they are SAME-SCRIPT-FAMILY glyph
# conversions (via OpenCC), so the frontend must NOT push the original into the transliteration row for them.
_HANZI_CONV = [("simplified", "Simplified"), ("traditional", "Traditional")]
_ORTHO_SCHEMES: dict[str, list[tuple[str, str]]] = {
    "zh": _HANZI_CONV + [("zhuyin", "Zhuyin"), ("gr", "Gwoyeu Romatzyh"), ("generalchinese", "General Chinese")],
    "yue": _HANZI_CONV + [("jyutping", "Jyutping"), ("generalchinese", "General Chinese")],
    "lzh": _HANZI_CONV + [("zhuyin", "Zhuyin"), ("gr", "Gwoyeu Romatzyh"), ("generalchinese", "General Chinese"),
                          ("jyutping", "Cantonese Jyutping")],
    "sa": list(_AKSHARA_SCRIPTS),   # the Indic scripts (Devanagari, Grantha, Siddham, …) via aksharamukha
}
# Digraphic / multi-script languages beyond the Chinese ones.
#  · Serbian / Bosnian / Serbo-Croatian: Cyrillic ↔ Latin (Gajica) — REAL, deterministic (implemented inline).
#  · Mongolian: Cyrillic ↔ traditional Mongolian — the conversion is genuinely ambiguous and needs a lexicon;
#    with no clean, correct converter on 3.12 the traditional-script option is listed but DISABLED
#    (available:false) rather than emitting wrong text.  (Croatian hr is Latin-only → no orthography menu.)
_SERBIAN_CONV = [("latin", "Latin (Gajica)"), ("cyrillic", "Cyrillic")]
for _code in ("sr", "srp", "hbs", "bs", "bos"):
    _ORTHO_SCHEMES[_code] = list(_SERBIAN_CONV)
for _code in ("mn", "mon", "khk"):
    _ORTHO_SCHEMES[_code] = [("mn-traditional", "Mongolian (traditional)")]   # available:false — see _scheme_available
# languages routed to the legacy single-romanisation backends → one "default" scheme, labelled by system
_SINGLE_LABEL = {
    "ar": "DIN 31635", "fa": "DIN 31635", "he": "ISO 259", "ko": "Academic",
}
# non-Latin, transliterable-but-single-scheme languages (mirrors the frontend's TRANSLIT_LANGS, minus the
# per-scheme CJK/Sanskrit ones): everything here gets a lone default scheme (romanised via wiktra/uroman).
_SINGLE_LANGS = set(_SINGLE_LABEL) | {
    "ur", "ps", "syr", "dv", "ckb", "sd", "ug", "yi", "arc", "aii", "prs",
    "ru", "uk", "be", "bg", "sr", "mk", "mn", "kk", "ky", "tg", "tt", "ce", "cv", "ba", "sah", "os",
    "el", "grc", "hi", "bn", "pa", "gu", "or", "ta", "te", "kn", "ml", "si", "ne", "mr", "as",
    "bo", "dz", "new", "th", "lo", "km", "my", "shn", "hy", "ka", "am", "ti", "gez",
}

# scheme_id → (engine callable, availability check).  The engine takes (text) → romanisation.
_ENGINES = {
    "pinyin": (_pinyin, lambda: _pkg("pypinyin")),
    "zhuyin": (_zhuyin, lambda: _pkg("pypinyin")),
    "gr": (_gwoyeu, lambda: _pkg("pypinyin") and bool(_gr_base_table())),
    "generalchinese": (_general_chinese, lambda: bool(_tungdzih_table())),
    "jyutping": (_jyutping, lambda: _pkg("ToJyutping")),
    "simplified": (_t2s, lambda: _pkg("opencc")),     # display glyphs → simplified
    "traditional": (_s2t, lambda: _pkg("opencc")),    # display glyphs → traditional
    "mc": (lambda t: _baxter(t, 0), lambda: bool(_baxter_table())),
    "oc": (lambda t: _baxter(t, 1), lambda: bool(_baxter_table())),
    "kunrei": (lambda t: _cutlet(t, "kunrei"), lambda: _pkg("cutlet")),
    "hepburn": (lambda t: _cutlet(t, "hepburn"), lambda: _pkg("cutlet")),
    "latin": (_to_serbian_latin, lambda: True),        # Serbian/SC → Latin (Gajica); pure Python, always available
    "cyrillic": (_to_serbian_cyrillic, lambda: True),  # Serbian/SC → Cyrillic
    "mn-traditional": (lambda t: "", lambda: False),   # traditional Mongolian: DISABLED (no correct converter)
}


def _pkg(name: str) -> bool:
    import importlib.util
    return importlib.util.find_spec(name) is not None


def _norm(lang: str) -> str:
    return (lang or "").split("-")[0].split("_")[0].lower()


def _canon_lang(base: str) -> str:
    """Fold ISO 639-3 aliases onto the registry's canonical code."""
    return {"cmn": "zh", "jpn": "ja", "san": "sa", "kor": "ko", "fas": "fa", "per": "fa",
            "heb": "he", "iw": "he"}.get(base, base)


def _scheme_available(base: str, sid: str) -> bool:
    if sid == "csl":                      # pure Python, no engine — only the vendored sandhi generator
        from . import sa_notation as _sa_notation
        return _sa_notation.available()
    if sid == "macron":                   # Latin vowel length needs a lookup table this repo can't ship
        from . import macron as _macron
        return _macron.available()
    if sid == "iast" or (base == "sa"):   # IAST + all Indic scripts ride aksharamukha
        return _pkg("aksharamukha")
    eng = _ENGINES.get(sid)
    return bool(eng and eng[1]())


# Scheme id → the ``extras`` tier that would make it available.  ONLY the schemes an INSTALL can
# fix belong here, because the frontend turns a `needs` into a live "install" link and a link that
# cannot lead anywhere is worse than the flat "unavailable" it replaces:
#   · `mn-traditional` is disabled ON PURPOSE (no correct converter exists — see _ENGINES), so it
#     stays inert for ever and must never be listed here;
#   · pypinyin / aksharamukha / ToJyutping / opencc / hangul-romanize are in requirements-core, so
#     their absence means a broken install, not a missing option, and no tier repairs it;
#   · the vendored data tables (Baxter–Sagart, General Chinese) ship in `app/data/`, same reasoning.
# Checked against extras.TIERS at import (`_check_scheme_tiers`) so a renamed tier cannot silently
# leave a dead link behind — the one failure mode this table can have.
_SCHEME_TIER: dict[str, str] = {
    "macron": "la_macron",     # Morpheus vowel lengths, fetched not shipped (app/macron.py)
    "kunrei": "japanese",      # cutlet + its dictionaries
    "hepburn": "japanese",
}


def _check_scheme_tiers() -> None:
    from . import extras
    unknown = sorted(set(_SCHEME_TIER.values()) - set(extras.TIERS))
    if unknown:   # a programming error, and one that would only show as a link that does nothing
        raise RuntimeError(f"_SCHEME_TIER names no such extras tier(s): {unknown}")


_check_scheme_tiers()   # at import: a dead link is invisible in use, so fail where it is introduced


def _scheme_needs(base: str, sid: str) -> str:
    """The extras tier that would make `sid` available, or "" when nothing installable would.

    Answered in PYTHON rather than guessed in the menu: which engine backs a scheme, and which tier
    carries that engine, are both facts this module owns."""
    if _scheme_available(base, sid):
        return ""
    return _SCHEME_TIER.get(sid, "")



# ── three-way scheme model (item 1) ───────────────────────────────────────────
#  · SCRIPT  = NON-LATIN genuine writing systems that re-render the MAIN GLYPH (+ frontend "Original").
#  · DISPLAY = the transliteration ROW: every romanisation/transcription/reconstruction (a SUPERSET).
#  · STORED  = the subset of DISPLAY marked stored=True, written to MISC Translit/LTranslit on a parse pass.
_SERB = ("sr", "srp", "hbs", "bs", "bos")
_MONG = ("mn", "mon", "khk")
# SANSKRIT is DIGRAPHIC IN STORAGE: a file's FORM/LEMMA columns hold either IAST or Devanagari,
# whichever the parser was fed (`sa_sud_vedic_ufal_dcs` romanises Devanagari internally and puts it
# back in FORM/LEMMA, with the IAST in MISC Translit/LTranslit, per the UD convention).  So Sanskrit
# needs BOTH directions from the one menu, and "Latin" is a genuine choice here rather than the "no
# script" it is elsewhere: for a Devanagari-stored file it romanises, for an IAST-stored one it is a
# no-op that leaves the stored spelling showing.  With the frontend's own "Original" row in front,
# the three cases the reader can ask for — as stored, romanised, in some Brahmic script — are each
# reachable by name, which the old Sanskrit-only "None" row could not express once the stored script
# stopped being IAST by definition.
# ⚠ THE ROW NAMES THE SCRIPT, NOT THE NOTATION — "Latin", not "Latin (IAST)". Which Latin notation is
# drawn is the DISPLAYED transliteration's business, and the two menus disagreed the moment CSL could
# fill this line: picking Script "Latin (IAST)" with Displayed CSL puts CSL on it (see saCslTop in
# js/lang/translit.js), so a row promising IAST was naming something it no longer decided. The Displayed
# menu still names IAST and CSL, which is where that choice belongs. The ID stays `iast`: it is the
# engine's name and what a remembered Script preference is stored under.
_SA_SCRIPTS = [("iast", "Latin")] + list(_AKSHARA_SCRIPTS)
_SCRIPT_SCHEMES: dict[str, list[tuple[str, str]]] = {
    "zh": _HANZI_CONV, "yue": _HANZI_CONV, "lzh": _HANZI_CONV,
    "sa": _SA_SCRIPTS,
    # LATIN: not another writing system but another SPELLING of the one it has — vowel length, which
    # classical orthography leaves unwritten and every teaching edition restores.  It belongs to the
    # Script layer for the reason the Indic scripts do: it re-renders the glyphs a reader reads while
    # the FORM column, the grid and the editors keep what the file says.  See `app/macron.py` for why
    # it can list unavailable.
    "la": [("macron", "Latin (macronised)")],
    **{c: list(_SERBIAN_CONV) for c in _SERB},
    **{c: [("mn-traditional", "Mongolian (traditional)")] for c in _MONG},
}
_MANDARIN_DISPLAY = [("pinyin", "Pinyin", True), ("zhuyin", "Zhuyin", False),
                     ("gr", "Gwoyeu Romatzyh", False), ("generalchinese", "General Chinese", False)]
_DISPLAY_SCHEMES: dict[str, list[tuple[str, str, bool]]] = {
    "zh": _MANDARIN_DISPLAY,
    "yue": [("jyutping", "Jyutping", True), ("generalchinese", "General Chinese", False)],
    "lzh": _MANDARIN_DISPLAY + [("jyutping", "Cantonese Jyutping", False),
                                ("mc", "Baxter Middle Chinese", True), ("oc", "Baxter–Sagart Old Chinese", True)],
    # CSL is DISPLAY-ONLY and deliberately not `stored`: it is not a romanisation of a token but a
    # spelling of the JUNCTION it stands in, so the same word reads differently beside a different
    # neighbour and MISC Translit — which is per token and context-free — could not hold it honestly.
    # It is also the one scheme `_render_one` never sees: see app/sa_notation.py.
    "sa": [("iast", "IAST", True), ("csl", "CSL", False)],
    "ja": [("kunrei", "Kunrei", True), ("hepburn", "Modified Hepburn", True)],
    **{c: [("latin", "Latin (Gajica)", True)] for c in _SERB},
}


def script_schemes(lang: str) -> list[dict]:
    """NON-LATIN SCRIPT options for ``lang`` (re-render the main glyph). The frontend prepends 'Original'.
    Empty ⇒ no script menu."""
    base = _canon_lang(_norm(lang))
    return [{"id": sid, "label": label, "available": _scheme_available(base, sid),
             "needs": _scheme_needs(base, sid)}
            for sid, label in _SCRIPT_SCHEMES.get(base, [])]


def translit_schemes(lang: str) -> list[dict]:
    """DISPLAYED transliteration schemes (the row) → ``[{"id","label","stored","available","needs"}]``
    (a superset).  ``stored`` marks the subset written to MISC Translit/LTranslit; ``needs`` names the
    extras tier that would make an unavailable one work.  Empty ⇒ no transliteration menu."""
    base = _canon_lang(_norm(lang))
    if base in _DISPLAY_SCHEMES:
        return [{"id": sid, "label": label, "stored": st, "available": _scheme_available(base, sid),
                 "needs": _scheme_needs(base, sid)}
                for sid, label, st in _DISPLAY_SCHEMES[base]]
    if base in _SINGLE_LANGS:
        return [{"id": "default", "label": _SINGLE_LABEL.get(base, "Romanization"), "stored": True,
                 "available": True, "needs": ""}]
    return []


def orthography_schemes(lang: str) -> list[dict]:
    """Back-compat alias → the SCRIPT layer (older callers)."""
    return script_schemes(lang)


def _default_scheme(base: str) -> str:
    if base in _DISPLAY_SCHEMES:
        return _DISPLAY_SCHEMES[base][0][0]
    return "default"


def _legacy(text: str, base: str, lang: str) -> str:
    """The pre-scheme single-romanisation routing (Semitic/Korean/wiktra/uroman)."""
    if base == "ar":
        out = _arabic_din(text)
    elif base in ("ja", "jpn"):
        out = _romaji(text)
    elif base in ("ko", "kor"):
        out = _korean(text)
    elif base in ("fa", "fas", "per"):
        out = _char_map(text, _FA_MAP)
    elif base in ("he", "heb", "iw"):
        out = _char_map(text, _HE_MAP)
    else:   # wiktra as far as possible (Cyrillic, Greek, Devanagari, …)
        try:
            out = _tr().tr(text, lang=lang) or ""
            if out == text:
                out = ""
        except Exception:  # noqa: BLE001
            out = ""
    if not out:   # wiktra couldn't romanise (e.g. unvocalised Persian/Hebrew) → universal romaniser
        uni = _uroman(text, base)
        if uni and uni != text:
            out = uni
    return out


_AKSHARA_IDS = {s[0] for s in _AKSHARA_SCRIPTS}


def _is_latin_output(scheme: str) -> bool:
    """Does this scheme produce a Latin/romanised string?  True for every transliteration engine and
    the Latin-output orthographies (GR, General Chinese, Jyutping); False only for the native-script
    orthographies (Zhuyin and the Indic scripts), whose script-native punctuation must be preserved."""
    return scheme not in ("zhuyin", "simplified", "traditional", "latin", "cyrillic", "mn-traditional") and scheme not in _AKSHARA_IDS


# ── POS-conditioned reading selection (Chinese) ───────────────────────────────
# A Han graph is heteronymic BY WORD CLASS as often as not, because Old Chinese derived words from
# words by tone and voicing: 王 is wáng "king" (NOUN) and wàng "be king" (VERB); 數 is shù "number"
# (NOUN), shǔ "count" (VERB) and shuò "frequently" (ADV); 好 is hǎo "good" (ADJ) and hào "love"
# (VERB).  The vendored Baxter–Sagart table is a WORD list — one row per source entry, carrying the
# gloss and a UPOS the build script infers from it — so where the treebank has already tagged the
# token, the tag names which row is meant.  That is the whole of this section: `upos` is an
# OPTIONAL hint threaded through the public entry points, and every caller that passes none behaves
# exactly as it did before.
#
# ⚠ REORDER, NEVER FILTER.  A POS match promotes the reading it names to what gets rendered (and,
# through `readings`, to index 0 of the pick list); a tag that matches no row, an unknown tag and a
# row the build script left untagged all change NOTHING.  3,394 of the table's 4,082 entries carry
# no tag at all and the tags that exist are inferred from an English gloss, so a tag must never be
# able to remove an option — the cost of a wrong one has to stay bounded at "the list is in the
# wrong order", never "the reading I wanted is gone".
#
# ⚠ MANDARIN IS ORDERED, NOT SOURCED.  pypinyin stays the source of Mandarin readings; the table
# only says which of ITS candidates to prefer, and a table reading pypinyin does not hold for the
# graph is discarded (74 of the polyphonic graphs' table readings are Old Chinese-only survivals —
# 奧 yù, 陳 zhèn, 出 chuì — which no modern romaniser will produce and which have no business being
# rendered as Mandarin).  For Middle/Old Chinese there is no such second source: the table IS the
# engine, so the row is used directly.
#
# ⚠ SINGLE-HAN-GRAPH TOKENS ONLY — the WHOLE-TOKEN RULE (documented at length further down) applied
# to this.  For a token of two or more graphs the phrase dictionary is the authority on the reading
# and a per-character word class is a guess: 銀行 is yínháng whatever the tagger calls it, and a
# NOUN tag on it must not turn its 行 into the noun's own citation reading.
_POS_MANDARIN_LANGS = ("zh", "lzh")   # …after _canon_lang, so cmn → zh.  lzh is included because a
#                                       classical text's Mandarin row is exactly where the appendix's
#                                       word-class distinctions live.


def _pos_graph(text: str) -> str:
    """The ONE Han graph ``text`` consists of, or "" if it holds none or several.  Punctuation and
    Latin around the graph are tolerated — they carry no reading and `_render_one` passes them
    through — but a second graph is not (see the whole-token rule)."""
    if _han_count(text) != 1:
        return ""
    return next((ch for ch in text if _is_han(ch)), "")


# ── the EDITORIAL override on top of the inferred tags ────────────────────────
# ⚠ EVERYTHING IN THIS TABLE IS A HAND-MADE EDITORIAL JUDGEMENT, not a fact read out of the source,
# and it is kept separate from the vendored TSV for exactly that reason: the TSV is regenerable from
# Wiktionary by tools/build_baxter_index.py and a hand edit to it would be silently reverted by the
# next rebuild, whereas this dict is code and survives.  It is also where a linguist can work — one
# line per judgement, no rebuild, no data pipeline.
#
# WHY IT HAS TO EXIST.  The `pos` column of the TSV is inferred FROM THE ENGLISH GLOSS, and the
# canonical 破音字 are precisely the graphs whose glosses are bare English content words that say
# nothing about word class: 行 "rank, row", 樂 "music", 中 "hit the center", 重 "repeat; double",
# 為 "make, do, act as", 分 "alloted duty".  No English frame can tell a noun from a verb in those,
# and loosening the inference until it could would mis-tag far more entries than it fixed — so the
# inference stays conservative and honest at 16.9 %, and the handful of words that MATTER most are
# named here instead.  (行 is the textbook example of the whole feature.)
#
# WHAT AN ENTRY IS: graph → {UPOS: the numbered-pinyin syllable of the ROW meant}.  The syllable is
# an IDENTIFIER for one row of the table, not a rendering — it selects the row, and Middle Chinese,
# Old Chinese, Zhuyin and Gwoyeu Romatzyh then all come off THAT row, so one judgement stays
# consistent across every scheme instead of being restated four times.  It follows that an override
# can only name a reading the appendix actually lists: a syllable no row carries selects nothing and
# the graph falls back to its ordinary rendering, which is the safe way for a typo to fail.
#
# THE CONTRACTS ARE THE SOURCED TAGS' CONTRACTS, unchanged: REORDER NEVER FILTER (the other readings
# stay in `readings`, just not first), SINGLE-HAN-GRAPH TOKENS ONLY, and for Mandarin the promoted
# syllable must still be one PYPINYIN ITSELF holds for the graph — that refusal is what stops an
# Old-Chinese-only reading leaking into a pinyin row, and an override does not get to bypass it.
#
# TO ADD ONE: write the TRADITIONAL graph (the simplified counterpart is derived below, so 樂 covers
# 乐), the UD tag, and the numbered pinyin of the intended row — read it off the TSV, whose PY column
# is tone-marked ("chóng" → "chong2").  Add an entry only where you would defend it in print; a
# graph whose two readings are both, say, verbs (見 jiàn "see" / xiàn "appear", 說 shuō / shuì) has
# nothing for a UPOS to decide and does not belong here.
#
# ⚠ AND NOT WHERE TWO ROWS SHARE ONE MANDARIN READING.  The key selects a row BY ITS PINYIN, so it
# cannot tell apart rows that sound alike in Mandarin — 重 has drjowngH "weight (n.)" and drjowngX
# "heavy", both zhòng, and an entry 重 ADJ → "zhong4" would pick the first, giving the right Mandarin
# and the NOUN's Middle Chinese.  That is why 重 has only its ADV line here: leaving the adjective
# with no opinion renders it the ordinary way, which is right in Mandarin and merely uncommitted in
# Middle Chinese, whereas an entry would be right in one scheme and wrong in another.  If such a case
# ever has to be expressed, the honest fix is a second key (the MC transcription), not a pinyin
# entry that happens to land nearby.
_POS_OVERRIDE: dict[str, dict[str, str]] = {
    "行": {"NOUN": "hang2"},                      # háng "row, rank, column" — the noun sense; xíng is the verb "walk"
    "樂": {"NOUN": "yue4"},                       # yuè "music"; lè "joy, enjoy" leans verbal/stative
    "中": {"VERB": "zhong4"},                     # zhòng "hit the centre" (the derived departing tone); zhōng is the noun "centre"
    "重": {"ADV": "chong2"},                      # chóng "again, repeatedly"; zhòng is "heavy" / "weight"
    "為": {"VERB": "wei2"},                       # wéi "make, do, act as"; wèi is the adposition "for, because" (already sourced)
    "分": {"NOUN": "fen4"},                       # fèn "allotted duty, one's lot"; fēn is the verb "divide"
    "長": {"NOUN": "zhang3", "VERB": "zhang3"},   # zhǎng "elder, chief" and "grow"; cháng is the adjective "long" (already sourced)
    "難": {"NOUN": "nan4"},                       # nàn "difficulty, calamity"; nán is the adjective "difficult"
    "妻": {"VERB": "qi4"},                        # qì "give as wife" (妻之); qī is the noun "wife"
}
_POS_OVERRIDE_ALL: dict[str, dict[str, str]] | None = None


def _pos_overrides() -> dict[str, dict[str, str]]:
    """`_POS_OVERRIDE` with each traditional key's SIMPLIFIED counterpart added, so one line covers
    both spellings of a word (樂 and 乐, 為 and 为, 長 and 长, 難 and 难).  Derived through OpenCC
    rather than listed by hand because a hand-listed pair is a second place to forget; where OpenCC
    is absent `_t2s` returns its input unchanged and the traditional entries simply stand alone.
    An explicit entry for a simplified graph is never overwritten, so a genuinely spelling-specific
    judgement can still be written directly."""
    global _POS_OVERRIDE_ALL
    if _POS_OVERRIDE_ALL is None:
        out = {g: dict(v) for g, v in _POS_OVERRIDE.items()}
        for g, v in _POS_OVERRIDE.items():
            simp = _t2s(g)
            if len(simp) == 1 and simp != g and simp not in out:
                out[simp] = dict(v)
        _POS_OVERRIDE_ALL = out
    return _POS_OVERRIDE_ALL


def _baxter_pos_row(graph: str, upos: str):
    """The table row ``upos`` names for ``graph``, or None — the EDITORIAL override first, the
    gloss-inferred ``pos`` column second.

    The override, when it speaks, is FINAL: it exists to correct the inferred tags, so falling back
    to them on a miss would reinstate exactly what it overrules (行 NOUN names the háng row and must
    not slide back to the "action" row the gloss tagged NOUN).  A miss is therefore "no opinion" and
    the caller renders the graph the ordinary way.

    Absent an override, the FIRST row whose inferred class is ``upos`` — first and not best, because
    the appendix lists a graph's words in its own order and where two rows share a class the earlier
    one is the more basic word.  A row with an empty ``pos`` never matches: the build script writes
    "" to mean "this gloss licenses no tag", not "any tag will do"."""
    if not upos:
        return None
    rows = _baxter_rows().get(graph, ())
    want = _pos_overrides().get(graph, {}).get(upos, "")
    if want:
        return next((row for row in rows if _py_tone3(row[0]) == want), None)
    return next((row for row in rows if row[3] and row[3] == upos), None)


def _py_tone3(py: str) -> str:
    """Tone-marked pinyin → pypinyin's numbered ``Style.TONE3`` spelling ("háng" → "hang2"), through
    pypinyin's own converter rather than a hand-written tone-mark table.  "" if it cannot be read."""
    try:
        from pypinyin.contrib.tone_convert import to_tone3
        return to_tone3(py, v_to_u=False, neutral_tone_with_five=True) or ""
    except Exception:  # noqa: BLE001 — pypinyin missing, or a PY cell it cannot parse
        return ""


def _mandarin_pos_syllable(graph: str, upos: str) -> str:
    """The numbered-pinyin syllable ``upos`` licenses for ``graph``, or "".

    Read off the ROW `_baxter_pos_row` selected — whether that row was chosen by the editorial
    override or by the gloss-inferred tag — so Pinyin, Zhuyin, Gwoyeu Romatzyh, Middle Chinese and
    Old Chinese all speak for the same word.

    The syllable is then required to be one PYPINYIN ITSELF lists for the graph, and a near-miss is
    no match.  A toneless fallback was considered and rejected: 好 is both hǎo and hào, so "hao"
    matches both and the fallback would promote whichever pypinyin happens to list first — which is
    the very reading the tag was trying to overrule.  33 tagged rows and several plausible override
    readings name an Old-Chinese-only survival pypinyin has no modern reading for (奧 yù, 陳 zhèn,
    出 chuì); every one of them is refused here, so no such form can reach a pinyin row."""
    row = _baxter_pos_row(graph, upos)
    if not row or not row[0]:
        return ""
    syl = _py_tone3(row[0])
    return syl if syl and syl in _char_heteronyms(graph) else ""


def _pos_render(text: str, base: str, scheme: str, upos: str) -> str:
    """``text`` rendered in ``scheme`` under the reading the word class ``upos`` names, or "" for
    "no opinion — render it the ordinary way".  Never the sole path to a rendering: `_render_one`
    falls through to the normal engine on "", so everything this cannot decide is unaffected."""
    if not upos:
        return ""
    graph = _pos_graph(text)
    if not graph:
        return ""
    if base in _POS_MANDARIN_LANGS and scheme in _MANDARIN_JOIN:
        syl = _mandarin_pos_syllable(graph, upos)
        if not syl:
            return ""
        # Rendered through the SCHEME'S OWN JOINER over the same (is_han, syllable) pairs
        # `_mandarin_syllables` produces, so a POS-conditioned Pinyin/Zhuyin/GR value can no more
        # contradict its scheme than a heteronym candidate can.  Exactly one pair is Han here
        # (that is what `_pos_graph` guaranteed), so substituting every Han position substitutes
        # the one; the non-Han runs pass through as they always do.
        pairs = [(is_han, syl if is_han else s) for is_han, s in _mandarin_syllables(text)]
        return _MANDARIN_JOIN[scheme](pairs)
    if base == "lzh" and scheme in ("mc", "oc"):
        row = _baxter_pos_row(graph, upos)
        if not row:
            return ""
        if scheme == "mc":
            val = row[1]
        else:
            ocv = _baxter_variants(row[2], row[1])
            val = _baxter_display(ocv[0]) if ocv else ""
        if not val:
            return ""
        return " ".join(x for x in ((val if _is_han(ch) else ch) for ch in text) if x).strip()   # assembled exactly as _baxter does
    return ""


# The shapes the two public entry points take.  ``upos`` is deliberately a UNION and not an
# overload set: every caller may omit it, one tag may stand for a whole batch, and a per-form list
# is the batch case api.py sends — three call shapes that share one body, and `_hint_at` is the one
# place that tells them apart.  ``feats`` and ``lemmas`` are the same shape and read the same way.
_Forms = str | list[str] | tuple[str, ...]
_Rendered = str | list[str]
_Upos = str | list[str] | tuple[str, ...] | None
_Hint = _Upos


def _hint_at(hint: _Hint, i: int) -> str:
    """The per-token hint for position ``i``: a LIST is read positionally (one value per form), a
    bare string applies to every form, and anything else — None, the default "" — means none at all.

    Three hints now ride this shape, because three engines want different things about the token
    beyond its surface: ``upos`` picks a Han graph's reading, and ``feats``/``lemma`` pick a Latin
    word's vowel lengths (`macron`).  One helper rather than three, since the broadcast/positional
    question is identical and only the payload differs."""
    if isinstance(hint, (list, tuple)):
        return (hint[i] or "") if 0 <= i < len(hint) else ""
    return hint or ""


def _render_one(text: str, lang: str, scheme: str, upos: str = "",
                feats: str = "", lemma: str = "") -> str:
    """Shared engine dispatch for BOTH transliteration and orthography — they use the same engines,
    keyed by scheme id (scheme ids are globally unique across the two menus).  Cached per
    (lang, scheme, text, upos).

    ⚠️ ``upos`` IS PART OF THE CACHE KEY, and that is not optional.  Without it the FIRST
    POS-conditioned call for a given (lang, scheme, text) would write its answer into the entry
    every later caller reads, and the later callers are overwhelmingly the ones that pass no tag at
    all — the grid, the running text and the transliteration row all render the same surface forms
    untagged, and would have been served whichever word class happened to ask first.  The failure
    would be order-dependent and invisible: nothing errors, the value is a real reading of the
    graph, and it is simply the wrong one.  The key is a strict superset of the old one, so every
    untagged call still shares one entry with every other untagged call and the cache does not
    fragment.  ``feats``/``lemma`` join the key on exactly the same argument — they change a Latin
    word's macrons (`Gallia` Nom vs `Galliā` Abl), and every caller that omits them keeps sharing
    one entry."""
    if not text or not lang:
        return ""
    base = _canon_lang(_norm(lang))
    scheme = scheme or _default_scheme(base)
    key = (lang, scheme, text, upos, feats, lemma)
    if key in _CACHE:
        return _CACHE[key]
    try:
        out = _pos_render(text, base, scheme, upos)   # "" ⇒ no POS opinion; fall through untouched
        if not out:
            if scheme == "iast":
                out = _iast(text)
            elif scheme in _AKSHARA_IDS and base == "sa":
                out = _sanskrit(text, scheme)
            elif scheme == "macron" and base == "la":
                # Latin vowel length.  Branched here rather than registered in `_ENGINES` because
                # its engine is the only one that reads more than the surface: the table is keyed
                # on (form, upos, feats), and the lemma supplies the declension where FEATS carries
                # no InflClass.  An `_ENGINES` entry is a bare (text) → str and cannot say that.
                from . import macron as _macron
                out = _macron.macronise(text, upos, feats, lemma)
            elif scheme in _ENGINES:
                out = _ENGINES[scheme][0](text)
            else:
                out = _legacy(text, base, lang)   # single-scheme / legacy backends ignore `scheme`
        if out and _is_latin_output(scheme):
            out = _latinize_punct(out)   # a romanised output never keeps CJK/fullwidth punctuation
    except Exception:  # noqa: BLE001 — an engine hiccup must never surface as an exception
        out = ""
    _CACHE[key] = out or ""
    return _CACHE[key]


def _ortho_one(text: str, lang: str, scheme: str, upos: str,
               feats: str = "", lemma: str = "") -> str:
    """One form re-rendered in an ORTHOGRAPHY scheme.  Split out so the scalar and the vector entry
    points below can each be typed exactly (``str`` / ``list[str]``) instead of sharing one
    ``str | list[str]`` body that pyright then has to widen at every call site."""
    if not scheme:
        return ""   # "Original" — no re-rendering
    return _render_one(text, lang, scheme, upos, feats, lemma)


def transliterate(forms: _Forms, lang: str, scheme: str = "", upos: _Upos = "") -> _Rendered:
    """Transliterate (ROMANISE) ``forms`` for ``lang`` under ``scheme`` ("" ⇒ the language's default).
    Accepts a single string or a list; returns the same shape.  Never raises (failures → "").

    ``upos`` is an OPTIONAL UD tag ("NOUN", "VERB", …) — a single string applying to every form, or
    a LIST PARALLEL TO ``forms``.  Where the language and scheme support it (Chinese; see
    `_pos_render`) it selects which reading of a one-graph token to render; everywhere else, and
    for every caller that omits it, nothing changes.

    No ``feats``/``lemma`` here, deliberately: the only engine that reads them is `macron`, which is
    a SCRIPT and never a romanisation — Latin has nothing to romanise from."""
    if isinstance(forms, (list, tuple)):
        return [_render_one(f, lang, scheme, _hint_at(upos, i)) for i, f in enumerate(forms)]
    return _render_one(forms, lang, scheme, _hint_at(upos, 0))


def orthography(forms: _Forms, lang: str, scheme: str = "", upos: _Upos = "",
                feats: _Hint = "", lemmas: _Hint = "") -> _Rendered:
    """Re-render ``forms`` in the display-only ORTHOGRAPHY ``scheme`` (Zhuyin, GR, an Indic script, …).
    "" ⇒ Original (returns "" so the caller keeps the original glyphs).  ``upos`` as in
    `transliterate` — it reaches the Mandarin orthographies (Zhuyin, Gwoyeu Romatzyh), which are
    driven by the same numbered-pinyin syllables, and is inert for the rest.  Never raises.

    ``feats``/``lemmas`` are the same shape as ``upos`` and reach the Latin `macron` scheme alone,
    where they are what separate ``Gallia`` (Nom) from ``Galliā`` (Abl).  Every other scheme ignores
    them, and a caller that sends only forms still gets the table's form-only levels."""
    if isinstance(forms, (list, tuple)):
        return [_ortho_one(f, lang, scheme, _hint_at(upos, i), _hint_at(feats, i), _hint_at(lemmas, i))
                for i, f in enumerate(forms)]
    return _ortho_one(forms, lang, scheme, _hint_at(upos, 0), _hint_at(feats, 0), _hint_at(lemmas, 0))


# The two *_many entry points render the LIST case directly rather than delegating to the
# shape-polymorphic functions above.  Runtime is identical — those functions' list branches are
# these comprehensions — but the declared return type is `list[str]` and not `str | list[str]`, so a
# caller (api.py's `_with_upos`) gets a list without a cast, and a `list[str]` upos never has to be
# passed through a parameter another overload might read as a single tag.
def transliterate_many(forms: list[str], lang: str, scheme: str = "",
                       upos: list[str] | None = None) -> list[str]:
    return [_render_one(f, lang, scheme, _hint_at(upos, i)) for i, f in enumerate(forms or [])]


def orthography_many(forms: list[str], lang: str, scheme: str = "",
                     upos: list[str] | None = None, feats: list[str] | None = None,
                     lemmas: list[str] | None = None) -> list[str]:
    return [_ortho_one(f, lang, scheme, _hint_at(upos, i), _hint_at(feats, i), _hint_at(lemmas, i))
            for i, f in enumerate(forms or [])]


# ── heteronym readings (Chinese + Japanese) ───────────────────────────────────
# Han characters are heteronymic (行 = xíng "go" / háng "row") and Japanese kanji carry several
# on'yomi/kun'yomi, so the ONE romanisation the engines pick above is sometimes the wrong one for a
# given token.  `readings` returns the ordered candidates for the CURRENTLY DISPLAYED scheme so the
# token context menu can offer a manual override.  Every candidate is derived from the SAME data the
# scheme's own engine uses — pypinyin's heteronym mode, ToJyutping's per-character candidate lists,
# the Baxter–Sagart table, IPADIC via Janome — and rendered through that engine's own joiner, so a
# candidate can never contradict the scheme the user picked.  Scoped to the languages whose
# romanisation is genuinely ambiguous; every other language has nothing to choose between.
_READINGS: dict[tuple[str, str, str, str], list[str]] = {}   # (lang, scheme, text, upos) → ordered candidates (upos reorders; see `readings`)
_READING_LANGS = ("zh", "yue", "lzh", "ja", "ko")       # after _canon_lang: cmn→zh, jpn→ja, kor→ko
_MAX_READINGS = 12      # a pick list, not an enumeration — a 3-character token of 5-way heteronyms is already 125 combinations
_MAX_PER_CHAR = 6       # …and pypinyin/ToJyutping list rare dialectal readings well past the point of usefulness.
#                         Still per-CHARACTER after the whole-token rule below: what it now caps is a single
#                         character's own readings, one position of a polyphonic phrase entry, and the wider
#                         enumeration the derivation path keeps — never a cross-product over a word's graphs.
_MANDARIN_JOIN = {"pinyin": _join_pinyin, "zhuyin": _join_zhuyin, "gr": _join_gr}   # the Mandarin schemes driven by numbered-pinyin syllables

# ⚠ THE WHOLE-TOKEN RULE.  A MULTI-CHARACTER token is offered alternatives only where the engine's own
# dictionary holds more than one reading OF THAT WHOLE TOKEN — never because one of its constituent
# characters happens to be heteronymic.  A cross-product over per-character readings is almost entirely
# noise: 行 has five Mandarin readings, so 银行 and 行李 each came back with five candidates although both
# words have exactly one pronunciation, 重要 came back with nine and 银行卡 with ten.  A list that long and
# that wrong is harder to find the right reading in than no list at all.  A ONE-character token is
# unaffected — there the character IS the whole token, and its own readings ARE a whole-token lookup.
# Where each engine's whole-token dictionary is, and what it actually holds:
#   · Mandarin  — pypinyin's PHRASES_DICT (47,111 phrases).  A phrase entry is normally single-valued, so
#                 the usual answer for a multi-character token is "nothing to choose"; exactly two entries
#                 are polyphonic (朝阳 zhāo-/cháo-, 那些 nà-/nèi-) and those two do still offer.
#   · Cantonese — ToJyutping's trie: 18,056 multi-character entries, and not one of them carries a second
#                 reading (measured over its trie.txt).  So a Cantonese word the dictionary knows has one
#                 pronunciation and a word it doesn't know has none to offer — either way, no alternatives.
#   · Japanese  — IPADIC, looked up on the WHOLE surface.  `_japanese_kana` already did exactly this; it is
#                 the engine the rule is modelled on and the only one that needed no change.
#   · Baxter    — a per-GRAPH table with no word layer at all, so a multi-character token has nothing to
#                 consult.  A SINGLE graph has plenty: since the table was rebuilt from the appendix's
#                 own word list, 547 of its 4,330 graphs carry more than one Middle Chinese reading and
#                 312 more than one Mandarin one, where the collapsed file it replaced was single-valued
#                 throughout.  That is the axis `_pos_render` conditions on.
#   · Korean    — the Unihan kHangul table is likewise per-GRAPH; a token of two or more hanja has no
#                 whole-token entry, and the cross-product over 音 × 樂 offered 음락/음요 beside 음악.
# The COST was weighed and accepted: 一行 genuinely is yīháng "a row" as often as yīxíng "a trip" and
# pypinyin picks one of them, 音樂 is 음악 while the table's first reading of 樂 makes the automatic value
# 음락 — and neither can be fixed from the flyout any more.  Both are still fixable by the OTHER route to
# the same correction, because ambiguity is a property of the LANGUAGE and not of the token: the Stored
# transliteration stays click-editable for every token of these languages (see `ambiguous` below), and
# the DERIVATION path that carries such a correction into the other schemes is deliberately NOT narrowed
# with the flyout — see `_mandarin_choices`'s ``whole_only`` and `_mandarin_pairs`.


def _han_count(text: str) -> int:
    """How many Han characters ``text`` holds — i.e. how many positions have a reading to choose at all.
    One ⇒ the character is the whole token (see the whole-token rule above); two or more ⇒ only a
    dictionary that knows the WORD may speak for it."""
    return sum(1 for ch in text if _is_han(ch))


_HET_CHAR: dict[str, list[str]] = {}


def _char_heteronyms(ch: str) -> list[str]:
    """Every numbered-pinyin reading pypinyin holds for ONE character, out of phrase context."""
    if ch not in _HET_CHAR:
        try:
            from pypinyin import Style, pinyin
            _HET_CHAR[ch] = list(pinyin(ch, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)[0])
        except Exception:  # noqa: BLE001
            _HET_CHAR[ch] = []
    return _HET_CHAR[ch]


def _mandarin_choices(text: str, whole_only: bool = False):
    """Per-position ORDERED candidate numbered-pinyin syllables: ``[(is_han, [syl, …]), …]``, one
    entry per _mandarin_syllables segment, each list headed by the syllable that engine actually
    chose (so the default reading stays first even where pypinyin's phrase dictionary or the 不
    tone-sandhi correction overrode the character's own citation reading).  None ⇒ no alternates.

    ``whole_only`` applies the WHOLE-TOKEN RULE above and is what the READINGS FLYOUT asks for: a token
    of two or more Han characters gets alternatives only out of a PHRASES_DICT entry that ITSELF records
    more than one reading (朝阳, 那些), and one option per position otherwise — the default reading, and
    nothing to choose.  Membership is tested against pypinyin's own dictionary rather than inferred from
    the heteronym pass, because that pass answers a phrase hit and an unknown word with the same shape
    (one candidate per position for 银行, several for 银行卡) and the two must be told apart.

    WITHOUT it — the DERIVATION path, `_mandarin_pairs` — the wider enumeration below is kept, and the
    reason is the one it always had: a character INSIDE a word pypinyin's phrase dictionary knows comes
    back with that one phrase reading and no heteronyms (一行 → yi1 xing2), so each such position is
    topped up from the character's own readings, because the phrase dictionary is where the automatic
    romanisation goes wrong (一行 is yīháng "a row" as often as yīxíng "a trip") and a STORED value the
    user typed by hand to say so can only be RECOGNISED from a list that HAS the other reading in it.
    That rationale is intact; what the whole-token rule stops is OFFERING such a list unprompted.
    Recognising a correction somebody has already made is a different question, and its answer did not
    change — narrowing derivation too would have made a hand-corrected 银行 stop driving the Zhuyin row
    (`derive_scheme` would return "" and the caller would romanise the form again), which is the very
    contract the editable Stored value exists to provide."""
    from pypinyin import Style, pinyin
    base = _mandarin_syllables(text)
    het = _phrase_heteronyms(text)
    if len(het) != len(base):   # the two passes segmented differently → alignment is a guess; offer nothing rather than a wrong reading
        return None
    # The gate, computed once: one Han character IS the whole token, and past that only a phrase pypinyin
    # actually holds may speak for the word.  `text` and not a Han-only slice of it — PHRASES_DICT is keyed
    # by the bare phrase, so a token carrying punctuation simply misses, which is the right answer anyway.
    # Through `_phrase_known` and not the bare membership test, because that dictionary is SIMPLIFIED-ONLY:
    # 銀行 is as much a known word as 银行, and testing the raw spelling would have called the traditional
    # one an unknown compound and offered its characters' heteronyms — the very thing the rule forbids.
    wide = (not whole_only) or sum(1 for is_han, _ in base if is_han) < 2 or _phrase_known(text)
    out, idx = [], 0
    for (is_han, syl), cands in zip(base, het):
        if not is_han:
            out.append((False, [syl]))   # a non-Han run passes through verbatim, exactly as in _mandarin_syllables
            idx += len(syl)
            continue
        if not wide:
            out.append((True, [syl]))    # a multi-character token no phrase entry vouches for: the default reading alone
            idx += 1
            continue
        opts = [syl] + [c for c in cands if c != syl]
        if not whole_only and len(opts) == 1 and idx < len(text):   # phrase-dictionary hit → fall back to the character's own readings (derivation only — see the docstring)
            opts += [c for c in _char_heteronyms(text[idx]) if c != syl]
        out.append((True, opts[:_MAX_PER_CHAR]))
        idx += 1
    return out


def _combos(counts: list[int]) -> list[tuple[int, ...]]:
    """Index tuples over per-position candidate lists, best-guess first: (0,0,…) is the default
    reading, then the combinations that differ from it in ONE position, then (only while the whole
    product still fits under the cap) the rest.  Beyond that the product explodes, and a token whose
    two heteronymic characters BOTH need overriding is vanishingly rarer than the list being unusable."""
    n = len(counts)
    total = 1
    for c in counts:
        total *= c
    if total <= _MAX_READINGS:
        import itertools
        combos = list(itertools.product(*[range(c) for c in counts]))
        combos.sort(key=lambda p: (sum(1 for i in p if i), p))   # by Hamming distance from the default, then odometer order
        return combos
    out = [(0,) * n]
    for i, c in enumerate(counts):
        for j in range(1, c):
            pick = [0] * n
            pick[i] = j
            out.append(tuple(pick))
    return out[:_MAX_READINGS]


def _mandarin_readings(text: str, scheme: str) -> list[str]:
    choices = _mandarin_choices(text, whole_only=True)   # the flyout obeys the whole-token rule; `_mandarin_pairs` deliberately does not
    if not choices:
        return []
    join = _MANDARIN_JOIN[scheme]
    return [join([(is_han, opts[i]) for (is_han, opts), i in zip(choices, pick)])
            for pick in _combos([len(o) for _, o in choices])]


def _jyutping_readings(text: str) -> list[str]:
    """Ordered Jyutping candidates, from ToJyutping's own per-character candidate lists (the very
    table get_jyutping_text picks its single reading out of).  Restricted to an ALL-Han token: for a
    mixed token get_jyutping_text has its own spacing around the non-Han run, and re-joining the
    candidates by hand would silently disagree with the displayed default.

    …and, per the WHOLE-TOKEN RULE, to a ONE-character token.  get_jyutping_candidates flattens every
    trie entry covering a position into that position's list — word entries included, but with no record
    of which word they came from — so for a multi-character token it can only ever yield a cross-product
    over the characters (銀行 → 11 candidates for a word with one pronunciation).  Asking the trie for the
    whole word instead would answer nothing: of its 18,056 multi-character entries not one carries a
    second reading, so a word the dictionary knows is unambiguous and a word it doesn't know has nothing
    to offer.  The gate is therefore the length test rather than a private walk over its internals."""
    import ToJyutping
    cands = ToJyutping.get_jyutping_candidates(text)
    if not cands or any(not c[1] for c in cands):
        return []
    if len(cands) > 1:   # one entry per character, and the all-Han test above makes that a Han count
        return []
    lists = [list(c[1])[:_MAX_PER_CHAR] for c in cands]
    return [" ".join(lists[k][i] for k, i in enumerate(pick)) for pick in _combos([len(x) for x in lists])]


_BAXTER_ALL: dict[str, list[tuple[str, str]]] | None = None


def _baxter_all() -> dict[str, list[tuple[str, str]]]:
    """Every (MC, OC) reading the vendored table holds per graph, in source order — the
    multi-reading view of the same data _baxter_table() collapses to ONE pair per graph.

    TWO axes make a graph multi-valued and the table now carries both.  Its several ROWS are
    several WORDS written with the one graph, which is what the rebuild recovered: 547 graphs have
    more than one Middle Chinese reading (數 srjuX / srjuH / sræwk), where the collapsed file had
    exactly one for every graph and this function could only ever return a single pair.  And ` ~ `
    VARIANTS inside one row's OC field are two reconstructions of that one word, which
    _baxter_variants splits — so 前 surfaces here as [("dzen", "*dzˁen"), ("dzen", "*m-dzˁen")]:
    one MC transcription against each OC reconstruction of it.  That asymmetry is the data's, not a
    bug — the MC column has no tilde in any row, so a variant pair differs in its reconstruction and
    not in its Middle Chinese.

    The pairs are read ROW BY ROW so an MC and an OC that appear together really are the same word's
    (`_baxter_pairs` depends on exactly that); duplicates are dropped, which is why a graph whose
    rows differ only in OC still lists its MC once."""
    global _BAXTER_ALL
    if _BAXTER_ALL is None:
        _BAXTER_ALL = {}
        for ch, rows in _baxter_rows().items():
            out: list[tuple[str, str]] = []
            for _py, mc, oc, _pos, _gloss in rows:
                for ocv in (_baxter_variants(oc, mc) or [""]):
                    rec = (mc, _baxter_display(ocv))
                    if rec not in out:
                        out.append(rec)
            _BAXTER_ALL[ch] = out
    return _BAXTER_ALL


def _baxter_readings(text: str, idx: int) -> list[str]:
    """Candidate Baxter (idx 0) / Baxter–Sagart (idx 1) readings, assembled exactly as _baxter does —
    space-joined, characters absent from the table dropped rather than guessed.

    Per the WHOLE-TOKEN RULE a token of two or more graphs offers nothing: the vendored table is keyed by
    GRAPH and has no word layer, so its only multi-character answer could be a cross-product.  A SINGLE
    graph now answers on BOTH of the axes `_baxter_all` documents — the graph's several WORDS (數 offers
    srjuX / srjuH / sræwk, 行 hang / hæng / hængH), which the rebuild recovered and the collapsed file
    could not express at all, and the ` ~ ` VARIANTS of one word's Old Chinese reconstruction, which 31
    rows carry.  Middle Chinese takes nothing from the second axis: that column has no tilde, so both
    variants of a pair share one MC transcription and the deduplication leaves one.  `_baxter_pairs` is
    left wide for the same reason `_mandarin_pairs` is."""
    if _han_count(text) > 1:
        return []
    table, allrec = _baxter_table(), _baxter_all()
    lists: list[list[str]] = []
    for ch in text:
        if not _is_han(ch):
            lists.append([ch])
            continue
        cur = (table.get(ch) or ("", ""))[idx]        # the reading _baxter itself would print for this graph
        opts = [cur] if cur else []
        for rec in allrec.get(ch, []):
            if rec[idx] and rec[idx] not in opts:
                opts.append(rec[idx])
        lists.append(opts[:_MAX_PER_CHAR] or [""])    # no attested reading → contributes nothing, as in _baxter
    return [" ".join(x for x in (lists[k][i] for k, i in enumerate(pick)) if x).strip()
            for pick in _combos([len(x) for x in lists])]


def _japanese_readings(text: str, system: str) -> list[str]:
    """Ordered romanisations of every distinct katakana reading IPADIC records for the WHOLE token
    surface (行く → イク / ユク), cheapest connection cost — i.e. most frequent — first, each romanised
    through the SAME cutlet system the display uses.  Only whole-surface dictionary entries count: a
    compound the dictionary doesn't hold as one word gets no alternates rather than a re-segmented
    guess — which is the WHOLE-TOKEN RULE above, written here first and since made the rule for every
    engine, so this is the one reading path that needed no change to obey it.  Janome's ``reading``
    field (not ``phonetic``) is used, so the ー long-vowel mark never
    reaches cutlet, which romanises it inconsistently (ギョー → gyoo but コー → kou).

    The reading cutlet ITSELF chose (read off its own tagger) is dropped from the list: fed a bare
    kana string cutlet romanises it literally, so the very same reading round-trips to a different
    spelling (東京 → "tokyo" directly, but トウキョウ → "toukyou") and would otherwise look like a
    second reading of a word that has only one."""
    own = ""
    try:   # the kana cutlet's own (fugashi/unidic) analysis assigned to this token, in context
        own = "".join((getattr(w.feature, "kana", "") or w.surface) for w in _cutlet_obj(system).tagger(text))
    except Exception:  # noqa: BLE001 — no tagger reading available ⇒ nothing to exclude
        own = ""
    kanas = [k for k in _japanese_kana(text) if k != own]   # the IPADIC readings (shared with the scheme→scheme derivation), minus cutlet's own
    out = []
    for kana in kanas[:_MAX_READINGS]:
        r = _cutlet(kana, system).replace(" ", "")   # cutlet re-tags the bare kana and can split it (ユク → "Yu ku"); one token's reading is one word
        if r:
            out.append(r)
    return out


def _korean_readings(text: str) -> list[str]:
    """Ordered romanisations of the Sino-Korean readings a mixed-script Korean token can take, from
    the SAME vendored kHangul table `_hanja_to_hangul` reads for the displayed value and romanised
    through the SAME `_korean` transliterator, so a candidate can never contradict what is on screen.

    A Hanja is heteronymic in Korean just as it is in Chinese — 樂 is 락 "pleasure" / 악 "music" /
    요 "to like" — and only 383 of the 8,525 graphs in the table carry more than one reading, so most
    tokens fall out at the `alts` gate below without building anything.  A pure-Hangul token has no
    Hanja to re-read at all and therefore no alternatives, which is the common case for Korean.

    Per the WHOLE-TOKEN RULE, only ONE hanja.  kHangul is a per-GRAPH table with no word layer, so a token
    of two or more hanja has no whole-token entry to consult, and the cross-product over 音 × 樂 offered
    음락/음요 beside the right 음악.  A single hanja IS the whole token's readable content, whatever Hangul
    inflection follows it (樂들), so that case is untouched."""
    tbl = _hanja_table()
    if not tbl or _han_count(text) > 1:
        return []
    lists: list[list[str]] = []
    alts = False
    for i, ch in enumerate(text):
        rs = tbl.get(ch) if _is_han(ch) else None
        if not rs:
            lists.append([ch])   # Hangul, Latin, punctuation: one "candidate", passed through as `_hanja_to_hangul` passes it
            continue
        initial = _ko_initial(text, i)
        opts: list[str] = []
        for r in rs[:_MAX_PER_CHAR]:
            v = (_dueum(r) or r) if initial else r   # the initial law applies to every candidate at a word-initial position, not just the default one
            if v not in opts:
                opts.append(v)
        lists.append(opts)
        alts = alts or len(opts) > 1
    if not alts:
        return []
    return [_korean("".join(lists[k][i] for k, i in enumerate(pick)))
            for pick in _combos([len(x) for x in lists])]


def readings(text: str, lang: str, scheme: str = "", upos: str = "") -> list[str]:
    """ORDERED candidate romanisations of ``text`` in ``scheme`` (best guess first), for the CJK
    languages whose romanisation is genuinely ambiguous.  The first entry is always what the app is
    currently displaying, so the caller can tick it.  Returns ``[]`` when the engine offers only one
    reading (nothing to choose), for any other language or scheme, and on any failure — never raises.

    "The engine offers only one reading" is judged of the WHOLE TOKEN: a multi-character token answers
    ``[]`` unless the engine's own dictionary holds a second reading of that word, however heteronymic
    its individual characters are (see the whole-token rule above).  So a token this used to answer for
    may now answer ``[]``; the caller shows no flyout row, which is what it already does for every
    unambiguous token, and the language's Stored transliteration stays editable regardless.

    ``upos`` is an OPTIONAL UD tag and REORDERS, it does not filter: the list is built exactly as it
    would be without one and the reading the tag names is promoted to index 0.  It needs no code of
    its own here, and deliberately so — the list is seeded with `_render_one`, which is where the
    POS conditioning lives, and the dedup below then keeps that value at the front however the
    engine ordered the rest.  A tag that names nothing leaves the order alone.  The cache key
    carries ``upos`` for the same reason `_render_one`'s does."""
    if not text or not lang:
        return []
    base = _canon_lang(_norm(lang))
    if base not in _READING_LANGS:
        return []
    scheme = scheme or _default_scheme(base)
    key = (lang, scheme, text, upos or "")
    if key in _READINGS:
        return list(_READINGS[key])
    try:
        if base in ("zh", "lzh") and scheme in _MANDARIN_JOIN:
            cands = _mandarin_readings(text, scheme)
        elif scheme == "jyutping" and base in ("yue", "lzh"):
            cands = _jyutping_readings(text)
        elif scheme in ("mc", "oc") and base == "lzh":
            cands = _baxter_readings(text, 0 if scheme == "mc" else 1)
        elif scheme in ("kunrei", "hepburn") and base == "ja":
            cands = _japanese_readings(text, scheme)
        elif base == "ko":
            cands = _korean_readings(text)   # Korean has ONE scheme ("default" → Academic), so no scheme guard: any scheme reaching here is that one
        else:
            cands = []   # General Chinese is one dialect-neutral spelling per graph, and the script
            #              schemes (Simplified/Traditional) aren't readings at all → nothing to choose
    except Exception:  # noqa: BLE001 — a missing extras tier or an engine hiccup means "no alternates", never an error
        cands = []
    out: list[str] = []
    for c in ([_render_one(text, lang, scheme, upos or "")] + cands):   # the displayed rendering heads the list, whatever the engine ordered — and it is the POS-conditioned one when a tag was given
        c = _latinize_punct(c) if (c and _is_latin_output(scheme)) else c
        if c and c not in out:
            out.append(c)
    if len(out) < 2:
        out = []   # one reading = nothing to choose; the caller shows no menu row at all
    _READINGS[key] = out[:_MAX_READINGS]
    return list(_READINGS[key])


# ── the hand-corrected STORED transliteration, and the DISPLAYED schemes derived FROM it ──────
# For a language whose romanisation is genuinely NON-DETERMINISTIC the value that MATTERS is the
# STORED one (MISC Translit), because that is what the file keeps and what every later reader sees:
# Han heteronyms (行 = xíng "go" / háng "row"), the several on'yomi/kun'yomi of a Japanese kanji, and
# the unvocalised abjads, whose short vowels are simply not written and which no engine can recover.
# The frontend makes that stored value click-editable per token for exactly these languages; nowhere
# else, because elsewhere the romanisation is a function of the spelling and there is nothing to
# correct.  Which leaves the DISPLAYED row — in general a DIFFERENT scheme — to be re-rendered FROM
# the correction rather than from the surface form all over again: that is `derive_scheme` below.
_ABJAD_LANGS = frozenset({
    "ar", "fa", "prs", "ur", "ps", "sd", "ckb",   # Arabic script: the short vowels are not written
    "he", "yi", "arc", "aii", "syr",              # Hebrew / Aramaic / Syriac: likewise
})   # deliberately NOT "ug" (Uyghur) or "dv" (Dhivehi): both spell every vowel out, so their
#      romanisation IS deterministic and an editable stored row there would be noise.


def ambiguous(lang: str) -> bool:
    """Is ``lang``'s romanisation genuinely non-deterministic — i.e. is the machine's guess something a
    user must be able to CORRECT rather than merely read?  True for the CJK reading languages (the same
    set `readings` offers alternatives for, so the readings flyout and the editable stored value always
    cover the same languages) and for the unvocalised abjads.  False everywhere else.

    A property of the LANGUAGE, not of the token, and deliberately left that way when `readings` narrowed
    to whole-token lookups: a Chinese or Korean token that now has no flyout row is not thereby a token
    whose romanisation is certain — 一行 and 音樂 are exactly the cases the machine gets wrong and cannot
    enumerate its way out of — so the editable Stored value must still be there to type the answer into.
    The frontend gates that row on this predicate alone (`storedTrEditable` in js/lang/translit.js), never
    on `readings`, so the two narrowings are independent by construction."""
    base = _canon_lang(_norm(lang))
    return base in _READING_LANGS or base in _ABJAD_LANGS


_DERIVED: dict[tuple, str] = {}


def _cmp_key(s: str) -> str:
    """Comparison key for matching a HAND-TYPED romanisation against an engine rendering: the spacing
    between syllables, a syllable hyphen/apostrophe and letter case are the typist's, not the reading's."""
    return re.sub(r"[\s'’·\-]+", "", (s or "")).lower()


def _japanese_kana(text: str) -> list[str]:
    """Every distinct katakana reading IPADIC records for the WHOLE token surface, cheapest connection
    cost (i.e. most frequent) first — the raw list _japanese_readings filters.  It keeps the reading
    cutlet's own tagger chose, which _japanese_readings drops: derivation matches candidates BY INDEX
    across two romanisation systems, so both sides must enumerate the SAME readings in the same order,
    and a kana string that round-trips to a different spelling (トウキョウ → toukyou beside 東京 →
    tokyo) is a spelling the user may well have stored."""
    global _JANOME
    from janome.tokenizer import Tokenizer
    if _JANOME is None:
        _JANOME = Tokenizer()
    dic = _JANOME.sys_dic
    try:
        ents = dic.lookup(text.encode("utf-8"), _JANOME.matcher)   # as in _japanese_readings
    except TypeError:   # a RAM (non-mmap) dictionary takes no matcher
        ents = dic.lookup(text.encode("utf-8"))
    kanas: list[str] = []
    for e in sorted([x for x in ents if x[1] == text], key=lambda x: x[4]):   # x[4] = cost (lower = more frequent)
        extra = dic.lookup_extra(e[0])
        kana = extra[4] if extra and len(extra) > 4 else ""
        if kana and kana != "*" and kana not in kanas:
            kanas.append(kana)
    return kanas[:_MAX_READINGS]


def _mandarin_pairs(text: str, src: str, dst: str) -> list[tuple[str, str]]:
    """Every candidate reading of ``text`` rendered in BOTH Mandarin schemes, from one shared pick of
    per-character numbered-pinyin syllables — so the two strings in a pair always spell the same reading.

    Deliberately NOT passed ``whole_only``: the whole-token rule governs what is OFFERED, while this list
    is what a stored value already typed by hand is RECOGNISED against, and a user who corrected 银行 to
    yínxíng means it.  Narrowing here would make `derive_scheme` return "" for that correction and the
    Displayed row romanise the surface form again — silently putting the automatic reading back, which is
    the one thing the editable Stored value exists to prevent.  The same asymmetry `_japanese_kana` already
    documents (it keeps the reading `_japanese_readings` drops) and for the same reason."""
    choices = _mandarin_choices(text)
    if not choices:
        return []
    js, jd = _MANDARIN_JOIN[src], _MANDARIN_JOIN[dst]
    out = []
    for pick in _combos([len(o) for _, o in choices]):
        sel = [(is_han, opts[i]) for (is_han, opts), i in zip(choices, pick)]
        out.append((js(sel), jd(sel)))
    return out


def _baxter_pairs(text: str, src: str, dst: str) -> list[tuple[str, str]]:
    """The same, for Baxter Middle Chinese ↔ Baxter–Sagart Old Chinese.  The (MC, OC) rows are read
    JOINTLY, one pick per character, so the two transcriptions always describe the same reading of the
    graph — _baxter_readings builds each scheme's list on its own and its indices need not line up
    (a graph with an empty MC field in one row shortens that list and not the other)."""
    table, allrec = _baxter_table(), _baxter_all()
    lists: list[list[tuple[str, str]]] = []
    for ch in text:
        if not _is_han(ch):
            lists.append([(ch, ch)])   # a non-Han character passes through in both, as in _baxter
            continue
        cur = table.get(ch) or ("", "")
        opts = [cur] if (cur[0] or cur[1]) else []   # the row _baxter itself would print, first
        for rec in allrec.get(ch, []):
            if rec not in opts and (rec[0] or rec[1]):
                opts.append(rec)
        lists.append(opts[:_MAX_PER_CHAR] or [("", "")])
    i0, i1 = (0 if src == "mc" else 1), (0 if dst == "mc" else 1)
    out = []
    for pick in _combos([len(x) for x in lists]):
        rows = [lists[k][i] for k, i in enumerate(pick)]
        out.append((" ".join(r[i0] for r in rows if r[i0]).strip(),
                    " ".join(r[i1] for r in rows if r[i1]).strip()))
    return out


def _japanese_pairs(text: str, lang: str, src: str, dst: str) -> list[tuple[str, str]]:
    """The same, for Kunrei ↔ Modified Hepburn: one katakana reading romanised through both cutlet
    systems.  The whole-token rendering heads the list, exactly as it heads `readings`."""
    out = [(_render_one(text, lang, src), _render_one(text, lang, dst))]
    for kana in _japanese_kana(text):
        a, b = _cutlet(kana, src).replace(" ", ""), _cutlet(kana, dst).replace(" ", "")   # one token's reading is one word
        if a and b:
            out.append((a, b))
    return out


def _scheme_pairs(text: str, lang: str, src: str, dst: str) -> list[tuple[str, str]]:
    """(``src`` rendering, ``dst`` rendering) for every candidate reading of ``text``, in one order.
    Empty ⇒ the two schemes share no candidate structure, so nothing can be derived between them."""
    base = _canon_lang(_norm(lang))
    if base in ("zh", "lzh") and src in _MANDARIN_JOIN and dst in _MANDARIN_JOIN:
        return _mandarin_pairs(text, src, dst)
    if base == "lzh" and src in ("mc", "oc") and dst in ("mc", "oc"):
        return _baxter_pairs(text, src, dst)
    if base == "ja" and src in ("kunrei", "hepburn") and dst in ("kunrei", "hepburn"):
        return _japanese_pairs(text, lang, src, dst)
    return []
    # Everything else is genuinely NOT derivable, and says so rather than emitting something wrong:
    #  · General Chinese is CHARACTER-keyed (app/data/tungdzih_keywords.tsv holds one dialect-neutral
    #    spelling per graph — 行 → haeng, whichever reading is meant), so no correction to a Mandarin
    #    or Cantonese reading can move it.
    #  · Baxter MC/OC likewise come from a character table, not from a modern reading; Jyutping and
    #    Pinyin transcribe two different languages, and no dictionary here relates their readings.
    #  · An abjad has ONE scheme, so src == dst always and the identity path above already answered.
    # The frontend falls back to romanising the surface form for these, which is what it did before.


def derive_scheme(text: str, stored: str, lang: str, src: str = "", dst: str = "") -> str:
    """Re-express ``stored`` — the STORED romanisation of surface form ``text``, in scheme ``src`` — in
    scheme ``dst``.  "" when the conversion is not possible (see _scheme_pairs) or when ``stored`` is not
    a reading either engine knows, in which case the caller must fall back to romanising ``text`` itself.

    No romanisation string is ever PARSED: the candidate readings the engines can produce are enumerated
    (the same machinery `readings` offers the user), ``stored`` is matched against them in ``src``, and
    the matching candidate is re-joined through the ``dst`` engine's own joiner.  So a derived value can
    never contradict either scheme — correcting 行's stored Pinyin to háng picks the hang2 syllable, and
    the Zhuyin/Gwoyeu Romatzyh rows then spell THAT syllable.  Never raises."""
    if not stored or not lang:
        return ""
    base = _canon_lang(_norm(lang))
    src = src or _default_scheme(base)
    dst = dst or _default_scheme(base)
    if src == dst:
        return stored   # identity — every abjad (one scheme), and any language whose Displayed IS its Stored
    key = (lang, src, dst, text, stored)
    if key in _DERIVED:
        return _DERIVED[key]
    out = ""
    try:
        want = _cmp_key(stored)
        for a, b in _scheme_pairs(text, lang, src, dst):
            if a and _cmp_key(_latinize_punct(a) if _is_latin_output(src) else a) == want:
                out = _latinize_punct(b) if _is_latin_output(dst) else b
                break
        # A miss is normal and deliberate: _combos caps the enumeration (a token whose two heteronymic
        # characters BOTH need overriding is past the point of usefulness), and a freely hand-typed
        # romanisation need not be a reading any engine holds.  "" → the caller romanises the form.
    except Exception:  # noqa: BLE001 — an engine hiccup means "not derivable", never an error
        out = ""
    _DERIVED[key] = out
    return out


def derive_many(forms: list[str], stored: list[str], lang: str, src: str = "", dst: str = "") -> list[str]:
    n = min(len(forms or []), len(stored or []))
    return [derive_scheme(forms[i], stored[i], lang, src, dst) for i in range(n)]
