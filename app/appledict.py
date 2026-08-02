"""The dictionaries **Apple ships** for macOS's Dictionary.app, read straight out of their bundles.

The Definitions flyout has two sources already — Wiktionary over the network, and the vendored Apte
for Sanskrit. This is a third, and on the languages it covers it is the best of them: the
dictionaries are already on the machine, professionally edited, and need no network. It is tried
FIRST and the others stay exactly where they are behind it, because it is macOS-only and Apple has
no dictionary for most of the languages a treebank is written in.

⚠ **APPLE'S OWN ONLY — hand-installed dictionaries are deliberately NOT read** (see `_ROOTS` and
`_APPLE_ID` for the two tests that enforce it, and why either alone would let the wrong ones in).
A bundle under `~/Library/Dictionaries` is somebody's conversion of somebody's data: its markup,
its headword spelling and its sense structure are whatever the converting script emitted, and this
module's reading of them is a guess that happens to work on the one that was tested. Apple's are
edited to one house format.

⚠ **SANSKRIT DOES NOT COME HERE AT ALL**, even though Apple ships `com.apple.dictionary.sa-en.oup`.
`app/apte.py` — Apte's 1957 revised edition, vendored, 77.5 k entries indexed in SLP1 — is the
Sanskrit source, by user decision: it is a scholarly dictionary of the classical language, keyed to
the spellings a treebank actually holds. The routing is in `Api.definition_lookup`, which asks Apte
BEFORE it asks this module. So the restriction to Apple bundles does not by itself get Sanskrit
right; that is a separate rule and it is written down separately.

⚠ **NOTHING HERE KNOWS ANY PARTICULAR DICTIONARY.** The set is discovered and its languages are read
off each bundle. Which dictionaries Apple has downloaded differs on every machine, so no list of
titles would survive contact with a second one. The worked examples in the comments below are
evidence from one machine's shelf, cited to show a rule being tested — never a rule in themselves.

THE BUNDLE FORMAT, which is undocumented and was read off the files:

    Contents/Info.plist                       CFBundleName, DCSDictionaryLanguages, …
    Contents/[Resources/]Body.data            the entries
    Contents/[Resources/]KeyText.{data,index} Apple's own trie index — NOT used, see below

``Body.data`` is 64 zero bytes, a small header whose length varies by format version, then a run of
chunks. Each chunk is three little-endian uint32s — ``[total][compressed+4][decompressed]`` — and a
zlib stream; the next chunk starts at ``off + 4 + total``. Decompressed, a chunk is a run of
``[uint32 length][UTF-8 XML]`` entries, each a ``<d:entry>`` whose ``d:title`` is the headword (a
``<h1>`` in the oldest bundles, which predate the attribute).

⚠ **The header length is DISCOVERED, not assumed.** It is 0x60 in the current format
(``DCSBuildToolVersion`` 2 and 3) and 0x44 in the oldest (version 1, which is what a hand-built or
converted dictionary such as the bundled Latin one still uses). `_first_chunk` scans for the first
offset whose length triple and zlib stream agree with each other, so a version that moves it again
costs nothing — and a file that is not this format at all is rejected rather than half-read.

WHY NOT KeyText.index. Apple's own index is a trie in a private format ("com.apple.TrieAccessMethod")
that would have to be reverse-engineered a second time and re-verified against every format bump.
Building our own from one pass over ``Body.data`` is a few seconds per dictionary, happens once, and
depends on nothing but the entry framing this module already has to read.
"""

from __future__ import annotations

import glob
import gzip
import json
import os
import plistlib
import re
import struct
import sys
import zlib

from . import paths

