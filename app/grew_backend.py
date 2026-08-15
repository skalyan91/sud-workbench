"""``grewpy_backend`` — the OCaml process ``grewpy`` spawns to run grew rewrites, fetched (via
opam) onto the end user's own machine rather than bundled into any build of this app.

WHY FETCHED, AND WHY OPAM RATHER THAN A DOWNLOAD
--------------------------------------------------
``grewpy_backend`` is CeCILL v2.1 licensed — a GPL-family copyleft licence that restricts
DISTRIBUTION, not use, the same shape of problem :mod:`app.grammars` and :mod:`app.macron` already
solve for their own optional heavy pieces (see either module's own header). The same answer applies
here: this app does not ship a copy, in this repository or in any build it produces; instead this
module fetches it the first time it is needed, or when the "grew conversion backend" row is
installed from Manage Models.

Where this module genuinely differs from :mod:`app.grammars`/:mod:`app.macron` is HOW it fetches.
Those two are flat data — a tarball/table pulled straight off a URL, no build step, landing directly
under :data:`app.paths.APP_DATA`. ``grewpy_backend`` is not a flat artifact: it has no PyPI wheel
(confirmed: PyPI carries no ``grewpy_backend``/``grewpy-backend`` distribution at all) and no
plain downloadable binary upstream publishes — the ONLY channel upstream offers is source, built and
installed through opam, OCaml's own package manager (``opam remote add grew https://opam.grew.fr &&
opam install grewpy_backend`` — this was already this app's own documented self-install path, see
README.md and the warnings in ``web/js/io/models.js``/``app/parse.py`` before this module existed).
So :func:`install` below drives THAT — bootstrapping opam itself if needed, adding grew's remote,
then ``opam install grewpy_backend`` — rather than downloading anything itself. opam puts the result
under ``~/.opam/<switch>/bin``, which is already a per-user location outside this app's own bundle;
this module does not copy it anywhere else afterwards; :func:`app.convert.find_grewpy_backend` (née
``_ensure_backend_on_path``) is what already knows to look there.

⚠ THIS CAN BE SLOW, GENUINELY SLOWER THAN ANY OTHER TIER. A machine with no opam root yet pays for
``opam init`` (bootstrapping a whole OCaml switch) before ``opam install`` even starts — this can run
into the tens of minutes on a slow connection, dwarfing even the Stanza tier's ~1.1 GB pip install.
That cost is inherent to what "install grew" means on a machine that never had OCaml on it; there is
no shortcut available to fetch instead.

DEGRADING
---------
:func:`available` answers false until opam has actually produced a ``grewpy_backend`` binary on
disk; every caller in ``app/convert.py`` already treats a missing backend as ``ConversionUnavailable``
(raised, not crashed) — this module changes WHERE that binary might come from, not how the caller
copes when it isn't there yet. A machine with no opam at all gets a clear, actionable error from
:func:`install` rather than a failed subprocess spawn with no explanation.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess

_PACKAGE = "grewpy_backend"
_OPAM_REMOTE_NAME = "grew"
_OPAM_REMOTE_URL = "https://opam.grew.fr"
_INSTALL_TIMEOUT = 1800   # seconds — opam init + a from-source OCaml build can genuinely take this long


def _opam_bin() -> str:
    """The ``opam`` executable, or "". ``shutil.which`` first (an ordinary shell PATH), then the two
    Homebrew prefixes directly: a Finder-launched GUI app gets a stripped-down PATH (the same reason
    ``make_bootstrap_app.sh``'s own launcher prepends these two dirs before exec'ing the app), so
    opam is very often NOT on ``which``'s view even when ``brew install opam`` put it somewhere
    completely standard."""
    found = shutil.which("opam")
    if found:
        return found
    for cand in ("/opt/homebrew/bin/opam", "/usr/local/bin/opam"):
        if os.path.isfile(cand):
            return cand
    return ""


def find_backend() -> str:
    """The directory holding a ``grewpy_backend`` opam has already installed, or "". Every switch
    under ``~/.opam`` is checked, not just the default one — mirrors ``app/convert.py``'s own glob."""
    for d in glob.glob(os.path.expanduser("~/.opam/*/bin")):
        if os.path.isfile(os.path.join(d, _PACKAGE)):
            return d
    return ""


def available() -> bool:
    """Is ``grewpy_backend`` runnable right now — on PATH, or under some opam switch? Never raises."""
    return bool(shutil.which(_PACKAGE) or find_backend())


def _run(cmd: list[str]) -> None:
    """Run one opam step. Raises RuntimeError with opam's own tail of output on failure — never lets
    a CalledProcessError/TimeoutExpired escape, so :func:`install` has one place to catch."""
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=_INSTALL_TIMEOUT)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or exc.stdout or str(exc)).strip()[-800:]) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"timed out after {_INSTALL_TIMEOUT}s running: {' '.join(cmd)}") from exc


def install(progress=None) -> dict:
    """Bootstrap opam (if needed), add grew's own opam remote (if not already added), then
    ``opam install grewpy_backend``. ``progress(pct, note)``, the same shape as every tier's.

    Never touches anything under this app's own APP_DATA — unlike the flat-file tiers, there is
    nothing here for this app to own; opam manages its own install root, and this function only
    drives opam's CLI."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    opam = _opam_bin()
    if not opam:
        return {"error": "grew needs opam (OCaml's package manager), which isn't installed here. "
                          "Install it yourself, then retry: brew install opam"}

    try:
        # `opam init` is what creates ~/.opam at all — skipped when a root already exists, since
        # re-running it against an existing root is both slow and unnecessary. `-y` answers every
        # prompt non-interactively (this runs on a background thread with no terminal attached);
        # `--disable-sandboxing` avoids opam's bwrap/sandbox-exec setup, which some app sandboxes
        # (this one included — pywebview's own) cannot spawn from.
        if not os.path.isdir(os.path.expanduser("~/.opam")):
            note(5, "Setting up opam (first time only — this can take a while)…")
            _run([opam, "init", "-y", "--disable-sandboxing"])

        note(20, "Adding grew's opam repository…")
        existing = subprocess.run([opam, "remote", "list", "-s"], capture_output=True, text=True,
                                   timeout=60).stdout
        if _OPAM_REMOTE_NAME not in existing.split():
            _run([opam, "remote", "add", _OPAM_REMOTE_NAME, _OPAM_REMOTE_URL])

        note(30, "Installing grewpy_backend (this can take several minutes)…")
        _run([opam, "install", "-y", _PACKAGE])
    except RuntimeError as exc:
        return {"error": f"opam install failed: {exc}"}

    if not available():
        return {"error": "opam reported success but grewpy_backend still isn't on ~/.opam/*/bin — "
                          "try `opam install grewpy_backend` yourself for the full log"}
    note(100, "Installed")
    return {"ok": True, "path": find_backend()}


def status() -> dict:
    """One row for the Manage Models UI (``extras.status`` builds its own from TIERS; this is the
    module-side answer the ``module`` tier contract asks for)."""
    return {"id": "grew", "label": "grew conversion backend",
            "note": "grewpy_backend (OCaml, via opam) — needed for UD import/export, format "
                    "conversion, and every Stanza parse",
            "installed": available()}
