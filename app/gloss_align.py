"""Gloss a sentence from its English translation, by aligning the two dependency trees.

A great many treebanks carry a fluent English translation as a ``# text_LANG`` comment, which this
app already round-trips and edits (``sentTranslations``/``renderBlockTrans``, js/io/bridge.js).  A
translation says *in English words* what the sentence means; a parse of it says how those words
relate.  Where the two trees agree structurally, the English word standing in the source word's
structural position is that word's gloss.  This module computes that correspondence; the frontend
writes the matched FORM into MISC ``Gloss`` and the matched LEMMA into ``MGloss``'s lexical part.

⚠ **THE MATCH IS MADE IN UD, NOT IN SUD, AND THAT IS THE WHOLE REASON THE CONVERSION IS HERE.**
SUD promotes function words over their hosts, and promotes *different* ones in different languages.
Measured, on the two sentences of ``samples/chinese_msud.conllu`` and this app's own bundled English
parser: ``This puppy is really cute!`` gets a SUD tree rooted on the AUXILIARY ``is``, while 小狗真可爱
is rooted on 可 AUX -- so aligning roots in SUD space pairs two function words and strands the content
words that actually carry the meaning.  After conversion both sides promote the predicate (``cute`` /
可爱) to root and the trees pair correctly, token for token.  UD's content-word-head principle IS the
cross-linguistic parallelism this feature needs; without it there is nothing to align.

⚠ **AND THE CONVERSION IS WHAT MAKES THE FEATURE REFUSABLE.**  grew's OCaml backend and the fetched
``.grs`` grammars are both optional on a fresh install (see app/grammars.py, app/grew_backend.py), so
``ConversionUnavailable`` is a first-class outcome here, propagated to the caller rather than caught.
There is deliberately NO fall-back to aligning the un-converted SUD trees: the measurement above says
that answers a different question, and a silently worse answer written into an annotator's document is
worse than a clear "install the grammars".
"""
from __future__ import annotations

import copy
import threading

from . import convert, parse

# ── which English model ────────────────────────────────────────────────────────────────────────
# app/wiktionary.py already had to answer "which English package does this app parse English with",
# and its answer is not a constant: the bundled `en_sud_ewt_gum` where it is installed, the RETIRED
# `en_sud_ewt` where a pre-switch venv has only that, and a positive answer cached but a negative one
# never (a model can arrive from Manage Models mid-session).  That resolution was promoted to a public
# `wiktionary.english_model_id()` rather than copied here -- one answer about which model this app
# uses, not two that can drift.


# ── the UD relation inventory, grouped ─────────────────────────────────────────────────────────
# universaldependencies.org/u/dep.  Two layers of coarseness, because a disagreement between two
# relations is not one fact but a graded one, and the score below pays for each rung separately.
_REL_CLASS = {
    # ⚠ SUBJECT IS A CLASS OF ITS OWN, AND IT DOES NOT SHARE A SUPERTYPE WITH THE COMPLEMENTS.
    # UD's own taxonomy files nsubj and obj together as "core arguments", and the first cut of this
    # table followed it -- MEASURED, on samples/la_virgil.conllu, that put Latin `Arma` (the OBJECT of
    # `cano`) under English *I* (the SUBJECT of *sing*), which is as wrong as a gloss gets: same class
    # 0.60 plus the NOUN/PRON near-POS 0.75 cleared the threshold comfortably. Which ARGUMENT a word is
    # is exactly what a reader is looking at, so a subject and an object are not a near miss; separating
    # them at BOTH layers makes the pair ineligible outright rather than merely unlikely, and `Arma` is
    # left unglossed -- which is the honest answer and the one this module prefers everywhere else.
    "nsubj": "SUBJ", "csubj": "SUBJ",
    # the complements: what the predicate takes BESIDES its subject. obj/obl differ by class (a direct
    # object is not an oblique) but share a supertype, which is the rung that says "both complements".
    "obj": "OBJ", "iobj": "OBJ", "ccomp": "OBJ", "xcomp": "OBJ",
    "obl": "OBL", "vocative": "OBL", "expl": "OBL", "dislocated": "OBL",
    # modifiers of any kind, clausal ones included -- a relative clause modifies its noun exactly as an
    # adjective does, and the two really are interchangeable across languages
    "advmod": "MOD", "discourse": "MOD", "amod": "MOD", "nmod": "MOD", "appos": "MOD",
    "nummod": "MOD", "advcl": "MOD", "acl": "MOD",
    # function words -- the class UD demotes and SUD promotes, which is exactly why they are here
    "aux": "FUNC", "cop": "FUNC", "mark": "FUNC", "det": "FUNC", "clf": "FUNC", "case": "FUNC",
    # coordination
    "conj": "COORD", "cc": "COORD",
    # loose / unanalysed multiword
    "fixed": "LOOSE", "flat": "LOOSE", "compound": "LOOSE", "list": "LOOSE", "parataxis": "LOOSE",
    # special
    "orphan": "SPECIAL", "goeswith": "SPECIAL", "reparandum": "SPECIAL", "dep": "SPECIAL",
    "punct": "SPECIAL", "root": "ROOT",
}
# The coarser layer above the classes.  Only the two COMPLEMENT classes collapse: a disagreement about
# which kind of complement a word is (obj against obl) is a smaller thing than a disagreement about
# whether it is a complement at all.  SUBJ stands alone here on purpose -- see the note above.
_REL_SUPER = {"SUBJ": "SUBJ", "OBJ": "COMP", "OBL": "COMP",
              "MOD": "MOD", "FUNC": "FUNC", "COORD": "COORD", "LOOSE": "LOOSE",
              "SPECIAL": "SPECIAL", "ROOT": "ROOT"}

