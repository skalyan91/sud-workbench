"""The Persian vocalisation lexicon `fa_vocalise` (app/vocalise.py) ships with NO table for —
fetched from KaamelDict, the same footing as Latin's Morpheus table (app/macron.py) and Arabic's
PADT-harvested one (bundled in the ar_sud_padt wheel itself; see app/vocalise.py's own note on why
Persian's case is different).

WHY FETCHED, AND FROM WHERE
----------------------------
``fa_vocalise``'s own module docstring (inside the fa_sud_perdt wheel) names its lexicon as
"Tihu" and "KaamelDict" — and ships neither, warning once and passing every token through
unchanged until a table is built.  KaamelDict (MahtaFetrat/KaamelDict on Hugging Face) is the
larger, actively-maintained successor that already incorporates Tihu: 116 000+ Persian words, each
with one or more pronunciations in Tihu's own ASCII phoneme scheme (``A``\\=ɒː, ``S``\\=ʃ, ``C``\\=tʃ,
``Z``\\=ʒ, ``?``\\=ʔ — the exact scheme ``fa_align.py`` (also inside the wheel) expects), optionally
tagged with a part of speech and a relative frequency where a word has more than one reading.
Distributed under the GPL, which — the same reasoning ``ar_vocalise.py`` gives for CAMeL's
Aramorph database — restricts DISTRIBUTION, not USE: fetching a copy onto the user's own machine is
not republishing it, so this module downloads the published CSV directly, the same as
``app/grammars.py`` does for its own GPL-adjacent, undeclared-licence upstream.

THE ALIGNMENT ENGINE IS NOT REIMPLEMENTED HERE — IT ALREADY SHIPS
--------------------------------------------------------------------
Turning a KaamelDict row into a lut entry means placing a flat phoneme sequence back onto its
spelling as diacritics (``کتاب`` + ``k e t A b`` → ``کِتاب``), which the fa_vocalise.py module
docstring calls "the whole Persian problem" — a real alignment search, not a lookup, because a
short vowel is INSERTED between letters that carry no phoneme of their own.  That search is
`fa_align.align(word, phonemes)`, a small dynamic-programming aligner shipped INSIDE the
fa_sud_perdt wheel (findable, like ``fa_vocalise`` itself, only by unzipping the actual wheel — it
appears in neither the model repo's release notes nor its public file tree).  It returns ``None``
rather than a guess when no alignment exists, "which is what keeps the built table trustworthy" —
its own words — and this module trusts that contract completely: every entry here is something
`fa_align` itself accepted, never a fallback this module invented for a word it couldn't place.

WHAT THIS MODULE'S OWN CODE DECIDES, AND WHAT IT DOES NOT
-------------------------------------------------------------
Three things are genuinely this module's own, not the aligner's or KaamelDict's:
  * WHICH of several pronunciations becomes the plain F-rung default — the one KaamelDict's own
    ``prob`` column weighs highest (a straight ``max``, no linguistics involved).
  * WHICH homographs earn a POS-conditioned P-rung entry — only where the alternatives' POS labels
    genuinely DIFFER (a word tagged the same part of speech under every reading has nothing for
    UPOS to disambiguate, so an entry there would only ever match the one the plain F-rung already
    answers). KaamelDict's POS column already uses UD tag names for the overwhelming majority of
    rows; a label outside the standard UPOS set (``-``, ``""``, the rare compound ``N,EZ``) is
    dropped rather than guessed at, since it can never equal a real ``token.pos_`` and an entry
    keyed on it would be dead weight, not a wrong answer.
  * That a FAILED alignment (`fa_align` returning ``None``) is dropped, never a bare-form fallback
    written in its place — `fa_vocalise.lookup` already falls through to the bare form on a lexicon
    miss, so there is nothing to gain and a wrong entry to risk by writing one here.
None of the three is a reimplementation of `fa_align`'s own job (turning phonemes into diacritics)
or of `build_fa_vocalise_lut.py`'s exact undisclosed algorithm (unshipped, and not found on the
model repo's public tree either) — this module's own measured homograph count (a few hundred) is
therefore this build's own, not a reproduction of the ~129 the fa_vocalise.py docstring cites, and
is reported as such rather than passed off as matching it.

WRITTEN IN fa_vocalise'S OWN FORMAT, READ BY fa_vocalise'S OWN CODE
------------------------------------------------------------------
The output is exactly the ``{"F": [[skeleton, vocalised], …], "P": [["skeleton|UPOS", vocalised],
…]}`` shape `FaVocalise._load_blob`/`to_disk` already define and `from_disk` already reads — this
module never touches ``fa_vocalise.py``'s own code, only supplies data in the shape it was always
built to accept. Landing in :data:`app.paths.FA_VOCAB_DIR`, NOT inside the installed model package
(that directory belongs to pip and is rewritten on every reinstall) — `app/vocalise.py`'s
`_component("fa")` reads BOTH directories, the model package's own (for its bundled ``ezafe.json``)
and this one (for the fetched lexicon), by calling ``FaVocalise.from_disk`` on each in turn: each
call only touches the one file it finds, so the two never overwrite one another.
"""

