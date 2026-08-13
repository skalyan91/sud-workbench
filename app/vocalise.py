"""Arabic and Persian vocalisation — restoring the short vowels (tashkīl) written Arabic/Persian
orthography normally omits: ``ذهبت`` → ``ذَهَّبَت``, ``کتاب`` → ``کتابِ``.

The Arabic/Persian analogue of :mod:`app.macron`, and it earns the same treatment for the same
reason: a vocalised spelling is never what the treebank stores, a file must round-trip
byte-identically, and turning it on re-renders the glyphs a reader reads while the grid, the
editors and the file itself keep what was actually written.  So this feeds the **Script** layer
(``translit._SCRIPT_SCHEMES["ar"]``/``["fa"]``, scheme id ``vocalise``) exactly as Latin macrons
do.  Nothing here is ever written to MISC.

WHAT THIS MODULE IS — one façade over TWO pipeline components, not a reimplementation of either
------------------------------------------------------------------------------------------------
``ar_sud_padt`` (from 0.2.0) and ``fa_sud_perdt`` (from 0.2.0) each ship their own vocalising spaCy
component in their DEFAULT pipeline — ``ar_vocalise``/``fa_vocalise`` — the same way
``la_sud_ittb_proiel_perseus`` ships ``la_macronise``.  Every vocalisation decision belongs to
those components and is read from them: the lexicon lookup ladder, the UPOS/FEATS-conditioned
disambiguation, the CAMeL Tools analyser fall-through Arabic's carries.  Nothing here reimplements
any of it.  Unlike ``la_macronise``'s Morpheus table, both components' data ships INSIDE the model
wheel itself (see each component's own module docstring for why: Arabic's table is harvested from
SUD_Arabic-PADT's own gold ``Vform=``, correctly licensed CC BY-NC-SA 4.0 same as the wheel;
Persian's is a set of ezāfe rules derived from the treebank's own dependency structure) — so unlike
``la_macron``, there is no separate fetch step and no ``extras`` tier: installing the model is the
whole prerequisite, exactly as it is for parsing the language at all.

CONSTRUCTED DIRECTLY, NOT OFF A LOADED PIPELINE — same reasoning as ``app/macron.py``: turning the
Script pill on must not load a ~100 MB parser for a reader who only wants to look at a file.  Both
components read no doc state beyond the one token's own (form, upos, feats)/(form, lemma, upos), so
a standalone instance with the packaged table loaded through ``from_disk`` is the same object the
pipeline would use.

TWO GENUINE ASYMMETRIES WITH LATIN, BOTH LEFT AS SCOPED GAPS RATHER THAN PAPERED OVER
---------------------------------------------------------------------------------------
* **Persian's shipped lexicon is EMPTY in this release.**  ``fa_vocalise``'s own module docstring
  says so: the table (Tihu-derived) is not bundled for licensing reasons the same way Morpheus
  isn't, and until ``build_fa_vocalise_lut.py`` is run and repackaged, every Persian token's F/P/L
  lookup rungs answer nothing.  What DOES ship, and DOES fire, is the ezāfe rule table — but
  applying it needs the NEXT token's dependency relation (``next.head.i == tok.i``, ``next.dep_``),
  which is doc-level context this module's per-token ``vocalise()`` does not have and the
  ``orthography`` RPC's parallel (forms, upos, feats, lemmas) arrays were never built to carry —
  adding it would mean threading deprel/head through a call that de-duplicates by (form, upos,
  feats, lemma) KEY across a whole document, where two occurrences of one key can sit in different
  syntactic contexts.  That is a real architecture change, not a bug fix, and is left undone here:
  :func:`available` answers False for "fa" while the shipped lexicon is empty, so the Script row
  stays correctly unavailable rather than presenting a toggle that visibly does nothing.  The row
  starts working the moment a populated lexicon is packaged, with no app-side change at all.
* **Neither component's MWT surface is vocalised.**  Latin's own gap here (``laMwtCompose``,
  js/lang/translit-load.js) is bridged by composing the range from ITS COMPONENTS' own renderings,
  because Morpheus lists words and a fused clitic form is simply absent from it.  The same is true
  here — ``ar_sud_padt``'s CAMeL tokeniser publishes MWT ranges for clitic splits — but no
  composition path is built for it: an Arabic/Persian multi-word token's surface falls through to
  its bare spelling, which is always a legitimate spelling of the word, exactly as an unmacronised
  Latin MWT was before ``laMwtCompose`` existed.
"""

from __future__ import annotations

import glob
import importlib
import importlib.util
import os

# base language → the model package this component ships in, the env override that names a
# locally-built one, the component's own module name inside that package, and the class it defines.
_KNOWN_PACKAGE = {"ar": "ar_sud_padt", "fa": "fa_sud_perdt"}
_PACKAGE_ENV = {"ar": "SUD_AR_PACKAGE", "fa": "SUD_FA_PACKAGE"}
_MODULE_NAME = {"ar": "ar_vocalise", "fa": "fa_vocalise"}
_CLASS_NAME = {"ar": "ArVocalise", "fa": "FaVocalise"}

_MOD_CACHE: dict[str, object] = {}    # base -> resolved component module. Miss NOT memoised — see _module
_COMP_CACHE: dict[str, object] = {}   # base -> constructed component WITH data. Same non-memoised-miss rule