# ── word classes ───────────────────────────────────────────────────────────────────────────────
# ⚠ THE UPOS MUST MATCH EXACTLY, ON INSTRUCTION, AND THAT MAKES IT A GATE RATHER THAN A SCORE.
# It used to be graded — exact, then a NEAR-POS table of pairs where two languages routinely realise
# one meaning under different classes, then a bare open/closed agreement. That table is gone with the
# grading, and so is the openness fallback: a pair whose classes differ is now simply ineligible, at
# any relation, with any features.
# ⚠️ WHAT IT COSTS IS MEASURED AND WORTH KNOWING, because the losses are real words rather than noise:
# Chinese 没 (ADV) no longer matches English *n't* (PART), and 可爱 (ADJ, a stative verb in the source's
# own tagging) no longer matches *cute* — the two cases that motivated the table. A class disagreement
# is now read as "these are not the same word", which is the stricter and more predictable rule, and
# the honest consequence is that a treebank whose tagging conventions differ from the English model's
# will gloss less. Nothing is glossed WRONGLY by it; the answer is silence, which is this module's
# preferred failure everywhere else.
# Because every eligible pair now scores identically on this signal, it contributes NOTHING to ranking
# and is therefore not in the score at all — a constant term across all candidates would only dilute
# the two that still discriminate.

# ⚠ POS-SUBTYPE FEATURES ONLY -- the features that subcategorise a WORD CLASS, which is the part of
# FEATS that is cross-linguistically comparable.  This is the app's own subtype group (the POS-SUBTYPE
# run named in MGLOSS_FEAT_ORDER's comment, js/io/bridge.js) plus ExtPos.
# Inflectional features (Number, Case, Tense, Gender, ...) are deliberately EXCLUDED: a Chinese noun
# has no Number, so scoring its absence against an English plural would penalise exactly the language
# pairs this feature exists for.
_SUBTYPE_FEATS = ("PronType", "NumType", "Poss", "Reflex", "Abbr", "ExtPos")

# ── the weights, and why each is the size it is ────────────────────────────────────────────────
# score = W_REL*R + W_POS*P + W_FEAT*F + W_ORD*O, every term in [0,1].
# Relation and word class are the two things the reader asked to match on and are weighted equally.
_W_REL, _W_FEAT, _W_ORD = 0.80, 0.09, 0.012
# ⚠ THESE THREE INEQUALITIES ARE THE SPECIFICATION; the literals are only one solution of them, and
# _weight_invariants() below asserts them so a later tuning cannot quietly break one.
#   (i)  W_REL*(R_EXACT-R_BASE) > W_FEAT + W_ORD
#        -- a pair whose relation matches EXACTLY must beat one that matches only at the base relation,
#        however perfect its features and its position.  ⚠ MEASURED AND CORRECTED TWICE: it failed by a
#        hundredth under the old two-signal weights, and failed again when UPOS became a gate and the
#        relation inherited its share (0.80 against 0.815).  W_FEAT comes down rather than the rungs
#        moving, because the subtype features really are the weakest of the terms that remain.
#   (ii) W_FEAT + W_ORD < THETA -- features and word order can never carry a pair over the line alone.
#   (iii) W_ORD < W_FEAT/len(_SUBTYPE_FEATS) -- order must never outrank a FEATURE difference, F's
#        granularity for a union of k features being W_FEAT/k, at worst 0.02 here.
# Linear order earns its 0.015 only because without it the solver's choice between two
# indistinguishable siblings is arbitrary and therefore unstable between runs, and the gloss would
# flicker on an unrelated edit.
# The weights sum to 0.902 rather than 1.0; normalising would hide the derivation.

