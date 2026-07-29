"""UD ↔ SUD ↔ mSUD conversion, isolating all use of grew (via the grewpy client).

Every conversion goes through one code path — serialize the sentence-dict list to
CoNLL-U (:func:`app.io_conllu.serialize`), rewrite it with a vendored ``.grs`` graph
grammar under :data:`GRAMMARS_DIR`, then parse the result back
(:func:`app.io_conllu.parse`).  grew's ``to_conll`` renormalises FEATS/MISC, so a
converted document is deliberately *not* byte-stable against its source — conversion
is an explicit transform, not the passthrough that I/O guarantees.

grewpy is imported lazily: importing it eagerly spawns the OCaml ``grewpy_backend``
process, which may be absent.  All entry points raise :class:`ConversionUnavailable`
(grewpy / backend / grammar missing) or :class:`ConversionError` (rewrite failed) so
the caller can degrade gracefully.  Probe :func:`available` up front to disable UI.

Every public conversion also takes an optional ``lang`` (the document's detected/declared
language, e.g. frontend ``DOCLANG``): when a vendored language-specific grammar covers that
(language, direction) pair, it is preferred over the universal one — see :data:`_LANG_GRAMMARS`.
Most languages have no dedicated grammar for most directions, which is expected (the source
project covers only where a generic rewrite isn't good enough); :func:`_convert` falls back to
the universal grammar whenever the pair is absent from the table.
"""

from __future__ import annotations

import glob
import os
import shutil
from pathlib import Path

from . import io_conllu

GRAMMARS_DIR = Path(__file__).resolve().parent.parent / "grammars"

# grammar file → grew strategy name (see grammars/README.md for provenance)
_GRAMMARS = {
    "ud_to_sud": ("UD_to_SUD.grs", "main"),
    "sud_to_ud": ("SUD_to_UD.grs", "main"),
    "msud_to_sud": ("mSUD_to_SUD.grs", "mSUD_to_SUD_main"),
    "msud_to_ud": ("mSUD_to_UD.grs", "mSUD_to_UD_main"),
}

# (language, direction key) → (grammar file, grew strategy).  Filenames follow
# "{lang}_{Direction}.grs", but the strategy names inside do NOT follow one convention (each
# grammar author picked their own — grammars/README.md's "{lang}_{Direction}_main" rule is only
# true for some of these), so they're enumerated by hand rather than derived, confirmed against
# each file's own `strat` declaration. A (lang, key) absent here means the source project ships
# no dedicated grammar for that pair — not every language covers every direction, and up-conversion
# to mSUD is never covered (see sud_to_msud) — so _convert falls back to the universal grammar.
_LANG_GRAMMARS = {
    ("arh", "sud_to_ud"): ("arh_SUD_to_UD.grs", "arh_SUD_to_UD_main"),
    ("arh", "msud_to_sud"): ("arh_mSUD_to_SUD.grs", "arh_mSUD_to_SUD_main"),
    ("bej", "sud_to_ud"): ("bej_SUD_to_UD.grs", "bej_SUD_to_UD_main"),
    ("bej", "msud_to_sud"): ("bej_mSUD_to_SUD.grs", "bej_mSUD_to_SUD_main"),
    ("bej", "msud_to_ud"): ("bej_mSUD_to_UD.grs", "bej_mSUD_to_UD_main"),
    ("br", "ud_to_sud"): ("br_UD_to_SUD.grs", "br_main"),
    ("de", "ud_to_sud"): ("de_UD_to_SUD.grs", "de_main"),
    ("fr", "ud_to_sud"): ("fr_UD_to_SUD.grs", "fr_main"),
    ("fr", "sud_to_ud"): ("fr_SUD_to_UD.grs", "FR_main_UDplus"),
    ("gya", "sud_to_ud"): ("gya_SUD_to_UD.grs", "gya_SUD_to_UD_main"),
    ("gya", "msud_to_sud"): ("gya_mSUD_to_SUD.grs", "main"),
    ("ha", "sud_to_ud"): ("ha_SUD_to_UD.grs", "ha_main"),
    ("ht", "sud_to_ud"): ("ht_SUD_to_UD.grs", "ht_SUD_to_UD_main"),
    ("pay", "sud_to_ud"): ("pay_SUD_to_UD.grs", "pay_SUD_to_UD_main"),
    ("pay", "msud_to_sud"): ("pay_mSUD_to_SUD.grs", "pay_mSUD_to_SUD_main"),
    ("pcm", "sud_to_ud"): ("pcm_SUD_to_UD.grs", "pcm_main"),
    ("sab", "sud_to_ud"): ("sab_SUD_to_UD.grs", "sab_SUD_to_UD_main"),
    ("say", "sud_to_ud"): ("say_SUD_to_UD.grs", "say_main"),
    ("wo", "ud_to_sud"): ("wo_UD_to_SUD.grs", "wo_main"),
    ("yrk", "sud_to_ud"): ("yrk_SUD_to_UD.grs", "yrk_SUD_to_UD_main"),
    ("yrk", "msud_to_sud"): ("yrk_mSUD_to_SUD.grs", "yrk_mSUD_to_SUD_main"),
    ("yrk", "msud_to_ud"): ("yrk_mSUD_to_UD.grs", "yrk_mSUD_to_UD_main"),
    ("zh", "sud_to_ud"): ("zh_SUD_to_UD.grs", "zh_SUD_to_UD_main"),
    ("zh", "msud_to_sud"): ("zh_mSUD_to_SUD.grs", "zh_mSUD_to_SUD_main"),
    ("zh", "msud_to_ud"): ("zh_mSUD_to_UD.grs", "zh_mSUD_to_UD_main"),
}


