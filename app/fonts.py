"""On-demand Noto script fonts.

The app bundles only the CORE Noto Sans faces — Noto Sans (regular + italic) and Noto Sans Mono,
between them ~5 MB and covering Latin/Greek/Cyrillic, which is what the interface itself renders in.
Every OTHER script's face is fetched the first time a document actually needs it, and only when the
machine has no font for that script already: macOS ships coverage for a good many of them (Devanagari
Sangam MN, Thonburi, Kailasa, the PingFang/Hiragino CJK families, …), and the web side checks for that
before ever asking us — see fontload.js. Bundling the full set instead cost 44 MB, better than nine
tenths of the whole download.

Fetched from the Google Fonts CSS API rather than the GitHub OFL mirror: the API answers with a woff2
(roughly half the size of the .ttf the mirror serves) and, crucially, it resolves a family NAME to a
file, so we need no table of the axis-suffixed filenames the mirror uses. Cached under Application
Support and never re-fetched. All Noto is SIL Open Font License 1.1.
"""

from __future__ import annotations

import base64
import os
import re
import tempfile
import urllib.parse
import urllib.request

from .paths import APP_DATA

FONT_DIR = os.path.join(APP_DATA, "fonts")
CSS_API = "https://fonts.googleapis.com/css2?family={fam}:wght@100..900"
CSS_API_STATIC = "https://fonts.googleapis.com/css2?family={fam}"   # families with no weight axis 400-only
# A browser UA is what makes the API answer with woff2; the default urllib one gets ttf (or nothing).
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
       "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
_SRC_RE = re.compile(r"src:\s*url\(([^)]+)\)")


def _slug(family: str) -> str:
    """"Noto Sans Canadian Aboriginal" → "notosanscanadianaboriginal" — the vendored naming."""
    return re.sub(r"[^a-z0-9]", "", family.lower())


