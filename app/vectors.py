"""Cross-lingually aligned word vectors — the semantic half of :mod:`app.gloss_align`'s alignment.

Thirteen tables, one per language, published as side assets of the ``sud-spacy-parsers`` release
(``vectors-v0.1.0``: ``sud_vec_<lang>_128d.npz``, 24–32 MB each) and living in **one shared
128-dimensional space**, so a word in any of them can be compared to a word in any other by a plain
dot product — the rows are unit length, so that dot product IS the cosine.

WHY THEY ARE FETCHED RATHER THAN SHIPPED, AND FETCHED PER LANGUAGE
------------------------------------------------------------------
Upstream states the reason and it is the same one this app already lives by for the grammars, the
Morpheus table and vidyut's kosha: a table is only useful when you hold **two at once**, so a copy
inside each wheel would be thirteen copies of something no single wheel can use — and eleven of the
thirteen derive from fastText (**CC BY-SA 3.0**), which could not go inside the CC BY-NC-SA la/ta/te
wheels at all. So they are side assets, and this module is the app's own fetch of them.

⚠ **THEY ARE NOT A PARSER INPUT.** Static vectors as a parser feature were measured twice upstream
and rejected both times (SUD-spaCy's ``NEGATIVE-RESULTS.md``). Nothing here should be read as a route
to better LAS; the job is *alignment across a translation*, which is a different question with a
different metric.

⚠ **ENGLISH IS THE HUB, so it is fetched alongside every other language.** Every other table is
placed in en's space by an orthogonal Procrustes rotation, and this app's one consumer aligns a
sentence against its ENGLISH translation. Fetching ``xx`` without ``en`` would leave a reader holding
a table with nothing to compare it to — which is the failure mode upstream's "only useful two at a
time" sentence is about. :func:`ensure_for_lang` therefore fetches the pair.

⚠ **THREE THINGS ABOUT AN ASSET CANNOT BE GUESSED** and are read off its own ``meta`` by the vendored
reader (:mod:`app._aligned_vectors_vendor`), never re-derived here: whether keys are lowercased
(worth 31 points of English type coverage), whether the table is keyed by FORM or by LEMMA (``sa`` is
the one keyed by lemma — Apte is keyed by stems, and Sanskrit inflection makes a form-keyed table
mostly hapax), and whether a ``key_norm`` orthography fold applies (``la`` is the one that has one:
its treebanks are u-dominant while every Latin corpus spells with ``v`` and ``j``).

⚠ **BUT ``key_attr`` IS NOT AN INSTRUCTION ABOUT WHAT TO LOOK UP** — it says what an asset was BUILT
from, and a form-keyed table of an inflected language holds plenty of lemmas too, because lemmas are
words. :func:`token_vector` therefore asks for BOTH a token's form and its lemma and averages what
comes back, which is measurably better than either alone; the measurements, and why an average and
not a maximum, are in that function.

⚠ **A MISSING TABLE IS SILENCE, NEVER AN ERROR.** Only thirteen languages have one, a fetch can fail,
and a reader whose model predates this feature has none — in all three cases :mod:`app.gloss_align`
simply scores the pair on structure alone and gets exactly the answer it gave before this module
existed. That is what makes the semantic term additive rather than a new dependency.
"""

from __future__ import annotations

import os
import threading
import urllib.request

from .paths import VECTORS_DIR, ensure_dirs

# The release the assets live in. Pinned rather than "the latest release", because the MODEL releases
# and the VECTOR release are separate tags on the same repository and "latest" is whichever was
# published last — which for most of this repository's life is a model release carrying no vectors at
# all. `_asset_url` still prefers whatever the cached release LISTING says (so a re-tagged or
# re-published asset is followed without editing this line); the literal is the fallback for a cold
# cache, a rate-limited API or an offline machine, which is the common case at model-install time.
VECTORS_TAG = os.environ.get("SUD_VECTORS_TAG", "vectors-v0.1.0")
_DIMS = 128
_ASSET = "sud_vec_{lang}_{d}d.npz"
_DOWNLOAD_URL = ("https://github.com/{repo}/releases/download/{tag}/{name}")

