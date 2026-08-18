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
# item 28 — pairs each `@font-face` BLOCK's own `font-weight` with the `url()` in THAT SAME block, non-
# greedy across the block boundary (Google's own CSS always writes weight before src within one block —
# confirmed live, both the browser-UA and no-UA response shapes). Exists because _SRC_RE alone (the whole-
# response single .search() above) silently assumes there is only ONE block to find — true for a variable
# family requested WITH a browser UA (one block per unicode-range subset, but every one at the SAME
# variable weight range), false for the SAME family requested WITHOUT one (see fetch_raw's own note): an
# unauthenticated request for a family that HAS a real wght axis on Google Fonts gets back ONE STATIC
# per-weight block for 100/200/…/900 each — nine separate non-variable .ttf files — and _SRC_RE.search()
# on the raw response always took the FIRST, weight 100 (Thin), regardless of what any caller actually
# wanted. Confirmed live (curl, no UA): "Noto Sans Arabic" resolves this way; "Noto Sans Kawi" (no real
# weight axis at all) falls through the CSS_API→CSS_API_STATIC chain in _fetch_and_cache to a SINGLE
# weight:400 block either way, so `_weighted_src` below degrades to picking the one block that exists —
# the identical outcome _SRC_RE.search() already gave it, confirmed unregressed.
_BLOCK_RE = re.compile(r"font-weight:\s*(\d+)\s*;.*?src:\s*url\(([^)]+)\)", re.S)


def _weighted_src(css: str, weight: int | None) -> str | None:
    """The url() this CSS response names for `weight` — among however many per-weight `@font-face`
    blocks it contains, the one whose OWN weight is numerically closest (an exact match when the family
    offers that weight, which every 100-step family here always does for a round weight; ties resolve to
    the lower of the two, an arbitrary but deterministic choice that never actually arises for the
    100-step families this API serves). `weight=None` (fetch()'s own browser-UA request, which already
    gets back exactly one relevant, variable-capable block per subset) or a response with no weight-
    tagged block at all (CSS_API_STATIC's own single, weight-unlabelled-by-this-caller case) both fall
    back to the OLD plain first-match behaviour — unchanged from before this function existed."""
    blocks = _BLOCK_RE.findall(css)
    if not blocks or weight is None:
        m = _SRC_RE.search(css)
        return m.group(1).strip("'\"") if m else None
    best = min(blocks, key=lambda b: abs(int(b[0]) - weight))
    return best[1].strip("'\"")


def _slug(family: str) -> str:
    """"Noto Sans Canadian Aboriginal" → "notosanscanadianaboriginal" — the vendored naming."""
    return re.sub(r"[^a-z0-9]", "", family.lower())