_R_EXACT, _R_BASE, _R_CLASS, _R_SUPER = 1.00, 0.85, 0.60, 0.35

# ⚠ THRESHOLD DERIVED, NOT PICKED, and with UPOS now a gate it states one thing only -- HOW CLOSE THE
# RELATION MUST BE.  The rungs, against 0.42:
#   supertype only (obj vs obl-ish across the argument boundary) 0.80*0.35 = 0.280, at most 0.382 with
#                                                                perfect features and order  -> REJECT
#   same class     (obj vs iobj)                                 0.80*0.60 = 0.480            -> admit
# So the rule reads in one sentence: the two words must carry the same word class outright, and their
# relations must agree at least at CLASS level.  Features and order can no longer rescue a supertype
# pair -- deliberately, since with one structural signal left there is nothing to weigh it against.
_THETA = 0.42
# THETA_LIFT is exactly the score of a pair EXACT on one signal and only openness-level on the other
# (0.40*1.00 + 0.40*0.50 = 0.60), so the rule for a match that crosses a tree level reads in one
# sentence: it must be exact on at least one of relation or word class.  A threshold, deliberately,
# rather than a second decay mechanism -- one mechanism is easier to test than two.
_THETA_LIFT = 0.60

# A finite sentinel rather than infinity: the assignment solver below does arithmetic on its costs,
# and an inf would poison the potentials.  Assignments landing on it are discarded after the solve.
_BIG = 1e6

# ⚠ grewpy TALKS TO ONE BACKEND OVER ONE SOCKET (app/convert.py's own note), AND pywebview DISPATCHES
# EVERY JS->PYTHON CALL ON ITS OWN NEW THREAD WITHOUT SERIALISING THEM (app/api.py's two hard-won
# invariants).  Two windows glossing at once would therefore race on that one connection.  Same
# reasoning as Api._dialog_lock, applied to the other non-reentrant resource this app has.
_CONV_LOCK = threading.Lock()


# ── small readers over the token dict ──────────────────────────────────────────────────────────
def _rel_base(deprel: str) -> str:
    """``nsubj:pass`` -> ``nsubj``.  Both separators, so this reads a SUD label too (`comp:obj@x`)."""
    return (deprel or "").split("@")[0].split(":")[0]


def _feat_set(feats: str) -> frozenset:
    """The POS-SUBTYPE ``Feat=Val`` pairs only -- see _SUBTYPE_FEATS for why the inflectional ones
    are left out."""
    if not feats or feats == "_":
        return frozenset()
    return frozenset(kv for kv in feats.split("|")
                     if kv.split("=", 1)[0] in _SUBTYPE_FEATS)


def _rel_score(a: str, b: str) -> float:
    """0.0 means INELIGIBLE, not merely "bad" -- see _pair_score's gate."""
    if not a or not b:
        return 0.0
    if a == b:
        return _R_EXACT
    ba, bb = _rel_base(a), _rel_base(b)
    if ba == bb:
        return _R_BASE
    ca, cb = _REL_CLASS.get(ba), _REL_CLASS.get(bb)
    if ca and cb:
        if ca == cb:
            return _R_CLASS
        if _REL_SUPER.get(ca) == _REL_SUPER.get(cb):
            return _R_SUPER
    return 0.0


def _upos_ok(a: str, b: str) -> bool:
    """Exact agreement, on instruction -- see the word-classes note above for what it rules out."""
    return bool(a) and a == b


