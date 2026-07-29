"""On-demand heavy dependencies.

The portable app ships a light CORE (spaCy CNN parsing + the transliteration engines that
need no PyTorch). The heavy, optional stacks are installed on demand into a user-writable
:data:`EXTRAS_DIR` that is added to ``sys.path`` at startup — so a frozen/portable bundle can
grow when a feature is first used, without being rebuilt, mirroring how the models already
download into Application Support.

Tiers (each behind a lazy ``try: import`` in ``translit`` / ``parse``):
  * ``stanza``   — Stanza UD parsers (pulls torch + transformers), ~1.1 GB
  * ``japanese`` — cutlet/fugashi/unidic-lite romanisation dictionaries, ~0.45 GB
  * ``arabic``   — CAMeL Tools Arabic morphology, ~0.3 GB
"""

from __future__ import annotations

import importlib
import site
import subprocess
import sys

from .paths import EXTRAS_DIR, ensure_dirs

# feature key → install spec. ``pip`` requirements pull their own heavy deps (torch, transformers,
# unidic dictionaries…); ``probe`` is the module whose importability means the tier is present.
TIERS: dict[str, dict] = {
    "stanza": {
        "label": "UD parsing (Stanza)",
        "pip": ["stanza", "spacy-stanza"],
        "probe": "stanza",
        "note": "Stanza UD parsers + PyTorch (~1.1 GB)",
    },
    "japanese": {
        "label": "Japanese romaji",
        "pip": ["janome", "pykakasi", "cutlet", "fugashi", "unidic-lite"],
        "probe": "cutlet",
        "note": "Japanese romanisation dictionaries (~0.45 GB)",
    },
    "arabic": {
        "label": "Arabic transliteration",
        "pip": ["camel-tools"],
        "probe": "camel_tools",
        "note": "CAMeL Tools Arabic morphology (~0.3 GB)",
    },
}

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


def available(feature: str) -> bool:
    """Is the tier importable right now — either bundled in the app or installed into extras?"""
    tier = TIERS.get(feature)
    if not tier:
        return False
    if not _activated:
        activate()
    try:
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

    note(None, f"Installing {tier['label']}…")
    # --target keeps the extras isolated from the (read-only, in a bundle) core site-packages;
    # --upgrade lets a re-run replace files already present in the shared target.
    cmd = [sys.executable, "-m", "pip", "install", "--no-input", "--upgrade",
           "--target", EXTRAS_DIR, *tier["pip"]]
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