# The CORE bundled faces this module's own docstring describes (Noto Sans, Noto Sans Mono — shipped in
# web/fonts/, loaded by web/styles/fonts.css's own @font-face rules) must NEVER go out to the Google Fonts
# CSS API at all, for either fetch() or fetch_raw(): a request for "Noto Sans" WITH a browser UA (fetch())
# already happens to resolve to the same file bundled here, but fetch_raw()'s request (deliberately made
# WITHOUT a browser UA, see its own note) resolves to something else entirely — confirmed live, by fetching
# both and inspecting them with fontTools: the UA-less response is a set of separate STATIC per-weight
# legacy .ttf files (100/200/300/…), and _SRC_RE.search() above just grabs the FIRST url() in that CSS,
# which is the 100 (Thin) weight — nowhere near .avm-attr's own weight:571 — and that file carries no
# "c2sc" GSUB feature at all (verified: bundled notosans.ttf's own GSUB feature list has it; the fetched
# legacy file's doesn't). That mismatch is the exact cause of the "AVM labels no longer small-caps and
# way too light" regression (item 26, smp-shape.js's HarfBuzz shaping): _getHBFont shaped correctly, but
# against the WRONG downloaded font — a thin, c2sc-less stand-in for the SAME family name the CSS asks
# for and the browser already renders correctly from the bundled file. Reading the bundled file straight
# off disk sidesteps the Google Fonts CSS API's own UA-sniffing entirely for these two names — no
# network round-trip, no cache-under-APP_DATA needed (the file is already permanently on disk, shipped
# with the app), and HarfBuzz now shapes against the IDENTICAL bytes @font-face already paints from.
_BUNDLED_FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "fonts")
# ⚠ AND THE SEVEN OTHER ALWAYS-BUNDLED FACES BELONG HERE FOR THE SAME REASON, one of them because the
# network path cannot possibly answer for it: "Nithya Ranjana" IS NOT ON GOOGLE FONTS AT ALL (it is not a
# Noto face — see packaging/make_bootstrap_app.sh's CORE_FONTS note, which bundles it unconditionally for
# exactly that reason), so fetch_raw's request 404s and every HarfBuzz shape against it came back null.
# Reported as Rañjanā showing as Devanagari in arcs: with the family resolution fixed (schemeShapeFamily,
# js/lang/translit.js) the right family was finally ASKED for, and then no bytes ever arrived for it, so
# smpReshape kept falling through to the unshaped native `<text>` — one bug hiding behind another. The
# other six are the FONT_CORE_SCRIPTS faces web/styles/fonts.css declares locally: they are guaranteed
# present in every build (make_bootstrap_app.sh hard-fails if one is missing) and, unlike the on-demand
# script faces, are never fetched — so reading them off disk is not merely faster, it keeps HarfBuzz
# shaping against the IDENTICAL bytes @font-face paints from, which is this whole branch's own point.
# Deliberately NOT a generic "look for web/fonts/<slug>" probe: the SOURCE tree carries all 177 Noto
# faces, the shipped bundle only these ten, so a directory probe would shape against the local file in
# development and the (UA-sniffed, possibly degraded) network file in the shipped app — the very
# discrepancy this branch exists to remove. notosans-italic.ttf is the one CORE_FONTS member with no
# row of its own: it is a STYLE of "Noto Sans", not a family, and this map is keyed by family name —
# nothing on the JS side ever asks for an italic face by name (HarfBuzz is handed the upright bytes and
# a weight; no caller passes a style at all), so there is no key it could answer under.
_CORE_BUNDLED = {
    "notosans": "notosans.ttf",
    "notosansmono": "notosansmono.ttf",
    "nithyaranjana": "nithyaranjana.otf",
    "notosansgrantha": "notosansgrantha.ttf",
    "notosansjavanese": "notosansjavanese.ttf",
    "notosansbalinese": "notosansbalinese.ttf",
    "notosanskawi": "notosanskawi.ttf",
    "notosanszanabazarsquare": "notosanszanabazarsquare.ttf",
    "notoseriftibetan": "notoseriftibetan.ttf",
}


def _bundled_path(family: str) -> str | None:
    """The on-disk path for `family` if it's one of the CORE bundled faces above and the file is
    actually present (it always should be, shipped with the app) — else None, meaning "fall through
    to the network path exactly as before" for every non-core family (Devanagari, Kawi, Siddham, …
    the on-demand scripts this module's docstring already describes)."""
    fn = _CORE_BUNDLED.get(_slug(family))
    if not fn:
        return None
    p = os.path.join(_BUNDLED_FONTS_DIR, fn)
    return p if os.path.exists(p) else None


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