# The hub every other table is rotated onto, and this app's translation language.
HUB = "en"

# The languages the release publishes. Kept as a literal FALLBACK only — `asset_langs()` prefers the
# real release listing, so a fourteenth language needs no edit here. It exists so that an offline
# machine still knows which languages are worth asking about rather than attempting thirteen 404s.
_KNOWN_LANGS = ("ar", "en", "fa", "id", "ja", "ko", "la", "lzh", "sa", "ta", "te", "yue", "zh")

# Document language → asset language. The frontend's DOCLANG is whatever the file or the reader said,
# which may carry a region tag or be spelt in 639-3 where the assets are named in 639-1. Only the
# codes that actually differ are listed; `lzh` and `yue` are 639-3 in both places and need no row.
_LANG_ALIASES = {
    "eng": "en", "ara": "ar", "fas": "fa", "per": "fa", "ind": "id", "jpn": "ja",
    "kor": "ko", "lat": "la", "san": "sa", "tam": "ta", "tel": "te",
    "zho": "zh", "cmn": "zh", "chi": "zh", "yue": "yue", "lzh": "lzh",
}

_LOCK = threading.Lock()
_CACHE: dict[str, object] = {}      # lang → AlignedVectors, or the string "" for "not on disk"
_CACHE_ORDER: list[str] = []
# A loaded table is ~27 MB of float32 plus its key index. Two are in play at once (the document's
# language and the hub), so a cap of four holds a reader who switches documents without letting a
# session that has opened eight languages carry all eight.
_CACHE_MAX = 4


def norm_lang(lang: str) -> str:
    """A document language as an ASSET language: ``en-US`` → ``en``, ``san`` → ``sa``, ``""`` → ``""``.

    Deliberately NOT a general 639-3 → 639-1 table: an unknown code answers with itself and then
    simply has no asset, which is the same silence as a language the release does not cover."""
    code = (lang or "").strip().lower().replace("_", "-").split("-")[0]
    return _LANG_ALIASES.get(code, code)


def asset_name(lang: str) -> str:
    return _ASSET.format(lang=lang, d=_DIMS)


def path_for(lang: str) -> str:
    return os.path.join(VECTORS_DIR, asset_name(lang))


def have(lang: str) -> bool:
    """Is this language's table on disk and non-empty?  Asked of the FILE, not of a record of a
    download, so a table deleted by hand answers honestly."""
    lang = norm_lang(lang)
    if not lang:
        return False
    try:
        return os.path.getsize(path_for(lang)) > 0
    except OSError:
        return False


def installed_langs() -> list[str]:
    """Every language with a table on disk, in the order the assets are named."""
    try:
        names = os.listdir(VECTORS_DIR)
    except OSError:
        return []
    out = []
    for n in sorted(names):
        if n.startswith("sud_vec_") and n.endswith(f"_{_DIMS}d.npz"):
            out.append(n[len("sud_vec_"):-len(f"_{_DIMS}d.npz")])
    return out


def asset_langs() -> list[str]:
    """Which languages the release actually publishes — read off the cached release listing that
    :mod:`app.models_registry` already keeps, so a new language needs no edit here.  Falls back to
    :data:`_KNOWN_LANGS` when there is no listing to read (offline, cold cache, rate-limited)."""
    for rel in _releases():
        if rel.get("tag_name") != VECTORS_TAG:
            continue
        langs = []
        for a in rel.get("assets") or []:
            n = a.get("name") or ""
            if n.startswith("sud_vec_") and n.endswith(f"_{_DIMS}d.npz"):
                langs.append(n[len("sud_vec_"):-len(f"_{_DIMS}d.npz")])
        if langs:
            return sorted(langs)
    return list(_KNOWN_LANGS)


def _releases() -> list[dict]:
    """The cached GitHub release listing, and never a network call of our own: this is asked in the
    middle of a model install, where a second uncached API round-trip would be paid for nothing."""
    try:
        from . import models_registry
        return models_registry._fetch_releases(models_registry.CACHE_ONLY) or []
    except Exception:  # noqa: BLE001 — a trimmed build, or an unreadable cache: answer "no listing"
        return []