def _feat_score(a: str, b: str) -> float:
    """Jaccard over the subtype features.  ⚠ ZERO WHEN BOTH ARE SILENT: two tokens that say nothing
    agree about nothing, and scoring silence as agreement would make this term a constant that lifts
    every pair equally -- i.e. no term at all, while still eating its 0.15 of the budget."""
    fa, fb = _feat_set(a), _feat_set(b)
    union = fa | fb
    if not union:
        return 0.0
    return len(fa & fb) / len(union)


def _pair_score(s, e, n_s: int, n_e: int):
    """The score for one candidate pair, or ``None`` where the pair is INELIGIBLE.

    ⚠ TWO GATES BEFORE ANY SCORING: the word classes must be identical, and the relations must at
    least be relatable.  Neither is a score -- an ineligible pair is not a low-ranked one, it is not a
    candidate at all, which is what keeps `nsubj` out of `advmod`'s slot and a DET out of a VERB's
    however well the rest of the evidence lines up.  The threshold then does the only job it is good
    at: ranking among pairs that have already passed both.
    """
    if not _upos_ok(s["upos"], e["upos"]):
        return None
    r = _rel_score(s["deprel"], e["deprel"])
    if r <= 0.0:
        return None
    f = _feat_score(s.get("feats", ""), e.get("feats", ""))
    # normalised position in each sentence, so two sentences of different lengths are comparable
    o = 1.0 - abs((s["i"] / n_s if n_s else 0.0) - (e["i"] / n_e if n_e else 0.0))
    return _W_REL * r + _W_FEAT * f + _W_ORD * o


# ── tree helpers ───────────────────────────────────────────────────────────────────────────────
_SKIP_UPOS = frozenset(("PUNCT", "SYM"))


def _tree(tokens: list[dict]) -> dict:
    """Index a UD token list into ``{children: {id: [node]}, roots: [node], n: int}``.

    ⚠ PUNCT and SYM are dropped from the candidate pools: they match trivially and meaninglessly,
    and a Chinese 。glossed "." is worse than no gloss at all.  A dropped token's own children are
    re-parented onto its head, so dropping one can never sever a subtree (in a well-formed tree
    punctuation is a leaf anyway; this is the guard for the case where it is not).
    """
    nodes = []
    for i, t in enumerate(tokens):
        nodes.append({"i": i, "id": i + 1, "form": t.get("form", ""), "lemma": t.get("lemma", ""),
                      "upos": t.get("upos", ""), "feats": t.get("feats", ""),
                      "deprel": t.get("deprel", ""), "head": t.get("head", "0"),
                      "skip": t.get("upos", "") in _SKIP_UPOS})
    by_id = {nd["id"]: nd for nd in nodes}

    def live_head(nd):
        """The nearest ancestor that was not dropped (0 = the virtual root)."""
        seen = set()
        h = nd["head"]
        while True:
            try:
                hid = int(h)
            except (TypeError, ValueError):
                return 0
            if hid <= 0 or hid in seen:
                return 0
            seen.add(hid)
            up = by_id.get(hid)
            if up is None:
                return 0
            if not up["skip"]:
                return hid
            h = up["head"]

    children: dict[int, list] = {}
    roots = []
    for nd in nodes:
        if nd["skip"]:
            continue
        h = live_head(nd)
        if h:
            children.setdefault(h, []).append(nd)
        else:
            roots.append(nd)
    return {"children": children, "roots": roots, "n": len(tokens) or 1,
            "live": [nd for nd in nodes if not nd["skip"]]}


