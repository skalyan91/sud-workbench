"""Latin vowel length — ``divisa`` → ``dīvīsa``, ``partes`` → ``partēs``.

Restoring vowel length is a *display* question, not an annotation one: the treebanks spell Latin
without macrons, a macron is never part of the FORM as written, and a file must round-trip
byte-identically.  So this feeds the **Script** layer (`translit._SCRIPT_SCHEMES["la"]`, scheme id
``macron``) exactly as the Indic scripts do for Sanskrit — the running sentence and the diagram
glyphs re-render, while the grid, the input fields and the file itself keep the bare form.  Nothing
here is ever written to MISC.

WHAT THIS MODULE IS — AND, EMPHATICALLY, WHAT IT IS NOT
-------------------------------------------------------
It is the single-module façade this codebase asks of every optional dependency (see CLAUDE.md), over
exactly ONE dependency: the ``la_macronise`` component that ``la_sud_ittb_proiel_perseus`` ships **in
its default pipeline** from 0.2.0.  Every vowel-length decision belongs to that component and is read
from it — the cascaded lexicon, the nine-slot morphology key with its backoff ladder, the POS-split
rungs that separate ``malus`` from ``mālus``, the ``_PARADIGM`` override, the orthography-tolerant key
ladder and the breve veto.  Nothing here reimplements any of it, and nothing here should ever start to.

⚠ **An earlier `app/macron.py` DID reimplement all of it** — 912 lines, plus a 215-line vendored table
reader (`app/_la_macron_vendor.py`) and a 599-line macOS-only dictionary lookup (`app/appledict.py`) —
and all three were deleted in 2cd6b14, correctly.  That stack duplicated upstream's work at a version
behind it and needed hand correction after the fact; the model's own component is measured at 97.63 %
whole-token against Alatius (98.23 % where the harvest knows the word, 90.42 % where it does not) and
needs none.  If you find yourself about to write a lookup rung, a paradigm rule or a per-word
correction here, stop: the component already has one, and this file's job is to call it.

WHERE THE DATA COMES FROM, AND WHY IT IS FETCHED RATHER THAN SHIPPED
--------------------------------------------------------------------
The wheel ships the component with **no table** (``add_la_macronise.py … --no-lut``): Morpheus is
CC BY-SA 3.0 and the Latin model is CC BY-**NC**-SA, so bundling the lengths inside the wheel would be
a licensing question.  Fetching them is not one — GPL and share-alike restrict DISTRIBUTION, not USE —
which is the same arrangement `app/convert.py` has with the grew backend and `app/extras.py` has with
the torch tiers.  :func:`install` therefore runs the component's own ``fetch_morpheus()``: ~4 MB on the
wire, compiled to ~2.2 MB in the component's OWN cache (``~/.cache/sud-spacy/``, or
``$LA_MORPHEUS_TABLE``).

⚠ **Its cache, not ours, and that is the point.**  The deleted version fetched a table of its own into
``paths.APP_DATA`` and then pointed the component at it with ``$LA_MORPHEUS_TABLE`` (`parse._share_
macron_table`), because the app owned the fetch.  The component owns it now, so there is one file, one
owner and one download — and the in-pipeline component macronises with the same data this display path
does, with no environment variable in between to get out of step.  A machine that already fetched the
table for the SUD-spaCy CLI gets this for free.

⚠ **Do not "simplify" this by committing the built table.**  It has been the standing temptation and it
is the one thing that turns a use into a distribution.

DEGRADING
---------
With no data the component passes every token through unchanged and warns once (``require_data=False``
— it sits in the DEFAULT pipeline, so a raising component would break every ordinary Latin parse).
That silence is right for a parse and wrong for a menu, so :func:`available` is what the Script layer
asks BEFORE offering the row: an unavailable "With macrons" row is one click from the ``la_macron``
extras tier that supplies it, rather than a row that renders nothing and says nothing.

⚠ **THE ENGINE AND THE DATA ARE TWO SEPARATE ABSENCES, AND :func:`available` REPORTS ONE ANSWER FOR
BOTH.**  The engine IS the Latin model — there is no second copy of ``la_macronise`` anywhere in this
app — so a machine without ``la_sud_ittb_proiel_perseus`` cannot macronise and cannot even fetch the
data (``fetch_morpheus`` is that component's function).  Deliberately not split into two questions the
UI would then have to reconcile: one answer drives the Script row, and :func:`install` says which of
the two is missing when it is asked to run without the model.
"""

from __future__ import annotations

import glob
import importlib
import importlib.util
import os

