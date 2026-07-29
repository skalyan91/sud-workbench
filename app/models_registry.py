"""Registry for parser models: what's available to download, what's installed.

Two engines:

* **SUD spaCy** — wheels published as GitHub Release assets on
  :data:`SUD_REPO` (default ``SunflowerAI/sud-spacy-parsers``), named
  ``<lang>_sud_<treebank>-<version>-py3-none-any.whl``.  Downloading fetches the
  wheel and ``pip install``\\ s it into the running venv.
* **Stanza UD** — downloaded with ``stanza.download`` into
  :data:`app.paths.STANZA_DIR` from a curated language list.

Every function returns plain dicts/lists (JSON-friendly for the bridge) and avoids
raising across the boundary where practical.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request

from .paths import CACHE_DIR, EXTRAS_DIR, STANZA_DIR, ensure_dirs

SUD_REPO = os.environ.get("SUD_MODELS_REPO", "SunflowerAI/sud-spacy-parsers")
GITHUB_API = f"https://api.github.com/repos/{SUD_REPO}/releases"
# The models that ship WITH the app rather than being downloaded through the Model Manager: they are
# pinned in requirements-core.txt, so both shipping bundles already carry them (see that file for why
# English is there — app/wiktionary.py parses English definition prose whatever the document's own
# language). They still LIST as installed, since they are; they just can't be REMOVED here. Removing
# one is re-downloadable, but it isn't a user model choice to make: it silently disables the
# Wiktionary → MGloss lookup for every language, and nothing in that feature's UI would connect the
# two, so it reads as the definition lookup having quietly broken.
BUNDLED_SUD = {"en_sud_ewt"}
# Per-model UAS/LAS accuracy: SUD scores live in the repo README's scores table; Stanza (UD) scores
# come from the official performance page.  Both are fetched + cached (TTL) and re-fetched on refresh.
SUD_README_URL = f"https://raw.githubusercontent.com/{SUD_REPO}/main/README.md"
STANZA_PERF_URL = "https://stanfordnlp.github.io/stanza/performance.html"
# Training-set SIZE: every model here is trained on the train split of one or more UD/SUD treebanks
# (SUD is a conversion of UD, so the two share their sentence segmentation and split sizes).  The UD
# home page carries one accordion entry per treebank — its repo name, its ``<lcode>_<treebank>`` hub
# code and a size hint — which gives the code → repo map in ONE fetch; the exact TRAIN-split sentence
# count then comes from that repo's ``stats.xml``.  Both are cached for a month: treebank sizes only
# change at a UD release.
UD_HOME_URL = "https://universaldependencies.org/"
UD_STATS_URL = "https://raw.githubusercontent.com/UniversalDependencies/{repo}/master/stats.xml"
_CACHE_TTL = 3600  # seconds
_UD_TTL = 30 * 24 * 3600  # treebank sizes are release-stable — refetch monthly, or on Refresh
_TRAIN_CACHE = "ud_train_sentences.json"   # {"<lcode>_<treebank>": train-split sentences}
_NUM_RE = re.compile(r"^\d+(?:\.\d+)?$")

_ASSET_RE = re.compile(
    r"^(?P<lang>[a-z]{2,3})_sud_(?P<treebank>[a-z0-9_]+)-"
    r"(?P<version>[0-9][^-]*)-py3-none-any\.whl$")

# language code → the app's CANONICAL language name (matches the frontend language
# menus / LANGNAMES in web/index.html — e.g. "Literary Chinese", not "Classical Chinese").
LANG_NAMES = {
    "ar": "Arabic", "de": "German", "en": "English", "es": "Spanish",
    "fa": "Persian", "fr": "French", "id": "Indonesian", "it": "Italian",
    "ja": "Japanese", "ko": "Korean", "la": "Latin", "lzh": "Literary Chinese",
    "nl": "Dutch", "pt": "Portuguese", "ru": "Russian", "sa": "Sanskrit",
    "yue": "Cantonese", "zh": "Chinese",
    # every other language Stanza ships a dependency model for (performance table),
    # so the Manage Models list reads with real names rather than bare ISO codes.
    "af": "Afrikaans", "be": "Belarusian", "bg": "Bulgarian", "bxr": "Buryat",
    "ca": "Catalan", "cop": "Coptic", "cs": "Czech", "cu": "Old Church Slavonic",
    "cy": "Welsh", "da": "Danish", "el": "Greek", "et": "Estonian", "eu": "Basque",
    "fi": "Finnish", "fo": "Faroese", "fro": "Old French", "ga": "Irish",
    "gd": "Scottish Gaelic", "gl": "Galician", "got": "Gothic", "grc": "Ancient Greek",
    "gv": "Manx", "hbo": "Ancient Hebrew", "he": "Hebrew", "hi": "Hindi",
    "hr": "Croatian", "hsb": "Upper Sorbian", "hu": "Hungarian", "hy": "Armenian",
    "hyw": "Western Armenian", "is": "Icelandic", "kk": "Kazakh", "kmr": "Kurmanji",
    "ky": "Kyrgyz", "lij": "Ligurian", "lt": "Lithuanian", "lv": "Latvian",
    "mr": "Marathi", "mt": "Maltese", "myv": "Erzya", "nb": "Norwegian Bokmål",
    "nn": "Norwegian Nynorsk", "orv": "Old East Slavic", "pcm": "Naija", "pl": "Polish",
    "qaf": "Maghrebi Arabic", "qpm": "Pomak", "qtd": "Turkish–German", "ro": "Romanian", "sk": "Slovak",
    "sl": "Slovenian", "sme": "North Sami", "sr": "Serbian", "sv": "Swedish",
    "ta": "Tamil", "te": "Telugu", "tr": "Turkish", "ug": "Uyghur", "uk": "Ukrainian",
    "ur": "Urdu", "vi": "Vietnamese", "wo": "Wolof",
}

# Stanza download code → the app's canonical language code, so a Stanza-specific code
# (Simplified/Traditional Chinese, Classical Chinese) is NAME-NORMALISED to the menus.
STANZA_LANG_CODE = {"zh-hans": "zh", "zh-hant": "zh", "lzh": "lzh"}

# Curated Stanza UD models, PER TREEBANK — a SUPPLEMENT to the performance table (which is
# the complete, authoritative list, merged in by _stanza_models).  This dict adds the
# Stanza-merged "combined" convenience packages (the table carries no score row for them)
# and serves as the offline fallback when the table can't be fetched.  Each (code, treebank)
# is an installable entry (id ``stanza:<code>#<treebank>``); the code is Stanza's own (used
# verbatim for stanza.download / the parser package); the displayed language name is
# normalised through STANZA_LANG_CODE + LANG_NAMES.
STANZA_TREEBANKS: dict[str, list[str]] = {
    "ar": ["padt"],
    "de": ["combined", "gsd", "hdt"],
    "en": ["combined", "ewt", "gum", "partut", "lines", "atis", "craft", "genia", "mimic", "eslspok"],
    "es": ["combined", "ancora", "gsd"],
    "fa": ["perdt", "seraji"],
    "fr": ["combined", "gsd", "partut", "sequoia", "parisstories", "rhapsodie"],
    "id": ["gsd", "csui"],
    "it": ["combined", "isdt", "partut", "vit", "postwita", "twittiro", "markit", "parlamint"],
    "ja": ["combined", "gsd", "gsdluw"],
    "ko": ["kaist", "gsd", "ksl"],
    "la": ["ittb", "proiel", "perseus", "llct", "udante"],
    "lzh": ["kyoto"],
    "nl": ["alpino", "lassysmall"],
    "pt": ["bosque", "gsd", "porttinari", "petrogold", "cintil", "dantestocks"],
    "ru": ["syntagrus", "gsd", "taiga", "poetry"],
    "sa": ["vedic"],
    "zh-hans": ["gsdsimp"],
    "zh-hant": ["gsd"],
}


def _lang_name(lang: str) -> str:
    return LANG_NAMES.get(lang, lang)


def _stanza_lang_name(code: str) -> str:
    """Canonical (menu) language name for a Stanza code, name-normalised."""
    return _lang_name(STANZA_LANG_CODE.get(code, code))


def _stanza_label(code: str, treebank: str) -> str:
    """Display label for a Stanza (language, treebank) model, e.g. ``English · UD · EWT`` —
    the same "Language · <scheme> · Treebank" shape the SUD rows use."""
    return f"{_stanza_lang_name(code)} · UD · {treebank.upper()}"


def parse_asset(name: str) -> dict | None:
    """Parse a release asset filename into registry fields, or None if it doesn't match."""
    m = _ASSET_RE.match(name)
    if not m:
        return None
    lang, treebank, version = m["lang"], m["treebank"], m["version"]
    package = f"{lang}_sud_{treebank}"
    return {
        "id": f"sud:{package}", "engine": "sud", "lang": lang, "treebank": treebank,
        "package": package, "version": version, "filename": name,
        "label": f"{_lang_name(lang)} · SUD · {treebank.upper()}",
    }