# ── the alignment: TREE EDIT DISTANCE (Zhang-Shasha), with the mapping read back ───────────────
# ⚠ THIS REPLACED A ROOT-DOWN RECURSIVE DESCENT, and the replacement is a simplification as much as a
# change of answer. The descent walked the two trees in step, solving an optimal assignment over each
# pair of sibling sets; because that only ever compared children of an ALREADY-MATCHED pair, a single
# unmatched intervening node (an English auxiliary the source realises as a suffix, a light verb
# against a simple one) severed the whole subtree below it. It needed a bounded one-level "lift" to
# rescue those, and a final uniqueness sweep to rescue what the lift could not reach -- two special
# cases, each with its own threshold, patching one structural blind spot.
#
# An edit distance has no such blind spot: an intervening node the other tree lacks is simply a
# DELETION, and its children remain free to map to whatever they should map to, at any depth. The
# lift and the sweep are gone, along with the assignment solver they were built around; what is left
# is one cost model and one DP. The mapping a Zhang-Shasha edit script induces is exactly what this
# feature wants -- one-to-one, ancestor-preserving, and cheapest overall rather than cheapest
# level-by-level, which is what a greedy descent can only approximate.
#
# ⚠ CHILDREN ARE SORTED CANONICALLY, NOT BY WORD ORDER, AND THAT IS WHAT MAKES ORDERED TED USABLE
# ACROSS LANGUAGES. Zhang-Shasha is an ORDERED tree distance: its mapping may not cross, so two
# siblings can only both map if they appear in the same relative order on both sides. Unordered TED
# is the obvious alternative and is NP-hard, so it is not on the table. But surface order is the
# wrong order to impose here -- it is precisely what differs between languages (Latin puts its object
# first, English does not), so ordering by token index would forbid the very matches this exists to
# make. Sorting each node's children by RELATION instead (subject before complement before modifier,
# the _REL_ORDER rank below) gives a canonical order that both languages share, and the
# no-crossing constraint then says something true and language-neutral: a subject may not map to a
# complement's slot. Ties fall back to the token index, so the order is total and the result stable.
_REL_ORDER = ("SUBJ", "OBJ", "OBL", "MOD", "FUNC", "COORD", "LOOSE", "SPECIAL", "ROOT")
_REL_ORDER_RANK = {c: i for i, c in enumerate(_REL_ORDER)}

# Deleting a node from one tree and inserting one into the other costs _DEL + _INS = 1.0 together, so
# a rename is preferred to a delete/insert pair exactly when it costs less than 1.0. Rename cost is
# 1 - score, and a pair below the threshold (or failing the two-signal gate) is priced at _BIG
# instead -- so the DP cannot buy structure by making a match this module would refuse to report.
# The threshold is therefore enforced INSIDE the optimisation rather than as a filter over its
# output: every pair in the mapping is one worth reporting, and the distance describes that mapping.
_DEL = _INS = 0.5


def _canon_key(nd):
    """The canonical sort key. ⚠ THE TOKEN INDEX IS THE LAST RESORT AND NOT THE FIRST, which is the
    whole point: word order is the thing that DIFFERS between the two languages, so letting it decide
    where two same-relation siblings sit would reintroduce, as a no-crossing constraint, exactly the
    difference the alignment exists to see past. Relation first, then word class -- both statements
    the two trees can agree on -- and only then position, to keep the order total and the result
    stable between runs."""
    base = _rel_base(nd["deprel"])
    return (_REL_ORDER_RANK.get(_REL_CLASS.get(base, "SPECIAL"), 99), base, nd["upos"], nd["i"])


def _canon_children(tree, node_id):
    """A node's children in the canonical order the ordered TED is taken over (see the note above)."""
    kids = tree["children"].get(node_id, [])
    return sorted(kids, key=_canon_key)


def _postorder(tree):
    """``(nodes, leftmost)`` -- every node in postorder under one virtual root, plus each node's
    leftmost-leaf postorder index, which is the array Zhang-Shasha's keyroots are defined from.

    The VIRTUAL ROOT is appended last and carries every ``head=0`` token as its children. One
    mechanism then covers three cases with no special-casing: a translation that parses into several
    English sentences (measured -- "I don't have any questions. Really none at all." comes back with
    two roots), a source sentence a reader has left with two roots mid-edit, and the ordinary one.
    """
    order, left = [], []
    idx = {}

    def walk(nd):
        kids = _canon_children(tree, nd["id"]) if nd else sorted(tree["roots"], key=_canon_key)
        first = len(order)
        firstleaf = None
        for k in kids:
            walk(k)
            if firstleaf is None:
                firstleaf = left[idx[k["id"]]]
        order.append(nd)
        me = len(order) - 1
        if nd is not None:
            idx[nd["id"]] = me
        left.append(firstleaf if firstleaf is not None else me)
        return me

    walk(None)                      # the virtual root, appended last -- so it is the postorder root
    return order, left


def _keyroots(left):
    """Zhang-Shasha's keyroots: every node that is not the leftmost child of its parent, plus the
    root.  Derived from ``left`` alone -- the last node sharing each leftmost-leaf value."""
    seen, out = {}, []
    for i, l in enumerate(left):
        seen[l] = i                 # keep the LAST index for each leftmost-leaf, which is that subtree's keyroot
    out = sorted(seen.values())
    return out