from __future__ import annotations

import ast
import csv
import gzip
import io
import json
import os
import urllib.request

from .paths import FA_VOCAB_DIR, ensure_dirs

_CSV_URL = "https://huggingface.co/datasets/MahtaFetrat/KaamelDict/resolve/main/KaamelDict.csv"
_SENTINEL = ".sud-fa-vocab-src"   # records which URL built what's on disk, the same "detect a stale/
                                  # partial fetch rather than assume" role app/grammars.py's own sentinel plays

# The standard UD/UPOS tagset (17 tags). KaamelDict's own POS column already uses these names for
# every row that carries a genuine one; anything outside this set (``""``, ``"-"``, the rare
# compound ``"N,EZ"``) can never equal a real ``token.pos_`` and is dropped at build time — see the
# module docstring's "WHAT THIS MODULE'S OWN CODE DECIDES" note.
_UPOS = frozenset({
    "ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM", "PART",
    "PRON", "PROPN", "PUNCT", "SCONJ", "SYM", "VERB", "X",
})


def available() -> bool:
    """A built lexicon is on disk — never raises."""
    try:
        with open(os.path.join(FA_VOCAB_DIR, "lut.json.gz"), "rb"):
            return True
    except OSError:
        return False


def _align_fn():
    """`fa_align.align`, from the installed Persian model's OWN package — the aligner this module
    calls and does not reimplement (see the module docstring). None if the model isn't installed,
    or is a wheel too old to carry the component."""
    from . import vocalise as _vocalise
    pkg = _vocalise._package("fa")
    if not pkg:
        return None
    try:
        import importlib
        mod = importlib.import_module(pkg + ".fa_align")
        return mod.align
    except Exception:  # noqa: BLE001
        return None