# ── available ────────────────────────────────────────────────────────────────
def _fetch_releases(refresh: bool = False) -> list[dict]:
    ensure_dirs()
    cache = os.path.join(CACHE_DIR, "releases.json")
    if not refresh and os.path.exists(cache) and (time.time() - os.path.getmtime(cache)) < _CACHE_TTL:
        try:
            with open(cache, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:  # noqa: BLE001
            pass
    try:
        req = urllib.request.Request(GITHUB_API, headers={"User-Agent": "SUD-Workbench",
                                                          "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
        with open(cache, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        return data
    except Exception:  # noqa: BLE001 — offline: fall back to any cached copy
        if os.path.exists(cache):
            try:
                with open(cache, encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:  # noqa: BLE001
                return []
        return []


def _fetch_text(url: str, cache_name: str, refresh: bool, ttl: float | None = None) -> str:
    """Fetch a text resource with a TTL disk cache; offline ⇒ cached copy; failure ⇒ ""."""
    ensure_dirs()
    ttl = _CACHE_TTL if ttl is None else ttl
    cache = os.path.join(CACHE_DIR, cache_name)
    if not refresh and os.path.exists(cache) and (time.time() - os.path.getmtime(cache)) < ttl:
        try:
            with open(cache, encoding="utf-8") as fh:
                return fh.read()
        except Exception:  # noqa: BLE001
            pass
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            txt = resp.read().decode("utf-8", "replace")
        with open(cache, "w", encoding="utf-8") as fh:
            fh.write(txt)
        return txt
    except Exception:  # noqa: BLE001 — offline: any cached copy
        if os.path.exists(cache):
            try:
                with open(cache, encoding="utf-8") as fh:
                    return fh.read()
            except Exception:  # noqa: BLE001
                return ""
        return ""


def sud_scores(refresh: bool = False) -> dict[str, dict]:
    """``package → {"uas":float,"las":float}`` parsed from the SUD README scores table
    (``| `pkg` | Lang | UAS | LAS | … |``).  Empty on failure."""
    out: dict[str, dict] = {}
    for line in _fetch_text(SUD_README_URL, "sud_readme.md", refresh).splitlines():
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        pkg = cells[0].strip("` ").strip()
        if "_sud_" not in pkg:
            continue
        uas, las = cells[2], cells[3]
        if _NUM_RE.match(uas) and _NUM_RE.match(las):
            out[pkg] = {"uas": float(uas), "las": float(las)}
    return out


def stanza_scores(refresh: bool = False) -> dict[tuple, dict]:
    """``(lcode, treebank_lower) → {"uas","las"}`` from the Stanza performance page.  The table
    uses unclosed HTML5 ``<td>``/``<tr>``; per data row cell[1]=Treebank, cell[2]=lcode,
    cell[12]=UAS, cell[13]=LAS.  Empty on failure."""
    html = _fetch_text(STANZA_PERF_URL, "stanza_perf.html", refresh)
    ts = html.find("<table")
    te = html.find("</table>", ts) if ts >= 0 else -1
    if ts < 0 or te < 0:
        return {}

    def _txt(cell: str) -> str:                       # strip the <td …> attributes + any inner tags
        cell = cell.split(">", 1)[-1] if ">" in cell else cell
        return re.sub(r"<[^>]+>", "", cell).replace("​", "").replace("\xa0", "").strip()

    out: dict[tuple, dict] = {}
    for row in html[ts:te].split("<tr")[1:]:
        cells = [_txt(c) for c in row.split("<td")[1:]]
        if len(cells) < 14:
            continue
        tb, lcode, uas, las = cells[1], cells[2], cells[12], cells[13]
        if not lcode or not _NUM_RE.match(uas) or not _NUM_RE.match(las):
            continue
        out[(lcode.lower(), tb.lower())] = {"uas": float(uas), "las": float(las)}
    return out


# ── training-set size ────────────────────────────────────────────────────────
# Stanza's own language code → the code UD files the treebank under (Norwegian is ONE UD language
# with a Bokmaal and a Nynorsk treebank, where Stanza treats each as its own language).  Layered on
# top of STANZA_LANG_CODE, which already normalises the two Chinese scripts.
STANZA_UD_LANG = dict(STANZA_LANG_CODE, nb="no", nn="no")
# SUD_Cantonese-HK ships a TEST split only, so no train count exists to read: the model is trained on
# a deterministic 80/10/10 carve of it, which the SUD README states as 804 training sentences.
SUD_TRAIN_OVERRIDE = {"yue_sud_hk": 804}
_UD_ENTRY_CODE_RE = re.compile(r"treebanks/([a-z0-9_]+)/index\.html")
_UD_ENTRY_REPO_RE = re.compile(r"(UD_[A-Za-z_]+-[A-Za-z0-9]+)/tree/")
_UD_TRAIN_RE = re.compile(r"<train>.*?<sentences>\s*(\d+)\s*</sentences>", re.S)
_SUD_TB_RE = re.compile(r"SUD_([A-Za-z_]+)-([A-Za-z0-9]+)")


def ud_treebanks(refresh: bool = False) -> dict[str, str]:
    """``<lcode>_<treebank>`` → GitHub repo name (``UD_English-EWT``) for every UD treebank.

    Parsed from the UD home page, whose per-treebank accordion entries are delimited by
    ``<!-- start of … entry -->`` comments and carry both the hub-page code and the repo link.
    Empty on failure (offline with no cached copy)."""
    html = _fetch_text(UD_HOME_URL, "ud_home.html", refresh, _UD_TTL)
    out: dict[str, str] = {}
    for block in html.split("<!-- start of ")[1:]:
        code = _UD_ENTRY_CODE_RE.search(block)
        repo = _UD_ENTRY_REPO_RE.search(block)
        if code and repo:
            out.setdefault(code.group(1), repo.group(1))
    return out


def _ud_repo_index(refresh: bool = False) -> dict[tuple, str]:
    """``(language_name_lower, treebank_lower)`` → ``<lcode>_<treebank>``, so a treebank named the
    SUD way (``SUD_Classical_Chinese-Kyoto``) resolves to its UD code (``lzh_kyoto``)."""
    idx: dict[tuple, str] = {}
    for code, repo in ud_treebanks(refresh).items():
        lang, _, tb = repo[3:].partition("-")   # strip the "UD_" prefix
        if tb:
            idx[(lang.lower(), tb.lower())] = code
    return idx


def _train_cache_load() -> dict[str, int]:
    path = os.path.join(CACHE_DIR, _TRAIN_CACHE)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return {k: int(v) for k, v in data.items() if isinstance(v, int)}
    except Exception:  # noqa: BLE001 — no cache yet / unreadable: start empty
        return {}


def _train_cache_save(counts: dict[str, int]) -> None:
    ensure_dirs()
    try:
        with open(os.path.join(CACHE_DIR, _TRAIN_CACHE), "w", encoding="utf-8") as fh:
            json.dump(counts, fh)
    except Exception:  # noqa: BLE001 — a cache write failure must never break the listing
        pass


def _fetch_train_count(repo: str) -> int | None:
    """Train-split sentence count from a UD treebank repo's ``stats.xml``; None if unreachable.
    A treebank with no train split (test-only, e.g. UD_Cantonese-HK) legitimately reports 0."""
    try:
        req = urllib.request.Request(UD_STATS_URL.format(repo=repo),
                                     headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            head = resp.read(8192).decode("utf-8", "replace")   # <size> is the first element
    except Exception:  # noqa: BLE001 — offline / renamed repo: leave it unknown
        return None
    m = _UD_TRAIN_RE.search(head)
    return int(m.group(1)) if m else None


def ud_train_sentences(codes, refresh: bool = False, fetch: bool = True) -> dict[str, int]:
    """``<lcode>_<treebank>`` → train-split sentences, for the requested codes.

    Served from the on-disk cache; with ``fetch`` the missing ones are pulled from their repos'
    ``stats.xml`` in parallel and folded back into the cache.  ``fetch=False`` is the fast,
    network-free path used while building a model listing."""
    counts = {} if refresh else _train_cache_load()
    want = [c for c in dict.fromkeys(codes) if c and c not in counts]
    if not want or not fetch:
        return {c: counts[c] for c in codes if c in counts}
    repos = ud_treebanks(refresh)
    todo = [(c, repos[c]) for c in want if c in repos]
    if todo:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            for (code, _), n in zip(todo, pool.map(lambda cr: _fetch_train_count(cr[1]), todo)):
                if n is not None:
                    counts[code] = n
        _train_cache_save(counts)
    return {c: counts[c] for c in codes if c in counts}


def sud_treebanks(refresh: bool = False) -> dict[str, list[tuple]]:
    """``package`` → the ``(language_name_lower, treebank_lower)`` pairs it is trained on, read from
    the SUD README's "Available models" table (its Treebank column, e.g. ``SUD_Latin-ITTB+PROIEL+
    Perseus`` or ``SUD_Chinese-GSD + GSDSimp``).  Parenthesised notes are dropped, so the Classical
    Chinese model's "(+ simplified)" — the same treebank transliterated into the other script, not
    extra sentences — counts Kyoto once."""
    out: dict[str, list[tuple]] = {}
    for line in _fetch_text(SUD_README_URL, "sud_readme.md", refresh).splitlines():
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        pkg = cells[0].strip("` ").strip()
        if "_sud_" not in pkg:
            continue
        spec = re.sub(r"\([^)]*\)", " ", cells[2])
        m = _SUD_TB_RE.search(spec)
        if not m:                                   # e.g. the scores table, whose 3rd cell is a number
            continue
        lang, first = m.group(1).lower(), m.group(2).lower()
        tbs = [first] + [t.lower() for t in re.findall(r"\+\s*([A-Za-z0-9]+)", spec[m.end(2):])]
        out[pkg] = [(lang, t) for t in tbs]
    return out


def _entry_treebank_codes(entry: dict, sud_map: dict, ud_idx: dict) -> list[str]:
    """The UD treebank codes a model entry is trained on ([] when they can't be resolved — a Stanza
    "combined" package merges an undocumented set of treebanks, so it gets no count)."""
    if entry.get("engine") == "sud":
        pairs = sud_map.get(entry.get("package") or "", [])
        return [ud_idx[p] for p in pairs if p in ud_idx]
    tb = (entry.get("treebank") or "").lower()
    lang = (entry.get("lang") or "").lower()
    if not tb or not lang or tb == "combined":
        return []
    return [f"{STANZA_UD_LANG.get(lang, lang)}_{tb}"]


def annotate_train_sentences(entries: list[dict], refresh: bool = False, fetch: bool = True) -> None:
    """Set ``train_sents`` (sentences the model was trained on) on each entry that resolves to one
    or more UD treebanks — the SUM of their train splits for the multi-treebank models.  Entries
    whose count isn't known yet are left untouched, so a caller can fill them in on a later pass."""
    try:
        sud_map = sud_treebanks(refresh)
        ud_idx = _ud_repo_index(refresh)
    except Exception:  # noqa: BLE001 — never break a listing over a missing size
        return
    per_entry = [_entry_treebank_codes(e, sud_map, ud_idx) for e in entries]
    try:
        counts = ud_train_sentences([c for codes in per_entry for c in codes], refresh, fetch)
    except Exception:  # noqa: BLE001
        counts = {}
    for entry, codes in zip(entries, per_entry):
        override = SUD_TRAIN_OVERRIDE.get(entry.get("package") or "")
        if override is not None:
            entry["train_sents"] = override
        elif codes and all(c in counts for c in codes):
            total = sum(counts[c] for c in codes)
            if total > 0:                            # a test-only treebank reports 0 — nothing to report
                entry["train_sents"] = total


def list_available(refresh: bool = False) -> list[dict]:
    """SUD models from GitHub Releases (highest version per package) + curated Stanza langs,
    each annotated with its UAS/LAS accuracy (re-fetched when ``refresh``)."""
    sud_sc = sud_scores(refresh)
    stz_sc = stanza_scores(refresh)
    by_pkg: dict[str, dict] = {}
    for rel in _fetch_releases(refresh):
        for asset in rel.get("assets", []):
            entry = parse_asset(asset.get("name", ""))
            if not entry:
                continue
            entry["asset_url"] = asset.get("browser_download_url")
            entry["size"] = asset.get("size")
            prev = by_pkg.get(entry["package"])
            if prev is None or entry["version"] > prev["version"]:
                by_pkg[entry["package"]] = entry
    for e in by_pkg.values():                                    # SUD accuracy, keyed by package
        sc = sud_sc.get(e["package"])
        if sc:
            e["uas"], e["las"] = sc["uas"], sc["las"]
    out = sorted(by_pkg.values(), key=lambda e: e["label"])
    stanza = _stanza_models(stz_sc)   # the perf-table scores double as the COMPLETE model list (item 11)
    for e in stanza:                                             # Stanza accuracy, keyed by (lcode, treebank)
        sc = stz_sc.get(((e.get("lang") or "").lower(), (e.get("treebank") or "").lower()))
        if sc:
            e["uas"], e["las"] = sc["uas"], sc["las"]
    out.extend(stanza)
    # Training-set size from whatever the treebank-size cache already holds — network-free, so the
    # listing stays fast; the Model Manager's background sweep (api.model_train_sizes) fills in the
    # rest and patches the rows in place.
    annotate_train_sentences(out, refresh, fetch=False)
    return out


def _stanza_version() -> str | None:
    """Stanza's default resources version (offline-safe; None if stanza can't be imported)."""
    try:
        from stanza.resources.common import DEFAULT_RESOURCES_VERSION
        return DEFAULT_RESOURCES_VERSION
    except Exception:  # noqa: BLE001
        return None


def _stanza_models(scores: dict | None = None) -> list[dict]:
    """One entry per (language, treebank) Stanza UD dependency model, name-normalised to the
    app's menus.  The set is the UNION of every model in the Stanza performance table
    (``scores`` keyed by ``(lcode, treebank)``) and the curated :data:`STANZA_TREEBANKS`.
    The table is the authoritative, COMPLETE list — all ~80 languages incl. Tamil/Telugu —
    while the curated dict adds the "combined" convenience packages the table has no score row
    for, and guarantees a sensible offline fallback when the table can't be fetched.
    Stanza's index carries no per-model download size, so ``size`` is None."""
    ver = _stanza_version()
    tbs: dict[str, set[str]] = {}
    for code, treebanks in STANZA_TREEBANKS.items():        # curated ("combined" packages + offline fallback)
        tbs.setdefault(code, set()).update(treebanks)
    for (code, tb) in (scores or {}):                       # every dependency model published in the perf table
        tbs.setdefault(code, set()).add(tb)
    out = []
    for code, treebanks in tbs.items():
        for tb in treebanks:
            out.append({"id": f"stanza:{code}#{tb}", "engine": "stanza", "lang": code,
                        "treebank": tb, "package": None, "version": ver, "asset_url": None,
                        "size": None, "label": _stanza_label(code, tb)})
    out.sort(key=lambda e: e["label"])
    return out


# ── installed ────────────────────────────────────────────────────────────────
def _installed_sud_packages() -> set[str]:
    # Scan via importlib.metadata (re-reads sys.path each call) rather than spaCy's
    # get_installed_models(), whose registry is cached at import — so a model just
    # pip-installed into this process would otherwise stay invisible until restart.
    import importlib
    import importlib.metadata as md
    importlib.invalidate_caches()
    out: set[str] = set()
    for dist in md.distributions():
        name = (dist.metadata["Name"] or "").replace("-", "_")
        if "_sud_" in name:
            out.add(name)
    return out


def _installed_stanza_models() -> set[tuple[str, str]]:
    """Installed Stanza models as (language-code, treebank) pairs, read from the depparse
    model files (``<treebank>_<variant>.pt``) under each language directory."""
    out: set[tuple[str, str]] = set()
    if not os.path.isdir(STANZA_DIR):
        return out
    for lang in os.listdir(STANZA_DIR):
        ddir = os.path.join(STANZA_DIR, lang, "depparse")
        if not os.path.isdir(ddir):
            continue
        for fn in os.listdir(ddir):
            if fn.endswith(".pt"):
                out.add((lang, fn[:-3].rsplit("_", 1)[0]))   # strip .pt + the _<variant> suffix
    return out


def list_installed() -> list[dict]:
    out = []
    for pkg in sorted(_installed_sud_packages()):
        entry = parse_asset(pkg + "-0-py3-none-any.whl") or {"id": f"sud:{pkg}", "package": pkg}
        try:
            from importlib.metadata import version
            entry["version"] = version(pkg)
        except Exception:  # noqa: BLE001
            pass
        entry.update(engine="sud", installed=True)
        if pkg in BUNDLED_SUD:
            entry["bundled"] = True   # the Model Manager shows a "Bundled" pill in place of the Remove button
        out.append(entry)
    for lang, tb in sorted(_installed_stanza_models()):
        out.append({"id": f"stanza:{lang}#{tb}", "engine": "stanza", "lang": lang, "treebank": tb,
                    "label": _stanza_label(lang, tb), "installed": True})
    return out


def resolve_default_package(lang: str) -> str | None:
    """Best-effort: an installed ``<lang>_sud_*`` package for a bare language code."""
    for pkg in sorted(_installed_sud_packages()):
        if pkg.startswith(f"{lang}_sud_"):
            return pkg
    return None


# ── download / remove ────────────────────────────────────────────────────────
def _asset_url(model_id: str) -> tuple[str, str] | None:
    for e in list_available():
        if e["id"] == model_id and e.get("asset_url"):
            return e["asset_url"], e["filename"]
    return None


def _parse_install_steps(msg: str) -> list[list[str]]:
    """Extract runnable install steps from a model tokeniser's ImportError message.

    Two shapes occur across SUD models:

    * commands listed one per (indented) line, e.g. CAMeL Tools::

          ... Install with:
            pip install camel-tools
            camel_data -i morphology-db-msa-r13 disambig-mle-calima-msa-r13

    * a ``pip install`` embedded inline in a sentence / backticks, e.g. spaCy's::

          spacy-pkuseg not installed. … install spacy-pkuseg with `pip install "spacy-pkuseg>=0.0.27,<0.1.0"` …

    So we first pull every inline ``pip install <spec>`` via regex, then take any remaining
    indented non-pip lines as data-fetch commands (e.g. ``camel_data``)."""
    steps: list[list[str]] = []
    seen: set[tuple] = set()

    def _add(toks: list[str]):
        key = tuple(toks)
        if key not in seen:
            seen.add(key)
            steps.append(toks)

    for spec in re.findall(r"pip[23]?\s+install\s+([^`\n)]+)", msg):
        try:
            toks = shlex.split(spec.strip())
        except ValueError:
            continue
        pkgs: list[str] = []
        for t in toks:   # stop at an alternative ("… or conda install …")
            if t.lower() in ("or", "and", "||", "&&"):
                break
            pkgs.append(t)
        if pkgs:
            _add([sys.executable, "-m", "pip", "install", "--no-input", *pkgs])

    for line in msg.splitlines():
        if not line[:1].isspace():   # only indented command lines (not prose)
            continue
        s = line.strip()
        if not s or s.endswith(":") or s.lower().startswith(("pip ", "pip3 ", "python ", "python3 ")):
            continue   # pip lines already handled above
        try:
            toks = shlex.split(s)
        except ValueError:
            continue
        if toks:
            _add(toks)   # data-fetch console script (e.g. camel_data); validated before running
    return steps


def _ensure_tokenizer_deps(package: str, progress=None) -> dict:
    """After a SUD model is installed, make sure its raw-text tokeniser dependency is
    present by probing the model and running whatever install steps its ImportError
    declares (pip installs into this venv + any data-fetch console script it provides)."""
    import importlib
    venv_bin = os.path.dirname(sys.executable)
    env = dict(os.environ)
    env["PATH"] = venv_bin + os.pathsep + env.get("PATH", "")
    pip_specs: list[str] = []   # specs installed so far (to rebuild from source on a numpy ABI mismatch)
    rebuilt = False
    for _ in range(4):
        try:
            importlib.invalidate_caches()
            import spacy
            spacy.load(package)("probe")   # trigger the tokeniser
            return {"ok": True}
        except ImportError as exc:
            steps = _parse_install_steps(str(exc))
            if not steps:
                return {"ok": False, "error": str(exc)}
            for step in steps:
                is_pip = step[:3] == [sys.executable, "-m", "pip"]
                if is_pip:
                    pip_specs.extend(step[5:])   # past […, "install", "--no-input"]
                    step = step[:5] + ["--target", EXTRAS_DIR] + step[5:]   # install into the USER extras dir, not the app bundle
                # only run a non-pip step if it's a console script this venv provides (installed by a prior pip step)
                elif not (os.path.exists(os.path.join(venv_bin, step[0])) or shutil.which(step[0], path=venv_bin)):
                    return {"ok": False, "error": f"cannot run tokeniser step: {' '.join(step)}"}
                if progress:
                    progress(None, "Tokeniser: " + " ".join(os.path.basename(x) for x in step[:4]))
                try:
                    subprocess.run(step, check=True, capture_output=True, text=True, env=env)
                except subprocess.CalledProcessError as ce:
                    return {"ok": False, "error": (ce.stderr or str(ce))[:400]}
        except Exception as exc:  # noqa: BLE001 — model load failed for another reason
            msg = str(exc)
            # a prebuilt tokeniser wheel (e.g. spacy-pkuseg) can mismatch this venv's NumPy → rebuild from source
            abi = ("dtype size changed" in msg) or ("binary incompatibility" in msg) or ("numpy.core" in msg)
            if abi and pip_specs and not rebuilt:
                rebuilt = True
                names = [re.split(r"[<>=!~ ]", s)[0] for s in pip_specs]
                if progress:
                    progress(None, "Rebuilding tokeniser for this NumPy…")
                try:
                    subprocess.run([sys.executable, "-m", "pip", "install", "--no-input", "--force-reinstall",
                                    "--no-binary", ",".join(names), *pip_specs],
                                   check=True, capture_output=True, text=True, env=env)
                except subprocess.CalledProcessError as ce:
                    return {"ok": False, "error": (ce.stderr or str(ce))[:400]}
                continue
            return {"ok": False, "error": msg}
    return {"ok": False, "error": "tokeniser dependency unresolved after install"}


def download(model_id: str, progress=None) -> dict:
    """Install a model.  ``progress(pct:int|None, note:str)`` is called as it proceeds."""
    ensure_dirs()

    def note(pct, msg):
        if progress:
            progress(pct, msg)

    engine = model_id.split(":", 1)[0]
    if engine == "sud":
        found = _asset_url(model_id)
        if not found:
            return {"error": f"no downloadable asset for {model_id}"}
        url, filename = found
        tmp = os.path.join(CACHE_DIR, filename)
        try:
            note(0, "Downloading wheel…")
            req = urllib.request.Request(url, headers={"User-Agent": "SUD-Workbench"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as out:
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    note(int(done * 100 / total) if total else None, "Downloading wheel…")
            note(None, "Installing…")
            # Install into the USER extras dir (like the on-demand tiers), never the app's own
            # site-packages — so a read-only/relocated bundle still works and the shared install
            # isn't mutated. --no-deps: the model only needs spaCy, which is in the core; its
            # tokeniser backend (if any) is handled by _ensure_tokenizer_deps below.
            from . import extras
            extras.activate()   # EXTRAS_DIR on sys.path so the just-installed model imports
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-input", "--upgrade",
                            "--no-deps", "--target", EXTRAS_DIR, tmp],
                           check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            return {"error": f"pip install failed: {exc.stderr or exc}"}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        _invalidate_parse_cache()
        note(None, "Checking tokeniser…")   # install the model's raw-text tokeniser backend if it needs one
        dep = _ensure_tokenizer_deps(model_id.split(":", 1)[1], progress=progress)
        note(100, "Installed")
        result = {"ok": True, "id": model_id}
        if not dep.get("ok"):
            result["warning"] = "Model installed, but its tokeniser dependency did not: " + dep.get("error", "")
        return result

    if engine == "stanza":
        lang, _, treebank = model_id.split(":", 1)[1].partition("#")
        pkg = treebank or "default"
        from . import extras   # a Stanza MODEL is useless without the Stanza LIBRARY (torch etc.) —
        if not extras.available("stanza"):   # install the tier on demand first (portable/light builds ship without it)
            note(None, "Installing Stanza support (PyTorch)…")
            r = extras.install("stanza", progress=progress)
            if r.get("error"):
                return {"error": "Stanza support install failed: " + r["error"]}
        try:
            import stanza
            note(None, "Downloading Stanza model…")

            def _dl(procs):
                stanza.download(lang, package=pkg, processors=procs,
                                model_dir=STANZA_DIR, verbose=False)
            # Download only the ESSENTIAL processors (every treebank ships these), then add the
            # OPTIONAL ones best-effort: `mwt` doesn't exist for languages with no multi-word
            # tokens (e.g. Telugu), and `lemma` is an `identity` no-op with no model file for some
            # (also Telugu) — a fixed processor list made either failure abort the whole install.
            _dl("tokenize,pos,depparse")
            for opt in ("lemma", "mwt"):
                try:
                    _dl(opt)
                except Exception:  # noqa: BLE001 — this language simply has no downloadable model for it
                    pass
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        _invalidate_parse_cache()
        note(100, "Installed")
        return {"ok": True, "id": model_id}

    return {"error": f"unknown engine for {model_id}"}


def _remove_targeted(pkg: str) -> bool | None:
    """Delete a ``pip install --target EXTRAS_DIR`` install of ``pkg`` — the thing pip itself cannot do.

    → ``True`` removed, ``False`` tried and failed, ``None`` the package doesn't live under EXTRAS_DIR
    (so it is an ordinary environment install and ``pip uninstall`` is the right tool after all).

    The file list comes from the distribution's own RECORD, so exactly what was installed is what goes.
    Deliberately NOT a glob of the top-level name: a model package and some unrelated dependency can
    share a directory prefix, and a wrong guess here deletes someone else's files.
    """
    import importlib
    import importlib.metadata as md
    root = os.path.realpath(EXTRAS_DIR)
    under = lambda p: p == root or p.startswith(root + os.sep)
    dist = None
    # Scan EXTRAS_DIR EXPLICITLY (`path=[root]`), not the ambient sys.path: EXTRAS_DIR is only on sys.path
    # once extras.activate() has run, so a bare `md.distributions()` finds nothing when this is called before
    # that (or from a tool/test) and the removal silently falls through to pip — which is the very bug this
    # exists to fix. Scanning the directory also settles the extras-vs-venv ambiguity by construction.
    try:
        for d in md.distributions(path=[root]):
            try:
                if (d.metadata["Name"] or "").replace("-", "_") == pkg:
                    dist = d
                    break
            except Exception:  # noqa: BLE001 — a malformed dist in the directory must not stop the scan
                continue
    except Exception:  # noqa: BLE001
        dist = None
    if dist is None:
        return None
    ok = True
    paths: list[str] = []
    try:
        for f in (dist.files or []):
            p = os.path.realpath(str(dist.locate_file(f)))
            if under(p):   # never step outside EXTRAS_DIR, whatever RECORD claims — it is data, not gospel
                paths.append(p)
    except Exception:  # noqa: BLE001
        paths = []
    if not paths:   # no RECORD (or unreadable) → fall back to the two things --target always creates
        paths = []
        for cand in (os.path.join(root, pkg), str(getattr(dist, "_path", "") or "")):
            p = os.path.realpath(cand) if cand else ""
            if p and under(p) and os.path.exists(p):
                shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.remove(p)
    for p in paths:
        try:
            if os.path.islink(p) or os.path.isfile(p):
                os.remove(p)
        except OSError as exc:
            print(f"[models] remove {p}: {exc}", file=sys.stderr)
            ok = False
    info = os.path.realpath(str(getattr(dist, "_path", "") or ""))   # the .dist-info itself, in case RECORD omitted it
    if info and under(info) and os.path.isdir(info):
        shutil.rmtree(info, ignore_errors=True)
    for d0, _dirs, _files in os.walk(root, topdown=False):   # prune the directories the removal emptied, deepest first
        if os.path.realpath(d0) == root:
            continue
        try:
            if not os.listdir(d0):
                os.rmdir(d0)
        except OSError:
            pass
    importlib.invalidate_caches()   # so _installed_sud_packages() re-reads the path and the model stops listing
    return ok


def remove(model_id: str) -> dict:
    engine = model_id.split(":", 1)[0]
    if engine == "sud":
        pkg = model_id.split(":", 1)[1]
        if pkg in BUNDLED_SUD:   # belt and braces — the Model Manager offers no Remove button for these
            return {"error": f"{pkg} ships with SUD Workbench and can't be removed"}
        # UNINSTALL MUST MIRROR INSTALL. download() installs with `pip install --target EXTRAS_DIR`
        # (deliberately — a read-only or relocated bundle can't write its own site-packages), and pip keeps
        # NO record of a --target install, so `pip uninstall` cannot remove one: it prints "Skipping … not
        # installed" and exits 0. That made Remove report success while doing nothing at all — the model
        # stayed on sys.path and kept listing as installed, because _installed_sud_packages() scans
        # importlib.metadata over the whole path, EXTRAS_DIR included. So delete the files ourselves, and
        # fall back to pip only for a package that really does live in an environment pip manages.
        removed = _remove_targeted(pkg)
        if removed is None:   # not under EXTRAS_DIR → a normal environment install (e.g. a dev venv)
            try:
                out = subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", pkg],
                                     check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as exc:
                return {"error": f"pip uninstall failed: {exc.stderr or exc}"}
            # pip's own skip path exits 0 — don't report it as success. The warning goes to STDERR, not stdout.
            if "not installed" in ((out.stdout or "") + (out.stderr or "")).lower():
                return {"error": f"{pkg} is not installed"}
        elif removed is False:
            return {"error": f"couldn't remove {pkg} — see the log"}
        _invalidate_parse_cache()
        return {"ok": True, "id": model_id}
    if engine == "stanza":
        lang, _, treebank = model_id.split(":", 1)[1].partition("#")
        ddir = os.path.join(STANZA_DIR, lang, "depparse")
        if treebank and os.path.isdir(ddir):
            # remove just this treebank's depparse model(s); drop the whole language
            # directory only once no depparse model remains (shared tokenize/pos are cheap)
            import glob
            for f in glob.glob(os.path.join(ddir, treebank + "_*.pt")):
                try:
                    os.remove(f)
                except OSError:
                    pass
            if not glob.glob(os.path.join(ddir, "*.pt")):
                shutil.rmtree(os.path.join(STANZA_DIR, lang), ignore_errors=True)
        else:
            d = os.path.join(STANZA_DIR, lang)
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        _invalidate_parse_cache()
        return {"ok": True, "id": model_id}
    return {"error": f"unknown engine for {model_id}"}


def _invalidate_parse_cache() -> None:
    try:
        from . import parse
        parse.invalidate_cache()
    except Exception:  # noqa: BLE001
        pass
