"""On-demand heavy dependencies.

The portable app ships a light CORE (spaCy CNN parsing + the transliteration engines that
need no PyTorch). The heavy, optional stacks are installed on demand into a user-writable
:data:`EXTRAS_DIR` that is added to ``sys.path`` at startup — so a frozen/portable bundle can
grow when a feature is first used, without being rebuilt, mirroring how the models already
download into Application Support.

Tiers (each behind a lazy ``try: import`` in ``translit`` / ``parse``):
  * ``stanza``   — Stanza UD parsers (pulls torch + transformers), ~1.1 GB
  * ``japanese`` — cutlet/fugashi/unidic-lite romanisation dictionaries, ~0.45 GB
  * ``la_macron`` — Latin vowel lengths (a DATA tier, not a pip one — see below), ~4 MB
  * ``grammars`` — UD↔SUD conversion grammars (also a DATA tier), ~450 KB
  * ``fa_vocab`` — Persian vocalisation lexicon (also a DATA tier — see :mod:`app.fa_vocab`), ~10 MB
  * ``grew``     — the grewpy_backend OCaml binary (also a DATA tier, installed via opam rather
    than fetched — see :mod:`app.grew_backend`), size varies (opam build)

NOT EVERY TIER IS A PIP INSTALL. ``la_macron``, ``grammars``, ``fa_vocab`` and ``grew`` each fetch/
install something other than a pip package: the Morpheus vowel-length table can't be bundled with
the Latin model for licensing reasons and isn't on PyPI in any form (see :mod:`app.macron`), the
surfacesyntacticud/tools conversion grammars carry no declared licence at all, so shipping a copy —
in this repo or in any built package — would republish someone else's work without a grant to (see
:mod:`app.grammars` and ``THIRD-PARTY-NOTICES.md``), KaamelDict is GPL, which restricts distribution
rather than use (see :mod:`app.fa_vocab`), and grewpy_backend is CeCILL v2.1 licensed — same
restricts-distribution-not-use shape, but with no PyPI wheel and no plain downloadable binary either,
so its own on-demand path drives opam rather than downloading anything itself (see
:mod:`app.grew_backend`). A tier therefore declares EITHER ``pip`` + ``probe`` or
``module`` — the name of a module supplying its own ``available()``/``install(progress)``/
``status()`` — and :func:`install` dispatches on which. The alternative was a second parallel
install/progress/UI path for one row in the same list, which is how two ways to do the same thing
get built.
"""

from __future__ import annotations

import importlib
import platform
import site
import subprocess
import sys

from .paths import EXTRAS_DIR, ensure_dirs

# feature key → install spec. ``pip`` requirements pull their own heavy deps (torch, transformers,
# unidic dictionaries…); ``probe`` is the module whose importability means the tier is present.
TIERS: dict[str, dict] = {
    "stanza": {
        "label": "UD parsing (Stanza)",
        # Pinned to match requirements.txt's dev/tested set exactly: an unpinned "spacy-stanza"
        # here resolves the VANILLA PyPI package, whose own metadata pins `stanza<1.7.0` — that
        # silently drags in the pre-1.7 stanza (1.6.1 as of this writing) instead of the 1.10.1
        # this app is actually developed and verified against, on a code path (app/parse.py's
        # Stanza MWT extraction) that reads Stanza's own object model directly. The git+ fork is
        # the SAME one requirements.txt uses, because it relaxes the vanilla package's spaCy pin.
        "pip": ["stanza==1.10.1",
                "spacy-stanza @ git+https://github.com/omri374/spacy-stanza.git"],
        "probe": "stanza",
        "note": "Stanza UD parsers + PyTorch (~1.1 GB)",
    },
    "japanese": {
        "label": "Japanese romaji",
        "pip": ["janome", "pykakasi", "cutlet", "fugashi", "unidic-lite"],
        "probe": "cutlet",
        "note": "Japanese romanisation dictionaries (~0.45 GB)",
    },
    "la_macron": {
        "label": "Latin macrons",
        "module": "macron",     # a DATA tier: app/macron.py fetches through the Latin model's own component
        "note": "Morpheus vowel lengths, fetched from latin-macronizer (~4 MB) — needs the Latin model",
    },
    "grammars": {
        "label": "UD conversion grammars",
        "module": "grammars",   # a DATA tier: app/grammars.py fetches surfacesyntacticud/tools' converter/grs/
        "note": "UD↔SUD conversion grammars, fetched from surfacesyntacticud/tools (~450 KB)",
    },
    "fa_vocab": {
        "label": "Persian vocalisation lexicon",
        "module": "fa_vocab",   # a DATA tier: app/fa_vocab.py fetches KaamelDict and aligns it onto Persian spelling
        "note": "KaamelDict pronunciations, aligned onto Persian spelling (~10 MB) — needs the Persian model",
    },
    "grew": {
        "label": "grew conversion backend",
        "module": "grew_backend",   # a DATA tier: app/grew_backend.py drives `opam install grewpy_backend`
        "note": "grewpy_backend (OCaml, via opam) — needed for UD import/export, format conversion, "
                "and every Stanza parse",
    },
}