# APPLE'S OWN DICTIONARIES ONLY — the MobileAsset paths its on-demand downloads land in. The two
# `Dictionaries/` folders are gone from this list ON PURPOSE (user decision): `/Library/Dictionaries`
# and `~/Library/Dictionaries` are where a dictionary installed BY HAND goes, and a hand-installed
# bundle is a conversion of somebody's data by somebody's script — its entry markup, its headword
# spelling and its sense structure are whatever the converter did, and this module's parse of them is
# a guess that happens to work. Apple's are edited to one house format we can actually rely on.
_ROOTS = (
    "/System/Library/AssetsV2/com_apple_MobileAsset_DictionaryServices_dictionary*/*/AssetData/*.dictionary",
    "/System/Library/Assets/com_apple_MobileAsset_DictionaryServices_dictionary*/*/AssetData/*.dictionary",
)
# …and the location is not enough on its own, so the identifier has to agree with it.
# ⚠ THE CONVERSE IS EMPHATICALLY NOT TRUE: a `com.apple.dictionary.*` id does NOT mean Apple made it.
# Measured on one shelf, three hand-installed bundles claim that prefix — `com.apple.dictionary.Latin`
# in /Library, `com.apple.dictionary.apte-bi` and `com.apple.dictionary.mw-itrans-dev` in ~/Library —
# because the conversion tools copy Apple's namespace. Identifier alone would have admitted all three.
# Both tests together admit exactly the AssetsV2 shelf, which is the set Apple ships.
_APPLE_ID = "com.apple.dictionary."
_INDEX_DIR = os.path.join(paths.APP_DATA, "appledict")
_INDEX_FORMAT = 1
_ZLIB_HEADS = (b"\x78\x9c", b"\x78\xda", b"\x78\x01", b"\x78\x5e")

_CACHE: dict = {}
# bundle id (or bundle name) → the language its HEADWORDS are in, set by the user.
# ⚠ NEEDED, and not a shortcut round work that could be automated. A dictionary that declares no
# languages and whose entry ids carry no direction leaves only one piece of evidence — the headwords
# — and that evidence can be genuinely empty: a dictionary keyed in ASCII transliteration ("a", "aa",
# "aMza") carries no script signal at all, and `langid` called one such shelf's headwords Finnish.
# Guessing there would silently offer one language's glosses for another's document. The user
# installed the dictionary and knows what it is; this is where they say so, for any bundle.
_OVERRIDES: dict = {}


def set_overrides(mapping: dict) -> None:
    """Replace the user's bundle → language assignments (see `_OVERRIDES`)."""
    global _OVERRIDES
    _OVERRIDES = {str(k): _base(str(v)) for k, v in (mapping or {}).items() if k and v}


def overrides() -> dict:
    return dict(_OVERRIDES)


def available() -> bool:
    """macOS, with at least one readable dictionary. False everywhere else, silently."""
    return sys.platform == "darwin" and bool(_bundles())


# ── discovery ───────────────────────────────────────────────────────────────────────────────────
def _body_path(bundle: str) -> str:
    for rel in ("Contents/Resources/Body.data", "Contents/Body.data"):
        p = os.path.join(bundle, rel)
        if os.path.isfile(p):
            return p
    return ""


def _bundles() -> list[str]:
    if sys.platform != "darwin":
        return []
    out = []
    for pat in _ROOTS:
        for d in glob.glob(os.path.expanduser(pat)):
            if not (_body_path(d) and os.path.isfile(os.path.join(d, "Contents", "Info.plist"))):
                continue
            if not str(_info(d).get("CFBundleIdentifier") or "").startswith(_APPLE_ID):
                continue   # in Apple's asset folder but not Apple's own — see _APPLE_ID
            out.append(d)
    return sorted(set(out))


def _info(bundle: str) -> dict:
    try:
        with open(os.path.join(bundle, "Contents", "Info.plist"), "rb") as fh:
            return plistlib.load(fh)
    except Exception:  # noqa: BLE001
        return {}


