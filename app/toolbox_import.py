"""Import SIL FieldWorks/Toolbox interlinear text into CoNLL-U.

A Toolbox (Standard Format Marker) file is a flat sequence of ``\\marker value``
lines grouped into records.  A record's markers split into two kinds:

  * **sentence-level** markers carry one value per record — e.g. ``\\ref`` (the
    record id), ``\\tx`` (the baseline text line), ``\\ft`` (a free translation);
  * **token-level** markers are the *interlinear* rows — several whitespace-aligned
    tokens per record, all sharing the same token count — e.g. ``\\mb`` (morpheme
    breaks), ``\\ge`` (glosses), ``\\ps`` (parts of speech).

This module isolates every use of the (vendored) ``toolbox`` package, mirroring how
``app/`` keeps other optional dependencies behind a single façade.  ``probe`` inspects
a file and classifies its markers so the UI can offer a mapping dialog; ``build`` turns
a file plus a user-chosen mapping into CoNLL-U text.

The output is *raw* interlinear — one token row per aligned column with FORM/LEMMA/
UPOS/XPOS/gloss filled from the mapped markers, and HEAD/DEPREL left unset (``_``): it
has not been parsed for dependencies yet.
"""

from __future__ import annotations

import re
from typing import Any

from . import io_conllu

# Allowed CoNLL-U targets for each level.  Sentence "translation:<lang>" is handled
# specially (it carries a language code) and so is matched by pattern, not membership.
_SENTENCE_TARGETS = {"sent_id", "text", "ignore"}
_TOKEN_TARGETS = {"form", "lemma", "upos", "xpos", "gloss", "ignore"}
_TRANSLATION_RE = re.compile(r"^translation:([A-Za-z][A-Za-z0-9_-]*)$")

# Toolbox reserves ``\_...`` markers for file headers/metadata (e.g. ``\_sh``); they are
# never linguistic content, so we drop them before classifying and grouping records.
_HEADER_RE = re.compile(r"^\\_")

_SAMPLE_LEN = 80


def available() -> bool:
    """True when the vendored ``toolbox`` parser can be imported."""
    try:
        from . import _toolbox_vendor  # noqa: F401
        return True
    except Exception:  # noqa: BLE001 — any import failure means "not available"
        return False


def _toolbox():
    """Import the vendored toolbox module lazily (kept out of module import time)."""
    from . import _toolbox_vendor
    return _toolbox_vendor


def _read_pairs(path: str) -> list[tuple[str, str | None]]:
    """Parse ``path`` into (marker, value) pairs, dropping ``\\_`` header markers."""
    tb = _toolbox()
    with open(path, encoding="utf-8") as fh:
        pairs = list(tb.read_toolbox_file(fh))
    return [(m, v) for (m, v) in pairs if not _HEADER_RE.match(m)]


def _record_marker(pairs: list[tuple[str, str | None]]) -> str | None:
    """Heuristic record delimiter: the first content marker in the file (commonly
    ``\\ref`` or ``\\id``)."""
    return pairs[0][0] if pairs else None


def _records(pairs, record_marker):
    """Group ``pairs`` into records keyed by ``record_marker``. Yields (context, data).

    ``toolbox.records`` reuses and mutates a single context dict across iterations, so a
    snapshot is taken per record — otherwise materialising the generator would leave
    every record pointing at the final record's context.
    """
    tb = _toolbox()
    for ctx, data in tb.records(pairs, record_marker):
        yield dict(ctx), data


def _unwrapped(data) -> "dict[str, str | None]":
    """A record's data rows as {marker: value}, with line-wrapping unwrapped.

    ``normalize_record`` with no aligned fields rejoins values that were wrapped over
    several physical lines under a single ``\\marker`` — so each marker ends up with one
    whitespace-joined value we can tokenise.
    """
    tb = _toolbox()
    out: dict[str, str | None] = {}
    for mkr, val in tb.normalize_record(data, aligned_fields=set()):
        out[mkr] = val
    return out


def _tok_count(val: str | None) -> int:
    return len((val or "").split())


