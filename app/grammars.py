"""The UD <-> SUD (and mSUD) conversion grammars — grew ``.grs`` graph rewrite rules that
``app/convert.py`` runs, and the POS/relation constraints ``app/sud_rules.py`` reads.

WHERE THIS COMES FROM, AND WHY IT IS FETCHED RATHER THAN SHIPPED
------------------------------------------------------------------
The whole ``converter/grs/`` subtree of https://github.com/surfacesyntacticud/tools, pinned to
commit :data:`_REV` (the same commit ``THIRD-PARTY-NOTICES.md`` used to record when this content
was vendored). Neither that repository nor its files declare a licence, so bundling a copy inside
this app's own source tree or any of its built packages would be republishing someone else's work
without a grant to do so — exactly the reasoning ``app/macron.py``'s header gives for the same
shape of problem with the Latin macron data, and the same answer applies: fetching is not
redistribution, only shipping a copy would be, so this module downloads the pinned revision onto
the *user's own machine* the first time a conversion is attempted (or the tier is installed from
Manage Models), the same as any other on-demand extras tier — see ``app/extras.py``'s own
docstring on the ``module`` tier shape this follows.

An earlier state of this repository vendored the grammars directly under a committed ``grammars/``
directory. That is exactly the problem this module exists to undo — see git history on this
change and ``THIRD-PARTY-NOTICES.md`` for the account of why.

TWO SEPARATE UPSTREAM SUBTREES, NOT ONE
----------------------------------------
``converter/grs/`` (the ``.grs`` grammars, plus ``utils/``/``lexicons/`` as siblings — the ``.grs``
files ``include "utils/…"`` and reference ``lexicons/…`` by a path relative to their OWN location,
so those two have to land alongside them, not be cherry-picked out) lands at :data:`GRAMMARS_DIR`'s
own root. ``validator/modules/`` (what ``app/sud_rules.py`` reads) is a DIFFERENT top-level
directory upstream — not nested under ``converter/grs/`` at all, confirmed against the upstream
tree at the pinned commit rather than assumed from the old vendored layout's own directory names —
and lands at ``GRAMMARS_DIR/validator/modules/``, matching where the old vendored copy had it.
Only ``modules/`` under ``validator/`` is fetched (not ``validator/html/``, its ``Makefile``, or its
own top-level ``sud_*.json`` files) — that matches exactly what the old vendored copy carried;
nothing here reads the rest. Total footprint: ~450 KB, 61 files, matching the old vendored copy's.

DEGRADING
---------
:func:`available` answers false until a fetch has completed; every caller in ``app/convert.py``
already treats a missing grammar file as ``ConversionUnavailable`` (raised, not crashed) and
``app/sud_rules.py`` already treats a missing/unreadable ``relations.json`` as "no constraints"
(permissive) rather than an error — this module changes WHERE those two look, not how either
degrades when what they're looking for isn't there yet.
"""

from __future__ import annotations

import io
import os
import shutil
import tarfile
import urllib.request

from .paths import GRAMMARS_DIR, ensure_dirs

_REPO = "surfacesyntacticud/tools"
_REV = "03c3bbd88e33a0f6331b58d0669edf1031aa9efb"   # pinned — see THIRD-PARTY-NOTICES.md
_TARBALL_URL = f"https://github.com/{_REPO}/archive/{_REV}.tar.gz"
# upstream subtree → where it lands under GRAMMARS_DIR ("" = GRAMMARS_DIR's own root). See the file
# header's "TWO SEPARATE UPSTREAM SUBTREES" note for why these two, and only these two.
_SUBPATHS = {
    "converter/grs": "",
    "validator/modules": "validator/modules",
}
_SENTINEL = ".sud-grammars-rev"   # records which revision is on disk, so a stale partial fetch (or a
                                  # future re-pin to a newer upstream commit) is detected, not assumed


def available() -> bool:
    """The pinned revision is fully fetched and on disk — never raises. A Nix build's own
    SUD_GRAMMARS_DIR (see app/paths.py) is judged the same way: present with the matching sentinel,
    or not — Nix writes that sentinel itself (see default.nix) so this check is uniform either way."""
    try:
        with open(os.path.join(GRAMMARS_DIR, _SENTINEL), encoding="utf-8") as f:
            return f.read().strip() == _REV
    except OSError:
        return False


def install(progress=None) -> dict:
    """Download the pinned surfacesyntacticud/tools revision and unpack its converter/grs/
    subtree into :data:`GRAMMARS_DIR`. ``progress(pct, note)``, the same shape as every tier's.

    Never touches GRAMMARS_DIR on a Nix build (SUD_GRAMMARS_DIR set): that copy was fetched
    hermetically at build time and is a read-only store path — installing over it would fail
    (and shouldn't be attempted; the Manage Models row for this tier reports it already installed
    on Nix, so a user should never reach this function there in practice)."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    if os.environ.get("SUD_GRAMMARS_DIR"):
        return {"error": "grammars are provided by this build (Nix) and can't be re-fetched here"}

    ensure_dirs()
    note(2, "Downloading conversion grammars…")
    try:
        req = urllib.request.Request(_TARBALL_URL, headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
    except Exception as exc:  # noqa: BLE001 — offline, rate-limited, or the tag/commit moved
        return {"error": f"could not download the conversion grammars: {exc}"}

    note(50, "Extracting…")
    tmp = GRAMMARS_DIR + ".partial"
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            names = tf.getnames()
            # GitHub's codeload tarball wraps everything in one top-level "<owner>-<repo>-<short-
            # sha>/" directory; discovered rather than hard-coded, since GitHub picks the SHA's
            # abbreviation length itself and that's not a contract to depend on.
            root = names[0].split("/", 1)[0] if names else ""
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp, exist_ok=True)
            for upstream_sub, local_sub in _SUBPATHS.items():
                prefix = f"{root}/{upstream_sub}/"
                members = [m for m in tf.getmembers() if m.name.startswith(prefix) and m.name != prefix]
                if not members:
                    return {"error": f"the fetched archive had no {upstream_sub}/ — "
                                      "upstream's layout may have changed since this was pinned"}
                for m in members:
                    m.name = os.path.join(local_sub, m.name[len(prefix):]) if local_sub else m.name[len(prefix):]
                    tf.extract(m, tmp)
    except Exception as exc:  # noqa: BLE001 — a corrupt download, a symlink escape tarfile itself rejects, …
        shutil.rmtree(tmp, ignore_errors=True)
        return {"error": f"could not extract the conversion grammars: {exc}"}

    note(90, "Finishing up…")
    shutil.rmtree(GRAMMARS_DIR, ignore_errors=True)
    os.replace(tmp, GRAMMARS_DIR)   # atomic swap — a failed fetch never leaves a half-written GRAMMARS_DIR
    with open(os.path.join(GRAMMARS_DIR, _SENTINEL), "w", encoding="utf-8") as f:
        f.write(_REV)

    # No cache to invalidate here, unlike app/macron.py's install(): convert.py's _GRS_CACHE only
    # ever remembers a SUCCESSFUL grammar load (a miss raises, never caches), and its available()
    # re-checks the filesystem on every call — so the very next conversion attempt or availability
    # probe already sees what was just fetched, with nothing to reset.
    note(100, "Installed")
    return {"ok": True, "rev": _REV}


def status() -> dict:
    """One row for the Manage Models UI (extras.status() builds its own from TIERS; this is the
    module-side answer the ``module`` tier contract asks for)."""
    return {"id": "grammars", "label": "UD conversion grammars",
            "note": "surfacesyntacticud/tools UD↔SUD grammars, fetched on demand (~450 KB)",
            "installed": available()}