def _asset_url(lang: str) -> str:
    """The listing's own ``browser_download_url`` where there is one, else the derived URL."""
    name = asset_name(lang)
    for rel in _releases():
        if rel.get("tag_name") != VECTORS_TAG:
            continue
        for a in rel.get("assets") or []:
            if a.get("name") == name and a.get("browser_download_url"):
                return a["browser_download_url"]
    from . import models_registry
    return _DOWNLOAD_URL.format(repo=models_registry.SUD_REPO, tag=VECTORS_TAG, name=name)


# ── the fetch ──────────────────────────────────────────────────────────────────────────────────
def fetch(lang: str, progress=None, label: str = "") -> dict:
    """Download one language's table into :data:`VECTORS_DIR`.  ``{"ok"}``/``{"error"}``/
    ``{"ok", "unchanged"}``; ``progress(pct, note)``, the same shape as every tier's.

    Written to a ``.partial`` and renamed, exactly as :mod:`app.grammars`/:mod:`app.vidyut_data` do:
    a truncated download must never leave a file :func:`have` reads as present."""
    lang = norm_lang(lang)
    if not lang:
        return {"error": "no language given"}
    ensure_dirs()
    if have(lang):
        return {"ok": True, "lang": lang, "unchanged": True}

    def note(pct, msg):
        if progress:
            progress(pct, msg)

    what = label or f"the {lang} alignment vectors"
    dest = path_for(lang)
    tmp = dest + ".partial"
    url = _asset_url(lang)
    try:
        note(0, f"Downloading {what}…")
        req = urllib.request.Request(url, headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                note(int(done * 100 / total) if total else None, f"Downloading {what}…")
    except Exception as exc:  # noqa: BLE001 — offline, 404 for a language with no asset, a full disk
        _rm(tmp)
        return {"error": f"could not download {asset_name(lang)}: {exc}"}
    # An .npz is a zip: a truncated or HTML-error body is caught here rather than at the first
    # lookup, months later, as a puzzling exception inside the glossing pass.
    try:
        import numpy as np
        with np.load(tmp, allow_pickle=False) as z:
            if "vectors" not in z.files or "keys" not in z.files:
                raise ValueError("no vectors/keys arrays")
    except Exception as exc:  # noqa: BLE001
        _rm(tmp)
        return {"error": f"{asset_name(lang)} downloaded but is not a usable vector table: {exc}"}
    os.replace(tmp, dest)
    with _LOCK:
        _CACHE.pop(lang, None)
        if lang in _CACHE_ORDER:
            _CACHE_ORDER.remove(lang)
    return {"ok": True, "lang": lang}


def ensure_for_lang(lang: str, progress=None) -> str:
    """Make sure this language's table AND the English hub's are on disk.  Returns "" or a warning
    phrase — never raises, and never an error: a model that installed correctly must not be reported
    as failed because a 25 MB optional table did not arrive.

    Called from :func:`app.models_registry.download` for every model, so the tables land beside the
    parser that made them useful.  A language the release has no asset for is a silent no-op."""
    lang = norm_lang(lang)
    covered = set(asset_langs())
    langs = [l for l in dict.fromkeys((lang, HUB))          # the pair, deduplicated, order kept
             if l and l in covered and not have(l)]
    if not langs:
        return ""
    bad = []
    for l in langs:
        # Named in the message, because "Downloading alignment vectors…" twice in a row reads as a
        # stall rather than as the two tables an alignment needs (see the ⚠ about the hub above).
        r = fetch(l, progress, label=f"the {l} alignment vectors ({_size_hint(l)})")
        if r.get("error"):
            bad.append(r["error"])
    if bad:
        return "its alignment vectors did not: " + "; ".join(bad)
    return ""


def _size_hint(lang: str) -> str:
    for rel in _releases():
        if rel.get("tag_name") != VECTORS_TAG:
            continue
        for a in rel.get("assets") or []:
            if a.get("name") == asset_name(lang) and a.get("size"):
                return f"{a['size'] / 1e6:.0f} MB"
    return "~25 MB"


def _rm(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


# ── reading a table ────────────────────────────────────────────────────────────────────────────
def table(lang: str):
    """The loaded :class:`AlignedVectors` for a language, or ``None``.

    Memoised, including the NEGATIVE answer: :mod:`app.gloss_align` asks once per sentence batch, and
    a document in a language with no asset would otherwise pay a ``stat`` per call for ever."""
    lang = norm_lang(lang)
    if not lang:
        return None
    with _LOCK:
        if lang in _CACHE:
            hit = _CACHE[lang]
            return hit or None
    if not have(lang):
        with _LOCK:
            _CACHE[lang] = ""
        return None
    try:
        from ._aligned_vectors_vendor import AlignedVectors
        loaded = AlignedVectors.load(path_for(lang))
    except Exception:  # noqa: BLE001 — a corrupt or half-written file is "no table", not a crash
        with _LOCK:
            _CACHE[lang] = ""
        return None
    with _LOCK:
        # The load ran OUTSIDE the lock — 135 ms is far too long to hold one for — so two threads can
        # race to load the same table and the second simply wins. Re-establishing the order list from
        # scratch rather than appending is what keeps that harmless: a duplicate entry would otherwise
        # let the eviction below drop a name from the order while leaving its 27 MB in the cache.
        _CACHE[lang] = loaded
        _CACHE_ORDER[:] = [l for l in _CACHE_ORDER if l != lang] + [lang]
        while len(_CACHE_ORDER) > _CACHE_MAX:
            _CACHE.pop(_CACHE_ORDER.pop(0), None)
    return loaded


def token_vector(tab, form: str, lemma: str = ""):
    """One token's place in the shared space, from BOTH its form and its lemma — ``None`` where the
    table holds neither.

    ⚠ **BOTH KEYS ARE TRIED, AND THE TWO ANSWERS ARE AVERAGED — NOT one chosen by ``key_attr``.**
    An asset declares which attribute it is BUILT from (``sa`` from LEMMA, because Apte is keyed by
    stems and Sanskrit inflection makes a form-keyed table mostly hapax; everything else from FORM),
    and the first cut of this function read that declaration as an instruction about what to look up.
    It is not: it says what the table is likely to HOLD, and a form-keyed table of an inflected
    language holds plenty of lemmas too — they are words. Measured over the 37 pairs this app's own
    aligner produces on the three translated samples, form-only against the mean of both:

        median cosine   0.288 -> 0.321        10th percentile   0.019 -> 0.050
        `venit`/*came*  0.455 -> 0.610        (the lemma `venio` is what matches *come*)
        `passus`/*suffered*  0.430 -> 0.549   `لمدرسة`/*school*  0.535 -> 0.691

    The tail is the point: a form-keyed table's weakest answers are exactly the heavily inflected
    tokens whose lemma it does hold. Some pairs lose a little (`الولد`/*boy* 0.551 -> 0.487, where the
    Arabic lemma is the weaker key), which is what an average is for.

    ⚠ **AVERAGED RATHER THAN MAXIMISED, because a max over k draws is a noise generator.** Measured
    on 4 000 random (source, English) token pairs: taking the best of the four form/lemma
    combinations moves the MEDIAN of pure chance from 0.008 to **0.105** and its 90th percentile from
    0.142 to 0.224, eating more of the margin than the better gold score wins back (gold-minus-chance
    0.146 for one key, 0.101 for the max of four, **0.166** for the mean). Pairing like with like —
    form against form, lemma against lemma, best of the two — is better than the max of four and
    still worse than the mean (0.141). The mean is also a SINGLE draw, so :data:`_SEM_LO`'s
    calibration against the chance distribution keeps meaning what it says.

    The two vectors are unit length, so their sum re-normalised is their mean direction; no numpy
    import is needed for it, which is what keeps this module importable in a build that has none."""
    if tab is None:
        return None
    keys, seen = [], set()
    for s in (form, lemma):
        s = (s or "").strip()
        if not s or s == "_":
            continue
        k = tab.fold(s)             # the table's own lowercasing / `la` orthography fold
        if k not in seen:           # a lemma spelt like its form is ONE key, not two votes for it
            seen.add(k)
            keys.append(s)
    vs = [v for v in (tab[s] for s in keys) if v is not None]
    if not vs:
        return None
    if len(vs) == 1:
        return vs[0]
    v = vs[0] + vs[1]
    n = float(v @ v) ** 0.5         # 0 only if the two are exactly opposite, which unit rows can be
    return v / n if n else vs[0]


# The name this had while it read `key_attr` and returned one key's row. Kept as an alias so a caller
# written against it gets the better answer rather than an AttributeError.
lookup = token_vector


def clear_cache() -> None:
    """Drop the loaded tables — for a test, and for the moment a fetch lands mid-session."""
    with _LOCK:
        _CACHE.clear()
        _CACHE_ORDER.clear()


# ── the extras-tier contract (app/extras.py's ``module`` shape: available/install/status) ───────
def _wanted_langs() -> list[str]:
    """Which tables this machine ought to have: one per INSTALLED parser language that the release
    covers, plus the English hub if any of them is there.

    Asked of the installed models rather than of all thirteen languages, because the tier's question
    is "is anything missing for what I actually have" — thirteen tables is 340 MB and nobody wants
    twelve of them."""
    langs: set[str] = set()
    try:
        from . import extras, models_registry
        # ⚠ ACTIVATE FIRST, or this answers a DIFFERENT question depending on who asked. Downloaded
        # models live in EXTRAS_DIR, which is only on `sys.path` once `extras.activate()` has run —
        # so `vectors.available()` reached directly (a test, another module) saw the core venv's
        # models alone and reported "nothing missing", while the same call reached through
        # `extras.available("vectors")` — which activates on the way in — saw five more languages and
        # reported the opposite. Measured on this machine: 2 wanted languages against 7.
        extras.activate()
        for row in models_registry.list_installed():
            code = norm_lang(row.get("lang") or "")
            if code:
                langs.add(code)
    except Exception:  # noqa: BLE001 — a trimmed build, or spaCy not importable: answer for what is on disk
        langs.update(norm_lang(l) for l in installed_langs())
    have_asset = set(asset_langs())
    out = sorted(l for l in langs if l in have_asset)
    if out:
        out = sorted(set(out) | ({HUB} if HUB in have_asset else set()))
    return out


def available() -> bool:
    """Is every table this machine wants already on disk?  False is the pre-existing-install state —
    models present, vectors never fetched — which is exactly what the Manage Models row is for."""
    want = _wanted_langs()
    return bool(want) and all(have(l) for l in want)


def install(progress=None) -> dict:
    """Fetch every missing table for an installed parser language, plus the hub."""
    ensure_dirs()
    want = [l for l in _wanted_langs() if not have(l)]
    if not want:
        if progress:
            progress(100, "Installed")
        return {"ok": True, "unchanged": True, "langs": installed_langs()}
    bad = []
    for n, l in enumerate(want):
        base = int(n * 100 / len(want))
        span = 100 / len(want)

        def note(pct, msg, _b=base, _s=span):
            if progress:
                progress(None if pct is None else int(_b + pct * _s / 100), msg)

        r = fetch(l, note, label=f"the {l} alignment vectors ({_size_hint(l)})")
        if r.get("error"):
            bad.append(r["error"])
    clear_cache()
    if bad and not installed_langs():
        return {"error": "; ".join(bad)}
    if progress:
        progress(100, "Installed")
    out = {"ok": True, "langs": installed_langs()}
    if bad:
        out["warning"] = "; ".join(bad)
    return out


def status() -> dict:
    """One row for the Manage Models UI (the ``module`` tier contract's own answer)."""
    on_disk = installed_langs()
    return {"id": "vectors", "label": "Cross-lingual alignment vectors",
            "note": "Aligned word vectors used to gloss a sentence from its translation — one "
                    "table per parser language, ~25 MB each, fetched with the parser",
            "installed": available(), "version": VECTORS_TAG,
            "path": VECTORS_DIR, "langs": on_disk}