def _base(lang: str) -> str:
    """A bare language subtag: ``zh_CN`` → ``zh``, ``en_GB`` → ``en``, ``cmn`` → ``zh``."""
    b = (lang or "").replace("-", "_").split("_")[0].lower()
    return {"cmn": "zh", "jpn": "ja", "san": "sa", "kor": "ko", "fas": "fa", "per": "fa",
            "heb": "he", "iw": "he", "zho": "zh"}.get(b, b)


def _declared_langs(pl: dict) -> tuple[set, str]:
    """(index languages, primary language) as the bundle declares them; empty when it declares none.

    ``DCSDictionaryLanguages`` is a list of ``{IndexLanguage, DescriptionLanguage}``. Only the INDEX
    side is trusted here: on every bilingual checked, the description side simply repeats the
    bundle's primary language for BOTH halves — an X-English dictionary reports ``X`` even for the
    entries whose headwords are English — so it cannot tell an English-defining half from an
    X-defining one. What answers that is the entry ids and, failing those, the entry text."""
    langs = pl.get("DCSDictionaryLanguages") or []
    idx = {_base(l.get("DCSDictionaryIndexLanguage", "")) for l in langs if isinstance(l, dict)}
    return {x for x in idx if x}, _base(pl.get("DCSDictionaryPrimaryLanguage", ""))


# ── the Body.data reader ────────────────────────────────────────────────────────────────────────
def _first_chunk(full: bytes) -> int:
    """The offset of the first chunk, found by agreement rather than by constant. -1 if not this
    format at all."""
    for off in range(0x40, 0x140, 4):
        if off + 14 > len(full):
            break
        try:
            total, comp, decomp = struct.unpack_from("<III", full, off)
        except struct.error:
            continue
        if not (0 < comp <= total and off + 4 + total <= len(full) and 0 < decomp < 1 << 28):
            continue
        if full[off + 12:off + 14] not in _ZLIB_HEADS:
            continue
        try:
            if len(zlib.decompress(full[off + 12:off + 4 + total])) == decomp:
                return off
        except zlib.error:
            continue
    return -1


def _chunk_offsets(full: bytes) -> list[int]:
    off = _first_chunk(full)
    if off < 0:
        return []
    out = []
    while off + 12 <= len(full):
        try:
            total = struct.unpack_from("<I", full, off)[0]
        except struct.error:
            break
        if total <= 0 or off + 4 + total > len(full):
            break
        out.append(off)
        off += 4 + total
    return out


def _chunk_entries(full: bytes, off: int):
    """``(offset within the decompressed chunk, entry XML)`` for one chunk."""
    try:
        total = struct.unpack_from("<I", full, off)[0]
        raw = zlib.decompress(full[off + 12:off + 4 + total])
    except (struct.error, zlib.error):
        return
    p = 0
    while p + 4 <= len(raw):
        try:
            n = struct.unpack_from("<I", raw, p)[0]
        except struct.error:
            return
        if n <= 0 or p + 4 + n > len(raw):
            return
        yield p, raw[p + 4:p + 4 + n].decode("utf-8", "replace")
        p += 4 + n


_TITLE_RE = re.compile(r'\bd:title="([^"]*)"')
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _headword(entry: str) -> str:
    m = _TITLE_RE.search(entry)
    if m:
        return _unescape(m.group(1)).strip()
    m = _H1_RE.search(entry)              # the oldest bundles predate d:title
    return _WS_RE.sub(" ", _TAG_RE.sub("", _unescape(m.group(1)))).strip() if m else ""


def _unescape(s: str) -> str:
    from html import unescape
    return unescape(s)


def plain_text(entry: str) -> str:
    """An entry's visible text, tags stripped. What the flyout condenses into gloss units."""
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", entry, flags=re.S | re.I)
    return _WS_RE.sub(" ", _unescape(_TAG_RE.sub(" ", s))).strip()


# ── index ───────────────────────────────────────────────────────────────────────────────────────
def _index_path(bundle: str) -> str:
    import hashlib
    key = hashlib.sha1(bundle.encode("utf-8")).hexdigest()[:16]
    return os.path.join(_INDEX_DIR, key + ".json.gz")


