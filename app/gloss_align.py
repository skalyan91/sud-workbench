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

⚠ **AND THE STRUCTURE IS NO LONGER THE ONLY EVIDENCE: WHAT THE TWO WORDS MEAN IS WEIGHED BESIDE IT.**
:mod:`app.vectors` holds thirteen cross-lingually aligned tables in one shared 128-dimensional space
— fetched beside each parser, so "download the Chinese model" now also means "be able to tell 我 from
问题 when the tree cannot" — and ``_sem_score`` turns a pair's cosine into the fourth term of the
score.  Three properties are deliberate and each is asserted or measured rather than asserted-by-hope:

* **With no table, every pair scores exactly what it would if the term did not exist.**  It is
  additive with a zero default and ``W_FEAT``/``W_ORD``/``THETA`` are untouched, so a language the
  release does not cover (most of them) and a machine that has not fetched anything are both scored
  by the structure alone.  Verified against ``HEAD``'s own copy of this module when the term landed —
  4 of 4 translated samples identical — and guarded since by the last assertion in
  :func:`_weight_invariants`, which is now the standing check: the module has deliberately changed
  elsewhere (``_rel_score_pair``), so a diff against an older copy no longer isolates this property.
* **It ranks; it does not overrule.**  Invariant (iv) below bounds the whole non-relational half of
  the sum below one relation-class rung, so two words may mean the same thing and still not be each
  other's gloss if one is a subject and the other a complement.
