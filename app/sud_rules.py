"""Which SUD relations are allowed between two tokens, given their POS tags.

The SUD validator (vendored ``grammars/validator/relations.json``, from surfacesyntacticud/tools)
expresses relation↔POS constraints as grew patterns, e.g.::

    pattern { GOV -[punct]-> DEP; DEP [upos <> PUNCT] }          # punct ⇒ dependent must be PUNCT
    pattern { GOV -[1=comp,2=aux]-> DEP; GOV [upos <> AUX] }     # comp:aux ⇒ governor must be AUX
    pattern { GOV -[1=det]-> DEP; DEP [upos <> DET|NUM] }        # det ⇒ dependent must be DET|NUM

There are only a handful of such hard (error-level) constraints, so rather than run grew per
candidate we parse the patterns once and evaluate them directly — fast and offline.  A relation is
allowed for (head_upos, dep_upos) unless it violates one of these error-level constraints.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_RULES_PATH = Path(__file__).resolve().parent.parent / "grammars" / "validator" / "modules" / "relations.json"
_RULES: list | None = None


def _parse_relspec(spec: str) -> str:
    """``subj`` → ``subj``; ``1=comp,2=aux`` → ``comp:aux``; ``1=det`` → ``det``."""
    spec = spec.strip()
    if "=" in spec:
        parts = dict(p.split("=", 1) for p in spec.split(",") if "=" in p)
        return ":".join(parts[k] for k in sorted(parts) if k.isdigit())
    return spec.split("@")[0]


def _load_rules() -> list:
    """Each rule: (relation, node 'GOV'/'DEP', op '<>'/'=', {upos…}).  Error-level, POS-constraining only."""
    global _RULES
    if _RULES is not None:
        return _RULES
    rules: list = []
    try:
        data = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
        for item in data.get("items", []):
            if item.get("level") != "error":
                continue   # only hard (error-level) POS constraints — warnings (e.g. subj ⇒ GOV VERB|AUX) are advisory, not enforced
            reqs = item["request"] if isinstance(item["request"], list) else [item["request"]]
            pattern = reqs[0]
            rel_m = re.search(r"-\[([^\]]+)\]->", pattern)
            pos_m = re.search(r"(GOV|DEP)\s*\[\s*upos\s*(<>|=)\s*([A-Z|]+)\s*\]", pattern)
            if not rel_m or not pos_m:
                continue
            rel = _parse_relspec(rel_m.group(1))
            rules.append((rel, pos_m.group(1), pos_m.group(2), set(pos_m.group(3).split("|"))))
    except Exception:  # noqa: BLE001 — missing/renamed validator → no constraints (permissive)
        rules = []
    _RULES = rules
    return rules


def _rel_base(deprel: str) -> str:
    """``comp:aux@x`` → ``comp:aux``; ``subj@expl`` → ``subj`` (drop only the @subtype)."""
    return (deprel or "").split("@")[0]


def is_valid(head_upos: str, dep_upos: str, deprel: str) -> bool:
    base = _rel_base(deprel)
    for rel, node, op, uposset in _load_rules():
        if base != rel:
            continue
        upos = head_upos if node == "GOV" else dep_upos
        violated = (upos not in uposset) if op == "<>" else (upos in uposset)
        if violated:
            return False
    return True


def valid_deprels(head_upos: str, dep_upos: str, candidates: list[str]) -> list[str]:
    return [d for d in candidates if is_valid(head_upos, dep_upos, d)]


def valid_upos(head_upos: str, deprel: str, candidates: list[str]) -> list[str]:
    """Which dependent POS tags are allowed for this head-POS + relation."""
    return [p for p in candidates if is_valid(head_upos, p, deprel)]