def _fold(s: str) -> str:
    """The lookup key: casefolded, whitespace-trimmed. Deliberately NOT accent-stripped — a
    dictionary's own headword spelling is the annotation's spelling, and folding ā onto a would
    merge Sanskrit entries that are genuinely different words."""
    return _WS_RE.sub(" ", (s or "").strip()).casefold()


# ── which HALF of a bilingual defines in English ─────────────────────────────────────────────────
# A bilingual bundle holds both directions interleaved in one Body.data, and the metadata cannot
# tell them apart: every Apple bilingual reports its own primary language as the description
# language for BOTH halves (`Sanskrit - English` says `sa` even for its English-headword entries).
# What DOES tell them apart is the entry id, which encodes the direction — `s_b-sa-en` against
# `e_b-en-en-sa`, `f_b-fr-en` against `e_b-en-fr`. Entries are therefore grouped by id prefix and
# each group is judged on its own.
_ID_RE = re.compile(r'\bid="([A-Za-z]+_[A-Za-z0-9_]*(?:-[a-z]{2,3})*)')
_DIR_RE = re.compile(r"-([a-z]{2,3})-([a-z]{2,3})$")

# An English test that does NOT go through `langid`. It cannot: `langid` carries a deliberate
# romanised-Sanskrit override (an IAST diacritic signature wins over fastText), and an English
# English definition OF a word in one of those scripts is exactly the text that trips it (measured:
# one bilingual's English glosses came back as "sa"). Function words are the right signal anyway,
# and are script-blind. A dictionary gloss is terse and
# telegraphic ("masculine noun 1 degree 2 part, share"), so the threshold is low on purpose: what is
# being separated is English prose from French, Chinese or Devanagari prose, not English from a
# near neighbour.
_EN_STOP = frozenset(
    "the a an of to in and or is are was were be been being for with on at by from as that this "
    "these those it its he she they we you not no any all some such which who whom whose what "
    "when where how why if then than into onto out up down over under before after between about "
    "used using use esp especially usually person thing one two also other another each both".split())
_WORD_RE = re.compile(r"[A-Za-z]+")


def _looks_english(text: str) -> bool:
    words = [w.lower() for w in _WORD_RE.findall(text or "")]
    if len(words) < 25:
        return False
    hits = sum(1 for w in words if w in _EN_STOP)
    return hits / len(words) >= 0.10


def _detect(samples: list[str]) -> str:
    """The language of some HEADWORDS, via the app's own detector — used only where a bundle
    declares no languages at all, and only as a hint — `_OVERRIDES` is what settles it."""
    text = " ".join(s for s in samples if s)[:4000]
    if not text.strip():
        return ""
    try:
        from . import langid
        got = langid.detect_language(text)
        return _base((got or {}).get("lang", ""))
    except Exception:  # noqa: BLE001
        return ""


def _group_of(entry: str) -> str:
    m = _ID_RE.search(entry)
    return re.sub(r"\d+$", "", m.group(1)) if m else ""


