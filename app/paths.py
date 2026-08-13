"""Application data locations (models, caches) in the OS's own per-user application-data folder.

ONE constant decides all of them.  ``APP_DATA`` is the only place a platform is named; everything
else in the app — :data:`STANZA_DIR`/:data:`CACHE_DIR`/:data:`EXTRAS_DIR` here, ``_STATE_FILE`` in
``app/api.py``, ``FONT_DIR`` in ``app/fonts.py``, ``crash.log`` in ``app/__main__.py`` — derives
from it, so porting to another OS is this branch and nothing else.
"""

from __future__ import annotations

import os
import sys


def _app_data() -> str:
    """The per-user application-support directory, by platform convention.

    Windows: %LOCALAPPDATA% (not %APPDATA%) — everything we keep here is a machine-local CACHE of
    downloadable things (Stanza models, pip'd extras tiers, release listings, fonts) plus a small
    UI state file.  %APPDATA% roams with the user profile on a domain-joined machine, and roaming a
    1 GB torch install across the network is exactly what LOCALAPPDATA exists to prevent.  The
    env var is read rather than hard-coded, then fallen back to the standard path, because a
    non-standard profile location is normal on managed machines."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser(r"~\AppData\Local")
        return os.path.join(base, "SUD Workbench")
    if sys.platform.startswith("linux"):
        # XDG base directory spec: user-specific data files. Same reasoning as LOCALAPPDATA above —
        # everything under APP_DATA is a machine-local cache (Stanza models, pip'd extras tiers,
        # release listings, fonts) plus a small UI state file, which is what $XDG_DATA_HOME (not
        # $XDG_CONFIG_HOME) is for. Read the env var first, then fall back to the spec's default,
        # since a non-standard data home is normal on managed/NixOS-style machines.
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
        return os.path.join(base, "SUD Workbench")
    return os.path.expanduser("~/Library/Application Support/SUD Workbench")


APP_DATA = _app_data()
STANZA_DIR = os.path.join(APP_DATA, "stanza_resources")   # stanza model_dir
CACHE_DIR = os.path.join(APP_DATA, "cache")               # e.g. cached release listings
EXTRAS_DIR = os.path.join(APP_DATA, "site-packages")      # on-demand heavy deps (torch/Stanza/JP/Arabic), added to sys.path at startup

# The UD<->SUD conversion grammars (app/grammars.py fetches them; see that module's header for
# why they're fetched rather than vendored). `SUD_GRAMMARS_DIR` is Nix's own escape hatch: a Nix
# build fetches the grammars HERMETICALLY, at the user's own `nix build`/`nix-build` time, into an
# immutable Nix-store path (see default.nix), and its generated launcher sets this variable so the
# app uses that pre-fetched copy directly instead of trying to fetch (and write) into APP_DATA —
# which would be redundant on Nix and, worse, would attempt to `os.makedirs`/write under a
# read-only store path below. Every OTHER platform fetches on demand from inside the app itself
# (Manage Models), the same as the `la_macron`/Stanza/Japanese/Arabic tiers, so this env var is
# unset there and GRAMMARS_DIR is just another APP_DATA subdirectory like STANZA_DIR/EXTRAS_DIR.
GRAMMARS_DIR = os.environ.get("SUD_GRAMMARS_DIR") or os.path.join(APP_DATA, "grammars")

# The Persian vocalisation lexicon (app/fa_vocab.py fetches it from KaamelDict; see that module's
# header for why it's fetched rather than vendored — same GPL-restricts-distribution reasoning
# GRAMMARS_DIR's own comment gives). No Nix escape hatch: unlike the grammars, nothing hermetically
# pre-fetches this one yet, so it is always just another APP_DATA subdirectory.
FA_VOCAB_DIR = os.path.join(APP_DATA, "fa_vocab")


def ensure_dirs() -> None:
    os.makedirs(STANZA_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(EXTRAS_DIR, exist_ok=True)
    if not os.environ.get("SUD_GRAMMARS_DIR"):   # a Nix build supplies its own — never create/touch it
        os.makedirs(GRAMMARS_DIR, exist_ok=True)
    os.makedirs(FA_VOCAB_DIR, exist_ok=True)