def _package(base: str) -> str:
    """The installed model package that carries ``base``'s vocaliser, or ""."""
    env = _PACKAGE_ENV.get(base, "")
    for name in (os.environ.get(env) or "" if env else "", _KNOWN_PACKAGE.get(base, "")):
        if not name:
            continue
        try:
            if importlib.util.find_spec(name) is not None:   # locates it WITHOUT importing it
                return name
        except Exception:  # noqa: BLE001 — a broken/partial install is "not installed", as far as this goes
            pass
    # …and any other <base>_sud_* package a user has installed, so a future wheel needs no edit here
    # (see app/macron.py's `_la_package`, the same fallback for the same reason).
    mod_name = _MODULE_NAME.get(base, "")
    if not mod_name:
        return ""
    try:
        from . import models_registry
        for name in sorted(models_registry._installed_sud_packages()):
            if name.split("_", 1)[0] == base and importlib.util.find_spec(name + "." + mod_name):
                return name
    except Exception:  # noqa: BLE001
        pass
    return ""


def _module(base: str):
    """``base``'s vocalising component module, or None.  A MISS IS NOT MEMOISED — the model can be
    installed through the Model Manager while this process is running (see app/macron.py's
    `_module` for the full reasoning, which applies verbatim here)."""
    cached = _MOD_CACHE.get(base, ...)
    if cached is not ...:
        return cached
    pkg = _package(base)
    mod_name = _MODULE_NAME.get(base, "")
    if not pkg or not mod_name:
        return None
    try:
        mod = importlib.import_module(pkg + "." + mod_name)
    except Exception:  # noqa: BLE001 — a wheel too old to carry the component, or a broken install
        return None
    _MOD_CACHE[base] = mod
    return mod


def _pipe_dir(base: str) -> str:
    """The packaged component's own serialisation directory (``…/<model>/ar_vocalise`` or
    ``…/fa_vocalise``), or "" — same pattern as ``app.macron._pipe_dir``."""
    pkg = _package(base)
    mod_name = _MODULE_NAME.get(base, "")
    if not pkg or not mod_name:
        return ""
    try:
        spec = importlib.util.find_spec(pkg)
        base_dir = os.path.dirname(spec.origin or "") if spec else ""
    except Exception:  # noqa: BLE001
        return ""
    if not base_dir:
        return ""
    for d in sorted(glob.glob(os.path.join(base_dir, pkg + "-*"))):   # spaCy's <package>-<version> model dir
        p = os.path.join(d, mod_name)
        if os.path.isfile(os.path.join(p, "lut.json.gz")) or os.path.isfile(os.path.join(p, "ezafe.json")):
            return p
    return ""


def _has_data(base: str, comp) -> bool:
    """Does ``comp`` hold a real per-token LEXICON — the part this module actually renders (see the
    module docstring's note on why ezāfe-only Persian data does not count here)."""
    try:
        if base == "ar":
            return bool(comp.l1 or comp.l2 or comp.l3)
        if base == "fa":
            return bool(comp.forms or comp.pos_forms)
    except Exception:  # noqa: BLE001
        return False
    return False


def _component(base: str):
    """A constructed vocaliser for ``base``, built the way the pipeline's own is, or None.  Only a
    LOADED one (real lexicon data) is memoised — see app/macron.py's `_component` for why a
    data-less one is not."""
    cached = _COMP_CACHE.get(base, ...)
    if cached is not ...:
        return cached
    m = _module(base)
    if m is None:
        return None
    cls = getattr(m, _CLASS_NAME.get(base, ""), None)
    if cls is None:
        return None
    try:
        comp = cls()                # picks up nothing at __init__; the table arrives via from_disk below
        d = _pipe_dir(base)
        if d:
            comp.from_disk(d)
    except Exception:  # noqa: BLE001 — an unreadable cache is "no vocalisation", never an exception
        return None
    if _has_data(base, comp):
        _COMP_CACHE[base] = comp
    return comp


# ── the Script-scheme contract translit.py asks of every engine ────────────────────────────────
def available(base: str) -> bool:
    """Can ``base`` ("ar"/"fa") be vocalised here — component AND a real lexicon?  Called from
    `translit._scheme_available`, i.e. once per switch into a document of that language."""
    if base not in _KNOWN_PACKAGE:
        return False
    c = _component(base)
    return bool(c is not None and _has_data(base, c))


def vocalise(base: str, form: str, upos: str = "", feats: str = "", lemma: str = "") -> str:
    """``form`` with its short vowels written in, or ``form`` unchanged when nothing knows them.

    Arabic's lookup is keyed on (form, upos, feats) — the final short vowel is usually a case
    ending, a syntactic fact FEATS carries (see ``ar_vocalise``'s own module docstring).  Persian's
    is keyed on (form, lemma, upos) — the lemma is what extends a lexicon hit over an inflected
    form ("lemma transfer"; see ``fa_vocalise``'s own docstring).  Never raises: a failure is the
    bare form, which is a legitimate spelling of the word."""
    if not form or base not in _KNOWN_PACKAGE:
        return form or ""
    c = _component(base)
    if c is None:
        return form
    try:
        if base == "ar":
            out, _level = c.lookup(form, upos or "", feats or "_")
        else:  # "fa"
            out, _level = c.lookup(form, lemma or "", upos or "")
        return out or form
    except Exception:  # noqa: BLE001
        return form