class ConversionUnavailable(RuntimeError):
    """grewpy, its OCaml backend, or a required grammar file is missing."""


class ConversionError(RuntimeError):
    """The rewrite ran but produced no result for a sentence."""


_GREW = None          # cached (Graph, GRS) after a successful import + set_config
_GRS_CACHE: dict = {}  # grammar filename → loaded GRS


_VENDORED_BACKEND = Path(__file__).resolve().parent.parent / "vendor" / "grew" / "bin" / "grewpy_backend"


def _ensure_backend_on_path() -> None:
    """grewpy spawns the ``grewpy_backend`` binary by name.  Prefer a copy bundled with
    the app under ``vendor/grew/bin`` (see tools/bundle_grew.sh); otherwise fall back to
    the opam install under ``~/.opam/<switch>/bin`` — neither is on the app's PATH by
    default, so prepend whichever we find."""
    if shutil.which("grewpy_backend"):
        return
    if _VENDORED_BACKEND.exists():   # self-contained bundle → no opam needed at runtime
        os.environ["PATH"] = str(_VENDORED_BACKEND.parent) + os.pathsep + os.environ.get("PATH", "")
        return
    for cand in glob.glob(os.path.expanduser("~/.opam/*/bin/grewpy_backend")):
        os.environ["PATH"] = os.path.dirname(cand) + os.pathsep + os.environ.get("PATH", "")
        return


def _ensure_grew():
    """Import grewpy (spawning the backend) and set the SUD config once.  Cached."""
    global _GREW
    if _GREW is not None:
        return _GREW
    _ensure_backend_on_path()
    try:
        from grewpy import GRS, Graph, set_config
    except Exception as exc:  # ImportError, or backend binary not found
        raise ConversionUnavailable(f"grewpy/backend unavailable: {exc}") from exc
    try:
        set_config("sud")   # matches the converter's `-config sud`
    except Exception as exc:  # noqa: BLE001
        raise ConversionUnavailable(f"grew set_config failed: {exc}") from exc
    _GREW = (Graph, GRS)
    return _GREW


def _load_grs(filename: str):
    if filename in _GRS_CACHE:
        return _GRS_CACHE[filename]
    _, GRS = _ensure_grew()
    path = GRAMMARS_DIR / filename
    if not path.exists():
        raise ConversionUnavailable(f"grammar not found: {path}")
    try:
        grs = GRS(str(path))
    except Exception as exc:  # noqa: BLE001
        raise ConversionUnavailable(f"could not load grammar {filename}: {exc}") from exc
    _GRS_CACHE[filename] = grs
    return grs


