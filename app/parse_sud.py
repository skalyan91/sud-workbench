"""Backwards-compatible shim.

Parsing now lives in :mod:`app.parse` (multi-engine: SUD spaCy + Stanza UD→SUD).
This module keeps the old import surface so nothing that imported ``parse_sud``
breaks; new code should use :mod:`app.parse` directly.
"""

from __future__ import annotations

from .parse import ParserUnavailable, _tok, whitespace_tokens  # noqa: F401


def sud_parse(text: str, model: str) -> list[dict]:
    """Legacy entry point: parse with a SUD spaCy model, returning just the tokens.

    ``model`` may be a full package name (``en_sud_ewt_gum``), an engine-qualified id
    (``sud:en_sud_ewt_gum``), or a bare language code (resolved via the registry)."""
    from .parse import _parse_spacy_sud, parse
    if ":" in model:
        result = parse(text, model)
        if not result.get("parsed"):
            raise ParserUnavailable(result.get("reason", "parse failed"))
        return result["tokens"]
    return _parse_spacy_sud(text, model)[0]
