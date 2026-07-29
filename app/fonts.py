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


def _get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def cached_path(family: str) -> str | None:
    """The already-downloaded file for `family`, or None."""
    for ext in ("woff2", "ttf"):
        p = os.path.join(FONT_DIR, _slug(family) + "." + ext)
        if os.path.exists(p) and os.path.getsize(p) > 1024:
            return p
    return None


def fetch(family: str) -> dict:
    """Get `family` on disk and hand it back as a data: URI the webview can drop straight into an
    @font-face. Returns {"uri", "family", "cached", "bytes"} or {"error"} — never raises, because a
    missing script font degrades to the system fallback rather than being worth interrupting anyone."""
    os.makedirs(FONT_DIR, exist_ok=True)
    path, cached = cached_path(family), True
    if not path:
        cached = False
        fam = urllib.parse.quote(family.replace(" ", "+"), safe="+")
        data, url, err = b"", "", "unavailable"
        for tmpl in (CSS_API, CSS_API_STATIC):
            try:
                css = _get(tmpl.format(fam=fam)).decode("utf-8", "replace")
            except Exception as exc:  # noqa: BLE001 — offline, blocked, or no such family
                err = str(exc)
                continue
            m = _SRC_RE.search(css)
            if not m:
                err = "no font file in the API response"
                continue
            url = m.group(1).strip("'\"")
            try:
                data = _get(url, timeout=60)
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
                continue
            break
        if not data:
            return {"error": f"could not fetch {family}: {err}"}
        ext = "woff2" if ".woff2" in url else "ttf"
        path = os.path.join(FONT_DIR, _slug(family) + "." + ext)
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    with open(path, "rb") as fh:
        blob = fh.read()
    mime = "font/woff2" if path.endswith(".woff2") else "font/ttf"
    return {"family": family, "cached": cached, "bytes": len(blob),
            "uri": "data:%s;base64,%s" % (mime, base64.b64encode(blob).decode("ascii"))}


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