def _stanza_platform_pins() -> list[str]:
    """Extra pip constraints for the ``stanza`` tier, needed only on Intel macOS.

    PyTorch stopped publishing macOS x86_64 wheels after 2.2.2 (confirmed against PyPI: every
    torch>=2.3.0 release ships `macosx_11_0_arm64` only for cp312, no x86_64 build at all), so an
    unconstrained `pip install stanza` on an Intel Mac resolves torch to that final 2.2.2 build —
    which predates NumPy 2.0 (June 2024) and was compiled against the pre-2.0 C-ABI. `stanza`
    itself pins no numpy ceiling, so pip happily pulls the current numpy (2.x) alongside that old
    torch, and the ABI mismatch surfaces at runtime as `RuntimeError: Numpy is not available!` —
    not a missing dependency, an incompatible pair (reported by a user on Catalina/Intel; the OS
    version is incidental, every Intel Mac hits this since there is no newer x86_64 torch wheel to
    resolve to instead). Apple Silicon and Linux/Windows keep getting current torch releases, which
    are numpy-2.x-safe, so this constraint would be a no-op there — scope it to the one platform
    that's actually stuck on old torch.

    ⚠ THIS PIN ALONE DOES NOT FIX THE BUG — it only constrains what lands inside EXTRAS_DIR, and
    `activate()` below appends EXTRAS_DIR to `sys.path` with `site.addsitedir`, i.e. AFTER this
    process's own (CORE) site-packages, which is already on `sys.path` at interpreter start.
    `import numpy` resolves once per process against `sys.path` in order and the result is cached
    in `sys.modules`, so CORE's numpy — unpinned anywhere else, and pulled in transitively by spaCy
    and fasttext-wheel regardless of whether Stanza is ever touched — is what every later
    `import numpy` gets, including one made from inside Stanza's own torch. And CORE's numpy is
    loaded early and unconditionally: `app/langid.py`'s `detect_language` (run on every document
    open) does `import fasttext`, which imports numpy, well before a reader could reach Manage
    Models to install this tier. The pin that actually matters is the identically-scoped one in
    `requirements-core.txt`/`requirements.txt` — see the comment there. This one is kept as a
    defensive backstop (e.g. a `--target` install run against a CORE venv from before that pin
    existed still gets a locally-consistent EXTRAS_DIR, even though it can't win the sys.path race
    against a CORE that's already wrong) rather than because it independently fixes anything.
    """
    if platform.system() == "Darwin" and platform.machine() == "x86_64":
        return ["numpy<2"]
    return []


_activated = False


def activate() -> None:
    """Put :data:`EXTRAS_DIR` on ``sys.path`` so on-demand-installed packages import. Idempotent.
    Uses ``site.addsitedir`` so any ``.pth`` files a native wheel drops are honoured."""
    global _activated
    ensure_dirs()
    if EXTRAS_DIR not in sys.path:
        site.addsitedir(EXTRAS_DIR)
        if EXTRAS_DIR not in sys.path:      # very old site.py without addsitedir side effects
            sys.path.insert(0, EXTRAS_DIR)
    _activated = True


def _data_module(tier: dict):
    """The module backing a DATA tier, or None for an ordinary pip tier."""
    name = tier.get("module")
    if not name:
        return None
    return importlib.import_module("." + name, __package__)


def available(feature: str) -> bool:
    """Is the tier present right now — either bundled in the app or installed into extras?"""
    tier = TIERS.get(feature)
    if not tier:
        return False
    if not _activated:
        activate()
    try:
        mod = _data_module(tier)
        if mod is not None:
            return bool(mod.available())     # a data tier answers for itself
        importlib.import_module(tier["probe"])
        return True
    except Exception:  # noqa: BLE001 — ImportError, or a broken/partial install
        return False


def status() -> list[dict]:
    """One row per tier for the Manage Models UI."""
    return [{"id": k, "label": v["label"], "note": v.get("note", ""),
             "installed": available(k)} for k, v in TIERS.items()]


def install(feature: str, progress=None) -> dict:
    """pip-install a tier INTO :data:`EXTRAS_DIR` (never the bundled site-packages), then
    re-activate so it imports without a relaunch. ``progress(pct, note)`` is called as it runs."""
    tier = TIERS.get(feature)
    if not tier:
        return {"error": f"unknown feature {feature!r}"}
    ensure_dirs()

    def note(pct, msg):
        if progress:
            progress(pct, msg)

    mod = _data_module(tier)
    if mod is not None:
        r = mod.install(progress=progress)      # a data tier fetches and builds its own asset
        # …and a loaded spaCy model may be holding the ABSENCE of that asset. The Latin model's
        # `la_macronise` reads the Morpheus table once, in its own __init__, so a model loaded before
        # the table existed keeps macronising nothing until the process restarts. Dropping the model
        # cache is what makes "install the tier, then parse" work in one session. Cheap: the next
        # parse reloads.
        if r.get("ok"):
            try:
                from . import parse
                parse.invalidate_cache()
            except Exception:  # noqa: BLE001 — spaCy may not even be importable in a trimmed build
                pass
        return r

    note(None, f"Installing {tier['label']}…")
    extra_pins = _stanza_platform_pins() if feature == "stanza" else []
    # --target keeps the extras isolated from the (read-only, in a bundle) core site-packages;
    # --upgrade lets a re-run replace files already present in the shared target.
    cmd = [sys.executable, "-m", "pip", "install", "--no-input", "--upgrade",
           "--target", EXTRAS_DIR, *tier["pip"], *extra_pins]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        return {"error": "pip install failed: " + (exc.stderr or exc.stdout or str(exc))[-800:]}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    activate()
    importlib.invalidate_caches()
    note(100, "Installed")
    if not available(feature):
        return {"ok": True, "id": feature, "warning": "Installed — relaunch to use it."}
    return {"ok": True, "id": feature}