def install(progress=None) -> dict:
    """Fetch KaamelDict's CSV and build the F/P lexicon `fa_vocalise` reads. ``progress(pct, note)``,
    the same shape as every tier's."""
    def note(pct, msg):
        if progress:
            progress(pct, msg)

    align = _align_fn()
    if align is None:
        # The honest, actionable error — named as a MODEL to install, since KaamelDict alone answers
        # nothing without the aligner that turns its phonemes into diacritics (see app/macron.py's
        # own "install() without the model" message, the same shape of gap).
        return {"error": "Persian vocalisation needs the Persian model — install “fa_sud_perdt” "
                         "above first; the lexicon is placed onto it by a component it ships."}

    ensure_dirs()
    note(2, "Downloading KaamelDict…")
    try:
        req = urllib.request.Request(_CSV_URL, headers={"User-Agent": "SUD-Workbench"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001 — offline, or the dataset moved
        return {"error": f"could not download KaamelDict: {exc}"}

    note(40, "Aligning pronunciations…")
    try:
        forms, pos_forms = _build_tables(raw, align, note)
    except Exception as exc:  # noqa: BLE001 — a malformed row must not sink the whole build
        return {"error": f"could not build the lexicon: {exc}"}
    if not forms:
        return {"error": "KaamelDict yielded no alignable entries — the CSV's shape may have changed"}

    note(92, "Writing…")
    os.makedirs(FA_VOCAB_DIR, exist_ok=True)
    tmp = os.path.join(FA_VOCAB_DIR, "lut.json.gz.partial")
    with gzip.open(tmp, "wb", compresslevel=9) as fh:
        fh.write(json.dumps({"F": sorted(forms.items()), "P": sorted(pos_forms.items())},
                            ensure_ascii=False).encode("utf-8"))
    os.replace(tmp, os.path.join(FA_VOCAB_DIR, "lut.json.gz"))   # atomic swap, as grammars.py's is
    with open(os.path.join(FA_VOCAB_DIR, _SENTINEL), "w", encoding="utf-8") as f:
        f.write(_CSV_URL)

    _clear_render_cache()
    note(100, f"Installed — {len(forms):,} words, {len(pos_forms):,} homograph readings")
    return {"ok": True, "words": len(forms), "homographs": len(pos_forms)}


def _build_tables(csv_bytes: bytes, align, note) -> tuple[dict[str, str], dict[str, str]]:
    """The three build-time decisions this module owns — see the module docstring — over every row
    of KaamelDict's CSV. Returns (F table, P table), both ``{key: vocalised}``."""
    forms: dict[str, str] = {}
    pos_forms: dict[str, str] = {}
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8")))
    rows = list(reader)
    total = len(rows) or 1
    for i, row in enumerate(rows):
        if i % 4000 == 0:
            note(40 + int(50 * i / total), "Aligning pronunciations…")
        grapheme = (row.get("grapheme") or "").strip()
        if not grapheme:
            continue
        try:
            phoneme_sets = ast.literal_eval(row.get("phoneme") or "[]")
            pos_list = ast.literal_eval(row.get("POS") or "[]")
            prob_list = ast.literal_eval(row.get("prob") or "[]")
        except (ValueError, SyntaxError):
            continue   # one malformed row must not sink the whole build
        # ALIGN EVERY ALTERNATIVE, KEEP ONLY WHAT THE ALIGNER ACCEPTED — a failed alignment is
        # dropped here, never guessed at (see the module docstring's third bullet).
        answered = []   # [(vocalised, pos_or_"", prob)]
        for j, phonemes in enumerate(phoneme_sets):
            try:
                vocalised = align(grapheme, list(phonemes))
            except Exception:  # noqa: BLE001 — the aligner itself never raises by design, but a
                vocalised = None   # malformed CSV cell (e.g. a non-string phoneme) must not propagate
            if not vocalised:
                continue
            pos = pos_list[j] if j < len(pos_list) else ""
            prob = prob_list[j] if j < len(prob_list) else 1.0
            try:
                prob = float(prob)
            except (TypeError, ValueError):
                prob = 1.0
            answered.append((vocalised, pos, prob))
        if not answered:
            continue
        # F-rung default: the highest-weighted alternative KaamelDict's own `prob` names.
        best = max(answered, key=lambda t: t[2])
        forms[grapheme] = best[0]
        # P-rung: only where the surviving alternatives' POS labels genuinely DIFFER — a homograph
        # the plain F-rung cannot already answer on its own (see the module docstring's second bullet).
        distinct_pos = {p for _, p, _ in answered if p in _UPOS}
        if len(distinct_pos) > 1:
            for vocalised, pos, _ in answered:
                if pos in _UPOS:
                    pos_forms[grapheme + "|" + pos] = vocalised
    return forms, pos_forms


def _clear_render_cache() -> None:
    """Drop `translit`'s memoised renderings of the ``vocalise`` scheme for Persian — same reasoning
    as `app.macron`'s own `_clear_render_cache`: a document rendered before the lexicon arrived
    would otherwise keep showing bare forms for the rest of the session."""
    try:
        from . import translit
        for k in [k for k in translit._CACHE if len(k) > 1 and k[1] == "vocalise"]:
            translit._CACHE.pop(k, None)
    except Exception:  # noqa: BLE001
        pass


def status() -> dict:
    """One row for the Manage Models UI (extras.status() builds its own from TIERS; this is the
    module-side answer the ``module`` tier contract asks for)."""
    return {"id": "fa_vocab", "label": "Persian vocalisation lexicon",
            "note": "KaamelDict pronunciations, aligned onto Persian spelling (~10 MB download) — needs the Persian model",
            "installed": available()}