def _forestdist(A_left, B_left, i, j, treedist, ren):
    """The forest-distance table for the subtrees rooted at postorder ``i`` and ``j``, filling in
    ``treedist`` for every tree pair it settles.  Recomputed during the backtrack rather than all
    kept: storing one table per keyroot PAIR is O(n^2 m^2) memory, and recomputing the O(n) tables the
    backtrack actually visits is a few hundred thousand operations on sentence-sized trees."""
    oi, oj = A_left[i], B_left[j]
    R, C = i - oi + 2, j - oj + 2
    fd = [[0.0] * C for _ in range(R)]
    for x in range(1, R):
        fd[x][0] = fd[x - 1][0] + _DEL
    for y in range(1, C):
        fd[0][y] = fd[0][y - 1] + _INS
    for x in range(1, R):
        ai = oi + x - 1
        for y in range(1, C):
            bj = oj + y - 1
            if A_left[ai] == oi and B_left[bj] == oj:
                fd[x][y] = min(fd[x - 1][y] + _DEL, fd[x][y - 1] + _INS,
                               fd[x - 1][y - 1] + ren(ai, bj))
                treedist[ai][bj] = fd[x][y]
            else:
                p, q = A_left[ai] - oi, B_left[bj] - oj
                fd[x][y] = min(fd[x - 1][y] + _DEL, fd[x][y - 1] + _INS,
                               fd[p][q] + treedist[ai][bj])
    return fd, oi, oj


def align(src_tokens: list[dict], en_tokens: list[dict]) -> list[dict]:
    """Align two UD token lists by TREE EDIT DISTANCE.  Returns ``[{"src": i, "en": j, "score": f},
    ...]`` -- 0-based indices into the two lists, one-to-one and ancestor-preserving.

    The pairs are the RENAME operations of a cheapest edit script turning one tree into the other;
    everything the two languages do not share falls out as a deletion or an insertion, which is the
    honest answer for a word the other language simply does not have (English has articles most
    languages do not, and vice versa).
    """
    st, et = _tree(src_tokens), _tree(en_tokens)
    A, A_left = _postorder(st)
    B, B_left = _postorder(et)
    n, m = len(A), len(B)
    n_s, n_e = st["n"], et["n"]

    scores = {}

    def ren(i, j):
        """Rename cost, and the ONLY place the linguistic score enters the optimisation."""
        a, b = A[i], B[j]
        if a is None or b is None:          # the two virtual roots rename to each other for free, and
            return 0.0 if (a is None and b is None) else _BIG   # to nothing else at any price
        sc = _pair_score(a, b, n_s, n_e)
        if sc is None or sc < _THETA:       # ineligible, or not worth reporting -- see _DEL's note
            return _BIG
        scores[(i, j)] = sc
        return 1.0 - sc

    treedist = [[0.0] * m for _ in range(n)]
    for i in _keyroots(A_left):
        for j in _keyroots(B_left):
            _forestdist(A_left, B_left, i, j, treedist, ren)

    # ── read the mapping back out of the edit script ──────────────────────────────────────────
    pairs, stack = [], [(n - 1, m - 1)]
    eps = 1e-9
    while stack:
        i, j = stack.pop()
        fd, oi, oj = _forestdist(A_left, B_left, i, j, treedist, ren)
        x, y = i - oi + 1, j - oj + 1
        while x > 0 and y > 0:
            ai, bj = oi + x - 1, oj + y - 1
            if A_left[ai] == oi and B_left[bj] == oj:
                if abs(fd[x][y] - (fd[x - 1][y - 1] + ren(ai, bj))) < eps:
                    sc = scores.get((ai, bj))
                    if sc is not None and A[ai] is not None and B[bj] is not None:
                        pairs.append({"src": A[ai]["i"], "en": B[bj]["i"], "score": round(sc, 4)})
                    x -= 1; y -= 1
                elif abs(fd[x][y] - (fd[x - 1][y] + _DEL)) < eps:
                    x -= 1
                else:
                    y -= 1
            else:
                p, q = A_left[ai] - oi, B_left[bj] - oj
                if abs(fd[x][y] - (fd[p][q] + treedist[ai][bj])) < eps:
                    stack.append((ai, bj)); x, y = p, q
                elif abs(fd[x][y] - (fd[x - 1][y] + _DEL)) < eps:
                    x -= 1
                else:
                    y -= 1
    pairs.sort(key=lambda p: p["src"])
    return pairs