_KNOWN_LA_PACKAGE = "la_sud_ittb_proiel_perseus"   # the released Latin SUD wheel; see _la_package()
_PACKAGE_ENV = "SUD_LA_PACKAGE"                    # an override, for a locally built Latin package

_MOD: object = ...        # the resolved `la_macronise` module — ⚠ only SUCCESS is memoised (see _module)
_COMP: object = ...       # the constructed LaMacronise; reset by install()


def _la_package() -> str:
    """The installed Latin SUD package that carries ``la_macronise``, or ""."""
    for name in (os.environ.get(_PACKAGE_ENV) or "", _KNOWN_LA_PACKAGE):
        if not name:
            continue
        try:
            if importlib.util.find_spec(name) is not None:   # locates it WITHOUT importing it
                return name
        except Exception:  # noqa: BLE001 — a broken/partial install is "not installed", as far as this goes
            pass
    # …and any other Latin SUD package a user has installed, so a future la_* wheel needs no edit here.
    # Second, not first: the metadata scan re-reads every distribution on sys.path and is the expensive
    # way to answer a question find_spec answers instantly in the overwhelmingly common case.
    try:
        from . import models_registry
        for name in sorted(models_registry._installed_sud_packages()):
            if name.split("_", 1)[0] == "la" and importlib.util.find_spec(name + ".la_macronise"):
                return name
    except Exception:  # noqa: BLE001
        pass
    return ""


def _module():
    """The Latin model's own ``la_macronise`` module, or None.

    ⚠ A MISS IS NOT MEMOISED.  The model can be installed through the Model Manager while this process
    is running, and a cached ``None`` would keep the Script row unavailable until a relaunch — the
    exact "I wasn't able to use it until a restart" `Api._notify_extra_installed` exists to prevent.
    A miss costs one `find_spec`; a hit is cached because the import pulls spaCy in behind it."""
    global _MOD
    if _MOD is not ...:
        return _MOD
    pkg = _la_package()
    if not pkg:
        return None
    try:
        mod = importlib.import_module(pkg + ".la_macronise")
    except Exception:  # noqa: BLE001 — a wheel too old to carry the component, or a broken install
        return None
    _MOD = mod
    return mod


def _pipe_dir() -> str:
    """The packaged component's own serialisation directory (``…/<model>/la_macronise``), or "".

    Read so that a HARVESTED table travels with the model it was built into.  The released wheel ships
    an empty one (``--no-lut``), which is why Morpheus is the whole story in practice — but someone who
    ran ``scripts/build_la_macron.sh`` and repackaged should keep what they built, and `from_disk` is
    the component's own documented way to hand it over."""
    pkg = _la_package()
    if not pkg:
        return ""
    try:
        spec = importlib.util.find_spec(pkg)
        base = os.path.dirname(spec.origin or "") if spec else ""
    except Exception:  # noqa: BLE001
        return ""
    if not base:
        return ""
    for d in sorted(glob.glob(os.path.join(base, pkg + "-*"))):   # spaCy's <package>-<version> model dir
        p = os.path.join(d, "la_macronise")
        if os.path.isfile(os.path.join(p, "lut.json.gz")):
            return p
    return ""


def _component():
    """A ``LaMacronise`` built the way the pipeline's own is, or None.

    Constructed DIRECTLY rather than taken off a loaded pipeline (`nlp.get_pipe("la_macronise")`),
    because this is a display path: turning the Script pill on must not load a ~100 MB parser for a
    reader who only wants to look at a file.  The two are the same object either way — the component
    reads no doc state, only ``(form, upos, feats, lemma)`` — and `from_disk` above restores whatever
    the packaged one would have had.

    ⚠ A DATA-LESS COMPONENT IS NOT MEMOISED either, for the reason `_module` gives about a miss: the
    table can arrive mid-session by a route this process never saw (the SUD-spaCy CLI's own
    ``fetch_morpheus``, or another window's install), and constructing one costs nothing when there is
    no table to parse — ``Morpheus.load`` returns on a failed file test.  Only a LOADED one is kept."""
    global _COMP
    if _COMP is not ...:
        return _COMP
    m = _module()
    if m is None:
        return None
    try:
        comp = m.LaMacronise()          # picks the cached Morpheus table up in its own __init__
        d = _pipe_dir()
        if d:
            comp.from_disk(d)
    except Exception:  # noqa: BLE001 — an unreadable cache is "no macrons", never an exception
        return None
    if comp.has_data():
        _COMP = comp
    return comp