def _classify(recs) -> "tuple[list[str], set[str]]":
    """Return (marker_order, token_markers) for the record data.

    Token-level markers are the interlinear rows: they share an identical *token-count
    signature* across records (aligned rows always have the same number of tokens as one
    another in every record).  We group multi-token markers by that signature and take
    the largest group — ties broken towards the finest granularity (highest average
    token count, i.e. the morpheme rows).  Everything else is sentence-level.
    """
    order: list[str] = []
    counts: dict[str, list[int]] = {}
    for _ctx, data in recs:
        norm = _unwrapped(data)
        for mkr, val in norm.items():
            if mkr not in order:
                order.append(mkr)
            counts.setdefault(mkr, []).append(_tok_count(val))

    # "multi-token" = more than one token in at least half the records it appears in.
    multi = {
        m for m, cs in counts.items()
        if cs and sum(1 for c in cs if c > 1) >= (len(cs) + 1) // 2
    }
    groups: dict[tuple[int, ...], list[str]] = {}
    for m in multi:
        groups.setdefault(tuple(counts[m]), []).append(m)

    token_markers: set[str] = set()
    if groups:
        def score(sig: tuple[int, ...]) -> tuple[int, float]:
            members = groups[sig]
            total = sum(sum(counts[m]) for m in members)
            n = sum(len(counts[m]) for m in members) or 1
            return (len(members), total / n)

        best = max(groups, key=score)
        token_markers = set(groups[best])
    return order, token_markers


def probe(path: str) -> dict:
    """Inspect a Toolbox file: find the record marker and classify every other marker
    as sentence- or token-level.

    Returns ``{"record_marker": str, "markers": [{marker, level, sample}], "n_records": int}``.
    """
    pairs = _read_pairs(path)
    if not pairs:
        raise ValueError("no Toolbox markers found in file")
    record_marker = _record_marker(pairs)
    recs = list(_records(pairs, record_marker))

    order, token_markers = _classify(recs)

    # A representative sample value per marker (first non-empty, truncated).
    samples: dict[str, str] = {}
    for _ctx, data in recs:
        for mkr, val in _unwrapped(data).items():
            if val and mkr not in samples:
                s = val.strip()
                samples[mkr] = s if len(s) <= _SAMPLE_LEN else s[: _SAMPLE_LEN - 1] + "…"
    # the record marker's own value (from context) is a good sample for it too
    for ctx, _data in recs:
        for mkr, val in ctx.items():
            if val and mkr not in samples:
                s = str(val).strip()
                samples[mkr] = s if len(s) <= _SAMPLE_LEN else s[: _SAMPLE_LEN - 1] + "…"

    markers = []
    for mkr in order:
        if mkr == record_marker:
            continue
        markers.append({
            "marker": mkr,
            "level": "token" if mkr in token_markers else "sentence",
            "sample": samples.get(mkr, ""),
        })

    return {"record_marker": record_marker, "markers": markers, "n_records": len(recs)}


# ── build ────────────────────────────────────────────────────────────────────────

def _clean_cell(val: str) -> str:
    """Sanitise a value for a plain CoNLL-U column: no tabs/newlines; blank → ``_``."""
    s = val.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()
    return s if s else "_"


def _clean_misc(val: str) -> str:
    """Sanitise a value for a MISC feature (no whitespace, ``|`` or ``=``)."""
    s = val.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()
    s = re.sub(r"\s+", "_", s)
    return s.replace("|", "/").replace("=", "-")


def _clean_id(val: str) -> str:
    """Sanitise a sent_id: a single whitespace-free token."""
    return re.sub(r"\s+", "_", val.strip())


def _clean_line(val: str) -> str:
    """Collapse a value to a single line (for ``# text`` / ``# text_LANG`` comments)."""
    return " ".join(val.split("\n")).strip()


def _validate_mapping(mapping: Any) -> "tuple[str, dict, dict]":
    if not isinstance(mapping, dict):
        raise ValueError("mapping must be an object")
    record_marker = mapping.get("record_marker")
    if not isinstance(record_marker, str) or not record_marker:
        raise ValueError("mapping.record_marker must be a non-empty string")
    sentence = mapping.get("sentence") or {}
    token = mapping.get("token") or {}
    if not isinstance(sentence, dict) or not isinstance(token, dict):
        raise ValueError("mapping.sentence and mapping.token must be objects")
    for mkr, tgt in sentence.items():
        if tgt in _SENTENCE_TARGETS or _TRANSLATION_RE.match(str(tgt)):
            continue
        raise ValueError(f"invalid sentence target {tgt!r} for marker {mkr!r}")
    for mkr, tgt in token.items():
        if tgt in _TOKEN_TARGETS:
            continue
        raise ValueError(f"invalid token target {tgt!r} for marker {mkr!r}")
    return record_marker, sentence, token