# ── conversion to UD, and getting back to the source tokens ────────────────────────────────────
_STAMP = "SrcTok"


def _stamp(sentences: list[dict]) -> list[dict]:
    """A DEEP COPY whose every token's MISC carries ``SrcTok=<1-based index>``.

    ⚠ The copy is the whole point and is not an optimisation to undo later: the stamp is scaffolding
    for the conversion, and the reader's document must never see it.  Nothing is stripped afterwards
    because nothing has to be -- the stamped tokens are thrown away with the converted trees, and the
    only things that leave this module are the matched form, lemma and UPOS.  (A version that stamped
    in place and stripped on the way out would put ``SrcTok`` in the saved file for as long as any
    path between the two threw.)"""
    out = copy.deepcopy(sentences)
    for s in out:
        for i, t in enumerate(s.get("tokens") or []):
            m = t.get("misc") or "_"
            m = "" if m == "_" else m
            t["misc"] = (m + "|" if m else "") + f"{_STAMP}={i + 1}"
    return out


def _read_stamp(t: dict):
    for kv in (t.get("misc") or "").split("|"):
        k, _, v = kv.partition("=")
        if k == _STAMP:
            try:
                return int(v)
            except ValueError:
                return None
    return None


def _idmap(n_src: int, ud_tokens: list[dict]):
    """``ud index -> source index`` (0-based), or ``None`` where no honest mapping exists.

    ⚠ TWO STRATEGIES, THE FIRST MEASURED RATHER THAN ASSUMED, BECAUSE ONE OF THEM IS KNOWN TO BE
    WRONG FOR mSUD.  app/convert.py records that a grew rewrite "reattaches and relabels but never
    inserts or deletes a token" -- true of SUD->UD, and NOT true of mSUD->UD, which FUSES the ``/m``
    morphemes into one node.  Measured on samples/chinese_msud.conllu: 6 tokens in, 5 nodes out
    (问+题 -> 问题, 可+爱 -> 可爱).  A positional map would therefore have glossed the wrong words from
    the fourth token of every mSUD sentence onward.

    So the MISC stamp is the primary strategy, and it was measured through a real conversion before
    being relied on: it survives both directions intact, and a FUSED node comes back carrying exactly
    ONE ``SrcTok`` -- its head morpheme's (问 for 问题), which is precisely the representative this
    wants.  Positional identity is kept as the fallback for a grammar that renormalises MISC away.
    Where neither answers, the caller writes NOTHING: an annotation on the wrong word is worse than
    no annotation, which is the rule convert.py's own _derive_one already states.
    """
    stamps = [_read_stamp(t) for t in ud_tokens]
    if all(v is not None for v in stamps):
        prev = 0
        ok = True
        for v in stamps:
            if not (prev < v <= n_src):      # strictly increasing and in range
                ok = False
                break
            prev = v
        if ok:
            return [v - 1 for v in stamps]
    if len(ud_tokens) == n_src:              # fallback: the SUD case, positional
        return list(range(n_src))
    return None


def _bare(tokens: list[dict], text: str = "") -> dict:
    """The minimal sentence dict io_conllu.serialize needs -- the same shape parse.py builds when it
    has to hand grew a sentence of its own."""
    return {"sid": None, "text": text, "comments": [], "tokens": tokens, "mwt": [], "empties": []}


def _en_translation(sent: dict, trans_lang: str = "en") -> str:
    """The first non-empty translation in the wanted language.  ``en`` and its 639-3 ``eng`` are one
    language; a file may spell it either way."""
    want = {trans_lang, "eng"} if trans_lang == "en" else {trans_lang}
    for row in sent.get("translations") or []:
        if (row.get("lang") or "") in want and (row.get("text") or "").strip():
            return row["text"].strip()
    return ""


