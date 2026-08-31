"""The English gloss the generic parser's lexical channel reads, from this app's own tiers.

``xx_sud_generic`` 0.2.0 gained a LEXICAL channel: one aligned vector per token, keyed by the
token's lemma while training and by an **English gloss** at deployment, both looked up in the same
space (aligned vectors are rotated into the English hub, which is what makes the substitution
legitimate rather than a different kind of input).  It reads ``Token._.gloss``; a token without one
reaches the model as the channel's OOV dimension, never as a zero vector.  That is the whole
interface, and this module is the one place that decides WHAT to put in it.

⚠ ONE RULE, ONE IMPLEMENTATION, ON THE PYTHON SIDE.  Two callers need it — a live parse, whose
glosses come across the bridge from the open document, and a custom model's fitting run, whose
glosses come out of the MISC column of a CoNLL-U file the frontend never loads.  The frontend
therefore sends the two tier values RAW (``Gloss``, ``MGloss``) and this decides between them, so
the row a model is fitted under and the input it is later parsed with cannot drift apart — which
they would the moment the rule existed twice, once in JS and once here.

THE RULE, as asked for: prefer ``MGloss`` when its LEXICAL part is non-empty, else ``Gloss``; strip
the Leipzig abbreviations and the morpheme separators from either.

⚠ AND STRIPPING THE ABBREVIATIONS IS NOT TIDYING — it is what the channel is for.  An interlinear
gloss writes content morphemes as English words and grammatical ones as Leipzig abbreviations
(``pick_up_for-3SG.P-BEN-IMP``); the wheel's own note records that fastText has no useful row for
those and that they are dropped rather than hashed, "on the grounds that FEATS already carries
them".  Sending them would fill the channel with misses that look like content.

⚠ A MULTI-WORD GLOSS IS OOV BY CONSTRUCTION, and that is left alone deliberately.  The shipped
English table is 200 000 single lowercase word forms, so ``give to`` misses however it is joined;
picking one of its words to send instead would be inventing an answer the annotator did not write,
and the OOV dimension is the honest reading of "this token's gloss is not in the table".  The
table folds case itself (its meta declares ``lowercased``), so nothing is lower-cased here.
"""

from __future__ import annotations

import re

# The separators an interlinear gloss is built from: the morpheme hyphen, the feature dot, the
# clitic ``=``, the infix ``~`` and any whitespace.  ⚠ NOT the underscore, which is this app's own
# marker for a space INSIDE one lexical gloss (``glossEnc``, js/io/bridge.js, writes ``pick_up``) —
# splitting on it would turn one gloss into two pieces and lose the phrase the annotator wrote.
_SEP = re.compile(r"[-‐-―.=~\s]+")

# A Leipzig abbreviation, in the WHOLE-PIECE form the frontend's own ``GLOSS_ABBR_TOK_RE`` uses for
# text already split on ``.``/``-`` (js/core/prefs.js documents the pair: a bounded run for raw
# text, this for pieces).  Splitting first and testing pieces is what makes the two agree without
# porting a `\p{P}`-bounded lookbehind that Python's own `re` cannot express.
_ABBR_PIECE = re.compile(r"^[A-Z0-9]+$")


def lexical_part(text: str) -> str:
    """The content half of one gloss: its pieces, less every Leipzig abbreviation.

    A bare ``_`` answers empty: CoNLL-U's own "no value" is not a gloss, and the wheel's table takes
    the same view of it (``row()``: "`_` is MISSING, never a key" — a Sanskrit transducer once learnt
    ``FORM -> "_"`` on 5 043 tokens for want of that rule).
    """
    if (text or "").strip() == "_":
        return ""
    keep = [p for p in _SEP.split(text or "") if p and p != "_" and not _ABBR_PIECE.match(p)]
    return " ".join(keep).strip()


def english_gloss(gloss: str = "", mgloss: str = "") -> str:
    """The gloss to hand the lexical channel for one token, or ``""`` for none.

    ``MGloss`` wins when it has a lexical part at all: it is the morphemic tier, so its content
    piece is this token's own stem, where ``Gloss`` may be a whole-word translation of a unit the
    token is only part of.  A closed-class token's ``Gloss`` is often an abbreviation itself
    (``AUX``/``DET`` prefixes — see ``UPOS_LEIPZIG_ABBR``), which the same stripping removes, so
    such a token correctly contributes nothing rather than a category name.
    """
    return lexical_part(mgloss) or lexical_part(gloss)


def from_misc(misc: str) -> str:
    """The same answer, read out of a CoNLL-U MISC field — the fitting path's own entry point.

    ``Gloss=`` / ``MGloss=`` are where this app stores the two tiers (see the layered-annotation
    note in ``CLAUDE.md``); a file from anywhere else simply has neither and glosses nothing.
    """
    if not misc or misc == "_":
        return ""
    vals = {}
    for seg in misc.split("|"):
        k, _, v = seg.partition("=")
        if v:
            vals[k.strip()] = v.strip()
    return english_gloss(vals.get("Gloss", ""), vals.get("MGloss", ""))