* **Measured, it decides two competitions the structure cannot, and it is right both times.**  Over
  the 27 source nodes with more than one eligible English candidate on the three translated samples,
  the term moves the argmax twice — ``fato`` from *exile* (0.492) to **fate** (0.559) and ``saevae``
  from *mindful* (0.810) to **cruel** (0.899) — and both are the correct gloss.  ``saevae`` is the
  textbook shape: two English ADJ ``amod``s in one sentence, structurally indistinguishable, told
  apart only by what the words mean.  With ``_SEM_SKIP_UPOS`` lifted it moves four, and the extra
  ones are the names it exists to keep out.
  Counts are 34 / 6 / 4 with the term and without it; zh and ar are unchanged word for word, and on
  the Latin the membership moves by two either way — it gains ``fato``/*fate* and
  ``profugus``/*exile*, loses ``qui``/*who* and ``oris``/*shores*.  All four are correct, so the
  COUNT is a wash and the two argmax corrections above are the real gain.  The English identity
  control is unmoved at 48 pairs / 44 to themselves, with the mean score rising 0.827 → 0.911.  A
  mismatch control (every sentence handed a DIFFERENT sentence's translation) gives 17 and 1 pairs
  with the term and without — it manufactures nothing.  Cost: 89 ms against 87 ms for the
  three-sentence Latin sample warm, i.e. below noise, plus 136 ms once to load a table.
  ⚠️ **Do not expect the pair COUNT to move much, and do not read that as "the term does nothing"**:
  the ordered TED's no-crossing rule settles most sibling competitions before a score is consulted,
  so what a better score buys is mostly WHICH gloss wins, not how many pairs are held.
"""
from __future__ import annotations

import copy
import re
import threading

from . import convert, parse, vectors

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
# ⚠⚠ **THE EXACT-UPOS GATE IS GONE, ON INSTRUCTION, REVERSING WHAT THE BLOCK BELOW RECORDS.** The
# word class is now neither a gate nor a term: two words may be paired whatever they are tagged.
# ⚠️ WHAT IT BUYS, MEASURED: on `samples/la_virgil.conllu`, 34 -> 37 pairs, and all three gains are
# correct -- `căno`/*sing*, `memorem`/*mindful*, `primus`/*first*. Those are exactly the tokens the
# gate was refusing over a TAGGING disagreement rather than a real one (the English model reads
# `sing` as a NOUN in "I sing of arms", and *first* really is an ADV against Latin's ADJ). Sanskrit
# goes 29 -> 45, Chinese 6 -> 7, Arabic unchanged.
# ⚠️ **AND WHAT IT COSTS, WHICH IS REAL AND SHOULD NOT BE DISCOVERED LATER:** the MISMATCH control --
# every sentence handed a DIFFERENT sentence's translation, so every pair it produces is spurious by
# construction -- roughly doubles, Sanskrit 20 -> 38 and Latin 18 -> 25. The gate was carrying more
# of this feature's precision than its one-line implementation suggested.
# ⚠️ TWO REPLACEMENTS WERE MEASURED AND NEITHER IS IN THE TREE. Reinstating UPOS as a graded TERM
# (exact 1.0 / same openness 0.5 / else 0.0, W_REL reduced to make room) recovers nothing: at every
# weight from 0.20 to 0.50 the mismatch control stays at 34-37, because THETA is far below what an
# exact-relation pair scores and so the term never actually excludes anything -- the gate was doing
# the excluding. A CONDITIONAL gate (classes may differ only where `_sem_score` clears a bar) IS
# precision-safe -- at 0.55 it gives sa 29 -> 32, zh 6 -> 7, with both mismatch controls UNCHANGED --
# but it does not reach the three Latin gains above, so it answers a different request. It is one
# `if` away if the precision cost proves to matter: refuse a class-mismatched pair whose
# `_sem_score(s, e)` is below 0.55.
#
# The block below is the reasoning the gate WAS built on, kept because it records what the exact
# rule bought and what it cost:
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
# score = W_REL*R + W_SEM*S + W_FEAT*F + W_ORD*O, every term in [0,1].
# Relation and word class are the two things the reader asked to match on; word class is now a GATE
# (below), so the relation carries the structural half alone.
_W_REL, _W_SEM, _W_FEAT, _W_ORD = 0.80, 0.09, 0.09, 0.012
# ⚠ (iv)'s ONE EXEMPTION, sized by two inequalities rather than picked -- see (vi)/(vii) below and the
# ⚠ block in `_pair_score`. It is added ONLY where `_sem_score` is at ceiling, i.e. where the cosine
# has cleared `_SEM_HI`, which this module has already defined as a value chance does not reach.
_W_SEM_CERTAIN = 0.325
# ⚠ THESE FIVE INEQUALITIES ARE THE SPECIFICATION; the literals are only one solution of them, and
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
#   (iv) W_SEM + W_FEAT + W_ORD < W_REL*(R_BASE-R_CLASS) -- NOTHING MAY OVERTURN A RELATION-CLASS
#        DIFFERENCE. This is the one the semantic term is bounded BY, and it is what keeps the
#        relation the primary evidence now that a second, non-structural signal is in the sum: two
#        words may mean exactly the same thing and still not be each other's gloss if one is a
#        subject and the other a complement. ⚠ It also means W_SEM could not simply be made large:
#        with W_FEAT and W_ORD held at the values they already had (so that a document with no vector
#        table scores byte-identically to before -- see the ⚠ below), 0.098 is the whole budget, and
#        0.09 spends it while leaving (iv) a margin.
#   (v)  W_SEM >= W_FEAT -- meaning is never the weakest thing in the sum. Equality is the current
#        solution and is deliberate: the subtype features and the vector table are the two pieces of
#        NON-structural evidence here, they are independent of each other, and there is no
#        measurement that ranks one above the other.
# ⚠ (iv) HAS EXACTLY ONE EXEMPTION, and it is not a weight: a pair whose `_sem_score` is at CEILING is
# scored as though its relation matched EXACTLY (see `_pair_score`). That is not "meaning outweighing
# structure by 0.32" -- it is the claim that at a cosine chance cannot reach, the two ARE the same
# word, and a relation LABEL is the likelier thing to be wrong. Expressed as a promotion rather than a
# bonus so it cannot be tuned into outweighing anything else by accident, and so the arithmetic below
# stays exactly as it is for every pair that is not certain.
# ⚠ (i) IS DELIBERATELY NOT EXTENDED TO THE SEMANTIC TERM, and that is the one hierarchy this release
# changes. It reads "features and position may not overturn a relation SUBTYPE"; W_SEM + W_FEAT is
# 0.18 against that rung's 0.12, so meaning TOGETHER WITH agreeing features may. That is the point of
# having the term: a subtype is a language-particular refinement of a relation (`obl` against
# `obl:tmod`), and which of two candidates a word actually MEANS is better evidence about which word
# glosses it than which of the two trees happened to write the refinement. The CLASS rung above it is
# untouched, so the widening is bounded and (iv) is what bounds it.
# Linear order earns its 0.012 only because without it the solver's choice between two
# indistinguishable siblings is arbitrary and therefore unstable between runs, and the gloss would
# flicker on an unrelated edit.
# The weights sum to 0.992 rather than 1.0; normalising would hide the derivation.

_R_EXACT, _R_BASE, _R_CLASS, _R_SUPER = 1.00, 0.85, 0.60, 0.35

# ⚠ THRESHOLD DERIVED, NOT PICKED, and with UPOS now a gate it states one thing only -- HOW CLOSE THE
# RELATION MUST BE.  The rungs, against 0.42:
#   supertype only (obj vs obl-ish across the argument boundary) 0.80*0.35 = 0.280, at most 0.382 with
#                                                                perfect features and order  -> REJECT
#   same class     (obj vs iobj)                                 0.80*0.60 = 0.480            -> admit
# So the rule reads in one sentence: the two words must carry the same word class outright, and their
# relations must agree at least at CLASS level.  Features and order can no longer rescue a supertype
# pair -- deliberately, since with one structural signal left there is nothing to weigh it against.
# ⚠ MEANING CAN, IN PRINCIPLE, AND ON THE SAMPLES IT NEVER HAS -- which is worth recording as a
# measurement rather than left as a hazard someone re-derives. A supertype pair scores 0.280, and
# meaning alone tops out at 0.370, still short; it takes a confident vector match AND agreeing subtype
# features together (0.472) to cross. Measured on the three translated samples: of the 44 pairs the
# aligner produces, 37 sit on the `exact` relation rung, 4 on `base` and 3 are rescued by
# `_rel_score_pair`'s adposition transparency -- and NOT ONE on the supertype rung, so this branch has
# never yet decided anything. The widening is real but narrow, it can only ever fire on two words that
# are the SAME WORD by both available non-structural measures, and it narrows nothing. ⚠️ Note which
# mechanism does the work that LOOKS like this one: the obj-against-obl pairs a reader would expect to
# be rescued here (`Arma`/*arms* at 0.381) are instead made CLASS-level by the adposition rule, which
# is evidence-conditioned where this is not.
_THETA = 0.42
# THETA_LIFT is exactly the score of a pair EXACT on one signal and only openness-level on the other
# (0.40*1.00 + 0.40*0.50 = 0.60), so the rule for a match that crosses a tree level reads in one
# sentence: it must be exact on at least one of relation or word class.  A threshold, deliberately,
# rather than a second decay mechanism -- one mechanism is easier to test than two.
_THETA_LIFT = 0.60

# ── the semantic term: what the two words MEAN, from the aligned vector tables ──────────────────
# ⚠ THE COSINE IS NOT THE SCORE; THE RAMP BETWEEN TWO MEASURED CUTS IS. Every asset in the release
# lives in one shared 128-dimensional space with unit-length rows, so a dot product of two words'
# vectors IS their cosine — but that cosine occupies only the bottom of [0,1] and its floor is not 0.
# ⚠️ AND THE FLOOR HAS TO BE MEASURED FOR THE RULE ACTUALLY IN USE, which is `vectors.token_vector`'s
# MEAN of a token's form and lemma rows (see that function for why both, and why a mean rather than a
# max). 4 000 random (source, English) TOKEN pairs per language, each token given two random keys so
# the draw has the same shape a real one does, from the top 20 000 rows where real tokens are:
#
#     random pair cosine        la          zh          ar          fa
#       median                  0.004       0.051       0.014       0.026
#       90th percentile         0.146       0.180       0.136       0.144
#       99.9th percentile       0.356       0.372       0.314       0.335
#
# and against that, real translation pairs from the samples themselves: `venit`/*came* 0.61,
# `مدرسة`/*school* 0.69, 可爱/*cute* 0.62, `litora`/*shores* 0.56, `passus`/*suffered* 0.55,
# `arma`/*arms* 0.52, 我/*I* 0.44 — while the wrong pairings in the same sentences sit at 0.08–0.29.
# So _SEM_LO is the HIGHEST per-language 90th percentile of CHANCE (a cosine at or below it is what an
# unrelated pair routinely scores, i.e. no evidence — and taking the highest rather than the pooled
# figure means the cut is honest for zh, whose floor is the highest of the four, as well as for the
# rest) and _SEM_HI is above every 99.9th (a cosine at or above it is one chance does not reach, i.e.
# the same word). Between them the term ramps linearly. Reading the raw cosine as the score instead
# would spend the term's whole budget on a band the signal never uses and leave a correct pair and a
# chance one 0.17 apart where the ramp puts them 0.50 apart.
# ⚠️ _SEM_LO WENT 0.15 -> 0.18 WHEN THE MEAN RULE ARRIVED, and that is the calibration doing its job
# rather than a tuning: averaging in a second key lifts chance a little (zh's 90th percentile 0.157 ->
# 0.180) along with everything else, so a cut left at 0.15 would have been below the noise for one of
# the four languages measured. It costs a typical correct pair almost nothing — the gold median maps
# to S = 0.44 rather than 0.47.
_SEM_LO, _SEM_HI = 0.18, 0.50

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


# ⚠ THE THREE RELATIONS AN ADPOSITION CAN INTRODUCE. A language marks a nominal's role either with a
# CASE ENDING or with an ADPOSITION, and UD then labels the arc by what the nominal hangs off rather
# than by the role: `obj` under a verb, `obl` under a verb with oblique marking, `nmod` under a
# nominal. Latin and English pick different strategies for the same role, so the SAME correspondence
# comes back under two different labels and the relation gate refuses it.
_OBL_MARKABLE = frozenset(("obj", "obl", "nmod"))


def _rel_score_pair(s, e) -> float:
    """:func:`_rel_score` with ONE transparency: an adposition that introduces an oblique lets its
    nominal be compared to the other language's nominal whatever UD labelled the arc.

    ⚠ THIS IS THE SINGLE BIGGEST CAUSE OF A MISSED GLOSS BETWEEN A CASE LANGUAGE AND A PREPOSITIONAL
    ONE, and it is a labelling artefact rather than a disagreement about the sentence. Measured on
    `samples/la_virgil.conllu`, six of the nineteen unmatched tokens are exactly this, and every one
    of the six is a correct pair the module was refusing:

        `Arma`    obj      / *arms*   obl:arg   supertype only -> 0.381, just under THETA 0.42
        `Italiam` obj      / *Italy*  obl:mod   supertype only -> 0.288
        `oris`    nmod     / *shores* obl:arg   MOD against COMP -> ineligible outright
        `fato`    nmod     / *fate*   obl:arg   MOD against COMP -> ineligible outright
        `Junonis` obl:mod  / *Juno*   nmod      COMP against MOD -> ineligible outright
        `Romae`   nmod     / *Rome*   obl:arg   MOD against COMP -> ineligible outright

    ⚠ CONDITIONED ON THE ADPOSITION BEING THERE, not applied to the taxonomy at large. Simply putting
    `nmod` in `obl`'s class was measured first and reaches the same six, but it also moves `nmod` out
    of MOD — so `nmod` against `amod`, two ways of modifying a noun, would stop being comparable at
    all. This rule fires only where one side actually carries a case-marking adposition, which is the
    evidence that the two labels are describing one relation; everything else scores as before.

    ⚠ AND THE ADPOSITION ITSELF STAYS IN THE POOL. The other reading of "let it pass through" —
    dropping a `case` adposition the way PUNCT is dropped — was built and measured and is WORSE: 26
    pairs against 27, because it loses `ab`/*from* (a gloss a reader wants) and recovers nothing,
    a `case` marker being a leaf whose removal changes no structure. Glossing it from its host's match
    instead does not rescue it either, since the host is precisely what was unmatched.

    It can only ever RAISE a score, and only to `_R_CLASS` — never to the exact or base rung, because
    the two labels genuinely are different labels. A pair already at class level or better is
    untouched.
    """
    r = _rel_score(s["deprel"], e["deprel"])
    if r >= _R_CLASS or not (s.get("adp") or e.get("adp")):
        return r
    if _rel_base(s["deprel"]) in _OBL_MARKABLE and _rel_base(e["deprel"]) in _OBL_MARKABLE:
        return _R_CLASS
    return r


def _upos_ok(a: str, b: str) -> bool:
    """Exact agreement. Kept as the plain string test; `_upos_compatible` is what the score asks."""
    return bool(a) and a == b


# ⚠ THREE SUPERCATEGORIES, AND A CLASS DIFFERENCE **INSIDE** ONE IS FREE. What a word class is FOR,
# cross-linguistically, is telling nominals from predicates from modifiers; the finer distinctions
# inside each group are where two languages' tagging conventions legitimately differ over one word.
# Latin `primus` is an ADJ where the English model reads *first* as an ADV — the same word, modifying
# the same verb, filed under two labels because English ordinals in that position are adverbial. A
# substantivised adjective (`alto` "the deep") is a NOUN or an ADJ depending on the treebank's policy,
# not on the sentence. PRON with NOUN is the same story wherever a language pronominalises what
# another spells out.
# Deliberately NOT a group each: DET, ADP, CCONJ, SCONJ, PART, INTJ, SYM, X are function words whose
# tagging is far more stable and whose vectors are the weakest in any table -- for them the strict
# rule is right, and they fall through to the meaning gate below, which they will rarely clear.
_POS_GROUP = {
    "NOUN": "NOMINAL", "PRON": "NOMINAL",
    "VERB": "PREDICATE", "AUX": "PREDICATE",
    "ADJ": "MODIFIER", "ADV": "MODIFIER", "NUM": "MODIFIER",
}
# ⚠ **PROPN IS DELIBERATELY IN NO GROUP, THOUGH IT IS AS "NOUNY" AS A NOUN GETS** -- measured, and the
# one place this table was corrected against its own first draft. A NAME against a COMMON NOUN is not
# two conventions for one word, it is two kinds of word; and PROPN is the class `_SEM_SKIP_UPOS`
# excludes from the semantic term, so leakage there is the one kind nothing downstream can check.
# Measured on a Ramayana file, with PROPN inside NOMINAL: sentence 1's names ROTATE --
# `tapasvī` -> *Valmiki*, `vāc` -> *Narada*, `nāradaṃ` -> *practice*, `muni` -> *Vedas*, 1 correct of
# 9. With PROPN outside it, the same sentence gives `tapaḥ` -> *austerities*, `tapasvī` -> *ascetic*,
# `varam` -> *best*, `muni` -> *sages*, about 5 of 7. Across the files it also takes the MISMATCH
# controls back down -- Latin 21 -> **18**, i.e. exactly the level of the strict gate this replaced,
# and Sanskrit 32 -> 27 -- for a cost of 3 pairs (sa 43 -> 40) and none at all on la/zh/ar.
# The effect is that a name can pair only with a name: PROPN against PROPN is an exact match, and
# PROPN against anything else needs a meaning score `_sem_score` will never give it.

# ⚠ AND ACROSS GROUPS, THE MEANING HAS TO SAY THEY ARE THE SAME WORD. A nominal paired with a
# predicate is a real claim, not a tagging quibble, so it needs evidence of its own -- and the vector
# tables are exactly that evidence. ⚠️ WITH NO TABLE `_sem_score` IS 0.0, so this falls back to
# "same group or nothing", i.e. a language the release does not cover keeps a rule at least as strict
# as the exact one it had. That is what makes the relaxation safe to ship for most languages.
_CROSS_POS_SEM = 0.55

# ⚠ `dep` IS UD'S "NO RELATION COULD BE DETERMINED" — A SHRUG, NOT A CLAIM, and scoring it as
# incompatible with everything reads it as one. It has no class in `_REL_CLASS`'s taxonomy that means
# anything, so it lands in SPECIAL and disagrees with every real relation, which refuses the pair
# outright however good the rest of the evidence is. Measured: `samples/la_virgil.conllu`'s `altae`
# (ADJ `amod`) against *lofty*, which the English model tagged ADP with deprel `dep`, has a cosine of
# **0.392** and passes `_upos_compatible` on its meaning — and was refused on the relation alone.
# ⚠️ UNINFORMATIVE IS NOT THE SAME AS PERMISSIVE, and the difference is measured. Letting `dep` match
# anything at class level unconditionally gains `altae`/*lofty* but also **+2 spurious Sanskrit pairs**
# (its mismatch control 27 → 29), because it makes every `dep`-tagged token compatible with everything.
# Requiring the MEANING to vouch instead — the same bar and the same reasoning as `_CROSS_POS_SEM`
# above, which is why it is that constant rather than a second one — gains `altae`/*lofty* and moves
# NO control at all: sa 41, la 34 → 38, mismatch 27 and 18, all exactly as before.
_DEP_SEM = _CROSS_POS_SEM


def _upos_compatible(s, e, sem: float) -> bool:
    """May these two be paired at all, on their word classes?  ``sem`` is `_sem_score`, passed in
    rather than recomputed -- the DP asks this O(n*m) times and it is a 128-wide dot product."""
    a, b = s["upos"], e["upos"]
    if not a or not b:
        return False
    if a == b:
        return True
    ga = _POS_GROUP.get(a)
    if ga is not None and ga == _POS_GROUP.get(b):
        return True                        # a tagging difference inside one supercategory
    return sem >= _CROSS_POS_SEM           # else the meaning must vouch for it


def _feat_score(a: str, b: str) -> float:
    """Jaccard over the subtype features.  ⚠ ZERO WHEN BOTH ARE SILENT: two tokens that say nothing
    agree about nothing, and scoring silence as agreement would make this term a constant that lifts
    every pair equally -- i.e. no term at all, while still eating its 0.15 of the budget."""
    fa, fb = _feat_set(a), _feat_set(b)
    union = fa | fb
    if not union:
        return 0.0
    return len(fa & fb) / len(union)


# ⚠ A PROPER NOUN IS NOT SCORED ON MEANING, AND THIS IS MEASURED RATHER THAN ASSUMED.  A name's
# distribution is its REGION AND PERIOD, not its identity, so the table retrieves the other names that
# keep it company.  Against the `la`→`en` tables, gold rank of the correct English name among the
# 50 nearest:
#     troiae   / Troy      >50   (peloponnese .46  laconia .45  aeneas .44  thessaly .44)
#     italiam  / Italy     >50   (normans .45  lombards .41  morea .38  romans .37)
#     lavinia  / Lavinian  >50   (lavinia .46  umbria .41  dionysus .40  livia .40)
#     latio    / Latium    >50   (topography .48  gradual .47  cessation .46)
# against rank 1 for `litora`/shores, `arma`/arms and `bello`/war.  A COMMON word's wrong neighbour is
# a near-synonym (`moenia` retrieves *fortifications* before *walls*), which still points the right
# way; a NAME's wrong neighbour is a different place, confidently.  Measured consequence on the three
# translated samples: over the 20 source nodes with more than one eligible English candidate, the
# semantic term moves the argmax exactly once with this exclusion LIFTED — `Lavinia` from *Lavinian*
# to *Troy* — and that one is wrong.  With it, none.  (It was twice, `Latio`/*Rome* as well, while the
# lookup was form-only; adding the lemma fixed that one and left this one exactly as it was.)
# The structural position is simply the better evidence for a name, which is also why a name's gloss
# is usually transferred rather than translated.
# ⚠️ RE-CHECKED WHEN THE LEMMA JOINED THE LOOKUP, because a case lemma is the obvious thing that might
# have rescued these — and it does not. Under the mean of form and lemma: `Troiae`/Troy still >50
# (aeneas .51, theseus .51, laconia .49), `Latio`/Latium still >50, `Teucrorum`/Trojans still >50,
# `Lavinia` has no lemma row at all; only `Italiam`/Italy moves at all, >50 -> 18. A name's neighbours
# are its region-mates whichever key you ask by, so the exclusion is about the CLASS and not about the
# inflection.
_SEM_SKIP_UPOS = frozenset(("PROPN",))


def _sem_score(s, e) -> float:
    """How close the two words are IN MEANING, in [0,1] — 0.0 for a name, and 0.0 where either word
    has no vector.

    ⚠ ABSENCE IS NEUTRAL, NEVER A PENALTY, and that is what makes this term additive rather than a
    new dependency. Four ordinary situations produce no vector — the release covers thirteen
    languages and this document is in a fourteenth, the tables were never fetched, NEITHER the word
    nor its lemma is in its table (English type coverage is 84.8 %, and several source tables are
    well below that), or the token is one the conversion fused — and in every one of them the pair
    falls back to exactly
    the structural score it had before this term existed. A NEGATIVE contribution would instead make
    a missing table into an argument against a pair, which is a claim the absence cannot support: the
    three weakest tables (sa 11.5 %, lzh 6.8 %, yue 10.7 % held-out P@1) are precisely the languages
    this app cares most about, and there a silent word is far more often absent than wrong.
    """
    if s["upos"] in _SEM_SKIP_UPOS:     # the classes agree by gate, so one test answers for both
        return 0.0
    va, vb = s.get("vec"), e.get("vec")
    if va is None or vb is None:
        return 0.0
    cos = float(va @ vb)          # unit-length rows: the dot product IS the cosine
    if cos <= _SEM_LO:
        return 0.0
    if cos >= _SEM_HI:
        return 1.0
    return (cos - _SEM_LO) / (_SEM_HI - _SEM_LO)


def _pair_score(s, e, n_s: int, n_e: int):
    """The score for one candidate pair, or ``None`` where the pair is INELIGIBLE.

    ⚠ TWO GATES BEFORE ANY SCORING: the relations must at least be relatable, and the word classes
    must be COMPATIBLE (`_upos_compatible` -- same class, same supercategory, or vouched for by the
    meaning).  It is not a score --
    an ineligible pair is not a low-ranked one, it is not a candidate at all, which is what keeps
    `nsubj` out of `advmod`'s slot however well the rest of the evidence lines up.  The threshold then
    does the only job it is good at: ranking among pairs that have already passed it.

    ⚠ AND IT IS ASKED FIRST BECAUSE IT IS ALSO THE CHEAPEST.  `_sem_score` is a 128-wide dot product;
    a string comparison that can refuse the pair outright belongs ahead of it, and the DP asks this
    question O(n*m) times over.
    """
    r = _rel_score_pair(s, e)
    m = None
    if r <= 0.0:
        # An unrelatable relation refuses the pair — unless one side is `dep`, which states nothing
        # (see `_DEP_SEM`). Tested before `_sem_score` is computed, so the ordinary rejection path —
        # which is most (source, English) pairs — still costs two string comparisons and no dot
        # product.
        if "dep" not in (_rel_base(s["deprel"]), _rel_base(e["deprel"])):
            return None
        m = _sem_score(s, e)
        if m < _DEP_SEM:
            return None
        r = _R_CLASS
    if m is None:
        m = _sem_score(s, e)             # computed once: the class gate reads it, then the score does
    if not _upos_compatible(s, e, m):
        return None
    certain = _W_SEM_CERTAIN if m >= 1.0 else 0.0
    if certain:
        # ⚠ A CERTAIN COSINE MAY CROSS ONE RELATION RUNG -- the one place meaning is allowed
        # past invariant (iv). `m` reaches 1.0 only at `_SEM_HI`, which this module has already
        # defined as a cosine CHANCE DOES NOT REACH, i.e. the two really are the same word; and a
        # relation LABEL is the thing most likely to be wrong when two treebanks disagree about how a
        # phrase is built. Measured on the reported case: `samples/la_virgil.conllu`'s `iram` sits
        # under an English parse that read the fixed preposition "on account of" compositionally, so
        # *account* heads the phrase at `obl:mod` -- an EXACT relation match with a cosine of
        # **-0.003** -- while *anger*, cosine **0.584**, is one rung down at `nmod`. Structure scored
        # 0.810 against 0.581 and glossed `iram` as *account*.
        # ⚠️ A FLAT BONUS, NOT A PROMOTION TO `_R_EXACT`, and that was measured: promoting the RUNG
        # lifts a SUPERTYPE pair by 0.52 where it lifts a class pair by 0.32, which is more than this
        # exemption is entitled to. It showed: the Latin fix landed either way, but the Ramayana's
        # sentence 4 reshuffled and lost `ko`/*who*. A flat term lifts every certain pair by the same
        # amount and touches nothing else.
        # ⚠️ AND IT ONLY EVER RE-RANKS: measured across la/sa/zh/ar plus both mismatch controls, every
        # count is unchanged (40/35/7/4, MIS 27/18) and `iram` becomes *anger*. It cannot admit a pair
        # the gates refused, because those are asked above and this is not one of them.
        pass
    f = _feat_score(s.get("feats", ""), e.get("feats", ""))
    # normalised position in each sentence, so two sentences of different lengths are comparable
    o = 1.0 - abs((s["i"] / n_s if n_s else 0.0) - (e["i"] / n_e if n_e else 0.0))
    return _W_REL * r + _W_SEM * m + _W_FEAT * f + _W_ORD * o + certain


# ── tree helpers ───────────────────────────────────────────────────────────────────────────────
_SKIP_UPOS = frozenset(("PUNCT", "SYM"))


def _vec_for(vec, token: dict):
    """This token's row in an :class:`AlignedVectors` table, or ``None``.

    ⚠ IT IS THE **CONVERTED UD** TOKEN THAT IS LOOKED UP, not the reader's own -- the opposite of the
    rule the FORM and LEMMA written into the gloss follow (see the ⚠ at the foot of
    `gloss_from_translation`, which reads those off the unconverted parse).  The two rules disagree
    because they answer different questions.  A gloss is a spelling and the conversion has no business
    rewriting one; a vector lookup wants a WORD, and mSUD->UD is precisely the direction that fuses a
    document's morphemes back into words.  Measured on `samples/chinese_msud.conllu`: the source
    tokens are 问 and 题 separately, which the zh table (fastText, word-keyed) scores against English
    *questions* at 0.30 and not at all respectively, while the fused UD node 问题 scores 0.42.  The
    SUD->UD direction fuses nothing, so for every other document the two readings are the same string.
    """
    if vec is None:
        return None
    return vectors.token_vector(vec, token.get("form", ""), token.get("lemma", ""))


def _tree(tokens: list[dict], vec=None) -> dict:
    """Index a UD token list into ``{children: {id: [node]}, roots: [node], n: int}``.

    ⚠ PUNCT and SYM are dropped from the candidate pools: they match trivially and meaninglessly,
    and a Chinese 。glossed "." is worse than no gloss at all.  A dropped token's own children are
    re-parented onto its head, so dropping one can never sever a subtree (in a well-formed tree
    punctuation is a leaf anyway; this is the guard for the case where it is not).

    ⚠ EACH NODE'S VECTOR IS LOOKED UP ONCE, HERE, AND NOT INSIDE THE SCORING FUNCTION.  The DP asks
    `_pair_score` about the same node many times over -- once per keyroot pair that reaches it, and
    again during the backtrack -- while a token's vector is a fact about the token.  The lookup is a
    dict hit plus (for `la`) an orthography fold, so doing it n+m times rather than O(n*m) times is
    worth the one extra field; the dot product itself still runs per pair, which is what it is for.
    """
    nodes = []
    for i, t in enumerate(tokens):
        nodes.append({"i": i, "id": i + 1, "form": t.get("form", ""), "lemma": t.get("lemma", ""),
                      "upos": t.get("upos", ""), "feats": t.get("feats", ""),
                      "deprel": t.get("deprel", ""), "head": t.get("head", "0"),
                      "vec": _vec_for(vec, t),
                      "adp": False,
                      "skip": t.get("upos", "") in _SKIP_UPOS})
    by_id = {nd["id"]: nd for nd in nodes}

    # ⚠ WHICH NODES AN ADPOSITION INTRODUCES -- read off the RAW head rather than `live_head`, because
    # a `case` marker attaches directly to its own nominal and nothing between them is ever dropped.
    # Marked here rather than asked per pair: it is a fact about the token, and `_rel_score_pair` is
    # called O(n*m) times.
    for nd in nodes:
        if nd["upos"] != "ADP" or _rel_base(nd["deprel"]) != "case":
            continue
        try:
            host = by_id.get(int(nd["head"]))
        except (TypeError, ValueError):
            continue
        if host is not None:
            host["adp"] = True

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
            "live": [nd for nd in nodes if not nd["skip"]],
            "tokens": tokens}       # kept for `_expand_spans`, which needs the SURFACE, live or not


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


def align(src_tokens: list[dict], en_tokens: list[dict], src_vec=None, en_vec=None,
          lang: str = "") -> list[dict]:
    """Align two UD token lists by TREE EDIT DISTANCE.  Returns ``[{"src": i, "en": j, "score": f},
    ...]`` -- 0-based indices into the two lists, one-to-one and ancestor-preserving.

    The pairs are the RENAME operations of a cheapest edit script turning one tree into the other;
    everything the two languages do not share falls out as a deletion or an insertion, which is the
    honest answer for a word the other language simply does not have (English has articles most
    languages do not, and vice versa).

    ``src_vec``/``en_vec`` are the two languages' :class:`AlignedVectors` tables (app/vectors.py),
    and BOTH DEFAULT TO ``None`` because both are optional equipment: with either absent every pair
    scores on structure alone and this function returns exactly what it returned before the tables
    existed.  That is a property worth keeping deliberately -- see the ⚠ in `_sem_score`.
    """
    st, et = _tree(src_tokens, src_vec), _tree(en_tokens, en_vec)
    A, A_left = _postorder(st)
    B, B_left = _postorder(et)
    n, m = len(A), len(B)
    n_s, n_e = st["n"], et["n"]

    scores = {}
    ren_cost: dict[tuple[int, int], float] = {}

    def ren(i, j):
        """Rename cost, and the ONLY place the linguistic score enters the optimisation.

        MEMOISED on (i, j), which is free correctness as well as speed: the DP visits a pair once per
        keyroot pair that reaches it and the backtrack re-runs `_forestdist` for every tree pair it
        descends into (see that function's own note on recomputing rather than storing), so this is
        asked several times for the same two nodes and must give the same answer each time."""
        hit = ren_cost.get((i, j))
        if hit is not None:
            return hit
        a, b = A[i], B[j]
        if a is None or b is None:          # the two virtual roots rename to each other for free, and
            cost = 0.0 if (a is None and b is None) else _BIG   # to nothing else at any price
        else:
            sc = _pair_score(a, b, n_s, n_e)
            if sc is None or sc < _THETA:   # ineligible, or not worth reporting -- see _DEL's note
                cost = _BIG
            else:
                scores[(i, j)] = sc
                cost = 1.0 - sc
        ren_cost[(i, j)] = cost
        return cost

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
    # Retrieval fills what the tree could not place; the decomposition then treats every pair as an
    # anchor and re-aligns WITHIN corresponding subtrees; expansion runs last, so it sees the final
    # pair set and its "nothing already used" guard is answered against all of it.
    return _expand_spans(st, et, _decompose(st, et, _gloss_by_meaning(st, et, pairs, lang)))


# ── the retrieval fallback: gloss what the TREE could not place ────────────────────────────────
# ⚠ THIS IS RETRIEVAL, NOT ALIGNMENT, AND IT RUNS ONLY ON WHAT THE EDIT SCRIPT LEFT OVER. Every
# table in the release lives in ONE shared space, so a source word can be compared to an English word
# with no structure between them at all: for a token the tree could not place, take the nearest
# UNUSED English word in that same sentence. It reaches exactly what an edit distance cannot -- a
# Sanskrit compound member (`muni`, `jita`) is a bound morpheme with no independent structural
# counterpart, but it means something and the translation says it.
#
# ⚠ NO ROTATION IS FITTED, AND THAT WAS MEASURED RATHER THAN ASSUMED. The obvious refinement is to
# fit a per-document map from the pairs the alignment DID make -- the same orthogonal Procrustes the
# release uses to build the shared space -- and project the leftovers through it. Evaluated
# LEAVE-ONE-OUT (fitting on the anchors and scoring on those same anchors proves nothing), it is
# catastrophic:
#
#     top-1 over the sentence's own English words   sa_ramayana (23 anchors)   la_virgil (31)
#       no rotation                                        5/23                    19/31
#       orthogonal Procrustes                              1/23                     4/31
#       shrunk toward identity (any lambda)                5/23                    19/31
#
# 23 anchors span ~23 of 128 dimensions and the rotation's remaining ~100 come out arbitrary. The
# regularised form's optimum is lambda -> infinity, which IS "do not rotate". Upstream's own rotations
# were fitted on 5 597 - 83 367 anchor words, and its docs record the same lesson from the other end:
# a per-language PCA takes retrieval from 63.8 % to 0.0 %. The space is a global object; do not
# re-fit it locally.
#
# ⚠ THE BAR CLEARS THE CHANCE **MAXIMUM**, NOT A PERCENTILE, because this is retrieval rather than
# scoring: each token is asked against ~20 candidates and a document against hundreds, so the tail is
# reached routinely where `_SEM_LO`'s 90th-percentile cut would be reached once. Measured over 4 000
# random token pairs per table, the largest chance cosine seen is la 0.397, sa 0.398, zh 0.435,
# ar 0.430, fa 0.421 -- so 0.50 sits clear of all of them. It is the difference between safe and not:
# at 0.40 the Sanskrit file gains 12 glosses and its MISMATCH control gains 6 (it writes `ko` ->
# *things*, `samartho` -> *Indeed*), while at 0.50 it gains 5, all correct, and the mismatch control
# gains NOTHING. Measured at 0.50 across `samples/la_virgil.conllu` and a Ramayana file: **6 new
# glosses, 6 correct, 0 spurious**, mismatch control flat at 0 on both.
_FALLBACK_COS = 0.50

# ⚠ OPEN CLASSES ONLY, ON BOTH SIDES. A function word's vector is the weakest thing in any of these
# tables -- its distribution is its syntax -- and it is also the case the TREE already handles well
# (`que`/*and*, `ab`/*from* are exactly the pairs the edit script gets right). So the fallback is
# confined to the words a vector is actually good for. PUNCT and SYM never reach here at all; `_tree`
# has already dropped them.
_FALLBACK_SKIP_UPOS = frozenset(("DET", "ADP", "AUX", "PART", "SCONJ", "CCONJ"))

# ⚠ A DICTIONARY CONFIRMATION IS BETTER EVIDENCE THAN A HIGH COSINE, SO IT EARNS A LOWER BAR.
# `_FALLBACK_COS` has to clear the chance MAXIMUM because a cosine alone is unspecific -- it is asked
# hundreds of times per document and the tail is reached routinely. Where an OFFLINE dictionary
# independently lists the candidate English word under the source word's own headword, that
# unspecificity is gone: the dictionary is the primary evidence and the cosine only has to say the
# two are not unrelated, so it need clear no more than the ordinary 99th percentile of chance
# (`sa` 0.278 -- see `_SEM_LO`'s own table). Measured on a Ramayana file: of 123 candidate pairs
# above cosine 0.25, Apte confirms **11**, and they sit at 0.281-0.475 -- every one of them BELOW
# `_FALLBACK_COS`, so the plain bar reaches none of them. They are `tapasvī`/*Ascetic*,
# `vidvān`/*learned*, `guṇavān`/*qualities*, `cāritreṇa`/*conduct*, `kautūhalaṃ`/*curiosity*, `eka`/
# *one* and the like. Meanwhile the dangerous near-misses the plain bar only just excludes --
# `ko`/*things* 0.491, `samartho`/*Indeed* 0.469, `vidvān`/*knowledge* 0.454 -- are rejected by the
# dictionary outright. It is a sharper filter than the cosine at any threshold.
_FALLBACK_COS_DICT = 0.28

# ⚠ SANSKRIT ONLY, AND THAT IS ABOUT WHICH DICTIONARY IS ON DISK RATHER THAN ABOUT THE LANGUAGE.
# `app/apte.py` is vendored, offline and 77.5k entries; `app/wiktionary.py` -- the app's dictionary
# for every other language -- is a NETWORK lookup, and a per-token round-trip inside a pass that
# already costs seconds is not a trade this feature can make. If an offline dictionary ever lands for
# another language, this is the one place to widen.
_DICT_LANGS = frozenset(("sa",))
HUB_LANG = "en"                  # the shared space's hub; every table is rotated onto it


def norm_dict_lang(lang: str) -> str:
    """``sa``/``san``/``sa-Deva`` all name Sanskrit; anything else answers with itself."""
    from . import vectors
    return vectors.norm_lang(lang)
_dict_cache: dict[tuple, frozenset] = {}


def _dict_words(lang: str, lemma: str, upos: str) -> frozenset:
    """The English words the offline dictionary gives for this headword, lowercased and cached.

    Failure is an EMPTY SET, never an exception: a missing `aksharamukha`, an unreadable index or a
    headword the dictionary does not carry all mean "no confirmation", which simply leaves the pair
    to the ordinary `_FALLBACK_COS` bar."""
    key = (lang, lemma, upos)
    hit = _dict_cache.get(key)
    if hit is not None:
        return hit
    words: set = set()
    try:
        from . import apte
        for d in apte.lookup(lemma, lang, upos).get("definitions") or []:
            for w in re.findall(r"[A-Za-z]+", d.get("text", "")):
                if len(w) > 2:          # "a", "of", "to" confirm nothing
                    words.add(w.lower())
    except Exception:  # noqa: BLE001 — an optional dictionary must never break the glossing pass
        words = set()
    out = frozenset(words)
    _dict_cache[key] = out
    return out


def _gloss_by_meaning(st, et, pairs: list[dict], lang: str = "") -> list[dict]:
    """Append a gloss for each leftover source token whose nearest unused English word clears
    :data:`_FALLBACK_COS`.  A no-op with no vector table, which is what keeps it optional.

    ⚠ PROPN IS **NOT** EXCLUDED HERE, unlike in `_sem_score`, and the asymmetry is deliberate. That
    exclusion rests on "the structural position is simply the better evidence for a name" -- and here
    there IS no structural evidence, the tree having already failed on this token. The 0.50 bar turns
    out to filter the failure mode by itself: measured, the topical misses fall below it
    (`nāradaṃ`/*sages* 0.460, `Italiam`/*Italy* 0.420) while a real hit clears it (`Romae`/*Rome*
    0.564). It is conservative in both directions -- `Italiam`/*Italy* is correct and is lost too.

    ⚠ BEST-FIRST OVER THE WHOLE SENTENCE, not per token in index order: the assignment stays
    one-to-one either way, but taking the strongest cosine first makes the result independent of
    token order, so an unrelated edit cannot reshuffle which leftover got which word.
    """
    live_s = [n for n in st["live"] if n["upos"] not in _FALLBACK_SKIP_UPOS and n.get("vec") is not None]
    live_e = [n for n in et["live"] if n["upos"] not in _FALLBACK_SKIP_UPOS and n.get("vec") is not None]
    if not live_s or not live_e:
        return pairs
    used_s = {p["src"] for p in pairs}
    used_e = {p["en"] for p in pairs}
    use_dict = norm_dict_lang(lang) in _DICT_LANGS
    cands = []
    for a in live_s:
        if a["i"] in used_s:
            continue
        # ⚠ THE DICTIONARY IS ASKED ONCE PER SOURCE TOKEN AND ONLY WHERE IT COULD MATTER -- lazily,
        # after a candidate has already come within the dictionary tier's reach. Measured at ~83 ms a
        # lookup on this machine, so asking per (source, English) PAIR would put seconds into a pass
        # that is otherwise 0.26 s warm.
        words = None
        for b in live_e:
            if b["i"] in used_e:
                continue
            c = float(a["vec"] @ b["vec"])
            if c >= _FALLBACK_COS:
                cands.append((c, a["i"], b["i"]))
            elif use_dict and c >= _FALLBACK_COS_DICT:
                if words is None:
                    words = _dict_words(lang, a.get("lemma", "") or a["form"], a["upos"])
                if not words:
                    break                      # nothing to confirm against; skip this token's tier
                if b["form"].lower() in words or (b.get("lemma") or "").lower() in words:
                    cands.append((c, a["i"], b["i"]))
    if not cands:
        return pairs
    for c, si, ei in sorted(cands, key=lambda t: (-t[0], t[1], t[2])):
        if si in used_s or ei in used_e:
            continue
        used_s.add(si)
        used_e.add(ei)
        # The COSINE is the score, not a tree-alignment score: it is what this pair is actually
        # worth, and the two are not on one scale (a tree pair runs 0.8-0.9, this one 0.5-0.6).
        pairs.append({"src": si, "en": ei, "score": round(c, 4)})
    pairs.sort(key=lambda p: p["src"])
    return pairs


# ── re-aligning inside a matched subtree pair ──────────────────────────────────────────────────
# ⚠ AN ANCHOR LETS THE PROBLEM BE DECOMPOSED, WHICH IS THE ONE WAY PAST THE ORDERED TED'S OWN LIMITS.
# Zhang-Shasha's mapping must be ancestor-preserving and non-crossing GLOBALLY, and that refuses pairs
# that are perfectly good locally: measured, `qui`/*who* scores **0.936** with both endpoints free and
# is rejected because Latin hangs `profugus` under `qui` where English hangs *exile* under *shores*.
# Once (a, b) is matched, though, a's unmatched descendants and b's unmatched descendants are a small
# problem of their own, and pairing them inside it commits to nothing about the rest of the sentence.
# That recovers `qui`/*who*, `moenia`/*walls* and `et`/*and* -- the three this module's own history
# records as lost.
#
# ⚠⚠ **AND IT IS THE ONE THING IN THIS FILE SHIPPED WITH THE MISMATCH CONTROL AGAINST IT.** Every
# other pass here leaves that control flat; this one does not, and the number is the honest one to
# quote: at this gate the Latin file gains 4 pairs while a Latin file handed the WRONG translations
# gains 3. Three of the four are right (`qui`, `moenia`, `et`) and one is not (`Multum`/*mindful*).
# Two weaker variants were measured and are worse, not better: gating on the TOTAL score instead of on
# the meaning gives +7 real against +9 spurious (the relation term dominates the total, so a spurious
# pair with a matching relation scores 0.81 whatever it means), and re-running the whole edit script
# with the anchors forced to cost 0 is a FIXED POINT -- verified on all 8 sentences, anchors confirmed
# applied -- because ancestor-preservation is a CONSTRAINT and forcing a pair can only shrink the
# feasible set, never enlarge it.
#
# ⚠ THE GATE IS THE 99th PERCENTILE OF CHANCE, not the maximum `_FALLBACK_COS` clears. `_sem_score`
# 0.30 is cosine 0.276, against a chance p99 of la 0.261, sa 0.278, zh 0.292, ar 0.243, fa 0.257. The
# weaker bar is earned the same way `_FALLBACK_COS_DICT`'s is: a candidate here has already passed the
# relation gate, `_upos_compatible` and THETA, and must live inside a CORRESPONDING SUBTREE -- so the
# cosine is not carrying the specificity alone and need not clear the tail on its own.
# ⚠️ WITH NO VECTOR TABLE `_sem_score` IS 0.0 AND THIS PASS IS A COMPLETE NO-OP, which is what keeps
# the relaxation confined to the languages that can actually pay for it.
_DECOMP_SEM = 0.30
_DECOMP_ROUNDS = 3           # a pair added here is itself an anchor; bounded so it cannot loop


def _decompose(st, et, pairs: list[dict]) -> list[dict]:
    """Re-align each matched pair's unmatched descendants against each other, gated on the meaning."""
    byi = {n["i"]: n for n in st["live"]}
    byj = {n["i"]: n for n in et["live"]}
    if not byi or not byj or not pairs:
        return pairs
    n_s, n_e = st["n"], et["n"]
    used_s = {p["src"] for p in pairs}
    used_e = {p["en"] for p in pairs}
    for _ in range(_DECOMP_ROUNDS):
        added = []
        for p in sorted(pairs, key=lambda q: q["src"]):
            a, b = byi.get(p["src"]), byj.get(p["en"])
            if a is None or b is None:
                continue
            # ⚠ AN ANCHOR THAT COVERS THE WHOLE TREE LOCALISES NOTHING, and admitting one turns this
            # pass straight back into the global leftover sweep that was measured and rejected. The
            # ROOT is exactly such an anchor: measured on `samples/la_virgil.conllu` s2, the pair
            # `jactatus` ~ *tossed* has a source subtree of 14 of 14 live nodes and an English one of
            # 26 of 26 — the entire sentence — and it is what paired `Multum` (which modifies the
            # VERB) with *mindful* (which modifies *anger*), two words with nothing to do with each
            # other. Requiring BOTH sides to be a PROPER subset is the whole guard, and it is worth
            # what it costs: the wrong pair goes, all three right ones stay (`qui`/*who*,
            # `moenia`/*walls*, `et`/*and*), and BOTH mismatch controls fall back to the level they
            # sat at before this pass existed — Latin 21 -> 18, Sanskrit 28 -> 27. What looked like a
            # recall-for-precision trade was this defect; without it the pass costs nothing.
            sub_s, sub_e = _subtree(st, a), _subtree(et, b)
            if len(sub_s) >= len(byi) or len(sub_e) >= len(byj):
                continue
            sd = [byi[i] for i in sub_s if i in byi and i not in used_s]
            if not sd:
                continue
            ed = [byj[j] for j in sub_e if j in byj and j not in used_e]
            if not ed:
                continue
            cands = []
            for x in sd:
                for y in ed:
                    if _sem_score(x, y) < _DECOMP_SEM:      # asked FIRST: it refuses the most
                        continue
                    sc = _pair_score(x, y, n_s, n_e)
                    if sc is not None and sc >= _THETA:
                        cands.append((sc, x["i"], y["i"]))
            # Best first, so the assignment does not depend on the order the anchors happen to sit in.
            for sc, xi, yj in sorted(cands, key=lambda t: (-t[0], t[1], t[2])):
                if xi in used_s or yj in used_e:
                    continue
                used_s.add(xi)
                used_e.add(yj)
                added.append({"src": xi, "en": yj, "score": round(sc, 4)})
        if not added:
            break                                   # settled; measured to happen on the second round
        pairs = sorted(pairs + added, key=lambda q: q["src"])
    return pairs


# ── collapsing an English SUBTREE into one multi-word gloss ────────────────────────────────────
# ⚠ A SOURCE WORD OFTEN CORRESPONDS TO AN ENGLISH PHRASE, NOT AN ENGLISH WORD, and a one-to-one
# mapping can only ever hand back the phrase's head. Sanskrit is where this bites hardest: a compound
# member is a morpheme, and its translation is a whole noun phrase -- `cāritra` IS "good conduct",
# `vidvas` IS "learned in the lore". So a matched English node may be EXPANDED to its own subtree,
# and the gloss becomes that subtree's surface. ⚠️ The frontend already takes multi-word glosses:
# `applyAutoGloss` (js/io/bridge.js) writes spaces as "-" into `Gloss` and as "_" into MGloss's stem,
# which IS the Leipzig convention for several words glossing one morpheme. Nothing there changes.
#
# ⚠ EXPANSION, NOT A NEW CANDIDATE, and that is a measured choice rather than a simplification. Built
# first as an extra candidate for `_gloss_by_meaning` -- i.e. a phrase that could fill an UNGLOSSED
# token -- it fired **zero** times on both files, because by then the earlier passes have glossed most
# of what has a vector and the free subtrees no longer match anything left. Expanding a match that
# already exists improves the gloss a reader actually gets, which is where the value turned out to be.
_GLOSS_SPAN_MAX = 5              # tokens BEFORE trimming; past this a "gloss" is a sentence
# Trimmed off either END of the span, by class or by relation: they attach the phrase to the rest of
# the sentence or determine it, and neither is part of what the source word MEANS. `his gods` and
# `his vows` were the measured cases -- a possessive the source does not have.
_SPAN_TRIM_UPOS = frozenset(("ADP", "DET", "PUNCT", "CCONJ", "SCONJ", "PART", "AUX"))
_SPAN_TRIM_REL = frozenset(("det", "nmod:poss", "case", "mark", "cc", "punct"))
# ⚠ AND ANOTHER SOURCE TOKEN'S CLAIM BLOCKS THE EXPANSION at this cosine -- the same 0.50 the
# retrieval fallback uses, and for the same reason (it clears the chance maximum in every table).
_SPAN_CLAIM = 0.50


def _expand_spans(st, et, pairs: list[dict]) -> list[dict]:
    """Give a matched pair an ``en_span`` where its English node's subtree is a better gloss than the
    node alone.  Adds no pairs and removes none; it only widens what an existing pair GLOSSES.

    ⚠ THREE GUARDS, EACH OF WHICH WAS A WRONG EXPANSION BEFORE IT WAS A GUARD:
      * **nothing already used.** A span may not contain another pair's English word, or two source
        tokens would be glossed by overlapping text.
      * **never cross a coordination.** A `conj`/`cc` inside the subtree means the phrase is TWO
        things -- measured, `roṣasya` was expanded to *brilliance and free*, which is not a phrase in
        any language.
      * **nothing another source token wants.** An extra content word whose cosine to some OTHER
        source token clears `_SPAN_CLAIM` belongs to that token, not to this phrase -- measured,
        `ko` was expanded to *Who in this world*, swallowing the *world* that `loke` wants.
    Measured on `samples/la_virgil.conllu` and a Ramayana file, the surviving expansions are
    `cāritreṇa` -> *good conduct* and `vidvān` -> *learned in the lore*, both better than the head
    alone, and nothing else fires.
    """
    e_tok = et.get("tokens") or []
    if not e_tok or not pairs:
        return pairs
    byj = {n["i"]: n for n in et["live"]}
    used_e = {p["en"] for p in pairs}
    for p in pairs:
        b = byj.get(p["en"])
        if b is None:
            continue
        idx = _subtree(et, b)
        lo, hi = min(idx), max(idx)
        if not 2 <= hi - lo + 1 <= _GLOSS_SPAN_MAX:
            continue
        span = range(lo, hi + 1)
        if any(k in used_e and k != p["en"] for k in span):
            continue
        if any(_rel_base(e_tok[k].get("deprel", "")) in ("conj", "cc")
               for k in span if k != p["en"]):
            continue
        keep = _trim_span(e_tok, lo, hi, p["en"])
        if len(keep) < 2:
            continue
        if _claimed_elsewhere(st, byj, keep, p["en"], p["src"]):
            continue
        p["en_span"] = keep
    return pairs


def _subtree(tree, node) -> set:
    """Every token index under ``node``, itself included."""
    out, stack = {node["i"]}, [node]
    while stack:
        n = stack.pop()
        for k in tree["children"].get(n["id"], []):
            if k["i"] not in out:
                out.add(k["i"])
                stack.append(k)
    return out


def _trim_span(e_tok, lo: int, hi: int, head: int) -> list[int]:
    def drop(k):
        if k == head:
            return False
        rel = e_tok[k].get("deprel", "") or ""
        return (e_tok[k].get("upos") in _SPAN_TRIM_UPOS
                or rel in _SPAN_TRIM_REL or _rel_base(rel) in _SPAN_TRIM_REL)
    while lo <= hi and drop(lo):
        lo += 1
    while hi >= lo and drop(hi):
        hi -= 1
    return list(range(lo, hi + 1)) if lo <= hi else []


def _claimed_elsewhere(st, byj, keep, head: int, src_i: int) -> bool:
    for k in keep:
        if k == head:
            continue
        w = byj.get(k)
        if w is None or w.get("vec") is None or w["upos"] in _FALLBACK_SKIP_UPOS:
            continue
        for a in st["live"]:
            if a["i"] == src_i or a.get("vec") is None:
                continue
            if float(a["vec"] @ w["vec"]) >= _SPAN_CLAIM:
                return True
    return False


# ── a sentence with NO translation: glossing from the vectors alone ────────────────────────────
# ⚠⚠ **OPEN-VOCABULARY RETRIEVAL DOES NOT WORK, AND THE MEASUREMENT IS THE WHOLE REASON THIS PASS IS
# SHAPED THE WAY IT IS.** The obvious reading of "gloss it from the vectors" is: take the nearest
# English word in the table. Measured, that is unusable on two counts at once.
#   * THERE IS NO THRESHOLD. Taking the best of 52 664 candidates reaches the tail every time, so for
#     a RANDOM source word the best English cosine is median 0.42-0.47 and 90th percentile 0.52-0.55
#     (la .418/.516, sa .450/.544, zh .471/.547, ar .449/.532). Correct glosses score in exactly that
#     band -- `Arma`/*arms* 0.521, `fato`/*fate* 0.421, `muni`/*sages* 0.541 -- so chance and signal
#     are not separable by any cut.
#   * AND IT IS ~14 % RIGHT: top-1 agrees with what the aligner produces 6/38 on Latin and 5/45 on
#     Sanskrit, and the misses are confident and plausible, which is the worst kind — `virum`/*cleric*,
#     `qui`/*cleric*, `ab`/*territories*, `paripapraccha`/*inform*, `kaś`/*surely*. That matches the
#     release's own held-out figures (la 37.7 % @1, sa 11.5 % @1); these tables were fitted to align
#     parallel trees, not to serve as a bilingual dictionary.
#
# ⚠ SO THE DICTIONARY SUPPLIES THE CANDIDATES AND THE VECTORS CHOOSE AMONG THEM. That collapses the
# candidate set from 52 664 to the 2-66 senses of one headword, which is what makes a cosine mean
# something again — the same reasoning `_FALLBACK_COS_DICT` already rests on, and it reuses that bar.
# Measured on a Ramayana file: `tapaḥ` -> *penance*, `svādhyāya` -> *recitation*, `vāc` -> *speech*,
# `dharma` -> *morality*, `guṇavān` -> *excellent*, `muni` -> *sages*, `jñaḥ` -> *wise* — about 13 of
# 16 are good glosses by hand, against ~14 % for the open-vocabulary version.
# ⚠️ **WHICH MEANS THIS RUNS ONLY WHERE AN OFFLINE DICTIONARY EXISTS** (`_DICT_LANGS`: Sanskrit, via
# `app/apte.py`). `app/wiktionary.py` covers every other language and is a NETWORK lookup — hundreds
# of round-trips inside a pass that already costs seconds is not a trade this feature can make, the
# same judgement the Apte tier records. A language without one is left unglossed, deliberately:
# silence is this module's preferred failure, and a 14 %-accurate gloss written into an annotator's
# document is worse than a blank column they can fill themselves.
# ⚠️ AND IT NEEDS NO grew AND NO ENGLISH PARSE. There is no translation to parse and no tree to align,
# so this path is reachable on an install where the conversion grammars were never fetched — the one
# part of this feature that is.


# ⚠ PRON IS SKIPPED HERE THOUGH THE ALIGNED PASS GLOSSES IT HAPPILY, and the asymmetry is the point.
# In the aligned pass a pronoun is glossed by the TRANSLATION'S pronoun, which is as reliable as any
# pair gets (`ko` -> *who*). Here it would be glossed by a dictionary sense chosen by a vector — and a
# pronoun's meaning is deictic, so its distribution encodes its SYNTACTIC ROLE exactly as a function
# word's does, which is the very reason `_FALLBACK_SKIP_UPOS` exists. ⚠️ MEASURED, AND THE SKIP IS NOT
# FREE: on the Ramayana it removes 13 glosses, of which 11 are wrong or marginal and 2 are good
# (`sarva` -> *all*, `paraṃ` -> *utmost*). What makes it worth 2 losses is the SHAPE of the 11 — TEN of
# them are the same lemma `ka` ("who") coming back as *sense*, because Apte's interrogative entry runs
# to 30 senses and a deictic vector picks the same wrong one every time. A pronoun repeats, so one bad
# lemma becomes a bad gloss on every occurrence of it, which is exactly the failure a reader notices.
_NODICT_SKIP_UPOS = _FALLBACK_SKIP_UPOS | frozenset(("PRON",))


def _gloss_without_translation(sent: dict, lang: str) -> list[dict]:
    """Gloss a sentence that carries no translation, from its own words alone.  ``[]`` where the
    language has no offline dictionary or no vector table — both of which are ordinary."""
    code = norm_dict_lang(lang)
    if code not in _DICT_LANGS:
        return []
    from . import vectors
    src_vec, en_vec = vectors.table(code), vectors.table(HUB_LANG)
    if src_vec is None or en_vec is None:
        return []
    out = []
    for i, t in enumerate(sent.get("tokens") or []):
        upos = t.get("upos", "")
        if upos in _SKIP_UPOS or upos in _NODICT_SKIP_UPOS:
            continue
        v = vectors.token_vector(src_vec, t.get("form", ""), t.get("lemma", ""))
        if v is None:
            continue
        words = _dict_words(code, t.get("lemma", "") or t.get("form", ""), upos)
        if not words:
            continue
        best = None
        for w in words:
            b = vectors.token_vector(en_vec, w, w)
            if b is None:
                continue
            c = float(v @ b)
            # `w` breaks a tie, so two senses at the same cosine cannot reorder between runs and
            # make the gloss flicker on an unrelated edit.
            if c >= _FALLBACK_COS_DICT and (best is None or (c, w) > best):
                best = (c, w)
        if best is None:
            continue
        c, w = best
        # ⚠ `en` IS -1: there is no English TOKEN behind this gloss, only a dictionary sense. Nothing
        # downstream reads it (`applyAutoGloss` takes `src`/`form`/`lemma`), but a real index here
        # would be a lie about where the word came from.
        out.append({"src": i, "en": -1, "form": _gloss_case(w, ""), "lemma": _gloss_case(w, ""),
                    "upos": "", "score": round(c, 4)})
    return out


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


# ⚠ A GLOSS IS NOT A SENTENCE, SO IT DOES NOT CARRY A SENTENCE'S CAPITAL. A translation is prose:
# its first word is capitalised because it opens a line, and every word after a full stop likewise —
# `Ascetic Valmiki enquired…` glosses `tapasvin` as *Ascetic* only because it happened to fall first.
# ⚠️ THE RULE AND ITS EXCEPTIONS ARE `app.wiktionary._decap`'s, NOT A SECOND OPINION: only the LEADING
# capital is lowered (every other capital in a gloss is load-bearing — a proper name inside a
# definition, a Leipzig abbreviation run the frontend small-caps), and a PROPN, a leading Leipzig
# abbreviation and a first word carrying a second capital are all left alone. `app/apte.py` already
# reuses that same function so a picked dictionary sense and an aligned gloss read alike; this is the
# third caller.
# ⚠️ `I` IS THE ONE EXCEPTION THIS PATH HAS TO ADD. English capitalises the first-person pronoun
# wherever it stands, and `_decap` cannot know that — it sees a one-letter word with a single capital,
# which is exactly the shape it lowercases. `i` as a gloss is simply wrong.
_KEEP_CAPS = frozenset(("I",))


def _gloss_case(text: str, upos: str) -> str:
    """The English word as it should be WRITTEN into a gloss."""
    if not text or upos == "PROPN" or text in _KEEP_CAPS:
        return text
    from . import wiktionary
    return wiktionary._decap(text, upos)


# ── a PROPER NOUN nothing else could gloss ─────────────────────────────────────────────────────
# ⚠ A NAME IS TRANSFERRED, NOT TRANSLATED, so its own lemma is a better gloss than no gloss at all.
# This module already knows more about names than about any other class and all of it points the same
# way: `_SEM_SKIP_UPOS` excludes PROPN from the semantic term because a name's distribution is its
# REGION AND PERIOD (`troiae` retrieves peloponnese, laconia, aeneas — Troy is past rank 50), and
# `_POS_GROUP` puts PROPN in no supercategory because a name against a common noun is two kinds of
# word. The consequence is that a name the translation does not happen to contain has nothing left to
# match on. Writing `nārada` there says what the word IS, which is all a gloss of a name can say.
# ⚠ LAST RESORT, AND ONLY THAT. Anything that actually matched — an English name the alignment paired
# it with, a dictionary sense, a vector — is better evidence about this token than its own spelling,
# and every one of them is already in `pairs` by the time this runs. So this fills a gap and never
# competes: a token that has a gloss keeps it.
# ⚠ AND IT IS THE LEMMA'S ROMANISATION WHERE THE LEMMA IS NOT LATIN. A gloss is read as English, and
# pasting देव or 東京 into the gloss row states the word twice in the same script rather than glossing
# it. MISC `LTranslit` is the lemma's own romanisation — written by `parse._ext_misc` on every parse of
# a file whose FORM/LEMMA hold the native script, which is the UD convention this app follows — so it
# is preferred exactly there and ignored everywhere else. `Translit` (the FORM's) is the fallback for a
# token that carries no lemma at all.
# Anything outside Latin-1 + the Latin Extended blocks — i.e. "this string is not written in the Latin
# alphabet", which is the only question `_propn_gloss` asks of it.
_NON_LATIN_RE = re.compile(r"[^\u0000-\u024F\u1E00-\u1EFF\u2C60-\u2C7F\uA720-\uA7FF]")


def _misc_get(t: dict, key: str) -> str:
    for kv in (t.get("misc") or "").split("|"):
        k, _, v = kv.partition("=")
        if k == key:
            return v.strip()
    return ""


def _cap(s: str) -> str:
    """Capitalise the first character and touch nothing else — `s.title()`/`s.capitalize()` would both
    lowercase the rest, which is wrong for `McTavish`, `NASA` and any lemma the file spells with an
    internal capital. Unicode-correct at position 0: `ā` upcases to `Ā`, `ṛ` to `Ṛ`."""
    return s[:1].upper() + s[1:] if s else s


def _propn_gloss(t: dict) -> str:
    """What to gloss a PROPN with when nothing else could: its lemma, romanised if it is not Latin.

    ⚠ CAPITALISED, on instruction. A lemma is stored in the file's own citation form, which for most
    treebanks is lowercase (`nārada`, `italia`); as a GLOSS it is an English proper name, and English
    capitalises those wherever they stand. ⚠️ This is also why `c2sc` had to come off the lexical gloss
    tier in the same breath (glossTierAbbr, js/core/prefs.js): a capital in a lexical gloss is now
    routine, and `GLOSS_ABBR_RE` would have read a one-letter one as a Leipzig abbreviation."""
    lemma = (t.get("lemma") or "").strip()
    if lemma in ("", "_"):
        lemma = ""
    if lemma and not _NON_LATIN_RE.search(lemma):
        return _cap(lemma)                 # already Latin — the lemma IS the gloss
    lt = _misc_get(t, "LTranslit") or _misc_get(t, "Translit")
    if lt:
        return _cap(lt)
    return _cap(lemma)                     # no romanisation on file: the native spelling beats nothing


def _fill_propn(sent: dict, pairs: list[dict]) -> list[dict]:
    """Append a lemma gloss for every PROPN in ``sent`` that ``pairs`` does not already cover."""
    done = {p["src"] for p in pairs}
    add = []
    for i, t in enumerate(sent.get("tokens") or []):
        if i in done or t.get("upos") != "PROPN":
            continue
        g = _propn_gloss(t)
        if not g:
            continue
        # `en` is -1 and the score 0.0: there is no English token behind this and nothing was measured
        # — it is the fallback, and a score that pretended otherwise would rank it against real ones.
        add.append({"src": i, "en": -1, "form": g, "lemma": g, "upos": "PROPN", "score": 0.0})
    return sorted(pairs + add, key=lambda p: p["src"]) if add else pairs


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
    # ⚠ A SENTENCE WITH NO TRANSLATION IS ANSWERED FIRST AND SEPARATELY, and before the early return
    # below — a document with NO translated sentence at all is exactly the case this serves, and it
    # must not fall out of the function on its way past.
    for i, txt in jobs:
        if not txt and (sentences[i].get("tokens") or []):
            out[i]["pairs"] = _fill_propn(sentences[i],
                                          _gloss_without_translation(sentences[i], lang))
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

    # ── 3. the two vector tables, resolved ONCE for the whole batch ────────────────────────
    # ⚠ ONCE, because loading one is ~27 MB of float32 off disk (measured 0.13 s cold, and it stays
    # in app/vectors.py's own small cache afterwards) while a batch is routinely a whole document.
    # Both may be None -- the release covers thirteen languages, the tables are fetched rather than
    # shipped, and a reader may simply not have them -- and `align` is written so that None means
    # "score on structure alone", i.e. exactly this module's pre-vector answer.
    src_vec = vectors.table(lang)
    en_vec = vectors.table(trans_lang or "en")

    # ── 4. map back, 5. align ──────────────────────────────────────────────────────────────
    for (i, _txt, en_toks), su, eu in zip(live, src_ud, en_ud):
        src_toks = sentences[i].get("tokens") or []
        su_toks, eu_toks = su.get("tokens") or [], eu.get("tokens") or []
        s_map = _idmap(len(src_toks), su_toks)
        e_map = _idmap(len(en_toks), eu_toks)
        if s_map is None or e_map is None:
            out[i]["error"] = "could not map the converted tree back to the document"
            continue
        out[i]["sents"] = sum(1 for t in en_toks if str(t.get("head") or "0") == "0")
        for p in align(su_toks, eu_toks, src_vec, en_vec, lang):
            si, ei = s_map[p["src"]], e_map[p["en"]]
            et = en_toks[ei]
            # ⚠ THE ENGLISH TOKEN IS READ OFF THE **UNCONVERTED** PARSE, not off the UD tree beside
            # it: the conversion is a claim about SYNTAX, and the form and lemma of a word are not
            # its business.  (It matters in practice too -- the mSUD direction rewrites forms, so a
            # converted node's `form` can be a fusion of several words' spellings.)
            eu_pos = et.get("upos", "")
            # ⚠ THE GLOSS TEXT MAY BE A PHRASE (`_expand_spans`), and it is read off the UNCONVERTED
            # parse exactly as the single-word case is -- the conversion has no business rewriting a
            # spelling. The LEMMA stays the HEAD's: MGloss's lexical part is a STEM gloss, so
            # `cāritreṇa` takes `good-conduct` in Gloss and `conduct` as its stem.
            form = _gloss_case(et.get("form", ""), eu_pos)
            span = p.get("en_span")
            if span:
                cells = [(k, en_toks[e_map[k]]) for k in span if 0 <= k < len(e_map)]
                cells = [(k, t) for k, t in cells if (t.get("form") or "")]
                if len(cells) > 1:
                    # ⚠ CASED ONCE, OVER THE WHOLE PHRASE, AND BY THE FIRST WORD'S CLASS. `_decap`
                    # touches position 0 and nothing else, deliberately — every interior capital in a
                    # gloss is load-bearing. Applying it per WORD would therefore lowercase each of
                    # them in turn and take a name inside the phrase with it (`the Vedas` -> `vedas`).
                    form = _gloss_case(" ".join(t.get("form", "") for _, t in cells),
                                       cells[0][1].get("upos", ""))
            out[i]["pairs"].append({
                "src": si, "en": ei,
                # Cased for a GLOSS, not for prose — see `_gloss_case`. Both halves, because the FORM
                # fills MISC `Gloss` and the LEMMA fills MGloss's lexical part, and `Ascetic`/`ascetic`
                # disagreeing between the two tiers is exactly the kind of drift this app hunts.
                "form": form,
                "lemma": _gloss_case(et.get("lemma", ""), eu_pos),
                "upos": eu_pos,
                "score": p["score"],
            })
        out[i]["pairs"].sort(key=lambda d: d["src"])
        out[i]["pairs"] = _fill_propn(sentences[i], out[i]["pairs"])
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
    assert _W_SEM + _W_FEAT + _W_ORD < _W_REL * (_R_BASE - _R_CLASS), \
        "nothing may overturn a relation-CLASS difference — this is what bounds the semantic term"
    assert _W_SEM >= _W_FEAT, \
        "meaning must not be the weakest term in the sum"
    assert _W_SEM_CERTAIN > _W_REL * (_R_EXACT - _R_CLASS), \
        "(vi) a certain cosine must be able to cross ONE relation-class rung — that is what it is for"
    assert _W_SEM_CERTAIN + _W_SEM + _W_FEAT + _W_ORD < _W_REL * (_R_EXACT - _R_SUPER), \
        "(vii) …and no more than one: it must not lift a SUPERTYPE pair over an exact one"
    # ⚠ AND THE NO-VECTOR ANSWER MUST BE THE OLD ANSWER, BYTE FOR BYTE. The semantic term is additive
    # with a zero default, so that holds only while W_FEAT, W_ORD and THETA are exactly the values
    # they had before it existed — a document with no table would otherwise be re-scored against a
    # threshold calibrated for a sum it no longer produces. Stated as an assertion rather than as a
    # comment because it is the one property that makes this change safe to ship for the languages
    # the release does not cover, which is most of them.
    assert (_W_FEAT, _W_ORD, _THETA) == (0.09, 0.012, 0.42), \
        "the pre-vector weights are load-bearing: a document with no table must score as it did before"


_weight_invariants()
