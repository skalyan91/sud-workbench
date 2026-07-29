"""Document-model helpers: id renumbering and dependency-tree validation.

The web frontend already renumbers ids and fixes up heads on every edit (heads
are positional there); these functions give the Python side an authoritative
validation pass for the status bar and for save-time checks.
"""

from __future__ import annotations


def renumber(sent: dict) -> dict:
    """Ensure token ids are the contiguous 1..n sequence of their positions,
    remapping heads by identity.  Returns the same sentence dict."""
    toks = sent.get("tokens") or []
    old_to_new = {}
    for i, tok in enumerate(toks, start=1):
        old_to_new[str(tok.get("id", i))] = str(i)
        tok["id"] = i
    for tok in toks:
        h = str(tok.get("head", "0"))
        tok["head"] = "0" if h in ("0", "", "_") else old_to_new.get(h, h)
    return sent


def validate_sentence(sent: dict) -> list[dict]:
    """Return a list of issues: {token (1-based id), field, message}.

    Checks: every head is 0 or a valid token id; exactly one root; no cycles.
    Non-blocking — the frontend flags offending cells red and counts issues.
    """
    issues: list[dict] = []
    toks = sent.get("tokens") or []
    n = len(toks)
    heads = []
    roots = 0
    for i, tok in enumerate(toks, start=1):
        raw = str(tok.get("head", "")).strip()
        if raw in ("", "_"):
            issues.append({"token": i, "field": "head", "message": "missing head"})
            heads.append(None)
            continue
        try:
            h = int(raw)
        except ValueError:
            issues.append({"token": i, "field": "head", "message": f"non-numeric head {raw!r}"})
            heads.append(None)
            continue
        if h == 0:
            roots += 1
            if (tok.get("deprel") or "") != "root":
                issues.append({"token": i, "field": "deprel", "message": "head 0 must be root"})
        elif h < 1 or h > n:
            issues.append({"token": i, "field": "head", "message": f"head {h} out of range"})
            heads.append(None)
            continue
        elif h == i:
            issues.append({"token": i, "field": "head", "message": "token is its own head"})
        heads.append(None if h == 0 else h)

    if roots == 0:
        issues.append({"token": 0, "field": "root", "message": "no root (need exactly one head 0)"})
    elif roots > 1:
        issues.append({"token": 0, "field": "root", "message": f"{roots} roots (need exactly one)"})

    # cycle detection over the head chain
    for start in range(1, n + 1):
        seen = set()
        cur = start
        while cur is not None and 1 <= cur <= n:
            if cur in seen:
                issues.append({"token": start, "field": "head", "message": "cycle in head chain"})
                break
            seen.add(cur)
            cur = heads[cur - 1]
    return issues


def validate_document(sentences: list[dict]) -> dict:
    """Aggregate validation across the document for the status bar."""
    total = 0
    per_sentence = []
    for sent in sentences:
        issues = validate_sentence(sent)
        total += len(issues)
        per_sentence.append(issues)
    return {"issues": total, "valid": total == 0, "per_sentence": per_sentence}