# ── the extras-tier contract (app/extras.py's ``module`` shape: available/install/status) ────────
def available() -> bool:
    """Can Latin be macronised here — engine AND data?  See the ⚠ on that pair in the module docstring.

    Called from `translit._scheme_available`, i.e. once per switch INTO a Latin document, so the cost
    is the component's own one-off load (measured: 0.9 s to import the model package's module, 0.2 s
    to parse the 2.2 MB table) and nothing thereafter."""
    c = _component()
    try:
        return bool(c is not None and c.has_data())
    except Exception:  # noqa: BLE001
        return False


def source() -> str:
    """Which data would answer right now: "morpheus", "local" (a harvested LUT packaged with the
    model), "both", or ""."""
    c, m = _component(), _module()
    if c is None or m is None:
        return ""
    has_lut, has_mp = bool(getattr(c, "l3", None)), getattr(c, "morpheus", None) is not None
    return "both" if (has_lut and has_mp) else ("morpheus" if has_mp else ("local" if has_lut else ""))


def install(progress=None) -> dict:
    """Fetch and compile the Morpheus vowel lengths.  ``progress(pct, note)``, as every tier's is.

    The download and the compile are the component's own ``fetch_morpheus()`` — this adds the app's
    progress shape and nothing else."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    m = _module()
    if m is None:
        # The honest error, and the actionable one: the data has no engine to feed and no fetcher to
        # arrive by. Named as a MODEL to install, since that is the row the reader is already looking at.
        return {"error": "Latin macrons need the Latin model — install “la_sud_ittb_proiel_perseus” "
                         "above first; the vowel-length data is fetched by a component it ships."}
    seen = 0

    def relay(_msg):
        """`fetch_morpheus` reports in prose — one line announcing the download, then one or more from
        the compile, then one for the write.  Its wording is upstream's to change, so the bar is driven
        by HOW MANY lines have arrived rather than by matching any of them: the first is the download,
        everything after it is the compile, and a reworded line still advances rather than stalling."""
        nonlocal seen
        seen += 1
        if seen <= 1:
            note(8, "Downloading Morpheus vowel lengths…")
        else:
            note(min(40 + 15 * (seen - 1), 90), "Compiling…")

    note(2, "Downloading Morpheus vowel lengths…")
    try:
        m.fetch_morpheus(progress=relay)
    except Exception as exc:  # noqa: BLE001 — offline, or the upstream file moved: say so, don't raise
        return {"error": f"could not fetch the Morpheus vowel-length table: {exc}"}
    global _COMP
    _COMP = ...            # …so the next available() re-reads the table that has just landed
    _clear_render_cache()
    if not available():
        return {"error": "the fetched table held no usable vowel lengths"}
    note(100, "Installed")
    return {"ok": True, "source": source(), "path": str(m.morpheus_path())}


def status() -> dict:
    """One row for the Manage Models UI (`extras.status` builds its own from TIERS; this is the
    module-side answer the ``module`` tier contract asks for)."""
    m = _module()
    return {"id": "la_macron", "label": "Latin macrons",
            "note": "Morpheus vowel lengths, fetched from latin-macronizer (~4 MB download)",
            "installed": available(), "source": source(),
            "credit": getattr(m, "MORPHEUS_CREDIT", "") if m is not None else ""}


def _clear_render_cache() -> None:
    """Drop `translit`'s memoised renderings of the ``macron`` scheme.

    `_render_one` caches per (lang, scheme, text, upos, feats, lemma) and caches MISSES too, so a
    document rendered before the table arrived would keep showing bare forms for the rest of the
    session.  Local import: `translit` reaches THIS module the same lazy way, and neither may pull the
    other in at import time."""
    try:
        from . import translit
        for k in [k for k in translit._CACHE if len(k) > 1 and k[1] == "macron"]:
            translit._CACHE.pop(k, None)
    except Exception:  # noqa: BLE001
        pass


# ── the lookup ───────────────────────────────────────────────────────────────────────────────────
def macronise(form: str, upos: str = "", feats: str = "", lemma: str = "") -> str:
    """``form`` with its vowel lengths written in, or ``form`` unchanged when nothing knows them.

    All four arguments matter and none may be dropped for convenience: ``Gallia`` nominative and
    ``Galliā`` ablative are one spelling with two answers that only FEATS separates, ``malus`` (ADJ)
    and ``mālus`` (NOUN) only UPOS, and the lemma is what tells an a-stem from an o-stem where FEATS
    carries no ``InflClass``.  A caller that sends the form alone reaches only the morphology-blind
    rungs of the table — which is where nominative ``Gallia`` picks up an ablative macron.

    Never raises: a failure is the bare form, which is a legitimate spelling of the word."""
    if not form:
        return ""
    c = _component()
    if c is None:
        return form
    try:
        out, _level = c.resolve(form, upos or "", feats or "_", lemma or None)
        return out or form
    except Exception:  # noqa: BLE001
        return form