def build_index(bundle: str, progress=None) -> dict | None:
    """One pass over ``Body.data`` → ``{headword: [chunk offset, offset in chunk]}`` plus the
    languages the entries actually turn out to be in. Cached; call `index` rather than this."""
    body = _body_path(bundle)
    if not body:
        return None
    try:
        full = open(body, "rb").read()
    except OSError:
        return None
    offs = _chunk_offsets(full)
    if not offs:
        return None
    keys: dict[str, list] = {}
    heads: dict[str, list] = {}     # id-prefix group → sample headwords
    bodies: dict[str, list] = {}    # id-prefix group → sample definition text
    counts: dict[str, int] = {}     # id-prefix group → how many entries it really has
    for i, off in enumerate(offs):
        for pos, entry in _chunk_entries(full, off):
            hw = _headword(entry)
            if not hw:
                continue
            g = _group_of(entry)
            counts[g] = counts.get(g, 0) + 1
            keys.setdefault(_fold(hw), [off, pos, g])
            hs = heads.setdefault(g, [])
            if len(hs) < 300:
                hs.append(hw)
                bodies.setdefault(g, []).append(plain_text(entry)[:400])
        if progress and not i % 20:
            progress(int(100 * i / max(1, len(offs))), f"Indexing… {len(keys):,} headwords")
    if not keys:
        return None
    pl = _info(bundle)
    declared, primary = _declared_langs(pl)
    # Per group: which language its HEADWORDS are in, and whether its definitions read as English.
    # The id's own direction suffix (`-sa-en`) is taken as authoritative where it is present, since
    # it is the publisher's own statement; everything else is measured off the entries.
    groups = {}
    for g, hs in heads.items():
        body_text = " ".join(bodies.get(g, []))[:12000]
        m = _DIR_RE.search(g)
        src = m.group(1) if m else ""
        dst = m.group(2) if m else ""
        head_lang = src or _detect(hs)
        if not head_lang and declared and len(declared) == 1:
            head_lang = next(iter(declared))
        # ⚠ WHERE THE ID STATES A DIRECTION, IT DECIDES — the prose test is not consulted, and must
        # not be. A dictionary's metalanguage is not its description language: the English half of
        # `French - English` defines in French but its entries are thick with English (the headword,
        # the part-of-speech labels, the example sentences it is translating), and the stopword test
        # duly called it English. Read `-en-fr` as "English in, French out" and the question does not
        # arise. The test is for the halves whose ids say nothing — Chinese's `z_b-zh`, the `*_DWS`
        # usage notes, a hand-installed bundle with no scheme at all.
        en = (dst == "en") if dst else _looks_english(body_text)
        groups[g] = {"head": head_lang, "en": en, "n": counts.get(g, 0)}
    return {
        "format": _INDEX_FORMAT, "bundle": bundle, "body": body,
        "mtime": os.path.getmtime(body), "size": os.path.getsize(body),
        "name": pl.get("CFBundleName") or os.path.basename(bundle)[:-11],
        "id": pl.get("CFBundleIdentifier") or "",
        "declared": sorted(declared), "primary": primary,
        "groups": groups,
        "keys": keys,
    }


def index(bundle: str, progress=None):
    """The index for one bundle, from cache when it is current."""
    got = _CACHE.get(bundle, ...)
    if got is not ...:
        return got
    p = _index_path(bundle)
    body = _body_path(bundle)
    idx = None
    if os.path.isfile(p) and body:
        try:
            with gzip.open(p, "rt", encoding="utf-8") as fh:
                cached = json.load(fh)
            if (int(cached.get("format") or 0) == _INDEX_FORMAT
                    and cached.get("size") == os.path.getsize(body)
                    and abs((cached.get("mtime") or 0) - os.path.getmtime(body)) < 1):
                idx = cached
        except Exception:  # noqa: BLE001
            idx = None
    if idx is None:
        idx = build_index(bundle, progress)
        if idx is not None:
            try:
                os.makedirs(_INDEX_DIR, exist_ok=True)
                tmp = p + ".part"
                with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
                    json.dump(idx, fh, ensure_ascii=False, separators=(",", ":"))
                os.replace(tmp, p)
            except Exception:  # noqa: BLE001
                pass          # an unwritable cache costs a rebuild, never the feature
    _CACHE[bundle] = idx
    return idx