def _fetch_and_cache(family: str, path_finder, cache_ext: str, ua: dict,
                      weight: int | None = None) -> tuple[str | None, bool, str]:
    """Shared fetch-and-cache dance behind both fetch() and fetch_raw(): find `family` already on
    disk under `path_finder`, or ask the Google Fonts CSS API for it — with whichever request
    headers `ua` supplies, since that (not the family name) is what decides which file format the
    API answers with (see fetch()'s and fetch_raw()'s own notes). Returns (path, cached, error);
    `path` is None only on total failure. Cached under `cache_ext` — a SEPARATE suffix per caller,
    since fetch() and fetch_raw() deliberately want DIFFERENT formats for the SAME family and must
    not silently hand each other's cached file back (fetch()'s woff2 is exactly the file HarfBuzz's
    WASM build cannot decompress — see fetch_raw()'s own note). `weight`, item 28: which per-weight
    block to pick when the response turns out to hold several (see _weighted_src's own note) — None
    for fetch()'s own browser-UA call, which never needs it."""
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
        url = _weighted_src(css, weight)
        if not url:
            err = "no font file in the API response"
            continue
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
    path = _bundled_path(family)   # CORE face already on disk (see _CORE_BUNDLED's own note) — never hit the network for it
    cached = True
    if not path:
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
    # …and font/otf for the one bundled face that is CFF rather than TrueType (nithyaranjana.otf, now a
    # _CORE_BUNDLED row): advisory either way for a data: URI with no format() hint — every engine sniffs
    # the real table directory — but naming a CFF file "font/ttf" is simply untrue.
    mime = "font/woff2" if path.endswith(".woff2") else ("font/otf" if path.endswith(".otf") else "font/ttf")
    return {"family": family, "cached": cached, "bytes": len(blob),
            "uri": "data:%s;base64,%s" % (mime, base64.b64encode(blob).decode("ascii"))}


def _cached_raw_path(family: str, weight: int = 400) -> str | None:
    # item 28: filename now carries `weight` — see fetch_raw's own note for why a request for the same
    # family at a different weight is a genuinely different file now, not just a different axis position
    # on a shared one, AND for why this also naturally busts any STALE cache a pre-fix session already
    # wrote under the old, weight-less filename (that file is simply never looked up again, exactly the
    # same "bypass rather than hand-invalidate" move 4d38780 already made for the two core faces).
    p = os.path.join(FONT_DIR, _slug(family) + "." + str(weight) + ".raw.ttf")
    return p if os.path.exists(p) and os.path.getsize(p) > 1024 else None


def fetch_raw(family: str, weight: int = 400) -> dict:
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

    ⚠ CORE bundled faces (Noto Sans, Noto Sans Mono — see _CORE_BUNDLED's own note) skip this whole
    network dance and read the SAME file @font-face already paints from, straight off disk — `weight`
    is accepted but unused on that branch (`_bundled_path` always answers with the one on-disk variable
    font regardless; the JS side still applies `weight` to it afterwards, via HarfBuzz's own
    `setVariations`). This IS the fix for the "AVM labels no longer small-caps and way too light"
    regression (4d38780): an unauthenticated (no browser UA) request for "Noto Sans" resolves to a
    DIFFERENT, degraded font than the bundled one — a set of static per-weight legacy .ttf files —
    and carries no "c2sc" GSUB feature at all, so HarfBuzz could shape against it all day and never
    produce a small-caps substitution.

    ⚠ item 28 — a SEPARATE, independent instance of the SAME class of bug, for every family that ISN'T
    core-bundled: on report ("Arabic tokens... look way too light... falling back to Noto Sans Arabic
    Light"), live-curled the exact response this function's own network path gets for "Noto Sans
    Arabic" — NINE separate `@font-face` blocks, one static (non-variable — no `fvar` table at all) TTF
    per weight 100..900, and the OLD code (`_SRC_RE.search()`, whole-response, first match) always took
    the FIRST one: weight 100, Thin, even lighter than the user's own "Light" guess. No amount of the
    JS side's own `setVariations` call can fix that on its own — a static instance has no weight axis
    to move. The real fix is choosing the RIGHT block in the first place: `_weighted_src` (above) picks
    whichever `@font-face` block's own `font-weight` is closest to `weight` (default 400 — the flat
    target `.tok-word`/`.node-lbl`/`.baseword`/`.mwt-form` all specify, `font-weight:
    var(--script-wght,400)` with nothing anywhere overriding that CSS var), landing on the CORRECT
    (Regular) static instance directly. `weight` is threaded all the way from the JS shape call (read
    live off the element's own computed style) through the bridge (app/api.py) to here, so a future
    caller wanting a different weight for a different family gets the right file too, not just Arabic.
    """
    path = _bundled_path(family)
    cached = True
    if not path:
        path, cached, err = _fetch_and_cache(family, lambda f: _cached_raw_path(f, weight), "raw.ttf", {},
                                              weight=weight)
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
