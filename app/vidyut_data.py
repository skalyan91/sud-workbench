"""Vidyut's Sanskrit lexicon (``kosha``) — the side data ``sa_sud_vedic_ufal_dcs`` reads at
inference, fetched on demand rather than shipped.

WHY THERE IS A TIER HERE AT ALL, WHEN THE WHEEL ALREADY DECLARES ``vidyut``
--------------------------------------------------------------------------
From 0.2.0 the Sanskrit wheel's ``Requires-Dist`` names ``vidyut>=0.4.0`` beside
``indic-transliteration``, so the PIP half is already automatic: ``models_registry.download``
installs a model with ``--no-deps`` (or a re-resolved spaCy would shadow the core venv's — see
``_unsatisfied_requirements``) and then honours the wheel's own declaration itself. The pip half is
therefore this module's FALLBACK, not its reason to exist.

Its reason is the DATA. ``sud.AnalyserFeatsEmbed.v1`` — the model's tok2vec embedding layer — runs
in ``runtime = true`` mode in the shipped config: instead of carrying a frozen extract of the
analyser (whose key set is whatever vocabulary happened to be probed, missing 6.5 % of Vedic
tokens), it asks ``vidyut.kosha`` per token for the SET of morphological analyses a form can have.
That data bundle is ~32 MB compressed / ~81 MB on disk, upstream deliberately does not redistribute
it (``vidyut`` ships the code and offers ``vidyut.download_data(path)``), and there is no PyPI
package carrying it. Same shape as :mod:`app.macron`'s Morpheus table and :mod:`app.fa_vocab`'s
KaamelDict lexicon, and the same answer: fetch it onto the user's own machine, as the ``module``
tier shape in :mod:`app.extras` exists for.

⚠ THE MODEL REFUSES TO PARSE WITHOUT IT — it does not degrade. ``get_kosha`` raises rather than
falling back, and says why in its own words: "without it every token reads 'silent' and the model
quietly parses worse instead of failing". So "Sanskrit model installed, data absent" is not a soft
state to leave a reader in, which is why :func:`app.models_registry.download` installs this tier as
part of installing any model that declares ``vidyut`` — the same courtesy the Stanza branch there
already does for the Stanza LIBRARY, and for the same reason (a model with no engine behind it
installs perfectly and then does nothing).

⚠ AND ``VIDYUT_DATA`` HAS TO BE EXPORTED, OR A CORRECT FETCH IS FOUND ONLY BY ACCIDENT. The model
resolves its data as ``$VIDYUT_DATA`` else the literal ``"vidyut-data/kosha"`` — a path relative to
the process's CWD, which for a GUI app launched by LaunchServices/Explorer is arbitrary (``/`` on
macOS). :func:`activate` exports the variable, and ``extras.activate()`` calls it — the same
process-wide "make the on-demand things reachable" step that puts ``EXTRAS_DIR`` on ``sys.path``,
run at startup and again at the top of a model download. A variable the USER already set is left
exactly as it is: someone pointing at their own ``vidyut-data`` (a checkout, a shared volume) has
answered this question already, and :func:`available` then reports on THEIR copy.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

from .paths import CACHE_DIR, EXTRAS_DIR, VIDYUT_DIR, ensure_dirs

# The release asset is VERSION-MATCHED to the bindings — `vidyut.download_data` hard-codes exactly
# this URL with its own version in both places — so the URL is derived from the INSTALLED
# `vidyut.__version__` rather than pinned here. The kosha is an FST plus a msgpack registry whose
# layout is the Rust crate's internal business, not a stable interchange format; pinning a version
# of our own would be inventing a second opinion about which data goes with which engine.
_DATA_URL = "https://github.com/ambuda-org/vidyut/releases/download/py-{v}/data-{v}.zip"
_SENTINEL = ".sud-vidyut-version"   # records which release built what's on disk — the same "detect a
                                    # stale or partial fetch rather than assume" role app/grammars.py's
                                    # own sentinel plays, and what makes a vidyut UPGRADE re-fetch
# The two files `vidyut.kosha.Kosha` actually opens. Tested by name (and for non-emptiness) rather
# than by testing the DIRECTORY, which a half-finished extract also satisfies.
_KOSHA_FILES = ("padas.fst", "registry.msgpack")


def kosha_dir() -> str:
    """Where the model should look: ``$VIDYUT_DATA`` if the user set one, else our own fetch.

    Note the level — the model's own default is ``vidyut-data/kosha``, i.e. the variable names the
    KOSHA directory, not the bundle root that ``download_data`` extracts into."""
    return os.environ.get("VIDYUT_DATA") or os.path.join(VIDYUT_DIR, "kosha")


def _kosha_ok(path: str) -> bool:
    try:
        return all(os.path.getsize(os.path.join(path, f)) > 0 for f in _KOSHA_FILES)
    except OSError:
        return False


def _have_vidyut() -> bool:
    """Is the ``vidyut`` package importable — asked with ``find_spec``, which does not import it.

    Manage Models re-renders this row on every open, and importing vidyut means loading an 8 MB
    Rust extension for a question that is only about the package being present."""
    try:
        from . import extras
        extras.activate()               # EXTRAS_DIR on sys.path — where a tier's pip installs land
        importlib.invalidate_caches()   # …and it may have been written since this process started
        return importlib.util.find_spec("vidyut") is not None
    except Exception:  # noqa: BLE001 — a broken/partial install answers "no", never raises
        return False


def activate() -> None:
    """Export ``VIDYUT_DATA`` for the model, if it isn't set already and we have data to point at.

    Idempotent and cheap (two `os.path.getsize` calls), which is what lets ``extras.activate()``
    call it unconditionally. Deliberately NOT set when the data is absent: a variable naming a
    directory that isn't there would replace the model's own honest "vidyut data not found at …"
    with the same message about a path the reader never chose."""
    if os.environ.get("VIDYUT_DATA"):
        return                                   # the reader's own copy — see the ⚠ in the header
    ours = os.path.join(VIDYUT_DIR, "kosha")
    if _kosha_ok(ours):
        os.environ["VIDYUT_DATA"] = ours


# ── the extras-tier contract (app/extras.py's ``module`` shape: available/install/status) ────────
def available() -> bool:
    """Can a Sanskrit parse actually run here — the ENGINE (`vidyut`) and the DATA (the kosha)?

    Both, because the model needs both and this tier's install supplies both; reporting on one
    alone would show "Installed ✓" beside a model that still raises on the first sentence."""
    return _have_vidyut() and _kosha_ok(kosha_dir())


def _declared_spec() -> str:
    """The ``vidyut`` requirement an installed SUD model actually declares, else a bare ``vidyut``.

    Taken from the model rather than pinned here so the two cannot drift: the wheel is what knows
    which vidyut its embedding layer was trained against, and this module is only the installer."""
    try:
        import importlib.metadata as md
        from packaging.requirements import InvalidRequirement, Requirement
    except ImportError:
        return "vidyut"
    for dist in md.distributions():
        name = (dist.metadata["Name"] or "")
        if "_sud_" not in name:
            continue
        for spec in dist.requires or []:
            try:
                req = Requirement(spec)
            except InvalidRequirement:
                continue
            if req.name.lower() == "vidyut":
                return spec
    return "vidyut"


def _install_package(note) -> dict:
    """pip-install ``vidyut`` into :data:`EXTRAS_DIR`, unless it is already importable.

    Normally a no-op: the Sanskrit wheel declares vidyut and ``models_registry.download`` installs
    what it declares. This is the path for a machine that got the model some other way (a developer's
    own ``pip install``, an install predating that declaration) and for the Manage Models row being
    pressed on its own."""
    if _have_vidyut():
        return {"ok": True}
    note(4, "Installing vidyut…")
    cmd = [sys.executable, "-m", "pip", "install", "--no-input", "--upgrade",
           "--target", EXTRAS_DIR, _declared_spec()]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        return {"error": "pip install vidyut failed: " + (exc.stderr or exc.stdout or str(exc))[-400:]}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not install vidyut: {exc}"}
    from . import extras
    extras.activate()               # …so the import below resolves the copy just written
    importlib.invalidate_caches()
    if not _have_vidyut():
        return {"error": "vidyut installed but is not importable — relaunch and try again"}
    return {"ok": True}


def _version() -> str:
    """The installed ``vidyut.__version__``, which names the data release to fetch."""
    import vidyut
    return str(getattr(vidyut, "__version__", "") or "")


def install(progress=None) -> dict:
    """Install ``vidyut`` if it is missing, then fetch its linguistic data into :data:`VIDYUT_DIR`.
    ``progress(pct, note)``, the same shape as every tier's."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    ensure_dirs()
    r = _install_package(note)
    if r.get("error"):
        return r
    try:
        version = _version()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"vidyut is installed but would not load: {exc}"}
    if not version:
        return {"error": "vidyut reports no version, so its matching data release is unknown"}

    if _kosha_ok(kosha_dir()) and _on_disk_version() == version:
        activate()
        note(100, "Installed")
        return {"ok": True, "version": version, "path": kosha_dir(), "unchanged": True}

    url = _DATA_URL.format(v=version)
    note(6, "Downloading the Sanskrit lexicon…")
    tmp_zip = os.path.join(CACHE_DIR, f"vidyut-data-{version}.zip")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_zip, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                note(6 + int(done * 64 / total) if total else None, "Downloading the Sanskrit lexicon…")
    except Exception as exc:  # noqa: BLE001 — offline, or upstream moved the asset naming
        # UPSTREAM'S OWN FETCHER IS THE FALLBACK, not the first choice. `vidyut.download_data` knows
        # the authoritative URL (it is where the scheme above was read from) but reads the whole
        # archive into memory with no progress hook at all, which is a poor thing to sit behind for
        # 32 MB. So: our own fetch while the naming holds, upstream's the moment it doesn't.
        _rm(tmp_zip)
        note(None, "Downloading the Sanskrit lexicon…")
        try:
            import vidyut
            vidyut.download_data(VIDYUT_DIR)
        except Exception as exc2:  # noqa: BLE001
            return {"error": f"could not download vidyut's data: {exc} (and {exc2})"}
        return _finish(version, note)

    note(72, "Extracting…")
    tmp_dir = VIDYUT_DIR + ".partial"
    try:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        os.makedirs(tmp_dir, exist_ok=True)
        with zipfile.ZipFile(tmp_zip) as z:
            for m in z.namelist():
                # Zip slip: an absolute or ``..``-bearing member would extract outside tmp_dir. The
                # archive is upstream's own and has never carried one; refusing rather than trusting
                # costs one comparison per member.
                dest = os.path.realpath(os.path.join(tmp_dir, m))
                if not (dest == os.path.realpath(tmp_dir)
                        or dest.startswith(os.path.realpath(tmp_dir) + os.sep)):
                    return {"error": f"the vidyut data archive holds an unsafe path ({m!r})"}
            z.extractall(tmp_dir)
        if not _kosha_ok(os.path.join(tmp_dir, "kosha")):
            return {"error": "the fetched archive carried no usable kosha — "
                             "upstream's data layout may have changed since this was written"}
    except Exception as exc:  # noqa: BLE001 — a truncated download, a corrupt zip, a full disk
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"error": f"could not extract vidyut's data: {exc}"}
    finally:
        _rm(tmp_zip)

    note(94, "Finishing up…")
    # Atomic swap, exactly as app/grammars.py does: a failed fetch never leaves a half-written
    # VIDYUT_DIR for `available()` to read as present. `VIDYUT_DIR` itself is created by
    # `ensure_dirs`, so it exists and empty — replacing a directory needs it gone first on Windows.
    shutil.rmtree(VIDYUT_DIR, ignore_errors=True)
    os.replace(tmp_dir, VIDYUT_DIR)
    return _finish(version, note)


def _finish(version: str, note) -> dict:
    with open(os.path.join(VIDYUT_DIR, _SENTINEL), "w", encoding="utf-8") as f:
        f.write(version)
    activate()
    if not available():
        return {"error": "the fetched data held no usable Sanskrit lexicon"}
    note(100, "Installed")
    return {"ok": True, "version": version, "path": kosha_dir()}


def _on_disk_version() -> str:
    try:
        with open(os.path.join(VIDYUT_DIR, _SENTINEL), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _rm(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def status() -> dict:
    """One row for the Manage Models UI (``extras.status`` builds its own from TIERS; this is the
    module-side answer the ``module`` tier contract asks for)."""
    return {"id": "vidyut", "label": "Sanskrit lexicon (vidyut)",
            "note": "vidyut's morphological lexicon, fetched from ambuda-org/vidyut (~32 MB "
                    "download, ~81 MB on disk) — needed by the Sanskrit model",
            "installed": available(), "version": _on_disk_version(), "path": kosha_dir()}