# ── which dictionary answers which language ─────────────────────────────────────────────────────
def _english_groups(idx: dict, lang: str) -> set:
    """The id-prefix groups of this dictionary that index ``lang`` and define in English.

    Per GROUP, not per bundle, because a bilingual holds both directions in one file and only one
    of them is the one wanted: measured on one bilingual, 24,392 entries sat under an `…-xx-en` id
    (native headwords, English glosses) and 20,505 under the reverse, and answering a token out of
    the second would hand back prose in the very language being looked up."""
    want = _base(lang)
    if not want:
        return set()
    out = {g for g, v in (idx.get("groups") or {}).items()
           if v.get("en") and _base(v.get("head") or "") == want}
    if out:
        return out
    # A bundle that declares exactly one index language and no direction in its ids is taken at its
    # word, provided its entries read as English.
    declared = set(idx.get("declared") or [])
    if len(declared) == 1 and want in declared:
        return {g for g, v in (idx.get("groups") or {}).items() if v.get("en")}
    # …and one the USER has assigned a language to is taken at THEIRS, which is the only evidence
    # there is for a hand-installed dictionary (see `_OVERRIDES`). Still gated on the entries reading
    # as English: assigning a headword language does not make the definitions English.
    if _OVERRIDES.get(idx.get("id") or "") == want or _OVERRIDES.get(idx.get("name") or "") == want:
        return {g for g, v in (idx.get("groups") or {}).items() if v.get("en")}
    return set()


def _serves(idx: dict, lang: str) -> bool:
    return bool(_english_groups(idx, lang))


def dictionaries(lang: str = "", progress=None) -> list[dict]:
    """Every readable dictionary, with what it indexes and what it can define in English.

    ``lang`` marks the ones that would answer for that language and sorts them to the front;
    passing none just lists them. Indexing every bundle the first time costs a few seconds in
    total — after that it is read from the cache."""
    out = []
    for b in _bundles():
        idx = index(b, progress)
        if not idx:
            continue
        groups = idx.get("groups") or {}
        indexes = sorted({v["head"] for v in groups.values() if v.get("head")}
                         | set(idx.get("declared") or []))
        out.append({"name": idx["name"], "id": idx["id"], "bundle": b,
                    "entries": len(idx["keys"]), "indexes": indexes,
                    "english": sorted({v["head"] for v in groups.values()
                                       if v.get("en") and v.get("head")}),
                    "definesEnglish": any(v.get("en") for v in groups.values()),
                    "assigned": _OVERRIDES.get(idx.get("id") or "")
                                or _OVERRIDES.get(idx.get("name") or "") or "",
                    "needsLanguage": not indexes,
                    "serves": _serves(idx, lang) if lang else False})
    out.sort(key=lambda d: (not d["serves"], d["name"]))
    return out


def for_language(lang: str) -> list[str]:
    """The bundles that can answer ``lang`` in English, best first.

    Ordered by entry count, largest first: with several installed for one language the fuller one is
    the better first answer, and the flyout shows one source at a time."""
    got = []
    for b in _bundles():
        idx = index(b)
        gs = _english_groups(idx or {}, lang)
        if not gs:
            continue
        # Ranked by the size of the QUALIFYING HALVES, not of the whole bundle. A bilingual can be
        # much the larger file while contributing almost nothing for a given language — measured on
        # one shelf, a 161,847-entry X-English bundle offered an English document only its ~2,000
        # English usage notes, and ranking on file size put it ahead of the 112,412-entry monolingual
        # that actually defines English. Half sizes rank them the way their usefulness does.
        n = sum(((idx or {}).get("groups", {}).get(g) or {}).get("n", 0) for g in gs)
        got.append((n, b))
    return [b for _n, b in sorted(got, reverse=True)]


# ── lookup ──────────────────────────────────────────────────────────────────────────────────────
def entry_for(bundle: str, word: str, groups=None) -> str:
    """The raw entry XML for ``word``, or "". One chunk is decompressed, not the whole body.

    ``groups`` restricts the answer to particular halves of a bilingual (see `_english_groups`); the
    headword may well exist in the other one, and answering out of it would return prose in the very
    language the caller is trying to have explained."""
    idx = index(bundle)
    if not idx:
        return ""
    hit = idx["keys"].get(_fold(word))
    if not hit:
        return ""
    if groups is not None and len(hit) > 2 and hit[2] not in groups:
        return ""
    off, pos = int(hit[0]), int(hit[1])
    try:
        full = open(idx["body"], "rb").read()
    except OSError:
        return ""
    for p, entry in _chunk_entries(full, off):
        if p == pos:
            return entry
    return ""