def _convert_conllu(conllu_text: str, filename: str, strat: str) -> str:
    """Rewrite each sentence block of ``conllu_text`` under ``strat`` and rejoin."""
    Graph, _ = _ensure_grew()
    grs = _load_grs(filename)
    blocks = [b for b in conllu_text.split("\n\n") if b.strip()]
    out = []
    for block in blocks:
        try:
            graph = Graph(block)
            results = grs.run(graph, strat=strat)
        except Exception as exc:  # noqa: BLE001
            raise ConversionError(f"grew rewrite failed: {exc}") from exc
        if not results:
            raise ConversionError("grew produced no graph for a sentence")
        out.append(results[0].to_conll())
    return "\n\n".join(b.rstrip("\n") for b in out) + "\n"


def _restore_meta(source: list[dict], converted: list[dict]) -> list[dict]:
    """grew keeps ``# sent_id``/``# text`` but may drop other comment lines — re-attach
    them from the source when sentence count and order are preserved (they are: one
    graph in, one graph out)."""
    if len(source) == len(converted):
        for src, dst in zip(source, converted):
            if not dst.get("sid"):
                dst["sid"] = src.get("sid")
            if not dst.get("text"):
                dst["text"] = src.get("text")
            if src.get("comments") and not dst.get("comments"):
                dst["comments"] = list(src["comments"])
    return converted


def _convert(sentences: list[dict], key: str, lang: str | None = None) -> list[dict]:
    filename, strat = (_LANG_GRAMMARS.get((lang, key)) if lang else None) or _GRAMMARS[key]
    text = io_conllu.serialize(sentences)
    converted = io_conllu.parse(_convert_conllu(text, filename, strat))
    return _restore_meta(sentences, converted)


# ── public conversions ───────────────────────────────────────────────────────
def ud_to_sud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "ud_to_sud", lang)


def sud_to_ud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "sud_to_ud", lang)


def msud_to_sud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "msud_to_sud", lang)


def msud_to_ud(sentences: list[dict], lang: str | None = None) -> list[dict]:
    return _convert(sentences, "msud_to_ud", lang)


def sud_to_msud(sentences: list[dict]) -> list[dict]:
    """Always unavailable — kept as the guard on this direction, not as a code path.

    mSUD is the richest format; up-conversion to the morph level is not automatic
    (Guillaume et al. 2024) and no universal grammar exists.  Nothing in the UI reaches
    here any more: the Format menu's mSUD entry is *Annotate as mSUD*, a frontend-only
    relabel into morph-annotation mode (``js/io/formats.js``), so the user is never
    offered a conversion that cannot happen.  This stays so that a caller asking for the
    conversion itself gets a clear answer rather than silently wrong output.
    """
    raise ConversionUnavailable("SUD → mSUD is not an automatic conversion")


def to_sud(sentences: list[dict], src_format: str, lang: str | None = None) -> list[dict]:
    """Bring an imported document into the app's native SUD, from its detected format."""
    if src_format == "UD":
        return ud_to_sud(sentences, lang)
    if src_format == "mSUD":
        return msud_to_sud(sentences, lang)
    return sentences  # already SUD


def to_ud(sentences: list[dict], src_format: str, lang: str | None = None) -> list[dict]:
    """Export path: convert a live SUD/mSUD document to UD."""
    if src_format == "mSUD":
        return msud_to_ud(sentences, lang)
    if src_format == "UD":
        return sentences
    return sud_to_ud(sentences, lang)


def available() -> dict:
    """Probe for the UI: is grewpy + backend importable, and which grammars are present.
    Never raises."""
    grammars = {k: (GRAMMARS_DIR / v[0]).exists() for k, v in _GRAMMARS.items()}
    info = {"grewpy": False, "backend": False, "grammars": grammars}
    _ensure_backend_on_path()
    try:
        import grewpy  # noqa: F401
        info["grewpy"] = True
    except ImportError:
        return info
    except Exception:  # noqa: BLE001 — imported but backend spawn failed
        info["grewpy"] = True
        return info
    try:
        _ensure_grew()
        info["backend"] = True
    except ConversionUnavailable:
        pass
    return info