def build(path: str, mapping: dict) -> str:
    """Build CoNLL-U text from a Toolbox file and a marker→field ``mapping``.

    ``mapping`` = ``{"record_marker": str, "sentence": {marker: target},
    "token": {marker: target}}``.  Sentence targets: ``sent_id``, ``text``,
    ``translation:<lang>``, ``ignore``.  Token targets: ``form``, ``lemma``, ``upos``,
    ``xpos``, ``gloss``, ``ignore``.  Raises :class:`ValueError` on a malformed mapping.
    """
    record_marker, sentence_map, token_map = _validate_mapping(mapping)

    pairs = _read_pairs(path)
    file_markers = {m for m, _ in pairs}
    if record_marker not in file_markers:
        raise ValueError(f"record marker {record_marker!r} not present in file")

    recs = list(_records(pairs, record_marker))

    # Which token markers feed which column. Single-valued targets take the first marker
    # mapped to them; gloss may draw from several markers (joined per token).
    single_by_target: dict[str, str] = {}
    gloss_markers: list[str] = []
    token_marker_order: list[str] = []
    for mkr, tgt in token_map.items():
        if tgt == "ignore":
            continue
        token_marker_order.append(mkr)
        if tgt == "gloss":
            gloss_markers.append(mkr)
        elif tgt not in single_by_target:
            single_by_target[tgt] = mkr

    # FORM is required; fall back to the first token-level marker when nothing maps to it.
    form_marker = single_by_target.get("form")
    if form_marker is None and token_marker_order:
        form_marker = token_marker_order[0]

    blocks: list[str] = []
    for idx, (ctx, data) in enumerate(recs, start=1):
        norm = _unwrapped(data)

        def marker_value(mkr: str) -> str | None:
            # a sentence marker may be the record marker itself (value lives in context)
            if mkr == record_marker:
                return ctx.get(mkr)
            return norm.get(mkr)

        # sentence-level fields
        sent_id = None
        text = None
        translations: list[tuple[str, str]] = []
        for mkr, tgt in sentence_map.items():
            if tgt == "ignore":
                continue
            val = marker_value(mkr)
            if val is None:
                continue
            if tgt == "sent_id":
                sent_id = _clean_id(val)
            elif tgt == "text":
                text = _clean_line(val)
            else:
                m = _TRANSLATION_RE.match(tgt)
                if m:
                    translations.append((m.group(1), _clean_line(val)))

        # token columns
        columns: dict[str, list[str]] = {}
        for mkr in token_marker_order:
            columns[mkr] = (marker_value(mkr) or "").split()
        width = max((len(c) for c in columns.values()), default=0)

        def cell(mkr: str, i: int) -> str:
            toks = columns.get(mkr, [])
            return toks[i] if i < len(toks) else ""

        # FORM must exist; if no text line was mapped, reconstruct it from the forms.
        forms = [cell(form_marker, i) for i in range(width)] if form_marker else []
        if text is None and forms:
            text = " ".join(t for t in forms if t)

        lines: list[str] = []
        if sent_id is None:
            sent_id = str(idx)
        lines.append(f"# sent_id = {sent_id}")
        if text is not None:
            lines.append(f"# text = {text}")
        for lang, tval in translations:
            lines.append(f"# text_{lang} = {tval}")

        for i in range(width):
            cols = ["_"] * 10
            cols[0] = str(i + 1)
            cols[1] = _clean_cell(cell(form_marker, i)) if form_marker else "_"
            if "lemma" in single_by_target:
                cols[2] = _clean_cell(cell(single_by_target["lemma"], i))
            if "upos" in single_by_target:
                cols[3] = _clean_cell(cell(single_by_target["upos"], i))
            if "xpos" in single_by_target:
                cols[4] = _clean_cell(cell(single_by_target["xpos"], i))
            # cols[5] feats, cols[6] head, cols[7] deprel, cols[8] deps stay "_"
            gloss_vals = [cell(g, i) for g in gloss_markers]
            gloss = "/".join(v for v in gloss_vals if v.strip())
            cols[9] = f"Gloss={_clean_misc(gloss)}" if gloss.strip() else "_"
            lines.append("\t".join(cols))

        blocks.append("\n".join(lines))

    text_out = "\n\n".join(blocks) + "\n"
    # Sanity-check + canonicalise by round-tripping through the app's own CoNLL-U I/O.
    return io_conllu.serialize(io_conllu.parse(text_out))