def gloss_from_translation(sentences: list[dict], lang: str = "", src_format: str = "SUD",
                           trans_lang: str = "en") -> list[dict]:
    """One entry per input sentence, parallel and the same length.

    ``{"pairs": [{"src", "en", "form", "lemma", "upos", "score"}, ...], "sents": n, "error": ""}`` -- ``pairs`` holds only the tokens that matched, and a source token absent from
    it simply has no gloss, which is the honest and common answer (English has articles most
    languages do not, and vice versa).

    Raises ``convert.ConversionUnavailable`` / ``ConversionError`` through to the caller: those are
    the feature's refusal, and the Api layer turns them into the toast.
    """
    sentences = list(sentences or [])
    out = [{"pairs": [], "sents": 0, "error": ""} for _ in sentences]
    jobs = [(i, _en_translation(s, trans_lang)) for i, s in enumerate(sentences)]
    jobs = [(i, txt) for i, txt in jobs if txt and (sentences[i].get("tokens") or [])]
    if not jobs:
        return out

    # ── 1. parse every translation in ONE batched call (nlp.pipe underneath) ────────────────
    from . import wiktionary
    model = wiktionary.english_model_id()
    parsed = parse.parse_many([txt for _, txt in jobs], model)
    if len(parsed) != len(jobs):                     # an answer that does not line up is unusable
        for i, _ in jobs:
            out[i]["error"] = "the English parser returned a mismatched batch"
        return out

    live = []
    for (i, txt), res in zip(jobs, parsed):
        if not res.get("parsed"):
            out[i]["error"] = res.get("reason") or "no English model installed"
            continue
        live.append((i, txt, res["tokens"]))
    if not live:
        return out

    # ── 2. both sides to UD, two batched calls, serialised against the one grew backend ─────
    with _CONV_LOCK:
        src_in = _stamp([_bare(sentences[i].get("tokens") or [], sentences[i].get("text") or "")
                         for i, _, _ in live])
        src_ud = convert.to_ud(src_in, src_format or "SUD", lang or None)
        en_in = _stamp([_bare(toks, txt) for _, txt, toks in live])
        en_ud = convert.sud_to_ud(en_in, "en")
    if len(src_ud) != len(live) or len(en_ud) != len(live):
        for i, _, _ in live:
            out[i]["error"] = "the conversion returned a mismatched batch"
        return out

    # ── 3. map back, 4. align ──────────────────────────────────────────────────────────────
    for (i, _txt, en_toks), su, eu in zip(live, src_ud, en_ud):
        src_toks = sentences[i].get("tokens") or []
        su_toks, eu_toks = su.get("tokens") or [], eu.get("tokens") or []
        s_map = _idmap(len(src_toks), su_toks)
        e_map = _idmap(len(en_toks), eu_toks)
        if s_map is None or e_map is None:
            out[i]["error"] = "could not map the converted tree back to the document"
            continue
        out[i]["sents"] = sum(1 for t in en_toks if str(t.get("head") or "0") == "0")
        for p in align(su_toks, eu_toks):
            si, ei = s_map[p["src"]], e_map[p["en"]]
            et = en_toks[ei]
            # ⚠ THE ENGLISH TOKEN IS READ OFF THE **UNCONVERTED** PARSE, not off the UD tree beside
            # it: the conversion is a claim about SYNTAX, and the form and lemma of a word are not
            # its business.  (It matters in practice too -- the mSUD direction rewrites forms, so a
            # converted node's `form` can be a fusion of several words' spellings.)
            out[i]["pairs"].append({
                "src": si, "en": ei,
                "form": et.get("form", ""), "lemma": et.get("lemma", ""),
                "upos": et.get("upos", ""),
                "score": p["score"],
            })
        out[i]["pairs"].sort(key=lambda d: d["src"])
    return out


def _weight_invariants() -> None:
    """The three inequalities the weights exist to satisfy, asserted at import.

    They, and not the literals above, are what this scoring function promises; the numbers are one
    solution of them.  Checked here rather than in a test file because there is no test suite -- and
    because the first draft of these weights VIOLATED (i) by 0.01, which no amount of reading the
    table would have shown.
    """
    assert _W_REL * (_R_EXACT - _R_BASE) > _W_FEAT + _W_ORD, \
        "an exact-relation pair must beat a base-relation one whatever its features and position"
    assert _W_FEAT + _W_ORD < _THETA, \
        "features and word order must not be able to carry a pair alone"
    assert _W_ORD < _W_FEAT / len(_SUBTYPE_FEATS), \
        "word order must not outrank a feature difference"


_weight_invariants()
