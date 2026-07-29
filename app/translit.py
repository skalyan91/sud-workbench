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
_CACHE: dict[tuple[str, str, str], str] = {}   # (lang, scheme, text) → transliteration

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


def _mandarin_syllables(text: str) -> list[tuple[bool, str]]:
    """Per-character numbered pinyin (Style.TONE3) for every Han character in ``text``, non-Han
    runs passed through verbatim.  不 is corrected to the actual tone-sandhi rule (4th tone → 2nd
    tone before a following 4th-tone syllable) rather than relying on pypinyin's own sandhi, which
    only fires for phrases in its built-in dictionary (e.g. 不是/不對/不要 but not 不去).
    Returns (is_han, numbered_syllable_or_literal_text) pairs, one per pypinyin segment."""
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
# Both come from the same char-keyed table vendored in app/data/baxter_sagart.tsv (Wiktionary's
# "Appendix:Baxter-Sagart Old Chinese reconstruction", Baxter & Sagart v1.00): the MC field is
# Baxter's Middle Chinese transcription (with X/H tone letters), the OC field the Baxter–Sagart
# Old Chinese reconstruction (leading *).  Characters absent from the table are dropped, never guessed.
_BAXTER: dict[str, tuple[str, str]] | None = None


def _baxter_table() -> dict[str, tuple[str, str]]:
    global _BAXTER
    if _BAXTER is None:
        _BAXTER = {}
        try:
            with open(os.path.join(_DATA_DIR, "baxter_sagart.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    parts = line.rstrip("\n").split("\t")
                    ch = parts[0]
                    mc = parts[1] if len(parts) > 1 else ""
                    oc = parts[2] if len(parts) > 2 else ""
                    _BAXTER[ch] = (mc, oc)
        except Exception:  # noqa: BLE001
            pass
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
    if v1 in _YAN:                           # yaṇ: i/u/ṛ/ḷ + dissimilar vowel → semivowel + vowel  [6.1.77]
        return _YAN[v1] + v2                 #   (like-vowel cases already handled by savarṇa above)
    if v1 in ("e", "o") and v2 == "a":       # eṅaḥ padāntād ati: e/o + a → e'/o' (a elided)  [6.1.109]
        return v1 + _AVAGRAHA
    if v1 in _AYADI:                          # ayādi: e→ay, o→av, ai→āy, au→āv before a vowel  [eco'yavāyāvaḥ 6.1.78]
        return _AYADI[v1] + v2                #   (the optional śākalya y/v-elision, 8.3.19, is NOT applied)
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


def sandhi_join(forms, lang: str = "sa", lemmas=None, word_sep: str = "") -> str:
    """Assemble ``forms`` (component IAST words) into one surface string, fusing the joins by
    external sandhi for Sanskrit.  Non-Sanskrit ⇒ naive concatenation.  Left-folded pairwise.
    ``lemmas`` (optional, parallel to ``forms``) supplies each word's CoNLL-U lemma as an r-stem
    signal for visarga sandhi.  ``word_sep`` is what a NON-fusing junction keeps: "" glues the words
    (an MWT is one spaceless token — the default), while the block-initial running line passes " " so
    a genuinely un-coalescing junction (e.g. a vowel-final word before a consonant, ``eke vāñchanti``)
    stays two words rather than merging into one.  A newline in the stream is a hard break (see
    _iast_join_pair): sandhi never fires across it, newlines are kept (so multi-line input stays
    multi-line), and no word_sep is added around it.  Item 18: the words are PREPROCESSED
    (circumflex/apostrophe/hyphen/pipe cleanup + consonant-final gluing) before the sandhi fold."""
    pairs = [(f, (lemmas[i] if lemmas and i < len(lemmas) else None))
             for i, f in enumerate(forms or []) if f]
    if not pairs:
        return ""
    if _canon_lang(_norm(lang)) != "sa":
        return "".join(f for f, _ in pairs)
    pairs = _sandhi_preprocess(pairs)   # item 18: clean + glue consonant-final words, then fuse
    if not pairs:
        return ""
    out, out_lemma = pairs[0]
    out_form = pairs[0][0]   # the surface form of the word contributing out's trailing visarga (ignores glued prefixes)
    for nxt, lm in pairs[1:]:
        out = _iast_join_pair(out, nxt, out_lemma, out_form, word_sep)   # out_lemma/out_form = the word contributing out's final visarga
        out_lemma, out_form = lm, nxt
    return _ud.normalize("NFC", _glue_consonant_runs(out, word_sep))   # LAST step: glue any (now) consonant-final words


def sandhi_to_script(forms, lang: str, scheme: str = "", lemmas=None, word_sep: str = "") -> str:
    """Sanskrit MWT display form: fuse the component IAST forms by sandhi, THEN convert the fused
    string to the chosen script (scheme).  Empty scheme ⇒ the fused IAST itself.  Newlines in the
    fused string are preserved through the script conversion (multi-line input stays multi-line).
    ``word_sep`` (see sandhi_join) keeps a word separation at non-coalescing junctions for the running
    line ("" for a spaceless MWT); aksharamukha preserves the space through the script conversion."""
    fused = sandhi_join(forms, lang, lemmas, word_sep)
    if not fused or not scheme:
        return fused
    return _render_one(fused, lang, scheme)


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


def _glue_running_iast(text: str) -> str:
    """Item 6 (rev) + item 15: fuse the RAW (CSL-encoded) sentence ``text`` into one IAST running
    string by the GLUING algorithm — consonant-final concatenation plus the small, deterministic set
    of external-sandhi phenomena that a spaceless running line needs:
      1. take the raw text one hard line at a time (``\\n`` is a non-gluing hard break, preserved);
      2. per whitespace word, strip the apostrophes/quotes ``'`` ``"`` ``”``, hyphens ``-`` and
         WORD-INTERNAL pipes ``|`` — a bare daṇḍa token ``|``/``||`` survives as punctuation — and
         fold the CSL circumflex vowels (â→ā, ê→e, ô→o, î→ī, û→ū).  (All via _sandhi_preclean.)
         Hyphen-/pipe-separated compound members thus glue into a single word;
      3. glue a word ENDING IN A CONSONANT onto the following word (no space); a word ending in a
         vowel, visarga ``ḥ`` or anusvāra ``ṃ`` keeps a separating space.  NASAL ASSIMILATION: a
         word-final ``-m`` before a following CONSONANT becomes anusvāra ``ṃ`` and the word boundary
         (space) is kept — ``arjitam pūrva-`` → ``arjitaṃ pūrva…`` (कर्मार्जितं पूर्वभवे).  A word-final
         ``-m`` before a VOWEL keeps the ``m`` and glues (it joins the vowel: ``tam a-`` → ``tama…``),
         and before a daṇḍa / pause it stays ``m`` (म्).
      4. VOICING (item 15): a word-final voiceless stop k/c/ṭ/t/p voices to g/j/ḍ/d/b before a voiced
         onset (vowel or voiced consonant), then glues as usual — ``sat ādi`` → ``sadādi``.
      5. VISARGA (item 15): the visarga ``ḥ`` is resolved before a voiced onset —
           · ``-aḥ`` + voiced consonant → ``-o`` + (glue): ``ahaḥ rātra`` → ``ahorātra``;
           · ``-aḥ`` + ``a-`` → ``-o`` + (glue, the following ``a`` elided — the avagraha this line
             would otherwise carry is stripped): ``ahaḥ atra`` → ``ahotra``;
           · ``-aḥ`` + other vowel → ``-a`` + that vowel, a hiatus that keeps the word separation;
           · ``-āḥ`` + voiced consonant → ``-ā`` + (glue); ``-āḥ`` + vowel → ``-ā`` + space (hiatus);
           · ``-Xḥ`` (X = i/ī/u/ū/…) + voiced onset → ``-Xr`` + (glue); but before ``r-`` the visarga's
             r is dropped and X lengthens (``-iḥ r-`` → ``-ī r-``), keeping the word separation.
         Before a VOICELESS sound or a pause the visarga is left intact (with its word separation).
    The fused string is handed to the script converter (_render_one → _sanskrit), which splits on the
    daṇḍa markers and transliterates each segment.  Operating on the RAW text (not the already-split
    token forms) is what makes the hyphen/pipe gluing work — the tokeniser drops those markers."""
    def _is_danda(x):   # a bare daṇḍa token (| || / // ‖) is punctuation, never a glue TARGET
        return bool(x) and all(c in "|/‖" for c in x)

    def _visarga(buf, w):
        """Resolve a visarga-final ``buf`` against the next word ``w`` (both cleaned IAST)."""
        pre = buf[:-1]                       # buf without its ḥ
        fv = _final_vowel(pre)               # the vowel before the visarga
        iv = _initial_vowel(w)
        if not _starts_voiced(w):            # before a voiceless onset → visarga kept, word separated
            return buf + " " + w
        if fv == "a":
            if iv == "a":                    # -aḥ + a- → -o + (a elided) glue
                return pre[:-1] + "o" + w[1:]
            if iv is not None:               # -aḥ + other vowel → -a + vowel (hiatus, keep separation)
                return pre + " " + w
            return pre[:-1] + "o" + w        # -aḥ + voiced consonant → -o + glue  (ahaḥ rātra → ahorātra)
        if fv == "ā":
            if iv is None:                   # -āḥ + voiced consonant → -ā + glue
                return pre + w
            return pre + " " + w             # -āḥ + vowel → -ā + vowel (hiatus, keep separation)
        # -iḥ/-uḥ/-eḥ/-oḥ/… (any other vowel + visarga) before a voiced onset → rutva (-r)
        if w and w[0] != "r":
            return pre + "r" + w             # -Xr + glue
        return _lengthen_final_vowel(pre) + " " + w   # before r-: drop visarga-r, lengthen X, separate

    lines = []
    for line in (text or "").split("\n"):
        buf = ""
        elided = False   # True ⇒ buf's OWN trailing consonant came from _sandhi_preclean stripping an
        # apostrophe/quote off the word that produced it (e.g. "c'" → "c", marking that word's OWN final
        # vowel as elided before the next word's vowel — see _sandhi_preclean's (a)). That "c" is NOT a
        # genuine word-final consonant in the source text, so it must NOT then feed the item-15 VOICING
        # rule below (voiceless stop → voiced before a voiced onset, "sat ādi" → "sadādi"): voicing a
        # stop that already lost its vowel to elision is a category error, not a real sandhi context —
        # cleaning "c'" to "c" and then treating it exactly like a genuinely bare word-final "c" (as in
        # "vāc") glued "vibhuś" + "c'" + "ânekadā" into "vibhuśjānekadā" (voicing c→j) instead of the
        # correct "vibhuścānekadā" (bug found live: "vibhuḥ ca" rendered as विभुश्ज instead of विभुश्च).
        for raw in line.split():
            w = _sandhi_preclean(raw)
            if not w:
                continue
            new_elided = bool(raw) and raw[-1] in _APOS_QUOTES   # this word's OWN apostrophe, not buf's carried-over one
            if not buf:
                buf = w
            elif _is_danda(w):
                buf += " " + w      # a daṇḍa target → keep a space (never a glue target)
            elif buf.endswith("ḥ"):
                buf = _visarga(buf, w)   # item 15: visarga sandhi
            elif not _ends_in_consonant(buf):
                buf += " " + w      # vowel / anusvāra final → keep a space
            elif buf.endswith("m") and _starts_with_consonant(w):
                buf = buf[:-1] + "ṃ " + w   # word-final m + consonant → anusvāra, boundary kept
            elif buf[-1] in _VOICE_FINAL and _starts_voiced(w) and not elided:
                buf = buf[:-1] + _VOICE_FINAL[buf[-1]] + w   # item 15: voice final stop, then glue
            else:
                buf += w            # other consonant (or m before a vowel) → glue (no space)
            elided = new_elided     # buf's new trailing text always ends with (a possibly-truncated) w, in every branch above
        lines.append(buf)
    return "\n".join(lines)


def sanskrit_running_line(text: str, lang: str = "sa", scheme: str = "") -> str:
    """The block-initial running text for Sanskrit: glue the RAW sentence ``text`` per the gluing
    algorithm (see _glue_running_iast), then render the fused string in ``scheme`` (a script).
    Non-Sanskrit ⇒ the text unchanged; empty scheme ⇒ the fused IAST itself (no script conversion)."""
    if _canon_lang(_norm(lang)) != "sa":
        return text or ""
    fused = _glue_running_iast(text)
    if not fused or not scheme:
        return fused
    return _render_one(fused, lang, scheme)


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
_DANDA_SPLIT = re.compile(r"(//|\|\||‖|/|\||\n)")   # double markers first so "//"/"||"/"‖" aren't split into singles; "‖" (U+2016) is the double-daṇḍa DISPLAY glyph; item 20: a newline is captured too so it rides THROUGH the script conversion as a hard break (no sandhi/aksharamukha collapse across it)


def _sanskrit(text: str, target: str) -> str:
    try:
        from aksharamukha import transliterate as ak

        def _ak(seg: str) -> str:
            if not seg:
                return seg
            src = ak.auto_detect(seg) if hasattr(ak, "auto_detect") else "autodetect"
            if not src or src == target or src == "Zyyy":   # Zyyy = "common" (punctuation/whitespace only) → treat as IAST
                src = "IAST"   # UD Sanskrit forms are usually IAST romanisation
            return ak.process(src, target, seg) or ""

        d1, d2 = _DANDA.get(target, _DANDA_DEFAULT)
        out = []
        for piece in _DANDA_SPLIT.split(text):   # word-segments interleaved with daṇḍa markers + newlines
            if piece in ("//", "||", "‖"):        # "‖" (U+2016) = the double-daṇḍa display glyph → script's double daṇḍa
                out.append(d2)
            elif piece in ("/", "|"):
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
    per the spec: transliteration only fires when the token isn't already in Latin script."""
    if not _is_indic(text):
        return ""   # already Latin (IAST/ISO) → nothing to romanise
    try:
        from aksharamukha import transliterate as ak
        src = ak.auto_detect(text) if hasattr(ak, "auto_detect") else "Devanagari"
        if not src:
            src = "Devanagari"
        return ak.process(src, "IAST", text) or ""
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
    if sid == "iast" or (base == "sa"):   # IAST + all Indic scripts ride aksharamukha
        return _pkg("aksharamukha")
    eng = _ENGINES.get(sid)
    return bool(eng and eng[1]())


def _schemes_for(registry: dict, base: str) -> list[dict]:
    return [{"id": sid, "label": label, "available": _scheme_available(base, sid)}
            for sid, label in registry.get(base, [])]


# ── three-way scheme model (item 1) ───────────────────────────────────────────
#  · SCRIPT  = NON-LATIN genuine writing systems that re-render the MAIN GLYPH (+ frontend "Original").
#  · DISPLAY = the transliteration ROW: every romanisation/transcription/reconstruction (a SUPERSET).
#  · STORED  = the subset of DISPLAY marked stored=True, written to MISC Translit/LTranslit on a parse pass.
_SERB = ("sr", "srp", "hbs", "bs", "bos")
_MONG = ("mn", "mon", "khk")
_SCRIPT_SCHEMES: dict[str, list[tuple[str, str]]] = {
    "zh": _HANZI_CONV, "yue": _HANZI_CONV, "lzh": _HANZI_CONV,
    "sa": list(_AKSHARA_SCRIPTS),
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
    "sa": [("iast", "IAST", True)],
    "ja": [("kunrei", "Kunrei", True), ("hepburn", "Modified Hepburn", True)],
    **{c: [("latin", "Latin (Gajica)", True)] for c in _SERB},
}


def script_schemes(lang: str) -> list[dict]:
    """NON-LATIN SCRIPT options for ``lang`` (re-render the main glyph). The frontend prepends 'Original'.
    Empty ⇒ no script menu."""
    base = _canon_lang(_norm(lang))
    return [{"id": sid, "label": label, "available": _scheme_available(base, sid)}
            for sid, label in _SCRIPT_SCHEMES.get(base, [])]


def translit_schemes(lang: str) -> list[dict]:
    """DISPLAYED transliteration schemes (the row) → ``[{"id","label","stored","available"}]`` (a superset).
    ``stored`` marks the subset written to MISC Translit/LTranslit.  Empty ⇒ no transliteration menu."""
    base = _canon_lang(_norm(lang))
    if base in _DISPLAY_SCHEMES:
        return [{"id": sid, "label": label, "stored": st, "available": _scheme_available(base, sid)}
                for sid, label, st in _DISPLAY_SCHEMES[base]]
    if base in _SINGLE_LANGS:
        return [{"id": "default", "label": _SINGLE_LABEL.get(base, "Romanization"), "stored": True, "available": True}]
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


def _render_one(text: str, lang: str, scheme: str) -> str:
    """Shared engine dispatch for BOTH transliteration and orthography — they use the same engines,
    keyed by scheme id (scheme ids are globally unique across the two menus).  Cached per (lang, scheme)."""
    if not text or not lang:
        return ""
    base = _canon_lang(_norm(lang))
    scheme = scheme or _default_scheme(base)
    key = (lang, scheme, text)
    if key in _CACHE:
        return _CACHE[key]
    try:
        if scheme == "iast":
            out = _iast(text)
        elif scheme in _AKSHARA_IDS and base == "sa":
            out = _sanskrit(text, scheme)
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


def transliterate(forms, lang: str, scheme: str = ""):
    """Transliterate (ROMANISE) ``forms`` for ``lang`` under ``scheme`` ("" ⇒ the language's default).
    Accepts a single string or a list; returns the same shape.  Never raises (failures → "")."""
    if isinstance(forms, (list, tuple)):
        return [transliterate(f, lang, scheme) for f in forms]
    return _render_one(forms, lang, scheme)


def orthography(forms, lang: str, scheme: str = ""):
    """Re-render ``forms`` in the display-only ORTHOGRAPHY ``scheme`` (Zhuyin, GR, an Indic script, …).
    "" ⇒ Original (returns "" so the caller keeps the original glyphs).  Never raises."""
    if isinstance(forms, (list, tuple)):
        return [orthography(f, lang, scheme) for f in forms]
    if not scheme:
        return ""   # "Original" — no re-rendering
    return _render_one(forms, lang, scheme)


def transliterate_many(forms: list[str], lang: str, scheme: str = "") -> list[str]:
    return [transliterate(f, lang, scheme) for f in forms]


def orthography_many(forms: list[str], lang: str, scheme: str = "") -> list[str]:
    return [orthography(f, lang, scheme) for f in forms]


# ── heteronym readings (Chinese + Japanese) ───────────────────────────────────
# Han characters are heteronymic (行 = xíng "go" / háng "row") and Japanese kanji carry several
# on'yomi/kun'yomi, so the ONE romanisation the engines pick above is sometimes the wrong one for a
# given token.  `readings` returns the ordered candidates for the CURRENTLY DISPLAYED scheme so the
# token context menu can offer a manual override.  Every candidate is derived from the SAME data the
# scheme's own engine uses — pypinyin's heteronym mode, ToJyutping's per-character candidate lists,
# the Baxter–Sagart table, IPADIC via Janome — and rendered through that engine's own joiner, so a
# candidate can never contradict the scheme the user picked.  Scoped to the languages whose
# romanisation is genuinely ambiguous; every other language has nothing to choose between.
_READINGS: dict[tuple[str, str, str], list[str]] = {}   # (lang, scheme, text) → ordered candidates
_READING_LANGS = ("zh", "yue", "lzh", "ja", "ko")       # after _canon_lang: cmn→zh, jpn→ja, kor→ko
_MAX_READINGS = 12      # a pick list, not an enumeration — a 3-character token of 5-way heteronyms is already 125 combinations
_MAX_PER_CHAR = 6       # …and pypinyin/ToJyutping list rare dialectal readings well past the point of usefulness
_MANDARIN_JOIN = {"pinyin": _join_pinyin, "zhuyin": _join_zhuyin, "gr": _join_gr}   # the Mandarin schemes driven by numbered-pinyin syllables


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


def _mandarin_choices(text: str):
    """Per-position ORDERED candidate numbered-pinyin syllables: ``[(is_han, [syl, …]), …]``, one
    entry per _mandarin_syllables segment, each list headed by the syllable that engine actually
    chose (so the default reading stays first even where pypinyin's phrase dictionary or the 不
    tone-sandhi correction overrode the character's own citation reading).  None ⇒ no alternates.

    A character INSIDE a word pypinyin's phrase dictionary knows comes back with that one phrase
    reading and no heteronyms (一行 → yi1 xing2), so each such position is topped up from the
    character's own readings — which is precisely the case this feature exists for: the phrase
    dictionary is where the automatic romanisation goes wrong (一行 is yīháng "a row" as often as
    yīxíng "a trip"), and it can only be overridden from a list that HAS the other reading in it."""
    from pypinyin import Style, pinyin
    base = _mandarin_syllables(text)
    het = pinyin(text, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)
    if len(het) != len(base):   # the two passes segmented differently → alignment is a guess; offer nothing rather than a wrong reading
        return None
    out, idx = [], 0
    for (is_han, syl), cands in zip(base, het):
        if not is_han:
            out.append((False, [syl]))   # a non-Han run passes through verbatim, exactly as in _mandarin_syllables
            idx += len(syl)
            continue
        opts = [syl] + [c for c in cands if c != syl]
        if len(opts) == 1 and idx < len(text):   # phrase-dictionary hit → fall back to the character's own readings
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
    choices = _mandarin_choices(text)
    if not choices:
        return []
    join = _MANDARIN_JOIN[scheme]
    return [join([(is_han, opts[i]) for (is_han, opts), i in zip(choices, pick)])
            for pick in _combos([len(o) for _, o in choices])]


def _jyutping_readings(text: str) -> list[str]:
    """Ordered Jyutping candidates, from ToJyutping's own per-character candidate lists (the very
    table get_jyutping_text picks its single reading out of).  Restricted to an ALL-Han token: for a
    mixed token get_jyutping_text has its own spacing around the non-Han run, and re-joining the
    candidates by hand would silently disagree with the displayed default."""
    import ToJyutping
    cands = ToJyutping.get_jyutping_candidates(text)
    if not cands or any(not c[1] for c in cands):
        return []
    lists = [list(c[1])[:_MAX_PER_CHAR] for c in cands]
    return [" ".join(lists[k][i] for k, i in enumerate(pick)) for pick in _combos([len(x) for x in lists])]


_BAXTER_ALL: dict[str, list[tuple[str, str]]] | None = None


def _baxter_all() -> dict[str, list[tuple[str, str]]]:
    """Every (MC, OC) row the vendored table holds per character, in file order — the multi-reading
    view of the same data _baxter_table() collapses to one row per graph (last wins).  A graph that
    the source lists under several Middle Chinese readings therefore surfaces all of them here."""
    global _BAXTER_ALL
    if _BAXTER_ALL is None:
        _BAXTER_ALL = {}
        try:
            with open(os.path.join(_DATA_DIR, "baxter_sagart.tsv"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    parts = line.rstrip("\n").split("\t")
                    rec = (parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else "")
                    _BAXTER_ALL.setdefault(parts[0], [])
                    if rec not in _BAXTER_ALL[parts[0]]:
                        _BAXTER_ALL[parts[0]].append(rec)
        except Exception:  # noqa: BLE001
            pass
    return _BAXTER_ALL


def _baxter_readings(text: str, idx: int) -> list[str]:
    """Candidate Baxter (idx 0) / Baxter–Sagart (idx 1) readings, assembled exactly as _baxter does —
    space-joined, characters absent from the table dropped rather than guessed."""
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
    guess.  Janome's ``reading`` field (not ``phonetic``) is used, so the ー long-vowel mark never
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
    Hanja to re-read at all and therefore no alternatives, which is the common case for Korean."""
    tbl = _hanja_table()
    if not tbl:
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


def readings(text: str, lang: str, scheme: str = "") -> list[str]:
    """ORDERED candidate romanisations of ``text`` in ``scheme`` (best guess first), for the CJK
    languages whose romanisation is genuinely ambiguous.  The first entry is always what the app is
    currently displaying, so the caller can tick it.  Returns ``[]`` when the engine offers only one
    reading (nothing to choose), for any other language or scheme, and on any failure — never raises."""
    if not text or not lang:
        return []
    base = _canon_lang(_norm(lang))
    if base not in _READING_LANGS:
        return []
    scheme = scheme or _default_scheme(base)
    key = (lang, scheme, text)
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
    for c in ([_render_one(text, lang, scheme)] + cands):   # the displayed rendering heads the list, whatever the engine ordered
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
    cover the same languages) and for the unvocalised abjads.  False everywhere else."""
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
    per-character numbered-pinyin syllables — so the two strings in a pair always spell the same reading."""
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