def _get(url: str, timeout: int = 20, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers if headers is not None else {"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def cached_path(family: str) -> str | None:
    """The already-downloaded file for `family`, or None."""
    for ext in ("woff2", "ttf"):
        p = os.path.join(FONT_DIR, _slug(family) + "." + ext)
        if os.path.exists(p) and os.path.getsize(p) > 1024:
            return p
    return None


def _fetch_and_cache(family: str, path_finder, cache_ext: str, ua: dict) -> tuple[str | None, bool, str]:
    """Shared fetch-and-cache dance behind both fetch() and fetch_raw(): find `family` already on
    disk under `path_finder`, or ask the Google Fonts CSS API for it — with whichever request
    headers `ua` supplies, since that (not the family name) is what decides which file format the
    API answers with (see fetch()'s and fetch_raw()'s own notes). Returns (path, cached, error);
    `path` is None only on total failure. Cached under `cache_ext` — a SEPARATE suffix per caller,
    since fetch() and fetch_raw() deliberately want DIFFERENT formats for the SAME family and must
    not silently hand each other's cached file back (fetch()'s woff2 is exactly the file HarfBuzz's
    WASM build cannot decompress — see fetch_raw()'s own note)."""
    os.makedirs(FONT_DIR, exist_ok=True)
    path = path_finder(family)
    if path:
        return path, True, ""
    fam = urllib.parse.quote(family.replace(" ", "+"), safe="+")
    data, url, err = b"", "", "unavailable"
    for tmpl in (CSS_API, CSS_API_STATIC):
        try:
            css = _get(tmpl.format(fam=fam), headers=ua).decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001 — offline, blocked, or no such family
            err = str(exc)
            continue
        m = _SRC_RE.search(css)
        if not m:
            err = "no font file in the API response"
            continue
        url = m.group(1).strip("'\"")
        try:
            data = _get(url, timeout=60, headers=ua)
        except Exception as exc:  # noqa: BLE001
            err = str(exc)
            continue
        break
    if not data:
        return None, False, f"could not fetch {family}: {err}"
    path = os.path.join(FONT_DIR, _slug(family) + "." + cache_ext)
    # ⚠ THE TEMP NAME MUST BE UNIQUE PER CALL, not per family — pywebview dispatches each bridge call
    # (window.pywebview.api.font_face/font_face_raw) onto its OWN thread (the same "unserialized bridge
    # threads" fact _dialog_lock, app/api.py, already exists to work around for create_file_dialog), and
    # the JS side's own per-family Promise cache (js/lang/smp-shape.js's _fontBytesCache) only dedupes
    # calls made from the SAME render pass — a font requested again from a LATER render (a script switch
    # mid-fetch, a re-render firing before the first fetch lands) reaches this function as a genuinely
    # SEPARATE call, on a genuinely separate thread, with no JS-side memory of the one still in flight.
    # Two such calls racing on the OLD fixed `path + ".part"` name both `open(tmp,"wb")` the SAME path —
    # each truncates it, and whichever thread's write() calls land last wins, however that interleaves —
    # so the file that then survives os.replace() can be an interleaved MIX of two different downloads,
    # not either complete file: NOT a torn write os.replace()'s own atomicity can prevent (the tmp file
    # itself is already corrupt by the time replace() runs), and not a case cached_path()'s size-only
    # sanity check ever catches (a merged file this size is still well over the 1024-byte floor). Once
    # written, this cache is checked before ever fetching again — see path_finder() above — so a single
    # unlucky race corrupts a family's cache PERMANENTLY, for every later call, until someone clears it by
    # hand: measured live as exactly this — a script rendered correctly, then silently started showing
    # tofu after enough switching to hit the race, and never recovered on its own. tempfile.mkstemp(),
    # not a hand-rolled suffix (pid, a counter, …): it's the one call in the standard library whose whole
    # contract is "atomically create a file whose name no other call — in this process or any other — can
    # already be using", via O_EXCL under the hood, so two threads can never even momentarily collide on
    # the same tmp path the way a merely-probably-unique suffix could. Concurrent fetches for the same
    # family therefore always write to genuinely DIFFERENT files; os.replace() is still what makes the
    # FINAL rename atomic, so whichever finishes last simply wins outright, complete either way.
    fd, tmp = tempfile.mkstemp(dir=FONT_DIR, prefix=os.path.basename(path) + ".")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    finally:
        try:
            os.remove(tmp)   # only present if os.replace() itself failed (e.g. cross-device) — the success path already moved it
        except OSError:
            pass
    return path, False, ""


def fetch(family: str) -> dict:
    """Get `family` on disk and hand it back as a data: URI the webview can drop straight into an
    @font-face. Returns {"uri", "family", "cached", "bytes"} or {"error"} — never raises, because a
    missing script font degrades to the system fallback rather than being worth interrupting anyone."""
    path, cached, err = _fetch_and_cache(family, cached_path, "woff2", {"User-Agent": _UA})
    if not path:
        return {"error": err}
    # a family the API answered in .ttf (no weight axis — see CSS_API_STATIC) still caches under the
    # extension _get_and_cache was told, "woff2" — cached_path() itself checks BOTH extensions, so a
    # later call still finds it; only the ext on THIS write can be wrong, and the mime line below reads
    # the real on-disk name rather than trusting cache_ext, so a wrongly-named woff2 file that is
    # actually a ttf still serves with the correct font/ttf mime
    with open(path, "rb") as fh:
        blob = fh.read()
    mime = "font/woff2" if path.endswith(".woff2") else "font/ttf"
    return {"family": family, "cached": cached, "bytes": len(blob),
            "uri": "data:%s;base64,%s" % (mime, base64.b64encode(blob).decode("ascii"))}


def _cached_raw_path(family: str) -> str | None:
    p = os.path.join(FONT_DIR, _slug(family) + ".raw.ttf")
    return p if os.path.exists(p) and os.path.getsize(p) > 1024 else None


def fetch_raw(family: str) -> dict:
    """item 25: the SAME family, but the RAW, uncompressed .ttf the Google Fonts CSS API answers with
    when asked WITHOUT a browser User-Agent (see this module's own docstring: "A browser UA is what
    makes the API answer with woff2 … the default urllib one gets ttf") — a completely separate fetch
    and a separate on-disk cache (`.raw.ttf`, never `.woff2`/`.ttf` alone, so this can never collide
    with fetch()'s own cache for the same family) from fetch()'s own woff2-preferring request.

    Exists because the harfbuzzjs WASM build js/js/lang/smp-shape.js vendors cannot decompress WOFF —
    measured directly: shaping against fetch()'s own cached Noto Sans Kawi woff2 shaped every glyph to
    gid0 (.notdef) with real advances but empty outlines (the cmap/glyf tables read as present but
    unusable), while the identical text against this function's raw .ttf shaped correctly, subjoined
    conjuncts and all. WOFF's compression is exactly what the browser's OWN font engine exists to
    undo for @font-face — reproducing that here would mean carrying a second, redundant decompressor
    (zlib for WOFF1, brotli for WOFF2) purely to hand HarfBuzz bytes it could have had uncompressed
    for the price of one fewer request header. fetch()'s own woff2 is far smaller and is exactly right
    for @font-face's own purpose; this is a second, DELIBERATELY less-compressed copy for a consumer
    @font-face was never serving in the first place.
    """
    path, cached, err = _fetch_and_cache(family, _cached_raw_path, "raw.ttf", {})
    if not path:
        return {"error": err}
    with open(path, "rb") as fh:
        blob = fh.read()
    return {"family": family, "cached": cached, "bytes": len(blob),
            "uri": "data:font/ttf;base64,%s" % base64.b64encode(blob).decode("ascii")}


def installed() -> list[dict]:
    """Every script face cached so far — name, size — for a Fonts pane to list."""
    if not os.path.isdir(FONT_DIR):
        return []
    out = []
    for name in sorted(os.listdir(FONT_DIR)):
        if name.startswith(".") or name.endswith(".part"):
            continue
        p = os.path.join(FONT_DIR, name)
        if os.path.isfile(p):
            out.append({"file": name, "bytes": os.path.getsize(p)})
    return out


def clear() -> dict:
    """Drop the whole cache (a Fonts pane's "clear downloaded fonts")."""
    n = 0
    for f in installed():
        try:
            os.remove(os.path.join(FONT_DIR, f["file"]))
            n += 1
        except OSError:
            pass
    return {"removed": n}