def _query_forms(word: str, lang: str):
    """The spellings to try, in order — the token's own first, then the script the DICTIONARY files
    its headwords under.

    The same problem `app/wiktionary.py` already solves for its own lookups, and by the same rule:
    a headword is filed in the script its publisher chose and the document stores whichever script it
    was parsed in. The two scripts this app can store a language in and a dictionary is likely to
    disagree about are Sanskrit's (Devanagari vs IAST) and Han (Traditional vs Simplified), which is
    what the list below covers. Cheap, because a variant is only computed once the plain form has
    already missed."""
    yield word
    base = _base(lang)
    if base not in ("sa", "zh", "lzh", "yue"):
        return
    try:
        from . import translit
        alt = translit.orthography(word, lang, "Devanagari" if base == "sa" else "traditional")
        if isinstance(alt, str) and alt and alt != word:
            yield alt
    except Exception:  # noqa: BLE001
        return


def lookup(word: str, lang: str = "") -> dict:
    """``{"entry", "text", "source", "headword"}`` for the first dictionary that has ``word``.

    ``entry`` is the raw XML (the caller may want its structure), ``text`` the visible prose. Empty
    ``source`` means nothing answered — the caller falls through to its other sources, which is why
    this never raises and never guesses."""
    word = (word or "").strip()
    if not word or not available():
        return {"entry": "", "text": "", "source": "", "headword": ""}
    forms = list(_query_forms(word, lang))
    for b in for_language(lang):
        groups = _english_groups(index(b) or {}, lang)
        for f in forms:
            e = entry_for(b, f, groups)
            if e:
                idx = index(b)
                return {"entry": e, "text": plain_text(e),
                        "source": (idx or {}).get("name", ""), "headword": _headword(e)}
    return {"entry": "", "text": "", "source": "", "headword": ""}


# ── the shape the flyout reads ──────────────────────────────────────────────────────────────────
# `d:def="1"` marks a sense in Apple's own markup, and `DCSElementXPath.definitions` in a bundle's
# Info.plist names the same thing as an XPath. Splitting on those spans is what separates senses;
# where a dictionary marks none, the visible prose is offered whole rather than guessed at.
_DEF_RE = re.compile(r'<span[^>]*\bd:def="1"[^>]*>(.*?)</span>', re.S)
_SENSE_NUM_RE = re.compile(r"^\s*[0-9①-⑳]+\s*")


def senses(entry: str) -> list[str]:
    """An entry's senses, longest-marked-up first. Empty when it marks none."""
    out = []
    for raw in _DEF_RE.findall(entry or ""):
        t = _WS_RE.sub(" ", _unescape(_TAG_RE.sub(" ", raw))).strip(" ;,.")
        t = _SENSE_NUM_RE.sub("", t).strip()
        if t and t not in out:
            out.append(t)
    return out


def as_senses(got: dict, word: str, upos: str = "") -> dict:
    """A `lookup` result in the shape `app/wiktionary.py` and `app/apte.py` return.

    One shape for three sources, so the flyout keeps reading `definitions`/`page_url`/`error` and
    only the `source` label changes. `page_url` is None on purpose: there is no page to open — the
    dictionary is a local file, and an "Open on …" row that went nowhere would be worse than none."""
    ss = senses(got.get("entry") or "")
    if not ss:
        text = got.get("text") or ""
        head = got.get("headword") or word
        if text.startswith(head):
            text = text[len(head):].strip(" |,;")
        ss = [text] if text else []
    return {"definitions": [{"text": t} for t in ss[:24]],
            "page_url": None, "error": None,
            "source": got.get("source") or "Dictionary", "page_label": ""}
