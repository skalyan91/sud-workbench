"""Application data locations (models, caches) under macOS Application Support."""

from __future__ import annotations

import os

APP_DATA = os.path.expanduser("~/Library/Application Support/SUD Workbench")
STANZA_DIR = os.path.join(APP_DATA, "stanza_resources")   # stanza model_dir
CACHE_DIR = os.path.join(APP_DATA, "cache")               # e.g. cached release listings
EXTRAS_DIR = os.path.join(APP_DATA, "site-packages")      # on-demand heavy deps (torch/Stanza/JP/Arabic), added to sys.path at startup


def ensure_dirs() -> None:
    os.makedirs(STANZA_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(EXTRAS_DIR, exist_ok=True)
